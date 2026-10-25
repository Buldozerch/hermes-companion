use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{AppError, Result};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDraft {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

impl ServerDraft {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() || self.name.chars().count() > 80 {
            return Err(AppError::new(
                "validation",
                "Enter a server name with no more than 80 characters.",
            ));
        }
        if self.host.is_empty()
            || self.host.len() > 253
            || !self
                .host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".:-".contains(c))
            || self.host.starts_with('-')
        {
            return Err(AppError::new(
                "validation",
                "Enter an IP address or domain without a protocol or spaces.",
            ));
        }
        if self.port == 0 {
            return Err(AppError::new(
                "validation",
                "The port must be between 1 and 65535.",
            ));
        }
        if self.username.is_empty()
            || self.username.len() > 32
            || !self
                .username
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_-".contains(c))
            || self.username.starts_with('-')
        {
            return Err(AppError::new("validation", "Check the SSH username."));
        }
        Ok(())
    }
}

/// Credentials are deliberately neither Debug nor Serialize and never enter SQLite.
#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum Credentials {
    Password {
        password: String,
    },
    Key {
        private_key: String,
        passphrase: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    #[serde(flatten)]
    pub connection: ServerDraft,
    pub report: Option<ServerReport>,
    pub setup: SetupOptions,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerReport {
    pub hostname: String,
    pub os_name: String,
    pub os_id: String,
    pub os_version: String,
    pub architecture: String,
    pub memory_mb: u64,
    pub disk_available_mb: u64,
    pub cpu_count: u32,
    pub has_systemd: bool,
    pub can_admin: bool,
    pub hermes_version: Option<String>,
    pub checked_at: u64,
}

impl ServerReport {
    pub fn supported(&self) -> bool {
        self.os_id == "ubuntu"
            && self.os_version == "24.04"
            && self.has_systemd
            && matches!(self.architecture.as_str(), "x86_64" | "aarch64")
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKey {
    pub fingerprint: String,
    pub algorithm: String,
    pub status: HostKeyStatus,
    pub previous_fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostKeyStatus {
    New,
    Trusted,
    Changed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SetupOptions {
    pub provider: String,
    #[serde(default)]
    pub defer_model_setup: bool,
    pub auth_method: String,
    pub provider_preset: String,
    pub allow_unauthenticated_model: bool,
    pub model: String,
    pub base_url: String,
    pub api_mode: String,
    pub credential_env: String,
    pub moa_config: String,
    pub channels: Vec<String>,
    pub tools: Vec<String>,
    pub tts_provider: String,
    pub tts_voice: String,
    pub stt_provider: String,
    pub search_backend: String,
    pub extract_backend: String,
    pub image_provider: String,
    pub telegram: bool,
    pub browser: bool,
    pub update_system: bool,
}

impl Default for SetupOptions {
    fn default() -> Self {
        Self {
            provider: "openrouter".into(),
            defer_model_setup: false,
            auth_method: "api_key".into(),
            provider_preset: String::new(),
            allow_unauthenticated_model: false,
            model: "anthropic/claude-sonnet-4.6".into(),
            base_url: String::new(),
            api_mode: "chat_completions".into(),
            credential_env: String::new(),
            moa_config: String::new(),
            channels: Vec::new(),
            tools: [
                "terminal",
                "file",
                "web",
                "browser",
                "code_execution",
                "vision",
                "video",
                "skills",
                "todo",
                "kanban",
                "memory",
                "context_engine",
                "session_search",
                "connections",
                "clarify",
                "delegation",
                "cronjob",
                "discord",
                "tts",
                "stt",
            ]
            .map(String::from)
            .to_vec(),
            tts_provider: "edge".into(),
            tts_voice: String::new(),
            stt_provider: "groq".into(),
            search_backend: "ddgs".into(),
            extract_backend: "builtin".into(),
            image_provider: "fal".into(),
            telegram: false,
            browser: false,
            update_system: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub server_id: Option<String>,
    pub title: String,
    pub detail: String,
    pub level: String,
    pub created_at: u64,
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}
