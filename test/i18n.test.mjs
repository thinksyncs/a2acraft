import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocale, t, getLocale, setLocale, registerMessages, onLocaleChange} from '../public/i18n.js';

test('language negotiation respects saved choices, ranked regional variants and fallback', () => {
  assert.equal(resolveLocale('ja', ['en-GB']), 'ja');
  assert.equal(resolveLocale(null, ['fr-CA', 'ja-JP', 'en']), 'ja');
  assert.equal(resolveLocale('invalid', ['en_US', 'ja-JP']), 'en');
  assert.equal(resolveLocale(null, ['de-DE']), 'en');
});

test('locale changes are sequenced, subscribers detach, and substitutions stay literal', async () => {
  registerMessages('en', {'test.greeting': 'Hello, {name}!'});
  const events = [];
  const off = onLocaleChange(lang => events.push(lang));
  await Promise.all([setLocale('en'), setLocale('ja'), setLocale('en')]);
  assert.deepEqual(events, ['en', 'ja', 'en']);
  assert.equal(t('test.greeting','こんにちは、{name}', {name:'タグ $& {name}'}), 'Hello, タグ $& {name}!');
  assert.equal(t('missing','unchanged'), 'unchanged');
  off();
  await setLocale('ja');
  assert.equal(t('test.greeting', 'こんにちは、{name}', {name:'Alex'}), 'こんにちは、Alex');
  assert.equal(getLocale(), 'ja');
  assert.throws(() => setLocale('fr'), RangeError);
  assert.equal(events.length, 3);
});

test('desktop preference survives new loopback origins and failed writes keep current language', async () => {
  const written = [];
  const stored = {uiLanguage:'ja'};
  globalThis.window = {document:{documentElement:{}},navigator:{languages:['en-US']},desktop:{
    getSettings: async () => stored, useLocale: async () => {},
    setLocale: async lang => { if (lang === 'ja') throw Error('write failed'); stored.uiLanguage=lang; written.push(lang); },
  }};
  try {
    const first = await import('../public/i18n.js?initial-origin');
    assert.equal(first.getLocale(),'ja');
    await first.setLocale('en');
    assert.deepEqual(written,['en']);
    const reopened = await import('../public/i18n.js?next-origin');
    assert.equal(reopened.getLocale(),'en');
    await assert.rejects(reopened.setLocale('ja'), /write failed/);
    assert.equal(reopened.getLocale(),'en');
  } finally { delete globalThis.window; }
});
