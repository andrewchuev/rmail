use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/andrewchuev/rmail/releases/latest";
const RELEASE_PAGE_PREFIX: &str = "https://github.com/andrewchuev/rmail/releases/";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct LatestRelease {
    tag_name: String,
    html_url: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.trim().trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some((major, minor, patch))
}

fn newer_release(current: &str, release: LatestRelease) -> Option<UpdateInfo> {
    let current = parse_version(current)?;
    let latest = parse_version(&release.tag_name)?;
    // The URL ends up in an externally opened link, so only accept our own release pages.
    (latest > current && release.html_url.starts_with(RELEASE_PAGE_PREFIX)).then(|| UpdateInfo {
        version: release.tag_name.trim_start_matches('v').to_string(),
        url: release.html_url,
    })
}

pub fn open_release_page(url: &str) -> Result<(), String> {
    if !url.starts_with(RELEASE_PAGE_PREFIX) {
        return Err("Unsupported release page.".to_string());
    }
    open::that(url).map_err(|_| "Unable to open the system browser.".to_string())
}

pub async fn check_latest(current: &str) -> Result<Option<UpdateInfo>, String> {
    let release = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!("RMail/{current}"))
        .build()
        .map_err(|error| error.to_string())?
        .get(LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Unable to reach GitHub to check for updates.".to_string())?
        .error_for_status()
        .map_err(|_| "GitHub did not return the latest release.".to_string())?
        .json::<LatestRelease>()
        .await
        .map_err(|_| "Unexpected response while checking for updates.".to_string())?;
    Ok(newer_release(current, release))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, url: &str) -> LatestRelease {
        LatestRelease {
            tag_name: tag.to_string(),
            html_url: url.to_string(),
        }
    }

    const PAGE: &str = "https://github.com/andrewchuev/rmail/releases/tag/v0.1.25";

    #[test]
    fn reports_a_newer_release() {
        assert_eq!(
            newer_release("0.1.24", release("v0.1.25", PAGE)),
            Some(UpdateInfo {
                version: "0.1.25".to_string(),
                url: PAGE.to_string()
            })
        );
    }

    #[test]
    fn compares_numerically_not_lexically() {
        assert!(newer_release("0.1.9", release("v0.1.10", PAGE)).is_some());
        assert!(newer_release("0.9.0", release("v0.10.0", PAGE)).is_some());
    }

    #[test]
    fn ignores_same_or_older_releases() {
        assert!(newer_release("0.1.25", release("v0.1.25", PAGE)).is_none());
        assert!(newer_release("0.2.0", release("v0.1.25", PAGE)).is_none());
    }

    #[test]
    fn ignores_unparseable_versions() {
        assert!(newer_release("0.1.24", release("v0.1.25-beta", PAGE)).is_none());
        assert!(newer_release("0.1.24", release("latest", PAGE)).is_none());
    }

    #[test]
    fn refuses_to_open_pages_outside_the_project() {
        assert!(open_release_page("https://evil.example/").is_err());
        assert!(open_release_page("file:///C:/Windows/System32/calc.exe").is_err());
    }

    #[test]
    fn rejects_release_pages_outside_the_project() {
        assert!(newer_release("0.1.24", release("v0.1.25", "https://evil.example/rmail")).is_none());
    }
}
