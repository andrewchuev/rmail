use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::Entry;
use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use url::Url;
use uuid::Uuid;

const CLIENT_ID: Option<&str> = option_env!("RMAIL_GOOGLE_CLIENT_ID");
const CLIENT_SECRET: Option<&str> = option_env!("RMAIL_GOOGLE_CLIENT_SECRET");
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USER_INFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const TOKEN_SERVICE: &str = "com.rmail.desktop.gmail";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub struct GoogleAuthorization {
    pub email: String,
    pub display_name: String,
    pub refresh_token: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct GoogleErrorResponse {
    error: String,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    email: String,
    name: Option<String>,
}

pub async fn authorize() -> Result<GoogleAuthorization, String> {
    let (client_id, client_secret) = oauth_client_credentials()?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| "Unable to start the local OAuth callback.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Unable to resolve the local OAuth callback.".to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = Uuid::new_v4().simple().to_string();
    let verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let challenge = pkce_challenge(&verifier);
    let mut authorization_url = Url::parse(AUTH_URL).map_err(|error| error.to_string())?;
    authorization_url
        .query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile https://mail.google.com/")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");

    open::that(authorization_url.as_str())
        .map_err(|_| "Unable to open the system browser.".to_string())?;
    let (mut stream, _) = timeout(CALLBACK_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "Google authorization timed out.".to_string())?
        .map_err(|_| "Unable to receive the Google authorization response.".to_string())?;
    let mut request = vec![0_u8; 16_384];
    let read = timeout(Duration::from_secs(10), stream.read(&mut request))
        .await
        .map_err(|_| "Google authorization response timed out.".to_string())?
        .map_err(|_| "Unable to read the Google authorization response.".to_string())?;
    let request = String::from_utf8_lossy(&request[..read]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "Invalid Google authorization response.".to_string())?;
    let callback = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "Invalid Google authorization response.".to_string())?;
    let parameters = callback
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    let response_state = parameters
        .get("state")
        .ok_or_else(|| "Google authorization state is missing.".to_string())?;
    if response_state.as_ref() != state {
        return Err("Google authorization state did not match.".to_string());
    }
    if let Some(error) = parameters.get("error") {
        return Err(format!("Google authorization failed: {error}."));
    }
    let code = parameters
        .get("code")
        .ok_or_else(|| "Google did not return an authorization code.".to_string())?;
    let client = Client::new();
    let authorization = exchange_authorization_code(
        &client,
        client_id,
        client_secret,
        code.as_ref(),
        &verifier,
        &redirect_uri,
    )
    .await;
    let response = if authorization.is_ok() {
        oauth_browser_response(
            "Google account connected",
            "Google account connected. You can return to RMail.",
        )
    } else {
        oauth_browser_response(
            "Google connection failed",
            "RMail could not connect the Google account. Return to the app for details.",
        )
    };
    let _ = stream.write_all(response.as_bytes()).await;
    authorization
}

async fn exchange_authorization_code(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<GoogleAuthorization, String> {
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|error| {
            tauri_plugin_log::log::error!("Google token exchange failed: {error}");
            format!("Unable to exchange the Google authorization code: {error}")
        })?;
    let token = google_json::<TokenResponse>(response, "authorization code").await?;
    let refresh_token = token.refresh_token.ok_or_else(|| {
        "Google did not return a refresh token. Revoke RMail access and try again.".to_string()
    })?;
    let user = client
        .get(USER_INFO_URL)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|_| "Unable to read the Google account profile.".to_string())?
        .error_for_status()
        .map_err(|_| "Google rejected the account profile request.".to_string())?
        .json::<GoogleUserInfo>()
        .await
        .map_err(|_| "Invalid Google account profile response.".to_string())?;

    Ok(GoogleAuthorization {
        display_name: user.name.unwrap_or_else(|| user.email.clone()),
        email: user.email,
        refresh_token,
    })
}

async fn google_json<T: DeserializeOwned>(
    response: reqwest::Response,
    operation: &str,
) -> Result<T, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Unable to read the Google {operation} response: {error}"))?;
    if !status.is_success() {
        let details = serde_json::from_str::<GoogleErrorResponse>(&body)
            .map(|error| {
                error
                    .error_description
                    .map(|description| format!("{}: {description}", error.error))
                    .unwrap_or(error.error)
            })
            .unwrap_or_else(|_| status.to_string());
        return Err(format!(
            "Google rejected the {operation}: {}.",
            details.trim_end_matches('.')
        ));
    }
    serde_json::from_str(&body)
        .map_err(|error| format!("Invalid Google {operation} response: {error}"))
}

fn oauth_browser_response(title: &str, message: &str) -> String {
    let body =
        format!("<!doctype html><meta charset=\"utf-8\"><title>{title}</title><p>{message}</p>");
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn oauth_client_credentials() -> Result<(&'static str, &'static str), String> {
    match (CLIENT_ID, CLIENT_SECRET) {
        (Some(client_id), Some(client_secret))
            if !client_id.is_empty() && !client_secret.is_empty() =>
        {
            Ok((client_id, client_secret))
        }
        _ => Err("Google OAuth credentials are not configured. Add them to the RMail .env file and rebuild the app.".to_string()),
    }
}

pub fn store_refresh_token(email: &str, refresh_token: &str) -> Result<(), String> {
    Entry::new(TOKEN_SERVICE, email)
        .map_err(|error| error.to_string())?
        .set_password(refresh_token)
        .map_err(|error| error.to_string())
}

pub fn delete_refresh_token(email: &str) -> Result<(), String> {
    let entry = Entry::new(TOKEN_SERVICE, email).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub async fn access_token(email: &str) -> Result<String, String> {
    let (client_id, client_secret) = oauth_client_credentials()?;
    let refresh_token = Entry::new(TOKEN_SERVICE, email)
        .map_err(|error| error.to_string())?
        .get_password()
        .map_err(|_| "Google authorization is unavailable. Reconnect the account.".to_string())?;
    Client::new()
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|error| {
            tauri_plugin_log::log::error!("Google authorization refresh failed: {error}");
            "Unable to refresh Google authorization.".to_string()
        })?
        .error_for_status()
        .map_err(|_| "Google authorization expired. Reconnect the account.".to_string())?
        .json::<TokenResponse>()
        .await
        .map(|token| token.access_token)
        .map_err(|_| "Invalid token response from Google.".to_string())
}

#[cfg(test)]
mod tests {
    use super::pkce_challenge;

    #[test]
    fn creates_rfc_7636_s256_challenge() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
