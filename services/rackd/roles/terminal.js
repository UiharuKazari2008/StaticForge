'use strict';
// terminal: one-shot commands, tmux sessions (user rack), ptys (see lib/pty.js).
const fs = require('fs');
const { run } = require('../lib/exec');
const { str, num, bool, RE, bad, absPath } = require('../lib/util');
const apt = require('../lib/apt');
const pty = require('../lib/pty');
const events = require('../lib/events');

const packages = ['tmux', 'python3', 'util-linux'];
const tmux = (args, o = {}) => run(['tmux', ...args], { user: 'rack', timeoutMs: 10000, ...o });
const target = name => `=${str(name, 'name', RE.tmux)}:`;  // exact session, active pane

async function sessions() {
  const r = await tmux(['list-sessions', '-F', '#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}\t#{pane_start_command}']);
  if (r.code !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map(l => {
    const [name, created, attached, windows, cmd] = l.split('\t');
    return { name, created: new Date(Number(created) * 1000).toISOString(), attached: Number(attached) > 0, windows: Number(windows), cmd: cmd || '' };
  });
}
const changed = async () => events.emit('terminal', 'state', null, { tmux: await sessions() });

module.exports = {
  id: 'terminal', packages,
  async busy() {
    const out = pty.list().map(p => ({ kind: 'pty', id: p.id, why: 'attached terminal' }));
    const r = await tmux(['list-windows', '-a', '-F', '#{session_name}\t#{window_activity}']);
    if (r.code === 0) { const seen = new Set(); const now = Date.now() / 1000; for (const l of r.stdout.split('\n').filter(Boolean)) { const [n, a] = l.split('\t'); if (now - Number(a) < 1800 && !seen.has(n)) { seen.add(n); out.push({ kind: 'tmux', id: n, why: 'output in the last 30 min' }); } } }
    return out;
  },
  async detect() {
    const missing = await apt.missing(packages);
    const tm = await sessions();
    return { installed: !missing.length, ready: !missing.length, summary: `${tm.length} tmux session(s), ${pty.list().length} pty(s)`, missing };
  },
  async get() { return { tmux: await sessions(), ptys: pty.list() }; },
  actions: {
    async exec(p) {
      const cmd = str(p.cmd, 'cmd', null, 100000);
      const user = p.user === undefined ? 'rack' : p.user;
      if (user !== 'rack' && user !== 'root') throw bad("user must be 'rack' or 'root'");
      const cwd = p.cwd ? absPath(p.cwd, 'cwd') : (user === 'rack' ? '/var/lib/rack' : '/root');
      if (!fs.existsSync(cwd)) throw bad('cwd does not exist');
      const timeoutS = num(p.timeoutS, 'timeoutS', 1, 3600, 60);
      const r = await run(['bash', '-c', cmd], { user, cwd, timeoutMs: timeoutS * 1000 });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr, ms: r.ms, timedOut: r.timedOut, truncated: r.truncated };
    },
    async 'tmux-new'(p) {
      const name = str(p.name, 'name', RE.tmux);
      const args = ['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', '/var/lib/rack'];
      if (p.cwd) { const cwd = absPath(p.cwd, 'cwd'); if (!fs.existsSync(cwd)) throw bad('cwd does not exist'); args.push('-c', cwd); }
      if (p.cmd) args.push(str(p.cmd, 'cmd', null, 20000));
      const r = await tmux(args);
      if (r.code !== 0) throw bad(r.stderr.trim() || 'tmux new-session failed', 'TMUX');
      events.emit('terminal', 'added', name, { name }); await changed();
      return { name };
    },
    // keys: literal text; keyNames: tmux key names (C-c, Up, ...) sent after it; enter (default true) presses Enter last.
    async 'tmux-send'(p) {
      const t = target(p.name);
      if (p.keys !== undefined && p.keys !== '') {
        const r = await tmux(['send-keys', '-t', t, '-l', '--', str(p.keys, 'keys', null, 100000)]);
        if (r.code !== 0) throw bad(r.stderr.trim() || 'send-keys failed', 'TMUX');
      }
      for (const k of Array.isArray(p.keyNames) ? p.keyNames : []) {
        const r = await tmux(['send-keys', '-t', t, str(k, 'keyName', /^[A-Za-z0-9_-]{1,20}$/)]);
        if (r.code !== 0) throw bad(r.stderr.trim() || 'send-keys failed', 'TMUX');
      }
      if (bool(p.enter, true)) { const r = await tmux(['send-keys', '-t', t, 'Enter']); if (r.code !== 0) throw bad(r.stderr.trim() || 'send-keys failed', 'TMUX'); }
      return { ok: true };
    },
    async 'tmux-capture'(p) {
      const lines = num(p.lines, 'lines', 1, 20000, 200);
      const r = await tmux(['capture-pane', '-p', '-J', '-t', target(p.name), '-S', `-${lines}`], { maxBytes: 4194304 });
      if (r.code !== 0) throw bad(r.stderr.trim() || 'capture-pane failed', 'TMUX');
      return { text: r.stdout.replace(/\n+$/, '\n') };
    },
    async 'tmux-kill'(p) {
      const name = str(p.name, 'name', RE.tmux);
      const r = await tmux(['kill-session', '-t', `=${name}`]);
      if (r.code !== 0) throw bad(r.stderr.trim() || 'kill-session failed', 'TMUX');
      events.emit('terminal', 'removed', name, { name }); await changed();
      return { ok: true };
    },
    async 'pty-kill'(p) {
      if (!pty.kill(str(p.id, 'id', /^pty\d+$/))) throw bad('no such pty', 'NOT_FOUND');
      return { ok: true };
    },
  },
};
