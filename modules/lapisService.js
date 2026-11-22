'use strict';

/**
 * Lapis Remote (Yozora #835): the car service behind Melaton Mobile's Lapis Remote and its Today item.
 * The server does all of it: it reads the car on its own clock, keeps the long-term record, works out
 * the climate choice, the refuel day and what is due, raises the notices, and sends the commands.
 * Clients only show what it pushes (no client polling) and ask for commands.
 *
 * BlueLink:  modules/bluelinkClient.js is the only code that talks to Hyundai. Account: Service key
 *            `bluelink` (e-mail in `username`, password as the key value, PIN in `pin`).
 * Reads:     every `pollMin` minutes (30) the car's last report is read (this does not wake the car). The
 *            car is woken for a fresh report only when asked (Refresh), after a command, and once
 *            `lockRemindMin` after it parks unlocked, to see whether it was locked by hand since.
 *            Its position is asked for when the odometer moved (Hyundai limits Find My Car).
 * Record:    lapis.db (better-sqlite3) `samples`: one row per changed report, kept for good; `events`:
 *            commands, notices, fill-ups. Graphs, trips and the usage model read it.
 * Climate:   modules/lapisClimate.js (a line between a few saved anchors) on the weather at the car (Open-Meteo through weatherService:
 *            outdoor °F, cloud cover and shortwave radiation of the current hour).
 * Usage:     modules/lapisUsage.js. Home, Work, work days and leave times are Lapis's own settings,
 *            falling back to Melaton Traffic's commute when unset.
 *
 * Settings: config `lapis` (admins save), see DEFAULTS and getSettings().
 *
 * Broadcasts to admin clients:
 *   lapis_updated   { state }                       after every read, command step or settings change
 *   lapis_notice    { id, kind, title, text, actions[], key?, stamp?, minutes?, until? }   kind: unlocked | low-fuel | refuel | service | command | health | run-left
 *
 * A remote start on its timer is watched: 'run-left' at 5, 3, 2 and 1 minutes left, and a cached read every
 * 3 minutes (no wake-up) ends it when the odometer or position moves (driving) or the engine is off.
 *
 * Health alerts (the 12 V battery under the car's warning level, a low tire, low washer or brake fluid, a
 * weak smart key battery) are raised the moment a report shows them, again when they get worse, and
 * stay in state.alerts until a report clears them: a phone that was not connected shows them when it is.
 *
 * Commands are never retried and never sent by tests against the real car (scripts/test-lapis-service.js
 * swaps the request function).
 */

const fs = require('fs');
const path = require('path');
const bluelink = require('./bluelinkClient');
const climate = require('./lapisClimate');
const usage = require('./lapisUsage');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const LATEST_FILE = process.env.LAPIS_LATEST_FILE || path.join(CACHE_DIR, 'lapis-latest.json');
const PICTURE_DIR = process.env.LAPIS_PICTURE_DIR || path.join(CACHE_DIR, 'lapis');
const LOCATION_GAP = 10 * MIN; // Find My Car is asked at most this often
const COMMAND_POLL_MS = 5000;
const COMMAND_WAIT_MS = 120 * 1000;
const PICTURE_MAX = 900 * 1024;

const DEFAULTS = {
    vehicleId: '',
    name: '',
    pollMin: 30,
    lockRemindMin: 10,
    lowFuelPct: 20,
    reservePct: 15,
    tankGal: 13.2, // 2024 Sonata Hybrid
    mpg: 47, // rated combined; replaced by the measured figure once the record has enough driving
    runMinutes: 10,
    autoClimate: true,
    // health: the vehicle-health alerts as a whole (the first version's one switch); each also has its own (Nov 21 2026)
    notify: { unlocked: true, lowFuel: true, refuel: true, service: true, health: true, battery12: true, tire: true, brake: true, washer: true, key: true },
    tireLowPsi: 26, // a tire under this is low even before the car's own lamp; also one 4 psi under the other three
    batteryLowPct: 0, // 0: the level the car itself warns at (50 % when it does not say)
    errandMiles: 4,
    offDayMiles: 12,
    radiusKm: 0.3,
    // defaults to check against the owner's manual; each is edited in Lapis Remote > Maintenance
    maintenance: [
        { id: 'oil', label: 'Engine oil and filter', everyMiles: 8000, everyMonths: 12 },
        { id: 'tires', label: 'Tire rotation', everyMiles: 8000, everyMonths: 0 },
        { id: 'cabin', label: 'Cabin air filter', everyMiles: 16000, everyMonths: 0 },
        { id: 'engine-air', label: 'Engine air filter', everyMiles: 32000, everyMonths: 0 },
        { id: 'brake-fluid', label: 'Brake fluid', everyMiles: 48000, everyMonths: 48 },
    ],
};

class LapisError extends Error {
    constructor(message, code, status) {
        super(message);
        this.code = code || 'LAPIS_ERROR';
        if (status) this.status = status;
    }
}

let gr = null;
let client = null;
let db = null;
let nowFn = () => Date.now();

// what the service knows right now (also saved to LATEST_FILE so a restart starts warm)
const live = {
    vehicle: null,
    status: null,
    statusSeenAt: 0,
    location: null,
    locationAskedAt: 0,
    locationOdo: null,
    weather: null,
    lastError: null,
    command: null,
    parkedSince: 0, // when the car was first seen parked with the engine off
    flags: { unlockedFor: 0, lowFuel: false, refuelDay: '', refuelSaid: null, service: {}, health: {} },
};
const sched = { timer: null, nextPollAt: 0, lockCheckAt: 0, runEndCheckAt: 0, backoff: 0, busy: false, weatherAt: 0 };

function bind(globalResources) {
    if (globalResources && !gr) {
        gr = globalResources;
        loadLatest();
    }
    return module.exports;
}

function config(p, fallback) {
    try {
        const v = gr ? gr.getConfig({ path: p }) : undefined;
        return v === undefined || v === null ? fallback : v;
    } catch (_e) {
        return fallback;
    }
}

// ------------------------------------------------------------------------------------------ settings

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const num = (v, lo, hi, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};
const int = (v, lo, hi, def) => Math.round(num(v, lo, hi, def));
const cleanTime = (v) => {
    const m = HHMM.exec(String(v || '').trim());
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

function cleanPlace(p) {
    if (!p || typeof p !== 'object') return null;
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
    const out = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
    const label = String(p.label || p.address || '').trim().slice(0, 80);
    if (label) out.label = label;
    return out;
}

function cleanMaintenance(list) {
    const src = Array.isArray(list) && list.length ? list : DEFAULTS.maintenance;
    return src
        .map((m, i) => {
            if (!m || typeof m !== 'object') return null;
            const label = String(m.label || '').trim().slice(0, 60);
            if (!label) return null;
            const out = {
                id: String(m.id || `item-${i}`).replace(/[^a-z0-9-]/gi, '').slice(0, 24) || `item-${i}`,
                label,
                everyMiles: int(m.everyMiles, 0, 200000, 0),
                everyMonths: int(m.everyMonths, 0, 240, 0),
            };
            if (Number.isFinite(Number(m.lastOdo)) && Number(m.lastOdo) >= 0) out.lastOdo = Math.round(Number(m.lastOdo));
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(m.lastDate || ''))) out.lastDate = m.lastDate;
            return out;
        })
        .filter(Boolean)
        .slice(0, 20);
}

function trafficSettings() {
    try {
        return require('./trafficService').bind(gr).getSettings();
    } catch (_e) {
        return null;
    }
}

function trafficPlace(id) {
    // Traffic keeps an address; its coordinates are in its settings when set, else in its last report
    try {
        const t = trafficSettings();
        const direct = cleanPlace(t && t[id]);
        if (direct) return { ...direct, label: (t[id] && (t[id].label || t[id].address)) || direct.label, from: 'traffic' };
        const latest = require('./trafficService').getLatest() || {};
        const rep = latest.work || latest.home;
        if (!rep) return null;
        const end = (id === 'home') === (rep.direction === 'work') ? rep.from : rep.to;
        const p = cleanPlace(end);
        return p ? { ...p, label: (t && t[id] && (t[id].label || t[id].address)) || p.label, from: 'traffic' } : null;
    } catch (_e) {
        return null;
    }
}

function validZone(z) {
    if (!z || typeof z !== 'string') return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: z });
        return true;
    } catch (_e) {
        return false;
    }
}

// every notification that can be switched off by itself (Settings > Notifications): the five health alerts each have their own
// (Yukimi, Nov 21 2026: "if i dont want notification about a tire i know is low i wont"); 'health' turns them all off
const NOTIFY_KEYS = ['unlocked', 'lowFuel', 'refuel', 'service', 'health', 'battery12', 'tire', 'brake', 'washer', 'key'];
const healthItemOn = (s, key) => s.notify.health !== false && s.notify[key] !== false;

/** The saved settings with defaults and the Traffic fallbacks filled in. */
function getSettings() {
    const c = config('lapis', {}) || {};
    const t = trafficSettings() || {};
    const own = { home: cleanPlace(c.home), work: cleanPlace(c.work) };
    const days = Array.isArray(c.workDays) ? c.workDays.map(Number).filter((d) => d >= 0 && d <= 6) : null;
    const notify = Object.assign({}, DEFAULTS.notify, c.notify || {});
    return {
        vehicleId: String(c.vehicleId || ''),
        name: String(c.name || '').trim().slice(0, 40),
        home: own.home || trafficPlace('home'),
        work: own.work || trafficPlace('work'),
        homeOwn: !!own.home,
        workOwn: !!own.work,
        workDays: days || (Array.isArray(t.days) ? t.days.slice() : [1, 2, 3, 4, 5]),
        leaveHome: cleanTime(c.leaveHome) || t.leaveHome || '',
        leaveWork: cleanTime(c.leaveWork) || t.leaveWork || '',
        scheduleOwn: !!(days || cleanTime(c.leaveHome) || cleanTime(c.leaveWork)),
        commuteMiles: Number.isFinite(Number(c.commuteMiles)) && Number(c.commuteMiles) > 0 ? Math.round(Number(c.commuteMiles) * 10) / 10 : null,
        timeZone: validZone(c.timeZone) ? c.timeZone : validZone(t.timeZone) ? t.timeZone : '',
        pollMin: int(c.pollMin, 5, 240, DEFAULTS.pollMin),
        lockRemindMin: int(c.lockRemindMin, 2, 120, DEFAULTS.lockRemindMin),
        lowFuelPct: int(c.lowFuelPct, 5, 50, DEFAULTS.lowFuelPct),
        reservePct: int(c.reservePct, 0, 50, DEFAULTS.reservePct),
        tankGal: num(c.tankGal, 2, 60, DEFAULTS.tankGal),
        mpg: num(c.mpg, 5, 150, DEFAULTS.mpg),
        runMinutes: int(c.runMinutes, 1, 30, DEFAULTS.runMinutes),
        autoClimate: c.autoClimate !== false,
        climate: climate.cleanSettings(c.climate),
        errandMiles: num(c.errandMiles, 0, 200, DEFAULTS.errandMiles),
        offDayMiles: num(c.offDayMiles, 0, 500, DEFAULTS.offDayMiles),
        radiusKm: num(c.radiusKm, 0.05, 5, DEFAULTS.radiusKm),
        notify: Object.fromEntries(NOTIFY_KEYS.map((k) => [k, notify[k] !== false])),
        tireLowPsi: int(c.tireLowPsi, 15, 45, DEFAULTS.tireLowPsi),
        batteryLowPct: int(c.batteryLowPct, 0, 90, DEFAULTS.batteryLowPct),
        maintenance: cleanMaintenance(c.maintenance),
        picture: c.picture && typeof c.picture === 'object' && c.picture.rev ? { rev: String(c.picture.rev), type: String(c.picture.type || 'image/webp') } : null,
    };
}

/** Merge a change into config `lapis` (admins; the handler checks). */
async function saveSettings(next = {}) {
    if (!gr) throw new LapisError('Lapis Remote is not ready', 'NOT_READY');
    const out = Object.assign({}, config('lapis', {}) || {});
    ['home', 'work'].forEach((id) => {
        if (!(id in next)) return;
        if (next[id] === null) {
            delete out[id];
            return;
        }
        const p = cleanPlace(next[id]);
        if (!p) throw new LapisError(`${id === 'home' ? 'Home' : 'Work'} needs a position`, 'BAD_PLACE');
        out[id] = p;
    });
    if ('workDays' in next) {
        if (next.workDays === null) delete out.workDays;
        else out.workDays = [...new Set((Array.isArray(next.workDays) ? next.workDays : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    }
    ['leaveHome', 'leaveWork'].forEach((k) => {
        if (!(k in next)) return;
        const t = cleanTime(next[k]);
        if (next[k] && !t) throw new LapisError('Times are HH:MM (24 hour)', 'BAD_TIME');
        out[k] = t;
    });
    if ('vehicleId' in next) out.vehicleId = String(next.vehicleId || '').slice(0, 80);
    if ('name' in next) out.name = String(next.name || '').trim().slice(0, 40);
    if ('commuteMiles' in next) out.commuteMiles = Number(next.commuteMiles) > 0 ? Math.round(Number(next.commuteMiles) * 10) / 10 : null;
    if ('timeZone' in next) out.timeZone = validZone(next.timeZone) ? next.timeZone : '';
    if ('pollMin' in next) out.pollMin = int(next.pollMin, 5, 240, DEFAULTS.pollMin);
    if ('lockRemindMin' in next) out.lockRemindMin = int(next.lockRemindMin, 2, 120, DEFAULTS.lockRemindMin);
    if ('lowFuelPct' in next) out.lowFuelPct = int(next.lowFuelPct, 5, 50, DEFAULTS.lowFuelPct);
    if ('reservePct' in next) out.reservePct = int(next.reservePct, 0, 50, DEFAULTS.reservePct);
    if ('tankGal' in next) out.tankGal = num(next.tankGal, 2, 60, DEFAULTS.tankGal);
    if ('mpg' in next) out.mpg = num(next.mpg, 5, 150, DEFAULTS.mpg);
    if ('runMinutes' in next) out.runMinutes = int(next.runMinutes, 1, 30, DEFAULTS.runMinutes);
    if ('autoClimate' in next) out.autoClimate = next.autoClimate !== false;
    if ('climate' in next) {
        // null: back to the defaults
        if (next.climate === null) delete out.climate;
        else out.climate = climate.cleanSettings(Object.assign({}, out.climate || {}, next.climate));
    }
    delete out.climateTable; // the step table of the first version
    if ('errandMiles' in next) out.errandMiles = num(next.errandMiles, 0, 200, DEFAULTS.errandMiles);
    if ('offDayMiles' in next) out.offDayMiles = num(next.offDayMiles, 0, 500, DEFAULTS.offDayMiles);
    if ('tireLowPsi' in next) out.tireLowPsi = int(next.tireLowPsi, 15, 45, DEFAULTS.tireLowPsi);
    if ('batteryLowPct' in next) out.batteryLowPct = int(next.batteryLowPct, 0, 90, DEFAULTS.batteryLowPct);
    if ('radiusKm' in next) out.radiusKm = num(next.radiusKm, 0.05, 5, DEFAULTS.radiusKm);
    if (next.notify && typeof next.notify === 'object') {
        out.notify = Object.assign({}, out.notify || {});
        NOTIFY_KEYS.forEach((k) => {
            if (k in next.notify) out.notify[k] = next.notify[k] !== false;
        });
    }
    if ('maintenance' in next) out.maintenance = next.maintenance === null ? undefined : cleanMaintenance(next.maintenance);
    const saved = gr.modifyConfig('config').assign(['lapis'], out);
    if (saved && typeof saved.then === 'function') await saved;
    if ('vehicleId' in next) live.vehicle = null;
    // the weather stays until the new reading is in (a place may have changed): clearing it here left
    // the phones on "The weather at the car is not known yet" until the next half-hourly refresh
    pushState();
    refreshWeather(true).then(() => pushState()).catch(() => {});
    return getSettings();
}

/** Mark a maintenance item done at the current odometer, today. */
async function serviceDone(id) {
    const s = getSettings();
    const odo = live.status && live.status.odometer;
    const list = s.maintenance.map((m) => (m.id === id ? { ...m, lastOdo: Number.isFinite(odo) ? Math.round(odo) : m.lastOdo, lastDate: usage.dayKey(nowFn(), s.timeZone) } : m));
    if (!list.some((m) => m.id === id)) throw new LapisError('That maintenance item is not in the list', 'NOT_FOUND');
    delete live.flags.service[id];
    logEvent('service', { id, odo });
    return saveSettings({ maintenance: list });
}

// ------------------------------------------------------------------------------------------ the record

function database() {
    if (db) return db;
    const Database = require('better-sqlite3');
    let file = process.env.LAPIS_DB;
    if (!file) {
        let dir = null;
        try {
            dir = gr && gr.getPath ? gr.getPath('databases') : null;
        } catch (_e) {
            dir = null;
        }
        file = path.join(dir || CACHE_DIR, 'lapis.db');
    }
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 4000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS samples (
            t INTEGER NOT NULL,           -- when the car made the report (ms)
            seen INTEGER NOT NULL,        -- when the server read it (ms)
            vehicle TEXT NOT NULL,
            odo REAL, fuel REAL, range REAL, battery12 REAL,
            locked INTEGER, engine INTEGER, climate INTEGER,
            lat REAL, lon REAL,
            outdoor REAL,                 -- outdoor °F at the car when read
            source TEXT NOT NULL DEFAULT 'bluelink',   -- bluelink | import
            PRIMARY KEY (vehicle, t)
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            t INTEGER NOT NULL,
            vehicle TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS events_t ON events (t);
    `);
    return db;
}

const bit = (v) => (v === null || v === undefined ? null : v ? 1 : 0);

function recordSample(status, location, source) {
    const v = live.vehicle;
    if (!v || !status) return false;
    const t = status.at || nowFn();
    const row = {
        t,
        seen: nowFn(),
        vehicle: v.id,
        odo: status.odometer,
        fuel: status.fuel,
        range: status.range,
        battery12: status.battery12,
        locked: bit(status.locked),
        engine: bit(status.engine),
        climate: bit(status.climate),
        lat: location ? location.lat : null,
        lon: location ? location.lon : null,
        outdoor: live.weather ? live.weather.outdoorF : null,
        source: source || 'bluelink',
    };
    try {
        database()
            .prepare(
                `INSERT INTO samples (t, seen, vehicle, odo, fuel, range, battery12, locked, engine, climate, lat, lon, outdoor, source)
                 VALUES (@t, @seen, @vehicle, @odo, @fuel, @range, @battery12, @locked, @engine, @climate, @lat, @lon, @outdoor, @source)
                 ON CONFLICT (vehicle, t) DO UPDATE SET seen = excluded.seen, locked = excluded.locked, engine = excluded.engine, climate = excluded.climate,
                     lat = COALESCE(excluded.lat, lat), lon = COALESCE(excluded.lon, lon), odo = COALESCE(excluded.odo, odo), fuel = COALESCE(excluded.fuel, fuel)`
            )
            .run(row);
        return true;
    } catch (e) {
        console.warn(`[lapis] sample not saved: ${e.message}`);
        return false;
    }
}

/** Add samples from another record (Home Assistant history): [{ t, odo?, fuel?, range?, locked?, lat?, lon? }]. Existing rows win. */
function importSamples(rows, vehicleId) {
    const vid = vehicleId || (live.vehicle && live.vehicle.id) || getSettings().vehicleId;
    if (!vid) throw new LapisError('No vehicle is chosen yet', 'NO_VEHICLE');
    const stmt = database().prepare(
        `INSERT OR IGNORE INTO samples (t, seen, vehicle, odo, fuel, range, battery12, locked, engine, climate, lat, lon, outdoor, source)
         VALUES (@t, @seen, @vehicle, @odo, @fuel, @range, @battery12, @locked, @engine, NULL, @lat, @lon, @outdoor, 'import')`
    );
    const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
    let added = 0;
    database().transaction(() => {
        (rows || []).forEach((r) => {
            const t = Number(r && r.t);
            if (!Number.isFinite(t) || t <= 0) return;
            added += stmt.run({ t, seen: nowFn(), vehicle: vid, odo: n(r.odo), fuel: n(r.fuel), range: n(r.range), battery12: n(r.battery12), locked: bit(r.locked), engine: bit(r.engine), lat: n(r.lat), lon: n(r.lon), outdoor: n(r.outdoor) }).changes;
        });
    })();
    return { added };
}

function logEvent(kind, data) {
    try {
        database().prepare('INSERT INTO events (t, vehicle, kind, data) VALUES (?, ?, ?, ?)').run(nowFn(), (live.vehicle && live.vehicle.id) || '', kind, JSON.stringify(data || {}));
    } catch (e) {
        console.warn(`[lapis] event not saved: ${e.message}`);
    }
}

function samplesSince(since) {
    const v = live.vehicle;
    if (!v) return [];
    try {
        return database().prepare('SELECT t, odo, fuel, range, battery12, locked, engine, lat, lon, outdoor FROM samples WHERE vehicle = ? AND t >= ? ORDER BY t').all(v.id, since || 0);
    } catch (e) {
        console.warn(`[lapis] record not read: ${e.message}`);
        return [];
    }
}

// ------------------------------------------------------------------------------------------ account and vehicle

function account() {
    try {
        const manager = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        if (!manager) return null;
        const k = manager.getServiceKeys('bluelink')[manager.getSelectedIndex('bluelink')];
        return k && k.apiKey && k.username ? { username: k.username, password: k.apiKey, pin: k.pin || '' } : null;
    } catch (_e) {
        return null;
    }
}

function api() {
    if (!client) client = bluelink.createClient(() => account());
    return client;
}

async function vehicle() {
    if (live.vehicle) return live.vehicle;
    const list = (await api().vehicles()).filter((v) => v.active);
    if (!list.length) throw new LapisError('The BlueLink account has no active vehicle', 'NO_VEHICLE');
    const want = getSettings().vehicleId;
    live.vehicle = list.find((v) => v.id === want) || list[0];
    return live.vehicle;
}

async function listVehicles() {
    return api().vehicles({ fresh: true });
}

// ------------------------------------------------------------------------------------------ weather and climate

async function weatherAt(place) {
    if (!place) return null;
    const lat = Math.round(place.lat * 100) / 100;
    const lon = Math.round(place.lon * 100) / 100;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=uv_index,cloudcover,shortwave_radiation&timezone=auto&temperature_unit=fahrenheit&forecast_days=1`;
    const ws = require('./weatherService').bind(gr);
    const om = await ws.openMeteoRaw(url, { ttl: 20 * MIN });
    const cw = om && om.current_weather;
    const hourly = om && om.hourly;
    if (!cw || !hourly || !Array.isArray(hourly.time)) return null;
    const hour = `${String(cw.time || '').slice(0, 13)}:00`;
    let idx = hourly.time.indexOf(hour);
    if (idx < 0) idx = Math.min(hourly.time.length - 1, Math.max(0, new Date(nowFn()).getHours()));
    return {
        at: nowFn(),
        lat,
        lon,
        outdoorF: Number(cw.temperature),
        shortwave: Number((hourly.shortwave_radiation || [])[idx]) || 0,
        cloudCover: Number((hourly.cloudcover || [])[idx]) || 0,
        uv: Number((hourly.uv_index || [])[idx]) || 0,
        code: cw.weathercode,
        isDay: cw.is_day !== 0,
    };
}

async function refreshWeather(force) {
    if (!force && live.weather && nowFn() - live.weather.at < 20 * MIN) return live.weather;
    const s = getSettings();
    const place = live.location || s.home;
    if (!place) return live.weather;
    try {
        const w = await weatherAt(place);
        if (w) live.weather = { ...w, where: live.location ? 'car' : 'home' };
    } catch (e) {
        console.warn(`[lapis] weather at the car: ${e.message}`);
    }
    return live.weather;
}

function climatePick(settings) {
    if (!live.weather) return null;
    const pick = climate.fromWeather(live.weather, settings.climate);
    return pick ? { ...pick, cloudCover: live.weather.cloudCover, shortwave: live.weather.shortwave, where: live.weather.where, at: live.weather.at } : null;
}

// ------------------------------------------------------------------------------------------ reading the car

function placeName(loc, s) {
    if (!loc) return null;
    const near = (p) => p && usage.milesBetween(loc, p) * 1.609344 <= s.radiusKm;
    if (near(s.home)) return 'Home';
    if (near(s.work)) return 'Work';
    return null;
}

async function askLocation(force) {
    const v = await vehicle();
    const odo = live.status && live.status.odometer;
    const moved = live.locationOdo === null || !Number.isFinite(odo) || odo !== live.locationOdo;
    if (!force && (!moved || nowFn() - live.locationAskedAt < LOCATION_GAP) && live.location) return live.location;
    if (!force && nowFn() - live.locationAskedAt < LOCATION_GAP) return live.location;
    live.locationAskedAt = nowFn();
    try {
        const loc = await api().location(v);
        if (loc) {
            live.location = { ...loc, readAt: nowFn() };
            live.locationOdo = Number.isFinite(odo) ? odo : live.locationOdo;
        }
    } catch (e) {
        if (e.code !== 'RATE_LIMIT') console.warn(`[lapis] position: ${e.message}`);
        if (force) throw e;
    }
    return live.location;
}

/**
 * Read the car. fresh: wake it for a new report (Refresh, after a command, the unlocked follow-up).
 * Returns the state the clients get.
 */
async function read({ fresh = false, locate = false, reason = 'poll' } = {}) {
    if (!account()) throw new LapisError('No BlueLink account is saved (Service keys > BlueLink)', 'NO_ACCOUNT');
    const v = await vehicle();
    const before = live.status;
    const status = await api().status(v, { refresh: fresh });
    if (!status.location && before && before.location) status.location = before.location;
    // a remote start that ran out its timer: the car stopped itself, and BlueLink's kept report (no wake) still says the
    // engine is on until the car reports again - a report from before the run ended does not put it back on (Today showed
    // Running long after the timer and Start stayed off, Nov 18)
    const ran = live.command;
    if (ran && ran.kind === 'start' && ran.ended === 'timeout' && Number.isFinite(ran.endedAt) && status.engine
        && !(Number.isFinite(status.at) && status.at > ran.endedAt)) {
        status.engine = false;
        status.climate = false;
    }
    live.status = status;
    live.statusSeenAt = nowFn();
    live.lastError = null;
    if (!live.location && status.location) live.location = { ...status.location, readAt: nowFn() };
    await askLocation(locate || fresh).catch(() => null);
    await refreshWeather(false);
    const changed = !before || before.at !== status.at || before.locked !== status.locked || before.engine !== status.engine || before.fuel !== status.fuel || before.odometer !== status.odometer;
    if (changed) recordSample(status, live.location, 'bluelink');
    afterRead(before, status, reason);
    saveLatest();
    return pushState();
}

function afterRead(before, status, reason) {
    const s = getSettings();
    const now = nowFn();
    const parked = status.engine === false;
    // parked since: the report that first showed the engine off (or a moved odometer)
    if (!parked) live.parkedSince = 0;
    else if (!live.parkedSince || (before && before.engine) || (before && Number.isFinite(before.odometer) && status.odometer !== before.odometer)) live.parkedSince = status.at || now;
    // last seen running (the engine on, or driven between two reads): alertsQuiet's "was just running". Not parkedSince, which
    // after a server restart is only the newest report's time for a car that has stood for hours
    if (status.engine === true) live.ranAt = now;
    else if (before && Number.isFinite(before.odometer) && Number.isFinite(status.odometer) && status.odometer !== before.odometer) live.ranAt = Number(status.at) || now;

    // fill-up
    if (before && Number.isFinite(before.fuel) && Number.isFinite(status.fuel) && status.fuel - before.fuel >= usage.FILLUP_RISE_PCT) {
        logEvent('fillup', { from: before.fuel, to: status.fuel, odo: status.odometer });
        live.flags.lowFuel = false;
        live.flags.refuelDay = '';
        live.flags.refuelSaid = null;
        inboxClear('lapis:refuel');
    }

    // unlocked and parked: look again after lockRemindMin (waking the car once), then say so
    if (parked && status.locked === false) {
        if (reason === 'lock-check') {
            if (s.notify.unlocked && live.flags.unlockedFor !== live.parkedSince) {
                live.flags.unlockedFor = live.parkedSince;
                const mins = Math.max(1, Math.round((now - live.parkedSince) / MIN));
                const where = placeName(live.location, s);
                notice('unlocked', `${carName()} is unlocked`, `Parked${where ? ` at ${where}` : ''} for ${mins} minute${mins === 1 ? '' : 's'} with the doors unlocked. Lock it now?`, ['lock'], { stamp: `parked-${live.parkedSince}` });
            }
            sched.lockCheckAt = 0;
        } else if (!sched.lockCheckAt && live.flags.unlockedFor !== live.parkedSince) {
            sched.lockCheckAt = Math.max(now + MIN, live.parkedSince + s.lockRemindMin * MIN);
        }
    } else {
        sched.lockCheckAt = 0;
        if (status.locked && live.flags.unlockedFor) {
            // locked (or driven off): the reminder is done with, here and on the phones (#1061)
            live.flags.unlockedFor = 0;
            inboxClear('lapis:unlocked');
        }
    }

    // the alerts this read raises, said together in one notification (alertsNotice)
    const fresh = [];
    // low fuel: once per tank; while the car runs or was just parked it waits (alertsQuiet)
    const low = status.fuelLow === true || (Number.isFinite(status.fuel) && status.fuel <= s.lowFuelPct);
    if (low && !live.flags.lowFuel) {
        if (!(s.notify.lowFuel && alertsQuiet(status))) {
            live.flags.lowFuel = true;
            if (s.notify.lowFuel) fresh.push(fuelAlert(status));
        }
    } else if (!low && Number.isFinite(status.fuel) && status.fuel > s.lowFuelPct + 5) live.flags.lowFuel = false;

    healthNotices(s, fresh);
    alertsNotice(fresh, s, status);
    checkRun(status);
}

/*
 * Alerts are quiet while the car runs and until it has been parked JUST_PARKED_MS (Yukimi, Nov 21 2026: "it shoudl not notify
 * me abut alrts when the car is running or was just running and is now not (unless its the lock car notification)", #1008). A drive's
 * end is when readings move (tires cool, the 12 V settles) and she is at the car. An alert that still holds once the car has
 * been parked that long is said then; the left-unlocked reminder is not an alert and keeps its own timing.
 */
const JUST_PARKED_MS = 30 * MIN;
function alertsQuiet(status = live.status) {
    if (!status) return false;
    if (status.engine === true) return true;
    return !!live.ranAt && nowFn() - live.ranAt < JUST_PARKED_MS;
}

function fuelAlert(status) {
    const range = Number.isFinite(status.range) ? `, about ${Math.round(status.range)} miles` : '';
    const a = { key: 'fuel', stamp: 'low', title: 'Fuel is low', text: `${carName()} has ${fmtPct(status.fuel)} of a tank${range}.`, short: `Fuel ${fmtPct(status.fuel)}${range}` };
    // today's refuel reminder said with it (#1061): one notification says the fuel and when to get gas, not two
    const r = refuelAdvice();
    if (r) Object.assign(a, { stamp: `low+${r.stamp}`, title: r.title, text: r.text, short: `${a.short}: ${r.title.charAt(0).toLowerCase()}${r.title.slice(1)}`, refuel: r.stamp });
    return a;
}

/** The refuel reminder said today (dailyNotices), while it is still today's: its stamp, title and words. */
function refuelAdvice() {
    const r = live.flags.refuelSaid;
    if (!r || !r.day || r.stamp !== live.flags.refuelDay) return null;
    try { return usageModel(getSettings()).today === r.day ? r : null; } catch (_e) { return null; }
}

/** The low-fuel alert holds (said once per tank, still low, switched on): the combined alert names the fuel. */
function fuelHeld(s, status = live.status) {
    return !!(live.flags.lowFuel && s.notify.lowFuel && status && (status.fuelLow === true || (Number.isFinite(status.fuel) && status.fuel <= s.lowFuelPct)));
}

/**
 * One notification for the alerts a read raised (Yukimi, Nov 21 2026: several issues at once were several notifications). It
 * names every alert that holds and is switched on, the new ones first, one short line each (the car's name and where it is
 * parked once, not in every line; the advice stays in Lapis). One alert keeps its own title and words. Its inbox id is
 * stable (lapis:health:alerts): a later one replaces it on the phones instead of piling up.
 */
function alertsNotice(fresh, s, status = live.status, { refuel = false } = {}) {
    if (!fresh.length && !refuel) return null;
    const have = new Set(fresh.map((a) => a.key));
    const still = healthAlerts(s).filter((a) => !have.has(a.key) && healthItemOn(s, a.key) && live.flags.health[a.key]);
    if (!have.has('fuel') && fuelHeld(s, status)) still.push(fuelAlert(status));
    const all = fresh.concat(still);
    if (!all.length) return null;
    const stamp = all.map((a) => `${a.key}=${a.stamp}`).join(',');
    const fuel = all.find((a) => a.key === 'fuel' && a.refuel);
    // the refuel reminder is in this one: its own notice goes (the same words twice is alert fatigue, #1061)
    if (fuel) inboxClear('lapis:refuel');
    const extra = { key: 'alerts', stamp, alert: true, refuel: fuel ? fuel.refuel : undefined };
    if (all.length === 1) return notice('health', all[0].title, all[0].text, ['view'], extra);
    const where = status && status.engine === false ? placeName(live.location, s) : '';
    const lines = [...new Set(all.map((a) => a.short || a.title))];
    return notice('health', `${carName()} needs attention`, `${where ? `Parked at ${where}.\n` : ''}${lines.join('\n')}`, ['view'], Object.assign(extra, { count: all.length }));
}

// ------------------------------------------------------------------------------------------ vehicle health

const TIRE_NAME = { fl: 'front left', fr: 'front right', rl: 'rear left', rr: 'rear right' };

/** The tires that are low: the car's lamp, under the set pressure, or 4 psi under the other three. */
function lowTires(status, s) {
    const lamp = status.tireLow || {};
    const psi = status.tirePsi || {};
    const keys = Object.keys(TIRE_NAME);
    return keys.filter((k) => {
        if (lamp[k] === true) return true;
        const v = psi[k];
        if (!Number.isFinite(v) || v <= 0) return false;
        if (v < s.tireLowPsi) return true;
        const others = keys.filter((o) => o !== k).map((o) => psi[o]).filter((x) => Number.isFinite(x) && x > 0);
        return others.length === 3 && v <= others.reduce((a, b) => a + b, 0) / 3 - 4;
    });
}

/** The highest 12 V reading of the last day and when, for "it was 73 % at 2:00 AM". */
function batteryPeak() {
    const v = live.vehicle;
    if (!v) return null;
    try {
        return database().prepare('SELECT t, battery12 FROM samples WHERE vehicle = ? AND t >= ? AND battery12 IS NOT NULL ORDER BY battery12 DESC, t DESC LIMIT 1').get(v.id, nowFn() - DAY) || null;
    } catch (_e) {
        return null;
    }
}

const clockAt = (t, s) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: s.timeZone || undefined }).format(new Date(t));

/**
 * What is wrong with the car right now: [{ key, stamp, title, text }]. `stamp` changes when the
 * condition gets worse, which is when it is said again.
 */
function healthAlerts(s) {
    const status = live.status;
    if (!status) return [];
    const out = [];
    const where = placeName(live.location, s);
    const parked = status.engine === false ? ` while parked${where ? ` at ${where}` : ''}` : '';
    const warnAt = s.batteryLowPct || (Number.isFinite(status.battery12WarnAt) ? status.battery12WarnAt : 50);
    if (Number.isFinite(status.battery12) && status.battery12 < warnAt) {
        const peak = batteryPeak();
        const fell = peak && peak.battery12 - status.battery12 >= 8 ? ` It was ${Math.round(peak.battery12)}% at ${clockAt(peak.t, s)}.` : '';
        out.push({
            key: 'battery12',
            // said again for every further 10 points it falls
            stamp: `b${Math.floor(status.battery12 / 10)}`,
            title: '12 V battery is low',
            short: `12 V battery ${Math.round(status.battery12)}%`,
            text: `${carName()}'s 12 V battery is at ${Math.round(status.battery12)}%${parked} (warning level ${warnAt}%).${fell} Something may be drawing power: check for an inverter, a charger or a light left on.`,
        });
    }
    const tires = lowTires(status, s);
    if (tires.length || (status.tireLow && status.tireLow.any)) {
        const psi = status.tirePsi || {};
        const list = tires.map((k) => `${TIRE_NAME[k]}${Number.isFinite(psi[k]) ? ` ${psi[k]} psi` : ''}`);
        const lowest = Math.min(...tires.map((k) => psi[k]).filter(Number.isFinite), 99);
        out.push({
            key: 'tire',
            // said again when another tire joins or the lowest loses 3 more psi
            stamp: `t${tires.join('')}:${lowest === 99 ? 'x' : Math.floor(lowest / 3)}`,
            title: tires.length > 1 ? 'Tire pressures are low' : 'Tire pressure is low',
            short: list.length ? `${tires.length > 1 ? 'Tires' : 'Tire'} low: ${list.join(', ')}` : 'Tire pressure warning on',
            text: list.length ? `${carName()}${parked}: ${list.join(', ')}. Inflate ${tires.length > 1 ? 'them' : 'it'}, and check for a puncture if it keeps falling.` : `${carName()}'s tire pressure warning is on${parked}.`,
        });
    }
    if (status.brakeFluidLow === true) out.push({ key: 'brake', stamp: 'on', short: 'Brake fluid low', title: 'Brake fluid is low', text: `${carName()} reports low brake fluid. Have it checked before driving far.` });
    if (status.washerLow === true) out.push({ key: 'washer', stamp: 'on', short: 'Washer fluid low', title: 'Washer fluid is low', text: `${carName()} reports low washer fluid.` });
    if (status.keyBatteryLow === true) out.push({ key: 'key', stamp: 'on', short: 'Smart key battery low', title: 'Smart key battery is low', text: `${carName()} reports a weak smart key battery. Replace the key's coin cell.` });
    return out;
}

/** The health alerts that are new or worse since they were last said, into `fresh` (said together by alertsNotice). */
function healthNotices(s, fresh) {
    const alerts = healthAlerts(s);
    const active = new Set(alerts.map((a) => a.key));
    Object.keys(live.flags.health).forEach((k) => {
        if (!active.has(k)) delete live.flags.health[k];
    });
    const quiet = alertsQuiet();
    alerts.forEach((a) => {
        const seen = live.flags.health[a.key];
        if (seen && seen.stamp === a.stamp) return;
        const on = healthItemOn(s, a.key);
        // the car running or just parked: not noted yet, so it is said once the car has been parked a while if it still holds
        if (on && quiet) return;
        live.flags.health[a.key] = { stamp: a.stamp, since: (seen && seen.since) || nowFn(), at: nowFn() };
        if (on && Array.isArray(fresh)) fresh.push(a);
    });
}

const fmtPct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : 'little');

function carName() {
    const s = getSettings();
    return s.name || (live.vehicle && live.vehicle.name) || 'The car';
}

// ------------------------------------------------------------------------------------------ usage, refuel day, maintenance

function commuteMiles(s) {
    if (s.commuteMiles) return { miles: s.commuteMiles, basis: 'set' };
    try {
        const latest = require('./trafficService').getLatest() || {};
        const rep = latest.work || latest.home;
        const route = rep && (rep.preferred || rep.fastest || (rep.routes && rep.routes[0]));
        if (route && route.distanceM > 0) return { miles: Math.round((route.distanceM / 1609.344) * 10) / 10, basis: 'traffic' };
    } catch (_e) {
        /* Traffic is optional */
    }
    const direct = usage.milesBetween(s.home, s.work);
    // roads run longer than the straight line
    return direct ? { miles: Math.round(direct * 1.3 * 10) / 10, basis: 'distance' } : { miles: null, basis: 'none' };
}

let usageMemo = { key: '', value: null };

function usageModel(s) {
    const status = live.status;
    const key = `${status ? `${status.at}:${status.fuel}:${status.odometer}` : 0}|${usage.dayKey(nowFn(), s.timeZone)}|${JSON.stringify([s.workDays, s.commuteMiles, s.tankGal, s.mpg, s.reservePct, s.errandMiles, s.offDayMiles])}`;
    if (usageMemo.key === key) return usageMemo.value;
    const samples = samplesSince(nowFn() - 120 * DAY);
    const days = usage.daily(samples, s.timeZone);
    const today = usage.dayKey(nowFn(), s.timeZone);
    const commute = commuteMiles(s);
    let perPct = usage.milesPerPercent(samples, { tankGal: s.tankGal, mpg: s.mpg });
    // the car's own range is the cautious figure when it promises fewer miles a percent than the record does
    if (status && Number.isFinite(status.range) && Number.isFinite(status.fuel) && status.fuel >= 10 && status.range > 0) {
        const car = Math.round((status.range / status.fuel) * 100) / 100;
        if (car < perPct.value) perPct = { ...perPct, value: car, basis: 'car', measured: perPct.value };
    }
    const weekday = usage.weekdayMiles(days.filter((d) => d.day !== today), { workDays: s.workDays, commuteMiles: commute.miles, errandMiles: s.errandMiles, offDayMiles: s.offDayMiles });
    const todayRow = days.find((d) => d.day === today);
    const refuel = status && Number.isFinite(status.fuel) ? usage.refuelBy({ fuelPct: status.fuel, milesPerPct: perPct.value, weekday, todayKey: today, milesToday: todayRow ? todayRow.miles : 0, reservePct: s.reservePct, workDays: s.workDays }) : null;
    const last7 = days.filter((d) => d.day > usage.addDays(today, -7));
    const value = {
        today,
        refuel,
        perPct,
        weekday,
        commute,
        milesToday: todayRow ? todayRow.miles : 0,
        miles7: Math.round(last7.reduce((a, d) => a + d.miles, 0) * 10) / 10,
        recordedDays: days.length,
        recordFrom: samples.length ? samples[0].t : null,
    };
    usageMemo = { key, value };
    return value;
}

function maintenanceState(s) {
    const odo = live.status && live.status.odometer;
    const today = usage.dayKey(nowFn(), s.timeZone);
    return s.maintenance.map((m) => {
        const out = { ...m, milesLeft: null, daysLeft: null, due: false, soon: false, known: false };
        if (m.everyMiles && Number.isFinite(odo)) {
            // never marked done: the next multiple of the interval
            const base = Number.isFinite(m.lastOdo) ? m.lastOdo : Math.floor(odo / m.everyMiles) * m.everyMiles;
            out.milesLeft = Math.round(base + m.everyMiles - odo);
            out.known = Number.isFinite(m.lastOdo);
        }
        if (m.everyMonths && m.lastDate) {
            const [y, mo, d] = m.lastDate.split('-').map(Number);
            const dueAt = Date.UTC(y, mo - 1 + m.everyMonths, d);
            out.daysLeft = Math.round((dueAt - Date.parse(today)) / DAY);
        }
        out.due = (out.milesLeft !== null && out.milesLeft <= 0) || (out.daysLeft !== null && out.daysLeft <= 0);
        out.soon = !out.due && ((out.milesLeft !== null && out.milesLeft <= 500) || (out.daysLeft !== null && out.daysLeft <= 21));
        return out;
    });
}

/** Minutes since midnight in the settings' time zone. */
function localMinutes(s) {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: s.timeZone || undefined }).formatToParts(new Date(nowFn()));
    const get = (t) => Number((parts.find((p) => p.type === t) || {}).value) || 0;
    return (get('hour') % 24) * 60 + get('minute');
}

// the daily look: refuel day and maintenance notices (from the scheduler, once the day's first read is in)
function dailyNotices() {
    const s = getSettings();
    if (!live.status) return;
    const u = usageModel(s);
    // refuel: said when it is useful. The evening before a "before work" stop, then that morning
    // ahead of the leave time; for "after work", ahead of leaving work; on a day off, in the morning.
    const stop = u.refuel && !u.refuel.beyond ? u.refuel.stop : null;
    // the car running or just parked: the reminders wait (alertsQuiet); their windows last, so they come on a later tick
    const quiet = alertsQuiet();
    if (s.notify.refuel && stop && !quiet) {
        const mins = localMinutes(s);
        const hhmm = (v, def) => { const m = /^(\d\d):(\d\d)$/.exec(v || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : def; };
        const fuel = `${carName()} has ${fmtPct(live.status.fuel)}${Number.isFinite(live.status.range) ? ` (${Math.round(live.status.range)} miles)` : ''}.`;
        const say = (stamp, title, text) => {
            if (live.flags.refuelDay === stamp) return;
            live.flags.refuelDay = stamp;
            live.flags.refuelSaid = { stamp, title, text, day: u.today };
            // the low-fuel alert is out: the reminder goes into it (one notification for the fuel, #1061 / #1008);
            // otherwise its own, one per car and period (lapis:refuel, stamp = day:part)
            if (fuelHeld(s)) alertsNotice([], s, live.status, { refuel: true });
            else notice('refuel', title, text, ['view'], { stamp, refuel: stamp, alert: true });
        };
        if (stop.day === u.today) {
            if (stop.part === 'before-work' && mins >= hhmm(s.leaveHome, 7 * 60) - 60) say(`${u.today}:am`, 'Get gas before work', `${fuel} The drive to work would take it under the ${s.reservePct}% reserve.`);
            else if (stop.part === 'after-work' && mins >= hhmm(s.leaveWork, 16 * 60) - 30) say(`${u.today}:pm`, 'Get gas after work', `${fuel} The drive home would take it under the ${s.reservePct}% reserve: fill up on the way.`);
            else if (!stop.part && mins >= 8 * 60) say(`${u.today}:day`, 'Get gas today', `${fuel} Today's driving would take it under the ${s.reservePct}% reserve.`);
        } else if (stop.day === usage.addDays(u.today, 1) && stop.part === 'before-work' && mins >= 19 * 60) {
            say(`${u.today}:eve`, 'Get gas tomorrow morning', `${fuel} Tomorrow's drive to work would take it under the ${s.reservePct}% reserve: fill up tonight or before work.`);
        }
    }
    if (s.notify.service && !quiet) {
        // every item that became due or close today in one notification (Nov 21 2026: one per item piled up)
        const say = [];
        maintenanceState(s).forEach((m) => {
            const stamp = m.due ? 'due' : m.soon ? 'soon' : '';
            if (!stamp || live.flags.service[m.id] === stamp) return;
            live.flags.service[m.id] = stamp;
            const left = m.milesLeft !== null ? (m.milesLeft <= 0 ? `${Math.abs(m.milesLeft).toLocaleString('en-US')} miles over` : `in ${m.milesLeft.toLocaleString('en-US')} miles`) : m.daysLeft <= 0 ? 'now' : `in ${m.daysLeft} days`;
            say.push({ due: !!m.due, line: `${m.label}: ${left}`, stamp: `${m.id}=${stamp}` });
        });
        if (say.length) notice('service', say.some((x) => x.due) ? 'Maintenance is due' : 'Maintenance is coming up', say.length === 1 ? `${say[0].line}.` : say.map((x) => x.line).join('\n'), ['view'], { key: 'maintenance', stamp: say.map((x) => x.stamp).join(','), alert: true });
    }
}

// ------------------------------------------------------------------------------------------ commands

function pendingCommand() {
    return live.command && live.command.state === 'sent' ? live.command : null;
}

/**
 * Send a command: 'lock' | 'unlock' | 'start' | 'stop'. `options` for start: { auto?, temp, minutes,
 * defrost, heating, seat } (auto true takes the climate pick). Answers once BlueLink accepted it;
 * the result arrives by lapis_updated (state.command) and a lapis_notice when it fails.
 */
async function command(kind, options = {}) {
    if (!['lock', 'unlock', 'start', 'stop'].includes(kind)) throw new LapisError('Unknown command', 'BAD_COMMAND');
    if (!account()) throw new LapisError('No BlueLink account is saved (Service keys > BlueLink)', 'NO_ACCOUNT');
    if (pendingCommand()) throw new LapisError('The car is still answering the last command', 'BUSY');
    const v = await vehicle();
    const s = getSettings();
    let sent = null;
    let res = null;
    const cmd = { id: `${nowFn().toString(36)}`, kind, state: 'sent', at: nowFn(), detail: null };
    live.command = cmd;
    pushState();
    try {
        if (kind === 'lock' || kind === 'unlock') res = await api().lock(v, kind === 'lock');
        else if (kind === 'stop') res = await api().stopClimate(v);
        else {
            let pick = null;
            if (options.auto !== false && s.autoClimate) {
                await refreshWeather(false);
                pick = climatePick(s);
            }
            const temp = Number.isFinite(Number(options.temp)) ? Number(options.temp) : pick ? pick.temp : 72;
            const seat = Number.isFinite(Number(options.seat)) ? Number(options.seat) : pick ? pick.seat : 0;
            sent = {
                temp: Math.min(bluelink.TEMP_MAX, Math.max(bluelink.TEMP_MIN, Math.round(temp))),
                asked: temp,
                minutes: int(options.minutes, 1, 30, s.runMinutes),
                defrost: 'defrost' in options ? !!options.defrost : pick ? pick.defrost : false,
                heating: Number.isFinite(Number(options.heating)) ? Number(options.heating) : pick ? pick.heating : 0,
                seat,
                auto: !!pick && !('temp' in options),
            };
            res = await api().startClimate(v, { temp: sent.temp, minutes: sent.minutes, defrost: sent.defrost, heating: sent.heating, seats: { fl: sent.seat, fr: options.passengerSeat ? sent.seat : 0 } });
            cmd.detail = sent;
        }
    } catch (e) {
        cmd.state = 'failed';
        cmd.error = e.message;
        logEvent('command', { kind, state: 'failed', error: e.message, sent });
        pushState();
        throw e;
    }
    cmd.transactionId = res && res.transactionId;
    logEvent('command', { kind, state: 'sent', sent });
    pushState();
    followCommand(cmd, v).catch((e) => console.warn(`[lapis] command follow-up: ${e.message}`));
    return { command: publicCommand(cmd) };
}

async function followCommand(cmd, v) {
    const until = cmd.at + COMMAND_WAIT_MS;
    let result = cmd.transactionId ? 'pending' : 'unknown';
    while (cmd.transactionId && nowFn() < until) {
        await sleep(COMMAND_POLL_MS);
        result = await api().actionStatus(v, cmd.transactionId).catch(() => 'unknown');
        if (result === 'success' || result === 'failed') break;
    }
    cmd.state = result === 'success' ? 'success' : result === 'failed' ? 'failed' : 'unconfirmed';
    cmd.doneAt = nowFn();
    logEvent('command', { kind: cmd.kind, state: cmd.state });
    if (cmd.state === 'success' && live.status) {
        // show the result at once; the fresh read below confirms it
        if (cmd.kind === 'lock') live.status = { ...live.status, locked: true };
        if (cmd.kind === 'unlock') live.status = { ...live.status, locked: false };
        if (cmd.kind === 'start') live.status = { ...live.status, engine: true, climate: true };
        if (cmd.kind === 'stop') live.status = { ...live.status, engine: false, climate: false };
        if (cmd.kind === 'start') {
            cmd.runsUntil = nowFn() + ((cmd.detail && cmd.detail.minutes) || 10) * MIN;
            // where the run began: a moved odometer or position later means someone is driving it
            cmd.startOdo = Number.isFinite(live.status.odometer) ? live.status.odometer : null;
            cmd.startLoc = live.location ? { lat: live.location.lat, lon: live.location.lon } : null;
            cmd.saidLeft = [];
            sched.runPollAt = nowFn() + 3 * MIN;
        }
    }
    pushState();
    if (cmd.state === 'failed') notice('command', `${LABEL[cmd.kind]} did not work`, `${carName()} did not carry out the command. Check the car, then try again.`, ['view'], { stamp: `cmd-${cmd.id}`, alert: true });
    if (cmd.state !== 'failed') {
        await sleep(cmd.state === 'success' ? 4000 : 15000);
        await read({ fresh: true, reason: 'command' }).catch((e) => console.warn(`[lapis] read after ${cmd.kind}: ${e.message}`));
    }
}

const LABEL = { lock: 'Lock', unlock: 'Unlock', start: 'Remote start', stop: 'Remote stop' };

// ------------------------------------------------------------------------------------------ a remote start on its timer

const RUN_WARN_MIN = [5, 3, 2, 1];

/** The remote start that is running on its timer, or null. */
function activeRun() {
    const c = live.command;
    return c && c.kind === 'start' && c.state === 'success' && Number.isFinite(c.runsUntil) ? c : null;
}

/** A remote start that ended on its timer in the last 12 hours (kept across restarts for read()'s check), or null. */
function timedOutRun() {
    const c = live.command;
    return c && c.kind === 'start' && c.ended === 'timeout' && Number.isFinite(c.endedAt) && nowFn() - c.endedAt < 12 * 60 * MIN ? c : null;
}

/** The run is over: someone drove off, the engine went off, or its time ran out. The timer stops. */
function endRun(cmd, why) {
    cmd.runsUntil = null;
    cmd.ended = why;
    cmd.endedAt = nowFn();
    sched.runPollAt = 0;
    logEvent('run-end', { why });
}

/** After a read: does the report show the run is over? */
function checkRun(status) {
    const cmd = activeRun();
    if (!cmd || !status) return;
    // the report must be newer than the start, or it is the car's state from before
    const fresh = Number.isFinite(status.at) && status.at > (cmd.doneAt || cmd.at) + 30 * 1000;
    const odoMoved = Number.isFinite(status.odometer) && Number.isFinite(cmd.startOdo) && status.odometer - cmd.startOdo >= 0.3;
    const where = status.location || null;
    const placeMoved = fresh && where && cmd.startLoc && usage.milesBetween(where, cmd.startLoc) * 1609.344 > 150;
    if (odoMoved || placeMoved) endRun(cmd, 'driving');
    else if (fresh && status.engine === false) endRun(cmd, 'off');
}

/** Say how long is left at 5, 3, 2 and 1 minutes (each once; a late tick says only the current one). */
function runWarnings(cmd, s) {
    const left = cmd.runsUntil - nowFn();
    if (left <= 0) return;
    const said = cmd.saidLeft || (cmd.saidLeft = []);
    const due = RUN_WARN_MIN.filter((m) => left <= m * MIN && !said.includes(m));
    if (!due.length) return;
    said.push(...due);
    const m = Math.min(...due);
    notice('run-left', `${m} minute${m === 1 ? '' : 's'} left`, `${carName()}'s remote start ends at ${clockAt(cmd.runsUntil, s)}. Stop it now, or start the car with the key to keep driving.`, ['stop'], { minutes: m, until: cmd.runsUntil, stamp: `${cmd.runsUntil}:${m}` });
}
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function publicCommand(cmd) {
    if (!cmd) return null;
    const { transactionId, startLoc, saidLeft, ...rest } = cmd;
    return rest;
}

// ------------------------------------------------------------------------------------------ state for clients

function getState() {
    const s = getSettings();
    const status = live.status;
    const loc = live.location;
    const configured = !!account();
    const u = status ? usageModel(s) : null;
    return {
        configured,
        vehicle: live.vehicle ? { id: live.vehicle.id, name: s.name || live.vehicle.name, model: live.vehicle.model, year: live.vehicle.year, engine: live.vehicle.engine } : null,
        status,
        seenAt: live.statusSeenAt || null,
        location: loc ? { ...loc, place: placeName(loc, s) } : null,
        parkedSince: live.parkedSince || null,
        climate: climatePick(s),
        usage: u,
        maintenance: status ? maintenanceState(s) : [],
        // what is wrong right now (a phone that missed the notice shows these when it connects)
        // what is wrong with the car shows in Lapis whatever is switched off for notifications (Nov 21 2026: per item)
        alerts: healthAlerts(s).map((a) => ({ ...a, since: (live.flags.health[a.key] && live.flags.health[a.key].since) || null })),
        command: publicCommand(live.command),
        error: live.lastError,
        nextReadAt: sched.nextPollAt || null,
        limits: { tempMin: bluelink.TEMP_MIN, tempMax: bluelink.TEMP_MAX },
        climatePreview: climate.preview(s.climate),
        settings: s,
    };
}

/** The record for graphs: range 'week' | 'month' | 'quarter' | 'year' | 'all'. */
function getHistory(range) {
    const s = getSettings();
    const span = { week: 7, month: 31, quarter: 92, year: 366 }[range] || null;
    const since = span ? nowFn() - span * DAY : 0;
    const samples = samplesSince(since);
    const days = usage.daily(samples, s.timeZone);
    let events = [];
    try {
        events = database().prepare('SELECT t, kind, data FROM events WHERE t >= ? ORDER BY t DESC LIMIT 60').all(since).map((e) => ({ t: e.t, kind: e.kind, data: safeJson(e.data) }));
    } catch (_e) {
        events = [];
    }
    const series = (k) => usage.thin(samples.filter((r) => Number.isFinite(r[k])).map((r) => [r.t, r[k]]), 240);
    return {
        range: span ? range : 'all',
        from: samples.length ? samples[0].t : null,
        to: samples.length ? samples[samples.length - 1].t : null,
        count: samples.length,
        fuel: series('fuel'),
        odometer: series('odo'),
        battery12: series('battery12'),
        outdoor: series('outdoor'),
        days: days.slice(-120),
        fillups: usage.fillups(samples).slice(-30),
        trips: usage.trips(samples).slice(-40).reverse(),
        places: usage.thin(samples.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)).map((r) => [r.t, r.lat, r.lon]), 200),
        perPct: usage.milesPerPercent(samples, { tankGal: s.tankGal, mpg: s.mpg }),
        events,
    };
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch (_e) {
        return {};
    }
}

// ------------------------------------------------------------------------------------------ the car's picture

function pictureFile() {
    return path.join(PICTURE_DIR, 'car-picture');
}

/** Save the picture shown for the car: a data URL (image/png, jpeg or webp), or null for the built-in one. */
async function savePicture(dataUrl) {
    if (dataUrl === null || dataUrl === '') {
        try {
            fs.unlinkSync(pictureFile());
        } catch (_e) {
            /* none saved */
        }
        const c = Object.assign({}, config('lapis', {}) || {});
        delete c.picture;
        await gr.modifyConfig('config').assign(['lapis'], c);
        pushState();
        return { picture: null };
    }
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new LapisError('The picture must be a PNG, JPEG or WebP image', 'BAD_PICTURE');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > PICTURE_MAX) throw new LapisError('The picture is too large (900 KB at most)', 'BAD_PICTURE');
    fs.mkdirSync(PICTURE_DIR, { recursive: true });
    fs.writeFileSync(`${pictureFile()}.tmp`, buf);
    fs.renameSync(`${pictureFile()}.tmp`, pictureFile());
    const picture = { rev: nowFn().toString(36), type: m[1] };
    const c = Object.assign({}, config('lapis', {}) || {}, { picture });
    await gr.modifyConfig('config').assign(['lapis'], c);
    pushState();
    return { picture };
}

function getPicture() {
    const p = getSettings().picture;
    if (!p) return { picture: null };
    try {
        return { picture: p, dataUrl: `data:${p.type};base64,${fs.readFileSync(pictureFile()).toString('base64')}` };
    } catch (_e) {
        return { picture: null };
    }
}

// ------------------------------------------------------------------------------------------ scheduler

async function tick() {
    if (sched.busy || !gr) return;
    const now = nowFn();
    const acct = account();
    if (!acct) return;
    // a saved or corrected account is used at once, not after the back-off
    const sig = `${acct.username}|${acct.password}|${acct.pin}`;
    if (sched.accountSig && sched.accountSig !== sig) accountChanged();
    sched.accountSig = sig;
    const s = getSettings();
    sched.busy = true;
    try {
        // a remote start on its timer: the warnings, its end, and a look every 3 minutes for driving
        let didRead = false;
        const run = activeRun();
        if (run) {
            runWarnings(run, s);
            if (nowFn() >= run.runsUntil) {
                endRun(run, 'timeout');
                // the car's own timer stopped it: shown off now, confirmed by one fresh report a minute later
                if (live.status && (live.status.engine || live.status.climate)) live.status = { ...live.status, engine: false, climate: false };
                sched.runEndCheckAt = nowFn() + MIN;
                pushState();
            } else if (nowFn() >= (sched.runPollAt || 0) && !pendingCommand()) {
                sched.runPollAt = nowFn() + 3 * MIN;
                await read({ reason: 'run' });
                didRead = true;
            }
        }
        if (didRead) {
            /* the run's look counts as this tick's read */
        } else if (sched.runEndCheckAt && now >= sched.runEndCheckAt && !pendingCommand()) {
            // the timer's end, confirmed once with a woken report
            sched.runEndCheckAt = 0;
            await read({ fresh: true, reason: 'run-end' });
            sched.nextPollAt = nowFn() + s.pollMin * MIN;
        } else if (sched.lockCheckAt && now >= sched.lockCheckAt && !pendingCommand()) {
            sched.lockCheckAt = 0;
            await read({ fresh: true, reason: 'lock-check' });
            sched.nextPollAt = nowFn() + s.pollMin * MIN;
        } else if (nowFn() >= sched.nextPollAt && !pendingCommand()) {
            sched.nextPollAt = now + s.pollMin * MIN;
            await read({ reason: 'poll' });
            sched.backoff = 0;
        } else if (live.status && now - sched.weatherAt > 30 * MIN) {
            sched.weatherAt = now;
            const before = live.weather && live.weather.at;
            await refreshWeather(false);
            if (live.weather && live.weather.at !== before) pushState();
        }
        dailyNotices();
    } catch (e) {
        live.lastError = { message: e.message, code: e.code || 'LAPIS_ERROR', at: nowFn() };
        // a wrong password must not be retried every few minutes; anything else backs off gently
        sched.backoff = Math.min(e.code === 'AUTH' || e.code === 'NO_ACCOUNT' ? 6 * HOUR : 2 * HOUR, Math.max(s.pollMin * MIN, (sched.backoff || 5 * MIN) * 2));
        sched.nextPollAt = nowFn() + sched.backoff;
        console.warn(`[lapis] read failed (${e.code || 'error'}): ${e.message}`);
        pushState();
    } finally {
        sched.busy = false;
    }
}

function startScheduler() {
    if (sched.timer) return;
    dropRepeatNotices();
    sched.nextPollAt = nowFn() + 20 * 1000;
    sched.timer = setInterval(() => {
        tick().catch((e) => console.warn(`[lapis] tick: ${e.message}`));
    }, 30 * 1000);
    if (sched.timer.unref) sched.timer.unref();
}

/** The account was saved or changed: forget the old sign-in and read now. */
function accountChanged() {
    if (client) client.signOut();
    live.vehicle = null;
    live.lastError = null;
    sched.backoff = 0;
    sched.nextPollAt = nowFn() + 2000;
}

// ------------------------------------------------------------------------------------------ persistence and broadcasts

function saveLatest() {
    try {
        fs.mkdirSync(path.dirname(LATEST_FILE), { recursive: true });
        const body = JSON.stringify({ command: activeRun() || timedOutRun(), vehicle: live.vehicle, status: live.status, statusSeenAt: live.statusSeenAt, location: live.location, locationOdo: live.locationOdo, parkedSince: live.parkedSince, flags: live.flags, weather: live.weather });
        fs.writeFileSync(`${LATEST_FILE}.tmp`, body);
        fs.renameSync(`${LATEST_FILE}.tmp`, LATEST_FILE);
    } catch (e) {
        console.warn(`[lapis] latest not saved: ${e.message}`);
    }
}

function loadLatest() {
    try {
        const o = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
        ['vehicle', 'status', 'statusSeenAt', 'location', 'locationOdo', 'parkedSince', 'weather'].forEach((k) => {
            if (o[k] !== undefined && o[k] !== null) live[k] = o[k];
        });
        // a run still on its timer carries on (its warnings and the driving check)
        const c = o.command;
        if (c && c.kind === 'start' && c.state === 'success') {
            if (c.runsUntil > nowFn()) live.command = c;
            // its timer ran out while the server was down: ended there (the car stopped itself)
            else if (Number.isFinite(c.runsUntil)) { live.command = Object.assign(c, { runsUntil: null, ended: 'timeout', endedAt: c.runsUntil }); sched.runEndCheckAt = nowFn() + MIN; }
            // ended on its timer before: kept, so BlueLink's kept report from the run does not show it running again
            else if (c.ended === 'timeout' && Number.isFinite(c.endedAt)) live.command = c;
        }
        const ran = live.command;
        if (ran && ran.ended === 'timeout' && live.status && live.status.engine && !(Number.isFinite(live.status.at) && live.status.at > ran.endedAt)) {
            live.status = Object.assign({}, live.status, { engine: false, climate: false });
        }
        if (o.flags && typeof o.flags === 'object') live.flags = Object.assign(live.flags, o.flags, { service: Object.assign({}, o.flags.service || {}), health: Object.assign({}, o.flags.health || {}) });
    } catch (_e) {
        /* first run */
    }
}

function server() {
    return gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
}

const adminClient = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));

function broadcast(message) {
    try {
        const srv = server();
        if (srv && typeof srv.broadcast === 'function') srv.broadcast(Object.assign({ timestamp: new Date().toISOString() }, message), adminClient);
    } catch (error) {
        console.warn(`[lapis] broadcast skipped: ${error.message}`);
    }
}

// lapis_updated only when the state changed (#890): every read, weather look and scheduler step
// pushed it, though often the only field that moved was nextReadAt (when the next read is due, which
// no page shows). seenAt ("read 10:35" on the phone's status page) is shown, so it still counts.
let lastPushKey = null;

function pushKey(state) {
    try {
        const { nextReadAt: _n, ...rest } = state || {};
        return JSON.stringify(rest);
    } catch (_e) {
        return String(nowFn());
    }
}

function pushState() {
    const state = getState();
    const key = pushKey(state);
    if (key === lastPushKey) return state;
    try { require('./phoneStatus').touch('lapis'); } catch (_) { /* best effort (#908) */ }
    lastPushKey = key;
    broadcast({ type: 'lapis_updated', data: { state } });
    return state;
}

let noticeSeq = 0;

/**
 * A notice: the pages' live lapis_notice and the durable inbox (#845). Every kind has one stable inbox id per car and kind
 * (lapis:<kind>[:<key>]; one car per account), so saying it again replaces it instead of adding a copy, and a stamp naming
 * the condition and period it is about (the refuel day and side of work, the parking, the alerts and their steps, the
 * command). The stamp is kept with the inbox notice, so the same thing is never said twice, even after a restart lost
 * what this process remembered, or once she has dismissed it (Yukimi, Nov 22 2026, #1061: "Get gas today" three times,
 * once per server start). The flags that decided it are on disk before it goes out (saveLatest).
 */
function notice(kind, title, text, actions, extra) {
    const n = Object.assign({ id: `${nowFn().toString(36)}-${++noticeSeq}`, kind, title, text, actions: actions || [] }, extra || {});
    const inboxId = extra && extra.key ? `lapis:${kind}:${extra.key}` : `lapis:${kind}`;
    const stamp = extra && extra.stamp ? String(extra.stamp) : '';
    if (stamp) {
        const cur = inboxGet(inboxId);
        if (cur && cur.data && cur.data.stamp === stamp) {
            saveLatest();
            return null;
        }
    }
    saveLatest();
    logEvent('notice', { kind, title, text });
    broadcast({ type: 'lapis_notice', data: n });
    // shown on resume and posted by the native app when the page is not running; a run countdown is only useful until it
    // ends (its 'until'). A new stamp under the same id is news (alert: the phones sound again); the same one never comes here.
    try {
        require('./notificationInbox').bind(gr).publish({
            app: 'lapis', id: inboxId, cls: kind === 'unlocked' ? 'lapis-unlocked' : kind === 'health' ? 'lapis-issue' : kind === 'run-left' ? 'lapis-run-left' : 'notification',
            title, text, actions: n.actions, alert: extra && extra.alert === true ? true : undefined,
            data: { app: 'lapis', kind, stamp: stamp || undefined, refuel: (extra && extra.refuel) || undefined, open: kind === 'service' ? 'service' : kind === 'refuel' || kind === 'low-fuel' ? 'history' : kind === 'run-left' ? 'start' : kind === 'health' ? 'status' : null },
            expiresAt: kind === 'run-left' && Number.isFinite(n.until) ? n.until : undefined,
        });
    } catch (e) { console.warn(`[lapis] inbox publish: ${e.message}`); }
    return n;
}

/** The inbox's copy of a Lapis notice (any state), or null. */
function inboxGet(id) {
    try { return require('./notificationInbox').bind(gr).get('admin', id); } catch (_e) { return null; }
}

/** A Lapis notice is done with: cleared in the inbox and on the phones (no-op when it is not there or already cleared). */
function inboxClear(id) {
    try {
        const cur = inboxGet(id);
        if (cur && cur.state !== 'cleared' && cur.state !== 'acted') require('./notificationInbox').bind(gr).clear('admin', id, 'server');
    } catch (_e) { /* best effort */ }
}

/**
 * Once at start (#1061): the notices from before stable ids (lapis:<time>-<n>, one per publish) said the same thing again
 * after each server start. Of each title the newest stays; the extra copies leave the inbox and the phones. A refuel
 * reminder from an earlier day (its stamp day:part; the evening's lasts into the next morning) is old news and goes too.
 */
function dropRepeatNotices() {
    try {
        const inbox = require('./notificationInbox').bind(gr);
        const today = usage.dayKey(nowFn(), getSettings().timeZone);
        const stale = (r) => {
            const m = /^(\d{4}-\d\d-\d\d):([a-z]+)$/.exec(String(r || ''));
            return !!m && (m[2] === 'eve' ? usage.addDays(m[1], 1) < today : m[1] < today);
        };
        const keep = new Set();
        inbox.list('admin')
            .filter((x) => x.app === 'lapis' && x.state !== 'cleared' && x.state !== 'acted')
            .forEach((x) => {
                if (stale(x.data && x.data.refuel)) { inbox.clear('admin', x.id, 'server'); return; }
                if (!/^lapis:[a-z0-9]+-\d+$/.test(String(x.id || ''))) return;
                // newest first: the first of a title stays
                if (keep.has(x.title)) inbox.clear('admin', x.id, 'server');
                else keep.add(x.title);
            });
    } catch (e) { console.warn(`[lapis] old notices: ${e.message}`); }
}

module.exports = {
    bind,
    getSettings,
    saveSettings,
    serviceDone,
    getState,
    getHistory,
    read,
    command,
    listVehicles,
    importSamples,
    savePicture,
    getPicture,
    startScheduler,
    accountChanged,
    LapisError,
    DEFAULTS,
    _test: {
        live,
        sched,
        tick,
        dailyNotices,
        dropRepeatNotices,
        afterRead,
        weatherAt,
        usageModel,
        maintenanceState,
        healthAlerts,
        lowTires,
        activeRun,
        setNow: (fn) => {
            nowFn = fn || (() => Date.now());
        },
        setSleep: (fn) => {
            sleep = fn;
        },
        reset: () => {
            client = null;
            if (db) db.close();
            db = null;
            usageMemo = { key: '', value: null };
            lastPushKey = null;
        },
    },
};
