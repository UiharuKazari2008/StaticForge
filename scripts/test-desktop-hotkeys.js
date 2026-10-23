#!/usr/bin/env node
// Vista's Windows-key and system hotkeys in the desktop PWA (2026-10-22): desktopHotkeys.js and the
// Alt+Tab / Win+Tab window switcher in keyboardShortcuts.js. Run: node scripts/test-desktop-hotkeys.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- desktopHotkeys.js ---------------------------------------------------------------------------

function classList(initial) {
    const set = new Set(initial);
    return { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c) };
}

function makeWindow(id, { minimised = false } = {}) {
    const closeBtn = { disabled: false, clicks: 0, click() { this.clicks += 1; } };
    return {
        id,
        isConnected: true,
        classList: classList(minimised ? ['modal', 'minimised'] : ['modal']),
        closeBtn,
        querySelector: (sel) => (sel.includes('modal-window-title') ? {} : sel.includes('close-btn') ? closeBtn : null)
    };
}

function hotkeysContext({ platform = 'Win32', standalone = true, desktopState = 'desktop' } = {}) {
    const calls = [];
    const record = (name) => (...args) => { calls.push([name, ...args]); };
    const windows = [makeWindow('a'), makeWindow('b'), makeWindow('c', { minimised: true })];
    const quickLaunch = [1, 2, 3].map((n) => ({ click: () => calls.push(['quickLaunch', n]) }));
    const searchInput = { focus: () => calls.push(['searchFocus']) };
    const listeners = {};
    const registered = {};
    const document = {
        readyState: 'complete',
        body: { classList: classList(['desktop-mode']) },
        querySelectorAll: (sel) => (sel.includes('taskbar-quick-launch-btn') ? quickLaunch : sel.startsWith('.modal') ? windows.filter((w) => !w.closed) : []),
        getElementById: (id) => (id === 'startMenuSearchInput' ? searchInput : null),
        addEventListener: (type, fn) => { listeners[type] = fn; }
    };
    const ctx = {
        document,
        navigator: { platform },
        isDesktop: true,
        matchMedia: () => ({ matches: standalone }),
        getClientDesktopState: () => desktopState,
        registerKeyboardListener: (o) => { registered[o.id] = o; },
        addEventListener: () => {},
        toggleStartMenu: record('toggleStartMenu'),
        openStartMenu: record('openStartMenu'),
        openExplorerApplet: record('openExplorerApplet'),
        openVistaSidebar: record('openVistaSidebar'),
        minimizeModalProgrammatically: (m) => { calls.push(['minimize', m.id]); m.classList.add('minimised'); },
        restoreMinimizedModal: (m) => { calls.push(['restore', m.id]); m.classList.remove('minimised'); },
        getOrCreateTaskbarItem: () => null,
        canCloseWindowWithAltQ: () => true,
        resolveWindowToCloseWithAltQ: () => windows[0],
        closeModal: record('closeModal'),
        getStartMenuPlaces: () => [{ id: 'help', action: record('help') }],
        taskbarSettings: { toggleShowDesktop: record('showDesktop'), get: () => ({ quickLaunch: true }) },
        workstationLock: { lock: record('lock') },
        featureLoader: { loadFeature: (name) => { calls.push(['loadFeature', name]); return Promise.resolve(); } },
        console
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('public/scripts/comp/desktopHotkeys.js'), ctx);
    return { ctx, calls, windows, listeners, registered, t: ctx.desktopHotkeys._test };
}

function key(type, k, code, mods = {}) {
    const ev = {
        type, key: k, code, repeat: false, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {}
    };
    return ev;
}
const metaDown = () => key('keydown', 'Meta', 'MetaLeft', { metaKey: true });
const metaUp = () => key('keyup', 'Meta', 'MetaLeft');
const winCombo = (k, code, mods = {}) => key('keydown', k, code, { metaKey: true, ...mods });

{
    const { calls, registered } = hotkeysContext();
    assert.ok(registered['desktopHotkeys.keydown'] && registered['desktopHotkeys.keyup'], 'keydown and keyup both registered');
    assert.strictEqual(registered['desktopHotkeys.keydown'].priority, 90, 'below the workstation lock (100)');
    assert.strictEqual(registered['desktopHotkeys.keyup'].eventType, 'keyup');
    assert.strictEqual(calls.length, 0);
}

// a Windows-key tap opens Start on release
{
    const { calls, t } = hotkeysContext();
    assert.strictEqual(t.onKeydown(metaDown()), false, 'the press itself does nothing yet');
    const up = metaUp();
    assert.strictEqual(t.onKeyup(up), true);
    assert.ok(up.defaultPrevented);
    assert.deepStrictEqual(calls, [['toggleStartMenu']]);
}

// Win+D is Show desktop, and the Windows key's release then does not open Start
{
    const { calls, t } = hotkeysContext();
    t.onKeydown(metaDown());
    const d = winCombo('d', 'KeyD');
    assert.strictEqual(t.onKeydown(d), true);
    assert.ok(d.defaultPrevented);
    assert.strictEqual(t.onKeyup(metaUp()), false);
    assert.deepStrictEqual(calls, [['showDesktop']]);
}

// an unknown Win combo is still a combo (no Start) and keeps the browser's default
{
    const { calls, t } = hotkeysContext();
    t.onKeydown(metaDown());
    const v = winCombo('v', 'KeyV');
    assert.strictEqual(t.onKeydown(v), false);
    assert.ok(!v.defaultPrevented);
    t.onKeyup(metaUp());
    assert.deepStrictEqual(calls, []);
}

// Win+Tab is left to keyboardShortcuts.js's switcher
{
    const { t } = hotkeysContext();
    t.onKeydown(metaDown());
    assert.strictEqual(t.onKeydown(winCombo('Tab', 'Tab')), false);
}

// Win+E / R / F / L / F1 / Pause / Space / digits
{
    const { calls, t } = hotkeysContext();
    t.onKeydown(winCombo('e', 'KeyE'));
    t.onKeydown(winCombo('r', 'KeyR'));
    t.onKeydown(winCombo('f', 'KeyF'));
    t.onKeydown(winCombo('l', 'KeyL'));
    t.onKeydown(winCombo('F1', 'F1'));
    t.onKeydown(winCombo('Pause', 'Pause'));
    t.onKeydown(winCombo(' ', 'Space'));
    t.onKeydown(winCombo('2', 'Digit2'));
    assert.strictEqual(t.onKeydown(winCombo('9', 'Digit9')), true, 'a Quick Launch place with no button is still Win+9');
    assert.deepStrictEqual(calls, [
        ['openExplorerApplet', 'Computer'],
        ['loadFeature', 'run'],
        ['openStartMenu'], ['searchFocus'],
        ['lock'],
        ['help'],
        ['loadFeature', 'control_panel'],
        ['openVistaSidebar'],
        ['quickLaunch', 2]
    ]);
}

// key repeat does not run the action again
{
    const { calls, t } = hotkeysContext();
    t.onKeydown(winCombo('d', 'KeyD', { repeat: true }));
    assert.deepStrictEqual(calls, []);
}

// Win+M minimises the windows up; Win+Shift+M brings the same ones back
{
    const { calls, t, windows } = hotkeysContext();
    t.onKeydown(winCombo('m', 'KeyM'));
    assert.deepStrictEqual(calls, [['minimize', 'a'], ['minimize', 'b']]);
    calls.length = 0;
    t.onKeydown(winCombo('M', 'KeyM', { shiftKey: true }));
    assert.deepStrictEqual(calls, [['restore', 'a'], ['restore', 'b']], 'c was minimised before Win+M and stays');
    assert.ok(windows[2].classList.contains('minimised'));
}

// Ctrl+Esc opens Start
{
    const { calls, t } = hotkeysContext();
    assert.strictEqual(t.onKeydown(key('keydown', 'Escape', 'Escape', { ctrlKey: true })), true);
    assert.deepStrictEqual(calls, [['toggleStartMenu']]);
}

// Alt+F4 closes the window in front with its own Close button; none in front: the browser's default
{
    const { t, windows } = hotkeysContext();
    const ev = key('keydown', 'F4', 'F4', { altKey: true });
    assert.strictEqual(t.onKeydown(ev), true);
    assert.ok(ev.defaultPrevented);
    assert.strictEqual(windows[0].closeBtn.clicks, 1);
}
{
    const { ctx, t } = hotkeysContext();
    ctx.canCloseWindowWithAltQ = () => false;
    const ev = key('keydown', 'F4', 'F4', { altKey: true });
    assert.strictEqual(t.onKeydown(ev), false);
    assert.ok(!ev.defaultPrevented, 'no window: Alt+F4 still closes the app');
}
{
    const { t, windows } = hotkeysContext({ standalone: false });
    assert.strictEqual(t.onKeydown(key('keydown', 'F4', 'F4', { altKey: true })), false, 'a browser tab keeps Alt+F4');
    assert.strictEqual(windows[0].closeBtn.clicks, 0);
}

// nothing before the desktop is up (logon, Setup, booting, locked)
for (const state of ['logon', 'booting', 'locked']) {
    const { calls, t } = hotkeysContext({ desktopState: state });
    t.onKeydown(metaDown());
    assert.strictEqual(t.onKeyup(metaUp()), false);
    assert.strictEqual(t.onKeydown(winCombo('d', 'KeyD')), false);
    assert.deepStrictEqual(calls, [], state);
}

// Cmd on a Mac is not the Windows key
{
    const { calls, t } = hotkeysContext({ platform: 'MacIntel' });
    t.onKeydown(metaDown());
    t.onKeyup(metaUp());
    assert.strictEqual(t.onKeydown(winCombo('d', 'KeyD')), false);
    assert.deepStrictEqual(calls, []);
}

// a click while the Windows key is down cancels the Start tap
{
    const { calls, t, listeners } = hotkeysContext();
    t.onKeydown(metaDown());
    listeners.pointerdown();
    t.onKeyup(metaUp());
    assert.deepStrictEqual(calls, []);
}

// ---- keyboardShortcuts.js: Alt+Tab / Win+Tab ------------------------------------------------------

function shortcutsContext({ platform = 'Win32', flip3d } = {}) {
    const src = read('public/scripts/comp/keyboardShortcuts.js');
    const pick = (name) => {
        const start = src.indexOf(`function ${name}(`);
        assert.ok(start >= 0, name);
        let depth = 0;
        for (let i = src.indexOf('{', start); i < src.length; i++) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
        }
        throw new Error(name);
    };
    const log = [];
    const ctx = { navigator: { platform }, window: { isDesktop: true, flip3d }, Date, performance, log };
    vm.createContext(ctx);
    vm.runInContext(`
        var windowSwitcherActive = false, windowSwitcherWindows = [], windowSwitcherSelectedIndex = 0,
            windowSwitcherIconsBuiltFor = null, windowSwitcherHoldKey = null, ctrlKeyPressed = false,
            altKeyPressed = false, suppressAltOverlayUntilRelease = false, activeAltKeyCodes = new Set(),
            runAppletLastAltUpTime = 0, flip3dUnavailable = false, flip3dMetaUpAt = 0;
        const RUN_APPLET_DOUBLE_ALT_MS = 400;
        function startWindowSwitcher() { log.push('start'); windowSwitcherActive = true; windowSwitcherWindows = ['w1', 'w2', 'w3']; }
        function navigateWindowSwitcher(d) { log.push('nav ' + d); }
        function activateSelectedWindow() { log.push('activate'); }
        function hideShortcutsOverlay() {}
        function hideWindowSwitcher() {}
        function markPromptShortcutHandled() {}
        function getShortcutOverlayContextFlags() { return {}; }
        function ensureKeyboardShortcutOverlaysRegistered() {}
        function getActiveKeyboardOverlayEntries() { return []; }
        const featureLoader = { loadFeature: (name) => { log.push(name === 'run' ? 'run' : 'load ' + name); return { then() { return { catch() {} }; } }; } };
        ${pick('openFlip3d')}
        ${pick('windowSwitcherHoldKeyFor')}
        ${pick('stopWindowSwitcher')}
        ${pick('handleKeyDown')}
        ${pick('handleKeyUp')}
    `, ctx);
    return ctx;
}

function sk(type, k, mods = {}) {
    return Object.assign(key(type, k, k, mods), { target: null });
}

// Alt+Tab, Tab, release Alt: switches to the window picked; the release is not a Run tap
{
    const c = shortcutsContext();
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { altKey: true }));
    assert.strictEqual(vm.runInContext('windowSwitcherHoldKey', c), 'Alt');
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { altKey: true }));
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Alt'));
    assert.deepStrictEqual(c.log, ['start', 'nav 1', 'nav 1', 'activate']);
    assert.strictEqual(vm.runInContext('windowSwitcherActive', c), false);
    // a single Alt tap right after is the first tap, not the second
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Alt'));
    assert.ok(!c.log.includes('run'), 'Alt+Tab then Alt does not open Run');
}

// Alt+Shift+Tab goes straight back to the last window
{
    const c = shortcutsContext();
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { altKey: true, shiftKey: true }));
    assert.deepStrictEqual(c.log, ['start', 'nav -1']);
}

// Win+Tab is Flip 3D (flip3d.js), held on the Windows key; Ctrl+Win+Tab keeps it open
{
    const opened = [];
    const flip3d = { open: (mode, o) => { opened.push(`${mode} ${o.holdKey}`); return true; } };
    const c = shortcutsContext({ flip3d });
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { metaKey: true }));
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { metaKey: true, ctrlKey: true }));
    assert.deepStrictEqual(opened, ['hold Meta', 'sticky Meta']);
    assert.deepStrictEqual(c.log, [], 'the window switcher stays shut');
}

// Flip 3D not loaded yet: Win+Tab loads it (and does not start the switcher meanwhile)
{
    const c = shortcutsContext();
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { metaKey: true }));
    assert.deepStrictEqual(c.log, ['load flip3d']);
}

// Without WebGL (flip3d.open false), Win+Tab holds the switcher on the Windows key; Ctrl's
// release does nothing then
{
    const c = shortcutsContext({ flip3d: { open: () => false } });
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { metaKey: true }));
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Control'));
    assert.ok(!c.log.includes('activate'));
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Meta'));
    assert.deepStrictEqual(c.log, ['start', 'nav 1', 'activate']);
}

// Esc puts the switcher away without switching
{
    const c = shortcutsContext();
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { altKey: true }));
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Escape', { altKey: true }));
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Alt'));
    assert.deepStrictEqual(c.log, ['start', 'nav 1']);
}

// Ctrl+Tab as before; Ctrl+Shift+Tab starts on this window
{
    const c = shortcutsContext();
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { ctrlKey: true, shiftKey: true }));
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Control'));
    assert.deepStrictEqual(c.log, ['start', 'activate']);
}

// Cmd+Tab on a Mac is the Mac's
{
    const c = shortcutsContext({ platform: 'MacIntel' });
    vm.runInContext('handleKeyDown', c)(sk('keydown', 'Tab', { metaKey: true }));
    assert.ok(!c.log.includes('start'));
}

// double-Alt still opens Run
{
    const c = shortcutsContext();
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Alt'));
    vm.runInContext('handleKeyUp', c)(sk('keyup', 'Alt'));
    assert.ok(c.log.includes('run'));
}

// wiring
const html = read('public/app.html');
assert.ok(html.indexOf('scripts/comp/desktopHotkeys.js') > html.indexOf('scripts/comp/modalKeyboardRegistry.js'), 'loads after the keyboard registry');

console.log('desktop hotkeys: ok');
