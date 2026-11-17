/**
 * Text Messaging: Android app accounts (Yozora #885). Yukimi, Nov 16 2026: "add support to messaging to
 * add a android app where it will appear in texts today item and will show its notifications as messages
 * on the list, if they support quick reply handle sending replys aswell as the other actions on the
 * notifications. example app is discord".
 *
 * An account names one Android package (Discord = com.discord). The partnered phone relays its
 * notifications over ActiveSync when "Send notifications" is on (DSApp ActiveSyncNotifications,
 * events notify.posted / notify.removed). A posted notification of that package becomes messages in a
 * conversation of the account:
 *
 *   conversation   the notification's MessagingStyle conversation (its shortcut id, else its conversation
 *                  title), else the notification's title. One chat each, kept in textmessaging.db.
 *   messages       each MessagingStyle line (sender, text, time; a line with no sender is yours), else the
 *                  notification's own title / text. The same line posted again is the same message.
 *   quick reply    the notification's RemoteInput action: send() calls the device op notify.reply
 *                  { key, action, text } on the phone that posted it, while the phone still shows it.
 *   actions        every other action of the notification (Mark as read, Mute, ...) is listed on the
 *                  chat (chat.actions) and run with action() = device op notify.action { key, action }.
 *   read           markRead() runs the app's own Mark as read action, else dismisses the notification.
 *                  A notification removed on the phone (read in the app, swiped) marks the chat read.
 *
 * The phone already shows the app's own notification, so these accounts never post Android notifications
 * of their own (textMessagingPhone / the inbox skip kind 'android'), and the shell's New Text Message
 * notice is off unless the account's Notify switch is on.
 *
 * Every app that posted a notification lately is remembered (recentApps(): package, label, icon) so an
 * account can be added from a list. State beside the store: .cache/textmessaging-android.json and
 * .cache/textmessaging-android/<package>.png (app icons), <account>/<chat>.png (conversation pictures).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACKAGE_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;
const MAX_RECENT = 60;
const RECENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_MATCH_MS = 10 * 60 * 1000;
const SEMANTIC_MARK_AS_READ = 2;
const CALL_MS = 15000;

const providers = new Set();
const caughtUp = new Set(); // device ids read with notify.list since this server started
let tapped = false;
let gr = null;
let cacheDir = null;
let recent = null; // { pkg: { label, at, icon: bool } }
let recentTimer = null;

function resources() {
    if (!gr) gr = require('./globalResources');
    return gr;
}

function activeSync() { return require('./activeSync'); }

function dir() {
    if (cacheDir) return cacheDir;
    let d = null;
    try { d = resources().getPath('cache'); } catch (_) { d = null; }
    cacheDir = d || path.join(__dirname, '..', '.cache');
    return cacheDir;
}

const hash = (s, n = 20) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);

function dataUrlBytes(url) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    return buf.length && buf.length < 256 * 1024 ? buf : null;
}

function writeFileQuiet(file, buf) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
        return true;
    } catch (error) {
        console.warn(`[textMessaging:android] ${path.basename(file)}: ${error.message}`);
        return false;
    }
}

// ---------------------------------------------------------------- apps that posted lately

function recentFile() { return path.join(dir(), 'textmessaging-android.json'); }
function iconFile(pkg) { return path.join(dir(), 'textmessaging-android', `${pkg}.png`); }

function loadRecent() {
    if (recent) return recent;
    try {
        const d = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
        recent = d && typeof d.apps === 'object' && d.apps ? d.apps : {};
    } catch (_) { recent = {}; }
    return recent;
}

function saveRecent() {
    clearTimeout(recentTimer);
    recentTimer = setTimeout(() => {
        try { fs.writeFileSync(recentFile(), JSON.stringify({ apps: recent })); } catch (error) { console.warn(`[textMessaging:android] recent save failed: ${error.message}`); }
    }, 3000);
    if (recentTimer.unref) recentTimer.unref();
}

function noteApp(d) {
    const pkg = String(d.package || '');
    const r = loadRecent();
    const label = str(d.app || pkg, 80);
    const was = r[pkg];
    let icon = !!(was && was.icon);
    if (d.icon) { const buf = dataUrlBytes(d.icon); if (buf && writeFileQuiet(iconFile(pkg), buf)) icon = true; }
    if (was && was.label === label && was.icon === icon && Date.now() - was.at < 60 * 60 * 1000) return;
    r[pkg] = { label, at: Date.now(), icon };
    const keys = Object.keys(r);
    const now = Date.now();
    keys.forEach((k) => { if (now - r[k].at > RECENT_KEEP_MS) delete r[k]; });
    const left = Object.keys(r).sort((a, b) => r[b].at - r[a].at);
    left.slice(MAX_RECENT).forEach((k) => delete r[k]);
    saveRecent();
}

/** Apps that posted a notification lately, newest first: [{ package, label, at, icon }]. */
function recentApps() {
    const r = Object.assign({}, loadRecent());
    // Melaton Videos (#861) keeps every app that posted lately too: its list fills ours (before our first post)
    try {
        const v = JSON.parse(fs.readFileSync(path.join(dir(), 'videos-sources.json'), 'utf8'));
        const seen = (v && v.seenApps) || {};
        Object.keys(seen).forEach((pkg) => {
            if (!r[pkg] && PACKAGE_RE.test(pkg) && seen[pkg] && Date.now() - Number(seen[pkg].at) < RECENT_KEEP_MS) r[pkg] = { label: str(seen[pkg].label || pkg, 80), at: Number(seen[pkg].at) || 0, icon: fs.existsSync(iconFile(pkg)) };
        });
    } catch (_) { /* no Videos state */ }
    return Object.keys(r).sort((a, b) => r[b].at - r[a].at)
        .map((pkg) => ({ package: pkg, label: r[pkg].label, at: r[pkg].at, icon: r[pkg].icon ? `/api/textmessaging/android-icon/${encodeURIComponent(pkg)}` : '' }));
}

function appLabel(pkg) { const r = loadRecent()[pkg]; return r ? r.label : ''; }

/** The app's icon (PNG bytes) or null. */
function appIcon(pkg) {
    if (!PACKAGE_RE.test(String(pkg || ''))) return null;
    try { return fs.readFileSync(iconFile(pkg)); } catch (_) { return null; }
}

// ---------------------------------------------------------------- the phone's events

function tap() {
    if (tapped) return;
    tapped = true;
    // a phone that (re)connects: what it shows now, once its link is up (a restart, an app update)
    const as = activeSync();
    if (typeof as.onDeviceHello === 'function') {
        as.onDeviceHello((d) => {
            if (!d || d.speaker !== 'service' || d.session !== 'partner') return;
            caughtUp.add(d.id);
            const t = setTimeout(() => { for (const p of providers) p.syncDevice(d.id, d.name); }, 5000);
            if (t.unref) t.unref();
        });
    }
    as.onDeviceEvent((name, detail, device) => {
        // the first news from a phone since this server started: it may have connected before the
        // accounts listened (a restart race), so what it shows now is read once
        const id = device && device.id;
        if (id && !caughtUp.has(id)) {
            caughtUp.add(id);
            for (const p of providers) void p.syncDevice(id, device.name);
        }
        if (!detail || typeof detail !== 'object') return;
        if (name === 'notify.posted' && PACKAGE_RE.test(String(detail.package || ''))) {
            noteApp(detail);
            for (const p of providers) if (p.pkg === detail.package) p.take(detail, device && device.id, device && device.name);
        } else if (name === 'notify.removed' && detail.key) {
            for (const p of providers) p.removed(String(detail.key));
        }
    });
}

// ---------------------------------------------------------------- the provider

class AndroidAppProvider {
    constructor(account, hooks) {
        this.id = account.id;
        this.pkg = String(account.package || '');
        this.label = String(account.label || appLabel(this.pkg) || this.pkg);
        this.hooks = hooks || {};
        this.status = 'connecting';
        this.error = '';
        this.device = '';
        this.deviceName = '';
        this.store = null;
    }

    get kind() { return 'android'; }

    identity() { return this.deviceName || ''; }

    features() {
        // reply = a reply to one message (threads); quickReply = the notification's own reply
        return { privateApi: false, attachments: false, tapbacks: false, edit: false, unsend: false, reply: false, quickReply: true, typing: false, readReceipts: false, newChat: false, effects: false, pairing: false, deleteChat: true, actions: true };
    }

    log(m) { if (this.hooks.log) this.hooks.log(m); else console.warn(`[textMessaging:android] ${m}`); }

    emit(event, payload) { if (this.hooks.emit) this.hooks.emit(event, Object.assign({ accountId: this.id }, payload || {})); }

    async start() {
        if (!PACKAGE_RE.test(this.pkg)) { this.status = 'error'; this.error = 'No Android app was chosen for this account.'; return; }
        tap();
        providers.add(this);
        this.status = 'connected';
        this.emit('account', {});
        // what the phone shows now (a reply the server missed while it restarted)
        const t = setTimeout(() => this.startSync(), 8000);
        if (t.unref) t.unref();
    }

    stop() { providers.delete(this); }

    /** What the partnered phones show now (notify.list), taken like new posts. */
    startSync() {
        if (this.syncing || !providers.has(this)) return;
        this.syncing = true;
        (async () => {
            let links = [];
            try { links = activeSync().partnerLinks(resources(), null); } catch (_) { links = []; }
            for (const l of links) await this.syncDevice(l.deviceId, l.name);
        })().finally(() => { this.syncing = false; });
    }

    /**
     * One phone's notifications of this app now. Lines that are new count as arrivals (the server or
     * the phone was away when they came); what is already stored is not announced again.
     */
    async syncDevice(deviceId, deviceName) {
        if (!providers.has(this)) return;
        try {
            const res = await activeSync().serverCall(resources(), null, deviceId, 'notify.list', {}, { timeoutMs: CALL_MS });
            for (const n of (res && res.notifications) || []) if (n && n.package === this.pkg) this.take(n, deviceId, deviceName);
        } catch (_) { /* that phone does not send notifications */ }
    }

    // ---- taking a notification ----

    chatGuidOf(d) {
        const c = d.conv && typeof d.conv === 'object' ? d.conv : {};
        const basis = c.shortcut || c.title || d.title || d.app || this.pkg;
        return `a${hash(`${this.pkg}|${basis}`)}`;
    }

    rawChat(guid) {
        const r = this.store && this.store.getChat(this.id, guid);
        return r ? r.raw : null;
    }

    putChat(raw) {
        if (!this.store) return;
        try { this.store.putChats(this.id, [{ guid: raw.guid, raw, lastDate: raw.lastDate || 0 }]); } catch (error) { this.log(`store write failed: ${error.message}`); }
    }

    /** The lines in a posted notification: [{ text, time, sender, senderKey, me }], oldest first. */
    linesOf(d) {
        const out = [];
        if (Array.isArray(d.messages) && d.messages.length) {
            for (const m of d.messages.slice(-25)) {
                if (!m || typeof m !== 'object') continue;
                const text = str(m.text, 2000).trim();
                if (!text) continue;
                out.push({ text, time: Number(m.time) || Number(d.time) || Date.now(), sender: str(m.sender, 120), senderKey: str(m.senderKey || m.sender, 200), me: m.me === true, styled: true });
            }
        }
        if (!out.length) {
            const text = str(d.text, 2000).trim();
            const title = str(d.title, 200).trim();
            if (!text && !title) return out;
            out.push({ text: text || title, time: Number(d.time) || Date.now(), sender: text ? title : '', senderKey: text ? title : '', me: false, styled: false, key: String(d.key || '') });
        }
        return out;
    }

    take(d, deviceId, deviceName, { old = false } = {}) {
        if (!this.store) return;
        const guid = this.chatGuidOf(d);
        const prev = this.rawChat(guid);
        const conv = d.conv && typeof d.conv === 'object' ? d.conv : {};
        const isGroup = conv.group === true;
        const lines = this.linesOf(d);
        if (!lines.length) return;
        const actions = (Array.isArray(d.actions) ? d.actions : []).filter((a) => a && Number.isInteger(a.i) && a.title).slice(0, 8)
            .map((a) => ({ i: a.i, title: str(a.title, 60), reply: a.reply === true, semantic: Number(a.semantic) || 0 }));
        const replyAction = actions.find((a) => a.reply);
        const chat = Object.assign({ readAt: 0, lastDate: 0 }, prev || {}, {
            guid,
            package: this.pkg,
            app: str(d.app || this.label, 80),
            title: str(conv.title || (isGroup ? '' : (lines.find((l) => !l.me) || {}).sender) || d.title || d.app || this.label, 200),
            sub: str(d.sub, 120),
            isGroup,
            key: str(d.key, 300),
            device: String(deviceId || (prev && prev.device) || ''),
            actions,
            reply: replyAction ? replyAction.i : null
        });
        if (deviceId) { this.device = String(deviceId); if (deviceName) this.deviceName = String(deviceName); }
        if (d.avatar) {
            const buf = dataUrlBytes(d.avatar);
            if (buf && writeFileQuiet(this.avatarFile(guid), buf)) chat.photo = Date.now();
        }

        // the lines not stored yet
        const rows = lines.map((l) => {
            const id = l.styled ? `${guid}|${l.time}|${l.senderKey}|${l.text}` : `${guid}|${l.key}|${l.text}`;
            return Object.assign({ guid: `a${hash(id, 24)}` }, l);
        });
        const have = this.store.getMessages(this.id, rows.map((r) => r.guid));
        const fresh = rows.filter((r) => !have.has(r.guid));
        // your reply from here comes back in the app's next notification: it is the one already shown
        const kept = [];
        for (const r of fresh) {
            if (r.me) {
                const local = this.localMatch(guid, r);
                if (local) continue;
            }
            kept.push(r);
        }
        const msgs = kept.map((r) => ({ guid: r.guid, chatGuid: guid, text: r.text, date: r.time, fromMe: r.me, sender: r.me ? 'Me' : r.sender, senderKey: r.me ? '' : r.senderKey }));
        if (msgs.length) {
            try { this.store.putMessages(this.id, msgs.map((m) => ({ guid: m.guid, chatGuid: guid, date: m.date, text: m.text, raw: m }))); } catch (error) { this.log(`store write failed: ${error.message}`); }
        }
        const newest = msgs.reduce((a, m) => (!a || m.date >= a.date ? m : a), null);
        if (newest && newest.date >= (chat.lastDate || 0)) {
            chat.lastDate = newest.date;
            chat.lastText = newest.text;
            chat.lastFromMe = newest.fromMe;
            chat.lastSender = newest.sender;
            chat.lastGuid = newest.guid;
        }
        // a notification shown again after it was read is a new arrival only for lines newer than the read
        this.putChat(chat);
        if (!prev) this.emit('chat', { chatGuid: guid });
        for (const m of msgs.sort((a, b) => a.date - b.date)) {
            if (old || (chat.readAt && m.date <= chat.readAt)) continue;
            this.emit('message', { chatGuid: guid, message: this.normalizeMessage(m), chat });
        }
        if (prev && (prev.key !== chat.key || JSON.stringify(prev.actions) !== JSON.stringify(chat.actions))) this.emit('chat', { chatGuid: guid });
    }

    localMatch(chatGuid, r) {
        const rows = this.store.listMessages(this.id, chatGuid, { limit: 20 });
        return rows.find((m) => m.local && m.fromMe && m.text === r.text && Math.abs((m.date || 0) - r.time) < LOCAL_MATCH_MS) || null;
    }

    /** The phone no longer shows that notification: read in the app, swiped, or answered. */
    removed(key) {
        if (!this.store) return;
        for (const row of this.store.listChats(this.id, { limit: 200 })) {
            const c = row.raw;
            if (!c || c.key !== key) continue;
            c.key = '';
            c.reply = null;
            c.actions = [];
            const wasUnread = this.isUnread(c);
            if (wasUnread) c.readAt = Math.max(c.lastDate || 0, Date.now());
            this.putChat(c);
            this.emit(wasUnread ? 'read' : 'chat', { chatGuid: c.guid, read: true });
        }
    }

    // ---- shapes ----

    avatarFile(chatGuid) { return path.join(dir(), 'textmessaging-android', this.id, `${String(chatGuid).replace(/[^a-z0-9]/gi, '')}.png`); }

    contactAvatar(key) {
        if (key === 'app') return appIcon(this.pkg);
        try { return fs.readFileSync(this.avatarFile(key)); } catch (_) { return null; }
    }

    isUnread(c) { return !!c && !c.lastFromMe && (c.lastDate || 0) > (c.readAt || 0); }

    normalizeMessage(m) {
        return {
            guid: m.guid,
            chatGuid: m.chatGuid,
            text: m.text || '',
            subject: '',
            fromMe: !!m.fromMe,
            sender: m.fromMe ? { address: '', name: 'Me', me: true } : { address: m.senderKey || m.sender || '', name: m.sender || '', me: false },
            date: m.date || 0,
            dateDelivered: null,
            dateRead: null,
            dateEdited: null,
            retracted: false,
            error: 0,
            service: this.label,
            replyTo: null,
            effect: null,
            groupEvent: null,
            attachments: [],
            reactions: []
        };
    }

    normalizeChat(c) {
        if (!c) return null;
        const base = `/api/textmessaging/${encodeURIComponent(this.id)}/avatar/`;
        const photo = c.photo ? `${base}${encodeURIComponent(c.guid)}?v=${c.photo}` : `${base}app`;
        const name = c.title || c.app || this.label;
        const last = c.lastDate ? {
            guid: c.lastGuid || '', chatGuid: c.guid, text: c.lastText || '', fromMe: !!c.lastFromMe,
            sender: { address: '', name: c.lastFromMe ? 'Me' : (c.lastSender || ''), me: !!c.lastFromMe }, date: c.lastDate, attachments: [], reactions: []
        } : null;
        const unread = this.isUnread(c);
        return {
            guid: c.guid,
            identifier: c.sub || c.app || this.label,
            title: name,
            photo,
            named: true,
            isGroup: !!c.isGroup,
            participants: [{ address: c.guid, display: name, name, service: this.label, photo }],
            service: this.label,
            archived: false,
            spam: false,
            last,
            unread,
            readSince: unread ? (c.readAt || 0) : null,
            // what the notification on the phone offers now (gone with the notification)
            canReply: c.reply != null && !!c.key,
            actions: c.key ? (c.actions || []).filter((a) => !a.reply).map((a) => ({ id: a.i, title: a.title })) : [],
            sub: c.sub || ''
        };
    }

    // ---- reads ----

    async listChats({ limit = 50, offset = 0 } = {}) {
        if (!this.store) return [];
        return this.store.listChats(this.id, { limit, offset }).map((r) => this.normalizeChat(r.raw));
    }

    async getChat(chatGuid) { return this.normalizeChat(this.rawChat(chatGuid)); }

    async listMessages(chatGuid, { limit = 50, before = null } = {}) {
        if (!this.store) return { messages: [], more: false, cursor: null };
        const b = before != null && /^\d+$/.test(String(before)) ? Number(before) : null;
        const rows = this.store.listMessages(this.id, chatGuid, { limit: limit + 1, before: b });
        const page = rows.slice(0, limit);
        const out = page.map((m) => this.normalizeMessage(m)).sort((a, c) => a.date - c.date);
        const oldest = page.length ? Math.min(...page.map((m) => m.date || 0)) : null;
        return { messages: out, more: rows.length > limit, cursor: oldest ? String(oldest) : null };
    }

    async countIncoming(chatGuid, since) {
        return this.store.listMessages(this.id, chatGuid, { limit: 99 }).filter((m) => !m.fromMe && (m.date || 0) > (Number(since) || 0)).length;
    }

    async searchMessages(q, { limit = 40 } = {}) {
        if (!this.store) return [];
        return this.store.search(q, { account: this.id, limit }).map((r) => this.normalizeMessage(r.raw)).filter((m) => m.text);
    }

    // ---- writes ----

    deviceOf(c) {
        const id = (c && c.device) || this.device;
        if (!id) throw Object.assign(new Error(`${this.label} has not sent a notification from the phone yet.`), { code: 'NO_DEVICE' });
        return id;
    }

    async sendText({ chatGuid, addresses, text, tempGuid }) {
        if (!chatGuid) {
            void addresses;
            throw Object.assign(new Error(`New conversations cannot be started here. Start it in ${this.label} on the phone.`), { code: 'UNSUPPORTED' });
        }
        const c = this.rawChat(chatGuid);
        if (!c) throw Object.assign(new Error('That conversation is not here any more.'), { code: 'NOT_FOUND' });
        if (c.reply == null || !c.key) throw Object.assign(new Error(`${this.label} does not offer a reply to this conversation now. Reply in ${this.label} on the phone.`), { code: 'NO_REPLY' });
        const body = String(text || '').trim();
        if (!body) throw Object.assign(new Error('Type a message.'), { code: 'EMPTY' });
        await activeSync().serverCall(resources(), null, this.deviceOf(c), 'notify.reply', { key: c.key, action: c.reply, text: body }, { timeoutMs: CALL_MS });
        const now = Date.now();
        const m = { guid: `l${hash(`${chatGuid}|${now}|${body}`, 24)}`, chatGuid, text: body, date: now, fromMe: true, sender: 'Me', senderKey: '', local: true };
        try { this.store.putMessages(this.id, [{ guid: m.guid, chatGuid, date: now, text: body, raw: m }]); } catch (error) { this.log(`store write failed: ${error.message}`); }
        Object.assign(c, { lastDate: now, lastText: body, lastFromMe: true, lastSender: 'Me', lastGuid: m.guid, readAt: now });
        this.putChat(c);
        const message = this.normalizeMessage(m);
        this.emit('message', { chatGuid, message, chat: c });
        return { tempGuid: tempGuid || m.guid, chatGuid, message };
    }

    async sendAttachment() { throw Object.assign(new Error(`Pictures and files cannot be sent to ${this.label} from here.`), { code: 'UNSUPPORTED' }); }

    /** One of the notification's own actions (chat.actions[].id). */
    async action({ chatGuid, action }) {
        const c = this.rawChat(chatGuid);
        const a = c && c.key && (c.actions || []).find((x) => x.i === Number(action));
        if (!a) throw Object.assign(new Error('The notification on the phone no longer offers that.'), { code: 'NO_ACTION' });
        await activeSync().serverCall(resources(), null, this.deviceOf(c), 'notify.action', { key: c.key, action: a.i }, { timeoutMs: CALL_MS });
        if (a.semantic === SEMANTIC_MARK_AS_READ && this.isUnread(c)) {
            c.readAt = Date.now();
            this.putChat(c);
            this.emit('read', { chatGuid, read: true });
        }
        return { ok: true };
    }

    async markRead({ chatGuid }) {
        const c = this.rawChat(chatGuid);
        if (!c) return { ok: false };
        const was = this.isUnread(c);
        c.readAt = Math.max(Date.now(), c.lastDate || 0);
        this.putChat(c);
        // the phone follows: the app's own Mark as read, else its notification goes
        if (was && c.key && c.device) {
            const mark = (c.actions || []).find((x) => x.semantic === SEMANTIC_MARK_AS_READ);
            const op = mark ? 'notify.action' : 'notify.dismiss';
            const args = mark ? { key: c.key, action: mark.i } : { key: c.key };
            activeSync().serverCall(resources(), null, c.device, op, args, { timeoutMs: CALL_MS }).catch((error) => this.log(`${op}: ${error.message}`));
        }
        return { ok: true };
    }

    async markUnread() { return { ok: true }; }

    async typing() { return { ok: true }; }

    async react() { throw Object.assign(new Error('Reactions cannot be sent to an Android app from here.'), { code: 'UNSUPPORTED' }); }

    async edit() { throw Object.assign(new Error('Messages cannot be edited here.'), { code: 'UNSUPPORTED' }); }

    async unsend() { throw Object.assign(new Error('Messages cannot be unsent here.'), { code: 'UNSUPPORTED' }); }

    async deleteChat({ chatGuid }) {
        if (this.store) this.store.deleteChat(this.id, chatGuid);
        try { fs.unlinkSync(this.avatarFile(chatGuid)); } catch (_) { /* none */ }
        return { ok: true };
    }

    async downloadAttachment() { throw Object.assign(new Error('Unknown attachment.'), { code: 'NOT_FOUND', status: 404 }); }

    async test() { return { ok: true }; }
}

function _reset() { providers.clear(); caughtUp.clear(); recent = null; cacheDir = null; tapped = false; }

module.exports = { AndroidAppProvider, recentApps, appIcon, appLabel, PACKAGE_RE, _reset, _setCacheDir: (d) => { cacheDir = d; } };
