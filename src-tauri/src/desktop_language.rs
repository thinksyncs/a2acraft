use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use crate::Desktop;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Language { English, Japanese }

impl Language {
    pub(crate) fn text(self, ja: &'static str, en: &'static str) -> &'static str {
        match self { Self::Japanese => ja, Self::English => en }
    }

    fn from_locales(locales: impl IntoIterator<Item = String>) -> Self {
        for locale in locales {
            match locale.split(['-', '_', '.']).next().unwrap_or("").to_ascii_lowercase().as_str() {
                "en" => return Self::English,
                "ja" => return Self::Japanese,
                _ => {}
            }
        }
        Self::English
    }

    pub(crate) fn current(app: &AppHandle) -> Self {
        if let Some(state) = app.try_state::<Desktop>() {
            if let Ok(saved) = state.settings.lock() {
                return Self::from_saved(saved["interfaceLanguage"].as_str());
            }
        }
        Self::from_saved(None)
    }

    pub(crate) fn from_saved(value: Option<&str>) -> Self {
        match value {
            Some("en") => return Self::English,
            Some("ja") => return Self::Japanese,
            _ => {}
        }
        static SYSTEM: OnceLock<Language> = OnceLock::new();
        *SYSTEM.get_or_init(|| Self::from_locales(sys_locale::get_locales()))
    }
}

#[cfg(test)]
mod tests {
    use super::Language;
    #[test]
    fn first_supported_system_language_wins() {
        assert_eq!(Language::from_locales(["fr-CA".into(), "ja-JP".into(), "en-US".into()]), Language::Japanese);
        assert_eq!(Language::from_locales(["en_US.UTF-8".into(), "ja-JP".into()]), Language::English);
        assert_eq!(Language::from_locales(["fr".into()]), Language::English);
    }
}
