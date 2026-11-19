#!/usr/bin/env node
/**
 * Ingest Controller console (Server Manager > Roles > Ingest Controller): the admin WS packets
 * (modules/ws/handlers/314-ingestControllerHandler.js), its statusHub feed, the shared bridge dispatch
 * (messagingBridgeMcp.runBridgeTool), log paging, the routing-expire round trip, and the console script
 * (public/scripts/comp/mmcIngest.js) in a VM: its tree and its ask-then-confirm write flow.
 * Temp dirs and in-memory stores only; no real .cache database is opened.
 *   node scripts/test-ingest-mmc.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-mmc-'));
const { resetForTests: resetExchange, getDb: exchangeDb } = require('../modules/mailExchangeDatabase');
assert.strictEqual(resetExchange(tmpDir), true);
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);

const dovecote = require('../modules/dovecoteMail');
const ctl = require('../modules/ingestController');
const ingestStore = require('../modules/ingestStore');
const bridge = require('../modules/messagingBridgeMcp');
const rules = require('../modules/mailAccountsRules');
const mailStore = require('../modules/mailAccountsStore');
const statusHub = require('../modules/ws/statusHub');
const registry = require('../modules/ws/wsPacketRegistry');
const handler = require('../modules/ws/handlers/314-ingestControllerHandler');

// ---- fakes: IMAP accounts, texts, spamd; the mail rules run on a real mailAccountsStore in the temp dir
const DAY = 86400000;
const fakeMail = {
    listAccounts: () => ({ accounts: [{ id: 'ykazari', email: 'y@icloud.com', hasPassword: true }], presets: [] }),
    listFolders: () => ({ folders: [{ path: 'INBOX', special: '\\Inbox' }, { path: 'Junk', special: '\\Junk' }, { path: 'Trash', special: '\\Trash', name: 'Trash' }] }),
    setFlags: async () => ({ ok: true }),
    move: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    fetchRaw: async () => null
};
const fakeMailStore = {
    getFolder: () => ({ uidvalidity: '7' }),
    maxUid: () => 2,
    getState: () => null,
    setState: () => {},
    messagesAfterUid: () => [],
    countRuleHits: () => {},
    getMessage: () => null,
    listForExpiry: () => [
        { uid: 1, msgid: '<1@x>', sender: 'bank@bank.example', subject: 'Your payment failed', date: Date.now() - 50 * DAY, seen: 0, flagged: 0, env: '{}' },
        { uid: 2, msgid: '<2@x>', sender: 'friend@x.example', subject: 'Lunch?', date: Date.now() - DAY, seen: 0, flagged: 0, env: '{}' }
    ]
};
const fakeText = { listAccounts: () => ({ accounts: [{ id: 'bb', kind: 'bluebubbles', label: 'iMessage' }] }) };
const fakeSpamd = { ping: async (host, port) => ({ ok: true, ms: 3, host, port }), score: async () => ({ ok: false, error: 'not used' }), buildMessage: () => '' };

ctl._test.open(':memory:');
ctl._test.setBackends({ mailAccounts: fakeMail, mailStore: fakeMailStore, textMessaging: fakeText, spamd: fakeSpamd, mailRules: rules, dovecote, notifier: { publish: (n) => n } });
bridge._test.setBackends({ mailAccounts: fakeMail, textMessaging: fakeText });
rules._test.setMail(fakeMail);
mailStore.open(tmpDir);
mailStore.putFolder('ykazari', { path: 'INBOX', name: 'INBOX', special: '\\Inbox', uidvalidity: 7 });
mailStore.putMessages('ykazari', 'INBOX', [
    { uid: 1, date: 1001, sender: 'news@shop.example', recipients: 'y@icloud.com', subject: 'Big Sale', flags: [], env: { from: [{ address: 'news@shop.example' }], to: [] } }
]);

// ---- the server side: packets through the real registry, replies collected
const sent = [];
const pushes = [];
const handlersCtx = { sendToClient: (ws, packet) => { sent.push(packet); }, sendError: (ws, message, code, requestId) => { sent.push({ type: 'error', message, details: code, requestId }); } };
statusHub.setSender((ws, packet) => pushes.push(packet));
handler.registerPackets(handlersCtx);
const ADMIN = { authenticated: true, userType: 'admin' };
let rid = 0;
async function packet(type, body, info) {
    const entry = registry.getWsPacketEntry(type);
    assert.ok(entry, `${type} is registered`);
    const requestId = `r${++rid}`;
    await registry.getWsPacketHandler(type)({ ws: {}, message: Object.assign({ type, requestId }, body || {}), clientInfo: info || ADMIN });
    const reply = sent.find((p) => p.requestId === requestId);
    assert.ok(reply, `${type} answered`);
    return reply;
}
const data = async (type, body, info) => (await packet(type, body, info)).data;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    // ================= registration, the destructive list, permissions =================
    for (const t of handler.WRITES) {
        assert.strictEqual(registry.getWsPacketEntry(t).meta.destructive, true, `${t} is destructive in the registry`);
    }
    const wsh = fs.readFileSync(path.join(ROOT, 'modules/websocketHandlers.js'), 'utf8');
    const list = wsh.slice(wsh.indexOf('const destructiveOperations = ['), wsh.indexOf('];', wsh.indexOf('const destructiveOperations = [')));
    for (const t of handler.WRITES) assert.ok(list.includes(`'${t}'`), `${t} is in websocketHandlers' destructive list (read-only users)`);
    for (const t of handler.READS) assert.ok(!list.includes(`'${t}'`), `${t} stays a read`);

    let r = await packet('ingest_list_accounts', {}, { authenticated: true, userType: 'user' });
    assert.strictEqual(r.type, 'ingest_list_accounts_response', 'a refusal is a response, not an error packet (no unhandled-exception window)');
    assert.deepStrictEqual([r.data.success, r.data.code], [false, 'INSUFFICIENT_PERMISSIONS']);
    r = await packet('ingest_list_accounts', {}, { authenticated: false, userType: 'admin' });
    assert.strictEqual(r.data.code, 'INSUFFICIENT_PERMISSIONS', 'signed out');
    r = await packet('ingest_list_accounts', {}, { authenticated: true, userType: 'admin', authMethod: 'application_key', applicationScopes: ['universal'] });
    assert.strictEqual(r.data.code, 'INSUFFICIENT_PERMISSIONS', 'a key needs the bridge scope, as on MCP');
    r = await packet('ingest_list_accounts', {}, { authenticated: true, userType: 'admin', authMethod: 'application_key', applicationScopes: ['sfapp_messaging_bridge'], appName: 'Tsubame' });
    assert.strictEqual(r.data.success, true, 'a key with the bridge scope');
    assert.strictEqual(sent.filter((p) => p.type === 'error').length, 0, 'no error packets at all');

    // ================= accounts and modes =================
    let d = await data('ingest_list_accounts');
    const keys = d.accounts.map((a) => `${a.source}|${a.accountId}`);
    assert.ok(keys.includes('email|ykazari') && keys.includes('sms|bb'), JSON.stringify(keys));
    assert.ok(d.accounts.every((a) => a.mode === 'bypass'), 'everything starts in bypass');

    d = await data('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process' });
    assert.deepStrictEqual([d.success, d.code], [false, 'CONFIRM_REQUIRED'], 'process mode wants confirm');
    d = await data('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process', confirm: true });
    assert.strictEqual(d.success, true);
    assert.deepStrictEqual([d.account.mode, d.account.applying, d.account.dryRun], ['process', false, true], 'process starts dry-run');
    d = await data('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process', applying: true });
    assert.strictEqual(d.code, 'CONFIRM_REQUIRED', 'applying wants confirm');
    d = await data('ingest_set_mode', { source: 'sms', accountId: 'bb', mode: 'bypass' });
    assert.strictEqual(d.success, true, 'bypass needs no confirm');
    d = await data('ingest_set_mode', { source: 'email', accountId: 'nobody', mode: 'bypass' });
    assert.deepStrictEqual([d.success, d.code], [false, 'NOT_FOUND']);
    // unknown fields never reach the tool
    d = await data('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process', confirm: true, applying: false, actor: 'mallory', updatedBy: 'x' });
    assert.strictEqual(d.success, true);
    assert.notStrictEqual(ingestStore.getAccount('email', 'ykazari').updatedBy, 'mallory', 'the actor comes from the socket, not the packet');
    assert.strictEqual(ingestStore.getAccount('email', 'ykazari').updatedBy, 'yukimi', 'the administrator\'s desktop acts as the Exchange owner');

    // audited like MCP
    const audit = exchangeDb().prepare("SELECT * FROM exchange_audit WHERE action = 'ingest_set_mode'").all();
    assert.ok(audit.some((x) => x.success === 1) && audit.some((x) => x.success === 0), 'set_mode audited (success and refusal)');

    // ================= modules =================
    d = await data('ingest_list_modules', { source: 'email', accountId: 'ykazari', probe: true });
    assert.strictEqual(d.success, true);
    assert.deepStrictEqual(d.pipeline.map((p) => p.id), ['spamFilter', 'codeExtraction', 'routing', 'expiry']);
    assert.strictEqual(d.spamd.ok, true, 'Test Connection reaches the spamd ping');
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', enabled: true, settings: { action: 'trash' } });
    assert.strictEqual(d.code, 'CONFIRM_REQUIRED', 'a spam filter that deletes wants confirm');
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', enabled: true, settings: { action: 'junk', threshold: 6 } });
    assert.strictEqual(d.success, true, 'junk on a dry-run account: no confirm');
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', position: 3 });
    assert.deepStrictEqual(d.order, ['codeExtraction', 'routing', 'expiry', 'spamFilter'], 'reordered');

    // routing: a rule with an expiry is stored as { afterMs } and must survive the next change (it blocked any
    // routing change after it before this fix)
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', settings: {
        groups: { approved: ['*@x.example'] },
        rules: [{ name: 'Strangers later', match: { all: [{ field: 'from', op: 'in', group: 'approved', not: true }] }, actions: { moveTo: 'Later', expire: { after: '40d', afterRead: '7d' } } }]
    } });
    assert.strictEqual(d.success, true, JSON.stringify(d));
    d = await data('ingest_list_modules', { source: 'email', accountId: 'ykazari' });
    const routing = d.pipeline.find((p) => p.id === 'routing');
    assert.deepStrictEqual(routing.settings.rules[0].actions.expire, { afterMs: 40 * DAY, afterReadMs: 7 * DAY });
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', enabled: false });
    assert.strictEqual(d.success, true, `a later change to routing still validates the stored expiry: ${JSON.stringify(d)}`);
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', enabled: true, settings: { includeLegacyRules: false } });
    assert.strictEqual(d.success, true, JSON.stringify(d));
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', settings: {
        rules: [{ name: 'Drop', match: { all: [{ field: 'subject', op: 'contains', value: ['spam'] }] }, actions: { delete: true } }]
    } });
    assert.strictEqual(d.code, 'CONFIRM_REQUIRED', 'a rule that deletes wants confirm');

    // ================= dry run =================
    d = await data('ingest_dry_run', { source: 'email', accountId: 'ykazari', message: { from: 'stranger@y.example', subject: 'Hello', text: 'hi' }, scoreSpam: false });
    assert.strictEqual(d.success, true, JSON.stringify(d));
    assert.ok(d.actions.some((a) => a.type === 'move' && a.to === 'Later'), JSON.stringify(d.actions));
    assert.ok(Array.isArray(d.trace) && d.trace.length === 4);

    // ================= expiry =================
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'expiry', enabled: true });
    assert.strictEqual(d.code, 'CONFIRM_REQUIRED', 'expiry moves mail to Trash: confirm');
    d = await data('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'expiry', enabled: true, confirm: true });
    assert.strictEqual(d.success, true);
    d = await data('ingest_expiry_sweep', { source: 'email', accountId: 'ykazari' });
    assert.strictEqual(d.success, true, JSON.stringify(d));
    assert.strictEqual(d.dryRun, true, 'a sweep is dry-run by default');
    assert.ok((d.wouldExpire || []).some((m) => /payment/i.test(m.subject)), JSON.stringify(d.wouldExpire));
    d = await data('ingest_expiry_sweep', { source: 'email', accountId: 'ykazari', dryRun: false });
    assert.strictEqual(d.code, 'CONFIRM_REQUIRED', 'a real sweep wants confirm');
    d = await data('ingest_expiry_status', { source: 'email', accountId: 'ykazari', limit: 10 });
    assert.strictEqual(d.success, true);
    assert.ok(d.enabled && d.dryRun && d.counts.tagged + d.counts.due >= 1, JSON.stringify(d.counts));
    d = await data('ingest_expiry_status', { source: 'sms', accountId: 'bb' });
    assert.strictEqual(d.code, 'BAD_SOURCE', 'texts have no expiry');

    // ================= the log, paged =================
    for (let i = 0; i < 120; i += 1) ingestStore.addLog({ source: 'sms', account: 'bb', dry: true, sender: `s${i}`, subject: `m${i}`, actions: [{ type: 'silence' }] });
    let p1 = await data('ingest_log', { source: 'sms', limit: 50 });
    assert.strictEqual(p1.entries.length, 50);
    assert.strictEqual(p1.more, true);
    assert.strictEqual(p1.entries[0].subject, 'm119', 'newest first');
    const p2 = await data('ingest_log', { source: 'sms', limit: 50, before: p1.entries[49].id });
    assert.strictEqual(p2.entries[0].subject, 'm69', 'the next page starts below the last one');
    assert.ok(p2.entries.every((e) => e.id < p1.entries[49].id));
    const p3 = await data('ingest_log', { source: 'sms', limit: 50, before: p2.entries[49].id });
    assert.deepStrictEqual([p3.entries.length, p3.more], [20, false], 'the last page');
    for (let i = 0; i < 100; i += 1) ingestStore.addLog({ source: 'email', account: 'ykazari', dry: true, sender: 'x', subject: `e${i}`, actions: [] });
    p1 = await data('ingest_log', { limit: 1000 });
    assert.deepStrictEqual([p1.entries.length, p1.more], [200, true], 'a page is at most 200');
    // MCP pages the same way (same function, before in its schema)
    const tool = bridge.TOOLS.find((t) => t.name === 'ingest_log');
    assert.ok(tool.inputSchema.properties.before, 'ingest_log takes before on MCP');

    // ================= mail rules =================
    d = await data('bridge_mail_save_rule', { name: 'Shops', match: { from: 'shop.example' }, actions: { markRead: true } });
    assert.strictEqual(d.success, true, JSON.stringify(d));
    const ruleId = d.rule.id;
    d = await data('bridge_mail_list_rules');
    assert.ok(d.rules.some((x) => x.id === ruleId));
    d = await data('bridge_mail_run_rules', { accountId: 'ykazari' });
    assert.deepStrictEqual([d.success, d.dryRun, d.matched], [true, true, 1], 'run rules: a dry run by default');
    d = await data('bridge_mail_run_rules', { accountId: 'ykazari', dryRun: false });
    assert.strictEqual(d.code, 'CONFIRM_REQUIRED', 'applying the rules wants confirm');
    d = await data('bridge_mail_delete_rule', { id: ruleId });
    assert.strictEqual(d.code, 'CONFIRM_REQUIRED', 'deleting a rule wants confirm');

    // ================= the feed =================
    const sock = { readyState: 1, once() {} };
    const feed = statusHub.get('ingest_controller');
    assert.ok(feed, 'the feed is defined');
    await assert.rejects(() => feed.subscribe(sock, { authenticated: true, userType: 'user' }), /Not allowed/);
    const snap = await feed.subscribe(sock, ADMIN);
    assert.strictEqual(snap.items['a:email|ykazari'].mode, 'process');
    assert.ok(Array.isArray(snap.items.log) && snap.items.log.length === 8, 'the newest 8 log entries');
    assert.ok(snap.items.rules.some((x) => x.id === ruleId), 'the mail rules');
    assert.ok(snap.items['x:email|ykazari'] && snap.items['x:email|ykazari'].counts, 'expiry counts for a process account with expiry on');
    pushes.length = 0;
    await data('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'bypass' });
    await wait(600);
    const push = pushes.find((x) => x.type === 'ingest_controller_status');
    assert.ok(push, 'a write pushes');
    assert.strictEqual(push.changed['a:email|ykazari'].mode, 'bypass', 'only what changed');
    assert.ok(!('a:sms|bb' in push.changed), 'an unchanged account is not sent again');
    assert.ok(push.removed.includes('x:email|ykazari'), 'expiry counts go when the account leaves process mode');
    pushes.length = 0;
    await data('bridge_mail_delete_rule', { id: ruleId, confirm: true });
    await wait(600);
    assert.ok(pushes.some((x) => x.changed && Array.isArray(x.changed.rules) && !x.changed.rules.some((y) => y.id === ruleId)), 'a mail rule change pushes');
    pushes.length = 0;
    await wait(600);
    assert.strictEqual(pushes.length, 0, 'nothing changes, nothing is sent');
    feed.unsubscribe(sock);

    // ================= the console script =================
    await consoleTests();
    console.log('test-ingest-mmc: ok');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

async function consoleTests() {
    const src = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/mmcIngest.js'), 'utf8');
    assert.ok(!/setInterval\s*\(/.test(src), 'no client timers that ask the server');
    assert.ok(!/<select\b/.test(src), 'no browser select');
    assert.ok(!new RegExp(`\\b${'a'}ge\\b`, 'i').test(src), 'none of the words the house rules leave out');
    assert.ok(!/[–—…‘’“”]/.test(src), 'keyboard characters only');
    const sm = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/mmcServerManager.js'), 'utf8');
    assert.ok(/\['ingest', 'Ingest Controller', 'mmcIngest'/.test(sm), 'a role in Server Manager');
    const fl = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/featureLoader.js'), 'utf8');
    assert.ok(fl.indexOf("'scripts/comp/mmcIngest.js'") > 0 && fl.indexOf("'scripts/comp/mmcIngest.js'") < fl.indexOf("'scripts/comp/mmcServerManager.js'"), 'loaded before Server Manager');

    const sentWs = [];
    let answer = null;
    const win = {
        localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        wsClient: {
            on() {},
            sendMessage: async (type, body) => { sentWs.push([type, body]); return answer ? answer(type, body) : { success: true }; }
        },
        mmcConsole: { when: (t) => String(t) }
    };
    vm.runInNewContext(src, { window: win, globalThis: win, localStorage: win.localStorage, console, setTimeout, clearTimeout, Promise, JSON, Object, Array, String, Number, Date, Map, Set, Math, RegExp, Error });
    const ing = win.mmcIngest;
    assert.ok(ing && typeof ing.def === 'function', 'mmcIngest.def');
    const def = ing.def();
    const tree = def.nodes();
    const ids = [];
    const walk = (l) => l.forEach((n) => { ids.push(n.id); if (n.children) walk(n.children); });
    walk(tree);
    assert.deepStrictEqual(ids, ['root', 'accounts', 'acc-email', 'acc-exchange', 'acc-sms', 'modules', 'mod-spamFilter', 'mod-codeExtraction', 'mod-routing', 'mod-expiry', 'routing', 'expiry', 'mailrules', 'log']);
    assert.ok(tree[0].icon && ids.length === 14);

    const st = ing._state;
    st.accounts.set('email|ykazari', { source: 'email', accountId: 'ykazari', label: 'y@icloud.com', mode: 'bypass', applying: false, pipeline: [{ id: 'routing', enabled: true }] });
    const boxes = [];
    let yes = true;
    const c = {
        node: 'accounts', modal: { isConnected: true },
        box: async (html) => { boxes.push(html); return yes; },
        note() {}, refresh() {}, selectRow() {},
        page: (t, s, secs) => secs.map((x) => x.body).join(''), props: (rows) => rows.map((r) => r[1]).join(''), state: (ok, t) => t, listView: () => '<list>'
    };
    // the server asks (CONFIRM_REQUIRED): the console asks, then sends confirm:true
    answer = (type, body) => (body.confirm ? { success: true, account: {} } : { success: false, code: 'CONFIRM_REQUIRED', error: 'Switching to process mode needs confirm:true' });
    await def.action('mode-process:email|ykazari', c);
    assert.deepStrictEqual(sentWs.map((x) => [x[0], !!x[1].confirm]), [['ingest_set_mode', false], ['ingest_set_mode', true]]);
    assert.strictEqual(boxes.length, 1, 'asked once');
    assert.ok(/process mode/i.test(boxes[0]));
    // No: nothing more is sent
    sentWs.length = 0; boxes.length = 0; yes = false;
    await def.action('mode-process:email|ykazari', c);
    assert.deepStrictEqual(sentWs.map((x) => !!x[1].confirm), [false], 'No sends nothing more');
    // bypass: no question
    sentWs.length = 0; boxes.length = 0; yes = true;
    st.accounts.get('email|ykazari').mode = 'process';
    answer = () => ({ success: true, account: {} });
    await def.action('mode-bypass:email|ykazari', c);
    assert.deepStrictEqual([sentWs.length, boxes.length, sentWs[0][1].mode, !!sentWs[0][1].confirm], [1, 0, 'bypass', false]);
    // a real sweep asks before anything is sent; No sends nothing
    sentWs.length = 0; boxes.length = 0; yes = false;
    st.accounts.get('email|ykazari').applying = true;
    await def.action('sweep-apply:email|ykazari', c);
    assert.deepStrictEqual([sentWs.length, boxes.length], [0, 1], 'a real sweep is asked first');
    // deleting a mail rule asks, then sends confirm:true
    st.rules = [{ id: 'rule-1', name: 'Shops', accountId: '*', enabled: true, match: { from: 'x' }, actions: { markRead: true } }];
    sentWs.length = 0; boxes.length = 0; yes = true;
    await def.action('mr-delete:rule-1', c);
    assert.deepStrictEqual([boxes.length, sentWs[0][0], sentWs[0][1].confirm], [1, 'bridge_mail_delete_rule', true]);
    // a refusal is shown, not thrown
    sentWs.length = 0; boxes.length = 0;
    answer = () => ({ success: false, code: 'BAD_SETTINGS', error: 'threshold must be 1-100' });
    await def.action('mod-on:spamFilter:email|ykazari', c);
    assert.ok(boxes.length === 1 && /threshold must be 1-100/.test(boxes[0]), 'the server\'s words in a message box');
    // the page subscribes the feed while it shows
    sentWs.length = 0;
    answer = (type) => (type === 'status_subscribe' ? { feed: 'ingest_controller', items: {} } : { success: true });
    const spec = def.page({ id: 'root' }, c);
    assert.strictEqual(typeof spec.mount, 'function');
    assert.strictEqual(typeof spec.unmount, 'function');
    spec.mount();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(sentWs.some((x) => x[0] === 'status_subscribe' && x[1].feed === 'ingest_controller'), 'subscribed while shown');
    def.onClose(c);
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(sentWs.some((x) => x[0] === 'status_unsubscribe'), 'unsubscribed on close');
}
