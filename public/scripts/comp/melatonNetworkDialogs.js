/**
 * Melaton network dialogs (Yozora #427): the client is a domain-joined PC and the server is its
 * domain controller, reached like a Vista VPN connection.
 *
 *   Connecting to <domain>...   #connectionDialModal (app.html), rendered by websocket.js
 *                               _renderConnectionDial with the text helpers below:
 *                               "Connecting to <fqdn> using '<WAN|Ethernet> Miniport (L-PPoP)'..."
 *                               → "Verifying user name and password..." → "Registering your
 *                               computer on the network...". A failure turns it into
 *                               "Error Connecting to <domain>" with a RAS error (800, 629, ...)
 *   Connect <domain>            the login dialog when the session needs a password again after
 *                               boot (pinModal.js showPinModal routes here on the desktop): banner,
 *                               User name / Password / Domain, Connect / Cancel / Properties
 *
 * <fqdn> is the host the page talks to (location.hostname); the domain name, WAN / Ethernet and
 * the device come from the server's public OPTIONS /status (`melaton`, modules/melatonNetwork.js,
 * kept by websocket.js as wsClient.melatonConnection). WAN = the client reached the server over
 * the Internet; Ethernet = from a private address through the local nginx. L-PPoP = LANTIS
 * Public Point of Presence, the LANTIS FireStorm load balancer.
 */
(function (root) {
    'use strict';

    const DEFAULT_DOMAIN = 'DREAMSCAPE';
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
        return `Connecting to ${(info || connectionInfo()).domain}...`;
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
                return `Connected to ${i.domain}.`;
            default:
                return `Connecting to ${i.fqdn} using '${miniportLabel(i)}'...`;
        }
    }

    function attemptText(ui) {
        if (!ui || !(ui.attempt > 0)) return '';
        return ui.maxAttempts > 0
            ? `Redial attempt ${ui.attempt} of ${ui.maxAttempts}.`
            : `Redial attempt ${ui.attempt}.`;
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

    function errorTitle(info) {
        return `Error Connecting to ${(info || connectionInfo()).domain}`;
    }

    // ---- Connect <domain> ------------------------------------------------------------------

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
        el('.domain-connect-title').textContent = `Connect ${domain}`;
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
        RAS_ERRORS,
        connectionInfo,
        guessConnectionType,
        miniportLabel,
        connectingTitle,
        connectingText,
        attemptText,
        errorFor,
        errorTitle,
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
