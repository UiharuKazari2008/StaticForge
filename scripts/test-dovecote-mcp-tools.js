'use strict';

// End-to-end through the real MCP dispatcher (modules/mcpAgentFacade.js
// callTool): scope enforcement, identity resolution (resolveActorName ->
// Dovecote owner), and the privacy matrix all have to agree, not just the
// pure modules/dovecoteMail.js functions underneath.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-mcp-tools-'));
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const { callTool } = require('../modules/mcpAgentFacade')._test;

const gr = {};
const reqFor = (appName, scopes) => ({
    applicationAuth: { appName, applicationScopes: scopes || ['sfapp_dovecote'], applicationKeyId: `k-${appName}` }
});

function textOf(result) {
    return JSON.parse(result.content[0].text);
}

async function main() {
    // A key without sfapp_dovecote scope is rejected before any Dovecote code runs.
    await assert.rejects(
        () => callTool(gr, reqFor('Menma', ['search']), 'list_mail', {}),
        (err) => err.status === 403 && err.code === 'INSUFFICIENT_SCOPE'
    );

    const emptyList = textOf(await callTool(gr, reqFor('Ivory'), 'list_mail', {}));
    assert.strictEqual(emptyList.success, true);
    assert.strictEqual(emptyList.owner, 'ivory');
    assert.deepStrictEqual(emptyList.mail, []);

    const sendResult = await callTool(gr, reqFor('Menma'), 'send_mail', { to: 'rook', subject: 'hi', body: 'hello', format: 'text' });
    const sendData = textOf(sendResult);
    assert.strictEqual(sendResult.isError, false);
    assert.strictEqual(sendData.success, true);
    assert.deepStrictEqual(sendData.to, ['rook']);
    assert.deepStrictEqual(sendData.cc, []);

    const listResult = await callTool(gr, reqFor('Rook'), 'list_mail', { folder: 'inbox' });
    const listData = textOf(listResult);
    assert.strictEqual(listData.owner, 'rook');
    assert.strictEqual(listData.mail.length, 1);
    const mailId = listData.mail[0].id;
    assert.strictEqual(listData.mail[0].from, 'menma');
    assert.strictEqual(listData.mail[0].route, 'internal');
    assert.strictEqual(listData.mail[0].external, false);

    const readResult = await callTool(gr, reqFor('Rook'), 'read_mail', { id: mailId });
    const readMail = textOf(readResult).mail;
    assert.strictEqual(readMail.body, 'hello');
    assert.deepStrictEqual(readMail.to, ['rook']);
    assert.deepStrictEqual(readMail.cc, []);
    assert.strictEqual(readMail.route, 'internal');
    assert.strictEqual(readMail.external, false);

    // Caller identity is resolved server-side from the application key, never
    // from a client-supplied "owner" field — there is no such input on any tool.
    await assert.rejects(
        () => callTool(gr, reqFor('Hoshino'), 'read_mail', { id: mailId }),
        (err) => err.status === 404
    );

    const markResult = await callTool(gr, reqFor('Rook'), 'mark_mail', { id: mailId, archived: true });
    assert.strictEqual(textOf(markResult).mail.folder, 'archive');

    const fwdResult = await callTool(gr, reqFor('Rook'), 'forward_mail', { id: mailId, to: 'ivory' });
    assert.strictEqual(textOf(fwdResult).success, true);
    const ivoryInbox = textOf(await callTool(gr, reqFor('Ivory'), 'list_mail', {})).mail;
    assert.strictEqual(ivoryInbox.length, 1);
    assert.strictEqual(ivoryInbox[0].subject, 'Fwd: hi');

    // Bots may send to Yukimi over MCP (Yukimi 2026-10-10), including on cc.
    // The tool text must say so. It used to claim bots cannot write to her.
    const sendDef = fs.readFileSync(path.join(__dirname, '..', 'modules/mcpAgentFacade.js'), 'utf8');
    const sendAt = sendDef.indexOf("name: 'send_mail'");
    const sendChunk = sendDef.slice(sendAt, sendAt + 1800);
    assert.ok(!sendChunk.includes('cannot send into Yukimi'), 'send_mail must not forbid Yukimi');
    assert.ok(sendChunk.includes('Yukimi'), 'send_mail must name Yukimi as a recipient');

    const multi = textOf(await callTool(gr, reqFor('Menma'), 'send_mail', {
        to: ['rook', 'hoshino'],
        cc: 'yukimi',
        subject: 'multi',
        body: 'all of you'
    }));
    assert.strictEqual(multi.success, true);
    assert.deepStrictEqual(multi.to, ['rook', 'hoshino']);
    assert.deepStrictEqual(multi.cc, ['yukimi']);
    const yukimiMulti = textOf(await callTool(gr, reqFor('Menma'), 'list_mail', { folder: 'sent' })).mail
        .find((m) => m.subject === 'multi');
    assert.ok(yukimiMulti);
    const rookMulti = textOf(await callTool(gr, reqFor('Rook'), 'list_mail', { folder: 'inbox' })).mail
        .find((m) => m.subject === 'multi');
    const hoshinoMulti = textOf(await callTool(gr, reqFor('Hoshino'), 'list_mail', { folder: 'inbox' })).mail
        .find((m) => m.subject === 'multi');
    assert.strictEqual(rookMulti.threadId, hoshinoMulti.threadId);
    assert.strictEqual(rookMulti.threadId, yukimiMulti.threadId);
    assert.deepStrictEqual(rookMulti.cc, ['yukimi']);

    // Bots may send to Yukimi over MCP (Yukimi 2026-10-10); forwarding to her is allowed too.
    const okSend = await callTool(gr, reqFor('Menma'), 'send_mail', { to: 'yukimi', subject: 'x', body: 'y' });
    assert.notStrictEqual(okSend.isError, true);

    const forbiddenFwd = await callTool(gr, reqFor('Rook'), 'forward_mail', { id: mailId, to: 'yukimi' });
    assert.notStrictEqual(forbiddenFwd.isError && textOf(forbiddenFwd).code === 'FORBIDDEN', true);

    // An application key whose appName doesn't map to any bot/job mailbox is
    // rejected rather than silently falling back to some default mailbox.
    const unknownCaller = await callTool(gr, reqFor('SomeRandomClient'), 'list_mail', {});
    assert.strictEqual(unknownCaller.isError, true);

    // Xi job calls (shared "Xi" application key) resolve to a runtime-specific
    // job mailbox via xiDirector's own runtime picker, defaulting to 'cursor'
    // when no Xi session is actively running.
    const xiSend = await callTool(gr, reqFor('Xi'), 'send_mail', { to: 'pyra', subject: 'job note', body: 'done' });
    assert.strictEqual(textOf(xiSend).success, true);
    const cursorList = textOf(await callTool(gr, reqFor('Cursor'), 'list_mail', { folder: 'inbox' }));
    assert.strictEqual(cursorList.owner, 'cursor');
    const cursorInbox = cursorList.mail;
    assert.strictEqual(cursorInbox.length, 0, 'the Xi job sent as owner "cursor" — nothing landed in its own inbox');
    const pyraInbox = textOf(await callTool(gr, reqFor('Pyra'), 'list_mail', {})).mail;
    assert.strictEqual(pyraInbox.length, 1);
    assert.strictEqual(pyraInbox[0].from, 'cursor');

    // read_by_recipient starts false on the sender's sent copy and flips once the
    // recipient reads it — exposed under that exact snake_case name over MCP.
    const receiptSend = textOf(await callTool(gr, reqFor('Menma'), 'send_mail', { to: 'rook', subject: 'receipt?', body: 'ping' }));
    const sentList = textOf(await callTool(gr, reqFor('Menma'), 'list_mail', { folder: 'sent' })).mail;
    const sentRow = sentList.find((m) => m.id === receiptSend.id);
    assert.strictEqual(sentRow.read_by_recipient, false);
    const rookInboxForReceipt = textOf(await callTool(gr, reqFor('Rook'), 'list_mail', { folder: 'inbox' })).mail;
    const toReadId = rookInboxForReceipt.find((m) => m.subject === 'receipt?').id;
    await callTool(gr, reqFor('Rook'), 'read_mail', { id: toReadId });
    const sentListAfter = textOf(await callTool(gr, reqFor('Menma'), 'list_mail', { folder: 'sent' })).mail;
    assert.strictEqual(sentListAfter.find((m) => m.id === receiptSend.id).read_by_recipient, true);

    // Attachments by base64 are stored and come back as metadata on list_mail/read_mail
    // (no raw bytes inline), scoped to the recipient's own mailbox.
    const attSend = await callTool(gr, reqFor('Menma'), 'send_mail', {
        to: 'rook', subject: 'with file', body: 'see attached',
        attachments: [{ base64: Buffer.from('hello from mcp').toString('base64'), name: 'hi.txt', mimeType: 'text/plain' }]
    });
    assert.strictEqual(attSend.isError, false);
    const rookInboxWithAtt = textOf(await callTool(gr, reqFor('Rook'), 'list_mail', { folder: 'inbox' })).mail;
    const attMail = rookInboxWithAtt.find((m) => m.subject === 'with file');
    assert.strictEqual(attMail.attachments.length, 1);
    assert.strictEqual(attMail.attachments[0].name, 'hi.txt');
    assert.strictEqual(attMail.attachments[0].data, undefined, 'list_mail must not inline attachment bytes');
    const attRead = textOf(await callTool(gr, reqFor('Rook'), 'read_mail', { id: attMail.id }));
    assert.strictEqual(attRead.mail.attachments[0].mimeType, 'text/plain');

    // Gateway inbound (including a spoofed display label) always comes back as
    // route=inbound plus an explicit external marker. Agents must not treat it
    // as mailbox-to-mailbox mail just because fromLabel said "menma".
    const dovecoteMail = require('../modules/dovecoteMail');
    const inbound = dovecoteMail.deliverInboundMail({
        fromAddress: 'evil@ext.com',
        fromLabel: 'menma',
        toOwner: 'ivory',
        subject: 'gw-inbound',
        body: 'from outside',
        route: 'internal'
    });
    const ivoryGwList = textOf(await callTool(gr, reqFor('Ivory'), 'list_mail', { folder: 'inbox' })).mail;
    const gwRow = ivoryGwList.find((m) => m.subject === 'gw-inbound');
    assert.ok(gwRow, 'inbound copy is listed');
    assert.strictEqual(gwRow.id, inbound.id);
    assert.strictEqual(gwRow.route, 'inbound');
    assert.strictEqual(gwRow.external, true);
    assert.strictEqual(gwRow.from, 'evil@ext.com');
    assert.strictEqual(gwRow.fromLabel, 'evil@ext.com');
    assert.strictEqual(gwRow.labelSuspicious, true);
    const gwRead = textOf(await callTool(gr, reqFor('Ivory'), 'read_mail', { id: gwRow.id })).mail;
    assert.strictEqual(gwRead.route, 'inbound');
    assert.strictEqual(gwRead.external, true);
    assert.strictEqual(gwRead.fromLabel, 'evil@ext.com');
    assert.strictEqual(gwRead.labelSuspicious, true);

    const spamIn = dovecoteMail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        fromLabel: 'list',
        toOwner: 'ivory',
        subject: 'gw-spam-folder',
        body: 'viagra',
        spam: true
    });
    const ivorySpam = textOf(await callTool(gr, reqFor('Ivory'), 'list_mail', { folder: 'spam' })).mail;
    assert.ok(ivorySpam.some((m) => m.id === spamIn.id));
    assert.ok(ivorySpam.every((m) => m.folder === 'spam'));
    const rookSpam = textOf(await callTool(gr, reqFor('Rook'), 'list_mail', { folder: 'spam' })).mail;
    assert.ok(!rookSpam.some((m) => m.id === spamIn.id));
    await assert.rejects(
        () => callTool(gr, reqFor('Rook'), 'read_mail', { id: spamIn.id }),
        (err) => err.status === 404
    );
    const moved = textOf(await callTool(gr, reqFor('Ivory'), 'mark_mail', { id: spamIn.id, spam: false }));
    assert.strictEqual(moved.mail.folder, 'inbox');
    assert.strictEqual(moved.mail.route, 'inbound');
    assert.strictEqual(moved.mail.external, true);
    const back = textOf(await callTool(gr, reqFor('Ivory'), 'mark_mail', { id: spamIn.id, spam: true }));
    assert.strictEqual(back.mail.folder, 'spam');
    await assert.rejects(
        () => callTool(gr, reqFor('Rook'), 'mark_mail', { id: spamIn.id, spam: false }),
        (err) => err.status === 404
    );

    const catchAll = dovecoteMail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        fromLabel: 'Alice <alice@example.com>',
        toOwner: 'tsubame',
        subject: 'lost-addr',
        body: 'please file',
        originalTo: 'lost.dept@dream.737.jp.net'
    });
    const tsubameRead = textOf(await callTool(gr, reqFor('Tsubame'), 'read_mail', { id: catchAll.id })).mail;
    assert.strictEqual(tsubameRead.originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(tsubameRead.route, 'inbound');
    const aliasRead = textOf(await callTool(gr, reqFor('Mailroom'), 'read_mail', { id: catchAll.id }));
    assert.strictEqual(aliasRead.success, false);
    assert.match(aliasRead.error, /does not map to a Dovecote mailbox/);
    const aliasDenied = textOf(await callTool(gr, reqFor('Mailroom'), 'mailroom_list_mail', { mailbox: 'yukimi' }));
    assert.strictEqual(aliasDenied.success, false);
    assert.strictEqual(aliasDenied.code, 'FORBIDDEN');

    const deniedFwd = textOf(await callTool(gr, reqFor('Rook'), 'mailroom_forward_mail', { id: catchAll.id, to: 'ivory' }));
    assert.strictEqual(deniedFwd.success, false);
    assert.strictEqual(deniedFwd.code, 'FORBIDDEN');
    const deniedMove = textOf(await callTool(gr, reqFor('Ivory'), 'mailroom_move_mail', {
        mailbox: 'ivory', id: spamIn.id, spam: false
    }));
    assert.strictEqual(deniedMove.success, false);
    assert.strictEqual(deniedMove.code, 'FORBIDDEN');
    const deniedList = textOf(await callTool(gr, reqFor('Rook'), 'mailroom_list_mail', { mailbox: 'yukimi' }));
    assert.strictEqual(deniedList.code, 'FORBIDDEN');
    assert.strictEqual(textOf(await callTool(gr, reqFor('Ivory'), 'list_mail', { folder: 'spam' })).mail.some((m) => m.id === spamIn.id), true);

    const roomFwd = textOf(await callTool(gr, reqFor('Tsubame'), 'mailroom_forward_mail', { id: catchAll.id, to: 'guren' }));
    assert.strictEqual(roomFwd.success, true);
    const gurenCopy = textOf(await callTool(gr, reqFor('Guren'), 'read_mail', { id: roomFwd.id })).mail;
    assert.strictEqual(gurenCopy.route, 'inbound');
    assert.strictEqual(gurenCopy.originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(gurenCopy.external, true);

    const roomMove = textOf(await callTool(gr, reqFor('Tsubame'), 'mailroom_move_mail', {
        mailbox: 'ivory', id: spamIn.id, spam: false
    }));
    assert.strictEqual(roomMove.success, true);
    assert.strictEqual(roomMove.folder, 'inbox');
    assert.strictEqual(roomMove.body, undefined);
    assert.strictEqual(textOf(await callTool(gr, reqFor('Ivory'), 'list_mail', { folder: 'inbox' })).mail.some((m) => m.id === spamIn.id), true);

    const yukimiIn = dovecoteMail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        toOwner: 'yukimi',
        subject: 'for-yukimi',
        body: 'private'
    });
    const yukimiSpam = dovecoteMail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        toOwner: 'yukimi',
        subject: 'yukimi-spam',
        body: 'phish',
        spam: true
    });
    const yukimiToSpam = textOf(await callTool(gr, reqFor('Tsubame'), 'mailroom_move_mail', {
        mailbox: 'yukimi', id: yukimiIn.id, spam: true
    }));
    assert.strictEqual(yukimiToSpam.success, false);
    assert.strictEqual(yukimiToSpam.code, 'FORBIDDEN');
    const inboxRead = textOf(await callTool(gr, reqFor('Tsubame'), 'mailroom_read_mail', {
        mailbox: 'yukimi', id: yukimiIn.id
    }));
    assert.strictEqual(inboxRead.success, false);
    assert.strictEqual(inboxRead.code, 'FORBIDDEN');
    const spamRead = textOf(await callTool(gr, reqFor('Tsubame'), 'mailroom_read_mail', {
        mailbox: 'yukimi', id: yukimiSpam.id
    }));
    assert.strictEqual(spamRead.success, true);
    assert.strictEqual(spamRead.mail.body, 'phish');
    const rescued = textOf(await callTool(gr, reqFor('Tsubame'), 'mailroom_move_mail', {
        mailbox: 'yukimi', id: yukimiSpam.id, spam: false
    }));
    assert.strictEqual(rescued.success, true);
    assert.strictEqual(rescued.folder, 'inbox');
    assert.strictEqual(dovecoteMail.readMail('yukimi', yukimiIn.id).folder, 'inbox');
    assert.strictEqual(dovecoteMail.readMail('yukimi', yukimiSpam.id).folder, 'inbox');

    const webhook = require('../modules/dovecoteMailboxWebhook');
    webhook.setTestOverrides({
        lookup: async (hostname) => {
            if (hostname === 'hook.example') return [{ address: '203.0.113.10', family: 4 }];
            throw new Error('unexpected host ' + hostname);
        },
        fetch: async () => ({ ok: true, status: 204 }),
        // Avoid loading globalResources (its intervals keep the test alive).
        config: {}
    });
    const hookSet = textOf(await callTool(gr, reqFor('Rook'), 'set_mailbox_webhook', {
        url: 'https://hook.example/mail',
        mailbox: 'ivory'
    }));
    assert.strictEqual(hookSet.mailbox, 'rook');
    assert.strictEqual(hookSet.url, 'https://hook.example/mail');
    const ivoryHook = textOf(await callTool(gr, reqFor('Ivory'), 'get_mailbox_webhook', {}));
    assert.strictEqual(ivoryHook.mailbox, 'ivory');
    assert.strictEqual(ivoryHook.url, null);
    textOf(await callTool(gr, reqFor('Rook'), 'clear_mailbox_webhook', {}));
    webhook.resetForTests();

    const notifyMod = require('../modules/dovecoteMailboxNotify');
    notifyMod.setTestOverrides({
        coalesceMs: 0,
        globalPerMinute: 50,
        submitOutbound: async () => ({ to: ['alerts@example.com'] })
    });
    const notifySet = textOf(await callTool(gr, reqFor('Rook'), 'set_mailbox_notify_forward', {
        address: 'alerts@example.com',
        mailbox: 'ivory'
    }));
    assert.strictEqual(notifySet.mailbox, 'rook');
    assert.strictEqual(notifySet.address, 'alerts@example.com');
    const ivoryNotify = textOf(await callTool(gr, reqFor('Ivory'), 'get_mailbox_notify_forward', {}));
    assert.strictEqual(ivoryNotify.mailbox, 'ivory');
    assert.strictEqual(ivoryNotify.address, null);
    textOf(await callTool(gr, reqFor('Rook'), 'clear_mailbox_notify_forward', {}));
    notifyMod.resetForTests();

    // Oversized attachments are rejected with a clear error, not a partial send.
    const tooBig = await callTool(gr, reqFor('Menma'), 'send_mail', {
        to: 'rook', subject: 'too big', body: 'x',
        attachments: [{ base64: Buffer.alloc(11 * 1024 * 1024).toString('base64'), name: 'big.bin' }]
    });
    assert.strictEqual(tooBig.isError, true);
    assert.strictEqual(textOf(tooBig).code, 'ATTACHMENT_TOO_LARGE');

    // list_mail pages with a cursor; folder unread/total are not the page size.
    for (let i = 0; i < 12; i++) {
        await callTool(gr, reqFor('Menma'), 'send_mail', {
            to: 'frost', subject: 'page-' + i, body: 'n'
        });
    }
    const page1 = textOf(await callTool(gr, reqFor('Frost'), 'list_mail', { folder: 'inbox', limit: 5 }));
    assert.strictEqual(page1.mail.length, 5);
    assert.strictEqual(page1.hasMore, true);
    assert.ok(page1.nextCursor);
    assert.ok(page1.total >= 12);
    assert.ok(page1.unread >= 12);
    const page2 = textOf(await callTool(gr, reqFor('Frost'), 'list_mail', {
        folder: 'inbox', limit: 5, cursor: page1.nextCursor
    }));
    assert.strictEqual(page2.mail.length, 5);
    const page1Ids = new Set(page1.mail.map((row) => row.id));
    page2.mail.forEach((row) => assert.ok(!page1Ids.has(row.id)));

    const batchIds = page1.mail.map((row) => row.id);
    const batchMark = textOf(await callTool(gr, reqFor('Frost'), 'mark_mail', { ids: batchIds, read: true }));
    assert.strictEqual(batchMark.updated, 5);
    assert.strictEqual(batchMark.mail.length, 5);
    const otherOwns = textOf(await callTool(gr, reqFor('Rook'), 'mark_mail', { ids: batchIds, read: false }));
    assert.strictEqual(otherOwns.success, false);

    const batchFwd = textOf(await callTool(gr, reqFor('Frost'), 'forward_mail', {
        ids: batchIds.slice(0, 2), to: 'sala'
    }));
    assert.strictEqual(batchFwd.updated, 2);
    assert.strictEqual(batchFwd.forwarded.length, 2);

    const del = textOf(await callTool(gr, reqFor('Frost'), 'delete_mail', { ids: batchIds.slice(0, 2) }));
    assert.strictEqual(del.updated, 2);
    const frostInbox = textOf(await callTool(gr, reqFor('Frost'), 'list_mail', { folder: 'inbox', limit: 1 }));
    assert.ok(frostInbox.total < page1.total);
    // Purging from Trash in a batch needs confirm:true; nothing changes without it.
    const trashIds = batchIds.slice(0, 2);
    const guarded = await callTool(gr, reqFor('Frost'), 'delete_mail', { ids: trashIds });
    const guardedBody = textOf(guarded);
    assert.strictEqual(guardedBody.code, 'CONFIRM_REQUIRED');
    assert.strictEqual(guardedBody.inTrash, 2);
    assert.strictEqual(dovecoteMail.readMail('frost', trashIds[0], { markRead: false }).folder, 'deleted');
    const purged = textOf(await callTool(gr, reqFor('Frost'), 'delete_mail', { ids: trashIds, confirm: true }));
    assert.strictEqual(purged.updated, 2);
    assert.strictEqual(dovecoteMail.readMail('frost', trashIds[0], { markRead: false }), null);

    console.log('dovecote MCP tool tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
