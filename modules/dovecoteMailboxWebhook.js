/**
 * Per-mailbox outbound webhook for Dovecote deliveries.
 *
 * Each application key can register one URL for its own mailbox only.
 * On inbox delivery the server POSTs { mailbox, id, from, subject, receivedAt }
 * to that URL. Headless bots cannot hold a socket, so this is the push path
 * — not a broadcast and not a cross-mailbox stream.
 */

'use strict';

const dns = require('dns').promises;
const dnsCb = require('dns');
const http = require('http');
const https = require('https');
const { getDb } = require('./dovecoteDatabase');
const {
    normalizeIp,
    isPrivateOrLinkLocalOrUla,
    ipInCidrs
} = require('./clientAddress');

const MAX_URL_LENGTH = 2048;
const MAX_AUTH_HEADER_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = Object.freeze([0, 1000, 4000, 16000, 60000]);
const EXTRA_BLOCKED_CIDRS = Object.freeze([
    '0.0.0.0/8',
    '224.0.0.0/4',
    '240.0.0.0/4',
    '255.255.255.255/32',
    '::/128',
    // Menma review: CGNAT, IETF/benchmark ranges, and IPv6 forms that embed
    // an IPv4 address (NAT64, 6to4) or are multicast.
    '100.64.0.0/10',
    '192.0.0.0/24',
    '198.18.0.0/15',
    '64:ff9b::/96',
    '64:ff9b:1::/48',
    '2002::/16',
    'ff00::/8'
]);
// Bounded in-flight deliveries (each can sleep through the backoff list).
const MAX_PENDING = 200;
const MAX_FIELD_CHARS = 1000;
const BLOCKED_HOSTS = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata.google.com',
    'host.docker.internal',
    'kubernetes',
    'unix'
]);
const BLOCKED_HOST_SUFFIXES = Object.freeze(['.localhost', '.local', '.internal', '.localdomain']);

let testOverrides = null;
const pending = new Set();

function setTestOverrides(overrides) {
    testOverrides = overrides || null;
}

function resetForTests() {
    testOverrides = null;
    pending.clear();
}

function nowIso() {
    return new Date().toISOString();
}

function dovecoteMail() {
    // isValidOwner / DovecoteError / audit: modules/dovecoteMail.js
    return require('./dovecoteMail');
}

function getWebhookConfig() {
    if (testOverrides && testOverrides.config) return testOverrides.config;
    try {
        const gr = require('./globalResources');
        const cfg = gr.getConfig() || {};
        return (cfg.dovecote && cfg.dovecote.webhook) || {};
    } catch (_err) {
        return {};
    }
}

function allowPrivateHosts() {
    const list = getWebhookConfig().allowPrivateHosts;
    if (!Array.isArray(list)) return [];
    return list.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean);
}

function timeoutMs() {
    const value = Number(getWebhookConfig().timeoutMs);
    return Number.isFinite(value) && value > 0 ? Math.min(60000, value) : DEFAULT_TIMEOUT_MS;
}

function maxAttempts() {
    const value = Number(getWebhookConfig().maxAttempts);
    return Number.isFinite(value) && value > 0 ? Math.min(8, Math.floor(value)) : DEFAULT_MAX_ATTEMPTS;
}

function backoffMs() {
    const list = getWebhookConfig().backoffMs;
    if (Array.isArray(list) && list.length) {
        return list.map((n) => Math.max(0, Number(n) || 0));
    }
    return DEFAULT_BACKOFF_MS.slice();
}

function lookupHost(hostname) {
    if (testOverrides && testOverrides.lookup) return testOverrides.lookup(hostname);
    return dns.lookup(hostname, { all: true, verbatim: true });
}

function sleep(ms) {
    if (testOverrides && testOverrides.sleep) return testOverrides.sleep(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchFn() {
    if (testOverrides && testOverrides.fetch) return testOverrides.fetch;
    return pinnedPost;
}

// Connect-time DNS guard: the socket only ever connects to an address that
// passed isBlockedIp in this same lookup, so a rebinding answer between the
// pre-check and the connect cannot reach a private host. Literal-IP URLs
// skip lookup and were already checked by resolveWebhookUrl.
function guardedLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = Object.assign({}, typeof options === 'object' ? options : { family: options }, { all: true, verbatim: true });
    const lookupImpl = testOverrides && testOverrides.connectLookup
        ? testOverrides.connectLookup
        : (h, o, cb) => dnsCb.lookup(h, o, cb);
    lookupImpl(hostname, opts, (err, rows) => {
        if (err) return callback(err);
        const list = (Array.isArray(rows) ? rows : [rows]).filter((row) => row && row.address);
        if (!list.length) return callback(Object.assign(new Error('Webhook host did not resolve'), { code: 'ENOTFOUND' }));
        if (!hostIsAllowlisted(hostname, list) && list.some((row) => isBlockedIp(row.address))) {
            return callback(Object.assign(new Error('Webhook host resolves to a private or reserved address'), { code: 'EWEBHOOKBLOCKED' }));
        }
        if (options && options.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
}

// POST with the guarded lookup, no redirects, and the response body
// discarded unread (status is all we need).
function pinnedPost(url, { headers, body, signal } = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const mod = target.protocol === 'https:' ? https : http;
        const payload = Buffer.from(String(body || ''), 'utf8');
        const req = mod.request(target, {
            method: 'POST',
            headers: Object.assign({}, headers, { 'content-length': payload.length }),
            lookup: guardedLookup,
            agent: false,
            signal
        }, (res) => {
            res.resume();
            res.destroy();
            resolve({ status: res.statusCode });
        });
        req.on('error', (err) => {
            if (err && err.code === 'EWEBHOOKBLOCKED') {
                reject(new UrlCheckError(err.message));
                return;
            }
            reject(err);
        });
        req.end(payload);
    });
}

function isBlockedHostName(hostname) {
    const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host) return true;
    if (BLOCKED_HOSTS.has(host)) return true;
    if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
    if (/^\d+$/.test(host)) return true;
    return false;
}

function isBlockedIp(ip) {
    const normalized = normalizeIp(ip) || String(ip || '');
    if (!normalized) return true;
    if (isPrivateOrLinkLocalOrUla(normalized)) return true;
    if (ipInCidrs(normalized, EXTRA_BLOCKED_CIDRS)) return true;
    return false;
}

function hostIsAllowlisted(hostname, addresses) {
    const allowed = new Set(allowPrivateHosts());
    if (!allowed.size) return false;
    if (allowed.has(String(hostname || '').trim().toLowerCase().replace(/\.$/, ''))) return true;
    return (addresses || []).some((row) => {
        const address = normalizeIp(row.address || row) || String(row.address || row || '');
        return allowed.has(address.toLowerCase());
    });
}

function parseWebhookUrl(raw) {
    const mail = dovecoteMail();
    const text = String(raw || '').trim();
    if (!text) throw new mail.DovecoteError('Webhook URL is required', 'INVALID_WEBHOOK_URL');
    if (text.length > MAX_URL_LENGTH) throw new mail.DovecoteError('Webhook URL is too long', 'INVALID_WEBHOOK_URL');
    let parsed;
    try {
        parsed = new URL(text);
    } catch (_err) {
        throw new mail.DovecoteError('Webhook URL is not valid', 'INVALID_WEBHOOK_URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new mail.DovecoteError('Webhook URL must be http or https', 'INVALID_WEBHOOK_URL');
    }
    if (parsed.username || parsed.password) {
        throw new mail.DovecoteError('Webhook URL must not include credentials', 'INVALID_WEBHOOK_URL');
    }
    const hostname = String(parsed.hostname || '').trim();
    if (!hostname) throw new mail.DovecoteError('Webhook URL host is required', 'INVALID_WEBHOOK_URL');
    return parsed;
}

class UrlCheckError extends Error {
    constructor(message, { retryable } = {}) {
        super(message);
        this.code = retryable ? 'WEBHOOK_UNRESOLVED' : 'INVALID_WEBHOOK_URL';
        this.retryable = retryable === true;
    }
}

async function resolveWebhookUrl(raw) {
    const parsed = parseWebhookUrl(raw);
    const hostname = parsed.hostname;
    if (isBlockedHostName(hostname) && !hostIsAllowlisted(hostname, [])) {
        throw new UrlCheckError('Webhook URL host is not allowed');
    }
    let addresses;
    try {
        addresses = await lookupHost(hostname);
    } catch (_err) {
        throw new UrlCheckError('Webhook URL host could not be resolved', { retryable: true });
    }
    const list = Array.isArray(addresses) ? addresses : (addresses ? [addresses] : []);
    const rows = list.map((row) => (typeof row === 'string' ? { address: row } : row)).filter((row) => row && row.address);
    if (!rows.length) throw new UrlCheckError('Webhook URL host could not be resolved', { retryable: true });
    if (!hostIsAllowlisted(hostname, rows) && rows.some((row) => isBlockedIp(row.address))) {
        throw new UrlCheckError('Webhook URL resolves to a private or reserved address');
    }
    return parsed.href;
}

async function validateWebhookUrl(raw) {
    try {
        return await resolveWebhookUrl(raw);
    } catch (err) {
        if (err instanceof UrlCheckError || (err && err.code === 'INVALID_WEBHOOK_URL')) {
            const mail = dovecoteMail();
            throw new mail.DovecoteError(err.message, 'INVALID_WEBHOOK_URL');
        }
        throw err;
    }
}

function sanitizeAuthHeader(value) {
    if (value == null || value === '') return null;
    const text = String(value);
    if (text.length > MAX_AUTH_HEADER_LENGTH) {
        throw new (dovecoteMail().DovecoteError)('Webhook auth header is too long', 'INVALID_WEBHOOK_AUTH');
    }
    if (/[\r\n]/.test(text)) {
        throw new (dovecoteMail().DovecoteError)('Webhook auth header is invalid', 'INVALID_WEBHOOK_AUTH');
    }
    return text;
}

function webhookRow(owner) {
    return getDb().prepare('SELECT owner, url, auth_header, updated_at FROM dovecote_mailbox_webhook WHERE owner = ?').get(owner) || null;
}

function publicWebhookView(owner, row) {
    return {
        mailbox: owner,
        url: row ? row.url : null,
        hasAuthHeader: !!(row && row.auth_header)
    };
}

async function setMailboxWebhook(owner, { url, authHeader } = {}) {
    const mail = dovecoteMail();
    if (!mail.isValidOwner(owner)) throw new mail.DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const href = await validateWebhookUrl(url);
    const header = sanitizeAuthHeader(authHeader);
    getDb().prepare(`
        INSERT INTO dovecote_mailbox_webhook (owner, url, auth_header, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET url = excluded.url, auth_header = excluded.auth_header, updated_at = excluded.updated_at
    `).run(owner, href, header, nowIso());
    mail.audit(owner, 'set_mailbox_webhook', null, true, 'url-set');
    return publicWebhookView(owner, webhookRow(owner));
}

function getMailboxWebhook(owner) {
    const mail = dovecoteMail();
    if (!mail.isValidOwner(owner)) throw new mail.DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    return publicWebhookView(owner, webhookRow(owner));
}

function clearMailboxWebhook(owner) {
    const mail = dovecoteMail();
    if (!mail.isValidOwner(owner)) throw new mail.DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    getDb().prepare('DELETE FROM dovecote_mailbox_webhook WHERE owner = ?').run(owner);
    mail.audit(owner, 'clear_mailbox_webhook', null, true, null);
    return publicWebhookView(owner, null);
}

function deliveryPayload(delivery) {
    return {
        mailbox: String(delivery.mailbox).slice(0, MAX_FIELD_CHARS),
        id: String(delivery.id).slice(0, MAX_FIELD_CHARS),
        from: String(delivery.from || '').slice(0, MAX_FIELD_CHARS),
        subject: String(delivery.subject || '').slice(0, MAX_FIELD_CHARS),
        receivedAt: String(delivery.receivedAt || '').slice(0, MAX_FIELD_CHARS)
    };
}

function shouldRetryStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}

async function postOnce(row, payload) {
    await resolveWebhookUrl(row.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    try {
        const headers = {
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': 'Dreamscape-Dovecote-Webhook/1.0'
        };
        if (row.auth_header) headers.authorization = row.auth_header;
        const response = await fetchFn()(row.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            redirect: 'manual',
            signal: controller.signal
        });
        const status = response && response.status;
        if (status >= 200 && status < 300) return { ok: true, status };
        const error = new Error(`webhook HTTP ${status}`);
        error.retryable = shouldRetryStatus(status);
        error.status = status;
        throw error;
    } catch (err) {
        if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
            const timeout = new Error('webhook timeout');
            timeout.retryable = true;
            throw timeout;
        }
        if (err instanceof UrlCheckError) {
            err.retryable = err.retryable === true;
            throw err;
        }
        if (err && err.retryable == null) err.retryable = true;
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function deliverToMailbox(delivery) {
    const row = webhookRow(delivery.mailbox);
    if (!row) return { skipped: true };
    const payload = deliveryPayload(delivery);
    const attempts = maxAttempts();
    const delays = backoffMs();
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const wait = delays[Math.min(attempt - 1, delays.length - 1)] || 0;
        if (wait) await sleep(wait);
        try {
            const result = await postOnce(row, payload);
            dovecoteMail().audit('system', 'mailbox_webhook', delivery.id, true, `mailbox=${delivery.mailbox} status=${result.status} attempts=${attempt}`);
            return result;
        } catch (err) {
            lastError = err;
            if (err && err.retryable === false) break;
        }
    }
    const status = lastError && lastError.status ? lastError.status : 'fail';
    dovecoteMail().audit('system', 'mailbox_webhook', delivery.id, false, `mailbox=${delivery.mailbox} status=${status}`);
    return { ok: false, error: lastError && lastError.message };
}

function notifyDeliveries(deliveries) {
    if (!Array.isArray(deliveries) || !deliveries.length) return;
    deliveries.forEach((delivery) => {
        if (!delivery || !delivery.mailbox || !delivery.id) return;
        if (pending.size >= MAX_PENDING) {
            try {
                dovecoteMail().audit('system', 'mailbox_webhook', delivery.id, false, `mailbox=${delivery.mailbox} status=dropped-queue-full`);
            } catch (_err) { /* audit best-effort */ }
            return;
        }
        const job = Promise.resolve()
            .then(() => deliverToMailbox(delivery))
            .catch((err) => {
                console.error('Dovecote mailbox webhook failed:', err.message);
            })
            .finally(() => pending.delete(job));
        pending.add(job);
    });
}

async function waitForIdle() {
    while (pending.size) {
        await Promise.all(Array.from(pending));
    }
}

async function handleMailboxWebhookTool(name, owner, input) {
    if (name === 'get_mailbox_webhook') {
        return { success: true, ...getMailboxWebhook(owner) };
    }
    if (name === 'clear_mailbox_webhook') {
        return { success: true, ...clearMailboxWebhook(owner) };
    }
    return { success: true, ...(await setMailboxWebhook(owner, input || {})) };
}

function hasMailboxWebhookScope(scopes) {
    if (!Array.isArray(scopes)) return false;
    return scopes.includes('universal')
        || scopes.includes('sfapp_dovecote')
        || scopes.includes('sfapp_dovecote:webhook');
}

module.exports = {
    setTestOverrides,
    resetForTests,
    validateWebhookUrl,
    parseWebhookUrl,
    isBlockedIp,
    isBlockedHostName,
    setMailboxWebhook,
    getMailboxWebhook,
    clearMailboxWebhook,
    notifyDeliveries,
    waitForIdle,
    handleMailboxWebhookTool,
    hasMailboxWebhookScope,
    publicWebhookView,
    MAX_PENDING,
    _guardedLookup: guardedLookup,
    _pinnedPost: pinnedPost
};
