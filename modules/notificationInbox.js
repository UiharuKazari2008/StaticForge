'use strict';

/**
 * Notification inbox (Yozora #845): a durable store of the notices producers raise (Lapis Remote,
 * Traffic, and in time weather, mail, texts...), so that
 *   - a phone that was not connected shows them when it opens (they are not lost with the socket),
 *   - the DSApp foreground service can post them as Android notifications while the WebView is paused,
 *   - the visible shell is the one place they show: on resume it lists what has not been cleared or
 *     acted on elsewhere and shows that; acking in one place clears it in the other.
 *
 * One queue per user type ('admin' is the household; 'dev_admin' is kept apart so test tabs do not
 * pollute it). Each notice carries the wmShell notification class (its sound and icon), a title and
 * text, its action ids (lock, stop, view...), optional data, when it was made and when it expires, and
 * a state (new -> seen -> acted, or cleared). A short-lived notice (a countdown step) sets expiresAt
 * so a stale one is never shown late.
 *
 * Producers call publish(); they keep their own live broadcast (lapis_notice, traffic_report, ...), so
 * a connected client still gets the notice at once. The inbox broadcasts inbox_updated for cross-client
 * and cross-device state (a notice acted on one device clears on the others).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '..', '.cache');
const STATES = new Set(['new', 'seen', 'acted', 'cleared']);
const MAX_PER_USER = 200; // keep the newest; older cleared ones are pruned
const KEEP_MS = 14 * 24 * 60 * 60 * 1000; // a notice older than this is dropped whatever its state

let gr = null;
let db = null;
let nowFn = () => Date.now();

let pruneTimer = null;
function bind(globalResources) {
    if (globalResources && !gr) {
        gr = globalResources;
        // expired notices go (and leave the phones) even when nothing new is published
        if (!pruneTimer && !process.env.NOTIFICATION_INBOX_NO_TIMER) {
            pruneTimer = setInterval(() => { prune('admin'); prune('dev_admin'); }, 10 * 60 * 1000);
            if (pruneTimer.unref) pruneTimer.unref();
        }
        if (!process.env.NOTIFICATION_INBOX_NO_TIMER) setImmediate(tapPhoneHellos);
    }
    return module.exports;
}

function database() {
    if (db) return db;
    const Database = require('better-sqlite3');
    let file = process.env.NOTIFICATION_INBOX_DB;
    if (!file) {
        let dir = null;
        try {
            dir = gr && gr.getPath ? gr.getPath('databases') : null;
        } catch (_e) {
            dir = null;
        }
        file = path.join(dir || CACHE_DIR, 'notifications.db');
    }
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 4000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS notices (
            user TEXT NOT NULL,
            id TEXT NOT NULL,
            app TEXT NOT NULL DEFAULT '',
            cls TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL DEFAULT '',
            actions TEXT NOT NULL DEFAULT '[]',
            data TEXT NOT NULL DEFAULT '{}',
            createdAt INTEGER NOT NULL,
            expiresAt INTEGER,
            state TEXT NOT NULL DEFAULT 'new',
            actedBy TEXT,
            updatedAt INTEGER NOT NULL,
            digest TEXT,
            PRIMARY KEY (user, id)
        );
        CREATE INDEX IF NOT EXISTS notices_user_created ON notices (user, createdAt);
        CREATE TABLE IF NOT EXISTS deliveries (
            device TEXT NOT NULL,
            user TEXT NOT NULL,
            id TEXT NOT NULL,
            sentAt INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 1,
            alert INTEGER NOT NULL DEFAULT 1,
            postedAt INTEGER,
            how TEXT,
            PRIMARY KEY (device, user, id)
        );
        CREATE INDEX IF NOT EXISTS deliveries_open ON deliveries (postedAt, sentAt);
        CREATE TABLE IF NOT EXISTS prefs (
            user TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (user, key)
        );
    `);
    // a database from before the digest (a dismissed alert never sounds twice, #1194): add the column once
    try {
        if (!db.prepare('PRAGMA table_info(notices)').all().some((c) => c.name === 'digest')) db.exec('ALTER TABLE notices ADD COLUMN digest TEXT');
    } catch (e) { console.warn(`[notify-inbox] digest column: ${e.message}`); }
    return db;
}

// The queues: admin, dev_admin, and 'test' - the lane of the test devices (modules/testDevices.js: the Android emulator
// partnered for notification tests; nothing in it reaches a real phone or a page, and nothing a test device does reaches
// the household's queues).
const qu = (user) => (user === 'dev_admin' || user === 'test' ? user : 'admin');
const testDevices = () => require('./testDevices');
const isTestDevice = (id) => { try { return testDevices().isTestDevice(id); } catch (_e) { return false; } };

function userOf(info) {
    try { if (testDevices().isTestInfo(info)) return 'test'; } catch (_e) { /* no fence module: household */ }
    const t = info && info.userType ? String(info.userType) : '';
    return t === 'admin' || t === 'dev_admin' ? t : 'admin';
}

function rowOut(r) {
    return {
        id: r.id,
        app: r.app,
        cls: r.cls,
        title: r.title,
        text: r.text,
        actions: safeJson(r.actions, []),
        data: safeJson(r.data, {}),
        createdAt: r.createdAt,
        // when its state last moved (#890 round 5 W2): the page's inbox_list since is the newest it holds
        updatedAt: r.updatedAt || r.createdAt,
        expiresAt: r.expiresAt || null,
        state: r.state,
        actedBy: r.actedBy || null,
        // the order's two inputs (#1098): when it last became news (a stack: its newest item) and how much it matters
        sortAt: sortAtOf(r),
        prio: prioOf(r.cls),
    };
}

// ---- order (#1098): time first, priority only among the older ones ----
// A notice that became news within FRESH_MS comes first, newest first: a new notice is always on top, whatever it is.
// The older ones go by priority (a text over mail over the rest), then by time. The page sorts by the sortAt / prio
// it is sent with the same rule (it keeps no priority table of its own).
const FRESH_MS = 15 * 60 * 1000;
const PRIO = { sms: 4, text: 4, texts: 4, imessage: 4, 'weather-severe': 4, reminder: 3, calendar: 3, alarm: 3, chat: 2, messenger: 2, mail: 2, 'weather-alert': 2 };
const prioOf = (cls) => PRIO[cls] || 1;
function sortAtOf(r) {
    const d = typeof r.data === 'string' ? safeJson(r.data, {}) : (r.data || {});
    return Number(d.lastAt) || Number(r.createdAt) || 0;
}

/** Rows (as rowOut gives them, or raw) in the order a list shows them: fresh ones newest first, then by prio, then newest. */
function orderNotices(rows, now = nowFn()) {
    const keyed = (Array.isArray(rows) ? rows : []).map((r) => ({
        r,
        at: Number.isFinite(Number(r.sortAt)) && Number(r.sortAt) > 0 ? Number(r.sortAt) : sortAtOf(r),
        prio: Number.isFinite(Number(r.prio)) ? Number(r.prio) : prioOf(r.cls),
    }));
    const fresh = (k) => k.at >= now - FRESH_MS;
    keyed.sort((a, b) => {
        const fa = fresh(a), fb = fresh(b);
        if (fa !== fb) return fa ? -1 : 1;
        if (!fa && a.prio !== b.prio) return b.prio - a.prio;
        return b.at - a.at || (Number(b.r.updatedAt) || 0) - (Number(a.r.updatedAt) || 0);
    });
    return keyed.map((k) => k.r);
}

function safeJson(s, fallback) {
    try {
        const v = JSON.parse(s);
        return v === null ? fallback : v;
    } catch (_e) {
        return fallback;
    }
}

/**
 * Store a notice (new, or replacing one of the same id — a countdown step keeps the id so it supersedes
 * the last). Broadcasts inbox_updated. Producers call this as well as their own live broadcast.
 * @returns the stored notice, or null when it is not stored (no id/title, or already expired)
 */
function publish(notice = {}) {
    if (!gr) return null;
    const id = String(notice.id || '').trim();
    const title = String(notice.title || '').trim();
    if (!id || !title) return null;
    const user = qu(notice.user);
    const now = nowFn();
    const expiresAt = Number.isFinite(Number(notice.ttlMs)) && Number(notice.ttlMs) > 0 ? now + Number(notice.ttlMs) : (Number.isFinite(Number(notice.expiresAt)) ? Number(notice.expiresAt) : null);
    if (expiresAt && expiresAt <= now) return null;
    const cls = String(notice.cls || notice.kind || '').slice(0, 60);
    // a class the phone shows without a message (Sounds & Notifications: Display message on screen off):
    // kept for the title bar's state, never popped on resume nor posted on Android
    const quiet = !!cls && quietClasses(user).has(cls);
    const stackKey = String(notice.stack || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 30);
    if (stackKey) return publishStacked(user, notice, { id, title, cls, quiet, now, expiresAt, stackKey });
    const row = {
        user,
        id,
        app: String(notice.app || '').slice(0, 40),
        cls,
        title: title.slice(0, 200),
        text: String(notice.text || '').slice(0, 2000),
        actions: JSON.stringify(Array.isArray(notice.actions) ? notice.actions.slice(0, 6) : []),
        data: JSON.stringify(notice.data && typeof notice.data === 'object' ? notice.data : {}),
        createdAt: now,
        expiresAt,
        state: quiet ? 'seen' : 'new',
        actedBy: null,
        updatedAt: now,
    };
    // ---- does this publish sound on the phones, and does it bring a dismissed notice back? (#889, #1194) ----
    // Yukimi: "If you went off once, you don't get to go off again ... unless the alert has been majorly changed."
    // Every publish carries a digest of what the notice says: the producer's own (notice.digest: the thing that makes
    // it a different event) or sha1 of title | text | data.stamp (not the class: see escalation). The stored row (cur) decides:
    //   - no row: loud, new.
    //   - a live row (new / seen), the producer did not say alert: a countdown step, a commute update, a place added to
    //     an alert: updated in place, silent - unless it escalated.
    //   - a live row, alert: true: loud only when the digest changed (or it escalated); the same thing again is silent.
    //     A new message in a conversation is a new event under the one id (its digest carries the message's guid, its text
    //     differs), a new Lapis stamp is one (data.stamp), a persona's next reply has other text.
    //   - a done row (acted, cleared): the user has dealt with it. Unchanged digest and no escalation: it STAYS acted /
    //     cleared (state and createdAt kept, text / data / digest refreshed, expiresAt the later of the two so it stays
    //     quiet until the alert really ends), no phone push, no inbox_updated 'new' - the page must not pop it and a
    //     reload's catch-up (non-cleared rows only) must not bring it back. Changed or escalated: loud, new again
    //     (a different event title or day for a weather alert; a message with another guid).
    //   - escalation: moving to a higher-ranked class (CLASS_RANK: weather-alert -> weather-severe) is material even when
    //     the digest is otherwise the same: the worse news sounds once more. A downgrade is no news.
    //   - a legacy row (digest NULL, from before this column): its digest is worked out from what it stored; when the
    //     producer gives a custom digest, the same title and class counts as unchanged.
    //   - returning: true (a snooze ending): the user asked for it back, so it sounds and is new again whatever it says.
    //   - the test lane (user 'test', modules/testDevices.js) follows the same rule, so a test device proves it; its
    //     snooze comes back with returning: true like the household's.
    const custom = typeof notice.digest === 'string' && notice.digest !== '';
    const dataObj = notice.data && typeof notice.data === 'object' ? notice.data : {};
    row.digest = custom ? sha1(`c|${notice.digest}`) : defaultDigest(row.title, row.text, dataObj.stamp);
    let alert = true;
    try {
        const cur = database().prepare('SELECT state, digest, title, text, cls, data, expiresAt FROM notices WHERE user = ? AND id = ?').get(user, id);
        if (cur) {
            const done = cur.state === 'acted' || cur.state === 'cleared';
            {
                const escalated = classRank(row.cls) > classRank(cur.cls);
                // returning: the user asked for it back (a snooze ending, reminderScheduler.fireSnoozed) - loud by request
                const changed = escalated || notice.returning === true || digestChanged(cur, row, custom);
                if (done && !changed) {
                    // stays dealt with: refresh what it says, nothing else (no state move, no push, no broadcast)
                    const until = Math.max(Number(cur.expiresAt) || 0, Number(expiresAt) || 0) || null;
                    database().prepare('UPDATE notices SET text = ?, data = ?, expiresAt = ?, digest = ? WHERE user = ? AND id = ?').run(row.text, row.data, until, row.digest, user, id);
                    const stored = noticeRow(user, id);
                    return stored ? Object.assign(rowOut(stored), { alert: false }) : null;
                }
                alert = done ? true : escalated || notice.returning === true || (notice.alert === true && changed);
            }
        }
    } catch (_e) { /* a new table: new */ }
    row.fresh = alert ? 1 : 0;
    if (!storeRow(row)) return null;
    prune(user);
    return announce(user, row, alert, quiet, user === 'test' && notice.push === false);
}

/** A stored row goes out: the pages' inbox_updated, the phones' status icons and background links (a silent update posts in place). */
function announce(user, row, alert, quiet, pushOff) {
    const id = row.id;
    const out = Object.assign(rowOut(row), { alert });
    broadcast(user, { type: 'inbox_updated', data: { reason: 'new', notice: out } });
    // the phones' status icons read the waiting notices (phoneStatus, #908)
    try { require('./phoneStatus').touch('inbox'); } catch (_e) { /* best effort */ }
    // the phones' background links too (#876 D): a phone whose page is not running posts it natively.
    // push: false (test lane only, /api/test-devices "get" notices): stored for the phones to fetch - their hello
    // catch-up and the status snapshot's notices list - but not sent live
    if (!quiet && !pushOff) {
        const sentTo = [];
        try { require('./activeSync').sendInboxNotice(gr, null, Object.assign({ user }, out), { sentTo }); } catch (e) { console.warn(`[notify-inbox] phones: ${e.message}`); }
        sentTo.forEach((device) => noteSent(device, user, id, alert, true));
    }
    return out;
}

// ---- stacks (#1098): a flood of mail is one notice ----
// A producer passes stack: '<key>' (mail: IMAP and Dovecote). The notices of a stack are ITEMS of one row, id stack:<key>:
//   data { stack, count, lastAt, items: [ { id, title, text, at, data, actions } ] } (items newest first, 50 at most; count
//   stays the true count), title "n New E-mail Messages", text one line per item (6 at most, then "+ k more").
//   - no live row (none, or acted / cleared): a new stack of this one item, new, LOUD.
//   - a live row (new / seen): the item joins on top, SILENT (the phones re-post the same id in place, so one Android
//     notification); createdAt is kept, updatedAt and data.lastAt move. The same item id again replaces it where it is.
//   - clearing an item (clear / clearWhere of an id that is an item, not a row) takes it out; the last one clears the row.
//   - ack of stack:<key> is the whole stack; the next item starts a new loud one.
const STACK_ITEMS_MAX = 50;
const STACK_LINES_MAX = 6;
const STACK_TITLES = { mail: (n) => `${n} New E-mail Messages` };
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';
const STACK_LINES = {
    mail: (it) => {
        const d = it.data || {};
        return d.from || d.subject ? `${d.from || '?'} - ${d.subject || ''}`.trim() : firstLine(it.text) || it.title;
    },
};
const stackLine = (key, it) => (STACK_LINES[key] ? STACK_LINES[key](it) : firstLine(it.text) || it.title);

function stackView(key, items, count) {
    const top = items[0];
    if (count <= 1) return { title: top.title, text: top.text };
    const title = STACK_TITLES[key] ? STACK_TITLES[key](count) : `${count} ${top.title}`;
    const lines = items.slice(0, STACK_LINES_MAX).map((it) => stackLine(key, it));
    if (count > lines.length) lines.push(`+ ${count - lines.length} more`);
    return { title: title.slice(0, 200), text: lines.join('\n').slice(0, 2000) };
}

function publishStacked(user, notice, o) {
    const { id, title, cls, quiet, now, expiresAt, stackKey } = o;
    const sid = `stack:${stackKey}`;
    const item = {
        id,
        title: title.slice(0, 200),
        text: String(notice.text || '').slice(0, 1000),
        at: now,
        data: notice.data && typeof notice.data === 'object' ? notice.data : {},
        actions: Array.isArray(notice.actions) ? notice.actions.slice(0, 6) : [],
    };
    let cur = null;
    try { cur = noticeRow(user, sid); } catch (_e) { cur = null; }
    const live = !!cur && (cur.state === 'new' || cur.state === 'seen') && !(cur.expiresAt && cur.expiresAt <= now);
    let items = [item];
    let count = 1;
    let lastAt = now;
    if (live) {
        const d = safeJson(cur.data, {});
        const held = Array.isArray(d.items) ? d.items : [];
        const at = held.findIndex((x) => x && x.id === id);
        count = Number(d.count) || held.length;
        if (at >= 0) {
            // the same item again: replaced where it is (it keeps its place and its time), nothing joins
            items = held.slice();
            items[at] = Object.assign({}, item, { at: held[at].at || now });
            lastAt = Number(d.lastAt) || now;
        } else {
            items = [item].concat(held).slice(0, STACK_ITEMS_MAX);
            count += 1;
        }
    }
    const view = stackView(stackKey, items, count);
    const row = {
        user,
        id: sid,
        app: String(notice.app || '').slice(0, 40),
        cls,
        title: view.title,
        text: view.text,
        actions: JSON.stringify(items[0].actions),
        data: JSON.stringify({ stack: stackKey, count, lastAt, items }),
        createdAt: now,
        expiresAt: live ? Math.max(Number(cur.expiresAt) || 0, Number(expiresAt) || 0) || null : expiresAt,
        state: live ? cur.state : (quiet ? 'seen' : 'new'),
        actedBy: null,
        updatedAt: now,
        digest: sha1(`stack|${stackKey}|${count}|${id}`),
        fresh: live ? 0 : 1,
    };
    if (!storeRow(row)) return null;
    prune(user);
    return announce(user, row, !live, quiet, user === 'test' && notice.push === false);
}

function storeRow(row) {
    try {
        database()
            .prepare(
                `INSERT INTO notices (user, id, app, cls, title, text, actions, data, createdAt, expiresAt, state, actedBy, updatedAt, digest)
                 VALUES (@user, @id, @app, @cls, @title, @text, @actions, @data, @createdAt, @expiresAt, @state, @actedBy, @updatedAt, @digest)
                 ON CONFLICT (user, id) DO UPDATE SET app=excluded.app, cls=excluded.cls, title=excluded.title, text=excluded.text,
                     actions=excluded.actions, data=excluded.data, expiresAt=excluded.expiresAt, state=excluded.state, actedBy=NULL, updatedAt=excluded.updatedAt,
                     digest=excluded.digest,
                     createdAt=CASE WHEN @fresh = 1 THEN excluded.createdAt ELSE createdAt END`
            )
            .run(row);
        return true;
    } catch (e) {
        console.warn(`[notify-inbox] publish failed: ${e.message}`);
        return false;
    }
}

/**
 * Take items out of the live stacks of a user: match(itemId) says which; fragment is a cheap pre-filter of the stored JSON.
 * Silent (the page and the phones are told the way a silent update is). @returns how many items went
 */
function stackRemove(user, match, fragment, device) {
    let rows = [];
    try {
        rows = database().prepare("SELECT * FROM notices WHERE user = ? AND substr(id, 1, 6) = 'stack:' AND state NOT IN ('acted', 'cleared') AND instr(data, ?) > 0").all(user, fragment);
    } catch (_e) { return 0; }
    let removed = 0;
    for (const r of rows) {
        const d = safeJson(r.data, {});
        const held = Array.isArray(d.items) ? d.items : [];
        const keep = held.filter((x) => !(x && match(String(x.id))));
        const gone = held.length - keep.length;
        if (!gone) continue;
        removed += gone;
        const count = Math.max(0, (Number(d.count) || held.length) - gone);
        if (!keep.length || !count) { ack(user, r.id, 'cleared', device); continue; }
        const key = String(d.stack || r.id.slice(6));
        const view = stackView(key, keep, count);
        const now = nowFn();
        try {
            database().prepare('UPDATE notices SET title = ?, text = ?, actions = ?, data = ?, updatedAt = ? WHERE user = ? AND id = ?')
                .run(view.title, view.text, JSON.stringify(keep[0].actions || []), JSON.stringify({ stack: key, count, lastAt: d.lastAt, items: keep }), now, user, r.id);
        } catch (e) { console.warn(`[notify-inbox] stack update failed: ${e.message}`); continue; }
        const fresh = noticeRow(user, r.id);
        if (fresh) announce(user, fresh, false, !!fresh.cls && quietClasses(user).has(fresh.cls), false);
    }
    return removed;
}

// A class that is worse news than another: moving up it is material even when the text digest is the same (the weather
// alert that turned severe sounds once more; the reverse does not). Extend with a pair when another class gets levels.
const CLASS_RANK = { 'weather-alert': 1, 'weather-severe': 2 };
const classRank = (cls) => CLASS_RANK[cls] || 0;

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
// what the notice says, not its class: a class moving up is the rank rule's to judge, moving down is no news
const defaultDigest = (title, text, stamp) => sha1(`d2|${title}|${text}|${stamp || ''}`);
// the first form (Nov 25, 15:23 to this fix) also hashed the class: a row stored then still matches its own words
const firstDigest = (cls, title, text, stamp) => sha1(`${cls}|${title}|${text}|${stamp || ''}`);

/** Did the notice change materially from the stored row (cur), by digest; a legacy row without one is judged on what it stored. */
function digestChanged(cur, row, custom) {
    if (cur.digest) {
        if (cur.digest === row.digest) return false;
        return custom || cur.digest !== firstDigest(cur.cls, row.title, row.text, safeJson(row.data, {}).stamp);
    }
    if (custom) return cur.title !== row.title;
    return defaultDigest(cur.title, cur.text, safeJson(cur.data, {}).stamp) !== row.digest;
}

/**
 * The notices held for a user: not expired, in orderNotices' order (fresh ones newest first, then by prio); cleared ones left out unless asked.
 * since (ms, #890 round 5 W2): only the rows created or changed (a state moved on) at or after it - the
 * page sends the newest createdAt / updatedAt it holds and merges the rows by id. Cleared rows are
 * included then (the page closes its copy); expired and pruned rows are not (the page drops a notice
 * past its expiresAt itself).
 */
function list(user, { since = 0, includeCleared = false } = {}) {
    const u = qu(user);
    const now = nowFn();
    const from = Number(since) || 0;
    try {
        if (from > 0) {
            return orderNotices(database()
                .prepare('SELECT * FROM notices WHERE user = ? AND (createdAt >= ? OR updatedAt >= ?) AND (expiresAt IS NULL OR expiresAt > ?) ORDER BY createdAt DESC LIMIT ?')
                .all(u, from, from, now, MAX_PER_USER)
                .map(rowOut), now);
        }
        const rows = database()
            .prepare('SELECT * FROM notices WHERE user = ? AND (expiresAt IS NULL OR expiresAt > ?) ORDER BY createdAt DESC LIMIT ?')
            .all(u, now, MAX_PER_USER);
        return orderNotices(rows.filter((r) => includeCleared || r.state !== 'cleared').map(rowOut), now);
    } catch (e) {
        console.warn(`[notify-inbox] list failed: ${e.message}`);
        return [];
    }
}

/** How many notices a full list holds (not expired, not cleared): inbox_list's total. */
function count(user) {
    const u = qu(user);
    try {
        const r = database()
            .prepare("SELECT COUNT(*) AS n FROM notices WHERE user = ? AND state != 'cleared' AND (expiresAt IS NULL OR expiresAt > ?)")
            .get(u, nowFn());
        return Math.min(MAX_PER_USER, (r && r.n) || 0);
    } catch (_e) {
        return 0;
    }
}

/** One notice as stored (any state, expired too until pruned), or null: a producer's own check of what it already said. */
function get(user, id) {
    const r = noticeRow(qu(user), String(id || ''));
    return r ? rowOut(r) : null;
}

/** Move a notice on: 'seen' (shown somewhere), 'acted' (a button used) or 'cleared' (dismissed/swiped). */
function ack(user, id, state, device) {
    const u = qu(user);
    if (!STATES.has(state) || state === 'new') return false;
    try {
        const cur = database().prepare('SELECT state FROM notices WHERE user = ? AND id = ?').get(u, String(id || ''));
        if (!cur) {
            // not a row: maybe an item of a live stack (a mail read elsewhere, #1098); acted / cleared takes it out of the stack
            const want = String(id || '');
            if (!want) return false;
            const frag = `"id":${JSON.stringify(want)}`;
            if (state === 'seen') {
                try { return database().prepare("SELECT 1 FROM notices WHERE user = ? AND substr(id, 1, 6) = 'stack:' AND state NOT IN ('acted', 'cleared') AND instr(data, ?) > 0").get(u, frag) !== undefined; } catch (_e) { return false; }
            }
            return stackRemove(u, (x) => x === want, frag, device) > 0;
        }
        // never step back (acted/cleared outrank seen)
        const rank = { new: 0, seen: 1, acted: 2, cleared: 3 };
        const next = rank[state] >= rank[cur.state] ? state : cur.state;
        if (next === cur.state) return true; // nothing changes: no write, no broadcast
        database().prepare('UPDATE notices SET state = ?, actedBy = COALESCE(?, actedBy), updatedAt = ? WHERE user = ? AND id = ?').run(next, device ? String(device).slice(0, 60) : null, nowFn(), u, String(id || ''));
        // a notice only shown somewhere ('seen') is no news to any page: the inbox's only reader
        // (wmNotificationInbox.js onUpdated) acts on cleared / acted alone (#890 round 5). Pages that were
        // asleep for an ack list what changed when they wake (inbox_list since; websocket.js DORMANT_HOLD).
        if (next !== 'seen') broadcast(u, { type: 'inbox_updated', data: { reason: 'ack', id: String(id || ''), state: next, device: device || null } });
        if (next !== 'seen') { try { require('./phoneStatus').touch('inbox'); } catch (_e) { /* best effort (#908) */ } }
        // done with (dismissed, read or used anywhere): the phones take down their Android copy
        if (rank[next] >= 2 && rank[cur.state] < 2) phonesCleared(u, String(id || ''));
        return true;
    } catch (e) {
        console.warn(`[notify-inbox] ack failed: ${e.message}`);
        return false;
    }
}

/** Cleared: read, dismissed or gone at its source (mail read, a conversation opened). */
function clear(user, id, device) {
    return ack(user, id, 'cleared', device);
}

/**
 * Clear every notice whose id starts with prefix (an account read to the end: 'mail:<account>:').
 * @returns how many were cleared
 */
function clearWhere(user, prefix, device) {
    const u = qu(user);
    const p = String(prefix || '');
    if (!p) return 0;
    let ids = [];
    try {
        ids = database()
            .prepare("SELECT id FROM notices WHERE user = ? AND substr(id, 1, ?) = ? AND state NOT IN ('acted', 'cleared')")
            .all(u, p.length, p)
            .map((r) => r.id);
    } catch (_e) {
        return 0;
    }
    let n = 0;
    for (const id of ids) if (clear(u, id, device)) n += 1;
    // and the items of a live stack that start so (an account deleted: its mail leaves the mail stack, #1098)
    return n + stackRemove(u, (x) => x.startsWith(p), `"id":${JSON.stringify(p).slice(0, -1)}`, device);
}

/** The notice is done with: every partnered phone cancels its Android notification (#876). */
function phonesCleared(user, id) {
    if (!gr || !id) return;
    try { require('./activeSync').sendInboxCleared(gr, null, { user, id }); } catch (e) { console.warn(`[notify-inbox] phones (cleared): ${e.message}`); }
}

// ---- the phone's display choices (Settings > Sounds & Notifications: Display message on screen) ----

// as shipped every class is shown (the Director's turn finished too since Nov 16: wmShell SND_EVENTS display: true)
const DEFAULT_QUIET = [];
const quietCache = new Map();

function quietClasses(user) {
    const u = qu(user);
    if (quietCache.has(u)) return quietCache.get(u);
    let list = DEFAULT_QUIET;
    try {
        const r = database().prepare("SELECT value FROM prefs WHERE user = ? AND key = 'quiet'").get(u);
        if (r) list = safeJson(r.value, DEFAULT_QUIET);
    } catch (_e) {
        list = DEFAULT_QUIET;
    }
    const set = new Set(Array.isArray(list) ? list.map(String) : DEFAULT_QUIET);
    quietCache.set(u, set);
    return set;
}

/** The phone page reports the classes it shows without a message; they are stored seen and never posted. */
/** A plain per-user preference (phoneStatus: Messaging's icon choices, #908). */
function getPref(user, key) {
    const u = qu(user);
    try { const r = database().prepare('SELECT value FROM prefs WHERE user = ? AND key = ?').get(u, String(key)); return r ? r.value : ''; } catch (_e) { return ''; }
}
function setPref(user, key, value) {
    const u = qu(user);
    try {
        database().prepare('INSERT INTO prefs (user, key, value) VALUES (?, ?, ?) ON CONFLICT (user, key) DO UPDATE SET value = excluded.value').run(u, String(key), String(value));
    } catch (e) { console.warn(`[notify-inbox] pref failed: ${e.message}`); return false; }
    try { require('./phoneStatus').touch('prefs'); } catch (_e) { /* best effort */ }
    return true;
}

function setQuiet(user, classes) {
    const u = qu(user);
    const list = [...new Set((Array.isArray(classes) ? classes : []).map((c) => String(c || '').trim()).filter((c) => /^[a-z0-9-]{1,40}$/.test(c)))].slice(0, 80);
    try {
        database()
            .prepare("INSERT INTO prefs (user, key, value) VALUES (?, 'quiet', ?) ON CONFLICT (user, key) DO UPDATE SET value = excluded.value")
            .run(u, JSON.stringify(list));
    } catch (e) {
        console.warn(`[notify-inbox] prefs failed: ${e.message}`);
        return null;
    }
    quietCache.set(u, new Set(list));
    return list;
}

/** Drop a user's expired notices, and old or surplus ones (keep the newest MAX_PER_USER). */
function prune(user) {
    const u = qu(user);
    const now = nowFn();
    try {
        const d = database();
        // expired ones a phone may still show: it takes them down
        const gone = d
            .prepare("SELECT id FROM notices WHERE user = ? AND state NOT IN ('acted', 'cleared') AND ((expiresAt IS NOT NULL AND expiresAt <= ?) OR createdAt < ?)")
            .all(u, now, now - KEEP_MS)
            .map((r) => r.id);
        gone.forEach((id) => phonesCleared(u, id));
        d.prepare('DELETE FROM notices WHERE user = ? AND ((expiresAt IS NOT NULL AND expiresAt <= ?) OR createdAt < ?)').run(u, now, now - KEEP_MS);
        d.prepare('DELETE FROM notices WHERE user = ? AND id NOT IN (SELECT id FROM notices WHERE user = ? ORDER BY createdAt DESC LIMIT ?)').run(u, u, MAX_PER_USER);
        d.prepare('DELETE FROM deliveries WHERE user = ? AND (sentAt < ? OR id NOT IN (SELECT id FROM notices WHERE user = ?))').run(u, now - 2 * 24 * 60 * 60 * 1000, u);
    } catch (_e) {
        /* best effort */
    }
}

// ---- phones that were away: their background link catches up on what it missed (#889) ----

const CATCH_UP_MS = 24 * 60 * 60 * 1000;

/**
 * The notices a phone's background link may have missed: still new (not seen, used or cleared anywhere),
 * not expired, not a quiet class, from the last 24 h; in orderNotices' order (the top one first, #1098).
 */
function pendingForPhones(user) {
    const u = qu(user);
    const now = nowFn();
    const quiet = quietClasses(u);
    try {
        return orderNotices(database()
            .prepare("SELECT * FROM notices WHERE user = ? AND state = 'new' AND createdAt >= ? AND (expiresAt IS NULL OR expiresAt > ?) ORDER BY createdAt DESC LIMIT 50")
            .all(u, now - CATCH_UP_MS, now)
            .filter((r) => !(r.cls && quiet.has(r.cls)))
            .map(rowOut), now);
    } catch (e) {
        console.warn(`[notify-inbox] pending failed: ${e.message}`);
        return [];
    }
}

/**
 * A notice is sent to a phone once, the moment it is published; a phone whose background link was down
 * then (asleep, changing networks, the app restarting) never had it. When that link says hello again the
 * backlog is NOT posted one by one - ONE notice goes, the newest, and quietly (Yukimi, Nov 25 2026: "every
 * restart results in a massive stack of notifications. drop them all"). A catch-up is the whole backlog of
 * a link that was down, and a notification per row in it buries the phone. Nothing is lost: every one of
 * them is in the inbox still - the "..." holder lists them all and the title bar's count is theirs - so the
 * single notice is the quiet pointer to them, and the phone's answer still confirms it.
 */
function staleCatchUpMs() {
    try { return require('./callFilter').staleMs(); } catch (_e) { return 30 * 60 * 1000; }
}
function catchUpPhone(deviceId) {
    if (!gr || !deviceId) return 0;
    let sent = 0;
    const as = require('./activeSync');
    // what this phone already confirmed is not sent again (a hello on every network change would re-send it all)
    let done = new Set();
    try { done = new Set(database().prepare('SELECT user, id FROM deliveries WHERE device = ? AND postedAt IS NOT NULL').all(String(deviceId)).map((r) => `${r.user}\u0000${r.id}`)); } catch (_e) { /* send all */ }
    // a test device catches up on the test lane only; a real phone never on it. The test lane is a fetch lane
    // (the emulator harness reads what it was sent, modules/testDevices.js), so it still gets every notice.
    for (const user of (isTestDevice(deviceId) ? ['test'] : ['admin', 'dev_admin'])) {
        const testLane = user === 'test';
        // the top of the order first (pendingForPhones, #1098): the one notice a real phone's catch-up carries; the test lane
        // gets all of them, oldest first so the top one lands on top of its shade
        const missed = pendingForPhones(user).filter((n) => !done.has(`${user}\u0000${n.id}`));
        if (!missed.length) continue;
        const batch = testLane ? missed.slice().reverse() : missed;
        for (const n of batch) {
            // a text / call notice from before a long absence is not replayed at all (a flood on return, #1107):
            // the summary counts it
            if ((n.cls === 'sms' || n.cls === 'call') && nowFn() - Number(n.createdAt || 0) > staleCatchUpMs()) {
                try { require('./callFilter').noteSkipped(n); } catch (_e) { /* best effort */ }
                continue;
            }
            const sentTo = [];
            try { sent += as.sendInboxNotice(gr, null, Object.assign({ user }, n, { alert: testLane, catchUp: true }), { deviceId, sentTo }); } catch (_e) { /* the link went again */ }
            // a fresh round of tries for it (the app confirms it, or says it showed it already)
            sentTo.forEach((device) => noteSent(device, user, n.id, testLane, true));
            if (!testLane) break; // a real phone's catch-up is the one top notice (a stale text above it is skipped, not sent)
        }
        if (!testLane && missed.length > 1) console.log(`[notify-inbox] ${deviceId}: catch-up carries the top of ${missed.length} waiting notice(s); the rest stay in the inbox`);
    }
    if (sent) console.log(`[notify-inbox] ${deviceId}: caught up ${sent} notice(s)`);
    return sent;
}

// ---- delivery to the phones: confirmed, else sent again (#908, rule cafeready-background: "as if a life depends on it") ----
//
// Every notice sent to a phone's background link is a delivery row until the app confirms it (as_event 'inbox.posted'
// { id, how }: posted natively, shown by a page that confirmed, or already shown). Unconfirmed, it is sent again after
// RESEND_MS[attempt] (a link that looked alive but was not, a lost frame) and on every hello of that phone (catchUpPhone),
// and the rows outlive a server restart. A notice no longer new (seen, used, cleared anywhere) or expired is not sent again.

const RESEND_MS = [15000, 45000, 120000, 300000];
let resendTimer = null;

function noteSent(device, user, id, alert, fresh) {
    try {
        database().prepare(`INSERT INTO deliveries (device, user, id, sentAt, attempts, alert, postedAt, how) VALUES (?, ?, ?, ?, 1, ?, NULL, NULL)
            ON CONFLICT (device, user, id) DO UPDATE SET sentAt = excluded.sentAt, alert = excluded.alert,
                attempts = CASE WHEN ? THEN 1 ELSE attempts + 1 END, postedAt = NULL, how = NULL`)
            .run(String(device), user, String(id), nowFn(), alert ? 1 : 0, fresh ? 1 : 0);
    } catch (e) {
        console.warn(`[notify-inbox] delivery not kept: ${e.message}`);
        return;
    }
    armResend();
}

/** The app confirmed a notice (as_event inbox.posted from its background link). */
function confirmed(device, id, how) {
    if (!device || !id) return;
    try {
        database().prepare('UPDATE deliveries SET postedAt = ?, how = ? WHERE device = ? AND id = ? AND postedAt IS NULL')
            .run(nowFn(), String(how || 'posted').slice(0, 20), String(device), String(id));
    } catch (_e) { /* a later resend asks again */ }
}

function openDeliveries(device) {
    const now = nowFn();
    try {
        return database().prepare(`SELECT d.device, d.user, d.id, d.sentAt, d.attempts, d.alert FROM deliveries d
            JOIN notices n ON n.user = d.user AND n.id = d.id
            WHERE d.postedAt IS NULL AND n.state = 'new' AND (n.expiresAt IS NULL OR n.expiresAt > ?)${device ? ' AND d.device = ?' : ''}
            ORDER BY d.sentAt ASC LIMIT 200`).all(...(device ? [now, String(device)] : [now]));
    } catch (_e) { return []; }
}

/** The delivery rows of a queue (the test devices' harness reads what each phone confirmed, /api/test-devices). */
function deliveries(user, device) {
    try {
        return database().prepare(`SELECT device, id, sentAt, attempts, alert, postedAt, how FROM deliveries WHERE user = ?${device ? ' AND device = ?' : ''} ORDER BY sentAt DESC LIMIT 200`)
            .all(...(device ? [qu(user), String(device)] : [qu(user)]));
    } catch (_e) { return []; }
}

/** One timer, only while a delivery waits for its confirmation; it sleeps until the next one is due. */
function armResend() {
    if (resendTimer || process.env.NOTIFICATION_INBOX_NO_TIMER) return;
    const rows = openDeliveries(null).filter((r) => r.attempts <= RESEND_MS.length);
    if (!rows.length) return;
    const now = nowFn();
    const due = Math.min(...rows.map((r) => r.sentAt + RESEND_MS[r.attempts - 1]));
    resendTimer = setTimeout(() => { resendTimer = null; resendDue(); }, Math.max(1000, due - now));
    if (resendTimer.unref) resendTimer.unref();
}

function noticeRow(user, id) {
    try { return database().prepare('SELECT * FROM notices WHERE user = ? AND id = ?').get(user, id); } catch (_e) { return null; }
}

function resend(r, why) {
    const n = noticeRow(r.user, r.id);
    if (!n) return false;
    const sentTo = [];
    try {
        require('./activeSync').sendInboxNotice(gr, null, Object.assign({ user: r.user }, rowOut(n), { alert: !!r.alert, resent: true }), { deviceId: r.device, sentTo });
    } catch (_e) { /* the link went */ }
    if (!sentTo.length) return false;
    noteSent(r.device, r.user, r.id, !!r.alert, false);
    console.log(`[notify-inbox] ${r.device.slice(0, 8)}: ${r.id} sent again (${why}, attempt ${r.attempts + 1})`);
    return true;
}

function resendDue() {
    const now = nowFn();
    for (const r of openDeliveries(null)) {
        if (r.attempts > RESEND_MS.length) continue;
        if (r.sentAt + RESEND_MS[r.attempts - 1] > now) continue;
        // the phone's link is down: its hello sends it again; count the attempt so the timer does not spin
        if (!resend(r, 'not confirmed')) {
            try { database().prepare('UPDATE deliveries SET attempts = attempts + 1, sentAt = ? WHERE device = ? AND user = ? AND id = ?').run(now, r.device, r.user, r.id); } catch (_e) { /* next tick */ }
        }
    }
    armResend();
}

let helloTapped = false;
function tapPhoneHellos() {
    if (helloTapped || !gr) return;
    let as;
    try { as = require('./activeSync'); } catch (_e) { return; }
    if (typeof as.onDeviceHello !== 'function') return;
    helloTapped = true;
    if (typeof as.onDeviceEvent === 'function') {
        as.onDeviceEvent((name, detail, me) => {
            if (name === 'inbox.posted' && me && me.id && detail && detail.id) confirmed(me.id, detail.id, detail.how);
            // any other notice news from a phone's app (a dismissal in its shade, #1194) is logged: proof of which hop arrived
            else if (/^inbox\./.test(String(name || ''))) console.log(`[notify-inbox] phone event ${name} ${detail && detail.id ? String(detail.id).slice(0, 80) : ''} from device ${String((me && me.id) || '?').slice(0, 8)}`);
        });
    }
    // deliveries a restart left unconfirmed
    armResend();
    as.onDeviceHello((d) => {
        if (!d || d.speaker !== 'service' || d.session !== 'partner') return;
        // after the hello reply, once the link is settled
        const t = setTimeout(() => catchUpPhone(d.id), 1500);
        if (t.unref) t.unref();
    });
}

function server() {
    return gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
}

/**
 * The open sockets' client records (ws server.clients): who is connected right now. The Director turn notice asks it
 * whether she is watching the chat the turn belongs to (notificationInboxSources present, #1168).
 */
function clients() {
    const out = [];
    try {
        const srv = server();
        if (!srv || !srv.clients || typeof srv.clients.forEach !== 'function') return out;
        srv.clients.forEach((info, ws) => { if (info && (!ws || ws.readyState === undefined || ws.readyState === 1)) out.push(info); });
    } catch (_e) { /* none */ }
    return out;
}

function broadcast(user, message) {
    try {
        const srv = server();
        if (!srv || typeof srv.broadcast !== 'function') return;
        const want = (info) => !!(info && info.authenticated !== false && userOf(info) === user);
        srv.broadcast(Object.assign({ timestamp: new Date().toISOString() }, message), want);
    } catch (e) {
        console.warn(`[notify-inbox] broadcast skipped: ${e.message}`);
    }
}

module.exports = {
    bind,
    publish,
    get,
    list,
    count,
    ack,
    clear,
    clearWhere,
    setQuiet,
    quietClasses,
    prune,
    userOf,
    pendingForPhones,
    orderNotices,
    catchUpPhone,
    deliveries,
    confirmed,
    getPref,
    setPref,
    openDeliveries,
    broadcast,
    clients,
    _test: {
        resendDue,
        database,
        setNow: (fn) => {
            nowFn = fn || (() => Date.now());
        },
        reset: () => {
            if (db) db.close();
            db = null;
            quietCache.clear();
        },
    },
};
