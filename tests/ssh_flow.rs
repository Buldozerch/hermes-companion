//! Exercise the real SSH protocol against an in-process test server.

use hermes_core::{
    Credentials, Database, HostKeyStatus, Server, ServerDraft,
    ssh::{SshSession, probe},
};
use russh::{
    Channel, ChannelId,
    keys::{Algorithm, PrivateKey, PublicKey, ssh_key::LineEnding},
    server::{self, Auth, ChannelOpenHandle, Msg, Server as _, Session},
};
use std::{
    net::SocketAddr,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{net::TcpListener, task::JoinHandle};

const REPORT: &str = "hostname=test-vps\nos_name=Ubuntu 24.04 LTS\nos_id=ubuntu\nos_version=24.04\narchitecture=x86_64\nmemory_mb=4096\ndisk_available_mb=16000\ncpu_count=2\nsystemd=yes\nadmin=yes\nhermes_version=\n";
type TestResult<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Clone)]
struct TestServer {
    attempts: Arc<AtomicUsize>,
    accepted_key: PublicKey,
    input: Vec<u8>,
}

impl server::Server for TestServer {
    type Handler = Self;
    fn new_client(&mut self, _: Option<SocketAddr>) -> Self {
        Self {
            input: Vec::new(),
            ..self.clone()
        }
    }
    fn handle_session_error(&mut self, _: russh::Error) {}
}

impl server::Handler for TestServer {
    type Error = russh::Error;

    async fn auth_password(
        &mut self,
        user: &str,
        password: &str,
    ) -> std::result::Result<Auth, Self::Error> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
        Ok(if user == "root" && password == "test-only-password" {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        key: &PublicKey,
    ) -> std::result::Result<Auth, Self::Error> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
        Ok(if user == "root" && key == &self.accepted_key {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn channel_open_session(
        &mut self,
        _: Channel<Msg>,
        reply: ChannelOpenHandle,
        _: &mut Session,
    ) -> std::result::Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        command: &[u8],
        session: &mut Session,
    ) -> std::result::Result<(), Self::Error> {
        if command == b"sh -s" {
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }

    async fn data(
        &mut self,
        _: ChannelId,
        data: &[u8],
        _: &mut Session,
    ) -> std::result::Result<(), Self::Error> {
        self.input.extend_from_slice(data);
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> std::result::Result<(), Self::Error> {
        if self.input == include_bytes!("../src/scripts/inspect.sh") {
            session.data(channel, REPORT.as_bytes())?;
            session.exit_status_request(channel, 0)?;
        } else {
            session.exit_status_request(channel, 1)?;
        }
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }
}

struct Fixture {
    server: Server,
    database: Database,
    attempts: Arc<AtomicUsize>,
    private_key: String,
    task: JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn fixture() -> TestResult<Fixture> {
    let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?;
    let client_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?;
    let private_key = client_key.to_openssh(LineEnding::LF)?.to_string();
    let attempts = Arc::new(AtomicUsize::new(0));
    let mut handler = TestServer {
        attempts: Arc::clone(&attempts),
        accepted_key: client_key.public_key().clone(),
        input: Vec::new(),
    };
    let config = Arc::new(server::Config {
        keys: vec![host_key],
        auth_rejection_time: Duration::ZERO,
        auth_rejection_time_initial: Some(Duration::ZERO),
        ..Default::default()
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let task = tokio::spawn(async move {
        let _ = handler.run_on_socket(config, &listener).await;
    });
    let database = Database::open(Path::new(":memory:"))?;
    let server = database.add_server(ServerDraft {
        name: "Test VPS".into(),
        host: "127.0.0.1".into(),
        port,
        username: "root".into(),
    })?;
    Ok(Fixture {
        server,
        database,
        attempts,
        private_key,
        task,
    })
}

#[tokio::test]
async fn password_connection_requires_trust_and_returns_real_ssh_output() -> TestResult {
    let f = fixture().await?;
    let credentials = Credentials::Password {
        password: "test-only-password".into(),
    };
    assert!(
        SshSession::connect(&f.server, &credentials, &f.database)
            .await
            .is_err()
    );
    let key = probe(&f.server, &f.database).await?;
    assert_eq!(key.status, HostKeyStatus::New);
    assert_eq!(
        f.attempts.load(Ordering::SeqCst),
        0,
        "Key inspection must not send credentials"
    );
    f.database.trust_host(
        &f.server.connection.host,
        f.server.connection.port,
        &key.fingerprint,
    )?;
    let session = SshSession::connect(&f.server, &credentials, &f.database).await?;
    let report = session.inspect().await?;
    assert!(report.supported());
    assert_eq!(report.hostname, "test-vps");
    assert_eq!(report.memory_mb, 4096);
    session.close().await;
    Ok(())
}

#[tokio::test]
async fn changed_host_key_blocks_authentication_before_password_is_sent() -> TestResult {
    let f = fixture().await?;
    f.database.trust_host(
        &f.server.connection.host,
        f.server.connection.port,
        "SHA256:different-key",
    )?;
    let result = SshSession::connect(
        &f.server,
        &Credentials::Password {
            password: "test-only-password".into(),
        },
        &f.database,
    )
    .await;
    match result {
        Err(error) => assert_eq!(error.code, "hostKeyChanged"),
        Ok(_) => panic!("Changed host key was accepted"),
    }
    assert_eq!(f.attempts.load(Ordering::SeqCst), 0);
    Ok(())
}

#[tokio::test]
async fn private_key_authentication_and_wrong_password_are_handled() -> TestResult {
    let f = fixture().await?;
    let key = probe(&f.server, &f.database).await?;
    f.database.trust_host(
        &f.server.connection.host,
        f.server.connection.port,
        &key.fingerprint,
    )?;
    let wrong = SshSession::connect(
        &f.server,
        &Credentials::Password {
            password: "wrong".into(),
        },
        &f.database,
    )
    .await;
    match wrong {
        Err(error) => assert_eq!(error.code, "authentication"),
        Ok(_) => panic!("Wrong password was accepted"),
    }
    let credentials = Credentials::Key {
        private_key: f.private_key.clone(),
        passphrase: String::new(),
    };
    let session = SshSession::connect(&f.server, &credentials, &f.database).await?;
    assert_eq!(session.inspect().await?.hostname, "test-vps");
    session.close().await;
    Ok(())
}
