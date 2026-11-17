'use strict';

/**
 * The session store's write per request (#890). express-session ends every request on an existing,
 * unchanged session with store.touch(): for connect-sqlite3 an UPDATE of the row's expiry, and the
 * reply waits for it (writeend after the touch callback). Phones make many small requests, so each
 * one waited on a write (and, before the WAL fix, an fsync) to sessions.sqlite.
 *
 *  - synchronous = NORMAL on the store's connection: in WAL mode a commit no longer waits for an
 *    fsync (a power cut may lose the last few touches; never a corrupt file).
 *  - touch() skips a session it touched (or saved) within TOUCH_SKIP_MS. Sessions last 7 days
 *    (web_server.js cookie maxAge) and the browser's cookie is only set when the session is saved
 *    (rolling is off), so the stored expiry stays at or after the cookie's: the row can only end up to
 *    TOUCH_SKIP_MS earlier than "7 days after the last request" for a session idle that long, which a
 *    cookie set at login or at a later save has already outlived. Session lifetime is unchanged.
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
    if (db && typeof db.run === 'function') {
        db.run('PRAGMA synchronous = NORMAL', (err) => {
            if (err) console.warn('⚠️ Session store: PRAGMA synchronous failed:', err.message);
        });
    }
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
            return set(sid, session, (err, ...rest) => {
                if (!err) note(sid); else touched.delete(sid);
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
