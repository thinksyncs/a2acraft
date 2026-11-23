//! Explicit opt-in recorder for a new, fictional demo profile. The native host
//! owns every output path and captures only this WKWebView, never the desktop.
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, Url, WebviewWindow};

pub(crate) const QUERY: &str = "?desktop=1&demo=1&village=sample&subagents=sample&walk=resident";
const PHASES: [&str; 6] = [
    "overview",
    "walk",
    "arrival",
    "chat-input",
    "chat-reply",
    "ambient",
];

pub(crate) fn is_sample_url(url: &Url, origin: &str) -> bool {
    crate::policy::is_app_url(url, origin)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.path() == "/"
        && url.fragment().is_none()
        && url.query() == Some(&QUERY[1..])
}

fn profile_arg(args: &[String]) -> Result<Option<&Path>, String> {
    if !args.iter().any(|v| v == "--record-sample-walk") {
        return Ok(None);
    }
    if !args.iter().any(|v| v == "--demo")
        || args.iter().any(|v| {
            v.starts_with("--")
                && v != "--demo"
                && v != "--record-sample-walk"
                && !v.starts_with("--preview-data-dir=")
        })
    {
        return Err("録画は新しいサンプル村だけで使用できます。".into());
    }
    let mut paths = args
        .iter()
        .filter_map(|v| v.strip_prefix("--preview-data-dir="));
    let path = paths
        .next()
        .map(Path::new)
        .filter(|p| p.is_absolute())
        .ok_or("新しい録画専用フォルダを指定してください。")?;
    if paths.next().is_some() {
        return Err("録画フォルダは1つだけ指定してください。".into());
    }
    Ok(Some(path))
}

pub(crate) fn fresh_profile(args: &[String]) -> Result<Option<PathBuf>, String> {
    let Some(profile) = profile_arg(args)? else {
        return Ok(None);
    };
    crate::policy::permitted_location(profile)?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(profile)
        .map_err(|_| "録画には未使用の新しいフォルダが必要です。")?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(profile.join("recording"))
        .map_err(|e| e.to_string())?;
    Ok(Some(profile.into()))
}

pub(crate) struct Recorder {
    directory: PathBuf,
    started: Instant,
    state: Mutex<Progress>,
}
#[derive(Default)]
struct Progress {
    frames: Vec<Value>,
    done: bool,
    taking_frame: bool,
}

impl Recorder {
    pub(crate) fn new(profile: &Path) -> Self {
        Self {
            directory: profile.join("recording"),
            started: Instant::now(),
            state: Mutex::default(),
        }
    }

    fn assert_window(&self, window: &WebviewWindow, origin: &str) -> Result<(), String> {
        let url = window.url().map_err(|e| e.to_string())?;
        if window.label() != "main"
            || !is_sample_url(&url, origin)
            || self.started.elapsed() > Duration::from_secs(400)
            || !window.is_visible().unwrap_or(false)
            || window.is_minimized().unwrap_or(true)
        {
            return Err("録画対象のサンプル画面を確認できません。".into());
        }
        Ok(())
    }

    pub(crate) fn frame(
        &self,
        window: &WebviewWindow,
        origin: &str,
        scene: &Value,
    ) -> Result<Value, String> {
        self.assert_window(window, origin)?;
        let phase = scene["phase"]
            .as_str()
            .filter(|s| PHASES.contains(s))
            .ok_or("Invalid sample phase")?;
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.done || state.taking_frame || state.frames.len() >= 246 {
            return Err("Sample recording finished".into());
        }
        let last = state
            .frames
            .last()
            .and_then(|frame| frame["phase"].as_str());
        if !phase_allowed(last, phase) {
            return Err("Unexpected sample recording phase".into());
        }
        state.taking_frame = true;
        drop(state); // WKWebView needs the main loop while Quit can arrive.
        let captured = crate::sample_snapshot::capture(window, scene).and_then(|shot| {
            self.assert_window(window, origin)?;
            Ok(shot)
        });
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        state.taking_frame = false;
        if state.done {
            return Err("Sample recording finished".into());
        }
        let shot = captured?;
        let file = if phase == "overview" {
            String::from("overview.jpg")
        } else {
            format!("frame-{:03}.jpg", state.frames.len())
        };
        let destination = self.directory.join(&file);
        crate::policy::permitted_location(&destination)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&destination)
            .map_err(|e| e.to_string())?;
        output.write_all(&shot.jpeg).map_err(|e| e.to_string())?;
        let signatures = json!({"mapImage":shot.map_signature,"eyeImage":shot.eye_signature,"chatImage":shot.chat_signature});
        state.frames.push(json!({"phase":phase,"file":file,"atMs":self.started.elapsed().as_millis() as u64,
            "mapImage":signatures["mapImage"],"eyeImage":signatures["eyeImage"],"chatImage":signatures["chatImage"]}));
        Ok(signatures)
    }

    fn finish(&self, version: &str, ok: bool, stage: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.done {
            return Ok(());
        }
        let verified = ok && state.frames.last().is_some_and(|f| f["phase"] == "ambient");
        let stage = if matches!(
            stage,
            "waiting-for-map"
                | "complete"
                | "prepare-eyes"
                | "start"
                | "talk"
                | "type"
                | "send"
                | "return"
                | "nearby"
                | "close"
                | "timeout"
                | "closed"
                | "startup"
        ) || PHASES.contains(&stage)
        {
            stage
        } else {
            "sample"
        };
        let report = json!({"version":version,"source":"visible WKWebView takeSnapshot","status":if verified {"verified"} else {"failed"},
            "stage":stage,"reason":if verified {""} else {"サンプル画面の歩行・会話を確認できませんでした。"},"frames":state.frames});
        crate::write_private_json(&self.directory.join("result.json"), &report)?;
        state.done = true;
        Ok(())
    }
}

pub(crate) fn stop(app: &tauri::AppHandle, stage: &str) {
    if let Some(session) = app.try_state::<Recorder>() {
        let _ = session.finish(&app.package_info().version.to_string(), false, stage);
    }
}

fn phase_allowed(last: Option<&str>, next: &str) -> bool {
    matches!(
        (last, next),
        (None, "overview")
            | (Some("overview" | "walk"), "walk")
            | (Some("walk"), "arrival")
            | (Some("arrival"), "chat-input")
            | (Some("chat-input"), "chat-reply")
            | (Some("chat-reply"), "ambient")
    )
}

pub(crate) async fn request(
    window: WebviewWindow,
    action: String,
    value: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let recorder = window
            .try_state::<Recorder>()
            .ok_or("No fictional sample recording")?;
        let desktop = window.state::<crate::Desktop>();
        if action == "sampleFrame" {
            return recorder.frame(&window, &desktop.origin, &value);
        }
        if !is_sample_url(&window.url().map_err(|e| e.to_string())?, &desktop.origin) {
            return Err("Not the sample village".into());
        }
        recorder.finish(
            &window.app_handle().package_info().version.to_string(),
            value["verified"] == true,
            value["stage"].as_str().unwrap_or("sample"),
        )?;
        Ok(Value::Null)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn start(window: &WebviewWindow) -> Result<(), String> {
    let origin = &window.state::<crate::Desktop>().origin;
    if !is_sample_url(&window.url().map_err(|e| e.to_string())?, origin) {
        return Err("Not the sample village".into());
    }
    let shared = include_str!("../../electron/sample-walk-scenario.mjs")
        .strip_prefix("export ")
        .ok_or("Invalid bundled sample scenario")?;
    window
        .eval(format!(
            "(()=>{{{shared}\n{}\n}})()",
            include_str!("../sample-walk.js")
        ))
        .map_err(|e| e.to_string())?;
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(401));
        if let Some(recorder) = app.try_state::<Recorder>() {
            let _ = recorder.finish(&app.package_info().version.to_string(), false, "timeout");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }
    #[test]
    fn requires_explicit_demo_and_new_absolute_profile() {
        assert!(profile_arg(&args(&["--record-sample-walk"])).is_err());
        assert!(profile_arg(&args(&[
            "--record-sample-walk",
            "--demo",
            "--practice",
            "--preview-data-dir=/example"
        ]))
        .is_err());
        assert!(profile_arg(&args(&[
            "--record-sample-walk",
            "--demo",
            "--preview-data-dir=relative"
        ]))
        .is_err());
        assert!(profile_arg(&args(&["--demo"])).unwrap().is_none());
        let supplied = args(&[
            "--record-sample-walk",
            "--demo",
            "--preview-data-dir=/example",
        ]);
        assert_eq!(profile_arg(&supplied).unwrap(), Some(Path::new("/example")));
    }
    #[test]
    fn recording_cannot_reuse_an_existing_profile() {
        use std::os::unix::fs::PermissionsExt;
        let mut nonce = [0u8; 8];
        getrandom::fill(&mut nonce).unwrap();
        let parent = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("a2acraft-recorder-test-{:016x}", u64::from_be_bytes(nonce)));
        fs::create_dir(&parent).unwrap();
        let profile = parent.join("sample");
        let mut supplied = args(&["--record-sample-walk", "--demo"]);
        supplied.push(format!("--preview-data-dir={}", profile.display()));
        assert_eq!(fresh_profile(&supplied).unwrap(), Some(profile.clone()));
        assert_eq!(
            profile.metadata().unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::write(profile.join("existing"), b"preserve").unwrap();
        assert!(fresh_profile(&supplied).is_err());
        assert_eq!(fs::read(profile.join("existing")).unwrap(), b"preserve");
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn other_origins_and_live_routes_are_never_recorded() {
        let origin = "http://127.0.0.1:1370";
        assert!(is_sample_url(
            &Url::parse(&format!("{origin}/{QUERY}")).unwrap(),
            origin
        ));
        for url in [
            format!("{origin}/?desktop=1"),
            format!("http://127.0.0.1:1371/{QUERY}"),
            format!("{origin}/account{QUERY}"),
            format!("{origin}/{QUERY}&live=1"),
        ] {
            assert!(!is_sample_url(&Url::parse(&url).unwrap(), origin));
        }
    }
    #[test]
    fn report_requires_sequential_verified_phases() {
        assert!(phase_allowed(Some("walk"), "walk"));
        assert!(!phase_allowed(Some("overview"), "ambient"));
        assert!(!phase_allowed(None, "chat-reply"));
    }
}
