// Application chrome is localized explicitly. Conversation text, paths and tool output
// never pass through a document-wide text replacement.
const supported = new Set(['en', 'ja']);
const storageKey = 'a2acraft.uiLanguage';
const catalogues = new Map();
const listeners = new Set();
const originals = new WeakMap();
const bindings = [
  ['data-i18n', null], ['data-i18n-placeholder', 'placeholder'],
  ['data-i18n-title', 'title'], ['data-i18n-aria-label', 'aria-label'],
];
const selector = bindings.map(([marker]) => '[' + marker + ']').join(',');

export function resolveLocale(preference, languages) {
  if (supported.has(preference)) return preference;
  for (const tag of languages || []) {
    const lang = String(tag).toLowerCase().split(/[-_]/)[0];
    if (supported.has(lang)) return lang;
  }
  return 'en';
}

const browser = globalThis.window;
const page = browser?.document;
const platformLanguages = browser?.navigator?.languages?.length
  ? browser.navigator.languages : [browser?.navigator?.language || (page ? 'en' : 'ja')];
let preference;
try { preference = browser?.localStorage.getItem(storageKey); } catch {}
if (browser?.desktop?.getSettings) {
  try {
    const settings = await browser.desktop.getSettings();
    if (supported.has(settings?.uiLanguage)) preference = settings.uiLanguage;
  } catch { /* The web UI can still follow its own language preference. */ }
}
let active = resolveLocale(preference, platformLanguages);
if (page) page.documentElement.lang = active;
if (browser?.desktop?.useLocale) await browser.desktop.useLocale(active).catch(() => {});

export function getLocale() { return active; }
export function registerMessages(locale, entries) {
  if (!supported.has(locale)) throw new RangeError('Unsupported language');
  if (!catalogues.has(locale)) catalogues.set(locale, new Map());
  const catalogue = catalogues.get(locale);
  for (const [key, value] of Object.entries(entries)) catalogue.set(key, value);
}
export function t(key, fallback = key, params = {}) {
  const message = catalogues.get(active)?.get(key) ?? fallback;
  return String(message).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
    (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
export function onLocaleChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
export function applyTranslations(root = page) {
  if (!root?.querySelectorAll) return;
  const nodes = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  for (const node of nodes) {
    let values = originals.get(node);
    if (!values) { values = new Map(); originals.set(node, values); }
    for (const [marker, attr] of bindings) {
      const key = node.getAttribute(marker);
      if (!key) continue;
      if (!values.has(marker)) values.set(marker, attr ? node.getAttribute(attr) ?? '' : node.textContent);
      const value = t(key, values.get(marker));
      if (attr) { if (node.getAttribute(attr) !== value) node.setAttribute(attr, value); }
      else if (node.textContent !== value) node.textContent = value;
    }
  }
}

let writing = Promise.resolve();
export function setLocale(next) {
  if (!supported.has(next)) throw new RangeError('Unsupported language');
  const save = async () => {
    if (browser?.desktop?.setLocale) await browser.desktop.setLocale(next);
    try { browser?.localStorage.setItem(storageKey, next); } catch {}
    if (active === next) return;
    active = next;
    if (page) page.documentElement.lang = active;
    applyTranslations();
    for (const callback of listeners) callback(active);
  };
  writing = writing.catch(() => {}).then(save);
  return writing;
}
