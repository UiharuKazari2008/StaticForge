/**
 * Weather service (Yozora #780): the one place Dreamscape talks to weather hosts. Everything that
 * shows or uses weather (the Sidebar gadget, Melaton Mobile's Weather app and Today, dynamic
 * generation's context, the radar map) asks here; nothing else fetches a weather host.
 *
 * Providers
 *   apple       Apple WeatherKit REST (weatherkit.apple.com). The selected Apple Weather service key
 *               (Dreamscape CardSpace > Service keys, apiKeyManager `appleweather`): the .p8 private key
 *               as the key value, Team ID, Service ID and Key ID as its fields. Requests carry an
 *               ES256 JWT signed here, reused until shortly before it expires.
 *   nws         api.weather.gov active alerts (US), when Apple's alerts are not available.
 *   openmeteo   Open-Meteo forecast, archive and geocoding (keyless). The fallback, and the source
 *               dynamic generation keeps for its archive and model fields.
 *   rainviewer  RainViewer's radar frames (past two hours, tiles to zoom 7).
 *   esri        Esri's basemap tiles under the radar (services.arcgisonline.com, keyless).
 *   geo         BigDataCloud reverse geocoding (the country an alert request needs).
 *
 * Which forecast provider: Apple when an Apple Weather key is saved (config `weather.provider:
 * 'openmeteo'` turns it off without deleting the key), Open-Meteo otherwise. A failed Apple request falls back to Open-Meteo
 * for that call, so a bad key or a WeatherKit outage never leaves the weather empty.
 *
 * Cache: a TTL per kind of data, coordinates rounded to 0.01° (about 1 km) so neighbouring requests
 * share one entry, concurrent requests for one key share one fetch, failures are remembered for a
 * short back-off, and when a host fails the last good data is served marked `stale` (up to 6 hours).
 * Entries live in size-capped LRUs (JSON by count, tiles by bytes).
 *
 * Rate limiting: a per-minute token bucket and a daily budget per provider (Apple's included quota is
 * 500,000 calls a month: 15,000 a day by default, config `weather.appleDailyBudget`). A host's 429 pauses
 * that provider for its Retry-After. usage() reports the counters (CardSpace shows Apple's).
 *
 * One model for both sources (normalised below): times are the place's local wall clock as
 * 'YYYY-MM-DDTHH:MM' with `offset` (seconds) and `tz`; temperatures °C, wind km/h, pressure hPa,
 * visibility m, precipitation mm (mm/h for intensity), chances and humidity in %. Conditions carry a
 * WMO code (`code`, what the clients' icon tables read), a display `text`, and Apple's own
 * `conditionCode` when Apple answered.
 */
'use strict';

const crypto = require('crypto');
let tzLookup = null;
try { tzLookup = require('tz-lookup'); } catch (_e) { tzLookup = null; }

const APPLE_HOST = 'https://weatherkit.apple.com';
const APPLE_LEGAL_URL = 'https://developer.apple.com/weatherkit/data-source-attribution/';
const OPEN_METEO = {
    forecast: 'https://api.open-meteo.com/v1/forecast',
    archive: 'https://archive-api.open-meteo.com/v1/archive',
    geocode: 'https://geocoding-api.open-meteo.com/v1/search'
};
const OPEN_METEO_HOSTS = new Set(['api.open-meteo.com', 'archive-api.open-meteo.com', 'geocoding-api.open-meteo.com']);
const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_MAX_ZOOM = 7; // RainViewer's free tiles stop here; the map scales them past it
// Esri's keyless basemaps (CARTO's now want a key): the grey canvases with their label layers on top
const BASE_STYLES = {
    dark: 'Canvas/World_Dark_Gray_Base',
    light: 'Canvas/World_Light_Gray_Base',
    streets: 'World_Street_Map',
    labels: 'Canvas/World_Light_Gray_Reference',
    'dark-labels': 'Canvas/World_Dark_Gray_Reference'
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TTL = {
    forecast: 10 * MIN,
    forecastFail: 2 * MIN,
    stale: 6 * HOUR,
    alert: 15 * MIN,
    geocode: 7 * 24 * HOUR,
    country: 30 * 24 * HOUR,
    radarIndex: 4 * MIN,
    radarTile: 30 * MIN,
    baseTile: 7 * 24 * HOUR,
    availability: 24 * HOUR,
    rawOpenMeteo: 10 * MIN
};

let gr = null;

/** The server's globalResources (config, secure config, user agent). Every entry point binds it. */
function bind(globalResources) {
    if (globalResources && !gr) gr = globalResources;
    return module.exports;
}

function config(path, fallback) {
    try {
        const v = gr ? gr.getConfig({ path }) : undefined;
        return v === undefined || v === null ? fallback : v;
    } catch (_e) {
        return fallback;
    }
}

function secure(path) {
    try { return gr ? gr.getSecureConfig({ path }) : null; } catch (_e) { return null; }
}

function userAgent() {
    return config('userAgent', '') || 'Dreamscape/2026 (weather)';
}

// ------------------------------------------------------------------------------------------ cache

class Lru {
    constructor({ maxEntries = 500, maxBytes = 0 } = {}) {
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.bytes = 0;
        this.map = new Map();
    }

    get(key) {
        const hit = this.map.get(key);
        if (!hit) return null;
        this.map.delete(key);
        this.map.set(key, hit);
        return hit;
    }

    set(key, entry) {
        const old = this.map.get(key);
        if (old) { this.bytes -= old.size || 0; this.map.delete(key); }
        this.map.set(key, entry);
        this.bytes += entry.size || 0;
        while (this.map.size > this.maxEntries || (this.maxBytes && this.bytes > this.maxBytes && this.map.size > 1)) {
            const [k, v] = this.map.entries().next().value;
            this.map.delete(k);
            this.bytes -= v.size || 0;
        }
    }

    delete(key) {
        const old = this.map.get(key);
        if (old) { this.bytes -= old.size || 0; this.map.delete(key); }
    }

    clear(prefix) {
        [...this.map.keys()].forEach((k) => { if (!prefix || k.startsWith(prefix)) this.delete(k); });
    }
}

const jsonCache = new Lru({ maxEntries: 800 });
const tileCache = new Lru({ maxEntries: 4000, maxBytes: 96 * 1024 * 1024 });
const inflight = new Map();

/**
 * value for key: the cached value while fresh, else one shared fetch. A failed fetch serves the last
 * good value (marked stale) for up to TTL.stale and is not retried for failTtl.
 * opts: { ttl, failTtl, staleMax, cache, size(value), noStale }
 */
async function memo(key, fn, opts = {}) {
    const cache = opts.cache || jsonCache;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.ok && now < hit.expires) return hit.value;
    if (hit && !hit.ok && now < hit.retryAt) {
        if (hit.lastGood && !opts.noStale && now - hit.lastGood.at < (opts.staleMax || TTL.stale)) return markStale(hit.lastGood.value);
        throw hit.error;
    }
    if (inflight.has(key)) return inflight.get(key);
    const run = (async () => {
        try {
            const value = await fn();
            cache.set(key, { ok: true, value, at: Date.now(), expires: Date.now() + (opts.ttl || TTL.forecast), size: opts.size ? opts.size(value) : 0 });
            return value;
        } catch (error) {
            const lastGood = hit && hit.ok ? { value: hit.value, at: hit.at } : (hit && hit.lastGood) || null;
            cache.set(key, { ok: false, error, retryAt: Date.now() + (error.retryAfterMs || opts.failTtl || TTL.forecastFail), lastGood, size: lastGood ? (hit.size || 0) : 0 });
            if (lastGood && !opts.noStale && Date.now() - lastGood.at < (opts.staleMax || TTL.stale)) return markStale(lastGood.value);
            throw error;
        } finally {
            inflight.delete(key);
        }
    })();
    inflight.set(key, run);
    return run;
}

function markStale(value) {
    // a list (alerts, places) stays a list: only a forecast-like object carries the flag
    if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value) || value.buffer) return value;
    return Object.assign({}, value, { stale: true });
}

// ------------------------------------------------------------------------------------------ rate limits

class WeatherError extends Error {
    constructor(message, code, extra) {
        super(message);
        this.code = code || 'WEATHER_ERROR';
        Object.assign(this, extra || {});
    }
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

class Limiter {
    constructor(name, { perMinute, perDay }) {
        this.name = name;
        this.perMinute = perMinute;
        this.perDay = perDay;
        this.tokens = perMinute;
        this.refilledAt = Date.now();
        this.day = today();
        this.used = 0;
        this.denied = 0;
        this.errors = 0;
        this.pausedUntil = 0;
        this.lastError = null;
        this.lastOkAt = 0;
    }

    budget() {
        return typeof this.perDay === 'function' ? this.perDay() : this.perDay;
    }

    take() {
        const now = Date.now();
        if (this.day !== today()) { this.day = today(); this.used = 0; this.denied = 0; this.errors = 0; }
        this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.refilledAt) / MIN) * this.perMinute);
        this.refilledAt = now;
        if (now < this.pausedUntil) {
            this.denied++;
            throw new WeatherError(`${this.name} asked us to slow down`, 'RATE_LIMITED', { retryAfterMs: this.pausedUntil - now });
        }
        if (this.used >= this.budget()) {
            this.denied++;
            throw new WeatherError(`${this.name}: today's request budget (${this.budget()}) is used up`, 'BUDGET_EXCEEDED', { retryAfterMs: 15 * MIN });
        }
        if (this.tokens < 1) {
            this.denied++;
            throw new WeatherError(`${this.name}: too many requests this minute`, 'RATE_LIMITED', { retryAfterMs: Math.ceil(((1 - this.tokens) / this.perMinute) * MIN) });
        }
        this.tokens -= 1;
        this.used += 1;
    }

    pause(ms) {
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    }

    stats() {
        return {
            provider: this.name,
            day: this.day,
            used: this.used,
            budget: this.budget(),
            perMinute: this.perMinute,
            denied: this.denied,
            errors: this.errors,
            pausedUntil: this.pausedUntil > Date.now() ? new Date(this.pausedUntil).toISOString() : null,
            lastError: this.lastError,
            lastOkAt: this.lastOkAt ? new Date(this.lastOkAt).toISOString() : null
        };
    }
}

const limiters = {
    apple: new Limiter('Apple Weather', { perMinute: 120, perDay: () => Math.max(100, Number(config('weather.appleDailyBudget', 15000)) || 15000) }),
    openmeteo: new Limiter('Open-Meteo', { perMinute: 300, perDay: 9000 }),
    rainviewer: new Limiter('RainViewer', { perMinute: 600, perDay: 60000 }),
    esri: new Limiter('Esri', { perMinute: 600, perDay: 60000 }),
    geo: new Limiter('BigDataCloud', { perMinute: 60, perDay: 5000 }),
    nws: new Limiter('National Weather Service', { perMinute: 60, perDay: 5000 })
};

// ------------------------------------------------------------------------------------------ http

async function request(provider, url, { headers = {}, timeout = 10000, binary = false } = {}) {
    const limiter = limiters[provider];
    limiter.take();
    let response;
    try {
        response = await fetch(url, {
            headers: Object.assign({ 'User-Agent': userAgent(), Accept: binary ? 'image/*' : 'application/json' }, headers),
            signal: AbortSignal.timeout(timeout)
        });
    } catch (error) {
        limiter.errors++;
        limiter.lastError = { at: new Date().toISOString(), message: error.message };
        throw new WeatherError(`${limiter.name} could not be reached: ${error.message}`, 'UNREACHABLE');
    }
    if (response.status === 429) {
        const after = Number(response.headers.get('retry-after'));
        const ms = Number.isFinite(after) && after > 0 ? after * 1000 : 5 * MIN;
        limiter.pause(ms);
        limiter.errors++;
        limiter.lastError = { at: new Date().toISOString(), status: 429, message: 'Too many requests' };
        throw new WeatherError(`${limiter.name} asked us to slow down`, 'RATE_LIMITED', { status: 429, retryAfterMs: ms });
    }
    if (!response.ok) {
        let detail = '';
        try { detail = (await response.text()).slice(0, 300); } catch (_e) { /* none */ }
        limiter.errors++;
        limiter.lastError = { at: new Date().toISOString(), status: response.status, message: detail || response.statusText };
        throw new WeatherError(`${limiter.name} answered HTTP ${response.status}${detail ? `: ${detail}` : ''}`, response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : 'HTTP_ERROR', { status: response.status });
    }
    limiter.lastOkAt = Date.now();
    if (binary) {
        return { buffer: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') || 'image/png' };
    }
    return response.json();
}

// ------------------------------------------------------------------------------------------ places and time

const round2 = (v) => Math.round(Number(v) * 100) / 100;

function checkCoords(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
        throw new WeatherError('Coordinates out of range', 'BAD_COORDINATES');
    }
    return { lat: round2(la), lon: round2(lo) };
}

function timezoneOf(lat, lon) {
    try { return tzLookup ? tzLookup(lat, lon) : 'UTC'; } catch (_e) { return 'UTC'; }
}

const dtfCache = new Map();
function dtf(tz) {
    if (!dtfCache.has(tz)) {
        let f;
        try {
            f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (_e) {
            f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        dtfCache.set(tz, f);
    }
    return dtfCache.get(tz);
}

function wallParts(ms, tz) {
    const out = {};
    dtf(tz).formatToParts(new Date(ms)).forEach((p) => { out[p.type] = p.value; });
    return out;
}

/** Seconds the place's clock is ahead of UTC at ms. */
function offsetAt(ms, tz) {
    const p = wallParts(ms, tz);
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((wall - Math.floor(ms / 1000) * 1000) / 1000);
}

/** An instant (ISO with zone, or ms) as the place's wall clock 'YYYY-MM-DDTHH:MM'. */
function localIso(instant, tz) {
    if (instant == null || instant === '') return null;
    const ms = typeof instant === 'number' ? instant : Date.parse(instant);
    if (!Number.isFinite(ms)) return null;
    const p = wallParts(ms, tz);
    return `${p.year}-${p.month}-${p.day}T${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`;
}

const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Moon age 0..1 (0 new, 0.5 full) at ms, and its phase name. */
function moonPhaseAt(ms) {
    const days = (ms - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    const age = (((days % 29.530588853) + 29.530588853) % 29.530588853) / 29.530588853;
    const names = ['new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'thirdQuarter', 'waningCrescent'];
    return { age, phase: names[Math.round(age * 8) % 8] };
}

// ------------------------------------------------------------------------------------------ conditions

const WMO_TEXT = {
    0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing Fog',
    51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle', 56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
    61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain',
    71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains', 80: 'Showers', 81: 'Rain Showers',
    82: 'Heavy Showers', 85: 'Snow Showers', 86: 'Snow Showers', 95: 'Thunderstorm', 96: 'Thunderstorm, Hail', 99: 'Thunderstorm, Hail'
};

// Apple's conditionCode -> [WMO code (the clients' icons and scenes), display text]
const APPLE_CONDITIONS = {
    Clear: [0, 'Clear'], MostlyClear: [1, 'Mostly Clear'], PartlyCloudy: [2, 'Partly Cloudy'],
    MostlyCloudy: [3, 'Mostly Cloudy'], Cloudy: [3, 'Cloudy'], Foggy: [45, 'Fog'], Fog: [45, 'Fog'],
    Haze: [45, 'Haze'], Smoky: [45, 'Smoke'], Smoke: [45, 'Smoke'], Dust: [45, 'Dust'], BlowingDust: [45, 'Blowing Dust'],
    Breezy: [1, 'Breezy'], Windy: [2, 'Windy'], Frigid: [0, 'Frigid'], Hot: [0, 'Hot'],
    Drizzle: [53, 'Drizzle'], FreezingDrizzle: [56, 'Freezing Drizzle'], Rain: [63, 'Rain'], HeavyRain: [65, 'Heavy Rain'],
    Showers: [80, 'Showers'], ScatteredShowers: [80, 'Scattered Showers'], SunShowers: [80, 'Sun Showers'],
    IsolatedShowers: [80, 'Isolated Showers'], FreezingRain: [66, 'Freezing Rain'], Sleet: [66, 'Sleet'],
    MixedRainAndSleet: [66, 'Rain and Sleet'], MixedRainAndSnow: [66, 'Rain and Snow'], MixedRainfall: [66, 'Mixed Rainfall'],
    MixedSnowAndSleet: [66, 'Snow and Sleet'], WintryMix: [66, 'Wintry Mix'],
    Flurries: [71, 'Flurries'], SunFlurries: [71, 'Sun Flurries'], Snow: [73, 'Snow'], HeavySnow: [75, 'Heavy Snow'],
    SnowShowers: [85, 'Snow Showers'], ScatteredSnowShowers: [85, 'Scattered Snow Showers'], BlowingSnow: [75, 'Blowing Snow'],
    Blizzard: [75, 'Blizzard'], Hail: [96, 'Hail'],
    IsolatedThunderstorms: [95, 'Isolated Thunderstorms'], ScatteredThunderstorms: [95, 'Scattered Thunderstorms'],
    Thunderstorm: [95, 'Thunderstorms'], Thunderstorms: [95, 'Thunderstorms'], StrongStorms: [99, 'Strong Storms'],
    SevereThunderstorm: [99, 'Severe Thunderstorms'], Hurricane: [99, 'Hurricane'], TropicalStorm: [99, 'Tropical Storm'], Tornado: [99, 'Tornado']
};

function appleCondition(code) {
    const hit = APPLE_CONDITIONS[code];
    if (hit) return { code: hit[0], text: hit[1], conditionCode: code };
    const text = String(code || '').replace(/([a-z])([A-Z])/g, '$1 $2') || 'Cloudy';
    return { code: 3, text, conditionCode: code || null };
}

function wmoCondition(code) {
    const c = n(code);
    return { code: c, text: WMO_TEXT[c] || 'Cloudy' };
}

// ------------------------------------------------------------------------------------------ Apple account

/** The selected Apple Weather service key as an account, or null. The private key never leaves the server. */
function appleAccount() {
    let key = null;
    try {
        const manager = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        if (manager) key = manager.getServiceKeys('appleweather')[manager.getSelectedIndex('appleweather')] || null;
    } catch (_e) { key = null; }
    if (!key || !key.teamId || !key.serviceId || !key.keyId || !key.apiKey) return null;
    return { name: key.name || 'Apple Weather', teamId: key.teamId, serviceId: key.serviceId, keyId: key.keyId, privateKey: key.apiKey };
}

function prefs() {
    const p = config('weather', {}) || {};
    return {
        provider: p.provider === 'openmeteo' ? 'openmeteo' : 'apple',
        appleDailyBudget: Number(p.appleDailyBudget) || 15000
    };
}

function activeProvider() {
    return appleAccount() && prefs().provider === 'apple' ? 'apple' : 'openmeteo';
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Normalise a pasted or uploaded .p8 key to PEM; throws when it is not an EC P-256 private key. */
function normalisePrivateKey(text) {
    // a password field drops the newlines of a pasted .p8: rebuild the PEM from its base64 body
    const body = String(text || '').replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    if (!body) throw new WeatherError('The private key is empty', 'BAD_KEY');
    if (!/^[A-Za-z0-9+/=]+$/.test(body)) throw new WeatherError('The private key is not a .p8 key', 'BAD_KEY');
    const pem = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
    let key;
    try { key = crypto.createPrivateKey(pem); } catch (error) { throw new WeatherError(`The private key could not be read: ${error.message}`, 'BAD_KEY'); }
    const details = key.asymmetricKeyDetails || {};
    if (key.asymmetricKeyType !== 'ec' || (details.namedCurve && details.namedCurve !== 'prime256v1')) {
        throw new WeatherError('WeatherKit keys are P-256 EC keys (.p8 from the Apple Developer site)', 'BAD_KEY');
    }
    return key.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
}

let tokenCache = null; // { fingerprint, token, expires }

function accountFingerprint(a) {
    return crypto.createHash('sha256').update(`${a.teamId}|${a.serviceId}|${a.keyId}|${a.privateKey}`).digest('hex');
}

/** A developer token for WeatherKit: ES256, kid = Key ID, id = TeamID.ServiceID, one hour. */
function signAppleToken(a, nowMs = Date.now()) {
    const iat = Math.floor(nowMs / 1000);
    const header = { alg: 'ES256', kid: a.keyId, id: `${a.teamId}.${a.serviceId}` };
    const payload = { iss: a.teamId, iat, exp: iat + 3600, sub: a.serviceId };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = crypto.sign('sha256', Buffer.from(input), { key: a.privateKey, dsaEncoding: 'ieee-p1363' });
    return { token: `${input}.${b64url(signature)}`, expires: (iat + 3600) * 1000 };
}

function appleToken(a) {
    const fp = accountFingerprint(a);
    if (tokenCache && tokenCache.fingerprint === fp && Date.now() < tokenCache.expires - 5 * MIN) return tokenCache.token;
    const signed = signAppleToken(a);
    tokenCache = { fingerprint: fp, token: signed.token, expires: signed.expires };
    return signed.token;
}

async function appleGet(path, a) {
    return request('apple', `${APPLE_HOST}${path}`, { headers: { Authorization: `Bearer ${appleToken(a)}` }, timeout: 12000 });
}

async function appleAvailability(lat, lon, country, a = appleAccount()) {
    if (!a) throw new WeatherError('No Apple Weather account', 'NO_ACCOUNT');
    const qs = country ? `?country=${encodeURIComponent(country)}` : '';
    return memo(`apple:avail:${lat}:${lon}:${country || ''}:${accountFingerprint(a).slice(0, 8)}`, () => appleGet(`/api/v1/availability/${lat}/${lon}${qs}`, a), { ttl: TTL.availability, noStale: true });
}

// ------------------------------------------------------------------------------------------ country (alerts need it)

async function countryOf(lat, lon) {
    const la = Math.round(lat * 10) / 10;
    const lo = Math.round(lon * 10) / 10;
    try {
        return await memo(`geo:country:${la}:${lo}`, async () => {
            const params = new URLSearchParams({ latitude: String(la), longitude: String(lo), localityLanguage: 'en' });
            const body = await request('geo', `https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`, { timeout: 8000 });
            return { code: body && body.countryCode ? String(body.countryCode).toUpperCase() : '', city: (body && (body.city || body.locality)) || '', region: (body && body.principalSubdivision) || '', country: (body && body.countryName) || '' };
        }, { ttl: TTL.country, failTtl: 10 * MIN });
    } catch (_e) {
        return { code: '', city: '', region: '', country: '' };
    }
}

// ------------------------------------------------------------------------------------------ Apple -> model

function appleHourOrDay(part, tz) {
    if (!part) return null;
    const cond = appleCondition(part.conditionCode);
    return {
        code: cond.code,
        text: cond.text,
        conditionCode: cond.conditionCode,
        maxC: n(part.temperatureMax),
        minC: n(part.temperatureMin),
        rain: pct(part.precipitationChance),
        precipMm: n(part.precipitationAmount),
        snowMm: n(part.snowfallAmount),
        precipType: part.precipitationType || null,
        humidity: pct(part.humidity),
        cloud: pct(part.cloudCover),
        windKmh: n(part.windSpeed),
        windMaxKmh: n(part.windSpeedMax),
        gustKmh: n(part.windGustSpeedMax),
        windDir: n(part.windDirection),
        from: localIso(part.forecastStart, tz),
        to: localIso(part.forecastEnd, tz)
    };
}

function normaliseApple(body, tz, meta = {}) {
    const now = Date.now();
    const out = {
        provider: 'apple',
        attribution: attributionFor('apple'),
        tz,
        offset: offsetAt(now, tz),
        fetchedAt: new Date(now).toISOString(),
        current: null,
        minutely: null,
        hourly: [],
        daily: [],
        alerts: [],
        alertsUrl: null
    };
    const c = body.currentWeather;
    if (c) {
        const cond = appleCondition(c.conditionCode);
        out.current = {
            time: localIso(c.asOf, tz),
            tempC: n(c.temperature),
            feelsC: n(c.temperatureApparent),
            dewC: n(c.temperatureDewPoint),
            humidity: pct(c.humidity),
            code: cond.code,
            text: cond.text,
            conditionCode: cond.conditionCode,
            isDay: c.daylight !== false,
            windKmh: n(c.windSpeed),
            windDir: n(c.windDirection),
            gustKmh: n(c.windGust),
            pressure: n(c.pressure),
            pressureTrend: c.pressureTrend || null,
            visibilityM: n(c.visibility),
            uv: n(c.uvIndex),
            cloud: pct(c.cloudCover),
            cloudLow: pct(c.cloudCoverLowAltPct),
            cloudMid: pct(c.cloudCoverMidAltPct),
            cloudHigh: pct(c.cloudCoverHighAltPct),
            precipMmH: n(c.precipitationIntensity)
        };
    }
    const nh = body.forecastNextHour;
    if (nh && Array.isArray(nh.minutes) && nh.minutes.length) {
        out.minutely = {
            source: 'apple',
            stepMinutes: 1,
            summary: nextHourSummary(nh, tz),
            periods: (nh.summary || []).map((s) => ({ from: localIso(s.startTime, tz), to: localIso(s.endTime, tz), condition: s.condition, rain: pct(s.precipitationChance), mmh: n(s.precipitationIntensity) })),
            minutes: nh.minutes.map((m) => ({ time: localIso(m.startTime, tz), rain: pct(m.precipitationChance), mmh: n(m.precipitationIntensity) }))
        };
    }
    const hours = (body.forecastHourly && body.forecastHourly.hours) || [];
    out.hourly = hours.map((h) => {
        const cond = appleCondition(h.conditionCode);
        return {
            time: localIso(h.forecastStart, tz),
            tempC: n(h.temperature),
            feelsC: n(h.temperatureApparent),
            dewC: n(h.temperatureDewPoint),
            code: cond.code,
            text: cond.text,
            conditionCode: cond.conditionCode,
            isDay: h.daylight !== false,
            rain: pct(h.precipitationChance),
            precipMm: n(h.precipitationAmount),
            precipType: h.precipitationType || null,
            snowMm: n(h.snowfallAmount),
            humidity: pct(h.humidity),
            windKmh: n(h.windSpeed),
            windDir: n(h.windDirection),
            gustKmh: n(h.windGust),
            uv: n(h.uvIndex),
            pressure: n(h.pressure),
            pressureTrend: h.pressureTrend || null,
            visibilityM: n(h.visibility),
            cloud: pct(h.cloudCover)
        };
    });
    const days = (body.forecastDaily && body.forecastDaily.days) || [];
    out.daily = days.slice(0, 10).map((d) => {
        const cond = appleCondition(d.conditionCode);
        const start = localIso(d.forecastStart, tz);
        const day = appleHourOrDay(d.daytimeForecast, tz);
        const night = appleHourOrDay(d.overnightForecast, tz);
        const dayHours = out.hourly.filter((h) => h.time && start && h.time.slice(0, 10) === start.slice(0, 10));
        const feels = dayHours.map((h) => h.feelsC).filter((v) => v != null);
        return {
            date: start ? start.slice(0, 10) : null,
            code: cond.code,
            text: cond.text,
            conditionCode: cond.conditionCode,
            maxC: n(d.temperatureMax),
            minC: n(d.temperatureMin),
            maxAt: localIso(d.temperatureMaxTime, tz),
            minAt: localIso(d.temperatureMinTime, tz),
            feelsMaxC: feels.length ? Math.max(...feels) : null,
            feelsMinC: feels.length ? Math.min(...feels) : null,
            rain: pct(d.precipitationChance),
            precipMm: n(d.precipitationAmount),
            precipType: d.precipitationType || null,
            snowMm: n(d.snowfallAmount),
            uv: n(d.maxUvIndex),
            windKmh: n(d.windSpeedAvg),
            windMaxKmh: n(d.windSpeedMax),
            gustKmh: n(d.windGustSpeedMax),
            windDir: day ? day.windDir : null,
            humidity: day ? day.humidity : null,
            sunrise: localIso(d.sunrise, tz),
            sunset: localIso(d.sunset, tz),
            dawn: localIso(d.sunriseCivil, tz),
            dusk: localIso(d.sunsetCivil, tz),
            solarNoon: localIso(d.solarNoon, tz),
            moonrise: localIso(d.moonrise, tz),
            moonset: localIso(d.moonset, tz),
            moonPhase: d.moonPhase || moonPhaseAt(Date.parse(d.forecastStart) + 12 * HOUR).phase,
            daylightSec: d.sunrise && d.sunset ? Math.round((Date.parse(d.sunset) - Date.parse(d.sunrise)) / 1000) : null,
            day,
            night
        };
    });
    const wa = body.weatherAlerts;
    if (wa) {
        out.alertsSource = 'Apple Weather';
        out.alertsUrl = wa.detailsUrl || null;
        out.alerts = (wa.alerts || []).map((al) => ({
            id: al.id,
            title: al.description || 'Weather alert',
            area: al.areaName || '',
            severity: al.severity || 'unknown',
            urgency: al.urgency || null,
            certainty: al.certainty || null,
            source: al.source || '',
            issued: localIso(al.issuedTime, tz),
            effective: localIso(al.effectiveTime, tz),
            expires: localIso(al.expireTime, tz),
            onset: localIso(al.eventOnsetTime, tz),
            ends: localIso(al.eventEndTime, tz),
            responses: Array.isArray(al.responses) ? al.responses : [],
            detailsUrl: al.detailsUrl || null,
            country: al.countryCode || meta.country || ''
        }));
    }
    return out;
}

/** "Rain starting in 12 min" from the next hour's summary periods. */
function nextHourSummary(nh, tz) {
    const periods = Array.isArray(nh.summary) ? nh.summary : [];
    if (!periods.length) return '';
    const start = Date.parse(nh.forecastStart || (nh.minutes[0] && nh.minutes[0].startTime));
    const mins = (iso) => Math.max(1, Math.round((Date.parse(iso) - start) / MIN));
    const first = periods[0];
    const kind = (p) => {
        const intensity = n(p.precipitationIntensity) || 0;
        const word = intensity >= 4 ? 'Heavy rain' : intensity >= 1 ? 'Rain' : 'Light rain';
        return p.precipitationType === 'snow' ? (intensity >= 1 ? 'Snow' : 'Light snow') : word;
    };
    if (first.condition === 'clear') {
        const next = periods.find((p) => p.condition !== 'clear');
        return next ? `${kind(next)} starting in ${mins(next.startTime)} min` : 'No precipitation for the next hour';
    }
    if (first.endTime) return `${kind(first)} stopping in ${mins(first.endTime)} min`;
    return `${kind(first)} for the next hour`;
}

async function fetchApple(lat, lon, opts = {}) {
    const a = appleAccount();
    if (!a) throw new WeatherError('No Apple Weather account', 'NO_ACCOUNT');
    const tz = timezoneOf(lat, lon);
    const place = await countryOf(lat, lon);
    const sets = ['currentWeather', 'forecastDaily', 'forecastHourly', 'forecastNextHour'];
    if (place.code) sets.push('weatherAlerts');
    const now = Date.now();
    const params = new URLSearchParams({
        dataSets: sets.join(','),
        timezone: tz,
        hourlyStart: new Date(now - 3 * HOUR).toISOString().replace(/\.\d+Z$/, 'Z'),
        hourlyEnd: new Date(now + 72 * HOUR).toISOString().replace(/\.\d+Z$/, 'Z'),
        // the end is exclusive and counts from now: 11 days asked = 10 whole ones
        dailyEnd: new Date(now + 11 * 24 * HOUR).toISOString().replace(/\.\d+Z$/, 'Z')
    });
    if (place.code) params.set('countryCode', place.code);
    const lang = /^[a-z]{2}(-[A-Z]{2})?$/.test(opts.lang || '') ? opts.lang : 'en';
    const body = await appleGet(`/api/v1/weather/${lang}/${lat}/${lon}?${params}`, a);
    const out = normaliseApple(body, tz, { country: place.code });
    out.place = place;
    return out;
}

// ------------------------------------------------------------------------------------------ Open-Meteo

/** Raw Open-Meteo JSON for a full URL on one of its hosts, cached and rate limited (dynamic generation). */
async function openMeteoRaw(url, { ttl = TTL.rawOpenMeteo } = {}) {
    let host = '';
    try { host = new URL(url).hostname; } catch (_e) { host = ''; }
    if (!OPEN_METEO_HOSTS.has(host)) throw new WeatherError('Not an Open-Meteo address', 'BAD_URL');
    return memo(`om:raw:${url}`, () => request('openmeteo', url, { timeout: 12000 }), { ttl, noStale: true });
}

function normaliseOpenMeteo(b) {
    const tz = b.timezone || 'UTC';
    const now = Date.now();
    const at = (arr, i) => (arr ? n(arr[i]) : null);
    const cur = b.current || {};
    const hourly = b.hourly || {};
    const daily = b.daily || {};
    const m15 = b.minutely_15 || {};
    const out = {
        provider: 'openmeteo',
        attribution: attributionFor('openmeteo'),
        tz,
        offset: Number.isFinite(Number(b.utc_offset_seconds)) ? Number(b.utc_offset_seconds) : offsetAt(now, tz),
        fetchedAt: new Date(now).toISOString(),
        current: null,
        minutely: null,
        hourly: [],
        daily: [],
        alerts: [],
        alertsUrl: null
    };
    const allHours = (hourly.time || []).map((time, i) => {
        const cond = wmoCondition(at(hourly.weather_code, i));
        return {
            time,
            tempC: at(hourly.temperature_2m, i),
            feelsC: at(hourly.apparent_temperature, i),
            dewC: at(hourly.dew_point_2m, i),
            code: cond.code,
            text: cond.text,
            isDay: at(hourly.is_day, i) !== 0,
            rain: at(hourly.precipitation_probability, i),
            precipMm: at(hourly.precipitation, i),
            snowMm: hourly.snowfall ? (at(hourly.snowfall, i) == null ? null : at(hourly.snowfall, i) * 10) : null,
            humidity: at(hourly.relative_humidity_2m, i),
            windKmh: at(hourly.wind_speed_10m, i),
            windDir: at(hourly.wind_direction_10m, i),
            gustKmh: at(hourly.wind_gusts_10m, i),
            uv: at(hourly.uv_index, i),
            pressure: at(hourly.pressure_msl, i),
            visibilityM: at(hourly.visibility, i),
            cloud: at(hourly.cloud_cover, i)
        };
    });
    out.hourly = allHours;
    if (b.current) {
        const cond = wmoCondition(cur.weather_code);
        // pressure trend: now against three hours ago (hourly includes past_hours)
        let trend = null;
        const nowIdx = allHours.findIndex((h) => h.time > (cur.time || ''));
        const before = nowIdx > 3 ? allHours[nowIdx - 4] : null;
        if (before && before.pressure != null && n(cur.pressure_msl) != null) {
            const d = n(cur.pressure_msl) - before.pressure;
            trend = d > 0.8 ? 'rising' : d < -0.8 ? 'falling' : 'steady';
        }
        out.current = {
            time: cur.time || null,
            tempC: n(cur.temperature_2m),
            feelsC: n(cur.apparent_temperature),
            dewC: n(cur.dew_point_2m),
            humidity: n(cur.relative_humidity_2m),
            code: cond.code,
            text: cond.text,
            isDay: cur.is_day !== 0,
            windKmh: n(cur.wind_speed_10m),
            windDir: n(cur.wind_direction_10m),
            gustKmh: n(cur.wind_gusts_10m),
            pressure: n(cur.pressure_msl),
            pressureTrend: trend,
            visibilityM: n(cur.visibility),
            uv: n(cur.uv_index),
            cloud: n(cur.cloud_cover),
            precipMmH: n(cur.precipitation)
        };
    }
    if (m15.time && m15.time.length) {
        const minutes = m15.time.map((time, i) => ({ time, rain: at(m15.precipitation_probability, i), mmh: at(m15.precipitation, i) == null ? null : at(m15.precipitation, i) * 4 }));
        const nowIso = localIso(now, tz);
        const ahead = minutes.filter((m) => m.time >= (nowIso || '').slice(0, 15)).slice(0, 8);
        if (ahead.length) {
            const wet = ahead.findIndex((m) => (m.mmh || 0) >= 0.1);
            const dry = wet >= 0 ? ahead.slice(wet).findIndex((m) => (m.mmh || 0) < 0.1) : -1;
            let summary = 'No precipitation for the next two hours';
            if (wet === 0) summary = dry > 0 ? `Rain stopping in about ${dry * 15} min` : 'Rain for the next two hours';
            else if (wet > 0) summary = `Rain starting in about ${wet * 15} min`;
            out.minutely = { source: 'openmeteo', stepMinutes: 15, summary, periods: [], minutes: ahead };
        }
    }
    out.daily = (daily.time || []).map((date, i) => {
        const cond = wmoCondition(at(daily.weather_code, i));
        const sunrise = daily.sunrise ? daily.sunrise[i] : null;
        const sunset = daily.sunset ? daily.sunset[i] : null;
        const dayHours = allHours.filter((h) => h.time && h.time.slice(0, 10) === date);
        const avg = (k, list) => { const v = list.map((h) => h[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
        const part = (list) => {
            if (!list.length) return null;
            const codes = list.map((h) => h.code).filter((x) => x != null).sort((x, y) => y - x);
            const code = codes.length ? codes[Math.floor(codes.length / 3)] : null;
            const temps = list.map((h) => h.tempC).filter((x) => x != null);
            return {
                code, text: wmoCondition(code).text,
                maxC: temps.length ? Math.max(...temps) : null, minC: temps.length ? Math.min(...temps) : null,
                rain: list.reduce((m, h) => Math.max(m, h.rain || 0), 0),
                precipMm: Math.round(list.reduce((s, h) => s + (h.precipMm || 0), 0) * 10) / 10,
                humidity: avg('humidity', list), cloud: avg('cloud', list), windKmh: avg('windKmh', list),
                windDir: avg('windDir', list)
            };
        };
        const dayPart = sunrise && sunset ? dayHours.filter((h) => h.time >= sunrise && h.time < sunset) : dayHours.filter((h) => h.isDay);
        const nightPart = allHours.filter((h) => sunset && h.time >= sunset && h.time.slice(0, 10) <= nextDate(date) && h.time < `${nextDate(date)}T07:00`);
        return {
            date,
            code: cond.code,
            text: cond.text,
            maxC: at(daily.temperature_2m_max, i),
            minC: at(daily.temperature_2m_min, i),
            feelsMaxC: at(daily.apparent_temperature_max, i),
            feelsMinC: at(daily.apparent_temperature_min, i),
            rain: at(daily.precipitation_probability_max, i),
            precipMm: at(daily.precipitation_sum, i),
            snowMm: daily.snowfall_sum ? (at(daily.snowfall_sum, i) == null ? null : at(daily.snowfall_sum, i) * 10) : null,
            uv: at(daily.uv_index_max, i),
            windKmh: dayHours.length ? avg('windKmh', dayHours) : null,
            windMaxKmh: at(daily.wind_speed_10m_max, i),
            gustKmh: at(daily.wind_gusts_10m_max, i),
            windDir: at(daily.wind_direction_10m_dominant, i),
            humidity: avg('humidity', dayHours),
            sunrise,
            sunset,
            dawn: sunrise ? shiftIso(sunrise, -30) : null,
            dusk: sunset ? shiftIso(sunset, 30) : null,
            solarNoon: sunrise && sunset ? midIso(sunrise, sunset) : null,
            moonrise: null,
            moonset: null,
            moonPhase: moonPhaseAt(Date.parse(`${date}T12:00Z`)).phase,
            daylightSec: n(daily.daylight_duration ? daily.daylight_duration[i] : null),
            day: part(dayPart),
            night: part(nightPart)
        };
    });
    // the hourly rail starts at the current hour; the past hours were only for the pressure trend
    const nowIso = localIso(now, tz) || '';
    const from = out.hourly.findIndex((h) => h.time.slice(0, 13) >= nowIso.slice(0, 13));
    if (from > 0) out.hourly = out.hourly.slice(from - 1);
    return out;
}

function nextDate(date) {
    const d = new Date(`${date}T00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

function shiftIso(iso, minutes) {
    const ms = Date.parse(`${iso}Z`) + minutes * MIN;
    return new Date(ms).toISOString().slice(0, 16);
}

function midIso(a, b) {
    return new Date((Date.parse(`${a}Z`) + Date.parse(`${b}Z`)) / 2).toISOString().slice(0, 16);
}

async function fetchOpenMeteo(lat, lon) {
    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,visibility,precipitation,uv_index',
        minutely_15: 'precipitation,precipitation_probability',
        hourly: 'temperature_2m,apparent_temperature,dew_point_2m,weather_code,precipitation_probability,precipitation,snowfall,is_day,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,pressure_msl,visibility,cloud_cover',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,snowfall_sum,uv_index_max,sunrise,sunset,daylight_duration,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
        forecast_days: '10',
        past_hours: '4',
        forecast_hours: '72',
        forecast_minutely_15: '12',
        past_minutely_15: '1',
        timezone: 'auto'
    });
    const body = await request('openmeteo', `${OPEN_METEO.forecast}?${params}`, { timeout: 12000 });
    if (!body || !body.current) throw new WeatherError('Open-Meteo sent no current conditions', 'NO_DATA');
    return normaliseOpenMeteo(body);
}

// ------------------------------------------------------------------------------------------ attribution

function attributionFor(provider) {
    if (provider === 'apple') {
        return {
            name: 'Apple Weather',
            url: APPLE_LEGAL_URL,
            linkText: 'Other data sources',
            logoLight: '/static_images/weather/apple-weather-black.png',
            logoLight2x: '/static_images/weather/apple-weather-black@2x.png',
            logoDark: '/static_images/weather/apple-weather-white.png',
            logoDark2x: '/static_images/weather/apple-weather-white@2x.png',
            mark: '/static_images/weather/apple-weather-mark.png'
        };
    }
    return { name: 'Open-Meteo', url: 'https://open-meteo.com/', linkText: 'Open-Meteo.com (CC BY 4.0)' };
}

// ------------------------------------------------------------------------------------------ public: forecasts

/**
 * The full forecast for coordinates from the active provider: current, next hour (minutely), 72 hours,
 * 10 days, alerts (Apple). opts: { provider: 'apple'|'openmeteo' (force), lang }.
 */
async function getForecast(lat, lon, opts = {}) {
    const p = checkCoords(lat, lon);
    return attachAlerts(await forecastFrom(p, opts), p.lat, p.lon);
}

async function forecastFrom(p, opts) {
    const wanted = opts.provider || activeProvider();
    if (wanted === 'apple' && appleAccount()) {
        try {
            const fp = accountFingerprint(appleAccount()).slice(0, 8);
            return await memo(`apple:fc:${fp}:${p.lat}:${p.lon}:${opts.lang || 'en'}`, () => fetchApple(p.lat, p.lon, opts), { ttl: TTL.forecast, failTtl: TTL.forecastFail });
        } catch (error) {
            if (opts.provider === 'apple') throw error;
            const fallback = await memo(`om:fc:${p.lat}:${p.lon}`, () => fetchOpenMeteo(p.lat, p.lon), { ttl: TTL.forecast, failTtl: TTL.forecastFail });
            return Object.assign({}, fallback, { fallbackFrom: 'apple', fallbackReason: error.message });
        }
    }
    return memo(`om:fc:${p.lat}:${p.lon}`, () => fetchOpenMeteo(p.lat, p.lon), { ttl: TTL.forecast, failTtl: TTL.forecastFail });
}

// ------------------------------------------------------------------------------------------ alerts

/** NWS text is wrapped at about 70 columns: join wrapped lines, keep paragraphs and "* WHAT..." items. */
function unwrap(text) {
    return String(text || '').replace(/\r/g, '').replace(/([^\n])\n(?!\n|\* |- )/g, '$1 ').trim();
}

/** Active US alerts for a point from api.weather.gov, in the model's alert shape. */
async function nwsAlerts(lat, lon) {
    return memo(`nws:alerts:${lat}:${lon}`, async () => {
        const body = await request('nws', `https://api.weather.gov/alerts/active?status=actual&point=${lat},${lon}`, {
            headers: { Accept: 'application/geo+json' }, timeout: 10000
        });
        const tz = timezoneOf(lat, lon);
        return ((body && body.features) || []).map((f) => f && f.properties).filter(Boolean).map((p) => ({
            id: String(p.id || ''),
            title: p.event || 'Weather alert',
            headline: p.headline || '',
            area: p.areaDesc || '',
            severity: String(p.severity || 'unknown').toLowerCase(),
            urgency: p.urgency ? String(p.urgency).toLowerCase() : null,
            certainty: p.certainty ? String(p.certainty).toLowerCase() : null,
            source: p.senderName || 'National Weather Service',
            issued: localIso(p.sent, tz),
            effective: localIso(p.effective, tz),
            expires: localIso(p.expires, tz),
            onset: localIso(p.onset, tz),
            ends: localIso(p.ends, tz),
            responses: [],
            text: unwrap(p.description),
            instruction: unwrap(p.instruction),
            detailsUrl: null,
            country: 'US',
            provider: 'nws'
        })).filter((a) => a.id);
    }, { ttl: 5 * MIN, failTtl: 2 * MIN });
}

/** Alerts for a forecast that came without them (Open-Meteo, or Apple where it has none): NWS in the US. */
async function attachAlerts(forecast, lat, lon) {
    if (!forecast || forecast.alertsSource) return forecast;
    const place = forecast.place || await countryOf(lat, lon);
    if (place.code !== 'US') return forecast;
    try {
        const alerts = await nwsAlerts(lat, lon);
        return Object.assign({}, forecast, { alerts, alertsSource: 'National Weather Service' });
    } catch (_e) {
        return forecast;
    }
}

const ALERT_SEVERITY = { extreme: 4, severe: 3, moderate: 2, minor: 1, unknown: 0 };
const ALERT_POLL_MS = 5 * MIN;
const ALERTS_SEEN_FILE = process.env.WEATHER_ALERTS_SEEN_FILE || require('path').join(__dirname, '..', '.cache', 'weather-alerts-seen.json');
const monitor = { timer: null, place: null, alerts: [], provider: null, checkedAt: null, seen: null };

function loadSeen() {
    if (monitor.seen) return monitor.seen;
    monitor.seen = new Map();
    try {
        const rows = JSON.parse(require('fs').readFileSync(ALERTS_SEEN_FILE, 'utf8'));
        (Array.isArray(rows) ? rows : []).forEach((r) => { if (r && r.id) monitor.seen.set(r.id, r.until || 0); });
    } catch (_e) { /* first run */ }
    return monitor.seen;
}

function saveSeen() {
    try {
        const fs = require('fs');
        const now = Date.now();
        const rows = [...loadSeen().entries()].filter(([, until]) => until > now).map(([id, until]) => ({ id, until }));
        fs.mkdirSync(require('path').dirname(ALERTS_SEEN_FILE), { recursive: true });
        fs.writeFileSync(`${ALERTS_SEEN_FILE}.tmp`, JSON.stringify(rows));
        fs.renameSync(`${ALERTS_SEEN_FILE}.tmp`, ALERTS_SEEN_FILE);
    } catch (_e) { /* the next poll tries again */ }
}

/** The primary location: the configured home (secure config `location`), as dynamic generation uses it. */
function primaryPlace() {
    const loc = secure('location');
    if (!loc || loc.latitude == null || loc.longitude == null) return null;
    const lat = Number(loc.latitude);
    const lon = Number(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat: round2(lat), lon: round2(lon) };
}

function broadcast(message) {
    try {
        const server = gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
        if (server && typeof server.broadcast === 'function') {
            server.broadcast(Object.assign({ timestamp: new Date().toISOString() }, message), (info) => !!(info && info.authenticated !== false));
        }
    } catch (error) {
        console.warn(`[weather] alert broadcast skipped: ${error.message}`);
    }
}

/**
 * One look at the primary location's alerts. New alerts (never broadcast before, kept across restarts in
 * .cache/weather-alerts-seen.json until they expire) go to every signed-in client as weather_alert_issued;
 * any change to the active list goes out as weather_alerts_changed.
 */
async function pollAlerts() {
    const p = primaryPlace();
    if (!p) return getActiveAlerts();
    let forecast;
    try { forecast = await getForecast(p.lat, p.lon); } catch (_e) { return getActiveAlerts(); }
    const place = forecast.place && forecast.place.city ? forecast.place : await countryOf(p.lat, p.lon);
    const alerts = (Array.isArray(forecast.alerts) ? forecast.alerts : []).slice().sort((x, y) => (ALERT_SEVERITY[y.severity] || 0) - (ALERT_SEVERITY[x.severity] || 0));
    const before = monitor.alerts.map((a) => a.id).join('|');
    monitor.place = { lat: p.lat, lon: p.lon, name: place.city || '', region: place.region || '', country: place.country || '' };
    monitor.alerts = alerts;
    monitor.provider = forecast.alertsSource || (forecast.provider === 'apple' ? 'Apple Weather' : null);
    monitor.checkedAt = new Date().toISOString();
    const seen = loadSeen();
    const fresh = alerts.filter((a) => !seen.has(a.id));
    fresh.forEach((a) => {
        const until = Date.parse(`${a.expires || a.ends || ''}Z`) - forecast.offset * 1000;
        seen.set(a.id, Number.isFinite(until) ? until + HOUR : Date.now() + 2 * 24 * HOUR);
    });
    if (fresh.length) {
        saveSeen();
        fresh.forEach((alert) => broadcast({ type: 'weather_alert_issued', data: { alert, place: monitor.place, source: monitor.provider } }));
        console.log(`[weather] ${fresh.length} new alert(s) for the primary location: ${fresh.map((a) => a.title).join(', ')}`);
    }
    if (alerts.map((a) => a.id).join('|') !== before) broadcast({ type: 'weather_alerts_changed', data: getActiveAlerts() });
    return getActiveAlerts();
}

/** The primary location's active alerts from the last poll (weather_alerts_active). */
function getActiveAlerts() {
    return { place: monitor.place, alerts: monitor.alerts, source: monitor.provider, checkedAt: monitor.checkedAt };
}

/** Start watching the primary location's alerts (once per process; the first look after 30 s). */
function startAlertMonitor() {
    if (monitor.timer) return;
    const run = () => { pollAlerts().catch((error) => console.warn(`[weather] alert poll failed: ${error.message}`)); };
    monitor.timer = setInterval(run, ALERT_POLL_MS);
    if (monitor.timer.unref) monitor.timer.unref();
    const first = setTimeout(run, 30 * 1000);
    if (first.unref) first.unref();
}

/** The Sidebar gadget's shape: current + four days, plus the provider and its attribution. */
function gadgetShape(f) {
    if (!f || !f.current) return null;
    return {
        provider: f.provider,
        attribution: f.attribution,
        stale: !!f.stale,
        current: { tempC: f.current.tempC, feelsC: f.current.feelsC, code: f.current.code, text: f.current.text, isDay: f.current.isDay !== false },
        daily: (f.daily || []).slice(0, 4).map((d) => ({
            date: d.date, code: d.code, text: d.text, maxC: d.maxC, minC: d.minC,
            feelsMaxC: d.feelsMaxC, feelsMinC: d.feelsMinC, rainChance: d.rain, uvMax: d.uv
        }))
    };
}

/** Full text of one alert (Apple's weatherAlert endpoint). */
async function getAlert(id, lang = 'en') {
    const a = appleAccount();
    if (!a) throw new WeatherError('Alerts come from Apple Weather, and no account is saved', 'NO_ACCOUNT');
    if (!/^[A-Za-z0-9-]{8,80}$/.test(String(id || ''))) throw new WeatherError('Bad alert id', 'BAD_ID');
    const l = /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : 'en';
    return memo(`apple:alert:${id}:${l}`, async () => {
        const body = await appleGet(`/api/v1/weatherAlert/${l}/${id}`, a);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        return {
            id,
            title: body.description || body.summary && body.summary.description || 'Weather alert',
            area: body.areaName || '',
            severity: body.severity || 'unknown',
            source: body.source || '',
            text: messages.map((m) => m.text || '').filter(Boolean).join('\n\n') || body.description || '',
            detailsUrl: body.detailsUrl || null
        };
    }, { ttl: TTL.alert });
}

/** Places for a name (Open-Meteo geocoding): [{ name, region, country, countryCode, lat, lon }]. */
async function geocode(name, count = 8) {
    const q = String(name || '').trim().slice(0, 80);
    if (q.length < 2) return [];
    const c = Math.max(1, Math.min(20, Number(count) || 8));
    return memo(`om:geo:${q.toLowerCase()}:${c}`, async () => {
        const params = new URLSearchParams({ name: q, count: String(c), language: 'en', format: 'json' });
        const body = await request('openmeteo', `${OPEN_METEO.geocode}?${params}`, { timeout: 8000 });
        return ((body && body.results) || []).map((r) => ({
            name: r.name,
            region: r.admin1 || '',
            country: r.country || '',
            countryCode: r.country_code || '',
            lat: Number(r.latitude),
            lon: Number(r.longitude)
        })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    }, { ttl: TTL.geocode, failTtl: MIN, noStale: true });
}

// ------------------------------------------------------------------------------------------ radar

/** Radar frames: [{ time (unix s), id }], newest last, with the tile URL templates on this server. */
async function getRadar() {
    const index = await memo('rv:index', async () => {
        const body = await request('rainviewer', RAINVIEWER_INDEX, { timeout: 8000 });
        const host = String((body && body.host) || '');
        if (!/^https:\/\/[a-z0-9.-]+\.rainviewer\.com$/i.test(host)) throw new WeatherError('RainViewer sent an unexpected tile host', 'BAD_DATA');
        const frames = [].concat((body.radar && body.radar.past) || [], (body.radar && body.radar.nowcast) || [])
            .map((f) => ({ time: Number(f.time), id: String(f.path || '').split('/').pop(), nowcast: false }))
            .filter((f) => Number.isFinite(f.time) && /^[0-9a-f]{6,40}$/i.test(f.id));
        const nowcast = new Set(((body.radar && body.radar.nowcast) || []).map((f) => String(f.path || '').split('/').pop()));
        frames.forEach((f) => { f.nowcast = nowcast.has(f.id); });
        return { host, frames, generated: Number(body.generated) || null };
    }, { ttl: TTL.radarIndex, failTtl: MIN });
    return {
        frames: index.frames,
        generated: index.generated,
        maxZoom: RADAR_MAX_ZOOM,
        radarTile: '/weather/tile/radar/{id}/{z}/{x}/{y}.png',
        baseTile: '/weather/tile/base/{style}/{z}/{x}/{y}.png',
        styles: Object.keys(BASE_STYLES),
        attribution: 'Radar © RainViewer · Map © Esri, HERE, Garmin, © OpenStreetMap contributors'
    };
}

function tileCoords(z, x, y, maxZ) {
    const zi = Number(z);
    const xi = Number(x);
    const yi = Number(y);
    if (![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > maxZ) throw new WeatherError('Bad tile', 'BAD_TILE');
    const span = 2 ** zi;
    if (xi < 0 || yi < 0 || xi >= span || yi >= span) throw new WeatherError('Bad tile', 'BAD_TILE');
    return { z: zi, x: xi, y: yi };
}

/** One tile: { buffer, type }. kind 'radar' (args: id) or 'base' (args: style). */
async function getTile(kind, key, z, x, y) {
    if (kind === 'radar') {
        const t = tileCoords(z, x, y, RADAR_MAX_ZOOM);
        if (!/^[0-9a-f]{6,40}$/i.test(String(key || ''))) throw new WeatherError('Bad radar frame', 'BAD_TILE');
        const index = await getRadar().catch(() => null);
        const known = index && index.frames.some((f) => f.id === key);
        const cached = tileCache.get(`rv:${key}:${t.z}:${t.x}:${t.y}`);
        if (!known && !(cached && cached.ok)) throw new WeatherError('That radar frame has expired', 'GONE');
        const host = (jsonCache.get('rv:index') || {}).value?.host || 'https://tilecache.rainviewer.com';
        // 256 px, colour scheme 2 (Universal Blue), smoothed, snow shown
        return memo(`rv:${key}:${t.z}:${t.x}:${t.y}`, () => request('rainviewer', `${host}/v2/radar/${key}/256/${t.z}/${t.x}/${t.y}/2/1_1.png`, { binary: true, timeout: 10000 }), {
            cache: tileCache, ttl: TTL.radarTile, failTtl: 30 * 1000, size: (v) => v.buffer.length, noStale: true
        });
    }
    if (kind === 'base') {
        const style = BASE_STYLES[key];
        if (!style) throw new WeatherError('Bad map style', 'BAD_TILE');
        const t = tileCoords(z, x, y, 16);
        return memo(`esri:${style}:${t.z}:${t.x}:${t.y}`, () => request('esri', `https://services.arcgisonline.com/ArcGIS/rest/services/${style}/MapServer/tile/${t.z}/${t.y}/${t.x}`, { binary: true, timeout: 10000 }), {
            cache: tileCache, ttl: TTL.baseTile, failTtl: 30 * 1000, size: (v) => v.buffer.length, noStale: true
        });
    }
    throw new WeatherError('Bad tile kind', 'BAD_TILE');
}

/** GET /weather/tile/:kind/:key/:z/:x/:y.png (authenticated: web_server.js). */
async function handleTile(req, res) {
    bind(req.app && req.app.locals && req.app.locals.globalResources);
    const { kind, key, z, x } = req.params;
    const y = String(req.params.y || '').replace(/\.png$/i, '');
    try {
        const tile = await getTile(kind, key, z, x, y);
        res.set('Content-Type', tile.type || 'image/png');
        res.set('Cache-Control', kind === 'base' ? 'private, max-age=604800' : 'private, max-age=1800');
        res.set('X-Content-Type-Options', 'nosniff');
        res.end(tile.buffer);
    } catch (error) {
        const status = error.code === 'BAD_TILE' ? 400 : error.code === 'GONE' ? 410 : error.code === 'RATE_LIMITED' || error.code === 'BUDGET_EXCEEDED' ? 429 : 502;
        res.status(status).set('Cache-Control', 'no-store').json({ success: false, error: error.message, code: error.code });
    }
}

// ------------------------------------------------------------------------------------------ public: key checks

/** Sign a token and ask WeatherKit what it has for a point: proves the account works. */
async function testAccount(account, lat = 40.71, lon = -74.01, country = 'US') {
    const a = account || appleAccount();
    if (!a) throw new WeatherError('No Apple Weather key', 'NO_ACCOUNT');
    const sets = await request('apple', `${APPLE_HOST}/api/v1/availability/${round2(lat)}/${round2(lon)}?country=${country}`, {
        headers: { Authorization: `Bearer ${signAppleToken(a).token}` }, timeout: 12000
    });
    return { ok: true, dataSets: Array.isArray(sets) ? sets : [] };
}

/**
 * Service Keys' status dot (apiKeyHealth PROBES.appleweather). secret: apiKeyManager credentialSecret,
 * the private key then Team ID, Service ID and Key ID on their own lines.
 */
async function testCredential(secret) {
    const lines = String(secret || '').split('\n');
    const keyId = lines.pop();
    const serviceId = lines.pop();
    const teamId = lines.pop();
    const privateKey = lines.join('\n');
    if (!teamId || !serviceId || !keyId || !privateKey) return { state: 'fail', message: 'Team ID, Service ID, Key ID and the private key are all needed' };
    try {
        const r = await testAccount({ teamId, serviceId, keyId, privateKey });
        return { state: 'ok', message: `Key accepted (${r.dataSets.length} data sets)` };
    } catch (error) {
        if (error.code === 'AUTH_FAILED') return { state: 'fail', message: `Refused (HTTP ${error.status})` };
        if (error.code === 'BAD_KEY') return { state: 'fail', message: error.message };
        return { state: 'warn', message: error.message };
    }
}

function usage() {
    return Object.fromEntries(Object.entries(limiters).map(([k, l]) => [k, l.stats()]));
}

/**
 * Dynamic generation's cache (was its own getCachedWeatherData): the same memo, with its configured
 * durations (lruCache.weatherDuration / weatherFailureDuration). fn resolves null on failure.
 */
async function cached(key, fn) {
    const lru = config('lruCache', {}) || {};
    const ttl = lru.weatherDuration || 3 * MIN;
    const failTtl = lru.weatherFailureDuration || 15 * MIN;
    try {
        return await memo(`dg:${key}`, async () => {
            const v = await fn();
            if (v === null || v === undefined) throw new WeatherError('No weather data', 'NO_DATA');
            return v;
        }, { ttl, failTtl, noStale: true });
    } catch (_e) {
        return null;
    }
}

module.exports = {
    bind,
    getForecast,
    gadgetShape,
    getAlert,
    geocode,
    getRadar,
    getTile,
    handleTile,
    testCredential,
    normalisePrivateKey,
    startAlertMonitor,
    pollAlerts,
    getActiveAlerts,
    activeProvider,
    usage,
    cached,
    openMeteoRaw,
    WeatherError,
    _test: { normaliseApple, normaliseOpenMeteo, signAppleToken, normalisePrivateKey, memo, Limiter, Lru, localIso, offsetAt, appleCondition, nextHourSummary, jsonCache, limiters }
};
