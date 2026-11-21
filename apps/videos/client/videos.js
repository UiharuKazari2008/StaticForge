/**
 * Melaton Videos on the desktop (Yozora #920). Yukimi, Nov 18 2026: "the desktop can be a larger and themed
 * version of the mobile app". The program itself is the phone's (public/scripts/comp/wmYouTube.js: feed, Kick
 * live streams through the server, Watch Later, Search, Channels, chat, and YouTube videos played in the window);
 * this file is its shell on the desktop: a window, and the handful of shell calls the program makes
 * (window.videosDesktopShell) answered with the desktop's own window, menus and message boxes. The phone's two
 * soft keys become the keys of a bar at the top of the window.
 *
 * One window. The program's page is built once and kept: closing the window stops what plays and puts the page
 * away, opening it again shows it as it was left.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const NAME = 'Melaton Videos';
    const APP_ID = 'youtube';
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let APP = null; // the program (what wmYouTube.js registers)
    let page = null; // its page, kept between windows
    let win = null; // the open window { modal, body, setTitle, close }
    let els = null;
    let anchor = null; // the element menus are opened on
    let loading = null;
    let shownTitle = ''; // a channel's or a video's name while one is open

    /** The program's menu rows ({ label, action, checked, radio, disabled, submenu }, '-') as the desktop menu's. */
    function menuConfig(items) {
        const acts = new Map();
        let n = 0;
        const conv = (list) => (list || []).filter(Boolean).map((it) => {
            if (it === '-') return { separator: true };
            const out = { text: it.label, disabled: !!it.disabled };
            if (it.checked !== undefined || it.radio !== undefined) { out.showIndicator = true; out.checked = !!(it.checked || it.radio); if (it.radio !== undefined) out.indicatorMark = 'radio'; }
            if (Array.isArray(it.submenu)) out.submenu = conv(it.submenu);
            else if (typeof it.action === 'function') { out.action = `v${++n}`; acts.set(out.action, it.action); }
            return out;
        });
        const rows = conv(items);
        return { sections: [{ type: 'list', items: rows }], onAction: (a) => { const fn = acts.get(a); if (fn) fn(); } };
    }
    function menuAt(x, y, items) {
        const cm = root.contextMenu;
        if (!cm || !anchor) return;
        cm.attachToElement(anchor, menuConfig(items));
        cm.showMenu({ clientX: Math.round(x), clientY: Math.round(y), preventDefault() {}, stopPropagation() {} }, anchor);
    }

    const ICONS = { error: 'fas fa-circle-xmark', info: 'fas fa-circle-info', question: 'fas fa-circle-question', warning: 'fas fa-triangle-exclamation' };
    function messageBox(o) {
        const buttons = (o.buttons && o.buttons.length ? o.buttons : [{ text: 'OK', value: true }]).map((b, i) => ({ text: b.text, value: b.value, className: `btn-standard${i === 0 ? ' primary' : ''}` }));
        return Promise.resolve(call('showConfirmationDialog', `<p>${esc(o.text).replace(/\n/g, '<br>')}</p>`, buttons, null, { title: NAME, icon: ICONS[o.icon] || ICONS.error, width: 440 })).catch(() => undefined);
    }

    let busyCount = 0;
    function busy(work, opts) {
        if (!work || typeof work.then !== 'function') return Promise.resolve(work);
        const o = opts || {};
        let on = false;
        const t = setTimeout(() => { on = true; busyCount++; if (els) els.root.classList.add('is-busy'); }, o.delay || 250);
        const done = () => { clearTimeout(t); if (on) { busyCount--; if (!busyCount && els) els.root.classList.remove('is-busy'); } };
        work.then(done, done);
        return work;
    }

    /** The bar's keys: Back (inside a channel or a video), then the program's two soft keys. */
    function renderBar() {
        if (!els || !APP) return;
        const keys = APP.softKeys() || {};
        // one bar (Yukimi, Nov 18 2026: "dont have 2 top bars"): the program's own header line is not drawn on the
        // desktop; what it says (the tab's name, its note) is this bar's text
        const head = page ? [page.querySelector('.yt-title'), page.querySelector('.yt-note')].map((e) => (e ? e.textContent.trim() : '')) : ['', ''];
        const text = shownTitle || head[0];
        if (els.title.textContent !== text) els.title.textContent = text;
        const note = shownTitle ? '' : head[1];
        if (els.note.textContent !== note) els.note.textContent = note;
        const back = APP.titleKind() === 'ok';
        if (els.back.hidden === back) els.back.hidden = !back;
        ['left', 'right'].forEach((side) => {
            const k = keys[side];
            const b = els[side];
            if (b.hidden === !!k) b.hidden = !k;
            if (!k) return;
            if (b.textContent !== k.label) b.textContent = k.label;
            b.disabled = !!k.disabled;
            b.classList.toggle('has-menu', typeof k.menu === 'function');
            b._key = k;
        });
    }
    function pressKey(b) {
        const k = b._key;
        if (!k || k.disabled) return;
        if (typeof k.menu === 'function') { const r = b.getBoundingClientRect(); menuAt(r.left, r.bottom + 1, k.menu()); } else if (typeof k.action === 'function') k.action();
        renderBar();
    }

    const shell = {
        desktop: true,
        registerApp(a) { APP = a; },
        registerTodayItem() {},
        refreshToday() {},
        refreshTodayItem() {},
        syncHistory() {},
        currentApp: () => (win ? APP_ID : ''),
        open(id) {
            if (id !== APP_ID || !win) return;
            // (the picture-in-picture window's expand: a minimised window comes back first)
            if (win.modal.classList.contains('minimised')) call('restoreMinimizedModal', win.modal, call('getOrCreateTaskbarItem', win.modal) || null);
            call('bringModalToFront', win.modal);
        },
        /** The player is open / its keys are showing: the bar lies over the picture and comes and goes with the keys. */
        playerChrome(open, keys) {
            if (!els) return;
            const r = els.root;
            if (r.classList.contains('is-player') !== open) r.classList.toggle('is-player', open);
            const off = open && !keys;
            if (r.classList.contains('is-keys-off') !== off) r.classList.toggle('is-keys-off', off);
        },
        setTitle(t) { shownTitle = !t || t === 'Videos' ? '' : t; if (win) win.setTitle(shownTitle ? `${shownTitle} - ${NAME}` : NAME); renderBar(); },
        refreshSoftKeys: renderBar,
        refreshTitleAction: renderBar,
        menuAt,
        messageBox,
        busy,
        art: { url: () => '', srcset: () => '' }
    };

    function addOnce(tag, attr, url) {
        return new Promise((resolve, reject) => {
            const el = doc.createElement(tag);
            if (tag === 'link') el.rel = 'stylesheet';
            el[attr] = url;
            el.onload = () => resolve();
            el.onerror = () => reject(new Error(`${url} could not be loaded`));
            doc.head.appendChild(el);
        });
    }
    /** The program's own style sheet and script: the desktop does not carry them until this window is first opened. */
    function loadProgram() {
        if (APP) return Promise.resolve();
        if (!loading) {
            root.videosDesktopShell = shell;
            const hasCss = [...doc.styleSheets].some((s) => /\/css\/wm-youtube\.css/.test(String(s.href || '')));
            // the script registers itself with the shell above as it runs (it finds window.videosDesktopShell)
            loading = Promise.all([hasCss ? null : addOnce('link', 'href', '/css/wm-youtube.css'), addOnce('script', 'src', '/scripts/comp/wmYouTube.js')])
                .then(() => { if (!APP) throw new Error('The program could not be started'); })
                .catch((e) => { loading = null; throw e; });
        }
        return loading;
    }

    async function start(app) {
        if (win) { call('bringModalToFront', win.modal); app.exit(); return; }
        const w = app.openWindow({ title: NAME, width: 1120, minWidth: 520 });
        win = w;
        const m = w.modal;
        m.classList.add('videos-window');
        // its size; in the middle of the desktop unless the user placed it before
        // 16:9 (Yukimi, Nov 18 2026): 1120 x 630, smaller in the same shape on a small screen
        const wide = Math.max(520, Math.min(1120, root.innerWidth - 40, Math.round((root.innerHeight - 80) * 16 / 9)));
        m.dataset.windowDefaultWidth = '1120';
        m.dataset.windowDefaultHeight = '630';
        m.dataset.windowMinHeight = '360';
        m.style.width = `${wide}px`;
        m.style.height = `${Math.round(wide * 9 / 16)}px`;
        root.requestAnimationFrame(() => {
            if (win !== w || m.hasAttribute('data-window-position-restored')) return;
            const r = m.getBoundingClientRect();
            call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
        });
        w.body.innerHTML = `<div class="vd-root">
            <div class="vd-bar"><button type="button" class="vd-key is-back" hidden>Back</button><span class="vd-title"></span><span class="vd-note"></span><span class="vd-gap"></span><button type="button" class="vd-key" data-side="left" hidden></button><button type="button" class="vd-key" data-side="right" hidden></button></div>
            <div class="vd-host"></div><div class="vd-anchor" aria-hidden="true"></div>
        </div>`;
        const q = (s) => w.body.querySelector(s);
        els = { root: q('.vd-root'), back: q('.is-back'), title: q('.vd-title'), note: q('.vd-note'), left: q('[data-side="left"]'), right: q('[data-side="right"]'), host: q('.vd-host') };
        anchor = q('.vd-anchor');
        const sig = { signal: app.signal };
        els.back.addEventListener('click', () => { if (APP) { APP.onTitleOk(); renderBar(); } }, sig);
        els.left.addEventListener('click', () => pressKey(els.left), sig);
        els.right.addEventListener('click', () => pressKey(els.right), sig);
        // what the program draws changes its keys (a tab, a channel, a video): the bar follows a click anywhere in it
        els.host.addEventListener('click', () => { setTimeout(renderBar, 0); }, sig);
        // Minimised with a stream playing: the Dreamscape app's native player takes it into picture-in-picture on this
        // screen, and restoring the window brings it back here (Yukimi, Nov 21 2026: "if you minimise the melaton videos
        // window it will popout the player on that display and when you reopen it it will bring the video back into
        // the window"). Without the app (a browser) a minimised window just goes on playing.
        let minHidden = false;
        const minWatch = new MutationObserver(() => {
            if (!APP || !page || !root.AndroidVideos || typeof root.AndroidVideos.popOut !== 'function') return;
            const min = m.classList.contains('minimised');
            if (min === minHidden) return;
            minHidden = min;
            try { if (min) APP.hide(); else { APP.show(); renderBar(); } } catch (e) { console.warn('[videos] minimise', e); }
        });
        minWatch.observe(m, { attributes: true, attributeFilter: ['class'] });
        app.onExit(() => {
            minWatch.disconnect();
            if (APP) { try { APP.onTitleClose(); APP.hide(); } catch (e) { console.warn('[videos] close', e); } }
            if (page) page.remove();
            win = null;
            els = null;
            anchor = null;
        });
        try {
            await busy(loadProgram(), { delay: 150 });
        } catch (e) {
            await messageBox({ icon: 'error', text: (e && e.message) || 'The program could not be started' });
            app.exit();
            return;
        }
        if (app.signal.aborted || win !== w) return;
        if (!page) {
            page = doc.createElement('div');
            page.className = 'wm-page is-desktop';
            page.dataset.app = APP_ID;
            els.host.appendChild(page);
            APP.mount(page);
        } else {
            els.host.appendChild(page);
        }
        APP.show();
        renderBar();
    }

    root.melatonVideos = { start, shell };
    if (typeof melatonApps !== 'undefined') melatonApps.define('videos', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
