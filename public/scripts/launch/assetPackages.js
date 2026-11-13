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
 * The client's set: automatic (Melaton Mobile booted here: its version, and the density tiers up to
 * the screen's: 1x = wm61, 2x = + wm61-2x, 4x = + wm61-4x; 6.5 also takes 6.1's, which it draws) plus the ones added in Melaton Update >
 * Applied Updates (pinned, e.g. a phone that also runs a desktop in DeX). The mobile bit stays once
 * set, so a hybrid client keeps its phone art while it runs the desktop. Stored in localStorage
 * 'melatonPackages' and mirrored in the cookie 'melaton_pkgs' (the service worker's and /launch's own
 * requests carry it with no code of theirs): a comma list, or 'none' for core only. No cookie = a
 * client from before packages: the server gives it everything, as before.
 *
 *   packageOf(url)            null (core) | package id | 'source'
 *   PACKAGES                  [{ id, label, version, tier }]
 *   current()                 the active ids (sorted)
 *   noteBoot({ shell, version, touch })   the page's shell: updates the automatic set + cookie;
 *                             returns { changed, added[] }
 *   noteTier(tier)            the art density changed (1 | 2 | 4): same return
 *   pin(id) / unpin(id) / pinned()        Applied Updates
 *   filterRows(rows)          manifest rows (url) this client keeps
 *   tierFor(dpr, px)          1 | 2 | 4 (wmShell syncPixelScale's steps)
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
    const IDS = new Set(PACKAGES.map((p) => p.id));
    // the animation frames: built into strips / the status atlas, loaded by nobody
    const SOURCE = /\/(?:status-[a-z0-9-]+-(?:sync|anim)-\d\d|status-data-(?:sync|anim)-\d\d|status-wifi-(?:sync|anim)-\d\d|wait-\d{1,2}|status-director-open-\d|status-signal-search-\d)(?:@[24]x)?\.png$/;
    // the few Melaton Mobile pictures the desktop shows too (ActiveSync's Device Center)
    const DESKTOP_TOO = /^\/static_images\/wm61\/boot-melaton(?:@[24]x)?\.png$/;

    // Weather's art (#780): the app runs under both shells (and 6.5's home screen shows its icons), so
    // it is Common, though it lives under wm61
    const COMMON_WM61 = /^\/static_images\/wm61\/weather\//;
    function packageOf(url) {
        const u = String(url || '').split('?')[0];
        if (COMMON_WM61.test(u)) return /@4x\.png$/i.test(u) ? 'wmc-4x' : /@2x\.png$/i.test(u) ? 'wmc-2x' : 'wmc';
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
            if (s && typeof s === 'object') return { mobile: !!s.mobile, version: s.version === 'wm65' ? 'wm65' : 'wm61', tier: [1, 2, 4].includes(s.tier) ? s.tier : 1, pinned: Array.isArray(s.pinned) ? s.pinned.filter((id) => IDS.has(id)) : [] };
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
        return [...set].filter((id) => IDS.has(id)).sort();
    }
    function cookieValue(s) {
        const ids = idsOf(s);
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
        const s = before ? { ...before, pinned: before.pinned.slice() } : { mobile: false, version: 'wm61', tier: 1, pinned: [] };
        mutate(s);
        const was = idsOf(before);
        const now = idsOf(s);
        write(s);
        const removed = was.filter((id) => !now.includes(id));
        // serviceWorkerManager drops their files from the cache once the desktop is up
        if (removed.length) { try { localStorage.setItem('melatonPackagesTidy', '1'); } catch (_) { /* storage off */ } }
        return { changed: was.join(',') !== now.join(',') || !before, added: now.filter((id) => !was.includes(id)), removed };
    }

    /** The page's shell at boot. Melaton Mobile sets the mobile bit (kept from then on). */
    function noteBoot(opts = {}) {
        return change((s) => {
            if (opts.shell === 'mobile') s.mobile = true;
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
    function pin(id) { return change((s) => { if (IDS.has(id) && !s.pinned.includes(id)) s.pinned.push(id); }); }
    function unpin(id) { return change((s) => { s.pinned = s.pinned.filter((x) => x !== id); }); }
    function pinned() { const s = read(); return s ? s.pinned.slice() : []; }
    /** What the automatic set holds (the ones Applied Updates cannot remove). */
    function automatic() { const s = read(); return s && s.mobile ? tierIds(s.version, s.tier) : []; }

    function filterRows(rows, ids) {
        const have = new Set(ids || current());
        return (Array.isArray(rows) ? rows : []).filter((r) => {
            const p = packageOf(r && (r.url || r.path));
            return p === null || (p !== 'source' && have.has(p));
        });
    }

    /** Server: the client's set from its cookie / header value; null = everything (a client from before). */
    function parseSet(value) {
        if (value == null || value === '') return null;
        const v = String(value).trim();
        if (v === 'none') return [];
        return v.split(',').map((x) => x.trim()).filter((x) => IDS.has(x)).sort();
    }

    // a page that loads this re-asserts the cookie from storage (a cleared cookie comes back)
    try { if (typeof document !== 'undefined') { const s = read(); if (s) syncCookie(s); } } catch (_) { /* no storage */ }

    return { PACKAGES, COOKIE, packageOf, tierFor, current, noteBoot, noteTier, pin, unpin, pinned, automatic, filterRows, parseSet, cookieValue, read };
}));
