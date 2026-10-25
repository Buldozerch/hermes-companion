//! Stable Hermes update checks and durable update jobs.
use crate::{AppError, Result, Server, deployment, releases, ssh::SshSession};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesUpdate {
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
}

pub async fn check(session: &SshSession) -> Result<HermesUpdate> {
    let status = deployment::status(session).await?;
    if !status.managed || status.installed_version.is_none() {
        return Err(AppError::new(
            "notInstalled",
            "Install Hermes before checking for server updates.",
        ));
    }
    let actual = session.script("if [ \"$(id -u)\" -eq 0 ]; then exec sh -s; else exec sudo -n sh -s; fi", b"git -c safe.directory=/home/hermes/.hermes/hermes-agent -C /home/hermes/.hermes/hermes-agent describe --tags --exact-match HEAD 2>/dev/null || true\n").await?;
    let current = if releases::version(actual.trim()).is_ok() {
        actual.trim().to_owned()
    } else {
        status.installed_version.unwrap_or_default()
    };
    let latest = releases::discover(false)
        .await?
        .ok_or_else(|| AppError::new("update", "No stable Hermes release is available."))?
        .tag_name;
    Ok(HermesUpdate {
        available: releases::version(&latest)? > releases::version(&current)?,
        current_version: current,
        latest_version: latest,
    })
}

pub async fn start(session: &SshSession, server: &Server) -> Result<deployment::DeploymentStatus> {
    let status = deployment::status(session).await?;
    if status.in_progress() {
        return Err(AppError::new(
            "deploymentBusy",
            "Wait for the current server operation to finish.",
        ));
    }
    if !status.managed || status.installed_version.is_none() || !status.service_installed {
        return Err(AppError::new(
            "notInstalled",
            "Install Hermes before updating it.",
        ));
    }
    // The job resolves the stable release again, creates a private backup and uses the native updater.
    deployment::launch(
        session,
        server,
        &deployment::DeploymentSecrets::default(),
        "update",
        None,
    )
    .await
}
