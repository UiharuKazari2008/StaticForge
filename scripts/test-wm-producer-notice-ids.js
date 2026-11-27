#!/usr/bin/env node
/**
 * Programs that raise their own note for a thing the server also keeps in the notification inbox pass that notice's id
 * (StaticForge #1367), so the shell asks the Android app before it sounds and the thing sounds once. Checks the ids
 * against the server's (modules/notificationInboxSources.js, modules/lapisService.js) and the app's camera id, and that a
 * note filled from an inbox row that was never news stays silent. Runs the real note functions cut out of the program
 * scripts (weatherAlerts.js whole) with fake shells. Nothing sounds.
 *
 *   node scripts/test-wm-producer-notice-ids.js [directory holding wmChat.js, wmMessaging.js, ...]
 *
 * The optional directory is for proving the checks can fail (copies of the scripts without the change).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = process.argv[2] || path.join(__dirname, '..', 'public/scripts/comp');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

/** The source of each function, by its first line, up to the line that closes it. */
function cutAll(file, markers) {
    const src = read(file);
    return markers.map((m) => {
        const from = src.indexOf(`    ${m}`);
        assert(from > 0, `marker not found in ${file}: ${m}`);
        const to = src.indexOf('\n    }\n', from);
        return src.slice(from, to + 6);
    }).join('\n');
}

function recorder() {
    const notes = [];
    const sh = { appNote: (opts) => { notes.push(opts); return { id: `toast-${notes.length}`, update() {}, close() {}, hide() {} }; } };
    return { notes, sh };
}
const baseCtx = (extra) => Object.assign({
    document: { hidden: false, getElementById: () => null, visibilityState: 'visible' },
    window: {}, setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
    console, Date, JSON, Map, Set, String, Number, Array, Object, Math,
}, extra);

function chatWorld(o = {}) {
    const { notes, sh } = recorder();
    const ctx = baseCtx({ sh, o });
    vm.createContext(ctx);
    vm.runInContext(`
        const fresh = new Map();
        const tmFresh = [];
        let smsNote = null; let tmNote = null; let chatSoundedAt = 0; let tmSoundedAt = 0;
        let chatAdoptTimer = null; let chatAdoptNews = false; let tmAdoptTimer = null; let tmAdoptNews = false;
        const BURST_MS = 8000; const SMS_TITLE = 'Dreamscape Messenger'; const SMS_ICON = 'status-messenger';
        const closeSmsNote = () => { smsNote = null; };
        const smsNoteHtml = () => 'x';
        const tmNoteParts = () => ({ title: 'New Text Message', html: 'x' });
        const noteUp = () => false;
        const tmUpdateNote = () => {};
        const tmRefreshSoon = () => {};
        const tmUi = () => null;
        const tmFrom = () => 'Mika';
        const tmText = (m) => m.text;
        const freshKey = (id) => { for (const k of fresh.keys()) if (String(k) === String(id)) return k; return null; };
        const inAndroidApp = () => !!o.app;
        ${cutAll('wmChat.js', ['function adoptChat(n, o) {', 'function showSmsNote(o) {', 'function tmOnMessage(d) {', 'function adoptSms(n, o) {', 'function tmShowNote(o) {'])}
        this.api = { adoptChat, showSmsNote, tmOnMessage, adoptSms, addReply: (id, x) => fresh.set(id, x) };
    `, ctx);
    return { notes, api: ctx.api };
}

function mailWorld(o = {}) {
    const { notes, sh } = recorder();
    // o.stacked: new mail is the inbox's own stack notice, so Messaging draws no note of its own
    const ctx = baseCtx({ ws: sh, o, window: { wmNotificationInbox: { mailStacked: () => !!o.stacked } } });
    vm.createContext(ctx);
    vm.runInContext(`
        const imapFresh = []; const imapPending = new Set(); let imapNote = null;
        let adoptTimer = null; let adoptLive = false; let adoptNews = false;
        const pendKey = (a, f, u) => a + '|' + f + '|' + u;
        const imapNoteParts = () => ({ title: 'New E-mail Message', html: 'x' });
        const inAndroidApp = () => !!o.app;
        const shellStatus = () => {};
        const inboxMailId = (x) => \`mail:\${x.accountId}:\${x.folder || 'INBOX'}:\${x.uid}\`;
        ${cutAll('wmMessaging.js', ['function inboxAdopt(n, o) {', 'function showImapNote(o) {'])}
        this.api = { inboxAdopt };
    `, ctx);
    return { notes, api: ctx.api };
}

let step = 0;
let failed = 0;
function check(name, fn) {
    ++step;
    try { fn(); console.log(`  ${step}. ok   ${name}`); } catch (e) { failed++; console.log(`  ${step}. FAIL ${name}\n       ${String(e && e.message).split('\n').slice(0, 10).join('\n       ')}`); }
}
const ids = (notes) => notes.map((n) => [n.notice, n.noticeAt || 0]);

check('texts: sms:<account>:<chat>, the newest; an Android app account\'s text (no server notice) has none', () => {
    const w = chatWorld();
    w.api.tmOnMessage({ accountId: 'rcs1', chatGuid: 'c9', notify: true, message: { text: 'hello' } });
    w.api.tmOnMessage({ accountId: 'bb', chatGuid: 'g1', notify: true, message: { text: 'newer' } });
    w.api.tmOnMessage({ accountId: 'app-discord', chatGuid: 'd1', notify: true, native: true, message: { text: 'ping' } });
    assert.deepStrictEqual(ids(w.notes), [['sms:rcs1:c9', 0], ['sms:bb:g1', 0], ['', 0]]);
});
check('texts from an inbox row: its id and alertAt; never news is silent, news sounds in a browser', () => {
    const row = (alertAt) => ({ alertAt, data: { accountId: 'rcs1', chatGuid: 'c9', from: 'Mika', text: 'hi' } });
    const w = chatWorld();
    w.api.adoptSms(row(77), { live: true, quiet: false });
    assert.deepStrictEqual(ids(w.notes), [['sms:rcs1:c9', 77]]);
    assert.strictEqual(w.notes[0].silent, false);
    const quiet = chatWorld();
    quiet.api.adoptSms(row(0), { live: false, quiet: true });
    assert.strictEqual(quiet.notes[0].silent, true, 'never news');
    quiet.api.adoptSms(row(5), { live: false, quiet: false });
    assert.strictEqual(quiet.notes[1].silent, false, 'the quiet one does not stick to the next');
    const app = chatWorld({ app: true });
    app.api.adoptSms(row(5), { live: false, quiet: false });
    assert.strictEqual(app.notes[0].silent, true, 'caught up in the Android app: silent as before');
});
check('Messenger: chat:<chatId>, the newest reply; an inbox row\'s alertAt; never news is silent', () => {
    const w = chatWorld();
    w.api.addReply(7, { said: 'one', at: 1 });
    w.api.addReply(8, { said: 'two', at: 2 });
    w.api.showSmsNote();
    assert.deepStrictEqual(ids(w.notes), [['chat:8', 0]]);
    w.api.adoptChat({ alertAt: 91, createdAt: 3, data: { chatId: '9', said: 'three' } }, { live: true, quiet: false });
    assert.deepStrictEqual(ids(w.notes)[1], ['chat:9', 91]);
    assert.strictEqual(w.notes[1].silent, false);
    w.api.adoptChat({ alertAt: 0, createdAt: 4, data: { chatId: '10', said: 'four' } }, { live: false, quiet: true });
    assert.strictEqual(w.notes[2].silent, true);
});
check('mail: mail:<account>:<folder>:<uid> as the server names it, the newest; never news is silent', () => {
    const row = (uid, alertAt) => ({ alertAt, data: { accountId: 'gmail', folder: 'INBOX', uid, from: 'a', subject: 's' } });
    const w = mailWorld();
    w.api.inboxAdopt(row(42, 12), { live: true, quiet: false });
    assert.deepStrictEqual(ids(w.notes), [['mail:gmail:INBOX:42', 12]]);
    assert.strictEqual(w.notes[0].silent, false);
    w.api.inboxAdopt(row(43, 0), { live: false, quiet: true });
    assert.deepStrictEqual(ids(w.notes)[1], ['mail:gmail:INBOX:43', 0]);
    assert.strictEqual(w.notes[1].silent, true);
    w.api.inboxAdopt(row(44, 13), {});
    assert.strictEqual(w.notes[2].silent, false, 'a browser catch-up as before');
});
check('mail while the inbox stacks it: one that came in live is left to the inbox, silent or not; a caught-up one is counted', () => {
    const row = { alertAt: 3, data: { accountId: 'gmail', folder: 'INBOX', uid: 9 } };
    const w = mailWorld({ stacked: true });
    assert.strictEqual(w.api.inboxAdopt(row, { arrived: true, live: false, quiet: true }), false, 'silent, came in live: the inbox shows it');
    assert.strictEqual(w.api.inboxAdopt(row, { arrived: true, live: true, quiet: false }), false);
    assert.strictEqual(w.api.inboxAdopt(row, { arrived: false, live: false, quiet: false }), true);
});
check('weather: wx:<alert id>', () => {
    const { notes, sh } = recorder();
    const window = { uiShell: 'mobile', wmShell: sh, localStorage: { getItem: () => null }, navigator: { language: 'en-GB' }, addEventListener() {}, wsClient: { on() {}, sendMessage: () => Promise.resolve() } };
    const document = { documentElement: { classList: { contains: () => true } }, dispatchEvent() {}, addEventListener() {}, getElementById: () => null };
    vm.runInNewContext(read('weatherAlerts.js'), { window, document, CustomEvent: class {}, Intl, Date, console });
    window.weatherAlerts._onIssued({ data: { alert: { id: 'jma-1', title: 'Flood Warning', severity: 'severe' }, place: { id: 'home', label: 'Home' } } });
    assert.deepStrictEqual(ids(notes), [['wx:jma-1', 0]]);
});
check('Lapis: lapis:<kind>, or lapis:<kind>:<key>, on both of its notes', () => {
    const { notes, sh } = recorder();
    const ctx = baseCtx({ ws: sh });
    vm.createContext(ctx);
    vm.runInContext(`
        const canUse = () => true; const isAdmin = () => true; const num = (v) => Number.isFinite(v);
        const runInfo = () => ({}); const state = { command: { runsUntil: 5 } }; let runNote = null;
        const esc = (t) => String(t); const holderKindOf = () => null; const open = () => {}; const send = () => {}; const doStop = () => {};
        const seenAlerts = () => []; const markSeen = () => {};
        ${cutAll('wmLapis.js', ['function onNotice(pk) {'])}
        this.onNotice = onNotice;
    `, ctx);
    ctx.onNotice({ data: { kind: 'run-left', title: '5 minutes left', until: 5 } });
    ctx.onNotice({ data: { kind: 'unlocked', title: 'The car is unlocked', actions: ['lock'] } });
    ctx.onNotice({ data: { kind: 'health', key: 'alerts', stamp: 'tire=1', title: 'Needs attention' } });
    ctx.onNotice({ data: { kind: 'service', key: 'maintenance', title: 'Maintenance is due' } });
    assert.deepStrictEqual(notes.map((n) => n.notice), ['lapis:run-left', 'lapis:unlocked', 'lapis:health:alerts', 'lapis:service:maintenance']);
    // the server's own rule, so the two cannot drift apart unseen
    const service = fs.readFileSync(path.join(__dirname, '..', 'modules/lapisService.js'), 'utf8');
    assert.ok(service.includes('const inboxId = extra && extra.key ? `lapis:${kind}:${extra.key}` : `lapis:${kind}`;'), 'lapisService names them this way');
});
check('Traffic\'s camera: cam:<the id it gives the app\'s own alert>', () => {
    const { notes, sh } = recorder();
    const alerts = [];
    const ctx = baseCtx({ ws: sh, window: { AndroidDriveWatch: { alert: (json) => { alerts.push(JSON.parse(json)); return false; } } } });
    vm.createContext(ctx);
    vm.runInContext(`
        const DriveLib = { alertText: () => ({ title: 'Speed camera ahead', text: '1 mi' }) };
        const camKey = (t) => t.id || \`\${t.lat},\${t.lon}\`;
        const esc = (t) => String(t); const open = () => {}; const openLayer = () => {};
        ${cutAll('wmTraffic.js', ['function cameraNote(t, aheadM) {'])}
        this.cameraNote = cameraNote;
    `, ctx);
    ctx.cameraNote({ id: 'cam-12' }, 1000);
    ctx.document.visibilityState = 'hidden';
    ctx.cameraNote({ lat: 1.5, lon: 2 }, 900);
    assert.deepStrictEqual(notes.map((n) => n.notice), ['cam:cam-12', 'cam:1.5,2']);
    assert.strictEqual(`cam:${alerts[0].id}`, notes[1].notice, 'the same id as the app\'s alert');
});

if (failed) { console.log(`test-wm-producer-notice-ids: ${failed} of ${step} FAILED`); process.exit(1); }
console.log('test-wm-producer-notice-ids: ok');
