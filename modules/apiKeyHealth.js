'use strict';

// Security Center service key status dots (#409). Every configured key that has
// a probe below, and TokenRouter's paired management key, is checked with one
// free authenticated read. Results are cached by key fingerprint (a hash, never
// the key) in .cache/api-key-health.json. Opening Security Center only reads
// this cache. A check runs when a key is added or edited, and at boot for keys
// that were never checked or whose last check could not reach the service.
// google and grok have no probe: stored keys are not checked and get no dot.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE = process.env.API_KEY_HEALTH_CACHE || path.join(__dirname, '..', '.cache', 'api-key-health.json');
const TIMEOUT_MS = 15000;
const BOOT_DELAY_MS = 20000;
// A check that could not reach the service is tried once more after this.
const RETRY_MS = 10 * 60 * 1000;

// state: ok (green), fail (the service refused the key), warn (could not confirm:
// rate limit, quota, outage, network), checking, unchecked.
const PROBES = {
    novelai: (key) => ({ url: 'https://image.novelai.net/user/subscription', headers: { authorization: `Bearer ${key}` } }),
    openai: (key) => ({ url: 'https://api.openai.com/v1/models', headers: { authorization: `Bearer ${key}` } }),
    openweather: (key) => ({ url: `https://api.openweathermap.org/data/2.5/weather?lat=0&lon=0&appid=${encodeURIComponent(key)}`, headers: {} }),
    // An empty search body is refused after the key check (400 validation), so no search runs.
    // Websets would be a cleaner read but needs a Pro plan.
    exa: (key) => ({
        url: 'https://api.exa.ai/search',
        method: 'POST',
        body: '{}',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        accept: (status, text) => status === 400 && /validation|invalid request body/i.test(text)
    }),
    runpod: (key) => ({ url: 'https://rest.runpod.io/v1/pods', headers: { authorization: `Bearer ${key}` } }),
    tokenrouter: (key) => ({ url: `${tokenRouterBase()}/v1/models`, headers: { authorization: `Bearer ${key}` }, gate: true })
};

// Paired second credentials (apiKeyManager SERVICE_METADATA secondary): slot -> probe.
const SECONDARY_PROBES = {
    'tokenrouter:managementKey': (key) => ({
        url: `${tokenRouterBase()}/api/management/self/wallet`,
        headers: { authorization: `Bearer ${key}` },
        gate: true,
        judge: (body) => (body && body.success === false ? { state: 'fail', message: body.message || 'Management key refused' } : null)
    })
};

let cache = null;
let boundGr = null;
const checking = new Set();
const retryTimers = new Map();
let bootTimer = null;

function tokenRouterBase() {
    return String(process.env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

function fingerprint(service, slot, secret) {
    return crypto.createHash('sha256').update(`${service}\n${slot}\n${secret}`).digest('hex').slice(0, 24);
}

function loadCache() {
    if (cache) return cache;
    cache = { version: 1, entries: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (parsed && parsed.entries && typeof parsed.entries === 'object') cache.entries = parsed.entries;
    } catch (_) { /* first run */ }
    return cache;
}

function saveCache() {
    try {
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(loadCache(), null, 2));
        fs.renameSync(tmp, CACHE_FILE);
    } catch (error) {
        console.warn(`API key status cache not saved: ${error.message}`);
    }
}

function probeFor(service, slot) {
    return slot === 'apiKey' ? PROBES[service] : SECONDARY_PROBES[`${service}:${slot}`];
}

function checksService(service) {
    return typeof PROBES[service] === 'function';
}

// Every credential in the config: { service, slot, index, secret, fp }.
function configuredCredentials(gr, services) {
    const manager = gr && gr.getApiKeyManager();
    if (!manager) return [];
    const ids = services && services.length ? services : Object.keys(manager.SERVICE_METADATA);
    const out = [];
    ids.forEach((service) => {
        const meta = manager.SERVICE_METADATA[service];
        if (!meta) return;
        manager.getServiceKeys(service).forEach((key, index) => {
            if (key && key.apiKey) {
                out.push({ service, slot: 'apiKey', index, secret: String(key.apiKey).trim() });
            }
            const field = meta.secondary && meta.secondary.field;
            if (field && key && key[field]) {
                out.push({ service, slot: field, index, secret: String(key[field]).trim() });
            }
        });
    });
    return out.map((row) => ({ ...row, fp: fingerprint(row.service, row.slot, row.secret) }));
}

function classify(status, body, text, judge, accept) {
    if (accept && accept(status, text)) return { state: 'ok', message: 'Key accepted' };
    if (status >= 200 && status < 300) {
        const verdict = judge ? judge(body) : null;
        return verdict || { state: 'ok', message: 'Key accepted' };
    }
    const detail = (body && (body.error && (body.error.message || body.error) || body.message || body.detail)) || text || '';
    const short = String(typeof detail === 'string' ? detail : JSON.stringify(detail)).replace(/\s+/g, ' ').slice(0, 160);
    if (status === 401 || status === 403 || (status === 400 && /api.?key|invalid.*key|key.*invalid/i.test(short))) {
        return { state: 'fail', message: `Refused (HTTP ${status})${short ? `: ${short}` : ''}` };
    }
    if (status === 402 || status === 429) {
        return { state: 'warn', message: `Key reached the service but is limited (HTTP ${status})${short ? `: ${short}` : ''}` };
    }
    return { state: 'warn', message: `Could not confirm (HTTP ${status})${short ? `: ${short}` : ''}` };
}

async function runProbe(service, slot, secret) {
    const make = probeFor(service, slot);
    if (!make) return { state: 'warn', message: 'No check exists for this service' };
    const probe = make(secret);
    try {
        const send = () => fetch(probe.url, {
            method: probe.method || 'GET',
            body: probe.body,
            headers: { accept: 'application/json', ...probe.headers },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        // TokenRouter counts these against the account's 10 a minute: queue them (#418).
        const res = probe.gate
            ? await require('./tokenRouterGate').run(send, { lane: 'background', label: `key check ${service}` })
            : await send();
        // Secrets can come back in error bodies; never keep them (classify reads the message from body).
        const text = (await res.text().catch(() => '')).split(secret).join('<key>');
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
        const safeText = text.slice(0, 400);
        return { ...classify(res.status, body, safeText, probe.judge, probe.accept), status: res.status };
    } catch (error) {
        return { state: 'warn', message: `Could not reach the service (${error.name === 'TimeoutError' ? 'timed out' : error.message})` };
    }
}

function broadcast(gr) {
    try {
        const wsServer = gr && gr.webSocketServer;
        if (!wsServer || typeof wsServer.broadcastToAll !== 'function') return;
        wsServer.broadcastToAll({
            type: 'api_key_status_changed',
            data: { statuses: publicStatuses(gr) },
            timestamp: new Date().toISOString()
        }, (clientInfo) => clientInfo && clientInfo.userType === 'admin');
    } catch (error) {
        console.warn(`API key status broadcast skipped: ${error.message}`);
    }
}

function scheduleRetry(gr, service) {
    if (retryTimers.has(service)) return;
    const timer = setTimeout(() => {
        retryTimers.delete(service);
        sweep(gr, { services: [service], reason: 'retry' }).catch(() => {});
    }, RETRY_MS);
    if (timer.unref) timer.unref();
    retryTimers.set(service, timer);
}

// Checks credentials with no cached result, or a 'warn' one (force: all of them).
// Drops cache rows for keys no longer in the config. Broadcasts when done.
async function sweep(gr, options) {
    const opts = options || {};
    const resources = gr || boundGr;
    if (!resources) return { checked: 0 };
    boundGr = resources;
    const store = loadCache();
    const creds = configuredCredentials(resources, opts.services);
    const probed = (row) => typeof probeFor(row.service, row.slot) === 'function';
    if (!opts.services) {
        const live = new Set(configuredCredentials(resources).filter(probed).map((row) => row.fp));
        Object.keys(store.entries).forEach((fp) => { if (!live.has(fp)) delete store.entries[fp]; });
    }
    const due = creds.filter((row) => {
        if (!probed(row)) return false;
        if (checking.has(row.fp)) return false;
        const entry = store.entries[row.fp];
        return opts.force || !entry || entry.state === 'warn';
    });
    if (!due.length) return { checked: 0 };
    due.forEach((row) => checking.add(row.fp));
    broadcast(resources);
    const retry = new Set();
    for (const row of due) {
        const result = await runProbe(row.service, row.slot, row.secret);
        store.entries[row.fp] = {
            service: row.service,
            slot: row.slot,
            state: result.state,
            message: result.message,
            status: result.status || null,
            checkedAt: new Date().toISOString()
        };
        checking.delete(row.fp);
        if (result.state === 'warn') retry.add(row.service);
        if (result.state !== 'ok') {
            console.warn(`API key status ${row.service}${row.slot === 'apiKey' ? '' : ` ${row.slot}`} #${row.index + 1}: ${result.state} (${result.message})`);
        }
    }
    saveCache();
    broadcast(resources);
    if (opts.reason !== 'retry') retry.forEach((service) => scheduleRetry(resources, service));
    return { checked: due.length };
}

// Status of one stored secret, from the cache only. Never starts a check.
function statusFor(service, slot, secret) {
    if (!secret) return { state: 'none' };
    const fp = fingerprint(service, slot, String(secret).trim());
    if (checking.has(fp)) return { state: 'checking' };
    const entry = loadCache().entries[fp];
    if (!entry) return { state: 'unchecked' };
    return { state: entry.state, message: entry.message, checkedAt: entry.checkedAt };
}

// { [service]: [{ index, apiKey: status, <secondary field>: status }] } for the broadcast.
function publicStatuses(gr) {
    const manager = gr && gr.getApiKeyManager();
    if (!manager) return {};
    const out = {};
    Object.keys(manager.SERVICE_METADATA).forEach((service) => {
        const field = manager.SERVICE_METADATA[service].secondary && manager.SERVICE_METADATA[service].secondary.field;
        out[service] = manager.getServiceKeys(service).map((key, index) => {
            const row = { index, apiKey: statusFor(service, 'apiKey', key && key.apiKey) };
            if (field) row[field] = statusFor(service, field, key && key[field]);
            return row;
        });
    });
    return out;
}

// Called once at boot (modules/bootstrap/initSteps.js after the key manager).
function start(gr) {
    boundGr = gr;
    loadCache();
    if (bootTimer) return;
    bootTimer = setTimeout(() => {
        sweep(gr, { reason: 'boot' }).catch((error) => console.warn(`API key status sweep failed: ${error.message}`));
    }, BOOT_DELAY_MS);
    if (bootTimer.unref) bootTimer.unref();
}

// After add / edit: check that service's new or changed credentials.
function noteKeysChanged(gr, service) {
    setImmediate(() => {
        sweep(gr, { services: service ? [service] : undefined, reason: 'changed' })
            .catch((error) => console.warn(`API key status check failed: ${error.message}`));
    });
}

module.exports = {
    start,
    sweep,
    checksService,
    classify,
    statusFor,
    publicStatuses,
    noteKeysChanged,
    _test: {
        classify,
        runProbe,
        fingerprint,
        configuredCredentials,
        resetCache: () => { cache = { version: 1, entries: {} }; checking.clear(); },
        PROBES,
        SECONDARY_PROBES
    }
};
