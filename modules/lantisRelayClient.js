/**
 * HTTP client for the LANTIS mail relay API (docs/lantis-relay-api.md).
 * Read token for GET; admin token for PUT. Neither token is returned to
 * callers in a shape that the browser should see — handlers must not echo
 * Authorization or the raw token fields.
 */

'use strict';

const READ_TOKEN_ENV = 'MAIL_EXCHANGE_RELAY_READ_TOKEN';
const ADMIN_TOKEN_ENV = 'MAIL_EXCHANGE_RELAY_ADMIN_TOKEN';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BASE_URL = 'http://192.168.255.1:8787';

class LantisRelayError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'LantisRelayError';
        this.code = code || 'RELAY_ERROR';
        this.status = status || 0;
    }
}

let testOverrides = null;

function setTestOverrides(overrides) {
    testOverrides = overrides || null;
}

function resetForTests() {
    testOverrides = null;
}

function getGlobalResources() {
    if (testOverrides && testOverrides.globalResources) return testOverrides.globalResources;
    try {
        return require('./globalResources');
    } catch (_err) {
        return null;
    }
}

function readSecureMailExchange() {
    if (testOverrides && testOverrides.secure) return testOverrides.secure;
    const gr = getGlobalResources();
    if (!gr || typeof gr.getSecureConfig !== 'function') return {};
    try {
        return gr.getSecureConfig({ path: 'mailExchange' }) || {};
    } catch (_err) {
        return {};
    }
}

function readPublicMailExchange() {
    if (testOverrides && testOverrides.config) return testOverrides.config;
    const gr = getGlobalResources();
    if (!gr || typeof gr.getConfig !== 'function') return {};
    try {
        return (gr.getConfig() || {}).mailExchange || {};
    } catch (_err) {
        return {};
    }
}

function resolveReadToken() {
    if (testOverrides && Object.prototype.hasOwnProperty.call(testOverrides, 'readToken')) {
        return String(testOverrides.readToken || '');
    }
    if (process.env[READ_TOKEN_ENV]) return String(process.env[READ_TOKEN_ENV]);
    const secure = readSecureMailExchange();
    return secure.relayReadToken ? String(secure.relayReadToken) : '';
}

function resolveAdminToken() {
    if (testOverrides && Object.prototype.hasOwnProperty.call(testOverrides, 'adminToken')) {
        return String(testOverrides.adminToken || '');
    }
    if (process.env[ADMIN_TOKEN_ENV]) return String(process.env[ADMIN_TOKEN_ENV]);
    const secure = readSecureMailExchange();
    return secure.relayAdminToken ? String(secure.relayAdminToken) : '';
}

function resolveBaseUrl() {
    const cfg = readPublicMailExchange();
    const fromCfg = cfg.relay && cfg.relay.baseUrl;
    return String(fromCfg || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function resolveTimeoutMs() {
    const cfg = readPublicMailExchange();
    const n = Number(cfg.relay && cfg.relay.timeoutMs);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function redact(text) {
    return String(text || '')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/relay(Read|Admin)Token":\s*"[^"]*"/gi, 'relay$1Token":"[redacted]"');
}

function degraded(code, message) {
    return {
        ok: false,
        degraded: true,
        code: code || 'RELAY_UNREACHABLE',
        error: redact(message || 'LANTIS relay unreachable')
    };
}

async function relayFetch(pathname, { method, token, body, timeoutMs } = {}) {
    const base = resolveBaseUrl();
    const url = `${base}${pathname}`;
    const ms = timeoutMs || resolveTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const fetchFn = (testOverrides && testOverrides.fetch) || fetch;
    try {
        const res = await fetchFn(url, {
            method: method || 'GET',
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        const text = await res.text();
        let json = null;
        if (text) {
            try {
                json = JSON.parse(text);
            } catch (_err) {
                throw new LantisRelayError(
                    `Relay returned non-JSON (${res.status})`,
                    'RELAY_BAD_RESPONSE',
                    res.status
                );
            }
        }
        if (!res.ok) {
            const msg = json && json.error ? String(json.error) : `HTTP ${res.status}`;
            throw new LantisRelayError(redact(msg), (json && json.code) || 'RELAY_HTTP', res.status);
        }
        return json;
    } catch (err) {
        if (err instanceof LantisRelayError) throw err;
        if (err && err.name === 'AbortError') {
            throw new LantisRelayError('Relay request timed out', 'RELAY_TIMEOUT', 0);
        }
        throw new LantisRelayError(
            redact(err && err.message ? err.message : 'Relay request failed'),
            'RELAY_UNREACHABLE',
            0
        );
    } finally {
        clearTimeout(timer);
    }
}

async function getJson(pathname, query) {
    const token = resolveReadToken();
    if (!token) return degraded('RELAY_TOKEN_MISSING', 'Relay read token is not set');
    let path = pathname;
    if (query && typeof query === 'object') {
        const params = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
            if (value == null || value === '') return;
            params.set(key, String(value));
        });
        const qs = params.toString();
        if (qs) path = `${pathname}?${qs}`;
    }
    try {
        const data = await relayFetch(path, { method: 'GET', token });
        return { ok: true, degraded: false, data };
    } catch (err) {
        return degraded(err.code, err.message);
    }
}

async function putToggles(toggles, { actor, confirm } = {}) {
    const token = resolveAdminToken();
    if (!token) return degraded('RELAY_ADMIN_TOKEN_MISSING', 'Relay admin token is not set');
    if (!actor) {
        return {
            ok: false,
            degraded: false,
            code: 'ACTOR_REQUIRED',
            error: 'actor is required for relay mutations'
        };
    }
    if (confirm !== true) {
        return {
            ok: false,
            degraded: false,
            code: 'CONFIRM_REQUIRED',
            error: 'confirm:true is required for relay mutations'
        };
    }
    const body = Object.assign({}, toggles || {}, { actor: String(actor), confirm: true });
    try {
        const data = await relayFetch('/v1/toggles', { method: 'PUT', token, body });
        return { ok: true, degraded: false, data };
    } catch (err) {
        return degraded(err.code, err.message);
    }
}

function getStatus() {
    return getJson('/v1/status');
}

function getQueue() {
    return getJson('/v1/queue');
}

function getBlocklists() {
    return getJson('/v1/blocklists');
}

function getRejects(query) {
    return getJson('/v1/rejects', query);
}

function getSenders() {
    return getJson('/v1/senders');
}

function getToggles() {
    return getJson('/v1/toggles');
}

module.exports = {
    LantisRelayError,
    READ_TOKEN_ENV,
    ADMIN_TOKEN_ENV,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_BASE_URL,
    setTestOverrides,
    resetForTests,
    resolveReadToken,
    resolveAdminToken,
    resolveBaseUrl,
    getStatus,
    getQueue,
    getBlocklists,
    getRejects,
    getSenders,
    getToggles,
    putToggles
};
