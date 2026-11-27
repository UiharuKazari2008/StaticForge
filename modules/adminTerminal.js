'use strict';

/**
 * Administrator Terminal (Yozora #1133): raw `bash -l` on the server as the server's user, in a pty
 * (node-pty), for the desktop's xterm.js window. The packets are in modules/ws/handlers/320-adminTerminalHandler.js
 * (docs/client-api/ws/adminTerminal.md); who may open one is decided there (fullAdminClient below) and again
 * for the stored sign-in at open.
 *
 * Sessions belong to the WebSocket connection that opened them: another connection can not type into,
 * resize, ack or close them. A pty dies when its window closes, when its socket closes and when Dreamscape
 * exits. At most MAX_SESSIONS per sign-in.
 *
 * Output is gathered for FLUSH_MS (or FLUSH_BYTES) and sent as one packet. Flow control: the client
 * acks the characters it has written into xterm (admin_terminal_ack); with HIGH_WATER characters unacked
 * the pty is paused (the shell blocks on a full pty buffer) and resumed under LOW_WATER, so `yes` or
 * `cat bigfile` can not fill the socket or this process's memory.
 *
 * What is typed or printed is never logged: only that a session opened or ended.
 */

const os = require('os');

const MAX_SESSIONS = 4;
const FLUSH_MS = 12;
const FLUSH_BYTES = 32 * 1024;
const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;
const MAX_INPUT = 256 * 1024;
const KILL_GRACE_MS = 2000;
const MIN_COLS = 2;
const MAX_COLS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 200;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 25;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

class TerminalError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

let ptyModule = null;
function pty() {
    if (!ptyModule) ptyModule = require('node-pty');
    return ptyModule;
}

/** @type {Map<string, object>} keyed by the socket's number and the client's id: ids are the client's, so two sockets may use the same one */
const sessions = new Map();
const socketIds = new WeakMap();
const closeHooked = new WeakSet();
let nextSocketId = 1;

function socketKey(ws) {
    let n = socketIds.get(ws);
    if (!n) { n = nextSocketId++; socketIds.set(ws, n); }
    return n;
}
const keyOf = (ws, id) => `${socketKey(ws)}:${id}`;

/**
 * A client that may use the terminal: a signed-in administrator of a full sign-in. Same rule as the
 * HTTP side (modules/guacRemoteBridge.js guacFullSession: `req.userType === 'admin' && !req.applicationAuth`),
 * for the WebSocket's clientInfo: not an application key (authMethod application_key / trusted_keyless, any
 * applicationAuth, key id or scopes), not a replication token, not a read-only or dev_admin type.
 * The stored session is checked by sessionIsFull at open.
 */
function fullAdminClient(info) {
    if (!info || info.authenticated !== true) return false;
    if (info.userType !== 'admin') return false;
    if (info.applicationAuth || info.applicationKeyId || info.applicationScopes || info.appName) return false;
    if (info.authMethod && info.authMethod !== 'session') return false;
    const sid = String(info.sessionId || '');
    if (!sid || /^(appkey|keyless):/.test(sid)) return false;
    return true;
}

/**
 * The stored sign-in is a person's: a PIN (or the loopback dev) login, never an approved-IP or a
 * client-certificate sign-in (modules/clientCertificates.js personSession is the same rule). A whitelist:
 * a session that records any other way in (authMethod application_key, login_key, temp_token, ...) is refused.
 * modules/auth.js applyAuthContext records authMethod on a session an application key or token opened (#1133),
 * so such a session is refused here.
 */
function sessionIsFull(sess) {
    if (!sess || sess.authenticated !== true) return false;
    if (sess.userType !== 'admin') return false;
    if (sess.approvedIpId || sess.applicationKeyId || sess.applicationAuth) return false;
    // CaféReady's sign-in is the device certificate (modules/clientCertificates.js): the administrator PIN typed on this
    // session (admin_terminal_pin) shows a person is there. A Log off / logon regenerates the session and drops it.
    if (certSession(sess)) return Number.isFinite(sess.adminPinAt);
    if (sess.authMethod && sess.authMethod !== 'session') return false;
    return true;
}

/** A certificate's session (CaféReady), with or without the logon's PIN check carried over (web_server.js 'login'). */
function certSession(sess) {
    return !!(sess && sess.clientCertSerial && (!sess.authMethod || sess.authMethod === 'session' || sess.authMethod === 'client_cert'));
}

/** An administrator's certificate session that has not had the administrator PIN typed on it yet. */
function sessionNeedsPin(sess) {
    return !!(sess && sess.authenticated === true && sess.userType === 'admin' && !sess.approvedIpId
        && !sess.applicationKeyId && !sess.applicationAuth && certSession(sess) && !Number.isFinite(sess.adminPinAt));
}

function clampInt(value, min, max, fallback) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/** The shell's environment: the server user's, without the server's own variables (keys, pm2). */
function shellEnv() {
    const info = os.userInfo();
    const env = {
        HOME: process.env.HOME || info.homedir,
        USER: info.username,
        LOGNAME: info.username,
        SHELL: '/bin/bash',
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        LANG: process.env.LANG || 'C.UTF-8',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
    };
    for (const k of ['LC_ALL', 'LC_CTYPE', 'TZ', 'XDG_RUNTIME_DIR']) if (process.env[k]) env[k] = process.env[k];
    return env;
}

function liveFor(ownerKey) {
    let n = 0;
    for (const s of sessions.values()) if (s.ownerKey === ownerKey && !s.closed) n += 1;
    return n;
}

function flush(s) {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (!s.chunks.length) return;
    const data = s.chunks.length === 1 ? s.chunks[0] : s.chunks.join('');
    s.chunks = [];
    s.size = 0;
    s.unacked += data.length;
    try { s.send('admin_terminal_output', { id: s.id, data }); } catch (_) { /* the socket is going: its close ends this session */ }
    if (!s.paused && s.unacked > HIGH_WATER) {
        s.paused = true;
        try { s.term.pause(); } catch (_) { /* gone */ }
    }
}

function onData(s, data) {
    if (s.closed) return;
    s.chunks.push(data);
    s.size += data.length;
    if (s.size >= FLUSH_BYTES) flush(s);
    else if (!s.timer) s.timer = setTimeout(() => { s.timer = null; flush(s); }, FLUSH_MS);
}

function dispose(s) {
    s.closed = true;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    sessions.delete(keyOf(s.ws, s.id));
}

function hookSocket(ws) {
    if (closeHooked.has(ws) || typeof ws.once !== 'function') return;
    closeHooked.add(ws);
    ws.once('close', () => closeAllFor(ws));
}

/**
 * Open a shell (or `opts.command`: { file, args }). `send(type, data)` delivers a packet to the owner's socket.
 * @returns {{ id: string, pid: number, cols: number, rows: number }}
 */
function open(ws, ownerKey, opts, send) {
    const o = opts || {};
    const id = String(o.id || '');
    if (!ID_RE.test(id)) throw new TerminalError('A terminal id of letters, digits, - and _ is required', 'BAD_ID');
    if (!ownerKey) throw new TerminalError('No sign-in to own the terminal', 'NO_OWNER');
    if (sessions.has(keyOf(ws, id))) throw new TerminalError('That terminal is already open', 'DUPLICATE');
    if (liveFor(ownerKey) >= MAX_SESSIONS) throw new TerminalError(`At most ${MAX_SESSIONS} terminals can be open`, 'TOO_MANY');
    const cols = clampInt(o.cols, MIN_COLS, MAX_COLS, DEFAULT_COLS);
    const rows = clampInt(o.rows, MIN_ROWS, MAX_ROWS, DEFAULT_ROWS);
    let cwd = os.homedir();
    try { if (!require('fs').statSync(cwd).isDirectory()) cwd = '/'; } catch (_) { cwd = '/'; }
    // `command` (from the packet handler only, never the client's text): another program than the login shell,
    // e.g. tmux attached to a Claude session's pane (Fleet's Show Screen). Closing the window ends that program.
    const cmd = o.command && typeof o.command.file === 'string' ? o.command : { file: '/bin/bash', args: ['-l'] };
    const term = pty().spawn(cmd.file, Array.isArray(cmd.args) ? cmd.args.map(String) : [], { name: 'xterm-256color', cols, rows, cwd, env: shellEnv() });
    const s = { id, ws, ownerKey, term, pid: term.pid, send, chunks: [], size: 0, timer: null, unacked: 0, paused: false, closed: false, exited: false };
    sessions.set(keyOf(ws, id), s);
    hookSocket(ws);
    term.onData((data) => onData(s, data));
    term.onExit((e) => {
        s.exited = true;
        if (s.closed) return;
        flush(s);
        dispose(s);
        try { s.send('admin_terminal_exit', { id, exitCode: e.exitCode, signal: e.signal || 0 }); } catch (_) { /* gone */ }
        console.log(`[adminTerminal] ${id} ended (pid ${s.pid}, code ${e.exitCode})`);
    });
    console.log(`[adminTerminal] ${id} opened (pid ${s.pid}, ${cols}x${rows})`);
    return { id, pid: s.pid, cols, rows };
}

function own(ws, id) {
    const s = sessions.get(keyOf(ws, String(id || '')));
    return s && !s.closed ? s : null;
}

/** Keys the client typed or pasted, into the pty. */
function write(ws, id, data) {
    const s = own(ws, id);
    if (!s || typeof data !== 'string' || !data) return false;
    if (data.length > MAX_INPUT) throw new TerminalError('That input is too large', 'TOO_LARGE');
    s.term.write(data);
    return true;
}

function resize(ws, id, cols, rows) {
    const s = own(ws, id);
    if (!s) return false;
    const c = clampInt(cols, MIN_COLS, MAX_COLS, 0);
    const r = clampInt(rows, MIN_ROWS, MAX_ROWS, 0);
    if (!c || !r) return false;
    try { s.term.resize(c, r); } catch (_) { return false; }
    return true;
}

/** The client has written `chars` characters of output into its terminal. */
function ack(ws, id, chars) {
    const s = own(ws, id);
    if (!s) return false;
    const n = clampInt(chars, 0, Number.MAX_SAFE_INTEGER, 0);
    s.unacked = Math.max(0, s.unacked - n);
    if (s.paused && s.unacked <= LOW_WATER) {
        s.paused = false;
        try { s.term.resume(); } catch (_) { /* gone */ }
    }
    return true;
}

function kill(s) {
    if (!s || s.closed) return;
    const pid = s.pid;
    dispose(s);
    try { s.term.kill('SIGHUP'); } catch (_) { /* already gone */ }
    // a shell that ignores the hang-up (a stuck job): its whole group goes after a moment (node-pty makes it a session leader)
    const t = setTimeout(() => {
        if (s.exited) return;
        try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (__) { /* gone */ } }
    }, KILL_GRACE_MS);
    if (t.unref) t.unref();
    console.log(`[adminTerminal] ${s.id} closed (pid ${pid})`);
}

function close(ws, id) {
    const s = own(ws, id);
    if (!s) return false;
    kill(s);
    return true;
}

function closeAllFor(ws) {
    for (const s of Array.from(sessions.values())) if (s.ws === ws) kill(s);
}

/** Every shell, for the server's exit: no pty outlives Dreamscape. */
function closeAll() {
    for (const s of Array.from(sessions.values())) {
        s.closed = true;
        try { s.term.kill('SIGKILL'); } catch (_) { /* gone */ }
    }
    sessions.clear();
}
process.once('exit', closeAll);

function count() { return sessions.size; }

module.exports = {
    MAX_SESSIONS, HIGH_WATER, LOW_WATER, FLUSH_MS, FLUSH_BYTES, TerminalError,
    fullAdminClient, sessionIsFull, sessionNeedsPin, open, write, resize, ack, close, closeAllFor, closeAll, count
};
