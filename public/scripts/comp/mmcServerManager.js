/**
 * Server Manager (Yozora #831 slice 5): one MMC console that holds every other console in a single
 * tree, laid out as Windows Server 2008's Server Manager (servermanager.msc). It replaced the old
 * Server Manager dashboard (dsap://dreamscape.jp/, a link list) on the Vista desktop:
 *
 *   Server Manager (<HOST>)   the summary: Server Summary (Computer Information, Security
 *                             Information), Roles Summary, Features Summary, Resources and Support
 *     Roles                   the role consoles, each a hosted snap-in (mmcConsole.compose):
 *                             Autofill Ranking, Dynamic Quips, Enshutsuka, Exchange, Front Gate,
 *                             Key Manager, Print Management
 *     Features                the programs and pages that are not consoles (Image Search, Messaging
 *                             Bridge, Melaton Mobile Device Center, Melaton Messenger, Pantry, Zanzou)
 *     Diagnostics             Event Viewer, Reliability and Performance, Device Manager (windows of
 *                             their own: a page with Open, as Computer Management does for snap-ins it
 *                             cannot host) and Workers (Computer Management's, hosted)
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
    const ICON16 = `${APPS}/16/vista-server-manager.png`;
    const ICON32 = `${APPS}/32/vista-server-manager.png`;
    const ICON48 = `${APPS}/48/vista-server-manager.png`;
    const SERVER16 = '/static_images/melaton/net-server-16.png';
    const SERVER32 = '/static_images/melaton/net-server-32.png';
    const GLOBE16 = `${VI}/internet-globe-16.png`;
    const GLOBE32 = `${VI}/internet-globe-32.png`;

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
        ['ispy', 'Image Search', `${APPS}/16/vista-search.png`, `${APPS}/32/vista-search.png`, 'Search prompts and metadata across the workspaces.', () => launch('ispy') || call('openDsapInGrimoire', 'dsap://ispy.dreamscape.jp/')],
        ['msgbridge', 'Messaging Bridge', '/melaton-apps/msgbridge/assets/msgbridge-16.png', '/melaton-apps/msgbridge/assets/msgbridge-32.png', 'Relays messages between the mail server and the messaging services.', pkg('msgbridge')],
        ['mdc', 'Melaton Mobile Device Center', `${APPS}/16/mobile-device-center.png`, `${APPS}/32/mobile-device-center.png`, 'Phones running the Dreamscape app: partnerships, sync and files.', pkg('activesync')],
        ['messenger', 'Melaton Messenger', `${APPS}/16/melaton-messenger.png`, `${APPS}/32/melaton-messenger.png`, 'Text Messaging accounts: iMessage through BlueBubbles, and RCS.', pkg('messenger')],
        ['pantry', 'Pantry', GLOBE16, GLOBE32, 'Cake ledger, work pile, and breakfast before and after.', dsap('dsap://pantry.dyna.dreamscape.jp/status')],
        ['zanzou', 'Zanzou', GLOBE16, GLOBE32, 'Afterimages. Keep the shot, scrap the ghosts.', dsap('dsap://zanzou.dyna.dreamscape.jp/')]
    ];

    const DIAGNOSTICS = [
        ['eventvwr', 'Event Viewer', `${APPS}/16/vista-event-viewer.png`, `${APPS}/32/vista-event-viewer.png`, 'The server\'s logs: Dreamscape, the services and the agents.', () => launch('event-viewer')],
        ['perfmon', 'Reliability and Performance', `${APPS}/16/vista-reliability-performance.png`, `${APPS}/32/vista-reliability-performance.png`, 'The server\'s processor, memory, disk and network, live and over time.', () => launch('perfmon')],
        ['devmgmt', 'Device Manager', `${ITEMS}/device-manager-16.png`, `${APPS}/32/vista-device-manager.png`, 'View and update your hardware settings and driver software.', async () => {
            if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
            call('openDeviceManager');
        }]
    ];

    const CONFIGURATION = [
        ['auth', 'Authentication', `${ITEMS}/user-accounts-16.png`, `${ITEMS}/user-accounts-32.png`, 'How people sign in: PINs, passkeys and Dreamscape CardSpace.', async () => {
            if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
            if (root.cplAuthentication) root.cplAuthentication.open();
        }],
        ['defender', 'Melaton Defender', `${APPS}/16/vista-defender.png`, `${APPS}/32/vista-defender.png`, 'Blocked clients, honeypot addresses, allowed clients and the sign-in history.', async () => {
            if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
            if (root.windowsDefender) root.windowsDefender.open('home');
        }],
        ['remote', 'Remote Access', `${VI}/remote-access-16.png`, `${VI}/remote-access-32.png`, 'How agents deliver and open pictures on this computer, and the MCP connector.', () => {
            if (root.remoteAccessProperties) root.remoteAccessProperties.open();
            else call('openRemoteAccessSettingsModal');
        }],
        ['runes', 'Runes', `${APPS}/16/vista-regedit.png`, `${APPS}/32/vista-regedit.png`, 'The server configuration, edited directly.', () => launch('config-editor')]
    ];

    const TOOLS = new Map(FEATURES.concat(DIAGNOSTICS, CONFIGURATION).map((t) => [t[0], t]));
    // Computer Management's parts (mmcDataManagement.partDef): [embed key, part, name]
    const PARTS = [['storage', 'storage', 'Storage'], ['workers', 'workers', 'Workers'], ['replication', 'replication', 'Replication']];
    // Storage leaves these out: they are Roles here
    const STORAGE_SKIP = ['quips', 'enshutsuka'];

    const state = {
        sum: null,          // server_manager_summary
        sumError: '',
        loading: false,
        refreshed: 0,       // Last Refresh
        hosted: new Set()   // the ROLES / PARTS keys hosted in the open console
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
                {
                    id: 'diagnostics', name: 'Diagnostics', icon: `${ITEMS}/problem-reports-and-solutions-16.png`, desc: 'Logs, performance, devices and the remote services',
                    children: DIAGNOSTICS.map(toolNode).concat([part('workers', 'Workers', SERVER16, 'The remote services Dreamscape uses')])
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

    function rootPage(c) {
        const s = state.sum;
        const info = netInfo();
        const wait = state.loading && !s ? '<p>Reading data, please wait...</p>' : '';
        const na = '<span class="mmc-hint">Not available</span>';
        const clients = s && s.clients ? (() => {
            const k = s.clients;
            const parts = [];
            if (k.desktops) parts.push(`${k.desktops} desktop${k.desktops === 1 ? '' : 's'}`);
            if (k.phones) parts.push(`${k.phones} phone${k.phones === 1 ? '' : 's'}`);
            if (k.devices) parts.push(`${k.devices} device${k.devices === 1 ? '' : 's'}`);
            return `${esc(String(k.signedIn || 0))}${parts.length ? ` <span class="mmc-hint">(${esc(parts.join(', '))})</span>` : ''}`;
        })() : na;
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
        switch (node.id) {
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
        if (TOOLS.has(id) || ROLES.some((r) => r[0] === id) || PARTS.some((p) => p[0] === id)) {
            const n = TOOLS.get(id);
            return [{ text: `Open ${n ? n[1] : node.name}`, action: `open:${id}` }];
        }
        return [];
    }

    function selCommands(node, key) {
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
            if (c.node === 'root') { await load(c); return true; }
            return false;
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
            toolbar: (node) => (node.id === 'root' ? [{ id: 'refresh', i: 3, title: 'Refresh' }] : []),
            action,
            rowOpen: (key, node, c) => { if (node.id === 'features' && String(key).startsWith('tool:')) void action(key, c); },
            status,
            help: () => call('openHelpAndSupport', 'server-manager'),
            about: { version: '1.0.0', lines: ['Server Manager holds Dreamscape\'s consoles in one tree: its roles, features, diagnostics, configuration and storage.'] },
            onOpen: (c) => { void load(c); },
            onClose: () => { state.sum = null; }
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

    root.openServerManager = openServerManager;
    root.mmcServerManager = { open: openServerManager, def, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
