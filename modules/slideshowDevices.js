/**
 * Slideshow devices (Yozora #654): Dreamscape Frame tablets (Android, DreamscapeFrame/1.x) that
 * show the gallery as a screensaver. A device identifies on every connect (client_identify),
 * reports what it shows (client_device_state), and takes remote commands (device_command) from
 * Control Panel's Melaton SideShow page. Devices persist while offline in their own sqlite file
 * (.cache/slideshow_devices.db); a set_settings or rename sent while a device is offline waits in
 * pending_settings / pending_name and goes out in its next identify reply.
 *
 * The live half lives on the socket's clientInfo (deviceId, deviceKind, deviceName, deviceState),
 * so the online list is always the open sockets, never a second registry.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const DEVICE_KINDS = new Set(['slideshow']);
const DEVICE_STATES = new Set(['showing', 'paused', 'offline_cache', 'signin_needed', 'stopped']);
const DEVICE_COMMANDS = new Set(['next', 'previous', 'pause', 'resume', 'show', 'refresh', 'set_settings', 'rename']);
// commands an offline device keeps for its next identify
const OFFLINE_COMMANDS = new Set(['set_settings', 'rename']);
const VIEW_TYPES = new Set(['images', 'pinned', 'upscaled']);
const INFO_OVERLAYS = new Set(['off', 'minimal', 'full']);
const ACK_TIMEOUT_MS = 6000;
const BROADCAST_DEBOUNCE_MS = 250;

let db = null;
let dbPath = null;
const pendingAcks = new Map(); // commandId -> { deviceId, resolve, timer }
let broadcastTimer = null;
let lastWsServer = null;

function isDeviceId(value) {
    return /^[0-9a-f]{12}$/.test(String(value || '').trim());
}

function clampString(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
}

/** Only the keys the client knows, each in range; unknown or bad values are dropped. */
function sanitizeSettings(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    if (VIEW_TYPES.has(src.viewType)) out.viewType = src.viewType;
    const interval = clampInt(src.intervalSec, 5, 3600);
    if (src.intervalSec != null && interval != null) out.intervalSec = interval;
    const pool = clampInt(src.poolSize, 1, 1000);
    if (src.poolSize != null && pool != null) out.poolSize = pool;
    if (typeof src.shuffle === 'boolean') out.shuffle = src.shuffle;
    if (typeof src.pairPortraits === 'boolean') out.pairPortraits = src.pairPortraits;
    if (INFO_OVERLAYS.has(src.infoOverlay)) out.infoOverlay = src.infoOverlay;
    // where the pictures come from (served by device_slideshow_images): workspace ids (empty = the
    // session's active one, "*" = every workspace), an age limit in days (0 = any), or an Image Search
    // (the Sidebar Slide Show's omegasearch query; null clears it)
    if (Array.isArray(src.workspaces)) {
        out.workspaces = Array.from(new Set(src.workspaces.map((w) => clampString(w, 100)).filter(Boolean))).slice(0, 20);
        if (out.workspaces.includes('*')) out.workspaces = ['*'];
    }
    const age = clampInt(src.maxAgeDays, 0, 3650);
    if (src.maxAgeDays != null && age != null) out.maxAgeDays = age;
    if (src.search === null) out.search = null;
    else if (src.search && typeof src.search === 'object') {
        const search = require('./sidebarGadgets').sanitizeFrameSearch(src.search);
        if (search) out.search = search;
    }
    return out;
}

const MAX_CANDIDATES = 5000;

/** Gallery files start with their creation time in ms ("1792945938451_generated_..."). */
function filenameMs(name) {
    const m = /^(\d{12,14})_/.exec(String(name || ''));
    const ms = m ? Number(m[1]) : 0;
    // some names carry a seed-like number, not a time: past tomorrow counts as undated
    return ms && ms <= Date.now() + 86400000 ? ms : 0;
}

function mtimeMs(value) {
    if (value == null) return 0;
    const n = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(n)) return 0;
    return n < 1e12 ? n * 1000 : n;
}

/**
 * The pictures a device shows for these settings: newest first, at most poolSize, each
 * { filename, width, height, mtime }. ctx: { metadataDb, workspaceManager, sessionId, runSearch(search) }.
 */
async function resolveImages(ctx, rawSettings) {
    const settings = Object.assign({ viewType: 'images', poolSize: 60, maxAgeDays: 0, workspaces: [] }, rawSettings || {});
    const db = ctx.metadataDb;
    if (!db) return { total: 0, items: [] };
    const cutoff = settings.maxAgeDays > 0 ? Date.now() - settings.maxAgeDays * 86400000 : 0;
    const pickName = (row) => (settings.viewType === 'upscaled' ? (row.upscaled || row.original) : (row.original || row.upscaled));
    let rows = [];
    if (settings.search) {
        // search results come unordered and without dates: the filename's leading timestamp dates them,
        // and only the pictures that make the cut get their sizes looked up
        let found = (await ctx.runSearch(settings.search)).map((f) => ({ filename: f, width: null, height: null, mtime: filenameMs(f) }));
        found.sort((x, y) => y.mtime - x.mtime);
        if (cutoff) found = found.filter((r) => r.mtime >= cutoff);
        const picked = found.slice(0, settings.poolSize);
        const light = picked.length ? await db.getLightweightMetadata(picked.map((r) => r.filename)) : {};
        picked.forEach((r) => {
            const m = (light && light[r.filename]) || {};
            r.width = m.width || null;
            r.height = m.height || null;
            if (!r.mtime) r.mtime = mtimeMs(m.mtime);
        });
        return { total: found.length, items: picked };
    } else {
        let ids = Array.isArray(settings.workspaces) ? settings.workspaces : [];
        if (ids.includes('*')) ids = Object.keys((ctx.workspaceManager && ctx.workspaceManager.getWorkspaces()) || {});
        if (!ids.length) ids = [(ctx.workspaceManager && ctx.sessionId && ctx.workspaceManager.getActiveWorkspace(ctx.sessionId)) || 'default'];
        const seen = new Set();
        for (const id of ids) {
            const page = await db.listWorkspaceGalleryItemsPaginated(id, settings.viewType, 0, MAX_CANDIDATES);
            for (const row of (page && page.items) || []) {
                const f = pickName(row);
                if (!f || seen.has(f)) continue;
                seen.add(f);
                rows.push({ filename: f, width: row.width || null, height: row.height || null, mtime: mtimeMs(row.mtime) || filenameMs(f) });
            }
        }
        rows.sort((a, b) => b.mtime - a.mtime);
    }
    if (cutoff) rows = rows.filter((r) => r.mtime >= cutoff);
    return { total: rows.length, items: rows.slice(0, settings.poolSize) };
}

function deviceSettings(globalResources, deviceId) {
    const row = rowOf(globalResources, deviceId);
    return row ? parseJson(row.settings, {}) : null;
}

function sanitizeDisplay(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    const w = clampInt(src.width, 1, 100000);
    const h = clampInt(src.height, 1, 100000);
    if (src.width != null && w != null) out.width = w;
    if (src.height != null && h != null) out.height = h;
    if (src.orientation === 'landscape' || src.orientation === 'portrait') out.orientation = src.orientation;
    return out;
}

/** Gallery filenames only: a basename, at most two (a portrait pair). */
function sanitizeShowing(raw) {
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list
        .map((f) => path.basename(clampString(f, 200)))
        .filter((f) => f && f !== '.' && f !== '..')
        .slice(0, 2);
}

function parseJson(text, fallback) {
    if (!text) return fallback;
    try {
        const v = JSON.parse(text);
        return v == null ? fallback : v;
    } catch (_) {
        return fallback;
    }
}

function getDb(globalResources) {
    if (db) return db;
    const dir = globalResources && typeof globalResources.getPath === 'function'
        ? globalResources.getPath('databases')
        : path.resolve(__dirname, '..', '.cache');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    dbPath = path.join(dir, 'slideshow_devices.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS slideshow_devices (
            device_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            app TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            os TEXT NOT NULL DEFAULT '',
            display TEXT NOT NULL DEFAULT '{}',
            settings TEXT NOT NULL DEFAULT '{}',
            pending_settings TEXT,
            pending_name TEXT,
            last_state TEXT,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL
        )
    `);
    return db;
}

function rowOf(globalResources, deviceId) {
    return getDb(globalResources).prepare('SELECT * FROM slideshow_devices WHERE device_id = ?').get(deviceId) || null;
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

/** The device's open socket (the newest, should a stale one linger). */
function findDeviceSocket(wsServer, deviceId) {
    if (!wsServer || !wsServer.clients || !deviceId) return null;
    let best = null;
    for (const [ws, info] of wsServer.clients) {
        if (!info || info.deviceId !== deviceId || ws.readyState !== WebSocket.OPEN) continue;
        if (!best || new Date(info.connectedAt).getTime() > new Date(best.info.connectedAt).getTime()) best = { ws, info };
    }
    return best;
}

function describe(row, live) {
    // online: the socket's own state since this connect (a fresh identify has none yet)
    const liveState = live ? live.info.deviceState : null;
    const state = liveState || parseJson(row.last_state, null);
    const online = !!live && !(liveState && liveState.state === 'stopped');
    return {
        deviceId: row.device_id,
        kind: row.kind,
        name: row.name,
        app: row.app,
        model: row.model,
        os: row.os,
        display: parseJson(row.display, {}),
        online,
        lastSeen: online ? Date.now() : row.last_seen,
        firstSeen: row.first_seen,
        state: state ? state.state : null,
        showing: state && Array.isArray(state.showing) ? state.showing : [],
        since: state && state.since ? state.since : null,
        settings: parseJson(row.settings, {}),
        pendingSettings: parseJson(row.pending_settings, null),
        pendingName: row.pending_name || null
    };
}

function listDevices(globalResources, wsServer) {
    const server = wsServerOf(globalResources, wsServer);
    const rows = getDb(globalResources).prepare('SELECT * FROM slideshow_devices').all();
    const out = rows.map((row) => describe(row, findDeviceSocket(server, row.device_id)));
    out.sort((a, b) => (b.online - a.online) || (b.lastSeen - a.lastSeen) || a.name.localeCompare(b.name));
    return out;
}

/** devices_updated to the administrators' tabs (not to devices), coalesced. */
function scheduleDevicesUpdated(globalResources, wsServer) {
    const server = wsServerOf(globalResources, wsServer);
    if (!server || typeof server.broadcast !== 'function') return;
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        let devices;
        try {
            devices = listDevices(globalResources, server);
        } catch (err) {
            console.warn('[slideshowDevices] list for devices_updated failed:', err.message);
            return;
        }
        server.broadcast({ type: 'devices_updated', data: { devices }, timestamp: new Date().toISOString() },
            (info) => !!(info && info.authenticated && info.userType === 'admin' && !info.deviceId && !info.deviceApp));
    }, BROADCAST_DEBOUNCE_MS);
    if (typeof broadcastTimer.unref === 'function') broadcastTimer.unref();
}

/**
 * client_identify: register or refresh the device and hand back what the Control Panel changed
 * while it was offline (pending settings, a pending rename), which the device then applies.
 */
function identify(globalResources, wsServer, clientInfo, data) {
    const src = data && typeof data === 'object' ? data : {};
    const kind = String(src.kind || '').trim();
    if (!DEVICE_KINDS.has(kind)) {
        const err = new Error('Unknown device kind');
        err.code = 'BAD_DEVICE_KIND';
        throw err;
    }
    const deviceId = String(src.deviceId || '').trim().toLowerCase();
    if (!isDeviceId(deviceId)) {
        const err = new Error('deviceId must be 12 lowercase hex');
        err.code = 'BAD_DEVICE_ID';
        throw err;
    }
    const now = Date.now();
    const reported = {
        name: clampString(src.name, 64),
        app: clampString(src.app, 64),
        model: clampString(src.model, 64),
        os: clampString(src.os, 64),
        display: sanitizeDisplay(src.display),
        settings: sanitizeSettings(src.settings)
    };
    const d = getDb(globalResources);
    const row = rowOf(globalResources, deviceId);
    const pending = row ? parseJson(row.pending_settings, null) : null;
    const pendingName = row && row.pending_name ? row.pending_name : null;
    const name = pendingName || reported.name || (row && row.name) || 'Slideshow device';
    const settings = Object.assign({}, row ? parseJson(row.settings, {}) : {}, reported.settings, pending || {});
    if (row) {
        d.prepare(`UPDATE slideshow_devices SET kind = ?, name = ?, app = ?, model = ?, os = ?, display = ?, settings = ?,
            pending_settings = NULL, pending_name = NULL, last_seen = ? WHERE device_id = ?`)
            .run(kind, name, reported.app, reported.model, reported.os, JSON.stringify(reported.display), JSON.stringify(settings), now, deviceId);
    } else {
        d.prepare(`INSERT INTO slideshow_devices (device_id, kind, name, app, model, os, display, settings, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(deviceId, kind, name, reported.app, reported.model, reported.os, JSON.stringify(reported.display), JSON.stringify(settings), now, now);
    }
    if (clientInfo) {
        clientInfo.deviceId = deviceId;
        clientInfo.deviceKind = kind;
        clientInfo.deviceName = name;
        clientInfo.deviceState = null;
    }
    scheduleDevicesUpdated(globalResources, wsServer);
    const reply = { success: true, deviceId, name };
    if (pending && Object.keys(pending).length) reply.settings = pending;
    return reply;
}

/** client_device_state: what is on screen now; kept on the socket and as last_state. */
function deviceState(globalResources, wsServer, clientInfo, data) {
    const src = data && typeof data === 'object' ? data : {};
    const deviceId = String(src.deviceId || (clientInfo && clientInfo.deviceId) || '').trim().toLowerCase();
    if (!clientInfo || !clientInfo.deviceId || deviceId !== clientInfo.deviceId) return false;
    const state = String(src.state || '').trim();
    if (!DEVICE_STATES.has(state)) return false;
    const since = Number(src.since);
    const rec = { state, showing: sanitizeShowing(src.showing), since: Number.isFinite(since) && since > 0 ? Math.round(since) : Date.now() };
    clientInfo.deviceState = rec;
    getDb(globalResources).prepare('UPDATE slideshow_devices SET last_state = ?, last_seen = ? WHERE device_id = ?')
        .run(JSON.stringify(rec), Date.now(), deviceId);
    scheduleDevicesUpdated(globalResources, wsServer);
    return true;
}

function commandAck(clientInfo, message) {
    const id = String((message && message.commandId) || '');
    const entry = pendingAcks.get(id);
    if (!entry || !clientInfo || entry.deviceId !== clientInfo.deviceId) return false;
    pendingAcks.delete(id);
    clearTimeout(entry.timer);
    const data = message.data && typeof message.data === 'object' ? message.data : {};
    entry.resolve({ ok: data.ok !== false, error: data.error ? clampString(data.error, 200) : undefined });
    return true;
}

/** The socket closed: the device is offline from now, last seen now. */
function onSocketClosed(globalResources, wsServer, clientInfo) {
    if (!clientInfo || !clientInfo.deviceId) return;
    try {
        // another socket of the same device may still be open (a reconnect overtook the close)
        if (findDeviceSocket(wsServerOf(globalResources, wsServer), clientInfo.deviceId)) return;
        getDb(globalResources).prepare('UPDATE slideshow_devices SET last_seen = ? WHERE device_id = ?').run(Date.now(), clientInfo.deviceId);
        scheduleDevicesUpdated(globalResources, wsServer);
    } catch (err) {
        console.warn('[slideshowDevices] close bookkeeping failed:', err.message);
    }
}

function badRequest(message, code) {
    const err = new Error(message);
    err.code = code || 'BAD_REQUEST';
    return err;
}

/**
 * device_send_command: relay a device_command to the device and wait for its ack. An offline
 * device keeps set_settings / rename for its next identify; the other commands need it online.
 */
async function sendCommand(globalResources, wsServer, req) {
    const src = req && typeof req === 'object' ? req : {};
    const deviceId = String(src.deviceId || '').trim().toLowerCase();
    const command = String(src.command || '').trim();
    if (!isDeviceId(deviceId)) throw badRequest('deviceId must be 12 lowercase hex', 'BAD_DEVICE_ID');
    if (!DEVICE_COMMANDS.has(command)) throw badRequest('Unknown device command', 'BAD_COMMAND');
    const row = rowOf(globalResources, deviceId);
    if (!row) throw badRequest('Unknown device', 'DEVICE_NOT_FOUND');

    const data = { command };
    if (command === 'show') {
        const [filename] = sanitizeShowing(src.filename);
        if (!filename) throw badRequest('show needs a filename', 'BAD_FILENAME');
        data.filename = filename;
    } else if (command === 'set_settings') {
        data.settings = sanitizeSettings(src.settings);
        if (!Object.keys(data.settings).length) throw badRequest('No valid settings', 'BAD_SETTINGS');
    } else if (command === 'rename') {
        data.name = clampString(src.name, 64);
        if (!data.name) throw badRequest('rename needs a name', 'BAD_NAME');
    }

    // the stored row follows the change either way, so the page shows it at once
    const d = getDb(globalResources);
    if (command === 'set_settings') {
        const merged = Object.assign(parseJson(row.settings, {}), data.settings);
        d.prepare('UPDATE slideshow_devices SET settings = ? WHERE device_id = ?').run(JSON.stringify(merged), deviceId);
    } else if (command === 'rename') {
        d.prepare('UPDATE slideshow_devices SET name = ? WHERE device_id = ?').run(data.name, deviceId);
    }

    const server = wsServerOf(globalResources, wsServer);
    const live = findDeviceSocket(server, deviceId);
    const stopped = live && live.info.deviceState && live.info.deviceState.state === 'stopped';
    if (!live || stopped) {
        if (!OFFLINE_COMMANDS.has(command)) throw badRequest('The device is offline', 'DEVICE_OFFLINE');
        if (command === 'set_settings') {
            const pending = Object.assign(parseJson(row.pending_settings, {}) || {}, data.settings);
            d.prepare('UPDATE slideshow_devices SET pending_settings = ? WHERE device_id = ?').run(JSON.stringify(pending), deviceId);
        } else {
            d.prepare('UPDATE slideshow_devices SET pending_name = ? WHERE device_id = ?').run(data.name, deviceId);
        }
        scheduleDevicesUpdated(globalResources, server);
        return { success: true, deviceId, command, queued: true };
    }

    if (command === 'rename') live.info.deviceName = data.name;
    const commandId = `c-${crypto.randomBytes(6).toString('hex')}`;
    const ack = new Promise((resolve) => {
        const timer = setTimeout(() => {
            pendingAcks.delete(commandId);
            resolve(null);
        }, ACK_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
        pendingAcks.set(commandId, { deviceId, resolve, timer });
    });
    server.sendToClient(live.ws, { type: 'device_command', commandId, data, timestamp: new Date().toISOString() });
    scheduleDevicesUpdated(globalResources, server);
    const result = await ack;
    if (!result) return { success: false, deviceId, command, commandId, error: 'The device did not answer', code: 'ACK_TIMEOUT' };
    return { success: result.ok, deviceId, command, commandId, ...(result.error ? { error: result.error } : {}) };
}

function forget(globalResources, wsServer, deviceId) {
    const id = String(deviceId || '').trim().toLowerCase();
    if (!isDeviceId(id)) throw badRequest('deviceId must be 12 lowercase hex', 'BAD_DEVICE_ID');
    const removed = getDb(globalResources).prepare('DELETE FROM slideshow_devices WHERE device_id = ?').run(id).changes > 0;
    scheduleDevicesUpdated(globalResources, wsServer);
    return removed;
}

/** For listClients(): what a device socket says about itself. */
function clientDeviceFields(info) {
    if (!info || !(info.deviceId || info.deviceApp)) return null;
    return {
        kind: info.deviceKind || 'slideshow',
        name: info.deviceName || null,
        deviceId: info.deviceId || null,
        app: info.deviceApp || null
    };
}

function resetForTests(databasesPath) {
    if (db) {
        try { db.close(); } catch (_) { /* closed */ }
    }
    db = null;
    lastWsServer = null;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = null;
    return getDb({ getPath: () => databasesPath });
}

module.exports = {
    DEVICE_KINDS,
    DEVICE_STATES,
    DEVICE_COMMANDS,
    isDeviceId,
    sanitizeSettings,
    sanitizeShowing,
    resolveImages,
    deviceSettings,
    identify,
    deviceState,
    commandAck,
    onSocketClosed,
    sendCommand,
    forget,
    listDevices,
    clientDeviceFields,
    resetForTests
};
