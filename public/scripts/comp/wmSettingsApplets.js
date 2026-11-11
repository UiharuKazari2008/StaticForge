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

    function register(a) {
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

    window.addEventListener('dreamscape:applets', (e) => {
        const d = (e && e.detail) || {};
        // labels or new applets: register again (registerPage replaces by id)
        applets().forEach(register);
        if (d.message) say(d.id, d);
        redraw();
    });
}());
