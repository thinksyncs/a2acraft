use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    Manager, PhysicalPosition, PhysicalSize, Webview, WebviewWindow, Window, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub(crate) struct History {
    events: Mutex<VecDeque<(u64, &'static str)>>,
    showing: AtomicBool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl History {
    fn record(&self, event: &'static str) {
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        if events.len() == 24 {
            events.pop_front();
        }
        events.push_back((now_ms(), event));
    }
}

pub(crate) fn page_event(webview: &Webview, page: &PageLoadPayload<'_>) {
    if webview.label() == "main" {
        if let Some(history) = webview.try_state::<History>() {
            history.record(match page.event() {
                PageLoadEvent::Started => "loading",
                PageLoadEvent::Finished => "loaded",
            });
        }
    }
}

pub(crate) fn window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let label = match event {
        WindowEvent::Focused(true) => "focus",
        WindowEvent::Focused(false) => "blur",
        WindowEvent::CloseRequested { .. } => "close-requested",
        WindowEvent::Destroyed => "closed",
        WindowEvent::ScaleFactorChanged { .. } => "display-changed",
        _ => return,
    };
    if let Some(history) = window.try_state::<History>() {
        history.record(label);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Rect {
    fn json(self) -> Value {
        json!({"x":self.x,"y":self.y,"width":self.width,"height":self.height})
    }

    fn fit(self, area: Rect) -> Rect {
        let width = self.width.min(area.width);
        let height = self.height.min(area.height);
        Rect {
            x: (self.x as i64).clamp(area.x as i64, area.x as i64 + (area.width - width) as i64)
                as i32,
            y: (self.y as i64).clamp(area.y as i64, area.y as i64 + (area.height - height) as i64)
                as i32,
            width,
            height,
        }
    }
}

fn bounds(window: &WebviewWindow) -> tauri::Result<Rect> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    Ok(Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn work_area(window: &WebviewWindow) -> tauri::Result<Option<Rect>> {
    let monitor = match window.current_monitor()? {
        Some(display) => Some(display),
        None => window.primary_monitor()?,
    };
    Ok(monitor.map(|m| {
        let area = m.work_area();
        Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        }
    }))
}

pub(crate) fn reveal(window: &WebviewWindow) -> tauri::Result<()> {
    window.show()?;
    if window.is_minimized()? {
        window.unminimize()?;
    }
    if !window.is_fullscreen()? && !window.is_maximized()? {
        if let Some(area) = work_area(window)? {
            let current = bounds(window)?;
            let fitted = current.fit(area);
            if fitted.width != current.width || fitted.height != current.height {
                let inner = window.inner_size()?;
                let frame_width = current.width.saturating_sub(inner.width);
                let frame_height = current.height.saturating_sub(inner.height);
                window.set_size(PhysicalSize::new(
                    fitted.width.saturating_sub(frame_width).max(1),
                    fitted.height.saturating_sub(frame_height).max(1),
                ))?;
            }
            if current.x != fitted.x || current.y != fitted.y {
                window.set_position(PhysicalPosition::new(fitted.x, fitted.y))?;
            }
        }
    }
    window.set_focus()
}

fn renderer_state(window: &WebviewWindow) -> &'static str {
    let (send, receive) = mpsc::channel();
    // Only accept these fixed states. Do not read a URL, title, or chat data.
    if window
        .eval_with_callback("document.readyState", move |reply| {
            let state = match reply.trim_matches('"') {
                "complete" => "complete",
                "interactive" => "interactive",
                "loading" => "loading",
                _ => "unknown",
            };
            let _ = send.send(state);
        })
        .is_err()
    {
        return "unavailable";
    }
    receive
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or("no-response")
}

pub(crate) fn show(window: WebviewWindow) {
    let app = window.app_handle().clone();
    if app.state::<History>().showing.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || {
        // Sample before revealing the window or presenting the dialog.
        let bounds = bounds(&window).ok();
        let area = work_area(&window).ok().flatten();
        let visible = window.is_visible().ok();
        let minimized = window.is_minimized().ok();
        let focused = window.is_focused().ok();
        let fullscreen = window.is_fullscreen().ok();
        let events = app
            .state::<History>()
            .events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let responding = renderer_state(&window);
        let version = app.package_info().version.to_string();
        let report = json!({"schema":1, "capturedAtMs":now_ms(), "appVersion":version,
            "window":{"visible":visible,"minimized":minimized,"focused":focused,"fullScreen":fullscreen,
                "bounds":bounds.map(Rect::json),"workArea":area.map(Rect::json),
                "fullyWithinWorkArea":bounds.zip(area).map(|(b,a)| b.fit(a)==b)},
            "renderer":{"readyState":responding},"events":events});
        let saved = (|| -> Result<_, String> {
            let directory = app.path().app_log_dir().map_err(|e| e.to_string())?;
            let file = directory.join("window-diagnostics.json");
            crate::policy::permitted_location(&file)?;
            std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            crate::write_private_json(&file, &report)?;
            Ok(file)
        })();
        let saved = saved
            .map(|file| format!("保存先　{}", file.display()))
            .unwrap_or_else(|_| "診断結果を保存できませんでした。".into());
        let yes_no = |v: Option<bool>| match v {
            Some(true) => "はい",
            Some(false) => "いいえ",
            None => "不明",
        };
        let rendering = match responding {
            "complete" => "読込完了・応答あり",
            "interactive" | "loading" => "読込中・応答あり",
            "no-response" => "2秒以内に応答なし",
            _ => "不明",
        };
        let text = format!("A2ACraft {version}\n表示　{}　最小化　{}　フォーカス　{}\n画面の状態　{rendering}\n{saved}",
            yes_no(visible),yes_no(minimized),yes_no(focused));
        let _ = reveal(&window);
        let dialog = app.dialog().message(text).title("表示の診断");
        dialog.show(move |_| {
            app.state::<History>()
                .showing
                .store(false, Ordering::Release)
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_clamps_to_visible_work_area_without_moving_visible_windows() {
        let area = Rect {
            x: -1920,
            y: 25,
            width: 1920,
            height: 1055,
        };
        let visible = Rect {
            x: -1300,
            y: 40,
            width: 800,
            height: 620,
        };
        assert_eq!(visible.fit(area), visible);
        assert_eq!(
            Rect {
                x: 500,
                y: -80,
                width: 2400,
                height: 1200
            }
            .fit(area),
            area
        );
        assert_eq!(
            Rect {
                x: 500,
                y: 2000,
                ..visible
            }
            .fit(area),
            Rect {
                x: -800,
                y: 460,
                ..visible
            }
        );
    }

    #[test]
    fn diagnostics_keep_only_recent_native_events() {
        let h = History::default();
        for _ in 0..24 {
            h.record("focus");
        }
        h.record("blur");
        let events = h.events.lock().unwrap();
        assert_eq!(events.len(), 24);
        assert_eq!(events.back().unwrap().1, "blur");
    }
}
