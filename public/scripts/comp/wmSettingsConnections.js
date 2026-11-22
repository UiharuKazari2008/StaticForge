/**
 * Melaton Mobile Settings: Connections pages (Connections, Network Cards (its Wireless tab: wmWifi.js, #1038), Nightshade, Domain Enroll, Wireless Manager, Remote Access, Grimoire, Cellular, Bluetooth) (Yozora #709, #771, #895).
 * Pages for the Settings app (wmPrograms.js), added through window.wmSettings.registerPage /
 * extendPage and drawn with window.wmSettings.ui so they look like WM 6.1's own pages. Every
 * value is read and saved through the desktop's own store (one source of truth).
 * Styles: public/css/wm-settings-connections.css. Runs only on Melaton Mobile (uiShell 'mobile').
 *
 *   Connections > Status   the desktop's "<connection> Status" facts and the Network and Server
 *                          Center's domain controller rows (melatonControlPanel.js), read-only;
 *                          the server's public OPTIONS /status polled every 5 s while shown
 *   Network Cards          WM's Configure Network Adapters: the network is the domain, the one
 *                          adapter is the VPN miniport (melatonNetworkDialogs.js miniportLabel);
 *                          tapping it shows its status, ok goes back to the list
 *   Nightshade             the Nightshade Network service (#895): General (status, account, Connect /
 *                          Disconnect), CaféReady (the Melaton Café Miniport's switch and idle timeout,
 *                          its logo), Advanced (server, latency, session, domain)
 *   Domain Enroll          the domain (network) and connection names, config.json
 *                          userGlobalSettings.desktop.domainName / connectionName through
 *                          persistUserGlobalSettingsPatch (modalUtils.js), as the desktop's
 *                          Customize network settings / Rename Connection
 *   Wireless Manager       WM 6.1's All / Wi-Fi / Bluetooth / Phone rows through the Android app
 *                          (AndroidDevice, Shizuku), Menu with the radios' Android settings and
 *                          Disconnect Cellular Data; then the Dreamscape connection row: tap connects
 *                          (wsClient.manualReconnect) or disconnects (cancelConnectionFromUser,
 *                          after a warning), as the tray flyout's "Connect or disconnect"
 *   Remote Access          remoteAccessProperties.js on four tabs: priority client
 *                          (setAgentPriorityClient), generation method + Auto Generate + prints
 *                          per turn, Open With; one persistRemoteAccessSettingsPatch on ok; MCP:
 *                          the connector addresses (resolve_grimoire_url), read-only with Copy (#831)
 *   Grimoire               Internet Properties for Grimoire / Alchemy through cplInternetOptions.js
 *                          (loaded on demand): home page + search provider, delete browsing
 *                          history, Alchemy's picture quality and frame rates (saveAlchemy)
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.registerPage !== 'function') return;

    const ui = wmSettings.ui;
    const esc = ui.esc;
    const root = window;

    // melatonControlPanel.js STATUS_POLL_MS: once a minute, and at once when the link comes up or drops
    const STATUS_POLL_MS = 60000;
    const LIVE_TICK_MS = 1000;

    // ---------------------------------------------------------------- connection facts
    // The same reads as melatonControlPanel.js (info, linkState, accessText, formatDuration).

    const net = () => root.melatonNetworkDialogs || null;
    const ws = () => root.wsClient || null;

    function info() {
        const n = net();
        return n
            ? n.connectionInfo()
            : { domain: 'DREAMSCAPE', connectionName: 'Nightshade Network', fqdn: root.location.hostname, connectionType: 'WAN', device: 'L-PPoP' };
    }

    function miniport(i) {
        const n = net();
        return n ? n.miniportLabel(i) : `${i.connectionType} Miniport (${i.device})`;
    }

    /** 'connected' | 'connecting' | 'auth' | 'disconnected' */
    function linkState() {
        const client = ws();
        if (!client) return 'disconnected';
        if (client.connectionPhase === 'auth') return 'auth';
        if (client.isConnected && client.isConnected()) return 'connected';
        if (client.isConnecting || client.connectionPhase === 'dialing') return 'connecting';
        return 'disconnected';
    }

    function accessText(state) {
        switch (state) {
            case 'connected': return 'Local and Internet';
            case 'connecting': return 'Connecting...';
            case 'auth': return 'Logon required';
            default: return 'Not connected';
        }
    }

    function formatDuration(ms) {
        const total = Math.max(0, Math.floor((ms || 0) / 1000));
        const days = Math.floor(total / 86400);
        const h = String(Math.floor((total % 86400) / 3600)).padStart(2, '0');
        const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return days > 0 ? `${days}.${h}:${m}:${s}` : `${h}:${m}:${s}`;
    }

    /** The "<connection> Status" dialog's rows (melatonControlPanel.js updateStatusDialog). */
    function connectionFacts() {
        const client = ws();
        const i = info();
        const state = linkState();
        const connected = state === 'connected';
        const stats = (client && client.connectionStats) || {};
        let latency = '—';
        if (connected && client && client.currentRtt !== null && client.currentRtt !== undefined) {
            latency = `${Math.round(client.currentRtt / 10) * 10} ms`;
            if (client.rttVariability !== null && client.rttVariability !== undefined && client.currentRtt > 0) {
                latency += ` (±${Math.round((client.rttVariability / client.currentRtt) * 100)}%)`;
            }
        }
        return [
            ['Domain:', i.domain],
            ['Server name:', i.fqdn],
            ['Device:', miniport(i)],
            ['Media State:', connected ? 'Enabled' : accessText(state)],
            ['Duration:', connected && stats.connectedAt ? formatDuration(Date.now() - stats.connectedAt) : '—'],
            ['Latency:', latency],
            ['Encryption:', root.location.protocol === 'https:' ? 'TLS (HTTPS)' : 'None'],
            ['Sent:', `${Number(stats.messagesOut || 0).toLocaleString()} messages`],
            ['Received:', `${Number(stats.messagesIn || 0).toLocaleString()} messages`]
        ];
    }

    // the server's public status (melatonControlPanel.js fetchStatus / pollStatus / serverRows)
    let lastStatus = null;
    let statusError = false;
    let statusAt = 0;
    let statusBusy = null;

    async function pollStatus() {
        if (statusBusy) return statusBusy;
        statusBusy = (async () => {
            try {
                const response = await root.fetch('/status', {
                    method: 'OPTIONS',
                    cache: 'no-store',
                    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                lastStatus = await response.json();
                statusError = false;
                const client = ws();
                if (client && lastStatus && lastStatus.melaton) client.melatonConnection = lastStatus.melaton;
            } catch (_) {
                statusError = true;
            }
            statusAt = Date.now();
        })();
        try { await statusBusy; } finally { statusBusy = null; }
    }

    function serverFacts() {
        const status = lastStatus || (ws() && ws().lastServerStartupStatus) || null;
        if (!status || statusError) return [['Domain controller:', statusError ? 'Not responding' : 'Checking...']];
        const caps = status.capabilities || {};
        const onOff = (on) => (on ? 'On' : 'Off');
        const rows = [
            ['Domain controller:', status.isReady ? 'Ready' : `Starting (${status.stageMessage || 'please wait'})`],
            ['Server uptime:', formatDuration(status === lastStatus && statusAt && !statusError ? status.uptime + (Date.now() - statusAt) : status.uptime)],
            ['Session service:', onOff(caps.websocket)],
            ['Image generation:', onOff(caps.generation)],
            ['Static content:', onOff(caps.staticAssets)]
        ];
        if (status.runtimeCompileComplete !== undefined) rows.push(['Client files:', status.runtimeCompileComplete ? 'Up to date' : 'Compiling']);
        const v = typeof root.getMeletonVersionInfo === 'function' ? root.getMeletonVersionInfo() : null;
        if (v && v.version) rows.push(['Version:', `${v.version}${v.build && v.build !== 'Unknown' ? ` (Build ${v.build})` : ''}`]);
        return rows;
    }

    /** Connect / disconnect as the desktop does (melatonControlPanel.js connectToDomain / disconnectFromDomain). */
    function connect() {
        const client = ws();
        // the desktop's Connect dialog (logon required) is a Vista window: the phone dials again
        // and its own logon handling takes over
        if (client && typeof client.manualReconnect === 'function') client.manualReconnect();
    }

    function disconnect() {
        const client = ws();
        if (client && typeof client.cancelConnectionFromUser === 'function') client.cancelConnectionFromUser();
    }

    /** The page's green header line (WM shows the applet's own heading, not the grid label). */
    function setHeader(el, text) {
        const hdr = el.closest('.wm-set') && el.closest('.wm-set').querySelector('.wm-form-hdr');
        if (hdr) hdr.textContent = text;
    }

    /**
     * Redraws `paint` every tick while `el` is on screen. Settings behind another app, the page hidden or
     * the screen off: no ticks at all (they returned early but kept waking); seen again, it is painted at
     * once and ticks on. Gone, it ends with its listeners.
     */
    function liveTick(el, paint, ms = LIVE_TICK_MS) {
        const seen = () => {
            const sh = window.wmShell;
            return el.isConnected && !el.closest('[hidden]') && !(sh && sh.onScreen && !sh.onScreen(el));
        };
        let timer = 0;
        const evs = [[window, 'melatonscreen'], [document, 'visibilitychange'], [document, 'wmBehind'], [document, 'wmAppChange']];
        // perf: allow a live readout's tick, only while its element is on screen (sync clears it otherwise)
        const run = () => { timer = setInterval(() => { if (seen()) paint(); else sync(); }, ms); };
        function sync() {
            if (!el.isConnected) { clearInterval(timer); timer = 0; evs.forEach(([t, e]) => t.removeEventListener(e, sync)); return; }
            const on = seen();
            if (on && !timer) { paint(); run(); } else if (!on && timer) { clearInterval(timer); timer = 0; }
        }
        evs.forEach(([t, e]) => t.addEventListener(e, sync));
        // the page painted itself just now: the first tick after ms
        if (seen()) run();
    }

    // ---------------------------------------------------------------- Connections > Status

    wmSettings.extendPage('connections', {
        id: 'net',
        tabs: [['net-status', 'Status']],
        init: () => ({}),
        render(el) {
            el.classList.add('wm-setc');
            const i = info();
            el.innerHTML = `${ui.sub(`${i.connectionName} Status`)}<div data-f="conn"></div>
                ${ui.sub('Domain controller')}<div data-f="server"></div>`;
            const conn = el.querySelector('[data-f="conn"]');
            const server = el.querySelector('[data-f="server"]');
            const paint = () => {
                const a = ui.facts(connectionFacts());
                const b = ui.facts(serverFacts());
                if (conn.innerHTML !== a) conn.innerHTML = a;
                if (server.innerHTML !== b) server.innerHTML = b;
            };
            paint();
            const linkUp = () => { const c = ws(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };
            let wasUp = linkUp();
            liveTick(el, () => {
                paint();
                const up = linkUp();
                const changed = up !== wasUp;
                wasUp = up;
                if (changed || (!document.hidden && Date.now() - statusAt >= STATUS_POLL_MS)) pollStatus().then(() => { if (el.isConnected) paint(); });
            });
            if (Date.now() - statusAt >= STATUS_POLL_MS) pollStatus().then(() => { if (el.isConnected) paint(); });
        }
    });

    // ---------------------------------------------------------------- Network Cards
    // (#1019, Yukimi Nov 21 2026) rebuilt now that the Nightshade Network has its own applet: the phone's real
    // adapters (Wi-Fi, the cellular data link), the Nightshade Virtual Network Interface (the app's Melaton Café
    // Miniport, #815), the interfaces that share this phone's connection (Mobile Hotspot, USB / Bluetooth /
    // Ethernet tethering) with their status and address, the VPN tunnels (WireGuard's added here by name, the one
    // seen up learned), then ActiveSync's lines. The server link's own "WAN Miniport" is no longer an adapter here.
    const CAFE_ADAPTER = 'Nightshade Virtual Network Interface';
    const WIREGUARD = 'com.wireguard.android';
    const wifiHost = () => (root.AndroidWifi && typeof root.AndroidWifi.interfaces === 'function' ? root.AndroidWifi : null);
    const qaHost = () => (root.AndroidQuickAccess && typeof root.AndroidQuickAccess.config === 'function' ? root.AndroidQuickAccess : null);
    // AndroidWifi.interfaces()'s last answer ({ interfaces, tethering }): read when a page opens and on the app's
    // 'androidnetifaces' push, never per tick (the bridge call builds every adapter's figures)
    let ifCache = null;
    function readIfaces(fresh) {
        if (ifCache && !fresh) return ifCache;
        const h = wifiHost();
        if (!h) return null;
        try { ifCache = JSON.parse(h.interfaces()); } catch (_) { ifCache = null; }
        return ifCache;
    }
    const rows = () => { const r = readIfaces(); return r && Array.isArray(r.interfaces) ? r.interfaces.filter((x) => x && x.name) : []; };
    function qaConfig() {
        const h = qaHost();
        if (!h) return null;
        try { return JSON.parse(h.config()); } catch (_) { return null; }
    }
    /** WireGuard's tunnels: the names added here, then any seen up (the app keeps the last one seen). */
    function wgTunnels() {
        const names = [];
        const cfg = qaConfig();
        ((cfg && cfg.wireguard) || []).forEach((n) => { if (n && !names.includes(n)) names.push(n); });
        rows().forEach((x) => { if (x.kind === 'vpn' && x.vpnPackage === WIREGUARD && x.vpnSession && !names.includes(x.vpnSession)) names.push(x.vpnSession); });
        return names;
    }
    /** A tunnel's entry in the app's settings ({ name, auto }) and the name it is shown by. */
    const vpnEntry = (t) => { const c = qaConfig(); return (c && c.vpn && c.vpn[t]) || {}; };
    const vpnLabel = (t) => vpnEntry(t).name || t;
    function saveVpnEntry(t, entry) {
        const h = qaHost();
        if (!h || typeof h.setConfig !== 'function') return;
        try { h.setConfig(JSON.stringify({ vpn: { [t]: entry } })); } catch (_) { /* older app */ }
        root.dispatchEvent(new CustomEvent('wmvpnconfig'));
    }
    const wgRow = (name) => rows().find((x) => x.kind === 'vpn' && x.vpnPackage === WIREGUARD && x.vpnSession === name && x.present !== false) || null;
    // the sharing interfaces, always listed where the phone has them (Ethernet only once an adapter shared)
    const SHARES = [['hotspot', 'Mobile Hotspot'], ['usb', 'USB tethering'], ['bluetooth', 'Bluetooth tethering'], ['ethernet', 'Ethernet tethering']];
    const shareKind = (x) => (x.kind === 'lan' ? 'ethernet' : x.kind);
    const shareRow = (k) => rows().find((x) => x.sharing && shareKind(x) === k) || rows().find((x) => k === 'hotspot' && x.kind === 'hotspot') || null;
    function adapters(i, mp) {
        const list = [];
        const all = rows();
        // the phone's own: Wi-Fi, then the cellular data link (its kernel names change, so keyed by alias)
        all.filter((x) => x.kind === 'wifi' && x.nc).forEach((x) => list.push({ key: `if:${x.alias || x.name}`, label: x.label }));
        all.filter((x) => x.kind === 'mobile' && x.alias === 'rmnet0').forEach((x) => list.push({ key: 'if:rmnet0', label: x.label }));
        if (mp && mp.present) list.push({ key: 'cafe', label: CAFE_ADAPTER, selected: !!i.viaMiniport });
        if (wifiHost()) SHARES.forEach(([k, label]) => { if (k !== 'ethernet' || shareRow(k)) list.push({ key: `share:${k}`, label }); });
        wgTunnels().forEach((n) => list.push({ key: `wg:${n}`, label: `${vpnLabel(n)} (WireGuard)` }));
        // another VPN app's tunnel: its own name, opened in its app
        all.filter((x) => x.kind === 'vpn' && x.vpnPackage && x.vpnPackage !== WIREGUARD && x.nc)
            .forEach((x) => list.push({ key: `vpn:${x.name}`, label: `${x.vpnSession || x.vpnApp || 'VPN'} (${x.vpnApp || 'VPN'})` }));
        // ActiveSync's lines (#815), as modems on serial ports: one per partnership, the DeX window on USB
        serialLines().forEach((l) => list.push({ key: `as:${l.key}`, label: l.label }));
        return list;
    }
    const since = (at) => (at ? formatDuration(Date.now() - Number(at)) : '\u2014');
    const ipOf = (x) => (x && Array.isArray(x.ip) && x.ip.length ? x.ip.join(', ') : '\u2014');
    /** An adapter's status rows (Wi-Fi, cellular, a sharing interface, a tunnel), from its interface row. */
    function ifaceFacts(x, status) {
        const rowsOut = [['Status:', status || (x && x.connected ? 'Connected' : x && x.present === false ? 'Not present' : 'Disconnected')]];
        rowsOut.push(['Interface:', x && x.present !== false ? x.name : '\u2014']);
        rowsOut.push(['IP address:', ipOf(x)]);
        if (x && x.gateway) rowsOut.push(['Gateway:', x.gateway]);
        if (x && Array.isArray(x.dns) && x.dns.length) rowsOut.push(['DNS:', x.dns.join(', ')]);
        rowsOut.push(['Duration:', x && x.connected ? since(x.connectedAt) : '\u2014']);
        return rowsOut;
    }
    function shareStatus(k, x) {
        if (k === 'hotspot') {
            const t = (readIfaces() || {}).tethering || {};
            return { on: 'On', starting: 'Turning on...', stopping: 'Turning off...', failed: 'Failed' }[t.wifiAp] || (x && x.sharing ? 'On' : 'Off');
        }
        return x && x.sharing ? 'On' : 'Off';
    }
    /** A WireGuard tunnel up or down by name (the app's own remote control: AndroidWifi.vpnControl). */
    function wgControl(name, up) {
        const h = wifiHost();
        if (!h || typeof h.vpnControl !== 'function') return false;
        try { const r = JSON.parse(h.vpnControl(WIREGUARD, name, !!up)); return !!(r && (r.sent || r.opened)); } catch (_) { return false; }
    }
    function setWgList(list) {
        const h = qaHost();
        if (!h || typeof h.setConfig !== 'function') return;
        try { h.setConfig(JSON.stringify({ wireguard: list })); } catch (_) { /* older app */ }
    }
    function addTunnel(rerender) {
        const sh = root.wmShell;
        if (!sh || typeof sh.messageBox !== 'function') return;
        sh.messageBox({
            title: 'Network Cards',
            text: 'Name of the WireGuard tunnel, exactly as the WireGuard app shows it:',
            input: { value: '' },
            buttons: [{ text: 'Add', value: true }, { text: 'Cancel', value: false }]
        }).then((name) => {
            const n = typeof name === 'string' ? name.trim() : '';
            if (!n) return;
            const cfg = qaConfig() || {};
            const list = (cfg.wireguard || []).filter((x) => x !== n);
            list.push(n);
            setWgList(list);
            root.dispatchEvent(new CustomEvent('wmvpnconfig'));
            if (rerender) rerender();
        });
    }
    function renameTunnel(t, rerender) {
        const sh = root.wmShell;
        if (!sh || typeof sh.messageBox !== 'function') return;
        sh.messageBox({
            title: 'Network Cards',
            text: 'Name for this VPN connection:',
            input: { value: vpnLabel(t) },
            buttons: [{ text: 'Rename', value: true }, { text: 'Cancel', value: false }]
        }).then((name) => {
            if (typeof name !== 'string') return;
            const e = vpnEntry(t);
            saveVpnEntry(t, { name: name.trim() || t, auto: e.auto || { mode: 'manual' } });
            if (rerender) rerender();
        });
    }
    // automatic connection (VpnRules in the app): the choices as the combo shows them
    const AUTO_MODES = [['manual', 'Manually'], ['always', 'Always'], ['wifi', 'By Wi-Fi network'], ['ip', 'By IP address range']];
    const AUTO_WIFI = [['on', 'When connected to'], ['off', 'When not connected to']];
    const AUTO_IP = [['on', 'When the address is within'], ['off', 'When the address is not within']];
    function asState() {
        const as = root.activeSync;
        if (!as || as.kind !== 'device') return null;
        try { return typeof as.state === 'function' ? as.state() : null; } catch (_) { return null; }
    }
    /**
     * ActiveSync's lines, as WM shows modems on serial ports: each partnered computer a "Hayes Compatible
     * on COMn (ActiveSync #n)", the Continuity PC (the DeX window, attached by USB to this phone) a
     * "Serial Cable on USB COM2". With no computer connected the first line is still listed (ready or not).
     */
    function serialLines() {
        const st = asState();
        if (!st) return [];
        const comps = Array.isArray(st.computers) ? st.computers : [];
        const dexPc = comps.find((c) => c.link === 'usb' && (!c.usbDevice || c.usbDevice === st.id));
        const others = comps.filter((c) => c !== dexPc);
        const lines = [];
        const n = Math.max(1, others.length);
        for (let i = 0; i < n; i++) {
            const port = i === 0 ? 1 : i + 2; // COM2 is the USB serial line
            lines.push({ key: `com${port}`, label: `Hayes Compatible on COM${port} (ActiveSync #${i + 1})`, computer: others[i] || null, usb: false });
        }
        const mcx = root.melatonContinuity;
        const pc = mcx && typeof mcx.continuityPc === 'function' ? mcx.continuityPc() : null;
        if (dexPc || pc) lines.push({ key: 'usbcom2', label: 'Serial Cable on USB COM2', computer: dexPc || null, usb: true, pc });
        return lines;
    }
    /** A line's status rows: Line Status, Line Speed, Carrier Detect, Ring Indicator. */
    function lineFacts(line) {
        const st = asState() || {};
        const mcx = root.melatonContinuity;
        const cfg = mcx && mcx.miniportConfig ? mcx.miniportConfig() : null;
        const ring = !(cfg && cfg.config && cfg.config.wakeOnRing === false);
        // Active: the other computer is connected on it; Connected: ActiveSync is up and ready for one;
        // Disconnected: it cannot connect at the moment
        const status = line.computer ? 'Active' : st.online ? 'Connected' : 'Disconnected';
        // ActiveSync's data rate, not the server connection's, and just the rate. The Continuity PC is
        // attached directly: its USB version's top rate (a USB-C dock is often USB 2.0), or Wi-Fi
        // Direct's; a computer's line runs at the rate of this phone's active network
        let speed = '\u2014';
        if (line.usb) {
            const pc = line.pc || {};
            const v = Number(pc.usbVersion) || 0;
            if (pc.attach === 'wireless') speed = '866 Mbps';
            else if (v >= 3.1) speed = '10 Gbps';
            else if (v >= 3) speed = '5 Gbps';
            else if (v >= 2) speed = '480 Mbps';
            else if (v >= 1) speed = '12 Mbps';
        } else {
            // the link rates are live numbers: the app's pushes carry only a displayed change (DeviceStatusBridge,
            // #890), so the shell's copy goes stale; read them from the app as this page draws
            let dev = null;
            const b = root.AndroidDeviceStatus;
            if (b && typeof b.getState === 'function') { try { dev = JSON.parse(b.getState()); } catch (_) { dev = null; } }
            if (!dev) dev = root.wmShell && typeof root.wmShell.deviceStatus === 'function' ? root.wmShell.deviceStatus() : null;
            const kbps = dev ? Number(dev.activeDownKbps) || 0 : 0;
            const wifi = dev && dev.wifi;
            if (kbps > 0) speed = kbps >= 10000 ? `${Math.round(kbps / 1000)} Mbps` : kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} Kbps`;
            else if (dev && dev.active === 'wifi' && wifi && Number(wifi.linkMbps) > 0) speed = `${Number(wifi.linkMbps)} Mbps`;
        }
        return [
            ['Line Status:', status],
            ['Line Speed:', speed],
            ['Carrier Detect:', st.online ? 'Present' : 'Not present'],
            ['Ring Indicator:', ring ? 'Enabled' : 'Disabled']
        ];
    }
    /** What the line is partnered with. */
    function partnerFacts(line) {
        const st = asState() || {};
        const c = line.computer;
        const rows = [];
        if (c) {
            rows.push(['Computer:', c.name || (line.usb ? 'Continuity PC' : 'Computer')]);
            if (c.since) rows.push(['Since:', new Date(c.since).toLocaleString()]);
        } else rows.push(['Computer:', line.usb ? 'Continuity PC' : 'None connected']);
        rows.push(['Partnership:', st.session === 'partner' ? 'Partner' : st.session === 'guest' ? 'Guest' : 'None']);
        if (st.name) rows.push(['This device:', st.name]);
        return rows;
    }
    // the Miniport's Idle timeout choices (minutes; 0 = never disconnect)
    const IDLE_CHOICES = [[1, '1 minute'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [0, 'Never']];

    wmSettings.registerPage({
        id: 'network-cards',
        tab: 'connections',
        label: 'Network Cards',
        icon: 'set-netcards',
        // (#1038) with the phone's Wi-Fi, WM's wireless card layout: Wireless (wmWifi.js) | Network Adapters
        tabs: wifiHost() && root.AndroidWifi && typeof root.AndroidWifi.get === 'function' ? [['nc-wireless', 'Wireless'], ['nc-adapters', 'Network Adapters']] : [],
        init: () => ({ adapter: false, wifi: root.wmWifi ? root.wmWifi.init() : null }),
        render(el, tab, d, api) {
            el.classList.add('wm-setc');
            d.rerender = api.rerender;
            d.tab = tab;
            const wf = root.wmWifi;
            if (tab === 'nc-wireless' && wf) { wf.render(el, d.wifi || (d.wifi = wf.init()), api); return; }
            if (wf) setTimeout(wf.idle, 0); // the Wireless tab left: its listening stops
            const i = info();
            const mcx = root.melatonContinuity;
            const mp = mcx && typeof mcx.miniport === 'function' ? mcx.miniport() : null;
            if (typeof d.adapter === 'string' && d.adapter.startsWith('as:')) {
                // an ActiveSync line (#815): always up; its ring wakes the Melaton Café Miniport
                const lineOf = () => serialLines().find((l) => `as:${l.key}` === d.adapter) || { label: 'ActiveSync', computer: null, usb: false };
                const line = lineOf();
                setHeader(el, line.label);
                const cfg = mcx && mcx.miniportConfig ? mcx.miniportConfig() : null;
                if (d.ring == null) d.ring = !(cfg && cfg.config && cfg.config.wakeOnRing === false);
                el.innerHTML = `<div data-f="facts"></div>
                    ${ui.check('ring', 'Wake on ring', d.ring, 'data-k="ring"')}
                    ${ui.note('When the server rings this line (updates are ready, a workspace changed), the Melaton Caf\u00e9 Miniport connects.')}
                    ${ui.sub('Partnered with')}<div data-f="partner"></div>`;
                const box = el.querySelector('input[data-k="ring"]');
                if (box) box.addEventListener('change', () => { d.ring = box.checked; });
                const facts = el.querySelector('[data-f="facts"]');
                const partner = el.querySelector('[data-f="partner"]');
                const paint = () => {
                    const l = lineOf();
                    const a = ui.facts(lineFacts(l)); if (facts.innerHTML !== a) facts.innerHTML = a;
                    const b = ui.facts(partnerFacts(l)); if (partner.innerHTML !== b) partner.innerHTML = b;
                };
                paint();
                liveTick(el, paint);
                return;
            }
            if (d.adapter === 'cafe') {
                // the Melaton Café Miniport (#815): its Idle timeout ("VPN timeout"), how long the link stays
                // up once no program uses it; ActiveSync's own link stays up regardless
                setHeader(el, CAFE_ADAPTER);
                const cfg = mcx && mcx.miniportConfig ? mcx.miniportConfig() : null;
                if (d.idle == null) d.idle = cfg && cfg.config && cfg.config.idleMinutes != null ? Number(cfg.config.idleMinutes) : 10;
                if (d.cafeOn == null) d.cafeOn = !(mp && mp.enabled === false);
                const cur = IDLE_CHOICES.find(([v]) => v === d.idle) || [d.idle, `${d.idle} minutes`];
                el.innerHTML = `${ui.check('cafe-on', 'Use Melaton Caf\u00e9 Miniport', d.cafeOn, 'data-k="cafe-on"')}
                    <p>Every window of Dreamscape on this phone reaches the server through it, keeps its data in the Caf\u00e9 Cache and stays connected while a window restarts.</p>
                    ${ui.sub('Idle timeout')}
                    <p>Disconnect the Melaton Caf\u00e9 Miniport when no program has used it for:</p>
                    ${ui.comboHtml('idle', cur[1])}
                    ${ui.note('ActiveSync stays connected and wakes the Miniport when a program needs it. Cached data (ActiveSync > Menu > Caf\u00e9 Cache) is kept while it is disconnected.')}
                    ${ui.sub(`${i.connectionName} Status`)}<div data-f="facts"></div>`;
                ui.bindCombo(el.querySelector('[data-act="idle"]'), IDLE_CHOICES, d.idle, (v) => { d.idle = v; });
                const on = el.querySelector('input[data-k="cafe-on"]');
                if (on) on.addEventListener('change', () => { d.cafeOn = on.checked; });
                const facts = el.querySelector('[data-f="facts"]');
                const paint = () => { const h = ui.facts(connectionFacts()); if (facts.innerHTML !== h) facts.innerHTML = h; };
                paint();
                liveTick(el, paint);
                return;
            }
            // the figures come from the app's last interfaces read; its push redraws them (never a read per tick)
            const follow = (paint) => {
                const onIfaces = () => { if (!el.isConnected) { root.removeEventListener('androidnetifaces', onIfaces); return; } readIfaces(true); paint(); };
                root.addEventListener('androidnetifaces', onIfaces);
                paint();
                liveTick(el, paint);
            };
            const factsBox = (rowsFn) => {
                const facts = el.querySelector('[data-f="facts"]');
                follow(() => { const h = ui.facts(rowsFn()); if (facts.innerHTML !== h) facts.innerHTML = h; });
            };
            if (typeof d.adapter === 'string' && d.adapter.startsWith('if:')) {
                // Wi-Fi or the cellular data link: what the phone's own adapter has now
                const key = d.adapter.slice(3);
                const find = () => rows().find((x) => (x.alias || x.name) === key) || null;
                readIfaces(true);
                const x0 = find();
                // (#1038) the Wi-Fi adapter: WM's IP Address / Name Servers pages (and the proxy) for the network in use
                if (wf && x0 && x0.kind === 'wifi') { d.wifiAdapter = true; wf.renderAdapter(el, d, api, x0); return; }
                setHeader(el, x0 ? x0.label : key);
                el.innerHTML = `${ui.sub('Status')}<div data-f="facts"></div>
                    ${ui.note('Android assigns this adapter its address. Tap ok to return to the adapter list.')}`;
                factsBox(() => ifaceFacts(find()));
                return;
            }
            if (typeof d.adapter === 'string' && d.adapter.startsWith('share:')) {
                // a sharing interface: on or off, its interface and the address it gives this phone on that link
                const k = d.adapter.slice(6);
                const label = (SHARES.find(([id]) => id === k) || [k, k])[1];
                readIfaces(true);
                setHeader(el, label);
                el.innerHTML = `${ui.sub('Status')}<div data-f="facts"></div>
                    ${ui.note(k === 'hotspot' ? 'Mobile Hotspot is turned on and off in Quick Access or in Android\'s settings.' : 'Shown while this phone shares its connection this way.')}`;
                factsBox(() => { const x = shareRow(k); return ifaceFacts(x && x.sharing ? x : null, shareStatus(k, x)); });
                return;
            }
            if (typeof d.adapter === 'string' && d.adapter.startsWith('wg:')) {
                // a WireGuard tunnel: its status, address and time, Connect / Disconnect through the app
                const name = d.adapter.slice(3);
                readIfaces(true);
                setHeader(el, vpnLabel(name));
                // the automatic connection rule, a draft until ok (WM saves a page with ok)
                if (!d.auto) {
                    const a = vpnEntry(name).auto || {};
                    d.auto = { mode: a.mode || 'manual', when: a.when || 'on', ssids: (a.ssids || []).join(', '), cidrs: (a.cidrs || []).join(', ') };
                }
                const label = (list, v) => (list.find(([k]) => k === v) || list[0])[1];
                const rule = d.auto.mode === 'wifi'
                    ? `${ui.comboHtml('auto-when', label(AUTO_WIFI, d.auto.when))}<div class="wm-form-row is-wide">${ui.edit('auto-ssids', d.auto.ssids, 'data-k="ssids" placeholder="Network names, separated by commas"')}</div>`
                    : d.auto.mode === 'ip'
                        ? `${ui.comboHtml('auto-when', label(AUTO_IP, d.auto.when))}<div class="wm-form-row is-wide">${ui.edit('auto-cidrs', d.auto.cidrs, 'data-k="cidrs" placeholder="e.g. 192.168.100.0/24, 10.0.0.0/8"')}</div>`
                        : '';
                el.innerHTML = `${ui.sub('Status')}<div data-f="facts"></div>
                    ${ui.buttons([['wg-toggle', 'Connect']])}
                    ${ui.sub('Connect automatically')}
                    ${ui.comboHtml('auto-mode', label(AUTO_MODES, d.auto.mode))}
                    ${rule}
                    ${ui.note(d.auto.mode === 'wifi' ? 'Connects while the rule holds and disconnects when it no longer does. Network names are as Wi-Fi shows them.'
                        : d.auto.mode === 'ip' ? 'Checks this phone\'s own address on Wi-Fi, mobile data or Ethernet (not the VPN\'s). Connects while the rule holds and disconnects when it no longer does.'
                        : d.auto.mode === 'always' ? 'Connected whenever this phone has a network.' : 'The tunnel runs in the WireGuard app; Melaton switches it there.')}`;
                ui.bindCombo(el.querySelector('[data-act="auto-mode"]'), AUTO_MODES, d.auto.mode, (v) => { d.auto.mode = v; api.rerender(); });
                const whenBtn = el.querySelector('[data-act="auto-when"]');
                if (whenBtn) ui.bindCombo(whenBtn, d.auto.mode === 'wifi' ? AUTO_WIFI : AUTO_IP, d.auto.when, (v) => { d.auto.when = v; });
                el.querySelectorAll('input[data-k]').forEach((inp) => inp.addEventListener('input', () => { d.auto[inp.dataset.k] = inp.value; }));
                const btn = el.querySelector('[data-act="wg-toggle"]');
                factsBox(() => {
                    const x = wgRow(name);
                    const up = !!(x && x.connected);
                    if (btn) { const t = up ? 'Disconnect' : 'Connect'; if (btn.textContent !== t) btn.textContent = t; }
                    return ifaceFacts(x, up ? 'Connected' : 'Disconnected');
                });
                if (btn) btn.addEventListener('click', () => {
                    const x = wgRow(name);
                    btn.disabled = true;
                    wgControl(name, !(x && x.connected));
                    setTimeout(() => { btn.disabled = false; }, 2500);
                });
                return;
            }
            if (typeof d.adapter === 'string' && d.adapter.startsWith('vpn:')) {
                // another VPN app's tunnel: read only, switched in its own app
                const iface = d.adapter.slice(4);
                readIfaces(true);
                const x0 = rows().find((x) => x.name === iface) || {};
                setHeader(el, x0.vpnSession || x0.vpnApp || 'VPN');
                el.innerHTML = `${ui.sub('Status')}<div data-f="facts"></div>${ui.buttons([['vpn-open', `Open ${x0.vpnApp || 'VPN app'}`]])}`;
                const ob = el.querySelector('[data-act="vpn-open"]');
                if (ob) ob.addEventListener('click', () => { const h = wifiHost(); if (h && typeof h.openVpnApp === 'function') { try { h.openVpnApp(iface); } catch (_) { /* older app */ } } });
                factsBox(() => ifaceFacts(rows().find((x) => x.name === iface) || null));
                return;
            }
            d.adapter = false;
            setHeader(el, 'Configure Network Adapters');
            readIfaces(true);
            el.innerHTML = `<p>My network card connects to:</p>
                ${ui.comboHtml('to', i.domain, true)}
                <p class="wm-setc-gap-top">Tap an adapter to modify settings:</p>
                ${ui.listbox(adapters(i, mp), { maxHeight: 238 })}`;
            el.querySelector('.wm-listbox').classList.add('wm-setc-adapters');
            ui.bindListbox(el.querySelector('.wm-listbox'), (key) => { if (!key) return; d.adapter = key; api.rerender(); if (root.wmShell && root.wmShell.refreshSoftKeys) root.wmShell.refreshSoftKeys(); });
            // an adapter coming or going (a tunnel up, the hotspot on): the list again
            let listKey = JSON.stringify(adapters(i, mp).map((a) => a.key));
            const onList = () => {
                if (!el.isConnected || d.adapter) { root.removeEventListener('androidnetifaces', onList); return; }
                readIfaces(true);
                const k = JSON.stringify(adapters(info(), mcx && typeof mcx.miniport === 'function' ? mcx.miniport() : null).map((a) => a.key));
                if (k !== listKey) { listKey = k; api.rerender(); }
            };
            root.addEventListener('androidnetifaces', onList);
        },
        softKeys(d) {
            if (d.tab === 'nc-wireless' && root.wmWifi && d.wifi) return root.wmWifi.softKeys(d.wifi) || { left: null, right: null };
            // Menu: add a WireGuard tunnel by name, or on a tunnel's page remove it
            const wgName = typeof d.adapter === 'string' && d.adapter.startsWith('wg:') ? d.adapter.slice(3) : null;
            const cfg = qaConfig();
            const added = !!(wgName && cfg && (cfg.wireguard || []).includes(wgName));
            const items = [];
            if (!d.adapter && qaHost()) items.push({ label: 'Add WireGuard Tunnel...', action: () => addTunnel(d.rerender) });
            if (wgName) items.push({ label: 'Rename...', action: () => renameTunnel(wgName, d.rerender) });
            if (wgName) items.push({ label: 'Remove Tunnel', disabled: !added, action: () => { setWgList((cfg.wireguard || []).filter((x) => x !== wgName)); root.dispatchEvent(new CustomEvent('wmvpnconfig')); d.auto = null; d.adapter = false; if (d.rerender) d.rerender(); if (root.wmShell && root.wmShell.refreshSoftKeys) root.wmShell.refreshSoftKeys(); } });
            if (!d.adapter || wgName) items.push({ label: 'Open WireGuard', action: () => { const h = wifiHost(); const x = rows().find((r) => r.vpnPackage === WIREGUARD); if (h && typeof h.openVpnApp === 'function' && x) { try { h.openVpnApp(x.name); } catch (_) { /* older app */ } } } });
            return { left: null, right: items.length ? { label: 'Menu', menu: () => items } : null };
        },
        commit(d) {
            const wf = root.wmWifi;
            // (#1038) the Wireless tab: ok on its wizard / Advanced goes back to its list; on the list it closes
            if (d.tab === 'nc-wireless' && wf && d.wifi && wf.commit(d.wifi) === false) return false;
            // the Wi-Fi adapter's IP pages: saved through the app (false while a value is not valid)
            if (d.wifiAdapter && wf) {
                return Promise.resolve(wf.commitAdapter(d)).then((saved) => {
                    if (!saved) return false;
                    d.wifiAdapter = false;
                    d.adapter = false;
                    if (d.rerender) d.rerender();
                    if (root.wmShell && root.wmShell.refreshSoftKeys) root.wmShell.refreshSoftKeys();
                    return false;
                });
            }
            if (wf) wf.stop();
            // ok on the adapter's page goes back to the list, as on the device
            if (d.adapter) {
                const mcx = root.melatonContinuity;
                if (typeof d.adapter === 'string' && d.adapter.startsWith('as:') && d.ring != null && mcx && typeof mcx.setMiniportConfig === 'function') mcx.setMiniportConfig({ wakeOnRing: d.ring });
                if (d.adapter === 'cafe' && mcx && typeof mcx.setMiniportConfig === 'function') {
                    const set = {};
                    if (d.idle != null) set.idleMinutes = d.idle;
                    if (d.cafeOn != null) set.enabled = d.cafeOn;
                    mcx.setMiniportConfig(set);
                }
                if (typeof d.adapter === 'string' && d.adapter.startsWith('wg:') && d.auto) {
                    const t = d.adapter.slice(3);
                    const split = (v) => String(v || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
                    saveVpnEntry(t, { name: vpnLabel(t), auto: { mode: d.auto.mode, when: d.auto.when, ssids: split(d.auto.ssids), cidrs: split(d.auto.cidrs) } });
                }
                d.auto = null;
                d.idle = null;
                d.cafeOn = null;
                d.ring = null;
                d.adapter = false;
                if (d.rerender) d.rerender();
                if (root.wmShell && root.wmShell.refreshSoftKeys) root.wmShell.refreshSoftKeys();
                return false;
            }
            return [];
        }
    });

    // ---------------------------------------------------------------- Nightshade Network (#895)
    // The service the Dreamscape link is: its own applet with the service's icon, as a deeply
    // integrated Windows service. Status from websocket.js nightshadeState.

    // (Nov 20 2026) the real issue: no Internet, the server out of reach, or Dreamscape restarting (wmShell's words)
    const NS_STATUS = { connected: 'Connected', connecting: 'Connecting...', restarting: 'Services not available', 'signed-out': 'Sign-in required', off: 'Disconnected', 'no-internet': 'No Internet access', unavailable: 'Cannot connect to the server' };
    const NS_PROBLEM = {
        unavailable: 'Cannot connect to the Nightshade server. The phone is online, but the server does not answer. Nightshade will keep trying.',
        restarting: 'Nightshade services are not available at this time. The server is restarting; some features and services may not be accessible until it is ready.',
        'no-internet': 'No Internet access. Nightshade connects again as soon as the phone is back online.',
        'signed-out': 'Sign in to Nightshade Network to get your mail, messages and programs.'
    };
    function nsState() {
        const c = ws();
        try { if (c && typeof c.nightshadeState === 'function') return c.nightshadeState(); } catch (_) { /* below */ }
        return { service: 'unavailable', problem: true, cafeReady: false, connectedAt: null, rtt: null };
    }
    function nsStatusText(s) {
        return s.service === 'connected' && s.cafeReady ? 'Connected (with Caf\u00e9Ready)' : NS_STATUS[s.service] || 'Unavailable';
    }
    function accountName() {
        const a = root.meletonAccounts;
        try { if (a && typeof a.name === 'function' && a.name()) return a.name(); } catch (_) { /* below */ }
        try { return root.localStorage.getItem('username') || '\u2014'; } catch (_) { return '\u2014'; }
    }

    // Authentication: the device's client certificate (docs/client-certificates.md) - what the server says of
    // it (accepted, valid until, renewal) and how well the device keeps its key. Read when the tab opens.
    const NS_KEY_PROTECTION = {
        strongbox: { kind: 'Hardware-backed', where: 'StrongBox secure element', level: 4,
            text: 'The private key was made in a separate security chip and can never leave it.' },
        tee: { kind: 'Hardware-backed', where: 'Trusted Execution Environment', level: 3,
            text: "The private key was made in the processor's secure area and can never leave it." },
        software: { kind: 'Software-backed', where: 'Android Keystore (software)', level: 2,
            text: 'The private key is protected by the operating system only.' },
        file: { kind: 'Unprotected', where: 'Key file on the data disk', level: 1,
            text: 'Anyone with access to the disk could copy the private key.' }
    };
    const NS_RATING = ['', 'Weak', 'Moderate', 'Strong', 'Very strong'];
    function nsDeviceCert() {
        const b = root.AndroidClientCert;
        if (!b || typeof b.getState !== 'function') return null;
        try { const v = b.getState(); return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; }
    }
    function nsDate(ms) {
        if (!ms) return '—';
        try { return new Date(Number(ms)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return '—'; }
    }
    function nsServerStatus(info) {
        if (!info) return 'Unknown (server not reachable)';
        if (info.session === undefined) return 'Unknown (server update pending)';
        const c = info.certificate;
        if (!c) return 'Not recognised';
        if (c.status === 'revoked') return `Revoked${c.revokeReason ? ` (${c.revokeReason})` : ''}`;
        if (c.status === 'expired') return 'Expired';
        return c.renew ? 'Accepted (renewal due)' : 'Accepted';
    }
    function renderNsAuth(el, d) {
        const dev = nsDeviceCert();
        const serial = dev && dev.enrolled ? String(dev.serial || '') : '';
        const paint = () => {
            const info = d.authInfo && d.authInfo.serial === serial ? d.authInfo.data : null;
            const c = info && info.certificate;
            if (!dev && !c) {
                el.innerHTML = ui.note(root.AndroidClientCert === undefined
                    ? 'This device has no client certificate. Certificates are issued to the Dreamscape app and DreamOS.'
                    : 'Checking this device’s certificate...');
                return;
            }
            if (dev && !dev.enrolled && !c) {
                el.innerHTML = `${ui.note('This device has no client certificate yet. It gets one the next time you sign in with your PIN.')}${dev.last ? ui.facts([['Last event:', dev.last]]) : ''}`;
                return;
            }
            const ks = (dev && dev.keyStore) || (c && c.keyStore) || '';
            const prot = NS_KEY_PROTECTION[ks] || null;
            const algoLevel = 4; // ECDSA P-256 / SHA-256: 128-bit security, as RSA 3072
            const overall = prot ? Math.min(algoLevel, prot.level) : 0;
            const rows = [
                ['Issued to:', (c && c.deviceName) || '—'],
                ['Issued by:', (c && c.issuer) || 'Dreamscape Client CA'],
                ['Valid from:', nsDate(c && c.notBefore)],
                ['Valid to:', nsDate((c && c.notAfter) || (dev && dev.notAfter))],
                ['Serial number:', String((c && c.serial) || serial).replace(/(.{4})(?=.)/g, '$1 ')]
            ];
            const server = [
                ['Status:', nsServerStatus(d.authInfo ? info : null)],
                ['This session:', info && info.session !== undefined ? (info.session === 'certificate' ? 'Signed in with this certificate' : 'Signed in another way') : '—']
            ];
            if (c && c.renew && c.status === 'issued') server.push(['Renewal:', 'Renews automatically on the next connection']);
            if (c && c.lastUsedAt) server.push(['Last used:', nsDate(c.lastUsedAt)]);
            const protection = [
                ['Protection:', prot ? prot.kind : 'Unknown'],
                ['Key storage:', prot ? prot.where : '—'],
                ['Key type:', 'ECDSA P-256, SHA-256'],
                ['Key strength:', '128-bit (as RSA 3072)'],
                ['Security:', overall ? NS_RATING[overall] : 'Unknown']
            ];
            el.innerHTML = `${ui.sub('Client certificate')}${ui.facts(rows)}${ui.sub('Server')}${ui.facts(server)}${ui.sub('Key protection')}${ui.facts(protection)}${prot ? `<p>${esc(prot.text)}</p>` : ''}`;
        };
        paint();
        // one read when the tab opens (a minute's grace between tab switches); no polling
        if (!d.authInfo || d.authInfo.serial !== serial || Date.now() - d.authInfo.at > 60000) {
            const url = '/api/client-cert/mine' + (serial ? `?serial=${encodeURIComponent(serial)}` : '');
            fetch(url, { credentials: 'same-origin', cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null)
                .then((data) => {
                    d.authInfo = { serial, at: Date.now(), data: data && data.success ? data : null };
                    if (el.isConnected) paint();
                });
        }
    }

    wmSettings.registerPage({
        id: 'nightshade',
        tab: 'connections',
        label: 'Nightshade',
        icon: 'set-nightshade',
        tabs: [['ns-general', 'General'], ['ns-cafe', 'Caf\u00e9Ready'], ['ns-auth', 'Authentication'], ['ns-advanced', 'Advanced']],
        init() {
            const mcx = root.melatonContinuity;
            const cfg = mcx && mcx.miniportConfig ? mcx.miniportConfig() : null;
            const mp = mcx && typeof mcx.miniport === 'function' ? mcx.miniport() : null;
            return {
                idle: cfg && cfg.config && cfg.config.idleMinutes != null ? Number(cfg.config.idleMinutes) : 10,
                cafeOn: !(mp && mp.enabled === false),
                cafeTouched: false
            };
        },
        render(el, tab, d, api) {
            el.classList.add('wm-setc');
            d.rerender = api.rerender;
            setHeader(el, 'Nightshade Network');
            const mcx = root.melatonContinuity;
            const mp = mcx && typeof mcx.miniport === 'function' ? mcx.miniport() : null;
            if (tab === 'ns-cafe') {
                const cur = IDLE_CHOICES.find(([v]) => v === d.idle) || [d.idle, `${d.idle} minutes`];
                const has = !!(mp && mp.present);
                el.innerHTML = `<div class="wm-cafe-badge" role="img" aria-label="Powered by Caf\u00e9Ready"><span class="wm-cafe-by">Powered by</span><img src="/static_images/melaton/cafe-ready-dark.png" alt="" draggable="false"><span class="wm-cafe-tm">\u2122</span></div>
                    <p>Caf\u00e9Ready lays a cache and its own connection over the Nightshade Network: windows keep their data and stay connected while one restarts.</p>
                    ${has ? ui.check('ns-cafe-on', 'Use Melaton Caf\u00e9 Miniport', d.cafeOn, 'data-k="ns-cafe-on"') : ui.note('This device has no Melaton Caf\u00e9 Miniport. Caf\u00e9Ready needs the Dreamscape app.')}
                    ${has ? `${ui.sub('Idle timeout')}<p>Disconnect the Miniport when no program has used it for:</p>${ui.comboHtml('ns-idle', cur[1])}` : ''}
                    ${ui.facts([['Caf\u00e9Ready:', nsState().cafeReady ? 'Active' : has && d.cafeOn ? 'Standing by' : 'Off']])}`;
                const on = el.querySelector('input[data-k="ns-cafe-on"]');
                if (on) on.addEventListener('change', () => { d.cafeOn = on.checked; d.cafeTouched = true; });
                const combo = el.querySelector('[data-act="ns-idle"]');
                if (combo) ui.bindCombo(combo, IDLE_CHOICES, d.idle, (v) => { d.idle = v; d.cafeTouched = true; });
                return;
            }
            if (tab === 'ns-auth') {
                renderNsAuth(el, d);
                return;
            }
            if (tab === 'ns-advanced') {
                el.innerHTML = `<div data-f="facts"></div>${ui.sub('Domain controller')}<div data-f="server"></div>`;
                const facts = el.querySelector('[data-f="facts"]');
                const server = el.querySelector('[data-f="server"]');
                const paint = () => {
                    const a = ui.facts(connectionFacts()); if (facts.innerHTML !== a) facts.innerHTML = a;
                    const b = ui.facts(serverFacts()); if (server.innerHTML !== b) server.innerHTML = b;
                };
                paint();
                liveTick(el, paint);
                if (Date.now() - statusAt >= STATUS_POLL_MS) pollStatus().then(() => { if (el.isConnected) paint(); });
                return;
            }
            // General: the service's status, the account, Connect / Disconnect
            el.innerHTML = `<div class="wm-setc-ns-head">${root.wmShell && root.wmShell.art ? root.wmShell.art.img('set-nightshade') : ''}<b data-f="status"></b></div>
                <div data-f="facts"></div><div data-f="note"></div><div data-f="buttons"></div>`;
            const status = el.querySelector('[data-f="status"]');
            const facts = el.querySelector('[data-f="facts"]');
            const note = el.querySelector('[data-f="note"]');
            const buttons = el.querySelector('[data-f="buttons"]');
            const paint = () => {
                const s = nsState();
                const st = esc(nsStatusText(s)); if (status.innerHTML !== st) status.innerHTML = st;
                const rows = [['Account:', accountName()]];
                if (s.service === 'connected' && s.connectedAt) rows.push(['Duration:', formatDuration(Date.now() - s.connectedAt)]);
                const a = ui.facts(rows); if (facts.innerHTML !== a) facts.innerHTML = a;
                const n = NS_PROBLEM[s.service] ? ui.note(NS_PROBLEM[s.service]) : ''; if (note.innerHTML !== n) note.innerHTML = n;
                const up = s.service === 'connected' || s.service === 'connecting';
                const b = ui.buttons([up ? ['ns-disconnect', 'Disconnect'] : ['ns-connect', s.service === 'signed-out' ? 'Sign In' : 'Connect']]);
                if (buttons.innerHTML !== b) buttons.innerHTML = b;
            };
            buttons.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-act]');
                if (!btn) return;
                // Sign In (#899): the phone's password box; Connect: dial again
                if (btn.dataset.act === 'ns-connect') {
                    if (nsState().service === 'signed-out' && root.wmShell && root.wmShell.nightshadeSignIn) void root.wmShell.nightshadeSignIn();
                    else connect();
                }
                else if (btn.dataset.act === 'ns-disconnect') disconnect();
                setTimeout(paint, 50);
            });
            paint();
            liveTick(el, paint);
        },
        commit(d) {
            const mcx = root.melatonContinuity;
            if (d.cafeTouched && mcx && typeof mcx.setMiniportConfig === 'function') mcx.setMiniportConfig({ idleMinutes: d.idle, enabled: d.cafeOn });
            return [];
        }
    });

    // ---------------------------------------------------------------- Continuity (#798)
    // The Continuity PC (this phone's DeX window): what happens when its display is unplugged. The desktop pauses and resumes
    // on a display connected again; after the time chosen here the app shuts it down (#1015, Miniport desktopShutdownMinutes).
    const SHUTDOWN_CHOICES = [[5, 'After 5 minutes'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour'], [0, 'Never']];
    // Alt+Tab to a Melaton window on the Continuity PC minimises the Android windows shown there (#1064). The phone's and
    // the DeX window's pages share one localStorage (same app, same WebView profile): keyboardShortcuts.js reads it at
    // the moment Alt+Tab picks a window, so a change applies at once with no server or bus message. Unset = on.
    const ALTTAB_MIN_KEY = 'melatonDexAltTabMinimizeAndroid';
    const altTabMinOn = () => { try { return localStorage.getItem(ALTTAB_MIN_KEY) !== '0'; } catch (_) { return true; } };

    wmSettings.registerPage({
        id: 'continuity',
        tab: 'connections',
        label: 'Continuity',
        icon: 'set-usb',
        tabs: [],
        available: () => !!(root.melatonContinuity && root.melatonContinuity.available),
        init() {
            const mcx = root.melatonContinuity;
            const cfg = mcx && mcx.miniportConfig ? mcx.miniportConfig() : null;
            const c = cfg && cfg.config;
            // an app before #1015 has no time: its check box's meaning (off = keeps running = never)
            const min = c && c.desktopShutdownMinutes != null ? Number(c.desktopShutdownMinutes) : (c && c.autoCloseDesktop ? 5 : 0);
            return { shutdown: SHUTDOWN_CHOICES.some(([v]) => v === min) ? min : 15, was: min, altTabMin: altTabMinOn() };
        },
        render(el, tab, d) {
            el.classList.add('wm-setc');
            setHeader(el, 'Continuity');
            const mcx = root.melatonContinuity;
            const pc = mcx && typeof mcx.continuityPc === 'function' ? mcx.continuityPc() : null;
            // short enough for the facts row (one line, cut with an ellipsis); the Continuity PC popup says it in full
            const state = !pc ? 'Not connected' : pc.displayGone ? (pc.parked ? 'Paused - no display' : 'Running - no display') : pc.state === 'ready' ? `Connected via ${pc.attach === 'wireless' ? 'Wi-Fi Direct' : 'USB-C'}` : 'Starting';
            const cur = SHUTDOWN_CHOICES.find(([v]) => v === d.shutdown) || SHUTDOWN_CHOICES[1];
            el.innerHTML = `<p>A display, dock or computer screen connected to this phone runs the Melaton desktop from it: the Continuity PC.</p>
                ${ui.facts([['Continuity PC:', state], ...(pc && pc.width ? [['Display:', `${pc.width} \u00d7 ${pc.height}`]] : [])])}
                ${ui.sub('Display disconnected')}<p>When the display is disconnected, the desktop pauses with its programs open and resumes when a display is connected again. Shut down the desktop when no display is connected:</p>
                ${ui.comboHtml('dex-shutdown', cur[1])}
                ${ui.sub('Windows')}
                ${ui.check('dexAltTabMin', 'Alt+Tab: selecting a Melaton window minimises all Android windows on the desktop', d.altTabMin)}`;
            ui.bindCombo(el.querySelector('[data-act="dex-shutdown"]'), SHUTDOWN_CHOICES, d.shutdown, (v) => { d.shutdown = v; });
            el.querySelector('input[name="dexAltTabMin"]').addEventListener('change', (e) => { d.altTabMin = e.target.checked; });
        },
        commit(d) {
            const mcx = root.melatonContinuity;
            if (d.shutdown !== d.was && mcx && typeof mcx.setMiniportConfig === 'function') mcx.setMiniportConfig({ desktopShutdownMinutes: d.shutdown });
            if (d.altTabMin === altTabMinOn()) return [];
            try { localStorage.setItem(ALTTAB_MIN_KEY, d.altTabMin ? '1' : '0'); } catch (_) { return []; }
            return [ALTTAB_MIN_KEY];
        }
    });

    // ---------------------------------------------------------------- Domain Enroll

    wmSettings.registerPage({
        id: 'domain',
        tab: 'connections',
        label: 'Domain Enroll',
        icon: 'set-domain',
        tabs: [],
        available: () => typeof root.persistUserGlobalSettingsPatch === 'function',
        init() {
            const i = info();
            return { domain: i.domain, connection: i.connectionName, was: { domain: i.domain, connection: i.connectionName } };
        },
        render(el, tab, d) {
            el.classList.add('wm-setc');
            setHeader(el, 'Domain Enrollment');
            const state = linkState();
            const dom = ui.uid('wmDomName');
            const con = ui.uid('wmConName');
            el.innerHTML = `<p>This device is enrolled in the domain of its Dreamscape server. The network name shows in the logon dialogs and on the lock screen; the connection name shows in Connecting and Connect.</p>
                <div class="wm-setc-enroll">
                    <b>Device Status:</b><span>${esc(state === 'connected' ? 'Enrolled, connected' : `Enrolled, ${accessText(state).toLowerCase()}`)}</span>
                    <label for="${dom}"><b>Domain:</b></label>${ui.edit(dom, d.domain, 'maxlength="64" spellcheck="false" data-k="domain"')}
                    <label for="${con}"><b>Connection Name:</b></label>${ui.edit(con, d.connection, 'maxlength="64" spellcheck="false" data-k="connection"')}
                    <b>Server Name:</b><span>${esc(info().fqdn)}</span>
                </div>`;
            el.querySelectorAll('input[data-k]').forEach((inp) => inp.addEventListener('input', () => { d[inp.dataset.k] = inp.value; }));
        },
        async commit(d) {
            const domain = String(d.domain || '').trim().slice(0, 64);
            const connection = String(d.connection || '').trim().slice(0, 64);
            // melatonControlPanel.js NAME_MODES: the same messages
            if (!domain) { await ui.messageBox({ title: 'Domain Enroll', icon: 'warning', text: 'Type a network name.' }); return false; }
            if (!connection) { await ui.messageBox({ title: 'Domain Enroll', icon: 'warning', text: 'Type a connection name.' }); return false; }
            const patch = {};
            if (domain !== d.was.domain) patch.domainName = domain;
            if (connection !== d.was.connection) patch.connectionName = connection;
            if (!Object.keys(patch).length) return [];
            try {
                // persistUserGlobalSettingsPatch: public/scripts/comp/modalUtils.js (config.json
                // userGlobalSettings.desktop.domainName / connectionName)
                await root.persistUserGlobalSettingsPatch({ desktop: patch });
            } catch (err) {
                const which = patch.domainName ? 'The network name could not be saved.' : 'The connection name could not be saved.';
                await ui.messageBox({ title: 'Domain Enroll', icon: 'error', text: `${which} ${err && err.message ? err.message : ''}`.trim() });
                return false;
            }
            const client = ws();
            if (client && client.melatonConnection) {
                client.melatonConnection = {
                    ...client.melatonConnection,
                    ...(patch.domainName ? { domain: patch.domainName } : {}),
                    ...(patch.connectionName ? { connectionName: patch.connectionName } : {})
                };
            }
            if (client && typeof client._updateModemTrayIcon === 'function') client._updateModemTrayIcon();
            return [];
        }
    });

    // ---------------------------------------------------------------- Wireless Manager
    // WM 6.1's Wireless Manager (#735): All, Wi-Fi, Bluetooth, Phone (shellres 18304-18307, glyph strips
    // bmp 18257 off / 18258 on), states Off / On (18279 / 18280), Menu: "%1 Settings" (18273) and
    // Disconnect Cellular Data (18281). The phone's radios come from the Android app
    // (window.AndroidDevice, DSApp DeviceControl: Shizuku when allowed, else Android's panels);
    // the Dreamscape connection stays as the last row.

    const device = () => (root.AndroidDevice && typeof root.AndroidDevice.getRadios === 'function' ? root.AndroidDevice : null);
    function radios() {
        const dv = device();
        if (!dv) return null;
        try { return JSON.parse(dv.getRadios()); } catch (_) { return null; }
    }
    // WM's four, then NFC (Melaton's own row: WM 6.1 had none; glyph = the NFC N mark in the ROM style)
    const RADIO_ROWS = [['all', 'All'], ['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['phone', 'Phone'], ['nfc', 'NFC']];
    function radioOn(r, id) {
        if (!r) return null;
        if (id === 'wifi') return !!r.wifi;
        if (id === 'bluetooth') return !!r.bluetooth;
        if (id === 'phone') return !r.airplane;
        if (id === 'nfc') return r.nfc == null ? null : !!r.nfc;
        return (!r.airplane) || !!r.wifi || !!r.bluetooth; // All: On while any radio is
    }
    function radioPresent(r, id) {
        if (!r) return false;
        const p = r.present || {};
        if (id === 'wifi') return p.wifi !== false;
        if (id === 'bluetooth') return p.bluetooth !== false;
        if (id === 'phone') return p.phone !== false;
        if (id === 'nfc') return p.nfc === true;
        return true;
    }
    function setRadio(name, on) {
        const dv = device();
        if (!dv) return;
        try { dv.setRadio(name, !!on); } catch (_) { /* older app */ }
    }
    function switchRadio(r, id) {
        const on = radioOn(r, id);
        if (id === 'wifi' || id === 'bluetooth' || id === 'nfc') setRadio(id, !on);
        else if (id === 'phone') setRadio('airplane', on); // the phone radio off = flight mode
        else if (on) { setRadio('wifi', false); setRadio('bluetooth', false); setRadio('airplane', true); }
        else { setRadio('airplane', false); setRadio('wifi', true); setRadio('bluetooth', true); }
    }
    function openAndroidSettings(name) {
        const dv = device();
        if (dv && typeof dv.openSettings === 'function') { try { dv.openSettings(name); } catch (_) { /* older app */ } }
    }
    const glyph = (id, on) => ui.art(`wrls-${id}-${on ? 'on' : 'off'}`);
    /** WireGuard's Quick Access state ({ on, sub, why, available }), or null without the app's bridge or WireGuard. */
    function wgState() {
        const h = qaHost();
        if (!h || typeof h.get !== 'function') return null;
        try {
            const w = (JSON.parse(h.get()).items || {}).wireguard;
            return w && w.why !== 'app' ? w : null;
        } catch (_) { return null; }
    }

    /**
     * The connected Wi-Fi network's name for the Wi-Fi state: read once on demand while Wireless Manager
     * is open (AndroidDevice.getWifiName, precise location), so location is not in use all session.
     */
    function wifiName() {
        const dv = device();
        if (dv && typeof dv.getWifiName === 'function') {
            try { return dv.getWifiName() || null; } catch (_) { return null; }
        }
        const st = root.AndroidDeviceStatus;
        if (!st || typeof st.getState !== 'function') return null;
        try {
            const s = JSON.parse(st.getState());
            const w = s && s.wifi;
            return w && typeof w.ssid === 'string' && w.ssid ? w.ssid : null;
        } catch (_) { return null; }
    }
    function radioState(r, id) {
        const on = radioOn(r, id);
        if (on == null) return '';
        if (id === 'wifi' && on) return wifiName() || 'On';
        return on ? 'On' : 'Off';
    }

    // Layout from WM 6.1 itself (Yukimi's emulator, Nov 10): All on a full-width bar, the radios in a
    // rounded panel under it, each a bar (name left, glyph right, white) with its state in a white box
    // under the bar's right half; Done | Menu; X in the title bar.
    wmSettings.registerPage({
        id: 'wireless',
        tab: 'connections',
        label: 'Wireless Manager',
        icon: 'set-wireless',
        tabs: [],
        titleKind: () => 'close',
        init: () => ({ busy: false, pending: {} }),
        softKeys(d) {
            const r = radios();
            const canOpen = !!(device() && typeof device().openSettings === 'function');
            return {
                left: { label: 'Done', action: () => root.history.back() },
                right: {
                    label: 'Menu',
                    menu: () => [
                        { label: 'Phone Settings', disabled: !canOpen, action: () => openAndroidSettings('phone') },
                        // our own Settings > Bluetooth, not Android's (Yukimi, Nov 21 2026)
                        { label: 'Bluetooth Settings', action: () => { const ws = root.wmSettings; if (!(ws && typeof ws.open === 'function' && ws.open('bluetooth'))) openAndroidSettings('bluetooth'); } },
                        // our own Settings > Network Cards > Wireless (#1038), Android's only on an app without it
                        { label: 'Wi-Fi Settings', disabled: !canOpen && !root.wmWifi, action: () => { if (!(root.wmWifi && root.wmWifi.available() && root.wmWifi.open())) openAndroidSettings('wifi'); } },
                        ...(r && r.present && r.present.nfc ? [{ label: 'NFC Settings', disabled: !canOpen, action: () => openAndroidSettings('nfc') }] : []),
                        { label: 'Disconnect Cellular Data', disabled: !(r && r.data && !r.airplane), action: () => setRadio('data', false) }
                    ]
                }
            };
        },
        render(el, tab, d, api) {
            el.classList.add('wm-setc');
            const r = radios();
            const rows = r ? RADIO_ROWS.filter(([id]) => id !== 'all' && radioPresent(r, id)) : [];
            const item = (attr, name) => `<div class="wm-wl-item"><button type="button" class="wm-wl-bar" ${attr}><span class="wm-wl-name">${esc(name)}</span><img class="wm-wl-glyph" alt="" draggable="false"></button><span class="wm-wl-state"></span></div>`;
            el.innerHTML = `<div class="wm-wl">
                    ${r ? `<button type="button" class="wm-wl-bar is-all" data-radio="all"><span class="wm-wl-name">All</span><img class="wm-wl-glyph" alt="" draggable="false"></button>` : ''}
                    <div class="wm-wl-panel${r ? '' : ' is-alone'}">
                        ${rows.map(([id, name]) => item(`data-radio="${id}"`, name)).join('')}
                        ${wgState() ? item('data-act="vpn"', 'VPN') : ''}
                        ${item('data-act="toggle"', 'Dreamscape')}
                    </div>
                    ${r ? '' : '<p class="wm-form-note">Phone, Wi-Fi and Bluetooth are switched here in the Dreamscape app for Android.</p>'}
                </div>`;
            const paintRadios = (now) => {
                el.querySelectorAll('[data-radio]').forEach((bar) => {
                    const id = bar.dataset.radio;
                    const on = radioOn(now, id);
                    const g = glyph(id, on);
                    const img = bar.querySelector('img');
                    if (img.getAttribute('src') !== g.src) { img.src = g.src; img.srcset = g.srcset; }
                    bar.classList.toggle('is-off', on === false);
                    bar.classList.toggle('is-busy', !!d.pending[id]);
                    const st = bar.parentElement.querySelector('.wm-wl-state');
                    if (st) { const t = radioState(now, id); if (st.textContent !== t) st.textContent = t; }
                });
            };
            paintRadios(r);
            // the Wi-Fi network's name needs precise location on Android 12+: asked once, here
            const dv = device();
            if (r && r.wifi && r.wifiNameAccess === false && dv && typeof dv.requestWifiNameAccess === 'function') {
                let asked = false;
                try { asked = localStorage.getItem('wmAskedWifiName') === '1'; } catch (_) { asked = true; }
                if (!asked) {
                    try { localStorage.setItem('wmAskedWifiName', '1'); } catch (_) { /* storage off */ }
                    try { dv.requestWifiNameAccess(); } catch (_) { /* older app */ }
                }
            }
            // tap and hold a bar: its settings (WM: hold for the item's context; Yukimi: like Wi-Fi settings)
            const holdOpens = (b, open) => {
                let timer = null;
                const cancel = () => { clearTimeout(timer); timer = null; };
                b.addEventListener('pointerdown', () => {
                    b._held = false;
                    cancel();
                    timer = setTimeout(() => { timer = null; b._held = true; open(); }, ((window.wmShell && window.wmShell.holdMs) || 600));
                });
                ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, cancel));
                b.addEventListener('contextmenu', (e) => e.preventDefault());
            };
            el.querySelectorAll('[data-radio]').forEach((b) => holdOpens(b, () => {
                // Wi-Fi's hold: our own Wi-Fi page (#1038); the others Android's
                if (b.dataset.radio === 'wifi' && root.wmWifi && root.wmWifi.available() && root.wmWifi.open()) return;
                openAndroidSettings(b.dataset.radio);
            }));
            el.querySelectorAll('[data-radio]').forEach((bar) => bar.addEventListener('click', () => {
                if (bar._held) { bar._held = false; return; }
                const id = bar.dataset.radio;
                if (d.pending[id]) return;
                d.pending[id] = true;
                switchRadio(radios(), id);
                paintRadios(radios());
                setTimeout(() => { d.pending[id] = false; if (el.isConnected) paintRadios(radios()); }, 4000);
            }));
            const onRadios = (e) => {
                if (!el.isConnected) { root.removeEventListener('dreamscape:radios', onRadios); return; }
                RADIO_ROWS.forEach(([id]) => { d.pending[id] = false; });
                paintRadios((e && e.detail) || radios());
                if (root.wmShell && typeof root.wmShell.refreshSoftKeys === 'function') root.wmShell.refreshSoftKeys();
            };
            root.addEventListener('dreamscape:radios', onRadios);
            // the Wi-Fi network's name arrives with the device status (precise location granted, network change)
            const onStatus = () => {
                if (!el.isConnected) { root.removeEventListener('androiddevicestatus', onStatus); return; }
                paintRadios(radios());
            };
            root.addEventListener('androiddevicestatus', onStatus);

            // (#1019) WireGuard: on with the tunnel's name, Off, or No tunnel (none added in Network Cards or seen up
            // yet); a tap switches it through the app, a hold opens its page in Network Cards
            const vbar = el.querySelector('[data-act="vpn"]');
            if (vbar) {
                const vImg = vbar.querySelector('img');
                const vState = vbar.parentElement.querySelector('.wm-wl-state');
                const vPaint = () => {
                    const w = wgState();
                    if (!w) return;
                    const g = glyph('vpn', !!w.on);
                    if (vImg.getAttribute('src') !== g.src) { vImg.src = g.src; vImg.srcset = g.srcset; }
                    const t = w.on ? (w.sub || 'On') : w.why === 'tunnel' ? 'No tunnel' : 'Off';
                    if (vState.textContent !== t) vState.textContent = t;
                    vbar.classList.toggle('is-off', !w.on);
                    vbar.classList.toggle('is-busy', !!d.pending.vpn);
                };
                vPaint();
                const onNet = () => { if (!el.isConnected) { root.removeEventListener('androidnetifaces', onNet); return; } d.pending.vpn = false; vPaint(); };
                root.addEventListener('androidnetifaces', onNet);
                const toCards = () => { const w = wgState(); d.pending.vpn = false; if (wmSettings.open) wmSettings.open('network-cards'); return w; };
                holdOpens(vbar, toCards);
                vbar.addEventListener('click', () => {
                    if (vbar._held) { vbar._held = false; return; }
                    const w = wgState();
                    if (!w || d.pending.vpn) return;
                    if (!w.on && w.why === 'tunnel') { toCards(); return; }
                    d.pending.vpn = true;
                    const h = qaHost();
                    try { h.act('wireguard', w.on ? 'off' : 'on'); } catch (_) { d.pending.vpn = false; }
                    vPaint();
                    setTimeout(() => { d.pending.vpn = false; if (el.isConnected) vPaint(); }, 6000);
                });
            }

            // the Dreamscape connection: the shell's connectivity glyph, Connected / Connecting... / Off
            const bar = el.querySelector('[data-act="toggle"]');
            const dsImg = bar.querySelector('img');
            dsImg.classList.add('is-white'); // the tray's connectivity art is white already (no invert)
            const stateEl = bar.parentElement.querySelector('.wm-wl-state');
            const paint = () => {
                const s = linkState();
                const on = s === 'connected';
                const art = ui.art(on ? 'status-data-on' : 'status-data-off');
                if (dsImg.getAttribute('src') !== art.src) { dsImg.src = art.src; dsImg.srcset = art.srcset; }
                const text = { connected: 'Connected', connecting: 'Connecting...', auth: 'Logon required', disconnected: 'Off' }[s];
                if (stateEl.textContent !== text) stateEl.textContent = text;
                bar.classList.toggle('is-off', s === 'disconnected');
                bar.classList.toggle('is-busy', s === 'connecting' || d.busy);
            };
            paint();
            liveTick(el, paint, 500);
            holdOpens(bar, () => { if (wmSettings.open) wmSettings.open('connections'); });
            bar.addEventListener('click', async () => {
                if (bar._held) { bar._held = false; return; }
                if (d.busy) return;
                const s = linkState();
                if (s === 'connected' || s === 'connecting') {
                    d.busy = true;
                    const yes = await ui.messageBox({
                        title: 'Wireless Manager',
                        icon: 'warning',
                        text: `Disconnect ${info().connectionName}? This phone loses the Dreamscape server until you connect again here.`,
                        buttons: [{ text: 'Disconnect', value: true }, { text: 'Cancel', value: false }]
                    });
                    d.busy = false;
                    if (yes) disconnect();
                } else {
                    connect();
                }
                if (el.isConnected) paint();
                setTimeout(() => { if (el.isConnected) api.rerender(); }, 1500);
            });
        }
    });

    // ---------------------------------------------------------------- Remote Access

    const METHODS = [
        ['detached', 'Detached requests: generate without Studio'],
        ['studio', 'Use the Studio app on the bound window (agents fill in Studio and press Generate)'],
        ['auto', 'Let the agent choose for each request (Studio when it is open, otherwise detached)']
    ];
    const OPEN_WITH = [
        ['ledge', 'Ledge', 'One desk that holds several prints.'],
        ['lumen', 'Lumen', 'A viewer window for each print.'],
        ['glancewell', 'Melaton Photo Gallery', 'The gallery slideshow, opened at the print.'],
        ['disabled', 'Do not open', 'Prints are saved to the gallery and nothing opens.']
    ];
    const PRINTS = [1, 2, 3, 4, 5, 6, 7, 8];

    /** remoteAccessProperties.js readState: modalUtils.js keeps the state as a classic-script global. */
    function remoteState() {
        // eslint-disable-next-line no-undef
        const st = typeof remoteAccessSettingsState !== 'undefined' && remoteAccessSettingsState ? remoteAccessSettingsState : {};
        const min = Number(st.minPrintsPerTurn) || 1;
        const max = Number(st.maxPrintsPerTurn) || 8;
        return {
            priority: typeof root.isAgentPriorityClient === 'function' && root.isAgentPriorityClient() === true,
            method: METHODS.some(([v]) => v === st.defaultGenerationMethod) ? st.defaultGenerationMethod : 'studio',
            autoGenerate: st.autoGenerate === true,
            openGenerated: OPEN_WITH.some(([v]) => v === st.openGeneratedImages) ? st.openGeneratedImages : 'ledge',
            minPrints: Math.min(8, Math.max(1, min)),
            maxPrints: Math.min(8, Math.max(1, max))
        };
    }

    // MCP (#831): the MCP Connector's addresses, read-only, each with Copy (remoteAccessProperties.js's
    // MCP Connector tab): the server's connector page, resolve_grimoire_url (modules/mcpServerInfo.js)
    const MCP_DSAP_URL = 'dsap://mcp.dreamscape.jp/';
    const MCP_FIELDS = [
        ['url', 'Connector URL:', 'connectorUrl'],
        ['mcp', 'MCP path:', 'mcpUrl'],
        ['authorize', 'Authorize URL:', 'oauthAuthorize'],
        ['token', 'Token URL:', 'oauthToken'],
        ['scopes', 'Scopes:', 'scopes'],
        ['recommended', 'Recommended:', 'recommendedScopes']
    ];
    const MCP_DEFAULT_SCOPES = 'generation gallery workspace chat';

    function loadMcp(d) {
        if (d.mcp) return;
        d.mcp = { loading: true, page: null };
        const client = ws();
        const p = client && typeof client.sendMessage === 'function'
            ? Promise.resolve(client.sendMessage('resolve_grimoire_url', { url: MCP_DSAP_URL }, false)).then((r) => (r && r.page && r.page.data ? r.page.data : null))
            : Promise.resolve(null);
        const sh = root.wmShell;
        if (sh && typeof sh.busy === 'function') sh.busy(p).catch(() => {});
        p.catch((err) => { console.warn('Remote Access: could not read the connector addresses', err); return null; })
            .then((page) => { d.mcp = { loading: false, page }; if (d.rerender) d.rerender(); });
    }

    async function copyText(text) {
        try {
            // eslint-disable-next-line no-undef
            if (typeof copyTextToClipboard === 'function') { await copyTextToClipboard(text); return true; }
            if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
        } catch (_) { /* the fallback below */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
        ta.remove();
        return ok;
    }

    function renderMcp(el, d) {
        loadMcp(d);
        el.classList.add('wm-setc-mcp');
        const page = d.mcp && d.mcp.page;
        const empty = d.mcp && d.mcp.loading ? '' : (page ? 'Not set up on this server' : 'Unavailable');
        el.innerHTML = `${ui.sub('Grok Custom Connector')}
            <p>In Grok, add a custom connector with these addresses. The path is unlisted; do not share it.</p>
            ${MCP_FIELDS.map(([id, label, key]) => {
                let value = (page && page[key]) || '';
                if (!value && key === 'scopes' && page) value = MCP_DEFAULT_SCOPES;
                const fid = ui.uid('wmSetcMcp');
                return `<label class="wm-setc-mcp-label" for="${fid}">${esc(label)}</label>
                    <div class="wm-setc-mcp-row">${ui.edit(fid, value, `readonly spellcheck="false" placeholder="${esc(empty)}" data-mcp="${esc(id)}"`)}<button type="button" class="wm-button" data-copy="${esc(id)}"${value ? '' : ' disabled'}>Copy</button></div>`;
            }).join('')}`;
        el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
            const input = el.querySelector(`[data-mcp="${b.dataset.copy}"]`);
            if (!input || !input.value) return;
            input.focus();
            input.select();
            if (!(await copyText(input.value))) await ui.messageBox({ title: 'Remote Access', icon: 'error', text: 'The address could not be copied.' });
        }));
    }

    wmSettings.registerPage({
        id: 'remote',
        // Personal: how agents and prints reach this phone (Yukimi); set-usb went to Continuity
        tab: 'personal',
        label: 'Remote Access',
        // Remote Desktop Mobile's icon (tsclient); 6.5's ROM has no Start icon for it, so 6.5 shows this one too
        icon: 'app-remote-desktop-mobile-lg',
        tabs: [['general', 'General'], ['generation', 'Generation'], ['openwith', 'Open With'], ['mcp', 'MCP']],
        available: () => typeof root.setAgentPriorityClient === 'function' && typeof root.isAgentPriorityClient === 'function',
        init() {
            const saved = remoteState();
            const d = { saved, p: { ...saved }, dirty: false };
            // the settings as the server holds them, unless this page has changes of its own by then
            // (remoteAccessProperties.js refreshFromServer)
            if (typeof root.loadUserGlobalSettingsFromServer === 'function') {
                Promise.resolve(root.loadUserGlobalSettingsFromServer()).then(() => {
                    if (d.dirty) return;
                    d.saved = remoteState();
                    d.p = { ...d.saved };
                    if (d.rerender) d.rerender();
                }).catch(() => {});
            }
            return d;
        },
        render(el, tab, d, api) {
            el.classList.add('wm-setc');
            d.rerender = api.rerender;
            const p = d.p;
            const touch = () => { d.dirty = true; };
            if (tab === 'mcp') { renderMcp(el, d); return; }
            if (tab === 'generation') {
                el.innerHTML = `<p>Click an option, and then choose where prints open, if needed.</p>
                    ${METHODS.map(([v, l]) => ui.radio('method', v, l, p.method === v)).join('')}
                    ${ui.sub('Studio')}
                    ${ui.check('autogen', 'Generate after an agent changes Studio', p.autoGenerate)}
                    ${ui.sub('Prints')}
                    <p>Set how many prints an agent can make in one turn:</p>
                    <div class="wm-setc-prints">${ui.comboHtml('min', String(p.minPrints))}<span>to</span>${ui.comboHtml('max', String(p.maxPrints))}<span>prints</span></div>
                    ${ui.note('An agent asks for a number of prints; Dreamscape keeps it between these.')}`;
                el.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { p.method = r.value; touch(); } }));
                el.querySelector('input[name="autogen"]').addEventListener('change', (e) => { p.autoGenerate = e.target.checked; touch(); });
                const opts = PRINTS.map((n) => [n, String(n)]);
                // remoteAccessProperties.js: the other combo follows so min never passes max
                ui.bindCombo(el.querySelector('[data-act="min"]'), opts, p.minPrints, (v) => { p.minPrints = v; if (p.maxPrints < v) p.maxPrints = v; touch(); api.rerender(); });
                ui.bindCombo(el.querySelector('[data-act="max"]'), opts, p.maxPrints, (v) => { p.maxPrints = v; if (p.minPrints > v) p.minPrints = v; touch(); api.rerender(); });
                return;
            }
            if (tab === 'openwith') {
                el.innerHTML = `<p>After a detached request, the new print opens on the window the agent is bound to, in:</p>
                    ${OPEN_WITH.map(([v, l, t]) => `${ui.radio('open', v, l, p.openGenerated === v)}<p class="wm-form-note wm-setc-radio-note">${esc(t)}</p>`).join('')}
                    ${ui.note('Every print is saved to the gallery; this only chooses what opens.')}`;
                el.querySelectorAll('input[name="open"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { p.openGenerated = r.value; touch(); } }));
                return;
            }
            el.innerHTML = `<p>Agents that test the client use the priority client first.</p>
                ${ui.check('prio', 'Make this phone the priority client for agents', p.priority)}
                <p class="wm-form-note wm-setc-gap-top">Applies to this window until it is closed.</p>`;
            el.querySelector('input[name="prio"]').addEventListener('change', (e) => { p.priority = e.target.checked; touch(); });
        },
        async commit(d) {
            // remoteAccessProperties.js applyPending: the priority client, then one patch of the rest
            const p = d.p;
            const s = d.saved;
            const patch = {};
            if (p.method !== s.method) patch.defaultGenerationMethod = p.method;
            if (p.autoGenerate !== s.autoGenerate) patch.autoGenerate = p.autoGenerate;
            if (p.openGenerated !== s.openGenerated) patch.openGeneratedImages = p.openGenerated;
            if (p.minPrints !== s.minPrints) patch.minPrintsPerTurn = p.minPrints;
            if (p.maxPrints !== s.maxPrints) patch.maxPrintsPerTurn = p.maxPrints;
            if (p.priority !== s.priority) root.setAgentPriorityClient(p.priority);
            if (!Object.keys(patch).length) return [];
            try {
                // eslint-disable-next-line no-undef
                if (typeof persistRemoteAccessSettingsPatch === 'function') await persistRemoteAccessSettingsPatch(patch);
            } catch (err) {
                await ui.messageBox({ title: 'Remote Access', icon: 'error', text: `The settings could not be saved to the server. ${err && err.message ? err.message : ''}`.trim() });
                return false;
            }
            return [];
        }
    });

    // ---------------------------------------------------------------- Grimoire

    let ioLoading = null;
    /** cplInternetOptions.js (Control Panel's bundle) on its own: its settings calls need nothing else. */
    function internetOptions() {
        if (root.cplInternetOptions) return Promise.resolve(root.cplInternetOptions);
        if (!ioLoading) {
            // an async script of its own: featureLoader's ordered (async = false) queue would wait
            // behind any other script still loading
            const fl = root.featureLoader;
            const src = 'scripts/comp/cplInternetOptions.js';
            const url = fl && typeof fl._versionedAssetUrl === 'function' ? fl._versionedAssetUrl(src).catch(() => `/${src}`) : Promise.resolve(`/${src}`);
            ioLoading = url.then((u) => new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = u;
                s.async = true;
                s.onload = resolve;
                s.onerror = () => reject(new Error('Internet Options could not be loaded'));
                document.body.appendChild(s);
            })).then(() => {
                if (!root.cplInternetOptions) throw new Error('Internet Options could not be loaded');
                return root.cplInternetOptions;
            }).catch((err) => { ioLoading = null; throw err; });
        }
        return ioLoading;
    }

    /** The phone's Internet Explorer page (wmBrowser.js), for Use Current. */
    function phoneCurrentPage() {
        try {
            const st = root.wmBrowser && typeof root.wmBrowser._state === 'function' ? root.wmBrowser._state() : null;
            const url = st && st.entries ? st.entries[st.idx] : '';
            return url && url !== 'home' && /^https?:/i.test(url) ? url : '';
        } catch (_) {
            return '';
        }
    }

    wmSettings.registerPage({
        id: 'grimoire',
        tab: 'connections',
        label: 'Grimoire',
        icon: 'set-grimoire',
        tabs: [['general', 'General'], ['memory', 'Memory'], ['advanced', 'Advanced']],
        init() {
            const d = { io: null, s: null, error: '' };
            // the page waits under the shell's wait cursor (WM shows no "Reading..." text)
            const loaded = internetOptions()
                .then((io) => { d.io = io; return io.alchemySettings(); })
                .then((s) => {
                    d.s = s;
                    d.home = s.homePage || '';
                    d.homeText = d.home || 'about:Home';
                    d.provider = s.searchProvider || 'grimoire';
                    d.adv = {};
                    d.io.ALCHEMY_ADVANCED.forEach((a) => { d.adv[a.key] = s[a.key]; });
                })
                .catch((err) => { d.error = (err && err.message) || 'The settings could not be read.'; })
                .then(() => { if (d.rerender) d.rerender(); });
            const sh = root.wmShell;
            if (sh && typeof sh.busy === 'function') sh.busy(loaded).catch(() => {});
            return d;
        },
        render(el, tab, d, api) {
            el.classList.add('wm-setc');
            d.rerender = api.rerender;
            if (d.error) { el.innerHTML = ui.text(d.error); return; }
            if (!d.s) { el.innerHTML = ''; return; }
            const io = d.io;
            if (tab === 'memory') {
                el.innerHTML = `<p>Delete the browsing history of Grimoire and Alchemy, the remote browser this phone's Internet Explorer uses.</p>
                    <div class="wm-setc-mem">
                        <span>Temporary files:</span><button type="button" class="wm-button" data-act="cache">Delete Files</button>
                        <span>Cookies:</span><button type="button" class="wm-button" data-act="cookies">Delete Cookies</button>
                        <span>History:</span><button type="button" class="wm-button" data-act="history">Clear History</button>
                    </div>
                    ${ui.gap()}
                    ${ui.buttons([['all', 'Delete All']])}`;
                const ASK = {
                    cache: ['Delete all temporary files that Alchemy keeps?', { cache: true }, 'Temporary files deleted.'],
                    cookies: ['Delete all cookies that Alchemy keeps? Sites will sign you out.', { cookies: true }, 'Cookies deleted.'],
                    history: ["Delete Grimoire's History and this phone's Internet Explorer history?", { history: true }, 'History deleted.'],
                    all: ['Delete all browsing history: temporary files, cookies, history, form data and passwords?', { cache: true, cookies: true, history: true, forms: true, passwords: true }, 'Browsing history deleted.']
                };
                el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
                    const [q, what, done] = ASK[b.dataset.act];
                    const yes = await ui.messageBox({ title: 'Grimoire', icon: 'question', text: q, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }] });
                    if (!yes) return;
                    let ok = false;
                    // WM's wait cursor while Alchemy clears it
                    try { ok = await (window.wmShell && typeof window.wmShell.busy === 'function' ? window.wmShell.busy(() => io.clearBrowsingData(what)) : io.clearBrowsingData(what)); } catch (_) { ok = false; }
                    if (what.history) {
                        // the phone's own Internet Explorer history (wmBrowser.js wmIeHistory / wmIeTyped)
                        try { localStorage.removeItem('wmIeHistory'); localStorage.removeItem('wmIeTyped'); } catch (_) { /* private mode */ }
                    }
                    await ui.messageBox(ok
                        ? { title: 'Grimoire', icon: 'info', text: done }
                        : { title: 'Grimoire', icon: 'error', text: 'Alchemy could not delete its browsing data.' });
                }));
                return;
            }
            if (tab === 'advanced') {
                const rows = io.ALCHEMY_ADVANCED.map((a) => {
                    if (a.check) return ui.check(`adv-${a.key}`, a.check, d.adv[a.key] === true, `data-k="${esc(a.key)}"`);
                    const cur = a.choices.find(([v]) => v === Number(d.adv[a.key]));
                    return `${ui.sub(a.sub)}${ui.comboHtml(`adv-${a.key}`, cur ? cur[1] : String(d.adv[a.key] == null ? '' : d.adv[a.key]))}`;
                }).join('');
                el.innerHTML = `<p>Alchemy, the remote browser, sends its pages as pictures:</p>${rows}`;
                io.ALCHEMY_ADVANCED.forEach((a) => {
                    if (a.check) {
                        const box = el.querySelector(`input[data-k="${a.key}"]`);
                        if (box) box.addEventListener('change', () => { d.adv[a.key] = box.checked; });
                        return;
                    }
                    ui.bindCombo(el.querySelector(`[data-act="adv-${a.key}"]`), a.choices, Number(d.adv[a.key]), (v) => { d.adv[a.key] = v; });
                });
                return;
            }
            const homeId = ui.uid('wmGrimHome');
            const prov = io.SEARCH_PROVIDERS.find((p) => p.id === d.provider) || io.SEARCH_PROVIDERS[0];
            el.innerHTML = `<p>Home page:</p>
                ${ui.edit(homeId, d.homeText, 'spellcheck="false" inputmode="url"')}
                ${ui.buttons([['current', 'Use Current', !phoneCurrentPage()], ['default', 'Use Default']])}
                ${ui.note("The home page of Grimoire's windows on the desktop.")}
                ${ui.gap()}
                <p>Search with:</p>
                ${ui.comboHtml('provider', prov.label)}`;
            const home = el.querySelector(`#${homeId}`);
            home.addEventListener('input', () => { d.homeText = home.value; });
            el.querySelector('[data-act="current"]').addEventListener('click', () => { const u = phoneCurrentPage(); if (u) { d.homeText = u; home.value = u; } });
            el.querySelector('[data-act="default"]').addEventListener('click', () => { d.homeText = 'about:Home'; home.value = d.homeText; });
            ui.bindCombo(el.querySelector('[data-act="provider"]'), io.SEARCH_PROVIDERS.map((p) => [p.id, p.label]), d.provider, (v) => { d.provider = v; });
        },
        async commit(d) {
            if (!d.s || !d.io) return [];
            // cplDialogs2.js Internet Properties: about:Home / about:blank are Grimoire's own start page
            const first = String(d.homeText || '').split(/\r?\n/)[0].trim();
            const url = /^about:(blank|home)$/i.test(first) || !first ? '' : first;
            if (/\s/.test(url)) {
                await ui.messageBox({ title: 'Grimoire', icon: 'warning', text: 'The home page address is not valid. Type an address without spaces.' });
                return false;
            }
            const patch = {};
            if (url !== d.home) patch.homePage = url;
            if (d.provider !== (d.s.searchProvider || 'grimoire')) patch.searchProvider = d.provider;
            Object.keys(d.adv).forEach((k) => { if (d.adv[k] !== d.s[k]) patch[k] = d.adv[k]; });
            if (!Object.keys(patch).length) return [];
            let saved = null;
            try { saved = await d.io.saveAlchemy(patch); } catch (_) { saved = null; }
            if (!saved) {
                await ui.messageBox({ title: 'Grimoire', icon: 'error', text: 'The Grimoire settings could not be saved.' });
                return false;
            }
            // the phone's Internet Explorer (wmBrowser.js) keeps its own copy: hand it the saved settings
            try { window.dispatchEvent(new CustomEvent('wm-alchemy-settings', { detail: { settings: saved } })); } catch (_) { /* no listener */ }
            return [];
        }
    });

    // ---------------------------------------------------------------- Cellular (#771)
    // How the title bar draws the mobile network (wmShell typeIcon / typeName read the same keys):
    // the type icon beside Wi-Fi (moved from Screen > Status Bar), LTE for 4G, the 5G / 5G+ indicator
    // for 3GPP NR / NR-A / UWB (mmWave apart as 5G UW), NR UW for UWB.

    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* storage off */ } };
    const CELL_KEYS = { showCell: 'wmShowCellIcon', lte: 'wmCellLte', fiveG: 'wmCell5g', fiveGUw: 'wmCell5gUw', nrUw: 'wmCellNrUw' };
    const shell = () => root.wmShell || null;

    wmSettings.registerPage({
        id: 'cellular',
        tab: 'connections',
        label: 'Cellular',
        icon: 'set-cellular',
        tabs: [],
        init: () => {
            const d = {};
            for (const [k, key] of Object.entries(CELL_KEYS)) d[k] = lsGet(key) === '1';
            return d;
        },
        render(el, tab, d) {
            el.classList.add('wm-setc');
            const sh = shell();
            const dev = sh && typeof sh.deviceView === 'function' ? sh.deviceView() : null;
            let now = 'No mobile network information';
            if (dev && dev.cell) {
                const name = dev.type && sh.typeName ? sh.typeName(dev.type) : null;
                const op = dev.cell.operator ? `${String(dev.cell.operator).trim()}, ` : '';
                now = dev.airplane ? 'Flight mode' : name ? `${op}${name}${dev.active === 'cellular' ? ', in use' : ', available'}` : `${op}no data service`;
            }
            el.innerHTML = `${ui.sub('Mobile network')}${ui.value('Network:', now)}
                <div class="wm-form-gap"></div>
                ${ui.sub('Data type indicator')}
                ${ui.check('cellShow', 'Always show mobile data availability (when connected to Wireless LAN)', d.showCell)}
                ${ui.check('cellLte', 'Show LTE in place of 4G', d.lte)}
                ${ui.check('cell5g', 'Show 5G/5G+ Indicator in place of 3GPP NR/NR-A/UWB', d.fiveG)}
                <div class="wm-setc-indent">${ui.check('cell5gUw', 'Separate mmWave data type from 5G+ as 5G UW', d.fiveGUw, d.fiveG ? '' : 'disabled')}</div>
                ${ui.check('cellNrUw', 'Show NR UW in place of UWB icon', d.nrUw, d.fiveG ? 'disabled' : '')}`;
            const bind = (name, k, after) => el.querySelector(`input[name="${name}"]`).addEventListener('change', (e) => { d[k] = e.target.checked; if (after) after(); });
            bind('cellShow', 'showCell');
            bind('cellLte', 'lte');
            bind('cell5g', 'fiveG', () => {
                el.querySelector('input[name="cell5gUw"]').disabled = !d.fiveG;
                el.querySelector('input[name="cellNrUw"]').disabled = d.fiveG;
            });
            bind('cell5gUw', 'fiveGUw');
            bind('cellNrUw', 'nrUw');
        },
        commit(d) {
            const keys = [];
            for (const [k, key] of Object.entries(CELL_KEYS)) {
                const v = d[k] ? '1' : null;
                if ((lsGet(key) === '1' ? '1' : null) !== v) { lsSet(key, v); keys.push(key); }
            }
            return keys;
        }
    });

    // ---------------------------------------------------------------- Bluetooth (#771, #772)
    // WM's Bluetooth applet on the phone's own Bluetooth (window.AndroidBluetooth, DSApp
    // BluetoothControl): Devices (Add new device..., the paired devices; tap = the device's page,
    // hold = Connect / Disconnect, Info, Delete), Mode (Turn on Bluetooth, Make this device visible to
    // other devices, and the title bar's Show Bluetooth Status, moved from Screen). Without the app's
    // Bluetooth bridge the page says what the phone reports and links Android's own settings.

    const BT_STATUS = [['on', 'When Powered On'], ['connected', 'When Connected'], ['never', 'Never']];
    function btStatusMode() {
        const v = lsGet('wmBluetoothStatus') || (lsGet('wmShowBluetoothIcon') === '0' ? 'never' : null);
        return v === 'connected' || v === 'never' ? v : 'on';
    }
    const btBridge = () => (root.AndroidBluetooth && typeof root.AndroidBluetooth.getState === 'function' ? root.AndroidBluetooth : null);
    function btState() {
        const b = btBridge();
        if (!b) return null;
        try { return JSON.parse(b.getState()); } catch (_) { return null; }
    }
    const btName = (dv) => dv.name || dv.address;
    const BT_KIND = { audio: 'Audio', phone: 'Phone', computer: 'Computer', peripheral: 'Input device', wearable: 'Wearable', health: 'Health', imaging: 'Imaging', toy: 'Toy', other: 'Other' };
    const BT_SERVICE = { a2dp: 'Wireless Stereo', headset: 'Hands Free', le_audio: 'LE Audio', hid: 'Input Device' };
    function btCall(fn, address) {
        const b = btBridge();
        if (!b || typeof b[fn] !== 'function') return null;
        try { return JSON.parse(b[fn](address)); } catch (_) { return null; }
    }
    /** One action on a device, and what to say when Android keeps it for its own settings. */
    async function btAct(fn, dv) {
        const r = btCall(fn, dv.address);
        if (r && r.ok) return true;
        const sh = shell();
        if (r && r.via === 'settings' && sh) await sh.messageBox({ title: 'Bluetooth', icon: 'info', text: `Android does not let other apps ${fn === 'unpair' ? 'delete' : fn} this device. Finish in Android's Bluetooth settings, which are open now.` });
        return false;
    }
    async function btDelete(dv, after) {
        const sh = shell();
        const yes = sh ? await sh.messageBox({ title: 'Bluetooth', icon: 'question', text: `Delete ${btName(dv)}? You will need to pair it again to use it.`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] }) : true;
        if (yes && await btAct('unpair', dv) && after) after();
    }
    /** Repaints the page on the app's Bluetooth events while `el` is on screen. */
    function btLive(el, repaint) {
        let t = null;
        const on = () => { if (!el.isConnected) { root.removeEventListener('dreamscape:bluetooth', on); return; } clearTimeout(t); t = setTimeout(repaint, 120); };
        root.addEventListener('dreamscape:bluetooth', on);
    }
    /** Tap and hold a list row: its menu (WM's hold, with the shell's ring timing). */
    function btHold(row, menu) {
        let timer = null;
        const cancel = () => { clearTimeout(timer); timer = null; };
        row.addEventListener('pointerdown', (e) => {
            cancel();
            const x = e.clientX; const y = e.clientY;
            timer = setTimeout(() => { timer = null; row._held = true; menu(x, y); }, ((root.wmShell && root.wmShell.holdMs) || 600));
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => row.addEventListener(t, cancel));
        row.addEventListener('click', (e) => { if (row._held) { row._held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); menu(e.clientX, e.clientY); });
    }

    wmSettings.registerPage({
        id: 'bluetooth',
        tab: 'connections',
        label: 'Bluetooth',
        icon: 'set-bluetooth',
        tabs: [['bt-devices', 'Devices'], ['bt-mode', 'Mode']],
        init: () => ({ status: btStatusMode(), turnOn: null, visible: null, sub: null, address: null, pick: null, pairing: null }),
        softKeys(d) {
            if (d.sub === 'add') {
                return {
                    left: { label: 'Cancel', action: () => { const b = btBridge(); if (b) b.cancelDiscovery(); d.sub = null; d.pick = null; if (d.rerender) d.rerender(); } },
                    right: { label: 'Pair', disabled: !d.pick, action: () => d.pair && d.pair() }
                };
            }
            return null;
        },
        render(el, tab, d, api) {
            el.classList.add('wm-setc');
            d.rerender = api.rerender;
            // the search's Cancel | Pair, else the page's usual keys
            const keys = () => { const sh = shell(); if (sh && typeof sh.refreshSoftKeys === 'function') sh.refreshSoftKeys(); };
            setTimeout(keys, 0);
            const r = radios();
            const present = !!(r && radioPresent(r, 'bluetooth'));
            const st = btState();
            if (tab === 'bt-mode') {
                if (d.turnOn == null) d.turnOn = st ? !!st.on : !!(r && r.bluetooth);
                if (d.visible == null) d.visible = !!(st && st.discoverable);
                const state = st ? (st.on ? (st.devices.some((x) => x.connected) ? 'On, a device is connected' : 'On') : 'Off')
                    : !r ? 'Unknown' : !present ? 'Not available' : r.bluetooth ? (r.bluetoothConnected === true ? 'On, a device is connected' : 'On') : 'Off';
                el.innerHTML = `${ui.check('btOn', 'Turn on Bluetooth', d.turnOn, present || st ? '' : 'disabled')}
                    ${ui.check('btVisible', 'Make this device visible to other devices', d.visible, st && st.on ? '' : 'disabled')}
                    ${ui.facts([['Status:', state], ...(st && st.name ? [['Device name:', st.name]] : [])])}
                    ${ui.note('To connect to a Bluetooth device, tap the Devices tab.')}
                    <div class="wm-form-gap"></div>
                    <p>Show Bluetooth Status:</p>
                    ${ui.comboHtml('btstatus', (BT_STATUS.find(([k]) => k === d.status) || BT_STATUS[0])[1])}`;
                el.querySelector('input[name="btOn"]').addEventListener('change', (e) => { d.turnOn = e.target.checked; });
                el.querySelector('input[name="btVisible"]').addEventListener('change', (e) => {
                    d.visible = e.target.checked;
                    // Android asks itself, and the phone stays visible for two minutes
                    if (d.visible && btBridge()) btBridge().setDiscoverable(120);
                });
                ui.bindCombo(el.querySelector('[data-act="btstatus"]'), BT_STATUS, d.status, (v) => { d.status = v; });
                btLive(el, () => { const s2 = btState(); if (s2) { const cb = el.querySelector('input[name="btVisible"]'); if (cb) { cb.checked = d.visible = !!s2.discoverable; cb.disabled = !s2.on; } } });
                return;
            }
            // ---- Devices
            if (!st) {
                const lines = !r ? 'Bluetooth devices are listed here in the Dreamscape app for Android.'
                    : !present ? 'This phone has no Bluetooth.'
                    : !r.bluetooth ? 'Bluetooth is off. Turn it on on the Mode tab.'
                    : r.bluetoothConnected === true ? 'A device is connected.' : 'No device is connected.';
                el.innerHTML = `<p>${esc(lines)}</p>${ui.note('This version of the app cannot list devices; use Bluetooth Settings.')}
                    ${ui.buttons([['bt-settings', 'Bluetooth Settings', !(device() && typeof device().openSettings === 'function')]], false)}`;
                el.querySelector('[data-act="bt-settings"]').addEventListener('click', () => openAndroidSettings('bluetooth'));
                return;
            }
            if (!st.access) {
                el.innerHTML = `<p>Allow the Dreamscape app to find and connect to nearby devices to list them here.</p>${ui.buttons([['bt-allow', 'Allow']], false)}`;
                el.querySelector('[data-act="bt-allow"]').addEventListener('click', () => btBridge().requestAccess());
                btLive(el, api.rerender);
                return;
            }
            if (!st.on) {
                el.innerHTML = `<p>Bluetooth is off. Turn it on on the Mode tab to see your devices.</p>`;
                btLive(el, api.rerender);
                return;
            }
            const dv = d.address && (st.devices.find((x) => x.address === d.address) || st.found.find((x) => x.address === d.address));
            if (d.sub === 'info' && dv) {
                setHeader(el, btName(dv));
                const services = dv.profiles.map((p) => BT_SERVICE[p] || p).join(', ') || 'None in use';
                el.innerHTML = `${ui.facts([['Name:', btName(dv)], ['Address:', dv.address], ['Type:', BT_KIND[dv.kind] || 'Other'],
                        ['Status:', dv.connected ? 'Connected' : 'Not connected'], ['Services:', services], ...(dv.battery != null ? [['Battery:', `${dv.battery}%`]] : [])])}
                    <div class="wm-form-gap"></div>
                    ${ui.buttons([[dv.connected ? 'bt-disconnect' : 'bt-connect', dv.connected ? 'Disconnect' : 'Connect'], ['bt-delete', 'Delete']])}`;
                el.querySelector('[data-act="bt-connect"],[data-act="bt-disconnect"]').addEventListener('click', () => btAct(dv.connected ? 'disconnect' : 'connect', dv));
                el.querySelector('[data-act="bt-delete"]').addEventListener('click', () => btDelete(dv, () => { d.sub = null; api.rerender(); }));
                btLive(el, api.rerender);
                return;
            }
            if (d.sub === 'add') {
                setHeader(el, 'Add new device');
                const pick = (key) => { d.pick = key; keys(); };
                d.pair = () => {
                    const it = st.found.find((x) => x.address === d.pick);
                    if (!it) return;
                    const res = btCall('pair', it.address);
                    d.pairing = res && res.ok ? it.address : null;
                    api.rerender();
                };
                // devices without a name stay out, as in Android's own list
                const named = st.found.filter((x) => x.name);
                const rows = named.map((x) => ({ key: x.address, label: `${btName(x)}${x.bonding ? ' (pairing...)' : ''}`, selected: x.address === d.pick }));
                const hidden = st.found.length - named.length;
                el.innerHTML = `<p>Select a Bluetooth device to connect with.</p>
                    ${rows.length ? ui.listbox(rows, { maxHeight: 220 }) : ''}
                    <p class="wm-setc-gap-top">${esc(st.discovering ? 'Searching for Bluetooth devices...' : rows.length ? 'Search finished.' : 'No devices found. Make sure the device is on and visible.')}</p>
                    ${hidden ? ui.note(`${hidden} device${hidden === 1 ? '' : 's'} without a name not shown.`) : ''}
                    ${d.pairing ? ui.note('Follow the phone\'s prompt to finish pairing.') : ''}
                    ${ui.buttons([['bt-refresh', 'Refresh', st.discovering]])}`;
                if (rows.length) ui.bindListbox(el.querySelector('.wm-listbox'), pick);
                el.querySelector('[data-act="bt-refresh"]').addEventListener('click', () => { btBridge().startDiscovery(); });
                // paired: back to the list
                if (d.pairing && st.devices.some((x) => x.address === d.pairing)) { d.pairing = null; d.pick = null; d.sub = null; btBridge().cancelDiscovery(); setTimeout(api.rerender, 0); return; }
                btLive(el, api.rerender);
                return;
            }
            d.sub = null;
            setHeader(el, 'Bluetooth');
            const rows = [{ key: '+add', label: 'Add new device...' }, ...st.devices.map((x) => ({ key: x.address, label: `${btName(x)}${x.connected ? '  (Connected)' : ''}` }))];
            el.innerHTML = `<p>Tap Add new device to search for other Bluetooth devices. Tap a device to modify its settings.</p>
                ${ui.listbox(rows, { maxHeight: 260 })}`;
            const box = el.querySelector('.wm-listbox');
            ui.bindListbox(box, (key) => {
                if (key === '+add') { d.sub = 'add'; d.pick = null; d.pairing = null; btBridge().startDiscovery(); }
                else { d.sub = 'info'; d.address = key; }
                api.rerender();
            });
            box.querySelectorAll('.wm-listbox-row').forEach((row) => {
                const it = st.devices.find((x) => x.address === row.dataset.key);
                if (!it) return;
                btHold(row, (x, y) => {
                    const sh = shell();
                    if (!sh || typeof sh.menuAt !== 'function') return;
                    sh.menuAt(x, y, [
                        { label: it.connected ? 'Disconnect' : 'Connect', action: () => btAct(it.connected ? 'disconnect' : 'connect', it) },
                        { label: 'Info', action: () => { d.sub = 'info'; d.address = it.address; api.rerender(); } },
                        { label: 'Delete', action: () => btDelete(it, api.rerender) }
                    ]);
                });
            });
            btLive(el, api.rerender);
        },
        commit(d) {
            // ok on a device's page or the search goes back to the list, as on the device
            if (d.sub) {
                if (d.sub === 'add' && btBridge()) btBridge().cancelDiscovery();
                d.sub = null; d.pick = null; d.pairing = null;
                if (d.rerender) d.rerender();
                return false;
            }
            const keys = [];
            const r = radios();
            const st = btState();
            const on = st ? !!st.on : !!(r && r.bluetooth);
            if ((st || r) && d.turnOn != null && on !== d.turnOn) setRadio('bluetooth', d.turnOn);
            const v = d.status === 'on' ? null : d.status;
            if ((lsGet('wmBluetoothStatus') || null) !== v || lsGet('wmShowBluetoothIcon') != null) {
                lsSet('wmBluetoothStatus', v);
                lsSet('wmShowBluetoothIcon', null); // the old on / off check box: now this setting
                keys.push('wmBluetoothStatus');
            }
            return keys;
        }
    });
})();
