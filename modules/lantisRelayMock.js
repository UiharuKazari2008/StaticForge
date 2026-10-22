/**
 * In-process mock of the LANTIS relay API for tests.
 * Dual tokens, GET /v1/senders, PATCH-like PUT /v1/toggles, mutation audit.
 */

'use strict';

const http = require('http');

const READ_TOKEN = 'relay-read-test-token';
const ADMIN_TOKEN = 'relay-admin-test-token';

const KNOWN_MAILBOXES = Object.freeze(['yukimi', 'sala', 'tsubame']);
const KNOWN_SERVICES = Object.freeze(['yozora']);

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function bearer(req) {
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : '';
}

function cloneToggles(toggles) {
    const mailboxes = {};
    Object.entries((toggles && toggles.mailboxes) || {}).forEach(([key, value]) => {
        mailboxes[key] = Object.assign({}, value);
    });
    const services = {};
    Object.entries((toggles && toggles.services) || {}).forEach(([key, value]) => {
        services[key] = Object.assign({}, value);
    });
    return {
        inbound: !!(toggles && toggles.inbound),
        outbound: !!(toggles && toggles.outbound),
        mailboxes,
        services
    };
}

function isBool(value) {
    return value === true || value === false;
}

function mergeFlags(prev, patch) {
    if (typeof patch !== 'object' || Array.isArray(patch)) {
        return { error: { error: 'Toggle entry must be an object or null', code: 'BAD_BODY' } };
    }
    const next = Object.assign({}, prev || {});
    if (Object.prototype.hasOwnProperty.call(patch, 'inbound')) {
        if (!isBool(patch.inbound)) {
            return { error: { error: 'inbound must be a boolean', code: 'BAD_BODY' } };
        }
        next.inbound = patch.inbound;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'outbound')) {
        if (!isBool(patch.outbound)) {
            return { error: { error: 'outbound must be a boolean', code: 'BAD_BODY' } };
        }
        next.outbound = patch.outbound;
    }
    return { value: next };
}

function applyTogglePatch(current, body) {
    const actor = body && body.actor != null ? String(body.actor).trim() : '';
    if (!actor) {
        return { error: { error: 'actor is required', code: 'ACTOR_REQUIRED' } };
    }
    const next = cloneToggles(current);
    if (Object.prototype.hasOwnProperty.call(body, 'inbound')) {
        if (!isBool(body.inbound)) {
            return { error: { error: 'inbound must be a boolean', code: 'BAD_BODY' } };
        }
        next.inbound = body.inbound;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'outbound')) {
        if (!isBool(body.outbound)) {
            return { error: { error: 'outbound must be a boolean', code: 'BAD_BODY' } };
        }
        next.outbound = body.outbound;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'mailboxes')) {
        if (body.mailboxes == null || typeof body.mailboxes !== 'object' || Array.isArray(body.mailboxes)) {
            return { error: { error: 'mailboxes must be an object', code: 'BAD_BODY' } };
        }
        const keys = Object.keys(body.mailboxes);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (KNOWN_MAILBOXES.indexOf(key) === -1) {
                return { error: { error: `Unknown mailbox ${key}`, code: 'UNKNOWN_MAILBOX' } };
            }
            const value = body.mailboxes[key];
            if (value === null) {
                delete next.mailboxes[key];
                continue;
            }
            const merged = mergeFlags(next.mailboxes[key], value);
            if (merged.error) return merged;
            next.mailboxes[key] = merged.value;
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'services')) {
        if (body.services == null || typeof body.services !== 'object' || Array.isArray(body.services)) {
            return { error: { error: 'services must be an object', code: 'BAD_BODY' } };
        }
        const keys = Object.keys(body.services);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (KNOWN_SERVICES.indexOf(key) === -1) {
                return { error: { error: `Unknown service ${key}`, code: 'UNKNOWN_SERVICE' } };
            }
            const value = body.services[key];
            if (value === null) {
                delete next.services[key];
                continue;
            }
            const merged = mergeFlags(next.services[key], value);
            if (merged.error) return merged;
            next.services[key] = merged.value;
        }
    }
    return { actor, value: next };
}

function defaultState() {
    return {
        postfix: { up: true, pid: 4242 },
        filters: {
            spamassassin: 'up',
            opendmarc: 'up',
            opendkim: 'up',
            unbound: 'up'
        },
        wireguard: { up: true, interface: 'wg0', peer: '192.168.255.2' },
        oci: { sender: 'kazari.ops@dream.737.jp.net', dkim: 'ok' },
        queue: { active: 0, deferred: 1, hold: 0, oldest_age: 12 },
        blocklists: {
            lists: {
                zen: { ok: true, listed: false, checked_at: '2026-10-19T21:00:00Z' },
                spamcop: { ok: true, listed: false, checked_at: '2026-10-19T21:00:00Z' },
                barracuda: { ok: true, listed: false, checked_at: '2026-10-19T21:00:00Z' },
                psbl: { ok: true, listed: false, checked_at: '2026-10-19T21:00:00Z' }
            },
            sa_rules_updated: '2026-10-18T04:12:00Z'
        },
        rejects: [
            {
                at: '2026-10-19T20:15:01Z',
                from: 'spammer@example.net',
                to: 'kazari.ops@dream.737.jp.net',
                code: '554',
                reason: 'blocked by zen.spamhaus.org'
            }
        ],
        senders: {
            refreshed_at: '2026-10-19T21:00:00Z',
            oci: {
                approved: [
                    { email: 'kazari.ops@dream.737.jp.net', dkim: 'ok', state: 'approved' }
                ]
            },
            submission: [
                {
                    login: 'dreamscape@dream.737.jp.net',
                    from: [
                        '*@dream.737.jp.net',
                        'kazari.ops@dream.737.jp.net',
                        'kazari@dream.737.jp.net',
                        'yukimi.kazari@dream.737.jp.net',
                        'yukimi@dream.737.jp.net',
                        'sala.ops@dream.737.jp.net',
                        'tsubame.ops@dream.737.jp.net',
                        'mailroom.ops@dream.737.jp.net',
                        'menma.dev@dream.737.jp.net',
                        'rook.dev@dream.737.jp.net',
                        'ivory.studio@dream.737.jp.net'
                    ]
                }
            ]
        },
        toggles: {
            inbound: true,
            outbound: true,
            mailboxes: {
                yukimi: { inbound: true, outbound: true },
                sala: { inbound: true, outbound: true },
                tsubame: { inbound: true, outbound: true }
            },
            services: {
                yozora: { outbound: true }
            }
        },
        audit: [],
        lastPutBody: null,
        lastRecipientsBody: null,
        recipients: [],
        recipientsEndpoint: true
    };
}

function startMockRelay(options) {
    const state = Object.assign(defaultState(), options && options.state);
    const readToken = (options && options.readToken) || READ_TOKEN;
    const adminToken = (options && options.adminToken) || ADMIN_TOKEN;

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const token = bearer(req);
        const isGet = req.method === 'GET';
        const isPut = req.method === 'PUT';

        if (isGet) {
            if (token !== readToken && token !== adminToken) {
                json(res, 401, { error: 'Unauthorized', code: 'RELAY_UNAUTHORIZED' });
                return;
            }
        } else if (isPut) {
            if (token !== adminToken) {
                json(res, 403, { error: 'Admin token required', code: 'RELAY_ADMIN_REQUIRED' });
                return;
            }
        } else {
            json(res, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
            return;
        }

        try {
            if (isGet && url.pathname === '/v1/status') {
                json(res, 200, {
                    postfix: state.postfix,
                    filters: state.filters,
                    wireguard: state.wireguard,
                    oci: state.oci
                });
                return;
            }
            if (isGet && url.pathname === '/v1/queue') {
                json(res, 200, state.queue);
                return;
            }
            if (isGet && url.pathname === '/v1/blocklists') {
                json(res, 200, state.blocklists);
                return;
            }
            if (isGet && url.pathname === '/v1/rejects') {
                const since = url.searchParams.get('since');
                const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
                let rows = state.rejects.slice();
                if (since) rows = rows.filter((row) => row.at >= since);
                json(res, 200, { rejects: rows.slice(0, limit) });
                return;
            }
            if (isGet && url.pathname === '/v1/senders') {
                json(res, 200, state.senders);
                return;
            }
            if (isGet && url.pathname === '/v1/toggles') {
                json(res, 200, cloneToggles(state.toggles));
                return;
            }
            if (isPut && url.pathname === '/v1/recipients') {
                if (state.recipientsEndpoint === false) {
                    json(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
                    return;
                }
                const body = await readBody(req);
                state.lastRecipientsBody = body;
                const actor = body && body.actor != null ? String(body.actor).trim() : '';
                if (!actor) {
                    json(res, 400, { error: 'actor is required', code: 'ACTOR_REQUIRED' });
                    return;
                }
                if (!Array.isArray(body.recipients)) {
                    json(res, 400, { error: 'recipients must be an array', code: 'BAD_BODY' });
                    return;
                }
                state.recipients = body.recipients;
                state.audit.push({
                    actor,
                    action: 'recipients',
                    target: 'global',
                    time: new Date().toISOString()
                });
                json(res, 200, { ok: true, count: body.recipients.length });
                return;
            }
            if (isPut && url.pathname === '/v1/toggles') {
                const body = await readBody(req);
                state.lastPutBody = body;
                const applied = applyTogglePatch(state.toggles, body);
                if (applied.error) {
                    json(res, 400, applied.error);
                    return;
                }
                state.toggles = applied.value;
                state.audit.push({
                    actor: applied.actor,
                    action: 'toggles',
                    target: 'global',
                    time: new Date().toISOString()
                });
                json(res, 200, cloneToggles(state.toggles));
                return;
            }
            json(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
        } catch (_err) {
            json(res, 400, { error: 'Bad request', code: 'BAD_BODY' });
        }
    });

    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                port: address.port,
                baseUrl: `http://127.0.0.1:${address.port}`,
                readToken,
                adminToken,
                state,
                close: () => new Promise((done) => server.close(() => done()))
            });
        });
        server.on('error', reject);
    });
}

module.exports = {
    READ_TOKEN,
    ADMIN_TOKEN,
    KNOWN_MAILBOXES,
    KNOWN_SERVICES,
    startMockRelay,
    applyTogglePatch
};
