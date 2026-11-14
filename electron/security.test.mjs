import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedExternal, isAppUrl, isMainFrame, validateUiState } from './security.mjs';

test('Only exact HTTPS official login hosts are opened outside Electron', () => {
  assert.equal(isTrustedExternal('https://auth.openai.com/oauth/authorize?state=example'), true);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://auth.openai.com.evil.example/', 'http://chatgpt.com/', 'https://user:secret@auth.openai.com/', 'https://chatgpt.com:444/']) assert.equal(isTrustedExternal(url), false);
});

test('Teams opens only Microsoft device login and official Teams app links', () => {
  for (const url of ['https://microsoft.com/devicelogin', 'https://microsoft.com:443/devicelogin', 'https://teams.microsoft.com/l/message/19%3Aexample/123?tenantId=example']) assert.equal(isTrustedExternal(url), true, url);
  for (const url of [
    'https://microsoft.com/', 'https://microsoft.com/devicelogin?next=example', 'https://microsoft.com/devicelogin#example',
    'https://microsoft.com/devicelogin?', 'https://microsoft.com/devicelogin#',
    'https://microsoft.com/devicelogin/', 'https://www.microsoft.com/devicelogin', 'https://microsoft.com.evil.example/devicelogin',
    'http://microsoft.com/devicelogin', 'https://user:secret@microsoft.com/devicelogin', 'https://microsoft.com:444/devicelogin',
    'https://teams.microsoft.com/', 'https://teams.microsoft.com/l/', 'https://teams.microsoft.com/l/../download',
    'https://teams.microsoft.com.evil.example/l/message/123', 'https://sub.teams.microsoft.com/l/message/123',
    'https://teams.cloud.microsoft/l/message/123', 'http://teams.microsoft.com/l/message/123',
    'https://user@teams.microsoft.com/l/message/123', 'https://teams.microsoft.com:444/l/message/123'
  ]) assert.equal(isTrustedExternal(url), false, url);
});

test('Persistent UI state accepts only bounded drafts and known preferences', () => {
  assert.deepEqual(validateUiState({ drafts: { 'conversation-1': '下書き' }, selected: 'conversation-1', layout: 2, motion: 'reduced', unexpected: '/private/file' }), { drafts: { 'conversation-1': '下書き' }, sendRequests: {}, selected: 'conversation-1', layout: 2, motion: 'reduced' });
  for (const value of [
    { drafts: {}, selected: null, layout: 3 },
    { drafts: { test: 'x'.repeat(65537) }, selected: 'test', layout: 4 },
    { drafts: {}, selected: '../../file', layout: 1 },
    { drafts: {}, selected: null, layout: 1, motion: 'unsafe' },
    { drafts: JSON.parse('{"__proto__":"x"}'), selected: null, layout: 4 }
  ]) assert.throws(() => validateUiState(value));
});

test('IPC accepts only the current main frame at its exact loopback origin', () => {
  const origin = 'http://127.0.0.1:45001';
  const mainFrame = { url: origin + '/?desktop=1' };
  const window = { isDestroyed: () => false, webContents: { mainFrame } };
  assert.equal(isMainFrame({ sender: window.webContents, senderFrame: mainFrame }, window, origin), true);
  assert.equal(isMainFrame({ sender: window.webContents, senderFrame: { url: mainFrame.url } }, window, origin), false);
  assert.equal(isAppUrl('http://127.0.0.1:45002/', origin), false);
});
