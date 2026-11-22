/**
 * Melaton Mobile: Lapis Remote (Yozora #835). Yukimi, Nov 14 2026: "a polished 2010-era luxury car
 * remote control and status viewer", a front end for Hyundai BlueLink: remote start with a climate
 * setting chosen from the weather, status, maintenance, forgot-to-lock and low-fuel notices, the day
 * to refuel by, the car on a map, and controls on Today (6.1 and 6.5; half of Traffic's Traffic and Car item since #1041).
 *
 * Our own design, the theme she chose: "Platinum Console" hardware (brushed aluminium, chrome-trimmed
 * piano-black keys with amber LEDs, a knurled temperature knob, a round ENGINE START STOP button, a
 * stitched cream leather pad) around one inset display styled after the car's ccNC screens.
 *
 * Data: the server's car service (modules/lapisService.js, 293-lapisHandler.js). The server reads the
 * car, keeps the record and raises the notices; this app never polls. lapis_get reads what the server
 * holds, lapis_updated pushes every change (a command's progress too), lapis_notice is a WM
 * notification. Refresh (lapis_refresh) wakes the car for a fresh report.
 *
 * window.wmLapis: open(layer?), state(), reload().
 * Art: public/static_images/wm61/app-lapis*, wm65 start-lapis and ti-x panel, static_images/lapis/car*
 * (scripts/generate-wm-lapis-art.js). Styles: public/css/wm-lapis.css. Phones only. Admin (and
 * dev_admin test tabs) only; commands and settings are the administrator's.
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const MOBILE = window.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');
    if (!MOBILE) return;

    const APP_ID = 'lapis';
    const TITLE = 'Lapis Remote';
    const CAR_ART = '/static_images/lapis/car.webp';
    const CAR_ART_SM = '/static_images/lapis/car-sm.webp';
    const LAYER_TITLES = { start: 'Remote Start', map: 'Find My Car', status: 'Vehicle Status', service: 'Maintenance', item: 'Maintenance Item', history: 'Driving Record', settings: 'Lapis Settings' };
    const TILE = 256;
    // hold ENGINE START STOP this long to start (css .lps-go-fill matches). The car button's own safety
    // hold on purpose, not the shell's tap-and-hold menu, so it does not follow wmShell.holdMs
    const HOLD_MS = 600;
    const SEAT_HEAT = [0, 6, 7, 8];
    const SEAT_COOL = [0, 3, 4, 5];
    const WHEEL = [0, 3, 4];
    const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let ws = null;
    let page = null;
    let els = null;
    let shown = false;
    let stale = true; // the page was not drawn since the last change (hidden screens never draw)
    let layers = [];
    let state = null;
    let loaded = false;
    let loadFailed = '';
    let wired = false;
    let picture = { rev: '', url: '' }; // the saved car picture (data URL), when one is set
    let draft = null; // remote start settings being edited
    let form = null; // settings being edited
    let item = null; // the maintenance item being edited ({ isNew, ...fields as text })
    let history = null;
    let historyRange = 'month';
    let map = null;
    let holdTimer = null;
    let runNote = null; // the remote start's "n minutes left" note (one at a time)
    let heroMap = null; // the map shown in place of the car picture
    const LS_VIEW = 'wmLapisHeroView'; // 'car' | 'map'
    let heroView = (() => { try { return localStorage.getItem(LS_VIEW) === 'map' ? 'map' : 'car'; } catch (_) { return 'car'; } })();

    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const canUse = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };
    const client = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    /** The 12 V battery is under the level the car itself warns at (50% when the car does not say). */
    const battLow = (s) => !!(s && num(s.battery12) && s.battery12 < (num(s.battery12WarnAt) ? s.battery12WarnAt : 50));

    // ---------------------------------------------------------------- formatting

    const fmtClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const fmtShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const clock = (t) => (num(t) ? fmtClock.format(new Date(t)) : '');
    const miles = (v) => (num(v) ? `${Math.round(v).toLocaleString()} mi` : '--');
    const when = (t) => {
        if (!num(t)) return '';
        const d = new Date(t);
        const today = new Date();
        return d.toDateString() === today.toDateString() ? clock(t) : `${fmtShort.format(d)}, ${clock(t)}`;
    };
    const sinceText = (t) => {
        if (!num(t)) return '';
        const m = Math.max(0, Math.round((Date.now() - t) / 60000));
        if (m < 60) return `${m} min`;
        const h = Math.floor(m / 60);
        return h < 48 ? `${h} hr ${m % 60} min` : `${Math.floor(h / 24)} days`;
    };
    /** 'YYYY-MM-DD' as "Tue, Nov 17" (or Today / Tomorrow). */
    function dayLabel(key, todayKey) {
        if (!key) return '';
        const [y, m, d] = key.split('-').map(Number);
        const diff = todayKey ? Math.round((Date.UTC(y, m - 1, d) - Date.parse(todayKey)) / 86400000) : null;
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        return fmtDay.format(new Date(y, m - 1, d));
    }
    const tempText = (t, lim) => (!num(t) ? '--' : lim && t <= lim.tempMin ? 'LO' : lim && t >= lim.tempMax ? 'HI' : String(Math.round(t)));
    // ---------------------------------------------------------------- LED temperatures (seven segments)

    // segments in a 12 x 20 cell: a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle
    const hSeg = (y) => `2.4,${y} 3.4,${y - 1} 8.6,${y - 1} 9.6,${y} 8.6,${y + 1} 3.4,${y + 1}`;
    const vSeg = (x, y0, y1) => `${x},${y0 + 0.9} ${x + 1},${y0 + 1.9} ${x + 1},${y1 - 1.9} ${x},${y1 - 0.9} ${x - 1},${y1 - 1.9} ${x - 1},${y0 + 1.9}`;
    const SEGS = { a: hSeg(1.6), g: hSeg(10), d: hSeg(18.4), f: vSeg(1.6, 1.6, 10), b: vSeg(10.4, 1.6, 10), e: vSeg(1.6, 10, 18.4), c: vSeg(10.4, 10, 18.4) };
    const GLYPH = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', L: 'fed', O: 'abcdef', H: 'bcefg', I: 'bc', ' ': '' };
    const ledDigit = (ch) => {
        const on = GLYPH[ch] == null ? '' : GLYPH[ch];
        return `<svg viewBox="0 0 13 20" aria-hidden="true"><g transform="translate(1.2 0) skewX(-6)">${Object.keys(SEGS).map((k) => `<polygon class="${on.includes(k) ? 'is-on' : 'is-off'}" points="${SEGS[k]}"/>`).join('')}</g></svg>`;
    };
    /** "77" / "LO" / "--" as lit seven-segment digits (unlit segments faintly visible, like the real thing). */
    const led = (text) => {
        const t = String(text == null ? '--' : text).toUpperCase();
        return `<span class="lps-led7" role="img" aria-label="${esc(t)}">${[...t].map(ledDigit).join('')}</span>`;
    };

    const seatText = (c) => ({ 3: 'cool, low', 4: 'cool, medium', 5: 'cool, high', 6: 'heat, low', 7: 'heat, medium', 8: 'heat, high' }[c] || 'off');

    // ---------------------------------------------------------------- art (inline, our own thin-line set)

    const L = (d, w = 1.3) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const I = {
        lock: L('<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
        unlock: L('<rect x="3.5" y="9" width="11" height="8" rx="1.5"/><path d="M11.5 9V6.5a3 3 0 0 1 5.9-.8"/>'),
        find: L('<path d="M10 17.5s5.5-5.200 5.500-9.500a5.500 5.500 0 0 0-11 0c0 4.300 5.500 9.500 5.500 9.500z"/><circle cx="10" cy="8" r="2"/>'),
        fuel: L('<rect x="4" y="3.5" width="7" height="13" rx="1"/><path d="M5.800 6h3.400v3H5.800zM11 9.500h1.300a1 1 0 0 1 1 1v3.700a1.200 1.200 0 0 0 2.400 0V8l-2.200-2.200"/>'),
        fan: L('<circle cx="10" cy="10" r="1.5"/><path d="M10 8.500c-1-3 .2-5.500 2.500-5.500 1.800 0 2 3-2.500 5.500zM11.500 10c3-1 5.500.2 5.500 2.500 0 1.800-3 2-5.500-2.500zM10 11.500c1 3-.2 5.500-2.500 5.500-1.800 0-2-3 2.500-5.500zM8.500 10c-3 1-5.500-.2-5.500-2.500 0-1.800 3-2 5.500 2.500z"/>'),
        power: L('<path d="M10 3v6.500M5.600 5.800a6.300 6.300 0 1 0 8.800 0"/>'),
        door: L('<path d="M5 17V7.500L9.500 3H15v14zM5.500 9.500H15M12 12h1.500"/>'),
        win: L('<path d="M3.500 14.500 9 5h7.500v9.500zM3.500 14.500h13"/>'),
        trunk: L('<path d="M2.500 13.500h15M4 13.500V11l3-1.500 2-3.500h5l2.500 4 .5 1v2.500"/><circle cx="6.500" cy="14" r="1.500"/><circle cx="14" cy="14" r="1.500"/>'),
        tire: L('<path d="M4.500 15.500C3 11 3.500 7 5.500 4h9c2 3 2.500 7 1 11.500zM6 17.500h8M10 7v4.500"/><circle cx="10" cy="13.800" r=".4"/>'),
        batt: L('<rect x="3" y="6.500" width="14" height="9" rx="1"/><path d="M6 6.500V5M14 6.500V5M5.500 10.500h3M12 10.500h2.500M13.250 9.200v2.600"/>'),
        defrost: L('<path d="M3.500 6.500c4-2 9-2 13 0l-1.500 8h-10zM7.500 16.500c-1-1.500 1-2.500 0-4M10 16.500c-1-1.500 1-2.500 0-4M12.500 16.500c-1-1.500 1-2.500 0-4"/>'),
        seat: L('<path d="M7 3.500c-1.500 3-1 6 0 9h6.500a1.500 1.500 0 0 1 0 3H6.500c-2 0-2.500-1-3-3M10.500 4.500c-1 1.500 1 2.500 0 4M13.500 4.500c-1 1.500 1 2.500 0 4"/>'),
        seatCool: L('<path d="M7 3.500c-1.500 3-1 6 0 9h6.500a1.500 1.500 0 0 1 0 3H6.500c-2 0-2.500-1-3-3M12 3.500v5M9.800 4.700l4.400 2.600M14.200 4.700 9.800 7.300"/>'),
        wheel: L('<circle cx="10" cy="10" r="6.500"/><circle cx="10" cy="10" r="1.500"/><path d="M3.700 9h4.800M11.500 9h4.800M10 11.500v5"/>'),
        car: L('<path d="M2.500 13.500h15M4 13.500V11l1.500-.700 1.800-3.800h5.400l1.800 3.800 1.500.700v2.500M6.200 10.300h7.600"/><circle cx="6.500" cy="14" r="1.500"/><circle cx="13.500" cy="14" r="1.500"/>'),
        wrench: L('<path d="M12.500 3a4 4 0 0 0-3.700 5.500L3 14.300 5.700 17l5.800-5.800A4 4 0 0 0 17 7.500l-2.500 2.500-2-.5-.5-2z"/>'),
        hood: L('<path d="M2.500 14h15M3.500 14c0-3 2-5 6.500-5s6.500 2 6.500 5M6 9.500 9 5h5"/>'),
        drop: L('<path d="M10 3c3 4 4.500 6.300 4.500 8.500a4.500 4.500 0 0 1-9 0C5.500 9.300 7 7 10 3z"/>'),
        key: L('<circle cx="6.500" cy="10" r="3"/><path d="M9.500 10H17M14 10v2.500M16.500 10v2"/>'),
        road: L('<path d="M6 17 8 3M14 17 12 3M10 4v2M10 9v2M10 14v2"/>'),
        clock: L('<circle cx="10" cy="10" r="6.500"/><path d="M10 6v4l2.500 2"/>'),
        warn: L('<path d="M10 3 18 16.500H2zM10 8v4.500"/><circle cx="10" cy="14.500" r=".4"/>', 1.5),
        arrow: '<svg class="lps-arrow" viewBox="0 0 44 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M1 5h41M38 1.500 42 5l-4 3.500"/></svg>',
        pin: '<svg viewBox="0 0 22 28" aria-hidden="true"><path d="M11 27S1.500 17 1.500 10.500a9.500 9.500 0 0 1 19 0C20.500 17 11 27 11 27z" fill="#00aad2" stroke="#fff" stroke-width="1.5"/><path d="M5.500 12.500h11M6.500 12.500l1.200-3.500h6.600l1.200 3.500M6 12.500v2M16 12.500v2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    // ---------------------------------------------------------------- server

    async function ask(type, payload, ms = 25000) {
        const c = client();
        if (!c) throw new Error('Not connected');
        const r = await Promise.race([
            c.sendMessage(type, payload || {}, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('The server did not answer in time')), ms))
        ]);
        return r && r.data && typeof r.data === 'object' ? r.data : r;
    }

    function take(next) {
        if (!next) return;
        state = next;
        loaded = true;
        loadFailed = '';
        const rev = (state.settings && state.settings.picture && state.settings.picture.rev) || '';
        if (rev !== picture.rev) loadPicture(rev);
        changed();
        if (runNote && !runInfo()) { try { runNote.close(); } catch (_) { /* gone */ } runNote = null; }
    }

    async function load() {
        if (!canUse() || !client()) return;
        try {
            const d = await ask('lapis_get', {});
            take(d.state);
        } catch (err) {
            loadFailed = (err && err.message) || 'The car could not be loaded';
            changed();
        }
    }

    async function loadPicture(rev) {
        picture = { rev, url: '' };
        if (!rev) { changed(); return; }
        try {
            const d = await ask('lapis_picture_get', {});
            if (d && d.dataUrl && picture.rev === rev) { picture.url = d.dataUrl; changed(); }
        } catch (_) { /* the built-in picture stays */ }
    }

    // the alerts notifications this phone has already shown, as key:stamp. A missed one comes back through the notification
    // inbox (lapis:health:alerts, combined, switched items and the quiet after a drive applied on the server); this page no
    // longer raises one note per alert from the state it loads (Yukimi, Nov 21 2026, #1008: multiple issues were multiple notifications)
    const LS_SEEN = 'wmLapisAlertsSeen';
    function seenAlerts() { try { const a = JSON.parse(localStorage.getItem(LS_SEEN) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
    function markSeen(id) { try { const a = seenAlerts().filter((x) => x !== id); a.push(id); localStorage.setItem(LS_SEEN, JSON.stringify(a.slice(-30))); } catch (_) { /* private mode */ } }

    const carSrc = (small) => picture.url || (small ? CAR_ART_SM : CAR_ART);

    /**
     * Only the car's Today item drawn again (#890: not the whole of Today); an older shell draws it all. The car is
     * half of Traffic's item 'traffic' (#1041: one Today item for the commute and the car, wmTraffic.js).
     */
    function todayChanged() {
        if (!ws) return;
        if (typeof ws.refreshTodayItem === 'function') ws.refreshTodayItem('traffic');
        else if (typeof ws.refreshToday === 'function') ws.refreshToday();
    }

    function changed() {
        if (shown) render(); else stale = true;
        todayChanged();
        document.dispatchEvent(new CustomEvent('wmLapisChange'));
        tick();
    }

    // ---------------------------------------------------------------- what the status says

    const st = () => (state && state.status) || null;
    const configured = () => !!(state && state.configured);
    const busyCommand = () => (state && state.command && state.command.state === 'sent' ? state.command : null);

    function openList(s) {
        if (!s) return { doors: [], windows: [] };
        const names = { fl: 'driver', fr: 'passenger', rl: 'rear left', rr: 'rear right' };
        const pick = (o) => Object.keys(names).filter((k) => o && o[k] === true).map((k) => names[k]);
        return { doors: pick(s.doors), windows: pick(s.windows) };
    }

    /** The title bar's text: the car's name (Settings > Name, else its BlueLink name), else the program's. */
    const LS_NAME = 'wmLapisCarName';
    function carTitle() {
        const name = state && state.vehicle && state.vehicle.name;
        try { if (name) { if (localStorage.getItem(LS_NAME) !== name) localStorage.setItem(LS_NAME, name); return name; } return localStorage.getItem(LS_NAME) || TITLE; } catch (_) { return name || TITLE; }
    }
    /** "SONATA HYBRID" 2024 as "2024 Sonata Hybrid". */
    function modelText(v) {
        if (!v || !v.model) return '';
        const name = String(v.model).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
        return `${v.year ? `${v.year} ` : ''}${name}`;
    }

    function parkLine() {
        const s = st();
        if (!s) return { dot: 'warn', head: configured() ? 'No report yet' : 'Not set up', tail: '' };
        const cmd = busyCommand();
        if (cmd) return { dot: 'busy', head: { lock: 'Locking', unlock: 'Unlocking', start: 'Starting', stop: 'Stopping' }[cmd.kind] || 'Sending', tail: 'waiting for the car' };
        const place = state.location && state.location.place;
        if (s.engine) return { dot: 'run', head: runInfo() ? 'Running' : engineOnHead(s), tail: place ? `at ${place}` : '' };
        if ((state.alerts || []).length) return { dot: 'warn', head: 'Parked', tail: `${state.alerts.length === 1 ? state.alerts[0].title : `${state.alerts.length} alerts`}` };
        return { dot: 'ok', head: 'Parked', tail: place ? `at ${place}` : state.parkedSince ? `for ${sinceText(state.parkedSince)}` : '' };
    }

    /** When to get fuel: "Mon before work", "Today after work", "Sat" ("Not for weeks" when far off). */
    function refuelText(short) {
        const u = state && state.usage;
        const r = u && u.refuel;
        if (!r) return '';
        if (r.beyond || !r.stop) return 'Not for weeks';
        const [y, m, d] = r.stop.day.split('-').map(Number);
        const diff = Math.round((Date.UTC(y, m - 1, d) - Date.parse(u.today)) / 86400000);
        const wd = DAY_SHORT[new Date(y, m - 1, d).getDay()];
        const day = diff === 0 ? 'Today' : diff === 1 && !short ? `Tomorrow (${wd})` : diff < 7 ? wd : fmtShort.format(new Date(y, m - 1, d));
        const part = r.stop.part === 'before-work' ? ' before work' : r.stop.part === 'after-work' ? ' after work' : '';
        return `${day}${part}`;
    }

    /** Why then: the drive that would take the tank under the reserve. */
    function refuelWhy() {
        const u = state && state.usage;
        const r = u && u.refuel;
        if (!r || r.beyond || !r.crosses) return '';
        const [y, m, d] = r.crosses.day.split('-').map(Number);
        const day = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(y, m - 1, d));
        const drive = r.crosses.part === 'before-work' ? `${day}'s drive to work` : r.crosses.part === 'after-work' ? `${day}'s drive home` : `${day}'s driving`;
        return `${r.milesLeft} miles are left above the ${r.reservePct}% reserve. ${drive} (${r.crosses.miles} miles) needs more than the ${r.crosses.left} left by then.`;
    }

    const tireAlert = () => !!(state && (state.alerts || []).some((a) => a.key === 'tire')) || !!(st() && st().tireLow && st().tireLow.any);

    function nextService() {
        const list = (state && state.maintenance) || [];
        const withMiles = list.filter((m) => m.milesLeft !== null);
        if (!withMiles.length) return null;
        return withMiles.slice().sort((a, b) => a.milesLeft - b.milesLeft)[0];
    }

    /** The extras a remote start would switch on now: "seat heat low, wheel, defrost". */
    function startSets(c) {
        if (!c) return '--';
        const bits = [];
        if (c.seat >= 6) bits.push(`seat heat ${['low', 'med', 'high'][c.seat - 6]}`);
        else if (c.seat >= 3) bits.push(`seat cool ${['low', 'med', 'high'][c.seat - 3]}`);
        if (c.heating === 4) bits.push('wheel + glass');
        else if (c.heating === 3) bits.push('wheel');
        if (c.defrost) bits.push('defrost');
        return bits.length ? bits.join(', ') : 'climate only';
    }

    function climateLine() {
        const c = state && state.climate;
        if (!c) return '';
        const lim = state.limits;
        const bits = [`${tempText(c.temp, lim)}${/^\d/.test(tempText(c.temp, lim)) ? '°F' : ''}`];
        if (c.seat) bits.push(`seat ${c.seat >= 6 ? 'heat' : 'cool'}`);
        if (c.defrost) bits.push('defrost');
        return bits.join(', ');
    }

    // ---------------------------------------------------------------- a remote start in progress

    /** The running remote start: { until, total (ms), detail } or null. */
    /**
     * The engine on with no remote start running (the car driven with its key, or a run the server ended because it
     * moved): "Driving" when the run ended that way, else "Engine on"; null when the engine is off or a remote start runs.
     * Today showed "Running", "Runs 10 minutes" and a Stop key for a car being driven (Nov 18).
     */
    function engineOnHead(s) {
        if (!s || !s.engine || runInfo()) return null;
        const c = state && state.command;
        return c && c.kind === 'start' && c.ended === 'driving' ? 'Driving' : 'Engine on';
    }

    function runInfo() {
        // only a remote start running on its timer: the car simply running (driven) is not one, and the
        // server ends the timer when it sees the car move or the engine go off
        const c = state && state.command;
        if (c && c.kind === 'start' && c.state === 'success' && num(c.runsUntil) && c.runsUntil > Date.now()) {
            const total = ((c.detail && c.detail.minutes) || 10) * 60000;
            return { until: c.runsUntil, total, detail: c.detail || null };
        }
        return null;
    }

    const leftText = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
    const leftShort = (ms) => { const m = Math.ceil(Math.max(0, ms) / 60000); return `${m} min`; };

    /** What the start set: "80°F, seat heat low, wheel, defrost". */
    function runSets(d) {
        const lim = state && state.limits;
        if (!d) { const s = st(); return s && num(s.setTemp) ? `${tempText(s.setTemp, lim)}${/^\d/.test(tempText(s.setTemp, lim)) ? '°F' : ''}` : 'Climate on'; }
        const t = tempText(d.temp, lim);
        const extra = startSets({ seat: d.seat, heating: d.heating, defrost: d.defrost });
        return `${t}${/^\d/.test(t) ? '°F' : ''}${extra === 'climate only' ? '' : `, ${extra}`}`;
    }

    /** For the title bar's glyph and its bubble (wmShell): shown while a remote start runs. */
    function statusState() {
        const r = canUse() ? runInfo() : null;
        if (!r) return { running: false };
        const s = st();
        const left = r.until ? r.until - Date.now() : null;
        const blocks = r.until && r.total ? Math.max(0, Math.min(18, Math.round((left / r.total) * 18))) : 18;
        const html = `<div class="lps-bub">
            <div class="lps-bub-time">${r.until ? `<b data-lps-cd="${r.until}">${leftText(left)}</b> left, until ${esc(clock(r.until))}` : '<b>Running</b>'}</div>
            <div class="wm-ds-progress${r.until ? '' : ' is-marquee'}" role="progressbar" aria-label="Time left"><span data-lps-bar="${r.until || ''}" data-lps-total="${r.total}" style="--wm-ds-blocks:${blocks}"></span></div>
            <div class="lps-bub-rows"><span>Climate</span><b>${esc(runSets(r.detail))}</b><span>Fuel</span><b>${num(s.fuel) ? `${Math.round(s.fuel)}%` : '--'}${num(s.range) ? `, ${Math.round(s.range)} mi` : ''}</b><span>Doors</span><b>${s.locked === false ? 'Unlocked' : s.locked ? 'Locked' : 'Unknown'}</b></div>
        </div>`;
        return { running: true, until: r.until, title: carTitle(), html, canStop: isAdmin() };
    }

    // one second ticker, alive only while a remote start with an end time is running and the phone is
    // seen (the screen on, the page shown, not behind an Android program): it moves the countdowns already
    // on screen (no server call) and ends the run when the time is up. Not seen, one timer ends the run on
    // time instead (its glyph, Today and the page follow), with no ticks before it.
    let ticker = null;
    let endTimer = null;
    let tickN = 0;
    const seenNow = () => (ws && typeof ws.onScreen === 'function' ? ws.onScreen() : !document.hidden);
    function tick() {
        const r = runInfo();
        const timed = !!(r && r.until);
        const live = timed && seenNow();
        clearTimeout(endTimer);
        endTimer = null;
        if (!live && ticker) { clearInterval(ticker); ticker = null; }
        // perf: allow the running start's countdown, only while it is on screen (tick() stops it unseen and sets one timer for the end instead)
        if (live) { if (!ticker) ticker = setInterval(onTick, 1000); return; }
        if (timed) endTimer = setTimeout(() => { endTimer = null; changed(); }, Math.max(0, r.until - Date.now()) + 50);
    }
    function onTick() {
        const r = runInfo();
        if (!r || !r.until || !seenNow()) { tick(); if (!r) changed(); return; }
        const left = r.until - Date.now();
        document.querySelectorAll('[data-lps-cd]').forEach((el) => { el.textContent = leftText(Number(el.dataset.lpsCd) - Date.now()); });
        document.querySelectorAll('[data-lps-bar]').forEach((el) => { const total = Number(el.dataset.lpsTotal) || 1; el.style.setProperty('--wm-ds-blocks', String(Math.max(0, Math.min(18, Math.round(((Number(el.dataset.lpsBar) - Date.now()) / total) * 18))))); });
        // Today's superscript counts whole minutes
        if (++tickN % 15 === 0) todayChanged();
        if (left <= 0) changed();
    }
    document.addEventListener('visibilitychange', tick, { signal: appScopeSignal });
    window.addEventListener('melatonscreen', tick, { signal: appScopeSignal });
    document.addEventListener('wmBehind', tick, { signal: appScopeSignal });

    // ---------------------------------------------------------------- commands

    function needAdmin() {
        if (isAdmin()) return true;
        ws.messageBox({ title: TITLE, icon: 'info', text: 'Only the administrator can control the car.' });
        return false;
    }

    /** Whether a command can go now (says why not). */
    function canSend() {
        if (!needAdmin()) return false;
        if (!configured()) { openLayer('settings'); return false; }
        if (busyCommand()) { ws.messageBox({ title: TITLE, icon: 'info', text: 'The car is still answering the last command.' }); return false; }
        return true;
    }

    /** background: no wait cursor while BlueLink takes the command (a few seconds); the pushed state
     * shows "Starting, waiting for the car" meanwhile, and a failure still comes up as a message. */
    async function send(kind, options, background) {
        // in range of the phone's car key (#874, wmCarKey.js): Lock / Unlock go over Samsung Digital
        // Key on the phone itself, no server or BlueLink round trip; the server sees it at its next read
        const ck = window.wmCarKey;
        if ((kind === 'lock' || kind === 'unlock') && ck && ck.can(kind) && ck.press(kind)) return true;
        if (!canSend()) return false;
        try {
            const req = ask('lapis_command', { kind, options: options || {} }, 60000);
            await (background ? req : ws.busy(req, { delay: 250, timeout: 60000 }));
            return true;
        } catch (err) {
            ws.messageBox({ title: TITLE, icon: 'error', text: `${{ lock: 'Lock', unlock: 'Unlock', start: 'Remote start', stop: 'Remote stop' }[kind]} could not be sent.\n\n${(err && err.message) || 'Check the data connection, then try again.'}` });
            return false;
        }
    }

    async function doUnlock() {
        if (!needAdmin()) return;
        const ok = await ws.messageBox({ title: TITLE, icon: 'question', text: 'Unlock the doors?', buttons: [{ text: 'Unlock', value: true }, { text: 'Cancel', value: false }] });
        if (ok) send('unlock');
    }

    async function doStop() {
        if (!needAdmin()) return;
        const ok = await ws.messageBox({ title: TITLE, icon: 'question', text: 'Stop the engine and the climate control?', buttons: [{ text: 'Stop', value: true }, { text: 'Cancel', value: false }] });
        if (ok) send('stop');
    }

    async function userRefresh(locate) {
        if (!configured()) { openLayer('settings'); return; }
        if (!needAdmin()) return;
        try {
            const d = await ws.busy(ask('lapis_refresh', { locate: !!locate }, 90000), { delay: 250, timeout: 90000 });
            take(d.state);
        } catch (err) {
            ws.messageBox({ title: TITLE, icon: 'error', text: `The car could not be read.\n\n${(err && err.message) || 'Check the data connection, then try again.'}` });
        }
    }

    // ---------------------------------------------------------------- build

    function build() {
        page.innerHTML = `
            <div class="lps-root">
                <div class="lps-plate"><img class="lps-gem" src="/static_images/lapis/emblem.png" alt="" draggable="false"><span class="lps-car-name"></span><span class="lps-updated"></span></div>
                <div class="lps-scroll wm-pg-scroll">
                    <div class="lps-scr lps-hero" data-open="status">
                        <div class="lps-sbar"><i class="lps-dot"></i><b class="lps-park"></b><span class="lps-where"></span><span class="lps-sp"></span><span class="lps-odo"></span></div>
                        <div class="lps-stage"><img class="lps-carimg" alt="" draggable="false" decoding="async"><div class="lps-horizon"></div><div class="lps-map lps-stage-map" hidden></div><span class="lps-pill is-l lps-p-lock"></span><span class="lps-pill is-r lps-p-eng"></span><button type="button" class="lps-key lps-view" aria-label="Show the map"></button></div>
                    </div>
                    <div class="lps-scr">
                        <div class="lps-cards">
                            <div class="lps-card lps-c-fuel" data-open="history" role="button"></div>
                            <div class="lps-card lps-c-clim" data-open="start" role="button"></div>
                        </div>
                        <div class="lps-tiles" data-open="status"></div>
                    </div>
                    <div class="lps-scr lps-roomy" data-open="status"><div class="lps-sbar"><b>Tires</b><span class="lps-sp"></span><span class="lps-tires-note"></span></div><div class="lps-tires-host"></div></div>
                    <div class="lps-pad"></div>
                </div>
                <div class="lps-cmd">
                    <button type="button" class="lps-key" data-cmd="lock"><span class="lps-led"><i></i></span>${I.lock}<span>Lock</span></button>
                    <button type="button" class="lps-key" data-cmd="unlock"><span class="lps-led"><i></i></span>${I.unlock}<span>Unlock</span></button>
                    <button type="button" class="lps-go" data-cmd="start"><span>ENGINE<br>START<br>STOP</span></button>
                    <button type="button" class="lps-key" data-cmd="find"><span class="lps-led"><i></i></span>${I.find}<span>Find</span></button>
                </div>
                <div class="lps-layer" hidden><div class="lps-layer-body wm-pg-scroll"></div></div>
            </div>`;
        const q = (s) => page.querySelector(s);
        els = {
            root: q('.lps-root'), name: q('.lps-car-name'), updated: q('.lps-updated'), dot: q('.lps-dot'), park: q('.lps-park'), where: q('.lps-where'), odo: q('.lps-odo'),
            img: q('.lps-carimg'), stage: q('.lps-stage'), stageMap: q('.lps-stage-map'), view: q('.lps-view'), pLock: q('.lps-p-lock'), pEng: q('.lps-p-eng'), fuel: q('.lps-c-fuel'), clim: q('.lps-c-clim'), tiles: q('.lps-tiles'), pad: q('.lps-pad'),
            tiresHost: q('.lps-tires-host'), tiresNote: q('.lps-tires-note'),
            cmd: q('.lps-cmd'), layer: q('.lps-layer'), body: q('.lps-layer-body')
        };
        q('.lps-scroll').addEventListener('click', (e) => {
            // the car / map switch, and the map itself (dragging it is not a tap on the display)
            if (e.target.closest('.lps-view')) { heroView = heroView === 'map' ? 'car' : 'map'; try { localStorage.setItem(LS_VIEW, heroView); } catch (_) { /* private mode */ } renderHero(); return; }
            if (e.target.closest('.lps-stage-map')) return;
            const b = e.target.closest('[data-open]');
            if (b) openLayer(b.dataset.open);
        });
        els.cmd.addEventListener('click', (e) => {
            const b = e.target.closest('[data-cmd]');
            if (!b || b.disabled) return;
            const c = b.dataset.cmd;
            if (c === 'lock') send('lock');
            else if (c === 'unlock') doUnlock();
            else if (c === 'find') openLayer('map');
            else if (c === 'start') { if (runInfo()) doStop(); else openLayer('start'); }
        });
        els.body.addEventListener('click', onLayerClick);
        // one listener for the page (the same function each mount: added once), not one more per open (#890)
        document.addEventListener('visibilitychange', pauseHidden, { signal: appScopeSignal });
    }
    function pauseHidden() { if (els) els.root.classList.toggle('is-paused', document.hidden); }

    // ---------------------------------------------------------------- main page

    function render() {
        if (!els || !shown) { stale = true; return; }
        stale = false;
        const s = st();
        const lim = state && state.limits;
        const v = state && state.vehicle;
        // the car's name is the title bar's; the plate names the model
        els.name.textContent = modelText(v) || 'No vehicle';
        if (!layers.length && ws) ws.setTitle(carTitle());
        els.updated.textContent = s && s.at ? when(s.at) : '';
        const pl = parkLine();
        els.dot.dataset.s = pl.dot;
        els.park.textContent = pl.head;
        els.where.textContent = pl.tail;
        els.odo.textContent = s && num(s.odometer) ? miles(s.odometer) : '';
        const src = carSrc(false);
        if (els.img.getAttribute('src') !== src) els.img.src = src;
        renderHero();

        const locked = s ? s.locked : null;
        els.pLock.className = `lps-pill is-l lps-p-lock${locked === false ? ' is-warn' : ''}`;
        els.pLock.innerHTML = `${locked === false ? I.unlock : I.lock}${locked === null ? 'Unknown' : locked ? 'Locked' : 'Unlocked'}`;
        const cmd = state && state.command;
        const running = !!(s && s.engine);
        els.pEng.className = `lps-pill is-r lps-p-eng${running ? ' is-on' : ''}`;
        els.pEng.innerHTML = `${I.power}${!s ? 'No report' : running ? (cmd && cmd.runsUntil && cmd.runsUntil > Date.now() ? `<span data-lps-cd="${cmd.runsUntil}">${leftText(cmd.runsUntil - Date.now())}</span> left` : s.climate ? 'Climate on' : 'Engine on') : 'Engine off'}`;

        // fuel
        const u = state && state.usage;
        const low = s && (s.fuelLow === true || (num(s.fuel) && state.settings && s.fuel <= state.settings.lowFuelPct));
        const rt = refuelText();
        els.fuel.innerHTML = `<div class="lps-card-l">${I.fuel}Fuel</div>
            <div class="lps-card-v">${s && num(s.range) ? Math.round(s.range) : '--'}<small>mi</small></div>
            <div class="lps-bar${low ? ' is-low' : ''}"><i style="transform:scaleX(${s && num(s.fuel) ? Math.max(0.02, Math.min(1, s.fuel / 100)) : 0})"></i></div>
            <div class="lps-card-s"><span>${s && num(s.fuel) ? `${Math.round(s.fuel)}%` : ''}</span><span>${rt ? `Gas <b>${esc(refuelText(true))}</b>` : ''}</span></div>`;

        // climate: what a remote start would set, and the weather it is based on
        const c = state && state.climate;
        const tt = c ? tempText(c.temp, lim) : '--';
        els.clim.innerHTML = `<div class="lps-card-l">${I.fan}Climate${state && state.settings && state.settings.autoClimate ? ' · Auto' : ''}</div>
            <div class="lps-card-v">${led(tt)}${/^\d/.test(tt) ? '<small>°F</small>' : ''}</div>
            <div class="lps-card-s"><span>Outside ${c && num(c.outdoorF) ? `${Math.round(c.outdoorF)}°` : '--'}</span><span>cabin <b>${c && num(c.interiorF) ? `${Math.round(c.interiorF)}°F` : '--'}</b></span></div>
            <div class="lps-card-s lps-card-sets"><span>Start sets</span><b>${esc(startSets(c))}</b></div>`;

        // tiles
        const o = openList(s);
        const tile = (icon, text, warn, off) => `<div class="lps-tile${warn ? ' is-warn' : ''}${off ? ' is-off' : ''}">${icon}${esc(text)}</div>`;
        els.tiles.innerHTML = !s ? tile(I.door, '--', false, true) + tile(I.win, '--', false, true) + tile(I.trunk, '--', false, true) + tile(I.tire, '--', false, true) + tile(I.batt, '--', false, true)
            : tile(I.door, o.doors.length ? 'Open' : 'Closed', o.doors.length > 0)
            + tile(I.win, o.windows.length ? 'Open' : 'Up', o.windows.length > 0)
            + tile(I.trunk, s.trunk ? 'Open' : 'Shut', s.trunk === true)
            + tile(I.tire, tireAlert() ? 'Low' : 'OK', tireAlert())
            + tile(I.batt, num(s.battery12) ? `${Math.round(s.battery12)}%` : 'OK', battLow(s));

        els.tiresHost.innerHTML = tiresHtml(s);
        els.tiresNote.textContent = s && tireAlert() ? 'Low pressure' : s ? 'psi' : '';

        // the leather pad
        const rows = [];
        if (!canUse()) rows.push('<div class="lps-pad-note">Lapis Remote is for the administrator.</div>');
        else if (loadFailed && !state) rows.push(`<div class="lps-pad-note">${esc(loadFailed)}</div>`);
        else if (!configured()) rows.push('<div class="lps-pad-note">No BlueLink account is saved. Add it in Dreamscape CardSpace &gt; Service keys &gt; Hyundai BlueLink, then tap Refresh.</div>');
        else {
            if (state.error) rows.push(`<div class="lps-pad-note">${esc(state.error.message)}</div>`);
            (state.alerts || []).forEach((a) => rows.push(`<div class="lps-pad-row is-warn" data-open="status"><span>${esc(a.title)}</span><b>${a.key === 'battery12' && s && num(s.battery12) ? `${Math.round(s.battery12)}%` : 'Check'}</b></div>`));
            if (rt) rows.push(`<div class="lps-pad-row${u.refuel && !u.refuel.beyond && u.refuel.daysLeft <= 0 ? ' is-warn' : ''}" data-open="history"><span>Get gas</span><b>${esc(rt)}</b></div>`);
            const cl = climateLine();
            if (cl) rows.push(`<div class="lps-pad-row" data-open="start"><span>Remote start will set</span><b>${esc(cl)}</b></div>`);
            const sv = nextService();
            if (sv) rows.push(`<div class="lps-pad-row${sv.due || sv.soon ? ' is-warn' : ''}" data-open="service"><span>${esc(sv.label)}</span><b>${sv.milesLeft <= 0 ? `${Math.abs(sv.milesLeft).toLocaleString()} mi over` : `in ${sv.milesLeft.toLocaleString()} mi`}</b></div>`);
            if (!rows.length) rows.push('<div class="lps-pad-note">Waiting for the car\'s first report.</div>');
        }
        els.pad.innerHTML = rows.join('');

        // keys
        const busy = !!busyCommand();
        const off = !configured() || busy || !canUse();
        const key = (c2) => els.cmd.querySelector(`[data-cmd="${c2}"]`);
        key('lock').disabled = off;
        key('unlock').disabled = off;
        key('start').disabled = off;
        key('lock').querySelector('.lps-led i').classList.toggle('is-on', locked === true);
        key('unlock').querySelector('.lps-led i').classList.toggle('is-on', locked === false);
        key('find').querySelector('.lps-led i').classList.toggle('is-on', false);
        key('start').classList.toggle('is-running', running);
        if (layers.length) renderLayer();
        if (ws) ws.refreshSoftKeys();
    }

    /** The top display: the car's picture, or (the switch at its corner) the map with the car on it. */
    function renderHero() {
        if (!els) return;
        const loc = state && state.location;
        const showMap = heroView === 'map' && !!loc;
        els.stage.classList.toggle('is-map', showMap);
        els.stageMap.hidden = !showMap;
        els.view.innerHTML = showMap ? I.car : I.find;
        els.view.setAttribute('aria-label', showMap ? 'Show the car' : 'Show the map');
        els.view.hidden = !loc;
        if (!showMap) { if (heroMap) { heroMap = null; els.stageMap.innerHTML = ''; } return; }
        const key = `${loc.lat},${loc.lon}`;
        if (heroMap && heroMap.key === key) return;
        const s = (state && state.settings) || {};
        const places = [];
        if (s.home) places.push({ ...s.home, letter: 'H' });
        if (s.work) places.push({ ...s.work, letter: 'W' });
        heroMap = TileMap(els.stageMap, loc, places, 15);
    }

    // ---------------------------------------------------------------- layers

    function openLayer(name) {
        if (!LAYER_TITLES[name]) return;
        if (name === 'settings' && !isAdmin()) { ws.messageBox({ title: TITLE, icon: 'info', text: 'Only the administrator can change the settings.' }); return; }
        if (name !== 'settings' && !configured()) { if (isAdmin()) name = 'settings'; else return; }
        if (layers[layers.length - 1] !== name) layers.push(name);
        if (name === 'settings') form = null;
        if (name === 'start') draft = null;
        if (name === 'history') loadHistory(historyRange);
        syncLayers();
    }

    function popLayer() {
        if (!layers.length) return false;
        const top = layers.pop();
        if (top === 'map') map = null;
        syncLayers();
        return true;
    }

    function syncLayers() {
        if (!els) return;
        const top = layers[layers.length - 1] || null;
        els.layer.hidden = !top;
        els.layer.dataset.layer = top || '';
        if (top) { els.body.dataset.for = ''; renderLayer(); }
        ws.setTitle(top ? LAYER_TITLES[top] : carTitle());
        ws.syncHistory();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    function renderLayer() {
        const top = layers[layers.length - 1];
        if (!top || !els) return;
        if (top === 'settings') { if (els.body.dataset.for !== 'settings') renderSettings(); return; }
        if (top === 'item') { if (els.body.dataset.for !== 'item') renderItem(); return; }
        els.body.className = 'lps-layer-body wm-pg-scroll';
        if (top === 'start') renderStart();
        else if (top === 'map') renderMap();
        else if (top === 'status') els.body.innerHTML = statusHtml();
        else if (top === 'service') els.body.innerHTML = serviceHtml();
        else if (top === 'history') els.body.innerHTML = historyHtml();
        els.body.dataset.for = top;
    }

    function onLayerClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const act = b.dataset.act;
        const top = layers[layers.length - 1];
        if (top === 'start') startAct(act);
        else if (top === 'service' && act === 'edit') editItem(b.dataset.id);
        else if (top === 'history' && act === 'range') { historyRange = b.dataset.range; loadHistory(historyRange); renderLayer(); }
        else if (top === 'map' && (act === 'zin' || act === 'zout') && map) map.zoom(act === 'zin' ? 1 : -1);
        else if (top === 'map' && act === 'centre' && map) map.home();
    }

    // ---------------------------------------------------------------- remote start

    function draftOf() {
        if (draft) return draft;
        const c = (state && state.climate) || null;
        const s = (state && state.settings) || {};
        const lim = (state && state.limits) || { tempMin: 62, tempMax: 82 };
        const auto = !!(c && s.autoClimate);
        draft = {
            auto,
            temp: Math.min(lim.tempMax, Math.max(lim.tempMin, auto ? c.temp : 72)),
            defrost: auto ? !!c.defrost : false,
            heating: auto ? c.heating : 0,
            seat: auto ? c.seat : 0,
            minutes: s.runMinutes || 10
        };
        return draft;
    }

    function renderStart() {
        const d = draftOf();
        const c = state && state.climate;
        const s = st();
        const lim = (state && state.limits) || { tempMin: 62, tempMax: 82 };
        // a remote start on its timer can be stopped; the engine on otherwise (driven) cannot be started or stopped here
        const running = !!runInfo();
        const onHead = engineOnHead(s);
        const busy = !!busyCommand();
        const tt = tempText(d.temp, lim);
        const why = !c ? 'The weather at the car is not known yet.'
            : d.auto ? `${c.mode === 'heat' ? 'Cold' : c.mode === 'cool' ? 'Warm' : 'Mild'} in the cabin: ${c.reason.length ? c.reason.map((r) => `<b>${esc(r)}</b>`).join(', ') : '<b>climate only</b>'}`
                : 'Your own settings. Menu has Automatic Settings.';
        const leds = (n, on, cls = '') => `<span class="lps-led${n === 3 ? ' is-3' : ''}${cls}">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'is-on' : ''}"></i>`).join('')}</span>`;
        const heatLv = SEAT_HEAT.indexOf(d.seat);
        const coolLv = SEAT_COOL.indexOf(d.seat);
        const frac = (d.temp - lim.tempMin) / Math.max(1, lim.tempMax - lim.tempMin);
        const until = Date.now() + d.minutes * 60000;
        els.body.innerHTML = `
            <div class="lps-scr">
                <div class="lps-sbar">${I.fan}<b>${d.auto ? 'Auto climate' : 'Manual climate'}</b><span class="lps-sp"></span><span>${c ? `${Math.round(c.cloudCover)}% cloud, sun adds ${c.solarGainF}°F` : ''}</span></div>
                <div class="lps-auto-line"><div class="lps-auto-t"><span>Outside</span><b>${led(c && num(c.outdoorF) ? Math.round(c.outdoorF) : '--')}<small>°F</small></b></div>${I.arrow}<div class="lps-auto-t"><span>Cabin target</span><b>${led(tt)}${/^\d/.test(tt) ? '<small>°F</small>' : ''}</b></div></div>
                <div class="lps-why">${why}</div>
            </div>
            <div class="lps-knobrow">
                <button type="button" class="lps-key is-pm" data-act="down" aria-label="Cooler">&minus;</button>
                <div class="lps-knob${d.temp >= 76 ? ' is-heat' : ''}"><i class="lps-nib" style="transform:rotate(${Math.round(-135 + 270 * frac)}deg)"></i><div class="lps-knob-in"><b>${led(tt)}${/^\d/.test(tt) ? '<small>°F</small>' : ''}</b><span>${d.auto ? 'AUTO' : 'MANUAL'}</span></div></div>
                <button type="button" class="lps-key is-pm" data-act="up" aria-label="Warmer">+</button>
            </div>
            <div class="lps-opts">
                <button type="button" class="lps-key${d.defrost ? ' is-on' : ''}" data-act="defrost">${leds(1, d.defrost ? 1 : 0)}${I.defrost}<span>Defrost</span></button>
                <button type="button" class="lps-key" data-act="seatHeat">${leds(3, Math.max(0, heatLv))}${I.seat}<span>Seat heat</span></button>
                <button type="button" class="lps-key" data-act="wheel">${leds(2, WHEEL.indexOf(d.heating) < 0 ? 0 : WHEEL.indexOf(d.heating))}${I.wheel}<span>${d.heating === 4 ? 'Wheel+glass' : 'Wheel'}</span></button>
                <button type="button" class="lps-key" data-act="seatCool">${leds(3, Math.max(0, coolLv), ' is-cool')}${I.seatCool}<span>Seat cool</span></button>
            </div>
            <div class="lps-pad"><div class="lps-pad-row" data-act="minutes"><span>Run for</span><b>${d.minutes} minutes</b></div></div>
            <div class="lps-launch">
                <button type="button" class="lps-go${running ? ' is-running' : ''}" data-act="go"${busy || onHead || !isAdmin() ? ' disabled' : ''}><i class="lps-go-fill"></i><span>ENGINE<br>START<br>STOP</span></button>
                <div class="lps-launch-txt">${running ? '<b>The car is running</b>Tap to stop the engine<br>and the climate control.' : onHead ? `<b>${esc(onHead)}</b>Remote start works once the car<br>is parked with the engine off.` : busy ? '<b>Waiting for the car</b>The command was sent.' : `<b>Hold to start</b>The doors stay locked.<br>Stops by itself at ${clock(until)}.`}</div>
            </div>`;
        const go = els.body.querySelector('[data-act="go"]');
        if (go && !running) {
            const cancel = () => { clearTimeout(holdTimer); holdTimer = null; go.classList.remove('is-holding'); };
            go.addEventListener('contextmenu', (e) => e.preventDefault());
            go.addEventListener('pointerdown', (e) => {
                if (go.disabled) return;
                try { go.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
                go.classList.add('is-holding');
                clearTimeout(holdTimer);
                holdTimer = setTimeout(() => { cancel(); startNow(); }, HOLD_MS);
            });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => go.addEventListener(ev, cancel));
        }
    }

    function startAct(act) {
        const d = draftOf();
        const lim = (state && state.limits) || { tempMin: 62, tempMax: 82 };
        const cycle = (list, v) => list[(Math.max(0, list.indexOf(v)) + 1) % list.length];
        if (act === 'go') { if (runInfo()) doStop(); return; } // starting is the hold
        if (act === 'minutes') {
            const opts = [3, 5, 8, 10];
            d.minutes = opts[(opts.indexOf(d.minutes) + 1) % opts.length] || 10;
        } else {
            d.auto = false;
            if (act === 'up') d.temp = Math.min(lim.tempMax, d.temp + 1);
            else if (act === 'down') d.temp = Math.max(lim.tempMin, d.temp - 1);
            else if (act === 'defrost') d.defrost = !d.defrost;
            else if (act === 'seatHeat') d.seat = cycle(SEAT_HEAT, d.seat);
            else if (act === 'seatCool') d.seat = cycle(SEAT_COOL, d.seat);
            else if (act === 'wheel') d.heating = cycle(WHEEL, d.heating);
        }
        renderStart();
    }

    async function startNow() {
        const d = draftOf();
        const options = d.auto ? { auto: true, minutes: d.minutes } : { auto: false, temp: d.temp, defrost: d.defrost, heating: d.heating, seat: d.seat, minutes: d.minutes };
        // started from Today (or Traffic's bubble) the app is not on screen: its title is not the shell's
        if (!canSend()) return;
        // the start goes at once: back to the car page, which shows it being sent and then running
        layers = layers.filter((l) => l !== 'start');
        draft = null;
        if (shown) syncLayers(); else stale = true;
        await send('start', options, true);
    }

    async function startConfirm() {
        if (!needAdmin()) return;
        const d = draftOf();
        const lim = state && state.limits;
        const tt = tempText(d.temp, lim);
        const ok = await ws.messageBox({ title: 'Remote Start', icon: 'question', text: `Start the car for ${d.minutes} minutes at ${tt}${/^\d/.test(tt) ? '°F' : ''}?`, buttons: [{ text: 'Start', value: true }, { text: 'Cancel', value: false }] });
        if (ok) startNow();
    }

    // ---------------------------------------------------------------- vehicle status

    /** The car from above with each tire's pressure beside it (the low ones in amber). */
    function tiresHtml(s) {
        const p = (s && s.tirePsi) || {};
        const lamp = (s && s.tireLow) || {};
        const lows = new Set();
        ((state && state.alerts) || []).filter((a) => a.key === 'tire').forEach((a) => { ['fl', 'fr', 'rl', 'rr'].forEach((k) => { if (a.stamp.split(':')[0].includes(k)) lows.add(k); }); });
        ['fl', 'fr', 'rl', 'rr'].forEach((k) => { if (lamp[k]) lows.add(k); });
        const o = openList(s);
        const tag = (k) => `<span class="lps-psi is-${k}${lows.has(k) ? ' is-low' : ''}">${num(p[k]) ? `${p[k]}<small>psi</small>` : '--'}</span>`;
        const wheel = (k, x, y) => `<rect class="${lows.has(k) ? 'is-low' : ''}" x="${x}" y="${y}" width="9" height="24" rx="3"/>`;
        return `<div class="lps-tires">
            <svg viewBox="0 0 100 180" fill="none" stroke="currentColor" stroke-width="1.300" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
                <g class="lps-tires-wheels">${wheel('fl', 12, 32)}${wheel('fr', 79, 32)}${wheel('rl', 12, 122)}${wheel('rr', 79, 122)}</g>
                <path class="lps-tires-body" d="M30 14C36 6 64 6 70 14C76 22 78 40 78 62V132C78 156 76 166 70 172C62 177 38 177 30 172C24 166 22 156 22 132V62C22 40 24 22 30 14Z"/>
                <path d="M28 58C40 52 60 52 72 58L68 80C56 77 44 77 32 80ZM32 80V124M68 80V124M32 124C44 127 56 127 68 124L71 144C58 149 42 149 29 144ZM22 66 16 62V70L22 72M78 66 84 62V70L78 72M38 164C46 166 54 166 62 164"/>
                ${s && s.hood ? '<path class="is-open" d="M32 16C42 11 58 11 68 16L70 40C58 36 42 36 30 40Z"/>' : ''}${s && s.trunk ? '<path class="is-open" d="M30 150C42 155 58 155 70 150L68 170C58 174 42 174 32 170Z"/>' : ''}
            </svg>${tag('fl')}${tag('fr')}${tag('rl')}${tag('rr')}
            ${o.doors.length ? `<span class="lps-tires-doors">${esc(`Open: ${o.doors.join(', ')}`)}</span>` : ''}</div>`;
    }

    function psiText(s) {
        const p = (s && s.tirePsi) || {};
        return ['fl', 'fr', 'rl', 'rr'].every((k) => num(p[k])) ? `Front ${p.fl} / ${p.fr} psi, rear ${p.rl} / ${p.rr} psi` : '';
    }

    function statusHtml() {
        const s = st();
        if (!s) return '<div class="lps-scr"><div class="lps-empty">No report from the car yet.</div></div>';
        const o = openList(s);
        const row = (icon, title, value, cls = '', sub = '') => `<div class="lps-row ${cls}">${icon}<span class="lps-row-t">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="lps-row-v">${esc(value)}</span></div>`;
        const tires = s.tireLow || {};
        const lowTires = [['fl', 'front left'], ['fr', 'front right'], ['rl', 'rear left'], ['rr', 'rear right']].filter(([k]) => tires[k]).map(([, n]) => n);
        return `<div class="lps-scr">
            <div class="lps-sbar"><b>Reported ${esc(when(s.at))}</b><span class="lps-sp"></span><span>${state.seenAt ? `read ${esc(clock(state.seenAt))}` : ''}</span></div>
            <div class="lps-tires-host">${tiresHtml(s)}</div>
            ${(state.alerts || []).length ? `<div class="lps-list">${state.alerts.map((a) => `<div class="lps-row is-warn">${I.warn}<span class="lps-row-t">${esc(a.title)}<small style="white-space:normal">${esc(a.text)}</small></span></div>`).join('')}</div>` : ''}
            <div class="lps-list">
                ${row(s.locked === false ? I.unlock : I.lock, 'Doors', s.locked === null ? 'Unknown' : s.locked ? 'Locked' : 'Unlocked', s.locked === false ? 'is-warn' : '', o.doors.length ? `Open: ${o.doors.join(', ')}` : 'All closed')}
                ${row(I.win, 'Windows', o.windows.length ? 'Open' : 'Up', o.windows.length ? 'is-warn' : '', o.windows.length ? o.windows.join(', ') : '')}
                ${row(I.trunk, 'Trunk', s.trunk ? 'Open' : 'Shut', s.trunk ? 'is-warn' : '')}
                ${row(I.hood, 'Hood', s.hood ? 'Open' : 'Shut', s.hood ? 'is-warn' : '')}
                ${row(I.power, 'Engine', s.engine ? 'Running' : 'Off', '', s.climate ? `Climate on${num(s.setTemp) ? `, ${tempText(s.setTemp, state.limits)}` : ''}${s.defrost ? ', defrost' : ''}` : '')}
                ${row(I.fuel, 'Fuel', num(s.fuel) ? `${Math.round(s.fuel)}%` : '--', s.fuelLow ? 'is-warn' : '', num(s.range) ? `${Math.round(s.range)} miles of range` : '')}
                ${row(I.tire, 'Tire pressure', tireAlert() ? 'Low' : 'OK', tireAlert() ? 'is-warn' : '', psiText(s) || (lowTires.length ? `Low: ${lowTires.join(', ')}` : ''))}
                ${row(I.batt, '12 V battery', num(s.battery12) ? `${Math.round(s.battery12)}%` : '--', battLow(s) ? 'is-warn' : '', battLow(s) ? `The car warns under ${num(s.battery12WarnAt) ? s.battery12WarnAt : 50}%` : '')}
                ${row(I.drop, 'Washer fluid', s.washerLow ? 'Low' : 'OK', s.washerLow ? 'is-warn' : '')}
                ${row(I.drop, 'Brake fluid', s.brakeFluidLow ? 'Low' : 'OK', s.brakeFluidLow ? 'is-warn' : '')}
                ${row(I.key, 'Smart key battery', s.keyBatteryLow ? 'Low' : 'OK', s.keyBatteryLow ? 'is-warn' : '')}
                ${row(I.road, 'Odometer', miles(s.odometer))}
            </div></div>`;
    }

    // ---------------------------------------------------------------- maintenance

    function serviceHtml() {
        const list = (state && state.maintenance) || [];
        const s = st();
        const warn = [];
        if (s && s.tireLow && s.tireLow.any) warn.push([I.tire, 'Tire pressure is low']);
        if (s && s.washerLow) warn.push([I.drop, 'Washer fluid is low']);
        if (s && s.brakeFluidLow) warn.push([I.drop, 'Brake fluid is low']);
        if (s && s.keyBatteryLow) warn.push([I.key, 'The smart key battery is low']);
        if (battLow(s)) warn.push([I.batt, `The 12 V battery is at ${Math.round(s.battery12)}%`]);
        const rows = list.map((m) => {
            const total = m.everyMiles || 1;
            const used = m.milesLeft === null ? 0 : Math.max(0, Math.min(1, 1 - m.milesLeft / total));
            const value = m.milesLeft !== null ? (m.milesLeft <= 0 ? `${Math.abs(m.milesLeft).toLocaleString()} mi over` : `${m.milesLeft.toLocaleString()} mi`) : m.daysLeft !== null ? `${m.daysLeft} days` : '--';
            const sub = [m.everyMiles ? `every ${m.everyMiles.toLocaleString()} mi` : '', m.everyMonths ? `${m.everyMonths} months` : '', m.lastDate ? `done ${m.lastDate}` : 'not marked done yet'].filter(Boolean).join(' · ');
            return `<div class="lps-row${m.due ? ' is-due' : m.soon ? ' is-warn' : ''}" data-act="edit" data-id="${esc(m.id)}">${I.wrench}<span class="lps-row-t">${esc(m.label)}<small>${esc(sub)}</small><div class="lps-bar${m.due ? ' is-over' : m.soon ? ' is-low' : ''}"><i style="transform:scaleX(${m.due ? 1 : Math.max(0.02, used)})"></i></div></span><span class="lps-row-v">${esc(value)}</span></div>`;
        }).join('');
        return `<div class="lps-scr">
            <div class="lps-sbar">${I.wrench}<b>Maintenance</b><span class="lps-sp"></span><span>${s ? esc(miles(s.odometer)) : ''}</span></div>
            ${warn.length ? `<div class="lps-head">The car reports</div><div class="lps-list">${warn.map(([i, t]) => `<div class="lps-row is-warn">${i}<span class="lps-row-t">${esc(t)}</span></div>`).join('')}</div>` : ''}
            <div class="lps-head">Schedule</div>
            <div class="lps-list">${rows || '<div class="lps-empty">No maintenance items.</div>'}</div>
        </div>
        <div class="lps-pad"><div class="lps-pad-note">Tap an item to set how often it is due and when it was last done, or to start its count again after the work. Menu adds an item.</div></div>`;
    }

    // one maintenance item: how often, when it was last done, and the reset after the work

    function editItem(id) {
        if (!needAdmin()) return;
        const m = id ? ((state && state.settings && state.settings.maintenance) || []).find((x) => x.id === id) : null;
        if (id && !m) return;
        item = m
            ? { isNew: false, id: m.id, label: m.label, everyMiles: m.everyMiles ? String(m.everyMiles) : '', everyMonths: m.everyMonths ? String(m.everyMonths) : '', lastOdo: num(m.lastOdo) ? String(m.lastOdo) : '', lastDate: m.lastDate || '' }
            : { isNew: true, id: `item-${Date.now().toString(36)}`, label: '', everyMiles: '', everyMonths: '', lastOdo: '', lastDate: '' };
        layers.push('item');
        syncLayers();
    }

    function renderItem() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const box = els.body;
        box.className = 'lps-layer-body wm-pg-scroll wm-form lps-settings';
        box.dataset.for = 'item';
        if (!ui || !item) { box.innerHTML = '<p>The item is not available.</p>'; return; }
        const s = st();
        const live = ((state && state.maintenance) || []).find((x) => x.id === item.id);
        const left = live && live.milesLeft !== null ? (live.milesLeft <= 0 ? `${Math.abs(live.milesLeft).toLocaleString()} miles over` : `due in ${live.milesLeft.toLocaleString()} miles`) : '';
        box.innerHTML = `
            ${ui.row('Name:', ui.edit('lpsItName', item.label, 'data-i="label" maxlength="60" placeholder="for example Engine oil and filter"'), { for: 'lpsItName' })}
            ${ui.gap()}
            ${ui.sub('How often')}
            ${ui.row('Every (miles):', ui.edit('lpsItMi', item.everyMiles, 'data-i="everyMiles" maxlength="6" inputmode="numeric" placeholder="for example 8000"'), { for: 'lpsItMi' })}
            ${ui.row('Every (months):', ui.edit('lpsItMo', item.everyMonths, 'data-i="everyMonths" maxlength="3" inputmode="numeric" placeholder="blank: by miles only"'), { for: 'lpsItMo' })}
            ${ui.gap()}
            ${ui.sub('Last done')}
            ${ui.row('At (miles):', ui.edit('lpsItOdo', item.lastOdo, 'data-i="lastOdo" maxlength="7" inputmode="numeric" placeholder="the odometer at the last service"'), { for: 'lpsItOdo' })}
            ${ui.row('On:', ui.edit('lpsItDate', item.lastDate, 'data-i="lastDate" maxlength="10" placeholder="YYYY-MM-DD"'), { for: 'lpsItDate' })}
            ${ui.note(`The car is at ${miles(s && s.odometer)}${left ? `: ${left}` : ''}. Leave "Last done" blank if you do not know it: the count then runs to the next multiple of the miles.`)}
            ${ui.buttons([['itReset', 'Done Today (Reset)', !s || !num(s.odometer)], ...(item.isNew ? [] : [['itRemove', 'Remove Item']])], false)}`;
        box.querySelectorAll('input.wm-edit[data-i]').forEach((el) => el.addEventListener('input', () => { item[el.dataset.i] = el.value; }));
        box.querySelectorAll('.wm-button[data-act]').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (b.dataset.act === 'itReset') {
                // the work was just done: the count starts again from here
                item.lastOdo = String(Math.round(st().odometer));
                item.lastDate = (state && state.usage && state.usage.today) || new Date().toISOString().slice(0, 10);
                saveItem();
            } else if (b.dataset.act === 'itRemove') removeItem();
        }));
    }

    async function putMaintenance(list, failText) {
        try {
            await ws.busy(ask('lapis_settings_save', { settings: { maintenance: list } }), { delay: 250, timeout: 25000 });
            item = null;
            popLayer();
        } catch (err) {
            ws.messageBox({ title: 'Maintenance', icon: 'error', text: `${failText}\n\n${(err && err.message) || ''}`.trim() });
        }
    }

    function saveItem() {
        if (!item) return;
        const bad = (text) => { ws.messageBox({ title: 'Maintenance', icon: 'warning', text }); };
        const label = item.label.trim();
        const everyMiles = Math.round(Number(item.everyMiles) || 0);
        const everyMonths = Math.round(Number(item.everyMonths) || 0);
        if (!label) { bad('Give the item a name.'); return; }
        if (everyMiles <= 0 && everyMonths <= 0) { bad('Say how often the item is due: miles, months, or both.'); return; }
        if (item.lastDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(item.lastDate.trim())) { bad('The date is year-month-day, for example 2026-05-02.'); return; }
        if (everyMonths > 0 && !item.lastDate.trim()) { bad('An item due by months needs the date it was last done.'); return; }
        const next = { id: item.id, label, everyMiles: Math.max(0, everyMiles), everyMonths: Math.max(0, everyMonths) };
        if (item.lastOdo.trim() && Number(item.lastOdo) >= 0) next.lastOdo = Math.round(Number(item.lastOdo));
        if (item.lastDate.trim()) next.lastDate = item.lastDate.trim();
        const cur = ((state && state.settings && state.settings.maintenance) || []).slice();
        const i = cur.findIndex((m) => m.id === item.id);
        if (i >= 0) cur[i] = next; else cur.push(next);
        putMaintenance(cur, 'The item could not be saved.');
    }

    async function removeItem() {
        if (!item) return;
        const ok = await ws.messageBox({ title: 'Maintenance', icon: 'question', text: `Remove "${item.label}" from the schedule?`, buttons: [{ text: 'Remove', value: true }, { text: 'Cancel', value: false }] });
        if (!ok) return;
        putMaintenance(((state && state.settings && state.settings.maintenance) || []).filter((m) => m.id !== item.id), 'The item could not be removed.');
    }

    // ---------------------------------------------------------------- driving record

    async function loadHistory(range) {
        try {
            const d = await ask('lapis_history', { range });
            if (range === historyRange) { history = d; if (layers[layers.length - 1] === 'history' && shown) renderLayer(); }
        } catch (err) {
            history = { error: (err && err.message) || 'The record could not be read.' };
            if (layers[layers.length - 1] === 'history' && shown) renderLayer();
        }
    }

    function lineChart(points, lo, hi, colour) {
        if (!points || points.length < 2) return '';
        const t0 = points[0][0];
        const t1 = points[points.length - 1][0];
        const W = 300;
        const H = 64;
        const x = (t) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
        const y = (v) => H - 3 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - 8);
        const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('');
        return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="M0 ${y(lo + (hi - lo) / 2)}H${W}M0 ${y(hi)}H${W}M0 ${y(lo)}H${W}" stroke="rgba(255,255,255,.12)" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/><path d="${path}L${W} ${H}L0 ${H}Z" fill="${colour}" opacity=".16"/><path d="${path}" fill="none" stroke="${colour}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
    }

    function barChart(days) {
        if (!days || !days.length) return '';
        const max = Math.max(10, ...days.map((d) => d.miles));
        const W = 300;
        const H = 64;
        const bw = W / days.length;
        return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${days.map((d, i) => {
            const h = Math.max(d.miles > 0 ? 1.5 : 0, (d.miles / max) * (H - 6));
            return `<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="${d.fillups ? '#ffb347' : '#00aad2'}"/>`;
        }).join('')}</svg>`;
    }

    function historyHtml() {
        const seg = `<div class="lps-seg">${[['week', 'Week'], ['month', 'Month'], ['quarter', '3 Months'], ['year', 'Year']].map(([k, l]) => `<button type="button" data-act="range" data-range="${k}" class="${k === historyRange ? 'is-on' : ''}">${l}</button>`).join('')}</div>`;
        const h = history;
        if (!h || h.range !== historyRange) return `${seg}<div class="lps-scr"><div class="lps-empty">${h && h.error ? esc(h.error) : 'Reading the record...'}</div></div>`;
        if (h.error) return `${seg}<div class="lps-scr"><div class="lps-empty">${esc(h.error)}</div></div>`;
        if (!h.count) return `${seg}<div class="lps-scr"><div class="lps-empty">Nothing is recorded for this time yet. The server adds to the record every time the car reports.</div></div>`;
        const u = (state && state.usage) || {};
        const total = h.days.reduce((a, d) => a + d.miles, 0);
        const days = h.days.slice(historyRange === 'week' ? -7 : historyRange === 'month' ? -31 : -120);
        const span = `<div class="lps-chart-x"><span>${esc(fmtShort.format(new Date(h.from)))}</span><span>${esc(fmtShort.format(new Date(h.to)))}</span></div>`;
        const trips = h.trips.slice(0, 12).map((t) => `<div class="lps-row">${I.road}<span class="lps-row-t">${esc(when(t.to))}<small>${esc(clock(t.from))} to ${esc(clock(t.to))}${t.fuelUsed ? ` · ${t.fuelUsed}% of the tank` : ''}</small></span><span class="lps-row-v">${t.miles} mi</span></div>`).join('');
        const fills = h.fillups.slice(-6).reverse().map((f) => `<div class="lps-row">${I.fuel}<span class="lps-row-t">${esc(when(f.t))}<small>${Math.round(f.from)}% to ${Math.round(f.to)}%</small></span><span class="lps-row-v">${f.milesSinceLast != null ? `${Math.round(f.milesSinceLast)} mi since` : ''}</span></div>`).join('');
        const wk = u.weekday ? DAY_SHORT.map((n, i) => `${n} ${Math.round(u.weekday.miles[i])}`).join(' · ') : '';
        return `${seg}
            <div class="lps-scr">
                <div class="lps-sbar">${I.fuel}<b>Fuel level</b><span class="lps-sp"></span><span>${h.count.toLocaleString()} reports</span></div>
                <div class="lps-chart">${lineChart(h.fuel, 0, 100, '#00aad2') || '<div class="lps-empty">Not enough reports to draw.</div>'}${span}</div>
                <div class="lps-sbar">${I.road}<b>Miles a day</b><span class="lps-sp"></span><span>fill-up days in amber</span></div>
                <div class="lps-chart">${barChart(days)}</div>
                <div class="lps-stats">
                    <div class="lps-stat"><b>${Math.round(total).toLocaleString()}</b>miles</div>
                    <div class="lps-stat"><b>${h.perPct ? h.perPct.mpg : '--'}</b>mpg, ${h.perPct && h.perPct.basis === 'measured' ? 'measured' : 'rated'}</div>
                    <div class="lps-stat"><b>${h.fillups.length}</b>fill-ups</div>
                </div>
            </div>
            ${u.refuel ? `<div class="lps-pad"><div class="lps-pad-row"><span>Get gas</span><b>${esc(refuelText())}</b></div><div class="lps-pad-note">${esc(refuelWhy() || `${u.refuel.milesLeft} miles before the ${u.refuel.reservePct}% reserve.`)} Expected miles: ${esc(wk)}. Commute: ${u.commute && u.commute.miles ? `${u.commute.miles} mi each way` : 'not set'}.</div></div>` : ''}
            ${fills ? `<div class="lps-scr"><div class="lps-sbar"><b>Fill-ups</b></div><div class="lps-list">${fills}</div></div>` : ''}
            ${trips ? `<div class="lps-scr"><div class="lps-sbar"><b>Trips</b><span class="lps-sp"></span><span>between reports</span></div><div class="lps-list">${trips}</div></div>` : ''}`;
    }

    // ---------------------------------------------------------------- map

    const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
    const lat2y = (lat, z) => {
        const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
        return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
    };
    const x2lon = (x, z) => (x / (TILE * 2 ** z)) * 360 - 180;
    const y2lat = (y, z) => {
        const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
        return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    };

    /** A small slippy map over the server's street tiles: drag to pan, the keys zoom. */
    function TileMap(host, car, places, zoom) {
        const view = { lat: car.lat, lon: car.lon, z: zoom || 15 };
        host.innerHTML = '<div class="lps-map-pane"></div>';
        const pane = host.querySelector('.lps-map-pane');
        function layout() {
            const w = host.clientWidth;
            const h = host.clientHeight;
            if (!w || !h) return;
            const z = view.z;
            const left = lon2x(view.lon, z) - w / 2;
            const top = lat2y(view.lat, z) - h / 2;
            const n = 2 ** z;
            let html = '';
            for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
                if (ty < 0 || ty >= n) continue;
                for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
                    const wx = ((tx % n) + n) % n;
                    html += `<img src="/weather/tile/base/streets/${z}/${wx}/${ty}.png" style="left:${Math.round(tx * TILE - left)}px;top:${Math.round(ty * TILE - top)}px;width:${TILE}px;height:${TILE}px" alt="" draggable="false" decoding="async" onerror="this.style.visibility='hidden'">`;
                }
            }
            const mark = (p, cls, inner) => `<div class="lps-pin ${cls}" style="left:${Math.round(lon2x(p.lon, z) - left)}px;top:${Math.round(lat2y(p.lat, z) - top)}px">${inner}</div>`;
            places.forEach((p) => { html += mark(p, 'is-place', esc(p.letter)); });
            html += mark(car, '', I.pin);
            pane.style.transform = '';
            pane.innerHTML = html;
        }
        let drag = null;
        host.addEventListener('pointerdown', (e) => { if (e.target.closest('.lps-map-zoom')) return; drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 }; try { host.setPointerCapture(e.pointerId); } catch (_) { /* older WebView */ } });
        host.addEventListener('pointermove', (e) => { if (!drag) return; drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y; pane.style.transform = `translate3d(${drag.dx}px,${drag.dy}px,0)`; });
        const end = () => {
            if (!drag) return;
            const z = view.z;
            view.lon = x2lon(lon2x(view.lon, z) - drag.dx, z);
            view.lat = y2lat(lat2y(view.lat, z) - drag.dy, z);
            drag = null;
            layout();
        };
        host.addEventListener('pointerup', end);
        host.addEventListener('pointercancel', end);
        layout();
        return {
            layout,
            zoom(d) { view.z = Math.max(3, Math.min(18, view.z + d)); layout(); },
            home() { view.lat = car.lat; view.lon = car.lon; layout(); },
            key: `${car.lat},${car.lon}`
        };
    }

    function renderMap() {
        const loc = state && state.location;
        const s = (state && state.settings) || {};
        if (!loc) {
            map = null;
            els.body.innerHTML = '<div class="lps-scr"><div class="lps-empty">The car has not reported where it is yet. Tap Locate to ask it.</div></div>';
            return;
        }
        const key = `${loc.lat},${loc.lon}`;
        const info = `<div class="lps-pad-row"><span>${loc.place ? `At ${esc(loc.place)}` : 'Position'}</span><b>${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}</b></div>
            <div class="lps-pad-row"><span>${st() && st().engine ? 'Reported' : 'Parked since'}</span><b>${esc(when(st() && !st().engine && state.parkedSince ? state.parkedSince : loc.at || loc.readAt))}</b></div>`;
        if (map && map.key === key && els.body.querySelector('.lps-map')) { els.body.querySelector('.lps-pad').innerHTML = info; return; }
        els.body.innerHTML = `<div class="lps-scr is-map"><div class="lps-map"></div>
            <div class="lps-map-zoom"><button type="button" class="lps-key" data-act="zin" aria-label="Zoom in">+</button><button type="button" class="lps-key" data-act="zout" aria-label="Zoom out">&minus;</button><button type="button" class="lps-key" data-act="centre" aria-label="Centre on the car">${I.find}</button></div>
            <div class="lps-map-credit">Map: Esri</div></div>
            <div class="lps-pad">${info}</div>`;
        const places = [];
        if (s.home) places.push({ ...s.home, letter: 'H' });
        if (s.work) places.push({ ...s.work, letter: 'W' });
        map = TileMap(els.body.querySelector('.lps-map'), loc, places);
    }

    // ---------------------------------------------------------------- settings

    const placeText = (p) => (p ? `${p.lat}, ${p.lon}` : '');
    function placeFrom(text) {
        const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(text || ''));
        return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
    }

    function formOf() {
        if (form) return form;
        const s = (state && state.settings) || {};
        form = {
            name: s.name || '',
            home: s.homeOwn ? placeText(s.home) : '',
            work: s.workOwn ? placeText(s.work) : '',
            workDays: (s.workDays || [1, 2, 3, 4, 5]).slice(),
            leaveHome: s.leaveHome || '',
            leaveWork: s.leaveWork || '',
            commuteMiles: s.commuteMiles ? String(s.commuteMiles) : '',
            autoClimate: s.autoClimate !== false,
            runMinutes: s.runMinutes || 10,
            todayDirect: todayDirect(),
            lockRemindMin: s.lockRemindMin || 10,
            lowFuelPct: s.lowFuelPct || 20,
            reservePct: s.reservePct == null ? 15 : s.reservePct,
            tankGal: String(s.tankGal || ''),
            mpg: String(s.mpg || ''),
            notify: Object.assign({ unlocked: true, lowFuel: true, refuel: true, service: true, health: true, battery12: true, tire: true, brake: true, washer: true, key: true }, s.notify || {}),
            tireLowPsi: s.tireLowPsi || 26,
            batteryLowPct: s.batteryLowPct || 0,
            climate: Object.assign({ comfort: 74, coldAt: 33, hotAt: 95, seatHeatBelow: 56, seatCoolAbove: 76, defrostBelow: 41, wheel: true, seats: true }, s.climate || {})
        };
        // each health alert has its own box now (Nov 21 2026); the first version's one "Vehicle health" switch turned off
        // reads as all five off, and the form saves them by item with the master on
        if (form.notify.health === false) HEALTH_ITEMS.forEach(([k]) => { form.notify[k] = false; });
        form.notify.health = true;
        return form;
    }
    // the health alerts that can be switched off by themselves (lapisService NOTIFY_KEYS)
    const HEALTH_ITEMS = [['battery12', 'The 12 V battery is low'], ['tire', 'A tire is low'], ['brake', 'Brake fluid is low'], ['washer', 'Washer fluid is low'], ['key', 'The smart key battery is low']];

    const MINUTES = [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes']];
    const RUNS = [[3, '3 minutes'], [5, '5 minutes'], [8, '8 minutes'], [10, '10 minutes']];
    const LOWS = [[10, '10%'], [15, '15%'], [20, '20%'], [25, '25%'], [30, '30%']];
    const RESERVES = [[5, '5%'], [10, '10%'], [15, '15%'], [20, '20%'], [25, '25%']];
    const SUPERS = [['fuel', 'Fuel miles left'], ['issue', 'Issue indicator'], ['lock', 'Lock state'], ['none', 'Nothing']];
    const BATTS = [[0, 'the car\'s own warning level'], [50, '50%'], [60, '60%'], [65, '65%'], [70, '70%'], [75, '75%']];
    const PSIS = [[22, '22 psi'], [24, '24 psi'], [26, '26 psi'], [28, '28 psi'], [30, '30 psi'], [32, '32 psi']];
    const degs = (list) => list.map((v) => [v, `${v}°F`]);
    const CL = {
        comfort: degs([68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78]),
        coldAt: degs([15, 20, 25, 30, 33, 36, 40, 45]),
        hotAt: degs([85, 90, 95, 100, 105]),
        seatHeatBelow: degs([45, 50, 53, 56, 60, 65]),
        seatCoolAbove: degs([70, 73, 76, 80, 85]),
        defrostBelow: degs([32, 35, 38, 41, 45, 50])
    };
    const comboLabel = (list, v) => (list.find(([x]) => String(x) === String(v)) || [v, `${v}°F`])[1];

    function renderSettings() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const box = els.body;
        box.className = 'lps-layer-body wm-pg-scroll wm-form lps-settings';
        box.dataset.for = 'settings';
        if (!ui) { box.innerHTML = '<p>Settings are not available.</p>'; return; }
        const f = formOf();
        const s = (state && state.settings) || {};
        const label = (list, v) => (list.find(([x]) => String(x) === String(v)) || list[0])[1];
        const inUse = (p, own) => (p ? `In use: ${p.label ? `${p.label} ` : ''}(${p.lat}, ${p.lon})${own ? '' : ', from Melaton Traffic'}` : 'Not set. Leave blank to use Melaton Traffic\'s place.');
        box.innerHTML = `
            ${ui.sub('Car')}
            ${configured() ? '' : ui.note('No BlueLink account is saved yet: add it in Dreamscape CardSpace > Service keys > Hyundai BlueLink (e-mail, password and PIN).')}
            ${ui.note('The name shows in the title bar in place of "Lapis Remote". Blank uses the car\'s BlueLink name.')}
            ${ui.row('Name:', ui.edit('lpsName', f.name, `placeholder="${esc((state && state.vehicle && state.vehicle.name) || 'Car')}" data-k="name" maxlength="40"`), { for: 'lpsName' })}
            <div class="lps-pic"><img src="${esc(carSrc(false))}" alt=""><div>${ui.buttons([['picChoose', 'Choose Picture...'], ['picReset', 'Built-in Picture', !picture.rev]], false)}</div></div>
            ${ui.row('Today shows:', ui.comboHtml('todaySuper', label(SUPERS, todaySuperPref())), { wide: true })}
            ${ui.note('The small text beside the name on the 6.5 home screen (this phone only). A running remote start shows its time left and an unlocked car shows "unlocked", whatever is chosen.')}
            ${ui.gap()}
            ${ui.sub('Places')}
            ${ui.row('Home:', ui.edit('lpsHome', f.home, 'placeholder="latitude, longitude" data-k="home" maxlength="40"'), { for: 'lpsHome' })}
            ${ui.note(inUse(s.home, s.homeOwn))}
            ${ui.row('Work:', ui.edit('lpsWork', f.work, 'placeholder="latitude, longitude" data-k="work" maxlength="40"'), { for: 'lpsWork' })}
            ${ui.note(inUse(s.work, s.workOwn))}
            ${ui.buttons([['hereHome', 'Car is at Home', !(state && state.location)], ['hereWork', 'Car is at Work', !(state && state.location)]], false)}
            ${ui.gap()}
            ${ui.sub('Work schedule')}
            <div class="lps-days">${DAY_SHORT.map((n, i) => ui.check(`lpsDay${i}`, n, f.workDays.includes(i), `data-day="${i}"`)).join('')}</div>
            ${ui.row('Leave home:', ui.edit('lpsLeaveHome', f.leaveHome, 'placeholder="07:30 (24 hour)" data-k="leaveHome" maxlength="5" inputmode="numeric"'), { for: 'lpsLeaveHome' })}
            ${ui.row('Leave work:', ui.edit('lpsLeaveWork', f.leaveWork, 'placeholder="17:00 (24 hour)" data-k="leaveWork" maxlength="5" inputmode="numeric"'), { for: 'lpsLeaveWork' })}
            ${ui.row('Commute:', ui.edit('lpsCommute', f.commuteMiles, 'placeholder="miles each way (blank: worked out)" data-k="commuteMiles" maxlength="6" inputmode="decimal"'), { for: 'lpsCommute' })}
            ${ui.note('Work days and the commute set the miles expected each day until the record has that weekday\'s own history. Blank days and times follow Melaton Traffic.')}
            ${ui.gap()}
            ${ui.sub('Remote start')}
            ${ui.check('lpsAuto', 'Choose the climate from the weather at the car', f.autoClimate, 'data-k="autoClimate"')}
            ${ui.row('Run for:', ui.comboHtml('runMinutes', label(RUNS, f.runMinutes)), { wide: true })}
            ${ui.check('lpsTodayDirect', 'Remote Start directly from the Today screen', f.todayDirect, 'data-k="todayDirect"')}
            ${ui.note('Start on the Today screen asks first, then starts the car without opening Lapis Remote (this phone only).')}
            ${ui.gap()}
            ${ui.sub('Automatic climate')}
            ${ui.note('The set temperature slides between these points by itself; nothing is a fixed step. "Cabin" is the estimate: the outdoor temperature plus what the sun adds.')}
            ${ui.row('When mild, set:', ui.comboHtml('cl-comfort', comboLabel(CL.comfort, f.climate.comfort)), { wide: true })}
            ${ui.row('Warmest (HI) at:', ui.comboHtml('cl-coldAt', `${comboLabel(CL.coldAt, f.climate.coldAt)} cabin or colder`), { wide: true })}
            ${ui.row('Coolest (LO) at:', ui.comboHtml('cl-hotAt', `${comboLabel(CL.hotAt, f.climate.hotAt)} cabin or hotter`), { wide: true })}
            ${ui.check('lpsClSeats', 'Heat and cool the driver\'s seat', f.climate.seats, 'data-c="seats"')}
            ${ui.row('Seat heat under:', ui.comboHtml('cl-seatHeatBelow', comboLabel(CL.seatHeatBelow, f.climate.seatHeatBelow)), { wide: true })}
            ${ui.row('Seat cooling from:', ui.comboHtml('cl-seatCoolAbove', comboLabel(CL.seatCoolAbove, f.climate.seatCoolAbove)), { wide: true })}
            ${ui.check('lpsClWheel', 'Heat the steering wheel with the seat (rear glass and mirrors when coldest)', f.climate.wheel, 'data-c="wheel"')}
            ${ui.row('Defrost under:', ui.comboHtml('cl-defrostBelow', comboLabel(CL.defrostBelow, f.climate.defrostBelow)), { wide: true })}
            ${ui.note(`As saved: ${((state && state.climatePreview) || []).filter((p) => [25, 45, 66, 85, 105].includes(p.est)).map((p) => `${p.est}°F cabin sets ${tempText(p.temp, state.limits)}`).join(', ')}.`)}
            ${ui.buttons([['clDefaults', 'Use the Defaults']], false)}
            ${ui.gap()}
            ${ui.sub('Notifications')}
            ${ui.check('lpsNUn', 'The car was left unlocked', f.notify.unlocked, 'data-n="unlocked"')}
            ${ui.row('After:', ui.comboHtml('lockRemindMin', label(MINUTES, f.lockRemindMin)), { wide: true })}
            ${ui.check('lpsNLow', 'Fuel is low', f.notify.lowFuel, 'data-n="lowFuel"')}
            ${ui.row('Below:', ui.comboHtml('lowFuelPct', label(LOWS, f.lowFuelPct)), { wide: true })}
            ${ui.check('lpsNRe', 'It is the day to refuel', f.notify.refuel, 'data-n="refuel"')}
            ${ui.row('Reserve:', ui.comboHtml('reservePct', label(RESERVES, f.reservePct)), { wide: true })}
            ${ui.check('lpsNSv', 'Maintenance is coming up or due', f.notify.service, 'data-n="service"')}
            ${HEALTH_ITEMS.map(([k, label]) => ui.check(`lpsNH-${k}`, label, f.notify[k] !== false, `data-n="${k}"`)).join('')}
            ${ui.row('12 V under:', ui.comboHtml('batteryLowPct', label(BATTS, f.batteryLowPct)), { wide: true })}
            ${ui.row('A tire under:', ui.comboHtml('tireLowPsi', label(PSIS, f.tireLowPsi)), { wide: true })}
            ${ui.note('Alerts that come up together are one notification. They wait while the car is running and for 30 minutes after it was driven; the car left unlocked is said on its own time. An alert is said again if it gets worse. A tire also counts as low when the car\'s own lamp is on or it is 4 psi under the other three.')}
            ${ui.gap()}
            ${ui.sub('Fuel')}
            ${ui.row('Tank:', ui.edit('lpsTank', f.tankGal, 'placeholder="gallons" data-k="tankGal" maxlength="5" inputmode="decimal"'), { for: 'lpsTank' })}
            ${ui.row('Rated mpg:', ui.edit('lpsMpg', f.mpg, 'data-k="mpg" maxlength="5" inputmode="decimal"'), { for: 'lpsMpg' })}
            ${ui.note('The rated figure is used until the record has measured the car\'s own.')}
            ${ui.note('Maintenance intervals are set item by item: Menu > Maintenance, then tap an item.')}`;
        box.querySelectorAll('input.wm-edit[data-k]').forEach((el) => el.addEventListener('input', () => { f[el.dataset.k] = el.value; }));
        box.querySelectorAll('input[data-day]').forEach((el) => el.addEventListener('change', () => {
            const d = Number(el.dataset.day);
            f.workDays = el.checked ? [...new Set(f.workDays.concat(d))].sort() : f.workDays.filter((x) => x !== d);
        }));
        box.querySelectorAll('input[data-n]').forEach((el) => el.addEventListener('change', () => { f.notify[el.dataset.n] = el.checked; }));
        const auto = box.querySelector('input[data-k="autoClimate"]');
        auto.addEventListener('change', () => { f.autoClimate = auto.checked; });
        const direct = box.querySelector('input[data-k="todayDirect"]');
        direct.addEventListener('change', () => { f.todayDirect = direct.checked; });
        const combo = (act, list) => ui.bindCombo(box.querySelector(`[data-act="${act}"]`), list, f[act], (v) => { f[act] = Number(v); });
        combo('runMinutes', RUNS);
        combo('lockRemindMin', MINUTES);
        combo('lowFuelPct', LOWS);
        combo('reservePct', RESERVES);
        combo('batteryLowPct', BATTS);
        ui.bindCombo(box.querySelector('[data-act="todaySuper"]'), SUPERS, todaySuperPref(), (v) => { try { localStorage.setItem(LS_SUPER, v); } catch (_) { /* private mode */ } todayChanged(); });
        combo('tireLowPsi', PSIS);
        box.querySelectorAll('input[data-c]').forEach((el) => el.addEventListener('change', () => { f.climate[el.dataset.c] = el.checked; }));
        Object.keys(CL).forEach((k) => {
            const tail = k === 'coldAt' ? ' cabin or colder' : k === 'hotAt' ? ' cabin or hotter' : '';
            ui.bindCombo(box.querySelector(`[data-act="cl-${k}"]`), CL[k].map(([v, l]) => [v, `${l}${tail}`]), f.climate[k], (v) => { f.climate[k] = Number(v); });
        });
        box.querySelectorAll('.wm-button[data-act]').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.dataset.act;
            const loc = state && state.location;
            if (act === 'picChoose') choosePicture();
            else if (act === 'clDefaults') { f.climate = { comfort: 74, coldAt: 33, hotAt: 95, seatHeatBelow: 56, seatCoolAbove: 76, defrostBelow: 41, wheel: true, seats: true }; renderSettings(); }
            else if (act === 'picReset') savePicture(null);
            else if ((act === 'hereHome' || act === 'hereWork') && loc) {
                const k = act === 'hereHome' ? 'home' : 'work';
                f[k] = `${loc.lat}, ${loc.lon}`;
                box.querySelector(`input[data-k="${k}"]`).value = f[k];
            }
        }));
    }

    // the picture comes through Melaton Mobile's own Open dialog: Dreamscape's files, the gallery, the phone's storage

    async function pickedUrl(it) {
        if (it.phoneFile && window.phoneStorage) return window.phoneStorage.fileUrl(it.phoneFile.root, it.phoneFile.path);
        const galleryFile = (it.targetKind === 'image' || it.targetKind === 'scrap') ? (it.previewImageFilename || it.targetId)
            : (it.shortcutType === 'image' && it.shortcutData && it.shortcutData.filename) || null;
        if (galleryFile) return `/images/${encodeURIComponent(galleryFile)}`;
        /* global vfsClient */
        if (it.targetKind === 'user-file' && (it.targetId || it.id) && typeof vfsClient !== 'undefined') {
            const r = await vfsClient.downloadFile(it.targetId || it.id);
            return (r && r.downloadUrl) || null;
        }
        return null;
    }

    function choosePicture() {
        if (!window.wmFileDialogs) { ws.messageBox({ title: TITLE, icon: 'error', text: 'The Open dialog is not available.' }); return; }
        const readable = (i) => !!(i && (i.phoneFile || i.targetKind === 'image' || i.targetKind === 'scrap' || (i.shortcutType === 'image' && i.shortcutData) || i.targetKind === 'user-file'));
        void window.wmFileDialogs.open({
            title: 'Choose Picture', appTitle: TITLE, typeLabel: 'Pictures', pictures: true, phone: true,
            accept: (i) => readable(i) && (i.targetKind === 'image' || i.targetKind === 'scrap' || /^image\//i.test(String(i.mimeType || '')) || /\.(png|jpe?g|webp)$/i.test(String(i.name || ''))),
            onCancel: () => { if (ws) ws.open(APP_ID); },
            onPick: async (it) => {
                let blob = null;
                try {
                    const url = await pickedUrl(it);
                    const res = url ? await fetch(url, { credentials: 'same-origin' }) : null;
                    blob = res && res.ok ? await res.blob() : null;
                } catch (_) { blob = null; }
                if (!blob) { await ws.messageBox({ title: TITLE, icon: 'error', text: `"${it.name}" could not be read.` }); return false; }
                ws.open(APP_ID);
                await savePictureFile(blob);
                return true;
            }
        });
    }

    /** The chosen picture, drawn down to 720 px wide, as a WebP data URL. */
    async function savePictureFile(file) {
        try {
            const bmp = await createImageBitmap(file);
            const k = Math.min(1, 720 / bmp.width);
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(bmp.width * k));
            cv.height = Math.max(1, Math.round(bmp.height * k));
            cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
            let url = cv.toDataURL('image/webp', 0.86);
            if (!/^data:image\/webp/.test(url)) url = cv.toDataURL('image/png');
            await savePicture(url);
        } catch (err) {
            ws.messageBox({ title: TITLE, icon: 'error', text: `The picture could not be used.\n\n${(err && err.message) || ''}`.trim() });
        }
    }

    async function savePicture(dataUrl) {
        try {
            await ws.busy(ask('lapis_picture_save', { dataUrl }, 40000), { delay: 250, timeout: 40000 });
            // the push carries the new picture revision; the form shows it once it is here
            setTimeout(() => { if (layers[layers.length - 1] === 'settings' && shown) { const img = els.body.querySelector('.lps-pic img'); if (img) img.src = carSrc(false); } }, 1200);
        } catch (err) {
            ws.messageBox({ title: TITLE, icon: 'error', text: (err && err.message) || 'The picture could not be saved.' });
        }
    }

    async function saveSettings() {
        const f = formOf();
        const s = (state && state.settings) || {};
        const bad = (text) => { ws.messageBox({ title: 'Lapis Settings', icon: 'warning', text }); };
        const next = { name: f.name.trim(), workDays: f.workDays, autoClimate: f.autoClimate, runMinutes: f.runMinutes, lockRemindMin: f.lockRemindMin, lowFuelPct: f.lowFuelPct, reservePct: f.reservePct, notify: f.notify, climate: f.climate, tireLowPsi: f.tireLowPsi, batteryLowPct: f.batteryLowPct };
        for (const k of ['home', 'work']) {
            const t = f[k].trim();
            if (!t) { if (s[`${k}Own`]) next[k] = null; continue; }
            const p = placeFrom(t);
            if (!p) { bad(`${k === 'home' ? 'Home' : 'Work'} is a position: latitude, longitude (for example 38.8977, -77.0365). "Car is at ${k === 'home' ? 'Home' : 'Work'}" fills it in.`); return; }
            next[k] = p;
        }
        for (const k of ['leaveHome', 'leaveWork']) {
            const t = f[k].trim();
            if (t && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) { bad('Times are hours and minutes on the 24 hour clock, for example 07:30.'); return; }
            next[k] = t;
        }
        next.commuteMiles = Number(f.commuteMiles) > 0 ? Number(f.commuteMiles) : null;
        if (Number(f.tankGal) > 0) next.tankGal = Number(f.tankGal);
        if (Number(f.mpg) > 0) next.mpg = Number(f.mpg);
        try {
            await ws.busy(ask('lapis_settings_save', { settings: next }), { delay: 250, timeout: 25000 });
            try { localStorage.setItem(LS_DIRECT, f.todayDirect ? '1' : '0'); } catch (_) { /* private mode */ }
            form = null;
            popLayer();
        } catch (err) {
            ws.messageBox({ title: 'Lapis Settings', icon: 'error', text: `The settings could not be saved.\n\n${(err && err.message) || ''}`.trim() });
        }
    }

    // ---------------------------------------------------------------- notices (the server raises them)

    function onNotice(pk) {
        const n = (pk && (pk.data || pk)) || {};
        if (!n.title || !canUse()) return;
        if (n.kind === 'run-left') {
            // a stale warning (the run already ended or changed) is not shown
            if (!runInfo() || (num(n.until) && state.command.runsUntil !== n.until)) return;
            if (runNote) { try { runNote.close(); } catch (_) { /* gone */ } runNote = null; }
            if (ws && typeof ws.appNote === 'function') {
                const note = ws.appNote({
                    title: n.title,
                    html: esc(n.text || ''),
                    icon: 'status-car-alert',
                    event: 'lapis-run-left',
                    softKeys: () => ({ left: isAdmin() ? { label: 'Stop', action: () => { note.close(); runNote = null; doStop(); } } : { label: 'View', action: () => { note.close(); runNote = null; open('start'); } }, right: { label: 'Dismiss', action: () => { note.close(); runNote = null; } } })
                });
                runNote = note;
                if (note) return;
            }
            if (ws && typeof ws.notify === 'function') ws.notify({ title: n.title, text: n.text || '', icon: 'info', asNote: true });
            return;
        }
        if (n.kind === 'health' && n.key) {
            // one note per alert and step, whether it came as a push or was waiting in the state
            const id = `${n.key}:${n.stamp}`;
            if (seenAlerts().includes(id)) return;
            markSeen(id);
        }
        const view = () => { if (note && note.close) note.close(); open(n.kind === 'service' ? 'service' : n.kind === 'health' ? 'status' : n.kind === 'refuel' || n.kind === 'low-fuel' ? 'history' : null); };
        const lock = () => { if (note && note.close) note.close(); send('lock'); };
        const wantsLock = (n.actions || []).includes('lock') && isAdmin();
        let note = null;
        if (ws && typeof ws.appNote === 'function') {
            note = ws.appNote({
                title: n.title,
                // several alerts in one notification: a line each (lapisService alertsNotice)
                html: esc(n.text || '').replace(/\n/g, '<br>'),
                icon: 'status-car-alert',
                // left unlocked and an issue found sound in classes of their own (#848)
                event: n.kind === 'unlocked' ? 'lapis-unlocked' : n.kind === 'health' ? 'lapis-issue' : 'notification',
                softKeys: () => ({ left: wantsLock ? { label: 'Lock', action: lock } : { label: 'View', action: view }, right: { label: 'Dismiss', action: () => { if (note) note.close(); } } })
            });
            if (note) return;
        }
        if (ws && typeof ws.notify === 'function') {
            ws.notify({ title: n.title, text: n.text || '', icon: 'warning', asNote: true, timeout: false, buttons: [wantsLock ? { text: 'Lock', type: 'primary', closeOnClick: true, onClick: lock } : { text: 'View', type: 'primary', closeOnClick: true, onClick: view }] });
        }
    }

    function wire() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        c.on('lapis_updated', (pk) => { const d = (pk && (pk.data || pk)) || {}; if (d.state) take(d.state); });
        c.on('lapis_notice', onNotice);
        c.on('connected', () => load());
        load();
        return true;
    }

    // ---------------------------------------------------------------- menus

    function about() {
        const u = state && state.usage;
        ws.messageBox({
            title: TITLE,
            icon: 'info',
            text: `Lapis Remote\nVersion 1.0\n\nCopyright © 2026 Xyridian Corporation. All rights reserved.\n\nVehicle data and commands: Hyundai BlueLink. Weather: Open-Meteo. Map: Esri.\n${u && u.recordFrom ? `The record starts ${fmtDay.format(new Date(u.recordFrom))}.` : 'The record starts with the car\'s first report.'}`
        });
    }

    function mainMenu() {
        const ok = configured();
        const s = st();
        const running = !!runInfo();
        return [
            running ? { label: 'Stop the Engine', disabled: !ok || !isAdmin(), action: doStop } : { label: 'Remote Start...', disabled: !ok || !!engineOnHead(s), action: () => openLayer('start') },
            { label: 'Find My Car', disabled: !ok, action: () => openLayer('map') },
            '-',
            { label: 'Vehicle Status', disabled: !ok, action: () => openLayer('status') },
            { label: 'Maintenance', disabled: !ok, action: () => openLayer('service') },
            { label: 'Driving Record', disabled: !ok, action: () => openLayer('history') },
            '-',
            { label: 'Settings...', disabled: !isAdmin(), action: () => openLayer('settings') },
            { label: 'About', action: about }
        ];
    }

    // ---------------------------------------------------------------- app

    function open(layer) {
        if (ws) ws.open(APP_ID);
        if (layer && LAYER_TITLES[layer]) { layers = []; openLayer(layer); }
    }

    const APP = {
        id: APP_ID,
        title: TITLE,
        icon: 'app-lapis',
        art65: 'lapis',
        inStart: 'programs',
        sip: true,
        mount(p) {
            page = p;
            p.classList.add('wm-lapis');
            build();
        },
        show() {
            shown = true;
            syncLayers();
            render();
            if (!loaded) ws.busy(load(), { delay: 250, timeout: 20000 }).catch(() => {});
        },
        hide() { shown = false; clearTimeout(holdTimer); },
        historyDepth: () => layers.length,
        onBack: () => popLayer(),
        titleKind: () => (layers.length ? 'ok' : 'close'),
        onTitleOk: () => { const top = layers[layers.length - 1]; if (top === 'settings') saveSettings(); else if (top === 'item') saveItem(); else popLayer(); },
        onTitleClose() { layers = []; map = null; draft = null; form = null; item = null; },
        softKeys() {
            const top = layers[layers.length - 1];
            if (top === 'settings') return { left: { label: 'Save', action: saveSettings }, right: { label: 'Cancel', action: () => { form = null; popLayer(); } } };
            if (top === 'item') return { left: { label: 'Save', action: saveItem }, right: { label: 'Cancel', action: () => { item = null; popLayer(); } } };
            if (top === 'service') return { left: { label: 'Done', action: popLayer }, right: { label: 'Menu', menu: () => [{ label: 'New Item...', disabled: !isAdmin(), action: () => editItem(null) }, '-', { label: 'Refresh', disabled: !isAdmin(), action: () => userRefresh(false) }] } };
            if (top === 'start') {
                const s = st();
                const running = !!runInfo();
                return {
                    left: running ? { label: 'Stop', disabled: !!busyCommand(), action: doStop } : { label: 'Start', disabled: !!busyCommand() || !isAdmin() || !!engineOnHead(s), action: startConfirm },
                    right: { label: 'Menu', menu: () => [{ label: 'Automatic Settings', disabled: !(state && state.climate), action: () => { draft = null; renderStart(); } }, '-', { label: 'Cancel', action: popLayer }] }
                };
            }
            if (top === 'map') return { left: { label: 'Locate', disabled: !isAdmin(), action: () => userRefresh(true) }, right: { label: 'Done', action: popLayer } };
            if (top) return { left: { label: 'Done', action: popLayer }, right: { label: 'Refresh', disabled: !isAdmin(), action: () => userRefresh(false) } };
            return { left: { label: 'Refresh', disabled: !canUse(), action: () => userRefresh(false) }, right: { label: 'Menu', menu: mainMenu } };
        }
    };

    // ---------------------------------------------------------------- Today (6.1 row, 6.5 panel)

    function todayLine() {
        const s = st();
        if (!configured()) return { title: 'Lapis Remote', sub: 'Tap to set up your car' };
        if (!s) return { title: (state && state.vehicle && state.vehicle.name) || 'Lapis Remote', sub: 'Waiting for the car\'s report' };
        const cmd = busyCommand();
        const head = cmd ? `${{ lock: 'Locking', unlock: 'Unlocking', start: 'Starting', stop: 'Stopping' }[cmd.kind]}...` : s.engine ? (runInfo() && runInfo().until ? `Running, ${leftShort(runInfo().until - Date.now())} left` : engineOnHead(s)) : s.locked === false ? 'Unlocked' : 'Locked';
        const rt = refuelText();
        const c = state.climate;
        const sub = [rt && rt !== 'Not for weeks' ? `Gas ${refuelText(true)}` : '', c && num(c.outdoorF) ? `${Math.round(c.outdoorF)}°F` : ''].filter(Boolean).join(' · ');
        return { title: `${head} · ${num(s.range) ? `${Math.round(s.range)} mi` : num(s.fuel) ? `${Math.round(s.fuel)}%` : ''}`, sub, unlocked: s.locked === false, running: !!s.engine };
    }

    // the 6.5 panel's name (the model's first word, else "car") and the small text beside it
    const LS_SUPER = 'wmLapisTodaySuper'; // fuel | issue | lock | none (this phone's choice)
    // Settings > Remote start directly from the Today screen (this phone's choice): Today's Start asks
    // "Start the car ...?" and starts it there, without opening Lapis Remote
    const LS_DIRECT = 'wmLapisTodayDirect';
    const todayDirect = () => { try { return localStorage.getItem(LS_DIRECT) === '1'; } catch (_) { return false; } };
    /** Today's Start: the question and the start right there, or the Remote Start screen. */
    function todayStart() {
        if (todayDirect() && isAdmin() && configured() && !busyCommand()) { draft = null; startConfirm(); }
        else open('start');
    }
    const todaySuperPref = () => { try { const v = localStorage.getItem(LS_SUPER); return ['fuel', 'issue', 'lock', 'none'].includes(v) ? v : 'fuel'; } catch (_) { return 'fuel'; } };
    function todayName() {
        const v = state && state.vehicle;
        const word = v && v.model ? String(v.model).trim().split(/\s+/)[0].toLowerCase() : '';
        return word || 'car';
    }
    function todaySuper() {
        const s = st();
        if (!s) return '';
        // a running remote start and an unlocked car come first, whatever is chosen
        const r = runInfo();
        if (r) return r.until ? leftShort(r.until - Date.now()) : 'running';
        if (s.locked === false && !s.engine) return 'unlocked';
        const pref = todaySuperPref();
        const issues = ((state && state.alerts) || []).length;
        if (pref === 'issue') return issues ? '!' : '';
        if (pref === 'lock') return s.locked ? 'locked' : s.locked === false ? 'unlocked' : '';
        if (pref === 'fuel') return num(s.range) ? `${Math.round(s.range)} mi` : num(s.fuel) ? `${Math.round(s.fuel)}%` : '';
        return '';
    }

    /**
     * The car's half of Today's Traffic and Car item (#1041; wmTraffic.js owns the item and lays out both halves):
     * { html (the car, its two lines, Lock / Start keys), t (todayLine) } or null when the car shows nothing here.
     */
    function todayPart() {
        if (!canUse()) return null;
        if (!loaded) { if (!wired) wire(); return null; }
        if (!configured() && !isAdmin()) return null;
        const t = todayLine();
        const keys = configured() && isAdmin()
            ? `<button type="button" class="lps-today-key${t.unlocked ? ' is-warn' : ''}" data-today="lock" aria-label="${t.unlocked ? 'Lock' : 'Unlock'}">${t.unlocked ? I.unlock : I.lock}</button><button type="button" class="lps-today-key${t.running ? ' is-warn' : ''}" data-today="start" aria-label="Remote start">${I.power}</button>`
            : '';
        return { t, html: `<img class="lps-today-car" src="${esc(carSrc(true))}" alt="" draggable="false"><span class="wtw-lines"><span class="wtw-title">${esc(t.title)}</span><span class="wtw-sub">${esc(t.sub)}</span></span>${keys}` };
    }

    /** A tap on the car's half of the Today item: its Lock / Start keys, else Lapis Remote. */
    function todayTap(e) {
        const k = e && e.target && e.target.closest ? e.target.closest('[data-today]') : null;
        if (!k) { open(); return; }
        e.stopPropagation();
        if (k.dataset.today === 'lock') { const s = st(); if (s && s.locked === false) send('lock'); else if (s && s.locked) doUnlock(); else open(); }
        else if (k.dataset.today === 'start') { const s = st(); if (runInfo()) doStop(); else if (s && s.engine) open(); else todayStart(); }
    }

    function todayTitanium() {
        if (!canUse() || !loaded) return null;
        const t = todayLine();
        const s = st();
        const go = () => open();
        if (!configured() || !s) return { label: todayName(), icon: 'x:app-lapis-lg', pages: [{ title: t.title, line2: t.sub, line3: '' }], softKey: { label: 'Lapis', action: go }, onTap: go };
        const c = state.climate;
        const sv = nextService();
        const admin = isAdmin();
        const lockKey = !admin ? { label: 'Lapis', action: go } : s.locked === false ? { label: 'Lock', action: () => send('lock') } : { label: 'Unlock', action: doUnlock };
        // a remote start on its timer (Stop); the engine on otherwise (driven: no Start, no Stop); or ready to start
        const run = runInfo();
        const onHead = engineOnHead(s);
        const where = state.location && state.location.place;
        const keyPage = run
            ? { icon: 'x:lapis-key-lg', title: `Running, ${leftShort(run.until - Date.now())} left`, line2: c ? `Outside ${Math.round(c.outdoorF)}°F, cabin about ${Math.round(c.interiorF)}°F` : '', line3: `Stops by itself at ${clock(run.until)}`, softKey: admin ? { label: 'Stop', action: doStop } : { label: 'Lapis', action: go }, onTap: () => open('start') }
            : onHead
                ? { icon: 'x:lapis-key-lg', title: onHead, line2: c ? `Outside ${Math.round(c.outdoorF)}°F` : '', line3: 'Remote start when parked', softKey: { label: 'Lapis', action: go }, onTap: go }
                : { icon: 'x:lapis-key-lg', title: `Remote start: ${climateLine() || 'ready'}`, line2: c ? `Outside ${Math.round(c.outdoorF)}°F, cabin about ${Math.round(c.interiorF)}°F` : '', line3: `Runs ${(state.settings && state.settings.runMinutes) || 10} minutes`, softKey: admin ? { label: 'Start', action: todayStart } : { label: 'Lapis', action: go }, onTap: () => open('start') };
        const pages = [
            { icon: 'x:app-lapis-lg', title: t.title, line2: t.sub, line3: where && !s.engine ? `Parked at ${where}` : '', softKey: lockKey, onTap: go },
            keyPage
        ];
        if (sv) pages.push({ icon: 'x:lapis-wrench-lg', title: sv.label, line2: sv.milesLeft <= 0 ? `${Math.abs(sv.milesLeft).toLocaleString()} miles over` : `in ${sv.milesLeft.toLocaleString()} miles`, line3: '', softKey: { label: 'Service', action: () => open('service') }, onTap: () => open('service') });
        return { label: todayName(), count: todaySuper(), icon: 'x:app-lapis-lg', pages, softKey: lockKey, onTap: go };
    }

    // ---------------------------------------------------------------- register

    function register() {
        ws = window.wmShell;
        if (!ws) return;
        ws.registerApp(APP);
        // no Today item of its own: the car is half of Traffic's (#1041, wmTraffic.js reads window.wmLapis.today);
        // a running start's minutes left come from its own tick (onTick), not the shell's minute
        // websocket.js (window.wsClient) loads with the page, before this file; should it not have, every script has run by 'load'
        if (!wire()) window.addEventListener('load', () => { wire(); }, { once: true, signal: appScopeSignal });
    }

    window.wmLapis = {
        open,
        /**
         * The car's half of Today's Traffic and Car item (#1041): part() -> { html, t } | null for the 6.1 row,
         * tap(event) for a tap on it, panel() -> the 6.5 panel (the car's own pages) | null, line() -> todayLine().
         */
        today: { part: todayPart, tap: todayTap, panel: todayTitanium, line: todayLine },
        state: () => state,
        /** A running remote start for the shell's title-bar glyph: { running, until, title, html, canStop }. */
        statusState,
        stop: () => doStop(),
        /** A remote start can be offered from elsewhere (Traffic's title-bar car): set up, admin, not already running. */
        canStart: () => !!(isAdmin() && configured() && !busyCommand() && !runInfo() && !(st() && st().engine)),
        /** "Start the car for N minutes at T?" then the remote start with the automatic climate. */
        startPrompt: () => { draft = null; startConfirm(); },
        /** Read what the server holds again (lapis_get). */
        reload: () => load(),
        /** What the server knows of the car for the car key's bubble (#874): { name, lines[] } or null. */
        keySummary: () => {
            if (!canUse() || !configured()) return null;
            const s = st();
            if (!s) return { name: carTitle(), lines: [] };
            const t = todayLine();
            return { name: carTitle(), lines: [t.title, t.sub].filter(Boolean) };
        },
        /**
         * The car for the title bar's Car bubble (#902), as data: { name, report, locked (true | false | null),
         * range, fuel (numbers or null), gas (when to refuel, '' when not soon), sets (what a remote start sets
         * now: "72°F, seat heat"), minutes, busy (the command on its way or null), canStart, canStop,
         * run: null | { until, total, sets } } or null when Lapis is not set up here.
         */
        carData: () => {
            if (!canUse() || !configured()) return null;
            const s = st();
            const lim = (state && state.limits) || { tempMin: 62, tempMax: 82 };
            const auto = !!(state && state.climate && state.settings && state.settings.autoClimate);
            const d = { temp: auto ? state.climate.temp : 72, minutes: (state && state.settings && state.settings.runMinutes) || 10 };
            const tt = tempText(Math.min(lim.tempMax, Math.max(lim.tempMin, d.temp)), lim);
            const sets = auto ? (climateLine() || `${tt}°F`) : `${tt}${/^\d/.test(tt) ? '°F' : ''}`;
            const rt = refuelText();
            const r = runInfo();
            const cmd = busyCommand();
            return {
                name: carTitle(),
                report: !!s,
                locked: s ? (s.locked === false ? false : s.locked ? true : null) : null,
                range: s && num(s.range) ? Math.round(s.range) : null,
                fuel: s && num(s.fuel) ? Math.round(s.fuel) : null,
                gas: rt && rt !== 'Not for weeks' ? refuelText(true) : '',
                sets,
                minutes: d.minutes,
                busy: cmd ? cmd.kind : null,
                canStart: !!(isAdmin() && !cmd && !r && !(s && s.engine)),
                canStop: !!(isAdmin() && r),
                run: r ? { until: r.until, total: r.total, sets: runSets(r.detail) } : null
            };
        },
        /** Lock / Unlock from elsewhere (the car key's bubble), with Unlock's question. */
        lock: () => send('lock'),
        unlock: () => doUnlock()
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
