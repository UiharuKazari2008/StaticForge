'use strict';

/**
 * Location (Yozora #907): the one place Melaton keeps and resolves places.
 *
 *   - Home and Work: config `location.places` { home, work }, set in Settings > Personal > Location. Until one
 *     is saved here, Traffic's (config `traffic.home / work`) or Weather's (config `weather.places`) stands in,
 *     so nothing is lost; Traffic and Weather read them from here.
 *   - resolve(query, { min, max, limit }): a place typed the way a person writes it ("Whole Foods Waldorf",
 *     "20601", "Charles County", "the White House") as candidates, each with its specificity. Google Geocoding
 *     with the googlemaps service key; without one, Open-Meteo's geocoder (towns only).
 *   - reverse(lat, lon, { specificity }): a point as a place at that specificity, cached on a grid (a point is
 *     looked up once per cell).
 *
 * Specificity, finest first: exact (an address or a building), approximate (a street, neighbourhood or postal
 * code), city, county, state, country. An app asks for a range: `max` is the finest it wants (an answer finer
 * than that is cut down to it: a weather app asking for city never sees a street address), `min` the coarsest
 * it can use (an answer coarser than that is left out: a commute needs at least approximate).
 */

const fs = require('fs');
const path = require('path');

const SPECIFICITY = ['exact', 'approximate', 'city', 'county', 'state', 'country'];
const SPEC_LABEL = { exact: 'Exact', approximate: 'Approximate', city: 'City', county: 'County', state: 'State', country: 'Country' };
const PLACE_IDS = ['home', 'work'];
const GOOGLE_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const GEO_FILE = process.env.LOCATION_GEO_FILE || path.join(CACHE_DIR, 'location-geo.json');
const DAY = 24 * 60 * 60 * 1000;
const RESOLVE_TTL = 30 * DAY;
const REVERSE_TTL = 30 * DAY;
// a reverse lookup's grid cell by the specificity asked (degrees): a coarse ask shares one answer widely
const REVERSE_GRID = { exact: 0.0005, approximate: 0.005, city: 0.05, county: 0.2, state: 1, country: 5 };

class LocationError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'LOCATION_ERROR';
    }
}

let gr = null;
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

/** The googlemaps service key (Dreamscape CardSpace > Service keys), as Traffic reads it. */
function googleKey() {
    try {
        const manager = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        if (!manager) return null;
        const k = manager.getServiceKeys('googlemaps')[manager.getSelectedIndex('googlemaps')] || null;
        return k && k.apiKey ? String(k.apiKey).trim() : null;
    } catch (_e) {
        return null;
    }
}

const rank = (s) => { const i = SPECIFICITY.indexOf(s); return i < 0 ? SPECIFICITY.length : i; };
const cleanSpec = (s, d) => (SPECIFICITY.includes(s) ? s : d);

// ------------------------------------------------------------------------------------------ disk cache

let geoStore = null;
function geoCache() {
    if (geoStore) return geoStore;
    try { geoStore = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8')) || {}; } catch (_e) { geoStore = {}; }
    return geoStore;
}
let saveTimer = null;
function saveGeo() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            const now = Date.now();
            const c = geoCache();
            Object.keys(c).forEach((k) => { if (!c[k] || now - c[k].at > Math.max(RESOLVE_TTL, REVERSE_TTL)) delete c[k]; });
            fs.mkdirSync(path.dirname(GEO_FILE), { recursive: true });
            fs.writeFileSync(`${GEO_FILE}.tmp`, JSON.stringify(c));
            fs.renameSync(`${GEO_FILE}.tmp`, GEO_FILE);
        } catch (_e) { /* kept in memory */ }
    }, 2000);
    if (saveTimer.unref) saveTimer.unref();
}
const inflight = new Map();
async function cached(key, ttl, fn) {
    const c = geoCache();
    const hit = c[key];
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
        try {
            const value = await fn();
            c[key] = { at: Date.now(), value };
            saveGeo();
            return value;
        } finally {
            inflight.delete(key);
        }
    })();
    inflight.set(key, p);
    return p;
}

async function getJson(url, timeout = 10000) {
    let res;
    try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    } catch (error) {
        throw new LocationError(`Could not reach ${new URL(url).host} (${error.name === 'TimeoutError' ? 'timed out' : error.message})`, 'UNREACHABLE');
    }
    let body = null;
    try { body = await res.json(); } catch (_e) { body = null; }
    if (!res.ok) throw new LocationError((body && (body.error_message || body.reason)) || `HTTP ${res.status}`, res.status === 403 ? 'AUTH_FAILED' : 'PROVIDER_ERROR');
    return body;
}

// ------------------------------------------------------------------------------------------ places from providers

/** Google's result types as a specificity. */
function specOfTypes(types) {
    const t = new Set(types || []);
    if (['street_address', 'premise', 'subpremise', 'establishment', 'point_of_interest', 'airport', 'park'].some((x) => t.has(x))) return 'exact';
    if (['route', 'intersection', 'neighborhood', 'sublocality', 'sublocality_level_1', 'postal_code', 'colloquial_area'].some((x) => t.has(x))) return 'approximate';
    if (t.has('locality') || t.has('postal_town') || t.has('administrative_area_level_3')) return 'city';
    if (t.has('administrative_area_level_2')) return 'county';
    if (t.has('administrative_area_level_1')) return 'state';
    if (t.has('country')) return 'country';
    return 'approximate';
}

function componentsOf(r) {
    const out = {};
    (r.address_components || []).forEach((c) => {
        const t = c.types || [];
        if (t.includes('street_number')) out.number = c.long_name;
        else if (t.includes('route')) out.street = c.short_name || c.long_name;
        else if (t.includes('neighborhood')) out.neighborhood = c.long_name;
        else if (t.includes('locality') || (t.includes('postal_town') && !out.city)) out.city = c.long_name;
        else if (t.includes('administrative_area_level_2')) out.county = c.long_name;
        else if (t.includes('administrative_area_level_1')) { out.state = c.long_name; out.stateCode = c.short_name; }
        else if (t.includes('country')) { out.country = c.long_name; out.countryCode = c.short_name; }
        else if (t.includes('postal_code')) out.postal = c.long_name;
    });
    return out;
}

/** A place's name at a specificity, from its parts ("Waldorf, MD", "Charles County, MD", "Maryland"). */
function labelAt(spec, comp, address) {
    const st = comp.stateCode || comp.state || '';
    const join = (...xs) => xs.filter(Boolean).join(', ');
    if (spec === 'exact') return address || join([comp.number, comp.street].filter(Boolean).join(' '), comp.city, st);
    if (spec === 'approximate') return join(comp.street || comp.neighborhood || comp.postal, comp.city, st) || address;
    if (spec === 'city') return join(comp.city || comp.county, st) || address;
    if (spec === 'county') return join(comp.county || comp.city, st) || address;
    if (spec === 'state') return comp.state || comp.country || address;
    return comp.country || address;
}

/** The point kept for a specificity: coarser asks get a rounded point (no street from a city-level ask). */
function pointAt(spec, lat, lon) {
    const g = { exact: 1e-6, approximate: 0.001, city: 0.01, county: 0.05, state: 0.5, country: 2 }[spec] || 1e-6;
    const r = (v) => Math.round(v / g) * g;
    return { lat: Math.round(r(lat) * 1e6) / 1e6, lon: Math.round(r(lon) * 1e6) / 1e6 };
}

/** A provider's place cut to the finest specificity asked (`max`): its name and point coarsened to it. */
function cutTo(place, max) {
    if (rank(place.specificity) >= rank(max)) return place;
    const pt = pointAt(max, place.lat, place.lon);
    const comp = Object.assign({}, place.components);
    if (rank(max) >= rank('approximate')) delete comp.number;
    if (rank(max) >= rank('city')) { delete comp.street; delete comp.neighborhood; delete comp.postal; }
    if (rank(max) >= rank('county')) delete comp.city;
    if (rank(max) >= rank('state')) delete comp.county;
    if (rank(max) >= rank('country')) { delete comp.state; delete comp.stateCode; }
    return { label: labelAt(max, place.components, ''), address: labelAt(max, place.components, ''), lat: pt.lat, lon: pt.lon, specificity: max, components: comp, source: place.source };
}

function googlePlace(r) {
    const loc = r.geometry && r.geometry.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    const specificity = specOfTypes(r.types);
    const components = componentsOf(r);
    const address = r.formatted_address || '';
    return { label: labelAt(specificity, components, address.replace(/, (USA|United States)$/, '')), address, lat: loc.lat, lon: loc.lng, specificity, components, source: 'google' };
}

async function googleResolve(query, bias) {
    const gk = googleKey();
    if (!gk) return null;
    const q = new URLSearchParams({ address: query, key: gk });
    if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) q.set('bounds', `${bias.lat - 1},${bias.lon - 1}|${bias.lat + 1},${bias.lon + 1}`);
    const body = await getJson(`${GOOGLE_GEOCODE}?${q}`);
    if (body && body.status && !/^(OK|ZERO_RESULTS)$/.test(body.status)) throw new LocationError(body.error_message || `Geocoding ${body.status}`, body.status === 'REQUEST_DENIED' ? 'AUTH_FAILED' : 'PROVIDER_ERROR');
    return ((body && body.results) || []).map(googlePlace).filter(Boolean);
}

async function openMeteoResolve(query) {
    const q = new URLSearchParams({ name: query.slice(0, 80), count: '8', language: 'en', format: 'json' });
    const body = await getJson(`${OPEN_METEO_GEOCODE}?${q}`);
    return ((body && body.results) || []).map((r) => {
        const components = { city: r.name, county: r.admin2 || '', state: r.admin1 || '', country: r.country || '', countryCode: r.country_code || '' };
        return { label: labelAt('city', components, r.name), address: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: Number(r.latitude), lon: Number(r.longitude), specificity: 'city', components, source: 'openmeteo' };
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Candidates for a typed place: [{ label, address, lat, lon, specificity, components, source }], at most
 * `limit`, each no finer than `max` (cut down to it) and no coarser than `min` (left out). `near` { lat, lon }
 * prefers places around it (Home, the phone).
 */
async function resolve(query, opts = {}) {
    const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (q.length < 2) return [];
    const max = cleanSpec(opts.max, 'exact');
    const min = cleanSpec(opts.min, 'country');
    const limit = Math.max(1, Math.min(10, Number(opts.limit) || 5));
    const near = opts.near && Number.isFinite(Number(opts.near.lat)) ? { lat: Number(opts.near.lat), lon: Number(opts.near.lon) } : null;
    const nearKey = near ? `${near.lat.toFixed(0)},${near.lon.toFixed(0)}` : '';
    const found = await cached(`r:${q.toLowerCase()}|${nearKey}`, RESOLVE_TTL, async () => {
        let list = null;
        try { list = await googleResolve(q, near); } catch (e) { if (e.code === 'AUTH_FAILED') console.warn(`[location] geocoding: ${e.message}`); list = null; }
        if (!list || !list.length) {
            try { list = await openMeteoResolve(q); } catch (_e) { list = list || []; }
        }
        return list || [];
    });
    const seen = new Set();
    return found
        .filter((p) => rank(p.specificity) <= rank(min))
        .map((p) => cutTo(p, max))
        .filter((p) => { const k = `${p.label}|${p.specificity}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, limit);
}

/** A point as a place at a specificity (cut to it), or null. Cached per grid cell of that specificity. */
async function reverse(lat, lon, opts = {}) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new LocationError('A point needs lat and lon', 'BAD_POINT');
    const spec = cleanSpec(opts.specificity, 'city');
    const g = REVERSE_GRID[spec];
    const cell = `${Math.round(la / g)},${Math.round(lo / g)}`;
    const place = await cached(`v:${spec}:${cell}`, REVERSE_TTL, async () => {
        const gk = googleKey();
        if (!gk) return null;
        const q = new URLSearchParams({ latlng: `${la},${lo}`, key: gk });
        const body = await getJson(`${GOOGLE_GEOCODE}?${q}`);
        const results = ((body && body.results) || []).map(googlePlace).filter(Boolean);
        // the finest answer that is not finer than asked (else the finest, cut down)
        const fit = results.filter((p) => rank(p.specificity) >= rank(spec)).sort((a, b) => rank(a.specificity) - rank(b.specificity))[0] || results[0];
        return fit ? cutTo(fit, spec) : null;
    });
    return place ? Object.assign({}, place, rank(spec) <= rank('approximate') ? {} : pointAt(spec, la, lo)) : null;
}

// ------------------------------------------------------------------------------------------ Home and Work

function cleanPlace(p) {
    if (!p || typeof p !== 'object') return null;
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
    const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const comp = {};
    const c = p.components && typeof p.components === 'object' ? p.components : {};
    ['number', 'street', 'neighborhood', 'city', 'county', 'state', 'stateCode', 'postal', 'country', 'countryCode'].forEach((k) => { if (c[k]) comp[k] = str(c[k], 80); });
    return {
        label: str(p.label, 120) || str(p.address, 120) || 'Place',
        address: str(p.address, 200),
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        specificity: cleanSpec(p.specificity, 'exact'),
        components: comp,
        typed: str(p.typed, 200)
    };
}

/** Where a place came from before it was set here (Traffic's commute, Weather's places). */
function legacyPlace(id) {
    const t = (config('traffic', {}) || {})[id];
    if (t && Number.isFinite(Number(t.lat))) return cleanPlace({ label: t.address || (id === 'home' ? 'Home' : 'Work'), address: t.address || '', lat: t.lat, lon: t.lon, specificity: t.address ? 'exact' : 'approximate' });
    const w = (((config('weather', {}) || {}).places) || {})[id];
    if (w && Number.isFinite(Number(w.lat))) return cleanPlace({ label: [w.name, w.region].filter(Boolean).join(', '), lat: w.lat, lon: w.lon, specificity: 'city', components: { city: w.name, state: w.region, country: w.country } });
    return null;
}

/** { home, work }: each a place, or null; `from` says where an unsaved one stands in from. */
function getPlaces() {
    const saved = (config('location', {}) || {}).places || {};
    const out = {};
    PLACE_IDS.forEach((id) => {
        const p = cleanPlace(saved[id]);
        if (p) { out[id] = p; return; }
        const old = legacyPlace(id);
        out[id] = old ? Object.assign(old, { from: 'legacy' }) : null;
    });
    return out;
}

/** Save Home and / or Work: { home?: place | null, work?: place | null } (admins; the handler checks). */
async function savePlaces(next = {}) {
    if (!gr) throw new LocationError('Location service is not ready', 'NOT_READY');
    const cur = Object.assign({}, (config('location', {}) || {}).places || {});
    PLACE_IDS.forEach((id) => {
        if (!(id in next)) return;
        if (next[id] === null) { delete cur[id]; return; }
        const p = cleanPlace(next[id]);
        if (!p) throw new LocationError(`${id === 'home' ? 'Home' : 'Work'} needs a place with a point`, 'BAD_PLACE');
        cur[id] = p;
    });
    const loc = Object.assign({}, config('location', {}) || {}, { places: cur });
    const saved = gr.modifyConfig('config').assign(['location'], loc);
    if (saved && typeof saved.then === 'function') await saved;
    const places = getPlaces();
    broadcast({ type: 'location_places_changed', data: { places } });
    listeners.forEach((fn) => { try { fn(places); } catch (_e) { /* a listener's own fault */ } });
    return places;
}

// server modules that follow Home / Work (Traffic, Weather)
const listeners = [];
function onPlacesChanged(fn) { if (typeof fn === 'function') listeners.push(fn); }

function server() {
    return gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
}

function broadcast(message) {
    try {
        const srv = server();
        const who = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
        if (srv && typeof srv.broadcast === 'function') srv.broadcast(Object.assign({ timestamp: new Date().toISOString() }, message), who);
    } catch (error) {
        console.warn(`[location] broadcast skipped: ${error.message}`);
    }
}

module.exports = {
    bind,
    SPECIFICITY,
    SPEC_LABEL,
    resolve,
    reverse,
    getPlaces,
    savePlaces,
    onPlacesChanged,
    LocationError,
    _test: { setFetch: (fn) => { fetchImpl = fn || ((...a) => fetch(...a)); }, specOfTypes, cutTo, labelAt, reset: () => { geoStore = {}; } }
};
