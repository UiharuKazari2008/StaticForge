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
    constructor(id) { this.id = id; this.classList = new ClassList(); this.dataset = {}; this.style = {}; this.textContent = ''; this.listeners = {}; this.attrs = {}; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    click() { (this.listeners.click || []).forEach((fn) => fn({})); }
    setAttribute(k, v) { this.attrs[k] = v; }
    appendChild(child) { if (child.id) els[child.id] = child; return child; }
}
class FakeVideo {
    constructor(paused, inBootDialog) { this.paused = paused; this.inBootDialog = inBootDialog; this.isConnected = true; this.plays = 0; }
    pause() { this.paused = true; }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    closest(sel) { return sel === '.boot-dialog' && this.inBootDialog ? {} : null; }
}
const videos = [];
const els = {};
['windowsStartupStatus', 'windowsStartupDetail', 'windowsStartupProgressBar', 'windowsStartupSkipStepBtn', 'startMenu'].forEach((id) => { els[id] = new Element(id); });
els.windowsStartupSkipStepBtn.classList.add('hidden');
els.startMenu.classList.add('hidden');
const events = [];
const document = {
    body: new Element('body'),
    getElementById: (id) => els[id] || null,
    createElement: () => new Element(null),
    querySelectorAll: (sel) => (sel === 'video' ? videos : []),
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
    assert.strictEqual(status.textContent, 'Preparing your desktop...');

    // ---- init steps drive the queue; the real step lands on the detail line ----
    boot.onInitStep({ priority: 0.45, message: 'Loading user global settings' });
    boot.onStepMessage('Loading user global settings', 26);
    assert.strictEqual(els.windowsStartupDetail.textContent, 'Loading user global settings');
    assert.strictEqual(status.textContent, 'Preparing your desktop...', 'headline stays with the stage');
    boot.onInitStep({ priority: 12, message: 'Loading Workspaces' });
    boot.onStepDone({ priority: 12, message: 'Loading Workspaces' });
    assert.strictEqual(S.requested, 'icons');
    assert.deepStrictEqual(S.queue, ['settings', 'wallpaper', 'icons'], 'session dwell holds the queue');
    await sleep(30);
    assert.strictEqual(body.dataset.bootStage, 'wallpaper', 'session dwell then settings (0 dwell) then wallpaper');
    assert.ok(body.classList.contains('boot-reveal-wallpaper'));
    assert.strictEqual(status.textContent, 'Preparing your desktop...');
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
    assert.strictEqual(status.textContent, 'Please wait...', 'a dial beat is just a wait (Vista wording)');
    await sleep(40);
    assert.strictEqual(body.dataset.bootStage, 'taskbar', 'queue held while disconnected');
    boot.setConnectionState('failed');
    assert.strictEqual(status.textContent, boot.config.connectionFailedText);
    boot.setConnectionState('idle');
    await sleep(5);
    assert.strictEqual(body.dataset.bootStage, 'windows');
    assert.ok(body.classList.contains('boot-reveal-windows'));
    assert.ok(!body.classList.contains('no-animation'), 'window animations allowed from the windows stage');
    assert.strictEqual(status.textContent, 'Preparing your desktop...');

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
    assert.strictEqual(status.textContent, 'Preparing your desktop...', 'headline returns to the stage after clear');
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
    boot.config.lockSwitchMs = 20;
    boot.config.unlockSwitchMs = 40;
    assert.ok(!body.classList.contains('windows-classic-theme'));
    assert.strictEqual(boot.suspend('server-booting'), true);
    const overlay = els.sessionSwitchOverlay;
    assert.ok(overlay && overlay.classList.contains('active'), 'lock cuts to black first');
    assert.ok(boot.isSwitching());
    await sleep(30);
    assert.ok(!overlay.classList.contains('active'), 'black lifts after lockSwitchMs, lock screen shows');
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
    await sleep(50);

    // ---- unlock: black for unlockSwitchMs, lock layers already gone under it ----
    boot.suspend('server-restarted');
    await sleep(30);
    boot.resume();
    assert.ok(overlay.classList.contains('active'), 'unlock cuts to black');
    assert.ok(!body.classList.contains('session-suspended') && !body.classList.contains('windows-classic-theme'),
        'cover and Classic come off under the black');
    await sleep(20);
    assert.ok(overlay.classList.contains('active'), 'still black before unlockSwitchMs');
    await sleep(35);
    assert.ok(!overlay.classList.contains('active'), 'desktop cuts in after unlockSwitchMs');
    assert.ok(events.includes('desktopSessionSwitchDone'));

    // ---- workstation lock (#423): wallpaper lock, shares the cut, Classic and the pause ----
    const wsLog = [];
    boot.registerPauseHook({ pause: () => wsLog.push('pause'), resume: () => wsLog.push('resume') });
    assert.strictEqual(boot.lockWorkstation(), true);
    assert.ok(body.classList.contains('workstation-locked') && body.classList.contains('windows-classic-theme'));
    assert.ok(overlay.classList.contains('active'), 'manual lock cuts to black first');
    assert.strictEqual(boot.lockWorkstation(), false, 'already locked');
    assert.ok(boot.isWorkstationLocked());
    // the server restarts while locked: both locks up, one pause, Classic stays until both are gone
    boot.suspend('server-restarted');
    assert.deepStrictEqual(wsLog, ['pause'], 'pauses nest: the second lock does not pause twice');
    boot.resume();
    assert.ok(body.classList.contains('workstation-locked') && body.classList.contains('windows-classic-theme'),
        'after the server is back the workstation is still locked, still Classic');
    assert.deepStrictEqual(wsLog, ['pause'], 'still paused while the workstation lock is up');
    assert.strictEqual(boot.unlockWorkstation(), true);
    assert.ok(!body.classList.contains('workstation-locked') && !body.classList.contains('windows-classic-theme'));
    assert.deepStrictEqual(wsLog, ['pause', 'resume']);
    assert.strictEqual(boot.unlockWorkstation(), false);
    boot.begin();
    assert.strictEqual(boot.lockWorkstation(), false, 'no manual lock while the staged boot runs');
    boot.reset();
    await sleep(50);

    // ---- paused while locked: videos, planet switcher loop, registered hooks; work untouched ----
    const playing = new FakeVideo(false, false);
    const idle = new FakeVideo(true, false);
    const bootDialogVideo = new FakeVideo(false, true);
    videos.push(playing, idle, bootDialogVideo);
    const ps = { raf: 7, state: 'open', stops: 0, starts: 0, stopLoop() { this.stops++; this.raf = 0; }, startLoop() { this.starts++; this.raf = 9; } };
    window.planetSwitcher = ps;
    const hookLog = [];
    boot.registerPauseHook({ pause: () => hookLog.push('pause'), resume: () => hookLog.push('resume') });
    boot.registerPauseHook(() => { hookLog.push('fn-pause'); return () => hookLog.push('fn-resume'); });
    boot.suspend('server-unreachable');
    assert.ok(playing.paused && idle.paused && !bootDialogVideo.paused, 'playing videos pause, boot dialog video keeps going');
    assert.strictEqual(ps.stops, 1, 'planet switcher render loop stops');
    assert.deepStrictEqual(hookLog, ['pause', 'fn-pause']);
    boot.resume();
    assert.strictEqual(playing.plays, 1, 'video the lock paused plays again');
    assert.strictEqual(idle.plays, 0, 'a video that was already paused stays paused');
    assert.strictEqual(ps.starts, 1, 'planet switcher loop restarts');
    assert.deepStrictEqual(hookLog, ['pause', 'fn-pause', 'resume', 'fn-resume']);
    ps.state = 'idle';
    ps.raf = 0;
    boot.suspend('x');
    boot.resume();
    assert.strictEqual(ps.stops, 1, 'a closed planet switcher is left alone');
    videos.length = 0;
    delete window.planetSwitcher;
    await sleep(50);
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
    assert.ok(/session-suspended \*:not\(\.boot-dialog, \.boot-dialog \*\)[^{]*\{\s*animation-play-state:\s*paused !important/.test(boot),
        'every animation outside the boot dialogs pauses while locked');
    assert.ok(/#sessionSwitchOverlay\s*\{[^}]*background:\s*#000[^}]*z-index:\s*2147482500/.test(boot), 'session switch is black above the lock dialogs');
    assert.ok(/progress\.paused > div\s*\{\s*animation-play-state:\s*paused !important/.test(css), 'logon marquee pause beats its running !important');
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

    // Unlock order: black cut (resume) before the logon dialog closes; no teal pause in between
    const handoff = liftMethod(src, '_completePreStartupHandoff')(WebSocketClient);
    const order = [];
    const h = Object.assign(Object.create(proto), {
        sessionSuspended: true, preStartupHandoffCompleted: false, connectionDialView: 'transient',
        connectionPhase: 'dialing', socketAuthenticated: true, connectionUi: {},
        _setConnectionPhase: () => {}, _sleepConnectionBeat: async (ms) => { order.push(`sleep${ms}`); },
        _waitForTealHold: async () => { order.push('hold'); },
        _canCompletePreStartupHandoff() { return this._shouldUsePreStartupDialog() && this.socketAuthenticated === true; },
        _resumeSuspendedSession() { order.push('resume'); this.sessionSuspended = false; },
        _hidePreStartupDialog: async () => { order.push('hide'); }
    });
    await handoff.call(h);
    assert.deepStrictEqual(order, ['hold', 'sleep1000', 'resume', 'hide'], 'unlock: Preparing… then black, dialog closes under it');
    assert.strictEqual(h.preStartupHandoffCompleted, true);

    // Melaton boot teal hold (#416): the logon dialog stays away until dreamscapeTealHoldUntil
    const defer = liftMethod(src, '_deferPreStartupForTealHold')(WebSocketClient);
    const waitHold = liftMethod(src, '_waitForTealHold')(WebSocketClient);
    const renders = [];
    const d = { _shouldUsePreStartupDialog: () => true, _renderPreStartupDialog() { renders.push(Date.now()); } };
    window.dreamscapeTealHoldUntil = Date.now() + 40;
    assert.strictEqual(defer.call(d), true, 'held while the teal hold runs');
    assert.strictEqual(defer.call(d), true, 'a second render during the hold just waits');
    const holdStart = Date.now();
    await waitHold.call(d);
    assert.ok(Date.now() - holdStart >= 35, '_waitForTealHold waits out the hold');
    await sleep(20);
    assert.strictEqual(renders.length, 1, 'one deferred render when the hold ends');
    assert.strictEqual(defer.call(d), false, 'after the hold the dialog renders normally');
    delete window.dreamscapeTealHoldUntil;
    assert.strictEqual(defer.call(d), false, 'no hold without the Melaton boot');

    // ---- Logon-phase init steps (#421): { logon: true } steps run in the logon dialog ----
    const LWSC = { ...WebSocketClient, PROGRESS_INIT_BASE: 25, PROGRESS_INIT_STEPS: 75 };
    const logonProto = {};
    ['_logonInitSteps', '_runLogonInitSteps', '_setLogonInitStatus', '_showLogonInitError', 'retryLogonInitSteps',
        'isLogonInitPhase', '_canCompletePreStartupHandoff', '_shouldUsePreStartupDialog', '_initProgressRange',
        'updateCurrentInitStepProgress'].forEach((name) => { logonProto[name] = liftMethod(src, name)(LWSC); });
    const appErrors = [];
    global.presentDreamscapeApplicationError = (title) => appErrors.push(title);
    const boxes = [];
    let answerBox = null;
    window.bootMessageBox = { show: (opts) => { boxes.push(opts); return new Promise((resolve) => { answerBox = resolve; }); } };
    function logonClient(stepFns) {
        const ran = [];
        const c = Object.assign(Object.create(logonProto), {
            initializationCompleted: false, preStartupHandoffCompleted: false, connectionDialView: 'transient',
            connectionPhase: 'dialing', socketAuthenticated: true, statuses: [], renders: 0, started: 0,
            isConnected: () => true,
            _renderPreStartupDialog() { this.renders++; this.statuses.push(this._logonInitStatus && this._logonInitStatus.message); },
            _startAfterLogon: async function () { this.started++; },
            initSteps: stepFns.map(([priority, message, fn, opts]) => ({
                priority, message, runOnReconnect: true,
                logon: !!(opts && opts.logon), critical: !!(opts && opts.critical), failureText: (opts && opts.failureText) || null,
                stepFunction: async () => { ran.push(message); if (fn) await fn(); }
            }))
        });
        return { c, ran };
    }
    let failAppData = true;
    let lc = logonClient([
        [0.45, 'Loading user global settings', null, { logon: true }],
        [0.46, 'Loading start menu layout'], [0.5, 'Loading Desktop Settings'], [0.55, 'Preloading icons'],
        [1, 'Loading Application Data', () => { if (failAppData) throw new Error('options timed out'); },
            { logon: true, critical: true, failureText: 'MeletonFX could not load your application data.' }],
        [5, 'Initializing Tokenizer']
    ]);
    assert.strictEqual(await lc.c._runLogonInitSteps(), false, 'a critical failure stops the boot in the logon dialog');
    assert.deepStrictEqual(lc.ran, ['Loading user global settings', 'Loading Application Data'],
        'only { logon: true } steps; start menu, desktop settings and icons stay in the startup window');
    assert.deepStrictEqual(lc.c.statuses.slice(0, 2), ['Loading user global settings...', 'Loading Application Data...']);
    assert.ok(lc.c._logonInitStatus && lc.c._logonInitStatus.percent === undefined, 'no progress bar for the logon steps');
    assert.strictEqual(boxes.length, 1, 'a Windows message box over the logon dialog');
    assert.deepStrictEqual({ icon: boxes[0].icon, message: boxes[0].message, detail: boxes[0].detail, buttons: boxes[0].buttons.map((b) => b.label) },
        { icon: 'error', message: 'MeletonFX could not load your application data.', detail: 'DETAIL - options timed out', buttons: ['Retry', 'Restart'] });
    assert.strictEqual(lc.c._canCompletePreStartupHandoff(), false, 'no handoff to the desktop while the error is up');
    assert.ok(lc.c.initSteps[0]._logonPhase && !lc.c.initSteps[1]._logonPhase && !lc.c.initSteps[4]._logonPhase);
    failAppData = false;
    lc.ran.length = 0;
    answerBox('retry');
    for (let i = 0; i < 10 && !lc.c.started; i++) await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(lc.ran, ['Loading user global settings', 'Loading Application Data'], 'Retry runs the logon steps again (runOnReconnect)');
    assert.strictEqual(lc.c._logonInitError, null);
    assert.strictEqual(lc.c.started, 1, 'Retry continues the boot');
    assert.strictEqual(lc.c._logonInitStatus, null, 'status cleared before Preparing MeletonFX');
    assert.strictEqual(lc.c._canCompletePreStartupHandoff(), true);

    lc = logonClient([[0.45, 'Loading user global settings', () => { throw new Error('settings 500'); }, { logon: true }],
        [1, 'Loading Application Data', null, { logon: true, critical: true }]]);
    assert.strictEqual(await lc.c._runLogonInitSteps(), true, 'a non-critical failure is reported and the boot goes on');
    assert.ok(appErrors.includes('Init step failed: Loading user global settings'));

    window.isDesktop = false;
    lc = logonClient([[1, 'Loading Application Data', null, { logon: true, critical: true }]]);
    assert.strictEqual(await lc.c._runLogonInitSteps(), true);
    assert.deepStrictEqual(lc.ran, [], 'non-desktop: nothing runs in a logon dialog');
    assert.deepStrictEqual(lc.c._initProgressRange(), { base: 25, span: 75 }, 'the toast keeps the connection base');
    window.isDesktop = true;
    assert.deepStrictEqual(lc.c._initProgressRange(), { base: 0, span: 100 }, 'the startup window runs 0-100 over its own steps');
    delete window.bootMessageBox;

    // the startup window's sub-progress reads the list executeInitSteps runs, not initSteps
    const shown = [];
    const sub = Object.assign(Object.create(logonProto), {
        currentInitStep: 2, totalInitSteps: 4,
        initSteps: [{ message: 'logon A' }, { message: 'logon B' }, { message: 'Tokenizer' }, { message: 'Configuring' }],
        _runStepList: [{ message: 'Tokenizer' }, { message: 'Configuring' }, { message: 'Workspaces' }, { message: 'Taskbar' }],
        updateProgressNotification: (message, pct) => shown.push([message, pct])
    });
    sub.updateCurrentInitStepProgress(0.5);
    assert.deepStrictEqual(shown, [['Configuring', 37.5]], 'step 2 of 4 halfway = 37.5 %, named from the running list');

    // First boot (not initialised): an unreachable server is the normal logon wait, no lock
    c = client([refused(), status(NEW, true, 'Starting Dreamscape…', 100)]);
    Object.assign(c, { initializationCompleted: false, preStartupHandoffCompleted: false, serverStartupStatusOk: false, serverStartupReady: false });
    assert.strictEqual(await quiet(() => c.pingHost()), true);
    assert.strictEqual(c.sessionSuspended, false);
    assert.ok(!body.classList.contains('session-suspended'));
}
