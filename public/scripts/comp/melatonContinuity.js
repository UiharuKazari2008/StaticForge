/**
 * Continuity (Yozora #798): the Dreamscape app's two windows (the phone screen's Melaton Mobile and the
 * DeX desktop window) talking directly, without the server. DSApp's ContinuityBus (4dac430) passes JSON
 * between the windows of one app process; this is the page's half.
 *
 * window.melatonContinuity
 *   available            the app's bus is there (inside the Android app)
 *   role()               'phone' | 'desktop' (this window), null outside the app
 *   peers()              the other windows' roles now, e.g. ['desktop']
 *   hybrid()             AndroidHome.getContinuity(): DeX opened once and Dreamscape is home
 *   post(msg)            JSON-able { type, ... } to the other window(s); true when one got it
 *   on(type, fn)         fn(msg, fromRole); 'peer' = { state: 'joined' | 'left', role }
 *   registerHandoff(id, { label, capture() -> state, open(state, role) })
 *   canHandoff(id)       a handler exists and another window is there
 *   handoff(id, state?)  send that program (with its state) to the other window: it opens there
 *
 * Handoffs registered here: 'browser' { url } (Internet Explorer Mobile on the phone, Alchemy on the
 * desktop), 'explorer' { path }, 'weather'. Programs add their own with registerHandoff.
 * Shared connection (slice F, below): the DeX window's server traffic rides the phone window's socket.
 */
(function (root) {
    'use strict';

    const listeners = new Map();
    const handoffs = new Map();
    const bridge = () => root.AndroidContinuity || null;

    function emit(type, msg, from) {
        (listeners.get(type) || []).slice().forEach((fn) => { try { fn(msg, from); } catch (err) { console.warn('[continuity]', type, err); } });
    }

    const api = {
        get available() { return !!bridge(); },
        role() { try { return bridge() ? String(bridge().role()) : null; } catch (_) { return null; } },
        peers() { try { return bridge() ? JSON.parse(bridge().peers()) : []; } catch (_) { return []; } },
        hybrid() {
            try {
                const H = root.AndroidHome;
                if (H && typeof H.getContinuity === 'function') return JSON.parse(H.getContinuity());
                // an app build before DSApp 4dac430: worked out from what it does report
                if (!H || typeof H.isHome !== 'function') return null;
                const external = typeof H.isExternalDisplay === 'function' && H.isExternalDisplay();
                const home = H.isHome();
                const A = root.AndroidActiveSync;
                return { hybrid: !!(home && external), dexSeen: external, home, external, deviceId: A && typeof A.getDeviceId === 'function' ? A.getDeviceId() : '' };
            } catch (_) { return null; }
        },
        post(msg) {
            try { return !!(bridge() && bridge().post(JSON.stringify(msg))); } catch (_) { return false; }
        },
        on(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
            return () => { const l = listeners.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
        },
        /** Called by DSApp's ContinuityBus with a message from the other window. */
        receive(json, from) {
            let msg = null;
            try { msg = JSON.parse(json); } catch (_) { return; }
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'handoff') { openHandoff(msg, from); return; }
            emit(msg.type, msg, from);
        },
        registerHandoff(id, spec) {
            if (id && spec && typeof spec.open === 'function') handoffs.set(String(id), spec);
        },
        canHandoff(id) {
            return api.available && handoffs.has(String(id)) && api.peers().length > 0;
        },
        handoff(id, state) {
            const h = handoffs.get(String(id));
            if (!h || !api.available) return false;
            let s = state;
            if (s === undefined && typeof h.capture === 'function') { try { s = h.capture(); } catch (_) { s = null; } }
            return api.post({ type: 'handoff', id: String(id), state: s || {}, label: h.label || String(id) });
        }
    };

    function openHandoff(msg, from) {
        const h = handoffs.get(String(msg.id));
        if (!h) return;
        try { h.open(msg.state || {}, api.role()); } catch (err) { console.warn('[continuity] handoff', msg.id, err); }
        emit('handoff', msg, from);
    }

    // ---- the handoffs this page knows how to open
    const onPhone = () => api.role() === 'phone';
    const shell = () => root.wmShell || null;

    api.registerHandoff('browser', {
        label: 'Internet',
        capture() {
            // the phone's window on screen (wmBrowser.windows); the desktop passes its url to handoff()
            const B = root.wmBrowser;
            const w = B && typeof B.windows === 'function' ? B.windows().find((x) => x.current) : null;
            return w && /^https?:\/\//i.test(w.url || '') ? { url: w.url } : null;
        },
        open(state) {
            const url = String((state && state.url) || '');
            if (!/^https?:\/\//i.test(url)) return;
            if (onPhone()) {
                // Internet Explorer Mobile on the page (wmBrowser.open opens the app too)
                const B = root.wmBrowser;
                if (B && typeof B.open === 'function') B.open(url);
                return;
            }
            // openWebUrl: featureLoader.js (Alchemy)
            if (typeof root.openWebUrl === 'function') root.openWebUrl(url);
        }
    });

    api.registerHandoff('explorer', {
        label: 'File Explorer',
        open(state) {
            const path = String((state && state.path) || '');
            if (onPhone()) {
                const sh = shell();
                if (sh) sh.open('fileexplorer');
                return;
            }
            if (typeof root.openExplorerApplet === 'function') root.openExplorerApplet(path || undefined);
        }
    });

    api.registerHandoff('weather', {
        label: 'Weather',
        open() {
            const W = root.wmWeather;
            if (!W) return;
            if (onPhone()) W.open(); else if (typeof W.openDesktop === 'function') W.openDesktop();
        }
    });

    // ================================================================ shared connection (slice F)
    //
    // The DeX window of a hybrid phone has no server socket: websocket.js asks transport() for a
    // WebSocket stand-in (BusSocket) whose packets the phone window carries over its own socket
    // (sub_open / sub_packet / sub_close, modules/ws/virtualSocket.js). On the server the DeX window is
    // a client of its own. The phone window says when it is ready (Today reached, its socket up);
    // the DeX window's BIOS waits for that ("Connecting to Phone...", phoenixBios.js), and when the
    // phone window goes away (a restart) the DeX window starts again with it.

    const SUB = 'desktop';
    let phoneReadyNow = false;
    let lastReadySent = null;
    const isDw = () => api.available && api.role() === 'desktop' && !!(api.hybrid() || {}).hybrid;
    const isPhone = () => api.available && api.role() === 'phone';
    const inApp = () => !!root.wsClient && !root.isLaunchPage;

    // ---- the phone window: readiness and the carrier
    function phoneReadyState() {
        const c = root.wsClient;
        const booted = document.documentElement.dataset.wmBoot === 'done';
        return !!(booted && c && typeof c.isConnected === 'function' && c.isConnected() && c.ws && c.ws.readyState === 1);
    }
    function announceReady(force) {
        if (!isPhone()) return;
        const ready = phoneReadyState();
        if (!force && ready === lastReadySent) return;
        lastReadySent = ready;
        api.post({ type: 'phone-ready', ready });
    }
    function carrierSend(packet) {
        const c = root.wsClient;
        if (!c || !c.ws || c.ws.readyState !== 1) return false;
        try { c.ws.send(JSON.stringify(packet)); return true; } catch (_) { return false; }
    }
    let carryingNow = false;
    function setCarrying(v) { const on = !!v; if (on !== carryingNow) { carryingNow = on; statusChanged(); } return on; }
    const statusChanged = () => { const sh = root.wmShell; if (sh && typeof sh.refreshStatus === 'function') sh.refreshStatus(); };
    // carrying: the title bar's Continuity glyph follows it
    Object.defineProperty(api, '_carrying', { get: () => carryingNow });
    api.on('phone-ready?', () => announceReady(true));
    api.on('ws-open', () => {
        if (!isPhone()) return;
        setCarrying(carrierSend({ type: 'sub_open', sub: SUB }));
        api.post(carryingNow ? { type: 'ws-opened' } : { type: 'ws-closed', reason: 'The phone is not connected' });
    });
    api.on('ws-up', (m) => { if (isPhone() && typeof m.data === 'string' && !carrierSend({ type: 'sub_packet', sub: SUB, data: m.data })) api.post({ type: 'ws-closed', reason: 'The phone is not connected' }); });
    api.on('ws-close', () => { if (isPhone() && carryingNow) { carrierSend({ type: 'sub_close', sub: SUB }); setCarrying(false); } });
    // the DeX window went away (unplugged, closed, restarting): its sub-client ends with it
    api.on('peer', (m) => { if (m.role === 'desktop' && m.state === 'left' && isPhone() && carryingNow) { carrierSend({ type: 'sub_close', sub: SUB }); setCarrying(false); } });
    /** websocket.js (phone window): a server packet for a sub-client; true when it was one. */
    api.fromServer = (message) => {
        if (!message || (message.type !== 'sub_packet' && message.type !== 'sub_closed')) return false;
        if (message.sub !== SUB) return true;
        if (message.type === 'sub_closed') { setCarrying(false); api.post({ type: 'ws-closed', reason: 'The server ended the shared connection' }); return true; }
        if (typeof message.data === 'string') api.post({ type: 'ws-down', data: message.data });
        return true;
    };

    // ---- the DeX window: readiness, the socket stand-in, restarts
    api.on('phone-ready', (m) => { phoneReadyNow = !!m.ready; });
    api.on('peer', (m) => {
        if (m.role === 'phone' && m.state === 'joined' && isDw()) api.post({ type: 'phone-ready?' });
        if (m.role === 'phone' && m.state === 'left') {
            phoneReadyNow = false;
            // past its boot, the DeX window starts again with the phone (Yukimi: restarting the phone restarts DeX)
            if (isDw() && inApp()) coldBootDw();
        }
    });
    api.on('phone-restarting', () => { phoneReadyNow = false; if (isDw() && inApp()) coldBootDw(); });
    let rebooting = false;
    function coldBootDw() {
        if (rebooting) return;
        rebooting = true;
        const D = root.AndroidDisplay;
        try { if (D && typeof D.coldBoot === 'function') { D.coldBoot(); return; } } catch (_) { /* fall back */ }
        location.replace('/launch');
    }
    /** The DeX window: true once the phone said it is ready (the BIOS waits on this). */
    api.phoneReady = () => {
        if (!phoneReadyNow && isDw()) api.post({ type: 'phone-ready?' });
        return phoneReadyNow;
    };

    /** A WebSocket stand-in over the bus (DeX window): what websocket.js uses instead of new WebSocket(). */
    class BusSocket {
        constructor() {
            this.readyState = 0;
            this.binaryType = 'blob';
            this.bufferedAmount = 0;
            this.onopen = null;
            this.onmessage = null;
            this.onclose = null;
            this.onerror = null;
            this._off = [
                api.on('ws-opened', () => { if (this.readyState !== 0) return; this.readyState = 1; if (this.onopen) this.onopen({ type: 'open' }); }),
                api.on('ws-down', (m) => { if (this.readyState === 1 && this.onmessage) this.onmessage({ type: 'message', data: m.data }); }),
                api.on('ws-closed', (m) => this._closed(1006, m.reason || 'closed')),
                api.on('peer', (m) => { if (m.role === 'phone' && m.state === 'left') this._closed(1006, 'The phone window closed'); })
            ];
            setTimeout(() => { if (!api.post({ type: 'ws-open' })) this._closed(1006, 'No phone window'); }, 0);
        }
        send(data) {
            if (this.readyState !== 1) throw new Error('The shared connection is not open');
            if (!api.post({ type: 'ws-up', data: String(data) })) this._closed(1006, 'The phone window closed');
        }
        close(code = 1000, reason = '') {
            if (this.readyState >= 2) return;
            api.post({ type: 'ws-close' });
            this._closed(code, reason);
        }
        _closed(code, reason) {
            if (this.readyState === 3) return;
            this.readyState = 3;
            this._off.forEach((f) => f());
            if (this.onclose) this.onclose({ type: 'close', code, reason, wasClean: code === 1000 });
        }
    }
    /** websocket.js: a WebSocket stand-in when this is the DeX window of a hybrid phone that is ready, else null. */
    // (whenever the phone window is there: not yet ready, it answers ws-closed and websocket.js tries again)
    api.transport = () => (isDw() && api.peers().includes('phone') ? new BusSocket() : null);
    /** The phone window: true while it carries the DeX window's connection (the title bar's glyph). */
    api.active = () => isPhone() && carryingNow;
    /** The DeX window of a hybrid phone leaves updates to the phone (serviceWorkerManager.js). */
    api.isDexWindow = () => isDw();

    // the phone window: say when it is ready, and that it is going
    if (api.available) {
        const watch = () => {
            if (!isPhone()) return;
            new MutationObserver(() => announceReady(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wm-boot'] });
            const c = root.wsClient;
            if (c && typeof c.on === 'function') {
                c.on('connected', () => { announceReady(false); });
                c.on('disconnected', () => { setCarrying(false); api.post({ type: 'ws-closed', reason: 'The phone lost its connection' }); announceReady(false); });
            }
            announceReady(true);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(watch, 0)); else setTimeout(watch, 0);
        root.addEventListener('pagehide', () => { if (isPhone()) api.post({ type: 'phone-restarting' }); });
        // the DeX window asks once it is up (the answer may already be waiting)
        setTimeout(() => { if (isDw()) api.post({ type: 'phone-ready?' }); }, 0);
    }

    root.melatonContinuity = api;
})(typeof window !== 'undefined' ? window : globalThis);
