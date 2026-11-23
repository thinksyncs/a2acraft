import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getLocale, setLocale, t } from '../public/i18n.js';
import { bindLanguageControls } from '../public/i18n-shell.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const hasJapanese = /[ぁ-ヿ一-龯]/u;

test('every authored Japanese shell label has an English translation', async () => {
  await setLocale('en');
  try {
    const parts = html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g);
    let labels = 0;
    for (const [index, part] of parts.entries()) {
      if (part.startsWith('<')) {
        for (const attr of part.matchAll(/\b(aria-label|placeholder|title|alt)="([^"]+)"/g)) {
          if (!hasJapanese.test(attr[2])) continue;
          const key = part.match(new RegExp('data-i18n-' + attr[1] + '="([^"]+)"'))?.[1];
          assert.ok(key && !hasJapanese.test(t(key, attr[2])), attr[2]);
          labels++;
        }
      } else if (hasJapanese.test(part)) {
        if (part === '日本語' && parts[index - 1]?.includes('lang="ja"')) continue;
        const previous = parts[index - 1];
        const key = previous.match(/data-i18n="([^"]+)"|<!--i18n:([^>]+)-->/);
        assert.ok(key && !hasJapanese.test(t(key[1] || key[2], part)), part);
        labels++;
      }
    }
    assert.ok(labels > 350);
  } finally { await setLocale('ja'); }
});

test('the Connect and Settings pickers switch together and leave live chat text alone', async () => {
  const selectors = ['connect-language', 'settings-language'].map(id => ({
    id, value: '', addEventListener(_, listener) { this.change = listener; },
  }));
  const make = (data, key) => {
    const node = { data, isConnected: true, nodeType: 3 };
    return { node, marker: { data: 'i18n:' + key, nextSibling: node } };
  };
  const status = make('未接続', 'shell.connection.offline');
  const send = make(' 送信 ', 'shell.chat.send');
  const markers = [send.marker, status.marker];
  const description = { content: '概要' };
  const root = {
    createTreeWalker() {
      let index = 0;
      return { nextNode() { this.currentNode = markers[index++]; return this.currentNode; } };
    },
    querySelectorAll(selector) { return selector === '[data-ui-language]' ? selectors : []; },
    getElementById() { return null; },
    querySelector() { return description; },
  };
  bindLanguageControls(root);
  selectors[0].value = 'en';
  await selectors[0].change();
  assert.equal(getLocale(), 'en');
  assert.equal(selectors[1].value, 'en');
  assert.equal(send.node.data, ' Send ');
  assert.equal(status.node.data, 'Disconnected');
  assert.equal(description.content.startsWith('A2ACraft by Toppy'), true);
  status.node.data = '利用者の送信前の下書き';
  selectors[1].value = 'ja';
  await selectors[1].change();
  assert.equal(selectors[0].value, 'ja');
  assert.equal(send.node.data, ' 送信 ');
  assert.equal(status.node.data, '利用者の送信前の下書き');
  assert.equal(description.content, '概要');
});
