#!/usr/bin/env node
/**
 * Ingest Controller (modules/ingestController.js, ingestModules.js, ingestSpamd.js, ingestMcp.js).
 * A fake spamd (real TCP, spamc protocol), the real ingest store (in memory), the real Dovecote store for
 * the Exchange source and the hand-off mail, fakes for IMAP / texts / the notification inbox.
 *   node scripts/test-ingest-controller.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-ctl-'));
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const { resetForTests } = require('../modules/mailExchangeDatabase');
assert.strictEqual(resetForTests(tmpDir), true);

const dovecote = require('../modules/dovecoteMail');
const ctl = require('../modules/ingestController');
const mods = require('../modules/ingestModules');
const spamd = require('../modules/ingestSpamd');
const bridge = require('../modules/messagingBridgeMcp');
const activity = require('../modules/mcpActivity');
const { extractCodes, redactCodes } = require('../modules/ingestCodeRedact');
const { parseListHeaders } = require('../modules/mailListHeaders');
const limiter = require('../modules/mcpRateLimiter');

// ---- everything that gets logged is collected: a code must never be in it
const logged = [];
for (const k of ['log', 'warn', 'error']) { const o = console[k]; console[k] = (...a) => { logged.push(a.join(' ')); o.apply(console, a); }; }

// ---- fake spamd ----
let spamdMode = 'spam';
let spamdCalls = 0;
const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const text = buf.toString('utf8');
        if (/^PING /.test(text) && /\r\n\r\n/.test(text)) { sock.end('SPAMD/1.5 0 PONG\r\n'); return; }
        const m = /^SYMBOLS SPAMC\/1\.5\r\nContent-length: (\d+)\r\n(?:User: [^\r]*\r\n)?\r\n/.exec(text);
        if (!m) return;
        const head = Buffer.byteLength(m[0]);
        if (buf.length < head + Number(m[1])) return;
        spamdCalls++;
        if (spamdMode === 'hang') return; // never answers
        if (spamdMode === 'garbage') { sock.end('hello there\r\n'); return; }
        if (spamdMode === 'error') { sock.end('SPAMD/1.5 76 Service unavailable\r\n\r\n'); return; }
        const body = buf.subarray(head).toString('utf8');
        const spam = /viagra|free money/i.test(body);
        const out = spam ? 'BAYES_99,URIBL_BLACK,FREE_MONEY' : 'HTML_MESSAGE';
        sock.end(`SPAMD/1.5 0 EX_OK\r\nContent-length: ${out.length}\r\nSpam: ${spam ? 'True' : 'False'} ; ${spam ? '14.2' : '0.4'} / 5.0\r\n\r\n${out}`);
    });
    sock.on('error', () => {});
});

// ---- fakes ----
const calls = [];
const notices = [];
const handoffs = [];
const mailState = new Map();
const mailRows = [];
let legacyRules = [];
const fake = {
    mailAccounts: {
        listAccounts: () => ({ accounts: [{ id: 'ykazari', email: 'y@icloud.com' }, { id: 'other', email: 'o@example.com' }] }),
        listFolders: () => ({ folders: [{ path: 'INBOX', special: '\\Inbox' }, { path: 'Junk', special: '\\Junk', name: 'Junk' }, { path: 'Trash', special: '\\Trash' }] }),
        setFlags: async (id, f, uids, o) => { calls.push(['setFlags', id, f, uids, o.add]); return { ok: true }; },
        move: async (id, f, uids, to) => { calls.push(['move', id, f, uids, to]); return { ok: true }; },
        remove: async (id, f, uids) => { calls.push(['remove', id, f, uids]); return { ok: true }; },
        send: async (id, body) => { calls.push(['send', id, body.to]); return { ok: true }; },
        ensureFolder: async (id, p) => { calls.push(['ensureFolder', id, p]); return { ok: true }; },
        fetchRaw: async () => null
    },
    mailStore: {
        getFolder: () => ({ uidvalidity: '1' }),
        maxUid: (id) => mailRows.filter((r) => r.account === id).reduce((n, r) => Math.max(n, r.uid), 0),
        getState: (id, k) => (mailState.has(`${id}|${k}`) ? mailState.get(`${id}|${k}`) : null),
        setState: (id, k, v) => { mailState.set(`${id}|${k}`, v); },
        messagesAfterUid: (id, f, uid, n) => mailRows.filter((r) => r.account === id && r.uid > uid).slice(0, n),
        countRuleHits: (id, n) => { calls.push(['hit', id, n]); },
        getMessage: (id, f, uid) => mailRows.find((r) => r.account === id && r.uid === uid) || null
    },
    mailRules: {
        rulesFor: () => legacyRules,
        matches: (rule, row) => String(row.subject || '').toLowerCase().includes(String(rule.match.subject || '\u0000').toLowerCase()),
        applyNew: async (id) => { calls.push(['legacyApplyNew', id]); return { applied: [] }; }
    },
    textMessaging: {
        listAccounts: () => ({ accounts: [{ id: 'bb', kind: 'bluebubbles' }] }),
        markRead: async (id, a) => { calls.push(['tmRead', id, a.chatGuid]); return {}; },
        deleteChat: async (id, a) => { calls.push(['tmDelete', id, a.chatGuid]); return {}; },
        listMessages: async () => ({ messages: [{ guid: 'g1', text: 'hello', sender: { address: '+15551230000' } }] })
    },
    notifier: { publish: (n) => { notices.push(n); return n; } },
    dovecote: Object.assign(Object.create(dovecote), {
        deliverInboundMail: (m) => { if (m.fromAddress === ctl.HANDOFF_FROM) handoffs.push(m); return dovecote.deliverInboundMail(m); }
    })
};
fake.dovecote = { listMailboxes: dovecote.listMailboxes, isValidOwner: dovecote.isValidOwner, deliverInboundMail: (m) => { if (m.fromAddress === ctl.HANDOFF_FROM) handoffs.push(m); return dovecote.deliverInboundMail(m); }, forwardMail: dovecote.forwardMail, getMessageRow: dovecote.getMessageRow };

const TSU = { applicationAuth: { appName: 'Tsubame', applicationScopes: ['sfapp_messaging_bridge'], applicationKeyId: 'k-tsu' } };
const out = (r) => JSON.parse(r.content[0].text);
const call = async (name, args) => out(await bridge.handleBridgeTool(TSU, name, args || {}));
const mailRow = (uid, from, subject, text, extra) => Object.assign({
    account: 'ykazari', uid, subject, text, snippet: text, html: '', date: Date.now(), msgid: `<${uid}@x>`,
    sender: `${from}`, recipients: 'y@icloud.com', env: JSON.stringify({ from: [{ name: '', address: from }], to: [{ address: 'y@icloud.com' }], cc: [] })
}, extra || {});

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    ctl._test.open(':memory:');
    ctl._test.setBackends(fake);

    // ================= codes: extraction and redaction =================
    let c = extractCodes('Your verification code is 482913. Do not share it.');
    assert.deepStrictEqual(c.codes, ['482913']);
    assert.deepStrictEqual(extractCodes('123 456 is your Google verification code').codes, ['123456']);
    assert.deepStrictEqual(extractCodes('Use code G-554433 to sign in').codes, ['554433']);
    assert.deepStrictEqual(extractCodes('Your OTP: 4821 expires in 5 min').codes, ['4821']);
    assert.deepStrictEqual(extractCodes('security code 12345678').codes, ['12345678']);
    assert.deepStrictEqual(extractCodes('Meeting in 2026 about the code review').codes, [], 'a year is not a code');
    assert.deepStrictEqual(extractCodes('Order total $12345 code').codes, [], 'an amount is not a code');
    assert.deepStrictEqual(extractCodes('your code is 123456789').codes, [], '9 digits is not a code');
    assert.ok(extractCodes('Click https://x.com/verify?token=abc123 to confirm').links.length === 1);
    assert.ok(!/482913/.test(redactCodes('Your verification code is 482913.')));
    assert.ok(!/abc123/.test(redactCodes('Click https://x.com/verify?token=abc123 to confirm')));
    // the MCP activity ring never shows a code
    const sa = JSON.stringify(activity.summarizeArgs({ message: { text: 'Your verification code is 771155 ok' } }));
    assert.ok(!/771155/.test(sa), 'MCP activity redacts codes');

    // ================= spamd client =================
    spamdMode = 'spam';
    assert.deepStrictEqual(await spamd.ping('127.0.0.1', port), { ok: true, reply: 'SPAMD/1.5 0 PONG' });
    let s = await spamd.score('From: a@b.c\r\nSubject: x\r\n\r\nfree money now', { host: '127.0.0.1', port });
    assert.strictEqual(s.ok, true); assert.strictEqual(s.spam, true); assert.strictEqual(s.score, 14.2); assert.strictEqual(s.required, 5);
    assert.ok(s.symbols.includes('BAYES_99'));
    s = await spamd.score('From: a@b.c\r\n\r\nhello', { host: '127.0.0.1', port });
    assert.strictEqual(s.spam, false);
    assert.strictEqual((await spamd.score('x', { host: '', port: 0 })).ok, false, 'not configured = not ok');
    spamdMode = 'garbage';
    assert.strictEqual((await spamd.score('x', { host: '127.0.0.1', port })).ok, false);
    spamdMode = 'error';
    assert.strictEqual((await spamd.score('x', { host: '127.0.0.1', port })).ok, false);
    spamdMode = 'hang';
    const t0 = Date.now();
    s = await spamd.score('x', { host: '127.0.0.1', port, timeoutMs: 600 });
    assert.strictEqual(s.ok, false); assert.match(s.error, /timeout/); assert.ok(Date.now() - t0 < 3000, 'short timeout');
    assert.strictEqual((await spamd.score('x', { host: '127.0.0.1', port: 1, timeoutMs: 800 })).ok, false, 'refused = not ok');
    spamdMode = 'spam';

    // ================= defaults, gates and confirms =================
    let r = await call('ingest_list_accounts');
    assert.strictEqual(r.success, true, JSON.stringify(r));
    const bySrc = (src) => r.accounts.filter((a) => a.source === src);
    assert.strictEqual(bySrc('email').length, 2); assert.strictEqual(bySrc('sms').length, 1);
    assert.ok(bySrc('exchange').some((a) => a.accountId === 'tsubame') && bySrc('exchange').some((a) => a.accountId === 'yukimi'));
    assert.ok(r.accounts.every((a) => a.mode === 'bypass' && a.applying === false), 'default is bypass everywhere');
    assert.deepStrictEqual(bySrc('email')[0].pipeline.map((m) => m.id), ['spamFilter', 'codeExtraction', 'routing']);
    let noScope = out(await bridge.handleBridgeTool({ applicationAuth: { appName: 'Tsubame', applicationScopes: ['universal'], applicationKeyId: 'k' } }, 'ingest_list_accounts', {}));
    assert.strictEqual(noScope.code, 'INSUFFICIENT_SCOPE');
    noScope = out(await bridge.handleBridgeTool({ applicationAuth: { appName: 'Menma', applicationScopes: ['sfapp_messaging_bridge'], applicationKeyId: 'k' } }, 'ingest_list_accounts', {}));
    assert.strictEqual(noScope.code, 'FORBIDDEN');
    assert.ok(bridge.TOOLS.some((t) => t.name === 'ingest_dry_run' && t.scope === 'sfapp_messaging_bridge'), 'on the existing scope');
    for (const n of ['ingest_list_accounts', 'ingest_set_mode', 'ingest_list_modules', 'ingest_configure_module', 'ingest_dry_run', 'ingest_log']) assert.ok(bridge.isBridgeTool(n), n);
    r = await call('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process' });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED', 'process needs confirm');
    r = await call('ingest_set_mode', { source: 'email', accountId: 'nope', mode: 'process', confirm: true });
    assert.strictEqual(r.code, 'NOT_FOUND');
    r = await call('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'bypass', applying: true, confirm: true });
    assert.strictEqual(r.code, 'BAD_MODE');

    // ================= bypass: the older rules, nothing else =================
    mailRows.push(mailRow(1, 'news@shop.example', 'Sale', 'free money viagra'));
    await ctl.onMailArrived('ykazari');
    assert.deepStrictEqual(calls.splice(0), [['legacyApplyNew', 'ykazari']], 'bypass = the older rules exactly as before');

    // ================= dry-run by default =================
    r = await call('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process', confirm: true });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.account.mode, 'process'); assert.strictEqual(r.account.applying, false); assert.strictEqual(r.account.dryRun, true);
    assert.strictEqual(mailState.get('ykazari|ingestUid'), 1, 'new mail only: marker starts at now');
    // spam filter on, spamd at the fake
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', enabled: true, settings: { host: '127.0.0.1', port, threshold: 8 } });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.module.enabled, true);
    r = await call('ingest_list_modules', { source: 'email', accountId: 'ykazari', probe: true });
    assert.strictEqual(r.spamd.ok, true, 'probe pings spamd');
    assert.strictEqual(r.pipeline.find((m) => m.id === 'spamFilter').settings.port, port);
    const defaults = (await call('ingest_list_modules')).modules.find((m) => m.id === 'spamFilter').defaults;
    assert.strictEqual(defaults.host, '192.168.255.1'); assert.strictEqual(defaults.port, 783, 'Sala\'s spamd is the default');

    mailRows.push(mailRow(2, 'promo@spam.example', 'Hot', 'free money viagra click'));
    mailRows.push(mailRow(3, 'friend@example.com', 'Lunch', 'lunch tomorrow?'));
    await ctl.onMailArrived('ykazari');
    assert.deepStrictEqual(calls.splice(0), [], 'dry-run: no side effect at all');
    let log = (await call('ingest_log', { source: 'email' })).entries;
    assert.strictEqual(log.length, 1); assert.strictEqual(log[0].dry, true);
    assert.strictEqual(log[0].actions[0].type, 'move'); assert.strictEqual(log[0].actions[0].to, '@junk');
    assert.strictEqual(mailState.get('ykazari|ingestUid'), 3, 'marker advanced');

    // enabling applying needs confirm
    r = await call('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process', applying: true });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED');
    r = await call('ingest_set_mode', { source: 'email', accountId: 'ykazari', mode: 'process', applying: true, confirm: true });
    assert.strictEqual(r.account.applying, true); assert.strictEqual(r.account.dryRun, false);

    // live: spam goes to Junk; ham untouched
    mailRows.push(mailRow(4, 'promo@spam.example', 'Hot 2', 'viagra'));
    mailRows.push(mailRow(5, 'friend@example.com', 'Dinner', 'dinner?'));
    await ctl.onMailArrived('ykazari');
    assert.deepStrictEqual(calls.splice(0), [['move', 'ykazari', 'INBOX', [4], 'Junk']], 'spam -> the Junk folder; ham untouched');

    // fail open: hang / garbage / error / refused -> left alone
    for (const mode of ['hang', 'garbage', 'error']) {
        spamdMode = mode;
        await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', settings: { timeoutMs: 600 } });
        const uid = mailRows.length + 10;
        mailRows.push(mailRow(uid, 'promo@spam.example', 'Hot', 'viagra'));
        await ctl.onMailArrived('ykazari');
        assert.deepStrictEqual(calls.splice(0), [], `fail open (${mode})`);
    }
    spamdMode = 'spam';
    await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', settings: { port: 1 } });
    mailRows.push(mailRow(40, 'promo@spam.example', 'Hot', 'viagra'));
    await ctl.onMailArrived('ykazari');
    assert.deepStrictEqual(calls.splice(0), [], 'fail open (unreachable)');
    await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', settings: { port } });

    // trash needs confirm (it deletes) and an applying account needs confirm to turn a module on
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', settings: { action: 'trash' } });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED', 'delete action needs confirm');
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'codeExtraction', enabled: true });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED', 'turning a module on for a live account needs confirm');
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', settings: { action: 'trash' }, confirm: true });
    assert.strictEqual(r.success, true);
    mailRows.push(mailRow(41, 'promo@spam.example', 'Hot', 'viagra'));
    await ctl.onMailArrived('ykazari');
    assert.deepStrictEqual(calls.splice(0), [['remove', 'ykazari', 'INBOX', [41]]], 'trash action = delete (to Trash)');
    await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'spamFilter', settings: { action: 'junk' }, confirm: true });

    // ================= routing: negation, allowlist groups, header, regex, stop =================
    r = await call('ingest_configure_module', {
        source: 'email', accountId: 'ykazari', module: 'routing', confirm: true,
        settings: {
            groups: { approved: ['friend@example.com', '@family.example', '*@bank.example'] },
            rules: [
                { name: 'newsletters', match: { all: [{ field: 'header', header: 'list-unsubscribe', op: 'exists' }] }, actions: { moveTo: 'Newsletters' } },
                { name: 'regex', match: { any: [{ field: 'subject', op: 'regex', value: '^invoice #\\d+$' }] }, actions: { markRead: true, flag: true } },
                { name: 'everyone else -> Later', match: { all: [{ field: 'from', op: 'in', group: 'approved', not: true }] }, actions: { moveTo: 'Later' } }
            ]
        }
    });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    // dry runs show each decision
    const dry = async (message, extra) => call('ingest_dry_run', Object.assign({ source: 'email', accountId: 'ykazari', message }, extra || {}));
    r = await dry({ from: 'friend@example.com', subject: 'hi', text: 'hello' });
    assert.strictEqual(r.success, true, JSON.stringify(r)); assert.deepStrictEqual(r.actions, [], 'an approved sender stays in the inbox');
    r = await dry({ from: 'cousin@family.example', subject: 'hi', text: 'hello' });
    assert.deepStrictEqual(r.actions, [], '@domain pattern');
    r = await dry({ from: 'x@bank.example', subject: 'hi', text: 'hello' });
    assert.deepStrictEqual(r.actions, [], '*@ glob');
    r = await dry({ from: 'stranger@x.example', subject: 'hi', text: 'hello' });
    assert.strictEqual(r.actions.length, 1); assert.strictEqual(r.actions[0].type, 'move'); assert.strictEqual(r.actions[0].to, 'Later', 'negated allowlist: not approved -> Later');
    r = await dry({ from: 'stranger@x.example', subject: 'hi', text: 'hello', headers: { 'List-Unsubscribe': '<https://x/u>' } });
    assert.strictEqual(r.actions[0].to, 'Newsletters', 'first matching rule wins');
    r = await dry({ from: 'friend@example.com', subject: 'Invoice #4411', text: 'x' });
    assert.deepStrictEqual(r.actions.map((a) => a.type).sort(), ['flag', 'markRead'], 'regex, case-insensitive');
    r = await dry({ from: 'someone@x.example', subject: 'Free money viagra', text: 'viagra' });
    assert.strictEqual(r.stoppedBy, 'spamFilter'); assert.strictEqual(r.actions[0].to, '@junk', 'spam first: a move stops the later modules');
    assert.ok(r.trace.find((t) => t.module === 'routing').note.skipped.includes('stopped'));
    // negation: none[]
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', confirm: true, settings: { rules: [{ name: 'n', match: { all: [{ field: 'subject', op: 'contains', value: 'receipt' }], none: [{ field: 'from', op: 'contains', value: 'boss' }] }, actions: { markRead: true } }] } });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual((await dry({ from: 'shop@x.example', subject: 'Your receipt', text: '' })).actions.length, 1);
    assert.strictEqual((await dry({ from: 'boss@x.example', subject: 'Your receipt', text: '' })).actions.length, 0, 'none[]');
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', confirm: true, settings: { rules: [{ match: { all: [{ field: 'from', op: 'in', group: 'missing' }] }, actions: { markRead: true } }] } });
    assert.strictEqual(r.code, 'BAD_SETTINGS'); assert.match(r.error, /unknown group/);
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', confirm: true, settings: { rules: [{ match: { all: [{ field: 'subject', op: 'regex', value: '(a+)+$' }] }, actions: { markRead: true } }] } });
    assert.strictEqual(r.code, 'BAD_SETTINGS', 'catastrophic regex refused');
    // forwarding / delete rules need confirm
    r = await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', settings: { rules: [{ match: { all: [{ field: 'subject', op: 'contains', value: 'x' }] }, actions: { forwardTo: 'a@b.c' } }] } });
    assert.strictEqual(r.code, 'CONFIRM_REQUIRED');

    // legacy mail rules still run inside process mode (no regression), first
    legacyRules = [{ id: 'rule-legacy', match: { subject: 'weekly digest' }, actions: { markRead: true, moveTo: 'Digests' } }];
    await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', confirm: true, settings: { rules: [{ name: 'later', match: { none: [{ field: 'from', op: 'in', group: 'approved' }] }, actions: { moveTo: 'Later' } }] } });
    r = await dry({ from: 'anyone@x.example', subject: 'Your weekly digest', text: '' });
    assert.deepStrictEqual(r.actions.map((a) => `${a.type}:${a.to || ''}`), ['markRead:', 'move:Digests'], 'older rule wins first, like before');
    mailRows.push(mailRow(50, 'anyone@x.example', 'Your weekly digest', 'text'));
    await ctl.onMailArrived('ykazari');
    assert.deepStrictEqual(calls.splice(0).map((x) => x[0]), ['setFlags', 'ensureFolder', 'move', 'hit'], 'applied, hits counted, folder ensured');
    legacyRules = [];

    // ================= codes: notification only, never logged =================
    await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'codeExtraction', enabled: true, confirm: true });
    await call('ingest_configure_module', { source: 'email', accountId: 'ykazari', module: 'routing', confirm: true, settings: { rules: [{ name: 'hand', match: { all: [{ field: 'subject', op: 'contains', value: 'login' }] }, actions: { handTo: 'tsubame', moveTo: 'Later' } }] } });
    logged.length = 0;
    r = await dry({ from: 'no-reply@bank.example', fromName: 'Bank', subject: 'Your login code', text: 'Your verification code is 904417. It expires soon.' });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.ok(!JSON.stringify(r).includes('904417'), 'dry-run output carries no code');
    assert.ok(r.actions.some((a) => a.type === 'notify' && a.kind === 'code' && a.text === '[redacted]'));
    mailRows.push(mailRow(60, 'no-reply@bank.example', 'Your login code', 'Your verification code is 904417. It expires soon.'));
    handoffs.length = 0; notices.length = 0;
    await ctl.onMailArrived('ykazari');
    const done = calls.splice(0).map((x) => x[0]);
    assert.ok(done.includes('move'), 'routed');
    assert.strictEqual(notices.length, 1, 'one notification');
    assert.match(notices[0].text, /904417/, 'the code reaches Yukimi\'s devices (notification inbox)');
    assert.match(notices[0].title, /Verification code/);
    assert.ok(!notices[0].id.includes('904417'), 'not in the notice id');
    assert.strictEqual(handoffs.length, 1, 'hand-off to the agent mailbox');
    assert.ok(!/904417/.test(handoffs[0].body + handoffs[0].subject), 'a hand-off never carries the code');
    assert.strictEqual(handoffs[0].toOwner, 'tsubame');
    const tsuMail = dovecote.listMail('tsubame', { folder: 'inbox' });
    assert.ok(tsuMail.some((m) => /\[Ingest\]/.test(m.subject)), 'Dovecote system mail landed in tsubame');
    // nothing else carries it: logs, ingest_log, exchange audit, MCP activity
    log = (await call('ingest_log', { limit: 50 })).entries;
    assert.ok(!JSON.stringify(log).includes('904417'), 'ingest_log has no code');
    assert.ok(!logged.join('\n').includes('904417'), 'no log line has the code');
    const audit = require('../modules/mailExchangeDatabase').getDb().prepare('SELECT * FROM exchange_audit').all();
    assert.ok(!JSON.stringify(audit).includes('904417'), 'exchange_audit has no code');
    assert.ok(audit.some((a) => a.action === 'ingest_set_mode' && a.actor === 'tsubame'), 'every call audited like the other bridge tools');
    assert.ok(audit.some((a) => a.action === 'ingest_configure_module'));
    // a hand-off is not processed again (no loop)
    ctl._test.setBackends(fake);

    // ================= Exchange: pipeline at delivery =================
    const deliver = async (d) => {
        const pre = await ctl.exchangeInbound(d);
        const res = dovecote.deliverInboundMail(pre && pre.ingest ? Object.assign({}, d, { ingest: pre.ingest }) : d);
        if (pre && pre.after) await pre.after(res);
        return res;
    };
    const ex = (extra) => Object.assign({ fromAddress: 'sender@outside.example', fromLabel: 'Sender <sender@outside.example>', toOwner: 'menma', to: ['menma@dream.737.jp.net'], cc: [], subject: 'hello', body: 'hello there', format: 'text', spam: false, headers: {} }, extra || {});
    let res = await deliver(ex());
    assert.strictEqual(res.folder, 'inbox', 'bypass: delivered as before');
    r = await call('ingest_set_mode', { source: 'exchange', accountId: 'menma', mode: 'process', confirm: true });
    assert.strictEqual(r.account.dryRun, true);
    await call('ingest_configure_module', { source: 'exchange', accountId: 'menma', module: 'routing', settings: { groups: { ok: ['@family.example'] }, rules: [{ name: 'later', match: { none: [{ field: 'from', op: 'in', group: 'ok' }] }, actions: { moveTo: 'Later', markRead: true } }] } });
    res = await deliver(ex({ subject: 'dry' }));
    assert.strictEqual(res.folder, 'inbox', 'dry-run: still inbox');
    assert.ok((await call('ingest_log', { source: 'exchange' })).entries.some((e) => e.dry === true));
    await call('ingest_set_mode', { source: 'exchange', accountId: 'menma', mode: 'process', applying: true, confirm: true });
    res = await deliver(ex({ subject: 'live' }));
    assert.strictEqual(res.folder, 'archive', 'Later = an Archive subfolder, filed at delivery');
    const row = dovecote.getMessageRow('menma', res.id);
    assert.strictEqual(row.archive_subfolder, 'Later'); assert.strictEqual(row.read, 1);
    res = await deliver(ex({ fromAddress: 'cousin@family.example', fromLabel: 'Cousin <cousin@family.example>', subject: 'allowed' }));
    assert.strictEqual(res.folder, 'inbox', 'allowlisted sender stays');
    // relay spam score is reused (no spamd call), over threshold -> spam folder
    await call('ingest_configure_module', { source: 'exchange', accountId: 'menma', module: 'spamFilter', enabled: true, confirm: true, settings: { host: '127.0.0.1', port, threshold: 8 } });
    const before = spamdCalls;
    res = await deliver(ex({ subject: 'relay scored', spamMeta: { score: 12.5, required: 5 }, spam: false }));
    assert.strictEqual(res.folder, 'spam'); assert.strictEqual(spamdCalls, before, 'the relay\'s score is trusted for Exchange');
    // hand-off mail from the controller itself is never processed
    const hand = await deliver(ex({ fromAddress: ctl.HANDOFF_FROM, fromLabel: 'Ingest Controller <ingest-controller@dream.737.jp.net>', ownDomainFrom: true, trustedOwnSender: true, subject: 'loop?' }));
    assert.strictEqual(hand.folder, 'inbox', 'no loop');
    // forward (internal) after delivery
    await call('ingest_configure_module', { source: 'exchange', accountId: 'menma', module: 'routing', confirm: true, settings: { rules: [{ name: 'fwd', match: { all: [{ field: 'subject', op: 'contains', value: 'forward me' }] }, actions: { forwardTo: 'ivory', markRead: true } }] } });
    await deliver(ex({ subject: 'forward me' }));
    assert.ok(dovecote.listMail('ivory', { folder: 'inbox' }).some((m) => /Fwd: forward me/.test(m.subject)), 'forwarded to another mailbox');
    // a delete rule files it in Trash at delivery
    await call('ingest_configure_module', { source: 'exchange', accountId: 'menma', module: 'routing', confirm: true, settings: { rules: [{ name: 'del', match: { all: [{ field: 'subject', op: 'contains', value: 'delete me' }] }, actions: { delete: true } }] } });
    res = await deliver(ex({ subject: 'delete me' }));
    assert.strictEqual(res.folder, 'deleted');
    // exchange codes: notify only
    await call('ingest_configure_module', { source: 'exchange', accountId: 'menma', module: 'codeExtraction', enabled: true, confirm: true });
    notices.length = 0;
    await deliver(ex({ subject: 'Sign in', body: 'Use code 620318 to sign in to Example.' }));
    assert.strictEqual(notices.length, 1); assert.match(notices[0].text, /620318/);
    assert.ok(!logged.join('\n').includes('620318'));
    assert.ok(!JSON.stringify(await call('ingest_log', { limit: 100 })).includes('620318'));

    // ================= texts =================
    r = await call('ingest_set_mode', { source: 'sms', accountId: 'bb', mode: 'process', confirm: true });
    assert.strictEqual(r.account.dryRun, true);
    const text = (t, extra) => Object.assign({ event: 'message', chatGuid: 'c1', chatTitle: '+15559990000', isGroup: false, known: false, notify: true, message: { guid: `g-${t.length}`, text: t, sender: { address: '+15559990000' }, date: Date.now() } }, extra || {});
    assert.strictEqual(await ctl.textInbound('bb', text('hello')), null);
    r = await call('ingest_configure_module', { source: 'sms', accountId: 'bb', module: 'spamFilter', enabled: true, settings: { spamNumbers: ['555-777-0001'], textThreshold: 3 } });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    let v = await ctl.textInbound('bb', text('WINNER! Claim your free gift card now https://bit.ly/abc'));
    assert.strictEqual(v, null, 'dry-run: nothing happens'); assert.deepStrictEqual(calls.splice(0), []);
    assert.ok((await call('ingest_log', { source: 'sms' })).entries.some((e) => e.dry && e.actions.some((a) => a.type === 'silence')));
    await call('ingest_set_mode', { source: 'sms', accountId: 'bb', mode: 'process', applying: true, confirm: true });
    v = await ctl.textInbound('bb', text('WINNER! Claim your free gift card now https://bit.ly/abc'));
    assert.deepStrictEqual(v, { suppressNotify: true }, 'spam text: no notification');
    await new Promise((r2) => setImmediate(r2));
    assert.deepStrictEqual(calls.splice(0), [['tmRead', 'bb', 'c1']], 'silenced = read');
    v = await ctl.textInbound('bb', text('see you at 6', { known: true }));
    assert.strictEqual(v, null, 'a friend\'s text is untouched');
    v = await ctl.textInbound('bb', text('Your Example code is 335577', { known: false }));
    assert.strictEqual(v, null, 'a verification code is not spam');
    v = await ctl.textInbound('bb', text('anything', { message: { guid: 'z', text: 'anything', sender: { address: '+1 (555) 777-0001' } } }));
    assert.deepStrictEqual(v, { suppressNotify: true }, 'known spam number list');
    calls.splice(0);
    await call('ingest_configure_module', { source: 'sms', accountId: 'bb', module: 'codeExtraction', enabled: true, confirm: true });
    notices.length = 0;
    v = await ctl.textInbound('bb', text('Your Example code is 335577', { known: false }));
    assert.deepStrictEqual(v, { suppressNotify: true }, 'announced as a code instead of a second new-text notice');
    assert.strictEqual(notices.length, 1); assert.match(notices[0].text, /335577/);
    assert.ok(!logged.join('\n').includes('335577'));
    assert.ok(!JSON.stringify(await call('ingest_log', { limit: 100 })).includes('335577'));
    r = await call('ingest_configure_module', { source: 'sms', accountId: 'bb', module: 'routing', confirm: true, settings: { rules: [{ match: { all: [{ field: 'from', op: 'contains', value: '555' }] }, actions: { moveTo: 'Later' } }] } });
    assert.strictEqual(r.code, 'BAD_SETTINGS', 'texts have no folders');
    // a hand-off of a text keeps codes out
    await call('ingest_configure_module', { source: 'sms', accountId: 'bb', module: 'routing', confirm: true, settings: { rules: [{ name: 'h', match: { all: [{ field: 'body', op: 'contains', value: 'Example' }] }, actions: { handTo: 'tsubame' } }] } });
    handoffs.length = 0;
    await ctl.textInbound('bb', text('Your Example code is 335577', { known: false, message: { guid: 'h1', text: 'Your Example code is 335577', sender: { address: '+15551110000' } } }));
    assert.strictEqual(handoffs.length, 1); assert.ok(!/335577/.test(handoffs[0].body), 'hand-off body redacted');
    // dry run of a stored text
    r = await call('ingest_dry_run', { source: 'sms', accountId: 'bb', ref: { chatGuid: 'c1', guid: 'g1' } });
    assert.strictEqual(r.success, true, JSON.stringify(r));

    // ================= misc =================
    r = await call('ingest_set_mode', { source: 'email', accountId: '*', mode: 'bypass' });
    assert.strictEqual(r.success, true); assert.ok(r.accounts.every((a) => a.mode === 'bypass'), 'bypass needs no confirm; "*" covers the source');
    assert.strictEqual(mailState.get('ykazari|rulesUid'), mailRows.filter((x) => x.account === 'ykazari').reduce((n, x) => Math.max(n, x.uid), 0), 'leaving process: older rules do not replay');
    mailRows.push(mailRow(99, 'a@b.c', 'later', 'x'));
    await ctl.onMailArrived('ykazari');
    assert.deepStrictEqual(calls.splice(0), [['legacyApplyNew', 'ykazari']], 'back to the older rules');

    // List-Unsubscribe parsing
    let lu = parseListHeaders('List-Unsubscribe: <https://x.com/u?id=1>, <mailto:unsub@x.com?subject=unsub>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n');
    assert.deepStrictEqual(lu, { url: 'https://x.com/u?id=1', mail: 'unsub@x.com?subject=unsub', post: 'List-Unsubscribe=One-Click', oneClick: true });
    lu = parseListHeaders('List-Unsubscribe:\r\n <mailto:u@x.com>\r\n');
    assert.strictEqual(lu.mail, 'u@x.com'); assert.strictEqual(lu.url, null); assert.strictEqual(lu.oneClick, false);
    assert.strictEqual(parseListHeaders('Subject: x\r\n').url, null);

    // rate limit: the bridge groups are far above mail / write, and a rules run is one call
    assert.ok(limiter.MCP_RATE_GROUP_LIMITS.bridge.max > limiter.MCP_RATE_GROUP_LIMITS.mail.max * 5);
    assert.strictEqual(limiter.rateGroupForTool('bridge_mail_run_rules'), 'bridge_write');
    assert.strictEqual(limiter.rateGroupForTool('bridge_mail_folders'), 'bridge');
    assert.strictEqual(limiter.rateGroupForTool('ingest_set_mode'), 'bridge_write');
    assert.strictEqual(limiter.rateGroupForTool('ingest_dry_run'), 'bridge');
    assert.strictEqual(limiter.rateGroupForTool('list_mail'), 'mail', 'other mail tools unchanged');

    // modules unit
    assert.ok(mods.globMatch('*@bank.example', 'Alice@Bank.Example') && mods.globMatch('@x.com', 'a@x.com') && !mods.globMatch('@x.com', 'a@y.com'));
    assert.ok(mods.textSpamScore({ text: 'Unpaid toll balance: pay at https://bit.ly/x', known: false }).score >= 3);
    assert.strictEqual(mods.textSpamScore({ text: 'Your code is 123456' }).score, 0);

    ctl._test.reset();
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* tmp */ }
    console.log('test-ingest-controller: ok');
    process.exit(0);
})().catch((e) => { console.error(e && e.stack || e); try { server.close(); } catch (_) { /* x */ } process.exit(1); });
