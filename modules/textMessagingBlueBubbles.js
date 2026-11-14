/**
 * Text Messaging: the BlueBubbles provider (Yozora #779, modules/textMessaging.js).
 *
 * A BlueBubbles server on a Mac relays iMessage (and the iPhone's SMS through Text Message
 * Forwarding). This provider reads it live: nothing is copied into Dreamscape, the Mac's
 * chat.db is the store. REST under {url}/api/v1/... with ?password=, events over socket.io
 * (the same password in the handshake query).
 *
 *   REST  ping, server/info, chat/query, chat/:guid/message, message/text, message/attachment,
 *         message/react, message/:guid/edit, message/:guid/unsend, chat/:guid/read,
 *         chat/:guid/typing, chat/new, attachment/:guid/download, contact, icloud/account
 *   Events new-message, updated-message, typing-indicator, chat-read-status-changed,
 *         group-name-change, participant-added/removed/left, message-send-error
 *
 * Messages leave here in the provider-neutral shape textMessaging.js documents (normalize*).
 * Tapbacks arrive as messages of their own (associatedMessageGuid + associatedMessageType);
 * a page of messages folds them onto their targets, a live one is an event of its own.
 */
'use strict';

const { randomUUID } = require('crypto');

const REQUEST_TIMEOUT_MS = 20000;
const SEND_TIMEOUT_MS = 120000;
const CONTACTS_TTL_MS = 10 * 60 * 1000;
const RECONNECT_MAX_MS = 60000;

// associatedMessageType (text or the older numeric codes) -> our reaction name
const REACTION_CODES = {
    2000: 'love', 2001: 'like', 2002: 'dislike', 2003: 'laugh', 2004: 'emphasize', 2005: 'question',
    3000: '-love', 3001: '-like', 3002: '-dislike', 3003: '-laugh', 3004: '-emphasize', 3005: '-question'
};
const REACTIONS = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'];

/**
 * The account's client settings (Dreamscape CardSpace, the BlueBubbles card; config.json
 * textMessaging.accounts[].settings). Missing keys take these.
 */
const DEFAULT_SETTINGS = {
    usePrivateApi: true,        // tapbacks, edit / unsend, replies, typing, read receipts (when the server has it)
    sendReadReceipts: true,     // opening a conversation marks it read on the Mac (the sender sees Read)
    sendTyping: true,           // the other side sees you typing
    mergeConversations: true,   // one person's iMessage and SMS chats as one conversation (as the iPhone shows them)
    hideEmptyChats: true,       // chats with no messages stay out of the lists
    notify: true                // new messages notify (unknown senders still follow notifyUnknown)
};
const MAX_CHAT_SCAN = 500;
// the copy's placeholder for messages the Mac keeps in no chat (never listed)
const ORPHAN_CHAT = '__no_chat__';

function reactionOf(type) {
    if (type == null || type === '') return null;
    if (typeof type === 'number' || /^\d+$/.test(String(type))) return REACTION_CODES[Number(type)] || null;
    const t = String(type).toLowerCase();
    const bare = t.replace(/^-/, '');
    return REACTIONS.includes(bare) ? t : null;
}

const URL_BALLOON = 'com.apple.messages.URLBalloonProvider';

/**
 * The iPhone's own preview of a link (a URL balloon's payloadData: an NSKeyedArchiver plist with
 * LPLinkMetadata) -> { url, title, description, site, imageIndex, iconIndex } or null. The picture and
 * icon are the message's own (hidden) pluginPayloadAttachments, by position (richLinkImageAttachmentSubstituteIndex).
 */
function richLinkOf(payload) {
    const arch = Array.isArray(payload) ? payload[0] : payload;
    const objs = arch && Array.isArray(arch.$objects) ? arch.$objects : null;
    if (!objs) return null;
    const get = (ref) => (ref && typeof ref === 'object' && 'UID' in ref ? (ref.UID ? objs[ref.UID] : null) : ref);
    const str = (ref, depth = 0) => {
        const v = get(ref);
        if (typeof v === 'string') return v === '$null' ? '' : v;
        if (!v || typeof v !== 'object' || depth > 3) return '';
        if ('NS.relative' in v) return str(v['NS.relative'], depth + 1);
        if ('NS.string' in v) return str(v['NS.string'], depth + 1);
        return '';
    };
    const holder = objs.find((o) => o && typeof o === 'object' && 'richLinkMetadata' in o);
    const md = holder ? get(holder.richLinkMetadata) : objs.find((o) => o && typeof o === 'object' && 'title' in o && ('URL' in o || 'originalURL' in o));
    if (!md || typeof md !== 'object') return null;
    const index = (ref) => { const v = get(ref); const n = v && typeof v === 'object' ? v.richLinkImageAttachmentSubstituteIndex : null; return Number.isInteger(n) ? n : null; };
    const out = {
        url: str(md.URL) || str(md.originalURL),
        title: str(md.title).slice(0, 300),
        description: str(md.summary).slice(0, 500),
        site: str(md.siteName).slice(0, 120),
        imageIndex: index(md.image),
        iconIndex: index(md.icon)
    };
    return out.url || out.title ? out : null;
}

/** "p:0/GUID" or "bp:GUID" -> GUID (tapback targets name the message part). */
function targetGuid(value) {
    const s = String(value || '');
    const slash = s.indexOf('/');
    if (slash >= 0) return s.slice(slash + 1);
    return s.replace(/^bp:/, '');
}

function normalizeUrl(value) {
    let s = String(value || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    return s.replace(/\/+$/, '');
}

/** Phone numbers compare by their last 10 digits, e-mail addresses in lower case. */
function handleKey(address) {
    const s = String(address || '').trim();
    if (!s) return '';
    if (s.includes('@')) return s.toLowerCase();
    const digits = s.replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}

class BlueBubblesProvider {
    /**
     * @param {object} account  { id, url, password }
     * @param {object} hooks    { emit(event, payload), log(msg) }
     */
    constructor(account, hooks) {
        this.id = account.id;
        this.url = normalizeUrl(account.url);
        this.password = String(account.password || '');
        this.hooks = hooks || {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, account.settings || {});
        this.primaryOf = new Map(); // any chat guid -> the guid of the conversation it is merged into
        this.membersOf = new Map(); // conversation guid -> its chat guids, newest first
        this.status = 'connecting';
        this.error = '';
        this.info = null;
        this.socket = null;
        this.contacts = null;      // handleKey -> name
        this.contactsAt = 0;
        this.contactsPromise = null;
        this.stopped = false;
        this.retryMs = 2000;
        this.retryTimer = null;
    }

    get kind() { return 'bluebubbles'; }

    /** Apple ID or phone number for the account's subline. */
    identity() {
        const i = this.info || {};
        return String(i.detected_icloud || i.detected_imessage || i.icloud_account || '').trim();
    }

    features() {
        const priv = !!(this.info && this.info.private_api) && this.settings.usePrivateApi !== false;
        return { privateApi: priv, attachments: true, tapbacks: priv, edit: priv, unsend: priv, reply: priv, typing: priv && this.settings.sendTyping !== false, readReceipts: priv && this.settings.sendReadReceipts !== false, newChat: true, effects: priv, deleteChat: priv };
    }

    /** The conversation a chat belongs to (merged iMessage + SMS), and its chats. */
    resolve(guid) { return this.primaryOf.get(guid) || guid; }

    members(guid) { const p = this.resolve(guid); return this.membersOf.get(p) || [p];
    }

    // ---- REST ----

    endpoint(pathname, query) {
        const u = new URL(`${this.url}/api/v1/${pathname.replace(/^\//, '')}`);
        u.searchParams.set('password', this.password);
        if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') u.searchParams.set(k, String(v));
        return u.toString();
    }

    async call(method, pathname, { query, body, timeoutMs, raw } = {}) {
        if (!this.url) throw Object.assign(new Error('The BlueBubbles server has no address.'), { code: 'NOT_CONFIGURED' });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs || REQUEST_TIMEOUT_MS);
        let res;
        try {
            const init = { method, signal: ctrl.signal, headers: {} };
            if (body instanceof FormData) init.body = body;
            else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
            res = await fetch(this.endpoint(pathname, query), init);
        } catch (error) {
            clearTimeout(timer);
            const msg = error.name === 'AbortError' ? 'The BlueBubbles server did not answer in time.' : `Cannot reach the BlueBubbles server (${error.cause && error.cause.code || error.message}).`;
            throw Object.assign(new Error(msg), { code: 'UNREACHABLE' });
        }
        clearTimeout(timer);
        if (raw) {
            if (!res.ok) throw Object.assign(new Error(`BlueBubbles answered ${res.status}.`), { code: 'HTTP_' + res.status, status: res.status });
            return res;
        }
        let json = null;
        try { json = await res.json(); } catch (_) { json = null; }
        if (res.status === 401 || res.status === 403) throw Object.assign(new Error('The BlueBubbles password is wrong.'), { code: 'BAD_PASSWORD' });
        if (!res.ok || (json && json.status && json.status >= 400)) {
            const why = json && (json.error && (json.error.message || json.error.type) || json.message) || `HTTP ${res.status}`;
            throw Object.assign(new Error(`BlueBubbles: ${why}`), { code: 'PROVIDER_ERROR', status: res.status });
        }
        return json ? (json.data !== undefined ? json.data : json) : null;
    }

    async test() {
        await this.call('GET', 'ping');
        const info = await this.call('GET', 'server/info');
        return info || {};
    }

    // ---- lifecycle ----

    async start() {
        this.stopped = false;
        try {
            this.info = await this.test();
            this.setStatus('connected', '');
            this.connectSocket();
            this.loadContacts().catch(() => {});
            this.startSync();
            // what the socket missed (edits, read dates) comes in with a catch-up every 30 minutes
            clearInterval(this.syncTimer);
            this.syncTimer = setInterval(() => this.startSync(), 30 * 60 * 1000);
            if (this.syncTimer.unref) this.syncTimer.unref();
        } catch (error) {
            this.setStatus('error', error.message);
            this.scheduleRetry();
        }
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.retryTimer);
        clearInterval(this.syncTimer);
        if (this.syncChild) { try { this.syncChild.kill(); } catch (_) { /* gone */ } this.syncChild = null; }
        if (this.socket) { try { this.socket.removeAllListeners(); this.socket.disconnect(); } catch (_) { /* gone */ } }
        this.socket = null;
        this.setStatus('disabled', '');
    }

    scheduleRetry() {
        if (this.stopped) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.start(), this.retryMs);
        if (this.retryTimer.unref) this.retryTimer.unref();
        this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
    }

    setStatus(status, error) {
        const changed = status !== this.status || error !== this.error;
        this.status = status;
        this.error = error || '';
        if (status === 'connected') this.retryMs = 2000;
        if (changed && this.hooks.emit) this.hooks.emit('account', { accountId: this.id });
    }

    connectSocket() {
        if (this.socket || this.stopped) return;
        let io;
        try { io = require('socket.io-client'); } catch (error) {
            this.log(`socket.io-client missing: ${error.message}`);
            return;
        }
        const socket = io(this.url, {
            query: { password: this.password },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionDelayMax: RECONNECT_MAX_MS
        });
        this.socket = socket;
        socket.on('connect', () => { this.setStatus('connected', ''); this.startSync(); this.hooks.emit && this.hooks.emit('resync', { accountId: this.id }); });
        socket.on('disconnect', (reason) => { if (!this.stopped) this.setStatus('connecting', `Disconnected (${reason})`); });
        socket.on('connect_error', (error) => { if (!this.stopped) this.setStatus('error', `Cannot reach the BlueBubbles server (${error.message}).`); });
        socket.on('new-message', (m) => this.onMessage(m, false));
        socket.on('updated-message', (m) => this.onMessage(m, true));
        socket.on('message-send-error', (m) => this.onMessage(m, true));
        socket.on('typing-indicator', (d) => {
            if (!d || !d.guid) return;
            this.hooks.emit && this.hooks.emit('typing', { accountId: this.id, chatGuid: this.resolve(d.guid), typing: d.display === true });
        });
        socket.on('chat-read-status-changed', (d) => {
            if (!d || !d.chatGuid) return;
            this.hooks.emit && this.hooks.emit('read', { accountId: this.id, chatGuid: this.resolve(d.chatGuid), read: d.read !== false });
        });
        for (const ev of ['group-name-change', 'participant-added', 'participant-removed', 'participant-left', 'chat-read-status-changed']) {
            if (ev === 'chat-read-status-changed') continue;
            socket.on(ev, (m) => {
                const chatGuid = m && Array.isArray(m.chats) && m.chats[0] ? m.chats[0].guid : (m && m.chatGuid) || '';
                this.hooks.emit && this.hooks.emit('chat', { accountId: this.id, chatGuid: this.resolve(chatGuid) });
            });
        }
    }

    log(msg) {
        if (this.hooks.log) this.hooks.log(msg);
        else console.warn(`[textMessaging:bluebubbles] ${msg}`);
    }

    onMessage(raw, updated) {
        if (!raw || !raw.guid) return;
        const chatGuid = this.resolve(Array.isArray(raw.chats) && raw.chats[0] ? raw.chats[0].guid : '');
        const reaction = reactionOf(raw.associatedMessageType);
        if (reaction && raw.associatedMessageGuid) {
            this.storeLive(raw);
            this.hooks.emit && this.hooks.emit('reaction', {
                accountId: this.id, chatGuid,
                targetGuid: targetGuid(raw.associatedMessageGuid),
                reaction: { type: reaction.replace(/^-/, ''), removed: reaction.startsWith('-'), fromMe: !!raw.isFromMe, sender: this.sender(raw), guid: raw.guid, date: raw.dateCreated || Date.now() }
            });
            return;
        }
        this.storeLive(raw);
        const message = this.normalizeMessage(raw, chatGuid);
        // the raw chat only when it is the conversation itself (a merged one is read again by guid)
        const rawChat = Array.isArray(raw.chats) && raw.chats[0] && raw.chats[0].guid === chatGuid ? raw.chats[0] : null;
        this.hooks.emit && this.hooks.emit(updated ? 'updated' : 'message', { accountId: this.id, chatGuid, message, chat: rawChat });
        if (raw.balloonBundleId === URL_BALLOON && !raw._link && raw.payloadData == null) this.fetchLinkPreview(raw.guid, chatGuid);
    }

    /**
     * A link pushed live comes without the iPhone's preview (the push carries no payloadData, and the
     * phone may still be making it): read the message again, a few seconds on, and show it (updated).
     */
    fetchLinkPreview(guid, chatGuid) {
        if (!this.linkTries) this.linkTries = new Map();
        const n = this.linkTries.get(guid) || 0;
        if (n >= 3) return;
        this.linkTries.set(guid, n + 1);
        if (this.linkTries.size > 200) this.linkTries.delete(this.linkTries.keys().next().value);
        const t = setTimeout(async () => {
            let raw = null;
            try { raw = await this.call('GET', `message/${encodeURIComponent(guid)}`, { query: { with: 'chats,handle,attachment,attributedBody,messageSummaryInfo,payloadData' } }); } catch (_) { return; }
            if (!raw || !raw.guid || !raw.payloadData) return;
            this.storeLive(raw);
            if (!raw._link) return;
            this.hooks.emit && this.hooks.emit('updated', { accountId: this.id, chatGuid, message: this.normalizeMessage(raw, chatGuid) });
        }, 4000 * (n + 1));
        if (t.unref) t.unref();
    }

    // ---- the store (modules/textMessagingStore.js): every chat and message, synced from the Mac ----

    /** Every message is here (the first sync finished): reads come from the store. */
    storeReady() {
        return !!(this.store && this.store.getState(this.id, 'complete') === '1');
    }

    storeRows(rows) {
        if (!this.store) return;
        const out = [];
        // a link's preview is kept as _link (the plist itself is large); a row that came without it
        // (a live push, an older query) keeps the one stored before
        const keepLink = [];
        for (const r of rows || []) {
            if (!r || r.balloonBundleId !== URL_BALLOON) continue;
            if (r.payloadData) { r._link = richLinkOf(r.payloadData); r.payloadData = null; } else if (r._link === undefined && r.guid) keepLink.push(r);
        }
        if (keepLink.length) {
            try {
                const before = this.store.getMessages(this.id, keepLink.map((r) => r.guid));
                for (const r of keepLink) { try { const old = JSON.parse(before.get(r.guid) || 'null'); if (old && old._link) r._link = old._link; } catch (_) { /* none */ } }
            } catch (_) { /* written without it */ }
        }
        for (const r of rows || []) {
            const chatGuid = Array.isArray(r.chats) && r.chats[0] ? r.chats[0].guid : (r.chatGuid || '');
            if (!r || !r.guid || !chatGuid) continue;
            out.push({ guid: r.guid, chatGuid, date: Number(r.dateCreated) || 0, text: r.text ? String(r.text).replace(/\uFFFC/g, '').trim() : '', raw: r });
        }
        try { if (out.length) this.store.putMessages(this.id, out); } catch (error) { this.log(`store write failed: ${error.message}`); }
        return out;
    }

    /** A live message: into the store, and its chat's last message moves to it. */
    storeLive(raw) {
        if (!this.store || !raw) return;
        const rows = this.storeRows([raw]);
        const row = rows && rows[0];
        if (!row) return;
        try {
            const chat = this.store.getChat(this.id, row.chatGuid);
            const reaction = reactionOf(raw.associatedMessageType);
            if (chat && !reaction && (Number(raw.dateCreated) || 0) >= ((chat.raw.lastMessage && Number(chat.raw.lastMessage.dateCreated)) || 0)) {
                chat.raw.lastMessage = raw;
                this.store.putChats(this.id, [{ guid: row.chatGuid, raw: chat.raw, lastDate: row.date }]);
            } else if (!chat && Array.isArray(raw.chats) && raw.chats[0]) {
                const c = Object.assign({}, raw.chats[0], { lastMessage: reaction ? null : raw });
                this.store.putChats(this.id, [{ guid: row.chatGuid, raw: c, lastDate: row.date }]);
            }
        } catch (error) { this.log(`store chat update failed: ${error.message}`); }
    }

    /**
     * Pull everything from the Mac into the store: every chat, then every message in date order
     * (message/query, oldest first, 1000 at a time; the cursor is kept, so a restart goes on where it
     * stopped). Afterwards only what is new, plus the last two days again for read / edit changes.
     */
    startSync() {
        if (!this.store || this.syncing || this.stopped) return;
        this.syncing = true;
        // the work runs in its own low-priority process (textMessagingSyncWorker.js): the server's
        // event loop never pages, parses or indexes a whole history (Yukimi, Nov 13)
        let child;
        try {
            child = require('child_process').fork(require('path').join(__dirname, 'textMessagingSyncWorker.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        } catch (error) {
            this.log(`sync worker failed to start: ${error.message}`);
            this.syncing = false;
            return;
        }
        this.syncChild = child;
        child.on('message', (m) => {
            if (!m) return;
            if (m.progress !== undefined) {
                this.syncProgress = m.progress;
                // msgbridge's counters follow this push (the worker reports every 2 s), no status polling
                if (m.progress && this.hooks.emit) this.hooks.emit('syncprogress', { accountId: this.id, running: true, done: m.progress.done != null ? m.progress.done : null, total: m.progress.total != null ? m.progress.total : null });
            }
            if (m.log) this.log(m.log);
            if (m.error) this.log(`sync failed: ${m.error}`);
        });
        child.on('exit', () => {
            if (this.syncChild === child) this.syncChild = null;
            this.syncing = false;
            this.syncProgress = null;
            this.hooks.emit && this.hooks.emit('account', { accountId: this.id });
        });
        child.send({ cmd: 'sync', account: { id: this.id, url: this.url, password: this.password, settings: this.settings }, cacheDir: this.storeDir || null });
    }

    async syncAll() {
        // chats (with their newest message and participants); the Mac's list is the truth
        const seen = new Set();
        let listed = false;
        for (let offset = 0; offset < 100000; offset += 1000) {
            const rows = await this.call('POST', 'chat/query', { body: { limit: 1000, offset, with: ['lastMessage', 'participants'], sort: 'lastmessage' }, timeoutMs: 120000 });
            const list = Array.isArray(rows) ? rows : [];
            list.forEach((c) => seen.add(c.guid));
            this.store.putChats(this.id, list.map((c) => ({ guid: c.guid, raw: c, lastDate: (c.lastMessage && Number(c.lastMessage.dateCreated)) || 0 })));
            if (list.length < 1000) { listed = true; break; }
        }
        // chats deleted on the Mac leave the store too (only after a complete listing)
        if (listed && seen.size) {
            const gone = this.store.chatGuids(this.id).filter((g) => !seen.has(g));
            for (const g of gone) this.store.deleteChat(this.id, g);
            if (gone.length) this.noteDrift({ chatsRemoved: gone.length });
        }
        const complete = this.store.getState(this.id, 'complete') === '1';
        let after = Number(this.store.getState(this.id, 'cursor') || 0);
        if (complete) after = Math.max(0, after - 2 * 86400000);
        this.syncProgress = { phase: 'messages', done: 0 };
        // the Mac drops heavy pages (attachments, rich links): halve on a failure, grow back slowly
        // gentle: smaller pages and a pause after each, so a first sync never starves the live server
        // (Nov 13: full-speed pages kept the server at 100% CPU and clients could not boot)
        let size = this.syncFast ? 500 : 200;
        let fails = 0;
        let seenGuids = new Set();
        for (;;) {
            if (this.stopped) return;
            let rows;
            try {
                rows = await this.call('POST', 'message/query', { body: {
                    limit: size, offset: 0, sort: 'ASC', after: after || undefined, with: ['chats', 'handle', 'attachment', 'messageSummaryInfo', 'payloadData']
                }, timeoutMs: 180000 });
                fails = 0;
            } catch (error) {
                fails += 1;
                if (fails > 8) throw error;
                size = Math.max(10, Math.floor(size / 2));
                await new Promise((r) => setTimeout(r, 1000 * fails));
                continue;
            }
            const list = Array.isArray(rows) ? rows : [];
            this.storeRows(list);
            this.syncProgress.done += list.length;
            const last = list.reduce((m, r) => Math.max(m, Number(r.dateCreated) || 0), after);
            if (last > after) this.store.setState(this.id, 'cursor', last);
            // "after" is exclusive: messages sharing the last one's millisecond would be skipped, so
            // the next page starts a millisecond earlier (the store takes the repeats in place); a
            // page that brought nothing new steps past that millisecond
            const fresh = list.some((r) => !seenGuids.has(r.guid));
            seenGuids = new Set(list.map((r) => r.guid));
            after = !fresh ? (last >= after ? last + 1 : after + 1) : Math.max(after, last - 1);
            if (list.length < size) break;
            size = Math.min(this.syncFast ? 500 : 200, size * 2);
            await new Promise((r) => setTimeout(r, this.syncFast ? 50 : 750));
        }
        // messages in no chat (group membership notices whose chat link the Mac lost): the query above
        // leaves them out (it joins the chats), message/count does not; kept under a placeholder that no
        // list shows, so the copy's count matches the Mac's and the reconcile sees real drift only
        const orphans = [];
        for (let offset = 0; offset < 100000; offset += 1000) {
            const rows = await this.call('POST', 'message/query', { body: { limit: 1000, offset, sort: 'ASC',
                where: [{ statement: 'message.ROWID NOT IN (SELECT message_id FROM chat_message_join)', args: {} }] }, timeoutMs: 120000 });
            const list = Array.isArray(rows) ? rows : [];
            orphans.push(...list);
            if (list.length < 1000) break;
        }
        this.storeRows(orphans.map((r) => Object.assign({}, r, { chats: [{ guid: ORPHAN_CHAT }] })));
        const keep = new Set(orphans.map((r) => r.guid));
        const gone = this.store.guidsBetween(this.id, [ORPHAN_CHAT], 0, Date.now() + 86400000).filter((g) => !keep.has(g));
        if (gone.length) this.store.deleteMessages(this.id, gone);
        this.store.setState(this.id, 'complete', '1');
        this.syncProgress = null;
    }

    /**
     * Check one conversation against the Mac (the Mac wins): its newest page is read again; rows that
     * differ are replaced, rows the Mac no longer has in that span are removed. -> true when it changed.
     */
    async verifyChat(chatGuid, limit = 60) {
        if (!this.store) return false;
        const guid = this.resolve(chatGuid);
        const members = this.members(guid);
        const pages = await Promise.all(members.map((g) => this.call('GET', `chat/${encodeURIComponent(g)}/message`, {
            query: { limit, sort: 'DESC', with: 'attachment,handle,attributedBody,messageSummaryInfo,payloadData' }
        }).then((rows) => (Array.isArray(rows) ? rows.map((r) => (r.chats ? r : Object.assign({}, r, { chats: [{ guid: g }] }))) : []), () => null)));
        if (pages.some((p) => p == null)) return false; // no answer: nothing is judged
        const fresh = [].concat(...pages);
        if (!fresh.length) return false;
        const before = this.store.getMessages(this.id, fresh.map((r) => r.guid));
        // what can change at the source (the two endpoints shape the rest differently)
        const sig = (r) => JSON.stringify([r.text || '', r.dateRead || 0, r.dateDelivered || 0, r.dateEdited || 0, r.dateRetracted || 0, r.error || 0,
            r.associatedMessageGuid || '', (r.attachments || []).map((x) => x.guid).join(',')]);
        let changed = false;
        for (const r of fresh) {
            const old = before.get(r.guid);
            let oldRow = null;
            try { oldRow = old ? JSON.parse(old) : null; } catch (_) { oldRow = null; }
            if (!oldRow || sig(oldRow) !== sig(r)) { changed = true; break; }
        }
        this.storeRows(fresh);
        // the span the Mac answered for, chat by chat: everything stored in that chat's span that the Mac
        // did not send is gone there. One span across a merged conversation's chats deleted real messages:
        // a chat whose newest page reached back less far lost everything between (Nov 14: 4,376 rows)
        const have = new Set(fresh.map((r) => r.guid));
        const stale = [];
        members.forEach((g, i) => {
            const page = pages[i] || [];
            if (!page.length) return;
            const from = Math.min(...page.map((r) => Number(r.dateCreated) || Infinity));
            if (!Number.isFinite(from)) return;
            stale.push(...this.store.guidsBetween(this.id, [g], from, Date.now() + 60000).filter((x) => !have.has(x)));
        });
        if (stale.length) { this.store.deleteMessages(this.id, stale); changed = true; }
        if (changed) this.noteDrift({ chatsRepaired: 1, lastChat: guid });
        return changed;
    }

    /**
     * Compare the whole copy with the Mac (counts of messages and chats). A difference runs the sync
     * again from a week back; what still differs afterwards is recorded as drift for the status page.
     */
    async reconcile() {
        if (!this.store || this.syncing || !this.storeReady()) return null;
        const count = async () => {
            const [m, c] = await Promise.all([this.call('GET', 'message/count'), this.call('GET', 'chat/count').catch(() => null)]);
            return { messages: Number(m && m.total) || 0, chats: c && c.total != null ? Number(c.total) : null };
        };
        let src = await count();
        let local = this.store.stats(this.id);
        const differs = () => src.messages !== local.messages || (src.chats != null && src.chats !== local.chats);
        const pass = async (cursor) => {
            this.store.setState(this.id, 'cursor', Math.max(0, cursor));
            await new Promise((resolve) => { this.startSync(); const t = setInterval(() => { if (!this.syncing) { clearInterval(t); resolve(); } }, 1000); });
            src = await count();
            local = this.store.stats(this.id);
        };
        if (differs()) {
            const cur = Number(this.store.getState(this.id, 'cursor') || 0);
            await pass(cur - 7 * 86400000);
            // still short: what is missing is older than a week. The whole history again (in the sync
            // worker, rows already here are rewritten in place), at most once a day
            const lastFull = Number(this.store.getState(this.id, 'fullPassAt') || 0);
            if (differs() && Date.now() - lastFull > 86400000) {
                this.store.setState(this.id, 'fullPassAt', String(Date.now()));
                this.log(`reconcile: ${src.messages - local.messages} messages short after the week's catch-up; reading the whole history again`);
                const keep = Number(this.store.getState(this.id, 'cursor') || 0);
                await pass(0);
                if (Number(this.store.getState(this.id, 'cursor') || 0) < keep) this.store.setState(this.id, 'cursor', keep);
            }
        }
        const report = { at: Date.now(), source: src, local: { messages: local.messages, chats: local.chats }, inSync: src.messages === local.messages && (src.chats == null || src.chats === local.chats) };
        this.store.setState(this.id, 'reconcile', JSON.stringify(report));
        return report;
    }

    noteDrift(d) {
        if (!this.store) return;
        let cur = {};
        try { cur = JSON.parse(this.store.getState(this.id, 'drift') || '{}'); } catch (_) { cur = {}; }
        for (const [k, v] of Object.entries(d)) cur[k] = typeof v === 'number' ? (Number(cur[k]) || 0) + v : v;
        cur.at = Date.now();
        this.store.setState(this.id, 'drift', JSON.stringify(cur));
    }

    // ---- contacts ----

    async loadContacts(force) {
        if (!force && this.contacts && Date.now() - this.contactsAt < CONTACTS_TTL_MS) return this.contacts;
        if (this.contactsPromise) return this.contactsPromise;
        this.contactsPromise = (async () => {
            const map = new Map();
            try {
                // with their pictures (JPEG, base64): the conversation lists show them
                const rows = await this.call('GET', 'contact', { query: { extraProperties: 'avatar' }, timeoutMs: 60000 });
                const avatars = new Map();
                for (const c of Array.isArray(rows) ? rows : []) {
                    const name = String(c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '').trim();
                    if (!name) continue;
                    const addrs = [].concat(c.phoneNumbers || [], c.emails || []).map((a) => (a && typeof a === 'object' ? a.address : a));
                    for (const a of addrs) { const k = handleKey(a); if (k && !map.has(k)) map.set(k, name); }
                    if (c.avatar && typeof c.avatar === 'string') {
                        let buf = null;
                        try { buf = Buffer.from(c.avatar, 'base64'); } catch (_) { buf = null; }
                        if (buf && buf.length > 64) for (const a of addrs) { const k = handleKey(a); if (k && !avatars.has(k)) avatars.set(k, buf); }
                    }
                }
                this.contacts = map;
                this.avatars = avatars;
                this.contactsAt = Date.now();
            } catch (error) {
                if (!this.contacts) this.contacts = map;
                this.log(`contacts failed: ${error.message}`);
            }
            return this.contacts;
        })().finally(() => { this.contactsPromise = null; });
        return this.contactsPromise;
    }

    /** A contact's picture (JPEG bytes) or null. */
    contactAvatar(address) {
        const k = handleKey(address);
        return (k && this.avatars && this.avatars.get(k)) || null;
    }

    photoUrl(address) {
        return this.contactAvatar(address) ? `/api/textmessaging/${encodeURIComponent(this.id)}/avatar/${encodeURIComponent(handleKey(address))}` : null;
    }

    /** Incoming messages after `since` across a conversation's chats (the unread count). */
    async countIncoming(chatGuid, since) {
        // since: a time, or (guid) => time (a merged conversation counts each chat by its own rule)
        const at = (g) => Math.max(0, Math.floor(typeof since === 'function' ? since(g) : since));
        const pages = await Promise.all(this.members(chatGuid).map((g) => this.call('POST', 'message/query', {
            body: { chatGuid: g, limit: 100, offset: 0, after: at(g), sort: 'DESC', with: [] }
        }).then((rows) => (Array.isArray(rows) ? rows : []), () => [])));
        let n = 0;
        for (const rows of pages) for (const r of rows) if (!r.isFromMe && !r.dateRead && !reactionOf(r.associatedMessageType) && !(r.itemType && r.itemType !== 0)) n += 1;
        return n;
    }

    contactName(address) {
        const k = handleKey(address);
        return (k && this.contacts && this.contacts.get(k)) || '';
    }

    // ---- normalize ----

    sender(raw) {
        if (raw.isFromMe) return { address: this.identity(), name: 'Me', me: true };
        const address = raw.handle ? raw.handle.address : (raw.handleAddress || '');
        return { address, name: this.contactName(address), me: false };
    }

    attachmentOut(a) {
        const base = `/api/textmessaging/${encodeURIComponent(this.id)}/attachment/${encodeURIComponent(a.guid)}`;
        const mime = String(a.mimeType || a.mime_type || '');
        return {
            guid: a.guid,
            name: a.transferName || a.transfer_name || 'Attachment',
            mime,
            size: Number(a.totalBytes || a.total_bytes || 0),
            width: Number(a.width || 0) || null,
            height: Number(a.height || 0) || null,
            sticker: !!a.isSticker,
            url: base,
            thumbUrl: /^image\/|^video\//.test(mime) ? `${base}?thumb=1` : null
        };
    }

    /** The iPhone's preview of the message's link: { url, title, description, site, image } or null. */
    linkPreviewOf(raw) {
        let link = raw._link;
        if (link === undefined && raw.payloadData) link = richLinkOf(raw.payloadData);
        if (!link) return null;
        const all = Array.isArray(raw.attachments) ? raw.attachments : [];
        const att = (i) => (i != null && all[i] && all[i].guid ? `/api/textmessaging/${encodeURIComponent(this.id)}/attachment/${encodeURIComponent(all[i].guid)}` : '');
        let site = link.site;
        if (!site) { try { site = new URL(link.url).hostname.replace(/^www\./, ''); } catch (_) { site = ''; } }
        return { url: link.url, title: link.title, description: link.description, site, image: att(link.imageIndex) || att(link.iconIndex) || '' };
    }

    normalizeMessage(raw, chatGuid) {
        const attachments = (Array.isArray(raw.attachments) ? raw.attachments : [])
            .filter((a) => a && a.guid && !(a.hideAttachment || a.hide_attachment))
            .map((a) => this.attachmentOut(a));
        let text = raw.text == null ? '' : String(raw.text);
        // attachments put U+FFFC in the text where they sat
        text = text.replace(/￼/g, '').trim();
        return {
            guid: raw.guid,
            chatGuid: chatGuid || (Array.isArray(raw.chats) && raw.chats[0] ? raw.chats[0].guid : ''),
            text,
            subject: raw.subject || '',
            fromMe: !!raw.isFromMe,
            sender: this.sender(raw),
            date: Number(raw.dateCreated) || Date.now(),
            dateDelivered: Number(raw.dateDelivered) || null,
            dateRead: Number(raw.dateRead) || null,
            dateEdited: Number(raw.dateEdited) || null,
            retracted: !!raw.dateRetracted,
            error: Number(raw.error) || 0,
            service: raw.handle && raw.handle.service ? raw.handle.service : '',
            replyTo: raw.threadOriginatorGuid || null,
            effect: raw.expressiveSendStyleId || null,
            groupEvent: raw.itemType && raw.itemType !== 0 ? { itemType: raw.itemType, groupTitle: raw.groupTitle || '', actionType: raw.groupActionType || 0 } : null,
            attachments,
            linkPreview: raw.balloonBundleId === URL_BALLOON ? this.linkPreviewOf(raw) : null,
            reactions: []
        };
    }

    normalizeChat(c) {
        const participants = (Array.isArray(c.participants) ? c.participants : []).map((p) => ({ address: p.address, name: this.contactName(p.address), service: p.service || '', photo: this.photoUrl(p.address), business: /^urn:biz:/i.test(String(p.address || '')) }));
        const last = c.lastMessage ? this.normalizeMessage(c.lastMessage, c.guid) : null;
        const isGroup = Number(c.style) === 43 || participants.length > 1;
        const title = String(c.displayName || '').trim()
            || participants.map((p) => p.name || p.address).join(', ')
            || String(c.chatIdentifier || '');
        return {
            guid: c.guid,
            identifier: c.chatIdentifier || '',
            title,
            named: !!String(c.displayName || '').trim(),
            isGroup,
            participants,
            photo: participants.length === 1 ? participants[0].photo : null,
            business: participants.length === 1 && participants[0].business,
            service: String(c.guid || '').split(';')[0] || '',
            archived: !!c.isArchived,
            last,
            unread: !!(last && !last.fromMe && !last.dateRead && c.hasUnreadMessage !== false) || c.hasUnreadMessage === true
        };
    }

    // ---- reads ----

    /**
     * The conversations, newest first: empty chats left out and one person's iMessage and SMS chats
     * merged (the settings say), so an offset counts conversations, not the Mac's chats.
     * scan: how many of the Mac's chats to read (the core reads more when it filters by folder).
     */
    async listChats({ limit = 50, offset = 0, scan = 0 } = {}) {
        await this.loadContacts().catch(() => {});
        const want = Math.min(MAX_CHAT_SCAN, Math.max(scan, (offset + limit) * 2 + 20));
        let rows;
        if (this.storeReady()) rows = this.store.listChats(this.id, { limit: want }).map((r) => r.raw);
        else {
            rows = await this.call('POST', 'chat/query', { body: { limit: want, offset: 0, with: ['lastMessage', 'participants'], sort: 'lastmessage' } });
            if (this.store && Array.isArray(rows)) this.store.putChats(this.id, rows.map((c) => ({ guid: c.guid, raw: c, lastDate: (c.lastMessage && Number(c.lastMessage.dateCreated)) || 0 })));
        }
        let chats = (Array.isArray(rows) ? rows : []).map((c) => this.normalizeChat(c));
        if (this.settings.hideEmptyChats !== false) chats = chats.filter((c) => c.last);
        chats.sort((a, b) => ((b.last && b.last.date) || 0) - ((a.last && a.last.date) || 0));
        if (this.settings.mergeConversations !== false) chats = this.merge(chats);
        return chats.slice(offset, offset + limit);
    }

    /** One person's 1:1 chats (iMessage, SMS, RCS) as one conversation, under the newest one's guid. */
    merge(chats) {
        const out = [];
        const byPerson = new Map();
        for (const c of chats) {
            const key = !c.isGroup && c.participants.length === 1 ? handleKey(c.participants[0].address) : '';
            const into = key ? byPerson.get(key) : null;
            if (!into) {
                c.guids = [c.guid];
                if (key) byPerson.set(key, c);
                out.push(c);
                continue;
            }
            into.guids.push(c.guid);
            into.unread = into.unread || c.unread;
            if (!into.participants[0].name && c.participants[0].name) into.participants[0].name = c.participants[0].name;
        }
        for (const c of out) {
            this.membersOf.set(c.guid, c.guids);
            for (const g of c.guids) this.primaryOf.set(g, c.guid);
        }
        return out;
    }

    async getChat(chatGuid) {
        await this.loadContacts().catch(() => {});
        const guid = this.resolve(chatGuid);
        if (this.storeReady()) {
            const row = this.store.getChat(this.id, guid);
            if (row) { const chat = this.normalizeChat(row.raw); chat.guids = this.members(guid); return chat; }
        }
        const c = await this.call('GET', `chat/${encodeURIComponent(guid)}`, { query: { with: 'participants,lastmessage' } });
        if (!c) return null;
        const chat = this.normalizeChat(c);
        chat.guids = this.members(guid);
        return chat;
    }

    async listMessages(chatGuid, { limit = 50, before = null } = {}) {
        await this.loadContacts().catch(() => {});
        const guid = this.resolve(chatGuid);
        // everything is in the store once the first sync finished: no round trip to the Mac
        if (this.storeReady()) {
            const rows = this.store.listMessages(this.id, this.members(guid), { limit: limit + 1, before: before && /^\d+$/.test(String(before)) ? Number(before) : null });
            return this.fold(rows.slice(0, limit), guid, limit, rows.length > limit, rows.length > limit);
        }
        const pages = await Promise.all(this.members(guid).map((g) => this.call('GET', `chat/${encodeURIComponent(g)}/message`, {
            query: { limit, sort: 'DESC', before: before || undefined, with: 'attachment,handle,attributedBody,messageSummaryInfo,payloadData' }
        }).then((rows) => (Array.isArray(rows) ? rows : []), () => [])));
        const full = pages.some((p) => p.length >= limit);
        // a merged conversation: the newest `limit` across its chats
        const all = [].concat(...pages).sort((a, b) => (Number(b.dateCreated) || 0) - (Number(a.dateCreated) || 0));
        if (this.store) this.storeRows(all);
        return this.fold(all.slice(0, limit), guid, limit, full, all.length > limit);
    }

    /** A page of raw messages (newest first) as the client gets it: tapbacks folded onto their targets. */
    fold(list, chatGuid, limit, full, cut) {
        const out = [];
        const byGuid = new Map();
        const reactions = [];
        for (const raw of list) {
            const r = reactionOf(raw.associatedMessageType);
            if (r && raw.associatedMessageGuid) { reactions.push({ raw, r }); continue; }
            const m = this.normalizeMessage(raw, chatGuid);
            byGuid.set(m.guid, m);
            out.push(m);
        }
        // oldest first; a later "-love" cancels an earlier "love" by the same sender
        reactions.sort((a, b) => (a.raw.dateCreated || 0) - (b.raw.dateCreated || 0));
        for (const { raw, r } of reactions) {
            const target = byGuid.get(targetGuid(raw.associatedMessageGuid));
            if (!target) continue;
            const who = raw.isFromMe ? 'me' : handleKey(raw.handle && raw.handle.address);
            const type = r.replace(/^-/, '');
            target.reactions = target.reactions.filter((x) => x._who !== who);
            if (!r.startsWith('-')) target.reactions.push({ type, fromMe: !!raw.isFromMe, sender: this.sender(raw), guid: raw.guid, date: raw.dateCreated, _who: who });
        }
        for (const m of out) m.reactions = m.reactions.map(({ _who, ...rest }) => rest);
        out.sort((a, b) => a.date - b.date);
        // the next page: messages before the oldest one here (clients pass page.cursor back as before)
        const oldest = list.length ? Math.min(...list.map((r) => Number(r.dateCreated) || Infinity)) : null;
        return { messages: out, more: !!(full || cut), cursor: oldest && Number.isFinite(oldest) ? String(oldest) : null };
    }

    async downloadAttachment(guid, { thumb } = {}) {
        const query = thumb ? { width: 480, quality: 'better' } : { original: false };
        return this.call('GET', `attachment/${encodeURIComponent(guid)}/download`, { query, raw: true, timeoutMs: 120000 });
    }

    // ---- writes ----

    method() { return this.features().privateApi ? 'private-api' : 'apple-script'; }

    async sendText({ chatGuid, addresses, text, replyTo, subject, effect, tempGuid }) {
        const temp = tempGuid || `temp-${randomUUID()}`;
        if (!chatGuid) {
            const list = (addresses || []).map((a) => String(a).trim()).filter(Boolean);
            if (!list.length) throw Object.assign(new Error('Who is the message for?'), { code: 'NO_RECIPIENT' });
            const chat = await this.call('POST', 'chat/new', { body: { addresses: list, message: text, method: this.method(), tempGuid: temp }, timeoutMs: SEND_TIMEOUT_MS });
            const guid = chat && chat.guid;
            return { tempGuid: temp, chatGuid: guid || '', message: chat && chat.lastMessage ? this.normalizeMessage(chat.lastMessage, guid) : null };
        }
        const body = { chatGuid, tempGuid: temp, message: String(text || ''), method: this.method() };
        if (subject) body.subject = subject;
        if (effect && this.features().effects) body.effectId = effect;
        if (replyTo && this.features().reply) { body.selectedMessageGuid = replyTo; body.partIndex = 0; }
        const raw = await this.call('POST', 'message/text', { body, timeoutMs: SEND_TIMEOUT_MS });
        return { tempGuid: temp, chatGuid, message: raw ? this.normalizeMessage(raw, chatGuid) : null };
    }

    async sendAttachment({ chatGuid, name, mime, buffer, replyTo, tempGuid, audio }) {
        const temp = tempGuid || `temp-${randomUUID()}`;
        const form = new FormData();
        form.append('chatGuid', chatGuid);
        form.append('tempGuid', temp);
        form.append('name', name || 'attachment');
        form.append('method', this.method());
        if (audio) form.append('isAudioMessage', 'true');
        if (replyTo && this.features().reply) { form.append('selectedMessageGuid', replyTo); form.append('partIndex', '0'); }
        form.append('attachment', new Blob([buffer], { type: mime || 'application/octet-stream' }), name || 'attachment');
        const raw = await this.call('POST', 'message/attachment', { body: form, timeoutMs: SEND_TIMEOUT_MS });
        return { tempGuid: temp, chatGuid, message: raw ? this.normalizeMessage(raw, chatGuid) : null };
    }

    requirePrivate(what) {
        if (!this.features().privateApi) throw Object.assign(new Error(`${what} needs the BlueBubbles Private API.`), { code: 'NO_PRIVATE_API' });
    }

    async react({ chatGuid, messageGuid, messageText, reaction, remove }) {
        this.requirePrivate('Reactions');
        const type = String(reaction || '').replace(/^-/, '');
        if (!REACTIONS.includes(type)) throw Object.assign(new Error('Unknown reaction.'), { code: 'BAD_REACTION' });
        await this.call('POST', 'message/react', { body: { chatGuid, selectedMessageGuid: messageGuid, selectedMessageText: messageText || '', reaction: remove ? `-${type}` : type, partIndex: 0 } });
        return { ok: true };
    }

    async edit({ messageGuid, text }) {
        this.requirePrivate('Editing');
        const raw = await this.call('POST', `message/${encodeURIComponent(messageGuid)}/edit`, { body: { editedMessage: text, backwardsCompatibilityMessage: `Edited to "${text}"`, partIndex: 0 } });
        return { message: raw ? this.normalizeMessage(raw) : null };
    }

    async unsend({ messageGuid }) {
        this.requirePrivate('Unsend');
        const raw = await this.call('POST', `message/${encodeURIComponent(messageGuid)}/unsend`, { body: { partIndex: 0 } });
        return { message: raw ? this.normalizeMessage(raw) : null };
    }

    async markRead({ chatGuid }) {
        // read here always (the core's marks); on the Mac only when read receipts are on
        if (!this.features().readReceipts) return { ok: false };
        await Promise.all(this.members(chatGuid).map((g) => this.call('POST', `chat/${encodeURIComponent(g)}/read`, { body: {} }).catch(() => null)));
        return { ok: true };
    }

    /** Messages whose text holds q, newest first, across every chat (the Mac's whole history). */
    async searchMessages(q, { limit = 40 } = {}) {
        await this.loadContacts().catch(() => {});
        if (this.storeReady()) {
            return this.store.search(q, { account: this.id, limit: limit * 2 }).filter((r) => r.chatGuid !== ORPHAN_CHAT).map((r) => r.raw)
                .filter((r) => !reactionOf(r.associatedMessageType))
                .slice(0, limit)
                .map((r) => this.normalizeMessage(r, this.resolve(Array.isArray(r.chats) && r.chats[0] ? r.chats[0].guid : '')));
        }
        const rows = await this.call('POST', 'message/query', { body: {
            limit, offset: 0, sort: 'DESC', with: ['chat', 'handle', 'attachment'],
            where: [{ statement: 'message.text LIKE :term COLLATE NOCASE', args: { term: `%${q}%` } }]
        }, timeoutMs: 30000 });
        return (Array.isArray(rows) ? rows : [])
            .filter((r) => !reactionOf(r.associatedMessageType))
            .map((r) => this.normalizeMessage(r, this.resolve(Array.isArray(r.chats) && r.chats[0] ? r.chats[0].guid : '')));
    }

    /** Delete the conversation on the Mac (Private API), every chat it merges. */
    async deleteChat({ chatGuid }) {
        this.requirePrivate('Deleting a conversation');
        const guids = this.members(chatGuid);
        await Promise.all(guids.map((g) => this.call('DELETE', `chat/${encodeURIComponent(g)}`)));
        for (const g of guids) { this.primaryOf.delete(g); if (this.store) this.store.deleteChat(this.id, g); }
        this.membersOf.delete(this.resolve(chatGuid));
        return { ok: true };
    }

    /** Mark as Unread on the Mac too (Private API), every chat of the conversation. */
    async markUnread({ chatGuid }) {
        if (!this.features().privateApi) return { ok: false };
        await Promise.all(this.members(chatGuid).map((g) => this.call('POST', `chat/${encodeURIComponent(g)}/unread`, { body: {} }).catch(() => null)));
        return { ok: true };
    }

    async typing({ chatGuid, typing }) {
        if (!this.features().typing) return { ok: false };
        await this.call(typing ? 'POST' : 'DELETE', `chat/${encodeURIComponent(this.resolve(chatGuid))}/typing`);
        return { ok: true };
    }
}

module.exports = { BlueBubblesProvider, handleKey, normalizeUrl, reactionOf, richLinkOf, REACTIONS, DEFAULT_SETTINGS };
