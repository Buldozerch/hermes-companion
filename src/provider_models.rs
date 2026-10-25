//! Bounded model discovery over the existing SSH connection, without persisting probe keys.
use crate::{
    Result, SetupOptions,
    deployment::{CredentialValue, DeploymentSecrets},
    ssh::SshSession,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub models: Vec<String>,
    pub source: String,
    pub status: String,
    pub message: String,
    pub truncated: bool,
}

pub async fn discover(
    session: &SshSession,
    setup: &SetupOptions,
    secrets: &DeploymentSecrets,
) -> Result<ModelCatalog> {
    let mut checked = setup.clone();
    if checked.model.trim().is_empty() {
        checked.model = "discovery".into();
    }
    checked.validate()?;
    secrets.validate(&checked)?;
    #[derive(Serialize)]
    struct Request<'a> {
        setup: &'a SetupOptions,
        values: &'a [CredentialValue],
    }
    let input = Zeroizing::new(serde_json::to_vec(&Request {
        setup,
        values: &secrets.values,
    })?);
    let encoded = Zeroizing::new(STANDARD.encode(input.as_slice()));
    let helper = STANDARD.encode(include_bytes!("scripts/provider-models.py"));
    let catalog = STANDARD.encode(include_bytes!("../catalog/hermes-options.json"));
    let script = Zeroizing::new(format!(
        "import base64,json\nrequest=json.loads(base64.b64decode('{}'))\nhelper=base64.b64decode('{helper}').decode()\ncatalog=json.loads(base64.b64decode('{catalog}'))\n{}",
        encoded.as_str(),
        include_str!("scripts/provider-models-proxy.py")
    ));
    let result = session
        .script(
            "if [ \"$(id -u)\" -eq 0 ]; then exec python3 -; else exec sudo -n python3 -; fi",
            script.as_bytes(),
        )
        .await?;
    Ok(serde_json::from_str(result.trim())?)
}
