//! Read-only snapshots of managed Hermes configuration, with credential presence only.

use crate::{AppError, Result, Server, SetupOptions, ssh::SshSession};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SettingsSection {
    Model,
    Channels,
    Services,
    Tools,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub setup: SetupOptions,
    pub configured_credentials: Vec<String>,
    pub model_configured: bool,
    #[serde(default)]
    pub model_transport_needs_update: bool,
    #[serde(default)]
    pub authorized_providers: Vec<String>,
    #[serde(default)]
    pub prepared_providers: Vec<String>,
    pub revision: String,
    pub warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub setup: SetupOptions,
    pub sections: Vec<SettingsSection>,
    pub revision: String,
}

pub async fn read(session: &SshSession, server: &Server) -> Result<SettingsSnapshot> {
    let input = serde_json::json!({
        "action": "read", "setup": server.setup,
        "catalog": serde_json::from_str::<serde_json::Value>(include_str!("../catalog/hermes-options.json"))?,
        "helper": include_str!("scripts/configure-user.py"),
    });
    let encoded = STANDARD.encode(serde_json::to_vec(&input)?);
    let script = format!(
        "import base64,json\ndata=json.loads(base64.b64decode('{encoded}'))\n{}",
        include_str!("scripts/read-settings.py")
    );
    let result = session
        .script(
            "if [ \"$(id -u)\" -eq 0 ]; then exec python3 -; else exec sudo -n python3 -; fi",
            script.as_bytes(),
        )
        .await?;
    serde_json::from_str(result.trim()).map_err(|_| {
        AppError::new(
            "settingsRead",
            "The server returned an invalid settings snapshot.",
        )
    })
}

impl SettingsUpdate {
    pub fn merge(&self, current: &SettingsSnapshot) -> Result<SetupOptions> {
        if self.sections.is_empty() || self.sections.len() > 4 {
            return Err(AppError::new("validation", "Select settings to apply."));
        }
        if self.revision != current.revision {
            return Err(AppError::new(
                "settingsConflict",
                "The server settings changed. Reload them before applying your changes.",
            ));
        }
        let mut merged = serde_json::to_value(&current.setup)?;
        let requested = serde_json::to_value(&self.setup)?;
        for section in &self.sections {
            let fields: &[&str] = match section {
                SettingsSection::Model => &[
                    "deferModelSetup",
                    "provider",
                    "authMethod",
                    "providerPreset",
                    "model",
                    "baseUrl",
                    "apiMode",
                    "credentialEnv",
                    "allowUnauthenticatedModel",
                    "moaConfig",
                ],
                SettingsSection::Channels => &["channels", "telegram"],
                SettingsSection::Services => &[
                    "ttsProvider",
                    "ttsVoice",
                    "sttProvider",
                    "searchBackend",
                    "extractBackend",
                    "imageProvider",
                ],
                SettingsSection::Tools => &["tools", "browser"],
            };
            for field in fields {
                merged[*field] = requested[*field].clone();
            }
        }
        let merged: SetupOptions = serde_json::from_value(merged)?;
        if self.sections.contains(&SettingsSection::Model)
            && (merged.defer_model_setup || merged.model.trim().is_empty())
        {
            return Err(AppError::new(
                "validation",
                "Select a model before applying these settings.",
            ));
        }
        merged.validate()?;
        Ok(merged)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> SettingsSnapshot {
        SettingsSnapshot {
            setup: SetupOptions::default(),
            configured_credentials: vec![],
            model_configured: false,
            model_transport_needs_update: false,
            authorized_providers: vec![],
            prepared_providers: vec![],
            revision: "current-revision".into(),
            warnings: vec![],
        }
    }

    #[test]
    fn changing_the_model_cannot_overwrite_unselected_channels_or_tools() -> Result<()> {
        let current = snapshot();
        let mut requested = current.setup.clone();
        requested.model = "new-model".into();
        requested.tools.clear();
        requested.channels = vec!["telegram".into()];
        let update = SettingsUpdate {
            setup: requested,
            sections: vec![SettingsSection::Model],
            revision: current.revision.clone(),
        };
        let merged = update.merge(&current)?;
        assert_eq!(merged.model, "new-model");
        assert_eq!(merged.tools, current.setup.tools);
        assert_eq!(merged.channels, current.setup.channels);
        Ok(())
    }

    #[test]
    fn first_model_connection_clears_deferral_without_touching_tools() -> Result<()> {
        let mut current = snapshot();
        current.setup.defer_model_setup = true;
        current.setup.model.clear();
        let mut requested = current.setup.clone();
        requested.defer_model_setup = false;
        requested.provider = "deepseek".into();
        requested.model = "chosen-model".into();
        let merged = SettingsUpdate {
            setup: requested,
            sections: vec![SettingsSection::Model],
            revision: current.revision.clone(),
        }
        .merge(&current)?;
        assert!(!merged.defer_model_setup);
        assert_eq!(merged.provider, "deepseek");
        assert_eq!(merged.model, "chosen-model");
        assert_eq!(merged.tools, current.setup.tools);
        Ok(())
    }

    #[test]
    fn concurrent_server_changes_require_a_new_snapshot() {
        let current = snapshot();
        let update = SettingsUpdate {
            setup: current.setup.clone(),
            sections: vec![SettingsSection::Tools],
            revision: "stale-revision".into(),
        };
        assert!(matches!(update.merge(&current), Err(error) if error.code == "settingsConflict"));
    }

    #[test]
    fn installed_antigravity_requires_a_selected_model() {
        let current = snapshot();
        let mut setup = current.setup.clone();
        setup.provider = "antigravity-oauth".into();
        setup.auth_method = "oauth".into();
        setup.model.clear();
        assert!(setup.validate().is_ok());
        let update = SettingsUpdate {
            setup,
            sections: vec![SettingsSection::Model],
            revision: current.revision.clone(),
        };
        assert!(matches!(update.merge(&current), Err(error) if error.code == "validation"));
    }
}
