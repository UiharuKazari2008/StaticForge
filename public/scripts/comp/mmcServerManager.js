/**
 * Server Manager (Yozora #831 slice 5): one MMC console that holds every other console in a single
 * tree, laid out as Windows Server 2008's Server Manager (servermanager.msc). It replaced the old
 * Server Manager dashboard (dsap://dreamscape.jp/, a link list) on the Vista desktop:
 *
 *   Server Manager (<HOST>)   the summary: Server Summary (Computer Information, System Information:
 *                             the server machine's processor, memory, OS, Node.js, build and disk from
 *                             get_system_info, #945; Security Information), Roles Summary, Features Summary, Resources and Support
 *     Clients                 every connected client (desktops, phones, light clients, devices) with
 *                             its state, pushed by the server_clients feed while the page shows;
 *                             Resync and Disconnect on the selected one (#898)
 *     Roles                   the role consoles, each a hosted snap-in (mmcConsole.compose):
 *                             Autofill Ranking, Dynamic Quips, Enshutsuka, Exchange, Front Gate,
 *                             Key Manager, Print Management
 *     Features                the programs and pages that are not consoles (Image Search, Messaging
 *                             Bridge, Melaton Mobile Device Center, Melaton Messenger, Pantry, Zanzou)
 *     Diagnostics             Event Viewer, Reliability and Performance, Device Manager (windows of
 *                             their own: a page with Open, as Computer Management does for snap-ins it
 *                             cannot host), Nightshade Network (the service as the server sees it:
 *                             this computer's connection, the domain controller, the clients; #895),
 *                             Hardware and Sensors (hwmon readings pushed by the hardware_sensors
 *                             feed while the page shows; #896) and Workers (Computer Management's, hosted)
 *     Configuration           Authentication, Melaton Defender, Remote Access, Runes (windows of their
 *                             own) and Replication (Computer Management's, hosted)
 *     Storage                 Computer Management's Storage, hosted whole: Workspace Management,
 *                             Favorites, Spellbook, Text Expanders, Character Database, Wiki Caches.
 *                             Dynamic Quips and Enshutsuka are left out there (they are Roles here),
 *                             so no snap-in is hosted twice in this tree.
 *
 * Computer Management's parts come from mmcDataManagement.partDef(part), so its Storage, Workers and
 * Replication are the same pages and commands as in its own window. The root page reads
 * server_manager_summary (modules/ws/handlers/307-serverManagerHandler.js, admins).
 *
 *   window.openServerManager(node?)   node: a node id, or a role / feature / tool key below
 *   window.mmcServerManager.def()     the composed def
 */
(function (root) {
    'use strict';

    const ID = 'serverManager';
    const TITLE = 'Server Manager';
    const APPS = '/static_images/app_icons';
    const ITEMS = '/static_images/vista-cpl/items';
    const VI = '/static_images/vista-icons';
    const DEV = '/static_images/vista-devmgr';
    const ICON16 = `${APPS}/16/vista-server-manager.webp`;
    const ICON32 = `${APPS}/32/vista-server-manager.webp`;
    const ICON48 = `${APPS}/48/vista-server-manager.webp`;
    const SERVER16 = '/static_images/melaton/net-server-16.png';
    const SERVER32 = '/static_images/melaton/net-server-32.png';
    const GLOBE16 = `${VI}/internet-globe-16.png`;
    const GLOBE32 = `${VI}/internet-globe-32.png`;
    const NS16 = `${VI}/nightshade-16.png`;
    const NS32 = `${VI}/nightshade-32.png`;
    const SENS16 = `${DEV}/sensors-16.png`;
    const SENS32 = `${DEV}/sensors-32.png`;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const has = (name) => typeof root[name] === 'function';

    function isAdmin() {
        try { const t = localStorage.getItem('userType'); return t === 'admin' || t === 'dev_admin'; } catch (_) { return false; }
    }

    /** A Start menu program by its launch id (modalUtils.js). */
    function launch(id) {
        const item = call('findStartMenuLaunchableById', id);
        if (!item) return false;
        call('launchStartMenuItem', item);
        return true;
    }

    const dsap = (url) => () => call('openDsapInGrimoire', url);
    const pkg = (packageId) => () => { if (root.melatonApps) root.melatonApps.launch({ packageId }).catch(() => {}); };
    const cpl = (page) => async () => {
        if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
        if (root.melatonControlPanel) root.melatonControlPanel.open(page);
    };

    // Roles: [key, name, global with def(), the loader that opens its own window, description], by name
    const ROLES = [
        ['autofill', 'Autofill Ranking', 'mmcAutofillRanking', 'openAutofillRankingSnapin', 'How SmartText and autofill order their suggestions.'],
        ['quips', 'Dynamic Quips', 'mmcQuips', 'openDynamicQuipsSnapin', 'The lines Melaton shows while a picture is generated.'],
        ['enshutsuka', 'Enshutsuka', 'mmcEnshutsuka', 'openEnshutsukaSnapin', 'Director\'s memories, static rules, feedback and persona.'],
        ['exchange', 'Exchange', 'mmcExchange', 'openExchangeConsole', 'Mailboxes, aliases, distribution groups and the mail relay.'],
        ['frontgate', 'Front Gate', 'mmcFrontGate', 'openFrontGateConsole', 'The cover site in front of this server, and its access phrase.'],
        ['keys', 'Key Manager', 'mmcAppKeys', 'openKeyManagerConsole', 'Application keys and service keys.'],
        ['print', 'Print Management', 'mmcPrintManagement', 'openPrintManagementSnapin', 'The generation backends as printers, and their queues.']
    ];

    // Windows of their own: [id, name, icon16, icon32, description, open]
    const FEATURES = [
        ['ispy', 'Image Search', `${APPS}/16/vista-search.webp`, `${APPS}/32/vista-search.webp`, 'Search prompts and metadata across the workspaces.', () => launch('ispy') || call('openDsapInGrimoire', 'dsap://ispy.dreamscape.jp/')],
        ['msgbridge', 'Messaging Bridge', '/melaton-apps/msgbridge/assets/msgbridge-16.png', '/melaton-apps/msgbridge/assets/msgbridge-32.png', 'Relays messages between the mail server and the messaging services.', pkg('msgbridge')],
        ['mdc', 'Melaton Mobile Device Center', `${APPS}/16/mobile-device-center.webp`, `${APPS}/32/mobile-device-center.webp`, 'Phones running the Dreamscape app: partnerships, sync and files.', pkg('activesync')],
        ['messenger', 'Melaton Messenger', `${APPS}/16/melaton-messenger.webp`, `${APPS}/32/melaton-messenger.webp`, 'Text Messaging accounts: iMessage through BlueBubbles, and RCS.', pkg('messenger')],
        ['pantry', 'Pantry', GLOBE16, GLOBE32, 'Cake ledger, work pile, and breakfast before and after.', dsap('dsap://pantry.dyna.dreamscape.jp/status')],
        ['zanzou', 'Zanzou', GLOBE16, GLOBE32, 'Afterimages. Keep the shot, scrap the ghosts.', dsap('dsap://zanzou.dyna.dreamscape.jp/')]
    ];

    const DIAGNOSTICS = [
        ['eventvwr', 'Event Viewer', `${APPS}/16/vista-event-viewer.webp`, `${APPS}/32/vista-event-viewer.webp`, 'The server\'s logs: Dreamscape, the services and the agents.', () => launch('event-viewer')],
        ['perfmon', 'Reliability and Performance', `${APPS}/16/vista-reliability-performance.webp`, `${APPS}/32/vista-reliability-performance.webp`, 'The server\'s processor, memory, disk and network, live and over time.', () => launch('perfmon')],
        ['devmgmt', 'Device Manager', `${ITEMS}/device-manager-16.png`, `${APPS}/32/vista-device-manager.webp`, 'View and update your hardware settings and driver software.', async () => {
            if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
            call('openDeviceManager');
        }]
    ];

    const CONFIGURATION = [
        ['auth', 'Authentication', `${ITEMS}/user-accounts-16.png`, `${ITEMS}/user-accounts-32.png`, 'How people sign in: PINs, passkeys and Dreamscape CardSpace.', async () => {
            if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
            if (root.cplAuthentication) root.cplAuthentication.open();
        }],
        ['defender', 'Melaton Defender', `${APPS}/16/vista-defender.webp`, `${APPS}/32/vista-defender.webp`, 'Blocked clients, honeypot addresses, allowed clients and the sign-in history.', async () => {
            if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
            if (root.windowsDefender) root.windowsDefender.open('home');
        }],
        ['remote', 'Remote Access', `${VI}/remote-access-16.png`, `${VI}/remote-access-32.png`, 'How agents deliver and open pictures on this computer, and the MCP connector.', () => {
            if (root.remoteAccessProperties) root.remoteAccessProperties.open();
            else call('openRemoteAccessSettingsModal');
        }],
        ['runes', 'Runes', `${APPS}/16/vista-regedit.webp`, `${APPS}/32/vista-regedit.webp`, 'The server configuration, edited directly.', () => launch('config-editor')]
    ];

    const TOOLS = new Map(FEATURES.concat(DIAGNOSTICS, CONFIGURATION).map((t) => [t[0], t]));
    // Computer Management's parts (mmcDataManagement.partDef): [embed key, part, name]
    const PARTS = [['storage', 'storage', 'Storage'], ['workers', 'workers', 'Workers'], ['replication', 'replication', 'Replication']];
    // Storage leaves these out: they are Roles here
    const STORAGE_SKIP = ['quips', 'enshutsuka'];

    const state = {
        sum: null,          // server_manager_summary
        sys: null,          // get_system_info (the server machine: processor, memory, OS, disk; #945)
        sumError: '',
        loading: false,
        refreshed: 0,       // Last Refresh
        hosted: new Set(),  // the ROLES / PARTS keys hosted in the open console
        console: null       // the open console (feed pushes repaint its page)
    };

    // ---- data -------------------------------------------------------------------------------------

    async function load(c) {
        if (state.loading) return;
        state.loading = true;
        try {
            if (!isAdmin()) throw new Error('Only an administrator can read the server summary.');
            const client = root.wsClient;
            if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
            const res = await client.sendMessage('server_manager_summary', {}, false);
            const data = (res && res.data && typeof res.data === 'object' && 'success' in res.data) ? res.data : res;
            if (!data || data.success === false) throw new Error((data && (data.details || data.error)) || 'The server did not answer.');
            state.sum = data;
            state.sumError = '';
            // the machine itself (#945: System in Control Panel describes the client's own device; the server's
            // facts are here). loadMeletonVersionInfo (modalUtils.js) shares get_system_info's cached answer.
            try {
                const v = typeof root.loadMeletonVersionInfo === 'function' ? await root.loadMeletonVersionInfo(!!state.refreshed) : null;
                state.sys = (v && v.systemInfo) || state.sys;
            } catch (_) { /* the summary still shows */ }
        } catch (err) {
            state.sumError = (err && err.message) || 'The server did not answer.';
        }
        state.loading = false;
        state.refreshed = Date.now();
        if (c && c.modal && c.modal.isConnected) c.refresh();
    }

    function netInfo() {
        const n = root.melatonNetworkDialogs;
        try { if (n && typeof n.connectionInfo === 'function') return n.connectionInfo() || {}; } catch (_) { /* below */ }
        return { domain: 'DREAMSCAPE', connectionName: 'Nightshade Network', fqdn: root.location ? root.location.hostname : '' };
    }

    function linkUp() {
        const client = root.wsClient;
        return !!(client && typeof client.isConnected === 'function' && client.isConnected());
    }

    /** Task Manager's Up Time: D:HH:MM:SS. */
    function upTime(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const p = (n) => String(n).padStart(2, '0');
        return `${Math.floor(s / 86400)}:${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
    }

    /** Server Manager's footer: Today at 7:06 PM. */
    function lastRefresh(t) {
        if (!t) return 'Never';
        const d = new Date(t);
        const h = d.getHours();
        const time = `${(h % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} at ${time}`;
    }

    function hostName() {
        if (state.sum && state.sum.host) return String(state.sum.host).toUpperCase();
        const i = netInfo();
        return String(i.domain || 'DREAMSCAPE').toUpperCase();
    }

    function frontGate() {
        if (state.sum && state.sum.frontGate) return state.sum.frontGate;
        const fg = root.mmcFrontGate && root.mmcFrontGate._state && root.mmcFrontGate._state.gate;
        return fg ? { enabled: !!fg.enabled, cover: fg.cover || null } : null;
    }

    // ---- the tree ---------------------------------------------------------------------------------

    const icons = new Map();
    const roleIcon = (key) => {
        if (icons.has(key)) return icons.get(key);
        const r = ROLES.find((x) => x[0] === key);
        const m = r && root[r[2]];
        let icon = null;
        try { const d = m && typeof m.def === 'function' ? m.def() : null; if (d && d.icon16) icon = d.icon16; } catch (_) { /* below */ }
        if (icon) icons.set(key, icon);
        return icon || SERVER16;
    };

    const toolNode = (t) => ({ id: t[0], name: t[1], icon: t[2], desc: t[4] });

    function nodes() {
        const role = ([key, name, , , desc]) => (state.hosted.has(key) ? { embed: key, name, desc } : { id: key, name, icon: roleIcon(key), desc });
        const part = (key, name, icon, desc) => (state.hosted.has(key) ? { embed: key, name, desc } : { id: key, name, icon, desc });
        return [{
            id: 'root',
            name: `${TITLE} (${hostName()})`,
            icon: ICON16,
            children: [
                { id: 'roles', name: 'Roles', icon: SERVER16, desc: 'The server\'s roles', children: ROLES.map(role) },
                { id: 'features', name: 'Features', icon: `${ITEMS}/programs-and-features-16.png`, desc: 'Programs and pages that are not consoles' },
                { id: 'clients', name: 'Clients', icon: CLIENTS16, desc: 'Every client connected to this server, with Resync and Disconnect' },
                {
                    id: 'diagnostics', name: 'Diagnostics', icon: `${ITEMS}/problem-reports-and-solutions-16.png`, desc: 'Logs, performance, devices and the remote services',
                    children: DIAGNOSTICS.map(toolNode).concat([
                        { id: 'nightshade', name: 'Nightshade Network', icon: NS16, desc: 'The Nightshade Network service: this computer\u2019s connection, the domain controller and the clients' },
                        { id: 'sensors', name: 'Hardware and Sensors', icon: SENS16, desc: 'Temperatures, fans, voltages and power of the server\u2019s hardware' },
                        part('workers', 'Workers', SERVER16, 'The remote services Dreamscape uses')
                    ])
                },
                {
                    id: 'configuration', name: 'Configuration', icon: `${ITEMS}/administrative-tools-16.png`, desc: 'Sign-in, security, remote access, replication and the server configuration',
                    children: [CONFIGURATION[0], CONFIGURATION[1], CONFIGURATION[2]].map(toolNode)
                        .concat([part('replication', 'Replication', `${ITEMS}/sync-center-16.png`, 'Replication status, cargo, sync and separation')], [toolNode(CONFIGURATION[3])])
                },
                part('storage', 'Storage', `${DEV}/storage-controllers-16.png`, 'Workspaces, favorites, presets, expanders, characters and wiki caches')
            ]
        }];
    }

    /** A node of the open console: a hosted snap-in's root is '<key>::<its root id>'. */
    const hostIds = new Map(); // a hosted snap-in's root id does not change
    function hostId(c, key) {
        if (!state.hosted.has(key)) return key;
        if (hostIds.has(key)) return hostIds.get(key);
        const P = `${key}::`;
        let found = null;
        const walk = (list) => (list || []).some((n) => {
            if (typeof n.id === 'string' && n.id.startsWith(P)) { found = n.id; return true; }
            return walk(n.children);
        });
        try { walk(c && typeof c.nodes === 'function' ? c.nodes() : []); } catch (_) { /* key below */ }
        if (found) hostIds.set(key, found);
        return found || key;
    }

    // ---- pages ------------------------------------------------------------------------------------

    const link = (act, text, icon) => `<div class="sm-task">${icon ? `<img src="${esc(icon)}" alt="">` : '<span class="sm-task-pad"></span>'}<span class="mmc-link" data-act="${esc(act)}">${esc(text)}</span></div>`;

    /** A summary block: Server Manager's sub-heading, its facts and the tasks on the right. */
    function block(title, body, tasks) {
        return `<div class="sm-block">${title ? `<div class="sm-sub">${esc(title)}</div>` : ''}<div class="sm-split"><div class="sm-main">${body}</div>${tasks && tasks.length ? `<div class="sm-tasks">${tasks.join('')}</div>` : ''}</div></div>`;
    }

    function footer() {
        return `<div class="sm-footer"><span>Last Refresh: ${esc(lastRefresh(state.refreshed))}</span><span class="mmc-link" data-act="refresh">Refresh</span></div>`;
    }

    function withIntro(html, img, text) {
        return html.replace('<div class="mmc-page-body">', `<div class="mmc-page-body"><div class="sm-intro"><img src="${esc(img)}" alt=""><p>${esc(text)}</p></div>`) + footer();
    }

    /** Signed-in clients: "3 (2 desktops, 1 phone)". */
    function clientsHtml(s) {
        if (!s || !s.clients) return '';
        const k = s.clients;
        const parts = [];
        if (k.desktops) parts.push(`${k.desktops} desktop${k.desktops === 1 ? '' : 's'}`);
        if (k.phones) parts.push(`${k.phones} phone${k.phones === 1 ? '' : 's'}`);
        if (k.devices) parts.push(`${k.devices} device${k.devices === 1 ? '' : 's'}`);
        return `${esc(String(k.signedIn || 0))}${parts.length ? ` <span class="mmc-hint">(${esc(parts.join(', '))})</span>` : ''}`;
    }

    // ---- Nightshade Network (#895): the service as the server's administrator sees it ----------

    function nsDuration(ms) {
        const t = Math.max(0, Math.floor((ms || 0) / 1000));
        const p = (n) => String(n).padStart(2, '0');
        return `${Math.floor(t / 3600)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
    }

    function nsBytes(n) {
        const v = Math.max(0, Number(n) || 0);
        if (v < 1024) return `${v} bytes`;
        if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
        return `${(v / 1048576).toFixed(1)} MB`;
    }

    function nightshadePage(c) {
        const ws = root.wsClient;
        let s = { service: 'unavailable', cafeReady: false, connectedAt: null };
        try { if (ws && typeof ws.nightshadeState === 'function') s = ws.nightshadeState(); } catch (_) { /* default */ }
        const up = s.service === 'connected';
        const i = netInfo();
        const n = root.melatonNetworkDialogs;
        const device = n && typeof n.miniportLabel === 'function' ? n.miniportLabel(i) : `${i.connectionType || 'WAN'} Miniport (${i.device || 'L-PPoP'})`;
        const st = (ws && ws.connectionStats) || {};
        const na = '<span class="mmc-hint">Not available</span>';
        const words = { connected: 'Connected', connecting: 'Connecting', restarting: 'Services not available (restarting)', 'signed-out': 'Logon required', off: 'Disconnected by the user', 'no-internet': 'No Internet access', unavailable: 'Cannot connect to the server' };
        let latency = na;
        if (up && ws && Number.isFinite(ws.currentRtt)) {
            latency = `${Math.round(ws.currentRtt)} ms`;
            if (Number.isFinite(ws.rttVariability) && ws.currentRtt > 0) latency += ` <span class="mmc-hint">(\u00b1${Math.round((ws.rttVariability / ws.currentRtt) * 100)}%)</span>`;
        }
        const connection = c.props([
            ['Status', c.state(up, `${words[s.service] || 'Unavailable'}${up && s.cafeReady ? ' (with Caf\u00e9Ready)' : ''}`, !up && s.service !== 'connecting')],
            ['Connection name', esc(i.connectionName || 'Nightshade Network')],
            ['Domain', esc(i.domain || 'DREAMSCAPE')],
            ['Server name', esc(i.fqdn || '') || na],
            ['Device', esc(device)],
            ['Duration', up && s.connectedAt ? esc(nsDuration(Date.now() - s.connectedAt)) : na],
            ['Latency', latency],
            ['Encryption', root.location && root.location.protocol === 'https:' ? 'TLS (HTTPS)' : 'None'],
            ['Messages', `${esc(Number(st.messagesOut || 0).toLocaleString())} sent, ${esc(Number(st.messagesIn || 0).toLocaleString())} received`],
            ['Data', up ? `${esc(nsBytes(st.bytesOut))} sent, ${esc(nsBytes(st.bytesIn))} received` : na]
        ]);
        const sv = ws && ws.lastServerStartupStatus;
        const caps = (sv && sv.capabilities) || {};
        const onOff = (on) => (on ? 'On' : 'Off');
        const dc = c.props([
            ['Domain controller', sv ? (sv.isReady ? c.state(true, 'Ready') : c.state(false, `Starting (${sv.stageMessage || 'please wait'})`, true)) : na],
            ['Session service', sv ? onOff(caps.websocket) : na],
            ['Image generation', sv ? onOff(caps.generation) : na],
            ['Static content', sv ? onOff(caps.staticAssets) : na],
            ['Client files', sv && sv.runtimeCompileComplete !== undefined ? (sv.runtimeCompileComplete ? 'Up to date' : 'Compiling') : na],
            ['Server Up Time', state.sum ? esc(upTime(state.sum.processUptimeSec)) : na],
            ['Signed-in clients', clientsHtml(state.sum) || na]
        ]);
        const sections = [
            { id: 'sm-ns-conn', title: 'This Computer\u2019s Connection', body: block('', connection, [
                link('ns:client', 'Open Nightshade Network Client', NS16),
                link('ns:reconnect', 'Reconnect This Computer', NS16),
                link('cpl:network', 'View Network Connections', `${ITEMS}/network-and-sharing-center-16.png`)
            ]) },
            { id: 'sm-ns-dc', title: 'Domain Controller', body: block('', dc, [link('tool:eventvwr', 'Go to Event Viewer', `${APPS}/16/vista-event-viewer.webp`)]) }
        ];
        return withIntro(c.page('Nightshade Network', '', sections), NS32, 'View the Nightshade Network service as this server runs it: this computer\u2019s connection, the domain controller\u2019s services and the signed-in clients.');
    }

    // ---- Hardware and Sensors (#896): hwmon readings pushed while the page shows -------------------

    const SENSOR_ORDER = { temperature: 0, fan: 1, voltage: 2, power: 3, clock: 4 };
    // the drivers' own labels in a reader's words (the driver's label stays in brackets)
    const SENSOR_NAMES = {
        Tctl: 'Processor', Tdie: 'Processor die', Tccd1: 'Core complex 1', Tccd2: 'Core complex 2',
        'Package id 0': 'Processor package', edge: 'Graphics', junction: 'Graphics hot spot', mem: 'Graphics memory',
        sclk: 'Graphics clock', mclk: 'Graphics memory clock', vddgfx: 'Graphics core voltage', vddnb: 'Northbridge voltage',
        PPT: 'Processor package power', Composite: 'Drive'
    };
    function sensorName(row) {
        const l = String(row.label || '');
        if (SENSOR_NAMES[l]) return `${SENSOR_NAMES[l]} (${l})`;
        const core = /^Core (\d+)$/.exec(l);
        return core ? `Processor core ${core[1]}` : l;
    }
    function sensorIcon(row) {
        const d = String(row.device || '').toLowerCase();
        if (/processor/.test(d)) return `${DEV}/processors-16.png`;
        if (/graphics/.test(d)) return `${DEV}/display-adapters-16.png`;
        if (/drive|nvme/.test(d)) return `${DEV}/disk-drives-16.png`;
        if (/ethernet|wi-fi|network/.test(d)) return `${DEV}/network-adapters-16.png`;
        if (/battery/.test(d)) return `${DEV}/batteries-16.png`;
        return SENS16;
    }

    /**
     * A statusHub feed shown on one page (rule server-push-not-polling): subscribed while its page
     * shows, its pushes merged into rows, unsubscribed when the page or the console goes. Hardware
     * and Sensors (#896) and Clients (#898).
     */
    function feedWatcher(feed, pushType, nodeId) {
        const w = { rows: new Map(), on: false, error: '', meta: {} };
        let wired = false;
        const repaint = () => {
            const c = state.console;
            if (c && c.node === nodeId && c.modal && c.modal.isConnected) c.refresh();
        };
        const apply = (items, removed) => {
            if (items && typeof items === 'object') {
                for (const [k, v] of Object.entries(items)) {
                    if (k.startsWith('#')) w.meta[k.slice(1)] = v;
                    else if (v && typeof v === 'object') w.rows.set(k, v);
                }
            }
            (removed || []).forEach((k) => w.rows.delete(k));
        };
        w.want = async (on) => {
            const ws = root.wsClient;
            if (on === w.on || !ws || typeof ws.sendMessage !== 'function') return;
            w.on = on;
            if (!on) { try { await ws.sendMessage('status_unsubscribe', { feed }, false); } catch (_) { /* gone */ } return; }
            if (!wired && typeof ws.on === 'function') {
                wired = true;
                ws.on(pushType, (msg) => {
                    if (!w.on || !msg) return;
                    const d = msg.changed ? msg : (msg.data || {});
                    apply(d.changed, d.removed);
                    repaint();
                });
                // the server forgets a dropped socket's subscriptions
                ws.on('connected', () => { if (w.on) { w.on = false; void w.want(true); } });
            }
            try {
                const r = await ws.sendMessage('status_subscribe', { feed }, false);
                w.rows.clear();
                apply(r && (r.items || (r.data && r.data.items)));
                w.error = '';
            } catch (err) {
                w.on = false;
                w.error = (err && err.message) || 'The server did not answer.';
            }
            repaint();
        };
        return w;
    }
    const sensorsFeed = feedWatcher('hardware_sensors', 'hardware_sensors_status', 'sensors');
    const clientsFeed = feedWatcher('server_clients', 'server_clients_status', 'clients');

    function sensorsPage(c) {
        if (!sensorsFeed.on && isAdmin()) void sensorsFeed.want(true);
        const rows = [...sensorsFeed.rows.values()]
            .sort((a, b) => String(a.device).localeCompare(String(b.device)) || (SENSOR_ORDER[a.type] - SENSOR_ORDER[b.type]) || String(a.label).localeCompare(String(b.label)));
        const val = (v, unit) => (v === null || v === undefined ? '' : `${v} ${unit}`);
        const STATUS = { ok: 'Normal', warning: 'Over maximum', critical: 'Critical', stopped: 'Stopped' };
        const cols = [
            { t: 'Sensor', w: 200, key: 'label', text: (d) => sensorName(d) },
            { t: 'Device', w: 150, key: 'device', text: (d) => d.device },
            { t: 'Value', w: 90, key: 'value', num: true, text: (d) => val(d.value, d.unit) },
            { t: 'Maximum', w: 90, key: 'max', num: true, text: (d) => val(d.max, d.unit) },
            { t: 'Critical', w: 90, key: 'crit', num: true, text: (d) => val(d.crit, d.unit) },
            { t: 'Status', w: 110, key: 'state', html: (d) => c.state(d.state === 'ok', STATUS[d.state] || 'Normal', d.state !== 'ok') }
        ];
        const list = c.listView(cols, rows.map((r) => ({ key: r.id, icon: sensorIcon(r), data: r })), {
            sortId: 'sm-sensors',
            empty: sensorsFeed.error ? `The sensors could not be read. ${sensorsFeed.error}` : (sensorsFeed.on ? 'This computer reports no hardware sensors.' : 'Reading the sensors...')
        });
        const fans = rows.some((r) => r.type === 'fan');
        const hot = rows.filter((r) => r.state === 'warning' || r.state === 'critical').length;
        const summary = rows.length
            ? `<p><b>${rows.length}</b> sensor${rows.length === 1 ? '' : 's'} on ${esc(sensorsFeed.meta.host || hostName())}${hot ? `, ${c.state(false, `${hot} over a limit`, true)}` : ''}.${fans ? '' : ' <span class="mmc-hint">This computer does not report its fans.</span>'}</p>`
            : '';
        return withIntro(c.page('Hardware and Sensors', '', [{ id: 'sm-sensors-list', title: 'Sensors', body: summary + list }]), SENS32,
            'Monitor the temperatures, fans, voltages and power of the server\u2019s hardware. The readings update while this page is open.');
    }

    // ---- Clients (#898): every connected client, pushed while the page shows ------------------------

    const CLIENTS16 = `${DEV}/computer-16.png`;
    const CLIENTS32 = `${DEV}/computer-32.png`;

    function selfClientId() {
        try { return sessionStorage.getItem((root.WebSocketClient && root.WebSocketClient.AGENT_CLIENT_ID_KEY) || 'dreamscape.agentClientId') || ''; } catch (_) { return ''; }
    }

    /** "Windows, Chrome" from a user agent (the 80 characters the server keeps). */
    function platformOf(ua) {
        const u = String(ua || '');
        const os = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Macintosh|Mac OS/.test(u) ? 'Mac' : /CrOS/.test(u) ? 'ChromeOS' : /Linux|X11/.test(u) ? 'Linux' : '';
        const br = /HeadlessChrome/.test(u) ? 'Headless Chrome' : /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : /DreamscapeFrame|VirtualSideShow/.test(u) ? 'Device app' : '';
        return [os, br].filter(Boolean).join(', ');
    }

    function clientName(r) {
        if (r.kind || r.name) {
            const kind = r.kind ? String(r.kind).replace(/^\w/, (ch) => ch.toUpperCase()) : '';
            if (!r.name || String(r.name).toLowerCase() === String(r.kind || '').toLowerCase()) return `${kind || r.name} device`;
            return `${r.name}${kind ? ` (${kind})` : ''}`;
        }
        const ua = r.userAgentFull || r.userAgent || '';
        const where = platformOf(ua);
        // a DeX window is an Android page too: Continuity first; a phone tab without its phone state yet
        // (just reconnected) still reads as a phone by its user agent
        const what = r.light ? 'Light client' : r.continuity ? 'Continuity PC' : (r.phone || /Android|iPhone/.test(ua)) ? 'Phone' : 'Desktop';
        return `${what}${where ? ` (${where})` : ''}`;
    }

    function clientStateText(r) {
        if (!r.authenticated) return 'Not signed in';
        if (r.dormant) return 'Idle (screen off)';
        const words = { ready: 'Ready', desktop: 'Desktop', logon: 'At logon', booting: 'Starting', locked: 'Locked' };
        if (r.phone || r.kind) return 'Ready';
        return words[r.desktopState] || (r.light ? 'Connected' : 'Connected');
    }

    function ago(iso) {
        const t = iso ? Date.parse(iso) : NaN;
        if (!Number.isFinite(t)) return '';
        const s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return 'Just now';
        if (s < 3600) return `${Math.floor(s / 60)} min ago`;
        if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
        return `${Math.floor(s / 86400)} d ago`;
    }

    /** A workspace's name for its id (referenceUtils.js getWorkspaceDisplayName), the id otherwise. */
    function workspaceName(id) {
        if (!id) return '';
        try { if (typeof root.getWorkspaceDisplayName === 'function') return root.getWorkspaceDisplayName(id) || id; } catch (_) { /* below */ }
        return id;
    }

    function clientsPage(c) {
        if (!clientsFeed.on && isAdmin()) void clientsFeed.want(true);
        const me = selfClientId();
        const rows = [...clientsFeed.rows.values()].map((r) => ({ ...r, self: r.clientId === me }));
        const cols = [
            { t: 'Client', w: 230, key: 'label', text: (d) => `${d.label}${d.self ? ' (this computer)' : ''}` },
            { t: 'User', w: 90, key: 'userType', text: (d) => (d.userType === 'admin' ? 'Administrator' : d.userType || '') },
            { t: 'Address', w: 120, key: 'address', text: (d) => d.address || '' },
            { t: 'Workspace', w: 130, key: 'workspace', text: (d) => d.workspace },
            { t: 'Status', w: 120, key: 'status', html: (d) => c.state(d.authenticated, clientStateText(d), true) },
            { t: 'Connected', w: 100, key: 'connectedAt', text: (d) => ago(d.connectedAt) },
            { t: 'Last Activity', w: 100, key: 'lastActivity', text: (d) => ago(d.lastActivity) }
        ];
        const list = c.listView(cols, rows.map((r) => ({ key: r.clientId, icon: r.phone ? `${DEV}/portable-16.png` : r.kind ? `${DEV}/monitors-16.png` : CLIENTS16, data: { ...r, label: clientName(r), status: clientStateText(r), workspace: workspaceName(r.workspaceId) } })), {
            sortId: 'sm-clients',
            sort: { key: 'lastActivity', dir: -1 },
            empty: clientsFeed.error ? `The clients could not be read. ${clientsFeed.error}` : (clientsFeed.on ? 'No clients are connected.' : 'Reading the clients...')
        });
        const n = rows.length;
        const summary = n ? `<p><b>${n}</b> client${n === 1 ? '' : 's'} connected. Select one to resync it or disconnect it.</p>` : '';
        return withIntro(c.page('Clients', '', [{ id: 'sm-clients-list', title: 'Connected Clients', body: summary + list }]), CLIENTS32,
            'View every client connected to this server - desktops, phones, light clients and devices - with their status. Resync a client to reload its data, or disconnect it from the Nightshade Network.');
    }

    async function clientAction(c, act, id) {
        const r = clientsFeed.rows.get(id);
        const name = r ? clientName(r) : 'this client';
        if (act === 'disconnect') {
            const self = id === selfClientId();
            const ok = typeof root.showConfirmationDialog === 'function'
                ? await root.showConfirmationDialog(
                    self
                        ? 'Disconnect this computer from the Nightshade Network?\n\nIt stays disconnected until you connect it again from the Nightshade Network Client.'
                        : `Disconnect ${name} from the Nightshade Network?\n\nIt stays disconnected until someone connects it again on that device.`,
                    [{ text: 'Disconnect', value: true, className: 'btn-standard' }, { text: 'Cancel', value: false, className: 'btn-standard primary' }],
                    null, { title: TITLE, icon: 'fas fa-exclamation-triangle', sound: true })
                : false;
            if (ok !== true) return;
        }
        try {
            const res = await root.wsClient.sendMessage('server_client_action', { clientId: id, action: act }, false);
            const d = (res && res.data && 'success' in res.data) ? res.data : res;
            if (!d || d.success === false) throw new Error((d && d.error) || 'The server did not answer.');
            c.note(act === 'resync' ? `${name} is resyncing.` : `${name} was disconnected.`);
        } catch (err) {
            if (typeof root.showConfirmationDialog === 'function') {
                await root.showConfirmationDialog(`The client could not be ${act === 'resync' ? 'resynced' : 'disconnected'}. ${(err && err.message) || ''}`.trim(),
                    [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: TITLE, icon: 'fas fa-times-circle' });
            }
        }
    }

    /** The server machine from get_system_info (host.*, disk, gitHash), in System's words (cplSystem.js). */
    function machineFacts(sys) {
        const T = root.cplSystem && root.cplSystem._test;
        const host = (sys && sys.host) || {};
        const fmt = (b) => (T && typeof T.formatMemory === 'function' ? T.formatMemory(b) : (Number(b) > 0 ? `${(Number(b) / 1073741824).toFixed(2)} GB` : ''));
        const facts = T && typeof T.hostFacts === 'function' ? T.hostFacts(sys) : { processor: host.cpuModel || '', clock: '', memory: fmt(host.totalMemBytes), type: host.arch || '' };
        const disk = (sys && sys.disk) || {};
        const diskText = Number(disk.totalBytes) > 0
            ? `${fmt(disk.freeBytes)} free of ${fmt(disk.totalBytes)}${disk.fileSystem ? ` (${disk.fileSystem})` : ''}`
            : (disk.total ? `${disk.free || '?'} free of ${disk.total}` : '');
        return {
            processor: [facts.processor, host.cpuCores ? `${host.cpuCores} cores` : '', facts.clock].filter(Boolean).join(', '),
            memory: facts.memory || '',
            type: facts.type || '',
            os: host.osName || [host.osType, host.osRelease].filter(Boolean).join(' '),
            node: host.nodeVersion || '',
            build: sys && sys.gitHash && sys.gitHash !== 'Unknown' ? sys.gitHash : '',
            disk: diskText,
            booted: host.bootedAt || null
        };
    }

    function rootPage(c) {
        const s = state.sum;
        const info = netInfo();
        const wait = state.loading && !s ? '<p>Reading data, please wait...</p>' : '';
        const na = '<span class="mmc-hint">Not available</span>';
        const clients = clientsHtml(s) || na;
        const computer = c.props([
            ['Full Computer Name', esc(s && s.host ? s.host : (info.fqdn || '')) || na],
            ['Domain', esc(info.domain || 'DREAMSCAPE')],
            [info.connectionName || 'Nightshade Network', linkUp() ? 'Connected' : c.state(false, 'Disconnected', true)],
            ['Operating System', s && s.platform ? esc(s.platform) : na],
            ['Dreamscape Version', s && s.version ? esc(s.version) : na],
            ['Server Up Time', s ? esc(upTime(s.processUptimeSec)) : na],
            ['System Up Time', s ? esc(upTime(s.osUptimeSec)) : na],
            ['Connected Clients', clients]
        ]);
        const m = machineFacts(state.sys);
        const machine = c.props([
            ['Processor', m.processor ? esc(m.processor) : na],
            ['Memory (RAM)', m.memory ? esc(m.memory) : na],
            ['System Type', m.type ? esc(m.type) : na],
            ['Operating System Name', m.os ? esc(m.os) : na],
            ['Node.js', m.node ? esc(m.node) : na],
            ['Dreamscape Build', m.build ? esc(m.build) : na],
            ['Disk (C:)', m.disk ? esc(m.disk) : na]
        ]);
        const fg = frontGate();
        const security = c.props([
            ['Front Gate', fg ? (fg.enabled ? `On${fg.cover ? ` <span class="mmc-hint">(${esc(fg.cover)})</span>` : ''}` : 'Off') : na],
            ['Signed in as', esc((() => { try { return localStorage.getItem('userType') === 'admin' ? 'Administrator' : (localStorage.getItem('userType') || 'User'); } catch (_) { return 'User'; } })())]
        ]);
        const err = state.sumError && !s ? `<p>${c.state(false, `The server summary could not be read. ${state.sumError}`, true)}</p>` : '';
        const roleList = ROLES.map(([key, name]) => link(`nav:${hostId(c, key)}`, name, roleIcon(key))).join('');
        const featList = FEATURES.map(([id, name, icon]) => link(`tool:${id}`, name, icon)).join('');
        const sections = [
            { id: 'sm-server', title: 'Server Summary', body: (err || wait)
                + block('Computer Information', computer, [
                    link('cpl:system', 'Change System Properties', `${ITEMS}/system-16.png`),
                    link('cpl:network', 'View Network Connections', `${ITEMS}/network-and-sharing-center-16.png`),
                    link('tool:remote', 'Configure Remote Access', `${VI}/remote-access-16.png`)
                ])
                + block('System Information', machine, [
                    link('nav:sensors', 'Go to Hardware and Sensors', SENS16)
                ])
                + block('Security Information', security, [
                    link(`nav:${hostId(c, 'frontgate')}`, 'Go to Front Gate', `${ITEMS}/firewall-16.png`),
                    link('tool:defender', 'Go to Melaton Defender', `${ITEMS}/defender-16.png`),
                    link(`nav:${hostId(c, 'keys')}`, 'Go to Key Manager', roleIcon('keys'))
                ]) },
            { id: 'sm-roles', title: 'Roles Summary', body: block('', `<p><b>Roles:</b> ${ROLES.length} of ${ROLES.length} installed</p><div class="sm-items">${roleList}</div>`, [link('nav:roles', 'Go to Roles', SERVER16)]) },
            { id: 'sm-features', title: 'Features Summary', body: block('', `<p><b>Features:</b> ${FEATURES.length} of ${FEATURES.length} installed</p><div class="sm-items">${featList}</div>`, [link('nav:features', 'Go to Features', `${ITEMS}/programs-and-features-16.png`)]) },
            { id: 'sm-support', title: 'Resources and Support', body: block('', `<div class="sm-items">${[
                link('help', 'Help and Support', '/static_images/vista-explorer/help-16.png'),
                link('web:yozora', 'Dreamscape on Yozora', GLOBE16),
                link('tool:welcome', 'Welcome Center', `${ITEMS}/welcome-center-16.png`)
            ].join('')}</div>`, []) }
        ];
        return withIntro(c.page(TITLE, '', sections), ICON32, 'Get an overview of the status of this server, perform top management tasks, and go to the server\'s roles and features.');
    }

    function rolesPage(c) {
        const sections = [{
            id: 'sm-roles-summary', title: 'Roles Summary', body: block('', `<p><b>Roles:</b> ${ROLES.length} of ${ROLES.length} installed</p><div class="sm-items">${ROLES.map(([key, name]) => link(`nav:${hostId(c, key)}`, name, roleIcon(key))).join('')}</div>`, [])
        }].concat(ROLES.map(([key, name, , , desc]) => ({
            id: `sm-role-${key}`, title: name,
            body: block('', `<p>${esc(desc)}</p>`, [link(`nav:${hostId(c, key)}`, `Go to ${name}`, roleIcon(key))])
        })));
        return withIntro(c.page('Roles', '', sections), SERVER32, 'View the status of the roles installed on this server, and go to each role\'s console.');
    }

    function featuresPage(c) {
        const cols = [
            { t: 'Name', w: 220, key: 'name', text: (d) => d.name },
            { t: 'Description', w: 380, key: 'desc', text: (d) => d.desc }
        ];
        const rows = FEATURES.map(([id, name, icon, , desc]) => ({ key: `tool:${id}`, icon, data: { name, desc } }));
        const list = c.listView(cols, rows, { sortId: 'sm-features', sort: { key: 'name', dir: 1 } });
        return withIntro(c.page('Features', '', [{
            id: 'sm-features-summary', title: 'Features Summary',
            body: `<p><b>Features:</b> ${FEATURES.length} of ${FEATURES.length} installed</p>${list}`
        }]), `${ITEMS}/programs-and-features-32.png`, 'View the features installed on this server. Double-click a feature to open it.');
    }

    /** Diagnostics / Configuration: their items, as Computer Management's folders list theirs. */
    function folderPage(c, node) {
        const cols = [
            { t: 'Name', w: 200, key: 'name', text: (d) => d.name },
            { t: 'Description', w: 400, key: 'desc', text: (d) => d.desc || '' }
        ];
        const rows = (node.children || []).map((n) => ({ key: n.id, icon: n.icon, data: n, open: n.id }));
        return { html: c.listView(cols, rows), list: true };
    }

    /** A window of its own (or a snap-in that is not loaded): what it is, and Open. */
    function launcherPage(c, node) {
        const t = TOOLS.get(node.id);
        const r = ROLES.find((x) => x[0] === node.id);
        const p = PARTS.find((x) => x[0] === node.id);
        const name = t ? t[1] : r ? r[1] : p ? p[2] : node.name;
        const desc = t ? t[4] : r ? r[4] : node.desc || '';
        const img = t ? t[3] : r ? roleIcon(r[0]) : SERVER32;
        return c.page(name, '', [{
            id: `sm-open-${node.id}`, title: name,
            body: `${c.overview(img, [esc(desc)])}<div class="mmc-buttons"><button type="button" class="btn-standard" data-act="open:${esc(node.id)}">Open ${esc(name)}</button></div>`
        }]);
    }

    function page(node, c) {
        state.console = c;
        // a feed runs only while its page shows
        if (node.id !== 'sensors' && sensorsFeed.on) void sensorsFeed.want(false);
        if (node.id !== 'clients' && clientsFeed.on) void clientsFeed.want(false);
        switch (node.id) {
            case 'clients': return clientsPage(c);
            case 'nightshade': return nightshadePage(c);
            case 'sensors': return sensorsPage(c);
            case 'root': return rootPage(c);
            case 'roles': return rolesPage(c);
            case 'features': return featuresPage(c);
            case 'diagnostics':
            case 'configuration': return folderPage(c, node);
            default: return launcherPage(c, node);
        }
    }

    // ---- commands ---------------------------------------------------------------------------------

    function commands(node) {
        const id = node && node.id;
        if (id === 'root') return [{ text: 'Configure Remote Access', action: 'tool:remote' }, { text: 'View Network Connections', action: 'cpl:network' }, { text: 'Change System Properties', action: 'cpl:system' }];
        if (id === 'nightshade') return [{ text: 'Open Nightshade Network Client', action: 'ns:client' }, { text: 'Reconnect This Computer', action: 'ns:reconnect' }, { text: 'Refresh', action: 'refresh' }];
        if (id === 'sensors' || id === 'clients') return [{ text: 'Refresh', action: 'refresh' }];
        if (TOOLS.has(id) || ROLES.some((r) => r[0] === id) || PARTS.some((p) => p[0] === id)) {
            const n = TOOLS.get(id);
            return [{ text: `Open ${n ? n[1] : node.name}`, action: `open:${id}` }];
        }
        return [];
    }

    function selCommands(node, key) {
        if (node && node.id === 'clients' && key) {
            const r = clientsFeed.rows.get(String(key));
            if (!r) return null;
            return { title: clientName(r), items: [
                { text: 'Resync', action: `client:resync:${key}` },
                { text: 'Disconnect...', action: `client:disconnect:${key}` }
            ] };
        }
        if (!node || node.id !== 'features' || !key || !String(key).startsWith('tool:')) return null;
        const t = TOOLS.get(String(key).slice(5));
        return t ? { title: t[1], items: [{ text: 'Open', action: key }] } : null;
    }

    function openRole(key) {
        const r = ROLES.find((x) => x[0] === key);
        if (r) void call(r[3]);
    }

    function openPart(key) {
        if (key === 'storage') void call('openDataManagementSnapin', 'storage');
        else if (key === 'workers') void call('openDataManagementSnapin', 'workers');
        else if (key === 'replication') void call('openDataManagementSnapin', 'replication');
    }

    async function action(a, c) {
        if (a === 'refresh') {
            if (c.node === 'root' || c.node === 'nightshade') { await load(c); return true; }
            if (c.node === 'sensors' || c.node === 'clients') { c.refresh(); return true; }
            return false;
        }
        if (a === 'ns:client') { call('openNightshadeClient'); return true; }
        const ca = /^client:(resync|disconnect):(.+)$/.exec(a);
        if (ca) { await clientAction(c, ca[1], ca[2]); return true; }
        if (a === 'ns:reconnect') {
            const ws = root.wsClient;
            if (ws && typeof ws.manualReconnect === 'function') ws.manualReconnect();
            return true;
        }
        if (a === 'help') { call('openHelpAndSupport', 'server-manager'); return true; }
        if (a.startsWith('tool:')) {
            const id = a.slice(5);
            if (id === 'welcome') { call('openWelcomeCenter'); return true; }
            const t = TOOLS.get(id);
            if (t) await t[5]();
            return true;
        }
        if (a.startsWith('cpl:')) { await cpl(a.slice(4))(); return true; }
        if (a === 'web:yozora') {
            /* global START_MENU_HELP_URL */
            const url = typeof START_MENU_HELP_URL !== 'undefined' ? START_MENU_HELP_URL : 'https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge';
            call('openGrimoireUrl', url);
            return true;
        }
        if (a.startsWith('open:')) {
            const id = a.slice(5);
            if (TOOLS.has(id)) await TOOLS.get(id)[5]();
            else if (ROLES.some((r) => r[0] === id)) openRole(id);
            else openPart(id);
            return true;
        }
        return false;
    }

    function status(node) {
        switch (node && node.id) {
            case 'root': return state.loading ? 'Reading data, please wait...' : (state.sumError && !state.sum ? 'The server summary could not be read.' : '');
            case 'roles': return `${ROLES.length} roles`;
            case 'sensors': return sensorsFeed.on ? `${sensorsFeed.rows.size} sensors` : 'Reading the sensors...';
            case 'clients': return clientsFeed.on ? `${clientsFeed.rows.size} clients` : 'Reading the clients...';
            case 'features': return `${FEATURES.length} features`;
            case 'diagnostics':
            case 'configuration': return `${(node.children || []).length} items`;
            default: return '';
        }
    }

    // ---- the console --------------------------------------------------------------------------------

    function baseDef() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            treeWidth: 200,
            expanded: ['root'],
            nodes,
            page,
            commands,
            selCommands,
            toolbar: (node) => (['root', 'nightshade', 'sensors', 'clients'].includes(node.id) ? [{ id: 'refresh', i: 3, title: 'Refresh' }] : []),
            action,
            rowOpen: (key, node, c) => { if (node.id === 'features' && String(key).startsWith('tool:')) void action(key, c); },
            status,
            help: () => call('openHelpAndSupport', 'server-manager'),
            about: { version: '1.0.0', lines: ['Server Manager holds Dreamscape\'s consoles in one tree: its roles, features, diagnostics, configuration and storage.'] },
            onOpen: (c) => { void load(c); },
            onClose: () => {
                state.sum = null;
                state.console = null;
                if (sensorsFeed.on) void sensorsFeed.want(false);
                if (clientsFeed.on) void clientsFeed.want(false);
            }
        };
    }

    /** The snap-ins hosted here ({ key, def } for mmcConsole.compose). */
    function embeds() {
        const out = [];
        ROLES.forEach(([key, , global]) => {
            const m = root[global];
            if (!m || typeof m.def !== 'function') return;
            try {
                const d = m.def();
                if (d && typeof d.nodes === 'function' && typeof d.page === 'function') out.push({ key, def: d });
            } catch (err) { console.error(`${TITLE}: ${key} snap-in`, err); }
        });
        const dm = root.mmcDataManagement;
        if (dm && typeof dm.partDef === 'function') {
            PARTS.forEach(([key, part]) => {
                try {
                    const d = dm.partDef(part, part === 'storage' ? { skip: STORAGE_SKIP } : {});
                    if (d && typeof d.nodes === 'function' && typeof d.page === 'function') out.push({ key, def: d });
                } catch (err) { console.error(`${TITLE}: Computer Management ${part}`, err); }
            });
        }
        return out;
    }

    function def() {
        const list = root.mmcConsole && typeof root.mmcConsole.compose === 'function' ? embeds() : [];
        state.hosted = new Set(list.map((e) => e.key));
        hostIds.clear();
        return list.length ? root.mmcConsole.compose(baseDef(), list) : baseDef();
    }

    /** 'frontgate', 'eventvwr', 'storage' ... or a node id of the console. */
    function nodeFor(c, target) {
        const t = String(target || '').trim();
        if (!t) return null;
        if (c && typeof c.find === 'function' && c.find(t)) return t;
        if (ROLES.some((r) => r[0] === t) || PARTS.some((p) => p[0] === t)) return hostId(c, t);
        return TOOLS.has(t) ? t : null;
    }

    async function openServerManager(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (root.mmcDataManagement && typeof root.mmcDataManagement.ensureAssets === 'function') {
            try { await root.mmcDataManagement.ensureAssets(); } catch (err) { console.error(`${TITLE}: Computer Management scripts`, err); }
        }
        if (!root.mmcConsole) return null;
        // a console already open keeps the snap-ins it was built with
        const open = root.mmcConsole.get(ID);
        const live = open && open.modal && open.modal.isConnected;
        const c = root.mmcConsole.open(live ? open.def : def());
        const target = node ? nodeFor(c, node) : null;
        if (c && target && c.node !== target) c.select(target, true);
        return c;
    }

    // the Nightshade Network page follows the service's state (#895); the listener ends with this file's
    // segment (app-scope, #872/#890)
    if (root.addEventListener) {
        const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
        root.addEventListener('nightshade:state', () => {
            const c = state.console;
            if (c && c.node === 'nightshade' && c.modal && c.modal.isConnected) c.refresh();
        }, { signal: appScopeSignal });
    }

    root.openServerManager = openServerManager;
    root.mmcServerManager = { open: openServerManager, def, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
