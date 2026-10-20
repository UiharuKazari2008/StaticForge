'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-mailbox-notify-'));
const { initializeDovecoteDatabase, getDb } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const { resetForTests: resetExchangeDb } = require('../modules/mailExchangeDatabase');
assert.strictEqual(resetExchangeDb(path.join(tmpDir, 'exchange')), true);

const mail = require('../modules/dovecoteMail');
const events = require('../modules/dovecoteMailboxEvents');
const notify = require('../modules/dovecoteMailboxNotify');
const exchange = require('../modules/mailExchange');
const { handleExchangeTool } = require('../modules/mailExchangeMcp');
const { getEffectiveToolsForScopes } = require('../modules/mcpModuleRegistry');
const gateway = require('../modules/mailGateway');

function optionalRequire(id) {
    try {
        return require(id);
    } catch (_err) {
        return null;
    }
}
const notifyHttp = optionalRequire('../modules/dovecoteMailboxNotifyHttp');
const facadeTest = optionalRequire('../modules/mcpAgentFacade') && optionalRequire('../modules/mcpAgentFacade')._test;

exchange.setTestConfig({
    config: { enabled: true }
});

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

function textOf(result) {
    return JSON.parse(result.content[0].text);
}

function fakeSocket() {
    const ws = new EventEmitter();
    ws.readyState = 1;
    return ws;
}

async function main() {
    const sent = [];
    notify.setTestOverrides({
        coalesceMs: 0,
        globalPerMinute: 50,
        submitOutbound: async (input) => {
            sent.push(input);
            return { to: input.to };
        }
    });
    events.setTestOverrides({ socketPerMinute: 3 });

    assert.throws(
        () => notify.setMailboxNotifyForward('rook', { address: 'not-an-email' }),
        (err) => err.code === 'INVALID_NOTIFY_ADDRESS'
    );
    assert.throws(
        () => notify.setMailboxNotifyForward('rook', { address: 'rook.dev@dream.737.jp.net' }),
        (err) => err.code === 'INVALID_NOTIFY_ADDRESS'
    );
    assert.throws(
        () => notify.setMailboxNotifyForward('rook', { address: 'kazari.ops@mx.dream.737.jp.net' }),
        (err) => err.code === 'INVALID_NOTIFY_ADDRESS'
    );
    assert.throws(
        () => notify.setMailboxNotifyForward('rook', { address: 'rook@dream.co.jp' }),
        (err) => err.code === 'INVALID_NOTIFY_ADDRESS'
    );
    assert.throws(
        () => notify.setMailboxNotifyForward('nobody', { address: 'ok@example.com' }),
        (err) => err.code === 'UNKNOWN_OWNER'
    );

    const setRook = await notify.handleMailboxNotifyTool('set_mailbox_notify_forward', 'rook', {
        address: 'Rook Alerts <alerts@example.com>',
        mailbox: 'menma'
    });
    assert.strictEqual(setRook.success, true);
    assert.strictEqual(setRook.mailbox, 'rook');
    assert.strictEqual(setRook.address, 'alerts@example.com');

    const gotRook = notify.getMailboxNotifyForward('rook');
    assert.strictEqual(gotRook.address, 'alerts@example.com');
    assert.strictEqual(notify.getMailboxNotifyForward('menma').address, null);

    if (notifyHttp) {
        const httpMenma = await notifyHttp.handleMailboxNotifyHttp({
            method: 'PUT',
            applicationAuth: reqFor('Menma').applicationAuth,
            body: { address: 'menma@example.com', mailbox: 'rook' }
        });
        assert.strictEqual(httpMenma.status, 200);
        assert.strictEqual(httpMenma.body.mailbox, 'menma');
        assert.strictEqual(httpMenma.body.address, 'menma@example.com');
        await assert.rejects(
            () => notifyHttp.handleMailboxNotifyHttp({
                method: 'PUT',
                applicationAuth: { appName: 'Menma', applicationScopes: ['search'], applicationKeyId: 'k-Menma' },
                body: { address: 'x@example.com' }
            }),
            (err) => err.code === 'INSUFFICIENT_SCOPE'
        );
        await assert.rejects(
            () => notifyHttp.handleMailboxNotifyHttp({
                method: 'GET',
                applicationAuth: { appName: 'Yukimi', applicationScopes: ['sfapp_dovecote'], applicationKeyId: 'k-Yukimi' }
            }),
            (err) => err.code === 'FORBIDDEN'
        );
    }

    assert.ok(getEffectiveToolsForScopes(['sfapp_dovecote'], ['set_mailbox_notify_forward']).includes('set_mailbox_notify_forward'));
    assert.ok(!getEffectiveToolsForScopes(['sfapp_dovecote:read'], ['set_mailbox_notify_forward']).includes('set_mailbox_notify_forward'));
    assert.ok(getEffectiveToolsForScopes(['sfapp_dovecote:notify'], ['set_mailbox_notify_forward']).includes('set_mailbox_notify_forward'));
    if (facadeTest) {
        await assert.rejects(
            () => facadeTest.callTool({}, reqFor('Menma', ['sfapp_dovecote:read']), 'set_mailbox_notify_forward', {
                address: 'x@example.com'
            }),
            (err) => err.status === 403 && err.code === 'INSUFFICIENT_SCOPE'
        );
        assert.ok(facadeTest.listToolsForScopes(['sfapp_dovecote'], null, { owner: 'rook' }).some((t) => t.name === 'set_mailbox_notify_forward'));
        assert.ok(!facadeTest.listToolsForScopes(['sfapp_dovecote:read'], null, { owner: 'rook' }).some((t) => t.name === 'set_mailbox_notify_forward'));
        assert.ok(facadeTest.listToolsForScopes(['sfapp_mail_exchange'], null, { owner: 'sala' }).some((t) => t.name === 'exchange_set_mailbox_notify_forward'));
        assert.ok(!facadeTest.listToolsForScopes(['sfapp_mail_exchange'], null, { owner: 'menma' }).some((t) => t.name === 'exchange_set_mailbox_notify_forward'));
    }

    const denied = textOf(await handleExchangeTool(reqFor('Menma', ['sfapp_mail_exchange']), 'exchange_set_mailbox_notify_forward', {
        owner: 'rook', address: 'admin@example.com', confirm: true
    }));
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.code, 'FORBIDDEN');

    const noScope = textOf(await handleExchangeTool({
        applicationAuth: {
            appName: 'Tsubame',
            applicationKeyId: 'k-tsubame-noscope',
            applicationScopes: ['sfapp_dovecote']
        }
    }, 'exchange_get_mailbox_notify_forward', { owner: 'rook' }));
    assert.strictEqual(noScope.success, false);
    assert.strictEqual(noScope.code, 'INSUFFICIENT_SCOPE');

    const adminSet = textOf(await handleExchangeTool(reqFor('Sala', ['sfapp_mail_exchange']), 'exchange_set_mailbox_notify_forward', {
        owner: 'ivory', address: 'ivory-alerts@example.com', confirm: true
    }));
    assert.strictEqual(adminSet.success, true);
    assert.strictEqual(adminSet.mailbox, 'ivory');
    assert.strictEqual(adminSet.address, 'ivory-alerts@example.com');

    const seen = [];
    const unsub = events.subscribe((event) => seen.push(event));
    sent.length = 0;
    mail.sendMail({ fromOwner: 'yukimi', to: 'rook', subject: 'wake-up', body: 'secret body' });
    await notify.waitForIdle();
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].mailbox, 'rook');
    assert.strictEqual(seen[0].from, 'yukimi');
    assert.strictEqual(seen[0].subject, 'wake-up');
    assert.ok(seen[0].id);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to[0], 'alerts@example.com');
    assert.strictEqual(sent[0].body, '');
    assert.strictEqual(sent[0].skipSignature, true);
    assert.strictEqual(sent[0].extraHeaders['X-Dovecote-Notify-Forward'], '1');
    assert.strictEqual(sent[0].subject, 'You have new mail in rook: yukimi — wake-up');
    assert.ok(!JSON.stringify(sent[0]).includes('secret body'));
    unsub();

    const selfBefore = sent.length;
    mail.sendMail({ fromOwner: 'rook', to: 'rook', subject: 'self', body: 'nope' });
    await notify.waitForIdle();
    assert.strictEqual(sent.length, selfBefore, 'never notify for mail sent by the mailbox itself');

    const spamBefore = sent.length;
    mail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        toOwner: 'rook',
        subject: 'spam-skip',
        body: 'viagra',
        spam: true
    });
    await notify.waitForIdle();
    assert.strictEqual(sent.length, spamBefore);

    const inbound = mail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        toOwner: 'rook',
        subject: 'ext-in',
        body: 'hi'
    });
    await notify.waitForIdle();
    assert.ok(sent.some((item) => item.subject.includes('ext-in') && item.subject.includes('alice@example.com')));
    assert.ok(inbound.id);

    const loopBefore = sent.length;
    mail.deliverInboundMail({
        fromAddress: 'mailer@example.com',
        toOwner: 'rook',
        subject: 'You have new mail in rook: x — y',
        body: '',
        notifyLoop: true
    });
    await notify.waitForIdle();
    assert.strictEqual(sent.length, loopBefore);

    mail.deliverInboundMail({
        fromAddress: 'mailer@example.com',
        toOwner: 'rook',
        subject: 'looped-header',
        body: '',
        headers: { 'x-dovecote-notify-forward': '1' }
    });
    await notify.waitForIdle();
    assert.strictEqual(sent.length, loopBefore);

    const built = gateway.buildOutboundMessage({
        fromAddress: 'rook.dev@dream.737.jp.net',
        to: ['alerts@example.com'],
        subject: 'n',
        body: '',
        extraHeaders: { 'X-Dovecote-Notify-Forward': '1' }
    });
    assert.match(built, /X-Dovecote-Notify-Forward: 1/);

    notify.resetForTests();
    notify.setTestOverrides({
        coalesceMs: 40,
        globalPerMinute: 50,
        submitOutbound: async (input) => {
            sent.push(input);
            return { to: input.to };
        }
    });
    notify.bindEventStream();
    notify.setMailboxNotifyForward('rook', { address: 'alerts@example.com' });
    sent.length = 0;
    mail.sendMail({ fromOwner: 'yukimi', to: 'rook', subject: 'one', body: 'a' });
    await notify.waitForIdle();
    assert.strictEqual(sent.length, 1);
    mail.sendMail({ fromOwner: 'yukimi', to: 'rook', subject: 'two', body: 'b' });
    mail.sendMail({ fromOwner: 'yukimi', to: 'rook', subject: 'three', body: 'c' });
    assert.strictEqual(sent.length, 1, 'coalesce window holds extra mail');
    await notify.waitForIdle();
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[1].subject, 'You have 2 new messages in rook');

    const noticeAudits = auditRows('mailbox_notify_forward');
    assert.ok(noticeAudits.every((row) => row.actor === 'system'));
    assert.ok(noticeAudits.some((row) => row.success === 1 && /mailbox=rook/.test(row.detail)));
    assert.ok(auditRows('set_mailbox_notify_forward').some((row) => row.actor === 'rook' && row.success === 1));

    const wsSends = [];
    const rookWs = fakeSocket();
    const menmaWs = fakeSocket();
    events.subscribeSocket(rookWs, reqFor('Rook').applicationAuth, 'rook');
    events.subscribeSocket(menmaWs, reqFor('Menma').applicationAuth, 'menma');
    events.setTestOverrides({
        socketPerMinute: 2,
        sendToClient: (ws, message) => {
            wsSends.push({ ws, message });
        }
    });
    events.emitNewMail([
        { mailbox: 'rook', id: 'e1', from: 'yukimi', subject: 'ws-1', receivedAt: 't' },
        { mailbox: 'menma', id: 'e2', from: 'yukimi', subject: 'ws-m', receivedAt: 't' }
    ]);
    assert.strictEqual(wsSends.filter((row) => row.ws === rookWs && row.message.type === 'mailbox_new_mail').length, 1);
    assert.strictEqual(wsSends.filter((row) => row.ws === menmaWs).length, 1);
    assert.ok(!wsSends.some((row) => row.ws === rookWs && row.message.data && row.message.data.mailbox === 'menma'));

    events.emitNewMail([
        { mailbox: 'rook', id: 'e3', from: 'yukimi', subject: 'ws-2', receivedAt: 't' },
        { mailbox: 'rook', id: 'e4', from: 'yukimi', subject: 'ws-3', receivedAt: 't' }
    ]);
    const limited = wsSends.filter((row) => row.ws === rookWs && row.message.type === 'mailbox_new_mail_rate_limited');
    assert.strictEqual(limited.length, 1);
    assert.strictEqual(limited[0].message.data.dropped, 1);
    const rookMails = wsSends.filter((row) => row.ws === rookWs && row.message.type === 'mailbox_new_mail');
    assert.strictEqual(rookMails.length, 2);

    const menmaClient = {
        authMethod: 'application_key',
        appName: 'Menma',
        applicationAuth: reqFor('Menma').applicationAuth
    };
    assert.strictEqual(events.resolveSubscribeMailbox(menmaClient, null), 'menma');
    assert.throws(
        () => events.resolveSubscribeMailbox(menmaClient, 'rook'),
        (err) => err.code === 'FORBIDDEN'
    );

    notify.resetForTests();
    notify.setTestOverrides({
        coalesceMs: 0,
        globalPerMinute: 1,
        submitOutbound: async (input) => {
            sent.push(input);
            return { to: input.to };
        }
    });
    notify.bindEventStream();
    notify.setMailboxNotifyForward('ivory', { address: 'ivory-alerts@example.com' });
    sent.length = 0;
    mail.sendMail({ fromOwner: 'cursor', to: 'ivory', subject: 'cap-1', body: 'x' });
    await notify.waitForIdle();
    assert.strictEqual(sent.length, 1);
    mail.sendMail({ fromOwner: 'cursor', to: 'ivory', subject: 'cap-2', body: 'x' });
    assert.strictEqual(sent.length, 1, 'global notice cap holds the second send');
    notify.resetForTests();

    const cleared = notify.clearMailboxNotifyForward('rook');
    assert.strictEqual(cleared.address, null);
    sent.length = 0;
    notify.setTestOverrides({
        coalesceMs: 0,
        globalPerMinute: 50,
        submitOutbound: async (input) => {
            sent.push(input);
            return { to: input.to };
        }
    });
    mail.sendMail({ fromOwner: 'cursor', to: 'rook', subject: 'after-clear', body: 'x' });
    await notify.waitForIdle();
    assert.ok(!sent.some((item) => /after-clear/.test(item.subject)));

    const emitSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/dovecoteMail.js'), 'utf8');
    assert.match(emitSrc, /dovecoteMailboxEvents['"]\)\.emitNewMail/);
    assert.doesNotMatch(emitSrc, /dovecoteMailboxNotify['"]\)\.notifyDeliveries/);
    const httpSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/dovecoteMailboxNotifyHttp.js'), 'utf8');
    assert.match(httpSrc, /resolveDovecoteOwnerFromReq/);
    assert.doesNotMatch(httpSrc, /body\.mailbox|params\.owner|query\.mailbox/);

    notify.resetForTests();
    events.resetForTests();
    exchange.resetTestConfig();
    console.log('dovecote mailbox notify-forward tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
