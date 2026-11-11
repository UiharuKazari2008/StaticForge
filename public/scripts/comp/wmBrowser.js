/**
 * Melaton Mobile: Internet Explorer, Yozora #709. Dreamscape's browsers, Grimoire and Alchemy, drawn
 * as Windows Mobile 6.1 Professional's Internet Explorer Mobile.
 *
 * Pages come from Alchemy, the remote Chromium (services/grimoire-browser): POST
 * /api/grimoire-browser/sessions opens a session and returns a viewer page (same origin,
 * modules/grimoireBrowserBridge.js) that paints the screencast on a canvas and sends input back.
 * The desktop does the same in grimoireRemoteBrowser.js grimoireOpenRemoteBrowser; this app speaks
 * the same postMessage protocol (grimoire-browser-*) to its own iframe and never opens desktop
 * windows.
 *
 * Touch: a layer over the viewer turns a tap into a click (synthetic pointer events on the
 * viewer's canvas, same origin), a drag into wheel scrolling with a fling, and tap-and-hold into
 * WM's context menu (the viewer's inspect). Typing: a tap on an edit field in the page (inspect
 * says editable) or the SIP button focuses a hidden text box; what the phone keyboard types goes
 * to the page as text and Backspace / Enter keys.
 * Sharpness: the iframe is laid out at up to 2x the page area and scaled down, and Alchemy's zoom
 * sets the CSS viewport, so View (One Column / Default / Desktop) and Zoom (text size) only change
 * the zoom value.
 * Back key: historyDepth() / onBack() walk the pages seen here (Chromium's own history where the
 * two agree, else a fresh navigation); Favorites and History are layers too.
 * Home: the Grimoire homepage in the start page's layout, and the Grimoire's wiki, search and
 * documentation pages drawn here without Alchemy (see "Grimoire pages" below).
 * Dreamscape apps (dsap: addresses: Data Management, Image Search, Control Panel, Agora ...) run
 * here too, the desktop's own applet code in IE's page (see "Dreamscape apps" below); their phone
 * layout is public/css/wm-dsap.css. Fandom and the Apocrypha show here with the desktop Grimoire's
 * own renderers (see "Fandom and the Apocrypha" below).
 * Sessions: Alchemy has a 4-session cap, so the session is closed when the app is closed (title
 * X), 60 s after the app goes behind another, and when the tab goes away.
 * Windows (#748): Menu > New Window / Windows / Close Window keep up to 8 pages open, each with its
 * own history, page boxes, Alchemy session and running applet (see "Windows" below). A web page in
 * a window that is not on screen keeps its session for 5 minutes (then it reopens from its address),
 * and gives it up at once when a new page finds Alchemy full.
 *
 * Measured on the Device Emulator (VGA, 2x halved; ~/.cache/wm61/ref-ie/ie-home.png):
 *   address bar  22 px tab-strip tint + 1 px black rule (as .wm-pv-bar); security lock (16 px) at
 *                x 2, edit box from x 20 to 20 px from the right (1 px black frame, 20 px tall, the
 *                drop-down triangle inside at the right), green go arrow (stop X while loading) at
 *                the right
 *   start page   logo, a search box (x 20..188, 26 px) with the magnifier button, and Favorites /
 *                History expanders (x 4..228, 33 px, silver gradient, bold label, double chevron)
 *   soft keys    Favorites / Menu
 * Art: browsres.192.dll bitmaps 4594 (stop, go, lock, unlock), 4595 (folder, favorite, page),
 * 4597 (busy ring), downscaled for 1x; the start page logo / magnifier / chevron from the ROM's
 * default page.
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Styles: public/css/wm-browser.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'browser';
    const HISTORY_KEY = 'wmIeHistory';
    const TYPED_KEY = 'wmIeTyped';
    const VIEW_KEY = 'wmIeView';
    const ZOOM_KEY = 'wmIeZoom';
    const FULL_KEY = 'wmIeFullScreen';
    const MAX_HISTORY = 100;
    const MAX_TYPED = 10;
    const IDLE_CLOSE_MS = 60000;
    const LONG_PRESS_MS = 550;
    const DRAG_SLOP = 8;
    const SENTINEL = '​';
    // View: the page's CSS viewport width. One Column fits the phone (sites' narrow layouts),
    // Default is half again as wide, Desktop is a 1024 px desktop page shrunk to fit.
    const VIEWS = [['column', 'One Column'], ['default', 'Default'], ['desktop', 'Desktop']];
    // Zoom: IE Mobile's text sizes
    const ZOOMS = [['largest', 'Largest', 1.5], ['larger', 'Larger', 1.25], ['medium', 'Medium', 1], ['smaller', 'Smaller', 0.85], ['smallest', 'Smallest', 0.7]];

    // the Grimoire's own pages (tagWikiSearchModal.js addresses), drawn here without Alchemy
    const GRIM_HOME_URL = 'edtx://en.grimoire.jp/index.dtxt';
    const RECENT_KEY = 'dreamWikiRecentPages'; // DREAMWIKI_RECENT_STORAGE_KEY, shared with the desktop Grimoire
    const RECENT_MAX = 20;
    const ALCHEMY_HOME = 'https://www.bing.com/'; // ALCHEMY_HOME_URL: public/scripts/comp/featureLoader.js
    // the desktop Grimoire homepage's Settings, Fandom and Apocrypha buttons (bindDreamWikiHomepageEvents)
    const SETTINGS_URL = 'dsap://dreamscape.jp/';
    const FANDOM_HOME = 'rdf://wiki.fandom.jp/';
    const APOCRYPHA_HOME = 'rdf://apocrypha.737.jp.net/';

    let ws = null; // window.wmShell
    // WM's wait cursor (wmShell.busy) while a download is saved or a picked file uploads
    const busyOf = (fn) => (ws && typeof ws.busy === 'function' ? ws.busy(fn) : fn());
    let page = null;
    let els = {};
    let sub = null; // null | 'favorites' | 'history'
    let subSel = -1;
    // pages seen here: Grimoire pages { home: true, grim, url, title } (no Alchemy; a Dreamscape app is
    // grim.kind 'dsap') | web pages { url, title, pending }
    const homeEntry = () => ({ home: true, grim: { kind: 'home' }, url: GRIM_HOME_URL, title: 'Grimoire' });

    /**
     * Windows (#748). The device shows one page at a time and has no tabs; here Menu > New Window,
     * Windows and Close Window keep up to MAX_WINDOWS pages open, built from the device's own menu
     * rows only. Each window has its own history (entries, idx), address and title, scroll, Alchemy
     * session and viewer, running Dreamscape app, and its own page boxes (.wmb-home, .wmb-gpage,
     * .wmb-dsap, .wmb-core, .wmb-frame-wrap: one set per window in .wmb-view, hidden while another
     * window shows), so a window comes back as it was left and is not loaded again. Favorites,
     * History, the typed addresses, View / Zoom / Text Size and the options belong to the program
     * and are shared.
     * W is the window the code works on, cur the one on screen. They are the same except inside
     * inWin(w, fn): what answers later (a viewer's messages, server replies, timers, an applet's
     * calls) reaches its own window that way. What draws the bars or the page (render,
     * renderAddress, setLoading, step, chrome65) acts only for the window on screen.
     * MAX_WINDOWS 8: the Windows list stays a short menu in both versions, and every window may
     * hold a running applet or one of Alchemy's 4 sessions (see "sessions").
     */
    const MAX_WINDOWS = 8;
    const WINDOW_IDLE_MS = 300000; // a web page or applet in a window that is not on screen is let go after 5 minutes
    const WIN_BOXES = ['home', 'gpage', 'dsap', 'core', 'frameWrap'];
    let winSeq = 0;
    function makeWin() {
        return {
            id: ++winSeq,
            closed: false,
            popup: false, // opened by a page (window.open, target=_blank)
            shownAt: 0,
            dom: null, // { home, gpage, dsap, dsapArea, core, frameWrap, touch }
            scrolls: null,
            entries: [homeEntry()],
            idx: 0,
            chromeAt: -1, // the entry Chromium is on
            chromeBase: 0, // entries before this are not in Chromium's history (a new session)
            pendingDir: 0,
            session: null, // { id, viewUrl, query }
            creating: null,
            wantUrl: '', // the address the newest openSession asked for (a session being made loads this one)
            frame: null,
            ready: false,
            loading: false,
            idleTimer: 0,
            pendingInspect: null,
            pendingInspectAt: 0,
            lastPushAt: 0, // a page link added an entry
            lastInputAt: 0, // the last tap or key sent to the page
            grimLoading: false, // a Grimoire page on its way (renderLocal)
            localShown: null, // the entry drawn in .wmb-gpage
            dsapShown: null, // the entry the running applet draws
            dsapLoadSeq: 0,
            dsapActivating: false,
            dsapIdleTimer: 0,
            dsapAddrMove: null, // { from, to }: setAddress just moved the address (host.setUrl); addToHistory may follow
            dsapShell: null,
            coreShown: null // the entry whose box is in .wmb-core
        };
    }
    let wins = [makeWin()]; // in the order they were opened
    let W = wins[0];
    let cur = W;
    let inDepth = 0;
    function inWin(w, fn) {
        if (!w || w.closed) return undefined;
        const prev = W;
        W = w;
        inDepth++;
        try { return fn(); } finally { inDepth--; W = inDepth ? prev : cur; }
    }
    let visible = false;
    let favorites = [];
    let favoritesLoaded = false;
    let settings = null;
    let addrEditing = false;
    // the newest inspect request: 'tap' | { x, y } (tap-and-hold at a point). The viewer keeps one too and
    // answers only the newest, so a single slot (with a time limit) stays in step with it.
    const INSPECT_MS = 1500;
    let viewMode = 'column';
    let zoomKey = 'medium';
    let fullScreen = false;
    try {
        const v = localStorage.getItem(VIEW_KEY);
        if (VIEWS.some(([k]) => k === v)) viewMode = v;
        const z = localStorage.getItem(ZOOM_KEY);
        if (ZOOMS.some(([k]) => k === z)) zoomKey = z;
        fullScreen = localStorage.getItem(FULL_KEY) === '1';
    } catch (_) { /* storage off */ }

    // Melaton Mobile 6.5 (Internet Explorer Mobile 6, #741): see "6.5" below
    const v65 = document.documentElement.dataset.wmVersion === '6.5';
    const ZOOM65_KEY = 'wmIeZoom65';
    const BARS65_MS = 7000; // device: bars still up 6.2 s after the tap that showed them, fading at 7.5 s
    const ZOOM65_MS = 1500; // device: the slider stays 1 to 2 s after the last touch
    const ZOOM65_REST = 0.13; // device: the thumb rests 184 of 212 px down its travel on a page at 100%
    let bars65 = true;
    let barsTimer65 = 0;
    let zoomOpen65 = false;
    let zoomTimer65 = 0;
    let pageZoom65 = 1;
    let subData65 = null; // the form on screen (Add / Edit Favorite, Other)
    try {
        const pz = Number(localStorage.getItem(ZOOM65_KEY));
        if (v65 && pz >= 0.5 && pz <= 4) pageZoom65 = pz;
    } catch (_) { /* storage off */ }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isCurrent = () => !!(ws && ws.current === APP_ID);
    const entry = () => W.entries[W.idx] || homeEntry();
    const onHome = () => !!entry().home;
    const srcsetOf = (name) => (window.wmShell ? window.wmShell.art.srcset(name) : `/static_images/wm61/${name}@2x.png 2x`);
    const img = (name, cls) => `<img class="${cls || ''}" src="/static_images/wm61/${name}.png" srcset="${srcsetOf(name)}" alt="" draggable="false">`;

    function readList(key) {
        try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
    }
    function writeList(key, list) {
        try { localStorage.setItem(key, JSON.stringify(list)); } catch (_) { /* storage off */ }
    }

    // ---------------------------------------------------------------- URLs

    function webUrl(raw) {
        const text = String(raw || '').trim();
        if (!text) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
            try {
                const u = new URL(text);
                if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) return u.href;
            } catch (_) { /* not a URL */ }
            return '';
        }
        if (!/\s/.test(text) && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(text)) return webUrl('https://' + text);
        if (!/\s/.test(text) && /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(text)) return webUrl('http://' + text);
        return '';
    }

    /** Text that is not an address: Alchemy's search provider (Grimoire's own wiki search is desktop-only; the web search stands in). */
    function searchUrl(q) {
        const provider = settings && settings.searchProvider;
        if ((provider === 'danbooru' || provider === 'e621') && typeof window.grimoireOnlineWikiUrls === 'function') {
            try { const u = window.grimoireOnlineWikiUrls(q)[provider]; if (u) return u; } catch (_) { /* fall through */ }
        }
        return 'https://www.google.com/search?q=' + encodeURIComponent(q);
    }

    function hostOf(url) {
        try { return new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { return url; }
    }

    // ---------------------------------------------------------------- settings / favorites / history

    async function loadSettings() {
        try {
            const data = await window.wsClient.getUserGlobalSettings();
            settings = (data && data.settings && data.settings.alchemy) || { bookmarks: [] };
        } catch (_) {
            settings = settings || { bookmarks: [] };
        }
        favorites = Array.isArray(settings.bookmarks) ? settings.bookmarks.slice() : [];
        favoritesLoaded = true;
        return settings;
    }

    // Settings > Grimoire (wmSettingsConnections.js) saved new settings: one copy for the session
    window.addEventListener('wm-alchemy-settings', (e) => {
        const next = e && e.detail && e.detail.settings;
        if (!next || typeof next !== 'object') return;
        settings = Object.assign({}, settings || {}, next);
        if (Array.isArray(settings.bookmarks)) { favorites = settings.bookmarks.slice(); favoritesLoaded = true; }
        wins.forEach((w) => inWin(w, () => {
            if (W.ready) post({ type: 'grimoire-browser-settings', settings });
            syncAudio();
        }));
    });

    async function saveFavorites(next) {
        const data = await window.wsClient.updateUserGlobalSettings({ alchemy: { bookmarks: next } });
        if (data && data.settings && data.settings.alchemy) settings = data.settings.alchemy;
        favorites = Array.isArray(settings && settings.bookmarks) ? settings.bookmarks.slice() : next;
        // the desktop's copy (grimoireRemoteBrowser.js) reads the same settings again next time
        try { if (typeof grimoireAlchemySettings !== 'undefined') grimoireAlchemySettings = null; } catch (_) { /* not loaded */ }
    }

    function noteHistory(url, title) {
        if (!url) return;
        const list = readList(HISTORY_KEY).filter((h) => h && h.url !== url);
        list.unshift({ url, title: title || '', at: Date.now() });
        writeList(HISTORY_KEY, list.slice(0, MAX_HISTORY));
    }

    function noteTyped(url) {
        const list = readList(TYPED_KEY).filter((u) => u !== url);
        list.unshift(url);
        writeList(TYPED_KEY, list.slice(0, MAX_TYPED));
    }

    // ---------------------------------------------------------------- viewport

    function zoomFactor() { return (ZOOMS.find(([k]) => k === zoomKey) || ZOOMS[2])[2]; }

    /**
     * Layout of the viewer: { W, H } page area, s = sharpness (frame px per phone px), V = CSS
     * viewport width, z = Alchemy zoom (its device scale), d = still scale. Chromium's screencast
     * frames are CSS-viewport sized whatever the device scale (zoom 1.96 on a 766 px session sends
     * 391 px frames), so the moving picture is at most 1 frame px per CSS px. z stays at or under
     * 1 up to Medium; at Larger and Largest in One Column the 320 px minimum frame width pushes
     * it over 1 (312 or 260 CSS px frames in a 390 px box), so those frames are softer. Sharpness
     * comes from Alchemy's still once the page settles: d = phone device px per page CSS px (3 on
     * a dpr 3 phone in One Column, more at Larger), capped at 4; Alchemy caps its pixels too.
     */
    function geometry() {
        const W = Math.max(1, els.view.clientWidth);
        const H = Math.max(1, els.view.clientHeight);
        const base = viewMode === 'desktop' ? Math.max(W, 1024) : viewMode === 'default' ? Math.round(W * 1.5) : W;
        const V = base / (zoomFactor() * (v65 ? pageZoom65 : 1));
        let s = Math.min(2, Math.max(1, window.devicePixelRatio || 1), V / W);
        // Alchemy's frames are 320..1920 x 240..1440
        s = Math.min(s, 1920 / W, 1440 / H);
        s = Math.max(s, 320 / W, 240 / H);
        const L = Math.round(W * s);
        const z = Math.max(0.1, Math.min(4, L / V));
        const d = Math.min(4, (W * Math.max(1, window.devicePixelRatio || 1)) / (L / z));
        return { W, H, s, V: L / z, L, Lh: Math.round(H * s), z, d: Math.round(d * 100) / 100 };
    }

    function layoutFrame() {
        if (!W.frame || !els.view.clientWidth) return;
        const g = geometry();
        W.frame.style.width = `${g.L}px`;
        W.frame.style.height = `${g.Lh}px`;
        W.frame.style.transform = `scale(${1 / g.s})`;
        if (W.ready) {
            post({ type: 'grimoire-browser-zoom', value: g.z });
            // a still at the phone's own pixels once the page settles (older viewers ignore it)
            post({ type: 'grimoire-browser-scale', value: g.d });
        }
    }

    function postTo(w, msg) {
        if (w && w.frame && w.frame.contentWindow) w.frame.contentWindow.postMessage(msg, location.origin);
    }

    function post(msg) { postTo(W, msg); }

    // ---------------------------------------------------------------- sessions

    function closeSession() {
        clearTimeout(W.idleTimer);
        W.idleTimer = 0;
        const s = W.session;
        W.session = null;
        W.ready = false;
        W.chromeAt = -1;
        W.pendingInspect = null;
        if (W.frame) { W.frame.remove(); W.frame = null; }
        setLoading(false);
        if (!s) return Promise.resolve();
        return dropSession(s.id);
    }

    async function cannotConnect(detail) {
        setLoading(false);
        await ws.messageBox({
            title: 'Cannot Connect',
            icon: 'error',
            text: detail || 'The page cannot be displayed. Alchemy, which loads web pages for this phone, cannot be reached right now. Try again later.'
        });
    }

    const dropSession = (id) => fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {});

    /** The viewer of W's session (a new one, or a page's own new window handed over by Alchemy). */
    function attachSession(payload) {
        W.session = { id: payload.sessionId || '', viewUrl: payload.viewUrl, query: String(payload.viewUrl).split('?')[1] || '' };
        W.chromeAt = W.idx;
        W.chromeBase = W.idx;
        const frame = document.createElement('iframe');
        W.frame = frame;
        frame.className = 'wmb-frame';
        frame.title = 'Web page';
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('allow', 'autoplay; clipboard-read; clipboard-write');
        if (W.dom) W.dom.frameWrap.prepend(frame);
        layoutFrame();
        frame.addEventListener('load', () => {
            // the viewer's canvas keeps focus for keys; its focus ring is not part of the page
            try {
                const st = frame.contentDocument.createElement('style');
                st.textContent = 'canvas:focus{outline:none}';
                frame.contentDocument.head.appendChild(st);
            } catch (_) { /* not ours */ }
        });
        frame.src = payload.viewUrl;
        if (pageAway()) scheduleIdleClose();
    }

    /** Alchemy is full: the page of our window that has been off screen the longest is let go (it reopens from its address). */
    function releaseOldestSession(but) {
        let old = null;
        for (const w of wins) if (w !== but && w !== cur && w.session && (!old || w.shownAt < old.shownAt)) old = w;
        if (!old) return null;
        return inWin(old, closeSession);
    }

    /** A new Alchemy session showing url (the entry at idx) in the window W. */
    async function openSession(url) {
        const w = W;
        // a later request (a link from another app, a favorite tapped while the first page is still
        // being made) wins: the session is made for the newest address
        w.wantUrl = url;
        if (w.creating) return w.creating;
        w.creating = (async () => {
            await closeSession();
            let res;
            let payload = {};
            let freed = false;
            for (;;) {
                if (w.closed) return false;
                const g = geometry();
                const asked = w.wantUrl;
                inWin(w, () => setLoading(true));
                try {
                    res = await fetch('/api/grimoire-browser/sessions', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: asked, width: g.L, height: g.Lh, popup: false })
                    });
                } catch (_) {
                    await inWin(w, () => cannotConnect());
                    return false;
                }
                payload = {};
                try { payload = await res.json(); } catch (_) { /* empty */ }
                // the window was closed while its page was made: the new session is let go
                if (w.closed) { if (payload.sessionId) dropSession(payload.sessionId); return false; }
                if (res.status === 429 && !freed) {
                    // Alchemy's 4 pages are all in use: one of our own windows behind this one gives its page up
                    const gone = releaseOldestSession(w);
                    if (gone) { freed = true; await gone; continue; }
                }
                if (w.wantUrl === asked || !res.ok || !payload.viewUrl) break;
                // another address was asked for while this one was made: let it go and make the newest
                if (payload.sessionId) dropSession(payload.sessionId);
            }
            if (res.status === 429) {
                await inWin(w, () => cannotConnect('Alchemy already has as many pages open as it can (4). Close a web page on the desktop, then try again.'));
                return false;
            }
            if (!res.ok || !payload.viewUrl) {
                await inWin(w, () => cannotConnect(res.status === 503 ? 'The page cannot be displayed. Alchemy is not set up on this server.' : null));
                return false;
            }
            inWin(w, () => attachSession(payload));
            return true;
        })();
        try { return await w.creating; } finally { w.creating = null; }
    }

    function scheduleIdleClose(ms) {
        const w = W;
        clearTimeout(w.idleTimer);
        w.idleTimer = setTimeout(() => inWin(w, () => { w.idleTimer = 0; if (pageAway()) closeSession(); }), ms || (visible && w !== cur ? WINDOW_IDLE_MS : IDLE_CLOSE_MS));
    }

    /** The web page is not on screen: IE is hidden, another window shows, or the start page, Favorites or History shows. */
    function pageAway() {
        return !visible || W !== cur || onHome() || !!sub;
    }

    /** The page left the screen (start page, Favorites, History): it falls silent and Alchemy lets it go
     *  after a while; it came back: the timer stops (a page let go reopens from its address). */
    function syncPageShown() {
        syncAudio();
        if (!visible) return;
        if (pageAway()) { if (W.session && !W.idleTimer) scheduleIdleClose(); }
        else if (W.idleTimer) { clearTimeout(W.idleTimer); W.idleTimer = 0; }
    }

    function syncAudio() {
        if (!W.ready) return;
        const on = visible && !pageAway() && !document.hidden && !(settings && settings.audioEnabled === false);
        const vol = settings && settings.audioVolume !== undefined ? settings.audioVolume / 100 : 1;
        let master = 1;
        try { if (window.tabVolume && typeof window.tabVolume.masterGain === 'function') master = window.tabVolume.masterGain(); } catch (_) { /* none */ }
        post({ type: 'grimoire-browser-audio', on, volume: vol * master });
    }

    // ---------------------------------------------------------------- navigation

    function webCount(upTo) {
        let n = 0;
        for (let i = 0; i <= upTo && i < W.entries.length; i++) if (!W.entries[i].home) n++;
        return n;
    }

    function step() {
        if (ws && W === cur) { ws.syncHistory(); if (isCurrent()) ws.refreshSoftKeys(); }
    }

    /** Go to a web address (typed, a favorite, a link from elsewhere). */
    function navigate(raw, title) {
        if (!raw) return;
        // Fandom and the Apocrypha: the desktop Grimoire's renderers in IE's page
        if (coreAddress(raw)) { openCore(raw, title); return; }
        // a Dreamscape app's address (dsap:, or a bare registered applet host such as data.dreamscape.jp)
        if (dsapAddress(raw)) { openDsap(raw, title); return; }
        const url = webUrl(raw);
        if (!url) {
            // the Grimoire's own pages show here; other schemes (chrome:, a Grimoire domain with no phone page) cannot open
            const g = parseGrim(raw);
            if (g) openLocal(g, title);
            else cannotOpen(raw);
            return;
        }
        W.pendingInspect = null;
        closeSub();
        noteHistory(url, title);
        W.entries = W.entries.slice(0, W.idx + 1);
        W.entries.push({ url, title: title || '', pending: true });
        W.idx = W.entries.length - 1;
        W.pendingDir = 0;
        render();
        step();
        if (W.session && W.frame && W.ready) {
            W.chromeAt = W.idx;
            setLoading(true);
            post({ type: 'grimoire-browser-navigate', url });
        } else {
            const added = W.entries[W.idx];
            const w = W;
            openSession(url).then((ok) => inWin(w, () => {
                // no page: back to where the address was typed
                if (ok || W.entries[W.idx] !== added) return;
                W.entries.splice(W.idx, 1);
                W.idx -= 1;
                // a window a page opened had nothing before it: the start page
                if (!W.entries.length) { W.entries = [homeEntry()]; W.idx = 0; }
                render();
                step();
            }));
        }
    }

    function goHome() {
        closeSub();
        if (onHome() && entry().grim.kind === 'home') return;
        pushLocal(homeEntry());
    }

    function pushLocal(e) {
        W.pendingInspect = null;
        W.entries = W.entries.slice(0, W.idx + 1);
        W.entries.push(e);
        W.idx = W.entries.length - 1;
        render();
        step();
    }

    /** A Grimoire page (parseGrim's target) as a new entry. */
    function openLocal(g, title) {
        closeSub();
        if (g.kind === 'home') { goHome(); return; }
        pushLocal({ home: true, grim: g, url: grimUrl(g), title: title || grimTitle(g) });
    }

    /** Move to entries[target]: the start page shows here; web pages step Chromium's history where it matches. */
    function goTo(target) {
        if (target < 0 || target >= W.entries.length || target === W.idx) return false;
        W.idx = target;
        W.pendingDir = 0;
        W.pendingInspect = null;
        const e = W.entries[target];
        render();
        step();
        if (e.home) return true;
        if (!W.session) { e.pending = true; W.chromeBase = target; openSession(e.url); return true; }
        const steps = W.chromeAt >= W.chromeBase && target >= W.chromeBase ? webCount(target) - webCount(W.chromeAt) : NaN;
        if (steps === 0) return true;
        setLoading(true);
        if (steps === 1 || steps === -1) {
            W.pendingDir = steps;
            W.chromeAt = target;
            post({ type: 'grimoire-browser-history', dir: steps });
        } else {
            e.pending = true;
            W.chromeAt = target;
            W.chromeBase = target;
            post({ type: 'grimoire-browser-navigate', url: e.url });
        }
        return true;
    }

    function goBack() {
        if (sub && W === cur) { if (v65) subDone65(false); else closeSub(); return true; }
        return goTo(W.idx - 1);
    }

    function goForward() { goTo(W.idx + 1); }

    function refresh() {
        if (onHome()) { renderLocal(true); return; }
        if (!W.session) { entry().pending = true; openSession(entry().url); return; }
        setLoading(true);
        post({ type: 'grimoire-browser-reload' });
    }

    function stop() {
        // the viewer has no stop message: Escape reaches the page, and the busy marks end here
        post({ type: 'grimoire-browser-key', kind: 'down', key: 'Escape', code: 'Escape', text: '' });
        post({ type: 'grimoire-browser-key', kind: 'up', key: 'Escape', code: 'Escape', text: '' });
        setLoading(false);
    }

    function onLocation(data) {
        const url = data.url || '';
        if (!/^https?:/i.test(url)) return;
        const title = data.title || '';
        if (data.type === 'grimoire-browser-navigating' || data.navigating) { setLoading(true); return; }
        setLoading(false);
        let e = W.entries[W.chromeAt >= 0 ? W.chromeAt : W.idx];
        if (W.pendingDir) {
            // Chromium stepped where we asked: it may land on another address (a redirect)
            W.pendingDir = 0;
            e = W.entries[W.chromeAt];
            if (e && !e.home) { e.url = url; if (title) e.title = title; }
        } else if (e && !e.home && (e.pending || e.url === url)) {
            if (e.pending) W.lastPushAt = Date.now();
            e.url = url;
            if (title) e.title = title;
            e.pending = false;
        } else if (e && !e.home && W.lastPushAt > W.lastInputAt && Date.now() - W.lastPushAt < 1500) {
            // a second address straight after a new page, with no tap or key between: the page
            // replaced its address (replaceState, a script redirect), Chromium has no new entry
            e.url = url;
            if (title) e.title = title;
        } else {
            // a link in the page: a new page after the one Chromium is on
            W.lastPushAt = Date.now();
            const at = W.chromeAt >= 0 ? W.chromeAt : W.idx;
            W.entries = W.entries.slice(0, at + 1);
            W.entries.push({ url, title });
            W.idx = W.entries.length - 1;
            W.chromeAt = W.idx;
            noteHistory(url, title);
            step();
        }
        if (e && !e.home && title) noteHistory(e.url, e.title);
        // 6.5: the title bar names the page as soon as its title is known
        if (W.chromeAt === W.idx) { renderAddress(); chrome65(); }
    }

    function onHistoryEnd(dir) {
        // Chromium has nothing that way: open the entry ourselves
        W.pendingDir = 0;
        const e = W.entries[W.chromeAt];
        if (!e) return;
        if (e.home) { setLoading(false); return; }
        e.pending = true;
        W.chromeBase = W.chromeAt;
        post({ type: 'grimoire-browser-navigate', url: e.url });
        void dir;
    }

    function setGrimLoading(on) {
        W.grimLoading = !!on;
        if (page && W === cur) page.classList.toggle('is-loading', (W.loading && !onHome()) || (W.grimLoading && onHome()));
    }

    function setLoading(on) {
        W.loading = !!on;
        if (!page || W !== cur) return;
        page.classList.toggle('is-loading', (W.loading && !onHome()) || (W.grimLoading && onHome()));
        renderGoButton();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- frame messages

    function onMessage(event) {
        // each window's viewer answers for its own window, on screen or not
        const w = wins.find((x) => x.frame && x.frame.contentWindow === event.source);
        if (!w) return;
        const data = event.data;
        if (!data || typeof data.type !== 'string') return;
        inWin(w, () => onViewerMessage(data));
    }

    function onViewerMessage(data) {
        switch (data.type) {
            case 'grimoire-browser-ready':
                W.ready = true;
                layoutFrame();
                syncAudio();
                if (settings) post({ type: 'grimoire-browser-settings', settings });
                break;
            case 'grimoire-browser-navigating':
            case 'grimoire-browser-location':
                onLocation(data);
                break;
            case 'grimoire-browser-navigation-failed':
                setLoading(false);
                break;
            case 'grimoire-browser-history-end':
                onHistoryEnd(data.dir);
                break;
            case 'grimoire-browser-progress':
                if (Number(data.value) >= 1) setLoading(false);
                break;
            case 'grimoire-browser-menu':
                onInspect(data);
                break;
            case 'grimoire-browser-select':
                showSelect(data);
                break;
            case 'grimoire-browser-dialog':
                showDialog(data);
                break;
            case 'grimoire-browser-file-chooser':
                chooseFile(data);
                break;
            case 'grimoire-browser-popup':
                onPopup(data);
                break;
            case 'grimoire-browser-closed':
                // the page closed itself: the session is gone
                W.session = null;
                W.ready = false;
                if (W.frame) { W.frame.remove(); W.frame = null; }
                W.chromeAt = -1;
                setLoading(false);
                // a window the page opened goes with it (a sign-in window closing itself); else the start page
                if (W.popup && wins.length > 1) closeWindow(W.id);
                else goHome();
                break;
            case 'grimoire-browser-reopen':
                if (webUrl(data.url)) { entry().pending = true; openSession(webUrl(data.url)); }
                break;
            case 'grimoire-browser-download':
                saveDownload({ download: data.id || '' }, data.filename || 'download');
                break;
            case 'grimoire-browser-clipboard':
                copyText(data.text || '');
                break;
            case 'grimoire-browser-paste-request':
                pasteFromClipboard();
                break;
            default:
                break;
        }
    }

    /**
     * A page asked for a new window (window.open, target=_blank). It opens in a new window here
     * while one is free (a window that keeps its opener comes with its own Alchemy session, which
     * the new window takes over as it is); with every window in use the page opens in the window
     * that asked, the old one-page behaviour, and a session that came with it is let go. A window
     * asked for by a page that is not on screen opens behind the one on screen.
     */
    function onPopup(data) {
        const url = webUrl(data.url);
        const own = data.sessionId && data.viewerToken
            ? { sessionId: data.sessionId, viewUrl: '/api/grimoire-browser/view/' + encodeURIComponent(data.sessionId) + '?t=' + encodeURIComponent(data.viewerToken) }
            : null;
        if (page && wins.length < MAX_WINDOWS && (own || url)) {
            const front = W === cur;
            const w = makeWin();
            w.popup = true;
            w.entries = [];
            w.idx = -1;
            wins.push(w);
            buildDom(w);
            if (front) switchTo(w.id);
            inWin(w, () => {
                if (!own) { navigate(url); return; }
                W.entries = [{ url: url || '', title: '', pending: true }];
                W.idx = 0;
                attachSession(own);
                setLoading(true);
                render();
                step();
            });
            return;
        }
        if (data.sessionId) dropSession(data.sessionId);
        if (url) navigate(url);
    }

    /**
     * An upload field on the page: WM's Open dialog over the VFS (wmFileDialogs.js), as the desktop's
     * IE answers it with its file dialog (grimoireRemoteBrowser.js grimoireShowFileChooser); Menu >
     * Browse device... takes the phone's own files (the browser's picker). The files go to the
     * remote browser's file-chooser routes and the page's input gets them; Cancel leaves it empty.
     */
    function chooseFile(data) {
        const s = W.session;
        const w = W;
        const reply = (cancel) => postTo(w, { type: 'grimoire-browser-file-chooser-reply', id: data.id, cancel: !!cancel });
        if (!s || !window.wmFileDialogs) {
            reply(true);
            ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: 'Uploading files from this phone is not supported. Use the desktop to choose files for this page.' });
            return;
        }
        const base = '/api/grimoire-browser/sessions/' + encodeURIComponent(s.id) + '/file-chooser/' + encodeURIComponent(data.id);
        const failed = (err) => {
            reply(true);
            ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: (err && err.message) || 'The file could not be uploaded.' });
        };
        const refOf = (item) => {
            if (!item || item.kind === 'folder') return null;
            if (item.targetKind === 'user-file' && !item.isUserFileLink) return { kind: 'file', id: item.targetId };
            if (item.targetKind === 'image' || item.targetKind === 'scrap') return { kind: 'image', filename: item.previewImageFilename || item.targetId };
            if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) return { kind: 'image', filename: item.shortcutData.filename };
            return null;
        };
        let answered = false;
        const browse = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = !!data.multiple;
            if (data.accept) input.accept = data.accept;
            input.addEventListener('change', async () => {
                const files = [...(input.files || [])];
                if (!files.length) { reply(true); return; }
                try {
                    await busyOf(async () => {
                        for (const file of (data.multiple ? files : files.slice(0, 1))) {
                            const res = await fetch(base + '/upload?' + s.query + '&name=' + encodeURIComponent(file.name), {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/octet-stream' },
                                body: file
                            });
                            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not upload ' + file.name);
                        }
                    });
                    reply(false);
                } catch (err) { failed(err); }
            }, { once: true });
            input.addEventListener('cancel', () => reply(true), { once: true });
            input.click();
        };
        window.wmFileDialogs.open({
            title: 'Choose File to Upload',
            appTitle: 'Internet Explorer',
            typeLabel: data.accept ? `Files (${data.accept})` : 'All Files (*.*)',
            accept: (item) => !!refOf(item),
            extra: [{ label: 'Browse device...', action: () => { answered = true; window.wmFileDialogs.close(); browse(); } }],
            async onPick(item) {
                answered = true;
                const ref = refOf(item);
                const res = await fetch(base + '/vfs?' + s.query, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: [ref] })
                });
                if (!res.ok) { failed(new Error((await res.json().catch(() => ({}))).error || 'Could not upload the file')); return true; }
                reply(false);
                return true;
            },
            onCancel() {
                if (!answered) reply(true);
                // left for another app from the dialog: the hidden page is let go after a while again
                inWin(w, () => { if (!visible && W.session) scheduleIdleClose(); });
            }
        });
        // the dialog hid IE: the page waits for the answer, not let go meanwhile
        clearTimeout(W.idleTimer);
        W.idleTimer = 0;
    }

    async function showDialog(data) {
        const w = W;
        const reply = { type: 'grimoire-browser-dialog-reply', id: data.id, accept: false };
        const text = String(data.message || '').slice(0, 2000);
        if (data.kind === 'prompt') {
            const v = await ws.messageBox({ title: 'Internet Explorer', text, input: { value: data.defaultValue || '' }, buttons: [{ text: 'OK', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false });
            reply.accept = v !== null;
            reply.text = v || '';
        } else if (data.kind === 'auth') {
            const user = await ws.messageBox({ title: 'Enter Network Password', text: `User name for ${text}${data.realm ? ` (${data.realm})` : ''}:`, input: { value: '' }, buttons: [{ text: 'OK', value: true, default: true }, { text: 'Cancel', value: false }] });
            const pass = user === null ? null : await ws.messageBox({ title: 'Enter Network Password', text: 'Password:', input: { value: '' }, buttons: [{ text: 'OK', value: true, default: true }, { text: 'Cancel', value: false }] });
            reply.accept = pass !== null;
            reply.username = user || '';
            reply.password = pass || '';
        } else if (data.kind === 'alert') {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'warning', text });
            reply.accept = true;
        } else {
            const leave = data.kind === 'beforeunload';
            const v = await ws.messageBox({
                title: 'Internet Explorer',
                icon: 'question',
                text: leave && !text ? 'Leave this page? Changes you made may not be saved.' : text,
                buttons: [{ text: leave ? 'Leave' : 'OK', value: true, default: true }, { text: leave ? 'Stay' : 'Cancel', value: false }]
            });
            reply.accept = v === true;
        }
        postTo(w, reply);
    }

    function showSelect(data) {
        // a list of a page that is not on screen has nowhere to open
        if (W !== cur || !W.frame) return;
        const items = [];
        let group = '';
        data.options.forEach((o, i) => {
            if (o.group && o.group !== group) items.push({ label: o.group, disabled: true });
            group = o.group || '';
            items.push({ label: o.label || ' ', radio: i === data.selected, disabled: !!o.disabled, indent: o.group ? 1 : 0, action: () => post({ type: 'grimoire-browser-select-pick', index: i }) });
        });
        const r = W.frame.getBoundingClientRect();
        const s = geometry().s;
        ws.menuAt(r.left + (Number(data.clientX) || 0) / s, r.top + (Number(data.clientY) || 0) / s, items);
    }

    async function copyText(text) {
        if (!text) return;
        try { await navigator.clipboard.writeText(text); return; } catch (_) { /* fall back */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) { /* no clipboard */ }
        ta.remove();
    }

    function pasteFromClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: 'This connection cannot read the clipboard. Type the text instead.' });
            return;
        }
        navigator.clipboard.readText().then((t) => { if (t) post({ type: 'grimoire-browser-paste', text: t }); }).catch(() => {});
    }

    async function saveDownload(ref, filename) {
        const session = W.session;
        if (!session) return;
        let ws0 = 'default';
        try {
            // eslint-disable-next-line no-undef
            if (typeof activeWorkspace !== 'undefined' && activeWorkspace) ws0 = activeWorkspace;
        } catch (_) { /* none */ }
        try {
            const info = await busyOf(async () => {
                const res = await fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(session.id) + '/save?' + session.query, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.assign({ filename, workspaceId: ws0 }, ref))
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'The file could not be saved.');
                return body;
            });
            await ws.messageBox({ title: 'Download Complete', icon: 'info', text: `${info.name || filename} was saved to Downloads.` });
        } catch (err) {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: `Cannot download '${filename}'. ${(err && err.message) || ''}` });
        }
    }

    // ---------------------------------------------------------------- touch on the page

    let touch = null; // { id, x0, y0, x, y, t, drag, held, timer, samples }
    let fling = 0;
    let wheelAcc = null;
    let wheelRaf = 0;

    function localPoint(e) {
        const r = els.touch.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function viewerCanvas() {
        try { return W.frame && W.frame.contentDocument && W.frame.contentDocument.getElementById('view'); } catch (_) { return null; }
    }

    /** A pointer / mouse event on the viewer's canvas at a page point (phone px). */
    function fire(type, p, extra) {
        const canvas = viewerCanvas();
        if (!canvas) return false;
        const s = geometry().s;
        const win = W.frame.contentWindow;
        const init = Object.assign({ bubbles: true, cancelable: true, clientX: p.x * s, clientY: p.y * s, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }, extra || {});
        const Ctor = type.startsWith('pointer') ? win.PointerEvent : type === 'wheel' ? win.WheelEvent : win.MouseEvent;
        canvas.dispatchEvent(new Ctor(type, init));
        return true;
    }

    function flushWheel() {
        wheelRaf = 0;
        const w = wheelAcc;
        wheelAcc = null;
        if (w && (w.dx || w.dy)) fire('wheel', w.p, { deltaX: w.dx, deltaY: w.dy, deltaMode: 0, buttons: 0 });
    }

    /** Scroll the page by phone px (positive = content moves up). */
    function scrollBy(dx, dy, p) {
        const g = geometry();
        const k = g.V / g.W;
        if (!wheelAcc) wheelAcc = { dx: 0, dy: 0, p };
        wheelAcc.dx += dx * k;
        wheelAcc.dy += dy * k;
        wheelAcc.p = p;
        if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheel);
    }

    function stopFling() { if (fling) { cancelAnimationFrame(fling); fling = 0; } }

    /**
     * Wheel scrolling moves Chromium's mouse to the finger, so the page sees a hover there
     * (link previews, menus). A finger has no hover: when the scroll ends the mouse leaves for
     * the page's bottom-right corner.
     */
    function parkPointer() {
        const g = geometry();
        fire('pointermove', { x: g.W - 1, y: g.H - 1 }, { buttons: 0 });
    }

    function startFling(vx, vy, p) {
        stopFling();
        let last = performance.now();
        const tick = (now) => {
            const dt = Math.min(50, now - last);
            last = now;
            const decay = Math.pow(0.995, dt);
            vx *= decay;
            vy *= decay;
            if (Math.hypot(vx, vy) < 0.05) { fling = 0; parkPointer(); return; }
            scrollBy(vx * dt, vy * dt, p);
            fling = requestAnimationFrame(tick);
        };
        fling = requestAnimationFrame(tick);
    }

    function onTouchDown(e) {
        if (e.button > 0 || touch) return;
        stopFling();
        const p = localPoint(e);
        touch = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, drag: false, held: false, samples: [{ t: performance.now(), x: p.x, y: p.y }] };
        try { els.touch.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        touch.timer = setTimeout(() => {
            if (!touch || touch.drag) return;
            touch.held = true;
            longPress(touch.x0, touch.y0, e.clientX, e.clientY);
        }, LONG_PRESS_MS);
        e.preventDefault();
    }

    function onTouchMove(e) {
        if (!touch || e.pointerId !== touch.id) return;
        const p = localPoint(e);
        if (!touch.drag && Math.hypot(p.x - touch.x0, p.y - touch.y0) > DRAG_SLOP && !touch.held) {
            touch.drag = true;
            clearTimeout(touch.timer);
        }
        if (touch.drag) {
            scrollBy(touch.x - p.x, touch.y - p.y, { x: touch.x0, y: touch.y0 });
            touch.samples.push({ t: performance.now(), x: p.x, y: p.y });
            if (touch.samples.length > 6) touch.samples.shift();
        }
        touch.x = p.x;
        touch.y = p.y;
        e.preventDefault();
    }

    function onTouchUp(e) {
        if (!touch || e.pointerId !== touch.id) return;
        const t = touch;
        touch = null;
        clearTimeout(t.timer);
        if (e.type === 'pointercancel' || t.held) return;
        if (t.drag) {
            const a = t.samples[0];
            const b = t.samples[t.samples.length - 1];
            const dt = b.t - a.t;
            if (dt > 0 && performance.now() - b.t < 80) startFling((a.x - b.x) / dt, (a.y - b.y) / dt, { x: t.x0, y: t.y0 });
            else setTimeout(parkPointer, 50);
            return;
        }
        tap(t.x0, t.y0);
    }

    function tap(x, y) {
        const p = { x, y };
        W.lastInputAt = Date.now();
        if (!fire('pointerdown', p)) return;
        fire('pointerup', p);
        // is it an edit field? the viewer's inspect answers (grimoire-browser-menu); a tap there raises the keyboard
        askInspect('tap');
        fire('contextmenu', p, { buttons: 0, button: 2 });
    }

    function askInspect(purpose) {
        W.pendingInspect = purpose;
        W.pendingInspectAt = Date.now();
    }

    function longPress(x, y, cx, cy) {
        askInspect({ x: cx, y: cy });
        fire('contextmenu', { x, y }, { buttons: 0, button: 2 });
    }

    function onWheel(e) {
        // a mouse or trackpad on a phone-sized window
        e.preventDefault();
        const p = localPoint(e);
        const g = geometry();
        const mode = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? g.H : 1;
        scrollBy(e.deltaX * mode / (g.V / g.W), e.deltaY * mode / (g.V / g.W), p);
    }

    function onInspect(data) {
        const purpose = W.pendingInspect;
        W.pendingInspect = null;
        // an answer that comes too late (the page was busy, or it moved on) is not the newest tap's
        if (!purpose || W !== cur || Date.now() - W.pendingInspectAt > INSPECT_MS) return;
        if (purpose === 'tap') {
            if (data.editable) focusIme();
            else if (document.activeElement === els.ime) els.ime.blur();
            return;
        }
        const items = [];
        if (data.href) {
            items.push({ label: 'Open', action: () => { const u = webUrl(data.href); if (u) navigate(u); } });
            items.push({ label: 'Copy Link', action: () => copyText(data.href) });
            items.push({ label: 'Add to Favorites...', action: () => addFavorite(data.href, data.text || hostOf(data.href)) });
            items.push({ label: 'Save Target As...', action: () => saveDownload({ url: data.href }, fileName(data.href, 'download')) });
        }
        if (data.src) {
            if (items.length) items.push('-');
            items.push({ label: 'Save Picture', action: () => saveDownload({ url: data.src }, fileName(data.src, data.alt || 'image')) });
            items.push({ label: 'Copy Picture Address', action: () => copyText(data.src) });
        }
        if (data.selection || data.editable) {
            if (items.length) items.push('-');
            if (data.selection) items.push({ label: 'Copy', action: () => copyText(data.selection) });
            if (data.editable) items.push({ label: 'Paste', action: pasteFromClipboard });
        }
        if (!items.length && v65) {
            // device (tap and hold on the page): Zoom, Make Selection, Back, Refresh, Add to Favorites, Favorites
            items.push({ label: 'Zoom', action: openZoom65 });
            items.push({ label: 'Make Selection', disabled: true });
            items.push({ label: 'Back', disabled: W.idx < 1, action: goBack });
            items.push({ label: 'Refresh', action: refresh });
            items.push({ label: 'Add to Favorites', action: () => addFavorite() });
            items.push({ label: 'Favorites', action: () => openSub('favorites') });
        }
        if (!items.length) {
            items.push({ label: 'Back', disabled: W.idx < 1, action: goBack });
            items.push({ label: 'Refresh', action: refresh });
            items.push({ label: 'Add to Favorites...', action: () => addFavorite() });
            items.push({ label: 'Copy Link', action: () => copyText(entry().url) });
        }
        ws.menuAt(purpose.x, purpose.y, items);
    }

    function fileName(url, fallback) {
        try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || fallback; } catch (_) { return fallback; }
    }

    // ---------------------------------------------------------------- typing into the page

    /**
     * Keys go to the viewer as keyboard events on its window (its own key handler sends them on).
     * Not the grimoire-browser-key message: that focuses the viewer's canvas, which takes the
     * focus from the hidden text box and closes the phone keyboard after one key.
     */
    function viewerKey(type, key) {
        W.lastInputAt = Date.now();
        try {
            const win = W.frame && W.frame.contentWindow;
            if (!win) return false;
            win.dispatchEvent(new win.KeyboardEvent(type, { key, code: key.length === 1 ? '' : key, bubbles: true, cancelable: true }));
            return true;
        } catch (_) { return false; }
    }

    function sendText(text) {
        let rest = '';
        for (const ch of text) {
            if (ch.length === 1 && !rest) viewerKey('keydown', ch);
            else rest += ch;
        }
        // characters outside the BMP (emoji) and what follows go as one paste
        if (rest) post({ type: 'grimoire-browser-paste', text: rest });
    }

    function sendKey(key) {
        viewerKey('keydown', key);
        viewerKey('keyup', key);
    }

    let imePrev = SENTINEL;

    function resetIme() {
        els.ime.value = SENTINEL;
        imePrev = SENTINEL;
        try { els.ime.setSelectionRange(1, 1); } catch (_) { /* not focused */ }
    }

    function focusIme() {
        if (!W.frame) return;
        resetIme();
        els.ime.focus({ preventScroll: true });
    }

    function onImeInput() {
        const cur = els.ime.value;
        let p = 0;
        while (p < cur.length && p < imePrev.length && cur[p] === imePrev[p]) p++;
        const removed = imePrev.length - p;
        const added = cur.slice(p).replace(new RegExp(SENTINEL, 'g'), '');
        for (let i = 0; i < removed; i++) sendKey('Backspace');
        if (added) {
            const parts = added.split('\n');
            parts.forEach((part, i) => {
                if (i) sendKey('Enter');
                if (part) sendText(part);
            });
        }
        imePrev = cur;
        if (!cur.startsWith(SENTINEL) || cur.includes('\n') || cur.length > 400) resetIme();
    }

    function onImeKey(e) {
        const keys = ['Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Delete'];
        if (keys.includes(e.key) || (e.key === 'Backspace' && els.ime.value === SENTINEL)) {
            e.preventDefault();
            sendKey(e.key);
            if (e.key === 'Enter' || e.key === 'Tab') resetIme();
        }
    }

    // ---------------------------------------------------------------- favorites

    async function addFavorite(url, title) {
        const u = url || entry().url;
        if (!u) {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: 'Open a web page first, then add it to Favorites.' });
            return;
        }
        if (!favoritesLoaded) await busyOf(loadSettings);
        if (v65) { openFavForm65({ url: u, title: title || entry().title || hostOf(u), at: -1 }); return; }
        const name = await ws.messageBox({
            title: 'Add Favorite',
            text: `Name:\n(${u})`,
            input: { value: title || entry().title || hostOf(u) },
            buttons: [{ text: 'Add', value: true, default: true }, { text: 'Cancel', value: false }]
        });
        if (name === null || name === false) return;
        try {
            await saveFavorites([{ url: u, title: name || hostOf(u) }].concat(favorites.filter((f) => f.url !== u)));
            if (sub === 'favorites') renderSub();
        } catch (_) {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'The favorite could not be saved.' });
        }
    }

    async function renameFavorite(i) {
        const f = favorites[i];
        if (!f) return;
        if (v65) { openFavForm65({ url: f.url, title: f.title || '', at: i }); return; }
        const name = await ws.messageBox({ title: 'Edit Favorite', text: 'Name:', input: { value: f.title || '' }, buttons: [{ text: 'Done', value: true, default: true }, { text: 'Cancel', value: false }] });
        if (!name) return;
        const next = favorites.slice();
        next[i] = Object.assign({}, f, { title: name });
        try { await saveFavorites(next); } catch (_) { /* kept */ }
        renderSub();
    }

    async function deleteFavorite(i) {
        const f = favorites[i];
        if (!f) return;
        const yes = await ws.messageBox({ title: v65 ? 'Delete Favorite' : 'Internet Explorer', icon: 'question', text: v65 ? `The Favorite '${f.title || f.url}' will be permanently deleted. Continue?` : `Delete '${f.title || f.url}' from Favorites?`, buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }] });
        if (!yes) return;
        try { await saveFavorites(favorites.filter((_, n) => n !== i)); } catch (_) { /* kept */ }
        subSel = Math.min(subSel, favorites.length - 1);
        if (v65 && subSel < 0 && favorites.length) subSel = 0;
        renderSub();
    }

    // ---------------------------------------------------------------- sub pages (Favorites, History)

    function openSub(kind) {
        if (ws) ws.closeMenus();
        sub = kind;
        // 6.5 lists open with their first row chosen
        subSel = v65 ? 0 : -1;
        renderSub();
        syncPageShown();
        // the list waits for the favorites under the wait cursor (no "Loading..." row of its own)
        if (kind === 'favorites' && !favoritesLoaded) busyOf(loadSettings).then(() => { if (sub === 'favorites') renderSub(); });
        step();
    }

    function closeSub() {
        // Favorites and History lie over the window on screen: a page moving on behind it leaves them be
        if (!sub || W !== cur) return;
        sub = null;
        if (els.sub) els.sub.hidden = true;
        page.classList.remove('has-sub');
        // back on a web page whose session was let go while the list showed: it reopens from its address
        if (visible && !onHome() && !W.session && !W.creating) { entry().pending = true; openSession(entry().url); }
        syncPageShown();
        step();
        chrome65();
    }

    function subRows() {
        if (sub === 'favorites') return favorites.map((f) => ({ url: f.url, title: f.title || f.url, sub: dsapAddress(f.url) ? 'Dreamscape' : webUrl(f.url) ? hostOf(f.url) : parseGrim(f.url) ? 'Grimoire' : 'Desktop only', icon: 'ie-favorite' }));
        return readList(HISTORY_KEY).map((h) => ({ url: h.url, title: h.title || h.url, sub: h.at ? new Date(h.at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' }) : '', icon: 'ie-page' }));
    }

    function renderSub() {
        if (!sub) return;
        if (v65) { renderSub65(); return; }
        page.classList.add('has-sub');
        els.sub.hidden = false;
        const rows = subRows();
        const empty = sub === 'favorites' ? (favoritesLoaded ? 'No favorites.' : '') : 'No history.';
        els.sub.innerHTML = `
            <div class="wmb-sub-head">${sub === 'favorites' ? 'Favorites' : 'History'}</div>
            <div class="wmb-sub-list" role="listbox">
                ${rows.length ? rows.map((r, i) => `
                    <div class="wmb-sub-row${i === subSel ? ' is-selected' : ''}" role="option" data-i="${i}">
                        ${img(r.icon, 'wmb-sub-ico')}<span class="wmb-sub-title">${esc(r.title)}</span><span class="wmb-sub-meta">${esc(r.sub)}</span>
                    </div>`).join('') : `<div class="wmb-sub-empty">${esc(empty)}</div>`}
            </div>`;
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function openSubRow(i) {
        const r = subRows()[i];
        if (!r) return;
        if (v65 && sub) { sub = null; els.sub.hidden = true; page.classList.remove('has-sub'); }
        navigate(r.url, r.title);
    }

    function subMenu() {
        const has = subSel >= 0 && subSel < subRows().length;
        if (sub === 'favorites') {
            return [
                { label: 'Add to Favorites...', action: () => addFavorite() },
                { label: 'Edit...', disabled: !has, action: () => renameFavorite(subSel) },
                { label: 'Delete', disabled: !has, action: () => deleteFavorite(subSel) },
                '-',
                { label: 'Cancel', action: closeSub }
            ];
        }
        return [
            { label: 'Delete', disabled: !has, action: () => { const list = readList(HISTORY_KEY); list.splice(subSel, 1); writeList(HISTORY_KEY, list); subSel = -1; renderSub(); } },
            { label: 'Clear History', action: clearHistory },
            '-',
            { label: 'Cancel', action: closeSub }
        ];
    }

    async function clearHistory() {
        const yes = await ws.messageBox({ title: 'Internet Explorer', icon: 'question', text: 'Delete all items in History?', buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }] });
        if (!yes) return;
        writeList(HISTORY_KEY, []);
        writeList(TYPED_KEY, []);
        subSel = -1;
        renderSub();
    }

    // ---------------------------------------------------------------- menus

    /**
     * Menu > New Window, Windows >, Close Window (#748). The device has no windows; the rows are
     * its own menu rows. Windows lists the open pages by title (else address) in the order they
     * were opened, the current one under the menu's own mark (6.1: the dot of View > One Column;
     * 6.5: the tick of View > Mobile / Desktop, which is how IE Mobile 6 marks one of a set).
     * New Window is grey with MAX_WINDOWS open, Close Window with one.
     */
    function winTitle(w) {
        const e = w.entries[w.idx] || homeEntry();
        return String(e.title || e.url || 'Internet Explorer').replace(/\s+/g, ' ').trim();
    }

    /** A long title ends in ... as CE cuts a menu row that does not fit. The row holds about 24
     *  letters of the menu font in 6.1 and 22 in 6.5 (wm-popup's width limit, measured in the test
     *  tab at the device's size); capitals and m / w are half again as wide, CJK twice. */
    function menuLabel(text) {
        const MAX = v65 ? 22 : 24;
        let n = 0;
        let out = '';
        for (const ch of text) {
            n += ch.codePointAt(0) > 0x2e7f ? 2 : /[A-Zmw@%]/.test(ch) ? 1.5 : 1;
            if (n > MAX) return out.trimEnd() + '...';
            out += ch;
        }
        return text;
    }

    function windowItems() {
        return [
            { label: 'New Window', disabled: wins.length >= MAX_WINDOWS, action: () => { newWindow(); } },
            {
                label: 'Windows',
                submenu: () => wins.map((w) => Object.assign({ label: menuLabel(winTitle(w)), action: () => { switchTo(w.id); } }, v65 ? { checked: w === cur } : { radio: w === cur }))
            },
            { label: 'Close Window', disabled: wins.length < 2, action: () => { closeWindow(); } }
        ];
    }

    function mainMenu() {
        const web = !onHome();
        return [
            { label: 'Back', disabled: W.idx < 1, action: goBack },
            { label: 'Forward', disabled: W.idx >= W.entries.length - 1, action: goForward },
            { label: 'Home', action: goHome },
            W.loading && web ? { label: 'Stop', action: stop } : { label: 'Refresh', action: refresh },
            // device (Menu: Zoom Out ... Forward, Refresh, View in one block, a rule, Edit, Tools): the
            // window rows close the block of page commands, after Refresh
            ...windowItems(),
            '-',
            { label: 'Add to Favorites...', action: () => addFavorite() },
            { label: 'History', action: () => openSub('history') },
            '-',
            {
                label: 'View',
                submenu: VIEWS.map(([k, label]) => ({ label, radio: viewMode === k, action: () => setView(k) }))
                    .concat(['-', { label: 'Full Screen', checked: fullScreen, action: toggleFullScreen }])
            },
            { label: 'Zoom', submenu: ZOOMS.map(([k, label]) => ({ label, radio: zoomKey === k, action: () => setZoom(k) })) },
            {
                label: 'Tools',
                submenu: [
                    { label: 'Copy Link', action: () => copyText(entry().url) },
                    { label: 'Paste', disabled: !web || !W.frame, action: pasteFromClipboard },
                    { label: 'Clear History', action: clearHistory },
                    '-',
                    { label: 'Properties', action: properties }
                ]
            }
        ];
    }

    function setView(k) {
        viewMode = k;
        try { localStorage.setItem(VIEW_KEY, k); } catch (_) { /* storage off */ }
        layoutFrame();
    }

    function setZoom(k) {
        zoomKey = k;
        try { localStorage.setItem(ZOOM_KEY, k); } catch (_) { /* storage off */ }
        layoutFrame();
    }

    function toggleFullScreen() {
        fullScreen = !fullScreen;
        try { localStorage.setItem(FULL_KEY, fullScreen ? '1' : '0'); } catch (_) { /* storage off */ }
        page.classList.toggle('is-full', fullScreen);
        requestAnimationFrame(layoutFrame);
    }

    function properties() {
        if (v65) { openSub('props'); return; }
        const e = entry();
        const secure = /^https:/i.test(e.url || '');
        ws.messageBox({
            title: 'Properties',
            icon: 'info',
            text: e.home
                ? `${e.title || 'Grimoire'}\n\nAddress: ${e.url}\nLoaded by: ${e.grim.kind === 'dsap' ? 'Dreamscape' : 'Grimoire'}`
                : `${e.title || hostOf(e.url)}\n\nAddress: ${e.url}\nSecurity: ${secure ? 'Secure (HTTPS)' : 'Not secure'}\nLoaded by: Alchemy`
        });
    }

    // ---------------------------------------------------------------- Grimoire pages

    /**
     * The Grimoire's pages, drawn here in the phone layout from the same server calls as the desktop
     * Grimoire (tagWikiSearchModal.js): its homepage is IE's start page (search box, starting points,
     * recently visited, then IE's Favorites / History), tag wiki pages (get_tag_wiki_page), the wiki
     * search (search_tag_wiki) and the documentation sites (get_static_wiki_site_index / _page).
     * Addresses are the desktop's: edtx://en.grimoire.jp/index.dtxt, .../search?q=,
     * edtx://wiki.danbooru.jp/tag/<name>, rdf://docs.novelai.jp/<page>, edtx://en.grimoire.jp/docs/<site>/<page>.
     * Dreamscape apps (dsap:) and Fandom / the Apocrypha (rdf://wiki.fandom.jp, rdf://apocrypha.737.jp.net)
     * have their own sections below.
     */
    function parseGrim(raw) {
        const text = String(raw || '').trim();
        let m;
        if (/^edtx:\/\/en\.grimoire\.jp\/?(?:index\.dtxt)?$/i.test(text)) return { kind: 'home' };
        if ((m = /^edtx:\/\/en\.grimoire\.jp\/search\/?(?:\?(.*))?$/i.exec(text))) {
            let q = '';
            try { q = new URLSearchParams(m[1] || '').get('q') || ''; } catch (_) { /* none */ }
            // no query: the search page (the desktop's search homepage, Search the Grim)
            return { kind: 'search', q: q.trim() };
        }
        if ((m = /^edtx:\/\/wiki\.(?:danbooru|e621)\.(?:jp|com)\/tag\/([^?#]+)/i.exec(text))) {
            let name = m[1];
            try { name = decodeURIComponent(name); } catch (_) { /* as is */ }
            name = name.replace(/_/g, ' ').trim();
            return name ? { kind: 'wiki', tag: name } : null;
        }
        if ((m = /^rdf:\/\/docs\.novelai\.jp\/?(.*)$/i.exec(text))) return m[1] ? { kind: 'doc', site: 'novelai', page: m[1] } : { kind: 'site', site: 'novelai' };
        if ((m = /^edtx:\/\/en\.grimoire\.jp\/docs\/([^/?#]+)\/?([^?#]*)$/i.exec(text))) return m[2] ? { kind: 'doc', site: m[1], page: m[2] } : { kind: 'site', site: m[1] };
        return null;
    }

    function grimUrl(g) {
        if (g.kind === 'search') return g.q ? 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(g.q) : 'edtx://en.grimoire.jp/search';
        if (g.kind === 'wiki') return 'edtx://wiki.danbooru.jp/tag/' + encodeURIComponent(String(g.tag).replace(/\s+/g, '_'));
        if (g.kind === 'site') return g.site === 'novelai' ? 'rdf://docs.novelai.jp/' : `edtx://en.grimoire.jp/docs/${g.site}`;
        if (g.kind === 'doc') return g.site === 'novelai' ? `rdf://docs.novelai.jp/${g.page}` : `edtx://en.grimoire.jp/docs/${g.site}/${g.page}`;
        return GRIM_HOME_URL;
    }

    function grimTitle(g) {
        if (g.kind === 'search') return g.q ? `Search: ${g.q}` : 'Search the Grim';
        if (g.kind === 'wiki') return g.tag;
        if (g.kind === 'site') return g.site === 'novelai' ? 'NovelAI Documentation' : g.site;
        if (g.kind === 'doc') return g.page;
        return 'Grimoire';
    }

    function readRecent() {
        return readList(RECENT_KEY).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    }

    function noteRecent(name) {
        const t = String(name || '').trim();
        if (!t) return;
        const list = readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase());
        list.unshift(t);
        writeList(RECENT_KEY, list.slice(0, RECENT_MAX));
    }

    const linkTo = (g, label, icon) => `<a class="wmb-home-link${icon ? ' has-icon' : ''}" href="${esc(grimUrl(g))}" data-grim="${esc(JSON.stringify(g))}">${icon || ''}${esc(label)}</a>`;
    const webLink = (url, label, icon) => `<a class="wmb-home-link${icon ? ' has-icon' : ''}" href="${esc(url)}" data-url="${esc(url)}">${icon || ''}${esc(label)}</a>`;
    const iconImg = (src) => `<img class="wmb-link-ico" src="${esc(src)}" alt="" draggable="false">`;

    let docSites = null; // get_wiki_home's documentation sites (Fandom has its own row, as on the desktop)
    let docSitesAsked = false;

    let docSitesRetry = 0;
    function loadDocSites() {
        if (docSitesAsked || docSitesRetry) return;
        // not connected yet, or the socket was still signing in (boot): asked again shortly while the start page shows
        const later = () => {
            docSitesRetry = setTimeout(() => {
                docSitesRetry = 0;
                if (visible && onHome() && entry().grim.kind === 'home') loadDocSites();
            }, 3000);
        };
        if (!window.wsClient || !window.wsClient.isConnected || !window.wsClient.isConnected()) { later(); return; }
        docSitesAsked = true;
        window.wsClient.sendMessage('get_wiki_home', {}).then((r) => {
            docSites = ((r && r.sites) || []).filter((x) => x && x.id && x.kind !== 'fandom');
            wins.forEach((w) => inWin(w, () => { if (W.dom && onHome() && entry().grim.kind === 'home') renderHomeLists(); }));
        }).catch(() => { docSitesAsked = false; later(); });
    }

    function renderHomeLists() {
        loadDocSites();
        const open = (k) => els.home.querySelector(`[data-exp="${k}"]`).getAttribute('aria-expanded') === 'true';
        const list = (k) => els.home.querySelector(`[data-list="${k}"]`);
        for (const k of ['start', 'recent', 'favorites', 'history']) list(k).hidden = !open(k);
        const row = (r) => (webUrl(r.url) ? webLink(r.url, r.title || r.url) : `<a class="wmb-home-link" href="${esc(r.url)}" data-url="${esc(r.url)}">${esc(r.title || r.url)}</a>`);
        if (open('start')) {
            // the desktop's starting points in its order (tagWikiSearchModal.js showDreamWikiHomepage)
            const tagIcon = iconImg('/static_images/wm61/ie-page.png');
            const rows = [
                linkTo({ kind: 'search', q: '' }, 'Search the Grim', iconImg('/static_images/wm61/app-search.png')),
                webLink(SETTINGS_URL, 'Settings', iconImg('/static_images/wm61/app-settings.png')),
                linkTo({ kind: 'wiki', tag: 'tag groups' }, 'Danbooru Tags', tagIcon),
                linkTo({ kind: 'wiki', tag: 'tag_group:index' }, 'e621 Tags', tagIcon),
                webLink(FANDOM_HOME, 'Fandom', iconImg('/static_images/fandom.png')),
                webLink(APOCRYPHA_HOME, 'Apocrypha', tagIcon)
            ];
            (docSites || []).forEach((site) => {
                const name = site.id === 'novelai' || String(site.id).toLowerCase().includes('novelai') ? 'NovelAI' : (site.name || site.id);
                rows.push(linkTo({ kind: 'site', site: site.id }, name, site.icon ? iconImg(site.icon) : iconImg('/static_images/wm61/ie-folder.png')));
            });
            rows.push(webLink(ALCHEMY_HOME, 'Perform Alchemy!', iconImg('/static_images/app_icons/24/alchemy.webp')));
            list('start').innerHTML = rows.join('');
        }
        if (open('recent')) {
            const r = readRecent().slice(0, 12);
            list('recent').innerHTML = r.length ? r.map((n) => linkTo({ kind: 'wiki', tag: n }, n)).join('') : '<div class="wmb-home-none">No pages yet.</div>';
        }
        if (open('favorites')) list('favorites').innerHTML = favorites.length ? favorites.slice(0, 30).map((f) => row({ url: f.url, title: f.title })).join('') : (favoritesLoaded ? '<div class="wmb-home-none">No favorites.</div>' : '');
        if (open('history')) {
            const h = readList(HISTORY_KEY).slice(0, 15);
            list('history').innerHTML = h.length ? h.map(row).join('') : '<div class="wmb-home-none">No history.</div>';
        }
    }


    /** Draw the Grimoire entry on screen (again with force: Refresh). */
    function renderLocal(force) {
        const e = entry();
        if (!e.home) return;
        if (e.grim.kind === 'home') { renderHomeLists(); return; }
        if (e.grim.kind === 'dsap') { renderDsap(e, force); return; }
        if (e.grim.kind === 'core') { renderCore(e, force); return; }
        if (W.localShown === e && !force) {
            // back on a page whose request is still out (the start page was shown meanwhile): its ring again
            if (!e.html && e.pending) { setGrimLoading(true); return; }
            // already on screen as it is (#723 review: a page that arrived while away was left blank)
            if (e.html && els.gpage.childElementCount) return;
        }
        W.localShown = e;
        setGrimLoading(false);
        const box = els.gpage;
        // Back and Forward show a page as it was left (its scroll too); Refresh asks the server again
        if (e.html && !force) {
            // a fresh page lets off-screen blocks skip layout (wm-browser.css); one shown again at its
            // old scroll is laid out whole, or the estimated block heights would put the scroll elsewhere
            box.classList.toggle('is-restoring', !!e.scroll);
            box.innerHTML = e.html;
            box.scrollTop = e.scroll || 0;
            return;
        }
        box.scrollTop = 0;
        box.classList.remove('is-restoring');
        // a Grimoire page is browsing like a web page: IE's busy ring turns while it comes, the page is blank
        box.innerHTML = '';
        const w = W;
        const still = () => w.localShown === e && w.entries[w.idx] === e;
        const ws_ = window.wsClient;
        if (!ws_ || !ws_.isConnected || !ws_.isConnected()) {
            box.innerHTML = '<div class="wmb-g-note">The Grimoire cannot be reached: this phone is not connected to Dreamscape. Try again later.</div>';
            W.localShown = null;
            return;
        }
        setGrimLoading(true);
        e.pending = true;
        loadGrimPage(e.grim, force).finally(() => { e.pending = false; if (w.localShown === e) inWin(w, () => setGrimLoading(false)); }).then((html) => {
            // kept even when the user went elsewhere meanwhile: Forward shows it without asking again
            e.html = html;
            e.scroll = 0;
            if (!still()) return;
            box.innerHTML = html;
            const t = box.querySelector('[data-page-title]');
            if (t) { e.title = t.dataset.pageTitle; }
            noteHistory(e.url, e.title);
        }).catch((err) => {
            if (!still()) return;
            box.innerHTML = `<div class="wmb-g-note">${esc((err && err.message) || 'The page cannot be displayed.')}</div>`;
            w.localShown = null;
        });
    }

    const searchForm = (q) => `
        <form class="wmb-search wmb-g-search" action="#">
            <input type="search" class="wmb-search-input" value="${esc(q || '')}" autocomplete="off" enterkeyhint="search" placeholder="Search the Grim" aria-label="Search the Grimoire">
            <button type="submit" class="wmb-search-go" aria-label="Search">${img('ie-search')}</button>
        </form>`;

    async function loadGrimPage(g, force) {
        const send = (type, data) => window.wsClient.sendMessage(type, data);
        if (g.kind === 'search' && !g.q) {
            // the desktop's search homepage (tagWikiSearchModal.js showSearchResultsPage with no query)
            return `<div class="wmb-g-searchhome" data-page-title="Search the Grim">
                <img class="wmb-g-brand" src="/static_images/grim_logo_sheet.png" alt="Grimoire" draggable="false">
                ${searchForm('')}
                <div class="wmb-g-actions">
                    <button type="button" class="wmb-g-btn" data-grim-search>Search</button>
                    <button type="button" class="wmb-g-btn" data-grim-lucky>I'm Feeling Lucky</button>
                </div>
                <div class="wmb-g-note">Tip: Use the address bar for direct edtx:// navigation or tag names.</div></div>`;
        }
        if (g.kind === 'search') {
            const r = await send('search_tag_wiki', { query: g.q, searchType: 'name', source: 'both', includeNonTag: false, includeOnline: false, limit: 50 });
            const rows = ((r && r.results) || []).map((x) => {
                const name = x.title || x.name || '';
                const meta = [x.categoryName, Array.isArray(x.source) ? x.source.filter((s) => s !== 'database').join(', ') : x.source].filter(Boolean).join(' · ');
                return x.hasWiki
                    ? `<div class="wmb-g-result">${linkTo({ kind: 'wiki', tag: name }, name)}<span class="wmb-g-meta">${esc(meta)}</span></div>`
                    : `<div class="wmb-g-result is-nowiki"><span>${esc(name)}</span><span class="wmb-g-meta">${esc(meta ? meta + ' · ' : '')}no wiki page</span></div>`;
            });
            return `<div data-page-title="${esc('Search: ' + g.q)}">${searchForm(g.q)}
                <h1 class="wmb-g-title">Results for “${esc(g.q)}”</h1>
                ${rows.length ? rows.join('') : '<div class="wmb-g-note">No pages found.</div>'}
                <div class="wmb-g-more">${webLink(searchUrl(g.q), `Search the web for “${g.q}”`)}</div></div>`;
        }
        if (g.kind === 'wiki') {
            const name = String(g.tag).trim().replace(/\s+/g, '_').toLowerCase();
            const r = await send('get_tag_wiki_page', Object.assign({ tagName: name, source: 'both', format: 'html' }, force ? { force: true } : {}));
            const bodies = r && Array.isArray(r.bodies) ? r.bodies : (r && (r.html || r.body) ? [{ source: r.bodySource || '', html: r.html || r.body }] : []);
            if (!bodies.length) throw new Error((r && r.error) || `“${g.tag}” has no wiki page.`);
            const title = String(r.tagName || g.tag).replace(/_/g, ' ');
            noteRecent(title);
            const nax = r.naxImage && r.naxImage.gallerySlug && r.naxImage.filename
                ? `<img class="wmb-g-nax" src="/naxCache/${encodeURIComponent(r.naxImage.gallerySlug)}/${encodeURIComponent(r.naxImage.filename)}" alt="">` : '';
            return `<article class="wmb-g-wiki" data-page-title="${esc(title)}">
                <h1 class="wmb-g-title">${esc(title)}</h1>${nax}
                ${bodies.map((b) => `${bodies.length > 1 || b.source ? `<div class="wmb-g-source">${esc(b.source === 'e621' ? 'e621' : b.source === 'danbooru' ? 'Danbooru' : (b.source || ''))}</div>` : ''}<div class="wmb-g-body">${b.html || ''}</div>`).join('')}
                </article>`;
        }
        if (g.kind === 'site') {
            const r = await send('get_static_wiki_site_index', { siteId: g.site });
            const groups = (r && r.groups) || [];
            const title = (r && r.name) || g.site;
            return `<article class="wmb-g-wiki" data-page-title="${esc(title)}"><h1 class="wmb-g-title">${esc(title)}</h1>
                ${groups.length ? groups.map((gr) => `<h2 class="wmb-g-group">${esc(gr.name || 'Other')}</h2>${(gr.pages || []).map((pg) => linkTo({ kind: 'doc', site: g.site, page: pg.id }, pg.title || pg.id)).join('')}`).join('') : '<div class="wmb-g-note">No pages imported yet.</div>'}
                </article>`;
        }
        if (g.kind === 'doc') {
            const r = await send('get_static_wiki_page', { siteId: g.site, pageId: g.page });
            if (!r || (!r.html && !r.text)) throw new Error((r && r.error) || 'The page cannot be displayed.');
            const title = r.title || g.page;
            return `<article class="wmb-g-wiki" data-page-title="${esc(title)}"><h1 class="wmb-g-title">${esc(title)}</h1>
                <div class="wmb-g-body">${r.html || `<pre>${esc(r.text)}</pre>`}</div></article>`;
        }
        throw new Error('The page cannot be displayed.');
    }

    /** Links on the Grimoire pages: Grimoire pages stay here, web links go to Alchemy, anchors scroll. */
    function scrollToAnchor(id) {
        let target = null;
        try { target = id && els.gpage.querySelector('#' + CSS.escape(id)); } catch (_) { target = null; }
        if (target) els.gpage.scrollTop += target.getBoundingClientRect().top - els.gpage.getBoundingClientRect().top;
    }

    function onLocalClick(e) {
        // DText's collapsed sections (tagWikiSearchModal.js opens them the same way)
        const toggle = e.target.closest && e.target.closest('.tag-wiki-section-toggle');
        if (toggle && els.gpage.contains(toggle)) {
            let body = null;
            try { body = els.gpage.querySelector('#' + CSS.escape(toggle.dataset.target || '')); } catch (_) { body = null; }
            if (body) toggle.classList.toggle('is-open', body.classList.toggle('hidden') === false);
            return;
        }
        const btn = e.target.closest && e.target.closest('[data-grim-search], [data-grim-lucky]');
        if (btn && els.gpage.contains(btn)) {
            if (btn.hasAttribute('data-grim-lucky')) {
                // the desktop's demo searches
                const demos = ['1girl', 'solo', 'cat', 'school_uniform'];
                openLocal({ kind: 'search', q: demos[Math.floor(Math.random() * demos.length)] });
            } else {
                const form = els.gpage.querySelector('form.wmb-g-search');
                if (form) form.requestSubmit();
            }
            return;
        }
        const a = e.target.closest && e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        if (a.dataset.tagName && a.dataset.tagName.startsWith('#')) { scrollToAnchor(a.dataset.tagName.slice(1)); return; }
        if (a.dataset.grim) { try { openLocal(JSON.parse(a.dataset.grim), a.textContent.trim()); } catch (_) { /* bad link */ } return; }
        if (a.classList.contains('tag-wiki-link') && a.dataset.tagName) { openLocal({ kind: 'wiki', tag: a.dataset.tagName }); return; }
        if (a.dataset.wikiSite && a.dataset.wikiPage) { openLocal({ kind: 'doc', site: a.dataset.wikiSite, page: a.dataset.wikiPage }, a.textContent.trim()); return; }
        if (a.dataset.url) { navigate(a.dataset.url, a.textContent.trim()); return; }
        const href = (a.getAttribute('href') || '').trim();
        if (href.startsWith('#')) { scrollToAnchor(href.slice(1)); return; }
        if (!href) return;
        let abs = href;
        try { abs = new URL(href, location.href).href; } catch (_) { /* as is */ }
        if (/^(edtx|rdf):/i.test(href)) navigate(href, a.textContent.trim());
        else if (webUrl(abs) && new URL(abs).origin !== location.origin) navigate(abs, a.textContent.trim());
    }

    // ---------------------------------------------------------------- Dreamscape apps

    /**
     * Dreamscape apps (DSAP applets, dsapRegistry.js) run here with the desktop's own code: the entry
     * is resolved (resolveDsap), its scripts load (ensureDsapEntryReady), and activateDsapOnShell
     * draws it into IE's page and starts its driver, the way the desktop Grimoire
     * (tagWikiSearchModal.js navigateDsapIfMatched) does. dsapShell is the part of the Grimoire window
     * the applets use: displayArea, the address (setAddress), history (addToHistory, from
     * host.setUrl as the applet moves between its own pages), navigate (host.navigate: links to
     * other applets, Grimoire pages and web pages stay in IE). Only the container and the styling
     * (wm-dsap.css) are the phone's. The applet runs while its page is on screen; another page, or IE
     * behind another app for a minute, stops it (deactivateDsapOnShell), and it starts again from
     * its address. Addresses with no applet behind them (or a Grimoire domain with no phone page)
     * get a WM notification.
     */

    const dsapApi = () => typeof window.resolveDsap === 'function' && typeof window.activateDsapOnShell === 'function';

    /** A Dreamscape app's address: dsap: anything, or a bare registered applet address (data.dreamscape.jp/...). */
    function dsapAddress(raw) {
        const text = String(raw || '').trim();
        if (!text || !dsapApi()) return false;
        if (/^dsap:/i.test(text)) return true;
        if (/^[a-z][a-z0-9+.-]*:/i.test(text) || /\s/.test(text)) return false;
        let m = null;
        try { m = window.resolveDsap(text); } catch (_) { m = null; }
        return !!(m && !(typeof window.isDsapShimEntry === 'function' && window.isDsapShimEntry(m.entry)));
    }

    /** An address IE cannot show on the phone: a WM notification (no page change). */
    function cannotOpen(raw) {
        if (!ws) return;
        const address = String(raw || '').trim();
        const text = /^dsap:/i.test(address) || dsapAddress(address)
            ? `Internet Explorer cannot find ${address}. There is no Dreamscape app at this address.`
            : `Internet Explorer cannot open ${address} on this phone.`;
        ws.notify({ title: 'Internet Explorer', icon: 'warning', text });
    }

    function openDsap(raw, title) {
        closeSub();
        let m = null;
        try { m = dsapApi() ? window.resolveDsap(raw) : null; } catch (_) { m = null; }
        if (!m) { cannotOpen(raw); return; }
        if (typeof window.isDsapShimEntry === 'function' && window.isDsapShimEntry(m.entry)) {
            // a Grimoire domain written as dsap: (dsap://en.grimoire.jp/search?q=...): its phone page if it has one
            const g = parseGrim('edtx://' + m.normalized) || parseGrim('rdf://' + m.normalized);
            if (g) openLocal(g, title);
            else if (coreAddress(m.normalized)) openCore(m.normalized, title);
            else cannotOpen(raw);
            return;
        }
        const cur = entry();
        if (cur.home && cur.grim.kind === 'dsap' && cur.url === m.canonicalUrl) {
            // already on it: shown again (started again if it was stopped)
            if (W.dsapShown !== cur) render();
            return;
        }
        pushLocal({ home: true, grim: { kind: 'dsap' }, url: m.canonicalUrl, title: title || m.entry.title || m.displayPath });
    }

    function dsapNote(text) {
        els.dsapArea.innerHTML = `<div class="wmb-g-note">${esc(text)}</div>`;
    }

    /** Start the entry's applet on screen (again with force: Refresh). */
    function renderDsap(e, force) {
        if (!force && W.dsapShown === e && W.dsapShell._dsapActive) return;
        const w = W;
        const seq = ++W.dsapLoadSeq;
        let m = null;
        try { m = window.resolveDsap(e.url); } catch (_) { m = null; }
        if (!m) { leaveDsap(); dsapNote(`There is no Dreamscape app at ${e.url}.`); return; }
        // IE's busy ring while the applet's scripts load and it draws (a page load, not a wait cursor)
        setGrimLoading(true);
        const paint = () => (ws && typeof ws.afterPaint === 'function' ? ws.afterPaint() : Promise.resolve());
        Promise.resolve(window.ensureDsapEntryReady(m.entry)).then((ok) => paint().then(() => ok)).then((ok) => inWin(w, () => {
            if (seq !== W.dsapLoadSeq || entry() !== e) return;
            if (!ok) throw new Error('load');
            W.dsapShown = e;
            W.dsapAddrMove = null;
            W.dsapActivating = true;
            let done = false;
            try { done = window.activateDsapOnShell(W.dsapShell, e.url, { force: true }); } finally { W.dsapActivating = false; }
            if (!done) throw new Error('activate');
            // DSAP-SMF applets take WM's white form (wm-dsap.css), not the desktop's grey page
            const root = W.dsapShell._dsapState && W.dsapShell._dsapState.rootEl;
            if (root && root.classList.contains('dsap-smf')) els.dsap.style.backgroundColor = '';
            els.dsap.scrollTop = 0;
            renderAddress();
            noteHistory(e.url, e.title);
        })).catch((err) => inWin(w, () => {
            if (seq !== W.dsapLoadSeq || entry() !== e) return;
            console.warn('[wmBrowser] dsap', e.url, err);
            leaveDsap();
            setGrimLoading(false);
            dsapNote('The page cannot be displayed. The Dreamscape app did not start; try Refresh.');
        })).finally(() => inWin(w, () => {
            if (seq === W.dsapLoadSeq) setGrimLoading(false);
        }));
    }

    /** Stop the applet (another page shows, or IE stayed behind another app). */
    function leaveDsap() {
        W.dsapLoadSeq++;
        W.dsapAddrMove = null;
        clearTimeout(W.dsapIdleTimer);
        W.dsapIdleTimer = 0;
        if (W.dsapShell && W.dsapShell._dsapState) {
            try { window.deactivateDsapOnShell(W.dsapShell); } catch (err) { console.warn('[wmBrowser] dsap stop', err); }
        }
        if (!W.dom) { W.dsapShown = null; return; }
        if (W.dsapShown || els.dsapArea.childElementCount) els.dsapArea.innerHTML = '';
        els.dsap.style.backgroundColor = '';
        W.dsapShown = null;
    }

    /** The Grimoire window's surface as the applets use it (dsapRegistry.js createDsapHost / activateDsapOnShell):
     *  one per IE window (makeDsapShell), each call reaching its own window. */
    const dsapShellProto = {
        displayArea: null,
        searchBody: null,
        _dsapState: null,
        _dsapActive: false,
        setAddress(o) {
            const url = String((o && (o.displayUrl || o.url)) || '').trim();
            if (!url || !W.dsapShown) return;
            if (!W.dsapActivating && url !== W.dsapShown.url) W.dsapAddrMove = { from: W.dsapShown.url, to: url };
            W.dsapShown.url = url;
            if (entry() === W.dsapShown) renderAddress();
        },
        addToHistory(h) {
            const url = String((h && h.url) || '').trim();
            if (!url || !W.dsapShown) return;
            const move = W.dsapAddrMove;
            W.dsapAddrMove = null;
            if (W.dsapActivating || entry() !== W.dsapShown) { W.dsapShown.url = url; return; }
            // the applet went to another of its pages (host.setUrl): a new IE entry with the same running applet
            if (move && move.to === url) W.dsapShown.url = move.from;
            if (W.dsapShown.url === url) return;
            const next = { home: true, grim: { kind: 'dsap' }, url, title: (h && h.title) || W.dsapShown.title };
            W.entries = W.entries.slice(0, W.idx + 1);
            W.entries.push(next);
            W.idx = W.entries.length - 1;
            W.dsapShown = next;
            noteHistory(url, next.title);
            renderAddress();
            step();
        },
        updateNavigationButtons() { step(); },
        navigate(url) { navigate(String(url || '').trim()); },
        setNavigationLoading(on) { setGrimLoading(on); },
        showGrimoireNavigationLoadingPage() { /* IE's busy ring */ },
        showGrimoireNavigateErrorPage() { dsapNote('The page cannot be displayed.'); },
        showStaticWikiSiteIndex(id) { if (id) openLocal({ kind: 'site', site: String(id) }); },
        // links are caught once on the page (onDsapClick)
        _interceptAllLinks() { /* onDsapClick */ }
    };

    function makeDsapShell(w) {
        const shell = { displayArea: w.dom.dsapArea, searchBody: null, _dsapState: null, _dsapActive: false };
        for (const k of Object.keys(dsapShellProto)) {
            const fn = dsapShellProto[k];
            if (typeof fn === 'function') shell[k] = function () { const a = arguments; return inWin(w, () => fn.apply(shell, a)); };
        }
        return shell;
    }

    /** Links in an applet: other applets, Grimoire pages and web pages open in IE; anchors scroll the page. */
    function onDsapClick(e) {
        if (e.defaultPrevented) return;
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a || !els.dsap.contains(a) || a.hasAttribute('download')) return;
        const href = (a.getAttribute('href') || '').trim();
        if (!href || /^javascript:/i.test(href)) return;
        const label = a.textContent.replace(/\s+/g, ' ').trim();
        if (href.startsWith('#')) {
            e.preventDefault();
            let target = null;
            try { target = href.length > 1 && els.dsap.querySelector('#' + CSS.escape(href.slice(1))); } catch (_) { target = null; }
            if (target) els.dsap.scrollTop += target.getBoundingClientRect().top - els.dsap.getBoundingClientRect().top;
            else els.dsap.scrollTop = 0;
            return;
        }
        if (a.classList.contains('tag-wiki-link') && a.dataset.tagName && !a.dataset.tagName.startsWith('#')) {
            e.preventDefault();
            openLocal({ kind: 'wiki', tag: a.dataset.tagName });
            return;
        }
        if (/^(edtx|rdf|dsap):/i.test(href) || dsapAddress(href)) { e.preventDefault(); navigate(href, label); return; }
        let abs = null;
        try { abs = new URL(href, location.href); } catch (_) { return; }
        if ((abs.protocol === 'http:' || abs.protocol === 'https:') && abs.origin !== location.origin) {
            e.preventDefault();
            navigate(abs.href, label);
        }
        // same-origin links (a picture, a file) keep their own behaviour
    }

    /** Tap-and-hold in an applet: the applet's own context menu items (host.registerContextMenuItems) as a WM menu. */
    function onDsapContextMenu(e) {
        const host = W.dsapShell && W.dsapShell._dsapState && W.dsapShell._dsapState.host;
        if (!host || typeof window.collectDsapHostContextMenuItems !== 'function') return;
        let items = [];
        try { items = window.collectDsapHostContextMenuItems(host, e.target).items || []; } catch (_) { items = []; }
        const el = e.target;
        const list = [];
        items.forEach((it) => {
            if (!it || it.separator || it.type === 'separator') { if (list.length && list[list.length - 1] !== '-') list.push('-'); return; }
            const label = String(it.text || it.label || '').trim();
            if (!label) return;
            let disabled = false;
            try { disabled = typeof it.disabled === 'function' ? !!it.disabled() : !!it.disabled; } catch (_) { disabled = false; }
            list.push({
                label,
                disabled,
                action: () => {
                    if (typeof it.action === 'function') it.action(el, it);
                    else window.dispatchDsapContextMenuAction(host, it.action, it, el);
                }
            });
        });
        while (list.length && list[list.length - 1] === '-') list.pop();
        if (!list.length) return;
        e.preventDefault();
        ws.menuAt(e.clientX, e.clientY, list);
    }

    // ---------------------------------------------------------------- Fandom and the Apocrypha

    /**
     * Fandom (rdf://wiki.fandom.jp/, /?all=1, /<site>/<page>) and the Apocrypha
     * (rdf://apocrypha.737.jp.net/, /archive/<issue>) are drawn here by the desktop Grimoire's own
     * renderers: the Grimoire feature loads (tagWikiSearchModal.js), and the address's registry entry
     * (grimoireCoreDomains.js) activates on a phone pane, a WikiDisplayBase whose display area is a
     * box in IE's page, the way the desktop activates it on a Grimoire window. The pane is the part
     * of the window those renderers use: displayArea, setAddress (the real address goes to IE's
     * address bar), addToHistory (the page's title), navigate. Every link on these pages is caught
     * before the desktop's own handlers (onCoreClick) and opens as an IE page, so Back, Forward,
     * History and Favorites work. Each page keeps its own pane and box: Back shows it as it was left.
     * IE's busy ring turns while a renderer is out; the desktop's in-page "Loading..." is hidden
     * (wm-browser.css). The pages keep their own look (the Apocrypha's dark zine) in one column.
     */
    const CORE_RE = /^(?:(?:rdf|edtx|dsap):\/\/)?(?:wiki\.fandom\.jp|fandom\.grimoire\.jp|en\.grimoire\.jp\/fandom|apocrypha\.737\.jp\.net)(?:[/?#]|$)/i;
    let PhonePane = null;

    /** Fandom or the Apocrypha (a bare host only with a scheme or the exact registered host). */
    function coreAddress(raw) {
        const text = String(raw || '').trim();
        return !!text && !/\s/.test(text) && CORE_RE.test(text);
    }

    function fandomUrl(site, page) {
        return `rdf://wiki.fandom.jp/${site}/${page}`;
    }

    function openCore(raw, title) {
        closeSub();
        const url = 'rdf://' + String(raw).trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
        const cur = entry();
        if (cur.home && cur.grim.kind === 'core' && cur.url === url) { render(); return; }
        pushLocal({ home: true, grim: { kind: 'core' }, url, title: title || '' });
    }

    /** The phone pane class (WikiDisplayBase exists once the Grimoire feature has loaded). */
    function phonePaneClass() {
        if (PhonePane) return PhonePane;
        /* global WikiDisplayBase */
        if (typeof WikiDisplayBase !== 'function') return null;
        PhonePane = class extends WikiDisplayBase {
            constructor(e, area) {
                super();
                this._w = W;
                this._ie = e;
                this.displayArea = area;
                this._loads = 0;
                this.history = [];
                this.historyIndex = -1;
            }
            isStandaloneWindow() { return true; }
            setAddress(o) {
                const url = String((o && (o.displayUrl || o.fullUrl)) || '').trim();
                if (!url) return;
                this._ie.url = url;
                inWin(this._w, () => { if (entry() === this._ie) renderAddress(); });
            }
            addToHistory(h) {
                // IE keeps the history: the renderer's entry only names the page
                if (!h) return;
                const title = h.type === 'apocrypha' ? 'Apocrypha' : (h.title || h.siteName || '');
                if (title) this._ie.title = String(title);
                noteHistory(this._ie.url, this._ie.title);
            }
            updateNavigationButtons() { inWin(this._w, step); }
            navigate(url) { inWin(this._w, () => navigate(String(url || '').trim())); }
            goBack() { inWin(this._w, goBack); }
            setNavigationLoading() { /* _track turns IE's busy ring */ }
            showGrimoireNavigationLoadingPage() { /* IE's busy ring */ }
            showGrimoireNavigateErrorPage() { this.displayArea.innerHTML = '<div class="wmb-g-note">The page cannot be displayed.</div>'; }
            showStaticWikiSiteIndex(id) { if (id) inWin(this._w, () => openLocal({ kind: 'site', site: String(id) })); }
            getTagWikiPageDirectly(name) { if (name) inWin(this._w, () => openLocal({ kind: 'wiki', tag: String(name) })); }
            _track(p) {
                this._loads++;
                this._sync();
                return Promise.resolve(p).finally(() => { this._loads--; this._sync(); });
            }
            _sync() { inWin(this._w, () => { if (W.coreShown === this._ie && entry() === this._ie) setGrimLoading(this._loads > 0); }); }
            showApocryphaZine(o) { return this._track(super.showApocryphaZine(o)); }
            showFandomWikiIndex(o) { return this._track(super.showFandomWikiIndex(o)); }
            openStaticWikiPage(site, page, o) { return this._track(super.openStaticWikiPage(site, page, o)); }
        };
        return PhonePane;
    }

    let grimFeature = null;
    function loadGrimFeature() {
        if (typeof WikiDisplayBase === 'function') return Promise.resolve(true);
        const fl = window.featureLoader;
        if (!fl || typeof fl.loadFeature !== 'function') return Promise.resolve(false);
        if (!grimFeature) grimFeature = Promise.resolve(fl.loadFeature('grimoire')).catch(() => false).finally(() => { if (typeof WikiDisplayBase !== 'function') grimFeature = null; });
        return grimFeature;
    }

    /** Show the entry's page (again from the server with force: Refresh). */
    function renderCore(e, force) {
        if (!force && W.coreShown === e && e.area && e.area.parentNode === els.core) return;
        W.coreShown = e;
        if (e.area && e.pane && !force) {
            // Back / Forward: the page as it was left, its scroll too
            els.core.replaceChildren(e.area);
            els.core.scrollTop = e.scroll || 0;
            setGrimLoading(e.pane._loads > 0);
            return;
        }
        if (force && e.pane && e.pane.currentStaticWiki) {
            // wikiPageCache: tagWikiSearchModal.js (the desktop's page cache would answer Refresh)
            try { /* global wikiPageCache */ wikiPageCache.invalidate(wikiPageCache.staticKey(e.pane.currentStaticWiki.siteId, e.pane.currentStaticWiki.pageId)); } catch (_) { /* no cache */ }
        }
        const area = document.createElement('div');
        area.className = 'wmb-core-area';
        e.area = area;
        e.pane = null;
        e.scroll = 0;
        els.core.replaceChildren(area);
        els.core.scrollTop = 0;
        const w = W;
        const fail = (text) => inWin(w, () => {
            if (e.area !== area) return;
            area.innerHTML = `<div class="wmb-g-note">${esc(text)}</div>`;
            if (W.coreShown === e && entry() === e) setGrimLoading(false);
        });
        const ws_ = window.wsClient;
        if (!ws_ || !ws_.isConnected || !ws_.isConnected()) { fail('The page cannot be reached: this phone is not connected to Dreamscape. Try again later.'); return; }
        setGrimLoading(true);
        loadGrimFeature().then(() => {
            if (e.area !== area) return;
            const Pane = phonePaneClass();
            let m = null;
            try { m = dsapApi() ? window.resolveDsap(e.url) : null; } catch (_) { m = null; }
            if (!Pane || !m || !m.entry || typeof m.entry.activate !== 'function') { fail('The page cannot be displayed.'); return; }
            inWin(w, () => {
                const pane = new Pane(e, area);
                e.pane = pane;
                pane._track(null); // the ring stays until a renderer has started
                try { m.entry.activate(pane, m); } catch (err) { console.warn('[wmBrowser] core page', e.url, err); fail('The page cannot be displayed.'); }
            });
        }).catch((err) => { console.warn('[wmBrowser] core page', e.url, err); fail('The page cannot be displayed.'); });
    }

    function coreScrollTo(id) {
        let target = null;
        try {
            target = id && (els.core.querySelector('#' + CSS.escape(id)) || els.core.querySelector(`[name="${CSS.escape(id)}"]`));
        } catch (_) { target = null; }
        if (target) els.core.scrollTop += target.getBoundingClientRect().top - els.core.getBoundingClientRect().top;
        else if (!id) els.core.scrollTop = 0;
    }

    /** Taps on Fandom / Apocrypha pages, before the desktop's own handlers: every page opens in IE. */
    function onCoreClick(e) {
        const t = e.target;
        if (!t || !t.closest) return;
        const swallow = () => { e.preventDefault(); e.stopPropagation(); };
        const view = t.closest('[data-fandom-index-view]');
        if (view && els.core.contains(view)) {
            swallow();
            navigate(view.getAttribute('data-fandom-index-view') === 'all' ? FANDOM_HOME + '?all=1' : FANDOM_HOME, 'Fandom Wikis');
            return;
        }
        if (t.closest('[data-action="open-fandom-wiki-import"]')) { swallow(); navigate('dsap://wiki.dyna.dreamscape.jp/import'); return; }
        const a = t.closest('a');
        if (!a || !els.core.contains(a)) return;
        swallow();
        const label = a.textContent.replace(/\s+/g, ' ').trim();
        const href = (a.getAttribute('href') || '').trim();
        if (a.dataset.wikiSite && a.dataset.wikiPage) { navigate(fandomUrl(a.dataset.wikiSite, a.dataset.wikiPage), label); return; }
        if (a.classList.contains('tag-wiki-link') && a.dataset.tagName && !a.dataset.tagName.startsWith('#')) { openLocal({ kind: 'wiki', tag: a.dataset.tagName }); return; }
        if (href.startsWith('#')) { coreScrollTo(href.slice(1)); return; }
        if (!href || /^javascript:/i.test(href)) return;
        if (/^(edtx|rdf|dsap):/i.test(href) || coreAddress(href) || dsapAddress(href)) { navigate(href, label); return; }
        let abs = null;
        try { abs = new URL(href, location.href); } catch (_) { return; }
        // same-origin links (a picture saved with a wiki page) would leave the phone's shell: the picture is on the page already
        if (abs.origin === location.origin) return;
        if (abs.protocol === 'http:' || abs.protocol === 'https:') navigate(abs.href, label);
    }

    // ---------------------------------------------------------------- 6.5
    // Melaton Mobile 6.5 (#741): Internet Explorer Mobile 6 as Windows Mobile 6.5 Professional ships it.
    // Measured on the Device Emulator (VGA; captures in ~/.cache/claude-run/wm65apps/ie/emu):
    //   page       full screen; the title bar, the address bar (56 px + a 2 px black rule under the
    //              title bar) and the bottom bar lie over it and go away about 7 s after they came
    //              (BARS65_MS); a round button at the bottom right (x 390, y 550) brings them back.
    //              No soft keys on the page. While a page loads with the bars away the address bar
    //              alone stays at the top.
    //   bottom bar five 90 px round buttons at x 3 + 96 n, y 550 (browsres.192.dll bitmap 4599:
    //              back, favorites, keyboard, zoom, menu, each with its pressed cell) over a 30 px
    //              grey band (198, 195, 198)
    //   menu       Home Page, History, Forward, Refresh, View > (Text Size >, Mobile, Desktop),
    //              Tools > (Send Link..., Properties, Options), Copy/Paste > (Make Selection, Paste),
    //              Exit; its bottom line 109 px above the screen's bottom, 34 px from the right
    //   zoom       an 84 x 380 px slider (bitmaps 4600 to 4602) 20 px from the right, centred, drawn
    //              at 74 %; the address bar is away while it shows; gone 1 to 2 s after the last touch
    //   Favorites  27 px rows, the first chosen, a tap opens; bar (bitmap 4604): back, add, add
    //              folder, edit, delete. History: two-line rows, Open / Cancel. Options: a list
    //              (Open / Close) of pages (Done / Cancel). Properties: a page with Close.
    // 6.1's menu here: Back = bar button; Forward, Home (Home Page), Refresh, History = menu;
    // Add to Favorites = the + of Favorites and the page's tap-and-hold menu; View One Column /
    // Desktop = View > Mobile / Desktop (and Options > Other); Default (a page half again as wide)
    // = the zoom slider at 67 %; Full Screen = the bars' own coming and going; Zoom = View > Text
    // Size; Tools > Copy Link = Send Link... (a new message with the link; the clipboard when
    // Messaging is not there); Paste = Copy/Paste; Clear History = Options > Browsing History >
    // Clear; Properties = Tools.

    const SUB65_TITLES = { favorites: 'Favorites', history: 'History', options: 'Options', 'opt-history': 'Browsing History', 'opt-other': 'Other', props: 'Properties' };
    const OPTIONS65 = [['opt-history', 'Browsing History'], ['opt-other', 'Other']];

    function title65() {
        if (sub === 'favform') return subData65 && subData65.at >= 0 ? 'Edit Favorite' : 'Add Favorite';
        if (sub) return SUB65_TITLES[sub] || 'Internet Explorer';
        return entry().title || 'Internet Explorer';
    }

    /** An edit field of the page has the keyboard: the soft-key bar (with the input panel button) shows. */
    function kbd65() {
        const a = document.activeElement;
        if (!a || !page || a === els.addr || !page.contains(a)) return false;
        if (a === els.ime || a.isContentEditable) return true;
        if (a.tagName === 'TEXTAREA') return true;
        return a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|file|color|image)$/i.test(a.type || '');
    }

    function menuOpen65() {
        const pop = document.querySelector('#wmShell .wm-popup');
        return !!pop && !pop.hidden;
    }

    /** html[data-wm-ie65]: bars | bare | kbd (page), fav (Favorites: its own bar), sub (pages with soft keys). */
    function chrome65() {
        if (!v65 || !page || W !== cur) return;
        const root = document.documentElement;
        if (!visible) { if (root.dataset.wmIe65) delete root.dataset.wmIe65; return; }
        const st = sub ? (sub === 'favorites' ? 'fav' : 'sub') : kbd65() ? 'kbd' : bars65 ? 'bars' : 'bare';
        if (root.dataset.wmIe65 !== st) root.dataset.wmIe65 = st;
        if (ws && isCurrent()) ws.setTitle(title65());
        const back = els.bar65 && els.bar65.querySelector('[data-act="back"]');
        if (back) back.disabled = W.idx < 1;
    }

    function armBars65() {
        clearTimeout(barsTimer65);
        barsTimer65 = setTimeout(() => {
            barsTimer65 = 0;
            if (!visible || sub || !bars65) return;
            // in use: the wait starts over
            if (addrEditing || zoomOpen65 || menuOpen65() || kbd65()) { armBars65(); return; }
            bars65 = false;
            chrome65();
        }, BARS65_MS);
    }

    function showBars65() {
        bars65 = true;
        chrome65();
        armBars65();
    }

    // zoom: the slider's place p (0 at the bottom, 1 at the top) and the page's scale; 100 % at the
    // thumb's rest place, 50 % at the bottom, 400 % at the top
    const zoomOfP65 = (p) => (p <= ZOOM65_REST ? 0.5 * Math.pow(2, p / ZOOM65_REST) : Math.pow(4, (p - ZOOM65_REST) / (1 - ZOOM65_REST)));
    const pOfZoom65 = (z) => (z <= 1 ? ZOOM65_REST * Math.log2(z / 0.5) : ZOOM65_REST + (1 - ZOOM65_REST) * Math.log(z) / Math.log(4));
    let zoomLayout65 = 0;

    function applyZoom65() {
        if (!v65 || !els.home) return;
        const z = pageZoom65 === 1 ? '' : String(Math.round(pageZoom65 * 100) / 100);
        for (const w of wins) if (w.dom) for (const el of [w.dom.home, w.dom.gpage, w.dom.core, w.dom.dsapArea]) el.style.zoom = z;
        if (els.zthumb65) els.zthumb65.style.top = `calc(${Math.round((1 - pOfZoom65(pageZoom65)) * 1060) / 10} * var(--wm-px))`;
        // Alchemy's page follows shortly after (a new viewport each time is a new layout over there)
        clearTimeout(zoomLayout65);
        zoomLayout65 = setTimeout(layoutFrame, 150);
    }

    function setZoom65(z) {
        pageZoom65 = Math.max(0.5, Math.min(4, z));
        try { localStorage.setItem(ZOOM65_KEY, String(Math.round(pageZoom65 * 1000) / 1000)); } catch (_) { /* storage off */ }
        applyZoom65();
    }

    function armZoom65() {
        clearTimeout(zoomTimer65);
        zoomTimer65 = setTimeout(closeZoom65, ZOOM65_MS);
    }

    function openZoom65() {
        if (!v65 || sub) return;
        zoomOpen65 = true;
        els.zoom65.hidden = false;
        page.classList.add('is-zooming');
        applyZoom65();
        armZoom65();
    }

    function closeZoom65() {
        clearTimeout(zoomTimer65);
        zoomTimer65 = 0;
        if (!zoomOpen65) return;
        zoomOpen65 = false;
        els.zoom65.hidden = true;
        page.classList.remove('is-zooming');
        if (bars65) armBars65();
    }

    function sendLink65() {
        const e = entry();
        if (typeof window.wmMessagingCompose === 'function') window.wmMessagingCompose({ subject: e.title || '', body: e.url || '' });
        else copyText(e.url);
    }

    function mainMenu65() {
        return [
            { label: 'Home Page', action: goHome },
            { label: 'History', action: () => openSub('history') },
            { label: 'Forward', disabled: W.idx >= W.entries.length - 1, action: goForward },
            { label: 'Refresh', action: refresh },
            // after Refresh, before View; the device draws no rules in this menu
            ...windowItems(),
            {
                label: 'View',
                submenu: [
                    { label: 'Text Size', submenu: ZOOMS.map(([k, label]) => ({ label, radio: zoomKey === k, action: () => setZoom(k) })) },
                    '-',
                    { label: 'Mobile', checked: viewMode === 'column', action: () => setView('column') },
                    { label: 'Desktop', checked: viewMode === 'desktop', action: () => setView('desktop') }
                ]
            },
            {
                label: 'Tools',
                submenu: [
                    { label: 'Send Link...', action: sendLink65 },
                    { label: 'Properties', action: properties },
                    { label: 'Options', action: () => openSub('options') }
                ]
            },
            {
                label: 'Copy/Paste',
                submenu: [
                    { label: 'Make Selection', disabled: true },
                    { label: 'Paste', disabled: onHome() || !W.frame, action: pasteFromClipboard }
                ]
            },
            // as the title bar's X
            { label: 'Exit', action: () => { const x = document.querySelector('#wmShell .wm-title-action[data-kind="close"]'); if (x) x.click(); } }
        ];
    }

    function openMenu65(btn) {
        ws.menu('right', mainMenu65(), btn);
        const pop = document.querySelector('#wmShell .wm-popup');
        // device: the menu's bottom line is 109 px above the bottom of the screen (over the bar's buttons)
        if (pop && !pop.hidden) {
            pop.style.bottom = 'calc(var(--wm-safe-bottom, 0px) + 54.5 * var(--wm-px))';
            // with the window rows (#748) the menu has 11 rows: on a screen as short as the device's it
            // scrolls between the shell's arrow bars, and its top stays where the shell puts a long
            // menu's (5.5 px under the screen's top), 29 px less room than over the soft keys
            pop.style.maxHeight = 'calc(100% - var(--wm-safe-top, 0px) - var(--wm-safe-bottom, 0px) - 60 * var(--wm-px))';
        }
    }

    function softKeys65() {
        const none = { left: null, right: null };
        if (!sub || sub === 'favorites') return none;
        if (sub === 'history') {
            return {
                left: { label: 'Open', disabled: !subRows()[subSel], action: () => openSubRow(subSel) },
                right: { label: 'Cancel', action: closeSub }
            };
        }
        if (sub === 'options') return { left: { label: 'Open', action: () => openSub(OPTIONS65[subSel] ? OPTIONS65[subSel][0] : 'options') }, right: { label: 'Close', action: closeSub } };
        if (sub === 'opt-history') return { left: { label: 'Done', action: () => subDone65(true) }, right: { label: 'Clear', action: clearHistory } };
        if (sub === 'opt-other') return { left: { label: 'Done', action: () => subDone65(true) }, right: { label: 'Cancel', action: () => subDone65(false) } };
        if (sub === 'props') return { left: { label: 'Close', action: closeSub }, right: null };
        if (sub === 'favform') return { left: { label: subData65 && subData65.at >= 0 ? 'OK' : 'Add', action: () => subDone65(true) }, right: { label: 'Cancel', action: () => subDone65(false) } };
        return none;
    }

    /** ok / Done (true) or Cancel / the back key (false) on the page on screen. */
    function subDone65(ok) {
        if (sub === 'opt-history') { openSub('options'); return; }
        if (sub === 'opt-other') {
            const on = ok && els.sub.querySelector('input[name="wmb65-as"]:checked');
            if (on) setView(on.value);
            openSub('options');
            subSel = 1;
            renderSub();
            return;
        }
        if (sub === 'favform') {
            if (ok) saveFavForm65();
            else leaveFavForm65();
            return;
        }
        closeSub();
    }

    function openFavForm65(data) {
        subData65 = Object.assign({ from: sub === 'favorites' ? 'favorites' : null, sel: subSel }, data);
        if (ws) ws.closeMenus();
        sub = 'favform';
        renderSub();
        syncPageShown();
        step();
        const name = els.sub.querySelector('[data-f="title"]');
        if (name) { name.focus({ preventScroll: true }); name.select(); }
    }

    function leaveFavForm65() {
        const d = subData65;
        subData65 = null;
        if (d && d.from === 'favorites') { openSub('favorites'); subSel = Math.max(0, Math.min(d.sel, favorites.length - 1)); renderSub(); }
        else closeSub();
    }

    async function saveFavForm65() {
        const d = subData65;
        if (!d) return;
        const title = els.sub.querySelector('[data-f="title"]').value.trim();
        const url = els.sub.querySelector('[data-f="url"]').value.trim();
        if (!url) { els.sub.querySelector('[data-f="url"]').focus(); return; }
        let next;
        if (d.at >= 0 && favorites[d.at]) {
            next = favorites.slice();
            next[d.at] = Object.assign({}, favorites[d.at], { url, title: title || hostOf(url) || url });
        } else {
            next = [{ url, title: title || hostOf(url) || url }].concat(favorites.filter((f) => f.url !== url));
        }
        try { await saveFavorites(next); } catch (_) {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'The favorite could not be saved.' });
            return;
        }
        leaveFavForm65();
    }

    function renderSub65() {
        page.classList.add('has-sub');
        els.sub.hidden = false;
        els.sub.dataset.kind = sub;
        const cell = (act, label, off) => `<button type="button" class="wmb65-btn" data-act="${act}" aria-label="${label}"${off ? ' disabled' : ''}></button>`;
        let html = '';
        if (sub === 'favorites' || sub === 'history') {
            const rows = subRows();
            if (subSel >= rows.length) subSel = rows.length - 1;
            if (subSel < 0 && rows.length) subSel = 0;
            const two = sub === 'history';
            html = `<div class="wmb-sub-list" role="listbox">${rows.map((r, i) => `
                <div class="wmb-sub-row${two ? ' wmb65-two' : ''}${i === subSel ? ' is-selected' : ''}" role="option" data-i="${i}">
                    ${two ? `<b>${esc(r.title)}</b><span>${esc(r.url)}</span>` : `${img(r.icon, 'wmb-sub-ico')}<span class="wmb-sub-title">${esc(r.title)}</span>`}
                </div>`).join('')}</div>`;
            if (sub === 'favorites') {
                const none = !rows.length;
                // add folder: Favorites here has no folders, the button shows its unavailable cell
                html += `<div class="wmb65-bar" data-bar="fav">${cell('fav-back', 'Back')}${cell('fav-add', 'Add Favorite')}${cell('fav-folder', 'Add Folder', true)}${cell('fav-edit', 'Edit', none)}${cell('fav-delete', 'Delete', none)}</div>`;
            }
        } else if (sub === 'options') {
            html = `<div class="wmb-sub-list" role="listbox">${OPTIONS65.map(([, label], i) => `<div class="wmb-sub-row wmb65-opt${i === subSel ? ' is-selected' : ''}" role="option" data-i="${i}"><b>${label}</b></div>`).join('')}</div>`;
        } else if (sub === 'opt-history') {
            let bytes = 0;
            try { bytes = (localStorage.getItem(HISTORY_KEY) || '').length; } catch (_) { bytes = 0; }
            if (!readList(HISTORY_KEY).length) bytes = 0;
            html = `<div class="wmb-sub-list" role="listbox"><div class="wmb-sub-row wmb65-two is-selected" role="option" data-i="0"><b>History</b><span>${bytes} bytes</span></div></div>`;
        } else if (sub === 'opt-other') {
            const radio = (v, label) => `<label class="wm-check"><input type="radio" name="wmb65-as" value="${v}"${(v === 'desktop') === (viewMode === 'desktop') ? ' checked' : ''}><span>${label}</span></label>`;
            html = `<div class="wmb65-form wmb65-other"><div class="wmb65-lbl">Browse websites as:</div>${radio('column', 'Mobile Device')}${radio('desktop', 'Desktop Computer')}</div>`;
        } else if (sub === 'props') {
            const e = entry();
            const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(e.url || '') || [])[1] || '';
            const proto = /^https$/i.test(scheme) ? 'HyperText Transfer Protocol with Privacy' : /^http$/i.test(scheme) ? 'HyperText Transfer Protocol' : scheme || 'Not Available';
            const fields = [
                ['Name:', e.title || (e.home ? 'Grimoire' : hostOf(e.url))],
                ['Address:', e.url || ''],
                ['Protocol:', proto],
                ['Encryption:', !e.home && /^https:/i.test(e.url || '') ? 'Secure (HTTPS)' : 'None'],
                ['Loaded by:', e.home ? (e.grim.kind === 'dsap' ? 'Dreamscape' : 'Grimoire') : 'Alchemy']
            ];
            html = `<div class="wmb65-props">${fields.map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('')}</div>`;
        } else if (sub === 'favform') {
            const d = subData65 || { url: '', title: '' };
            html = `<div class="wmb65-form">
                <label class="wmb65-lbl">Name:</label><input type="text" class="wm-edit" data-f="title" autocomplete="off" spellcheck="false" enterkeyhint="done" value="${esc(d.title)}" aria-label="Name">
                <label class="wmb65-lbl">Address (URL):</label><input type="url" class="wm-edit" data-f="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" value="${esc(d.url)}" aria-label="Address (URL)">
                <label class="wmb65-lbl">Folder:</label><button type="button" class="wm-combo" data-f="folder"><span>Favorites</span></button>
            </div>`;
        }
        els.sub.innerHTML = html;
        chrome65();
        if (isCurrent()) { ws.refreshSoftKeys(); ws.refreshTitleAction(); }
    }

    function subClick65(e) {
        const btn = e.target.closest('.wmb65-btn');
        if (btn) {
            if (btn.disabled) return;
            const act = btn.dataset.act;
            if (act === 'fav-back') closeSub();
            else if (act === 'fav-add') addFavorite();
            else if (act === 'fav-edit') renameFavorite(subSel);
            else if (act === 'fav-delete') deleteFavorite(subSel);
            return;
        }
        // Favorites here has no folders: the list holds Favorites alone
        const combo = e.target.closest('.wm-combo[data-f="folder"]');
        if (combo) { e.stopPropagation(); ws.dropdown(combo, [{ label: 'Favorites', radio: true, action: () => {} }], 'left'); return; }
        const row = e.target.closest('.wmb-sub-row');
        if (!row) return;
        subSel = Number(row.dataset.i);
        if (sub === 'favorites' || sub === 'history') openSubRow(subSel);
        else if (sub === 'options') openSub(OPTIONS65[subSel][0]);
    }

    function mount65() {
        const cell = (act, label) => `<button type="button" class="wmb65-btn" data-act="${act}" aria-label="${label}"></button>`;
        page.insertAdjacentHTML('beforeend', `
            <div class="wmb65-bar" data-bar="page">${cell('back', 'Back')}${cell('favorites', 'Favorites')}${cell('keyboard', 'Keyboard')}${cell('zoom', 'Zoom')}${cell('menu', 'Menu')}</div>
            <button type="button" class="wmb65-fs" aria-label="Show the bars"></button>
            <div class="wmb65-zoom" hidden>
                <button type="button" class="wmb65-zstep" data-step="1" aria-label="Zoom in"></button>
                <div class="wmb65-ztrack"><span class="wmb65-zthumb"></span></div>
                <button type="button" class="wmb65-zstep" data-step="-1" aria-label="Zoom out"></button>
            </div>`);
        els.bar65 = page.querySelector('.wmb65-bar[data-bar="page"]');
        els.fs65 = page.querySelector('.wmb65-fs');
        els.zoom65 = page.querySelector('.wmb65-zoom');
        els.ztrack65 = page.querySelector('.wmb65-ztrack');
        els.zthumb65 = page.querySelector('.wmb65-zthumb');

        let menuWasOpen = false;
        els.bar65.addEventListener('pointerdown', () => { menuWasOpen = menuOpen65(); }, true);
        els.bar65.addEventListener('click', (e) => {
            const btn = e.target.closest('.wmb65-btn');
            if (!btn || btn.disabled) return;
            const act = btn.dataset.act;
            armBars65();
            if (act !== 'zoom') closeZoom65();
            if (act === 'back') goBack();
            else if (act === 'favorites') openSub('favorites');
            else if (act === 'keyboard') {
                // the shell's input panel button: the page's text box (Alchemy) or the first edit box
                const sip = document.querySelector('#wmShell .wm-sip');
                if (sip) sip.click();
            } else if (act === 'zoom') {
                if (zoomOpen65) closeZoom65();
                else openZoom65();
            } else if (act === 'menu') {
                if (menuWasOpen) ws.closeMenus();
                else openMenu65(btn);
            }
        });
        els.fs65.addEventListener('click', showBars65);
        // a touch on the page puts the bars away
        els.view.addEventListener('pointerdown', () => {
            if (sub || !bars65 || zoomOpen65) return;
            bars65 = false;
            chrome65();
        }, true);
        page.addEventListener('focusin', chrome65);
        page.addEventListener('focusout', () => setTimeout(chrome65, 0));

        // the slider: drag the thumb (or the track), + and - step a tenth of the way
        let drag = null;
        const place = (e) => {
            const r = els.ztrack65.getBoundingClientRect();
            const thumb = r.height * 24 / 130;
            const p = 1 - (e.clientY - r.top - thumb / 2) / (r.height - thumb);
            setZoom65(zoomOfP65(Math.max(0, Math.min(1, p))));
        };
        els.ztrack65.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            drag = e.pointerId;
            try { els.ztrack65.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
            els.zthumb65.classList.add('is-drag');
            clearTimeout(zoomTimer65);
            place(e);
            e.preventDefault();
        });
        els.ztrack65.addEventListener('pointermove', (e) => { if (drag === e.pointerId) place(e); });
        const end = (e) => {
            if (drag !== e.pointerId) return;
            drag = null;
            els.zthumb65.classList.remove('is-drag');
            armZoom65();
        };
        els.ztrack65.addEventListener('pointerup', end);
        els.ztrack65.addEventListener('pointercancel', end);
        els.zoom65.addEventListener('click', (e) => {
            const s = e.target.closest('.wmb65-zstep');
            if (!s) return;
            setZoom65(zoomOfP65(Math.max(0, Math.min(1, pOfZoom65(pageZoom65) + 0.1 * Number(s.dataset.step)))));
            armZoom65();
        });
        els.zoom65.addEventListener('contextmenu', (e) => e.preventDefault());
        applyZoom65();
    }

    // ---------------------------------------------------------------- rendering

    function renderGoButton() {
        if (!els.go) return;
        const stopNow = W.loading && !onHome();
        els.go.innerHTML = img(stopNow ? 'ie-stop' : 'ie-go');
        els.go.setAttribute('aria-label', stopNow ? 'Stop' : 'Go');
    }

    function renderAddress() {
        if (!els.addr || addrEditing) return;
        const e = entry();
        els.addr.value = e.url || '';
        els.addr.placeholder = 'Enter a web address';
        const secure = !e.home && /^https:/i.test(e.url || '');
        els.lock.innerHTML = img(secure ? 'ie-lock' : 'ie-unlock');
        els.lock.title = secure ? 'Secure connection' : 'Not secure';
        renderGoButton();
    }

    function render() {
        if (!page) return;
        if (W !== cur) {
            // a window behind the one on screen draws nothing; an applet whose page moved on stops
            const e = entry();
            if (!(e.home && e.grim.kind === 'dsap')) leaveDsap();
            return;
        }
        const home = onHome();
        page.classList.toggle('on-home', home);
        page.classList.toggle('is-full', fullScreen && !v65);
        const start = home && entry().grim.kind === 'home';
        const app = home && entry().grim.kind === 'dsap';
        const core = home && entry().grim.kind === 'core';
        els.home.hidden = !start;
        els.gpage.hidden = !home || start || app || core;
        els.dsap.hidden = !app;
        els.core.hidden = !core;
        if (!core && W.coreShown) { els.core.replaceChildren(); W.coreShown = null; }
        page.classList.toggle('on-dsap', app);
        // another page on screen: the applet stops (its timers, socket listeners); Back starts it again
        if (!app) leaveDsap();
        els.frameWrap.hidden = home;
        if (!home || entry().grim.kind === 'home') W.grimLoading = false;
        page.classList.toggle('is-loading', (W.loading && !home) || (W.grimLoading && home));
        if (home) renderLocal(false);
        renderAddress();
        if (!home) requestAnimationFrame(layoutFrame);
        syncPageShown();
        chrome65();
    }

    function submitAddress() {
        const text = els.addr.value.trim();
        if (!text) return;
        const url = webUrl(text) || searchUrl(text);
        if (/^(edtx|rdf|dsap):/i.test(text) || dsapAddress(text)) {
            addrEditing = false;
            els.addr.blur();
            navigate(text);
            return;
        }
        if (webUrl(text)) noteTyped(url);
        addrEditing = false;
        els.addr.blur();
        navigate(url);
    }

    // ---------------------------------------------------------------- windows

    /** A window's own page boxes, in .wmb-view under the busy ring, Favorites / History and the text box. */
    function buildDom(w) {
        const t = document.createElement('template');
        t.innerHTML = `
                <div class="wmb-home" hidden>
                    <div class="wmb-logo wmb-g-logo">
                        <img class="wmb-logo-img" src="/static_images/app_icons/64/dreamscape-logo.webp" srcset="/static_images/app_icons/128/dreamscape-logo.webp 2x" alt="" draggable="false">
                        <div class="wmb-logo-text"><small>Dreamscape</small><b>The Grimoire</b><span class="wmb-g-tagline">The central home of Knowledge</span></div>
                    </div>
                    <form class="wmb-search" action="#">
                        <input type="search" class="wmb-search-input" autocomplete="off" enterkeyhint="search" placeholder="Search the Grim" aria-label="Search the Grimoire">
                        <button type="submit" class="wmb-search-go" aria-label="Search">${img('ie-search')}</button>
                    </form>
                    <button type="button" class="wmb-exp" data-exp="start" aria-expanded="true"><span>Starting Points</span>${img('ie-chevron', 'wmb-chev')}</button>
                    <div class="wmb-home-list" data-list="start"></div>
                    <button type="button" class="wmb-exp" data-exp="recent" aria-expanded="true"><span>Recently Visited</span>${img('ie-chevron', 'wmb-chev')}</button>
                    <div class="wmb-home-list" data-list="recent"></div>
                    <button type="button" class="wmb-exp" data-exp="favorites" aria-expanded="false"><span>Favorites</span>${img('ie-chevron', 'wmb-chev')}</button>
                    <div class="wmb-home-list" data-list="favorites" hidden></div>
                    <button type="button" class="wmb-exp" data-exp="history" aria-expanded="false"><span>History</span>${img('ie-chevron', 'wmb-chev')}</button>
                    <div class="wmb-home-list" data-list="history" hidden></div>
                </div>
                <div class="wmb-gpage" hidden></div>
                <div class="wmb-dsap form-section-scroll" hidden><div class="wmb-dsap-area"></div></div>
                <div class="wmb-core" hidden></div>
                <div class="wmb-frame-wrap" hidden>
                    <div class="wmb-touch"></div>
                </div>`;
        const q = (sel) => t.content.querySelector(sel);
        const d = { home: q('.wmb-home'), gpage: q('.wmb-gpage'), dsap: q('.wmb-dsap'), dsapArea: q('.wmb-dsap-area'), core: q('.wmb-core'), frameWrap: q('.wmb-frame-wrap'), touch: q('.wmb-touch') };
        w.dom = d;
        els.view.insertBefore(t.content, els.busy);
        w.dsapShell = makeDsapShell(w);
        // what the boxes hear is their own window's
        const on = (el, type, fn, opts) => el.addEventListener(type, (e) => inWin(w, () => fn(e)), opts);

        on(d.home.querySelector('.wmb-search'), 'submit', (e) => {
            e.preventDefault();
            const input = d.home.querySelector('.wmb-search-input');
            const q0 = input.value.trim();
            if (!q0) { input.focus(); return; }
            input.blur();
            if (webUrl(q0)) navigate(webUrl(q0));
            else openLocal({ kind: 'search', q: q0 });
            input.value = '';
        });
        on(d.home, 'click', (e) => {
            const exp = e.target.closest('.wmb-exp');
            if (exp) {
                exp.setAttribute('aria-expanded', exp.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
                if (exp.dataset.exp === 'favorites' && !favoritesLoaded) busyOf(loadSettings).then(() => inWin(w, renderHomeLists));
                renderHomeLists();
                return;
            }
            onLocalClick(e);
        });
        on(d.gpage, 'click', onLocalClick);
        on(d.gpage, 'scroll', () => { if (W.localShown && W.localShown === entry()) W.localShown.scroll = d.gpage.scrollTop; }, { passive: true });
        on(d.gpage, 'submit', (e) => {
            e.preventDefault();
            const input = e.target.querySelector('input');
            const q0 = input ? input.value.trim() : '';
            if (!q0) { if (input) input.focus(); return; }
            input.blur();
            openLocal({ kind: 'search', q: q0 });
        });

        on(d.dsap, 'click', onDsapClick);
        on(d.dsap, 'contextmenu', onDsapContextMenu);

        // capture: ahead of the desktop renderers' own link handlers and context menus
        on(d.core, 'click', onCoreClick, true);
        d.core.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
        on(d.core, 'scroll', () => { if (W.coreShown && W.coreShown === entry()) W.coreShown.scroll = d.core.scrollTop; }, { passive: true });

        on(d.touch, 'pointerdown', onTouchDown);
        on(d.touch, 'pointermove', onTouchMove);
        on(d.touch, 'pointerup', onTouchUp);
        on(d.touch, 'pointercancel', onTouchUp);
        on(d.touch, 'wheel', onWheel, { passive: false });
        d.touch.addEventListener('contextmenu', (e) => e.preventDefault());
        applyZoom65();
    }

    /** A window leaves for good: its Alchemy page, applet, timers and boxes go with it. */
    function disposeWin(w) {
        inWin(w, () => {
            clearTimeout(W.idleTimer);
            W.idleTimer = 0;
            leaveDsap();
            closeSession();
            // the pages it kept (a Grimoire page's HTML, a Fandom page's pane and box)
            W.entries.forEach((e) => { e.html = ''; e.area = null; e.pane = null; });
            W.localShown = null;
            W.coreShown = null;
        });
        w.closed = true;
        if (w.dom) { for (const k of WIN_BOXES) w.dom[k].remove(); w.dom = null; }
        w.dsapShell = null;
    }

    /** The applet of a window that is not on screen (another window shows, or IE is behind another app) stops after a wait. */
    function armDsapIdle() {
        const w = W;
        clearTimeout(w.dsapIdleTimer);
        w.dsapIdleTimer = 0;
        if (!w.dsapShown) return;
        w.dsapIdleTimer = setTimeout(() => inWin(w, () => { w.dsapIdleTimer = 0; if (!visible || W !== cur) leaveDsap(); }), visible ? WINDOW_IDLE_MS : IDLE_CLOSE_MS);
    }

    /** Show another window. Its page is as it was left: the boxes, the viewer and the applet were only hidden. */
    function switchTo(id) {
        const w = wins.find((x) => x.id === id && !x.closed);
        if (!w) return false;
        if (w === cur) return true;
        const old = cur;
        if (page) {
            // what is half done on the window on screen ends: a menu, Favorites / History, typing, a drag
            if (ws) ws.closeMenus();
            if (sub) { sub = null; subData65 = null; els.sub.hidden = true; page.classList.remove('has-sub'); }
            addrEditing = false;
            const a = document.activeElement;
            if (a && page.contains(a) && typeof a.blur === 'function') a.blur();
            stopFling();
            if (touch) { clearTimeout(touch.timer); touch = null; }
            wheelAcc = null;
            closeZoom65();
            if (old.dom) {
                old.scrolls = {};
                for (const k of ['home', 'gpage', 'dsap', 'core']) old.scrolls[k] = old.dom[k].scrollTop;
                for (const k of WIN_BOXES) old.dom[k].hidden = true;
            }
        }
        cur = w;
        W = w;
        w.shownAt = Date.now();
        if (!page) return true;
        // the window left behind falls silent; its page and applet are let go after WINDOW_IDLE_MS
        inWin(old, () => { clearTimeout(W.idleTimer); W.idleTimer = 0; syncPageShown(); armDsapIdle(); });
        clearTimeout(w.dsapIdleTimer);
        w.dsapIdleTimer = 0;
        // its web page was let go while it was behind: it comes back from its address
        if (visible && !onHome() && !W.session && !W.creating) { entry().pending = true; openSession(entry().url); }
        render();
        // a box that was hidden may come back at the top: where it was left
        if (w.scrolls) for (const k of Object.keys(w.scrolls)) if (w.dom[k].scrollTop !== w.scrolls[k]) w.dom[k].scrollTop = w.scrolls[k];
        if (v65 && visible) showBars65();
        step();
        return true;
    }

    /** Menu > New Window: a new window on the start page, on screen. Returns its id (null with MAX_WINDOWS open). */
    function newWindow() {
        if (wins.length >= MAX_WINDOWS) return null;
        const w = makeWin();
        wins.push(w);
        if (page) buildDom(w);
        switchTo(w.id);
        return w.id;
    }

    /** Menu > Close Window: the window on screen (or the one named) goes; the one before it in the list shows. */
    function closeWindow(id) {
        const w = id == null ? cur : wins.find((x) => x.id === id);
        if (!w || w.closed || wins.length < 2) return false;
        const at = wins.indexOf(w);
        if (w === cur) switchTo(wins[at > 0 ? at - 1 : 1].id);
        wins.splice(at, 1);
        disposeWin(w);
        return true;
    }

    /** An address of any kind IE shows, in the window W (false: not one). */
    function openAddress(url) {
        if (coreAddress(url)) { openCore(url); return true; }
        if (dsapAddress(url)) { openDsap(url); return true; }
        const u = webUrl(url);
        const g = u ? null : parseGrim(url);
        if (!u && !g) return false;
        if (u) navigate(u);
        else openLocal(g);
        return true;
    }

    let boundOnce = false;
    let viewObserver = null;

    function mount(p) {
        page = p;
        page.classList.add('wm-browser');
        page.innerHTML = `
            <div class="wmb-bar">
                <span class="wmb-lock" aria-hidden="true"></span>
                <div class="wmb-addr-box">
                    <input type="url" class="wmb-addr" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="Address">
                    <button type="button" class="wmb-addr-drop" aria-label="Recent addresses" aria-haspopup="menu"></button>
                </div>
                <button type="button" class="wmb-go" aria-label="Go"></button>
            </div>
            <div class="wmb-view">
                <div class="wmb-busy" aria-hidden="true"></div>
                <div class="wmb-sub" hidden></div>
                <textarea class="wmb-ime" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type into the page"></textarea>
            </div>`;
        els = {
            bar: page.querySelector('.wmb-bar'),
            lock: page.querySelector('.wmb-lock'),
            addr: page.querySelector('.wmb-addr'),
            drop: page.querySelector('.wmb-addr-drop'),
            go: page.querySelector('.wmb-go'),
            view: page.querySelector('.wmb-view'),
            busy: page.querySelector('.wmb-busy'),
            sub: page.querySelector('.wmb-sub'),
            ime: page.querySelector('.wmb-ime')
        };
        // the page boxes are the window's own (buildDom): els.home, els.gpage ... are those of W
        for (const k of WIN_BOXES.concat(['dsapArea', 'touch'])) Object.defineProperty(els, k, { enumerable: true, get: () => (W.dom ? W.dom[k] : null) });
        wins.forEach(buildDom);

        els.addr.addEventListener('focus', () => { addrEditing = true; setTimeout(() => els.addr.select(), 0); });
        els.addr.addEventListener('blur', () => { setTimeout(() => { addrEditing = false; renderAddress(); }, 150); });
        els.addr.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitAddress(); }
            if (e.key === 'Escape') { e.preventDefault(); addrEditing = false; els.addr.blur(); renderAddress(); }
        });
        els.go.addEventListener('click', () => {
            if (W.loading && !onHome() && !addrEditing) { stop(); return; }
            if (els.addr.value.trim()) submitAddress();
            else els.addr.focus();
        });
        els.drop.addEventListener('click', (e) => {
            e.stopPropagation();
            const typed = readList(TYPED_KEY);
            const items = typed.length ? typed.map((u) => ({ label: u, action: () => { els.addr.value = u; navigate(u); } })) : [{ label: '(Empty)', disabled: true }];
            ws.dropdown(els.addr.parentElement, items, 'left');
        });

        if (v65) mount65();

        els.sub.addEventListener('click', (e) => {
            if (v65) { subClick65(e); return; }
            const row = e.target.closest('.wmb-sub-row');
            if (!row) return;
            subSel = Number(row.dataset.i);
            openSubRow(subSel);
        });
        let holdTimer = 0;
        els.sub.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.wmb-sub-row');
            if (!row) return;
            if (v65 && sub !== 'favorites' && sub !== 'history') return;
            const { clientX, clientY } = e;
            holdTimer = setTimeout(() => {
                subSel = Number(row.dataset.i);
                renderSub();
                const swallow65 = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                // 6.5 Favorites: tap and hold only chooses the row (device), the bar's buttons act on it
                if (v65 && sub === 'favorites') { els.sub.addEventListener('click', swallow65, { capture: true, once: true }); return; }
                ws.menuAt(clientX, clientY, [{ label: 'Open', action: () => openSubRow(subSel) }, '-'].concat(subMenu().slice(0, -2)));
                const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                els.sub.addEventListener('click', swallow, { capture: true, once: true });
            }, (window.wmShell && window.wmShell.holdMs) || LONG_PRESS_MS);
        });
        ['pointerup', 'pointercancel', 'pointermove'].forEach((t) => els.sub.addEventListener(t, (e) => {
            if (t !== 'pointermove' || Math.abs(e.movementY) > 3) clearTimeout(holdTimer);
        }));
        els.sub.addEventListener('contextmenu', (e) => e.preventDefault());

        els.ime.addEventListener('input', onImeInput);
        els.ime.addEventListener('keydown', onImeKey);

        if (typeof ResizeObserver === 'function') {
            let t = 0;
            viewObserver = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(layoutFrame, 60); });
            viewObserver.observe(els.view);
        }
        // the document's and the window's own listeners are set once: the page is made again after the program ended
        if (!boundOnce) {
            boundOnce = true;
            // the SIP button types into the page while a web page shows (the shell's own handler focuses the first edit box)
            document.addEventListener('click', (e) => {
                if (!page || !isCurrent() || onHome() || sub || !W.frame) return;
                if (!e.target.closest || !e.target.closest('#wmShell .wm-sip')) return;
                e.stopImmediatePropagation();
                if (document.activeElement === els.ime) els.ime.blur();
                else focusIme();
            }, true);
            addEventListener('message', onMessage);
            // a new pixel ratio (another screen, browser zoom) changes the frame size, not the page area
            const watchDpr = () => {
                const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
                mq.addEventListener('change', () => { if (page) layoutFrame(); watchDpr(); }, { once: true });
            };
            watchDpr();
            addEventListener('pagehide', () => wins.forEach((w) => inWin(w, () => { if (W.session) closeSession(); })));
            document.addEventListener('visibilitychange', () => wins.forEach((w) => inWin(w, syncAudio)));
        }
        render();
    }

    // ---------------------------------------------------------------- registration

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        ws.registerApp({
            id: APP_ID,
            title: 'Internet Explorer',
            icon: 'app-ie',
            inStart: 'top',
            sip: true,
            mount,
            show() {
                visible = true;
                cur.shownAt = Date.now();
                wins.forEach((w) => { clearTimeout(w.idleTimer); w.idleTimer = 0; clearTimeout(w.dsapIdleTimer); w.dsapIdleTimer = 0; });
                if (!settings) loadSettings().then(() => { if (page && W.dom && onHome()) renderHomeLists(); syncAudio(); });
                // the session was let go while away: the page comes back from its address
                if (!onHome() && !sub && !W.session && !W.creating) { entry().pending = true; openSession(entry().url); }
                if (v65) { bars65 = true; armBars65(); setTimeout(chrome65, 0); }
                render();
                // the windows behind the one on screen: their pages and applets wait their own, longer time
                wins.forEach((w) => { if (w !== cur) inWin(w, () => { syncPageShown(); armDsapIdle(); }); });
                if (sub) renderSub();
                syncAudio();
            },
            hide() {
                visible = false;
                ws.closeMenus();
                chrome65();
                if (document.activeElement === els.ime) els.ime.blur();
                // the Alchemy frame (or the address box) lets go of the focus: keys go to the app on screen
                const a = document.activeElement;
                if (a && page && page.contains(a) && typeof a.blur === 'function') a.blur();
                // every window's page falls silent and is let go after the idle wait; a Dreamscape app
                // behind another app stops after the same wait (it comes back from its address)
                wins.forEach((w) => inWin(w, () => {
                    syncAudio();
                    if (W.session) scheduleIdleClose(IDLE_CLOSE_MS);
                    armDsapIdle();
                }));
            },
            // the program ends (the title's X, Exit, Task Manager's End Task): every window goes with its
            // Alchemy page, applet and timers, and the next start has one window on the start page. Before
            // #748 the page list outlived the page it was drawn on, and a web page or applet came back blank
            onEnd() {
                wins.slice().forEach(disposeWin);
                for (const t of [barsTimer65, zoomTimer65, zoomLayout65, docSitesRetry]) clearTimeout(t);
                barsTimer65 = zoomTimer65 = zoomLayout65 = docSitesRetry = 0;
                zoomOpen65 = false;
                bars65 = true;
                stopFling();
                if (wheelRaf) { cancelAnimationFrame(wheelRaf); wheelRaf = 0; }
                wheelAcc = null;
                if (touch) { clearTimeout(touch.timer); touch = null; }
                if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
                sub = null;
                subSel = -1;
                subData65 = null;
                addrEditing = false;
                page = null;
                els = {};
                wins = [makeWin()];
                cur = wins[0];
                W = cur;
            },
            // WM: X on the page (Smart Minimize: the page stays, and hide() lets Alchemy's session
            // go after the idle wait), ok on Favorites / History (back to the page)
            // 6.5: Favorites and History keep the X (device), the forms and Options have ok
            titleKind: () => (sub && !(v65 && (sub === 'favorites' || sub === 'history')) ? 'ok' : 'close'),
            titleNow: () => (v65 ? title65() : null),
            onTitleOk() {
                if (!sub) return false;
                if (v65) subDone65(true);
                else closeSub();
                return true;
            },
            historyDepth: () => W.idx + (sub ? 1 : 0),
            onBack: () => (v65 && sub ? (subDone65(false), true) : goBack()),
            softKeys() {
                if (v65) return softKeys65();
                if (sub) {
                    return {
                        left: { label: 'Go', disabled: subSel < 0, action: () => openSubRow(subSel) },
                        right: { label: 'Menu', menu: subMenu }
                    };
                }
                return {
                    left: { label: 'Favorites', action: () => openSub('favorites') },
                    right: { label: 'Menu', menu: mainMenu }
                };
            }
        });

        // web links elsewhere on the phone (Help, Messaging, Director) land here, never in desktop windows
        window.wmBrowser = {
            open(url) {
                if (!(coreAddress(url) || dsapAddress(url) || webUrl(url) || parseGrim(url))) return false;
                ws.open(APP_ID);
                return openAddress(url);
            },
            closeSession,
            // windows (#748): the calls above act on the window on screen
            windows: () => wins.map((w) => ({ id: w.id, title: winTitle(w), url: (w.entries[w.idx] || homeEntry()).url, current: w === cur })),
            switchTo: (id) => switchTo(id),
            /** A new window on screen, on url or the start page; its id, or null with every window in use. */
            newWindow(url) {
                if (wins.length >= MAX_WINDOWS) return null;
                ws.open(APP_ID);
                const id = newWindow();
                const address = String(url == null ? '' : url).trim();
                if (id != null && address && !openAddress(address)) cannotOpen(address);
                return id;
            },
            closeWindow: (id) => closeWindow(id),
            // tests: the pages seen in the window on screen and where Chromium is
            _state: () => ({ entries: W.entries.map((e) => (e.home ? (e.grim.kind === 'home' ? 'home' : e.url) : e.url)), idx: W.idx, dsap: W.dsapShell && W.dsapShell._dsapState ? W.dsapShell._dsapState.url : null, idle: !!W.idleTimer, inspect: W.pendingInspect, chromeAt: W.chromeAt, chromeBase: W.chromeBase, session: W.session && W.session.id, loading: W.loading, frame: !!W.frame, ready: W.ready, viewMode, zoomKey, geometry: els.view ? geometry() : null, win: cur.id, windows: wins.length, maxWindows: MAX_WINDOWS })
        };
        try {
            // featureLoader.js's global function: on the phone it opens this app
            window.openGrimoireUrl = async (url) => { if (!window.wmBrowser.open(url)) ws.open(APP_ID); };
        } catch (_) { /* read-only */ }
        routeGrimoire();
    }

    /**
     * Grimoire (Alchemy's desktop window) opened from anywhere on the phone lands in this app. Without
     * this, a wiki or search opened from Studio (a prompt tag's wiki, Search in Grimoire), Help, Recent
     * Items or a desktop shortcut showed the desktop Grimoire window: Studio hosted it as a tool page
     * whose soft keys were only Done, the IE keys and menu were gone. grimoireOpenInTab is set by
     * grimoireTabs.js when the Grimoire feature loads (after this file), so the global is a getter.
     * Dreamscape apps (dsap:, such as NovelAI Explore from Studio, Data Management from Programs) open
     * here as IE pages too (openDsap).
     */
    function openGrimoireTarget(target) {
        const t = target || {};
        const address = String(t.url || t.address || '').trim();
        if (window.wmBrowser.open(address)) return true;
        ws.open(APP_ID);
        const g = t.tag ? { kind: 'wiki', tag: String(t.tag) } : parseGrim(address);
        if (g && g.kind !== 'home') openLocal(g);
        else if (address && /^[a-z][a-z0-9+.-]*:/i.test(address)) cannotOpen(address);
        else goHome();
        return true;
    }

    function routeGrimoire() {
        const phoneOpenInTab = function (target) {
            return openGrimoireTarget(target);
        };
        try {
            Object.defineProperty(window, 'grimoireOpenInTab', {
                configurable: true,
                enumerable: true,
                get: () => phoneOpenInTab,
                // grimoireTabs.js sets the desktop's function when the feature loads: the phone keeps its own
                set: () => { /* ignored */ }
            });
        } catch (_) { /* not configurable: the desktop route stays */ }
        try {
            // dsapRegistry.js: every dsap: opener (Studio's Explore, the Director's lookback links,
            // Programs' Data Management / Image Search / Control Panel / Agora / Novels, a standalone
            // applet window) ends in the desktop Grimoire; on the phone they open the applet in IE
            const desktopOpenDsap = window.openDsapInGrimoire;
            if (typeof desktopOpenDsap === 'function' && !desktopOpenDsap._wmBrowser) {
                const phoneOpenDsap = async function (url) {
                    const address = String(url || '').trim();
                    if (!address) return undefined;
                    if (/^dsap:/i.test(address) || dsapAddress(address)) { ws.open(APP_ID); openDsap(address); return undefined; }
                    openGrimoireTarget({ address });
                    return undefined;
                };
                phoneOpenDsap._wmBrowser = true;
                window.openDsapInGrimoire = phoneOpenDsap;
            }
        } catch (_) { /* read-only */ }
        try {
            // featureLoader.js: Help, Recent Items, the Start menu's Grimoire
            window.openGrimoireApplet = async (query) => {
                const q = String(query || '').trim();
                openGrimoireTarget(q ? { address: 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(q) } : {});
            };
        } catch (_) { /* read-only */ }
        // the Grimoire window's own openers (tagWikiSearchModal.js), used by Studio's prompt boxes
        // (autocompleteUtils.js, promptTextareaContextMenu.js) and Run: patched once the feature loads
        const fl = window.featureLoader;
        if (fl && typeof fl.loadFeature === 'function' && !fl.loadFeature._wmBrowser) {
            const load = fl.loadFeature;
            const wrapped = async function () {
                const out = await load.apply(this, arguments);
                patchGrimoireWindow();
                return out;
            };
            wrapped._wmBrowser = true;
            fl.loadFeature = wrapped;
        }
        patchGrimoireWindow();
    }

    function patchGrimoireWindow() {
        let g = null;
        try { /* global tagWikiSearchModal */ g = typeof tagWikiSearchModal !== 'undefined' ? tagWikiSearchModal : null; } catch (_) { g = null; }
        if (!g || g._wmBrowser) return;
        g._wmBrowser = true;
        g.openSearchForTerm = function (term) {
            const q = String(term || '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
            if (q) openGrimoireTarget({ address: 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(q) });
        };
        // true only when there is an article (callers search instead on false)
        g.openStandaloneWikiIfDirectMatch = async function (name, options) {
            const tag = (options && options.tag) || this.buildWikiTagFromTerm(String(name || '').trim());
            if (!tag) return false;
            try {
                const found = await this.getTagWikiPage(tag, { force: !!(options && options.force), quiet: true });
                if (!this.hasWikiPageContent(found)) return false;
            } catch (_) { return false; }
            openGrimoireTarget({ tag: tag.title || tag.name });
            return true;
        };
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
