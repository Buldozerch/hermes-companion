//! Bounded release discovery from the official GitHub repositories.
use crate::{AppError, Result};
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

pub fn version(tag: &str) -> Result<semver::Version> {
    semver::Version::parse(tag.trim_start_matches('v'))
        .map_err(|_| AppError::new("update", "The release version is invalid."))
}

pub async fn discover(companion: bool) -> Result<Option<Release>> {
    let endpoint = if companion {
        "https://api.github.com/repos/Buldozerch/hermes-companion/releases?per_page=30"
    } else {
        "https://api.github.com/repos/NousResearch/hermes-agent/releases/latest"
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Hermes-Companion")
        .build()
        .map_err(|_| AppError::new("update", "Could not initialize the update checker."))?;
    let mut response = client.get(endpoint).send().await.map_err(|_| {
        AppError::new(
            "update",
            "Could not check releases. Check your internet connection and retry.",
        )
    })?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(AppError::new(
            "update",
            "The release service is unavailable or rate limited. Retry later.",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::new("update", "Could not read the release response."))?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(AppError::new(
                "update",
                "The release response is too large.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let releases: Vec<Release> = if companion {
        serde_json::from_slice(&bytes)
    } else {
        serde_json::from_slice::<Release>(&bytes).map(|release| vec![release])
    }
    .map_err(|_| {
        AppError::new(
            "update",
            "The release service returned an invalid response.",
        )
    })?;
    Ok(releases
        .into_iter()
        .filter(|release| !release.draft && version(&release.tag_name).is_ok())
        .max_by_key(|release| version(&release.tag_name).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compares_release_versions_numerically() -> Result<()> {
        assert!(version("v0.1.10")? > version("0.1.9")?);
        assert!(version("v0.1.2-preview.1")? < version("v0.1.2")?);
        assert!(version("untrusted/tag").is_err());
        Ok(())
    }
}
