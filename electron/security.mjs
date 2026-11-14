const trustedAuthHosts = new Set(['auth.openai.com', 'login.openai.com', 'chatgpt.com', 'auth.chatgpt.com']);

export function isTrustedExternal(value) {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') && (trustedAuthHosts.has(url.hostname) ||
        (url.href === 'https://microsoft.com/devicelogin') ||
        (url.hostname === 'teams.microsoft.com' && url.pathname.startsWith('/l/') && url.pathname.length > 3));
  } catch { return false; }
}

export function isAppUrl(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}

export function isMainFrame(event, window, origin) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && isAppUrl(event.senderFrame.url, origin));
}

export function validateUiState(value) {
  if (!value || typeof value !== 'object' || ![1, 2, 4].includes(value.layout)) throw Error('Invalid UI state');
  if (value.selected !== null && (typeof value.selected !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value.selected))) throw Error('Invalid selected conversation');
  if (!['system', 'full', 'reduced'].includes(value.motion || 'system')) throw Error('Invalid motion preference');
  if (!value.drafts || typeof value.drafts !== 'object' || Array.isArray(value.drafts)) throw Error('Invalid drafts');
  let entries = Object.entries(value.drafts);
  for (const [key, text] of entries) if (!/^[A-Za-z0-9_-]{1,120}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || typeof text !== 'string' || text.length > 65536) throw Error('Invalid draft');
  entries = entries.filter(([, text]) => text !== '');
  if (entries.length > 128) throw Error('Too many drafts');
  const requests = value.sendRequests ?? {};
  if (typeof requests !== 'object' || Array.isArray(requests)) throw Error('Invalid pending sends');
  const requestEntries = Object.entries(requests);
  if (requestEntries.length > 128) throw Error('Too many pending sends');
  const sendRequests = Object.fromEntries(requestEntries.map(([key, request]) => {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !request || typeof request !== 'object' || Array.isArray(request) || typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(request.requestId) || typeof request.fingerprint !== 'string' || request.fingerprint.length > 70000) throw Error('Invalid pending send');
    if (request.restoredDraft !== undefined && (typeof request.restoredDraft !== 'string' || request.restoredDraft.length > 65536)) throw Error('Invalid recovered draft');
    return [key, { requestId: request.requestId, fingerprint: request.fingerprint, ...(request.restoredDraft !== undefined ? { restoredDraft: request.restoredDraft } : {}) }];
  }));
  const clean = { drafts: Object.fromEntries(entries), sendRequests, selected: value.selected, layout: value.layout, motion: value.motion || 'system' };
  if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > 1048576) throw Error('Drafts exceed the 1 MB limit');
  return clean;
}
