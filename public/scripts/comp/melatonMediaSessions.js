/**
 * Media sessions across the Dreamscape app's windows (Yukimi, Nov 21 2026: "add XM Radio and Windows Media Player into
 * that, so all media can transfer its session and know what each are doing").
 *
 * The phone screen's Melaton Mobile and the DeX desktop are two windows of one app, talking over the Continuity bus
 * (melatonContinuity.js, DSApp ContinuityBus). Each media program registers here; this module keeps both windows told
 * what every program plays in each, moves a session from one window to the other, and keeps a program from playing in
 * both at once. Outside the Android app (a browser, one window) everything here answers "nothing elsewhere".
 *
 * window.melatonMedia
 *   register(app, { label, describe() -> session | null, take(session) -> bool | Promise<bool>, release(reason) -> session | null })
 *       app: 'videos' | 'xmradio' | 'mediaplayer' (the same id on both shells: the phone and desktop programs of one
 *       app pass their sessions to each other). describe(): what plays here now (null: nothing); take(session): play
 *       that here (from where it was); release(reason): stop playing here and say what was playing (with its position).
 *       Returns an unregister function; pass { signal } as a third argument to end it with an app.
 *   changed(app)          the program started, paused, stopped or changed what it plays: the other window is told
 *   elsewhere(app)        the other window's session of that program (or null): { app, title, subtitle, playing, ... }
 *   sessions()            { here: { app: session }, there: { app: session } }
 *   pull(app)             take the other window's session here (it stops there): true when it plays here now
 *   push(app)             send this window's session to the other window (it stops here)
 *   on('change', fn)      fn({ app, session, where: 'there' }) when the other window's sessions change
 *
 * A session is plain JSON: { app, title, subtitle, kind, source: { what the program needs to play it again },
 * position (ms, optional), playing (bool), at (when described, ms) }. The receiving program decides how to use it.
 *
 * One sound per program: when a program starts playing in one window (changed() with playing: true), the same program
 * in the other window is released ('elsewhere'). Different programs may play side by side.
 *
 * Power (phone-power-client): nothing runs on a timer. Messages go only on changes, at most one per program per
 * 250 ms, and only while another window is there.
 */
(function (root) {
    'use strict';
    const C = () => root.melatonContinuity || null;
    const live = () => { const c = C(); return !!(c && c.available && c.peers().length); };

    const programs = new Map(); // app -> spec
    const here = new Map(); // app -> last session told (JSON string), for the change check
    const there = new Map(); // app -> the other window's session
    const listeners = new Set();
    const pendingTell = new Map(); // app -> timer

    function describe(app) {
        const spec = programs.get(app);
        if (!spec || typeof spec.describe !== 'function') return null;
        let s = null;
        try { s = spec.describe(); } catch (err) { console.warn('[media]', app, 'describe', err); }
        return s ? Object.assign({ app }, s, { app, at: Date.now() }) : null;
    }

    function emit(evt) {
        listeners.forEach((fn) => { try { fn(evt); } catch (err) { console.warn('[media] listener', err); } });
    }

    function sendNow(app) {
        pendingTell.delete(app);
        const s = describe(app);
        // the change check leaves out `at` (and position, which moves on its own while playing)
        const key = s ? JSON.stringify(Object.assign({}, s, { at: 0, position: s.playing ? 0 : s.position })) : '';
        if (here.get(app) === key) return;
        const wasPlaying = (() => { try { return JSON.parse(here.get(app) || 'null'); } catch (_) { return null; } })();
        here.set(app, key);
        if (!live()) return;
        C().post({ type: 'media-session', app, session: s, claim: !!(s && s.playing && !(wasPlaying && wasPlaying.playing)) });
    }

    const api = {
        register(app, spec, opts) {
            if (!app || !spec) return () => {};
            programs.set(app, spec);
            const off = () => { if (programs.get(app) === spec) { programs.delete(app); here.delete(app); if (live()) C().post({ type: 'media-session', app, session: null }); } };
            const signal = opts && opts.signal;
            if (signal) signal.addEventListener('abort', off, { once: true });
            // a program that registers while something of it plays elsewhere hears of it at once (sessions sent on join)
            return off;
        },
        changed(app) {
            if (!programs.has(app) || pendingTell.has(app)) return;
            pendingTell.set(app, setTimeout(() => sendNow(app), 250));
        },
        elsewhere(app) { return there.get(app) || null; },
        sessions() {
            const h = {};
            programs.forEach((_, app) => { const s = describe(app); if (s) h[app] = s; });
            const t = {};
            there.forEach((s, app) => { t[app] = s; });
            return { here: h, there: t };
        },
        /** Take the other window's session of `app` here. */
        async pull(app) {
            const spec = programs.get(app);
            if (!spec || !live()) return false;
            const answer = await C().ask('media-release?', { app }, 2500);
            const s = answer && answer.session;
            there.delete(app);
            if (!s) return false;
            let ok = false;
            try { ok = !!(await spec.take(s)); } catch (err) { console.warn('[media]', app, 'take', err); }
            api.changed(app);
            return ok;
        },
        /** Send this window's session of `app` to the other window. */
        push(app) {
            const spec = programs.get(app);
            if (!spec || !live() || typeof spec.release !== 'function') return false;
            let s = null;
            try { s = spec.release('pushed'); } catch (err) { console.warn('[media]', app, 'release', err); }
            if (!s) return false;
            api.changed(app);
            return C().post({ type: 'media-take', app, session: Object.assign({ app }, s) });
        },
        on(type, fn) {
            if (type !== 'change' || typeof fn !== 'function') return () => {};
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };

    function wire() {
        const c = C();
        if (!c || !c.available) return;
        // the other window's sessions, as they change
        c.on('media-session', (m) => {
            const app = m && m.app;
            if (!app) return;
            if (m.session) there.set(app, m.session); else there.delete(app);
            emit({ app, session: m.session || null, where: 'there' });
            // one sound per program: it started playing over there, so it stops here
            if (m.claim && m.session && m.session.playing) {
                const spec = programs.get(app);
                const mine = describe(app);
                if (spec && mine && mine.playing && typeof spec.release === 'function') {
                    try { spec.release('elsewhere'); } catch (err) { console.warn('[media]', app, 'release', err); }
                    api.changed(app);
                }
            }
        });
        // the other window takes this window's session: it stops here and says what it was
        c.on('media-release?', (m) => {
            const spec = programs.get(m && m.app);
            let s = null;
            if (spec && typeof spec.release === 'function') {
                try { s = spec.release('taken'); } catch (err) { console.warn('[media]', m.app, 'release', err); }
            }
            c.post({ type: 'answer', rid: m.rid, answer: { session: s ? Object.assign({ app: m.app }, s) : null } });
            if (spec) api.changed(m.app);
        });
        // the other window sends its session here
        c.on('media-take', async (m) => {
            const spec = programs.get(m && m.app);
            there.delete(m.app);
            if (!spec || !m.session) return;
            try { await spec.take(m.session); } catch (err) { console.warn('[media]', m.app, 'take', err); }
            api.changed(m.app);
        });
        // a window joins: it hears every session here; a window leaves: its sessions are gone
        c.on('peer', (m) => {
            if (m && m.state === 'joined') {
                programs.forEach((_, app) => { here.delete(app); api.changed(app); });
            } else if (m && m.state === 'left') {
                const apps = Array.from(there.keys());
                there.clear();
                apps.forEach((app) => emit({ app, session: null, where: 'there' }));
            }
        });
    }
    wire();
    // a page that loads while the other window plays: ask once for what it plays (no timer afterwards)
    if (live()) C().post({ type: 'media-hello' });
    if (C() && C().available) C().on('media-hello', () => { programs.forEach((_, app) => { here.delete(app); api.changed(app); }); });

    root.melatonMedia = api;
})(window);
