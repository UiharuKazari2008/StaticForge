/**
 * Melaton network dialogs (Yozora #427, #429): the client is a domain-joined PC and the server
 * is its domain controller, reached through a Vista VPN connection.
 *
 *   Connecting to <connection>...   #connectionDialModal (app.html), rendered by websocket.js
 *                                   _renderConnectionDial with the text helpers below, on the
 *                                   desktop and at the logon screen: "Connecting to <fqdn> using
 *                                   '<WAN|Ethernet> Miniport (L-PPoP)'..." → "Verifying user name
 *                                   and password..." → "Registering your computer on the
 *                                   network...". A failure turns it into "Error Connecting to
 *                                   domain controller" with a RAS error (800, 629, ...)
 *   Connect <connection>            the login dialog when the session needs a password again
 *                                   after boot (pinModal.js showPinModal routes here on the
 *                                   desktop): banner, User name / Password / Domain, Connect /
 *                                   Cancel / Properties
 *
 * <connection> is the network interface name (desktop.connectionName, default VPN Connection),
 * kept apart from the domain name (desktop.domainName, default DREAMSCAPE), which only appears
 * where Windows shows the domain (the Domain field, DOMAIN\user, the network map). <fqdn> is the
 * host the page talks to (location.hostname); WAN / Ethernet and the device come from the
 * server's public OPTIONS /status (`melaton`, modules/melatonNetwork.js, kept by websocket.js as
 * wsClient.melatonConnection). WAN = the client reached the server over the Internet; Ethernet =
 * from a private address through the local nginx. L-PPoP = LANTIS Public Point of Presence, the
 * LANTIS FireStorm load balancer.
 */
(function (root) {
    'use strict';

    const DEFAULT_DOMAIN = 'DREAMSCAPE';
    const DEFAULT_CONNECTION_NAME = 'VPN Connection';
    const DEFAULT_DEVICE = 'L-PPoP';

    /** Vista RAS errors for the failure messages websocket.js sets. */
    const RAS_ERRORS = {
        619: 'A connection to the remote computer could not be established, so the port used for this connection was closed.',
        629: 'The connection was closed by the remote computer.',
        691: 'Access was denied because the username and/or password was invalid on the domain.',
        800: 'The remote connection was not made because the attempted VPN tunnels failed. The VPN server might be unreachable.',
        868: 'The remote connection was not made because the name of the remote access server did not resolve.'
    };

    function domainName() {
        if (typeof root.melatonDomainName === 'function') return root.melatonDomainName();
        const conn = root.wsClient && root.wsClient.melatonConnection;
        return (conn && conn.domain) || DEFAULT_DOMAIN;
    }

    function connectionName() {
        if (typeof root.melatonConnectionName === 'function') return root.melatonConnectionName();
        const conn = root.wsClient && root.wsClient.melatonConnection;
        return (conn && conn.connectionName) || DEFAULT_CONNECTION_NAME;
    }

    /** Before /status has answered: guess from the host name the page was opened with. */
    function guessConnectionType(hostname) {
        const host = String(hostname || '').toLowerCase();
        if (!host || host === 'localhost' || /\.(local|lan|home|internal)$/.test(host)) return 'Ethernet';
        const v4 = host.split('.').map(Number);
        if (v4.length === 4 && v4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
            const [a, b] = v4;
            if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
                || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) {
                return 'Ethernet';
            }
        }
        return 'WAN';
    }

    function connectionInfo() {
        const conn = (root.wsClient && root.wsClient.melatonConnection) || {};
        const fqdn = (root.location && root.location.hostname) || 'localhost';
        return {
            domain: domainName(),
            connectionName: connectionName(),
            fqdn,
            connectionType: conn.connectionType === 'Ethernet' || conn.connectionType === 'WAN'
                ? conn.connectionType
                : guessConnectionType(fqdn),
            device: conn.device || DEFAULT_DEVICE
        };
    }

    function miniportLabel(info) {
        const i = info || connectionInfo();
        return `${i.connectionType} Miniport (${i.device})`;
    }

    function connectingTitle(info) {
        return `Connecting to ${(info || connectionInfo()).connectionName}...`;
    }

    /** The dialog's one status line for a connection beat (websocket.js CONNECTION_BEATS). */
    function connectingText(beat, info) {
        const i = info || connectionInfo();
        switch (beat) {
            case 'negotiation':
                return 'Verifying user name and password...';
            case 'establishing':
                return 'Registering your computer on the network...';
            case 'connected':
                return 'Connected.';
            default:
                return `Connecting to ${i.fqdn} using '${miniportLabel(i)}'...`;
        }
    }

    function attemptText(ui) {
        if (!ui || !(ui.attempt > 0)) return '';
        return ui.maxAttempts > 0
            ? `Reconnect attempt ${ui.attempt} of ${ui.maxAttempts}.`
            : `Reconnect attempt ${ui.attempt}.`;
    }

    /** websocket.js failure message → { code, text } (the raw message stays for More Info). */
    function errorFor(message, options = {}) {
        const msg = String(message || '').toLowerCase();
        let code = 800;
        if (options.online === false) code = 868;
        else if (/after several attempts|max retry/.test(msg)) code = 800;
        else if (/closed|disconnected|code \d/.test(msg)) code = 629;
        else if (/connection failed|connection failure|network connection error/.test(msg)) code = 619;
        return { code, text: `Error ${code}: ${RAS_ERRORS[code]}` };
    }

    function errorTitle() {
        return 'Error Connecting to domain controller';
    }

    /** XP's logon message when the domain cannot be reached (Cancel at the logon screen). */
    function domainUnavailableText(info) {
        return `The system cannot log you on now because the domain ${(info || connectionInfo()).domain} is not available.`;
    }

    /**
     * Logon-screen windows (the Connecting dialog, Dreamscape Mainframe Server) sit in the
     * bottom-right quadrant, a little off any grid, the way a logon hook pops its windows up
     * (Yukimi, 2026-10-12), and below the centered logon dialog where the screen allows. Call
     * after the window is open (it needs its size); setModalOffsetPx is modalUtils.js.
     */
    const LOGON_SPOTS = {
        connecting: { fx: 0.69, fy: 0.70, dx: 13, dy: 7 },
        mainframe: { fx: 0.635, fy: 0.765, dx: -9, dy: 4 }
    };

    function logonWindowOffset(slot, size, viewport, logonRect) {
        const spot = LOGON_SPOTS[slot] || LOGON_SPOTS.connecting;
        const margin = 16;
        const { w, h } = size;
        const { vw, vh } = viewport;
        let cx = vw * spot.fx + spot.dx;
        let cy = vh * spot.fy + spot.dy;
        if (logonRect && logonRect.height) cy = Math.max(cy, logonRect.bottom + 18 + h / 2);
        cx = Math.min(Math.max(cx, w / 2 + margin), vw - w / 2 - margin);
        cy = Math.min(Math.max(cy, h / 2 + margin), vh - h / 2 - margin);
        return { x: Math.round(cx - vw / 2), y: Math.round(cy - vh / 2) };
    }

    function placeLogonWindow(modal, slot = 'connecting') {
        if (!modal || !root.document) return null;
        const logon = root.document.getElementById('desktopPreStartupModal');
        const logonRect = logon && !logon.classList.contains('hidden') ? logon.getBoundingClientRect() : null;
        const offset = logonWindowOffset(
            slot,
            { w: modal.offsetWidth || 380, h: modal.offsetHeight || 140 },
            { vw: root.innerWidth, vh: root.innerHeight },
            logonRect
        );
        if (typeof root.setModalOffsetPx === 'function') {
            root.setModalOffsetPx(modal, offset.x, offset.y, { snap: false });
        } else {
            modal.style.setProperty('--modal-offset-x', `${offset.x}px`);
            modal.style.setProperty('--modal-offset-y', `${offset.y}px`);
        }
        return offset;
    }

    /**
     * On the desktop the Connecting dialog keeps out of the way (Yukimi, 2026-10-12): bottom-left
     * of the work area (above the taskbar), padded in proportion to the screen, and stepped to the
     * right of any desktop icons that sit in that band. obstacles are icon rects.
     */
    function desktopWindowOffset(size, area, obstacles = [], viewport = null) {
        const vw = viewport ? viewport.vw : area.right;
        const vh = viewport ? viewport.vh : area.bottom;
        const pad = Math.round(Math.max(16, Math.min(40, (area.right - area.left) * 0.018)));
        const bottom = area.bottom - pad;
        const top = Math.max(area.top + pad, bottom - size.h);
        let left = area.left + pad;
        const inBand = obstacles
            .filter((r) => r && r.width > 0 && r.height > 0 && r.bottom > top && r.top < bottom)
            .sort((a, b) => a.left - b.left);
        // Icons in the band push the dialog right until it fits beside them
        let moved = true;
        while (moved) {
            moved = false;
            for (const r of inBand) {
                if (r.left < left + size.w && r.right > left) {
                    left = r.right + pad;
                    moved = true;
                }
            }
        }
        left = Math.min(left, area.right - pad - size.w);
        left = Math.max(area.left + pad, left);
        return { x: Math.round(left + size.w / 2 - vw / 2), y: Math.round(top + size.h / 2 - vh / 2) };
    }

    function placeDesktopWindow(modal) {
        if (!modal || !root.document) return null;
        const d = root.document;
        const vw = root.innerWidth;
        const vh = root.innerHeight;
        let bottom = vh;
        const taskbar = d.getElementById('desktopTaskbar');
        if (taskbar && !taskbar.classList.contains('hidden')) {
            const r = taskbar.getBoundingClientRect();
            if (r.height > 0 && r.top > vh / 2) bottom = r.top;
        }
        const icons = [...d.querySelectorAll('#desktopIcons .desktop-icon, #desktopIcons .desktop-shortcut')]
            .map((icon) => icon.getBoundingClientRect());
        const offset = desktopWindowOffset(
            { w: modal.offsetWidth || 380, h: modal.offsetHeight || 140 },
            { left: 0, top: 0, right: vw, bottom },
            icons,
            { vw, vh }
        );
        if (typeof root.setModalOffsetPx === 'function') {
            root.setModalOffsetPx(modal, offset.x, offset.y, { snap: false });
        } else {
            modal.style.setProperty('--modal-offset-x', `${offset.x}px`);
            modal.style.setProperty('--modal-offset-y', `${offset.y}px`);
        }
        return offset;
    }

    // ---- Connect <connection> --------------------------------------------------------------

    const doc = typeof document !== 'undefined' ? document : null;
    let connectModal = null;
    let pending = null; // { promise, resolve } until a password gets the session back
    let busy = false;

    function el(selector) {
        return connectModal ? connectModal.querySelector(selector) : null;
    }

    function connectionUserName() {
        const ws = root.wsClient;
        const name = ws && typeof ws._getConnectionUsername === 'function' ? ws._getConnectionUsername() : '';
        return name && name !== '—' ? name : 'Administrator';
    }

    function ensureConnectModal() {
        if (connectModal || !doc) return connectModal;
        connectModal = doc.createElement('div');
        connectModal.id = 'domainConnectModal';
        connectModal.className = 'modal hidden on-top boot-dialog vpn-dialog domain-connect-modal';
        connectModal.setAttribute('role', 'dialog');
        connectModal.setAttribute('aria-modal', 'true');
        connectModal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main">
                    <i class="fas fa-network-wired icon-fa"></i>
                    <img src="/static_images/melaton/net-globe.png" alt="" class="icon-image">
                    <span class="domain-connect-title">Connect</span>
                </div>
            </div>
            <div class="modal-window-controls">
                <button type="button" class="btn-danger close-btn btn-small domain-connect-close" title="Close">
                    <i class="fa-regular fa-xmark-large"></i>
                </button>
            </div>
            <div class="modal-content vpn-dialog-content">
                <div class="vpn-banner" aria-hidden="true">
                    <img src="/static_images/melaton/net-laptop.png" alt="" class="vpn-banner-laptop" draggable="false">
                    <span class="vpn-banner-link"></span>
                    <img src="/static_images/melaton/net-globe.png" alt="" class="vpn-banner-globe" draggable="false">
                    <span class="vpn-banner-link"></span>
                    <img src="/static_images/melaton/net-server.png" alt="" class="vpn-banner-server" draggable="false">
                </div>
                <form class="vpn-form" autocomplete="off">
                    <label class="vpn-form-row"><span><u>U</u>ser name:</span>
                        <input class="vpn-input domain-connect-user" type="text" readonly tabindex="-1"></label>
                    <label class="vpn-form-row"><span><u>P</u>assword:</span>
                        <input class="vpn-input domain-connect-password" type="password" autocomplete="current-password"></label>
                    <label class="vpn-form-row"><span>Do<u>m</u>ain:</span>
                        <input class="vpn-input domain-connect-domain" type="text" readonly tabindex="-1"></label>
                    <p class="vpn-form-status" aria-live="polite"></p>
                    <div class="vpn-buttons">
                        <button type="submit" class="btn-standard domain-connect-ok"><u>C</u>onnect</button>
                        <button type="button" class="btn-standard domain-connect-cancel">Cancel</button>
                        <button type="button" class="btn-standard domain-connect-properties">Pr<u>o</u>perties</button>
                    </div>
                </form>
            </div>`;
        doc.body.appendChild(connectModal);
        el('.vpn-form').addEventListener('submit', (ev) => {
            ev.preventDefault();
            submitConnect();
        });
        el('.domain-connect-cancel').addEventListener('click', () => closeConnect());
        el('.domain-connect-close').addEventListener('click', () => closeConnect());
        el('.domain-connect-properties').addEventListener('click', () => {
            if (root.melatonControlPanel) root.melatonControlPanel.open('network');
        });
        connectModal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !busy) {
                ev.preventDefault();
                closeConnect();
            }
        });
        return connectModal;
    }

    function fillConnect() {
        const domain = domainName();
        el('.domain-connect-title').textContent = `Connect ${connectionName()}`;
        el('.domain-connect-user').value = connectionUserName();
        el('.domain-connect-domain').value = domain;
        el('.vpn-form-status').textContent = '';
    }

    function setBusy(on) {
        busy = on;
        if (!connectModal) return;
        connectModal.classList.toggle('busy', on);
        ['.domain-connect-ok', '.domain-connect-cancel', '.domain-connect-properties', '.domain-connect-password']
            .forEach((sel) => { const node = el(sel); if (node) node.disabled = on; });
        el('.vpn-form-status').textContent = on ? 'Verifying user name and password...' : '';
    }

    /** Show the dialog (again); the promise from show() stays the same until a logon succeeds. */
    function openConnect() {
        if (!ensureConnectModal()) return;
        fillConnect();
        if (typeof root.openModal === 'function') root.openModal(connectModal);
        else connectModal.classList.remove('hidden');
        const password = el('.domain-connect-password');
        password.value = '';
        setTimeout(() => password.focus(), 0);
    }

    function closeConnect() {
        if (!connectModal || busy) return;
        if (typeof root.closeModal === 'function') root.closeModal(connectModal);
        else connectModal.classList.add('hidden');
    }

    /** Resolves once a password logs the session on again (Cancel keeps it waiting, like Windows). */
    function showConnect() {
        if (!pending) {
            let resolve;
            const promise = new Promise((r) => { resolve = r; });
            pending = { promise, resolve };
        }
        openConnect();
        return pending.promise;
    }

    async function login(password) {
        const response = await root.fetch('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', data: { pin: password } })
        });
        let payload = null;
        try { payload = await response.json(); } catch (_) { /* a failure below */ }
        return response.ok && payload && payload.success !== false ? payload : null;
    }

    async function submitConnect() {
        if (busy) return;
        const password = el('.domain-connect-password').value;
        setBusy(true);
        let payload = null;
        try {
            payload = password ? await login(password) : null;
        } catch (_) {
            payload = null;
        }
        setBusy(false);
        if (payload) {
            // syncAuthLocalStorageFromServer: public/scripts/comp/connectionManager.js
            if (typeof root.syncAuthLocalStorageFromServer === 'function') root.syncAuthLocalStorageFromServer(payload);
            el('.domain-connect-password').value = '';
            closeConnect();
            const done = pending;
            pending = null;
            if (done) done.resolve();
            return;
        }
        if (root.bootMessageBox) {
            await root.bootMessageBox.show({
                title: errorTitle(),
                icon: 'error',
                message: `Error 691: ${RAS_ERRORS[691]}`,
                buttons: [{ label: 'OK', value: 'ok', default: true, cancel: true }]
            });
        }
        const field = el('.domain-connect-password');
        field.value = '';
        field.focus();
    }

    const api = {
        DEFAULT_DOMAIN,
        DEFAULT_CONNECTION_NAME,
        RAS_ERRORS,
        connectionInfo,
        guessConnectionType,
        miniportLabel,
        connectingTitle,
        connectingText,
        attemptText,
        errorFor,
        errorTitle,
        domainUnavailableText,
        logonWindowOffset,
        placeLogonWindow,
        desktopWindowOffset,
        placeDesktopWindow,
        connect: {
            show: showConnect,
            open: openConnect,
            close: closeConnect,
            isPending: () => !!pending,
            isOpen: () => !!(connectModal && !connectModal.classList.contains('hidden'))
        }
    };
    if (root) root.melatonNetworkDialogs = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
