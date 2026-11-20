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
 *
 * The page asleep (#890, below): with the phone's screen off the app pauses this page's JavaScript while it
 * runs on the Miniport; the Miniport wakes it for what leads to a notification.
 *   holdAwake(reason, on)  keep the page running while something needs it (counted: one off per on)
 *   wakeOn(type)           a server packet type that wakes the sleeping page (a notification driver)
 *   sleepHolds()           what keeps it awake now, comma-separated ('' = it may sleep); the app asks
 */
(function (root) {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const listeners = new Map();
    const handoffs = new Map();
    const bridge = () => root.AndroidContinuity || null;

    // ---- lag journal (#798): a phone window froze ~3 s as its DeX window came up. Kept on both windows
    // for the Continuity case only: long tasks (name "self" = this page's own work, else another page
    // in the same renderer), Continuity events, and bus handlers over 50 ms. Read with lagReport().
    const lagRows = [];
    function lagNote(kind, text, ms) {
        lagRows.push([new Date().toISOString().slice(11, 23), kind, text, ms == null ? null : Math.round(ms)]);
        if (lagRows.length > 300) lagRows.splice(0, lagRows.length - 300);
    }
    // the observers run only while another window of the app is there (the Continuity case): Chromium works
    // out script attribution for every long frame while one observes, which a lone phone page never reads (#890)
    let lagJournalOn = false;
    function startLagJournal() {
        if (lagJournalOn || !root.AndroidContinuity || typeof root.PerformanceObserver !== 'function') return;
        lagJournalOn = true;
        try {
            new root.PerformanceObserver((list) => {
                list.getEntries().forEach((e) => {
                    const a = e.attribution && e.attribution[0];
                    lagNote('longtask', e.name + (a && a.containerSrc ? ' ' + String(a.containerSrc).slice(-40) : ''), e.duration);
                });
            }).observe({ type: 'longtask', buffered: true });
        } catch (_) { /* no long task timing in this WebView */ }
        // frames over 200 ms with the scripts behind them (long tasks name no code): source file,
        // function, what invoked it, and the forced style/layout inside it
        try {
            new root.PerformanceObserver((list) => {
                list.getEntries().forEach((e) => {
                    if (e.duration < 200) return;
                    const scripts = (e.scripts || []).filter((x) => x.duration > 20).slice(0, 3).map((x) => {
                        const file = String(x.sourceURL || '').split('/').pop().split('?')[0];
                        return `${Math.round(x.duration)}ms ${file}${x.sourceFunctionName ? ':' + x.sourceFunctionName : ''} (${String(x.invoker || x.invokerType || '').slice(0, 50)}${x.forcedStyleAndLayoutDuration > 20 ? ', layout ' + Math.round(x.forcedStyleAndLayoutDuration) + 'ms' : ''})`;
                    });
                    lagNote('frame', scripts.join(' | ') || 'no script (style/layout/paint)', e.duration);
                });
            }).observe({ type: 'long-animation-frame', buffered: true });
        } catch (_) { /* no long animation frame timing in this WebView */ }
    }

    function emit(type, msg, from) {
        const t0 = root.performance ? root.performance.now() : 0;
        (listeners.get(type) || []).slice().forEach((fn) => { try { fn(msg, from); } catch (err) { console.warn('[continuity]', type, err); } });
        if (root.performance && type !== 'packet') {
            const ms = root.performance.now() - t0;
            if (ms > 50 || /^(peer|dex-|restart|miniport)/.test(type)) lagNote('bus', type + (msg && msg.state ? ':' + msg.state : ''), ms);
        }
    }

    let roleCache = null;
    const api = {
        get available() { return !!bridge(); },
        // a page's window stays on its screen (a move between the phone and DeX reloads the page), so the
        // synchronous bridge call is made once, not on every check (#890)
        role() {
            if (roleCache) return roleCache;
            try { roleCache = bridge() ? String(bridge().role()) : null; } catch (_) { roleCache = null; }
            return roleCache;
        },
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
        /** The lag journal: [time, kind, text, ms] rows (long tasks, Continuity events, slow handlers). */
        lagReport() { return lagRows.slice(); },
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

    // the lag journal (above) starts with the Continuity case: another window there now, or joining later
    api.on('peer', (m) => { if (m && m.state === 'joined') startLagJournal(); });
    if (api.available && api.peers().length) startLagJournal();

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
    // the phone restarting both windows for updates (Yukimi, Nov 20 2026): from the moment its install window shows
    // until this page goes, it is not "ready" - the DeX window shut down meanwhile waits at its BIOS and starts only
    // when the phone is back up on the new set (it used to see the old page still up and boot on, then again)
    let restartingForUpdates = false;
    function phoneReadyState() {
        if (restartingForUpdates) return false;
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
        // the bonded desktop's Melaton Update shows the phone's updater (#900)
        if (phoneReadyNow && isDw() && typeof api.syncUpdateState === 'function') void api.syncUpdateState();
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
     * Who must restart for these updates (#900, Yukimi Nov 17: a bonded desktop installs updates too, and
     * the restart is decided for each window): each window judges the files against what it runs itself
     * (serviceWorkerManager.classifyStaticCacheUpdate, #872): 'restart' or 'live' (applied in place, or
     * not used by it).
     */
    function localNeed(urls) {
        const sw = root.serviceWorkerManager;
        if (!sw || typeof sw.classifyStaticCacheUpdate !== 'function') return 'restart';
        const files = (Array.isArray(urls) ? urls : []).map((url) => ({ url: String(url) }));
        if (!files.length) return 'live';
        return sw.classifyStaticCacheUpdate(files) === 'restart' ? 'restart' : 'live';
    }
    // the DeX window's list can be empty (its mirror of the phone's update state missed a push): the phone then judges
    // its own waiting files, so a restart for updates is still planned for both windows (#945)
    api.on('update-needs?', (m) => {
        const sw = root.serviceWorkerManager;
        // its downloaded files and those only counted (a restart installs both)
        const own = sw && typeof sw._restartUpdateUrls === 'function' ? sw._restartUpdateUrls()
            : (sw && sw.pendingUpdateFuse && sw.pendingUpdateUrls ? Array.from(sw.pendingUpdateUrls) : []);
        answer(m, localNeed(Array.isArray(m.urls) && m.urls.length ? m.urls : own));
    });

    // ---- the bonded desktop's Melaton Update is an interface to the phone's updater (#900) ----------
    //
    // The phone (its CaféReady service) checks, downloads and installs; the DeX window shows it. Every
    // change of the phone's update state (progress, updates waiting, their kind) goes to the DeX window
    // as one snapshot (coalesced, no polling); the DeX window's Check for updates asks the phone.
    const UPDATE_FIELDS = ['updateProgress', 'pendingUpdateFuse', 'pendingUpdateKind', 'pendingUpdateFilesTotal'];
    function updateSnapshot() {
        const sw = root.serviceWorkerManager;
        if (!sw) return null;
        const urls = Array.from(sw.pendingUpdateUrls || []);
        return {
            progress: Number(sw.updateProgress) || 0,
            pending: !!sw.pendingUpdateFuse,
            kind: sw.pendingUpdateKind || null,
            files: sw.pendingUpdateFilesTotal || urls.length,
            urls: urls.slice(0, 4000),
            // updates counted, not downloaded (#951): the DeX window shows the same count
            available: typeof sw.availableUpdateCount === 'function' ? sw.availableUpdateCount() : 0
        };
    }
    let updateRelayTimer = null;
    function relayUpdateState() {
        if (updateRelayTimer) return;
        updateRelayTimer = setTimeout(() => {
            updateRelayTimer = null;
            if (!isPhone() || !api.peers().includes('desktop')) return;
            const state = updateSnapshot();
            if (state) api.post({ type: 'update-state', state });
        }, 250);
    }
    function watchUpdateState() {
        const sw = root.serviceWorkerManager;
        if (!sw || sw.__mcUpdateWatch || !isPhone()) return;
        sw.__mcUpdateWatch = true;
        // the count of updates available changes without a watched field (#951)
        document.addEventListener('melaton:updates-available', relayUpdateState, { signal: appScopeSignal });
        UPDATE_FIELDS.forEach((key) => {
            let value = sw[key];
            Object.defineProperty(sw, key, {
                configurable: true,
                enumerable: true,
                get: () => value,
                set: (next) => { if (next !== value) { value = next; relayUpdateState(); } }
            });
        });
    }
    // the DeX window joining, or asking: the state now
    api.on('update-state?', (m) => { if (isPhone()) { watchUpdateState(); answer(m, updateSnapshot()); } });
    api.on('update-check', async (m) => {
        if (!isPhone()) return;
        watchUpdateState();
        const sw = root.serviceWorkerManager;
        try { if (sw && typeof sw.checkStaticFileUpdates === 'function') await sw.checkStaticFileUpdates(!!m.noToast); } catch (_) { /* the state says what happened */ }
        answer(m, updateSnapshot());
    });
    /** The DeX window: the phone's state into this window's update UI (tray icon, update page, Restart Now). */
    function mirrorUpdateState(state) {
        const sw = root.serviceWorkerManager;
        if (!isDw() || !sw || !state) return;
        const wasPending = !!sw.pendingUpdateFuse;
        sw.updateProgress = state.progress || 0;
        // this window's own needs (files the phone applied live that this window runs an older copy of, or a reload
        // kept) stay beside the phone's state instead of being overwritten by it (#951)
        const local = sw._localPending instanceof Set ? sw._localPending : new Set();
        sw.pendingUpdateUrls = new Set((Array.isArray(state.urls) ? state.urls : []).concat(Array.from(local)));
        sw.pendingUpdateFilesTotal = Math.max(state.files || 0, sw.pendingUpdateUrls.size);
        sw.pendingUpdateKind = state.kind || (local.size ? 'restart' : null);
        sw.pendingUpdateFuse = !!state.pending || local.size > 0;
        sw._mirroredAvailable = Number(state.available) || 0;
        if (typeof sw._syncUpdatesWaitingMark === 'function') sw._syncUpdatesWaitingMark();
        if (typeof sw._notifyTrayIconUpdate === 'function') sw._notifyTrayIconUpdate();
        // the update page, if open, shows the phone's progress
        if (typeof sw.foregroundUpdateView === 'function') {
            // the update page's own states (serviceWorkerManager _showServiceWorkerTrayPopup)
            const view = state.pending ? 'complete' : state.progress > 0 && state.progress < 100 ? 'downloading' : null;
            if (view) { try { sw.foregroundUpdateView(view, { progress: state.progress, filesTotal: state.files }); } catch (_) { /* the page redraws itself */ } }
        }
        // updates newly ready: this window's own "restart to finish" notice (Restart Now plans per window)
        if (state.pending && !wasPending && typeof sw._scheduleUpdateCompleteToast === 'function') sw._scheduleUpdateCompleteToast(state.kind === 'restart' ? 'restart' : 'apply');
    }
    api.on('update-state', (m) => mirrorUpdateState(m.state));
    // the DeX window's Install updates (#951): the phone downloads and installs what it counted
    api.phoneInstallUpdates = () => (isDw() && api.peers().includes('phone') ? api.post({ type: 'update-install' }) : false);
    api.on('update-install', () => {
        if (!isPhone()) return;
        watchUpdateState();
        const sw = root.serviceWorkerManager;
        if (sw && typeof sw.installAvailableUpdates === 'function') void sw.installAvailableUpdates();
    });
    /** The DeX window's Check for updates (serviceWorkerManager.checkStaticFileUpdates): the phone checks. */
    api.phoneCheckForUpdates = async (noToast) => {
        if (!isDw() || !api.peers().includes('phone')) return null;
        const state = await api.ask('update-check', { noToast: !!noToast }, 60000);
        mirrorUpdateState(state);
        return state;
    };
    /** The DeX window, once the bond is up: the phone's update state now (then each change follows). */
    api.syncUpdateState = async () => {
        if (!isDw() || !api.peers().includes('phone')) return;
        mirrorUpdateState(await api.ask('update-state?', {}, 3000));
    };
    /**
     * Before a restart for updates in a bonded pair: { self, other } - whether this window and the other
     * one need the restart. other is null when there is no other window or it did not answer; then the
     * file rule (updateScope: Melaton Mobile's own files restart only the phone) decides.
     */
    api.restartPlan = async (urls) => {
        const list = Array.isArray(urls) ? urls : [];
        const self = localNeed(list) === 'restart';
        const peer = isDw() ? 'phone' : 'desktop';
        if (!api.peers().includes(peer)) return { self, other: null };
        const said = await api.ask('update-needs?', { urls: list.slice(0, 4000) }, 2500);
        if (said === 'restart' || said === 'live') return { self, other: said === 'restart' };
        // no answer (an older page): the file rule
        const scope = api.updateScope(list);
        return { self, other: isDw() ? true : scope === 'both' };
    };

    /**
     * Before a restart for updates (serviceWorkerManager.forceRestart): the warning when it restarts the
     * other window too. The DeX window: the phone always restarts ("Pocket PC"), this window as well when
     * the updates touch both. The phone: only when the updates touch both ("Continuity-enabled PC").
     * Resolves true to go on, false when the person cancelled.
     */
    api.confirmUpdateRestart = async (plan) => {
        // the computers this restart takes down, as the Network and Server Center draws them (#951): the Pocket PC
        // (imageres.dll 87) and this desktop by its kind (a docked display: Tablet PC with a touchscreen, laptop with
        // a touchpad or a dock battery, else desktop)
        const NET = '/static_images/vista-net';
        const hw = (() => { try { const id = root.melatonDeviceIdentity; return id && typeof id.hardware === 'function' ? id.hardware() : null; } catch (_) { return null; } })();
        const inputs = hw && Array.isArray(hw.input) ? hw.input : [];
        const ext = (src) => inputs.some((d) => d && d.external && Array.isArray(d.sources) && d.sources.includes(src));
        const pcArt = ext('touchscreen') ? `${NET}/tabletpc-0-48.png` : (ext('touchpad') || (api.continuityPc() && api.continuityPc().dockBattery)) ? `${NET}/imageres-112-48.png` : `${NET}/netcenter-1-48.png`;
        const phoneName = (() => {
            try {
                const H = root.AndroidHome;
                const c = H && typeof H.getContinuity === 'function' ? JSON.parse(H.getContinuity()) : null;
                const as = root.activeSync && typeof root.activeSync.state === 'function' ? root.activeSync.state() : null;
                const dev = c && c.deviceId && as ? (as.devices || []).find((d) => String(d.deviceId).toLowerCase() === String(c.deviceId).toLowerCase()) : null;
                if (dev && dev.name) return String(dev.name);
            } catch (_) { /* below */ }
            return (hw && hw.device && (hw.device.marketName || hw.device.model)) || 'Pocket PC';
        })();
        const pcName = (() => {
            try {
                const me = root.melatonDeviceIdentity && root.melatonDeviceIdentity.get();
                if (me && me.name) return typeof root.melatonHostName === 'function' ? root.melatonHostName(me.name) : me.name;
            } catch (_) { /* below */ }
            return 'This computer';
        })();
        const pocket = (note) => ({ icon: `${NET}/imageres-87-48.png`, name: `${phoneName} (Pocket PC)`, note });
        const desktop = (note) => ({ icon: pcArt, name: `${pcName} (Continuity-enabled PC)`, note });
        const ask = (o) => {
            const p = root.melatonRestartPrompt;
            // the desktop's task dialog; Melaton Mobile asks in its own message box
            if (root.uiShell !== 'mobile' && p && typeof p.confirmRestart === 'function') return p.confirmRestart(o);
            // without the prompt's module: the plain question, as before
            return typeof root.showConfirmationDialog === 'function'
                ? root.showConfirmationDialog(`${o.instruction}<br><br>${o.reason}`, [{ text: 'Restart Now', value: true }, { text: 'Cancel', value: false }], null, { title: 'Melaton Update', icon: 'fas fa-exclamation-triangle', sound: true })
                : Promise.resolve(true);
        };
        const SAVE = 'Programs that are open on a computer that restarts will close. Save your work before you continue.';
        const both = () => ask({
            instruction: 'Restart your Pocket PC and this Continuity-enabled PC to finish installing updates',
            reason: SAVE,
            devices: [pocket('Installs the updates and restarts.'), desktop('Shuts down first, then starts again with your Pocket PC.')]
        });
        const phoneOnly = () => ask({
            instruction: 'Restart your Pocket PC to finish installing updates',
            reason: 'Programs that are open on your Pocket PC will close. Save your work there before you continue.',
            devices: [pocket('Installs the updates and restarts.'), desktop('Stays on and reconnects when your Pocket PC is ready.')]
        });
        const fromPhone = () => ask({
            instruction: 'These updates also restart your Continuity-enabled PC',
            reason: SAVE,
            devices: [desktop('Shuts down first, then starts again with this phone.'), pocket('Installs the updates and restarts.')]
        });
        // a plan (restartPlan, #900): the question names exactly the computers that restart
        if (plan && typeof plan === 'object') {
            if (isDw()) {
                if (plan.other && plan.self) return !!(await both());
                if (plan.other) return !!(await phoneOnly());
                return true; // only this computer restarts: the usual Restart Now
            }
            if (plan.other) return !!(await fromPhone());
            return true;
        }
        if (isDw() && api.peers().includes('phone')) {
            const scope = await api.ask('update-scope?');
            return !!(await (scope === 'both' ? both() : phoneOnly()));
        }
        if (isPhone() && api.peers().includes('desktop') && pendingScope() === 'both') {
            return !!(await fromPhone());
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
        if (!isDw() || !sw || !Array.isArray(m.files) || typeof sw.applyStaticCacheUpdate !== 'function') return;
        // this window may run files the phone's page does not (#872): it decides for itself
        const kind = typeof sw.classifyStaticCacheUpdate === 'function' ? sw.classifyStaticCacheUpdate(m.files) : 'apply-safe';
        if (kind === 'restart') {
            sw.pendingUpdateKind = 'restart';
            // this window's own (#951): the phone's next state push must not clear it
            if (!(sw._localPending instanceof Set)) sw._localPending = new Set();
            if (!sw.pendingUpdateUrls) sw.pendingUpdateUrls = new Set();
            m.files.forEach((f) => { if (f && f.url) { sw._localPending.add(f.url); sw.pendingUpdateUrls.add(f.url); } });
            if (typeof sw._pendingMerge === 'function') sw._pendingMerge(m.files);
            sw.tripPendingUpdateFuse(m.files.length);
            if (typeof sw._scheduleUpdateCompleteToast === 'function') sw._scheduleUpdateCompleteToast('restart');
            return;
        }
        if (kind === 'segments' && typeof sw.applySegmentUpdate === 'function') { void sw.applySegmentUpdate(m.files, { fromPhone: true }); return; }
        sw.applyStaticCacheUpdate(m.files, { silent: true, fromPhone: true });
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
            if (isDw() && inApp() && !pocketPc && !ownRestart && !miniport.available()) coldBootDw();
        }
    });
    // the DeX window runs its own shutdown sequence for a restart of both (syncedRestart): the phone going away then
    // must not cut it short; its /launch waits at the BIOS for the phone
    let ownRestart = false;
    /**
     * A restart of both windows for updates, in order (Yukimi, Nov 18 2026): this computer's shutdown sequence first
     * (Welcome, "Shutting down..."), then the phone is told to restart, then this window starts again and waits at its
     * BIOS for the phone ("Waiting for I/O message..."), so both come up together. The DeX window only.
     */
    api.syncedRestart = () => {
        if (!isDw() || !api.peers().includes('phone') || typeof root.runWinlogonPower !== 'function') return false;
        ownRestart = true;
        // the phone shows "Shutting down..." while this computer shuts down (#945)
        api.post({ type: 'dex-shutting-down', kind: 'restart' });
        root.runWinlogonPower('restart', { beforeNavigate: () => api.post({ type: 'restart-request', why: 'updates', restartDex: true, dexDone: true }) })
            .then((ok) => { if (ok === false) { ownRestart = false; api.post({ type: 'dex-shutdown-cancelled' }); } })
            .catch(() => { ownRestart = false; coldBootDw(); });
        return true;
    };
    /**
     * The phone asks this window to shut down: first, for a restart of both it started (kind 'restart', the phone
     * restarts once this answers), or on its own from the phone's Continuity bubble (alone: this window only -
     * 'restart' starts it again and its BIOS waits for the phone, 'shutdown' closes it). Answers 'done', or
     * 'cancelled' when the person kept a program open at the "programs still running" screen.
     */
    api.on('dex-shutdown', (m) => {
        if (!isDw() || !inApp() || typeof root.runWinlogonPower !== 'function') { answer(m, 'skipped'); return; }
        const kind = m && m.kind === 'shutdown' ? 'shutdown' : 'restart';
        ownRestart = true;
        if (kind === 'shutdown') dexClosing = true;
        root.runWinlogonPower(kind, { beforeNavigate: () => answer(m, 'done') })
            .then((ok) => { if (ok === false) { ownRestart = false; dexClosing = false; answer(m, 'cancelled'); } })
            .catch(() => { answer(m, 'done'); ownRestart = false; dexClosing = false; coldBootDw(); });
    });
    // a shut down of this DeX window (the phone's Continuity bubble, the Start menu): the window closes once the
    // sequence has gone dark instead of starting again (winlogonPower asks hostShutdown)
    let dexClosing = false;
    api.hostShutdown = () => {
        if (!isDw()) return false;
        const B = bridge();
        if (!B || typeof B.closeWindow !== 'function') return false;
        try { B.closeWindow(); return true; } catch (_) { return false; }
    };

    // ---- the phone: "Shutting down..." while its Continuity desktop shuts down (#945) ----------------------------
    let shutBox = null;
    let shutTimer = 0;
    function showShuttingDown() {
        if (!isPhone()) return;
        clearTimeout(shutTimer);
        // at most the DeX window's longest sequence (its updates install on the way down): then it is gone anyway
        shutTimer = setTimeout(hideShuttingDown, 60000);
        if (shutBox) return;
        const wm = root.wmShell;
        if (wm && typeof wm.progressBox === 'function') shutBox = wm.progressBox({ title: 'Continuity PC', text: 'Shutting down...', pct: null });
    }
    function hideShuttingDown() {
        clearTimeout(shutTimer);
        if (shutBox) { try { shutBox.close(); } catch (_) { /* gone */ } }
        shutBox = null;
    }
    api.on('dex-shutting-down', () => showShuttingDown());
    api.on('dex-shutdown-cancelled', () => hideShuttingDown());
    api.on('peer', (m) => { if (m.role === 'desktop' && m.state === 'joined') hideShuttingDown(); });

    /**
     * The phone: the DeX window's shutdown sequence, with "Shutting down..." on the phone meanwhile. kind 'restart'
     * (default) before the phone's own restart of both; alone: the DeX window only (the Continuity bubble).
     * Resolves 'done' | 'cancelled' | 'skipped' | null (no DeX window, or no answer in time).
     */
    api.dexShutdownFirst = async (kind, opts) => {
        if (!isPhone() || !api.peers().includes('desktop')) return null;
        // quiet: the phone's own install window is on screen already (a restart of both for updates), no second box
        const quiet = !!(opts && opts.quiet);
        if (!quiet) showShuttingDown();
        const ans = await api.ask('dex-shutdown', { kind: kind === 'shutdown' ? 'shutdown' : 'restart', alone: !!(opts && opts.alone) }, 60000);
        // the phone restarting next keeps the box up until its page goes; anything else ends it here
        if (!quiet && (ans !== 'done' || (opts && opts.alone))) hideShuttingDown();
        return ans;
    };
    /**
     * The phone: a restart of both windows for updates has begun (true: its install window is up) or was called off
     * (false: the desktop kept a program open). While on, the DeX window is told the phone is not ready, so its BIOS
     * waits ("Waiting for I/O message...") until this phone has started again.
     */
    api.holdDexForRestart = (on) => {
        if (!isPhone()) return;
        restartingForUpdates = !!on;
        announceReady(true);
    };
    /** The phone's Continuity bubble: shut down or restart the Continuity desktop alone. */
    api.dexPower = (kind) => api.dexShutdownFirst(kind === 'shutdown' ? 'shutdown' : 'restart', { alone: true });
    api.dexClosing = () => dexClosing;
    api.on('phone-restarting', (m) => {
        phoneReadyNow = false;
        if (!isDw() || !inApp() || ownRestart) return;
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
    /** The BIOS line while it waits: the phone window finishing (its updates), or the link itself. */
    api.phoneWaitText = () => (phoneWindowPending() && (!miniport.available() || miniport.up) ? 'Waiting for I/O message...' : null);
    /** The DeX window: true once the phone said it is ready (the BIOS waits on this). */
    let lastAsk = 0;
    // a phone window that is there but not up yet (its BIOS, an update installing, a restart): the DeX
    // window waits for it at its BIOS, Miniport or not. Booting on, it reached the desktop and the
    // phone's update restart then cut it off (Yukimi, Nov 14).
    const phoneWindowPending = () => isDw() && !phoneReadyNow && api.peers().includes('phone');
    const askPhone = () => { if (Date.now() - lastAsk > 2000) { lastAsk = Date.now(); api.post({ type: 'phone-ready?' }); } };
    api.phoneReady = () => {
        // with the Miniport the DeX window needs its link (#815), and the phone window when one is there
        // a refused Miniport goes on to the BIOS's own session check (its disk read error / the PIN)
        if (miniport.available()) {
            if (miniport.authFailed) return true;
            miniport.wake();
            if (!miniport.up) return false;
            if (phoneWindowPending()) { askPhone(); return false; }
            return true;
        }
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
        enabled: true,
        // the app has it (its settings can be read and changed even while it is turned off)
        present: () => !!(root.AndroidMiniport && typeof root.AndroidMiniport.postMessage === 'function'),
        // the app has it and it is turned on (Settings > Network Cards): the pages use it
        available: () => miniport.present() && miniport.enabled !== false,
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
            // the server refused the Miniport (site gate or session): it waits for this app to sign in
            miniport.authFailed = m.auth === 'failed';
            const wasOn = miniport.enabled;
            miniport.enabled = m.enabled !== false;
            // a Miniport that keeps replies only while fresh: the file index too (#815)
            if (!freshSent && Array.isArray(m.caps) && m.caps.includes('fresh')) {
                freshSent = true;
                Object.assign(CACHE_POLICY, FRESH_POLICY);
                miniport.post({ op: 'policy', policy: FRESH_POLICY });
            }
            // turned off or on: this page's connection moves to its own socket / back to the Miniport
            if (wasOn !== miniport.enabled) setTimeout(() => { const c = root.wsClient; if (c && inApp() && typeof c.manualReconnect === 'function') c.manualReconnect(); }, 0);
            emit('miniport', { connected: miniport.up }, 'app');
            if (miniport.up && !was) followMiniport();
        } else if (m.op === 'opened') {
            if (miniportSocket) miniportSocket._opened();
        } else if (m.op === 'closed') {
            if (miniportSocket) miniportSocket._closed(m.code || 1006, m.reason || 'closed');
        } else if (m.op === 'data') {
            dataChanged(m);
        } else if (m.op === 'config') {
            miniportConfig = { config: m.config || {}, stats: m.stats || {} };
            emit('miniport-config', miniportConfig, 'app');
        } else if (m.op === 'restart') {
            // the Miniport notification's Restart Devices: every window of the app cold boots
            restartForMiniport();
        } else if (m.op === 'resync') {
            // asleep, more came for this page than the Miniport keeps (#890): what it shows is stale. It
            // connects again and reads everything, as after a lost connection, quietly (the modem tray)
            const c = root.wsClient;
            if (c && inApp() && lastTransport === 'miniport') {
                if (typeof c._beginTrayOnlyReconnect === 'function') c._beginTrayOnlyReconnect('miniport');
                if (typeof c.manualReconnect === 'function') c.manualReconnect();
            }
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
    // ---- Café cache (#815 M2a): what the Miniport keeps and keeps current for every page
    //
    // ttl: seconds a kept reply is answered without asking the server again; refresh: seconds between
    // the Miniport's own fetches while a page uses it (0 = only when a page asks); scope: 'workspace'
    // for replies that depend on the active workspace. Only read-only requests. A page's requests are
    // flagged for the cache during its boot, and always for types the Miniport refreshes itself (their
    // pollers then cost no server request); later requests go to the server and refresh the cache.
    // dataset: the group ActiveSync > Café Cache turns on and off (cache / keep updated)
    const CACHE_POLICY = {
        get_user_global_settings: { ttl: 30, dataset: 'settings' },
        desktop_get_settings: { ttl: 30, dataset: 'settings' },
        start_menu_get_layout: { ttl: 60, dataset: 'settings' },
        get_app_options: { ttl: 60, scope: 'workspace', dataset: 'options' },
        get_app_options_chunk: { ttl: 60, scope: 'workspace', dataset: 'options' },
        desktop_get_shortcuts: { ttl: 30, scope: 'workspace', dataset: 'desktop' },
        workspace_list: { ttl: 30, dataset: 'desktop' },
        tm_accounts: { ttl: 30, dataset: 'messaging' },
        tm_summary: { ttl: 30, dataset: 'messaging' },
        ma_accounts: { ttl: 30, dataset: 'messaging' },
        dovecote_list_mailboxes: { ttl: 60, dataset: 'messaging' },
        director_settings_get: { ttl: 60, dataset: 'director' },
        get_autofill_ranking: { ttl: 300, dataset: 'smarttext' },
        // the gallery's blocks (#815 M2b): only block fetches that carry the gallery's version
        // (_mpVersion, galleryImagesLoad.js) are kept, so a kept block is the current one by its key;
        // probes and other gallery reads are never flagged (noFlag)
        request_gallery: { ttl: 7 * 86400, dataset: 'gallery', noFlag: true },
        // fetched by the Miniport once for every page, instead of each page polling; only while a page is on
        // screen (with the phone asleep it stops, and catches up within seconds of the screen coming on, #890)
        wallet_status: { ttl: 60, refresh: 300, dataset: 'status' },
        server_status: { ttl: 30, refresh: 60, dataset: 'status' },
        sidebar_host_metrics: { ttl: 20, refresh: 60, dataset: 'status' }
    };
    // the file index (Explorer's folders): kept while fresh only (a change missed while the link was idle
    // must not show), dropped by the Miniport on vfs_updated and on any file change a page sends. Sent
    // only to a Miniport that understands "fresh" (caps), else an older one would show stale folders.
    const FRESH_POLICY = {
        vfs_list_directory: { ttl: 300, scope: 'workspace', dataset: 'vfs', fresh: true },
        vfs_get_path_stats: { ttl: 300, scope: 'workspace', dataset: 'vfs', fresh: true },
        vfs_resolve_path: { ttl: 300, scope: 'workspace', dataset: 'vfs', fresh: true }
    };
    let freshSent = false;
    /** ActiveSync > Café Cache's list, in its order. */
    const CACHE_DATASETS = [
        { id: 'settings', label: 'Settings' },
        { id: 'options', label: 'Options data' },
        { id: 'desktop', label: 'Desktop items' },
        { id: 'messaging', label: 'Messaging and accounts' },
        { id: 'director', label: 'Director' },
        { id: 'smarttext', label: 'SmartText' },
        { id: 'gallery', label: 'Gallery lists' },
        { id: 'vfs', label: 'File index' },
        { id: 'status', label: 'Wallet and server status' }
    ];
    api.cacheDatasets = () => CACHE_DATASETS.map((d) => Object.assign({ refreshes: Object.values(CACHE_POLICY).some((p) => p.dataset === d.id && (p.refresh || 0) > 0) }, d));
    // the Miniport's settings and figures, as it last said them ({op:"config"})
    let miniportConfig = null;
    const datasetOn = (type, flag) => {
        const p = CACHE_POLICY[type];
        const ds = p && miniportConfig && miniportConfig.config && miniportConfig.config.datasets ? miniportConfig.config.datasets[p.dataset] : null;
        if (!ds) return true;
        return flag === 'update' ? ds.cache !== false && ds.update !== false : ds.cache !== false;
    };
    /** The Miniport's settings: { config: {idleMinutes, scope, datasets}, stats } (null before it said). */
    api.miniportConfig = () => miniportConfig;
    /** Ask the Miniport for its settings again (the answer comes as the 'miniport-config' event). */
    api.requestMiniportConfig = () => miniport.present() && miniport.post({ op: 'config?' });
    /** Change the Miniport's settings: { idleMinutes, scope: 'current'|'all', datasets: { id: { cache, update } } }. */
    api.setMiniportConfig = (set) => miniport.present() && miniport.post({ op: 'config', set });
    /** websocket.js: flag this request for the Miniport's cache. */
    /** galleryImagesLoad.js: the gallery version to put on block fetches (null: not over the Miniport). */
    api.galleryCacheVersion = (version) => (version && lastTransport === 'miniport' && miniport.up && datasetOn('request_gallery', 'cache') ? String(version) : null);
    api.cacheFlag = (type) => {
        const p = CACHE_POLICY[type];
        if (!p || p.noFlag || lastTransport !== 'miniport' || !miniport.up || !datasetOn(type, 'cache')) return false;
        const c = root.wsClient;
        // a "fresh" type (the file index) is answered from the Miniport's copy whenever it is fresh
        return !(c && c.initializationCompleted) || (p.refresh || 0) > 0 || p.fresh === true;
    };
    /** True when the Miniport keeps this type current: the page's own poller for it stands down. */
    api.miniportOwns = (type) => !!(CACHE_POLICY[type] && (CACHE_POLICY[type].refresh || 0) > 0 && lastTransport === 'miniport' && miniport.up && datasetOn(type, 'update'));
    /**
     * The data updater: the Miniport pushes a kept reply that changed ({op:"data"}); modules listen for
     * their type (miniportData.on) or for the window event 'miniportdata', and read again (answered at
     * once from the Miniport's copy). Settings apply directly.
     */
    const dataListeners = new Map();
    const miniportData = {
        on(type, fn) {
            if (!dataListeners.has(type)) dataListeners.set(type, []);
            dataListeners.get(type).push(fn);
            return () => { const l = dataListeners.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
        }
    };
    api.miniportData = miniportData;
    function dataChanged(m) {
        (dataListeners.get(m.type) || []).slice().forEach((fn) => { try { fn(m.data, m.payload); } catch (err) { console.warn('[miniport data]', m.type, err); } });
        try {
            if (m.type === 'get_user_global_settings' && typeof root.applyUserGlobalSettingsToClient === 'function') root.applyUserGlobalSettingsToClient(m.data && (m.data.settings || m.data));
        } catch (_) { /* the listeners have it */ }
        try { root.dispatchEvent(new CustomEvent('miniportdata', { detail: { type: m.type, payload: m.payload, data: m.data } })); } catch (_) { /* no events */ }
    }

    /** Cold boot / Restart from the phone: the Miniport ("the driver") clears and starts fresh too. */
    api.resetMiniport = () => { if (isPhone() && miniport.available()) miniport.post({ op: 'reset' }); };
    /**
     * The server accepted a sign-in but this page's port came back unauthenticated: the server signs a port in as
     * the Miniport's link, which still held the session the sign-in replaced (a CaféReady from before the Nov 19 fix
     * kept its link on the old session). The link starts again on the browser's new one. True when asked.
     */
    api.relinkMiniport = () => miniport.available() && miniport.post({ op: 'reset' });
    api.miniport = () => ({ present: miniport.present(), available: miniport.available(), enabled: miniport.enabled !== false, up: miniport.up, authFailed: !!miniport.authFailed, transport: lastTransport });

    // ================================================================ the page asleep (#890)
    //
    // With the phone's screen off, or the phone window out of sight behind another program, DSApp pauses this
    // page's JavaScript (WebView.pauseTimers, MainActivity applyTimers) when the page runs on the Miniport and
    // nothing holds it awake. The Miniport keeps what the server sends meanwhile. A packet that leads to a
    // notification, a sound or an alert (SLEEP_WAKE, SLEEP_CHANGE, wakeOn) wakes the page at once, and
    // everything held reaches it first, in order; a reply to one of its own requests wakes it too. A
    // whole-state status push (SLEEP_LAST) is kept newest-only and goes with the next wake; the rest waits in
    // order (past the Miniport's cap only what wakes is kept, then 'resync'). Once a minute (the phone's own
    // clock tick, never a wake-up of its own) the page runs for a moment, so its clock, reminders and alarms
    // fire at most a minute late. Before each pause the app asks sleepHolds(): a request in flight, its boot,
    // media playing, a drive home, a notification still repeating its sound or buzz, or a holdAwake() keep it
    // running (a lock or DPI gate pauses it all the same, as before).
    //
    // The packet types that lead to a notification, a sound, an alert or a waiting answer on this page
    // (found by the handlers that call wmShell.notify / appNote / playSystemSound, showGlassToast, the
    // request form, the inbox):
    const SLEEP_WAKE = [
        // the notification inbox (wmNotificationInbox.js: reminders shown live, notices missed), toasts and
        // notices (appWebSocketHandlers.js: system_message, notification, agent_notice incl. restart asks, receipts)
        'inbox_updated', 'notification', 'system_message', 'agent_notice', 'receipt', 'receipt_notification',
        // texts (textMessagingClient.js -> wmChat Text Messaging note), mail (mailAccountsClient.js: new mail),
        // Dreamscape Messenger replies (wmChat.js arrived(): chat_streaming_complete / chat_message_response)
        'tm_event', 'ma_event', 'chat_streaming_complete', 'chat_message_response',
        // the Director's questions (requestForm.js)
        'request_form', 'request_form_closed',
        // weather alerts and the rain alarm (weatherAlerts.js), a traffic report / leave-time push
        // (wmTraffic.js), the car's notices (wmLapis.js)
        'weather_alert_issued', 'weather_rain_alarm', 'traffic_report', 'lapis_notice',
        // a computer waiting for this phone's answer (activeSyncAgent.js: as_request)
        'as_request',
        // a key tripwire or a key's health changing (wmAccounts.js refresh -> raise(): its warnings)
        'api_service_lock_changed', 'api_key_status_changed'
    ];
    // a status that wakes the page when this field changes (every copy of it in the packet counts):
    // - the Director's or Yozora's turn ending is "Director: Turn finished" (wmShell directorTurnWatch: running
    //   -> idle plays its sound, sets the title bar glyph and posts the notification; Yozora's turns flip only
    //   data.xi.running, the Director's data.running)
    // - an eMotion animation finishing: "The animation is ready." / "could not be made" (wmEmotion.js finish();
    //   its progress pushes carry status 'running' and do not wake it)
    const SLEEP_CHANGE = { director_computer_status: 'running', emotion_job_update: 'status' };
    // whole-state status pushes: while the page sleeps only the newest is kept (per lastKey's value), and it
    // goes with the next wake. Pushes that carry changes (statusHub feeds such as xlink_status, activity rows
    // such as mcp_activity, traffic_updated per direction) are kept in order instead. A Director turn's
    // streaming update (every row so far, up to ~1 MB, to pages that watch no chat) is kept newest-only per
    // session: a page with row deltas that misses one asks for the whole update (director.js mergeStreamRows).
    const SLEEP_LAST = ['ping', 'as_peers_updated', 'queue_update', 'search_indexing_status', 'print_queue_state',
        'director_computer_status', 'director_streaming_update', 'lapis_updated', 'runpod_pods_status_update',
        'browsing_sessions_changed', 'dovecote_mailbox_updated', 'weather_rain_status', 'devices_updated', 'sidebar_live'];
    const SLEEP_LAST_KEY = { search_indexing_status: 'job', director_streaming_update: 'sessionId' };
    const sleepWake = new Set(SLEEP_WAKE);
    function sleepSpec() {
        return { wake: Array.from(sleepWake), change: SLEEP_CHANGE, last: SLEEP_LAST, lastKey: SLEEP_LAST_KEY };
    }
    /** A server packet type that wakes this page while it sleeps (it leads to a notification, a sound, an alert). */
    api.wakeOn = (type) => {
        const t = String(type || '');
        if (!t || sleepWake.has(t)) return;
        sleepWake.add(t);
        if (miniport.present()) miniport.post(Object.assign({ op: 'sleep' }, sleepSpec()));
    };

    // the page's Miniport port last began to connect or opened (MiniportSocket): its handshake runs first
    let linkChangedAt = 0;
    // holds: holdAwake (counted, from any program) and the page's own state holds (on or off)
    const awakeHolds = new Map();
    const stateHolds = new Set();
    let holdsSent = '';
    function sendHolds() {
        const reasons = Array.from(new Set([...awakeHolds.keys(), ...stateHolds])).sort();
        const key = reasons.join(',');
        if (key === holdsSent) return;
        holdsSent = key;
        if (miniport.present()) miniport.post({ op: 'hold', reasons });
    }
    /** Keep this page running with the screen off while reason lasts (media, a transfer, a drive): one off per on. */
    api.holdAwake = (reason, on) => {
        const r = String(reason || '');
        if (!r) return;
        const n = (awakeHolds.get(r) || 0) + (on ? 1 : -1);
        if (n > 0) awakeHolds.set(r, n); else awakeHolds.delete(r);
        sendHolds();
    };
    // a state hold is looked at again while it is on: its end can come with no event the page hears (a player
    // that goes with its window, a drive whose position went stale or whose window closed), and the app does not
    // ask sleepHolds() while a hold is set. The page runs then anyway (the hold), so the check costs nothing extra
    let stateRecheck = 0;
    function stateHold(reason, on) {
        if (on === stateHolds.has(reason)) return;
        if (on) stateHolds.add(reason); else stateHolds.delete(reason);
        // perf: allow lives only while a state hold (media heard, a drive) keeps the page awake on purpose, and finds that hold's end so the page can sleep again
        if (stateHolds.size && !stateRecheck) stateRecheck = setInterval(recheckStateHolds, 30000);
        else if (!stateHolds.size && stateRecheck) { clearInterval(stateRecheck); stateRecheck = 0; }
        sendHolds();
    }
    function recheckStateHolds() {
        stateHold('media', mediaPlaying());
        stateHold('traffic', drivingUnwatched());
    }

    /** Media in this page that is heard (Melaton Media, a video with its sound): it plays on with the screen off. */
    function mediaPlaying() {
        try {
            const M = root.wmMedia;
            const n = M && typeof M.now === 'function' ? M.now() : null;
            if (n && n.playing) return true;
        } catch (_) { /* no player */ }
        if (!root.document || typeof root.document.querySelectorAll !== 'function') return false;
        const els = root.document.querySelectorAll('audio, video');
        for (let i = 0; i < els.length; i += 1) {
            const el = els[i];
            if (!el.paused && !el.ended && !el.muted && el.volume > 0) return true;
        }
        return false;
    }
    /**
     * A notification whose class repeats (Reminders, a severe weather alert: 4 more, 4 s apart, wmShell
     * soundNewNotes): its sound in the last 18 s, or in vibrate mode its buzz (no sound is logged then; a
     * 'reminder' buzz is Reminders, a 'notification' buzz any other class that repeats).
     */
    function soundRepeating() {
        const sh = root.wmShell;
        const S = sh && sh.sounds;
        if (!S || typeof S.eventPrefs !== 'function') return false;
        const now = Date.now();
        const repeats = (id) => { try { const p = S.eventPrefs(id); return !!(p && p.repeat && p.sound); } catch (_) { return false; } };
        const recent = (log) => {
            const e = Array.isArray(log) ? log[log.length - 1] : null;
            return e && now - Number(e.at || 0) <= 18000 ? e : null;
        };
        const snd = recent(S.log);
        if (snd && repeats(snd.name)) return true;
        const buzz = recent(sh.vibration && sh.vibration.log);
        if (!buzz) return false;
        if (buzz.kind === 'reminder') return repeats('reminder');
        if (buzz.kind !== 'notification' || typeof S.events !== 'function') return false;
        try { return S.events().some((e) => e && e.kind === 'note' && e.id !== 'reminder' && repeats(e.id)); } catch (_) { return false; }
    }
    /** Driving the commute home with no camera watch of the app's own: the page alerts the cameras (wmTraffic.js). */
    function drivingUnwatched() {
        const T = root.wmTraffic;
        let dv = null;
        try { dv = T && typeof T.driving === 'function' ? T.driving() : null; } catch (_) { dv = null; }
        if (!dv || dv.direction !== 'home') return false;
        // the app's CaféReady drive-alerts task warns with the page asleep (#908): nothing to keep the page awake for
        try { if (T && typeof T.appOwnsAlerts === 'function' && T.appOwnsAlerts()) return false; } catch (_) { /* the page alerts */ }
        const W = root.AndroidDriveWatch;
        try {
            const st = W && typeof W.status === 'function' ? JSON.parse(W.status() || 'null') : null;
            if (st && st.active) return false;
        } catch (_) { /* the page alerts */ }
        return true;
    }
    /** What keeps this page awake now (comma-separated; '' = it may sleep): asked by the app before each pause. */
    api.sleepHolds = () => {
        // the state holds as they are now (one may have ended without an event)
        recheckStateHolds();
        const out = new Set([...awakeHolds.keys(), ...stateHolds]);
        const c = root.wsClient;
        // still starting: it boots on (the launch page, a boot or an install in progress)
        if (!c || !inApp() || !c.initializationCompleted) out.add('boot');
        else {
            // connecting or just connected (a resync, the link back): the handshake and the welcome run first,
            // the reads after them hold it as requests
            if (c.isConnecting || c.connectionLock || Date.now() - linkChangedAt < 15000) out.add('connect');
            // a request it waits on (a print, an upload, a read): its answer is handled while it runs
            if (c.pendingRequests instanceof Map) {
                for (const r of c.pendingRequests.values()) { if (r && r.counted !== false && !r.silentTicker) { out.add('request'); break; } }
            }
        }
        if (soundRepeating()) out.add('sound');
        return Array.from(out).join(',');
    };
    // the holds the page can see change: media starting and stopping, a drive on the way home
    if (root.document && typeof root.document.addEventListener === 'function') {
        const mediaCheck = () => stateHold('media', mediaPlaying());
        // wmMediaChange: wmMedia.js (its player may not be in the document); media events do not bubble: captured
        root.document.addEventListener('wmMediaChange', mediaCheck, { signal: appScopeSignal });
        ['playing', 'pause', 'ended', 'emptied', 'volumechange'].forEach((t) => root.document.addEventListener(t, mediaCheck, { capture: true, signal: appScopeSignal }));
        // wmTrafficChange: wmTraffic.js (a position, a report)
        root.document.addEventListener('wmTrafficChange', () => stateHold('traffic', drivingUnwatched()), { signal: appScopeSignal });
    }

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
            linkChangedAt = Date.now();
            // what wakes this page while it sleeps goes with its port (#890)
            setTimeout(() => { if (!miniport.post({ op: 'open', sleep: sleepSpec() })) this._closed(1006, 'No Miniport'); }, 0);
        }
        _opened() { if (this.readyState !== 0) return; this.readyState = 1; linkChangedAt = Date.now(); if (this.onopen) this.onopen({ type: 'open' }); }
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

    // ---- the Continuity PC (the DeX window) as the phone sees it: its title bar glyph and popup
    //
    // The DeX window says how it is doing ({type:"dex-state"}: booting / ready, its display's size and
    // attachment); the app says when its display goes ({type:"dex-display", state:"removed"}). The phone
    // window's glyph: none without a DeX window; half opacity while it boots (presence) and after its
    // display was unplugged while the window still runs; solid once its desktop is up.
    const dex = { present: false, state: null, displayGone: false, attach: null, width: 0, height: 0, usbVersion: null };
    function dexScreen() {
        const D = root.AndroidDisplay;
        try { return D && typeof D.getScreenInfo === 'function' ? JSON.parse(D.getScreenInfo() || 'null') : null; } catch (_) { return null; }
    }
    // what the DeX window last told the phone (#890): every focus and resize of the DeX window re-sent it,
    // each with a synchronous AndroidDisplay.getScreenInfo() call, a bus message and a redraw of the phone's
    // title bar. It goes again only when something in it changed, when the phone asks (dex-state?), or
    // after the phone saw the display go (dex-state-stale: the next show, resize or focus says "ready").
    let dexSentKey = null;
    let dexSentCheap = null;
    let dexStale = false;
    // what the window can tell without asking the app: its desktop up, the screen's size and density
    const dexCheapKey = () => {
        const c = root.wsClient;
        const sc = root.screen || {};
        return [c && c.initializationCompleted ? 1 : 0, sc.width || 0, sc.height || 0, root.devicePixelRatio || 1].join(',');
    };
    function postDexState(force) {
        if (!isDw()) return;
        const c = root.wsClient;
        const cheap = dexCheapKey();
        const info = dexScreen() || {};
        const dpr = root.devicePixelRatio || 1;
        const msg = {
            type: 'dex-state',
            state: c && c.initializationCompleted ? 'ready' : 'booting',
            attach: info.attach || 'usb',
            usbVersion: Number(info.usbVersion) || null,
            width: info.widthPx || Math.round((root.screen && root.screen.width || 0) * dpr),
            height: info.heightPx || Math.round((root.screen && root.screen.height || 0) * dpr)
        };
        const key = [msg.state, msg.attach, msg.usbVersion, msg.width, msg.height].join(',');
        if (!force && !dexStale && key === dexSentKey) { dexSentCheap = cheap; return; }
        // not delivered (no phone window yet): sent again on the next chance
        if (!api.post(msg)) return;
        dexSentKey = key;
        dexSentCheap = cheap;
        dexStale = false;
    }
    api.on('dex-state?', () => postDexState(true));
    let announceDex = null;
    api.on('dex-state-stale', () => {
        if (!isDw()) return;
        dexStale = true;
        // shown already (the display came back before the phone's word arrived): said now, unless the
        // window goes out of sight first (the display just went)
        if (announceDex) announceDex();
    });
    // the display coming back: the app reports only its removal (dex-display), and a DeX window that
    // kept running never sent another "ready", so the phone's glyph stayed dim after a reconnect
    // (Nov 14). The window shows, resizes or takes focus again on the new display: it says so, when
    // the phone saw the display go (dex-state-stale) or something it shows changed.
    if (root.addEventListener && root.document) {
        let again = null;
        const announce = () => {
            if (!isDw() || root.document.visibilityState === 'hidden') return;
            // a focus or a window resize with nothing new: no app call, no message
            if (!dexStale && dexSentKey !== null && dexCheapKey() === dexSentCheap) return;
            clearTimeout(again);
            again = setTimeout(() => { if (root.document.visibilityState !== 'hidden') postDexState(false); }, 400);
        };
        announceDex = announce;
        root.document.addEventListener('visibilitychange', announce, { signal: appScopeSignal });
        root.addEventListener('resize', announce, { signal: appScopeSignal });
        root.addEventListener('focus', announce, { signal: appScopeSignal });
    }
    api.on('dex-state', (m) => {
        if (!isPhone()) return;
        const before = [dex.present, dex.state, dex.attach, dex.usbVersion, dex.width, dex.height, dex.displayGone].join(',');
        dex.present = true;
        dex.state = m.state === 'ready' ? 'ready' : 'booting';
        dex.attach = m.attach || dex.attach;
        dex.usbVersion = Number(m.usbVersion) || dex.usbVersion || null;
        dex.width = Number(m.width) || dex.width;
        dex.height = Number(m.height) || dex.height;
        if (m.state === 'ready') dex.displayGone = false;
        // the title bar is drawn again only for a change it shows (#890)
        if ([dex.present, dex.state, dex.attach, dex.usbVersion, dex.width, dex.height, dex.displayGone].join(',') !== before) statusChanged();
    });
    api.on('dex-display', (m) => {
        if (!isPhone() || m.state !== 'removed') return;
        dex.displayGone = true;
        statusChanged();
        // the DeX window says "ready" again when it next shows on a display (its own state did not change)
        api.post({ type: 'dex-state-stale' });
    });
    // a phone page that starts while the DeX window is already up (a phone restart, an app update) hears
    // no "joined": it looks for it and asks how it is doing
    setTimeout(() => {
        if (!isPhone() || !api.peers().includes('desktop')) return;
        Object.assign(dex, { present: true, state: dex.state || 'booting' });
        api.post({ type: 'dex-state?' });
        statusChanged();
    }, 0);
    api.on('peer', (m) => {
        if (!isPhone() || m.role !== 'desktop') return;
        if (m.state === 'joined') { Object.assign(dex, { present: true, state: 'booting', displayGone: false }); api.post({ type: 'dex-state?' }); }
        else Object.assign(dex, { present: false, state: null, displayGone: false });
        statusChanged();
    });
    /** The phone window's Continuity glyph: null (hidden) | 'dim' (presence, booting, unplugged) | 'solid'. */
    api.continuityIcon = () => {
        if (!isPhone()) return null;
        if (!dex.present && !carryingNow) return null;
        if (dex.present && (dex.state !== 'ready' || dex.displayGone)) return 'dim';
        return 'solid';
    };
    // the dock (myNexDock's DockStatusProvider through the app, DSApp DockStatus.kt): its battery for the popup
    function dockRow() {
        const H = root.AndroidHome;
        try { return H && typeof H.getDockStatus === 'function' ? JSON.parse(H.getDockStatus() || 'null') : null; } catch (_) { return null; }
    }
    if (root.addEventListener) root.addEventListener('androiddock', () => statusChanged());
    /**
     * The Continuity PC for the glyph's popup: { attach: 'usb'|'wireless', width, height, state, displayGone,
     * dockName, dockBattery: { level, charging } } (the dock's, read fresh, while it is connected).
     */
    api.continuityPc = () => {
        if (!dex.present) return null;
        const out = Object.assign({}, dex);
        const row = dockRow();
        if (row && Number(row.connected) === 1 && Number.isFinite(Number(row.battery_percent))) {
            out.dockName = row.name || '';
            out.dockBattery = { level: Number(row.battery_percent), charging: String(row.charge_state || '') === 'charging' };
        }
        return out;
    };
    /** The DeX window of a hybrid phone leaves updates to the phone (serviceWorkerManager.js). */
    api.isDexWindow = () => isDw();
    /**
     * The phone window keeps its connection up while the DeX window is there (websocket.js): no idle
     * disconnect (the person is working in DeX, not touching the phone) and no "wait until the screen
     * is on" before a reconnect.
     */
    api.keepPhoneConnected = () => isPhone() && !miniport.available() && api.peers().includes('desktop');
    /**
     * The phone window with a DeX window up, whatever carries their connections (the shared socket or each its own
     * Miniport link): a restart for updates plans and warns for both (Nov 20: with the Miniport the phone installed
     * and restarted alone - keepPhoneConnected is false then - and the DeX window never restarted or asked).
     */
    api.hasDexPeer = () => isPhone() && api.peers().includes('desktop');
    /** The DeX window, while the phone window is there: its retries never stop at "Use Reconnect". */
    api.keepDexConnected = () => isDw() && api.peers().includes('phone');
    /**
     * The DeX window wants a restart for updates (serviceWorkerManager.forceRestart): the phone does it
     * (it installs, one app and one service worker) and the DeX window follows its restart. False when
     * there is no phone window to ask.
     */
    api.restartViaPhone = (why, opts) => (isDw() && api.peers().includes('phone')
        ? api.post({ type: 'restart-request', why: String(why || 'updates'), ...(opts && typeof opts.restartDex === 'boolean' ? { restartDex: opts.restartDex } : {}) })
        : false);
    api.on('restart-request', (msg) => {
        if (!isPhone()) return;
        const m = root.serviceWorkerManager;
        // the DeX window already warned (and the person said Restart Now there); it says whether it needs
        // the restart itself (#900): if not, it stays up while the phone restarts
        if (msg && typeof msg.restartDex === 'boolean') {
            api.restartScope(msg.restartDex ? 'both' : 'mobile');
            // dexDone: the DeX window has shut down already (syncedRestart): no second shutdown asked of it; it waits
            // at its BIOS until this phone is back (holdDexForRestart), not on the old page still up here
            if (msg.dexDone && msg.restartDex) api.holdDexForRestart(true);
            if (m && typeof m.forceRestart === 'function') { m.forceRestart({ confirmed: true, dexDone: !!msg.dexDone, plan: { self: true, other: msg.restartDex } }); return; }
        }
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
            restricted: st.backgroundRestricted === true || Number(st.standbyBucket) >= 40,
            // DSApp HomeKeeper: without "Display over other apps" (or a shell route) Melaton Mobile
            // cannot come back by itself when an update or a crash closes it; Android then shows the
            // phone's old launcher or the last app (A53, Nov 14 2026). Older builds say nothing.
            noReturn: st.homeReturns === false
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
        if (!p) return;
        // one note at a time, each at most once a day: battery first, else Display over other apps
        let batteryDue = p.optimised || p.restricted;
        try { if (batteryDue && !force && Date.now() - (Number(localStorage.getItem(POWER_TOLD)) || 0) < 86400000) batteryDue = false; } catch (_) { /* private mode: tell */ }
        if (!batteryDue) { if (p.noReturn) askOverlay(H, force); return; }
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
    const OVERLAY_TOLD = 'melatonOverlayToldAt';
    function askOverlay(H, force) {
        try { if (!force && Date.now() - (Number(localStorage.getItem(OVERLAY_TOLD)) || 0) < 86400000) return; } catch (_) { /* private mode: tell */ }
        const sh = root.wmShell;
        if (!sh || typeof sh.notify !== 'function' || typeof H.requestOverlay !== 'function') return;
        try { localStorage.setItem(OVERLAY_TOLD, String(Date.now())); } catch (_) { /* best effort */ }
        sh.notify({
            title: 'Melaton Mobile',
            text: 'When an update closes Melaton Mobile, Android shows the phone\'s old home screen until you open it again.\nAllow Display over other apps so it comes back by itself.',
            icon: 'warning', asNote: true, timeout: false,
            buttons: [{ text: 'Allow', type: 'primary', closeOnClick: true, onClick: () => { try { H.requestOverlay(); } catch (_) { /* old app */ } } }]
        });
    }

    // the DeX window: tell the phone it is here (booting), and again when its desktop is up
    if (api.available) {
        setTimeout(() => postDexState(), 0);
        // desktopBootDone: public/scripts/comp/desktopBoot.js (the Vista boot is over)
        if (!root.isLaunchPage && root.document) root.document.addEventListener('desktopBootDone', () => postDexState());
    }

    // the Miniport's messages, and its state now
    if (miniport.present()) {
        root.AndroidMiniport.onmessage = (e) => fromMiniport(e && e.data);
        miniport.post({ op: 'hello' });
        miniport.post(Object.assign({ op: 'sleep' }, sleepSpec()));
        miniport.post({ op: 'policy', policy: CACHE_POLICY });
        miniport.post({ op: 'config?' });
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
