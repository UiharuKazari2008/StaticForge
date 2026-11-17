/**
 * Android widgets on Today (6.1), while Melaton Mobile runs in the Android app (Yozora #794).
 *
 * A widget is a native view (DSApp HomeWidgets): this Today block keeps a placeholder for each one
 * (a name row over a box of the widget's height) and tells the app where the boxes are on screen
 * (AndroidWidgets.place) whenever that may have changed while Today is up; the app draws the widgets
 * there, over the page. A box that is covered (a menu, a message box, the Start menu, another app) or
 * not wholly on screen is not placed, so the widget never sits over WM's own windows. On 6.5 the
 * home screen covers Today's rows, so no widget is placed there.
 *
 * The places are worked out on a change (#890), not on a 150 ms timer that ran on every launch of the
 * app, the item switched off or not: Today scrolled, drawn or resized, a program or the page shown or
 * left, a layer of the shell opened or closed (a mutation under #wmShell), each one check on the next
 * frame plus two follow-ups (120 ms, 400 ms) for what opens with a move. Only while the block is drawn,
 * on and on screen; otherwise one empty placement is sent and nothing listens. The widget list is the
 * app's (AndroidWidgets.list, a sync bridge call): read once and again only after 'melatonwidgets'.
 *
 * Tap-and-hold a widget's name row (or tap "Tap here to add a widget"): Add Widget > the program >
 * its widgets, Remove.
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;
    const bridge = window.AndroidWidgets;
    if (!bridge || typeof bridge.place !== 'function') return;

    let sh = null;
    let box = null;      // the Today block
    let sig = '';        // the list drawn
    let sent = '';       // the last placement sent
    let list = null;     // the app's widgets, read once (null: read again at the next draw)

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
                if (yes) { bridge.remove(Number(w.id)); sig = ''; list = null; todayChanged(); }
            } }
        ];
    }

    function render(el) {
        if (!list) list = read('list');
        box = el;
        // under 6.5's home screen nothing is placed: no listeners set up for one check to take down again
        // on every full Today draw (only the boxes taken away, once)
        if (el.closest('.is-titanium')) { if (watching || sent !== '[]') soon(); } else watch();
        const s = JSON.stringify(list.map((w) => [w.id, w.minH, w.label]));
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

    /** The block is drawn, on and can be seen (Today in front, the page awake, 6.1's rows: not under 6.5's home screen). */
    function live() {
        if (!box || !box.isConnected || !sh || sh.currentApp() !== 'today' || box.hidden) return false;
        if (typeof sh.awake === 'function' ? !sh.awake() : document.visibilityState !== 'visible') return false;
        if (box.closest('.wm-today-off, [hidden], .is-titanium')) return false;
        return true;
    }

    /** Where the boxes are now: only the ones wholly on screen and not covered. */
    function placement() {
        const items = [];
        if (!live()) return items;
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
        if (s !== sent) {
            sent = s;
            try { bridge.place(JSON.stringify({ dpr: window.devicePixelRatio || 1, items })); } catch (_) { /* app gone */ }
        }
        // nothing to place any more (Today left, the screen off, the item off): stop listening until it is drawn again
        if (!live()) unwatch();
    }

    // ---- what moves the boxes: one check on the next frame, and two follow-ups for a layer that opens with a move
    let raf = 0;
    let late = [];
    let watching = false;
    let mo = null;
    let content = null;
    function soon() {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; tick(); });
        late.forEach(clearTimeout);
        late = [120, 400].map((ms) => setTimeout(tick, ms));
    }
    function watch() {
        if (watching) { soon(); return; }
        watching = true;
        content = document.querySelector('#wmShell .wm-content');
        if (content) content.addEventListener('scroll', soon, { passive: true });
        window.addEventListener('resize', soon);
        const shellEl = document.getElementById('wmShell');
        if (shellEl && typeof MutationObserver === 'function') {
            // a menu, message box, bubble, the Start menu or a page shown or hidden in the shell
            mo = new MutationObserver(soon);
            mo.observe(shellEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
        }
        soon();
    }
    function unwatch() {
        if (!watching) return;
        watching = false;
        if (content) content.removeEventListener('scroll', soon);
        content = null;
        window.removeEventListener('resize', soon);
        if (mo) { mo.disconnect(); mo = null; }
        late.forEach(clearTimeout);
        late = [];
    }
    // shown, left or back: the block that can be seen again (Today in front, the screen on: Today does not always
    // draw then) is watched again; anything else only needs the boxes taken away (one check)
    function changed() {
        if (live()) watch();
        else if (watching || sent !== '[]') soon();
    }

    /** Only this item drawn again (#890: not the whole of Today); an older shell draws it all. */
    function todayChanged() {
        if (!sh) return;
        if (typeof sh.refreshTodayItem === 'function') sh.refreshTodayItem('androidwidgets');
        else if (typeof sh.refreshToday === 'function') sh.refreshToday();
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerTodayItem !== 'function') return;
        // (no minute tick: nothing in the block shows a time)
        sh.registerTodayItem({ id: 'androidwidgets', label: 'Android Widgets', after: 'favorites', defaultOn: false, wantsMinute: false, render });
        // a widget added (or the add cancelled) in the app: Today draws the list again
        window.addEventListener('melatonwidgets', () => { sig = ''; list = null; todayChanged(); }, { signal: appScopeSignal });
        document.addEventListener('wmAppChange', changed, { signal: appScopeSignal });
        document.addEventListener('wmawake', changed, { signal: appScopeSignal });
        document.addEventListener('visibilitychange', changed, { signal: appScopeSignal });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
