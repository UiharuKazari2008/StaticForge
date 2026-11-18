'use strict';

/**
 * Phone status snapshot (StaticForge #908 phase 3, rule cafeready-background: "as if a life depends on it").
 *
 * The phone's status bar icons (mail, texts, Messenger, Director, prints, weather, the car, received items, waiting
 * notices) were worked out by the Melaton Mobile page from what it held; with the page asleep the native bar showed
 * a stale copy. The server owns every one of those inputs, so it computes them here and sends them to each partnered
 * phone's ActiveSync background link (the app's always-up line: no new socket, no new radio wakes), where the
 * CaféReady task "status-bar" (public/scripts/tasks/status-bar.js) maps them, with the phone's own signals, to icons.
 *
 *   as_event status.snapshot { full: bool, fields: { <field>: value } }   (only what changed; all of it after a hello)
 *
 * Fields (household; the inbox ones per user 'admin'):
 *   mail      { unread, fresh, new }  unread: the household mailbox's inbox + IMAP inboxes; fresh: new-mail notices
 *                                 waiting; new: unread mail since Messaging's mail was last opened (messageNew.js)
 *   sms       { unread, fresh, new }  unread: Text Messaging's unread (connected accounts); fresh: text notices waiting;
 *                                 new: a conversation with a text since Text Messaging was last opened, still unread
 *   chat      { fresh }           Messenger replies waiting
 *   director  { running, unseen } a turn running; a finished turn's notice waiting
 *   prints    { phone }           prints a phone asked for, queued or running
 *   weather   { alerts, rain }    alerts at Home / Work; rain due or falling with the rain alarm on
 *   lapis     { until }           a remote start's end (epoch ms), 0 = none running
 *   traffic   { days, leaveHome, leaveWork, leadMin, timeZone, delayWork, delayHome, reportAt }  (the task works the
 *             leave windows out on the phone's clock; the server has no timer for them)
 *   notices   { waiting }         other notices waiting (the notification glyph)
 *   prefs     { mailAll, smsAll } Messaging's "icon for any unread" choices (the page's, kept on the server)
 *   received  { unseen }          ActiveSync received items not seen yet (per phone)
 *
 * Nothing runs on a timer: producers call touch() at their change points (one rebuild per second at most); a phone's
 * hello gets the whole snapshot. A field is sent when its JSON changed for that phone (no clock fields in it).
 */

const DEBOUNCE_MS = 1000;
const WAITING = new Set(['new', 'seen']);

let gr = null;
let timer = null;
let running = false;
let again = false;
let directorRunning = false;
// deviceId -> { field: json } as last sent to that phone's background link
const sent = new Map();

function bind(globalResources) {
    if (!globalResources || gr) return module.exports;
    gr = globalResources;
    try {
        const as = require('./activeSync');
        if (typeof as.onDeviceHello === 'function') {
            as.onDeviceHello((d) => {
                if (!d || d.speaker !== 'service' || d.session !== 'partner') return;
                sent.delete(d.id);
                // after the hello reply, once the link is settled
                const t = setTimeout(() => touch('hello'), 1500);
                if (t.unref) t.unref();
            });
        }
    } catch (_e) { /* no ActiveSync */ }
    // the two producers with listener lists of their own: texts, and the print queue
    try { require('./textMessaging').onEvent(() => touch('sms')); } catch (_e) { /* no Text Messaging */ }
    try {
        const q = typeof gr.getGenerationJobQueue === 'function' ? gr.getGenerationJobQueue() : null;
        if (q && typeof q.onChange === 'function') q.onChange(() => touch('prints'));
    } catch (_e) { /* no queue */ }
    try { require('./messageNew').start(); } catch (e) { console.warn(`[phone-status] message new: ${e.message}`); }
    return module.exports;
}

/** Something an icon reads changed: the snapshot is rebuilt within a second and the changes go to the phones. */
function touch(reason) {
    // mail or texts changed: "new since last opened" is worked out again (it touches back with 'new' when it changes)
    if (reason === 'mail' || reason === 'dovecote' || reason === 'sms') { try { require('./messageNew').soon(); } catch (_e) { /* best effort */ } }
    if (!gr) return;
    if (running) { again = true; return; }
    if (timer) return;
    timer = setTimeout(() => { timer = null; void run(); }, DEBOUNCE_MS);
    if (timer.unref) timer.unref();
}

/** cursorDirector's status broadcast: whether a turn runs (the push carries it; no read of our own). */
function directorStatus(status) {
    const r = !!(status && (status.running || (status.xi && status.xi.running)));
    if (r === directorRunning) return;
    directorRunning = r;
    touch('director');
}

const safe = (fn, fallback) => { try { return fn(); } catch (_e) { return fallback; } };

function inboxCounts() {
    const rows = safe(() => require('./notificationInbox').list('admin'), []).filter((n) => WAITING.has(n.state));
    const has = (p) => rows.filter((n) => n.id.startsWith(p)).length;
    const mine = (n) => /^(mail|dmail|sms|chat|director):/.test(n.id);
    return {
        mailFresh: has('mail:') + has('dmail:'),
        smsFresh: has('sms:'),
        chatFresh: has('chat:'),
        directorUnseen: rows.some((n) => /^director:.*:turn$/.test(n.id)),
        notices: rows.filter((n) => !mine(n) && n.state === 'new').length
    };
}

function prefs() {
    const read = (k) => safe(() => require('./notificationInbox').getPref('admin', k), '') === '1';
    return { mailAll: read('icon.mailAll'), smsAll: read('icon.smsAll') };
}

function mailUnread() {
    let n = 0;
    const dm = safe(() => require('./dovecoteMail'), null);
    if (dm) n += safe(() => (dm.listMailboxes().find((m) => m.owner === dm.HUMAN_OWNER) || {}).unread || 0, 0);
    n += safe(() => require('./mailAccounts').unreadSummary().reduce((s, a) => s + (a.unread || 0), 0), 0);
    return n;
}

async function smsUnread() {
    try {
        const list = await require('./textMessaging').summary();
        return (list || []).reduce((s, a) => s + (Number(a && a.unread) || 0), 0);
    } catch (_e) { return 0; }
}

function phonePrints() {
    const q = safe(() => (gr && typeof gr.getGenerationJobQueue === 'function' ? gr.getGenerationJobQueue() : null), null);
    if (!q || typeof q.listPublic !== 'function') return 0;
    return safe(() => q.listPublic().filter((j) => {
        if (!j || !/^(queued|delayed|running)$/.test(String(j.status || ''))) return false;
        const full = typeof q.get === 'function' ? q.get(j.id) : j;
        return !!(full && full.owner === 'Melaton Mobile');
    }).length, 0);
}

function weather() {
    const w = safe(() => require('./weatherService'), null);
    if (!w) return { alerts: 0, rain: false };
    const places = safe(() => w.getActiveAlerts().places, {}) || {};
    const alerts = ['home', 'work'].reduce((s, id) => s + ((places[id] && places[id].alerts && places[id].alerts.length) || 0), 0);
    const rain = Object.values(safe(() => w.getRainStatus().places, {}) || {}).some((p) => p && p.rainAlarm && (p.wet || p.startsInMin != null));
    return { alerts, rain };
}

function lapis() {
    const c = safe(() => require('./lapisService').getState().command, null);
    const until = c && c.kind === 'start' && c.state === 'success' && Number.isFinite(c.runsUntil) && c.runsUntil > Date.now() ? c.runsUntil : 0;
    return { until };
}

function traffic() {
    const t = safe(() => require('./trafficService'), null);
    if (!t) return null;
    const s = safe(() => t.getSettings(), null) || {};
    const l = safe(() => t.getLatest(), {}) || {};
    const delay = (r) => (r && Number.isFinite(r.delaySec) ? r.delaySec : null);
    return {
        days: Array.isArray(s.days) ? s.days : [], leaveHome: s.leaveHome || '', leaveWork: s.leaveWork || '', leadMin: s.leadMin || 0,
        timeZone: s.timeZone || '', delayWork: delay(l.work), delayHome: delay(l.home),
        reportAt: Math.max((l.work && l.work.at) || 0, (l.home && l.home.at) || 0)
    };
}

/** The household's snapshot now (received items are per phone, added when sending). */
async function build() {
    const ib = inboxCounts();
    const fresh = safe(() => require('./messageNew').state(), { mail: false, sms: false });
    return {
        mail: { unread: mailUnread(), fresh: ib.mailFresh, new: fresh.mail },
        sms: { unread: await smsUnread(), fresh: ib.smsFresh, new: fresh.sms },
        chat: { fresh: ib.chatFresh },
        director: { running: directorRunning, unseen: ib.directorUnseen },
        prints: { phone: phonePrints() },
        weather: weather(),
        lapis: lapis(),
        traffic: traffic(),
        notices: { waiting: ib.notices },
        prefs: prefs()
    };
}

async function run() {
    running = true;
    try {
        const as = require('./activeSync');
        const links = safe(() => as.partnerLinks(gr, null).filter((l) => l.service), []);
        if (!links.length) return;
        const snap = await build();
        for (const l of links) {
            const fields = Object.assign({}, snap, { received: { unseen: safe(() => as.receivedUnseen(gr, l.deviceId), 0) } });
            const was = sent.get(l.deviceId);
            const out = {};
            const now = {};
            for (const [k, v] of Object.entries(fields)) {
                const j = JSON.stringify(v);
                now[k] = j;
                if (!was || was[k] !== j) out[k] = v;
            }
            if (!Object.keys(out).length) continue;
            if (as.sendServerEvent(gr, null, l.service, 'status.snapshot', { full: !was, fields: out })) sent.set(l.deviceId, now);
        }
    } catch (e) {
        console.warn(`[phone-status] ${e.message}`);
    } finally {
        running = false;
        if (again) { again = false; touch('again'); }
    }
}

module.exports = { bind, touch, directorStatus, _test: { build, run, sent, reset: () => { sent.clear(); gr = null; directorRunning = false; } } };
