'use strict';

/**
 * Notification inbox sources (Yozora #876): the server raises the phone's notifications itself, at the
 * point it learns of the event, so they reach the phone when Melaton Mobile's page is not running
 * (notificationInbox.publish -> activeSync inbox.notice -> the app posts an Android notification).
 *
 * The page keeps raising its own live WM notification as before; both use the same id per thing, so
 * the inbox copy of a live one is only marked seen (wmNotificationInbox), the catch-up after a cold
 * start goes into the app's own grouped notification, and reading or dismissing it anywhere clears the
 * inbox notice (and the phones' Android copy: activeSync inbox.cleared).
 *
 * Ids (shared with the page: public/scripts/comp/wmMessaging.js, wmChat.js, weatherAlerts.js):
 *   mail:<account>:<folder>:<uid>     New E-mail Message (an IMAP account's new mail, notify on)
 *   dmail:<message id>                New E-mail Message (the household's own Dovecote mailbox)
 *   sms:<account>:<chatGuid>          New Text Message (the conversation's newest line)
 *   tm-signin:<account>               Text messages stopped (RCS pairing ended / signed out)
 *   chat:<chatId>                     Dreamscape Messenger: a persona's reply to the phone
 *   director:<sessionId>:turn         Director: the turn is finished
 *   print:<jobId>                     DreamStudio: a print the phone asked for failed (a finished print
 *                                     raises nothing: Yukimi, Nov 22 2026, #1040)
 *   wx:<placeId>:<alertId>            a weather alert for Home / Work
 *   rain:<placeId>                    the rain alarm for Home / Work
 *
 * Titles and texts are the page's own (WM wording); data names the app and what to open on a tap.
 */

const inbox = require('./notificationInbox');

const clip = (s, n) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};
const DAY = 24 * 60 * 60 * 1000;

function publish(notice) {
    try { return inbox.publish(notice); } catch (e) { console.warn(`[notify-inbox] ${notice && notice.id}: ${e.message}`); return null; }
}
function clear(user, id) {
    try { return inbox.clear(user || 'admin', id, 'server'); } catch (_e) { return false; }
}

// ---------------------------------------------------------------- mail (mailAccounts ma_event)

/** "Name" <a@b> -> Name (wmMessaging headerName). */
function headerName(label) {
    const t = String(label || '').trim();
    const m = t.match(/^"?([^"<]*?)"?\s*<[^>]*>$/);
    return (m && m[1].trim()) || t;
}

const mailId = (accountId, folder, uid) => `mail:${accountId}:${folder || 'INBOX'}:${uid}`;

/** mailAccounts.broadcast(payload): new mail notifies; read or removed mail clears. */
function onMailEvent(p) {
    if (!p || !p.accountId) return;
    const folder = p.folder || 'INBOX';
    if (p.event === 'new' && p.notify === true && p.message && !p.message.seen) {
        const m = p.message;
        const f = Array.isArray(m.from) && m.from[0] ? m.from[0] : null;
        const from = (f && (f.name || f.address)) || headerName(m.sender) || '';
        const subject = m.subject || '(no subject)';
        const uid = m.uid != null ? m.uid : (Array.isArray(p.uids) ? p.uids[0] : null);
        if (uid == null) return;
        // outres 33323 "New E-mail Message"; the note's lines: "From: <sender>", the subject
        publish({
            app: 'messaging',
            id: mailId(p.accountId, m.folder || folder, uid),
            cls: 'mail',
            title: 'New E-mail Message',
            text: `From: ${from}\n${subject}`,
            actions: ['view'],
            data: { app: 'messaging', kind: 'mail', accountId: p.accountId, folder: m.folder || folder, uid, from, subject },
            ttlMs: 7 * DAY,
        });
        return;
    }
    if (p.event === 'flags' && p.flags && typeof p.flags === 'object') {
        for (const [uid, flags] of Object.entries(p.flags)) {
            if (Array.isArray(flags) && flags.includes('\\Seen')) clear('admin', mailId(p.accountId, folder, uid));
        }
        return;
    }
    if (p.event === 'removed' && Array.isArray(p.uids)) {
        p.uids.forEach((uid) => clear('admin', mailId(p.accountId, folder, uid)));
        return;
    }
    if (p.event === 'account' && p.deleted) {
        try { inbox.clearWhere('admin', `mail:${p.accountId}:`, 'server'); } catch (_e) { /* best effort */ }
    }
}

// ---------------------------------------------------------------- Dovecote mail (the household's own mailbox, #908)
//
// The phone's mailbox is the human owner's (dovecoteMail.HUMAN_OWNER, the page's Messaging > Dreamscape). A delivery to
// its inbox (dovecoteMailboxEvents mailbox_new_mail) is a New E-mail Message on the phone, page or no page; read,
// archived, deleted or marked spam anywhere clears it. id dmail:<message id>.

const dmailId = (id) => `dmail:${id}`;
let dovecoteBound = false;

function onDovecoteNewMail(event) {
    if (!event || !event.id) return;
    let human = 'yukimi';
    try { human = require('./dovecoteMail').HUMAN_OWNER || human; } catch (_e) { /* default */ }
    if (event.mailbox !== human) return;
    const from = headerName(event.from) || 'Unknown sender';
    const subject = event.subject || '(no subject)';
    publish({
        app: 'messaging',
        id: dmailId(event.id),
        cls: 'mail',
        title: 'New E-mail Message',
        text: `From: ${from}\n${subject}`,
        actions: ['view'],
        data: { app: 'messaging', kind: 'dovecote', id: event.id, from, subject },
        ttlMs: 7 * DAY,
    });
}

function onDovecoteDone(id) {
    if (id != null) clear('admin', dmailId(id));
}

/** Listen to the household mailbox's deliveries (once; the inbox handler binds it at start). */
function bindDovecote() {
    if (dovecoteBound) return;
    dovecoteBound = true;
    try { require('./dovecoteMailboxEvents').subscribe(onDovecoteNewMail); } catch (e) { console.warn(`[notify-inbox] dovecote: ${e.message}`); }
    sweepDovecote();
}

/**
 * A notice left for mail already read or moved out of the inbox goes (once, at start): opening a message did not
 * clear it before #999, and the status bar's envelope stood for it with no unread mail (Yukimi, Nov 20).
 */
function sweepDovecote() {
    let dm = null;
    try { dm = require('./dovecoteMail'); } catch (_e) { return 0; }
    let rows = [];
    try { rows = inbox.list('admin').filter((n) => n.id.startsWith('dmail:') && (n.state === 'new' || n.state === 'seen')); } catch (_e) { return 0; }
    if (!rows.length) return 0;
    let still = null;
    try { still = dm.unreadInboxIds(dm.HUMAN_OWNER || 'yukimi', rows.map((n) => n.id.slice(6))); } catch (_e) { return 0; }
    let gone = 0;
    for (const n of rows) if (!still.has(n.id.slice(6))) { clear('admin', n.id); gone += 1; }
    return gone;
}

// ---------------------------------------------------------------- server-only notices (#908)
//
// Things only the page told of before (its own toast or dialog), raised here so the phone gets them page or no page:
//   question:<formId>      a Director / agent question (request_form) waiting for an answer; cleared when answered
//   emotion:<requestId>    an eMotion animation finished or failed
//   system:<id>            an agent notice or a system message at warning / error level
//   api-key:<service>      an API key or service lock needs attention (admin)

function onQuestion(spec) {
    if (!spec || !spec.id) return;
    const labels = (Array.isArray(spec.fields) ? spec.fields : []).map((f) => f && (f.label || f.name)).filter(Boolean).slice(0, 3);
    publish({
        app: 'director',
        id: `question:${spec.id}`,
        cls: 'question',
        title: clip(spec.title || 'A question for you', 80),
        text: labels.length ? clip(labels.join(', '), 200) : 'Open Dreamscape to answer.',
        actions: ['view'],
        data: { app: 'director', kind: 'question', formId: spec.id },
        ttlMs: 30 * 60 * 1000,
    });
}
function onQuestionClosed(id) {
    if (id) clear('admin', `question:${id}`);
}

function onEmotionDone(job) {
    if (!job || !(job.status === 'completed' || job.status === 'failed')) return;
    const id = job.requestId || job.sourceFilename;
    if (!id) return;
    const ok = job.status === 'completed';
    publish({
        app: 'emotion',
        id: `emotion:${id}`,
        cls: 'emotion',
        title: ok ? 'Animation ready' : 'Animation failed',
        text: clip(ok ? (job.sourceFilename || 'Your eMotion animation is done.') : (job.error || job.message || 'eMotion could not animate the picture.'), 200),
        actions: ['view'],
        data: { app: 'emotion', kind: 'emotion', requestId: job.requestId || null, filename: job.sourceFilename || null, ok },
        ttlMs: DAY,
    });
}

function onSystemNotice({ id, title, message, level } = {}) {
    const lv = String(level || 'info');
    if (lv !== 'warning' && lv !== 'error') return;
    const text = clip(message, 300);
    if (!text) return;
    const key = id || require('crypto').createHash('sha1').update(`${title}|${text}`).digest('hex').slice(0, 12);
    publish({
        app: 'system',
        id: `system:${key}`,
        cls: 'system',
        title: clip(title || (lv === 'error' ? 'Dreamscape error' : 'Dreamscape'), 80),
        text,
        data: { app: 'system', kind: 'system', level: lv },
        ttlMs: DAY,
    });
}

/** apiKeyHealth's statuses { service: [{ index, apiKey: { state, message }, <field>: {...} }] }: a failing key notifies. */
function onApiKeyStatus(statuses) {
    for (const [service, rows] of Object.entries(statuses || {})) {
        const checks = (Array.isArray(rows) ? rows : []).flatMap((r) => Object.values(r || {}).filter((v) => v && typeof v === 'object' && v.state));
        const failing = checks.find((c) => c.state === 'fail');
        const id = `api-key:${service}`;
        if (failing) {
            publish({
                app: 'accounts',
                id,
                cls: 'api-key',
                title: `${service}: an API key stopped working`,
                text: clip(failing.message || 'Check the key in Accounts.', 200),
                data: { app: 'accounts', kind: 'api-key', service },
                ttlMs: 7 * DAY,
            });
        } else if (checks.length && checks.every((c) => c.state === 'ok')) {
            clear('admin', id);
        }
    }
}

function onApiServiceLock({ service, label, lock } = {}) {
    if (!service) return;
    const id = `api-key:${service}`;
    if (lock) {
        publish({
            app: 'accounts',
            id,
            cls: 'api-key',
            title: `${label || service} is locked`,
            text: clip((lock && (lock.reason || lock.message)) || 'Requests to this service are stopped until it is unlocked.', 200),
            data: { app: 'accounts', kind: 'api-key', service },
            ttlMs: 7 * DAY,
        });
    } else {
        clear('admin', id);
    }
}

// ---------------------------------------------------------------- text messages (textMessaging tm_event)

/** wmChat tmFrom / tmText. */
function tmFrom(p) {
    const m = p.message || {};
    const who = (m.sender && (m.sender.name || m.sender.address)) || '';
    if (p.isGroup) return who || p.chatTitle || 'Unknown';
    return p.chatTitle || who || 'Unknown';
}
function tmText(m) {
    if (!m) return '';
    if (m.retracted) return 'This message was unsent.';
    const t = String(m.text || '').replace(/\s+/g, ' ').trim();
    if (t) return t.length > 160 ? `${t.slice(0, 157)}...` : t;
    const att = (m.attachments || [])[0];
    if (!att) return '';
    if (/^image\//.test(att.mime || '')) return 'Picture';
    if (/^video\//.test(att.mime || '')) return 'Video';
    if (/^audio\//.test(att.mime || '')) return 'Voice note';
    return att.name || 'Attachment';
}

const smsId = (accountId, chatGuid) => `sms:${accountId}:${chatGuid}`;

/** The conversation's details for the app's MessagingStyle notification (textMessagingPhone's old tm.notify detail). */
function smsThread(p) {
    const m = p.message || {};
    const sender = (m.sender && (m.sender.name || m.sender.address)) || 'Unknown';
    let account = null;
    try { account = require('./textMessaging').listAccounts().accounts.find((a) => a.id === p.accountId) || null; } catch (_e) { account = null; }
    return {
        guid: m.guid || '',
        title: p.chatTitle || sender,
        sender,
        address: (m.sender && m.sender.address) || '',
        isGroup: !!p.isGroup,
        date: m.date || Date.now(),
        service: m.service || (account && account.service) || '',
        // the account line: the name the user gave it in Messaging (#978), else the Apple ID / number / service
        account: account ? (account.accountName || account.identity || account.service || 'Text Messaging') : 'Text Messaging'
    };
}

/** textMessaging.broadcast(out): a new text notifies (the conversation's newest line); read clears. */
function onTextEvent(p) {
    // an Android app account (#885): the app's own notification is already on the phone
    if (!p || !p.accountId || p.native) return;
    if (p.event === 'message' && p.chatGuid && p.message) {
        if (p.message.fromMe) { clear('admin', smsId(p.accountId, p.chatGuid)); return; } // answered: read
        if (p.notify !== true) return;
        const from = tmFrom(p);
        const text = tmText(p.message);
        // outres 33321 "New Text Message"; the note's lines: "From: <sender>", the text
        publish({
            app: 'messaging',
            id: smsId(p.accountId, p.chatGuid),
            cls: 'sms',
            alert: true, // each message is news, though the conversation keeps one notice (#889)
            title: 'New Text Message',
            text: `From: ${from}\n${text}`,
            actions: ['reply'],
            // what the app's conversation notification needs (MessagingStyle, Reply, Mark as read; #908: the one
            // path for a new text, confirmed and retried, in place of the separate tm.notify)
            data: Object.assign({ app: 'messaging', kind: 'sms', accountId: p.accountId, chatGuid: p.chatGuid, from, text }, smsThread(p)),
            ttlMs: 7 * DAY,
        });
        return;
    }
    if (p.event === 'read' && p.chatGuid && p.read !== false) {
        clear('admin', smsId(p.accountId, p.chatGuid));
        return;
    }
    if (p.event === 'signin_lost') {
        publish({
            app: 'messaging',
            id: `tm-signin:${p.accountId}`,
            cls: 'notification',
            title: 'Text messages stopped',
            text: p.text || 'Text messages are not arriving. Pair again in Dreamscape CardSpace on the computer.',
            data: { app: 'messaging', kind: 'tm-signin', accountId: p.accountId },
        });
    }
}

// ---------------------------------------------------------------- Dreamscape Messenger (chatImpl)

const SAYS = ['speechdirect', 'speech', 'reply'];

/** The persona's line in a reply (wmChat eventsText: the first said line, else "My name is ..."). */
function saidOf(parsed, raw) {
    const first = (k) => (parsed && Array.isArray(parsed[k]) && parsed[k].length ? String(parsed[k][0]) : '');
    if (parsed) {
        for (const k of SAYS) { const v = first(k); if (v) return v; }
        const name = first('myname');
        if (name) return `My name is ${name}`;
    }
    let text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return '';
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    try {
        const m = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
        const v = JSON.parse((m ? m[0] : text).replace(/,(\s*[}\]])/g, '$1'));
        const events = Array.isArray(v) ? v : [v];
        let said = '';
        let name = '';
        for (const e of events) {
            if (!e || typeof e !== 'object' || !e.content) continue;
            if (!said && SAYS.includes(e.type)) said = String(e.content);
            if (!name && e.type === 'myname') name = String(e.content);
        }
        return said || (name ? `My name is ${name}` : '');
    } catch (_e) {
        return /^[[{]/.test(text) ? '' : text;
    }
}

/** A phone page asked (Melaton Mobile), or the asking socket is gone: the reply is the phone's news. */
function phoneAsked(clientInfo, ws) {
    if (ws && ws.readyState !== undefined && ws.readyState !== 1) return true;
    const info = clientInfo || {};
    if (info.as && info.as.kind === 'device') return true;
    const ua = String(info.userAgent || info.applicationUserAgent || '');
    return /android|iphone|mobile|dsapp/i.test(ua);
}

/**
 * A persona's reply (chatImpl handleSendChatMessage). Only replies to the phone notify: a desktop chat
 * shows its own reply and must not ping the phone.
 */
function onChatReply({ chatId, session, parsed, raw, clientInfo, ws } = {}) {
    if (!chatId || !phoneAsked(clientInfo, ws)) return null;
    if (clientInfo && clientInfo.userType && !/^(admin|dev_admin)$/.test(String(clientInfo.userType))) return null;
    const said = saidOf(parsed, raw);
    if (!said) return null;
    const from = (session && (session.character_name || session.chat_name)) || 'Persona';
    const line = said.length > 160 ? `${said.slice(0, 157)}...` : said;
    return publish({
        user: inbox.userOf(clientInfo),
        app: 'chat',
        id: `chat:${chatId}`,
        cls: 'chat',
        alert: true, // each reply is news (#889)
        title: 'Dreamscape Messenger',
        text: `From: ${from}\n${line}`,
        actions: ['reply'],
        data: { app: 'chat', kind: 'chat', chatId: String(chatId), from, said: line },
        ttlMs: 7 * DAY,
    });
}

// ---------------------------------------------------------------- Director (cursorDirector status)

let dirWas = null; // { running, sessionId, name } from the last status

/** cursorDirector.broadcastDirectorStatus(status): running -> idle is "the turn is finished". */
function onDirectorStatus(status) {
    if (!status) return null;
    const xi = status.xi && status.xi.running ? status.xi : null;
    const now = xi
        ? { running: true, sessionId: xi.sessionId || null, name: xi.sessionName || '' }
        : { running: !!status.running, sessionId: status.sessionId || null, name: status.sessionName || '' };
    const was = dirWas;
    dirWas = now.running ? now : Object.assign({}, now, { sessionId: was && was.running ? was.sessionId : now.sessionId, name: was && was.running ? was.name : now.name });
    if (!was || !was.running || now.running) {
        // a new turn on a session: its last "finished" notice is old news
        if (now.running && now.sessionId && (!was || !was.running)) clear('admin', `director:${now.sessionId}:turn`);
        return null;
    }
    const name = was.name;
    const who = name ? `"${name}"` : 'The session';
    return publish({
        app: 'director',
        id: `director:${was.sessionId || 'session'}:turn`,
        cls: 'director',
        alert: true, // each finished turn is news (#889)
        title: 'Director',
        text: `${who}: the turn is finished.`,
        data: { app: 'director', kind: 'director', sessionId: was.sessionId || null },
        ttlMs: DAY,
    });
}

// ---------------------------------------------------------------- prints (generationJobQueue FIFO)

const PHONE_OWNER = 'Melaton Mobile';
const printsTold = new Set();

/**
 * A FIFO job changed (generationJobQueue.onChange): a phone's print that failed notifies. A print that
 * finished is no notice (Yukimi, Nov 22 2026, #1040: no "Your print is ready" on the phone - no inbox
 * entry, so no Android notification, status icon or sound either); the prints icon still shows while
 * the phone's prints are queued or running (status-bar task).
 */
function onPrintJob(job) {
    if (!job || job.owner !== PHONE_OWNER) return null;
    if (job.status !== 'completed' && job.status !== 'failed') return null;
    const id = String(job.jobId || job.id || '');
    if (!id || printsTold.has(id)) return null;
    printsTold.add(id);
    if (printsTold.size > 500) printsTold.delete(printsTold.values().next().value);
    const result = job.result && typeof job.result === 'object' ? job.result : {};
    const flat = result.flat && typeof result.flat === 'object' ? result.flat : {};
    const ok = job.status === 'completed' && result.success !== false;
    const user = String(job.userType || 'admin');
    if (user !== 'admin' && user !== 'dev_admin') return null; // only the household and dev have inboxes
    if (!ok) {
        const err = job.status === 'failed' ? ((job.error && job.error.message) || job.error) : (flat.error || result.error);
        return publish({
            user,
            app: 'studio',
            id: `print:${id}`,
            cls: 'print-error',
            title: 'DreamStudio',
            text: clip(err || 'generation failed', 300),
            data: { app: 'studio', kind: 'print', jobId: id, failed: true },
            ttlMs: DAY,
        });
    }
    return null;
}

/** "Your print is ready" notices published before #1040 leave the inbox and the phones (once per start). */
function dropReadyNotices() {
    for (const user of ['admin', 'dev_admin']) {
        try {
            for (const n of inbox.list(user)) if (n && n.cls === 'print' && /^print:/.test(String(n.id || ''))) clear(user, n.id);
        } catch (_e) { /* the inbox not open yet: they expire within a day anyway */ }
    }
}

let queueBound = null;
/** Follow the shared FIFO (once). */
function bindPrintQueue(queue) {
    if (!queue || typeof queue.onChange !== 'function' || queueBound === queue) return;
    queueBound = queue;
    dropReadyNotices();
    queue.onChange((job) => { try { onPrintJob(job); } catch (_e) { /* never break the FIFO */ } });
}

// ---------------------------------------------------------------- weather (weatherService)

/** 'YYYY-MM-DDTHH:MM' (the place's wall clock) -> "Fri 11:00 AM" (weatherAlerts when). */
function when(iso) {
    if (!iso || String(iso).length < 16) return '';
    const d = new Date(`${String(iso).slice(0, 16)}:00Z`);
    if (Number.isNaN(d.getTime())) return '';
    const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    return `${day} ${time}`;
}

/** weather_alert_issued { alert, place, source }. */
function onWeatherAlert({ alert, place } = {}) {
    if (!alert || !alert.id) return null;
    const bits = [];
    const where = (place && place.name) || alert.area || '';
    if (where) bits.push(where);
    const until = when(alert.ends || alert.expires);
    if (until) bits.push(`until ${until}`);
    const text = bits.join(', ');
    const label = place && place.label ? `${place.label}: ` : '';
    const severe = alert.severity === 'extreme' || alert.severity === 'severe';
    const ends = Date.parse(`${String(alert.expires || alert.ends || '').slice(0, 16)}:00Z`);
    const placeId = (place && place.id) || 'place';
    return publish({
        app: 'weather',
        id: `wx:${placeId}:${alert.id}`,
        cls: severe ? 'weather-severe' : 'weather-alert',
        title: alert.title || 'Weather Alert',
        text: `${label}${text || 'A weather alert was issued.'}`,
        actions: ['view'],
        data: { app: 'weather', kind: 'weather-alert', alertId: alert.id, placeId },
        // the alert's own end (its wall clock, give or take the zone) plus a margin
        expiresAt: Number.isFinite(ends) ? ends + DAY / 2 : Date.now() + 2 * DAY,
    });
}

/** weather_rain_alarm { place, startsInMin, endsInMin, kind, summary } (weatherAlerts onRain wording). */
function onRainAlarm(d) {
    if (!d || !d.place) return null;
    const where = d.place.label || d.place.name || 'your place';
    const kind = d.kind || 'Rain';
    const title = `${kind} at ${where} in ${d.startsInMin} min`;
    const text = d.endsInMin
        ? `${kind} from about ${d.startsInMin} minutes from now, stopping after about ${Math.max(5, d.endsInMin - d.startsInMin)} minutes.`
        : (d.summary || `${kind} expected in about ${d.startsInMin} minutes.`);
    const mins = (Number(d.endsInMin) || (Number(d.startsInMin) || 0) + 60) + 15;
    return publish({
        app: 'weather',
        id: `rain:${d.place.id || 'place'}`,
        cls: 'rain-alarm',
        title,
        text,
        data: { app: 'weather', kind: 'rain', placeId: d.place.id || null },
        ttlMs: mins * 60 * 1000,
    });
}

module.exports = {
    onMailEvent,
    onDovecoteNewMail,
    onQuestion,
    onQuestionClosed,
    onEmotionDone,
    onSystemNotice,
    onApiKeyStatus,
    onApiServiceLock,
    onDovecoteDone,
    bindDovecote,
    onTextEvent,
    onChatReply,
    onDirectorStatus,
    onPrintJob,
    bindPrintQueue,
    onWeatherAlert,
    onRainAlarm,
    _test: {
        saidOf,
        sweepDovecote,
        reset: () => { dirWas = null; printsTold.clear(); queueBound = null; },
    },
};
