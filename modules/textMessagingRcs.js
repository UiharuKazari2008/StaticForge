/**
 * Text Messaging: the RCS provider (Yozora #779, modules/textMessaging.js).
 *
 * Android gives third-party apps no RCS, and RCS needs Google Messages as the phone's default app.
 * So the server pairs with Google Messages as a "Messages for web" client: services/rcs-bridge (Go,
 * mautrix-gmessages' libgm) does the protocol, this module runs it and speaks JSON lines with it
 * (see services/rcs-bridge/main.go). Like BlueBubbles nothing is copied here: the phone is the store,
 * every conversation and its whole history read through it. Pairing is a QR code the phone scans in
 * Google Messages > Device pairing (shown on the desktop: Dreamscape CardSpace / Device Center).
 *
 * Binary: .cache/rcs-bridge/rcs-bridge (built by scripts/build-rcs-bridge.sh). State (the pairing
 * session) in .cache/rcs-bridge/<account id>/session.json.
 *
 * Ids: chat guid = Google's conversationID, message guid = messageID. An attachment guid carries
 * what the download needs (media id + key, base64url JSON), so no table has to survive restarts.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');
const { randomUUID } = require('crypto');
const { handleKey } = require('./textMessagingBlueBubbles');

const CALL_TIMEOUT_MS = 60000;
const SEND_TIMEOUT_MS = 180000;
const RESTART_MAX_MS = 60000;
const SEEN_MAX = 5000;

const REACTION_EMOJI = { love: '❤️', like: '👍', dislike: '👎', laugh: '😂', emphasize: '‼️', question: '❓' };
const REACTION_FROM_TYPE = { LOVE: 'love', RED_HEART: 'love', LIKE: 'like', DISLIKE: 'dislike', LAUGH: 'laugh', SURPRISED: 'emphasize', QUESTIONING: 'question' };

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
/** Google's timestamps are microseconds. */
function usToMs(v) { const n = num(v); return n > 1e14 ? Math.round(n / 1000) : n; }
function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { try { return JSON.parse(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return null; } }

class RcsProvider {
    constructor(account, hooks, opts = {}) {
        this.id = account.id;
        this.hooks = hooks || {};
        this.bin = opts.bin || path.join(opts.cacheDir || path.join(__dirname, '..', '.cache'), 'rcs-bridge', 'rcs-bridge');
        this.stateDir = path.join(opts.cacheDir || path.join(__dirname, '..', '.cache'), 'rcs-bridge', account.id);
        this.tmpDir = path.join(this.stateDir, 'tmp');
        this.status = 'connecting';
        this.error = '';
        this.loggedIn = false;
        this.qr = '';
        this.phone = '';
        this.carrier = '';
        this.child = null;
        this.buf = '';
        this.nextId = 1;
        this.pending = new Map();
        this.convs = new Map();   // conversationID -> raw conversation
        this.avatars = new Map(); // handleKey(number) -> JPEG/PNG bytes (Google's participant thumbnails)
        this.avatarTried = new Set(); // participant ids already asked for
        this.seen = new Map();    // messageID -> status (insertion order = age)
        this.stopped = false;
        this.restartMs = 2000;
    }

    get kind() { return 'rcs'; }

    identity() { return this.phone || ''; }

    features() {
        return { privateApi: false, attachments: true, tapbacks: true, edit: false, unsend: false, reply: true, typing: true, readReceipts: true, newChat: true, effects: false, pairing: true, deleteChat: true };
    }

    log(m) { if (this.hooks.log) this.hooks.log(m); else console.warn(`[textMessaging:rcs] ${m}`); }

    emit(event, payload) { if (this.hooks.emit) this.hooks.emit(event, Object.assign({ accountId: this.id }, payload || {})); }

    setStatus(status, error) {
        const changed = status !== this.status || (error || '') !== this.error;
        this.status = status;
        this.error = error || '';
        if (changed) this.emit('account', {});
    }

    // ---- the child ----

    async start() {
        this.stopped = false;
        if (!fs.existsSync(this.bin)) {
            this.setStatus('error', 'The RCS bridge is not built (scripts/build-rcs-bridge.sh).');
            return;
        }
        await fs.promises.mkdir(this.tmpDir, { recursive: true });
        this.spawn();
    }

    /**
     * The bridge runs detached and outlives the server (a new Google Messages connection on every
     * restart makes the phone announce "your messages are now available on the device you paired"):
     * connect to its socket, and start it only when nothing listens there.
     */
    spawn() {
        if (this.child || this.stopped || this.connecting) return;
        this.connecting = true;
        const sock = path.join(this.stateDir, 'bridge.sock');
        const attach = (tries) => {
            const c = net.createConnection(sock);
            c.once('connect', () => { this.connecting = false; this.attach(c); });
            c.once('error', () => {
                c.destroy();
                if (this.stopped) { this.connecting = false; return; }
                if (tries === 0) this.launch(sock);
                if (tries < 20) setTimeout(() => attach(tries + 1), 500).unref();
                else { this.connecting = false; this.setStatus('error', 'The RCS bridge did not start.'); this.retryLater(); }
            });
        };
        attach(0);
    }

    launch(sock) {
        try {
            // through a shell that exits at once: the bridge is re-parented away from the server, so
            // pm2's tree kill on a restart does not reach it (a direct child would die with the server)
            const log = path.join(this.stateDir, 'bridge.log');
            const child = spawn('/bin/sh', ['-c', 'setsid "$0" "$1" </dev/null >>"$2" 2>&1 &', this.bin, this.stateDir, log], {
                detached: true, stdio: 'ignore', env: Object.assign({}, process.env, { RCS_BRIDGE_SOCKET: sock })
            });
            child.unref();
        } catch (error) {
            this.log(`launch failed: ${error.message}`);
        }
    }

    attach(conn) {
        this.child = conn;
        this.buf = '';
        conn.setEncoding('utf8');
        conn.on('data', (chunk) => {
            this.buf += chunk;
            let nl;
            while ((nl = this.buf.indexOf('\n')) >= 0) {
                const line = this.buf.slice(0, nl);
                this.buf = this.buf.slice(nl + 1);
                if (line.trim()) this.onLine(line);
            }
        });
        const gone = () => {
            if (this.child !== conn) return;
            this.child = null;
            for (const [, p] of this.pending) p.reject(Object.assign(new Error('The RCS bridge stopped.'), { code: 'BRIDGE_EXIT' }));
            this.pending.clear();
            if (this.stopped) return;
            this.setStatus('error', 'The RCS bridge stopped.');
            this.retryLater();
        };
        conn.on('close', gone);
        conn.on('error', () => {});
    }

    retryLater() {
        const t = setTimeout(() => this.spawn(), this.restartMs);
        if (t.unref) t.unref();
        this.restartMs = Math.min(this.restartMs * 2, RESTART_MAX_MS);
    }

    stop() {
        this.stopped = true;
        const c = this.child;
        this.child = null;
        if (c) {
            // removed or turned off: the bridge ends too
            try { c.write(JSON.stringify({ id: 0, cmd: 'exit' }) + '\n'); } catch (_) { /* gone */ }
            setTimeout(() => { try { c.destroy(); } catch (_) { /* gone */ } }, 1000).unref();
        }
        this.setStatus('disabled', '');
    }

    call(cmd, args, timeoutMs) {
        if (!this.child) return Promise.reject(Object.assign(new Error('The RCS bridge is not running.'), { code: 'BRIDGE_DOWN' }));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('The phone did not answer in time.'), { code: 'TIMEOUT' })); }, timeoutMs || CALL_TIMEOUT_MS);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); }
            });
            this.child.write(JSON.stringify({ id, cmd, args: args || {} }) + '\n');
        });
    }

    onLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch (_) { return; }
        if (msg.id != null) {
            const p = this.pending.get(msg.id);
            if (!p) return;
            this.pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.result);
            else {
                const text = String(msg.error || 'The phone refused.');
                const code = /^NOT_PAIRED/.test(text) ? 'NOT_PAIRED' : 'PROVIDER_ERROR';
                p.reject(Object.assign(new Error(text.replace(/^NOT_PAIRED: /, '')), { code }));
            }
            return;
        }
        const d = msg.data;
        switch (msg.event) {
            case 'state':
                this.loggedIn = !!(d && d.loggedIn);
                if (d && d.fatal) this.setStatus('error', d.error || 'The pairing stopped working.');
                else if (d && d.error) this.setStatus('connecting', d.error);
                else if (this.loggedIn && d && d.connected) { this.restartMs = 2000; this.setStatus('connected', d.browserActiveElsewhere ? 'Messages for web is open somewhere else.' : (d.phoneResponding === false ? 'The phone is not answering.' : '')); this.loadContacts().catch(() => {}); }
                else if (!this.loggedIn) this.setStatus('unpaired', 'Not paired with Google Messages.');
                break;
            case 'qr':
                this.qr = (d && d.url) || '';
                this.emit('pairing', { qr: this.qr });
                break;
            case 'paired':
                this.qr = '';
                this.emoji = '';
                this.emit('pairing', { paired: true });
                break;
            case 'emoji':
                // Google account pairing: the phone asks to tap this emoji
                this.emoji = (d && d.emoji) || '';
                this.emit('pairing', { emoji: this.emoji, emojiSvg: (d && d.svg) || '' });
                break;
            case 'pair_failed':
                this.emoji = '';
                this.setStatus('unpaired', (d && d.error) || 'Pairing failed.');
                this.emit('pairing', { error: (d && d.error) || 'Pairing failed.' });
                break;
            case 'logged_out':
                this.loggedIn = false;
                this.setStatus('unpaired', 'Google Messages ended the pairing.');
                break;
            case 'settings':
                this.onSettings(d);
                break;
            case 'conversation':
                this.onConversation(d);
                break;
            case 'message':
                this.onMessage(d && d.message, d && d.isOld);
                break;
            case 'typing':
                if (d && d.conversationID) this.emit('typing', { chatGuid: d.conversationID, typing: d.type === 'STARTED_TYPING' || d.type === 1 });
                break;
            default:
                break;
        }
    }

    onSettings(s) {
        const sims = (s && s.SIMCards) || [];
        const sim = sims[0] && sims[0].SIMData;
        if (sim) {
            const phone = sim.formattedPhoneNumber || sim.internationalPhoneNumber || '';
            if (phone && phone !== this.phone) { this.phone = phone; this.carrier = sim.carrierName || ''; this.emit('account', {}); }
        }
    }

    onConversation(c) {
        if (!c || !c.conversationID) return;
        const prev = this.convs.get(c.conversationID);
        this.convs.set(c.conversationID, c);
        this.emit('chat', { chatGuid: c.conversationID });
        if (prev && prev.unread && !c.unread) this.emit('read', { chatGuid: c.conversationID, read: true });
    }

    onMessage(raw, isOld) {
        if (!raw || !raw.messageID) return;
        const status = (raw.messageStatus && raw.messageStatus.status) || '';
        const was = this.seen.get(raw.messageID);
        this.seen.delete(raw.messageID);
        this.seen.set(raw.messageID, status + '|' + JSON.stringify(raw.reactions || []));
        if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.keys().next().value);
        const message = this.normalizeMessage(raw);
        if (was == null && !isOld) {
            this.emit('message', { chatGuid: raw.conversationID, message, chat: this.convs.get(raw.conversationID) || null });
        } else if (was !== this.seen.get(raw.messageID)) {
            this.emit('updated', { chatGuid: raw.conversationID, message });
        }
    }

    // ---- contacts ----

    async loadContacts() { return null; }

    contactName(address) {
        const k = handleKey(address);
        if (!k) return '';
        for (const c of this.convs.values()) {
            for (const p of c.participants || []) {
                if (this.isSelf(c, p) || !p.contactID) continue;
                if (handleKey(p.ID && p.ID.number) === k || handleKey(p.formattedNumber) === k) return p.fullName || p.firstName || '';
            }
        }
        return '';
    }

    // ---- normalize ----

    participant(conv, id) {
        return ((conv && conv.participants) || []).find((p) => (p.ID && p.ID.participantID) === id) || null;
    }

    normalizeMessage(raw) {
        const conv = this.convs.get(raw.conversationID);
        const status = (raw.messageStatus && raw.messageStatus.status) || '';
        const fromMe = /^OUTGOING_/.test(status);
        const p = raw.senderParticipant || this.participant(conv, raw.participantID);
        const address = p ? ((p.ID && p.ID.number) || p.formattedNumber || '') : '';
        const sender = fromMe ? { address: this.phone, name: 'Me', me: true } : { address, name: this.nameOf(p) || (p ? this.shownAddress(p) : ''), me: false };
        const texts = [];
        const attachments = [];
        (raw.messageInfo || []).forEach((info, i) => {
            if (info.messageContent && info.messageContent.content) texts.push(info.messageContent.content);
            const m = info.mediaContent;
            if (m && m.mediaID) {
                const mime = m.mimeType || '';
                const ref = { m: m.mediaID, k: m.decryptionKey || '', t: m.thumbnailMediaID || '', tk: m.thumbnailDecryptionKey || '', y: mime, n: m.mediaName || '' };
                const guid = `r${b64url(ref)}`;
                const base = `/api/textmessaging/${encodeURIComponent(this.id)}/attachment/${encodeURIComponent(guid)}`;
                attachments.push({
                    guid, name: m.mediaName || `Attachment ${i + 1}`, mime, size: num(m.size),
                    width: num(m.dimensions && m.dimensions.width) || null, height: num(m.dimensions && m.dimensions.height) || null,
                    sticker: false, url: base, thumbUrl: /^image\/|^video\//.test(mime) ? `${base}?thumb=1` : null
                });
            }
        });
        const date = usToMs(raw.timestamp) || Date.now();
        const reactions = [];
        for (const r of raw.reactions || []) {
            const data = r.data || {};
            const type = REACTION_FROM_TYPE[data.type] || 'emoji';
            for (const pid of r.participantIDs || []) {
                const rp = this.participant(conv, pid);
                const mine = this.isSelf(conv, rp) || (conv && pid === conv.defaultOutgoingID);
                reactions.push({ type, emoji: data.unicode || '', fromMe: mine, sender: mine ? { address: this.phone, name: 'Me', me: true } : { address: rp ? (rp.ID && rp.ID.number) || '' : '', name: rp && rp.contactID ? rp.fullName || '' : '', me: false } });
            }
        }
        return {
            guid: raw.messageID,
            chatGuid: raw.conversationID,
            text: texts.join('\n'),
            subject: raw.subject || '',
            fromMe,
            sender,
            date,
            dateDelivered: /OUTGOING_(DELIVERED|DISPLAYED)/.test(status) ? date : null,
            dateRead: status === 'OUTGOING_DISPLAYED' ? date : null,
            dateEdited: null,
            retracted: status === 'OUTGOING_DELETED',
            error: /OUTGOING_FAILED|OUTGOING_CANCELED|OUTGOING_RESTRICTED/.test(status) ? 1 : 0,
            sending: /OUTGOING_(YET_TO_SEND|SENDING|RESENDING|AWAITING_RETRY|VALIDATING)/.test(status),
            service: conv && conv.type === 'RCS' ? 'RCS' : 'SMS',
            replyTo: (raw.replyMessage && raw.replyMessage.messageID) || null,
            effect: null,
            groupEvent: !texts.length && !attachments.length && !fromMe && /TOMBSTONE|^$/.test(status) ? { itemType: 1, groupTitle: '' } : null,
            attachments,
            reactions
        };
    }

    /** A participant's name: contacts by their card, businesses (RBM agents) by their own name. */
    nameOf(p) {
        if (!p) return '';
        if (p.contactID) return p.fullName || p.firstName || '';
        if (this.isBusiness(p)) return p.fullName || p.firstName || '';
        return '';
    }

    isBusiness(p) {
        const t = p && p.ID && p.ID.type;
        const n = String((p && p.ID && p.ID.number) || '');
        return t === 'BOT' || t === 3 || /@rbm\.goog$/i.test(n);
    }

    /** What a participant without a name shows: Google's formatted number, else the raw one. */
    shownAddress(p) {
        return (p && (p.formattedNumber || (p.ID && p.ID.number))) || '';
    }

    contactAvatar(key) { return this.avatars.get(String(key || '')) || null; }

    photoUrl(address) {
        const k = handleKey(address);
        return k && this.avatars.has(k) ? `/api/textmessaging/${encodeURIComponent(this.id)}/avatar/${encodeURIComponent(k)}` : null;
    }

    /** Google's pictures for the participants on a page (one request, at most 3 s). */
    async loadThumbnails(convs) {
        const want = new Map();
        for (const c of convs) for (const p of c.participants || []) {
            const id = p.ID && p.ID.participantID;
            if (!id || this.isSelf(c, p) || this.avatarTried.has(id)) continue;
            want.set(id, handleKey(p.ID.number || p.formattedNumber));
        }
        if (!want.size) return;
        for (const id of want.keys()) this.avatarTried.add(id);
        try {
            const res = await Promise.race([this.call('thumbnails', { participantIds: [...want.keys()].slice(0, 100) }), new Promise((r) => setTimeout(() => r(null), 3000))]);
            for (const t of (res && res.thumbnail) || []) {
                const key = want.get(t.identifier);
                const b64 = t.data && t.data.imageBuffer;
                if (key && b64) { const buf = Buffer.from(b64, 'base64'); if (buf.length > 64) this.avatars.set(key, buf); }
            }
        } catch (_) { /* no pictures this time */ }
    }

    /** Is this participant you? Google lists you in group chats (and some 1:1s) without isMe. */
    isSelf(c, p) {
        if (!p) return false;
        if (p.isMe) return true;
        const id = p.ID && p.ID.participantID;
        if (id && c && (id === c.defaultOutgoingID || (c.simParticipantMaybe && id === c.simParticipantMaybe.ID))) return true;
        const mine = handleKey(this.phone);
        return !!mine && (handleKey(p.ID && p.ID.number) === mine || handleKey(p.formattedNumber) === mine);
    }

    normalizeChat(c) {
        if (!c) return null;
        if (c.conversationID) this.convs.set(c.conversationID, c);
        const others = (c.participants || []).filter((p) => !this.isSelf(c, p));
        const participants = others.map((p) => {
            const address = (p.ID && p.ID.number) || p.formattedNumber || '';
            return { address, display: this.shownAddress(p), name: this.nameOf(p), business: this.isBusiness(p), service: c.type === 'RCS' ? 'RCS' : 'SMS', photo: this.photoUrl(address) };
        });
        const lm = c.latestMessage || {};
        const last = lm.displayContent != null || c.lastMessageTimestamp ? {
            guid: c.latestMessageID || '', chatGuid: c.conversationID, text: lm.displayContent || '', fromMe: num(lm.fromMe) === 1,
            sender: { address: '', name: lm.displayName || '', me: num(lm.fromMe) === 1 }, date: usToMs(c.lastMessageTimestamp), attachments: [], reactions: []
        } : null;
        return {
            guid: c.conversationID,
            identifier: participants.map((p) => p.address).join(', '),
            title: (c.isGroupChat && c.name) || participants.map((p) => p.name || p.display || p.address).join(', ') || c.name || '',
            photo: participants.length === 1 ? participants[0].photo : null,
            business: participants.length === 1 && participants[0].business,
            named: !!(c.isGroupChat && c.name),
            isGroup: participants.length > 1 || (!!c.isGroupChat && !!c.name),
            participants,
            service: c.type === 'RCS' ? 'RCS' : 'SMS',
            archived: c.status === 'ARCHIVED',
            spam: c.status === 'SPAM_FOLDER' || c.status === 'BLOCKED_FOLDER',
            last,
            unread: !!c.unread
        };
    }

    // ---- reads ----

    async listChats({ limit = 50, offset = 0 } = {}) {
        // Google pages by cursor; offsets past the first page read the whole span again
        const res = await this.call('conversations', { count: Math.min(limit + offset, 200), folder: 'inbox' });
        const raw = (res && res.conversations) || [];
        await this.loadThumbnails(raw.slice(offset, offset + limit));
        const list = raw.map((c) => this.normalizeChat(c));
        return list.slice(offset, offset + limit);
    }

    async getChat(chatGuid) {
        const c = await this.call('conversation', { conversationId: chatGuid });
        return this.normalizeChat(c);
    }

    async listMessages(chatGuid, { limit = 50, before = null } = {}) {
        if (!this.convs.has(chatGuid)) { try { await this.getChat(chatGuid); } catch (_) { /* names stay blank */ } }
        const args = { conversationId: chatGuid, count: limit };
        if (before && typeof before === 'string' && before.startsWith('{')) args.cursor = before;
        const res = await this.call('messages', args);
        const out = ((res && res.messages) || []).map((m) => this.normalizeMessage(m)).filter((m) => !m.groupEvent || m.text);
        for (const m of (res && res.messages) || []) this.seen.set(m.messageID, ((m.messageStatus && m.messageStatus.status) || '') + '|' + JSON.stringify(m.reactions || []));
        out.sort((a, b) => a.date - b.date);
        const cursor = res && res.cursor ? JSON.stringify(res.cursor) : null;
        return { messages: out, more: !!cursor && out.length >= limit, cursor };
    }

    async downloadAttachment(guid, { thumb } = {}) {
        const ref = unb64url(String(guid).replace(/^r/, ''));
        if (!ref || !ref.m) throw Object.assign(new Error('Unknown attachment.'), { code: 'NOT_FOUND', status: 404 });
        const useThumb = thumb && ref.t;
        const file = path.join(this.tmpDir, `dl-${randomUUID()}`);
        await this.call('download', { mediaId: useThumb ? ref.t : ref.m, key: useThumb ? ref.tk : ref.k, path: file }, SEND_TIMEOUT_MS);
        const buf = await fs.promises.readFile(file);
        fs.promises.unlink(file).catch(() => {});
        const type = useThumb ? 'image/jpeg' : (ref.y || 'application/octet-stream');
        // the same face as a fetch Response (textMessagingHttp reads headers + arrayBuffer)
        return {
            headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : (h.toLowerCase() === 'content-disposition' && ref.n ? `inline; filename*=UTF-8''${encodeURIComponent(ref.n)}` : null)) },
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
        };
    }

    // ---- writes ----

    async sendText({ chatGuid, addresses, text, replyTo, tempGuid }) {
        let guid = chatGuid;
        if (!guid) {
            const list = (addresses || []).map((a) => String(a).trim()).filter(Boolean);
            if (!list.length) throw Object.assign(new Error('Who is the message for?'), { code: 'NO_RECIPIENT' });
            const res = await this.call('newChat', { numbers: list });
            const conv = res && res.conversation;
            if (!conv) throw Object.assign(new Error('Google Messages could not start that conversation.'), { code: 'PROVIDER_ERROR' });
            this.normalizeChat(conv);
            guid = conv.conversationID;
        }
        const tmp = tempGuid || `tmp_${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        await this.call('send', { conversationId: guid, text: String(text || ''), replyTo: replyTo || '', tmpId: tmp }, SEND_TIMEOUT_MS);
        return { tempGuid: tmp, chatGuid: guid, message: null };
    }

    async sendAttachment({ chatGuid, name, mime, buffer, replyTo, tempGuid }) {
        await fs.promises.mkdir(this.tmpDir, { recursive: true });
        const file = path.join(this.tmpDir, `up-${randomUUID()}`);
        await fs.promises.writeFile(file, buffer);
        const tmp = tempGuid || `tmp_${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        try {
            await this.call('send', { conversationId: chatGuid, filePath: file, fileName: name || 'attachment', mime: mime || 'application/octet-stream', replyTo: replyTo || '', tmpId: tmp }, SEND_TIMEOUT_MS);
        } finally {
            fs.promises.unlink(file).catch(() => {});
        }
        return { tempGuid: tmp, chatGuid, message: null };
    }

    async react({ chatGuid, messageGuid, reaction, remove, emoji }) {
        const e = emoji || REACTION_EMOJI[String(reaction || '').replace(/^-/, '')];
        if (!e) throw Object.assign(new Error('Unknown reaction.'), { code: 'BAD_REACTION' });
        await this.call('react', { conversationId: chatGuid, messageId: messageGuid, emoji: e, action: remove ? 'remove' : 'add' });
        return { ok: true };
    }

    /** Delete the conversation (in Google Messages on the phone too). */
    async deleteChat({ chatGuid }) {
        const conv = this.convs.get(chatGuid);
        const other = conv ? (conv.participants || []).find((p) => !this.isSelf(conv, p)) : null;
        await this.call('deleteChat', { conversationId: chatGuid, phone: (other && other.ID && other.ID.number) || '' });
        this.convs.delete(chatGuid);
        return { ok: true };
    }

    async edit() { throw Object.assign(new Error('RCS messages cannot be edited.'), { code: 'UNSUPPORTED' }); }

    async unsend() { throw Object.assign(new Error('RCS messages cannot be unsent.'), { code: 'UNSUPPORTED' }); }

    async markRead({ chatGuid }) {
        let conv = this.convs.get(chatGuid);
        if (!conv) { try { await this.getChat(chatGuid); conv = this.convs.get(chatGuid); } catch (_) { conv = null; } }
        const messageId = conv && conv.latestMessageID;
        if (!messageId) return { ok: false };
        await this.call('markRead', { conversationId: chatGuid, messageId });
        return { ok: true };
    }

    async typing({ chatGuid, typing }) {
        if (!typing) return { ok: true };
        await this.call('typing', { conversationId: chatGuid });
        return { ok: true };
    }

    // ---- pairing ----

    async pair() {
        const res = await this.call('login', {});
        this.qr = (res && res.qr) || '';
        this.setStatus('pairing', '');
        return { qr: this.qr };
    }

    /** Google account pairing with a signed-in session's cookies: -> { emoji } to tap on the phone. */
    async pairGoogle(cookies) {
        let res;
        try {
            res = await this.call('loginGoogle', { cookies }, 120000);
        } catch (error) {
            const m = /^(BAD_COOKIES|NO_DEVICES|PHONE_TIMEOUT): (.*)$/.exec(error.message || '');
            if (m) throw Object.assign(new Error(m[2]), { code: m[1] });
            throw error;
        }
        this.emoji = (res && res.emoji) || '';
        this.setStatus('pairing', '');
        return { emoji: this.emoji };
    }

    async refreshQr() { const res = await this.call('refreshQr', {}); this.qr = (res && res.qr) || ''; return { qr: this.qr }; }

    async unpair() { await this.call('logout', {}); this.loggedIn = false; this.phone = ''; this.setStatus('unpaired', 'Not paired with Google Messages.'); return { ok: true }; }

    async test() { return this.call('status', {}); }
}

module.exports = { RcsProvider, usToMs, b64url, unb64url };
