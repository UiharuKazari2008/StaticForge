#!/usr/bin/env node
// Flow test for public/scripts/comp/desktopBoot.js on a tiny DOM stub.
// Covers: staged reveal order + dwell pacing + cumulative body classes, init-step → stage
// mapping, finish() waiting for the queue (and its timeout), step watchdog + skip, connection
// pause/resume of the queue, splash text ownership, and the server-restart suspend/resume lock.
// Run: node scripts/test-desktop-boot.js
const assert = require('assert');

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

    // ---- session lock after boot ----
    assert.strictEqual(boot.suspend('server-booting'), true);
    assert.ok(body.classList.contains('session-suspended'));
    assert.strictEqual(boot.isSuspended(), true);
    assert.strictEqual(boot.suspend('again'), true, 'second suspend is a no-op that stays suspended');
    assert.strictEqual(boot.resume(), true);
    assert.ok(!body.classList.contains('session-suspended'));
    assert.strictEqual(boot.resume(), false);
    boot.begin();
    assert.strictEqual(boot.suspend('server-booting'), false, 'no lock while the staged boot runs');
    boot.reset();
    assert.strictEqual(boot.isBooting(), false);

    console.log('✅ test-desktop-boot: all assertions passed');
})().catch((err) => {
    console.error('❌ test-desktop-boot failed:', err);
    process.exit(1);
});
