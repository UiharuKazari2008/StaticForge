/*
 * CaféReady task "drive-alerts" (StaticForge #908 phase 1, #907, #810): speed camera and police warnings while
 * driving, run by the Android app from its own drive state - the page asleep, killed or never opened changes
 * nothing (rule cafeready-background).
 *
 * Driving (DSApp DriveState 'driving'): the position is read ('low' = balanced power, 'high' = GPS near a
 * warning) and each fix decides:
 *   - on a commute route (within 300 m of Home -> Work or Work -> Home's preferred line, outside the places'
 *     radius): that report's cameras and police ahead along the line; within 5 mi of one the position goes to
 *     'high', at 1 mi each is one alert; the route's police feed (traffic_police_<dir>) is watched while on it;
 *   - on no commute route: the OpenStreetMap cameras and police zones of the area the car is in (traffic_nearby,
 *     asked once per area it drives into), warned of within 1 mi ahead (heading, or getting closer).
 * An item is warned of once per drive (and not again within two hours, so parking and driving on does not repeat
 * it). Not driving: no position, no feed.
 *
 * The CaféReady link is asked for only while driving (ctx.link), so between drives the app runs nothing for it.
 * Data: traffic_get (Home / Work, the reports; refreshed at each drive's start and on traffic_updated /
 * traffic_settings_changed pushes), traffic_nearby, the police feed - all over the CaféReady link.
 * Output (window.AndroidTasks.output('drive-alerts') on the page): { active, mode: 'route' | 'area' | '',
 * direction, alerted: [id], driveSince }.
 *
 * The pure parts are CafeTasks.lib.drive: the page's Traffic uses the same functions.
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks;
    if (!C) return;

    const MI = 1609.344;
    const ON_ROUTE_M = 300;
    const WATCH_M = 5 * MI;
    const ALERT_M = MI;
    const AREA_HIGH_M = 2.5 * MI;
    const REPEAT_MS = 2 * 3600 * 1000;
    const REPORTS_FRESH_MS = 30 * 60 * 1000;
    const AREA_RETRY_MS = 60 * 1000;

    // ------------------------------------------------------------------ pure parts (the page uses them too)
    const lib = {
        ON_ROUTE_M, WATCH_M, ALERT_M,
        bearing(a, b) {
            const r = Math.PI / 180;
            const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
            const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
            return (Math.atan2(y, x) / r + 360) % 360;
        },
        distM(a, b) {
            const r = (d) => (d * Math.PI) / 180;
            const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
            return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
        },
        /** Where a point lies on a [[lat, lon], ...] line: { distM, alongM, totalM }. */
        onLine(line, p) {
            const R = 6371008.8;
            const rad = (d) => (d * Math.PI) / 180;
            const kx = Math.cos(rad(p.lat)) * R * Math.PI / 180;
            const ky = R * Math.PI / 180;
            let cum = 0;
            let best = { distM: Infinity, alongM: 0 };
            for (let i = 0; i < line.length - 1; i++) {
                const ax = (line[i][1] - p.lon) * kx; const ay = (line[i][0] - p.lat) * ky;
                const bx = (line[i + 1][1] - p.lon) * kx; const by = (line[i + 1][0] - p.lat) * ky;
                const dx = bx - ax; const dy = by - ay;
                const len = Math.sqrt(dx * dx + dy * dy);
                const t = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (len * len))) : 0;
                const d = Math.hypot(ax + t * dx, ay + t * dy);
                if (d < best.distM) best = { distM: d, alongM: cum + t * len };
                cum += len;
            }
            return Object.assign(best, { totalM: cum });
        },
        /** Whether the fix needs the next area's list: none yet, or within marginDeg (~3 km) of the area's edge. */
        needsArea(fix, box, marginDeg = 0.03) {
            return !box || fix.lat < box.s + marginDeg || fix.lat > box.n - marginDeg || fix.lon < box.w + marginDeg || fix.lon > box.e - marginDeg;
        },
        /**
         * The items to warn of now: within alertM and ahead of the car (its heading within 60 degrees when moving
         * faster than 2 m/s, else getting closer than at the last fix). alerted: Set of ids; last: Map id -> metres
         * at the last fix (read only). -> { alerts: [{ item, distM }], last: Map, nearestM }.
         */
        ahead(fix, items, alerted, last, alertM) {
            const heading = Number.isFinite(fix.heading) && (fix.speed || 0) > 2 ? fix.heading : null;
            const next = new Map();
            const alerts = [];
            let nearestM = Infinity;
            (items || []).forEach((t) => {
                const id = lib.keyOf(t);
                if (alerted.has(id)) return;
                const pts = Array.isArray(t.line) && t.line.length ? t.line.map(([lat, lon]) => ({ lat, lon })) : [t];
                let near = null; let dM = Infinity;
                pts.forEach((p) => { const d = lib.distM(fix, p); if (d < dM) { dM = d; near = p; } });
                if (dM < nearestM) nearestM = dM;
                const before = last.get(id);
                if (dM <= alertM * 2) next.set(id, dM);
                if (dM > alertM) return;
                const isAhead = heading != null ? Math.abs(((lib.bearing(fix, near) - heading + 540) % 360) - 180) <= 60 : (before != null && dM < before - 20);
                if (isAhead) alerts.push({ item: t, distM: dM });
            });
            return { alerts, last: next, nearestM };
        },
        keyOf: (t) => t.id || `${t.lat},${t.lon}`,
        /** A report's route the reports call preferred (left out on the wire when it is routes[0]). */
        preferredOf(r) { return r ? (r.preferred || (Array.isArray(r.routes) ? r.routes[r.preferredIndex || 0] : null) || null) : null; },
        /** What the drive warns of: the cameras and the police along the route, by their place along it (0..1). */
        warnings(r) { return r ? (r.traps || []).concat(r.police || []).sort((a, b) => a.at - b.at) : []; },
        /** [{ trap, aheadM }] ahead of fraction f within watchM, nearest first. */
        camerasAhead(traps, f, totalM, watchM = WATCH_M) {
            if (!Array.isArray(traps) || !(totalM > 0)) return [];
            return traps.map((t) => ({ trap: t, aheadM: (t.at - f) * totalM }))
                .filter((c) => Number.isFinite(c.aheadM) && c.aheadM > 0 && c.aheadM <= watchM)
                .sort((a, b) => a.aheadM - b.aheadM);
        },
        miles: (m) => (m == null ? '' : `${(m / MI).toFixed(m < 16093 ? 1 : 0)} mi`),
        /** The alert's words, the same on the page and in the app. */
        alertText(t, aheadM) {
            return {
                title: `${t.label || 'Speed camera'} ahead`,
                text: `${lib.miles(aheadM)} ahead${t.street ? ` on ${t.street}` : ''}.${t.maxspeed ? ` Limit ${t.maxspeed}.` : ''}${t.count > 1 ? ` ${t.count} cameras.` : ''}`
            };
        }
    };
    C.lib.drive = lib;

    // ------------------------------------------------------------------ the task
    const slimItem = (t) => ({ id: lib.keyOf(t), label: t.label || '', street: t.street || '', maxspeed: t.maxspeed || '', count: t.count || 1, at: t.at, lat: t.lat, lon: t.lon });
    function slimReport(r) {
        const p = lib.preferredOf(r);
        if (!p || !Array.isArray(p.line) || p.line.length < 2) return null;
        return { hash: r.hash || '', line: p.line, durationSec: p.durationSec || 0, distanceM: p.distanceM || 0, traps: (r.traps || []).map(slimItem), police: (r.police || []).map(slimItem) };
    }
    const pt = (o) => (o && Number.isFinite(o.lat) && Number.isFinite(o.lon) ? { lat: o.lat, lon: o.lon } : null);

    function takeSettings(s, settings) {
        const st = settings || {};
        s.places = { home: pt(st.home), work: pt(st.work), radiusM: Math.round((st.radiusKm || 1.5) * 1000) };
    }

    /** Home / Work: the saved ones, else the ends of the reports' lines. */
    function places(s) {
        const p = s.places || {};
        const end = (d, last) => { const l = s.reports[d] && s.reports[d].line; const q = l && l[last ? l.length - 1 : 0]; return q ? { lat: q[0], lon: q[1] } : null; };
        return { home: p.home || end('work', false) || end('home', true), work: p.work || end('work', true) || end('home', false), radiusM: p.radiusM || 1500 };
    }

    function alertedSet(s, now) {
        Object.keys(s.alerted).forEach((id) => { if (now - s.alerted[id] > REPEAT_MS) delete s.alerted[id]; });
        return new Set(Object.keys(s.alerted));
    }

    function alert(ctx, t, distM) {
        const s = ctx.state;
        const id = lib.keyOf(t);
        s.alerted[id] = ctx.now;
        const words = lib.alertText(t, distM);
        ctx.notify({ id, kind: 'traffic-camera', title: words.title, text: words.text });
    }

    function setLevel(ctx, level) {
        if (ctx.state.level === level) return;
        ctx.state.level = level;
        ctx.location(level);
    }

    function setFeed(ctx, feed) {
        const s = ctx.state;
        if (s.feed === feed) return;
        if (s.feed) ctx.feed(s.feed, false);
        s.feed = feed;
        if (feed) ctx.feed(feed, true);
    }

    function publish(ctx) {
        const s = ctx.state;
        const out = { active: s.active, mode: s.mode, direction: s.direction, alerted: Object.keys(s.alerted).sort(), driveSince: s.driveSince };
        const sig = JSON.stringify(out);
        if (sig === s.outSig) return;
        s.outSig = sig;
        ctx.output(out);
    }

    function askReports(ctx, force) {
        const s = ctx.state;
        if (!force && ctx.now - s.reportsAt < REPORTS_FRESH_MS) return;
        if (s.asking.reports && ctx.now - s.asking.reports < 30000) return;
        s.asking.reports = ctx.now;
        const have = { work: (s.reports.work && s.reports.work.hash) || null, home: (s.reports.home && s.reports.home.hash) || null };
        ctx.request('traffic_get', have.work || have.home ? { have } : {}, 'reports');
    }

    /** The commute route the fix is on: { dir, r, f, totalM } or null. Moving along it decides between the two. */
    function onRoute(s, fix) {
        let best = null;
        ['home', 'work'].forEach((dir) => {
            const r = s.reports[dir];
            if (!r) return;
            const loc = lib.onLine(r.line, fix);
            if (loc.distM > ON_ROUTE_M || !loc.totalM) return;
            const f = Math.max(0, Math.min(1, loc.alongM / loc.totalM));
            if (f > 0.995) return;
            const was = s.along[dir];
            const forward = was != null && loc.alongM > was + 10 ? 1 : 0;
            s.along[dir] = loc.alongM;
            const score = forward * 1000 - loc.distM + (s.direction === dir ? 50 : 0);
            if (!best || score > best.score) best = { dir, r, f, totalM: r.distanceM || loc.totalM, score };
        });
        return best;
    }

    function atPlace(s, fix) {
        const p = places(s);
        const r = Math.max(p.radiusM, fix.accuracyM || 0);
        return (p.home && lib.distM(fix, p.home) <= r) || (p.work && lib.distM(fix, p.work) <= r);
    }

    function onFix(ctx, fix) {
        const s = ctx.state;
        if (!s.active || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
        if ((fix.accuracyM || 0) > 500) return;
        const done = alertedSet(s, ctx.now);
        if (atPlace(s, fix)) { s.mode = ''; setFeed(ctx, ''); setLevel(ctx, 'low'); publish(ctx); return; }
        const route = onRoute(s, fix);
        if (route) {
            s.mode = 'route';
            s.direction = route.dir;
            setFeed(ctx, `traffic_police_${route.dir}`);
            const ahead = lib.camerasAhead(lib.warnings(route.r), route.f, route.totalM).filter((c) => !done.has(lib.keyOf(c.trap)));
            ahead.filter((c) => c.aheadM <= ALERT_M).forEach((c) => alert(ctx, c.trap, c.aheadM));
            setLevel(ctx, ahead.some((c) => c.aheadM > ALERT_M) ? 'high' : 'low');
            publish(ctx);
            return;
        }
        s.mode = 'area';
        s.direction = '';
        setFeed(ctx, '');
        if (lib.needsArea(fix, s.area.box) && ctx.now - (s.asking.area || 0) > AREA_RETRY_MS) {
            s.asking.area = ctx.now;
            ctx.request('traffic_nearby', { lat: Math.round(fix.lat * 1e5) / 1e5, lon: Math.round(fix.lon * 1e5) / 1e5 }, 'area');
        }
        if (s.area.box) {
            const r = lib.ahead(fix, s.area.items, done, new Map(Object.entries(s.last)), ALERT_M);
            s.last = Object.fromEntries(r.last);
            r.alerts.forEach(({ item, distM }) => alert(ctx, item, distM));
            setLevel(ctx, r.nearestM <= AREA_HIGH_M ? 'high' : 'low');
        } else {
            setLevel(ctx, 'low');
        }
        publish(ctx);
    }

    function onDrive(ctx, d) {
        const s = ctx.state;
        const driving = d && d.state === 'driving';
        if (driving === s.active) return;
        s.active = driving;
        if (driving) {
            s.driveSince = d.since || ctx.now;
            s.along = {};
            s.last = {};
            ctx.link(true);
            askReports(ctx, true);
            setLevel(ctx, 'low');
        } else {
            s.mode = '';
            s.direction = '';
            setLevel(ctx, 'off');
            setFeed(ctx, '');
            ctx.link(false);
        }
        publish(ctx);
    }

    function mergePolice(s, d, whole) {
        const dir = String(d.feed || '').replace('traffic_police_', '');
        const r = s.reports[dir];
        if (!r) return;
        const byId = new Map(whole ? [] : (r.police || []).map((p) => [p.id, p]));
        Object.entries(d.changed || d.items || {}).forEach(([id, p]) => byId.set(id, Object.assign(slimItem(p), { id })));
        (d.removed || []).forEach((id) => byId.delete(id));
        r.police = [...byId.values()].sort((a, b) => a.at - b.at);
    }

    C.define({
        name: 'drive-alerts',
        api: 1,
        init(s) {
            Object.assign(s, { active: false, driveSince: 0, mode: '', direction: '', level: 'off', feed: '', reports: {}, reportsAt: 0, places: null, area: { box: null, items: [] }, along: {}, last: {}, alerted: {}, asking: {}, outSig: '' });
        },
        on: {
            start(ctx) {
                const s = ctx.state;
                // the host starts with no position and no feed: what this state asked for is asked again
                if (s.active) ctx.link(true);
                const level = s.level; s.level = 'off'; if (s.active) setLevel(ctx, level === 'off' ? 'low' : level);
                const feed = s.feed; s.feed = ''; if (s.active && feed) setFeed(ctx, feed);
                ctx.subscribe(['traffic_updated', 'traffic_settings_changed', 'traffic_police']);
                s.outSig = '';
                publish(ctx);
            },
            link(ctx, d) {
                const s = ctx.state;
                if (!d.connected) return;
                if (s.active) {
                    askReports(ctx, false);
                    // the server forgot the feed with the old link
                    const feed = s.feed; s.feed = ''; if (feed) setFeed(ctx, feed);
                }
            },
            drive: onDrive,
            fix: onFix,
            reply(ctx, r) {
                const s = ctx.state;
                if (r.tag === 'reports') {
                    s.asking.reports = 0;
                    if (!r.ok) return;
                    const d = r.data || {};
                    s.reportsAt = ctx.now;
                    if (d.same === true) return;
                    if (d.settings !== undefined) takeSettings(s, d.settings);
                    const got = d.latest || {};
                    ['work', 'home'].forEach((k) => { if (k in got) s.reports[k] = slimReport(got[k]); });
                } else if (r.tag === 'area') {
                    if (!r.ok) return;
                    const d = r.data || {};
                    if (d.box) s.area = { box: d.box, items: (d.cameras || []).concat(d.police || []) };
                } else if (r.tag === 'feed' && r.ok && r.data && r.data.items) {
                    mergePolice(s, { feed: r.data.feed || s.feed, items: r.data.items }, true);
                }
            },
            push(ctx, p) {
                const s = ctx.state;
                const d = p.data || {};
                if (p.type === 'traffic_updated' && d.direction && d.report) s.reports[d.direction] = slimReport(d.report);
                else if (p.type === 'traffic_settings_changed' && d.settings) takeSettings(s, d.settings);
                else if (p.type === 'traffic_police' && d.feed && d.feed === s.feed) mergePolice(s, d, false);
            }
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
