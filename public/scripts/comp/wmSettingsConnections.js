/**
 * Melaton Mobile Settings: Connections pages (Connections, Network Cards, Domain Enroll, Wireless Manager, Remote Access, Grimoire) (Yozora #709).
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
 *   Domain Enroll          the domain (network) and connection names, config.json
 *                          userGlobalSettings.desktop.domainName / connectionName through
 *                          persistUserGlobalSettingsPatch (modalUtils.js), as the desktop's
 *                          Customize network settings / Rename Connection
 *   Wireless Manager       WM 6.1's All / Wi-Fi / Bluetooth / Phone rows through the Android app
 *                          (AndroidDevice, Shizuku), Menu with the radios' Android settings and
 *                          Disconnect Cellular Data; then the Dreamscape connection row: tap connects
 *                          (wsClient.manualReconnect) or disconnects (cancelConnectionFromUser,
 *                          after a warning), as the tray flyout's "Connect or disconnect"
 *   Remote Access          remoteAccessProperties.js on three tabs: priority client
 *                          (setAgentPriorityClient), generation method + Auto Generate + prints
 *                          per turn, Open With; one persistRemoteAccessSettingsPatch on ok
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

    const STATUS_POLL_MS = 5000; // melatonControlPanel.js STATUS_POLL_MS
    const LIVE_TICK_MS = 1000;

    // ---------------------------------------------------------------- connection facts
    // The same reads as melatonControlPanel.js (info, linkState, accessText, formatDuration).

    const net = () => root.melatonNetworkDialogs || null;
    const ws = () => root.wsClient || null;

    function info() {
        const n = net();
        return n
            ? n.connectionInfo()
            : { domain: 'DREAMSCAPE', connectionName: 'VPN Connection', fqdn: root.location.hostname, connectionType: 'WAN', device: 'L-PPoP' };
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
            ['Server uptime:', formatDuration(status.uptime)],
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

    /** Redraws `paint` every tick while `el` is on screen. */
    function liveTick(el, paint, ms = LIVE_TICK_MS) {
        const timer = setInterval(() => {
            if (!el.isConnected) { clearInterval(timer); return; }
            paint();
        }, ms);
        return timer;
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
            liveTick(el, () => {
                paint();
                if (Date.now() - statusAt >= STATUS_POLL_MS) pollStatus().then(() => { if (el.isConnected) paint(); });
            });
            if (Date.now() - statusAt >= STATUS_POLL_MS) pollStatus().then(() => { if (el.isConnected) paint(); });
        }
    });

    // ---------------------------------------------------------------- Network Cards

    wmSettings.registerPage({
        id: 'network-cards',
        tab: 'connections',
        label: 'Network Cards',
        icon: 'set-netcards',
        tabs: [],
        init: () => ({ adapter: false }),
        render(el, tab, d, api) {
            el.classList.add('wm-setc');
            d.rerender = api.rerender;
            const i = info();
            if (d.adapter) {
                setHeader(el, miniport(i));
                el.innerHTML = `${ui.radio('ip', 'server', 'Use server-assigned IP address', true, 'disabled')}
                    ${ui.radio('ip', 'specific', 'Use specific IP address', false, 'disabled')}
                    <div class="wm-form-row wm-setc-ip"><span class="wm-form-label">Server:</span>${ui.edit('', i.fqdn, 'readonly')}</div>
                    ${ui.sub(`${i.connectionName} Status`)}<div data-f="facts"></div>
                    ${ui.note('The domain controller assigns this connection. Tap ok to return to the adapter list.')}`;
                const facts = el.querySelector('[data-f="facts"]');
                const paint = () => { const h = ui.facts(connectionFacts()); if (facts.innerHTML !== h) facts.innerHTML = h; };
                paint();
                liveTick(el, paint);
                return;
            }
            setHeader(el, 'Configure Network Adapters');
            el.innerHTML = `<p>My network card connects to:</p>
                ${ui.comboHtml('to', i.domain, true)}
                <p class="wm-setc-gap-top">Tap an adapter to modify settings:</p>
                ${ui.listbox([{ key: 'vpn', label: miniport(i), selected: true }], { maxHeight: 238 })}`;
            el.querySelector('.wm-listbox').classList.add('wm-setc-adapters');
            ui.bindListbox(el.querySelector('.wm-listbox'), () => { d.adapter = true; api.rerender(); });
        },
        commit(d) {
            // ok on the adapter's page goes back to the list, as on the device
            if (d.adapter) {
                d.adapter = false;
                if (d.rerender) d.rerender();
                return false;
            }
            return [];
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
                        { label: 'Bluetooth Settings', disabled: !canOpen, action: () => openAndroidSettings('bluetooth') },
                        { label: 'Wi-Fi Settings', disabled: !canOpen, action: () => openAndroidSettings('wifi') },
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
            el.querySelectorAll('[data-radio]').forEach((b) => holdOpens(b, () => openAndroidSettings(b.dataset.radio)));
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
        ['glancewell', 'Glancewell', 'The gallery slideshow, opened at the print.'],
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

    wmSettings.registerPage({
        id: 'remote',
        tab: 'connections',
        label: 'Remote Access',
        icon: 'set-usb',
        tabs: [['general', 'General'], ['generation', 'Generation'], ['openwith', 'Open With']],
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
})();
