//! Shared setup catalog and validation for model, channel and tool choices.

use crate::{AppError, Result, SetupOptions};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOption {
    pub id: String,
    pub name: String,
    pub auth_type: String,
    pub key_vars: Vec<String>,
}
#[derive(Deserialize, Serialize)]
pub struct NamedOption {
    pub id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionsCatalog {
    pub providers: Vec<ProviderOption>,
    #[serde(default)]
    pub additional_providers: Vec<ProviderOption>,
    pub channels: Vec<NamedOption>,
    pub tools: Vec<NamedOption>,
    pub tts_providers: Vec<NamedOption>,
    pub stt_providers: Vec<NamedOption>,
}

pub fn catalog() -> Result<&'static OptionsCatalog> {
    static CATALOG: OnceLock<std::result::Result<OptionsCatalog, serde_json::Error>> =
        OnceLock::new();
    CATALOG
        .get_or_init(|| {
            let mut catalog: OptionsCatalog =
                serde_json::from_str(include_str!("../catalog/hermes-options.json"))?;
            catalog.providers.append(&mut catalog.additional_providers);
            Ok(catalog)
        })
        .as_ref()
        .map_err(|_| AppError::new("catalog", "The setup catalog could not be loaded."))
}

impl SetupOptions {
    pub fn normalize_legacy(&mut self) {
        if self.provider == "openai" {
            self.provider = "openai-api".into();
        }
        if self.telegram && !self.channels.iter().any(|channel| channel == "telegram") {
            self.channels.push("telegram".into());
        }
        if self.browser && !self.tools.iter().any(|tool| tool == "browser") {
            self.tools.push("browser".into());
        }
    }

    pub fn validate(&self) -> Result<()> {
        let catalog = catalog()?;
        if !["api_key", "oauth"].contains(&self.auth_method.as_str())
            || (self.auth_method == "oauth"
                && ![
                    "anthropic",
                    "openrouter",
                    "openai-codex",
                    "nous",
                    "minimax-oauth",
                    "xai-oauth",
                    "qwen-oauth",
                    "antigravity-oauth",
                ]
                .contains(&self.provider.as_str()))
        {
            return Err(AppError::new(
                "validation",
                "Select an authentication method supported by this provider.",
            ));
        }
        if !["", "groq", "mistral", "together", "ollama"].contains(&self.provider_preset.as_str())
            || (!self.provider_preset.is_empty() && self.provider != "custom")
        {
            return Err(AppError::new(
                "validation",
                "Select a supported compatible-provider preset.",
            ));
        }
        if !["ddgs", "brave-free"].contains(&self.search_backend.as_str())
            || !["builtin", "firecrawl"].contains(&self.extract_backend.as_str())
            || !["fal", "replicate", "openai"].contains(&self.image_provider.as_str())
        {
            return Err(AppError::new(
                "validation",
                "Select supported search, page extraction and image providers.",
            ));
        }
        if !self.credential_env.is_empty()
            && !catalog.providers.iter().any(|provider| {
                provider.id == self.provider && provider.key_vars.contains(&self.credential_env)
            })
        {
            return Err(AppError::new(
                "validation",
                "Select a credential type supported by this provider.",
            ));
        }
        if self.moa_config.len() > 32768 {
            return Err(AppError::new(
                "validation",
                "The Mixture of Agents configuration is too large.",
            ));
        }
        if !self.moa_config.is_empty() {
            let document: serde_json::Value =
                serde_json::from_str(&self.moa_config).map_err(|_| {
                    AppError::new("validation", "Invalid Mixture of Agents configuration.")
                })?;
            let slot_valid = |slot: &serde_json::Value| {
                slot.as_object().is_some_and(|object| {
                    object
                        .keys()
                        .all(|key| ["provider", "model", "enabled"].contains(&key.as_str()))
                        && slot["provider"].as_str().is_some_and(|id| {
                            id != "moa"
                                && catalog.providers.iter().any(|provider| provider.id == id)
                        })
                        && slot["model"]
                            .as_str()
                            .is_some_and(|model| !model.trim().is_empty() && model.len() <= 200)
                })
            };
            if !document.as_object().is_some_and(|object| {
                object
                    .keys()
                    .all(|key| ["aggregator", "reference_models"].contains(&key.as_str()))
            }) || !slot_valid(&document["aggregator"])
                || !document["reference_models"]
                    .as_array()
                    .is_some_and(|slots| {
                        !slots.is_empty() && slots.len() <= 6 && slots.iter().all(slot_valid)
                    })
            {
                return Err(AppError::new(
                    "validation",
                    "Choose an aggregator and one to six reference models. Credentials must use the dedicated secret fields.",
                ));
            }
        }
        if !self.defer_model_setup && self.provider == "moa" && self.moa_config.is_empty() {
            return Err(AppError::new(
                "validation",
                "Configure Mixture of Agents reference models and an aggregator.",
            ));
        }
        if (self.model.trim().is_empty()
            && self.provider != "antigravity-oauth"
            && !self.defer_model_setup)
            || self.model.len() > 200
            || !catalog
                .providers
                .iter()
                .any(|provider| provider.id == self.provider)
        {
            return Err(AppError::new(
                "validation",
                "Select a provider and enter a model.",
            ));
        }
        if !self.defer_model_setup && self.provider == "custom" && self.base_url.is_empty() {
            return Err(AppError::new(
                "validation",
                "Enter the base URL of your custom provider.",
            ));
        }
        if !self.base_url.is_empty() {
            let url = url::Url::parse(&self.base_url).map_err(|_| {
                AppError::new("validation", "Enter a valid HTTP or HTTPS API base URL.")
            })?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || self.base_url.len() > 2048
            {
                return Err(AppError::new(
                    "validation",
                    "Use an HTTP or HTTPS base URL without credentials, query parameters or fragments.",
                ));
            }
        }
        if ![
            "chat_completions",
            "codex_responses",
            "anthropic_messages",
            "bedrock_converse",
        ]
        .contains(&self.api_mode.as_str())
        {
            return Err(AppError::new(
                "validation",
                "Select a supported API protocol.",
            ));
        }
        for (selected, available) in [
            (&self.channels, &catalog.channels),
            (&self.tools, &catalog.tools),
        ] {
            if selected.len() > available.len()
                || selected
                    .iter()
                    .any(|id| !available.iter().any(|option| option.id == *id))
            {
                return Err(AppError::new(
                    "validation",
                    "One of the selected channels or tools is not in the Hermes catalog.",
                ));
            }
        }
        if !catalog
            .tts_providers
            .iter()
            .any(|provider| provider.id == self.tts_provider)
            || !catalog
                .stt_providers
                .iter()
                .any(|provider| provider.id == self.stt_provider)
            || self.tts_voice.len() > 200
        {
            return Err(AppError::new(
                "validation",
                "Select supported voice providers and a valid voice name.",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_openai_selection_is_not_routed_to_the_upstream_openrouter_alias() {
        let mut setup = SetupOptions {
            provider: "openai".into(),
            ..Default::default()
        };
        setup.normalize_legacy();
        assert_eq!(setup.provider, "openai-api");
    }
    #[test]
    fn custom_endpoint_accepts_a_server_local_openai_compatible_api() -> Result<()> {
        SetupOptions {
            provider: "custom".into(),
            base_url: "http://127.0.0.1:11434/v1".into(),
            model: "test-model".into(),
            ..Default::default()
        }
        .validate()
    }
    #[test]
    fn secrets_cannot_be_embedded_in_a_persisted_base_url() {
        assert!(
            SetupOptions {
                provider: "custom".into(),
                base_url: "https://user:password@example.com/v1".into(),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
}
