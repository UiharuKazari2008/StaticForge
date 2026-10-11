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

    const sendResult = await callTool(gr, reqFor('Menma'), 'send_mail', { to: 'rook', subject: 'hi', body: 'hello', format: 'text' });
    const sendData = textOf(sendResult);
    assert.strictEqual(sendResult.isError, false);
    assert.strictEqual(sendData.success, true);
    assert.strictEqual(sendData.to, 'rook');

    const listResult = await callTool(gr, reqFor('Rook'), 'list_mail', { folder: 'inbox' });
    const listData = textOf(listResult);
    assert.strictEqual(listData.mail.length, 1);
    const mailId = listData.mail[0].id;
    assert.strictEqual(listData.mail[0].from, 'menma');

    const readResult = await callTool(gr, reqFor('Rook'), 'read_mail', { id: mailId });
    assert.strictEqual(textOf(readResult).mail.body, 'hello');

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

    // Bots can never write into Yukimi's mailbox over MCP, by send or forward.
    const forbiddenSend = await callTool(gr, reqFor('Menma'), 'send_mail', { to: 'yukimi', subject: 'x', body: 'y' });
    assert.strictEqual(forbiddenSend.isError, true);
    assert.strictEqual(textOf(forbiddenSend).code, 'FORBIDDEN');

    const forbiddenFwd = await callTool(gr, reqFor('Rook'), 'forward_mail', { id: mailId, to: 'yukimi' });
    assert.strictEqual(forbiddenFwd.isError, true);
    assert.strictEqual(textOf(forbiddenFwd).code, 'FORBIDDEN');

    // An application key whose appName doesn't map to any bot/job mailbox is
    // rejected rather than silently falling back to some default mailbox.
    const unknownCaller = await callTool(gr, reqFor('SomeRandomClient'), 'list_mail', {});
    assert.strictEqual(unknownCaller.isError, true);

    // Xi job calls (shared "Xi" application key) resolve to a runtime-specific
    // job mailbox via xiDirector's own runtime picker, defaulting to 'cursor'
    // when no Xi session is actively running.
    const xiSend = await callTool(gr, reqFor('Xi'), 'send_mail', { to: 'pyra', subject: 'job note', body: 'done' });
    assert.strictEqual(textOf(xiSend).success, true);
    const cursorInbox = textOf(await callTool(gr, reqFor('Cursor'), 'list_mail', { folder: 'inbox' })).mail;
    assert.strictEqual(cursorInbox.length, 0, 'the Xi job sent as owner "cursor" — nothing landed in its own inbox');
    const pyraInbox = textOf(await callTool(gr, reqFor('Pyra'), 'list_mail', {})).mail;
    assert.strictEqual(pyraInbox.length, 1);
    assert.strictEqual(pyraInbox[0].from, 'cursor');

    console.log('dovecote MCP tool tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
