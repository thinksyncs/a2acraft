use crate::policy;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

type Replies = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

fn startup_error(code: Option<&str>) -> String {
    let label = match code {
        Some("EACCES" | "EPERM") => "起動に必要なファイルへのアクセスが拒否されました。",
        Some("ENOENT" | "ERR_MODULE_NOT_FOUND") => "起動に必要なファイルが見つかりません。",
        Some("ERR_DLOPEN_FAILED") => "同梱のネイティブモジュールを読み込めません。",
        Some("ERR_UNKNOWN_FILE_EXTENSION" | "ERR_PACKAGE_PATH_NOT_EXPORTED") => {
            "同梱のモジュールを読み込めません。"
        }
        _ => return "GUIサーバーを初期化できませんでした。".into(),
    };
    format!("{label} ({})", code.unwrap_or_default())
}

pub struct Backend {
    child: Mutex<Option<Child>>,
    next: AtomicU64,
    replies: Replies,
}
impl Drop for Backend {
    fn drop(&mut self) {
        if let Some(mut child) = self
            .child
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Backend {
    pub fn request(&self, action: &str, value: Value) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (send, receive) = mpsc::channel();
        self.replies
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, send);
        let result = (|| {
            {
                let mut child = self.child.lock().map_err(|e| e.to_string())?;
                let pipe = child
                    .as_mut()
                    .and_then(|c| c.stdin.as_mut())
                    .ok_or("GUIサーバーは終了しました。")?;
                writeln!(pipe, "{}", json!({"id":id,"action":action,"value":value}))
                    .map_err(|e| e.to_string())?;
                pipe.flush().map_err(|e| e.to_string())?;
            }
            receive
                .recv_timeout(Duration::from_secs(15))
                .map_err(|_| "GUIサーバーから応答がありません。".to_string())?
        })();
        self.replies.lock().map_err(|e| e.to_string())?.remove(&id);
        result
    }
}

pub fn start(
    app: &tauri::AppHandle,
    data_dir: &Path,
    settings: &Value,
    practice: bool,
    demo: bool,
) -> Result<(Backend, String, String), Box<dyn std::error::Error>> {
    let root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/backend")
    } else {
        app.path().resource_dir()?.join("backend")
    };
    // Preserve the Node distributor's signature and V8 JIT entitlements on macOS.
    let node = root
        .join("runtime")
        .join(format!("chat-ui-node{}", std::env::consts::EXE_SUFFIX));
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let token = random
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let mut command = Command::new(node);
    command
        .arg(root.join("tauri-sidecar.mjs"))
        .current_dir(data_dir)
        .env("PORT", "0")
        .env("CHAT_UI_DESKTOP", "1")
        .env("CHAT_UI_READY_STDOUT", "1")
        .env("CHAT_UI_PACKAGE_ROOT", &root)
        .env("CHAT_UI_SESSION_TOKEN", &token)
        .env("CHAT_UI_DATA_DIR", data_dir.join("data"))
        .env("CHAT_UI_PRACTICE", if practice { "1" } else { "0" })
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_API_KEY")
        .env_remove("ELECTRON_RUN_AS_NODE")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("CODEX_BIN")
        .env_remove("CHAT_UI_GH_BIN")
        .env_remove("CHAT_UI_WORKSPACE_DIR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if demo {
        command.arg("--demo").env_remove("CODEX_BIN");
    } else {
        let configured = settings["codexPath"].as_str().map(PathBuf::from);
        // Ordinary releases always use a saved user choice or the packaged CLI.
        #[cfg(debug_assertions)]
        let configured = configured.or_else(|| {
            std::env::var_os("CHAT_UI_TAURI_TEST_DIR")?;
            std::env::var_os("CODEX_BIN").map(PathBuf::from)
        });
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let configured = Some(configured.unwrap_or_else(|| {
            root.join(
                "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
            )
        }));
        if let Some(codex) = configured {
            policy::executable(&codex)?;
            command.env("CODEX_BIN", codex);
        }
        if let Some(work) = settings["workDirectory"].as_str() {
            policy::permitted_location(Path::new(work))?;
            command.env("CHAT_UI_WORKSPACE_DIR", work);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Missing backend stdout")?;
    let replies: Replies = Default::default();
    let backend = Backend {
        child: Mutex::new(Some(child)),
        next: AtomicU64::new(1),
        replies: replies.clone(),
    };
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match message["type"].as_str() {
                Some("ready") => {
                    let _ = send.send(Ok(message));
                }
                Some("startup-error") => {
                    let _ = send.send(Err(startup_error(message["code"].as_str())));
                }
                Some("desktop-response") => {
                    if let Some(id) = message["id"].as_u64() {
                        if let Some(tx) = replies
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .remove(&id)
                        {
                            let result = match message["error"].as_str() {
                                Some(e) => Err(e.to_string()),
                                None => Ok(message["result"].clone()),
                            };
                            let _ = tx.send(result);
                        }
                    }
                }
                _ => {}
            }
        }
        replies.lock().unwrap_or_else(|e| e.into_inner()).clear();
    });
    let ready = receive
        .recv_timeout(Duration::from_secs(45))
        .map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => "GUIサーバーが45秒以内に起動しませんでした。",
            mpsc::RecvTimeoutError::Disconnected => "GUIサーバーが起動完了前に終了しました。",
        })??;
    let port = ready["port"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= 65535)
        .ok_or("Invalid backend port")?;
    let origin = format!("http://127.0.0.1:{port}");
    if ready["origin"] != origin {
        return Err("Invalid backend origin".into());
    }
    Ok((backend, origin, token))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_diagnostics_only_include_recognized_codes() {
        assert!(startup_error(Some("ERR_MODULE_NOT_FOUND")).contains("ERR_MODULE_NOT_FOUND"));
        assert_eq!(
            startup_error(Some("unreviewed diagnostic detail")),
            startup_error(None)
        );
    }
}
