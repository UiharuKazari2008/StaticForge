/*
 * CaféReady task "hour-chime" (StaticForge #1108, rule cafeready-background): the hour / half-hour reminder, like the
 * Android hourly-chime apps, run by the Android app with the page asleep, killed or never opened.
 *
 * Input:  push status.snapshot { fields: { chime } }   chime { mode, hourSound, halfSound, strike }  (modules/hourChime.js)
 *           mode       'off' | 'hour' | 'half'   every hour on the hour / every half hour (on the hour and at :30)
 *           hourSound  the sound name the hour plays (a file of the app's sound set)
 *           halfSound  the sound name the half hour plays
 *           strike     true: the tones tell the time - the hour plays its sound once per hour (1-12, a 24 h clock folded
 *                      to 12), the half hour plays it once
 *         timer {}    the slot came (ctx.timer; inexact, so the slot is worked out again from the clock)
 *         wake {}     the screen came on / the engine restarted: the next slot is set again
 * Output: ctx.notify({ id: 'chime:<slot epoch>', kind: 'chime', title, text, sound, strikes }) at each slot,
 *         ctx.output({ mode, next }) for the page's settings view. The id is per slot, so a slot that fires twice (a timer
 *         that came early, a restart) is one notice (the app de-duplicates by id).
 * Time is the phone's own clock (its zone); the server has no timer for this.
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks;
    if (!C) return;

    const SLOT_MS = 1800000;
    const MODES = { off: 0, hour: 3600000, half: 1800000 };
    // a timer may come a little early: within this of a slot counts as the slot
    const EARLY_MS = 20000;
    // a slot the engine missed (asleep) is still announced only when it is this recent
    const LATE_MS = 120000;

    const lib = {
        /** The next slot strictly after `at` (epoch ms) for `mode`, on the phone's local clock, or 0 (off). */
        nextSlot(mode, at) {
            const step = MODES[mode] || 0;
            if (!step) return 0;
            const d = new Date(at);
            // local midnight-anchored grid, so a zone with a half hour offset still chimes on its own :00 / :30
            const base = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
            for (let k = 0; k <= 2; k++) {
                const t = base + k * SLOT_MS;
                if (t > at && (k * SLOT_MS) % step === 0) return t;
            }
            return base + 3600000;
        },
        /** The slot (epoch ms) that `now` is at or just after, within the early / late bounds, or 0. */
        dueSlot(mode, now) {
            if (!MODES[mode]) return 0;
            const early = lib.nextSlot(mode, now);
            if (early && early - now <= EARLY_MS) return early;
            const d = new Date(now - LATE_MS);
            const prev = lib.nextSlot(mode, d.getTime());
            return prev && prev <= now ? prev : 0;
        },
        /** What the slot plays: hour -> hourSound (strikes: the hour on a 12 h dial when strike), half -> halfSound once. */
        plan(c, slot) {
            const d = new Date(slot);
            const onHour = d.getMinutes() === 0;
            const h12 = d.getHours() % 12 || 12;
            const pad = (n) => (n < 10 ? '0' : '') + n;
            const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            return {
                sound: String((onHour ? c.hourSound : c.halfSound) || ''),
                strikes: onHour ? (c.strike ? h12 : 1) : 1,
                title: time,
                text: onHour ? `It is ${time}.` : `Half past ${d.getHours() % 12 || 12}.`
            };
        }
    };
    C.lib.hourChime = lib;

    function refresh(ctx, fired) {
        const s = ctx.state;
        const c = s.chime || {};
        const now = ctx.now;
        if (MODES[c.mode]) {
            const due = lib.dueSlot(c.mode, now);
            if (due && due > (s.last || 0)) {
                s.last = due;
                const p = lib.plan(c, due);
                ctx.notify({ id: `chime:${due}`, kind: 'chime', title: p.title, text: p.text, sound: p.sound, strikes: p.strikes });
            }
        }
        const next = MODES[c.mode] ? lib.nextSlot(c.mode, now) : 0;
        if (next !== s.timerAt || fired) {
            s.timerAt = next;
            ctx.timer(next ? Math.max(1000, next - now) : 0);
        }
        const sig = `${c.mode || 'off'}|${next}`;
        if (sig !== s.outSig) { s.outSig = sig; ctx.output({ mode: c.mode || 'off', next }); }
    }

    C.define({
        name: 'hour-chime',
        api: 1,
        init(s) { Object.assign(s, { chime: null, last: 0, timerAt: 0, outSig: '' }); },
        on: {
            start(ctx) { ctx.state.timerAt = 0; refresh(ctx); },
            push(ctx, p) {
                if (p.type !== 'status.snapshot' || !p.data || !p.data.fields || !p.data.fields.chime) return;
                ctx.state.chime = p.data.fields.chime;
                refresh(ctx);
            },
            wake(ctx) { refresh(ctx); },
            timer(ctx) { ctx.state.timerAt = 0; refresh(ctx, true); }
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
