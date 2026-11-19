/*
 * Captive portal sign-in on DreamOS (#910). A hotel or café network that wants a sign-in before it lets anything
 * through is noticed by the CaféReady host (DreamOS cafeready/src/portal.rs: one plain-HTTP check when the network
 * changes, never on a timer) and reaches this page as window.DreamOSPortal + 'dreamosportal' events (the shell
 * bridge). This file is the page's side:
 *
 *   - the network tray icon shows limited access and says "Additional log on information may be required." in a
 *     balloon; a click on the balloon opens the browser (Windows 7's network balloon: Vista has none for this);
 *   - "the browser" is Grimoire with the local Alchemy: a throwaway browser the host runs on the laptop itself
 *     (alchemy.rs), streamed into Grimoire's normal Alchemy view (grimoireRemoteBrowser.js takes it as a ready-made
 *     session). The server's Alchemy cannot reach a portal, and the kiosk never leaves the app;
 *   - when the host's check passes, it closes the session; this file closes the tab and has the link reconnect;
 *   - Network and Server Center and the network flyout read captive() / state() (melatonControlPanel.js).
 *
 * Nothing here runs on a timer and nothing is asked of the server. Without window.DreamOSPortal (every client but
 * DreamOS) the file only exports an inert window.dreamosPortal.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const host = () => root.DreamOSPortal || null;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const POPUP_ID = 'network-portal';
    const TITLE = 'Additional log on information may be required.';
    const CLICK = 'Click to open your browser.';

    let last = { state: 'unknown' };
    let balloonFor = '';
    let opening = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function state() {
        const h = host();
        let s = null;
        try { s = h && h.get(); } catch (_) { s = null; }
        return s && typeof s === 'object' && s.state ? s : { state: 'unknown' };
    }

    const captive = () => last.state === 'portal';

    /** The network's name as the tray and the balloon say it: the Wi-Fi network, else the wired connection. */
    function networkName() {
        if (last.network) return String(last.network);
        return 'Local Area Connection';
    }

    /** Grimoire shells that show the local Alchemy (grimoireRemoteBrowser.js marks them). */
    function localShells() {
        const close = root.grimoireCloseLocalAlchemy;
        if (typeof close !== 'function' || typeof close.shells !== 'function') return [];
        try { return close.shells(); } catch (_) { return []; }
    }

    /** The tab (or window) a local Alchemy page sits in goes when its session ended. */
    function closeLocalViews() {
        localShells().forEach((shell) => {
            try {
                if (typeof root.grimoireCloseLocalAlchemy === 'function') root.grimoireCloseLocalAlchemy(shell);
            } catch (_) { /* the window is going anyway */ }
        });
    }

    function showBalloon() {
        const icon = doc && doc.getElementById('modemTrayIcon');
        const pm = root.PopoverManager;
        if (!icon || !pm || typeof pm.showPopover !== 'function') return;
        // the tray standard (tray-balloons): the network icon's own balloon, one at a time, closes by itself;
        // a click on it is the action (popoverManager.js onClick)
        pm.showPopover(icon, 'info', esc(TITLE), esc(CLICK), false, 15000,
            '<img src="/static_images/vista-icons/net-limited-32.png" alt="" width="32" height="32">', null,
            { popupId: POPUP_ID, position: 'top', arrowPosition: 'bottom-right', onClick: () => { void openBrowser(); } });
    }

    function refreshShell() {
        const ws = root.wsClient;
        // the tray globe's limited look (.desktop-taskbar.net-portal, vista-glass-controls.css: set here, on a change
        // only) and its tooltip (websocket.js reads captive())
        const bar = doc.querySelector('.desktop-taskbar');
        if (bar) bar.classList.toggle('net-portal', captive());
        try { if (ws && typeof ws._updateModemTrayIcon === 'function') ws._updateModemTrayIcon(); } catch (_) { /* no taskbar */ }
        try { root.dispatchEvent(new CustomEvent('dreamosportal:change', { detail: last })); } catch (_) { /* old engine */ }
    }

    function apply(next) {
        const was = last;
        last = next && next.state ? next : { state: 'unknown' };
        if (was.state === last.state && was.network === last.network && !!was.session === !!last.session) return;
        refreshShell();
        // the host ended the session (signed in, the network went, nobody looked at it): its view goes
        if (was.session && !last.session) closeLocalViews();
        if (captive()) {
            // once per network: the icon keeps saying it, and the flyout and the Center open the browser too
            const key = `${last.network || ''}|${last.probe || ''}`;
            if (was.state !== 'portal' || balloonFor !== key) {
                balloonFor = key;
                if (!localShells().length) showBalloon();
            }
            return;
        }
        balloonFor = '';
        if (was.state === 'portal') closeLocalViews();
        if (last.state === 'online' && was.state === 'portal') {
            // the network is open: the link tries now instead of at its next retry
            const ws = root.wsClient;
            try { if (ws && typeof ws._reconnectOnFocusRegain === 'function') ws._reconnectOnFocusRegain('portal'); } catch (_) { /* it retries by itself */ }
        }
    }

    /** Opens the sign-in page in Grimoire through the local Alchemy. Resolves true when a view opened. */
    function openBrowser() {
        const h = host();
        if (!h) return Promise.resolve(false);
        if (opening) return opening;
        // already open: its window comes forward (grimoireWindowOf: tagWikiSearchModal.js; a background tab has no modal of its own)
        const shown = localShells()[0];
        if (shown) {
            const win = shown.modal ? shown : (typeof root.grimoireWindowOf === 'function' ? root.grimoireWindowOf(shown) : null);
            if (win && win.modal && typeof root.bringModalToFront === 'function') root.bringModalToFront(win.modal);
            return Promise.resolve(true);
        }
        const loader = root.featureLoader;
        opening = Promise.resolve(loader && typeof loader.loadFeature === 'function' ? loader.loadFeature('grimoire') : null)
            .then(() => h.open({
                width: Math.max(640, Math.min(1600, Math.round((root.innerWidth || 1280) * 0.7))),
                height: Math.max(480, Math.min(1000, Math.round((root.innerHeight || 800) * 0.7))),
                scale: Math.max(1, Math.min(2, root.devicePixelRatio || 1))
            }))
            .then((r) => {
                if (!r || !r.viewUrl) throw new Error((r && r.error) || 'the browser did not start');
                const url = r.url || last.url || '';
                const session = { sessionId: r.id, viewUrl: r.viewUrl, local: true };
                // a tab in the Grimoire window (grimoireTabs.js), else a window of its own
                if (typeof root.grimoireOpenInTab === 'function' && root.grimoireOpenInTab({ url, session })) return true;
                if (typeof root.grimoireOpenStandaloneWindow === 'function') { root.grimoireOpenStandaloneWindow(url, session, networkName()); return true; }
                throw new Error('Grimoire is not available');
            })
            .catch((e) => {
                try { h.close(); } catch (_) { /* nothing open */ }
                if (typeof root.showConfirmationDialog === 'function') {
                    root.showConfirmationDialog(`The log on page for this network could not be opened.\n\n${e && e.message ? e.message : e}`,
                        [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Network', icon: 'fas fa-exclamation-triangle' });
                }
                return false;
            })
            .then((ok) => { opening = null; return ok; });
        return opening;
    }

    const api = {
        available: () => !!host(),
        state: () => last,
        captive,
        networkName,
        title: TITLE,
        openBrowser,
        /** grimoireRemoteBrowser.js: the user closed the local Alchemy's tab or window */
        sessionClosed: () => { const h = host(); if (h) { try { h.close(); } catch (_) { /* gone */ } } },
        _test: { apply }
    };
    root.dreamosPortal = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!host() || !doc) return;

    root.addEventListener('dreamosportal', (e) => { wire(); apply(e && e.detail); }, { signal: appScopeSignal });
    // the link to the server dropped: a portal may have come back (a session that timed out). One check, on the event.
    let wired = false;
    const wire = () => {
        const ws = root.wsClient;
        if (wired || !ws || typeof ws.on !== 'function') return;
        wired = true;
        ws.on('disconnected', () => { const h = host(); if (h) { try { h.check(); } catch (_) { /* host away */ } } }, { signal: appScopeSignal });
    };
    const start = () => { wire(); apply(state()); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
