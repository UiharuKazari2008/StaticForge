#!/usr/bin/env node
// Flow test for public/scripts/launch/melatonBoot.js (+ desktopStart.js) on a virtual clock:
// /status classification, a starting server staying on the boot screen (no cap), failure →
// boot menu (offline / unreachable / busy / session), teal handoff + hold, login redirect,
// countdown auto-retry, keyboard + touch, F8, the BIOS before the boot screen, the installation
// media (loading bar, Setup's pages, Format, Setup is restarting), design mode.
// Yozora #416, #417, #611. Run: node scripts/test-melaton-boot.js
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
    const t = { now: 0, renders: [], replaced: [], storage: {}, local: Object.assign(opts.fresh ? {} : { melatonInstalled: '1' }, opts.local || {}), intervals: new Map(), nextId: 1, fetches: [] };
    const answers = statusAnswers.slice();
    const env = {
        now: () => t.now,
        // yieldSleep: one macrotask per sleep so keys can land during the BIOS POST
        sleep: opts.yieldSleep ? (ms) => new Promise((r) => setImmediate(() => { t.now += ms; r(); })) : async (ms) => { t.now += ms; },
        localStorage: {
            getItem: (k) => (k in t.local ? t.local[k] : null),
            setItem: (k, v) => { t.local[k] = String(v); },
            removeItem: (k) => { delete t.local[k]; },
            clear: () => { Object.keys(t.local).forEach((k) => delete t.local[k]); }
        },
        installerAssets: opts.installerAssets || ['/css/launch-install.css'],
        bios: opts.bios || null,
        readProductKey: () => opts.productKey || '',
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
        games: opts.games || null,
        fetch: async (url, init) => {
            t.fetches.push(url);
            if (url === '/app') {
                const s = opts.session || 200;
                if (s === 'network') throw networkErr();
                return s === 200 ? { ok: true, status: 200 } : { ok: false, status: s };
            }
            if (url === '/install/license.txt') return { ok: true, status: 200, text: async () => 'README text' };
            if (url === '/install/product-key') {
                t.productKeyPosts = (t.productKeyPosts || []).concat([JSON.parse(init.body).key]);
                return opts.keyAnswer ? opts.keyAnswer() : { ok: true, status: 200, json: async () => ({ success: true }) };
            }
            if (url !== '/status') return { ok: true, status: 200 };
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
    assert.deepStrictEqual(h.t.screens(), ['bios', 'boot', 'black'], 'the POST, then never leaves the boot screen while the server starts, then black');
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
    assert.deepStrictEqual(h.t.screens(), ['bios', 'boot', 'black', 'menu'], 'cut to black, then the menu');
    assert.strictEqual(h.t.fetches.length, boot.config.maxFailures + 1, `the POST's own probe, then the menu after ${boot.config.maxFailures} errors in a row`);
    assert.strictEqual(h.t.last().data.info, boot.INFO.unreachable);
    assert.strictEqual(h.t.last().data.countdown, boot.config.countdownSec);
    assert.deepStrictEqual(h.t.last().data.entries.map((e) => e.label), [
        'Dreamscape Melaton',
        'Dreamscape Melaton (via System Restore)',
        'Dreamscape Melaton (Safe Mode with Networking)',
        'Melaton Recovery'
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
    assert.deepStrictEqual(h.t.screens(), ['menu', 'black', 'bios', 'boot', 'black', 'menu'],
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
    h.ctl.handleKey('ArrowUp');
    h.ctl.handleKey('ArrowUp');
    h.ctl.handleKey('ArrowUp');
    h.ctl.handleKey('Enter');
    await flush();
    assert.strictEqual(h.ctl.screen, 'menu', 'retry ran the checks again and failed again');
    assert.ok(h.t.screens().includes('boot'));

    // ---------- touch: a tap chooses; Recovery boots the installation media (Setup asks the rest) ----------
    h = harness([networkErr()]);
    await h.ctl.runChecks();
    const recoveryIndex = boot.ENTRIES.findIndex((entry) => entry.id === 'recovery');
    h.t.renders.length = 0;
    await h.ctl.handlePointer('choose', recoveryIndex, 'touch');
    assert.deepStrictEqual(h.t.screens().slice(-4), ['black', 'loading', 'black', 'menu'], 'Recovery cuts to black and boots the media; an unreachable server is a media error');
    assert.strictEqual(h.t.last().data.info, boot.INFO.media);

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
    assert.ok(['cancelled', 'menu'].includes(await pending), 'the dropped check never boots');
    assert.deepStrictEqual(h.t.replaced, [], 'the dropped check never hands off');
    assert.strictEqual(h.ctl.handleKey('F8'), true, 'F8 on the menu just stops the countdown');

    // F8 before the controller exists: the head listener's flag opens the menu with no status poll
    globalThis.melatonBootInterrupt = true;
    h = harness([json(true)]);
    assert.strictEqual(await h.ctl.runChecks(), 'menu');
    assert.strictEqual(h.t.fetches.length, 0, 'the interrupt wins before the first status poll');
    assert.strictEqual(h.t.last().data.countdown, null);
    assert.strictEqual(globalThis.melatonBootInterrupt, false);

    // ---------- the BIOS runs first (phoenixBios.js): the POST, then the Hard Drive boots ----------
    {
        const bios = require('../public/scripts/launch/phoenixBios.js');
        h = harness([json(true)], { bios, yieldSleep: true });
        const run = h.ctl.runChecks();
        for (let i = 0; i < 3; i++) await flush();
        assert.strictEqual(h.ctl.screen, 'bios', 'the POST is the first screen');
        assert.strictEqual(h.ctl.bios.state, 'splash');
        assert.strictEqual(await run, 'teal');
        assert.deepStrictEqual(h.t.screens(), ['bios', 'boot', 'black'], 'BIOS, boot screen, the mode switch');
        assert.ok(h.t.now >= bios.config.splashMs + boot.config.minBootMs, 'the POST adds its own time');

        // F8 during the POST: the Boot Manager right after it
        h = harness([json(true)], { bios, yieldSleep: true });
        const run2 = h.ctl.runChecks();
        for (let i = 0; i < 3; i++) await flush();
        assert.strictEqual(h.ctl.handleKey('F8'), true);
        assert.strictEqual(await run2, 'menu');
        assert.strictEqual(h.t.last().data.countdown, null);
        assert.ok(h.t.fetches.length <= 1, 'only the POST probed before the menu');

        // F2 goes to the BIOS, which owns the keys until it exits
        h = harness([json(true)], { bios, yieldSleep: true });
        const run3 = h.ctl.runChecks();
        for (let i = 0; i < 3; i++) await flush();
        assert.strictEqual(h.ctl.handleKey('F2'), true);
        for (let i = 0; i < 400 && h.ctl.bios.state !== 'setup'; i++) await flush();
        assert.strictEqual(h.ctl.bios.state, 'setup');
        assert.strictEqual(h.ctl.handleKey('F10'), true);
        h.ctl.handleKey('Enter');
        assert.strictEqual(await run3, 'teal');

        // nothing installed: the Hard Drive is skipped and the installation media boots
        h = harness([json(true)], { bios, fresh: true, yieldSleep: true });
        const run4 = h.ctl.runChecks();
        for (let i = 0; i < 1200 && h.ctl.screen !== 'loading'; i++) await flush();
        assert.strictEqual(h.ctl.screen, 'loading');
        h.ctl.runId += 1; // stop it there
        await run4;
    }

    // ---------- Melaton Recovery: the installation media, loading bar, Setup's pages ----------
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
    // seven errors reach the menu (the POST's probe and six under the boot screen), then the server answers
    const mediaEngine = () => ({
        readState: () => null, writeState: () => {}, readRecord: () => ({ files: 10 }), writeRecord: () => {},
        forgetManifest: () => {}, ensureWorker: async () => true, needsInstaller: () => true,
        check: async () => ({ files: [], bytes: 0 }), copyPack: async () => ({ ok: true }), expandPack: async () => ({ ok: true, missing: [] }),
        installGroup: async () => ({ ok: true, mismatched: [] }), verify: async () => [], download: async () => ({ ok: true })
    });
    h = harness([...Array(7).fill(networkErr()), json(true)], { window: fakeWindow, engine: mediaEngine() });
    await h.ctl.runChecks();
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('ArrowDown');
    h.ctl.handleKey('Enter');
    for (let i = 0; i < 400 && h.ctl.screen !== 'install'; i++) await flush();
    assert.deepStrictEqual(h.t.screens().slice(-4), ['black', 'loading', 'black', 'install'], 'black, the loading bar, black, Setup');
    const loads = h.t.renders.filter((r) => r.screen === 'loading').map((r) => r.data.progress);
    assert.ok(loads.every((f, i) => i === 0 || f >= loads[i - 1]) && loads[loads.length - 1] === 1, 'the loading bar only moves forward and fills');
    assert.ok(h.t.fetches.includes('/css/launch-install.css'), "Setup's own files are fetched under the bar");
    assert.ok(h.t.now >= boot.config.loadingMinMs, 'the bar shows at least loadingMinMs');
    assert.strictEqual(boot.loadingBarCells(0.5), 38, 'the bar fills in whole character cells');
    assert.strictEqual(boot.loadingBarCells(0.999), 75);
    assert.strictEqual(h.t.last().data.page, 'language');
    assert.strictEqual(h.t.renders.filter((r) => r.screen === 'install')[0].data.phase, 'arrive', 'the aurora alone first');
    assert.strictEqual(h.ctl.handleKey('Enter'), true);
    assert.strictEqual(h.t.last().data.page, 'start', 'Next: Install now');
    h.ctl.handlePointer('setup-install');
    assert.strictEqual(h.t.last().data.page, 'key');
    assert.strictEqual(h.t.last().data.keyConfigured, true, 'a configured key shows starred');
    for (let i = 0; i < 40 && h.t.last().data.page === 'key'; i++) await flush();
    assert.strictEqual(h.t.last().data.page, 'license', 'the key page moves on by itself');
    assert.strictEqual(h.t.last().data.license, 'README text');
    h.ctl.handleKey('Enter');
    assert.strictEqual(h.t.last().data.page, 'license', 'Next needs the box ticked');
    h.ctl.handlePointer('setup-license-accept');
    h.ctl.handleKey('Enter');
    assert.strictEqual(h.t.last().data.page, 'type');
    assert.strictEqual(h.t.last().data.upgradeAllowed, true, 'an installation is there: Upgrade offered');
    h.ctl.handlePointer('setup-custom');
    assert.strictEqual(h.t.last().data.page, 'where');
    assert.strictEqual(h.t.last().data.disk[0].name, 'Disk 0 Partition 1 (Melaton)');
    assert.strictEqual(h.t.last().data.driveOptions, false);
    h.ctl.handlePointer('setup-format');
    assert.strictEqual(h.t.last().data.msgbox, null, 'Format needs Drive options open');
    h.ctl.handlePointer('setup-drive-options');
    assert.strictEqual(h.t.last().data.driveOptions, true);
    h.ctl.handlePointer('setup-format');
    assert.ok(h.t.last().data.msgbox && h.t.last().data.msgbox.buttons[0][1] === 'setup-format-ok', 'the format question');
    h.ctl.handleKey('Escape');
    assert.strictEqual(h.t.last().data.msgbox, null, 'Esc is Cancel');
    h.ctl.handlePointer('setup-format');
    h.ctl.handleKey('Enter');
    for (let i = 0; i < 400 && h.t.last().data.page !== 'restart'; i++) await flush();
    assert.deepStrictEqual(wiped.sort(), ['cache:image-cache-v1', 'cache:static-cache-v1', 'idb:blocked-db', 'idb:dreamscape', 'local', 'session', 'sw'].sort(), 'Format is the clean install');
    const formats = h.t.renders.filter((r) => r.screen === 'install' && r.data.formatting).map((r) => r.data.formatting.progress);
    assert.ok(formats.length && formats.every((f, i) => i === 0 || f >= formats[i - 1]), 'the formatting bar only moves forward');
    assert.strictEqual(h.t.last().data.page, 'restart', '"Setup is restarting..." after the format');
    assert.strictEqual(h.t.last().data.countdown, boot.config.restartSec);
    assert.deepStrictEqual(JSON.parse(h.t.local.melatonSetup).resume, 'install', 'the next boot goes straight to the checklist');
    for (let i = 0; i < boot.config.restartSec - 1; i++) h.t.tick();
    assert.strictEqual(h.t.last().data.countdown, 1);
    assert.deepStrictEqual(h.t.replaced, []);
    h.t.tick();
    for (let i = 0; i < 20 && !h.t.replaced.length; i++) await flush();
    assert.deepStrictEqual(h.t.replaced, ['/launch'], 'reboots into /launch');
    assert.strictEqual(h.t.screens().slice(-1)[0], 'black');

    // the next boot: no installation, the resume flag → the media → the checklist, no wizard
    {
        const fe = { ...mediaEngine(), readRecord: () => null, check: async () => ({ files: [{ url: '/f0.js', hash: 'h0', size: 1 }], bytes: 1 }) };
        h = harness([json(true)], { fresh: true, local: { melatonSetup: JSON.stringify({ resume: 'install', at: 1 }) }, engine: fe });
        assert.strictEqual(await h.ctl.runChecks(), 'reboot');
        assert.ok(h.t.screens().includes('loading') && h.t.screens().includes('install'));
        const pages = h.t.renders.filter((r) => r.screen === 'install').map((r) => r.data.page);
        assert.ok(pages.every((p) => p === 'install'), 'straight to Installing MeletonFX');
        assert.strictEqual(h.t.local.melatonSetup, undefined, 'the resume flag is consumed');
    }

    // Restart now skips the countdown
    h = harness([...Array(7).fill(networkErr()), json(true)], { window: fakeWindow, engine: mediaEngine() });
    await h.ctl.runChecks();
    h.ctl.handlePointer('choose', 3);
    for (let i = 0; i < 400 && h.ctl.screen !== 'install'; i++) await flush();
    h.ctl.preview('setup-restart');
    h.ctl.setup.restartNow = async () => { h.t.replaced.push('/launch'); };
    h.ctl.handlePointer('setup-restart-now');
    await flush();
    assert.deepStrictEqual(h.t.replaced, ['/launch']);

    // Upgrade: the digest is forgotten, a full check, the checklist in the same window
    {
        const calls = [];
        const fe = { ...mediaEngine(), forgetManifest: () => calls.push('forget'), check: async () => { calls.push('check'); return { files: [{ url: '/f0.js', hash: 'h0', size: 1 }], bytes: 1 }; }, copyPack: async () => { calls.push('copy'); return { ok: true }; } };
        h = harness([...Array(7).fill(networkErr()), json(true)], { engine: fe });
        await h.ctl.runChecks();
        h.ctl.handlePointer('choose', 3);
        for (let i = 0; i < 400 && h.ctl.screen !== 'install'; i++) await flush();
        h.ctl.setup.page = 'type';
        const before = h.t.renders.length;
        const up = h.ctl.setupAction('setup-upgrade');
        assert.strictEqual(await up, 'reboot');
        assert.ok(calls.indexOf('forget') < calls.lastIndexOf('check') && calls.includes('copy'), 'forget, check, then the pack');
        assert.ok(!h.t.renders.slice(before).some((r) => r.screen === 'install' && r.data.phase === 'arrive'), 'no second arrive: the window stays');
    }

    // nothing installed: no Upgrade, Custom reads Install; the empty disk has no partition to format
    h = harness([json(true)], { fresh: true, engine: { ...mediaEngine(), readRecord: () => null } });
    {
        const run = h.ctl.runChecks();
        for (let i = 0; i < 1200 && h.ctl.screen !== 'install'; i++) await flush();
        assert.strictEqual(h.ctl.screen, 'install');
        assert.strictEqual(h.t.last().data.page, 'language');
        h.ctl.setup.page = 'type';
        h.ctl.setupAction('setup-custom');
        assert.strictEqual(h.t.last().data.upgradeAllowed, false);
        assert.strictEqual(h.t.last().data.disk[0].name, 'Disk 0 Unallocated Space');
        h.ctl.runId += 1;
        await run;
    }

    // the product key page takes a key when the server has none, and stores it
    h = harness([...Array(7).fill(networkErr()), json(true, { novelaiKeyConfigured: false })], { engine: mediaEngine(), productKey: 'pst-abc' });
    await h.ctl.runChecks();
    h.ctl.handlePointer('choose', 3);
    for (let i = 0; i < 400 && h.ctl.screen !== 'install'; i++) await flush();
    h.ctl.setupAction('setup-next');
    h.ctl.handlePointer('setup-install');
    for (let i = 0; i < 40; i++) await flush();
    assert.strictEqual(h.t.last().data.page, 'key', 'no key on the server: the page waits');
    assert.strictEqual(h.t.last().data.keyConfigured, false);
    h.ctl.handleKey('Enter');
    for (let i = 0; i < 40 && h.t.last().data.page === 'key'; i++) await flush();
    assert.deepStrictEqual(h.t.productKeyPosts, ['pst-abc'], 'the key goes to the server');
    assert.strictEqual(h.t.last().data.page, 'license');

    // the window's close box asks, then reboots
    h.ctl.handlePointer('setup-close');
    assert.ok(h.t.last().data.msgbox && h.t.last().data.msgbox.buttons[0][1] === 'setup-cancel-yes');
    await h.ctl.setupAction('setup-cancel-yes');
    assert.deepStrictEqual(h.t.replaced, ['/launch']);

    // the media cannot be read: the boot menu says so
    h = harness([networkErr()], { fresh: true, engine: { ...mediaEngine(), readRecord: () => null } });
    assert.strictEqual(await h.ctl.runChecks(), 'menu');
    assert.strictEqual(h.t.last().data.info, boot.INFO.media);

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
    for (const name of ['menu', 'menu-info', 'loading', 'teal', 'black', 'boot', 'bios']) {
        h.ctl.preview(name);
        assert.strictEqual(h.ctl.screen, name.replace(/-(info)$/, ''));
    }
    for (const name of ['setup', 'setup-start', 'setup-key', 'setup-key-entry', 'setup-license', 'setup-type', 'setup-type-fresh', 'setup-where', 'setup-where-options', 'setup-format', 'setup-formatting', 'setup-cancel', 'setup-restart']) {
        h.ctl.preview(name);
        assert.strictEqual(h.ctl.screen, 'install', name);
    }
    assert.strictEqual(h.t.last().data.page, 'restart');
    h.ctl.preview('setup-format');
    await h.ctl.setupAction('setup-format-ok');
    assert.deepStrictEqual(wiped, [], 'design-mode Format never wipes');
    assert.deepStrictEqual(h.t.replaced, [], 'design mode never navigates');
    h.ctl.preview('menu');
    await h.ctl.handOff();
    assert.deepStrictEqual(h.t.storage, {}, 'design-mode handoff leaves no handoff');

    // ---------- updates under the boot screen and the installer (#419) ----------
    const files = (n) => Array.from({ length: n }, (_, i) => ({ url: `/f${i}.js`, hash: `h${i}`, size: 100 }));
    function fakeEngine(plan) {
        const store = { state: plan.resume ? { active: true, total: 9 } : null, record: null, prior: plan.prior || null };
        const calls = [];
        const engine = {
            readState: () => store.state,
            writeState: (_env, st) => { store.state = st ? { ...st, active: true } : null; },
            writeRecord: (_env, rec) => { store.record = rec; },
            readRecord: () => store.prior || null,
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
    assert.deepStrictEqual(u.t.screens(), ['bios', 'boot', 'black', 'loading', 'black', 'install', 'black'], 'POST → boot → black → the loading bar → black → Setup → black');
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

    // Setup's games (launchGames.js): the toolbar shows with the checklist, Setup waits at each
    // step while a game comes off the media, and a game still open at the end holds the restart
    // (a message box behind it, Restart now) instead of the linger
    {
        const log = [];
        const games = (open) => ({
            show: () => log.push('show'),
            hide: () => log.push('hide'),
            close: () => log.push('close'),
            busy: () => open,
            gate: () => { log.push('gate'); return Promise.resolve(); },
            holdRestart: (o) => { log.push('hold:' + (o.upgrade ? 'upgrade' : 'install')); return Promise.resolve('restart'); },
            upgradeLite: (onProgress) => { log.push('lite'); onProgress(1); return Promise.resolve({ replaced: 1, left: 0 }); }
        });
        u = await runWith({ checks: [{ files: files(50), bytes: 5000 }, { files: [], bytes: 0 }] }, { games: games(true) });
        assert.strictEqual(u.result, 'reboot');
        assert.deepStrictEqual(log, ['show', 'gate', 'gate', 'gate', 'gate', 'lite', 'hold:install', 'close'], 'toolbar, a gate before each later step, the light copies replaced, the held restart');
        assert.deepStrictEqual(u.t.replaced, ['/launch'], 'Restart now reboots /launch');
        const heldAt = u.t.now;

        log.length = 0;
        u = await runWith({ checks: [{ files: files(50), bytes: 5000 }, { files: [], bytes: 0 }], prior: { files: 10 } }, { games: games(false) });
        assert.strictEqual(u.result, 'reboot');
        assert.ok(!log.some((l) => l.startsWith('hold')), 'no game open: the usual linger and reboot');
        assert.strictEqual(log[log.length - 1], 'close');
        assert.ok(u.t.now - heldAt >= boot.config.installLingerMs, 'held: Restart now instead of the linger');
    }

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
    // an earlier install's stragglers are not this install's: Expanding still finds them wanting
    // (a subset pack never carries them), but only the install's own list counts; they stay recorded
    const old = Array.from({ length: 12 }, (_, i) => `/old${i}.js`);
    u = await runWith({
        checks: [{ files: files(5), bytes: 500 }, { files: [], bytes: 0 }],
        expand: () => ({ ok: true, missing: old.concat(['/f1.js']) })
    });
    assert.strictEqual(u.result, 'reboot', 'files outside the install list never fail it');
    assert.deepStrictEqual(u.store.record.stragglers, ['/f1.js'].concat(old));

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
