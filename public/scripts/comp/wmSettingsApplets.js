/**
 * Melaton Mobile Settings: mini-apps the Android app provides (#735).
 *
 * The Dreamscape app for Android describes small settings pages as data (window.AndroidApplets,
 * DSApp NativeApplets.kt) and this file draws each one as a WM 6.1 page with wmSettings.ui, so a
 * new native applet needs no page code:
 *
 *   AndroidApplets.list()  [{ id, label, tab: 'personal' | 'system' | 'connections', icon, rows }]
 *     rows: { type: 'text' | 'note' | 'sub', text } | { type: 'value', label, value } | { type: 'gap' }
 *         | { type: 'check', id, label, value, disabled } | { type: 'buttons', items: [{ id, label, disabled }] }
 *   AndroidApplets.action(appletId, actionId, value)  { ok, message?, title?, icon? }
 *   window event 'dreamscape:applets' { id, message?, title?, icon? }: re-read and redraw
 *
 * First applet: Shizuku (shell-level radio control for Wireless Manager).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.registerPage !== 'function') return;
    const bridge = window.AndroidApplets;
    if (!bridge || typeof bridge.list !== 'function') return;

    const ui = wmSettings.ui;
    const TABS = new Set(['personal', 'system', 'connections']);
    let shown = null; // { id, el, api } of the applet page on screen
    const registered = new Set();

    function applets() {
        try {
            const list = JSON.parse(bridge.list());
            return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string' && a.label) : [];
        } catch (_) { return []; }
    }

    function labelOf(id) {
        const a = applets().find((x) => x.id === id);
        return (a && a.label) || 'Settings';
    }

    function say(id, res) {
        if (!res || !res.message) return;
        ui.messageBox({ title: res.title || labelOf(id), icon: res.icon || 'info', text: String(res.message), buttons: [{ text: 'ok', value: true }] });
    }

    function redraw() {
        if (shown && shown.el && shown.el.isConnected && shown.api && typeof shown.api.rerender === 'function') shown.api.rerender();
    }

    function act(id, actionId, value) {
        let res = null;
        try { res = JSON.parse(bridge.action(id, actionId, value == null ? null : String(value))); } catch (_) { res = { ok: false, message: 'The app did not answer.', icon: 'error' }; }
        say(id, res);
        redraw();
    }

    function rowHtml(r) {
        switch (r && r.type) {
            case 'text': return ui.text(r.text || '');
            case 'note': return ui.note(r.text || '');
            case 'sub': return ui.sub(r.text || '');
            case 'gap': return ui.gap();
            case 'value': return ui.value(r.label || '', r.value == null ? '' : String(r.value));
            case 'check': return ui.check(`applet-${r.id}`, r.label || '', !!r.value, `data-applet-check="${ui.esc(r.id)}"${r.disabled ? ' disabled' : ''}`);
            case 'buttons': return ui.buttons((Array.isArray(r.items) ? r.items : []).map((b) => [b.id, b.label, !!b.disabled]));
            default: return '';
        }
    }

    function draw(el, id, api) {
        shown = { id, el, api };
        const a = applets().find((x) => x.id === id);
        if (!a) {
            el.innerHTML = ui.note('This setting is not available in this version of the app.');
            return;
        }
        el.innerHTML = (Array.isArray(a.rows) ? a.rows : []).map(rowHtml).join('');
        el.querySelectorAll('[data-applet-check]').forEach((c) => {
            c.addEventListener('change', () => act(id, c.dataset.appletCheck, c.checked));
        });
        el.querySelectorAll('.wm-buttons [data-act]').forEach((b) => {
            b.addEventListener('click', () => { if (!b.disabled) act(id, b.dataset.act, null); });
        });
    }

    // Shizuku lives in Android Bridge > Debugging (Yukimi, Nov 13 2026, #818), not on a page of its own
    const MERGED = new Set(['shizuku']);

    function register(a) {
        if (MERGED.has(a.id)) return;
        const pageId = `applet-${a.id}`;
        registered.add(pageId);
        wmSettings.registerPage({
            id: pageId,
            tab: TABS.has(a.tab) ? a.tab : 'system',
            label: String(a.label),
            icon: typeof a.icon === 'string' && a.icon ? a.icon : 'set-about',
            tabs: [],
            init: () => ({}),
            render(el, tab, d, api) { draw(el, a.id, api); }
        });
    }

    applets().forEach(register);

    // ---------------------------------------------------------------- Android Bridge > Debugging (#818)

    /*
     * Shizuku's state and switches (the app's applet rows) and ADB on port 5555 as this server sees
     * it (modules/deviceAdb.js): Ready / Waiting for "Always allow" / Not listening, with
     *   Allow Melaton to use ADB                          allow (screenshots, installs over 5555)
     *   Restore ADB on port 5555 when it stops (on Wi-Fi) autoRestore (the app turns on wireless debugging)
     *   Send screenshots to Device Center                 screenshots (off: Device Center shows the wallpapers)
     */
    const ADB_STATE = {
        ready: 'Ready', unauthorized: 'Waiting for "Always allow" on this phone', unreachable: 'Not listening on port 5555',
        mismatch: 'Another device answers at this address', off: 'Off', unknown: 'Not checked yet', error: 'Not available on the server'
    };
    let adbNow = null;
    let adbAsked = 0;
    function selfId() {
        try { const st = window.activeSync && window.activeSync.state(); return (st && st.id) || null; } catch (_) { return null; }
    }
    function adbFetch(method, body, detect) {
        const id = selfId();
        if (!id) return Promise.resolve(null);
        const url = `/api/activesync/adb/${id}${method === 'PUT' ? '/settings' : (detect ? '?detect=1' : '')}`;
        return fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
            .then((r) => r.json()).then((j) => (j && j.success ? j.adb : null)).catch(() => null);
    }
    function adbRefresh(api, detect) {
        adbAsked = Date.now();
        adbFetch('GET', null, detect).then((s) => { adbNow = s; if (api && typeof api.rerender === 'function') api.rerender(); });
    }

    wmSettings.extendPage('default-programs', {
        id: 'dbg',
        tabs: [['dbg-debugging', 'Debugging']],
        init: () => ({}),
        render(el, tab, d, api) {
            // the applet's own redraws (act, dreamscape:applets) come back to this tab
            shown = { id: 'shizuku', el, api };
            const sh = applets().find((x) => x.id === 'shizuku');
            const rows = sh && Array.isArray(sh.rows) ? sh.rows : [];
            const a = adbNow;
            const set = a || { allow: true, autoRestore: false, screenshots: true };
            el.innerHTML = [
                ui.sub('Shizuku'),
                rows.length ? rows.map(rowHtml).join('') : ui.note('This version of the app has no Shizuku.'),
                ui.gap(),
                ui.sub('ADB (port 5555)'),
                ui.value('ADB:', selfId() ? (a ? (ADB_STATE[a.state] || a.state) : 'Checking...') : 'Not connected to ActiveSync'),
                a && a.address ? ui.value('Address:', a.address) : '',
                ui.check('dbg-allow', 'Allow Melaton to use ADB', set.allow !== false, 'data-dbg="allow"'),
                ui.check('dbg-restore', 'Restore ADB on port 5555 when it stops (on Wi-Fi)', !!set.autoRestore, 'data-dbg="autoRestore"'),
                ui.check('dbg-shots', 'Send screenshots to Device Center', set.screenshots !== false, 'data-dbg="screenshots"'),
                ui.buttons([['dbg-check', 'Check Now', !selfId()]]),
                ui.note(a && a.state === 'unauthorized'
                    ? 'Tap Always allow on the USB debugging question for this server.'
                    : 'With Restore on, the phone turns on wireless debugging by itself when ADB stops on Wi-Fi. Without screenshots, Device Center shows your wallpapers.')
            ].join('');
            el.querySelectorAll('[data-applet-check]').forEach((c) => c.addEventListener('change', () => act('shizuku', c.dataset.appletCheck, c.checked)));
            el.querySelectorAll('.wm-buttons [data-act]').forEach((b) => {
                const act2 = b.dataset.act;
                b.addEventListener('click', () => {
                    if (b.disabled) return;
                    if (act2 === 'dbg-check') { adbNow = adbNow ? Object.assign({}, adbNow, { state: 'unknown' }) : null; adbRefresh(api, true); api.rerender(); return; }
                    act('shizuku', act2, null);
                });
            });
            el.querySelectorAll('[data-dbg]').forEach((c) => c.addEventListener('change', () => {
                adbFetch('PUT', { [c.dataset.dbg]: c.checked }).then((s) => { if (s) adbNow = s; api.rerender(); });
                // the app restores 5555 itself: tell it when it can listen (DSApp AndroidActiveSync.setAdbRestore)
                if (c.dataset.dbg === 'autoRestore') {
                    try { const A = window.AndroidActiveSync; if (A && typeof A.setAdbRestore === 'function') A.setAdbRestore(!!c.checked); } catch (_) { /* older app */ }
                }
            }));
            if (!adbAsked || Date.now() - adbAsked > 60000) adbRefresh(api, false);
        }
    });

    window.addEventListener('dreamscape:applets', (e) => {
        const d = (e && e.detail) || {};
        // labels or new applets: register again (registerPage replaces by id)
        applets().forEach(register);
        if (d.message) say(d.id, d);
        redraw();
    });
}());
