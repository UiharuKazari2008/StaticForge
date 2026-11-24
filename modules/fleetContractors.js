'use strict';

/**
 * Fleet Contractors (#1154, Yukimi Nov 24 2026): other machines (Linux or Windows) that run Claude Code work
 * for Fleet on their own projects. Each runs a small headless agent (scripts/contractor/agent.js) that
 * connects OUT to this server over a WebSocket on one dedicated path, reports its sessions and takes
 * commands. Fleet shows each as a top-level "Contractor" in its sidebar. Protocol, packets, security model
 * and install: docs/client-api/ws/fleet-contractors.md.
 *
 *   Pairing      an admin creates an invite (name) in Fleet: a one-time pairing code (60 bits, Crockford
 *                base32, 15 minutes, single use; only its SHA-256 is stored). The installer hands it to the
 *                agent, which redeems it over the contractor socket for a long-lived credential: an id
 *                (ctr_...) and a 256-bit secret, stored 0600 on the contractor; only its SHA-256 is kept
 *                here. Revoking deletes nothing but marks the row and closes the live socket (4403).
 *   Socket       GET /fleet/contractor with Upgrade: websocket and X-Dreamscape-Client: fleet-contractor/<v>.
 *                Anything else on that path (no knock, no contractor and no open invite, too many failures
 *                from one address) gets the same 404 page a refused upgrade gets everywhere (siteGate). The
 *                first frame must be { type: 'auth', id, secret } or { type: 'pair', code, ... } within 10 s,
 *                and nothing else is read before it: any other frame, a bad credential or a frame over 4 KB
 *                closes the socket (4401). The socket never carries an admin key, a session cookie or the
 *                site gate token; the credential only travels in that first frame.
 *   Liveness     the server pings every 45 s (under the 737.jp.net proxy's 60 s idle cut) on ONE timer that
 *                runs only while a contractor is connected; a contractor that misses a pong is dropped. The
 *                agent never asks the server anything on a timer: it pushes when its sessions change.
 *   Requests     request(id, action, args) sends { type: 'request', id: <rid>, action, args } and waits for
 *                { type: 'response', id: <rid>, ok, data | error } (30 s; start 120 s). A disconnect fails
 *                every pending request of that contractor at once.
 *   Status       changes (paired, connected, disconnected, sessions, hello, revoked) are pushed to admin
 *                sockets as claude_fleet_contractors_status { reason, contractor } (one contractor, the one
 *                that changed; 250 ms debounce per contractor), and invite changes as { reason: 'invites',
 *                invites }.
 *
 * Store: its own SQLite file (better-sqlite3), ~/.local/state/dreamscape-agents/fleet-contractors.db
 * (FLEET_CONTRACTORS_DB overrides; tests use a temp file). Nothing here logs or returns a secret or a code
 * except the code in the invite's own answer and the secret in the pair answer frame.
 *
 * Work queue hook: startOn(contractorId, opts) -> { sessionId, link, state } (agentSupervisor can run an
 * item on a contractor with it later).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PATH = '/fleet/contractor';
const KNOCK_RE = /^fleet-contractor(\/[\w.-]{1,20})?$/i;
const STATUS_TYPE = 'claude_fleet_contractors_status';
const CODE_TTL_MS = 15 * 60 * 1000;
const AUTH_TIMEOUT_MS = 10 * 1000;
const PRE_AUTH_MAX = 4096;
const MAX_PAYLOAD = 8 * 1024 * 1024;
const PING_MS = 45 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const START_TIMEOUT_MS = 120 * 1000;
const FAIL_WINDOW_MS = 60 * 60 * 1000;
const FAIL_MAX = 10;
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ID_RE = /^ctr_[0-9a-f]{16}$/;
const INVITE_RE = /^inv_[0-9a-f]{16}$/;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
const ACTIONS = new Set(['list_sessions', 'transcript', 'start', 'steer', 'interrupt', 'stop']);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();
const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);

// ---------------------------------------------------------------- store

function dbFile() {
    return process.env.FLEET_CONTRACTORS_DB || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents', 'fleet-contractors.db');
}
let db = null;
let dbPath = null;
function store() {
    const file = dbFile();
    if (db && dbPath === file) return db;
    if (db) { try { db.close(); } catch (_) { /* closed */ } }
    const Database = require('better-sqlite3');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    db = new Database(file);
    dbPath = file;
    try { fs.chmodSync(file, 0o600); } catch (_) { /* best effort */ }
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS contractors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            secret_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            created_by TEXT,
            revoked_at INTEGER,
            last_seen_at INTEGER,
            last_ip TEXT,
            hello TEXT
        );
        CREATE TABLE IF NOT EXISTS invites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            code_hash TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            created_by TEXT,
            expires_at INTEGER NOT NULL,
            used_at INTEGER,
            contractor_id TEXT
        );
    `);
    return db;
}

function cleanName(s, n = 60) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

function newCode() {
    const bytes = crypto.randomBytes(12);
    let out = '';
    for (let i = 0; i < 12; i += 1) out += CODE_ALPHABET[bytes[i] & 31];
    return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}
/** What a person may type: any case, spaces or dashes, O for 0, I / L for 1. */
function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}
const codeHash = (code) => sha256(`fleet-contractor-code:${normalizeCode(code)}`);
const secretHash = (secret) => sha256(`fleet-contractor-secret:${secret}`);

function createInvite(name, createdBy) {
    const n = cleanName(name);
    if (!n) throw new Error('A contractor needs a name');
    const code = newCode();
    const row = { id: `inv_${crypto.randomBytes(8).toString('hex')}`, name: n, code_hash: codeHash(code), created_at: now(), created_by: cleanName(createdBy, 80) || null, expires_at: now() + CODE_TTL_MS };
    store().prepare('INSERT INTO invites (id, name, code_hash, created_at, created_by, expires_at) VALUES (@id, @name, @code_hash, @created_at, @created_by, @expires_at)').run(row);
    statusInvites();
    return { id: row.id, name: row.name, code, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) };
}

function listInvites() {
    return store().prepare('SELECT id, name, created_at, expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(now())
        .map((r) => ({ id: r.id, name: r.name, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) }));
}
const openInvites = () => store().prepare('SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL AND expires_at > ?').get(now()).n;

function cancelInvite(id) {
    const r = store().prepare('UPDATE invites SET expires_at = ? WHERE id = ? AND used_at IS NULL').run(now() - 1, String(id));
    if (r.changes) statusInvites();
    return r.changes > 0;
}

/** Redeems a code (single use, unexpired): a new contractor and its secret (returned once, never stored). */
function redeem(code) {
    const s = store();
    const hash = codeHash(code);
    const run = s.transaction(() => {
        const inv = s.prepare('SELECT * FROM invites WHERE code_hash = ?').get(hash);
        if (!inv || inv.used_at || inv.expires_at <= now()) return null;
        const id = `ctr_${crypto.randomBytes(8).toString('hex')}`;
        const secret = crypto.randomBytes(32).toString('base64url');
        s.prepare('INSERT INTO contractors (id, name, secret_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(id, inv.name, secretHash(secret), now(), inv.created_by);
        s.prepare('UPDATE invites SET used_at = ?, contractor_id = ? WHERE id = ?').run(now(), id, inv.id);
        return { id, name: inv.name, secret };
    });
    const out = run();
    if (out) statusInvites();
    return out;
}

function verify(id, secret) {
    if (!ID_RE.test(String(id || '')) || typeof secret !== 'string' || secret.length < 20 || secret.length > 200) return null;
    const row = store().prepare('SELECT * FROM contractors WHERE id = ?').get(id);
    if (!row || row.revoked_at) return null;
    const a = Buffer.from(row.secret_hash, 'hex');
    const b = Buffer.from(secretHash(secret), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? row : null;
}

function contractorRow(id) { return store().prepare('SELECT * FROM contractors WHERE id = ?').get(String(id)); }
const activeContractors = () => store().prepare('SELECT COUNT(*) AS n FROM contractors WHERE revoked_at IS NULL').get().n;

function revoke(id) {
    const key = String(id || '');
    if (INVITE_RE.test(key)) return { invite: cancelInvite(key) };
    const r = store().prepare('UPDATE contractors SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now(), key);
    const conn = live.get(key);
    if (conn) closeConn(conn, 4403, 'revoked');
    if (r.changes) pushStatus(key, 'revoked');
    return { revoked: r.changes > 0 };
}

/** Deletes a revoked contractor's row (a live or unrevoked one is revoked first). */
function remove(id) {
    const key = String(id || '');
    revoke(key);
    const r = store().prepare('DELETE FROM contractors WHERE id = ?').run(key);
    if (r.changes) pushStatus(key, 'removed');
    return { removed: r.changes > 0 };
}

// ---------------------------------------------------------------- sanitising what a contractor says

const str = (v, n) => cleanName(typeof v === 'string' || typeof v === 'number' ? String(v) : '', n);
const SECRET_RE = /\b(sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g;
const masked = (v, n) => str(v, n).replace(SECRET_RE, (m) => `${m.slice(0, 7)}…`);
const linkOf = (v) => (typeof v === 'string' && /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]{8,64}$/.test(v) ? v : null);

function cleanHello(h) {
    const o = h && typeof h === 'object' ? h : {};
    const list = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
    return {
        agentVersion: str(o.agentVersion, 20),
        name: str(o.name, 60),
        hostname: str(o.hostname, 80),
        os: str(o.os, 20),
        osRelease: str(o.osRelease, 60),
        arch: str(o.arch, 20),
        node: str(o.node, 20),
        claudeVersion: str(o.claudeVersion, 60),
        runner: str(o.runner, 20),
        accounts: list(o.accounts, 8).map((a) => ({ email: str(a && a.email, 120), organization: str(a && a.organization, 120), displayName: str(a && a.displayName, 80), plan: str(a && a.plan, 40) })),
        projects: list(o.projects, 64).map((p) => ({ path: str(p && p.path, 400), name: str(p && p.name, 80) })).filter((p) => p.path)
    };
}

function cleanSession(s) {
    if (!s || typeof s !== 'object' || !SESSION_ID_RE.test(String(s.id || ''))) return null;
    return {
        id: s.id,
        title: masked(s.title, 120),
        cwd: str(s.cwd, 400),
        status: str(s.status, 20),
        live: s.live !== false,
        managed: s.managed === true,
        runner: str(s.runner, 20),
        link: linkOf(s.link),
        pid: Number.isInteger(s.pid) ? s.pid : null,
        mode: MODES.has(s.mode) ? s.mode : null,
        model: MODEL_RE.test(String(s.model || '')) ? s.model : null,
        startedAt: Number.isFinite(s.startedAt) ? iso(s.startedAt) : (typeof s.startedAt === 'string' ? str(s.startedAt, 40) : null),
        updatedAt: Number.isFinite(s.updatedAt) ? iso(s.updatedAt) : (typeof s.updatedAt === 'string' ? str(s.updatedAt, 40) : null)
    };
}
const cleanSessions = (a) => (Array.isArray(a) ? a.slice(0, 200).map(cleanSession).filter(Boolean) : []);

// ---------------------------------------------------------------- live connections

const live = new Map(); // contractor id -> conn
const pending = new Map(); // request id -> { contractorId, resolve, reject, timer }
const failures = new Map(); // ip -> { start, count }
let wss = null;
let pingTimer = null;
let gr = null;
const listeners = new Set();

function failed(ip) {
    const t = now();
    let r = failures.get(ip);
    if (!r || t - r.start > FAIL_WINDOW_MS) r = { start: t, count: 0 };
    r.count += 1;
    failures.set(ip, r);
}
function blocked(ip) {
    const r = failures.get(ip);
    if (!r) return false;
    if (now() - r.start > FAIL_WINDOW_MS) { failures.delete(ip); return false; }
    return r.count >= FAIL_MAX;
}

function summary(id) {
    const row = contractorRow(id);
    const conn = live.get(id);
    if (!row) return { id, removed: true };
    let hello = null;
    if (conn && conn.hello) hello = conn.hello;
    else if (row.hello) { try { hello = JSON.parse(row.hello); } catch (_) { hello = null; } }
    return {
        id: row.id,
        name: row.name,
        online: !!conn && conn.authed,
        revoked: !!row.revoked_at,
        createdAt: iso(row.created_at),
        revokedAt: iso(row.revoked_at),
        connectedAt: conn ? iso(conn.connectedAt) : null,
        lastSeenAt: iso(conn ? now() : row.last_seen_at),
        address: conn ? conn.ip : (row.last_ip || null),
        hello,
        sessions: conn ? conn.sessions : []
    };
}

function list() {
    const rows = store().prepare('SELECT id FROM contractors ORDER BY revoked_at IS NOT NULL, name COLLATE NOCASE').all();
    return { contractors: rows.map((r) => summary(r.id)), invites: listInvites() };
}

const pushTimers = new Map();
function pushStatus(id, reason) {
    const prev = pushTimers.get(id);
    if (prev) { prev.reasons.add(reason); return; }
    const entry = { reasons: new Set([reason]), timer: null };
    entry.timer = setTimeout(() => {
        pushTimers.delete(id);
        const reasons = [...entry.reasons];
        const data = { reason: reasons[reasons.length - 1], reasons, contractor: summary(id) };
        emit(data);
    }, 250);
    if (entry.timer.unref) entry.timer.unref();
    pushTimers.set(id, entry);
}
let invitesTimer = null;
function statusInvites() {
    if (invitesTimer) return;
    invitesTimer = setTimeout(() => { invitesTimer = null; emit({ reason: 'invites', invites: listInvites() }); }, 250);
    if (invitesTimer.unref) invitesTimer.unref();
}
function emit(data) {
    listeners.forEach((fn) => { try { fn(data); } catch (_) { /* a listener's own problem */ } });
    try {
        const srv = gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
        if (!srv || typeof srv.broadcast !== 'function') return;
        const admin = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
        srv.broadcast({ type: STATUS_TYPE, data, timestamp: new Date().toISOString() }, admin);
    } catch (e) {
        console.warn(`[fleetContractors] status push skipped: ${e.message}`);
    }
}
function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function send(conn, obj) {
    if (!conn || !conn.ws || conn.ws.readyState !== 1) return false;
    try { conn.ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
}

function closeConn(conn, code, reason) {
    try { conn.ws.close(code, reason); } catch (_) { /* gone */ }
    // a peer that never answers the close frame
    const t = setTimeout(() => { try { conn.ws.terminate(); } catch (_) { /* gone */ } }, 3000);
    if (t.unref) t.unref();
}

function ensurePing() {
    if (live.size && !pingTimer) {
        pingTimer = setInterval(() => {
            live.forEach((conn) => {
                if (!conn.alive) { try { conn.ws.terminate(); } catch (_) { /* gone */ } return; }
                conn.alive = false;
                try { conn.ws.ping(); } catch (_) { /* gone */ }
            });
        }, PING_MS);
        if (pingTimer.unref) pingTimer.unref();
    } else if (!live.size && pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
}

function authed(conn, row) {
    const old = live.get(row.id);
    if (old && old !== conn) closeConn(old, 4409, 'replaced');
    conn.authed = true;
    conn.id = row.id;
    conn.name = row.name;
    live.set(row.id, conn);
    store().prepare('UPDATE contractors SET last_seen_at = ?, last_ip = ? WHERE id = ?').run(now(), conn.ip, row.id);
    ensurePing();
    console.log(`[fleetContractors] ${row.name} (${row.id}) connected from ${conn.ip}`);
    pushStatus(row.id, 'connected');
}

function onFrame(conn, raw) {
    conn.alive = true;
    let msg;
    if (!conn.authed && raw.length > PRE_AUTH_MAX) { failed(conn.ip); closeConn(conn, 4401, 'unauthorized'); return; }
    try { msg = JSON.parse(raw.toString('utf8')); } catch (_) { msg = null; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        if (!conn.authed) { failed(conn.ip); closeConn(conn, 4401, 'unauthorized'); }
        return;
    }
    if (!conn.authed) {
        clearTimeout(conn.authTimer);
        if (msg.type === 'auth') {
            const row = verify(msg.id, msg.secret);
            if (!row) { failed(conn.ip); console.warn(`[fleetContractors] refused a contractor credential from ${conn.ip}`); closeConn(conn, 4401, 'unauthorized'); return; }
            send(conn, { type: 'welcome', id: row.id, name: row.name, pingMs: PING_MS });
            authed(conn, row);
            return;
        }
        if (msg.type === 'pair') {
            const out = typeof msg.code === 'string' && msg.code.length <= 40 ? redeem(msg.code) : null;
            if (!out) { failed(conn.ip); console.warn(`[fleetContractors] refused a pairing code from ${conn.ip}`); closeConn(conn, 4401, 'unauthorized'); return; }
            send(conn, { type: 'paired', id: out.id, name: out.name, secret: out.secret, pingMs: PING_MS });
            console.log(`[fleetContractors] paired ${out.name} (${out.id}) from ${conn.ip}`);
            authed(conn, contractorRow(out.id));
            pushStatus(out.id, 'paired');
            return;
        }
        failed(conn.ip);
        closeConn(conn, 4401, 'unauthorized');
        return;
    }
    if (msg.type === 'hello') {
        conn.hello = cleanHello(msg);
        if (Array.isArray(msg.sessions)) conn.sessions = cleanSessions(msg.sessions);
        store().prepare('UPDATE contractors SET hello = ?, last_seen_at = ? WHERE id = ?').run(JSON.stringify(conn.hello), now(), conn.id);
        pushStatus(conn.id, 'hello');
    } else if (msg.type === 'sessions') {
        conn.sessions = cleanSessions(msg.sessions);
        pushStatus(conn.id, 'sessions');
    } else if (msg.type === 'response') {
        const p = pending.get(String(msg.id || ''));
        if (!p || p.contractorId !== conn.id) return;
        pending.delete(String(msg.id));
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.data && typeof msg.data === 'object' ? msg.data : {});
        else p.reject(new Error(str(msg.error, 300) || 'The contractor refused'));
    }
    // anything else from an authenticated contractor is ignored (a newer agent's extra)
}

function onClose(conn) {
    clearTimeout(conn.authTimer);
    if (!conn.authed) return;
    if (live.get(conn.id) === conn) {
        live.delete(conn.id);
        try { store().prepare('UPDATE contractors SET last_seen_at = ? WHERE id = ?').run(now(), conn.id); } catch (_) { /* store closed */ }
        console.log(`[fleetContractors] ${conn.name} (${conn.id}) disconnected`);
        pushStatus(conn.id, 'disconnected');
    }
    pending.forEach((p, rid) => {
        if (p.contractorId !== conn.id) return;
        pending.delete(rid);
        clearTimeout(p.timer);
        p.reject(new Error('The contractor disconnected'));
    });
    ensurePing();
}

// ---------------------------------------------------------------- the socket

// the same answer siteGate's refuseUpgrade gives a refused upgrade anywhere (nginx's 404 page)
const NOT_FOUND = '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';
function refuse(socket) {
    try {
        socket.end(`HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(NOT_FOUND)}\r\nConnection: close\r\n\r\n${NOT_FOUND}`);
    } catch (_) { socket.destroy(); }
}

function clientIp(req) {
    try {
        if (gr) {
            const { realClientIp, trustedProxiesFromResources } = require('./clientAddress');
            return realClientIp(req, trustedProxiesFromResources(gr)) || 'unknown';
        }
    } catch (_) { /* below */ }
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const isContractorPath = (url) => String(url || '').split('?')[0] === PATH;

/** An upgrade on PATH: true when taken (accepted or refused), false for every other path. */
function handleUpgrade(req, socket, head) {
    if (!isContractorPath(req.url)) return false;
    socket.on('error', () => {});
    const ip = clientIp(req);
    const knock = String((req.headers && req.headers['x-dreamscape-client']) || '');
    let open = false;
    try { open = activeContractors() > 0 || openInvites() > 0; } catch (e) { console.warn(`[fleetContractors] store: ${e.message}`); }
    if ((req.method || 'GET').toUpperCase() !== 'GET' || !KNOCK_RE.test(knock) || !open || blocked(ip) || String(req.url).includes('?')) {
        refuse(socket);
        return true;
    }
    if (!wss) {
        const WebSocket = require('ws');
        wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false, clientTracking: false });
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = { ws, ip, authed: false, alive: true, id: null, name: null, hello: null, sessions: [], connectedAt: now() };
        conn.authTimer = setTimeout(() => { failed(ip); closeConn(conn, 4401, 'unauthorized'); }, AUTH_TIMEOUT_MS);
        if (conn.authTimer.unref) conn.authTimer.unref();
        ws.on('message', (data, isBinary) => { if (isBinary && !conn.authed) { failed(ip); closeConn(conn, 4401, 'unauthorized'); return; } onFrame(conn, Buffer.isBuffer(data) ? data : Buffer.from(data)); });
        ws.on('pong', () => { conn.alive = true; });
        ws.on('close', () => onClose(conn));
        ws.on('error', () => { try { ws.terminate(); } catch (_) { /* gone */ } });
    });
    return true;
}

/**
 * Puts the contractor path in front of every other upgrade listener (the site gate's included: the path
 * speaks only this protocol and authenticates itself). Called once; tests pass their own http server.
 */
function attach(server, globalResources) {
    if (globalResources) gr = globalResources;
    if (!server || server.__fleetContractors) return;
    server.__fleetContractors = true;
    const existing = server.listeners('upgrade');
    server.removeAllListeners('upgrade');
    server.on('upgrade', (req, socket, head) => {
        if (handleUpgrade(req, socket, head)) return;
        existing.forEach((listener) => listener.call(server, req, socket, head));
    });
}

/** For the WS handler at boot: wraps the http server's upgrade listeners once the boot has attached its own. */
function arm(globalResources) {
    gr = globalResources || gr;
    if (!gr || typeof gr.getHttpServer !== 'function') return;
    // registerPackets runs inside initializeWebSocketServer; web_server.js attaches the site gate, Guacamole
    // and Alchemy's viewer right after it in the same tick, so ours goes outside them on the next one
    setImmediate(() => {
        try { attach(gr.getHttpServer(), gr); } catch (e) { console.warn(`[fleetContractors] attach: ${e.message}`); }
    });
}

// ---------------------------------------------------------------- requests to a contractor

function request(id, action, args, timeoutMs) {
    if (!ACTIONS.has(action)) return Promise.reject(new Error(`Unknown contractor action ${action}`));
    const conn = live.get(String(id || ''));
    if (!conn || !conn.authed) return Promise.reject(new Error('That contractor is not connected'));
    return new Promise((resolve, reject) => {
        const rid = crypto.randomBytes(8).toString('hex');
        const timer = setTimeout(() => {
            pending.delete(rid);
            reject(new Error(`The contractor did not answer (${action})`));
        }, timeoutMs || REQUEST_TIMEOUT_MS);
        if (timer.unref) timer.unref();
        pending.set(rid, { contractorId: conn.id, resolve, reject, timer });
        if (!send(conn, { type: 'request', id: rid, action, args: args || {} })) {
            pending.delete(rid);
            clearTimeout(timer);
            reject(new Error('That contractor is not connected'));
        }
    });
}

function needSession(sessionId) {
    const s = String(sessionId || '');
    if (!SESSION_ID_RE.test(s)) throw new Error('sessionId must be a session uuid');
    return s;
}

function startArgs(opts) {
    const o = opts || {};
    const cwd = typeof o.cwd === 'string' ? o.cwd.trim() : '';
    if (!cwd || cwd.length > 400) throw new Error('cwd must be one of the contractor\'s project folders');
    const args = { cwd, prompt: typeof o.prompt === 'string' ? o.prompt.slice(0, 100000) : '', title: cleanName(o.title, 60) };
    if (o.mode !== undefined && o.mode !== null && o.mode !== '') { if (!MODES.has(o.mode)) throw new Error('Unknown permission mode'); args.mode = o.mode; }
    if (o.model) { if (!MODEL_RE.test(String(o.model))) throw new Error('Unknown model'); args.model = String(o.model); }
    if (o.effort) { if (!EFFORTS.has(o.effort)) throw new Error('Unknown effort'); args.effort = o.effort; }
    if (o.remoteControl === false) args.remoteControl = false;
    return args;
}

/** Work queue hook: a new session on a contractor. Answers { sessionId, link, state }. */
async function startOn(contractorId, opts) {
    const r = await request(contractorId, 'start', startArgs(opts), START_TIMEOUT_MS);
    const out = { sessionId: SESSION_ID_RE.test(String(r.sessionId || '')) ? r.sessionId : null, link: linkOf(r.link), state: str(r.state, 20) || 'running' };
    if (!out.sessionId) throw new Error('The contractor did not report a session');
    return out;
}

const sessions = async (id) => {
    const r = await request(id, 'list_sessions', {});
    return { live: cleanSessions(r.live), recent: cleanSessions(r.recent) };
};
const transcript = (id, o) => request(id, 'transcript', {
    sessionId: needSession(o.sessionId),
    before: Number.isFinite(Number(o.before)) && o.before !== null && o.before !== undefined ? Number(o.before) : undefined,
    limit: Math.max(1, Math.min(400, Number(o.limit) || 80)),
    show: o.show && typeof o.show === 'object' ? { thinking: o.show.thinking === true, edits: o.show.edits === true, tools: o.show.tools === true, results: o.show.results === true } : undefined,
    item: o.item && Number.isFinite(Number(o.item.at)) ? { at: Number(o.item.at), part: Number(o.item.part) || 0 } : undefined
});
const steer = (id, sessionId, text) => {
    const t = typeof text === 'string' ? text : '';
    if (!t.trim()) return Promise.reject(new Error('Nothing to send'));
    return request(id, 'steer', { sessionId: needSession(sessionId), text: t.slice(0, 100000) });
};
const interrupt = (id, sessionId) => request(id, 'interrupt', { sessionId: needSession(sessionId) });
const stop = (id, sessionId) => request(id, 'stop', { sessionId: needSession(sessionId) });

function isOnline(id) { const c = live.get(String(id || '')); return !!(c && c.authed); }

/** Tests: drop the live state and the store handle. */
function _reset() {
    live.forEach((c) => { try { c.ws.terminate(); } catch (_) { /* gone */ } });
    live.clear();
    pending.forEach((p) => clearTimeout(p.timer));
    pending.clear();
    failures.clear();
    pushTimers.forEach((e) => clearTimeout(e.timer));
    pushTimers.clear();
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (db) { try { db.close(); } catch (_) { /* closed */ } db = null; dbPath = null; }
}

module.exports = {
    PATH, STATUS_TYPE, SESSION_ID_RE,
    createInvite, listInvites, cancelInvite, redeem, verify, revoke, remove, list, summary, isOnline,
    handleUpgrade, attach, arm, onStatus,
    request, startOn, sessions, transcript, steer, interrupt, stop,
    _reset, _test: { normalizeCode, codeHash, secretHash, store, startArgs, CODE_TTL_MS }
};
