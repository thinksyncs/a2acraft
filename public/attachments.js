const MAX_FILES = 6;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 2048;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'ppt', 'pptx', 'xls', 'xlsx', 'doc', 'docx', 'odt', 'ods', 'odp', 'csv', 'tsv', 'txt', 'md']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const instances = new WeakMap();

const extension = name => String(name || '').split('.').pop().toLowerCase();
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const sizeLabel = size => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`;
const imageURL = item => typeof item.url === 'string' && /^\/api\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.url) ? item.url : null;

// Read dimensions before decoding common image headers, so oversized images can
// be rejected without asking the browser to allocate their full pixel buffer.
function headerDimensions(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    return [data.getUint32(16), data.getUint32(20)];
  }
  if (bytes.length >= 10 && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') return [data.getUint16(6, true), data.getUint16(8, true)];
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === 'VP8X') return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
    if (kind === 'VP8 ') return [data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff];
    if (kind === 'VP8L' && bytes[20] === 0x2f) return [1 + bytes[21] + ((bytes[22] & 0x3f) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10)];
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return [data.getUint16(offset + 5), data.getUint16(offset + 3)];
      }
      offset += length;
    }
  }
  return null;
}

function checkDimensions(width, height) {
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('画像が大きすぎます。4,000万画素以内の画像にしてください。');
}

async function prepareImage(file) {
  const dimensions = headerDimensions(new Uint8Array(await file.arrayBuffer()));
  if (dimensions) checkDimensions(...dimensions);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error('画像を読み込めません。PNG・JPEG・WebP・GIFのファイルを確認してください。'); });
    checkDimensions(image.naturalWidth, image.naturalHeight);
    const edge = Math.max(image.naturalWidth, image.naturalHeight);
    if (edge <= MAX_EDGE) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * MAX_EDGE / edge));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * MAX_EDGE / edge));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像を縮小できませんでした。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/jpeg' || ['jpg', 'jpeg'].includes(extension(file.name)) ? 'image/jpeg' : 'image/png';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.88));
    canvas.width = canvas.height = 1;
    if (!blob || blob.size > MAX_BYTES) throw new Error('縮小後の画像が10 MBを超えています。小さい画像を選んでください。');
    const suffix = type === 'image/jpeg' ? 'jpg' : 'png';
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${suffix}`, {type});
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function responseJSON(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `添付処理に失敗しました (${response.status})。`);
  return result;
}

export function initAttachments({getSelected, onChange = () => {}, notify = () => {}, isAvailable = () => true, demo = false}) {
  const composer = document.querySelector('#composer');
  if (instances.has(composer)) return instances.get(composer);
  const list = document.querySelector('#attachment-list');
  const input = document.querySelector('#attachment-input');
  const attach = document.querySelector('#attach-btn');
  const prompt = document.querySelector('#prompt');
  if (!composer || !list || !input || !attach || !prompt) throw new Error('Attachment controls are missing.');
  const drafts = new Map();
  const removedIds = new Set();
  const takenIds = new Set();
  let dragDepth = 0;
  let previewDialog = document.querySelector('#attachment-preview');
  if (!previewDialog) {
    previewDialog = element('dialog', 'attachment-preview');
    previewDialog.id = 'attachment-preview';
    document.body.append(previewDialog);
  }
  previewDialog.classList.add('attachment-preview');
  previewDialog.setAttribute('aria-labelledby', 'attachment-preview-title');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', '送信する添付ファイル');
  input.accept = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.odt,.ods,.odp,.csv,.tsv,.txt,.md';

  const entries = id => drafts.get(id) || [];
  const changed = () => { render(); onChange(); };
  const revoke = entry => {
    if (entry.localURL) URL.revokeObjectURL(entry.localURL);
    entry.localURL = null;
  };
  const removeFromServer = async (metadata, conversationId) => {
    const response = await fetch('/api/attachments/remove', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Chat-UI': '1'},
      body: JSON.stringify({id: metadata.id, conversationId})
    });
    await responseJSON(response);
  };

  function preview(item, localURL = null) {
    const title = element('h2', '', item.name || '添付ファイル');
    title.id = 'attachment-preview-title';
    const close = element('button', 'outline attachment-preview-close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', () => previewDialog.close());
    const header = element('div', 'attachment-preview-header');
    header.append(title, close);
    const content = element('div', 'attachment-preview-content');
    if (item.kind === 'image' && (localURL || imageURL(item))) {
      const image = element('img');
      image.src = localURL || imageURL(item);
      image.alt = item.name || '添付画像';
      content.append(image);
    } else {
      content.append(element('p', 'attachment-preview-caption', '抽出テキスト冒頭のプレビュー'));
      content.append(element('pre', '', item.preview || 'プレビューはありません。'));
    }
    for (const warning of attachmentWarnings(item)) content.append(element('p', 'attachment-warning', warning));
    previewDialog.replaceChildren(header, content);
    if (!previewDialog.open) previewDialog.showModal();
  }

  function attachmentWarnings(item) {
    const warnings = Array.isArray(item.warnings) ? item.warnings.filter(value => typeof value === 'string') : [];
    if (item.truncated) warnings.unshift('長い文書のため、抽出テキストの一部を省略しています。');
    return [...new Set(warnings)];
  }

  function card(entry, editable, conversationId) {
    const item = entry.metadata || {name: entry.file?.name, kind: entry.kind, size: entry.file?.size};
    const node = element('article', `attachment-card ${item.kind === 'image' ? 'is-image' : 'is-document'} is-${entry.state}`);
    node.setAttribute('role', 'listitem');
    if (item.id) node.dataset.attachmentId = item.id;
    const open = element('button', 'attachment-open');
    open.type = 'button';
    open.setAttribute('aria-label', `${item.name || '添付ファイル'} を表示`);
    const src = entry.localURL || (item.kind === 'image' ? imageURL(item) : null);
    if (src) {
      const image = element('img', 'attachment-thumbnail');
      image.src = src;
      image.alt = item.name || '添付画像';
      image.loading = 'lazy';
      open.append(image);
    } else {
      const icon = element('span', 'attachment-file-icon', item.kind === 'image' ? '▧' : extension(item.name).toUpperCase().slice(0, 5));
      icon.setAttribute('aria-hidden', 'true');
      open.append(icon);
    }
    const info = element('span', 'attachment-info');
    const name = element('span', 'attachment-name', item.name || '添付ファイル');
    name.title = item.name || '';
    info.append(name);
    const extracted = Number(item.extractedCharacters || 0);
    const sent = Number.isFinite(item.sentCharacters) ? item.sentCharacters : extracted;
    const characters = item.truncated || sent !== extracted
      ? `送信 ${sent.toLocaleString()}文字 / 抽出 ${extracted.toLocaleString()}文字`
      : `${extracted.toLocaleString()}文字`;
    let detail = item.kind === 'image' ? `画像 · ${sizeLabel(item.size || 0)}` : `${extension(item.name).toUpperCase()} · ${characters}`;
    if (entry.state === 'loading') detail = item.kind === 'image' ? '画像を準備中…' : 'テキストを抽出中…';
    if (entry.state === 'removing') detail = '取り外し中…';
    if (entry.state === 'error') detail = entry.error || '添付できませんでした。';
    const status = element('span', 'attachment-detail', detail);
    if (entry.state !== 'ready') status.setAttribute('role', entry.state === 'error' ? 'alert' : 'status');
    info.append(status);
    const warnings = attachmentWarnings(item);
    if (warnings.length) {
      const warning = element('span', 'attachment-warning-badge', item.truncated ? '一部を省略' : '抽出時の注意あり');
      warning.title = warnings.join('\n');
      info.append(warning);
    }
    open.append(info);
    open.disabled = entry.state !== 'ready' || (item.kind === 'image' && !src);
    open.addEventListener('click', () => preview(item, entry.localURL));
    node.append(open);
    if (editable) {
      const actions = element('div', 'attachment-actions');
      if (entry.state === 'error' && entry.file) {
        const retry = element('button', 'attachment-retry', '再試行');
        retry.type = 'button';
        retry.addEventListener('click', () => upload(entry, conversationId));
        actions.append(retry);
      }
      const remove = element('button', 'attachment-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `${item.name || '添付ファイル'} を取り外す`);
      remove.disabled = entry.state === 'removing';
      remove.addEventListener('click', () => removeEntry(entry, conversationId));
      actions.append(remove);
      node.append(actions);
    }
    return node;
  }

  function render() {
    const id = getSelected();
    const current = entries(id);
    // Keep existing thumbnail nodes while chat streaming repeatedly updates the
    // composer; rebuilding would interrupt keyboard focus and image previews.
    const signature = JSON.stringify([id, current.map(entry => [entry.key, entry.state, entry.error, entry.metadata?.id])]);
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren(...current.map(entry => card(entry, true, id)));
    }
    list.hidden = current.length === 0;
    attach.disabled = !id || !isAvailable() || current.length >= MAX_FILES;
    attach.title = current.length >= MAX_FILES ? '添付できるファイルは6個までです。' : '画像・文書を添付（1ファイル10 MBまで）';
  }

  async function removeEntry(entry, conversationId) {
    if (entry.state === 'removing') return;
    if (entry.metadata) {
      entry.state = 'removing';
      changed();
      try { await removeFromServer(entry.metadata, conversationId); }
      catch (error) {
        entry.state = 'ready';
        notify(error.message);
        changed();
        return;
      }
      removedIds.add(entry.metadata.id);
    }
    // Let an in-flight upload complete so its returned server id can be removed.
    // Aborting the request after upload could otherwise leave an orphaned draft.
    entry.removed = true;
    drafts.set(conversationId, entries(conversationId).filter(item => item !== entry));
    revoke(entry);
    changed();
  }

  async function upload(entry, conversationId) {
    entry.state = 'loading';
    entry.error = '';
    changed();
    try {
      let file = entry.file;
      const ext = extension(file.name);
      if (!file.size) throw new Error('空のファイルは添付できません。');
      if (file.size > MAX_BYTES) throw new Error('1ファイル10 MBまで添付できます。');
      if (!IMAGE_EXTENSIONS.has(ext) && !IMAGE_TYPES.has(file.type) && !DOCUMENT_EXTENSIONS.has(ext)) {
        throw new Error('この形式は添付できません。画像、PDF、Office文書、CSV、テキストに対応しています。');
      }
      if (entry.kind === 'image') {
        file = await prepareImage(file);
        if (entry.removed) return;
        revoke(entry);
        entry.localURL = URL.createObjectURL(file);
        // A pending card becomes a thumbnail before the upload completes.
        list.dataset.signature = '';
        changed();
      }
      if (entry.removed) return;
      const query = new URLSearchParams({conversationId, name: file.name});
      if (demo) query.set('demo', '1');
      const response = await fetch(`/api/attachments?${query}`, {
        method: 'POST', headers: {'Content-Type': file.type || 'application/octet-stream', 'X-Chat-UI': '1'}, body: file
      });
      const metadata = await responseJSON(response);
      if (!metadata.id || !['image', 'document'].includes(metadata.kind)) throw new Error('添付ファイルの応答を確認できませんでした。');
      if (entry.removed) {
        removedIds.add(metadata.id);
        drafts.set(conversationId, entries(conversationId).filter(item => item.metadata?.id !== metadata.id));
        try { await removeFromServer(metadata, conversationId); }
        catch (error) {
          // Keep failed cleanup visible and removable instead of leaving an
          // invisible server draft that could consume the attachment limit.
          removedIds.delete(metadata.id);
          entry.removed = false;
          entry.metadata = metadata;
          entry.state = 'ready';
          entry.file = null;
          drafts.set(conversationId, [...entries(conversationId), entry]);
          notify(`添付の取り外しに失敗しました。もう一度取り外してください: ${error.message}`);
        }
        return;
      }
      // A state refresh can observe the server draft before this request returns.
      drafts.set(conversationId, entries(conversationId).filter(item => item === entry || item.metadata?.id !== metadata.id));
      entry.metadata = metadata;
      entry.state = 'ready';
      entry.file = null;
      revoke(entry);
    } catch (error) {
      if (entry.removed) return;
      entry.state = 'error';
      entry.error = error.message || '添付ファイルを準備できませんでした。';
    } finally {
      changed();
    }
  }

  async function ingest(files, chatId = getSelected()) {
    if (!chatId || !isAvailable()) {
      notify('会話を開いてから添付してください。');
      return [];
    }
    const incoming = Array.from(files || []);
    const current = entries(chatId);
    const accepted = incoming.slice(0, Math.max(0, MAX_FILES - current.length));
    if (accepted.length < incoming.length) notify('1回の送信に添付できるファイルは6個までです。');
    const added = accepted.map(file => ({
      key: crypto.randomUUID(), file,
      kind: IMAGE_EXTENSIONS.has(extension(file.name)) || IMAGE_TYPES.has(file.type) ? 'image' : 'document',
      state: 'loading', removed: false, metadata: null, localURL: null
    }));
    drafts.set(chatId, [...current, ...added]);
    changed();
    await Promise.all(added.map(entry => upload(entry, chatId)));
    return added.filter(entry => entry.state === 'ready' && !entry.removed).map(entry => entry.metadata);
  }

  const api = {
    addFiles: files => ingest(files),
    hydrate(items) {
      if (!Array.isArray(items)) return;
      for (const metadata of items) {
        if (!metadata?.id || !metadata.conversationId || removedIds.has(metadata.id) || takenIds.has(metadata.id)) continue;
        const current = entries(metadata.conversationId);
        if (!current.some(entry => entry.metadata?.id === metadata.id)) {
          drafts.set(metadata.conversationId, [...current, {key: metadata.id, metadata, state: 'ready'}]);
        }
      }
      changed();
    },
    render,
    get: id => entries(id).filter(entry => entry.state === 'ready').map(entry => entry.metadata),
    busy: id => entries(id).some(entry => entry.state !== 'ready'),
    take(id) {
      const taken = entries(id).filter(entry => entry.state === 'ready');
      drafts.set(id, entries(id).filter(entry => entry.state !== 'ready'));
      for (const entry of taken) { takenIds.add(entry.metadata.id); revoke(entry); }
      changed();
      return taken.map(entry => entry.metadata);
    },
    restore(id, items) {
      for (const item of items) takenIds.delete(item.id);
      const current = entries(id);
      const existing = new Set(current.map(entry => entry.metadata?.id));
      const restored = items.filter(item => !existing.has(item.id) && !removedIds.has(item.id)).map(metadata => ({key: metadata.id, metadata, state: 'ready'}));
      drafts.set(id, [...restored, ...current]);
      changed();
    },
    renderMessage(container, items = []) {
      const valid = Array.isArray(items) ? items.filter(item => item && ['image', 'document'].includes(item.kind)) : [];
      const signature = JSON.stringify(valid);
      if (container.dataset.signature === signature) return;
      container.dataset.signature = signature;
      container.classList.add('message-attachments');
      container.setAttribute('role', 'list');
      container.setAttribute('aria-label', '添付ファイル');
      container.replaceChildren(...valid.map(metadata => card({metadata, state: 'ready'}, false)));
      container.hidden = valid.length === 0;
    },
    ingest
  };

  attach.addEventListener('click', () => { if (!attach.disabled) input.click(); });
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = '';
    ingest(files);
  });
  prompt.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    if (!isAvailable()) return;
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      prompt.setRangeText(text, prompt.selectionStart, prompt.selectionEnd, 'end');
      prompt.dispatchEvent(new Event('input', {bubbles: true}));
    }
    ingest(files);
  });
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  composer.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    if (isAvailable()) composer.classList.add('attachment-drop-active');
  });
  composer.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = isAvailable() ? 'copy' : 'none';
  });
  composer.addEventListener('dragleave', event => {
    if (!hasFiles(event)) return;
    if (--dragDepth <= 0) composer.classList.remove('attachment-drop-active');
  });
  composer.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    composer.classList.remove('attachment-drop-active');
    ingest(event.dataTransfer.files);
  });
  previewDialog.addEventListener('click', event => {
    if (event.target !== previewDialog) return;
    const rect = previewDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) previewDialog.close();
  });
  window.addEventListener('pagehide', () => { for (const current of drafts.values()) current.forEach(revoke); });
  instances.set(composer, api);
  render();
  return api;
}
