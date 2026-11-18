'use strict';

/**
 * "New" mail and texts for the status bar's envelope icons (StaticForge #907 / #908, Yukimi, Nov 17 2026: the envelope
 * stays until you open the messages, as on Windows Mobile, and the page and the native bar must agree).
 *
 * Before this, the Melaton Mobile page kept "new since this page started" in memory (lost on every restart) and the
 * phone app's status-bar task, with the page asleep, could only see waiting notices. Now the server keeps it, per user,
 * in the notification inbox's prefs (survives restarts), and both read the same answer:
 *
 *   mail  new while an unread inbox message (the household mailbox, IMAP inboxes) came in after Messaging's mail was
 *         last opened on a phone (seenAt)
 *   sms   new while a conversation that got an incoming text since Text Messaging was last opened is still unread
 *         (reading it takes it off; no unread texts at all clears them)
 *
 * Opening the mail or Text Messaging on a phone page sends msg_new_seen { cls } (seen()). Changes go to the phones'
 * background links (phoneStatus snapshot: mail.new / sms.new) and to the user's pages (ws msg_new_state).
 */

const MAX_CHATS = 200;
let started = false;
let last = { mail: null, sms: null };
let computing = false;
let again = false;
let timer = null;

const safe = (fn, fallback) => { try { return fn(); } catch (_e) { return fallback; } };
const inbox = () => require('./notificationInbox');
const USER = 'admin';

function readChats() {
    const v = safe(() => JSON.parse(inbox().getPref(USER, 'new.smsChats') || '[]'), []);
    return Array.isArray(v) ? v : [];
}
function writeChats(list) { safe(() => inbox().setPref(USER, 'new.smsChats', JSON.stringify(list.slice(-MAX_CHATS))), false); }

function seenAt(cls) {
    const v = Number(safe(() => inbox().getPref(USER, `new.${cls}SeenAt`), '')) || 0;
    if (v) return v;
    // the first run: what is already there is not new
    const now = Date.now();
    safe(() => inbox().setPref(USER, `new.${cls}SeenAt`, String(now)), false);
    return now;
}

function mailNew() {
    const since = seenAt('mail');
    const dm = safe(() => require('./dovecoteMail'), null);
    if (dm) {
        const list = safe(() => dm.listMail(dm.HUMAN_OWNER, { folder: 'inbox', unreadOnly: true, limit: 1, silent: true }), []);
        const t = list && list[0] ? Date.parse(list[0].createdAt) || Number(list[0].createdAt) || 0 : 0;
        if (t > since) return true;
    }
    const ma = safe(() => require('./mailAccounts'), null);
    if (ma) {
        for (const a of safe(() => ma.unreadSummary(), [])) {
            if (!a || !(a.unread > 0)) continue;
            const r = safe(() => ma.listMessages(a.id, 'INBOX', { limit: 1, unseenOnly: true }), null);
            const m = r && r.messages && r.messages[0];
            const t = m ? (typeof m.date === 'number' ? m.date : Date.parse(m.date)) || 0 : 0;
            if (t > since) return true;
        }
    }
    return false;
}

async function smsUnreadTotal() {
    try {
        const list = await require('./textMessaging').summary();
        return (list || []).reduce((s, a) => s + (Number(a && a.unread) || 0), 0);
    } catch (_e) { return 0; }
}

async function compute() {
    const mail = mailNew();
    let chats = readChats();
    if (chats.length && !(await smsUnreadTotal() > 0)) { chats = []; writeChats(chats); }
    return { mail, sms: chats.length > 0 };
}

function broadcast(state) {
    safe(() => inbox().broadcast(USER, { type: 'msg_new_state', data: state }), null);
}

async function run() {
    if (computing) { again = true; return; }
    computing = true;
    try {
        const s = await compute();
        if (s.mail !== last.mail || s.sms !== last.sms) {
            last = s;
            broadcast(s);
            safe(() => require('./phoneStatus').touch('new'), null);
        }
    } catch (e) {
        console.warn(`[message-new] ${e.message}`);
    } finally {
        computing = false;
        if (again) { again = false; soon(); }
    }
}

/** Something the answer reads changed (mail arrived or was read, a text, a read): worked out within a second. */
function soon() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; void run(); }, 1000);
    if (timer.unref) timer.unref();
}

function onText(ev) {
    if (!ev || !ev.chatGuid) return;
    const key = `${ev.accountId}|${ev.chatGuid}`;
    if (ev.event === 'message') {
        const m = ev.message;
        if (!m || m.fromMe || m.groupEvent) return;
        const chats = readChats();
        if (!chats.includes(key)) { chats.push(key); writeChats(chats); }
    } else if (ev.event === 'read' && ev.read !== false) {
        const chats = readChats();
        const i = chats.indexOf(key);
        if (i >= 0) { chats.splice(i, 1); writeChats(chats); }
    } else return;
    soon();
}

function start() {
    if (started) return module.exports;
    started = true;
    try { require('./textMessaging').onEvent(onText); } catch (_e) { /* no Text Messaging */ }
    soon();
    return module.exports;
}

/** The user opened the mail ('mail') or Text Messaging ('sms') on a phone: what is there now is not new any more. */
function seen(cls) {
    if (cls === 'mail') safe(() => inbox().setPref(USER, 'new.mailSeenAt', String(Date.now())), false);
    else if (cls === 'sms') writeChats([]);
    else return false;
    soon();
    return true;
}

/** The last answer (null before the first one). */
function state() { return { mail: !!last.mail, sms: !!last.sms, known: last.mail !== null }; }

module.exports = { start, soon, seen, state, _compute: compute };
