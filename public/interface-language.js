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

export function interfaceLink(path, current = globalThis.location.href) {
  const source = new URL(current), target = new URL(path, source);
  const requested = source.searchParams.get('lang');
  if (target.origin === source.origin && supported(requested)) target.searchParams.set('lang', requested);
  return target.origin === source.origin ? target.pathname + target.search + target.hash : target.href;
}

// Only transfer player-created sample chats and turns. Built-in sample messages
// are reconstructed in the chosen language. Real chats remain server-owned.
export function sampleChanges(chats, originalLengths) {
  return chats.flatMap(chat => {
    if (!originalLengths.has(chat.id)) return [{id:chat.id, added:chat}];
    const extra = chat.messages.slice(originalLengths.get(chat.id));
    return extra.length ? [{id:chat.id, extra, status:chat.status}] : [];
  });
}

export function restoreSampleChanges(chats, changes) {
  const byId = new Map(chats.map(chat => [chat.id, chat]));
  for (const change of changes || []) {
    const existing = byId.get(change.id);
    if (existing && Array.isArray(change.extra)) {
      existing.messages.push(...change.extra);
      existing.status = change.status;
    } else if (!existing && change.added?.id === change.id && Array.isArray(change.added.messages)) {
      chats.push(change.added);
      byId.set(change.id, change.added);
    }
  }
}
