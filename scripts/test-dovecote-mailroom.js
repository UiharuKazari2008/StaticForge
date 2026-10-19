'use strict';

// Tsubame mailbox (mailroom role), mailroom.ops alias, trusted X-Original-To,
// and mailroom-gated Spam list/read/purge/rescue. Yukimi is Spam-only.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-mailroom-'));
const { initializeDovecoteDatabase, getDb } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');
const addresses = require('../modules/mailGatewayAddresses');
const spam = require('../modules/mailGatewaySpam');

function auditActions(action) {
    return getDb().prepare(
        'SELECT ts, actor, action, target_id, success, detail FROM dovecote_audit_log WHERE action = ?'
    ).all(action);
}

function main() {
    assert.strictEqual(mail.isValidOwner('tsubame'), true);
    assert.strictEqual(mail.isBotOwner('tsubame'), true);
    assert.strictEqual(mail.isValidOwner('mailroom'), false);
    assert.strictEqual(mail.MAILROOM_OWNER, 'tsubame');
    assert.strictEqual(mail.MAILROOM_ROLE, 'mailroom');
    assert.strictEqual(mail.isMailroomActor('tsubame'), true);
    assert.strictEqual(mail.isMailroomActor('rook'), false);
    assert.strictEqual(mail.isMailroomActor('mailroom'), false);
    assert.strictEqual(mail.resolveOwnerFromActor('Tsubame'), 'tsubame');
    assert.strictEqual(mail.resolveOwnerFromActor('Mailroom'), null);
    assert.strictEqual(mail.resolveOwnerFromActor('mailroom'), null);
    assert.throws(
        () => mail.mailroomListMail('mailroom', { mailbox: 'yukimi' }),
        (err) => err.code === 'FORBIDDEN'
    );

    const map = addresses.createMapping({ mailboxes: addresses.DEFAULT_MAILBOXES });
    assert.strictEqual(addresses.toMailbox('tsubame.ops@dream.737.jp.net', map), 'tsubame');
    assert.strictEqual(addresses.toMailbox('mailroom.ops@dream.737.jp.net', map), 'tsubame');
    assert.strictEqual(addresses.toMailbox('Mailroom.Ops@Dream.737.jp.net', map), 'tsubame');
    assert.strictEqual(addresses.toExternal('tsubame', map), 'tsubame.ops@dream.737.jp.net');

    const trusted = [
        'X-Original-To: <lost.dept@dream.737.jp.net>',
        'X-Original-To: <forged@evil.example>',
        'Received: from sender by mx.dream.737.jp.net',
        'X-Original-To: <below@dream.737.jp.net>',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.trustedOriginalTo(trusted), 'lost.dept@dream.737.jp.net');
    assert.strictEqual(spam.trustedOriginalTo([
        'Received: from sender by mx.dream.737.jp.net',
        'X-Original-To: <below@dream.737.jp.net>',
        'From: alice@example.com'
    ].join('\r\n')), null);

    const inbound = mail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        fromLabel: 'Alice <alice@example.com>',
        toOwner: 'tsubame',
        subject: 'catch-all',
        body: 'please file',
        originalTo: 'lost.dept@dream.737.jp.net'
    });
    assert.strictEqual(inbound.originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(inbound.owner, 'tsubame');
    const listed = mail.listMail('tsubame', { folder: 'inbox' });
    assert.strictEqual(listed[0].originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(mail.readMail('ivory', inbound.id), null);

    assert.throws(
        () => mail.mailroomForwardMail('rook', { id: inbound.id, to: 'ivory' }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.throws(
        () => mail.mailroomMoveMail('ivory', { mailbox: 'ivory', id: inbound.id, spam: true }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.throws(
        () => mail.mailroomListMail('rook', { mailbox: 'yukimi' }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.throws(
        () => mail.mailroomReadMail('guren', { mailbox: 'yukimi', id: inbound.id }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.throws(
        () => mail.mailroomPurgeMail('ivory', { mailbox: 'ivory', id: inbound.id }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.ok(auditActions('mailroom_forward_mail').some((row) => row.actor === 'rook' && row.success === 0));
    assert.ok(auditActions('mailroom_list_mail').some((row) => row.actor === 'rook' && row.success === 0));
    assert.ok(auditActions('mailroom_list_mail').some((row) => row.actor === 'mailroom' && row.success === 0));

    const fwd = mail.mailroomForwardMail('tsubame', { id: inbound.id, to: 'ivory' });
    assert.ok(fwd);
    const ivoryCopy = mail.readMail('ivory', fwd.id);
    assert.strictEqual(ivoryCopy.route, 'inbound');
    assert.strictEqual(ivoryCopy.originalTo, 'lost.dept@dream.737.jp.net');
    assert.ok(auditActions('mailroom_forward_mail').some((row) => (
        row.actor === 'tsubame' && row.success === 1 && /mailbox=tsubame/.test(row.detail)
    )));

    const botSpam = mail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        toOwner: 'guren',
        subject: 'bot-spam',
        body: 'viagra',
        spam: true
    });
    const rescuedBot = mail.mailroomMoveMail('tsubame', { mailbox: 'guren', id: botSpam.id, spam: false });
    assert.strictEqual(rescuedBot.folder, 'inbox');
    assert.ok(auditActions('mailroom_rescue_mail').some((row) => (
        row.actor === 'tsubame' && row.success === 1 && /mailbox=guren/.test(row.detail)
    )));
    const toSpam = mail.mailroomMoveMail('tsubame', { mailbox: 'guren', id: botSpam.id, spam: true });
    assert.strictEqual(toSpam.folder, 'spam');

    const yukimiInbox = mail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        toOwner: 'yukimi',
        subject: 'private-inbox',
        body: 'secret'
    });
    const yukimiSpam = mail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        toOwner: 'yukimi',
        subject: 'yukimi-spam',
        body: 'phishing',
        spam: true
    });

    const spamList = mail.mailroomListMail('tsubame', { mailbox: 'yukimi' });
    assert.strictEqual(spamList.length, 1);
    assert.strictEqual(spamList[0].id, yukimiSpam.id);
    assert.ok(!spamList.some((row) => row.id === yukimiInbox.id));
    assert.ok(auditActions('mailroom_list_mail').some((row) => (
        row.actor === 'tsubame' && row.success === 1 && /mailbox=yukimi/.test(row.detail)
    )));

    assert.throws(
        () => mail.mailroomListMail('tsubame', { mailbox: 'yukimi', folder: 'inbox' }),
        (err) => err.code === 'FORBIDDEN'
    );

    const readSpam = mail.mailroomReadMail('tsubame', { mailbox: 'yukimi', id: yukimiSpam.id });
    assert.strictEqual(readSpam.body, 'phishing');
    assert.strictEqual(readSpam.folder, 'spam');
    assert.ok(auditActions('mailroom_read_mail').some((row) => (
        row.actor === 'tsubame' && row.success === 1 && row.target_id === yukimiSpam.id
    )));

    assert.throws(
        () => mail.mailroomReadMail('tsubame', { mailbox: 'yukimi', id: yukimiInbox.id }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.ok(auditActions('mailroom_read_mail').some((row) => (
        row.success === 0 && row.target_id === yukimiInbox.id && /folder=inbox/.test(row.detail)
    )));
    assert.strictEqual(mail.readMail('tsubame', yukimiInbox.id), null);
    assert.strictEqual(mail.readMail('yukimi', yukimiInbox.id).folder, 'inbox');

    assert.throws(
        () => mail.mailroomMoveMail('tsubame', { mailbox: 'yukimi', id: yukimiInbox.id, spam: true }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.strictEqual(mail.readMail('yukimi', yukimiInbox.id).folder, 'inbox');

    const rescued = mail.mailroomMoveMail('tsubame', { mailbox: 'yukimi', id: yukimiSpam.id, spam: false });
    assert.strictEqual(rescued.folder, 'inbox');
    assert.strictEqual(mail.readMail('yukimi', yukimiSpam.id).folder, 'inbox');
    assert.ok(auditActions('mailroom_rescue_mail').some((row) => (
        row.actor === 'tsubame' && row.success === 1 && /mailbox=yukimi/.test(row.detail)
    )));

    const purgeTarget = mail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        toOwner: 'yukimi',
        subject: 'purge-me',
        body: 'gone',
        spam: true
    });
    const purged = mail.mailroomPurgeMail('tsubame', { mailbox: 'yukimi', id: purgeTarget.id });
    assert.strictEqual(purged.folder, 'deleted');
    assert.strictEqual(purged.purged, true);
    assert.strictEqual(purged.body, undefined);
    assert.strictEqual(mail.readMail('yukimi', purgeTarget.id).folder, 'deleted');
    assert.ok(auditActions('mailroom_purge_mail').some((row) => (
        row.actor === 'tsubame' && row.success === 1 && /purge=soft/.test(row.detail)
    )));
    assert.throws(
        () => mail.mailroomPurgeMail('tsubame', { mailbox: 'yukimi', id: yukimiInbox.id }),
        (err) => err.code === 'FORBIDDEN'
    );

    const facadeSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/mcpAgentFacade.js'), 'utf8');
    assert.match(facadeSrc, /name: 'mailroom_forward_mail'/);
    assert.match(facadeSrc, /name: 'mailroom_list_mail'/);
    assert.match(facadeSrc, /name: 'mailroom_read_mail'/);
    assert.match(facadeSrc, /name: 'mailroom_purge_mail'/);
    assert.match(facadeSrc, /owner !== dovecoteMail\.MAILROOM_OWNER/);
    assert.match(facadeSrc, /auditMailroomDenied/);
    assert.match(facadeSrc, /role: 'mailroom'/);
    assert.match(facadeSrc, /Tsubame/);
    const mailSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/dovecoteMail.js'), 'utf8');
    assert.doesNotMatch(mailSrc, /mailroom:\s*'tsubame'/);
    const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/ws/handlers/250-dovecoteHandler.js'), 'utf8');
    assert.match(handlerSrc, /tsubame: 'Tsubame'/);
    assert.doesNotMatch(handlerSrc, /mailroom: 'Mailroom'/);

    console.log('dovecote mailroom tests passed');
}

main();
