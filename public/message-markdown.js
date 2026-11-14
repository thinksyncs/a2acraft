// Render conversation Markdown as DOM nodes. Raw HTML stays text and image
// destinations are links, so displaying a conversation never loads remote media.
const rendered = new WeakMap();
const punctuation = /[\\`*_~\[!<\n]/;

export function safeMarkdownUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function node(document, tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

function appendText(parent, value, document) {
  if (value) parent.append(document.createTextNode(value));
}

function link(document, label, destination, options) {
  const href = safeMarkdownUrl(destination);
  if (!href) return document.createTextNode(label);
  const result = node(document, 'a');
  result.href = href; result.target = '_blank'; result.rel = 'noopener noreferrer';
  result.title = href;
  if (options.openLink) result.addEventListener('click', event => {
    event.preventDefault();
    Promise.resolve().then(() => options.openLink(href)).catch(error => options.onLinkError?.(error));
  });
  result.append(document.createTextNode(label));
  return result;
}

function bracketEnd(text, start, opening, closing, budget) {
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (--budget.remaining < 0) return -1;
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === opening) depth++;
    else if (text[i] === closing && --depth === 0) return i;
  }
  return -1;
}

function findDelimiter(text, marker, from, budget) {
  const end = text.indexOf(marker, from);
  budget.remaining -= (end < 0 ? text.length : end) - from + 1;
  return end;
}

function unescapeDestination(value) {
  return value.replace(/\\([\\()[\]<>])/g, '$1');
}

function inline(parent, text, document, options, depth = 0) {
  if (depth > 16) { appendText(parent, text, document); return; }
  let index = 0;
  while (index < text.length) {
    if (options.budget.remaining < 0) { appendText(parent, text.slice(index), document); return; }
    const rest = text.slice(index);
    let match;
    if ((match = /^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/.exec(rest))) {
      appendText(parent, match[1], document); index += match[0].length; continue;
    }
    if ((match = /^`+/.exec(rest))) {
      const marker = match[0], end = findDelimiter(text, marker, index + marker.length, options.budget);
      if (end >= 0) {
        let code = text.slice(index + marker.length, end).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && /[^ ]/.test(code)) code = code.slice(1, -1);
        parent.append(node(document, 'code', code)); index = end + marker.length; continue;
      }
    }
    const image = rest.startsWith('!['), start = image ? index + 1 : index;
    if (text[start] === '[') {
      const labelEnd = bracketEnd(text, start, '[', ']', options.budget);
      if (labelEnd >= 0 && text[labelEnd + 1] === '(') {
        const end = bracketEnd(text, labelEnd + 1, '(', ')', options.budget);
        if (end >= 0) {
          const target = text.slice(labelEnd + 2, end).trim();
          const destination = /^(?:<([^<>]*)>|(\S+?))(?:\s+["'][\s\S]*["'])?$/.exec(target);
          if (destination) {
            const label = text.slice(start + 1, labelEnd);
            const anchor = link(document, image ? '画像: ' + (label || '表示先') : label,
              unescapeDestination(destination[1] ?? destination[2]), options);
            if (!image && anchor.nodeType === 1) {
              anchor.replaceChildren(); inline(anchor, label, document, {...options, linksDisabled:true}, depth + 1);
            }
            if (!options.linksDisabled) { parent.append(anchor); index = end + 1; continue; }
          }
        }
      }
    }
    if (!options.linksDisabled && (match = /^<(https?:\/\/[^<>\s]+)>/.exec(rest))) {
      parent.append(link(document, match[1], match[1], options)); index += match[0].length; continue;
    }
    if ((match = /^(\*\*|__|~~|\*|_)/.exec(rest))) {
      const marker = match[0], prior = text[index - 1] || '';
      // Underscores inside identifiers are literal; delimiter whitespace is not emphasis.
      if (!(marker.includes('_') && /[\p{L}\p{N}]/u.test(prior)) && !/\s/.test(text[index + marker.length] || ' ')) {
        let end = findDelimiter(text, marker, index + marker.length, options.budget);
        while (end >= 0 && (/\s/.test(text[end - 1]) || text[end - 1] === '\\')) {
          if (options.budget.remaining < 0) { end = -1; break; }
          end = findDelimiter(text, marker, end + marker.length, options.budget);
        }
        if (end > index + marker.length) {
          const tag = marker === '~~' ? 'del' : marker.length === 2 ? 'strong' : 'em';
          const element = node(document, tag);
          inline(element, text.slice(index + marker.length, end), document, options, depth + 1);
          parent.append(element); index = end + marker.length; continue;
        }
      }
    }
    if (rest.startsWith('\n')) { parent.append(node(document, 'br')); index++; continue; }
    let end = index + 1;
    while (end < text.length && !punctuation.test(text[end])) end++;
    appendText(parent, text.slice(index, end), document); index = end;
  }
}

const fence = line => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const listItem = line => /^( *)([-+*]|\d+[.)])\s+(.*)$/.exec(line);
const rule = line => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
function cells(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const values = []; let current = '', code = false;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && value[i + 1] === '|') { current += '|'; i++; continue; }
    if (value[i] === '`') code = !code;
    if (value[i] === '|' && !code) { values.push(current.trim()); current = ''; }
    else current += value[i];
  }
  values.push(current.trim()); return values;
}
function tableAlignments(line) {
  if (!line?.includes('|')) return null;
  const values = cells(line);
  return values.every(value => /^:?-{3,}:?$/.test(value))
    ? values.map(value => value.startsWith(':') && value.endsWith(':') ? 'center' : value.endsWith(':') ? 'right' : 'left') : null;
}

function blocks(parent, lines, document, options, depth = 0) {
  if (depth > 16) { parent.append(node(document, 'pre', lines.join('\n'))); return; }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]; let match;
    if (!line.trim()) { i++; continue; }
    if ((match = fence(line))) {
      const marker = match[1], language = match[2].trim().split(/\s+/)[0];
      const code = [], close = new RegExp('^ {0,3}' + marker[0] + '{' + marker.length + ',}\\s*$');
      i++; while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      const pre = node(document, 'pre'), body = node(document, 'code', code.join('\n'));
      if (/^[\w+-]{1,40}$/.test(language)) body.dataset.language = language;
      pre.append(body); parent.append(pre); continue;
    }
    if ((match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) {
      const heading = node(document, 'h' + match[1].length); inline(heading, match[2], document, options);
      parent.append(heading); i++; continue;
    }
    if (i + 1 < lines.length && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[i + 1])) {
      const heading = node(document, lines[i + 1].trim()[0] === '=' ? 'h1' : 'h2');
      inline(heading, line, document, options); parent.append(heading); i += 2; continue;
    }
    if (rule(line)) { parent.append(node(document, 'hr')); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quote = [], element = node(document, 'blockquote');
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      blocks(element, quote, document, options, depth + 1); parent.append(element); continue;
    }
    const alignment = tableAlignments(lines[i + 1]);
    if (line.includes('|') && alignment) {
      const table = node(document, 'table'), head = node(document, 'thead'), body = node(document, 'tbody');
      const row = (values, tag) => {
        const tr = node(document, 'tr');
        alignment.forEach((align, column) => {
          const cell = node(document, tag); cell.style.textAlign = align;
          if (tag === 'th') cell.setAttribute('scope', 'col');
          inline(cell, values[column] || '', document, options); tr.append(cell);
        }); return tr;
      };
      head.append(row(cells(line), 'th')); i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) body.append(row(cells(lines[i++]), 'td'));
      table.append(head, body); const scroll = node(document, 'div'); scroll.className = 'markdown-table';
      scroll.append(table); parent.append(scroll); continue;
    }
    if ((match = listItem(line))) {
      const base = match[1].length, ordered = /^\d/.test(match[2]), list = node(document, ordered ? 'ol' : 'ul');
      if (ordered && parseInt(match[2], 10) !== 1) list.setAttribute('start', String(parseInt(match[2], 10)));
      while (i < lines.length) {
        match = listItem(lines[i]);
        if (!match || match[1].length !== base || /^\d/.test(match[2]) !== ordered) break;
        const indent = match[0].length - match[3].length, content = [match[3]], item = node(document, 'li');
        i++;
        while (i < lines.length) {
          const next = listItem(lines[i]);
          if (next && next[1].length <= base) break;
          if (lines[i].trim() && (lines[i].match(/^ */)[0].length <= base)) break;
          if (!lines[i].trim() && (i + 1 >= lines.length || lines[i + 1].match(/^ */)[0].length <= base)) { i++; break; }
          content.push(lines[i++].slice(indent));
        }
        const task = /^\[([ xX])\]\s+/.exec(content[0]);
        if (task) {
          content[0] = content[0].slice(task[0].length);
          const mark = node(document, 'span', task[1] === ' ' ? '☐ ' : '☑ ');
          mark.className = 'markdown-task'; mark.setAttribute('aria-label', task[1] === ' ' ? '未完了' : '完了'); item.append(mark);
        }
        blocks(item, content, document, options, depth + 1); list.append(item);
      }
      parent.append(list); continue;
    }
    if (/^ {4}/.test(line)) {
      const code = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) code.push(lines[i++].slice(4));
      while (code.at(-1) === '') code.pop();
      const pre = node(document, 'pre'); pre.append(node(document, 'code', code.join('\n'))); parent.append(pre); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !fence(lines[i]) && !rule(lines[i]) && !listItem(lines[i]) &&
      !/^ {0,3}(?:#{1,6}\s|>)/.test(lines[i]) && !tableAlignments(lines[i + 1])) paragraph.push(lines[i++]);
    const p = node(document, 'p'); inline(p, paragraph.join('\n'), document, options); parent.append(p);
  }
}

export function renderMessageMarkdown(element, source, options = {}) {
  const text = String(source ?? '');
  if (rendered.get(element) === text) return false;
  const document = element.ownerDocument, fragment = document.createDocumentFragment();
  // Bound repeated unmatched delimiters in imported/streaming content. When the
  // scan budget is spent, preserve the remaining source as text instead of doing
  // quadratic searches or dropping it.
  blocks(fragment, text.replace(/\r\n?/g, '\n').split('\n'), document,
    {...options,budget:{remaining:Math.max(4096,text.length*16)}});
  element.replaceChildren(fragment); element.classList.add('message-markdown');
  rendered.set(element, text); return true;
}
