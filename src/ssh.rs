use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use russh::{
    ChannelMsg, Disconnect, client,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate, decode_secret_key},
};
use tokio::time::timeout;

use crate::{AppError, Credentials, Database, HostKey, Result, Server, ServerReport, models::now};

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(40);
const MAX_OUTPUT: usize = 256 * 1024;

type ObservedKey = Arc<Mutex<Option<(String, String)>>>;

pub struct VerifiedHandler {
    expected: Option<String>,
    observed: ObservedKey,
}

impl client::Handler for VerifiedHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        let key = key.public_key();
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        if let Ok(mut observed) = self.observed.lock() {
            *observed = Some((fingerprint.clone(), key.algorithm().to_string()));
        }
        Ok(self
            .expected
            .as_deref()
            .is_none_or(|expected| expected == fingerprint))
    }
}

pub struct SshSession {
    handle: client::Handle<VerifiedHandler>,
}

fn connection_error() -> AppError {
    AppError::new(
        "connection",
        "Could not connect over SSH. Check the address, port and server availability in your hosting dashboard.",
    )
}

fn transport_error(_: russh::Error) -> AppError {
    AppError::new(
        "ssh",
        "The SSH connection was interrupted. Reconnect to the server.",
    )
}

async fn handshake(
    server: &Server,
    expected: Option<String>,
) -> Result<(client::Handle<VerifiedHandler>, ObservedKey)> {
    server.connection.validate()?;
    let observed = Arc::new(Mutex::new(None));
    let handler = VerifiedHandler {
        expected: expected.clone(),
        observed: Arc::clone(&observed),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(120)),
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        ..Default::default()
    });
    let result = timeout(
        CONNECTION_TIMEOUT,
        client::connect(
            config,
            (server.connection.host.as_str(), server.connection.port),
            handler,
        ),
    )
    .await
    .map_err(|_| {
        AppError::new(
            "timeout",
            "The server did not respond within 15 seconds. Check its IP address and SSH access rules.",
        )
    })?;
    match result {
        Ok(handle) => Ok((handle, observed)),
        Err(_) => {
            let changed = observed
                .lock()
                .ok()
                .and_then(|key| key.clone())
                .is_some_and(|(actual, _)| {
                    expected
                        .as_deref()
                        .is_some_and(|expected| expected != actual)
                });
            if changed {
                Err(AppError::new(
                    "hostKeyChanged",
                    "The server key changed. No password or user key was sent. Verify the server with your hosting provider.",
                ))
            } else {
                Err(connection_error())
            }
        }
    }
}

/// Fetch a server key without ever sending user credentials.
pub async fn probe(server: &Server, database: &Database) -> Result<HostKey> {
    let (handle, observed) = handshake(server, None).await?;
    let (fingerprint, algorithm) = observed
        .lock()
        .map_err(|_| connection_error())?
        .clone()
        .ok_or_else(connection_error)?;
    let _ = handle
        .disconnect(Disconnect::ByApplication, "Key inspection complete", "en")
        .await;
    Ok(HostKey {
        status: database.host_status(
            &server.connection.host,
            server.connection.port,
            &fingerprint,
        )?,
        previous_fingerprint: database
            .known_fingerprint(&server.connection.host, server.connection.port)?,
        fingerprint,
        algorithm,
    })
}

impl SshSession {
    pub fn is_connected(&self) -> bool {
        !self.handle.is_closed()
    }

    pub async fn connect(
        server: &Server,
        credentials: &Credentials,
        database: &Database,
    ) -> Result<Self> {
        let expected = database
            .known_fingerprint(&server.connection.host, server.connection.port)?
            .ok_or_else(|| {
                AppError::new(
                    "hostKeyUnknown",
                    "Inspect and confirm the server SSH fingerprint before connecting.",
                )
            })?;
        let (mut handle, _) = handshake(server, Some(expected)).await?;
        let authentication = timeout(CONNECTION_TIMEOUT, async {
            match credentials {
                Credentials::Password {password} => {
                    if password.is_empty() || password.len() > 4096 { return Err(AppError::new("validation", "Enter the SSH password.")); }
                    handle.authenticate_password(&server.connection.username,password.as_str()).await.map_err(transport_error)
                },
                Credentials::Key {private_key,passphrase} => {
                    if private_key.len() > 32768 { return Err(AppError::new("validation", "The SSH key exceeds the 32 KB size limit.")); }
                    let key = decode_secret_key(private_key,if passphrase.is_empty() { None } else { Some(passphrase.as_str()) }).map_err(|_| AppError::new("privateKey", "Could not read the SSH key. Check its OpenSSH/PEM format and passphrase."))?;
                    let hash = handle.best_supported_rsa_hash().await.map_err(transport_error)?.flatten();
                    handle.authenticate_publickey(&server.connection.username,PrivateKeyWithHashAlg::new(Arc::new(key),hash)).await.map_err(transport_error)
                }
            }
        }).await.map_err(|_| AppError::new("timeout", "The server did not finish authentication. Try connecting again."))??;
        if !authentication.success() {
            return Err(AppError::new(
                "authentication",
                "The server rejected authentication. Check the username, password or SSH key.",
            ));
        }
        Ok(Self { handle })
    }

    /// Commands are fixed application operations, never arbitrary frontend input.
    pub async fn script(&self, command: &str, stdin: &[u8]) -> Result<String> {
        timeout(COMMAND_TIMEOUT, async {
            let mut channel = self.handle.channel_open_session().await.map_err(transport_error)?;
            channel.exec(true,command).await.map_err(transport_error)?;
            if !stdin.is_empty() { channel.data(stdin).await.map_err(transport_error)?; }
            channel.eof().await.map_err(transport_error)?;
            let mut output = Vec::new();
            let mut exit_code = None;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data {data} => {
                        if output.len() + data.len() > MAX_OUTPUT { return Err(AppError::new("outputLimit", "The server response exceeded the output limit. The operation was stopped.")); }
                        output.extend_from_slice(&data);
                    },
                    ChannelMsg::ExitStatus {exit_status} => exit_code = Some(exit_status),
                    _ => {}
                }
            }
            if exit_code != Some(0) { return Err(AppError::new("remoteCommand", "The server could not run the check. Make sure the SSH user has access to a standard Linux shell.")); }
            String::from_utf8(output).map_err(|_| AppError::new("encoding", "The server response uses an unsupported encoding."))
        }).await.map_err(|_| AppError::new("timeout", "The server check timed out. Try running it again."))?
    }

    pub async fn inspect(&self) -> Result<ServerReport> {
        parse_report(
            &self
                .script("sh -s", include_bytes!("scripts/inspect.sh"))
                .await?,
        )
    }

    pub async fn close(&self) {
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "Disconnected by user", "en")
            .await;
    }
}

pub fn parse_report(output: &str) -> Result<ServerReport> {
    let fields: HashMap<&str, &str> = output
        .lines()
        .filter_map(|line| line.split_once('='))
        .collect();
    let required = |key| {
        fields.get(key).copied().filter(|value| !value.is_empty()).ok_or_else(|| AppError::new("preflight", "Could not detect the server configuration. Linux with a standard SSH shell is required."))
    };
    let number = |key| {
        required(key)?.parse::<u64>().map_err(|_| {
            AppError::new(
                "preflight",
                "The server returned invalid resource information.",
            )
        })
    };
    Ok(ServerReport {
        hostname: required("hostname")?.into(),
        os_name: required("os_name")?.into(),
        os_id: required("os_id")?.into(),
        os_version: required("os_version")?.into(),
        architecture: required("architecture")?.into(),
        memory_mb: number("memory_mb")?,
        disk_available_mb: number("disk_available_mb")?,
        cpu_count: number("cpu_count")?
            .try_into()
            .map_err(|_| AppError::new("preflight", "The server returned an invalid CPU count."))?,
        has_systemd: fields.get("systemd") == Some(&"yes"),
        can_admin: fields.get("admin") == Some(&"yes"),
        hermes_version: fields
            .get("hermes_version")
            .filter(|v| !v.is_empty())
            .map(|v| (*v).into()),
        checked_at: now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_server_report_must_not_pass_preflight() {
        assert!(parse_report("hostname=server\nos_id=ubuntu").is_err());
    }
    #[test]
    fn unsupported_os_is_identified_without_becoming_installable() -> Result<()> {
        let report = parse_report(
            "hostname=server\nos_name=Debian\nos_id=debian\nos_version=13\narchitecture=x86_64\nmemory_mb=4096\ndisk_available_mb=16000\ncpu_count=2\nsystemd=yes\nadmin=yes\nhermes_version=\n",
        )?;
        assert!(!report.supported());
        Ok(())
    }
}
