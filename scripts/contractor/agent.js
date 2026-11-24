#!/usr/bin/env node
'use strict';

/**
 * Fleet Contractor agent (#1154): runs Claude Code work for a Dreamscape Fleet server on this machine's own
 * projects. Headless, one file, nothing to npm install (Node >= 20). It connects OUT to the server
 * (wss://<server>/fleet/contractor; no port is opened here), authenticates with its own credential, reports
 * its sessions and answers the server's requests. Protocol: docs/client-api/ws/fleet-contractors.md.
 *
 *   node agent.js pair --server <url> --name <name> [--project <folder>]...   redeems a pairing code (asked
 *                         at the prompt, or FLEET_PAIR_CODE) and writes config.json + credential.json (0600)
 *   node agent.js run                                                          the service (systemd / task)
 *   node agent.js projects [--add <folder>] [--remove <folder>]                 the folders Fleet may work in
 *
 * Files: $FLEET_CONTRACTOR_HOME, else ~/.config/fleet-contractor (Linux) or %LOCALAPPDATA%\FleetContractor
 * (Windows): config.json { server, name, projects, permissionMode, claude } and credential.json { id, secret }.
 * The credential is never logged, never put on a command line and only sent in the socket's first frame.
 * This machine's own Claude login stays here: only the account's email / organisation are reported.
 *
 * Sessions: started in tmux (socket fleet-contractor, session fc-<id8>) with Remote Control on where tmux
 * exists (Linux, macOS); elsewhere (Windows) as a child process in print mode with stream-json input and
 * output, whose stdin the agent keeps (steer = a user message line, interrupt = an interrupt control
 * request). Every command stays inside the configured project folders.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const readline = require('readline');
const { EventEmitter } = require('events');
const { execFile, spawn } = require('child_process');

const AGENT_VERSION = '1.0.0';
const WS_PATH = '/fleet/contractor';
const IS_WIN = process.platform === 'win32';
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
const LINK_RE = /https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{8,64})/;
const STRIP_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'TMUX', 'TMUX_PANE', 'FLEET_PAIR_CODE'];
const TMUX_SOCKET = process.env.FLEET_CONTRACTOR_TMUX_SOCKET || 'fleet-contractor';
const SILENCE_MS = 130 * 1000; // the server pings every 45 s; this long without a frame = a dead link
const MAX_FRAME = 16 * 1024 * 1024;

// ---------------------------------------------------------------- files

function homeDir() {
    if (process.env.FLEET_CONTRACTOR_HOME) return process.env.FLEET_CONTRACTOR_HOME;
    if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FleetContractor');
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'fleet-contractor');
}
const configFile = () => path.join(homeDir(), 'config.json');
const credentialFile = () => path.join(homeDir(), 'credential.json');
function claudeDir() { return process.env.CLAUDE_CONFIG_DIR || path.join(process.env.FLEET_CONTRACTOR_CLAUDE_HOME || os.homedir(), '.claude'); }
const sessionsDir = () => path.join(claudeDir(), 'sessions');
const projectsDir = () => path.join(claudeDir(), 'projects');

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }
function writePrivate(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch (_) { /* Windows: the installer sets the ACL */ }
}

function log(...a) { console.log(`[fleet-contractor] ${a.join(' ')}`); }

let transcriptReader = null;
function transcripts() {
    if (transcriptReader) return transcriptReader;
    const here = path.join(__dirname, 'claudeTranscript.js');
    const repo = path.join(__dirname, '..', '..', 'modules', 'claudeTranscript.js');
    transcriptReader = require(fs.existsSync(here) ? here : repo);
    return transcriptReader;
}

// ---------------------------------------------------------------- a small WebSocket client (RFC 6455)

class MiniWs extends EventEmitter {
    constructor(url, headers) {
        super();
        this.url = new URL(url);
        this.headers = headers || {};
        this.buf = Buffer.alloc(0);
        this.frag = null;
        this.open = false;
        this.socket = null;
    }

    connect() {
        const key = crypto.randomBytes(16).toString('base64');
        const lib = this.url.protocol === 'wss:' ? https : http;
        const req = lib.request({
            hostname: this.url.hostname,
            port: this.url.port || (this.url.protocol === 'wss:' ? 443 : 80),
            path: this.url.pathname,
            method: 'GET',
            headers: Object.assign({ Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }, this.headers),
            timeout: 20000
        });
        req.on('upgrade', (res, socket, head) => {
            const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
            if (res.headers['sec-websocket-accept'] !== accept) { socket.destroy(); this.emit('error', new Error('bad handshake')); this._closed(1006); return; }
            this.socket = socket;
            this.open = true;
            socket.setNoDelay(true);
            socket.setTimeout(0);
            socket.on('data', (d) => this._data(d));
            socket.on('close', () => this._closed(this.closeCode || 1006));
            socket.on('error', (e) => this.emit('error', e));
            this.emit('open');
            if (head && head.length) this._data(head);
        });
        req.on('response', (res) => { res.resume(); this.emit('error', new Error(`server answered ${res.statusCode}`)); this._closed(1006); });
        req.on('timeout', () => req.destroy(new Error('connect timeout')));
        req.on('error', (e) => { this.emit('error', e); this._closed(1006); });
        req.end();
    }

    _closed(code, reason) {
        if (this.done) return;
        this.done = true;
        this.open = false;
        this.emit('close', code, reason || this.closeReason || '');
    }

    _data(chunk) {
        this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
        for (;;) {
            const b = this.buf;
            if (b.length < 2) return;
            const fin = (b[0] & 0x80) !== 0;
            const op = b[0] & 0x0f;
            const masked = (b[1] & 0x80) !== 0;
            let len = b[1] & 0x7f;
            let off = 2;
            if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (b.length < 10) return; len = b.readUInt32BE(2) * 2 ** 32 + b.readUInt32BE(6); off = 10; }
            if (len > MAX_FRAME) { this.terminate(); return; }
            let mask = null;
            if (masked) { if (b.length < off + 4) return; mask = b.subarray(off, off + 4); off += 4; }
            if (b.length < off + len) return;
            const payload = Buffer.from(b.subarray(off, off + len));
            if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
            this.buf = b.subarray(off + len);
            this._frame(fin, op, payload);
        }
    }

    _frame(fin, op, payload) {
        this.emit('activity');
        if (op === 0x9) { this._send(0xA, payload); return; }
        if (op === 0xA) return;
        if (op === 0x8) {
            const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
            this.closeCode = code;
            this.closeReason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
            if (!this.closing) this._send(0x8, payload.subarray(0, 2));
            this.closing = true;
            try { this.socket.end(); } catch (_) { /* gone */ }
            return;
        }
        if (op === 0x1 || op === 0x2) this.frag = { op, parts: [payload] };
        else if (op === 0x0 && this.frag) this.frag.parts.push(payload);
        else return;
        if (!fin) return;
        const whole = Buffer.concat(this.frag.parts);
        const kind = this.frag.op;
        this.frag = null;
        if (kind === 0x1) this.emit('message', whole.toString('utf8'));
    }

    _send(op, payload) {
        if (!this.socket || this.socket.destroyed) return false;
        const len = payload.length;
        let head;
        if (len < 126) { head = Buffer.alloc(2); head[1] = 0x80 | len; }
        else if (len < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
        else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeUInt32BE(Math.floor(len / 2 ** 32), 2); head.writeUInt32BE(len >>> 0, 6); }
        head[0] = 0x80 | op;
        const mask = crypto.randomBytes(4);
        const body = Buffer.from(payload);
        for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i & 3];
        this.socket.write(Buffer.concat([head, mask, body]));
        return true;
    }

    send(text) { return this.open && this._send(0x1, Buffer.from(String(text), 'utf8')); }

    close(code) {
        if (!this.open || this.closing) return;
        this.closing = true;
        const p = Buffer.alloc(2);
        p.writeUInt16BE(code || 1000, 0);
        this._send(0x8, p);
        setTimeout(() => this.terminate(), 2000).unref();
    }

    terminate() { try { this.socket && this.socket.destroy(); } catch (_) { /* gone */ } this._closed(this.closeCode || 1006); }
}

function wsUrl(server) {
    const u = new URL(String(server));
    if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'wss:' && u.protocol !== 'ws:') throw new Error('The server URL must start with https://');
    const proto = u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}${WS_PATH}`;
}
const KNOCK = { 'X-Dreamscape-Client': `fleet-contractor/${AGENT_VERSION}`, 'User-Agent': `FleetContractor/${AGENT_VERSION} (${process.platform})` };

// ---------------------------------------------------------------- folders

function realOr(p) { try { return fs.realpathSync.native(p); } catch (_) { return path.resolve(p); } }
const norm = (p) => (IS_WIN ? realOr(p).toLowerCase() : realOr(p));
function inside(child, root) {
    const rel = path.relative(norm(root), norm(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function projects(cfg) { return (Array.isArray(cfg.projects) ? cfg.projects : []).filter((p) => typeof p === 'string' && p && path.isAbsolute(p)); }
const inProjects = (cfg, dir) => !!dir && path.isAbsolute(dir) && projects(cfg).some((root) => inside(dir, root));
const mangle = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');

// ---------------------------------------------------------------- processes

function childEnv(extra) {
    const env = Object.assign({}, process.env, extra || {});
    STRIP_ENV.forEach((k) => { delete env[k]; });
    return env;
}
function run(cmd, args, opts) {
    return new Promise((resolve) => {
        execFile(cmd, args, Object.assign({ env: childEnv(), timeout: 15000, maxBuffer: 512 * 1024, windowsHide: true }, opts || {}), (error, stdout, stderr) => {
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}
const tmux = (args) => run('tmux', ['-L', TMUX_SOCKET, ...args]);
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const tmuxName = (id) => `fc-${String(id).slice(0, 8)}`;

function claudeBin(cfg) {
    if (cfg.claude) return cfg.claude;
    const home = os.homedir();
    const cands = IS_WIN
        ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
        : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/usr/bin/claude'];
    return cands.find((c) => { try { return fs.statSync(c).isFile(); } catch (_) { return false; } }) || 'claude';
}

let tmuxOk = null;
async function hasTmux() {
    if (process.env.FLEET_CONTRACTOR_RUNNER === 'pipe') return false;
    if (tmuxOk === null) tmuxOk = !IS_WIN && (await run('tmux', ['-V'])).code === 0;
    return tmuxOk;
}

// ---------------------------------------------------------------- sessions

const piped = new Map(); // session id -> { child, cwd, title, status, startedAt, updatedAt, mode, model } (pipe runner)
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const clean = (s, n) => {
    const t = String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    return transcripts().mask(t).slice(0, n || 120);
};

async function liveSessions(cfg) {
    let names = [];
    try { names = (await fs.promises.readdir(sessionsDir())).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { names = []; }
    const out = new Map();
    await Promise.all(names.map(async (n) => {
        let r;
        try { r = JSON.parse(await fs.promises.readFile(path.join(sessionsDir(), n), 'utf8')); } catch (_) { return; }
        if (!r || !SESSION_ID_RE.test(String(r.sessionId || '')) || !Number.isInteger(r.pid) || !pidAlive(r.pid)) return;
        if (!inProjects(cfg, r.cwd)) return;
        const tm = String(r.tmux || '');
        out.set(r.sessionId, {
            id: r.sessionId, pid: r.pid, cwd: r.cwd, title: clean(r.name || ''), status: String(r.status || ''),
            live: true, managed: tm.startsWith(`${tmuxName(r.sessionId)}:`), runner: tm ? 'tmux' : 'other',
            link: r.bridgeSessionId ? `https://claude.ai/code/${r.bridgeSessionId}` : null,
            startedAt: Number(r.startedAt) || null, updatedAt: Number(r.updatedAt) || null
        });
    }));
    piped.forEach((p, id) => {
        const prev = out.get(id) || {};
        out.set(id, Object.assign({}, prev, {
            id, pid: p.child.pid, cwd: p.cwd, title: p.title || prev.title || '', status: p.status, live: true, managed: true, runner: 'pipe',
            link: null, mode: p.mode, model: p.model || null, startedAt: p.startedAt, updatedAt: p.updatedAt
        }));
    });
    return [...out.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** The transcript file of a session (any project folder of ~/.claude/projects). */
async function findTranscript(id) {
    let dirs = [];
    try { dirs = await fs.promises.readdir(projectsDir()); } catch (_) { return null; }
    for (const d of dirs) {
        const f = path.join(projectsDir(), d, `${id}.jsonl`);
        try { await fs.promises.access(f); return f; } catch (_) { /* next */ }
    }
    return null;
}

/** cwd, title and first prompt from a transcript's first 64 KB. */
async function headOf(file) {
    const fh = await fs.promises.open(file, 'r');
    let text = '';
    try {
        const buf = Buffer.alloc(64 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        text = buf.subarray(0, bytesRead).toString('utf8');
    } finally { await fh.close(); }
    const out = { cwd: '', title: '', prompt: '' };
    for (const line of text.split('\n')) {
        let o;
        try { o = JSON.parse(line); } catch (_) { continue; }
        if (!out.cwd && typeof o.cwd === 'string') out.cwd = o.cwd;
        if (!out.title && o.type === 'custom-title' && o.customTitle) out.title = o.customTitle;
        if (!out.prompt && o.type === 'user' && o.message && !o.isMeta) {
            const c = o.message.content;
            const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ') : '';
            if (t && !/^\s*</.test(t)) out.prompt = t;
        }
        if (out.cwd && out.prompt) break;
    }
    return out;
}

/** Transcripts in the project folders, newest 20, not running now. */
async function recentSessions(cfg, liveIds) {
    let dirs = [];
    try { dirs = await fs.promises.readdir(projectsDir()); } catch (_) { return []; }
    const prefixes = projects(cfg).map(mangle);
    const files = [];
    await Promise.all(dirs.filter((d) => prefixes.some((p) => d === p || d.startsWith(`${p}-`))).map(async (d) => {
        let names = [];
        try { names = await fs.promises.readdir(path.join(projectsDir(), d)); } catch (_) { return; }
        await Promise.all(names.filter((n) => SESSION_ID_RE.test(n.replace(/\.jsonl$/, '')) && n.endsWith('.jsonl')).map(async (n) => {
            const f = path.join(projectsDir(), d, n);
            try { files.push({ f, id: n.slice(0, -6), mtime: (await fs.promises.stat(f)).mtimeMs }); } catch (_) { /* gone */ }
        }));
    }));
    files.sort((a, b) => b.mtime - a.mtime);
    const out = [];
    for (const x of files) {
        if (out.length >= 20) break;
        if (liveIds.has(x.id)) continue;
        let h;
        try { h = await headOf(x.f); } catch (_) { continue; }
        if (!inProjects(cfg, h.cwd)) continue;
        out.push({ id: x.id, cwd: h.cwd, title: clean(h.title || h.prompt || x.id.slice(0, 8)), status: 'ended', live: false, managed: false, updatedAt: Math.round(x.mtime) });
    }
    return out;
}

/** A session Fleet may touch: live in a project folder, or its transcript's cwd is in one. */
async function allowedSession(cfg, id) {
    if (!SESSION_ID_RE.test(String(id || ''))) throw new Error('sessionId must be a session uuid');
    const p = piped.get(id);
    if (p) return { id, cwd: p.cwd, runner: 'pipe' };
    const liveOne = (await liveSessions(cfg)).find((s) => s.id === id);
    if (liveOne) return liveOne;
    const file = await findTranscript(id);
    if (!file) throw new Error('No such session here');
    const h = await headOf(file);
    if (!inProjects(cfg, h.cwd)) throw new Error('That session is outside this contractor\'s project folders');
    return { id, cwd: h.cwd, file, live: false };
}

async function startSession(cfg, args, onChange) {
    const a = args || {};
    const cwd = typeof a.cwd === 'string' ? a.cwd : '';
    if (!inProjects(cfg, cwd)) throw new Error('cwd is not one of this contractor\'s project folders');
    let st;
    try { st = await fs.promises.stat(cwd); } catch (_) { st = null; }
    if (!st || !st.isDirectory()) throw new Error('That folder does not exist here');
    const mode = MODES.has(a.mode) ? a.mode : (MODES.has(cfg.permissionMode) ? cfg.permissionMode : 'bypassPermissions');
    const model = a.model && MODEL_RE.test(String(a.model)) ? String(a.model) : null;
    const effort = a.effort && EFFORTS.has(a.effort) ? a.effort : null;
    const title = clean(a.title || '', 60) || `Fleet ${new Date().toISOString().slice(0, 16)}`;
    const prompt = typeof a.prompt === 'string' ? a.prompt : '';
    const id = crypto.randomUUID();
    const bin = claudeBin(cfg);

    if (await hasTmux()) {
        const argv = ['--session-id', id];
        if (a.remoteControl !== false) argv.push('--remote-control', title);
        argv.push('--permission-mode', mode);
        if (model) argv.push('--model', model);
        if (effort) argv.push('--effort', effort);
        if (prompt) argv.push(prompt);
        const unset = STRIP_ENV.map((k) => `-u ${k}`).join(' ');
        const line = `env ${unset} ${shq(bin)} ${argv.map(shq).join(' ')}; sleep 600`;
        const r = await tmux(['new-session', '-d', '-s', tmuxName(id), '-x', '200', '-y', '50', '-c', cwd, line]);
        if (r.code !== 0) throw new Error(`tmux: ${(r.stderr || '').trim().slice(0, 200) || 'could not start'}`);
        // the link: Remote Control prints it in the pane, and the live record carries it
        let link = null;
        for (let i = 0; i < 20 && a.remoteControl !== false; i += 1) {
            await new Promise((res) => setTimeout(res, 1500));
            const s = (await liveSessions(cfg)).find((x) => x.id === id);
            if (s && s.link) { link = s.link; break; }
            const pane = await tmux(['capture-pane', '-p', '-t', tmuxName(id)]);
            const m = LINK_RE.exec(pane.stdout || '');
            if (m) { link = `https://claude.ai/code/${m[1]}`; break; }
            if (pane.code !== 0) throw new Error('The session ended at once (is claude logged in here?)');
        }
        onChange();
        log(`started ${id.slice(0, 8)} in ${cwd} (tmux)`);
        return { sessionId: id, link, state: link ? 'running' : 'starting', runner: 'tmux' };
    }

    // pipe runner (Windows, or no tmux): print mode with stream-json in and out; the agent keeps stdin
    const argv = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--session-id', id, '--permission-mode', mode];
    if (model) argv.push('--model', model);
    if (effort) argv.push('--effort', effort);
    let child;
    const opts = { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
    if (IS_WIN && /\.cmd$/i.test(bin)) child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${bin}" ${argv.join(' ')}`], Object.assign({ windowsVerbatimArguments: true }, opts));
    else child = spawn(bin, argv, opts);
    const rec = { child, cwd, title, status: prompt ? 'busy' : 'idle', startedAt: Date.now(), updatedAt: Date.now(), mode, model };
    piped.set(id, rec);
    const touch = (status) => { rec.status = status; rec.updatedAt = Date.now(); onChange(); };
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
        let o;
        try { o = JSON.parse(line); } catch (_) { return; }
        if (o.type === 'result') touch('idle');
        else if (o.type === 'assistant' && rec.status !== 'busy') touch('busy');
    });
    let errTail = '';
    child.stderr.on('data', (d) => { errTail = (errTail + d.toString('utf8')).slice(-2000); });
    child.on('exit', (code) => {
        piped.delete(id);
        log(`session ${id.slice(0, 8)} exited (${code})${errTail ? `: ${clean(errTail, 200)}` : ''}`);
        onChange();
    });
    child.on('error', (e) => { log(`session ${id.slice(0, 8)}: ${e.message}`); });
    if (prompt) writeUser(rec, prompt);
    onChange();
    log(`started ${id.slice(0, 8)} in ${cwd} (pipe)`);
    return { sessionId: id, link: null, state: 'running', runner: 'pipe' };
}

function writeUser(rec, text) {
    rec.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: null })}\n`);
}

async function steer(cfg, args, onChange) {
    const s = await allowedSession(cfg, args.sessionId);
    const text = typeof args.text === 'string' ? args.text : '';
    if (!text.trim()) throw new Error('Nothing to send');
    const p = piped.get(s.id);
    if (p) { writeUser(p, text); p.status = 'busy'; p.updatedAt = Date.now(); onChange(); return { sent: true }; }
    if (!(await hasTmux()) || (await tmux(['has-session', '-t', tmuxName(s.id)])).code !== 0) throw new Error('Only sessions this contractor started can be steered');
    const r = await tmux(['send-keys', '-t', tmuxName(s.id), '-l', text.replace(/\r?\n/g, ' ')]);
    if (r.code !== 0) throw new Error('Could not type into the session');
    await new Promise((res) => setTimeout(res, 150));
    await tmux(['send-keys', '-t', tmuxName(s.id), 'Enter']);
    return { sent: true };
}

async function interrupt(cfg, args) {
    const s = await allowedSession(cfg, args.sessionId);
    const p = piped.get(s.id);
    if (p) {
        p.child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: crypto.randomBytes(8).toString('hex'), request: { subtype: 'interrupt' } })}\n`);
        return { interrupted: true };
    }
    if (!(await hasTmux()) || (await tmux(['send-keys', '-t', tmuxName(s.id), 'Escape'])).code !== 0) throw new Error('Only sessions this contractor started can be interrupted');
    return { interrupted: true };
}

async function stopSession(cfg, args, onChange) {
    const s = await allowedSession(cfg, args.sessionId);
    const p = piped.get(s.id);
    if (p) { try { p.child.stdin.end(); } catch (_) { /* gone */ } setTimeout(() => { try { p.child.kill(); } catch (_) { /* gone */ } }, 3000).unref(); return { stopped: true }; }
    if (!(await hasTmux()) || (await tmux(['kill-session', '-t', tmuxName(s.id)])).code !== 0) throw new Error('Only sessions this contractor started can be stopped');
    onChange();
    return { stopped: true };
}

async function readTranscript(cfg, args) {
    const s = await allowedSession(cfg, args.sessionId);
    const file = s.file || (await findTranscript(s.id));
    if (!file) throw new Error('That session has no transcript yet');
    const t = transcripts();
    if (args.item && Number.isFinite(Number(args.item.at))) return { item: await t.readItem(file, Number(args.item.at), Number(args.item.part) || 0) };
    return t.readPage(file, { before: args.before, limit: args.limit, view: args.show ? t.viewFrom(args.show) : undefined });
}

// ---------------------------------------------------------------- hello

let claudeVersion = null;
async function hello(cfg) {
    if (claudeVersion === null) {
        const bin = claudeBin(cfg);
        const r = IS_WIN && /\.cmd$/i.test(bin)
            ? await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${bin}" --version`], { windowsVerbatimArguments: true })
            : await run(bin, ['--version']);
        claudeVersion = r.code === 0 ? r.stdout.trim().slice(0, 60) : '';
    }
    const accounts = [];
    const cj = readJson(process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'));
    const oa = cj && cj.oauthAccount;
    if (oa) accounts.push({ email: oa.emailAddress || '', organization: oa.organizationName || '', displayName: oa.displayName || '', plan: oa.billingType || '' });
    return {
        type: 'hello', agentVersion: AGENT_VERSION, name: cfg.name || os.hostname(), hostname: os.hostname(), os: process.platform,
        osRelease: os.release(), arch: process.arch, node: process.version, claudeVersion, runner: (await hasTmux()) ? 'tmux' : 'pipe',
        accounts, projects: projects(cfg).map((p) => ({ path: p, name: path.basename(p) }))
    };
}

// ---------------------------------------------------------------- the connection

function loadConfig() {
    const cfg = readJson(configFile());
    if (!cfg || !cfg.server) throw new Error(`No config at ${configFile()}: run "node agent.js pair" first`);
    return cfg;
}

function connectOnce(cfg, cred, handlers) {
    return new Promise((resolve) => {
        const ws = new MiniWs(wsUrl(cfg.server), KNOCK);
        let last = Date.now();
        let ready = false;
        const watchdog = setInterval(() => { if (Date.now() - last > SILENCE_MS) { log('the server went quiet: reconnecting'); ws.terminate(); } }, 15000);
        ws.on('activity', () => { last = Date.now(); });
        ws.on('error', (e) => { if (!ready) log(`connect: ${e.message}`); });
        ws.on('open', () => {
            last = Date.now();
            ws.send(JSON.stringify(cred.pair ? { type: 'pair', code: cred.pair, agentVersion: AGENT_VERSION } : { type: 'auth', id: cred.id, secret: cred.secret, agentVersion: AGENT_VERSION }));
        });
        ws.on('message', (text) => {
            let msg;
            try { msg = JSON.parse(text); } catch (_) { return; }
            if (msg.type === 'welcome' || msg.type === 'paired') { ready = true; handlers.ready(ws, msg); return; }
            if (msg.type === 'request') handlers.request(ws, msg);
        });
        ws.on('close', (code, reason) => { clearInterval(watchdog); handlers.closed && handlers.closed(); resolve({ code, reason, ready }); });
        ws.connect();
    });
}

async function runService() {
    const cfg = loadConfig();
    const cred = readJson(credentialFile());
    if (!cred || !cred.id || !cred.secret) throw new Error(`No credential at ${credentialFile()}: run "node agent.js pair" first`);
    log(`agent ${AGENT_VERSION} for ${cfg.server} as ${cfg.name || os.hostname()}; ${projects(cfg).length} project folder(s)`);

    let current = null;
    let lastSent = '';
    let pushTimer = null;
    const pushSessions = () => {
        if (pushTimer) return;
        pushTimer = setTimeout(async () => {
            pushTimer = null;
            if (!current) return;
            const list = await liveSessions(cfg);
            const body = JSON.stringify(list);
            if (body === lastSent) return;
            lastSent = body;
            current.send(JSON.stringify({ type: 'sessions', sessions: list }));
        }, 1000);
    };

    // ~/.claude/sessions changes (a session starts, ends, goes busy / idle): debounced push
    let watcher = null;
    const watch = () => {
        if (watcher) return;
        try {
            watcher = fs.watch(sessionsDir(), { persistent: true }, () => pushSessions());
            watcher.on('error', () => { try { watcher.close(); } catch (_) { /* closed */ } watcher = null; });
        } catch (_) { watcher = null; }
    };
    watch();

    const actions = {
        list_sessions: async () => { const live = await liveSessions(cfg); return { live, recent: await recentSessions(cfg, new Set(live.map((s) => s.id))) }; },
        transcript: (a) => readTranscript(cfg, a),
        start: (a) => startSession(cfg, a, pushSessions),
        steer: (a) => steer(cfg, a, pushSessions),
        interrupt: (a) => interrupt(cfg, a),
        stop: (a) => stopSession(cfg, a, pushSessions)
    };
    const handlers = {
        ready: async (ws, msg) => {
            current = ws;
            lastSent = '';
            log(`connected as ${msg.name} (${msg.id})`);
            watch(); // the sessions folder may have appeared since
            const h = await hello(cfg);
            h.sessions = await liveSessions(cfg);
            lastSent = JSON.stringify(h.sessions);
            ws.send(JSON.stringify(h));
        },
        request: async (ws, msg) => {
            const fn = actions[msg.action];
            let reply;
            try {
                if (!fn) throw new Error(`Unknown action ${msg.action}`);
                reply = { type: 'response', id: msg.id, ok: true, data: await fn(msg.args || {}) };
            } catch (e) {
                reply = { type: 'response', id: msg.id, ok: false, error: e.message };
            }
            ws.send(JSON.stringify(reply));
        },
        closed: () => { current = null; }
    };

    let backoff = 1000;
    for (;;) {
        const r = await connectOnce(cfg, cred, handlers);
        if (r.code === 4403) { log('this contractor was revoked on the server: stopping'); process.exit(0); }
        if (r.ready) backoff = 1000;
        else if (r.code === 4401) { log('the server refused the credential'); backoff = Math.max(backoff, 15 * 60 * 1000); }
        const wait = Math.min(backoff, 5 * 60 * 1000 * (r.code === 4401 ? 6 : 1)) + Math.floor(Math.random() * 1000);
        log(`disconnected (${r.code}${r.reason ? ` ${r.reason}` : ''}); again in ${Math.round(wait / 1000)} s`);
        await new Promise((res) => setTimeout(res, wait));
        backoff = Math.min(backoff * 2, 5 * 60 * 1000);
    }
}

// ---------------------------------------------------------------- pairing + config commands

function argList(argv, name) { const out = []; argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); }); return out; }
const argOne = (argv, name) => argList(argv, name)[0];

async function askCode() {
    if (process.env.FLEET_PAIR_CODE) return process.env.FLEET_PAIR_CODE;
    if (!process.stdin.isTTY) {
        const chunks = [];
        for await (const c of process.stdin) chunks.push(c);
        return Buffer.concat(chunks).toString('utf8').trim();
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await new Promise((res) => rl.question('Pairing code from Fleet: ', res));
    rl.close();
    return code.trim();
}

async function pair(argv) {
    const prev = readJson(configFile()) || {};
    const server = argOne(argv, '--server') || prev.server;
    if (!server) throw new Error('--server <https://...> is needed');
    wsUrl(server);
    const cfg = Object.assign({ permissionMode: 'bypassPermissions' }, prev, { server: String(server).replace(/\/$/, ''), name: argOne(argv, '--name') || prev.name || os.hostname() });
    const add = argList(argv, '--project').map((p) => path.resolve(p));
    cfg.projects = [...new Set([...(Array.isArray(prev.projects) ? prev.projects : []), ...add])];
    if (argOne(argv, '--claude')) cfg.claude = path.resolve(argOne(argv, '--claude'));
    const code = await askCode();
    if (!code) throw new Error('No pairing code');
    const r = await connectOnce(cfg, { pair: code }, {
        ready: (ws, msg) => {
            if (msg.type !== 'paired' || !msg.secret) { ws.close(1000); return; }
            writePrivate(credentialFile(), { id: msg.id, secret: msg.secret, server: cfg.server, pairedAt: new Date().toISOString() });
            cfg.name = msg.name || cfg.name;
            writePrivate(configFile(), cfg);
            log(`paired as ${msg.name} (${msg.id}); credential in ${credentialFile()}`);
            ws.close(1000);
        },
        request: (ws, msg) => ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: false, error: 'pairing only' }))
    });
    if (!r.ready) throw new Error(r.code === 4401 ? 'The server refused the code (wrong, used or expired)' : `Could not reach the server (${r.code})`);
}

function projectsCmd(argv) {
    const cfg = readJson(configFile()) || {};
    const set = new Set(Array.isArray(cfg.projects) ? cfg.projects : []);
    argList(argv, '--add').forEach((p) => set.add(path.resolve(p)));
    argList(argv, '--remove').forEach((p) => set.delete(path.resolve(p)));
    cfg.projects = [...set];
    if (argv.includes('--add') || argv.includes('--remove')) writePrivate(configFile(), cfg);
    cfg.projects.forEach((p) => console.log(p));
}

if (require.main === module) {
    const [cmd, ...argv] = process.argv.slice(2);
    const done = (p) => p.catch((e) => { console.error(`[fleet-contractor] ${e.message}`); process.exit(1); });
    if (cmd === 'run') done(runService());
    else if (cmd === 'pair') done(pair(argv).then(() => process.exit(0)));
    else if (cmd === 'projects') projectsCmd(argv);
    else if (cmd === '--version' || cmd === 'version') console.log(AGENT_VERSION);
    else { console.log('usage: agent.js pair --server <url> --name <name> [--project <folder>]... | run | projects [--add <folder>] [--remove <folder>]'); process.exit(cmd ? 1 : 0); }
}

module.exports = { MiniWs, wsUrl, inside, inProjects, liveSessions, recentSessions, startSession, steer, interrupt, stopSession, readTranscript, hello, runService, pair, _piped: piped, AGENT_VERSION };
