/**
 * Melaton Messenger (Yozora #779): the desktop's window onto the Text Messaging accounts
 * (BlueBubbles = iMessage, later RCS), a Vista-era Xyridian messaging program laid out like
 * Windows Mail: the menu band, the blue command bar, the folder pane, the conversation list and
 * the conversation itself, with a status bar. Everything goes through window.textMessaging
 * (public/scripts/comp/textMessagingClient.js), read at call time so a test can swap it.
 *
 *   folder pane     each account (its title, the Apple ID / phone under it) with Inbox and
 *                   Unknown Senders, unread counts in brackets as Windows Mail shows them
 *   conversation    bubbles (sender names in groups), pictures inline, files as links, tapbacks,
 *                   a reply's quote, Edited, unsent messages, the typing line, Read / Delivered
 *                   under your last message; a right click on a message gives Reply, the
 *                   reactions, Edit, Unsend and Copy (only what the account's features{} allow)
 *   compose         Enter sends (Shift+Enter is a new line); Attach, drag and drop and pasted
 *                   pictures go through sendFile with the upload's progress in the status bar
 *   New Message     To: (addresses split by ; or ,) and the text; the new chat opens after
 *
 *   melatonApps.launch({ packageId: 'messenger', args: { accountId, chatGuid } })   open a chat
 *   melatonApps.launch({ packageId: 'messenger', args: { compose: { to } } })       write to an address
 *   melatonApps.define('messenger', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const A = '/melaton-apps/messenger/assets';
    const NAME = 'Melaton Messenger';
    const VERSION = '1.0.779.0';
    const SOUND_KEY = 'melaton-messenger-sound';
    const PAGE = 50;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const tm = () => root.textMessaging || null;

    function soundOn() {
        try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (_) { return true; }
    }

    function setSound(on) {
        try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (_) { /* this session only */ }
    }

    function sameDay(a, b) {
        const x = new Date(a);
        const y = new Date(b);
        return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
    }

    const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    /** The list's date column: the time today, the weekday this week, else the date (Windows Mail). */
    function shortWhen(ms) {
        if (!ms) return '';
        const now = Date.now();
        if (sameDay(ms, now)) return timeOf(ms);
        if (now - ms < 6 * 86400e3) return new Date(ms).toLocaleDateString([], { weekday: 'short' });
        return new Date(ms).toLocaleDateString();
    }

    function longWhen(ms) {
        const d = new Date(ms);
        if (sameDay(ms, Date.now())) return `Today ${timeOf(ms)}`;
        if (sameDay(ms, Date.now() - 86400e3)) return `Yesterday ${timeOf(ms)}`;
        return `${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} ${timeOf(ms)}`;
    }

    function senderName(m) {
        const s = (m && m.sender) || {};
        return s.name || s.address || 'Unknown';
    }

    /** One line for a message (the list, a quote, a notification). */
    function snippet(m) {
        if (!m) return '';
        if (m.retracted) return m.fromMe ? 'You unsent a message.' : `${senderName(m)} unsent a message.`;
        if (m.text) return String(m.text).replace(/\s+/g, ' ').trim();
        const atts = m.attachments || [];
        if (atts.length) {
            const pics = atts.filter((a) => /^image\//.test(a.mime || ''));
            if (pics.length === atts.length) return pics.length > 1 ? `${pics.length} Pictures` : 'Picture';
            return atts.length > 1 ? `${atts.length} Attachments` : (atts[0].name || 'Attachment');
        }
        if (m.groupEvent) return typeof m.groupEvent === 'string' ? m.groupEvent : 'Group changed';
        return '';
    }

    function bytes(n) {
        const v = Number(n);
        if (!Number.isFinite(v) || v <= 0) return '';
        if (v < 1024) return `${v} bytes`;
        if (v < 1048576) return `${Math.round(v / 1024)} KB`;
        return `${(v / 1048576).toFixed(1)} MB`;
    }

    /** An address as a match key: e-mail lower case, a phone number as its last 10 digits. */
    function addressKey(a) {
        const s = String(a || '').trim().toLowerCase();
        if (s.includes('@')) return s;
        const d = s.replace(/\D/g, '');
        return d.length > 10 ? d.slice(-10) : d;
    }

    class Messenger {
        constructor(app) {
            this.app = app;
            this.accounts = [];
            this.settings = { notifyUnknown: false };
            this.counts = {};          // accountId -> { unread, unknownUnread }
            this.accountId = null;
            this.folder = 'inbox';
            this.chats = [];
            this.chatGuid = null;
            this.messages = [];
            this.more = false;
            this.compose = null;       // { to } while writing a new message
            this.replyTo = null;       // the message being answered
            this.selected = null;      // a message chosen with a click (Reactions, Reply, Edit)
            this.typingTimers = new Map();
            this.typingWho = new Map(); // chatGuid -> true
            this.pendingN = 0;
            this.statusBar = true;
            this.upload = null;        // { name, pct }
            this.error = '';
            this.build();
            this.wire();
            void this.loadAccounts().then(() => this.applyArgs(app.args));
        }

        // ---- the window ----

        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window mm-window';
            m.dataset.windowIdentifier = 'melatonMessenger';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = `${A}/messenger-32.png`;
            m.dataset.windowDefaultWidth = '900';
            m.dataset.windowDefaultHeight = '620';
            m.dataset.windowMinWidth = '640';
            m.dataset.windowMinHeight = '420';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', NAME);
            const menus = [['File', 'file'], ['Edit', 'edit'], ['View', 'view'], ['Tools', 'tools'], ['Help', 'help']];
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/messenger-16.png" alt=""><span class="mm-caption">${NAME}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small mm-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 mm-client">
                    <div class="naxt-menubar mm-menubar" role="menubar" data-win32-menus>${menus.map(([t, id]) => `<button type="button" class="naxt-menu-title" data-mm-menu="${id}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="mm-cmdbar" role="toolbar">
                        <button type="button" class="mm-cmd" data-mm="new" data-mm-icon="new"><span class="mm-cmd-icon"></span><span>New Message</span></button>
                        <button type="button" class="mm-cmd" data-mm="attach" data-mm-icon="attach"><span class="mm-cmd-icon"></span><span>Attach File</span></button>
                        <button type="button" class="mm-cmd mm-cmd-drop" data-mm-react><span>Reactions</span><span class="mm-cmd-chevron"></span></button>
                        <button type="button" class="mm-cmd" data-mm="reply" data-mm-icon="reply"><span class="mm-cmd-icon"></span><span>Reply</span></button>
                        <button type="button" class="mm-cmd" data-mm="refresh" data-mm-icon="refresh"><span class="mm-cmd-icon"></span><span>Refresh</span></button>
                    </div>
                    <div class="mm-body">
                        <div class="mm-folders" tabindex="0" aria-label="Folders"></div>
                        <div class="mm-split" data-mm-split="folders"></div>
                        <div class="mm-list" tabindex="0" aria-label="Conversations"></div>
                        <div class="mm-split" data-mm-split="list"></div>
                        <div class="mm-conv">
                            <div class="mm-conv-head"></div>
                            <div class="mm-thread" tabindex="0"></div>
                            <div class="mm-typing"></div>
                            <div class="mm-reply hidden"><span class="mm-reply-text"></span><button type="button" class="mm-reply-x" title="Cancel reply" aria-label="Cancel reply"></button></div>
                            <div class="mm-compose">
                                <textarea class="mm-input" rows="3" placeholder="Type a message" aria-label="Message"></textarea>
                                <div class="mm-compose-buttons">
                                    <button type="button" class="btn-standard mm-send" data-mm="send">Send</button>
                                    <button type="button" class="btn-standard mm-attach-btn" data-mm="attach">Attach...</button>
                                </div>
                            </div>
                            <div class="mm-drop hidden"><span>Drop the file here to send it</span></div>
                        </div>
                    </div>
                    <div class="mm-status"><span class="mm-status-text"></span><span class="mm-status-progress hidden"><span class="mm-progress"><span class="mm-progress-fill"></span></span></span><span class="mm-status-online"><span class="mm-status-online-icon"></span><span class="mm-status-online-text"></span></span></div>
                    <input type="file" class="mm-file" multiple hidden>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.q = (s) => m.querySelector(s);
            m.id = 'melatonMessengerModal';
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed || m.hasAttribute('data-window-position-restored')) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: NAME, terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'messenger' }) });
            }
        }

        wire() {
            const m = this.modal;
            const q = this.q;
            const sig = { signal: this.app.signal };
            q('.mm-close').addEventListener('click', () => this.app.exit(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            m.addEventListener('click', (ev) => {
                const t = ev.target.closest('[data-mm]');
                if (t && !t.disabled && m.contains(t)) { void this.command(t.dataset.mm, t); return; }
                const folder = ev.target.closest('.mm-folder[data-folder]');
                if (folder) { this.selectFolder(folder.dataset.account, folder.dataset.folder); return; }
                const acct = ev.target.closest('.mm-account[data-account]');
                if (acct) { this.selectFolder(acct.dataset.account, 'inbox'); return; }
                const row = ev.target.closest('.mm-row[data-guid]');
                if (row) { void this.openChat(row.dataset.guid); return; }
                const msg = ev.target.closest('.mm-msg[data-guid]');
                if (msg && !ev.target.closest('a')) { this.select(msg.dataset.guid); return; }
                if (ev.target.closest('.mm-reply-x')) { this.setReply(null); return; }
                if (ev.target.closest('[data-mm-cardspace]')) { ev.preventDefault(); this.openAccounts(); }
            }, sig);
            m.addEventListener('keydown', (ev) => this.keydown(ev), sig);
            const input = q('.mm-input');
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void this.command('send'); }
                if (ev.key === 'Escape' && this.replyTo) { ev.preventDefault(); this.setReply(null); }
            }, sig);
            input.addEventListener('input', () => {
                const a = this.account();
                const t = tm();
                if (t && a && this.chatGuid && !this.compose && this.features().typing) void t.typing(a.id, this.chatGuid, !!input.value.trim());
                this.syncCommands();
            }, sig);
            input.addEventListener('paste', (ev) => {
                const files = [...((ev.clipboardData && ev.clipboardData.files) || [])];
                if (!files.length) return;
                ev.preventDefault();
                void this.sendFiles(files);
            }, sig);
            const fileInput = q('.mm-file');
            fileInput.addEventListener('change', () => {
                const files = [...(fileInput.files || [])];
                fileInput.value = '';
                if (files.length) void this.sendFiles(files);
            }, sig);
            // drag and drop onto the conversation
            const conv = q('.mm-conv');
            let depth = 0;
            const canDrop = (ev) => this.chatGuid && !this.compose && this.features().attachments !== false && [...((ev.dataTransfer && ev.dataTransfer.types) || [])].includes('Files');
            conv.addEventListener('dragenter', (ev) => { if (!canDrop(ev)) return; ev.preventDefault(); depth += 1; q('.mm-drop').classList.remove('hidden'); }, sig);
            conv.addEventListener('dragover', (ev) => { if (!canDrop(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }, sig);
            conv.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) q('.mm-drop').classList.add('hidden'); }, sig);
            conv.addEventListener('drop', (ev) => {
                depth = 0;
                q('.mm-drop').classList.add('hidden');
                if (!canDrop(ev)) return;
                ev.preventDefault();
                const files = [...(ev.dataTransfer.files || [])];
                if (files.length) void this.sendFiles(files);
            }, sig);
            // older messages when the thread is scrolled to its top
            q('.mm-thread').addEventListener('scroll', () => {
                const th = q('.mm-thread');
                if (th.scrollTop < 40 && this.more && !this.loadingOlder) void this.loadOlder();
            }, sig);
            this.wireSplitters(sig);
            this.wireMenus();
            this.wireEvents();
        }

        wireSplitters(sig) {
            const q = this.q;
            this.modal.querySelectorAll('.mm-split').forEach((bar) => {
                bar.addEventListener('pointerdown', (ev) => {
                    ev.preventDefault();
                    const pane = bar.previousElementSibling;
                    const x0 = ev.clientX;
                    const w0 = pane.getBoundingClientRect().width;
                    const move = (e) => { pane.style.width = `${Math.max(140, Math.min(420, Math.round(w0 + e.clientX - x0)))}px`; };
                    const up = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); };
                    doc.addEventListener('pointermove', move);
                    doc.addEventListener('pointerup', up);
                }, sig);
            });
            void q;
        }

        wireMenus() {
            const cm = root.contextMenu;
            if (!cm) return;
            this.modal.querySelectorAll('[data-mm-menu]').forEach((btn) => {
                const config = {
                    sections: [{ type: 'list', items: [] }],
                    beforeShow: () => { config.sections = [{ type: 'list', items: this.menuItems(btn.dataset.mmMenu) }]; },
                    onAction: (action) => void this.command(action)
                };
                cm.attachClickMenuToElement(btn, config);
            });
            const react = this.q('[data-mm-react]');
            const rconfig = {
                sections: [{ type: 'list', items: [] }],
                beforeShow: () => { rconfig.sections = [{ type: 'list', items: this.reactionItems(this.message(this.selected)) }]; },
                onAction: (action) => void this.command(action)
            };
            cm.attachClickMenuToElement(react, rconfig);
            // a right click on a message
            const thread = this.q('.mm-thread');
            const tconfig = {
                sections: [{ type: 'list', items: [] }],
                beforeShow: (ev) => {
                    const el = ev && ev.target && ev.target.closest ? ev.target.closest('.mm-msg[data-guid]') : null;
                    if (el) this.select(el.dataset.guid);
                    tconfig.sections = [{ type: 'list', items: el ? this.messageItems(this.message(el.dataset.guid)) : [{ text: 'Select All', action: 'select-all' }] }];
                },
                onAction: (action) => void this.command(action)
            };
            cm.attachToElement(thread, tconfig);
        }

        wireEvents() {
            const t = tm();
            if (!t || typeof t.on !== 'function') return;
            const on = (ev, fn) => { t.on(ev, fn); this.app.signal.addEventListener('abort', () => { const now = tm(); if (now && now.off) now.off(ev, fn); if (t !== now && t.off) t.off(ev, fn); }); };
            on('message', (d) => this.onMessage(d));
            on('updated', (d) => this.onUpdated(d));
            on('reaction', (d) => this.onReaction(d));
            on('typing', (d) => this.onTyping(d));
            on('read', (d) => this.onRead(d));
            on('chat', (d) => { if (d && d.accountId === this.accountId) this.refreshChatsSoon(); });
            on('account', () => void this.loadAccounts(true));
            on('settings', (d) => { if (d && d.settings) this.settings = d.settings; });
            on('resync', () => void this.loadAccounts(true));
            on('unread', (d) => { if (d && d.byAccount) { this.counts = d.byAccount; this.renderFolders(); } });
        }

        // ---- state helpers ----

        account(id) {
            const want = id || this.accountId;
            return this.accounts.find((a) => a.id === want) || null;
        }

        features() {
            const a = this.account();
            return (a && a.features) || {};
        }

        chat(guid) {
            return this.chats.find((c) => c.guid === (guid || this.chatGuid)) || null;
        }

        message(guid) {
            return guid ? this.messages.find((x) => x.guid === guid) || null : null;
        }

        // ---- loading ----

        async loadAccounts(force) {
            const t = tm();
            if (!t) { this.error = 'Text Messaging is not available.'; this.renderAll(); return; }
            try {
                const d = await t.accounts(!!force);
                this.accounts = (d && d.accounts) || [];
                this.settings = (d && d.settings) || this.settings;
                this.error = '';
                this.accounts.forEach((a) => { if (a.unread != null) this.counts[a.id] = { unread: Number(a.unread) || 0, unknownUnread: Number(a.unknownUnread) || 0 }; });
            } catch (err) {
                this.accounts = [];
                this.error = (err && err.message) || 'The accounts could not be read.';
            }
            if (!this.account()) { this.accountId = this.accounts.length ? this.accounts[0].id : null; this.folder = 'inbox'; this.chatGuid = null; this.messages = []; }
            this.renderAll();
            if (this.accountId) await this.loadChats();
            if (typeof t.summary === 'function') t.summary().then((list) => {
                (list || []).forEach((a) => { this.counts[a.id] = { unread: Number(a.unread) || 0, unknownUnread: Number(a.unknownUnread) || 0 }; });
                this.renderFolders();
            }).catch(() => { /* the counts wait for the next 'unread' */ });
        }

        async loadChats() {
            const t = tm();
            const a = this.account();
            if (!t || !a) { this.chats = []; this.renderList(); return; }
            const want = `${a.id}|${this.folder}`;
            this.listKey = want;
            // the logon step's snapshot (textMessaging.snapshot()) draws the Inbox at once
            const snap = typeof t.snapshot === 'function' ? t.snapshot() : null;
            const seed = this.folder === 'inbox' && snap && snap.inbox ? snap.inbox[a.id] : null;
            if (seed && !this.chats.length) { this.chats = seed.slice(); this.listNote = ''; } else this.listNote = 'Loading...';
            this.renderList();
            try {
                const d = await t.chats(a.id, { folder: this.folder, limit: 100 });
                if (this.listKey !== want) return;
                this.chats = (d && d.chats) || [];
                this.listNote = '';
            } catch (err) {
                if (this.listKey !== want) return;
                this.chats = [];
                this.listNote = (err && err.message) || 'The conversations could not be read.';
            }
            this.renderList();
            if (!this.chatGuid && !this.compose) this.renderConv();
            this.renderStatus();
        }

        refreshChatsSoon() {
            clearTimeout(this.chatsTimer);
            this.chatsTimer = setTimeout(() => void this.loadChats(), 400);
        }

        selectFolder(accountId, folder) {
            if (accountId === this.accountId && folder === this.folder && !this.compose) return;
            this.accountId = accountId;
            this.folder = folder;
            this.chatGuid = null;
            this.messages = [];
            this.compose = null;
            this.setReply(null, true);
            this.selected = null;
            this.renderAll();
            void this.loadChats();
        }

        async openChat(guid, accountId) {
            const t = tm();
            if (accountId && accountId !== this.accountId) { this.accountId = accountId; this.renderFolders(); }
            const a = this.account();
            if (!t || !a || !guid) return;
            if (this.chatGuid && this.chatGuid !== guid && this.features().typing) void t.typing(a.id, this.chatGuid, false);
            this.compose = null;
            this.chatGuid = guid;
            this.messages = [];
            this.more = false;
            this.cursor = null;
            this.selected = null;
            this.setReply(null, true);
            this.q('.mm-input').value = '';
            this.threadNote = 'Loading...';
            this.renderList();
            this.renderConv();
            if (!this.chat(guid)) {
                // a chat from a notification or a compose that is in the other folder
                try {
                    const c = await t.chat(a.id, guid);
                    if (c && this.chatGuid === guid) {
                        const folder = c.known === false ? 'unknown' : 'inbox';
                        if (folder !== this.folder) { this.folder = folder; this.renderFolders(); await this.loadChats(); }
                        if (!this.chat(guid)) this.chats.unshift(c);
                        this.renderList();
                    }
                } catch (_) { /* the thread still loads */ }
            }
            try {
                const d = await t.messages(a.id, guid, { limit: PAGE });
                if (this.chatGuid !== guid) return;
                this.messages = (d && d.messages) || [];
                this.more = !!(d && d.more);
                this.cursor = d && d.cursor != null ? d.cursor : null;
                this.threadNote = '';
            } catch (err) {
                if (this.chatGuid !== guid) return;
                this.threadNote = (err && err.message) || 'The messages could not be read.';
            }
            this.renderConv(true);
            this.markRead();
            setTimeout(() => { if (this.chatGuid === guid) this.q('.mm-input').focus({ preventScroll: true }); }, 0);
        }

        async loadOlder() {
            const t = tm();
            const a = this.account();
            const first = this.messages[0];
            if (!t || !a || !first) return;
            this.loadingOlder = true;
            const guid = this.chatGuid;
            const th = this.q('.mm-thread');
            const h0 = th.scrollHeight;
            try {
                // the page's cursor is opaque (a date for iMessage, a cursor for RCS)
                const d = await t.messages(a.id, guid, { limit: PAGE, before: this.cursor != null ? this.cursor : first.date });
                if (this.chatGuid !== guid) return;
                this.cursor = d && d.cursor != null ? d.cursor : null;
                const have = new Set(this.messages.map((x) => x.guid));
                this.messages = ((d && d.messages) || []).filter((x) => !have.has(x.guid)).concat(this.messages);
                this.more = !!(d && d.more);
                this.renderThread();
                th.scrollTop = th.scrollHeight - h0;
            } catch (_) { /* the top stays */ } finally { this.loadingOlder = false; }
        }

        markRead() {
            const t = tm();
            const a = this.account();
            const c = this.chat();
            if (!t || !a || !this.chatGuid || doc.hidden || this.modal.classList.contains('minimized')) return;
            if (c && !c.unread) return;
            if (c) c.unread = false;
            this.renderList();
            this.renderStatus();
            void t.markRead(a.id, this.chatGuid).catch(() => {});
        }

        applyArgs(args) {
            const a = args || {};
            if (a.compose) { this.newMessage(a.compose.to || '', a.compose.accountId); return; }
            if (a.chatGuid) void this.openChat(a.chatGuid, a.accountId);
        }

        // ---- events ----

        onMessage(d) {
            if (!d || !d.message) return;
            if (d.accountId === this.accountId) {
                const c = this.chat(d.chatGuid);
                if (c) {
                    c.last = d.message;
                    if (!d.message.fromMe && d.chatGuid !== this.chatGuid) c.unread = true;
                    this.chats.sort((x, y) => ((y.last && y.last.date) || 0) - ((x.last && x.last.date) || 0));
                    this.renderList();
                } else this.refreshChatsSoon();
            }
            if (d.accountId !== this.accountId || d.chatGuid !== this.chatGuid) return;
            const m = d.message;
            const at = this.messages.findIndex((x) => x.guid === m.guid || (d.tempGuid && x.guid === d.tempGuid));
            if (at >= 0) this.messages[at] = m;
            else {
                // our own message coming back: it takes the place of its pending copy
                if (m.fromMe) {
                    const p = this.messages.findIndex((x) => x.pending && !x.error && (x.text || '') === (m.text || '') && !(x.attachments || []).length === !(m.attachments || []).length);
                    if (p >= 0) this.messages.splice(p, 1);
                }
                this.messages.push(m);
            }
            if (!m.fromMe) this.typingWho.delete(d.chatGuid);
            this.renderThread(true);
            this.renderTyping();
            if (!m.fromMe) this.markRead();
        }

        onUpdated(d) {
            if (!d || !d.message || d.accountId !== this.accountId) return;
            const c = this.chat(d.chatGuid);
            if (c && c.last && c.last.guid === d.message.guid) { c.last = d.message; this.renderList(); }
            if (d.chatGuid !== this.chatGuid) return;
            const at = this.messages.findIndex((x) => x.guid === d.message.guid);
            if (at >= 0) { this.messages[at] = d.message; this.renderThread(); }
        }

        onReaction(d) {
            if (!d || d.accountId !== this.accountId || d.chatGuid !== this.chatGuid || !d.reaction) return;
            const m = this.message(d.targetGuid);
            if (!m) return;
            const r = d.reaction;
            const who = (x) => (x.fromMe ? 'me' : addressKey(x.sender && x.sender.address));
            m.reactions = (m.reactions || []).filter((x) => who(x) !== who(r));
            if (!r.removed) m.reactions.push({ type: r.type, emoji: r.emoji, fromMe: !!r.fromMe, sender: r.sender, date: r.date || Date.now() });
            this.renderThread();
        }

        onTyping(d) {
            if (!d || d.accountId !== this.accountId) return;
            clearTimeout(this.typingTimers.get(d.chatGuid));
            if (d.typing) {
                this.typingWho.set(d.chatGuid, true);
                // a lost "stopped" event must not leave the line for ever
                this.typingTimers.set(d.chatGuid, setTimeout(() => { this.typingWho.delete(d.chatGuid); this.renderTyping(); }, 60000));
            } else this.typingWho.delete(d.chatGuid);
            if (d.chatGuid === this.chatGuid) this.renderTyping();
        }

        onRead(d) {
            if (!d || d.accountId !== this.accountId) return;
            const c = this.chat(d.chatGuid);
            if (c && d.read !== false && !(d.message && d.message.fromMe)) { c.unread = false; this.renderList(); }
            if (d.chatGuid !== this.chatGuid) return;
            // your messages were read: Read under the last one
            if (d.message && d.message.guid) {
                const at = this.messages.findIndex((x) => x.guid === d.message.guid);
                if (at >= 0) { this.messages[at] = d.message; this.renderThread(); }
            } else if (d.date || d.dateRead) {
                const when = d.dateRead || d.date;
                this.messages.forEach((x) => { if (x.fromMe && !x.dateRead && x.date <= when) x.dateRead = when; });
                this.renderThread();
            }
        }

        // ---- commands ----

        async command(cmd, el) {
            const t = tm();
            const a = this.account();
            const f = this.features();
            const sel = this.message(this.selected);
            switch (cmd) {
                case 'new': this.newMessage('', null); return;
                case 'attach':
                    if (!this.chatGuid || this.compose || f.attachments === false) return;
                    this.q('.mm-file').click();
                    return;
                case 'send': await this.send(); return;
                case 'reply': if (sel && f.reply) this.setReply(sel); return;
                case 'refresh': await this.loadAccounts(true); if (this.chatGuid) await this.openChat(this.chatGuid); return;
                case 'mark-read': { const c = this.chat(); if (c) { c.unread = true; this.markRead(); } return; }
                case 'mark-all-read':
                    for (const c of this.chats.filter((x) => x.unread)) { c.unread = false; if (t && a) void t.markRead(a.id, c.guid).catch(() => {}); }
                    this.renderList();
                    return;
                case 'copy': {
                    const text = sel ? snippet(sel) : String(root.getSelection ? root.getSelection() : '');
                    if (text && navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => {});
                    return;
                }
                case 'select-all': {
                    const r = doc.createRange();
                    r.selectNodeContents(this.q('.mm-thread'));
                    const s = root.getSelection();
                    s.removeAllRanges();
                    s.addRange(r);
                    return;
                }
                case 'edit': if (sel && sel.fromMe && f.edit && !sel.retracted) await this.editMessage(sel); return;
                case 'unsend': if (sel && sel.fromMe && f.unsend && !sel.retracted) await this.unsendMessage(sel); return;
                case 'folder-inbox': if (a) this.selectFolder(a.id, 'inbox'); return;
                case 'folder-unknown': if (a) this.selectFolder(a.id, 'unknown'); return;
                case 'status-bar': this.statusBar = !this.statusBar; this.q('.mm-status').classList.toggle('hidden', !this.statusBar); return;
                case 'accounts': this.openAccounts(); return;
                case 'options': await this.options(); return;
                case 'help': await this.help(); return;
                case 'about': await this.about(); return;
                case 'exit': this.app.exit(); return;
                default:
                    if (/^react:/.test(cmd)) await this.react(sel, cmd.slice(6));
            }
            void el;
        }

        keydown(ev) {
            const k = ev.key;
            const ctrl = ev.ctrlKey || ev.metaKey;
            if (ctrl && !ev.shiftKey && k.toLowerCase() === 'n') { ev.preventDefault(); void this.command('new'); return; }
            if (ctrl && !ev.shiftKey && k.toLowerCase() === 'r') { ev.preventDefault(); void this.command('reply'); return; }
            if (ctrl && !ev.shiftKey && k.toLowerCase() === 'q') { ev.preventDefault(); void this.command('mark-read'); return; }
            if (k === 'F5') { ev.preventDefault(); void this.command('refresh'); return; }
            if (k === 'F1') { ev.preventDefault(); void this.command('help'); return; }
            // the conversation list by keyboard
            if ((k === 'ArrowDown' || k === 'ArrowUp') && ev.target === this.q('.mm-list') && this.chats.length) {
                ev.preventDefault();
                const at = this.chats.findIndex((c) => c.guid === this.chatGuid);
                const next = this.chats[Math.max(0, Math.min(this.chats.length - 1, at + (k === 'ArrowDown' ? 1 : -1)))];
                if (next) void this.openChat(next.guid);
            }
        }

        menuItems(menu) {
            const f = this.features();
            const sel = this.message(this.selected);
            const has = !!this.account();
            const inChat = !!(this.chatGuid && !this.compose);
            const mine = !!(sel && sel.fromMe && !sel.retracted && !sel.pending);
            const sep = { separator: true };
            const check = (on) => ({ showIndicator: true, checked: !!on });
            if (menu === 'file') {
                return [
                    { text: 'New Message', subtext: 'Ctrl+N', action: 'new', disabled: !has || f.newChat === false },
                    f.attachments !== false ? { text: 'Attach File...', action: 'attach', disabled: !inChat } : null,
                    sep,
                    { text: 'Exit', action: 'exit' }
                ].filter(Boolean);
            }
            if (menu === 'edit') {
                return [
                    { text: 'Copy', subtext: 'Ctrl+C', action: 'copy', disabled: !sel },
                    { text: 'Select All', subtext: 'Ctrl+A', action: 'select-all', disabled: !inChat },
                    sep,
                    f.reply ? { text: 'Reply', subtext: 'Ctrl+R', action: 'reply', disabled: !sel || !!sel.retracted } : null,
                    f.edit ? { text: 'Edit Message...', action: 'edit', disabled: !mine || !sel.text } : null,
                    f.unsend ? { text: 'Unsend Message', action: 'unsend', disabled: !mine } : null,
                    sep,
                    { text: 'Mark as Read', subtext: 'Ctrl+Q', action: 'mark-read', disabled: !inChat },
                    { text: 'Mark All Read', action: 'mark-all-read', disabled: !this.chats.some((c) => c.unread) }
                ].filter(Boolean);
            }
            if (menu === 'view') {
                return [
                    Object.assign({ text: 'Inbox', action: 'folder-inbox', disabled: !has, indicatorMark: 'radio' }, check(this.folder === 'inbox')),
                    Object.assign({ text: 'Unknown Senders', action: 'folder-unknown', disabled: !has, indicatorMark: 'radio' }, check(this.folder === 'unknown')),
                    sep,
                    Object.assign({ text: 'Status Bar', action: 'status-bar' }, check(this.statusBar)),
                    sep,
                    { text: 'Refresh', subtext: 'F5', action: 'refresh' }
                ];
            }
            if (menu === 'tools') {
                return [
                    f.tapbacks ? { text: 'Reactions', hasSubmenu: true, disabled: !sel || !!sel.retracted, submenu: this.reactionItems(sel) } : null,
                    f.tapbacks ? sep : null,
                    { text: 'Accounts...', action: 'accounts' },
                    { text: 'Options...', action: 'options' }
                ].filter(Boolean);
            }
            return [
                { text: 'Melaton Messenger Help', subtext: 'F1', action: 'help' },
                sep,
                { text: `About ${NAME}`, action: 'about' }
            ];
        }

        /** The reactions, the ones you gave checked (a second pick takes it back). */
        reactionItems(m) {
            const t = tm();
            const list = (t && t.REACTIONS) || [];
            const mine = new Set(((m && m.reactions) || []).filter((r) => r.fromMe).map((r) => r.type));
            return list.map((r) => ({ text: `${r.glyph}  ${r.label}`, action: `react:${r.type}`, disabled: !m || !!m.retracted || !!m.pending, showIndicator: true, checked: mine.has(r.type) }));
        }

        messageItems(m) {
            const f = this.features();
            if (!m) return [];
            const mine = m.fromMe && !m.retracted && !m.pending;
            return [
                f.reply && !m.retracted && !m.pending ? { text: 'Reply', action: 'reply' } : null,
                f.tapbacks && !m.retracted && !m.pending ? { text: 'Reactions', hasSubmenu: true, submenu: this.reactionItems(m) } : null,
                { separator: true },
                f.edit && mine && m.text ? { text: 'Edit Message...', action: 'edit' } : null,
                f.unsend && mine ? { text: 'Unsend Message', action: 'unsend' } : null,
                { separator: true },
                { text: 'Copy', action: 'copy', disabled: !snippet(m) },
                { text: 'Select All', action: 'select-all' }
            ].filter(Boolean);
        }

        select(guid) {
            this.selected = guid || null;
            this.modal.querySelectorAll('.mm-msg.is-selected').forEach((el) => el.classList.remove('is-selected'));
            if (guid) {
                const el = [...this.modal.querySelectorAll('.mm-msg[data-guid]')].find((x) => x.dataset.guid === guid);
                if (el) el.classList.add('is-selected');
            }
            this.syncCommands();
        }

        setReply(m, quiet) {
            this.replyTo = m || null;
            const bar = this.q('.mm-reply');
            bar.classList.toggle('hidden', !m);
            this.q('.mm-reply-text').textContent = m ? `Replying to ${m.fromMe ? 'yourself' : senderName(m)}: ${snippet(m)}` : '';
            if (m && !quiet) this.q('.mm-input').focus({ preventScroll: true });
        }

        // ---- sending ----

        newMessage(to, accountId) {
            if (accountId && this.account(accountId)) this.accountId = accountId;
            if (!this.account()) { this.renderAll(); return; }
            const addr = String(to || '').trim();
            // an address you already write with opens that conversation
            if (addr && !/[;,]/.test(addr)) {
                const key = addressKey(addr);
                const hit = this.chats.find((c) => !c.isGroup && ((c.participants || []).some((p) => addressKey(p.address) === key) || addressKey(c.identifier) === key));
                if (hit) { void this.openChat(hit.guid); return; }
            }
            this.compose = { to: addr };
            this.chatGuid = null;
            this.messages = [];
            this.setReply(null, true);
            this.selected = null;
            this.renderAll();
            setTimeout(() => {
                const toBox = this.q('.mm-to');
                if (toBox && !addr) toBox.focus(); else this.q('.mm-input').focus();
            }, 0);
        }

        async send() {
            const t = tm();
            const a = this.account();
            const input = this.q('.mm-input');
            const text = input.value.replace(/\s+$/, '');
            if (!t || !a || !text.trim()) return;
            if (this.compose) {
                const to = (this.q('.mm-to') ? this.q('.mm-to').value : this.compose.to).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
                const from = this.q('.mm-from');
                const acc = from ? this.account(from.value) || a : a;
                if (!to.length) { await this.message_('Type the phone number or e-mail address of at least one person in the To box.'); return; }
                this.busy(true);
                try {
                    const res = await t.send(acc.id, { addresses: to, text });
                    input.value = '';
                    this.accountId = acc.id;
                    this.compose = null;
                    this.folder = 'inbox';
                    await this.loadChats();
                    if (res && res.chatGuid) await this.openChat(res.chatGuid);
                    else this.renderAll();
                } catch (err) {
                    await this.message_(`The message could not be sent.\n${(err && err.message) || err}`);
                } finally { this.busy(false); }
                return;
            }
            if (!this.chatGuid) return;
            const guid = this.chatGuid;
            const reply = this.replyTo;
            const pending = { guid: `pending-${(this.pendingN += 1)}`, chatGuid: guid, text, fromMe: true, sender: { me: true, name: 'Me' }, date: Date.now(), reactions: [], attachments: [], replyTo: reply ? reply.guid : null, pending: true };
            this.messages.push(pending);
            input.value = '';
            this.setReply(null, true);
            if (this.features().typing) void t.typing(a.id, guid, false);
            this.renderThread(true);
            try {
                const res = await t.send(a.id, { chatGuid: guid, text, replyTo: pending.replyTo || undefined });
                const at = this.messages.indexOf(pending);
                if (this.chatGuid === guid && at >= 0) {
                    const real = res && res.message;
                    if (real && !this.messages.some((x) => x.guid === real.guid)) this.messages[at] = real;
                    else if (real) this.messages.splice(at, 1);
                    else pending.sent = true;
                    this.renderThread();
                }
            } catch (err) {
                pending.error = (err && err.message) || 'Not Delivered';
                if (this.chatGuid === guid) this.renderThread();
            }
            this.syncCommands();
        }

        async sendFiles(files) {
            const t = tm();
            const a = this.account();
            if (!t || !a || !this.chatGuid || this.compose || this.features().attachments === false) return;
            const guid = this.chatGuid;
            for (const file of files) {
                const pic = /^image\//.test(file.type || '');
                const local = pic ? URL.createObjectURL(file) : '';
                const pending = { guid: `pending-${(this.pendingN += 1)}`, chatGuid: guid, text: '', fromMe: true, sender: { me: true }, date: Date.now(), reactions: [], pending: true, progress: 0,
                    attachments: [{ guid: 'local', name: file.name || 'attachment', mime: file.type || '', size: file.size, url: local, thumbUrl: local }] };
                this.messages.push(pending);
                this.renderThread(true);
                this.upload = { name: file.name || 'attachment', pct: 0 };
                this.renderStatus();
                try {
                    const res = await t.sendFile(a.id, guid, file, {
                        replyTo: this.replyTo ? this.replyTo.guid : undefined,
                        onProgress: (p) => {
                            this.upload = { name: file.name || 'attachment', pct: Math.round(p * 100) };
                            pending.progress = p;
                            this.renderStatus();
                            const bar = this.modal.querySelector(`.mm-msg[data-guid="${pending.guid}"] .mm-progress-fill`);
                            if (bar) bar.style.width = `${Math.round(p * 100)}%`;
                        }
                    });
                    const at = this.messages.indexOf(pending);
                    if (this.chatGuid === guid && at >= 0) {
                        const real = res && res.message;
                        if (real && !this.messages.some((x) => x.guid === real.guid)) this.messages[at] = real;
                        else if (real) this.messages.splice(at, 1);
                        else { pending.sent = true; pending.progress = 1; }
                    }
                } catch (err) {
                    pending.error = (err && err.message) || 'The file could not be sent.';
                }
                if (local) setTimeout(() => URL.revokeObjectURL(local), 60000);
                this.upload = null;
                this.renderStatus();
                if (this.chatGuid === guid) this.renderThread();
            }
            this.setReply(null, true);
        }

        async react(m, type) {
            const t = tm();
            const a = this.account();
            if (!t || !a || !m || !this.features().tapbacks || m.retracted || m.pending) return;
            const remove = (m.reactions || []).some((r) => r.fromMe && r.type === type);
            try {
                await t.react(a.id, { chatGuid: this.chatGuid, messageGuid: m.guid, messageText: m.text || '', reaction: type, remove });
            } catch (err) {
                await this.message_(`The reaction could not be sent.\n${(err && err.message) || err}`);
            }
        }

        async editMessage(m) {
            const t = tm();
            const a = this.account();
            const text = await this.prompt_('Edit Message', 'Type the new text of the message:', m.text || '');
            if (text == null || text === m.text || !String(text).trim()) return;
            try {
                const res = await t.edit(a.id, { messageGuid: m.guid, text: String(text) });
                if (res && res.message) Object.assign(m, res.message);
                else { m.text = String(text); m.dateEdited = Date.now(); }
                this.renderThread();
            } catch (err) {
                await this.message_(`The message could not be edited.\n${(err && err.message) || err}`);
            }
        }

        async unsendMessage(m) {
            const t = tm();
            const a = this.account();
            const ok = await call('showConfirmationDialog', '<p>Unsend this message? It is taken back from everyone in the conversation.</p>',
                [{ text: 'Unsend', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: NAME, width: 380 });
            if (ok !== true) return;
            try {
                const res = await t.unsend(a.id, { messageGuid: m.guid });
                if (res && res.message) Object.assign(m, res.message);
                else { m.retracted = true; m.text = ''; m.attachments = []; }
                this.renderThread();
            } catch (err) {
                await this.message_(`The message could not be unsent.\n${(err && err.message) || err}`);
            }
        }

        busy(on) {
            this.isBusy = !!on;
            this.modal.classList.toggle('is-busy', !!on);
            this.syncCommands();
        }

        // ---- rendering ----

        renderAll() {
            this.renderFolders();
            this.renderList();
            this.renderConv(true);
            this.renderStatus();
        }

        renderFolders() {
            const pane = this.q('.mm-folders');
            if (!this.accounts.length) {
                pane.innerHTML = `<div class="mm-pane-note">${esc(this.error || 'No Text Messaging accounts')}</div>`;
                return;
            }
            const t = tm();
            pane.innerHTML = this.accounts.map((a) => {
                const lab = t && t.label ? t.label(a) : { title: a.name || 'Text Messaging', subline: a.identity || '' };
                const c = this.counts[a.id] || {};
                const row = (folder, text, n, icon) => {
                    const on = a.id === this.accountId && folder === this.folder && !this.compose;
                    return `<div class="mm-folder${on ? ' is-selected' : ''}${n ? ' has-unread' : ''}" data-account="${esc(a.id)}" data-folder="${folder}"><span class="mm-ficon" data-mm-ficon="${icon}"></span><span class="mm-fname">${esc(text)}</span>${n ? `<span class="mm-fcount">(${n})</span>` : ''}</div>`;
                };
                const bad = a.status && a.status !== 'connected';
                return `<div class="mm-account-group">
                    <div class="mm-account" data-account="${esc(a.id)}" title="${esc(a.url || '')}"><span class="mm-ficon" data-mm-ficon="account"></span><span class="mm-account-text"><span class="mm-account-title">${esc(lab.title)}</span><span class="mm-account-sub${bad ? ' is-error' : ''}">${esc(lab.subline)}</span></span></div>
                    ${row('inbox', 'Inbox', Number(c.unread) || 0, 'inbox')}
                    ${row('unknown', 'Unknown Senders', Number(c.unknownUnread) || 0, 'unknown')}
                </div>`;
            }).join('');
        }

        renderList() {
            const list = this.q('.mm-list');
            const a = this.account();
            if (!a) { list.innerHTML = ''; return; }
            if (!this.chats.length) {
                list.innerHTML = `<div class="mm-pane-note">${esc(this.listNote || (this.folder === 'unknown' ? 'There are no conversations from unknown senders.' : 'There are no conversations in this folder.'))}</div>`;
                return;
            }
            list.innerHTML = this.chats.map((c) => {
                const on = c.guid === this.chatGuid && !this.compose;
                const last = c.last;
                const who = last && c.isGroup && !last.fromMe ? `${(last.sender && (last.sender.name || last.sender.address)) || ''}: ` : (last && last.fromMe ? 'You: ' : '');
                // the contact's picture (the iPhone's, through BlueBubbles), else initials / the group picture
                const title = c.title || c.identifier || 'Conversation';
                const initials = c.isGroup ? '' : (String(title).replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '#');
                const pic = c.photo
                    ? `<span class="mm-row-pic"><img src="${esc(c.photo)}" alt="" loading="lazy" draggable="false"></span>`
                    : `<span class="mm-row-pic is-blank" data-group="${c.isGroup ? 1 : 0}">${esc(initials)}</span>`;
                const count = c.unread ? ` <span class="mm-row-count">(${Math.max(1, Number(c.unreadCount) || 1)})</span>` : '';
                return `<div class="mm-row${on ? ' is-selected' : ''}${c.unread ? ' is-unread' : ''}" data-guid="${esc(c.guid)}">
                    ${pic}
                    <span class="mm-row-main"><span class="mm-row-top"><span class="mm-row-title">${esc(title)}${count}</span><span class="mm-row-date">${esc(shortWhen(last && last.date))}</span></span>
                    <span class="mm-row-snip">${esc(last ? who + snippet(last) : '')}</span></span>
                </div>`;
            }).join('');
        }

        renderConv(scroll) {
            const head = this.q('.mm-conv-head');
            const a = this.account();
            const f = this.features();
            const conv = this.q('.mm-conv');
            conv.classList.toggle('is-empty', !a || (!this.chatGuid && !this.compose));
            conv.classList.toggle('is-compose', !!this.compose);
            if (!a) {
                head.innerHTML = '';
                this.q('.mm-thread').innerHTML = this.accounts.length || !tm() ? '' : `<div class="mm-welcome"><img src="${A}/messenger-48.png" alt=""><div class="mm-welcome-title">Set up Text Messaging</div><div>${esc(this.error ? this.error : 'No Text Messaging account is set up yet.')}</div><div><a href="#" data-mm-cardspace>Add a BlueBubbles server in Dreamscape CardSpace</a></div></div>`;
                this.renderTyping();
                this.syncCommands();
                return;
            }
            if (this.compose) {
                const many = this.accounts.length > 1;
                const t = tm();
                head.innerHTML = `<div class="mm-compose-head">
                    ${many ? `<label class="mm-hlabel">From:</label><select class="mm-from">${this.accounts.map((x) => { const l = t.label(x); return `<option value="${esc(x.id)}"${x.id === a.id ? ' selected' : ''}>${esc(`${l.title} (${l.subline})`)}</option>`; }).join('')}</select>` : ''}
                    <label class="mm-hlabel" for="mmTo">To:</label><input type="text" id="mmTo" class="mm-to" spellcheck="false" autocomplete="off" value="${esc(this.compose.to)}">
                </div>`;
                this.q('.mm-thread').innerHTML = '<div class="mm-thread-note">Type the phone numbers or e-mail addresses of the people the message is for, separated by semicolons.</div>';
                this.q('.mm-input').placeholder = 'Type a message';
                this.renderTyping();
                this.syncCommands();
                return;
            }
            const c = this.chat();
            if (!this.chatGuid) {
                head.innerHTML = '';
                this.q('.mm-thread').innerHTML = `<div class="mm-thread-note">${this.chats.length ? 'Select a conversation to read it.' : ''}</div>`;
                this.renderTyping();
                this.syncCommands();
                return;
            }
            const people = c ? (c.participants || []).map((p) => (p.name && p.address && p.name !== p.address ? `${p.name} <${p.address}>` : (p.name || p.address))).join('; ') : '';
            head.innerHTML = `<div class="mm-conv-title">${esc((c && (c.title || c.identifier)) || 'Conversation')}</div>
                <div class="mm-conv-people"><span class="mm-hlabel">${c && c.isGroup ? 'Members:' : 'To:'}</span> ${esc(people)}${c && c.service ? ` <span class="mm-conv-service">(${esc(c.service)})</span>` : ''}</div>
                ${c && c.known === false ? '<div class="mm-infobar">This sender is not in your contacts. Messages from unknown senders are kept in Unknown Senders.</div>' : ''}`;
            this.q('.mm-input').placeholder = f.attachments !== false ? 'Type a message, or drop a file here' : 'Type a message';
            this.renderThread(scroll);
            this.renderTyping();
            this.syncCommands();
        }

        /** The conversation's messages, as bubbles. stick: keep the view at the bottom. */
        renderThread(stick) {
            const th = this.q('.mm-thread');
            if (!this.chatGuid || this.compose) return;
            const atBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 60;
            const c = this.chat();
            const group = !!(c && c.isGroup);
            const t = tm();
            const glyphs = new Map(((t && t.REACTIONS) || []).map((r) => [r.type, r]));
            const byGuid = new Map(this.messages.map((x) => [x.guid, x]));
            const lastMine = [...this.messages].reverse().find((x) => x.fromMe && !x.groupEvent && !x.retracted);
            const out = [];
            if (this.threadNote) out.push(`<div class="mm-thread-note">${esc(this.threadNote)}</div>`);
            else if (!this.messages.length) out.push('<div class="mm-thread-note">No messages yet.</div>');
            if (this.more) out.push('<div class="mm-thread-more">Scroll up for older messages</div>');
            let prev = null;
            for (const m of this.messages) {
                if (!prev || !sameDay(prev.date, m.date) || m.date - prev.date > 3600e3) out.push(`<div class="mm-stamp">${esc(longWhen(m.date))}</div>`);
                if (m.groupEvent) {
                    out.push(`<div class="mm-event">${esc(snippet(m))}</div>`);
                    prev = m;
                    continue;
                }
                const run = prev && !prev.groupEvent && !!prev.fromMe === !!m.fromMe && addressKey(prev.sender && prev.sender.address) === addressKey(m.sender && m.sender.address) && m.date - prev.date < 600e3;
                const cls = ['mm-msg', m.fromMe ? 'is-me' : 'is-them'];
                if (!run) cls.push('is-first');
                if (m.guid === this.selected) cls.push('is-selected');
                if (m.pending) cls.push('is-pending');
                if (m.error) cls.push('is-error');
                const parts = [];
                if (group && !m.fromMe && !run) parts.push(`<div class="mm-sender">${esc(senderName(m))}</div>`);
                if (m.retracted) {
                    parts.push(`<div class="mm-unsent">${esc(snippet(m))}</div>`);
                } else {
                    const inner = [];
                    if (m.replyTo) {
                        const q = byGuid.get(m.replyTo);
                        inner.push(`<div class="mm-quote"><span class="mm-quote-who">${esc(q ? (q.fromMe ? 'You' : senderName(q)) : 'Reply')}</span> ${esc(q ? snippet(q) : 'to an earlier message')}</div>`);
                    }
                    for (const att of m.attachments || []) inner.push(this.attachmentHtml(att, m));
                    if (m.subject) inner.push(`<div class="mm-subject">${esc(m.subject)}</div>`);
                    if (m.text) inner.push(`<div class="mm-text">${esc(m.text)}</div>`);
                    const reacts = new Map();
                    for (const r of m.reactions || []) {
                        // RCS: a reaction outside the six is type 'emoji' with its own emoji
                        const key = r.type === 'emoji' && r.emoji ? `emoji:${r.emoji}` : r.type;
                        if (!reacts.has(key)) reacts.set(key, []);
                        reacts.get(key).push(r.fromMe ? 'You' : ((r.sender && (r.sender.name || r.sender.address)) || 'Someone'));
                    }
                    const tap = reacts.size ? `<span class="mm-tapbacks">${[...reacts].map(([type, who]) => { const emoji = type.startsWith('emoji:') ? type.slice(6) : ''; const g = glyphs.get(type); return `<span class="mm-tapback" title="${esc(`${g ? g.label : (emoji || type)}: ${who.join(', ')}`)}">${esc(g ? g.glyph : (emoji || type))}${who.length > 1 ? `<sub>${who.length}</sub>` : ''}</span>`; }).join('')}</span>` : '';
                    parts.push(`<div class="mm-bubble${reacts.size ? ' has-tapbacks' : ''}" title="${esc(timeOf(m.date))}">${tap}${inner.join('')}</div>`);
                }
                const meta = [];
                if (m.dateEdited && !m.retracted) meta.push('Edited');
                if (m.error) meta.push(`<span class="mm-meta-error">Not Delivered</span>`);
                else if (m === lastMine) {
                    if (m.pending && !m.sent) meta.push(m.progress != null && m.progress < 1 ? 'Sending...' : 'Sending...');
                    else if (m.dateRead) meta.push(`Read ${esc(timeOf(m.dateRead))}`);
                    else if (m.dateDelivered) meta.push('Delivered');
                    else if (m.sent) meta.push('Sent');
                }
                if (meta.length) parts.push(`<div class="mm-meta"${m.error ? ` title="${esc(m.error)}"` : ''}>${meta.join(' &middot; ')}</div>`);
                out.push(`<div class="${cls.join(' ')}" data-guid="${esc(m.guid)}">${parts.join('')}</div>`);
                prev = m;
            }
            th.innerHTML = out.join('');
            if (stick === true || atBottom) th.scrollTop = th.scrollHeight;
            // pictures load after: keep the bottom in view while they do
            th.querySelectorAll('img').forEach((img) => {
                if (img.complete) return;
                img.addEventListener('load', () => { if (th.scrollHeight - th.scrollTop - th.clientHeight < 400) th.scrollTop = th.scrollHeight; }, { once: true });
            });
        }

        attachmentHtml(att, m) {
            const mime = att.mime || '';
            const url = att.url || '';
            const name = att.name || 'Attachment';
            if (/^image\//.test(mime) && (att.thumbUrl || url)) {
                const w = Number(att.width) || 0;
                const h = Number(att.height) || 0;
                // the picture at most 240 x 240, its own shape
                const k = w && h ? Math.min(1, 240 / Math.max(w, h)) : 1;
                const size = w && h ? ` width="${Math.round(w * k)}" height="${Math.round(h * k)}"` : '';
                const img = `<img class="mm-pic${att.sticker ? ' is-sticker' : ''}" src="${esc(att.thumbUrl || url)}" alt="${esc(name)}"${size} loading="lazy" draggable="false">`;
                const prog = m.pending && !m.sent ? `<span class="mm-progress"><span class="mm-progress-fill" style="width:${Math.round((m.progress || 0) * 100)}%"></span></span>` : '';
                return url && !m.pending ? `<a class="mm-pic-link" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(name)}">${img}</a>` : `<span class="mm-pic-link">${img}${prog}</span>`;
            }
            const label = `${name}${att.size ? ` (${bytes(att.size)})` : ''}`;
            const prog = m.pending && !m.sent ? `<span class="mm-progress"><span class="mm-progress-fill" style="width:${Math.round((m.progress || 0) * 100)}%"></span></span>` : '';
            return url && !m.pending
                ? `<a class="mm-file-link" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(name)}"><span class="mm-file-icon"></span><span>${esc(label)}</span></a>`
                : `<span class="mm-file-link"><span class="mm-file-icon"></span><span>${esc(label)}</span>${prog}</span>`;
        }

        renderTyping() {
            const line = this.q('.mm-typing');
            const c = this.chat();
            const on = !!(this.chatGuid && !this.compose && this.typingWho.get(this.chatGuid));
            const who = c && !c.isGroup ? (c.title || c.identifier) : 'Someone';
            line.textContent = on ? `${who} is typing a message...` : '';
            line.classList.toggle('is-on', on);
        }

        renderStatus() {
            const a = this.account();
            const text = this.q('.mm-status-text');
            const prog = this.q('.mm-status-progress');
            if (this.upload) {
                text.textContent = `Sending ${this.upload.name}... ${this.upload.pct}%`;
                prog.classList.remove('hidden');
                this.q('.mm-status-progress .mm-progress-fill').style.width = `${this.upload.pct}%`;
            } else {
                prog.classList.add('hidden');
                const unread = this.chats.filter((c) => c.unread).length;
                text.textContent = a ? `${this.chats.length} conversation${this.chats.length === 1 ? '' : 's'}, ${unread} unread` : '';
            }
            const online = this.q('.mm-status-online-text');
            const icon = this.q('.mm-status-online-icon');
            const ok = a && a.status === 'connected';
            online.textContent = !a ? 'No account' : ok ? 'Connected' : ({ disabled: 'Turned off', unpaired: 'Not paired', pairing: 'Pairing...' }[a.status] || 'Not connected');
            online.parentElement.title = a && !ok && a.error ? a.error : '';
            icon.dataset.state = ok ? 'on' : 'off';
            const c = this.chat();
            this.q('.mm-caption').textContent = this.compose ? `New Message - ${NAME}` : (c ? `${c.title || c.identifier} - ${NAME}` : NAME);
        }

        /** Commands the account cannot do are hidden; the rest follow the selection. */
        syncCommands() {
            const f = this.features();
            const has = !!this.account();
            const inChat = !!(this.chatGuid && !this.compose);
            const sel = this.message(this.selected);
            const show = (s, on) => this.modal.querySelectorAll(s).forEach((el) => el.classList.toggle('hidden', !on));
            const enable = (s, on) => this.modal.querySelectorAll(s).forEach((el) => { el.disabled = !on; });
            show('[data-mm="new"]', f.newChat !== false);
            show('[data-mm="attach"]', f.attachments !== false);
            show('[data-mm-react]', !!f.tapbacks);
            show('[data-mm="reply"]', !!f.reply);
            enable('[data-mm="new"]', has && !this.isBusy);
            enable('[data-mm="attach"]', inChat);
            enable('[data-mm-react]', !!(sel && !sel.retracted && !sel.pending));
            enable('[data-mm="reply"]', !!(sel && !sel.retracted && !sel.pending));
            enable('.mm-send', has && (inChat || !!this.compose) && !this.isBusy && !!this.q('.mm-input').value.trim());
            this.q('.mm-input').disabled = !has || (!inChat && !this.compose);
            this.renderStatus();
        }

        // ---- dialogs ----

        openAccounts() {
            if (root.cplAuthentication && typeof root.cplAuthentication.open === 'function') root.cplAuthentication.open('text-messaging');
        }

        message_(text) {
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: NAME, width: 400 });
        }

        async prompt_(title, label, value) {
            const box = doc.createElement('div');
            const id = `mmPrompt${Date.now()}`;
            const p = call('showConfirmationDialog', `<p><label for="${id}">${esc(label)}</label></p><textarea id="${id}" class="mm-prompt-input" rows="3" style="width:100%;box-sizing:border-box">${esc(value)}</textarea>`,
                [{ text: 'OK', value: 'ok', className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title, width: 400 });
            let text = value;
            setTimeout(() => {
                const el = doc.getElementById(id);
                if (el) { el.addEventListener('input', () => { text = el.value; }); el.focus(); el.select(); }
            }, 0);
            void box;
            const v = await p;
            return v === 'ok' ? text : null;
        }

        /** Tools > Options: the server's "Notify me about unknown senders" and this computer's sound. */
        async options() {
            const t = tm();
            let notify = !!this.settings.notifyUnknown;
            try { const d = t && await t.accounts(); if (d && d.settings) notify = !!d.settings.notifyUnknown; } catch (_) { /* the last known value */ }
            let sound = soundOn();
            const p = call('showConfirmationDialog', `<div class="mm-options">
                <fieldset class="mm-options-group"><legend>Notifications</legend>
                    <div class="desktop-settings-check"><input type="checkbox" id="mmOptNotifyUnknown"${notify ? ' checked' : ''}><label for="mmOptNotifyUnknown">Notify me about unknown senders</label></div>
                    <div class="desktop-settings-check"><input type="checkbox" id="mmOptSound"${sound ? ' checked' : ''}><label for="mmOptSound">Play sound when new messages arrive</label></div>
                </fieldset>
                <p class="mm-options-note">Messages from people who are not in your contacts go to Unknown Senders. Turning on notifications for them shows a notification for each of their messages too.</p>
            </div>`, [{ text: 'OK', value: 'ok', className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: 'Options', width: 420 });
            let n2 = notify;
            setTimeout(() => {
                const a = doc.getElementById('mmOptNotifyUnknown');
                const b = doc.getElementById('mmOptSound');
                if (a) a.addEventListener('change', () => { n2 = a.checked; });
                if (b) b.addEventListener('change', () => { sound = b.checked; });
            }, 0);
            const v = await p;
            if (v !== 'ok') return;
            setSound(sound);
            if (n2 !== notify && t) {
                try { this.settings = (await t.saveSettings({ notifyUnknown: n2 })) || { notifyUnknown: n2 }; } catch (err) { await this.message_(`The setting could not be saved.\n${(err && err.message) || err}`); }
            }
        }

        async help() {
            await this.message_('Melaton Messenger sends and receives text messages through your Text Messaging accounts.\n\nSelect a conversation to read it, type in the box at the bottom and press Enter to send. Shift+Enter starts a new line. Drop a file on the conversation, paste a picture or click Attach to send a file. Right-click a message to reply, react, edit or unsend it.\n\nAccounts are set up in Control Panel > Dreamscape CardSpace.');
        }

        async about() {
            await call('showConfirmationDialog', `<div class="mm-about"><img src="${A}/messenger-48.png" alt="" width="48" height="48"><div><p><b>${NAME}</b><br>Version ${VERSION}</p><p>Copyright &copy; 2007 Xyridian Corporation. All rights reserved.</p><p>Text Messaging accounts are provided by their own services.</p></div></div>`,
                [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: `About ${NAME}`, width: 400 });
        }

        destroy() {
            const t = tm();
            const a = this.account();
            if (t && a && this.chatGuid && this.features().typing) void t.typing(a.id, this.chatGuid, false);
            this.typingTimers.forEach((x) => clearTimeout(x));
            clearTimeout(this.chatsTimer);
            const m = this.modal;
            // a new window may already be opening under the same id: its 'closed' listener must not hear this one
            m.id = `${m.id}-closing`;
            try { call('closeModal', m); } catch (_) { /* gone */ }
            setTimeout(() => m.remove(), 300);
        }
    }

    let running = null;

    function start(app) {
        if (running) {
            running.applyArgs(app.args);
            call('bringModalToFront', running.modal);
            app.exit();
            return;
        }
        const r = new Messenger(app);
        running = r;
        app.onExit(() => { if (running === r) running = null; r.destroy(); });
    }

    root.melatonMessenger = { start, _running: () => running, soundOn, setSound, snippet };
    if (typeof melatonApps !== 'undefined') melatonApps.define('messenger', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
