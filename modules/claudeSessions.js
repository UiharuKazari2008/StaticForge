'use strict';

/**
 * Claude sessions on this host (Yukimi, Nov 19): the Claude Accounts phone app's Sessions tab ("all Claude
 * sessions for the host ... Reconnect resumes it into Remote Control ... Disconnect") and the switch's
 * Bring over ("can we also bring over selected sessions"). One resume path for both.
 *
 *   Transcripts  ~/.claude/projects/<cwd with non-alphanumerics as ->/<session uuid>.jsonl. One set for
 *                the host: CLAUDE_CONFIG_DIR is never per account, so a switch loses none.
 *   Live         ~/.claude/sessions/<pid>.json, written by every running claude: sessionId, cwd, name,
 *                status, tmux pane ("claude-rc:@0.%0" for Remote Control's own children, "rc-<id8>:..."
 *                for one started here or by hand) and bridgeSessionId ("session_..."; its page is
 *                https://claude.ai/code/<bridgeSessionId>) when Remote Control is on.
 *   Reconnect    `claude --resume <uuid> --remote-control <title> --permission-mode <mode>; sleep 3600` in
 *                the transcript's cwd, as tmux session rc-<id8> on this module's OWN socket
 *                (-L dreamscape-claude-carry): never the default socket, whose tmux server
 *                claude-remote.service's Type=forking unit tracks (a session there can keep or end the
 *                unit's server). The pane is watched for "/remote-control is active" (nudged once with
 *                /remote-control if the CLI could not reattach) and the claude.ai/code link is read back.
 *                Already live: its link, no second copy. The switch's Bring over passes fork: the picked
 *                session continues as a copy with the whole history (--fork-session) under the new login.
 *   Disconnect   kills that rc-* tmux session (this socket first, then an rc-* one on the default socket
 *                started by hand). Remote Control's own children (claude-rc) end only with the server.
 *
 * Nothing here returns a token: titles and prompts are cleaned of links and anything token-shaped; the
 * only link is the claude.ai/code session page. Overrides (tests): DREAMSCAPE_CLAUDE_HOME,
 * DREAMSCAPE_CLAUDE_CARRY_SOCKET, DREAMSCAPE_CLAUDE_CLI, _setRunner(fn), _setPidAlive(fn).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan']);
const RESUME_WAIT_MS = 60 * 1000;
const POLL_MS = 1500;
const SCAN_CHUNK = 4 * 1024 * 1024;
const RC_ACTIVE_RE = /\/remote-control is active|Remote Control (?:is )?(?:active|connected)\b/i;
const RC_NUDGE_RE = /Previous session is unavailable|Couldn.?t reconnect to your Remote Control|Remote Control not started here|Remote Control isn.?t connected|run \/remote-control/i;
const RESUME_FAIL_RE = /No conversation found|Session .{0,40}not found|could not resume|Invalid session/i;
const LINK_RE = /https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{8,64})/;

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }
function sessionsDir() { return path.join(claudeHome(), '.claude', 'sessions'); }
function projectsDir() { return path.join(claudeHome(), '.claude', 'projects'); }
function socket() { return process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET || 'dreamscape-claude-carry'; }
function serverTmux() { return process.env.DREAMSCAPE_CLAUDE_RC_TMUX || 'claude-rc'; }
const readOnly = () => process.env.DREAMSCAPE_CLAUDE_RC_READONLY === '1';
const tmuxName = (id) => `rc-${String(id).slice(0, 8)}`;

// ---------------------------------------------------------------- commands

function userEnv() {
    const env = Object.assign({}, process.env);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid != null && !env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    delete env.TMUX; delete env.TMUX_PANE;
    return env;
}
function defaultRunner(cmd, args, opts) {
    return new Promise((resolve) => {
        execFile(cmd, args, { env: userEnv(), timeout: (opts && opts.timeout) || 15000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}
let runner = defaultRunner;
function _setRunner(fn) { runner = typeof fn === 'function' ? fn : defaultRunner; }
const ownTmux = (args, opts) => runner('tmux', ['-L', socket(), ...args], opts);
const defaultTmux = (args, opts) => runner('tmux', args, opts);

const realAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
let pidAlive = realAlive;
function _setPidAlive(fn) { pidAlive = typeof fn === 'function' ? fn : realAlive; }

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }

// ---------------------------------------------------------------- text

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
function cleanTitle(text, max) {
    const m = max || 90;
    const t = String(text || '').replace(/<[^>]{1,80}>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\b[A-Za-z0-9_-]{32,}\b/g, '…')
        .replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > m ? `${t.slice(0, m - 1)}…` : t;
}
const linkFor = (bridgeSessionId) => (/^session_[A-Za-z0-9]{8,64}$/.test(String(bridgeSessionId || '')) ? `https://claude.ai/code/${bridgeSessionId}` : '');
function paneLink(text) {
    const m = LINK_RE.exec(String(text || '').replace(/\s*\n\s*/g, ''));
    return m ? `https://claude.ai/code/${m[1]}` : '';
}

/** A prompt the person typed: not a tool result, not a command / hook / system wrapper. */
function promptOf(o) {
    if (!o || o.type !== 'user' || o.isSidechain || o.isMeta) return '';
    const c = o.message && o.message.content;
    let t = '';
    if (typeof c === 'string') t = c;
    else if (Array.isArray(c)) {
        if (c.some((b) => b && b.type === 'tool_result')) return '';
        const b = c.find((x) => x && x.type === 'text' && x.text);
        t = b ? b.text : '';
    }
    return /^\s*<(command|local-command|system|bash-|task-notification|user-prompt-submit-hook)/i.test(t) ? '' : t;
}

// ---------------------------------------------------------------- transcripts (all of them, cached)

// file -> { size, mtimeMs, offset, rest, info }: a growing transcript is read from where the last scan stopped
const scans = new Map();

function blankInfo() {
    return { cwd: '', firstPrompt: '', title: '', titleKind: '', lastPrompt: '', lastPromptAt: null, lastAt: null, userMessages: 0, assistantMessages: 0 };
}

function eatLine(info, line) {
    if (!line) return;
    let o;
    try { o = JSON.parse(line); } catch (_) { return; }
    if (!o || typeof o !== 'object') return;
    if (!info.cwd && typeof o.cwd === 'string') info.cwd = o.cwd;
    if (o.timestamp) info.lastAt = o.timestamp;
    if (o.type === 'custom-title' && o.customTitle) { info.title = cleanTitle(o.customTitle); info.titleKind = 'custom'; }
    else if (info.titleKind !== 'custom' && o.type === 'ai-title' && (o.aiTitle || o.title)) { info.title = cleanTitle(o.aiTitle || o.title); info.titleKind = 'ai'; }
    else if (!info.titleKind && o.type === 'summary' && o.summary) info.title = cleanTitle(o.summary);
    if (o.type === 'assistant' && !o.isSidechain) info.assistantMessages += 1;
    const p = promptOf(o);
    if (p) {
        info.userMessages += 1;
        if (!info.firstPrompt) info.firstPrompt = cleanTitle(p);
        info.lastPrompt = cleanTitle(p, 140);
        info.lastPromptAt = o.timestamp || info.lastPromptAt;
    }
}

const yieldLoop = () => new Promise((r) => setImmediate(r));

async function scanTranscript(file) {
    let st;
    try { st = fs.statSync(file); } catch (_) { scans.delete(file); return null; }
    let c = scans.get(file);
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.info;
    if (!c || st.size < c.offset) c = { size: 0, mtimeMs: 0, offset: 0, rest: '', info: blankInfo() };
    let fd = null;
    try {
        fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(SCAN_CHUNK);
        while (c.offset < st.size) {
            const n = fs.readSync(fd, buf, 0, Math.min(SCAN_CHUNK, st.size - c.offset), c.offset);
            if (n <= 0) break;
            c.offset += n;
            const lines = (c.rest + buf.toString('utf8', 0, n)).split('\n');
            c.rest = lines.pop();
            lines.forEach((l) => eatLine(c.info, l));
            await yieldLoop();
        }
    } catch (_) { /* partly read: kept */ } finally { if (fd != null) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
    c.size = st.size;
    c.mtimeMs = st.mtimeMs;
    scans.set(file, c);
    return c.info;
}

function transcriptFiles() {
    const out = [];
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir(), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return out; }
    dirs.forEach((d) => {
        let files = [];
        try { files = fs.readdirSync(path.join(projectsDir(), d.name)); } catch (_) { return; }
        files.forEach((f) => {
            const id = f.replace(/\.jsonl$/, '');
            if (f === id || !SESSION_ID_RE.test(id)) return;
            const file = path.join(projectsDir(), d.name, f);
            let st;
            try { st = fs.statSync(file); } catch (_) { return; }
            out.push({ id, file, project: d.name, size: st.size, mtimeMs: st.mtimeMs });
        });
    });
    return out;
}

function findTranscript(id) {
    if (!SESSION_ID_RE.test(String(id || ''))) return null;
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir()); } catch (_) { return null; }
    for (const d of dirs) {
        const file = path.join(projectsDir(), d, `${id}.jsonl`);
        if (fs.existsSync(file)) return { id, file, project: d };
    }
    return null;
}

// ---------------------------------------------------------------- live sessions

const originOf = (tmux) => {
    const t = String(tmux || '');
    if (t.startsWith(`${serverTmux()}:`)) return 'server';
    if (/^rc-[A-Za-z0-9_-]+:/.test(t)) return 'rc';
    return t ? 'tmux' : 'terminal';
};

/** Every running claude with its session id (sessions/<pid>.json whose pid is alive). */
function liveSessions() {
    let names = [];
    try { names = fs.readdirSync(sessionsDir()).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return []; }
    const out = [];
    names.forEach((n) => {
        const r = readJson(path.join(sessionsDir(), n));
        if (!r || !SESSION_ID_RE.test(String(r.sessionId || '')) || !Number.isInteger(r.pid) || !pidAlive(r.pid)) return;
        const tmux = String(r.tmux || '');
        out.push({
            id: r.sessionId,
            pid: r.pid,
            cwd: typeof r.cwd === 'string' && path.isAbsolute(r.cwd) ? r.cwd : '',
            name: cleanTitle(r.name || ''),
            givenName: r.name && r.nameSource && r.nameSource !== 'derived' ? cleanTitle(r.name) : '',
            status: String(r.status || ''),
            origin: originOf(tmux),
            tmuxSession: tmux.includes(':') ? tmux.slice(0, tmux.indexOf(':')) : '',
            remoteControl: !!r.bridgeSessionId,
            link: linkFor(r.bridgeSessionId),
            updatedAt: Number(r.updatedAt) || 0,
            startedAt: Number(r.startedAt) || 0
        });
    });
    return out;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/**
 * The Remote Control sessions running now (for the switch's Bring over): Remote Control's own children
 * and rc-* ones. Newest activity first. Title from the transcript's head / tail only (cheap).
 */
function listRemoteSessions() {
    return liveSessions().filter((s) => s.remoteControl && (s.origin === 'server' || s.origin === 'rc')).map((s) => {
        const t = findTranscript(s.id);
        const c = t && scans.get(t.file);
        let mtime = 0;
        try { mtime = t ? fs.statSync(t.file).mtimeMs : 0; } catch (_) { mtime = 0; }
        const head = t && !c ? quickHead(t.file) : null;
        const title = s.givenName || (c && (c.info.title || c.info.firstPrompt)) || (head && (head.title || head.firstPrompt)) || s.name || s.id.slice(0, 8);
        return {
            id: s.id, pid: s.pid, origin: s.origin, title, name: s.name, cwd: s.cwd, folder: s.cwd ? path.basename(s.cwd) : '',
            status: s.status, link: s.link, tmuxSession: s.tmuxSession,
            startedAt: iso(s.startedAt), lastActivity: iso(Math.max(s.updatedAt, mtime)), resumable: !!t
        };
    }).sort((a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')));
}

function quickHead(file) {
    const info = blankInfo();
    let fd = null;
    try {
        fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(256 * 1024);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        buf.toString('utf8', 0, n).split('\n').slice(0, -1).forEach((l) => eatLine(info, l));
    } catch (_) { /* none */ } finally { if (fd != null) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
    return info;
}

/**
 * The Sessions tab: every transcript on the host, newest first (offset / limit pages), each with its
 * title or first prompt, last prompt + time, folder, message counts and whether it runs now (and in
 * Remote Control, with its link).
 */
async function listAll(opts = {}) {
    const limit = Math.max(1, Math.min(100, Number(opts.limit) || 30));
    const offset = Math.max(0, Number(opts.offset) || 0);
    const live = new Map();
    liveSessions().forEach((s) => { const prev = live.get(s.id); if (!prev || (s.remoteControl && !prev.remoteControl)) live.set(s.id, s); });
    const all = transcriptFiles().sort((a, b) => b.mtimeMs - a.mtimeMs);
    const page = all.slice(offset, offset + limit);
    const rows = [];
    for (const t of page) {
        const info = (await scanTranscript(t.file)) || blankInfo();
        const l = live.get(t.id) || null;
        const cwd = info.cwd || (l && l.cwd) || '';
        rows.push({
            id: t.id,
            title: (l && l.givenName) || info.title || info.firstPrompt || t.id.slice(0, 8),
            firstPrompt: info.firstPrompt,
            lastPrompt: info.lastPrompt,
            lastPromptAt: info.lastPromptAt,
            lastActivity: iso(t.mtimeMs),
            cwd,
            folder: cwd ? path.basename(cwd) : t.project,
            messages: info.userMessages + info.assistantMessages,
            userMessages: info.userMessages,
            sizeBytes: t.size,
            live: !!l,
            status: l ? l.status : '',
            origin: l ? l.origin : '',
            remoteControl: !!(l && l.remoteControl),
            link: l ? l.link : '',
            tmuxSession: l ? l.tmuxSession : '',
            canDisconnect: !!(l && l.origin === 'rc')
        });
    }
    return { total: all.length, offset, limit, sessions: rows };
}

// ---------------------------------------------------------------- resume / disconnect

async function hasOwn(name) { return (await ownTmux(['has-session', '-t', `=${name}`])).code === 0; }

/**
 * Starts a session again in Remote Control. opts: mode (permission mode), fork (a copy: the switch's
 * Bring over), title, timeoutMs, pollMs. Already live in Remote Control (not forking): its link, nothing
 * started. Answers { id, state: live|connected|started|failed, link, tmuxSession, message }.
 */
async function resume(id, opts = {}) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    const t = findTranscript(id);
    if (!t) throw new Error('No such Claude session');
    const base = { id, tmuxSession: tmuxName(id) };
    if (!opts.fork) {
        const l = liveSessions().find((s) => s.id === id);
        if (l && l.remoteControl) return Object.assign(base, { state: 'live', link: l.link, tmuxSession: l.tmuxSession || base.tmuxSession, message: 'Already in Remote Control' });
        if (l) throw new Error(`It is running already (${l.origin === 'server' ? 'Remote Control' : l.tmuxSession || 'a terminal'}) without Remote Control: type /remote-control there`);
    }
    const info = (scans.get(t.file) && scans.get(t.file).info) || quickHead(t.file);
    const cwd = info.cwd;
    if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) throw new Error(`Its folder ${cwd || '(unknown)'} is not on the host`);
    const name = base.tmuxSession;
    if (await hasOwn(name)) {
        if (!opts.fork && liveSessions().some((x) => x.tmuxSession === name)) {
            // a copy from here that is still starting (or lost Remote Control): watch it, start no other
            return Object.assign(base, await watch(name, opts));
        }
        await ownTmux(['kill-session', '-t', `=${name}`]);
    }
    const title = cleanTitle(opts.title || info.title || info.firstPrompt, 60) || id.slice(0, 8);
    const mode = MODES.has(opts.mode) ? opts.mode : '';
    const bin = process.env.DREAMSCAPE_CLAUDE_CLI || (() => { try { return require('./cursorDirector').findClaude(); } catch (_) { return null; } })() || path.join(claudeHome(), '.local', 'bin', 'claude');
    const cmd = `${shq(bin)} --resume ${id}${opts.fork ? ' --fork-session' : ''} --remote-control ${shq(title)}${mode ? ` --permission-mode ${mode}` : ''}; sleep 3600`;
    const r = await ownTmux(['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, cmd]);
    if (r.code !== 0) return Object.assign(base, { state: 'failed', link: '', message: `Could not start it: ${cleanTitle(r.stderr, 120) || 'tmux failed'}` });
    return Object.assign(base, await watch(name, opts));
}

async function watch(name, opts) {
    const until = Date.now() + (opts.timeoutMs || RESUME_WAIT_MS);
    let nudged = false;
    let link = '';
    while (Date.now() < until) {
        await new Promise((res) => setTimeout(res, opts.pollMs || POLL_MS));
        const p = await ownTmux(['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', '-80']);
        if (p.code !== 0) return { state: 'failed', link: '', message: 'It ended right after starting' };
        const text = p.stdout || '';
        link = paneLink(text) || link;
        if (RESUME_FAIL_RE.test(text)) {
            await ownTmux(['kill-session', '-t', `=${name}`]);
            return { state: 'failed', link: '', message: cleanTitle(text.split('\n').find((l) => RESUME_FAIL_RE.test(l)), 120) };
        }
        if (RC_ACTIVE_RE.test(text)) {
            if (!link) link = linkFromRecord(name);
            return { state: 'connected', link, message: nudged ? 'In Remote Control (reconnected with /remote-control)' : 'In Remote Control' };
        }
        if (!nudged && RC_NUDGE_RE.test(text)) {
            nudged = true;
            await ownTmux(['send-keys', '-t', `=${name}:`, '/remote-control', 'Enter']);
        }
    }
    return { state: 'started', link: link || linkFromRecord(name), message: 'Running, but Remote Control did not say it is active yet' };
}

function linkFromRecord(name) {
    const l = liveSessions().find((s) => s.tmuxSession === name && s.link);
    return l ? l.link : '';
}

/** Ends an rc-* session (this socket first, else one on the default socket started by hand). */
async function disconnect(id) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    if (!SESSION_ID_RE.test(String(id || ''))) throw new Error('No such Claude session');
    const l = liveSessions().find((s) => s.id === id && s.origin === 'rc');
    const names = [...new Set([l && l.tmuxSession, tmuxName(id)].filter((n) => n && /^rc-[A-Za-z0-9_-]+$/.test(n)))];
    for (const n of names) {
        if ((await ownTmux(['kill-session', '-t', `=${n}`])).code === 0) return { id, state: 'disconnected', tmuxSession: n };
    }
    if (l && names.includes(l.tmuxSession) && (await defaultTmux(['kill-session', '-t', `=${l.tmuxSession}`])).code === 0) {
        return { id, state: 'disconnected', tmuxSession: l.tmuxSession };
    }
    const other = liveSessions().find((s) => s.id === id);
    if (other && other.origin === 'server') throw new Error('This one runs inside Remote Control itself: it ends when Remote Control restarts');
    throw new Error(other ? 'It does not run in an rc- tmux session: end it where it runs' : 'It is not running');
}

/** The switch: every rc-* Remote Control session ends with the old login (picked ones come back after). */
async function endRemote(list) {
    if (readOnly()) return;
    for (const s of list) {
        if (s.origin !== 'rc' || !/^rc-[A-Za-z0-9_-]+$/.test(s.tmuxSession || '')) continue;
        const r = await ownTmux(['kill-session', '-t', `=${s.tmuxSession}`]);
        if (r.code !== 0) await defaultTmux(['kill-session', '-t', `=${s.tmuxSession}`]);
    }
}

module.exports = {
    SESSION_ID_RE,
    MODES,
    liveSessions,
    listRemoteSessions,
    listAll,
    resume,
    disconnect,
    endRemote,
    pidAlive: (pid) => pidAlive(pid),
    cleanTitle,
    _setRunner,
    _setPidAlive,
    _text: { cleanTitle, paneLink, linkFor, promptOf, RC_ACTIVE_RE, RC_NUDGE_RE, tmuxName },
    _scans: scans
};
