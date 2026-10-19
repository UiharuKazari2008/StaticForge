/**
 * In-process mock of the LANTIS relay API for tests.
 * Dual tokens, GET /v1/senders, per-mailbox/service toggles, mutation audit.
 */

'use strict';

const http = require('http');

const READ_TOKEN = 'relay-read-test-token';
const ADMIN_TOKEN = 'relay-admin-test-token';

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
        oci: { sender: 'dreamscape@dream.737.jp.net', dkim: 'ok' },
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
            oci: {
                approved: [
                    { email: 'dreamscape@dream.737.jp.net', dkim: 'ok', state: 'approved' }
                ]
            },
            submission: [
                {
                    login: 'dreamscape@dream.737.jp.net',
                    from: [
                        'kazari.ops@dream.737.jp.net',
                        'kazari@dream.737.jp.net',
                        'yukimi.kazari@dream.737.jp.net',
                        'sala.ops@dream.737.jp.net',
                        'tsubame.ops@dream.737.jp.net',
                        'mailroom.ops@dream.737.jp.net'
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
        audit: []
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
                json(res, 200, state.toggles);
                return;
            }
            if (isPut && url.pathname === '/v1/toggles') {
                const body = await readBody(req);
                if (!body.actor) {
                    json(res, 400, { error: 'actor is required', code: 'ACTOR_REQUIRED' });
                    return;
                }
                const next = {
                    inbound: body.inbound !== false,
                    outbound: body.outbound !== false,
                    mailboxes: body.mailboxes && typeof body.mailboxes === 'object' ? body.mailboxes : state.toggles.mailboxes,
                    services: body.services && typeof body.services === 'object' ? body.services : state.toggles.services
                };
                state.toggles = next;
                state.audit.push({
                    actor: String(body.actor),
                    action: 'toggles',
                    target: 'global',
                    time: new Date().toISOString()
                });
                json(res, 200, next);
                return;
            }
            json(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
        } catch (_err) {
            json(res, 400, { error: 'Bad request', code: 'BAD_REQUEST' });
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
    startMockRelay
};
