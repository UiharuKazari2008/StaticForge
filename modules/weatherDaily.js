'use strict';

// Daily weather pictures per workspace (#1126). Config weatherDaily:
//   { enabled: true, time: "07:30", places: [{ workspace: "<id|name>", name, lat, lon }] }
// Once a day, for each place: the forecast is read (weatherService), a context brief (place, weekday and date,
// season, conditions, temperatures) is built and a Yozora chat is started to draw one picture with generate_image
// into that workspace (same route as the shrine job, #1149). Source weather-daily:<workspace>:<date> dedupes a rerun.
// Press-driven pictures come from the Weather app itself (Menu > Create Picture).

const HOUR = 3600 * 1000;
let timer = null;
let gr = null;
let lastRun = null;

function settings() {
    let cfg = {};
    try { const c = gr && (typeof gr.getConfig === 'function' ? gr.getConfig() : gr.config); cfg = (c && c.weatherDaily) || {}; } catch (_e) { cfg = {}; }
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(cfg.time || '07:30'));
    const places = (Array.isArray(cfg.places) ? cfg.places : []).filter((p) => p && p.workspace && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
    return { enabled: cfg.enabled === true && places.length > 0, hour: m ? Math.min(23, +m[1]) : 7, minute: m ? Math.min(59, +m[2]) : 30, places };
}

function nextRunAt(from = Date.now()) {
    const s = settings();
    const d = new Date(from);
    d.setHours(s.hour, s.minute, 0, 0);
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
}

function seasonOf(month, lat) {
    const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][month];
    if (lat >= 0) return north;
    return { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[north];
}

const pad2 = (v) => String(v).padStart(2, '0');

// the place's own wall clock when the forecast carries its UTC offset (seconds), else the server's
function placeClock(fc, date) {
    if (fc && Number.isFinite(Number(fc.offset))) {
        const d = new Date(date.getTime() + Number(fc.offset) * 1000);
        return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
    }
    return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate(), wd: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

function briefFor(place, fc, date) {
    const cur = (fc && fc.current) || {};
    const today = (fc && Array.isArray(fc.daily) && fc.daily[0]) || {};
    const clock = placeClock(fc, date);
    const season = seasonOf(clock.m, Number(place.lat));
    const day = `${WEEKDAYS[clock.wd]}, ${MONTHS[clock.m]} ${clock.d}, ${clock.y}`;
    const parts = [];
    if (cur.text) parts.push(cur.text);
    if (num(cur.tempC) != null) parts.push(`${cur.tempC} C${num(cur.feelsC) != null ? ` (feels ${cur.feelsC} C)` : ''}`);
    if (num(cur.cloud) != null) parts.push(`cloud cover ${cur.cloud}%`);
    if (num(cur.windKmh) != null) parts.push(`wind ${cur.windKmh} km/h`);
    if (num(cur.humidity) != null) parts.push(`humidity ${cur.humidity}%`);
    if (num(cur.visibilityM) != null && cur.visibilityM < 5000) parts.push(`visibility ${Math.round(cur.visibilityM)} m`);
    if (cur.isDay != null) parts.push(cur.isDay === false ? 'night' : 'daytime');
    const dayLine = [];
    if (today.text) dayLine.push(today.text);
    if (num(today.maxC) != null) dayLine.push(`high ${today.maxC} C, low ${num(today.minC) != null ? today.minC : '?'} C`);
    if (num(today.rain) != null) dayLine.push(`rain chance ${today.rain}%`);
    if (today.sunrise && today.sunset) dayLine.push(`sunrise ${String(today.sunrise).slice(11, 16)}, sunset ${String(today.sunset).slice(11, 16)}`);
    return [
        `Daily weather picture (#1126) for the workspace "${place.workspace}".`,
        `Place: ${place.name || `${place.lat}, ${place.lon}`}. Day: ${day} (${season}), local time ${pad2(Math.floor(clock.minutes / 60))}:${pad2(clock.minutes % 60)}.`,
        `Conditions now: ${parts.length ? parts.join(', ') : 'unknown'}.`,
        dayLine.length ? `Today: ${dayLine.join('; ')}.` : '',
        'Draw ONE picture of this place on this day in this weather: the light, sky, season and atmosphere must match.',
        `Use generate_image with workspace "${place.workspace}", normal resolution, n=1, a full present-tense scene description (NovelAI keeps no memory).`,
        'Do not mail or comment; the picture landing in the workspace is the result.'
    ].filter(Boolean).join('\n');
}

async function runPlace(place, now) {
    const weatherService = require('./weatherService');
    const { startDirectorSession } = require('./directorStart');
    const iso = now.toISOString().slice(0, 10);
    let fc = null;
    try { fc = await weatherService.getForecast(Number(place.lat), Number(place.lon)); } catch (e) { fc = null; }
    const prompt = briefFor(place, fc, now) + (fc ? '' : '\n(The forecast could not be read: say so in one line and draw the season and place only.)');
    const session = await startDirectorSession(gr, {
        persona: 'yozora', thread: 'weather-daily', title: `Weather picture ${place.name || place.workspace} ${iso}`,
        source: `weather-daily:${place.workspace}:${iso}`, prompt
    });
    return { workspace: place.workspace, sessionId: session && session.sessionId };
}

async function runNow(workspace) {
    const now = new Date();
    const out = [];
    const places = settings().places.filter((p) => !workspace || String(p.workspace) === String(workspace));
    for (const place of places) {
        try { out.push(await runPlace(place, now)); } catch (e) { out.push({ workspace: place.workspace, error: e.message }); console.warn(`[weatherDaily] ${place.workspace}: ${e.message}`); }
    }
    lastRun = { at: now.getTime(), results: out };
    return lastRun;
}

function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!settings().enabled || process.env.WEATHER_DAILY_OFF) return;
    const wait = Math.min(nextRunAt() - Date.now(), 24 * HOUR);
    timer = setTimeout(async () => {
        timer = null;
        try { await runNow(); } catch (e) { console.warn(`[weatherDaily] ${e.message}`); }
        arm();
    }, Math.max(1000, wait));
    if (timer.unref) timer.unref();
}

function start(globalResources) {
    if (globalResources) gr = globalResources;
    if (timer || process.env.WEATHER_DAILY_OFF) return module.exports;
    arm();
    return module.exports;
}

function validTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t));
    return m && +m[1] <= 23 && +m[2] <= 59 ? `${pad2(+m[1])}:${m[2]}` : null;
}

/** { enabled, time, places } as stored (places without a usable workspace / coordinates left out). */
function getSettings() {
    const s = settings();
    return { enabled: s.enabled, time: `${pad2(s.hour)}:${pad2(s.minute)}`, places: s.places.map((p) => ({ workspace: String(p.workspace), name: String(p.name || ''), lat: Number(p.lat), lon: Number(p.lon) })) };
}

function persist(next) {
    const cm = gr && gr.configManager;
    if (!cm) throw new Error('config manager not ready');
    cm.updateConfigValue('config', 'weatherDaily', next);
}

/**
 * Upsert (on !== false) or remove (on === false) the place of a workspace (one per workspace), optional time "HH:MM".
 * Throws an Error with a message on bad input. Saves the config and re-arms the timer.
 */
function setPlace(input) {
    const m = input || {};
    const workspace = typeof m.workspace === 'string' ? m.workspace.trim() : '';
    if (!workspace || workspace.length > 200) throw new Error('workspace must be a non-empty string of at most 200 characters');
    let time = null;
    if (m.time != null && m.time !== '') {
        time = validTime(m.time);
        if (!time) throw new Error('time must be HH:MM');
    }
    const cur = getSettings();
    let places = cur.places.filter((p) => p.workspace !== workspace);
    if (m.on !== false) {
        const lat = Number(m.lat);
        const lon = Number(m.lon);
        if (m.lat == null || m.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('lat / lon out of range');
        const name = String(m.name == null ? '' : m.name).trim().slice(0, 200);
        places = cur.places.map((p) => (p.workspace === workspace ? { workspace, name, lat, lon } : p));
        if (!cur.places.some((p) => p.workspace === workspace)) places.push({ workspace, name, lat, lon });
    }
    persist({ enabled: places.length > 0, time: time || cur.time, places });
    rearm();
    return getSettings();
}

function rearm() { arm(); return status(); }

function stop() { if (timer) clearTimeout(timer); timer = null; }
function status() { return { armed: !!timer, nextAt: settings().enabled ? nextRunAt() : null, lastRun }; }

module.exports = { start, stop, rearm, status, runNow, nextRunAt, briefFor, getSettings, setPlace };
