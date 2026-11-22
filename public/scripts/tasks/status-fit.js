/*
 * CafeTasks.lib.statusFit (StaticForge #907, rule cafeready-background): which status icons fit the title bar, and
 * where - the page's rules (public/scripts/comp/wmShell.js fitStatusNow / applyCameraHole) as one pure function,
 * so the Android app's status-bar task decides as the page does while the page is asleep. No DOM, no globals
 * beyond CafeTasks.lib.
 *
 *   statusFit.fit({
 *     icons: [{ role, w, app, foldable, ongoing, seenAt }],  in the bar's order (left to right); w in device px;
 *                                   app: a program's icon (may fold into the group); foldable: false for those that
 *                                   never fold (Continuity, Nightshade); ongoing: work running (prints, a Director
 *                                   turn, an update downloading); seenAt: when it came up (ms; the newest stays out);
 *                                   charging: the battery icon shows charging (it may step aside)
 *     notify: { w, notes } | null,  the group icon ("..."): its width, and whether notices of its own are waiting
 *     bar: { width, iconsRight, gap, titleX, titleMin, hole: { x, w } | null, xReserve },
 *                                   device px from the kit's geometry; iconsRight = the right end of the icons' row;
 *                                   xReserve = the X / ok's kept place when this bar has none (0 when it has one)
 *     prefs: { sound, power },      Settings > Screen > Status icons ('' = default, 'possible' / 'home', 'never')
 *     screen: { unfolded, noCross, crossMax }
 *                                   a foldable's inner screen (nothing steps aside or folds there; what does not fit
 *                                   right of the camera carries on left of it); crossMax = Settings > Screen > the
 *                                   icons that may go past (left of) the camera on this screen (cover / main, #1057):
 *                                   0 never crosses, n at most n (the "..." counts), null / absent no limit;
 *                                   noCross (the older "Do not allow status icons to cross over camera hole") = 0
 *   }) -> { shown: [role], left: [role], folded: [role], shed: [role], groupShown: bool, reserveUsed: bool }
 *
 * What gives way when the bar runs short (the table: status-order.js, Yukimi, Nov 17): the X / ok's kept place on a
 * bar with none; then the icons that do not outrank the system icons fold into the group, least wanted first; then,
 * for a short-lived icon still out (statusOrder.displace), the volume icon (unless Sound Icon = Never hide) and a
 * charging battery (Power Icon default or "when charging") step aside; then the short-lived ones fold, least wanted
 * first; last the volume / battery after all. Icons the table does not let fold never fold. A group holds two or
 * more, or one with notices of its own. A bar fits when its leftmost icon clears the title's floor and, except on an
 * unfolded inner screen or a bar with the camera in it (icons carry on left of the camera, #1025), starts in the bar's
 * right half (the 50 % mark). The icons' app / foldable / ongoing / seenAt
 * fields are only read without the table.
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks;
    if (!C) return;

    /** How many icons may go left of the camera: a count, or null for no limit (true = the old "do not cross" = 0). */
    function crossLimit(v) {
        if (v === true) return 0;
        if (v === false || v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }

    /**
     * Right-aligned placement from iconsRight; an icon that would run into the camera carries on left of it. cross: how
     * many may go left of it (crossLimit; null = any): a row with more is null (it does not fit).
     */
    function place(items, bar, cross) {
        const out = [];
        let cursor = bar.iconsRight;
        let crossed = false;
        let past = 0;
        const lim = crossLimit(cross);
        const hole = bar.hole && bar.hole.w > 0 ? bar.hole : null;
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            let x = cursor - it.w;
            if (hole && !crossed && x < hole.x + hole.w) {
                if (lim === 0) return null;
                crossed = true;
                cursor = hole.x;
                x = cursor - it.w;
            }
            if (crossed && lim !== null && ++past > lim) return null;
            out.unshift({ role: it.role, x, left: crossed });
            cursor = x - bar.gap;
        }
        return out;
    }

    function fit(o) {
        const icons = (o && o.icons) || [];
        const bar = Object.assign({ width: 0, iconsRight: 0, gap: 0, titleX: 0, titleMin: 0, hole: null, xReserve: 0 }, (o && o.bar) || {});
        const prefs = Object.assign({ sound: '', power: '' }, (o && o.prefs) || {});
        const screen = Object.assign({ unfolded: false, noCross: false, crossMax: null }, (o && o.screen) || {});
        // the icons allowed left of the camera on this screen (#1057); the older switch alone = 0
        const lim = crossLimit(screen.crossMax) !== null ? crossLimit(screen.crossMax) : (screen.noCross ? 0 : null);
        const notify = o && o.notify;
        const shed = new Set();
        let folded = [];
        let reserveUsed = false;

        const order = C.lib.statusOrder;
        const shownRoles = icons.map((i) => i.role);
        // the table's fold order (status-order.js); an older table-less copy folds the program icons right to left
        const fs = order ? order.foldSequence(shownRoles)
            : { seq: icons.filter((i) => i.app && i.foldable !== false).map((i) => i.role).reverse(), nonDisplacing: 0 };

        const layout = () => {
            const items = icons.filter((i) => !shed.has(i.role) && !folded.includes(i.role));
            const groupShown = !!notify && (folded.length > 0 || !!notify.notes);
            if (groupShown) items.unshift({ role: 'notify', w: notify.w });
            const b = reserveUsed ? Object.assign({}, bar, { iconsRight: bar.iconsRight + (bar.xReserve || 0) }) : bar;
            // "do not cross" (or more past the camera than allowed) even after every step: the row as it would cross,
            // so the result still names what shows (null gave an empty bar)
            return { placed: place(items, b, lim), groupShown, all: () => place(items, b, null) };
        };
        const ok = (l) => {
            if (!l.placed) return false;
            if (!l.placed.length) return true;
            const leftmost = l.placed[0].x;
            if (leftmost < bar.titleX + bar.titleMin) return false;
            // the 50 % mark is for a bar without a camera in it: with one, the camera sits about where that mark is, so
            // the mark kept every icon right of it and folded them into "..." with half the bar empty. They carry on
            // left of the camera up to the title's floor (Yukimi, Nov 22 #1025: "continue past the cutout and only
            // fall into ... when the bar is truly full"); Settings > Screen > "Do not allow status icons to cross over
            // camera hole" (noCross, now a count of 0) still keeps them right of it; a count above 0 lets that many cross
            // (place() refuses a row with more, #1057)
            if (bar.hole && bar.hole.w > 0 && lim !== 0) return true;
            return screen.unfolded || leftmost >= bar.width / 2;
        };
        const result = (l) => {
            const placed = l.placed || l.all();
            return {
                shown: placed.map((p) => p.role),
                left: placed.filter((p) => p.left).map((p) => p.role),
                folded: folded.slice(),
                shed: [...shed],
                groupShown: l.groupShown,
                reserveUsed
            };
        };

        let l = layout();
        // an unfolded inner screen has the room: nothing steps aside or folds, what does not fit crosses the camera
        // the room right of the camera is filled first: a row that has to cross it takes the X / ok's kept place (a bar
        // with none) before it carries on left of the camera
        const crossed = (x) => !!(x.placed && x.placed.some((p) => p.left));
        // (on the inner screen too only as many as Settings allows go past the camera, #1057: past that, icons fold)
        if ((screen.unfolded && l.placed) || (ok(l) && !crossed(l))) return result(l);
        const tryStep = (fn) => { fn(); l = layout(); return ok(l); };
        if (bar.xReserve > 0 && tryStep(() => { reserveUsed = true; })) return result(l);
        if (ok(l)) return result(l);
        // the volume / battery stepping aside (Settings > Screen > Sound Icon / Power Icon allow it)
        const sysSteps = [];
        if (icons.some((i) => i.role === 'volume') && prefs.sound !== 'never') sysSteps.push(() => shed.add('volume'));
        if (icons.some((i) => i.role === 'battery' && i.charging) && (!prefs.power || prefs.power === 'charging')) sysSteps.push(() => shed.add('battery'));
        const sys = () => { while (sysSteps.length) if (tryStep(sysSteps.shift())) return true; return false; };
        // a group holds two or more (one alone takes the same room as the icon itself), or one with notices of its own
        const minK = notify && notify.notes ? 1 : 2;
        const foldTo = (k) => tryStep(() => { folded = fs.seq.slice(0, k); });
        // first what does not outrank the volume and battery folds, least wanted first
        for (let k = minK; k <= fs.nonDisplacing; k++) if (foldTo(k)) return result(l);
        // a short-lived icon still out: the volume and battery step aside for it before it folds
        if (fs.seq.length > fs.nonDisplacing && sys()) return result(l);
        for (let k = Math.max(minK, fs.nonDisplacing + 1); k <= fs.seq.length; k++) if (foldTo(k)) return result(l);
        // a bar that is still short with all of them in the group: the volume and battery as a last resort
        if (sys()) return result(l);
        // a count past the camera the bar still cannot keep (Settings > Screen, #1057: 0 = none left of the camera, n = at
        // most n - exactly): the program icons the table keeps out of the group (Continuity, Nightshade) fold last, the
        // rightmost first, rather than the row crossing the camera anyway (A53 in a program, a count of 0: the "..." was
        // put left of the camera 2.6 px short of room; the page then pushed the X toward the screen's corner), then
        // Bluetooth (an on / off light). The network, signal, volume and battery never fold
        if (lim !== null && !l.placed) {
            const sysRoles = new Set(['bluetooth', 'data', 'cell', 'roaming', 'signal', 'volume', 'battery']);
            const extra = shownRoles.filter((r) => r !== 'notify' && !sysRoles.has(r) && !fs.seq.includes(r) && !shed.has(r)).reverse()
                .concat(shownRoles.includes('bluetooth') ? ['bluetooth'] : []);
            const base = folded.slice();
            for (let k = 1; k <= extra.length; k++) if (tryStep(() => { folded = base.concat(extra.slice(0, k)); })) return result(l);
        }
        return result(l);
    }

    C.lib.statusFit = { fit, place, crossLimit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
