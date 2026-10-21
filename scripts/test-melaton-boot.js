#!/usr/bin/env node
// Flow test for public/scripts/launch/melatonBoot.js (+ desktopStart.js) on a virtual clock:
// /status classification, a starting server staying on the boot screen (no cap), failure →
// boot menu (offline / unreachable / busy / session), teal handoff + hold, login redirect,
// countdown auto-retry, keyboard + touch, F8, Melaton Recovery clean install, design mode.
// Yozora #416, #417. Run: node scripts/test-melaton-boot.js
const assert = require('assert');
const boot = require('../public/scripts/launch/melatonBoot.js');
const { isDesktopStart, appEntryPath } = require('../public/scripts/launch/desktopStart.js');

// ---------- desktop start rule (same as app.html isDesktop) ----------
const store = (mode) => ({ getItem: () => mode });
assert.strictEqual(isDesktopStart({ innerWidth: 1920, localStorage: store(null) }), true, 'wide, no saved mode → desktop');
assert.strictEqual(isDesktopStart({ innerWidth: 1920, localStorage: store('windowed') }), true);
assert.strictEqual(isDesktopStart({ innerWidth: 1920, localStorage: store('maximized') }), false, 'maximized gallery is not the desktop');
assert.strictEqual(isDesktopStart({ innerWidth: 1000, localStorage: store('windowed') }), false, 'narrow is never the desktop');
assert.strictEqual(isDesktopStart({ innerWidth: 1600, localStorage: { getItem() { throw new Error('blocked'); } } }), true, 'blocked storage → width default');
assert.strictEqual(appEntryPath({ innerWidth: 1920, localStorage: store(null) }), '/launch');
assert.strictEqual(appEntryPath({ innerWidth: 800, localStorage: store(null) }), '/app');

// ---------- harness ----------
const json = (isReady, extra) => ({ ok: true, status: 200, json: async () => ({ isReady, stageMessage: isReady ? 'Starting Dreamscape…' : 'Loading…', ...extra }) });
const http = (status) => ({ ok: false, status, json: async () => { throw new Error('html'); } });
const timeoutErr = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
const networkErr = () => new TypeError('Failed to fetch');

function harness(statusAnswers, opts = {}) {
    const t = { now: 0, renders: [], replaced: [], storage: {}, intervals: new Map(), nextId: 1, fetches: [] };
    const answers = statusAnswers.slice();
    const env = {
        now: () => t.now,
        sleep: async (ms) => { t.now += ms; },
        setInterval: (fn) => { const id = t.nextId++; t.intervals.set(id, fn); return id; },
        clearInterval: (id) => { t.intervals.delete(id); },
        navigator: { onLine: opts.offline ? false : true },
        sessionStorage: {
            setItem: (k, v) => { t.storage[k] = v; },
            removeItem: (k) => { delete t.storage[k]; }
        },
        location: { replace: (url) => t.replaced.push(url) },
        designMode: !!opts.designMode,
        window: opts.window || {},
        engine: opts.engine || null,
        fetch: async (url) => {
            t.fetches.push(url);
            if (url === '/app') {
                const s = opts.session || 200;
                if (s === 'network') throw networkErr();
                return s === 200 ? { ok: true, status: 200 } : { ok: false, status: s };
            }
            const next = answers.length > 1 ? answers.shift() : answers[0];
            t.now += 50;
            if (typeof next === 'function') return next();
            if (next instanceof Error) throw next;
            return next;
        }
    };
    const view = { render: (screen, data) => t.renders.push({ screen, data: JSON.parse(JSON.stringify(data)) }) };
    const ctl = boot.createController(env, view);
    t.tick = () => [...t.intervals.values()].forEach((fn) => fn());
    t.last = () => t.renders[t.renders.length - 1];
    t.screens = () => t.renders.map((r) => r.screen).filter((s, i, a) => s !== a[i - 1]);
    return { ctl, t, env };
}
const flush = () => new Promise((r) => setImmediate(r));

(async () => {
    // ---------- probe classification ----------
    const probe = (answer) => boot.probeStatus({ navigator: { onLine: true }, fetch: async () => { if (answer instanceof Error) throw answer; return answer; } });
    assert.deepStrictEqual((await probe(json(false))).kind, 'json');
    assert.deepStrictEqual(await probe(http(502)), { kind: 'http', status: 502 }, 'proxy error page');
    assert.deepStrictEqual((await probe({ ok: true, status: 200, json: async () => ({ hello: 1 }) })).kind, 'http', 'JSON without isReady is not /status');
    assert.deepStrictEqual(await probe(timeoutErr()), { kind: 'timeout' });
    assert.deepStrictEqual(await probe(networkErr()), { kind: 'network' });
    assert.deepStrictEqual(await boot.probeStatus({ navigator: { onLine: false }, fetch: () => assert.fail('no fetch when offline') }), { kind: 'offline' });

    // ---------- a starting server is a connection: boot screen until ready, then teal ----------
    let h = harness([json(false), json(false), json(false), json(true)]);
    assert.strictEqual(await h.ctl.runChecks(), 'teal');
    assert.deepStrictEqual(h.t.screens(), ['boot', 'black'], 'never leaves the boot screen while the server starts, then black');
    assert.deepStrictEqual(h.t.replaced, ['/app']);
    assert.strictEqual(h.t.storage.dreamscapeLaunchHandoff, 'teal');
    assert.strictEqual(Number(h.t.storage.dreamscapeBootTealHoldUntil), h.t.now + boot.config.tealHoldMs, 'logon dialog waits 2 s after /app takes over');
    assert.ok(h.t.now >= boot.config.minBootMs + boot.config.modeSwitchMs, 'boot screen at least minBootMs, then the black mode switch');

    h = harness([...Array(400).fill(json(false)), json(true)]);
    assert.strictEqual(await h.ctl.runChecks(), 'teal', 'no cap on a server that keeps answering while it starts');
    assert.ok(h.t.now > 10 * 60 * 1000, 'that boot ran past ten minutes on the boot screen');

    h = harness([networkErr(), http(502), networkErr(), timeoutErr(), networkErr(), json(false), json(true)]);
    assert.strictEqual(await h.ctl.runChecks(), 'teal', 'a restart (proxy errors, busy timeouts, then answers) stays on the boot screen');
    assert.ok(!h.t.screens().includes('menu'));

    // ---------- failures → black → boot menu with the reason ----------
    h = harness([networkErr()]);
    assert.strictEqual(await h.ctl.runChecks(), 'menu');
    assert.deepStrictEqual(h.t.screens(), ['boot', 'black', 'menu'], 'cut to black, then the menu');
    assert.strictEqual(h.t.fetches.length, boot.config.maxFailures, `menu after ${boot.config.maxFailures} errors in a row`);
    assert.strictEqual(h.t.last().data.info, boot.INFO.unreachable);
    assert.strictEqual(h.t.last().data.countdown, boot.config.countdownSec);
    assert.deepStrictEqual(h.t.last().data.entries.map((e) => e.label), [
        'Dreamscape Melaton',
        'Dreamscape Melaton (via System Restore)',
        'Dreamscape Melaton (Safe Mode with Networking)',
        'Melaton Recovery (Reinstall)'
    ]);

    h = harness([timeoutErr()]);
    assert.strictEqual(await h.ctl.runChecks(), 'menu');
    assert.strictEqual(h.t.last().data.info, boot.INFO.busy);
    assert.ok(h.t.now >= boot.config.busyTimeoutMs, 'busy timeouts get the long grace');

    h = harness([json(true)], { offline: true });
    assert.strictEqual(await h.ctl.runChecks(), 'menu');
    assert.strictEqual(h.t.last().data.info, boot.INFO.offline);
    assert.strictEqual(h.t.fetches.length, 0);

    h = harness([json(true)], { session: 503 });
    assert.strictEqual(await h.ctl.runChecks(), 'menu');
    assert.strictEqual(h.t.last().data.info, boot.INFO.session);

    h = harness([json(true)], { session: 401 });
    assert.strictEqual(await h.ctl.runChecks(), 'login');
    assert.deepStrictEqual(h.t.replaced, ['/'], 'signed out → login page');

    // ---------- countdown: ticks down, auto-retries the highlighted entry ----------
    h = harness([networkErr()]);
    await h.ctl.runChecks();
    for (let i = 0; i < boot.config.countdownSec - 1; i++) h.t.tick();
    assert.strictEqual(h.t.last().data.countdown, 1);
    h.t.renders.length = 0;
    h.t.tick();
    await flush();
    assert.deepStrictEqual(h.t.screens(), ['menu', 'black', 'boot', 'black', 'menu'],
        'at 0: Dreamscape Melaton starts (black → boot screen), fails again → menu');
    assert.strictEqual(h.t.intervals.size, 1, 'the old countdown is gone, a fresh one runs');
    assert.strictEqual(h.t.last().data.countdown, boot.config.countdownSec);

    // ---------- keyboard: any key stops the countdown; arrows, Enter, Esc ----------
    h = harness([networkErr()]);
    await h.ctl.runChecks();
    assert.strictEqual(h.ctl.handleKey('ArrowDown'), true);
    assert.strictEqual(h.t.last().data.selected, 1);
    assert.strictEqual(h.t.last().data.countdown, null, 'countdown line gone after a key');
    assert.strictEqual(h.t.intervals.size, 0);
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('ArrowDown');
    assert.strictEqual(h.t.last().data.selected, 3, 'no wrap past the last entry');
    h.ctl.handleKey('Enter');
    assert.strictEqual(h.ctl.screen, 'confirm', 'Recovery asks first');
    h.ctl.handleKey('Escape');
    assert.strictEqual(h.ctl.screen, 'menu');
    assert.strictEqual(h.t.last().data.selected, 3, 'back on Recovery');
    h.ctl.handleKey('ArrowUp');
    h.ctl.handleKey('ArrowUp');
    h.ctl.handleKey('ArrowUp');
    h.ctl.handleKey('Enter');
    await flush();
    assert.strictEqual(h.ctl.screen, 'menu', 'retry ran the checks again and failed again');
    assert.ok(h.t.screens().includes('boot'));

    // ---------- touch: tap = choose; Recovery by touch gets a two-item menu ----------
    h = harness([networkErr()]);
    await h.ctl.runChecks();
    const recoveryIndex = boot.ENTRIES.findIndex((entry) => entry.id === 'recovery');
    h.ctl.handlePointer('choose', recoveryIndex, 'mouse');
    assert.strictEqual(h.ctl.screen, 'confirm');
    assert.strictEqual(h.t.last().data.mode, 'keyboard', 'a mouse implies a keyboard: ENTER / ESC prompt');
    h.ctl.handlePointer('cancel', undefined, 'mouse');
    assert.strictEqual(h.ctl.screen, 'menu');
    h.ctl.handlePointer('choose', recoveryIndex, 'touch');
    assert.strictEqual(h.t.last().data.mode, 'touch', 'touch: no keyboard to assume');
    assert.deepStrictEqual(h.t.last().data.options.map((o) => o.label), ['Continue', 'Return to Boot Menu']);
    assert.strictEqual(h.t.last().data.selected, 0);
    h.ctl.handlePointer('option', 1, 'touch');
    assert.strictEqual(h.ctl.screen, 'menu', 'Return to Boot Menu');
    h.ctl.handlePointer('choose', recoveryIndex, 'pen');
    assert.strictEqual(h.t.last().data.mode, 'touch', 'a pen counts as touch');
    h.ctl.handleKey('ArrowDown');
    assert.strictEqual(h.t.last().data.selected, 1, 'the touch menu also takes arrows');
    h.ctl.handleKey('Enter');
    assert.strictEqual(h.ctl.screen, 'menu');

    // ---------- F8 on the boot screen: menu, no countdown, the running check is dropped ----------
    let release;
    h = harness([() => new Promise((r) => { release = r; })]);
    const pending = h.ctl.runChecks();
    await flush();
    assert.strictEqual(h.ctl.handleKey('F8'), true);
    await flush();
    assert.strictEqual(h.ctl.screen, 'menu');
    assert.strictEqual(h.t.last().data.countdown, null, 'F8 menu waits for a choice');
    assert.strictEqual(h.t.last().data.info, null);
    release(json(true));
    assert.strictEqual(await pending, 'cancelled');
    assert.deepStrictEqual(h.t.replaced, [], 'the dropped check never hands off');
    assert.strictEqual(h.ctl.handleKey('F8'), true, 'F8 on the menu just stops the countdown');

    // F8 before the controller exists: the head listener's flag opens the menu with no status poll
    globalThis.melatonBootInterrupt = true;
    h = harness([json(true)]);
    assert.strictEqual(await h.ctl.runChecks(), 'menu');
    assert.strictEqual(h.t.fetches.length, 0, 'the interrupt wins before the first status poll');
    assert.strictEqual(h.t.last().data.countdown, null);
    assert.strictEqual(globalThis.melatonBootInterrupt, false);

    // ---------- Melaton Recovery: clean install, every step reported, reboot /launch ----------
    const wiped = [];
    const fakeWindow = {
        caches: { keys: async () => ['static-cache-v1', 'image-cache-v1'], delete: async (n) => wiped.push(`cache:${n}`) },
        navigator: { serviceWorker: { getRegistrations: async () => [{ unregister: async () => wiped.push('sw') }] } },
        localStorage: { clear: () => wiped.push('local') },
        sessionStorage: { clear: () => wiped.push('session') },
        indexedDB: {
            databases: async () => [{ name: 'dreamscape' }, { name: 'blocked-db' }],
            deleteDatabase(name) {
                const req = {};
                setImmediate(() => { wiped.push(`idb:${name}`); (name === 'blocked-db' ? req.onblocked : req.onsuccess)(); });
                return req;
            }
        }
    };
    h = harness([networkErr()], { window: fakeWindow });
    await h.ctl.runChecks();
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('Enter');
    h.ctl.handleKey('Enter');
    for (let i = 0; i < 20 && !h.t.replaced.length; i++) await flush();
    assert.deepStrictEqual(wiped.sort(), ['cache:image-cache-v1', 'cache:static-cache-v1', 'idb:blocked-db', 'idb:dreamscape', 'local', 'session', 'sw'].sort());
    const recoverRenders = h.t.renders.filter((r) => r.screen === 'recover');
    const finalRecover = recoverRenders[recoverRenders.length - 1].data;
    assert.ok(finalRecover.restarting, '"Restarting..." shown');
    assert.strictEqual(finalRecover.progress, 1, 'formatting bar full');
    const fractions = recoverRenders.map((r) => r.data.progress);
    assert.ok(fractions.every((f, i) => i === 0 || f >= fractions[i - 1]), 'the formatting bar only moves forward');
    assert.ok(fractions.some((f) => f > 0 && f < boot.RECOVERY_STEPS[0].weight), 'it moves per cache inside a step');
    assert.deepStrictEqual(h.t.replaced, ['/launch'], 'reboots into /launch');
    assert.strictEqual(h.t.screens().slice(-1)[0], 'black');

    // a failing step does not stop the rest
    const partial = [];
    const progress = [];
    const results = await boot.cleanInstall({ now: () => 0, sleep: async () => {}, window: {
        caches: { keys: async () => { throw new Error('denied'); } },
        localStorage: { clear: () => partial.push('local') },
        sessionStorage: { clear: () => partial.push('session') }
    } }, () => {}, (f) => progress.push(f));
    assert.strictEqual(progress[progress.length - 1], 1, 'a failed step still completes the bar');
    assert.deepStrictEqual(results, { caches: false, serviceWorker: true, storage: true, indexedDb: true });
    assert.deepStrictEqual(partial, ['local', 'session']);
    // a failing step due to getter throwing SecurityError does not stop the rest
    const partial2 = [];
    const results2 = await boot.cleanInstall({ now: () => 0, sleep: async () => {}, window: {
        get caches() { throw new Error('SecurityError'); },
        get indexedDB() { throw new Error('SecurityError'); },
        get navigator() { throw new Error('SecurityError'); },
        localStorage: { clear: () => partial2.push('local') },
        sessionStorage: { clear: () => partial2.push('session') }
    } }, () => {}, () => {});
    assert.deepStrictEqual(results2, { caches: true, serviceWorker: true, storage: true, indexedDb: true }, 'SecurityError on getters caught');
    assert.deepStrictEqual(partial2, ['local', 'session']);


    // ---------- design mode: previews only ----------
    h = harness([json(true)], { designMode: true, window: fakeWindow });
    wiped.length = 0;
    assert.strictEqual(await h.ctl.runChecks(), 'design');
    assert.strictEqual(h.t.fetches.length, 0, 'no network in design mode');
    for (const name of ['menu', 'menu-info', 'confirm', 'confirm-touch', 'recover', 'teal', 'black', 'boot']) {
        h.ctl.preview(name);
        assert.strictEqual(h.ctl.screen, name.replace(/-(info|touch)$/, ''));
    }
    h.ctl.preview('confirm-touch');
    assert.strictEqual(h.t.last().data.mode, 'touch');
    h.ctl.preview('confirm');
    await h.ctl.recover();
    assert.deepStrictEqual(wiped, [], 'design-mode recovery never wipes');
    assert.deepStrictEqual(h.t.replaced, [], 'design mode never navigates');
    h.ctl.preview('menu');
    await h.ctl.handOff();
    assert.deepStrictEqual(h.t.storage, {}, 'design-mode handoff leaves no handoff');

    // ---------- updates under the boot screen and the installer (#419) ----------
    const files = (n) => Array.from({ length: n }, (_, i) => ({ url: `/f${i}.js`, hash: `h${i}`, size: 100 }));
    function fakeEngine(plan) {
        const store = { state: plan.resume ? { active: true, total: 9 } : null, record: null };
        const calls = [];
        const engine = {
            readState: () => store.state,
            writeState: (_env, st) => { store.state = st ? { ...st, active: true } : null; },
            writeRecord: (_env, rec) => { store.record = rec; },
            ensureWorker: async () => plan.worker !== false,
            check: async () => {
                calls.push('check');
                return plan.checks.length > 1 ? plan.checks.shift() : plan.checks[0];
            },
            needsInstaller: (_env, list) => !!store.state || list.length > 20,
            download: async (_env, list, opts = {}) => {
                calls.push(`download:${list.length}${opts.silent ? ':silent' : ''}`);
                if (opts.onProgress) {
                    opts.onProgress({ completed: list.length / 2, total: list.length, fraction: 0.5 });
                    opts.onProgress({ completed: list.length, total: list.length, fraction: 1 });
                }
                return plan.download ? plan.download(list) : { ok: true, errors: [] };
            },
            copyPack: async (_env, manifest, opts = {}) => {
                calls.push('copyPack');
                if (Array.isArray(opts.subset)) calls.push(`subset:${opts.subset.length}`);
                if (opts.onProgress) opts.onProgress({ fraction: 0.5 });
                if (opts.onProgress) opts.onProgress({ fraction: 1 });
                if (plan.copyPack) return plan.copyPack(manifest);
                if (plan.download) {
                    const result = plan.download(manifest);
                    return { ok: result.ok, stalled: !!result.stalled, error: result.errors && result.errors[0] };
                }
                return { ok: true };
            },
            expandPack: async (_env, manifest, opts = {}) => {
                calls.push('expandPack');
                if (opts.onProgress) opts.onProgress({ fraction: 1 });
                if (plan.expand) return plan.expand(manifest);
                if (plan.verify) {
                    const missing = plan.verify(manifest);
                    return { ok: true, missing: missing.map((file) => file.url || file) };
                }
                return { ok: true, missing: [] };
            },
            installGroup: async (_env, group, opts = {}) => {
                calls.push(`group:${group}`);
                if (opts.onProgress) opts.onProgress({ fraction: 1 });
                return plan.group ? plan.group(group) : { ok: true, mismatched: [] };
            },
            verify: async (_env, list) => (plan.verify ? plan.verify(list) : [])
        };
        return { engine, store, calls };
    }
    const runWith = async (plan, opts = {}) => {
        const fe = fakeEngine(plan);
        const hh = harness([json(true)], { ...opts, engine: fe.engine });
        const result = await hh.ctl.runChecks();
        return { ...hh, ...fe, result };
    };

    // System Restore skips updates. Safe Mode keeps the VGA flag for /app.
    {
        const fe = fakeEngine({ checks: [{ files: files(50), bytes: 5000 }], resume: true });
        h = harness([json(true)], { engine: fe.engine });
        h.ctl.bootMode = 'restore';
        assert.strictEqual(await h.ctl.runChecks(), 'teal');
        assert.deepStrictEqual(fe.calls, [], 'restore does not check or copy');
        assert.strictEqual(fe.store.state, null, 'a resumed install is dropped');
        assert.deepStrictEqual(h.t.replaced, ['/app']);
        assert.ok(!('melatonSafeMode' in h.t.storage));
    }
    {
        const fe = fakeEngine({ checks: [{ files: [], bytes: 0 }] });
        h = harness([json(true)], { engine: fe.engine });
        h.ctl.bootMode = 'safe';
        assert.strictEqual(await h.ctl.runChecks(), 'teal');
        assert.deepStrictEqual(fe.calls, ['check'], 'safe mode still applies updates');
        assert.strictEqual(h.t.storage.melatonSafeMode, '1');
    }

    // nothing to update: straight to teal
    let u = await runWith({ checks: [{ files: [], bytes: 0 }] });
    assert.strictEqual(u.result, 'teal');
    assert.deepStrictEqual(u.calls, ['check'], 'checked, nothing downloaded');

    // a few files: silently behind the boot screen, then teal
    u = await runWith({ checks: [{ files: files(5), bytes: 500 }] });
    assert.strictEqual(u.result, 'teal');
    assert.deepStrictEqual(u.calls, ['check', 'download:5:silent']);
    assert.ok(!u.t.screens().includes('install'), 'no installer for a small update');

    // a quiet download that does not land opens the installer instead of the boot menu
    u = await runWith({ checks: [{ files: files(5), bytes: 500 }], download: () => ({ ok: false, errors: ['no-worker'] }) });
    assert.strictEqual(u.result, 'error');
    assert.ok(u.t.screens().includes('install'), 'a failed quiet download enters the installer');
    assert.ok(!u.t.screens().includes('menu'), 'a failed quiet download is not the boot menu');

    // one missed file list is retried into the installer; a list that never arrives
    // stays on the boot screen until the busy budget, and does not open /app
    u = await runWith({ checks: [{ failed: true }, { files: files(50), bytes: 5000 }, { files: [], bytes: 0 }] });
    assert.strictEqual(u.result, 'reboot');
    assert.ok(u.t.screens().includes('install'), 'a retried file list still enters the installer');
    u = await runWith({ checks: [{ skipped: 'no-manifest' }, { files: files(50), bytes: 5000 }, { files: [], bytes: 0 }] });
    assert.strictEqual(u.result, 'reboot');
    assert.ok(u.t.screens().includes('install'), 'a compile skip must not hand off before the file list');
    assert.ok(!u.t.replaced.includes('/app'));
    u = await runWith({ checks: [{ failed: true }] });
    assert.strictEqual(u.result, 'menu');
    assert.ok(u.t.now >= boot.config.busyTimeoutMs, 'a missed file list keeps the boot screen until the busy budget');
    assert.ok(!u.t.replaced.includes('/app'), 'a missed file list must not leave for /app');
    assert.strictEqual(u.t.last().data.info, boot.INFO.cache);

    // no controlling worker: Setup still runs. Leaving for /app was the retry dialog.
    u = await runWith({ worker: false, checks: [{ files: files(50), bytes: 5000 }, { files: [], bytes: 0 }] });
    assert.strictEqual(u.result, 'reboot');
    assert.ok(u.t.screens().includes('install'), 'a missing worker still enters the installer');
    assert.ok(!u.t.replaced.includes('/app'), 'a missing worker must not leave for /app');

    // a large update: black, Setup, the checklist, linger, black, reboot /launch
    u = await runWith({ checks: [{ files: files(50), bytes: 5000 }, { files: [], bytes: 0 }] });
    assert.strictEqual(u.result, 'reboot');
    assert.deepStrictEqual(u.t.screens(), ['boot', 'black', 'install', 'black'], 'boot → black → Setup → black');
    assert.deepStrictEqual(u.t.replaced, ['/launch'], 'reboots into /launch, not /app');
    const installs = u.t.renders.filter((r) => r.screen === 'install');
    assert.ok(installs.some((r) => r.data.steps[0].state === 'active' && r.data.steps[0].fraction === 0.5), 'Copying shows its progress');
    const lastInstall = installs[installs.length - 1].data;
    assert.strictEqual(lastInstall.phase, 'linger', 'the window closes before the black');
    assert.ok(lastInstall.steps.every((step) => step.state === 'done'), 'every checklist line ticked');
    assert.ok(Math.abs(lastInstall.overall - 1) < 1e-9, 'second bar full');
    assert.strictEqual(u.store.state, null, 'install state cleared');
    assert.strictEqual(u.store.record.files, 50);
    assert.deepStrictEqual(u.calls, ['check', 'copyPack', 'subset:50', 'expandPack', 'group:features', 'group:updates'], 'the installer copies one pack, then expands and checks each group');
    assert.ok(installs.some((r) => r.data.phase === 'arrive'), 'aurora alone before the setup window');
    assert.ok(u.t.now >= boot.config.installLingerMs + boot.config.installArriveMs + 5 * boot.config.installStepMs, 'arrive, each line readable, then the linger');

    // the pack stalls: a Vista Basic message box; Retry stays in Setup and finishes
    let fails = 1;
    u = await runWith({
        checks: [{ files: files(50), bytes: 5000 }],
        download: () => (fails-- > 0 ? { ok: false, stalled: true, errors: [] } : { ok: true, errors: [] })
    });
    assert.strictEqual(u.result, 'error');
    let screenData = u.t.last().data;
    assert.strictEqual(screenData.phase, 'error');
    assert.strictEqual(screenData.error.reason, 'stalled');
    assert.ok(u.store.state && u.store.state.active, 'install state kept for a retry or a reload');
    assert.strictEqual(u.ctl.handleKey('a'), true, 'the installer swallows keys');
    const retried = await u.ctl.installRetry();
    assert.strictEqual(retried, 'reboot', 'Retry finishes the install');
    assert.ok(!u.t.renders.slice(-12).some((r) => r.screen === 'boot'), 'Retry does not go back to the boot screen');

    // Cancel: back to the boot menu, install state dropped
    u = await runWith({ checks: [{ files: files(50), bytes: 5000 }], download: () => ({ ok: false, errors: ['/f1.js: HTTP 500'] }) });
    assert.strictEqual(u.t.last().data.error.reason, 'download');
    assert.strictEqual(u.t.last().data.error.detail, '/f1.js: HTTP 500');
    await u.ctl.installCancel();
    assert.strictEqual(u.t.last().screen, 'menu');
    assert.strictEqual(u.t.last().data.info, boot.INFO.install);
    assert.strictEqual(u.store.state, null);

    // a few files the worker will not keep do not stop the install; they are remembered
    u = await runWith({ checks: [{ files: files(50), bytes: 5000 }, { files: [], bytes: 0 }], verify: (list) => list.slice(0, 3) });
    assert.strictEqual(u.result, 'reboot');
    assert.deepStrictEqual(u.store.record.stragglers, ['/f0.js', '/f1.js', '/f2.js']);
    assert.ok(!u.calls.includes('download:3'), 'stragglers stay in the pack result; they are not fetched again one by one');
    // but many missing files fail
    u = await runWith({ checks: [{ files: files(50), bytes: 5000 }], verify: (list) => list.slice(0, 30) });
    assert.strictEqual(u.result, 'error');
    assert.strictEqual(u.t.last().data.error.reason, 'verify');

    // a reload mid-install goes back into Setup even for a few files
    u = await runWith({ resume: true, checks: [{ files: files(3), bytes: 300 }, { files: [], bytes: 0 }] });
    assert.strictEqual(u.result, 'reboot');
    assert.ok(u.t.screens().includes('install'));

    // design previews of the installer
    h = harness([json(true)], { designMode: true });
    h.ctl.preview('install');
    assert.strictEqual(h.t.last().screen, 'install');
    assert.strictEqual(h.t.last().data.steps[0].state, 'active');
    h.ctl.preview('install-error');
    assert.strictEqual(h.t.last().data.phase, 'error');
    h.ctl.preview('install-linger');
    assert.strictEqual(h.t.last().data.phase, 'linger');

    // /app no longer has a second installer; large updates reboot here
    const fs = require('fs');
    const path = require('path');
    const appHtml = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8');
    const swSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/serviceWorkerManager.js'), 'utf8');
    assert.ok(!appHtml.includes('dreamscapeOsInstallWizardModal'), '/app has no install wizard');
    assert.ok(!swSrc.includes('_runInstallWizard'), '/app does not run an in-app wizard');
    assert.ok(swSrc.includes("location.replace('/launch')"), '/app reboots to /launch for Install MeletonFX');

    console.log('✅ test-melaton-boot: all assertions passed');
})().catch((err) => {
    console.error('❌ test-melaton-boot failed:', err);
    process.exit(1);
});
