'use strict';

/**
 * The session store's write per request (#890). express-session ends every request on an existing,
 * unchanged session with store.touch(): for connect-sqlite3 an UPDATE of the row's expiry, and the
 * reply waits for it (writeend after the touch callback). Phones make many small requests, so each
 * one waited on a write (and, before the WAL fix, an fsync) to sessions.sqlite.
 *
 *  - WAL journal, then synchronous = NORMAL on the store's connection: in WAL mode a commit no longer
 *    waits for an fsync (a power cut may lose the last few touches; never a corrupt file). WAL is set
 *    here, not with the library's concurrentDb option: its open exec() throws on any error, so a
 *    SQLITE_BUSY while the journal mode switches would crash the server. Here a failure is logged and
 *    the store keeps its rollback journal (and FULL sync, NORMAL is only safe in WAL) until the next start.
 *  - touch() skips a session it touched (or saved with its full lifetime) within TOUCH_SKIP_MS. Sessions
 *    last 7 days (web_server.js cookie maxAge) and the browser's cookie is only set when the session is
 *    saved (rolling is off), so the stored expiry stays at or after the cookie's: the row can only end up
 *    to TOUCH_SKIP_MS earlier than "7 days after the last request" for a session idle that long, which a
 *    cookie set at login or at a later save has already outlived. Session lifetime is unchanged.
 *    A save of a plain session read back with store.get (workspace.js, the gallery handler) carries no
 *    cookie.maxAge, so connect-sqlite3 stores now + 1 day for it: such a save never counts as fresh, and
 *    the next request's touch puts the full expiry back as it always did.
 *
 * Expired rows are deleted by connect-sqlite3 itself: once when the store opens and then once a day
 * (dbCleanup, DELETE ... WHERE expired < now); live sessions are never touched by it.
 */

const TOUCH_SKIP_MS = 10 * 60 * 1000;
const TOUCHED_MAX = 20000;

function tuneSessionStore(store, opts = {}) {
    if (!store || store._dsTouchTuned) return store;
    store._dsTouchTuned = true;
    const skipMs = Number.isFinite(opts.skipMs) ? opts.skipMs : TOUCH_SKIP_MS;
    const now = typeof opts.now === 'function' ? opts.now : Date.now;
    const db = store.db;
    // resolves with the journal mode once the pragmas ran (tests wait on it); never rejects
    store._dsTuneReady = new Promise((resolve) => {
        if (!db || typeof db.get !== 'function' || typeof db.run !== 'function') return resolve(null);
        db.get('PRAGMA journal_mode = WAL', (err, row) => {
            if (err) console.warn('⚠️ Session store: WAL journal not set (kept until the next start):', err.message);
            const mode = !err && row ? String(row.journal_mode || '').toLowerCase() : '';
            if (mode !== 'wal') return resolve(mode || null);
            db.run('PRAGMA synchronous = NORMAL', (err2) => {
                if (err2) console.warn('⚠️ Session store: PRAGMA synchronous failed:', err2.message);
                resolve(mode);
            });
        });
    });
    const touched = new Map(); // sid -> when its row's expiry was last written
    const forget = () => {
        // the oldest go first (a Map keeps insertion order and a write re-inserts)
        const cut = now() - skipMs;
        for (const [sid, at] of touched) {
            if (at > cut && touched.size <= TOUCHED_MAX) break;
            touched.delete(sid);
        }
    };
    const note = (sid) => {
        touched.delete(sid);
        touched.set(sid, now());
        if (touched.size > TOUCHED_MAX) forget();
    };

    if (typeof store.touch === 'function') {
        const touch = store.touch.bind(store);
        store.touch = function throttledTouch(sid, session, fn) {
            const at = touched.get(sid);
            if (at !== undefined && now() - at < skipMs) {
                if (typeof fn === 'function') fn(null, true);
                return;
            }
            note(sid);
            let answered = false;
            return touch(sid, session, (err, ...rest) => {
                // connect-sqlite3 calls back twice on an error: answer once
                if (answered) return;
                answered = true;
                if (err) touched.delete(sid);
                if (typeof fn === 'function') fn(err, ...rest);
            });
        };
    }
    if (typeof store.set === 'function') {
        const set = store.set.bind(store);
        store.set = function notedSet(sid, session, fn) {
            // fresh only when the save wrote the full lifetime: an express-session Cookie has maxAge
            // (expires - now), so the row gets now + maxAge = cookie.expires, what a touch writes. A plain
            // session from store.get has none and its row gets now + 1 day: the next touch must run.
            const cookie = session && session.cookie;
            const full = !!(cookie && Number.isFinite(cookie.maxAge) && cookie.maxAge > 0);
            if (!full) touched.delete(sid);
            return set(sid, session, (err, ...rest) => {
                if (!err && full) note(sid); else touched.delete(sid);
                if (typeof fn === 'function') fn(err, ...rest);
            });
        };
    }
    if (typeof store.destroy === 'function') {
        const destroy = store.destroy.bind(store);
        store.destroy = function forgottenDestroy(sid, fn) {
            touched.delete(sid);
            return destroy(sid, fn);
        };
    }
    const sweep = setInterval(forget, skipMs);
    if (typeof sweep.unref === 'function') sweep.unref();
    store._dsTouchSweep = sweep;
    return store;
}

module.exports = { tuneSessionStore, TOUCH_SKIP_MS };
