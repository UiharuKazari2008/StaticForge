/**
 * Slideshow devices (Yozora #654): Dreamscape Frame tablets (Android, DreamscapeFrame/1.x) that
 * show the gallery as a screensaver. A device identifies on every connect (client_identify),
 * reports what it shows (client_device_state), and takes remote commands (device_command) from
 * Control Panel's Melaton SideShow page. Devices persist while offline in their own sqlite file
 * (.cache/slideshow_devices.db); a set_settings or rename sent while a device is offline waits in
 * pending_settings / pending_name and goes out in its next identify reply.
 *
 * Device-specific settings (deviceConfig) and gadgets are self-described by each device
 * (DS-SlideShow-win64/docs/DEVICE_CONFIG_PROTOCOL.md): the server stores the schema and values a
 * device reports, validates set_device_config against that schema and never knows the fields itself.
 * A set_device_config / set_mode for an offline device waits in pending_device_config and goes out
 * as a set_device_config command right after its next identify reply.
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
const DEVICE_COMMANDS = new Set(['next', 'previous', 'pause', 'resume', 'show', 'refresh', 'set_settings', 'rename', 'set_device_config', 'set_mode']);
// commands an offline device keeps for its next identify
const OFFLINE_COMMANDS = new Set(['set_settings', 'rename', 'set_device_config', 'set_mode']);
const GADGET_MODES = new Set(['slideshow', 'clock']);
const CONFIG_MAX_BYTES = 256 * 1024;
const CONFIG_MAX_FIELDS = 500;
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
    const interval = clampInt(src.intervalSec, 5, 86400);
    if (src.intervalSec != null && interval != null) out.intervalSec = interval;
    // 0 = every matching picture (the default); otherwise only the newest N
    const pool = clampInt(src.poolSize, 0, 1000000);
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

const LIST_TTL_MS = 2 * 60 * 1000;
const MAX_LISTS = 20;
const PAGE_DEFAULT = 500;
const PAGE_MAX = 2000;
const listCache = new Map(); // key -> { rows, expiresAt }

/** Every picture these settings match, newest first, capped by poolSize (0 = no cap); cached 2 minutes. */
async function resolveAll(ctx, settings) {
    const db = ctx.metadataDb;
    if (!db) return [];
    let ids = Array.isArray(settings.workspaces) ? settings.workspaces : [];
    if (!settings.search) {
        if (ids.includes('*')) ids = Object.keys((ctx.workspaceManager && ctx.workspaceManager.getWorkspaces()) || {});
        if (!ids.length) ids = [(ctx.workspaceManager && ctx.sessionId && ctx.workspaceManager.getActiveWorkspace(ctx.sessionId)) || 'default'];
    }
    const key = JSON.stringify([settings.search || null, settings.search ? null : ids, settings.viewType, settings.maxAgeDays, settings.poolSize]);
    const now = Date.now();
    const hit = listCache.get(key);
    if (hit && hit.expiresAt > now) return hit.rows;

    const cutoff = settings.maxAgeDays > 0 ? now - settings.maxAgeDays * 86400000 : 0;
    const pickName = (row) => (settings.viewType === 'upscaled' ? (row.upscaled || row.original) : (row.original || row.upscaled));
    let rows = [];
    if (settings.search) {
        // search results come unordered and without dates: the filename's leading timestamp dates them;
        // sizes are looked up per page (pageOf)
        rows = (await ctx.runSearch(settings.search)).map((f) => ({ filename: f, width: null, height: null, mtime: filenameMs(f) }));
    } else {
        const seen = new Set();
        for (const id of ids) {
            const head = await db.listWorkspaceGalleryItemsPaginated(id, settings.viewType, 0, 0);
            const count = head && head.totalItems ? Number(head.totalItems) : 0;
            if (!count) continue;
            // past the block size this is one plain ordered query for the whole workspace
            const page = await db.listWorkspaceGalleryItemsPaginated(id, settings.viewType, 0, Math.max(count, 1000));
            for (const row of (page && page.items) || []) {
                const f = pickName(row);
                if (!f || seen.has(f)) continue;
                seen.add(f);
                rows.push({ filename: f, width: row.width || null, height: row.height || null, mtime: mtimeMs(row.mtime) || filenameMs(f) });
            }
        }
    }
    rows.sort((a, b) => b.mtime - a.mtime);
    if (cutoff) rows = rows.filter((r) => r.mtime >= cutoff);
    if (settings.poolSize > 0) rows = rows.slice(0, settings.poolSize);
    listCache.delete(key);
    listCache.set(key, { rows, expiresAt: now + LIST_TTL_MS });
    while (listCache.size > MAX_LISTS) listCache.delete(listCache.keys().next().value);
    return rows;
}

/** A seeded shuffle (mulberry32 + Fisher-Yates): the same seed walks the same order. */
function seededOrder(length, seed) {
    let a = (Number(seed) >>> 0) || 1;
    const rand = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const order = Array.from({ length }, (_, i) => i);
    for (let i = length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/**
 * One page of the pictures a device shows for these settings: { total, offset, items }, each item
 * { filename, width, height, mtime }. Newest first, or a seeded shuffle with `seed` (a device keeps
 * its seed and pages through; there is no pool limit unless poolSize is set). ctx: { metadataDb,
 * workspaceManager, sessionId, runSearch(search) }.
 */
async function resolveImages(ctx, rawSettings, page) {
    const settings = Object.assign({ viewType: 'images', poolSize: 0, maxAgeDays: 0, workspaces: [] }, rawSettings || {});
    const opts = page || {};
    const rows = await resolveAll(ctx, settings);
    const total = rows.length;
    const offset = Math.max(0, Math.min(total, Math.round(Number(opts.offset)) || 0));
    const limit = Math.max(1, Math.min(PAGE_MAX, Math.round(Number(opts.limit)) || PAGE_DEFAULT));
    let items;
    if (opts.seed != null && opts.seed !== '') {
        const order = seededOrder(total, opts.seed);
        items = order.slice(offset, offset + limit).map((i) => Object.assign({}, rows[i]));
    } else {
        items = rows.slice(offset, offset + limit).map((r) => Object.assign({}, r));
    }
    const unsized = items.filter((r) => !r.width).map((r) => r.filename);
    if (unsized.length && ctx.metadataDb) {
        const light = await ctx.metadataDb.getLightweightMetadata(unsized);
        items.forEach((r) => {
            const m = (light && light[r.filename]) || {};
            if (!r.width) r.width = m.width || null;
            if (!r.height) r.height = m.height || null;
            if (!r.mtime) r.mtime = mtimeMs(m.mtime);
        });
    }
    return { total, offset, items };
}

function clearImageCache() {
    listCache.clear();
}

// ---- device-specific settings (deviceConfig) and gadgets ----

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * What a device says it can be configured with: { version, schema, values }, or null. Descriptors are
 * kept as sent (unknown properties included) but need a key and a type; values only for known keys.
 */
function sanitizeDeviceConfig(raw) {
    if (!isPlainObject(raw) || !Array.isArray(raw.schema)) return null;
    const seen = new Set();
    const schema = [];
    for (const f of raw.schema) {
        if (!isPlainObject(f) || typeof f.key !== 'string' || !f.key || f.key.length > 100 || typeof f.type !== 'string' || seen.has(f.key)) continue;
        seen.add(f.key);
        schema.push(f);
        if (schema.length >= CONFIG_MAX_FIELDS) break;
    }
    const values = {};
    const src = isPlainObject(raw.values) ? raw.values : {};
    for (const key of Object.keys(src)) if (seen.has(key)) values[key] = src[key];
    const out = { version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1, schema, values };
    return JSON.stringify(out).length <= CONFIG_MAX_BYTES ? out : null;
}

/** The gadgets a device advertises and what is on its screen, or null. */
function sanitizeGadgets(raw) {
    if (!isPlainObject(raw)) return null;
    const str = (v, max) => (v == null ? null : clampString(v, max) || null);
    const available = (Array.isArray(raw.available) ? raw.available : []).filter(isPlainObject).slice(0, 16).map((g) => {
        const out = { id: clampString(g.id, 40), name: clampString(g.name || g.id, 64) };
        if (Array.isArray(g.faces)) {
            out.faces = g.faces.filter(isPlainObject).slice(0, 64).map((f) => ({
                id: clampString(f.id, 64), name: clampString(f.name || f.id, 64), kind: f.kind === 'digital' ? 'digital' : 'analog'
            })).filter((f) => f.id);
        }
        return out;
    }).filter((g) => g.id);
    return {
        mode: str(raw.mode, 40),
        face: str(raw.face, 64),
        selectedMode: str(raw.selectedMode, 40),
        selectedFace: str(raw.selectedFace, 64),
        scheduleEntry: raw.scheduleEntry == null ? null : clampInt(raw.scheduleEntry, 0, 1000),
        available
    };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Why a value does not fit its descriptor, or null when it does. time and days are item types (lists only). */
function fieldError(field, value, inItem) {
    const opts = Array.isArray(field.options) ? field.options : [];
    switch (field.type) {
        case 'bool':
            return typeof value === 'boolean' ? null : 'must be true or false';
        case 'int':
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
            if (field.type === 'int' && !Number.isInteger(value)) return 'must be a whole number';
            if (typeof field.min === 'number' && value < field.min) return `must be at least ${field.min}`;
            if (typeof field.max === 'number' && value > field.max) return `must be at most ${field.max}`;
            return null;
        case 'string':
            if (typeof value !== 'string') return 'must be text';
            if (typeof field.maxLength === 'number' && value.length > field.maxLength) return `at most ${field.maxLength} characters`;
            return null;
        case 'enum':
            return opts.some((o) => o && o.value === value) ? null : 'not one of the choices';
        case 'time':
            if (!inItem) break;
            return typeof value === 'string' && TIME_RE.test(value) ? null : 'must be a time (HH:mm)';
        case 'days':
            if (!inItem) break;
            if (!Array.isArray(value) || value.length > 7) return 'must be a list of weekdays';
            if (!value.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)) return 'weekdays are 0 (Sunday) to 6';
            if (new Set(value).size !== value.length) return 'a weekday is listed twice';
            return null;
        case 'list': {
            if (inItem) break;
            if (!Array.isArray(value)) return 'must be a list';
            if (typeof field.maxItems === 'number' && value.length > field.maxItems) return `at most ${field.maxItems} items`;
            const item = Array.isArray(field.item) ? field.item.filter(isPlainObject) : [];
            for (let i = 0; i < value.length; i++) {
                if (!isPlainObject(value[i])) return `item ${i + 1} must be an object`;
                for (const sub of item) {
                    if (!(sub.key in value[i])) continue;
                    const err = fieldError(sub, value[i][sub.key], true);
                    if (err) return `item ${i + 1}: ${sub.label || sub.key} ${err}`;
                }
            }
            return null;
        }
        default:
            break;
    }
    return 'cannot be changed from here';
}

/** A list value keeps only its items' known keys (the rest is dropped, not rejected). */
function cleanValue(field, value) {
    if (field.type !== 'list' || !Array.isArray(field.item)) return value;
    const keys = field.item.filter(isPlainObject).map((f) => f.key);
    return value.map((it) => Object.fromEntries(keys.filter((k) => k in it).map((k) => [k, it[k]])));
}

/**
 * A partial config checked against the device's stored schema: { config, rejected }, config holding
 * the valid keys and rejected each bad key with why.
 */
function validateDeviceConfig(deviceConfig, raw) {
    const schema = deviceConfig && Array.isArray(deviceConfig.schema) ? deviceConfig.schema : [];
    const byKey = new Map(schema.map((f) => [f.key, f]));
    const config = {};
    const rejected = {};
    for (const [key, value] of Object.entries(isPlainObject(raw) ? raw : {})) {
        const field = byKey.get(key);
        if (!field) { rejected[key] = 'unknown setting'; continue; }
        const err = fieldError(field, value, false);
        if (err) rejected[key] = err;
        else config[key] = cleanValue(field, value);
    }
    return { config, rejected };
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
    // device-specific settings and gadgets (device config protocol v1), added after the first release
    const cols = new Set(db.prepare('PRAGMA table_info(slideshow_devices)').all().map((c) => c.name));
    for (const col of ['device_config', 'gadgets', 'pending_device_config']) {
        if (!cols.has(col)) db.exec(`ALTER TABLE slideshow_devices ADD COLUMN ${col} TEXT`);
    }
    return db;
}

function jsonOrNull(v) {
    return v == null ? null : JSON.stringify(v);
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
        pendingName: row.pending_name || null,
        deviceConfig: parseJson(row.device_config, null),
        gadgets: parseJson(row.gadgets, null),
        pendingDeviceConfig: parseJson(row.pending_device_config, null)
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
        settings: sanitizeSettings(src.settings),
        deviceConfig: sanitizeDeviceConfig(src.deviceConfig),
        gadgets: sanitizeGadgets(src.gadgets)
    };
    const d = getDb(globalResources);
    const row = rowOf(globalResources, deviceId);
    const pending = row ? parseJson(row.pending_settings, null) : null;
    const pendingName = row && row.pending_name ? row.pending_name : null;
    const name = pendingName || reported.name || (row && row.name) || 'Slideshow device';
    const settings = Object.assign({}, row ? parseJson(row.settings, {}) : {}, reported.settings, pending || {});
    if (row) {
        d.prepare(`UPDATE slideshow_devices SET kind = ?, name = ?, app = ?, model = ?, os = ?, display = ?, settings = ?,
            device_config = ?, gadgets = ?, pending_settings = NULL, pending_name = NULL, last_seen = ? WHERE device_id = ?`)
            .run(kind, name, reported.app, reported.model, reported.os, JSON.stringify(reported.display), JSON.stringify(settings),
                jsonOrNull(reported.deviceConfig), jsonOrNull(reported.gadgets), now, deviceId);
    } else {
        d.prepare(`INSERT INTO slideshow_devices (device_id, kind, name, app, model, os, display, settings, device_config, gadgets, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(deviceId, kind, name, reported.app, reported.model, reported.os, JSON.stringify(reported.display), JSON.stringify(settings),
                jsonOrNull(reported.deviceConfig), jsonOrNull(reported.gadgets), now, now);
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
    // gadget devices also say whether the slideshow or the clock is up, and which time frame chose it
    if (GADGET_MODES.has(src.mode)) {
        rec.mode = src.mode;
        rec.face = src.mode === 'clock' && src.face != null ? clampString(src.face, 64) || null : null;
        rec.scheduleEntry = src.scheduleEntry == null ? null : clampInt(src.scheduleEntry, 0, 1000);
    }
    clientInfo.deviceState = rec;
    const d = getDb(globalResources);
    d.prepare('UPDATE slideshow_devices SET last_state = ?, last_seen = ? WHERE device_id = ?')
        .run(JSON.stringify(rec), Date.now(), deviceId);
    if (rec.mode) {
        // the stored gadgets follow the screen (a time frame starts or ends with no client_device_config)
        const row = rowOf(globalResources, deviceId);
        const gadgets = row ? parseJson(row.gadgets, null) : null;
        if (gadgets) {
            Object.assign(gadgets, { mode: rec.mode, scheduleEntry: rec.scheduleEntry });
            if (rec.face) gadgets.face = rec.face;
            d.prepare('UPDATE slideshow_devices SET gadgets = ? WHERE device_id = ?').run(JSON.stringify(gadgets), deviceId);
        }
    }
    scheduleDevicesUpdated(globalResources, wsServer);
    return true;
}

/** client_device_config: the device's values changed (a command, its own LAN page, a restart); the stored copy is replaced. */
function deviceConfigReport(globalResources, wsServer, clientInfo, data) {
    const src = data && typeof data === 'object' ? data : {};
    const deviceId = String(src.deviceId || (clientInfo && clientInfo.deviceId) || '').trim().toLowerCase();
    if (!clientInfo || !clientInfo.deviceId || deviceId !== clientInfo.deviceId) return false;
    const deviceConfig = sanitizeDeviceConfig(src.deviceConfig);
    const gadgets = sanitizeGadgets(src.gadgets);
    if (!deviceConfig && !gadgets) return false;
    const sets = [];
    const args = [];
    if (deviceConfig) { sets.push('device_config = ?'); args.push(JSON.stringify(deviceConfig)); }
    if (gadgets) { sets.push('gadgets = ?'); args.push(JSON.stringify(gadgets)); }
    getDb(globalResources).prepare(`UPDATE slideshow_devices SET ${sets.join(', ')}, last_seen = ? WHERE device_id = ?`).run(...args, Date.now(), deviceId);
    scheduleDevicesUpdated(globalResources, wsServer);
    return true;
}

/** An ack's answer: { ok, error? }, and for set_device_config / set_mode { applied, rejected, restarting }. */
function ackResult(data) {
    const out = { ok: data.ok !== false };
    if (data.error) out.error = clampString(data.error, 200);
    if (Array.isArray(data.applied)) out.applied = data.applied.map((k) => clampString(k, 100)).filter(Boolean).slice(0, CONFIG_MAX_FIELDS);
    if (isPlainObject(data.rejected)) {
        out.rejected = {};
        Object.keys(data.rejected).slice(0, CONFIG_MAX_FIELDS).forEach((k) => { out.rejected[clampString(k, 100)] = clampString(data.rejected[k], 200); });
    }
    if (typeof data.restarting === 'boolean') out.restarting = data.restarting;
    return out;
}

function commandAck(clientInfo, message) {
    const id = String((message && message.commandId) || '');
    const entry = pendingAcks.get(id);
    if (!entry || !clientInfo || entry.deviceId !== clientInfo.deviceId) return false;
    pendingAcks.delete(id);
    clearTimeout(entry.timer);
    const data = message.data && typeof message.data === 'object' ? message.data : {};
    entry.resolve(ackResult(data));
    return true;
}

/** Send a device_command; `ack` resolves with its answer, or null after ACK_TIMEOUT_MS. */
function relay(server, live, deviceId, data) {
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
    return { commandId, ack };
}

/**
 * Right after a client_identify reply: what Control Panel set while the device was offline goes out
 * as one set_device_config. It is cleared now; should the device not answer, it is queued again
 * (under anything newer). The commandId, or null when nothing was pending.
 */
function deliverPendingDeviceConfig(globalResources, wsServer, clientInfo) {
    if (!clientInfo || !clientInfo.deviceId) return null;
    const deviceId = clientInfo.deviceId;
    const row = rowOf(globalResources, deviceId);
    const pending = row ? parseJson(row.pending_device_config, null) : null;
    if (!pending || !Object.keys(pending).length) return null;
    const server = wsServerOf(globalResources, wsServer);
    const live = findDeviceSocket(server, deviceId);
    if (!live) return null;
    const d = getDb(globalResources);
    d.prepare('UPDATE slideshow_devices SET pending_device_config = NULL WHERE device_id = ?').run(deviceId);
    const { commandId, ack } = relay(server, live, deviceId, { command: 'set_device_config', config: pending });
    ack.then((res) => {
        if (res) {
            if (res.rejected && Object.keys(res.rejected).length) console.warn(`[slideshowDevices] ${deviceId} rejected queued settings:`, res.rejected);
            return;
        }
        try {
            const now = rowOf(globalResources, deviceId);
            if (!now) return;
            const merged = Object.assign({}, pending, parseJson(now.pending_device_config, {}) || {});
            d.prepare('UPDATE slideshow_devices SET pending_device_config = ? WHERE device_id = ?').run(JSON.stringify(merged), deviceId);
            scheduleDevicesUpdated(globalResources, server);
        } catch (err) {
            console.warn('[slideshowDevices] re-queueing device settings failed:', err.message);
        }
    });
    scheduleDevicesUpdated(globalResources, server);
    return commandId;
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
    } else if (command === 'set_device_config') {
        const deviceConfig = parseJson(row.device_config, null);
        if (!deviceConfig) throw badRequest('This device has no settings of its own', 'NO_DEVICE_CONFIG');
        const { config, rejected } = validateDeviceConfig(deviceConfig, src.config);
        if (Object.keys(rejected).length) {
            const err = badRequest(`Not valid: ${Object.entries(rejected).map(([k, r]) => `${k} (${r})`).join(', ')}`, 'BAD_DEVICE_CONFIG');
            err.rejected = rejected;
            throw err;
        }
        if (!Object.keys(config).length) throw badRequest('No settings to change', 'BAD_DEVICE_CONFIG');
        data.config = config;
    } else if (command === 'set_mode') {
        const gadgets = parseJson(row.gadgets, null);
        const available = gadgets && Array.isArray(gadgets.available) ? gadgets.available : [];
        const mode = String(src.mode || '').trim();
        if (!GADGET_MODES.has(mode) || !available.some((g) => g.id === mode)) throw badRequest('This device does not have that gadget', 'BAD_MODE');
        data.mode = mode;
        if (src.face != null && src.face !== '') {
            const clock = available.find((g) => g.id === 'clock');
            const face = String(src.face);
            if (!clock || !(clock.faces || []).some((f) => f.id === face)) throw badRequest('This device does not have that clock face', 'BAD_FACE');
            data.face = face;
        }
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
        } else if (command === 'set_device_config' || command === 'set_mode') {
            // set_mode is set_device_config's { mode, clockFace } (DEVICE_CONFIG_PROTOCOL.md)
            const change = command === 'set_mode' ? Object.assign({ mode: data.mode }, data.face ? { clockFace: data.face } : {}) : data.config;
            const pending = Object.assign(parseJson(row.pending_device_config, {}) || {}, change);
            d.prepare('UPDATE slideshow_devices SET pending_device_config = ? WHERE device_id = ?').run(JSON.stringify(pending), deviceId);
        } else {
            d.prepare('UPDATE slideshow_devices SET pending_name = ? WHERE device_id = ?').run(data.name, deviceId);
        }
        scheduleDevicesUpdated(globalResources, server);
        return { success: true, deviceId, command, queued: true };
    }

    if (command === 'rename') live.info.deviceName = data.name;
    const { commandId, ack } = relay(server, live, deviceId, data);
    scheduleDevicesUpdated(globalResources, server);
    const result = await ack;
    if (!result) return { success: false, deviceId, command, commandId, error: 'The device did not answer', code: 'ACK_TIMEOUT' };
    const { ok, ...rest } = result;
    return { success: ok, deviceId, command, commandId, ...rest };
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
    sanitizeDeviceConfig,
    sanitizeGadgets,
    validateDeviceConfig,
    resolveImages,
    clearImageCache,
    deviceSettings,
    identify,
    deviceState,
    deviceConfigReport,
    deliverPendingDeviceConfig,
    commandAck,
    onSocketClosed,
    sendCommand,
    forget,
    listDevices,
    clientDeviceFields,
    resetForTests
};
