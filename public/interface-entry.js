import {initializeInterfaceLanguage, languageStorageKey, interfaceLink} from './interface-language.js';
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
for (const link of document.querySelectorAll('a[href^="/?demo="]')) link.href = interfaceLink(link.getAttribute('href'));
const pickers = [...document.querySelectorAll('[data-interface-language]')];
for (const picker of pickers) picker.value = lang;
const {prepareInterfaceReload, resumeInterfaceView} = await import('./app.js');
const previous = history.state?.interfaceChange;
if (previous) {
  const {interfaceChange, ...rest} = history.state;
  history.replaceState(rest, '');
  await resumeInterfaceView(previous);
}
for (const picker of pickers) picker.addEventListener('change', async () => {
  const choice = picker.value;
  if (choice !== 'en' && choice !== 'ja') return;
  for (const control of pickers) control.disabled = true;
  const wasInert = document.body.inert;
  document.body.inert = true;
  try {
    const previous = await prepareInterfaceReload();
    await desktop?.setInterfaceLanguage?.(choice);
    try { localStorage.setItem(languageStorageKey, choice); } catch {}
    const target = new URL(location.href);
    target.searchParams.set('lang', choice);
    history.replaceState({...history.state, interfaceChange:previous}, '', target.href);
    location.reload();
  } catch (error) {
    document.body.inert = wasInert;
    for (const control of pickers) { control.value = lang; control.disabled = false; }
    const notice = document.querySelector('#toast');
    notice.textContent = error.message;
    notice.hidden = false;
  }
});
