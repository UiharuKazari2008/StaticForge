#!/usr/bin/env node
// Program faults (programFaults.js): an uncaught exception is traced to the desktop program that
// threw it, and Vista's "<program> has stopped working" dialog closes or restarts only that
// program; a fault in the shell offers the client restart; repeats never stack dialogs; Continue
// keeps the program running; every dialog is upserted to the server (modules/programFaultReports.js)
// and Copy Report copies the report id when the server confirms it, the full error when not.
// Run: node scripts/test-program-faults.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, createRateLimiter, mountProgramFaultReports, faultId, MAX_BODY_BYTES } = require(path.join(__dirname, '../modules/programFaultReports.js'));
const realSetTimeout = setTimeout;

// ---- a small DOM: enough for the dialog, the windows and closest/querySelector ---------------

class ClassList {
    constructor(el) { this.el = el; this.set = new Set(); }
    add(...c) { c.forEach((x) => this.set.add(x)); }
    remove(...c) { c.forEach((x) => this.set.delete(x)); }
    contains(c) { return this.set.has(c); }
    toggle(c, on) { const want = on === undefined ? !this.set.has(c) : !!on; if (want) this.set.add(c); else this.set.delete(c); return want; }
}

const camelToData = (k) => 'data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

class Element {
    constructor(tag, doc) {
        this.tagName = tag.toUpperCase();
        this.ownerDocument = doc;
        this.children = [];
        this.parentNode = null;
        this.attrs = {};
        this.classList = new ClassList(this);
        this.listeners = {};
        this._text = '';
        this.hidden = false;
        this.disabled = false;
        this.style = {};
        const self = this;
        this.dataset = new Proxy({}, {
            get: (_, k) => self.attrs[camelToData(k)],
            set: (_, k, v) => { self.attrs[camelToData(k)] = String(v); return true; },
            deleteProperty: (_, k) => { delete self.attrs[camelToData(k)]; return true; }
        });
    }
    get className() { return Array.from(this.classList.set).join(' '); }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    setAttribute(k, v) { if (k === 'class') this.className = v; else this.attrs[k] = String(v); }
    getAttribute(k) { return k === 'class' ? this.className : (k in this.attrs ? this.attrs[k] : null); }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    append(...cs) { cs.forEach((c) => this.appendChild(c)); }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
    get firstElementChild() { return this.children[0] || null; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    dispatch(t, ev = {}) {
        const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, ...ev };
        for (let n = this; n; n = n.parentNode) (n.listeners[t] || []).forEach((fn) => fn(e));
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { this.ownerDocument.activeElement = this; }
    matchesSimple(sel) {
        const parts = sel.match(/[#.]?[^#.]+/g) || [];
        return parts.every((p) => (p[0] === '#' ? this.id === p.slice(1) : p[0] === '.' ? this.classList.contains(p.slice(1)) : this.tagName === p.toUpperCase()));
    }
    descendants() { const out = []; const walk = (n) => n.children.forEach((c) => { out.push(c); walk(c); }); walk(this); return out; }
    querySelectorAll(selector) {
        let s = selector.trim();
        let pool;
        if (s.startsWith(':scope >')) {
            s = s.slice(8).trim();
            const [first, ...rest] = s.split(/\s+/);
            pool = this.children.filter((c) => c.matchesSimple(first));
            for (const part of rest) pool = [...new Set(pool.flatMap((p) => p.descendants().filter((d) => d.matchesSimple(part))))];
            return pool;
        }
        const [first, ...rest] = s.split(/\s+/);
        pool = this.descendants().filter((d) => d.matchesSimple(first));
        for (const part of rest) pool = [...new Set(pool.flatMap((p) => p.descendants().filter((d) => d.matchesSimple(part))))];
        return pool;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
        const alts = selector.split(',').map((x) => x.trim());
        for (let n = this; n && n.matchesSimple; n = n.parentNode) if (alts.some((a) => n.matchesSimple(a))) return n;
        return null;
    }
}

function makeDocument() {
    const doc = { activeElement: null };
    doc.createElement = (t) => new Element(t, doc);
    doc.documentElement = new Element('html', doc);
    doc.body = new Element('body', doc);
    doc.documentElement.appendChild(doc.body);
    doc.getElementById = (id) => doc.documentElement.descendants().find((e) => e.id === id) || null;
    doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
    doc.querySelector = (s) => doc.documentElement.querySelector(s);
    return doc;
}

// ---- the page --------------------------------------------------------------------------------

const ORIGIN = 'http://127.0.0.1:9220';
const doc = makeDocument();
doc.body.classList.add('desktop-mode');
const timers = [];
const calls = [];

const win = {
    document: doc,
    location: { origin: ORIGIN, href: ORIGIN + '/app' },
    addEventListener() {},
    getClientDesktopState: () => 'desktop',
    openModal(m) { m.classList.remove('hidden'); calls.push(['openModal', m.id]); },
    closeModal(m) { m.classList.add('hidden'); calls.push(['closeModal', m.id]); return Promise.resolve(); },
    runWinlogonPower(action) { calls.push(['runWinlogonPower', action]); return Promise.resolve(); },
    restartClientNavigate() { calls.push(['restartClientNavigate']); },
    openVistaGame(id) { calls.push(['openVistaGame', id]); return Promise.resolve(); },
    VistaGames: { closeWindow(w) { calls.push(['VistaGames.closeWindow', w.modal.id]); w.modal.classList.add('hidden'); } }
};

// the server's fault report store behind a fetch stub (the routes of mountProgramFaultReports)
const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-reports-'));
const store = createStore({ dir: reportDir });
const net = { postFails: false, getStatus: 0, posts: 0, clipboard: '' };
const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
win.fetch = (url, init = {}) => {
    if (url === '/api/fault-reports' && init.method === 'POST') {
        net.posts++;
        if (net.postFails) return Promise.reject(new TypeError('Failed to fetch'));
        return store.upsert(JSON.parse(init.body)).then((r) => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: r.id, count: r.count, file: r.file }) }));
    }
    const m = String(url).match(/^\/api\/fault-reports\/([^/?]+)$/);
    if (m) {
        if (net.getStatus) return reply(net.getStatus, { ok: false, error: 'down' });
        return store.read(decodeURIComponent(m[1])).then((report) => (report
            ? { ok: true, status: 200, json: () => Promise.resolve({ ok: true, report, file: 'data/fault-reports/' + report.id + '.json' }) }
            : { ok: false, status: 404, json: () => Promise.resolve({ ok: false, error: 'No such fault report' }) }));
    }
    return reply(404, { ok: false });
};
win.navigator = { userAgent: 'test', clipboard: { writeText: (t) => { net.clipboard = t; return Promise.resolve(); } } };
global.window = win;
global.document = doc;
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
global.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = null; };
global.FEATURE_MANIFEST = {
    vista_games: { scripts: ['scripts/comp/desktop-apps/vista-games/vistaGameEngine.js'] },
    vista_cards: { scripts: ['scripts/comp/desktop-apps/vista-games/cardEngine.js'] },
    vista_solitaire: { scripts: ['scripts/comp/desktop-apps/vista-games/solitaire.js'] },
    vista_minesweeper: { scripts: ['scripts/comp/desktop-apps/vista-games/minesweeper.js'] },
    emotion: { scripts: ['scripts/comp/desktop-apps/emotion.js'] },
    media_player: { scripts: ['scripts/comp/desktop-apps/mediaPlayer.js'] },
    grimoire: { scripts: ['scripts/comp/grimoireRemoteBrowser.js', 'scripts/comp/tagWikiSearchModal.js'] }
};
const launchActions = [];
global.collectStartMenuLaunchableDescriptors = () => [
    { launchId: 'emotion', text: 'eMotion', action: () => { launchActions.push('emotion'); } },
    { launchId: 'director', text: 'Director', action: () => { launchActions.push('director'); } },
    { launchId: 'media-player', text: 'Media Player', action: () => { launchActions.push('media-player'); } },
    { launchId: 'game-solitaire', game: 'solitaire', text: 'Solitaire', action: () => {} },
    { launchId: 'game-minesweeper', game: 'minesweeper', text: 'Minesweeper', action: () => {} }
];
const consoleError = console.error;
console.error = () => {};

const PF = require(path.join(__dirname, '../public/scripts/comp/programFaults.js'));
assert.strictEqual(win.programFaults, PF, 'the module publishes window.programFaults');

/** Fire the timers pending now (not the ones they queue), but never the report uploads' time limits */
const REPORT_LIMITS = new Set([8000, 1500]);
function runTimers(maxMs = Infinity, minMs = -Infinity) {
    const pending = timers.length;
    for (let i = 0; i < pending; i++) {
        const t = timers[i];
        if (t.fn && t.ms <= maxMs && t.ms >= minMs && !REPORT_LIMITS.has(t.ms)) { const fn = t.fn; t.fn = null; fn(); }
    }
}
const flush = () => new Promise((r) => setImmediate(r));

function makeWindow(id, title, extra = {}) {
    const m = doc.createElement('div');
    m.className = 'modal ' + (extra.className || '');
    m.id = id;
    const t = doc.createElement('div'); t.className = 'modal-window-title';
    const main = doc.createElement('div'); main.className = 'modal-window-title-main';
    const span = doc.createElement('span'); span.textContent = title;
    main.appendChild(span); t.appendChild(main); m.appendChild(t);
    const content = doc.createElement('div'); content.className = 'modal-content';
    const btn = doc.createElement('button'); btn.className = 'app-button';
    content.appendChild(btn); m.appendChild(content);
    Object.entries(extra.data || {}).forEach(([k, v]) => { m.dataset[k] = v; });
    doc.body.appendChild(m);
    return m;
}

const frame = (file, fn = 'handler') => `    at ${fn} (${ORIGIN}/scripts/${file}?sha=abc123:10:20)`;
const stack = (...frames) => ['Error: boom', ...frames].join('\n');

// ---- stack parsing ---------------------------------------------------------------------------

assert.deepStrictEqual(PF.stackScripts(stack(
    frame('comp/desktop-apps/vista-games/solitaire.js'),
    `    at async load (${ORIGIN}/scripts/comp/featureLoader.js:5:1)`,
    '    at https://cdn.example.com/lib.js:1:1',
    '    at <anonymous>'
)), ['/scripts/comp/desktop-apps/vista-games/solitaire.js', '/scripts/comp/featureLoader.js'],
'same-origin frames in order, query stripped, cross-origin dropped');

// ---- script classification -------------------------------------------------------------------

assert.strictEqual(PF.classifyScript('/scripts/comp/modalUtils.js'), 'core');
assert.strictEqual(PF.classifyScript('/scripts/websocket.js'), 'core');
assert.strictEqual(PF.classifyScript('/scripts/ws/wsInboundRegistry.js'), 'core');
assert.deepStrictEqual(PF.classifyScript('/scripts/comp/director.js'), { launchId: 'director' });
assert.deepStrictEqual(PF.classifyScript('/scripts/comp/desktop-apps/vista-games/solitaire.js'), { game: 'solitaire' });
assert.deepStrictEqual(PF.classifyScript('/scripts/comp/desktop-apps/emotion.js'), { launchId: 'emotion' });
assert.deepStrictEqual(PF.classifyScript('/scripts/comp/tagWikiSearchModal.js'), { launchId: 'encyclopedia' });
assert.strictEqual(PF.classifyScript('/scripts/comp/desktop-apps/vista-games/cardEngine.js'), 'lib', 'the card engine is shared');
assert.strictEqual(PF.classifyScript('/scripts/comp/customScrollbar.js'), 'lib');

// ---- attribution -----------------------------------------------------------------------------

const solitaire = makeWindow('vistaSolitaireModal', 'Solitaire', { className: 'vista-game-window', data: { vistaGame: 'solitaire' } });
solitaire.__vg = { modal: solitaire };
const minesweeper = makeWindow('vistaMinesweeperModal', 'Minesweeper', { className: 'vista-game-window', data: { vistaGame: 'minesweeper' } });
minesweeper.__vg = { modal: minesweeper };
const emotion = makeWindow('emotionModal', 'eMotion');
PF.registerProgram('emotionModal', { launchId: 'emotion' });
const lumen = makeWindow('imageViewerModal_3', 'Lumen - cat.png');
const studio = makeWindow('manualModal', 'DreamStudio 2026 R7');
const studioTool = makeWindow('positionDialog', 'Character Position', { data: { parentModalId: 'manualModal' } });
const taskbar = doc.createElement('div'); taskbar.id = 'desktopTaskbar'; doc.body.appendChild(taskbar);
const taskbarButton = doc.createElement('button'); taskbar.appendChild(taskbarButton);

let p = PF.attribute({ stack: stack(frame('comp/modalUtils.js', 'openModal'), frame('comp/desktop-apps/vista-games/solitaire.js', 'onClick')) });
assert.strictEqual(p.key, 'game:solitaire', 'the topmost program frame wins over the shell code it called');
assert.strictEqual(p.name, 'Solitaire');
assert.strictEqual(p.window, solitaire);

p = PF.attribute({ stack: stack(frame('comp/modalUtils.js'), frame('comp/contextMenu.js')) });
assert.strictEqual(p.core, true, 'shell frames only: the desktop');
assert.strictEqual(p.name, 'Melaton Desktop');

p = PF.attribute({ stack: stack(frame('comp/desktop-apps/vista-games/cardEngine.js')), eventWindow: minesweeper.children[1].children[0].closest('.modal') });
assert.strictEqual(p.key, 'game:minesweeper', 'shared library frames: the window the event hit');

p = PF.attribute({ stack: stack(frame('comp/customScrollbar.js')), eventWindow: studioTool });
assert.strictEqual(p.key, 'launch:studio', 'a tool window belongs to its parent program');
assert.strictEqual(p.window, studio);

p = PF.attribute({ stack: stack(frame('comp/customScrollbar.js')), eventWindow: lumen });
assert.strictEqual(p.key, 'window:imageViewerModal_3', 'a window without a launcher is its own program');
assert.strictEqual(p.name, 'Lumen - cat.png');

p = PF.attribute({ stack: '', filename: ORIGIN + '/scripts/comp/desktopShortcuts.js', eventShell: true });
assert.strictEqual(p.core, true, 'no stack: the error event filename');
assert.strictEqual(PF.attribute({ stack: stack(frame('comp/customScrollbar.js')) }).core, true, 'shared code with no window: the desktop, never Spectator');
assert.strictEqual(PF.attribute({ stack: stack(frame('comp/workspaceUtils.js')) }).core, true, 'the workspace theme code is the shell');
assert.strictEqual(PF.attribute({ stack: 'Error\n    at x (https://evil.example/x.js:1:1)' }), null);

// a program's window the maps do not know: learned from the window its input event hit
const wmp = makeWindow('wmpShell', 'Windows Media Player');
p = PF.attribute({ stack: stack(frame('comp/desktop-apps/mediaPlayer.js')), eventWindow: wmp });
assert.strictEqual(p.key, 'launch:media-player');
assert.strictEqual(p.name, 'Media Player');
assert.strictEqual(p.window, wmp, 'the event window is the program\'s');
p = PF.attribute({ stack: stack(frame('comp/desktop-apps/mediaPlayer.js')) });
assert.strictEqual(p.window, wmp, 'and is remembered for the next fault');
assert.strictEqual(PF.programForWindow(wmp).key, 'launch:media-player');
// ... or found by a title that is the launcher's name
const director = makeWindow('directorShell', 'Director');
p = PF.attribute({ stack: stack(frame('comp/director.js')) });
assert.strictEqual(p.window, director, 'a window titled like the launcher');
director.classList.add('hidden');
assert.strictEqual(PF.attribute({ stack: stack(frame('comp/director.js')) }).window, null, 'hidden windows are not the program');
// an event in another program's window does not hand that window over
p = PF.attribute({ stack: stack(frame('comp/desktop-apps/mediaPlayer.js')), eventWindow: minesweeper });
assert.strictEqual(p.window, wmp);

// the capture listener notes the window an input event targeted (cleared by a timer after the task)
PF._noteEvent({ target: emotion.children[1].children[0] });
assert.strictEqual(PF._eventContext.window, emotion);
PF._noteEvent({ target: taskbarButton });
assert.strictEqual(PF._eventContext.window, null);
assert.strictEqual(PF._eventContext.shell, true);
runTimers(0);
assert.strictEqual(PF._eventContext.shell, false, 'cleared once the event task is over');

// ---- the dialog ------------------------------------------------------------------------------

const solitaireError = { message: 'boom', stack: stack(frame('comp/desktop-apps/vista-games/solitaire.js')) };

function dialogEl(i = 0) {
    const d = PF.openDialogs()[i];
    return d ? doc.getElementById(d.id) : null;
}
const buttons = (m) => m.querySelectorAll('button').filter((b) => b.classList.contains('program-fault-button') && !b.classList.contains('program-fault-copy'));
const press = (m, label) => {
    const b = buttons(m).find((x) => x.textContent === label);
    assert.ok(b, `a ${label} button (have ${buttons(m).map((x) => x.textContent)})`);
    b.click();
};
const copyButton = (m) => m.querySelector('.program-fault-copy');
// the store's file IO is real: wait in real time, not only for queued promise jobs
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => realSetTimeout(r, 5)); };
/** The throttled report update (REPORT_MIN_GAP_MS after the last post), not the dialog's own timers */
const runReportUpdate = () => runTimers(10000, 3000);

const text = (m) => m.querySelector('.program-fault-text').textContent;
const heading = (m) => m.querySelector('.program-fault-heading').textContent;
const othersOpen = () => !minesweeper.classList.contains('hidden') && !emotion.classList.contains('hidden') && !studio.classList.contains('hidden');

(async () => {
    calls.length = 0;
    assert.strictEqual(PF.present(solitaireError, {}), true, 'a Solitaire fault takes the dialog');
    assert.strictEqual(PF.openDialogs().length, 1);
    let m = dialogEl();
    assert.ok(m.classList.contains('program-fault-dialog') && !m.classList.contains('hidden'));
    assert.strictEqual(m.querySelector('.modal-window-title-main span').textContent, 'Melaton');
    assert.strictEqual(heading(m), 'Solitaire has stopped working');
    assert.strictEqual(m.dataset.faultPage, 'checking');
    assert.strictEqual(text(m), 'Melaton is checking for a solution to the problem...');
    assert.strictEqual(m.querySelector('.program-fault-progress').hidden, false);
    assert.deepStrictEqual(buttons(m).map((b) => b.textContent), ['Continue', 'Cancel']);
    assert.strictEqual(m.querySelector('.program-fault-footer').children[0], copyButton(m), 'Copy Report leads the footer (floated left)');
    assert.strictEqual(copyButton(m).textContent, 'Copy Report');
    const caption = m.querySelector('.modal-window-controls').children;
    assert.deepStrictEqual(caption.map((b) => [b.title, b.disabled]), [['Minimize', false], ['Maximize', true], ['Close', false]],
        'the caption buttons of the reference capture: minimize, maximize greyed, close');

    // repeats while it is up: counted, no second dialog
    PF.present(solitaireError, {});
    PF.present(solitaireError, {});
    assert.strictEqual(PF.openDialogs().length, 1, 'repeated faults do not stack dialogs');
    assert.strictEqual(PF.openDialogs()[0].repeats, 3);

    // a program with a launcher restarts, as Vista restarts Explorer: "<program> is restarting..."
    runTimers();
    assert.strictEqual(m.dataset.faultPage, 'restarting');
    assert.strictEqual(heading(m), 'Solitaire is restarting...');
    assert.strictEqual(text(m), '');
    assert.strictEqual(m.querySelector('.program-fault-progress').hidden, false);
    assert.deepStrictEqual(buttons(m).map((b) => b.textContent), ['Cancel']);
    await flush();
    assert.deepStrictEqual(calls.filter((c) => c[1] !== m.id), [['VistaGames.closeWindow', 'vistaSolitaireModal']],
        'Solitaire is closed through the game\'s own close (no save prompt), and nothing else');
    assert.ok(othersOpen(), 'the other programs stay open');
    runTimers();
    await flush(); await flush(); await flush();
    assert.deepStrictEqual(calls.filter((c) => c[1] !== m.id), [['VistaGames.closeWindow', 'vistaSolitaireModal'], ['openVistaGame', 'solitaire']],
        'then it is launched again');
    assert.strictEqual(PF.openDialogs().length, 0);
    assert.ok(!m.isConnected, 'the dialog leaves the DOM');
    solitaire.classList.remove('hidden');

    // a second crash within a minute: no second restart (Vista's 60 s rule), the Close program page
    calls.length = 0;
    PF.present(solitaireError, {});
    m = dialogEl();
    runTimers();
    assert.strictEqual(m.dataset.faultPage, 'final');
    assert.strictEqual(heading(m), 'Solitaire has stopped working');
    assert.strictEqual(m.querySelector('.program-fault-progress').hidden, true);
    assert.strictEqual(text(m), 'A problem caused the program to stop working correctly. Melaton will close the program and notify you if a solution is available.');
    assert.deepStrictEqual(buttons(m).map((b) => b.textContent), ['Continue', 'Close program']);
    assert.strictEqual(buttons(m)[1].dataset.dialogPrimary, '1', 'Close program is the default button');
    assert.ok(!buttons(m)[0].dataset.dialogPrimary);
    press(m, 'Close program');
    await flush();
    assert.deepStrictEqual(calls.filter((c) => c[1] !== m.id), [['VistaGames.closeWindow', 'vistaSolitaireModal']], 'Close program closes only Solitaire');
    assert.ok(solitaire.classList.contains('hidden') && othersOpen());

    // its leftover timers firing right after it was closed do not bring the dialog back
    assert.strictEqual(PF.present(solitaireError, {}), true);
    assert.strictEqual(PF.openDialogs().length, 0, 'a closed program stays closed for a moment');

    // Cancel: on the checking page it moves on; on the restarting page the program stays closed
    calls.length = 0;
    launchActions.length = 0;
    PF.present({ message: 'x', stack: stack(frame('comp/desktop-apps/emotion.js')) }, {});
    m = dialogEl();
    assert.strictEqual(heading(m), 'eMotion has stopped working');
    press(m, 'Cancel');
    assert.strictEqual(m.dataset.faultPage, 'restarting', 'Cancel skips the check');
    assert.strictEqual(heading(m), 'eMotion is restarting...');
    assert.deepStrictEqual(buttons(m).map((b) => b.textContent), ['Cancel'], 'restarting: the program is already closed, nothing to continue');
    press(m, 'Cancel');
    runTimers();
    await flush(); await flush();
    assert.ok(calls.some((c) => c[0] === 'closeModal' && c[1] === 'emotionModal'), 'the eMotion was closed');
    assert.deepStrictEqual(launchActions, [], 'and Cancel kept it from coming back');
    assert.strictEqual(PF.openDialogs().length, 0);
    assert.ok(!minesweeper.classList.contains('hidden') && !studio.classList.contains('hidden'));

    // a Start menu program restarts through its launcher
    emotion.classList.remove('hidden');
    PF.reset();
    PF.present({ message: 'x', stack: stack(frame('comp/director.js')) }, {});
    m = dialogEl();
    runTimers();
    runTimers();
    await flush(); await flush(); await flush();
    assert.deepStrictEqual(launchActions, ['director'], 'Director is launched again');

    // shared code with no window: the desktop's dialog, not Spectator
    PF.present({ message: 'x', stack: stack(frame('comp/customScrollbar.js')) }, {});
    assert.strictEqual(PF.openDialogs().length, 1, 'no frames of a program and no event: still the desktop, never Spectator');
    assert.strictEqual(heading(dialogEl()), 'Melaton Desktop has stopped working');
    PF.reset();
    // nothing of ours at all stays with Spectator
    assert.strictEqual(PF.present({ message: 'x', stack: 'Error\n    at x (https://evil.example/x.js:1:1)' }, {}), false);
    assert.strictEqual(PF.openDialogs().length, 0);

    // before the desktop is up (boot): the dialog shows on its own, above the boot layers
    win.getClientDesktopState = () => 'booting';
    calls.length = 0;
    assert.strictEqual(PF.present({ message: 'bust is not defined', stack: stack(frame('comp/workspaceUtils.js')) }, {}), true);
    m = dialogEl();
    assert.ok(m.classList.contains('program-fault-standalone'), 'standalone while booting');
    assert.ok(!m.classList.contains('hidden'));
    assert.ok(!calls.some((c) => c[0] === 'openModal'), 'the window manager is not asked while booting');
    assert.strictEqual(heading(m), 'Melaton Desktop has stopped working');
    PF.reset();
    win.getClientDesktopState = () => 'desktop';

    // a window with no launcher: the Close program page, the reference dialog
    PF._noteEvent({ target: lumen.children[1] });
    PF.present({ message: 'x', stack: stack(frame('comp/customScrollbar.js')) }, {});
    m = dialogEl();
    runTimers();
    assert.strictEqual(heading(m), 'Lumen - cat.png has stopped working');
    assert.strictEqual(m.dataset.faultPage, 'final');
    assert.deepStrictEqual(buttons(m).map((b) => b.textContent), ['Continue', 'Close program']);
    calls.length = 0;
    press(m, 'Close program');
    await flush();
    assert.ok(calls.some((c) => c[0] === 'closeModal' && c[1] === 'imageViewerModal_3'));
    assert.ok(!studio.classList.contains('hidden') && !minesweeper.classList.contains('hidden'));

    // the shell: the client ("OS") restart is offered, through the Start menu's restart path
    calls.length = 0;
    PF.present({ message: 'x', stack: stack(frame('comp/modalUtils.js')) }, {});
    m = dialogEl();
    runTimers();
    assert.strictEqual(heading(m), 'Melaton Desktop has stopped working');
    assert.strictEqual(m.dataset.faultPage, 'final', 'the desktop does not restart by itself');
    assert.deepStrictEqual(buttons(m).map((b) => b.textContent), ['Restart now', 'Restart later']);
    press(m, 'Restart later');
    await flush();
    assert.deepStrictEqual(calls.filter((c) => c[0] === 'runWinlogonPower'), [], 'Restart later restarts nothing');
    PF.present({ message: 'x', stack: stack(frame('comp/modalUtils.js')) }, {});
    assert.strictEqual(PF.openDialogs().length, 0, 'after Restart later the same shell fault is only counted');
    assert.deepStrictEqual(PF.continuedPrograms(), ['core']);
    PF.reset();
    PF.present({ message: 'x', stack: stack(frame('comp/modalUtils.js')) }, {});
    m = dialogEl();
    runTimers();
    press(m, 'Restart now');
    await flush();
    assert.deepStrictEqual(calls.filter((c) => c[0] === 'runWinlogonPower'), [['runWinlogonPower', 'restart']]);
    assert.strictEqual(win.__dreamscapeFatalNavBypass, true);
    assert.ok(!calls.some((c) => (c[0] === 'closeModal' || c[0] === 'VistaGames.closeWindow') && !String(c[1]).startsWith('programFaultDialog')),
        'no program window closed for a shell fault');

    // a shell fault that broke the window manager: the dialog still shows, on its own
    PF.reset();
    const openModal = win.openModal;
    win.openModal = () => { throw new TypeError("Cannot read properties of undefined (reading 'contains')"); };
    PF.present({ message: 'x', stack: stack(frame('comp/modalUtils.js')) }, {});
    m = dialogEl();
    assert.ok(!m.classList.contains('hidden') && m.classList.contains('program-fault-standalone'), 'shown without openModal');
    win.openModal = openModal;
    // ... and a restart that stalls falls back to /launch
    runTimers();
    calls.length = 0;
    win.runWinlogonPower = (action) => { calls.push(['runWinlogonPower', action]); return new Promise(() => {}); };
    press(m, 'Restart now');
    await flush();
    assert.deepStrictEqual(calls.filter((c) => /^r/.test(c[0])), [['runWinlogonPower', 'restart']]);
    runTimers();
    assert.deepStrictEqual(calls.filter((c) => c[0] === 'restartClientNavigate'), [['restartClientNavigate']], 'stalled: navigate');
    assert.ok(!m.isConnected, 'the standalone dialog is removed without closeModal');

    // swallowed WebSocket handler errors: programs only, a shell handler stays a console line
    PF.reset();
    assert.strictEqual(PF.report(Object.assign(new Error('ws'), { stack: stack(frame('appWebSocketHandlers.js')) }), { source: 'ws:x' }), false);
    assert.strictEqual(PF.report(Object.assign(new Error('ws'), { stack: stack(frame('comp/director.js')) }), { source: 'ws:x' }), true);
    assert.strictEqual(PF.openDialogs()[0].name, 'Director');

    // at most three dialogs; the rest wait their turn
    PF.reset();
    const plain = [1, 2, 3, 4].map((n) => makeWindow('plainWindow' + n, 'Plain ' + n));
    plain.forEach((w) => { PF._noteEvent({ target: w }); PF.present({ message: 'x', stack: '' }, {}); });
    assert.strictEqual(PF.openDialogs().length, 3);
    assert.deepStrictEqual(PF.queued(), ['window:plainWindow4']);
    runTimers();
    press(dialogEl(0), 'Close program');
    await flush(); await flush();
    assert.strictEqual(PF.openDialogs().length, 3, 'the waiting dialog opens when one closes');
    assert.deepStrictEqual(PF.queued(), []);
    assert.ok(plain[0].classList.contains('hidden') && !plain[1].classList.contains('hidden'));

    // ---- reports: the server store ----------------------------------------------------------

    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-store-'));
        const st = createStore({ dir });
        const base = { program: { key: 'launch:emotion', name: 'eMotion' }, errorName: 'TypeError', message: "Cannot read properties of undefined (reading 'x')", stack: 'TypeError: boom\n    at onKey (http://h/scripts/comp/desktop-apps/emotion.js?sha=1:10:20)' };
        const a = await st.upsert({ ...base, occurrenceId: 'o1', repeats: 1 });
        assert.match(a.id, /^fault_[0-9a-f]{12}$/);
        assert.ok(fs.existsSync(path.join(dir, a.id + '.json')), 'one JSON file per fault');
        let r = await st.upsert({ ...base, occurrenceId: 'o1', repeats: 4, action: 'continue' });
        assert.strictEqual(r.count, 1, 'the same dialog posted again updates its occurrence');
        assert.strictEqual(r.repeats, 4);
        assert.strictEqual((await st.read(a.id)).recent[0].action, 'continue');
        r = await st.upsert({ ...base, occurrenceId: 'o2', message: "Cannot read properties of undefined (reading 'y')", stack: base.stack.replace(':10:20', ':99:1') });
        assert.strictEqual(r.id, a.id, 'quoted values and line numbers do not split one bug');
        assert.strictEqual(r.count, 2);
        assert.strictEqual(r.repeats, 5);
        assert.strictEqual((await st.read(a.id)).latest.occurrenceId, 'o2');
        assert.notStrictEqual((await st.upsert({ ...base, occurrenceId: 'o3', message: 'other' })).id, a.id, 'another message is another fault');
        assert.notStrictEqual(faultId({ ...base, program: { key: 'game:solitaire' } }), a.id, 'another program is another fault');
        const saved = await st.read(a.id);
        saved.status = 'fixed';
        fs.writeFileSync(path.join(dir, a.id + '.json'), JSON.stringify(saved));
        await st.upsert({ ...base, occurrenceId: 'o4' });
        assert.strictEqual((await st.read(a.id)).status, 'regressed', 'a fixed fault that comes back is reopened');
        assert.strictEqual(await st.read('../../etc/passwd'), null, 'ids are checked');
        await assert.rejects(st.upsert({ message: 'x' }), /program is required/);
        assert.strictEqual((await st.list()).length, 2);
        // posts to one report at once: each lands, none is lost
        const many = await Promise.all([5, 6, 7, 8].map((n) => st.upsert({ ...base, occurrenceId: 'p' + n })));
        assert.strictEqual(Math.max(...many.map((x) => x.count)), 7, 'concurrent posts are applied one after another');
        assert.strictEqual((await st.read(a.id)).count, 7);
        assert.ok(fs.statSync(path.join(dir, a.id + '.json')).size < 40000, 'ten occurrences stay small');
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // pruning: at most maxReports files, none older than maxAgeMs
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-prune-'));
        let t = Date.parse('2026-10-01T00:00:00Z');
        const st = createStore({ dir, maxReports: 3, maxAgeMs: 10 * 24 * 3600 * 1000, now: () => t });
        const ids = [];
        for (let i = 0; i < 5; i++) {
            t += 3600 * 1000;
            ids.push((await st.upsert({ program: { key: 'p', name: 'P' }, message: 'fault ' + 'abcde'[i] })).id);
        }
        assert.strictEqual(st.size(), 3, 'the oldest reports go once there are too many');
        assert.deepStrictEqual(fs.readdirSync(dir).sort(), ids.slice(2).map((id) => id + '.json').sort());
        assert.strictEqual(await st.read(ids[0]), null);
        t += 11 * 24 * 3600 * 1000;
        assert.strictEqual(await st.prune(), 3, 'reports not seen for maxAgeMs go');
        assert.deepStrictEqual(fs.readdirSync(dir), []);
        // a new process reads the index from disk and prunes it on the way
        for (let i = 0; i < 4; i++) {
            t += 1000;
            await st.upsert({ program: { key: 'p', name: 'P' }, message: 'again ' + 'abcd'[i] });
        }
        const fresh = createStore({ dir, maxReports: 2, now: () => t });
        assert.strictEqual((await fresh.list()).length, 2);
        assert.strictEqual(fs.readdirSync(dir).length, 2);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // the routes: read-only sessions, size and rate limits
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-routes-'));
        const routes = {};
        const fakeApp = { post: (p, auth, fn) => { routes['POST ' + p] = fn; }, get: (p, auth, fn) => { routes['GET ' + p] = fn; } };
        let t = 0;
        mountProgramFaultReports(fakeApp, null, { dir, allow: createRateLimiter({ max: 2, windowMs: 1000, now: () => t }) });
        const call = async (key, req) => {
            const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
            await routes[key]({ headers: {}, query: {}, params: {}, sessionID: 'sess1', ...req }, res);
            return res;
        };
        const body = { program: { key: 'p', name: 'P' }, message: 'm' };
        assert.strictEqual((await call('POST /api/fault-reports', { body, userType: 'readonly' })).code, 403, 'read-only sessions save nothing');
        assert.strictEqual((await call('POST /api/fault-reports', { body, headers: { 'content-length': String(MAX_BODY_BYTES + 1) } })).code, 413);
        assert.strictEqual((await call('POST /api/fault-reports', { body: { ...body, stack: 'x'.repeat(MAX_BODY_BYTES) } })).code, 413, 'measured when no length was sent');
        const ok = await call('POST /api/fault-reports', { body, userType: 'admin' });
        assert.strictEqual(ok.code, 200);
        assert.strictEqual((await call('POST /api/fault-reports', { body })).code, 200);
        const limited = await call('POST /api/fault-reports', { body });
        assert.strictEqual(limited.code, 429, 'a session posting too often is told to wait');
        assert.strictEqual(limited.headers['Retry-After'], '60');
        assert.strictEqual((await call('POST /api/fault-reports', { body, sessionID: 'sess2' })).code, 200, 'other sessions are not held up');
        t += 1001;
        assert.strictEqual((await call('POST /api/fault-reports', { body })).code, 200, 'the window slides');
        assert.strictEqual((await call('GET /api/fault-reports/:id', { params: { id: ok.body.id } })).body.report.count, 4, 'every accepted post without an occurrence id is a dialog');
        assert.strictEqual((await call('GET /api/fault-reports/:id', { params: { id: 'fault_000000000000' } })).code, 404);
        assert.strictEqual((await call('GET /api/fault-reports', {})).body.reports.length, 1);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // ---- reports: uploads and Copy Report ---------------------------------------------------

    PF.reset();
    emotion.classList.remove('hidden');
    net.posts = 0;
    const calcError = { message: "Cannot read properties of undefined (reading 'value')", stack: "TypeError: Cannot read properties of undefined (reading 'value')\n" + frame('comp/desktop-apps/emotion.js', 'onKey'), timestamp: '2026-10-21T10:00:00.000Z' };
    PF.present(calcError, {});
    m = dialogEl();
    await settle();
    let rep = PF.openDialogs()[0].report;
    assert.strictEqual(rep.status, 'saved', 'the dialog\'s fault is upserted as it opens');
    assert.strictEqual(net.posts, 1);
    let onServer = await store.read(rep.id);
    assert.strictEqual(onServer.program.name, 'eMotion');
    assert.strictEqual(onServer.errorName, 'TypeError');
    assert.match(onServer.latest.stack, /emotion\.js/);
    assert.deepStrictEqual(onServer.latest.scripts, ['/scripts/comp/desktop-apps/emotion.js']);
    assert.ok(onServer.latest.client.windows.some((w) => /eMotion/.test(w)), 'the open windows go with it');
    PF.present(calcError, {});
    PF.present(calcError, {});
    runReportUpdate();
    await settle();
    assert.strictEqual(net.posts, 2, 'repeats are posted once, debounced');
    assert.strictEqual((await store.read(rep.id)).count, 1);
    assert.strictEqual((await store.read(rep.id)).repeats, 3);

    copyButton(m).click();
    await settle(10);
    assert.match(net.clipboard, new RegExp(`^Dreamscape fault report ${rep.id} \\(saved on the server\\)\\n`));
    assert.match(net.clipboard, /eMotion has stopped working/);
    assert.match(net.clipboard, /Error: TypeError: Cannot read properties of undefined \(reading 'value'\)/);
    assert.match(net.clipboard, /Seen: 1 dialog\(s\), 3 fault\(s\)/);
    assert.match(net.clipboard, new RegExp(`data/fault-reports/${rep.id}\\.json`));
    assert.match(net.clipboard, /\nIn: \/scripts\/comp\/desktop-apps\/emotion\.js:10:20\n/, 'where it threw, without the build query');
    assert.ok(!/Stack:/.test(net.clipboard), 'confirmed: the id is enough, no stack');
    if (process.env.SHOW_COPY) console.log("--- confirmed\n" + net.clipboard);
    assert.strictEqual(copyButton(m).textContent, 'Copied');
    runTimers(1600);
    assert.strictEqual(copyButton(m).textContent, 'Copy Report');

    // the server answers, but has no such report: the full error goes on the clipboard
    fs.rmSync(store.fileFor(rep.id));
    copyButton(m).click();
    await settle(10);
    assert.match(net.clipboard, /^Dreamscape fault report \(not saved on the server: check failed: the server has no such report; the full error is below\)/);
    assert.match(net.clipboard, /Stack:\nTypeError: Cannot read properties of undefined \(reading 'value'\)\n {4}at onKey/);
    assert.match(net.clipboard, /Faults counted into this dialog: 3/);
    assert.match(net.clipboard, /Time: 2026-10-21 10:00:00Z/);
    runTimers(1600);
    // the server is unreachable
    net.getStatus = 503;
    copyButton(m).click();
    await settle(10);
    assert.match(net.clipboard, /not saved on the server: check failed: down/);
    net.getStatus = 0;
    runTimers(1600);

    // ---- Continue ---------------------------------------------------------------------------

    calls.length = 0;
    press(m, 'Continue');
    await settle();
    assert.strictEqual(PF.openDialogs().length, 0, 'Continue closes the dialog');
    assert.ok(!emotion.classList.contains('hidden'), 'and leaves the program running');
    assert.ok(!calls.some((c) => c[1] === 'emotionModal'), 'nothing is done to the eMotion');
    assert.strictEqual((await store.read(rep.id)).recent[0].action, 'continue', 'the report says how the dialog ended');
    PF.present(calcError, {});
    assert.strictEqual(PF.openDialogs().length, 0, 'the same fault again is only counted');
    runReportUpdate();
    await settle();
    assert.strictEqual((await store.read(rep.id)).repeats, 4, '... and the count still reaches the server');
    PF.present({ message: 'a different fault', stack: frame('comp/desktop-apps/emotion.js') }, {});
    assert.strictEqual(PF.openDialogs().length, 1, 'a different fault shows again');
    runTimers();
    m = dialogEl();
    press(m, 'Continue');
    await settle();
    emotion.classList.add('hidden');
    PF.present(calcError, {});
    assert.strictEqual(PF.openDialogs().length, 1, 'once its window closed, a new run\'s fault shows again');
    emotion.classList.remove('hidden');

    // the upload fails: the dialog still works, Copy Report carries the full error
    PF.reset();
    net.postFails = true;
    PF._noteEvent({ target: lumen.children[1] });
    PF.present({ message: 'decode failed', stack: 'Error: decode failed\n' + frame('comp/customScrollbar.js', 'paint') }, {});
    m = dialogEl();
    await settle();
    assert.strictEqual(PF.openDialogs()[0].report.status, 'failed');
    copyButton(m).click();
    await settle(10);
    assert.match(net.clipboard, /^Dreamscape fault report \(not saved on the server: Failed to fetch; the full error is below\)/);
    assert.match(net.clipboard, /Lumen - cat\.png has stopped working/);
    assert.match(net.clipboard, /\nError: decode failed\n/);
    assert.match(net.clipboard, /Window: Lumen - cat\.png \(#imageViewerModal_3\)/);
    assert.match(net.clipboard, /at paint \(/);
    if (process.env.SHOW_COPY) console.log("--- not saved\n" + net.clipboard);
    net.postFails = false;
    runTimers(1600);
    PF.reset();
    fs.rmSync(reportDir, { recursive: true, force: true });

    // not on the desktop (boot, logon): the dialog still takes it, on its own
    PF.reset();
    win.getClientDesktopState = () => 'booting';
    assert.strictEqual(PF.present(solitaireError, {}), true);
    assert.ok(dialogEl().classList.contains('program-fault-standalone'));
    PF.reset();
    win.getClientDesktopState = () => 'desktop';

    // a fault in the fault dialog's own code never loops back into it
    assert.strictEqual(PF.present({ message: 'x', stack: stack(frame('comp/programFaults.js'), frame('comp/desktop-apps/emotion.js')) }, {}), false);

    console.error = consoleError;
    console.log('test-program-faults: ok');
})().catch((err) => {
    console.error = consoleError;
    console.error(err);
    process.exit(1);
});
