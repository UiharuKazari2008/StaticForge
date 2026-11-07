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
 * Sessions: Alchemy has a 4-session cap, so the session is closed when the app is closed (title
 * X), 60 s after the app goes behind another, and when the tab goes away.
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

    const GRIMOIRE_ONLY = 'Dreamscape apps (dsap: addresses) open on the desktop. Internet Explorer on this phone shows web pages and the Grimoire.';
    // the Grimoire's own pages (tagWikiSearchModal.js addresses), drawn here without Alchemy
    const GRIM_HOME_URL = 'edtx://en.grimoire.jp/index.dtxt';
    const RECENT_KEY = 'dreamWikiRecentPages'; // DREAMWIKI_RECENT_STORAGE_KEY, shared with the desktop Grimoire
    const RECENT_MAX = 20;
    const ALCHEMY_HOME = 'https://www.bing.com/'; // ALCHEMY_HOME_URL: public/scripts/comp/featureLoader.js

    let ws = null; // window.wmShell
    let page = null;
    let els = {};
    let sub = null; // null | 'favorites' | 'history'
    let subSel = -1;
    // pages seen here: Grimoire pages { home: true, grim, url, title } (no Alchemy) | web pages { url, title, pending }
    const homeEntry = () => ({ home: true, grim: { kind: 'home' }, url: GRIM_HOME_URL, title: 'Grimoire' });
    let entries = [homeEntry()];
    let idx = 0;
    let chromeAt = -1; // the entry Chromium is on
    let chromeBase = 0; // entries before this are not in Chromium's history (a new session)
    let pendingDir = 0;
    let session = null; // { id, viewUrl, query }
    let creating = null;
    let wantUrl = ''; // the address the newest openSession asked for (a session being made loads this one)
    let frame = null;
    let ready = false;
    let loading = false;
    let visible = false;
    let idleTimer = 0;
    let favorites = [];
    let favoritesLoaded = false;
    let settings = null;
    let addrEditing = false;
    // the newest inspect request: 'tap' | { x, y } (tap-and-hold at a point). The viewer keeps one too and
    // answers only the newest, so a single slot (with a time limit) stays in step with it.
    let pendingInspect = null;
    const INSPECT_MS = 1500;
    let pendingInspectAt = 0;
    let lastPushAt = 0; // a page link added an entry
    let lastInputAt = 0; // the last tap or key sent to the page
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

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isCurrent = () => !!(ws && ws.current === APP_ID);
    const entry = () => entries[idx] || homeEntry();
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
        const V = base / zoomFactor();
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
        if (!frame || !els.view.clientWidth) return;
        const g = geometry();
        frame.style.width = `${g.L}px`;
        frame.style.height = `${g.Lh}px`;
        frame.style.transform = `scale(${1 / g.s})`;
        if (ready) {
            post({ type: 'grimoire-browser-zoom', value: g.z });
            // a still at the phone's own pixels once the page settles (older viewers ignore it)
            post({ type: 'grimoire-browser-scale', value: g.d });
        }
    }

    function post(msg) {
        if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, location.origin);
    }

    // ---------------------------------------------------------------- sessions

    function closeSession() {
        clearTimeout(idleTimer);
        idleTimer = 0;
        const s = session;
        session = null;
        ready = false;
        chromeAt = -1;
        pendingInspect = null;
        if (frame) { frame.remove(); frame = null; }
        setLoading(false);
        if (!s) return Promise.resolve();
        return fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(s.id), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {});
    }

    async function cannotConnect(detail) {
        setLoading(false);
        await ws.messageBox({
            title: 'Cannot Connect',
            icon: 'error',
            text: detail || 'The page cannot be displayed. Alchemy, which loads web pages for this phone, cannot be reached right now. Try again later.'
        });
    }

    /** A new Alchemy session showing url (the entry at idx). */
    async function openSession(url) {
        // a later request (a link from another app, a favorite tapped while the first page is still
        // being made) wins: the session is made for the newest address
        wantUrl = url;
        if (creating) return creating;
        creating = (async () => {
            await closeSession();
            let res;
            let payload = {};
            for (;;) {
                const g = geometry();
                const asked = wantUrl;
                setLoading(true);
                try {
                    res = await fetch('/api/grimoire-browser/sessions', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: asked, width: g.L, height: g.Lh, popup: false })
                    });
                } catch (_) {
                    await cannotConnect();
                    return false;
                }
                payload = {};
                try { payload = await res.json(); } catch (_) { /* empty */ }
                if (wantUrl === asked || !res.ok || !payload.viewUrl) break;
                // another address was asked for while this one was made: let it go and make the newest
                if (payload.sessionId) fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(payload.sessionId), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {});
            }
            if (res.status === 429) {
                await cannotConnect('Alchemy already has as many pages open as it can (4). Close a web page on the desktop, then try again.');
                return false;
            }
            if (!res.ok || !payload.viewUrl) {
                await cannotConnect(res.status === 503 ? 'The page cannot be displayed. Alchemy is not set up on this server.' : null);
                return false;
            }
            session = { id: payload.sessionId || '', viewUrl: payload.viewUrl, query: String(payload.viewUrl).split('?')[1] || '' };
            chromeAt = idx;
            chromeBase = idx;
            frame = document.createElement('iframe');
            frame.className = 'wmb-frame';
            frame.title = 'Web page';
            frame.setAttribute('referrerpolicy', 'no-referrer');
            frame.setAttribute('allow', 'autoplay; clipboard-read; clipboard-write');
            els.frameWrap.prepend(frame);
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
            return true;
        })();
        try { return await creating; } finally { creating = null; }
    }

    function scheduleIdleClose() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { idleTimer = 0; if (pageAway()) closeSession(); }, IDLE_CLOSE_MS);
    }

    /** The web page is not on screen: IE is hidden, or the start page, Favorites or History shows. */
    function pageAway() {
        return !visible || onHome() || !!sub;
    }

    /** The page left the screen (start page, Favorites, History): it falls silent and Alchemy lets it go
     *  after a while; it came back: the timer stops (a page let go reopens from its address). */
    function syncPageShown() {
        syncAudio();
        if (!visible) return;
        if (pageAway()) { if (session && !idleTimer) scheduleIdleClose(); }
        else if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
    }

    function syncAudio() {
        if (!ready) return;
        const on = visible && !pageAway() && !document.hidden && !(settings && settings.audioEnabled === false);
        const vol = settings && settings.audioVolume !== undefined ? settings.audioVolume / 100 : 1;
        let master = 1;
        try { if (window.tabVolume && typeof window.tabVolume.masterGain === 'function') master = window.tabVolume.masterGain(); } catch (_) { /* none */ }
        post({ type: 'grimoire-browser-audio', on, volume: vol * master });
    }

    // ---------------------------------------------------------------- navigation

    function webCount(upTo) {
        let n = 0;
        for (let i = 0; i <= upTo && i < entries.length; i++) if (!entries[i].home) n++;
        return n;
    }

    function step() {
        if (ws) { ws.syncHistory(); if (isCurrent()) ws.refreshSoftKeys(); }
    }

    /** Go to a web address (typed, a favorite, a link from elsewhere). */
    function navigate(raw, title) {
        if (!raw) return;
        const url = webUrl(raw);
        if (!url) {
            // the Grimoire's own pages show here; dsap: apps (and chrome:) are saved in the shared favorites but Alchemy cannot open them
            const g = parseGrim(raw);
            if (g) openLocal(g, title);
            else if (ws) ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: GRIMOIRE_ONLY });
            return;
        }
        pendingInspect = null;
        closeSub();
        noteHistory(url, title);
        entries = entries.slice(0, idx + 1);
        entries.push({ url, title: title || '', pending: true });
        idx = entries.length - 1;
        pendingDir = 0;
        render();
        step();
        if (session && frame && ready) {
            chromeAt = idx;
            setLoading(true);
            post({ type: 'grimoire-browser-navigate', url });
        } else {
            const added = entries[idx];
            openSession(url).then((ok) => {
                // no page: back to where the address was typed
                if (ok || entries[idx] !== added) return;
                entries.splice(idx, 1);
                idx -= 1;
                render();
                step();
            });
        }
    }

    function goHome() {
        closeSub();
        if (onHome() && entry().grim.kind === 'home') return;
        pushLocal(homeEntry());
    }

    function pushLocal(e) {
        pendingInspect = null;
        entries = entries.slice(0, idx + 1);
        entries.push(e);
        idx = entries.length - 1;
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
        if (target < 0 || target >= entries.length || target === idx) return false;
        idx = target;
        pendingDir = 0;
        pendingInspect = null;
        const e = entries[target];
        render();
        step();
        if (e.home) return true;
        if (!session) { e.pending = true; chromeBase = target; openSession(e.url); return true; }
        const steps = chromeAt >= chromeBase && target >= chromeBase ? webCount(target) - webCount(chromeAt) : NaN;
        if (steps === 0) return true;
        setLoading(true);
        if (steps === 1 || steps === -1) {
            pendingDir = steps;
            chromeAt = target;
            post({ type: 'grimoire-browser-history', dir: steps });
        } else {
            e.pending = true;
            chromeAt = target;
            chromeBase = target;
            post({ type: 'grimoire-browser-navigate', url: e.url });
        }
        return true;
    }

    function goBack() {
        if (sub) { closeSub(); return true; }
        return goTo(idx - 1);
    }

    function goForward() { goTo(idx + 1); }

    function refresh() {
        if (onHome()) { renderLocal(true); return; }
        if (!session) { entry().pending = true; openSession(entry().url); return; }
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
        let e = entries[chromeAt >= 0 ? chromeAt : idx];
        if (pendingDir) {
            // Chromium stepped where we asked: it may land on another address (a redirect)
            pendingDir = 0;
            e = entries[chromeAt];
            if (e && !e.home) { e.url = url; if (title) e.title = title; }
        } else if (e && !e.home && (e.pending || e.url === url)) {
            if (e.pending) lastPushAt = Date.now();
            e.url = url;
            if (title) e.title = title;
            e.pending = false;
        } else if (e && !e.home && lastPushAt > lastInputAt && Date.now() - lastPushAt < 1500) {
            // a second address straight after a new page, with no tap or key between: the page
            // replaced its address (replaceState, a script redirect), Chromium has no new entry
            e.url = url;
            if (title) e.title = title;
        } else {
            // a link in the page: a new page after the one Chromium is on
            lastPushAt = Date.now();
            const at = chromeAt >= 0 ? chromeAt : idx;
            entries = entries.slice(0, at + 1);
            entries.push({ url, title });
            idx = entries.length - 1;
            chromeAt = idx;
            noteHistory(url, title);
            step();
        }
        if (e && !e.home && title) noteHistory(e.url, e.title);
        if (chromeAt === idx) renderAddress();
    }

    function onHistoryEnd(dir) {
        // Chromium has nothing that way: open the entry ourselves
        pendingDir = 0;
        const e = entries[chromeAt];
        if (!e) return;
        if (e.home) { setLoading(false); return; }
        e.pending = true;
        chromeBase = chromeAt;
        post({ type: 'grimoire-browser-navigate', url: e.url });
        void dir;
    }

    function setLoading(on) {
        loading = !!on;
        if (!page) return;
        page.classList.toggle('is-loading', loading && !onHome());
        renderGoButton();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- frame messages

    function onMessage(event) {
        if (!frame || event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data || typeof data.type !== 'string') return;
        switch (data.type) {
            case 'grimoire-browser-ready':
                ready = true;
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
                session = null;
                ready = false;
                if (frame) { frame.remove(); frame = null; }
                chromeAt = -1;
                setLoading(false);
                goHome();
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

    function onPopup(data) {
        // one page at a time on the phone: a new window's page opens here; an adopted popup session is let go
        if (data.sessionId) fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(data.sessionId), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {});
        const url = webUrl(data.url);
        if (url) navigate(url);
    }

    /**
     * An upload field on the page: WM's Open dialog over the VFS (wmFileDialogs.js), as the desktop's
     * IE answers it with its file dialog (grimoireRemoteBrowser.js grimoireShowFileChooser); Menu >
     * Browse device... takes the phone's own files (the browser's picker). The files go to the
     * remote browser's file-chooser routes and the page's input gets them; Cancel leaves it empty.
     */
    function chooseFile(data) {
        const s = session;
        const reply = (cancel) => post({ type: 'grimoire-browser-file-chooser-reply', id: data.id, cancel: !!cancel });
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
                    for (const file of (data.multiple ? files : files.slice(0, 1))) {
                        const res = await fetch(base + '/upload?' + s.query + '&name=' + encodeURIComponent(file.name), {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/octet-stream' },
                            body: file
                        });
                        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not upload ' + file.name);
                    }
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
                if (!visible && session) scheduleIdleClose();
            }
        });
        // the dialog hid IE: the page waits for the answer, not let go meanwhile
        clearTimeout(idleTimer);
        idleTimer = 0;
    }

    async function showDialog(data) {
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
        post(reply);
    }

    function showSelect(data) {
        const items = [];
        let group = '';
        data.options.forEach((o, i) => {
            if (o.group && o.group !== group) items.push({ label: o.group, disabled: true });
            group = o.group || '';
            items.push({ label: o.label || ' ', radio: i === data.selected, disabled: !!o.disabled, indent: o.group ? 1 : 0, action: () => post({ type: 'grimoire-browser-select-pick', index: i }) });
        });
        const r = frame.getBoundingClientRect();
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
        if (!session) return;
        let ws0 = 'default';
        try {
            // eslint-disable-next-line no-undef
            if (typeof activeWorkspace !== 'undefined' && activeWorkspace) ws0 = activeWorkspace;
        } catch (_) { /* none */ }
        try {
            const res = await fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(session.id) + '/save?' + session.query, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ filename, workspaceId: ws0 }, ref))
            });
            const info = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(info.error || 'The file could not be saved.');
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
        try { return frame && frame.contentDocument && frame.contentDocument.getElementById('view'); } catch (_) { return null; }
    }

    /** A pointer / mouse event on the viewer's canvas at a page point (phone px). */
    function fire(type, p, extra) {
        const canvas = viewerCanvas();
        if (!canvas) return false;
        const s = geometry().s;
        const win = frame.contentWindow;
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
        lastInputAt = Date.now();
        if (!fire('pointerdown', p)) return;
        fire('pointerup', p);
        // is it an edit field? the viewer's inspect answers (grimoire-browser-menu); a tap there raises the keyboard
        askInspect('tap');
        fire('contextmenu', p, { buttons: 0, button: 2 });
    }

    function askInspect(purpose) {
        pendingInspect = purpose;
        pendingInspectAt = Date.now();
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
        const purpose = pendingInspect;
        pendingInspect = null;
        // an answer that comes too late (the page was busy, or it moved on) is not the newest tap's
        if (!purpose || Date.now() - pendingInspectAt > INSPECT_MS) return;
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
        if (!items.length) {
            items.push({ label: 'Back', disabled: idx < 1, action: goBack });
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
        lastInputAt = Date.now();
        try {
            const win = frame && frame.contentWindow;
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
        if (!frame) return;
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
        if (!favoritesLoaded) await loadSettings();
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
        const yes = await ws.messageBox({ title: 'Internet Explorer', icon: 'question', text: `Delete '${f.title || f.url}' from Favorites?`, buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }] });
        if (!yes) return;
        try { await saveFavorites(favorites.filter((_, n) => n !== i)); } catch (_) { /* kept */ }
        subSel = Math.min(subSel, favorites.length - 1);
        renderSub();
    }

    // ---------------------------------------------------------------- sub pages (Favorites, History)

    function openSub(kind) {
        if (ws) ws.closeMenus();
        sub = kind;
        subSel = -1;
        renderSub();
        syncPageShown();
        if (kind === 'favorites' && !favoritesLoaded) loadSettings().then(() => { if (sub === 'favorites') renderSub(); });
        step();
    }

    function closeSub() {
        if (!sub) return;
        sub = null;
        if (els.sub) els.sub.hidden = true;
        page.classList.remove('has-sub');
        // back on a web page whose session was let go while the list showed: it reopens from its address
        if (visible && !onHome() && !session && !creating) { entry().pending = true; openSession(entry().url); }
        syncPageShown();
        step();
    }

    function subRows() {
        if (sub === 'favorites') return favorites.map((f) => ({ url: f.url, title: f.title || f.url, sub: webUrl(f.url) ? hostOf(f.url) : parseGrim(f.url) ? 'Grimoire' : 'Desktop only', icon: 'ie-favorite' }));
        return readList(HISTORY_KEY).map((h) => ({ url: h.url, title: h.title || h.url, sub: h.at ? new Date(h.at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' }) : '', icon: 'ie-page' }));
    }

    function renderSub() {
        if (!sub) return;
        page.classList.add('has-sub');
        els.sub.hidden = false;
        const rows = subRows();
        const empty = sub === 'favorites' ? (favoritesLoaded ? 'No favorites.' : 'Loading...') : 'No history.';
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
        if (r) navigate(r.url, r.title);
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

    function mainMenu() {
        const web = !onHome();
        return [
            { label: 'Back', disabled: idx < 1, action: goBack },
            { label: 'Forward', disabled: idx >= entries.length - 1, action: goForward },
            { label: 'Home', action: goHome },
            loading && web ? { label: 'Stop', action: stop } : { label: 'Refresh', action: refresh },
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
                    { label: 'Paste', disabled: !web || !frame, action: pasteFromClipboard },
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
        const e = entry();
        const secure = /^https:/i.test(e.url || '');
        ws.messageBox({
            title: 'Properties',
            icon: 'info',
            text: e.home
                ? `${e.title || 'Grimoire'}\n\nAddress: ${e.url}\nLoaded by: Grimoire`
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
     * Dreamscape apps (dsap:), Fandom and the Apocrypha stay on the desktop.
     */
    function parseGrim(raw) {
        const text = String(raw || '').trim();
        let m;
        if (/^edtx:\/\/en\.grimoire\.jp\/?(?:index\.dtxt)?$/i.test(text)) return { kind: 'home' };
        if ((m = /^edtx:\/\/en\.grimoire\.jp\/search\/?(?:\?(.*))?$/i.exec(text))) {
            let q = '';
            try { q = new URLSearchParams(m[1] || '').get('q') || ''; } catch (_) { /* none */ }
            return q.trim() ? { kind: 'search', q: q.trim() } : { kind: 'home' };
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
        if (g.kind === 'search') return 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(g.q);
        if (g.kind === 'wiki') return 'edtx://wiki.danbooru.jp/tag/' + encodeURIComponent(String(g.tag).replace(/\s+/g, '_'));
        if (g.kind === 'site') return g.site === 'novelai' ? 'rdf://docs.novelai.jp/' : `edtx://en.grimoire.jp/docs/${g.site}`;
        if (g.kind === 'doc') return g.site === 'novelai' ? `rdf://docs.novelai.jp/${g.page}` : `edtx://en.grimoire.jp/docs/${g.site}/${g.page}`;
        return GRIM_HOME_URL;
    }

    function grimTitle(g) {
        if (g.kind === 'search') return `Search: ${g.q}`;
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

    let docSites = null; // get_wiki_home's documentation sites (Fandom stays on the desktop)
    let docSitesAsked = false;

    function loadDocSites() {
        if (docSitesAsked || !window.wsClient || !window.wsClient.isConnected || !window.wsClient.isConnected()) return;
        docSitesAsked = true;
        window.wsClient.sendMessage('get_wiki_home', {}).then((r) => {
            docSites = ((r && r.sites) || []).filter((x) => x && x.id && x.kind !== 'fandom');
            if (onHome() && entry().grim.kind === 'home') renderHomeLists();
        }).catch(() => { docSitesAsked = false; });
    }

    function renderHomeLists() {
        loadDocSites();
        const open = (k) => els.home.querySelector(`[data-exp="${k}"]`).getAttribute('aria-expanded') === 'true';
        const list = (k) => els.home.querySelector(`[data-list="${k}"]`);
        for (const k of ['start', 'recent', 'favorites', 'history']) list(k).hidden = !open(k);
        const row = (r) => (webUrl(r.url) ? webLink(r.url, r.title || r.url) : `<a class="wmb-home-link" href="${esc(r.url)}" data-url="${esc(r.url)}">${esc(r.title || r.url)}</a>`);
        if (open('start')) {
            const tagIcon = iconImg('/static_images/wm61/ie-page.png');
            const rows = [
                linkTo({ kind: 'wiki', tag: 'tag groups' }, 'Danbooru Tags', tagIcon),
                linkTo({ kind: 'wiki', tag: 'tag_group:index' }, 'e621 Tags', tagIcon)
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
        if (open('favorites')) list('favorites').innerHTML = favorites.length ? favorites.slice(0, 30).map((f) => row({ url: f.url, title: f.title })).join('') : `<div class="wmb-home-none">${favoritesLoaded ? 'No favorites.' : 'Loading...'}</div>`;
        if (open('history')) {
            const h = readList(HISTORY_KEY).slice(0, 15);
            list('history').innerHTML = h.length ? h.map(row).join('') : '<div class="wmb-home-none">No history.</div>';
        }
    }

    let localShown = null; // the entry drawn in .wmb-gpage

    /** Draw the Grimoire entry on screen (again with force: Refresh). */
    function renderLocal(force) {
        const e = entry();
        if (!e.home) return;
        if (e.grim.kind === 'home') { renderHomeLists(); return; }
        if (localShown === e && !force) return;
        localShown = e;
        const box = els.gpage;
        // Back and Forward show a page as it was left (its scroll too); Refresh asks the server again
        if (e.html && !force) {
            box.innerHTML = e.html;
            box.scrollTop = e.scroll || 0;
            return;
        }
        box.scrollTop = 0;
        box.innerHTML = '<div class="wmb-g-note">Loading...</div>';
        const still = () => localShown === e && entry() === e;
        const ws_ = window.wsClient;
        if (!ws_ || !ws_.isConnected || !ws_.isConnected()) {
            box.innerHTML = '<div class="wmb-g-note">The Grimoire cannot be reached: this phone is not connected to Dreamscape. Try again later.</div>';
            localShown = null;
            return;
        }
        loadGrimPage(e.grim, force).then((html) => {
            if (!still()) return;
            e.html = html;
            e.scroll = 0;
            box.innerHTML = html;
            const t = box.querySelector('[data-page-title]');
            if (t) { e.title = t.dataset.pageTitle; }
            noteHistory(e.url, e.title);
        }).catch((err) => {
            if (!still()) return;
            box.innerHTML = `<div class="wmb-g-note">${esc((err && err.message) || 'The page cannot be displayed.')}</div>`;
            localShown = null;
        });
    }

    const searchForm = (q) => `
        <form class="wmb-search wmb-g-search" action="#">
            <input type="search" class="wmb-search-input" value="${esc(q || '')}" autocomplete="off" enterkeyhint="search" placeholder="Search the Grim" aria-label="Search the Grimoire">
            <button type="submit" class="wmb-search-go" aria-label="Search">${img('ie-search')}</button>
        </form>`;

    async function loadGrimPage(g, force) {
        const send = (type, data) => window.wsClient.sendMessage(type, data);
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

    // ---------------------------------------------------------------- rendering

    function renderGoButton() {
        if (!els.go) return;
        const stopNow = loading && !onHome();
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
        const home = onHome();
        page.classList.toggle('on-home', home);
        page.classList.toggle('is-full', fullScreen);
        const start = home && entry().grim.kind === 'home';
        els.home.hidden = !start;
        els.gpage.hidden = !home || start;
        els.frameWrap.hidden = home;
        page.classList.toggle('is-loading', loading && !home);
        if (home) renderLocal(false);
        renderAddress();
        if (!home) requestAnimationFrame(layoutFrame);
        syncPageShown();
    }

    function submitAddress() {
        const text = els.addr.value.trim();
        if (!text) return;
        const url = webUrl(text) || searchUrl(text);
        if (/^(edtx|rdf|dsap):/i.test(text)) {
            const g = parseGrim(text);
            addrEditing = false;
            els.addr.blur();
            if (g) openLocal(g);
            else ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: GRIMOIRE_ONLY });
            return;
        }
        if (webUrl(text)) noteTyped(url);
        addrEditing = false;
        els.addr.blur();
        navigate(url);
    }

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
                <div class="wmb-home">
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
                <div class="wmb-frame-wrap" hidden>
                    <div class="wmb-touch"></div>
                    <div class="wmb-busy" aria-hidden="true"></div>
                </div>
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
            home: page.querySelector('.wmb-home'),
            gpage: page.querySelector('.wmb-gpage'),
            frameWrap: page.querySelector('.wmb-frame-wrap'),
            touch: page.querySelector('.wmb-touch'),
            sub: page.querySelector('.wmb-sub'),
            ime: page.querySelector('.wmb-ime')
        };

        els.addr.addEventListener('focus', () => { addrEditing = true; setTimeout(() => els.addr.select(), 0); });
        els.addr.addEventListener('blur', () => { setTimeout(() => { addrEditing = false; renderAddress(); }, 150); });
        els.addr.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitAddress(); }
            if (e.key === 'Escape') { e.preventDefault(); addrEditing = false; els.addr.blur(); renderAddress(); }
        });
        els.go.addEventListener('click', () => {
            if (loading && !onHome() && !addrEditing) { stop(); return; }
            if (els.addr.value.trim()) submitAddress();
            else els.addr.focus();
        });
        els.drop.addEventListener('click', (e) => {
            e.stopPropagation();
            const typed = readList(TYPED_KEY);
            const items = typed.length ? typed.map((u) => ({ label: u, action: () => { els.addr.value = u; navigate(u); } })) : [{ label: '(Empty)', disabled: true }];
            ws.dropdown(els.addr.parentElement, items, 'left');
        });

        page.querySelector('.wmb-search').addEventListener('submit', (e) => {
            e.preventDefault();
            const input = page.querySelector('.wmb-search-input');
            const q = input.value.trim();
            if (!q) { input.focus(); return; }
            input.blur();
            if (webUrl(q)) navigate(webUrl(q));
            else openLocal({ kind: 'search', q });
            input.value = '';
        });
        els.home.addEventListener('click', (e) => {
            const exp = e.target.closest('.wmb-exp');
            if (exp) {
                exp.setAttribute('aria-expanded', exp.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
                if (exp.dataset.exp === 'favorites' && !favoritesLoaded) loadSettings().then(renderHomeLists);
                renderHomeLists();
                return;
            }
            onLocalClick(e);
        });
        els.gpage.addEventListener('click', onLocalClick);
        els.gpage.addEventListener('scroll', () => { if (localShown && localShown === entry()) localShown.scroll = els.gpage.scrollTop; }, { passive: true });
        els.gpage.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = e.target.querySelector('input');
            const q = input ? input.value.trim() : '';
            if (!q) { if (input) input.focus(); return; }
            input.blur();
            openLocal({ kind: 'search', q });
        });

        els.sub.addEventListener('click', (e) => {
            const row = e.target.closest('.wmb-sub-row');
            if (!row) return;
            subSel = Number(row.dataset.i);
            openSubRow(subSel);
        });
        let holdTimer = 0;
        els.sub.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.wmb-sub-row');
            if (!row) return;
            const { clientX, clientY } = e;
            holdTimer = setTimeout(() => {
                subSel = Number(row.dataset.i);
                renderSub();
                ws.menuAt(clientX, clientY, [{ label: 'Open', action: () => openSubRow(subSel) }, '-'].concat(subMenu().slice(0, -2)));
                const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                els.sub.addEventListener('click', swallow, { capture: true, once: true });
            }, LONG_PRESS_MS);
        });
        ['pointerup', 'pointercancel', 'pointermove'].forEach((t) => els.sub.addEventListener(t, (e) => {
            if (t !== 'pointermove' || Math.abs(e.movementY) > 3) clearTimeout(holdTimer);
        }));
        els.sub.addEventListener('contextmenu', (e) => e.preventDefault());

        els.touch.addEventListener('pointerdown', onTouchDown);
        els.touch.addEventListener('pointermove', onTouchMove);
        els.touch.addEventListener('pointerup', onTouchUp);
        els.touch.addEventListener('pointercancel', onTouchUp);
        els.touch.addEventListener('wheel', onWheel, { passive: false });
        els.touch.addEventListener('contextmenu', (e) => e.preventDefault());

        els.ime.addEventListener('input', onImeInput);
        els.ime.addEventListener('keydown', onImeKey);

        // the SIP button types into the page while a web page shows (the shell's own handler focuses the first edit box)
        document.addEventListener('click', (e) => {
            if (!isCurrent() || onHome() || sub || !frame) return;
            if (!e.target.closest || !e.target.closest('#wmShell .wm-sip')) return;
            e.stopImmediatePropagation();
            if (document.activeElement === els.ime) els.ime.blur();
            else focusIme();
        }, true);

        if (typeof ResizeObserver === 'function') {
            let t = 0;
            new ResizeObserver(() => { clearTimeout(t); t = setTimeout(layoutFrame, 60); }).observe(els.view);
        }
        addEventListener('message', onMessage);
        // a new pixel ratio (another screen, browser zoom) changes the frame size, not the page area
        const watchDpr = () => {
            const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            mq.addEventListener('change', () => { layoutFrame(); watchDpr(); }, { once: true });
        };
        watchDpr();
        addEventListener('pagehide', () => { if (session) closeSession(); });
        document.addEventListener('visibilitychange', syncAudio);
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
                clearTimeout(idleTimer);
                idleTimer = 0;
                if (!settings) loadSettings().then(() => { if (onHome()) renderHomeLists(); syncAudio(); });
                // the session was let go while away: the page comes back from its address
                if (!onHome() && !sub && !session && !creating) { entry().pending = true; openSession(entry().url); }
                render();
                if (sub) renderSub();
                syncAudio();
            },
            hide() {
                visible = false;
                ws.closeMenus();
                if (document.activeElement === els.ime) els.ime.blur();
                // the Alchemy frame (or the address box) lets go of the focus: keys go to the app on screen
                const a = document.activeElement;
                if (a && page && page.contains(a) && typeof a.blur === 'function') a.blur();
                syncAudio();
                if (session) scheduleIdleClose();
            },
            onTitleAction() {
                // X closes Internet Explorer: Alchemy's session goes now (it has only four)
                closeSession();
                sub = null;
                if (els.sub) els.sub.hidden = true;
                page.classList.remove('has-sub');
                entries = [homeEntry()];
                idx = 0;
                render();
            },
            historyDepth: () => idx + (sub ? 1 : 0),
            onBack: () => goBack(),
            softKeys() {
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
                const u = webUrl(url);
                const g = u ? null : parseGrim(url);
                if (!u && !g) return false;
                ws.open(APP_ID);
                if (u) navigate(u);
                else openLocal(g);
                return true;
            },
            closeSession,
            // tests: the pages seen here and where Chromium is
            _state: () => ({ entries: entries.map((e) => (e.home ? (e.grim.kind === 'home' ? 'home' : e.url) : e.url)), idx, idle: !!idleTimer, inspect: pendingInspect, chromeAt, chromeBase, session: session && session.id, loading, frame: !!frame, ready, viewMode, zoomKey, geometry: els.view ? geometry() : null })
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
     * Dreamscape apps (dsap:, such as NovelAI Explore from Studio) have no phone page: they get IE's
     * own message (as typed in the address bar), not the desktop Grimoire window, which stayed open
     * hidden behind the shell or became a Done-only tool page over Studio.
     */
    function isDsapAddress(address) {
        return /^dsap:/i.test(address) || (!!address && !/^(?:edtx|rdf|https?):/i.test(address) && typeof window.isDsapPseudoUrl === 'function' && !!window.isDsapPseudoUrl(address));
    }

    function dsapMessage() {
        ws.messageBox({ title: 'Internet Explorer', icon: 'info', text: GRIMOIRE_ONLY });
    }

    function openGrimoireTarget(target) {
        const t = target || {};
        const address = String(t.url || t.address || '').trim();
        if (isDsapAddress(address)) { dsapMessage(); return true; }
        if (window.wmBrowser.open(address)) return true;
        ws.open(APP_ID);
        const g = t.tag ? { kind: 'wiki', tag: String(t.tag) } : parseGrim(address);
        if (g && g.kind !== 'home') openLocal(g);
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
            // dsapRegistry.js: every dsap: opener (Studio's Explore, the Director's lookback links, a
            // standalone applet window) ends in the desktop Grimoire; on the phone they get the message
            const desktopOpenDsap = window.openDsapInGrimoire;
            if (typeof desktopOpenDsap === 'function' && !desktopOpenDsap._wmBrowser) {
                const phoneOpenDsap = async function (url) {
                    const address = String(url || '').trim();
                    if (!address) return undefined;
                    if (isDsapAddress(address)) { dsapMessage(); return undefined; }
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
