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

function reactionOf(type) {
    if (type == null || type === '') return null;
    if (typeof type === 'number' || /^\d+$/.test(String(type))) return REACTION_CODES[Number(type)] || null;
    const t = String(type).toLowerCase();
    const bare = t.replace(/^-/, '');
    return REACTIONS.includes(bare) ? t : null;
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
        const priv = !!(this.info && this.info.private_api);
        return { privateApi: priv, attachments: true, tapbacks: priv, edit: priv, unsend: priv, reply: priv, typing: priv, readReceipts: priv, newChat: true, effects: priv };
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
        } catch (error) {
            this.setStatus('error', error.message);
            this.scheduleRetry();
        }
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.retryTimer);
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
        socket.on('connect', () => { this.setStatus('connected', ''); this.hooks.emit && this.hooks.emit('resync', { accountId: this.id }); });
        socket.on('disconnect', (reason) => { if (!this.stopped) this.setStatus('connecting', `Disconnected (${reason})`); });
        socket.on('connect_error', (error) => { if (!this.stopped) this.setStatus('error', `Cannot reach the BlueBubbles server (${error.message}).`); });
        socket.on('new-message', (m) => this.onMessage(m, false));
        socket.on('updated-message', (m) => this.onMessage(m, true));
        socket.on('message-send-error', (m) => this.onMessage(m, true));
        socket.on('typing-indicator', (d) => {
            if (!d || !d.guid) return;
            this.hooks.emit && this.hooks.emit('typing', { accountId: this.id, chatGuid: d.guid, typing: d.display === true });
        });
        socket.on('chat-read-status-changed', (d) => {
            if (!d || !d.chatGuid) return;
            this.hooks.emit && this.hooks.emit('read', { accountId: this.id, chatGuid: d.chatGuid, read: d.read !== false });
        });
        for (const ev of ['group-name-change', 'participant-added', 'participant-removed', 'participant-left', 'chat-read-status-changed']) {
            if (ev === 'chat-read-status-changed') continue;
            socket.on(ev, (m) => {
                const chatGuid = m && Array.isArray(m.chats) && m.chats[0] ? m.chats[0].guid : (m && m.chatGuid) || '';
                this.hooks.emit && this.hooks.emit('chat', { accountId: this.id, chatGuid });
            });
        }
    }

    log(msg) {
        if (this.hooks.log) this.hooks.log(msg);
        else console.warn(`[textMessaging:bluebubbles] ${msg}`);
    }

    onMessage(raw, updated) {
        if (!raw || !raw.guid) return;
        const chatGuid = Array.isArray(raw.chats) && raw.chats[0] ? raw.chats[0].guid : '';
        const reaction = reactionOf(raw.associatedMessageType);
        if (reaction && raw.associatedMessageGuid) {
            this.hooks.emit && this.hooks.emit('reaction', {
                accountId: this.id, chatGuid,
                targetGuid: targetGuid(raw.associatedMessageGuid),
                reaction: { type: reaction.replace(/^-/, ''), removed: reaction.startsWith('-'), fromMe: !!raw.isFromMe, sender: this.sender(raw), guid: raw.guid, date: raw.dateCreated || Date.now() }
            });
            return;
        }
        const message = this.normalizeMessage(raw, chatGuid);
        this.hooks.emit && this.hooks.emit(updated ? 'updated' : 'message', { accountId: this.id, chatGuid, message, chat: Array.isArray(raw.chats) && raw.chats[0] ? raw.chats[0] : null });
    }

    // ---- contacts ----

    async loadContacts(force) {
        if (!force && this.contacts && Date.now() - this.contactsAt < CONTACTS_TTL_MS) return this.contacts;
        if (this.contactsPromise) return this.contactsPromise;
        this.contactsPromise = (async () => {
            const map = new Map();
            try {
                const rows = await this.call('GET', 'contact', { timeoutMs: 60000 });
                for (const c of Array.isArray(rows) ? rows : []) {
                    const name = String(c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '').trim();
                    if (!name) continue;
                    const addrs = [].concat(c.phoneNumbers || [], c.emails || []).map((a) => (a && typeof a === 'object' ? a.address : a));
                    for (const a of addrs) { const k = handleKey(a); if (k && !map.has(k)) map.set(k, name); }
                }
                this.contacts = map;
                this.contactsAt = Date.now();
            } catch (error) {
                if (!this.contacts) this.contacts = map;
                this.log(`contacts failed: ${error.message}`);
            }
            return this.contacts;
        })().finally(() => { this.contactsPromise = null; });
        return this.contactsPromise;
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
            reactions: []
        };
    }

    normalizeChat(c) {
        const participants = (Array.isArray(c.participants) ? c.participants : []).map((p) => ({ address: p.address, name: this.contactName(p.address), service: p.service || '' }));
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
            service: String(c.guid || '').split(';')[0] || '',
            archived: !!c.isArchived,
            last,
            unread: !!(last && !last.fromMe && !last.dateRead && c.hasUnreadMessage !== false) || c.hasUnreadMessage === true
        };
    }

    // ---- reads ----

    async listChats({ limit = 50, offset = 0 } = {}) {
        await this.loadContacts().catch(() => {});
        const rows = await this.call('POST', 'chat/query', { body: { limit, offset, with: ['lastMessage', 'participants'], sort: 'lastmessage' } });
        return (Array.isArray(rows) ? rows : []).map((c) => this.normalizeChat(c));
    }

    async getChat(chatGuid) {
        await this.loadContacts().catch(() => {});
        const c = await this.call('GET', `chat/${encodeURIComponent(chatGuid)}`, { query: { with: 'participants,lastmessage' } });
        return c ? this.normalizeChat(c) : null;
    }

    async listMessages(chatGuid, { limit = 50, before = null } = {}) {
        await this.loadContacts().catch(() => {});
        const rows = await this.call('GET', `chat/${encodeURIComponent(chatGuid)}/message`, {
            query: { limit, sort: 'DESC', before: before || undefined, with: 'attachment,handle,attributedBody,messageSummaryInfo' }
        });
        const list = Array.isArray(rows) ? rows : [];
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
        return { messages: out, more: list.length >= limit };
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
        if (!this.features().privateApi) return { ok: false };
        await this.call('POST', `chat/${encodeURIComponent(chatGuid)}/read`, { body: {} });
        return { ok: true };
    }

    async typing({ chatGuid, typing }) {
        if (!this.features().typing) return { ok: false };
        await this.call(typing ? 'POST' : 'DELETE', `chat/${encodeURIComponent(chatGuid)}/typing`);
        return { ok: true };
    }
}

module.exports = { BlueBubblesProvider, handleKey, normalizeUrl, reactionOf, REACTIONS };
