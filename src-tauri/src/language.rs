use std::sync::atomic::{AtomicBool, Ordering};

// The renderer supplies the negotiated WebKit language on first load. A saved
// explicit preference is available even earlier, when restoring a profile.
static JAPANESE: AtomicBool = AtomicBool::new(false);

pub(crate) fn select(lang: &str) {
    match lang {
        "ja" => JAPANESE.store(true, Ordering::Relaxed),
        "en" => JAPANESE.store(false, Ordering::Relaxed),
        _ => {}
    }
}

pub(crate) fn label(ja: &'static str, en: &'static str) -> &'static str {
    if JAPANESE.load(Ordering::Relaxed) { ja } else { en }
}
