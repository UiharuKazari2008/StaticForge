'use strict';

/**
 * Traffic (Yozora #795): the commute service behind Melaton Mobile's Traffic app and its Today item.
 * This module is the only code that calls the traffic hosts; new traffic code goes through it.
 *
 * Providers (Dreamscape CardSpace > Service keys):
 *   googlemaps  Google Routes API computeRoutes (traffic-aware, so billed as "Compute Routes Pro", which
 *               has a monthly free allowance). Drive times, alternatives, the preferred route through
 *               via-waypoints, slowdowns from speedReadingIntervals, departures in the future.
 *   waze        OpenWeb Ninja's Waze API (through RapidAPI, or direct when the key's Host field is
 *               api.openwebninja.com): alerts and jams in the route's box (police = speed traps,
 *               accidents, hazards, closures, jams). Its free plan is 100 requests a month, so it is
 *               asked at most once per 10 minutes per direction and only within its budget. With no
 *               Google key, Waze's driving directions give the drive times.
 * Both are counted per calendar month against config traffic.budgets ({ google, waze }); a provider
 * past its budget is skipped until the month turns (the app shows what is left).
 *
 * Settings: config `traffic` (admins save):
 *   home / work   { address, label?, lat?, lon? }  an address (Google geocodes it) or coordinates
 *   area          "Rapid City, SD"  added to the preferred route's street pairs
 *   streets       ['I-90 E', 'Omaha St', ...]  the preferred route from Home to Work, in order
 *   leaveHome / leaveWork  'HH:MM' (24 h) or ''   when the commute starts
 *   days          [1..5]  weekdays (0 Sunday) the leave times apply
 *   leadMin       minutes before the leave time the report is sent (default 10)
 *   betterMin     an alternative this much faster is offered (default 5)
 *   waitMin       waiting must save this much to be suggested (default 8)
 *   advisorMax    the leave advisor looks this far ahead (default 90)
 *   notify        reports at the leave times (default true)
 *   timeZone      IANA zone of the leave times (default the server's)
 *
 * Reports (check): { direction, at, provider, from, to, preferred, routes[], fastest, better,
 * slowdowns[], alerts[], traps[], jams[], level, summary, errors[] }. A route: { id, summary, via,
 * durationSec, staticSec, delaySec, distanceM, coverage, streetsHit[], segments[] (fractions along the
 * route with speed NORMAL / SLOW / TRAFFIC_JAM), preferred, fastest }.
 *
 * Scheduler (every minute): on a set weekday at leave time minus leadMin it checks that direction and
 * broadcasts traffic_report { kind: 'scheduled', report, advice? } to admin clients. The way home also
 * gets the leave advisor; when it says wait, a second look at the suggested time sends
 * traffic_report { kind: 'go' }. Every check broadcasts traffic_updated { direction, report }.
 */

const fs = require('fs');
const path = require('path');

const MIN = 60 * 1000;
const GOOGLE_ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const WAZE_RAPID_HOST = 'waze.p.rapidapi.com';
const DIRECTIONS = ['work', 'home'];
const DIRECTION_LABEL = { work: 'To Work', home: 'To Home' };
const DEFAULTS = { leadMin: 10, betterMin: 5, waitMin: 8, advisorMax: 90, notify: true, days: [1, 2, 3, 4, 5], budgets: { google: 4500, waze: 90 } };
const ROUTE_TTL = 3 * MIN;
const WAZE_TTL = 10 * MIN;
const CORRIDOR_M = 150;
const TRAP_CORRIDOR_M = 200;
const ADVISOR_STEPS = [0, 15, 30, 45, 60, 90, 120];
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const USAGE_FILE = process.env.TRAFFIC_USAGE_FILE || path.join(CACHE_DIR, 'traffic-usage.json');
const LATEST_FILE = process.env.TRAFFIC_LATEST_FILE || path.join(CACHE_DIR, 'traffic-latest.json');

class TrafficError extends Error {
    constructor(message, code, status) {
        super(message);
        this.code = code || 'TRAFFIC_ERROR';
        if (status) this.status = status;
    }
}

let gr = null;
// test seam: fetch stand-in (scripts/test-traffic-service.js)
let fetchImpl = (...args) => fetch(...args);

function bind(globalResources) {
    if (globalResources && !gr) gr = globalResources;
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

function cleanPlace(p) {
    if (!p || typeof p !== 'object') return null;
    const out = {};
    const address = String(p.address || '').trim().slice(0, 200);
    if (address) out.address = address;
    const label = String(p.label || '').trim().slice(0, 40);
    if (label) out.label = label;
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
        out.lat = Math.round(lat * 1e6) / 1e6;
        out.lon = Math.round(lon * 1e6) / 1e6;
    }
    return out.address || out.lat != null ? out : null;
}

function cleanTime(v) {
    const m = HHMM.exec(String(v || '').trim());
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function clampInt(v, lo, hi, def) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
}

/** The saved settings with defaults filled in. */
function getSettings() {
    const t = config('traffic', {}) || {};
    const budgets = Object.assign({}, DEFAULTS.budgets, t.budgets || {});
    return {
        home: cleanPlace(t.home),
        work: cleanPlace(t.work),
        area: String(t.area || '').trim(),
        streets: Array.isArray(t.streets) ? t.streets.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 12) : [],
        leaveHome: cleanTime(t.leaveHome),
        leaveWork: cleanTime(t.leaveWork),
        days: Array.isArray(t.days) ? t.days.map(Number).filter((d) => d >= 0 && d <= 6) : DEFAULTS.days.slice(),
        leadMin: clampInt(t.leadMin, 0, 120, DEFAULTS.leadMin),
        betterMin: clampInt(t.betterMin, 1, 60, DEFAULTS.betterMin),
        waitMin: clampInt(t.waitMin, 1, 60, DEFAULTS.waitMin),
        advisorMax: clampInt(t.advisorMax, 15, 120, DEFAULTS.advisorMax),
        notify: t.notify !== false,
        timeZone: validZone(t.timeZone) ? t.timeZone : '',
        budgets: { google: clampInt(budgets.google, 0, 100000, DEFAULTS.budgets.google), waze: clampInt(budgets.waze, 0, 100000, DEFAULTS.budgets.waze) }
    };
}

function validZone(z) {
    if (!z || typeof z !== 'string') return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (_e) { return false; }
}

/** Merge a change into the settings and save it (admins; the handler checks). */
async function saveSettings(next = {}) {
    if (!gr) throw new TrafficError('Traffic service is not ready', 'NOT_READY');
    const cur = Object.assign({}, config('traffic', {}) || {});
    const out = Object.assign({}, cur);
    ['home', 'work'].forEach((id) => {
        if (!(id in next)) return;
        if (next[id] === null) { delete out[id]; return; }
        const p = cleanPlace(next[id]);
        if (!p) throw new TrafficError(`${id === 'home' ? 'Home' : 'Work'} needs an address`, 'BAD_PLACE');
        out[id] = p;
    });
    if ('area' in next) out.area = String(next.area || '').trim().slice(0, 80);
    if ('streets' in next) out.streets = (Array.isArray(next.streets) ? next.streets : String(next.streets || '').split(/\n|;/)).map((s) => String(s || '').trim().slice(0, 80)).filter(Boolean).slice(0, 12);
    ['leaveHome', 'leaveWork'].forEach((k) => {
        if (!(k in next)) return;
        const t = cleanTime(next[k]);
        if (next[k] && !t) throw new TrafficError('Leave times are HH:MM (24 hour)', 'BAD_TIME');
        out[k] = t;
    });
    if ('days' in next) out.days = [...new Set((Array.isArray(next.days) ? next.days : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if ('leadMin' in next) out.leadMin = clampInt(next.leadMin, 0, 120, DEFAULTS.leadMin);
    if ('betterMin' in next) out.betterMin = clampInt(next.betterMin, 1, 60, DEFAULTS.betterMin);
    if ('waitMin' in next) out.waitMin = clampInt(next.waitMin, 1, 60, DEFAULTS.waitMin);
    if ('advisorMax' in next) out.advisorMax = clampInt(next.advisorMax, 15, 120, DEFAULTS.advisorMax);
    if ('notify' in next) out.notify = next.notify !== false;
    if ('timeZone' in next) out.timeZone = validZone(next.timeZone) ? next.timeZone : '';
    if (next.budgets && typeof next.budgets === 'object') {
        out.budgets = Object.assign({}, cur.budgets || {});
        if ('google' in next.budgets) out.budgets.google = clampInt(next.budgets.google, 0, 100000, DEFAULTS.budgets.google);
        if ('waze' in next.budgets) out.budgets.waze = clampInt(next.budgets.waze, 0, 100000, DEFAULTS.budgets.waze);
    }
    const saved = gr.modifyConfig('config').assign(['traffic'], out);
    if (saved && typeof saved.then === 'function') await saved;
    // a changed route or place makes the old reports wrong
    routeCache.clear();
    const settings = getSettings();
    broadcast({ type: 'traffic_settings_changed', data: { settings } });
    return settings;
}

// ------------------------------------------------------------------------------------------ accounts and budgets

function serviceKey(service) {
    try {
        const manager = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        if (!manager) return null;
        return manager.getServiceKeys(service)[manager.getSelectedIndex(service)] || null;
    } catch (_e) {
        return null;
    }
}

function googleKey() {
    const k = serviceKey('googlemaps');
    return k && k.apiKey ? String(k.apiKey).trim() : null;
}

function wazeAccount() {
    const k = serviceKey('waze');
    if (!k || !k.apiKey) return null;
    const host = String(k.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || WAZE_RAPID_HOST;
    return { key: String(k.apiKey).trim(), host };
}

let usageState = null;

function monthKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function usage() {
    const month = monthKey();
    if (!usageState) {
        try { usageState = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch (_e) { usageState = null; }
    }
    if (!usageState || usageState.month !== month) usageState = { month, google: 0, waze: 0 };
    return usageState;
}

function spend(provider) {
    const u = usage();
    u[provider] = (u[provider] || 0) + 1;
    try {
        fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
        fs.writeFileSync(`${USAGE_FILE}.tmp`, JSON.stringify(u));
        fs.renameSync(`${USAGE_FILE}.tmp`, USAGE_FILE);
    } catch (_e) { /* counted in memory */ }
}

function canSpend(provider, n = 1) {
    const budget = getSettings().budgets[provider];
    return (usage()[provider] || 0) + n <= budget;
}

/** { google: { configured, used, budget, left }, waze: { ... }, month } for the app's About / Settings. */
function providers() {
    const s = getSettings();
    const u = usage();
    const one = (id, configured) => ({ configured, used: u[id] || 0, budget: s.budgets[id], left: Math.max(0, s.budgets[id] - (u[id] || 0)) });
    return { month: u.month, google: one('google', !!googleKey()), waze: one('waze', !!wazeAccount()) };
}

// ------------------------------------------------------------------------------------------ geometry

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function distanceM(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Google's encoded polyline as [{ lat, lon }]. */
function decodePolyline(str) {
    const out = [];
    let i = 0;
    let lat = 0;
    let lon = 0;
    const s = String(str || '');
    while (i < s.length) {
        for (const which of [0, 1]) {
            let result = 0;
            let shift = 0;
            let b;
            do {
                b = s.charCodeAt(i++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20 && i <= s.length);
            const d = result & 1 ? ~(result >> 1) : result >> 1;
            if (which === 0) lat += d; else lon += d;
        }
        out.push({ lat: lat / 1e5, lon: lon / 1e5 });
    }
    return out;
}

/** Cumulative distance (m) at every point of a line. */
function cumulative(points) {
    const out = [0];
    for (let i = 1; i < points.length; i++) out.push(out[i - 1] + distanceM(points[i - 1], points[i]));
    return out;
}

/**
 * Where a point lies against a line: { distM (to the line), alongM (from its start) }. Local flat
 * projection around the point (fine at commute scale).
 */
function locate(points, cum, p) {
    if (!points.length) return { distM: Infinity, alongM: 0 };
    const kx = Math.cos(rad(p.lat)) * R * Math.PI / 180;
    const ky = R * Math.PI / 180;
    let best = { distM: Infinity, alongM: 0 };
    for (let i = 0; i < points.length - 1; i++) {
        const ax = (points[i].lon - p.lon) * kx;
        const ay = (points[i].lat - p.lat) * ky;
        const bx = (points[i + 1].lon - p.lon) * kx;
        const by = (points[i + 1].lat - p.lat) * ky;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        const d = Math.sqrt(cx * cx + cy * cy);
        if (d < best.distM) best = { distM: d, alongM: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
    if (points.length === 1) best = { distM: distanceM(points[0], p), alongM: 0 };
    return best;
}

function bboxOf(points, padDeg = 0.01) {
    let n = -90;
    let s = 90;
    let e = -180;
    let w = 180;
    points.forEach((p) => {
        n = Math.max(n, p.lat); s = Math.min(s, p.lat);
        e = Math.max(e, p.lon); w = Math.min(w, p.lon);
    });
    return { n: n + padDeg, s: s - padDeg, e: e + padDeg, w: w - padDeg };
}

// ------------------------------------------------------------------------------------------ street names

const ABBREV = [
    [/\binterstate\b|\bi\s*-\s*|\bi(?=\d)/g, 'i'],
    [/\bus\s*-?\s*(?=\d)|\bu\.s\.\s*(?=\d)|\bus highway\s*/g, 'us'],
    [/\bstate (route|highway)\s*|\bsr\s*-?\s*(?=\d)|\bhwy\s*-?\s*(?=\d)/g, 'hwy'],
    [/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\broad\b/g, 'rd'], [/\bboulevard\b/g, 'blvd'],
    [/\bdrive\b/g, 'dr'], [/\blane\b/g, 'ln'], [/\bparkway\b/g, 'pkwy'], [/\bhighway\b/g, 'hwy'],
    [/\bexpressway\b/g, 'expy'], [/\bfreeway\b/g, 'fwy'], [/\bcourt\b/g, 'ct'], [/\bplace\b/g, 'pl'],
    [/\bterrace\b/g, 'ter'], [/\bcircle\b/g, 'cir'], [/\bturnpike\b/g, 'tpke'], [/\bmount\b/g, 'mt'],
    [/\bsaint\b/g, 'st'], [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\beast\b/g, 'e'], [/\bwest\b/g, 'w']
];

/** A street name in one comparable spelling ("Interstate 90 East" -> "i90 e", "Main Street" -> "main st"). */
function normStreet(name) {
    let s = ` ${String(name || '').toLowerCase().replace(/[.,]/g, ' ')} `;
    ABBREV.forEach(([re, to]) => { s = s.replace(re, `${to}`); });
    s = s.replace(/\b(i|us|hwy)\s+(\d+)/g, '$1$2').replace(/\s+/g, ' ').trim();
    return s;
}

/** The core of a name for matching: without a trailing direction (I-90 E matches I-90 W's text too often, so keep the number). */
function streetCore(name) {
    return normStreet(name).replace(/\s+(n|s|e|w|ne|nw|se|sw)$/, '').trim();
}

/** The street an instruction moves onto ("Turn left onto Main St" -> "Main St"), or ''. */
function streetOfInstruction(text) {
    const t = String(text || '').replace(/<[^>]+>/g, ' ');
    const m = /\b(?:onto|on|to stay on|toward|via|for)\s+([^,.\n]+?)(?:\s*(?:\/|,|\.|$|\bthen\b|\btoward\b))/i.exec(t);
    return m ? m[1].trim() : '';
}

/** Which of the streets a route uses: { hit: [names], coverage 0..1 }. */
function matchStreets(routeText, streets) {
    if (!streets.length) return { hit: [], coverage: 0 };
    const hay = ` ${normStreet(routeText)} `;
    const hit = streets.filter((st) => {
        const core = streetCore(st);
        return core && new RegExp(`(^|[^a-z0-9])${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay);
    });
    return { hit, coverage: hit.length / streets.length };
}

/** Via waypoints for the preferred route: the intersections of each street with the next. */
function viaWaypoints(streets, area) {
    if (streets.length < 2) return streets.length === 1 && area ? [`${streets[0]}, ${area}`] : [];
    const out = [];
    for (let i = 0; i < streets.length - 1; i++) out.push(`${streets[i]} & ${streets[i + 1]}${area ? `, ${area}` : ''}`);
    return out;
}

// ------------------------------------------------------------------------------------------ HTTP

async function getJson(url, opts = {}) {
    let res;
    try {
        res = await fetchImpl(url, Object.assign({ signal: AbortSignal.timeout(opts.timeout || 15000) }, opts.init || {}));
    } catch (error) {
        throw new TrafficError(`Could not reach ${new URL(url).host} (${error.name === 'TimeoutError' ? 'timed out' : error.message})`, 'UNREACHABLE');
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_e) { body = null; }
    if (!res.ok) {
        const msg = (body && body.error && (body.error.message || body.error.status)) || (body && body.message) || `HTTP ${res.status}`;
        const code = res.status === 401 || res.status === 403 ? 'AUTH_FAILED' : res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
        throw new TrafficError(String(msg).slice(0, 300), code, res.status);
    }
    return body;
}

// ------------------------------------------------------------------------------------------ Google Routes

const GOOGLE_FIELDS = [
    'routes.duration', 'routes.staticDuration', 'routes.distanceMeters', 'routes.description', 'routes.routeLabels',
    'routes.polyline.encodedPolyline', 'routes.travelAdvisory.speedReadingIntervals', 'routes.warnings',
    'routes.legs.steps.distanceMeters', 'routes.legs.steps.navigationInstruction.instructions', 'routes.legs.steps.localizedValues'
].join(',');

function waypointOf(place) {
    if (Number.isFinite(place.lat) && Number.isFinite(place.lon) && !place.address) return { location: { latLng: { latitude: place.lat, longitude: place.lon } } };
    if (place.address) return { address: place.address };
    return { location: { latLng: { latitude: place.lat, longitude: place.lon } } };
}

const secondsOf = (d) => {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d || ''));
    return m ? Math.round(Number(m[1])) : null;
};

/** One computeRoutes call: [{ ...route }] normalised (see the header), or a TrafficError. */
async function googleRoutes(from, to, { via = [], alternatives = false, departAt = null } = {}) {
    const key = googleKey();
    if (!key) throw new TrafficError('No Google Maps key', 'NO_ACCOUNT');
    if (!canSpend('google')) throw new TrafficError('This month\'s Google Routes budget is used up', 'BUDGET');
    const body = {
        origin: waypointOf(from),
        destination: waypointOf(to),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        extraComputations: ['TRAFFIC_ON_POLYLINE'],
        units: 'IMPERIAL',
        languageCode: 'en-US'
    };
    if (via.length) body.intermediates = via.map((address) => ({ address, via: true }));
    else if (alternatives) body.computeAlternativeRoutes = true;
    if (departAt && departAt > Date.now() + 30 * 1000) body.departureTime = new Date(departAt).toISOString();
    spend('google');
    const res = await getJson(GOOGLE_ROUTES, {
        timeout: 15000,
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELDS },
            body: JSON.stringify(body)
        }
    });
    const routes = (res && Array.isArray(res.routes) ? res.routes : []).map(normaliseGoogle).filter(Boolean);
    if (!routes.length) throw new TrafficError(via.length ? 'Google found no route through the preferred streets' : 'Google found no route', 'NO_ROUTE');
    return routes;
}

function normaliseGoogle(r) {
    if (!r) return null;
    const points = decodePolyline(r.polyline && r.polyline.encodedPolyline);
    const cum = cumulative(points);
    const total = cum[cum.length - 1] || r.distanceMeters || 1;
    const steps = [];
    let at = 0;
    (r.legs || []).forEach((leg) => (leg.steps || []).forEach((st) => {
        const text = (st.navigationInstruction && st.navigationInstruction.instructions) || '';
        const len = Number(st.distanceMeters) || 0;
        steps.push({ text, street: streetOfInstruction(text), fromM: at, toM: at + len });
        at += len;
    }));
    // fill streets: a step without "onto X" keeps the previous street
    let last = '';
    steps.forEach((s) => { if (s.street) last = s.street; else s.street = last; });
    const segments = [];
    const intervals = (r.travelAdvisory && r.travelAdvisory.speedReadingIntervals) || [];
    intervals.forEach((iv) => {
        const a = Number(iv.startPolylinePointIndex) || 0;
        const b = Number(iv.endPolylinePointIndex) || 0;
        if (b <= a || !cum.length) return;
        segments.push({ from: cum[Math.min(a, cum.length - 1)] / total, to: cum[Math.min(b, cum.length - 1)] / total, speed: iv.speed || 'NORMAL' });
    });
    const durationSec = secondsOf(r.duration);
    const staticSec = secondsOf(r.staticDuration);
    return {
        summary: r.description || '',
        labels: r.routeLabels || [],
        durationSec,
        staticSec,
        delaySec: durationSec != null && staticSec != null ? Math.max(0, durationSec - staticSec) : null,
        distanceM: Number(r.distanceMeters) || Math.round(total),
        warnings: r.warnings || [],
        steps,
        segments,
        _points: points,
        _cum: cum
    };
}

// ------------------------------------------------------------------------------------------ Waze

function wazeRequest(pathAndQuery) {
    const a = wazeAccount();
    if (!a) throw new TrafficError('No Waze key', 'NO_ACCOUNT');
    if (!canSpend('waze')) throw new TrafficError('This month\'s Waze budget is used up', 'BUDGET');
    const rapid = /rapidapi\.com$/.test(a.host);
    const url = rapid ? `https://${a.host}${pathAndQuery}` : `https://${a.host}/waze${pathAndQuery}`;
    const headers = rapid ? { 'X-RapidAPI-Key': a.key, 'X-RapidAPI-Host': a.host } : { 'x-api-key': a.key };
    spend('waze');
    return getJson(url, { timeout: 20000, init: { headers } });
}

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

function pointOf(o) {
    if (!o) return null;
    const lat = num(o.latitude != null ? o.latitude : (o.lat != null ? o.lat : (o.location && (o.location.y != null ? o.location.y : o.location.lat))));
    const lon = num(o.longitude != null ? o.longitude : (o.lon != null ? o.lon : (o.lng != null ? o.lng : (o.location && (o.location.x != null ? o.location.x : (o.location.lon != null ? o.location.lon : o.location.lng))))));
    return lat != null && lon != null ? { lat, lon } : null;
}

function wazeTime(v) {
    if (v == null) return null;
    if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString();
    const t = Date.parse(String(v).replace(' ', 'T'));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Waze alerts and jams in a box: { alerts: [...], jams: [...] } normalised. */
async function wazeArea(box) {
    const q = `/alerts-and-jams?top_right=${box.n.toFixed(5)},${box.e.toFixed(5)}&bottom_left=${box.s.toFixed(5)},${box.w.toFixed(5)}&max_alerts=200&max_jams=100`;
    const res = await wazeRequest(q);
    const data = (res && (res.data || res)) || {};
    const alerts = (Array.isArray(data.alerts) ? data.alerts : []).map((a) => {
        const p = pointOf(a);
        if (!p) return null;
        return {
            id: String(a.alert_id || a.uuid || a.id || `${p.lat},${p.lon},${a.type}`),
            type: String(a.type || '').toUpperCase(),
            subtype: String(a.subtype || '').toUpperCase(),
            street: a.street || '',
            city: a.city || '',
            description: a.description || a.reportDescription || '',
            reportedAt: wazeTime(a.publish_datetime_utc || a.pubMillis || a.publish_time),
            thumbsUp: num(a.num_thumbs_up != null ? a.num_thumbs_up : a.nThumbsUp) || 0,
            reliability: num(a.alert_reliability != null ? a.alert_reliability : a.reliability),
            confidence: num(a.alert_confidence != null ? a.alert_confidence : a.confidence),
            lat: p.lat,
            lon: p.lon
        };
    }).filter(Boolean);
    const jams = (Array.isArray(data.jams) ? data.jams : []).map((j) => {
        const line = (j.line_coordinates || j.line || []).map(pointOf).filter(Boolean);
        if (!line.length) return null;
        return {
            id: String(j.jam_id || j.uuid || j.id || ''),
            level: num(j.level) || 0,
            street: j.street || '',
            city: j.city || '',
            speedKmh: num(j.speed_kmh != null ? j.speed_kmh : (j.speedKMH != null ? j.speedKMH : j.speed)),
            lengthM: num(j.length_m != null ? j.length_m : j.length),
            delaySec: num(j.delay_seconds != null ? j.delay_seconds : j.delay),
            cause: j.block_alert_type || j.blockingAlertType || '',
            causeText: j.block_alert_description || j.blockDescription || '',
            updatedAt: wazeTime(j.update_datetime_utc || j.updateMillis || j.publish_datetime_utc),
            line
        };
    }).filter(Boolean);
    return { alerts, jams };
}

/** Waze's own driving directions (no Google key): routes like googleRoutes, without slowdown segments. */
async function wazeRoutes(from, to) {
    if (!Number.isFinite(from.lat) || !Number.isFinite(to.lat)) throw new TrafficError('Waze needs Home and Work as coordinates (or a Google Maps key)', 'NO_COORDS');
    const res = await wazeRequest(`/driving-directions?source_coordinates=${from.lat},${from.lon}&destination_coordinates=${to.lat},${to.lon}&return_route_coordinates=true`);
    const list = (res && (Array.isArray(res.data) ? res.data : (res.data && res.data.routes))) || [];
    const routes = list.map((r) => {
        const points = (r.route_coordinates || r.coordinates || []).map(pointOf).filter(Boolean);
        const cum = cumulative(points);
        const durationSec = num(r.duration_seconds != null ? r.duration_seconds : r.duration);
        return {
            summary: r.route_name || r.name || '',
            labels: [],
            durationSec: durationSec != null ? Math.round(durationSec) : null,
            staticSec: null,
            delaySec: null,
            distanceM: num(r.length_meters != null ? r.length_meters : r.distance) || Math.round(cum[cum.length - 1] || 0),
            warnings: r.is_toll ? ['Toll road'] : [],
            steps: [{ text: r.route_name || '', street: '', fromM: 0, toM: cum[cum.length - 1] || 0 }],
            segments: [],
            _points: points,
            _cum: cum
        };
    }).filter((r) => r.durationSec != null);
    if (!routes.length) throw new TrafficError('Waze found no route', 'NO_ROUTE');
    return routes;
}

// ------------------------------------------------------------------------------------------ the check

const routeCache = new Map(); // key -> { at, value | promise }
const latest = {};
let latestLoaded = false;

function loadLatest() {
    if (latestLoaded) return;
    latestLoaded = true;
    try {
        const saved = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
        DIRECTIONS.forEach((d) => { if (saved && saved[d]) latest[d] = saved[d]; });
    } catch (_e) { /* none yet */ }
}

function saveLatest() {
    try {
        fs.mkdirSync(path.dirname(LATEST_FILE), { recursive: true });
        fs.writeFileSync(`${LATEST_FILE}.tmp`, JSON.stringify(latest));
        fs.renameSync(`${LATEST_FILE}.tmp`, LATEST_FILE);
    } catch (_e) { /* kept in memory */ }
}

async function cachedCall(key, ttl, fn, force) {
    const hit = routeCache.get(key);
    if (hit && !force && Date.now() - hit.at < ttl) return hit.value;
    if (hit && hit.pending) return hit.pending;
    const pending = fn();
    routeCache.set(key, Object.assign({}, hit || {}, { pending }));
    try {
        const value = await pending;
        routeCache.set(key, { at: Date.now(), value });
        return value;
    } catch (error) {
        if (hit && hit.value) { routeCache.set(key, hit); }
        else routeCache.delete(key);
        throw error;
    }
}

function endpoints(direction, s) {
    return direction === 'work' ? { from: s.home, to: s.work } : { from: s.work, to: s.home };
}

function placeName(p, fallback) {
    return (p && (p.label || p.address)) || fallback;
}

function slowdownsOf(route) {
    if (!route || !route.segments.length) return [];
    const total = route.distanceM || 1;
    const out = [];
    let cur = null;
    route.segments.forEach((sg) => {
        if (sg.speed === 'NORMAL') { cur = null; return; }
        if (cur && Math.abs(cur.to - sg.from) < 1e-6) {
            cur.to = sg.to;
            if (sg.speed === 'TRAFFIC_JAM') cur.speed = 'TRAFFIC_JAM';
        } else {
            cur = { from: sg.from, to: sg.to, speed: sg.speed };
            out.push(cur);
        }
    });
    return out.map((sd) => {
        const fromM = sd.from * total;
        const step = route.steps.find((st) => fromM >= st.fromM && fromM < st.toM) || route.steps[route.steps.length - 1];
        const lengthM = Math.round((sd.to - sd.from) * total);
        return { from: sd.from, to: sd.to, speed: sd.speed, lengthM, street: (step && step.street) || '', major: sd.speed === 'TRAFFIC_JAM' && lengthM >= 400 };
    }).filter((sd) => sd.lengthM >= 100);
}

const ALERT_KIND = {
    POLICE: 'trap', ACCIDENT: 'accident', HAZARD: 'hazard', ROAD_CLOSED: 'closure', JAM: 'jam', WEATHERHAZARD: 'hazard', CONSTRUCTION: 'construction'
};

function alertKind(a) {
    if (/CONSTRUCTION/.test(a.subtype)) return 'construction';
    return ALERT_KIND[a.type] || 'hazard';
}

function alertLabel(a) {
    const kind = alertKind(a);
    const sub = a.subtype.replace(/^(HAZARD_ON_ROAD_|HAZARD_ON_SHOULDER_|HAZARD_WEATHER_|ACCIDENT_|POLICE_|ROAD_CLOSED_|JAM_)/, '').replace(/_/g, ' ').toLowerCase();
    const base = { trap: 'Speed trap', accident: 'Accident', hazard: 'Hazard', closure: 'Road closed', jam: 'Traffic jam', construction: 'Construction' }[kind];
    if (kind === 'trap') return /HIDING/.test(a.subtype) ? 'Speed trap (hidden)' : 'Speed trap';
    if (kind === 'accident') return /MAJOR/.test(a.subtype) ? 'Major accident' : 'Accident';
    return sub && !/^(hazard|accident|police|road closed|jam)$/.test(sub) ? `${base}: ${sub}` : base;
}

/** Waze alerts and jams on a route: { alerts, traps, jams } with positions along it. */
function onRoute(area, route) {
    const out = { alerts: [], traps: [], jams: [] };
    if (!area || !route || !route._points.length) return out;
    const total = route._cum[route._cum.length - 1] || 1;
    area.alerts.forEach((a) => {
        const kind = alertKind(a);
        if (kind === 'jam') return;
        const loc = locate(route._points, route._cum, a);
        if (loc.distM > (kind === 'trap' ? TRAP_CORRIDOR_M : CORRIDOR_M)) return;
        const row = {
            id: a.id, kind, label: alertLabel(a), street: a.street, city: a.city, description: a.description,
            reportedAt: a.reportedAt, thumbsUp: a.thumbsUp, reliability: a.reliability, at: Math.max(0, Math.min(1, loc.alongM / total)),
            lat: a.lat, lon: a.lon
        };
        (kind === 'trap' ? out.traps : out.alerts).push(row);
    });
    area.jams.forEach((j) => {
        let near = 0;
        let firstAlong = Infinity;
        j.line.forEach((p) => {
            const loc = locate(route._points, route._cum, p);
            if (loc.distM <= 60) { near++; firstAlong = Math.min(firstAlong, loc.alongM); }
        });
        if (near / j.line.length < 0.5) return;
        out.jams.push({
            id: j.id, level: j.level, street: j.street, speedKmh: j.speedKmh, lengthM: j.lengthM, delaySec: j.delaySec,
            cause: j.cause, causeText: j.causeText, updatedAt: j.updatedAt, at: Math.max(0, Math.min(1, firstAlong / total)), major: j.level >= 3
        });
    });
    const byAt = (a, b) => a.at - b.at;
    out.alerts.sort(byAt); out.traps.sort(byAt); out.jams.sort(byAt);
    return out;
}

function publicRoute(r, extra) {
    if (!r) return null;
    const out = Object.assign({}, r, extra || {});
    delete out._points;
    delete out._cum;
    out.steps = r.steps.map((s) => ({ text: s.text, street: s.street, fromM: Math.round(s.fromM), toM: Math.round(s.toM) }));
    // a thin line for the app's map strip: every n-th point
    const pts = r._points || [];
    const every = Math.max(1, Math.ceil(pts.length / 120));
    out.line = pts.filter((_, i) => i % every === 0 || i === pts.length - 1).map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]);
    return out;
}

const fmtMin = (sec) => `${Math.max(1, Math.round(sec / 60))} min`;

/** Read the routes and Waze for one direction and build the report (see the header). */
async function check(direction, { force = false } = {}) {
    if (!DIRECTIONS.includes(direction)) throw new TrafficError('direction is work or home', 'BAD_REQUEST');
    const s = getSettings();
    const { from, to } = endpoints(direction, s);
    if (!s.home || !s.work) throw new TrafficError('Set Home and Work first', 'NOT_SET');
    const google = !!googleKey();
    const waze = !!wazeAccount();
    if (!google && !waze) throw new TrafficError('Add a Google Maps or Waze key in Dreamscape CardSpace > Service keys', 'NO_ACCOUNT');
    const streets = direction === 'work' ? s.streets.slice() : s.streets.slice().reverse();
    const via = viaWaypoints(streets, s.area);
    const errors = [];
    const tag = `${direction}|${JSON.stringify([from, to, via])}`;
    let routes = [];
    let provider = google ? 'google' : 'waze';
    let viaRoute = null;
    if (google) {
        const [alts, pref] = await Promise.all([
            cachedCall(`g:alt:${tag}`, ROUTE_TTL, () => googleRoutes(from, to, { alternatives: true }), force).catch((e) => { errors.push(e.message); return []; }),
            via.length ? cachedCall(`g:via:${tag}`, ROUTE_TTL, () => googleRoutes(from, to, { via }), force).catch((e) => { errors.push(`Preferred route: ${e.message}`); return []; }) : Promise.resolve([])
        ]);
        routes = alts.slice();
        viaRoute = pref[0] || null;
    }
    if (!routes.length && !viaRoute && waze) {
        provider = 'waze';
        routes = await cachedCall(`w:dir:${tag}`, WAZE_TTL, () => wazeRoutes(from, to), force).catch((e) => { errors.push(e.message); return []; });
    }
    if (!routes.length && !viaRoute) {
        const err = new TrafficError(errors[0] || 'No route', 'NO_ROUTE');
        throw err;
    }
    // score: which alternative is the preferred one (street coverage), unless the via route exists
    const scored = routes.map((r) => {
        const text = [r.summary].concat(r.steps.map((st) => `${st.text} ${st.street}`)).join(' | ');
        const m = matchStreets(text, streets);
        return Object.assign(r, { coverage: m.coverage, streetsHit: m.hit });
    });
    if (viaRoute) {
        const text = [viaRoute.summary].concat(viaRoute.steps.map((st) => `${st.text} ${st.street}`)).join(' | ');
        const m = matchStreets(text, streets);
        Object.assign(viaRoute, { coverage: m.coverage, streetsHit: m.hit, viaPreferred: true });
        // the same road as an alternative: keep one (the via route, which follows the streets)
        const twin = scored.findIndex((r) => r.summary && r.summary === viaRoute.summary && Math.abs((r.distanceM || 0) - (viaRoute.distanceM || 0)) < 300);
        if (twin >= 0) scored.splice(twin, 1);
        scored.unshift(viaRoute);
    }
    let preferredIdx = 0;
    if (!viaRoute && streets.length) {
        let best = -1;
        scored.forEach((r, i) => { if (r.coverage > best) { best = r.coverage; preferredIdx = i; } });
    }
    let fastestIdx = 0;
    scored.forEach((r, i) => { if (r.durationSec != null && r.durationSec < scored[fastestIdx].durationSec) fastestIdx = i; });
    const preferred = scored[preferredIdx];

    // Waze on the preferred route, and on the faster one when it differs
    let area = null;
    if (waze) {
        const pts = scored[preferredIdx]._points.concat(fastestIdx !== preferredIdx ? scored[fastestIdx]._points : []);
        if (pts.length) {
            const box = bboxOf(pts, 0.008);
            const boxKey = `w:area:${direction}:${[box.n, box.s, box.e, box.w].map((v) => v.toFixed(2)).join(',')}`;
            area = await cachedCall(boxKey, WAZE_TTL, () => wazeArea(box), false).catch((e) => { errors.push(`Waze: ${e.message}`); return null; });
        }
    }
    const pw = onRoute(area, preferred);
    const slowdowns = slowdownsOf(preferred);
    scored.forEach((r, i) => {
        r.id = `r${i}`;
        r.preferred = i === preferredIdx;
        r.fastest = i === fastestIdx;
        if (!r.summary) r.summary = r.streetsHit && r.streetsHit.length ? r.streetsHit.join(', ') : (i === preferredIdx ? 'Preferred route' : `Route ${i + 1}`);
        const w = i === preferredIdx ? pw : onRoute(area, r);
        r.counts = { traps: w.traps.length, alerts: w.alerts.length, jams: w.jams.length, slowdowns: slowdownsOf(r).length };
    });
    const saving = preferred.durationSec != null && scored[fastestIdx].durationSec != null ? preferred.durationSec - scored[fastestIdx].durationSec : 0;
    const better = fastestIdx !== preferredIdx && saving >= s.betterMin * 60
        ? { id: scored[fastestIdx].id, summary: scored[fastestIdx].summary, savesSec: saving, durationSec: scored[fastestIdx].durationSec }
        : null;
    const delay = preferred.delaySec || pw.jams.reduce((n, j) => n + (j.delaySec || 0), 0) || 0;
    const major = slowdowns.some((x) => x.major) || pw.jams.some((j) => j.major) || pw.alerts.some((a) => a.kind === 'closure' || /Major/.test(a.label));
    const level = major || (preferred.staticSec && delay > preferred.staticSec * 0.35) ? 'heavy'
        : (delay >= 180 || slowdowns.length || pw.jams.length) ? 'moderate' : 'clear';
    const report = {
        direction,
        label: DIRECTION_LABEL[direction],
        at: new Date().toISOString(),
        provider,
        from: placeName(from, direction === 'work' ? 'Home' : 'Work'),
        to: placeName(to, direction === 'work' ? 'Work' : 'Home'),
        streets,
        preferred: publicRoute(preferred),
        routes: scored.map((r) => publicRoute(r)),
        better,
        slowdowns,
        alerts: pw.alerts,
        traps: pw.traps,
        jams: pw.jams,
        delaySec: delay,
        major,
        level,
        wazeChecked: !!area,
        errors
    };
    report.summary = summarise(report);
    loadLatest();
    latest[direction] = report;
    saveLatest();
    broadcast({ type: 'traffic_updated', data: { direction, report } });
    return report;
}

function summarise(r) {
    const p = r.preferred;
    const parts = [`${r.label}: ${fmtMin(p.durationSec)}${p.summary ? ` via ${p.summary}` : ''}${r.delaySec >= 60 ? ` (+${fmtMin(r.delaySec)})` : ''}.`];
    const majors = r.alerts.filter((a) => a.kind === 'accident' || a.kind === 'closure');
    if (majors.length) parts.push(`${majors[0].label}${majors[0].street ? ` on ${majors[0].street}` : ''}${majors.length > 1 ? ` and ${majors.length - 1} more` : ''}.`);
    const heavy = r.slowdowns.filter((x) => x.major);
    if (heavy.length) parts.push(`Heavy traffic${heavy[0].street ? ` on ${heavy[0].street}` : ''}.`);
    if (r.traps.length) parts.push(`${r.traps.length} speed trap${r.traps.length > 1 ? 's' : ''} on route.`);
    if (r.better) parts.push(`Faster: via ${r.better.summary} saves ${fmtMin(r.better.savesSec)}.`);
    if (!majors.length && !heavy.length && !r.traps.length && !r.better && r.level === 'clear') parts.push('Traffic is clear.');
    return parts.join(' ');
}

/** Latest reports without a fetch: { work, home }. */
function getLatest() {
    loadLatest();
    return { work: latest.work || null, home: latest.home || null };
}

// ------------------------------------------------------------------------------------------ leave advisor

/**
 * Drive times on the preferred route for leaving now and later (Google predicted traffic): { steps:
 * [{ offsetMin, leaveAt, durationSec, arriveAt }], best, wait: { offsetMin, savesSec, leaveAt } | null }.
 */
async function advise(direction, { force = false } = {}) {
    const s = getSettings();
    const { from, to } = endpoints(direction, s);
    if (!s.home || !s.work) throw new TrafficError('Set Home and Work first', 'NOT_SET');
    if (!googleKey()) throw new TrafficError('The leave advisor needs a Google Maps key (Waze gives no future drive times)', 'NO_ACCOUNT');
    const streets = direction === 'work' ? s.streets.slice() : s.streets.slice().reverse();
    const via = viaWaypoints(streets, s.area);
    const offsets = ADVISOR_STEPS.filter((o) => o <= s.advisorMax);
    if (!canSpend('google', offsets.length)) throw new TrafficError('Not enough of this month\'s Google Routes budget is left for the leave advisor', 'BUDGET');
    const base = Math.ceil(Date.now() / MIN) * MIN;
    const tag = `${direction}|${JSON.stringify([from, to, via])}`;
    const rows = await Promise.all(offsets.map(async (offsetMin) => {
        const leaveAt = base + offsetMin * MIN;
        try {
            const r = await cachedCall(`g:adv:${tag}:${offsetMin}`, 5 * MIN, () => googleRoutes(from, to, { via, departAt: offsetMin ? leaveAt : null }), force);
            const d = r[0].durationSec;
            return { offsetMin, leaveAt: new Date(leaveAt).toISOString(), durationSec: d, arriveAt: new Date(leaveAt + d * 1000).toISOString() };
        } catch (error) {
            return { offsetMin, leaveAt: new Date(leaveAt).toISOString(), durationSec: null, error: error.message };
        }
    }));
    const ok = rows.filter((r) => r.durationSec != null);
    if (!ok.length) throw new TrafficError((rows[0] && rows[0].error) || 'No drive times', 'NO_ROUTE');
    const now = ok.find((r) => r.offsetMin === 0) || ok[0];
    const min = Math.min(...ok.map((r) => r.durationSec));
    // the earliest departure within 2 minutes of the shortest drive
    const best = ok.find((r) => r.durationSec <= min + 120);
    const savesSec = now.durationSec - best.durationSec;
    const wait = best.offsetMin > 0 && savesSec >= s.waitMin * 60 ? { offsetMin: best.offsetMin, savesSec, leaveAt: best.leaveAt, arriveAt: best.arriveAt } : null;
    const advice = { direction, at: new Date().toISOString(), steps: rows, best: best.offsetMin, now: now.durationSec, wait };
    advice.summary = wait
        ? `Waiting ${wait.offsetMin} min saves ${fmtMin(wait.savesSec)} of driving: leave at ${clock(wait.leaveAt, s)} for ${fmtMin(best.durationSec)} instead of ${fmtMin(now.durationSec)}.`
        : `Leaving now is best: ${fmtMin(now.durationSec)}. Waiting does not save enough.`;
    return advice;
}

function clock(iso, s) {
    try {
        return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: (s && s.timeZone) || undefined }).format(new Date(iso));
    } catch (_e) {
        return new Date(iso).toLocaleTimeString();
    }
}

// ------------------------------------------------------------------------------------------ scheduler

const sched = { timer: null, fired: new Set(), go: new Map() };

/** { date: 'YYYY-MM-DD', minutes since midnight, weekday } in the settings' time zone. */
function localNow(s, at = new Date()) {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: s.timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
        .formatToParts(at).forEach((p) => { parts[p.type] = p.value; });
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: wd };
}

const minutesOf = (hhmm) => { const m = HHMM.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** What is due at this minute: [{ direction, kind }] (exported for the test). */
function dueNow(s, now, fired) {
    const out = [];
    if (!s.notify || !s.home || !s.work || !s.days.includes(now.weekday)) return out;
    [['work', s.leaveHome], ['home', s.leaveWork]].forEach(([direction, leave]) => {
        const at = minutesOf(leave);
        if (at == null) return;
        const due = ((at - s.leadMin) % 1440 + 1440) % 1440;
        // a minute of slack: a tick that runs late still fires once
        const key = `${now.date}:${direction}`;
        if ((now.minutes === due || now.minutes === (due + 1) % 1440) && !fired.has(key)) out.push({ direction, kind: 'scheduled', key });
    });
    return out;
}

async function runScheduled(direction, kind) {
    const s = getSettings();
    let report = null;
    let advice = null;
    try {
        report = await check(direction, { force: true });
    } catch (error) {
        broadcastAdmins({ type: 'traffic_report', data: { kind, direction, error: error.message, label: DIRECTION_LABEL[direction] } });
        return;
    }
    if (direction === 'home' && kind === 'scheduled' && googleKey()) {
        try { advice = await advise(direction); } catch (error) { advice = { error: error.message }; }
        if (advice && advice.wait) {
            const goAt = Date.parse(advice.wait.leaveAt);
            sched.go.set(direction, goAt);
        }
    }
    broadcastAdmins({ type: 'traffic_report', data: { kind, direction, report, advice, leave: direction === 'work' ? s.leaveHome : s.leaveWork } });
}

function tick() {
    const s = getSettings();
    const now = localNow(s);
    dueNow(s, now, sched.fired).forEach((d) => {
        sched.fired.add(d.key);
        runScheduled(d.direction, d.kind).catch((e) => console.warn(`[traffic] scheduled check failed: ${e.message}`));
    });
    sched.go.forEach((at, direction) => {
        if (Date.now() < at) return;
        sched.go.delete(direction);
        if (Date.now() - at > 10 * MIN) return; // the server was down: too late to be useful
        runScheduled(direction, 'go').catch((e) => console.warn(`[traffic] go check failed: ${e.message}`));
    });
    // forget old days
    if (sched.fired.size > 20) [...sched.fired].filter((k) => !k.startsWith(now.date)).forEach((k) => sched.fired.delete(k));
}

function startScheduler() {
    if (sched.timer) return;
    sched.timer = setInterval(() => { try { tick(); } catch (e) { console.warn(`[traffic] tick: ${e.message}`); } }, 30 * 1000);
    if (sched.timer.unref) sched.timer.unref();
}

// ------------------------------------------------------------------------------------------ broadcasts

function server() {
    return gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
}

const adminClient = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));

function broadcast(message) {
    try {
        const srv = server();
        if (srv && typeof srv.broadcast === 'function') srv.broadcast(Object.assign({ timestamp: new Date().toISOString() }, message), adminClient);
    } catch (error) {
        console.warn(`[traffic] broadcast skipped: ${error.message}`);
    }
}

// reports are the commute of the household's admin: the same audience
const broadcastAdmins = broadcast;

module.exports = {
    bind,
    getSettings,
    saveSettings,
    providers,
    check,
    advise,
    getLatest,
    startScheduler,
    TrafficError,
    DIRECTIONS,
    _test: {
        decodePolyline, cumulative, locate, normStreet, streetCore, streetOfInstruction, matchStreets, viaWaypoints,
        normaliseGoogle, slowdownsOf, onRoute, alertLabel, dueNow, localNow, summarise, routeCache, sched,
        setFetch: (fn) => { fetchImpl = fn; },
        resetUsage: () => { usageState = null; }
    }
};
