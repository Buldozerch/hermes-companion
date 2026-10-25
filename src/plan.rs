use crate::{AppError, Result, Server};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPlan {
    pub ready: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
    pub steps: Vec<PlanStep>,
}

pub fn deployment_plan(server: &Server) -> DeploymentPlan {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    match &server.report {
        None => blockers.push("Connect to the server and run diagnostics first.".into()),
        Some(report) => {
            if let Err(error) = require_fresh_report(server) {
                blockers.push(error.message);
            }
            if !report.supported() {
                blockers
                    .push("This installer version supports Ubuntu 24.04 LTS with systemd.".into());
            }
            if !report.can_admin {
                blockers.push("Installation requires root access or passwordless sudo.".into());
            }
            if report.memory_mb < 1800 {
                warnings.push("Less than 2 GB of RAM is available. The source build may use 1 GB of temporary swap; browser tools may be limited.".into());
            }
            if report.disk_available_mb < 8000 {
                warnings.push(
                    "Less than 8 GB of disk space is available. Installation may run out of space."
                        .into(),
                );
            }
            if report.disk_available_mb < 1024 {
                blockers.push(
                    "Free at least 1 GB on the system disk before starting installation.".into(),
                );
            }
            if report.hermes_version.is_some() {
                blockers.push("An existing Hermes installation was detected. Automatic reinstallation is disabled.".into());
            }
        }
    }
    let mut steps = Vec::new();
    if server.setup.update_system {
        steps.push(PlanStep {id:"system",title:"Update the system",description:"Update packages within the current Ubuntu release. Rebooting is a separate operation."});
    }
    steps.extend([
        PlanStep {id:"user",title:"Create the Hermes user",description:"The agent will run under a dedicated user without administrator privileges."},
        PlanStep {id:"install",title:"Install Hermes Agent",description:"Use the official installer and stable release channel."},
        PlanStep {id:"configure",title:"Prepare clean configuration",description:"Start Hermes without model keys or messenger tokens. Connect them after installation."},
        PlanStep {id:"service",title:"Configure continuous operation",description:"Create an automatically started service and check its health."},
    ]);
    DeploymentPlan {
        ready: blockers.is_empty(),
        blockers,
        warnings,
        steps,
    }
}

pub fn require_fresh_report(server: &Server) -> Result<()> {
    let report = server
        .report
        .as_ref()
        .ok_or_else(|| AppError::new("preflight", "Check the server connection first."))?;
    if crate::models::now().saturating_sub(report.checked_at) > 15 * 60 {
        return Err(AppError::new(
            "preflight",
            "Server diagnostics are out of date. Reconnect before installation.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ServerDraft, ServerReport, SetupOptions, models::now};

    fn compatible_server() -> Server {
        Server {
            id: "test".into(),
            connection: ServerDraft {
                name: "Test".into(),
                host: "example.com".into(),
                port: 22,
                username: "root".into(),
            },
            report: Some(ServerReport {
                hostname: "vps".into(),
                os_name: "Ubuntu 24.04 LTS".into(),
                os_id: "ubuntu".into(),
                os_version: "24.04".into(),
                architecture: "x86_64".into(),
                memory_mb: 4096,
                disk_available_mb: 16000,
                cpu_count: 2,
                has_systemd: true,
                can_admin: true,
                hermes_version: None,
                checked_at: now(),
            }),
            setup: SetupOptions::default(),
        }
    }

    #[test]
    fn stale_diagnostics_cannot_authorize_a_deployment() {
        let mut server = compatible_server();
        if let Some(report) = &mut server.report {
            report.checked_at = now().saturating_sub(901);
        }
        assert!(!deployment_plan(&server).ready);
    }

    #[test]
    fn existing_hermes_is_protected_from_reinstallation() {
        let mut server = compatible_server();
        if let Some(report) = &mut server.report {
            report.hermes_version = Some("existing".into());
        }
        assert!(!deployment_plan(&server).ready);
    }

    #[test]
    fn missing_admin_rights_block_the_plan() {
        let mut server = compatible_server();
        if let Some(report) = &mut server.report {
            report.can_admin = false;
        }
        assert!(!deployment_plan(&server).ready);
    }

    #[test]
    fn small_servers_receive_recommendations_without_an_arbitrary_ram_block() {
        let mut server = compatible_server();
        if let Some(report) = server.report.as_mut() {
            report.memory_mb = 961;
            report.disk_available_mb = 6000;
        }
        let plan = deployment_plan(&server);
        assert!(plan.ready);
        assert_eq!(plan.warnings.len(), 2);
    }

    #[test]
    fn critical_disk_shortage_blocks_installation() {
        let mut server = compatible_server();
        if let Some(report) = server.report.as_mut() {
            report.disk_available_mb = 500;
        }
        assert!(!deployment_plan(&server).ready);
    }
}
