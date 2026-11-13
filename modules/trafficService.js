'use strict';

/**
 * Traffic (Yozora #795): the commute service behind Melaton Mobile's Traffic app and its Today item.
 * This module is the only code that calls the traffic hosts; new traffic code goes through it.
 *
 * Providers:
 *   googlemaps  (Service key) Google Routes API computeRoutes, traffic-aware ("Compute Routes Pro": a
 *               monthly free allowance). Drive times, alternatives, the preferred route through
 *               via-waypoints, slowdowns from speedReadingIntervals, departures in the future.
 *   tomtom      (Service key) TomTom Traffic Incident Details v5: accidents, closures, lane closures,
 *               roadworks, hazards and jams in the route's box. Free tier counted per day.
 *   OpenStreetMap  fixed speed and red light cameras (Overpass API: highway=speed_camera nodes and
 *               type=enforcement relations' devices), no key; cached a week per area.
 * Google is counted per calendar month and TomTom per day against config traffic.budgets
 * ({ google, tomtom }); a provider past its budget is skipped (the app shows what is left).
 * Waze was dropped (Yukimi, Nov 13 2026): its free plan (100 requests a month) is too small to use.
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
const TOMTOM_INCIDENTS = 'https://api.tomtom.com/traffic/services/5/incidentDetails';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const DIRECTIONS = ['work', 'home'];
const DIRECTION_LABEL = { work: 'To Work', home: 'To Home' };
const DEFAULTS = { leadMin: 10, betterMin: 5, waitMin: 8, advisorMax: 90, notify: true, days: [1, 2, 3, 4, 5], budgets: { google: 4500, tomtom: 2000 } };
const ROUTE_TTL = 3 * MIN;
const INCIDENT_TTL = 5 * MIN;
const CAMERA_TTL = 7 * 24 * 60 * MIN;
const CORRIDOR_M = 60; // an incident's point this close to the route is on it
const CAMERA_M = 40; // a camera this close to the route watches it
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
        budgets: { google: clampInt(budgets.google, 0, 100000, DEFAULTS.budgets.google), tomtom: clampInt(budgets.tomtom, 0, 100000, DEFAULTS.budgets.tomtom) }
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
        if ('tomtom' in next.budgets) out.budgets.tomtom = clampInt(next.budgets.tomtom, 0, 100000, DEFAULTS.budgets.tomtom);
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

function tomtomKey() {
    const k = serviceKey('tomtom');
    return k && k.apiKey ? String(k.apiKey).trim() : null;
}

let usageState = null;

function monthKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(d = new Date()) {
    return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

/** { month, google, day, tomtom }: Google counts per month, TomTom per day (its free tier is daily). */
function usage() {
    if (!usageState) {
        try { usageState = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch (_e) { usageState = null; }
    }
    if (!usageState || typeof usageState !== 'object') usageState = {};
    if (usageState.month !== monthKey()) Object.assign(usageState, { month: monthKey(), google: 0 });
    if (usageState.day !== dayKey()) Object.assign(usageState, { day: dayKey(), tomtom: 0 });
    delete usageState.waze;
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

/** { google: { configured, used, budget, left, per }, tomtom: { ... }, osm: { configured } } for Settings / About. */
function providers() {
    const s = getSettings();
    const u = usage();
    const one = (id, configured, per) => ({ configured, used: u[id] || 0, budget: s.budgets[id], left: Math.max(0, s.budgets[id] - (u[id] || 0)), per });
    return { month: u.month, google: one('google', !!googleKey(), 'month'), tomtom: one('tomtom', !!tomtomKey(), 'day'), osm: { configured: true } };
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

// ------------------------------------------------------------------------------------------ TomTom incidents

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

const TOMTOM_FIELDS = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,lastReportTime}}}';
// iconCategory -> our kind and a label when the event has no description
const TOMTOM_KIND = {
    1: ['accident', 'Accident'], 2: ['hazard', 'Fog'], 3: ['hazard', 'Dangerous conditions'], 4: ['hazard', 'Rain'],
    5: ['hazard', 'Ice'], 6: ['jam', 'Traffic jam'], 7: ['lane', 'Lane closed'], 8: ['closure', 'Road closed'],
    9: ['construction', 'Roadworks'], 10: ['hazard', 'Wind'], 11: ['hazard', 'Flooding'], 14: ['hazard', 'Broken-down vehicle']
};

const sentence = (t) => { const x = String(t || '').trim(); return x ? x.charAt(0).toUpperCase() + x.slice(1) : ''; };

/** TomTom incidents in a box: [{ id, kind, label, street, from, to, line: [{ lat, lon }], delaySec, lengthM, magnitude, startedAt, ... }]. */
async function tomtomIncidents(box) {
    const key = tomtomKey();
    if (!key) throw new TrafficError('No TomTom key', 'NO_ACCOUNT');
    if (!canSpend('tomtom')) throw new TrafficError('Today\'s TomTom budget is used up', 'BUDGET');
    const q = new URLSearchParams({
        key,
        bbox: [box.w, box.s, box.e, box.n].map((v) => v.toFixed(5)).join(','),
        fields: TOMTOM_FIELDS,
        language: 'en-US',
        timeValidityFilter: 'present'
    });
    spend('tomtom');
    const res = await getJson(`${TOMTOM_INCIDENTS}?${q}`, { timeout: 15000 });
    return (res && Array.isArray(res.incidents) ? res.incidents : []).map((f) => {
        const p = (f && f.properties) || {};
        const g = (f && f.geometry) || {};
        const coords = g.type === 'Point' ? [g.coordinates] : (Array.isArray(g.coordinates) ? g.coordinates : []);
        const line = coords.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map(([lon, lat]) => ({ lat, lon }));
        if (!line.length) return null;
        const [kind, fallback] = TOMTOM_KIND[p.iconCategory] || ['hazard', 'Incident'];
        const ev = Array.isArray(p.events) && p.events[0] ? p.events[0] : {};
        const roads = Array.isArray(p.roadNumbers) ? p.roadNumbers.filter(Boolean) : [];
        return {
            id: String(p.id || `${line[0].lat},${line[0].lon}`),
            source: 'tomtom',
            kind,
            label: sentence(ev.description) || fallback,
            street: roads.join(', ') || p.from || '',
            from: p.from || '',
            to: p.to || '',
            description: p.from && p.to ? `${p.from} to ${p.to}` : (p.from || p.to || ''),
            magnitude: num(p.magnitudeOfDelay) || 0,
            delaySec: num(p.delay),
            lengthM: num(p.length),
            startedAt: p.startTime || null,
            endsAt: p.endTime || null,
            reportedAt: p.lastReportTime || p.startTime || null,
            line
        };
    }).filter(Boolean);
}

// ------------------------------------------------------------------------------------------ OpenStreetMap cameras

/**
 * Fixed speed / red light cameras in a box from OpenStreetMap (Overpass): highway=speed_camera nodes and
 * the device nodes of type=enforcement relations. [{ id, kind: 'trap', label, maxspeed, lat, lon, ... }].
 */
async function osmCameras(box) {
    const bb = [box.s, box.w, box.n, box.e].map((v) => v.toFixed(4)).join(',');
    const query = `[out:json][timeout:25];(node["highway"="speed_camera"](${bb});rel["type"="enforcement"](${bb}););out body;node(r:"device");out body;`;
    const res = await getJson(OVERPASS, {
        timeout: 30000,
        init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Dreamscape-Traffic/1.0' }, body: `data=${encodeURIComponent(query)}` }
    });
    const els = (res && Array.isArray(res.elements) ? res.elements : []);
    const enforce = new Map(); // device node id -> relation tags
    els.filter((e) => e.type === 'relation').forEach((r) => {
        (r.members || []).filter((m) => m.type === 'node' && m.role === 'device').forEach((m) => enforce.set(m.ref, r.tags || {}));
    });
    const seen = new Set();
    return els.filter((e) => e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon)).map((n) => {
        const t = n.tags || {};
        const rel = enforce.get(n.id);
        if (!rel && t.highway !== 'speed_camera') return null;
        if (seen.has(n.id)) return null;
        seen.add(n.id);
        const what = String((rel && rel.enforcement) || t.enforcement || 'maxspeed');
        const label = /traffic_signals/.test(what) ? 'Red light camera' : /average_speed/.test(what) ? 'Average speed camera' : /mindistance|check|toll|access/.test(what) ? 'Enforcement camera' : 'Speed camera';
        return {
            id: `osm:${n.id}`,
            source: 'osm',
            kind: 'trap',
            label,
            maxspeed: t.maxspeed || (rel && rel.maxspeed) || '',
            street: t['addr:street'] || (rel && rel.name) || t.name || '',
            direction: t.direction || t['camera:direction'] || '',
            fixed: true,
            lat: n.lat,
            lon: n.lon
        };
    }).filter(Boolean);
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

/** TomTom incidents and OSM cameras on a route: { alerts, traps, jams } with positions along it. */
function onRoute(incidents, cameras, route) {
    const out = { alerts: [], traps: [], jams: [] };
    if (!route || !route._points.length) return out;
    const total = route._cum[route._cum.length - 1] || 1;
    const along = (m) => Math.max(0, Math.min(1, m / total));
    (incidents || []).forEach((inc) => {
        // a point incident near the route, or a stretch that mostly lies on it
        let near = 0;
        let first = Infinity;
        inc.line.forEach((p) => {
            const loc = locate(route._points, route._cum, p);
            if (loc.distM <= CORRIDOR_M) { near++; first = Math.min(first, loc.alongM); }
        });
        if (!near || (inc.line.length > 1 && near / inc.line.length < 0.5)) return;
        const base = { id: inc.id, source: inc.source, kind: inc.kind, label: inc.label, street: inc.street, description: inc.description, delaySec: inc.delaySec, lengthM: inc.lengthM, startedAt: inc.startedAt, endsAt: inc.endsAt, reportedAt: inc.reportedAt, magnitude: inc.magnitude, at: along(first), lat: inc.line[0].lat, lon: inc.line[0].lon };
        if (inc.kind === 'jam') out.jams.push(Object.assign(base, { major: inc.magnitude >= 3 }));
        else out.alerts.push(Object.assign(base, { major: inc.kind === 'closure' || (inc.kind === 'accident' && inc.magnitude >= 3) }));
    });
    (cameras || []).forEach((c) => {
        const loc = locate(route._points, route._cum, c);
        if (loc.distM > CAMERA_M) return;
        out.traps.push(Object.assign({}, c, { at: along(loc.alongM) }));
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

/** Read the routes, incidents and cameras for one direction and build the report (see the header). */
async function check(direction, { force = false } = {}) {
    if (!DIRECTIONS.includes(direction)) throw new TrafficError('direction is work or home', 'BAD_REQUEST');
    const s = getSettings();
    const { from, to } = endpoints(direction, s);
    if (!s.home || !s.work) throw new TrafficError('Set Home and Work first', 'NOT_SET');
    if (!googleKey()) throw new TrafficError('Add a Google Maps key in Dreamscape CardSpace > Service keys', 'NO_ACCOUNT');
    const streets = direction === 'work' ? s.streets.slice() : s.streets.slice().reverse();
    const via = viaWaypoints(streets, s.area);
    const errors = [];
    const tag = `${direction}|${JSON.stringify([from, to, via])}`;
    const provider = 'google';
    const [alts, pref] = await Promise.all([
        cachedCall(`g:alt:${tag}`, ROUTE_TTL, () => googleRoutes(from, to, { alternatives: true }), force).catch((e) => { errors.push(e.message); return []; }),
        via.length ? cachedCall(`g:via:${tag}`, ROUTE_TTL, () => googleRoutes(from, to, { via }), force).catch((e) => { errors.push(`Preferred route: ${e.message}`); return []; }) : Promise.resolve([])
    ]);
    const routes = alts.slice();
    const viaRoute = pref[0] || null;
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

    // TomTom incidents and OSM cameras in the box around every route (one box serves both directions:
    // it is snapped outwards to a 0.05 degree grid, so the cache key repeats)
    const pts = [].concat(...scored.map((r) => r._points));
    let incidents = null;
    let cameras = null;
    if (pts.length) {
        const b = bboxOf(pts, 0.01);
        const g = 0.05;
        const box = { s: Math.floor(b.s / g) * g, w: Math.floor(b.w / g) * g, n: Math.ceil(b.n / g) * g, e: Math.ceil(b.e / g) * g };
        const boxKey = [box.s, box.w, box.n, box.e].map((v) => v.toFixed(2)).join(',');
        [incidents, cameras] = await Promise.all([
            tomtomKey() ? cachedCall(`t:inc:${boxKey}`, INCIDENT_TTL, () => tomtomIncidents(box), force).catch((e) => { errors.push(`TomTom: ${e.message}`); return null; }) : Promise.resolve(null),
            cachedCall(`o:cam:${boxKey}`, CAMERA_TTL, () => osmCameras(box), false).catch((e) => { errors.push(`Speed cameras: ${e.message}`); return null; })
        ]);
    }
    const pw = onRoute(incidents, cameras, preferred);
    const slowdowns = slowdownsOf(preferred);
    scored.forEach((r, i) => {
        r.id = `r${i}`;
        r.preferred = i === preferredIdx;
        r.fastest = i === fastestIdx;
        if (!r.summary) r.summary = r.streetsHit && r.streetsHit.length ? r.streetsHit.join(', ') : (i === preferredIdx ? 'Preferred route' : `Route ${i + 1}`);
        const w = i === preferredIdx ? pw : onRoute(incidents, cameras, r);
        r.counts = { traps: w.traps.length, alerts: w.alerts.length, jams: w.jams.length, slowdowns: slowdownsOf(r).length };
    });
    const saving = preferred.durationSec != null && scored[fastestIdx].durationSec != null ? preferred.durationSec - scored[fastestIdx].durationSec : 0;
    const better = fastestIdx !== preferredIdx && saving >= s.betterMin * 60
        ? { id: scored[fastestIdx].id, summary: scored[fastestIdx].summary, savesSec: saving, durationSec: scored[fastestIdx].durationSec }
        : null;
    const delay = preferred.delaySec || pw.jams.reduce((n, j) => n + (j.delaySec || 0), 0) || 0;
    const major = slowdowns.some((x) => x.major) || pw.jams.some((j) => j.major) || pw.alerts.some((a) => a.major);
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
        incidentsChecked: !!incidents,
        camerasChecked: !!cameras,
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
    if (r.traps.length) parts.push(`${r.traps.length} speed camera${r.traps.length > 1 ? 's' : ''} on route.`);
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
    if (!googleKey()) throw new TrafficError('The leave advisor needs a Google Maps key', 'NO_ACCOUNT');
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
        normaliseGoogle, slowdownsOf, onRoute, tomtomIncidents, osmCameras, dueNow, localNow, summarise, routeCache, sched,
        setFetch: (fn) => { fetchImpl = fn; },
        resetUsage: () => { usageState = null; }
    }
};
