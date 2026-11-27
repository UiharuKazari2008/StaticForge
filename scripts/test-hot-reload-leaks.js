#!/usr/bin/env node
'use strict';

/**
 * Acceptance test of #1292 (docs/server/hot-reload.md): "a test script reloads agentSupervisor.js, fleetDeps.js and one WS
 * handler 20 times in a running test server: no extra intervals / listeners (count them), state kept (open work, timers), calls
 * after reload hit the new code."
 *
 *   node scripts/test-hot-reload-leaks.js [--without-fleetdeps]
 *
 * --without-fleetdeps  leave modules/fleetDeps.js out of the rounds (only until it carries its hotReload.mark; without the
 *                      marker and without this switch the test stops at once and says so).
 *
 * The parent starts a child node process = the running test server. Before the child requires anything it patches setTimeout /
 * setInterval / clearTimeout / clearInterval, fs.watch and net.Server listen / close to count live timeouts, intervals, fs
 * watchers and listening servers. The child serves modules/hotReload.js on its own socket, starts the Supervisor and Fleet
 * maintenance on a fake gr, loads the real WS handler loader with two handler files (280-wallpaperHistoryHandler.js and a
 * throw-away copy 998-hotLeakTmpHandler.js whose answer carries a string the test changes before every reload), and keeps an
 * open work item and two one-shot timers (a stall check and a hold recheck) armed through the Supervisor's own functions.
 * The parent drives 20 rounds THROUGH THE REAL SOCKET (op reload): rounds 1-10 one call per file, rounds 11-20 one batch; after
 * each round it asks the child (over the fork's IPC channel) what it counts and what answers. Then the rollbacks (a syntax
 * error, a throwing registerPackets, a throwing load, then a good change again), then stop() of everything.
 *
 * Nothing leaves the sandbox: temp HOME / claude home / coord DB / supervisor and reload sockets / notification inbox, a fake
 * Yozora, a stub model, global fetch / http / https refused. The live sockets are never touched. The temp handler file is
 * removed at the end, also on failure.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const util = require('util');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const HANDLERS_REL = 'modules/ws/handlers';
const H280 = `${HANDLERS_REL}/280-wallpaperHistoryHandler.js`;
const HTMP = `${HANDLERS_REL}/998-hotLeakTmpHandler.js`;
const SUP = 'modules/agentSupervisor.js';
const DEPS = 'modules/fleetDeps.js';
const ROUNDS = 20;

// ======================================================================================================================
// The child: the running test server
// ======================================================================================================================

function runChild() {
    // ---- counters, installed before anything is required: live timeouts (with their delay), intervals, fs watchers, listening servers
    const realSetTimeout = global.setTimeout;
    const realSetInterval = global.setInterval;
    const realClearTimeout = global.clearTimeout;
    const realClearInterval = global.clearInterval;
    const live = { timeouts: new Map(), intervals: new Set(), watchers: new Set(), servers: new Set() };
    global.setTimeout = function patchedSetTimeout(fn, ms, ...a) {
        const t = realSetTimeout(function fire(...args) { live.timeouts.delete(t); return fn.apply(this, args); }, ms, ...a);
        live.timeouts.set(t, Number(ms));
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
    const withDelay = (ms) => [...live.timeouts.values()].filter((v) => v === ms).length;

    // ---- no network: global fetch, http and https refuse (the modules that talk to Yozora / a model get fakes below)
    const networkAttempts = [];
    global.fetch = async (u) => { networkAttempts.push(String(u)); throw new Error('network is blocked by test-hot-reload-leaks'); };
    ['http', 'https'].forEach((m) => {
        const mod = require(m);
        ['request', 'get'].forEach((k) => { mod[k] = (...a) => { networkAttempts.push(`${m}.${k} ${String(a[0] && (a[0].href || a[0].host || a[0]))}`); throw new Error('network is blocked by test-hot-reload-leaks'); }; });
    });

    const pause = (ms) => new Promise((r) => realSetTimeout(r, ms));
    const ids = new WeakMap();
    let nextId = 1;
    const idOf = (o) => { if (o === null || (typeof o !== 'object' && typeof o !== 'function')) return null; if (!ids.has(o)) { ids.set(o, nextId); nextId += 1; } return ids.get(o); };

    const abs = (rel) => path.join(ROOT, rel);
    const STALL_DELAY = Number(process.env.AGENT_SUPERVISOR_STALL_MS) + 5000; // scheduleStallCheck's default delay
    const HOLD_DELAY = Number(process.env.AGENT_SUPERVISOR_HOLD_RECHECK_MS);

    const baseBeforeRequire = snap();
    const hot = require('../modules/hotReload');
    const reg = require('../modules/ws/wsPacketRegistry');
    const registerAll = require('../modules/ws/registerAllWsHandlers');
    const sup = require('../modules/agentSupervisor');
    const maint = require('../modules/fleetMaintenance');
    const deps = require('../modules/fleetDeps');
    require('../modules/fleetYozora')._setFetch(async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
        if (method === 'GET' && /\/labels\?/.test(String(url))) return ok([{ id: 1, name: 'fleet' }]);
        if (method === 'GET' && String(url).includes('?')) return ok([]);
        return ok({});
    });
    let modelCalls = 0;
    sup._test.setFetch(async () => {
        modelCalls += 1;
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: 'ok', summary: 'fine', missed: [] }) } }] }) };
    });
    const supRef = sup; // taken at load time, like every caller does
    const depsRef = deps;
    const base = snap(); // every module loaded, nothing started

    const settingsCfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'off', reviewScope: 'all', landingCheck: false, manageLocks: false, trackArtifacts: false } };
    const gr = {
        getConfig: () => settingsCfg,
        modifyConfig: () => ({ assign: async (p, v) => { settingsCfg[p[0]] = v; } }),
        getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? 'sk-test' : '') })
    };

    // ---- the WS handler loader with a fake ctx, two handler files (the real 280 and the temp copy)
    let sentTo = [];
    const cacheDir = path.join(process.env.HOT_LEAKS_DIR, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const handlersCtx = {
        globalResources: { getPath: () => cacheDir },
        sendToClient: (ws, msg) => { sentTo.push(msg); },
        sendError: (ws, a, b) => { sentTo.push({ error: a, detail: b }); }
    };
    const callHandler = async (type) => {
        const h = reg.getWsPacketHandler(type);
        if (!h) return { found: false };
        sentTo = [];
        await h({ ws: {}, message: { requestId: 'rq' }, clientInfo: {}, wsServer: {} });
        return { found: true, sent: sentTo.slice() };
    };
    const handlersDir = abs(HANDLERS_REL);
    const realReaddir = fs.readdirSync;
    const only = [path.basename(H280), path.basename(HTMP)];
    fs.readdirSync = function stubbedReaddir(p, ...a) { return path.resolve(String(p)) === handlersDir ? only.slice() : realReaddir.call(this, p, ...a); };
    try { registerAll(handlersCtx); } finally { fs.readdirSync = realReaddir; }

    let fired = 0;
    const listener = () => { fired += 1; };
    let startedAt = 0;
    let workId = 0;

    const probe = async () => {
        const cache = (rel) => require.cache[abs(rel)];
        const mods = {};
        [['sup', SUP], ['deps', DEPS], ['h280', H280], ['tmp', HTMP]].forEach(([k, rel]) => {
            const m = cache(rel);
            mods[k] = m ? { mod: idOf(m), exports: idOf(m.exports), hot: !!(m.exports && m.exports.hot) } : null;
        });
        fired = 0; sup.emitChange();
        const w = sup.getWork(workId);
        const t280 = reg.typesOfFile(abs(H280)).sort();
        const tTmp = reg.typesOfFile(abs(HTMP)).sort();
        const c280 = await callHandler('wallpaper_history_list');
        const cTmp = await callHandler('hotleak_list');
        let prio = null;
        try { prio = deps.priorities().get(workId); } catch (e) { prio = `error: ${e.message}`; }
        return {
            snap: snap(), elapsedMs: Date.now() - startedAt,
            stallTimers: withDelay(STALL_DELAY), holdTimers: withDelay(HOLD_DELAY),
            fired, mods,
            sameSupExports: require('../modules/agentSupervisor') === supRef && require('../modules/fleetDeps') === depsRef,
            supScanId: idOf(supRef._test.scan), supLateId: idOf(supRef._late), depsDetectId: idOf(depsRef.detect),
            types280: t280, typesTmp: tTmp, totalTypes: reg.listRegisteredPackets().length,
            fn280: idOf(reg.getWsPacketHandler('wallpaper_history_list')), fnDel280: idOf(reg.getWsPacketHandler('wallpaper_history_delete')),
            fnTmp: idOf(reg.getWsPacketHandler('hotleak_list')),
            call280: c280.found ? { type: c280.sent[0] && c280.sent[0].type, success: !!(c280.sent[0] && c280.sent[0].data && c280.sent[0].data.success), items: Array.isArray(c280.sent[0] && c280.sent[0].data && c280.sent[0].data.items) } : null,
            callTmp: cTmp.found ? { type: cTmp.sent[0] && cTmp.sent[0].type, mark: cTmp.sent[0] && cTmp.sent[0].data && cTmp.sent[0].data.mark } : null,
            work: w ? { id: w.id, state: w.state, title: w.title, listed: sup.listWork({ limit: 300 }).some((x) => x.id === workId) } : null,
            priority: prio, modelCalls, networkAttempts: networkAttempts.slice()
        };
    };

    const commands = {
        async init() {
            hot.serve();
            const end = Date.now() + 5000;
            while (Date.now() < end && ![...live.servers].some((s) => s.listening)) await pause(10);
            maint.start(gr); // its daily timer; catch-up and the notify kinds are off in the default settings
            startedAt = Date.now();
            sup.start(gr);
            sup.onReview(listener);
            await sup.pumpWork();
            // the open work item (held: nothing starts a session) and its priority; two one-shot timers armed through the Supervisor's own functions
            const w = sup.enqueue({ title: 'hot leak probe (never started)', prompt: 'Leak test brief. Nothing starts from this item: it stays held.', source: 'fleet' });
            workId = w.id;
            deps.setPriority(workId, 2);
            sup._late.scheduleStallCheck('dddddddd-1111-2222-3333-444444444444');
            sup._late.holdForRecheck('eeeeeeee-1111-2222-3333-444444444444');
            await pause(400);
            return { baseBeforeRequire, base, afterStart: snap(), stallDelay: STALL_DELAY, holdDelay: HOLD_DELAY, workId };
        },
        probe,
        async finish() {
            sup.stop();
            maint.stop();
            hot.close();
            await pause(100);
            const after = snap();
            try { require('../modules/agentCoord/store').close(); } catch (_) { /* closed */ }
            return { base, after, networkAttempts, modelCalls };
        },
        async exit() { setImmediate(() => process.exit(0)); return {}; }
    };

    process.on('message', async (m) => {
        try { process.send({ id: m.id, ok: true, result: await commands[m.cmd](m.args) }); } catch (e) { process.send({ id: m.id, ok: false, error: String((e && e.stack) || e).slice(0, 1500) }); }
    });
    process.send({ ready: true });
}

// ======================================================================================================================
// The parent: drives the reloads through the real socket and asserts
// ======================================================================================================================

async function runParent() {
    const { fork, spawnSync } = require('child_process');
    const withoutDeps = process.argv.includes('--without-fleetdeps');
    const depsMarked = /require\('\.\/hotReload'\)\.mark\(/.test(fs.readFileSync(path.join(ROOT, DEPS), 'utf8'));
    if (!depsMarked && !withoutDeps) {
        console.log(`modules/fleetDeps.js has no hotReload.mark yet: it cannot be reloaded. Run with --without-fleetdeps until it has the marker.`);
        process.exit(2);
    }
    const inRounds = depsMarked && !withoutDeps;
    const filesPerRound = [SUP].concat(inRounds ? [DEPS] : [], [H280, HTMP]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hlk-')); // short: a unix socket path is limited to ~104 bytes
    const claudeHome = path.join(dir, 'home');
    fs.mkdirSync(path.join(claudeHome, '.claude', 'projects', '-repo'), { recursive: true });
    fs.mkdirSync(path.join(claudeHome, '.claude', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(dir, 's'), { recursive: true });
    const hotSock = path.join(dir, 'h.sock');
    const tmpHandlerAbs = path.join(ROOT, HTMP);
    assert.ok(Buffer.byteLength(hotSock) < 100 && Buffer.byteLength(path.join(dir, 's', 'supervisor.sock')) < 100, 'socket paths are short enough');

    // ---- the env of the child: nothing real reachable
    const env = {};
    Object.keys(process.env).forEach((k) => {
        if (/^(YOZORA|FLEET|ANTHROPIC|CLAUDE|OPENAI|NAI|NOVELAI|DEEPSEEK|TOKENROUTER|AGENT_COORD|AGENT_SUPERVISOR|DREAMSCAPE|NOTIFICATION|HOT_RELOAD|HOME$|RELOAD_GATE)/i.test(k)) return;
        env[k] = process.env[k];
    });
    Object.assign(env, {
        HOME: claudeHome,
        DREAMSCAPE_CLAUDE_HOME: claudeHome,
        AGENT_COORD_DB: path.join(dir, 's', 'coord.db'),
        AGENT_SUPERVISOR_SOCKET: path.join(dir, 's', 'supervisor.sock'),
        HOT_RELOAD_SOCKET: hotSock,
        NOTIFICATION_INBOX_DB: path.join(dir, 'notifications.db'),
        NOTIFICATION_INBOX_NO_TIMER: '1',
        AGENT_SUPERVISOR_SETTLE_MS: '0',
        AGENT_SUPERVISOR_NO_REVIVE: '1',
        AGENT_SUPERVISOR_BG_PER_MIN: '100000',
        AGENT_SUPERVISOR_STALL_MS: '912345', // distinctive delays: the pending stall / hold timers are told apart in the timer counts
        AGENT_SUPERVISOR_HOLD_RECHECK_MS: '823456',
        HOT_LEAKS_DIR: dir,
        HOT_LEAKS_CHILD: '1'
    });

    // ---- the temp handler: a copy of 280 with its own packet types and a string the test changes
    const src280 = fs.readFileSync(path.join(ROOT, H280), 'utf8');
    const tmpBody = (mark, variant) => {
        let s = src280.replace(/wallpaper_history_/g, 'hotleak_').replace("owner: 'wallpaperHistory'", "owner: 'hotLeakTmp'");
        s = s.replace('data: { success: true, items: wallpaperHistory.list(cacheDir) }', 'data: { success: true, mark: MARK, items: wallpaperHistory.list(cacheDir) }');
        s = s.replace("const wallpaperHistory = require('../../wallpaperHistory');", `const wallpaperHistory = require('../../wallpaperHistory');\nconst MARK = ${JSON.stringify(mark)};`);
        assert.ok(s.includes('mark: MARK') && s.includes('const MARK = ') && s.includes("'hotleak_list'") && !s.includes('wallpaper_history_'), 'the temp handler was derived from 280');
        if (variant === 'syntax') s += '\nconst broken = ;\n';
        if (variant === 'register-throws') s = s.replace('function registerPackets(handlersCtx) {', "function registerPackets(handlersCtx) {\n    throw new Error('register boom');");
        if (variant === 'load-throws') s = `throw new Error('load boom');\n${s}`;
        return s;
    };
    const writeTmp = (mark, variant) => fs.writeFileSync(tmpHandlerAbs, tmpBody(mark, variant));
    const cleanup = () => { try { fs.unlinkSync(tmpHandlerAbs); } catch (_) { /* gone */ } };
    process.on('exit', cleanup);

    let failed = 0;
    const log = (ok, name, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n       ${String(detail).replace(/\n/g, '\n       ').slice(0, 1800)}` : ''}`); };
    const phase = async (name, fn) => { try { await fn(); log(true, name); } catch (e) { log(false, name, e && e.stack ? e.stack.split('\n').slice(0, 9).join('\n') : e); } };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ---- the child and its IPC
    writeTmp('initial');
    let out = '';
    const child = fork(__filename, ['--child'], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', (c) => { out += c; if (out.length > 20000) out = out.slice(-20000); });
    child.stderr.on('data', (c) => { out += c; if (out.length > 20000) out = out.slice(-20000); });
    let exitCode = null;
    const exited = new Promise((resolve) => child.on('exit', (code, sig) => { exitCode = code === null ? `signal ${sig}` : code; resolve(); }));
    const pending = new Map();
    let readyResolve = null;
    const ready = new Promise((r) => { readyResolve = r; });
    child.on('message', (m) => {
        if (m.ready) { readyResolve(); return; }
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); if (m.ok) p.resolve(m.result); else p.reject(new Error(`child: ${m.error}`)); }
    });
    let nextRpc = 1;
    const rpc = (cmd, args, ms = 30000) => new Promise((resolve, reject) => {
        const id = nextRpc; nextRpc += 1;
        const t = setTimeout(() => { pending.delete(id); reject(new Error(`child did not answer ${cmd} in ${ms} ms`)); }, ms);
        pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
        child.send({ id, cmd, args });
    });
    // the whole test is bounded
    const watchdog = setTimeout(() => { console.log('FAIL the test took longer than 110 s: killed'); try { child.kill('SIGKILL'); } catch (_) { /* gone */ } cleanup(); process.exit(1); }, 110000);

    // ---- the real socket API
    const ask = (req, ms = 60000) => new Promise((resolve, reject) => {
        let buf = '';
        const sk = net.createConnection(hotSock);
        const t = setTimeout(() => { sk.destroy(); reject(new Error(`the reload socket did not answer ${req.op} in ${ms} ms`)); }, ms);
        sk.on('connect', () => sk.write(`${JSON.stringify(req)}\n`));
        sk.on('data', (c) => { buf += c; });
        sk.on('end', () => { clearTimeout(t); try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error(`bad answer: ${buf.slice(0, 200)}`)); } });
        sk.on('error', (e) => { clearTimeout(t); reject(e); });
    });
    const reload = async (files, why) => {
        const res = await ask({ op: 'reload', files, by: 'test-hot-reload-leaks', why: why || 'leak test' });
        assert.ok(res.ok, `socket: ${JSON.stringify(res)}`);
        return res.result;
    };
    const seen = { sup: new Set(), deps: new Set(), h280: new Set(), tmp: new Set(), scan: new Set(), detect: new Set(), fn280: new Set(), fnTmp: new Set() };
    const TYPES_280 = ['wallpaper_history_delete', 'wallpaper_history_list'];
    const TYPES_TMP = ['hotleak_delete', 'hotleak_list'];
    let p0 = null; // the probe before any reload
    let baseline = null;

    // the checks that hold for every probe (state kept, counts, answers)
    const common = (label, p, mark) => {
        const c = p.snap;
        assert.deepStrictEqual([c.intervals, c.watchers, c.servers], [baseline.afterStart.intervals, baseline.afterStart.watchers, baseline.afterStart.servers], `${label}: intervals / watchers / servers ${JSON.stringify([baseline.afterStart, c])}`);
        // the Supervisor's 20 s boot timer is one-shot: it may have fired by itself in a slow run
        const bootGone = p.elapsedMs > 19000 ? 1 : 0;
        assert.ok(c.timeouts === baseline.afterStart.timeouts || (bootGone && c.timeouts === baseline.afterStart.timeouts - 1), `${label}: live timeouts ${c.timeouts} vs ${baseline.afterStart.timeouts} (elapsed ${p.elapsedMs} ms)`);
        assert.strictEqual(p.fired, 1, `${label}: one listener call per emitChange (${p.fired})`);
        assert.ok(p.sameSupExports, `${label}: the exports objects held since load are the current ones`);
        assert.deepStrictEqual(p.types280, TYPES_280, `${label}: 280 owns its packet types`);
        assert.deepStrictEqual(p.typesTmp, TYPES_TMP, `${label}: the temp handler owns its packet types`);
        assert.strictEqual(p.totalTypes, p0.totalTypes, `${label}: the registry holds the same number of types`);
        assert.deepStrictEqual(p.call280, { type: 'wallpaper_history_list_response', success: true, items: true }, `${label}: the 280 handler answers through the registry`);
        assert.ok(p.callTmp && p.callTmp.type === 'hotleak_list_response', `${label}: the temp handler answers through the registry`);
        assert.strictEqual(p.callTmp.mark, mark, `${label}: the temp handler answers "${mark}" (got ${p.callTmp.mark})`);
        assert.ok(p.work && p.work.listed && p.work.state === 'held', `${label}: the open work item is still listed and held ${JSON.stringify(p.work)}`);
        assert.strictEqual(p.priority, 2, `${label}: its priority is kept (${p.priority})`);
        assert.strictEqual(p.stallTimers, 1, `${label}: the pending stall check is still armed (${p.stallTimers})`);
        assert.strictEqual(p.holdTimers, 1, `${label}: the pending hold recheck is still armed (${p.holdTimers})`);
        assert.deepStrictEqual(p.networkAttempts, [], `${label}: no network attempt`);
        assert.strictEqual(p.modelCalls, 0, `${label}: no model call`);
        ['sup', 'h280', 'tmp'].concat(inRounds ? ['deps'] : []).forEach((k) => assert.strictEqual(p.mods[k].exports, p0.mods[k].exports, `${label}: ${k}: the exports object keeps its identity`));
    };

    try {
        await Promise.race([ready, exited.then(() => { throw new Error(`the test server exited early (${exitCode}): ${out.slice(-1500)}`); }), sleep(30000).then(() => { throw new Error('the test server did not start in 30 s'); })]);

        await phase('start: hot reload socket, maintenance, Supervisor, WS loader (two handler files), an open work item, a stall timer and a hold timer', async () => {
            baseline = await rpc('init');
            const end = Date.now() + 5000;
            while (!fs.existsSync(hotSock) && Date.now() < end) await sleep(20);
            assert.ok(fs.existsSync(hotSock), 'the reload socket exists');
            const a = baseline.afterStart; const b = baseline.base;
            assert.deepStrictEqual(baseline.baseBeforeRequire, { timeouts: 0, intervals: 0, watchers: 0, servers: 0 }, `loading the modules arms nothing: ${JSON.stringify(baseline.baseBeforeRequire)}`);
            assert.deepStrictEqual([a.intervals - b.intervals, a.watchers - b.watchers], [2, 1], `the Supervisor armed two intervals and a watcher; maintenance only a timeout: ${JSON.stringify([b, a])}`);
            assert.strictEqual(a.servers - b.servers, 2, `two listening servers (reload socket, supervisor socket): ${JSON.stringify([b, a])}`);
            p0 = await rpc('probe');
            baseline.afterStart = p0.snap; // settled
            common('start', p0, 'initial');
            const list = await ask({ op: 'list' });
            const names = list.result.map((x) => x.file);
            [SUP, H280, HTMP].concat(depsMarked ? [DEPS] : [], ['modules/fleetMaintenance.js']).forEach((f) => assert.ok(names.includes(f), `${f} is listed as reloadable (${names.join(', ')})`));
            if (inRounds) assert.ok(p0.mods.deps.hot, 'fleetDeps carries its marker');
            [['sup', 'mod'], ['deps', 'mod'], ['h280', 'mod'], ['tmp', 'mod']].forEach(([k]) => { if (p0.mods[k]) seen[k].add(p0.mods[k].mod); });
            seen.scan.add(p0.supScanId); seen.detect.add(p0.depsDetectId); seen.fn280.add(p0.fn280); seen.fnTmp.add(p0.fnTmp);
        });
        if (!p0) throw new Error('no baseline: stopping');

        const roundsLog = [];
        let roundsDone = 0;
        await phase(`${ROUNDS} rounds through the socket (1-${ROUNDS / 2}: one call per file; ${ROUNDS / 2 + 1}-${ROUNDS}: one batch of ${filesPerRound.length}${inRounds ? '' : ', fleetDeps left out by --without-fleetdeps'}), each with a new string in the temp handler`, async () => {
            for (let i = 1; i <= ROUNDS; i += 1) {
                const mark = `round-${i}-${Math.random().toString(36).slice(2, 8)}`;
                writeTmp(mark);
                const results = [];
                if (i <= ROUNDS / 2) {
                    for (const f of filesPerRound) results.push(await reload([f], `round ${i}`));
                } else {
                    results.push(await reload(filesPerRound, `round ${i} batch`));
                }
                results.forEach((r) => {
                    assert.ok(r.ok, `round ${i}: reload not ok: ${r.error || JSON.stringify(r.results)}`);
                    assert.ok(r.results.length >= 1 && r.results.every((x) => x.ok && !x.rolledBack), `round ${i}: ${JSON.stringify(r.results)}`);
                });
                const reloaded = [].concat(...results.map((r) => r.results.map((x) => x.file)));
                assert.deepStrictEqual(reloaded, filesPerRound, `round ${i}: every file reloaded, in order`);
                const p = await rpc('probe');
                const label = `round ${i}`;
                common(label, p, mark);
                // new code: a new module object per file, the same exports object, a new handler function, new functions on the old exports
                const fresh = (k, id) => { assert.ok(!seen[k].has(id), `${label}: ${k} is a new version (id ${id})`); seen[k].add(id); };
                fresh('sup', p.mods.sup.mod); fresh('h280', p.mods.h280.mod); fresh('tmp', p.mods.tmp.mod);
                fresh('scan', p.supScanId);
                fresh('fn280', p.fn280); fresh('fnTmp', p.fnTmp);
                if (inRounds) { fresh('deps', p.mods.deps.mod); fresh('detect', p.depsDetectId); }
                assert.notStrictEqual(p.fnDel280, p0.fnDel280, `${label}: the delete handler is new too`);
                roundsLog.push(p.snap);
                roundsDone = i;
            }
        });

        await phase('the socket reports 20 reloads of each file; history lists the last batch', async () => {
            assert.strictEqual(roundsDone, ROUNDS, 'all rounds ran');
            const list = (await ask({ op: 'list' })).result;
            const n = (f) => (list.find((x) => x.file === f) || {}).reloads;
            filesPerRound.forEach((f) => assert.strictEqual(n(f), ROUNDS, `${f} reloaded ${n(f)} times`));
            const h = (await ask({ op: 'history', limit: 3 })).result;
            assert.ok(h.length >= 1 && h[0].ok && h[0].by === 'test-hot-reload-leaks', JSON.stringify(h[0]));
            assert.deepStrictEqual(h[0].files, filesPerRound);
        });

        await phase('timeouts did not grow over the rounds', async () => {
            const t = roundsLog.map((s) => s.timeouts);
            assert.ok(Math.max(...t) <= baseline.afterStart.timeouts, `timeouts per round: ${t.join(',')}`);
            assert.ok(Math.max(...t) - Math.min(...t) <= 1, `timeouts per round: ${t.join(',')}`);
        });

        // ---- rollbacks in the running server
        let good = null; // the last good state
        const goodMark = 'before-rollbacks';
        await phase('a good state to roll back to', async () => {
            writeTmp(goodMark);
            const r = await reload([HTMP]);
            assert.ok(r.ok, r.error);
            good = await rpc('probe');
            common('before rollbacks', good, goodMark);
        });
        const afterRollback = async (label, r, errRe) => {
            assert.strictEqual(r.ok, false, `${label}: the reload reports the failure`);
            assert.match(r.error, errRe, `${label}: ${r.error}`);
            assert.ok(r.results.some((x) => x.ok === false), `${label}: ${JSON.stringify(r.results)}`);
            const p = await rpc('probe');
            common(label, p, goodMark); // still the previous string, same types, same counts, work and timers kept
            assert.deepStrictEqual(p.snap, good.snap, `${label}: counts unchanged ${JSON.stringify([good.snap, p.snap])}`);
            assert.strictEqual(p.mods.tmp.mod, good.mods.tmp.mod, `${label}: the old module object is back in the cache`);
            return p;
        };
        await phase('rollback: a syntax error -> ok:false, nothing touched, the old handler still answers the previous string', async () => {
            writeTmp('syntax-error', 'syntax');
            const r = await reload([HTMP]);
            const p = await afterRollback('syntax error', r, /does not compile \(nothing was touched\)/);
            assert.strictEqual(p.fnTmp, good.fnTmp, 'syntax error: the handler function was not even replaced');
        });
        await phase('rollback: a registerPackets that throws -> ok:false, the old types are registered again and answer the previous string', async () => {
            writeTmp('register-throws', 'register-throws');
            const r = await reload([HTMP]);
            await afterRollback('registerPackets throws', r, /could not re-wire it: .*register boom.*rolled back/);
        });
        await phase('rollback: a load that throws -> ok:false, the old handler still answers the previous string', async () => {
            writeTmp('load-throws', 'load-throws');
            const r = await reload([HTMP]);
            await afterRollback('load throws', r, /loading the new version threw: .*load boom.*rolled back/);
        });
        await phase('rollback inside a batch: a good reload of the Supervisor before the failing handler is undone, then everything still works', async () => {
            writeTmp('batch-fail', 'register-throws');
            const before = await rpc('probe');
            const r = await reload([SUP, HTMP]);
            assert.strictEqual(r.ok, false, 'the batch fails');
            assert.ok(r.results.some((x) => x.file === SUP && x.rolledBack), `the Supervisor of the same batch was rolled back: ${JSON.stringify(r.results)}`);
            const p = await rpc('probe');
            common('batch rollback', p, goodMark);
            assert.strictEqual(p.mods.sup.mod, before.mods.sup.mod, 'the Supervisor is the version it was before the batch');
            assert.deepStrictEqual(p.snap, good.snap, `counts unchanged ${JSON.stringify([good.snap, p.snap])}`);
        });
        await phase('then a good change reloads again, counts unchanged', async () => {
            writeTmp('after-rollbacks');
            const r = await reload([HTMP]);
            assert.ok(r.ok && r.results.every((x) => x.ok), r.error);
            const p = await rpc('probe');
            common('after rollbacks', p, 'after-rollbacks');
            assert.notStrictEqual(p.fnTmp, good.fnTmp, 'a new handler function');
            assert.deepStrictEqual(p.snap, good.snap, `counts unchanged ${JSON.stringify([good.snap, p.snap])}`);
        });

        await phase('stop(): intervals, watchers and servers return to what they were before start; the child exits 0', async () => {
            const f = await rpc('finish');
            const a = f.after; const b = f.base;
            assert.deepStrictEqual([a.intervals, a.watchers, a.servers], [b.intervals, b.watchers, b.servers], `${JSON.stringify([b, a])}`);
            assert.deepStrictEqual(f.networkAttempts, [], 'no network attempt');
            assert.strictEqual(f.modelCalls, 0, 'no model call');
            await rpc('exit');
            await Promise.race([exited, sleep(10000).then(() => { throw new Error('the test server did not exit in 10 s'); })]);
            assert.strictEqual(exitCode, 0, `the test server exit code ${exitCode}\n${out.slice(-1500)}`);
            console.log(`     intervals/watchers/servers: before start ${b.intervals}/${b.watchers}/${b.servers}, after start ${baseline.afterStart.intervals}/${baseline.afterStart.watchers}/${baseline.afterStart.servers} (constant in all ${ROUNDS} rounds), after stop ${a.intervals}/${a.watchers}/${a.servers}; timeouts ${[...new Set(roundsLog.map((s) => s.timeouts))].join(',')}`);
        });
    } catch (e) {
        log(false, 'the test run', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
    } finally {
        clearTimeout(watchdog);
        try { if (exitCode === null) child.kill('SIGKILL'); } catch (_) { /* gone */ }
        cleanup();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }

    log(!fs.existsSync(tmpHandlerAbs), 'the temp handler file is gone');
    const st = spawnSync('git', ['status', '--porcelain', '--', HTMP], { cwd: ROOT, encoding: 'utf8' });
    log(st.status === 0 && st.stdout.trim() === '', 'git status does not show the temp handler', st.stdout || st.stderr);
    if (failed) console.log(`\n${failed} failed\n--- child output (tail) ---\n${out.slice(-1500)}`);
    else console.log(`\nall passed: ${ROUNDS} rounds of ${filesPerRound.join(', ')} through the reload socket; no extra intervals, watchers, servers or timeouts; state kept (open work item, stall and hold timers); the new code answered every time; rollbacks (syntax error, throwing registerPackets, throwing load, batch) kept the old code`);
    process.exit(failed ? 1 : 0);
}

if (process.argv.includes('--child') || process.env.HOT_LEAKS_CHILD === '1') runChild();
else runParent().catch((e) => { console.error(e); try { fs.unlinkSync(path.join(ROOT, HTMP)); } catch (_) { /* gone */ } process.exit(1); });
