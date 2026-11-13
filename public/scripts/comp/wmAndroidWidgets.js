/**
 * Android widgets on Today (6.1), while Melaton Mobile runs in the Android app (Yozora #794).
 *
 * A widget is a native view (DSApp HomeWidgets): this Today block keeps a placeholder for each one
 * (a name row over a box of the widget's height) and tells the app where the boxes are on screen
 * (AndroidWidgets.place) a few times a second while Today is up; the app draws the widgets there,
 * over the page. A box that is covered (a menu, a message box, the Start menu, another app) or
 * not wholly on screen is not placed, so the widget never sits over WM's own windows. On 6.5 the
 * home screen covers Today's rows, so no widget is placed there.
 *
 * Tap-and-hold a widget's name row (or tap "Tap here to add a widget"): Add Widget > the program >
 * its widgets, Remove.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;
    const bridge = window.AndroidWidgets;
    if (!bridge || typeof bridge.place !== 'function') return;

    let sh = null;
    let box = null;      // the Today block
    let sig = '';        // the list drawn
    let sent = '';       // the last placement sent
    let timer = 0;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const read = (fn) => { try { const v = JSON.parse(bridge[fn]() || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };

    /** Add Widget: the programs that have widgets, each with its widgets. */
    function addMenu() {
        const byApp = new Map();
        for (const p of read('providers')) {
            const a = p.app || p.provider;
            if (!byApp.has(a)) byApp.set(a, []);
            byApp.get(a).push(p);
        }
        if (!byApp.size) return [{ label: '(no widgets)', disabled: true }];
        return [...byApp.entries()].map(([app, list]) => ({
            label: app,
            submenu: () => list.map((p) => ({ label: `${p.label}${p.minW && p.minH ? ` (${p.minW} x ${p.minH})` : ''}`, action: () => bridge.add(p.provider) }))
        }));
    }

    function widgetMenu(w) {
        return [
            { label: 'Add Widget', submenu: addMenu },
            '-',
            { label: `Remove ${w.label}`, action: async () => {
                const yes = await sh.messageBox({ title: 'Remove Widget', icon: 'warning', text: `Remove the widget '${w.label}' from Today?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false });
                if (yes) { bridge.remove(Number(w.id)); sig = ''; if (sh.refreshToday) sh.refreshToday(); }
            } }
        ];
    }

    function render(el) {
        const list = read('list');
        const s = JSON.stringify(list.map((w) => [w.id, w.minH, w.label]));
        box = el;
        if (s === sig && el.dataset.wtwBuilt === 'android-widgets') return true;
        sig = s;
        el.dataset.wtwBuilt = 'android-widgets';
        el.classList.add('wtw', 'wtw-aw');
        el.innerHTML = list.length
            ? list.map((w) => `<div class="wtw-aw-item" data-id="${esc(w.id)}"><button type="button" class="wtw-aw-head">${esc(w.label)}</button><div class="wtw-aw-box" style="height:${Math.max(40, Number(w.minH) || 110)}px"></div></div>`).join('')
            : '<button type="button" class="wtw-aw-none"><span class="wtw-title">Tap here to add a widget</span></button>';
        const none = el.querySelector('.wtw-aw-none');
        if (none) none.addEventListener('click', (e) => { e.stopPropagation(); const r = none.getBoundingClientRect(); sh.menuAt(r.left + 20, r.bottom, addMenu()); });
        el.querySelectorAll('.wtw-aw-head').forEach((h) => {
            const w = list.find((x) => String(x.id) === h.parentElement.dataset.id);
            const show = (e) => { e.preventDefault(); e.stopPropagation(); sh.menuAt(e.clientX || h.getBoundingClientRect().left + 20, e.clientY || h.getBoundingClientRect().bottom, widgetMenu(w)); };
            h.addEventListener('contextmenu', show);
            h.addEventListener('click', show);
        });
        sent = '';
        return true;
    }

    /** Where the boxes are now: only the ones wholly on screen and not covered. */
    function placement() {
        const items = [];
        if (!box || !box.isConnected || !sh || sh.current !== 'today' || document.visibilityState !== 'visible') return items;
        const content = document.querySelector('#wmShell .wm-content');
        const cr = content ? content.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
        for (const b of box.querySelectorAll('.wtw-aw-box')) {
            const r = b.getBoundingClientRect();
            if (!r.width || !r.height || r.top < cr.top || r.bottom > cr.bottom || r.left < cr.left - 1 || r.right > cr.right + 1) continue;
            // whatever is on top at its corners and centre must be the box itself
            const pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]];
            if (!pts.every(([x, y]) => { const t = document.elementFromPoint(x, y); return t && (t === b || b.contains(t)); })) continue;
            items.push({ id: Number(b.parentElement.dataset.id), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
        }
        return items;
    }

    function tick() {
        const items = placement();
        const s = JSON.stringify(items);
        if (s === sent) return;
        sent = s;
        try { bridge.place(JSON.stringify({ dpr: window.devicePixelRatio || 1, items })); } catch (_) { /* app gone */ }
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerTodayItem !== 'function') return;
        sh.registerTodayItem({ id: 'androidwidgets', label: 'Android Widgets', after: 'favorites', defaultOn: false, render });
        // a widget added (or the add cancelled) in the app: Today draws the list again
        window.addEventListener('melatonwidgets', () => { sig = ''; if (sh.refreshToday) sh.refreshToday(); });
        clearInterval(timer);
        timer = setInterval(tick, 150);
        document.addEventListener('visibilitychange', tick);
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
