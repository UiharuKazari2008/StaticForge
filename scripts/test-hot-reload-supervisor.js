#!/usr/bin/env node
'use strict';

/**
 * modules/agentSupervisor.js reloads without a restart (#1292, docs/server/hot-reload.md): 20 reloads in a row leave the same
 * intervals, watchers and listening servers as one; one-shot timers are re-armed, not added; the onReview listener fires once;
 * handed-over state survives; the review queue moves to the new version and runs exactly once; the unix socket keeps answering
 * (its connection listener is the new version's); a failing accept() rolls back to the old version with everything intact;
 * stop() brings the process back to what it was before start().
 *
 *   node scripts/test-hot-reload-supervisor.js
 *
 * Nothing leaves the sandbox: temp home, temp coord DB and socket, a scratch notification inbox, a fake Yozora, a stub model.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const util = require('util');
const assert = require('assert');

// ---- counters, installed before anything is required: live timeouts, intervals, fs watchers and listening servers
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
const realClearTimeout = global.clearTimeout;
const realClearInterval = global.clearInterval;
const live = { timeouts: new Set(), intervals: new Set(), watchers: new Set(), servers: new Set() };
global.setTimeout = function patchedSetTimeout(fn, ms, ...a) {
    const t = realSetTimeout(function fire(...args) { live.timeouts.delete(t); return fn.apply(this, args); }, ms, ...a);
    live.timeouts.add(t);
    return t;
};
if (realSetTimeout[util.promisify.custom]) global.setTimeout[util.promisify.custom] = realSetTimeout[util.promisify.custom];
global.setInterval = function patchedSetInterval(fn, ms, ...a) { const t = realSetInterval(fn, ms, ...a); live.intervals.add(t); return t; };
global.clearTimeout = function patchedClearTimeout(t) { live.timeouts.delete(t); live.intervals.delete(t); return realClearTimeout(t); };
global.clearInterval = function patchedClearInterval(t) { live.timeouts.delete(t); live.intervals.delete(t); return realClearInterval(t); };
const realWatch = fs.watch;
fs.watch = function patchedWatch(...args) {
    const w = realWatch.apply(this, args);
    live.watchers.add(w);
    const close = w.close;
    w.close = function patchedClose(...a) { live.watchers.delete(w); return close.apply(this, a); };
    return w;
};
const realListen = net.Server.prototype.listen;
const realClose = net.Server.prototype.close;
net.Server.prototype.listen = function patchedListen(...args) { live.servers.add(this); return realListen.apply(this, args); };
net.Server.prototype.close = function patchedClose(...args) { live.servers.delete(this); return realClose.apply(this, args); };
const snap = () => ({ timeouts: live.timeouts.size, intervals: live.intervals.size, watchers: live.watchers.size, servers: live.servers.size });

// ---- the sandbox (the same isolation as test-agent-supervisor.js)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-hot-'));
process.env.NOTIFICATION_INBOX_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-hot-supervisor-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.HOT_RELOAD_SOCKET = path.join(tmp, 'state', 'hot-reload.sock');
process.env.AGENT_SUPERVISOR_SETTLE_MS = '0';
process.env.AGENT_SUPERVISOR_NO_REVIVE = '1';
process.env.AGENT_SUPERVISOR_BG_PER_MIN = '100000';
delete process.env.AGENT_SUPERVISOR_DISABLED;
delete process.env.AGENT_SUPERVISOR_TEST_ACCEPT_THROW;
fs.mkdirSync(path.join(tmp, '.claude', 'projects', '-repo'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const before = snap(); // the process before the Supervisor is even loaded
const sup = require('../modules/agentSupervisor');
const hot = require('../modules/hotReload');
const quiet = console.log;
// a fake Yozora: never the network
require('../modules/fleetYozora')._setFetch(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (method === 'GET' && /\/labels\?/.test(String(url))) return ok([{ id: 1, name: 'fleet' }]);
    if (method === 'GET' && String(url).includes('?')) return ok([]);
    return ok({});
});

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const transcript = path.join(tmp, '.claude', 'projects', '-repo', `${SID}.jsonl`);
const line = (o) => `${JSON.stringify(o)}\n`;
fs.writeFileSync(transcript, [
    line({ type: 'user', uuid: 'u1', timestamp: '2026-11-24T10:00:00Z', message: { role: 'user', content: 'Fix the bug' } }),
    line({ type: 'assistant', uuid: 'a1', timestamp: '2026-11-24T10:00:09Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed the bug.' }] } })
].join(''));

const settingsCfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'off', reviewScope: 'all', landingCheck: false, manageLocks: false, trackArtifacts: false } };
const gr = {
    getConfig: () => settingsCfg,
    modifyConfig: () => ({ assign: async (p, v) => { settingsCfg[p[0]] = v; } }),
    getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? 'sk-test' : '') })
};
let modelCalls = 0;
let reviewDelay = 0; // ms the stub model takes for a review (a review in flight while a reload happens)
sup._test.setFetch(async (url, opts) => {
    // only the review's own call counts (a first review of a session also asks for its title and task list)
    let mine = false;
    try { mine = /## Request\nFix the bug/.test(JSON.parse(opts.body).messages[1].content); } catch (_) { /* another kind of call */ }
    if (mine) { modelCalls += 1; if (reviewDelay) await pause(reviewDelay); }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: 'ok', summary: 'fine', missed: [] }) } }] }) };
});

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 8).join('\n     ')}`); }
}
const pause = (ms) => new Promise((r) => realSetTimeout(r, ms));
async function waitFor(cond, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await pause(20); }
    return cond();
}
const ask = (req) => new Promise((resolve, reject) => {
    let buf = '';
    const sk = net.createConnection(process.env.AGENT_SUPERVISOR_SOCKET, () => sk.write(`${JSON.stringify(req)}\n`));
    sk.on('data', (c) => { buf += c; });
    sk.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    sk.on('error', reject);
});
const reload = async () => { console.log = () => {}; try { return await hot.reload(['modules/agentSupervisor.js'], { by: 'p1-test' }); } finally { console.log = quiet; } };
const sockServer = () => [...live.servers].find((s) => { try { return s.address() === process.env.AGENT_SUPERVISOR_SOCKET; } catch (_) { return false; } });

(async () => {
    let afterStart = null;
    let fired = 0;
    const listener = () => { fired += 1; };
    const sockBefore = { server: null, handler: null };

    await test('start(): the sessions watcher, the two intervals, the socket; settle its boot work', async () => {
        sup.start(gr);
        sup.onReview(listener);
        await sup.pumpWork(); // what start() kicked off
        await pause(300);
        afterStart = snap();
        assert.strictEqual(afterStart.intervals - before.intervals, 2, `two intervals (gate, pull): ${JSON.stringify([before, afterStart])}`);
        assert.strictEqual(afterStart.watchers - before.watchers, 1, 'the sessions dir watcher');
        assert.strictEqual(afterStart.servers - before.servers, 1, 'the supervisor socket');
        fired = 0; sup.emitChange();
        assert.strictEqual(fired, 1, 'the listener fires once per emit');
        const l = await ask({ op: 'fleet_work_list', limit: 5 });
        assert.ok(l.ok, JSON.stringify(l));
        sockBefore.server = sockServer();
        assert.ok(sockBefore.server, 'the socket server is counted');
    });

    // state to carry over, one-shot timers to re-arm
    sup._test.stallKicks.set(999, { at: 1, n: 2, reviewId: 3 });
    sup._test.issueTitles.set('x/y#1', 'a title');
    sup._test.statusBySession.set('bbbbbbbb-1111-2222-3333-444444444444', 'busy');
    sup._test.loginMoves.set('cccccccc-1111-2222-3333-444444444444', [1, 2]);
    sup._test.promptWatch.set('99999999-1111-2222-3333-444444444444', { sig: 'abc', since: 5, decided: 0 });
    sup._late.scheduleStallCheck('dddddddd-1111-2222-3333-444444444444');
    sup._late.holdForRecheck('eeeeeeee-1111-2222-3333-444444444444');
    sup._late.armRecheck('ffffffff-1111-2222-3333-444444444444', 3 * 60000);
    const held = { promptWatch: sup._test.promptWatch, stallKicks: sup._test.stallKicks, issueTitles: sup._test.issueTitles, reviewingNow: sup._test.reviewingNow, statusBySession: sup._test.statusBySession };
    const withTimers = snap();
    const supIdentity = sup;
    const idScan = [];
    const idLate = [];
    const timeoutsSeen = [];

    await test('20 reloads: every one ok, the same intervals / watchers / servers, no growth in timeouts, one listener call per emit', async () => {
        for (let i = 1; i <= 20; i += 1) {
            const scanBefore = sup._test.scan;
            const lateBefore = sup._late;
            const handlerBefore = sup._test.onSockConnection;
            const r = await reload();
            assert.ok(r.ok, `reload ${i}: ${r.error || JSON.stringify(r.results)}`);
            assert.ok(r.results.every((x) => x.ok), `reload ${i}: ${JSON.stringify(r.results)}`);
            assert.strictEqual(require('../modules/agentSupervisor'), supIdentity, 'the exports object keeps its identity');
            assert.notStrictEqual(sup._test.scan, scanBefore, `reload ${i}: the new code is on the same exports object`);
            assert.notStrictEqual(sup._late, lateBefore);
            idScan.push(sup._test.scan); idLate.push(sup._late);
            const s = snap();
            timeoutsSeen.push(s.timeouts);
            assert.deepStrictEqual([s.intervals, s.watchers, s.servers], [withTimers.intervals, withTimers.watchers, withTimers.servers], `reload ${i}: ${JSON.stringify([withTimers, s])}`);
            assert.strictEqual(s.timeouts, withTimers.timeouts, `reload ${i}: one-shot timers re-armed, not added: ${JSON.stringify([withTimers, s])}`);
            fired = 0; sup.emitChange();
            assert.strictEqual(fired, 1, `reload ${i}: the onReview listener fires exactly once (${fired})`);
            const srv = sockServer();
            assert.strictEqual(srv, sockBefore.server, 'the same socket server is handed over, never closed and reopened');
            assert.strictEqual(srv.listeners('connection').length, 1, 'one connection listener');
            assert.strictEqual(srv.listeners('connection')[0], sup._test.onSockConnection, 'the connection listener is the current version\'s');
            assert.notStrictEqual(sup._test.onSockConnection, handlerBefore);
            assert.strictEqual(srv.listeners('error').length, 1, 'no second error listener');
        }
        assert.ok(new Set(timeoutsSeen).size === 1, `timeouts constant: ${timeoutsSeen.join(',')}`);
    });

    await test('handed-over state is still there (same containers) and the listener kept', () => {
        assert.strictEqual(sup._test.stallKicks, held.stallKicks);
        assert.strictEqual(sup._test.issueTitles, held.issueTitles);
        assert.strictEqual(sup._test.reviewingNow, held.reviewingNow);
        assert.strictEqual(sup._test.promptWatch, held.promptWatch, 'the permission prompt watch is the same Map after 20 reloads');
        assert.deepStrictEqual(sup._test.promptWatch.get('99999999-1111-2222-3333-444444444444'), { sig: 'abc', since: 5, decided: 0 });
        assert.strictEqual(sup._test.statusBySession, held.statusBySession);
        assert.deepStrictEqual(sup._test.stallKicks.get(999), { at: 1, n: 2, reviewId: 3 });
        assert.strictEqual(sup._test.issueTitles.get('x/y#1'), 'a title');
        assert.strictEqual(sup._test.statusBySession.get('bbbbbbbb-1111-2222-3333-444444444444'), 'busy');
        assert.deepStrictEqual(sup._test.loginMoves.get('cccccccc-1111-2222-3333-444444444444'), [1, 2]);
        assert.strictEqual(sup.settings(gr).enabled, true);
    });

    await test('the unix socket still answers after 20 reloads, from the new code', async () => {
        const l = await ask({ op: 'fleet_work_list', limit: 5 });
        assert.ok(l.ok, JSON.stringify(l));
        const c = await ask({ op: 'nonsense' });
        assert.ok(!c.ok && /op must be/.test(c.error), JSON.stringify(c));
        assert.strictEqual(sockServer().listeners('connection')[0], sup._test.onSockConnection);
        assert.strictEqual(new Set(idScan).size, 20, 'twenty different versions ran');
        assert.strictEqual(new Set(idLate).size, 20);
    });

    await test('the review queue moves to the new version and runs exactly once', async () => {
        const oldTest = sup._test;
        modelCalls = 0;
        oldTest.queue.push({ sessionId: SID, trigger: 'turn-end' }); // not queueReview: nothing may start before the reload
        const r = await reload();
        assert.ok(r.ok, r.error);
        assert.strictEqual(oldTest.queue.length, 0, 'the old version\'s queue was emptied');
        assert.ok(await waitFor(() => modelCalls >= 1), 'the new version started the review');
        await pause(300);
        assert.strictEqual(modelCalls, 1, `one model call, not two (${modelCalls})`);
        assert.ok(await waitFor(() => sup._test.reviewingNow.size === 0 && sup._test.queue.length === 0), 'the review ended and cleared its entry');
    });

    await test('a review in flight while the reload happens ends cleanly: its entry clears, its emit reaches the listener, nothing runs twice', async () => {
        modelCalls = 0; reviewDelay = 400;
        const oldTest = sup._test;
        fired = 0;
        sup._test.queueReview(SID, 'turn-end');
        assert.ok(await waitFor(() => modelCalls === 1), 'the review is waiting on the model');
        assert.ok(sup._test.reviewingNow.has(SID));
        const r = await reload();
        assert.ok(r.ok, r.error);
        assert.notStrictEqual(sup._test, oldTest);
        assert.ok(sup._test.reviewingNow.has(SID), 'the session is still marked as being reviewed in the new version');
        reviewDelay = 0;
        assert.ok(await waitFor(() => sup._test.reviewingNow.size === 0, 5000), 'the old review ended and cleared its entry in the shared set');
        await pause(200);
        assert.ok(fired >= 1, 'the old review\'s emit reached the listener through the current version');
        assert.strictEqual(modelCalls, 1, `no second review (${modelCalls})`);
        assert.strictEqual(sup._test.queue.length, 0);
        const s = snap();
        const r2 = await reload();
        assert.ok(r2.ok, r2.error);
        assert.deepStrictEqual(snap(), s, 'a further reload keeps the same timers');
    });

    await test('the commit watch (a logs/HEAD watcher and its timer) is re-armed once per reload while a wait is open, and closes with it', async () => {
        const logHead = path.join(tmp, 'HEAD-log');
        fs.writeFileSync(logHead, '');
        const raw = require('../modules/agentCoord/store').open();
        const wait = raw.prepare("INSERT INTO supervisor_waits (work_id, session_id, kind, who, what, at) VALUES (1, ?, 'agent', 'x', 'another agent', ?)").run(SID, Date.now());
        sup._test.setCollisionDeps({ rootOf: () => tmp, live: () => new Map(), git: { gitLogPath: async () => logHead } }); // a test hook: handed over too
        const base = snap();
        sup._late.armWatch();
        assert.ok(await waitFor(() => live.watchers.size === base.watchers + 1), 'the commit watcher is open');
        const armed = snap();
        assert.strictEqual(armed.intervals, base.intervals + 1, 'and its 60 s timer');
        for (let i = 1; i <= 5; i += 1) {
            const r = await reload();
            assert.ok(r.ok, r.error);
            assert.ok(await waitFor(() => live.watchers.size === armed.watchers), `reload ${i}: one commit watcher`);
            await pause(30);
            assert.deepStrictEqual(snap(), armed, `reload ${i}: ${JSON.stringify([armed, snap()])}`);
        }
        raw.prepare('UPDATE supervisor_waits SET ended_at = ? WHERE id = ?').run(Date.now(), wait.lastInsertRowid);
        sup._late.armWatch(); // nothing open any more: both close
        assert.deepStrictEqual(snap(), base, 'the watcher and the timer closed with the wait');
        sup._test.setCollisionDeps({});
    });

    await test('accept(dispose()) on the same version restores it exactly', async () => {
        const counts = snap();
        const handler = sup._test.onSockConnection;
        const state = sup.hot.dispose({ rollback: true });
        const down = snap();
        assert.strictEqual(down.intervals, counts.intervals - 2, 'dispose stopped both intervals');
        assert.strictEqual(down.watchers, counts.watchers - 1, 'dispose closed the sessions watcher');
        assert.strictEqual(down.servers, counts.servers, 'the socket server stays up');
        assert.ok(down.timeouts < counts.timeouts, 'the one-shot timers are stopped');
        sup.hot.accept(state, { rollback: true });
        assert.deepStrictEqual(snap(), counts, 'accept re-armed exactly what dispose stopped');
        assert.strictEqual(sockServer().listeners('connection')[0], handler);
        fired = 0; sup.emitChange();
        assert.strictEqual(fired, 1);
        assert.ok((await ask({ op: 'fleet_work_list', limit: 5 })).ok);
    });

    await test('a failing accept() rolls back: the old version serves, keeps its listener, timers and queue', async () => {
        const t = sup._test;
        const lateBefore = sup._late;
        const handlerBefore = t.onSockConnection;
        const countsBefore = snap();
        modelCalls = 0;
        t.queue.push({ sessionId: SID, trigger: 'turn-end' });
        process.env.AGENT_SUPERVISOR_TEST_ACCEPT_THROW = '1'; // the test-only switch in accept()
        let r;
        try { r = await reload(); } finally { delete process.env.AGENT_SUPERVISOR_TEST_ACCEPT_THROW; }
        assert.strictEqual(r.ok, false, 'the reload reports the failure');
        assert.match(r.error, /accept\(\) of the new version threw.*rolled back/, r.error);
        assert.strictEqual(sup._late, lateBefore, 'the old exports are back');
        assert.strictEqual(sup._test.onSockConnection, handlerBefore);
        const s = snap();
        assert.deepStrictEqual(s, countsBefore, `the same timers, watchers and servers: ${JSON.stringify([countsBefore, s])}`);
        assert.strictEqual(sockServer().listeners('connection')[0], handlerBefore, 'the old connection listener is back');
        assert.strictEqual(sockServer().listeners('connection').length, 1);
        fired = 0; sup.emitChange();
        assert.strictEqual(fired, 1, 'the listener survived the rollback');
        const l = await ask({ op: 'fleet_work_list', limit: 5 });
        assert.ok(l.ok, JSON.stringify(l));
        assert.ok(await waitFor(() => modelCalls >= 1), 'the queued review ran in the restored version');
        await pause(300);
        assert.strictEqual(modelCalls, 1, `exactly once (${modelCalls})`);
        assert.strictEqual(sup._test.stallKicks, held.stallKicks);
        // and a normal reload works again afterwards
        const again = await reload();
        assert.ok(again.ok, again.error);
        assert.deepStrictEqual(snap(), countsBefore);
    });

    // ---- the socket is served reliably (#1351): a dead file, a live other process, a deleted or replaced file, a reload with no server
    const SOCK = process.env.AGENT_SUPERVISOR_SOCKET;
    const { spawn } = require('child_process');
    const warned = [];
    const realWarn = console.warn;
    const catchWarn = () => { warned.length = 0; console.warn = (...a) => { warned.push(a.join(' ')); }; };
    const stopWarn = () => { console.warn = realWarn; };
    const listening = () => { const s = sockServer(); return !!(s && s.listening); };
    // a socket file with no process behind it: a child binds it and is killed (SIGKILL leaves the file)
    async function makeDeadSocket(file) {
        const child = spawn(process.execPath, ['-e', "require('net').createServer().listen(process.argv[1], () => console.log('up'))", file], { stdio: ['ignore', 'pipe', 'inherit'] });
        await new Promise((res, rej) => { child.stdout.once('data', res); child.once('error', rej); child.once('exit', () => rej(new Error('the child exited early'))); });
        const gone = new Promise((res) => child.once('exit', res));
        child.kill('SIGKILL');
        await gone;
        assert.ok(fs.existsSync(file), 'the dead socket file is left behind');
    }

    await test('ensureSocket on a healthy socket is one stat: ok, the same server, nothing re-listened', async () => {
        const srv = sockServer();
        assert.strictEqual(await sup.ensureSocket(), 'ok');
        assert.strictEqual(sockServer(), srv);
        assert.strictEqual(await sup._test.probeSocket(SOCK), 'own', 'its own pid answers the probe');
        assert.strictEqual(await sup._test.probeSocket(path.join(tmp, 'state', 'none.sock')), 'dead');
    });

    await test('the socket file deleted under the running server: ensureSocket closes the orphan and listens again', async () => {
        const old = sockServer();
        const n = snap();
        fs.unlinkSync(SOCK);
        catchWarn();
        try { assert.strictEqual(await sup.ensureSocket(), 'listening'); } finally { stopWarn(); }
        assert.ok(warned.some((w) => /was not served .*no file/.test(w)), warned.join('|'));
        const now = sockServer();
        assert.ok(now && now !== old && now.listening, 'a new server listens');
        assert.ok(!old.listening, 'the orphan is closed');
        assert.strictEqual(snap().servers, n.servers, 'still one server');
        assert.ok(fs.existsSync(SOCK), 'the new file exists (the orphan was closed before binding)');
        assert.ok((await ask({ op: 'fleet_work_list', limit: 5 })).ok);
        assert.strictEqual(now.listeners('connection')[0], sup._test.onSockConnection);
        assert.strictEqual(await sup.ensureSocket(), 'ok');
    });

    await test('the socket file replaced by a dead file (a thief that exited): ensureSocket listens again', async () => {
        const old = sockServer();
        const dead = path.join(tmp, 'state', 'thief.sock');
        await makeDeadSocket(dead);
        fs.renameSync(dead, SOCK); // the live server now listens on an unlinked inode; the path is a dead file
        await assert.rejects(ask({ op: 'fleet_work_list', limit: 5 }), /ECONNREFUSED/, 'refused, as in the incident');
        catchWarn();
        try { assert.strictEqual(await sup.ensureSocket(), 'listening'); } finally { stopWarn(); }
        assert.ok(warned.some((w) => /a dead file/.test(w)), warned.join('|'));
        assert.ok(sockServer() && sockServer() !== old && listening());
        assert.ok((await ask({ op: 'fleet_work_list', limit: 5 })).ok, 'answers again');
        assert.strictEqual(snap().servers, afterStart.servers);
    });

    await test('a reload whose old version had no server, or a closed one, listens again afterwards', async () => {
        for (const how of ['closed', 'null']) {
            const state = sup.hot.dispose({ rollback: true });
            assert.ok(state.sockServer, 'the server is handed over');
            state.sockServer.close(); // closing unlinks the path
            if (how === 'null') state.sockServer = null;
            assert.ok(!fs.existsSync(SOCK));
            catchWarn();
            try {
                sup.hot.accept(state, { rollback: true });
                assert.ok(await waitFor(listening), `${how}: listening again after the reload`);
            } finally { stopWarn(); }
            assert.ok((await ask({ op: 'fleet_work_list', limit: 5 })).ok, `${how}: answers`);
            assert.strictEqual(snap().servers, afterStart.servers, `${how}: one server`);
            assert.strictEqual(sockServer().listeners('connection')[0], sup._test.onSockConnection);
        }
    });

    await test('a reload hands the inode over: a healthy socket is left alone (no re-listen, the same server)', async () => {
        const srv = sockServer();
        const ino = sup._test.sockIno;
        assert.ok(ino > 0, 'the inode is recorded');
        const r = await reload();
        assert.ok(r.ok, r.error);
        await pause(100);
        assert.strictEqual(sockServer(), srv);
        assert.strictEqual(sup._test.sockIno, ino);
    });

    await test('start() on a stale socket file (no listener): it listens, a client gets an answer; stop() leaves nothing', async () => {
        sup.stop();
        await pause(50);
        assert.ok(!fs.existsSync(SOCK), 'stop removed its socket');
        await makeDeadSocket(SOCK);
        sup.start(gr);
        assert.ok(await waitFor(listening), 'it listens although a dead file was in the way');
        assert.ok((await ask({ op: 'fleet_work_list', limit: 5 })).ok);
        assert.strictEqual(snap().servers - before.servers, 1);
        sup.stop();
        await pause(50);
    });

    await test('a live other process on the path is never taken over: warned once, its clients still get its answers, and it is served once it goes', async () => {
        assert.ok(!fs.existsSync(SOCK));
        const other = net.createServer((c) => { c.on('data', () => { c.end(`${JSON.stringify({ ok: true, result: 'the other process' })}\n`); }); });
        await new Promise((res) => other.listen(SOCK, res));
        catchWarn();
        try {
            sup.start(gr);
            assert.ok(await waitFor(() => warned.some((w) => /served by another process; not taking it over/.test(w))), `warned: ${warned.join('|')}`);
            assert.ok(warned.some((w) => w.includes(SOCK)), 'names the path');
            assert.strictEqual(snap().servers - before.servers, 1, 'only the other server (the Supervisor made none)');
            assert.strictEqual((await ask({ op: 'check' })).result, 'the other process', 'the other process still answers');
            const n = warned.length;
            assert.strictEqual(await sup.ensureSocket(), 'other');
            assert.strictEqual(await sup.ensureSocket(), 'other');
            assert.strictEqual(warned.length, n, 'one warning per situation, not one per minute');
            assert.strictEqual((await ask({ op: 'check' })).result, 'the other process');
        } finally { stopWarn(); }
        await new Promise((res) => other.close(res)); // its path goes with it
        assert.strictEqual(await sup.ensureSocket(), 'listening');
        assert.ok(listening());
        const a = await ask({ op: 'nonsense' });
        assert.ok(!a.ok && /op must be/.test(a.error), 'now the Supervisor answers');
        assert.strictEqual(snap().servers - before.servers, 1);
    });

    await test('stop() brings intervals, watchers and servers back to what they were before start()', async () => {
        sup.stop();
        await pause(50);
        const s = snap();
        assert.deepStrictEqual([s.intervals, s.watchers, s.servers], [before.intervals, before.watchers, before.servers], JSON.stringify([before, s]));
        // a reload of a stopped Supervisor arms nothing
        const r = await reload();
        assert.ok(r.ok, r.error);
        const s2 = snap();
        assert.deepStrictEqual([s2.intervals, s2.watchers, s2.servers], [before.intervals, before.watchers, before.servers], JSON.stringify([before, s2]));
    });

    require('../modules/agentCoord/store').close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : `\nall passed (20 reloads; timeouts ${timeoutsSeen[0]} each time, intervals ${afterStart.intervals - before.intervals}, watchers ${afterStart.watchers - before.watchers}, servers ${afterStart.servers - before.servers} after start)`);
    process.exit(failed ? 1 : 0);
})();
