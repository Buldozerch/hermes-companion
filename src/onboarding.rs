//! Non-secret, per-server progress for the optional settings walkthrough.

use crate::{AppError, Result, managed_settings::SettingsSection};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingStep {
    pub job_id: String,
    pub section: SettingsSection,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingProgress {
    pub current: SettingsSection,
    pub completed: Vec<SettingsSection>,
    pub skipped: Vec<SettingsSection>,
    pub finished: bool,
    pub pending: Option<PendingStep>,
}

impl Default for OnboardingProgress {
    fn default() -> Self {
        Self {
            current: SettingsSection::Model,
            completed: Vec::new(),
            skipped: Vec::new(),
            finished: false,
            pending: None,
        }
    }
}

impl OnboardingProgress {
    pub fn validate(&self) -> Result<()> {
        let all: Vec<_> = self.completed.iter().chain(&self.skipped).collect();
        let duplicate = all
            .iter()
            .enumerate()
            .any(|(index, item)| all[..index].contains(item));
        let invalid_pending = self.pending.as_ref().is_some_and(|pending| {
            uuid::Uuid::parse_str(&pending.job_id).is_err()
                || pending.section != self.current
                || self.finished
        });
        if duplicate || all.len() > 4 || (self.finished && all.len() != 4) || invalid_pending {
            return Err(AppError::new(
                "validation",
                "Invalid settings walkthrough progress.",
            ));
        }
        Ok(())
    }
}
