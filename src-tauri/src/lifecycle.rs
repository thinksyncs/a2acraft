use crate::{desktop_language::Language, Desktop};
use std::time::Duration;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Quit,
    Restart,
    Reload,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Idle,
    Saving(u64, Action),
    Choosing(u64, Action),
    Recovering,
    Exiting,
}

#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
enum Recovery {
    #[default]
    Online,
    Pending,
    Notified,
}

#[derive(Default)]
pub(crate) struct CloseState {
    pub(crate) registered: bool,
    sequence: u64,
    phase: Phase,
    recovery: Recovery,
}

impl CloseState {
    fn begin(&mut self, action: Action) -> Option<u64> {
        if self.phase != Phase::Idle {
            // A pending reload already asked the renderer to save. A later
            // native close can use that result, including its failure path.
            if let Phase::Saving(id, Action::Reload) = self.phase {
                self.phase = Phase::Saving(id, action);
            }
            return None;
        }
        self.sequence += 1;
        self.phase = Phase::Saving(self.sequence, action);
        Some(self.sequence)
    }

    fn finish(&mut self, id: u64, ok: bool) -> Option<Action> {
        let Phase::Saving(current, action) = self.phase else {
            return None;
        };
        if current != id {
            return None;
        }
        self.phase = if !ok {
            Phase::Choosing(id, action)
        } else if action == Action::Reload {
            self.registered = false;
            Phase::Idle
        } else {
            Phase::Exiting
        };
        Some(action)
    }
}

fn reveal(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn resume(window: &WebviewWindow) {
    let _ = window.eval("window.dispatchEvent(new Event('a2acraft-close-cancelled'))");
}

fn run_action(window: &WebviewWindow, action: Action) {
    let language = Language::current(window.app_handle());
    match action {
        Action::Quit => window.app_handle().exit(0),
        Action::Restart => {
            // request_restart can spawn immediately when queueing Exit fails.
            crate::stop_desktop_runtime(window.app_handle());
            window.app_handle().request_restart();
        }
        Action::Reload => {
            if window.reload().is_err() {
                window
                    .state::<Desktop>()
                    .close
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .registered = true;
                resume(window);
                window
                    .app_handle()
                    .dialog()
                    .message(language.text("保存は完了しましたが、画面を再読み込みできませんでした。", "Your work was saved, but the window could not reload."))
                    .title(language.text("画面の再読み込み", "Reload Window"))
                    .show(|_| {});
            }
        }
    }
}

fn confirm_failure(window: &WebviewWindow, id: u64, action: Action) {
    let language = Language::current(window.app_handle());
    reveal(window);
    if action == Action::Reload {
        window.app_handle().dialog().message(language.text("下書きと地図を保存できませんでした。保存先を確認し、画面の再読み込みを再試行してください。", "Drafts and the map could not be saved. Check the save location, then try Reload Window again."))
            .title(language.text("画面の再読み込み", "Reload Window")).kind(MessageDialogKind::Warning).parent(window)
            .show({ let window = window.clone(); move |_| choose(&window, id, action, Choice::Cancel) });
        return;
    }
    let discard = if action == Action::Restart {
        language.text("保存せずに再起動", "Restart Without Saving")
    } else {
        language.text("保存せずに終了", "Quit Without Saving")
    };
    let retry = language.text("保存を再試行", "Try Saving Again");
    window
        .app_handle()
        .dialog()
        .message(
            language.text("下書きと地図を保存できませんでした。保存せずに続行すると未保存の変更が失われます。", "Drafts and the map could not be saved. Continuing without saving will discard your changes."),
        )
        .title(language.text("終了前の保存", "Save Before Closing"))
        .kind(MessageDialogKind::Warning)
        .parent(window)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            retry.into(),
            discard.into(),
            language.text("戻る", "Go Back").into(),
        ))
        .show_with_result({
            let window = window.clone();
            move |response| {
                let choice = match response {
                    MessageDialogResult::Custom(s) if s == discard => Choice::Discard,
                    MessageDialogResult::Custom(s) if s == retry => Choice::Retry,
                    _ => Choice::Cancel,
                };
                choose(&window, id, action, choice);
            }
        });
}

enum Choice {
    Retry,
    Discard,
    Cancel,
}

fn choose(window: &WebviewWindow, id: u64, action: Action, choice: Choice) {
    let state = window.state::<Desktop>();
    let mut close = state.close.lock().unwrap_or_else(|e| e.into_inner());
    if close.phase != Phase::Choosing(id, action) {
        return;
    }
    if matches!(choice, Choice::Discard) {
        close.phase = Phase::Exiting;
        drop(close);
        run_action(window, action);
        return;
    }
    close.phase = Phase::Idle;
    drop(close);
    match choice {
        Choice::Retry => request(window, action),
        Choice::Cancel => {
            resume(window);
            present_pending_recovery(window);
        }
        Choice::Discard => unreachable!(),
    }
}

pub(crate) fn complete(window: &WebviewWindow, id: u64, ok: bool) {
    let state = window.state::<Desktop>();
    let mut close = state.close.lock().unwrap_or_else(|e| e.into_inner());
    let action = close.finish(id, ok);
    if action == Some(Action::Reload) && ok && close.recovery != Recovery::Online {
        // Reloading a dead loopback server would replace the recoverable page.
        close.registered = true;
        close.recovery = Recovery::Pending;
        drop(close);
        resume(window);
        present_pending_recovery(window);
        return;
    }
    drop(close);
    if let Some(action) = action {
        if ok {
            run_action(window, action);
        } else {
            confirm_failure(window, id, action);
        }
    }
}

fn request(window: &WebviewWindow, action: Action) {
    let Some(state) = window.try_state::<Desktop>() else {
        return;
    };
    let mut close = state.close.lock().unwrap_or_else(|e| e.into_inner());
    let Some(id) = close.begin(action) else {
        return;
    };
    let registered = close.registered;
    drop(close);
    if !registered {
        complete(window, id, true);
        return;
    }
    if window
        .eval(format!(
            "window.dispatchEvent(new CustomEvent('a2acraft-native-close',{{detail:{id}}}))"
        ))
        .is_err()
    {
        complete(window, id, false);
        return;
    }
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        complete(&window, id, false);
    });
}

pub(crate) fn defer_close(window: &WebviewWindow) -> bool {
    let Some(state) = window.try_state::<Desktop>() else {
        return false;
    };
    let close = state.close.lock().unwrap_or_else(|e| e.into_inner());
    if !close.registered || close.phase == Phase::Exiting {
        return false;
    }
    drop(close);
    request(window, Action::Quit);
    true
}

pub(crate) fn request_reload(window: &WebviewWindow) {
    let Some(state) = window.try_state::<Desktop>() else {
        return;
    };
    let mut close = state.close.lock().unwrap_or_else(|e| e.into_inner());
    if close.recovery != Recovery::Online {
        if close.phase == Phase::Idle {
            close.recovery = Recovery::Pending;
        }
        drop(close);
        present_pending_recovery(window);
        return;
    }
    drop(close);
    // A failed renderer may never have registered its draft callback.
    // Reload its authenticated page, but leave the startup page alone.
    if window
        .url()
        .is_ok_and(|url| crate::policy::is_app_url(&url, &state.origin))
    {
        request(window, Action::Reload);
    }
}

pub(crate) fn backend_lost(window: WebviewWindow) {
    let state = window.state::<Desktop>();
    state
        .close
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .recovery = Recovery::Pending;
    present_pending_recovery(&window);
}

fn present_pending_recovery(window: &WebviewWindow) {
    let language = Language::current(window.app_handle());
    let restart_label = language.text("再起動", "Restart");
    let state = window.state::<Desktop>();
    let mut close = state.close.lock().unwrap_or_else(|e| e.into_inner());
    if close.recovery != Recovery::Pending || close.phase != Phase::Idle {
        return;
    }
    close.phase = Phase::Recovering;
    close.recovery = Recovery::Notified;
    drop(close);
    reveal(window);
    window.app_handle().dialog().message(language.text("アプリの接続が終了しました。再起動すると保存済みの会話を開けます。中断した作業は自動送信されません。", "The app disconnected. Restart to reopen your saved conversations. Interrupted work will not be sent automatically."))
        .title(language.text("A2ACraft の再接続", "Reconnect A2ACraft")).kind(MessageDialogKind::Error).parent(window)
        .buttons(MessageDialogButtons::OkCancelCustom(restart_label.into(), language.text("終了", "Quit").into()))
        .show_with_result({ let window = window.clone(); move |response| {
            let state = window.state::<Desktop>();
            let mut close = state.close.lock().unwrap_or_else(|e| e.into_inner());
            if close.phase != Phase::Recovering { return; }
            close.phase = Phase::Idle;
            drop(close);
            let restart = matches!(response, MessageDialogResult::Custom(s) if s == restart_label);
            request(&window, if restart { Action::Restart } else { Action::Quit });
        }});
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_replies_and_timeouts_cannot_act_on_a_retried_save() {
        let mut state = CloseState::default();
        let first = state.begin(Action::Quit).unwrap();
        assert_eq!(state.finish(first, false), Some(Action::Quit));
        assert_eq!(state.finish(first, true), None);
        assert_eq!(state.begin(Action::Quit), None);
        state.phase = Phase::Idle;
        let retry = state.begin(Action::Quit).unwrap();
        assert_eq!(state.finish(first, false), None);
        assert_eq!(state.finish(retry, true), Some(Action::Quit));
        assert_eq!(state.phase, Phase::Exiting);
    }

    #[test]
    fn quitting_during_reload_uses_the_pending_flush() {
        let mut state = CloseState {
            registered: true,
            ..Default::default()
        };
        let id = state.begin(Action::Reload).unwrap();
        assert_eq!(state.begin(Action::Quit), None);
        assert_eq!(state.finish(id, true), Some(Action::Quit));
        assert_eq!(state.phase, Phase::Exiting);
    }

    #[test]
    fn failed_reload_preserves_registration_and_success_rearms_on_page_load() {
        let mut state = CloseState {
            registered: true,
            ..Default::default()
        };
        let id = state.begin(Action::Reload).unwrap();
        assert_eq!(state.finish(id, false), Some(Action::Reload));
        assert!(state.registered);
        assert_eq!(state.phase, Phase::Choosing(id, Action::Reload));
        state.phase = Phase::Idle;
        let id = state.begin(Action::Reload).unwrap();
        assert_eq!(state.finish(id, true), Some(Action::Reload));
        assert!(!state.registered);
        assert_eq!(state.phase, Phase::Idle);
    }
}
