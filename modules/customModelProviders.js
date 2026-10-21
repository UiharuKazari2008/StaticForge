'use strict';

// Custom Director engines. Each one is an OpenAI-compatible chat-completions
// host. Wren and Xi still run the Claude CLI; modules/tokenRouterBridge.js
// relays that CLI to the provider named in the x-dreamscape-provider header.
// The bearer token stays in secure.config.json customModelProviders.keys[]
// (key name = id). A TokenRouter URL can also store managementKey on that
// entry. The public row is config.json customModelProviders[]. The host kind
// (tokenrouter, openai, google, openrouter, generic) comes from the URL.
// Google's OpenAI path is {baseUrl}/chat/completions; everyone else is
// {baseUrl}/v1/chat/completions. TokenRouter catalogs come from /api/pricing.
// monitorUsage off means no usage cap and the Director badge stays hidden.
// A PNG logo lives in data/provider-logos/<id>.png. Upstream /v1/models
// payloads can echo other hosts' keys under _provider; only id and name are kept.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const ENGINE_RE = /^custom:([a-z][a-z0-9_-]{0,31})$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/;
const EFFORTS = ['none', 'low', 'medium', 'high'];
const OBLITERATED_STORE = 'obliterated';
const CATALOG_TTL_MS = 10 * 60 * 1000;
const STATUS_TIMEOUT_MS = 12000;

const catalogs = new Map();
const LOGO_MAX_BYTES = 64 * 1024;
let logoDirectory = path.join(__dirname, '..', 'data', 'provider-logos');

// Presets only fill the form. The host kind is read from the saved URL.
const PRESETS = [
    { id: 'google', name: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com' },
    { id: 'tokenrouter', name: 'TokenRouter', baseUrl: 'https://api.tokenrouter.com' },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api' }
];

function hostKind(baseUrl) {
    let host = '';
    let pathName = '';
    try {
        const url = new URL(String(baseUrl || ''));
        host = url.hostname.toLowerCase();
        pathName = url.pathname.toLowerCase();
    } catch (_) {
        return 'generic';
    }
    if (host === 'api.tokenrouter.com' || host.endsWith('.tokenrouter.com')) return 'tokenrouter';
    if (host === 'api.openai.com') return 'openai';
    if (host === 'generativelanguage.googleapis.com' || (host.endsWith('.googleapis.com') && pathName.includes('/openai'))) return 'google';
    if (host === 'openrouter.ai') return 'openrouter';
    return 'generic';
}

function endpointsFor(baseUrl, kind) {
    if (kind === 'google') {
        return { chatUrl: `${baseUrl}/chat/completions`, modelsUrl: `${baseUrl}/models` };
    }
    if (kind === 'tokenrouter') {
        return { chatUrl: `${baseUrl}/v1/chat/completions`, modelsUrl: `${baseUrl}/api/pricing` };
    }
    return { chatUrl: `${baseUrl}/v1/chat/completions`, modelsUrl: `${baseUrl}/v1/models` };
}

function logoFile(id) {
    return path.join(logoDirectory, `${id}.png`);
}

function readLogo(id) {
    try {
        const buf = fs.readFileSync(logoFile(id));
        if (!buf.length || buf.length > LOGO_MAX_BYTES) return '';
        return `data:image/png;base64,${buf.toString('base64')}`;
    } catch (_) {
        return '';
    }
}

function writeLogo(id, dataUrl) {
    if (dataUrl == null) return;
    if (dataUrl === '') {
        try { fs.unlinkSync(logoFile(id)); } catch (_) { /* already gone */ }
        return;
    }
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!match) {
        const error = new Error('Provider logo must be a PNG.');
        error.code = 'CUSTOM_PROVIDER_LOGO';
        throw error;
    }
    const buf = Buffer.from(match[1], 'base64');
    if (buf.length > LOGO_MAX_BYTES || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
        const error = new Error('Provider logo must be a PNG under 64 KB.');
        error.code = 'CUSTOM_PROVIDER_LOGO';
        throw error;
    }
    fs.mkdirSync(logoDirectory, { recursive: true });
    fs.writeFileSync(logoFile(id), buf);
}

function isEngine(value) {
    return ENGINE_RE.test(String(value || '').trim().toLowerCase());
}

function providerId(engine) {
    const match = ENGINE_RE.exec(String(engine || '').trim().toLowerCase());
    return match ? match[1] : '';
}

function engineFor(id) {
    return `custom:${id}`;
}

function cacheHome() {
    // Same directory as modules/cursorDirector.js directorHome().
    return path.join(os.homedir(), '.cache', 'dreamscape-director');
}

function normalizeBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let url;
    try { url = new URL(raw); } catch (_) { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const pathName = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '');
    return `${url.origin}${pathName === '/' ? '' : pathName}`;
}

function readRows(gr) {
    if (!gr || typeof gr.getConfig !== 'function') return [];
    let rows;
    try { rows = gr.getConfig({ path: 'customModelProviders' }); } catch (_) { return []; }
    return Array.isArray(rows) ? rows : [];
}

function readKeys(gr) {
    if (!gr || typeof gr.getSecureConfig !== 'function') return [];
    let block;
    try { block = gr.getSecureConfig({ path: 'customModelProviders' }); } catch (_) { return []; }
    const keys = block && Array.isArray(block.keys) ? block.keys : [];
    return keys.filter((row) => row && row.apiKey);
}

function keyRow(gr, id) {
    return readKeys(gr).find((item) => String(item.name || '').trim().toLowerCase() === id) || null;
}

function apiKeyFor(gr, id) {
    const row = keyRow(gr, id);
    return row ? String(row.apiKey).trim() : '';
}

function managementKeyFor(gr, id) {
    const row = keyRow(gr, id);
    return row && row.managementKey ? String(row.managementKey).trim() : '';
}

function rowById(gr, id) {
    if (!ID_RE.test(id)) return null;
    const row = readRows(gr).find((item) => item && String(item.id || '').trim().toLowerCase() === id);
    if (!row) return null;
    const baseUrl = normalizeBaseUrl(row.baseUrl);
    if (!baseUrl) return null;
    const name = String(row.name || id).trim().slice(0, 60) || id;
    const wanted = String(row.defaultModel || '').trim();
    const kind = hostKind(baseUrl);
    return {
        id,
        engine: engineFor(id),
        name,
        baseUrl,
        kind,
        ...endpointsFor(baseUrl, kind),
        defaultModel: MODEL_ID_RE.test(wanted) ? wanted : '',
        obliteratedMemories: row.obliteratedMemories === true,
        ageTool: row.ageTool !== false,
        monitorUsage: row.monitorUsage === true,
        apiKey: apiKeyFor(gr, id),
        managementKey: managementKeyFor(gr, id),
        logo: readLogo(id)
    };
}

// A provider row, an engine id (custom:<id>), or a bare id.
function providerKey(idOrEngine) {
    if (idOrEngine && typeof idOrEngine === 'object') {
        const id = String(idOrEngine.id || '').trim().toLowerCase();
        return ID_RE.test(id) ? id : '';
    }
    const fromEngine = providerId(idOrEngine);
    if (fromEngine) return fromEngine;
    const text = String(idOrEngine || '').trim().toLowerCase();
    return ID_RE.test(text) ? text : '';
}

function lookup(gr, idOrEngine) {
    return rowById(gr, providerKey(idOrEngine));
}

function hasKey(gr, idOrEngine) {
    const row = lookup(gr, idOrEngine);
    return !!(row && row.apiKey);
}

function requireReady(gr, idOrEngine) {
    const id = providerKey(idOrEngine);
    const row = rowById(gr, id);
    if (!row) {
        const error = new Error(`Unknown custom model provider "${id}". Add it under customModelProviders in config.`);
        error.code = 'CUSTOM_PROVIDER_MISSING';
        throw error;
    }
    if (!row.apiKey) {
        const error = new Error(`${row.name} has no API key. Add a key named "${id}" under secure customModelProviders.`);
        error.code = 'CUSTOM_PROVIDER_KEY_MISSING';
        throw error;
    }
    return row;
}

// '' uses the Studio knowledge memories. 'obliterated' is the shared store for that engine.
function memoryStoreForEngine(gr, idOrEngine) {
    const row = lookup(gr, idOrEngine);
    return row && row.obliteratedMemories ? OBLITERATED_STORE : '';
}

// Missing means the age tool stays available. Only an explicit false turns it off.
function ageToolEnabled(gr, idOrEngine) {
    const row = lookup(gr, idOrEngine);
    if (!row) return true;
    return row.ageTool !== false;
}

function adminRow(row) {
    return {
        id: row.id,
        name: row.name,
        baseUrl: row.baseUrl,
        kind: row.kind || hostKind(row.baseUrl),
        defaultModel: row.defaultModel,
        obliteratedMemories: row.obliteratedMemories === true,
        ageTool: row.ageTool !== false,
        monitorUsage: row.monitorUsage === true,
        hasKey: !!row.apiKey,
        hasManagementKey: !!row.managementKey,
        logo: row.logo || ''
    };
}

function publicAdminList(gr) {
    return readRows(gr).map((item) => lookup(gr, item && item.id)).filter(Boolean).map(adminRow);
}

function writeSecureKey(gr, id, apiKey, managementKey) {
    const key = String(apiKey || '').trim();
    const hasManagement = managementKey != null;
    const management = hasManagement ? String(managementKey).trim() : null;
    if (!key && !hasManagement) return;
    let block;
    try { block = gr.getSecureConfig({ path: 'customModelProviders' }); } catch (_) { block = null; }
    const keys = block && Array.isArray(block.keys) ? block.keys.map((item) => Object.assign({}, item)) : [];
    const at = keys.findIndex((item) => String(item && item.name || '').trim().toLowerCase() === id);
    const prev = at >= 0 ? keys[at] : {};
    const nextKey = key || String(prev.apiKey || '').trim();
    if (!nextKey && !management) return;
    const entry = { name: id, apiKey: nextKey };
    if (hasManagement) {
        if (management) entry.managementKey = management;
    } else if (prev.managementKey) {
        entry.managementKey = prev.managementKey;
    }
    if (at >= 0) keys[at] = Object.assign({}, prev, entry);
    else if (nextKey) keys.push(entry);
    else return;
    gr.updateConfigValue('secureConfig', ['customModelProviders'], { keys });
}

function saveProvider(gr, input) {
    const body = input && typeof input === 'object' ? input : {};
    const id = String(body.id || '').trim().toLowerCase();
    if (!ID_RE.test(id)) {
        const error = new Error('Provider id must be a lowercase word.');
        error.code = 'CUSTOM_PROVIDER_ID';
        throw error;
    }
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    if (!baseUrl) {
        const error = new Error('Base URL must be https, with no user or password in it.');
        error.code = 'CUSTOM_PROVIDER_URL';
        throw error;
    }
    if (!gr || typeof gr.updateConfigValue !== 'function') {
        const error = new Error('Config is not writable');
        error.code = 'CONFIG_READONLY';
        throw error;
    }
    const name = String(body.name || id).trim().slice(0, 60) || id;
    const wanted = String(body.defaultModel || '').trim();
    const rows = readRows(gr).map((item) => (item && typeof item === 'object' ? Object.assign({}, item) : null)).filter(Boolean);
    const at = rows.findIndex((item) => String(item.id || '').trim().toLowerCase() === id);
    const prev = at >= 0 ? rows[at] : {};
    const next = Object.assign({}, prev, {
        id,
        name,
        baseUrl,
        defaultModel: MODEL_ID_RE.test(wanted) ? wanted : '',
        obliteratedMemories: body.obliteratedMemories === true,
        ageTool: body.ageTool !== false,
        monitorUsage: body.monitorUsage === true
    });
    delete next.logo;
    if (at >= 0) rows[at] = next;
    else rows.push(next);
    gr.updateConfigValue('config', ['customModelProviders'], rows);
    writeSecureKey(gr, id, body.apiKey, Object.prototype.hasOwnProperty.call(body, 'managementKey') ? body.managementKey : null);
    if (Object.prototype.hasOwnProperty.call(body, 'logo')) writeLogo(id, body.logo || '');
    const saved = lookup(gr, id);
    return saved ? adminRow(saved) : adminRow(Object.assign({ apiKey: '' }, next));
}

function displayName(gr, idOrEngine) {
    const row = lookup(gr, idOrEngine);
    return row ? row.name : 'Custom';
}

// Client engine menu. No base URL and no key.
function publicList(gr) {
    return readRows(gr).map((item) => lookup(gr, item && item.id)).filter(Boolean).map((row) => ({
        id: row.id,
        engine: row.engine,
        name: row.name,
        kind: row.kind,
        monitorUsage: row.monitorUsage === true,
        logo: row.logo || ''
    }));
}

function displayModelName(row, id) {
    const name = String((row && row.name) || '').trim();
    if (name && name.length <= 120 && !/[<>&]/.test(name)) return name;
    return id.split('/').pop() || id;
}

// OpenAI GET /v1/models. Drops _provider and every field except id and name.
function catalogFromModels(body, providerName) {
    const rows = body && Array.isArray(body.data) ? body.data : [];
    const seen = new Set();
    const families = [];
    rows.forEach((row) => {
        const id = String((row && row.id) || '').trim();
        if (!MODEL_ID_RE.test(id) || seen.has(id)) return;
        seen.add(id);
        families.push({
            id,
            name: displayModelName(row, id),
            provider: providerName || 'Custom',
            released: 0,
            input: null,
            output: null,
            fastId: null
        });
    });
    const count = families.length;
    families.forEach((row, index) => { row.released = count - index; });
    return families;
}

function cacheFileFor(id) {
    return path.join(cacheHome(), `custom-models-${id}.json`);
}

function readCacheFile(file) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && Array.isArray(parsed.families) && parsed.families.length) return parsed;
    } catch (_) { /* no cache yet */ }
    return null;
}

function writeCacheFile(file, families) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ at: Date.now(), families }));
    } catch (_) { /* cache is optional */ }
}

async function fetchCatalog(provider) {
    const headers = { authorization: `Bearer ${provider.apiKey}` };
    const res = await fetch(provider.modelsUrl, {
        headers,
        signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`${provider.name} model list answered ${res.status}`);
    const body = await res.json();
    const families = provider.kind === 'tokenrouter'
        ? require('./tokenRouterBridge').catalogFromPricing(body)
        : catalogFromModels(body, provider.name);
    if (!families.length) throw new Error(`${provider.name} model list is empty`);
    return families;
}

function usdText(amount) {
    const n = Math.round(Number(amount) * 100) / 100;
    return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}

// TokenRouter (management key) and OpenRouter credits. { balance, title, topUp?, vouchers? };
// balance is null when it could not be read. null: the host has no balance to read.
async function balanceInfo(row) {
    const name = row.name;
    if (row.kind === 'tokenrouter') {
        const missing = { balance: null, title: `${name}: add a management key to show the balance` };
        if (!row.managementKey) return missing;
        const info = await require('./tokenRouterBridge').walletAt(row.baseUrl, row.managementKey);
        if (info.error) return { balance: null, title: `${name} balance unavailable: ${info.error}` };
        if (!info.configured) return missing;
        return {
            balance: info.remaining,
            topUp: info.topUp,
            vouchers: info.vouchers,
            title: [
                `${name} balance: ${usdText(info.remaining)}`,
                `Top-up ${usdText(info.topUp)} + vouchers ${usdText(info.vouchers)}`
            ].join('\n')
        };
    }
    if (row.kind === 'openrouter') {
        try {
            const res = await fetch(`${row.baseUrl}/v1/credits`, {
                headers: { authorization: `Bearer ${row.apiKey}` },
                signal: AbortSignal.timeout(10000)
            });
            const body = await res.json().catch(() => null);
            const data = body && body.data;
            if (!res.ok || !data) return { balance: null, title: `${name} credits unavailable` };
            const remaining = (Number(data.total_credits) || 0) - (Number(data.total_usage) || 0);
            const rounded = Math.round(remaining * 100) / 100;
            return { balance: rounded, title: `${name} credits: ${usdText(rounded)}` };
        } catch (error) {
            return { balance: null, title: `${name} credits unavailable: ${error.message}` };
        }
    }
    return null;
}

// Director badge. Monitor Usage off means this host has no cap: the client hides the indicator.
async function usageSummary(gr, idOrEngine) {
    const row = lookup(gr, idOrEngine);
    const name = row ? row.name : 'Custom';
    const base = {
        success: true,
        engine: row ? row.engine : '',
        persona: 'wren',
        limited: false,
        autoPercent: null,
        apiPercent: null,
        balance: null,
        balanceText: null,
        hidden: !row || row.monitorUsage !== true,
        title: name
    };
    if (base.hidden || !row) return base;
    const info = await balanceInfo(row);
    if (!info) return base;
    if (info.balance == null) return { ...base, title: info.title };
    return {
        ...base,
        balance: info.balance,
        balanceText: usdText(info.balance),
        limited: info.balance <= 0,
        title: info.title
    };
}

// Account Manager (modules/walletStatus.js): one authenticated read that says whether the host
// answers and takes the key, for every provider whether or not it has a balance to show.
// OpenRouter's model list is public, so its key endpoint stands in.
function statusUrl(row) {
    if (row.kind === 'openrouter') return `${row.baseUrl}/v1/key`;
    if (row.kind === 'tokenrouter') return `${row.baseUrl}/v1/models`;
    return row.modelsUrl;
}

// { state: ok | warn | fail | off, message, status, ms, models }. state follows Security
// Center's key dots (apiKeyHealth.classify): fail = the host refused the key, warn = it could
// not be confirmed (outage, rate limit, network), off = no key to try.
async function apiStatus(gr, idOrEngine) {
    const row = lookup(gr, idOrEngine);
    if (!row) return { state: 'off', message: 'Provider not found', status: null, ms: null, models: null };
    if (!row.apiKey) return { state: 'off', message: 'No API key', status: null, ms: null, models: null };
    let ms = null;
    try {
        const send = async () => {
            const started = Date.now();
            const res = await fetch(statusUrl(row), {
                headers: { accept: 'application/json', authorization: `Bearer ${row.apiKey}` },
                signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
            });
            ms = Date.now() - started;
            return res;
        };
        // TokenRouter counts these against the account's 10 a minute (#418)
        const res = row.kind === 'tokenrouter'
            ? await require('./tokenRouterGate').run(send, { lane: 'background', label: `status ${row.id}` })
            : await send();
        // Secrets can come back in error bodies; never keep them (the message is read from body).
        const text = (await res.text().catch(() => '')).split(row.apiKey).join('<key>');
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
        const verdict = require('./apiKeyHealth').classify(res.status, body, text.slice(0, 400));
        const models = res.ok && row.kind !== 'openrouter' && body && Array.isArray(body.data) ? body.data.length : null;
        return { state: verdict.state, message: verdict.message, status: res.status, ms, models };
    } catch (error) {
        const why = error && error.name === 'TimeoutError' ? 'timed out' : String((error && error.message) || error);
        return { state: 'warn', message: `Could not reach the host (${why})`, status: null, ms: null, models: null };
    }
}

async function listModels(gr, idOrEngine, options) {
    const provider = requireReady(gr, idOrEngine);
    const opts = options || {};
    const file = opts.cacheFile || cacheFileFor(provider.id);
    let slot = catalogs.get(provider.id);
    if (!slot) {
        slot = { at: 0, families: null, promise: null };
        catalogs.set(provider.id, slot);
    }
    if (!slot.families) {
        const disk = readCacheFile(file);
        if (disk) {
            slot.families = disk.families;
            slot.at = Number(disk.at) || 0;
        }
    }
    const fresh = slot.families && Date.now() - slot.at < CATALOG_TTL_MS;
    if (fresh && !opts.force) return slot.families;
    if (!slot.promise) {
        slot.promise = fetchCatalog(provider).then((families) => {
            slot.at = Date.now();
            slot.families = families;
            writeCacheFile(file, families);
            return families;
        }).catch((error) => {
            if (slot.families) return slot.families;
            throw error;
        }).finally(() => {
            slot.promise = null;
        });
    }
    if (slot.families && !opts.force) return slot.families;
    return slot.promise;
}

function resolveRun(families, choice, provider) {
    const list = Array.isArray(families) ? families : [];
    const requested = String((choice && choice.model) || '').trim();
    const preferred = (provider && provider.defaultModel)
        || (provider && provider.kind === 'tokenrouter' ? 'deepseek/deepseek-v4.1-flash' : '');
    const fallback = list.find((item) => item.id === preferred) || list[0] || null;
    const family = list.find((item) => item.id === requested) || fallback;
    const wanted = String((choice && choice.effort) || 'medium').trim().toLowerCase();
    const effort = EFFORTS.includes(wanted) ? wanted : 'medium';
    const model = family ? family.id : (requested || preferred || '');
    return { family: model, model, effort, fast: false };
}

async function resolveForTurn(gr, idOrEngine, choice) {
    const provider = requireReady(gr, idOrEngine);
    let families = [];
    try {
        families = await listModels(gr, provider.id);
    } catch (error) {
        console.warn(`${provider.name} catalog unavailable: ${error.message}`);
    }
    return resolveRun(families, choice, provider);
}

module.exports = {
    EFFORTS,
    PRESETS,
    isEngine,
    providerId,
    hostKind,
    lookup,
    hasKey,
    requireReady,
    displayName,
    publicList,
    OBLITERATED_STORE,
    memoryStoreForEngine,
    ageToolEnabled,
    publicAdminList,
    saveProvider,
    usageSummary,
    balanceInfo,
    apiStatus,
    listModels,
    resolveRun,
    resolveForTurn,
    catalogFromModels,
    normalizeBaseUrl,
    _test: {
        resetCatalogs: () => catalogs.clear(),
        setLogoDir: (dir) => { logoDirectory = dir; }
    }
};
