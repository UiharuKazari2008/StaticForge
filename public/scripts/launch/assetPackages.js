/**
 * Melaton asset packages (Yozora #774): which client needs which files. Shared by the server
 * (web_server.js: the manifest, its digest and the install packs per package set) and every page
 * (app.html / launch.html before anything is fetched, serviceWorkerManager's live update lists,
 * Melaton Update's Applied Updates), so both sides always draw the same line.
 *
 * Core is everything not in a package: every client has it (the desktop and Melaton Mobile share
 * their code, so the shell's scripts and styles are core). The packages are Melaton Mobile's art:
 *   wm61      Melaton Mobile 6.1                   public/static_images/wm61, 1x files
 *   wm61-2x   Melaton Mobile 6.1 (for HiDPI)       its @2x files
 *   wm61-4x   Melaton Mobile 6.1 (for UHiDPI)      its @4x files
 *   wm65 / wm65-2x / wm65-4x                       the same for 6.5
 *   wmc / wmc-2x / wmc-4x   Melaton Mobile Common: art both versions draw
 *                           (public/static_images/wm-android, the Android programs' WM icons; its
 *                           manifest.json stays core), and Weather's art (static_images/wm61/weather)
 * and 'source': the animation frames the strips and the status atlas are built from (no client
 * loads them; scripts/build-wm-sprite-strips.sh, build-wm-status-atlas.py), shipped to nobody.
 *
 * Media Player's older visualizations: wmpvis-classic, public/scripts/comp/desktop-apps/wmpvis/, added by
 * Media Player's Download Visualizations (mediaPlayerViz.js) and removed in Applied Updates.
 *
 * The desktop's HiDPI art (#921, DreamOS fractional scaling): hidpi-125 / hidpi-150 / hidpi-175 /
 * hidpi-200 are public/static_images/hidpi/<tier>/, the 1.25x ... 2x copies of the Vista art
 * (scripts/build-hidpi-assets.js). A desktop page (also a phone's DeX window) keeps the one tier its
 * devicePixelRatio needs (the smallest at or above it, 2x above that), noted at boot and again when
 * the scale changes (a DreamOS DPI change, a move to another screen); the stylesheets' image-set()
 * picks the same density, and the tier's img.css (linked here) gives <img> art its copy. A client
 * from before packages (no cookie) gets every package but these.
 *
 * The client's set: automatic (Melaton Mobile booted here: its version, and the density tiers up to
 * the screen's: 1x = wm61, 2x = + wm61-2x, 4x = + wm61-4x; 6.5 also takes 6.1's, which it draws) plus the ones added in Melaton Update >
 * Applied Updates (pinned, e.g. a phone that also runs a desktop in DeX). The mobile bit stays once
 * set, so a hybrid client keeps its phone art while it runs the desktop. Stored in localStorage
 * 'melatonPackages' and mirrored in the cookie 'melaton_pkgs' (the service worker's and /launch's own
 * requests carry it with no code of theirs): a comma list, or 'none' for core only. No cookie = a
 * client from before packages: the server gives it everything, as before.
 *
 * Melaton Mobile's lighter install (#890): a phone (the mobile bit, and a Melaton Mobile boot that ran
 * on a handheld: the Android app, or a browser that says it is a phone; and so its DeX window too)
 * also carries the flag 'mobile' in its set, and its manifest leaves out the core files a phone
 * fetches only when something shows them (phoneOptional): the Desktop Background photos and the
 * Sidebar's art ('wifi': the service worker fetches one when it is asked for and keeps it, and fills
 * in the rest in the background while the phone is on Wi-Fi, sw.js PHONE_WIFI_PREFIXES), and font
 * files no phone browser reads ('demand': every @font-face naming one lists a WOFF2 before it).
 * Desktop clients keep them all, also a desktop browser that once started narrower than 1200 px (it
 * boots Melaton Mobile and keeps the mobile bit for its art, but it is not a handheld).
 *
 *   packageOf(url)            null (core) | package id | 'source'
 *   phoneOptional(url)        null | 'wifi' | 'demand': left out of a 'mobile' set's install
 *   PACKAGES                  [{ id, label, version, tier }]
 *   current()                 the active ids (sorted)
 *   noteBoot({ shell, version, touch })   the page's shell: updates the automatic set + cookie;
 *                             returns { changed, added[] }
 *   noteTier(tier)            the art density changed (1 | 2 | 4): same return
 *   pin(id) / unpin(id) / pinned()        Applied Updates
 *   filterRows(rows)          manifest rows (url) this client keeps
 *   tierFor(dpr, px)          1 | 2 | 4 (wmShell syncPixelScale's steps)
 *   hidpiTierFor(dpr)         1 | 125 | 150 | 175 | 200 (the desktop's HiDPI art)
 *   noteHidpi(tier)           the desktop's density changed: same return as noteBoot
 *   legacyRows(rows)          server: a cookie-less client's manifest (everything but the HiDPI art)
 *
 * In a phone's Melaton Mobile page (/app, with the flag) it also tells the service worker what network
 * the phone is on, once after the boot and then on each change (PHONE_PREFETCH): the worker's Wi-Fi
 * prefetch uses it where the worker cannot see the connection type itself.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.melatonPackages = api;
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null), function () {
    'use strict';
    const STORE = 'melatonPackages';
    const COOKIE = 'melaton_pkgs';
    const VERSIONS = ['wm61', 'wm65'];
    const NAMES = { wm61: 'Melaton Mobile 6.1', wm65: 'Melaton Mobile 6.5', wmc: 'Melaton Mobile Common' };
    const PACKAGES = [];
    for (const v of [...VERSIONS, 'wmc']) {
        PACKAGES.push({ id: v, label: NAMES[v], version: v, tier: 1 });
        PACKAGES.push({ id: `${v}-2x`, label: `${NAMES[v]} (for HiDPI)`, version: v, tier: 2 });
        PACKAGES.push({ id: `${v}-4x`, label: `${NAMES[v]} (for UHiDPI)`, version: v, tier: 4 });
    }
    // the desktop's HiDPI art (#921): one package per density
    const HIDPI_TIERS = [125, 150, 175, 200];
    for (const t of HIDPI_TIERS) PACKAGES.push({ id: `hidpi-${t}`, label: `Melaton Desktop (for ${t}% scaling)`, version: 'desktop', tier: t / 100 });
    // Media Player's older visualizations (Windows Media Player 9 Series / 10: Spikes ...), from Download
    // Visualizations (mediaPlayerViz.js); never automatic
    PACKAGES.push({ id: 'wmpvis-classic', label: 'Media Player Visualizations (Windows Media Player 9 Series and 10)', version: 'desktop', tier: 1 });
    const IDS = new Set(PACKAGES.map((p) => p.id));
    const HIDPI_ART = /^\/static_images\/hidpi\/(125|150|175|200)\//;
    // the animation frames: built into strips / the status atlas, loaded by nobody
    const SOURCE = /\/(?:status-[a-z0-9-]+-(?:sync|anim)-\d\d|status-data-(?:sync|anim)-\d\d|status-wifi-(?:sync|anim)-\d\d|wait-\d{1,2}|status-director-open-\d|status-signal-search-\d)(?:@[24]x)?\.png$/;
    // the few Melaton Mobile pictures the desktop shows too (ActiveSync's Device Center)
    const DESKTOP_TOO = /^\/static_images\/wm61\/boot-melaton(?:@[24]x)?\.png$/;

    // Weather's art (#780): the app runs under both shells (and 6.5's home screen shows its icons), so
    // it is Common, though it lives under wm61
    const COMMON_WM61 = /^\/static_images\/wm61\/weather\//;

    // the flag in a client's set: it is a phone (the mobile bit and the handheld bit), so its install
    // leaves out phoneOptional's files. Not a package: current() and Applied Updates never list it.
    const MOBILE_FLAG = 'mobile';
    // Desktop pictures a phone shows only in a desktop window (DeX) or as its workspace's wallpaper
    // (sw.js WALLPAPER_CACHE keeps that one): the Desktop Background photos (179 MB,
    // wallpaperGalleries.js) and the Sidebar's art. sw.js PHONE_WIFI_PREFIXES lists the same folders
    // (scripts/test-phone-optional-assets.js keeps the two in step).
    const PHONE_WIFI = /^\/static_images\/(?:wallpapers\/photos|vista-sidebar)\//;
    // Font files a phone browser never asks for: every @font-face naming one lists its WOFF2 before it
    // (dist/fontawesome/css/all*.css, dist/mdi/materialdesignicons*.css, dist/remixicon/remixicon*.css,
    // css/fonts.css), and Chromium skips the .eot and .svg entries by their format. The same test reads
    // those stylesheets and fails when that stops being true for one of them.
    const PHONE_DEMAND = /^\/dist\/(?:fontawesome\/webfonts\/fa-[a-z0-9-]+\.ttf|fonts\/materialdesignicons-webfont\.(?:eot|woff|ttf)|fonts\/NotoSans-VariableFont_wdth(?:,|%2C)wght\.ttf|remixicon\/remixicon\.(?:ttf|woff|svg))$/i;
    function phoneOptional(url) {
        const u = String(url || '').split('?')[0];
        if (PHONE_WIFI.test(u)) return 'wifi';
        if (PHONE_DEMAND.test(u)) return 'demand';
        return null;
    }
    function packageOf(url) {
        const u = String(url || '').split('?')[0];
        if (/^\/scripts\/comp\/desktop-apps\/wmpvis\//.test(u)) return 'wmpvis-classic';
        const hd = HIDPI_ART.exec(u);
        if (hd) return `hidpi-${hd[1]}`;
        // the build's own list of the HiDPI art (scripts/build-hidpi-assets.js): no client reads it
        if (u === '/static_images/hidpi/index.json') return 'source';
        // the Wallet's barcode drawing (#874, 1 MB): phones only
        if (u === '/scripts/vendor/bwip-js.min.js') return 'wmc';
        // Melaton Mobile's sounds (notification classes, alarms, rings, taps; 3.9 MB): both versions play
        // them (6.5 too), the desktop never does (its scheme is /sounds/vista): Melaton Mobile Common
        // (Yukimi, Nov 17 2026). Kept offline on every phone, so the Android app's sound versions
        // (wmShell avPlay, x-file-hash) are always known.
        if (/^\/sounds\/wm6[15]\//.test(u)) return 'wmc';
        if (COMMON_WM61.test(u)) return /@4x\.[a-z0-9]+$/i.test(u) ? 'wmc-4x' : /@2x\.[a-z0-9]+$/i.test(u) ? 'wmc-2x' : 'wmc';
        // both versions' art (the Android programs' icons): Melaton Mobile Common
        const c = /^\/static_images\/wm-android\/(.+)$/.exec(u);
        if (c) {
            if (!/\.png$/i.test(c[1])) return null; // manifest.json and the like: core
            return /@4x\.png$/i.test(c[1]) ? 'wmc-4x' : /@2x\.png$/i.test(c[1]) ? 'wmc-2x' : 'wmc';
        }
        const m = /^\/static_images\/(wm61|wm65)\/(.+)$/.exec(u);
        if (!m) return null;
        if (DESKTOP_TOO.test(u)) return null;
        if (SOURCE.test(u)) return 'source';
        const v = m[1];
        if (/@4x\.[a-z0-9]+$/i.test(m[2])) return `${v}-4x`;
        if (/@2x\.[a-z0-9]+$/i.test(m[2])) return `${v}-2x`;
        return v;
    }

    /** The HiDPI art tier for a desktop at this devicePixelRatio: 1 (none) | 125 | 150 | 175 | 200. */
    function hidpiTierFor(dpr) {
        const d = Number(dpr) || 1;
        if (d <= 1.01) return 1;
        return HIDPI_TIERS.find((t) => d <= t / 100 + 0.01) || 200;
    }
    function tierFor(dpr, px) {
        const s = (Number(dpr) || 1) * (Number(px) || 1);
        return s <= 1.01 ? 1 : s <= 2.01 ? 2 : 4;
    }
    const tierOf = (base, tier) => [base, ...(tier >= 2 ? [`${base}-2x`] : []), ...(tier >= 4 ? [`${base}-4x`] : [])];
    // the running version's art and the common art, each up to the screen's density. 6.5 is built on
    // 6.1's ROM art: its shell draws message box icons, program icons, status glyphs and Today art
    // from wm61 (wmShell ART), so a 6.5 phone needs wm61 too; without it all of that art was never
    // kept and showed as broken images while the server restarted (Yukimi, Nov 13)
    const tierIds = (version, tier) => [
        ...(version === 'wm65' ? tierOf('wm61', tier) : []),
        ...tierOf(version, tier),
        ...tierOf('wmc', tier)
    ];

    function read() {
        try {
            const s = JSON.parse(localStorage.getItem(STORE) || 'null');
            if (s && typeof s === 'object') return { mobile: !!s.mobile, handheld: !!s.handheld, version: s.version === 'wm65' ? 'wm65' : 'wm61', tier: [1, 2, 4].includes(s.tier) ? s.tier : 1, hidpi: HIDPI_TIERS.includes(s.hidpi) ? s.hidpi : 1, pinned: Array.isArray(s.pinned) ? s.pinned.filter((id) => IDS.has(id)) : [] };
        } catch (_) { /* storage off or junk */ }
        return null;
    }
    function write(s) {
        try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (_) { /* storage off */ }
        syncCookie(s);
    }
    function idsOf(s) {
        if (!s) return [];
        const set = new Set(s.pinned || []);
        if (s.mobile) tierIds(s.version, s.tier).forEach((id) => set.add(id));
        if (HIDPI_TIERS.includes(s.hidpi)) set.add(`hidpi-${s.hidpi}`);
        return [...set].filter((id) => IDS.has(id)).sort();
    }
    // a phone's lighter install: Melaton Mobile booted here on a handheld
    const phoneInstall = (s) => !!(s && s.mobile && s.handheld);
    // the ids and, for a phone, the flag: what the cookie (and so the server) sees
    function setOf(s) {
        const ids = idsOf(s);
        return phoneInstall(s) ? [...ids, MOBILE_FLAG].sort() : ids;
    }
    function cookieValue(s) {
        const ids = setOf(s);
        return ids.length ? ids.join(',') : 'none';
    }
    function syncCookie(s) {
        if (typeof document === 'undefined') return;
        const v = cookieValue(s);
        try {
            if (readCookie() === v) return;
            const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
            document.cookie = `${COOKIE}=${encodeURIComponent(v)}; Path=/; Max-Age=315360000; SameSite=Lax${secure}`;
        } catch (_) { /* cookies off */ }
    }
    function readCookie() {
        if (typeof document === 'undefined') return null;
        const m = /(?:^|;\s*)melaton_pkgs=([^;]*)/.exec(document.cookie || '');
        return m ? decodeURIComponent(m[1]) : null;
    }
    function current() { return idsOf(read()); }

    function change(mutate) {
        const before = read();
        const s = before ? { ...before, pinned: before.pinned.slice() } : { mobile: false, handheld: false, version: 'wm61', tier: 1, hidpi: 1, pinned: [] };
        mutate(s);
        const was = idsOf(before);
        const now = idsOf(s);
        write(s);
        const removed = was.filter((id) => !now.includes(id));
        // serviceWorkerManager drops their files from the cache once the desktop is up
        if (removed.length) { try { localStorage.setItem('melatonPackagesTidy', '1'); } catch (_) { /* storage off */ } }
        return { changed: was.join(',') !== now.join(',') || !before, added: now.filter((id) => !was.includes(id)), removed };
    }

    // A handheld (#890): the Android app (its bridges are in every page it loads, on the phone screen
    // and in DeX alike), or a browser that says it is a phone. Any window narrower than 1200 px boots
    // Melaton Mobile, also a desktop browser's; that one keeps the desktop's whole install.
    function handheldNow() {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
        try { if (window.AndroidDisplay || window.AndroidDeviceStatus || window.AndroidDevice) return true; } catch (_) { /* no bridges */ }
        try {
            const uad = navigator.userAgentData;
            if (uad && typeof uad.mobile === 'boolean') return uad.mobile;
        } catch (_) { /* no client hints */ }
        return /Android.*Mobile|iPhone|iPod|Windows Phone|IEMobile/i.test(String(navigator.userAgent || ''));
    }

    /**
     * The page's shell at boot. Melaton Mobile sets the mobile bit, and on a handheld the handheld bit
     * (both kept from then on: a desktop boot, a phone's DeX window, never clears them, and a set that
     * went back and forth would download the left-out files again each time).
     */
    function noteBoot(opts = {}) {
        // a desktop (also a phone's DeX window) draws the Vista art: its density tier; Melaton Mobile
        // keeps the one a desktop boot set (a hybrid phone's DeX window)
        if (opts.shell !== 'mobile') startHidpi();
        return change((s) => {
            if (opts.shell !== 'mobile') s.hidpi = hidpiTierFor(effectiveDpr());
            if (opts.shell === 'mobile') {
                s.mobile = true;
                if (!s.handheld && handheldNow()) s.handheld = true;
            }
            if (opts.version) s.version = opts.version === '6.5' || opts.version === 'wm65' ? 'wm65' : 'wm61';
            if (s.mobile && opts.shell === 'mobile') {
                let px = null;
                try {
                    const key = Math.min(screen.width, screen.height) >= 600 ? 'wmScaleMain' : 'wmScale';
                    const v = Number(localStorage.getItem(key));
                    if (v > 0) px = v;
                } catch (_) { px = null; }
                if (px == null) px = opts.touch ? 1.5 : 1;
                s.tier = tierFor(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, px);
            }
        });
    }
    function noteTier(tier) {
        const t = [1, 2, 4].includes(tier) ? tier : 1;
        return change((s) => { if (s.mobile) s.tier = t; });
    }
    function noteHidpi(tier) {
        const t = HIDPI_TIERS.includes(tier) ? tier : 1;
        return change((s) => { s.hidpi = t; });
    }
    function pin(id) { return change((s) => { if (IDS.has(id) && !s.pinned.includes(id)) s.pinned.push(id); }); }
    function unpin(id) { return change((s) => { s.pinned = s.pinned.filter((x) => x !== id); }); }
    function pinned() { const s = read(); return s ? s.pinned.slice() : []; }
    /** What the automatic set holds (the ones Applied Updates cannot remove). */
    function automatic() {
        const s = read();
        if (!s) return [];
        return [...(s.mobile ? tierIds(s.version, s.tier) : []), ...(HIDPI_TIERS.includes(s.hidpi) ? [`hidpi-${s.hidpi}`] : [])];
    }

    /** ids: a set from parseSet (the server); default this client's own, with its flag. */
    function filterRows(rows, ids) {
        const have = new Set(ids || setOf(read()));
        const lite = have.has(MOBILE_FLAG);
        return (Array.isArray(rows) ? rows : []).filter((r) => {
            const url = r && (r.url || r.path);
            const p = packageOf(url);
            if (p !== null) return p !== 'source' && have.has(p);
            return !(lite && phoneOptional(url));
        });
    }

    /** Server: a client from before packages (no cookie) keeps everything but the HiDPI art. */
    function legacyRows(rows) {
        return (Array.isArray(rows) ? rows : []).filter((r) => !/^hidpi-/.test(String(packageOf(r && (r.url || r.path)))));
    }

    /** Server: the client's set from its cookie / header value; null = everything (a client from before). */
    function parseSet(value) {
        if (value == null || value === '') return null;
        const v = String(value).trim();
        if (v === 'none') return [];
        return v.split(',').map((x) => x.trim()).filter((x) => IDS.has(x) || x === MOBILE_FLAG).sort();
    }

    // a page that loads this re-asserts the cookie from storage (a cleared cookie comes back)
    try { if (typeof document !== 'undefined') { const s = read(); if (s) syncCookie(s); } } catch (_) { /* no storage */ }

    // ---- Melaton Mobile's Wi-Fi prefetch (#890): sw.js fetches the 'wifi' files this install leaves
    // out while the phone is on Wi-Fi. The worker reads navigator.connection.type itself where it has
    // it; this page tells it what it knows (that, or the Android app's status: wmShell's contract v1,
    // active wifi | cellular | ethernet | vpn | none) once the boot is over, then on every change.
    // Event driven: nothing here polls, and a status event costs a compare unless the type is unknown.
    const PREFETCH_HINT_DELAY_MS = 30000;
    function connectionNetwork() {
        const c = typeof navigator !== 'undefined' ? navigator.connection : null;
        if (!c) return 'unknown';
        if (c.saveData) return 'metered';
        const t = typeof c.type === 'string' ? c.type : '';
        if (t === 'wifi' || t === 'ethernet') return 'unmetered';
        if (t === 'cellular' || t === 'bluetooth' || t === 'wimax' || t === 'none') return 'metered';
        return 'unknown';
    }
    function statusNetwork(status) {
        let s = status;
        if (typeof s === 'string') { try { s = JSON.parse(s); } catch (_) { s = null; } }
        if (!s || typeof s !== 'object') return 'unknown';
        if (s.active === 'wifi' || s.active === 'ethernet') return 'unmetered';
        if (s.active === 'cellular' || s.active === 'none') return 'metered';
        // a VPN rides on the link under it
        if (s.active === 'vpn') return s.wifi && s.wifi.connected ? 'unmetered' : 'metered';
        return 'unknown';
    }
    function startPrefetchHints() {
        if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') return;
        if (!navigator.serviceWorker || typeof location === 'undefined' || location.pathname !== '/app') return;
        let last = null;
        // a page that is not seen (hidden, screen off, behind an Android program) does not tell the worker
        // 'unmetered': its pass (a list check, then downloads) waits until the page is seen again; a
        // 'metered' hint still goes at once so a running pass stops when Wi-Fi drops (#890)
        let held = false;
        const asleep = () => {
            const html = document.documentElement;
            return document.hidden || (html && html.dataset && (html.dataset.screenOff !== undefined || html.dataset.wmBehind !== undefined));
        };
        const send = (status) => {
            let network = connectionNetwork();
            if (network === 'unknown') {
                let st = status;
                const bridge = window.AndroidDeviceStatus;
                if (st == null && bridge && typeof bridge.getState === 'function') { try { st = bridge.getState(); } catch (_) { st = null; } }
                network = statusNetwork(st);
            }
            // only a hint that would start work waits; 'metered' (which stops a running pass) goes at once
            if (network === 'unmetered' && asleep()) { held = true; return; }
            held = false;
            if (network === last) return;
            const worker = navigator.serviceWorker.controller;
            if (!worker) return;
            last = network;
            try { worker.postMessage({ type: 'PHONE_PREFETCH', network }); } catch (_) { last = null; }
        };
        // after the boot (app.html's noteBoot has set the mobile bit by then); a desktop stops here
        setTimeout(() => {
            if (!phoneInstall(read())) return;
            send(null);
            const c = navigator.connection;
            if (c && typeof c.addEventListener === 'function') c.addEventListener('change', () => send(null));
            // the app's status says the link only when the connection type does not
            // app-scope: allow page-lifetime boot hints for the worker (launch code, not an app segment)
            window.addEventListener('androiddevicestatus', (e) => { if (connectionNetwork() === 'unknown') send(e && e.detail != null ? e.detail : null); });
            // app-scope: allow page-lifetime boot hints for the worker (launch code, not an app segment)
            window.addEventListener('online', () => send(null));
            // app-scope: allow page-lifetime boot hints for the worker (launch code, not an app segment)
            navigator.serviceWorker.addEventListener('controllerchange', () => { last = null; send(null); });
            // a hint held while the page slept goes when it is seen again
            const wake = () => { if (held && !asleep()) send(null); };
            // app-scope: allow page-lifetime boot hints for the worker (launch code, not an app segment)
            document.addEventListener('visibilitychange', wake);
            // app-scope: allow page-lifetime boot hints for the worker (launch code, not an app segment)
            window.addEventListener('melatonscreen', wake);
            // app-scope: allow page-lifetime boot hints for the worker (launch code, not an app segment)
            document.addEventListener('wmBehind', wake);
        }, PREFETCH_HINT_DELAY_MS);
    }
    try { startPrefetchHints(); } catch (_) { /* no worker: on demand only */ }

    // ---- The desktop's HiDPI art (#921). image-set() in the stylesheets picks the density by itself
    // (and again when the scale changes); <img> art takes its copy from the tier's img.css, linked here.
    // A scale change (DreamOS DPI Scaling, another screen) moves the tier: the sheet is swapped and the
    // new tier's package is fetched once the desktop is up (a large one asks to restart, where the
    // installer brings it). One matchMedia listener for the current ratio; no timers while idle.
    let hidpiStarted = false;
    const hidpiLinks = { img: null, bg: null };
    // one of the tier's sheets: linked, swapped (the old one goes once the new one is in, so art never
    // flashes at the wrong size) or removed (tier 1)
    function swapHidpiSheet(kind, tier) {
        const cur = hidpiLinks[kind];
        if (tier === 1) {
            if (cur) { cur.remove(); hidpiLinks[kind] = null; }
            return;
        }
        const href = `/static_images/hidpi/${tier}/${kind}.css`;
        if (cur && cur.getAttribute('href') === href) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.melatonHidpi = String(tier);
        if (cur) link.addEventListener('load', () => cur.remove(), { once: true });
        document.head.appendChild(link);
        hidpiLinks[kind] = link;
    }
    // img.css: <img> art at the tier. bg.css only when the page's own scale (the Android app's desktop,
    // #934) asks for more than the screen: image-set() follows the real devicePixelRatio and would stay at
    // 1x there, so bg.css repeats the stylesheets' art rules under html[data-hidpi-tier] with that tier's copy
    function linkHidpiSheet(tier) {
        if (typeof document === 'undefined' || !document.head) return;
        swapHidpiSheet('img', tier);
        const screenTier = hidpiTierFor(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1);
        const scaled = tier !== 1 && tier > screenTier ? tier : 1;
        const html = document.documentElement;
        const want = scaled === 1 ? null : String(scaled);
        if (html && html.getAttribute('data-hidpi-tier') !== want) {
            if (want) html.setAttribute('data-hidpi-tier', want);
            else html.removeAttribute('data-hidpi-tier');
        }
        swapHidpiSheet('bg', scaled);
    }
    function hidpiPackageAdded(change) {
        const started = Date.now();
        const go = () => {
            const m = window.serviceWorkerManager;
            if (!m || typeof m.applyPackageChange !== 'function' || !m.bootComplete) {
                if (Date.now() - started < 180000) setTimeout(go, 5000);
                return;
            }
            m.applyPackageChange(change, {
                confirmLarge: ({ bytes }) => (typeof window.showConfirmationDialog === 'function'
                    ? window.showConfirmationDialog(`The pictures for this display scale are not on this computer yet (${(bytes / 1048576).toFixed(1)} MB). Restart Melaton now to install them?`, [{ text: 'Restart now', value: true }, { text: 'Later', value: false }])
                    : Promise.resolve(false))
            }).catch(() => { /* the next boot's update check brings them */ });
        };
        go();
    }
    /**
     * The art density the desktop needs: devicePixelRatio x the page's own scale (the Android app's desktop DPI
     * Scaling is a page scale, app.html melatonPageScale, #934: a 1.25 scale on a 1.0 monitor takes the 125 tier).
     */
    function effectiveDpr() {
        const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
        const ps = typeof window !== 'undefined' ? window.melatonPageScale : null;
        const k = ps && ps.available && typeof ps.get === 'function' ? Number(ps.get()) || 1 : 1;
        return dpr * k;
    }
    function startHidpi() {
        if (hidpiStarted || typeof window === 'undefined' || typeof document === 'undefined' || typeof window.matchMedia !== 'function') return;
        hidpiStarted = true;
        let tier = 0;
        const recheck = () => {
            const next = hidpiTierFor(effectiveDpr());
            if (next === tier) return;
            tier = next;
            linkHidpiSheet(next);
            const change = noteHidpi(next);
            if (change && change.added && change.added.length) hidpiPackageAdded(change);
        };
        // the page's own scale changed (DPI Scaling on the Android app's desktop)
        // app-scope: allow page-lifetime display scale watch (launch code, not an app segment)
        window.addEventListener('melaton-page-scale', recheck);
        const watch = () => {
            const dpr = window.devicePixelRatio || 1;
            tier = hidpiTierFor(effectiveDpr());
            linkHidpiSheet(tier);
            let mq = null;
            try { mq = window.matchMedia(`(resolution: ${dpr}dppx)`); } catch (_) { mq = null; }
            if (!mq || typeof mq.addEventListener !== 'function') return;
            // app-scope: allow page-lifetime display scale watch (launch code, not an app segment)
            mq.addEventListener('change', () => {
                const before = tier;
                watch();
                if (tier === before) return;
                const change = noteHidpi(tier);
                if (change && change.added && change.added.length) hidpiPackageAdded(change);
            }, { once: true });
        };
        watch();
    }

    return { PACKAGES, COOKIE, MOBILE_FLAG, HIDPI_TIERS, packageOf, phoneOptional, tierFor, hidpiTierFor, current, noteBoot, noteTier, noteHidpi, pin, unpin, pinned, automatic, filterRows, legacyRows, parseSet, cookieValue, read };
}));
