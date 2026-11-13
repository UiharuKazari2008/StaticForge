/**
 * Messaging Bridge (Yozora #779): an MMC 3.0 console over Dreamscape's Text Messaging bridge
 * (modules/textMessaging.js through window.textMessaging, textMessagingClient.js), placed in
 * Control Panel > Administrative Tools (cplPages3.js TOOLS). Yukimi, Nov 13 2026: the bridge and its
 * status in an MMC-like console; what is out of sync on the server, sync status, storage usage.
 *
 *   the frame          Computer Management's (the VM's, 800x600): menu band, toolbar (mmc.exe bitmap
 *                      202), console tree, result pane, Action pane, status bar
 *   Messaging Bridge (Local)   summary page: the accounts, their push channels and copies, storage
 *     <account>        Apple iMessage (BlueBubbles, the Mac) / Text Messaging (RCS, the paired phone)
 *       Status         connection, identity, push channel, server version and Private API / pairing
 *       Conversations  the server's copy, conversation by conversation (sortable list view)
 *       Synchronization   progress, the last reconcile against the source, the drift log, what is
 *                      not synchronized yet
 *     <e-mail account> (#789) an IMAP account the server is the mail client for (mailAccounts.syncStatus)
 *       Status         connection, the IDLE push channel on the Inbox, the servers
 *       Folders        the server's copy, folder by folder (special use, messages, unread, synced)
 *       Synchronization   progress while the sync worker runs, the last sync, the folders synchronized
 *     Storage          the message database and the attachment cache on the server, and the mail
 *                      database and its attachment cache
 *
 * The source (the Mac, the phone, the mail server) always wins: Resync Now catches up and reconciles against it,
 * Rebuild from Source drops the server's copy and pulls everything again.
 *
 *   melatonApps.define('msgbridge', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const TITLE = 'Messaging Bridge';
    const VERSION = '1.0.0';
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Messaging Bridge';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ITEMS = '/static_images/vista-cpl/items';
    const VI = '/static_images/vista-icons';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const tm = () => root.textMessaging || null;
    const ma = () => root.mailAccounts || null;
    const MAIL_16 = '/static_images/vista-cmdbar/mail.png';
    const MAIL_32 = '/static_images/app_icons/vista-mail.png';
    // IMAP special-use folders: Windows Mail's names and its folder bitmap (vista-mail/folders-16.png)
    const SPECIAL = {
        '\\Inbox': ['Inbox', 7], '\\Drafts': ['Drafts', 11], '\\Sent': ['Sent Items', 9], '\\Trash': ['Deleted Items', 10],
        '\\Junk': ['Junk E-mail', 12], '\\Archive': ['Archive', 6]
    };
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
    // the server pushes sync progress (tm_event syncprogress) and every account / sync change: the
    // timer is only a once-a-minute safety net (no polling under 60 s, Yukimi Nov 13)
    const POLL_RUNNING_MS = 60000;
    const POLL_IDLE_MS = 60000;

    /** Explorer's sizes: bytes, then KB / MB / GB to three significant figures. */
    function size(b) {
        const n = Number(b) || 0;
        if (n < 1024) return `${n} bytes`;
        const u = ['KB', 'MB', 'GB', 'TB'];
        let v = n / 1024;
        let i = 0;
        while (v >= 1000 && i < u.length - 1) { v /= 1024; i += 1; }
        return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
    }

    /** Vista's short date and time: 11/13/2026 2:24 AM. */
    function when(t) {
        if (t === null || t === undefined || t === '' || t === 0) return '';
        const d = new Date(typeof t === 'string' && /^\d+$/.test(t) ? Number(t) : t);
        if (Number.isNaN(d.getTime())) return '';
        const h = d.getHours();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${(h % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }
    const timeOf = (t) => { const d = new Date(typeof t === 'string' && /^\d+$/.test(t) ? Number(t) : t); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); };

    const STATUS_TEXT = { connected: 'Connected', connecting: 'Connecting', unpaired: 'Not paired', disabled: 'Turned off', error: 'Not connected' };
    const statusText = (a) => STATUS_TEXT[a.status] || (a.status ? String(a.status).replace(/^./, (c) => c.toUpperCase()) : 'Not connected');
    const sourceName = (a) => (a.kind === 'rcs' ? 'the phone' : 'the Mac');
    const isRcs = (a) => a.kind === 'rcs';
    const MAIL_STATUS = { connected: 'Connected', connecting: 'Connecting', disabled: 'Turned off', error: 'Not connected' };
    const mailStatusText = (a) => (a.enabled === false ? 'Turned off' : MAIL_STATUS[a.status] || 'Not connected');

    class Bridge {
        constructor(app) {
            this.app = app;
            this.A = app && typeof app.url === 'function' ? app.url('assets').replace(/\/$/, '') : '/melaton-apps/msgbridge/assets';
            this.node = 'root';
            this.history = [];
            this.future = [];
            this.open = new Set(['root'].concat(reg('Expanded', [])));
            this.collapsed = new Set(reg('CollapsedSections', []));
            this.actCollapsed = new Set();
            this.status = null;
            this.accounts = [];
            this.chats = new Map();
            this.error = '';
            this.mail = [];
            this.mailStorage = null;
            this.mailError = '';
            this.folders = new Map();
            this.fsort = Object.assign({ key: '', dir: 1 }, reg('FolderSort', {}));
            this.sort = Object.assign({ key: 'lastDate', dir: -1 }, reg('Sort', {}));
            this.sel = null;
            this.note = '';
            this.build();
            this.listen();
            this.listenMail();
            this.select('root', false);
            void this.refresh();
        }

        icon(name) { return `${this.A}/${name}`; }

        // ---- the window ---------------------------------------------------------------------------

        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window mb-window has-actions';
            m.dataset.windowIdentifier = 'melatonMessagingBridge';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = this.icon('msgbridge-24.png');
            m.dataset.windowDefaultWidth = '800';
            m.dataset.windowDefaultHeight = '600';
            m.dataset.windowMinWidth = '480';
            m.dataset.windowMinHeight = '320';
            m.style.width = '800px';
            m.style.height = '600px';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', TITLE);
            if (!reg('ConsoleTree', true)) m.classList.add('no-tree');
            if (!reg('ActionPane', true)) m.classList.remove('has-actions');
            if (!reg('StatusBar', true)) m.classList.add('no-status');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${this.icon('msgbridge-16.png')}" alt=""><span>${TITLE}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small mb-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 mb-client">
                    <div class="mb-rebar">
                        <div class="naxt-menubar mb-menubar" role="menubar" data-win32-menus>
                            ${['File', 'Action', 'View', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-mb-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}
                        </div>
                        <div class="mb-toolbar" role="toolbar"></div>
                    </div>
                    <div class="mb-body">
                        <div class="mb-tree" tabindex="0" role="tree"></div>
                        <div class="mb-split"></div>
                        <div class="mb-result"></div>
                        <div class="mb-actions"></div>
                    </div>
                    <div class="mb-status"><span></span><span></span><span></span></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.el = (q) => m.querySelector(q);
            const treeWidth = Number(reg('TreeWidth', 190)) || 190;
            this.el('.mb-tree').style.width = `${Math.max(120, Math.min(400, treeWidth))}px`;
            m.querySelector('.mb-close').addEventListener('click', () => this.app.exit());
            m.querySelectorAll('[data-mb-menu]').forEach((t) => {
                if (!root.contextMenu) return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.mbMenu); } }]
                });
            });
            const tree = this.el('.mb-tree');
            tree.addEventListener('click', (ev) => {
                const row = ev.target.closest('[data-node]');
                if (!row) return;
                if (ev.target.closest('.mb-twisty')) { this.toggle(row.dataset.node); return; }
                this.select(row.dataset.node, true);
            });
            tree.addEventListener('dblclick', (ev) => { const row = ev.target.closest('[data-node]'); if (row && !ev.target.closest('.mb-twisty')) this.toggle(row.dataset.node); });
            tree.addEventListener('mousedown', (ev) => { if (ev.button !== 2) return; const row = ev.target.closest('[data-node]'); if (row) this.select(row.dataset.node, true); });
            tree.addEventListener('keydown', (ev) => this.treeKey(ev));
            if (root.contextMenu) {
                root.contextMenu.attachToElement(tree, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu('action'); } }]
                });
            }
            this.el('.mb-toolbar').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tb]'); if (b && !b.disabled) void this.action(b.dataset.tb); });
            this.el('.mb-actions').addEventListener('click', (ev) => {
                const g = ev.target.closest('.mb-act-group');
                if (g) {
                    const k = g.dataset.group;
                    if (this.actCollapsed.has(k)) this.actCollapsed.delete(k); else this.actCollapsed.add(k);
                    this.renderActions();
                    return;
                }
                const a = ev.target.closest('.mb-act');
                if (a && !a.classList.contains('is-disabled')) void this.action(a.dataset.act);
            });
            this.el('.mb-result').addEventListener('click', (ev) => this.resultClick(ev));
            this.el('.mb-result').addEventListener('dblclick', (ev) => this.resultDblClick(ev));
            this.el('.mb-result').addEventListener('keydown', (ev) => this.listKey(ev));
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'F5') { ev.preventDefault(); void this.action('refresh'); }
                else if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); void this.action('back'); }
                else if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); void this.action('forward'); }
            });
            this.wireSplit();
            m.id = 'melatonMessagingBridgeModal';
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
        }

        /** The splitter between the console tree and the result pane. */
        wireSplit() {
            const split = this.el('.mb-split');
            const tree = this.el('.mb-tree');
            split.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                split.setPointerCapture(ev.pointerId);
                const x0 = ev.clientX;
                const w0 = tree.getBoundingClientRect().width;
                const move = (e) => { tree.style.width = `${Math.max(120, Math.min(400, Math.round(w0 + e.clientX - x0)))}px`; };
                const up = () => {
                    split.removeEventListener('pointermove', move);
                    split.removeEventListener('pointerup', up);
                    setReg({ TreeWidth: Math.round(tree.getBoundingClientRect().width) });
                };
                split.addEventListener('pointermove', move);
                split.addEventListener('pointerup', up);
            });
        }

        /** The bridge's events: anything that changes an account, its sync or a conversation redraws. */
        listen() {
            const t = tm();
            if (!t || typeof t.on !== 'function') return;
            this.onProgress = (d) => {
                const a = d && this.accounts.find((x) => x.id === d.accountId);
                if (!a) return;
                a.sync = Object.assign({}, a.sync || {}, { running: d.running !== false, done: d.done, total: d.total });
                // the counters only; the tree and lists stay as they are
                this.renderToolbar();
                this.render();
            };
            t.on('syncprogress', this.onProgress);
            this.onEvent = (d) => {
                if (d && d.accountId && this.chats.has(d.accountId)) this.chats.delete(d.accountId);
                clearTimeout(this.eventTimer);
                this.eventTimer = setTimeout(() => void this.refresh(), 400);
            };
            this.events = ['sync', 'account', 'reload', 'resync'];
            this.events.forEach((e) => t.on(e, this.onEvent));
            this.tmListened = t;
        }

        /** The e-mail accounts' events: a sync ended, an account or its folders changed. */
        listenMail() {
            const m = ma();
            if (!m || typeof m.on !== 'function') return;
            this.onMailEvent = (d) => {
                if (d && d.accountId) this.folders.delete(d.accountId);
                clearTimeout(this.eventTimer);
                this.eventTimer = setTimeout(() => void this.refresh(), 400);
            };
            this.mailEvents = ['sync', 'account', 'folders', 'progress'];
            this.mailEvents.forEach((e) => m.on(e, this.onMailEvent));
            this.maListened = m;
        }

        // ---- data ---------------------------------------------------------------------------------

        async refresh() {
            if (this.refreshing) { this.again = true; return; }
            this.refreshing = true;
            clearTimeout(this.pollTimer);
            const mailJob = this.refreshMail();
            try {
                const t = tm();
                if (!t || typeof t.syncStatus !== 'function') throw new Error('Text Messaging is not available in this session.');
                const [st, ac] = await Promise.all([t.syncStatus(), typeof t.accounts === 'function' ? t.accounts(true).catch(() => null) : null]);
                this.status = st || { accounts: [], storage: {} };
                const byId = new Map(((ac && ac.accounts) || []).map((a) => [a.id, a]));
                this.accounts = (this.status.accounts || []).map((s) => Object.assign({}, byId.get(s.id) || {}, s));
                this.error = '';
                const a = this.accountOf(this.node);
                if (a && /^(convs|sync):/.test(this.node)) await this.loadChats(a.id);
            } catch (err) {
                this.error = (err && err.message) || String(err);
            }
            try { await mailJob; } finally { this.refreshing = false; }
            if (!this.find(this.node)) this.node = 'root';
            this.lastRefresh = Date.now();
            this.renderTree();
            this.renderToolbar();
            this.renderActions();
            this.render();
            if (this.again) { this.again = false; void this.refresh(); return; }
            const running = this.accounts.concat(this.mail).some((a) => a.sync && a.sync.running);
            this.pollTimer = setTimeout(() => void this.refresh(), running ? POLL_RUNNING_MS : POLL_IDLE_MS);
        }

        /** The e-mail accounts (mailAccounts.syncStatus) and the open account's folders. */
        async refreshMail() {
            const m = ma();
            if (!m || typeof m.syncStatus !== 'function') { this.mail = []; this.mailStorage = null; return; }
            try {
                const st = await m.syncStatus();
                this.mail = (st && st.accounts) || [];
                this.mailStorage = (st && st.storage) || null;
                this.mailError = '';
                const a = this.mailOf(this.node);
                if (a && /^(mfold|msync):/.test(this.node)) await this.loadFolders(a.id, true);
            } catch (err) {
                this.mailError = (err && err.message) || String(err);
            }
        }

        async loadFolders(id, force) {
            if (!force && this.folders.has(id)) return this.folders.get(id);
            const m = ma();
            try {
                const list = m && typeof m.folders === 'function' ? await m.folders(id) : [];
                this.folders.set(id, Array.isArray(list) ? list : []);
            } catch (err) {
                this.folders.set(id, { error: (err && err.message) || String(err) });
            }
            return this.folders.get(id);
        }

        mailOf(nodeId) {
            const m = /^(?:macct|mstatus|mfold|msync):(.+)$/.exec(nodeId || '');
            return m ? this.mail.find((a) => a.id === m[1]) || null : null;
        }

        async loadChats(id, force) {
            if (!force && this.chats.has(id)) return this.chats.get(id);
            const t = tm();
            try {
                const list = t && typeof t.syncChats === 'function' ? await t.syncChats(id) : [];
                this.chats.set(id, Array.isArray(list) ? list : []);
            } catch (err) {
                this.chats.set(id, { error: (err && err.message) || String(err) });
            }
            return this.chats.get(id);
        }

        accountOf(nodeId) {
            const m = /^(?:acct|status|convs|sync):(.+)$/.exec(nodeId || '');
            return m ? this.accounts.find((a) => a.id === m[1]) || null : null;
        }

        // ---- the console tree ---------------------------------------------------------------------

        /** The tree: the root, each account with Status / Conversations / Synchronization, Storage. */
        nodes() {
            const dupes = new Map();
            this.accounts.forEach((a) => dupes.set(a.name, (dupes.get(a.name) || 0) + 1));
            const acct = (a) => ({
                id: `acct:${a.id}`,
                name: dupes.get(a.name) > 1 && a.identity ? `${a.name} (${a.identity})` : (a.name || 'Text Messaging'),
                icon: isRcs(a) ? `${ITEMS}/phone-and-modem-options-16.png` : `${ITEMS}/network-and-sharing-center-16.png`,
                desc: isRcs(a) ? 'Text messages through Google Messages on the paired phone' : 'iMessage through the BlueBubbles server on the Mac',
                children: [
                    { id: `status:${a.id}`, name: 'Status', icon: `${ITEMS}/performance-information-and-tools-16.png`, desc: 'Connection, identity and the push channel' },
                    { id: `convs:${a.id}`, name: 'Conversations', icon: this.icon('chat-16.png'), desc: 'The server\'s copy, conversation by conversation' },
                    { id: `sync:${a.id}`, name: 'Synchronization', icon: `${ITEMS}/sync-center-16.png`, desc: 'Progress, the last reconcile and the drift log' }
                ]
            });
            return [{
                id: 'root',
                name: `${TITLE} (Local)`,
                icon: this.icon('msgbridge-16.png'),
                children: this.accounts.map(acct).concat(this.mail.map((a) => ({
                    id: `macct:${a.id}`,
                    name: a.email || a.name || 'E-mail',
                    icon: MAIL_16,
                    desc: 'E-mail through the IMAP and SMTP servers of the mail provider',
                    children: [
                        { id: `mstatus:${a.id}`, name: 'Status', icon: `${ITEMS}/performance-information-and-tools-16.png`, desc: 'Connection, the push channel and the mail servers' },
                        { id: `mfold:${a.id}`, name: 'Folders', icon: '/static_images/vista-icons/explorer/folder-16.png', desc: 'The server\'s copy, folder by folder' },
                        { id: `msync:${a.id}`, name: 'Synchronization', icon: `${ITEMS}/sync-center-16.png`, desc: 'Progress, the last sync and the folders synchronized' }
                    ]
                })), [{ id: 'storage', name: 'Storage', icon: '/static_images/vista-devmgr/disk-drives-16.png', desc: 'The message database and the attachment cache' }])
            }];
        }

        find(id, list = this.nodes()) {
            for (const n of list) {
                if (n.id === id) return n;
                const c = n.children && this.find(id, n.children);
                if (c) return c;
            }
            return null;
        }

        parentOf(id, list = this.nodes(), parent = null) {
            for (const n of list) {
                if (n.id === id) return parent;
                const p = n.children && this.parentOf(id, n.children, n);
                if (p) return p;
            }
            return null;
        }

        /** The rows in tree order, as drawn (for the arrow keys). */
        visible() {
            const out = [];
            const walk = (list, depth) => list.forEach((n) => {
                out.push({ n, depth });
                if (n.children && n.children.length && this.open.has(n.id)) walk(n.children, depth + 1);
            });
            walk(this.nodes(), 0);
            return out;
        }

        renderTree() {
            const rows = this.visible().map(({ n, depth }) => {
                const kids = n.children && n.children.length;
                const open = this.open.has(n.id);
                // the console root has no twisty (MMC's); every level below indents 19 px
                return `<div class="mb-node${n.id === this.node ? ' is-selected' : ''}" data-node="${esc(n.id)}" role="treeitem" style="padding-left:${4 + depth * 19}px">
                    ${depth ? `<span class="mb-twisty${kids ? (open ? ' is-open' : ' is-closed') : ''}"></span>` : ''}<img src="${esc(n.icon)}" alt=""><span class="mb-node-name">${esc(n.name)}</span></div>`;
            });
            const html = rows.join('');
            const tree = this.el('.mb-tree');
            if (tree.dataset.html !== html) { tree.innerHTML = html; tree.dataset.html = html; }
        }

        toggle(id) {
            const n = this.find(id);
            if (!n || !n.children || !n.children.length) return;
            if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
            setReg({ Expanded: [...this.open].filter((x) => x !== 'root') });
            this.renderTree();
        }

        treeKey(ev) {
            const rows = this.visible();
            const i = rows.findIndex((r) => r.n.id === this.node);
            if (i < 0) return;
            const n = rows[i].n;
            const kids = n.children && n.children.length;
            let go = null;
            if (ev.key === 'ArrowDown') go = rows[Math.min(rows.length - 1, i + 1)].n.id;
            else if (ev.key === 'ArrowUp') go = rows[Math.max(0, i - 1)].n.id;
            else if (ev.key === 'Home') go = rows[0].n.id;
            else if (ev.key === 'End') go = rows[rows.length - 1].n.id;
            else if (ev.key === 'ArrowRight') { if (kids && !this.open.has(n.id)) this.toggle(n.id); else if (kids) go = n.children[0].id; }
            else if (ev.key === 'ArrowLeft') { if (kids && this.open.has(n.id) && n.id !== 'root') this.toggle(n.id); else { const p = this.parentOf(n.id); if (p) go = p.id; } }
            else if (ev.key === 'Enter') { if (kids) this.toggle(n.id); }
            else return;
            ev.preventDefault();
            if (go && go !== this.node) this.select(go, true);
        }

        select(id, record) {
            if (record && id !== this.node) { this.history.push(this.node); this.future = []; }
            if (id !== this.node) this.sel = null;
            this.node = id;
            // the path to the node opens (Back / Forward, double-clicks in the result pane)
            for (let p = this.parentOf(id); p; p = this.parentOf(p.id)) this.open.add(p.id);
            this.renderTree();
            this.renderToolbar();
            this.renderActions();
            const pane = this.el('.mb-result');
            pane.innerHTML = '';
            delete pane.dataset.html;
            this.render();
            const a = this.accountOf(id);
            if (a && /^(convs|sync):/.test(id) && !this.chats.has(a.id)) {
                void this.loadChats(a.id).then(() => { if (this.node === id) this.render(); });
            }
            const ma0 = this.mailOf(id);
            if (ma0 && /^(mfold|msync):/.test(id) && !this.folders.has(ma0.id)) {
                void this.loadFolders(ma0.id).then(() => { if (this.node === id) this.render(); });
            }
        }

        // ---- menus, toolbar, Action pane ------------------------------------------------------------

        /** The node's commands, the same in the Action menu, the Action pane and a right-click. */
        commands() {
            const id = this.node;
            const a = this.accountOf(id);
            const out = [];
            if (a) {
                const up = a.status === 'connected';
                if (isRcs(a) && a.status === 'unpaired') out.push({ text: 'Pair Phone...', action: 'pair', icon: 14 });
                out.push({ text: 'Resync Now', action: 'resync', icon: 13, disabled: !up || (a.sync && a.sync.running) });
                out.push({ text: 'Rebuild from Source...', action: 'rebuild', disabled: !up });
                if (isRcs(a) && a.status !== 'unpaired') out.push({ text: 'Unpair Phone...', action: 'unpair' });
                out.push({ separator: true });
            }
            const m = this.mailOf(id);
            if (m) {
                const off = m.status === 'disabled' || m.enabled === false;
                out.push({ text: 'Resync Now', action: 'resync', icon: 13, disabled: off || (m.sync && m.sync.running) });
                out.push({ text: 'Rebuild from Source...', action: 'rebuild', disabled: off || (m.sync && m.sync.running) });
                out.push({ separator: true });
            }
            if (id.startsWith('convs:')) out.push({ text: 'Export List...', action: 'export', icon: 16 });
            out.push({ text: 'Refresh', action: 'refresh', icon: 3 });
            if (a || m) out.push({ separator: true }, { text: 'Properties', action: 'properties', icon: 8 });
            out.push({ separator: true }, { text: 'Help', action: 'help', icon: 15 });
            return out;
        }

        /** The selected conversation's commands (the Action pane's second group). */
        selCommands() {
            const c = this.selChat();
            if (!c) return null;
            return { title: c.title || c.guid, items: [{ text: 'Open in Melaton Messenger', action: 'open-chat' }] };
        }

        menu(name) {
            const strip = (list) => list.map((c) => (c.separator ? { separator: true } : { text: c.text, action: c.action, disabled: !!c.disabled }));
            switch (name) {
                case 'file': return [{ text: 'Exit', action: 'exit' }];
                case 'action': {
                    const s = this.selCommands();
                    return strip(s ? s.items.concat([{ separator: true }], this.commands()) : this.commands());
                }
                case 'view': {
                    const list = /^(convs|mfold):/.test(this.node) || this.isFolder();
                    return (list ? [
                        { text: 'Large Icons', action: 'none', disabled: true },
                        { text: 'Small Icons', action: 'none', disabled: true },
                        { text: 'List', action: 'none', disabled: true },
                        { text: 'Detail', action: 'none', checked: true, showIndicator: true, indicatorMark: 'radio' },
                        { separator: true }
                    ] : []).concat([{ text: 'Customize...', action: 'customize' }]);
                }
                case 'help': return [{ text: 'Help Topics', action: 'help' }, { separator: true }, { text: `About ${TITLE}...`, action: 'about' }];
                default: return [];
            }
        }

        isFolder() { return /^m?acct:/.test(this.node); }

        /**
         * The toolbar as Computer Management's: Back, Forward | Up One Level, Show/Hide Console Tree |
         * the node's own (Refresh, Export List, Properties) | Help, Show/Hide Action Pane
         * (mmc.exe bitmap 202: 0 back, 1 forward, 3 refresh, 8 properties, 9 up, 10 tree, 15 help,
         * 16 export list, 17 action pane).
         */
        renderToolbar() {
            const b = (id, i, title, opts = {}) => `<button type="button" class="mb-tb${opts.pressed ? ' is-pressed' : ''}" data-tb="${id}" title="${title}"${opts.disabled ? ' disabled' : ''}><span class="mb-tb-icon" style="--i:${i}"></span></button>`;
            const sep = '<span class="mb-tb-sep"></span>';
            const a = this.accountOf(this.node);
            let own = '';
            if (this.node.startsWith('convs:')) own += b('export', 16, 'Export List');
            if (this.node !== 'root' && !this.isFolder()) own += b('refresh', 3, 'Refresh');
            if (a || this.mailOf(this.node)) own += b('properties', 8, 'Properties');
            const html = b('back', 0, 'Back', { disabled: !this.history.length }) + b('forward', 1, 'Forward', { disabled: !this.future.length }) + sep
                + (this.node !== 'root' ? b('up', 9, 'Up One Level') : '') + b('tree', 10, 'Show/Hide Console Tree', { pressed: !this.modal.classList.contains('no-tree') }) + sep
                + (own ? own + sep : '')
                + b('help', 15, 'Help') + b('actions', 17, 'Show/Hide Action Pane', { pressed: this.modal.classList.contains('has-actions') });
            const tb = this.el('.mb-toolbar');
            if (tb.dataset.html !== html) { tb.innerHTML = html; tb.dataset.html = html; }
        }

        /** MMC's Action pane: "Actions", the node's group, the selected conversation's group. */
        renderActions() {
            const pane = this.el('.mb-actions');
            if (!pane) return;
            const n = this.find(this.node);
            const items = (list) => list.map((c) => (c.separator ? '<div class="mb-act-sep"></div>'
                : `<div class="mb-act${c.disabled ? ' is-disabled' : ''}" data-act="${c.action}">${c.icon !== undefined ? `<span class="mb-act-icon" style="--i:${c.icon}"></span>` : ''}${esc(c.text)}</div>`)).join('');
            const group = (key, title, list) => `<div class="mb-act-group${this.actCollapsed.has(key) ? ' is-collapsed' : ''}" data-group="${esc(key)}" title="${esc(title)}">${esc(title)}</div><div class="mb-act-items">${items(list)}</div>`;
            const s = this.selCommands();
            const html = `<div class="mb-act-head">Actions</div>${group('node', n ? n.name : '', this.commands())}${s ? group('sel', s.title, s.items) : ''}`;
            if (pane.dataset.html !== html) { pane.innerHTML = html; pane.dataset.html = html; }
        }

        async action(a) {
            const acct = this.accountOf(this.node);
            switch (a) {
                case 'exit': this.app.exit(); return;
                case 'back': { const n = this.history.pop(); if (n) { this.future.push(this.node); this.select(n, false); } return; }
                case 'forward': { const n = this.future.pop(); if (n) { this.history.push(this.node); this.select(n, false); } return; }
                case 'up': { const p = this.parentOf(this.node); if (p) this.select(p.id, true); return; }
                case 'tree': this.modal.classList.toggle('no-tree'); setReg({ ConsoleTree: !this.modal.classList.contains('no-tree') }); this.renderToolbar(); return;
                case 'actions': this.modal.classList.toggle('has-actions'); setReg({ ActionPane: this.modal.classList.contains('has-actions') }); this.renderToolbar(); return;
                case 'refresh':
                    if (acct) this.chats.delete(acct.id);
                    if (this.mailOf(this.node)) this.folders.delete(this.mailOf(this.node).id);
                    await this.refresh();
                    return;
                case 'resync': return this.mailOf(this.node) ? this.resyncMail(this.mailOf(this.node), false) : this.resync(acct, false);
                case 'rebuild': return this.mailOf(this.node) ? this.resyncMail(this.mailOf(this.node), true) : this.resync(acct, true);
                case 'pair': case 'properties': this.cardSpace(this.mailOf(this.node) ? 'mail' : 'text-messaging'); return;
                case 'unpair': return this.unpair(acct);
                case 'export': this.exportList(); return;
                case 'open-chat': this.openChat(); return;
                case 'customize': return this.customize();
                case 'help': call('openHelpAndSupport', 'messaging-bridge'); return;
                case 'about': return this.about();
                default:
            }
        }

        cardSpace(section) {
            if (root.cplAuthentication && typeof root.cplAuthentication.open === 'function') root.cplAuthentication.open(section || 'text-messaging');
        }

        async box(html, kind, buttons) {
            const icon = kind === 'error' ? 'fas fa-circle-xmark' : kind === 'warning' ? 'fas fa-triangle-exclamation' : kind === 'question' ? 'fas fa-circle-question' : 'fas fa-circle-info';
            return call('showConfirmationDialog', html, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: TITLE, icon, width: 420 });
        }

        async resync(a, rebuild) {
            const t = tm();
            if (!a || !t || typeof t.resync !== 'function') return;
            if (rebuild) {
                const ok = await this.box(`<p>Rebuild the server's copy of ${esc(a.name)} from ${sourceName(a)}?</p><p>Every conversation the server holds for this account is dropped and pulled again from ${sourceName(a)}. This can take several minutes; conversations come back as they are pulled.</p>`,
                    'warning', [{ text: 'Yes', value: true, className: 'btn-standard' }, { text: 'No', value: false, className: 'btn-standard primary' }]);
                if (ok !== true) return;
            }
            this.note = rebuild ? `Rebuilding ${a.name} from ${sourceName(a)}...` : `Resynchronizing ${a.name}...`;
            this.renderStatus();
            try {
                await t.resync(a.id, !!rebuild);
                this.chats.delete(a.id);
            } catch (err) {
                this.note = '';
                await this.box(`<p>${esc(rebuild ? 'The copy could not be rebuilt.' : 'The account could not be resynchronized.')}</p><p>${esc((err && err.message) || err)}</p>`, 'error');
            }
            await this.refresh();
            setTimeout(() => { this.note = ''; this.renderStatus(); }, 4000);
        }

        /** Resync Now / Rebuild from Source for an e-mail account: the mail server is the source. */
        async resyncMail(a, rebuild) {
            const m = ma();
            if (!a || !m || typeof m.resync !== 'function') return;
            const name = a.email || a.name;
            if (rebuild) {
                const ok = await this.box(`<p>Rebuild the server's copy of ${esc(name)} from the mail server?</p><p>Every message the server holds for this account is dropped and downloaded again from the mail server. This can take a long time for a large mailbox; folders come back as they are downloaded.</p>`,
                    'warning', [{ text: 'Yes', value: true, className: 'btn-standard' }, { text: 'No', value: false, className: 'btn-standard primary' }]);
                if (ok !== true) return;
            }
            this.note = rebuild ? `Rebuilding ${name} from the mail server...` : `Synchronizing ${name}...`;
            this.renderStatus();
            try {
                await m.resync(a.id, !!rebuild);
                this.folders.delete(a.id);
            } catch (err) {
                this.note = '';
                await this.box(`<p>${esc(rebuild ? 'The copy could not be rebuilt.' : 'The account could not be synchronized.')}</p><p>${esc((err && err.message) || err)}</p>`, 'error');
            }
            await this.refresh();
            setTimeout(() => { this.note = ''; this.renderStatus(); }, 4000);
        }

        async unpair(a) {
            const t = tm();
            if (!a || !t || typeof t.unpairRcs !== 'function') return;
            const ok = await this.box(`<p>Unpair the phone from ${esc(a.name)}?</p><p>Melaton stops receiving text messages until the phone is paired again in Dreamscape CardSpace. The server's copy stays.</p>`,
                'warning', [{ text: 'Yes', value: true, className: 'btn-standard' }, { text: 'No', value: false, className: 'btn-standard primary' }]);
            if (ok !== true) return;
            try { await t.unpairRcs(a.id); } catch (err) { await this.box(`<p>The phone could not be unpaired.</p><p>${esc((err && err.message) || err)}</p>`, 'error'); }
            await this.refresh();
        }

        /** Export List...: the list's rows as tab-separated text, as MMC writes them. */
        exportList() {
            const a = this.accountOf(this.node);
            const list = a && Array.isArray(this.chats.get(a.id)) ? this.sorted(this.chats.get(a.id)) : [];
            const cols = this.chatCols();
            const lines = [cols.map((c) => c.t).join('\t')].concat(list.map((c) => cols.map((k) => String(k.text(c)).replace(/[\t\r\n]+/g, ' ')).join('\t')));
            const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/plain' });
            const link = doc.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${a ? a.name : 'Conversations'} - Conversations.txt`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        }

        openChat() {
            const a = this.accountOf(this.node);
            const c = this.selChat();
            if (!a || !c || !root.melatonApps) return;
            void root.melatonApps.launch({ packageId: 'messenger', args: { accountId: a.id, chatGuid: c.guid } }).catch(() => {});
        }

        /** View > Customize...: MMC's Customize View, the parts of this console that show. */
        async customize() {
            const parts = [['ConsoleTree', 'Console tree', !this.modal.classList.contains('no-tree')], ['ActionPane', 'Action pane', this.modal.classList.contains('has-actions')], ['StatusBar', 'Status bar', !this.modal.classList.contains('no-status')]];
            let boxes = null;
            const html = `<p>Select or clear the check boxes to show or hide items in the console window.</p><div class="mb-dialog-checks">${parts.map(([k, t, on]) => `<label><input type="checkbox" data-mb-part="${k}"${on ? ' checked' : ''}> ${t}</label>`).join('')}</div>`;
            const ok = await call('showConfirmationDialog', html, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, {
                title: 'Customize View',
                icon: 'fas fa-circle-info',
                width: 360,
                onDialogReady: () => { boxes = Array.from(doc.querySelectorAll('#confirmationDialog [data-mb-part]')); }
            });
            if (ok !== true) return;
            if (!boxes || !boxes.length) boxes = Array.from(doc.querySelectorAll('#confirmationDialog [data-mb-part]'));
            const v = {};
            boxes.forEach((b) => { v[b.dataset.mbPart] = b.checked; });
            if ('ConsoleTree' in v) this.modal.classList.toggle('no-tree', !v.ConsoleTree);
            if ('ActionPane' in v) this.modal.classList.toggle('has-actions', v.ActionPane);
            if ('StatusBar' in v) this.modal.classList.toggle('no-status', !v.StatusBar);
            setReg(v);
            this.renderToolbar();
        }

        async about() {
            await call('showConfirmationDialog', `<div class="mb-about"><img src="${this.icon('msgbridge-32.png')}" alt="" width="32" height="32"><div><p><b>${TITLE}</b><br>Xyridian Management Console snap-in<br>Version ${VERSION}</p><p>Copyright &copy; 2007 Xyridian Corporation. All rights reserved.</p><p>Text Messaging and e-mail accounts are provided by their own services.</p></div></div>`,
                [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: `About ${TITLE}`, width: 400 });
        }

        // ---- the result pane --------------------------------------------------------------------------

        render() {
            const pane = this.el('.mb-result');
            if (!pane) return;
            let html;
            const a = this.accountOf(this.node);
            let list = false;
            if (this.node === 'root') html = this.rootPage();
            else if (this.node === 'storage') html = this.storagePage();
            else if (/^m(acct|status|fold|sync):/.test(this.node)) {
                const m = this.mailOf(this.node);
                if (!m) html = this.page('Messaging Bridge', '', [{ id: 'gone', title: 'Not available', body: '<p>This account is no longer set up.</p>' }]);
                else if (this.node.startsWith('macct:')) { html = this.folderPage(); list = true; }
                else if (this.node.startsWith('mstatus:')) html = this.mailStatusPage(m);
                else if (this.node.startsWith('mfold:')) { html = this.mailFoldersPage(m); list = true; }
                else html = this.mailSyncPage(m);
            } else if (!a) html = this.page('Messaging Bridge', '', [{ id: 'gone', title: 'Not available', body: '<p>This account is no longer set up.</p>' }]);
            else if (this.node.startsWith('acct:')) { html = this.folderPage(); list = true; }
            else if (this.node.startsWith('status:')) html = this.statusPage(a);
            else if (this.node.startsWith('convs:')) { html = this.chatsPage(a); list = true; }
            else if (this.node.startsWith('sync:')) html = this.syncPage(a);
            pane.classList.toggle('is-list', list);
            if (pane.dataset.html !== html) {
                // a redraw keeps the scroll position of the page or list
                const sc = pane.querySelector('.mb-page-body, .mb-result > .mb-list');
                const top = sc ? sc.scrollTop : 0;
                const left = sc ? sc.scrollLeft : 0;
                const focused = pane.contains(doc.activeElement);
                pane.innerHTML = html;
                pane.dataset.html = html;
                const sc2 = pane.querySelector('.mb-page-body, .mb-result > .mb-list');
                if (sc2) { sc2.scrollTop = top; sc2.scrollLeft = left; }
                if (focused) { const l = pane.querySelector('.mb-list'); if (l) l.focus({ preventScroll: true }); }
            }
            this.renderStatus();
        }

        renderStatus() {
            const spans = this.modal.querySelectorAll('.mb-status span');
            if (!spans.length) return;
            let text = this.note;
            const a = this.accountOf(this.node);
            if (!text && a && this.node.startsWith('convs:')) {
                const list = this.chats.get(a.id);
                if (Array.isArray(list)) {
                    const out = list.filter((c) => !c.synced).length;
                    text = `${num(list.length)} conversation${list.length === 1 ? '' : 's'}${out ? `, ${num(out)} not synchronized` : ''}`;
                }
            }
            if (!text && a && a.sync && a.sync.running) text = this.progressText(a);
            const m = this.mailOf(this.node);
            if (!text && m && this.node.startsWith('mfold:')) {
                const list = this.folders.get(m.id);
                if (Array.isArray(list)) {
                    const out = list.filter((f) => !f.synced).length;
                    text = `${num(list.length)} folder${list.length === 1 ? '' : 's'}${out ? `, ${num(out)} not synchronized` : ''}`;
                }
            }
            if (!text && m && m.sync && m.sync.running) text = this.mailProgressText(m);
            spans[0].textContent = text || '';
        }

        progressText(a) {
            const s = a.sync || {};
            if (s.total) return `Synchronizing ${a.name}: ${num(s.done)} of ${num(s.total)}`;
            if (s.done) return `Synchronizing ${a.name}: ${num(s.done)} so far`;
            return `Synchronizing ${a.name}...`;
        }

        page(title, side, sections) {
            const sec = (s) => `<div class="mb-sec${this.collapsed.has(s.id) ? ' is-collapsed' : ''}" data-sec="${esc(s.id)}"><div class="mb-sec-head">${esc(s.title)}</div><div class="mb-sec-body">${s.body}</div></div>`;
            return `<div class="mb-page-title"><b>${esc(title)}</b><span>${esc(side || '')}</span></div><div class="mb-page-body">${sections.map(sec).join('')}</div>`;
        }

        overview(img, paras) {
            return `<div class="mb-overview"><img src="${esc(img)}" alt=""><div>${paras.map((p) => `<p>${p}</p>`).join('')}</div></div>`;
        }

        props(rows) {
            return `<dl class="mb-props">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}:</dt><dd>${v}</dd>`).join('')}</dl>`;
        }

        /** A state: plain when it is good, with Vista's warning or error icon when it is not. */
        state(ok, text, warn) {
            if (ok) return `<span class="mb-state">${esc(text)}</span>`;
            return `<span class="mb-state"><img src="${warn ? `${VI}/warning-16.png` : `${VI}/error-16.png`}" alt="">${esc(text)}</span>`;
        }

        /** A report list view: cols [{ t, w, num, key, text(row) }], rows; sortable when sortable. */
        listView(cols, rows, opts = {}) {
            // a list in a section shares out the section's width (columns shrink to their ellipsis);
            // the result pane's list keeps MMC's fixed widths and scrolls sideways
            const tpl = opts.fit ? cols.map((c) => `minmax(${Math.min(c.w, c.min || 56)}px, ${c.w}fr)`).join(' ') + ' 0px'
                : cols.map((c) => `${c.w}px`).join(' ') + ' minmax(0, 1fr)';
            const sort = opts.sortable ? (opts.sort || this.sort) : null;
            const head = cols.map((c) => {
                const sorted = sort && sort.key === c.key;
                return `<span class="mb-col${c.num ? ' is-num' : ''}${sorted ? ' is-sorted' : ''}"${opts.sortable ? ` data-sort="${c.key}"` : ''}>${sorted ? `<span class="mb-arrow${sort.dir < 0 ? ' is-down' : ''}"></span>` : ''}${esc(c.t)}</span>`;
            }).join('') + '<span class="mb-col mb-col-rest"></span>';
            const body = rows.length ? rows.map((r) => `<div class="mb-row${r.cls ? ` ${r.cls}` : ''}${r.key && r.key === this.sel ? ' is-selected' : ''}"${r.key ? ` data-key="${esc(r.key)}"` : ''}${r.open ? ` data-open="${esc(r.open)}"` : ''}>${cols.map((c, i) => `<span${c.num ? ' class="is-num"' : ''}>${i === 0 && r.sprite != null ? `<span class="mb-row-icon mb-mail-folder" style="--f:${Number(r.sprite) || 0}"></span>` : ''}${i === 0 && r.icon ? `<img class="mb-row-icon" src="${esc(r.icon)}" alt="">` : ''}<i>${esc(c.text(r.data))}</i></span>`).join('')}<span></span></div>`).join('')
                : `<div class="mb-empty">${esc(opts.empty || 'There are no items to show in this view.')}</div>`;
            return `<div class="mb-list${opts.fit ? ' is-fit' : ''}" tabindex="0" style="--cols:${tpl}"><div class="mb-lhead">${head}</div><div class="mb-lbody">${body}</div></div>`;
        }

        // Messaging Bridge (Local): the accounts at a glance, storage, what needs attention
        rootPage() {
            const side = this.error && this.mailError ? '' : (this.lastRefresh ? `Last refreshed: ${when(this.lastRefresh)}` : 'Reading data, please wait...');
            const intro = this.overview(this.icon('msgbridge-32.png'), [
                'The Messaging Bridge connects Melaton to your messages: Apple iMessage through the BlueBubbles server on your Mac, text messages through Google Messages on a paired phone, and your e-mail accounts through their mail servers.',
                'The server keeps a copy of each account so conversations and mail open at once. The source always wins: the copy is checked against your Mac, phone or mail server and repaired when they differ. Select an account in the console tree to see how far its copy is.'
            ]);
            const sections = [{ id: 'overview', title: 'Overview', body: intro }];
            if (!this.status && !this.error && !this.lastRefresh) return this.page(TITLE, side, sections);
            if (this.error) {
                sections.push({ id: 'error', title: 'Messaging Bridge Not Available', body: this.props([['Status', this.state(false, 'The bridge could not be read')], ['Reason', esc(this.error)]]) });
            }
            if (this.mailError) {
                sections.push({ id: 'mail-error', title: 'E-mail Accounts Not Available', body: this.props([['Status', this.state(false, 'The e-mail accounts could not be read')], ['Reason', esc(this.mailError)]]) });
            }
            const tmAccts = this.error ? [] : this.accounts;
            const inSync = (a) => (a.sync && a.sync.running ? 'Synchronizing' : a.reconcile ? (a.reconcile.inSync ? 'Yes' : 'No') : 'Not checked yet');
            const mailInSync = (a) => (a.sync && a.sync.running ? 'Synchronizing' : a.sync && a.sync.complete ? 'Yes' : 'Not yet');
            const rows = tmAccts.map((a) => ({
                open: `acct:${a.id}`,
                icon: isRcs(a) ? `${ITEMS}/phone-and-modem-options-16.png` : `${ITEMS}/network-and-sharing-center-16.png`,
                data: { name: a.name, status: statusText(a), sync: inSync(a) }
            })).concat(this.mail.map((a) => ({
                open: `macct:${a.id}`,
                icon: MAIL_16,
                data: { name: a.email || a.name, status: mailStatusText(a), sync: mailInSync(a) }
            })));
            sections.push({
                id: 'accounts',
                title: 'Summary of Accounts',
                body: this.listView([
                    { t: 'Account', w: 130, min: 100, text: (x) => x.name },
                    { t: 'Status', w: 96, min: 80, text: (x) => x.status },
                    { t: 'In Sync', w: 100, min: 80, text: (x) => x.sync }
                ], rows, { fit: true, empty: 'No Text Messaging or e-mail account is set up. Add one in Dreamscape CardSpace.' })
                    + (rows.length ? '' : '<p class="mb-note"><span class="mb-link" data-link="cardspace">Open Dreamscape CardSpace</span></p>')
            });
            const issues = [];
            tmAccts.forEach((a) => {
                if (a.status !== 'connected') issues.push([a.name, this.state(false, `${statusText(a)}${a.error ? `: ${a.error}` : ''}`, a.status === 'disabled' || a.status === 'unpaired')]);
                else if (!a.push) issues.push([a.name, this.state(false, 'The push channel is down: new messages arrive only when the copy is checked', true)]);
                else if (a.reconcile && !a.reconcile.inSync) issues.push([a.name, this.state(false, `The copy differs from ${sourceName(a)} (${this.behindText(a)})`, true)]);
                else if (a.sync && !a.sync.complete && !a.sync.running) issues.push([a.name, this.state(false, 'The first synchronization has not finished', true)]);
            });
            this.mail.forEach((a) => {
                const name = a.email || a.name;
                if (a.status !== 'connected') issues.push([name, this.state(false, `${mailStatusText(a)}${a.error ? `: ${a.error}` : ''}`, a.status === 'disabled' || a.status === 'connecting')]);
                else if (!a.push) issues.push([name, this.state(false, 'The push channel is down: new mail arrives only with the next sync', true)]);
                else if (a.sync && !a.sync.complete && !a.sync.running) issues.push([name, this.state(false, 'The first synchronization has not finished', true)]);
            });
            const total = tmAccts.length + this.mail.length;
            sections.push({ id: 'attention', title: 'Needs Attention', body: issues.length ? this.props(issues) : `<p>${total ? 'Every account is connected and its copy matches the source.' : 'Nothing to report.'}</p>` });
            const st = (this.status && this.status.storage) || {};
            const ms = this.mailStorage || {};
            const all = [st.database, st.attachments, ms.database, ms.attachments].reduce((t, v) => t + (Number(v) || 0), 0);
            sections.push({ id: 'storage-sum', title: 'Storage', body: this.props([
                ['Message database', size(st.database)], ['Attachment cache', size(st.attachments)],
                ['Mail database', size(ms.database)], ['Mail attachment cache', size(ms.attachments)], ['Total', size(all)]
            ]) });
            return this.page(TITLE, side, sections);
        }

        behindText(a) {
            const r = a.reconcile || {};
            const src = r.source || {};
            const loc = r.local || {};
            const parts = [];
            if (src.messages != null && loc.messages != null && src.messages !== loc.messages) parts.push(`${num(Math.abs(src.messages - loc.messages))} message${Math.abs(src.messages - loc.messages) === 1 ? '' : 's'} ${src.messages > loc.messages ? 'missing' : 'extra'}`);
            if (src.chats != null && loc.chats != null && src.chats !== loc.chats) parts.push(`${num(Math.abs(src.chats - loc.chats))} conversation${Math.abs(src.chats - loc.chats) === 1 ? '' : 's'} ${src.chats > loc.chats ? 'missing' : 'extra'}`);
            if (r.behind) parts.push(`${num(r.behind)} behind`);
            return parts.join(', ') || 'see Synchronization';
        }

        // an account: MMC's folder view of its three nodes
        folderPage() {
            const n = this.find(this.node);
            const kids = (n && n.children) || [];
            return this.listView([{ t: 'Name', w: 200, text: (k) => k.name }, { t: 'Description', w: 320, text: (k) => k.desc }], kids.map((k) => ({ open: k.id, icon: k.icon, data: k })));
        }

        statusPage(a) {
            const s = a.server || {};
            const intro = this.overview(isRcs(a) ? `${ITEMS}/phone-and-modem-options-32.png` : `${ITEMS}/network-and-sharing-center-32.png`, [
                isRcs(a) ? `${esc(a.name)} reaches your text messages through Google Messages on the paired phone. Pairing is set up in Dreamscape CardSpace.`
                    : `${esc(a.name)} reaches iMessage through the BlueBubbles server on your Mac. The server address and password are set up in Dreamscape CardSpace.`
            ]);
            const conn = [
                ['Status', this.state(a.status === 'connected', statusText(a), a.status === 'connecting' || a.status === 'disabled' || a.status === 'unpaired')],
                a.error && a.status !== 'connected' ? ['Error', esc(a.error)] : null,
                ['Account', esc(a.identity || 'Unknown')],
                ['Service', esc(a.service || (isRcs(a) ? 'RCS' : 'iMessage'))]
            ];
            if (isRcs(a)) {
                conn.push(['Pairing', a.status === 'unpaired' ? `Not paired. <span class="mb-link" data-link="cardspace">Pair the phone in Dreamscape CardSpace</span>` : 'Paired with Google Messages']);
            } else {
                conn.push(['Server', esc(a.url || 'Not set')]);
                conn.push(['Server version', esc(s.version || 'Unknown')]);
                if (s.macOs) conn.push(['macOS version', esc(s.macOs)]);
                conn.push(['Private API', a.server ? (s.privateApi ? `Enabled${s.helper ? ' (helper connected)' : ' (helper not connected)'}` : 'Not available: tapbacks, edits, unsend and typing are off') : 'Unknown']);
            }
            const push = this.props([
                ['Push channel', this.state(!!a.push, a.push ? 'Connected' : 'Not connected', a.status !== 'connected')],
                ['Last pushed message', esc(a.lastPush ? when(a.lastPush) : 'None since the server started')]
            ]) + `<p class="mb-note">${a.push ? `New messages arrive the moment ${sourceName(a)} has them.` : `Without the push channel new messages are found only when the copy is checked against ${sourceName(a)}.`}</p>`;
            const f = a.features || {};
            const feat = Object.keys(f).length ? this.props([['Attachments', f.attachments ? 'Yes' : 'No'], ['Tapbacks', f.tapbacks ? 'Yes' : 'No'], ['Edit and unsend', f.edit || f.unsend ? 'Yes' : 'No'], ['Replies', f.reply ? 'Yes' : 'No'], ['Typing indicators', f.typing ? 'Yes' : 'No'], ['Read receipts', f.readReceipts ? 'Yes' : 'No']]) : '<p>Shown once the account is connected.</p>';
            return this.page('Status', this.lastRefresh ? `Last refreshed: ${when(this.lastRefresh)}` : '', [
                { id: 'st-overview', title: 'Overview', body: intro },
                { id: 'st-conn', title: 'Connection', body: this.props(conn) },
                { id: 'st-push', title: 'Push Channel', body: push },
                { id: 'st-feat', title: 'Features', body: feat }
            ]);
        }

        chatCols() {
            return [
                { t: 'Name', w: 190, key: 'title', text: (c) => c.title || c.guid },
                { t: 'Service', w: 70, key: 'service', text: (c) => c.service || '' },
                { t: 'Last Message', w: 140, key: 'lastDate', text: (c) => when(c.lastDate) },
                { t: 'Messages Held', w: 100, key: 'messages', num: true, text: (c) => num(c.messages) },
                { t: 'Synchronized', w: 86, key: 'synced', text: (c) => (c.synced ? 'Yes' : 'No') }
            ];
        }

        sorted(list) {
            const { key, dir } = this.sort;
            const v = (c) => (key === 'lastDate' ? timeOf(c.lastDate) : key === 'messages' ? Number(c.messages) || 0 : key === 'synced' ? (c.synced ? 1 : 0) : String(c[key] || '').toLowerCase());
            return list.slice().sort((x, y) => { const a = v(x); const b = v(y); return (a < b ? -1 : a > b ? 1 : 0) * dir || String(x.title || '').localeCompare(String(y.title || '')); });
        }

        selChat() {
            const a = this.accountOf(this.node);
            if (!a || !this.sel || !this.node.startsWith('convs:')) return null;
            const list = this.chats.get(a.id);
            return Array.isArray(list) ? list.find((c) => c.guid === this.sel) || null : null;
        }

        chatsPage(a) {
            const list = this.chats.get(a.id);
            if (!list) return `<div class="mb-list"><div class="mb-empty">Reading data, please wait...</div></div>`;
            if (!Array.isArray(list)) return `<div class="mb-list"><div class="mb-empty">${esc(`The conversations could not be read: ${list.error}`)}</div></div>`;
            return this.listView(this.chatCols(), this.sorted(list).map((c) => ({ key: c.guid, icon: this.icon('chat-16.png'), data: c })),
                { sortable: true, empty: 'The server holds no conversations for this account yet.' });
        }

        syncPage(a) {
            const s = a.sync || {};
            const r = a.reconcile;
            const d = a.drift;
            const list = this.chats.get(a.id);
            const prog = s.running
                ? `<div class="mb-progress"><div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.total ? Math.round((s.done / s.total) * 100) : 0}"><div style="width:${s.total ? Math.min(100, (s.done / s.total) * 100).toFixed(1) : 0}%"></div></div><span>${esc(s.total ? `${num(s.done)} of ${num(s.total)}` : `${num(s.done)} so far`)}</span></div>`
                : '';
            const progress = prog + this.props([
                ['State', s.running ? this.state(true, 'Synchronizing') : s.complete ? this.state(true, 'Complete') : this.state(false, a.status === 'connected' ? 'Incomplete: the first synchronization has not finished' : 'Waiting for the account to connect', true)],
                ['Conversations held', num(s.chats)],
                ['Messages held', num(s.messages)]
            ]);
            let rec;
            if (!r) {
                rec = `<p>The copy has not been checked against ${sourceName(a)} yet. Resync Now checks it.</p>`;
            } else {
                const src = r.source || {};
                const loc = r.local || {};
                const rows = [];
                if (src.chats != null || loc.chats != null) rows.push({ data: { item: 'Conversations', src: src.chats, loc: loc.chats } });
                if (src.messages != null || loc.messages != null) rows.push({ data: { item: 'Messages', src: src.messages, loc: loc.messages } });
                const show = (v) => (v == null ? 'Not counted' : num(v));
                rec = this.props([
                    ['Checked', esc(when(r.at) || 'Unknown')],
                    ['Result', r.inSync ? this.state(true, `In sync with ${sourceName(a)}`) : this.state(false, `Out of sync (${this.behindText(a)})`, true)],
                    r.behind != null ? ['Conversations behind', num(r.behind)] : null,
                    r.repaired != null ? ['Repaired from the source', num(r.repaired)] : null,
                    r.removed != null ? ['Removed (gone from the source)', num(r.removed)] : null
                ]) + this.listView([
                    { t: 'Item', w: 120, text: (x) => x.item },
                    { t: isRcs(a) ? 'Phone' : 'Mac', w: 100, num: true, text: (x) => show(x.src) },
                    { t: 'Server Copy', w: 100, num: true, text: (x) => show(x.loc) },
                    { t: 'Difference', w: 90, num: true, text: (x) => (x.src == null || x.loc == null ? '' : x.src === x.loc ? '0' : `${x.loc > x.src ? '+' : '-'}${num(Math.abs(x.loc - x.src))}`) }
                ], rows, { fit: true });
            }
            let lastChat = d && d.lastChat ? d.lastChat : '';
            if (lastChat && Array.isArray(list)) { const c = list.find((x) => x.guid === lastChat); if (c && c.title) lastChat = c.title; }
            const drift = d ? this.props([
                ['Conversations repaired', num(d.chatsRepaired)],
                ['Conversations removed', num(d.chatsRemoved)],
                ['Last repaired', esc(lastChat || 'None')],
                ['Last change', esc(when(d.at) || 'Unknown')]
            ]) + `<p class="mb-note">Each time a conversation opens, its newest messages are checked against ${sourceName(a)}; what differed is repaired and counted here.</p>`
                : `<p>No drift recorded: every conversation checked so far matched ${sourceName(a)}.</p>`;
            let pending;
            if (!list) pending = '<p>Reading data, please wait...</p>';
            else if (!Array.isArray(list)) pending = `<p>${esc(`The conversations could not be read: ${list.error}`)}</p>`;
            else {
                const out = list.filter((c) => !c.synced);
                pending = out.length
                    ? `<p>${num(out.length)} of ${num(list.length)} conversations are not fully synchronized yet; their older messages are read from ${sourceName(a)} when they open.</p>`
                        + this.listView([{ t: 'Name', w: 200, text: (c) => c.title || c.guid }, { t: 'Last Message', w: 130, text: (c) => when(c.lastDate) }, { t: 'Messages Held', w: 90, num: true, text: (c) => num(c.messages) }],
                            this.sorted(out).map((c) => ({ icon: this.icon('chat-16.png'), data: c })), { fit: true })
                    : `<p>All ${num(list.length)} conversations are synchronized.</p>`;
            }
            return this.page('Synchronization', s.running ? this.progressText(a) : (this.lastRefresh ? `Last refreshed: ${when(this.lastRefresh)}` : ''), [
                { id: 'sy-progress', title: 'Synchronization Progress', body: progress },
                { id: 'sy-reconcile', title: 'Last Reconcile', body: rec },
                { id: 'sy-drift', title: 'Drift Log', body: drift },
                { id: 'sy-pending', title: 'Conversations Not Synchronized', body: pending }
            ]);
        }

        storagePage() {
            const st = (this.status && this.status.storage) || {};
            const ms = this.mailStorage || {};
            const parts = [
                { item: 'Message database', bytes: Number(st.database) || 0 },
                { item: 'Attachment cache', bytes: Number(st.attachments) || 0 },
                { item: 'Mail database', bytes: Number(ms.database) || 0 },
                { item: 'Mail attachment cache', bytes: Number(ms.attachments) || 0 }
            ];
            const all = parts.reduce((t, x) => t + x.bytes, 0);
            const intro = this.overview('/static_images/vista-devmgr/disk-drives-32.png', [
                'The server keeps its copy of every Text Messaging account in one message database, and the pictures, videos and files of messages in an attachment cache. Attachments are fetched from the source the first time they are opened and kept after that.',
                'E-mail accounts have a mail database of their own (headers, text and HTML bodies, the search index) and a mail attachment cache, filled the same way from the mail server.'
            ]);
            const usage = this.listView([
                { t: 'Item', w: 170, text: (x) => x.item },
                { t: 'Size', w: 90, num: true, text: (x) => size(x.bytes) },
                { t: 'Share', w: 70, num: true, text: (x) => (all ? `${Math.round((x.bytes / all) * 100)}%` : '') }
            ], parts.concat([{ item: 'Total', bytes: all }]).map((x) => ({ data: x })), { fit: true });
            const tmAccts = this.error ? [] : this.accounts;
            const byAcct = this.listView([
                { t: 'Account', w: 150, min: 100, text: (a) => a.name },
                { t: 'Conversations', w: 96, min: 90, num: true, text: (a) => (a.chats == null ? '' : num(a.chats)) },
                { t: 'Folders', w: 64, min: 56, num: true, text: (a) => (a.folders == null ? '' : num(a.folders)) },
                { t: 'Messages', w: 90, min: 70, num: true, text: (a) => (a.messages == null ? '' : num(a.messages)) }
            ], tmAccts.map((a) => ({
                icon: isRcs(a) ? `${ITEMS}/phone-and-modem-options-16.png` : `${ITEMS}/network-and-sharing-center-16.png`,
                data: { name: a.name, chats: a.sync ? a.sync.chats : null, folders: null, messages: a.sync ? a.sync.messages : null }
            })).concat(this.mail.map((a) => ({
                icon: MAIL_16,
                data: { name: a.email || a.name, chats: null, folders: a.sync ? a.sync.folders : null, messages: a.sync ? a.sync.messages : null }
            }))), { fit: true, empty: 'No Text Messaging or e-mail account is set up.' });
            return this.page('Storage', this.lastRefresh ? `Last refreshed: ${when(this.lastRefresh)}` : '', [
                { id: 'sg-overview', title: 'Overview', body: intro },
                { id: 'sg-usage', title: 'Disk Usage', body: usage },
                { id: 'sg-accounts', title: 'Copies by Account', body: byAcct }
            ]);
        }

        // ---- e-mail accounts (#789) ------------------------------------------------------------------

        mailProgressText(a) {
            const p = (a.sync && a.sync.progress) || null;
            const name = a.email || a.name;
            if (!p || !p.folder) return `Synchronizing ${name}...`;
            return p.total ? `Synchronizing ${name}: ${p.folder}, ${num(p.done)} of ${num(p.total)}` : `Synchronizing ${name}: ${p.folder}`;
        }

        mailStatusPage(a) {
            const name = a.email || a.name;
            const intro = this.overview(MAIL_32, [
                `The server is the mail client for ${esc(name)}: it keeps a copy of every folder, sends with the account's SMTP server and hears new Inbox mail at once over IMAP IDLE. The address, password and servers are set up in Dreamscape CardSpace.`
            ]);
            const sec = { tls: 'SSL/TLS', starttls: 'STARTTLS', none: 'None' };
            const server = (s) => (s && s.host ? `${esc(s.host)}:${esc(s.port || '')} (${esc(sec[s.security] || s.security || 'SSL/TLS')})` : 'Not set');
            const conn = [
                ['Status', this.state(a.status === 'connected' && a.enabled !== false, mailStatusText(a), a.status === 'connecting' || a.status === 'disabled' || a.enabled === false)],
                a.error && a.status !== 'connected' ? ['Error', esc(a.error)] : null,
                ['E-mail address', esc(a.email || 'Unknown')],
                a.displayName ? ['Name', esc(a.displayName)] : null,
                a.imap ? ['Incoming mail (IMAP)', server(a.imap)] : null,
                a.smtp ? ['Outgoing mail (SMTP)', server(a.smtp)] : null,
                a.unread != null ? ['Unread in the Inbox', num(a.unread)] : null
            ];
            const push = this.props([
                ['Push channel', this.state(!!a.push, a.push ? 'Connected (IMAP IDLE on the Inbox)' : 'Not connected', a.status !== 'connected')],
                ['Last pushed message', esc(a.lastPush ? when(a.lastPush) : 'None since the server started')]
            ]) + `<p class="mb-note">${a.push ? 'New mail in the Inbox arrives the moment the mail server has it.' : 'Without the push channel new mail is found only by the next sync (every 10 minutes).'}</p>`;
            return this.page('Status', this.lastRefresh ? `Last refreshed: ${when(this.lastRefresh)}` : '', [
                { id: 'ms-overview', title: 'Overview', body: intro },
                { id: 'ms-conn', title: 'Connection', body: this.props(conn) },
                { id: 'ms-push', title: 'Push Channel', body: push }
            ]);
        }

        folderCols() {
            return [
                { t: 'Folder', w: 170, key: 'name', text: (f) => f.path || f.name },
                { t: 'Special Use', w: 100, key: 'special', text: (f) => (SPECIAL[f.special] ? SPECIAL[f.special][0] : '') },
                { t: 'Messages', w: 76, key: 'total', num: true, text: (f) => num(f.total) },
                { t: 'Unread', w: 64, key: 'unseen', num: true, text: (f) => num(f.unseen) },
                { t: 'Synchronized', w: 86, key: 'synced', text: (f) => (f.synced ? 'Yes' : 'No') }
            ];
        }

        /** Folders in the server's order (Inbox, Drafts, Sent, ... Trash), or by the clicked column. */
        sortedFolders(list) {
            const { key, dir } = this.fsort;
            if (!key) return list.slice();
            const v = (f) => (key === 'total' || key === 'unseen' ? Number(f[key]) || 0 : key === 'synced' ? (f.synced ? 1 : 0)
                : key === 'special' ? (SPECIAL[f.special] ? SPECIAL[f.special][0] : '').toLowerCase() : String(f.path || f.name || '').toLowerCase());
            return list.slice().sort((x, y) => { const a = v(x); const b = v(y); return (a < b ? -1 : a > b ? 1 : 0) * dir || String(x.path).localeCompare(String(y.path)); });
        }

        folderRows(list) {
            return list.map((f) => ({ sprite: SPECIAL[f.special] ? SPECIAL[f.special][1] : 6, data: f }));
        }

        mailFoldersPage(a) {
            const list = this.folders.get(a.id);
            if (!list) return '<div class="mb-list"><div class="mb-empty">Reading data, please wait...</div></div>';
            if (!Array.isArray(list)) return `<div class="mb-list"><div class="mb-empty">${esc(`The folders could not be read: ${list.error}`)}</div></div>`;
            return this.listView(this.folderCols(), this.folderRows(this.sortedFolders(list)), { sortable: true, sort: this.fsort, empty: 'The server holds no folders for this account yet.' });
        }

        mailSyncPage(a) {
            const s = a.sync || {};
            const p = s.progress || null;
            const list = this.folders.get(a.id);
            let prog = '';
            if (s.running) {
                // the folder bar: where the worker is in the folder list; the line under it, the folder itself
                const pct = p && p.folders ? Math.min(100, ((p.folderIndex + (p.total ? Math.min(1, p.done / p.total) : 0)) / p.folders) * 100) : 0;
                const label = p && p.folder ? `${p.folder}${p.total ? `: ${num(p.done)} of ${num(p.total)}` : ''}${p.folders ? ` (folder ${num(p.folderIndex + 1)} of ${num(p.folders)})` : ''}` : 'Starting...';
                prog = `<div class="mb-progress"><div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div style="width:${pct.toFixed(1)}%"></div></div><span>${esc(label)}</span></div>`;
            }
            const progress = prog + this.props([
                ['State', s.running ? this.state(true, 'Synchronizing') : s.complete ? this.state(true, 'Complete') : this.state(false, a.status === 'connected' ? 'Incomplete: the first synchronization has not finished' : 'Waiting for the account to connect', true)],
                ['Last synchronized', esc(s.lastSync ? when(s.lastSync) : 'Never')],
                ['Folders synchronized', `${num(s.syncedFolders)} of ${num(s.folders)}`],
                ['Messages held', num(s.messages)],
                ['Messages with bodies', num(s.bodies)]
            ]) + '<p class="mb-note">The server synchronizes every 10 minutes and when Resync Now is chosen; new Inbox mail arrives in between over the push channel. The mail server always wins: flags, moves and deletions made elsewhere replace the copy\'s.</p>';
            let pending;
            if (!list) pending = '<p>Reading data, please wait...</p>';
            else if (!Array.isArray(list)) pending = `<p>${esc(`The folders could not be read: ${list.error}`)}</p>`;
            else {
                const out = list.filter((f) => !f.synced);
                pending = out.length
                    ? `<p>${num(out.length)} of ${num(list.length)} folders are not synchronized yet.</p>`
                        + this.listView([{ t: 'Folder', w: 200, text: (f) => f.path || f.name }, { t: 'Messages', w: 90, num: true, text: (f) => num(f.total) }], this.folderRows(out), { fit: true })
                    : `<p>All ${num(list.length)} folders are synchronized.</p>`;
            }
            return this.page('Synchronization', s.running ? this.mailProgressText(a) : (this.lastRefresh ? `Last refreshed: ${when(this.lastRefresh)}` : ''), [
                { id: 'msy-progress', title: 'Synchronization Progress', body: progress },
                { id: 'msy-pending', title: 'Folders Not Synchronized', body: pending }
            ]);
        }

        // ---- result pane input -----------------------------------------------------------------------

        resultClick(ev) {
            const head = ev.target.closest('.mb-sec-head');
            if (head) {
                const id = head.parentElement.dataset.sec;
                if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
                setReg({ CollapsedSections: [...this.collapsed] });
                head.parentElement.classList.toggle('is-collapsed', this.collapsed.has(id));
                delete this.el('.mb-result').dataset.html;
                return;
            }
            if (ev.target.closest('[data-link="cardspace"]')) { this.cardSpace(); return; }
            const col = ev.target.closest('[data-sort]');
            if (col) {
                const k = col.dataset.sort;
                if (this.node.startsWith('mfold:')) {
                    this.fsort = this.fsort.key === k ? { key: k, dir: -this.fsort.dir } : { key: k, dir: k === 'total' || k === 'unseen' ? -1 : 1 };
                    setReg({ FolderSort: this.fsort });
                    this.render();
                    return;
                }
                this.sort = this.sort.key === k ? { key: k, dir: -this.sort.dir } : { key: k, dir: k === 'lastDate' || k === 'messages' ? -1 : 1 };
                setReg({ Sort: this.sort });
                this.render();
                return;
            }
            const row = ev.target.closest('.mb-row[data-key]');
            if (row) {
                this.sel = row.dataset.key;
                this.el('.mb-result').querySelectorAll('.mb-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                delete this.el('.mb-result').dataset.html;
                this.renderActions();
            }
        }

        resultDblClick(ev) {
            const row = ev.target.closest('.mb-row');
            if (!row) return;
            if (row.dataset.open) { this.select(row.dataset.open, true); return; }
            if (row.dataset.key && this.node.startsWith('convs:')) this.openChat();
        }

        listKey(ev) {
            if (!this.node.startsWith('convs:') || !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(ev.key)) return;
            const rows = Array.from(this.el('.mb-result').querySelectorAll('.mb-row[data-key]'));
            if (!rows.length) return;
            ev.preventDefault();
            if (ev.key === 'Enter') { this.openChat(); return; }
            let i = rows.findIndex((r) => r.dataset.key === this.sel);
            if (ev.key === 'ArrowDown') i = Math.min(rows.length - 1, i + 1);
            else if (ev.key === 'ArrowUp') i = Math.max(0, i - 1);
            else if (ev.key === 'Home') i = 0;
            else i = rows.length - 1;
            rows.forEach((r) => r.classList.remove('is-selected'));
            rows[i].classList.add('is-selected');
            rows[i].scrollIntoView({ block: 'nearest' });
            this.sel = rows[i].dataset.key;
            delete this.el('.mb-result').dataset.html;
            this.renderActions();
        }

        destroy() {
            clearTimeout(this.pollTimer);
            clearTimeout(this.eventTimer);
            const t = this.tmListened;
            if (t && typeof t.off === 'function' && this.onEvent) this.events.forEach((e) => t.off(e, this.onEvent));
            if (t && typeof t.off === 'function' && this.onProgress) t.off('syncprogress', this.onProgress);
            const ml = this.maListened;
            if (ml && typeof ml.off === 'function' && this.onMailEvent) this.mailEvents.forEach((e) => ml.off(e, this.onMailEvent));
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    let running = null;

    async function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const b = new Bridge(app);
        running = b;
        app.onExit(() => { running = null; b.destroy(); });
    }

    root.melatonMessagingBridge = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('msgbridge', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
