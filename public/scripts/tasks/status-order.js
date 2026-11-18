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
        foldSequence
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
