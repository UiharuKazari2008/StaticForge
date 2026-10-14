/**
 * Windows Sidebar gadgets on the Vista desktop (Yozora #486). Per-workspace state lives in the
 * workspace record under `sidebar`; the client is public/scripts/comp/vistaSidebar.js and the
 * packets are modules/ws/handlers/290-sidebarHandler.js (administrators only).
 */
const {
    isPrivateOrLocalIP,
    getConfiguredLocation,
    getClientIPLocation,
    getCachedWeatherData,
    bindRuntimeGlobalResources
} = require('./dynamicGenerationHandlers');
const { getHostMetrics } = require('./pm2Service');

const GADGET_TYPES = ['calendar', 'clock', 'cpu', 'mail', 'notes', 'puzzle', 'slideshow', 'weather'];
const MAX_GADGETS = 24;
const MAX_STATE_BYTES = 64 * 1024;
const NOTE_COLORS = ['yellow', 'purple', 'blue', 'green', 'pink', 'white'];
const NOTE_SIZES = [12, 13, 15, 16, 18, 20, 22];
const NOTE_FONTS = ['Segoe Print', 'Segoe Script', 'Segoe UI', 'Calibri', 'Cambria', 'Consolas', 'Constantia', 'Corbel', 'Arial', 'Times New Roman'];
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
            return {
                theme: clampInt(s.theme, 0, 7, 0),
                name: text(s.name, 30),
                timeZone: isTimeZone(s.timeZone) ? s.timeZone : '',
                seconds: bool(s.seconds, false)
            };
        case 'calendar':
            return { view: pick(s.view, ['day', 'month'], 'day') };
        case 'notes': {
            const notes = (Array.isArray(s.notes) ? s.notes : []).slice(0, MAX_NOTES).map((n) => text(n, MAX_NOTE_LENGTH));
            if (!notes.length) notes.push('');
            return {
                color: pick(s.color, NOTE_COLORS, 'yellow'),
                font: pick(s.font, NOTE_FONTS, 'Segoe Print'),
                size: pick(Number(s.size), NOTE_SIZES, 12),
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
            return { unreadOnly: bool(s.unreadOnly, false) };
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
        if (!g || !GADGET_TYPES.includes(g.type)) continue;
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
            settings: sanitizeGadgetSettings(g.type, g.settings)
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

module.exports = {
    GADGET_TYPES,
    SidebarStateError,
    sanitizeSidebarState,
    pickWorkspaceImage,
    pickSearchImage,
    sanitizeFrameSearch,
    getClientWeather,
    getHostLoad
};
