/**
 * Melaton Mobile: Traffic (Yozora #795). Yukimi, Nov 13 2026: "a 2009 era premium windows mobile app
 * for me to check traffic conditions to and from work", with a Today item on 6.1 and 6.5, Home and
 * Work, a preferred route given as street names, alerts and major slowdowns with a better route,
 * "Speed Traps on route", and leave times that send a notification (and on the way home, whether to
 * wait before leaving).
 *
 * Our own design, a premium 2009 phone app with skeuomorphism: a brushed-metal plate with the To Work
 * | To Home switch, a piano-black dashboard with a lit traffic signal and backlit LCD minutes, a road
 * strip (asphalt with the slow and jammed stretches glowing, pins for speed traps and alerts), an
 * amber advice plate (faster route / wait before leaving), and glossy list rows. The WM 6.1 shell
 * stays around it (title bar, soft keys Refresh | Menu).
 *
 * Data: the server's traffic service (modules/trafficService.js, 292-trafficHandler.js), which calls
 * Google Routes (drive times, slowdowns, routes), TomTom (accidents, closures, roadworks, jams) and
 * OpenStreetMap (fixed speed and red light cameras), within budgets. This app never polls: traffic_get reads the last
 * reports, traffic_check runs when the app opens on a report older than 3 minutes or on Refresh, and
 * the server pushes traffic_updated after every check (the scheduler's too). traffic_report (at the
 * leave times) is a WM notification with View / Dismiss.
 *
 * window.wmTraffic: open(direction?), latest() -> { work, home }, direction() (the one Today shows).
 * Art: public/static_images/wm61/app-traffic* (scripts/generate-wm-traffic-art.js), wm65 ti-x panel.
 * Styles: public/css/wm-traffic.css. Phones only. Admin (and dev_admin test tabs) only.
 */
(function () {
    'use strict';

    const MOBILE = window.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');
    if (!MOBILE) return;

    const APP_ID = 'traffic';
    const TITLE = 'Traffic';
    const STALE_MS = 3 * 60 * 1000;
    const LS_PLACE = 'wmTrafficPlace'; // { place: 'home' | 'work', at } the last place the phone was found at
    const GEO_EVERY_MS = 5 * 60 * 1000; // the phone's position is read at most this often, while on screen
    const DELAY_STATUS_SEC = 15 * 60; // near a leave time, a commute this late or more is the car's reason (bubble); it never shows the car alone
    const DRIVE_GEO_MS = 60 * 1000; // while driving the commute: the position every minute (the phone's own, no server)
    const ON_ROUTE_M = 300; // this close to the route's line counts as driving it
    const TODAY_CHECK_MS = 15 * 60 * 1000; // Today asks for a fresh report at most this often
    const LEAVE_WINDOW_MIN = 30; // the car also shows this long before and after each leave time
    const HOME_AFTER_MIN = 150; // the way home: the car stays this long past Leave Work (30 min + 2 h, Yukimi #809)
    const CAM_WATCH_M = 5 * 1609.344; // driving home: a camera this close ahead on the route puts the position on a live watch
    const CAM_ALERT_M = 1609.344; // ... and this close it is a notification with an alert sound, once per camera per drive
    const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const LAYER_TITLES = { routes: 'Routes', traps: 'Speed Traps', alerts: 'Alerts', slow: 'Slowdowns', advisor: 'Leave Advisor', settings: 'Traffic Settings', item: 'Details' };

    let ws = null;
    let page = null;
    let els = null;
    let shown = false;
    let layers = [];
    let settings = null;
    let latest = { work: null, home: null };
    let advice = { work: null, home: null };
    let provs = null;
    let loaded = false;
    let loadFailed = '';
    let dirPicked = null;
    let checking = { work: false, home: false };
    let itemView = null; // the row a Details page shows

    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const canUse = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };
    const client = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);

    // ---------------------------------------------------------------- formatting

    const fmtClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const clock = (iso) => { const t = typeof iso === 'number' ? iso : Date.parse(iso); return Number.isFinite(t) ? fmtClock.format(new Date(t)) : ''; };
    const mins = (sec) => (sec == null ? '--' : String(Math.max(1, Math.round(sec / 60))));
    const minText = (sec) => {
        if (sec == null) return '';
        const m = Math.max(1, Math.round(sec / 60));
        return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
    };
    const miles = (m) => (m == null ? '' : `${(m / 1609.344).toFixed(m < 16093 ? 1 : 0)} mi`);
    const ago = (iso) => {
        const t = Date.parse(iso);
        if (!Number.isFinite(t)) return '';
        const m = Math.round((Date.now() - t) / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m} min ago`;
        const h = Math.round(m / 60);
        return h < 24 ? `${h} hr ago` : clock(iso);
    };
    const hhmmLabel = (v) => {
        if (!v) return 'Off';
        const [h, m] = v.split(':').map(Number);
        return clock(new Date(2000, 0, 1, h, m).getTime());
    };
    const LEVEL_TEXT = { clear: 'Traffic is light', moderate: 'Some slowdowns', heavy: 'Heavy traffic' };

    // ---------------------------------------------------------------- server

    async function ask(type, payload, ms = 25000) {
        const c = client();
        if (!c) throw new Error('Not connected');
        const r = await Promise.race([
            c.sendMessage(type, payload || {}, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms))
        ]);
        return r && r.data && typeof r.data === 'object' ? r.data : r;
    }

    async function load() {
        if (!canUse() || !client()) return;
        try {
            const d = await ask('traffic_get', {});
            settings = d.settings || null;
            latest = Object.assign({ work: null, home: null }, d.latest || {});
            provs = d.providers || null;
            loaded = true;
            loadFailed = '';
        } catch (err) {
            loadFailed = (err && err.message) || 'Traffic could not be loaded';
        }
        changed();
        armNativeWatch();
    }

    /** A fresh report (the server answers from its 3 minute cache unless force). */
    async function check(direction, force) {
        if (checking[direction]) return latest[direction];
        checking[direction] = true;
        render();
        try {
            const d = await ask('traffic_check', { direction, force: !!force }, 40000);
            if (d && d.report) latest[direction] = d.report;
            if (d && d.providers) provs = d.providers;
            return latest[direction];
        } finally {
            checking[direction] = false;
            changed();
        }
    }

    async function loadAdvice(direction, force) {
        const d = await ask('traffic_advise', { direction, force: !!force }, 45000);
        if (d && d.providers) provs = d.providers;
        advice[direction] = d && d.advice;
        return advice[direction];
    }

    /**
     * The program icon's signal shows what the app shows (Yukimi, Nov 13): the lamp of the report for the
     * commute that matters now (direction()), as Today's line has it: clear green, moderate amber, heavy
     * red, no report or one over 30 minutes old: every lamp dark. 6.1 app-traffic[-lg]-<level>, 6.5
     * start-traffic-<level>; clear keeps the plain names (scripts/generate-wm-traffic-art.js).
     */
    function syncIcon() {
        if (!ws || typeof ws.setAppIcon !== 'function') return;
        const lv = loaded ? (todayLine(direction()).level || 'none') : 'none';
        const sfx = lv === 'clear' ? '' : `-${['moderate', 'heavy'].includes(lv) ? lv : 'none'}`;
        ws.setAppIcon(APP_ID, { icon: `app-traffic${sfx}`, art65: `traffic${sfx}` });
    }

    function changed() {
        syncIcon();
        render();
        if (ws && typeof ws.refreshToday === 'function') ws.refreshToday();
        if (ws && typeof ws.refreshStatus === 'function') ws.refreshStatus();
        document.dispatchEvent(new CustomEvent('wmTrafficChange'));
    }

    // ---------------------------------------------------------------- where the phone is (Yukimi, Nov 13)
    //
    // Inside the Home radius the commute ahead is To Work, inside the Work radius To Home; on the road
    // the last place found stands (a drive home stays To Home), for up to 12 hours; never found, or no
    // location, the time of day decides. navigator.geolocation (the DSApp WebView answers it for this
    // origin, DSApp PR #26) inside the Android app; elsewhere, or when location is refused, the server's
    // traffic_where: the place by the client's IP (Yukimi: "if you're not in the android app the server
    // uses the client's IP"; a home-network IP is the configured place). Read at most every 5 minutes
    // while Today or the app is on screen.

    let here = null; // { lat, lon, accuracy, at }
    let geoAt = 0;
    let geoBusy = false;
    let geoDenied = false;
    // the Dreamscape Android app (its bridges are on window); a browser has none of them
    const inApp = () => !!(window.AndroidCaption || window.AndroidNotification || window.AndroidDevice);

    const distKm = (a, b) => {
        const r = (d) => (d * Math.PI) / 180;
        const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
        return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
    };

    /** Home and Work as coordinates: the saved ones, else the ends of the last reports' routes. */
    function placeCoords() {
        const s = settings || {};
        const ends = (d, last) => {
            const line = latest[d] && latest[d].preferred && latest[d].preferred.line;
            const p = Array.isArray(line) && line.length ? line[last ? line.length - 1 : 0] : null;
            return p ? { lat: p[0], lon: p[1] } : null;
        };
        const pick = (saved, a, b) => (saved && Number.isFinite(saved.lat) ? { lat: saved.lat, lon: saved.lon } : (a || b));
        return { home: pick(s.home, ends('work', false), ends('home', true)), work: pick(s.work, ends('work', true), ends('home', false)) };
    }

    function storedPlace() {
        try {
            const v = JSON.parse(localStorage.getItem(LS_PLACE) || 'null');
            return v && (v.place === 'home' || v.place === 'work') && Date.now() - v.at < 12 * 3600 * 1000 ? v.place : null;
        } catch (_) { return null; }
    }

    /** 'home' | 'work' | null: the place the phone is in now, by the last position read. */
    function placeNow() {
        if (!here || !configured()) return null;
        const c = placeCoords();
        // an IP place is only as good as its lookup: a city-level answer widens the radius to match
        const r = Math.max((settings && settings.radiusKm) || 1.5, here.accuracyKm || 0);
        const dh = c.home ? distKm(here, c.home) : Infinity;
        const dw = c.work ? distKm(here, c.work) : Infinity;
        if (dh <= r && dh <= dw) return 'home';
        if (dw <= r) return 'work';
        return null;
    }

    function readPosition(force) {
        if (geoBusy || document.hidden || !configured()) return;
        // in the drive window inside the app: every minute (the device's own position, no request to the server)
        const every = inApp() && !geoDenied && driveWindow() ? DRIVE_GEO_MS : GEO_EVERY_MS;
        if (!force && Date.now() - geoAt < every) return;
        geoAt = Date.now();
        geoBusy = true;
        const before = direction();
        const found = (pos) => {
            geoBusy = false;
            here = Object.assign({ at: Date.now() }, pos);
            const p = placeNow();
            if (p) { try { localStorage.setItem(LS_PLACE, JSON.stringify({ place: p, at: Date.now() })); } catch (_) { /* none */ } }
            if (direction() !== before) { const r = latest[direction()]; if (configured() && (!r || Date.now() - Date.parse(r.at) > STALE_MS)) quietCheck(direction()); }
            changed();
            watchCameras();
        };
        const byIp = () => {
            ask('traffic_where', {}, 15000).then((d) => {
                if (d && d.available && Number.isFinite(d.lat)) found({ lat: d.lat, lon: d.lon, accuracyKm: d.accuracyKm || 25, source: d.source });
                else geoBusy = false;
            }).catch(() => { geoBusy = false; });
        };
        // Settings > System > External GPS can keep programs off the phone's GPS (#805)
        if (!inApp() || geoDenied || !navigator.geolocation || (window.wmGps && !window.wmGps.allowed())) { byIp(); return; }
        navigator.geolocation.getCurrentPosition((pos) => {
            found({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyKm: Math.min(5, (pos.coords.accuracy || 0) / 1000), source: 'device' });
        }, (err) => {
            // refused (no permission, or an app build without the WebView location hand-off): the IP from now on
            if (err && err.code === 1) geoDenied = true;
            byIp();
        }, { enableHighAccuracy: !!driveWindow(), maximumAge: driveWindow() ? 30000 : GEO_EVERY_MS, timeout: 20000 });
    }

    // ---------------------------------------------------------------- driving the commute (Yukimi, Nov 13)
    //
    // From 30 minutes before a set leave time (set days) until the trip should be over, the phone's position
    // is read every minute in the app. Within 300 m of the last report's route it is driving it: the time
    // left comes from that report alone (no request to Google or TomTom): the route's drive time spread
    // over its length, slow stretches counting 2.2x and jammed ones 4x, from where the phone is to the end.

    /**
     * Minutes the Leave Advisor moved today's way home past the set Leave Work time (m, minutes since
     * midnight): its "wait N min" leave time, when that is later the same evening, else 0.
     */
    function adviceLaterMin(now, m) {
        const w = advice.home && advice.home.wait && advice.home.wait.leaveAt;
        const wAt = typeof w === 'number' ? w : Date.parse(w || '');
        if (!Number.isFinite(wAt)) return 0;
        const set = new Date(now);
        set.setHours(Math.floor(m / 60), m % 60, 0, 0);
        const later = (wAt - set.getTime()) / 60000;
        return later > 0 && later < 6 * 60 ? later : 0;
    }

    /** { direction, leaveAt, until } while a commute can be under way, else null. */
    function driveWindow(now = new Date()) {
        const s = settings || {};
        if (!Array.isArray(s.days) || !s.days.includes(now.getDay())) return null;
        const t = now.getHours() * 60 + now.getMinutes();
        for (const [key, dir] of [['leaveHome', 'work'], ['leaveWork', 'home']]) {
            const m = minutesOf(s[key]);
            if (m == null) continue;
            const r = latest[dir];
            const tripMin = r && r.preferred && r.preferred.durationSec ? r.preferred.durationSec / 60 : 60;
            // the way home: leaving at the end of the car's window still counts (#809)
            const until = Math.max(120, tripMin + 45, dir === 'home' ? HOME_AFTER_MIN + adviceLaterMin(now, m) + tripMin : 0);
            if (t >= m - LEAVE_WINDOW_MIN && t <= m + until) {
                const at = new Date(now);
                at.setHours(Math.floor(m / 60), m % 60, 0, 0);
                return { direction: dir, leaveAt: at.getTime(), until: at.getTime() + Math.round(until * 60000) };
            }
        }
        return null;
    }

    /** Where a point lies on a [[lat, lon], ...] line: { distM, alongM, totalM }. */
    function onLine(line, p) {
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
    }

    /** The share of a route's drive time between fractions a and b, slow / jammed stretches weighted. */
    function timeShare(route, a, b) {
        const W = { NORMAL: 1, SLOW: 2.2, TRAFFIC_JAM: 4 };
        const segs = (route.segments || []).filter((sg) => sg.to > sg.from);
        const weightBetween = (x, y) => {
            let w = y - x; // NORMAL everywhere ...
            segs.forEach((sg) => { const o = Math.max(0, Math.min(y, sg.to) - Math.max(x, sg.from)); if (o > 0) w += o * ((W[sg.speed] || 1) - 1); }); // ... plus the extra of slower stretches
            return w;
        };
        const all = weightBetween(0, 1);
        return all > 0 ? weightBetween(a, b) / all : (b - a);
    }

    /**
     * Driving the commute now: { direction, leftSec, arriveAt, toGoM, at } from the phone's last position on
     * the last report's route, or null (not in the window, no device position, off the route).
     */
    function driving() {
        const win = driveWindow();
        if (!win || !here || here.source !== 'device' || Date.now() - here.at > 5 * 60 * 1000) return null;
        // still at Home or already at Work (inside the radius): not on the way
        if (placeNow()) return null;
        const r = latest[win.direction];
        const p = r && r.preferred;
        if (!p || !Array.isArray(p.line) || p.line.length < 2 || p.durationSec == null) return null;
        const loc = onLine(p.line, here);
        if (loc.distM > ON_ROUTE_M || !loc.totalM) return null;
        const f = Math.max(0, Math.min(1, loc.alongM / loc.totalM));
        if (f > 0.995) return null; // arrived
        const leftSec = Math.round(p.durationSec * timeShare(p, f, 1));
        return { direction: win.direction, leaveAt: win.leaveAt, leftSec, arriveAt: Date.now() + leftSec * 1000, toGoM: (p.distanceM || loc.totalM) * (1 - f), at: f, totalM: p.distanceM || loc.totalM };
    }

    // ---------------------------------------------------------------- cameras on the way home (Yukimi, #809)
    //
    // Driving home, the OSM cameras of the report on the route ahead of the phone (never behind it):
    // one within 5 mi puts the position on a live watch (the phone's own GPS, nothing asked of the
    // server), and at 1 mi each camera is a WM notification with the Warnings sound, once per drive.

    /** [{ trap, aheadM }] for cameras ahead within CAM_WATCH_M, nearest first; f = the phone's fraction along, totalM the route length. */
    function camerasAhead(traps, f, totalM) {
        if (!Array.isArray(traps) || !(totalM > 0)) return [];
        return traps.map((t) => ({ trap: t, aheadM: (t.at - f) * totalM }))
            .filter((c) => Number.isFinite(c.aheadM) && c.aheadM > 0 && c.aheadM <= CAM_WATCH_M)
            .sort((a, b) => a.aheadM - b.aheadM);
    }

    const camKey = (t) => t.id || `${t.lat},${t.lon}`;
    const camDrive = { key: '', alerted: new Set() };
    let camWatchId = null;
    let camFixAt = 0;

    function watchCameras() {
        const dv = driving();
        const r = latest.home;
        if (!dv || dv.direction !== 'home' || !r || !r.traps) { stopCamWatch(); return; }
        const key = `home:${dv.leaveAt}`;
        if (camDrive.key !== key) { camDrive.key = key; camDrive.alerted.clear(); }
        nativeAlerted(key).forEach((id) => camDrive.alerted.add(id));
        // the app's own watch has this drive: it alerts (locked or not), the page only keeps count (#810)
        const native = nativeDrive.active && nativeDrive.key === key;
        const ahead = camerasAhead(r.traps, dv.at, dv.totalM).filter((c) => !camDrive.alerted.has(camKey(c.trap)));
        ahead.filter((c) => c.aheadM <= CAM_ALERT_M).forEach((c) => { camDrive.alerted.add(camKey(c.trap)); if (!native) cameraNote(c.trap, c.aheadM); });
        if (ahead.some((c) => c.aheadM > CAM_ALERT_M)) startCamWatch(); else stopCamWatch();
    }

    // The Android app's own watch (DSApp window.AndroidDriveWatch, #810): the page is paused while the
    // phone is locked, so in the way-home window the app gets the route and its cameras and alerts at
    // 1 mi natively (a location service started while the page is on screen). Without the bridge (a
    // browser, an older app build) or when it refuses (no location / notifications), the page alerts.
    const nativeDrive = { sig: '', key: '', active: false, reason: '', alerted: new Set() };

    function nativeBridge() { const b = window.AndroidDriveWatch; return b && typeof b.start === 'function' ? b : null; }

    function nativeStatus(st) {
        try {
            const d = typeof st === 'string' ? JSON.parse(st) : st;
            if (!d) return;
            nativeDrive.active = !!d.active;
            nativeDrive.reason = d.reason || '';
            if (d.key) {
                if (d.key !== nativeDrive.key) nativeDrive.alerted.clear();
                nativeDrive.key = d.key;
                (d.alerted || []).forEach((id) => nativeDrive.alerted.add(String(id)));
            }
        } catch (_) { /* a bad answer: leave the page's own path on */ }
    }

    /** Ids the app already alerted for this drive (also after its watch ended), so the page never alerts them again. */
    function nativeAlerted(key) {
        const b = nativeBridge();
        if (b && typeof b.status === 'function') nativeStatus(b.status());
        return nativeDrive.key === key ? [...nativeDrive.alerted] : [];
    }

    /** The plan the app watches: the way home's route, its cameras in metres along it, Home / Work, the window's end. */
    function drivePlan(win) {
        const r = latest.home;
        const p = r && r.preferred;
        if (!p || !Array.isArray(p.line) || p.line.length < 2 || !Array.isArray(r.traps)) return null;
        const total = onLine(p.line, { lat: p.line[0][0], lon: p.line[0][1] }).totalM;
        const c = placeCoords();
        const key = `home:${win.leaveAt}`;
        return {
            key,
            until: win.until,
            line: p.line,
            cameras: r.traps.map((t) => ({ id: camKey(t), alongM: Math.round(t.at * total), title: `${t.label || 'Speed camera'} ahead`, street: t.street || '', maxspeed: t.maxspeed || '', count: t.count || 1 })),
            home: c.home, work: c.work,
            radiusM: Math.round(((settings && settings.radiusKm) || 1.5) * 1000),
            alerted: camDrive.key === key ? [...camDrive.alerted] : [],
            watchM: CAM_WATCH_M, alertM: CAM_ALERT_M, onRouteM: ON_ROUTE_M,
            reportAt: r.at
        };
    }

    /** In the way-home window: hand the app the plan once per drive and report (it ends itself at Home or the window's end). */
    function armNativeWatch() {
        const b = nativeBridge();
        if (!b || !canUse() || !loaded || !configured() || document.hidden) return;
        const win = driveWindow();
        if (!win || win.direction !== 'home' || !win.until) return;
        const plan = drivePlan(win);
        if (!plan) return;
        const sig = `${plan.key}|${plan.reportAt}`;
        if (sig === nativeDrive.sig) {
            // Android refuses the location service unless the app is in front: try again now the page is on screen
            const b2 = nativeBridge();
            if (b2 && typeof b2.status === 'function') nativeStatus(b2.status());
            if (nativeDrive.active || !/^(not allowed|no location access)$/.test(nativeDrive.reason)) return;
        }
        nativeDrive.sig = sig;
        let res = null;
        try { res = JSON.parse(b.start(JSON.stringify(plan)) || 'null'); } catch (_) { res = null; }
        if (res && res.ok) { nativeDrive.active = true; nativeDrive.key = plan.key; }
        else { nativeDrive.active = false; console.warn(`[traffic] the app's drive watch is off: ${(res && res.error) || 'no answer'}`); }
    }

    function startCamWatch() {
        if (camWatchId != null || !inApp() || geoDenied || !navigator.geolocation || (window.wmGps && !window.wmGps.allowed())) return;
        camWatchId = navigator.geolocation.watchPosition((pos) => {
            here = { at: Date.now(), lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyKm: Math.min(5, (pos.coords.accuracy || 0) / 1000), source: 'device' };
            geoAt = Date.now();
            watchCameras();
            // the car on the strip and the time left: every 10 s is plenty
            if (Date.now() - camFixAt > 10000) { camFixAt = Date.now(); changed(); }
        }, () => { /* the minute reads carry on */ }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    }

    function stopCamWatch() {
        if (camWatchId == null) return;
        try { navigator.geolocation.clearWatch(camWatchId); } catch (_) { /* gone */ }
        camWatchId = null;
    }

    function cameraNote(t, aheadM) {
        const title = `${t.label || 'Speed camera'} ahead`;
        const text = `${miles(aheadM)} ahead${t.street ? ` on ${t.street}` : ''}.${t.maxspeed ? ` Limit ${t.maxspeed}.` : ''}${t.count > 1 ? ` ${t.count} cameras.` : ''}`;
        const view = () => { if (note && note.close) note.close(); open('home'); openLayer('traps'); };
        let note = null;
        if (ws && typeof ws.appNote === 'function') {
            note = ws.appNote({
                title,
                html: esc(text),
                icon: 'app-traffic',
                event: 'warning',
                softKeys: () => ({ left: { label: 'View', action: view }, right: { label: 'Dismiss', action: () => { if (note) note.close(); } } })
            });
            if (note) return;
        }
        if (ws && typeof ws.notify === 'function') {
            ws.notify({ title, text, icon: 'warning', asNote: true, timeout: false, buttons: [{ text: 'View', type: 'primary', closeOnClick: true, onClick: view }] });
        }
    }

    // ---------------------------------------------------------------- direction

    function minutesOf(hhmm) { const m = /^(\d\d):(\d\d)$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }

    /** The commute that matters now: before noon (or before leaving Home) To Work, after it To Home. */
    function autoDirection() {
        const now = new Date();
        const t = now.getHours() * 60 + now.getMinutes();
        const lw = minutesOf(settings && settings.leaveWork);
        const lh = minutesOf(settings && settings.leaveHome);
        if (lh != null && lw != null) return t < Math.round((lh + lw) / 2) + 120 && t >= 180 ? 'work' : 'home';
        return t >= 3 * 60 && t < 12 * 60 ? 'work' : 'home';
    }

    /** The commute ahead: picked in the app (this visit), else by where the phone is, else by the time. */
    function direction() {
        if (dirPicked) return dirPicked;
        const dv = driving();
        if (dv) return dv.direction;
        const p = placeNow() || storedPlace();
        if (p) return p === 'home' ? 'work' : 'home';
        return autoDirection();
    }

    /** Where the direction came from, for the plate ("At Home", "At Work", "On the road"). */
    function whereText() {
        if (dirPicked) return '';
        const dv = driving();
        if (dv) return 'On your route';
        const p = placeNow();
        if (p) return p === 'home' ? 'At Home' : 'At Work';
        if (here) return 'On the road';
        return '';
    }

    function setDirection(d) {
        dirPicked = d;
        render();
        const r = latest[d];
        if (shown && configured() && (!r || Date.now() - Date.parse(r.at) > STALE_MS)) quietCheck(d);
    }

    const configured = () => !!(settings && settings.home && settings.work);

    function quietCheck(d) {
        check(d, false).catch(() => {});
    }

    async function userRefresh() {
        if (!configured()) { openSettings(); return; }
        readPosition(true);
        const d = direction();
        try {
            await ws.busy(check(d, true), { delay: 250, timeout: 45000 });
            if (layers[layers.length - 1] === 'advisor') await ws.busy(loadAdvice(d, true), { delay: 0, timeout: 45000 });
            render();
        } catch (err) {
            ws.messageBox({ title: TITLE, icon: 'error', text: `Traffic could not be checked.\n\n${(err && err.message) || 'Check the data connection, then try again.'}` });
        }
    }

    // ---------------------------------------------------------------- art (inline, our own)

    const ICON_SVG = {
        // the phone on the route, seen from above, heading right (Home is the strip's right end)
        car: '<svg viewBox="0 0 28 16"><defs><linearGradient id="trfCarBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a4d"/><stop offset=".45" stop-color="#d8240c"/><stop offset="1" stop-color="#7c1004"/></linearGradient><linearGradient id="trfCarGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe6ff"/><stop offset="1" stop-color="#2b4a6e"/></linearGradient></defs><rect x="3" y="1" width="4" height="2.4" rx=".8" fill="#111"/><rect x="18" y="1" width="4" height="2.4" rx=".8" fill="#111"/><rect x="3" y="12.6" width="4" height="2.4" rx=".8" fill="#111"/><rect x="18" y="12.6" width="4" height="2.4" rx=".8" fill="#111"/><path d="M2.5 4.2Q2.5 2.4 4.6 2.4H21.5Q26.8 2.6 26.8 8T21.5 13.6H4.6Q2.5 13.6 2.5 11.8z" fill="url(#trfCarBody)" stroke="#3a0700" stroke-width=".8"/><path d="M16.6 4.2h2.6q2 .6 2 3.8t-2 3.8h-2.6q.9-1.4.9-3.8t-.9-3.8z" fill="url(#trfCarGlass)" stroke="#16263a" stroke-width=".5"/><path d="M6.2 4.6h2q-.6 1.4-.6 3.4t.6 3.4h-2q-.7-1.3-.7-3.4t.7-3.4z" fill="url(#trfCarGlass)" stroke="#16263a" stroke-width=".5"/><rect x="9.4" y="4.4" width="6.6" height="7.2" rx="1.2" fill="#c41d08" stroke="#5c0b00" stroke-width=".5"/><path d="M9.8 5h5.8" stroke="#ffb3a3" stroke-width=".7" stroke-linecap="round" opacity=".8"/><rect x="25" y="4" width="1.4" height="2.2" rx=".5" fill="#fff6c8"/><rect x="25" y="9.8" width="1.4" height="2.2" rx=".5" fill="#fff6c8"/><rect x="2.4" y="4.2" width="1" height="2" fill="#ff2a10"/><rect x="2.4" y="9.8" width="1" height="2" fill="#ff2a10"/></svg>',
        trap: '<svg viewBox="0 0 20 20"><rect x="2" y="5" width="12" height="9" rx="1.5" fill="#3a4048" stroke="#111" stroke-width=".8"/><rect x="14" y="7" width="4" height="5" rx="1" fill="#22262b" stroke="#111" stroke-width=".8"/><circle cx="7" cy="9.5" r="3" fill="#0d1a2b" stroke="#8fb6e6" stroke-width="1"/><circle cx="6.2" cy="8.7" r=".9" fill="#cfe4ff"/><rect x="11" y="6.3" width="2" height="1.4" fill="#e8341c"/><path d="M8 14v4M5 18h6" stroke="#555" stroke-width="1.6"/></svg>',
        lane: '<svg viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" fill="#3b4148"/><path d="M7 2v16M13 2v16" stroke="#fff" stroke-width="1" stroke-dasharray="2 2"/><path d="M14.2 6l3 3-3 3M17 9h-5" fill="none" stroke="#ffc21a" stroke-width="1.8"/><path d="M4 5l4 9M8 5l-4 9" stroke="#e8341c" stroke-width="1.8"/></svg>',
        accident: '<svg viewBox="0 0 20 20"><path d="M10 1l2.2 4.6 5-1.4-2.4 4.4 4.2 2.8-5 .7.3 5.1L10 14.3 5.7 17.2l.3-5.1-5-.7 4.2-2.8L2.8 4.2l5 1.4z" fill="#e03018" stroke="#5c0d02" stroke-width=".8"/><path d="M10 6l1 3h-2zM9 10.5h2v1.8H9z" fill="#fff"/></svg>',
        hazard: '<svg viewBox="0 0 20 20"><path d="M10 1.8l8.6 15.4H1.4z" fill="#ffc21a" stroke="#6b4a00" stroke-width="1" stroke-linejoin="round"/><path d="M9 6.5h2l-.4 6h-1.2zM9 13.8h2v2H9z" fill="#1a1a1a"/></svg>',
        closure: '<svg viewBox="0 0 20 20"><rect x="1.5" y="6" width="17" height="6" fill="#fff" stroke="#5c0d02"/><path d="M3 6l4 6M8 6l4 6M13 6l4 6" stroke="#e03018" stroke-width="2.2"/><path d="M4 12v6M16 12v6" stroke="#555" stroke-width="1.6"/></svg>',
        construction: '<svg viewBox="0 0 20 20"><path d="M8.3 2h3.4l4.3 14H4z" fill="#ff7a12" stroke="#6b2a00" stroke-width=".8"/><path d="M7 7h6l.8 2.6H6.2zM5.3 12.3h9.4l.7 2.3H4.6z" fill="#fff"/><rect x="2" y="16" width="16" height="2.4" fill="#444"/></svg>',
        jam: '<svg viewBox="0 0 20 20"><rect x="1.5" y="8" width="9" height="5" rx="1.5" fill="#d23b2a" stroke="#4a0c05" stroke-width=".7"/><rect x="9.5" y="5" width="9" height="5" rx="1.5" fill="#e8a317" stroke="#5a3a00" stroke-width=".7"/><circle cx="4" cy="13.5" r="1.4" fill="#222"/><circle cx="8" cy="13.5" r="1.4" fill="#222"/><circle cx="12" cy="10.5" r="1.4" fill="#222"/><circle cx="16" cy="10.5" r="1.4" fill="#222"/></svg>',
        slow: '<svg viewBox="0 0 20 20"><circle cx="10" cy="11" r="7.5" fill="#f2f2f2" stroke="#444" stroke-width="1.2"/><path d="M4.5 11a5.5 5.5 0 0111 0" fill="none" stroke="#e8a317" stroke-width="2"/><path d="M10 11L6.4 7.6" stroke="#d23b2a" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="11" r="1.2" fill="#222"/></svg>',
        advisor: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#fdfdfd" stroke="#38424d" stroke-width="1.4"/><path d="M10 4.5V10l3.6 2.2" fill="none" stroke="#1d4fa8" stroke-width="1.6" stroke-linecap="round"/></svg>',
        routes: '<svg viewBox="0 0 20 20"><path d="M4 18c0-6 12-4 12-10V3" fill="none" stroke="#3f8f22" stroke-width="2.2"/><path d="M4 18V9c0-3 3-5 6-5" fill="none" stroke="#1d4fa8" stroke-width="2.2" stroke-dasharray="2.4 1.6"/><circle cx="4" cy="18" r="1.8" fill="#222"/><path d="M16 1l2.6 3.2h-5.2z" fill="#222"/></svg>',
        home: '<svg viewBox="0 0 20 20"><path d="M10 2.5l8 7h-2.3V17H4.3V9.5H2z" fill="#f5f5f5" stroke="#28323c" stroke-width="1.2" stroke-linejoin="round"/><rect x="8.3" y="11.5" width="3.4" height="5.5" fill="#b0562a"/></svg>',
        work: '<svg viewBox="0 0 20 20"><rect x="2" y="6" width="16" height="11" rx="1.5" fill="#6b4a2b" stroke="#2a1a0b" stroke-width="1"/><path d="M7 6V4h6v2" fill="none" stroke="#2a1a0b" stroke-width="1.4"/><rect x="2" y="10" width="16" height="1.6" fill="#3d2913"/></svg>'
    };
    const icon = (k, cls = '') => `<span class="trf-ico ${cls}" aria-hidden="true">${ICON_SVG[k] || ICON_SVG.hazard}</span>`;

    // ---------------------------------------------------------------- build

    function build() {
        page.innerHTML = `
            <div class="trf-root">
                <div class="trf-plate">
                    <div class="trf-seg" role="tablist">
                        <button type="button" class="trf-seg-btn" data-dir="work" role="tab">${icon('work', 'is-small')}<span>To Work</span></button>
                        <button type="button" class="trf-seg-btn" data-dir="home" role="tab">${icon('home', 'is-small')}<span>To Home</span></button>
                    </div>
                    <div class="trf-ends"></div>
                </div>
                <div class="trf-scroll">
                    <div class="trf-dash">
                        <div class="trf-signal" aria-hidden="true"><i class="is-red"></i><i class="is-amber"></i><i class="is-green"></i></div>
                        <div class="trf-lcd">
                            <div class="trf-lcd-num"><b class="trf-min">--</b><span class="trf-min-unit">min</span></div>
                            <div class="trf-lcd-sub"></div>
                        </div>
                        <div class="trf-delay"></div>
                    </div>
                    <div class="trf-status"></div>
                    <div class="trf-road"><div class="trf-road-bed"><div class="trf-road-segs"></div><div class="trf-road-line"></div><div class="trf-road-pins"></div></div><div class="trf-road-ends"><span class="trf-road-a"></span><span class="trf-road-via"></span><span class="trf-road-b"></span></div></div>
                    <button type="button" class="trf-advice" hidden></button>
                    <div class="trf-rows"></div>
                    <div class="trf-foot"></div>
                </div>
                <div class="trf-layer" hidden><div class="wm-form-hdr trf-layer-hdr"></div><div class="trf-layer-body"></div></div>
            </div>`;
        const q = (s) => page.querySelector(s);
        els = {
            root: q('.trf-root'), seg: q('.trf-seg'), ends: q('.trf-ends'), scroll: q('.trf-scroll'), dash: q('.trf-dash'),
            signal: q('.trf-signal'), min: q('.trf-min'), lcdSub: q('.trf-lcd-sub'), delay: q('.trf-delay'), status: q('.trf-status'),
            road: q('.trf-road'), segs: q('.trf-road-segs'), pins: q('.trf-road-pins'), roadA: q('.trf-road-a'), roadB: q('.trf-road-b'), via: q('.trf-road-via'),
            advice: q('.trf-advice'), rows: q('.trf-rows'), foot: q('.trf-foot'),
            layer: q('.trf-layer'), layerHdr: q('.trf-layer-hdr'), layerBody: q('.trf-layer-body')
        };
        els.seg.addEventListener('click', (e) => { const b = e.target.closest('[data-dir]'); if (b) setDirection(b.dataset.dir); });
        els.rows.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openLayer(b.dataset.open); });
        els.advice.addEventListener('click', () => openLayer(els.advice.dataset.open || 'routes'));
        els.road.addEventListener('click', () => openLayer('routes'));
        els.layerBody.addEventListener('click', onLayerClick);
    }

    // ---------------------------------------------------------------- main page

    function render() {
        if (!els) return;
        const d = direction();
        els.seg.querySelectorAll('[data-dir]').forEach((b) => { b.classList.toggle('is-on', b.dataset.dir === d); b.setAttribute('aria-selected', String(b.dataset.dir === d)); });
        if (layers.length) renderLayer();
        const r = latest[d];
        if (!canUse()) { setEmpty('Traffic is available to the administrator only.'); return; }
        if (!loaded) { setEmpty(loadFailed ? `Traffic could not be loaded.\n${loadFailed}` : 'Loading...'); return; }
        if (!configured()) { setEmpty(isAdmin() ? 'Set your Home and Work, the streets you like to take, and when you leave. Tap Menu > Settings.' : 'The administrator has not set up the commute yet.', true); return; }
        els.root.classList.remove('is-empty');
        const fromName = d === 'work' ? 'Home' : 'Work';
        const toName = d === 'work' ? 'Work' : 'Home';
        const where = whereText();
        els.ends.textContent = `${where ? `${where}:  ` : ''}${fromName}  →  ${toName}`;
        if (!r) {
            els.min.textContent = '--';
            els.lcdSub.textContent = checking[d] ? 'Checking traffic...' : 'No report yet';
            els.delay.innerHTML = '';
            els.signal.dataset.level = 'none';
            els.status.textContent = checking[d] ? '' : 'Tap Refresh to check the traffic.';
            els.segs.innerHTML = '';
            els.pins.innerHTML = '';
            els.road.classList.remove('is-driving');
            els.via.textContent = '';
            els.advice.hidden = true;
            els.rows.innerHTML = rowsHtml(null);
            els.foot.textContent = footText();
            return;
        }
        const p = r.preferred || {};
        els.signal.dataset.level = r.level || 'clear';
        els.dash.classList.toggle('is-checking', !!checking[d]);
        const dv = driving();
        const onIt = dv && dv.direction === d;
        els.min.textContent = mins(onIt ? dv.leftSec : p.durationSec);
        const arrive = onIt ? clock(dv.arriveAt) : (p.durationSec != null ? clock(Date.now() + p.durationSec * 1000) : '');
        els.lcdSub.textContent = arrive ? `Arrive ${arrive}${onIt ? `  \u00b7  ${miles(dv.toGoM)} to go` : ''}` : '';
        const delay = r.delaySec || 0;
        const usual = p.staticSec ? `<small>usually ${esc(mins(p.staticSec))}</small>` : '';
        els.delay.innerHTML = `<span class="trf-delay-badge is-${delay >= 60 ? r.level : 'clear'}">${delay >= 60 ? `+${mins(delay)}` : 'On time'}</span>${usual}`;
        const majors = (r.alerts || []).filter((a) => a.kind === 'accident' || a.kind === 'closure');
        els.status.textContent = majors.length ? `${majors[0].label}${majors[0].street ? ` on ${majors[0].street}` : ''}` : (LEVEL_TEXT[r.level] || '');
        els.status.className = `trf-status is-${majors.length ? 'heavy' : r.level}`;
        // the road strip: slow and jammed stretches, pins along it
        els.segs.innerHTML = segsHtml(p.segments);
        const pins = [].concat(
            (r.traps || []).map((t) => ({ at: t.at, kind: 'trap' })),
            (r.alerts || []).map((a) => ({ at: a.at, kind: a.kind })),
            (r.jams || []).filter((j) => j.major).map((j) => ({ at: j.at, kind: 'jam' }))
        );
        const pinAt = (at) => `left:${(Math.max(0.02, Math.min(0.98, at)) * 100).toFixed(2)}%`;
        // driving it: what is behind the car is dimmed, and the car sits where the phone is (#809)
        els.pins.innerHTML = pins.map((pn) => `<span class="trf-pin is-${pn.kind}${onIt && pn.at < dv.at ? ' is-passed' : ''}" style="${pinAt(pn.at)}">${ICON_SVG[pn.kind] || ICON_SVG.hazard}</span>`).join('')
            + (onIt ? `<span class="trf-pin is-car" style="${pinAt(dv.at)}" title="${esc(`${Math.round(dv.at * 100)}% of the way, ${miles(dv.toGoM)} to go`)}">${ICON_SVG.car}</span>` : '');
        els.road.classList.toggle('is-driving', !!onIt);
        if (onIt) els.road.style.setProperty('--trf-done', `${(Math.max(0, Math.min(1, dv.at)) * 100).toFixed(2)}%`);
        els.roadA.textContent = fromName;
        els.roadB.textContent = toName;
        els.via.textContent = onIt ? `${Math.round(dv.at * 100)}% of the way  ·  ${miles(dv.toGoM)} to go` : (p.summary ? `via ${p.summary}${p.distanceM ? `  ·  ${miles(p.distanceM)}` : ''}` : '');
        // advice: a faster route, else waiting (the way home), else a major slowdown
        const adv = advice[d];
        if (r.better) {
            els.advice.hidden = false;
            els.advice.dataset.open = 'routes';
            els.advice.innerHTML = `${icon('routes')}<span><b>Faster route available</b><br>via ${esc(r.better.summary)} saves ${esc(minText(r.better.savesSec))}</span>`;
        } else if (adv && adv.wait) {
            els.advice.hidden = false;
            els.advice.dataset.open = 'advisor';
            els.advice.innerHTML = `${icon('advisor')}<span><b>Wait ${esc(adv.wait.offsetMin)} min before leaving</b><br>Leave at ${esc(clock(adv.wait.leaveAt))} and drive ${esc(minText(adv.wait.savesSec))} less</span>`;
        } else if (r.major) {
            els.advice.hidden = false;
            els.advice.dataset.open = 'slow';
            els.advice.innerHTML = `${icon('slow')}<span><b>Major slowdown on your route</b><br>No faster route right now</span>`;
        } else {
            els.advice.hidden = true;
        }
        els.rows.innerHTML = rowsHtml(r);
        els.foot.textContent = footText(r);
    }

    function setEmpty(text, setup) {
        els.root.classList.add('is-empty');
        els.ends.textContent = '';
        els.min.textContent = '--';
        els.lcdSub.textContent = '';
        els.delay.innerHTML = '';
        els.signal.dataset.level = 'none';
        els.status.textContent = '';
        els.segs.innerHTML = '';
        els.pins.innerHTML = '';
        els.road.classList.remove('is-driving');
        els.via.textContent = '';
        els.advice.hidden = true;
        els.rows.innerHTML = `<div class="trf-empty">${esc(text).replace(/\n/g, '<br>')}${setup && isAdmin() ? '<br><button type="button" class="trf-glass-btn" data-open="settings">Set Up Commute</button>' : ''}</div>`;
        els.foot.textContent = '';
    }

    function rowsHtml(r) {
        const n = (a) => (r && Array.isArray(a) ? a.length : 0);
        const row = (open, ico, label, count, extra = '') => `<button type="button" class="trf-row${count === '?' ? ' is-unknown' : count ? ' has-items' : ''}" data-open="${open}">${icon(ico)}<span class="trf-row-label">${esc(label)}</span>${extra}<span class="trf-row-count">${count == null ? '' : esc(count)}</span><span class="trf-row-arrow"></span></button>`;
        const trapCount = r ? (r.camerasChecked ? n(r.traps) : '?') : null;
        return row('traps', 'trap', 'Speed Traps on route', trapCount)
            + row('alerts', 'hazard', 'Alerts', r ? (r.incidentsChecked ? n(r.alerts) : '?') : null)
            + row('slow', 'slow', 'Slowdowns', r ? n(r.slowdowns) + n((r.jams || []).filter((j) => !r.slowdowns.length || j.major)) : null)
            + row('advisor', 'advisor', direction() === 'home' ? 'When to Leave' : 'Leave Advisor', null)
            + row('routes', 'routes', 'Routes', r ? n(r.routes) : null);
    }

    function footText(r) {
        const parts = [];
        if (r) parts.push(`Updated ${clock(r.at)}`);
        if (r) parts.push(['Google', r.incidentsChecked ? 'TomTom' : '', r.camerasChecked ? 'OpenStreetMap' : ''].filter(Boolean).join(', '));
        if (r && r.errors && r.errors.length) parts.push(shortError(r.errors[0]));
        return parts.join('  ·  ');
    }

    /** A report's note in a few words for the footer (the full text stays in the report). */
    function shortError(e) {
        const t = String(e || '');
        if (/^Speed cameras:/.test(t)) return 'Speed cameras not loaded yet';
        if (/^TomTom:/.test(t)) return /budget/i.test(t) ? 'TomTom budget used up today' : 'TomTom alerts unavailable';
        if (/^Could not place/.test(t)) return t.replace(/ \(.*\)$/, '');
        if (/showing the closest Google route/.test(t)) return 'Your streets could not be joined; showing the closest route';
        return t.length > 60 ? `${t.slice(0, 57)}...` : t;
    }

    // ---------------------------------------------------------------- layers

    function openLayer(name) {
        if (name === 'settings' && !isAdmin()) { ws.messageBox({ title: TITLE, icon: 'info', text: 'Only the administrator can change the commute.' }); return; }
        if (name !== 'settings' && !configured()) { if (isAdmin()) name = 'settings'; else return; }
        if (layers[layers.length - 1] !== name) layers.push(name);
        if (name === 'settings') draft = null;
        syncLayers();
        if (name === 'advisor') ensureAdvice();
    }

    function popLayer() {
        if (!layers.length) return false;
        layers.pop();
        syncLayers();
        return true;
    }

    function syncLayers() {
        if (!els) return;
        const top = layers[layers.length - 1] || null;
        els.layer.hidden = !top;
        if (top) renderLayer();
        ws.setTitle(top ? (LAYER_TITLES[top] || TITLE) : TITLE);
        ws.syncHistory();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    function renderLayer() {
        const top = layers[layers.length - 1];
        if (!top || !els) return;
        const d = direction();
        const r = latest[d];
        els.layer.dataset.layer = top;
        const hdr = { routes: `Routes ${d === 'work' ? 'to Work' : 'to Home'}`, traps: 'Speed Traps on route', alerts: 'Alerts on route', slow: 'Slowdowns on route', advisor: d === 'home' ? 'When to Leave Work' : 'When to Leave Home', settings: 'Traffic Settings', item: (itemView && itemView.label) || 'Details' }[top];
        els.layerHdr.textContent = hdr;
        if (top === 'settings') { renderSettings(); return; }
        if (top === 'routes') els.layerBody.innerHTML = routesHtml(r);
        else if (top === 'traps') els.layerBody.innerHTML = listHtml((r && r.traps) || [], r && !r.camerasChecked ? 'The speed camera list could not be loaded for this report. Tap Refresh.' : 'No speed or red light cameras are mapped on your route.', 'trap')
            + '<div class="trf-note">Fixed speed and red light cameras mapped on OpenStreetMap. Mobile speed traps are not listed.</div>';
        else if (top === 'alerts') els.layerBody.innerHTML = listHtml((r && r.alerts) || [], r && !r.incidentsChecked ? incidentsMissing() : 'No accidents, closures or roadworks reported on your route.');
        else if (top === 'slow') els.layerBody.innerHTML = slowHtml(r);
        else if (top === 'advisor') els.layerBody.innerHTML = advisorHtml(d);
        else if (top === 'item') els.layerBody.innerHTML = itemHtml(itemView);
        els.layerBody.className = 'trf-layer-body';
    }

    function incidentsMissing() {
        if (provs && provs.tomtom && !provs.tomtom.configured) return 'Accidents, closures and roadworks come from TomTom. Add a TomTom key in Dreamscape CardSpace > Service keys.';
        if (provs && provs.tomtom && provs.tomtom.left <= 0) return 'Today\'s TomTom budget is used up. Alerts return tomorrow.';
        return 'TomTom was not checked for this report. Tap Refresh.';
    }

    /**
     * The road strip's slow and jammed stretches: neighbours under 1.5 % of the route apart are one
     * stretch (jammed if any part is), each at least 3 % wide, so a long drive shows bands, not ticks.
     */
    function segsHtml(segments) {
        const out = [];
        (segments || []).filter((sg) => sg.speed !== 'NORMAL').sort((a, b) => a.from - b.from).forEach((sg) => {
            const last = out[out.length - 1];
            if (last && sg.from - last.to < 0.015) {
                last.to = Math.max(last.to, sg.to);
                if (sg.speed === 'TRAFFIC_JAM') last.speed = 'TRAFFIC_JAM';
            } else out.push({ from: sg.from, to: sg.to, speed: sg.speed });
        });
        return out.map((sg) => {
            const w = Math.max(3, (sg.to - sg.from) * 100);
            const left = Math.min(100 - w, sg.from * 100);
            return `<i class="is-${sg.speed === 'TRAFFIC_JAM' ? 'jam' : 'slow'}" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%"></i>`;
        }).join('');
    }

    function routeStrip(rt) {
        const segs = segsHtml(rt.segments);
        return `<div class="trf-mini-road"><div class="trf-road-segs">${segs}</div><div class="trf-road-line"></div></div>`;
    }

    function routesHtml(r) {
        if (!r || !r.routes || !r.routes.length) return '<div class="trf-none">No routes yet. Tap Refresh.</div>';
        return r.routes.map((rt) => {
            const badges = [rt.preferred ? '<span class="trf-badge is-pref">Preferred</span>' : '', rt.fastest ? '<span class="trf-badge is-fast">Fastest</span>' : ''].join('');
            const c = rt.counts || {};
            const facts = [rt.durationSec != null ? `arrive ${clock(Date.now() + rt.durationSec * 1000)}` : '', rt.distanceM ? miles(rt.distanceM) : '', rt.delaySec >= 60 ? `+${minText(rt.delaySec)} traffic` : 'no delay', c.traps ? `${c.traps} camera${c.traps > 1 ? 's' : ''}` : '', c.alerts ? `${c.alerts} alert${c.alerts > 1 ? 's' : ''}` : ''].filter(Boolean).join('  ·  ');
            const streets = rt.streetsHit && rt.streetsHit.length && r.streets && r.streets.length ? `Uses ${rt.streetsHit.length} of your ${r.streets.length} streets` : '';
            return `<div class="trf-card${rt.preferred ? ' is-pref' : ''}">
                <div class="trf-card-top"><b class="trf-card-min">${esc(mins(rt.durationSec))}<small>min</small></b><span class="trf-card-name">via ${esc(rt.summary || 'route')}</span>${badges}</div>
                ${routeStrip(rt)}
                <div class="trf-card-facts">${esc(facts)}</div>
                ${streets ? `<div class="trf-card-facts">${esc(streets)}</div>` : ''}
                ${(rt.warnings || []).length ? `<div class="trf-card-warn">${esc(rt.warnings.join('; '))}</div>` : ''}
                ${rt.preferred ? '' : `<div class="trf-card-act"><button type="button" class="trf-glass-btn is-small" data-turns="${esc(rt.id)}">Directions</button></div>`}
            </div>`;
        }).join('') + (r.streets && r.streets.length ? `<div class="trf-note">Preferred route: ${esc(r.streets.join(' → '))}</div>` : '<div class="trf-note">No preferred streets set: the first route is Google\'s pick. Add your streets in Settings.</div>');
    }

    /** Where on the trip a point at fraction `at` is: "12.4 mi from Home" in the first half, "0.5 mi before Work" after. */
    function alongText(at) {
        const d = direction();
        const r = latest[d];
        const total = r && r.preferred && r.preferred.distanceM;
        if (!total) return `${Math.round(at * 100)}% along`;
        const from = d === 'work' ? 'Home' : 'Work';
        const to = d === 'work' ? 'Work' : 'Home';
        return at <= 0.5 ? `${miles(at * total)} from ${from}` : `${miles((1 - at) * total)} before ${to}`;
    }

    function listHtml(rows, empty, kind) {
        if (!rows.length) return `<div class="trf-none">${esc(empty)}</div>`;
        return `<div class="trf-list">${rows.map((a, i) => {
            const where = [a.street, a.city].filter(Boolean).join(', ') || 'On your route';
            const when = a.reportedAt ? `Reported ${ago(a.reportedAt)}` : '';
            const extra = [a.maxspeed ? `Limit ${a.maxspeed}` : (a.delaySec >= 60 ? `+${minText(a.delaySec)}` : ''), a.count > 1 ? `${a.count} cameras` : ''].filter(Boolean).join('  ·  ');
            const along = a.at != null ? alongText(a.at) : '';
            return `<button type="button" class="trf-li" data-item="${kind || 'alert'}:${i}">${icon(a.kind || kind)}<span class="trf-li-text"><b>${esc(a.label)}</b><span>${esc(where)}</span><small>${esc([extra, a.fixed ? '' : when, along].filter(Boolean).join('  ·  '))}</small></span></button>`;
        }).join('')}</div>`;
    }

    function slowHtml(r) {
        if (!r) return '<div class="trf-none">No report yet. Tap Refresh.</div>';
        const rows = (r.slowdowns || []).map((s) => ({
            kind: 'slow', label: s.speed === 'TRAFFIC_JAM' ? (s.major ? 'Heavy traffic' : 'Traffic jam') : 'Slow traffic',
            where: s.street || 'On your route', note: `${miles(s.lengthM)}  ·  ${alongText(s.from)}`, major: s.major
        })).concat((r.jams || []).map((j) => ({
            kind: 'jam', label: j.label || (j.major ? 'Major jam' : 'Jam'), where: j.street || 'On your route',
            note: [j.speedKmh != null ? `${Math.round(j.speedKmh / 1.609)} mph` : '', j.delaySec ? `+${minText(j.delaySec)}` : '', j.lengthM ? miles(j.lengthM) : '', j.causeText || ''].filter(Boolean).join('  ·  '),
            major: j.major
        })));
        if (!rows.length) return '<div class="trf-none">Traffic is moving normally on your route.</div>';
        return `<div class="trf-list">${rows.map((s) => `<div class="trf-li${s.major ? ' is-major' : ''}">${icon(s.kind)}<span class="trf-li-text"><b>${esc(s.label)}</b><span>${esc(s.where)}</span><small>${esc(s.note)}</small></span></div>`).join('')}</div>`
            + (r.better ? `<button type="button" class="trf-advice is-inline" data-go="routes">${icon('routes')}<span><b>Faster: via ${esc(r.better.summary)}</b><br>saves ${esc(minText(r.better.savesSec))}</span></button>` : '');
    }

    let adviceLoading = false;
    let adviceError = '';
    async function ensureAdvice(force) {
        const d = direction();
        const a = advice[d];
        if (!force && a && Date.now() - Date.parse(a.at) < 5 * 60 * 1000) return;
        adviceLoading = true;
        adviceError = '';
        renderLayer();
        try {
            await ws.busy(loadAdvice(d, force), { delay: 250, timeout: 45000 });
        } catch (err) {
            adviceError = (err && err.message) || 'The leave advisor could not be loaded.';
        } finally {
            adviceLoading = false;
            renderLayer();
            render();
        }
    }

    function advisorHtml(d) {
        const a = advice[d];
        if (adviceLoading && !a) return '<div class="trf-none">Looking at the traffic ahead...</div>';
        if (adviceError && !a) return `<div class="trf-none">${esc(adviceError)}</div>`;
        if (!a) return '<div class="trf-none">No forecast yet.</div>';
        const ok = a.steps.filter((s) => s.durationSec != null);
        const max = Math.max(...ok.map((s) => s.durationSec), 1);
        const min = Math.min(...ok.map((s) => s.durationSec));
        const head = `<div class="trf-adv-head${a.wait ? ' is-wait' : ''}">${icon('advisor')}<span>${esc(a.summary)}</span></div>`;
        const rows = a.steps.map((s) => {
            if (s.durationSec == null) return `<div class="trf-adv-row is-off"><span class="trf-adv-t">${esc(clock(s.leaveAt))}</span><span class="trf-adv-bar"></span><span class="trf-adv-v">--</span></div>`;
            const w = Math.max(8, Math.round((s.durationSec / max) * 100));
            const lvl = s.durationSec <= min + 120 ? 'clear' : s.durationSec - min > 600 ? 'heavy' : 'moderate';
            const pick = a.wait ? s.offsetMin === a.wait.offsetMin : s.offsetMin === 0;
            return `<div class="trf-adv-row${pick ? ' is-pick' : ''}"><span class="trf-adv-t">${s.offsetMin ? esc(clock(s.leaveAt)) : 'Now'}</span><span class="trf-adv-bar"><i class="is-${lvl}" style="width:${w}%"></i></span><span class="trf-adv-v">${esc(mins(s.durationSec))} min<small>arrive ${esc(clock(s.arriveAt))}</small></span></div>`;
        }).join('');
        return `${head}<div class="trf-adv">${rows}</div><div class="trf-note">Drive times on your preferred route with the traffic Google expects at each time. Updated ${esc(clock(a.at))}.</div>`;
    }

    function itemHtml(it) {
        if (!it) return '';
        const a = it.row;
        const rows = [
            ['Where', [a.street, a.city].filter(Boolean).join(', ') || 'On your route'],
            ['Speed limit', a.maxspeed || ''],
            ['Started', a.startedAt ? `${clock(a.startedAt)} (${ago(a.startedAt)})` : ''],
            ['Expected to end', a.endsAt ? clock(a.endsAt) : ''],
            ['Delay', a.delaySec >= 60 ? minText(a.delaySec) : ''],
            ['Length', a.lengthM ? miles(a.lengthM) : ''],
            ['On the route', a.at != null ? alongText(a.at) : '']
        ].filter(([, v]) => v);
        return `<div class="trf-item">${icon(a.kind || 'hazard', 'is-big')}<b>${esc(a.label)}</b>${a.description ? `<p>${esc(a.description)}</p>` : ''}</div>
            <div class="trf-facts">${rows.map(([l, v]) => `<span>${esc(l)}</span><span>${esc(v)}</span>`).join('')}</div>
            <div class="trf-note">${a.source === 'osm' ? 'A fixed camera mapped on OpenStreetMap (© OpenStreetMap contributors).' : 'Reported by TomTom Traffic.'}</div>`;
    }

    function onLayerClick(e) {
        const go = e.target.closest('[data-go]');
        if (go) { layers.pop(); openLayer(go.dataset.go); return; }
        const t = e.target.closest('[data-turns]');
        if (t) { showTurns(t.dataset.turns); return; }
        const it = e.target.closest('[data-item]');
        if (it) {
            const [kind, i] = it.dataset.item.split(':');
            const r = latest[direction()];
            const list = kind === 'trap' ? r.traps : r.alerts;
            const row = list && list[Number(i)];
            if (!row) return;
            itemView = { label: row.label, row };
            openLayer('item');
        }
    }

    function showTurns(id) {
        const r = latest[direction()];
        const rt = r && r.routes.find((x) => x.id === id);
        if (!rt) return;
        const steps = (rt.steps || []).map((s) => s.text).filter(Boolean);
        ws.messageBox({ title: `via ${rt.summary || 'route'}`, icon: 'info', text: steps.length ? steps.slice(0, 24).join('\n') + (steps.length > 24 ? '\n...' : '') : 'No turn list for this route.' });
    }

    // ---------------------------------------------------------------- settings

    let draft = null;

    function draftOf() {
        if (draft) return draft;
        const s = settings || {};
        draft = {
            home: (s.home && (s.home.address || (s.home.lat != null ? `${s.home.lat}, ${s.home.lon}` : ''))) || '',
            work: (s.work && (s.work.address || (s.work.lat != null ? `${s.work.lat}, ${s.work.lon}` : ''))) || '',
            area: s.area || '',
            streets: (s.streets || []).join('\n'),
            leaveHome: s.leaveHome || '',
            leaveWork: s.leaveWork || '',
            days: (s.days || [1, 2, 3, 4, 5]).slice(),
            leadMin: s.leadMin != null ? s.leadMin : 10,
            betterMin: s.betterMin || 5,
            waitMin: s.waitMin || 8,
            radiusKm: s.radiusKm || 1.5,
            notify: s.notify !== false
        };
        return draft;
    }

    const TIMES = (from, to) => {
        const out = [['', 'Off']];
        for (let m = from * 60; m <= to * 60; m += 5) {
            const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            out.push([v, hhmmLabel(v)]);
        }
        return out;
    };
    const LEADS = [[0, 'At the leave time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [20, '20 minutes before'], [30, '30 minutes before'], [45, '45 minutes before'], [60, '1 hour before']];
    const BETTER = [[3, '3 minutes'], [5, '5 minutes'], [8, '8 minutes'], [10, '10 minutes'], [15, '15 minutes']];
    const RADII = [[0.5, '0.5 km'], [1, '1 km'], [1.5, '1.5 km'], [2, '2 km'], [3, '3 km'], [5, '5 km']];
    const WAITS = [[5, '5 minutes'], [8, '8 minutes'], [10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes']];

    function renderSettings() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const box = els.layerBody;
        box.className = 'trf-layer-body wm-form trf-settings';
        if (!ui) { box.innerHTML = '<p>Settings are not available.</p>'; return; }
        const f = draftOf();
        const label = (list, v) => (list.find(([x]) => String(x) === String(v)) || list[0])[1];
        const homeTimes = TIMES(4, 12);
        const workTimes = TIMES(11, 23);
        const p = provs || { google: {}, tomtom: {} };
        const budgetLine = (name, b) => (b && b.configured ? `${name}: ${b.used} of ${b.budget} ${b.per === 'day' ? 'today' : 'this month'}` : `${name}: no key (Dreamscape CardSpace > Service keys)`);
        box.innerHTML = `
            ${ui.sub('Places')}
            ${ui.row('Home:', ui.edit('trfHome', f.home, 'placeholder="Street address" data-k="home" maxlength="200"'), { for: 'trfHome' })}
            ${ui.row('Work:', ui.edit('trfWork', f.work, 'placeholder="Street address" data-k="work" maxlength="200"'), { for: 'trfWork' })}
            ${ui.row('Radius:', ui.comboHtml('radiusKm', label(RADII, f.radiusKm)), { wide: true })}
            ${ui.note('Inside this distance of Home the phone shows the way to Work, inside it of Work the way Home.')}
            ${ui.gap()}
            ${ui.sub('Preferred route')}
            ${ui.note('Streets from Home to Work, one a line, in the order you drive them (for example Main St, then I-90 E). The way home uses them in reverse.')}
            <textarea class="wm-edit trf-streets" data-k="streets" rows="5" placeholder="Main St\nI-90 E\nOmaha St">${esc(f.streets)}</textarea>
            ${ui.gap()}
            ${ui.sub('When I leave')}
            ${ui.row('Home at:', ui.comboHtml('leaveHome', label(homeTimes, f.leaveHome)), { wide: true })}
            ${ui.row('Work at:', ui.comboHtml('leaveWork', label(workTimes, f.leaveWork)), { wide: true })}
            <div class="trf-days">${DAY_SHORT.map((n, i) => ui.check(`day${i}`, n, f.days.includes(i), `data-day="${i}"`)).join('')}</div>
            ${ui.check('notify', 'Notify me with the traffic before I leave', f.notify, 'data-k="notify"')}
            ${ui.row('Notify:', ui.comboHtml('leadMin', label(LEADS, f.leadMin), !f.notify), { wide: true })}
            ${ui.gap()}
            ${ui.sub('Advice')}
            ${ui.row('Faster route:', ui.comboHtml('betterMin', `saves ${label(BETTER, f.betterMin)}`), { wide: true })}
            ${ui.row('Wait to leave:', ui.comboHtml('waitMin', `saves ${label(WAITS, f.waitMin)}`), { wide: true })}
            ${ui.gap()}
            ${ui.sub('Data')}
            ${ui.note(budgetLine('Google Routes', p.google))}
            ${ui.note(budgetLine('TomTom incidents', p.tomtom))}
            ${ui.note('Speed cameras: OpenStreetMap (no key needed).')}`;
        box.querySelectorAll('input.wm-edit[data-k], textarea[data-k]').forEach((el) => el.addEventListener('input', () => { f[el.dataset.k] = el.value; }));
        box.querySelectorAll('input[data-day]').forEach((el) => el.addEventListener('change', () => {
            const d = Number(el.dataset.day);
            f.days = el.checked ? [...new Set(f.days.concat(d))].sort() : f.days.filter((x) => x !== d);
        }));
        const notify = box.querySelector('input[data-k="notify"]');
        notify.addEventListener('change', () => { f.notify = notify.checked; const c = box.querySelector('[data-act="leadMin"]'); if (c) c.disabled = !f.notify; });
        const combo = (act, list, key, fmt) => {
            const btn = box.querySelector(`[data-act="${act}"]`);
            ui.bindCombo(btn, fmt ? list.map(([v, l]) => [v, fmt(l)]) : list, f[key], (v) => { f[key] = v; });
        };
        combo('leaveHome', homeTimes, 'leaveHome');
        combo('leaveWork', workTimes, 'leaveWork');
        combo('leadMin', LEADS, 'leadMin');
        combo('betterMin', BETTER, 'betterMin', (l) => `saves ${l}`);
        combo('waitMin', WAITS, 'waitMin', (l) => `saves ${l}`);
        combo('radiusKm', RADII, 'radiusKm');
    }

    /** "44.08, -103.23" as coordinates, anything else an address. */
    function placeFrom(text) {
        const t = String(text || '').trim();
        if (!t) return null;
        const m = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
        if (m) return { lat: Number(m[1]), lon: Number(m[2]) };
        return { address: t };
    }

    async function saveSettings() {
        const f = draftOf();
        const home = placeFrom(f.home);
        const work = placeFrom(f.work);
        if (!home || !work) {
            await ws.messageBox({ title: TITLE, icon: 'warning', text: 'Enter both a Home and a Work address.' });
            return;
        }
        const payload = {
            home, work,
            area: f.area,
            streets: String(f.streets || '').split('\n').map((s) => s.trim()).filter(Boolean),
            leaveHome: f.leaveHome, leaveWork: f.leaveWork, days: f.days,
            leadMin: Number(f.leadMin), betterMin: Number(f.betterMin), waitMin: Number(f.waitMin), radiusKm: Number(f.radiusKm), notify: !!f.notify,
            timeZone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } })()
        };
        try {
            const d = await ws.busy(ask('traffic_settings_save', { settings: payload }), { delay: 200, timeout: 20000 });
            settings = d.settings || settings;
            latest = { work: null, home: null };
            advice = { work: null, home: null };
            draft = null;
            layers = layers.filter((l) => l !== 'settings');
            syncLayers();
            changed();
            quietCheck(direction());
        } catch (err) {
            ws.messageBox({ title: TITLE, icon: 'error', text: `The settings could not be saved.\n\n${(err && err.message) || ''}`.trim() });
        }
    }

    // ---------------------------------------------------------------- notifications

    const noted = new Set();
    function onReport(pk) {
        const d = (pk && (pk.data || pk)) || {};
        if (!canUse()) return;
        const key = `${d.kind}:${d.direction}:${(d.report && d.report.at) || d.error || ''}`;
        if (noted.has(key)) return;
        noted.add(key);
        if (d.report) latest[d.direction] = d.report;
        if (d.advice && !d.advice.error) advice[d.direction] = d.advice;
        changed();
        const label = d.direction === 'work' ? 'To Work' : 'To Home';
        let title;
        let text;
        if (d.error) {
            title = `Traffic: ${label}`;
            text = `Traffic could not be checked: ${d.error}`;
        } else if (d.kind === 'go') {
            title = `Time to leave: ${label}`;
            text = `${minText(d.report.preferred.durationSec)} via ${d.report.preferred.summary || 'your route'} now.${d.report.better ? ` Faster: via ${d.report.better.summary} saves ${minText(d.report.better.savesSec)}.` : ''}`;
        } else {
            title = `Traffic: ${label}`;
            text = d.report.summary || '';
            if (d.advice && d.advice.wait) text += ` ${d.advice.summary}`;
        }
        const view = () => { if (note && note.close) note.close(); open(d.direction); if (d.advice && d.advice.wait) openLayer('advisor'); };
        let note = null;
        if (ws && typeof ws.appNote === 'function') {
            note = ws.appNote({
                title,
                html: esc(text),
                icon: 'app-traffic',
                event: 'notification',
                softKeys: () => ({
                    left: { label: 'View', action: view },
                    right: { label: 'Dismiss', action: () => { if (note) note.close(); } }
                })
            });
            if (note) return;
        }
        if (ws && typeof ws.notify === 'function') {
            ws.notify({ title, text, icon: d.error ? 'warning' : 'info', asNote: true, timeout: false, buttons: [{ text: 'View', type: 'primary', closeOnClick: true, onClick: view }] });
        }
    }

    let wired = false;
    function wire() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        const data = (pk) => (pk && (pk.data || pk)) || {};
        c.on('traffic_updated', (pk) => { const d = data(pk); if (d.direction && d.report) { latest[d.direction] = d.report; changed(); if (d.direction === 'home') armNativeWatch(); } });
        c.on('traffic_report', onReport);
        c.on('traffic_settings_changed', (pk) => { const d = data(pk); if (d.settings) { settings = d.settings; changed(); } });
        c.on('connected', () => load());
        load();
        return true;
    }

    // ---------------------------------------------------------------- menus

    function about() {
        const p = provs || { google: {}, tomtom: {} };
        const line = (n, b) => (b && b.configured ? `${n}: ${b.left} of ${b.budget} requests left ${b.per === 'day' ? 'today' : 'this month'}` : `${n}: not set up`);
        ws.messageBox({
            title: TITLE,
            icon: 'info',
            text: `Melaton Traffic\nVersion 1.0\n\nCopyright © 2026 Xyridian Corporation. All rights reserved.\n\nRoutes and traffic: Google. Incidents: TomTom. Speed cameras: © OpenStreetMap contributors.\n${line('Google Routes', p.google)}\n${line('TomTom', p.tomtom)}`
        });
    }

    function mainMenu() {
        const d = direction();
        const ok = configured();
        return [
            { label: 'To Work', radio: d === 'work', action: () => setDirection('work') },
            { label: 'To Home', radio: d === 'home', action: () => setDirection('home') },
            '-',
            { label: 'Routes', disabled: !ok, action: () => openLayer('routes') },
            { label: 'Speed Traps on Route', disabled: !ok, action: () => openLayer('traps') },
            { label: 'Alerts', disabled: !ok, action: () => openLayer('alerts') },
            { label: 'Slowdowns', disabled: !ok, action: () => openLayer('slow') },
            { label: d === 'home' ? 'When to Leave' : 'Leave Advisor', disabled: !ok, action: () => openLayer('advisor') },
            '-',
            { label: 'Settings...', disabled: !isAdmin(), action: () => openLayer('settings') },
            { label: 'About', action: about }
        ];
    }

    // ---------------------------------------------------------------- app

    function open(dir) {
        if (dir === 'work' || dir === 'home') dirPicked = dir;
        if (ws) ws.open(APP_ID);
        if (shown) render();
    }

    const APP = {
        id: APP_ID,
        title: TITLE,
        icon: 'app-traffic',
        // the 6.5 Start screen's own icon (wm65/start-traffic, 45 / 90 / 180 px)
        art65: 'traffic',
        inStart: 'programs',
        sip: true,
        mount(p) {
            page = p;
            p.classList.add('wm-traffic');
            build();
        },
        show() {
            shown = true;
            readPosition();
            syncLayers();
            render();
            if (!loaded) {
                ws.busy(load(), { delay: 250, timeout: 20000 }).then(() => {
                    const r = latest[direction()];
                    if (configured() && (!r || Date.now() - Date.parse(r.at) > STALE_MS)) quietCheck(direction());
                }).catch(() => {});
                return;
            }
            const r = latest[direction()];
            if (configured() && (!r || Date.now() - Date.parse(r.at) > STALE_MS)) quietCheck(direction());
        },
        // a direction picked in the app lasts for the visit; next time the phone's place decides again
        hide() { shown = false; dirPicked = null; },
        historyDepth: () => layers.length,
        onBack: () => popLayer(),
        titleKind: () => (layers.length ? 'ok' : 'close'),
        onTitleOk: () => { if (layers[layers.length - 1] === 'settings') saveSettings(); else popLayer(); },
        onTitleClose() { layers = []; },
        softKeys() {
            const top = layers[layers.length - 1];
            if (top === 'settings') return { left: { label: 'Save', action: saveSettings }, right: { label: 'Cancel', action: () => { draft = null; popLayer(); } } };
            if (top === 'advisor') return { left: { label: 'Refresh', action: () => ensureAdvice(true) }, right: { label: 'Done', action: popLayer } };
            if (top) return { left: { label: 'Done', action: popLayer }, right: { label: 'Refresh', action: userRefresh } };
            return { left: { label: 'Refresh', disabled: !canUse(), action: userRefresh }, right: { label: 'Menu', menu: mainMenu } };
        }
    };

    // ---------------------------------------------------------------- Today (6.1 row, 6.5 panel)

    /** Leaving now: the clock time it gets there (from a report under 45 minutes old). */
    function arriveText(r) {
        if (!r || !r.preferred || r.preferred.durationSec == null || Date.now() - Date.parse(r.at) > 45 * 60 * 1000) return '';
        return `arrive ${clock(Date.now() + r.preferred.durationSec * 1000)}`;
    }

    function todayLine(d) {
        const r = latest[d];
        const label = d === 'work' ? 'To Work' : 'To Home';
        if (!r || !r.preferred) return { title: `${label}: no report`, sub: configured() ? 'Tap to check the traffic' : 'Tap to set up your commute', level: 'none' };
        const p = r.preferred;
        const dv = driving();
        if (dv && dv.direction === d) {
            // on the way: what is left from here, from the report already on the phone
            return { title: `${label}: ${minText(dv.leftSec)} left`, sub: [`Arrive ${clock(dv.arriveAt)}`, `${miles(dv.toGoM)} to go`, r.traps && r.traps.filter((t) => t.at > dv.at).length ? `${r.traps.filter((t) => t.at > dv.at).length} camera${r.traps.filter((t) => t.at > dv.at).length > 1 ? 's' : ''} ahead` : ''].filter(Boolean).join(', '), level: r.level };
        }
        const delay = r.delaySec >= 60 ? ` (+${mins(r.delaySec)})` : '';
        const bits = [];
        const arrive = arriveText(r);
        if (arrive) bits.push(arrive.charAt(0).toUpperCase() + arrive.slice(1));
        if (r.better) bits.push(`Faster via ${r.better.summary}`);
        else if (advice[d] && advice[d].wait) bits.push(`Wait ${advice[d].wait.offsetMin} min`);
        else if (p.summary) bits.push(`via ${p.summary}`);
        if (r.traps && r.traps.length) bits.push(`${r.traps.length} camera${r.traps.length > 1 ? 's' : ''}`);
        const old = Date.now() - Date.parse(r.at) > 30 * 60 * 1000;
        if (old) bits.push(`at ${clock(r.at)}`);
        return { title: `${label}: ${minText(p.durationSec)}${delay}`, sub: bits.join(', '), level: old ? 'none' : r.level };
    }

    let todayHtml = '';
    let todayCheckAt = 0;

    /**
     * Near a set leave time on a set day: { direction, leaveAt } (leaving Home = To Work, leaving Work =
     * To Home), else null. From 30 min before (or the Notify lead, when that is longer, so the car is up
     * when the leave-time report arrives) to 30 min after Leave Home, and to 2 h 30 min after Leave Work
     * (from the Leave Advisor's "wait" time when that is later). Phone time (the leave times are the user's own clock).
     */
    function leaveWindow(now = new Date()) {
        const s = settings || {};
        if (!Array.isArray(s.days) || !s.days.includes(now.getDay())) return null;
        const t = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        const before = Math.max(LEAVE_WINDOW_MIN, Number(s.leadMin) || 0);
        for (const [key, dir] of [['leaveHome', 'work'], ['leaveWork', 'home']]) {
            const m = minutesOf(s[key]);
            if (m == null) continue;
            // minutes from the leave time, across midnight (a 00:10 leave time is near at 23:50)
            const off = ((t - m + 720) % 1440 + 1440) % 1440 - 720;
            // the way home: 2 h 30 min past Leave Work, or past the Leave Advisor's later time (#809)
            const after = dir === 'home' ? HOME_AFTER_MIN + adviceLaterMin(now, m) : LEAVE_WINDOW_MIN;
            if (off >= -before && off <= after) {
                const at = new Date(now);
                at.setHours(Math.floor(m / 60), m % 60, 0, 0);
                return { direction: dir, leaveAt: at.getTime() };
            }
        }
        return null;
    }

    /**
     * The title bar's car (wmShell role 'traffic'): shown only in a leave window (leaveWindow, that commute)
     * or while driving the commute. A 15+ min delay then says so in the bubble; on its own, away from a
     * leave time (at Work at noon), it never puts the car up (#807). { delayed (= show), reason, lines }.
     */
    function statusState() {
        if (!canUse() || !loaded || !configured()) return null;
        const dv = driving();
        const win = leaveWindow();
        const d = dv ? dv.direction : (win ? win.direction : direction());
        const r = latest[d];
        if (dv && r && r.preferred) {
            // driving it: the time left from here, no request (the car shows for the whole drive)
            const ahead = (r.alerts || []).filter((a) => a.at > dv.at && a.major);
            const lines = [`${d === 'work' ? 'To Work' : 'To Home'}: ${minText(dv.leftSec)} left, ${miles(dv.toGoM)} to go`, `Arrive ${clock(dv.arriveAt)}.`];
            if (ahead.length) lines.push(`Ahead: ${ahead[0].label}${ahead[0].street ? ` on ${ahead[0].street}` : ''}.`);
            return { delayed: true, reason: 'driving', direction: d, title: 'Traffic', lines };
        }
        // in the window the car needs a current report: one check (at most every 15 min; the server caches)
        if (win && !document.hidden && Date.now() - todayCheckAt > TODAY_CHECK_MS && (!r || Date.now() - Date.parse(r.at) > TODAY_CHECK_MS)) {
            todayCheckAt = Date.now();
            quietCheck(d);
        }
        const leaveLine = win ? `Leave ${d === 'work' ? 'Home' : 'Work'} at ${clock(win.leaveAt)}.` : '';
        if (!r || !r.preferred) return { delayed: !!win, reason: win ? 'leave' : '', direction: d, title: 'Traffic', lines: [leaveLine || 'No commute report.', ...(win ? ['Checking the traffic...'] : [])].filter(Boolean) };
        const fresh = Date.now() - Date.parse(r.at) < 45 * 60 * 1000;
        const p = r.preferred;
        const lines = [`${d === 'work' ? 'To Work' : 'To Home'}: ${minText(p.durationSec)}${r.delaySec >= 60 ? `, ${minText(r.delaySec)} late` : ''}`];
        const arrive = arriveText(r);
        if (arrive) lines.push(`Leave now and ${arrive}.`);
        if (r.better) lines.push(`Faster: via ${r.better.summary}, saves ${minText(r.better.savesSec)}.`);
        const majors = (r.alerts || []).filter((a) => a.major);
        if (majors.length) lines.push(`${majors[0].label}${majors[0].street ? ` on ${majors[0].street}` : ''}.`);
        if (!fresh) lines.push(`Checked at ${clock(r.at)}.`);
        if (leaveLine) lines.unshift(leaveLine);
        const late = fresh && (r.delaySec || 0) >= DELAY_STATUS_SEC;
        return { delayed: !!win, reason: win ? (late ? 'delay' : 'leave') : '', direction: d, title: 'Traffic', lines };
    }
    function todayRender(el) {
        if (!canUse()) return false;
        if (!loaded) { if (!wired) wire(); return false; }
        if (!configured() && !isAdmin()) return false;
        readPosition();
        const d = direction();
        // Today on screen with an old report: one fresh check (at most every 15 min; the server caches too),
        // never while driving the route (the time left comes from the report already here)
        const r0 = latest[d];
        if (configured() && !driving() && !document.hidden && Date.now() - todayCheckAt > TODAY_CHECK_MS && (!r0 || Date.now() - Date.parse(r0.at) > TODAY_CHECK_MS)) {
            todayCheckAt = Date.now();
            quietCheck(d);
        }
        const t = todayLine(d);
        if (!el.dataset.trfBound) {
            el.dataset.trfBound = '1';
            el.classList.add('wtw', 'trf-today');
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
            el.addEventListener('click', () => open(direction()));
        }
        const html = `<span class="trf-today-sig" data-level="${t.level}"><i></i><i></i><i></i></span><span class="wtw-lines"><span class="wtw-title">${esc(t.title)}</span><span class="wtw-sub">${esc(t.sub)}</span></span>`;
        if (html !== todayHtml || !el.firstChild) { todayHtml = html; el.innerHTML = html; }
        return true;
    }

    function todayTitanium() {
        if (!canUse() || !loaded) return null;
        const go = () => open(direction());
        const first = direction();
        const pages = [first, first === 'work' ? 'home' : 'work'].map((d) => {
            const t = todayLine(d);
            const r = latest[d];
            return { title: t.title, line2: t.sub, line3: r && r.alerts && r.alerts.length ? `${r.alerts.length} alert${r.alerts.length > 1 ? 's' : ''} on route` : '' };
        });
        return { label: 'traffic', icon: 'x:app-traffic-lg', pages, softKey: { label: 'Traffic', action: go }, onTap: go };
    }

    // ---------------------------------------------------------------- register

    let windowKey = '';
    function watchLeaveWindow() {
        setInterval(() => {
            if (!loaded || document.hidden) return;
            const w = leaveWindow();
            const key = w ? `${w.direction}:${w.leaveAt}` : '';
            if (key !== windowKey) { windowKey = key; if (ws && typeof ws.refreshStatus === 'function') ws.refreshStatus(); if (ws && ws.refreshToday) ws.refreshToday(); }
            // a report going stale (30 min) or the commute switching direction darkens / moves the icon's lamp
            syncIcon();
            // driving: the phone's position each minute, then the time left everywhere it shows
            if (driveWindow()) { readPosition(); if (driving()) changed(); }
            armNativeWatch();
            watchCameras();
        }, 60 * 1000);
    }

    function register() {
        ws = window.wmShell;
        if (!ws) return;
        // the app's drive watch: what it alerted while the page was paused (#810)
        window.addEventListener('dreamscape:drivewatch', (e) => nativeStatus(e.detail));
        watchLeaveWindow();
        ws.registerApp(APP);
        if (typeof ws.registerTodayItem === 'function') {
            ws.registerTodayItem({ id: 'traffic', label: 'Traffic', icon: 'app-traffic', after: 'weather', render: todayRender, titanium: todayTitanium });
        }
        if (!wire()) { let n = 0; const t = setInterval(() => { if (wire() || ++n > 120) clearInterval(t); }, 1000); }
    }

    window.wmTraffic = {
        open,
        latest: () => latest,
        direction,
        statusState,
        /** Driving the commute: { direction, leftSec, arriveAt, toGoM, at } or null. */
        driving: () => driving(),
        /** Read the phone's position now (Refresh does too). */
        locate: () => readPosition(true),
        refresh: () => check(direction(), false),
        /** Read the settings and last reports again (traffic_get). */
        reload: () => load(),
        _onReport: onReport
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
