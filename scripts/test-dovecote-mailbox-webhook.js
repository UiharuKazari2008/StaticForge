'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-mailbox-webhook-'));
const { initializeDovecoteDatabase, getDb } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);

const mail = require('../modules/dovecoteMail');
const webhook = require('../modules/dovecoteMailboxWebhook');
const { getEffectiveToolsForScopes } = require('../modules/mcpModuleRegistry');
function optionalRequire(id) {
    try {
        return require(id);
    } catch (_err) {
        return null;
    }
}
const webhookHttp = optionalRequire('../modules/dovecoteMailboxWebhookHttp');
const facadeTest = optionalRequire('../modules/mcpAgentFacade') && optionalRequire('../modules/mcpAgentFacade')._test;

const PUBLIC_HOST = 'hook.example';
const PUBLIC_IP = '203.0.113.10';
const PUBLIC_URL = `https://${PUBLIC_HOST}/mail`;

function reqFor(appName, scopes) {
    return {
        applicationAuth: {
            appName,
            applicationScopes: scopes || ['sfapp_dovecote'],
            applicationKeyId: `k-${appName}`
        }
    };
}

function auditRows(action) {
    return getDb().prepare(
        'SELECT actor, action, target_id, success, detail FROM dovecote_audit_log WHERE action = ? ORDER BY rowid'
    ).all(action);
}

function countListMail(actor) {
    return getDb().prepare(
        'SELECT COUNT(*) AS n FROM dovecote_audit_log WHERE action = ? AND actor = ?'
    ).get('list_mail', actor).n;
}

async function lookup(hostname) {
    if (hostname === PUBLIC_HOST) return [{ address: PUBLIC_IP, family: 4 }];
    if (hostname === 'evil.example') return [{ address: '10.1.2.3', family: 4 }];
    if (hostname === '127.0.0.1') return [{ address: '127.0.0.1', family: 4 }];
    if (hostname === '169.254.169.254') return [{ address: '169.254.169.254', family: 4 }];
    throw new Error('unexpected host ' + hostname);
}

async function main() {
    const posts = [];
    const sleeps = [];
    webhook.setTestOverrides({
        lookup,
        config: {},
        fetch: async (url, opts) => {
            posts.push({
                url,
                headers: opts.headers,
                body: JSON.parse(opts.body),
                redirect: opts.redirect
            });
            return { ok: true, status: 204 };
        },
        sleep: async (ms) => { sleeps.push(ms); }
    });

    await assert.rejects(
        () => webhook.setMailboxWebhook('rook', { url: 'ftp://hook.example/mail' }),
        (err) => err.code === 'INVALID_WEBHOOK_URL'
    );
    await assert.rejects(
        () => webhook.setMailboxWebhook('rook', { url: 'https://user:pass@hook.example/mail' }),
        (err) => err.code === 'INVALID_WEBHOOK_URL'
    );
    await assert.rejects(
        () => webhook.setMailboxWebhook('rook', { url: 'https://localhost/mail' }),
        (err) => err.code === 'INVALID_WEBHOOK_URL'
    );
    await assert.rejects(
        () => webhook.setMailboxWebhook('rook', { url: 'http://127.0.0.1/mail' }),
        (err) => err.code === 'INVALID_WEBHOOK_URL'
    );
    await assert.rejects(
        () => webhook.setMailboxWebhook('rook', { url: 'https://evil.example/mail' }),
        (err) => err.code === 'INVALID_WEBHOOK_URL'
    );
    await assert.rejects(
        () => webhook.setMailboxWebhook('rook', { url: 'http://169.254.169.254/latest/meta-data' }),
        (err) => err.code === 'INVALID_WEBHOOK_URL'
    );

    webhook.setTestOverrides({
        lookup,
        config: { allowPrivateHosts: ['127.0.0.1'] },
        fetch: async (url, opts) => {
            posts.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
            return { ok: true, status: 200 };
        },
        sleep: async (ms) => { sleeps.push(ms); }
    });
    const allowed = await webhook.setMailboxWebhook('ivory', {
        url: 'http://127.0.0.1:9/hook',
        authHeader: 'Bearer loopback'
    });
    assert.strictEqual(allowed.mailbox, 'ivory');
    assert.strictEqual(allowed.url, 'http://127.0.0.1:9/hook');
    assert.strictEqual(allowed.hasAuthHeader, true);
    assert.strictEqual(allowed.authHeader, undefined);
    webhook.clearMailboxWebhook('ivory');

    webhook.setTestOverrides({
        lookup,
        config: {},
        fetch: async (url, opts) => {
            posts.push({
                url,
                headers: opts.headers,
                body: JSON.parse(opts.body),
                redirect: opts.redirect
            });
            return { ok: true, status: 204 };
        },
        sleep: async (ms) => { sleeps.push(ms); }
    });
    posts.length = 0;

    const setRook = await webhook.handleMailboxWebhookTool('set_mailbox_webhook', 'rook', {
        url: PUBLIC_URL,
        authHeader: 'Bearer rook-secret',
        mailbox: 'menma'
    });
    assert.strictEqual(setRook.success, true);
    assert.strictEqual(setRook.mailbox, 'rook');
    assert.strictEqual(setRook.url, PUBLIC_URL);
    assert.strictEqual(setRook.hasAuthHeader, true);
    assert.strictEqual(setRook.authHeader, undefined);

    const gotRook = webhook.getMailboxWebhook('rook');
    assert.strictEqual(gotRook.mailbox, 'rook');
    assert.strictEqual(gotRook.hasAuthHeader, true);
    assert.strictEqual(JSON.stringify(gotRook).includes('rook-secret'), false);

    const menmaView = webhook.getMailboxWebhook('menma');
    assert.strictEqual(menmaView.mailbox, 'menma');
    assert.strictEqual(menmaView.url, null);

    if (webhookHttp) {
        const httpMenma = await webhookHttp.handleMailboxWebhookHttp({
            method: 'PUT',
            applicationAuth: reqFor('Menma').applicationAuth,
            body: { url: PUBLIC_URL, mailbox: 'rook', authHeader: 'Bearer menma-secret' }
        });
        assert.strictEqual(httpMenma.status, 200);
        assert.strictEqual(httpMenma.body.mailbox, 'menma');
        assert.strictEqual(httpMenma.body.url, PUBLIC_URL);

        await assert.rejects(
            () => webhookHttp.handleMailboxWebhookHttp({
                method: 'PUT',
                applicationAuth: { appName: 'Menma', applicationScopes: ['search'], applicationKeyId: 'k-Menma' },
                body: { url: PUBLIC_URL }
            }),
            (err) => err.code === 'INSUFFICIENT_SCOPE'
        );
        await assert.rejects(
            () => webhookHttp.handleMailboxWebhookHttp({
                method: 'GET',
                applicationAuth: { appName: 'Yukimi', applicationScopes: ['sfapp_dovecote'], applicationKeyId: 'k-Yukimi' }
            }),
            (err) => err.code === 'FORBIDDEN'
        );
    } else {
        await webhook.setMailboxWebhook('menma', { url: PUBLIC_URL, authHeader: 'Bearer menma-secret' });
    }

    assert.ok(getEffectiveToolsForScopes(['sfapp_dovecote'], ['set_mailbox_webhook']).includes('set_mailbox_webhook'));
    assert.ok(!getEffectiveToolsForScopes(['sfapp_dovecote:read'], ['set_mailbox_webhook']).includes('set_mailbox_webhook'));
    if (facadeTest) {
        await assert.rejects(
            () => facadeTest.callTool({}, reqFor('Menma', ['sfapp_dovecote:read']), 'set_mailbox_webhook', { url: PUBLIC_URL }),
            (err) => err.status === 403 && err.code === 'INSUFFICIENT_SCOPE'
        );
        assert.ok(facadeTest.listToolsForScopes(['sfapp_dovecote'], null, { owner: 'rook' }).some((t) => t.name === 'set_mailbox_webhook'));
        assert.ok(!facadeTest.listToolsForScopes(['sfapp_dovecote:read'], null, { owner: 'rook' }).some((t) => t.name === 'set_mailbox_webhook'));
    }

    posts.length = 0;
    mail.sendMail({ fromOwner: 'yukimi', to: ['rook', 'menma'], subject: 'wake-up', body: 'hello bots' });
    await webhook.waitForIdle();
    assert.strictEqual(posts.length, 2);
    const byMailbox = Object.fromEntries(posts.map((post) => [post.body.mailbox, post]));
    assert.ok(byMailbox.rook);
    assert.ok(byMailbox.menma);
    assert.strictEqual(byMailbox.rook.body.from, 'yukimi');
    assert.strictEqual(byMailbox.rook.body.subject, 'wake-up');
    assert.ok(byMailbox.rook.body.id);
    assert.ok(byMailbox.rook.body.receivedAt);
    assert.strictEqual(byMailbox.rook.headers.authorization, 'Bearer rook-secret');
    assert.strictEqual(byMailbox.menma.headers.authorization, 'Bearer menma-secret');
    assert.strictEqual(byMailbox.rook.redirect, 'manual');
    assert.notStrictEqual(byMailbox.rook.body.id, byMailbox.menma.body.id);
    assert.ok(!posts.some((post) => post.body.mailbox === 'yukimi'));
    assert.ok(!posts.some((post) => /rook-secret|menma-secret/.test(JSON.stringify(post.body))));

    const hoshinoBefore = posts.length;
    mail.sendMail({ fromOwner: 'yukimi', to: 'hoshino', subject: 'no-hook', body: 'x' });
    await webhook.waitForIdle();
    assert.strictEqual(posts.length, hoshinoBefore, 'no webhook registered means no POST');

    mail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        toOwner: 'rook',
        subject: 'spam-skip',
        body: 'viagra',
        spam: true
    });
    await webhook.waitForIdle();
    assert.ok(!posts.some((post) => post.body.subject === 'spam-skip'));

    const inbound = mail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        toOwner: 'rook',
        subject: 'ext-in',
        body: 'hi'
    });
    await webhook.waitForIdle();
    assert.ok(posts.some((post) => post.body.id === inbound.id && post.body.from === 'alice@example.com'));

    const webhookAudits = auditRows('mailbox_webhook');
    assert.ok(webhookAudits.every((row) => row.actor === 'system'));
    assert.ok(webhookAudits.some((row) => row.success === 1 && /mailbox=rook/.test(row.detail)));
    assert.ok(!webhookAudits.some((row) => /Bearer|hook\.example/.test(row.detail || '')));

    const silentBefore = countListMail('chiyo');
    mail.listMail('chiyo', { folder: 'inbox', silent: true });
    assert.strictEqual(countListMail('chiyo'), silentBefore, 'silent listMail must not write an owner list_mail audit');
    mail.listMail('chiyo', { folder: 'inbox' });
    assert.strictEqual(countListMail('chiyo'), silentBefore + 1, 'normal listMail still audits the owner');

    const handler = require('../modules/ws/handlers/250-dovecoteHandler');
    const broadcasts = [];
    const filters = [];
    handler.registerPackets({
        globalResources: {
            getWebSocketServer: () => ({
                broadcast: (msg, filter) => {
                    broadcasts.push(msg);
                    filters.push(filter);
                }
            })
        }
    });
    const salaListBefore = countListMail('sala');
    const systemListBefore = countListMail('system');
    broadcasts.length = 0;
    mail.sendMail({ fromOwner: 'yukimi', to: 'sala', subject: 'push-silent', body: 'live' });
    await webhook.waitForIdle();
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].type, 'dovecote_mailbox_updated');
    assert.strictEqual(countListMail('sala'), salaListBefore, 'browser push must not log list_mail as the mailbox owner');
    assert.strictEqual(countListMail('system'), systemListBefore, 'browser push must not log list_mail as system either');
    assert.strictEqual(filters[0]({ authenticated: true, userType: 'admin', sessionId: 'sess-cookie' }), true);
    assert.strictEqual(filters[0]({ authenticated: true, userType: 'admin', authMethod: 'application_key', applicationKeyId: 'k-rook', applicationScopes: ['sfapp_dovecote'], sessionId: 'appkey:k-rook' }), false);
    assert.strictEqual(filters[0]({ authenticated: false, applicationAuth: { appName: 'Rook' } }), false);
    assert.strictEqual(filters[0]({ applicationAuth: { appName: 'Rook' } }), false);
    mail.setMailboxChangedListener(null);

    posts.length = 0;
    sleeps.length = 0;
    let attempts = 0;
    webhook.setTestOverrides({
        lookup,
        config: { backoffMs: [0, 25, 50], maxAttempts: 5, timeoutMs: 1000 },
        fetch: async () => {
            attempts += 1;
            if (attempts < 3) {
                const err = new Error('ECONNRESET');
                err.retryable = true;
                throw err;
            }
            return { ok: true, status: 200 };
        },
        sleep: async (ms) => { sleeps.push(ms); }
    });
    mail.sendMail({ fromOwner: 'cursor', to: 'rook', subject: 'retry-ok', body: 'x' });
    await webhook.waitForIdle();
    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(sleeps, [25, 50]);
    const retryAudit = auditRows('mailbox_webhook').filter((row) => row.target_id && row.detail.includes('attempts=3'));
    assert.ok(retryAudit.some((row) => row.actor === 'system' && row.success === 1));

    posts.length = 0;
    sleeps.length = 0;
    attempts = 0;
    webhook.setTestOverrides({
        lookup,
        config: { backoffMs: [0, 10, 20, 30], maxAttempts: 4, timeoutMs: 1000 },
        fetch: async () => {
            attempts += 1;
            return { ok: false, status: 503 };
        },
        sleep: async (ms) => { sleeps.push(ms); }
    });
    mail.sendMail({ fromOwner: 'cursor', to: 'rook', subject: 'retry-fail', body: 'x' });
    await webhook.waitForIdle();
    assert.strictEqual(attempts, 4);
    assert.deepStrictEqual(sleeps, [10, 20, 30]);
    assert.ok(auditRows('mailbox_webhook').some((row) => (
        row.actor === 'system' && row.success === 0 && /status=503/.test(row.detail)
    )));

    attempts = 0;
    sleeps.length = 0;
    webhook.setTestOverrides({
        lookup,
        config: { backoffMs: [0, 99], maxAttempts: 5 },
        fetch: async () => {
            attempts += 1;
            return { ok: false, status: 404 };
        },
        sleep: async (ms) => { sleeps.push(ms); }
    });
    mail.sendMail({ fromOwner: 'cursor', to: 'rook', subject: 'no-retry-4xx', body: 'x' });
    await webhook.waitForIdle();
    assert.strictEqual(attempts, 1);
    assert.deepStrictEqual(sleeps, []);

    const cleared = webhook.clearMailboxWebhook('rook');
    assert.strictEqual(cleared.url, null);
    posts.length = 0;
    mail.sendMail({ fromOwner: 'cursor', to: 'rook', subject: 'after-clear', body: 'x' });
    await webhook.waitForIdle();
    assert.ok(!posts.some((post) => post.body.subject === 'after-clear'));

    const httpSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/dovecoteMailboxWebhookHttp.js'), 'utf8');
    assert.match(httpSrc, /resolveDovecoteOwnerFromReq/);
    assert.doesNotMatch(httpSrc, /body\.mailbox|params\.owner|query\.mailbox/);
    const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/ws/handlers/250-dovecoteHandler.js'), 'utf8');
    assert.match(handlerSrc, /silent:\s*true/);
    assert.match(handlerSrc, /isMailboxSnapshotRecipient/);

    await menmaReviewChecks();
    console.log('dovecote mailbox webhook tests passed');
}

// Menma review r1: connect-time rebinding guard, embedded-IPv4 ranges,
// real HTTP path (no redirect follow), bounded queue.
async function menmaReviewChecks() {
    const http = require('http');
    for (const ip of ['100.64.1.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'ff02::1', '198.18.0.1']) {
        assert.strictEqual(webhook.isBlockedIp(ip), true, ip);
    }
    assert.strictEqual(webhook.isBlockedIp('203.0.113.10'), false);

    // Rebinding: pre-check sees a public IP, connect-time lookup sees loopback.
    let hits = 0;
    const server = http.createServer((req, res) => {
        hits += 1;
        if (req.url === '/redir') { res.writeHead(302, { location: 'http://127.0.0.1/x' }); res.end(); return; }
        res.writeHead(204); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
        webhook.setTestOverrides({
            lookup: async () => [{ address: PUBLIC_IP, family: 4 }],
            connectLookup: (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]),
            config: { backoffMs: [0], maxAttempts: 3 }
        });
        await webhook.setMailboxWebhook('rook', { url: `http://rebind.example:${port}/hook`, authHeader: 'Bearer s3cret' });
        mail.sendMail({ fromOwner: 'cursor', to: 'rook', subject: 'rebind', body: 'x' });
        await webhook.waitForIdle();
        assert.strictEqual(hits, 0, 'rebinding answer must never be connected to');
        const last = auditRows('mailbox_webhook').pop();
        assert.strictEqual(last.success, 0);
        assert.doesNotMatch(JSON.stringify(auditRows('set_mailbox_webhook')), /s3cret/);
        assert.strictEqual(webhook.getMailboxWebhook('rook').hasAuthHeader, true);
        assert.doesNotMatch(JSON.stringify(webhook.getMailboxWebhook('rook')), /s3cret/);

        // Allowlisted loopback: real POST succeeds; 302 is not followed.
        webhook.setTestOverrides({
            lookup: async () => [{ address: '127.0.0.1', family: 4 }],
            config: { allowPrivateHosts: ['127.0.0.1'], backoffMs: [0], maxAttempts: 3 }
        });
        const ok = await webhook._pinnedPost(`http://127.0.0.1:${port}/hook`, { headers: {}, body: '{}' });
        assert.strictEqual(ok.status, 204);
        const before = hits;
        const red = await webhook._pinnedPost(`http://127.0.0.1:${port}/redir`, { headers: {}, body: '{}' });
        assert.strictEqual(red.status, 302);
        assert.strictEqual(hits, before + 1, 'redirect not followed');
    } finally {
        server.close();
    }

    // Bounded queue: never more than MAX_PENDING in flight.
    let release;
    const gate = new Promise((r) => { release = r; });
    webhook.setTestOverrides({
        lookup: async () => [{ address: PUBLIC_IP, family: 4 }],
        config: { backoffMs: [0], maxAttempts: 1 },
        fetch: async () => { await gate; return { status: 204 }; }
    });
    await webhook.setMailboxWebhook('rook', { url: PUBLIC_URL });
    const n = webhook.MAX_PENDING + 25;
    webhook.notifyDeliveries(Array.from({ length: n }, (_, i) => ({ mailbox: 'rook', id: `q${i}`, subject: 's' })));
    const dropped = auditRows('mailbox_webhook').filter((row) => /dropped-queue-full/.test(row.detail)).length;
    assert.strictEqual(dropped, 25);
    release();
    await webhook.waitForIdle();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
