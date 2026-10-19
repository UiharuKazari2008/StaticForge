'use strict';

// Spam folder: inbound classification, internal never auto-filed, owner-scoped
// list/read/move. MCP mark_mail.spam and list_mail folder=spam use these same
// functions.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-spam-'));
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');
const facadeSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/mcpAgentFacade.js'), 'utf8');

function main() {
    mail.sendMail({ fromOwner: 'menma', to: 'rook', subject: 'internal-ok', body: 'hi' });
    assert.strictEqual(mail.listMail('rook', { folder: 'spam' }).length, 0);
    assert.strictEqual(mail.listMail('rook', { folder: 'inbox' }).length, 1);

    const inbound = mail.deliverInboundMail({
        fromAddress: 'evil@ext.com',
        fromLabel: 'menma',
        toOwner: 'ivory',
        subject: 'gw-spam',
        body: 'buy',
        spam: true,
        spamMeta: { score: 8.1, required: 5.0, report: '* 8.1 BAYES_99', forgedOurs: true, dkim: 'fail', dmarc: 'fail', dmarcP: 'none' },
        originalTo: 'lost@dream.737.jp.net'
    });
    assert.strictEqual(inbound.folder, 'spam');
    assert.strictEqual(inbound.route, 'inbound');
    const listed = mail.listMail('ivory', { folder: 'spam' });
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].id, inbound.id);
    assert.strictEqual(listed[0].external, true);
    assert.strictEqual(listed[0].labelSuspicious, true);
    assert.strictEqual(listed[0].route, 'inbound');
    assert.strictEqual(listed[0].spamScore, 8.1);
    assert.strictEqual(listed[0].spamRequired, 5.0);
    assert.strictEqual(listed[0].spamReport, '* 8.1 BAYES_99');
    assert.strictEqual(listed[0].spamForgedOurs, true);
    assert.strictEqual(listed[0].spamDkim, 'fail');
    assert.strictEqual(listed[0].spamDmarcPolicy, 'none');
    assert.strictEqual(listed[0].originalTo, 'lost@dream.737.jp.net');
    assert.strictEqual(mail.listMail('ivory', { folder: 'inbox' }).length, 0);
    assert.strictEqual(mail.listMail('rook', { folder: 'spam' }).length, 0);
    assert.strictEqual(mail.listMailboxes().find((box) => box.owner === 'ivory').spamUnread, 1);
    assert.strictEqual(mail.listMailboxes().find((box) => box.owner === 'rook').spamUnread, 0);

    const read = mail.readMail('ivory', inbound.id);
    assert.ok(read);
    assert.strictEqual(read.folder, 'spam');
    assert.strictEqual(read.body, 'buy');
    assert.strictEqual(mail.readMail('rook', inbound.id), null);

    const notSpam = mail.markMail('ivory', { id: inbound.id, spam: false });
    assert.strictEqual(notSpam.folder, 'inbox');
    assert.strictEqual(notSpam.route, 'inbound');
    assert.strictEqual(notSpam.external, true);
    assert.strictEqual(notSpam.labelSuspicious, true);
    assert.strictEqual(notSpam.spamScore, 8.1);
    assert.strictEqual(notSpam.spamReport, '* 8.1 BAYES_99');
    assert.strictEqual(mail.listMail('ivory', { folder: 'spam' }).length, 0);
    assert.strictEqual(mail.listMail('ivory', { folder: 'inbox' })[0].id, inbound.id);

    const toSpam = mail.markMail('ivory', { id: inbound.id, spam: true });
    assert.strictEqual(toSpam.folder, 'spam');
    assert.strictEqual(toSpam.route, 'inbound');
    assert.strictEqual(mail.markMail('rook', { id: inbound.id, spam: false }), null);
    assert.strictEqual(mail.listMail('ivory', { folder: 'spam' }).length, 1);

    const fwd = mail.forwardMail('ivory', { id: inbound.id, to: 'rook' });
    const fwdRow = mail.readMail('rook', fwd.id);
    assert.strictEqual(fwdRow.folder, 'inbox');
    assert.strictEqual(fwdRow.route, 'inbound');
    assert.strictEqual(fwdRow.external, true);
    assert.strictEqual(fwdRow.originalTo, 'lost@dream.737.jp.net');
    assert.strictEqual(mail.listMail('rook', { folder: 'spam' }).length, 0);

    const boxes = mail.listMailboxes();
    const ivoryBox = boxes.find((box) => box.owner === 'ivory');
    assert.ok(ivoryBox.spamUnread >= 0);

    assert.match(facadeSrc, /enum: \['inbox', 'spam', 'outbox', 'sent', 'deleted', 'archive'\]/);
    assert.match(facadeSrc, /spam: \{ type: 'boolean'/);
    assert.match(facadeSrc, /spam: typeof input\.spam === 'boolean' \? input\.spam : undefined/);
    const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/ws/handlers/250-dovecoteHandler.js'), 'utf8');
    assert.match(handlerSrc, /spamUnread: entry\.spamUnread \|\| 0/);
    assert.match(handlerSrc, /spam: typeof message\.spam === 'boolean' \? message\.spam : undefined/);
    const spamMod = require('../modules/mailGatewaySpam');
    assert.strictEqual(spamMod.DEFAULT_SPAM_CONFIG.authservId, 'mx.dream.737.jp.net');
    assert.strictEqual(spamMod.DEFAULT_SPAM_CONFIG.reportHeader, 'X-Spam-Report');
    assert.strictEqual(spamMod.parseSpamStatus('Yes, score=8.1 required=5.0 tests=BAYES_99').yes, true);
    assert.strictEqual(spamMod.parseSpamStatus('No, score=-1.2 required=5.0').no, true);
    assert.strictEqual(spamMod.parseSpamStatus('No, score=2.0 required=5.0 tests=LANTIS_FORGED_OURS').forgedOurs, true);
    assert.strictEqual(spamMod.parseDmarcComment('dmarc=fail (p=quarantine dis=NONE)').quarantine, true);
    assert.strictEqual(spamMod.parseDmarcComment('dmarc=fail (p=none dis=NONE)').quarantine, false);
    assert.strictEqual(
        spamMod.parseDmarcComment('spf=fail (dmarc=fail p=quarantine dis=QUARANTINE); dkim=pass').quarantine,
        false,
        'dmarc= inside another method comment must not count'
    );
    assert.strictEqual(
        spamMod.parseDmarcComment('spf=fail (dmarc=fail p=quarantine); dmarc=fail (p=quarantine dis=NONE)').quarantine,
        true
    );
    const addressSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/mailGatewayAddresses.js'), 'utf8');
    assert.doesNotMatch(addressSrc, /icloud\.com['"]\s*:/);
    assert.match(addressSrc, /yukimi@dream\.737\.jp\.net/);

    console.log('dovecote spam folder tests passed');
}

main();

// Real LANTIS-stamped samples (milter headers above the topmost Received).
(function lantisSamples() {
    const fsS = require('fs');
    const pathS = require('path');
    const spamS = require('../modules/mailGatewaySpam');
    const load = (name) => {
        const text = fsS.readFileSync(pathS.join(__dirname, 'fixtures', 'mail-samples', name), 'utf8').replace(/\r\n/g, '\n');
        const cut = text.indexOf('\n\n');
        return cut === -1 ? text : text.slice(0, cut);
    };
    const spamMark = spamS.isInboundSpam(load('spam.txt'), {});
    assert.strictEqual(spamMark.spam, true);
    assert.deepStrictEqual(spamMark.reasons, ['spam-flag', 'spam-status']);
    assert.strictEqual(spamMark.score, 6.7);
    assert.strictEqual(spamMark.required, 5);
    assert.ok(spamMark.tests.includes('TO_NO_BRKTS_PCNT'));
    assert.strictEqual(spamMark.dkim, 'none');
    assert.strictEqual(spamMark.dmarc, 'none');
    assert.strictEqual(spamMark.receivedSpf, 'pass');
    const clean = spamS.isInboundSpam(load('clean.txt'), {});
    assert.strictEqual(clean.spam, false);
    assert.strictEqual(clean.score, -0.7);
    assert.strictEqual(clean.tests.length, 4);
    assert.strictEqual(clean.dkim, 'none');
    // dmarc must still be read when its A-R is not the first one.
    const reordered = load('spam.txt').replace(/(Authentication-Results: [^\n]*dmarc[^\n]*\n)((?:Authentication-Results:[^\n]*\n)+)/, '$2$1')
        .replace('dmarc=none (p=none dis=none)', 'dmarc=fail (p=quarantine dis=QUARANTINE)')
        .replace(/X-Spam-Flag: YES\n/, '').replace('X-Spam-Status: Yes', 'X-Spam-Status: No');
    const q = spamS.isInboundSpam(reordered, {});
    assert.deepStrictEqual(q.reasons, ['dmarc-quarantine']);
    console.log('lantis sample tests passed');
})();
