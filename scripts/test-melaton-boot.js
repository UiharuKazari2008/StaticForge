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
        sessionStorage: { setItem: (k, v) => { t.storage[k] = v; } },
        location: { replace: (url) => t.replaced.push(url) },
        designMode: !!opts.designMode,
        window: opts.window || {},
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
    assert.deepStrictEqual(h.t.screens(), ['boot', 'teal'], 'never leaves the boot screen while the server starts');
    assert.deepStrictEqual(h.t.replaced, ['/app']);
    assert.strictEqual(h.t.storage.dreamscapeLaunchHandoff, 'teal');
    assert.strictEqual(Number(h.t.storage.dreamscapeBootTealHoldUntil), h.t.now + boot.config.tealHoldMs, 'logon dialog waits 2 s after the cut');
    assert.ok(h.t.now >= boot.config.minBootMs, 'boot screen shows at least minBootMs');

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
    assert.deepStrictEqual(h.t.last().data.entries.map((e) => e.label), ['Dreamscape Melaton', 'Melaton Recovery (Reinstall)']);

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
    assert.strictEqual(h.t.last().data.selected, 1, 'no wrap past the last entry');
    h.ctl.handleKey('Enter');
    assert.strictEqual(h.ctl.screen, 'confirm', 'Recovery asks first');
    h.ctl.handleKey('Escape');
    assert.strictEqual(h.ctl.screen, 'menu');
    assert.strictEqual(h.t.last().data.selected, 1, 'back on Recovery');
    h.ctl.handleKey('ArrowUp');
    h.ctl.handleKey('Enter');
    await flush();
    assert.strictEqual(h.ctl.screen, 'menu', 'retry ran the checks again and failed again');
    assert.ok(h.t.screens().includes('boot'));

    // ---------- touch: tap = choose; Recovery by touch gets a two-item menu ----------
    h = harness([networkErr()]);
    await h.ctl.runChecks();
    h.ctl.handlePointer('choose', 1, 'mouse');
    assert.strictEqual(h.ctl.screen, 'confirm');
    assert.strictEqual(h.t.last().data.mode, 'keyboard', 'a mouse implies a keyboard: ENTER / ESC prompt');
    h.ctl.handlePointer('cancel', undefined, 'mouse');
    assert.strictEqual(h.ctl.screen, 'menu');
    h.ctl.handlePointer('choose', 1, 'touch');
    assert.strictEqual(h.t.last().data.mode, 'touch', 'touch: no keyboard to assume');
    assert.deepStrictEqual(h.t.last().data.options.map((o) => o.label), ['Continue', 'Return to Boot Menu']);
    assert.strictEqual(h.t.last().data.selected, 0);
    h.ctl.handlePointer('option', 1, 'touch');
    assert.strictEqual(h.ctl.screen, 'menu', 'Return to Boot Menu');
    h.ctl.handlePointer('choose', 1, 'pen');
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
    h.ctl.cutToTeal();
    assert.deepStrictEqual(h.t.storage, {}, 'design-mode teal leaves no handoff');

    console.log('✅ test-melaton-boot: all assertions passed');
})().catch((err) => {
    console.error('❌ test-melaton-boot failed:', err);
    process.exit(1);
});
