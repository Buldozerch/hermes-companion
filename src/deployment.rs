//! Durable installation jobs executed by systemd on the remote server.

use crate::managed_settings::{self, SettingsSection, SettingsUpdate};
use crate::{AppError, Result, Server, SetupOptions, plan::deployment_plan, ssh::SshSession};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const ROOT_SHELL: &str = "if [ \"$(id -u)\" -eq 0 ]; then exec sh -s; else exec sudo -n sh -s; fi";

#[derive(Default, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentSecrets {
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub telegram_token: String,
    #[serde(default)]
    pub telegram_allowed_users: String,
    #[serde(default)]
    pub values: Vec<CredentialValue>,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct CredentialValue {
    pub name: String,
    pub value: String,
}

impl DeploymentSecrets {
    pub(crate) fn validate(&self, _setup: &SetupOptions) -> Result<()> {
        if [
            &self.api_key,
            &self.telegram_token,
            &self.telegram_allowed_users,
        ]
        .iter()
        .any(|value| value.len() > 4096 || value.contains(['\n', '\r', '\0', '\'']))
        {
            return Err(AppError::new(
                "validation",
                "Secret fields must be a single line with no apostrophes and no more than 4096 characters.",
            ));
        }
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../catalog/hermes-options.json"))?;
        let mut allowed = std::collections::HashSet::new();
        for provider in catalog["providers"].as_array().into_iter().flatten() {
            for key in provider["keyVars"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(serde_json::Value::as_str)
            {
                allowed.insert(key);
            }
        }
        for channel in catalog["channels"].as_array().into_iter().flatten() {
            for field in channel["fields"].as_array().into_iter().flatten() {
                if let Some(name) = field["name"].as_str() {
                    allowed.insert(name);
                }
            }
        }
        allowed.extend([
            "COMPANION_CUSTOM_API_KEY",
            "TOGETHER_API_KEY",
            "BRAVE_SEARCH_API_KEY",
            "REPLICATE_API_TOKEN",
            "COPILOT_GITHUB_TOKEN",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "AWS_REGION",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_SERVICE_ACCOUNT_JSON",
            "QWEN_AUTH_JSON",
            "FIRECRAWL_API_KEY",
            "EXA_API_KEY",
            "FAL_KEY",
            "BRAVE_API_KEY",
            "XAI_API_KEY",
            "GROQ_API_KEY",
            "ELEVENLABS_API_KEY",
            "VOICE_TOOLS_OPENAI_KEY",
            "GEMINI_API_KEY",
            "MISTRAL_API_KEY",
            "DEEPINFRA_API_KEY",
        ]);
        if self.values.len() > 512
            || self
                .values
                .iter()
                .map(|item| item.value.len())
                .sum::<usize>()
                > 256 * 1024
            || self.values.iter().any(|item| {
                !allowed.contains(item.name.as_str())
                    || item.value.contains('\0')
                    || item.value.len() > 65536
                    || (!item.name.ends_with("_JSON") && item.value.contains(['\n', '\r']))
            })
        {
            return Err(AppError::new(
                "validation",
                "One of the credential fields is invalid or exceeds the size limit.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    None,
    Starting,
    Running,
    Succeeded,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStatus {
    pub job_id: Option<String>,
    pub state: JobState,
    pub operation: String,
    pub step: String,
    pub version: Option<String>,
    pub installed_version: Option<String>,
    pub managed: bool,
    pub service_active: bool,
    pub service_installed: bool,
    pub api_healthy: bool,
    pub model_configured: bool,
    pub reboot_required: bool,
    pub started_at: Option<u64>,
    pub updated_at: Option<u64>,
    pub checked_at: Option<u64>,
    pub output_updated_at: Option<u64>,
    pub events: Vec<String>,
}

impl DeploymentStatus {
    pub fn in_progress(&self) -> bool {
        matches!(self.state, JobState::Starting | JobState::Running)
    }
}

pub fn parse_status(output: &str) -> Result<DeploymentStatus> {
    let (fields, events) = output.split_once("__EVENTS__\n").unwrap_or((output, ""));
    let values: HashMap<_, _> = fields
        .lines()
        .filter_map(|line| line.split_once('='))
        .collect();
    let state = match values.get("state").copied() {
        Some("none") => JobState::None,
        Some("starting") => JobState::Starting,
        Some("running") => JobState::Running,
        Some("succeeded") => JobState::Succeeded,
        Some("failed") => JobState::Failed,
        Some("interrupted") => JobState::Interrupted,
        _ => {
            return Err(AppError::new(
                "deployment",
                "The server returned an invalid installation status.",
            ));
        }
    };
    let optional = |key| {
        values
            .get(key)
            .filter(|value| !value.is_empty())
            .map(|value| (*value).to_owned())
    };
    let yes = |key| values.get(key) == Some(&"yes");
    let timestamp = |key| values.get(key).and_then(|value| value.parse::<u64>().ok());
    Ok(DeploymentStatus {
        job_id: optional("job_id"),
        state,
        operation: optional("operation").unwrap_or_else(|| "install".into()),
        step: optional("step").unwrap_or_default(),
        version: optional("version"),
        installed_version: optional("installed_version"),
        managed: yes("managed"),
        service_active: yes("service_active"),
        service_installed: yes("service_installed"),
        api_healthy: yes("api_healthy"),
        model_configured: yes("model_configured"),
        reboot_required: yes("reboot_required"),
        started_at: timestamp("started_at"),
        updated_at: timestamp("updated_at"),
        checked_at: timestamp("checked_at"),
        output_updated_at: timestamp("output_updated_at"),
        events: events.lines().take(80).map(str::to_owned).collect(),
    })
}

pub async fn status(session: &SshSession) -> Result<DeploymentStatus> {
    // Probe with the current adapter, including when reading an older remote job.
    let script = format!(
        "check_api() {{\npython3 - <<'HERMES_HEALTH'\n{}\nHERMES_HEALTH\n}}\n{}",
        include_str!("scripts/deploy-health.py"),
        include_str!("scripts/deploy-status.sh")
    );
    parse_status(&session.script(ROOT_SHELL, script.as_bytes()).await?)
}

pub async fn logs(session: &SshSession) -> Result<String> {
    session
        .script(
            "if [ \"$(id -u)\" -eq 0 ]; then exec python3 -; else exec sudo -n python3 -; fi",
            include_bytes!("scripts/deploy-logs.py"),
        )
        .await
}

fn upload(script: &mut String, name: &str, content: &[u8]) {
    // File names are static application constants; data is always base64 encoded.
    let encoded = Zeroizing::new(STANDARD.encode(content));
    script.push_str("printf '%s' '");
    script.push_str(&encoded);
    script.push_str(&format!("' | base64 -d > '{name}'\n"));
}

pub async fn start(
    session: &SshSession,
    server: &Server,
    _secrets: &DeploymentSecrets,
) -> Result<DeploymentStatus> {
    let previous = status(session).await?;
    if previous.in_progress() {
        return Err(AppError::new(
            "deploymentBusy",
            "An installation is already running on this server.",
        ));
    }
    if (previous.managed && previous.installed_version.is_some())
        || previous.state == JobState::Succeeded
    {
        return Err(AppError::new(
            "alreadyInstalled",
            "Hermes is already installed. Use the service controls to manage it.",
        ));
    }
    let mut fresh = server.clone();
    // Installation never consumes integration drafts or credentials from older clients.
    fresh.setup = SetupOptions::clean_install(server.setup.update_system);
    fresh.report = Some(session.inspect().await?);
    if previous.managed
        && let Some(report) = &mut fresh.report
    {
        report.hermes_version = None;
    }
    let plan = deployment_plan(&fresh);
    if !plan.ready {
        return Err(AppError::new("preflight", plan.blockers.join(" ")));
    }
    launch(
        session,
        &fresh,
        &DeploymentSecrets::default(),
        "install",
        None,
    )
    .await
}

pub async fn apply_settings(
    session: &SshSession,
    server: &Server,
    secrets: &DeploymentSecrets,
) -> Result<DeploymentStatus> {
    server.setup.validate()?;
    secrets.validate(&server.setup)?;
    let previous = status(session).await?;
    if previous.in_progress() {
        return Err(AppError::new(
            "deploymentBusy",
            "Wait for the current server operation to finish.",
        ));
    }
    if !previous.managed || previous.installed_version.is_none() || !previous.service_installed {
        return Err(AppError::new(
            "notInstalled",
            "Install Hermes before applying server settings.",
        ));
    }
    launch(session, server, secrets, "configure", None).await
}

pub async fn apply_managed_settings(
    session: &SshSession,
    server: &Server,
    update: &SettingsUpdate,
    secrets: &DeploymentSecrets,
) -> Result<DeploymentStatus> {
    let previous = status(session).await?;
    if previous.in_progress() {
        return Err(AppError::new(
            "deploymentBusy",
            "Wait for the current server operation to finish.",
        ));
    }
    if !previous.managed || previous.installed_version.is_none() || !previous.service_installed {
        return Err(AppError::new(
            "notInstalled",
            "Install Hermes before applying server settings.",
        ));
    }
    let snapshot = managed_settings::read(session, server).await?;
    let mut current = server.clone();
    current.setup = update.merge(&snapshot)?;
    secrets.validate(&current.setup)?;
    launch(
        session,
        &current,
        secrets,
        "configure",
        Some((&update.sections, &update.revision)),
    )
    .await
}

pub async fn prepare_provider(
    session: &SshSession,
    server: &Server,
    provider: &str,
) -> Result<DeploymentStatus> {
    if provider != "antigravity-oauth" {
        return Err(AppError::new(
            "validation",
            "Select a supported optional provider.",
        ));
    }
    let previous = status(session).await?;
    if previous.in_progress() {
        return Err(AppError::new(
            "deploymentBusy",
            "Wait for the current server operation to finish.",
        ));
    }
    if !previous.managed || previous.installed_version.is_none() {
        return Err(AppError::new(
            "notInstalled",
            "Install Hermes before preparing an optional provider.",
        ));
    }
    launch(
        session,
        server,
        &DeploymentSecrets::default(),
        "provider",
        None,
    )
    .await
}

pub(crate) async fn launch(
    session: &SshSession,
    server: &Server,
    secrets: &DeploymentSecrets,
    operation: &str,
    scope: Option<(&[SettingsSection], &str)>,
) -> Result<DeploymentStatus> {
    let id = Uuid::new_v4().to_string();
    let mut script = Zeroizing::new(format!(
        "set -eu\numask 077\nROOT=/var/lib/hermes-companion\ninstall -d -m 700 \"$ROOT\" \"$ROOT/jobs\"\nexec 8>\"$ROOT/launch.lock\"\nflock -n 8 || exit 20\nif systemctl is-active --quiet hermes-companion-install.service || systemctl is-active --quiet hermes-companion-reboot.timer; then exit 20; fi\nmkdir \"$ROOT/jobs/{id}\"\ncd \"$ROOT/jobs/{id}\"\ntrap 'rm -f input.json' EXIT\n"
    ));
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SecretPayload<'a> {
        api_key: &'a str,
        telegram_token: &'a str,
        telegram_allowed_users: &'a str,
        values: &'a [CredentialValue],
    }
    #[derive(Serialize)]
    struct Payload<'a> {
        setup: &'a SetupOptions,
        secrets: SecretPayload<'a>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sections: Option<&'a [SettingsSection]>,
        #[serde(rename = "expectedRevision", skip_serializing_if = "Option::is_none")]
        expected_revision: Option<&'a str>,
    }
    let payload = Zeroizing::new(serde_json::to_vec(&Payload {
        setup: &server.setup,
        sections: scope.map(|value| value.0),
        expected_revision: scope.map(|value| value.1),
        secrets: SecretPayload {
            api_key: &secrets.api_key,
            telegram_token: &secrets.telegram_token,
            telegram_allowed_users: &secrets.telegram_allowed_users,
            values: &secrets.values,
        },
    })?);
    upload(&mut script, "input.json", &payload);
    upload(&mut script, "operation", operation.as_bytes());
    upload(
        &mut script,
        "prepare-provider.py",
        include_bytes!("scripts/prepare-provider.py"),
    );
    upload(
        &mut script,
        "catalog.json",
        include_bytes!("../catalog/hermes-options.json"),
    );
    upload(
        &mut script,
        "run.sh",
        include_bytes!("scripts/deploy-runner.sh"),
    );
    upload(
        &mut script,
        "configure.py",
        include_bytes!("scripts/deploy-configure.py"),
    );
    upload(
        &mut script,
        "configure-user.py",
        include_bytes!("scripts/configure-user.py"),
    );
    upload(
        &mut script,
        "parser-plugin.py",
        include_bytes!("scripts/parser-plugin.py"),
    );
    upload(
        &mut script,
        "replicate-plugin.py",
        include_bytes!("scripts/replicate-plugin.py"),
    );
    upload(
        &mut script,
        "health.py",
        include_bytes!("scripts/deploy-health.py"),
    );
    upload(
        &mut script,
        "update-system",
        if server.setup.update_system {
            b"yes"
        } else {
            b"no"
        },
    );
    upload(
        &mut script,
        "browser",
        if server.setup.browser { b"yes" } else { b"no" },
    );
    upload(
        &mut script,
        "computer-use",
        if server.setup.tools.iter().any(|tool| tool == "computer_use") {
            b"yes"
        } else {
            b"no"
        },
    );
    script.push_str(&format!("printf 'state=starting\\nstep=system\\n' > state\nprintf '%s\\n' '{id}' > \"$ROOT/latest-job.tmp\"\nsystemd-run --quiet --collect --unit=hermes-companion-install --property=Type=exec /bin/bash \"$PWD/run.sh\"\nmv \"$ROOT/latest-job.tmp\" \"$ROOT/latest-job\"\ntrap - EXIT\nprintf 'started\\n'\n"));
    session.script(ROOT_SHELL, script.as_bytes()).await?;
    status(session).await
}

pub async fn service_action(session: &SshSession, action: &str) -> Result<DeploymentStatus> {
    let command = match action {
        "start" => "systemctl start --no-block hermes-companion-agent.service",
        "stop" => "systemctl stop --no-block hermes-companion-agent.service",
        "restart" => "systemctl restart --no-block hermes-companion-agent.service",
        _ => {
            return Err(AppError::new(
                "validation",
                "Unknown Hermes service action.",
            ));
        }
    };
    let previous = status(session).await?;
    if !previous.managed || !previous.service_installed || previous.in_progress() {
        return Err(AppError::new(
            "deploymentBusy",
            "Finish installation before managing the Hermes service.",
        ));
    }
    session.script(ROOT_SHELL, command.as_bytes()).await?;
    status(session).await
}

pub async fn reboot_server(session: &SshSession) -> Result<()> {
    let response = session.script(ROOT_SHELL, include_bytes!("scripts/reboot-server.sh")).await.map_err(|error| {
        if error.code == "remoteCommand" {
            AppError::new("reboot", "Could not schedule the server reboot. Check root or passwordless sudo access and systemd.")
        } else { error }
    })?;
    match response.trim() {
        "reboot_scheduled" => Ok(()),
        "busy" => Err(AppError::new(
            "deploymentBusy",
            "Wait for the current installation or update to finish before rebooting the server.",
        )),
        _ => Err(AppError::new(
            "reboot",
            "Could not schedule the server reboot. Check root or passwordless sudo access and systemd.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clean_installation_does_not_select_any_keyed_connections() -> Result<()> {
        let setup = SetupOptions::clean_install(false);
        setup.validate()?;
        assert!(setup.defer_model_setup && setup.model.is_empty());
        assert!(setup.channels.is_empty() && !setup.telegram);
        assert!(!setup.tools.iter().any(|tool| tool == "stt"));
        assert!(setup.tools.iter().any(|tool| tool == "terminal"));
        assert!(setup.tools.iter().any(|tool| tool == "browser"));
        assert!(!setup.update_system);
        Ok(())
    }
    #[test]
    fn duplicate_state_records_report_interruption() -> Result<()> {
        let value = parse_status(
            "state=running\nstep=install\nstate=interrupted\n__EVENTS__\nConnection interrupted\n",
        )?;
        assert_eq!(value.state, JobState::Interrupted);
        Ok(())
    }
    #[test]
    fn log_content_cannot_override_job_metadata() -> Result<()> {
        let value = parse_status("state=failed\n__EVENTS__\nstate=succeeded\n")?;
        assert_eq!(value.state, JobState::Failed);
        Ok(())
    }
    #[test]
    fn progress_timestamps_are_optional_and_cannot_be_overridden_by_logs() -> Result<()> {
        let value = parse_status(
            "state=running\nstarted_at=100\nupdated_at=120\nchecked_at=180\noutput_updated_at=150\n__EVENTS__\nstarted_at=0\n",
        )?;
        assert_eq!(value.started_at, Some(100));
        assert_eq!(value.updated_at, Some(120));
        assert_eq!(value.checked_at, Some(180));
        assert_eq!(value.output_updated_at, Some(150));
        let legacy = parse_status("state=running\nstarted_at=invalid\n")?;
        assert_eq!(legacy.started_at, None);
        assert_eq!(legacy.checked_at, None);
        Ok(())
    }
    #[test]
    fn unknown_environment_variables_cannot_be_sent_as_credentials() {
        let setup = SetupOptions {
            telegram: true,
            ..Default::default()
        };
        let mut secrets = DeploymentSecrets::default();
        secrets.values.push(CredentialValue {
            name: "LD_PRELOAD".into(),
            value: "/tmp/untrusted.so".into(),
        });
        assert!(secrets.validate(&setup).is_err());
    }
}
