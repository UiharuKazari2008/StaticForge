/*
 * CafeTasks.lib.statusOrder (StaticForge #907): the status bar's icon table, one copy for the Melaton Mobile page
 * (wmShell.js fitStatusNow, loaded by app.html) and the Android app's CaféReady status-bar task (status-fit.js), so
 * both bars order and fold the same way. Shipped with a server deploy (the app fetches task files; no app build).
 *
 * Yukimi, Nov 17 2026:
 *   display   left to right ("..." first, the battery last). Car stands for the car key, remote start and the
 *             commute (one icon). Android's own tray icon is gone (the notification shade always pulls down).
 *   fold      the icons that may fold into "...", by how much each should be shown over another (first = shown
 *             longest, last = folds first). An icon not listed never folds.
 *   displace  the short-lived icons worth more than the volume and battery icons: to keep one of them out, those
 *             two step aside (as Settings > Screen > Sound Icon / Power Icon allow) before it folds. The rest fold
 *             first.
 *   system    the icons that step aside for a displacing icon, in that order.
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks || (root.CafeTasks = { lib: {} });
    if (!C.lib) C.lib = {};

    const display = ['notify', 'carkey', 'rain', 'wxalert', 'chat', 'mail', 'sms', 'prints', 'director', 'received', 'update',
        'continuity', 'nightshade', 'bluetooth', 'data', 'cell', 'roaming', 'signal', 'volume', 'battery'];
    const fold = ['wxalert', 'update', 'prints', 'director', 'rain', 'sms', 'chat', 'mail', 'carkey', 'received'];
    const displace = ['wxalert', 'update', 'prints', 'director', 'sms', 'chat'];
    const system = ['volume', 'battery'];

    /*
     * The registration (Yukimi, Nov 18 2026, HARD rule status-icons-registered-only): every icon either bar may draw,
     * as its WM 1-bit white glyph (public/static_images/wm61/<glyph>.png). A role or notice kind missing here draws
     * nothing; a notice never brings a picture of its own (an app's colour icon in the bar was the Lapis bug).
     */
    const glyphs = {
        notify: 'status-notify-many', reminder: 'status-reminder', error: 'status-error', warning: 'status-warning',
        carkey: 'status-traffic', traffic: 'status-traffic', lapis: 'status-lapis', caralert: 'status-car-alert',
        rain: 'status-rain-alarm', wxalert: 'status-weather-alert', chat: 'status-messenger', mail: 'status-mail',
        sms: 'status-sms', prints: 'status-prints', director: 'status-director', received: 'status-activesync',
        update: 'status-update', continuity: 'status-continuity', nightshade: 'status-nightshade',
        batterylow: 'status-battery-low'
    };
    const glyphNames = new Set(Object.values(glyphs));
    // the phone's own icons: WM's ROM glyph families in the status atlas (each state its own glyph)
    const systemGlyphs = {
        bluetooth: 'status-bluetooth', data: 'status-data-*', cell: 'status-data-*', roaming: 'status-roaming',
        signal: 'status-signal-*', volume: 'status-volume|status-vibrate|status-volume-off', battery: 'status-battery-*'
    };
    // what a tap does: its popup (status-popups.js), drawn by the app or the page; "..." opens the tray of what waits
    const taps = { notify: 'tray' };
    const NOTE_CLS = { mail: 'mail', sms: 'sms', chat: 'chat', print: 'prints', 'print-error': 'prints', director: 'director',
        'weather-alert': 'wxalert', 'weather-severe': 'wxalert', 'rain-alarm': 'rain', reminder: 'reminder' };

    /** A notice's registered kind: its id's source first, then its app, its class, its type; else the plain notice. */
    function noteKind(n) {
        const id = String((n && n.id) || '');
        const d = (n && n.data) || {};
        if (/^rem:/.test(id)) return 'reminder';
        if (/^lapis:/.test(id) || d.app === 'lapis') return 'caralert';
        if (/^traffic:/.test(id) || d.app === 'traffic') return 'traffic';
        if (/^wx:/.test(id)) return 'wxalert';
        if (/^rain:/.test(id)) return 'rain';
        if (/^print/.test(id)) return 'prints';
        if (/^update/.test(id)) return 'update';
        if (n && NOTE_CLS[n.cls]) return NOTE_CLS[n.cls];
        if (n && (n.type === 'error' || n.type === 'warning' || n.type === 'reminder')) return n.type;
        return 'notify';
    }

    const foldRank = new Map(fold.map((r, i) => [r, i]));
    const displacing = new Set(displace);

    /**
     * The order the shown foldable roles fold in (first folds first): those that do not displace the system icons,
     * least wanted first, then the displacing ones, least wanted first. nonDisplacing = how many lead the list.
     */
    function foldSequence(roles) {
        const can = roles.filter((r) => foldRank.has(r)).sort((a, b) => foldRank.get(b) - foldRank.get(a));
        const lead = can.filter((r) => !displacing.has(r));
        return { seq: lead.concat(can.filter((r) => displacing.has(r))), nonDisplacing: lead.length };
    }

    C.lib.statusOrder = {
        display, fold, displace, system,
        canFold: (r) => foldRank.has(r),
        displaces: (r) => displacing.has(r),
        foldSequence,
        glyphs,
        /** The registered glyph for a role or kind, or null (then nothing is drawn). */
        glyph: (r) => glyphs[r] || null,
        /** A glyph name the registration carries. */
        isGlyph: (name) => glyphNames.has(name),
        noteKind,
        noteGlyph: (n) => glyphs[noteKind(n)],
        systemGlyphs,
        /** What a tap on the role does: 'tray' (the "..." group) or 'popup'. */
        tap: (r) => taps[r] || 'popup',
        /**
         * The registration of a role: { glyph, popup, tap } when complete, else null - an incomplete role never shows
         * (scripts/check-status-registry.js fails the commit for one in the display table).
         */
        registration(r) {
            const glyph = glyphs[r] || systemGlyphs[r] || null;
            const pl = C.lib.statusPopups;
            const popup = !!(pl && pl.has(r));
            return glyph && popup ? { glyph, popup, tap: taps[r] || 'popup' } : null;
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
