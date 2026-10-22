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

const TOGGLE_PATCH_KEYS = Object.freeze(['inbound', 'outbound', 'mailboxes', 'services']);

function pickTogglePatch(toggles) {
    const body = {};
    if (!toggles || typeof toggles !== 'object') return body;
    TOGGLE_PATCH_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(toggles, key)) body[key] = toggles[key];
    });
    return body;
}

function friendlyRelayError(code, fallback) {
    switch (String(code || '')) {
        case 'UNKNOWN_MAILBOX':
            return 'The LANTIS relay does not know that mailbox.';
        case 'UNKNOWN_SERVICE':
            return 'The LANTIS relay does not know that service.';
        case 'BAD_BODY':
            return 'Toggle values must be true or false.';
        case 'ACTOR_REQUIRED':
            return 'An admin name is required to change relay toggles.';
        case 'RELAY_ADMIN_REQUIRED':
            return 'The relay rejected this change because the admin token was missing or wrong.';
        case 'RELAY_ADMIN_TOKEN_MISSING':
            return 'The relay admin token is not set on this server.';
        case 'CONFIRM_REQUIRED':
            return 'Confirm this change before it is sent to the relay.';
        case 'RELAY_TOKEN_MISSING':
            return 'The relay read token is not set on this server.';
        case 'RELAY_ENDPOINT_MISSING':
            return 'The LANTIS relay does not have PUT /v1/recipients yet.';
        default:
            return fallback || 'The relay rejected that change.';
    }
}

function clientError(code, message) {
    return {
        ok: false,
        degraded: false,
        code,
        error: redact(message),
        friendly: friendlyRelayError(code, message)
    };
}

async function putToggles(toggles, { actor, confirm } = {}) {
    const token = resolveAdminToken();
    if (!token) return clientError('RELAY_ADMIN_TOKEN_MISSING', 'Relay admin token is not set');
    const name = String(actor || '').trim();
    if (!name) return clientError('ACTOR_REQUIRED', 'actor is required');
    if (confirm !== true) {
        return clientError('CONFIRM_REQUIRED', 'confirm:true is required for relay mutations');
    }
    const body = pickTogglePatch(toggles);
    body.actor = name;
    try {
        const data = await relayFetch('/v1/toggles', { method: 'PUT', token, body });
        return { ok: true, degraded: false, data };
    } catch (err) {
        if (err instanceof LantisRelayError && err.status >= 400 && err.status < 500) {
            return clientError(err.code, err.message);
        }
        const fail = degraded(err.code, err.message);
        fail.friendly = friendlyRelayError(err.code, fail.error);
        return fail;
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

function missingRecipientsEndpoint(err) {
    return !!(err && (err.status === 404 || err.code === 'NOT_FOUND' || err.code === 'RELAY_ENDPOINT_MISSING'));
}

async function putRecipients(recipients, { actor, confirm } = {}) {
    const token = resolveAdminToken();
    if (!token) return clientError('RELAY_ADMIN_TOKEN_MISSING', 'Relay admin token is not set');
    const name = String(actor || '').trim();
    if (!name) return clientError('ACTOR_REQUIRED', 'actor is required');
    if (confirm !== true) {
        return clientError('CONFIRM_REQUIRED', 'confirm:true is required for relay mutations');
    }
    if (!Array.isArray(recipients)) {
        return clientError('BAD_BODY', 'recipients must be an array');
    }
    const body = { actor: name, recipients };
    try {
        const data = await relayFetch('/v1/recipients', { method: 'PUT', token, body });
        return { ok: true, degraded: false, data };
    } catch (err) {
        if (missingRecipientsEndpoint(err)) {
            return {
                ok: false,
                skipped: true,
                degraded: true,
                code: 'RELAY_ENDPOINT_MISSING',
                error: redact(err.message || 'PUT /v1/recipients is not implemented'),
                friendly: friendlyRelayError('RELAY_ENDPOINT_MISSING')
            };
        }
        if (err instanceof LantisRelayError && err.status >= 400 && err.status < 500) {
            return clientError(err.code, err.message);
        }
        const fail = degraded(err.code, err.message);
        fail.friendly = friendlyRelayError(err.code, fail.error);
        return fail;
    }
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
    putToggles,
    putRecipients,
    pickTogglePatch,
    friendlyRelayError
};
