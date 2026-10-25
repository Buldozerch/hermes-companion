#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod updater;

use hermes_core::{
    Activity, AppError, Credentials, Database, HostKey, HostKeyStatus, Result, Server, ServerDraft,
    ServerReport, SetupOptions,
    deployment::{self, DeploymentSecrets, DeploymentStatus},
    managed_settings::{self, SettingsSnapshot, SettingsUpdate},
    plan::{DeploymentPlan, deployment_plan},
    ssh::{SshSession, probe},
};
use std::{collections::HashMap, sync::Arc};
use tauri::{Manager, State};
use tokio::sync::Mutex;

struct AppState {
    database: Database,
    sessions: Mutex<HashMap<String, Arc<SshSession>>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    servers: Vec<Server>,
    activity: Vec<Activity>,
}

#[tauri::command]
fn load_workspace(state: State<'_, AppState>) -> Result<Workspace> {
    Ok(Workspace {
        servers: state.database.list_servers()?,
        activity: state.database.activity()?,
    })
}

#[tauri::command]
fn add_server(draft: ServerDraft, state: State<'_, AppState>) -> Result<Server> {
    state.database.add_server(draft)
}

#[tauri::command]
async fn remove_server(server_id: String, state: State<'_, AppState>) -> Result<()> {
    let session = state.sessions.lock().await.remove(&server_id);
    if let Some(session) = session {
        session.close().await;
    }
    state.database.remove_server(&server_id)
}

#[tauri::command]
async fn probe_host(server_id: String, state: State<'_, AppState>) -> Result<HostKey> {
    probe(&state.database.server(&server_id)?, &state.database).await
}

#[tauri::command]
async fn trust_host(
    server_id: String,
    fingerprint: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let server = state.database.server(&server_id)?;
    let observed = probe(&server, &state.database).await?;
    if observed.status == HostKeyStatus::Changed || observed.fingerprint != fingerprint {
        return Err(AppError::new(
            "hostKeyChanged",
            "The server fingerprint changed. Verify the address and host key with your hosting provider.",
        ));
    }
    state.database.trust_host(
        &server.connection.host,
        server.connection.port,
        &fingerprint,
    )
}

#[tauri::command]
async fn connect_server(
    server_id: String,
    credentials: Credentials,
    state: State<'_, AppState>,
) -> Result<ServerReport> {
    let server = state.database.server(&server_id)?;
    let session = SshSession::connect(&server, &credentials, &state.database).await?;
    let report = session.inspect().await?;
    if report.has_systemd {
        let pending = session.script("sh -s", b"if systemctl is-active --quiet hermes-companion-reboot.timer 2>/dev/null; then printf 'pending\\n'; else printf 'ready\\n'; fi\n").await?;
        if pending.trim() == "pending" {
            session.close().await;
            return Err(AppError::new(
                "rebootPending",
                "The server reboot is scheduled. Wait for the server to restart before reconnecting.",
            ));
        }
    }
    state.database.save_report(&server_id, &report)?;
    state.database.record(
        Some(&server_id),
        "Connection checked",
        &format!(
            "{} / {} / {} MB RAM",
            report.os_name, report.architecture, report.memory_mb
        ),
        "success",
    )?;
    let old = state
        .sessions
        .lock()
        .await
        .insert(server_id, Arc::new(session));
    if let Some(old) = old {
        old.close().await;
    }
    Ok(report)
}

#[tauri::command]
async fn disconnect_server(server_id: String, state: State<'_, AppState>) -> Result<()> {
    let session = state.sessions.lock().await.remove(&server_id);
    if let Some(session) = session {
        session.close().await;
    }
    Ok(())
}

#[tauri::command]
async fn connected_servers(state: State<'_, AppState>) -> Result<Vec<String>> {
    let mut sessions = state.sessions.lock().await;
    sessions.retain(|_, session| session.is_connected());
    Ok(sessions.keys().cloned().collect())
}

#[tauri::command]
fn save_setup(server_id: String, setup: SetupOptions, state: State<'_, AppState>) -> Result<()> {
    state.database.server(&server_id)?;
    state.database.save_setup(&server_id, &setup)
}

#[tauri::command]
fn get_plan(server_id: String, state: State<'_, AppState>) -> Result<DeploymentPlan> {
    Ok(deployment_plan(&state.database.server(&server_id)?))
}

async fn connected_session(state: &AppState, server_id: &str) -> Result<Arc<SshSession>> {
    state
        .sessions
        .lock()
        .await
        .get(server_id)
        .filter(|session| session.is_connected())
        .cloned()
        .ok_or_else(|| AppError::new("notConnected", "Connect to the server in this app session."))
}

#[tauri::command]
async fn get_deployment(server_id: String, state: State<'_, AppState>) -> Result<DeploymentStatus> {
    let session = connected_session(&state, &server_id).await?;
    let status = deployment::status(&session).await?;
    state.database.observe_deployment(&server_id, &status)?;
    Ok(status)
}

#[tauri::command]
async fn start_deployment(
    server_id: String,
    secrets: DeploymentSecrets,
    state: State<'_, AppState>,
) -> Result<DeploymentStatus> {
    let session = connected_session(&state, &server_id).await?;
    let server = state.database.server(&server_id)?;
    let result = deployment::start(&session, &server, &secrets).await;
    match &result {
        Ok(_) => state.database.record(Some(&server_id), "Installation started", "Installing the latest stable Hermes release. The operation continues on the server after disconnecting.", "info")?,
        Err(error) => state.database.record(Some(&server_id), "Installation could not start", &error.message, "error")?,
    }
    if let Ok(status) = &result {
        state.database.save_setup(
            &server_id,
            &SetupOptions::clean_install(server.setup.update_system),
        )?;
        state.database.observe_deployment(&server_id, status)?;
    }
    result
}

#[tauri::command]
async fn apply_setup(
    server_id: String,
    secrets: DeploymentSecrets,
    state: State<'_, AppState>,
) -> Result<DeploymentStatus> {
    let session = connected_session(&state, &server_id).await?;
    let server = state.database.server(&server_id)?;
    let result = deployment::apply_settings(&session, &server, &secrets).await?;
    state.database.observe_deployment(&server_id, &result)?;
    state.database.record(
        Some(&server_id),
        "Applying settings",
        "Updating model, channel and tool settings on the server.",
        "info",
    )?;
    Ok(result)
}

#[tauri::command]
async fn read_server_settings(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<SettingsSnapshot> {
    let session = connected_session(&state, &server_id).await?;
    let server = state.database.server(&server_id)?;
    let status = deployment::status(&session).await?;
    if !status.managed || status.installed_version.is_none() {
        return Err(AppError::new(
            "notInstalled",
            "Install Hermes before editing server settings.",
        ));
    }
    managed_settings::read(&session, &server).await
}

#[tauri::command]
async fn apply_server_settings(
    server_id: String,
    update: SettingsUpdate,
    secrets: DeploymentSecrets,
    state: State<'_, AppState>,
) -> Result<DeploymentStatus> {
    let session = connected_session(&state, &server_id).await?;
    let server = state.database.server(&server_id)?;
    let result = deployment::apply_managed_settings(&session, &server, &update, &secrets).await?;
    state.database.observe_deployment(&server_id, &result)?;
    state.database.record(
        Some(&server_id),
        "Applying settings",
        "Applying selected settings and restarting the Hermes service.",
        "info",
    )?;
    Ok(result)
}

#[tauri::command]
async fn reboot_server(server_id: String, state: State<'_, AppState>) -> Result<()> {
    let session = connected_session(&state, &server_id).await?;
    deployment::reboot_server(&session).await?;
    state.sessions.lock().await.remove(&server_id);
    let _ = state.database.record(
        Some(&server_id),
        "Server reboot requested",
        "A server reboot was scheduled. SSH was disconnected; reconnect after the server starts.",
        "info",
    );
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), session.close()).await;
    Ok(())
}

#[tauri::command]
async fn manage_service(
    server_id: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<DeploymentStatus> {
    let session = connected_session(&state, &server_id).await?;
    let result = deployment::service_action(&session, &action).await?;
    state.database.record(
        Some(&server_id),
        "Hermes service action",
        &format!("Service action requested: {action}."),
        "info",
    )?;
    Ok(result)
}

#[tauri::command]
async fn provider_auth(
    server_id: String,
    provider: String,
    action: String,
    session_id: Option<String>,
    code: Option<String>,
    state: State<'_, AppState>,
) -> Result<hermes_core::provider_auth::AuthReply> {
    let session = connected_session(&state, &server_id).await?;
    if action == "start" && deployment::status(&session).await?.in_progress() {
        return Err(AppError::new(
            "deploymentBusy",
            "Wait for the current server operation to finish before signing in.",
        ));
    }
    let code = zeroize::Zeroizing::new(code.unwrap_or_default());
    hermes_core::provider_auth::request_with_code(
        &session,
        &provider,
        &action,
        session_id.as_deref().unwrap_or(""),
        &code,
    )
    .await
}

#[tauri::command]
async fn get_remote_logs(server_id: String, state: State<'_, AppState>) -> Result<String> {
    let session = connected_session(&state, &server_id).await?;
    deployment::logs(&session).await
}

#[tauri::command]
async fn prepare_provider(
    server_id: String,
    provider: String,
    state: State<'_, AppState>,
) -> Result<DeploymentStatus> {
    let session = connected_session(&state, &server_id).await?;
    let server = state.database.server(&server_id)?;
    let status = deployment::prepare_provider(&session, &server, &provider).await?;
    state.database.observe_deployment(&server_id, &status)?;
    state.database.record(
        Some(&server_id),
        "Preparing provider",
        "Installing optional Antigravity support. The selected model and account stay unchanged.",
        "info",
    )?;
    Ok(status)
}

#[tauri::command]
async fn check_hermes_update(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<hermes_core::updates::HermesUpdate> {
    let session = connected_session(&state, &server_id).await?;
    hermes_core::updates::check(&session).await
}

#[tauri::command]
async fn update_hermes(server_id: String, state: State<'_, AppState>) -> Result<DeploymentStatus> {
    let session = connected_session(&state, &server_id).await?;
    let server = state.database.server(&server_id)?;
    let result = hermes_core::updates::start(&session, &server).await?;
    state.database.observe_deployment(&server_id, &result)?;
    state.database.record(
        Some(&server_id),
        "Hermes update started",
        "Creating a private backup and updating Hermes to the latest stable release.",
        "info",
    )?;
    Ok(result)
}

#[tauri::command]
async fn discover_provider_models(
    server_id: String,
    setup: SetupOptions,
    secrets: DeploymentSecrets,
    state: State<'_, AppState>,
) -> Result<hermes_core::provider_models::ModelCatalog> {
    let session = connected_session(&state, &server_id).await?;
    hermes_core::provider_models::discover(&session, &setup, &secrets).await
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::AppUpdates::default())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let database = Database::open(&directory.join("workspace.sqlite3"))?;
            app.manage(AppState {
                database,
                sessions: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            add_server,
            remove_server,
            probe_host,
            trust_host,
            connect_server,
            disconnect_server,
            connected_servers,
            save_setup,
            get_plan,
            get_deployment,
            start_deployment,
            apply_setup,
            read_server_settings,
            apply_server_settings,
            provider_auth,
            discover_provider_models,
            prepare_provider,
            check_hermes_update,
            update_hermes,
            updater::check_companion_update,
            updater::install_companion_update,
            manage_service,
            reboot_server,
            get_remote_logs
        ])
        .build(tauri::generate_context!());
    match app {
        Ok(app) => app.run(|_, _| {}),
        Err(error) => {
            eprintln!("Failed to start Hermes Companion: {error}");
            std::process::exit(1);
        }
    }
}
