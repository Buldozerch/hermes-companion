use hermes_core::{AppError, Result, releases};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppUpdates(pub Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    latest_version: String,
    available: bool,
    can_install: bool,
    notes: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

fn update_error() -> AppError {
    AppError::new(
        "appUpdate",
        "The application update failed. Check your connection, available disk space and installation permissions, then retry.",
    )
}

#[tauri::command]
pub async fn check_companion_update(
    app: AppHandle,
    state: State<'_, AppUpdates>,
) -> Result<UpdateInfo> {
    let mut pending = state.0.try_lock().map_err(|_| {
        AppError::new(
            "updateBusy",
            "An application update operation is already running.",
        )
    })?;
    let current = app.package_info().version.to_string();
    let mut info = UpdateInfo {
        current_version: current.clone(),
        latest_version: current.clone(),
        available: false,
        can_install: false,
        notes: String::new(),
    };
    *pending = None;
    let Some(release) = releases::discover(true).await? else {
        return Ok(info);
    };
    if releases::version(&release.tag_name)? <= releases::version(&current)? {
        return Ok(info);
    }
    info.latest_version = releases::version(&release.tag_name)?.to_string();
    info.available = true;
    let feed = format!(
        "https://github.com/Buldozerch/hermes-companion/releases/download/{}/latest.json",
        release.tag_name
    );
    if !release
        .assets
        .iter()
        .any(|asset| asset.name == "latest.json" && asset.browser_download_url == feed)
    {
        return Ok(info);
    }
    let url = feed.parse().map_err(|_| update_error())?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|_| update_error())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| update_error())?
        .check()
        .await
        .map_err(|_| update_error())?;
    if let Some(update) = update {
        let allowed = format!(
            "https://github.com/Buldozerch/hermes-companion/releases/download/{}/",
            release.tag_name
        );
        if update.version != info.latest_version
            || !update.download_url.as_str().starts_with(&allowed)
        {
            return Err(AppError::new(
                "appUpdate",
                "The release manifest does not match the selected release.",
            ));
        }
        info.notes = update.body.clone().unwrap_or_default();
        info.can_install = true;
        *pending = Some(update);
    }
    Ok(info)
}

#[tauri::command]
pub async fn install_companion_update(
    app: AppHandle,
    state: State<'_, AppUpdates>,
    progress: Channel<UpdateProgress>,
) -> Result<()> {
    let mut pending = state.0.try_lock().map_err(|_| {
        AppError::new(
            "updateBusy",
            "An application update operation is already running.",
        )
    })?;
    let update = pending.as_ref().ok_or_else(|| {
        AppError::new(
            "appUpdate",
            "Check for an application update before installing it.",
        )
    })?;
    let mut downloaded = 0_u64;
    let mut emitted = Instant::now() - Duration::from_secs(1);
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                if emitted.elapsed() >= Duration::from_millis(100) {
                    let _ = progress.send(UpdateProgress {
                        stage: "downloading",
                        downloaded,
                        total,
                    });
                    emitted = Instant::now();
                }
            },
            || {
                let _ = progress.send(UpdateProgress {
                    stage: "installing",
                    downloaded: 0,
                    total: None,
                });
            },
        )
        .await
        .map_err(|_| update_error())?;
    *pending = None;
    let _ = progress.send(UpdateProgress {
        stage: "restarting",
        downloaded: 0,
        total: None,
    });
    app.restart();
}
