'use strict';

// Custom Director engines. Each one is an OpenAI-compatible chat-completions
// host (POST {baseUrl}/v1/chat/completions, GET {baseUrl}/v1/models). Wren and
// Xi still run the Claude CLI; modules/tokenRouterBridge.js relays that CLI
// to the provider named in the x-dreamscape-provider header. The bearer token
// stays in secure.config.json customModelProviders.keys[] (key name = id).
// The public row (id, name, baseUrl, defaultModel) is config.json
// customModelProviders[]. Upstream /v1/models payloads can echo other hosts'
// keys under _provider; only id and name are kept.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const ENGINE_RE = /^custom:([a-z][a-z0-9_-]{0,31})$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/;
const EFFORTS = ['none', 'low', 'medium', 'high'];
const OBLITERATED_STORE = 'obliterated';
const CATALOG_TTL_MS = 10 * 60 * 1000;

const catalogs = new Map();

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

function apiKeyFor(gr, id) {
    const row = readKeys(gr).find((item) => String(item.name || '').trim().toLowerCase() === id);
    return row ? String(row.apiKey).trim() : '';
}

function rowById(gr, id) {
    if (!ID_RE.test(id)) return null;
    const row = readRows(gr).find((item) => item && String(item.id || '').trim().toLowerCase() === id);
    if (!row) return null;
    const baseUrl = normalizeBaseUrl(row.baseUrl);
    if (!baseUrl) return null;
    const name = String(row.name || id).trim().slice(0, 60) || id;
    const wanted = String(row.defaultModel || '').trim();
    return {
        id,
        engine: engineFor(id),
        name,
        baseUrl,
        defaultModel: MODEL_ID_RE.test(wanted) ? wanted : '',
        obliteratedMemories: row.obliteratedMemories === true,
        ageTool: row.ageTool !== false,
        apiKey: apiKeyFor(gr, id)
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
        defaultModel: row.defaultModel,
        obliteratedMemories: row.obliteratedMemories === true,
        ageTool: row.ageTool !== false,
        hasKey: !!row.apiKey
    };
}

function publicAdminList(gr) {
    return readRows(gr).map((item) => lookup(gr, item && item.id)).filter(Boolean).map(adminRow);
}

function writeSecureKey(gr, id, apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) return;
    let block;
    try { block = gr.getSecureConfig({ path: 'customModelProviders' }); } catch (_) { block = null; }
    const keys = block && Array.isArray(block.keys) ? block.keys.map((item) => Object.assign({}, item)) : [];
    const at = keys.findIndex((item) => String(item && item.name || '').trim().toLowerCase() === id);
    const entry = { name: id, apiKey: key };
    if (at >= 0) keys[at] = Object.assign({}, keys[at], entry);
    else keys.push(entry);
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
        ageTool: body.ageTool !== false
    });
    if (at >= 0) rows[at] = next;
    else rows.push(next);
    gr.updateConfigValue('config', ['customModelProviders'], rows);
    writeSecureKey(gr, id, body.apiKey);
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
        name: row.name
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
    const res = await fetch(`${provider.baseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${provider.apiKey}` },
        signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`${provider.name} model list answered ${res.status}`);
    const families = catalogFromModels(await res.json(), provider.name);
    if (!families.length) throw new Error(`${provider.name} model list is empty`);
    return families;
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
    const preferred = provider && provider.defaultModel;
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
    isEngine,
    providerId,
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
    listModels,
    resolveRun,
    resolveForTurn,
    catalogFromModels,
    normalizeBaseUrl,
    _test: {
        resetCatalogs: () => catalogs.clear()
    }
};
