/*
 * The network tray icon on DreamOS (#910, #932): the computer's own link as the CaféReady host pushes it
 * (window.DreamOSNetwork + 'dreamosnet' events, cafeready wifi.rs), drawn the way the network icon shows it:
 *
 *   wired (a cable with an address)   the usual network icon (pnidui.dll's two screens), websocket.js's globe
 *   Wi-Fi connected                   netshell.dll 160 (Vista's Wireless Network Connection: the screen with green
 *                                     waves), with pnidui 30's small warning when the network wants a sign-in
 *                                     (dreamosPortal.js) or reaches nothing beyond it; the signal is the flyout's
 *                                     bars (pnidui.dll 13-18) and the tooltip's "Signal strength"
 *   Wi-Fi on, nothing joined          netshell.dll 158; joining 159; the radio off 157
 *   no adapter connected at all       pnidui.dll 19, "Not Connected"
 *
 * The icon itself is drawn by vista-glass-controls.css from #modemTrayIcon[data-link][data-bars][data-limited],
 * set here on a change only; websocket.js _updateModemTrayIcon asks look() for its tooltip and the flyout
 * (melatonControlPanel.js networkFlyoutHtml) for its name, access and signal line. Wording: pnidui.dll.mui.
 *
 * Nothing polls: the provider pushes, and the browser's online / offline events and the portal's change event redraw.
 * The state comes from the 'network' tray provider (trayProviders.js, docs/client-api/tray-providers.md: DreamOS's
 * window.DreamOSNetwork, the Android app's desktop shell, which may add a mobile data link). Without one (a plain
 * browser) look() answers null and the icon stays websocket.js's.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    // the 'network' tray provider (trayProviders.js: DreamOS's CaféReady host, the Android app's desktop shell)
    const host = () => (root.melatonTray && root.melatonTray.provider('network')) || null;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    // pnidui.dll.mui 20-24
    const STRENGTH = ['Poor', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

    let state = null;

    function read() {
        const h = host();
        let s = null;
        try { s = h && h.get(); } catch (_) { s = null; }
        return s && typeof s === 'object' ? s : null;
    }

    /** 0-5 bars from the host's percent (iwd's dBm turned into 0-100). */
    function bars(percent) {
        const p = Number(percent);
        if (!Number.isFinite(p) || p <= 0) return 0;
        if (p >= 80) return 5;
        if (p >= 60) return 4;
        if (p >= 40) return 3;
        if (p >= 20) return 2;
        return 1;
    }

    const wiredLink = (s) => (Array.isArray(s.ethernet) ? s.ethernet : []).find((l) => l && l.carrier === true && Array.isArray(l.ip) && l.ip.length) || null;

    /**
     * What the icon shows now, or null when the host says nothing (not DreamOS, or before its first state):
     * { kind: 'wired' | 'wifi' | 'none', name, bars, strength, limited, access, title }
     */
    function look() {
        const s = state;
        if (!s) return null;
        const wifi = s.wifi || {};
        const wired = wiredLink(s);
        const portal = root.dreamosPortal && typeof root.dreamosPortal.captive === 'function' && root.dreamosPortal.captive();
        const browserOffline = !!root.navigator && root.navigator.onLine === false;
        const net = wifi.present && wifi.state === 'connected' && wifi.network ? wifi.network : null;
        const mobile = s.mobile && s.mobile.present && s.mobile.connected ? s.mobile : null;
        let out;
        if (wired) {
            out = { kind: 'wired', name: 'Local Area Connection', bars: 0 };
        } else if (net) {
            const b = bars(net.signalPercent);
            out = { kind: 'wifi', name: String(net.name || 'Wireless Network Connection'), bars: b, strength: STRENGTH[b] };
        } else if (mobile) {
            // a mobile data link (the Android app's desktop shell): Mobile broadband, the carrier and its bars
            const b = bars(mobile.signalPercent);
            out = { kind: 'mobile', name: String(mobile.carrier || 'Mobile Broadband Connection'), bars: b, strength: STRENGTH[b], generation: mobile.generation || '', roaming: !!mobile.roaming };
        } else {
            out = { kind: 'none', name: '', bars: 0, available: !!(wifi.present && wifi.radio !== false) };
        }
        out.connecting = !wired && !net && wifi.present && /connecting|roaming/.test(String(wifi.state || ''));
        // the wireless adapter when nothing is connected: radio off, joining, or on and free
        out.radio = out.kind === 'none' && wifi.present ? (wifi.radio === false || wifi.state === 'off' ? 'off' : out.connecting ? 'connecting' : 'idle') : null;
        out.limited = out.kind !== 'none' && (!!portal || browserOffline);
        out.access = out.kind === 'none' ? '' : out.limited ? 'Local only' : 'Local and Internet';
        out.title = out.kind === 'none'
            ? (out.connecting ? 'Connecting...' : 'Not Connected')
            : `${out.name}\nAccess: ${out.access}${out.kind === 'wifi' || out.kind === 'mobile' ? `\nSignal strength:  ${out.strength}` : ''}`;
        return out;
    }

    function setData(el, key, value) {
        if (value === null || value === undefined) {
            if (key in el.dataset) delete el.dataset[key];
        } else if (el.dataset[key] !== String(value)) {
            el.dataset[key] = String(value);
        }
    }

    /** Lays the look on #modemTrayIcon (attributes on a change only) and has websocket.js redo its tooltip. */
    function paint() {
        const icon = doc && doc.getElementById('modemTrayIcon');
        if (!icon) return;
        const l = look();
        setData(icon, 'link', l ? l.kind : null);
        setData(icon, 'bars', l && (l.kind === 'wifi' || l.kind === 'mobile') ? l.bars : null);
        setData(icon, 'limited', l && l.limited ? '1' : null);
        setData(icon, 'radio', l && l.radio ? l.radio : null);
        const ws = root.wsClient;
        try { if (ws && typeof ws._updateModemTrayIcon === 'function') ws._updateModemTrayIcon(); } catch (_) { /* no taskbar yet */ }
        try {
            const cp = root.melatonControlPanel;
            if (cp && typeof cp.refreshTrayFlyout === 'function') cp.refreshTrayFlyout();
        } catch (_) { /* no flyout */ }
    }

    function apply(next) {
        const key = JSON.stringify(next || null);
        if (key === JSON.stringify(state)) return;
        state = next || null;
        paint();
        try { root.dispatchEvent(new CustomEvent('dreamosnettray:change', { detail: look() })); } catch (_) { /* old engine */ }
    }

    const api = {
        available: () => !!host(),
        look,
        bars,
        state: () => state,
        /** the signal bars (pnidui.dll 13-18) at 16 or 32 px, for the flyout and the windows */
        barsPicture(l, size = 16) {
            const x = l || look();
            return x && (x.kind === 'wifi' || x.kind === 'mobile') ? `/static_images/vista-net/tray-wifi-${x.bars}-${size}.png` : null;
        },
        repaint: paint
    };
    root.dreamosNetTray = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!root.melatonTray || !doc) return;

    const off = root.melatonTray.onChange('network', (st) => apply(st));
    if (appScopeSignal) appScopeSignal.addEventListener('abort', off, { once: true });
    // the browser's own word on reaching anything, and a sign-in page coming or going: the limited look
    root.addEventListener('online', paint, { signal: appScopeSignal });
    root.addEventListener('offline', paint, { signal: appScopeSignal });
    root.addEventListener('dreamosportal:change', paint, { signal: appScopeSignal });
    const start = () => apply(read());
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
