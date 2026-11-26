/*
 * CaféReady task "car-presence" (StaticForge #1205, rule cafeready-background): tells the server she is at the car, run by
 * the Android app with the page asleep, killed or never opened.
 *
 * Why: a remote start (Lapis Remote) is watched on the server on its timer - "N minutes left" notices and a cached read
 * every 3 minutes. Once she is in the car that is noise, and the lock state the car key reports (unlocked) should reach
 * the status bar. The server cannot see either; the phone can.
 *
 * Events:
 *   car { connected, keyInRange, keyText, car, at }   the app's car state changed: the car's Bluetooth is connected,
 *       Samsung Digital Key sees the car, and the Digital Key "Car Detection" notification text ("Car in range.",
 *       which says unlocked / locked once the key has worked the doors)
 *   drive { state, ... }                              the app's drive state (DSApp DriveState), only on a change
 * In the car = the car's Bluetooth connected, or the drive state driving / parked_in_car. The lock word is "unlocked" or
 * "locked" from the text (empty when the key does not see the car or the text names neither).
 *
 * One request, only on a change: when she gets in the car, or when the lock word changes to a non-empty one:
 *   lapis_presence { inCar, lock, source: 'car_bt' | 'drive' | 'carkey', at }   (lock only when it changed just now)
 * Nothing on a repeat. The CaféReady link is asked for only to send (ctx.link): the request stays pending in the state
 * while the link is down and goes out on the link's connected event; the link is let go after the reply. A word older than
 * 10 minutes is dropped unsent (what it said is over). No timers, no feeds, no output.
 *
 * The pure decision is CafeTasks.lib.carPresence (scripts/test-car-presence.js).
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks;
    if (!C) return;

    const PENDING_MS = 10 * 60 * 1000;

    const lib = {
        PENDING_MS,
        /** 'unlocked' | 'locked' | '' from the Digital Key's text; empty when the key does not see the car. */
        lockOf(text, inRange) {
            if (inRange === false) return '';
            const t = String(text || '');
            if (/\bunlocked\b/i.test(t)) return 'unlocked';
            if (/\blocked\b/i.test(t)) return 'locked';
            return '';
        },
        /** Whether the state says she is in the car. */
        inCar(s) { return !!(s && (s.bt || s.drv)); },
        /**
         * One event on the state { bt, drv, lock } -> { next, send }: send is null (nothing to say) or the lapis_presence body.
         * type: 'car' | 'drive'; data: the event's data; now: epoch ms.
         */
        step(prev, type, data, now) {
            const d = data || {};
            const next = { bt: !!prev.bt, drv: !!prev.drv, lock: prev.lock || '' };
            let at = now;
            if (type === 'car') {
                next.bt = d.connected === true;
                next.lock = lib.lockOf(d.keyText, d.keyInRange);
                if (Number.isFinite(d.at) && d.at > 0) at = d.at;
            } else if (type === 'drive') {
                next.drv = d.state === 'driving' || d.state === 'parked_in_car';
            } else {
                return { next, send: null };
            }
            const rose = lib.inCar(next) && !lib.inCar(prev);
            const lockNew = !!next.lock && next.lock !== (prev.lock || '');
            if (!rose && !lockNew) return { next, send: null };
            return {
                next,
                send: { inCar: lib.inCar(next), lock: lockNew ? next.lock : '', source: lockNew ? 'carkey' : type === 'car' ? 'car_bt' : 'drive', at: Math.min(at, now) }
            };
        },
        /** Two unsent words become one: in the car if either said so, the newest lock word. */
        merge(a, b) {
            if (!a) return b;
            return { inCar: !!(a.inCar || b.inCar), lock: b.lock || a.lock || '', source: b.source, at: Math.max(a.at, b.at) };
        }
    };
    C.lib.carPresence = lib;

    const tagOf = (p) => `presence-${p.at}`;

    function flush(ctx) {
        const s = ctx.state;
        const p = s.pending;
        if (!p) return;
        if (ctx.now - p.at > PENDING_MS) { s.pending = null; return; }
        ctx.link(true);
        ctx.request('lapis_presence', p, tagOf(p));
    }

    function take(ctx, type, data) {
        const s = ctx.state;
        const r = lib.step({ bt: s.bt, drv: s.drv, lock: s.lock }, type, data, ctx.now);
        s.bt = r.next.bt;
        s.drv = r.next.drv;
        s.lock = r.next.lock;
        if (!r.send) return;
        s.pending = lib.merge(s.pending && ctx.now - s.pending.at <= PENDING_MS ? s.pending : null, r.send);
        flush(ctx);
    }

    C.define({
        name: 'car-presence',
        api: 1,
        init(s) { Object.assign(s, { bt: false, drv: false, lock: '', pending: null }); },
        on: {
            start(ctx) { flush(ctx); },
            link(ctx, d) { if (d && d.connected) flush(ctx); },
            car(ctx, d) { take(ctx, 'car', d); },
            drive(ctx, d) { take(ctx, 'drive', d); },
            reply(ctx, r) {
                if (!r || !String(r.tag || '').startsWith('presence-')) return;
                const s = ctx.state;
                // an answer to the newest word: done (or kept for the next link when the server refused it)
                if (s.pending && r.tag === tagOf(s.pending) && r.ok) s.pending = null;
                if (!s.pending || r.tag === tagOf(s.pending)) ctx.link(false);
            }
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
