/**
 * Exchange Management Console (Yozora #831): the MMC snap-in that replaced the Exchange Server DSAP
 * (dsap://exchange.dreamscape.jp/ opens it on the Vista desktop), laid out as Exchange Server 2007's
 * console, which is itself MMC 3.0:
 *
 *   Microsoft Exchange            the organization at a glance (the DSAP's Overview): intake, LANTIS
 *                                 Postfix, queue, filters, OCI snapshot, From, WireGuard, spam counts
 *     Organization Configuration
 *       Mailbox                   tabs Signatures | Mail Flow Settings (per-mailbox inbound / outbound)
 *       Hub Transport             tabs Send Connectors (the LANTIS relay) | Anti-spam (block lists,
 *                                 content filters, rejected messages) | Spam Quarantine (release / keep)
 *     Server Configuration        this server: intake, roles, the global inbound / outbound / Yozora toggles
 *     Recipient Configuration     every recipient
 *       Mailbox                   the mailboxes: New Mailbox..., Disable / Enable, Remove, keys, Properties
 *       Distribution Group        aliases and distribution lists: New Distribution Group..., Remove, Properties
 *       Disconnected Mailbox      soft-deleted mailboxes: Connect...
 *     Toolbox                     Queue Viewer, Exchange Audit Log
 *
 * Property sheets (mailbox, distribution group, send connector, server) and dialogs are Vista dialogs
 * (vistaDialogTemplate.openSheet / openDialog); New Mailbox and New Distribution Group are Aero Wizards.
 * Every write goes through the Exchange packets (modules/ws/handlers/255-mailExchangeHandler.js), which
 * let only the Exchange administrators in (Yukimi, Sala, Tsubame).
 *
 *   window.openExchangeManagementConsole(node?)   node: an id below, or an old DSAP tab id
 *   window.mmcExchange.def()                      the snap-in for mmcConsole.compose
 */
(function (root) {
    'use strict';

    const ID = 'exchange';
    const TITLE = 'Exchange Management Console';
    const APPS = '/static_images/app_icons';
    const EX = '/static_images/vista-exchange';
    const VI = '/static_images/vista-icons';
    const CPL = '/static_images/vista-cpl';
    const CON = '/static_images/vista-contacts';
    const ICON16 = `${APPS}/16/vista-exchange-management-console.png`;
    const ICON32 = `${APPS}/32/vista-exchange-management-console.png`;
    const DOMAIN = 'dream.737.jp.net';
    const DEPTS = ['ops', 'dev', 'lab'];

    const IC = {
        org: `${CPL}/network-16.png`,
        server: `${EX}/server-16.png`,
        server32: `${EX}/server-32.png`,
        recipients: `${CPL}/users-16.png`,
        mailbox: `${EX}/mailbox-16.png`,
        mailbox32: `${EX}/mailbox-32.png`,
        transport: `${EX}/transport-16.png`,
        transport32: `${EX}/transport-32.png`,
        user: `${CON}/contact-16.png`,
        user32: `${CON}/contact-32.png`,
        group: `${CON}/group-16.png`,
        group32: `${CON}/group-32.png`,
        forward: `${EX}/forward-16.png`,
        spam: `${EX}/spam-16.png`,
        signature: `${EX}/signature-16.png`,
        tracking: `${EX}/tracking-16.png`,
        queue: `${EX}/queue-16.png`,
        key: `${CPL}/key-16.png`,
        key32: `${CPL}/key-32.png`,
        toolbox: `${CPL}/items/administrative-tools-16.png`,
        warning: `${VI}/warning-16.png`,
        error: `${VI}/error-16.png`
    };

    // dialog styles (Win32)
    const SS = 0x50020000;
    const ETCHED = 0x50000010;
    const ICON = 0x50000003;
    const EDIT = 0x50010080;
    const READONLY = 0x50010880;
    const MULTI = 0x50211044;
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const CHECK = 0x50010003;
    const RADIO_FIRST = 0x50030009;
    const RADIO = 0x50010009;
    const COMBO_EDIT = 0x50210042;
    const LV = 0x5001000D;
    const EDGE = 0x200;

    // the DSAP's addresses: dsap://exchange.dreamscape.jp/<tab> -> a node
    const DSAP_TABS = { overview: 'root', status: 'root', mailboxes: 'mailboxes', aliases: 'groups', lists: 'groups', toggles: 'servers', signatures: 'org-mailbox', relay: 'org-transport', spam: 'org-transport' };
    const NODE_IDS = ['root', 'org', 'org-mailbox', 'org-transport', 'servers', 'recipients', 'mailboxes', 'groups', 'disconnected', 'toolbox'];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const when = (t) => (root.mmcConsole ? root.mmcConsole.when(t) : String(t || ''));

    const state = {
        denied: false,
        error: '',
        loaded: false,
        boxes: null,       // exchange_list_mailboxes
        aliases: [],       // exchange_list_aliases: aliases (every kind)
        lists: [],         // exchange_list_aliases: lists (the stored ones, editable)
        toggles: null,     // exchange_get_toggles
        dash: null,        // exchange_dashboard
        dashError: '',
        spam: null,        // exchange_list_spam
        spamError: '',
        audit: null,       // exchange_audit
        tabs: {}           // node -> the result pane tab
    };

    // ---- the server -------------------------------------------------------------------------------

    async function send(type, data) {
        const client = root.wsClient;
        if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        const r = await client.sendMessage(type, data || {}, false);
        if (r && r.error) throw new Error(r.error);
        return r || {};
    }

    /** A write: the packets want confirm:true (the console asks the administrator first). */
    const write = (type, data) => send(type, Object.assign({}, data || {}, { confirm: true }));

    function isAdmin() {
        if (state.forceAdmin) return true;
        try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; }
    }

    /** The relay's refusal in plain words (the DSAP's exchangeRelayFriendly), or null when it took it. */
    function relayProblem(result) {
        if (!result || result.ok || result.skipped) return null;
        const code = result.code;
        if (code === 'UNKNOWN_MAILBOX') return 'The LANTIS relay does not know that mailbox.';
        if (code === 'UNKNOWN_SERVICE') return 'The LANTIS relay does not know that service.';
        if (code === 'BAD_BODY') return 'The relay accepts only on or off for these settings.';
        if (code === 'ACTOR_REQUIRED') return 'The relay needs an administrator\'s name to change these settings.';
        if (code === 'RELAY_ADMIN_REQUIRED' || code === 'RELAY_ADMIN_TOKEN_MISSING') return 'The relay refused the change: its administrator token is missing or wrong.';
        if (code === 'RELAY_ENDPOINT_MISSING') return 'The LANTIS relay cannot take recipient lists yet (it has no PUT /v1/recipients).';
        return result.friendly || result.error || 'The LANTIS relay refused the change.';
    }

    async function loadLists() {
        const [mb, al, tg] = await Promise.all([
            send('exchange_list_mailboxes', {}),
            send('exchange_list_aliases', {}),
            send('exchange_get_toggles', {})
        ]);
        state.boxes = Array.isArray(mb.mailboxes) ? mb.mailboxes : [];
        state.aliases = Array.isArray(al.aliases) ? al.aliases : [];
        state.lists = Array.isArray(al.lists) ? al.lists : [];
        state.toggles = tg.toggles || { inbound: true, outbound: true, mailboxes: {}, services: {} };
    }

    async function loadDash() {
        try {
            state.dash = await send('exchange_dashboard', {});
            state.dashError = '';
        } catch (err) {
            state.dashError = (err && err.message) || 'The server did not answer.';
        }
    }

    async function loadSpam(c) {
        try {
            state.spam = await send('exchange_list_spam', {});
            state.spamError = '';
        } catch (err) {
            state.spamError = (err && err.message) || 'The server did not answer.';
        }
        if (c) c.refresh();
    }

    async function load(c) {
        // admin only: ask the server nothing without an Exchange administrator (it refuses, loudly)
        if (!isAdmin()) {
            state.denied = true;
            if (c) c.refresh();
            return;
        }
        state.denied = false;
        try {
            await loadLists();
            state.error = '';
        } catch (err) {
            state.error = (err && err.message) || 'The server did not answer.';
        }
        state.loaded = true;
        if (c) c.refresh();
        // the relay's figures take longer (LANTIS answers over WireGuard): the lists show first
        await Promise.all([loadDash(), loadSpam(null)]);
        if (c) c.refresh();
    }

    // ---- the data, as the console shows it --------------------------------------------------------------

    const boxes = () => state.boxes || [];
    const liveBoxes = () => boxes().filter((b) => !b.deleted);
    const goneBoxes = () => boxes().filter((b) => b.deleted);
    const byOwner = (owner) => boxes().find((b) => b.owner === owner) || null;
    const storedList = (local) => state.lists.find((l) => l.localPart === local) || null;
    const groups = () => state.aliases;
    const groupOf = (local) => groups().find((g) => g.localPart === local) || null;
    const mbToggle = (owner) => (state.toggles && state.toggles.mailboxes && state.toggles.mailboxes[owner]) || {};
    const inboundOn = (owner) => mbToggle(owner).inbound !== false;
    const outboundOn = (owner) => mbToggle(owner).outbound !== false;
    const globalIn = () => !state.toggles || state.toggles.inbound !== false;
    const globalOut = () => !state.toggles || state.toggles.outbound !== false;
    const yozoraOut = () => !(state.toggles && state.toggles.services && state.toggles.services.yozora && state.toggles.services.yozora.outbound === false);

    const KIND_TYPES = { human: 'User Mailbox', bot: 'Agent Mailbox', mailroom: 'Mailroom Mailbox' };
    const mailboxType = (b) => KIND_TYPES[b.kind] || 'User Mailbox';
    const GROUP_TYPES = { alias: 'Alias', builtin: 'Built-in Alias', catchall: 'Catch-all Alias', list: 'Distribution List' };
    const groupType = (g) => GROUP_TYPES[g.kind] || 'Alias';
    /** Built-in aliases, the catch-all and lists from the server's configuration are not the console's to change. */
    const groupEditable = (g) => !!g && (g.kind === 'alias' || (g.kind === 'list' && !!storedList(g.localPart)));
    const groupName = (g) => (g.kind === 'list' && storedList(g.localPart) && storedList(g.localPart).name) || g.localPart;

    /** The relay figures the DSAP read from exchange_dashboard. */
    function parts() {
        const dash = state.dash || {};
        const intake = dash.intake || {};
        const relay = dash.relay || {};
        const status = relay.status && relay.status.data;
        const queue = relay.queue && relay.queue.data;
        const senders = relay.senders && relay.senders.data;
        const dkim = relay.dkim || (status && status.oci);
        const bl = relay.blocklists && relay.blocklists.data;
        const rejects = (relay.rejects && relay.rejects.data && relay.rejects.data.rejects) || [];
        const degraded = !!(relay.status && relay.status.degraded);
        const fallbackFrom = `kazari.ops@${DOMAIN}`;
        return {
            intake,
            relay,
            status,
            queue,
            senders,
            dkim,
            bl,
            rejects,
            degraded,
            filters: status && status.filters,
            snapshotAt: senders && senders.refreshed_at,
            wg: status && status.wireguard,
            postfixUp: !!(status && status.postfix && status.postfix.up),
            ociSender: (dkim && dkim.sender) || fallbackFrom,
            yukimiFrom: (status && status.oci && status.oci.sender)
                || (senders && senders.oci && senders.oci.approved && senders.oci.approved[0] && senders.oci.approved[0].email)
                || fallbackFrom
        };
    }

    function age(iso) {
        const ms = Date.parse(iso);
        if (!Number.isFinite(ms)) return '';
        const min = Math.max(0, Math.floor((Date.now() - ms) / 60000));
        if (min < 1) return 'less than a minute ago';
        if (min < 60) return `${plural(min, 'minute', 'minutes')} ago`;
        const hr = Math.floor(min / 60);
        if (hr < 48) return `${plural(hr, 'hour', 'hours')} ago`;
        return `${plural(Math.floor(hr / 24), 'day', 'days')} ago`;
    }

    const postfixText = (p) => (p.postfixUp ? 'Running' : (p.degraded ? 'Not reachable' : 'Stopped'));
    const wgText = (p) => (p.wg && p.wg.up ? 'Connected' : (p.degraded ? 'Unknown' : 'Disconnected'));
    const intakeText = (p) => (p.intake.enabled ? `${p.intake.bind}:${p.intake.port}` : 'Disabled');
    const filtersText = (p) => (p.filters ? Object.entries(p.filters).map(([k, v]) => `${k}: ${v}`).join(', ') : '');

    /** This server's name, as Device Manager names the computer. */
    function serverName() {
        const dm = root.melatonDeviceManager;
        if (dm && typeof dm.computerName === 'function') { try { return dm.computerName(); } catch (_) { /* below */ } }
        const host = (root.location && root.location.hostname) || 'melaton';
        return `DREAMSCAPE-${host.split('.')[0].toUpperCase()}`.slice(0, 15);
    }

    // ---- the console tree ----------------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: 'Microsoft Exchange',
            icon: ICON16,
            children: [
                {
                    id: 'org', name: 'Organization Configuration', icon: IC.org, desc: 'Settings for the whole dream.737.jp.net organization',
                    children: [
                        { id: 'org-mailbox', name: 'Mailbox', icon: IC.mailbox, desc: 'Signatures and mail flow settings for every mailbox' },
                        { id: 'org-transport', name: 'Hub Transport', icon: IC.transport, desc: 'The LANTIS relay, anti-spam and the spam quarantine' }
                    ]
                },
                { id: 'servers', name: 'Server Configuration', icon: IC.server, desc: 'This server and its Internet mail settings' },
                {
                    id: 'recipients', name: 'Recipient Configuration', icon: IC.recipients, desc: 'Mailboxes, aliases and distribution lists',
                    children: [
                        { id: 'mailboxes', name: 'Mailbox', icon: IC.mailbox, desc: 'The mailboxes on dream.737.jp.net' },
                        { id: 'groups', name: 'Distribution Group', icon: IC.group, desc: 'Aliases and distribution lists' },
                        { id: 'disconnected', name: 'Disconnected Mailbox', icon: IC.mailbox, desc: 'Removed mailboxes, which can be connected again' }
                    ]
                },
                { id: 'toolbox', name: 'Toolbox', icon: IC.toolbox, desc: 'Tools for the mail flow and the audit log' }
            ]
        }];
    }

    const childNodes = (id) => {
        const find = (list) => { for (const n of list) { if (n.id === id) return n; const k = n.children && find(n.children); if (k) return k; } return null; };
        const n = find(nodes());
        return (n && n.children) || [];
    };

    // ---- result pane pieces ----------------------------------------------------------------------------

    const objects = (n) => plural(n, 'object', 'objects');

    /** EMC's result pane: the caption band (the node, its object count), result tabs, the list. */
    function listPage(title, side, tabs, list) {
        return { html: `<div class="mmc-page-title"><b>${esc(title)}</b><span>${esc(side || '')}</span></div>${tabs || ''}${list}`, list: true };
    }

    function tabStrip(node, list) {
        const cur = tabOf(node, list);
        return `<div class="exm-tabs" role="tablist">${list.map(([id, text]) => `<span class="exm-tab${id === cur ? ' is-selected' : ''}" role="tab" data-act="tab" data-arg="${esc(id)}">${esc(text)}</span>`).join('')}</div>`;
    }

    function tabOf(node, list) {
        const t = state.tabs[node];
        return list.some(([id]) => id === t) ? t : list[0][0];
    }

    const MB_TABS = [['signatures', 'Signatures'], ['flow', 'Mail Flow Settings']];
    const HT_TABS = [['connectors', 'Send Connectors'], ['antispam', 'Anti-spam'], ['quarantine', 'Spam Quarantine']];
    const TB_TOOLS = [
        { id: 'queue', name: 'Queue Viewer', cat: 'Mail flow tools', desc: 'The LANTIS relay\'s queue and the messages it rejected', icon: IC.queue },
        { id: 'audit', name: 'Exchange Audit Log', cat: 'Configuration management tools', desc: 'Every change made to the organization, newest first', icon: IC.tracking }
    ];
    const ANTISPAM = [
        { id: 'blocklists', name: 'IP Block List Providers', icon: IC.spam },
        { id: 'filters', name: 'Content Filtering', icon: IC.spam },
        { id: 'rejects', name: 'Rejected Messages', icon: IC.tracking }
    ];

    function waiting(c, title) {
        if (state.error) return c.page(title, '', [{ id: 'exm-err', title: 'Microsoft Exchange', body: `<p>${c.state(false, `The organization could not be read. ${state.error}`)}</p>` }]);
        return c.page(title, 'Reading data, please wait...', [{ id: 'exm-load', title: 'Microsoft Exchange', body: '<p>Reading data, please wait...</p>' }]);
    }

    function deniedPage(c) {
        return c.page(TITLE, '', [{ id: 'exm-denied', title: 'Access is denied', body: `<p>${c.state(false, 'The Exchange Management Console needs an Exchange administrator. Sign in as the Administrator to use it.')}</p>` }]);
    }

    // ---- pages -------------------------------------------------------------------------------------------

    function rootPage(c) {
        if (!state.boxes) return waiting(c, 'Microsoft Exchange');
        const p = parts();
        const relay = !state.dash
            ? `<p>${state.dashError ? c.state(false, `The LANTIS relay could not be read. ${state.dashError}`) : 'Reading data, please wait...'}</p>`
            : c.props([
                ['Mail intake', esc(intakeText(p)) + (p.intake.enabled && p.intake.listening === false ? ` ${c.state(false, 'Not listening', true)}` : '')],
                ['LANTIS Postfix', p.postfixUp ? esc(postfixText(p)) : c.state(false, postfixText(p), p.degraded)],
                ['Deferred messages', p.queue && p.queue.deferred != null ? esc(String(p.queue.deferred)) : '<i>Unknown</i>'],
                ['Content filters', p.filters ? esc(filtersText(p)) : '<i>Unknown</i>'],
                ['OCI snapshot', p.snapshotAt ? `${esc(age(p.snapshotAt))} (${esc(when(p.snapshotAt))})` : '<i>Unknown</i>'],
                ['Yukimi sends as', esc(p.yukimiFrom)],
                ['WireGuard', p.wg && p.wg.up ? esc(wgText(p)) : c.state(false, wgText(p), p.degraded)]
            ]) + (p.degraded ? `<p class="mmc-note">${c.state(false, 'The relay is not reachable. The figures are the server\'s own.', true)}</p>` : '');
        const live = liveBoxes();
        const off = live.filter((b) => !b.enabled).length;
        const lists = groups().filter((g) => g.kind === 'list').length;
        const spam = state.spam && Array.isArray(state.spam.counts) ? state.spam.counts : null;
        const org = c.props([
            ['Mailboxes', `${live.length}${off ? ` (${off} disabled)` : ''}`],
            ['Disconnected mailboxes', String(goneBoxes().length)],
            ['Aliases', String(groups().length - lists)],
            ['Distribution lists', String(lists)],
            ['Inbound mail', globalIn() ? 'Accepted' : c.state(false, 'Not accepted', true)],
            ['Outbound mail', globalOut() ? 'Sent' : c.state(false, 'Not sent', true)],
            ['Yozora outbound mail', yozoraOut() ? 'Sent' : c.state(false, 'Not sent', true)],
            ...(spam ? spam.map((s) => [`Spam in ${s.address || s.owner}`, plural(Number(s.count) || 0, 'message', 'messages')]) : [])
        ]);
        const links = nodes()[0].children.map((n) => `<p><span class="mmc-link" data-act="nav:${esc(n.id)}">${esc(n.name)}</span> - ${esc(n.desc || '')}</p>`).join('');
        return c.page('Microsoft Exchange', DOMAIN, [
            { id: 'exm-org', title: 'Organization Summary', body: org + `<div class="mmc-buttons"><button type="button" class="btn-standard" data-act="resync">Resync Recipients...</button></div>` },
            { id: 'exm-relay', title: 'LANTIS Relay', body: relay },
            { id: 'exm-links', title: 'Configuration', body: links }
        ]);
    }

    function containerPage(c, node) {
        const kids = childNodes(node.id);
        const cols = [{ t: 'Name', w: 200, key: 'name', text: (d) => d.name }, { t: 'Description', w: 360, key: 'desc', text: (d) => d.desc || '' }];
        return listPage(node.name, objects(kids.length), '', c.listView(cols, kids.map((n) => ({ key: n.id, data: n, icon: n.icon, open: n.id }))));
    }

    function recipientsPage(c) {
        if (!state.boxes) return waiting(c, 'Recipient Configuration');
        const rows = liveBoxes().map((b) => ({ key: `m:${b.owner}`, icon: IC.user, data: { name: b.displayName || b.owner, alias: b.owner, type: mailboxType(b), address: b.address } }))
            .concat(groups().map((g) => ({ key: `g:${g.localPart}`, icon: g.kind === 'list' ? IC.group : IC.forward, data: { name: groupName(g), alias: g.localPart, type: groupType(g), address: g.address } })));
        const cols = [
            { t: 'Display Name', w: 170, key: 'name', text: (d) => d.name },
            { t: 'Alias', w: 110, key: 'alias', text: (d) => d.alias },
            { t: 'Recipient Type Details', w: 150, key: 'type', text: (d) => d.type },
            { t: 'Primary SMTP Address', w: 220, key: 'address', text: (d) => d.address }
        ];
        return listPage('Recipient Configuration', objects(rows.length), '', c.listView(cols, rows, { sortId: 'recipients', sort: { key: 'name', dir: 1 } }));
    }

    function mailboxesPage(c) {
        if (!state.boxes) return waiting(c, 'Mailbox');
        const list = liveBoxes();
        const cols = [
            { t: 'Display Name', w: 150, key: 'name', text: (b) => b.displayName || b.owner },
            { t: 'Alias', w: 90, key: 'alias', text: (b) => b.owner },
            { t: 'Department', w: 80, key: 'dept', text: (b) => b.dept || '' },
            { t: 'Recipient Type Details', w: 130, key: 'type', text: mailboxType },
            { t: 'Primary SMTP Address', w: 200, key: 'address', text: (b) => b.address },
            { t: 'Status', w: 70, key: 'status', text: (b) => (b.enabled ? 'Enabled' : 'Disabled') },
            { t: 'Mailbox Key', w: 80, key: 'key', text: (b) => (b.hasKey ? 'Issued' : 'None') }
        ];
        return listPage('Mailbox', objects(list.length), '', c.listView(cols, list.map((b) => ({ key: b.owner, data: b, icon: IC.user, cls: b.enabled ? '' : 'exm-off' })), { sortId: 'mailboxes', sort: { key: 'name', dir: 1 } }));
    }

    function groupsPage(c) {
        if (!state.boxes) return waiting(c, 'Distribution Group');
        const list = groups();
        const cols = [
            { t: 'Display Name', w: 150, key: 'name', text: groupName },
            { t: 'Group Type', w: 120, key: 'type', text: groupType },
            { t: 'Primary SMTP Address', w: 210, key: 'address', text: (g) => g.address },
            { t: 'Delivers To', w: 220, key: 'target', text: (g) => (g.kind === 'list' ? String(g.target || '').split(',').filter(Boolean).join(', ') : g.target || '') }
        ];
        return listPage('Distribution Group', objects(list.length), '', c.listView(cols, list.map((g) => ({ key: g.localPart, data: g, icon: g.kind === 'list' ? IC.group : IC.forward })), { sortId: 'groups', sort: { key: 'name', dir: 1 } }));
    }

    function disconnectedPage(c) {
        if (!state.boxes) return waiting(c, 'Disconnected Mailbox');
        const list = goneBoxes();
        const cols = [
            { t: 'Display Name', w: 160, key: 'name', text: (b) => b.displayName || b.owner },
            { t: 'Alias', w: 100, key: 'alias', text: (b) => b.owner },
            { t: 'Primary SMTP Address', w: 220, key: 'address', text: (b) => b.address },
            { t: 'Recipient Type Details', w: 140, key: 'type', text: mailboxType }
        ];
        return listPage('Disconnected Mailbox', objects(list.length), '', c.listView(cols, list.map((b) => ({ key: b.owner, data: b, icon: IC.user, cls: 'exm-off' })), { sortId: 'disconnected', sort: { key: 'name', dir: 1 }, empty: 'There are no items to show in this view.' }));
    }

    function orgMailboxPage(c, node) {
        if (!state.boxes) return waiting(c, 'Mailbox');
        const tab = tabOf(node.id, MB_TABS);
        const list = liveBoxes();
        let cols;
        if (tab === 'signatures') {
            cols = [
                { t: 'Display Name', w: 160, key: 'name', text: (b) => b.displayName || b.owner },
                { t: 'Primary SMTP Address', w: 220, key: 'address', text: (b) => b.address },
                { t: 'Signature', w: 90, key: 'sig', text: (b) => (b.hasSignature ? 'Set' : 'None') }
            ];
        } else {
            cols = [
                { t: 'Mailbox', w: 220, key: 'address', text: (b) => b.address },
                { t: 'Inbound Mail', w: 110, key: 'in', text: (b) => (inboundOn(b.owner) ? 'Accepted' : 'Not accepted') },
                { t: 'Outbound Mail', w: 110, key: 'out', text: (b) => (outboundOn(b.owner) ? 'Sent' : 'Not sent') }
            ];
        }
        return listPage('Mailbox', objects(list.length), tabStrip(node.id, MB_TABS),
            c.listView(cols, list.map((b) => ({ key: b.owner, data: b, icon: tab === 'signatures' ? IC.signature : IC.mailbox })), { sortId: `org-mailbox-${tab}`, sort: { key: tab === 'signatures' ? 'name' : 'address', dir: 1 } }));
    }

    function transportPage(c, node) {
        const tab = tabOf(node.id, HT_TABS);
        const strip = tabStrip(node.id, HT_TABS);
        const p = parts();
        if (tab === 'connectors') {
            const rows = [{ key: 'lantis', icon: IC.transport, data: { name: 'LANTIS Relay', status: state.dash ? (p.degraded ? 'Not reachable' : 'Enabled') : (state.dashError ? 'Unknown' : 'Reading...'), space: `SMTP:*;1`, host: 'LANTIS Postfix (WireGuard)', from: state.dash ? p.ociSender : '' } }];
            const cols = [
                { t: 'Name', w: 150, key: 'name', text: (d) => d.name },
                { t: 'Status', w: 100, key: 'status', text: (d) => d.status },
                { t: 'Address Space', w: 100, key: 'space', text: (d) => d.space },
                { t: 'Smart Host', w: 170, key: 'host', text: (d) => d.host },
                { t: 'Sender', w: 200, key: 'from', text: (d) => d.from }
            ];
            return listPage('Hub Transport', objects(1), strip, c.listView(cols, rows));
        }
        if (tab === 'antispam') {
            const status = (id) => {
                if (!state.dash) return state.dashError ? 'Unknown' : 'Reading...';
                if (id === 'blocklists') {
                    const lists = (p.bl && p.bl.lists) || {};
                    const names = Object.keys(lists);
                    const listed = names.filter((n) => lists[n] && lists[n].listed).length;
                    return names.length ? `${plural(names.length, 'provider', 'providers')}${listed ? `, listed on ${listed}` : ''}` : 'No providers reported';
                }
                if (id === 'filters') return p.filters ? filtersText(p) : 'Unknown';
                return plural(p.rejects.length, 'recent rejection', 'recent rejections');
            };
            const cols = [{ t: 'Feature', w: 200, key: 'name', text: (d) => d.name }, { t: 'Status', w: 360, key: 'status', text: (d) => status(d.id) }];
            return listPage('Hub Transport', objects(ANTISPAM.length), strip, c.listView(cols, ANTISPAM.map((f) => ({ key: f.id, data: f, icon: f.icon }))));
        }
        // the quarantine: the spam folders an administrator may see
        const spam = state.spam;
        const rows = spam && Array.isArray(spam.recent) ? spam.recent.map((m) => ({ key: `${m.mailbox}\n${m.id}`, data: m, icon: IC.spam })) : [];
        const cols = [
            { t: 'Mailbox', w: 100, key: 'mailbox', text: (m) => m.mailbox },
            { t: 'From', w: 170, key: 'from', text: (m) => m.from || '' },
            { t: 'Subject', w: 190, key: 'subject', text: (m) => m.subject || '' },
            { t: 'Received', w: 130, key: 'at', value: (m) => Date.parse(m.createdAt) || 0, text: (m) => when(m.createdAt) },
            { t: 'Spam Score', w: 80, num: true, key: 'score', value: (m) => Number(m.spamScore) || 0, text: (m) => (m.spamScore != null ? String(m.spamScore) : '') }
        ];
        const empty = !spam ? (state.spamError ? `The spam folders could not be read. ${state.spamError}` : 'Reading data, please wait...') : 'There are no messages in the spam folders.';
        return listPage('Hub Transport', plural(rows.length, 'message', 'messages'), strip, c.listView(cols, rows, { sortId: 'quarantine', sort: { key: 'at', dir: -1 }, empty }));
    }

    function serversPage(c) {
        if (!state.boxes) return waiting(c, 'Server Configuration');
        const p = parts();
        const rows = [{ key: 'server', icon: IC.server, data: { name: serverName(), role: 'Hub Transport, Mailbox', version: 'Version 8.1 (Build 240.6)', intake: state.dash ? intakeText(p) : '', inbound: globalIn() ? 'Accepted' : 'Not accepted', outbound: globalOut() ? 'Sent' : 'Not sent', yozora: yozoraOut() ? 'Sent' : 'Not sent' } }];
        const cols = [
            { t: 'Name', w: 130, key: 'name', text: (d) => d.name },
            { t: 'Role', w: 140, key: 'role', text: (d) => d.role },
            { t: 'Version', w: 150, key: 'version', text: (d) => d.version },
            { t: 'Mail Intake', w: 110, key: 'intake', text: (d) => d.intake },
            { t: 'Inbound Mail', w: 90, key: 'inbound', text: (d) => d.inbound },
            { t: 'Outbound Mail', w: 90, key: 'outbound', text: (d) => d.outbound },
            { t: 'Yozora Outbound', w: 100, key: 'yozora', text: (d) => d.yozora }
        ];
        return listPage('Server Configuration', objects(1), '', c.listView(cols, rows));
    }

    function toolboxPage(c) {
        const cols = [{ t: 'Name', w: 170, key: 'name', text: (d) => d.name }, { t: 'Category', w: 190, key: 'cat', text: (d) => d.cat }, { t: 'Description', w: 320, key: 'desc', text: (d) => d.desc }];
        return listPage('Toolbox', objects(TB_TOOLS.length), '', c.listView(cols, TB_TOOLS.map((t) => ({ key: t.id, data: t, icon: t.icon }))));
    }

    function page(node, c) {
        if (state.denied) return deniedPage(c);
        switch (node.id) {
            case 'org': return containerPage(c, node);
            case 'org-mailbox': return orgMailboxPage(c, node);
            case 'org-transport': return transportPage(c, node);
            case 'servers': return serversPage(c);
            case 'recipients': return recipientsPage(c);
            case 'mailboxes': return mailboxesPage(c);
            case 'groups': return groupsPage(c);
            case 'disconnected': return disconnectedPage(c);
            case 'toolbox': return toolboxPage(c);
            default: return rootPage(c);
        }
    }

    // ---- commands: the Action pane, the Action menu and right-click --------------------------------------

    function commands(node) {
        if (state.denied || !state.boxes) return [];
        switch (node.id) {
            case 'root': return [{ text: 'Resync Recipients...', action: 'resync', icon: IC.transport }];
            case 'recipients': return [{ text: 'New Mailbox...', action: 'new-mailbox', icon: IC.mailbox }, { text: 'New Distribution Group...', action: 'new-group', icon: IC.group }];
            case 'mailboxes': return [{ text: 'New Mailbox...', action: 'new-mailbox', icon: IC.mailbox }];
            case 'groups': return [{ text: 'New Distribution Group...', action: 'new-group', icon: IC.group }];
            case 'servers': return [];
            default: return [];
        }
    }

    function mailboxItems(b) {
        if (!b) return [];
        return [
            b.enabled ? { text: 'Disable', action: 'mb-disable', icon: IC.warning } : { text: 'Enable', action: 'mb-enable' },
            { text: 'Remove', action: 'mb-remove', icon: 11, disabled: b.owner === 'yukimi' },
            { separator: true },
            { text: b.hasKey ? 'Rotate Mailbox Key...' : 'Issue Mailbox Key...', action: b.hasKey ? 'key-rotate' : 'key-issue', icon: IC.key },
            { text: 'Revoke Mailbox Key', action: 'key-revoke', disabled: !b.hasKey },
            { text: 'Edit Signature...', action: 'sig-edit', icon: IC.signature },
            { separator: true },
            { text: 'Properties', action: 'props', icon: 8 }
        ];
    }

    function groupItems(g) {
        if (!g) return [];
        return [
            { text: 'Remove', action: 'group-remove', icon: 11, disabled: !groupEditable(g) },
            { separator: true },
            { text: 'Properties', action: 'props', icon: 8 }
        ];
    }

    function selCommands(node, key) {
        if (state.denied || key == null) return null;
        switch (node.id) {
            case 'mailboxes': { const b = byOwner(key); return b && !b.deleted ? { title: b.displayName || b.owner, items: mailboxItems(b) } : null; }
            case 'groups': { const g = groupOf(key); return g ? { title: groupName(g), items: groupItems(g) } : null; }
            case 'recipients': {
                const k = String(key);
                if (k.startsWith('m:')) { const b = byOwner(k.slice(2)); return b ? { title: b.displayName || b.owner, items: mailboxItems(b) } : null; }
                const g = groupOf(k.slice(2));
                return g ? { title: groupName(g), items: groupItems(g) } : null;
            }
            case 'disconnected': { const b = byOwner(key); return b && b.deleted ? { title: b.displayName || b.owner, items: [{ text: 'Connect...', action: 'mb-connect', icon: IC.mailbox }] } : null; }
            case 'org-mailbox': {
                const b = byOwner(key);
                if (!b) return null;
                if (tabOf(node.id, MB_TABS) === 'signatures') return { title: b.displayName || b.owner, items: [{ text: 'Edit Signature...', action: 'sig-edit', icon: IC.signature }, { text: 'Remove Signature', action: 'sig-clear', disabled: !b.hasSignature }, { separator: true }, { text: 'Properties', action: 'props', icon: 8 }] };
                return {
                    title: b.displayName || b.owner,
                    items: [
                        { text: inboundOn(b.owner) ? 'Stop Inbound Mail' : 'Accept Inbound Mail', action: 'flow-in' },
                        { text: outboundOn(b.owner) ? 'Stop Outbound Mail' : 'Send Outbound Mail', action: 'flow-out' },
                        { separator: true },
                        { text: 'Properties', action: 'props', icon: 8 }
                    ]
                };
            }
            case 'org-transport': {
                const tab = tabOf(node.id, HT_TABS);
                if (tab === 'connectors') return { title: 'LANTIS Relay', items: [{ text: 'Resync Recipients...', action: 'resync' }, { separator: true }, { text: 'Properties', action: 'props', icon: 8 }] };
                if (tab === 'antispam') { const f = ANTISPAM.find((x) => x.id === key); return f ? { title: f.name, items: [{ text: 'Properties', action: 'props', icon: 8 }] } : null; }
                const m = spamRow(key);
                if (!m) return null;
                return { title: m.subject || '(no subject)', items: [{ text: 'Release to Inbox', action: 'spam-release', disabled: !m.rescueAllowed }, { text: 'Keep in Spam', action: 'spam-keep', disabled: !m.rescueAllowed }] };
            }
            case 'servers': return {
                title: serverName(),
                items: [
                    { text: globalIn() ? 'Stop Inbound Mail' : 'Accept Inbound Mail', action: 'srv-in' },
                    { text: globalOut() ? 'Stop Outbound Mail' : 'Send Outbound Mail', action: 'srv-out' },
                    { text: yozoraOut() ? 'Stop Yozora Outbound Mail' : 'Send Yozora Outbound Mail', action: 'srv-yozora' },
                    { separator: true },
                    { text: 'Properties', action: 'props', icon: 8 }
                ]
            };
            case 'toolbox': { const t = TB_TOOLS.find((x) => x.id === key); return t ? { title: t.name, items: [{ text: 'Open Tool', action: 'tool-open' }] } : null; }
            default: return null;
        }
    }

    const spamRow = (key) => {
        if (!state.spam || !Array.isArray(state.spam.recent) || key == null) return null;
        const [mailbox, id] = String(key).split('\n');
        return state.spam.recent.find((m) => String(m.mailbox) === mailbox && String(m.id) === id) || null;
    };

    // ---- message boxes -------------------------------------------------------------------------------------

    function ask(c, html, title, icon) {
        return c.box(html, [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: icon || 'warning', title: title || TITLE });
    }

    async function failBox(c, what, err) {
        await c.box(`<p>${esc(what)}</p>${err ? `<p>${esc((err && err.message) || String(err))}</p>` : ''}`, null, { icon: 'error', title: TITLE });
    }

    /** After a write: the lists again (the relay's figures stay), the status bar note. */
    async function reload(c, note) {
        try { await loadLists(); state.error = ''; } catch (err) { state.error = (err && err.message) || 'The server did not answer.'; }
        if (note) c.note(note);
        c.refresh();
    }

    // ---- actions ------------------------------------------------------------------------------------------

    async function action(a, c, arg) {
        const sel = c.sel;
        const node = c.node;
        // Recipient Configuration rows are "m:<owner>" / "g:<local-part>"
        const mbKey = () => (node === 'recipients' ? (String(sel || '').startsWith('m:') ? String(sel).slice(2) : null) : sel);
        const grKey = () => (node === 'recipients' ? (String(sel || '').startsWith('g:') ? String(sel).slice(2) : null) : sel);
        switch (a) {
            case 'refresh': state.dash = null; state.spam = null; await load(c); return true;
            case 'tab': {
                if (!arg) return true;
                state.tabs[node] = arg;
                c.sel = null;
                c.refresh();
                return true;
            }
            case 'resync': await resync(c); return true;
            case 'new-mailbox': newMailboxWizard(c); return true;
            case 'new-group': newGroupWizard(c); return true;
            case 'props': await openProps(c); return true;
            case 'delete': {
                if (node === 'mailboxes' || (node === 'recipients' && mbKey())) return action('mb-remove', c);
                if (node === 'groups' || (node === 'recipients' && grKey())) return action('group-remove', c);
                return true;
            }
            case 'mb-disable':
            case 'mb-enable': {
                const b = byOwner(mbKey());
                if (!b) return true;
                const on = a === 'mb-enable';
                if (!on && !(await ask(c, `<p>Are you sure you want to disable the mailbox <b>${esc(b.address)}</b>?</p><p>Mail to it is refused until it is enabled again.</p>`, 'Disable Mailbox'))) return true;
                try { await write('exchange_disable_mailbox', { owner: b.owner, enabled: on }); } catch (err) { await failBox(c, `The mailbox ${b.address} could not be ${on ? 'enabled' : 'disabled'}.`, err); return true; }
                await reload(c, `The mailbox ${b.address} was ${on ? 'enabled' : 'disabled'}.`);
                return true;
            }
            case 'mb-remove': {
                const b = byOwner(mbKey());
                if (!b || b.owner === 'yukimi') return true;
                if (!(await ask(c, `<p>Are you sure you want to remove the mailbox <b>${esc(b.address)}</b>?</p><p>Its key stops working and it moves to Disconnected Mailbox, where it can be connected again.</p>`, 'Remove Mailbox'))) return true;
                try { await write('exchange_delete_mailbox', { owner: b.owner, confirmText: 'DELETE' }); } catch (err) { await failBox(c, `The mailbox ${b.address} could not be removed.`, err); return true; }
                c.sel = null;
                await reload(c, `The mailbox ${b.address} was removed.`);
                return true;
            }
            case 'mb-connect': connectDialog(c, byOwner(sel)); return true;
            case 'key-issue':
            case 'key-rotate': await issueKey(c, byOwner(mbKey()), a === 'key-rotate'); return true;
            case 'key-revoke': await revokeKey(c, byOwner(mbKey())); return true;
            case 'sig-edit': await signatureDialog(c, byOwner(mbKey())); return true;
            case 'sig-clear': {
                const b = byOwner(sel);
                if (!b) return true;
                if (!(await ask(c, `<p>Are you sure you want to remove the signature of <b>${esc(b.address)}</b>?</p>`, 'Remove Signature'))) return true;
                try { await write('exchange_set_signature', { owner: b.owner, html: '' }); } catch (err) { await failBox(c, 'The signature could not be removed.', err); return true; }
                await reload(c, `The signature of ${b.address} was removed.`);
                return true;
            }
            case 'flow-in':
            case 'flow-out': {
                const b = byOwner(sel);
                if (!b) return true;
                const flag = a === 'flow-in' ? 'inbound' : 'outbound';
                const now = flag === 'inbound' ? inboundOn(b.owner) : outboundOn(b.owner);
                await setToggles(c, { mailboxes: { [b.owner]: { [flag]: !now } } }, `${flag === 'inbound' ? 'Inbound' : 'Outbound'} mail for ${b.address} is now ${now ? 'stopped' : 'on'}.`,
                    now ? `Stop ${flag} mail for ${b.address}? ${flag === 'inbound' ? 'Mail from the Internet to it is refused' : 'Its mail to the Internet is held'} until it is turned back on.` : null);
                return true;
            }
            case 'srv-in': await setToggles(c, { inbound: !globalIn() }, `Inbound mail is now ${globalIn() ? 'stopped' : 'accepted'}.`, globalIn() ? 'Stop inbound mail for the whole organization? Mail from the Internet is refused until it is turned back on.' : null); return true;
            case 'srv-out': await setToggles(c, { outbound: !globalOut() }, `Outbound mail is now ${globalOut() ? 'stopped' : 'sent'}.`, globalOut() ? 'Stop outbound mail for the whole organization? Mail to the Internet is held until it is turned back on.' : null); return true;
            case 'srv-yozora': await setToggles(c, { services: { yozora: { outbound: !yozoraOut() } } }, `Yozora outbound mail is now ${yozoraOut() ? 'stopped' : 'sent'}.`, yozoraOut() ? 'Stop Yozora\'s mail to the Internet?' : null); return true;
            case 'group-remove': {
                const g = groupOf(grKey());
                if (!groupEditable(g)) return true;
                if (!(await ask(c, `<p>Are you sure you want to remove <b>${esc(g.address)}</b>?</p><p>Mail sent to it is refused afterwards.</p>`, g.kind === 'list' ? 'Remove Distribution List' : 'Remove Alias'))) return true;
                try { await write(g.kind === 'list' ? 'exchange_delete_list' : 'exchange_delete_alias', { localPart: g.localPart }); } catch (err) { await failBox(c, `${g.address} could not be removed.`, err); return true; }
                c.sel = null;
                await reload(c, `${g.address} was removed.`);
                return true;
            }
            case 'spam-release':
            case 'spam-keep': {
                const m = spamRow(sel);
                if (!m || !m.rescueAllowed) return true;
                const keep = a === 'spam-keep';
                if (!keep && !(await ask(c, `<p>Release this message to the Inbox of ${esc(m.mailbox)}?</p><p>${esc(m.subject || '(no subject)')}</p>`, 'Release to Inbox', 'question'))) return true;
                try { await write('exchange_spam_move', { mailbox: m.mailbox, id: m.id, spam: keep }); } catch (err) { await failBox(c, 'The message could not be moved.', err); return true; }
                c.sel = null;
                c.note(keep ? 'The message stays in Spam.' : 'The message was released to the Inbox.');
                await loadSpam(c);
                return true;
            }
            case 'tool-open': openTool(c, sel); return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('exchange'); return true;
            default: return false;
        }
    }

    function rowOpen(key, node, c) {
        if (node.id === 'toolbox') { openTool(c, key); return; }
        if (node.id === 'disconnected') { connectDialog(c, byOwner(key)); return; }
        void openProps(c);
    }

    async function resync(c) {
        if (!(await ask(c, '<p>Send every mailbox, address, alias and distribution list to the LANTIS relay now?</p>', 'Resync Recipients', 'question'))) return;
        let r;
        try { r = await write('exchange_resync_recipients', {}); } catch (err) { await failBox(c, 'The recipients could not be sent to the LANTIS relay.', err); return; }
        const problem = relayProblem(r && r.relay);
        if (problem) { await c.box(`<p>${esc(problem)}</p>`, null, { icon: r.relay && r.relay.degraded && !r.relay.skipped ? 'error' : 'warning', title: 'Resync Recipients' }); return; }
        c.note(`${plural(Number(r && r.count) || 0, 'recipient was', 'recipients were')} sent to the LANTIS relay.`);
    }

    /** A change to the mail flow settings (they go to the LANTIS relay first). question: ask first (stopping mail). */
    async function setToggles(c, patch, note, question) {
        if (question && !(await ask(c, `<p>${esc(question)}</p>`, 'Mail Flow Settings'))) return false;
        let r;
        try { r = await write('exchange_set_toggles', patch); } catch (err) { await failBox(c, 'The mail flow settings could not be changed.', err); return false; }
        const problem = relayProblem(r && r.relay);
        if (r && r.toggles) state.toggles = r.toggles;
        await reload(c, problem ? '' : note);
        if (problem) { await c.box(`<p>The mail flow settings were not changed.</p><p>${esc(problem)}</p>`, null, { icon: 'error', title: 'Mail Flow Settings' }); return false; }
        return true;
    }

    async function issueKey(c, b, rotate) {
        if (!b) return;
        const q = rotate
            ? `<p>Replace the key of <b>${esc(b.address)}</b>?</p><p>Programs using the old key are signed out. The new key is shown once.</p>`
            : `<p>Issue a key for <b>${esc(b.address)}</b>?</p><p>The key is shown once.</p>`;
        if (!(await ask(c, q, rotate ? 'Rotate Mailbox Key' : 'Issue Mailbox Key', 'question'))) return;
        let r;
        try { r = await write(rotate ? 'exchange_rotate_key' : 'exchange_issue_key', { owner: b.owner }); } catch (err) { await failBox(c, `A key could not be ${rotate ? 'rotated' : 'issued'} for ${b.address}.`, err); return; }
        await reload(c, `A new key was issued for ${b.address}.`);
        if (r && r.key) keyDialog(c, b, r.key);
    }

    async function revokeKey(c, b) {
        if (!b || !b.hasKey) return;
        if (!(await ask(c, `<p>Revoke the key of <b>${esc(b.address)}</b>?</p><p>Programs using it are signed out.</p>`, 'Revoke Mailbox Key'))) return;
        try { await write('exchange_revoke_key', { owner: b.owner }); } catch (err) { await failBox(c, `The key of ${b.address} could not be revoked.`, err); return; }
        await reload(c, `The key of ${b.address} was revoked.`);
    }

    // ---- Vista dialogs -----------------------------------------------------------------------------------

    function templates() {
        const page = (t, c) => ({ t, w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c });
        const wiz = (c) => ({ t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c });
        const row = (id, y, label) => [[id, 'S', 7, y, 72, 8, SS, label, 0], [id + 1, 'S', 82, y, 163, 8, SS, '', 0]];
        const T = {
            // a mailbox's property sheet (EMC's General, E-Mail Addresses, Mail Flow Settings, Mailbox Features)
            'exm:mb-general': page('General', [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'E', 44, 10, 201, 13, EDIT, '', EDGE],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                [13, 'S', 7, 44, 72, 8, SS, '&Alias:', 0], [14, 'E', 82, 42, 163, 13, EDIT, '', EDGE],
                [15, 'S', 7, 62, 72, 8, SS, '&Department:', 0], [16, 'C', 82, 60, 90, 80, COMBO_EDIT, '', 0],
                ...row(17, 80, 'Primary address:'),
                [19, 'S', 7, 96, 238, 1, ETCHED, '', 0],
                ...row(20, 106, 'Recipient type:'),
                ...row(22, 120, 'Status:'),
                ...row(24, 134, 'Mailbox key:'),
                ...row(26, 148, 'Signature:'),
                [30, 'S', 7, 186, 238, 24, SS, '', 0]
            ]),
            'exm:mb-addr': page('E-Mail Addresses', [
                [41, 'B', 7, 7, 50, 14, PUSH, '&Add...', 0],
                [42, 'B', 61, 7, 50, 14, PUSH, '&Remove', 0],
                [43, 'SysListView32', 7, 26, 238, 160, LV, '', EDGE],
                [44, 'S', 7, 192, 238, 20, SS, '', 0]
            ]),
            'exm:mb-flow': page('Mail Flow Settings', [
                [50, 'S', 7, 7, 238, 8, SS, 'Internet mail for this mailbox:', 0],
                [51, 'B', 14, 22, 224, 10, CHECK, 'Accept &inbound mail from the Internet', 0],
                [52, 'B', 14, 38, 224, 10, CHECK, 'Send &outbound mail to the Internet', 0],
                [53, 'S', 7, 60, 238, 40, SS, '', 0]
            ]),
            'exm:mb-features': page('Mailbox Features', [
                [60, 'B', 7, 7, 60, 14, PUSH, '&Properties...', 0],
                [61, 'B', 71, 7, 50, 14, PUSH, '&Enable', 0],
                [62, 'B', 125, 7, 50, 14, PUSH, '&Disable', 0],
                [63, 'SysListView32', 7, 26, 238, 120, LV, '', EDGE],
                [64, 'S', 7, 154, 238, 50, SS, '', 0]
            ]),
            // a distribution group's sheet: General, and Members for a distribution list
            'exm:dg-general': page('General', [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'E', 44, 10, 201, 13, EDIT, '', EDGE],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                ...row(13, 44, 'E-mail address:'),
                ...row(15, 58, 'Group type:'),
                [17, 'S', 7, 78, 72, 8, SS, '&Forward to:', 0], [18, 'E', 82, 76, 163, 13, EDIT, '', EDGE],
                [19, 'S', 7, 100, 238, 40, SS, '', 0],
                [20, 'S', 7, 186, 238, 24, SS, '', 0]
            ]),
            'exm:dg-members': page('Members', [
                [21, 'B', 7, 7, 50, 14, PUSH, '&Add...', 0],
                [22, 'B', 61, 7, 50, 14, PUSH, '&Remove', 0],
                [23, 'SysListView32', 7, 26, 238, 160, LV, '', EDGE],
                [24, 'S', 7, 192, 238, 20, SS, '', 0]
            ]),
            // the LANTIS relay's sheet (read-only)
            'exm:sc-general': page('General', [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'S', 44, 14, 201, 8, SS, 'LANTIS Relay', 0],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                ...row(13, 44, 'Status:'),
                ...row(15, 58, 'Smart host:'),
                ...row(17, 72, 'LANTIS Postfix:'),
                ...row(19, 86, 'WireGuard:'),
                ...row(21, 100, 'Deferred messages:'),
                ...row(23, 114, 'Address space:'),
                ...row(25, 128, 'Mail intake:'),
                [27, 'S', 7, 146, 238, 30, SS, '', 0]
            ]),
            'exm:sc-delivery': page('Delivery', [
                ...row(31, 7, 'OCI sender:'),
                ...row(33, 21, 'DKIM:'),
                ...row(35, 35, 'Yukimi sends as:'),
                ...row(37, 49, 'OCI snapshot:'),
                ...row(39, 63, 'SpamAssassin rules:'),
                [41, 'S', 7, 81, 238, 1, ETCHED, '', 0],
                [42, 'S', 7, 89, 238, 8, SS, 'Content filters:', 0],
                [43, 'SysListView32', 7, 100, 238, 108, LV, '', EDGE]
            ]),
            'exm:sc-auth': page('Authentication', [
                [45, 'S', 7, 7, 238, 8, SS, 'Logins that submit mail through the relay, and the From addresses each may use:', 0],
                [46, 'SysListView32', 7, 20, 238, 190, LV, '', EDGE]
            ]),
            // this server's sheet
            'exm:sv-general': page('General', [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'S', 44, 14, 201, 8, SS, '', 0],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                ...row(13, 44, 'Role:'),
                ...row(15, 58, 'Version:'),
                ...row(17, 72, 'Domain:'),
                ...row(19, 86, 'Mail intake:'),
                ...row(21, 100, 'Listening:'),
                ...row(23, 114, 'LANTIS Postfix:'),
                ...row(25, 128, 'WireGuard:')
            ]),
            'exm:sv-flow': page('Mail Flow', [
                [70, 'S', 7, 7, 238, 8, SS, 'Internet mail for the whole organization:', 0],
                [71, 'B', 14, 22, 224, 10, CHECK, 'Accept &inbound mail from the Internet', 0],
                [72, 'B', 14, 38, 224, 10, CHECK, 'Send &outbound mail to the Internet', 0],
                [73, 'B', 14, 54, 224, 10, CHECK, 'Send &Yozora\'s mail to the Internet', 0],
                [74, 'S', 7, 76, 238, 40, SS, '', 0]
            ]),
            // a list in a dialog (block lists, rejected messages, the queue, the audit log)
            'exm:list': { t: '', w: 340, h: 196, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 326, 16, SS, '', 0],
                [101, 'SysListView32', 7, 26, 326, 144, LV, '', EDGE],
                [1, 'B', 283, 176, 50, 14, DEFPUSH, 'Close', 0]
            ] },
            'exm:sig': { t: '', w: 320, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 306, 8, SS, '&Signature (HTML):', 0],
                [101, 'E', 7, 18, 306, 150, MULTI, '', EDGE],
                [102, 'S', 7, 174, 190, 20, SS, '', 0],
                [1, 'B', 209, 179, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 263, 179, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'exm:key': { t: '', w: 262, h: 100, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 21, 20, ICON, '', 0],
                [101, 'S', 36, 7, 219, 26, SS, '', 0],
                [102, 'E', 36, 38, 219, 13, READONLY, '', EDGE],
                [3, 'B', 36, 56, 50, 14, PUSH, '&Copy', 0],
                [1, 'B', 205, 79, 50, 14, DEFPUSH, 'OK', 0]
            ] },
            'exm:addr': { t: '', w: 240, h: 76, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 226, 8, SS, '&E-mail address:', 0],
                [101, 'E', 7, 18, 120, 13, EDIT, '', EDGE],
                [102, 'S', 130, 20, 103, 8, SS, `@${DOMAIN}`, 0],
                [103, 'S', 7, 36, 226, 14, SS, '', 0],
                [1, 'B', 129, 55, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 183, 55, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'exm:member': { t: '', w: 240, h: 76, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 226, 8, SS, '&Mailbox or local-part:', 0],
                [101, 'E', 7, 18, 160, 13, EDIT, '', EDGE],
                [103, 'S', 7, 36, 226, 14, SS, '', 0],
                [1, 'B', 129, 55, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 183, 55, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'exm:connect': { t: '', w: 240, h: 90, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 226, 16, SS, '', 0],
                [101, 'S', 7, 30, 60, 8, SS, '&Department:', 0],
                [102, 'C', 70, 28, 90, 80, COMBO_EDIT, '', 0],
                [103, 'S', 7, 50, 226, 14, SS, '', 0],
                [1, 'B', 129, 69, 50, 14, DEFPUSH, 'Connect', 0],
                [2, 'B', 183, 69, 50, 14, PUSH, 'Cancel', 0]
            ] },
            // New Mailbox: the mailbox's information, the summary, the completion
            'exm:nm-info': wiz([
                [201, 'S', 0, 2, 80, 8, SS, '&Alias:', 0], [202, 'E', 84, 0, 140, 14, EDIT, '', EDGE],
                [203, 'S', 0, 24, 80, 8, SS, '&Display name:', 0], [204, 'E', 84, 22, 206, 14, EDIT, '', EDGE],
                [205, 'S', 0, 46, 80, 8, SS, 'D&epartment:', 0], [206, 'C', 84, 44, 100, 80, COMBO_EDIT, '', 0],
                [207, 'S', 0, 68, 80, 8, SS, 'E-mail address:', 0], [208, 'S', 84, 68, 206, 8, SS, '', 0],
                [209, 'B', 0, 90, 280, 10, CHECK, '&Issue a mailbox key for this mailbox', 0],
                [210, 'S', 0, 112, 290, 24, SS, '', 0]
            ]),
            'exm:nm-summary': wiz([[300, 'S', 0, 0, 290, 180, SS, '', 0]]),
            'exm:nm-done': wiz([
                [400, 'S', 0, 0, 290, 54, SS, '', 0],
                [401, 'E', 0, 58, 250, 14, READONLY, '', EDGE],
                [402, 'B', 254, 58, 36, 14, PUSH, '&Copy', 0]
            ]),
            // New Distribution Group: the group type, its information, the summary, the completion
            'exm:ng-type': wiz([
                [500, 'B', 0, 0, 280, 10, RADIO_FIRST, '&Alias', 0],
                [501, 'S', 12, 13, 278, 16, SS, 'Forwards mail sent to its address to one mailbox or local-part.', 0],
                [502, 'B', 0, 36, 280, 10, RADIO, '&Distribution list', 0],
                [503, 'S', 12, 49, 278, 16, SS, 'Delivers mail sent to its address to every member.', 0]
            ]),
            'exm:ng-info': wiz([
                [601, 'S', 0, 2, 80, 8, SS, '&Alias:', 0], [602, 'E', 84, 0, 120, 14, EDIT, '', EDGE], [603, 'S', 208, 2, 82, 8, SS, `@${DOMAIN}`, 0],
                [604, 'S', 0, 24, 80, 8, SS, '&Display name:', 0], [605, 'E', 84, 22, 206, 14, EDIT, '', EDGE],
                [606, 'S', 0, 46, 80, 8, SS, '&Forward to:', 0], [607, 'E', 84, 44, 140, 14, EDIT, '', EDGE],
                [608, 'S', 0, 46, 80, 8, SS, '&Members:', 0], [609, 'E', 84, 44, 206, 66, MULTI, '', EDGE],
                [610, 'S', 84, 114, 206, 16, SS, 'Mailbox names or local-parts, separated by commas or new lines.', 0],
                [611, 'S', 0, 140, 290, 24, SS, '', 0]
            ]),
            'exm:ng-summary': wiz([[700, 'S', 0, 0, 290, 180, SS, '', 0]]),
            'exm:ng-done': wiz([[800, 'S', 0, 0, 290, 160, SS, '', 0]])
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function api() {
        const a = root.vistaDialogTemplate;
        if (!a || typeof a.openSheet !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return a;
    }

    function dlgError(ctx, id, text, key) {
        ctx.html(id, text ? `<span class="exm-dlg-error"><img src="${IC.error}" alt="">${esc(text)}</span>` : '', key);
    }

    /** A list view in a dialog: cols [{ t, w }], rows [{ cells, icon? }]. */
    function fillList(lv, cols, rows, empty) {
        if (!lv) return;
        lv.classList.add('is-report');
        lv.querySelector('.vdt-lv-header').innerHTML = cols.map((col) => `<span class="vdt-lv-col" style="width:${col.w}px">${esc(col.t)}</span>`).join('');
        lv.querySelector('.vdt-lv-body').innerHTML = rows.length
            ? rows.map((r, i) => `<div class="vdt-lv-row" data-row="${i}">${r.cells.map((cell, j) => `<span style="width:${cols[j].w}px" title="${esc(cell)}">${j === 0 && r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}${esc(cell)}</span>`).join('')}</div>`).join('')
            : `<div class="exm-lv-empty">${esc(empty || '')}</div>`;
    }

    const selectedRow = (lv) => { const r = lv && lv.querySelector('.vdt-lv-row.is-selected'); return r ? Number(r.dataset.row) : -1; };

    function copyText(text) {
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        if (typeof root.copyTextToClipboard === 'function') return root.copyTextToClipboard(text);
        if (root.navigator && root.navigator.clipboard) return root.navigator.clipboard.writeText(text);
        return Promise.reject(new Error('The Clipboard is not available.'));
    }

    function keyDialog(c, b, key) {
        api().openDialog({
            id: 'exchangeKeyDialog', key: 'exm:key', title: 'Mailbox Key', owner: c.modal, icon: ICON16,
            overrides: { 100: { image: IC.key32 } },
            init: (d) => {
                d.text(101, `The key for ${b.address}. Copy it now: it is not shown again.`);
                d.set(102, key);
                const e = d.el(102);
                if (e) setTimeout(() => { try { e.focus(); e.select(); } catch (_) { /* gone */ } }, 0);
            },
            buttons: { 3: (d) => { void Promise.resolve(copyText(key)).then(() => d.text(3, 'Copied')).catch(() => {}); } }
        });
    }

    async function signatureDialog(c, b) {
        if (!b) return;
        let html = '';
        try { html = (await send('exchange_get_signature', { owner: b.owner })).html || ''; } catch (err) { await failBox(c, `The signature of ${b.address} could not be read.`, err); return; }
        api().openDialog({
            id: 'exchangeSignatureDialog', key: 'exm:sig', title: `Signature - ${b.address}`, owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => d.set(101, html),
            ok: async (d) => {
                const next = String(d.get(101) || '');
                try { await write('exchange_set_signature', { owner: b.owner, html: next }); } catch (err) { dlgError(d, 102, (err && err.message) || 'The signature was not saved.'); return false; }
                await reload(c, `The signature of ${b.address} was saved.`);
                return true;
            }
        });
    }

    function connectDialog(c, b) {
        if (!b) return;
        api().openDialog({
            id: 'exchangeConnectDialog', key: 'exm:connect', title: 'Connect Mailbox', owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => {
                d.text(100, `Connect ${b.displayName || b.owner} (${b.owner}) again as a mailbox on ${DOMAIN}.`);
                d.options(102, DEPTS, b.dept || 'ops');
            },
            ok: async (d) => {
                const dept = String(d.get(102) || '').trim().toLowerCase();
                try { await write('exchange_create_mailbox', { owner: b.owner, dept: dept || undefined, displayName: b.displayName || b.owner }); } catch (err) { dlgError(d, 103, (err && err.message) || 'The mailbox could not be connected.'); return false; }
                c.sel = null;
                await reload(c, `The mailbox ${b.owner} was connected.`);
                return true;
            }
        });
    }

    function listDialog(c, title, note, cols, rows, empty) {
        api().openDialog({
            id: 'exchangeListDialog', key: 'exm:list', title, owner: c.modal, icon: ICON16,
            init: (d) => { d.text(100, note || ''); fillList(d.el(101), cols, rows, empty || 'There are no items to show.'); }
        });
    }

    function openTool(c, id) {
        if (id === 'queue') {
            const p = parts();
            const q = p.queue || {};
            const rows = Object.keys(q).filter((k) => typeof q[k] !== 'object').map((k) => ({ cells: [k, String(q[k])] }));
            const rej = p.rejects.map((r) => ({ cells: [when(r.at) || String(r.at || ''), r.from || '', r.to || '', r.reason || ''] }));
            if (!state.dash) { void c.box(`<p>${esc(state.dashError ? `The LANTIS relay could not be read. ${state.dashError}` : 'The LANTIS relay is still being read. Try again in a moment.')}</p>`, null, { icon: state.dashError ? 'error' : 'info', title: 'Queue Viewer' }); return; }
            listDialog(c, 'Queue Viewer', `The LANTIS relay's queue${p.degraded ? ' (the relay is not reachable)' : ''}: ${rows.length ? rows.map((r) => `${r.cells[0]} ${r.cells[1]}`).join(', ') : 'no figures reported'}. Messages it rejected recently:`,
                [{ t: 'Date', w: 110 }, { t: 'From', w: 130 }, { t: 'To', w: 130 }, { t: 'Reason', w: 160 }], rej, 'No messages were rejected.');
            return;
        }
        if (id === 'audit') {
            void (async () => {
                try { state.audit = (await send('exchange_audit', { limit: 200 })).audit || []; } catch (err) { await failBox(c, 'The audit log could not be read.', err); return; }
                listDialog(c, 'Exchange Audit Log', 'Changes made to the organization, newest first:',
                    [{ t: 'Date', w: 120 }, { t: 'Administrator', w: 80 }, { t: 'Action', w: 110 }, { t: 'Target', w: 90 }, { t: 'Result', w: 66 }, { t: 'Detail', w: 160 }],
                    state.audit.map((r) => ({ cells: [when(r.ts) || String(r.ts || ''), r.actor || '', r.action || '', r.target || '', r.success ? 'Succeeded' : 'Failed', r.detail || ''] })), 'The audit log is empty.');
            })();
        }
    }

    function antispamDialog(c, id) {
        const p = parts();
        if (!state.dash) { void c.box(`<p>${esc(state.dashError ? `The LANTIS relay could not be read. ${state.dashError}` : 'The LANTIS relay is still being read. Try again in a moment.')}</p>`, null, { icon: state.dashError ? 'error' : 'info', title: TITLE }); return; }
        if (id === 'blocklists') {
            const lists = (p.bl && p.bl.lists) || {};
            listDialog(c, 'IP Block List Providers', 'Lookup answered is whether the list\'s test point replied; Listed is whether this server\'s address is on the list.',
                [{ t: 'Provider', w: 130 }, { t: 'Lookup Answered', w: 100 }, { t: 'Listed', w: 70 }, { t: 'Checked', w: 150 }],
                Object.keys(lists).map((n) => { const r = lists[n] || {}; return { cells: [n, r.ok ? 'Yes' : 'No (lookup failed)', r.listed ? 'Yes' : 'No', when(r.checked_at) || String(r.checked_at || '')] }; }),
                'No block list providers are reported.');
        } else if (id === 'filters') {
            const f = p.filters || {};
            listDialog(c, 'Content Filtering', `The relay's content filters. SpamAssassin rules updated: ${(p.bl && p.bl.sa_rules_updated) ? (when(p.bl.sa_rules_updated) || p.bl.sa_rules_updated) : 'unknown'}.`,
                [{ t: 'Filter', w: 160 }, { t: 'Setting', w: 300 }], Object.keys(f).map((k) => ({ cells: [k, String(f[k])] })), 'No content filters are reported.');
        } else {
            listDialog(c, 'Rejected Messages', 'Messages the relay rejected recently:',
                [{ t: 'Date', w: 110 }, { t: 'From', w: 130 }, { t: 'To', w: 130 }, { t: 'Reason', w: 160 }],
                p.rejects.map((r) => ({ cells: [when(r.at) || String(r.at || ''), r.from || '', r.to || '', r.reason || ''] })), 'No messages were rejected.');
        }
    }

    // ---- property sheets ------------------------------------------------------------------------------

    async function openProps(c) {
        const node = c.node;
        const sel = c.sel;
        if (sel == null) return;
        if (node === 'mailboxes' || node === 'org-mailbox' || (node === 'recipients' && String(sel).startsWith('m:'))) {
            await mailboxSheet(c, byOwner(node === 'recipients' ? String(sel).slice(2) : sel), node === 'org-mailbox' && tabOf(node, MB_TABS) === 'flow' ? 'exm:mb-flow' : null);
        } else if (node === 'groups' || (node === 'recipients' && String(sel).startsWith('g:'))) {
            groupSheet(c, groupOf(node === 'recipients' ? String(sel).slice(2) : sel));
        } else if (node === 'org-transport') {
            const tab = tabOf(node, HT_TABS);
            if (tab === 'connectors') connectorSheet(c);
            else if (tab === 'antispam') antispamDialog(c, sel);
        } else if (node === 'servers') {
            serverSheet(c);
        }
    }

    async function mailboxSheet(c, b0, start) {
        if (!b0) return;
        // the full record: the relay's own view of the mail flow settings when it differs
        let b = b0;
        try { const r = await send('exchange_get_mailbox', { owner: b0.owner }); if (r && r.mailbox) b = Object.assign({}, b0, r.mailbox); } catch (_) { /* the list's record */ }
        const a = api();
        const work = { adds: [], removes: new Set() };
        const addrRows = () => (b.addresses || []).filter((x) => !work.removes.has(x.localPart)).map((x) => ({ local: x.localPart, address: x.address, primary: x.primary }))
            .concat(work.adds.map((l) => ({ local: l, address: `${l}@${DOMAIN}`, primary: false, pending: true })));
        const paintAddr = (ctx) => fillList(ctx.el(43, 'exm:mb-addr'), [{ t: 'E-mail Address', w: 250 }, { t: 'Type', w: 80 }],
            addrRows().map((x) => ({ cells: [x.address, x.primary ? 'Primary' : 'SMTP'] })), 'There are no e-mail addresses.');
        const features = () => [
            { id: 'sig', name: 'Signature', on: !!b.hasSignature },
            { id: 'key', name: 'Mailbox Key', on: !!b.hasKey }
        ];
        const paintFeatures = (ctx) => fillList(ctx.el(63, 'exm:mb-features'), [{ t: 'Feature', w: 200 }, { t: 'Status', w: 130 }],
            features().map((f) => ({ cells: [f.name, f.on ? 'Enabled' : 'Disabled'], icon: f.id === 'sig' ? IC.signature : IC.key })));
        const syncFeatures = (ctx) => {
            const i = selectedRow(ctx.el(63, 'exm:mb-features'));
            const f = features()[i];
            ctx.enable(60, !!f && (f.id === 'sig' || f.on), 'exm:mb-features');
            ctx.enable(61, !!f && !f.on, 'exm:mb-features');
            ctx.enable(62, !!f && f.on, 'exm:mb-features');
            ctx.text(60, f && f.id === 'key' ? 'Rotate...' : 'Properties...', 'exm:mb-features');
            ctx.html(64, !f ? '' : (f.id === 'sig'
                ? '<span class="exm-hint">The signature is added to the mail this mailbox sends. Scripts and remote pictures are removed when it is saved.</span>'
                : '<span class="exm-hint">Programs sign in to this mailbox with its key. A new key is shown once.</span>'), 'exm:mb-features');
        };
        const refreshB = () => { const n = byOwner(b.owner); if (n) b = Object.assign({}, b, n); };
        const isYukimi = b.owner === 'yukimi';
        a.openSheet({
            id: 'exchangeMailboxSheet',
            title: `${b.displayName || b.owner} Properties`,
            icon: ICON16,
            owner: c.modal,
            start: start || 'exm:mb-general',
            pages: [{ key: 'exm:mb-general', overrides: { 10: { image: IC.user32 } } }, { key: 'exm:mb-addr' }, { key: 'exm:mb-flow' }, { key: 'exm:mb-features' }],
            init: (ctx) => {
                const G = 'exm:mb-general';
                ctx.set(11, b.displayName || b.owner, G);
                ctx.set(14, b.owner, G);
                if (isYukimi || b.kind === 'mailroom') ctx.enable(14, false, G);
                ctx.options(16, DEPTS, undefined, G);
                ctx.set(16, b.dept || '', G);
                if (isYukimi || b.kind === 'mailroom') ctx.enable(16, false, G);
                ctx.text(18, b.address, G);
                ctx.text(21, mailboxType(b), G);
                ctx.text(23, b.enabled ? 'Enabled' : 'Disabled', G);
                ctx.text(25, b.hasKey ? 'Issued' : 'None', G);
                ctx.text(27, b.hasSignature ? 'Set' : 'None', G);
                paintAddr(ctx);
                const lv = ctx.el(43, 'exm:mb-addr');
                const syncAddr = () => { const x = addrRows()[selectedRow(lv)]; ctx.enable(42, !!x && !x.primary, 'exm:mb-addr'); };
                syncAddr();
                lv.addEventListener('change', (ev) => { ev.stopPropagation(); syncAddr(); });
                ctx.on(41, 'click', () => {
                    a.openDialog({
                        id: 'exchangeAddressDialog', key: 'exm:addr', title: 'SMTP Address', owner: ctx.modal, focusFirst: true,
                        ok: (d) => {
                            const local = String(d.get(101) || '').trim().toLowerCase().replace(new RegExp(`@${DOMAIN.replace(/\./g, '\\.')}$`), '');
                            if (!local) { dlgError(d, 103, 'Type the part of the address before the @.'); return false; }
                            if (local.includes('@')) { dlgError(d, 103, `Addresses are on ${DOMAIN} only.`); return false; }
                            if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(local)) { dlgError(d, 103, 'Use letters, numbers, dots, hyphens and underscores.'); return false; }
                            if (addrRows().some((x) => x.local === local)) { dlgError(d, 103, 'The mailbox already has this address.'); return false; }
                            if (work.removes.has(local)) work.removes.delete(local); else work.adds.push(local);
                            paintAddr(ctx);
                            syncAddr();
                            ctx.dirty();
                            return true;
                        }
                    });
                }, 'exm:mb-addr');
                ctx.on(42, 'click', () => {
                    const x = addrRows()[selectedRow(lv)];
                    if (!x || x.primary) return;
                    if (x.pending) work.adds = work.adds.filter((l) => l !== x.local); else work.removes.add(x.local);
                    paintAddr(ctx);
                    syncAddr();
                    ctx.dirty();
                }, 'exm:mb-addr');
                ctx.set(51, inboundOn(b.owner), 'exm:mb-flow');
                ctx.set(52, outboundOn(b.owner), 'exm:mb-flow');
                const relayNote = [];
                if (typeof b.relayInboundEnabled === 'boolean') relayNote.push(`The LANTIS relay ${b.relayInboundEnabled ? 'accepts' : 'refuses'} inbound mail for this mailbox.`);
                if (typeof b.relayOutboundEnabled === 'boolean') relayNote.push(`The LANTIS relay ${b.relayOutboundEnabled ? 'sends' : 'holds'} its outbound mail.`);
                if (relayNote.length) ctx.html(53, `<span class="exm-dlg-error"><img src="${IC.warning}" alt="">${esc(relayNote.join(' '))}</span>`, 'exm:mb-flow');
                paintFeatures(ctx);
                const flv = ctx.el(63, 'exm:mb-features');
                syncFeatures(ctx);
                flv.addEventListener('change', (ev) => { ev.stopPropagation(); syncFeatures(ctx); });
                const feature = () => features()[selectedRow(flv)];
                const after = () => { refreshB(); paintFeatures(ctx); syncFeatures(ctx); ctx.text(25, b.hasKey ? 'Issued' : 'None', G); ctx.text(27, b.hasSignature ? 'Set' : 'None', G); };
                const run = async (fn) => { await fn(); after(); };
                ctx.on(60, 'click', () => { const f = feature(); if (!f) return; void run(() => (f.id === 'sig' ? signatureDialogWait(c, b) : issueKey(c, b, true))); }, 'exm:mb-features');
                ctx.on(61, 'click', () => { const f = feature(); if (!f) return; void run(() => (f.id === 'sig' ? signatureDialogWait(c, b) : issueKey(c, b, false))); }, 'exm:mb-features');
                ctx.on(62, 'click', () => {
                    const f = feature();
                    if (!f) return;
                    void run(async () => {
                        if (f.id === 'key') { await revokeKey(c, b); return; }
                        if (!(await ask(c, `<p>Are you sure you want to remove the signature of <b>${esc(b.address)}</b>?</p>`, 'Remove Signature'))) return;
                        try { await write('exchange_set_signature', { owner: b.owner, html: '' }); } catch (err) { await failBox(c, 'The signature could not be removed.', err); return; }
                        await reload(c, `The signature of ${b.address} was removed.`);
                    });
                }, 'exm:mb-features');
            },
            apply: async (ctx) => {
                const G = 'exm:mb-general';
                const errs = [];
                let owner = b.owner;
                const name = String(ctx.get(11, G) || '').trim();
                const alias = String(ctx.get(14, G) || '').trim().toLowerCase();
                const dept = String(ctx.get(16, G) || '').trim().toLowerCase();
                const upd = {};
                if (name && name !== (b.displayName || b.owner)) upd.displayName = name;
                if (alias && alias !== b.owner && !isYukimi) upd.newOwner = alias;
                if (dept && dept !== (b.dept || '') && !isYukimi && b.kind !== 'mailroom') upd.dept = dept;
                if (Object.keys(upd).length) {
                    try {
                        const r = await write('exchange_update_mailbox', Object.assign({ owner: b.owner }, upd));
                        if (r && r.mailbox) { owner = r.mailbox.owner; b = Object.assign({}, b, r.mailbox); }
                    } catch (err) { errs.push(`General: ${(err && err.message) || 'not saved'}`); }
                }
                for (const local of work.removes) {
                    try { await write('exchange_remove_address', { localPart: local }); } catch (err) { errs.push(`${local}@${DOMAIN}: ${(err && err.message) || 'not removed'}`); }
                }
                for (const local of work.adds) {
                    try { await write('exchange_add_address', { owner, localPart: local }); } catch (err) { errs.push(`${local}@${DOMAIN}: ${(err && err.message) || 'not added'}`); }
                }
                work.adds = [];
                work.removes.clear();
                const wantIn = !!ctx.get(51, 'exm:mb-flow');
                const wantOut = !!ctx.get(52, 'exm:mb-flow');
                const flow = {};
                if (wantIn !== inboundOn(b0.owner)) flow.inbound = wantIn;
                if (wantOut !== outboundOn(b0.owner)) flow.outbound = wantOut;
                if (Object.keys(flow).length) {
                    try {
                        const r = await write('exchange_set_toggles', { mailboxes: { [owner]: flow } });
                        const problem = relayProblem(r && r.relay);
                        if (problem) errs.push(`Mail flow settings: ${problem}`);
                        else if (r && r.toggles) state.toggles = r.toggles;
                    } catch (err) { errs.push(`Mail flow settings: ${(err && err.message) || 'not saved'}`); }
                }
                try {
                    await loadLists();
                    const n = byOwner(owner);
                    if (n) b = Object.assign({}, b, n);
                } catch (_) { /* the next refresh */ }
                if (c.sel === b0.owner && owner !== b0.owner) c.sel = owner;
                c.refresh();
                paintAddr(ctx);
                if (errs.length) await c.box(`<p>Some changes to ${esc(b.address)} were not saved:</p><p>${errs.map(esc).join('<br>')}</p>`, null, { icon: 'error', title: TITLE });
                else c.note(`The mailbox ${b.address} was saved.`);
            }
        });
    }

    /** The signature dialog, resolved when it closes (Mailbox Features waits on it). */
    function signatureDialogWait(c, b) {
        return new Promise((resolve) => {
            void signatureDialog(c, b).then(() => {
                const m = root.document && root.document.getElementById('exchangeSignatureDialog');
                if (!m) { resolve(); return; }
                const obs = new MutationObserver(() => { if (!m.isConnected || m.classList.contains('hidden')) { obs.disconnect(); resolve(); } });
                obs.observe(root.document.body, { childList: true });
                obs.observe(m, { attributes: true, attributeFilter: ['class'] });
            });
        });
    }

    function groupSheet(c, g) {
        if (!g) return;
        const a = api();
        const editable = groupEditable(g);
        const isList = g.kind === 'list';
        const stored = storedList(g.localPart);
        const members = (stored ? stored.members : String(g.target || '').split(',')).map((m) => String(m).trim()).filter(Boolean);
        const paint = (ctx) => fillList(ctx.el(23, 'exm:dg-members'), [{ t: 'Member', w: 160 }, { t: 'Delivers To', w: 170 }],
            members.map((m) => { const b = byOwner(m); return { cells: [m, b ? b.address : (groupOf(m) ? groupOf(m).address : `${m}@${DOMAIN}`)], icon: b ? IC.user : IC.forward }; }), 'There are no members.');
        a.openSheet({
            id: 'exchangeGroupSheet',
            title: `${groupName(g)} Properties`,
            icon: ICON16,
            owner: c.modal,
            noApply: !editable,
            pages: [{ key: 'exm:dg-general', overrides: { 10: { image: isList ? IC.group32 : `${EX}/forward-24.png` } } }].concat(isList ? [{ key: 'exm:dg-members' }] : []),
            init: (ctx) => {
                const G = 'exm:dg-general';
                ctx.set(11, groupName(g), G);
                if (!isList || !editable) ctx.enable(11, false, G);
                ctx.text(14, g.address, G);
                ctx.text(16, groupType(g), G);
                if (isList) { ctx.show(17, false, G); ctx.show(18, false, G); } else {
                    ctx.set(18, g.target || '', G);
                    if (!editable) ctx.enable(18, false, G);
                }
                if (!editable) ctx.html(19, `<span class="exm-hint">${esc(g.note || (g.kind === 'list' ? 'This distribution list comes from the server\'s configuration and cannot be changed here.' : 'This alias is built in and cannot be changed.'))}</span>`, G);
                if (!isList) return;
                paint(ctx);
                const lv = ctx.el(23, 'exm:dg-members');
                const sync = () => ctx.enable(22, editable && selectedRow(lv) >= 0, 'exm:dg-members');
                ctx.enable(21, editable, 'exm:dg-members');
                sync();
                lv.addEventListener('change', (ev) => { ev.stopPropagation(); sync(); });
                ctx.on(21, 'click', () => {
                    a.openDialog({
                        id: 'exchangeMemberDialog', key: 'exm:member', title: 'Add Member', owner: ctx.modal, focusFirst: true,
                        ok: (d) => {
                            const m = String(d.get(101) || '').trim().toLowerCase();
                            if (!m) { dlgError(d, 103, 'Type a mailbox name or local-part.'); return false; }
                            if (m.includes('@')) { dlgError(d, 103, `Members are on ${DOMAIN} only: type the part before the @.`); return false; }
                            if (members.includes(m)) { dlgError(d, 103, 'This member is already on the list.'); return false; }
                            members.push(m);
                            paint(ctx);
                            sync();
                            ctx.dirty();
                            return true;
                        }
                    });
                }, 'exm:dg-members');
                ctx.on(22, 'click', () => {
                    const i = selectedRow(lv);
                    if (i < 0) return;
                    members.splice(i, 1);
                    paint(ctx);
                    sync();
                    ctx.dirty();
                }, 'exm:dg-members');
            },
            apply: async (ctx) => {
                if (!editable) return;
                try {
                    if (isList) {
                        if (!members.length) throw new Error('A distribution list needs at least one member.');
                        await write('exchange_upsert_list', { localPart: g.localPart, name: String(ctx.get(11, 'exm:dg-general') || '').trim() || g.localPart, members });
                    } else {
                        const target = String(ctx.get(18, 'exm:dg-general') || '').trim().toLowerCase();
                        if (!target) throw new Error('Type the mailbox or local-part the alias forwards to.');
                        await write('exchange_upsert_alias', { localPart: g.localPart, target });
                    }
                } catch (err) {
                    await failBox(c, `${g.address} was not saved.`, err);
                    return;
                }
                await reload(c, `${g.address} was saved.`);
            }
        });
    }

    function connectorSheet(c) {
        const p = parts();
        const known = !!state.dash;
        const unknown = state.dashError ? 'Unknown' : 'Reading data...';
        const v = (x) => (known ? x : unknown);
        api().openSheet({
            id: 'exchangeConnectorSheet',
            title: 'LANTIS Relay Properties',
            icon: ICON16,
            owner: c.modal,
            noApply: true,
            pages: [{ key: 'exm:sc-general', overrides: { 10: { image: IC.transport32 } } }, { key: 'exm:sc-delivery' }, { key: 'exm:sc-auth' }],
            init: (ctx) => {
                const G = 'exm:sc-general';
                ctx.text(14, v(p.degraded ? 'Not reachable' : 'Enabled'), G);
                ctx.text(16, 'LANTIS Postfix over WireGuard', G);
                ctx.text(18, v(postfixText(p)), G);
                ctx.text(20, v(wgText(p)), G);
                ctx.text(22, v(p.queue && p.queue.deferred != null ? String(p.queue.deferred) : 'Unknown'), G);
                ctx.text(24, 'SMTP:*;1', G);
                ctx.text(26, v(intakeText(p)), G);
                if (known && p.degraded) ctx.html(27, `<span class="exm-dlg-error"><img src="${IC.warning}" alt="">The relay is not reachable. These are the server's own figures.</span>`, G);
                const D = 'exm:sc-delivery';
                ctx.text(32, v(p.ociSender), D);
                ctx.text(34, v(p.dkim && p.dkim.dkim ? String(p.dkim.dkim) : 'Unknown'), D);
                ctx.text(36, v(p.yukimiFrom), D);
                ctx.text(38, v(p.snapshotAt ? `${age(p.snapshotAt)} (${when(p.snapshotAt)})` : 'Unknown'), D);
                ctx.text(40, v(p.bl && p.bl.sa_rules_updated ? (when(p.bl.sa_rules_updated) || String(p.bl.sa_rules_updated)) : 'Unknown'), D);
                const f = p.filters || {};
                fillList(ctx.el(43, D), [{ t: 'Filter', w: 140 }, { t: 'Setting', w: 190 }], Object.keys(f).map((k) => ({ cells: [k, String(f[k])] })), known ? 'No content filters are reported.' : unknown);
                const subs = (p.senders && p.senders.submission) || [];
                const rows = [];
                subs.forEach((s) => (Array.isArray(s.from) ? s.from : []).forEach((addr, i) => rows.push({ cells: [i ? '' : String(s.login || ''), String(addr)], icon: i ? null : IC.user })));
                fillList(ctx.el(46, 'exm:sc-auth'), [{ t: 'Login', w: 110 }, { t: 'From Address', w: 220 }], rows, known ? 'No submission logins are reported.' : unknown);
            }
        });
    }

    function serverSheet(c) {
        const p = parts();
        const known = !!state.dash;
        const v = (x) => (known ? x : (state.dashError ? 'Unknown' : 'Reading data...'));
        const was = { inbound: globalIn(), outbound: globalOut(), yozora: yozoraOut() };
        api().openSheet({
            id: 'exchangeServerSheet',
            title: `${serverName()} Properties`,
            icon: ICON16,
            owner: c.modal,
            pages: [{ key: 'exm:sv-general', overrides: { 10: { image: IC.server32 } } }, { key: 'exm:sv-flow' }],
            init: (ctx) => {
                const G = 'exm:sv-general';
                ctx.text(11, serverName(), G);
                ctx.text(14, 'Hub Transport, Mailbox', G);
                ctx.text(16, 'Version 8.1 (Build 240.6)', G);
                ctx.text(18, DOMAIN, G);
                ctx.text(20, v(intakeText(p)), G);
                ctx.text(22, v(p.intake.enabled ? (p.intake.listening ? 'Yes' : 'No') : 'No (intake is disabled)'), G);
                ctx.text(24, v(postfixText(p)), G);
                ctx.text(26, v(wgText(p)), G);
                ctx.set(71, was.inbound, 'exm:sv-flow');
                ctx.set(72, was.outbound, 'exm:sv-flow');
                ctx.set(73, was.yozora, 'exm:sv-flow');
            },
            apply: async (ctx) => {
                const F = 'exm:sv-flow';
                const patch = {};
                const i = !!ctx.get(71, F);
                const o = !!ctx.get(72, F);
                const y = !!ctx.get(73, F);
                if (i !== was.inbound) patch.inbound = i;
                if (o !== was.outbound) patch.outbound = o;
                if (y !== was.yozora) patch.services = { yozora: { outbound: y } };
                if (!Object.keys(patch).length) return;
                const ok = await setToggles(c, patch, 'The mail flow settings were changed.', null);
                if (ok) { was.inbound = i; was.outbound = o; was.yozora = y; dlgError(ctx, 74, '', F); } else {
                    ctx.set(71, globalIn(), F); ctx.set(72, globalOut(), F); ctx.set(73, yozoraOut(), F);
                }
            }
        });
    }

    // ---- wizards -------------------------------------------------------------------------------------

    function summary(rows) {
        return `<div class="exm-wiz-text"><p>Configuration Summary:</p><div class="exm-wiz-summary">${rows.map(([k, v]) => `<div><span>${esc(k)}:</span> <b>${esc(v)}</b></div>`).join('')}</div><p>To create it, click New.</p></div>`;
    }

    function completion(ok, lines) {
        return `<div class="exm-wiz-text"><div class="exm-wiz-result"><img src="${ok ? `${VI}/check-16.png` : IC.error}" alt="">${esc(ok ? 'The wizard completed successfully. Click Finish to close this wizard.' : 'The wizard did not complete.')}</div>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
    }

    function newMailboxWizard(c) {
        const a = api();
        let info = null;
        let key = '';
        const ownerOk = (o) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(o);
        const preview = (ctx) => {
            const o = String(ctx.get(202, 'exm:nm-info') || '').trim().toLowerCase();
            const d = String(ctx.get(206, 'exm:nm-info') || '').trim().toLowerCase();
            const local = o === 'yukimi' ? 'kazari.ops' : (o === 'tsubame' ? 'tsubame.ops' : (o && d ? `${o}.${d}` : ''));
            ctx.text(208, local ? `${local}@${DOMAIN}` : '', 'exm:nm-info');
        };
        a.openWizard({
            id: 'exchangeNewMailboxWizard',
            title: 'New Mailbox',
            icon: ICON16,
            owner: c.modal,
            init: (ctx) => {
                ctx.options(206, DEPTS, 'ops', 'exm:nm-info');
                ['input', 'change'].forEach((ev) => { ctx.on(202, ev, () => preview(ctx), 'exm:nm-info'); ctx.on(206, ev, () => preview(ctx), 'exm:nm-info'); });
                preview(ctx);
                ctx.show(401, false, 'exm:nm-done');
                ctx.show(402, false, 'exm:nm-done');
                ctx.on(402, 'click', () => { void Promise.resolve(copyText(key)).then(() => ctx.text(402, 'Copied', 'exm:nm-done')).catch(() => {}); }, 'exm:nm-done');
            },
            pages: [
                {
                    key: 'exm:nm-info', instruction: 'Mailbox Information',
                    next: (ctx) => {
                        const P = 'exm:nm-info';
                        const owner = String(ctx.get(202, P) || '').trim().toLowerCase();
                        const name = String(ctx.get(204, P) || '').trim();
                        const dept = String(ctx.get(206, P) || '').trim().toLowerCase();
                        if (!owner) { dlgError(ctx, 210, 'Type the alias: the mailbox owner\'s name.', P); return false; }
                        if (owner.includes('@') || !ownerOk(owner)) { dlgError(ctx, 210, 'The alias is a bare name (letters, numbers, dots, hyphens), never an e-mail address.', P); return false; }
                        const have = byOwner(owner);
                        if (have && !have.deleted) { dlgError(ctx, 210, `A mailbox for ${owner} already exists.`, P); return false; }
                        if (!dept && owner !== 'yukimi' && owner !== 'tsubame') { dlgError(ctx, 210, 'Choose or type a department.', P); return false; }
                        dlgError(ctx, 210, '', P);
                        info = { owner, name: name || owner, dept, key: !!ctx.get(209, P), address: String(ctx.holder(208, P) ? ctx.holder(208, P).textContent : '') };
                        ctx.html(300, summary([['Alias', info.owner], ['Display name', info.name], ['Department', info.dept || '(none)'], ['E-mail address', info.address], ['Mailbox key', info.key ? 'Issued when the mailbox is created' : 'None']]), 'exm:nm-summary');
                        return 'exm:nm-summary';
                    }
                },
                {
                    key: 'exm:nm-summary', instruction: 'New Mailbox', nextText: 'New',
                    next: async (ctx) => {
                        const lines = [];
                        let ok = true;
                        try {
                            const r = await write('exchange_create_mailbox', { owner: info.owner, dept: info.dept || undefined, displayName: info.name });
                            lines.push(`The mailbox ${(r && r.mailbox && r.mailbox.address) || info.address} was created.`);
                        } catch (err) {
                            ok = false;
                            lines.push(`The mailbox was not created: ${(err && err.message) || 'the server did not answer.'}`);
                        }
                        if (ok && info.key) {
                            try {
                                const r = await write('exchange_issue_key', { owner: info.owner });
                                key = (r && r.key) || '';
                                if (key) lines.push('Its key is below. Copy it now: it is not shown again.');
                            } catch (err) { lines.push(`No key was issued: ${(err && err.message) || 'the server did not answer.'}`); }
                        }
                        ctx.html(400, completion(ok, lines), 'exm:nm-done');
                        ctx.show(401, !!key, 'exm:nm-done');
                        ctx.show(402, !!key, 'exm:nm-done');
                        if (key) ctx.set(401, key, 'exm:nm-done');
                        if (ok) await reload(c, `The mailbox ${info.address} was created.`);
                        return 'exm:nm-done';
                    }
                },
                { key: 'exm:nm-done', instruction: 'Completion', finish: true, noBack: true }
            ]
        });
    }

    function newGroupWizard(c) {
        const a = api();
        let kind = 'alias';
        let info = null;
        const localOk = (l) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(l);
        const layout = (ctx) => {
            const P = 'exm:ng-info';
            const list = kind === 'list';
            [604, 605, 608, 609, 610].forEach((id) => ctx.show(id, list, P));
            [606, 607].forEach((id) => ctx.show(id, !list, P));
            if (!list) { ctx.show(604, false, P); ctx.show(605, false, P); }
        };
        a.openWizard({
            id: 'exchangeNewGroupWizard',
            title: 'New Distribution Group',
            icon: ICON16,
            owner: c.modal,
            init: (ctx) => { ctx.set(500, true, 'exm:ng-type'); layout(ctx); },
            pages: [
                {
                    key: 'exm:ng-type', instruction: 'Group Type',
                    next: (ctx) => { kind = ctx.get(502, 'exm:ng-type') ? 'list' : 'alias'; layout(ctx); return 'exm:ng-info'; }
                },
                {
                    key: 'exm:ng-info', instruction: 'Group Information',
                    next: (ctx) => {
                        const P = 'exm:ng-info';
                        const local = String(ctx.get(602, P) || '').trim().toLowerCase().replace(new RegExp(`@${DOMAIN.replace(/\./g, '\\.')}$`), '');
                        if (!local) { dlgError(ctx, 611, 'Type the alias: the part of the address before the @.', P); return false; }
                        if (local.includes('@') || !localOk(local)) { dlgError(ctx, 611, `Use letters, numbers, dots, hyphens and underscores; addresses are on ${DOMAIN} only.`, P); return false; }
                        if (groupOf(local) || boxes().some((b) => (b.addresses || []).some((x) => x.localPart === local))) { dlgError(ctx, 611, `${local}@${DOMAIN} is already in use.`, P); return false; }
                        if (kind === 'list') {
                            const members = String(ctx.get(609, P) || '').split(/[,\s]+/).map((m) => m.trim().toLowerCase()).filter(Boolean);
                            if (!members.length) { dlgError(ctx, 611, 'Type at least one member.', P); return false; }
                            if (members.some((m) => m.includes('@'))) { dlgError(ctx, 611, `Members are on ${DOMAIN} only: type the part before the @.`, P); return false; }
                            info = { local, name: String(ctx.get(605, P) || '').trim() || local, members };
                            ctx.html(700, summary([['Group type', 'Distribution list'], ['E-mail address', `${local}@${DOMAIN}`], ['Display name', info.name], ['Members', members.join(', ')]]), 'exm:ng-summary');
                        } else {
                            const target = String(ctx.get(607, P) || '').trim().toLowerCase();
                            if (!target) { dlgError(ctx, 611, 'Type the mailbox or local-part the alias forwards to.', P); return false; }
                            if (target.includes('@')) { dlgError(ctx, 611, `Aliases forward on ${DOMAIN} only: type the part before the @.`, P); return false; }
                            info = { local, target };
                            ctx.html(700, summary([['Group type', 'Alias'], ['E-mail address', `${local}@${DOMAIN}`], ['Forwards to', target]]), 'exm:ng-summary');
                        }
                        dlgError(ctx, 611, '', P);
                        return 'exm:ng-summary';
                    }
                },
                {
                    key: 'exm:ng-summary', instruction: 'New Distribution Group', nextText: 'New',
                    next: async (ctx) => {
                        const address = `${info.local}@${DOMAIN}`;
                        let ok = true;
                        let line = '';
                        try {
                            if (kind === 'list') await write('exchange_upsert_list', { localPart: info.local, name: info.name, members: info.members });
                            else await write('exchange_upsert_alias', { localPart: info.local, target: info.target });
                            line = `${address} was created.`;
                        } catch (err) {
                            ok = false;
                            line = `${address} was not created: ${(err && err.message) || 'the server did not answer.'}`;
                        }
                        ctx.html(800, completion(ok, [line]), 'exm:ng-done');
                        if (ok) await reload(c, `${address} was created.`);
                        return 'exm:ng-done';
                    }
                },
                { key: 'exm:ng-done', instruction: 'Completion', finish: true, noBack: true }
            ]
        });
    }

    // ---- the snap-in ------------------------------------------------------------------------------------

    function status(node) {
        if (state.denied) return 'Access is denied';
        if (state.error) return 'The server did not answer.';
        if (!state.boxes) return 'Reading data, please wait...';
        switch (node.id) {
            case 'mailboxes': return objects(liveBoxes().length);
            case 'groups': return objects(groups().length);
            case 'disconnected': return objects(goneBoxes().length);
            case 'recipients': return objects(liveBoxes().length + groups().length);
            case 'org-transport': return state.dash && parts().degraded ? 'The LANTIS relay is not reachable' : '';
            default: return '';
        }
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            treeWidth: 200,
            width: 900,
            height: 620,
            expanded: ['root', 'org', 'recipients'],
            nodes,
            page,
            commands,
            selCommands,
            action,
            rowOpen,
            status,
            about: { version: '8.1.240.6', lines: ['Manages the dream.737.jp.net organization: its mailboxes, aliases and distribution lists, and the LANTIS relay.'] },
            onOpen: (c) => { void load(c); }
        };
    }

    /** node: a console node, or a DSAP tab ('mailboxes', 'aliases', 'toggles', 'signatures', 'relay', 'spam', 'overview'). */
    function resolveNode(node) {
        // a DSAP address's path ("exchange.dreamscape.jp/mailboxes", "?tab=spam") or a bare id
        const raw = String(node || '').replace(/^dsap:\/\//, '');
        const q = /[?&]tab=([^&#]+)/.exec(raw);
        const segs = raw.split(/[?#]/)[0].split('/').filter(Boolean);
        if (segs.length && segs[0].includes('.')) segs.shift();
        const n = q ? decodeURIComponent(q[1]) : (segs[0] || '');
        if (NODE_IDS.includes(n)) return n;
        if (n === 'spam') state.tabs['org-transport'] = 'quarantine';
        if (n === 'relay') state.tabs['org-transport'] = 'connectors';
        if (n === 'signatures') state.tabs['org-mailbox'] = 'signatures';
        return DSAP_TABS[n] || null;
    }

    async function openExchangeManagementConsole(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        const id = resolveNode(node);
        return root.mmcConsole.open(def(), id ? { node: id } : {});
    }

    root.openExchangeManagementConsole = openExchangeManagementConsole;
    root.mmcExchange = { open: openExchangeManagementConsole, def, resolveNode, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
