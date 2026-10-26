'use strict';

// Custom Director engines. Each one is an OpenAI-compatible chat-completions
// host. Wren and Xi still run the Claude CLI; modules/tokenRouterBridge.js
// relays that CLI to the provider named in the x-dreamscape-provider header.
// The bearer token stays in secure.config.json customModelProviders.keys[]
// (key name = id). A TokenRouter URL can also store managementKey on that
// entry. The public row is config.json customModelProviders[]. The host kind
// (tokenrouter, openai, google, openrouter, nvidia, deepseek, deepinfra, generic) comes from
// the URL. Google's, DeepSeek's and DeepInfra's OpenAI paths are {baseUrl}/chat/completions;
// everyone else is {baseUrl}/v1/chat/completions. TokenRouter catalogs come from /api/pricing.
// Balances (balanceInfo) are cached for BALANCE_TTL_MS and only read by the badge, the
// engine pickers and the wallet; a turn never waits on one. DeepSeek: GET /user/balance.
// DeepInfra: GET {origin}/payment/checklist (prepaid funds, spend since the last invoice,
// spending limit, suspension) and GET {origin}/payment/usage?from=current (month cost, cents).
// NVIDIA NIM (build.nvidia.com) has no credits endpoint: it reports free tier, plus the
// x-ratelimit-* headers of the last chat response when the host sent any (noteRateLimit).
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
const BALANCE_TTL_MS = 3 * 60 * 1000;
const BALANCE_TIMEOUT_MS = 10000;
// Same thresholds as the wallet tray (walletTray.js balanceLevel): low at 1 or less.
const LOW_BALANCE = 1;

const catalogs = new Map();
const balances = new Map();   // id -> { at, fp, value, promise }
const rateLimits = new Map(); // id -> { at, limit, remaining, resetMs }
// NVIDIA's /v1/models answers without a key, so it cannot prove one. The first authed chat
// does: id -> { fp, state: 'ok' | 'fail', status, at }. A new key (fp) starts unverified.
const keyChecks = new Map();
const LOGO_MAX_BYTES = 64 * 1024;
let logoDirectory = path.join(__dirname, '..', 'data', 'provider-logos');

// Supported hosts. A preset only fills the form (director_custom_providers_response presets);
// the host kind is read from the saved URL. defaultModel is used when the row names none.
const PRESETS = [
    { id: 'google', name: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: '' },
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', defaultModel: '' },
    { id: 'tokenrouter', name: 'TokenRouter', baseUrl: 'https://api.tokenrouter.com', defaultModel: 'deepseek/deepseek-v4.1-flash' },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', defaultModel: '' },
    { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'deepseek-ai/deepseek-v4.1-flash' },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: '' },
    { id: 'deepinfra', name: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash' }
];

function presetDefaultModel(kind) {
    const preset = PRESETS.find((item) => item.id === kind);
    return preset ? preset.defaultModel : '';
}

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
    if (host === 'integrate.api.nvidia.com') return 'nvidia';
    if (host === 'api.deepseek.com') return 'deepseek';
    if (host === 'api.deepinfra.com') return 'deepinfra';
    return 'generic';
}

function endpointsFor(baseUrl, kind) {
    if (kind === 'google' || kind === 'deepseek' || kind === 'deepinfra') {
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

// The server fetches this URL with the stored key, so internal hosts are refused: loopback,
// private, link-local and CGNAT literals, localhost, and .local/.internal/.lan names. (DNS that
// resolves a public name to a private address is not checked; saving stays admin-only.)
function isInternalHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host) return true;
    if (host === 'localhost' || /\.(localhost|local|internal|lan|home|arpa)$/.test(host) || !host.includes('.') && !host.includes(':')) return true;
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    if (host.includes(':')) {
        if (host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
        const mapped = host.match(/^::ffff:(.+)$/);
        if (mapped) return mapped[1].includes('.') ? isInternalHost(mapped[1]) : true;
    }
    return false;
}

function normalizeBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let url;
    try { url = new URL(raw); } catch (_) { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (isInternalHost(url.hostname)) return '';
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

// DeepInfra's /v1/openai/models lists embedding, image, speech and video models too. Only the
// ones priced per output token are chat models; metadata.pricing is USD per million tokens.
function catalogFromDeepInfra(body, providerName) {
    const rows = body && Array.isArray(body.data) ? body.data : [];
    const chat = rows.filter((row) => {
        const pricing = row && row.metadata && row.metadata.pricing;
        return pricing && finite(pricing.output_tokens) != null;
    });
    const families = catalogFromModels({ data: chat }, providerName);
    const prices = new Map(chat.map((row) => [String(row.id).trim(), row.metadata.pricing]));
    families.forEach((family) => {
        const pricing = prices.get(family.id) || {};
        family.input = finite(pricing.input_tokens);
        family.output = finite(pricing.output_tokens);
    });
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
        : provider.kind === 'deepinfra'
            ? catalogFromDeepInfra(body, provider.name)
            : catalogFromModels(body, provider.name);
    if (!families.length) throw new Error(`${provider.name} model list is empty`);
    return families;
}

function usdText(amount) {
    const n = Math.round(Number(amount) * 100) / 100;
    return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}

const CURRENCY_SIGNS = { USD: '$', CNY: '¥' };

function moneyText(amount, currency) {
    const code = String(currency || 'USD').trim().toUpperCase();
    if (code === 'USD') return usdText(amount);
    const n = Math.round(Number(amount) * 100) / 100;
    const sign = CURRENCY_SIGNS[code];
    const digits = Math.abs(n).toFixed(2);
    return sign ? `${n < 0 ? '-' : ''}${sign}${digits}` : `${n < 0 ? '-' : ''}${digits} ${code}`;
}

function finite(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

// DeepSeek GET /user/balance: { is_available, balance_infos: [{ currency, total_balance,
// granted_balance, topped_up_balance }] } with the amounts as strings. USD first, else the
// first currency listed. null when the body has no balance row.
function parseDeepSeekBalance(body) {
    const infos = body && Array.isArray(body.balance_infos) ? body.balance_infos : [];
    const rows = infos.filter((row) => row && finite(row.total_balance) != null);
    if (!rows.length) return null;
    const row = rows.find((item) => String(item.currency || '').toUpperCase() === 'USD') || rows[0];
    return {
        currency: String(row.currency || 'USD').toUpperCase(),
        balance: finite(row.total_balance),
        granted: finite(row.granted_balance),
        toppedUp: finite(row.topped_up_balance),
        available: body.is_available !== false
    };
}

// DeepInfra GET /payment/checklist. stripe_balance is negative when prepaid funds are ready
// to spend and positive when money is owed; recent is the spend since the last invoice and
// limit the account's spending limit (both USD). null when the body has no stripe_balance.
// DeepInfra's OpenAPI does not state the unit of stripe_balance / recent / limit. Its console
// and third-party clients (CodexBar, Quota Monitor) read them as whole US dollars, while
// /payment/usage total_cost is documented as cents. If DeepInfra ever confirms cents here,
// change this one constant to 100.
const DEEPINFRA_CHECKLIST_UNITS_PER_USD = 1;

// Spendable = -(stripe_balance + max(recent, 0)): recent is spend not yet invoiced, so it has
// already come out of the prepaid funds (DeepInfra console formula).
function parseDeepInfraChecklist(body) {
    const rawStripe = body ? finite(body.stripe_balance) : null;
    if (rawStripe == null) return null;
    const usd = (n) => (n == null ? null : n / DEEPINFRA_CHECKLIST_UNITS_PER_USD);
    const stripe = usd(rawStripe);
    const recent = usd(finite(body.recent));
    const limit = usd(finite(body.limit));
    return {
        currency: 'USD',
        balance: Math.round(-(stripe + Math.max(recent || 0, 0)) * 100) / 100,
        recent,
        limit: limit != null && limit > 0 ? limit : null,
        suspended: body.suspended === true,
        suspendReason: body.suspend_reason ? String(body.suspend_reason) : '',
        paymentMethod: body.payment_method === true
    };
}

// DeepInfra GET /payment/usage?from=current: months[].total_cost in cents -> USD this month.
// null when the body has no month.
function parseDeepInfraUsage(body) {
    const months = body && Array.isArray(body.months) ? body.months : [];
    const costs = months.map((month) => finite(month && month.total_cost)).filter((n) => n != null);
    if (!costs.length) return null;
    return Math.round(costs.reduce((sum, n) => sum + n, 0)) / 100;
}

const DEEPINFRA_SUSPENDED = {
    balance: 'out of funds',
    'payment-method': 'no payment method',
    'overdue-invoices': 'overdue invoices',
    'limit-reached': 'spending limit reached',
    'bad-cc': 'card declined',
    'missing-address': 'billing address missing'
};

function headerGetter(headers) {
    if (!headers) return () => null;
    if (typeof headers.get === 'function') return (name) => headers.get(name);
    const lower = {};
    Object.keys(headers).forEach((key) => { lower[key.toLowerCase()] = headers[key]; });
    return (name) => (lower[name] == null ? null : String(lower[name]));
}

// "1s", "6m0s", "250ms", "30" (seconds) -> ms. null when it does not parse.
function durationMs(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000);
    const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
    let total = 0;
    let matched = '';
    let part;
    while ((part = re.exec(raw))) {
        const n = Number(part[1]);
        total += part[2] === 'h' ? n * 3600000 : part[2] === 'm' ? n * 60000 : part[2] === 's' ? n * 1000 : n;
        matched += part[0];
    }
    return matched === raw ? Math.round(total) : null;
}

// x-ratelimit-{limit,remaining,reset}-requests (OpenAI style) or the bare x-ratelimit-*
// names. null when the response carried none.
function parseRateLimitHeaders(headers) {
    const get = headerGetter(headers);
    const pick = (names) => names.map((name) => get(name)).find((value) => value != null && value !== '');
    const limit = finite(pick(['x-ratelimit-limit-requests', 'x-ratelimit-limit']));
    const remaining = finite(pick(['x-ratelimit-remaining-requests', 'x-ratelimit-remaining']));
    const resetMs = durationMs(pick(['x-ratelimit-reset-requests', 'x-ratelimit-reset']));
    if (limit == null && remaining == null) return null;
    return { limit, remaining, resetMs };
}

function keyFingerprint(apiKey) {
    return require('crypto').createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 16);
}

// The bridge reports each custom chat's status here. 2xx proves the key, 401/403 refuses it.
function noteKeyResult(idOrEngine, apiKey, status) {
    const id = providerKey(idOrEngine);
    if (!id || !apiKey) return;
    const code = Number(status);
    const state = code >= 200 && code < 300 ? 'ok' : (code === 401 || code === 403) ? 'fail' : null;
    if (state) keyChecks.set(id, { fp: keyFingerprint(apiKey), state, status: code, at: Date.now() });
}

function keyCheckFor(row) {
    const seen = keyChecks.get(row.id);
    return seen && seen.fp === keyFingerprint(row.apiKey) ? seen : null;
}

// The bridge passes every custom chat response here (modules/tokenRouterBridge.js).
function noteRateLimit(idOrEngine, headers) {
    const id = providerKey(idOrEngine);
    if (!id) return;
    const seen = parseRateLimitHeaders(headers);
    if (seen) rateLimits.set(id, { at: Date.now(), ...seen });
}

function rateLimitFor(id) {
    const seen = rateLimits.get(id);
    if (!seen) return null;
    if (seen.resetMs != null && Date.now() - seen.at > seen.resetMs) return { ...seen, remaining: seen.limit, stale: true };
    return seen;
}

function rateLimitText(rate) {
    if (!rate) return '';
    if (rate.limit != null && rate.remaining != null) return `${rate.remaining} of ${rate.limit} requests left`;
    if (rate.remaining != null) return `${rate.remaining} requests left`;
    return `${rate.limit} requests per window`;
}

async function readJson(url, apiKey) {
    const res = await fetch(url, {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS)
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
}

// { balance, text?, currency?, title, ... }; balance is null when it could not be read.
// null: the host has no balance to read. Uncached; balanceInfo wraps it.
async function readBalance(row) {
    const name = row.name;
    if (row.kind === 'tokenrouter') {
        const missing = { balance: null, title: `${name}: add a management key to show the balance` };
        if (!row.managementKey) return missing;
        const info = await require('./tokenRouterBridge').walletAt(row.baseUrl, row.managementKey);
        if (info.error) return { balance: null, title: `${name} balance unavailable: ${info.error}` };
        if (!info.configured) return missing;
        return {
            balance: info.remaining,
            currency: 'USD',
            text: usdText(info.remaining),
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
            const { ok, body } = await readJson(`${row.baseUrl}/v1/credits`, row.apiKey);
            const data = body && body.data;
            if (!ok || !data) return { balance: null, title: `${name} credits unavailable` };
            const remaining = (Number(data.total_credits) || 0) - (Number(data.total_usage) || 0);
            const rounded = Math.round(remaining * 100) / 100;
            return { balance: rounded, currency: 'USD', text: usdText(rounded), title: `${name} credits: ${usdText(rounded)}` };
        } catch (error) {
            return { balance: null, title: `${name} credits unavailable: ${error.message}` };
        }
    }
    if (row.kind === 'deepseek') {
        try {
            const { ok, status, body } = await readJson(`${row.baseUrl}/user/balance`, row.apiKey);
            const info = ok ? parseDeepSeekBalance(body) : null;
            if (!info) return { balance: null, title: `${name} balance unavailable${ok ? '' : ` (HTTP ${status})`}` };
            const lines = [`${name} balance: ${moneyText(info.balance, info.currency)}`];
            if (info.granted != null || info.toppedUp != null) {
                lines.push(`Topped up ${moneyText(info.toppedUp || 0, info.currency)} + granted ${moneyText(info.granted || 0, info.currency)}`);
            }
            if (!info.available) lines.push('DeepSeek says the balance is not enough for API calls');
            return {
                balance: info.balance,
                currency: info.currency,
                text: moneyText(info.balance, info.currency),
                granted: info.granted,
                toppedUp: info.toppedUp,
                available: info.available,
                title: lines.join('\n')
            };
        } catch (error) {
            return { balance: null, title: `${name} balance unavailable: ${error.message}` };
        }
    }
    if (row.kind === 'deepinfra') {
        // Billing lives on the API origin, not under the /v1/openai base URL.
        const origin = new URL(row.baseUrl).origin;
        try {
            const [checklist, usage] = await Promise.all([
                readJson(`${origin}/payment/checklist`, row.apiKey),
                readJson(`${origin}/payment/usage?from=current`, row.apiKey).catch(() => null)
            ]);
            const info = checklist.ok ? parseDeepInfraChecklist(checklist.body) : null;
            if (!info) return { balance: null, title: `${name} balance unavailable${checklist.ok ? '' : ` (HTTP ${checklist.status})`}` };
            const month = usage && usage.ok ? parseDeepInfraUsage(usage.body) : null;
            // A positive stripe_balance is an amount owed; with a card on file it is billed later.
            const owed = info.balance < 0;
            const postpaid = owed && info.paymentMethod && !info.suspended;
            const text = owed ? `${usdText(-info.balance)} owed` : usdText(info.balance);
            const lines = [owed ? `${name}: ${usdText(-info.balance)} owed` : `${name} balance: ${usdText(info.balance)}`];
            if (info.recent != null) lines.push(`Spent since the last invoice: ${usdText(info.recent)}`);
            if (month != null) lines.push(`Spent this month: ${usdText(month)}`);
            if (info.limit != null) lines.push(`Spending limit: ${usdText(info.limit)}`);
            if (info.suspended) lines.push(`Suspended: ${DEEPINFRA_SUSPENDED[info.suspendReason] || info.suspendReason || 'billing action needed'}`);
            return {
                balance: info.balance,
                currency: 'USD',
                text,
                recent: info.recent,
                monthSpend: month,
                limit: info.limit,
                suspended: info.suspended,
                postpaid,
                available: !info.suspended,
                title: lines.join('\n')
            };
        } catch (error) {
            return { balance: null, title: `${name} balance unavailable: ${error.message}` };
        }
    }
    if (row.kind === 'nvidia') {
        // build.nvidia.com shows no credits over the API; the free tier is limited per minute.
        const rate = rateLimitFor(row.id);
        const left = rateLimitText(rate);
        return {
            balance: null,
            freeTier: true,
            text: 'Free tier',
            rateLimit: rate ? { limit: rate.limit, remaining: rate.remaining, resetMs: rate.resetMs } : null,
            title: [`${name}: free tier, rate-limited`, left].filter(Boolean).join('\n')
        };
    }
    return null;
}

function balanceFingerprint(row) {
    return require('crypto').createHash('sha256')
        .update([row.baseUrl, row.kind, row.apiKey, row.managementKey].join('\n')).digest('hex').slice(0, 16);
}

// Cached readBalance: one read per provider every BALANCE_TTL_MS (failures included), one in
// flight at a time. NVIDIA's answer is local (rate-limit headers), so it is never cached.
async function balanceInfo(row, options) {
    if (!row) return null;
    if (row.kind === 'nvidia') return readBalance(row);
    const opts = options || {};
    const fp = balanceFingerprint(row);
    let slot = balances.get(row.id);
    if (!slot || slot.fp !== fp) {
        slot = { at: 0, fp, value: undefined, promise: null };
        balances.set(row.id, slot);
    }
    if (slot.value !== undefined && !opts.force && Date.now() - slot.at < BALANCE_TTL_MS) return slot.value;
    if (!slot.promise) {
        slot.promise = readBalance(row).then((value) => {
            slot.at = Date.now();
            slot.value = value;
            return value;
        }).finally(() => { slot.promise = null; });
    }
    return slot.promise;
}

// The engine pickers and Dreamscape CardSpace (director_custom_providers_balance). No key, no URL.
// state: ok | low | out | free | error | none (the host has no balance) | nokey
async function balanceSummary(gr, idOrEngine) {
    const row = lookup(gr, idOrEngine);
    if (!row) return null;
    const base = { id: row.id, engine: row.engine, name: row.name, kind: row.kind };
    if (!row.apiKey) return { ...base, state: 'nokey', balance: null, balanceText: '', title: `${row.name}: no API key` };
    let info;
    try {
        info = await balanceInfo(row);
    } catch (error) {
        info = { balance: null, title: `${row.name} balance unavailable: ${error.message}` };
    }
    if (!info) return { ...base, state: 'none', balance: null, balanceText: '', title: row.name };
    const out = {
        ...base,
        balance: info.balance == null ? null : info.balance,
        currency: info.currency || null,
        balanceText: info.balance == null ? (info.freeTier ? info.text : '') : (info.text || usdText(info.balance)),
        title: info.title
    };
    if (info.granted !== undefined) out.granted = info.granted;
    if (info.toppedUp !== undefined) out.toppedUp = info.toppedUp;
    if (info.recent !== undefined) out.recent = info.recent;
    if (info.monthSpend !== undefined) out.monthSpend = info.monthSpend;
    if (info.limit !== undefined) out.limit = info.limit;
    if (info.suspended !== undefined) out.suspended = info.suspended;
    if (info.freeTier) {
        out.freeTier = true;
        out.rateLimit = info.rateLimit || null;
        out.state = 'free';
        return out;
    }
    if (info.balance == null) out.state = 'error';
    else if (info.available === false) out.state = 'out';
    // Owed on a card-billed account: DeepInfra charges the card, the engine keeps running.
    else if (info.postpaid) out.state = 'ok';
    else if (info.balance <= 0 || info.available === false) out.state = 'out';
    else if (info.balance <= LOW_BALANCE) out.state = 'low';
    else out.state = 'ok';
    return out;
}

async function balanceSummaries(gr) {
    const ids = readRows(gr).map((item) => providerKey(item && item.id)).filter(Boolean);
    const rows = await Promise.all(ids.map((id) => balanceSummary(gr, id)));
    return rows.filter(Boolean);
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
    if (info.balance == null) return { ...base, balanceText: info.freeTier ? info.text : null, title: info.title };
    return {
        ...base,
        balance: info.balance,
        balanceText: info.text || usdText(info.balance),
        limited: info.available === false || (!info.postpaid && info.balance <= 0),
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
        if (row.kind === 'nvidia' && verdict.state === 'ok') {
            // The list is public: reachable is not the same as a working key.
            const check = keyCheckFor(row);
            if (!check) return { state: 'warn', message: 'Host reachable; key unverified until the first chat succeeds', status: res.status, ms, models, keyVerified: false };
            if (check.state === 'fail') return { state: 'fail', message: `Refused (HTTP ${check.status}) on the last chat`, status: check.status, ms, models, keyVerified: false };
            return { state: 'ok', message: 'Key accepted (last chat succeeded)', status: res.status, ms, models, keyVerified: true };
        }
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

// The row's model, else the supported host's default (NVIDIA: DeepSeek V4.1 Flash).
function preferredModel(provider) {
    if (!provider) return '';
    return provider.defaultModel || presetDefaultModel(provider.kind);
}

function resolveRun(families, choice, provider) {
    const list = Array.isArray(families) ? families : [];
    const requested = String((choice && choice.model) || '').trim();
    const preferred = preferredModel(provider);
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
    balanceSummary,
    balanceSummaries,
    parseDeepSeekBalance,
    parseDeepInfraChecklist,
    parseDeepInfraUsage,
    catalogFromDeepInfra,
    parseRateLimitHeaders,
    noteRateLimit,
    noteKeyResult,
    isInternalHost,
    moneyText,
    preferredModel,
    apiStatus,
    listModels,
    resolveRun,
    resolveForTurn,
    catalogFromModels,
    normalizeBaseUrl,
    _test: {
        resetCatalogs: () => catalogs.clear(),
        resetBalances: () => { balances.clear(); rateLimits.clear(); keyChecks.clear(); },
        setLogoDir: (dir) => { logoDirectory = dir; }
    }
};
