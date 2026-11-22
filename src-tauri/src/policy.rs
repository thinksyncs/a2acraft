#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use std::{fs, path::Path};
use tauri::Url;

pub fn is_app_url(url: &Url, origin: &str) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && url.origin().ascii_serialization() == origin
}

pub fn trusted_external(value: &str) -> bool {
    if value.len() > 8192 {
        return false;
    }
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
            && match url.host_str() {
                Some(
                    "auth.openai.com" | "login.openai.com" | "chatgpt.com" | "auth.chatgpt.com",
                ) => true,
                Some("microsoft.com") => {
                    url.path() == "/devicelogin"
                        && url.query().is_none()
                        && url.fragment().is_none()
                }
                Some("teams.microsoft.com") => {
                    url.path().starts_with("/l/") && url.path().len() > 3
                }
                _ => false,
            }
    })
}

// Validate lexical components before examining the filesystem. Never follow a
// symlink while validating an executable, workspace or application-owned file.
pub fn permitted_location(path: &Path) -> Result<(), String> {
    use std::path::Component;
    if !path.is_absolute() {
        return Err("An absolute path is required".into());
    }
    for part in path.components() {
        if part == Component::ParentDir {
            return Err("Parent path components are not allowed".into());
        }
        if let Component::Normal(name) = part {
            let name = name.to_string_lossy().to_ascii_lowercase();
            let compact: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
            if name == ".ssh"
                || ["protonmail", "protondrive", "protonpass", "protonvpn"]
                    .iter()
                    .any(|prefix| compact.contains(prefix))
            {
                return Err("This location is protected".into());
            }
        }
    }
    let mut prefix = std::path::PathBuf::new();
    for part in path.components() {
        prefix.push(part);
        match fs::symlink_metadata(&prefix) {
            Ok(meta) if meta.is_symlink() => {
                return Err("Select a real path without symbolic links".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

pub fn executable(path: &Path) -> Result<(), String> {
    permitted_location(path)?;
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !path.is_absolute() || !metadata.is_file() {
        return Err("Codexの実行ファイルを絶対パスで指定してください。".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err("実行権限がありません。".into());
        }
    }
    #[cfg(windows)]
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("exe"))
    {
        return Err("Windowsではネイティブの.exeを指定してください。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_are_bounded_to_the_session_and_official_login() {
        assert!(is_app_url(
            &Url::parse("http://127.0.0.1:4317/?demo=1").unwrap(),
            "http://127.0.0.1:4317"
        ));
        for url in [
            "http://127.0.0.1:4318/",
            "http://localhost:4317/",
            "http://user@127.0.0.1:4317/",
        ] {
            assert!(!is_app_url(
                &Url::parse(url).unwrap(),
                "http://127.0.0.1:4317"
            ));
        }
        assert!(trusted_external("https://auth.openai.com/login"));
        for url in [
            "http://auth.openai.com/",
            "https://auth.openai.com.evil.test/",
            "https://user@auth.openai.com/",
            "https://auth.openai.com:444/",
            "file:///tmp/a",
        ] {
            assert!(!trusted_external(url));
        }
    }
    #[test]
    fn teams_links_are_bounded_to_device_login_and_official_app_paths() {
        for url in [
            "https://microsoft.com/devicelogin",
            "https://microsoft.com:443/devicelogin",
            "https://teams.microsoft.com/l/message/19%3Aexample/123?tenantId=example",
        ] {
            assert!(trusted_external(url), "{url}");
        }
        for url in [
            "https://microsoft.com/",
            "https://microsoft.com/devicelogin?next=example",
            "https://microsoft.com/devicelogin#example",
            "https://microsoft.com/devicelogin?",
            "https://microsoft.com/devicelogin#",
            "https://microsoft.com/devicelogin/",
            "https://www.microsoft.com/devicelogin",
            "https://microsoft.com.evil.test/devicelogin",
            "http://microsoft.com/devicelogin",
            "https://user:secret@microsoft.com/devicelogin",
            "https://microsoft.com:444/devicelogin",
            "https://teams.microsoft.com/",
            "https://teams.microsoft.com/l/",
            "https://teams.microsoft.com/l/../download",
            "https://teams.microsoft.com.evil.test/l/message/123",
            "https://sub.teams.microsoft.com/l/message/123",
            "https://teams.cloud.microsoft/l/message/123",
            "http://teams.microsoft.com/l/message/123",
            "https://user@teams.microsoft.com/l/message/123",
            "https://teams.microsoft.com:444/l/message/123",
        ] {
            assert!(!trusted_external(url), "{url}");
        }
    }
}

pub fn registered_project_link(value: &str, artifacts: &Value, projects: &Value) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if value.len() > 8192 || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return false;
    }
    artifacts["items"].as_array().is_some_and(|items| {
        items.iter().any(|item| {
            matches!(item["kind"].as_str(), Some("preview" | "tool"))
                && item["target"].as_str() == Some(value)
        })
    }) || (url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && projects["items"].as_array().is_some_and(|items| {
            items.iter().any(|project| {
                project["pullRequests"]
                    .as_array()
                    .is_some_and(|prs| prs.iter().any(|pr| pr["url"].as_str() == Some(value)))
            })
        }))
}

#[cfg(test)]
mod project_link_tests {
    use super::*;
    #[test]
    fn opens_only_exact_saved_artifacts_and_prs() {
        let artifacts = json!({"items":[{"kind":"preview","target":"http://127.0.0.1:5132/"}]});
        let projects =
            json!({"items":[{"pullRequests":[{"url":"https://github.com/o/r/pull/1"}]}]});
        assert!(registered_project_link(
            "http://127.0.0.1:5132/",
            &artifacts,
            &projects
        ));
        assert!(registered_project_link(
            "https://github.com/o/r/pull/1",
            &artifacts,
            &projects
        ));
        assert!(!registered_project_link(
            "https://github.com/o/r/pull/2",
            &artifacts,
            &projects
        ));
        assert!(!registered_project_link(
            "http://127.0.0.1:5132/admin",
            &artifacts,
            &projects
        ));
        for target in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://user:secret@example.com/",
        ] {
            assert!(!registered_project_link(
                target,
                &json!({"items":[{"kind":"preview","target":target}]}),
                &projects
            ));
        }
    }
}
