/*
 * CaféReady task "radio-mode" (StaticForge #1328, rule cafeready-background): the phone's network mode by place - a
 * saved place (a circle and a mode: NR only, LTE, NR / LTE) forces its mode, and leaving it sets the phone back to Auto.
 * Run by the Android app with the page asleep, killed or never opened. The app only reads the phone, writes the mask it
 * is given, keeps the geofences and tells this task what happened; all mode and rule meaning is here.
 *
 * Only when the start event says the host can ('radio' in host.ops); an older app: nothing at all.
 *
 * Events (each but start carries device: { supported, current, baseline }, masks or null; the last read one is kept):
 *   rules { rules, inside? }       the whole saved list; inside: places the app knows the phone is in
 *   geofence { enter, exit }       rule ids (an id in both: left)
 *   fix { lat, lon, accuracyM }    a one-shot position: leaves a place it is clearly outside, enters one it is clearly in
 *   manual { mode }                she set a mode by hand (already applied)
 *   retry { why }                  a write that failed may work now
 *   radio { ok, mode, ruleId, error }   the answer to one ctx.radio action; the host answers in the order sent
 *
 * The decisions:
 *   - A newly entered place applies the winner (the smallest circle she is in). A repeated enter does nothing.
 *   - armed: a place's mode was wanted during this stay. Out of every place while armed: Auto, also after a hand set
 *     inside. armed ends when that Auto answers ok.
 *   - A hand set is never overridden by a repeat, a retry or a late answer; only by a newly entered place, a new winner
 *     or leaving. A hand set outside every place ends the stay.
 *   - A want not yet confirmed is sent again on geofence, fix, rules and retry. Never on start: the host runs start
 *     before whatever event woke the engine, maybe the manual one. Never on a failed answer (no loop).
 *   - open: the sends not yet answered. An ok settles the want only when it answers one of them and no later send of
 *     another target waits, so the ok of an older Auto never ends a stay with a force still on the way.
 *   - A force that answers ok when nothing is wanted (a late answer) sends Auto again.
 *   - A place whose circle changed so that it no longer holds the old one is left, unless the rules event lists it in
 *     inside: the old circle's membership would never get an exit.
 * State: rules, inside, armed, want { mode, ruleId, name } | null, status ('' | sent | failed | done | hand), open,
 * forced { mode, ruleId, name, at } | null, error, device, on, outSig.
 * Output: { active, inside: [id], rule: { id, name, mode } | null (the forced one), want: mode | null, error }.
 * No timers, no position, no link, no requests, no notices.
 *
 * The pure parts are CafeTasks.lib.radio: the page's Wireless Manager uses the same functions
 * (scripts/test-radio-mode-task.js). Loads after drive-alerts.js (CafeTasks.lib.drive.distM).
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks;
    if (!C) return;

    // a mask: 20 characters, leftmost = Android network type 20 (NR), rightmost = type 1 (GPRS)
    const bit = (type) => 1 << (type - 1);
    const NR = bit(20);
    const LTE = bit(13);
    const LTE_CA = bit(19);
    const bitsOf = (m) => (typeof m === 'string' && /^[01]{20}$/.test(m) ? parseInt(m, 2) : null);
    const maskOf = (n) => n.toString(2).padStart(20, '0');

    const MODES = [{ id: 'nr', label: 'NR only' }, { id: 'auto', label: 'Auto' }, { id: 'lte', label: 'LTE' }, { id: 'nrlte', label: 'NR / LTE' }];
    // need: what the phone must support for the mode to exist; take: what the mode allows of it
    const FORCED = { nr: { need: NR, take: NR }, lte: { need: LTE, take: LTE | LTE_CA }, nrlte: { need: NR | LTE, take: NR | LTE | LTE_CA } };
    const isForced = (id) => Object.prototype.hasOwnProperty.call(FORCED, id);

    const RADII = [100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];
    const RADIUS_DEFAULT_M = 300;
    const MAX_RULES = 20;
    const MAX_FIX_ACCURACY_M = 1000;
    const MAX_OPEN = 24;

    const within = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;

    const lib = {
        MODES, RADII,
        label(id) {
            const m = MODES.find((x) => x.id === id);
            return m ? m.label : '';
        },
        /** What this phone supports, in MODES order: [{ id, label }]; none while that is unknown. */
        modes(supported) {
            if (!bitsOf(supported)) return [];
            return MODES.filter((m) => lib.maskFor(m.id, supported, null) !== null).map((m) => ({ id: m.id, label: m.label }));
        },
        /** The mask of Auto: the baseline when it is a full choice of this phone, else everything supported; null unknown. */
        autoMask(supported, baseline) {
            const s = bitsOf(supported);
            if (!s) return null;
            const b = bitsOf(baseline);
            const usable = b !== null && (b & ~s) === 0 && !!(b & LTE) && (!(s & NR) || !!(b & NR));
            return usable ? baseline : supported;
        },
        /** The mask to write for a mode, or null when this phone does not support it (or that is unknown). */
        maskFor(id, supported, baseline) {
            const s = bitsOf(supported);
            if (!s) return null;
            if (id === 'auto') return lib.autoMask(supported, baseline);
            if (!isForced(id) || (s & FORCED[id].need) !== FORCED[id].need) return null;
            return maskOf(s & FORCED[id].take);
        },
        /** The mode the phone is on: a mode id, 'other', or null when unknown. LTE_CA does not count. */
        modeOf(current, supported, baseline) {
            const c = bitsOf(current);
            if (c === null) return null;
            const v = c & ~LTE_CA;
            const auto = bitsOf(lib.autoMask(supported, baseline));
            if (auto !== null && v === (auto & ~LTE_CA)) return 'auto';
            if (v === NR) return 'nr';
            if (v === LTE) return 'lte';
            if (v === (NR | LTE)) return 'nrlte';
            return v & (NR | LTE) ? 'auto' : 'other';
        },
        cleanRule(raw) {
            if (!raw || typeof raw !== 'object') return null;
            if (typeof raw.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(raw.id)) return null;
            // cut at 60, never through a surrogate pair
            const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60).replace(/[\uD800-\uDBFF]$/, '').trim() : '';
            if (!name || !within(raw.lat, 90) || !within(raw.lon, 180) || !isForced(raw.mode)) return null;
            const radiusM = Number.isFinite(raw.radiusM) ? Math.max(RADII[0], Math.min(RADII[RADII.length - 1], Math.round(raw.radiusM))) : RADIUS_DEFAULT_M;
            return { id: raw.id, name, lat: raw.lat, lon: raw.lon, radiusM, mode: raw.mode, on: raw.on !== false };
        },
        cleanRules(list) {
            const out = [];
            (Array.isArray(list) ? list : []).forEach((raw) => {
                const r = lib.cleanRule(raw);
                if (r && out.length < MAX_RULES && !out.some((x) => x.id === r.id)) out.push(r);
            });
            return out;
        },
        distM: (a, b) => C.lib.drive.distM(a, b),
        /** The rule that decides: enabled and inside, the smallest circle; a tie goes to the earlier in the list. */
        winner(rules, insideIds) {
            const inside = Array.isArray(insideIds) ? insideIds : [];
            let best = null;
            (Array.isArray(rules) ? rules : []).forEach((r) => {
                if (r && r.on !== false && inside.indexOf(r.id) >= 0 && (!best || r.radiusM < best.radiusM)) best = r;
            });
            return best;
        }
    };
    C.lib.radio = lib;

    // ------------------------------------------------------------------ the task
    const AUTO = () => ({ mode: 'auto', ruleId: '', name: '' });
    const sameTarget = (a, b) => !!a && !!b && a.mode === b.mode && a.ruleId === b.ruleId;
    const enabled = (s, id) => s.rules.find((r) => r.id === id && r.on) || null;
    const idList = (v) => (Array.isArray(v) ? v.filter((id) => typeof id === 'string') : []);
    const errorText = (d) => String(d.error || 'The network mode could not be set');

    function takeDevice(s, d) {
        const v = d.device;
        if (!v || typeof v !== 'object') return;
        const next = Object.assign({}, s.device);
        if (bitsOf(v.supported)) next.supported = v.supported;
        if (bitsOf(v.current) !== null) next.current = v.current;
        if (bitsOf(v.baseline)) next.baseline = v.baseline;
        s.device = next;
    }

    /** One apply of s.want. What cannot be computed from the phone's supported types is kept, not sent. */
    function send(ctx, why) {
        const s = ctx.state;
        const w = s.want;
        const supported = s.device.supported;
        // '' (Auto only): the host falls back to the Auto mask it kept with the last force
        const autoMask = lib.autoMask(supported, s.device.baseline) || '';
        let mask = autoMask;
        if (w.mode !== 'auto') {
            mask = lib.maskFor(w.mode, supported, s.device.baseline);
            if (!mask) {
                s.status = 'failed';
                s.error = supported ? `This phone does not support ${lib.label(w.mode)}` : 'The phone\'s network types have not been read yet';
                return;
            }
        }
        s.status = 'sent';
        s.open = s.open.concat({ mode: w.mode, ruleId: w.ruleId }).slice(-MAX_OPEN);
        ctx.radio({ mode: w.mode, mask, autoMask, ruleId: w.ruleId, name: w.name, why });
    }

    /**
     * After the places or the rules changed (or may be tried again): what is wanted now, and whether to send it - a new
     * target, a newly entered place, or a want still unconfirmed.
     */
    function reconcile(ctx, wasInside, why) {
        const s = ctx.state;
        const w = lib.winner(s.rules, s.inside);
        const target = w ? { mode: w.mode, ruleId: w.id, name: w.name } : s.armed ? AUTO() : null;
        if (!target) return;
        const fresh = !sameTarget(target, s.want);
        const entered = !!w && s.inside.some((id) => wasInside.indexOf(id) < 0);
        if (w) s.armed = true;
        s.want = target;
        if (fresh) s.error = null;
        if (fresh || entered || s.status === 'sent' || s.status === 'failed') send(ctx, why);
    }

    function onRules(ctx, d) {
        const s = ctx.state;
        const wasInside = s.inside.slice();
        if (Array.isArray(d.rules)) {
            const old = s.rules;
            const known = idList(d.inside);
            s.rules = lib.cleanRules(d.rules);
            const kept = s.inside.filter((id) => {
                const now = enabled(s, id);
                if (!now) return false;
                const was = old.find((r) => r.id === id);
                // the new circle holds the old one: she is still in it
                return known.indexOf(id) >= 0 || (!!was && ((was.lat === now.lat && was.lon === now.lon && was.radiusM === now.radiusM) ||
                    lib.distM(was, now) + was.radiusM <= now.radiusM));
            });
            known.forEach((id) => { if (enabled(s, id) && kept.indexOf(id) < 0) kept.push(id); });
            s.inside = kept;
            const forced = s.forced && s.rules.find((r) => r.id === s.forced.ruleId);
            if (forced) s.forced = Object.assign({}, s.forced, { name: forced.name });
        }
        reconcile(ctx, wasInside, 'rules');
    }

    function onGeofence(ctx, d) {
        const s = ctx.state;
        const wasInside = s.inside.slice();
        const next = s.inside.slice();
        idList(d.enter).forEach((id) => { if (enabled(s, id) && next.indexOf(id) < 0) next.push(id); });
        // exits after enters: an id told both ways counts as left (Auto is the side that keeps mobile data)
        const out = idList(d.exit);
        s.inside = next.filter((id) => out.indexOf(id) < 0);
        reconcile(ctx, wasInside, s.inside.some((id) => wasInside.indexOf(id) < 0) ? 'enter' : 'exit');
    }

    function onFix(ctx, d) {
        const s = ctx.state;
        const wasInside = s.inside.slice();
        const acc = d.accuracyM;
        if (within(d.lat, 90) && within(d.lon, 180) && within(acc, MAX_FIX_ACCURACY_M) && acc >= 0) {
            const next = s.inside.filter((id) => {
                const r = enabled(s, id);
                return !!r && !(lib.distM(d, r) - acc > r.radiusM);
            });
            s.rules.forEach((r) => { if (r.on && next.indexOf(r.id) < 0 && lib.distM(d, r) + acc <= r.radiusM) next.push(r.id); });
            s.inside = next;
        }
        reconcile(ctx, wasInside, 'fix');
    }

    function onManual(ctx) {
        const s = ctx.state;
        s.status = 'hand';
        s.forced = null;
        s.error = null;
        // outside every place the stay is over; inside, the want stays so only a real change sends again
        if (!s.inside.length) { s.want = null; s.armed = false; }
    }

    function onRadio(ctx, d) {
        const s = ctx.state;
        const mode = String(d.mode || '');
        if (mode !== 'auto' && !isForced(mode)) return;
        const answered = { mode, ruleId: mode === 'auto' ? '' : String(d.ruleId || '') };
        const ok = d.ok === true;
        // answers come in the order sent: what was sent before this one gets none any more
        const i = s.open.findIndex((e) => sameTarget(e, answered));
        if (i >= 0) s.open = s.open.slice(i + 1);
        // she set the mode by hand after everything this can answer
        if (s.status === 'hand') return;
        const rule = s.rules.find((r) => r.id === answered.ruleId);
        const asForced = () => ({ mode, ruleId: answered.ruleId, name: rule ? rule.name : '', at: ctx.now });

        if (sameTarget(s.want, answered)) {
            if (!ok) {
                s.status = 'failed';
                s.error = errorText(d);
                // the phone read back with the failure is not on the old force: it is not shown as forced
                const on = d.device ? lib.modeOf(d.device.current, s.device.supported, s.device.baseline) : null;
                if (s.forced && on !== null && on !== s.forced.mode) s.forced = null;
                return;
            }
            if (i < 0) return; // a repeated or overtaken answer confirms nothing
            s.forced = mode === 'auto' ? null : asForced();
            if (s.open.some((e) => !sameTarget(e, s.want))) return;
            s.error = null;
            if (mode === 'auto') { s.want = null; s.armed = false; s.status = ''; } else s.status = 'done';
            return;
        }

        // an answer to something no longer wanted: it never replaces the want
        if (mode !== 'auto') {
            if (!ok) return;
            if (s.status !== 'done') s.forced = asForced();
            if (!s.want) {
                // taken to be back on Auto, and a force went through: Auto again
                s.armed = true;
                s.want = AUTO();
                s.error = null;
                send(ctx, 'late');
            }
        } else if (!ok) {
            if (!s.want) {
                // an Auto failed after another was taken as done: wanted again, sent by the next event (not from here)
                s.armed = true;
                s.want = AUTO();
                s.status = 'failed';
                s.error = errorText(d);
            }
        } else if (i >= 0 && s.status !== 'done') {
            s.forced = null;
        }
    }

    function publish(ctx) {
        const s = ctx.state;
        const f = s.forced;
        const out = {
            active: true,
            inside: s.inside.slice(),
            rule: f ? { id: f.ruleId, name: f.name, mode: f.mode } : null,
            want: s.want && s.status !== 'hand' ? s.want.mode : null,
            error: s.error
        };
        const sig = JSON.stringify(out);
        if (sig === s.outSig) return;
        s.outSig = sig;
        ctx.output(out);
    }

    /** Every event but start: only for a host that can set the mode; the phone's types first, the output last. */
    const heard = (fn) => (ctx, d) => {
        if (!ctx.state.on) return;
        takeDevice(ctx.state, d);
        fn(ctx, d);
        publish(ctx);
    };

    C.define({
        name: 'radio-mode',
        api: 1,
        init(s) {
            Object.assign(s, { on: false, rules: [], inside: [], armed: false, want: null, status: '', open: [], forced: null, error: null,
                device: { supported: null, current: null, baseline: null }, outSig: '' });
        },
        on: {
            start(ctx, d) {
                const s = ctx.state;
                s.on = !!(d && d.host && Array.isArray(d.host.ops) && d.host.ops.indexOf('radio') >= 0);
                if (s.on) publish(ctx);
            },
            rules: heard(onRules),
            geofence: heard(onGeofence),
            fix: heard(onFix),
            manual: heard(onManual),
            retry: heard((ctx) => reconcile(ctx, ctx.state.inside, 'retry')),
            radio: heard(onRadio)
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
