'use strict';

// Daily weather pictures per workspace (#1126). Config weatherDaily:
//   { enabled: true, time: "07:30", places: [{ workspace: "<id|name>", name, lat, lon }] }
// Once a day, for each place: the forecast is read (weatherService), a context brief (place, weekday, season and
// conditions in words; no readings, so none end up in the picture prompt: dynamic generation resolves them for the
// place's coordinates) is built and a Yozora chat is started to draw one picture with generate_image
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
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

// readings as words: the drawing session is given no number it could paste into the picture prompt
const below = (v, steps, last) => (steps.find(([limit]) => v < limit) || [0, last])[1];
const tempWord = (c) => below(c, [[0, 'freezing'], [8, 'cold'], [15, 'cool'], [21, 'mild'], [27, 'warm']], 'hot');
const cloudWord = (pct) => below(pct, [[25, 'clear sky'], [55, 'some cloud'], [85, 'mostly cloudy']], 'overcast');
const windWord = (kmh) => below(kmh, [[6, 'still air'], [20, 'light wind'], [39, 'breezy'], [62, 'strong wind']], 'gale');

/** The conditions in words, for the session's own understanding. */
function conditionWords(cur, today) {
    const words = [];
    if (cur.text) words.push(String(cur.text).toLowerCase());
    if (num(cur.tempC) != null) words.push(tempWord(Number(cur.tempC)));
    if (num(cur.cloud) != null) words.push(cloudWord(Number(cur.cloud)));
    if (num(cur.windKmh) != null) words.push(windWord(Number(cur.windKmh)));
    if (num(cur.humidity) != null && cur.humidity >= 80) words.push('humid');
    if (num(cur.visibilityM) != null && cur.visibilityM < 5000) words.push('poor visibility');
    if (cur.isDay != null) words.push(cur.isDay === false ? 'night' : 'daylight');
    if (today.text) words.push(`${String(today.text).toLowerCase()} over the day`);
    if (num(today.rain) != null && today.rain >= 25) words.push(today.rain >= 60 ? 'rain likely later' : 'a chance of rain later');
    return [...new Set(words)];
}

function briefFor(place, fc, date) {
    const cur = (fc && fc.current) || {};
    const today = (fc && Array.isArray(fc.daily) && fc.daily[0]) || {};
    const clock = placeClock(fc, date);
    const season = seasonOf(clock.m, Number(place.lat));
    const words = conditionWords(cur, today);
    const name = String(place.name || '').trim();
    // longitude first: compileContext reads location as LONG_LAT
    const location = `${Number(place.lon)}_${Number(place.lat)}`;
    return [
        `Daily weather picture for the workspace "${place.workspace}".`,
        name ? `Place: ${name}.` : 'Place: unnamed. Its coordinates are only for the generate call: do not write them in the prompt.',
        `For your understanding only, never to be pasted into the prompt: season ${season}; day ${WEEKDAYS[clock.wd]}; conditions: ${words.length ? words.join(', ') : 'unknown'}.`,
        'Draw ONE picture of this place as it is now.',
        'Write the prompt as a present-tense scene of the place with no numbers, no units, no weekday and no forecast readout. The light, the season and the weather come from the dynamic generation expanders, so the prompt carries !dg_time, !dg_season, !dg_weather.',
        `Prompt shape (you may enrich the scenery of the place itself): landscape${name ? ` of ${name}` : ''}, !dg_time, !dg_season, !dg_weather, atmospheric, detailed scenery`,
        `Call generate_image with workspace "${place.workspace}", normal resolution, a single print (leave n out), and this dynamicGeneration so the server resolves the real conditions for this place:`,
        `dynamicGeneration: { enabled: true, tod: true, weather: true, season: true, location: "${location}" }`,
        'Do not mail or comment; the picture landing in the workspace is the result.'
    ].join('\n');
}

// appended when the forecast could not be read for the brief
const NO_FORECAST_NOTE = 'The forecast could not be read: say so in one line. Keep the same prompt shape and generate call (the server resolves the conditions itself) and paste no readout into the prompt.';

async function runPlace(place, now) {
    const weatherService = require('./weatherService');
    const { startDirectorSession } = require('./directorStart');
    const iso = now.toISOString().slice(0, 10);
    let fc = null;
    try { fc = await weatherService.getForecast(Number(place.lat), Number(place.lon)); } catch (e) { fc = null; }
    const prompt = briefFor(place, fc, now) + (fc ? '' : `\n(${NO_FORECAST_NOTE})`);
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

module.exports = { start, stop, rearm, status, runNow, nextRunAt, briefFor, getSettings, setPlace, NO_FORECAST_NOTE };
