'use strict';

/**
 * Pushed forecasts for the places a page shows (#890 round 5, W1 stage 2; rules server-push-not-polling,
 * phone-power-server). While a weather view is on screen (Today's weather item, the Weather app, the 6.5
 * clock / Super Bar) the page sends
 *
 *   weather_watch   { places: [{ key, lat, lon, have? }] }   the whole set it shows (replaces the last one)
 *   weather_unwatch {}                                        none shown any more
 *
 * and makes no forecast fetch of its own for those places. The server then pushes
 *
 *   weather_delta   { key, ...weather_forecast's reply shape relative to what that page holds }
 *
 * once at watch time when the page's have is behind (no have: the whole model), and afterwards only when a
 * part changes (weatherService.forecastWire hashes; fetchedAt alone is a clock and sends nothing). The
 * forecasts come through getForecast's cache: Home and Work share the alert monitor's 5-minute reads (same
 * cache key), any other watched place is read again when its cache entry expires (appleTtl: Apple's own
 * expiry, 2 to 15 minutes) and only while someone watches it. One timer for all watched places, running
 * only while there is a watcher. On 'connected' the page sends weather_watch again with its have.
 *
 * A sleeping page (client_dormant) that still watches: its delta is computed against what it had before it
 * slept and held newest-only per place (websocket.js DORMANT_HOLD weather_delta), so the copy it gets on
 * waking is complete; its have moves on once it is awake again.
 */

const weatherService = require('./weatherService');

const TICK_MS = 60 * 1000;
const MAX_PLACES = 12;

const watchers = new Map(); // ws -> Map(key -> { key, lat, lon, have, pending })
const closeHooked = new WeakSet();
let timer = null;
let running = false;
let server = null; // { sendToClient(ws, msg), isDormantSocket?(ws) }

function bind(srv) {
    if (srv && typeof srv.sendToClient === 'function') server = srv;
}

function cleanHave(have) {
    if (!have || typeof have !== 'object' || Array.isArray(have)) return null;
    const out = {};
    ['current', 'minutely', 'daily', 'alerts'].forEach((k) => { if (typeof have[k] === 'string') out[k] = have[k].slice(0, 64); });
    out.hourly = {};
    if (have.hourly && typeof have.hourly === 'object' && !Array.isArray(have.hourly)) {
        Object.keys(have.hourly).slice(0, 32).forEach((day) => {
            if (typeof have.hourly[day] === 'string') out.hourly[String(day).slice(0, 10)] = have.hourly[day].slice(0, 64);
        });
    }
    return out;
}

/** Replace a socket's watched places. Returns the keys kept. */
function watch(ws, places) {
    if (!ws) return [];
    const list = Array.isArray(places) ? places.slice(0, MAX_PLACES) : [];
    const next = new Map();
    for (const p of list) {
        if (!p || typeof p !== 'object') continue;
        const key = String(p.key || '').slice(0, 120);
        const lat = Number(p.lat);
        const lon = Number(p.lon);
        if (!key || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        next.set(key, { key, lat, lon, have: cleanHave(p.have), pending: null });
    }
    if (!next.size) { unwatch(ws); return []; }
    watchers.set(ws, next);
    if (typeof ws.once === 'function' && !closeHooked.has(ws)) { closeHooked.add(ws); ws.once('close', () => unwatch(ws)); }
    ensureTimer();
    // catch the page up now (its have may be behind, or it has nothing yet)
    void refreshSocket(ws);
    return [...next.keys()];
}

function unwatch(ws) {
    watchers.delete(ws);
    if (!watchers.size && timer) { clearInterval(timer); timer = null; }
}

function ensureTimer() {
    if (timer || !watchers.size) return;
    // one server timer for every watched place, stopped when the last watcher leaves (rule server-push-not-polling)
    timer = setInterval(() => { void tick(); }, TICK_MS);
    if (timer.unref) timer.unref();
}

/** Push to one watcher of one place what it is missing of this forecast. */
function pushEntry(ws, entry, forecast) {
    if (!server || !ws || ws.readyState !== 1) return false;
    const wire = weatherService.forecastWire(forecast);
    if (!wire) return false;
    const asleep = typeof server.isDormantSocket === 'function' && server.isDormantSocket(ws);
    // awake again: the delta held while it slept was handed over on waking (websocket.js setDormant)
    if (!asleep && entry.pending) { entry.have = entry.pending; entry.pending = null; }
    const base = entry.have;
    const holds = asleep ? (entry.pending || base) : base;
    if (!weatherService.wireDiffers(wire, holds)) return false;
    const body = weatherService.forecastReply(wire, base);
    try {
        server.sendToClient(ws, { type: 'weather_delta', data: Object.assign({ key: entry.key, available: true }, body), timestamp: new Date().toISOString() });
    } catch (_e) {
        unwatch(ws);
        return false;
    }
    if (asleep) entry.pending = wire.hashes;
    else entry.have = wire.hashes;
    return true;
}

async function forecastFor(entry) {
    try { return await weatherService.getForecast(entry.lat, entry.lon); } catch (_e) { return null; }
}

async function refreshSocket(ws) {
    const places = watchers.get(ws);
    if (!places) return 0;
    let sent = 0;
    for (const entry of places.values()) {
        const f = await forecastFor(entry);
        if (f && watchers.get(ws) === places && pushEntry(ws, entry, f)) sent += 1;
    }
    return sent;
}

/** Every watched place once (getForecast reads upstream only when its cache entry expired). */
async function tick() {
    if (running || !watchers.size) return 0;
    running = true;
    let sent = 0;
    try {
        // one read per distinct place, however many pages watch it
        const reads = new Map();
        for (const places of watchers.values()) {
            for (const entry of places.values()) {
                const k = `${Math.round(entry.lat * 100) / 100}:${Math.round(entry.lon * 100) / 100}`;
                if (!reads.has(k)) reads.set(k, forecastFor(entry));
            }
        }
        for (const [ws, places] of [...watchers]) {
            for (const entry of places.values()) {
                const k = `${Math.round(entry.lat * 100) / 100}:${Math.round(entry.lon * 100) / 100}`;
                const f = await reads.get(k);
                if (f && watchers.get(ws) === places && pushEntry(ws, entry, f)) sent += 1;
            }
        }
    } finally {
        running = false;
    }
    return sent;
}

module.exports = {
    bind,
    watch,
    unwatch,
    tick,
    _test: { watchers, refreshSocket, reset: () => { watchers.clear(); if (timer) { clearInterval(timer); timer = null; } running = false; server = null; } }
};
