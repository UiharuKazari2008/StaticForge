/**
 * Melaton Mobile: Lapis Remote (Yozora #835). Yukimi, Nov 14 2026: "a polished 2010-era luxury car
 * remote control and status viewer", a front end for Hyundai BlueLink: remote start with a climate
 * setting chosen from the weather, status, maintenance, forgot-to-lock and low-fuel notices, the day
 * to refuel by, the car on a map, and a Today item with controls (6.1 and 6.5).
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

    const MOBILE = window.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');
    if (!MOBILE) return;

    const APP_ID = 'lapis';
    const TITLE = 'Lapis Remote';
    const CAR_ART = '/static_images/lapis/car.webp';
    const CAR_ART_SM = '/static_images/lapis/car-sm.webp';
    const LAYER_TITLES = { start: 'Remote Start', map: 'Find My Car', status: 'Vehicle Status', service: 'Maintenance', item: 'Maintenance Item', history: 'Driving Record', settings: 'Lapis Settings' };
    const TILE = 256;
    const HOLD_MS = 1100;
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
    let todayHtml = '';

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
        wrench: L('<path d="M12.500 3a4 4 0 0 0-3.700 5.500L3 14.300 5.700 17l5.800-5.800A4 4 0 0 0 17 7.500l-2.500 2.500-2-.5-.5-2z"/>'),
        hood: L('<path d="M2.500 14h15M3.500 14c0-3 2-5 6.500-5s6.500 2 6.500 5M6 9.500 9 5h5"/>'),
        drop: L('<path d="M10 3c3 4 4.500 6.300 4.500 8.500a4.500 4.500 0 0 1-9 0C5.500 9.300 7 7 10 3z"/>'),
        key: L('<circle cx="6.500" cy="10" r="3"/><path d="M9.500 10H17M14 10v2.500M16.500 10v2"/>'),
        road: L('<path d="M6 17 8 3M14 17 12 3M10 4v2M10 9v2M10 14v2"/>'),
        clock: L('<circle cx="10" cy="10" r="6.500"/><path d="M10 6v4l2.500 2"/>'),
        warn: L('<path d="M10 3 18 16.500H2zM10 8v4.500"/><circle cx="10" cy="14.500" r=".4"/>', 1.5),
        arrow: '<svg class="lps-arrow" viewBox="0 0 44 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M1 5h41M38 1.500 42 5l-4 3.500"/></svg>',
        gem: '<svg class="lps-gem" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 .8 13 5 7 13.200 1 5z" fill="#2447c9" stroke="#dfe4ea" stroke-width=".9"/><path d="M4.500 5 7 .8 9.500 5z" fill="#9db8ff"/><path d="M1 5h12M4.500 5 7 13.200 9.500 5" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".5"/></svg>',
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

    const carSrc = (small) => picture.url || (small ? CAR_ART_SM : CAR_ART);

    function changed() {
        todayHtml = '';
        if (shown) render(); else stale = true;
        if (ws && typeof ws.refreshToday === 'function') ws.refreshToday();
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

    function parkLine() {
        const s = st();
        if (!s) return { dot: 'warn', head: configured() ? 'No report yet' : 'Not set up', tail: '' };
        const cmd = busyCommand();
        if (cmd) return { dot: 'busy', head: { lock: 'Locking', unlock: 'Unlocking', start: 'Starting', stop: 'Stopping' }[cmd.kind] || 'Sending', tail: 'waiting for the car' };
        const place = state.location && state.location.place;
        if (s.engine) return { dot: 'run', head: s.climate ? 'Running' : 'Engine on', tail: place ? `at ${place}` : '' };
        return { dot: 'ok', head: 'Parked', tail: place ? `at ${place}` : state.parkedSince ? `for ${sinceText(state.parkedSince)}` : '' };
    }

    function refuelText() {
        const u = state && state.usage;
        const r = u && u.refuel;
        if (!r) return '';
        if (r.beyond) return 'Not for weeks';
        return dayLabel(r.day, u.today);
    }

    function nextService() {
        const list = (state && state.maintenance) || [];
        const withMiles = list.filter((m) => m.milesLeft !== null);
        if (!withMiles.length) return null;
        return withMiles.slice().sort((a, b) => a.milesLeft - b.milesLeft)[0];
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

    // ---------------------------------------------------------------- commands

    function needAdmin() {
        if (isAdmin()) return true;
        ws.messageBox({ title: TITLE, icon: 'info', text: 'Only the administrator can control the car.' });
        return false;
    }

    async function send(kind, options) {
        if (!needAdmin()) return false;
        if (!configured()) { openLayer('settings'); return false; }
        if (busyCommand()) { ws.messageBox({ title: TITLE, icon: 'info', text: 'The car is still answering the last command.' }); return false; }
        try {
            await ws.busy(ask('lapis_command', { kind, options: options || {} }, 60000), { delay: 250, timeout: 60000 });
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
                <div class="lps-plate">${I.gem}<span class="lps-wm">LAPIS</span><span class="lps-car-name"></span><span class="lps-updated"></span></div>
                <div class="lps-scroll">
                    <div class="lps-scr lps-hero" data-open="status">
                        <div class="lps-sbar"><i class="lps-dot"></i><b class="lps-park"></b><span class="lps-where"></span><span class="lps-sp"></span><span class="lps-odo"></span></div>
                        <div class="lps-stage"><img class="lps-carimg" alt="" draggable="false" decoding="async"><div class="lps-horizon"></div><span class="lps-pill is-l lps-p-lock"></span><span class="lps-pill is-r lps-p-eng"></span></div>
                    </div>
                    <div class="lps-scr">
                        <div class="lps-cards">
                            <div class="lps-card lps-c-fuel" data-open="history" role="button"></div>
                            <div class="lps-card lps-c-clim" data-open="start" role="button"></div>
                        </div>
                        <div class="lps-tiles" data-open="status"></div>
                    </div>
                    <div class="lps-pad"></div>
                </div>
                <div class="lps-cmd">
                    <button type="button" class="lps-key" data-cmd="lock"><span class="lps-led"><i></i></span>${I.lock}<span>Lock</span></button>
                    <button type="button" class="lps-key" data-cmd="unlock"><span class="lps-led"><i></i></span>${I.unlock}<span>Unlock</span></button>
                    <button type="button" class="lps-go" data-cmd="start"><span>ENGINE<br>START<br>STOP</span></button>
                    <button type="button" class="lps-key" data-cmd="find"><span class="lps-led"><i></i></span>${I.find}<span>Find</span></button>
                </div>
                <div class="lps-layer" hidden><div class="lps-layer-body"></div></div>
            </div>`;
        const q = (s) => page.querySelector(s);
        els = {
            root: q('.lps-root'), name: q('.lps-car-name'), updated: q('.lps-updated'), dot: q('.lps-dot'), park: q('.lps-park'), where: q('.lps-where'), odo: q('.lps-odo'),
            img: q('.lps-carimg'), pLock: q('.lps-p-lock'), pEng: q('.lps-p-eng'), fuel: q('.lps-c-fuel'), clim: q('.lps-c-clim'), tiles: q('.lps-tiles'), pad: q('.lps-pad'),
            cmd: q('.lps-cmd'), layer: q('.lps-layer'), body: q('.lps-layer-body')
        };
        q('.lps-scroll').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openLayer(b.dataset.open); });
        els.cmd.addEventListener('click', (e) => {
            const b = e.target.closest('[data-cmd]');
            if (!b || b.disabled) return;
            const c = b.dataset.cmd;
            if (c === 'lock') send('lock');
            else if (c === 'unlock') doUnlock();
            else if (c === 'find') openLayer('map');
            else if (c === 'start') { const s = st(); if (s && s.engine && s.climate) doStop(); else openLayer('start'); }
        });
        els.body.addEventListener('click', onLayerClick);
        document.addEventListener('visibilitychange', () => { if (els) els.root.classList.toggle('is-paused', document.hidden); });
    }

    // ---------------------------------------------------------------- main page

    function render() {
        if (!els || !shown) { stale = true; return; }
        stale = false;
        const s = st();
        const lim = state && state.limits;
        const v = state && state.vehicle;
        els.name.textContent = (v && v.name) || 'No vehicle';
        els.updated.textContent = s && s.at ? when(s.at) : '';
        const pl = parkLine();
        els.dot.dataset.s = pl.dot;
        els.park.textContent = pl.head;
        els.where.textContent = pl.tail;
        els.odo.textContent = s && num(s.odometer) ? miles(s.odometer) : '';
        const src = carSrc(false);
        if (els.img.getAttribute('src') !== src) els.img.src = src;

        const locked = s ? s.locked : null;
        els.pLock.className = `lps-pill is-l lps-p-lock${locked === false ? ' is-warn' : ''}`;
        els.pLock.innerHTML = `${locked === false ? I.unlock : I.lock}${locked === null ? 'Unknown' : locked ? 'Locked' : 'Unlocked'}`;
        const cmd = state && state.command;
        const running = !!(s && s.engine);
        els.pEng.className = `lps-pill is-r lps-p-eng${running ? ' is-on' : ''}`;
        els.pEng.innerHTML = `${I.power}${!s ? 'No report' : running ? (cmd && cmd.runsUntil && cmd.runsUntil > Date.now() ? `Until ${clock(cmd.runsUntil)}` : s.climate ? 'Climate on' : 'Engine on') : 'Engine off'}`;

        // fuel
        const u = state && state.usage;
        const low = s && (s.fuelLow === true || (num(s.fuel) && state.settings && s.fuel <= state.settings.lowFuelPct));
        const rt = refuelText();
        els.fuel.innerHTML = `<div class="lps-card-l">${I.fuel}Fuel</div>
            <div class="lps-card-v">${s && num(s.range) ? Math.round(s.range) : '--'}<small>mi</small></div>
            <div class="lps-bar${low ? ' is-low' : ''}"><i style="transform:scaleX(${s && num(s.fuel) ? Math.max(0.02, Math.min(1, s.fuel / 100)) : 0})"></i></div>
            <div class="lps-card-s"><span>${s && num(s.fuel) ? `${Math.round(s.fuel)}%` : ''}</span><span>${rt ? `Refuel by <b>${esc(rt === 'Today' || rt === 'Tomorrow' ? rt : rt.split(',')[0])}</b>` : ''}</span></div>`;

        // climate: what a remote start would set, and the weather it is based on
        const c = state && state.climate;
        const tt = c ? tempText(c.temp, lim) : '--';
        els.clim.innerHTML = `<div class="lps-card-l">${I.fan}Climate${state && state.settings && state.settings.autoClimate ? ' · Auto' : ''}</div>
            <div class="lps-card-v">${tt}${/^\d/.test(tt) ? '<small>°F</small>' : ''}</div>
            <div class="lps-card-s"><span>Outside</span><b>${c && num(c.outdoorF) ? `${Math.round(c.outdoorF)}°F` : '--'}</b></div>
            <div class="lps-card-s"><span>Cabin, about</span><b>${c && num(c.interiorF) ? `${Math.round(c.interiorF)}°F` : '--'}</b></div>`;

        // tiles
        const o = openList(s);
        const tile = (icon, text, warn, off) => `<div class="lps-tile${warn ? ' is-warn' : ''}${off ? ' is-off' : ''}">${icon}${esc(text)}</div>`;
        els.tiles.innerHTML = !s ? tile(I.door, '--', false, true) + tile(I.win, '--', false, true) + tile(I.trunk, '--', false, true) + tile(I.tire, '--', false, true) + tile(I.batt, '--', false, true)
            : tile(I.door, o.doors.length ? 'Open' : 'Closed', o.doors.length > 0)
            + tile(I.win, o.windows.length ? 'Open' : 'Up', o.windows.length > 0)
            + tile(I.trunk, s.trunk ? 'Open' : 'Shut', s.trunk === true)
            + tile(I.tire, s.tireLow && s.tireLow.any ? 'Low' : 'OK', !!(s.tireLow && s.tireLow.any))
            + tile(I.batt, num(s.battery12) ? `${Math.round(s.battery12)}%` : 'OK', battLow(s));

        // the leather pad
        const rows = [];
        if (!canUse()) rows.push('<div class="lps-pad-note">Lapis Remote is for the administrator.</div>');
        else if (loadFailed && !state) rows.push(`<div class="lps-pad-note">${esc(loadFailed)}</div>`);
        else if (!configured()) rows.push('<div class="lps-pad-note">No BlueLink account is saved. Add it in Dreamscape CardSpace &gt; Service keys &gt; Hyundai BlueLink, then tap Refresh.</div>');
        else {
            if (state.error) rows.push(`<div class="lps-pad-note">${esc(state.error.message)}</div>`);
            if (rt) rows.push(`<div class="lps-pad-row${u.refuel && !u.refuel.beyond && u.refuel.daysLeft <= 0 ? ' is-warn' : ''}" data-open="history"><span>Refuel by</span><b>${esc(rt)}</b></div>`);
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
        ws.setTitle(top ? LAYER_TITLES[top] : TITLE);
        ws.syncHistory();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    function renderLayer() {
        const top = layers[layers.length - 1];
        if (!top || !els) return;
        if (top === 'settings') { if (els.body.dataset.for !== 'settings') renderSettings(); return; }
        if (top === 'item') { if (els.body.dataset.for !== 'item') renderItem(); return; }
        els.body.className = 'lps-layer-body';
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
        const running = !!(s && s.engine && s.climate);
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
                <div class="lps-auto-line"><div class="lps-auto-t"><span>Outside</span><b>${c && num(c.outdoorF) ? Math.round(c.outdoorF) : '--'}<small>°F</small></b></div>${I.arrow}<div class="lps-auto-t"><span>Cabin target</span><b>${tt}${/^\d/.test(tt) ? '<small>°F</small>' : ''}</b></div></div>
                <div class="lps-why">${why}</div>
            </div>
            <div class="lps-knobrow">
                <button type="button" class="lps-key is-pm" data-act="down" aria-label="Cooler">&minus;</button>
                <div class="lps-knob${d.temp >= 76 ? ' is-heat' : ''}"><i class="lps-nib" style="transform:rotate(${Math.round(-135 + 270 * frac)}deg)"></i><div class="lps-knob-in"><b>${tt}${/^\d/.test(tt) ? '<small>°F</small>' : ''}</b><span>${d.auto ? 'AUTO' : 'MANUAL'}</span></div></div>
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
                <button type="button" class="lps-go${running ? ' is-running' : ''}" data-act="go"${busy || !isAdmin() ? ' disabled' : ''}><i class="lps-go-fill"></i><span>ENGINE<br>START<br>STOP</span></button>
                <div class="lps-launch-txt">${running ? '<b>The car is running</b>Tap to stop the engine<br>and the climate control.' : busy ? '<b>Waiting for the car</b>The command was sent.' : `<b>Hold to start</b>The doors stay locked.<br>Stops by itself at ${clock(until)}.`}</div>
            </div>`;
        const go = els.body.querySelector('[data-act="go"]');
        if (go && !running) {
            const cancel = () => { clearTimeout(holdTimer); holdTimer = null; go.classList.remove('is-holding'); };
            go.addEventListener('pointerdown', () => {
                if (go.disabled) return;
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
        if (act === 'go') { const s = st(); if (s && s.engine && s.climate) doStop(); return; } // starting is the hold
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
        if (await send('start', options)) { layers = layers.filter((l) => l !== 'start'); draft = null; syncLayers(); }
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
            <div class="lps-list">
                ${row(s.locked === false ? I.unlock : I.lock, 'Doors', s.locked === null ? 'Unknown' : s.locked ? 'Locked' : 'Unlocked', s.locked === false ? 'is-warn' : '', o.doors.length ? `Open: ${o.doors.join(', ')}` : 'All closed')}
                ${row(I.win, 'Windows', o.windows.length ? 'Open' : 'Up', o.windows.length ? 'is-warn' : '', o.windows.length ? o.windows.join(', ') : '')}
                ${row(I.trunk, 'Trunk', s.trunk ? 'Open' : 'Shut', s.trunk ? 'is-warn' : '')}
                ${row(I.hood, 'Hood', s.hood ? 'Open' : 'Shut', s.hood ? 'is-warn' : '')}
                ${row(I.power, 'Engine', s.engine ? 'Running' : 'Off', '', s.climate ? `Climate on${num(s.setTemp) ? `, ${tempText(s.setTemp, state.limits)}` : ''}${s.defrost ? ', defrost' : ''}` : '')}
                ${row(I.fuel, 'Fuel', num(s.fuel) ? `${Math.round(s.fuel)}%` : '--', s.fuelLow ? 'is-warn' : '', num(s.range) ? `${Math.round(s.range)} miles of range` : '')}
                ${row(I.tire, 'Tire pressure', tires.any ? 'Low' : 'OK', tires.any ? 'is-warn' : '', lowTires.length ? `Low: ${lowTires.join(', ')}` : psiText(s))}
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
        box.className = 'lps-layer-body wm-form lps-settings';
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
            ${u.refuel ? `<div class="lps-pad"><div class="lps-pad-row"><span>Refuel by</span><b>${esc(refuelText())}</b></div><div class="lps-pad-note">${u.refuel.milesLeft} miles before the ${u.refuel.reservePct}% reserve. Expected miles: ${esc(wk)}. Commute: ${u.commute && u.commute.miles ? `${u.commute.miles} mi each way` : 'not set'}.</div></div>` : ''}
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
    function TileMap(host, car, places) {
        const view = { lat: car.lat, lon: car.lon, z: 15 };
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
            lockRemindMin: s.lockRemindMin || 10,
            lowFuelPct: s.lowFuelPct || 20,
            reservePct: s.reservePct == null ? 15 : s.reservePct,
            tankGal: String(s.tankGal || ''),
            mpg: String(s.mpg || ''),
            notify: Object.assign({ unlocked: true, lowFuel: true, refuel: true, service: true }, s.notify || {}),
            climate: Object.assign({ comfort: 74, coldAt: 33, hotAt: 95, seatHeatBelow: 56, seatCoolAbove: 76, defrostBelow: 41, wheel: true, seats: true }, s.climate || {})
        };
        return form;
    }

    const MINUTES = [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes']];
    const RUNS = [[3, '3 minutes'], [5, '5 minutes'], [8, '8 minutes'], [10, '10 minutes']];
    const LOWS = [[10, '10%'], [15, '15%'], [20, '20%'], [25, '25%'], [30, '30%']];
    const RESERVES = [[5, '5%'], [10, '10%'], [15, '15%'], [20, '20%'], [25, '25%']];
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
        box.className = 'lps-layer-body wm-form lps-settings';
        box.dataset.for = 'settings';
        if (!ui) { box.innerHTML = '<p>Settings are not available.</p>'; return; }
        const f = formOf();
        const s = (state && state.settings) || {};
        const label = (list, v) => (list.find(([x]) => String(x) === String(v)) || list[0])[1];
        const inUse = (p, own) => (p ? `In use: ${p.label ? `${p.label} ` : ''}(${p.lat}, ${p.lon})${own ? '' : ', from Melaton Traffic'}` : 'Not set. Leave blank to use Melaton Traffic\'s place.');
        box.innerHTML = `
            ${ui.sub('Car')}
            ${configured() ? '' : ui.note('No BlueLink account is saved yet: add it in Dreamscape CardSpace > Service keys > Hyundai BlueLink (e-mail, password and PIN).')}
            ${ui.row('Name:', ui.edit('lpsName', f.name, `placeholder="${esc((state && state.vehicle && state.vehicle.name) || 'Car')}" data-k="name" maxlength="40"`), { for: 'lpsName' })}
            <div class="lps-pic"><img src="${esc(carSrc(false))}" alt=""><div>${ui.buttons([['picChoose', 'Choose Picture...'], ['picReset', 'Built-in Picture', !picture.rev]], false)}</div></div>
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
        const combo = (act, list) => ui.bindCombo(box.querySelector(`[data-act="${act}"]`), list, f[act], (v) => { f[act] = Number(v); });
        combo('runMinutes', RUNS);
        combo('lockRemindMin', MINUTES);
        combo('lowFuelPct', LOWS);
        combo('reservePct', RESERVES);
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
        const next = { name: f.name.trim(), workDays: f.workDays, autoClimate: f.autoClimate, runMinutes: f.runMinutes, lockRemindMin: f.lockRemindMin, lowFuelPct: f.lowFuelPct, reservePct: f.reservePct, notify: f.notify, climate: f.climate };
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
        const view = () => { if (note && note.close) note.close(); open(n.kind === 'service' ? 'service' : n.kind === 'refuel' || n.kind === 'low-fuel' ? 'history' : null); };
        const lock = () => { if (note && note.close) note.close(); send('lock'); };
        const wantsLock = (n.actions || []).includes('lock') && isAdmin();
        let note = null;
        if (ws && typeof ws.appNote === 'function') {
            note = ws.appNote({
                title: n.title,
                html: esc(n.text || ''),
                icon: 'app-lapis',
                event: 'notification',
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
        const running = !!(s && s.engine && s.climate);
        return [
            running ? { label: 'Stop the Engine', disabled: !ok || !isAdmin(), action: doStop } : { label: 'Remote Start...', disabled: !ok, action: () => openLayer('start') },
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
                const running = !!(s && s.engine && s.climate);
                return {
                    left: running ? { label: 'Stop', disabled: !!busyCommand(), action: doStop } : { label: 'Start', disabled: !!busyCommand() || !isAdmin(), action: startConfirm },
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
        const head = cmd ? `${{ lock: 'Locking', unlock: 'Unlocking', start: 'Starting', stop: 'Stopping' }[cmd.kind]}...` : s.engine ? (s.climate ? 'Running' : 'Engine on') : s.locked === false ? 'Unlocked' : 'Locked';
        const rt = refuelText();
        const c = state.climate;
        const sub = [rt ? `Refuel by ${rt === 'Today' || rt === 'Tomorrow' ? rt.toLowerCase() : rt.split(',')[0]}` : '', c && num(c.outdoorF) ? `${Math.round(c.outdoorF)}°F` : ''].filter(Boolean).join(' · ');
        return { title: `${head} · ${num(s.range) ? `${Math.round(s.range)} mi` : num(s.fuel) ? `${Math.round(s.fuel)}%` : ''}`, sub, unlocked: s.locked === false, running: !!s.engine };
    }

    function todayRender(el) {
        if (!canUse()) return false;
        if (!loaded) { if (!wired) wire(); return false; }
        if (!configured() && !isAdmin()) return false;
        const t = todayLine();
        if (!el.dataset.lpsBound) {
            el.dataset.lpsBound = '1';
            el.classList.add('wtw', 'lps-today');
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
            el.addEventListener('click', (e) => {
                const k = e.target.closest('[data-today]');
                if (!k) { open(); return; }
                e.stopPropagation();
                if (k.dataset.today === 'lock') { const s = st(); if (s && s.locked === false) send('lock'); else if (s && s.locked) doUnlock(); else open(); }
                else if (k.dataset.today === 'start') { const s = st(); if (s && s.engine && s.climate) doStop(); else open('start'); }
            });
        }
        const keys = configured() && isAdmin()
            ? `<button type="button" class="lps-today-key${t.unlocked ? ' is-warn' : ''}" data-today="lock" aria-label="${t.unlocked ? 'Lock' : 'Unlock'}">${t.unlocked ? I.unlock : I.lock}</button><button type="button" class="lps-today-key${t.running ? ' is-warn' : ''}" data-today="start" aria-label="Remote start">${I.power}</button>`
            : '';
        const html = `<img class="lps-today-car" src="${esc(carSrc(true))}" alt="" draggable="false"><span class="wtw-lines"><span class="wtw-title">${esc(t.title)}</span><span class="wtw-sub">${esc(t.sub)}</span></span>${keys}`;
        if (html !== todayHtml || !el.firstChild) { todayHtml = html; el.innerHTML = html; }
        return true;
    }

    function todayTitanium() {
        if (!canUse() || !loaded) return null;
        const t = todayLine();
        const s = st();
        const go = () => open();
        if (!configured() || !s) return { label: 'lapis', icon: 'x:app-lapis-lg', pages: [{ title: t.title, line2: t.sub, line3: '' }], softKey: { label: 'Lapis', action: go }, onTap: go };
        const c = state.climate;
        const sv = nextService();
        const admin = isAdmin();
        const lockKey = !admin ? { label: 'Lapis', action: go } : s.locked === false ? { label: 'Lock', action: () => send('lock') } : { label: 'Unlock', action: doUnlock };
        const running = !!(s.engine && s.climate);
        const pages = [
            { title: t.title, line2: t.sub, line3: state.location && state.location.place ? `Parked at ${state.location.place}` : '', softKey: lockKey, onTap: go },
            { title: running ? 'Climate is running' : `Remote start: ${climateLine() || 'ready'}`, line2: c ? `Outside ${Math.round(c.outdoorF)}°F, cabin about ${Math.round(c.interiorF)}°F` : '', line3: `Runs ${(state.settings && state.settings.runMinutes) || 10} minutes`, softKey: !admin ? { label: 'Lapis', action: go } : running ? { label: 'Stop', action: doStop } : { label: 'Start', action: () => open('start') }, onTap: () => open('start') }
        ];
        if (sv) pages.push({ title: sv.label, line2: sv.milesLeft <= 0 ? `${Math.abs(sv.milesLeft).toLocaleString()} miles over` : `in ${sv.milesLeft.toLocaleString()} miles`, line3: '', softKey: { label: 'Service', action: () => open('service') }, onTap: () => open('service') });
        return { label: 'lapis', icon: 'x:app-lapis-lg', pages, softKey: lockKey, onTap: go };
    }

    // ---------------------------------------------------------------- register

    function register() {
        ws = window.wmShell;
        if (!ws) return;
        ws.registerApp(APP);
        if (typeof ws.registerTodayItem === 'function') {
            ws.registerTodayItem({ id: 'lapis', label: 'Lapis Remote', icon: 'app-lapis', after: 'traffic', render: todayRender, titanium: todayTitanium });
        }
        if (!wire()) { let n = 0; const t = setInterval(() => { if (wire() || ++n > 120) clearInterval(t); }, 1000); }
    }

    window.wmLapis = {
        open,
        state: () => state,
        /** Read what the server holds again (lapis_get). */
        reload: () => load()
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
