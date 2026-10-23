/**
 * Windows Sidebar gadgets on the Vista desktop (Yozora #486). Per-workspace state lives in the
 * workspace record under `sidebar`; the client is public/scripts/comp/vistaSidebar.js and the
 * packets are modules/ws/handlers/290-sidebarHandler.js (administrators only).
 */
const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');
const path = require('path');
const {
    isPrivateOrLocalIP,
    getConfiguredLocation,
    getClientIPLocation,
    getCachedWeatherData,
    bindRuntimeGlobalResources
} = require('./dynamicGenerationHandlers');
const { getHostMetrics } = require('./pm2Service');

const GADGET_TYPES = ['calendar', 'calculator', 'clipboard', 'clock', 'contacts', 'cpu', 'currency', 'deskcalc', 'feed', 'hero', 'mail', 'notes', 'outlook', 'puzzle', 'slideshow', 'stocks', 'timer', 'weather'];
const FX_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR'];
const FX_TTL_MS = 6 * 60 * 60 * 1000;
const QUOTE_TTL_MS = 3 * 60 * 1000;
const FEED_TTL_MS = 10 * 60 * 1000;
const FEED_MAX_BYTES = 256 * 1024;
const MAX_QUOTE_CACHE = 48;
const MAX_FEED_CACHE = 16;
const CALC_COLORS = ['grey', 'pink', 'yellow'];
const DESK_COLORS = ['plain', 'aqua', 'black', 'blue', 'green', 'pink', 'red', 'white', 'yellow'];
const CALC_OPS = ['', '+', '-', '*', '/', 'pow'];
const MAX_GADGETS = 24;
const MAX_STATE_BYTES = 64 * 1024;
const NOTE_COLORS = ['yellow', 'purple', 'blue', 'green', 'pink', 'white'];
const NOTE_SIZES = [8, 9, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 32, 37, 48];
const NOTE_FONTS = [
    'Segoe Print', 'Segoe Script', 'Segoe UI', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel',
    'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS',
    'Noto Sans', 'Atkinson Hyperlegible Next', 'Trebuchet MS',
    'Zen Kurenaido', 'Kaisei Decol', 'Zen Antique', 'Solway', 'Eczar', 'Bodoni Moda', 'Texturina',
    'Space Grotesk', 'Share Tech Mono', 'IBM Plex Mono', 'DotGothic16'
];
const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 1000;
const SLIDE_SECONDS = [5, 10, 15, 30, 60, 120, 300];
const SLIDE_TRANSITIONS = ['none', 'random', 'fade', 'wipe', 'iris', 'slide', 'push'];
const IMAGE_SOURCES = ['images', 'pinned'];
const WEATHER_PLACE_ALTS = ['none', 'hilo', 'rain', 'condition', 'uv'];
const SEARCH_VIEW_TYPES = ['images', 'scraps', 'pinned', 'upscaled'];
const SEARCH_MATCH_MODES = ['substring', 'word', 'inner', 'start', 'end'];
const MAX_SEARCH_BYTES = 4096;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE = 24;
const SLIDE_SCALE_MIN = 1;
const SLIDE_SCALE_MAX = 2.5;
const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;
const LOCATION_FAILURE_TTL_MS = 15 * 60 * 1000;

class SidebarStateError extends Error {}

// Hosted gadgets (Yozora #629): packages unpacked by scripts/import-vista-gadget.js and listed in
// public/static_images/vista-gadgets/catalog.json. Their System.Gadget.Settings live in settings.store.
const HOSTED_CATALOG = path.join(__dirname, '..', 'public', 'static_images', 'vista-gadgets', 'catalog.json');
const HOSTED_KEY_RE = /^[A-Za-z0-9_.:\- ]{1,64}$/;
const MAX_HOSTED_KEYS = 64;
const MAX_HOSTED_VALUE = 4096;
const MAX_HOSTED_BYTES = 16 * 1024;
let hostedCatalog = { mtimeMs: -1, ids: new Set() };

/** Hosted gadget ids, re-read when the catalog file changes (an import needs no restart). */
function hostedGadgetIds() {
    try {
        const { mtimeMs } = fs.statSync(HOSTED_CATALOG);
        if (mtimeMs !== hostedCatalog.mtimeMs) {
            const list = JSON.parse(fs.readFileSync(HOSTED_CATALOG, 'utf8')).gadgets || [];
            const ids = new Set(list.map((g) => g && g.id).filter((id) => typeof id === 'string' && !GADGET_TYPES.includes(id)));
            hostedCatalog = { mtimeMs, ids };
        }
    } catch (_e) {
        if (hostedCatalog.mtimeMs !== -1) hostedCatalog = { mtimeMs: -1, ids: new Set() };
    }
    return hostedCatalog.ids;
}

/** System.Gadget.Settings values: strings, finite numbers and booleans under a small key / byte budget. */
function sanitizeHostedSettings(raw) {
    const src = raw && typeof raw === 'object' && raw.store && typeof raw.store === 'object' && !Array.isArray(raw.store) ? raw.store : {};
    const store = {};
    let bytes = 0;
    let keys = 0;
    for (const [key, value] of Object.entries(src)) {
        if (keys >= MAX_HOSTED_KEYS || !HOSTED_KEY_RE.test(key)) continue;
        let v;
        if (typeof value === 'string') v = value.slice(0, MAX_HOSTED_VALUE);
        else if (typeof value === 'number' && Number.isFinite(value)) v = value;
        else if (typeof value === 'boolean') v = value;
        else continue;
        bytes += key.length + (typeof v === 'string' ? v.length : 8);
        if (bytes > MAX_HOSTED_BYTES) break;
        store[key] = v;
        keys += 1;
    }
    return { store };
}

/** A Slide Show frame's Image Search query (omegasearch_query fields); null when unusable. */
function sanitizeFrameSearch(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) return null;
    const blocks = raw.blocks.slice(0, 20).map((b) => {
        const terms = (b && Array.isArray(b.terms) ? b.terms : []).slice(0, 20).map((t) => text(t, 200).trim()).filter(Boolean);
        if (!terms.length) return null;
        const or = b.mode === 'or' || b.orWithinBlock === true;
        return { terms, matchMode: pick(b.matchMode, SEARCH_MATCH_MODES, 'substring'), orWithinBlock: or, mode: or ? 'or' : 'and' };
    }).filter(Boolean);
    if (!blocks.length) return null;
    const filters = raw.filters && typeof raw.filters === 'object' && !Array.isArray(raw.filters) ? raw.filters : {};
    const search = {
        blocks,
        workspaceId: text(raw.workspaceId, 100) || '*',
        viewType: pick(raw.viewType, SEARCH_VIEW_TYPES, 'images'),
        promptSource: pick(raw.promptSource, ['compiled', 'input'], ''),
        filters,
        blockOptions: { defaultMatchMode: pick(raw.blockOptions && raw.blockOptions.defaultMatchMode, SEARCH_MATCH_MODES, 'substring') },
        label: text(raw.label, 200)
    };
    return JSON.stringify(search).length <= MAX_SEARCH_BYTES ? search : null;
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const clampInt = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const numOrNull = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : null;
};

/** Shared arithmetic state for Calculator and Desktop Calculator. */
function sanitizeCalcCore(s) {
    const history = (Array.isArray(s.history) ? s.history : []).slice(0, 8).map((line) => text(line, 40)).filter(Boolean);
    return {
        entry: text(s.entry, 16) || '0',
        acc: numOrNull(s.acc),
        op: pick(s.op, CALC_OPS, ''),
        fresh: bool(s.fresh, true),
        memory: numOrNull(s.memory),
        history
    };
}

function isTimeZone(zone) {
    if (!zone) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return true;
    } catch (_e) {
        return false;
    }
}

function sanitizeGadgetSettings(type, raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    switch (type) {
        case 'clock':
        case 'hero':
            return {
                theme: clampInt(s.theme, 0, type === 'hero' ? 11 : 7, 0),
                name: text(s.name, 30),
                timeZone: isTimeZone(s.timeZone) ? s.timeZone : '',
                seconds: bool(s.seconds, false)
            };
        case 'calculator':
            return {
                ...sanitizeCalcCore(s),
                color: pick(s.color, CALC_COLORS, 'grey'),
                historyOn: bool(s.historyOn, true)
            };
        case 'deskcalc':
            return { ...sanitizeCalcCore(s), color: pick(s.color, DESK_COLORS, 'plain') };
        case 'timer':
            return {
                endAt: clampInt(s.endAt, 0, Date.now() + 100 * 60 * 1000, 0),
                mins: clampInt(s.mins, 0, 60, 0),
                secs: clampInt(s.secs, 0, 59, 0),
                ringing: bool(s.ringing, false)
            };
        case 'clipboard':
            return {
                items: (Array.isArray(s.items) ? s.items : []).slice(0, 16).map((item) => text(item, 160)).filter(Boolean)
            };
        case 'outlook':
            return { unreadOnly: bool(s.unreadOnly, false) };
        case 'contacts': {
            const cards = (Array.isArray(s.cards) ? s.cards : []).slice(0, 8).map((c) => ({
                name: text(c && c.name, 40),
                email: text(c && c.email, 80),
                phone: text(c && c.phone, 24)
            })).filter((c) => c.name || c.email || c.phone);
            if (!cards.length) cards.push({ name: '', email: '', phone: '' });
            return { cards, current: clampInt(s.current, 0, cards.length - 1, 0) };
        }
        case 'currency':
            return {
                amount: moneyAmount(s.amount, 1),
                from: pick(String(s.from || '').toUpperCase(), FX_CODES, 'USD'),
                to: pick(String(s.to || '').toUpperCase(), FX_CODES, 'EUR')
            };
        case 'feed':
            return { url: httpsFeedUrl(s.url), count: pick(Number(s.count), [3, 4, 5, 6], 3) };
        case 'stocks': {
            const symbols = [];
            for (const raw of Array.isArray(s.symbols) ? s.symbols : []) {
                const sym = stockSymbol(raw);
                if (sym && !symbols.includes(sym)) symbols.push(sym);
                if (symbols.length >= 4) break;
            }
            return { symbols };
        }
        case 'calendar':
            return { view: pick(s.view, ['day', 'month'], 'day') };
        case 'notes': {
            const notes = (Array.isArray(s.notes) ? s.notes : []).slice(0, MAX_NOTES).map((n) => text(n, MAX_NOTE_LENGTH));
            if (!notes.length) notes.push('');
            return {
                color: pick(s.color, NOTE_COLORS, 'yellow'),
                font: pick(s.font, NOTE_FONTS, 'Segoe Print'),
                size: pick(Number(s.size), NOTE_SIZES, 12),
                readOnly: bool(s.readOnly, false),
                notes,
                current: clampInt(s.current, 0, notes.length - 1, 0),
                noteId: text(s.noteId, 100)
            };
        }
        case 'puzzle': {
            const tiles = Array.isArray(s.tiles) && s.tiles.length === 16
                && [...s.tiles].sort((a, b) => a - b).every((v, i) => v === i) ? s.tiles.slice() : null;
            return {
                source: pick(s.source, IMAGE_SOURCES, 'images'),
                base: text(s.base, 300),
                tiles,
                seconds: clampInt(s.seconds, 0, 359999, 0)
            };
        }
        case 'slideshow':
            return {
                source: pick(s.source, IMAGE_SOURCES, 'images'),
                seconds: pick(Number(s.seconds), SLIDE_SECONDS, 15),
                transition: pick(s.transition, SLIDE_TRANSITIONS, 'none'),
                shuffle: bool(s.shuffle, true),
                shape: pick(s.shape, ['landscape', 'square', 'portrait'], 'landscape'),
                scale: Number.isFinite(Number(s.scale)) ? Math.round(Math.min(SLIDE_SCALE_MAX, Math.max(SLIDE_SCALE_MIN, Number(s.scale))) * 100) / 100 : 1,
                search: sanitizeFrameSearch(s.search)
            };
        case 'weather':
            return {
                unit: pick(s.unit, ['F', 'C'], 'F'),
                feelsLike: bool(s.feelsLike, false),
                hidePlace: bool(s.hidePlace, false),
                placeAlt: pick(s.placeAlt, WEATHER_PLACE_ALTS, 'none')
            };
        case 'mail':
            return {
                unreadOnly: bool(s.unreadOnly, false),
                count: pick(Number(s.count), [3, 4, 5, 6], 3)
            };
        default:
            return {};
    }
}

/** Normalises a client-sent sidebar state; throws SidebarStateError when it is unusable. */
function sanitizeSidebarState(raw) {
    if (!raw || typeof raw !== 'object') throw new SidebarStateError('Sidebar state must be an object');
    if (JSON.stringify(raw).length > MAX_STATE_BYTES) throw new SidebarStateError('Sidebar state is too large');
    const seen = new Set();
    const gadgets = [];
    for (const g of Array.isArray(raw.gadgets) ? raw.gadgets : []) {
        const hosted = !!g && !GADGET_TYPES.includes(g.type) && hostedGadgetIds().has(g.type);
        if (!g || !(GADGET_TYPES.includes(g.type) || hosted)) continue;
        const id = text(g.id, 40).replace(/[^A-Za-z0-9_-]/g, '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        gadgets.push({
            id,
            type: g.type,
            docked: bool(g.docked, true),
            x: clampInt(g.x, 0, 10000, 0),
            y: clampInt(g.y, 0, 10000, 0),
            onTop: bool(g.onTop, false),
            opacity: pick(Number(g.opacity), [20, 40, 60, 80, 100], 100),
            settings: hosted ? sanitizeHostedSettings(g.settings) : sanitizeGadgetSettings(g.type, g.settings)
        });
        if (gadgets.length >= MAX_GADGETS) break;
    }
    return {
        enabled: bool(raw.enabled, false),
        closed: bool(raw.closed, false),
        side: pick(raw.side, ['right', 'left'], 'right'),
        onTop: bool(raw.onTop, false),
        gadgets
    };
}

/** One image from a workspace's gallery: `offset` walks newest-first, no offset is random. */
async function pickWorkspaceImage(metadataDb, workspaceId, source, offset) {
    const view = pick(source, IMAGE_SOURCES, 'images');
    const head = await metadataDb.listWorkspaceGalleryItemsPaginated(workspaceId, view, 0, 0);
    const total = head && head.totalItems ? Number(head.totalItems) : 0;
    if (!total) return { total: 0, index: -1, item: null };
    const index = Number.isInteger(offset) ? ((offset % total) + total) % total : Math.floor(Math.random() * total);
    const page = await metadataDb.listWorkspaceGalleryItemsPaginated(workspaceId, view, index, 1);
    const row = page && page.items && page.items[0];
    if (!row) return { total, index: -1, item: null };
    return {
        total,
        index,
        item: { base: row.base, original: row.original, upscaled: row.upscaled, width: row.width, height: row.height }
    };
}

const searchFrameCache = new Map();

/** A picture from a frame's Image Search; `runSearch(search)` resolves the matching filenames, cached per query. */
async function pickSearchImage(metadataDb, search, offset, runSearch) {
    const key = JSON.stringify(search);
    const now = Date.now();
    let entry = searchFrameCache.get(key);
    if (!entry || entry.expiresAt < now) {
        entry = { filenames: await runSearch(search), expiresAt: now + SEARCH_CACHE_TTL_MS };
        searchFrameCache.delete(key);
        searchFrameCache.set(key, entry);
        while (searchFrameCache.size > MAX_SEARCH_CACHE) searchFrameCache.delete(searchFrameCache.keys().next().value);
    }
    const total = entry.filenames.length;
    if (!total) return { total: 0, index: -1, item: null };
    const index = Number.isInteger(offset) ? ((offset % total) + total) % total : Math.floor(Math.random() * total);
    const filename = entry.filenames[index];
    const meta = (await metadataDb.getMultipleMetadata([filename]))[filename] || {};
    const upscaled = !!meta.upscaled || /_upscaled\.[a-z]+$/i.test(filename);
    return {
        total,
        index,
        item: {
            base: filename.replace(/\.(png|jpg|jpeg|webp)$/i, '').replace(/_upscaled$/, ''),
            original: upscaled ? null : filename,
            upscaled: upscaled ? filename : null,
            width: meta.width || null,
            height: meta.height || null
        }
    };
}

/** Client IP location as dynamic gen resolves it; LAN or failed lookups use the configured home. Never the host's own IP. */
async function resolveClientLocation(globalResources, clientIP) {
    const ip = String(clientIP || '').trim().replace(/^::ffff:/i, '');
    if (ip && !isPrivateOrLocalIP(ip)) {
        const cache = globalResources.getLocationCache();
        const key = `sidebar_ip_${ip}`;
        const cached = cache.get(key);
        const age = cached ? Date.now() - cached.timestamp : Infinity;
        if (cached && cached.data && age < LOCATION_TTL_MS) return cached.data;
        if (!(cached && !cached.data && age < LOCATION_FAILURE_TTL_MS)) {
            const located = await getClientIPLocation(ip);
            cache.set(key, { data: located, timestamp: Date.now() });
            if (located) return located;
        }
    }
    const configured = getConfiguredLocation();
    return configured ? { ...configured, source: 'configured' } : null;
}

/** Place name for coordinates (the configured home has none of its own), cached with the IP lookups. */
async function reverseGeocode(globalResources, lat, lon) {
    const cache = globalResources.getLocationCache();
    const key = `sidebar_rev_${lat}_${lon}`;
    const cached = cache.get(key);
    const age = cached ? Date.now() - cached.timestamp : Infinity;
    if (cached && age < (cached.data ? LOCATION_TTL_MS : LOCATION_FAILURE_TTL_MS)) return cached.data;
    let data = null;
    try {
        const params = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'en' });
        const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`, { signal: AbortSignal.timeout(8000) });
        const body = response.ok ? await response.json() : null;
        const city = body && (body.city || body.locality);
        if (city) data = { city, region: body.principalSubdivision || '', country: body.countryName || '' };
    } catch (_e) { /* label falls back to the timezone city */ }
    cache.set(key, { data, timestamp: Date.now() });
    return data;
}

async function fetchOpenMeteo(lat, lon) {
    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: 'temperature_2m,apparent_temperature,weather_code,is_day',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,uv_index_max',
        forecast_days: '4',
        timezone: 'auto'
    });
    try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) return null;
        const body = await response.json();
        if (!body || !body.current) return null;
        const d = body.daily || {};
        return {
            current: { tempC: body.current.temperature_2m, feelsC: body.current.apparent_temperature, code: body.current.weather_code, isDay: body.current.is_day === 1 },
            daily: (d.time || []).map((date, i) => ({
                date,
                code: d.weather_code ? d.weather_code[i] : null,
                maxC: d.temperature_2m_max ? d.temperature_2m_max[i] : null,
                minC: d.temperature_2m_min ? d.temperature_2m_min[i] : null,
                feelsMaxC: d.apparent_temperature_max ? d.apparent_temperature_max[i] : null,
                feelsMinC: d.apparent_temperature_min ? d.apparent_temperature_min[i] : null,
                rainChance: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
                uvMax: d.uv_index_max ? d.uv_index_max[i] : null
            }))
        };
    } catch (_e) {
        return null;
    }
}

/** Current conditions and a 4-day forecast for the client, through the shared weather cache. */
async function getClientWeather(globalResources, clientIP) {
    // dynamic gen only binds its runtime on its own entry points; until one runs after a restart its config reads return nothing
    bindRuntimeGlobalResources(globalResources);
    const location = await resolveClientLocation(globalResources, clientIP);
    if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lon))) {
        return { available: false };
    }
    const lat = Number(location.lat).toFixed(2);
    const lon = Number(location.lon).toFixed(2);
    const weather = await getCachedWeatherData(`sidebar_${lat}_${lon}`, () => fetchOpenMeteo(lat, lon));
    if (!weather) return { available: false };
    const place = location.configured ? await reverseGeocode(globalResources, lat, lon) : null;
    return {
        available: true,
        location: {
            city: location.configured
                ? (place ? place.city : String(location.timezone || '').split('/').pop().replace(/_/g, ' '))
                : (location.city || ''),
            region: place ? place.region : (location.region || ''),
            country: place ? place.country : (location.configured ? '' : (location.country || '')),
            source: location.source || (location.configured ? 'configured' : 'client_ip')
        },
        ...weather
    };
}

function getHostLoad() {
    const m = getHostMetrics();
    return { cpu: m.hostCpuPercent, ram: m.hostRamPercent };
}

function moneyAmount(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) return fallback;
    return Math.round(n * 10000) / 10000;
}

function stockSymbol(value) {
    const sym = String(value || '').trim().toUpperCase();
    return /^[A-Z0-9.^]{1,12}$/.test(sym) ? sym : '';
}

/** https only, no credentials, no single-label or private hosts. DNS is checked at fetch time. */
function httpsFeedUrl(value) {
    let url;
    try { url = new URL(text(value, 300).trim()); } catch (_e) { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return '';
    if (net.isIP(host)) {
        if (isBlockedAddress(host)) return '';
    } else if (!host.includes('.')) {
        return '';
    }
    return url.href;
}

function isBlockedAddress(ip) {
    const v = String(ip || '').trim().replace(/^::ffff:/i, '');
    if (!v || v === '::') return true;
    return isPrivateOrLocalIP(v);
}

async function assertPublicHttps(raw) {
    const href = httpsFeedUrl(raw);
    if (!href) return null;
    const url = new URL(href);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!net.isIP(host)) {
        let addrs;
        try { addrs = await dns.lookup(host, { all: true }); } catch (_e) { return null; }
        if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) return null;
    }
    return url;
}

async function fetchPublicHttps(raw) {
    let current = raw;
    for (let hop = 0; hop < 4; hop++) {
        const url = await assertPublicHttps(current);
        if (!url) return null;
        let response;
        try {
            response = await fetch(url.href, {
                redirect: 'manual',
                signal: AbortSignal.timeout(8000),
                headers: { 'User-Agent': 'Dreamscape', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
            });
        } catch (_e) {
            return null;
        }
        if (response.status >= 300 && response.status < 400) {
            const loc = response.headers.get('location');
            if (!loc) return null;
            current = new URL(loc, url).href;
            continue;
        }
        if (!response.ok) return null;
        const advertised = Number(response.headers.get('content-length') || 0);
        if (advertised > FEED_MAX_BYTES) return null;
        const buf = await response.arrayBuffer();
        if (buf.byteLength > FEED_MAX_BYTES) return null;
        return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    return null;
}

function xmlChar(n) {
    if (!Number.isFinite(n) || n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '';
    return String.fromCodePoint(n);
}

function decodeXml(value) {
    return String(value || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => xmlChar(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => xmlChar(Number(d)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/<[^>]+>/g, '')
        .trim();
}

function xmlBlock(block, name) {
    const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i').exec(block);
    return m ? decodeXml(m[1]) : '';
}

function atomHref(block) {
    const tags = block.match(/<(?:[\w.-]+:)?link\b[^>]*>/gi) || [];
    let href = '';
    for (const tag of tags) {
        const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag);
        const found = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
        if (!found) continue;
        if (!rel || rel[1] === 'alternate') return decodeXml(found[1]);
        if (!href) href = decodeXml(found[1]);
    }
    return href;
}

function parseFeedXml(xml) {
    const items = [];
    const chunks = String(xml || '').match(/<(?:[\w.-]+:)?(?:item|entry)\b[\s\S]*?<\/(?:[\w.-]+:)?(?:item|entry)>/gi) || [];
    for (const chunk of chunks) {
        const title = xmlBlock(chunk, 'title').replace(/\s+/g, ' ');
        if (!title) continue;
        const link = httpsFeedUrl(xmlBlock(chunk, 'link') || atomHref(chunk));
        const date = xmlBlock(chunk, 'pubDate') || xmlBlock(chunk, 'updated') || xmlBlock(chunk, 'published');
        items.push({ title: title.slice(0, 180), link, date: date.slice(0, 40) });
        if (items.length >= 12) break;
    }
    const head = String(xml || '').split(/<(?:[\w.-]+:)?(?:item|entry)\b/i)[0] || '';
    const title = (xmlBlock(head, 'title') || 'Feed Headlines').replace(/\s+/g, ' ').slice(0, 60);
    return items.length ? { title, items } : null;
}

const fxCache = { at: 0, date: '', rates: null };
const quoteCache = new Map();
const feedCache = new Map();

function cacheSet(map, key, value, max) {
    map.delete(key);
    map.set(key, value);
    while (map.size > max) map.delete(map.keys().next().value);
}

/** ECB rates via Frankfurter, cached for a few hours. `rate` converts 1 `from` into `to`. */
async function getFxRate(from, to) {
    const base = pick(String(from || '').toUpperCase(), FX_CODES, '');
    const quote = pick(String(to || '').toUpperCase(), FX_CODES, '');
    if (!base || !quote) return { available: false };
    if (!fxCache.rates || Date.now() - fxCache.at > FX_TTL_MS) {
        try {
            const response = await fetch('https://api.frankfurter.dev/v1/latest?from=USD', { signal: AbortSignal.timeout(8000) });
            const body = response.ok ? await response.json() : null;
            if (!body || !body.rates) return { available: false };
            fxCache.at = Date.now();
            fxCache.date = text(body.date, 16);
            fxCache.rates = { USD: 1, ...body.rates };
        } catch (_e) {
            return { available: false };
        }
    }
    const fromUsd = Number(fxCache.rates[base]);
    const toUsd = Number(fxCache.rates[quote]);
    if (!fromUsd || !toUsd) return { available: false };
    return { available: true, from: base, to: quote, date: fxCache.date, rate: toUsd / fromUsd };
}

async function fetchYahooQuote(symbol) {
    const cached = quoteCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return cached.quote;
    let quote = { symbol, available: false };
    try {
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Dreamscape' }
        });
        const body = response.ok ? await response.json() : null;
        const meta = body && body.chart && body.chart.result && body.chart.result[0] && body.chart.result[0].meta;
        const price = meta ? Number(meta.regularMarketPrice) : NaN;
        const prev = meta ? Number(meta.chartPreviousClose) : NaN;
        if (meta && Number.isFinite(price) && Math.abs(price) < 1e12) {
            quote = {
                symbol: stockSymbol(meta.symbol) || symbol,
                name: text(meta.shortName || meta.longName || symbol, 40),
                price,
                prev: Number.isFinite(prev) ? prev : null,
                currency: text(meta.currency, 8),
                available: true
            };
        }
    } catch (_e) { /* unavailable quote */ }
    cacheSet(quoteCache, symbol, { quote, expiresAt: Date.now() + QUOTE_TTL_MS }, MAX_QUOTE_CACHE);
    return quote;
}

/** Last price for up to four symbols (Yahoo chart). */
async function getQuotes(symbols) {
    const list = [];
    for (const raw of Array.isArray(symbols) ? symbols : []) {
        const sym = stockSymbol(raw);
        if (sym && !list.includes(sym)) list.push(sym);
        if (list.length >= 4) break;
    }
    const quotes = await Promise.all(list.map(fetchYahooQuote));
    return { quotes };
}

/** RSS or Atom headlines. The address is https-only and must resolve to a public host. */
async function getFeed(url) {
    const href = httpsFeedUrl(url);
    if (!href) return { available: false };
    const cached = feedCache.get(href);
    if (cached && cached.expiresAt > Date.now()) return cached.feed;
    const xml = await fetchPublicHttps(href);
    const parsed = xml ? parseFeedXml(xml) : null;
    const feed = parsed ? { available: true, title: parsed.title, items: parsed.items } : { available: false };
    cacheSet(feedCache, href, { feed, expiresAt: Date.now() + FEED_TTL_MS }, MAX_FEED_CACHE);
    return feed;
}

module.exports = {
    assertPublicHttps,
    GADGET_TYPES,
    hostedGadgetIds,
    sanitizeHostedSettings,
    SidebarStateError,
    sanitizeSidebarState,
    pickWorkspaceImage,
    pickSearchImage,
    sanitizeFrameSearch,
    getClientWeather,
    getHostLoad,
    getFxRate,
    getQuotes,
    getFeed
};
