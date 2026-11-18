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
 *     screen: { unfolded, noCross } a foldable's inner screen (nothing steps aside or folds there; what does not fit
 *                                   right of the camera carries on left of it); noCross = Settings > Screen > "Do
 *                                   not allow status icons to cross over camera hole"
 *   }) -> { shown: [role], left: [role], folded: [role], shed: [role], groupShown: bool, reserveUsed: bool }
 *
 * What gives way when the bar runs short (the table: status-order.js, Yukimi, Nov 17): the X / ok's kept place on a
 * bar with none; then the icons that do not outrank the system icons fold into the group, least wanted first; then,
 * for a short-lived icon still out (statusOrder.displace), the volume icon (unless Sound Icon = Never hide) and a
 * charging battery (Power Icon default or "when charging") step aside; then the short-lived ones fold, least wanted
 * first; last the volume / battery after all. Icons the table does not let fold never fold. A group holds two or
 * more, or one with notices of its own. A bar fits when its leftmost icon clears the title's floor and, except on an
 * unfolded inner screen, starts in the bar's right half (the 50 % mark). The icons' app / foldable / ongoing / seenAt
 * fields are only read without the table.
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks;
    if (!C) return;

    /** Right-aligned placement from iconsRight; an icon that would run into the camera carries on left of it. */
    function place(items, bar, noCross) {
        const out = [];
        let cursor = bar.iconsRight;
        let crossed = false;
        const hole = bar.hole && bar.hole.w > 0 ? bar.hole : null;
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            let x = cursor - it.w;
            if (hole && !crossed && x < hole.x + hole.w) {
                if (noCross) return null;
                crossed = true;
                cursor = hole.x;
                x = cursor - it.w;
            }
            out.unshift({ role: it.role, x, left: crossed });
            cursor = x - bar.gap;
        }
        return out;
    }

    function fit(o) {
        const icons = (o && o.icons) || [];
        const bar = Object.assign({ width: 0, iconsRight: 0, gap: 0, titleX: 0, titleMin: 0, hole: null, xReserve: 0 }, (o && o.bar) || {});
        const prefs = Object.assign({ sound: '', power: '' }, (o && o.prefs) || {});
        const screen = Object.assign({ unfolded: false, noCross: false }, (o && o.screen) || {});
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
            return { placed: place(items, b, screen.noCross), groupShown };
        };
        const ok = (l) => {
            if (!l.placed) return false;
            if (!l.placed.length) return true;
            const leftmost = l.placed[0].x;
            if (leftmost < bar.titleX + bar.titleMin) return false;
            return screen.unfolded || leftmost >= bar.width / 2;
        };
        const result = (l) => ({
            shown: l.placed ? l.placed.map((p) => p.role) : [],
            left: l.placed ? l.placed.filter((p) => p.left).map((p) => p.role) : [],
            folded: folded.slice(),
            shed: [...shed],
            groupShown: l.groupShown,
            reserveUsed
        });

        let l = layout();
        // an unfolded inner screen has the room: nothing steps aside or folds, what does not fit crosses the camera
        if (screen.unfolded || ok(l)) return result(l);
        const tryStep = (fn) => { fn(); l = layout(); return ok(l); };
        if (bar.xReserve > 0 && tryStep(() => { reserveUsed = true; })) return result(l);
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
        return result(l);
    }

    C.lib.statusFit = { fit, place };
})(typeof globalThis !== 'undefined' ? globalThis : this);
