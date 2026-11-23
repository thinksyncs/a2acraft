const supported = value => value === 'en' || value === 'ja';
export const languageStorageKey = 'a2acraft-interface-language';

export function resolveInterfaceLanguage({requested, saved, languages = []} = {}) {
  if (supported(requested)) return requested;
  if (supported(saved)) return saved;
  for (const locale of languages) {
    const language = String(locale).toLowerCase().split('-')[0];
    if (supported(language)) return language;
  }
  return 'en';
}

// Shared model helpers are also imported by the server, without a document.
// Initialize the renderer before importing modules that create sample records.
export let interfaceLanguage = 'ja';
export function initializeInterfaceLanguage(preferences) {
  interfaceLanguage = resolveInterfaceLanguage(preferences);
  return interfaceLanguage;
}

export function ui(japanese, english) {
  return interfaceLanguage === 'en' ? english : japanese;
}
