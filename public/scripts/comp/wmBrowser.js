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
 * View > Desktop (#748): every page is the desktop Internet Explorer's, not the phone's. The
 * Grimoire's pages (the home page too), Fandom, the Apocrypha and the Dreamscape apps are drawn by
 * the desktop Grimoire's own code and styles on a page 1024 px wide that the user pans (see
 * "Desktop view" below); a web page gets Alchemy's 1024 px viewport as before.
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
    // Automatic (#748, the choice of a new user): One Column on a phone-sized screen, Desktop on a wide
    // one (a foldable opened to its inner screen, a tablet), chosen again when the screen changes size.
    // Wide = at least AUTO_DESKTOP_UNITS design units across, and no less on the screen's shorter side
    // (a phone turned on its side stays a phone). 480 units is twice the QVGA width the shell is drawn
    // for: 720 CSS px at the touch size of 1.5 px a unit.
    const VIEW_AUTO = 'auto';
    const AUTO_DESKTOP_UNITS = 480;
    const AUTO_SETTLE_MS = 400; // a fold or a turn is over
    const TOUCH_UNIT_PX = 1.5;
    // Desktop view: the layout size of a page, the desktop Internet Explorer's page area on a
    // 1024 x 768 screen (the same 1024 px a web page gets from Alchemy in this view)
    const DESK_W = 1024;
    const DESK_H = 768;
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
    const WIN_BOXES = ['home', 'gpage', 'dsap', 'core', 'desk', 'frameWrap'];
    let winSeq = 0;
    function makeWin() {
        return {
            id: ++winSeq,
            closed: false,
            popup: false, // opened by a page (window.open, target=_blank)
            shownAt: 0,
            dom: null, // { home, gpage, dsap, dsapArea, core, desk, deskPage, deskDsap, frameWrap, touch }
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
            remoteY: 0, // how far the web page is scrolled down (the viewer says)
            grimLoading: false, // a Grimoire page on its way (renderLocal)
            localShown: null, // the entry drawn in .wmb-gpage
            dsapShown: null, // the entry the running applet draws
            dsapLoadSeq: 0,
            dsapActivating: false,
            dsapIdleTimer: 0,
            dsapAddrMove: null, // { from, to }: setAddress just moved the address (host.setUrl); addToHistory may follow
            dsapShell: null,
            dsapDesk: false, // the running applet draws in the Desktop view's page (.wmb-desk-dsap)
            coreShown: null, // the entry whose box is in .wmb-core
            deskShown: null // Desktop view: the entry whose page is in .wmb-desk
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
    // viewChoice is what the user picked (stored), viewMode the view in use (Automatic resolved)
    let viewChoice = VIEW_AUTO;
    let viewMode = 'column';
    let zoomKey = 'medium';
    let fullScreen = false;
    try {
        const v = localStorage.getItem(VIEW_KEY);
        if (v === VIEW_AUTO || VIEWS.some(([k]) => k === v)) viewChoice = v;
        const z = localStorage.getItem(ZOOM_KEY);
        if (ZOOMS.some(([k]) => k === z)) zoomKey = z;
        fullScreen = localStorage.getItem(FULL_KEY) === '1';
    } catch (_) { /* storage off */ }

    // IE's own options (#748), the program's and shared by its windows: one JSON object in OPT_KEY
    //   leftKey      6.1: what the left soft key does (the device's is Favorites)
    //   backButton   6.1: a Back button at the left end of the address bar
    //   zoomWindows  6.5: the bar's zoom button opens the windows view instead of the slider
    const OPT_KEY = 'wmIeOptions';
    const LEFT_KEYS = [['favorites', 'Favorites'], ['back', 'Back'], ['home', 'Home'], ['refresh', 'Refresh'], ['windows', 'Windows'], ['newwindow', 'New Window']];
    const opts = { leftKey: 'favorites', backButton: false, zoomWindows: false };
    try {
        const o = JSON.parse(localStorage.getItem(OPT_KEY) || '{}') || {};
        if (LEFT_KEYS.some(([k]) => k === o.leftKey)) opts.leftKey = o.leftKey;
        opts.backButton = o.backButton === true;
        opts.zoomWindows = o.zoomWindows === true;
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
    const deskView = () => viewMode === 'desktop';
    /** The shell's width in design units, and whether the screen is a wide one (see AUTO_DESKTOP_UNITS). */
    function screenUnits() {
        const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
        const shell = document.getElementById('wmShell');
        const w = (shell && shell.clientWidth) || window.innerWidth || 0;
        // the screen's own shorter side (the keyboard does not change it), where the page fills the
        // screen's width as it does on a phone; in a window of another width (a desktop browser,
        // split screen) the width alone decides
        const sw = window.screen.width || 0;
        const fills = sw > 0 && Math.abs(sw - (window.innerWidth || 0)) <= 2;
        const short = fills ? Math.min(sw, window.screen.height || sw) : w;
        return { px, w: w / px, short: short / px };
    }
    function wideScreen() {
        const u = screenUnits();
        return u.w >= AUTO_DESKTOP_UNITS && u.short >= AUTO_DESKTOP_UNITS;
    }
    const resolveView = () => (viewChoice === VIEW_AUTO ? (wideScreen() ? 'desktop' : 'column') : viewChoice);
    viewMode = resolveView();
    // what a web page asks Alchemy for: the phone version of a site in the phone views, the desktop one in Desktop
    const webKind = () => (deskView() ? 'desktop' : 'mobile');
    let alchemyKinds = false; // the server answers with the kind it made (older ones make desktop pages only)
    const entry = () => W.entries[W.idx] || homeEntry();
    const onHome = () => !!entry().home;
    const srcsetOf = (name) => (window.wmShell ? window.wmShell.art.srcset(name) : `/static_images/wm61/${name}@2x.png 2x`);
    const img = (name, cls) => `<img class="${cls || ''}" src="/static_images/wm61/${name}.png" srcset="${srcsetOf(name)}" alt="" draggable="false">`;
    // the address bar's Back and windows buttons: their own 1x / 2x / 4x files
    const img4 = (name) => `<img src="/static_images/wm61/${name}.png" srcset="/static_images/wm61/${name}.png 1x, /static_images/wm61/${name}@2x.png 2x, /static_images/wm61/${name}@4x.png 4x" alt="" draggable="false">`;

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
        // Desktop on a phone-sized screen is a 1024 px page shrunk to fit; on a wide screen the page
        // is as wide as the screen at the shell's touch size (1.5 CSS px a unit: the screen's own CSS
        // width on a phone or tablet), so sites lay out for the width there really is
        const base = viewMode === 'desktop' ? (wideScreen() ? Math.max(W, Math.round(W / screenUnits().px * TOUCH_UNIT_PX)) : Math.max(W, 1024))
            : viewMode === 'default' ? Math.round(W * 1.5) : W;
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

    /**
     * The page of W asks for the kind of site the view shows (#748): a session made for the other
     * kind (the view changed, the screen was unfolded, a page taken from another device) is told, and
     * Alchemy changes its identity (user agent, client hints, device metrics, touch) and loads the
     * page again so the site answers it. What was typed into the page and its scroll position go, as
     * with Refresh; its history and sign-ins stay. Only the window on screen: a page behind it
     * changes when its window is shown.
     */
    function syncViewKind() {
        const s = W.session;
        if (!s || !W.ready || !visible || W !== cur) return;
        const kind = webKind();
        if (s.kind === kind) return;
        s.kind = kind;
        // the address may change with the answer (en. to en.m.): the same entry, not a new page
        const e = W.entries[W.chromeAt >= 0 ? W.chromeAt : W.idx];
        if (alchemyKinds && e && !e.home) e.pending = true;
        const g = geometry();
        fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(s.id) + '/input?' + s.query, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            // with the frame's size, zoom and still scale in the new view: the page loads once, as it will be shown
            body: JSON.stringify({ type: 'view-kind', value: kind, width: g.L, height: g.Lh, zoom: g.z, scale: g.d })
        }).catch(() => {});
    }

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

    /** The owner block for a window's Alchemy page (#756): this phone, its IE, the window as a tab. */
    function sessionOwner(w) {
        return window.browsingSessions ? window.browsingSessions.owner('wmie', 'wmie:' + w.id) : null;
    }

    /** What this phone reports to the browsing-session registry (#756): its IE windows as the tabs of one window. */
    function sessionSnapshot() {
        const tabs = [];
        for (const w of wins) {
            if (w.closed || w.transferred) continue;
            const history = w.entries.filter((e) => e && e.url && !e.home).map((e) => ({ type: webUrl(e.url) ? 'web' : 'page', url: e.url, title: e.title || '' }));
            const top = w.entries[w.idx];
            if (!top || top.home) { if (!w.session) continue; }
            tabs.push({
                id: 'wmie:' + w.id,
                alchemyId: (w.session && w.session.id) || '',
                url: (top && top.url) || '',
                title: winTitle(w),
                history,
                historyIndex: Math.max(0, history.findIndex((h) => top && h.url === top.url)),
                active: w === cur
            });
        }
        return tabs.length ? [{ id: 'wmie', title: 'Internet Explorer', tabs }] : [];
    }

    /** The page reached the memory limit set in Internet Options (#756): Alchemy paused it; allow more, or close the window. */
    async function askMemoryLimit(data) {
        const w = W;
        if (w.askingMemory) return;
        // a window not on screen asks when it shows
        if (w !== cur) { w.memoryLimit = data; return; }
        w.askingMemory = true;
        let host = '';
        try { host = new URL(entry().url).hostname; } catch (_) { host = entry().url || 'This page'; }
        const allow = await ws.messageBox({
            title: 'Internet Explorer',
            icon: 'warning',
            text: `${host} is using ${data.usedMb} MB, more than the ${data.limitMb} MB a page may use. Internet Explorer has paused it.`,
            buttons: [{ text: 'Allow more', value: true, default: true }, { text: 'Close', value: false }]
        });
        w.askingMemory = false;
        if (allow) { postTo(w, { type: 'grimoire-browser-memory-override' }); return; }
        if (wins.length > 1) closeWindow(w.id);
        else inWin(w, () => { closeSession(); goHome(); });
    }

    /** Another device took this window's page (#756): the window says so; Take it back moves it here again. */
    function showTransferred(data) {
        const w = W;
        const alchemyId = (w.session && w.session.id) || data.alchemyId || '';
        const url = data.url || (entry() && entry().url) || '';
        w.session = null;
        w.ready = false;
        if (w.frame) { w.frame.remove(); w.frame = null; }
        w.chromeAt = -1;
        setLoading(false);
        w.transferred = { alchemyId, url, to: data.to || '' };
        if (!w.dom) return;
        w.dom.frameWrap.querySelectorAll('.wmb-transferred').forEach((el) => el.remove());
        const box = document.createElement('div');
        box.className = 'wmb-transferred';
        const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        box.innerHTML = `<p class="wmb-transferred-title">This tab has been transferred to another device</p>
            <p>It is open on ${esc(data.to || 'another device')}.</p><p class="wmb-transferred-url">${esc(url)}</p>
            <p><a href="#" data-act="back">Take it back to this phone</a></p>`;
        box.querySelector('[data-act="back"]').addEventListener('click', (ev) => {
            ev.preventDefault();
            inWin(w, () => takeBackTransferred());
        });
        w.dom.frameWrap.appendChild(box);
        if (window.browsingSessions) window.browsingSessions.changed();
    }

    async function takeBackTransferred() {
        const w = W;
        const t = w.transferred;
        if (!t) return;
        clearTransferred(w);
        if (t.alchemyId && window.browsingSessions) {
            try {
                const res = await window.browsingSessions.takeBack(t.alchemyId, { windowId: 'wmie', tabId: 'wmie:' + w.id });
                if (res && res.tab && res.tab.session) { inWin(w, () => attachSession(res.tab.session)); return; }
            } catch (_) { /* gone: open the address */ }
        }
        if (webUrl(t.url)) inWin(w, () => openSession(webUrl(t.url)));
    }

    function clearTransferred(w) {
        w.transferred = null;
        if (w.dom) w.dom.frameWrap.querySelectorAll('.wmb-transferred').forEach((el) => el.remove());
    }

    /** The viewer of W's session (a new one, or a page's own new window handed over by Alchemy). */
    function attachSession(payload) {
        clearTransferred(W);
        // kind: 'mobile' | 'desktop' as the session was made, '' when not known (a page's own window, a page taken over)
        W.session = { id: payload.sessionId || '', viewUrl: payload.viewUrl, query: String(payload.viewUrl).split('?')[1] || '', kind: payload.viewKind || '' };
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
                        // the phone, its IE and this window own the page (#756; browsingSessions.js)
                        // viewKind: the phone or the desktop version of the site; viewScale: this phone's pixels per page pixel
                        body: JSON.stringify({ url: asked, width: g.L, height: g.Lh, popup: false, owner: sessionOwner(w), viewKind: webKind(), viewScale: g.d })
                    });
                } catch (_) {
                    await inWin(w, () => cannotConnect());
                    return false;
                }
                payload = {};
                try { payload = await res.json(); } catch (_) { /* empty */ }
                if (payload.viewKind) alchemyKinds = true;
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

    /** Desktop view: the page's zoom (6.1 Zoom / 6.5 Text Size, and 6.5's slider), as a web page's in geometry(). */
    function deskZoom() { return zoomFactor() * (v65 ? pageZoom65 : 1); }

    function applyDeskZoom() {
        const z = Math.round(deskZoom() * 1000) / 1000;
        for (const w of wins) if (w.dom) w.dom.deskPage.style.zoom = z === 1 ? '' : String(z);
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
                syncViewKind();
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
            case 'grimoire-browser-scroll':
                W.remoteY = Number(data.y) || 0;
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
            case 'grimoire-browser-transferred':
                showTransferred(data);
                break;
            case 'grimoire-browser-memory':
                W.memory = { level: data.level, usedMb: data.usedMb, limitMb: data.limitMb };
                break;
            case 'grimoire-browser-memory-limit':
                askMemoryLimit(data);
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
        // atTop: the remote page is at its top (the viewer's grimoire-browser-scroll), for 6.5's pull
        touch = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, drag: false, held: false, atTop: !(W.remoteY > 0), samples: [{ t: performance.now(), x: p.x, y: p.y }] };
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
        if (touch.drag && v65 && touch.atTop && p.y - touch.y0 > pull65()) { touch.atTop = false; if (!bars65) showBars65(); }
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
        els.sub.dataset.kind = sub;
        if (SESSION_SUBS.has(sub)) {
            els.sub.innerHTML = `<div class="wmb-sub-head">${esc(SESSION_SUB_TITLES[sub])}</div>${sessionSubHtml()}`;
            if (isCurrent()) { ws.refreshSoftKeys(); ws.refreshTitleAction(); }
            return;
        }
        if (sub === 'props' || sub === 'options' || sub === 'windows') {
            els.sub.innerHTML = sub === 'props' ? propsHtml61() : sub === 'options' ? optionsHtml61() : windowsHtml();
            if (sub === 'windows') fillWindows();
            if (isCurrent()) { ws.refreshSoftKeys(); ws.refreshTitleAction(); }
            return;
        }
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
                // Other Devices (#756) closes the list, under a rule
                submenu: () => wins.map((w) => Object.assign({ label: menuLabel(winTitle(w)), action: () => { switchTo(w.id); } }, v65 ? { checked: w === cur } : { radio: w === cur }))
                    .concat(window.browsingSessions ? ['-', { label: 'Other Devices...', action: openDevices }] : [])
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
            // window rows follow the page commands, after Refresh, between two of the menu's rules
            '-',
            ...windowItems(),
            '-',
            { label: 'Add to Favorites...', action: () => addFavorite() },
            { label: 'History', action: () => openSub('history') },
            '-',
            {
                label: 'View',
                // the device's three views, then Automatic (#748: One Column, or Desktop on a wide screen)
                submenu: VIEWS.concat([[VIEW_AUTO, 'Automatic']]).map(([k, label]) => ({ label, radio: viewChoice === k, action: () => setView(k) }))
                    .concat(['-', { label: 'Full Screen', checked: fullScreen, action: toggleFullScreen }])
            },
            { label: 'Zoom', submenu: ZOOMS.map(([k, label]) => ({ label, radio: zoomKey === k, action: () => setZoom(k) })) },
            {
                label: 'Tools',
                submenu: [
                    { label: 'Copy Link', action: () => copyText(entry().url) },
                    { label: 'Paste', disabled: !web || !W.frame, action: pasteFromClipboard },
                    { label: 'Clear History', action: clearHistory },
                    { label: 'Add-ons', submenu: addonItems },
                    '-',
                    { label: 'Properties', action: properties },
                    { label: 'Options...', action: () => openSub('options') }
                ]
            }
        ];
    }

    /**
     * View is the program's: it applies to every window. A web page takes the new viewport as it is
     * (Alchemy lays the same page out again, no reload). Between Desktop and the phone views the
     * Grimoire's pages change renderer: the page of the window on screen is drawn again at once (from
     * the page cache or the server; an applet starts again from its address), the pages of the
     * windows behind it when their window is shown.
     */
    function setView(k) {
        viewChoice = k;
        try { localStorage.setItem(VIEW_KEY, k); } catch (_) { /* storage off */ }
        applyView();
    }

    /**
     * The view in use follows the choice (Automatic: the screen as it is now). A web page between a
     * phone view and Desktop asks for the other kind of site and loads again (syncViewKind).
     */
    function applyView() {
        const was = deskView();
        viewMode = resolveView();
        if (was !== deskView() && page) {
            // an applet draws in the page of the view it was started in
            wins.forEach((w) => inWin(w, leaveDsap));
            render();
        }
        wins.forEach((w) => inWin(w, () => { layoutFrame(); syncViewKind(); }));
    }

    // Automatic: the screen changed size (a foldable opened or closed, the phone turned): once it has settled
    let autoTimer = 0;
    function onScreenResize() {
        if (viewChoice !== VIEW_AUTO) return;
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => { autoTimer = 0; if (viewChoice === VIEW_AUTO && resolveView() !== viewMode) applyView(); }, AUTO_SETTLE_MS);
    }

    function setZoom(k) {
        zoomKey = k;
        try { localStorage.setItem(ZOOM_KEY, k); } catch (_) { /* storage off */ }
        applyDeskZoom();
        wins.forEach((w) => inWin(w, layoutFrame));
    }

    function toggleFullScreen() {
        fullScreen = !fullScreen;
        try { localStorage.setItem(FULL_KEY, fullScreen ? '1' : '0'); } catch (_) { /* storage off */ }
        page.classList.toggle('is-full', fullScreen);
        requestAnimationFrame(layoutFrame);
    }

    /** Tools > Properties: a page of IE in both versions (device), not a message box. */
    function properties() { openSub('props'); }

    /**
     * What Properties says of the page of the window on screen, in the device's rows. Type and
     * protocol are named for what the page is; the size is given where IE holds the page's own
     * text (a Grimoire page in the phone views), else the device's "Not Available".
     */
    function pageFacts() {
        const e = entry();
        const u = e.url || '';
        const scheme = ((/^([a-z][a-z0-9+.-]*):/i.exec(u) || [])[1] || '').toLowerCase();
        const web = !e.home;
        const kb = (n) => (n < 1024 ? `${n} bytes` : `${Math.round(n / 10.24) / 100} KB (${n} bytes)`);
        let size = 'Not Available';
        try { if (e.home && e.html) size = kb(new Blob([e.html]).size); } catch (_) { /* unknown */ }
        return {
            name: e.title || (web ? hostOf(u) : 'Grimoire'),
            address: u,
            protocol: { https: 'HyperText Transfer Protocol with Privacy', http: 'HyperText Transfer Protocol', edtx: 'Grimoire Document Protocol', rdf: 'Reference Document Protocol', dsap: 'Dreamscape Application Protocol' }[scheme] || 'Not Available',
            type: web ? 'HTML Document' : scheme === 'dsap' ? 'Dreamscape Application' : scheme === 'rdf' ? 'Reference Document' : 'Grimoire Document',
            size,
            encryption: web && scheme === 'https' && !e.pending ? 'Secure (HTTPS)' : 'None',
            zone: web ? 'Internet' : (v65 ? 'Intranet' : 'Local Intranet')
        };
    }

    function saveOpts(patch) {
        Object.assign(opts, patch);
        try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (_) { /* storage off */ }
        applyOpts();
    }

    function applyOpts() {
        if (!page) return;
        // 6.1: the Back button before the lock. 6.5 has Back in its bar: no button there
        els.back.hidden = v65 || !opts.backButton;
        // the windows button: always in 6.1; in 6.5 unless the bar's zoom button shows the windows
        els.winsBtn.hidden = v65 && opts.zoomWindows;
        const z = els.bar65 && els.bar65.querySelector('[data-act="zoom"]');
        if (z) { z.classList.toggle('is-windows', opts.zoomWindows); z.setAttribute('aria-label', opts.zoomWindows ? 'Windows' : 'Zoom'); }
        if (opts.zoomWindows) closeZoom65();
        if (ws && isCurrent()) ws.refreshSoftKeys();
    }

    /** 6.1: the left soft key of the page, as Options > General sets it. */
    function leftKey() {
        const web = !onHome();
        switch (opts.leftKey) {
            case 'back': return { label: 'Back', disabled: W.idx < 1, action: goBack };
            case 'home': return { label: 'Home', action: goHome };
            case 'refresh': return W.loading && web ? { label: 'Stop', action: stop } : { label: 'Refresh', action: refresh };
            case 'windows': return { label: 'Windows', action: () => openSub('windows') };
            case 'newwindow': return { label: 'New Window', disabled: wins.length >= MAX_WINDOWS, action: () => { newWindow(); } };
            default: return { label: 'Favorites', action: () => openSub('favorites') };
        }
    }

    // ---------------------------------------------------------------- pages over the page (6.1): Properties, Options

    let optTab = 'general';

    /** 6.1 Properties (device: header, the page's icon and title, one line a fact, the address in a box). */
    function propsHtml61() {
        const f = pageFacts();
        const row = (k, v) => `<div class="wmb-pr-row">${k}: ${esc(v)}</div>`;
        return `<div class="wmb-sub-head">Properties</div>
            <div class="wmb-props">
                <div class="wmb-pr-top">${img('ie-page', 'wmb-pr-ico')}<span>${esc(f.name)}</span></div>
                ${row('Protocol', f.protocol)}${row('Type', f.type)}${row('Size', f.size)}${row('Encryption', f.encryption)}${row('Security Zone', f.zone)}
                <div class="wmb-pr-addr"><span>Address (URL):</span><input type="text" class="wmb-pr-url" readonly value="${esc(f.address)}" aria-label="Address (URL)"></div>
            </div>`;
    }

    /** 6.1 Options (device: header, pages General / Memory / Security on tabs at the bottom). The device's
     *  own choices that IE here does not have (home page, encoding, cookies) are not shown. */
    function optionsHtml61() {
        const label = (LEFT_KEYS.find(([k]) => k === opts.leftKey) || LEFT_KEYS[0])[1];
        if (optTab === 'sessions' || optTab === 'alchemy') {
            const tabs = (k, t) => `<button type="button" class="wmb-op-tab${optTab === k ? ' is-on' : ''}" data-tab="${k}">${t}</button>`;
            return `<div class="wmb-sub-head">Options</div><div class="wmb-opts">${optTab === 'sessions' ? sessionsFormHtml() : alchemyFormHtml()}</div><div class="wmb-op-tabs">${tabs('general', 'General')}${tabs('memory', 'Memory')}${tabs('sessions', 'Sessions')}${tabs('alchemy', 'Alchemy')}</div>`;
        }
        const body = optTab === 'memory'
            ? `<div class="wmb-op-head">History</div>
               <div class="wmb-op-line"><button type="button" class="wmb-g-btn" data-opt="clear">Clear History</button></div>`
            : `<div class="wmb-op-head">Soft keys</div>
               <div class="wmb-op-lbl">Left soft key</div>
               <button type="button" class="wm-combo wmb-op-combo" data-opt="left"><span>${esc(label)}</span></button>
               <div class="wmb-op-head">Address bar</div>
               <label class="wm-check wmb-op-check"><input type="checkbox" data-opt="back"${opts.backButton ? ' checked' : ''}><span>Show back button in address bar</span></label>`;
        const tab = (k, t) => `<button type="button" class="wmb-op-tab${optTab === k ? ' is-on' : ''}" data-tab="${k}">${t}</button>`;
        return `<div class="wmb-sub-head">Options</div><div class="wmb-opts">${body}</div><div class="wmb-op-tabs">${tab('general', 'General')}${tab('memory', 'Memory')}${window.browsingSessions ? tab('sessions', 'Sessions') + tab('alchemy', 'Alchemy') : ''}</div>`;
    }

    function optionsClick61(e) {
        const tab = e.target.closest('.wmb-op-tab');
        if (tab) {
            optTab = tab.dataset.tab;
            if (optTab === 'sessions' || optTab === 'alchemy') { loadSessionOptions().then(() => { if (sub === 'options') renderSub(); }); return; }
            renderSub();
            return;
        }
        if (sessionFormClick(e)) return;
        const combo = e.target.closest('[data-opt="left"]');
        if (combo) {
            e.stopPropagation();
            ws.dropdown(combo, LEFT_KEYS.map(([k, t]) => ({ label: t, radio: opts.leftKey === k, action: () => { saveOpts({ leftKey: k }); if (sub === 'options') renderSub(); } })), 'left');
            return;
        }
        if (e.target.closest('[data-opt="clear"]')) { clearHistory(); return; }
        const back = e.target.closest('input[data-opt="back"]');
        if (back) saveOpts({ backButton: back.checked });
    }

    // ---------------------------------------------------------------- browsing sessions (#756)
    //
    // Other Devices (the bottom of the Windows list), Restore Session (the first time IE opens after the
    // phone starts, when this phone or, with "pass to the next device", any device left pages behind),
    // and Options' Sessions and Alchemy pages: the desktop's Internet Options settings in the device's form.

    const SESSION_SUBS = new Set(['devices', 'restore']);
    const SESSION_SUB_TITLES = { devices: 'Other Devices', restore: 'Restore Session' };
    let devicesData = null; // browsingSessions.list() for Other Devices
    let restoreData = null; // the restorable sessions on show
    let sessionOpts = null; // { sessions, alchemy, extensions }
    let restoreAsked = false;
    const QUALITY = [[40, 'Low'], [55, 'Medium'], [70, 'High'], [85, 'Highest']];
    const MAX_FPS = [[15, '15'], [24, '24'], [30, '30'], [45, '45'], [60, '60']];
    const MIN_FPS = [[5, '5'], [10, '10'], [15, '15'], [20, '20']];
    const MEMORY = [[0, 'No limit'], [256, '256 MB'], [512, '512 MB'], [1024, '1 GB'], [2048, '2 GB']];
    const SUSPEND = [[0, 'Never'], [5, '5 minutes'], [10, '10 minutes'], [20, '20 minutes'], [60, '1 hour']];
    const MAX_TABS = [[2, '2'], [4, '4'], [6, '6'], [8, '8'], [12, '12']];
    const UNIT_MIN = { m: 1, h: 60, d: 1440 };

    async function openDevices() {
        if (!window.browsingSessions) return;
        try { devicesData = await busyOf(() => window.browsingSessions.list()); } catch (_) { devicesData = null; }
        if (!devicesData) { await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'Other Devices cannot be shown. The server cannot be reached right now.' }); return; }
        openSub('devices');
    }

    function otherSessions() {
        return ((devicesData && devicesData.sessions) || []).filter((x) => !x.own);
    }

    function sessionStateText(x) {
        if (x.state === 'live') return 'Online';
        const mins = Math.max(1, Math.round(((x.killAt || x.expiresAt) - Date.now()) / 60000));
        if (x.state === 'idle') return `Disconnected, closes in ${mins >= 120 ? Math.round(mins / 60) + ' h' : mins + ' min'}`;
        return 'Closed, ' + new Date(x.expiresAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) + ' last day';
    }

    function sessionSubHtml() {
        if (sub === 'devices') {
            const list = otherSessions();
            if (!list.length) return '<div class="wmb-sub-list"><div class="wmb-sub-empty">No other device has pages open.</div></div>';
            let i = 0;
            return `<div class="wmb-sub-list wmb-devices" role="listbox">${list.map((x) => `
                <div class="wmb-dev-head">${img(x.deviceKind === 'mobile' ? 'app-ie' : 'ie-page', 'wmb-sub-ico')}<b>${esc(x.deviceName)}</b><span>${esc(sessionStateText(x))}</span></div>
                ${(x.windows || []).map((w) => (w.tabs || []).map((t) => `
                    <div class="wmb-sub-row${i === subSel ? ' is-selected' : ''}" role="option" data-i="${i++}" data-dev-s="${esc(x.id)}" data-dev-t="${esc(t.id)}">
                        ${img('ie-page', 'wmb-sub-ico')}<span class="wmb-sub-title">${esc(t.title || t.url)}</span><span class="wmb-sub-meta">${esc(t.kind === 'alchemy' ? hostOf(t.url) : 'Grimoire')}</span>
                    </div>`).join('')).join('')}`).join('')}</div>`;
        }
        const sessions = restoreData || [];
        let n = 0;
        return `<div class="wmb-restore"><p>Internet Explorer was closed with these pages open. Select the ones you want to open again.</p>${sessions.map((x) => (x.windows || []).map((w) => {
            n += 1;
            return `<div class="wmb-rs-win">Window ${n} (${esc(x.own ? 'this device' : x.deviceName)})</div>${(w.tabs || []).map((t) => `
                <label class="wm-check wmb-rs-tab"><input type="checkbox" data-rs-s="${esc(x.id)}" data-rs-t="${esc(t.id)}" checked><span>${esc(t.title || t.url)}</span></label>`).join('')}`;
        }).join('')).join('')}</div>`;
    }

    function sessionSubKeys() {
        if (sub === 'devices') {
            const rows = els.sub ? els.sub.querySelectorAll('.wmb-sub-row[data-dev-s]') : [];
            return { left: { label: 'Open', disabled: !rows.length || subSel < 0, action: () => { const r = rows[subSel]; if (r) takeDeviceTab(r.dataset.devS, r.dataset.devT); } }, right: { label: 'Close', action: closeSub } };
        }
        return {
            left: { label: 'Restore', action: restoreChecked },
            right: { label: 'Menu', menu: () => [{ label: 'New', action: () => restoreNewOrDiscard(true) }, { label: 'Discard', action: () => restoreNewOrDiscard(false) }] }
        };
    }

    function sessionSubClick(e) {
        if (sub !== 'devices') return;
        const row = e.target.closest('.wmb-sub-row[data-dev-s]');
        if (!row) return;
        subSel = Number(row.dataset.i);
        takeDeviceTab(row.dataset.devS, row.dataset.devT);
    }

    /** A taken tab (Other Devices, Restore, Send to Device) in a window of its own, or the start page's window. */
    function openTakenTab(t) {
        const blank = onHome() && !W.session && W.entries.length <= 1 && W === cur;
        let w = blank ? cur : null;
        if (!w) {
            if (wins.length >= MAX_WINDOWS) return false;
            const id = newWindow();
            w = wins.find((x) => x.id === id);
        }
        if (!w) return false;
        inWin(w, () => {
            const history = (t.history || []).filter((h) => h && h.url && h.type === 'web').map((h) => ({ url: h.url, title: h.title || '' }));
            if (t.session) {
                W.entries = history.length ? history : [{ url: t.url || '', title: t.title || '' }];
                const at = W.entries.findIndex((h) => h.url === t.url);
                W.idx = at >= 0 ? at : W.entries.length - 1;
                W.entries[W.idx].pending = true;
                attachSession(t.session);
                setLoading(true);
                render();
                step();
            } else if (!openAddress(t.url)) {
                cannotOpen(t.url);
            }
        });
        return true;
    }

    async function takeDeviceTab(sessionId, tabId) {
        let res;
        try {
            res = await busyOf(() => window.browsingSessions.take(sessionId, tabId, { windowId: 'wmie', size: { width: geometry().L, height: geometry().Lh } }));
        } catch (_) {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'That page is no longer open on the other device.' });
            return;
        }
        closeSub();
        if (res && res.tab && !openTakenTab(res.tab)) await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: `Every window is in use (${MAX_WINDOWS}). Close a window, then try again.` });
    }

    async function restoreChecked() {
        const pick = {};
        els.sub.querySelectorAll('input[data-rs-s]').forEach((b) => {
            if (!pick[b.dataset.rsS]) pick[b.dataset.rsS] = [];
            if (b.checked) pick[b.dataset.rsS].push(b.dataset.rsT);
        });
        let res;
        try {
            res = await busyOf(() => window.browsingSessions.restore(Object.keys(pick), pick));
        } catch (_) {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'The session could not be restored.' });
            return;
        }
        closeSub();
        restoreTabs(res);
    }

    function restoreTabs(res) {
        const tabs = [];
        ((res && res.windows) || []).forEach((w) => (w.tabs || []).forEach((t) => tabs.push(t)));
        let left = 0;
        tabs.forEach((t) => { if (!openTakenTab(t)) left += 1; });
        if (left) ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: `${left} ${left === 1 ? 'page was' : 'pages were'} not opened: Internet Explorer has ${MAX_WINDOWS} windows at most.` });
    }

    async function restoreNewOrDiscard(keep) {
        const ids = (restoreData || []).map((x) => x.id);
        try { await window.browsingSessions.discard(ids, keep); } catch (_) { /* offline */ }
        closeSub();
    }

    /** The first time IE shows after the phone starts: Restore Session, unless always restoring (#756). */
    async function maybeRestore() {
        if (restoreAsked || !window.browsingSessions) return;
        const st = window.browsingSessions.state();
        if (!st.online) return;
        restoreAsked = true;
        let list;
        try { list = await window.browsingSessions.list(); } catch (_) { return; }
        const sessions = (list && list.restorable) || [];
        if (!sessions.length) return;
        const cfg = (list && list.settings) || {};
        if (cfg.alwaysRestore) {
            try { restoreTabs(await window.browsingSessions.restore(sessions.map((x) => x.id), null)); } catch (_) { /* offline */ }
            return;
        }
        restoreData = sessions;
        openSub('restore');
    }

    // ---- Options: Sessions and Alchemy

    async function loadSessionOptions() {
        const out = { sessions: null, alchemy: null, extensions: [] };
        try { out.sessions = (await window.browsingSessions.list()).settings; } catch (_) { out.sessions = null; }
        try {
            const data = window.wsClient && typeof window.wsClient.getUserGlobalSettings === 'function' ? await window.wsClient.getUserGlobalSettings() : null;
            out.alchemy = (data && data.settings && data.settings.alchemy) || null;
        } catch (_) { out.alchemy = null; }
        try {
            const res = await fetch('/api/grimoire-browser/extensions', { credentials: 'same-origin' });
            out.extensions = res.ok ? ((await res.json()).extensions || []) : [];
        } catch (_) { out.extensions = []; }
        sessionOpts = out;
        return out;
    }

    function openOption65(key) {
        if (key === 'opt-sessions' || key === 'opt-alchemy') { busyOf(loadSessionOptions).then(() => openSub(key)); return; }
        openSub(key);
    }

    function splitMinutes(m, units) {
        for (const u of units) if (m % UNIT_MIN[u] === 0 && m / UNIT_MIN[u] >= 1) return { n: m / UNIT_MIN[u], u };
        return { n: m, u: 'm' };
    }

    const UNIT_TEXT = { m: 'minutes', h: 'hours', d: 'days' };
    const combo = (key, text) => `<button type="button" class="wm-combo wmb-op-combo" data-sc="${key}"><span>${esc(text)}</span></button>`;
    const pick = (list, v) => (list.find(([k]) => Number(k) === Number(v)) || list[0])[1];

    function sessionsFormHtml() {
        const c = (sessionOpts && sessionOpts.sessions) || { idleMinutes: 15, keepMinutes: 4320, showAtStartup: false, alwaysRestore: false, roam: false };
        const idle = splitMinutes(c.idleMinutes, ['h', 'm']);
        const keep = splitMinutes(c.keepMinutes, ['d', 'h', 'm']);
        const check = (k, t) => `<label class="wm-check wmb-op-check"><input type="checkbox" data-ss="${k}"${c[k] ? ' checked' : ''}><span>${t}</span></label>`;
        return `<div class="wmb-op-head">Restore Session</div>
            ${check('showAtStartup', 'Ask to restore the last session')}
            ${check('alwaysRestore', 'Always restore the last session')}
            ${check('roam', 'Pass my last session to the next device')}
            <div class="wmb-op-head">Keep sessions</div>
            <div class="wmb-op-lbl">Keep pages open after disconnecting for</div>
            <div class="wmb-op-line"><input type="number" min="1" class="wm-edit wmb-op-num" data-ss="idleN" value="${idle.n}" aria-label="Keep pages open for">${combo('idleU', UNIT_TEXT[idle.u])}</div>
            <div class="wmb-op-lbl">Then keep their addresses for</div>
            <div class="wmb-op-line"><input type="number" min="1" class="wm-edit wmb-op-num" data-ss="keepN" value="${keep.n}" aria-label="Keep addresses for">${combo('keepU', UNIT_TEXT[keep.u])}</div>`;
    }

    function alchemyFormHtml() {
        const a = (sessionOpts && sessionOpts.alchemy) || {};
        const perf = a.performance || {};
        const exts = (sessionOpts && sessionOpts.extensions) || [];
        return `<div class="wmb-op-head">Alchemy</div>
            <div class="wmb-op-lbl">Picture quality</div>${combo('jpegQuality', pick(QUALITY, a.jpegQuality || 55))}
            <div class="wmb-op-lbl">Highest frame rate</div>${combo('maxFps', pick(MAX_FPS, a.maxFps || 30))}
            <div class="wmb-op-lbl">Lowest frame rate</div>${combo('minFps', pick(MIN_FPS, a.minFps || 10))}
            <label class="wm-check wmb-op-check"><input type="checkbox" data-sa="audioBackground"${a.audioBackground ? ' checked' : ''}><span>Play sounds in the background</span></label>
            <div class="wmb-op-head">Performance</div>
            <div class="wmb-op-lbl">Memory a page may use</div>${combo('tabMemoryMb', pick(MEMORY, perf.tabMemoryMb || 0))}
            <div class="wmb-op-lbl">Close pages not looked at after</div>${combo('suspendMinutes', pick(SUSPEND, perf.suspendMinutes === undefined ? 20 : perf.suspendMinutes))}
            <div class="wmb-op-lbl">Pages open at once</div>${combo('maxTabs', pick(MAX_TABS, perf.maxTabs || 4))}
            <div class="wmb-op-note">Window, process and sandbox options change on a computer, in Internet Options.</div>
            <div class="wmb-op-head">Add-ons</div>
            ${exts.length ? exts.map((x) => `<div class="wmb-op-addon">${esc(x.name)}${x.popup ? ' <a href="#" data-addon="' + esc(x.popup) + '">Open</a>' : ''}</div>`).join('') : '<div class="wmb-op-lbl">No add-ons are loaded.</div>'}
            <div class="wmb-op-line"><button type="button" class="wmb-g-btn" data-sa-clear="1">Clear Cookies and Cache</button></div>`;
    }

    async function saveAlchemyPatch(patch) {
        const c = window.wsClient;
        const data = c ? await c.updateUserGlobalSettings({ alchemy: patch }) : null;
        if (data && data.settings && data.settings.alchemy && sessionOpts) {
            sessionOpts.alchemy = data.settings.alchemy;
            sessionOpts.sessions = data.settings.alchemy.sessions || sessionOpts.sessions;
        }
    }

    async function saveSessionsPatch(patch) {
        const c = Object.assign({}, (sessionOpts && sessionOpts.sessions) || {}, patch);
        if (c.keepMinutes <= c.idleMinutes) {
            await ws.messageBox({ title: 'Internet Explorer', icon: 'warning', text: 'Addresses must be kept longer than pages stay open.' });
            renderSub();
            return;
        }
        try { await saveAlchemyPatch({ sessions: patch }); } catch (_) { await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'The setting could not be saved.' }); }
        renderSub();
    }

    function sessionFormClick(e) {
        const addon = e.target.closest('[data-addon]');
        if (addon) { e.preventDefault(); openAddon(addon.dataset.addon); return true; }
        if (e.target.closest('[data-sa-clear]')) {
            e.preventDefault();
            busyOf(() => fetch('/api/grimoire-browser/clear-data', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookies: true, cache: true }) }))
                .then(() => ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: 'Alchemy\'s cookies and cache were cleared.' }))
                .catch(() => ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'The cookies and cache could not be cleared.' }));
            return true;
        }
        const box = e.target.closest('[data-sc]');
        if (!box) return false;
        e.stopPropagation();
        const key = box.dataset.sc;
        const a = (sessionOpts && sessionOpts.alchemy) || {};
        const perf = a.performance || {};
        const sess = (sessionOpts && sessionOpts.sessions) || {};
        const list = { jpegQuality: QUALITY, maxFps: MAX_FPS, minFps: MIN_FPS, tabMemoryMb: MEMORY, suspendMinutes: SUSPEND, maxTabs: MAX_TABS }[key];
        if (list) {
            const now = key in perf || ['tabMemoryMb', 'suspendMinutes', 'maxTabs'].includes(key) ? (perf[key] !== undefined ? perf[key] : a[key]) : a[key];
            ws.dropdown(box, list.map(([v, t]) => ({ label: t, radio: Number(now) === Number(v), action: () => {
                const patch = ['tabMemoryMb', 'suspendMinutes', 'maxTabs'].includes(key) ? { performance: { [key]: v } } : { [key]: v };
                saveAlchemyPatch(patch).then(renderSub).catch(() => ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'The setting could not be saved.' }));
            } })), 'left');
            return true;
        }
        const units = key === 'idleU' ? ['m', 'h'] : ['m', 'h', 'd'];
        const field = key === 'idleU' ? 'idleMinutes' : 'keepMinutes';
        const cur0 = splitMinutes(sess[field] || 1, key === 'idleU' ? ['h', 'm'] : ['d', 'h', 'm']);
        ws.dropdown(box, units.map((u) => ({ label: UNIT_TEXT[u], radio: cur0.u === u, action: () => saveSessionsPatch({ [field]: Math.max(1, Math.min(field === 'idleMinutes' ? 1440 : Infinity, cur0.n * UNIT_MIN[u])) }) })), 'left');
        return true;
    }

    function sessionFormChange(e) {
        const t = e.target;
        if (t.dataset.sa) { saveAlchemyPatch({ [t.dataset.sa]: !!t.checked }).catch(() => {}); return; }
        if (!t.dataset.ss) return;
        const sess = (sessionOpts && sessionOpts.sessions) || {};
        if (t.type === 'checkbox') { saveSessionsPatch({ [t.dataset.ss]: !!t.checked }); return; }
        const n = Math.max(1, Math.round(Number(t.value) || 1));
        if (t.dataset.ss === 'idleN') {
            const u = splitMinutes(sess.idleMinutes || 15, ['h', 'm']).u;
            saveSessionsPatch({ idleMinutes: Math.min(1440, n * UNIT_MIN[u]) });
        } else {
            const u = splitMinutes(sess.keepMinutes || 4320, ['d', 'h', 'm']).u;
            saveSessionsPatch({ keepMinutes: n * UNIT_MIN[u] });
        }
    }

    // ---- Tools > Add-ons: an extension's popup in a window of its own, as the desktop's Tools ▾ opens it

    let addonCache = null;
    function addonItems() {
        if (!addonCache) {
            fetch('/api/grimoire-browser/extensions', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { extensions: [] })).then((d) => { addonCache = (d.extensions || []).filter((x) => x.popup); }).catch(() => { addonCache = []; });
            return [{ label: '(Empty)', disabled: true }];
        }
        return addonCache.length ? addonCache.map((x) => ({ label: menuLabel(x.name), action: () => openAddon(x.popup) })) : [{ label: '(Empty)', disabled: true }];
    }

    async function openAddon(url) {
        if (wins.length >= MAX_WINDOWS) { await ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: `Every window is in use (${MAX_WINDOWS}). Close a window, then try again.` }); return; }
        const g = geometry();
        let payload = null;
        try {
            const res = await fetch('/api/grimoire-browser/sessions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, width: g.L, height: g.Lh, popup: true, owner: sessionOwner(cur) }) });
            payload = res.ok ? await res.json() : null;
        } catch (_) { payload = null; }
        if (!payload || !payload.viewUrl) { await cannotConnect(); return; }
        const id = newWindow();
        const w = wins.find((x) => x.id === id);
        if (!w) { dropSession(payload.sessionId); return; }
        w.popup = true;
        inWin(w, () => {
            W.entries = [{ url, title: '', pending: true }];
            W.idx = 0;
            attachSession(payload);
            setLoading(true);
            render();
            step();
        });
    }

    // ---------------------------------------------------------------- the windows view

    /**
     * Every open window as a small picture of its page (#748; asked for "like the Opera Mobile tab
     * view": tiles with a close corner and a tile for a new window). Opened by the address bar's
     * windows button (6.1: also the left soft key when set to Windows; 6.5: the bar's zoom button when
     * Options > Other says so). Drawn with the system's own pieces only: the highlight colours for the
     * window on screen, the title bar's X glyph for the close corner, 6.5's Favorites "+" cell (bitmap
     * 4604) for the new window tile (6.1 has no plus art: its tile is words).
     * The picture is a copy of the window's page box as it stands, scaled down (the box itself stays
     * where it is and keeps running); a web page is the viewer's last frame; a window whose page has
     * not been drawn yet shows its page icon.
     */
    function winBoxOf(w) {
        const e = w.entries[w.idx] || homeEntry();
        if (!w.dom) return null;
        if (!e.home) return w.dom.frameWrap;
        if (deskView()) return w.dom.desk;
        return e.grim.kind === 'home' ? w.dom.home : e.grim.kind === 'dsap' ? w.dom.dsap : e.grim.kind === 'core' ? w.dom.core : w.dom.gpage;
    }

    function winThumb(w, holder) {
        const box = winBoxOf(w);
        const vw = Math.max(1, els.view.clientWidth);
        const vh = Math.max(1, els.view.clientHeight);
        const scale = holder.clientWidth / vw;
        holder.style.height = `${Math.round(vh * scale)}px`;
        let node = null;
        if (box && box === w.dom.frameWrap) {
            try {
                const c = w.frame && w.frame.contentDocument && w.frame.contentDocument.querySelector('canvas');
                if (c && c.width > 1) { node = new Image(); node.src = c.toDataURL('image/jpeg', 0.7); node.className = 'wmb-wt-shot'; }
            } catch (_) { node = null; }
        } else if (box && (box.childElementCount || box.textContent.trim())) {
            const copy = box.cloneNode(true);
            copy.hidden = false;
            copy.removeAttribute('id');
            copy.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
            copy.querySelectorAll('[hidden]').forEach((x) => { if (x.classList.contains('wmb-desk-dsap') && !box.querySelector('.wmb-desk-dsap').hidden) x.hidden = false; });
            copy.setAttribute('inert', '');
            node = document.createElement('div');
            node.className = 'wmb-wt-page';
            node.style.cssText = `width:${vw}px;height:${vh}px;transform:scale(${scale})`;
            node.appendChild(copy);
            const left = box.scrollLeft;
            const top = w === cur ? box.scrollTop : ((w.scrolls && w.scrolls[Object.keys(w.dom).find((k) => w.dom[k] === box)]) || 0);
            setTimeout(() => { copy.scrollTop = top; copy.scrollLeft = left; }, 0);
        }
        if (!node) { node = document.createElement('div'); node.className = 'wmb-wt-none'; node.innerHTML = img('ie-page'); }
        holder.replaceChildren(node);
    }

    function windowsHtml() {
        const tiles = wins.map((w) => `
            <div class="wmb-wt${w === cur ? ' is-current' : ''}" data-win="${w.id}" role="button" tabindex="0" aria-label="${esc(winTitle(w))}">
                <div class="wmb-wt-thumb"></div>
                ${wins.length > 1 ? '<button type="button" class="wmb-wt-x" aria-label="Close Window"></button>' : ''}
                <div class="wmb-wt-name">${esc(winTitle(w))}</div>
            </div>`).join('');
        const add = wins.length < MAX_WINDOWS ? `<div class="wmb-wt wmb-wt-new" data-new="1" role="button" tabindex="0" aria-label="New Window"><div class="wmb-wt-thumb"><span class="wmb-wt-plus">${v65 ? '' : 'New Window'}</span></div><div class="wmb-wt-name">${v65 ? 'New Window' : ''}</div></div>` : '';
        const other = window.browsingSessions ? '<div class="wmb-wins-rule"></div><div class="wmb-wins-other" data-other="1" role="button" tabindex="0">Other Devices</div>' : '';
        return `${v65 ? '' : '<div class="wmb-sub-head">Windows</div>'}<div class="wmb-wins-grid">${tiles}${add}</div>${other}`;
    }

    function fillWindows() {
        els.sub.querySelectorAll('.wmb-wt[data-win]').forEach((t) => {
            const w = wins.find((x) => String(x.id) === t.dataset.win);
            if (w) winThumb(w, t.querySelector('.wmb-wt-thumb'));
        });
        const plus = els.sub.querySelector('.wmb-wt-new .wmb-wt-thumb');
        const first = els.sub.querySelector('.wmb-wt[data-win] .wmb-wt-thumb');
        if (plus && first) plus.style.height = first.style.height;
    }

    function windowsClick(e) {
        if (e.target.closest('.wmb-wins-other')) { openDevices(); return; }
        const x = e.target.closest('.wmb-wt-x');
        const tile = e.target.closest('.wmb-wt');
        if (!tile) return;
        if (tile.dataset.new) { closeSub(); newWindow(); return; }
        const id = Number(tile.dataset.win);
        if (x) { closeWindow(id); if (sub === 'windows') renderSub(); return; }
        closeSub();
        switchTo(id);
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
        if (deskView()) {
            // the desktop Internet Explorer's pages ("Desktop view")
            if (e.grim.kind === 'dsap') renderDsap(e, force);
            else renderDesk(e, force);
            return;
        }
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
        (deskView() ? els.deskDsap : els.dsapArea).innerHTML = `<div class="wmb-g-note">${esc(text)}</div>`;
    }

    /** Start the entry's applet on screen (again with force: Refresh). */
    function renderDsap(e, force) {
        if (!force && W.dsapShown === e && W.dsapShell._dsapActive && W.dsapDesk === deskView()) return;
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
            // Desktop view: the applet draws in the desktop page (.wmb-desk-dsap), with the desktop's own
            // applet styles (wm-dsap.css reaches .wmb-dsap alone)
            const desk = deskView();
            if (W.dsapShell._dsapState && W.dsapDesk !== desk) leaveDsap();
            W.dsapDesk = desk;
            W.dsapShell.displayArea = desk ? els.deskDsap : els.dsapArea;
            W.dsapShown = e;
            W.dsapAddrMove = null;
            W.dsapActivating = true;
            let done = false;
            try { done = window.activateDsapOnShell(W.dsapShell, e.url, { force: true }); } finally { W.dsapActivating = false; }
            if (!done) throw new Error('activate');
            if (desk) {
                deskViewport(els.deskDsap);
                els.desk.scrollTop = 0;
                els.desk.scrollLeft = 0;
            } else {
                // DSAP-SMF applets take WM's white form (wm-dsap.css), not the desktop's grey page
                const root = W.dsapShell._dsapState && W.dsapShell._dsapState.rootEl;
                if (root && root.classList.contains('dsap-smf')) els.dsap.style.backgroundColor = '';
                els.dsap.scrollTop = 0;
            }
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
        if (els.deskDsap.childElementCount) els.deskDsap.innerHTML = '';
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
        // the applet's page: .wmb-dsap, or the Desktop view's page
        const box = W.dsapDesk ? els.desk : els.dsap;
        if (!a || !(W.dsapDesk ? els.deskDsap : els.dsap).contains(a) || a.hasAttribute('download')) return;
        const href = (a.getAttribute('href') || '').trim();
        if (!href || /^javascript:/i.test(href)) return;
        const label = a.textContent.replace(/\s+/g, ' ').trim();
        if (href.startsWith('#')) {
            e.preventDefault();
            let target = null;
            try { target = href.length > 1 && box.querySelector('#' + CSS.escape(href.slice(1))); } catch (_) { target = null; }
            if (target) box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
            else box.scrollTop = 0;
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
    function onCoreClick(e) { paneClick(e, els.core, true, coreScrollTo); }

    /** box: the page's scroll box; fandom: its documentation links are Fandom pages (else a documentation site's). */
    function paneClick(e, box, fandom, scrollTo) {
        const t = e.target;
        if (!t || !t.closest) return;
        const swallow = () => { e.preventDefault(); e.stopPropagation(); };
        const view = t.closest('[data-fandom-index-view]');
        if (view && box.contains(view)) {
            swallow();
            navigate(view.getAttribute('data-fandom-index-view') === 'all' ? FANDOM_HOME + '?all=1' : FANDOM_HOME, 'Fandom Wikis');
            return;
        }
        if (t.closest('[data-action="open-fandom-wiki-import"]')) { swallow(); navigate('dsap://wiki.dyna.dreamscape.jp/import'); return; }
        const a = t.closest('a');
        if (!a || !box.contains(a)) return;
        swallow();
        const label = a.textContent.replace(/\s+/g, ' ').trim();
        const href = (a.getAttribute('href') || '').trim();
        if (a.dataset.wikiSite && a.dataset.wikiPage) {
            if (fandom) navigate(fandomUrl(a.dataset.wikiSite, a.dataset.wikiPage), label);
            else openLocal({ kind: 'doc', site: a.dataset.wikiSite, page: a.dataset.wikiPage }, label);
            return;
        }
        if (a.classList.contains('tag-wiki-link') && a.dataset.tagName && !a.dataset.tagName.startsWith('#')) { openLocal({ kind: 'wiki', tag: a.dataset.tagName }); return; }
        if (href.startsWith('#')) { scrollTo(href.slice(1)); return; }
        if (!href || /^javascript:/i.test(href)) return;
        if (/^(edtx|rdf|dsap):/i.test(href) || coreAddress(href) || dsapAddress(href)) { navigate(href, label); return; }
        let abs = null;
        try { abs = new URL(href, location.href); } catch (_) { return; }
        // same-origin links (a picture saved with a wiki page) would leave the phone's shell: the picture is on the page already
        if (abs.origin === location.origin) return;
        if (abs.protocol === 'http:' || abs.protocol === 'https:') navigate(abs.href, label);
    }


    // ---------------------------------------------------------------- Desktop view

    /**
     * View > Desktop (6.5: View > Desktop, Options > Other > Desktop Computer), #748: IE shows every
     * page the way the desktop Internet Explorer of this app (the Grimoire window,
     * tagWikiSearchModal.js) shows it, its home page too, instead of the phone's own page builders
     * (.wmb-home, .wmb-gpage, the one-column .wmb-core and wm-dsap.css).
     *
     * The page is .wmb-desk: the desktop window's page nest (.grimoire-window >
     * .tag-wiki-search-display > .tag-wiki-display-content, which tag-wiki-search.css keys its
     * document sheet on) laid out DESK_W px wide and at least DESK_H tall, with the desktop's
     * body text (app.css: var(--font-primary), 16 px, line height 1.25). It is shown at its own
     * size and the user pans it; 6.1's Zoom, 6.5's Text Size and 6.5's slider scale it
     * (applyDeskZoom). Measured against the desktop window with a 1024 px page area: every box of
     * the home page falls on the same pixel.
     *
     * Who draws: a desk pane per page (the phone pane of "Fandom and the Apocrypha" with the
     * desktop search page's methods taken from TagWikiSearchModal.prototype), driven the way
     * grimoireCoreDomains.js drives a Grimoire window:
     *   home          showDreamWikiHomepage (drawn again each time the page comes on screen: its
     *                 Recently visited list is of the moment)
     *   search        showSearchResultsPage + performSearch (the search home with no query)
     *   wiki          getTagWikiPageDirectly (a tag with no page found from the search page: the
     *                 desktop's online lookup page first)
     *   documentation showStaticWikiSiteIndex / openStaticWikiPage
     *   Fandom, the Apocrypha   their registry entry's activate, as .wmb-core
     *   Dreamscape apps         activateDsapOnShell into .wmb-desk-dsap (renderDsap)
     * Nothing here opens by itself in the pane it is on: what a tap asks for (pane.navigate,
     * getTagWikiPageDirectly ..., and every link, caught first by onDeskClick) is a new IE page, so
     * Back, Forward, History, Favorites and the windows work as in the phone views. Each page
     * keeps its pane and box: Back shows it as it was left. The desktop's context menus stay away
     * (the search page's gear opens its options as a WM menu).
     */
    let DeskPane = null;
    // the desktop search page (TagWikiSearchModal's own; the rest is WikiDisplayBase's)
    const DESK_BORROWED = ['showSearchResultsPage', 'searchTagWiki', 'getSourceIcon', 'refreshSearchPageResults', 'getGrimoireFilterOptionsForMenu',
        'getGrimoireFilterOptions', 'applyGrimoireFilter', 'updateSearchControlsVisibility', 'clearResults', '_showOnlineLookupSorry'];

    function deskPaneClass() {
        if (DeskPane) return DeskPane;
        const Base = phonePaneClass();
        /* global TagWikiSearchModal */
        if (!Base || typeof TagWikiSearchModal !== 'function') return null;
        const main = TagWikiSearchModal.prototype;
        DeskPane = class extends Base {
            constructor(e, area) {
                super(e, area);
                this._own = 0;
                // what the search page reads on the Grimoire window
                this.modal = null;
                this.searchBody = null;
                this.searchInput = { value: '' };
                this.currentSearchResults = [];
                this.currentFilter = '';
                this.currentSearchType = 'name';
                this.includeOnline = false;
                this._searchPageMode = false;
            }
            /** The page's own load: the renderers draw here. Outside it they are a tap's request for another page. */
            own(fn) { this._own++; try { return fn(); } finally { this._own--; } }
            isSplitMode() { return false; }
            _sync() {
                if (!this._loads) deskViewport(this.displayArea);
                inWin(this._w, () => { if (W.deskShown === this._ie && entry() === this._ie) setGrimLoading(this._loads > 0); });
            }
            // IE's entry has the page's address already (a Fandom page names its own, as on the phone pane)
            setAddress(o) { if (this._ie.grim.kind === 'core') super.setAddress(o); }
            addToHistory(h) {
                if (!h) return;
                let title = '';
                if (h.type === 'wiki') title = (h.tag && (h.tag.title || h.tag.name)) || '';
                else if (h.type === 'apocrypha') title = 'Apocrypha';
                else if (h.type !== 'search' && h.type !== 'home' && h.query === undefined) title = h.title || h.siteName || '';
                if (title) this._ie.title = String(title).replace(/_/g, ' ');
                noteHistory(this._ie.url, this._ie.title);
                inWin(this._w, () => { if (entry() === this._ie) { chrome65(); step(); } });
            }
            // the gear's options open as a WM menu (deskGearMenu)
            showSearchControlsContextMenu() { return null; }
            _showOnlineLookupPage(tag) { if (this._own) main._showOnlineLookupPage.call(this, tag); }
            getTagWikiPageDirectly(name, link, o) {
                if (this._own) return this._track(WikiDisplayBase.prototype.getTagWikiPageDirectly.call(this, name, link, o));
                if (!name) return undefined;
                // a tag with no wiki page, tapped on the search page: its page looks the tag up online
                const online = this._checkingOnlineTag === name;
                delete this._checkingOnlineTag;
                inWin(this._w, () => openLocal(Object.assign({ kind: 'wiki', tag: String(name) }, online ? { online: true } : null)));
                return undefined;
            }
            showStaticWikiSiteIndex(id, o) {
                if (this._own) return this._track(WikiDisplayBase.prototype.showStaticWikiSiteIndex.call(this, id, o));
                return super.showStaticWikiSiteIndex(id);
            }
            openStaticWikiPage(site, page, o) {
                if (this._own) return super.openStaticWikiPage(site, page, o);
                if (site && page) {
                    inWin(this._w, () => {
                        if (this._ie.grim.kind === 'core') navigate(fandomUrl(site, page));
                        else openLocal({ kind: 'doc', site: String(site), page: String(page) });
                    });
                }
                return undefined;
            }
            performSearch() { return this._track(main.performSearch.call(this)); }
        };
        for (const k of DESK_BORROWED) if (typeof main[k] === 'function') DeskPane.prototype[k] = main[k];
        return DeskPane;
    }

    /**
     * A page that brings its own style sheet (the Apocrypha's zine, an applet) may choose its layout
     * by the window's width (@media (max-width: 768px) ...). The window here is the phone's, the page
     * DESK_W wide: in the page's own sheets (the <style> elements inside it) such a rule is decided
     * for a window DESK_W wide: taken out when it does not hold, its rules freed when it does.
     */
    function deskViewport(root) {
        if (!root) return;
        const holds = (cond) => {
            // each "(min-width: N)" / "(max-width: N)" of the condition, px (em and rem at 16 px)
            let any = false;
            let ok = true;
            cond.replace(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/gi, (_, kind, n, unit) => {
                any = true;
                const px = Number(n) * (unit.toLowerCase() === 'px' ? 1 : 16);
                if (kind.toLowerCase() === 'min' ? DESK_W < px : DESK_W > px) ok = false;
                return '';
            });
            return any ? ok : null;
        };
        root.querySelectorAll('style').forEach((st) => {
            const sheet = st.sheet;
            if (!sheet || st.dataset.wmbDesk) return;
            st.dataset.wmbDesk = '1';
            try {
                for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
                    const r = sheet.cssRules[i];
                    // one plain condition or several joined by "and"; a list or "not" stays as it is
                    if (!(r instanceof CSSMediaRule) || /,|\bnot\b|\bor\b/i.test(r.conditionText)) continue;
                    const on = holds(r.conditionText);
                    if (on === null) continue;
                    const inner = on ? [...r.cssRules].map((x) => x.cssText) : [];
                    sheet.deleteRule(i);
                    inner.forEach((text, n) => sheet.insertRule(text, i + n));
                }
            } catch (_) { /* a sheet that cannot be read stays as it is */ }
        });
    }

    /** The page in .wmb-desk-page: area (an entry's own box), or none (an applet's page, or the view is away). */
    function showDeskArea(area) {
        if (!W.dom) return;
        for (const c of [...els.deskPage.children]) if (c !== els.deskDsap && c !== area) c.remove();
        if (area && area.parentNode !== els.deskPage) els.deskPage.insertBefore(area, els.deskDsap);
        if (!area) W.deskShown = null;
    }

    /** Desktop view: show the entry's page (again from the server with force: Refresh). */
    function renderDesk(e, force) {
        const g = e.grim;
        if (!force && W.deskShown === e && e.dArea && e.dArea.parentNode === els.deskPage) return;
        W.deskShown = e;
        if (e.dArea && e.dPane && !force && g.kind !== 'home') {
            // Back / Forward: the page as it was left, where it was panned to
            showDeskArea(e.dArea);
            els.desk.scrollLeft = (e.dScroll || [0, 0])[0];
            els.desk.scrollTop = (e.dScroll || [0, 0])[1];
            setGrimLoading(e.dPane._loads > 0);
            return;
        }
        const old = e.dPane;
        const area = document.createElement('div');
        area.className = 'wmb-desk-area tag-wiki-display-content';
        e.dArea = area;
        e.dPane = null;
        e.dScroll = [0, 0];
        showDeskArea(area);
        els.desk.scrollLeft = 0;
        els.desk.scrollTop = 0;
        const w = W;
        const fail = (text) => inWin(w, () => {
            if (e.dArea !== area) return;
            area.innerHTML = `<div class="wmb-g-note">${esc(text)}</div>`;
            if (W.deskShown === e && entry() === e) setGrimLoading(false);
        });
        const ws_ = window.wsClient;
        if (g.kind !== 'home' && (!ws_ || !ws_.isConnected || !ws_.isConnected())) { fail('The page cannot be reached: this phone is not connected to Dreamscape. Try again later.'); return; }
        setGrimLoading(true);
        loadGrimFeature().then(() => {
            if (e.dArea !== area) return;
            const Pane = deskPaneClass();
            let m = null;
            if (g.kind === 'core') { try { m = dsapApi() ? window.resolveDsap(e.url) : null; } catch (_) { m = null; } }
            if (!Pane || (g.kind === 'core' && !(m && m.entry && typeof m.entry.activate === 'function'))) { fail('The page cannot be displayed.'); return; }
            inWin(w, () => {
                const pane = new Pane(e, area);
                e.dPane = pane;
                pane._track(null); // the ring stays until a renderer has started
                const draw = () => pane.own(() => {
                    if (g.kind === 'home') pane.showDreamWikiHomepage();
                    else if (g.kind === 'search') {
                        // as grimoireCoreDomains.js opens en.grimoire.jp/search on a Grimoire window
                        pane.searchInput.value = g.q || '';
                        if (!g.q) { pane.showSearchResultsPage('', false); return; }
                        pane._searchPageMode = true;
                        pane.showSearchResultsPage(g.q, true);
                        pane.performSearch().finally(() => {
                            pane._searchPageMode = false;
                            if (e.dArea === area) pane.showSearchResultsPage(g.q, false);
                        });
                    } else if (g.kind === 'wiki') {
                        if (g.online) {
                            delete g.online;
                            pane._checkingOnlineTag = g.tag;
                            pane.includeOnline = true;
                            pane._showOnlineLookupPage(g.tag);
                        }
                        pane.getTagWikiPageDirectly(g.tag);
                    } else if (g.kind === 'site') pane.showStaticWikiSiteIndex(g.site);
                    else if (g.kind === 'doc') pane.openStaticWikiPage(g.site, g.page);
                    else m.entry.activate(pane, m);
                });
                const failed = (err) => { console.warn('[wmBrowser] desktop page', e.url, err); fail('The page cannot be displayed.'); };
                try {
                    /* global wikiPageCache */
                    if (force && g.kind === 'wiki') {
                        // Refresh: the server's copy is fetched again (as the phone page's Refresh), then drawn
                        const tag = pane.buildWikiTagFromTerm(g.tag);
                        pane._track(Promise.resolve(tag ? pane.getTagWikiPage(tag, { force: true, quiet: true }) : null).catch(() => null).then(() => { if (e.dArea === area) draw(); })).catch(failed);
                        return;
                    }
                    if (force && g.kind === 'doc') { try { wikiPageCache.invalidate(wikiPageCache.staticKey(g.site, g.page)); } catch (_) { /* no cache */ } }
                    if (force && g.kind === 'core' && old && old.currentStaticWiki) {
                        try { wikiPageCache.invalidate(wikiPageCache.staticKey(old.currentStaticWiki.siteId, old.currentStaticWiki.pageId)); } catch (_) { /* no cache */ }
                    }
                    draw();
                } catch (err) { failed(err); }
            });
        }).catch((err) => { console.warn('[wmBrowser] desktop page', e.url, err); fail('The page cannot be displayed.'); });
    }

    function deskScrollTo(id) {
        const area = W.deskShown && W.deskShown.dArea;
        let target = null;
        try {
            target = id && area && (area.querySelector('#' + CSS.escape(id)) || area.querySelector(`[name="${CSS.escape(id)}"]`));
        } catch (_) { target = null; }
        if (target) els.desk.scrollTop += target.getBoundingClientRect().top - els.desk.getBoundingClientRect().top;
        else if (!id) els.desk.scrollTop = 0;
    }

    /** The search page's gear: the desktop's search options (showSearchControlsContextMenu) as a WM menu. */
    function deskGearMenu(pane, x, y) {
        let cfg = null;
        try { cfg = TagWikiSearchModal.prototype.showSearchControlsContextMenu.call(pane, null, true); } catch (_) { cfg = null; }
        const src = cfg && cfg.sections && cfg.sections[0] && cfg.sections[0].items;
        if (!Array.isArray(src)) return;
        const convert = (items, parent) => items.map((it) => {
            if (!it || it.separator) return '-';
            if (typeof it.loadfn === 'function') { try { it.loadfn(it); } catch (_) { /* as is */ } }
            const row = { label: String(it.text || '').replace(/\.\.\.$/, '') };
            if (typeof it.optionsfn === 'function') { row.submenu = () => convert(it.optionsfn() || [], it); return row; }
            if (parent) row.radio = !!it.highlighted;
            else row.checked = !!it.highlighted;
            row.action = () => {
                if (parent && typeof parent.handlerfn === 'function') parent.handlerfn(it);
                else if (typeof cfg.onAction === 'function') cfg.onAction(it.action, it);
            };
            return row;
        });
        ws.menuAt(x, y, convert(src, null));
    }

    /** Taps on a Desktop view page, before the desktop's own handlers: links open as IE pages. */
    function onDeskClick(e) {
        const t = e.target;
        if (!t || !t.closest || els.deskDsap.contains(t)) return;
        const pane = W.deskShown && W.deskShown.dPane;
        const gear = t.closest('.search-gear');
        if (gear && pane) {
            e.preventDefault();
            e.stopPropagation();
            deskGearMenu(pane, e.clientX, e.clientY);
            return;
        }
        paneClick(e, els.desk, entry().grim.kind === 'core', deskScrollTo);
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

    const SUB65_TITLES = { favorites: 'Favorites', history: 'History', options: 'Options', 'opt-history': 'Browsing History', 'opt-other': 'Other', 'opt-sessions': 'Sessions', 'opt-alchemy': 'Alchemy', props: 'Properties', windows: 'Windows', devices: 'Other Devices', restore: 'Restore Session' };
    const OPTIONS65 = [['opt-history', 'Browsing History'], ['opt-other', 'Other'], ['opt-sessions', 'Sessions'], ['opt-alchemy', 'Alchemy']];

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

    /** How far a page at its top is pulled down before the bars come back: 24 units. */
    function pull65() {
        return 24 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1);
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
        applyDeskZoom();
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
            // after Refresh, before View, between two rules (the device's own menu has none; its
            // submenus draw them, as View's does here)
            '-',
            ...windowItems(),
            '-',
            {
                label: 'View',
                submenu: [
                    { label: 'Text Size', submenu: ZOOMS.map(([k, label]) => ({ label, radio: zoomKey === k, action: () => setZoom(k) })) },
                    '-',
                    { label: 'Mobile', checked: viewChoice !== VIEW_AUTO && viewChoice !== 'desktop', action: () => setView('column') },
                    { label: 'Desktop', checked: viewChoice === 'desktop', action: () => setView('desktop') },
                    // #748: Mobile, or Desktop on a wide screen
                    { label: 'Automatic', checked: viewChoice === VIEW_AUTO, action: () => setView(VIEW_AUTO) }
                ]
            },
            {
                label: 'Tools',
                submenu: [
                    { label: 'Send Link...', action: sendLink65 },
                    { label: 'Add-ons', submenu: addonItems },
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
        if (sub === 'options') return { left: { label: 'Open', action: () => openOption65(OPTIONS65[subSel] ? OPTIONS65[subSel][0] : 'options') }, right: { label: 'Close', action: closeSub } };
        if (sub === 'opt-history') return { left: { label: 'Done', action: () => subDone65(true) }, right: { label: 'Clear', action: clearHistory } };
        if (sub === 'opt-other') return { left: { label: 'Done', action: () => subDone65(true) }, right: { label: 'Cancel', action: () => subDone65(false) } };
        if (sub === 'props') return { left: { label: 'Close', action: closeSub }, right: null };
        if (sub === 'windows') return { left: { label: 'New', disabled: wins.length >= MAX_WINDOWS, action: () => { closeSub(); newWindow(); } }, right: { label: 'Close', action: closeSub } };
        if (SESSION_SUBS.has(sub)) return sessionSubKeys();
        if (sub === 'opt-sessions' || sub === 'opt-alchemy') return { left: { label: 'Done', action: () => openSub('options') }, right: null };
        if (sub === 'favform') return { left: { label: subData65 && subData65.at >= 0 ? 'OK' : 'Add', action: () => subDone65(true) }, right: { label: 'Cancel', action: () => subDone65(false) } };
        return none;
    }

    /** ok / Done (true) or Cancel / the back key (false) on the page on screen. */
    function subDone65(ok) {
        if (sub === 'opt-history') { openSub('options'); return; }
        if (sub === 'opt-other') {
            const on = ok && els.sub.querySelector('input[name="wmb65-as"]:checked');
            // the choice as it stands is left alone (Default, kept from 6.1, shows as Mobile Device)
            if (on && on.value !== (viewChoice === VIEW_AUTO || viewChoice === 'desktop' ? viewChoice : 'column')) setView(on.value);
            const zw = ok && els.sub.querySelector('input[data-opt="zoomwin"]');
            if (zw) saveOpts({ zoomWindows: zw.checked });
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
            const chosen = viewChoice === VIEW_AUTO || viewChoice === 'desktop' ? viewChoice : 'column';
            const radio = (v, label) => `<label class="wm-check"><input type="radio" name="wmb65-as" value="${v}"${v === chosen ? ' checked' : ''}><span>${label}</span></label>`;
            // device: the two choices, then check boxes 21 px apart (Play Sounds, Show Pictures ...: not here); ours: Automatic
            // (#748: Mobile Device, or Desktop Computer on a wide screen) and the zoom button's use
            html = `<div class="wmb65-form wmb65-other"><div class="wmb65-lbl">Browse websites as:</div>${radio('column', 'Mobile Device')}${radio('desktop', 'Desktop Computer')}${radio(VIEW_AUTO, 'Automatic')}
                <label class="wm-check wmb65-other-check"><input type="checkbox" data-opt="zoomwin"${opts.zoomWindows ? ' checked' : ''}><span>Show windows with the zoom button</span></label></div>`;
        } else if (sub === 'props') {
            const e = entry();
            const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(e.url || '') || [])[1] || '';
            const proto = /^https$/i.test(scheme) ? 'HyperText Transfer Protocol with Privacy' : /^http$/i.test(scheme) ? 'HyperText Transfer Protocol' : scheme || 'Not Available';
            // device: Name, Address, Type, Size, Protocol, Encryption, Security Zone
            const f = pageFacts();
            void e; void proto;
            const fields = [['Name:', f.name], ['Address:', f.address], ['Type:', f.type], ['Size:', f.size], ['Protocol:', f.protocol], ['Encryption:', f.encryption], ['Security Zone:', f.zone]];
            html = `<div class="wmb65-props">${fields.map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('')}</div>`;
        } else if (sub === 'windows') {
            html = windowsHtml();
        } else if (SESSION_SUBS.has(sub)) {
            html = sessionSubHtml();
        } else if (sub === 'opt-sessions') {
            html = `<div class="wmb65-form wmb-opts">${sessionsFormHtml()}</div>`;
        } else if (sub === 'opt-alchemy') {
            html = `<div class="wmb65-form wmb-opts">${alchemyFormHtml()}</div>`;
        } else if (sub === 'favform') {
            const d = subData65 || { url: '', title: '' };
            html = `<div class="wmb65-form">
                <label class="wmb65-lbl">Name:</label><input type="text" class="wm-edit" data-f="title" autocomplete="off" spellcheck="false" enterkeyhint="done" value="${esc(d.title)}" aria-label="Name">
                <label class="wmb65-lbl">Address (URL):</label><input type="url" class="wm-edit" data-f="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" value="${esc(d.url)}" aria-label="Address (URL)">
                <label class="wmb65-lbl">Folder:</label><button type="button" class="wm-combo" data-f="folder"><span>Favorites</span></button>
            </div>`;
        }
        els.sub.innerHTML = html;
        if (sub === 'windows') fillWindows();
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
        else if (sub === 'options') openOption65(OPTIONS65[subSel][0]);
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
                if (opts.zoomWindows) openSub('windows');
                else if (zoomOpen65) closeZoom65();
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
        // At the top of a page, pulling it down further brings the bars back (#748, asked for by the
        // owner; the device itself stops dead at the top and only its round button shows them). The
        // page boxes keep overscroll-behavior: contain, so the browser's own pull to refresh and the
        // shell's gestures are not in play; nothing moves, the pull is only measured.
        let pull = null;
        els.view.addEventListener('touchstart', (e) => {
            pull = null;
            if (sub || e.touches.length !== 1 || !W.dom) return;
            const box = ['home', 'gpage', 'dsap', 'core', 'desk'].map((k) => W.dom[k]).find((b) => !b.hidden && b.contains(e.target));
            if (box && box.scrollTop <= 0) pull = { y: e.touches[0].clientY, box };
        }, { passive: true });
        els.view.addEventListener('touchmove', (e) => {
            if (!pull) return;
            if (pull.box.scrollTop > 0) { pull = null; return; }
            if (e.touches[0].clientY - pull.y > pull65()) { pull = null; if (!bars65) showBars65(); }
        }, { passive: true });
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
        // the closed lock only for a page Alchemy reports at an https address (not for one merely
        // typed and still on its way); http: the device's open lock (it shows it on file:// pages
        // too); Dreamscape's own schemes have their own marks (generated in the lock art's palette)
        const u = e.url || '';
        const secure = !e.home && /^https:/i.test(u) && !e.pending;
        const art = !e.home ? (secure ? 'ie-lock' : 'ie-unlock') : /^dsap:/i.test(u) ? 'ie-proto-dsap' : /^rdf:/i.test(u) ? 'ie-proto-rdf' : 'ie-proto-edtx';
        els.lock.innerHTML = img(art);
        els.lock.title = !e.home ? (secure ? 'Secure connection' : 'Not secure') : /^dsap:/i.test(u) ? 'Dreamscape application' : /^rdf:/i.test(u) ? 'Reference document' : 'Grimoire document';
        if (els.back) els.back.disabled = W.idx < 1;
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
        // Desktop view: every Grimoire page, the start page and the applets too, shows in .wmb-desk
        const desk = home && deskView();
        els.home.hidden = !start || desk;
        els.gpage.hidden = !home || start || app || core || desk;
        els.dsap.hidden = !app || desk;
        els.core.hidden = !core || desk;
        els.desk.hidden = !desk;
        if ((!core || desk) && W.coreShown) { els.core.replaceChildren(); W.coreShown = null; }
        if (!desk || app) showDeskArea(null);
        els.deskDsap.hidden = !(desk && app);
        page.classList.toggle('on-dsap', app && !desk);
        page.classList.toggle('on-desk', desk);
        // another page on screen: the applet stops (its timers, socket listeners); Back starts it again
        if (!app) leaveDsap();
        els.frameWrap.hidden = home;
        if (!home || (entry().grim.kind === 'home' && !desk)) W.grimLoading = false;
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
                <div class="wmb-desk grimoire-window" hidden><div class="wmb-desk-page tag-wiki-search-display selectable"><div class="wmb-desk-dsap tag-wiki-display-content" hidden></div></div></div>
                <div class="wmb-frame-wrap" hidden>
                    <div class="wmb-touch"></div>
                </div>`;
        const q = (sel) => t.content.querySelector(sel);
        const d = { home: q('.wmb-home'), gpage: q('.wmb-gpage'), dsap: q('.wmb-dsap'), dsapArea: q('.wmb-dsap-area'), core: q('.wmb-core'), desk: q('.wmb-desk'), deskPage: q('.wmb-desk-page'), deskDsap: q('.wmb-desk-dsap'), frameWrap: q('.wmb-frame-wrap'), touch: q('.wmb-touch') };
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

        // Desktop view: the desktop Grimoire's pages (their links are caught first, as .wmb-core's) and applets
        on(d.desk, 'click', onDeskClick, true);
        on(d.desk, 'click', onDsapClick);
        d.desk.addEventListener('contextmenu', (e) => { if (!d.deskDsap.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
        on(d.desk, 'contextmenu', (e) => { if (d.deskDsap.contains(e.target)) onDsapContextMenu(e); });
        on(d.desk, 'scroll', () => { if (W.deskShown && W.deskShown === entry()) W.deskShown.dScroll = [d.desk.scrollLeft, d.desk.scrollTop]; }, { passive: true });

        on(d.touch, 'pointerdown', onTouchDown);
        on(d.touch, 'pointermove', onTouchMove);
        on(d.touch, 'pointerup', onTouchUp);
        on(d.touch, 'pointercancel', onTouchUp);
        on(d.touch, 'wheel', onWheel, { passive: false });
        d.touch.addEventListener('contextmenu', (e) => e.preventDefault());
        applyZoom65();
        applyDeskZoom();
    }

    /** A window leaves for good: its Alchemy page, applet, timers and boxes go with it. */
    function disposeWin(w) {
        inWin(w, () => {
            clearTimeout(W.idleTimer);
            W.idleTimer = 0;
            leaveDsap();
            closeSession();
            // the pages it kept (a Grimoire page's HTML, a Fandom page's pane and box)
            W.entries.forEach((e) => { e.html = ''; e.area = null; e.pane = null; e.dArea = null; e.dPane = null; });
            W.localShown = null;
            W.coreShown = null;
            W.deskShown = null;
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
                for (const k of ['home', 'gpage', 'dsap', 'core', 'desk']) old.scrolls[k] = old.dom[k].scrollTop;
                old.scrolls.deskLeft = old.dom.desk.scrollLeft;
                for (const k of WIN_BOXES) old.dom[k].hidden = true;
            }
        }
        cur = w;
        W = w;
        w.shownAt = Date.now();
        // only the window on screen is captured (#756)
        if (old.frame && old.frame.contentWindow) old.frame.contentWindow.postMessage({ type: 'grimoire-browser-visibility', hidden: true }, location.origin);
        if (w.frame && w.frame.contentWindow) w.frame.contentWindow.postMessage({ type: 'grimoire-browser-visibility', hidden: false }, location.origin);
        if (w.memoryLimit) { const m = w.memoryLimit; w.memoryLimit = null; setTimeout(() => inWin(w, () => askMemoryLimit(m)), 0); }
        if (!page) return true;
        // the window left behind falls silent; its page and applet are let go after WINDOW_IDLE_MS
        inWin(old, () => { clearTimeout(W.idleTimer); W.idleTimer = 0; syncPageShown(); armDsapIdle(); });
        clearTimeout(w.dsapIdleTimer);
        w.dsapIdleTimer = 0;
        // its web page was let go while it was behind: it comes back from its address
        if (visible && !onHome() && !W.session && !W.creating) { entry().pending = true; openSession(entry().url); }
        // the view changed while this window was behind: its page asks for the other kind of site now
        syncViewKind();
        render();
        // a box that was hidden may come back at the top: where it was left
        if (w.scrolls) {
            for (const k of Object.keys(w.scrolls)) if (w.dom[k] && w.dom[k].scrollTop !== w.scrolls[k]) w.dom[k].scrollTop = w.scrolls[k];
            if (w.dom.desk.scrollLeft !== w.scrolls.deskLeft) w.dom.desk.scrollLeft = w.scrolls.deskLeft || 0;
        }
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
        viewMode = resolveView();
        page.classList.add('wm-browser');
        page.innerHTML = `
            <div class="wmb-bar">
                <button type="button" class="wmb-back" aria-label="Back" hidden>${img4('ie-back2')}</button>
                <span class="wmb-lock" aria-hidden="true"></span>
                <div class="wmb-addr-box">
                    <input type="url" class="wmb-addr" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="Address">
                    <button type="button" class="wmb-addr-drop" aria-label="Recent addresses" aria-haspopup="menu"></button>
                </div>
                <button type="button" class="wmb-wins" aria-label="Windows">${img4('ie-wins')}</button>
                <button type="button" class="wmb-go" aria-label="Go"></button>
            </div>
            <div class="wmb-view">
                <div class="wmb-busy" aria-hidden="true"></div>
                <div class="wmb-sub" hidden></div>
                <textarea class="wmb-ime" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type into the page"></textarea>
            </div>`;
        els = {
            bar: page.querySelector('.wmb-bar'),
            back: page.querySelector('.wmb-back'),
            winsBtn: page.querySelector('.wmb-wins'),
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
        for (const k of WIN_BOXES.concat(['dsapArea', 'deskPage', 'deskDsap', 'touch'])) Object.defineProperty(els, k, { enumerable: true, get: () => (W.dom ? W.dom[k] : null) });
        wins.forEach(buildDom);

        els.addr.addEventListener('focus', () => { addrEditing = true; setTimeout(() => els.addr.select(), 0); });
        els.addr.addEventListener('blur', () => { setTimeout(() => { addrEditing = false; renderAddress(); }, 150); });
        els.addr.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitAddress(); }
            if (e.key === 'Escape') { e.preventDefault(); addrEditing = false; els.addr.blur(); renderAddress(); }
        });
        // the green arrow: Go while the address is being edited, Refresh otherwise (6.5 device: it
        // reloads the page; 6.1 device: it opens the same address again). Before #748 it sent the
        // address through navigate() in both cases: the start page and a running applet answered
        // "already here" and nothing happened, a Grimoire or web page was added to the history again.
        let goEditing = false;
        els.go.addEventListener('pointerdown', () => { goEditing = addrEditing || document.activeElement === els.addr; });
        els.go.addEventListener('click', () => {
            const editing = goEditing || addrEditing;
            goEditing = false;
            if (W.loading && !onHome() && !editing) { stop(); return; }
            const text = els.addr.value.trim();
            if (!editing || text === (entry().url || '')) {
                addrEditing = false;
                els.addr.blur();
                renderAddress();
                if (sub) closeSub();
                refresh();
                return;
            }
            if (text) submitAddress();
            else els.addr.focus();
        });
        els.back.addEventListener('click', () => { if (W.idx > 0) goBack(); });
        els.winsBtn.addEventListener('click', () => { if (sub === 'windows') closeSub(); else openSub('windows'); });
        applyOpts();
        els.drop.addEventListener('click', (e) => {
            e.stopPropagation();
            const typed = readList(TYPED_KEY);
            const items = typed.length ? typed.map((u) => ({ label: u, action: () => { els.addr.value = u; navigate(u); } })) : [{ label: '(Empty)', disabled: true }];
            ws.dropdown(els.addr.parentElement, items, 'left');
        });

        // the bar's zoom button takes its stored use (windows) once the bar is there
        if (v65) { mount65(); applyOpts(); }

        // the Sessions and Alchemy pages' check boxes and numbers save as they change (#756)
        els.sub.addEventListener('change', (e) => { if (sub === 'options' || sub === 'opt-sessions' || sub === 'opt-alchemy') sessionFormChange(e); });
        els.sub.addEventListener('click', (e) => {
            if (sub === 'windows') { windowsClick(e); return; }
            if (SESSION_SUBS.has(sub)) { sessionSubClick(e); return; }
            if ((sub === 'opt-sessions' || sub === 'opt-alchemy') && sessionFormClick(e)) return;
            if (v65) { subClick65(e); return; }
            if (sub === 'options') { optionsClick61(e); return; }
            if (sub === 'props') return;
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
            // the shell's own signal for a new screen size (wmShell syncPixelScale, syncBezel)
            addEventListener('resize', onScreenResize);
            // a new pixel ratio (another screen, browser zoom) changes the frame size, not the page area
            const watchDpr = () => {
                const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
                mq.addEventListener('change', () => { if (page) layoutFrame(); watchDpr(); }, { once: true });
            };
            watchDpr();
            // pagehide no longer closes the pages (#756): the registry keeps them for the idle time
            // (Internet Options > Sessions), so the desktop can take them from Other Devices
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
                // Automatic: the screen may have changed while IE was behind another program
                if (viewChoice === VIEW_AUTO && resolveView() !== viewMode) applyView();
                else syncViewKind();
                render();
                // the windows behind the one on screen: their pages and applets wait their own, longer time
                wins.forEach((w) => { if (w !== cur) inWin(w, () => { syncPageShown(); armDsapIdle(); }); });
                if (sub) renderSub();
                syncAudio();
                // Restore Session, the first time IE shows after the phone starts (#756)
                maybeRestore();
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
                // Properties and Options have no soft keys (device); the windows view: New / Close
                if (sub === 'props' || sub === 'options') return { left: null, right: null };
                if (SESSION_SUBS.has(sub)) return sessionSubKeys();
                if (sub === 'windows') return { left: { label: 'New', disabled: wins.length >= MAX_WINDOWS, action: () => { closeSub(); newWindow(); } }, right: { label: 'Close', action: closeSub } };
                if (sub) {
                    return {
                        left: { label: 'Go', disabled: subSel < 0, action: () => openSubRow(subSel) },
                        right: { label: 'Menu', menu: subMenu }
                    };
                }
                return { left: leftKey(), right: { label: 'Menu', menu: mainMenu } };
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
            // Today's Internet Explorer item (wmTodayWidgets.js)
            openFavorites() { ws.open(APP_ID); openSub('favorites'); },
            openHistory() { ws.open(APP_ID); openSub('history'); },
            otherDevices() { ws.open(APP_ID); return openDevices(); },
            takeTab(sessionId, tabId) { ws.open(APP_ID); return takeDeviceTab(sessionId, tabId); },
            /** engine 'grimoire': the start page's own search (the Grimoire's search page); 'web': the web search. In the window on screen, as open(url). */
            search(engine, text) {
                const q = String(text == null ? '' : text).trim();
                if (!q) return false;
                return window.wmBrowser.open(engine === 'web' ? 'https://www.bing.com/search?q=' + encodeURIComponent(q) : 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(q));
            },
            sessionSnapshot,
            // tests: the pages seen in the window on screen and where Chromium is
            _state: () => ({ entries: W.entries.map((e) => (e.home ? (e.grim.kind === 'home' ? 'home' : e.url) : e.url)), idx: W.idx, dsap: W.dsapShell && W.dsapShell._dsapState ? W.dsapShell._dsapState.url : null, idle: !!W.idleTimer, inspect: W.pendingInspect, chromeAt: W.chromeAt, chromeBase: W.chromeBase, session: W.session && W.session.id, loading: W.loading, frame: !!W.frame, ready: W.ready, viewMode, viewChoice, viewKind: W.session ? W.session.kind : null, wide: wideScreen(), zoomKey, geometry: els.view ? geometry() : null, win: cur.id, windows: wins.length, maxWindows: MAX_WINDOWS })
        };
        if (window.browsingSessions) {
            window.browsingSessions.register(sessionSnapshot);
            // IE shown before the server knew this client: ask once it does
            window.browsingSessions.on('ready', () => { if (visible) maybeRestore(); });
        }
        // ActiveSync's Send to Device from the desktop's IE (#756): open.item { kind: 'url', url, title, history, alchemyId, from }.
        // An Alchemy page moves here (the computer's tab says it was transferred); anything else opens from its address.
        if (window.activeSync && typeof window.activeSync.registerOp === 'function') {
            window.activeSync.registerOp('open.item', (args, from) => {
                const a = args || {};
                if (a.kind !== 'url' || !a.url) throw Object.assign(new Error('Only web pages can be opened here.'), { code: 'UNSUPPORTED' });
                const who = String(a.from || (from && from.name) || 'A computer');
                const go = async () => {
                    ws.open(APP_ID);
                    let tab = { url: a.url, title: a.title || '', history: a.history || [] };
                    if (a.alchemyId && window.browsingSessions) {
                        try {
                            const res = await window.browsingSessions.takeBack(a.alchemyId, { windowId: 'wmie', size: { width: geometry().L, height: geometry().Lh } });
                            if (res && res.tab) tab = res.tab;
                        } catch (_) { /* the page closed meanwhile: its address */ }
                    }
                    if (!openTakenTab(tab)) ws.messageBox({ title: 'Internet Explorer', icon: 'error', text: `Every window is in use (${MAX_WINDOWS}). Close a window, then try again.` });
                };
                ws.notify({ title: 'Internet Explorer', icon: 'info', asNote: true, text: `${who} sent a page: ${a.title || a.url}`, buttons: [{ text: 'Open', onClick: () => { go(); } }, { text: 'Dismiss' }] });
                return { shown: true };
            });
            window.browsingSessions.on('tabTaken', (msg) => {
                const w = wins.find((x) => x.session && x.session.id === (msg && msg.alchemyId));
                if (w) inWin(w, () => showTransferred({ to: msg.to || '' }));
            });
        }
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
