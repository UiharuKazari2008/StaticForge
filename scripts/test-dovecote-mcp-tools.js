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

    const readResult = await callTool(gr, reqFor('Rook'), 'read_mail', { id: mailId });
    const readMail = textOf(readResult).mail;
    assert.strictEqual(readMail.body, 'hello');
    assert.deepStrictEqual(readMail.to, ['rook']);
    assert.deepStrictEqual(readMail.cc, []);

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

    // Oversized attachments are rejected with a clear error, not a partial send.
    const tooBig = await callTool(gr, reqFor('Menma'), 'send_mail', {
        to: 'rook', subject: 'too big', body: 'x',
        attachments: [{ base64: Buffer.alloc(11 * 1024 * 1024).toString('base64'), name: 'big.bin' }]
    });
    assert.strictEqual(tooBig.isError, true);
    assert.strictEqual(textOf(tooBig).code, 'ATTACHMENT_TOO_LARGE');

    console.log('dovecote MCP tool tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
