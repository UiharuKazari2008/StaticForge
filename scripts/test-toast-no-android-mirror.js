#!/usr/bin/env node
// Dreamscape's notices show only in Dreamscape's own UI (#1321): with an old app in the page (AndroidNotification
// there and isReady() TRUE) no toast, on the desktop / DeX or the phone, calls anything on it, and every one is drawn
// by the page; the app's 'melaton:download' events become the page's own notices.
// Run: node scripts/test-toast-no-android-mirror.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SOURCE = read('public/scripts/comp/toastManager.js');

// ---- a small DOM: enough for the toast markup toastManager.js writes -------------------------------------------
function element(tagName) {
    const el = {
        tagName, id: '', className: '', style: {}, dataset: {}, attrs: {}, children: [], parentNode: null, textContent: '', _html: '',
        setAttribute(k, v) { el.attrs[k] = String(v); },
        getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
        hasAttribute(k) { return k in el.attrs; },
        removeAttribute(k) { delete el.attrs[k]; if (k === 'src') el.src = ''; },
        appendChild(c) { return el.insertBefore(c, null); },
        prepend(c) { return el.insertBefore(c, el.children[0] || null); },
        insertBefore(c, before) {
            if (c.parentNode) c.parentNode.removeChild(c);
            const at = before ? el.children.indexOf(before) : -1;
            if (at < 0) el.children.push(c); else el.children.splice(at, 0, c);
            c.parentNode = el;
            return c;
        },
        removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
        remove() { if (el.parentNode) el.parentNode.removeChild(el); },
        insertAdjacentHTML(_where, html) { parse(html).forEach((c) => el.appendChild(c)); },
        get innerHTML() { return el._html; },
        set innerHTML(html) { el._html = html; el.children = []; parse(html).forEach((c) => el.appendChild(c)); },
        get parentElement() { return el.parentNode; },
        classList: {
            contains: (c) => el.className.split(/\s+/).includes(c),
            add: (c) => { if (!el.classList.contains(c)) el.className = `${el.className} ${c}`.trim(); },
            remove: (c) => { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' '); }
        },
        all() { return el.children.flatMap((c) => [c, ...c.all()]); },
        querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
        querySelectorAll(sel) { const cls = sel.replace(/^\./, ''); return el.all().filter((c) => c.classList.contains(cls)); }
    };
    return el;
}
// the elements with a class in a toast's own markup, nested as written
function parse(html) {
    const root = { children: [] };
    const stack = [root];
    const re = /<(\/?)(div|button|span|img)\b([^>]*)>/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
        const el = element(m[2]);
        el.className = (/class="([^"]*)"/.exec(m[3]) || [])[1] || '';
        const rest = html.slice(re.lastIndex);
        el._html = rest.slice(0, rest.indexOf(`</${m[2]}>`));
        const top = stack[stack.length - 1];
        top.children.push(el);
        if (top !== root) el.parentNode = top;
        if (m[2] !== 'img') stack.push(el);
    }
    return root.children;
}

// ---- one page with an old app in it --------------------------------------------------------------------------------
function page({ phone = false, desktop = false, openDownload, noApp = false } = {}) {
    const bridgeCalls = [];
    // every method an old DSApp NotificationBridge offered; a call to any of them (or onAction wiring) is recorded
    const bridge = { isReady: () => { bridgeCalls.push('isReady'); return true; } };
    for (const name of ['showNotification', 'updateNotification', 'updateNotificationProgress', 'updateNotificationMessage',
        'updateNotificationReasoning', 'updateNotificationImagePreview', 'updateNotificationActions', 'completeNotification',
        'dismissNotification']) {
        bridge[name] = (...args) => { bridgeCalls.push(name); return args; };
    }
    if (openDownload) bridge.openDownload = openDownload;
    const watched = new Proxy(bridge, { set(t, k, v) { bridgeCalls.push(`set ${String(k)}`); t[k] = v; return true; } });

    const body = element('body');
    if (desktop) body.className = 'desktop-mode';
    const listeners = {};
    const dialogs = [];
    const notes = [];
    const timers = [];
    const window = {
        AndroidNotification: noApp ? undefined : watched,
        isDesktop: desktop,
        uiShell: phone ? 'mobile' : undefined,
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }
    };
    const document = {
        body,
        documentElement: element('html'),
        getElementById: (id) => body.all().find((e) => e.id === id) || null,
        createElement: (tag) => element(tag),
        querySelector: () => null
    };
    if (phone) {
        window.wmShell = {
            appNote(opts) {
                // as wmShell.appNote: a toast of its own, kept and closed by the caller
                const id = ctx.showGlassToast('info', opts.title, opts.html || '&nbsp;', false, false);
                if (!document.getElementById(id)) return null;
                const note = { id, opts, closed: false, close() { note.closed = true; ctx.removeGlassToast(id); } };
                notes.push(note);
                return note;
            }
        };
    }
    const ctx = {
        console: { log() {}, warn() {}, error: console.error },
        Promise,
        AbortController,
        window,
        document,
        localStorage: { getItem: () => null, setItem() {} },
        // timers run only when the test says so
        setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
        clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].live = false; },
        setInterval: () => 0,
        clearInterval() {},
        requestAnimationFrame: (cb) => cb(),
        desktopSounds: { play() { throw new Error('a toast played a sound'); }, playBalloon() { throw new Error('a toast played a sound'); } },
        showConfirmationDialog: (html, buttons, _x, options) => { dialogs.push({ html, buttons, options }); return new Promise(() => {}); },
        MutationObserver: class { observe() {} disconnect() {} }
    };
    vm.createContext(ctx);
    vm.runInContext(SOURCE, ctx);
    const toasts = () => {
        const box = document.getElementById('toastContainer');
        return box ? box.children.filter((c) => !c.classList.contains('removing')) : [];
    };
    return {
        ctx, listeners, dialogs, notes, bridgeCalls, toasts, document,
        run: (code) => vm.runInContext(code, ctx),
        flush: () => { for (const t of timers.splice(0)) if (t.live) t.fn(); },
        download: (detail) => { for (const fn of listeners['melaton:download'] || []) fn({ detail }); }
    };
}
const buttonsOf = (toast) => (toast.querySelector('.toast-buttons') || { children: [] }).children;
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
    // ---- the source itself: nothing of the mirror left ----------------------------------------------------------
    assert.ok(!/showNotification|updateNotification|completeNotification|dismissNotification|nativeRouted|inAppOnly|isReady|onAction|NotificationBridge/.test(SOURCE),
        'no bridge routing left in toastManager.js');
    for (const f of ['public/scripts/appInitSteps.js', 'public/scripts/comp/modalUtils.js', 'public/scripts/comp/taskbarProperties.js']) {
        assert.ok(!/NotificationBridge|bridgeEnabled|bridgeBypass|bridge-on|bridge-bypass/i.test(read(f)), `${f}: no bridge setting or call left`);
    }

    // ---- every branch that returned early for a "native only" toast now draws, DeX (desktop) and phone ------------
    for (const mode of [{ desktop: true }, { phone: true }, {}]) {
        const label = mode.desktop ? 'DeX / desktop' : mode.phone ? 'phone' : 'page';
        const p = page(mode);
        // a progress toast (no Vista dialog or phone progress box in this page): drawn, with its bar
        const id = p.run(`showGlassToast('info', 'Connecting', 'Starting', true, false)`);
        const el = p.toasts()[0];
        assert.ok(el && el.id === id, `${label}: the progress toast is in the page`);
        assert.ok(el.querySelector('.toast-progress-bar'), `${label}: with its bar`);
        p.ctx.id = id;
        p.run(`updateGlassToastProgress(id, 40)`);
        assert.strictEqual(el.querySelector('.toast-progress-bar').style.width, '40%', `${label}: progress`);
        p.run(`updateGlassToastMessage(id, 'Halfway')`);
        assert.strictEqual(el.querySelector('.toast-message').textContent, 'Halfway', `${label}: message`);
        p.run(`updateGlassToast(id, 'info', 'Connecting', 'Still going')`);
        assert.strictEqual(el.querySelector('.toast-message').textContent, 'Still going', `${label}: update`);
        p.run(`updateGlassToastReasoning(id, 'thinking')`);
        assert.strictEqual(el.querySelector('.toast-reasoning').textContent, 'thinking', `${label}: reasoning`);
        p.run(`updateGlassToastImagePreview(id, '/previews/a.jpg')`);
        assert.strictEqual(el.querySelector('.toast-image-preview').src, '/previews/a.jpg', `${label}: preview`);
        const content = el.querySelector('.toast-content');
        assert.ok(content.children.indexOf(el.querySelector('.toast-image-preview')) < content.children.indexOf(el.querySelector('.toast-progress')),
            `${label}: the preview sits above the bar`);
        p.run(`clearGlassToastImagePreview(id)`);
        assert.strictEqual(el.querySelector('.toast-image-preview'), null, `${label}: preview cleared`);
        // buttons added to a running toast
        let stopped = 0;
        p.ctx.onStop = () => { stopped++; };
        p.run(`updateGlassToastButtons(id, [{ text: 'Stop', onClick: onStop, closeOnClick: false }])`);
        assert.deepStrictEqual(buttonsOf(el).map((b) => b.textContent), ['Stop'], `${label}: buttons`);
        p.ctx.handleToastButtonClick(buttonsOf(el)[0].attrs['data-button-id']);
        assert.strictEqual(stopped, 1, `${label}: the page's button runs`);
        p.run(`updateGlassToastButtons(id, null)`);
        assert.strictEqual(el.querySelector('.toast-buttons'), null, `${label}: buttons removed`);
        // completion: the bar goes, the close button comes, the final buttons are there
        p.run(`updateGlassToastComplete(id, { type: 'info', title: 'Connected', message: 'Done', showProgress: false, buttons: [{ text: 'View', onClick: onStop }] })`);
        assert.strictEqual(el.querySelector('.toast-progress'), null, `${label}: bar removed on completion`);
        assert.ok(el.querySelector('.toast-close'), `${label}: close button on completion`);
        assert.strictEqual(el.querySelector('.toast-message').textContent, 'Done', `${label}: final message`);
        assert.deepStrictEqual(buttonsOf(el).map((b) => b.textContent), ['View'], `${label}: final buttons`);
        // dismissal at once (the bridge path used to defer it 400 ms)
        p.run(`removeGlassToast(id)`);
        assert.ok(el.classList.contains('removing'), `${label}: dismissed at once`);
        p.flush();
        assert.strictEqual(p.toasts().length, 0, `${label}: gone`);
        // the titles that were always in the page, and a plain note: the same result as in a page with no app at all
        const shown = async (target) => {
            const drawn = [];
            for (const [type, title] of [['info', 'Disconnected'], ['warning', 'Read-Only Mode'], ['error', 'Critical Error'], ['info', 'A note']]) {
                const id = target.run(`showGlassToast(${JSON.stringify(type)}, ${JSON.stringify(title)}, 'Text', false, 5000)`);
                if (target.toasts().some((x) => x.id === id)) drawn.push(title);
                // the message boxes wait their turn on timers
                for (let i = 0; i < 4; i++) { await tick(); target.flush(); }
            }
            return { drawn, boxes: target.dialogs.map((x) => x.options.title) };
        };
        const withApp = await shown(p);
        const browser = await shown(page(Object.assign({ noApp: true }, mode)));
        assert.deepStrictEqual(withApp, browser, `${label}: as a plain browser`);
        if (mode.desktop) assert.deepStrictEqual(withApp.boxes, ['Read-Only Mode', 'Critical Error'], 'desktop: each is a Vista message box');
        if (!mode.desktop) assert.strictEqual(withApp.drawn.length, 4, `${label}: all four drawn`);
        assert.deepStrictEqual(p.bridgeCalls, [], `${label}: nothing on the Android bridge`);
    }

    // ---- 'melaton:download' ----------------------------------------------------------------------------------------
    // the desktop / DeX
    const opened = [];
    let openAnswer = true;
    const d = page({ desktop: true, openDownload: (n) => { opened.push(n); return openAnswer; } });
    assert.strictEqual((d.listeners['melaton:download'] || []).length, 1, 'one listener');

    d.download({ state: 'saved', id: 7, name: '<img src=x onerror=1>&.png', message: '' });
    assert.strictEqual(d.toasts().length, 1, 'saved: one toast in the page');
    assert.strictEqual(d.dialogs.length, 0, 'saved: no message box');
    let t = d.toasts()[0];
    assert.ok(t.innerHTML.includes('&lt;img src=x onerror=1&gt;&amp;.png'), 'the name is escaped');
    assert.ok(!t.innerHTML.includes('<img src=x'), 'no markup from the name');
    assert.deepStrictEqual(buttonsOf(t).map((b) => b.textContent), ['Open']);
    d.download({ state: 'saved', id: 7, name: '<img src=x onerror=1>&.png' });
    d.flush();
    assert.deepStrictEqual(opened, [], 'nothing opens by itself');

    d.download({ state: 'saved', id: 8, name: 'b.png' });
    d.download({ state: 'saved', id: 9, name: 'c.png' });
    d.download({ state: 'saved', id: 9, name: 'c.png' });
    assert.strictEqual(d.toasts().length, 1, 'a burst is one notice, the newest (a repeat adds nothing)');
    t = d.toasts()[0];
    assert.ok(t.innerHTML.includes('c.png'));
    d.ctx.handleToastButtonClick(buttonsOf(t)[0].attrs['data-button-id']);
    assert.deepStrictEqual(opened, [9], 'Open calls openDownload(id)');
    assert.strictEqual(d.toasts().length, 0, 'and the notice goes');
    assert.strictEqual(d.dialogs.length, 0, 'an opened file says nothing more');

    openAnswer = false;
    d.download({ state: 'saved', id: 10, name: 'd.png' });
    d.ctx.handleToastButtonClick(buttonsOf(d.toasts()[0])[0].attrs['data-button-id']);
    await tick();
    assert.strictEqual(d.dialogs.length, 1, 'openDownload false: the failure is said');
    assert.ok(d.dialogs[0].html.includes('Cannot open &#39;d.png&#39;.'));

    const f = page({ desktop: true });
    f.download({ state: 'failed', id: 1, name: 'a<b>.png', message: 'No space left <now>' });
    f.download({ state: 'failed', id: 1, name: 'a<b>.png', message: 'No space left <now>' });
    await tick();
    assert.strictEqual(f.dialogs.length, 1, 'failed: one error (the desktop policy: a message box)');
    assert.ok(f.dialogs[0].html.includes('a&lt;b&gt;.png: No space left &lt;now&gt;'), 'escaped');
    assert.ok(!f.dialogs[0].options.sound, 'silent on the desktop');
    assert.strictEqual(f.dialogs[0].options.title, 'Download Failed');

    const n = page({ desktop: true });
    n.download({ state: 'nofolder', id: 2, name: 'a.png', message: 'Download folder not set' });
    n.download({ state: 'something else', id: 3, name: 'a.png' });
    n.download(null);
    await tick();
    assert.strictEqual(n.toasts().length + n.dialogs.length, 0, 'nofolder: the folder picker says it');
    n.download({ state: 'saved', id: 4, name: 'e.png' });
    assert.strictEqual(n.toasts().length, 1, 'saved without openDownload is still said');
    assert.strictEqual(buttonsOf(n.toasts()[0]).length, 0, 'with no Open it cannot do');

    // the phone: the shell's silent notification
    const phoneOpened = [];
    const m = page({ phone: true, openDownload: (id) => { phoneOpened.push(id); return true; } });
    m.download({ state: 'saved', id: 11, name: 'x<y>.png' });
    assert.strictEqual(m.notes.length, 1);
    assert.strictEqual(m.notes[0].opts.silent, true, 'no sound for saved');
    assert.strictEqual(m.notes[0].opts.html, 'x&lt;y&gt;.png');
    assert.deepStrictEqual(Array.from(m.notes[0].opts.actions, (a) => a.text), ['Open']);
    m.download({ state: 'saved', id: 11, name: 'x<y>.png' });
    assert.strictEqual(m.notes.length, 1, 'the same download twice is one notice');
    m.download({ state: 'saved', id: 12, name: 'z.png' });
    assert.ok(m.notes[0].closed, 'the newer one takes its place');
    m.notes[1].opts.actions[0].action();
    assert.deepStrictEqual(phoneOpened, [12]);
    assert.ok(m.notes[1].closed);
    m.download({ state: 'failed', id: 13, name: 'z.png', message: '' });
    assert.strictEqual(m.toasts().length, 1);
    assert.ok(m.toasts()[0].innerHTML.includes('Cannot save &#39;z.png&#39;.'));
    for (const p of [d, f, n, m]) assert.deepStrictEqual(p.bridgeCalls, [], 'only openDownload is ever asked of the bridge');

    console.log('test-toast-no-android-mirror: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
