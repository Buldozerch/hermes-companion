//! A narrow proxy to the installed Hermes account flow over the verified SSH session.

use crate::{AppError, Result, ssh::SshSession};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize)]
pub struct AuthReply {
    pub session_id: Option<String>,
    pub flow: Option<String>,
    pub user_code: Option<String>,
    pub verification_url: Option<String>,
    pub expires_in: Option<u64>,
    pub poll_interval: Option<u64>,
    pub status: Option<String>,
    pub error: Option<String>,
}

pub async fn request(
    session: &SshSession,
    provider: &str,
    action: &str,
    id: &str,
) -> Result<AuthReply> {
    request_with_code(session, provider, action, id, "").await
}

fn validate_request(provider: &str, action: &str, id: &str, code: &str) -> Result<()> {
    if ![
        "nous",
        "openai-codex",
        "minimax-oauth",
        "xai-oauth",
        "anthropic",
        "openrouter",
        "antigravity-oauth",
    ]
    .contains(&provider)
        || !["start", "poll", "cancel", "submit"].contains(&action)
        || id.len() > 128
        || (action != "start" && id.len() < 10)
        || code.len() > 4096
        || code.chars().any(char::is_control)
        || (action == "submit"
            && (code.trim().is_empty()
                || !["anthropic", "openrouter", "antigravity-oauth"].contains(&provider)))
        || (action != "submit" && !code.is_empty())
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err(AppError::new(
            "validation",
            "Invalid provider sign-in request.",
        ));
    }
    Ok(())
}

pub async fn request_with_code(
    session: &SshSession,
    provider: &str,
    action: &str,
    id: &str,
    code: &str,
) -> Result<AuthReply> {
    validate_request(provider, action, id, code)?;
    #[derive(Serialize)]
    struct Request<'a> {
        provider: &'a str,
        action: &'a str,
        session: &'a str,
        code: &'a str,
    }
    let data = Zeroizing::new(serde_json::to_vec(&Request {
        provider,
        action,
        session: id,
        code,
    })?);
    let payload = Zeroizing::new(STANDARD.encode(&data));
    let program = STANDARD.encode(include_bytes!("scripts/provider-auth.py"));
    let cli = STANDARD.encode(include_bytes!("scripts/provider-auth-cli.py"));
    let script = Zeroizing::new(format!(
        "import base64,sys\nCLI_SOURCE=base64.b64decode('{cli}').decode()\nsys.argv=['provider-auth',base64.b64decode('{}').decode()]\nexec(compile(base64.b64decode('{program}'),'provider-auth','exec'))\n",
        payload.as_str()
    ));
    let output = session
        .script(
            "if [ \"$(id -u)\" = 0 ]; then exec python3 -; else exec sudo -n python3 -; fi",
            script.as_bytes(),
        )
        .await?;
    let reply: AuthReply = serde_json::from_str(output.trim())?;
    if let Some(error) = &reply.error {
        return Err(AppError::new("providerAuth", error));
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::validate_request;

    #[test]
    fn callback_submission_is_bound_to_manual_flow_and_a_session() {
        assert!(validate_request("anthropic", "submit", "a-valid-session", "code#state").is_ok());
        assert!(
            validate_request("openai-codex", "submit", "a-valid-session", "code#state").is_err()
        );
        assert!(validate_request("anthropic", "submit", "", "code#state").is_err());
        assert!(validate_request("anthropic", "submit", "a-valid-session", "code\nstate").is_err());
        assert!(validate_request("anthropic", "poll", "a-valid-session", "private-code").is_err());
    }
}
