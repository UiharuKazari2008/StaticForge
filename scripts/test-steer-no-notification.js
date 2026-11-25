#!/usr/bin/env node
'use strict';
/**
 * #1168: steering a Director / Fleet session raises NO notification, and a Director turn raises none while she
 * watches that chat and exactly one when she is away.  node scripts/test-steer-no-notification.js
 *
 * Drives the real paths and hooks notificationInbox.publish (the one place a phone notice starts):
 *   - Fleet: claude_session_send (claudeFleetMcp -> launcher.steer) and the inbox steer (314-claudeDeskHandler
 *     claude_desk_coord post kind steer -> launcher.steer + markDelivered) with tmux stubbed;
 *   - Director: a real Xi run (xiDirector startTail -> finishRun -> cursorDirector.broadcastDirectorStatus ->
 *     notificationInboxSources.onDirectorStatus), ended normally, ended by a steer (directorImpl director_abort steer),
 *     with and without a page watching the chat (clientInfo.directorWatch, the page's on-screen chat);
 *   - the page (public/scripts/comp/wmDirector.js, loaded whole in a fake page): its own "replied in" toast.
 * Before the fix (measured against HEAD, #1168): one steer = 1 emit (the cut turn's "finished" notice) + 1 page toast;
 * one turn = 1 emit while she watched it, plus a page toast when the page was hidden or another app was open; i.e. 2.
 * After: steer 0 + 0, watched turn 0 + 0, away turn 1 + 0. Real events still notify: a question, an erroring turn,
 * a turn finished while she is away or asleep / hidden / locked / idle / on another chat.
 *
 * PREFIX_SOURCES=<dir with HEAD's notificationInboxSources.js> PREFIX_PAGE=<HEAD's wmDirector.js> PRINT_ONLY=1 prints the
 * same counts for the old code instead of asserting (how the pre-fix numbers above were taken).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'steer-no-notice-'));
process.env.HOME = SANDBOX;
process.env.XI_TURN_END_GRACE_MS = '300';
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = path.join(SANDBOX, 'claude-home');
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(SANDBOX, 'store');
process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET = 'steer-no-notice-test';
process.env.DREAMSCAPE_CLAUDE_DESK_STATE = path.join(SANDBOX, 'state');
process.env.DREAMSCAPE_CLAUDE_CLI = '/opt/test/claude';
process.env.DREAMSCAPE_CLAUDE_COORD_MCP = '0';
process.env.AGENT_COORD_DB = path.join(SANDBOX, 'coord', 'coord.db');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* gone */ } });

const PRINT = process.env.PRINT_ONLY === '1';
let mismatches = 0;
const eq = (actual, expected, msg) => {
    if (PRINT) { console.log(`${actual === expected ? 'same ' : 'DIFF '} ${msg}: ${actual} (fixed code: ${expected})`); if (actual !== expected) mismatches += 1; return; }
    assert.strictEqual(actual, expected, msg);
};

// the old notificationInboxSources (HEAD), put in the module cache so cursorDirector's require gets it
if (process.env.PREFIX_SOURCES) {
    const file = path.join(ROOT, 'modules', 'notificationInboxSources.js');
    const old = fs.readFileSync(path.join(process.env.PREFIX_SOURCES, 'notificationInboxSources.js'), 'utf8').replace("require('./notificationInbox')", `require(${JSON.stringify(path.join(ROOT, 'modules', 'notificationInbox'))})`);
    const m = new (require('module'))(file, module);
    m.filename = file;
    m.paths = require('module')._nodeModulePaths(path.dirname(file));
    m._compile(old, file);
    require.cache[require.resolve(file)] = m;
    m.loaded = true;
}

const inbox = require('../modules/notificationInbox');
const activeSync = require('../modules/activeSync');
const src = require('../modules/notificationInboxSources');
const xi = require('../modules/xiDirector');
const cursor = require('../modules/cursorDirector');
const directorImpl = require('../modules/ws/handlers/directorImpl');
const launcher = require('../modules/claudeSessionLauncher');
const claudeSessions = require('../modules/claudeSessions');
const fleetMcp = require('../modules/claudeFleetMcp');
const coord = require('../modules/agentCoord/store');
const desk = require('../modules/ws/handlers/314-claudeDeskHandler');

// ---- the hook: every notice that starts, with where it came from
const emits = [];
const realPublish = inbox.publish;
inbox.publish = (n) => {
    const from = new Error().stack.split('\n').slice(2, 5).map((l) => l.trim().replace(/^at /, '').replace(ROOT + '/', '')).join(' < ');
    emits.push({ id: n.id, text: n.text, from });
    return realPublish(n);
};
activeSync.sendInboxNotice = () => 1;
activeSync.sendInboxCleared = () => 1;
const emitIds = () => emits.map((e) => e.id);
const take = () => emits.splice(0).map((e) => e.id);

// ---- the websocket server the inbox and the status broadcast see: its clients are the pages
const clients = new Map();
const packets = [];
const gr = {
    initialized: true,
    getPath: () => path.join(SANDBOX, 'images'),
    getConfig: () => ({ xi: { enabled: true } }),
    getWebSocketServer: () => ({ clients, broadcast: (p) => packets.push(p) }),
    getApiKeyManager: () => ({ getKey: () => null })
};
inbox.bind(gr);
const L = xi._test.layout();
fs.mkdirSync(L.runs, { recursive: true });
fs.mkdirSync(L.chats, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'images'), { recursive: true });
xi._test.setBoundGr(gr);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) { const until = Date.now() + ms; while (Date.now() < until) { if (fn()) return true; await sleep(40); } return fn(); }

/** A page of the household: signed in, awake, at its desktop, with `watch` on screen (the chat directorWatch names). */
function page(watch, extra) {
    const info = Object.assign({ authenticated: true, userType: 'admin', userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-F966U) Mobile', lastActivity: new Date(), desktopState: 'desktop', directorWatch: watch }, extra || {});
    clients.set({ readyState: 1 }, info);
    return info;
}

// ---- a real Xi run: a fake agent that writes a reply (and its terminal result when asked), then lingers
function startXiRun(id, { result }) {
    const draftId = `d-${id}`;
    const log = path.join(SANDBOX, `${id}.log`);
    fs.writeFileSync(log, '');
    const index = xi._test.readIndex();
    index.chats.push({ id, name: `Turn ${id}`, runtime: 'claude', messages: [{ id: draftId, role: 'assistant', content: '', data: { Description: '' } }], inflight: { draftId } });
    xi._test.writeIndex(index);
    const lines = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'All done.' }] } }];
    if (result) lines.push({ type: 'result', subtype: 'success', is_error: false, result: 'All done.' });
    const code = `const fs=require('fs');${JSON.stringify(lines)}.forEach((l)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(l)+'\\n'));setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore' });
    child.unref();
    const metaPath = path.join(L.runs, `${id}.json`);
    const meta = { pid: child.pid, sessionId: id, log, draftId, name: `Turn ${id}`, runtime: 'claude', requestId: `req-${id}`, metaPath };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    xi._test.startTail(meta);
    cursor.broadcastDirectorStatus(gr); // the turn's start, as handleDirectorSendMessage does
    return { pid: child.pid, metaPath };
}
const statusTold = (n) => packets.filter((p) => p.type === 'director_computer_status').length >= n;

async function xiTurn(id, { watch, steer }) {
    src._test.reset();
    clients.clear();
    if (watch) page(id);
    packets.length = 0;
    emits.length = 0;
    const run = startXiRun(id, { result: !steer });
    await waitFor(() => statusTold(1), 3000);
    await sleep(150); // the start status reaches onDirectorStatus
    if (steer) {
        // the page's Steer: director_abort steer: true (the transcript row is the record), then the new text
        const sent = [];
        const handler = { globalResources: gr, sendToClient: (w, m) => sent.push(m), sendError: (w, m) => sent.push({ error: m }) };
        await directorImpl.handleDirectorAbort(handler, {}, { type: 'director_abort', sessionId: id, persona: 'xi', steer: true, requestId: `abort-${id}` }, { userType: 'admin' });
        assert.ok(sent.some((m) => m.data && m.data.aborted === true), 'the abort stopped the run');
    }
    const ended = await waitFor(() => !fs.existsSync(run.metaPath) && statusTold(2), 5000);
    assert.ok(ended, `the Xi turn ${id} ended`);
    await sleep(400); // broadcastDirectorStatus is async
    return { emitted: take(), packets: packets.slice() };
}

// ---- the page: wmDirector.js in a fake page; its toast is a notification on the phone
function pageToasts(file) {
    const noop = () => {};
    const handlers = new Map();
    const toasts = [];
    const timers = [];
    const dirInst = { _status: null, directorSessions: [] };
    const document = { hidden: false, documentElement: { classList: { contains: (c) => c === 'ui-mobile' }, dataset: {} }, addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), body: {} };
    const wmShell = new Proxy({ current: 'messaging', registerApp: noop }, { get: (t, k) => (k in t ? t[k] : noop) });
    const win = { uiShell: 'mobile', wmShell, directorInstance: dirInst, addEventListener: noop, dispatchEvent: noop, wsClient: { on: (t, fn) => { if (!handlers.has(t)) handlers.set(t, []); handlers.get(t).push(fn); } } };
    const ctx = {
        window: win, document, localStorage: { getItem: () => null, setItem: noop }, setTimeout: (fn) => { timers.push(fn); return 1; }, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
        console, showGlassToast: (...a) => toasts.push(a), Date, JSON, Map, Set, Promise, Object, Array, String, Number, Math, CustomEvent: function () {}, requestAnimationFrame: noop,
        getComputedStyle: () => ({}), MutationObserver: function () { this.observe = noop; }, ResizeObserver: function () { this.observe = noop; }, Event: function () {}
    };
    win.showGlassToast = ctx.showGlassToast;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'wmDirector.js' });
    const fire = (type, msg) => (handlers.get(type) || []).forEach((fn) => { try { fn(msg); } catch (_) { /* a refresh on the fake page */ } });
    const flush = () => timers.splice(0).forEach((fn) => { try { fn(); } catch (_) { /* fake page */ } });
    return {
        toasts, document,
        status(s) { dirInst._status = s; fire('director_computer_status', { type: 'director_computer_status', data: s }); flush(); },
        steerResponse(id) { fire('director_message_response', { type: 'director_message_response', data: { success: true, sessionId: id, steer: true } }); }
    };
}

(async () => {
    // =========================================================== Fleet steer entry points (tmux stubbed)
    const SID = '11111111-2222-3333-4444-555555555555';
    const typed = [];
    launcher._setRunner(async (cmd, args) => {
        if (cmd === 'tmux' && args.includes('list-panes')) return { code: 0, stdout: `%1 ${process.pid}\n`, stderr: '' };
        if (cmd === 'tmux' && (args.includes('send-keys') || args.includes('set-buffer') || args.includes('paste-buffer'))) typed.push(args.join(' '));
        return { code: 0, stdout: '', stderr: '' };
    });
    claudeSessions.liveSessions = () => [{ id: SID, pid: process.pid, status: 'busy', cwd: ROOT, origin: 'fleet' }];

    emits.length = 0;
    const r1 = await fleetMcp._test.dispatch(gr, 'claude_session_send', { session: SID, text: 'please also run the checks' });
    assert.strictEqual(r1.sent, true, 'claude_session_send typed the steering message in');
    assert.ok(typed.some((t) => t.includes('send-keys')), 'tmux got the keys');
    eq(emits.length, 0, 'claude_session_send raises no notification (was 0: the Fleet path never notified)');
    emits.length = 0;

    const agent = coord.upsertAgent({ id: `claude-${SID.slice(0, 8)}`, kind: 'claude', name: 'Fleet worker', task: 'work', sessionId: SID, pid: process.pid });
    const sent = [];
    const ctx = { globalResources: gr, sendToClient: (w, m) => sent.push(m), sendError: (w, m) => sent.push({ error: m }) };
    await desk._handlers.handleCoord(ctx, {}, { requestId: 'c1', action: 'post', to: agent.id, body: 'use the new helper', kind: 'steer' }, { userType: 'admin', username: 'yukimi' });
    const posted = sent.find((m) => m.type === 'claude_desk_coord_response');
    assert.ok(posted && posted.data.sent.delivered === 'tmux', 'the inbox steer was typed into the session and marked delivered (tmux)');
    eq(emits.length, 0, 'the inbox steer raises no notification (was 0: the Fleet path never notified)');

    // =========================================================== Director: real Xi turns
    // a turn nobody watches (she is away): exactly one "turn is finished"
    let r = await xiTurn('chat-away', { watch: false });
    eq(r.emitted.join(','), 'director:chat-away:turn', 'a turn finished while she is away: exactly one notice');
    // a turn she watches on a live page: none
    r = await xiTurn('chat-watched', { watch: true });
    eq(r.emitted.length, 0, `a turn she watches on a live page: no notice (${r.emitted.join(',') || 'none'})`);
    // a steer cut: none, watched or not (the old code announced the cut turn)
    r = await xiTurn('chat-steer', { watch: false, steer: true });
    eq(r.emitted.length, 0, `a steer (page away): no notice (${r.emitted.join(',') || 'none'})`);
    r = await xiTurn('chat-steer-w', { watch: true, steer: true });
    eq(r.emitted.length, 0, `a steer (page watching): no notice (${r.emitted.join(',') || 'none'})`);
    // the turn the steer started finishes normally afterwards: still one notice when she is away
    src._test.reset();
    emits.length = 0;
    src.onDirectorStatus({ running: false, xi: { running: true, sessionId: 'chat-after', sessionName: 'After steer' } });
    (src.noteSteer || (() => {}))('chat-after');
    src.onDirectorStatus({ running: false, xi: { running: false } });
    src.onDirectorStatus({ running: false, xi: { running: true, sessionId: 'chat-after', sessionName: 'After steer' } });
    src.onDirectorStatus({ running: false, xi: { running: false } });
    eq(take().join(','), 'director:chat-after:turn', 'the steered chat\'s next turn end notifies once');

    // =========================================================== presence rules (status driven)
    const turn = (sid, name, last) => {
        src.onDirectorStatus({ running: false, xi: { running: true, sessionId: sid, sessionName: name } });
        src.onDirectorStatus({ running: false, xi: { running: false }, last });
        return take();
    };
    src._test.reset();
    clients.clear();
    const away = (label, setup) => {
        clients.clear();
        setup();
        eq(turn('p1', 'Presence').join(','), 'director:p1:turn', `notifies: ${label}`);
    };
    away('no page connected', () => {});
    away('the page watches another chat', () => page('other-chat'));
    away('the page has no chat on screen (hidden / Director closed: directorWatch empty)', () => page(''));
    away('the page sleeps (client_dormant on a phone page)', () => page('p1', { dormant: true, phone: { shell: 'mobile' } }));
    away('the page is locked (desktopState locked)', () => page('p1', { desktopState: 'locked' }));
    away('the page is not signed in', () => page('p1', { authenticated: false }));
    away('the page was last heard from 11 minutes ago', () => page('p1', { lastActivity: new Date(Date.now() - 11 * 60 * 1000) }));
    away('a test tab (dev_admin) watches it', () => page('p1', { userType: 'dev_admin' }));
    away('only the Android app\'s background link is connected', () => page('p1', { as: { speaker: 'service' } }));
    away('an agent\'s bound test tab (HeadlessChrome) watches it', () => page('p1', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/140 Safari/537.36' }));
    clients.clear();
    page('p1');
    eq(turn('p1', 'Presence').length, 0, 'silent: an awake household page watches this chat');
    // two clients, one household (#1168 follow-up; the shapes are what the live server held, read through the inspector): the
    // phone's DeX window shows the chat, the phone's own shell page shows none, service links and a device frame idle beside
    const household = (watching) => {
        clients.clear();
        page('', { desktopState: 'ready', phone: { shell: 'mobile' }, as: { speaker: 'webview' }, clientId: 'dbf4f3' }); // the phone's shell page
        page(watching, { desktopState: 'desktop', as: { speaker: 'webview' }, clientId: 'd28099' }); // the DeX window (a desktop page on the Fold)
        page(undefined, { desktopState: null, as: { speaker: 'service' }, clientId: 'f2c2af' }); // the app's background link
        page(undefined, { desktopState: null, deviceApp: 'DreamscapeFrame/1.4', deviceId: true, clientId: '8da920' }); // a picture frame
    };
    household('p3');
    eq(turn('p3', 'DeX').length, 0, 'silent: the DeX window of the phone shows the chat (the phone\'s own shell page does not, and is not asked)');
    eq(Array.from(src.watchedChats()).join(','), 'p3', 'watchedChats: the union over every client of hers');
    household('some-other-chat');
    eq(turn('p3', 'DeX').join(','), 'director:p3:turn', 'notifies: the DeX window shows another chat');
    // the same chat finishing twice while the first notice still waits is one notice (alert flag gone, #889 reversed)
    clients.clear();
    const first = turn('p2', 'Twice');
    const second = turn('p2', 'Twice');
    eq(first.length + second.length, 2, 'two publishes of one id (the second changes the waiting notice in place)');
    const row = inbox.list('admin').filter((n) => n.id === 'director:p2:turn');
    eq(row.length, 1, 'one notice row for the chat');

    // =========================================================== real events still notify while she is away
    clients.clear();
    const err = turn('e1', 'Broken', { state: 'failed', sessionId: 'e1', error: 'engine stopped' });
    eq(err.join(','), 'director:e1:turn', 'an erroring turn notifies once');
    eq(inbox.list('admin').find((n) => n.id === 'director:e1:turn').text, '"Broken": the turn stopped with an error.', 'and says it stopped with an error');
    page('q1');
    src.onQuestion({ id: 'form-9', title: 'Pick a size', fields: [{ label: 'Size' }] });
    eq(take().join(','), 'question:form-9', 'a question waiting for an answer notifies even with a page watching');
    src.onSystemNotice({ id: 'x', title: 'Session error', message: 'The session failed', level: 'error' });
    eq(take().join(','), 'system:x', 'a system error notice notifies');

    // =========================================================== the page's own toast
    const file = process.env.PREFIX_PAGE || path.join(ROOT, 'public/scripts/comp/wmDirector.js');
    const run = { running: true, sessionId: 's1', sessionName: 'Chat', xi: { running: false } };
    const idle = { running: false, sessionId: null, xi: { running: false } };
    // the status carries the chats her pages show now; the phone's shell page (this fake page) toasts nothing for a chat another
    // page of hers shows (its DeX window), and still toasts for one nobody shows
    clients.clear();
    page('chat-seen');
    const statusPacket = await new Promise((resolve) => {
        packets.length = 0;
        cursor.broadcastDirectorStatus(gr);
        const t0 = Date.now();
        const tick = () => { const pk = packets.find((x) => x.type === 'director_computer_status'); if (pk || Date.now() - t0 > 2000) resolve(pk); else setTimeout(tick, 30); };
        tick();
    });
    assert.ok(statusPacket && Array.isArray(statusPacket.data.watched), 'director_computer_status carries watched');
    eq(statusPacket.data.watched.join(','), 'chat-seen', 'watched lists the chat her page shows');
    clients.clear();
    let pw = pageToasts(file);
    pw.status(run); pw.status(Object.assign({}, idle, { watched: ['s1'] }));
    eq(pw.toasts.length, 0, 'another page of hers shows the chat: no toast on this shell page');
    pw = pageToasts(file);
    pw.status(run); pw.status(Object.assign({}, idle, { watched: ['other'] }));
    eq(pw.toasts.length, 1, 'a chat nobody shows: the toast stays');
    // (a turn ending with another app open on the phone: the page toasts, deduped with the inbox notice by title)
    let p = pageToasts(file);
    p.status(run); p.status(idle);
    const visibleToasts = p.toasts.length;
    p = pageToasts(file);
    p.document.hidden = true;
    p.status(run); p.status(idle);
    eq(p.toasts.length, 0, 'page hidden: no toast of its own (the server notice is the one notification)');
    p = pageToasts(file);
    p.status(run); p.steerResponse('s1'); p.status(idle);
    eq(p.toasts.length, 0, 'a steered turn: no toast');
    p.status(run); p.status(idle);
    eq(p.toasts.length, visibleToasts, 'the next turn end after a steer toasts as before');
    eq(visibleToasts, 1, 'page visible on another app: one toast, as before (the inbox notice dedupes against it by title)');

    if (PRINT) { console.log(mismatches ? `${mismatches} differences from the fixed behaviour` : 'no differences'); process.exit(0); }
    console.log('test-steer-no-notification: all checks passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
