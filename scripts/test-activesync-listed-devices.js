'use strict';
// #1299: test and emulator devices, and devices that are not set up, add no row and no tray line.
// The REAL files run in vm contexts with stubs (nothing copied):
//   public/scripts/comp/activeSyncAgent.js    isTestRow, isSetUp, listedDevices, awaitingSetup (window.activeSync)
//   public/scripts/comp/activeSyncTray.js     the notification-area icon: context menu, tooltip, icon, balloons
//   apps/activesync/client/activesync.js      Melaton Mobile Device Center: devices(), setUp(), device(), crumb menu
// Stubs: the page's wsClient (as_hello answers with the list we feed), a fake tray icon element, a recording
// contextMenu, melatonApps (records launches), PopoverManager (records balloons: no sound, no notice), and, for the
// Device Center window only, an "anything goes" DOM proxy (the window's build() / render() draw into it; its
// timers are collected and never run). No timer runs in this test.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const AGENT = read('public/scripts/comp/activeSyncAgent.js');
const TRAY = read('public/scripts/comp/activeSyncTray.js');
const CENTER = read('apps/activesync/client/activesync.js');

const hex = (c) => c.repeat(32);
const FOLD = hex('f');
const A53 = hex('b');
const PIXEL = hex('9');
const GUEST = hex('8');
const GHOST = hex('5');
const EMU_PARTNER = hex('6');
const TESTED = hex('7');
const PC = hex('c');

// the mixed state of the brief
const dev = (id, name, extra) => Object.assign({ deviceId: id, name, model: 'Phone', platform: 'android', partner: false, primary: false, online: false, session: null, permissions: [] }, extra || {});
const fold = dev(FOLD, 'Fold7', { model: 'SM-F966U1', partner: true, primary: true, online: true, session: 'partner', status: { battery: { level: 80, charging: false } } });
const a53 = dev(A53, 'Galaxy A53', { model: 'SM-A536B', partner: true, online: false });
const pixel = dev(PIXEL, 'Pixel 9 (not set up)', { model: 'Pixel 9', online: true, session: 'pending' });
const guest = dev(GUEST, 'Guest phone', { model: 'SM-S921B', online: true, session: 'guest' });
const ghost = dev(GHOST, 'Old phone', { model: 'SM-G991B' });
const emu = dev('emulator-5554', 'sdk_gphone64 emulator', { model: 'sdk_gphone64_x86_64', online: true, session: 'pending' });
const emuPartner = dev(EMU_PARTNER, 'Emulator partner', { model: 'sdk_gphone64_x86_64', partner: true, online: true, session: 'partner' });
const tested = dev(TESTED, 'Test lane phone', { model: 'SM-A536B', test: true, partner: true, online: true, session: 'partner' });
const pc = dev(PC, 'Desk PC', { model: 'Desktop', platform: 'cafeready', partner: true, online: true, session: 'partner' });
const MIXED = [fold, a53, pixel, guest, ghost, emu, emuPartner, tested, pc];
// arrays made inside a vm context have that context's prototype: copy them to this realm before deepStrictEqual
const arr = (list) => Array.from(list);
const names = (list) => Array.from(list, (d) => d.name);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ the page
function timers() {
    const t = [];
    return { list: t, setTimeout: (fn, ms) => { t.push({ fn, ms, kind: 'timeout' }); return t.length; }, setInterval: (fn, ms) => { t.push({ fn, ms, kind: 'interval' }); return t.length; }, clearTimeout: () => {}, clearInterval: () => {} };
}

/** The agent in a fresh page; feed(devices, online) answers the page's as_hello, push(devices) is as_peers_updated. */
function page(extra) {
    const handlers = new Map();
    let reply = { devices: [], computers: [] };
    const tm = timers();
    const wsClient = {
        isConnected: () => false, // no hello of its own: the test calls activeSync.hello()
        on: (type, fn) => { handlers.set(type, fn); },
        sendMessage: (type) => Promise.resolve(Object.assign({ success: true, name: 'Desk' }, type === 'as_list' || type === 'as_hello' ? reply : {})),
    };
    const ctx = Object.assign({
        __activeSyncKind: 'computer',
        wsClient,
        localStorage: { getItem: () => null, setItem: () => {} },
        crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) & 255; return a; } },
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: tm.setTimeout, setInterval: tm.setInterval, clearTimeout: tm.clearTimeout, clearInterval: tm.clearInterval,
        console: { log() {}, info() {}, warn: (...a) => errors.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) },
    }, extra || {});
    const errors = [];
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(AGENT, ctx, { filename: 'activeSyncAgent.js' });
    assert.ok(ctx.activeSync && ctx.activeSync.kind === 'computer', 'the agent loaded as a computer');
    return {
        ctx, errors, tm, a: ctx.activeSync,
        /** as_hello answered with this list: the page is online and fires its state */
        feed: async (devices) => { reply = { devices: clone(devices), computers: [] }; await ctx.activeSync.hello(); },
        /** as_peers_updated with this list (the server's push) */
        push: (devices) => handlers.get('as_peers_updated')({ data: { devices: clone(devices) } }),
        handlers,
    };
}

// ------------------------------------------------------------------ 1. the predicates (the agent alone)
{
    const p = page();
    const { isTestRow, isSetUp } = p.a;
    assert.strictEqual(typeof isTestRow, 'function');
    assert.strictEqual(typeof isSetUp, 'function');
    assert.strictEqual(typeof p.a.listedDevices, 'function');
    assert.strictEqual(typeof p.a.awaitingSetup, 'function');

    // isTestRow: true
    assert.strictEqual(isTestRow(null), true, 'null is a test row (nothing to show)');
    assert.strictEqual(isTestRow(undefined), true);
    assert.strictEqual(isTestRow({ test: true }), true, 'the server test flag');
    assert.strictEqual(isTestRow({ test: true, deviceId: hex('a'), model: 'SM-F966U1', name: 'Fold7' }), true, 'the flag wins over a phone model');
    assert.strictEqual(isTestRow({ deviceId: 'emulator-5554' }), true, 'emulator serial');
    assert.strictEqual(isTestRow({ deviceId: 'EMULATOR-5556' }), true, 'serial, any case');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'sdk_gphone64_x86_64' }), true, 'AVD model');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), name: 'sdk_gphone64_x86_64' }), true, 'AVD model as the name');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'Android SDK built for x86', name: 'Android SDK built for x86 (generic_x86)' }), true, 'old SDK image (generic_x86 in the name)');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'Android SDK built for x86 (generic_x86)' }), true);
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'aemu-fold-m1' }), true, 'aemu AVD');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), name: 'aemu-fold-m1' }), true);
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'Pixel 9', name: 'Pixel 9 Emulator' }), true, 'the word emulator');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'ranchu' }), true);
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'google_sdk' }), true);
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'generic_x64' }), true);
    assert.strictEqual(isTestRow({ deviceId: hex('a'), name: 'My AVD' }), true, 'avd as a word');

    // isTestRow: false
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'SM-F966U1', name: 'Fold7' }), false, 'a Fold');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'SM-A536B', name: 'Galaxy A53' }), false, 'the A53');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'Pixel 9', name: 'Pixel 9' }), false, 'a Pixel');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'SM-S921B', name: 'Galaxy S24' }), false);
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'SM-G991B', name: 'Galaxy S21' }), false);
    assert.strictEqual(isTestRow({}), false, 'an empty record is not marked');
    assert.strictEqual(isTestRow({ test: false, deviceId: hex('a'), model: 'SM-F966U1' }), false, 'test:false');
    assert.strictEqual(isTestRow({ test: 'yes', deviceId: hex('a'), model: 'SM-F966U1' }), false, 'only a real true is the flag');
    assert.strictEqual(isTestRow({ deviceId: 'emulator-5554x', model: 'SM-F966U1' }), false, 'the serial shape is anchored');
    assert.strictEqual(isTestRow({ deviceId: 'my-emulator-5554', model: 'SM-F966U1' }), false, 'the serial shape is anchored at the start');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'SM-F966U1', name: 'Avdeev phone' }), false, 'avd inside a longer word');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'SM-F966U1', name: 'Emulators fan' }), false, 'emulator is a whole word only');
    assert.strictEqual(isTestRow({ deviceId: hex('a'), model: 'SM-F966U1', name: 'Semulator' }), false, 'emulator inside a longer word');

    // isSetUp: a partnership and not a DreamOS computer, nothing else
    assert.strictEqual(isSetUp({ partner: true }), true);
    assert.strictEqual(isSetUp({ partner: true, platform: 'android' }), true);
    assert.strictEqual(isSetUp({ partner: true, platform: 'cafeready' }), false, 'a computer is never set up as a device');
    assert.strictEqual(isSetUp({ partner: false }), false);
    assert.strictEqual(isSetUp({}), false);
    assert.strictEqual(isSetUp({ online: true, session: 'guest' }), false, 'connected is not set up');
    assert.strictEqual(isSetUp({ online: true, session: 'pending' }), false);
    assert.strictEqual(isSetUp({ session: 'partner' }), false, 'a session word alone is not a partnership');
    assert.strictEqual(isSetUp(null), false);
    assert.strictEqual(isSetUp(undefined), false);
    // the predicates have no side effect on state
    assert.deepStrictEqual(arr(p.a.listedDevices()), []);
    assert.deepStrictEqual(arr(p.a.awaitingSetup()), []);
}

// ------------------------------------------------------------------ 2. listedDevices() / awaitingSetup() over the mixed state
(async () => {
    {
        const p = page();
        await p.feed(MIXED);
        assert.deepStrictEqual(names(p.a.listedDevices()), ['Fold7', 'Galaxy A53'], 'listed: the two set-up phones, in server order');
        assert.deepStrictEqual(names(p.a.awaitingSetup()), ['Pixel 9 (not set up)'], 'waiting: the online pending phone only (not guest, not offline, not emulator, not computer)');
        // the state itself is untouched: the lists are views
        assert.strictEqual(p.a.state().devices.length, MIXED.length, 'the raw list keeps every row');
        assert.ok(p.a.primary() && p.a.primary().name === 'Fold7');

        // the server pushes a change: the views follow
        const next = clone(MIXED);
        next.find((d) => d.deviceId === GHOST).partner = true; // set up, offline
        next.find((d) => d.deviceId === PIXEL).partner = true; // set up now
        next.find((d) => d.deviceId === PIXEL).session = 'partner';
        p.push(next);
        assert.deepStrictEqual(names(p.a.listedDevices()), ['Fold7', 'Galaxy A53', 'Pixel 9 (not set up)', 'Old phone']);
        assert.deepStrictEqual(names(p.a.awaitingSetup()), [], 'nobody waits any more');
        // a pending phone that goes offline no longer waits
        const gone = clone(MIXED);
        gone.find((d) => d.deviceId === PIXEL).online = false;
        p.push(gone);
        assert.deepStrictEqual(names(p.a.awaitingSetup()), []);
        // an emulator or test device that is the only pending one: nothing waits
        p.push([emu, tested, pc].map(clone));
        assert.deepStrictEqual(arr(p.a.listedDevices()), []);
        assert.deepStrictEqual(arr(p.a.awaitingSetup()), []);
        assert.deepStrictEqual(arr(p.errors), [], 'no console warning from the agent');
    }

    // -------------------------------------------------------------- 3. the tray icon
    function trayPage() {
        const classes = new Set(['hidden']);
        const img = { _src: '', getAttribute(n) { return n === 'src' ? this._src : null; }, set src(v) { this._src = v; }, get src() { return this._src; } };
        let titleWrites = 0;
        const icon = {
            id: 'activeSyncTrayIcon',
            _title: '',
            get title() { return this._title; },
            set title(v) { titleWrites += 1; this._title = v; },
            classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
            addEventListener: () => {},
            querySelector: (sel) => (sel === 'img' ? img : null),
        };
        const menus = [];
        const launches = [];
        const balloons = [];
        const art = [];
        const p = page({
            document: { getElementById: (id) => (id === 'activeSyncTrayIcon' ? icon : null), addEventListener: () => {} },
            contextMenu: { attachToElement: (el, cfg) => { menus.push({ el, cfg }); } },
            melatonApps: { launch: (o) => { launches.push(o); return Promise.resolve(); } },
            PopoverManager: { showPopover: (anchor, type, title, text) => { balloons.push({ type, title, text }); } },
            featureLoader: { loadFeature: () => Promise.resolve() },
            activeSyncDeviceArt: { wallpapers: (d) => { art.push(d.deviceId); return Promise.resolve(); } },
        });
        vm.runInContext(TRAY, p.ctx, { filename: 'activeSyncTray.js' });
        assert.ok(p.ctx.activeSyncTray && typeof p.ctx.activeSyncTray.open === 'function', 'the tray loaded');
        const items = () => {
            assert.strictEqual(menus.length, 1, 'the icon has one context menu (attached when the first state paints)');
            const s = {};
            menus[0].cfg.sections[0].initfn(s);
            return Array.from(s.items);
        };
        const texts = () => items().map((i) => (i.separator ? '---' : i.text));
        return { p, icon, classes, img, items, texts, menus, launches, balloons, art, titleWrites: () => titleWrites };
    }

    const OPTIONS = ['Open Device Center when a new device connects', 'Tell me when a new device needs to be set up', 'Tell me when a device\'s battery is low or fully charged', 'Show the device\'s notifications here'];
    {
        const t = trayPage();
        await t.p.feed(MIXED); // the first list after the connect: the state of things, not news
        assert.deepStrictEqual(t.texts(), [
            'Open Melaton Mobile Device Center',
            '---',
            'Fold7: Connected, battery 80% (primary)',
            'Galaxy A53: Not Connected',
            '---',
            'Set up Pixel 9 (not set up)',
            '---',
            ...OPTIONS,
        ], 'the tray menu: Open, the two set-up phones (primary marked), the one phone waiting for setup, the icon options');
        const all = t.texts().join('\n');
        assert.ok(!/emulator|sdk_gphone|Test lane|Desk PC|Guest phone|Old phone/.test(all), 'no emulator, test device, computer, guest or unset-up phone in the menu');
        assert.strictEqual(t.items()[0].className, 'context-menu-item-default');
        assert.deepStrictEqual(t.items().filter((i) => i.action && i.action.startsWith('dev:')).map((i) => i.action), [`dev:${FOLD}`, `dev:${A53}`, `dev:${PIXEL}`]);

        // the tooltip and the icon: set-up phones only
        assert.strictEqual(t.icon.title, 'Melaton Mobile Device Center\nFold7: Connected, battery 80%\nGalaxy A53: Not Connected', 'tooltip names the set-up phones only');
        assert.ok(!/Pixel|Guest|emulator|Test lane|Desk PC/.test(t.icon.title));
        assert.strictEqual(t.img.src, '/static_images/activesync/activesync-16.png', 'the primary is connected: the green icon');
        assert.strictEqual(t.classes.has('hidden'), false, 'the icon shows: two set-up phones are known');
        // wallpapers are prefetched for the set-up phones alone
        assert.deepStrictEqual(t.art.slice().sort(), [FOLD, A53].sort(), 'prefetch counts the set-up phones only');

        // a click on a line opens Device Center at that device; Open opens it plain
        const items = t.items();
        const act = t.menus[0].cfg.onAction;
        act(`dev:${PIXEL}`);
        act('open');
        assert.deepStrictEqual(t.launches.map((l) => ({ id: l.packageId, deviceId: l.args && l.args.deviceId })), [{ id: 'activesync', deviceId: PIXEL }, { id: 'activesync', deviceId: undefined }]);
        assert.ok(items.length > 0);

        // single set-up phone: not marked primary (the mark is for a choice between several)
        t.p.push([fold]);
        assert.deepStrictEqual(t.texts().slice(0, 3), ['Open Melaton Mobile Device Center', '---', 'Fold7: Connected, battery 80%']);
    }

    // news: a test device, an emulator or a computer that comes up is no balloon and opens nothing; a real pending phone is
    {
        const t = trayPage();
        await t.p.feed([fold, a53]);
        t.p.push([fold, a53, emu, tested, pc, emuPartner].map(clone));
        assert.deepStrictEqual(t.balloons, [], 'no balloon for an emulator, a test device or a computer');
        assert.deepStrictEqual(t.launches, [], 'Device Center is not opened for them either');
        assert.strictEqual(t.icon.title, 'Melaton Mobile Device Center\nFold7: Connected, battery 80%\nGalaxy A53: Not Connected', 'no tray line for them');
        const pend = emu.session; // the emulator IS pending and online
        assert.strictEqual(pend, 'pending');
        t.p.push([fold, a53, emu, pixel].map(clone));
        assert.strictEqual(t.balloons.length, 1, 'a real new pending phone, a primary set: one balloon (existing behaviour)');
        assert.ok(/Pixel 9 \(not set up\) is connected/.test(t.balloons[0].text) && t.balloons[0].title === 'New device connected');
        assert.deepStrictEqual(t.launches, [], 'a primary is set: the window stays');
        // a test device that is low on battery says nothing either
        const low = clone(tested);
        low.status = { battery: { level: 5, charging: false } };
        t.p.push([fold, a53, low].map(clone));
        assert.strictEqual(t.balloons.length, 1, 'no battery balloon for a test device');
    }

    // the icon with nothing set up: hidden, idle picture; nothing listed even though devices are connected
    {
        const t = trayPage();
        await t.p.feed([pixel, guest, emu, tested, pc].map(clone));
        assert.strictEqual(t.icon.title, 'Melaton Mobile Device Center', 'no phone is hers yet: no lines');
        assert.strictEqual(t.classes.has('hidden'), true, 'the icon stays hidden when nothing is set up');
        assert.deepStrictEqual(t.texts(), ['Open Melaton Mobile Device Center', '---', 'Set up Pixel 9 (not set up)', '---', ...OPTIONS], 'only the open line and the one set-up prompt');
        assert.deepStrictEqual(t.art, [], 'no prefetch for a phone that is not set up');
        // primary away, another set-up phone here: idle (grey) icon, the other phone still listed
        t.p.push([Object.assign(clone(fold), { online: false, status: null }), Object.assign(clone(a53), { online: true, session: 'partner' })]);
        assert.strictEqual(t.img.src, '/static_images/activesync/activesync-idle-16.png', 'the primary is away: the icon is grey');
        assert.strictEqual(t.icon.title, 'Melaton Mobile Device Center\nFold7: Not Connected\nGalaxy A53: Connected');
        assert.strictEqual(t.classes.has('hidden'), false);
        // the same state again writes the tooltip once (written only when it changes)
        const writes = t.titleWrites();
        t.p.push([Object.assign(clone(fold), { online: false, status: null }), Object.assign(clone(a53), { online: true, session: 'partner' })]);
        assert.strictEqual(t.titleWrites(), writes, 'tooltip not rewritten when unchanged');
        // the page goes offline: the icon empties and hides
        t.p.ctx.activeSync._fire('state', { devices: [], online: false });
        assert.strictEqual(t.classes.has('hidden'), true);
        assert.strictEqual(t.p.ctx.activeSync.listedDevices().length, 2, 'the agent list itself is not the tray (it keeps the devices)');
        assert.deepStrictEqual(arr(t.p.errors), [], 'no console warning from the agent or the tray');
    }

    // -------------------------------------------------------------- 4. Melaton Mobile Device Center
    // The window's class is private to the file; it is started through the file's own registration hook
    // (melatonApps.define('activesync', start)) and read back through melatonActiveSync._running().
    function anything() {
        // a DOM that takes any call (the window's build() / render() draw into it); never thenable or iterable
        const fn = function () {};
        const p = new Proxy(fn, {
            get: (t, k) => {
                if (k === Symbol.toPrimitive) return () => '';
                if (k === 'then' || k === Symbol.iterator || k === 'toJSON') return undefined;
                if (k === 'length') return 0;
                if (k === 'disabled' || k === 'hidden') return false;
                return p;
            },
            set: () => true,
            apply: () => p,
            construct: () => p,
            has: () => true,
        });
        return p;
    }
    function centerPage(list) {
        const crumbMenus = [];
        let start = null;
        const p = page({
            document: anything(),
            melatonApps: { define: (id, fn) => { if (id === 'activesync') start = fn; } },
            contextMenu: { attachClickMenuToElement: (el, cfg) => { crumbMenus.push(cfg); } },
            requestAnimationFrame: () => 1,
        });
        // melatonApps is a bare global in the file (typeof melatonApps !== 'undefined'): the context property is that global
        return (async () => {
            await p.feed(list);
            vm.runInContext(CENTER, p.ctx, { filename: 'activesync.js' });
            assert.ok(typeof start === 'function', 'the window registered itself with melatonApps.define');
            const app = { args: {}, signal: { aborted: false, addEventListener: () => {} }, onExit: () => {}, exit: () => {} };
            start(app);
            const c = p.ctx.melatonActiveSync._running();
            assert.ok(c && typeof c.devices === 'function' && typeof c.setUp === 'function' && typeof c.device === 'function', 'the window is running');
            return { p, c, crumbMenus };
        })();
    }

    {
        const { p, c, crumbMenus } = await centerPage(MIXED);
        // devices(): test rows are gone (flag, emulator serial, AVD model); everything else stays, a computer too (its own page for administrators)
        assert.deepStrictEqual(names(c.devices()), ['Fold7', 'Galaxy A53', 'Pixel 9 (not set up)', 'Guest phone', 'Old phone', 'Desk PC'], 'devices() hides test rows only');
        assert.ok(!names(c.devices()).some((n) => /emulator|Test lane/i.test(n)));
        // setUp(): the set-up devices (a partnership, not a computer)
        assert.deepStrictEqual(names(c.setUp()), ['Fold7', 'Galaxy A53'], 'setUp() lists the set-up devices');
        // ... plus the one currently chosen (a set-up in progress keeps its row)
        c.deviceId = PIXEL;
        assert.deepStrictEqual(names(c.setUp()), ['Fold7', 'Galaxy A53', 'Pixel 9 (not set up)'], 'setUp() keeps the chosen device');
        c.deviceId = EMU_PARTNER;
        assert.deepStrictEqual(names(c.setUp()), ['Fold7', 'Galaxy A53'], 'a test device cannot be chosen into the list');
        c.deviceId = null;
        // device(): the primary
        assert.strictEqual(c.device().name, 'Fold7');
        // chosen online pending device wins while it is chosen (the tray's "Set up" line opens it this way)
        c.deviceId = PIXEL;
        assert.strictEqual(c.device().name, 'Pixel 9 (not set up)');
        c.deviceId = A53;
        assert.strictEqual(c.device().name, 'Galaxy A53', 'a set-up device is chosen even when away');
        c.deviceId = GHOST;
        assert.strictEqual(c.device().name, 'Fold7', 'an away device without a partnership is not chosen: back to the primary');
        c.deviceId = null;

        // the crumb menu was attached by render(): its items are the set-up devices
        assert.ok(crumbMenus.length >= 1, 'the crumb menu is attached when several devices are set up');
        const sec = { };
        crumbMenus[crumbMenus.length - 1].sections[0].initfn(sec);
        assert.deepStrictEqual(Array.from(sec.items, (i) => i.text), ['Fold7 (primary)', 'Galaxy A53 (not connected)'], 'crumb menu: set-up devices only, primary and away marked');
        assert.deepStrictEqual(Array.from(sec.items, (i) => i.checked), [true, false]);
        assert.deepStrictEqual(Array.from(sec.items, (i) => i.action), [FOLD, A53]);

        // no primary: a merely connected device never takes the window; a set-up one that is here does
        // (the DreamOS computer is left out here: devices() keeps computers, so an online one with a partnership would take the
        // window when there is no primary - the same as before #1299, not asserted either way)
        const noPrimary = clone(MIXED).filter((d) => d.deviceId !== PC).map((d) => Object.assign(d, { primary: false }, d.deviceId === FOLD ? { online: false, session: null } : {}));
        p.push(noPrimary);
        assert.strictEqual(c.device(), null, 'no primary, nobody set up is here: device() is null (pending and guest phones do not take it)');
        const online = clone(noPrimary);
        online.find((d) => d.deviceId === A53).online = true;
        p.push(online);
        assert.strictEqual(c.device().name, 'Galaxy A53', 'no primary: the online set-up device');
        // only an unpartnered online phone and nothing else
        p.push([pixel, guest, emu].map(clone));
        assert.strictEqual(c.device(), null, 'only connected, unset-up phones: nothing takes the window');
        assert.deepStrictEqual(arr(c.setUp()), []);
        // the emulator that is partnered and primary never takes it either
        p.push([Object.assign(clone(emuPartner), { primary: true }), Object.assign(clone(tested), { primary: true })]);
        assert.deepStrictEqual(arr(c.devices()), []);
        assert.strictEqual(c.device(), null, 'a primary test device does not take the window');
        assert.deepStrictEqual(arr(p.errors), [], 'no console warning from the window');
    }

    // the Device Center without the new agent hooks (an older page): the window still works on its own fallbacks
    {
        const { p, c } = await centerPage([fold, pixel]);
        delete p.ctx.activeSync.isTestRow;
        delete p.ctx.activeSync.isSetUp;
        assert.deepStrictEqual(names(c.devices()), ['Fold7', 'Pixel 9 (not set up)'], 'without isTestRow nothing is hidden by it');
        assert.deepStrictEqual(names(c.setUp()), ['Fold7'], 'without isSetUp the partnership alone decides');
    }

    console.log('ok test-activesync-listed-devices (predicates, listed/awaiting lists, tray menu + tooltip + news, Device Center devices/setUp/device/crumb menu)');
})().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
});
