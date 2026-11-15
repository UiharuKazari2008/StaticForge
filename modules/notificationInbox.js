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

function bind(globalResources) {
    if (globalResources && !gr) gr = globalResources;
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
    const row = {
        user,
        id,
        app: String(notice.app || '').slice(0, 40),
        cls: String(notice.cls || notice.kind || '').slice(0, 60),
        title: title.slice(0, 200),
        text: String(notice.text || '').slice(0, 2000),
        actions: JSON.stringify(Array.isArray(notice.actions) ? notice.actions.slice(0, 6) : []),
        data: JSON.stringify(notice.data && typeof notice.data === 'object' ? notice.data : {}),
        createdAt: now,
        expiresAt,
        state: 'new',
        actedBy: null,
        updatedAt: now,
    };
    try {
        database()
            .prepare(
                `INSERT INTO notices (user, id, app, cls, title, text, actions, data, createdAt, expiresAt, state, actedBy, updatedAt)
                 VALUES (@user, @id, @app, @cls, @title, @text, @actions, @data, @createdAt, @expiresAt, @state, @actedBy, @updatedAt)
                 ON CONFLICT (user, id) DO UPDATE SET app=excluded.app, cls=excluded.cls, title=excluded.title, text=excluded.text,
                     actions=excluded.actions, data=excluded.data, expiresAt=excluded.expiresAt, state='new', actedBy=NULL, updatedAt=excluded.updatedAt`
            )
            .run(row);
        prune(user);
    } catch (e) {
        console.warn(`[notify-inbox] publish failed: ${e.message}`);
        return null;
    }
    const out = rowOut(row);
    broadcast(user, { type: 'inbox_updated', data: { reason: 'new', notice: out } });
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
        database().prepare('UPDATE notices SET state = ?, actedBy = COALESCE(?, actedBy), updatedAt = ? WHERE user = ? AND id = ?').run(next, device ? String(device).slice(0, 60) : null, nowFn(), u, String(id || ''));
        broadcast(u, { type: 'inbox_updated', data: { reason: 'ack', id: String(id || ''), state: next, device: device || null } });
        return true;
    } catch (e) {
        console.warn(`[notify-inbox] ack failed: ${e.message}`);
        return false;
    }
}

/** Drop a user's expired notices, and old or surplus ones (keep the newest MAX_PER_USER). */
function prune(user) {
    const u = user === 'dev_admin' ? 'dev_admin' : 'admin';
    const now = nowFn();
    try {
        const d = database();
        d.prepare('DELETE FROM notices WHERE user = ? AND ((expiresAt IS NOT NULL AND expiresAt <= ?) OR createdAt < ?)').run(u, now, now - KEEP_MS);
        d.prepare('DELETE FROM notices WHERE user = ? AND id NOT IN (SELECT id FROM notices WHERE user = ? ORDER BY createdAt DESC LIMIT ?)').run(u, u, MAX_PER_USER);
    } catch (_e) {
        /* best effort */
    }
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
    prune,
    userOf,
    _test: {
        setNow: (fn) => {
            nowFn = fn || (() => Date.now());
        },
        reset: () => {
            if (db) db.close();
            db = null;
        },
    },
};
