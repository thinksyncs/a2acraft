use std::sync::Mutex;
use tauri::{
    menu::{
        CheckMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
        WINDOW_SUBMENU_ID,
    },
    AppHandle, Manager, WebviewWindow, Wry,
};
use tauri_plugin_dialog::DialogExt;

use crate::{window_diagnostics, Desktop};

struct Controls {
    reading: CheckMenuItem<Wry>,
    focus_chat: MenuItem<Wry>,
    zoom_step: Mutex<i32>,
    #[cfg(target_os = "macos")]
    original_tab_behavior: Mutex<Option<bool>>,
}

pub(crate) fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let mut view = None;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item {
            if sub.text()? == "View" {
                sub.set_text("表示")?;
                view = Some(sub);
                break;
            }
        }
    }
    let view = match view {
        Some(existing) => existing,
        None => {
            let view = Submenu::new(app, "表示", true)?;
            menu.append(&view)?;
            view
        }
    };

    view.prepend(&MenuItem::with_id(
        app,
        "saved-reload",
        "画面を再読み込み",
        true,
        Some("CmdOrCtrl+R"),
    )?)?;
    for (id, title, key) in [
        ("zoom-in", "拡大", "CmdOrCtrl+Equal"),
        ("zoom-out", "縮小", "CmdOrCtrl+Minus"),
        ("zoom-reset", "実際のサイズ", "CmdOrCtrl+0"),
    ] {
        view.append(&MenuItem::with_id(app, id, title, true, Some(key))?)?;
    }

    let reading = CheckMenuItem::with_id(
        app,
        "screen-reading",
        "画面の読み取りに対応",
        false,
        false,
        None::<&str>,
    )?;
    let focus_chat = MenuItem::with_id(
        app,
        "focus-chat",
        "会話履歴と入力欄を移動",
        false,
        Some("F6"),
    )?;
    view.append_items(&[&PredefinedMenuItem::separator(app)?, &reading, &focus_chat])?;
    if let Some(MenuItemKind::Submenu(window)) = menu.get(WINDOW_SUBMENU_ID) {
        window.set_text("ウィンドウ")?;
        window.prepend(&PredefinedMenuItem::separator(app)?)?;
        window.prepend(&MenuItem::with_id(
            app,
            "diagnose-window",
            "表示の診断",
            true,
            None::<&str>,
        )?)?;
        window.prepend(&MenuItem::with_id(
            app,
            "recover-window",
            "表示を復帰",
            true,
            None::<&str>,
        )?)?;
    }
    app.manage(Controls {
        reading,
        focus_chat,
        zoom_step: Mutex::new(0),
        #[cfg(target_os = "macos")]
        original_tab_behavior: Mutex::default(),
    });
    app.manage(window_diagnostics::History::default());
    Ok(menu)
}

pub(crate) fn restore_preferences(window: &WebviewWindow) -> Result<(), String> {
    let state = window.state::<Desktop>();
    let enabled = state.settings.lock().map_err(|e| e.to_string())?["accessibilitySupportEnabled"]
        .as_bool()
        .unwrap_or(false);
    apply_reading(window, enabled).map_err(|e| e.to_string())
}

fn apply_reading(window: &WebviewWindow, enabled: bool) -> tauri::Result<()> {
    let controls = window.state::<Controls>();
    #[cfg(target_os = "macos")]
    {
        // WKWebView exposes its accessibility tree to VoiceOver automatically.
        // Full keyboard navigation is per-view; restore the WebKit default
        // when the user turns the additional keyboard support off.
        let handle = window.app_handle().clone();
        window.with_webview(move |native| {
            use objc2_web_kit::WKWebView;
            // SAFETY: Tauri supplies this window's live WKWebView on the main
            // thread for the duration of this callback.
            unsafe {
                let web = &*native.inner().cast::<WKWebView>();
                let preferences = web.configuration().preferences();
                let controls = handle.state::<Controls>();
                let mut original = controls
                    .original_tab_behavior
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if enabled {
                    original.get_or_insert_with(|| preferences.tabFocusesLinks());
                    preferences.setTabFocusesLinks(true);
                } else if let Some(default) = original.take() {
                    preferences.setTabFocusesLinks(default);
                }
            }
        })?;
    }
    controls.reading.set_enabled(true)?;
    controls.reading.set_checked(enabled)?;
    controls.focus_chat.set_enabled(enabled)
}

fn toggle_reading(window: &WebviewWindow) -> Result<(), String> {
    let controls = window.state::<Controls>();
    let state = window.state::<Desktop>();
    let enabled = controls.reading.is_checked().map_err(|e| e.to_string())?;
    if let Err(error) = state.set_setting_value("accessibilitySupportEnabled", Some(enabled.into()))
    {
        let _ = controls.reading.set_checked(!enabled);
        return Err(error);
    }
    apply_reading(window, enabled).map_err(|e| e.to_string())
}

pub(crate) fn reveal(window: &WebviewWindow) -> Result<(), String> {
    window_diagnostics::reveal(window).map_err(|e| e.to_string())
}

fn zoom(window: &WebviewWindow, action: &str) -> tauri::Result<()> {
    let controls = window.state::<Controls>();
    let mut step = controls.zoom_step.lock().unwrap_or_else(|e| e.into_inner());
    let next = match action {
        "zoom-in" => (*step + 1).min(8),
        "zoom-out" => (*step - 1).max(-4),
        _ => 0,
    };
    window.set_zoom(1.2_f64.powi(next))?;
    *step = next;
    Ok(())
}

pub(crate) fn handle(app: &AppHandle, event: MenuEvent) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let action = event.id().as_ref();
    let result = match action {
        "recover-window" => reveal(&window),
        "diagnose-window" => { window_diagnostics::show(window); return; }
        "saved-reload" if app.try_state::<Desktop>().is_some() => {
            crate::lifecycle::request_reload(&window);
            return;
        }
        "screen-reading" if app.try_state::<Desktop>().is_some() => toggle_reading(&window),
        "focus-chat" => window.eval(
            "(() => {const list=document.querySelector('.chat-panel.selected .messages'),input=document.getElementById('prompt');if(list?.getClientRects().length&&input?.getClientRects().length)(list.contains(document.activeElement)?input:list).focus()})()"
        ).map_err(|e| e.to_string()),
        "zoom-in" | "zoom-out" | "zoom-reset" => zoom(&window, action).map_err(|e| e.to_string()),
        _ => return,
    };
    if result.is_err() {
        app.dialog()
            .message("表示設定を変更できませんでした。")
            .title("A2ACraft")
            .show(|_| {});
    }
}
