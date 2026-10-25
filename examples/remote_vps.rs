//! Exercise the real core against the disposable VPS configured in .env.

use hermes_core::{
    AppError, Credentials, Database, HostKeyStatus, Result, ServerDraft,
    deployment::{self, DeploymentSecrets},
    ssh::{SshSession, probe},
};
use tokio::time::{Duration, sleep};

async fn wait_service(session: &SshSession, running: bool) -> Result<()> {
    for _ in 0..30 {
        let status = deployment::status(session).await?;
        if status.service_active == running && status.api_healthy == running {
            return Ok(());
        }
        sleep(Duration::from_secs(2)).await;
    }
    Err(AppError::new(
        "fixture",
        "The Hermes service did not reach the expected state within the test timeout.",
    ))
}
use std::{collections::HashMap, path::Path};

fn required(values: &HashMap<String, String>, name: &str) -> Result<String> {
    values
        .get(name)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| AppError::new("fixture", format!("Set {name} in .env.")))
}

async fn run() -> Result<()> {
    let values: HashMap<String, String> = dotenvy::from_path_iter(".env")
        .map_err(|_| AppError::new("fixture", "Could not read the local .env fixture."))?
        .collect::<std::result::Result<_, _>>()
        .map_err(|_| AppError::new("fixture", "Could not parse the local .env fixture."))?;
    let directory = Path::new("target/remote-vps");
    std::fs::create_dir_all(directory)?;
    let database = Database::open(&directory.join("workspace.sqlite3"))?;
    let raw_host = required(&values, "HERMES_TEST_HOST")?;
    let host = ["https://", "http://", "ssh://"]
        .iter()
        .find_map(|scheme| raw_host.strip_prefix(scheme))
        .unwrap_or(&raw_host)
        .trim_end_matches('/')
        .to_owned();
    let port = required(&values, "HERMES_TEST_PORT")?
        .parse::<u16>()
        .map_err(|_| AppError::new("fixture", "Invalid SSH port in .env."))?;
    let username = required(&values, "HERMES_TEST_USERNAME")?;
    let server = database.list_servers()?.into_iter().find(|server| {
        server.connection.host == host
            && server.connection.port == port
            && server.connection.username == username
    });
    let server = match server {
        Some(server) => server,
        None => database.add_server(ServerDraft {
            name: "Disposable VPS".into(),
            host,
            port,
            username,
        })?,
    };
    let key = probe(&server, &database).await?;
    if key.status == HostKeyStatus::Changed {
        return Err(AppError::new(
            "hostKeyChanged",
            "The test server key changed. Review the saved test fixture before reconnecting.",
        ));
    }
    if let Some(expected) = values
        .get("HERMES_TEST_HOST_FINGERPRINT")
        .filter(|value| !value.trim().is_empty())
        && expected != &key.fingerprint
    {
        return Err(AppError::new(
            "hostKeyChanged",
            "The observed SSH fingerprint does not match HERMES_TEST_HOST_FINGERPRINT. No credentials were sent.",
        ));
    }
    // First-use trust is confined to the explicitly authorized disposable test fixture.
    database.trust_host(&server.connection.host, port, &key.fingerprint)?;
    let credentials = if let Some(password) = values
        .get("HERMES_TEST_PASSWORD")
        .filter(|value| !value.is_empty())
    {
        Credentials::Password {
            password: password.clone(),
        }
    } else {
        let path = required(&values, "HERMES_TEST_PRIVATE_KEY_PATH")?;
        let private_key = std::fs::read_to_string(path).map_err(|_| {
            AppError::new(
                "fixture",
                "Could not read the private key file configured in .env.",
            )
        })?;
        Credentials::Key {
            private_key,
            passphrase: values
                .get("HERMES_TEST_KEY_PASSPHRASE")
                .cloned()
                .unwrap_or_default(),
        }
    };
    let session = SshSession::connect(&server, &credentials, &database).await?;
    let action = std::env::args().nth(1).unwrap_or_else(|| "inspect".into());
    match action.as_str() {
        "prepare-antigravity" => {
            let before = hermes_core::managed_settings::read(&session, &server).await?;
            let started =
                deployment::prepare_provider(&session, &server, "antigravity-oauth").await?;
            println!(
                "Started optional provider preparation: {}",
                started.job_id.unwrap_or_default()
            );
            for _ in 0..180 {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let status = deployment::status(&session).await?;
                if status.in_progress() {
                    continue;
                }
                if status.state != deployment::JobState::Succeeded {
                    return Err(AppError::new(
                        "fixture",
                        "Optional provider preparation failed. Inspect sanitized installer diagnostics.",
                    ));
                }
                let after = hermes_core::managed_settings::read(&session, &server).await?;
                if serde_json::to_value(&before.setup)? != serde_json::to_value(&after.setup)?
                    || before.configured_credentials != after.configured_credentials
                    || before.authorized_providers != after.authorized_providers
                    || !after
                        .prepared_providers
                        .contains(&"antigravity-oauth".into())
                    || !status.api_healthy
                {
                    return Err(AppError::new(
                        "fixture",
                        "Provider preparation failed its preservation or health checks.",
                    ));
                }
                println!(
                    "PASS: Official agy CLI and Hermes plugin prepared. Existing settings, credentials and accounts preserved; service healthy."
                );
                session.close().await;
                return Ok(());
            }
            return Err(AppError::new(
                "fixture",
                "Provider preparation is still running.",
            ));
        }
        "auth-antigravity" => {
            let before = hermes_core::managed_settings::read(&session, &server).await?;
            let reply =
                hermes_core::provider_auth::request(&session, "antigravity-oauth", "start", "")
                    .await?;
            let id = reply
                .session_id
                .ok_or_else(|| AppError::new("fixture", "Expected a new Google sign-in prompt."))?;
            if reply.flow.as_deref() != Some("paste_code")
                || !reply
                    .verification_url
                    .as_deref()
                    .is_some_and(|url| url.starts_with("https://accounts.google.com/"))
            {
                hermes_core::provider_auth::request(&session, "antigravity-oauth", "cancel", &id)
                    .await?;
                return Err(AppError::new(
                    "fixture",
                    "The official Google prompt was not relayed.",
                ));
            }
            hermes_core::provider_auth::request(&session, "antigravity-oauth", "cancel", &id)
                .await?;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let after = hermes_core::managed_settings::read(&session, &server).await?;
            if before.revision != after.revision
                || before.authorized_providers != after.authorized_providers
            {
                return Err(AppError::new(
                    "fixture",
                    "Google start/cancel changed existing server settings.",
                ));
            }
            println!(
                "PASS: Real Google sign-in URL relayed and session cancelled. No code submitted; settings preserved."
            );
            session.close().await;
            return Ok(());
        }
        "models" => {
            let before = hermes_core::managed_settings::read(&session, &server).await?;
            let result = hermes_core::provider_models::discover(
                &session,
                &before.setup,
                &DeploymentSecrets::default(),
            )
            .await?;
            if result.status != "ok" || result.models.is_empty() {
                return Err(AppError::new(
                    "fixture",
                    "The configured provider returned no live model catalog.",
                ));
            }
            let after = hermes_core::managed_settings::read(&session, &server).await?;
            if before.revision != after.revision {
                return Err(AppError::new(
                    "fixture",
                    "Model discovery changed server settings.",
                ));
            }
            println!(
                "PASS: Live provider model catalog loaded ({} IDs); no generation request or settings change.",
                result.models.len()
            );
            session.close().await;
            return Ok(());
        }
        "auth-browsers" => {
            let before = hermes_core::managed_settings::read(&session, &server).await?;
            for provider in ["anthropic", "openrouter"] {
                let reply =
                    hermes_core::provider_auth::request(&session, provider, "start", "").await?;
                let id = reply.session_id.ok_or_else(|| {
                    AppError::new("fixture", "The native browser flow returned no session.")
                })?;
                if reply.flow.as_deref() != Some("paste_code") || reply.verification_url.is_none() {
                    hermes_core::provider_auth::request(&session, provider, "cancel", &id).await?;
                    return Err(AppError::new(
                        "fixture",
                        "The native browser flow did not return a sign-in link.",
                    ));
                }
                let cancelled =
                    hermes_core::provider_auth::request(&session, provider, "cancel", &id).await?;
                if cancelled.status.as_deref() != Some("cancelled") {
                    return Err(AppError::new(
                        "fixture",
                        "The native browser session could not be cancelled.",
                    ));
                }
                println!(
                    "PASS: Native {provider} browser sign-in started and cancelled without submitting credentials."
                );
            }
            let after = hermes_core::managed_settings::read(&session, &server).await?;
            if before.revision != after.revision
                || before.authorized_providers != after.authorized_providers
            {
                return Err(AppError::new(
                    "fixture",
                    "The browser-start test unexpectedly changed server settings or account authorization.",
                ));
            }
            println!(
                "PASS: Existing server settings and authorized provider choices were preserved."
            );
            session.close().await;
            return Ok(());
        }
        "settings" => {
            let snapshot = hermes_core::managed_settings::read(&session, &server).await?;
            snapshot.setup.validate()?;
            if snapshot.revision.len() != 64 {
                return Err(AppError::new(
                    "fixture",
                    "The settings revision is invalid.",
                ));
            }
            println!(
                "PASS: Read and validated live Hermes settings; only credential presence and a revision digest crossed SSH."
            );
            session.close().await;
            return Ok(());
        }
        "verify" => {
            println!("{}", session.script("if [ \"$(id -u)\" -eq 0 ]; then exec python3 -; else exec sudo -n python3 -; fi", include_bytes!("../tests/fixtures/verify-vps.py")).await?);
            session.close().await;
            return Ok(());
        }
        "lifecycle" => {
            for (action, running) in [("stop", false), ("start", true), ("restart", true)] {
                deployment::service_action(&session, action).await?;
                wait_service(&session, running).await?;
                println!("PASS: Hermes service {action}");
            }
            session.close().await;
            return Ok(());
        }
        "reboot" => {
            let previous_boot = session
                .script("cat /proc/sys/kernel/random/boot_id", b"")
                .await?;
            session.script("if [ \"$(id -u)\" -eq 0 ]; then exec sh -s; else exec sudo -n sh -s; fi", b"systemd-run --quiet --on-active=5s --unit=hermes-companion-test-reboot /bin/systemctl reboot\n").await?;
            println!("Reboot scheduled. Waiting for the server to return.");
            session.close().await;
            sleep(Duration::from_secs(12)).await;
            for _ in 0..30 {
                if let Ok(reconnected) = SshSession::connect(&server, &credentials, &database).await
                {
                    let new_boot = reconnected
                        .script("cat /proc/sys/kernel/random/boot_id", b"")
                        .await?;
                    if new_boot == previous_boot {
                        reconnected.close().await;
                        sleep(Duration::from_secs(4)).await;
                        continue;
                    }
                    let result = wait_service(&reconnected, true).await;
                    if result.is_ok() {
                        println!(
                            "PASS: SSH host key preserved and Hermes started automatically after reboot."
                        );
                        reconnected.close().await;
                        return Ok(());
                    }
                    reconnected.close().await;
                }
                sleep(Duration::from_secs(4)).await;
            }
            return Err(AppError::new(
                "fixture",
                "The server did not return with a healthy Hermes service after reboot.",
            ));
        }
        "apply" | "apply-browser" | "apply-services" => {
            let mut server = server.clone();
            server.setup.provider = "custom".into();
            server.setup.base_url = "http://127.0.0.1:11434/v1".into();
            server.setup.model = "companion-configuration-test".into();
            server.setup.tools = vec!["file".into(), "memory".into(), "tts".into()];
            if action == "apply-browser" {
                server.setup.tools.push("browser".into());
                server.setup.browser = true;
            }
            server.setup.tts_provider = "edge".into();
            server.setup.tts_voice = "en-US-AriaNeural".into();
            server.setup.channels.clear();
            database.save_setup(&server.id, &server.setup)?;
            let mut secrets = DeploymentSecrets::default();
            secrets.values.push(deployment::CredentialValue {
                name: "COMPANION_CUSTOM_API_KEY".into(),
                value: "companion-test-'quoted-key-123".into(),
            });
            if action == "apply-services" {
                server
                    .setup
                    .tools
                    .extend(["web", "terminal", "code_execution", "image_gen"].map(String::from));
                server.setup.image_provider = "replicate".into();
                secrets.values.push(deployment::CredentialValue {
                    name: "REPLICATE_API_TOKEN".into(),
                    value: "companion-test-replicate-not-a-real-key".into(),
                });
                database.save_setup(&server.id, &server.setup)?;
            }
            println!(
                "{}",
                serde_json::to_string(
                    &deployment::apply_settings(&session, &server, &secrets).await?
                )?
            );
            session.close().await;
            return Ok(());
        }
        "restore" => {
            let mut server = server.clone();
            server.setup = hermes_core::SetupOptions::default();
            database.save_setup(&server.id, &server.setup)?;
            println!(
                "{}",
                serde_json::to_string(
                    &deployment::apply_settings(&session, &server, &DeploymentSecrets::default())
                        .await?
                )?
            );
            session.close().await;
            return Ok(());
        }
        "verify-settings" => {
            println!("{}",session.script("if [ \"$(id -u)\" = 0 ]; then exec python3 -; else exec sudo -n python3 -; fi", include_bytes!("../tests/fixtures/verify-settings-vps.py")).await?);
            session.close().await;
            return Ok(());
        }
        "verify-browser" => {
            let output = session
                .script(
                    "if [ \"$(id -u)\" = 0 ]; then exec python3 -; else exec sudo -n python3 -; fi",
                    include_bytes!("../tests/fixtures/verify-browser-vps.py"),
                )
                .await?;
            println!("{output}");
            if !output.starts_with("PASS:") {
                return Err(AppError::new("fixture", "The browser verification failed."));
            }
            session.close().await;
            return Ok(());
        }
        "verify-services" => {
            let output = session
                .script(
                    "if [ \"$(id -u)\" = 0 ]; then exec python3 -; else exec sudo -n python3 -; fi",
                    include_bytes!("../tests/fixtures/verify-services-vps.py"),
                )
                .await?;
            println!("{output}");
            if !output.starts_with("PASS:") {
                return Err(AppError::new("fixture", "The service verification failed."));
            }
            session.close().await;
            return Ok(());
        }
        "auth-start" => {
            let reply =
                hermes_core::provider_auth::request(&session, "openai-codex", "start", "").await?;
            println!(
                "{}",
                serde_json::json!({"flow":reply.flow,"hasCode":reply.user_code.is_some(),"hasUrl":reply.verification_url.is_some(),"hasSession":reply.session_id.is_some()})
            );
            if let Some(id) = reply.session_id {
                hermes_core::provider_auth::request(&session, "openai-codex", "cancel", &id)
                    .await?;
                println!("PASS: Native sign-in session cancelled.");
            }
            session.close().await;
            return Ok(());
        }
        "install" => {
            let mut server = server.clone();
            server.setup.provider = values
                .get("HERMES_TEST_MODEL_PROVIDER")
                .cloned()
                .unwrap_or_else(|| "openrouter".into());
            if let Some(model) = values
                .get("HERMES_TEST_MODEL")
                .filter(|value| !value.is_empty())
            {
                server.setup.model.clone_from(model);
            }
            server.setup.browser = false;
            database.save_setup(&server.id, &server.setup)?;
            let mut secrets = DeploymentSecrets::default();
            secrets.api_key = values
                .get("HERMES_TEST_MODEL_API_KEY")
                .cloned()
                .unwrap_or_default();
            println!(
                "{}",
                serde_json::to_string(&deployment::start(&session, &server, &secrets).await?)?
            );
            session.close().await;
            return Ok(());
        }
        "status" => {
            println!(
                "{}",
                serde_json::to_string(&deployment::status(&session).await?)?
            );
            session.close().await;
            return Ok(());
        }
        "logs" => {
            println!("{}", deployment::logs(&session).await?);
            session.close().await;
            return Ok(());
        }
        "resources" => {
            let output = session.script("if [ \"$(id -u)\" -eq 0 ]; then exec sh -s; else exec sudo -n sh -s; fi", b"set -eu\nfree -m\ndf -Pm /\nswapon --show\njournalctl -k --since '-45 minutes' --grep 'oom|Out of memory|Killed process' --no-pager -o cat | tail -n 30\nsystemctl show hermes-companion-install.service -p Result -p ExecMainStatus -p OOMPolicy -p MemoryPeak\n").await?;
            println!("{output}");
            session.close().await;
            return Ok(());
        }
        "start" | "stop" | "restart" => {
            println!(
                "{}",
                serde_json::to_string(&deployment::service_action(&session, &action).await?)?
            );
            session.close().await;
            return Ok(());
        }
        "inspect" => {}
        _ => {
            return Err(AppError::new(
                "fixture",
                "Use inspect, install, status, start, stop or restart.",
            ));
        }
    }
    let report = session.inspect().await?;
    database.save_report(&server.id, &report)?;
    println!(
        "{}",
        serde_json::json!({
            "ssh": "connected", "hostKey": "verified", "os": report.os_name,
            "architecture": report.architecture, "cpuCount": report.cpu_count,
            "memoryMb": report.memory_mb, "diskAvailableMb": report.disk_available_mb,
            "systemd": report.has_systemd, "canAdmin": report.can_admin,
            "existingHermes": report.hermes_version.is_some(), "supported": report.supported(),
        })
    );
    session.close().await;
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{}: {}", error.code, error.message);
        std::process::exit(1);
    }
}
