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
    try { cfg = (gr && gr.config && gr.config.weatherDaily) || {}; } catch (_e) { cfg = {}; }
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

function briefFor(place, fc, date) {
    const cur = (fc && fc.current) || {};
    const today = (fc && fc.daily && fc.daily[0]) || {};
    const season = seasonOf(date.getMonth(), Number(place.lat));
    const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    return [
        `Daily weather picture (#1126) for the workspace "${place.workspace}".`,
        `Place: ${place.name || `${place.lat}, ${place.lon}`}. Day: ${day} (${season}).`,
        `Conditions now: ${cur.condition || cur.conditionText || 'unknown'}, ${cur.tempC != null ? cur.tempC + ' C' : (cur.temperatureC != null ? cur.temperatureC + ' C' : 'temperature unknown')}${cur.isDay === false ? ', night' : ', daytime'}.`,
        today.maxC != null || today.hiC != null ? `Today: high ${today.maxC ?? today.hiC} C, low ${today.minC ?? today.loC ?? '?'} C.` : '',
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

async function runNow() {
    const now = new Date();
    const out = [];
    for (const place of settings().places) {
        try { out.push(await runPlace(place, now)); } catch (e) { out.push({ workspace: place.workspace, error: e.message }); console.warn(`[weatherDaily] ${place.workspace}: ${e.message}`); }
    }
    lastRun = { at: now.getTime(), results: out };
    return lastRun;
}

function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!settings().enabled) return;
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

function stop() { if (timer) clearTimeout(timer); timer = null; }
function status() { return { armed: !!timer, nextAt: settings().enabled ? nextRunAt() : null, lastRun }; }

module.exports = { start, stop, status, runNow, nextRunAt, briefFor };
