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
    // the window's role and the phone's hybrid state do not change while a page lives: asked once
    let dwCached = null;
    const isDw = () => {
        if (dwCached !== null) return dwCached;
        if (!api.available) return false;
        const h = api.hybrid();
        if (!h) return false; // the app's bridges not there yet: ask again later
        dwCached = api.role() === 'desktop' && !!h.hybrid;
        return dwCached;
    };
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
    // the phone socket the DeX window's sub-client was opened on: a packet never goes over a newer
    // socket (the server would not know the sub-client there; it answers sub_closed, but only once the
    // DeX window sends something, and an idle DeX window only listens)
    let carrierWs = null;
    function carrierSend(packet) {
        const c = root.wsClient;
        if (!c || !c.ws || c.ws.readyState !== 1) return false;
        if (packet.type === 'sub_open') carrierWs = c.ws;
        else if (c.ws !== carrierWs) return false;
        try { c.ws.send(JSON.stringify(packet)); return true; } catch (_) { return false; }
    }
    /** The DeX window's sub-client is gone: it is told, with whether the phone is still ready for a new one. */
    function dropCarry(reason, always) {
        const was = carryingNow;
        setCarrying(false);
        if (was || always) api.post({ type: 'ws-closed', reason, phoneReady: phoneReadyState() });
    }
    let carryingNow = false;
    function setCarrying(v) { const on = !!v; if (on !== carryingNow) { carryingNow = on; statusChanged(); } if (!on) carrierWs = null; return on; }
    const statusChanged = () => { const sh = root.wmShell; if (sh && typeof sh.refreshStatus === 'function') sh.refreshStatus(); };
    // carrying: the title bar's Continuity glyph follows it
    Object.defineProperty(api, '_carrying', { get: () => carryingNow });
    api.on('phone-ready?', () => announceReady(true));
    api.on('ws-open', () => {
        if (!isPhone()) return;
        // raw: packets for the DeX window come unwrapped; cc: broadcasts come once, named for it (#798)
        setCarrying(carrierSend({ type: 'sub_open', sub: SUB, raw: 1, cc: 1 }));
        api.post(carryingNow ? { type: 'ws-opened' } : { type: 'ws-closed', reason: 'The phone is not connected', phoneReady: false });
    });
    api.on('ws-up', (m) => {
        if (!isPhone() || typeof m.data !== 'string') return;
        if (!carryingNow) { api.post({ type: 'ws-closed', reason: 'The phone is not carrying the connection', phoneReady: phoneReadyState() }); return; }
        if (!carrierSend({ type: 'sub_packet', sub: SUB, data: m.data })) dropCarry('The phone reconnected');
    });
    api.on('ws-close', () => { if (isPhone() && carryingNow) { carrierSend({ type: 'sub_close', sub: SUB }); setCarrying(false); } });
    // the DeX window went away (unplugged, closed, restarting): its sub-client ends with it
    api.on('peer', (m) => { if (m.role === 'desktop' && m.state === 'left' && isPhone() && carryingNow) { carrierSend({ type: 'sub_close', sub: SUB }); setCarrying(false); } });
    /** websocket.js (phone window): a raw sub-client packet "\u0001<sub>\u0001<packet>", relayed without parsing it. */
    api.fromServerRaw = (text) => {
        const at = text.indexOf('\u0001', 1);
        if (at < 0 || text.slice(1, at) !== SUB || !carryingNow) return;
        api.post({ type: 'ws-down', data: text.slice(at + 1) });
    };
    /** websocket.js (phone window): a broadcast the server sent once for both windows (_cc names the DeX window). */
    api.relayCopy = (subs, text) => {
        if (carryingNow && subs.includes(SUB) && typeof text === 'string') api.post({ type: 'ws-down', data: text });
    };
    /** websocket.js (phone window): a server packet for a sub-client; true when it was one. */
    api.fromServer = (message) => {
        if (!message || (message.type !== 'sub_packet' && message.type !== 'sub_closed')) return false;
        if (message.sub !== SUB) return true;
        if (message.type === 'sub_closed') { dropCarry('The server ended the shared connection', true); return true; }
        if (typeof message.data === 'string') api.post({ type: 'ws-down', data: message.data });
        return true;
    };

    // ---- the DeX window: readiness, the socket stand-in, restarts
    //
    // The DeX window's connection follows the phone's: while the phone has no connection the DeX
    // window does not spend websocket.js's retries (five, then "Use Reconnect") on a bus that cannot
    // carry it; it waits (waitForPhone) and connects the moment the phone says it is ready again.
    let waitingForPhone = false;
    let waitSafety = null;
    function followPhone() {
        const c = root.wsClient;
        if (!isDw() || !inApp() || !c || !phoneReadyNow) return;
        const onBus = !!(c.ws && c.ws.continuity);
        // up on the bus already, or a connect under way: nothing to do
        if ((c.isConnected() && onBus) || c.isConnecting || c.connectionLock) return;
        // a window still idle-disconnected stays that way (its own activity reconnects it)
        if (c.disconnectedDueToInactivity) return;
        // on its own socket (the phone was not there when it connected) or down: onto the phone's
        waitingForPhone = false;
        clearTimeout(waitSafety);
        // the modem tray shows it, not the connection dialog (a phone coming back is not a fault)
        if (typeof c._beginTrayOnlyReconnect === 'function') c._beginTrayOnlyReconnect('continuity');
        if (typeof c.manualReconnect === 'function') c.manualReconnect();
    }
    api.on('phone-ready', (m) => {
        const was = phoneReadyNow;
        phoneReadyNow = !!m.ready;
        if (phoneReadyNow && pocketPc) pocketPcBack();
        if (phoneReadyNow && (!was || waitingForPhone)) followPhone();
    });

    // ---- updates that only one window needs (#798)
    //
    // The phone installs every update. A phone restart leaves the DeX window running unless it installs
    // files both windows use (restartScope; only Melaton Mobile's wm* scripts and styles and its art
    // packages are the phone's alone). The DeX window then it drops to its logon screen, "Restarting your Pocket PC..." with Cancel
    // (closes the DeX window), then "Please wait..." while it reconnects and pulls its data again, the way
    // the desktop comes back from a server restart (wsClient._suspendSession). Anything else: both restart.
    const PHONE_ONLY = /^\/(?:scripts\/comp\/wm[A-Z0-9][^/]*\.js|css\/wm[0-9-][^/]*\.css|static_images\/(?:wm61|wm65|wmc|wm-android)\/)/;
    /** 'mobile' when every file is one only Melaton Mobile uses, else 'both'. */
    api.updateScope = (urls) => {
        const list = (Array.isArray(urls) ? urls : []).map((u) => { try { return new URL(u, root.location.origin).pathname; } catch (_) { return String(u); } });
        if (!list.length) return 'both';
        const P = root.melatonPackages;
        const phoneOnly = (p) => PHONE_ONLY.test(p) || !!(P && typeof P.packageOf === 'function' && P.packageOf(p) && P.packageOf(p) !== 'source');
        return list.every(phoneOnly) ? 'mobile' : 'both';
    };
    // a phone restart (Settings > Power > Restart, an update only it needs) leaves the DeX window up;
    // only installing files both windows use restarts it too
    let keepDexOnRestart = true;

    // ---- a question to the other window and its answer: ask(type, payload, ms) -> answer or null
    let askSeq = 0;
    const asking = new Map();
    api.ask = (type, payload, ms = 1500) => new Promise((resolve) => {
        const rid = `${Date.now().toString(36)}-${++askSeq}`;
        const timer = setTimeout(() => { asking.delete(rid); resolve(null); }, ms);
        asking.set(rid, (answer) => { clearTimeout(timer); asking.delete(rid); resolve(answer); });
        if (!api.post(Object.assign({}, payload || {}, { type, rid }))) { clearTimeout(timer); asking.delete(rid); resolve(null); }
    });
    api.on('answer', (m) => { const fn = asking.get(m.rid); if (fn) fn(m.answer); });
    const answer = (m, value) => api.post({ type: 'answer', rid: m.rid, answer: value });
    /** The phone window: what its downloaded updates touch ('mobile' | 'both'), 'none' with nothing waiting. */
    function pendingScope() {
        const sw = root.serviceWorkerManager;
        if (!sw || !sw.pendingUpdateFuse) return 'none';
        return api.updateScope(Array.from(sw.pendingUpdateUrls || []));
    }
    api.on('update-scope?', (m) => { if (isPhone()) answer(m, pendingScope()); });

    /**
     * Before a restart for updates (serviceWorkerManager.forceRestart): the warning when it restarts the
     * other window too. The DeX window: the phone always restarts ("Pocket PC"), this window as well when
     * the updates touch both. The phone: only when the updates touch both ("Continuity-enabled PC").
     * Resolves true to go on, false when the person cancelled.
     */
    api.confirmUpdateRestart = async () => {
        const ask = (text) => (typeof root.showConfirmationDialog === 'function'
            ? root.showConfirmationDialog(text, [{ text: 'Restart Now', value: true }, { text: 'Cancel', value: false }], null, { title: 'Melaton Update', icon: 'fas fa-exclamation-triangle', sound: true })
            : Promise.resolve(true));
        if (isDw() && api.peers().includes('phone')) {
            const scope = await api.ask('update-scope?');
            return !!(await ask(scope === 'both'
                ? 'Melaton will restart your Pocket PC and this Continuity-enabled PC to install updates.<br><br>Programs that are open on either one will close. Save your work before you continue.'
                : 'Melaton will restart your Pocket PC to install updates.<br><br>Programs that are open on your Pocket PC will close. This computer stays on and reconnects when your Pocket PC is ready.'));
        }
        if (isPhone() && api.peers().includes('desktop') && pendingScope() === 'both') {
            return !!(await ask('These updates also restart your Continuity-enabled PC.<br><br>Programs that are open on it will close. Save your work there before you continue.'));
        }
        return true;
    };
    /** serviceWorkerManager.forceRestart (phone window): what the coming restart installs. */
    api.restartScope = (scope) => { keepDexOnRestart = scope !== 'both'; };
    /** serviceWorkerManager.applyStaticCacheUpdate (phone window): CSS and safe files applied live go to the DeX window too. */
    api.relayApply = (files) => {
        if (!isPhone() || !api.peers().includes('desktop')) return;
        api.post({ type: 'apply-update', files: files.map((f) => ({ url: f.url, hash: f.hash })) });
    };
    api.on('apply-update', (m) => {
        const sw = root.serviceWorkerManager;
        if (isDw() && sw && Array.isArray(m.files) && typeof sw.applyStaticCacheUpdate === 'function') sw.applyStaticCacheUpdate(m.files, { silent: true, fromPhone: true });
    });

    let pocketPc = false;
    const cancelBtn = () => document.getElementById('desktopPreStartupCancelBtn');
    function pocketPcRestart() {
        const c = root.wsClient;
        if (pocketPc || !c || typeof c._suspendSession !== 'function') { if (!c) coldBootDw(); return; }
        pocketPc = true;
        c.continuityStatusText = 'Restarting your Pocket PC...';
        c._suspendSession('pocketpc-restart');
        if (typeof c._renderPreStartupDialog === 'function') c._renderPreStartupDialog();
        const b = cancelBtn();
        const B = bridge();
        if (b && B && typeof B.closeWindow === 'function') {
            b.onclick = () => { try { B.closeWindow(); } catch (_) { /* the app closes it */ } };
            b.classList.remove('hidden');
        }
        // back on the desktop (desktopBoot resume after the reconnect's refresh): the mode ends
        document.addEventListener('desktopSessionResumed', () => { pocketPc = false; }, { once: true });
    }
    /** The phone is ready again: "Please wait..." while this window reconnects and pulls its data. */
    function pocketPcBack() {
        const c = root.wsClient;
        const b = cancelBtn();
        if (b) b.classList.add('hidden');
        if (!c) return;
        c.continuityStatusText = '';
        if (typeof c._renderPreStartupDialog === 'function') c._renderPreStartupDialog();
    }
    api.pocketPcRestarting = () => pocketPc;
    api.on('ws-closed', (m) => { if (typeof m.phoneReady === 'boolean') phoneReadyNow = m.phoneReady; });
    /**
     * websocket.js (DeX window): its bus socket closed. True when the phone is not ready to carry a new one:
     * websocket.js then neither reconnects nor shows the loss; the phone's next "ready" reconnects it
     * (a minute's safety retry in case that message never comes).
     */
    api.waitForPhone = () => {
        // over the Miniport: wait for the Miniport's link, not the phone window (it reconnects natively)
        if (lastTransport === 'miniport') {
            if (miniport.up) return false;
            waitingForPhone = true;
            miniport.wake();
            return true;
        }
        if (!isDw() || phoneReadyNow) return false;
        waitingForPhone = true;
        clearTimeout(waitSafety);
        waitSafety = setTimeout(() => {
            if (!waitingForPhone) return;
            api.post({ type: 'phone-ready?' });
            waitSafety = setTimeout(() => { if (waitingForPhone) { phoneReadyNow = true; followPhone(); } }, 60000);
        }, 60000);
        return true;
    };
    api.on('peer', (m) => {
        if (m.role === 'phone' && m.state === 'joined' && isDw()) api.post({ type: 'phone-ready?' });
        if (m.role === 'phone' && m.state === 'left') {
            phoneReadyNow = false;
            // past its boot, the DeX window starts again with the phone (Yukimi: restarting the phone restarts DeX),
            // unless the phone said this window can stay (pocketPcRestart)
            if (isDw() && inApp() && !pocketPc && !miniport.available()) coldBootDw();
        }
    });
    api.on('phone-restarting', (m) => {
        phoneReadyNow = false;
        if (!isDw() || !inApp()) return;
        // over the Miniport the phone window going does not touch this window's connection (#815)
        if (miniport.available() && m && m.keepDex) return;
        // an update only Melaton Mobile uses: this window stays up and waits for its Pocket PC
        if (m && m.keepDex && root.wsClient && root.wsClient.initializationCompleted) pocketPcRestart();
        else coldBootDw();
    });
    let rebooting = false;
    function coldBootDw() {
        if (rebooting) return;
        rebooting = true;
        const D = root.AndroidDisplay;
        try { if (D && typeof D.coldBoot === 'function') { D.coldBoot(); return; } } catch (_) { /* fall back */ }
        location.replace('/launch');
    }
    /** The DeX window: true once the phone said it is ready (the BIOS waits on this). */
    let lastAsk = 0;
    api.phoneReady = () => {
        // with the Miniport the DeX window needs its link, not the phone window (#815)
        if (miniport.available()) { miniport.wake(); return miniport.up; }
        // the BIOS asks every 150 ms; the phone page is asked at most every 2 s (it answers on changes anyway)
        if (!phoneReadyNow && isDw() && Date.now() - lastAsk > 2000) { lastAsk = Date.now(); api.post({ type: 'phone-ready?' }); }
        return phoneReadyNow;
    };

    // ================================================================ Melaton Miniport (#815)
    //
    // DSApp's MelatonMiniport is the app's own server connection, kept by the process: both windows'
    // pages use it (phone = sub "phone", DeX = sub "desktop"), so a page restart or a killed WebView does
    // not drop the link. window.AndroidMiniport (a WebMessageListener): {op} JSON to it; "\u0001<packet>"
    // or {op:"state"|"opened"|"closed"} back. App builds without it keep the bus / own socket above.
    let lastTransport = 'own';
    let miniportSocket = null;
    const miniport = {
        up: false,
        available: () => !!(root.AndroidMiniport && typeof root.AndroidMiniport.postMessage === 'function'),
        post: (msg) => { try { root.AndroidMiniport.postMessage(JSON.stringify(msg)); return true; } catch (_) { return false; } },
        lastWake: 0,
        // the BIOS asks every 80 ms: the app hears it at most every 2 s
        wake: () => { if (Date.now() - miniport.lastWake < 2000) return; miniport.lastWake = Date.now(); miniport.post({ op: 'wake' }); }
    };
    function fromMiniport(text) {
        if (typeof text !== 'string' || !text) return;
        if (text.charCodeAt(0) === 1) { if (miniportSocket) miniportSocket._down(text.slice(1)); return; }
        let m = null;
        try { m = JSON.parse(text); } catch (_) { return; }
        if (!m) return;
        if (m.op === 'state') {
            const was = miniport.up;
            miniport.up = !!m.connected;
            emit('miniport', { connected: miniport.up }, 'app');
            if (miniport.up && !was) followMiniport();
        } else if (m.op === 'opened') {
            if (miniportSocket) miniportSocket._opened();
        } else if (m.op === 'closed') {
            if (miniportSocket) miniportSocket._closed(m.code || 1006, m.reason || 'closed');
        } else if (m.op === 'restart') {
            // the Miniport notification's Restart Devices: every window of the app cold boots
            restartForMiniport();
        }
    }
    /** The link is (back) up: a page that lost its connection reconnects at once. */
    function followMiniport() {
        const c = root.wsClient;
        if (!c || !inApp() || lastTransport !== 'miniport') return;
        if ((c.isConnected() && c.ws && c.ws.miniport) || c.isConnecting || c.connectionLock || c.disconnectedDueToInactivity) return;
        waitingForPhone = false;
        if (typeof c._beginTrayOnlyReconnect === 'function') c._beginTrayOnlyReconnect('miniport');
        if (typeof c.manualReconnect === 'function') c.manualReconnect();
    }
    function restartForMiniport() {
        try { if (typeof root.suppressWebSocketReconnectForReload === 'function') root.suppressWebSocketReconnectForReload(); } catch (_) { /* restart anyway */ }
        root.bypassConfirmation = true;
        root.melatonRestarting = true;
        if (isDw()) { coldBootDw(); return; }
        const D = root.AndroidDisplay;
        try { if (D && typeof D.coldBoot === 'function') { D.coldBoot(); return; } } catch (_) { /* fall back */ }
        root.location.replace('/launch');
    }
    /** Cold boot / Restart from the phone: the Miniport ("the driver") clears and starts fresh too. */
    api.resetMiniport = () => { if (isPhone() && miniport.available()) miniport.post({ op: 'reset' }); };
    api.miniport = () => ({ available: miniport.available(), up: miniport.up, transport: lastTransport });

    /** A WebSocket stand-in over the Miniport: what websocket.js uses instead of new WebSocket(). */
    class MiniportSocket {
        constructor() {
            this.miniport = true;
            this.continuity = true;
            this.readyState = 0;
            this.binaryType = 'blob';
            this.bufferedAmount = 0;
            this.onopen = null;
            this.onmessage = null;
            this.onclose = null;
            this.onerror = null;
            if (miniportSocket && miniportSocket !== this) miniportSocket._closed(1000, 'replaced');
            miniportSocket = this;
            setTimeout(() => { if (!miniport.post({ op: 'open' })) this._closed(1006, 'No Miniport'); }, 0);
        }
        _opened() { if (this.readyState !== 0) return; this.readyState = 1; if (this.onopen) this.onopen({ type: 'open' }); }
        _down(data) { if (this.readyState === 1 && this.onmessage) this.onmessage({ type: 'message', data }); }
        send(data) {
            if (this.readyState !== 1) throw new Error('The Miniport connection is not open');
            if (!miniport.post({ op: 'send', data: String(data) })) this._closed(1006, 'The Miniport is gone');
        }
        close(code = 1000, reason = '') {
            if (this.readyState >= 2) return;
            miniport.post({ op: 'close' });
            this._closed(code, reason);
        }
        _closed(code, reason) {
            if (this.readyState === 3) return;
            this.readyState = 3;
            if (miniportSocket === this) miniportSocket = null;
            if (this.onclose) this.onclose({ type: 'close', code, reason, wasClean: code === 1000 });
        }
    }

    /** A WebSocket stand-in over the bus (DeX window): what websocket.js uses instead of new WebSocket(). */
    class BusSocket {
        constructor() {
            this.continuity = true;
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
    api.transport = () => {
        // the app's own connection (DSApp MelatonMiniport, #815): every window of the app, phone or DeX
        if (miniport.available()) { lastTransport = 'miniport'; return new MiniportSocket(); }
        lastTransport = isDw() && api.peers().includes('phone') ? 'bus' : 'own';
        return lastTransport === 'bus' ? new BusSocket() : null;
    };
    /** The phone window: true while it carries the DeX window's connection (the title bar's glyph). */
    api.active = () => isPhone() && carryingNow;
    /** The DeX window of a hybrid phone leaves updates to the phone (serviceWorkerManager.js). */
    api.isDexWindow = () => isDw();
    /**
     * The phone window keeps its connection up while the DeX window is there (websocket.js): no idle
     * disconnect (the person is working in DeX, not touching the phone) and no "wait until the screen
     * is on" before a reconnect.
     */
    api.keepPhoneConnected = () => isPhone() && !miniport.available() && api.peers().includes('desktop');
    /** The DeX window, while the phone window is there: its retries never stop at "Use Reconnect". */
    api.keepDexConnected = () => isDw() && api.peers().includes('phone');
    /**
     * The DeX window wants a restart for updates (serviceWorkerManager.forceRestart): the phone does it
     * (it installs, one app and one service worker) and the DeX window follows its restart. False when
     * there is no phone window to ask.
     */
    api.restartViaPhone = (why) => (isDw() && api.peers().includes('phone') ? api.post({ type: 'restart-request', why: String(why || 'updates') }) : false);
    api.on('restart-request', () => {
        if (!isPhone()) return;
        const m = root.serviceWorkerManager;
        // the DeX window already warned (and the person said Restart Now there)
        if (m && typeof m.forceRestart === 'function') m.forceRestart({ confirmed: true });
        else if (typeof root.restartClientNavigate === 'function') root.restartClientNavigate();
    });

    // ---- the phone asleep (#798): nothing may stop the app in the background
    //
    // A home-screen phone (and so a hybrid one) must keep its link while it sleeps: messages arrive, the
    // DeX window's connection rides on it. Android's battery optimisation, the per-app "Restricted"
    // battery use and the restricted standby bucket can each stop it. The app reports them (DSApp
    // AndroidHome.getPowerState, feat/continuity-power); once the phone has booted, and when the DeX
    // window joins, a notification offers the fix (at most once a day).
    const POWER_TOLD = 'melatonPowerToldAt';
    function powerProblems() {
        const H = root.AndroidHome;
        if (!H || typeof H.getPowerState !== 'function') return null;
        let st = null;
        try { st = JSON.parse(H.getPowerState()); } catch (_) { return null; }
        if (!st) return null;
        return {
            optimised: st.ignoringOptimizations === false,
            restricted: st.backgroundRestricted === true || Number(st.standbyBucket) >= 40
        };
    }
    api.powerState = () => { try { return JSON.parse(root.AndroidHome.getPowerState()); } catch (_) { return null; } };
    function checkPower(force) {
        if (!isPhone()) return;
        const H = root.AndroidHome;
        let home = false;
        try { home = !!(H && typeof H.isHome === 'function' && H.isHome()); } catch (_) { home = false; }
        if (!home) return;
        const p = powerProblems();
        if (!p || (!p.optimised && !p.restricted)) return;
        try { if (!force && Date.now() - (Number(localStorage.getItem(POWER_TOLD)) || 0) < 86400000) return; } catch (_) { /* private mode: tell */ }
        const sh = root.wmShell;
        if (!sh || typeof sh.notify !== 'function') return;
        try { localStorage.setItem(POWER_TOLD, String(Date.now())); } catch (_) { /* best effort */ }
        const text = p.restricted
            ? 'Battery use for Dreamscape is restricted. While the phone sleeps, Android stops it: messages can be missed and the desktop on the external display loses its connection.\nIn Settings, set Battery to Unrestricted.'
            : 'Android\'s battery optimisation can stop Dreamscape while the phone sleeps: messages can be missed and the desktop on the external display loses its connection.';
        const buttons = [p.restricted
            ? { text: 'Settings', type: 'primary', closeOnClick: true, onClick: () => { try { H.openAppSettings(); } catch (_) { /* old app */ } } }
            : { text: 'Allow', type: 'primary', closeOnClick: true, onClick: () => { try { H.requestBatteryExemption(); } catch (_) { /* old app */ } } }];
        sh.notify({ title: 'Battery optimisation', text, icon: 'warning', asNote: true, timeout: false, buttons });
    }
    api.checkPower = checkPower;

    // the Miniport's messages, and its state now
    if (miniport.available()) {
        root.AndroidMiniport.onmessage = (e) => fromMiniport(e && e.data);
        miniport.post({ op: 'hello' });
    }

    // the phone window: say when it is ready, and that it is going
    if (api.available) {
        const watch = () => {
            if (!isPhone()) return;
            new MutationObserver(() => {
                announceReady(false);
                if (document.documentElement.dataset.wmBoot === 'done') setTimeout(() => checkPower(false), 5000);
            }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wm-boot'] });
            api.on('peer', (m) => { if (m.role === 'desktop' && m.state === 'joined') setTimeout(() => checkPower(false), 5000); });
            const c = root.wsClient;
            if (c && typeof c.on === 'function') {
                c.on('connected', () => {
                    // a carry left over from the socket before (it went without a 'disconnected'): the
                    // DeX window starts its sub-client again on this one
                    if (carryingNow && c.ws !== carrierWs) dropCarry('The phone reconnected');
                    announceReady(true);
                });
                c.on('disconnected', () => {
                    lastReadySent = false;
                    api.post({ type: 'phone-ready', ready: false });
                    if (carryingNow) dropCarry('The phone lost its connection');
                    else api.post({ type: 'ws-closed', reason: 'The phone lost its connection', phoneReady: false });
                });
            }
            announceReady(true);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(watch, 0)); else setTimeout(watch, 0);
        root.addEventListener('pagehide', () => { if (isPhone()) api.post({ type: 'phone-restarting', keepDex: keepDexOnRestart }); });
        // the DeX window asks once it is up (the answer may already be waiting)
        setTimeout(() => { if (isDw()) api.post({ type: 'phone-ready?' }); }, 0);
    }

    root.melatonContinuity = api;
})(typeof window !== 'undefined' ? window : globalThis);
