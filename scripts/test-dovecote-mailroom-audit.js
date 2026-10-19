'use strict';
// Every mailroom op is audit-logged, including facade-level denials for
// non-Tsubame keys and unknown target mailboxes. The key itself is never logged.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { initializeDovecoteDatabase, getDb } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'mailroom-audit-'))), true);
const { callTool } = require('../modules/mcpAgentFacade')._test;
const reqFor = (appName) => ({
    applicationAuth: { appName, applicationScopes: ['sfapp_dovecote'], applicationKeyId: `k-${appName}`, applicationKey: 'SECRET-KEY-VALUE' }
});
const rows = () => getDb().prepare('SELECT actor, action, success, detail FROM dovecote_audit_log ORDER BY rowid').all();

(async () => {
    const tools = ['mailroom_list_mail', 'mailroom_read_mail', 'mailroom_purge_mail', 'mailroom_move_mail', 'mailroom_forward_mail'];
    for (const name of tools) {
        const before = rows().length;
        await callTool({}, reqFor('Menma'), name, { mailbox: 'yukimi', id: 'x', spam: false, to: 'menma' });
        const added = rows().slice(before);
        assert.strictEqual(added.length, 1, `${name} denial must be audited`);
        assert.strictEqual(added[0].actor, 'menma');
        assert.strictEqual(added[0].success, 0);
    }
    const before = rows().length;
    await callTool({}, reqFor('Tsubame'), 'mailroom_list_mail', { mailbox: 'nobody' });
    const added = rows().slice(before);
    assert.strictEqual(added.length, 1);
    assert.match(added[0].detail, /unknown mailbox/);

    const aliasBefore = rows().length;
    const aliasDenied = await callTool({}, reqFor('Mailroom'), 'mailroom_list_mail', { mailbox: 'yukimi' });
    const aliasPayload = JSON.parse(aliasDenied.content[0].text);
    assert.strictEqual(aliasPayload.success, false);
    assert.strictEqual(aliasPayload.code, 'FORBIDDEN');
    const aliasAdded = rows().slice(aliasBefore);
    assert.strictEqual(aliasAdded.length, 1, 'Mailroom key denial must be audited');
    assert.strictEqual(aliasAdded[0].actor, 'key:Mailroom');
    assert.strictEqual(aliasAdded[0].success, 0);
    assert.match(aliasAdded[0].detail, /mailroom role required/);

    const dumped = JSON.stringify(rows());
    assert.ok(!dumped.includes('SECRET-KEY-VALUE'));
    assert.ok(!dumped.includes('applicationKey'));
    console.log('mailroom audit tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
