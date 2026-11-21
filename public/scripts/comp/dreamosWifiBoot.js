/*
 * DreamOS Wi-Fi from the boot (#1001): window.dreamosWifi until its windows first open.
 *
 * dreamosWifi.js is Vista's wireless and network windows (Connect to a network, Manage Wireless Networks, the status
 * sheets, Network Connections, Set up a connection or network). It is featureLoader feature 'dreamos_wifi' and loads
 * on the first open, from the service worker's copy when there is no server; Control Panel (feature 'control_panel',
 * which depends on it) brings it too, so the Control Panel's network pages and the tray's network flyout read the
 * full object as before.
 *
 * Until then this answers for window.dreamosWifi: the openers (each loads the windows first, then opens), the quick
 * reads (available, radioOff, signalLevel), and what the windows keep from the page's start - the saved networks
 * (a known network the host reports is remembered, localStorage dreamos.wifi.saved), the last scan's list and when
 * the connection came up (the status sheet's Duration). dreamosWifi.js takes those over (_boot) and replaces
 * window.dreamosWifi with itself. Nothing polls: the provider's pushes are followed, as dreamosWifi.js follows them.
 */
(function (root) {
    'use strict';

    if (root.dreamosWifi) return;

    // the 'network' tray provider (trayProviders.js): DreamOS's DreamOSNetwork wrapper, the Android app's desktop shell
    const host = () => (root.melatonTray && root.melatonTray.provider('network')) || null;

    function state() {
        const h = host();
        let s = null;
        try { s = h && h.get(); } catch (_) { s = null; }
        return s && typeof s === 'object' ? s : {};
    }

    /** The connected Wi-Fi network, or null. */
    function current() {
        const w = state().wifi || {};
        return w.present && w.state === 'connected' && w.network && w.network.name ? w.network : null;
    }

    /** 0-5 bars from the host's percent, as the tray icon draws it (dreamosNetTray.js). */
    function signalLevel(percent) {
        const p = Number(percent);
        if (!Number.isFinite(p) || p <= 0) return 0;
        if (p >= 80) return 5;
        if (p >= 60) return 4;
        if (p >= 40) return 3;
        if (p >= 20) return 2;
        return 1;
    }

    // The saved networks in Vista's priority order (the same list and rules as dreamosWifi.js saved / remember)
    const SAVED_KEY = 'dreamos.wifi.saved';
    function saved() {
        try {
            const v = JSON.parse(root.localStorage.getItem(SAVED_KEY) || '[]');
            return Array.isArray(v) ? v.filter((x) => x && x.name) : [];
        } catch (_) { return []; }
    }
    function remember(name, security, auto) {
        const list = saved();
        const i = list.findIndex((x) => x.name === name);
        const rec = { name, security: security || (i >= 0 ? list[i].security : 'psk'), auto: auto === undefined || auto === null ? (i >= 0 ? list[i].auto : true) : !!auto };
        if (i >= 0) {
            if (list[i].security === rec.security && list[i].auto === rec.auto) return;
            list[i] = rec;
        } else list.push(rec);
        try { root.localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (_) { /* private window: the order lasts for the page */ }
    }

    let scanned = []; // the host's last list (strongest first)
    let connectedSince = 0; // when this page saw the connection come up (Duration)
    let connectedName = '';

    function noteConnection() {
        const n = current();
        const name = n ? String(n.name) : '';
        if (name !== connectedName) {
            connectedName = name;
            connectedSince = name ? Date.now() : 0;
        }
        if (n && n.known) remember(name, n.security, n.autoConnect);
    }

    function setList(list) {
        if (!Array.isArray(list)) return;
        scanned = list.filter((n) => n && n.name);
        scanned.forEach((n) => { if (n.known) remember(n.name, n.security, n.autoConnect); });
    }

    // the provider's pushes: its state, and a finished scan's list (provider.onScan); a provider registered later is
    // followed too. retire() ends this when dreamosWifi.js takes over.
    let scanOff = null;
    let changeOff = null;
    const followScan = () => {
        if (scanOff) { try { scanOff(); } catch (_) { /* gone */ } scanOff = null; }
        const h = host();
        if (h && typeof h.onScan === 'function') scanOff = h.onScan((d) => setList(d && Array.isArray(d.networks) ? d.networks : null));
    };
    if (root.melatonTray) {
        let last = host();
        changeOff = root.melatonTray.onChange('network', () => { if (host() !== last) { last = host(); followScan(); } noteConnection(); });
        followScan();
    }
    noteConnection();

    const stub = {};
    let loading = null;
    /** dreamosWifi.js's own object, loaded (null if it could not be). */
    function windows() {
        if (root.dreamosWifi && root.dreamosWifi !== stub) return Promise.resolve(root.dreamosWifi);
        if (!root.featureLoader) return Promise.resolve(null);
        if (!loading) {
            loading = root.featureLoader.loadFeature('dreamos_wifi')
                .then(() => (root.dreamosWifi && root.dreamosWifi !== stub ? root.dreamosWifi : null))
                .finally(() => { loading = null; });
        }
        return loading;
    }
    const opener = (name) => (...args) => windows().then((w) => (w && typeof w[name] === 'function' ? w[name](...args) : null));

    Object.assign(stub, {
        openConnect: opener('openConnect'),
        openManage: opener('openManage'),
        openStatus: opener('openStatus'),
        openVpnStatus: opener('openVpnStatus'),
        openMobileStatus: opener('openMobileStatus'),
        openConnections: opener('openConnections'),
        openSetup: opener('openSetup'),
        setRadio: opener('setRadio'),
        available() {
            const w = state().wifi;
            return !!(host() && w && w.present);
        },
        /** the Wi-Fi adapter is there but switched off (the flyout offers to turn it on) */
        radioOff() {
            const w = state().wifi || {};
            return !!(host() && w.present && (w.radio === false || w.state === 'off'));
        },
        signalLevel,
        /** a connection's name needs Network Connections' names (dreamosWifi.js): '' until it has loaded */
        connectionOf() {
            void windows().catch(() => null);
            return '';
        },
        // dreamosWifi.js: what this page has seen so far, and the end of this file's follow
        _boot: {
            scanned: () => scanned.slice(),
            connectedSince: () => connectedSince,
            connectedName: () => connectedName,
            retire() {
                if (changeOff) { try { changeOff(); } catch (_) { /* gone */ } changeOff = null; }
                if (scanOff) { try { scanOff(); } catch (_) { /* gone */ } scanOff = null; }
            }
        }
    });
    root.dreamosWifi = stub;
})(typeof window !== 'undefined' ? window : globalThis);
