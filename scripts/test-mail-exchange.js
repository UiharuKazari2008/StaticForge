'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-exchange-'));
const { resetForTests } = require('../modules/mailExchangeDatabase');
assert.strictEqual(resetForTests(tmpDir), true);

const addresses = require('../modules/mailGatewayAddresses');
const exchange = require('../modules/mailExchange');
const { startMockRelay } = require('../modules/lantisRelayMock');
const relayClient = require('../modules/lantisRelayClient');
const gateway = require('../modules/mailGateway');
const { handleExchangeTool } = require('../modules/mailExchangeMcp');
const { resolveHttpActor, resolveWsActor, resolveMcpActor } = require('../modules/mailExchangeAuth');

exchange.setTestConfig({
    config: { enabled: true },
    mailGateway: { mailboxes: addresses.DEFAULT_MAILBOXES }
});

function reqFor(appName, extra) {
    return {
        applicationAuth: {
            appName,
            applicationScopes: ['sfapp_mail_exchange'],
            applicationKeyId: `k-${appName}`
        },
        ...(extra || {})
    };
}

function textOf(result) {
    return JSON.parse(result.content[0].text);
}

function mapping() {
    return addresses.createMapping({ mailboxes: addresses.DEFAULT_MAILBOXES });
}

async function readSmtpReply(reader) {
    for (;;) {
        const line = await reader.readLine();
        if (line == null) throw new Error('SMTP closed');
        if (line[3] === '-') continue;
        return { code: parseInt(line.slice(0, 3), 10), text: line };
    }
}

async function smtpTalk(port, lines) {
    const socket = await new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port }, () => resolve(s));
        s.on('error', reject);
    });
    let buf = '';
    const queue = [];
    let waiters = [];
    socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
            let line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (waiters.length) waiters.shift()(line);
            else queue.push(line);
        }
    });
    const reader = {
        readLine() {
            if (queue.length) return Promise.resolve(queue.shift());
            return new Promise((resolve) => waiters.push(resolve));
        }
    };
    const replies = [];
    try {
        replies.push(await readSmtpReply(reader));
        for (const command of lines) {
            socket.write(`${command}\r\n`);
            replies.push(await readSmtpReply(reader));
        }
    } finally {
        socket.end();
    }
    return replies;
}

async function testRelayMockAndClient() {
    const mock = await startMockRelay();
    relayClient.setTestOverrides({
        config: { relay: { baseUrl: mock.baseUrl, timeoutMs: 2000 } },
        readToken: mock.readToken,
        adminToken: mock.adminToken
    });
    try {
        assert.strictEqual(relayClient.DEFAULT_BASE_URL, 'http://192.168.255.1:8787');
        const status = await relayClient.getStatus();
        assert.strictEqual(status.data.oci.sender, 'kazari.ops@dream.737.jp.net');

        const senders = await relayClient.getSenders();
        assert.strictEqual(senders.ok, true);
        assert.strictEqual(senders.data.refreshed_at, '2026-10-19T21:00:00Z');
        assert.match(senders.data.refreshed_at, /Z$/);
        assert.ok(senders.data.oci.approved.some((row) => row.email === 'kazari.ops@dream.737.jp.net'));
        assert.ok(!senders.data.oci.approved.some((row) => row.email === 'dreamscape@dream.737.jp.net'));
        assert.strictEqual(senders.data.submission[0].login, 'dreamscape@dream.737.jp.net');
        assert.ok(senders.data.submission[0].from.includes('*@dream.737.jp.net'));
        assert.ok(senders.data.submission[0].from.includes('kazari.ops@dream.737.jp.net'));
        assert.ok(senders.data.submission[0].from.includes('kazari@dream.737.jp.net'));
        assert.ok(senders.data.submission[0].from.includes('yukimi.kazari@dream.737.jp.net'));
        assert.ok(senders.data.submission[0].from.length > 6);

        const toggles = await relayClient.getToggles();
        assert.strictEqual(toggles.ok, true);
        assert.strictEqual(toggles.data.mailboxes.yukimi.inbound, true);
        assert.strictEqual(toggles.data.services.yozora.outbound, true);

        const denied = await fetch(`${mock.baseUrl}/v1/toggles`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${mock.readToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ actor: 'yukimi', inbound: false })
        });
        assert.strictEqual(denied.status, 403);

        const outboundOnly = await relayClient.putToggles(
            { outbound: false },
            { actor: 'yukimi', confirm: true }
        );
        assert.strictEqual(outboundOnly.ok, true);
        assert.strictEqual(outboundOnly.data.outbound, false);
        assert.strictEqual(outboundOnly.data.inbound, true);
        assert.strictEqual(outboundOnly.data.mailboxes.sala.outbound, true);
        assert.ok(!Object.prototype.hasOwnProperty.call(mock.state.lastPutBody, 'confirm'));
        assert.ok(!Object.prototype.hasOwnProperty.call(mock.state.lastPutBody, 'inbound'));
        assert.strictEqual(mock.state.lastPutBody.actor, 'yukimi');
        assert.strictEqual(mock.state.lastPutBody.outbound, false);

        const mailboxPatch = await relayClient.putToggles(
            { mailboxes: { yukimi: { inbound: false } } },
            { actor: 'sala', confirm: true }
        );
        assert.strictEqual(mailboxPatch.ok, true);
        assert.strictEqual(mailboxPatch.data.mailboxes.yukimi.inbound, false);
        assert.strictEqual(mailboxPatch.data.mailboxes.yukimi.outbound, true);
        assert.strictEqual(mailboxPatch.data.mailboxes.sala.inbound, true);
        assert.strictEqual(mailboxPatch.data.inbound, true);

        const deleted = await relayClient.putToggles(
            { mailboxes: { sala: null } },
            { actor: 'yukimi', confirm: true }
        );
        assert.strictEqual(deleted.ok, true);
        assert.strictEqual(deleted.data.mailboxes.sala, undefined);

        const unknownBox = await relayClient.putToggles(
            { mailboxes: { nova: { inbound: false } } },
            { actor: 'yukimi', confirm: true }
        );
        assert.strictEqual(unknownBox.ok, false);
        assert.strictEqual(unknownBox.degraded, false);
        assert.strictEqual(unknownBox.code, 'UNKNOWN_MAILBOX');
        assert.strictEqual(unknownBox.friendly, relayClient.friendlyRelayError('UNKNOWN_MAILBOX'));

        const unknownSvc = await relayClient.putToggles(
            { services: { smtp: { outbound: false } } },
            { actor: 'yukimi', confirm: true }
        );
        assert.strictEqual(unknownSvc.code, 'UNKNOWN_SERVICE');
        assert.strictEqual(unknownSvc.friendly, relayClient.friendlyRelayError('UNKNOWN_SERVICE'));

        const badBody = await relayClient.putToggles(
            { inbound: 'no' },
            { actor: 'yukimi', confirm: true }
        );
        assert.strictEqual(badBody.code, 'BAD_BODY');
        assert.strictEqual(badBody.friendly, relayClient.friendlyRelayError('BAD_BODY'));

        const emptyActor = await fetch(`${mock.baseUrl}/v1/toggles`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${mock.adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ actor: '  ', outbound: true })
        });
        assert.strictEqual(emptyActor.status, 400);
        const emptyJson = await emptyActor.json();
        assert.strictEqual(emptyJson.code, 'ACTOR_REQUIRED');

        const missingActor = await relayClient.putToggles({ outbound: true }, { confirm: true });
        assert.strictEqual(missingActor.code, 'ACTOR_REQUIRED');
        assert.strictEqual(missingActor.degraded, false);

        const noConfirm = await relayClient.putToggles({ outbound: true }, { actor: 'yukimi' });
        assert.strictEqual(noConfirm.code, 'CONFIRM_REQUIRED');

        assert.strictEqual(mock.state.audit[0].actor, 'yukimi');
        assert.strictEqual(mock.state.audit[0].action, 'toggles');
        assert.ok(!JSON.stringify(mock.state.audit).includes(mock.readToken));
        assert.ok(!JSON.stringify(mock.state.audit).includes(mock.adminToken));

        const beforeRelayFirst = exchange.getToggles();
        assert.strictEqual(beforeRelayFirst.outbound, true);
        const relayRejected = await exchange.setToggles('yukimi', {
            outbound: false,
            mailboxes: { nova: { inbound: false } },
            confirm: true
        });
        assert.strictEqual(relayRejected.relay.ok, false);
        assert.strictEqual(relayRejected.relay.code, 'UNKNOWN_MAILBOX');
        assert.strictEqual(relayRejected.toggles.outbound, true);
        assert.strictEqual(exchange.getToggles().outbound, true);

        const relayAccepted = await exchange.setToggles('yukimi', {
            outbound: false,
            confirm: true
        });
        assert.strictEqual(relayAccepted.relay.ok, true);
        assert.strictEqual(relayAccepted.toggles.outbound, false);
        assert.strictEqual(exchange.getToggles().outbound, false);

        const localPatch = await exchange.setToggles('yukimi', {
            outbound: false,
            mailboxes: { ivory: { inbound: false } },
            confirm: true,
            relay: false
        });
        assert.strictEqual(localPatch.toggles.inbound, true);
        assert.strictEqual(localPatch.toggles.outbound, false);
        assert.strictEqual(localPatch.toggles.mailboxes.ivory.inbound, false);
        assert.strictEqual(localPatch.relay.skipped, true);
    } finally {
        relayClient.resetForTests();
        await mock.close();
    }
}

async function testMailboxesKeysAliasesSignatures() {
    const yukimi = exchange.getMailboxRecord('yukimi');
    assert.strictEqual(yukimi.address, 'kazari.ops@dream.737.jp.net');
    assert.strictEqual(yukimi.localPart, 'kazari.ops');

    assert.throws(
        () => exchange.createMailbox('menma', { owner: 'nova', dept: 'ops', confirm: true }),
        (err) => err.code === 'FORBIDDEN'
    );

    const created = exchange.createMailbox('sala', { owner: 'nova', dept: 'lab', displayName: 'Nova', confirm: true });
    assert.strictEqual(created.owner, 'nova');
    assert.strictEqual(created.address, 'nova.lab@dream.737.jp.net');

    assert.throws(
        () => exchange.deleteMailbox('yukimi', { owner: 'yukimi', confirm: true, confirmText: 'DELETE' }),
        (err) => err.code === 'FORBIDDEN'
    );

    const issued = exchange.issueMailboxKey('yukimi', { owner: 'nova', confirm: true });
    assert.ok(issued.key.startsWith('dsmbox_'));
    assert.strictEqual(issued.shownOnce, true);
    assert.strictEqual(issued.keyHash, undefined);
    assert.strictEqual(exchange.verifyMailboxKey('nova', issued.key), true);
    const audit = exchange.listAudit({ limit: 50 });
    assert.ok(audit.every((row) => !String(row.detail || '').includes(issued.key)));
    assert.ok(audit.some((row) => row.action === 'issue_mailbox_key' && row.actor === 'yukimi' && row.success === 1));

    const rotated = exchange.rotateMailboxKey('mailroom', { owner: 'nova', confirm: true });
    assert.notStrictEqual(rotated.key, issued.key);
    assert.strictEqual(exchange.verifyMailboxKey('nova', issued.key), false);
    assert.strictEqual(exchange.verifyMailboxKey('nova', rotated.key), true);

    exchange.revokeMailboxKey('tsubame', { owner: 'nova', confirm: true });
    assert.strictEqual(exchange.verifyMailboxKey('nova', rotated.key), false);

    const doomed = exchange.createMailbox('sala', { owner: 'kiri', dept: 'ops', confirm: true });
    assert.strictEqual(doomed.owner, 'kiri');
    const doomedKey = exchange.issueMailboxKey('yukimi', { owner: 'kiri', confirm: true });
    assert.strictEqual(exchange.verifyMailboxKey('kiri', doomedKey.key), true);
    exchange.deleteMailbox('yukimi', { owner: 'kiri', confirm: true, confirmText: 'DELETE' });
    assert.strictEqual(exchange.verifyMailboxKey('kiri', doomedKey.key), false);

    const alias = exchange.upsertAlias('yukimi', { localPart: 'helpdesk', target: 'tsubame', confirm: true });
    assert.strictEqual(alias.address, 'helpdesk@dream.737.jp.net');
    const live = exchange.createLiveMapping();
    assert.strictEqual(addresses.toMailbox('helpdesk@dream.737.jp.net', live), 'tsubame');
    assert.strictEqual(addresses.toMailbox('mailroom.ops@dream.737.jp.net', live), 'tsubame');
    assert.strictEqual(addresses.toExternal('tsubame', live), 'tsubame.ops@dream.737.jp.net');

    exchange.upsertAlias('yukimi', { localPart: 'loop-b', target: 'loop-a', confirm: true });
    assert.throws(
        () => exchange.upsertAlias('yukimi', { localPart: 'loop-a', target: 'loop-b', confirm: true }),
        (err) => err.code === 'ALIAS_LOOP'
    );

    const list = exchange.upsertDistributionList('sala', {
        localPart: 'ops-all',
        name: 'ops',
        members: ['yukimi', 'sala'],
        confirm: true
    });
    assert.deepStrictEqual(list.members, ['yukimi', 'sala']);
    assert.throws(
        () => exchange.upsertDistributionList('sala', {
            localPart: 'loop-list',
            members: ['loop-list'],
            confirm: true
        }),
        (err) => err.code === 'ALIAS_LOOP'
    );

    const dirty = exchange.setSignature('yukimi', {
        owner: 'nova',
        html: '<p>Hi</p><script>alert(1)</script><img src="https://evil.example/x.png">',
        confirm: true
    });
    assert.ok(dirty.html.includes('<p>Hi</p>'));
    assert.ok(!dirty.html.includes('<script'));
    assert.ok(!/\ssrc=/.test(dirty.html));
    assert.ok(dirty.html.includes('data-blocked-src'));
    assert.strictEqual(dirty.counts.remoteImagesBlocked, 1);
    const appended = exchange.appendSignature('body', 'html', 'nova');
    assert.match(appended, /exchange-signature/);
    assert.match(appended, /Hi/);
}

async function testTogglesAtGateway() {
    await exchange.setToggles('yukimi', {
        inbound: true,
        outbound: true,
        mailboxes: { ivory: { inbound: false, outbound: true } },
        services: { yozora: { outbound: false } },
        confirm: true,
        relay: false
    });
    assert.strictEqual(exchange.isInboundAllowed('ivory'), false);
    assert.strictEqual(exchange.isInboundAllowed('menma'), true);
    assert.strictEqual(exchange.isOutboundAllowed('yukimi', 'yozora'), false);
    assert.ok(exchange.outboundRejectReason('yukimi', 'yozora'));

    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping()
    });
    try {
        const replies = await smtpTalk(inbound.port, [
            'LHLO postfix',
            'MAIL FROM:<alice@example.com>',
            'RCPT TO:<ivory.studio@dream.737.jp.net>',
            'RCPT TO:<menma.dev@dream.737.jp.net>'
        ]);
        assert.strictEqual(replies[3].code, 550);
        assert.match(replies[3].text, /Inbound/);
        assert.strictEqual(replies[4].code, 250);
    } finally {
        await inbound.close();
    }

    exchange.setTestConfig({
        config: { enabled: false },
        mailGateway: { mailboxes: addresses.DEFAULT_MAILBOXES }
    });
    assert.strictEqual(exchange.isInboundAllowed('ivory'), true);
    assert.strictEqual(exchange.isOutboundAllowed('yukimi', 'yozora'), true);
    exchange.setTestConfig({
        config: { enabled: true },
        mailGateway: { mailboxes: addresses.DEFAULT_MAILBOXES }
    });
}

async function testLiveAliasIntake() {
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1']
    });
    try {
        const before = await smtpTalk(inbound.port, [
            'LHLO postfix',
            'MAIL FROM:<alice@example.com>',
            'RCPT TO:<live-alias@dream.737.jp.net>',
            'QUIT'
        ]);
        assert.strictEqual(before[3].code, 550);
        exchange.upsertAlias('yukimi', { localPart: 'live-alias', target: 'tsubame', confirm: true });
        const after = await smtpTalk(inbound.port, [
            'LHLO postfix',
            'MAIL FROM:<alice@example.com>',
            'RCPT TO:<live-alias@dream.737.jp.net>',
            'QUIT'
        ]);
        assert.strictEqual(after[3].code, 250);
    } finally {
        await inbound.close();
        try { exchange.deleteAlias('yukimi', { localPart: 'live-alias', confirm: true }); } catch (_err) { /* ignore */ }
    }
}

async function testRoleGating() {
    ['yukimi', 'sala', 'mailroom', 'tsubame'].forEach((actor) => {
        assert.strictEqual(exchange.isExchangeAdmin(actor), true);
    });
    assert.strictEqual(exchange.isExchangeAdmin('menma'), false);
    assert.strictEqual(exchange.canonicalizeAdmin('tsubame'), 'tsubame');
    assert.strictEqual(exchange.canonicalizeAdmin('mailroom'), 'tsubame');

    assert.strictEqual(resolveWsActor({ userType: 'admin' }), 'yukimi');
    assert.strictEqual(resolveHttpActor({ userType: 'admin' }), 'yukimi');
    assert.strictEqual(resolveMcpActor(reqFor('Sala')), 'sala');
    assert.ok(!exchange.isExchangeAdmin(resolveMcpActor(reqFor('Mailroom'))));
    assert.strictEqual(resolveMcpActor(reqFor('Tsubame')), 'tsubame');

    const denied = textOf(await handleExchangeTool(reqFor('Menma'), 'exchange_list_mailboxes', {}));
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.code, 'FORBIDDEN');

    const listed = textOf(await handleExchangeTool(reqFor('Sala'), 'exchange_list_mailboxes', {}));
    assert.strictEqual(listed.success, true);
    assert.ok(listed.mailboxes.some((box) => box.address === 'kazari.ops@dream.737.jp.net'));

    const tsubame = textOf(await handleExchangeTool(reqFor('Tsubame'), 'exchange_status', {}));
    assert.strictEqual(tsubame.success, true);
    assert.ok(!JSON.stringify(tsubame).includes('relayReadToken'));
    assert.ok(!JSON.stringify(tsubame).includes('relayAdminToken'));
    assert.ok(!JSON.stringify(tsubame).includes('Bearer '));
}

function testTokensStayServerSide() {
    const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/lantisRelayClient.js'), 'utf8');
    const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/exchange.js'), 'utf8');
    const docSrc = fs.readFileSync(path.join(__dirname, '..', 'docs/lantis-relay-api.md'), 'utf8');
    const scopesSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/directorAppKeyScopes.js'), 'utf8');
    const secureMap = fs.readFileSync(path.join(__dirname, '..', 'config-maps/secureConfig.map.json'), 'utf8');
    assert.match(clientSrc, /relayReadToken/);
    assert.match(clientSrc, /relayAdminToken/);
    assert.match(docSrc, /GET \/v1\/senders/);
    assert.match(docSrc, /refreshed_at/);
    assert.match(docSrc, /UNKNOWN_MAILBOX/);
    assert.match(docSrc, /UNKNOWN_SERVICE/);
    assert.match(docSrc, /BAD_BODY/);
    assert.match(docSrc, /ACTOR_REQUIRED/);
    assert.match(docSrc, /mailboxes/);
    assert.match(docSrc, /actor/);
    assert.match(clientSrc, /pickTogglePatch/);
    assert.doesNotMatch(clientSrc, /confirm: true \}/);
    assert.match(secureMap, /relayReadToken/);
    assert.match(secureMap, /relayAdminToken/);
    assert.match(scopesSrc, /persona: 'sala'/);
    assert.match(scopesSrc, /persona: 'tsubame'/);
    assert.match(scopesSrc, /sfapp_mail_exchange/);
    assert.doesNotMatch(uiSrc, /relayReadToken|relayAdminToken|MAIL_EXCHANGE_RELAY_/);
}

async function main() {
    testTokensStayServerSide();
    await testRelayMockAndClient();
    await testMailboxesKeysAliasesSignatures();
    await testTogglesAtGateway();
    await testLiveAliasIntake();
    await testRoleGating();
    console.log('test-mail-exchange: ok');
}

async function closeHandles() {
    try { require('../modules/mailExchangeDatabase').close(); } catch (_err) { /* ignore */ }
    try { await gateway.resetForTests(); } catch (_err) { /* ignore */ }
    try { relayClient.resetForTests(); } catch (_err) { /* ignore */ }
    try { exchange.resetTestConfig(); } catch (_err) { /* ignore */ }
    try {
        const gr = require('../modules/globalResources');
        if (gr && typeof gr.closeHandlesForTests === 'function' && gr.initialized) {
            await gr.closeHandlesForTests();
        }
    } catch (_err) { /* globalResources was never loaded */ }
}

main().then(async () => {
    await closeHandles();
    process.exit(0);
}).catch(async (err) => {
    console.error(err);
    await closeHandles();
    process.exit(1);
});
