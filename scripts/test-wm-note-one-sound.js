#!/usr/bin/env node
/**
 * One sound per notice, the page side (StaticForge #1367). A note that stands for an inbox notice asks the Android app
 * (AndroidInbox.takeSound(id, stamp, event, awake)) before it sounds: the app may have sounded that event already (the
 * page was asleep and resumes, or claims after the app's wait) or be the one to sound it (the page is not on screen).
 * Also the app's repeat: the page tells it to stop (AndroidInbox.hush) when it puts that notice's bubble away.
 *
 * Runs the real appNote, readToasts, orderNotes, refreshNotes and the notification sound block cut out of wmShell.js,
 * with the real wmNotificationInbox.js on top of them, in one fake phone page. playSystemSound (which buzzes too) is a
 * recorder: nothing sounds.
 *
 *   node scripts/test-wm-note-one-sound.js [path/to/wmShell.js [path/to/wmNotificationInbox.js]]
 *
 * The optional paths are for proving the checks can fail (copies without the change).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHELL = process.argv[2] || path.join(__dirname, '..', 'public/scripts/comp/wmShell.js');
const INBOX = process.argv[3] || path.join(__dirname, '..', 'public/scripts/comp/wmNotificationInbox.js');
const src = fs.readFileSync(SHELL, 'utf8');
const inboxSrc = fs.readFileSync(INBOX, 'utf8');

/** From a start marker up to (and with) the end marker; without one, to the function's closing brace. */
function cut(marker, endMarker) {
    const from = src.indexOf(marker);
    assert(from > 0, `marker not found in ${SHELL}: ${marker}`);
    const end = endMarker || '\n    }\n';
    const to = src.indexOf(end, from);
    assert(to > from, `end not found after: ${marker}`);
    return src.slice(from, endMarker ? to : to + end.length);
}
const line = (marker) => cut(marker, '\n');
const optionalLine = (marker) => (src.includes(marker) ? line(marker) : '');

const code = [
    line('    const seenKey = (id, n) => '),
    cut('    function awake() {'),
    cut('    function readToasts() {'),
    line('    const NOTE_FRESH_MS = '),
    line('    const noteBorn = new Map();'),
    cut('    function orderNotes(list) {'),
    line('    const noteOf = (id) => '),
    line('    const noteShownNote = () => '),
    optionalLine('    const noteDeskEvent = (id) => '),
    cut('    function refreshNotes() {'),
    cut('    function noteEvent(n) {'),
    cut('    const noteSounded = new Set();', '    /** Display message on screen off for its class'),
    cut('    function showNote(id) {'),
    cut('    function hideNote() {'),
    cut('    function dismissNote(n) {'),
    line('    const appNotes = new Map();'),
    cut('    function appNote(opts = {}) {'),
    'this.api = { appNote, refreshNotes, showNote, hideNote, dismissNote, shown: () => noteShownNote(), notes: () => notes };',
].join('\n');

const EVENTS = [
    { id: 'reminder', kind: 'note' }, { id: 'weather-severe', kind: 'note' }, { id: 'sms', kind: 'note' }, { id: 'chat', kind: 'note' },
    { id: 'notification', kind: 'note' }, { id: 'error', kind: 'event' }, { id: 'warning', kind: 'event' }, { id: 'director', kind: 'note' },
    { id: 'mail', kind: 'note' }, { id: 'lapis-unlocked', kind: 'note' },
];
const REPEATS = new Set(['reminder', 'weather-severe']);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };

/**
 * One phone page. o.bridge: 'arbiter' (default: the contract's app), 'old' (no takeSound / hush), 'throws', 'none'.
 * The arbiter answers 'app' for an event it has sounded (appSounded 'id|stamp') and for a page not on screen.
 */
function world(o = {}) {
    const sounds = [];
    const asked = [];
    const hushed = [];
    const confirmed = [];
    const intervals = new Map();
    const handlers = new Map();
    const appSounded = new Set(o.appSounded || []);
    let listed = [];
    let seq = 0;
    let timer = 0;
    const toasts = []; // newest first, as toastManager prepends
    const el = (title, html) => {
        const parts = { '.toast-title': { textContent: title }, '.toast-message': { textContent: html, innerHTML: html }, '.toast-content': { appendChild() {} }, '.toast-close': {} };
        const t = {
            id: `toast-${++seq}`, isConnected: true, dataset: {}, className: 'glass-toast glass-toast-info',
            classList: { contains: () => false },
            querySelector: (sel) => parts[sel] || null,
            querySelectorAll: () => [],
            addEventListener() {},
        };
        return t;
    };
    const root = { dataset: {} };
    const document = {
        hidden: false,
        documentElement: { classList: { contains: () => true }, dataset: root.dataset },
        querySelectorAll: () => [],
        addEventListener() {},
        createElement: () => ({ className: '', innerHTML: '' }),
        getElementById: (id) => (id === 'toastContainer' ? { children: toasts } : toasts.find((t) => t.id === id) || null),
    };
    const bridge = {};
    bridge.shown = (id) => confirmed.push(id);
    if (o.bridge !== 'old') {
        bridge.takeSound = (id, stamp, event, awake) => {
            asked.push([id, stamp, event, awake]);
            if (o.bridge === 'throws') throw new Error('bridge gone');
            // (a note that does not know the notice's alertAt sends minus the time it was made: '0' in these lists)
            if (appSounded.has(`${id}|${Number(stamp) > 0 ? stamp : '0'}`) || !awake) return 'app';
            return 'page';
        };
        bridge.hush = (id) => hushed.push(id);
    }
    const window = {
        uiShell: 'mobile',
        AndroidInbox: o.bridge === 'none' ? undefined : bridge,
        AndroidNotification: {},
        addEventListener() {},
        showGlassToast: (_type, title, html) => { const t = el(title, html); toasts.unshift(t); return t.id; },
        removeGlassToast: (id) => { const i = toasts.findIndex((t) => t.id === id); if (i >= 0) { toasts[i].isConnected = false; toasts.splice(i, 1); } },
        wsClient: {
            isConnected: () => true,
            on: (type, fn) => handlers.set(type, fn),
            sendMessage: (type) => Promise.resolve(type === 'inbox_list' ? { data: { notices: listed, total: listed.length } } : {}),
        },
    };
    const ctx = {
        window, document, root,
        localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        shell: {}, SND_EVENT: new Map(EVENTS.map((e) => [e.id, e])),
        eventPrefs: (id) => ({ sound: 'x.wav', repeat: REPEATS.has(id), display: true, vibrate: true }),
        playSystemSound: (id, opts = {}) => { sounds.push(opts.again ? `${id} again` : id); return Promise.resolve(true); },
        shellHold() {},
        setInterval: (fn) => { intervals.set(++timer, fn); return timer; },
        clearInterval: (id) => { intervals.delete(id); },
        setTimeout: () => 0, clearTimeout() {},
        appScopeSignal: undefined,
        o,
        console, Date, Promise, JSON, Map, Set, WeakSet, String, Number, Array, Object, Math,
    };
    vm.createContext(ctx);
    // the shell's state the cut functions read; queueNotes only marks the pass, the test runs it (flushNotes)
    vm.runInContext(`
        let notes = [];
        let noteShown = null;
        let noteTrayOpen = false;
        let noteKeysFor = '';
        let homeQuietUntil = 0;
        let statusFolded = [];
        const noteSeen = new Set();
        const updateNoteIds = new Set();
        const toastSeen = new WeakSet();
        const escapeHtml = (t) => String(t);
        const LATENCY_TOAST = /^high latency/i;
        const PRINT_DONE_TOAST = /^generation complete/i;
        const UPDATE_QUIET = /^(checking for updates|downloading updates|up to date)/i;
        const isUpdateNote = () => false;
        const notesMayPop = () => !o.takeover;
        const notesForBubbleIcon = () => notes;
        const noteDisplays = (n) => !(o.noDisplay || []).includes(noteEvent(n));
        const toastsToDialogs = () => {};
        const paintBezelLed = () => {};
        const renderNotes = () => {};
        const noteSoftKeys = () => ({});
        const renderSoftKeys = () => {};
        const closeBubble = () => {};
        const queueNotes = () => {};
        ${code}
    `, ctx, { filename: 'wmShell.js (cut)' });
    const api = ctx.api;
    const w = {
        sounds, asked, hushed, confirmed, intervals, appSounded, document, root, window, api,
        run: () => api.refreshNotes(),
        /** A note up and the pass the shell runs after it. */
        note(opts) { const h = api.appNote(Object.assign({ title: 'T', html: 'x' }, opts)); api.refreshNotes(); return h; },
        /** The real inbox script on this page's wmShell. */
        async inbox() {
            window.wmShell = { appNote: (opts) => api.appNote(opts) };
            vm.runInContext(inboxSrc, ctx, { filename: 'wmNotificationInbox.js' });
            await flush();
        },
        async resume(rows) { listed = rows; await window.wmNotificationInbox.catchUp(); await flush(); api.refreshNotes(); },
        push(notice) { handlers.get('inbox_updated')({ data: { reason: 'new', notice } }); api.refreshNotes(); },
        /** The page's own repeat interval, run to its end. */
        runRepeats() { let guard = 20; while (intervals.size && guard--) for (const fn of [...intervals.values()]) fn(); },
    };
    return w;
}

const ALERT_AT = 1700000000000;
const reminder = (extra) => Object.assign({ id: 'rem:1', cls: 'reminder', title: '12:00 | Reminder', text: 'Dentist', state: 'new', createdAt: ALERT_AT, alertAt: ALERT_AT, data: {} }, extra || {});
const server = (id, cls, kind, extra) => Object.assign({ id, cls, title: `Title ${id}`, text: 'text', state: 'new', createdAt: ALERT_AT, alertAt: ALERT_AT, data: { kind } }, extra || {});

let step = 0;
let failed = 0;
async function check(name, fn) {
    ++step;
    try { await fn(); console.log(`  ${step}. ok   ${name}`); } catch (e) { failed++; console.log(`  ${step}. FAIL ${name}\n       ${String(e && e.message).split('\n').join('\n       ')}`); }
}

async function main() {
    // ---- defect 1: the resume ----
    await check('resume: a notice the app sounded while the page slept comes up without a second sound or repeat', async () => {
        const w = world({ appSounded: [`rem:1|${ALERT_AT}`, `director:s:turn|${ALERT_AT}`] });
        await w.inbox();
        await w.resume([reminder()]);
        assert.strictEqual(w.api.notes().length, 1, 'its box is up');
        assert.deepStrictEqual(w.sounds, [], 'no sound and no buzz from the page');
        assert.strictEqual(w.intervals.size, 0, 'no page repeat');
        assert.deepStrictEqual(w.asked, [['rem:1', String(ALERT_AT), 'reminder', true]], 'asked with the id, alertAt, the event, awake');
        w.run(); w.run();
        assert.strictEqual(w.asked.length, 1, 'asked once, never per pass');
        await w.resume([server('director:s:turn', 'director', 'director')]);
        assert.deepStrictEqual(w.sounds, [], 'a server-only notice the same');
        assert.strictEqual(w.asked.length, 2);
    });
    await check('resume: a notice the app has not sounded still sounds, once', async () => {
        const w = world();
        await w.inbox();
        await w.resume([server('director:s:turn', 'director', 'director')]);
        assert.deepStrictEqual(w.sounds, ['director']);
        await w.resume([server('director:s:turn', 'director', 'director')]);
        assert.deepStrictEqual(w.sounds, ['director'], 'not again at the next resume');
    });
    // ---- defect 2: the late claim ----
    await check('late claim: a live packet the app already sounded stays silent on the page', async () => {
        const w = world({ appSounded: [`director:s:turn|${ALERT_AT}`] });
        await w.inbox();
        w.push(server('director:s:turn', 'director', 'director', { alert: true }));
        assert.strictEqual(w.api.notes().length, 1);
        assert.deepStrictEqual(w.sounds, []);
    });
    await check('a page that runs but is not on screen (screen off, behind a program) asks with awake false and stays silent', async () => {
        const before = Date.now();
        for (const mark of ['screenOff', 'wmBehind']) {
            const w = world();
            w.root.dataset[mark] = '';
            w.note({ event: 'sms', notice: 'sms:a:c' });
            assert.deepStrictEqual([w.asked.length, w.asked[0][0], w.asked[0][2], w.asked[0][3]], [1, 'sms:a:c', 'sms', false]);
            const made = -Number(w.asked[0][1]);
            assert.ok(made >= before && made <= Date.now(), `a program's note with no alertAt sends minus the time it was made (${w.asked[0][1]})`);
            assert.deepStrictEqual(w.sounds, []);
        }
    });
    await check('page takes it: sounds once and repeats itself as before, asking once, never hushing', async () => {
        const w = world();
        const h = w.note({ event: 'reminder', notice: 'rem:2', noticeAt: 5 });
        assert.deepStrictEqual(w.sounds, ['reminder']);
        w.runRepeats();
        assert.deepStrictEqual(w.sounds, ['reminder', 'reminder again', 'reminder again', 'reminder again', 'reminder again']);
        assert.strictEqual(w.asked.length, 1, 'a repeat does not ask');
        h.hide();
        h.close();
        assert.deepStrictEqual(w.hushed, []);
    });
    await check('no bridge, an older app without takeSound, or a failing call: the page sounds as before', async () => {
        for (const bridge of ['none', 'old', 'throws']) {
            const w = world({ bridge });
            const h = w.note({ event: 'reminder', notice: 'rem:3', noticeAt: 5 });
            assert.deepStrictEqual(w.sounds, ['reminder'], bridge);
            assert.strictEqual(w.intervals.size, 1, `${bridge}: with its repeat`);
            h.hide();
            assert.deepStrictEqual(w.hushed, [], bridge);
        }
    });
    await check('a note of the page\'s own is never asked about; silent and status notes neither', async () => {
        const w = world({ appSounded: ['x|0'] });
        w.note({ event: 'notification' });
        assert.deepStrictEqual(w.sounds, ['notification']);
        w.note({ title: 'quiet', event: 'sms', notice: 'sms:q', silent: true });
        w.note({ title: 'status', event: 'system', notice: 'system:s' });
        assert.deepStrictEqual(w.asked, []);
        assert.deepStrictEqual(w.sounds, ['notification']);
    });
    await check('a batch: one passed over because the app has it does not swallow the sound of the next note', async () => {
        const w = world({ appSounded: ['sms:new|0'] });
        w.api.appNote({ title: 'local', html: 'copy done', event: 'chat' });
        w.api.appNote({ title: 'text', html: 'hi', event: 'sms', notice: 'sms:new' }); // newest: first in the list
        w.run();
        assert.deepStrictEqual(w.asked.map((a) => a[0]), ['sms:new']);
        assert.deepStrictEqual(w.sounds, ['chat']);
    });
    await check('a note without alertAt keeps the time it was made, however late it is asked (the screen off, timers paused)', async () => {
        const w = world();
        const before = Date.now();
        w.api.appNote({ title: 'wx', html: 'x', event: 'weather-alert', notice: 'wx:late' });
        const after = Date.now();
        while (Date.now() < after + 25) { /* the page's timers paused */ }
        w.run();
        const made = -Number(w.asked[0][1]);
        assert.ok(made >= before && made <= after, `the time the note was made, not the time it asked (${made - before} ms after)`);
    });
    await check('a batch: an error is the first candidate, and one sound only', async () => {
        const w = world();
        w.api.appNote({ title: 'n', html: '1', event: 'sms', notice: 'sms:1' });
        const e = w.api.appNote({ title: 'e', html: '2', event: 'error', notice: 'err:1' });
        w.api.appNote({ title: 'm', html: '3', event: 'chat', notice: 'chat:1' });
        w.document.getElementById(e.id).className = 'glass-toast glass-toast-error';
        w.run();
        assert.deepStrictEqual(w.asked.map((a) => a[0]), ['err:1']);
        assert.deepStrictEqual(w.sounds, ['error']);
    });
    await check('alike toasts merged into one entry: every fresh notice in it is asked about until one is the page\'s', async () => {
        const w = world({ appSounded: ['mail:b|0', 'mail:a|0'] });
        w.api.appNote({ title: 'New E-mail Message', html: 'same', event: 'mail', notice: 'mail:a' });
        w.api.appNote({ title: 'New E-mail Message', html: 'same', event: 'mail', notice: 'mail:b' });
        w.run();
        assert.strictEqual(w.api.notes().length, 1, 'one entry');
        assert.deepStrictEqual(w.asked.map((a) => a[0]), ['mail:b', 'mail:a']);
        assert.deepStrictEqual(w.sounds, []);
    });
    await check('update() changes the notice a note stands for before it is heard', async () => {
        const w = world({ appSounded: ['stack:fleetdone|9'] });
        const h = w.api.appNote({ title: 'a', html: 'b', event: 'notification' });
        h.update({ notice: 'stack:fleetdone', noticeAt: 9 });
        w.run();
        assert.deepStrictEqual(w.asked, [['stack:fleetdone', '9', 'notification', true]]);
        assert.deepStrictEqual(w.sounds, []);
    });

    // ---- the app's repeat ----
    const appHas = (id, at = 0) => ({ appSounded: [`${id}|${at}`] });
    await check('hush: once, when a repeating notice\'s bubble was up and is hidden', async () => {
        const w = world(appHas('rem:4'));
        const h = w.note({ event: 'reminder', notice: 'rem:4' });
        assert.ok(h.shown(), 'popped');
        w.run(); w.run();
        assert.deepStrictEqual(w.hushed, [], 'not while it is up');
        h.hide();
        assert.deepStrictEqual(w.hushed, ['rem:4']);
        h.show(); h.hide(); h.close();
        assert.deepStrictEqual(w.hushed, ['rem:4'], 'once');
    });
    await check('hush: a bubble popped while nothing of the page is seen is not one she saw', async () => {
        const w = world(appHas('rem:10'));
        w.root.dataset.screenOff = '';
        const h = w.note({ event: 'reminder', notice: 'rem:10' });
        assert.ok(h.shown(), 'the page popped it with the screen off');
        h.close();
        assert.deepStrictEqual(w.hushed, [], 'the app goes on repeating');
    });
    await check('hush: closed or dismissed while up', async () => {
        const a = world(appHas('wx:1'));
        a.note({ event: 'weather-severe', notice: 'wx:1' }).close();
        assert.deepStrictEqual(a.hushed, ['wx:1']);
        const b = world(appHas('wx:2'));
        b.note({ event: 'weather-severe', notice: 'wx:2' });
        b.api.dismissNote(b.api.shown());
        assert.deepStrictEqual(b.hushed, ['wx:2']);
    });
    await check('hush: never merely because it has not popped (another bubble up, Display off, a takeover)', async () => {
        const w = world(appHas('rem:5'));
        const first = w.note({ title: 'first', event: 'sms' });
        const waiting = w.note({ title: 'waiting', event: 'reminder', notice: 'rem:5' });
        assert.ok(first.shown() && !waiting.shown());
        w.run(); w.run();
        assert.deepStrictEqual(w.hushed, []);
        waiting.close();
        assert.deepStrictEqual(w.hushed, [], 'closed unpopped: no hush');
        const off = world(Object.assign(appHas('rem:6'), { noDisplay: ['reminder'] }));
        off.note({ event: 'reminder', notice: 'rem:6' });
        off.run();
        assert.deepStrictEqual(off.hushed, []);
        const busy = world(Object.assign(appHas('rem:9'), { takeover: true }));
        busy.note({ event: 'reminder', notice: 'rem:9' }).close();
        assert.deepStrictEqual([busy.asked, busy.hushed, busy.sounds], [[], [], []], 'during a takeover: not asked, not hushed');
    });
    await check('hush: a waiting one is hushed after it popped and was put away', async () => {
        const w = world(appHas('rem:7'));
        const first = w.note({ title: 'first', event: 'sms' });
        const waiting = w.note({ title: 'waiting', event: 'reminder', notice: 'rem:7' });
        first.close();
        assert.ok(waiting.shown());
        assert.deepStrictEqual(w.hushed, []);
        waiting.hide();
        assert.deepStrictEqual(w.hushed, ['rem:7']);
    });
    await check('hush: not for a class that does not repeat', async () => {
        const w = world(appHas('sms:z'));
        w.note({ event: 'sms', notice: 'sms:z' }).hide();
        assert.deepStrictEqual(w.hushed, []);
    });
    await check('hush: a box drawn again (close replaced) is not put away; hiding the new one hushes once', async () => {
        const w = world(appHas('rem:8'));
        const h = w.note({ title: 'one', event: 'reminder', notice: 'rem:8' });
        h.close({ replaced: true });
        assert.deepStrictEqual(w.hushed, []);
        const again = w.note({ title: 'two', event: 'reminder', notice: 'rem:8', silent: true });
        assert.deepStrictEqual(w.hushed, []);
        again.hide();
        assert.deepStrictEqual(w.hushed, ['rem:8']);
    });
    await check('hush: the inbox drawing a box again (news under its id, the holder\'s tap) does not hush; Dismiss there does', async () => {
        const w = world({ appSounded: [`rem:1|${ALERT_AT}`, `rem:1|${ALERT_AT + 1}`] });
        await w.inbox();
        await w.resume([reminder()]);
        w.push(reminder({ alert: true, alertAt: ALERT_AT + 1, text: 'Dentist, again' }));
        assert.deepStrictEqual(w.hushed, [], 'news under the id');
        w.window.wmNotificationInbox.showOne(reminder({ alertAt: ALERT_AT + 1 }));
        w.run();
        assert.deepStrictEqual(w.hushed, [], 'asked for again from the holder');
        w.window.wmNotificationInbox.clear('nothing');
        w.api.dismissNote(w.api.shown());
        assert.deepStrictEqual(w.hushed, ['rem:1']);
        assert.deepStrictEqual(w.sounds, []);
    });

    await check('View on the app\'s box (the bar tap notice:<id>) ends the app\'s repeat of that notice, and nothing else does', async () => {
        const hushed = [];
        const ctx = { window: { AndroidInbox: { hush: (id) => hushed.push(id) } } };
        vm.createContext(ctx);
        vm.runInContext(`${cut('    function barsViewedNotice(role) {')}\nthis.f = barsViewedNotice;`, ctx);
        for (const role of ['notice:rem:1', 'notice:', 'open:mail', 'lock', 'shown', undefined]) ctx.f(role);
        assert.deepStrictEqual(hushed, ['rem:1']);
        assert.ok(/function barsTap\(role\) \{\n\s+barsViewedNotice\(role\);/.test(src), 'every bar tap goes through it first');
        const old = { window: {} };
        vm.createContext(old);
        vm.runInContext(`${cut('    function barsViewedNotice(role) {')}\nthis.f = barsViewedNotice;`, old);
        old.f('notice:rem:2'); // an older app: nothing to call, no throw
    });

    if (failed) { console.log(`test-wm-note-one-sound: ${failed} of ${step} FAILED`); process.exit(1); }
    console.log('test-wm-note-one-sound: ok');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
