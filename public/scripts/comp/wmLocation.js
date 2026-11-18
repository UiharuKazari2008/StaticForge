/**
 * Location (Yozora #907): the one way any page code gets a position or a place.
 *
 *   wmLocation.get({ precision, maxAgeMs, urgent, purpose }) -> Promise<fix | null>
 *       fix { lat, lon, accuracyM, at, source: 'device' | 'ip' | 'home', precision }
 *       precision: 'exact' | 'approximate' | 'city' | 'county' | 'state' | 'country' (default 'approximate').
 *       One fix is kept for every caller: a fix good enough for the ask and young enough answers at once (a
 *       fine fix answers a coarse ask); asks while one is on its way wait for it instead of starting another;
 *       only 'exact' turns the GPS radio on (enableHighAccuracy), coarser asks take the network's fix, and a
 *       city or coarser ask on a phone that keeps programs off the GPS (Settings > System > External GPS) gets
 *       the place of its IP. The point is rounded to the precision asked (no street from a city ask).
 *       urgent: a fresh fix whatever the cache holds (maxAgeMs still bounds it: a driving app asks every few s).
 *       deviceOnly: the phone's own fix or null, no IP / Home stand-in (for a caller with its own fallback).
 *   wmLocation.watch({ precision, intervalMs, urgent, purpose }, cb) -> stop()
 *       Fixes as they come while the page is seen, for every watcher from one watch of the device; with
 *       urgent, the GPS radio, and on a phone that reports its driving state (AndroidHome.getDriveState,
 *       #890) only while driving. Each watcher hears at most once per its intervalMs.
 *   wmLocation.places() -> { home, work } (the server's, Settings > Personal > Location); placesReady()
 *   wmLocation.savePlaces({ home?, work? })
 *   wmLocation.resolve(query, { min, max, limit, near }) -> [place]   (the server's lookup)
 *   wmLocation.reverse(lat, lon, specificity) -> place | null
 *   wmLocation.canPick() -> whether pick() can show its page (the phone shell only; null from pick() elsewhere)
 *   wmLocation.pick({ title, prompt, min, max, value, near }) -> Promise<place | null>   (phones: the WM dialog)
 *   wmLocation.driveState() -> 'idle' | 'maybe' | 'driving' | 'stopped' | 'unknown'
 *   wmLocation.recent() -> the last asks [{ purpose, precision, at, served: 'cache' | 'device' | ... }]
 * Events: document 'wmLocationPlaces' (Home / Work changed), 'wmLocationFix' (a new fix, detail = fix).
 *
 * No timers run while the page is not seen (phone-power-client): a watch pauses and resumes with the page.
 */
(function () {
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined;
    'use strict';
    if (window.wmLocation) return;

    const SPECIFICITY = ['exact', 'approximate', 'city', 'county', 'state', 'country'];
    const SPEC_LABEL = { exact: 'Exact', approximate: 'Approximate', city: 'City', county: 'County', state: 'State', country: 'Country' };
    // what accuracy (m) answers a precision, and how old a fix may be by default for it
    const NEED_M = { exact: 100, approximate: 2000, city: 15000, county: 60000, state: 300000, country: Infinity };
    const MAX_AGE = { exact: 60 * 1000, approximate: 10 * 60 * 1000, city: 60 * 60 * 1000, county: 6 * 60 * 60 * 1000, state: 24 * 60 * 60 * 1000, country: 24 * 60 * 60 * 1000 };
    const ROUND = { exact: 1e-6, approximate: 0.001, city: 0.01, county: 0.05, state: 0.5, country: 2 };
    const LS_FIX = 'wmLocationFix';
    const rank = (s) => { const i = SPECIFICITY.indexOf(s); return i < 0 ? 1 : i; };
    const spec = (s, d) => (SPECIFICITY.includes(s) ? s : d);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const seen = () => !document.hidden && document.documentElement.dataset.screenOff === undefined;
    const ws = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);
    const ask = async (type, data, timeout = 15000) => {
        const c = ws();
        if (!c || typeof c.sendMessage !== 'function') throw new Error('Not connected');
        const r = await Promise.race([
            c.sendMessage(type, data || {}, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), timeout))
        ]);
        return r && r.data && typeof r.data === 'object' ? r.data : r;
    };

    // ------------------------------------------------------------------ the one fix

    let fix = null;
    try { const f = JSON.parse(localStorage.getItem(LS_FIX) || 'null'); if (f && Number.isFinite(f.lat)) fix = f; } catch (_) { fix = null; }
    const asks = []; // the last asks, for Settings > Location
    function note(purpose, precision, served) {
        asks.unshift({ purpose: String(purpose || 'unnamed'), precision, served, at: Date.now() });
        if (asks.length > 20) asks.length = 20;
    }
    function keep(f) {
        fix = f;
        try { localStorage.setItem(LS_FIX, JSON.stringify(f)); } catch (_) { /* storage off */ }
        try { document.dispatchEvent(new CustomEvent('wmLocationFix', { detail: f })); } catch (_) { /* old browser */ }
    }
    function rounded(f, precision) {
        if (!f) return null;
        const g = ROUND[precision] || 1e-6;
        const r = (v) => Math.round(Math.round(v / g) * g * 1e6) / 1e6;
        return Object.assign({}, f, { lat: r(f.lat), lon: r(f.lon), precision });
    }
    const goodFor = (f, precision, maxAgeMs) => !!f && (f.accuracyM || Infinity) <= NEED_M[precision] && Date.now() - f.at <= maxAgeMs;

    /** Programs may use the phone's GPS (Settings > System > External GPS, 6.5); a browser: whether it has one. */
    // a refused permission is kept for the page's life (each ask would only be refused again)
    let denied = false;
    const deviceAllowed = () => !denied && !!navigator.geolocation && !(window.wmGps && typeof window.wmGps.allowed === 'function' && !window.wmGps.allowed());

    let inflight = null; // { precision, promise }
    function deviceFix(precision, timeoutMs) {
        const high = precision === 'exact';
        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: pos.coords.accuracy || (high ? 50 : 1500), at: Date.now(), source: 'device' }),
                (err) => { if (err && err.code === 1) denied = true; resolve(null); },
                { enableHighAccuracy: high, maximumAge: high ? 5000 : 60000, timeout: timeoutMs || (high ? 20000 : 15000) }
            );
        });
    }
    async function ipFix() {
        try {
            const d = await ask('traffic_where', {}, 15000);
            if (d && d.available && Number.isFinite(Number(d.lat))) return { lat: Number(d.lat), lon: Number(d.lon), accuracyM: Math.max(5000, (Number(d.accuracyKm) || 25) * 1000), at: Date.now(), source: 'ip' };
        } catch (_) { /* no answer */ }
        const h = places().home;
        return h ? { lat: h.lat, lon: h.lon, accuracyM: 20000, at: Date.now(), source: 'home' } : null;
    }

    /** A position: see the header. */
    async function get(opts = {}) {
        if (opts.deviceOnly) return getDevice(opts);
        const precision = spec(opts.precision, 'approximate');
        const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : (opts.urgent ? 5000 : MAX_AGE[precision]);
        if (goodFor(fix, precision, maxAgeMs)) { note(opts.purpose, precision, 'cache'); return rounded(fix, precision); }
        // one on its way that is fine enough: wait for it
        if (inflight && rank(inflight.precision) <= rank(precision)) {
            const f = await inflight.promise;
            note(opts.purpose, precision, 'shared');
            return f && (f.accuracyM || Infinity) <= NEED_M[precision] ? rounded(f, precision) : (f ? rounded(f, precision) : null);
        }
        // out of sight nothing new is started for a non-urgent ask: what is kept, if any
        if (!seen() && !opts.urgent) { note(opts.purpose, precision, 'kept'); return fix ? rounded(fix, precision) : null; }
        const run = (async () => {
            let f = null;
            if (deviceAllowed()) f = await deviceFix(precision, opts.timeoutMs);
            if (!f && rank(precision) >= rank('approximate')) f = await ipFix();
            if (f) keep(f);
            return f;
        })();
        inflight = { precision, promise: run };
        try {
            const f = await run;
            note(opts.purpose, precision, f ? f.source : 'none');
            return f ? rounded(f, precision) : (fix ? rounded(fix, precision) : null);
        } finally {
            if (inflight && inflight.promise === run) inflight = null;
        }
    }

    /** deviceOnly: the phone's own fix or null (a caller with its own fallback, e.g. Weather's IP place). */
    async function getDevice(opts) {
        const precision = spec(opts.precision, 'approximate');
        const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : (opts.urgent ? 5000 : MAX_AGE[precision]);
        if (fix && fix.source === 'device' && goodFor(fix, precision, maxAgeMs)) { note(opts.purpose, precision, 'cache'); return rounded(fix, precision); }
        if (!deviceAllowed()) { note(opts.purpose, precision, 'none'); return null; }
        if (!seen() && !opts.urgent) { note(opts.purpose, precision, 'kept'); return fix && fix.source === 'device' ? rounded(fix, precision) : null; }
        if (inflight && rank(inflight.precision) <= rank(precision)) {
            const f = await inflight.promise;
            if (f && f.source === 'device') { note(opts.purpose, precision, 'shared'); return rounded(f, precision); }
        }
        const run = deviceFix(precision, opts.timeoutMs).then((f) => { if (f) keep(f); return f; });
        inflight = { precision, promise: run };
        try {
            const f = await run;
            note(opts.purpose, precision, f ? 'device' : 'none');
            return f ? rounded(f, precision) : null;
        } finally {
            if (inflight && inflight.promise === run) inflight = null;
        }
    }

    // ------------------------------------------------------------------ watching

    const watchers = new Set(); // { precision, intervalMs, urgent, cb, last }
    let watchId = null;
    let watchHigh = false;

    function driveState() {
        try {
            const H = window.AndroidHome;
            if (!H || typeof H.getDriveState !== 'function') return 'unknown';
            const s = JSON.parse(H.getDriveState() || 'null');
            return s && s.state ? String(s.state) : 'unknown';
        } catch (_) { return 'unknown'; }
    }

    /** Whether a watcher may have fixes now: the page seen; urgent ones on a phone that reports driving only while it drives. */
    function wanted(w) {
        if (!seen()) return false;
        if (!w.urgent) return true;
        const d = driveState();
        return d === 'unknown' || d === 'driving' || d === 'maybe';
    }

    function syncWatch() {
        const live = [...watchers].filter(wanted);
        const high = live.some((w) => w.urgent || w.precision === 'exact');
        if (!live.length || !deviceAllowed()) {
            if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
            return;
        }
        if (watchId != null && watchHigh === high) return;
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        watchHigh = high;
        watchId = navigator.geolocation.watchPosition((pos) => {
            const f = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: pos.coords.accuracy || 50, at: Date.now(), source: 'device', speed: pos.coords.speed, heading: pos.coords.heading };
            keep(f);
            const now = Date.now();
            watchers.forEach((w) => {
                if (!wanted(w) || now - w.last < w.intervalMs) return;
                w.last = now;
                try { w.cb(rounded(f, w.precision)); } catch (err) { console.warn('[wmLocation] watcher', err); }
            });
        }, () => { /* the next fix, or none */ }, { enableHighAccuracy: high, maximumAge: high ? 2000 : 30000 });
    }

    /** Fixes as they come: see the header. */
    function watch(opts = {}, cb) {
        if (typeof cb !== 'function') return () => {};
        const w = { precision: spec(opts.precision, 'approximate'), intervalMs: Math.max(1000, Number(opts.intervalMs) || 30000), urgent: !!opts.urgent, cb, last: 0, purpose: opts.purpose };
        watchers.add(w);
        note(opts.purpose, w.precision, 'watch');
        syncWatch();
        return () => { watchers.delete(w); syncWatch(); };
    }
    document.addEventListener('visibilitychange', syncWatch, { signal: appScopeSignal });
    window.addEventListener('melatonscreen', syncWatch, { signal: appScopeSignal });
    window.addEventListener('androiddrive', syncWatch, { signal: appScopeSignal });

    // ------------------------------------------------------------------ Home / Work and lookups

    let placesCache = { home: null, work: null };
    let placesLoaded = null;
    function loadPlaces() {
        placesLoaded = ask('location_places_get', {}).then((d) => {
            placesCache = (d && d.places) || placesCache;
            try { document.dispatchEvent(new CustomEvent('wmLocationPlaces', { detail: placesCache })); } catch (_) { /* old browser */ }
            return placesCache;
        }).catch(() => { placesLoaded = null; return placesCache; });
        return placesLoaded;
    }
    function places() { if (!placesLoaded) loadPlaces(); return placesCache; }
    const placesReady = () => placesLoaded || loadPlaces();
    async function savePlaces(next) {
        const d = await ask('location_places_save', next || {}, 20000);
        placesCache = (d && d.places) || placesCache;
        try { document.dispatchEvent(new CustomEvent('wmLocationPlaces', { detail: placesCache })); } catch (_) { /* old browser */ }
        return placesCache;
    }
    (function wire(tries) {
        const c = window.wsClient;
        if (!c || typeof c.on !== 'function') { if (tries < 60) setTimeout(() => wire(tries + 1), 1000); return; }
        c.on('connected', () => { loadPlaces(); });
        c.on('message', (m) => {
            if (!m || m.type !== 'location_places_changed') return;
            placesCache = (m.data && m.data.places) || placesCache;
            try { document.dispatchEvent(new CustomEvent('wmLocationPlaces', { detail: placesCache })); } catch (_) { /* old browser */ }
        });
    })(0);

    const resolve = (query, opts = {}) => ask('location_resolve', { query, min: opts.min, max: opts.max, limit: opts.limit, near: opts.near }, 20000).then((d) => (d && d.results) || []);
    const reverse = (lat, lon, specificity) => ask('location_reverse', { lat, lon, specificity }, 15000).then((d) => (d && d.place) || null);

    // ------------------------------------------------------------------ the lookup dialog (phones)

    const APP_ID = 'wm-location-pick';
    let dlg = null; // { opts, query, results, sel, busy, error, resolve }
    let page = null;
    const sh = () => window.wmShell || null;

    function specRange(o) {
        const max = spec(o.max, 'exact');
        const min = spec(o.min, 'country');
        return max === min ? SPEC_LABEL[max] : `${SPEC_LABEL[max]} to ${SPEC_LABEL[min]}`;
    }

    function render() {
        if (!page || !dlg) return;
        const d = dlg;
        const ui = window.wmSettings && window.wmSettings.ui;
        const edit = ui ? ui.edit('wlpQuery', d.query, 'placeholder="Address, place, town or postal code" maxlength="200" enterkeyhint="search"') : `<input id="wlpQuery" class="wm-edit" value="${esc(d.query)}">`;
        page.innerHTML = `<div class="wm-form wlp wm-pg-scroll">
            <div class="wm-form-hdr">${esc(d.opts.title || 'Location')}</div>
            <p class="wlp-prompt">${esc(d.opts.prompt || 'Enter a place the way you would say it.')}</p>
            <div class="wlp-search">${edit}<button type="button" class="wm-button wlp-go">Find</button></div>
            <p class="wlp-want">${esc(`Needed: ${specRange(d.opts)}`)}</p>
            ${d.busy ? '<p class="wlp-status">Looking it up...</p>' : d.error ? `<p class="wlp-status is-error">${esc(d.error)}</p>` : ''}
            <div class="wlp-list" role="listbox" aria-label="Places">${d.results.map((p, i) => `<button type="button" class="wlp-row${i === d.sel ? ' is-selected' : ''}" role="option" aria-selected="${i === d.sel}" data-i="${i}">
                <span class="wlp-label">${esc(p.label)}</span><span class="wlp-spec">${esc(SPEC_LABEL[p.specificity] || '')}</span>
                ${p.address && p.address !== p.label ? `<span class="wlp-addr">${esc(p.address)}</span>` : ''}</button>`).join('')}</div>
            ${!d.busy && d.searched && !d.results.length && !d.error ? '<p class="wlp-status">No place found at the detail needed. Try adding the town or state.</p>' : ''}
        </div>`;
        const input = page.querySelector('#wlpQuery');
        input.addEventListener('input', () => { d.query = input.value; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } });
        page.querySelector('.wlp-go').addEventListener('click', () => { void search(); });
        page.querySelectorAll('.wlp-row').forEach((r) => {
            r.addEventListener('click', () => {
                const i = Number(r.dataset.i);
                if (d.sel === i) { finish(d.results[i]); return; } // a second tap on the chosen one is OK
                d.sel = i;
                render();
            });
        });
        const s = sh();
        if (s && typeof s.refreshSoftKeys === 'function') s.refreshSoftKeys();
    }

    async function search() {
        const d = dlg;
        if (!d || d.busy) return;
        const q = String(d.query || '').trim();
        if (q.length < 2) return;
        d.busy = true; d.error = ''; d.results = []; d.sel = -1; d.searched = true;
        render();
        try {
            const near = d.opts.near || (places().home ? { lat: places().home.lat, lon: places().home.lon } : null);
            d.results = await resolve(q, { min: d.opts.min, max: d.opts.max, limit: 6, near });
            if (d.results.length === 1) d.sel = 0;
        } catch (err) {
            d.error = (err && err.message) || 'The place could not be looked up. Check the connection.';
        }
        d.busy = false;
        if (dlg === d) render();
    }

    function finish(place) {
        const d = dlg;
        if (!d) return;
        dlg = null;
        const out = place ? Object.assign({}, place, { typed: d.query }) : null;
        const s = sh();
        if (s && s.current === APP_ID && typeof s.back === 'function') s.back({ app: true });
        d.resolve(out);
    }

    /** The common lookup: a WM page with a box to type in and the places it means; resolves with one or null. */
    /** Whether pick() can show its page (the phone shell); a desktop program uses its own window's box with resolve(). */
    function canPick() {
        const s = sh();
        return !!(s && typeof s.open === 'function' && window.uiShell === 'mobile');
    }
    function pick(opts = {}) {
        const s = sh();
        // no phone shell: nothing to show it in (never the browser's own prompt: no-native-browser-ui)
        if (!canPick()) return Promise.resolve(null);
        if (dlg) finish(null);
        return new Promise((res) => {
            dlg = { opts, query: String(opts.value || ''), results: [], sel: -1, busy: false, error: '', searched: false, resolve: res };
            s.open(APP_ID);
            render();
            if (dlg.query.length >= 2) void search();
        });
    }

    function registerPick() {
        const s = sh();
        if (!s || typeof s.registerApp !== 'function' || window.uiShell !== 'mobile') return;
        s.registerApp({
            id: APP_ID,
            title: 'Location',
            icon: 'set-location',
            inStart: false,
            sip: true,
            mount(p) { page = p; },
            show(p) { page = p; render(); },
            hide() { if (dlg) { const d = dlg; dlg = null; d.resolve(null); } if (page) page.innerHTML = ''; },
            softKeys: () => ({
                left: { label: 'Cancel', action: () => finish(null) },
                right: { label: 'OK', disabled: !dlg || dlg.sel < 0, action: () => { if (dlg && dlg.sel >= 0) finish(dlg.results[dlg.sel]); } }
            })
        });
    }
    if (window.wmShell) registerPick();
    else document.addEventListener('wmShellReady', registerPick, { once: true });

    // app-scope: allow the location service every program calls (loaded once from app.html; not an app package)
    window.wmLocation = {
        SPECIFICITY,
        SPEC_LABEL,
        get,
        watch,
        places,
        placesReady,
        savePlaces,
        resolve,
        reverse,
        canPick, pick,
        driveState,
        recent: () => asks.slice(),
        last: () => (fix ? Object.assign({}, fix) : null)
    };
})();
