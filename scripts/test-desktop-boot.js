#!/usr/bin/env node
// Flow test for public/scripts/comp/desktopBoot.js on a tiny DOM stub.
// Covers: staged reveal order + dwell pacing + cumulative body classes, init-step → stage
// mapping, finish() waiting for the queue (and its timeout), step watchdog + skip, connection
// pause/resume of the queue, splash text ownership, the instant-reveal CSS contract, the
// server-restart suspend/resume lock (Classic theme on the lock layer), and the websocket.js
// lock triggers (methods lifted from the class and run on a fake client). Yozora #401, #410.
// Run: node scripts/test-desktop-boot.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

class ClassList {
    constructor() { this.set = new Set(); }
    add(...n) { n.forEach((x) => this.set.add(x)); }
    remove(...n) { n.forEach((x) => this.set.delete(x)); }
    contains(n) { return this.set.has(n); }
    toggle(n, force) { const on = force === undefined ? !this.set.has(n) : Boolean(force); if (on) this.set.add(n); else this.set.delete(n); return on; }
    list() { return [...this.set]; }
}
class Element {
    constructor(id) { this.id = id; this.classList = new ClassList(); this.dataset = {}; this.style = {}; this.textContent = ''; this.listeners = {}; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    click() { (this.listeners.click || []).forEach((fn) => fn({})); }
}
const els = {};
['windowsStartupStatus', 'windowsStartupDetail', 'windowsStartupProgressBar', 'windowsStartupSkipStepBtn', 'startMenu'].forEach((id) => { els[id] = new Element(id); });
els.windowsStartupSkipStepBtn.classList.add('hidden');
els.startMenu.classList.add('hidden');
const events = [];
const document = {
    body: new Element('body'),
    getElementById: (id) => els[id] || null,
    dispatchEvent(ev) { events.push(ev.type + (ev.detail && ev.detail.stage ? ':' + ev.detail.stage : '')); return true; }
};
if (typeof global.CustomEvent !== 'function') {
    global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
}
global.document = document;
global.window = { isDesktop: true };

const boot = require('../public/scripts/comp/desktopBoot.js');
const S = boot._test.state;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
Object.assign(boot.config.dwellMs, { session: 20, settings: 0, wallpaper: 20, icons: 20, taskbar: 20, windows: 20, done: 20 });
boot.config.stepWatchdogMs = 30;

(async () => {
    const body = document.body;
    const status = els.windowsStartupStatus;

    // ---- before begin: text goes straight to the headline (non-staged behaviour) ----
    boot.onStepMessage('Initializing...', 12);
    assert.strictEqual(status.textContent, 'Initializing...');
    assert.strictEqual(els.windowsStartupProgressBar.style.width, '12%');
    assert.strictEqual(await boot.finish(), undefined, 'finish resolves at once when not staged');
    assert.strictEqual(boot.requestStage('windows'), false, 'stages ignored before begin');

    // ---- begin: solid colour stage, launch black dropped ----
    body.classList.add('boot-from-launch');
    assert.strictEqual(boot.begin(), true);
    assert.strictEqual(boot.begin(), true, 'begin is idempotent');
    assert.ok(body.classList.contains('boot-staged'));
    assert.ok(!body.classList.contains('boot-from-launch'));
    assert.strictEqual(body.dataset.bootStage, 'session');
    assert.strictEqual(status.textContent, 'Loading your personal settings…');

    // ---- init steps drive the queue; the real step lands on the detail line ----
    boot.onInitStep({ priority: 0.45, message: 'Loading user global settings' });
    boot.onStepMessage('Loading user global settings', 26);
    assert.strictEqual(els.windowsStartupDetail.textContent, 'Loading user global settings');
    assert.strictEqual(status.textContent, 'Loading your personal settings…', 'headline stays with the stage');
    boot.onInitStep({ priority: 12, message: 'Loading Workspaces' });
    boot.onStepDone({ priority: 12, message: 'Loading Workspaces' });
    assert.strictEqual(S.requested, 'icons');
    assert.deepStrictEqual(S.queue, ['settings', 'wallpaper', 'icons'], 'session dwell holds the queue');
    await sleep(30);
    assert.strictEqual(body.dataset.bootStage, 'wallpaper', 'session dwell then settings (0 dwell) then wallpaper');
    assert.ok(body.classList.contains('boot-reveal-wallpaper'));
    assert.strictEqual(status.textContent, 'Applying your personal settings…');
    assert.ok(!body.classList.contains('boot-reveal-icons'), 'icons wait for the wallpaper dwell');
    await sleep(30);
    assert.strictEqual(body.dataset.bootStage, 'icons');
    assert.ok(body.classList.contains('boot-reveal-icons'));
    boot.onStepDone({ priority: 16, message: 'Starting Taskbar' });
    await sleep(30);
    assert.strictEqual(body.dataset.bootStage, 'taskbar');
    assert.ok(body.classList.contains('boot-reveal-taskbar'));

    // ---- connection drop while booting holds the queue and owns the headline ----
    body.classList.add('no-animation');
    boot.setConnectionState('dialing', 'Redialing in 3s…');
    boot.onInitStep({ priority: 31, message: 'Loading Gallery' });
    assert.strictEqual(status.textContent, 'Redialing in 3s…');
    await sleep(40);
    assert.strictEqual(body.dataset.bootStage, 'taskbar', 'queue held while disconnected');
    boot.setConnectionState('failed');
    assert.strictEqual(status.textContent, boot.config.connectionFailedText);
    boot.setConnectionState('idle');
    await sleep(5);
    assert.strictEqual(body.dataset.bootStage, 'windows');
    assert.ok(body.classList.contains('boot-reveal-windows'));
    assert.ok(!body.classList.contains('no-animation'), 'window animations allowed from the windows stage');
    assert.strictEqual(status.textContent, 'Restoring your windows…');

    // ---- watchdog: stalled step names itself and offers Skip ----
    const step = { priority: 40, message: 'Initializing stage results review' };
    const watch = boot.watchStep(step);
    assert.ok(els.windowsStartupSkipStepBtn.classList.contains('hidden'));
    await sleep(45);
    assert.strictEqual(status.textContent, 'Still working on: Initializing stage results review');
    assert.ok(!els.windowsStartupSkipStepBtn.classList.contains('hidden'));
    assert.ok(events.includes('desktopBootStepStalled'));
    let outcome = null;
    watch.promise.then((o) => { outcome = o; });
    els.windowsStartupSkipStepBtn.click();
    await sleep(1);
    assert.deepStrictEqual(outcome, { skipped: true });
    watch.clear();
    assert.ok(els.windowsStartupSkipStepBtn.classList.contains('hidden'));
    assert.strictEqual(status.textContent, 'Restoring your windows…', 'headline returns to the stage after clear');
    const quick = boot.watchStep({ priority: 41, message: 'fast step' });
    quick.clear();
    await sleep(40);
    assert.ok(els.windowsStartupSkipStepBtn.classList.contains('hidden'), 'cleared watchdog never fires');

    // ---- finish waits for Welcome, then strips the boot classes ----
    let finished = false;
    const finishing = boot.finish().then(() => { finished = true; });
    await sleep(5);
    assert.strictEqual(finished, false, 'finish waits for the done stage dwell');
    assert.strictEqual(status.textContent, 'Welcome');
    await finishing;
    assert.strictEqual(boot.isBooting(), false);
    assert.ok(!body.classList.contains('boot-staged'));
    assert.ok(!body.classList.contains('boot-reveal-windows'));
    assert.strictEqual(body.dataset.bootStage, undefined);
    assert.ok(events.includes('desktopBootDone'));

    // ---- finish timeout: a held queue cannot keep the splash forever ----
    boot.begin();
    boot.setConnectionState('dialing');
    const t0 = Date.now();
    await boot.finish({ timeoutMs: 30 });
    assert.ok(Date.now() - t0 >= 25, 'timed out rather than resolving early');
    assert.strictEqual(boot.isBooting(), false);
    assert.ok(!body.classList.contains('boot-staged'));

    // ---- session lock after boot: Classic theme on the lock layer, off again on resume ----
    assert.ok(!body.classList.contains('windows-classic-theme'));
    assert.strictEqual(boot.suspend('server-booting'), true);
    assert.ok(body.classList.contains('session-suspended'));
    assert.ok(body.classList.contains('windows-classic-theme'), 'logon dialog is Classic like the first logon');
    assert.strictEqual(boot.isSuspended(), true);
    assert.strictEqual(boot.suspend('again'), true, 'second suspend is a no-op that stays suspended');
    assert.strictEqual(boot.resume(), true);
    assert.ok(!body.classList.contains('session-suspended'));
    assert.ok(!body.classList.contains('windows-classic-theme'), 'resume drops the Classic the lock added');
    assert.strictEqual(boot.resume(), false);
    body.classList.add('windows-classic-theme');
    boot.suspend('server-booting');
    boot.resume();
    assert.ok(body.classList.contains('windows-classic-theme'), 'Classic that was already on stays on');
    body.classList.remove('windows-classic-theme');
    boot.begin();
    assert.strictEqual(boot.suspend('server-booting'), false, 'no lock while the staged boot runs');
    boot.reset();
    assert.strictEqual(boot.isBooting(), false);

    testRevealCss();
    await testLockTriggers(body);

    console.log('✅ test-desktop-boot: all assertions passed');
})().catch((err) => {
    console.error('❌ test-desktop-boot failed:', err);
    process.exit(1);
});

// ---------- desktop-boot.css: every reveal is instant, the lock has a cover ----------
function testRevealCss() {
    const css = fs.readFileSync(path.join(__dirname, '../public/css/desktop-boot.css'), 'utf8');
    const boot = css.slice(css.indexOf('Staged desktop reveal'));
    assert.ok(!/transition:\s*(?!none)[^;]*\d+(\.\d+)?m?s/.test(boot), 'no timed transition in the staged reveal or the lock');
    assert.ok(!/translateY/.test(boot), 'taskbar does not slide');
    assert.ok(/session-suspended::before\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/.test(boot), 'lock cover spans the viewport');
    assert.ok(/session-suspended[^{]*\.gallery,/.test(boot), 'gallery grids (visibility: visible) are hidden under the lock');
}

// ---------- websocket.js: when the lock engages ----------
function liftMethod(src, name) {
    const at = [`\n    async ${name}(`, `\n    ${name}(`].map((n) => src.indexOf(n)).find((i) => i >= 0);
    assert.ok(at >= 0, `websocket.js has ${name}`);
    const start = at + 1;
    let depth = 0;
    let quote = null;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        if (ch === '}' && --depth === 0) {
            const text = src.slice(start, i + 1).trim();
            const isAsync = text.startsWith('async ');
            return new Function('WebSocketClient', `return ${isAsync ? 'async ' : ''}function ${isAsync ? text.slice(6) : text}`);
        }
    }
    throw new Error(`unbalanced ${name}`);
}

async function testLockTriggers(body) {
    const src = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
    const WebSocketClient = {
        SERVER_RESTART_DRIFT_MS: 5000,
        ATTEMPTS_MAX_PING: 3,
        DELAY_PING_HOST: 1,
        TIMEOUT_VERSION_CHECK: 50
    };
    const proto = {};
    ['pingHost', '_applyServerStartupStatus', '_noteServerInstance', '_suspendIfServerUnreachable',
        '_suspendSession', '_shouldUsePreStartupDialog'].forEach((name) => {
        proto[name] = liftMethod(src, name)(WebSocketClient);
    });
    global.fetch = async () => ({ ok: false }); // /app version check after a ready /status

    const OLD = 1000000;
    const NEW = 9000000;
    const status = (startedAt, isReady, stageMessage, progressPercent) => ({
        isReady, stageMessage, progressPercent, timestamp: startedAt + 60000, uptime: 60000
    });
    const refused = () => Object.assign(new TypeError('Failed to fetch'), {});
    const timedOut = () => Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });

    function client(responses) {
        const c = Object.create(proto);
        Object.assign(c, {
            initializationCompleted: true,
            preStartupHandoffCompleted: true,
            sessionSuspended: false,
            connectionDialView: 'transient',
            _trayOnlyReconnect: true,
            _serverStartedAt: OLD,
            lastServerStartupStatus: status(OLD, true, 'Starting Dreamscape…', 100),
            serverStartupStatusOk: true,
            serverStartupReady: true,
            beats: [],
            dialRenders: 0
        });
        c._fetchServerStartupStatus = async () => {
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next;
        };
        c._setConnectionBeat = (beat, patch) => c.beats.push(patch && patch.message);
        c._renderConnectionDial = () => { c.dialRenders++; };
        c._renderPreStartupDialog = () => {};
        c._updatePreStartupStageProgress = () => {};
        c._clearTrayOnlyReconnect = () => { c._trayOnlyReconnect = false; };
        c._stopConnectionStatsTimer = () => {};
        c._hideConnectionDialModal = () => {};
        return c;
    }
    const origLog = console.log;
    const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = origLog; } };

    // Same server back after a socket drop: no lock, and no "Starting Dreamscape…" in the dial
    let c = client([status(OLD, true, 'Starting Dreamscape…', 100)]);
    assert.strictEqual(await quiet(() => c.pingHost()), true);
    assert.strictEqual(c.sessionSuspended, false);
    assert.deepStrictEqual(c.beats, [undefined], 'plain dial beat (Dialing…) for the same server');

    // Server down (refused), then booting, then ready: lock on the first failure, poll like a first boot
    c = client([refused(), refused(), status(NEW, false, 'Syncing previews…', 54), status(NEW, true, 'Starting Dreamscape…', 100)]);
    assert.strictEqual(await quiet(() => c.pingHost()), true, 'keeps polling instead of throwing to NO CARRIER');
    assert.strictEqual(c.sessionSuspended, true);
    assert.strictEqual(c.sessionSuspendReason, 'server-unreachable');
    assert.strictEqual(c.preStartupHandoffCompleted, false, 'logon dialog owns the screen again');
    assert.strictEqual(c._trayOnlyReconnect, false, 'a tray-only reconnect still shows the lock dialog');
    assert.ok(body.classList.contains('session-suspended') && body.classList.contains('windows-classic-theme'));
    assert.deepStrictEqual(c.beats, ['Waiting for server… (1)', 'Waiting for server… (2)', 'Syncing previews…', 'Starting Dreamscape…'],
        'old server\'s "Starting Dreamscape…" never shows while the new one is down');
    assert.strictEqual(c._serverStartedAt, NEW);
    window.desktopBoot.resume();

    // /status timing out (server busy loading) locks too
    c = client([timedOut(), status(NEW, true, 'Starting Dreamscape…', 100)]);
    assert.strictEqual(await quiet(() => c.pingHost()), true);
    assert.strictEqual(c.sessionSuspendReason, 'server-unreachable');
    window.desktopBoot.resume();

    // Restart seen straight from a ready /status: lock, and that fresh status is kept
    c = client([status(NEW, true, 'Starting Dreamscape…', 100)]);
    assert.strictEqual(await quiet(() => c.pingHost()), true);
    assert.strictEqual(c.sessionSuspendReason, 'server-restarted');
    assert.strictEqual(c.serverStartupReady, true, 'the new server\'s status survives the lock reset');
    assert.strictEqual(c.lastServerStartupStatus.timestamp, NEW + 60000);
    assert.deepStrictEqual(c.beats, ['Starting Dreamscape…'], 'stage text goes to the logon dialog');
    window.desktopBoot.resume();

    // First boot (not initialised): an unreachable server is the normal logon wait, no lock
    c = client([refused(), status(NEW, true, 'Starting Dreamscape…', 100)]);
    Object.assign(c, { initializationCompleted: false, preStartupHandoffCompleted: false, serverStartupStatusOk: false, serverStartupReady: false });
    assert.strictEqual(await quiet(() => c.pingHost()), true);
    assert.strictEqual(c.sessionSuspended, false);
    assert.ok(!body.classList.contains('session-suspended'));
}
