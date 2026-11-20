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
 *
 * A DreamOS machine (#910, modules/cafeReadyHost.js) is a device too: CaféReady says hello as speaker
 * "host" (platform "cafeready") on its Melaton Café Miniport's sub "activesync", signed in as an
 * administrator. It is partnered by that sign-in; what the server may ask of it is what the machine
 * itself allows (its "Allow remote commands" setting, reported in its status).
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { socketLink, socketLinkUnanswered, probeSocketLink } = require('./wsSocketHeartbeat');

const KINDS = new Set(['device', 'computer']);
// host: CaféReady on a DreamOS machine (modules/cafeReadyHost.js), its own native link like a phone's service
const SPEAKERS = new Set(['webview', 'service', 'host']);
// what a phone can grant; an op's group is the part before its first dot
const PERMISSIONS = ['files', 'session', 'clipboard', 'control', 'notify', 'screen', 'sync'];
const OP_GROUP = {
    status: null, // always allowed once connected
    storage: 'files',
    stream: 'files',
    media: 'files', // media sharing (#956): the phone's music and videos in a computer's Media Player
    studio: 'session',
    clipboard: 'clipboard',
    open: 'clipboard',
    device: 'control',
    apps: 'control', // apps.install: an .apk on the phone offered to Android's installer (#795)
    notify: 'notify',
    screen: 'screen',
    sync: 'sync',
    // a DreamOS machine's own commands (modules/cafeReadyHost.js): only through the server's admin routes, never as_call
    host: 'control'
};
// a guest connection never syncs: sync items belong to a partnership
const GUEST_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'sync');
// what a device may ask of a computer (the desktop tab decides what it implements)
const DEVICE_TO_COMPUTER = new Set(['status', 'studio', 'clipboard', 'open', 'notify']);
// ops that may wait for an offline partner
// (apps.install after a queued stream.receive: the program sent to a phone that was away installs once it lands)
const QUEUEABLE = new Set(['studio.setSession', 'clipboard.set', 'open.item', 'notify.show', 'stream.receive', 'apps.install']);
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
            dataType: c.dataType == null ? null : clampString(c.dataType, 16), roaming: bool(c.roaming), airplane: bool(c.airplane),
            // the phone's own number (Device information, #827)
            phoneNumber: c.phoneNumber == null ? null : clampString(c.phoneNumber, 32)
        };
    }
    if (raw.active != null) out.active = clampString(raw.active, 16);
    if (Array.isArray(raw.storage)) {
        out.storage = raw.storage.slice(0, 16).filter(isPlainObject).map((s) => ({
            id: clampString(s.id, 64), name: clampString(s.name, 64), total: num(s.total, 0, Number.MAX_SAFE_INTEGER), free: num(s.free, 0, Number.MAX_SAFE_INTEGER)
        }));
    }
    if (raw.foreground != null) out.foreground = bool(raw.foreground);
    // Device Center's facts (#827): the Melaton Mobile version, the program in front (a Melaton
    // program or an Android app) and which screen of a foldable is in use
    if (raw.shell != null) out.shell = clampString(raw.shell, 16);
    if (isPlainObject(raw.program) && raw.program.name) {
        out.program = { name: clampString(raw.program.name, 64), kind: raw.program.kind === 'android' ? 'android' : 'melaton' };
    }
    if (raw.screen === 'inner' || raw.screen === 'cover') out.screen = raw.screen;
    if (raw.foldable != null) out.foldable = bool(raw.foldable);
    // the lock screen is up (the app's service, #827): Device Center says "Locked (Connected)"
    if (raw.locked != null) out.locked = bool(raw.locked);
    // Melaton Mobile's edition as the phone works it out, and Continuity in use (kept: "used at least once")
    if (['Classic', 'Standard', 'Professional', 'Enterprise'].includes(raw.edition)) out.edition = raw.edition;
    if (raw.continuity === true) out.continuity = true;
    // the owner's description of the phone (Settings > About > Device ID, #829)
    if (typeof raw.description === 'string' && raw.description.trim()) out.description = clampString(raw.description.trim(), 128);
    // a DreamOS machine's own facts (CaféReady: base, slot, addresses, power, what it allows; modules/cafeReadyHost.js)
    if (isPlainObject(raw.host)) out.host = require('./cafeReadyHost').sanitizeHost(raw.host);
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
        CREATE TABLE IF NOT EXISTS as_received (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            op TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            detail TEXT NOT NULL DEFAULT '{}',
            from_name TEXT NOT NULL DEFAULT '',
            created INTEGER NOT NULL,
            seen INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS as_received_device ON as_received (device_id, id);
        CREATE TABLE IF NOT EXISTS as_prefs (
            owner TEXT NOT NULL,
            name TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (owner, name)
        );
    `);
    // what the device is (#910): '' a phone with the Dreamscape app, 'cafeready' a DreamOS machine
    if (!db.prepare('PRAGMA table_info(as_devices)').all().some((c) => c.name === 'platform')) {
        db.exec("ALTER TABLE as_devices ADD COLUMN platform TEXT NOT NULL DEFAULT ''");
    }
    return db;
}

// ---------------------------------------------------------------- the primary device (#979)
//
// Yukimi, Nov 20 2026: "a setting for selecting the primary phone so when new devices show up they do not take over
// Mobile Device Center; they just show up in the list". One partnered device per owner (the administrators who list
// devices) is the primary: Device Center, the tray icon, the Sidebar gadgets and the phone drive stay on it whenever
// it is connected, show it as Not Connected while it is away, and other devices only join the lists.
const PRIMARY_OWNER = 'admin';
let primaryCache = null; // { owner: deviceId | '' }

function primaryOf(globalResources, owner = PRIMARY_OWNER) {
    if (!primaryCache) primaryCache = {};
    if (!Object.prototype.hasOwnProperty.call(primaryCache, owner)) {
        const row = getDb(globalResources).prepare("SELECT value FROM as_prefs WHERE owner = ? AND name = 'primary'").get(owner);
        primaryCache[owner] = row && isPeerId(row.value) ? row.value : '';
    }
    return primaryCache[owner];
}

/** deviceId '' clears it. Only a partnered device can be the primary. */
function setPrimary(globalResources, wsServer, deviceId, owner = PRIMARY_OWNER) {
    const id = String(deviceId || '').toLowerCase();
    const d = getDb(globalResources);
    if (id) {
        const row = rowOf(globalResources, id);
        if (!row) throw fail('UNKNOWN_DEVICE', 'No such device.');
        if (!row.partner) throw fail('NOT_PARTNER', 'Only a device with a partnership can be the primary device.');
        if (row.platform === 'cafeready') throw fail('NOT_PHONE', 'A computer cannot be the primary device.');
        d.prepare("INSERT INTO as_prefs (owner, name, value) VALUES (?, 'primary', ?) ON CONFLICT (owner, name) DO UPDATE SET value = excluded.value").run(owner, id);
        logEvent(globalResources, id, 'info', 'Set as the primary device');
    } else {
        d.prepare("DELETE FROM as_prefs WHERE owner = ? AND name = 'primary'").run(owner);
    }
    if (!primaryCache) primaryCache = {};
    primaryCache[owner] = id;
    scheduleUpdated(globalResources, wsServerOf(globalResources, wsServer));
    return id;
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

/**
 * A socket whose link was pinged and has not answered (wsSocketHeartbeat.js, #890): it may have
 * dropped without a word, so what it last said about the page (on screen, in front, connected) does
 * not count until it answers. Only notification decisions ask; Device Center shows what it has.
 */
function linkUnanswered(server, s) {
    return socketLinkUnanswered(s.ws, s.info, server && server.clients);
}

/**
 * A device said hello on a new socket (#890): it may have changed networks, and its older links
 * (another Miniport carrier, an older background link) may have dropped without a word. With the
 * long quiet window of the app's links the server would notice only minutes later, and until then
 * the dead page would still count as in front or connected for notifications. Each older link is
 * pinged now; a live one answers at once, a dead one ends within a tick or two.
 */
function probeOlderLinks(server, deviceId, clientInfo) {
    if (!server || !server.clients) return 0;
    const live = liveSockets(server, 'device', deviceId);
    const mine = live.find((s) => s.info === clientInfo);
    const myLink = mine ? socketLink(mine.ws, mine.info, server.clients).ws : null;
    const seen = new Set();
    let probed = 0;
    for (const s of live) {
        if (s.info === clientInfo) continue;
        const link = socketLink(s.ws, s.info, server.clients).ws;
        if (!link || link === myLink || seen.has(link)) continue;
        seen.add(link);
        if (probeSocketLink(s.ws, s.info, server.clients)) probed += 1;
    }
    return probed;
}

function socketAnswers(info, op) {
    const ops = info.as.ops || [];
    return ops.includes(op) || ops.includes(`${opGroupName(op)}.*`);
}

// A computer's work on the phone's files and data goes to the app's background service only, never to the phone's
// page (StaticForge #981, rule cafeready-background). Yukimi, Nov 20 2026: "I have to wake the phone's screen to
// delete files in Explorer over ActiveSync. It should never have been using the WebView or relied on the WebView to
// do any file access over ActiveSync." The page's socket stays open while the WebView is paused (screen off, the app
// behind others), so an op sent there waited for the screen; the service keeps running.
const SERVICE_ONLY_GROUPS = new Set(['storage', 'stream', 'media', 'apps', 'notify']);
const SERVICE_ONLY_OPS = new Set(['status.bluetooth', 'device.bluetooth']);

function serviceOnly(kind, op) {
    return kind === 'device' && !!op && (SERVICE_ONLY_GROUPS.has(opGroupName(op)) || SERVICE_ONLY_OPS.has(op));
}

/**
 * The socket of a peer that answers this op, newest first. The app's service goes first for what it
 * lists: it is native and keeps running while the WebView is paused in the background with its
 * socket still open. File and phone-data ops (serviceOnly) are the service's alone; what needs someone at
 * the phone (the partnership question, Studio, opening a link, the screen viewer's consent) is the page's.
 */
function socketFor(wsServer, kind, id, op) {
    const all = liveSockets(wsServer, kind, id).filter((s) => !op || socketAnswers(s.info, op));
    // a DreamOS machine's CaféReady (speaker host) is its native link, as a phone's service is
    const service = all.find((s) => s.info.as.speaker === 'service' || s.info.as.speaker === 'host') || null;
    if (serviceOnly(kind, op)) return service;
    return service || all[0] || null;
}

/** Why no socket of the device takes the op: the error a caller throws (the code stays UNSUPPORTED). */
function noSocketError(wsServer, deviceId, op) {
    if (!serviceOnly('device', op)) return fail('UNSUPPORTED', 'The device does not support this.');
    const live = liveSockets(wsServer, 'device', deviceId);
    const sess = deviceSession(wsServer, deviceId);
    if (live.some((s) => s.info.as.speaker === 'service')) {
        return fail('UNSUPPORTED', 'Dreamscape on the device needs an update for this: its background service does not do it yet.');
    }
    if (sess && sess.session === 'guest') {
        return fail('UNSUPPORTED', 'Set up a partnership with the device for this: a guest connection has no background service.');
    }
    return fail('UNSUPPORTED', "Dreamscape's background service on the device is not connected. It reconnects by itself; check that the app's notification is there.");
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
    const status = mergedStatus(live) || parseJson(row.last_status, null);
    const queued = getDb(globalResources).prepare('SELECT COUNT(*) AS n FROM as_queue WHERE device_id = ?').get(row.device_id).n;
    return {
        deviceId: row.device_id,
        name: row.name,
        model: row.model,
        os: row.os,
        app: row.app,
        // '' / android: a phone with the Dreamscape app; cafeready: a DreamOS machine (modules/cafeReadyHost.js)
        platform: row.platform || 'android',
        online: live.length > 0,
        session: sess ? sess.session : null,
        speakers: live.map((s) => s.info.as.speaker),
        // the phone shares its media library (#956): its app answers media.list (DSApp ActiveSyncMedia)
        media: live.some((s) => s.info.as.speaker === 'service' && socketAnswers(s.info, 'media.list')),
        // a test device (modules/testDevices.js, the emulators): Media Player lists it only while it is connected
        test: isTestDevice(row.device_id),
        partner: !!row.partner,
        permissions: sess ? sess.permissions : parseJson(row.permissions, []),
        syncItems: parseJson(row.sync_items, []),
        settings: parseJson(row.settings, {}),
        status,
        queued,
        firstSeen: row.first_seen,
        lastSeen: live.length ? Date.now() : row.last_seen,
        lastSync: row.last_sync || null,
        // the owner's primary device (#979): Device Center and the tray stay on it while it is connected
        primary: !!row.partner && primaryOf(globalResources) === row.device_id,
        // ADB on port 5555 from this server (#818): state ready / unauthorized / unreachable / off ...
        adb: row.platform === 'cafeready' ? null : adbStatusOf(globalResources, row.device_id),
        // the wallpapers kept for Device Center (#827): a new stamp means new pictures
        wallpapersAt: wallpapersStampOf(globalResources, row.device_id),
        // DreamOS machines on this phone's hotspot (modules/phoneTether.js): { ssid, computers, how } or null (#953)
        hotspot: row.platform === 'cafeready' ? null : hotspotOf(row.device_id)
    };
}

function hotspotOf(deviceId) {
    try { return require('./phoneTether').hotspotOf(deviceId); } catch (_) { return null; }
}

function wallpapersStampOf(globalResources, deviceId) {
    try { return require('./activeSyncWallpapers').stampOf(globalResources, deviceId); } catch (_) { return 0; }
}

/**
 * One status from all of a device's sockets (#827): the page's WebView and the app's service each
 * report what they know; the fresher report wins field by field, so a paused WebView no longer hides
 * the service's Wi-Fi or lock state, and the page's own facts (program, shell) stay.
 */
function mergedStatus(live) {
    const reports = live.map((s) => s.info.as.status).filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!reports.length) return null;
    const out = {};
    for (const r of reports) for (const [k, v] of Object.entries(r)) if (v != null) out[k] = v;
    // the page is on screen: its own word on what is in front wins over an older service report
    const page = reports.filter((r) => r.foreground === true).pop();
    if (page) { out.foreground = true; if (page.program) out.program = page.program; }
    // the page on screen after the last lock report: the phone is unlocked
    if (page && reports[reports.length - 1] === page) out.locked = false;
    return out;
}

/** Continuity used at least once (#827, the Enterprise edition): a flag in the device's settings that stays. */
function noteContinuity(globalResources, deviceId) {
    try {
        const d = getDb(globalResources);
        const row = d.prepare('SELECT settings FROM as_devices WHERE device_id = ?').get(deviceId);
        if (!row) return;
        const set = parseJson(row.settings, {});
        if (set.continuitySeen) return;
        set.continuitySeen = Date.now();
        d.prepare('UPDATE as_devices SET settings = ? WHERE device_id = ?').run(JSON.stringify(set), deviceId);
    } catch (err) { console.warn('[activeSync] continuity note failed:', err.message); }
}

function adbStatusOf(globalResources, deviceId) {
    try { return require('./deviceAdb').status(globalResources, deviceId); } catch (_) { return null; }
}

/** The addresses a device's open sockets come from, newest first (deviceAdb #818). */
function deviceAddresses(globalResources, wsServer, deviceId) {
    const out = [];
    for (const s of liveSockets(wsServerOf(globalResources, wsServer), 'device', deviceId)) {
        if (s.info.clientIP && !out.includes(s.info.clientIP)) out.push(s.info.clientIP);
    }
    return out;
}

function deviceRow(globalResources, deviceId) {
    return rowOf(globalResources, deviceId) || null;
}

/** Something about a device changed outside a socket (its ADB state): computers hear of it. */
function touchDevice(globalResources, wsServer, deviceId) {
    scheduleUpdated(globalResources, wsServerOf(globalResources, wsServer));
}

function describeComputer(s) {
    return { computerId: s.info.as.id, name: s.info.as.name, since: s.info.as.since, clientId: s.info.clientId || null, link: s.info.as.link || 'network', usbDevice: s.info.as.usbDevice || null };
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
    // a device with a computer on its USB link (its own DeX window) is connected by USB
    for (const d of devices) d.link = d.online && computers.some((c) => c.usbDevice === d.deviceId) ? 'usb' : (d.online ? 'network' : null);
    return { devices, computers };
}

let lastPeersKey = null;
const PEER_CLOCKS = new Set(['lastSeen', 'at', 'checkedAt', 'connectedAt', 'lastActivity']);
/** The peer list without its clocks, devices and computers in a fixed order. */
function peersKey(data) {
    const strip = (v) => {
        if (Array.isArray(v)) return v.map(strip);
        if (!v || typeof v !== 'object') return v;
        const out = {};
        for (const k of Object.keys(v).sort()) {
            if (PEER_CLOCKS.has(k)) continue;
            // free space moves with every file written; only a 256 MB step counts as a change
            out[k] = (k === 'free' || k === 'used') && typeof v[k] === 'number' ? Math.round(v[k] / 268435456) : strip(v[k]);
        }
        return out;
    };
    const byId = (a, b) => String(a.deviceId || a.id || a.clientId || '').localeCompare(String(b.deviceId || b.id || b.clientId || ''));
    try {
        return JSON.stringify({
            devices: (data.devices || []).map(strip).sort(byId),
            computers: (data.computers || []).map(strip).sort(byId)
        });
    } catch (_) { return String(Date.now()); }
}

// What a phone's page reads of its own row is its session, permissions and name (activeSyncAgent.js
// takeLists); these fields of that row change with the phone's own reports and nothing on the phone
// shows them (Device Center on a desktop does, and gets them all).
const OWN_ROW_UNREAD = ['status', 'speakers', 'adb', 'wallpapersAt', 'lastSync', 'queued', 'link'];
const lastOwnKeys = new Map(); // deviceId -> the peer list key its sockets last got (ownPeersKey)

/** The peer list as a device's own page sees it: its own row without the fields it does not read. */
function ownPeersKey(data, deviceId) {
    const devices = (data.devices || []).map((d) => {
        if (!d || d.deviceId !== deviceId) return d;
        const out = Object.assign({}, d);
        for (const k of OWN_ROW_UNREAD) delete out[k];
        return out;
    });
    return peersKey({ devices, computers: data.computers || [] });
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
        // only when something other than the clocks changed (rule server-push-not-polling): a phone
        // reports its status every few seconds, and each report re-sent this whole list (8 KB) to
        // every peer - 17 times in 2 min on the A53 - with only lastSeen / status.at different and the
        // devices in a new order
        const key = peersKey(data);
        if (key === lastPeersKey) return;
        lastPeersKey = key;
        // the pages watching Explorer's Network folder (DreamOS computers and their shares, modules/networkShares.js)
        try { require('./networkShares').peersChanged(globalResources, server, data); } catch (err) { console.warn('[activeSync] network list:', err.message); }
        // a phone's own report (battery, the program in front, Wi-Fi) no longer comes back to that same
        // phone as the whole list (#890): its sockets get it only when something it reads changed. The
        // app's background link reads no peer list at all (ActiveSyncLink); desktops get every change.
        const ownSend = new Map(); // deviceId -> whether its sockets get this one
        server.broadcast({ type: 'as_peers_updated', data, timestamp: new Date().toISOString() }, (info) => {
            if (!(info && info.authenticated && info.userType === 'admin' && info.as)) return false;
            if (info.as.speaker === 'service' || info.as.speaker === 'host') return false;
            if (info.as.kind !== 'device') return true;
            const id = info.as.id;
            if (!ownSend.has(id)) {
                const own = ownPeersKey(data, id);
                ownSend.set(id, lastOwnKeys.get(id) !== own);
                lastOwnKeys.set(id, own);
            }
            return ownSend.get(id);
        });
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
        // the notification filter the phone holds (#979, activeSyncNotifyFilter.js): a new one goes out only when it differs
        nfv: clampString(src.nfv, 40),
        since: now,
        session: null,
        permissions: [],
        status: null
    };
    if (kind === 'computer') {
        // the DeX window of the phone's own app (#794): the same phone as a device, linked as if by
        // USB (a cradle), not over the network
        const usbDevice = String(src.usbDevice || '').toLowerCase();
        if (src.link === 'usb' && isPeerId(usbDevice)) { as.link = 'usb'; as.usbDevice = usbDevice; noteContinuity(globalResources, usbDevice); }
        clientInfo.as = as;
        scheduleUpdated(globalResources, server);
        return { success: true, kind, id, name, ...list(globalResources, server) };
    }
    const d = getDb(globalResources);
    const prev = rowOf(globalResources, id);
    // the background link is a partner's: a guest is connected only while its app is open (Yukimi, Nov 12)
    if (as.speaker === 'service' && !(prev && prev.partner)) throw fail('NOT_PARTNER', 'The background connection needs a partnership.');
    // a DreamOS machine: only its own Miniport's sub, signed in as an administrator, for the device id it connected with
    // (cafeReadyHost.checkHello throws what is wrong); partnered by that sign-in
    const host = as.speaker === 'host';
    if (host) require('./cafeReadyHost').checkHello(server, clientInfo, id);
    const model = clampString(src.model, 64);
    const os = clampString(src.os, 64);
    const app = clampString(src.app, 64);
    if (prev) {
        // a partner keeps the name its partnership gave it; a guest's own name follows the phone, and
        // so does a partner's once its owner names it in Settings > About > Device ID (#829)
        d.prepare('UPDATE as_devices SET name = ?, model = ?, os = ?, app = ?, last_seen = ? WHERE device_id = ?')
            .run(prev.partner && src.nameSet !== true ? prev.name : name, model || prev.model, os || prev.os, app || prev.app, now, id);
    } else {
        d.prepare('INSERT INTO as_devices (device_id, name, model, os, app, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, name, model, os, app, now, now);
    }
    if (host) {
        d.prepare("UPDATE as_devices SET platform = 'cafeready', partner = 1, permissions = ? WHERE device_id = ?").run(JSON.stringify(require('./cafeReadyHost').PERMISSIONS), id);
        as.platform = 'cafeready';
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
    if (wasOnline) probeOlderLinks(server, id, clientInfo);
    if (as.status) d.prepare('UPDATE as_devices SET last_status = ? WHERE device_id = ?').run(JSON.stringify(as.status), id);
    if (as.status && as.status.continuity) noteContinuity(globalResources, id);
    if (!wasOnline) logEvent(globalResources, id, 'info', `Connected (${as.speaker})`);
    // ADB on 5555 (#818): look for the phone where this socket comes from (a DreamOS machine has none)
    if (!host) { try { require('./deviceAdb').noteOnline(globalResources, server, id); } catch (err) { console.warn('[activeSync] adb detect:', err.message); } }
    else { try { require('./cafeReadyHost').noteHello(globalResources, clientInfo, as); } catch (err) { console.warn('[activeSync] CaféReady hello:', err.message); } }
    scheduleUpdated(globalResources, server);
    // server modules that want a phone the moment it connects (Messaging's Android app accounts catch up, #885)
    // test: a test device (modules/testDevices.js, the Android emulator): its session is remembered so its page is fenced
    // from the household's notices before its own hello, and taps that take a phone's data into the household skip it
    const test = kind === 'device' && isTestDevice(id);
    if (test) { try { require('./testDevices').noteHello({ id, sessionId: clientInfo.sessionId }); } catch (_) { /* no fence module */ } }
    if (kind === 'device') for (const fn of helloTaps) { try { fn({ id, speaker: as.speaker, session: as.session, name: as.name, sessionId: clientInfo.sessionId || null, test, ops: as.ops, nfv: as.nfv }); } catch (_) { /* the tap's own fault */ } }
    const peers = list(globalResources, server);
    // the page has this list now: the broadcast its hello sets off is not sent back to it unless it
    // differs in what the page reads (scheduleUpdated)
    if (as.speaker !== 'service') lastOwnKeys.set(id, ownPeersKey(peers, id));
    return { success: true, kind, id, name: as.name, session: as.session, permissions: as.permissions, device: describeDevice(globalResources, server, row), ...peers };
}

/** as_status: fire-and-forget from a device; kept on the socket, written to the row now and then. */
function status(globalResources, wsServer, clientInfo, data) {
    if (!clientInfo || !clientInfo.as || clientInfo.as.kind !== 'device') return false;
    const st = sanitizeStatus(isPlainObject(data) && isPlainObject(data.status) ? data.status : data);
    if (!st) return false;
    clientInfo.as.status = st;
    const id = clientInfo.as.id;
    // a DreamOS machine on a phone's hotspot (host.tether, CaféReady wwan.rs): which partner phone it is (#953)
    if (st.host) { try { require('./phoneTether').hostStatus(globalResources, wsServerOf(globalResources, wsServer), id, clientInfo.as.name, st.host.tether); } catch (err) { console.warn('[activeSync] tether:', err.message); } }
    if (st.continuity) noteContinuity(globalResources, id);
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
        // a DreamOS machine's last socket gone: it is on no phone's hotspot any more as far as we know (#953)
        if (as.speaker === 'host' && !liveSockets(server, 'device', as.id).some((s) => s.info !== clientInfo)) { try { require('./phoneTether').hostGone(globalResources, server, as.id); } catch (_) { /* none */ } }
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
        // a DreamOS machine's commands go through the server's routes, which check and audit them (cafeReadyHost.js)
        if (opGroupName(op) === 'host') throw fail('NOT_PERMITTED', 'Ask the server (/api/activesync/host/...) for this.');
        const online = liveSockets(server, 'device', to).length > 0;
        if (!online) {
            if (src.queue === true && row.partner && QUEUEABLE.has(op)) return enqueue(globalResources, server, row, op, args, me.name);
            throw fail('OFFLINE', 'The device is not connected.');
        }
        checkDeviceOp(server, to, op);
        const target = socketFor(server, 'device', to, op);
        if (!target) throw noSocketError(server, to, op);
        if (target.info.as.speaker === 'host') require('./cafeReadyHost').auditCall(globalResources, row, op, args, `${me.name} (as_call)`);
        const res = await sendRequest(server, target, fromOf(clientInfo), op, args, timeoutMs);
        if (!res.ok) throw fail(res.error.code, res.error.message);
        if (target.info.as.speaker === 'service') { try { noteReceivedLive(globalResources, server, to, op, args, me.name); } catch (e) { console.warn('[activeSync] received note failed:', e.message); } }
        noteSynced(globalResources, server, to, op);
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
    noteSynced(globalResources, server, me.id, op);
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
    if (!target) throw noSocketError(server, deviceId, op);
    const timeoutMs = Math.min(opts.maxTimeoutMs || CALL_TIMEOUT_MAX_MS, Math.max(1000, Number(opts.timeoutMs) || CALL_TIMEOUT_MS));
    if (target.info.as.speaker === 'host') require('./cafeReadyHost').auditCall(globalResources, rowOf(globalResources, deviceId), op, args, opts.fromName || 'the server');
    const res = await sendRequest(server, target, { kind: 'computer', id: '', name: clampString(opts.fromName, 64) || hostName() }, op, args, timeoutMs);
    if (!res.ok) throw fail(res.error.code, res.error.message);
    if (target.info.as.speaker === 'service') { try { noteReceivedLive(globalResources, server, deviceId, op, args, opts.fromName || hostName()); } catch (e) { console.warn('[activeSync] received note failed:', e.message); } }
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

// ---- Received Items (#803): what reached the phone while it was locked or away ----------------------
// A delivery counts when it came out of the queue (the phone was disconnected) or was taken by the
// app's background service (the page was not on screen: locked, screen off, another app in front).
// The phone's status bar shows them and ActiveSync's Received Items tab lets the user act on each.
const RECEIVED_MAX = 100;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i;

function receivedOf(op, args) {
    const a = isPlainObject(args) ? args : {};
    const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
    if (op === 'open.item' && a.kind === 'url' && a.url) return { kind: 'link', title: clampString(a.title || a.url, 200), detail: { url: clampString(a.url, 4000) } };
    if (op === 'stream.receive') {
        const name = clampString(a.name || 'file', 200);
        const dir = String(a.dir || '/');
        return { kind: IMAGE_EXT.test(name) ? 'picture' : 'file', title: name, detail: { root: clampString(a.root || '', 64), path: `${dir.replace(/\/+$/, '')}/${name}`, size: Number(a.size) || 0 } };
    }
    if (op === 'apps.install') {
        // temp: the transfer id of a program in the app's temporary folder (activeSyncTransfers.js)
        const detail = { root: clampString(a.root || '', 64), path: clampString(a.path || '', 1000) };
        if (/^[0-9a-f]{32}$/.test(String(a.temp || ''))) detail.temp = a.temp;
        return { kind: 'program', title: clampString(a.name || base(a.path) || 'Program', 200), detail };
    }
    if (op === 'clipboard.set') return { kind: 'clipboard', title: clampString(String(a.text || '').replace(/\s+/g, ' ') || 'Clipboard', 120), detail: { text: clampString(String(a.text || ''), 4000) } };
    if (op === 'notify.show') return { kind: 'note', title: clampString(a.title || a.text || 'Notification', 200), detail: { text: clampString(String(a.text || ''), 2000) } };
    if (op === 'studio.setSession') return { kind: 'studio', title: 'Studio session', detail: {} };
    return null;
}

/** Is the phone's page on screen (its webview socket says visible: not locked, screen on, in front)? */
function pageOnScreen(server, deviceId) {
    return liveSockets(server, 'device', deviceId).some((s) => s.info.as.speaker !== 'service' && s.info.as.visible === true && !linkUnanswered(server, s));
}

/** A live delivery the background service took: an item only when the page was not on screen. */
function noteReceivedLive(globalResources, server, deviceId, op, args, fromName) {
    if (pageOnScreen(server, deviceId)) return;
    noteReceived(globalResources, server, deviceId, op, args, fromName);
}

/** The phone's page tells whether it is on screen (as_visible). */
function setVisible(clientInfo, visible) {
    if (!clientInfo || !clientInfo.as || clientInfo.as.kind !== 'device') return false;
    clientInfo.as.visible = !!visible;
    return true;
}

function noteReceived(globalResources, server, deviceId, op, args, fromName) {
    const r = receivedOf(op, args);
    if (!r) return;
    const d = getDb(globalResources);
    // an .apk sent to be installed: the program stands for the file it came in
    if (r.kind === 'program' && r.detail.path) {
        d.prepare("DELETE FROM as_received WHERE device_id = ? AND kind = 'file' AND json_extract(detail, '$.path') = ? AND created > ?").run(deviceId, r.detail.path, Date.now() - 10 * 60 * 1000);
    }
    d.prepare('INSERT INTO as_received (device_id, kind, op, title, detail, from_name, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(deviceId, r.kind, op, r.title, JSON.stringify(r.detail), clampString(fromName || '', 64), Date.now());
    d.prepare('DELETE FROM as_received WHERE device_id = ? AND id NOT IN (SELECT id FROM as_received WHERE device_id = ? ORDER BY id DESC LIMIT ?)').run(deviceId, deviceId, RECEIVED_MAX);
    notifyDevice(server, deviceId, 'received.changed', { unseen: receivedUnseen(globalResources, deviceId) });
    try { require('./phoneStatus').touch('received'); } catch (_) { /* best effort (#908) */ }
}

function receivedUnseen(globalResources, deviceId) {
    return getDb(globalResources).prepare('SELECT COUNT(*) AS n FROM as_received WHERE device_id = ? AND seen = 0').get(deviceId).n;
}

/** The device's received items, newest first. */
function listReceived(globalResources, deviceId) {
    if (!isPeerId(deviceId)) return [];
    return getDb(globalResources).prepare('SELECT * FROM as_received WHERE device_id = ? ORDER BY id DESC').all(deviceId).map((r) => ({
        id: r.id, kind: r.kind, op: r.op, title: r.title, detail: parseJson(r.detail, {}), from: r.from_name, at: r.created, seen: !!r.seen
    }));
}

/** action: 'seen' (all), 'remove' (one id), 'clear' (all). */
function updateReceived(globalResources, wsServer, deviceId, action, id) {
    if (!isPeerId(deviceId)) throw fail('UNKNOWN_DEVICE', 'No such device.');
    const d = getDb(globalResources);
    if (action === 'seen') d.prepare('UPDATE as_received SET seen = 1 WHERE device_id = ?').run(deviceId);
    else if (action === 'remove') d.prepare('DELETE FROM as_received WHERE device_id = ? AND id = ?').run(deviceId, Number(id) || 0);
    else if (action === 'clear') d.prepare('DELETE FROM as_received WHERE device_id = ?').run(deviceId);
    else throw fail('BAD_ACTION', 'action is seen, remove or clear');
    notifyDevice(wsServerOf(globalResources, wsServer), deviceId, 'received.changed', { unseen: receivedUnseen(globalResources, deviceId) });
    try { require('./phoneStatus').touch('received'); } catch (_) { /* best effort (#908) */ }
    return { success: true };
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
        const allowed = !need || sess.permissions.includes(need);
        // a file for the phone waits for the app's background service (#981): the page's hello does not deliver it
        if (allowed && !target && serviceOnly('device', item.op) && !liveSockets(server, 'device', deviceId).some((s) => s.info.as.speaker === 'service')) break;
        if (!allowed || !target) {
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
        if (res.ok) { try { noteReceived(globalResources, server, deviceId, item.op, parseJson(item.args, {}), item.from_name); } catch (e) { console.warn('[activeSync] received note failed:', e.message); } }
        for (const fn of queueListeners) {
            try { fn({ deviceId, op: item.op, args: parseJson(item.args, {}), ok: res.ok }); } catch (err) { console.warn('[activeSync] queue listener failed:', err.message); }
        }
        sent += 1;
    }
    if (sent) scheduleUpdated(globalResources, server);
    // a partner that connected and took what waited for it has synced (WMDC's Last Synchronized)
    const after = deviceSession(server, deviceId);
    if (after && after.session === 'partner' && !d.prepare('SELECT 1 FROM as_queue WHERE device_id = ? LIMIT 1').get(deviceId)) noteSynced(globalResources, server, deviceId, null);
    return sent;
}

const deviceEventTaps = [];
const helloTaps = [];
const endTaps = [];
let relayFilter = null;
/** fn(globalResources, device, eventName, detail) -> the detail computers get, or undefined to keep it from them (#979). */
function setRelayFilter(fn) { relayFilter = typeof fn === 'function' ? fn : null; }
/** fn(deviceId) after a partnership ended (its per-partnership state goes with it, #979). */
function onPartnershipEnded(fn) { if (typeof fn === 'function') endTaps.push(fn); }

/**
 * An as_event from the server to the administrators' computers (#979: a partnership's notification filter changed).
 * The packet is built once for every socket.
 */
function tellComputers(globalResources, wsServer, name, detail) {
    const server = wsServerOf(globalResources, wsServer);
    if (!server) return 0;
    const msg = { type: 'as_event', data: { from: { kind: 'server', id: '', name: '' }, event: name, detail }, timestamp: new Date().toISOString() };
    let n = 0;
    for (const s of liveSockets(server, 'computer')) {
        if (s.info.userType !== 'admin') continue;
        try { server.sendToClient(s.ws, msg); n += 1; } catch (_) { /* closing */ }
    }
    return n;
}
/** A test device (modules/testDevices.js): partnered for tests, fenced from the household's notices. */
function isTestDevice(id) { try { return require('./testDevices').isTestDevice(id); } catch (_) { return false; } }
/** fn({ id, speaker, session, name }) after a device's socket said as_hello (before its reply is sent). */
function onDeviceHello(fn) { if (typeof fn === 'function') helloTaps.push(fn); }
/** fn(eventName, detail, device) for every event a partnered device sends (after its permission check). */
function onDeviceEvent(fn) { if (typeof fn === 'function') deviceEventTaps.push(fn); }

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
    // a test device's Android notifications are its own (the emulator's test posts): not taken into the household's
    // Messaging accounts or Melaton Videos, not mirrored on computers; only its delivery confirmations are heard
    const test = me.kind === 'device' && isTestDevice(me.id);
    if (test && name !== 'inbox.posted' && /^notify\./.test(name)) return 0;
    // server modules that take a device's news themselves (Melaton Videos imports notify.posted, #861)
    if (me.kind === 'device') for (const tap of deviceEventTaps) { if (test && name !== 'inbox.posted') continue; try { tap(name, src.detail == null ? null : src.detail, me); } catch (_) { /* the tap's own fault */ } }
    // news for the server only: a notice's delivery confirmation (notificationInbox, #908) goes to no computer
    if (me.kind === 'device' && name === 'inbox.posted') return 0;
    let detail = src.detail == null ? null : src.detail;
    // the partnership's notification filter (#979): a notification it does not send to computers stops here (the
    // server's own modules above still took it), the rest carry whether they show in the notification area
    if (me.kind === 'device' && relayFilter) {
        try { detail = relayFilter(globalResources, me, name, detail); } catch (err) { console.warn('[activeSync] relay filter failed:', err.message); }
        if (detail === undefined) return 0;
    }
    const msg = { type: 'as_event', data: { from: fromOf(clientInfo), event: name, detail }, timestamp: new Date().toISOString() };
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
        // no partnership, no primary device and no notification settings (#979)
        if (primaryOf(globalResources) === deviceId) setPrimary(globalResources, server, '');
        for (const fn of endTaps) { try { fn(deviceId); } catch (_) { /* the tap's own fault */ } }
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

/**
 * Partnered phones and their links, for server features that push to the app itself (Text Messaging's
 * notifications, Yozora #779): { deviceId, name, service (its background socket or null), foreground
 * (a WebView of it reported being on screen) }.
 */
function partnerLinks(globalResources, wsServer) {
    const server = wsServerOf(globalResources, wsServer);
    const out = [];
    const ids = new Set(liveSockets(server, 'device').map((s) => s.info.as.id));
    for (const id of ids) {
        const live = liveSockets(server, 'device', id);
        if (!live.some((s) => s.info.as.session === 'partner')) continue;
        const service = live.find((s) => s.info.as.speaker === 'service') || null;
        // a page whose link has not answered its ping may be gone (a silent drop): it is not in front
        const foreground = live.some((s) => s.info.as.speaker === 'webview' && s.info.as.status && s.info.as.status.foreground === true && !linkUnanswered(server, s));
        const row = rowOf(globalResources, id);
        out.push({ deviceId: id, name: row ? row.name : '', service, foreground });
    }
    return out;
}

/**
 * Ring ActiveSync's line on every partnered phone's background link (Yozora #815): DSApp's
 * ActiveSyncLink hands it to the Melaton Café Miniport (wakes an idle link) and, for "update" with
 * no Melaton window open, to its BackgroundUpdater (fills the cache from /updater.html).
 * Returns how many phones were rung.
 */
function ringPartners(globalResources, wsServer, reason) {
    const server = wsServerOf(globalResources, wsServer);
    if (!server) return 0;
    let rung = 0;
    for (const link of partnerLinks(globalResources, server)) {
        if (!link.service) continue;
        try {
            server.sendToClient(link.service.ws, { type: 'miniport_ring', data: { reason: String(reason || '') }, timestamp: new Date().toISOString() });
            rung += 1;
        } catch (_) { /* closing */ }
    }
    return rung;
}

/**
 * The app's background notification credits line (#890): { free, paid, daysLeft } strings, the same
 * values as GET /android/background-notification (modules/backgroundNotificationCredits.js). Each
 * background link (speaker 'service') gets as_credits once after its hello and again whenever the
 * values change (pushCredits runs on the server's 10 s status read), so the app need not ask while
 * its link is up.
 */
let creditsProvider = null;
let lastCreditsKey = null;

/** fn() -> { free, paid, daysLeft } from what the server holds (web_server.js sets it at boot). */
function setCreditsProvider(fn) {
    creditsProvider = typeof fn === 'function' ? fn : null;
}

function creditsNow() {
    if (!creditsProvider) return null;
    try {
        const v = creditsProvider();
        if (!v || typeof v !== 'object') return null;
        const str = (x) => (x == null ? '' : String(x));
        return { free: str(v.free), paid: str(v.paid), daysLeft: str(v.daysLeft) };
    } catch (err) {
        console.warn('[activeSync] credits read failed:', err.message);
        return null;
    }
}

/**
 * as_credits to the background links whose last copy differs. onlyInfo: one link (its hello; it is
 * sent the values whatever it had). Returns how many links it went to.
 */
function pushCredits(globalResources, wsServer, onlyInfo) {
    const server = wsServerOf(globalResources, wsServer);
    if (!server || typeof server.sendToClient !== 'function') return 0;
    const data = creditsNow();
    if (!data) return 0;
    const key = `${data.free}|${data.paid}|${data.daysLeft}`;
    // nothing new since the last round, and every link that said hello since was sent it then
    if (!onlyInfo && key === lastCreditsKey) return 0;
    if (!onlyInfo) lastCreditsKey = key;
    let sent = 0;
    for (const s of liveSockets(server, 'device')) {
        if (s.info.as.speaker !== 'service') continue;
        if (onlyInfo ? s.info !== onlyInfo : s.info.asCreditsKey === key) continue;
        try {
            server.sendToClient(s.ws, { type: 'as_credits', data, timestamp: new Date().toISOString() });
            s.info.asCreditsKey = key;
            sent += 1;
        } catch (_) { /* closing */ }
    }
    return sent;
}

/**
 * A notice from the notification inbox (#845) to every partnered phone's background link (Melaton Bars
 * #876 D, Yukimi Nov 16: Dreamscape notifications still arrive when the app's page is not running -
 * "it's always ready"). pageConnected says whether a Melaton page of that phone is on its link now (it
 * shows the notice itself); without one the app posts it as an Android notification. Returns how many
 * phones it went to.
 */
function sendInboxNotice(globalResources, wsServer, notice, opts = {}) {
    const server = wsServerOf(globalResources, wsServer);
    if (!server || !notice) return 0;
    let sent = 0;
    const ids = new Set(liveSockets(server, 'device').map((x) => x.info.as.id));
    for (const id of ids) {
        // one phone only: its link said hello again and catches up (notificationInbox.catchUpPhone, #889)
        if (opts.deviceId && id !== opts.deviceId) continue;
        // the test lane (modules/testDevices.js): test notices to test devices only, the household's never to them
        if ((notice.user === 'test') !== isTestDevice(id)) continue;
        const live = liveSockets(server, 'device', id);
        if (!live.some((x) => x.info.as.session === 'partner')) continue;
        const service = live.find((x) => x.info.as.speaker === 'service');
        if (!service) continue;
        const pageConnected = live.some((x) => x.info.as.speaker === 'webview' && !linkUnanswered(server, x));
        if (sendServerEvent(globalResources, server, service, 'inbox.notice', Object.assign({}, notice, { pageConnected }))) {
            sent += 1;
            // the phones it went to: each must confirm it posted it (notificationInbox deliveries, #908)
            if (Array.isArray(opts.sentTo)) opts.sentTo.push(id);
        }
    }
    return sent;
}

/**
 * A notice is done with (read, dismissed or used anywhere, or expired; #876): as_event 'inbox.cleared'
 * { id } to every partnered phone's background link, so the app cancels its Android notification.
 */
function sendInboxCleared(globalResources, wsServer, notice) {
    const server = wsServerOf(globalResources, wsServer);
    const id = notice && notice.id ? String(notice.id) : '';
    if (!server || !id) return 0;
    let sent = 0;
    const ids = new Set(liveSockets(server, 'device').map((x) => x.info.as.id));
    for (const devId of ids) {
        // the same lanes as the notices themselves (a test id cleared on a test device only, and the other way round)
        if ((notice.user === 'test') !== isTestDevice(devId)) continue;
        const live = liveSockets(server, 'device', devId);
        if (!live.some((x) => x.info.as.session === 'partner')) continue;
        const service = live.find((x) => x.info.as.speaker === 'service');
        if (!service) continue;
        if (sendServerEvent(globalResources, server, service, 'inbox.cleared', { id })) sent += 1;
    }
    return sent;
}

/** An as_event from the server to one socket (a phone's background link). */
function sendServerEvent(globalResources, wsServer, socket, name, detail) {
    const server = wsServerOf(globalResources, wsServer);
    if (!server || !socket) return false;
    try {
        server.sendToClient(socket.ws, { type: 'as_event', data: { from: { kind: 'server', id: '', name: '' }, event: name, detail }, timestamp: new Date().toISOString() });
        return true;
    } catch (_) { return false; }
}

/** A device's sync ran (the client tells the server what it finished). */
/**
 * Last sync (#827): a partner's data went across (a relayed data op, its queue delivered on
 * connect). Written at most once a minute per device.
 */
const SYNC_GROUPS = new Set(['storage', 'stream', 'studio', 'clipboard', 'open', 'notify', 'apps', 'sync']);
const syncWrites = new Map();
function noteSynced(globalResources, wsServer, deviceId, op) {
    if (op && !SYNC_GROUPS.has(opGroupName(op))) return;
    const now = Date.now();
    if (now - (syncWrites.get(deviceId) || 0) < 60000) return;
    try {
        const row = rowOf(globalResources, deviceId);
        if (!row || !row.partner) return;
        syncWrites.set(deviceId, now);
        getDb(globalResources).prepare('UPDATE as_devices SET last_sync = ? WHERE device_id = ?').run(now, deviceId);
        scheduleUpdated(globalResources, wsServer);
    } catch (err) { console.warn('[activeSync] last sync write failed:', err.message); }
}

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
    if (primaryOf(globalResources) === deviceId) setPrimary(globalResources, server, '');
    for (const fn of endTaps) { try { fn(deviceId); } catch (_) { /* the tap's own fault */ } }
    scheduleUpdated(globalResources, server);
    return res.changes > 0;
}

function resetForTests(databasesPath) {
    if (db) {
        try { db.close(); } catch (_) { /* closed */ }
    }
    db = null;
    dbPath = null;
    primaryCache = null;
    lastWsServer = null;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = null;
    for (const p of pendingCalls.values()) clearTimeout(p.timer);
    pendingCalls.clear();
    statusWrites.clear();
    lastOwnKeys.clear();
    lastCreditsKey = null;
    if (databasesPath) getDb({ getPath: () => databasesPath });
}

module.exports = {
    onDeviceEvent,
    primaryOf,
    setPrimary,
    setRelayFilter,
    onPartnershipEnded,
    tellComputers,
    /** The ActiveSync database (activeSyncNotifyFilter.js keeps its tables beside the devices, #979). */
    db: getDb,
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
    onDeviceHello,
    queueFor,
    listReceived,
    updateReceived,
    setVisible,
    receivedUnseen,
    __test: { noteReceived, receivedOf, peersKey, ownPeersKey },
    deviceOnline,
    deviceAddresses,
    deviceRow,
    touchDevice,
    /** as_event from the server to a device's sockets (transfer progress, #822). */
    tellDevice: (globalResources, wsServer, deviceId, name, detail) => notifyDevice(wsServerOf(globalResources, wsServer), deviceId, name, detail),
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
    partnerLinks,
    ringPartners,
    setCreditsProvider,
    pushCredits,
    sendInboxNotice,
    sendInboxCleared,
    sendServerEvent,
    resetForTests
};
