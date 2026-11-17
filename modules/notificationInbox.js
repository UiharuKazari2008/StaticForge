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
            PRIMARY KEY (user, id)
        );
        CREATE INDEX IF NOT EXISTS notices_user_created ON notices (user, createdAt);
        CREATE TABLE IF NOT EXISTS prefs (
            user TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (user, key)
        );
    `);
    return db;
}

function userOf(info) {
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
        expiresAt: r.expiresAt || null,
        state: r.state,
        actedBy: r.actedBy || null,
    };
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
    const user = notice.user === 'dev_admin' ? 'dev_admin' : 'admin';
    const now = nowFn();
    const expiresAt = Number.isFinite(Number(notice.ttlMs)) && Number(notice.ttlMs) > 0 ? now + Number(notice.ttlMs) : (Number.isFinite(Number(notice.expiresAt)) ? Number(notice.expiresAt) : null);
    if (expiresAt && expiresAt <= now) return null;
    const cls = String(notice.cls || notice.kind || '').slice(0, 60);
    // a class the phone shows without a message (Sounds & Notifications: Display message on screen off):
    // kept for the title bar's state, never popped on resume nor posted on Android
    const quiet = !!cls && quietClasses(user).has(cls);
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
    // does this publish sound on the phones (#889)? A new notice, one already done with (cleared, acted),
    // or the producer saying it is a new event under the same id (the next message in a conversation).
    // A notice changing in place (a countdown step, a commute update, the same text again) is silent.
    let alert = true;
    try {
        const cur = database().prepare('SELECT state, title, text FROM notices WHERE user = ? AND id = ?').get(user, id);
        if (cur && cur.state !== 'acted' && cur.state !== 'cleared' && notice.alert !== true) alert = false;
    } catch (_e) { /* a new table: new */ }
    row.fresh = alert ? 1 : 0;
    try {
        database()
            .prepare(
                `INSERT INTO notices (user, id, app, cls, title, text, actions, data, createdAt, expiresAt, state, actedBy, updatedAt)
                 VALUES (@user, @id, @app, @cls, @title, @text, @actions, @data, @createdAt, @expiresAt, @state, @actedBy, @updatedAt)
                 ON CONFLICT (user, id) DO UPDATE SET app=excluded.app, cls=excluded.cls, title=excluded.title, text=excluded.text,
                     actions=excluded.actions, data=excluded.data, expiresAt=excluded.expiresAt, state=excluded.state, actedBy=NULL, updatedAt=excluded.updatedAt,
                     createdAt=CASE WHEN @fresh = 1 THEN excluded.createdAt ELSE createdAt END`
            )
            .run(row);
        prune(user);
    } catch (e) {
        console.warn(`[notify-inbox] publish failed: ${e.message}`);
        return null;
    }
    const out = Object.assign(rowOut(row), { alert });
    broadcast(user, { type: 'inbox_updated', data: { reason: 'new', notice: out } });
    // the phones' background links too (#876 D): a phone whose page is not running posts it natively
    if (!quiet) {
        try { require('./activeSync').sendInboxNotice(gr, null, Object.assign({ user }, out)); } catch (e) { console.warn(`[notify-inbox] phones: ${e.message}`); }
    }
    return out;
}

/** The notices held for a user: not expired, newest first; cleared ones left out unless asked. */
function list(user, { since = 0, includeCleared = false } = {}) {
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
    const now = nowFn();
    try {
        const rows = database()
            .prepare('SELECT * FROM notices WHERE user = ? AND createdAt >= ? AND (expiresAt IS NULL OR expiresAt > ?) ORDER BY createdAt DESC LIMIT ?')
            .all(u, Number(since) || 0, now, MAX_PER_USER);
        return rows.filter((r) => includeCleared || r.state !== 'cleared').map(rowOut);
    } catch (e) {
        console.warn(`[notify-inbox] list failed: ${e.message}`);
        return [];
    }
}

/** Move a notice on: 'seen' (shown somewhere), 'acted' (a button used) or 'cleared' (dismissed/swiped). */
function ack(user, id, state, device) {
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
    if (!STATES.has(state) || state === 'new') return false;
    try {
        const cur = database().prepare('SELECT state FROM notices WHERE user = ? AND id = ?').get(u, String(id || ''));
        if (!cur) return false;
        // never step back (acted/cleared outrank seen)
        const rank = { new: 0, seen: 1, acted: 2, cleared: 3 };
        const next = rank[state] >= rank[cur.state] ? state : cur.state;
        if (next === cur.state) return true; // nothing changes: no write, no broadcast
        database().prepare('UPDATE notices SET state = ?, actedBy = COALESCE(?, actedBy), updatedAt = ? WHERE user = ? AND id = ?').run(next, device ? String(device).slice(0, 60) : null, nowFn(), u, String(id || ''));
        broadcast(u, { type: 'inbox_updated', data: { reason: 'ack', id: String(id || ''), state: next, device: device || null } });
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
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
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
    return n;
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
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
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
function setQuiet(user, classes) {
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
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
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
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
    } catch (_e) {
        /* best effort */
    }
}

// ---- phones that were away: their background link catches up on what it missed (#889) ----

const CATCH_UP_MS = 24 * 60 * 60 * 1000;

/**
 * The notices a phone's background link may have missed: still new (not seen, used or cleared anywhere),
 * not expired, not a quiet class, from the last 24 h; oldest first.
 */
function pendingForPhones(user) {
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
    const now = nowFn();
    const quiet = quietClasses(u);
    try {
        return database()
            .prepare("SELECT * FROM notices WHERE user = ? AND state = 'new' AND createdAt >= ? AND (expiresAt IS NULL OR expiresAt > ?) ORDER BY createdAt ASC LIMIT 50")
            .all(u, now - CATCH_UP_MS, now)
            .filter((r) => !(r.cls && quiet.has(r.cls)))
            .map(rowOut);
    } catch (e) {
        console.warn(`[notify-inbox] pending failed: ${e.message}`);
        return [];
    }
}

/**
 * A notice is sent to a phone once, the moment it is published; a phone whose background link was down
 * then (asleep, changing networks, the app restarting) never had it. When that link says hello again,
 * the notices still new are sent once more, marked catchUp: the app posts the ones it has not posted
 * and sounds only the newest.
 */
function catchUpPhone(deviceId) {
    if (!gr || !deviceId) return 0;
    let sent = 0;
    const as = require('./activeSync');
    for (const user of ['admin', 'dev_admin']) {
        for (const n of pendingForPhones(user)) {
            try { sent += as.sendInboxNotice(gr, null, Object.assign({ user }, n, { alert: true, catchUp: true }), { deviceId }); } catch (_e) { /* the link went again */ }
        }
    }
    if (sent) console.log(`[notify-inbox] ${deviceId}: caught up ${sent} notice(s)`);
    return sent;
}

let helloTapped = false;
function tapPhoneHellos() {
    if (helloTapped || !gr) return;
    let as;
    try { as = require('./activeSync'); } catch (_e) { return; }
    if (typeof as.onDeviceHello !== 'function') return;
    helloTapped = true;
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
    list,
    ack,
    clear,
    clearWhere,
    setQuiet,
    quietClasses,
    prune,
    userOf,
    pendingForPhones,
    catchUpPhone,
    _test: {
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
