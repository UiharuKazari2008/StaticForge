/*
 * CaféReady task "status-bar" (StaticForge #908 phase 3, rule cafeready-background: "as if a life depends on it"):
 * which of the phone's status bar icons show, worked out by the Android app with the page asleep, killed or never
 * opened. NativeBar draws them (their look from the page's catalog, AndroidBars.statusCatalog).
 *
 * Inputs:
 *   push status.snapshot { full, fields }   the server's snapshot (modules/phoneStatus.js) over the ActiveSync line
 *   native { carKey, dex, dexReady, link, driving }   the phone's own: car key in range (CarKeyWatch), the DeX window
 *                                           (Continuity), the link to Dreamscape, the drive state
 *   wake {}                                 the screen came on (time-driven states are worked out again)
 *   timer {}                                the next edge of a commute's leave window or a remote start's end
 * Output: { roles: { <role>: true | false }, link, at }: false = hidden; a role the task does not name is the page's.
 *
 * The rules are the page's (public/scripts/comp/wmShell.js refreshStatus), on server inputs:
 *   mail      Messaging's "any unread" on: unread mail; else new mail notices waiting
 *   sms       "any unread" on: unread texts; else text notices waiting
 *   chat      Messenger replies waiting
 *   director  a turn running, or a finished turn not seen
 *   prints    prints the phone asked for, queued or running
 *   wxalert   weather alerts at Home / Work; rain: rain due or falling with the rain alarm on
 *   carkey    the car key sees the car, a remote start runs, or a commute's leave window is open (or driving)
 *   continuity the DeX window (dim until its desktop is up: dexReady false)
 *   received  ActiveSync items not seen yet
 *   nightshade the link to Dreamscape is down (the bar never shows a frozen copy as current)
 *   notify    other notices waiting
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks;
    if (!C) return;

    const LEAVE_WINDOW_MIN = 30;
    const HOME_AFTER_MIN = 150;

    const minutesOf = (hhmm) => { const m = /^(\d\d):(\d\d)$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

    const lib = {
        /** A commute's leave window open at `now` (the page's leaveWindow without the advisor's later time): 'work' | 'home' | null. */
        leaveWindow(t, now) {
            if (!t || !Array.isArray(t.days) || !t.days.includes(now.getDay())) return null;
            const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
            const before = Math.max(LEAVE_WINDOW_MIN, Number(t.leadMin) || 0);
            for (const [key, dir] of [['leaveHome', 'work'], ['leaveWork', 'home']]) {
                const m = minutesOf(t[key]);
                if (m == null) continue;
                const off = ((mins - m + 720) % 1440 + 1440) % 1440 - 720;
                const after = dir === 'home' ? HOME_AFTER_MIN : LEAVE_WINDOW_MIN;
                if (off >= -before && off <= after) return dir;
            }
            return null;
        },
        /** Ms until the next leave-window edge (opening or closing) after `now`, or 0 (no commute set). */
        nextEdgeMs(t, now) {
            if (!t || !Array.isArray(t.days) || !t.days.length) return 0;
            const before = Math.max(LEAVE_WINDOW_MIN, Number(t.leadMin) || 0);
            let best = 0;
            for (const [key, dir] of [['leaveHome', 'work'], ['leaveWork', 'home']]) {
                const m = minutesOf(t[key]);
                if (m == null) continue;
                const after = dir === 'home' ? HOME_AFTER_MIN : LEAVE_WINDOW_MIN;
                for (let day = 0; day < 8; day++) {
                    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, 0, 0, 0, 0);
                    if (!t.days.includes(base.getDay())) continue;
                    [m - before, m + after].forEach((edge) => {
                        const at = base.getTime() + edge * 60000;
                        const ms = at - now.getTime();
                        if (ms > 1000 && (!best || ms < best)) best = ms;
                    });
                }
            }
            return best;
        },
        /** The icons from the inputs (pure: the page can use it too). */
        roles(f, n, now) {
            const s = f || {};
            const nat = n || {};
            const prefs = s.prefs || {};
            const mail = s.mail || {};
            const sms = s.sms || {};
            const lapisUntil = (s.lapis && s.lapis.until) || 0;
            return {
                mail: !!(prefs.mailAll ? mail.unread > 0 : mail.fresh > 0),
                sms: !!(prefs.smsAll ? sms.unread > 0 : sms.fresh > 0),
                chat: !!(s.chat && s.chat.fresh > 0),
                director: !!(s.director && (s.director.running || s.director.unseen)),
                prints: !!(s.prints && s.prints.phone > 0),
                wxalert: !!(s.weather && s.weather.alerts > 0),
                rain: !!(s.weather && s.weather.rain),
                carkey: !!(nat.carKey || lapisUntil > now.getTime() || nat.driving || lib.leaveWindow(s.traffic, now)),
                continuity: !!nat.dex,
                received: !!(s.received && s.received.unseen > 0),
                nightshade: nat.link === false,
                notify: !!(s.notices && s.notices.waiting > 0)
            };
        }
    };
    C.lib.statusBar = lib;

    function refresh(ctx) {
        const s = ctx.state;
        const now = new Date(ctx.now);
        let roles = lib.roles(s.fields, s.native, now);
        // no snapshot yet (a fresh install, the line not up since): only what the phone itself knows; the page's copy
        // decides the rest
        if (!s.fields || !s.fields.mail) roles = { continuity: roles.continuity, nightshade: roles.nightshade };
        const out = { roles, link: s.native.link !== false };
        // the page asleep: the bar fitted the page's way (CafeTasks.lib.statusFit, the page's fitStatusNow rules), from
        // the geometry and widths the app sends (layout); without it the app places the icons itself
        const fitLib = C.lib.statusFit;
        if (fitLib && typeof fitLib.fit === 'function' && s.layout && s.layout.geo && s.fields && s.fields.mail) {
            const L = s.layout;
            const g = L.geo;
            const floor = g.titleX + g.titleMin;
            const foldless = new Set(['prints', 'director', 'update', 'continuity', 'notify']);
            const icons = (L.order || []).filter((r) => roles[r]).map((role) => ({ role, w: (L.widths || {})[role] || g.icon, foldable: !foldless.has(role) }))
                .concat((L.native || []).map((role) => ({ role, w: (L.widths || {})[role] || g.icon, foldable: false, native: true })));
            try {
                out.fit = fitLib.fit({
                    icons,
                    roomRight: g.holeR != null ? g.iconsRight - g.holeR : g.iconsRight - floor,
                    roomLeft: g.holeX != null ? Math.max(0, g.holeX - floor) : 0,
                    gap: g.gap, notify: !!roles.notify, prefs: L.prefs || {}, screen: g
                });
            } catch (e) { ctx.log(`statusFit: ${e && e.message}`); }
        }
        const sig = JSON.stringify(out);
        if (sig !== s.outSig) {
            s.outSig = sig;
            ctx.output(Object.assign({ at: ctx.now }, out));
        }
        // the next time-driven change: a leave window's edge, or a remote start's end
        let next = lib.nextEdgeMs(s.fields.traffic, now);
        const until = (s.fields.lapis && s.fields.lapis.until) || 0;
        if (until > ctx.now && (!next || until - ctx.now < next)) next = until - ctx.now + 500;
        const at = next ? ctx.now + next : 0;
        if (at !== s.timerAt) { s.timerAt = at; ctx.timer(next || 0); }
    }

    C.define({
        name: 'status-bar',
        api: 1,
        init(s) { Object.assign(s, { fields: {}, native: {}, outSig: '', timerAt: 0 }); },
        on: {
            start(ctx) { ctx.state.outSig = ''; ctx.state.timerAt = 0; refresh(ctx); },
            push(ctx, p) {
                if (p.type !== 'status.snapshot' || !p.data || !p.data.fields) return;
                const s = ctx.state;
                if (p.data.full) s.fields = {};
                Object.assign(s.fields, p.data.fields);
                refresh(ctx);
            },
            native(ctx, d) { Object.assign(ctx.state.native, d || {}); refresh(ctx); },
            // the bar's geometry and each role's width (NativeBar), for the fit
            layout(ctx, d) { ctx.state.layout = d || null; refresh(ctx); },
            wake: refresh,
            timer(ctx) { ctx.state.timerAt = 0; refresh(ctx); }
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
