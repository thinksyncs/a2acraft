import {initializeInterfaceLanguage, languageStorageKey} from './interface-language.js';
import {translateInterfaceMarkup} from './interface-shell.js';

const desktop = window.desktop?.isElectron || window.desktop?.isTauri ? window.desktop : null;
let saved;
try { saved = (await desktop?.getSettings())?.interfaceLanguage; } catch {}
if (saved !== 'en' && saved !== 'ja') {
  try { saved = localStorage.getItem(languageStorageKey); } catch {}
}
const url = new URL(location.href);
const lang = initializeInterfaceLanguage({
  requested: url.searchParams.get('lang'), saved, languages: navigator.languages || [navigator.language],
});
document.documentElement.lang = lang;
if (lang === 'en') translateInterfaceMarkup(document.body);
const pickers = [...document.querySelectorAll('[data-interface-language]')];
for (const picker of pickers) picker.value = lang;
const {prepareInterfaceReload} = await import('./app.js');
for (const picker of pickers) picker.addEventListener('change', async () => {
  const choice = picker.value;
  if (choice !== 'en' && choice !== 'ja') return;
  for (const control of pickers) control.disabled = true;
  try {
    await prepareInterfaceReload();
    await desktop?.setInterfaceLanguage?.(choice);
    try { localStorage.setItem(languageStorageKey, choice); } catch {}
    const target = new URL(location.href);
    target.searchParams.set('lang', choice);
    location.replace(target.href);
  } catch (error) {
    for (const control of pickers) { control.value = lang; control.disabled = false; }
    const notice = document.querySelector('#toast');
    notice.textContent = error.message;
    notice.hidden = false;
  }
});
