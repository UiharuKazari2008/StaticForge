/**
 * ActiveSync (Yozora #747): Android phones running the Dreamscape app as mobile devices of the
 * desktop. The desktop side is Melaton Mobile Device Center (apps/activesync) and its tray icon;
 * the phone side is the ActiveSync program of Melaton Mobile (public/scripts/comp/wmActiveSync.js).
 * Protocol: docs/activesync-protocol.md.
 *
 * Two kinds of peer say hello on their socket (as_hello): a "device" (the phone: its WebView while
 * the app is open, and the app's background service speaking the same packets) and a "computer"
 * (a desktop tab). The server keeps the devices and their partnerships in its own sqlite file
 * (.cache/activesync.db) and relays calls between the two kinds:
 *
 *   as_call  { to, op, args }  ->  as_request { callId, from, op, args } to the target's socket
 *                              <-  as_reply   { callId, ok, result | error }
 *   as_call_response { success, result | code, error }
 *
 * A device is "pending" from hello until a computer chose how to connect and the phone agreed:
 * "guest" for this connection only, or "partner" (stored; later connects need no question). What a
 * computer may call follows the permissions the phone granted (PERMISSIONS below), checked here
 * and again on the phone. A call marked queue:true for an offline partner waits in the queue table
 * and goes out after the device's next hello.
 *
 * Only a partner may hold the app's background link (speaker "service"): a guest is connected
 * while its app is open, and the link's hello is refused (NOT_PARTNER) until a partnership exists.
 *
 * The live half lives on the socket's clientInfo (info.as), so the online list is always the open
 * sockets. A device may hold several sockets (WebView and service): a call goes to the service
 * when it lists the op, else to the newest socket that does.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const KINDS = new Set(['device', 'computer']);
const SPEAKERS = new Set(['webview', 'service']);
// what a phone can grant; an op's group is the part before its first dot
const PERMISSIONS = ['files', 'session', 'clipboard', 'control', 'notify', 'screen', 'sync'];
const OP_GROUP = {
    status: null, // always allowed once connected
    storage: 'files',
    stream: 'files',
    studio: 'session',
    clipboard: 'clipboard',
    open: 'clipboard',
    device: 'control',
    notify: 'notify',
    screen: 'screen',
    sync: 'sync'
};
// a guest connection never syncs: sync items belong to a partnership
const GUEST_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'sync');
// what a device may ask of a computer (the desktop tab decides what it implements)
const DEVICE_TO_COMPUTER = new Set(['status', 'studio', 'clipboard', 'open', 'notify']);
// ops that may wait for an offline partner
const QUEUEABLE = new Set(['studio.setSession', 'clipboard.set', 'open.item', 'notify.show', 'stream.receive']);
const SYNC_ITEMS = ['notes', 'contacts', 'favorites', 'files', 'prints'];

const CALL_TIMEOUT_MS = 15000;
const CALL_TIMEOUT_MAX_MS = 120000;
const PROPOSE_TIMEOUT_MS = 120000;
const MAX_ARGS_BYTES = 1024 * 1024;
const MAX_QUEUE_BYTES = 256 * 1024;
const MAX_QUEUE_ITEMS = 50;
const MAX_LOG_ROWS = 500;
const STATUS_WRITE_MS = 30000;
const BROADCAST_DEBOUNCE_MS = 250;

let db = null;
let dbPath = null;
let lastWsServer = null;
let broadcastTimer = null;
const pendingCalls = new Map(); // callId -> { resolve, timer, targetWs }
const statusWrites = new Map(); // deviceId -> last write ms

class AsError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function fail(code, message) {
    return new AsError(code, message);
}

function hostName() {
    try {
        return clampString(String(os.hostname() || '').split('.')[0], 64) || 'Computer';
    } catch (_) {
        return 'Computer';
    }
}

function isPeerId(value) {
    return /^[0-9a-f]{16,32}$/.test(String(value || ''));
}

function clampString(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseJson(text, fallback) {
    if (text == null || text === '') return fallback;
    try {
        const v = JSON.parse(text);
        return v == null ? fallback : v;
    } catch (_) {
        return fallback;
    }
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function jsonBytes(v) {
    try {
        return Buffer.byteLength(JSON.stringify(v == null ? null : v));
    } catch (_) {
        return Infinity;
    }
}

function cleanList(raw, allowed) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const v of raw) {
        const s = String(v || '');
        if (allowed.includes(s) && !out.includes(s)) out.push(s);
    }
    return out;
}

/** Op names a socket answers: "storage.list", or "storage.*" for a whole group. */
function cleanOps(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const v of raw) {
        const s = String(v || '');
        if (/^[a-z][a-zA-Z0-9]*\.(\*|[a-zA-Z][a-zA-Z0-9]*)$/.test(s) && !out.includes(s)) out.push(s);
        if (out.length >= 200) break;
    }
    return out;
}

function opGroupName(op) {
    const s = String(op || '');
    const dot = s.indexOf('.');
    return dot > 0 ? s.slice(0, dot) : '';
}

function isOpName(op) {
    return /^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(String(op || ''));
}

/**
 * The phone's own picture of itself: every field optional, unknown stays null (never guessed).
 * battery { level 0-100, charging, plugged, saver }, wifi { enabled, connected, level 0-4, ssid },
 * cellular { present, operator, level 0-4, dataType, roaming, airplane }, active (the route in use),
 * storage [{ id, name, total, free }], foreground (the app is on screen).
 */
function sanitizeStatus(raw) {
    if (!isPlainObject(raw)) return null;
    const bool = (v) => (v === true || v === false ? v : null);
    const num = (v, min, max) => {
        const n = Number(v);
        return v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
    };
    const out = { at: Date.now() };
    if (isPlainObject(raw.battery)) {
        const b = raw.battery;
        out.battery = { level: num(b.level, 0, 100), charging: bool(b.charging), plugged: b.plugged == null ? null : clampString(b.plugged, 16), saver: bool(b.saver) };
    }
    if (isPlainObject(raw.wifi)) {
        const w = raw.wifi;
        out.wifi = { enabled: bool(w.enabled), connected: bool(w.connected), level: num(w.level, 0, 4), ssid: w.ssid == null ? null : clampString(w.ssid, 64) };
    }
    if (isPlainObject(raw.cellular)) {
        const c = raw.cellular;
        out.cellular = {
            present: bool(c.present), operator: c.operator == null ? null : clampString(c.operator, 64), level: num(c.level, 0, 4),
            dataType: c.dataType == null ? null : clampString(c.dataType, 16), roaming: bool(c.roaming), airplane: bool(c.airplane)
        };
    }
    if (raw.active != null) out.active = clampString(raw.active, 16);
    if (Array.isArray(raw.storage)) {
        out.storage = raw.storage.slice(0, 16).filter(isPlainObject).map((s) => ({
            id: clampString(s.id, 64), name: clampString(s.name, 64), total: num(s.total, 0, Number.MAX_SAFE_INTEGER), free: num(s.free, 0, Number.MAX_SAFE_INTEGER)
        }));
    }
    if (raw.foreground != null) out.foreground = bool(raw.foreground);
    return out;
}

function getDb(globalResources) {
    if (db) return db;
    const dir = globalResources && typeof globalResources.getPath === 'function'
        ? globalResources.getPath('databases')
        : path.resolve(__dirname, '..', '.cache');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    dbPath = path.join(dir, 'activesync.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS as_devices (
            device_id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            os TEXT NOT NULL DEFAULT '',
            app TEXT NOT NULL DEFAULT '',
            partner INTEGER NOT NULL DEFAULT 0,
            permissions TEXT NOT NULL DEFAULT '[]',
            sync_items TEXT NOT NULL DEFAULT '[]',
            settings TEXT NOT NULL DEFAULT '{}',
            last_status TEXT,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            last_sync INTEGER
        );
        CREATE TABLE IF NOT EXISTS as_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            op TEXT NOT NULL,
            args TEXT NOT NULL,
            from_name TEXT NOT NULL DEFAULT '',
            created INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS as_queue_device ON as_queue (device_id, id);
        CREATE TABLE IF NOT EXISTS as_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            at INTEGER NOT NULL,
            level TEXT NOT NULL,
            text TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS as_log_device ON as_log (device_id, id);
    `);
    return db;
}

function rowOf(globalResources, deviceId) {
    return getDb(globalResources).prepare('SELECT * FROM as_devices WHERE device_id = ?').get(deviceId) || null;
}

function wsServerOf(globalResources, wsServer) {
    if (wsServer) {
        lastWsServer = wsServer;
        return wsServer;
    }
    try {
        const s = globalResources && typeof globalResources.getWebSocketServer === 'function' ? globalResources.getWebSocketServer() : null;
        if (s) lastWsServer = s;
    } catch (_) { /* not up yet */ }
    return lastWsServer;
}

function logEvent(globalResources, deviceId, level, text) {
    try {
        const d = getDb(globalResources);
        d.prepare('INSERT INTO as_log (device_id, at, level, text) VALUES (?, ?, ?, ?)').run(deviceId, Date.now(), level, clampString(text, 300));
        d.prepare('DELETE FROM as_log WHERE device_id = ? AND id <= (SELECT id FROM as_log WHERE device_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)').run(deviceId, deviceId, MAX_LOG_ROWS);
    } catch (err) {
        console.warn('[activeSync] log failed:', err.message);
    }
}

function getLog(globalResources, deviceId, limit) {
    if (!isPeerId(deviceId)) throw fail('BAD_DEVICE', 'deviceId is not valid');
    const n = Math.min(MAX_LOG_ROWS, Math.max(1, Number(limit) || 100));
    return getDb(globalResources).prepare('SELECT at, level, text FROM as_log WHERE device_id = ? ORDER BY id DESC LIMIT ?').all(deviceId, n);
}

// ---------------------------------------------------------------- live peers

function liveSockets(wsServer, kind, id) {
    const out = [];
    if (!wsServer || !wsServer.clients) return out;
    for (const [ws, info] of wsServer.clients) {
        if (!info || !info.as || info.as.kind !== kind || ws.readyState !== WebSocket.OPEN) continue;
        if (id && info.as.id !== id) continue;
        out.push({ ws, info });
    }
    out.sort((a, b) => b.info.as.since - a.info.as.since);
    return out;
}

function socketAnswers(info, op) {
    const ops = info.as.ops || [];
    return ops.includes(op) || ops.includes(`${opGroupName(op)}.*`);
}

/**
 * The socket of a peer that answers this op, newest first. The app's service goes first for what it
 * lists: it is native and keeps running while the WebView is paused in the background with its
 * socket still open. Everything else (questions, trash, opening a file) is the WebView's alone.
 */
function socketFor(wsServer, kind, id, op) {
    const all = liveSockets(wsServer, kind, id).filter((s) => !op || socketAnswers(s.info, op));
    return all.find((s) => s.info.as.speaker === 'service') || all[0] || null;
}

/** A device's connection state, shared by its sockets: the most established one wins. */
function deviceSession(wsServer, deviceId) {
    const rank = { partner: 3, guest: 2, pending: 1 };
    let best = null;
    for (const s of liveSockets(wsServer, 'device', deviceId)) {
        const st = s.info.as.session;
        if (!best || (rank[st] || 0) > (rank[best.session] || 0)) best = { session: st, permissions: s.info.as.permissions || [] };
    }
    return best;
}

function setDeviceSession(wsServer, deviceId, session, permissions) {
    for (const s of liveSockets(wsServer, 'device', deviceId)) {
        s.info.as.session = session;
        s.info.as.permissions = permissions.slice();
    }
}

function describeDevice(globalResources, wsServer, row) {
    const live = liveSockets(wsServer, 'device', row.device_id);
    const sess = live.length ? deviceSession(wsServer, row.device_id) : null;
    const newest = live[0] || null;
    const status = (newest && newest.info.as.status) || parseJson(row.last_status, null);
    const queued = getDb(globalResources).prepare('SELECT COUNT(*) AS n FROM as_queue WHERE device_id = ?').get(row.device_id).n;
    return {
        deviceId: row.device_id,
        name: row.name,
        model: row.model,
        os: row.os,
        app: row.app,
        online: live.length > 0,
        session: sess ? sess.session : null,
        speakers: live.map((s) => s.info.as.speaker),
        partner: !!row.partner,
        permissions: sess ? sess.permissions : parseJson(row.permissions, []),
        syncItems: parseJson(row.sync_items, []),
        settings: parseJson(row.settings, {}),
        status,
        queued,
        firstSeen: row.first_seen,
        lastSeen: live.length ? Date.now() : row.last_seen,
        lastSync: row.last_sync || null
    };
}

function describeComputer(s) {
    return { computerId: s.info.as.id, name: s.info.as.name, since: s.info.as.since, clientId: s.info.clientId || null };
}

function list(globalResources, wsServer) {
    const server = wsServerOf(globalResources, wsServer);
    const rows = getDb(globalResources).prepare('SELECT * FROM as_devices').all();
    const devices = rows.map((row) => describeDevice(globalResources, server, row));
    devices.sort((a, b) => (b.online - a.online) || (b.lastSeen - a.lastSeen) || a.name.localeCompare(b.name));
    const seen = new Set();
    const computers = [];
    for (const s of liveSockets(server, 'computer')) {
        if (seen.has(s.info.as.id)) continue;
        seen.add(s.info.as.id);
        computers.push(describeComputer(s));
    }
    return { devices, computers };
}

/** as_peers_updated to every peer that may list (administrators' computers and the devices), coalesced. */
function scheduleUpdated(globalResources, wsServer) {
    const server = wsServerOf(globalResources, wsServer);
    if (!server || typeof server.broadcast !== 'function') return;
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        let data;
        try {
            data = list(globalResources, server);
        } catch (err) {
            console.warn('[activeSync] list for as_peers_updated failed:', err.message);
            return;
        }
        server.broadcast({ type: 'as_peers_updated', data, timestamp: new Date().toISOString() },
            (info) => !!(info && info.authenticated && info.userType === 'admin' && info.as));
    }, BROADCAST_DEBOUNCE_MS);
    if (typeof broadcastTimer.unref === 'function') broadcastTimer.unref();
}

// ---------------------------------------------------------------- hello, status, close

/**
 * as_hello: a socket says what it is. A device is registered or refreshed; a partner is connected
 * at once, anything else waits as "pending". Returns the peer's own record and the current list.
 */
function hello(globalResources, wsServer, clientInfo, data) {
    const src = isPlainObject(data) ? data : {};
    const kind = String(src.kind || '');
    if (!KINDS.has(kind)) throw fail('BAD_KIND', 'kind must be device or computer');
    const id = String(src.id || '').toLowerCase();
    if (!isPeerId(id)) throw fail('BAD_ID', 'id must be 16 to 32 hex digits');
    if (!clientInfo || !clientInfo.authenticated) throw fail('NOT_AUTHENTICATED', 'sign in first');
    const server = wsServerOf(globalResources, wsServer);
    const now = Date.now();
    // a desktop tab is the Melaton computer itself: its name is the host's unless the tab gives one
    const name = clampString(src.name, 64) || (kind === 'device' ? 'Mobile Device' : hostName());
    const as = {
        kind, id, name,
        speaker: SPEAKERS.has(src.speaker) ? src.speaker : 'webview',
        ops: cleanOps(src.ops),
        since: now,
        session: null,
        permissions: [],
        status: null
    };
    if (kind === 'computer') {
        clientInfo.as = as;
        scheduleUpdated(globalResources, server);
        return { success: true, kind, id, name, ...list(globalResources, server) };
    }
    const d = getDb(globalResources);
    const prev = rowOf(globalResources, id);
    // the background link is a partner's: a guest is connected only while its app is open (Yukimi, Nov 12)
    if (as.speaker === 'service' && !(prev && prev.partner)) throw fail('NOT_PARTNER', 'The background connection needs a partnership.');
    const model = clampString(src.model, 64);
    const os = clampString(src.os, 64);
    const app = clampString(src.app, 64);
    if (prev) {
        // a partner keeps the name its partnership gave it; a guest's own name follows the phone
        d.prepare('UPDATE as_devices SET name = ?, model = ?, os = ?, app = ?, last_seen = ? WHERE device_id = ?')
            .run(prev.partner ? prev.name : name, model || prev.model, os || prev.os, app || prev.app, now, id);
    } else {
        d.prepare('INSERT INTO as_devices (device_id, name, model, os, app, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, name, model, os, app, now, now);
    }
    const row = rowOf(globalResources, id);
    as.name = row.name;
    as.status = sanitizeStatus(src.status);
    // sockets of one device share its state: a second socket joins what the first one settled
    const existing = deviceSession(server, id);
    if (row.partner) {
        as.session = 'partner';
        as.permissions = cleanList(parseJson(row.permissions, []), PERMISSIONS);
    } else if (existing && existing.session === 'guest') {
        as.session = 'guest';
        as.permissions = existing.permissions.slice();
    } else {
        as.session = 'pending';
    }
    const wasOnline = !!existing;
    clientInfo.as = as;
    if (as.status) d.prepare('UPDATE as_devices SET last_status = ? WHERE device_id = ?').run(JSON.stringify(as.status), id);
    if (!wasOnline) logEvent(globalResources, id, 'info', `Connected (${as.speaker})`);
    scheduleUpdated(globalResources, server);
    return { success: true, kind, id, name: as.name, session: as.session, permissions: as.permissions, device: describeDevice(globalResources, server, row), ...list(globalResources, server) };
}

/** as_status: fire-and-forget from a device; kept on the socket, written to the row now and then. */
function status(globalResources, wsServer, clientInfo, data) {
    if (!clientInfo || !clientInfo.as || clientInfo.as.kind !== 'device') return false;
    const st = sanitizeStatus(isPlainObject(data) && isPlainObject(data.status) ? data.status : data);
    if (!st) return false;
    clientInfo.as.status = st;
    const id = clientInfo.as.id;
    const last = statusWrites.get(id) || 0;
    if (st.at - last >= STATUS_WRITE_MS) {
        statusWrites.set(id, st.at);
        try {
            getDb(globalResources).prepare('UPDATE as_devices SET last_status = ?, last_seen = ? WHERE device_id = ?').run(JSON.stringify(st), st.at, id);
        } catch (err) {
            console.warn('[activeSync] status write failed:', err.message);
        }
    }
    scheduleUpdated(globalResources, wsServer);
    return true;
}

function onSocketClosed(globalResources, wsServer, clientInfo) {
    if (!clientInfo || !clientInfo.as) return;
    const as = clientInfo.as;
    const server = wsServerOf(globalResources, wsServer);
    // calls waiting on this socket fail now, not at their timeout
    for (const [callId, p] of pendingCalls) {
        if (p.targetInfo === clientInfo) {
            clearTimeout(p.timer);
            pendingCalls.delete(callId);
            p.resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'The device was disconnected.' } });
        }
    }
    if (as.kind === 'device') {
        try {
            const d = getDb(globalResources);
            if (as.status) d.prepare('UPDATE as_devices SET last_status = ?, last_seen = ? WHERE device_id = ?').run(JSON.stringify(as.status), Date.now(), as.id);
            else d.prepare('UPDATE as_devices SET last_seen = ? WHERE device_id = ?').run(Date.now(), as.id);
            statusWrites.delete(as.id);
            // the closing socket is already out of wsServer.clients (or about to be): count the others
            const others = liveSockets(server, 'device', as.id).filter((s) => s.info !== clientInfo);
            if (!others.length) logEvent(globalResources, as.id, 'info', 'Disconnected');
        } catch (err) {
            console.warn('[activeSync] close failed:', err.message);
        }
    }
    clientInfo.as = null;
    scheduleUpdated(globalResources, server);
}

// ---------------------------------------------------------------- calls

function sendRequest(server, target, from, op, args, timeoutMs) {
    const callId = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pendingCalls.delete(callId);
            resolve({ ok: false, error: { code: 'TIMEOUT', message: 'The device did not answer.' } });
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        pendingCalls.set(callId, { resolve, timer, targetInfo: target.info });
        try {
            server.sendToClient(target.ws, { type: 'as_request', data: { callId, from, op, args: args == null ? {} : args }, timestamp: new Date().toISOString() });
        } catch (err) {
            clearTimeout(timer);
            pendingCalls.delete(callId);
            resolve({ ok: false, error: { code: 'SEND_FAILED', message: err.message } });
        }
    });
}

/** as_reply from the socket that was asked. */
function reply(clientInfo, data) {
    const src = isPlainObject(data) ? data : {};
    const p = pendingCalls.get(String(src.callId || ''));
    if (!p || p.targetInfo !== clientInfo) return false;
    clearTimeout(p.timer);
    pendingCalls.delete(String(src.callId));
    if (src.ok === true) p.resolve({ ok: true, result: src.result == null ? null : src.result });
    else {
        const e = isPlainObject(src.error) ? src.error : {};
        p.resolve({ ok: false, error: { code: clampString(e.code, 40) || 'FAILED', message: clampString(e.message, 300) || 'The request failed.' } });
    }
    return true;
}

function fromOf(clientInfo) {
    const as = clientInfo.as;
    return { kind: as.kind, id: as.id, name: as.name };
}

/** May this computer call this op on the device? Throws what is wrong. */
function checkDeviceOp(server, deviceId, op) {
    const group = opGroupName(op);
    if (!Object.prototype.hasOwnProperty.call(OP_GROUP, group)) throw fail('UNKNOWN_OP', `Unknown operation ${op}`);
    const sess = deviceSession(server, deviceId);
    if (!sess) throw fail('OFFLINE', 'The device is not connected.');
    if (sess.session === 'pending') throw fail('NOT_CONNECTED', 'Choose how to connect to the device first.');
    const need = OP_GROUP[group];
    if (need && !sess.permissions.includes(need)) throw fail('NOT_PERMITTED', 'The device does not allow this.');
}

/**
 * as_call: relay one request to the other kind of peer and return its answer.
 * { to, op, args, timeoutMs, queue } -> { success, result } | { success, queued } | throws AsError.
 */
async function call(globalResources, wsServer, clientInfo, data) {
    const src = isPlainObject(data) ? data : {};
    const me = clientInfo && clientInfo.as;
    if (!me) throw fail('NO_HELLO', 'Say as_hello first.');
    const to = String(src.to || '').toLowerCase();
    const op = String(src.op || '');
    if (!isPeerId(to)) throw fail('BAD_TARGET', 'to is not a peer id');
    if (!isOpName(op)) throw fail('BAD_OP', 'op must look like group.name');
    const args = src.args == null ? {} : src.args;
    if (jsonBytes(args) > MAX_ARGS_BYTES) throw fail('TOO_LARGE', 'The request is too large; send file contents as a stream.');
    const server = wsServerOf(globalResources, wsServer);
    const timeoutMs = Math.min(CALL_TIMEOUT_MAX_MS, Math.max(1000, Number(src.timeoutMs) || CALL_TIMEOUT_MS));

    if (me.kind === 'computer') {
        const row = rowOf(globalResources, to);
        if (!row) throw fail('UNKNOWN_DEVICE', 'No such device.');
        const online = liveSockets(server, 'device', to).length > 0;
        if (!online) {
            if (src.queue === true && row.partner && QUEUEABLE.has(op)) return enqueue(globalResources, server, row, op, args, me.name);
            throw fail('OFFLINE', 'The device is not connected.');
        }
        checkDeviceOp(server, to, op);
        const target = socketFor(server, 'device', to, op);
        if (!target) throw fail('UNSUPPORTED', 'The device does not support this.');
        const res = await sendRequest(server, target, fromOf(clientInfo), op, args, timeoutMs);
        if (!res.ok) throw fail(res.error.code, res.error.message);
        return { success: true, result: res.result };
    }

    // a device asks a computer
    const sess = deviceSession(server, me.id);
    if (!sess || sess.session === 'pending') throw fail('NOT_CONNECTED', 'The device is not connected to a computer yet.');
    if (!DEVICE_TO_COMPUTER.has(opGroupName(op))) throw fail('UNKNOWN_OP', `Unknown operation ${op}`);
    const target = socketFor(server, 'computer', to, op);
    if (!target) throw fail('OFFLINE', 'The computer is not connected.');
    if (target.info.userType !== 'admin') throw fail('NOT_PERMITTED', 'The computer does not allow this.');
    const res = await sendRequest(server, target, fromOf(clientInfo), op, args, timeoutMs);
    if (!res.ok) throw fail(res.error.code, res.error.message);
    return { success: true, result: res.result };
}

/**
 * A call the server makes for a computer's HTTP request (file streams, modules/activeSyncTransfers.js):
 * the same checks as as_call, the request goes out as from a computer named fromName.
 */
async function serverCall(globalResources, wsServer, deviceId, op, args, opts = {}) {
    const server = wsServerOf(globalResources, wsServer);
    if (!isPeerId(deviceId) || !rowOf(globalResources, deviceId)) throw fail('UNKNOWN_DEVICE', 'No such device.');
    if (!isOpName(op)) throw fail('BAD_OP', 'op must look like group.name');
    checkDeviceOp(server, deviceId, op);
    const target = socketFor(server, 'device', deviceId, op);
    if (!target) throw fail('UNSUPPORTED', 'The device does not support this.');
    const timeoutMs = Math.min(opts.maxTimeoutMs || CALL_TIMEOUT_MAX_MS, Math.max(1000, Number(opts.timeoutMs) || CALL_TIMEOUT_MS));
    const res = await sendRequest(server, target, { kind: 'computer', id: '', name: clampString(opts.fromName, 64) || hostName() }, op, args, timeoutMs);
    if (!res.ok) throw fail(res.error.code, res.error.message);
    return res.result;
}

/** Keep a queueable request for an offline partner (as as_call with queue:true does). */
function queueFor(globalResources, wsServer, deviceId, op, args, fromName) {
    const row = isPeerId(deviceId) ? rowOf(globalResources, deviceId) : null;
    if (!row) throw fail('UNKNOWN_DEVICE', 'No such device.');
    if (!row.partner || !QUEUEABLE.has(op)) throw fail('OFFLINE', 'The device is not connected.');
    return enqueue(globalResources, wsServerOf(globalResources, wsServer), row, op, args, fromName || hostName());
}

/** Is a device connected, and with which session ('pending' | 'guest' | 'partner')? */
function deviceOnline(globalResources, wsServer, deviceId) {
    const sess = deviceSession(wsServerOf(globalResources, wsServer), deviceId);
    return sess ? sess.session : null;
}

/** Does this HTTP session belong to one of the device's open sockets? */
function isDeviceSession(globalResources, wsServer, deviceId, sessionId) {
    if (!sessionId) return false;
    return liveSockets(wsServerOf(globalResources, wsServer), 'device', deviceId).some((s) => s.info.sessionId === sessionId);
}

/** Is the device connected (guest or partner) with this permission granted? */
function devicePermits(globalResources, wsServer, deviceId, permission) {
    const sess = deviceSession(wsServerOf(globalResources, wsServer), deviceId);
    return !!(sess && sess.session !== 'pending' && sess.permissions.includes(permission));
}

// told when a queued item got its answer (ok or refused), so what it pointed at can be released
const queueListeners = [];
function onQueueItemDone(fn) {
    queueListeners.push(fn);
}

function enqueue(globalResources, server, row, op, args, fromName) {
    if (jsonBytes(args) > MAX_QUEUE_BYTES) throw fail('TOO_LARGE', 'Too large to keep for an offline device.');
    const d = getDb(globalResources);
    const n = d.prepare('SELECT COUNT(*) AS n FROM as_queue WHERE device_id = ?').get(row.device_id).n;
    if (n >= MAX_QUEUE_ITEMS) throw fail('QUEUE_FULL', 'Too many items are already waiting for this device.');
    d.prepare('INSERT INTO as_queue (device_id, op, args, from_name, created) VALUES (?, ?, ?, ?, ?)').run(row.device_id, op, JSON.stringify(args), clampString(fromName, 64), Date.now());
    logEvent(globalResources, row.device_id, 'info', `Waiting for the device: ${op}`);
    scheduleUpdated(globalResources, server);
    return { success: true, queued: true };
}

/**
 * After a partner's hello: what waited for it goes out in order. An item is removed once the device
 * answered (ok or not: a refused item must not block the ones behind it); a timeout stops the run
 * and keeps the rest for the next hello.
 */
async function deliverQueue(globalResources, wsServer, deviceId) {
    const server = wsServerOf(globalResources, wsServer);
    const d = getDb(globalResources);
    let sent = 0;
    for (;;) {
        const item = d.prepare('SELECT * FROM as_queue WHERE device_id = ? ORDER BY id LIMIT 1').get(deviceId);
        if (!item) break;
        const sess = deviceSession(server, deviceId);
        if (!sess || sess.session !== 'partner') break;
        const need = OP_GROUP[opGroupName(item.op)];
        const target = socketFor(server, 'device', deviceId, item.op);
        if ((need && !sess.permissions.includes(need)) || !target) {
            d.prepare('DELETE FROM as_queue WHERE id = ?').run(item.id);
            logEvent(globalResources, deviceId, 'warning', `Not delivered (not allowed on the device): ${item.op}`);
            for (const fn of queueListeners) {
                try { fn({ deviceId, op: item.op, args: parseJson(item.args, {}), ok: false }); } catch (err) { console.warn('[activeSync] queue listener failed:', err.message); }
            }
            continue;
        }
        const from = { kind: 'computer', id: '', name: item.from_name || 'Computer', queuedAt: item.created };
        const res = await sendRequest(server, target, from, item.op, parseJson(item.args, {}), CALL_TIMEOUT_MS);
        if (!res.ok && (res.error.code === 'TIMEOUT' || res.error.code === 'DISCONNECTED' || res.error.code === 'SEND_FAILED')) break;
        d.prepare('DELETE FROM as_queue WHERE id = ?').run(item.id);
        logEvent(globalResources, deviceId, res.ok ? 'info' : 'warning', res.ok ? `Delivered: ${item.op}` : `Refused by the device: ${item.op} (${res.error.message})`);
        for (const fn of queueListeners) {
            try { fn({ deviceId, op: item.op, args: parseJson(item.args, {}), ok: res.ok }); } catch (err) { console.warn('[activeSync] queue listener failed:', err.message); }
        }
        sent += 1;
    }
    if (sent) scheduleUpdated(globalResources, server);
    return sent;
}

/** as_event: a peer's own news (storage changed, session changed) to the other kind, no reply. */
function event(globalResources, wsServer, clientInfo, data) {
    const me = clientInfo && clientInfo.as;
    const src = isPlainObject(data) ? data : {};
    const name = String(src.event || '');
    // the payload is "detail", never "data": packet helpers that prefer message.data would swallow it
    if (!me || !isOpName(name) || jsonBytes(src.detail) > 64 * 1024) return 0;
    const server = wsServerOf(globalResources, wsServer);
    if (me.kind === 'device') {
        const sess = deviceSession(server, me.id);
        if (!sess || sess.session === 'pending') return 0;
        const need = OP_GROUP[opGroupName(name)];
        if (need && !sess.permissions.includes(need)) return 0;
    }
    const msg = { type: 'as_event', data: { from: fromOf(clientInfo), event: name, detail: src.detail == null ? null : src.detail }, timestamp: new Date().toISOString() };
    let n = 0;
    for (const s of liveSockets(server, me.kind === 'device' ? 'computer' : 'device')) {
        if (me.kind === 'device' && s.info.userType !== 'admin') continue;
        if (me.kind === 'computer') {
            const sess = deviceSession(server, s.info.as.id);
            if (!sess || sess.session === 'pending') continue;
        }
        try {
            server.sendToClient(s.ws, msg);
            n += 1;
        } catch (_) { /* closing */ }
    }
    return n;
}

// ---------------------------------------------------------------- partnerships

/**
 * as_partnership from a computer:
 *   propose { deviceId, mode: 'partner' | 'guest', name, syncItems }  the phone is asked and answers
 *           { accept, permissions }; a partner is stored, a guest lasts for this connection
 *   update  { deviceId, name, syncItems, settings }                   a partner's stored settings
 *   end     { deviceId }                                              the partnership and its queue go
 * and from the device itself (deviceId is its own): update { permissions } and end.
 */
async function partnership(globalResources, wsServer, clientInfo, data) {
    const src = isPlainObject(data) ? data : {};
    const me = clientInfo && clientInfo.as;
    if (!me) throw fail('NO_HELLO', 'Say as_hello first.');
    const action = String(src.action || '');
    const deviceId = me.kind === 'device' ? me.id : String(src.deviceId || '').toLowerCase();
    if (!isPeerId(deviceId)) throw fail('BAD_DEVICE', 'deviceId is not valid');
    const server = wsServerOf(globalResources, wsServer);
    const d = getDb(globalResources);
    const row = rowOf(globalResources, deviceId);
    if (!row) throw fail('UNKNOWN_DEVICE', 'No such device.');

    if (action === 'propose') {
        if (me.kind !== 'computer') throw fail('BAD_ACTION', 'A computer proposes.');
        const mode = src.mode === 'partner' ? 'partner' : src.mode === 'guest' ? 'guest' : '';
        if (!mode) throw fail('BAD_MODE', 'mode must be partner or guest');
        const target = socketFor(server, 'device', deviceId, 'partnership.propose');
        if (!target) throw fail('OFFLINE', 'The device is not connected.');
        const name = clampString(src.name, 64).replace(/[^\p{L}\p{N} _-]/gu, '') || row.name;
        const syncItems = cleanList(src.syncItems, SYNC_ITEMS);
        if (mode === 'partner') {
            const clash = d.prepare('SELECT 1 FROM as_devices WHERE partner = 1 AND device_id <> ? AND lower(name) = lower(?)').get(deviceId, name);
            if (clash) throw fail('NAME_IN_USE', 'This device name is already in use.  Please choose a different name.');
        }
        const res = await sendRequest(server, target, fromOf(clientInfo), 'partnership.propose', { mode, name, syncItems, computer: me.name }, PROPOSE_TIMEOUT_MS);
        if (!res.ok) throw fail(res.error.code, res.error.message);
        const answer = isPlainObject(res.result) ? res.result : {};
        if (answer.accept !== true) {
            logEvent(globalResources, deviceId, 'warning', mode === 'partner' ? 'Partnership refused on the device' : 'Connection refused on the device');
            return { success: true, accepted: false, device: describeDevice(globalResources, server, row) };
        }
        const allowed = mode === 'partner' ? PERMISSIONS : GUEST_PERMISSIONS;
        const permissions = Array.isArray(answer.permissions) ? cleanList(answer.permissions, allowed) : allowed.slice();
        if (mode === 'partner') {
            d.prepare('UPDATE as_devices SET partner = 1, name = ?, permissions = ?, sync_items = ? WHERE device_id = ?')
                .run(name, JSON.stringify(permissions), JSON.stringify(syncItems), deviceId);
            logEvent(globalResources, deviceId, 'info', `Partnership set up as "${name}"`);
        } else {
            logEvent(globalResources, deviceId, 'info', 'Connected without a partnership');
        }
        setDeviceSession(server, deviceId, mode, permissions);
        for (const s of liveSockets(server, 'device', deviceId)) if (mode === 'partner') s.info.as.name = name;
        notifyDevice(server, deviceId, 'partnership.changed', { session: mode, permissions, name: mode === 'partner' ? name : row.name, syncItems });
        scheduleUpdated(globalResources, server);
        return { success: true, accepted: true, device: describeDevice(globalResources, server, rowOf(globalResources, deviceId)) };
    }

    if (action === 'update') {
        if (!row.partner) throw fail('NOT_PARTNER', 'The device has no partnership.');
        const sets = [];
        const vals = [];
        if (me.kind === 'computer') {
            if (src.name != null) {
                const name = clampString(src.name, 64).replace(/[^\p{L}\p{N} _-]/gu, '');
                if (!name) throw fail('BAD_NAME', 'Please enter a name for your device.');
                const clash = d.prepare('SELECT 1 FROM as_devices WHERE partner = 1 AND device_id <> ? AND lower(name) = lower(?)').get(deviceId, name);
                if (clash) throw fail('NAME_IN_USE', 'This device name is already in use.  Please choose a different name.');
                sets.push('name = ?'); vals.push(name);
            }
            if (src.syncItems != null) { sets.push('sync_items = ?'); vals.push(JSON.stringify(cleanList(src.syncItems, SYNC_ITEMS))); }
            if (isPlainObject(src.settings)) {
                if (jsonBytes(src.settings) > 32 * 1024) throw fail('TOO_LARGE', 'settings are too large');
                sets.push('settings = ?'); vals.push(JSON.stringify(Object.assign(parseJson(row.settings, {}), src.settings)));
            }
        } else if (src.permissions != null) {
            // the phone narrows or widens what it allows
            sets.push('permissions = ?'); vals.push(JSON.stringify(cleanList(src.permissions, PERMISSIONS)));
        }
        if (!sets.length) throw fail('NOTHING', 'Nothing to change.');
        d.prepare(`UPDATE as_devices SET ${sets.join(', ')} WHERE device_id = ?`).run(...vals, deviceId);
        const next = rowOf(globalResources, deviceId);
        const permissions = cleanList(parseJson(next.permissions, []), PERMISSIONS);
        if (deviceSession(server, deviceId)) {
            setDeviceSession(server, deviceId, 'partner', permissions);
            for (const s of liveSockets(server, 'device', deviceId)) s.info.as.name = next.name;
            notifyDevice(server, deviceId, 'partnership.changed', { session: 'partner', permissions, name: next.name, syncItems: parseJson(next.sync_items, []), settings: parseJson(next.settings, {}) }, clientInfo);
        }
        scheduleUpdated(globalResources, server);
        return { success: true, device: describeDevice(globalResources, server, next) };
    }

    if (action === 'end') {
        d.prepare("UPDATE as_devices SET partner = 0, permissions = '[]', sync_items = '[]', settings = '{}', last_sync = NULL WHERE device_id = ?").run(deviceId);
        releaseQueue(globalResources, deviceId);
        if (row.partner) logEvent(globalResources, deviceId, 'info', me.kind === 'device' ? 'Partnership ended on the device' : 'Partnership ended');
        if (deviceSession(server, deviceId)) {
            setDeviceSession(server, deviceId, 'pending', []);
            notifyDevice(server, deviceId, 'partnership.changed', { session: 'pending', permissions: [] }, clientInfo);
            // the background link goes with the partnership: its socket stops being this device
            for (const s of liveSockets(server, 'device', deviceId)) {
                if (s.info.as.speaker === 'service') s.info.as = null;
            }
        }
        scheduleUpdated(globalResources, server);
        return { success: true, device: describeDevice(globalResources, server, rowOf(globalResources, deviceId)) };
    }

    throw fail('BAD_ACTION', 'action must be propose, update or end');
}

/** Drop everything waiting for a device (its partnership ended, or it was forgotten). */
function releaseQueue(globalResources, deviceId) {
    const d = getDb(globalResources);
    const items = d.prepare('SELECT op, args FROM as_queue WHERE device_id = ?').all(deviceId);
    d.prepare('DELETE FROM as_queue WHERE device_id = ?').run(deviceId);
    for (const item of items) {
        for (const fn of queueListeners) {
            try { fn({ deviceId, op: item.op, args: parseJson(item.args, {}), ok: false }); } catch (err) { console.warn('[activeSync] queue listener failed:', err.message); }
        }
    }
}

/** One-way news from the server to a device's sockets (as_event, from kind "server"). */
function notifyDevice(server, deviceId, name, detail, exceptInfo) {
    const msg = { type: 'as_event', data: { from: { kind: 'server', id: '', name: '' }, event: name, detail }, timestamp: new Date().toISOString() };
    for (const s of liveSockets(server, 'device', deviceId)) {
        if (exceptInfo && s.info === exceptInfo) continue;
        try { server.sendToClient(s.ws, msg); } catch (_) { /* closing */ }
    }
}

/** A device's sync ran (the client tells the server what it finished). */
function markSynced(globalResources, wsServer, deviceId, summary) {
    if (!isPeerId(deviceId) || !rowOf(globalResources, deviceId)) return false;
    getDb(globalResources).prepare('UPDATE as_devices SET last_sync = ? WHERE device_id = ?').run(Date.now(), deviceId);
    if (summary) logEvent(globalResources, deviceId, 'info', summary);
    scheduleUpdated(globalResources, wsServer);
    return true;
}

/** Remove a device that is not connected: its record, queue and log. */
function forget(globalResources, wsServer, deviceId) {
    if (!isPeerId(deviceId)) throw fail('BAD_DEVICE', 'deviceId is not valid');
    const server = wsServerOf(globalResources, wsServer);
    if (liveSockets(server, 'device', deviceId).length) throw fail('ONLINE', 'Disconnect the device first.');
    const d = getDb(globalResources);
    const res = d.prepare('DELETE FROM as_devices WHERE device_id = ?').run(deviceId);
    releaseQueue(globalResources, deviceId);
    d.prepare('DELETE FROM as_log WHERE device_id = ?').run(deviceId);
    scheduleUpdated(globalResources, server);
    return res.changes > 0;
}

function resetForTests(databasesPath) {
    if (db) {
        try { db.close(); } catch (_) { /* closed */ }
    }
    db = null;
    dbPath = null;
    lastWsServer = null;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = null;
    for (const p of pendingCalls.values()) clearTimeout(p.timer);
    pendingCalls.clear();
    statusWrites.clear();
    if (databasesPath) getDb({ getPath: () => databasesPath });
}

module.exports = {
    AsError,
    PERMISSIONS,
    GUEST_PERMISSIONS,
    SYNC_ITEMS,
    QUEUEABLE,
    isPeerId,
    sanitizeStatus,
    hello,
    status,
    onSocketClosed,
    call,
    serverCall,
    queueFor,
    deviceOnline,
    isDeviceSession,
    devicePermits,
    onQueueItemDone,
    reply,
    event,
    partnership,
    deliverQueue,
    markSynced,
    list,
    getLog,
    forget,
    logEvent,
    resetForTests
};
