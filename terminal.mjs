import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageRoot = process.env.CHAT_UI_PACKAGE_ROOT || path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(packageRoot, 'package.json'));
const maxBuffer = 256 * 1024;

function dimensions(cols, rows) {
  if (!Number.isInteger(cols) || cols < 2 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 300) throw Error('Invalid terminal size');
}

export class TerminalSessions {
  constructor(cwd, { env = process.env, shell = process.platform === 'win32' ? (env.ComSpec || 'cmd.exe') : (env.SHELL || '/bin/sh') } = {}) {
    this.cwd = cwd;
    this.env = { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    for (const key of ['CHAT_UI_SESSION_TOKEN', 'CHAT_UI_PACKAGE_ROOT', 'ELECTRON_RUN_AS_NODE']) delete this.env[key];
    this.shell = shell;
    this.sessions = new Map();
  }

  open({ cols = 80, rows = 24 } = {}) {
    dimensions(cols, rows);
    if (this.sessions.size >= 4) throw Error('ターミナルは同時に4つまでです。使用していないシェルを終了してください。');
    const term = require('node-pty').spawn(this.shell, process.platform === 'win32' ? [] : ['-i'], { cwd: this.cwd, env: this.env, name: 'xterm-256color', cols, rows });
    const session = { id: randomUUID(), term, events: [], bytes: 0, sequence: 0, subscriber: null, ended: false };
    session.exited = new Promise(resolve => { session.resolveExit = resolve; });
    this.sessions.set(session.id, session);
    const publish = (type, data) => {
      if (!this.sessions.has(session.id)) return;
      const event = { type, data, id: ++session.sequence };
      event.text = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      session.events.push(event); session.bytes += Buffer.byteLength(event.text);
      while (session.bytes > maxBuffer && session.events.length > 1) session.bytes -= Buffer.byteLength(session.events.shift().text);
      session.flush?.();
      if (!session.subscriber && session.bytes >= maxBuffer / 2 && !session.ended) term.pause();
    };
    term.onData(data => publish('output', { data }));
    term.onExit(result => {
      session.ended = true;
      session.resolveExit();
      publish('exit', result);
    });
    this.expire(session);
    return { id: session.id, cwd: this.cwd, shell: this.shell };
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw Error('ターミナルが終了しています。新しいシェルを開いてください。');
    return session;
  }

  write(id, data) {
    const session = this.get(id);
    if (session.ended) throw Error('シェルは終了しています。');
    if (typeof data !== 'string' || Buffer.byteLength(data) > 32768) throw Error('Terminal input exceeds 32 KB');
    session.term.write(data);
  }

  resize(id, cols, rows) {
    dimensions(cols, rows);
    const session = this.get(id);
    if (!session.ended) session.term.resize(cols, rows);
  }

  subscribe(id, req, res) {
    const session = this.get(id);
    if (session.subscriber) throw Error('このターミナルは既に表示されています。');
    clearTimeout(session.expiry);
    session.subscriber = res;
    let cursor = Number(req.headers['last-event-id'] || 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const flush = () => {
      if (res.destroyed || res.writableNeedDrain) return;
      if (session.events[0]?.id > cursor + 1) {
        cursor = session.events[0].id - 1;
        if (!res.write('event: gap\ndata: {}\n\n')) return;
      }
      for (const event of session.events) if (event.id > cursor) {
        cursor = event.id;
        if (!res.write(event.text)) { if (!session.ended) session.term.pause(); return; }
      }
      if (!session.ended) session.term.resume();
    };
    session.flush = flush;
    res.on('drain', flush);
    const heartbeat = setInterval(() => { if (!res.writableNeedDrain) res.write(': heartbeat\n\n'); }, 15000);
    res.once('close', () => {
      clearInterval(heartbeat);
      res.off('drain', flush);
      if (session.subscriber === res) { session.subscriber = null; session.flush = null; if (this.sessions.has(id)) this.expire(session); }
    });
    flush();
  }

  expire(session) {
    clearTimeout(session.expiry);
    session.expiry = setTimeout(() => this.close(session.id), 30000);
    session.expiry.unref();
  }

  close(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    clearTimeout(session.expiry);
    session.subscriber?.end();
    if (!session.ended) { try { session.term.kill(); } catch {} }
  }

  async shutdown() {
    const sessions = [...this.sessions.values()];
    for (const session of sessions) this.close(session.id);
    let timer;
    await Promise.race([Promise.all(sessions.map(session => session.exited)), new Promise(resolve => {
      timer = setTimeout(() => { for (const session of sessions) if (!session.ended) { try { session.term.kill('SIGKILL'); } catch {} } resolve(); }, 2000);
    })]);
    clearTimeout(timer);
  }
}
