#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    error::Error,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{Manager, Url, WebviewUrl, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod backend;
mod desktop_menu;
#[cfg(target_os = "macos")]
mod sample_recorder;
mod window_diagnostics;
mod lifecycle;
use lifecycle::{defer_close, CloseState};
mod policy;
#[cfg(target_os = "macos")]
mod instance;
#[cfg(target_os = "macos")]
mod sample_snapshot;

struct Desktop {
    origin: String,
    data_dir: PathBuf,
    initial_settings: Value,
    settings: Mutex<Value>,
    close: Mutex<CloseState>,
    backend: Mutex<Option<backend::Backend>>,
    #[cfg(debug_assertions)]
    smoke: bool,
}

fn read_json(file: &Path) -> Result<Option<Value>, Box<dyn Error>> {
    policy::permitted_location(file)?;
    match fs::read(file) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn write_private_json(target: &Path, value: &Value) -> Result<(), String> {
    policy::permitted_location(target)?;
    let directory = target.parent().ok_or("Invalid desktop file")?;
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let tmp = directory.join(format!(".desktop-{:016x}.tmp", u64::from_be_bytes(random)));
    let mut opts = OpenOptions::new();
    opts.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts.open(&tmp).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), Box<dyn Error>> {
        file.write_all(&serde_json::to_vec_pretty(value)?)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, target)?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    Ok(())
}

impl Desktop {
    fn public_settings(&self, saved: &Value) -> Value {
        json!({
            "codexPath": saved["codexPath"].as_str().unwrap_or(""),
            "workDirectory": saved["workDirectory"].as_str().unwrap_or(""),
            "restartRequired": (["codexPath", "workDirectory"].iter().any(|key| saved[*key] != self.initial_settings[*key]))
        })
    }

    fn set_setting(&self, key: &str, value: Option<String>) -> Result<Value, String> {
        self.set_setting_value(key, value.map(Value::String))
    }

    fn set_setting_value(&self, key: &str, value: Option<Value>) -> Result<Value, String> {
        let mut saved = self.settings.lock().map_err(|e| e.to_string())?;
        let mut next = saved.clone();
        let object = next.as_object_mut().ok_or("Invalid desktop settings")?;
        if let Some(value) = value {
            object.insert(key.into(), value);
        } else {
            object.remove(key);
        }
        write_private_json(&self.data_dir.join("desktop-settings.json"), &next)?;
        *saved = next;
        Ok(self.public_settings(&saved))
    }

    fn request(&self, action: &str, value: Value) -> Result<Value, String> {
        let guard = self.backend.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .ok_or("Desktop backend has closed")?
            .request(action, value)
    }
}

#[tauri::command]
async fn desktop_request(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, Desktop>,
    action: String,
    value: Value,
) -> Result<Value, String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() != "main" || !policy::is_app_url(&url, &state.origin) {
        return Err("Desktop request rejected".into());
    }
    #[cfg(target_os = "macos")]
    if app.try_state::<sample_recorder::Recorder>().is_some() {
        if !sample_recorder::is_sample_url(&url, &state.origin) { return Err("Not the sample village".into()); }
        match action.as_str() {
            "sampleFrame" | "sampleDone" => return sample_recorder::request(window,action,value).await,
            "windowState" | "settingsRead" | "uiRead" | "uiSave" | "mapRead" | "mapSave" | "flushRegistered" | "flushComplete" | "close" => {}
            _ => return Err("Unavailable in a fictional recording".into()),
        }
    }
    match action.as_str() {
        #[cfg(debug_assertions)]
        "qaReport" if state.smoke => {
            println!("TAURI_QA {}", value);
        }
        "minimize" => window.minimize().map_err(|e| e.to_string())?,
        "toggleMaximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
            .map_err(|e| e.to_string())?;
        }
        "close" => window.close().map_err(|e| e.to_string())?,
        "windowState" => {
            return Ok(json!({"maximized":window.is_maximized().map_err(|e|e.to_string())?}))
        }
        "openExternal" => {
            let url = value.as_str().ok_or("Invalid URL")?;
            if !policy::trusted_external(url) {
                let data = state.data_dir.join("data");
                let read = |name: &str| {
                    read_json(&data.join(name))
                        .map_err(|e| e.to_string())
                        .map(|v| v.unwrap_or(Value::Null))
                };
                if !policy::registered_project_link(
                    url,
                    &read("world-artifacts.json")?,
                    &read("projects.json")?,
                ) {
                    return Err("External URL rejected".into());
                }
            }
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| e.to_string())?;
        }
        "uiRead" | "uiSave" | "mapRead" | "mapSave" => return state.request(&action, value),
        "settingsChooseCodex" => {
            if let Some(file) = app
                .dialog()
                .file()
                .set_title("Codex 実行ファイルを選択")
                .blocking_pick_file()
            {
                let path = file.into_path().map_err(|e| e.to_string())?;
                policy::executable(&path)?;
                return state.set_setting(
                    "codexPath",
                    Some(path.to_str().ok_or("Invalid executable path")?.into()),
                );
            }
        }
        "settingsResetCodex" => return state.set_setting("codexPath", None),
        "settingsSetWorkspace" | "settingsChooseWorkspace" => {
            let chosen = if action == "settingsSetWorkspace" {
                Some(PathBuf::from(value.as_str().ok_or("Invalid workspace")?))
            } else {
                app.dialog()
                    .file()
                    .set_title("専用作業フォルダを選択")
                    .blocking_pick_folder()
                    .map(|p| p.into_path())
                    .transpose()
                    .map_err(|e| e.to_string())?
            };
            if let Some(path) = chosen {
                policy::permitted_location(&path)?;
                let result = state.request("prepareWorkspace", json!(path))?;
                return state.set_setting(
                    "workDirectory",
                    Some(result.as_str().ok_or("Invalid workspace")?.into()),
                );
            }
        }
        "settingsRead" => {}
        "flushRegistered" => {
            state.close.lock().map_err(|e| e.to_string())?.registered = true;
        }
        "flushComplete" => {
            if let Some(id) = value["id"].as_u64() {
                lifecycle::complete(&window, id, value["ok"] == true);
            }
        }
        _ => return Err("Unknown desktop action".into()),
    }
    if action.starts_with("settings") {
        let saved = state.settings.lock().map_err(|e| e.to_string())?;
        return Ok(state.public_settings(&saved));
    }
    Ok(json!({"ok":true}))
}

// runtime-wry acknowledges the SetCookie message even when WebKit rejects
// the write. Verify the session before sending the first authenticated GET.
fn install_session(window: &WebviewWindow, token: String) -> Result<(), &'static str> {
    let window = window.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for _ in 0..3 {
            let cookie = tauri::webview::Cookie::build(("chat_ui_session", token.clone()))
                .domain("127.0.0.1")
                .path("/")
                .http_only(true)
                .same_site(tauri::webview::cookie::SameSite::Strict)
                .build();
            // This store belongs solely to the newly-created incognito window.
            // cookies_for_url filters IPv4 literals incorrectly on WKWebView.
            if window.set_cookie(cookie).is_ok()
                && window.cookies().is_ok_and(|cookies| {
                    cookies.iter().any(|c| {
                        c.name() == "chat_ui_session"
                            && c.value() == token
                            && c.domain() == Some("127.0.0.1")
                            && c.path() == Some("/")
                            && c.http_only() == Some(true)
                    })
                })
            {
                let _ = sender.send(true);
                return;
            }
            std::thread::sleep(Duration::from_millis(120));
        }
        let _ = sender.send(false);
    });
    match receiver.recv_timeout(Duration::from_secs(12)) {
        Ok(true) => Ok(()),
        _ => Err("アプリ専用の接続を確認できませんでした。A2ACraftをもう一度開いてください。"),
    }
}

fn setup_desktop(app: &tauri::AppHandle) -> Result<(), Box<dyn Error>> {
    let practice = std::env::args().any(|arg| arg == "--practice");
    let demo = std::env::args().any(|arg| arg == "--demo");
    let base_dir = app.path().app_data_dir()?;
    #[cfg(debug_assertions)]
    let base_dir = std::env::var_os("CHAT_UI_TAURI_TEST_DIR")
        .map(PathBuf::from)
        .unwrap_or(base_dir);
    #[cfg(target_os = "macos")]
    let recording_profile = sample_recorder::fresh_profile(&std::env::args().skip(1).collect::<Vec<_>>())?;
    #[cfg(not(target_os = "macos"))]
    let recording_profile: Option<PathBuf> = None;
    let recording = recording_profile.is_some();
    let data_dir = if let Some(profile) = recording_profile {
        #[cfg(target_os = "macos")]
        app.manage(sample_recorder::Recorder::new(&profile));
        profile
    } else if demo {
        base_dir.join("demo")
    } else if practice {
        base_dir.join("practice")
    } else {
        base_dir.clone()
    };
    policy::permitted_location(&data_dir)?;
    fs::create_dir_all(&data_dir)?;
    #[cfg(target_os = "macos")]
    {
        let Some((lock, activations)) = instance::claim(&data_dir)? else {
            app.exit(0);
            return Ok(());
        };
        app.manage(lock);
        let handle = app.clone();
        activations.listen(move || reveal_main(&handle));
    }
    let mut settings = read_json(&data_dir.join("desktop-settings.json"))?;
    if !demo && practice && settings.is_none() {
        settings = read_json(&base_dir.join("desktop-settings.json"))?;
    }
    let settings = settings.unwrap_or(json!({}));
    if !settings.is_object() {
        return Err("Invalid desktop settings file".into());
    }
    #[cfg(debug_assertions)]
    let smoke = !demo
        && std::env::args().any(|arg| arg == "--smoke-test")
        && std::env::var_os("CHAT_UI_TAURI_TEST_DIR").is_some()
        && settings["codexPath"]
            .as_str()
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("CODEX_BIN").map(PathBuf::from))
            .is_some_and(|p| p.file_name().is_some_and(|n| n == "fake-codex.mjs"));
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    };
    let script = include_str!("../bridge.js")
        .replace("__CHAT_UI_PLATFORM__", &serde_json::to_string(platform)?)
        .replace(
            "__CHAT_UI_PRACTICE__",
            if practice { "true" } else { "false" },
        )
        .replace(
            "__CHAT_UI_VERSION__",
            &serde_json::to_string(&app.package_info().version.to_string())?,
        );
    #[cfg(debug_assertions)]
    let script = if smoke {
        script + include_str!("../smoke.js")
    } else {
        script
    };
    let script = if recording { String::from(include_str!("../sample-input-guard.js")) + &script } else { script };
    let navigation = app.clone();
    let (loaded, wait_loaded) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    let window =
        tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("desktop-startup.html".into()))
            .title(if demo {
                "A2ACraft · Demo"
            } else if practice {
                "A2ACraft · 練習用の街"
            } else {
                "A2ACraft"
            })
            .inner_size(1280., 800.)
            .min_inner_size(920., 620.)
            .visible(true)
            .incognito(true)
            .disable_drag_drop_handler()
            .initialization_script(script)
            .on_navigation(move |url| {
                if let Some(state) = navigation.try_state::<Desktop>() {
                    #[cfg(target_os = "macos")]
                    if recording { return sample_recorder::is_sample_url(url, &state.origin); }
                    return policy::is_app_url(url, &state.origin);
                }
                policy::is_startup_url(url)
            })
            .on_page_load(move |window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished
                    && window.try_state::<Desktop>().is_some_and(|state|
                        policy::is_app_url(payload.url(), &state.origin))
                {
                    let _ = loaded.try_send(());
                }
            })
            .on_new_window(move |url, _| {
                if !recording && policy::trusted_external(url.as_str()) {
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                }
                tauri::webview::NewWindowResponse::Deny
            })
            .on_download(|_, _| false)
            .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
            .build()?;
    let (backend, origin, token, backend_exit) = backend::start(app, &data_dir, &settings, practice, demo)?;
    app.manage(Desktop {
        origin: origin.clone(),
        data_dir,
        initial_settings: settings.clone(),
        settings: Mutex::new(settings),
        close: Mutex::default(),
        backend: Mutex::new(Some(backend)),
        #[cfg(debug_assertions)]
        smoke,
    });
    app.add_capability(
        json!({"identifier":"desktop-session","windows":["main"],"local":false,
        "remote":{"urls":[format!("{origin}/*")]},"permissions":["allow-desktop-request"]})
        .to_string(),
    )?;
    crate::desktop_menu::restore_preferences(&window)?;
    install_session(&window, token)?;
    #[cfg(target_os = "macos")]
    let recording_query = sample_recorder::QUERY;
    #[cfg(not(target_os = "macos"))]
    let recording_query = "";
    let query = if recording { recording_query } else if demo {
        "?desktop=1&demo=1&village=sample&projects=sample&subagents=sample"
    } else {
        "?desktop=1"
    };
    window.navigate(Url::parse(&format!("{origin}/{query}"))?)?;
    wait_loaded.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "画面を30秒以内に読み込めませんでした。A2ACraftを開き直してください。")?;
    #[cfg(target_os = "macos")]
    if recording { sample_recorder::start(&window)?; }
    std::thread::spawn(move || {
        if backend_exit.recv().is_ok() {
            lifecycle::backend_lost(window);
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn reveal_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = crate::desktop_menu::reveal(&window);
    }
}

fn stop_desktop_runtime(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Desktop>() {
        let backend = state.backend.lock().unwrap_or_else(|e| e.into_inner()).take();
        drop(backend);
    }
    // Release the profile only after the sidecar has closed its store and pipes.
    #[cfg(target_os = "macos")]
    if let Some(owner) = app.try_state::<instance::InstanceLock>() {
        owner.release();
    }
}

fn desktop_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg(test)]
#[test]
fn startup_page_is_embedded_in_the_desktop_context() {
    let context = desktop_context();
    let asset = context.assets().get(&"desktop-startup.html".into()).expect("bundled startup page");
    let page = std::str::from_utf8(&asset).unwrap();
    assert!(page.contains("保存した会話と地図を読み込んでいます"));
    assert!(page.contains("default-src 'none'"));
    assert!(!page.contains("<script src="));
}

fn main() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .menu(desktop_menu::build)
        .on_menu_event(desktop_menu::handle)
        .on_page_load(window_diagnostics::page_event)
        .invoke_handler(tauri::generate_handler![desktop_request])
        .on_window_event(|window, event| {
            window_diagnostics::window_event(window, event);
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .get_webview_window("main")
                    .is_some_and(|w| defer_close(&w))
                {
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            // Let the native event loop service WebKit and window creation
            // while the backend starts and the isolated session is installed.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = setup_desktop(&handle) {
                    #[cfg(target_os = "macos")]
                    sample_recorder::stop(&handle, "startup");
                    let message: String = error.to_string().chars().take(240).collect();
                    eprintln!("A2ACraft startup failed: {message}");
                    let handle_on_dismiss = handle.clone();
                    handle
                        .dialog()
                        .message(message)
                        .title("A2ACraft を起動できませんでした")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .show(move |_| handle_on_dismiss.exit(1));
                }
            });
            Ok(())
        })
        .build(desktop_context());
    match result {
        Ok(app) => app.run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => reveal_main(app),
            tauri::RunEvent::ExitRequested { api, .. } => {
                if app
                    .get_webview_window("main")
                    .is_some_and(|w| defer_close(&w))
                {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::Exit => {
                #[cfg(target_os = "macos")]
                sample_recorder::stop(app, "closed");
                stop_desktop_runtime(app);
            }
            _ => {}
        }),
        Err(error) => {
            eprintln!("A2ACraft startup failed: {error}");
            std::process::exit(1);
        }
    }
}
