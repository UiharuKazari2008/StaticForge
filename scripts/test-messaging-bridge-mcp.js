#!/usr/bin/env node
/**
 * Messaging Bridge MCP module (sfapp_messaging_bridge, modules/messagingBridgeMcp.js) and mail rules
 * (modules/mailAccountsRules.js). Fake mail / text backends; the rules run on a real
 * mailAccountsStore in a temp dir. No IMAP, SMTP or BlueBubbles.
 *   node scripts/test-messaging-bridge-mcp.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-bridge-'));
const { resetForTests, getDb: exchangeDb } = require('../modules/mailExchangeDatabase');
assert.strictEqual(resetForTests(tmpDir), true);

const bridge = require('../modules/messagingBridgeMcp');
const rules = require('../modules/mailAccountsRules');
const store = require('../modules/mailAccountsStore');

const calls = [];
const fakeMail = {
    listAccounts: () => ({ accounts: [{ id: 'ykazari', email: 'y@icloud.com', hasPassword: true }], presets: [] }),
    listFolders: (id) => ({ folders: [{ path: 'INBOX' }, { path: 'Archive' }] }),
    listMessages: (id, folder, opts) => { calls.push(['listMessages', id, folder, opts]); return { messages: [], more: false, cursor: null }; },
    getMessage: async (id, folder, uid, opts) => { calls.push(['getMessage', id, folder, uid, opts]); return { message: { uid } }; },
    search: (q, opts) => ({ results: [{ q }] }),
    setFlags: async (id, folder, uids, flags) => { calls.push(['setFlags', id, folder, uids, flags]); return { ok: true }; },
    move: async (id, folder, uids, to) => { calls.push(['move', id, folder, uids, to]); return { ok: true }; },
    remove: async (id, folder, uids) => { calls.push(['remove', id, folder, uids]); return { ok: true }; },
    send: async (id, body) => { calls.push(['send', id, body]); return { ok: true, messageId: '<m@x>' }; },
    saveDraft: async (id, body) => ({ folder: 'Drafts', uid: 9 }),
    syncStatus: () => ({ accounts: [] }),
    resync: (id) => ({ ok: true })
};
const fakeText = {
    listAccounts: () => ({ accounts: [{ id: 'bb', kind: 'bluebubbles' }], settings: {} }),
    listChats: async (id, opts) => ({ chats: [{ guid: 'c1' }], more: false, opts }),
    getChat: async (id, guid) => ({ guid }),
    listMessages: async (id, guid, opts) => ({ messages: [{ guid: 'm1' }], more: false }),
    search: async (q) => ({ results: [] }),
    markRead: async (id, args) => { calls.push(['tmRead', id, args]); return {}; },
    markUnread: async (id, args) => ({ ok: true }),
    send: async (id, args) => { calls.push(['tmSend', id, args]); return { chatGuid: args.chatGuid || 'new', guid: 'm2' }; },
    deleteChat: async (id, args) => { calls.push(['tmDelete', id, args]); return { ok: true }; }
};
bridge._test.setBackends({ mailAccounts: fakeMail, textMessaging: fakeText });
rules._test.setMail(fakeMail);

function reqFor(appName, scopes) {
    return { applicationAuth: { appName, applicationScopes: scopes, applicationKeyId: `k-${appName}` } };
}
const TSU = reqFor('Tsubame', ['sfapp_dovecote', 'sfapp_mail_exchange', 'sfapp_messaging_bridge']);
const out = (r) => JSON.parse(r.content[0].text);
const call = async (req, name, args) => out(await bridge.handleBridgeTool(req, name, args || {}));

(async () => {
    // ---- gates ----
    let r = await call(TSU, 'bridge_mail_accounts');
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.accounts[0].id, 'ykazari');
    r = await call(reqFor('Tsubame', ['sfapp_dovecote', 'sfapp_mail_exchange']), 'bridge_mail_accounts');
    assert.strictEqual(r.code, 'INSUFFICIENT_SCOPE', 'the exchange scope alone is not the bridge');
    r = await call(reqFor('Tsubame', ['universal']), 'bridge_mail_accounts');
    assert.strictEqual(r.code, 'INSUFFICIENT_SCOPE', 'universal does not reach the bridge');
    r = await call(reqFor('Menma', ['sfapp_messaging_bridge']), 'bridge_mail_accounts');
    assert.strictEqual(r.code, 'FORBIDDEN', 'another bot is refused even with the scope');
    r = await call(reqFor('Sala', ['sfapp_messaging_bridge', 'sfapp_mail_exchange']), 'bridge_text_chats', { accountId: 'bb' });
    assert.strictEqual(r.code, 'FORBIDDEN', 'Sala (Exchange admin) is not a bridge owner');
    r = await call(reqFor('Mailroom', ['sfapp_messaging_bridge']), 'bridge_mail_accounts');
    assert.strictEqual(r.code, 'FORBIDDEN', 'a key named Mailroom maps to nobody');
    assert.ok(bridge.isBridgeOwner('mailroom') && bridge.isBridgeOwner('tsubame') && bridge.isBridgeOwner('yukimi'));
    assert.ok(!bridge.isBridgeOwner('sala') && !bridge.isBridgeOwner('menma') && !bridge.isBridgeOwner(null));

    // ---- mail tools ----
    r = await call(TSU, 'bridge_mail_message', { accountId: 'ykazari', uid: 5 });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(calls.pop(), ['getMessage', 'ykazari', 'INBOX', 5, { markSeen: false }], 'reading does not mark read by default');
    r = await call(TSU, 'bridge_mail_flags', { accountId: 'ykazari', uids: [1, 2], add: ['\\Seen'] });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(calls.pop(), ['setFlags', 'ykazari', 'INBOX', [1, 2], { add: ['\\Seen'], remove: [] }]);
    r = await call(TSU, 'bridge_mail_flags', { accountId: 'ykazari', uids: [1] });
    assert.strictEqual(r.code, 'NO_FLAGS');
    r = await call(TSU, 'bridge_mail_move', { accountId: 'ykazari', uids: [3], to: 'Archive' });
    assert.strictEqual(r.moved, 1);
    assert.deepStrictEqual(calls.pop(), ['move', 'ykazari', 'INBOX', [3], 'Archive']);
    r = await call(TSU, 'bridge_mail_delete', { accountId: 'ykazari', uids: [4] });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED');
    r = await call(TSU, 'bridge_mail_delete', { accountId: 'ykazari', uids: [4], confirm: true });
    assert.strictEqual(r.deleted, 1);
    assert.deepStrictEqual(calls.pop(), ['remove', 'ykazari', 'INBOX', [4]]);
    r = await call(TSU, 'bridge_mail_send', { accountId: 'ykazari', to: 'a@b.c', subject: 'hi', text: 'x' });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED');
    r = await call(TSU, 'bridge_mail_send', { accountId: 'ykazari', to: 'a@b.c', subject: 'hi', text: 'x', confirm: true });
    assert.strictEqual(r.sent, true);
    assert.strictEqual(calls.pop()[2].subject, 'hi');

    // ---- text tools ----
    r = await call(TSU, 'bridge_text_chats', { accountId: 'bb', folder: 'unknown' });
    assert.strictEqual(r.chats[0].guid, 'c1');
    r = await call(TSU, 'bridge_text_mark_read', { accountId: 'bb', chatGuid: 'c1' });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(calls.pop(), ['tmRead', 'bb', { chatGuid: 'c1' }]);
    r = await call(TSU, 'bridge_text_send', { accountId: 'bb', chatGuid: 'c1', text: 'hello' });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED');
    r = await call(TSU, 'bridge_text_send', { accountId: 'bb', text: 'hello', confirm: true });
    assert.strictEqual(r.code, 'NO_RECIPIENT');
    r = await call(TSU, 'bridge_text_send', { accountId: 'bb', chatGuid: 'c1', text: 'hello', confirm: true });
    assert.strictEqual(r.sent, true);
    assert.strictEqual(calls.pop()[2].text, 'hello');
    r = await call(TSU, 'bridge_text_delete_chat', { accountId: 'bb', chatGuid: 'c1', confirm: true });
    assert.strictEqual(r.success, true);

    // ---- audit ----
    const rows = exchangeDb().prepare("SELECT actor, action, target, success, detail FROM exchange_audit WHERE action LIKE 'bridge_%'").all();
    assert.ok(rows.some((x) => x.action === 'bridge_mail_delete' && x.actor === 'tsubame' && x.success === 1), 'delete audited');
    assert.ok(rows.some((x) => x.action === 'bridge_text_send' && x.success === 1), 'text send audited');
    assert.ok(rows.some((x) => x.action === 'bridge_mail_accounts' && x.success === 0 && /owner required/.test(x.detail || '')), 'refusal audited');
    assert.ok(!rows.some((x) => /hello/.test(`${x.target} ${x.detail}`)), 'no message bodies in the audit');

    // ---- rules on a real store ----
    store.open(tmpDir);
    store.putFolder('ykazari', { path: 'INBOX', name: 'INBOX', special: '\\Inbox', uidvalidity: 7 });
    const msg = (uid, sender, subject, extra) => Object.assign({ uid, date: 1000 + uid, sender, recipients: 'y@icloud.com', subject, flags: [], env: { from: [{ name: sender, address: sender }], to: [{ address: 'y@icloud.com' }] } }, extra || {});
    store.putMessages('ykazari', 'INBOX', [msg(1, 'news@shop.example', 'Big Sale'), msg(2, 'friend@x.example', 'Lunch?')]);

    r = await call(TSU, 'bridge_mail_save_rule', { match: {}, actions: { markRead: true } });
    assert.strictEqual(r.code, 'NO_MATCH');
    r = await call(TSU, 'bridge_mail_save_rule', { match: { from: 'x' }, actions: { moveTo: 'A', delete: true } });
    assert.strictEqual(r.code, 'BAD_ACTIONS');
    r = await call(TSU, 'bridge_mail_save_rule', { name: 'Shops', match: { from: 'SHOP.example' }, actions: { markRead: true, moveTo: 'Archive' } });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    const ruleId = r.rule.id;
    assert.strictEqual(r.rule.accountId, '*');
    assert.strictEqual(store.getState('ykazari', 'rulesUid'), '2', 'a new rule starts the watermark at the newest mail');

    // a rule does not touch mail that was already there ...
    calls.length = 0;
    let a = await rules.applyNew('ykazari');
    assert.deepStrictEqual(a.applied, []);
    assert.strictEqual(calls.length, 0);
    // ... a dry run reports it, applying needs confirm
    r = await call(TSU, 'bridge_mail_run_rules', { accountId: 'ykazari' });
    assert.strictEqual(r.dryRun, true);
    assert.strictEqual(r.matched, 1);
    assert.strictEqual(r.groups[0].messages[0].uid, 1);
    assert.strictEqual(calls.length, 0, 'dry run changes nothing');
    r = await call(TSU, 'bridge_mail_run_rules', { accountId: 'ykazari', dryRun: false });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED');
    r = await call(TSU, 'bridge_mail_run_rules', { accountId: 'ykazari', dryRun: false, confirm: true });
    assert.strictEqual(r.matched, 1);
    assert.deepStrictEqual(calls, [['setFlags', 'ykazari', 'INBOX', [1], { add: ['\\Seen'] }], ['move', 'ykazari', 'INBOX', [1], 'Archive']]);

    // new mail: the matching one is handled, the other left alone; first rule wins
    await call(TSU, 'bridge_mail_save_rule', { name: 'Delete sales', position: 5, match: { subject: 'sale' }, actions: { delete: true } });
    store.putMessages('ykazari', 'INBOX', [msg(3, 'deals@shop.example', 'Another sale'), msg(4, 'boss@work.example', 'Flash sale at work')]);
    calls.length = 0;
    a = await rules.applyNew('ykazari');
    assert.deepStrictEqual(calls, [
        ['setFlags', 'ykazari', 'INBOX', [3], { add: ['\\Seen'] }], ['move', 'ykazari', 'INBOX', [3], 'Archive'],
        ['remove', 'ykazari', 'INBOX', [4]]
    ]);
    assert.strictEqual(store.getState('ykazari', 'rulesUid'), '4');
    calls.length = 0;
    await rules.applyNew('ykazari');
    assert.strictEqual(calls.length, 0, 'each message once');

    // a rebuilt Inbox (new UIDVALIDITY) restarts the watermark instead of re-running old mail
    store.putFolder('ykazari', { path: 'INBOX', name: 'INBOX', special: '\\Inbox', uidvalidity: 8 });
    store.setState('ykazari', 'rulesUidValidity', '7');
    a = await rules.applyNew('ykazari');
    assert.deepStrictEqual(a.applied, []);
    assert.strictEqual(store.getState('ykazari', 'rulesUidValidity'), '8');

    r = await call(TSU, 'bridge_mail_list_rules', { accountId: 'ykazari' });
    assert.strictEqual(r.rules.length, 2);
    assert.strictEqual(r.rules.find((x) => x.id === ruleId).hits, 2);
    r = await call(TSU, 'bridge_mail_save_rule', { id: ruleId, enabled: false });
    assert.strictEqual(r.rule.enabled, false);
    assert.deepStrictEqual(r.rule.match, { from: 'SHOP.example' }, 'an update keeps what it does not change');
    r = await call(TSU, 'bridge_mail_delete_rule', { id: ruleId });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED');
    r = await call(TSU, 'bridge_mail_delete_rule', { id: ruleId, confirm: true });
    assert.strictEqual(r.success, true);
    r = await call(TSU, 'bridge_mail_delete_rule', { id: ruleId, confirm: true });
    assert.strictEqual(r.code, 'NOT_FOUND');
    store._close();

    // ---- wiring: registry, scopes catalogue, key migration, facade listing ----
    const registry = require('../modules/mcpModuleRegistry');
    const mod = registry.getModuleByScope('sfapp_messaging_bridge');
    assert.ok(mod && mod.tools.includes('bridge_mail_save_rule') && mod.tools.includes('bridge_text_send'));
    assert.strictEqual(mod.tools.length, bridge.TOOLS.length);
    const { AVAILABLE_SCOPES } = require('../modules/applicationAuthManager');
    assert.ok(AVAILABLE_SCOPES.some((s) => s.id === 'sfapp_messaging_bridge'));
    const scopes = require('../modules/directorAppKeyScopes');
    assert.strictEqual(scopes.MESSAGING_BRIDGE_SCOPE, 'sfapp_messaging_bridge');
    assert.deepStrictEqual(scopes.MESSAGING_BRIDGE_KEY_TARGETS.map((t) => t.label), ['Tsubame'], 'only the Tsubame key is widened');
    for (const list of [scopes.DIRECTOR_MCP_SCOPES]) assert.ok(!list.includes('sfapp_messaging_bridge'));

    const facade = require('../modules/mcpAgentFacade')._test;
    const names = (sc, owner) => facade.listToolsForScopes(sc, null, { owner }).map((t) => t.name);
    const tsuList = names(['sfapp_dovecote', 'sfapp_mail_exchange', 'sfapp_messaging_bridge'], 'tsubame');
    for (const t of bridge.TOOLS) assert.ok(tsuList.includes(t.name), `Tsubame lists ${t.name}`);
    assert.ok(tsuList.includes('exchange_spam'), 'Exchange tools stay');
    assert.ok(!names(['sfapp_dovecote', 'sfapp_mail_exchange'], 'tsubame').includes('bridge_mail_accounts'), 'no scope, no tools');
    assert.ok(!names(['universal'], 'yukimi').includes('bridge_mail_accounts'), 'universal does not list them');
    assert.ok(!names(['sfapp_messaging_bridge'], 'menma').includes('bridge_mail_accounts'), 'other owners do not list them');
    if (typeof facade.callTool === 'function') {
        await assert.rejects(facade.callTool(null, reqFor('Yukimi', ['universal']), 'bridge_mail_accounts', {}), (e) => e.code === 'INSUFFICIENT_SCOPE');
        const via = out(await facade.callTool(null, TSU, 'bridge_text_accounts', {}));
        assert.strictEqual(via.success, true);
        assert.strictEqual(via.accounts[0].id, 'bb');
    }

    console.log(`test-messaging-bridge-mcp: ok (${bridge.TOOLS.length} tools)`);
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
