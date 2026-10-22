#!/usr/bin/env node
// Winlogon power path (winlogonPower.js): the dark screen before /launch and Vista's
// "The following programs are still running:" screen (winsrv.dll dialog 20).
// Run: node scripts/test-winlogon-power.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/winlogonPower.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/desktop-shell.css'), 'utf8');

// --- a small DOM: enough for the screen's own markup ---
class FakeClassList {
    constructor() { this.set = new Set(); }
    add(...names) { names.forEach((n) => this.set.add(n)); }
    remove(...names) { names.forEach((n) => this.set.delete(n)); }
    contains(name) { return this.set.has(name); }
    toggle(name, on) {
        const want = on === undefined ? !this.set.has(name) : !!on;
        if (want) this.set.add(name); else this.set.delete(name);
        return want;
    }
}

class FakeElement {
    constructor(doc, tag) {
        this.ownerDocument = doc;
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.classList = new FakeClassList();
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.hidden = false;
        this.id = '';
        this._text = '';
    }
    set className(value) { this.classList = new FakeClassList(); String(value).split(/\s+/).filter(Boolean).forEach((n) => this.classList.add(n)); }
    get className() { return Array.from(this.classList.set).join(' '); }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    set textContent(value) { this.children = []; this._text = String(value); }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set innerHTML(value) { this.children = []; this._text = String(value); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    dispatch(type, event = {}) { (this.listeners[type] || []).slice().forEach((fn) => fn(event)); }
    click() { this.dispatch('click', { target: this }); }
    focus() { this.ownerDocument.activeElement = this; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    get firstElementChild() { return this.children[0] || null; }
    walk(fn) { if (fn(this)) return this; for (const c of this.children) { const hit = c.walk(fn); if (hit) return hit; } return null; }
    byClass(name) {
        const out = [];
        this.walk((el) => { if (el.classList.contains(name)) out.push(el); return false; });
        return out;
    }
}

function fakeDocument() {
    const doc = { activeElement: null, listeners: {} };
    doc.createElement = (tag) => new FakeElement(doc, tag);
    doc.createTextNode = (text) => { const node = new FakeElement(doc, '#text'); node._text = String(text); return node; };
    doc.body = new FakeElement(doc, 'body');
    doc.getElementById = (id) => doc.body.walk((el) => el.id === id);
    doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
    doc.removeEventListener = (type, fn) => { doc.listeners[type] = (doc.listeners[type] || []).filter((f) => f !== fn); };
    doc.key = (key, extra = {}) => (doc.listeners.keydown || []).slice().forEach((fn) => fn({ key, preventDefault() {}, ...extra }));
    return doc;
}

function fakeModal(doc, { id, title, z = 0, minimised = false }) {
    const modal = doc.createElement('div');
    modal.id = id;
    modal.title = title;
    modal.className = minimised ? 'modal minimised' : 'modal';
    modal.style.zIndex = String(z);
    return modal;
}

// --- a virtual clock: timers only fire when the test moves time on ---
function sandbox({ blockers = [], open = [], logout, onDesktopFlush, pending = false } = {}) {
    const log = [];
    let now = 0;
    let timers = [];
    const doc = fakeDocument();
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        document: doc,
        Image: class { decode() { return Promise.resolve(); } },
        setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
        clearTimeout() {},
        bypassConfirmation: false,
        isDesktop: true,
        desktopSounds: { play: (name) => log.push(`sound:${name}`) },
        dismissTransientUIForShutdown: () => log.push('dismiss'),
        suppressWebSocketReconnectForReload: () => log.push('suppress'),
        restartClientNavigate: () => log.push(`launch@${now}`),
        handleLogout: (opts) => { log.push(`logout:${JSON.stringify(opts)}@${now}`); return logout ? logout() : Promise.resolve(true); },
        getModalTitle: (modal) => modal.title,
        getModalIcons: () => ({}),
        getIconHTML: () => '',
        getOpenTaskbarModals: () => open,
        desktopShortcuts: {
            hasPendingDesktopChanges: () => pending,
            flushPendingDesktopLayout: () => { log.push(`flush@${now}`); return onDesktopFlush ? onDesktopFlush() : Promise.resolve(); }
        },
        notepadManager: { notepads: new Map(blockers.map((m, i) => [i, { hasUnsavedChanges: true, element: m }])) }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    ctx.WINLOGON_POWER_BLACK_MS = vm.runInContext('WINLOGON_POWER_BLACK_MS', ctx);
    ctx.WINLOGON_POWER_BLACK_MAX_MS = vm.runInContext('WINLOGON_POWER_BLACK_MAX_MS', ctx);
    // the Welcome screen and the cover are the desktop's own; their timing is what matters here
    ctx.fadeShutdownCover = (show) => {
        log.push(show ? `dark-start@${now}` : `reveal@${now}`);
        return new Promise((resolve) => ctx.setTimeout(() => {
            if (show) log.push(`dark@${now}`);
            resolve();
        }, show ? ctx.WINLOGON_FADE_OUT_MS : ctx.WINLOGON_FADE_IN_MS));
    };
    ctx.showWinlogonPowerScreen = (text) => log.push(`screen:${text}@${now}`);
    ctx.hideWinlogonPowerScreen = () => log.push('hide');
    const flush = () => new Promise((r) => setImmediate(r));
    const advance = async (ms) => {
        const end = now + ms;
        for (;;) {
            await flush();
            await flush();
            timers.sort((a, b) => a.at - b.at);
            const next = timers[0];
            if (!next || next.at > end) break;
            timers.shift();
            now = next.at;
            next.fn();
        }
        now = end;
        await flush();
    };
    return { ctx, log, doc, advance, time: () => now };
}

const darkAt = (log) => Number(log.filter((l) => l.startsWith('dark@')).pop().split('@')[1]);
const launchAt = (log) => {
    const hit = log.find((l) => l.startsWith('launch@'));
    return hit ? Number(hit.split('@')[1]) : null;
};

(async () => {
    // Restart, nothing blocking: Welcome screen, then black for 2.5 s, then /launch
    let s = sandbox();
    let run = s.ctx.runWinlogonPower('restart');
    await s.advance(20000);
    assert.strictEqual(await run, true);
    assert.ok(s.log.some((l) => l.startsWith('screen:Shutting down...')), 'Shutting down... shown');
    let black = darkAt(s.log);
    assert.strictEqual(launchAt(s.log) - black, s.ctx.WINLOGON_POWER_BLACK_MS, 'restart: 2.5 s of black, then /launch');
    assert.ok(s.ctx.WINLOGON_POWER_BLACK_MS >= 2000 && s.ctx.WINLOGON_POWER_BLACK_MS <= 3000, 'usual black is 2-3 s');
    assert.ok(s.ctx.WINLOGON_POWER_BLACK_MAX_MS >= 5000 && s.ctx.WINLOGON_POWER_BLACK_MAX_MS <= 8000, 'linger cap is 5-8 s');
    assert.strictEqual(s.log.filter((l) => l.startsWith('launch@')).length, 1);

    // Shut down goes to /launch too (no window.close)
    s = sandbox();
    run = s.ctx.runWinlogonPower('shutdown');
    await s.advance(20000);
    assert.strictEqual(launchAt(s.log) - darkAt(s.log), s.ctx.WINLOGON_POWER_BLACK_MS, 'shutdown: black, then /launch');

    // Log off: the request runs in the dark and holds it until it answers
    let answer;
    s = sandbox({ logout: () => new Promise((r) => { answer = r; }) });
    run = s.ctx.runWinlogonPower('logoff');
    await s.advance(3000);
    assert.ok(s.log.some((l) => l.startsWith('screen:Logging off...')), 'Logging off... shown');
    const logoutLine = s.log.find((l) => l.startsWith('logout:'));
    assert.ok(logoutLine && logoutLine.includes('"redirect":false'), 'logout stays on the page');
    const screenAt = Number(s.log.find((l) => l.startsWith('screen:')).split('@')[1]);
    assert.ok(Number(logoutLine.split('@')[1]) > screenAt, 'logout starts after Logging off... is up');
    await s.advance(3000);
    black = darkAt(s.log);
    assert.strictEqual(launchAt(s.log), null, 'still dark while the logout is pending');
    const answeredAt = black + 4200;
    await s.advance(answeredAt - s.time());
    answer(true);
    await s.advance(10);
    assert.strictEqual(launchAt(s.log), answeredAt, 'leaves as soon as the logout answers');

    // ...but never past the cap
    s = sandbox({ logout: () => new Promise(() => {}) });
    run = s.ctx.runWinlogonPower('logoff');
    await s.advance(30000);
    assert.strictEqual(launchAt(s.log) - darkAt(s.log), s.ctx.WINLOGON_POWER_BLACK_MAX_MS, 'logoff: capped linger');

    // Pending desktop saves are flushed in the dark
    s = sandbox({ pending: true, onDesktopFlush: () => new Promise((r) => setTimeout(r, 0)) });
    let flushDone;
    s.ctx.desktopShortcuts.flushPendingDesktopLayout = () => {
        s.log.push(`flush@${s.time()}`);
        return new Promise((r) => { flushDone = r; });
    };
    run = s.ctx.runWinlogonPower('restart');
    await s.advance(4000);
    assert.ok(s.log.some((l) => l.startsWith('flush@')), 'desktop layout flushed');
    black = darkAt(s.log);
    await s.advance(black + 3500 - s.time());
    assert.strictEqual(launchAt(s.log), null, 'waits for the save');
    flushDone();
    await s.advance(10);
    assert.strictEqual(launchAt(s.log), black + 3500);

    // Restart Server: a failed PM2 post brings the desktop back, no /launch
    s = sandbox();
    run = s.ctx.runWinlogonPower('server', { onCommit: () => Promise.reject(new Error('pm2 down')) });
    run.catch(() => {});
    await s.advance(20000);
    await assert.rejects(run, /pm2 down/);
    assert.ok(s.log.includes('hide'), 'Welcome screen hidden again');
    assert.strictEqual(launchAt(s.log), null);
    // ...a slow disconnect still leaves at the cap (the /launch boot waits for the server)
    s = sandbox();
    run = s.ctx.runWinlogonPower('server', { onCommit: () => new Promise(() => {}) });
    await s.advance(30000);
    assert.strictEqual(launchAt(s.log) - darkAt(s.log), s.ctx.WINLOGON_POWER_BLACK_MAX_MS);

    // Still-running screen: every program, the blockers first with the reason
    const doc0 = fakeDocument();
    const pad = fakeModal(doc0, { id: 'notepad1', title: 'Untitled - Notepad', z: 5 });
    const back = fakeModal(doc0, { id: 'cpl', title: 'Control Panel', z: 10 });
    const front = fakeModal(doc0, { id: 'lumen', title: 'Lumen', z: 20 });
    const minimised = fakeModal(doc0, { id: 'games', title: 'Games', z: 30, minimised: true });
    s = sandbox({ blockers: [pad], open: [back, minimised, pad, front] });
    run = s.ctx.runWinlogonPower('restart');
    await s.advance(500);
    const root = s.doc.getElementById('winlogonBlock');
    assert.ok(root && !root.hidden, 'still-running screen shown');
    assert.strictEqual(s.doc.getElementById('winlogonBlockTitle').textContent, 'The following programs are still running:');
    const rows = root.byClass('winlogon-block-row');
    assert.deepStrictEqual(rows.map((r) => r.byClass('winlogon-block-name')[0].textContent),
        ['Untitled - Notepad', 'Lumen', 'Control Panel', 'Games'], 'blockers, then front to back, minimised last');
    assert.deepStrictEqual(rows.map((r) => r.classList.contains('blocking')), [true, false, false, false]);
    assert.strictEqual(rows[0].byClass('winlogon-block-reason')[0].textContent, 'This program is preventing your computer from restarting.');
    assert.strictEqual(rows[1].byClass('winlogon-block-reason').length, 0, 'no reason on programs that are not blocking');
    assert.strictEqual(s.doc.getElementById('winlogonBlockFooter').textContent,
        'To close these programs and restart your computer,\nclick Restart now.\nYou may lose work that you haven\'t saved.');
    assert.strictEqual(s.doc.getElementById('winlogonBlockGoLabel').textContent, 'Restart now');
    assert.strictEqual(s.doc.activeElement, s.doc.getElementById('winlogonBlockGo'), 'Restart now has the focus');
    assert.strictEqual(root.byClass('winlogon-block-busy').length, 1, 'busy mark on the button');
    // Cancel goes back to the desktop: nothing dark, no /launch
    s.doc.getElementById('winlogonBlockCancel').click();
    await s.advance(20000);
    assert.strictEqual(await run, false);
    assert.ok(root.hidden);
    assert.ok(!s.log.some((l) => l.startsWith('dark-start')), 'cancel does not shut down');

    // Enter presses the focused button; Escape cancels; Tab moves between the two
    s = sandbox({ blockers: [pad] });
    run = s.ctx.runWinlogonPower('shutdown');
    await s.advance(500);
    assert.strictEqual(s.doc.getElementById('winlogonBlockGoLabel').textContent, 'Shut down now');
    assert.strictEqual(s.doc.getElementById('winlogonBlock').byClass('winlogon-block-reason')[0].textContent,
        'This program is preventing your computer from shutting down.');
    s.doc.key('Tab');
    assert.strictEqual(s.doc.activeElement, s.doc.getElementById('winlogonBlockCancel'));
    s.doc.key('Enter');
    await s.advance(20000);
    assert.strictEqual(await run, false, 'Enter on Cancel cancels');

    s = sandbox({ blockers: [pad] });
    run = s.ctx.runWinlogonPower('logoff');
    await s.advance(500);
    assert.strictEqual(s.doc.getElementById('winlogonBlockGoLabel').textContent, 'Log off now');
    s.doc.key('Enter');
    await s.advance(30000);
    assert.strictEqual(await run, true, 'Enter on Log off now logs off');
    assert.ok(launchAt(s.log) !== null);

    // CSS: winsrv.dll's measured layout and art
    const block = css.slice(css.indexOf('.winlogon-block {'), css.indexOf('/* Start menu organizer'));
    assert.ok(/\.winlogon-block-dialog \{[^}]*width: 466px/.test(block), 'dialog 266 DLU wide');
    assert.ok(/background: rgba\(0, 0, 0, 0\.88\)/.test(block), 'desktop at 12 %');
    assert.ok(/\.winlogon-block-reason \{[^}]*color: #ffcc99/.test(block), 'reason colour');
    assert.ok(/\.winlogon-block-row\.blocking \{[^}]*height: 83px/.test(block) && /\.winlogon-block-row \{[^}]*height: 62px/.test(block), 'row heights');
    ['restart-normal', 'restart-focus', 'cancel-normal', 'busy', 'rule'].forEach((name) => {
        assert.ok(block.includes(`/static_images/vista-shutdown/${name}.png`), `${name} art used`);
        assert.ok(fs.existsSync(path.join(__dirname, `../public/static_images/vista-shutdown/${name}.png`)), `${name} art exists`);
    });

    console.log('✅ test-winlogon-power: all assertions passed');
})().catch((err) => {
    console.error('❌ test-winlogon-power failed:', err);
    process.exit(1);
});
