/**
 * Nightshade Network Client (Yozora #895): the Dreamscape service's own program on the desktop, as a
 * mobile broadband card's connection manager - what the tray icon opens. It is the user's view, not
 * an administrator's: the service's status, connection quality, time connected, CaféReady and the data
 * this session used, with Connect when it is down. Disconnect is in the Connection menu only, behind
 * a warning (Yukimi: not that easy). The server's own detail is in Server Manager > Diagnostics >
 * Nightshade Network (mmcServerManager.js).
 *
 * Loaded with the desktop (app.html), not on demand: it must open while the server is out of reach.
 * State: websocket.js nightshadeState() and its 'nightshade:state' event (no Internet / cannot connect to the server /
 * services not available are told apart there, from real signals); the time connected ticks
 * on a local clock while the window shows (no request).
 *
 *   window.nightshadeClient.open()              the window (one instance)
 *   window.nightshadeClient.attachTrayMenu(el)  the tray icon's right-click menu
 *   window.openNightshadeClient()               Start menu / Run
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const TITLE = 'Nightshade Network Client';
    const VI = '/static_images/vista-icons';
    const ICON16 = `${VI}/nightshade-16.png`;
    const ICON32 = `${VI}/nightshade-32.png`;
    const ICON48 = `${VI}/nightshade-48.png`;
    const CAFE_LOGO = '/static_images/melaton/cafe-ready-dark.png';
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // the window's own status line: the long form of websocket.js NIGHTSHADE_STATUS_TEXT (the tray tooltip's)
    const STATUS = {
        connected: 'Connected',
        connecting: 'Connecting...',
        restarting: 'Nightshade services are not available at this time',
        'signed-out': 'Sign-in required',
        off: 'Disconnected',
        'no-internet': 'No Internet access',
        unavailable: 'Cannot connect to the Nightshade server'
    };
    const NOTE = {
        connecting: 'Connecting to the Nightshade Network. This usually takes a few seconds.',
        restarting: 'The Nightshade server is restarting. Some features and services may not be accessible until it is ready; Nightshade connects again by itself.',
        unavailable: 'The Internet connection is working, but the Nightshade server does not answer. Nightshade will keep trying.',
        'no-internet': 'This computer cannot reach the Internet. Nightshade connects again as soon as the Internet connection is back.',
        'signed-out': 'Sign in to Nightshade Network to get your mail, messages and programs.',
        off: 'You disconnected from the Nightshade Network. Your mail, messages, prints and most programs are not available until you connect again.'
    };

    /**
     * The second line of a failure: what was actually seen (Yukimi, Nov 20 2026: say the real issue). From the state's
     * reach / reachDetail (websocket.js _noteNightshadeReach), the server's own boot stage, the host's network.
     */
    function detail(s) {
        const d = s.reachDetail;
        if (s.service === 'restarting') {
            const st = client() && client().lastServerStartupStatus;
            if (st && st.isReady === false && st.stageMessage) {
                return `Server status: ${String(st.stageMessage).replace(/[.…]+$/, '')}${Number.isFinite(st.progressPercent) ? ` (${Math.round(st.progressPercent)}%)` : ''}.`;
            }
            if (/^5\d\d$/.test(String(d || ''))) return `The server's gateway answered, but Dreamscape is not running behind it (error ${d}).`;
            if (d === '1012' || d === '1001' || d === '1013') return 'The server closed the connection to restart.';
            return '';
        }
        if (s.service === 'unavailable') {
            if (d === 'timeout') return 'The server did not answer in time.';
            if (d === 'network') return 'A connection to the server could not be made.';
            if (/^\d{3}$/.test(String(d || ''))) return `The server refused the connection (error ${d}).`;
            return '';
        }
        if (s.service === 'no-internet') {
            let l = null;
            try { l = root.dreamosNetTray && root.dreamosNetTray.look(); } catch (_) { l = null; }
            if (l && l.kind !== 'none' && l.name) return `${l.name} is connected, but has no Internet access.`;
            if (l && l.kind === 'none') return 'This computer is not connected to a network.';
            return s.internet === 'offline' ? 'This computer is not connected to a network.' : 'The network is connected, but has no Internet access.';
        }
        return '';
    }

    function client() { return root.wsClient || null; }

    function state() {
        const c = client();
        try { if (c && typeof c.nightshadeState === 'function') return c.nightshadeState(); } catch (_) { /* below */ }
        const online = !root.navigator || root.navigator.onLine !== false;
        return { internet: online ? 'online' : 'offline', service: online ? 'unavailable' : 'no-internet', problem: true, cafeReady: false, connectedAt: null, rtt: null };
    }

    /**
     * Connection quality from the round trip to the server (what it really measures): [light, word]. The light
     * (Yukimi, #945): red not connected, yellow connected but slow (300 ms or more) or still connecting, green all good.
     */
    function quality(s) {
        // (Nov 20) restarting is amber, as a VPN client's "reconnecting": the server answers and comes back by itself;
        // no Internet and no server are red, they need something fixed
        if (s.service === 'connecting') return ['yellow', 'Connecting...'];
        if (s.service === 'restarting') return ['yellow', 'Not available (server restarting)'];
        if (s.service !== 'connected') return ['red', 'Not connected'];
        const rtt = s.rtt;
        if (rtt == null) return ['green', 'Good'];
        if (rtt < 80) return ['green', 'Excellent'];
        if (rtt < 160) return ['green', 'Very good'];
        if (rtt < 300) return ['green', 'Good'];
        if (rtt < 600) return ['yellow', 'Fair (high latency)'];
        return ['yellow', 'Poor (high latency)'];
    }

    function clock(ms) {
        const t = Math.max(0, Math.floor(ms / 1000));
        return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    }

    function size(n) {
        const v = Math.max(0, Number(n) || 0);
        if (v < 1024) return `${v} bytes`;
        if (v < 1048576) return `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`;
        if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
        return `${(v / 1073741824).toFixed(2)} GB`;
    }

    function cafeText(s) {
        if (s.cafeReady) return 'Active';
        const mc = root.melatonContinuity;
        let mp = null;
        try { mp = mc && typeof mc.miniport === 'function' ? mc.miniport() : null; } catch (_) { mp = null; }
        if (!mp || !mp.present) return 'Not in use on this computer';
        return mp.enabled === false ? 'Off' : 'Standing by';
    }

    // ---- actions --------------------------------------------------------------------------------

    function connect() {
        const c = client();
        if (!c) return;
        // Sign In (#899): the Connect dialog; accepted, the link reconnects with the new session
        if (c.connectionPhase === 'auth' && root.melatonNetworkDialogs && root.melatonNetworkDialogs.connect) {
            Promise.resolve(root.melatonNetworkDialogs.connect.show()).then(() => { if (typeof c.forceReconnect === 'function') c.forceReconnect(); }).catch(() => {});
            return;
        }
        if (typeof c.manualReconnect === 'function') c.manualReconnect();
    }

    /** Disconnect, only after the warning (Cancel is the default button). */
    async function disconnect() {
        const s = state();
        if (s.service !== 'connected' && s.service !== 'connecting') return;
        const ok = typeof root.showConfirmationDialog === 'function'
            ? await root.showConfirmationDialog(
                'Disconnect from the Nightshade Network?\n\nYour mail, messages, prints and most programs stop working until you connect again. Nightshade will not reconnect by itself.',
                [{ text: 'Disconnect', value: true, className: 'btn-standard' }, { text: 'Cancel', value: false, className: 'btn-standard primary' }],
                null,
                { title: TITLE, icon: 'fas fa-exclamation-triangle', sound: true })
            : false;
        if (ok !== true) return;
        const c = client();
        if (c && typeof c.cancelConnectionFromUser === 'function') c.cancelConnectionFromUser();
    }

    /**
     * Sign Out (Yukimi, Nov 20 2026): the only real sign-out on a certificate client (CaféReady, the Android app) - the
     * desktop's Log off is a lock there. After the warning (Cancel is the default button) it logs off as Log off does
     * (winlogonPower.js: the programs close, "Logging off...", the Welcome screen), and the server retires this
     * computer's certificate and ends the session (web_server.js 'logout', intent nightshade-signout). Needs the server.
     */
    async function signOut() {
        if (state().service !== 'connected') {
            if (typeof root.showConfirmationDialog === 'function') {
                await root.showConfirmationDialog(
                    'You must be connected to the Nightshade Network to sign out.\n\nConnect, and then try again.',
                    [{ text: 'OK', value: true, className: 'btn-standard primary' }],
                    null,
                    { title: TITLE, icon: 'fas fa-info-circle' });
            }
            return;
        }
        const ok = typeof root.showConfirmationDialog === 'function'
            ? await root.showConfirmationDialog(
                'Are you sure you want to sign out of the Nightshade Network?\n\nAll your programs close and this computer forgets your sign-in. To use it again, you must type your password while it is connected to the Nightshade Network.',
                [{ text: 'Sign Out', value: true, className: 'btn-standard' }, { text: 'Cancel', value: false, className: 'btn-standard primary' }],
                null,
                { title: TITLE, icon: 'fas fa-exclamation-triangle', sound: true })
            : false;
        if (ok !== true || typeof root.runWinlogonPower !== 'function') return;
        try {
            await root.runWinlogonPower('logoff', { signOut: true });
        } catch (error) {
            if (typeof root.showConfirmationDialog === 'function') {
                root.showConfirmationDialog(
                    (error && error.message) || 'Could not sign out of the Nightshade Network.',
                    [{ text: 'OK', value: true, className: 'btn-standard primary' }],
                    null,
                    { title: TITLE, icon: 'fas fa-times-circle', sound: true });
            }
        }
    }

    function about() {
        if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: TITLE });
    }

    function help() {
        call('openHelpAndSupport', 'nightshade-network');
    }

    // ---- the window -----------------------------------------------------------------------------

    let win = null;

    function menuItems(menu) {
        const s = state();
        const up = s.service === 'connected' || s.service === 'connecting';
        if (menu === 'connection') {
            return [
                { text: s.service === 'signed-out' ? 'Sign In...' : up ? 'Reconnect' : 'Connect', action: 'connect', disabled: s.service === 'connecting' },
                { text: 'Disconnect...', action: 'disconnect', disabled: !up },
                { separator: true },
                { text: 'Sign Out of Nightshade Network...', action: 'signout', disabled: s.service !== 'connected' },
                { separator: true },
                { text: 'Close', action: 'close' }
            ];
        }
        return [
            { text: 'Nightshade Network Help', subtext: 'F1', action: 'help' },
            { separator: true },
            { text: `About ${TITLE}`, action: 'about' }
        ];
    }

    function onMenu(action) {
        if (action === 'connect') connect();
        else if (action === 'disconnect') void disconnect();
        else if (action === 'signout') void signOut();
        else if (action === 'close') close();
        else if (action === 'help') help();
        else if (action === 'about') about();
        setTimeout(paint, 50);
    }

    function build() {
        // desktopAppCreateWindow: public/scripts/comp/desktop-apps/desktopAppWindow.js (the shared builder)
        const w = root.desktopAppCreateWindow({
            id: 'nightshadeClientModal',
            identifier: 'nightshadeClient',
            title: TITLE,
            icon16: ICON16,
            taskbarIcon: ICON32,
            className: 'nsc-window',
            fixed: true,
            minimize: true
        });
        const m = w.modal;
        w.content.classList.add('nsc-client');
        w.content.innerHTML = `
            <div class="naxt-menubar" role="menubar" data-win32-menus>
                <button type="button" class="naxt-menu-title" role="menuitem" data-nsc-menu="connection">Connection</button>
                <button type="button" class="naxt-menu-title" role="menuitem" data-nsc-menu="help">Help</button>
            </div>
            <div class="nsc-body">
                <div class="nsc-head">
                    <img src="${ICON48}" alt="" draggable="false">
                    <div class="nsc-head-text">
                        <div class="nsc-name">Nightshade Network</div>
                        <div class="nsc-status" data-f="status"></div>
                        <div class="nsc-detail" data-f="detail"></div>
                    </div>
                    <span class="nsc-light" data-f="light" data-lit="red" role="img" aria-label="Connection quality"></span>
                </div>
                <div class="nsc-rows">
                    <span>Connection quality:</span><span data-f="quality"></span>
                    <span>Connected for:</span><span data-f="time"></span>
                    <span>CaféReady:</span><span data-f="cafe"></span>
                    <span>Data used:</span><span data-f="data"></span>
                </div>
                <div class="nsc-note" data-f="note"></div>
                <div class="nsc-cafe" data-f="cafe-logo"><span>Powered by</span><span class="nsc-cafe-badge"><img src="${CAFE_LOGO}" alt="CaféReady" draggable="false"></span></div>
            </div>
            <div class="vista-dialog-footer nsc-footer">
                <button type="button" class="btn-standard" data-act="connect"></button>
                <button type="button" class="btn-standard" data-act="close">Close</button>
            </div>
`;
        w.close.addEventListener('click', close);
        m.querySelector('.nsc-footer').addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-act]');
            if (!b || b.disabled) return;
            if (b.dataset.act === 'connect') connect();
            else if (b.dataset.act === 'close') close();
            setTimeout(paint, 50);
        });
        m.querySelectorAll('.naxt-menu-title').forEach((button) => {
            if (!root.contextMenu || typeof root.contextMenu.attachClickMenuToElement !== 'function') return;
            root.contextMenu.attachClickMenuToElement(button, {
                onAction: onMenu,
                sections: [{ type: 'list', initfn: (section) => { section.items = menuItems(button.dataset.nscMenu); } }]
            });
        });
        m.addEventListener('keydown', (ev) => {
            if (ev.key === 'F1') { ev.preventDefault(); help(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
        });
        return m;
    }

    function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

    function paint() {
        if (!win || !win.isConnected) return;
        const s = state();
        const f = (k) => win.querySelector(`[data-f="${k}"]`);
        const connected = s.service === 'connected';
        setText(f('status'), connected && s.cafeReady ? 'Connected (with CaféReady)' : STATUS[s.service] || STATUS.unavailable);
        const why = detail(s);
        setText(f('detail'), why);
        f('detail').hidden = !why;
        win.dataset.nscState = s.service;
        win.classList.toggle('nsc-problem', !!s.problem);
        const [lit, word] = quality(s);
        // connection quality as a traffic light: one lamp lit
        const light = f('light');
        if (light.dataset.lit !== lit) light.dataset.lit = lit;
        const lightLabel = `Connection quality: ${word}`;
        if (light.getAttribute('aria-label') !== lightLabel) { light.setAttribute('aria-label', lightLabel); light.title = word; }
        setText(f('quality'), word);
        setText(f('time'), connected && s.connectedAt ? clock(Date.now() - s.connectedAt) : '—');
        setText(f('cafe'), cafeText(s));
        const st = (client() && client().connectionStats) || {};
        setText(f('data'), connected ? `${size(st.bytesOut)} sent, ${size(st.bytesIn)} received` : '—');
        const note = s.admin ? 'An administrator disconnected this computer from the Nightshade Network. Connect again when you are ready.' : NOTE[s.service] || '';
        setText(f('note'), note);
        f('note').hidden = !note;
        f('cafe-logo').hidden = !s.cafeReady;
        // the footer's first button: Connect / Sign In while down, none while connected or dialing, nor while the server
        // restarts (it connects again by itself as soon as the server is ready; the phone's bubble offers none either)
        const btn = win.querySelector('.nsc-footer [data-act="connect"]');
        const label = s.service === 'signed-out' ? 'Sign In' : 'Connect';
        setText(btn, label);
        btn.hidden = connected || s.service === 'connecting' || s.service === 'restarting';
        const primary = btn.hidden ? win.querySelector('.nsc-footer [data-act="close"]') : btn;
        win.querySelectorAll('.nsc-footer [data-dialog-primary]').forEach((b) => { if (b !== primary) b.removeAttribute('data-dialog-primary'); });
        primary.setAttribute('data-dialog-primary', '1');
    }

    let tick = null;
    function startClock() {
        if (tick) return;
        tick = setInterval(() => {
            if (!win || !win.isConnected) { clearInterval(tick); tick = null; return; }
            if (doc.hidden || win.classList.contains('hidden')) return;
            paint();
        }, 1000);
    }

    function open() {
        if (win && win.isConnected) {
            call('bringModalToFront', win);
            paint();
            return win;
        }
        win = build();
        paint();
        call('openModal', win);
        win.classList.remove('hidden');
        let placed = false;
        const place = () => {
            if (placed || !win) return;
            placed = true;
            const r = win.getBoundingClientRect();
            call('setModalOffsetsFromViewportTopLeft', win, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 3)));
        };
        requestAnimationFrame(place);
        setTimeout(place, 60);
        startClock();
        if (root.programFaults && root.programFaults.registerProgram) {
            root.programFaults.registerProgram(win.id, { name: TITLE, terminate: close, relaunch: open });
        }
        return win;
    }

    function close() {
        if (!win) return;
        const m = win;
        win = null;
        if (tick) { clearInterval(tick); tick = null; }
        Promise.resolve(call('closeModal', m)).finally(() => setTimeout(() => m.remove(), 300));
    }

    root.addEventListener('nightshade:state', paint, { signal: appScopeSignal });

    // ---- the tray icon's menu ---------------------------------------------------------------------

    /** Right-click on the Nightshade tray icon: open the client, Reconnect, Sign Out (the real sign-out). No Disconnect. */
    function attachTrayMenu(anchor) {
        if (!anchor || anchor.dataset.nightshadeMenu === '1' || !root.contextMenu || typeof root.contextMenu.attachToElement !== 'function') return;
        anchor.dataset.nightshadeMenu = '1';
        root.contextMenu.attachToElement(anchor, {
            sections: [{
                type: 'list',
                items: [
                    { icon: 'fas fa-circle-info', text: `Open ${TITLE}`, action: 'ns-open', bold: true },
                    { icon: 'fas fa-rotate', text: 'Reconnect', action: 'ns-reconnect', disabled: () => state().service === 'connecting' },
                    { separator: true },
                    { icon: 'fas fa-right-from-bracket', text: 'Sign Out of Nightshade Network...', action: 'ns-signout', disabled: () => state().service !== 'connected' }
                ]
            }],
            onAction: (action) => {
                if (action === 'ns-open') open();
                else if (action === 'ns-reconnect') connect();
                else if (action === 'ns-signout') void signOut();
            }
        });
    }

    root.nightshadeClient = { open, close, attachTrayMenu, signOut, _state: state, _quality: quality, _detail: detail };
    root.openNightshadeClient = open;
})(typeof window !== 'undefined' ? window : globalThis);
