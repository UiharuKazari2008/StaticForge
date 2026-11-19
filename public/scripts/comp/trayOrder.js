/*
 * The notification area's icon order (#932): every desktop tray icon can be dragged to a new place, and the order
 * follows the user to all of their desktops.
 *
 *   Default    app.html's order, which is Vista's: the program icons, then the system icons Power, Network, Volume
 *              next to the clock (Yukimi, Nov 19 2026). A saved order never names an icon it does not know, so an
 *              icon added later takes its default place among the others.
 *   Saved      config.json userGlobalSettings.desktop.trayOrder (the server's user settings, saved through
 *              persistUserGlobalSettingsPatch, modalUtils.js; modules/websocketHandlers.js normalizes it). The other
 *              desktops of the user hear 'desktop_tray_order_changed' (a desktop-only push). A copy stays in this
 *              browser (localStorage desktop-tray-order) so the order is right before the server answers
 *              (installed-boot-zero-wait).
 *   Dragging   pointer events, no browser drag image (no-native-browser-ui): press an icon and move it 4 px, an
 *              insertion bar shows where it lands, release drops it; Escape cancels. The click that ends a drag
 *              does not open the icon's flyout.
 *
 *   trayOrder.apply(ids)   lay the icons out in this order (from the server or another desktop)
 *   trayOrder.current()    the order now (every icon's id, left to right)
 *   trayOrder.reset()      Vista's order again, saved
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const LOCAL_KEY = 'desktop-tray-order';
    const DRAG_PX = 4;
    const ID_RE = /^[A-Za-z][\w-]{0,63}$/;
    // the icons that stay at the right, next to the clock, by default: Nightshade, then Vista's Power, Network, Volume
    const SYSTEM_RIGHT = ['nightshadeTrayIcon', 'powerTrayIcon', 'modemTrayIcon', 'volumeTrayIcon'];

    let defaults = null;   // app.html's order, read once
    let saved = null;      // the user's order (ids), or null for the default

    const box = () => (doc ? doc.querySelector('#desktopTaskbar .taskbar-tray-icons, .taskbar-tray-icons') : null);
    const icons = (b) => Array.from(b.children).filter((el) => el.classList.contains('taskbar-tray-icon') && el.id);

    function clean(list) {
        if (!Array.isArray(list)) return null;
        const out = [];
        list.forEach((id) => { if (typeof id === 'string' && ID_RE.test(id) && !out.includes(id)) out.push(id); });
        return out.slice(0, 64);
    }

    function readLocal() {
        try { return clean(JSON.parse(root.localStorage.getItem(LOCAL_KEY) || 'null')); } catch (_) { return null; }
    }

    function writeLocal(list) {
        try {
            if (list) root.localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
            else root.localStorage.removeItem(LOCAL_KEY);
        } catch (_) { /* private mode */ }
    }

    /** The saved ids first in their order; an icon the list does not name keeps its default neighbour. */
    function merged(user, def) {
        const out = user.filter((id) => def.includes(id));
        def.forEach((id, i) => {
            if (out.includes(id)) return;
            let at = 0;
            for (let j = i - 1; j >= 0; j--) {
                const k = out.indexOf(def[j]);
                if (k >= 0) { at = k + 1; break; }
            }
            out.splice(at, 0, id);
        });
        return out;
    }

    /** Moves the icons into place (only the ones out of place: each move is a DOM change the tray observer sees). */
    function layout() {
        const b = box();
        if (!b) return;
        if (!defaults) defaults = icons(b).map((el) => el.id);
        const known = icons(b).map((el) => el.id);
        // an icon a program adds later (appended at the end) takes its place left of the system icons, as on Vista
        known.filter((id) => !defaults.includes(id)).forEach((id) => {
            const at = defaults.findIndex((d) => SYSTEM_RIGHT.includes(d));
            defaults.splice(at < 0 ? defaults.length : at, 0, id);
        });
        const want = merged(saved || defaults, defaults).filter((id) => known.includes(id));
        const now = icons(b);
        if (now.map((el) => el.id).join('|') === want.join('|')) return;
        // the icons sit after the chevron and before whatever is not an icon (the WebSocket arrows)
        const tail = now.length ? now[now.length - 1].nextSibling : null;
        want.forEach((id) => {
            const el = doc.getElementById(id);
            if (el) b.insertBefore(el, tail);
        });
    }

    function current() {
        const b = box();
        return b ? icons(b).map((el) => el.id) : [];
    }

    function apply(list) {
        const next = clean(list);
        saved = next && next.length ? next : null;
        writeLocal(saved);
        layout();
    }

    function save(list) {
        apply(list);
        const persist = root.persistUserGlobalSettingsPatch;
        if (typeof persist === 'function') {
            Promise.resolve(persist({ desktop: { trayOrder: saved || [] } })).catch((e) => console.warn('[trayOrder] save', e));
        }
    }

    function reset() {
        save(null);
    }

    // ---- dragging -----------------------------------------------------------------------------------------------

    let drag = null;

    function clearMarks() {
        const b = box();
        if (!b) return;
        b.querySelectorAll('.tray-drop-before, .tray-drop-after, .tray-dragging').forEach((el) => {
            el.classList.remove('tray-drop-before', 'tray-drop-after', 'tray-dragging');
        });
    }

    /** The icon under the pointer's x among the visible ones, and which side of it. */
    function dropAt(x) {
        const b = box();
        const shown = icons(b).filter((el) => el !== drag.el && el.offsetWidth > 0 && !el.classList.contains('hidden'));
        let best = null;
        shown.forEach((el) => {
            const r = el.getBoundingClientRect();
            const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
            if (!best || d < best.d) best = { el, d, after: x > r.left + r.width / 2 };
        });
        return best;
    }

    function onDown(ev) {
        if (ev.button !== 0 || !ev.isPrimary) return;
        const el = ev.target.closest && ev.target.closest('.taskbar-tray-icon');
        const b = box();
        if (!el || !b || el.parentElement !== b || !el.id) return;
        drag = { el, x: ev.clientX, y: ev.clientY, id: ev.pointerId, moving: false, target: null };
    }

    function onMove(ev) {
        if (!drag || ev.pointerId !== drag.id) return;
        if (!drag.moving) {
            if (Math.abs(ev.clientX - drag.x) < DRAG_PX && Math.abs(ev.clientY - drag.y) < DRAG_PX) return;
            drag.moving = true;
            drag.el.classList.add('tray-dragging');
            try { drag.el.setPointerCapture(ev.pointerId); } catch (_) { /* fine */ }
        }
        ev.preventDefault();
        const t = dropAt(ev.clientX);
        clearMarks();
        drag.el.classList.add('tray-dragging');
        drag.target = t;
        if (t) t.el.classList.add(t.after ? 'tray-drop-after' : 'tray-drop-before');
    }

    function end(ev, cancel) {
        if (!drag || (ev && ev.pointerId !== drag.id)) return;
        const d = drag;
        drag = null;
        clearMarks();
        if (!d.moving) return;
        // the click that follows the release is the drag's, not the icon's
        const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
        root.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => root.removeEventListener('click', eat, { capture: true }), 0);
        if (cancel || !d.target) return;
        const order = current().filter((id) => id !== d.el.id);
        const at = order.indexOf(d.target.el.id) + (d.target.after ? 1 : 0);
        order.splice(at, 0, d.el.id);
        if (order.join('|') !== current().join('|')) save(order);
    }

    function wire() {
        const b = box();
        if (!b || b.dataset.trayOrder === '1') return;
        b.dataset.trayOrder = '1';
        // a tray icon added later goes to its place (only icons coming in count; the moves here are re-inserts)
        let pending = false;
        new MutationObserver((list) => {
            if (pending || !list.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && n.classList.contains('taskbar-tray-icon') && n.id && !(defaults || []).includes(n.id)))) return;
            pending = true;
            Promise.resolve().then(() => { pending = false; layout(); });
        }).observe(b, { childList: true });
        b.addEventListener('pointerdown', onDown);
        b.addEventListener('pointermove', onMove);
        b.addEventListener('pointerup', (ev) => end(ev, false));
        b.addEventListener('pointercancel', (ev) => end(ev, true));
        doc.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && drag && drag.moving) end({ pointerId: drag.id }, true); }, { signal: appScopeSignal });
    }

    // another desktop of the user moved an icon (modules/ws/handlers/200-userSettingsHandler.js)
    let socketWired = false;
    function wireSocket() {
        const ws = root.wsClient;
        if (socketWired || !ws || typeof ws.on !== 'function') return;
        socketWired = true;
        ws.on('desktop_tray_order_changed', (msg) => {
            const data = msg && (msg.data || msg);
            if (data && Array.isArray(data.trayOrder)) apply(data.trayOrder);
        }, { signal: appScopeSignal });
    }

    function start() {
        if (root.uiShell === 'mobile' || !box()) return;
        saved = readLocal();
        layout();
        wire();
        wireSocket();
        if (!socketWired) doc.addEventListener('desktopBootDone', wireSocket, { once: true, signal: appScopeSignal });
    }

    const api = { apply, current, reset, save, _test: { merged, clean } };
    root.trayOrder = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!doc) return;
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
