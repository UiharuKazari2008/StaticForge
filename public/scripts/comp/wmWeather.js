/**
 * Melaton Mobile: Weather (Yozora #732). Yukimi, Nov 10: "a well designed weather app that's designed
 * like a premium 2009 Windows Mobile app with skeuomorphism". Our own design and art: a brushed-metal
 * location plate, a live sky scene (time of day and condition: sun with turning rays, drifting clouds,
 * rain, snow, storm flashes, a night sky with stars and the moon's phase) behind a glass clock capsule
 * and big glossy temperature numerals, a glass gauge bar (feels like, wind, humidity, sunrise and
 * sunset), a polished hourly rail and 7-day forecast cards that flip over for details. The WM 6.1
 * shell stays around it (title bar, soft keys Refresh | Menu).
 *
 * Data: Open-Meteo, the Sidebar weather gadget's provider (modules/sidebarGadgets.js fetchOpenMeteo;
 * keyless), asked directly for the extra fields a phone app shows (hourly, wind, humidity, sun times).
 * The gadget's own location (client IP, then the configured home: sidebar_weather, admins only) is
 * "Current location"; places the user adds (Open-Meteo geocoding, the server's lookup_city as a
 * fallback) are kept on the phone. Units follow the gadget's setting until picked here.
 *
 * Loading: a refresh the user asked for shows the WM wait cursor and errors as a message box; routine
 * updates (every 15 min while open, Today asking for data) show nothing.
 *
 * window.wmWeather: current() -> summary of the selected place (or null), open(), refresh(), unit();
 * document event 'wmWeatherChange' when the data, place or unit changes. Today's weather row opens
 * the app with wmShell.open('weather').
 *
 * Art: public/static_images/wm61/weather/ (scripts/generate-wm-weather-art.js), icon app-weather.
 * Styles: public/css/wm-weather.css. Only on phones.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'weather';
    const ART = '/static_images/wm61/weather/';
    const STALE_MS = 15 * 60 * 1000; // as the gadget's sidebar_live weather
    const RETRY_MS = 60 * 1000;
    const HERE_MS = 6 * 60 * 60 * 1000;
    const LS = {
        places: 'wmWeatherPlaces',
        selected: 'wmWeatherSelected',
        unit: 'wmWeatherUnit',
        cache: 'wmWeatherCache',
        here: 'wmWeatherHere',
        seeded: 'wmWeatherSeeded'
    };
    const FORECAST = 'https://api.open-meteo.com/v1/forecast';
    const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const H12 = (() => {
        try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false; } catch (_) { return true; }
    })();

    let ws = null;
    let page = null;
    let els = null;
    let shown = false;
    let layers = []; // 'places' | 'add'
    let clockTimer = null;
    let pollTimer = null;
    let flipped = new Set(); // dates of flipped forecast cards
    let addResults = [];
    let addBusy = false;

    // ---------------------------------------------------------------- storage

    const load = (key, fallback) => {
        try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; }
    };
    const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* full or blocked */ } };

    let saved = load(LS.places, []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    let here = load(LS.here, null); // { name, region, country, lat?, lon?, at, gadget? }
    let hereDenied = false;
    let selectedId = load(LS.selected, null);
    let unitPicked = load(LS.unit, null);
    let gadgetUnit = null;
    const cache = load(LS.cache, {}); // keyOf(place) -> { at, data }
    const state = { busy: new Map(), failedAt: new Map() };

    const keyOf = (p) => (p.id === 'here' && !Number.isFinite(p.lat) ? 'here' : `${Number(p.lat).toFixed(2)},${Number(p.lon).toFixed(2)}`);

    function places() {
        const list = [];
        if (here && here.name) list.push(Object.assign({ id: 'here', here: true }, here));
        return list.concat(saved);
    }

    function selected() {
        const list = places();
        return list.find((p) => p.id === selectedId) || list[0] || null;
    }

    function unit() {
        if (unitPicked === 'C' || unitPicked === 'F') return unitPicked;
        if (gadgetUnit) return gadgetUnit;
        try { return /-(US|LR|MM|BS|BZ|KY|PW)\b/i.test(navigator.language || '') ? 'F' : 'C'; } catch (_) { return 'C'; }
    }

    function persistCache() {
        // last good data per place only, for an instant first paint
        const keep = new Set(places().map(keyOf));
        Object.keys(cache).forEach((k) => { if (!keep.has(k)) delete cache[k]; });
        save(LS.cache, cache);
    }

    function changed() {
        document.dispatchEvent(new CustomEvent('wmWeatherChange'));
    }

    // ---------------------------------------------------------------- conditions

    /** WMO weather code -> { icon, text, scene }. */
    function condition(code, isDay = true) {
        const c = Number(code);
        const dn = (k) => `${k}-${isDay ? 'day' : 'night'}`;
        if (c === 0) return { icon: dn('clear'), text: 'Clear', scene: 'clear' };
        if (c === 1) return { icon: dn('clear'), text: 'Mostly Clear', scene: 'fair' };
        if (c === 2) return { icon: dn('partly'), text: 'Partly Cloudy', scene: 'partly' };
        if (c === 3) return { icon: 'cloudy', text: 'Cloudy', scene: 'cloudy' };
        if (c === 45 || c === 48) return { icon: 'fog', text: c === 48 ? 'Freezing Fog' : 'Fog', scene: 'fog' };
        if (c >= 51 && c <= 55) return { icon: 'drizzle', text: c === 55 ? 'Heavy Drizzle' : 'Drizzle', scene: 'drizzle' };
        if (c === 56 || c === 57) return { icon: 'sleet', text: 'Freezing Drizzle', scene: 'sleet' };
        if (c === 61) return { icon: 'rain', text: 'Light Rain', scene: 'drizzle' };
        if (c === 63) return { icon: 'rain', text: 'Rain', scene: 'rain' };
        if (c === 65) return { icon: 'rain', text: 'Heavy Rain', scene: 'heavy' };
        if (c === 66 || c === 67) return { icon: 'sleet', text: 'Freezing Rain', scene: 'sleet' };
        if (c === 71) return { icon: 'snow', text: 'Light Snow', scene: 'snow' };
        if (c === 73 || c === 77) return { icon: 'snow', text: c === 77 ? 'Snow Grains' : 'Snow', scene: 'snow' };
        if (c === 75) return { icon: 'snow', text: 'Heavy Snow', scene: 'snow' };
        if (c === 80) return { icon: 'rain', text: 'Showers', scene: 'rain' };
        if (c === 81 || c === 82) return { icon: 'rain', text: c === 82 ? 'Heavy Showers' : 'Rain Showers', scene: 'heavy' };
        if (c === 85 || c === 86) return { icon: 'snow', text: 'Snow Showers', scene: 'snow' };
        if (c === 95) return { icon: 'storm', text: 'Thunderstorm', scene: 'storm' };
        if (c === 96 || c === 99) return { icon: 'storm', text: 'Thunderstorm, Hail', scene: 'storm' };
        return { icon: 'cloudy', text: 'Cloudy', scene: 'cloudy' };
    }

    const iconUrl = (key, hd) => `${ART}wx-${key}${hd ? '@2x' : ''}.png`;
    const iconImg = (key, cls) => `<img class="${cls}" src="${iconUrl(key)}" srcset="${iconUrl(key)} 1x, ${iconUrl(key, true)} 2x" alt="" draggable="false">`;

    // ---------------------------------------------------------------- units and times

    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const tempOf = (c) => { const v = num(c); return v == null ? null : Math.round(unit() === 'F' ? v * 9 / 5 + 32 : v); };
    const temp = (c) => { const v = tempOf(c); return v == null ? '--' : `${v}°`; };
    const wind = (kmh) => {
        const v = num(kmh);
        if (v == null) return '--';
        return unit() === 'F' ? `${Math.round(v * 0.621371)} mph` : `${Math.round(v)} km/h`;
    };
    const compass = (deg) => (num(deg) == null ? '' : COMPASS[Math.round(((Number(deg) % 360) + 360) % 360 / 22.5) % 16]);
    const uvWord = (uv) => (uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very High' : 'Extreme');

    /** 'YYYY-MM-DDTHH:MM' (the place's local time) -> ms on a UTC clock that reads that time. */
    const localMs = (iso) => Date.parse(`${iso}${iso.length <= 10 ? 'T00:00' : ''}Z`);
    const placeNow = (data) => Date.now() + ((data && data.offset) || 0) * 1000;

    function hm(iso) {
        if (!iso || iso.length < 16) return '--';
        const h = Number(iso.slice(11, 13));
        const m = iso.slice(14, 16);
        return H12 ? `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${String(h).padStart(2, '0')}:${m}`;
    }

    function hourLabel(iso) {
        const h = Number(iso.slice(11, 13));
        return H12 ? `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}` : `${String(h).padStart(2, '0')}:00`;
    }

    function dayOf(date) { return new Date(localMs(date)).getUTCDay(); }

    /** Sky phase at the place now: dawn and dusk are 45 minutes either side of sunrise and sunset. */
    function phaseOf(data) {
        const today = data.daily && data.daily[0];
        if (today && today.sunrise && today.sunset) {
            const now = placeNow(data);
            const rise = localMs(today.sunrise);
            const set = localMs(today.sunset);
            const near = 45 * 60 * 1000;
            if (Math.abs(now - rise) < near) return 'dawn';
            if (Math.abs(now - set) < near) return 'dusk';
            return now > rise && now < set ? 'day' : 'night';
        }
        return data.current && data.current.isDay === false ? 'night' : 'day';
    }

    /** Moon age 0..1 (0 new, 0.5 full), as the gadget works it out. */
    function moonAge() {
        const days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
        return (((days % 29.530588853) + 29.530588853) % 29.530588853) / 29.530588853;
    }

    // ---------------------------------------------------------------- fetching

    async function getJson(url, ms = 10000) {
        const r = await fetch(url, { signal: AbortSignal.timeout(ms), credentials: 'omit' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }

    async function fetchForecast(lat, lon) {
        const params = new URLSearchParams({
            latitude: Number(lat).toFixed(3),
            longitude: Number(lon).toFixed(3),
            current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl',
            hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,uv_index_max,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant',
            forecast_days: '7',
            forecast_hours: '25',
            timezone: 'auto'
        });
        const b = await getJson(`${FORECAST}?${params}`);
        if (!b || !b.current) throw new Error('No current conditions');
        const h = b.hourly || {};
        const d = b.daily || {};
        const at = (arr, i) => (arr ? arr[i] : null);
        return {
            tz: b.timezone || '',
            offset: Number(b.utc_offset_seconds) || 0,
            current: {
                time: b.current.time,
                tempC: b.current.temperature_2m,
                feelsC: b.current.apparent_temperature,
                humidity: b.current.relative_humidity_2m,
                code: b.current.weather_code,
                isDay: b.current.is_day === 1,
                windKmh: b.current.wind_speed_10m,
                windDir: b.current.wind_direction_10m,
                gustKmh: b.current.wind_gusts_10m,
                pressure: b.current.pressure_msl
            },
            hourly: (h.time || []).map((time, i) => ({
                time,
                tempC: at(h.temperature_2m, i),
                code: at(h.weather_code, i),
                rain: at(h.precipitation_probability, i),
                isDay: at(h.is_day, i) === 1
            })),
            daily: (d.time || []).map((date, i) => ({
                date,
                code: at(d.weather_code, i),
                maxC: at(d.temperature_2m_max, i),
                minC: at(d.temperature_2m_min, i),
                feelsMaxC: at(d.apparent_temperature_max, i),
                feelsMinC: at(d.apparent_temperature_min, i),
                rain: at(d.precipitation_probability_max, i),
                uv: at(d.uv_index_max, i),
                sunrise: at(d.sunrise, i),
                sunset: at(d.sunset, i),
                windKmh: at(d.wind_speed_10m_max, i),
                windDir: at(d.wind_direction_10m_dominant, i)
            }))
        };
    }

    /** The gadget's own reply (current + 4 days) in this app's shape, when no coordinates are known. */
    function fromGadget(w) {
        return {
            tz: '',
            offset: -new Date().getTimezoneOffset() * 60,
            current: { tempC: w.current.tempC, feelsC: w.current.feelsC, code: w.current.code, isDay: w.current.isDay !== false },
            hourly: [],
            daily: (w.daily || []).map((d) => ({ date: d.date, code: d.code, maxC: d.maxC, minC: d.minC, feelsMaxC: d.feelsMaxC, feelsMinC: d.feelsMinC, rain: d.rainChance, uv: d.uvMax })),
            gadgetOnly: true
        };
    }

    async function geocode(name, count = 8) {
        const params = new URLSearchParams({ name, count: String(count), language: 'en', format: 'json' });
        const b = await getJson(`${GEOCODE}?${params}`, 8000);
        return (b && b.results ? b.results : []).map((r) => ({
            name: r.name,
            region: r.admin1 || '',
            country: r.country || '',
            lat: Number(r.latitude),
            lon: Number(r.longitude)
        })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    }

    /** The server's own city search (the desktop's weather location dialog), one match. */
    async function lookupCity(name) {
        const c = window.wsClient;
        if (!c || typeof c.lookupCity !== 'function') return [];
        const r = await c.lookupCity(name);
        const d = r && (r.data || r);
        if (!d || d.latitude == null || d.longitude == null) return [];
        return [{ name: d.city || name, region: d.state || '', country: d.country || '', lat: Number(d.latitude), lon: Number(d.longitude) }];
    }

    const wsClient = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);

    /** The gadget's location (client IP, then the configured home), resolved to coordinates once in a while. */
    // admin-only packets go out only for an admin: a refusal shows "Admin access required" whatever
    // the caller does (the Sidebar's and Today's own check, wmTodayWidgets.js isAdmin)
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };

    async function resolveHere() {
        if (hereDenied || !isAdmin()) return;
        if (here && Date.now() - (here.at || 0) < HERE_MS) return;
        const c = wsClient();
        if (!c) return;
        let w;
        try {
            w = await c.sendMessage('sidebar_weather', {}, false);
            w = w && (w.data || w);
        } catch (err) {
            if (/PERMISSION|Admin access/i.test(String((err && (err.code || err.message)) || err))) hereDenied = true;
            return;
        }
        if (!w || !w.available || !w.location || !w.location.city) return;
        const loc = w.location;
        const next = { name: loc.city, region: loc.region || '', country: loc.country || '', at: Date.now() };
        try {
            const hits = await geocode(loc.city, 10);
            const hit = hits.find((r) => loc.country && r.country === loc.country && (!loc.region || r.region === loc.region))
                || hits.find((r) => loc.country && r.country === loc.country) || hits[0];
            if (hit) Object.assign(next, { lat: hit.lat, lon: hit.lon });
        } catch (_) { /* the gadget's data stands in */ }
        if (!Number.isFinite(next.lat) && w.current) cache.here = { at: Date.now(), data: fromGadget(w) };
        here = next;
        save(LS.here, here);
        // the gadget's unit, until one is picked here (sidebar_get, admins too)
        if (!unitPicked && !gadgetUnit) {
            c.sendMessage('sidebar_get', {}, false).then((r) => {
                const side = r && (r.data || r);
                const g = side && side.sidebar && (side.sidebar.gadgets || []).find((x) => x && x.type === 'weather');
                if (g && g.settings && (g.settings.unit === 'C' || g.settings.unit === 'F')) { gadgetUnit = g.settings.unit; changed(); render(); }
            }).catch(() => {});
        }
    }

    /** First run with no place at all: the city of the phone's time zone. */
    async function seed() {
        if (places().length || load(LS.seeded, false)) return;
        let city = '';
        try { city = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/').pop().replace(/_/g, ' '); } catch (_) { /* none */ }
        if (!city || /^(UTC|GMT)/i.test(city)) return;
        try {
            const hit = (await geocode(city, 1))[0];
            if (hit && !places().length) {
                saved.push(Object.assign({ id: placeId() }, hit));
                save(LS.places, saved);
                save(LS.seeded, true);
            }
        } catch (_) { /* tried again next time */ }
    }

    const placeId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    /** Fetch one place. Resolves true when new data arrived; throws on failure. */
    async function update(p) {
        const key = keyOf(p);
        if (state.busy.has(key)) return state.busy.get(key);
        const run = (async () => {
            if (!Number.isFinite(p.lat)) {
                // the gadget's place without coordinates: ask the gadget again
                if (here) here.at = 0;
                await resolveHere();
                if (!cache.here) throw new Error('No weather for this place');
                return true;
            }
            const data = await fetchForecast(p.lat, p.lon);
            cache[key] = { at: Date.now(), data };
            state.failedAt.delete(key);
            persistCache();
            return true;
        })();
        state.busy.set(key, run);
        try {
            return await run;
        } catch (err) {
            state.failedAt.set(key, Date.now());
            throw err;
        } finally {
            state.busy.delete(key);
        }
    }

    const fresh = (p) => { const c = p && cache[keyOf(p)]; return !!(c && Date.now() - c.at < STALE_MS); };
    const dataOf = (p) => { const c = p && cache[keyOf(p)]; return c ? c.data : null; };

    /** A routine update: no cursor, no message. */
    let quietGen = 0;
    async function quiet(all) {
        const gen = ++quietGen;
        await resolveHere();
        await seed();
        const list = all ? places() : [selected()].filter(Boolean);
        for (const p of list) {
            if (fresh(p) || Date.now() - (state.failedAt.get(keyOf(p)) || 0) < RETRY_MS) continue;
            try { await update(p); } catch (_) { /* shown as it was */ }
            if (gen !== quietGen && !all) return;
            changed();
            render();
        }
        if (!places().length) render();
    }

    /** The user's refresh: wait cursor, a message box when it fails. */
    async function userRefresh() {
        const p = selected();
        if (!p) { openAdd(); return; }
        try {
            await ws.busy(() => update(p), { delay: 250, timeout: 20000 });
            changed();
            render();
        } catch (_) {
            render();
            ws.messageBox({ title: 'Weather', icon: 'error', text: 'Weather information could not be updated. Check the data connection, then try again.' });
        }
    }

    // ---------------------------------------------------------------- scene

    const HILLS = `<svg class="wxw-land" viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true">
        <path class="wxw-hill-far" d="M0 52 C 40 38 70 34 110 44 S 180 62 230 46 S 320 22 360 34 S 392 44 400 42 L400 90 L0 90 Z"/>
        <path class="wxw-hill-near" d="M0 70 C 50 58 90 54 140 64 S 230 80 280 66 S 360 50 400 60 L400 90 L0 90 Z"/>
        <path class="wxw-hill-rim" d="M0 70 C 50 58 90 54 140 64 S 230 80 280 66 S 360 50 400 60"/>
    </svg>`;

    const cloudImg = (name, cls) => `<div class="wxw-cloud ${cls}"><img src="${ART}${name}.png" srcset="${ART}${name}.png 1x, ${ART}${name}@2x.png 2x" alt="" draggable="false"></div>`;

    function sceneHtml() {
        return `
            <div class="wxw-sky"></div>
            <div class="wxw-stars"><i></i><i></i></div>
            <div class="wxw-sun"><div class="wxw-sun-rays"></div><div class="wxw-sun-disc"></div><div class="wxw-flare"></div></div>
            <div class="wxw-moon"><img src="${ART}moon.png" srcset="${ART}moon.png 1x, ${ART}moon@2x.png 2x" alt="" draggable="false"><div class="wxw-moon-shadow"></div></div>
            <div class="wxw-clouds wxw-clouds-light">${cloudImg('cloud-a', 'c1')}${cloudImg('cloud-b', 'c2')}${cloudImg('cloud-c', 'c3')}${cloudImg('cloud-b', 'c4')}${cloudImg('cloud-a', 'c5')}</div>
            <div class="wxw-clouds wxw-clouds-dark">${cloudImg('cloud-c-dark', 'c3')}${cloudImg('cloud-a-dark', 'c1')}${cloudImg('cloud-b-dark', 'c2')}${cloudImg('cloud-a-dark', 'c5')}</div>
            <div class="wxw-fog"><i></i><i></i></div>
            <div class="wxw-rain"><i></i><i></i></div>
            <div class="wxw-snow"><i></i><i></i></div>
            <div class="wxw-flash"><svg viewBox="0 0 40 90" aria-hidden="true"><path d="M24 0 L6 48 L18 48 L10 90 L34 34 L21 34 L30 0 Z"/></svg></div>
            ${HILLS}
            <div class="wxw-shine"></div>
            <div class="wxw-hero">
                <div class="wxw-clock"><div class="wxw-time"><span class="wxw-hhmm">--:--</span><span class="wxw-ampm"></span></div><div class="wxw-date"></div></div>
                <div class="wxw-now">
                    <div class="wxw-temp"><span class="wxw-deg">--</span><span class="wxw-unit"></span></div>
                    <div class="wxw-cond"></div>
                    <div class="wxw-hilo"></div>
                </div>
            </div>`;
    }

    const GLYPH = {
        feels: '<svg viewBox="0 0 16 16"><path d="M7 2.5a1.5 1.5 0 0 1 3 0v6.6a3 3 0 1 1-3 0z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8.5" cy="11.6" r="1.5" fill="currentColor"/><path d="M8.5 6v5" stroke="currentColor" stroke-width="1.3"/></svg>',
        wind: '<svg viewBox="0 0 16 16"><path d="M8 1.5 L12 13 L8 10.5 L4 13 Z" fill="currentColor"/></svg>',
        humidity: '<svg viewBox="0 0 16 16"><path d="M8 1.5 C 9 4 12.5 7 12.5 10 A 4.5 4.5 0 0 1 3.5 10 C 3.5 7 7 4 8 1.5 Z" fill="currentColor"/></svg>',
        sun: '<svg viewBox="0 0 16 16"><path d="M3 11 A5 5 0 0 1 13 11 Z" fill="currentColor"/><path d="M1 13h14" stroke="currentColor" stroke-width="1.4"/><path d="M8 2v2M3 4.5l1.3 1.3M13 4.5l-1.3 1.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        pin: '<svg viewBox="0 0 16 16"><path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.4-4.5 8.5-4.5 8.5S3.5 9.4 3.5 6A4.5 4.5 0 0 1 8 1.5z" fill="currentColor"/><circle cx="8" cy="6" r="1.7" fill="#fff"/></svg>'
    };

    function build() {
        page.innerHTML = `
            <div class="wxw-root">
                <div class="wxw-plate">
                    <button type="button" class="wxw-arrow wxw-prev" aria-label="Previous place"></button>
                    <div class="wxw-place">
                        <div class="wxw-place-name"></div>
                        <div class="wxw-place-sub"></div>
                        <div class="wxw-dots"></div>
                    </div>
                    <button type="button" class="wxw-arrow wxw-next" aria-label="Next place"></button>
                </div>
                <div class="wxw-main">
                    <div class="wxw-left">
                        <div class="wxw-scene" data-phase="day" data-scene="fair">${sceneHtml()}</div>
                        <div class="wxw-gauges">
                            <div class="wxw-gauge" data-k="feels"><i>${GLYPH.feels}</i><b></b><span>Feels like</span></div>
                            <div class="wxw-gauge" data-k="wind"><i>${GLYPH.wind}</i><b></b><span>Wind</span></div>
                            <div class="wxw-gauge" data-k="humidity"><i>${GLYPH.humidity}</i><b></b><span>Humidity</span></div>
                            <div class="wxw-gauge" data-k="sun"><i>${GLYPH.sun}</i><b></b><span></span></div>
                        </div>
                    </div>
                    <div class="wxw-right">
                        <div class="wxw-section"><span>Hourly</span></div>
                        <div class="wxw-rail"><div class="wxw-hours"></div></div>
                        <div class="wxw-section"><span>7-Day Forecast</span></div>
                        <div class="wxw-days"></div>
                        <div class="wxw-foot"></div>
                    </div>
                </div>
                <div class="wxw-empty" hidden>
                    <div class="wxw-empty-card">
                        ${iconImg('partly-day', 'wxw-empty-icon')}
                        <div class="wxw-empty-title">No places yet</div>
                        <div class="wxw-empty-text">Add a city to see its weather.</div>
                        <button type="button" class="wxw-glass-btn wxw-empty-add">Add Location</button>
                    </div>
                </div>
                <div class="wxw-layer wxw-places-layer" hidden>
                    <div class="wxw-layer-head">Tap a place to show it. Tap and hold for more.</div>
                    <div class="wxw-tiles"></div>
                </div>
                <div class="wxw-layer wxw-add-layer" hidden>
                    <div class="wxw-add-box">
                        <label class="wxw-add-label" for="wxwAddInput">City or town:</label>
                        <div class="wxw-add-row">
                            <input id="wxwAddInput" class="wxw-add-input" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search">
                            <button type="button" class="wxw-glass-btn wxw-add-go">Search</button>
                        </div>
                    </div>
                    <div class="wxw-results"></div>
                </div>
            </div>`;
        const q = (s) => page.querySelector(s);
        els = {
            root: q('.wxw-root'),
            plate: q('.wxw-plate'),
            name: q('.wxw-place-name'),
            sub: q('.wxw-place-sub'),
            dots: q('.wxw-dots'),
            prev: q('.wxw-prev'),
            next: q('.wxw-next'),
            main: q('.wxw-main'),
            scene: q('.wxw-scene'),
            hero: q('.wxw-hero'),
            hhmm: q('.wxw-hhmm'),
            ampm: q('.wxw-ampm'),
            date: q('.wxw-date'),
            deg: q('.wxw-deg'),
            unit: q('.wxw-unit'),
            cond: q('.wxw-cond'),
            hilo: q('.wxw-hilo'),
            moonShadow: q('.wxw-moon-shadow'),
            gauges: q('.wxw-gauges'),
            hours: q('.wxw-hours'),
            days: q('.wxw-days'),
            foot: q('.wxw-foot'),
            empty: q('.wxw-empty'),
            places: q('.wxw-places-layer'),
            tiles: q('.wxw-tiles'),
            add: q('.wxw-add-layer'),
            input: q('.wxw-add-input'),
            results: q('.wxw-results')
        };
        els.prev.addEventListener('click', () => step(-1));
        els.next.addEventListener('click', () => step(1));
        q('.wxw-empty-add').addEventListener('click', openAdd);
        q('.wxw-add-go').addEventListener('click', search);
        els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
        els.days.addEventListener('click', (e) => {
            const card = e.target.closest('.wxw-card');
            if (!card) return;
            const d = card.dataset.date;
            if (flipped.has(d)) flipped.delete(d); else flipped.add(d);
            card.classList.toggle('is-flipped', flipped.has(d));
        });
        els.results.addEventListener('click', (e) => {
            const row = e.target.closest('.wxw-result');
            if (row) addPlace(addResults[Number(row.dataset.i)]);
        });
        bindTiles();
        bindSwipe();
    }

    // ---------------------------------------------------------------- render

    function render() {
        if (!els || !page) return;
        const list = places();
        const p = selected();
        els.empty.hidden = !!p;
        els.main.hidden = !p;
        renderPlate(list, p);
        if (layers.includes('places')) renderTiles();
        if (!p) return;
        const data = dataOf(p);
        renderScene(data);
        renderGauges(data);
        renderHours(data);
        renderDays(data);
        const c = cache[keyOf(p)];
        els.foot.textContent = c ? `Updated ${updatedText(c.at)}  ·  Forecast data: Open-Meteo` : 'Forecast data: Open-Meteo';
        tickClock();
    }

    function updatedText(at) {
        const d = new Date(at);
        const h = d.getHours();
        const m = String(d.getMinutes()).padStart(2, '0');
        const time = H12 ? `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${String(h).padStart(2, '0')}:${m}`;
        return new Date().toDateString() === d.toDateString() ? time : `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${time}`;
    }

    function renderPlate(list, p) {
        const many = list.length > 1;
        els.plate.classList.toggle('is-single', !many);
        els.name.textContent = p ? p.name : 'Weather';
        els.name.classList.toggle('is-here', !!(p && p.here));
        els.name.innerHTML = p ? `${p.here ? `<i class="wxw-pin">${GLYPH.pin}</i>` : ''}${ws.escapeHtml(p.name)}` : 'Weather';
        els.sub.textContent = p ? (p.here ? 'Current location' : [p.region, p.country].filter(Boolean).join(', ')) : '';
        els.dots.innerHTML = many ? list.map((x) => `<i class="${p && x.id === p.id ? 'is-on' : ''}"></i>`).join('') : '';
    }

    function renderScene(data) {
        const s = els.scene;
        if (!data || !data.current) {
            s.dataset.phase = 'day';
            s.dataset.scene = 'fair';
            els.deg.textContent = '--';
            els.unit.textContent = '';
            els.cond.textContent = '';
            els.hilo.textContent = '';
            return;
        }
        const cur = data.current;
        const cond = condition(cur.code, cur.isDay !== false);
        const phase = phaseOf(data);
        s.dataset.phase = phase;
        s.dataset.scene = cond.scene;
        const v = tempOf(cur.tempC);
        els.deg.textContent = v == null ? '--' : String(v);
        els.unit.textContent = `°${unit()}`;
        els.cond.textContent = cond.text;
        const today = data.daily && data.daily[0];
        els.hilo.innerHTML = today ? `<span>H</span> ${temp(today.maxC)}&ensp;<span>L</span> ${temp(today.minC)}` : '';
        // the moon's phase: a shadow disc that slides across (waxing lights the right side)
        const age = moonAge();
        const x = age < 0.5 ? -(age / 0.5) * 100 : (1 - (age - 0.5) / 0.5) * 100;
        els.moonShadow.style.transform = `translateX(${x.toFixed(1)}%)`;
    }

    function renderGauges(data) {
        const g = (k) => els.gauges.querySelector(`[data-k="${k}"]`);
        const cur = data && data.current;
        const today = data && data.daily && data.daily[0];
        g('feels').querySelector('b').textContent = cur ? temp(cur.feelsC) : '--';
        const w = g('wind');
        w.querySelector('b').textContent = cur && cur.windKmh != null ? wind(cur.windKmh) : '--';
        w.querySelector('span').textContent = `Wind ${cur ? compass(cur.windDir) : ''}`.trim();
        // the arrow points where the wind blows to
        w.querySelector('i svg').style.transform = cur && cur.windDir != null ? `rotate(${(Number(cur.windDir) + 180) % 360}deg)` : '';
        g('humidity').querySelector('b').textContent = cur && cur.humidity != null ? `${Math.round(cur.humidity)}%` : '--';
        const sun = g('sun');
        let label = 'Sunrise';
        let value = '--';
        if (today && today.sunrise && today.sunset) {
            const now = placeNow(data);
            const set = localMs(today.sunset);
            const rise = localMs(today.sunrise);
            const tomorrow = data.daily[1];
            if (now < rise) { label = 'Sunrise'; value = hm(today.sunrise); } else if (now < set) { label = 'Sunset'; value = hm(today.sunset); } else { label = 'Sunrise'; value = tomorrow && tomorrow.sunrise ? hm(tomorrow.sunrise) : hm(today.sunrise); }
        }
        sun.querySelector('b').textContent = value;
        sun.querySelector('span').textContent = label;
    }

    function renderHours(data) {
        const rail = els.hours.parentElement;
        const hours = data && data.hourly ? data.hourly : [];
        if (!hours.length) {
            rail.classList.add('is-empty');
            els.hours.innerHTML = `<div class="wxw-hours-none">${data && data.gadgetOnly ? 'Hourly forecast is not available for this place.' : 'No hourly forecast yet.'}</div>`;
            return;
        }
        rail.classList.remove('is-empty');
        const now = placeNow(data);
        const from = hours.findIndex((h) => localMs(h.time) + 3600000 > now);
        const list = hours.slice(Math.max(0, from), Math.max(0, from) + 24);
        els.hours.innerHTML = list.map((h, i) => {
            const cond = condition(h.code, h.isDay);
            const rain = num(h.rain);
            return `<div class="wxw-hour${i === 0 ? ' is-now' : ''}">
                <div class="wxw-hour-time">${i === 0 ? 'Now' : hourLabel(h.time)}</div>
                ${iconImg(cond.icon, 'wxw-hour-icon')}
                <div class="wxw-hour-temp">${temp(h.tempC)}</div>
                <div class="wxw-hour-rain">${rain != null && rain >= 10 ? `${Math.round(rain)}%` : '&nbsp;'}</div>
            </div>`;
        }).join('');
    }

    /** -10 C deep blue .. 35 C red, for the range bars. */
    function tempHue(c) {
        const t = Math.max(-10, Math.min(35, Number(c)));
        return Math.round(215 - ((t + 10) / 45) * 210);
    }

    function renderDays(data) {
        const days = data && data.daily ? data.daily.slice(0, 7) : [];
        if (!days.length) { els.days.innerHTML = ''; return; }
        const mins = days.map((d) => num(d.minC)).filter((v) => v != null);
        const maxs = days.map((d) => num(d.maxC)).filter((v) => v != null);
        const lo = Math.min(...mins);
        const hi = Math.max(...maxs);
        const span = Math.max(1, hi - lo);
        els.days.innerHTML = days.map((d, i) => {
            const cond = condition(d.code, true);
            const dow = dayOf(d.date);
            const name = i === 0 ? 'Today' : DAYS[dow].slice(0, 3);
            const left = num(d.minC) == null ? 0 : ((d.minC - lo) / span) * 100;
            const width = num(d.maxC) == null || num(d.minC) == null ? 0 : Math.max(6, ((d.maxC - d.minC) / span) * 100);
            const rain = num(d.rain);
            const uv = num(d.uv);
            const dt = new Date(localMs(d.date));
            const backRows = [
                ['Rain', rain == null ? '--' : `${Math.round(rain)}%`],
                ['Wind', d.windKmh == null ? '--' : `${wind(d.windKmh)} ${compass(d.windDir)}`.trim()],
                ['UV index', uv == null ? '--' : `${Math.round(uv)} ${uvWord(uv)}`],
                ['Sun', d.sunrise ? `${hm(d.sunrise)} – ${hm(d.sunset)}` : '--']
            ];
            return `<div class="wxw-card${flipped.has(d.date) ? ' is-flipped' : ''}" data-date="${d.date}" role="button" tabindex="-1">
                <div class="wxw-card-in">
                    <div class="wxw-face wxw-front">
                        <div class="wxw-day">${name}</div>
                        ${iconImg(cond.icon, 'wxw-day-icon')}
                        <div class="wxw-day-cond">${cond.text}${rain != null && rain >= 30 ? ` <em>${Math.round(rain)}%</em>` : ''}</div>
                        <div class="wxw-range">
                            <span class="wxw-lo">${temp(d.minC)}</span>
                            <span class="wxw-bar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:linear-gradient(90deg,hsl(${tempHue(d.minC)} 85% 55%),hsl(${tempHue(d.maxC)} 90% 52%))"></i></span>
                            <span class="wxw-hi">${temp(d.maxC)}</span>
                        </div>
                    </div>
                    <div class="wxw-face wxw-back">
                        <div class="wxw-back-day">${DAYS[dow]}, ${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCDate()}</div>
                        <div class="wxw-back-grid">${backRows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function tickClock() {
        clearTimeout(clockTimer);
        clockTimer = null;
        if (!els || !shown) return;
        const p = selected();
        const data = dataOf(p);
        const now = new Date(data && !data.gadgetOnly ? placeNow(data) : Date.now() - new Date().getTimezoneOffset() * 60000);
        const h = now.getUTCHours();
        const m = String(now.getUTCMinutes()).padStart(2, '0');
        els.hhmm.textContent = H12 ? `${h % 12 || 12}:${m}` : `${String(h).padStart(2, '0')}:${m}`;
        els.ampm.textContent = H12 ? (h < 12 ? 'AM' : 'PM') : '';
        els.date.textContent = `${DAYS[now.getUTCDay()]}, ${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}`;
        // the sky follows the clock across dawn and dusk without a refresh
        if (data && data.current && els.scene.dataset.phase !== phaseOf(data)) renderScene(data);
        clockTimer = setTimeout(tickClock, 60500 - (Date.now() % 60000));
    }

    // ---------------------------------------------------------------- switching places

    function step(dir) {
        const list = places();
        if (list.length < 2) return;
        const p = selected();
        const at = Math.max(0, list.findIndex((x) => p && x.id === p.id));
        select(list[(at + dir + list.length) % list.length].id, dir);
    }

    function select(id, dir = 0) {
        selectedId = id;
        save(LS.selected, id);
        flipped = new Set();
        if (els && dir) {
            els.root.classList.remove('slide-l', 'slide-r');
            void els.root.offsetWidth;
            els.root.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
        }
        render();
        if (els) els.main.scrollTop = 0;
        changed();
        const p = selected();
        if (p && !fresh(p)) {
            // switching is a tap: the cursor shows if it takes a moment, and a failure answers it
            const hadData = !!dataOf(p);
            const work = update(p).then(() => { changed(); render(); });
            if (hadData) work.catch(() => {});
            else ws.busy(work, { delay: 250, timeout: 20000 }).catch(() => ws.messageBox({ title: 'Weather', icon: 'error', text: `The weather for ${p.name} could not be loaded. Check the data connection, then try again.` }));
        }
    }

    function bindSwipe() {
        let start = null;
        els.scene.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, t: Date.now() }; });
        els.scene.addEventListener('pointerup', (e) => {
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            const quick = Date.now() - start.t < 700;
            start = null;
            if (quick && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1);
        });
        els.scene.addEventListener('pointercancel', () => { start = null; });
    }

    // ---------------------------------------------------------------- layers

    function pushLayer(name) {
        if (layers[layers.length - 1] === name) return;
        layers.push(name);
        syncLayers();
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
        els.places.hidden = !layers.includes('places') || top !== 'places';
        els.add.hidden = top !== 'add';
        if (top === 'places') renderTiles();
        if (top !== 'add' && document.activeElement === els.input) els.input.blur();
        ws.setTitle(top === 'places' ? 'Locations' : top === 'add' ? 'Add Location' : 'Weather');
        ws.syncHistory();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    function openPlaces() { pushLayer('places'); }

    function openAdd() {
        addResults = [];
        els.results.innerHTML = '';
        els.input.value = '';
        pushLayer('add');
        // the field takes the tap's focus (WM opens the input panel with it)
        els.input.focus();
    }

    function renderTiles() {
        const list = places();
        const p = selected();
        els.tiles.innerHTML = list.length ? list.map((x) => {
            const data = dataOf(x);
            const cur = data && data.current;
            const cond = cur ? condition(cur.code, cur.isDay !== false) : null;
            const today = data && data.daily && data.daily[0];
            return `<div class="wxw-tile${p && x.id === p.id ? ' is-on' : ''}" data-id="${ws.escapeHtml(x.id)}" data-phase="${data && cur ? phaseOf(data) : 'day'}" data-scene="${cond ? cond.scene : 'fair'}">
                <div class="wxw-tile-text">
                    <div class="wxw-tile-name">${x.here ? `<i class="wxw-pin">${GLYPH.pin}</i>` : ''}${ws.escapeHtml(x.name)}</div>
                    <div class="wxw-tile-sub">${ws.escapeHtml(x.here ? 'Current location' : [x.region, x.country].filter(Boolean).join(', '))}</div>
                    <div class="wxw-tile-cond">${cond ? cond.text : '&nbsp;'}</div>
                </div>
                ${cond ? iconImg(cond.icon, 'wxw-tile-icon') : ''}
                <div class="wxw-tile-temp"><b>${cur ? temp(cur.tempC) : '--'}</b><span>${today ? `${temp(today.maxC)} / ${temp(today.minC)}` : ''}</span></div>
            </div>`;
        }).join('') : '<div class="wxw-tiles-none">No places. Tap Add to add a city.</div>';
    }

    function bindTiles() {
        let hold = null;
        let held = false;
        const cancel = () => { clearTimeout(hold); hold = null; };
        els.tiles.addEventListener('pointerdown', (e) => {
            const tile = e.target.closest('.wxw-tile');
            if (!tile) return;
            held = false;
            cancel();
            const x = e.clientX;
            const y = e.clientY;
            hold = setTimeout(() => { held = true; tileMenu(tile.dataset.id, x, y); }, 550);
        });
        els.tiles.addEventListener('pointerup', cancel);
        els.tiles.addEventListener('pointercancel', cancel);
        els.tiles.addEventListener('pointermove', (e) => { if (hold && (Math.abs(e.movementX) + Math.abs(e.movementY)) > 6) cancel(); });
        els.tiles.addEventListener('contextmenu', (e) => e.preventDefault());
        els.tiles.addEventListener('click', (e) => {
            const tile = e.target.closest('.wxw-tile');
            if (!tile || held) { held = false; return; }
            select(tile.dataset.id);
            popLayer();
        });
    }

    function tileMenu(id, x, y) {
        const at = saved.findIndex((p) => p.id === id);
        const items = [{ label: 'Show', action: () => { select(id); popLayer(); } }];
        if (at >= 0) {
            items.push('-',
                { label: 'Move Up', disabled: at === 0, action: () => move(id, -1) },
                { label: 'Move Down', disabled: at === saved.length - 1, action: () => move(id, 1) },
                '-',
                { label: 'Remove', action: () => remove(id) });
        }
        ws.menuAt(x, y, items);
    }

    function move(id, dir) {
        const at = saved.findIndex((p) => p.id === id);
        const to = at + dir;
        if (at < 0 || to < 0 || to >= saved.length) return;
        const [p] = saved.splice(at, 1);
        saved.splice(to, 0, p);
        save(LS.places, saved);
        render();
    }

    async function remove(id) {
        const p = saved.find((x) => x.id === id);
        if (!p) return;
        const ok = await ws.messageBox({
            title: 'Weather',
            icon: 'question',
            text: `Remove ${p.name} from your places?`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }]
        });
        if (!ok) return;
        saved = saved.filter((x) => x.id !== id);
        save(LS.places, saved);
        save(LS.seeded, true);
        if (selectedId === id) { selectedId = places()[0] ? places()[0].id : null; save(LS.selected, selectedId); }
        persistCache();
        render();
        changed();
    }

    async function search() {
        const name = els.input.value.trim();
        if (!name || addBusy) return;
        addBusy = true;
        els.input.blur();
        let hits = [];
        let failed = false;
        try {
            hits = await ws.busy(() => geocode(name).catch(() => lookupCity(name)), { delay: 200, timeout: 15000 });
        } catch (_) { failed = true; }
        addBusy = false;
        addResults = hits;
        if (failed) {
            els.results.innerHTML = '';
            ws.messageBox({ title: 'Weather', icon: 'error', text: 'Places could not be searched. Check the data connection, then try again.' });
            return;
        }
        if (!hits.length) {
            els.results.innerHTML = '';
            ws.messageBox({ title: 'Weather', icon: 'info', text: `No place called "${name}" was found. Check the spelling, or try a larger town nearby.` });
            return;
        }
        els.results.innerHTML = hits.map((r, i) => `<div class="wxw-result" data-i="${i}">
            <div class="wxw-result-name">${ws.escapeHtml(r.name)}</div>
            <div class="wxw-result-sub">${ws.escapeHtml([r.region, r.country].filter(Boolean).join(', '))}</div>
        </div>`).join('');
    }

    function addPlace(r) {
        if (!r) return;
        const dupe = places().find((p) => Number.isFinite(p.lat) && Math.abs(p.lat - r.lat) < 0.02 && Math.abs(p.lon - r.lon) < 0.02);
        layers = [];
        syncLayers();
        if (dupe) { select(dupe.id); return; }
        const p = { id: placeId(), name: r.name, region: r.region, country: r.country, lat: r.lat, lon: r.lon };
        saved.push(p);
        save(LS.places, saved);
        select(p.id);
    }

    // ---------------------------------------------------------------- shell

    function setUnit(u) {
        unitPicked = u;
        save(LS.unit, u);
        render();
        changed();
    }

    function about() {
        ws.messageBox({
            title: 'Weather',
            icon: 'info',
            text: 'Melaton Weather\nVersion 1.0\n\nCopyright © 2026 Xyridian Corporation. All rights reserved.\n\nForecast data: Open-Meteo.com (CC BY 4.0).'
        });
    }

    function mainMenu() {
        return [
            { label: 'Locations', action: openPlaces },
            { label: 'Add Location...', action: openAdd },
            '-',
            {
                label: 'Units',
                submenu: () => [
                    { label: 'Celsius (°C, km/h)', radio: unit() === 'C', action: () => setUnit('C') },
                    { label: 'Fahrenheit (°F, mph)', radio: unit() === 'F', action: () => setUnit('F') }
                ]
            },
            { label: 'Refresh', disabled: !selected(), action: userRefresh },
            '-',
            { label: 'About', action: about }
        ];
    }

    function placesMenu() {
        const list = saved.slice();
        return [
            { label: 'Add Location...', action: openAdd },
            { label: 'Remove', disabled: !list.length, submenu: () => list.map((p) => ({ label: p.name, action: () => remove(p.id) })) },
            '-',
            { label: 'Refresh All', disabled: !places().length, action: refreshAll },
            '-',
            { label: 'Done', action: popLayer }
        ];
    }

    async function refreshAll() {
        const list = places().filter((p) => Number.isFinite(p.lat) || p.id === 'here');
        let failed = 0;
        await ws.busy(() => Promise.all(list.map((p) => update(p).catch(() => { failed++; }))), { delay: 250, timeout: 30000 });
        changed();
        render();
        if (failed) ws.messageBox({ title: 'Weather', icon: 'error', text: failed === list.length ? 'Weather information could not be updated. Check the data connection, then try again.' : 'Some places could not be updated. Try again later.' });
    }

    function onKey(e) {
        if (!shown || ws.current !== APP_ID || layers.length || ws.isBusy()) return;
        const t = e.target;
        if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
        if (document.querySelector('#wmShell .wm-popup, #wmShell .wm-msgbox-layer:not([hidden])')) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    }

    function startPoll() {
        clearInterval(pollTimer);
        pollTimer = setInterval(() => { if (shown && !document.hidden) quiet(false); }, 60 * 1000);
    }

    function register() {
        ws = window.wmShell;
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('visibilitychange', () => {
            if (!els) return;
            els.root.classList.toggle('is-paused', document.hidden);
            if (!document.hidden && shown) { tickClock(); quiet(false); }
        });
        ws.registerApp({
            id: APP_ID,
            title: 'Weather',
            icon: 'app-weather',
            inStart: 'programs',
            sip: true,
            mount(p) {
                page = p;
                p.classList.add('wm-weather');
                build();
            },
            show() {
                shown = true;
                els.root.classList.remove('is-paused');
                syncLayers();
                render();
                startPoll();
                // opening is a tap: a first load without any data shows the cursor and answers a failure
                const p = selected();
                if (p && !dataOf(p)) {
                    ws.busy(update(p).then(() => { changed(); render(); }), { delay: 250, timeout: 20000 })
                        .catch(() => ws.messageBox({ title: 'Weather', icon: 'error', text: 'Weather information could not be loaded. Check the data connection, then try again.' }));
                } else {
                    quiet(false);
                }
                if (!p) quiet(false);
            },
            hide() {
                shown = false;
                clearTimeout(clockTimer);
                clockTimer = null;
                clearInterval(pollTimer);
                pollTimer = null;
                if (els) els.root.classList.add('is-paused');
            },
            historyDepth: () => layers.length,
            onBack: () => popLayer(),
            titleKind: () => (layers.length ? 'ok' : 'close'),
            onTitleOk: () => popLayer(),
            onTitleClose() { layers = []; },
            softKeys() {
                const top = layers[layers.length - 1];
                if (top === 'add') {
                    return {
                        left: { label: 'Search', action: search },
                        right: { label: 'Cancel', action: popLayer }
                    };
                }
                if (top === 'places') {
                    return {
                        left: { label: 'Add', action: openAdd },
                        right: { label: 'Menu', menu: placesMenu }
                    };
                }
                return {
                    left: { label: 'Refresh', disabled: !selected(), action: userRefresh },
                    right: { label: 'Menu', menu: mainMenu }
                };
            }
        });
    }

    // ---------------------------------------------------------------- accessor (Today)

    let lastAsk = 0;

    window.wmWeather = {
        /**
         * The selected place now: { place, region, here, tempC, temp, unit, code, condition, icon, iconUrl,
         * isDay, hiC, loC, hi, lo, updatedAt } or null before the first data. A stale or missing value
         * starts a quiet update (at most once a minute); 'wmWeatherChange' fires when it lands.
         */
        current() {
            const p = selected();
            const data = dataOf(p);
            if (!document.hidden && Date.now() - lastAsk > RETRY_MS && (!p || !fresh(p))) {
                lastAsk = Date.now();
                quiet(false);
            }
            if (!p || !data || !data.current) return null;
            const cur = data.current;
            const cond = condition(cur.code, cur.isDay !== false);
            const today = data.daily && data.daily[0];
            return {
                place: p.name,
                region: p.here ? '' : [p.region, p.country].filter(Boolean).join(', '),
                here: !!p.here,
                tempC: num(cur.tempC),
                temp: tempOf(cur.tempC),
                unit: unit(),
                code: cur.code,
                condition: cond.text,
                icon: cond.icon,
                iconUrl: iconUrl(cond.icon),
                iconUrl2x: iconUrl(cond.icon, true),
                isDay: cur.isDay !== false,
                hiC: today ? num(today.maxC) : null,
                loC: today ? num(today.minC) : null,
                hi: today ? tempOf(today.maxC) : null,
                lo: today ? tempOf(today.minC) : null,
                updatedAt: (cache[keyOf(p)] || {}).at || null
            };
        },
        open() { if (ws) ws.open(APP_ID); },
        refresh() { return quiet(false); },
        unit: () => unit(),
        iconUrl
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
