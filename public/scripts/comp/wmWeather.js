/**
 * Melaton Mobile: Weather (Yozora #732). Yukimi, Nov 10: "a well designed weather app that's designed
 * like a premium 2009 Windows Mobile app with skeuomorphism". Our own design and art: a brushed-metal
 * location plate, a live sky scene (time of day and condition: sun with turning rays, drifting clouds,
 * rain, snow, storm flashes, a night sky with stars and the moon's phase) behind a glass clock capsule
 * and big glossy temperature numerals, a glass gauge bar (feels like, wind, humidity, sunrise and
 * sunset), a polished hourly rail and 7-day forecast cards that flip over for details. The WM 6.1
 * shell stays around it (title bar, soft keys Refresh | Menu).
 *
 * Data: the server's weather service (modules/weatherService.js, Yozora #780), which caches, rate
 * limits and picks the provider: Apple Weather when an Apple Weather service key is saved in
 * Dreamscape CardSpace, Open-Meteo otherwise. weather_forecast gives one model for both: current
 * conditions, the next hour (minutely), 72 hours, 10 days and alerts (Apple's, or the National
 * Weather Service's in the US). The gadget's own place (client IP, then the configured home:
 * weather_forecast { here }, admins only) is "Current location"; places the user adds
 * (weather_geocode) are kept on the phone. Units follow the gadget's setting until picked here.
 *
 * Pages (#780): alerts banner and Alert page, Next Hour precipitation chart, Graphs (temperature,
 * precipitation, wind, humidity, UV, pressure over 24 / 48 / 72 h), Conditions (UV, visibility,
 * pressure trend, dew point, clouds, gusts, precipitation), Sun & Moon, a Day page per forecast
 * day (daytime and overnight, sun and moon times), and Radar (base map with the last two hours of
 * radar, animated; weather_radar + /weather/tile). Apple Weather's mark and link when it answers.
 * Alerts the server broadcasts for the primary location arrive as WM notifications
 * (weatherAlerts.js), and View opens them here (showAlert).
 *
 * Loading: a refresh the user asked for shows the WM wait cursor and errors as a message box; routine
 * updates (every 15 min while open, Today asking for data) show nothing.
 *
 * window.wmWeather: current() -> summary of the selected place (or null), open(), refresh(), unit(),
 * showAlert(alert), alerts() -> the selected place's alerts;
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

    // ---------------------------------------------------------------- Home and Work (#792)
    //
    // Home and Work live on the server (weather_places_*: the monitor watches them for alerts and the
    // rain alarm); every client shows them first. Current location inside Home's or Work's radius is
    // that place: one tile, one fetch ("Home · Current location").
    const MONITORED = ['home', 'work'];
    const PLACE_LABEL = { home: 'Home', work: 'Work' };
    let monitored = load('wmWeatherMonitored', {}); // { home, work } as the server keeps them
    let rainStatus = null; // weather_rain_status
    let activeAlerts = null; // weather_alerts_active
    const settings = Object.assign({ feels: false, effects: true }, load('wmWeatherSettings', {}));
    const saveSettings = () => save('wmWeatherSettings', settings);

    function distKm(a, b) {
        const r = (d) => (d * Math.PI) / 180;
        const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
        return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    /** 'home' / 'work' when Current location lies inside that place's radius, else null. */
    function hereInside() {
        if (!here || !Number.isFinite(here.lat)) return null;
        let best = null;
        MONITORED.forEach((id) => {
            const m = monitored[id];
            if (!m || !Number.isFinite(m.lat)) return;
            const km = distKm(here, m);
            if (km <= (m.radiusKm || 3) && (!best || km < best.km)) best = { id, km };
        });
        return best ? best.id : null;
    }

    function places() {
        const list = [];
        const inside = hereInside();
        MONITORED.forEach((id) => {
            const m = monitored[id];
            if (m && Number.isFinite(m.lat)) list.push(Object.assign({}, m, { id, monitored: id, here: inside === id }));
        });
        if (here && here.name && !inside) list.push(Object.assign({ id: 'here', here: true }, here));
        return list.concat(saved);
    }

    function selected() {
        const list = places();
        const want = selectedId === 'here' && hereInside() ? hereInside() : selectedId;
        return list.find((p) => p.id === want) || list[0] || null;
    }

    /** A place's second line: Home / Work (and Current location), or its region and country. */
    function placeSub(p) {
        if (p.monitored) return `${PLACE_LABEL[p.monitored]}${p.here ? ' · Current location' : ''}`;
        return p.here ? 'Current location' : [p.region, p.country].filter(Boolean).join(', ');
    }

    function applyMonitored(list) {
        if (!list || typeof list !== 'object') return;
        monitored = { home: list.home || null, work: list.work || null };
        save('wmWeatherMonitored', monitored);
        if (els) render();
        changed();
    }

    let monitoredAt = 0;
    async function loadMonitored() {
        try {
            const r = await ask('weather_places_get', {}, 12000);
            if (!r) return;
            monitoredAt = Date.now();
            if (r.rain) rainStatus = r.rain;
            if (r.alerts) activeAlerts = r.alerts;
            applyMonitored(r.places);
        } catch (_) { /* the stored copy stands */ }
    }

    /** Save a place as Home or Work on the server (administrators); a saved place of this phone moves there. */
    async function setMonitored(id, p) {
        if (!isAdmin()) {
            ws.messageBox({ title: 'Weather', icon: 'info', text: `Only the administrator can set ${PLACE_LABEL[id]}.` });
            return;
        }
        try {
            const r = await ws.busy(() => ask('weather_places_save', { places: { [id]: { name: p.name, region: p.region || '', country: p.country || '', lat: p.lat, lon: p.lon } } }), { delay: 250, timeout: 15000 });
            if (saved.some((x) => x.id === p.id)) {
                saved = saved.filter((x) => x.id !== p.id);
                save(LS.places, saved);
            }
            applyMonitored(r && r.places);
            select(id);
        } catch (err) {
            ws.messageBox({ title: 'Weather', icon: 'error', text: `${PLACE_LABEL[id]} could not be saved. ${(err && err.message) || ''}`.trim() });
        }
    }

    /** Change Home's / Work's own settings (alerts, rain alarm, lead, radius), or clear it (null). */
    async function patchMonitored(id, patch) {
        if (!isAdmin()) {
            ws.messageBox({ title: 'Weather', icon: 'info', text: 'Only the administrator can change Home and Work.' });
            return false;
        }
        try {
            const r = await ask('weather_places_save', { places: { [id]: patch === null ? null : patch } }, 15000);
            applyMonitored(r && r.places);
            return true;
        } catch (err) {
            ws.messageBox({ title: 'Weather', icon: 'error', text: `The change could not be saved. ${(err && err.message) || ''}`.trim() });
            return false;
        }
    }

    /** Current location as a place of this phone (Save Location). */
    function saveHere() {
        if (!here || !Number.isFinite(here.lat)) return;
        addPlace({ name: here.name, region: here.region, country: here.country, lat: here.lat, lon: here.lon });
    }

    /**
     * For the shell's status icons (every 2 s: cheap): { alerts: [{ place, title, until }], rain: { text } | null }.
     * Alerts at Home / Work; rain due or falling where the rain alarm is on.
     */
    function statusState() {
        const alerts = [];
        const byPlace = (activeAlerts && activeAlerts.places) || {};
        MONITORED.forEach((id) => {
            const b = byPlace[id];
            if (!b || !Array.isArray(b.alerts)) return;
            b.alerts.forEach((a) => alerts.push({ id: a.id, place: PLACE_LABEL[id], title: a.title, until: dayTime(a.ends || a.expires) }));
        });
        let rain = null;
        const rp = (rainStatus && rainStatus.places) || {};
        MONITORED.forEach((id) => {
            const r = rp[id];
            if (rain || !r || !r.rainAlarm) return;
            if (r.wet) rain = { id, text: `${r.kind || 'Rain'} at ${PLACE_LABEL[id]} now${r.endsInMin ? `, stopping in about ${r.endsInMin} min` : ''}.` };
            else if (r.startsInMin != null) rain = { id, text: `${r.kind || 'Rain'} at ${PLACE_LABEL[id]} in about ${r.startsInMin} min.` };
        });
        return { alerts, rain };
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

    // single files for other code (Today, the 6.5 home screen: wmWeather.iconUrl)
    const iconUrl = (key, hd) => `${ART}wx-${key}${hd ? '@2x' : ''}.png`;
    // the app's own icons come from one sheet (wx-icons.png / @2x / @4x, wm-weather.css .wxw-ico):
    // one image for every hour, day and place. Order = scripts/build-wm-weather-sprites.sh ICONS.
    const ICON_CELLS = ['clear-day', 'clear-night', 'partly-day', 'partly-night', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'storm'];
    const iconImg = (key, cls) => `<i class="wxw-ico ${cls}" style="--i:${Math.max(0, ICON_CELLS.indexOf(key))}" aria-hidden="true"></i>`;

    // ---------------------------------------------------------------- units and times

    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const tempOf = (c) => { const v = num(c); return v == null ? null : Math.round(unit() === 'F' ? v * 9 / 5 + 32 : v); };
    const temp = (c) => { const v = tempOf(c); return v == null ? '--' : `${v}°`; };
    // Settings > Use feels-like as the main temperature (#792): the big numerals, hours, days and Today
    const mainC = (x) => (x ? (settings.feels && num(x.feelsC) != null ? x.feelsC : x.tempC) : null);
    const hiC = (d) => (d ? (settings.feels && num(d.feelsMaxC) != null ? d.feelsMaxC : d.maxC) : null);
    const loC = (d) => (d ? (settings.feels && num(d.feelsMinC) != null ? d.feelsMinC : d.minC) : null);
    const wind = (kmh) => {
        const v = num(kmh);
        if (v == null) return '--';
        return unit() === 'F' ? `${Math.round(v * 0.621371)} mph` : `${Math.round(v)} km/h`;
    };
    const compass = (deg) => (num(deg) == null ? '' : COMPASS[Math.round(((Number(deg) % 360) + 360) % 360 / 22.5) % 16]);
    const uvWord = (uv) => (uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very High' : 'Extreme');
    const imperial = () => unit() === 'F';
    const precip = (mm, digits) => {
        const v = num(mm);
        if (v == null) return '--';
        if (imperial()) { const inch = v / 25.4; return `${inch < 0.01 && inch > 0 ? '<0.01' : inch.toFixed(digits == null ? 2 : digits)} in`; }
        return `${v < 0.1 && v > 0 ? '<0.1' : (Math.round(v * 10) / 10)} mm`;
    };
    const distance = (m) => {
        const v = num(m);
        if (v == null) return '--';
        if (imperial()) { const mi = v / 1609.34; return `${mi >= 10 ? Math.round(mi) : mi.toFixed(1)} mi`; }
        const km = v / 1000;
        return `${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
    };
    const pressureText = (hpa) => {
        const v = num(hpa);
        if (v == null) return '--';
        return imperial() ? `${(v * 0.02953).toFixed(2)} inHg` : `${Math.round(v)} hPa`;
    };
    const TREND_WORD = { rising: 'Rising', falling: 'Falling', steady: 'Steady' };
    const MOON_AGE = { new: 0, waxingCrescent: 0.125, firstQuarter: 0.25, waxingGibbous: 0.375, full: 0.5, waningGibbous: 0.625, thirdQuarter: 0.75, waningCrescent: 0.875 };
    const MOON_WORD = { new: 'New Moon', waxingCrescent: 'Waxing Crescent', firstQuarter: 'First Quarter', waxingGibbous: 'Waxing Gibbous', full: 'Full Moon', waningGibbous: 'Waning Gibbous', thirdQuarter: 'Last Quarter', waningCrescent: 'Waning Crescent' };
    const SEVERITY_WORD = { extreme: 'Extreme', severe: 'Severe', moderate: 'Moderate', minor: 'Minor', unknown: '' };
    const duration = (sec) => {
        const v = num(sec);
        if (v == null) return '--';
        const h = Math.floor(v / 3600);
        const m = Math.round((v % 3600) / 60);
        return `${h}h ${String(m).padStart(2, '0')}m`;
    };
    /** A condition with the server's own words (Apple's "Breezy", "Scattered Showers") when it sent them. */
    const condOf = (item, isDay = true) => {
        const c = condition(item && item.code, isDay);
        return item && item.text ? Object.assign({}, c, { text: item.text }) : c;
    };

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

    /** 'YYYY-MM-DDTHH:MM' -> "Fri 11:00 AM" (the place's clock). */
    function dayTime(iso) {
        if (!iso || iso.length < 16) return '';
        return `${DAYS[dayOf(iso.slice(0, 10))].slice(0, 3)} ${hm(iso)}`;
    }

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

    /** A weather packet to the server (modules/ws/handlers/291-weatherHandler.js). */
    async function ask(type, payload, ms = 20000) {
        const c = wsClient();
        if (!c) throw new Error('Not connected');
        const r = await Promise.race([
            c.sendMessage(type, payload || {}, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms))
        ]);
        return r && r.data && typeof r.data === 'object' ? r.data : r;
    }

    /** The weather service's model for coordinates (see the header): the app keeps it as it comes. */
    async function fetchForecast(lat, lon) {
        const b = await ask('weather_forecast', { lat: Number(lat), lon: Number(lon) });
        if (!b || !b.current) throw new Error('No current conditions');
        return slim(b);
    }

    /** Drop what the app never shows before the copy goes to localStorage. */
    function slim(b) {
        const out = Object.assign({}, b);
        delete out.available;
        delete out.place;
        return out;
    }

    async function geocode(name, count = 8) {
        const b = await ask('weather_geocode', { name, count }, 12000);
        return (b && Array.isArray(b.results) ? b.results : []).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
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
        if (here && Number.isFinite(here.lat) && Date.now() - (here.at || 0) < HERE_MS) return;
        if (!wsClient()) return;
        let w;
        try {
            w = await ask('weather_forecast', { here: true });
        } catch (err) {
            if (/PERMISSION|Admin access/i.test(String((err && (err.code || err.message)) || err))) hereDenied = true;
            return;
        }
        if (!w || !w.available || !w.here || !w.here.name) return;
        const loc = w.here;
        const next = { name: loc.name, region: loc.region || '', country: loc.country || '', lat: Number(loc.lat), lon: Number(loc.lon), at: Date.now() };
        here = next;
        save(LS.here, here);
        if (w.current) {
            cache[keyOf(Object.assign({ id: 'here' }, here))] = { at: Date.now(), data: slim(w) };
            persistCache();
        }
        // the gadget's unit, until one is picked here (sidebar_get, admins too)
        const c = wsClient();
        if (c && !unitPicked && !gadgetUnit) {
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
                // the gadget's place from before it had coordinates: ask the server again
                if (here) here.at = 0;
                await resolveHere();
                if (!here || !Number.isFinite(here.lat)) throw new Error('No weather for this place');
                return true;
            }
            const before = cache[key] && cache[key].data;
            const data = await fetchForecast(p.lat, p.lon);
            cache[key] = { at: Date.now(), data };
            // a saved place's new alert notifies (Home / Work's come from the server's monitor); never
            // on a first load, so adding a place does not ring for alerts already running (#792)
            if (!p.monitored && before && Array.isArray(data.alerts) && window.weatherAlerts) {
                const had = new Set((before.alerts || []).map((a) => a.id));
                data.alerts.filter((a) => !had.has(a.id)).forEach((a) => window.weatherAlerts._onIssued({ data: { alert: a, place: { label: p.name, name: p.name } } }));
            }
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
        // Home / Work, their alerts and rain: again when the first ask came before the link was up
        if (Date.now() - monitoredAt > 10 * 60 * 1000) await loadMonitored();
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
        pin: '<svg viewBox="0 0 16 16"><path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.4-4.5 8.5-4.5 8.5S3.5 9.4 3.5 6A4.5 4.5 0 0 1 8 1.5z" fill="currentColor"/><circle cx="8" cy="6" r="1.7" fill="#fff"/></svg>',
        home: '<svg viewBox="0 0 16 16"><path d="M8 1.8 1.2 8h2v6.2h3.9V10h1.8v4.2h3.9V8h2z" fill="currentColor"/></svg>',
        work: '<svg viewBox="0 0 16 16"><path d="M6 2.5h4a1 1 0 0 1 1 1V5h3a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3V3.5a1 1 0 0 1 1-1zm.5 1.3V5h3V3.8zM1 8.6h14v1H9.3v1H6.7v-1H1z" fill="currentColor" fill-rule="evenodd"/></svg>'
    };

    /** The glyph before a place's name: house (Home), briefcase (Work), pin (Current location). */
    function placeGlyph(p) {
        if (p.monitored) return `<i class="wxw-pin is-${p.monitored}">${GLYPH[p.monitored]}</i>`;
        return p.here ? `<i class="wxw-pin">${GLYPH.pin}</i>` : '';
    }

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
                        <div class="wxw-alerts" hidden></div>
                        <div class="wxw-nexthour-wrap" hidden>
                            <div class="wxw-section"><span>Next Hour</span></div>
                            <div class="wxw-panel wxw-nexthour"></div>
                        </div>
                        <div class="wxw-section"><span>Hourly</span><button type="button" class="wxw-more wxw-graphs-btn">Graphs</button></div>
                        <div class="wxw-rail"><div class="wxw-hours"></div></div>
                        <div class="wxw-section"><span class="wxw-days-title">10-Day Forecast</span></div>
                        <div class="wxw-days"></div>
                        <div class="wxw-section"><span>Radar</span><button type="button" class="wxw-more wxw-radar-btn">Open</button></div>
                        <div class="wxw-panel wxw-radar-card" role="button" tabindex="-1"><div class="wxw-map wxw-map-mini"></div><div class="wxw-radar-card-time"></div></div>
                        <div class="wxw-section"><span>Conditions</span></div>
                        <div class="wxw-details"></div>
                        <div class="wxw-section"><span>Sun &amp; Moon</span></div>
                        <div class="wxw-panel wxw-sunmoon"></div>
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
                <div class="wxw-layer wxw-graphs-layer" hidden>
                    <div class="wxw-tabs wxw-graph-tabs"></div>
                    <div class="wxw-graph-head"><b class="wxw-graph-title"></b><span class="wxw-graph-sub"></span></div>
                    <div class="wxw-panel wxw-graph"></div>
                    <div class="wxw-tabs wxw-range-tabs"></div>
                    <div class="wxw-graph-table"></div>
                </div>
                <div class="wxw-layer wxw-radar-layer" hidden>
                    <div class="wxw-map wxw-map-full"></div>
                    <div class="wxw-map-zoom"><button type="button" data-z="1" aria-label="Zoom in">+</button><button type="button" data-z="-1" aria-label="Zoom out">&minus;</button><button type="button" data-z="0" aria-label="Center on the place" class="wxw-map-home"></button></div>
                    <div class="wxw-map-bar">
                        <button type="button" class="wxw-map-play" aria-label="Play"></button>
                        <div class="wxw-map-track"></div>
                        <div class="wxw-map-time"></div>
                    </div>
                    <div class="wxw-map-legend"><span>Light</span><i></i><span>Heavy</span></div>
                    <div class="wxw-map-attr"></div>
                </div>
                <div class="wxw-layer wxw-alert-layer" hidden><div class="wxw-alert-list"></div></div>
                <div class="wxw-layer wxw-settings-layer" hidden><div class="wm-form-hdr">Weather Settings</div><div class="wm-form wxw-settings"></div></div>
                <div class="wxw-layer wxw-day-layer" hidden><div class="wxw-day-page"></div></div>
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
            results: q('.wxw-results'),
            alerts: q('.wxw-alerts'),
            nextWrap: q('.wxw-nexthour-wrap'),
            next: q('.wxw-nexthour'),
            daysTitle: q('.wxw-days-title'),
            details: q('.wxw-details'),
            sunmoon: q('.wxw-sunmoon'),
            radarCard: q('.wxw-radar-card'),
            radarCardTime: q('.wxw-radar-card-time'),
            miniMap: q('.wxw-map-mini'),
            graphs: q('.wxw-graphs-layer'),
            graphTabs: q('.wxw-graph-tabs'),
            rangeTabs: q('.wxw-range-tabs'),
            graph: q('.wxw-graph'),
            graphTitle: q('.wxw-graph-title'),
            graphSub: q('.wxw-graph-sub'),
            graphTable: q('.wxw-graph-table'),
            radar: q('.wxw-radar-layer'),
            fullMap: q('.wxw-map-full'),
            mapPlay: q('.wxw-map-play'),
            mapTrack: q('.wxw-map-track'),
            mapTime: q('.wxw-map-time'),
            mapAttr: q('.wxw-map-attr'),
            alertLayer: q('.wxw-alert-layer'),
            alertList: q('.wxw-alert-list'),
            settingsLayer: q('.wxw-settings-layer'),
            settingsBody: q('.wxw-settings'),
            dayLayer: q('.wxw-day-layer'),
            dayPage: q('.wxw-day-page')
        };
        q('.wxw-graphs-btn').addEventListener('click', () => openGraphs());
        q('.wxw-radar-btn').addEventListener('click', () => openRadar());
        els.radarCard.addEventListener('click', () => openRadar());
        els.alerts.addEventListener('click', (e) => {
            const row = e.target.closest('[data-alert]');
            if (row) openAlerts(row.dataset.alert);
        });
        els.graphTabs.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) { graphKind = b.dataset.g; renderGraph(); } });
        els.rangeTabs.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { graphRange = Number(b.dataset.r); renderGraph(); } });
        els.graph.addEventListener('pointerdown', graphPoint);
        els.graph.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType !== 'mouse') graphPoint(e); });
        els.dayPage.addEventListener('click', (e) => { const b = e.target.closest('[data-day-step]'); if (b) stepDay(Number(b.dataset.dayStep)); });
        els.alertList.addEventListener('click', (e) => {
            const link = e.target.closest('[data-url]');
            if (link) openUrl(link.dataset.url);
        });
        q('.wxw-map-zoom').addEventListener('click', (e) => {
            const b = e.target.closest('[data-z]');
            if (!b || !fullMap) return;
            const dz = Number(b.dataset.z);
            if (dz === 0) fullMap.home(); else fullMap.zoomBy(dz);
        });
        els.mapPlay.addEventListener('click', () => toggleRadarPlay());
        els.foot.addEventListener('click', (e) => { const a = e.target.closest('[data-url]'); if (a) openUrl(a.dataset.url); });
        els.prev.addEventListener('click', () => step(-1));
        els.next.addEventListener('click', () => step(1));
        q('.wxw-empty-add').addEventListener('click', openAdd);
        q('.wxw-add-go').addEventListener('click', search);
        els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
        els.days.addEventListener('click', (e) => {
            const more = e.target.closest('.wxw-back-more');
            if (more) { e.stopPropagation(); openDay(more.dataset.date); return; }
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
        renderAlerts(data);
        renderNextHour(data);
        renderDetails(data);
        renderSunMoon(data);
        renderRadarCard(p);
        renderFoot(p, data);
        const top = layers[layers.length - 1];
        if (top === 'graphs') renderGraph();
        if (top === 'day') renderDay();
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
        els.name.innerHTML = p ? `${placeGlyph(p)}${ws.escapeHtml(p.name)}` : 'Weather';
        els.sub.textContent = p ? placeSub(p) : '';
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
        const cond = condOf(cur, cur.isDay !== false);
        const phase = phaseOf(data);
        s.dataset.phase = phase;
        s.dataset.scene = cond.scene;
        const v = tempOf(mainC(cur));
        els.deg.textContent = v == null ? '--' : String(v);
        els.unit.textContent = `°${unit()}`;
        els.cond.textContent = cond.text;
        const today = data.daily && data.daily[0];
        els.hilo.innerHTML = today ? `<span>H</span> ${temp(hiC(today))}&ensp;<span>L</span> ${temp(loC(today))}` : '';
        // the moon's phase: a shadow disc that slides across (waxing lights the right side)
        const age = moonAge();
        const x = age < 0.5 ? -(age / 0.5) * 100 : (1 - (age - 0.5) / 0.5) * 100;
        els.moonShadow.style.transform = `translateX(${x.toFixed(1)}%)`;
    }

    function renderGauges(data) {
        const g = (k) => els.gauges.querySelector(`[data-k="${k}"]`);
        const cur = data && data.current;
        const today = data && data.daily && data.daily[0];
        g('feels').querySelector('b').textContent = cur ? temp(settings.feels ? cur.tempC : cur.feelsC) : '--';
        g('feels').querySelector('span').textContent = settings.feels ? 'Actual' : 'Feels like';
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
            const cond = condOf(h, h.isDay);
            const rain = num(h.rain);
            return `<div class="wxw-hour${i === 0 ? ' is-now' : ''}">
                <div class="wxw-hour-time">${i === 0 ? 'Now' : hourLabel(h.time)}</div>
                ${iconImg(cond.icon, 'wxw-hour-icon')}
                <div class="wxw-hour-temp">${temp(mainC(h))}</div>
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
        const days = data && data.daily ? data.daily.slice(0, 10) : [];
        if (els.daysTitle) els.daysTitle.textContent = `${days.length > 7 ? days.length : 7}-Day Forecast`;
        if (!days.length) { els.days.innerHTML = ''; return; }
        const mins = days.map((d) => num(loC(d))).filter((v) => v != null);
        const maxs = days.map((d) => num(hiC(d))).filter((v) => v != null);
        const lo = Math.min(...mins);
        const hi = Math.max(...maxs);
        const span = Math.max(1, hi - lo);
        els.days.innerHTML = days.map((d, i) => {
            const cond = condOf(d, true);
            const dow = dayOf(d.date);
            const name = i === 0 ? 'Today' : DAYS[dow].slice(0, 3);
            const dLo = num(loC(d));
            const dHi = num(hiC(d));
            const left = dLo == null ? 0 : ((dLo - lo) / span) * 100;
            const width = dHi == null || dLo == null ? 0 : Math.max(6, ((dHi - dLo) / span) * 100);
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
                            <span class="wxw-lo">${temp(dLo)}</span>
                            <span class="wxw-bar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:linear-gradient(90deg,hsl(${tempHue(dLo)} 85% 55%),hsl(${tempHue(dHi)} 90% 52%))"></i></span>
                            <span class="wxw-hi">${temp(dHi)}</span>
                        </div>
                    </div>
                    <div class="wxw-face wxw-back">
                        <div class="wxw-back-day">${DAYS[dow]}, ${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCDate()}<button type="button" class="wxw-back-more" data-date="${d.date}">Details</button></div>
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
        setTimeout(() => fxPlay(true), 60);
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
            else if (quick && Math.abs(dx) < 8 && Math.abs(dy) < 8) fxPlay(true); // a tap on the sky plays it again
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
        els.graphs.hidden = top !== 'graphs';
        els.radar.hidden = top !== 'radar';
        els.alertLayer.hidden = top !== 'alert';
        els.dayLayer.hidden = top !== 'day';
        els.settingsLayer.hidden = top !== 'settings';
        if (top === 'settings') renderSettings();
        if (top === 'places') renderTiles();
        if (top === 'graphs') renderGraph();
        if (top === 'alert') renderAlertList();
        if (top !== 'radar') stopRadarPlay();
        if (top !== 'alert') extraAlert = top ? extraAlert : null;
        if (top !== 'add' && document.activeElement === els.input) els.input.blur();
        const TITLES = { places: 'Locations', add: 'Add Location', graphs: 'Graphs', radar: 'Radar', alert: 'Weather Alerts', settings: 'Settings' };
        ws.setTitle(TITLES[top] || 'Weather');
        if (top === 'day') renderDay();
        ws.syncHistory();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    // every place's tile needs its weather: fetch the ones without fresh data (quietly)
    function openPlaces() { pushLayer('places'); quiet(true); }

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
            const cond = cur ? condOf(cur, cur.isDay !== false) : null;
            const today = data && data.daily && data.daily[0];
            return `<div class="wxw-tile${p && x.id === p.id ? ' is-on' : ''}" data-id="${ws.escapeHtml(x.id)}" data-phase="${data && cur ? phaseOf(data) : 'day'}" data-scene="${cond ? cond.scene : 'fair'}">
                <div class="wxw-tile-text">
                    <div class="wxw-tile-name">${placeGlyph(x)}${ws.escapeHtml(x.name)}</div>
                    <div class="wxw-tile-sub">${ws.escapeHtml(placeSub(x))}</div>
                    <div class="wxw-tile-cond">${cond ? cond.text : '&nbsp;'}</div>
                </div>
                ${cond ? iconImg(cond.icon, 'wxw-tile-icon') : ''}
                <div class="wxw-tile-temp"><b>${cur ? temp(mainC(cur)) : '--'}</b><span>${today ? `${temp(hiC(today))} / ${temp(loC(today))}` : ''}</span></div>
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
            hold = setTimeout(() => { held = true; tileMenu(tile.dataset.id, x, y); }, ((window.wmShell && window.wmShell.holdMs) || 550));
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
        const p = places().find((q) => q.id === id);
        if (!p) return;
        const at = saved.findIndex((q) => q.id === id);
        const items = [{ label: 'Show', action: () => { select(id); popLayer(); } }];
        if (p.monitored) {
            const mid = p.monitored;
            items.push('-',
                { label: 'Weather Alerts', checked: p.alerts !== false, action: () => patchMonitored(mid, { alerts: p.alerts === false }) },
                { label: 'Rain Alarm', checked: !!p.rainAlarm, action: () => patchMonitored(mid, { rainAlarm: !p.rainAlarm }) },
                '-');
            if (p.here && here) items.push({ label: 'Save Location', action: saveHere });
            items.push({ label: `Clear ${PLACE_LABEL[mid]}`, disabled: !!p.fallback, action: () => clearMonitored(mid) });
        } else if (p.here) {
            items.push('-',
                { label: 'Save Location', action: saveHere },
                { label: 'Save as Home', action: () => setMonitored('home', p) },
                { label: 'Save as Work', action: () => setMonitored('work', p) });
        } else if (at >= 0) {
            items.push('-',
                { label: 'Set as Home', action: () => setMonitored('home', p) },
                { label: 'Set as Work', action: () => setMonitored('work', p) },
                '-',
                { label: 'Move Up', disabled: at === 0, action: () => move(id, -1) },
                { label: 'Move Down', disabled: at === saved.length - 1, action: () => move(id, 1) },
                '-',
                { label: 'Remove', action: () => remove(id) });
        }
        ws.menuAt(x, y, items);
    }

    async function clearMonitored(id) {
        const ok = await ws.messageBox({
            title: 'Weather', icon: 'question',
            text: `Clear ${PLACE_LABEL[id]}? Its alerts and rain alarm stop.`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }]
        });
        if (ok) patchMonitored(id, null);
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

    // ---------------------------------------------------------------- provider, links (#780)

    function providerName() {
        const p = selected();
        const d = dataOf(p);
        return (d && d.attribution && d.attribution.name) || 'Open-Meteo';
    }

    function openUrl(url) {
        if (!/^https?:\/\//i.test(String(url || ''))) return;
        if (window.wmBrowser && typeof window.wmBrowser.open === 'function' && window.wmBrowser.open(url)) return;
        window.open(url, '_blank', 'noopener');
    }

    function renderFoot(p, data) {
        const c = cache[keyOf(p)];
        const a = data && data.attribution;
        const updated = c ? `Updated ${updatedText(c.at)}${data && data.stale ? ' (offline copy)' : ''}` : '';
        let html = `<div>${ws.escapeHtml(updated)}</div>`;
        if (a && a.name === 'Apple Weather' && a.logoDark) {
            // Apple's attribution terms: the Apple Weather mark and a link to its data sources
            html += `<div class="wxw-attr-apple"><img src="${a.logoDark}" srcset="${a.logoDark} 1x, ${a.logoDark2x || a.logoDark} 2x" alt="Apple Weather" draggable="false">
                <a role="link" data-url="${ws.escapeHtml(a.url)}">${ws.escapeHtml(a.linkText || 'Other data sources')}</a></div>`;
        } else {
            html += `<div>Forecast data: <a role="link" data-url="https://open-meteo.com/">Open-Meteo.com</a></div>`;
        }
        if (data && data.alertsSource && data.alertsSource !== 'Apple Weather') html += `<div>Alerts: ${ws.escapeHtml(data.alertsSource)}</div>`;
        els.foot.innerHTML = html;
    }

    // ---------------------------------------------------------------- alerts

    const SEV_CLASS = (sev) => (sev === 'extreme' || sev === 'severe' ? 'is-severe' : sev === 'moderate' ? 'is-moderate' : 'is-minor');
    let alertFocus = null; // id shown first on the Alert page
    let extraAlert = null; // a broadcast alert for a place not in the list (showAlert)

    function placeAlerts(data) {
        return data && Array.isArray(data.alerts) ? data.alerts : [];
    }

    function renderAlerts(data) {
        const list = placeAlerts(data);
        els.alerts.hidden = !list.length;
        if (!list.length) { els.alerts.innerHTML = ''; return; }
        const first = list[0];
        const more = list.length > 1 ? `<span class="wxw-alert-more">+${list.length - 1} more</span>` : '';
        const until = first.ends || first.expires;
        els.alerts.innerHTML = `<div class="wxw-alert-strip ${SEV_CLASS(first.severity)}" data-alert="${ws.escapeHtml(first.id)}" role="button" tabindex="-1">
            <i class="wxw-alert-icon" aria-hidden="true"></i>
            <div class="wxw-alert-text"><b>${ws.escapeHtml(first.title)}</b><span>${ws.escapeHtml([until ? `Until ${dayTime(until)}` : '', first.source].filter(Boolean).join(' · '))}</span></div>
            ${more}</div>`;
    }

    function openAlerts(id) {
        alertFocus = id || null;
        pushLayer('alert');
    }

    async function alertText(a) {
        if (a.text || a.provider === 'nws' || a._loaded) return;
        a._loaded = true;
        try {
            const d = await ask('weather_alert', { id: a.id }, 15000);
            if (d && d.text) a.text = d.text;
            if (d && d.detailsUrl && !a.detailsUrl) a.detailsUrl = d.detailsUrl;
        } catch (_) { /* the summary stands */ }
    }

    function renderAlertList() {
        const p = selected();
        let list = placeAlerts(dataOf(p)).slice();
        if (extraAlert && !list.some((a) => a.id === extraAlert.id)) list.unshift(extraAlert);
        if (alertFocus) list.sort((x, y) => (y.id === alertFocus) - (x.id === alertFocus));
        if (!list.length) { els.alertList.innerHTML = '<div class="wxw-tiles-none">No weather alerts for this place.</div>'; return; }
        const row = (k, v) => (v ? `<div><span>${k}</span><b>${ws.escapeHtml(v)}</b></div>` : '');
        els.alertList.innerHTML = list.map((a) => `<div class="wxw-alert-card ${SEV_CLASS(a.severity)}">
            <div class="wxw-alert-card-head"><i class="wxw-alert-icon" aria-hidden="true"></i><div><b>${ws.escapeHtml(a.title)}</b><span>${ws.escapeHtml(SEVERITY_WORD[a.severity] || '')}${a.urgency ? ` · ${ws.escapeHtml(a.urgency[0].toUpperCase() + a.urgency.slice(1))}` : ''}</span></div></div>
            ${a.headline ? `<div class="wxw-alert-headline">${ws.escapeHtml(a.headline)}</div>` : ''}
            <div class="wxw-alert-grid">
                ${row('Area', a.area || (a.place && a.place.name) || '')}
                ${row('Starts', dayTime(a.onset || a.effective))}
                ${row('Ends', dayTime(a.ends || a.expires))}
                ${row('Issued by', a.source)}
            </div>
            ${a.text ? `<div class="wxw-alert-body">${ws.escapeHtml(a.text)}</div>` : (a.provider !== 'nws' && !a._loaded ? '<div class="wxw-alert-body is-loading">Loading the full text…</div>' : '')}
            ${a.instruction ? `<div class="wxw-alert-body"><b>What to do</b>\n${ws.escapeHtml(a.instruction)}</div>` : ''}
            ${a.detailsUrl ? `<button type="button" class="wxw-glass-btn" data-url="${ws.escapeHtml(a.detailsUrl)}">More Information</button>` : ''}
        </div>`).join('');
        list.filter((a) => !a.text && a.provider !== 'nws' && !a._loaded).forEach((a) => {
            alertText(a).then(() => { if (layers[layers.length - 1] === 'alert') renderAlertList(); });
        });
    }

    /** A broadcast alert (weatherAlerts.js View): the app on its Alert page. */
    function showAlert(alert) {
        if (!alert) return;
        extraAlert = alert;
        if (ws) ws.open(APP_ID);
        setTimeout(() => { layers = layers.filter((l) => l !== 'alert'); openAlerts(alert.id); }, 0);
    }

    // ---------------------------------------------------------------- next hour

    function renderNextHour(data) {
        const m = data && data.minutely;
        const mins = m && Array.isArray(m.minutes) ? m.minutes : [];
        els.nextWrap.hidden = !mins.length;
        if (!mins.length) { els.next.innerHTML = ''; return; }
        // dry the whole time: the sentence alone, no empty chart
        if (!mins.some((x) => (num(x.mmh) || 0) > 0)) {
            els.next.innerHTML = `<div class="wxw-next-summary is-dry">${ws.escapeHtml(m.summary || 'No precipitation expected')}</div>`;
            return;
        }
        const W = 300;
        const H = 64;
        const maxI = Math.max(2.5, ...mins.map((x) => num(x.mmh) || 0));
        const bw = W / mins.length;
        const bars = mins.map((x, i) => {
            const v = num(x.mmh) || 0;
            const chance = (num(x.rain) || 0) / 100;
            const h = v > 0 ? Math.max(2, Math.min(1, Math.sqrt(v / maxI)) * (H - 6)) : 0;
            return h ? `<rect x="${(i * bw + bw * 0.12).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${Math.max(0.8, bw * 0.76).toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(1.5, bw / 3).toFixed(2)}" opacity="${(0.45 + chance * 0.55).toFixed(2)}"/>` : '';
        }).join('');
        const step = m.stepMinutes || 1;
        const total = mins.length * step;
        const marks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
            const t = Math.round(f * total);
            return `<span style="left:${(f * 100).toFixed(1)}%">${f === 0 ? 'Now' : `${t} min`}</span>`;
        }).join('');
        els.next.innerHTML = `<div class="wxw-next-summary">${ws.escapeHtml(m.summary || '')}</div>
            <svg class="wxw-next-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
                <line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" class="wxw-axis"/>
                <line x1="0" y1="${(H * 0.33).toFixed(1)}" x2="${W}" y2="${(H * 0.33).toFixed(1)}" class="wxw-grid"/>
                <line x1="0" y1="${(H * 0.66).toFixed(1)}" x2="${W}" y2="${(H * 0.66).toFixed(1)}" class="wxw-grid"/>
                <g class="wxw-next-bars">${bars}</g>
            </svg>
            <div class="wxw-next-axis">${marks}</div>
            <div class="wxw-next-key"><span>Heavy</span><span>Moderate</span><span>Light</span></div>`;
    }

    // ---------------------------------------------------------------- conditions and sun & moon

    const DETAIL_GLYPH = {
        uv: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15M3 3l1.6 1.6M11.4 11.4 13 13M3 13l1.6-1.6M11.4 4.6 13 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        eye: '<svg viewBox="0 0 16 16"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>',
        gauge: '<svg viewBox="0 0 16 16"><path d="M2.2 11.5a6 6 0 1 1 11.6 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 9.5 11 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="9.6" r="1.3" fill="currentColor"/></svg>',
        dew: '<svg viewBox="0 0 16 16"><path d="M8 1.5C9 4 12.5 7 12.5 10a4.5 4.5 0 0 1-9 0C3.5 7 7 4 8 1.5z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 10.5a2 2 0 0 0 2 2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
        cloud: '<svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a3 3 0 0 0 .3-6A4 4 0 0 0 4.2 7 2.8 2.8 0 0 0 4.5 12.5z" fill="currentColor"/></svg>',
        gust: '<svg viewBox="0 0 16 16"><path d="M1.5 6h8.5a2 2 0 1 0-2-2M1.5 10h11a2 2 0 1 1-2 2M1.5 8h5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        rain: '<svg viewBox="0 0 16 16"><path d="M4 9.5h7.5a2.6 2.6 0 0 0 .2-5.2A3.6 3.6 0 0 0 4.8 5 2.3 2.3 0 0 0 4 9.5z" fill="currentColor"/><path d="M5 11.5 4 14M8 11.5 7 14M11 11.5 10 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        feels: '<svg viewBox="0 0 16 16"><path d="M7 2.5a1.5 1.5 0 0 1 3 0v6.6a3 3 0 1 1-3 0z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8.5" cy="11.6" r="1.5" fill="currentColor"/></svg>'
    };

    function sumNext(hours, from, n, k) {
        let total = 0;
        let any = false;
        hours.slice(from, from + n).forEach((h) => { const v = num(h[k]); if (v != null) { total += v; any = true; } });
        return any ? total : null;
    }

    function nowIndex(data) {
        const hours = (data && data.hourly) || [];
        const now = placeNow(data);
        return Math.max(0, hours.findIndex((h) => localMs(h.time) + 3600000 > now));
    }

    function renderDetails(data) {
        const cur = data && data.current;
        if (!cur) { els.details.innerHTML = ''; return; }
        const hours = data.hourly || [];
        const i = nowIndex(data);
        const uv = num(cur.uv);
        const next24 = sumNext(hours, i, 24, 'precipMm');
        const trend = cur.pressureTrend;
        const tile = (k, glyph, title, value, sub, extra = '') => `<div class="wxw-detail" data-k="${k}">
            <div class="wxw-detail-head"><i>${DETAIL_GLYPH[glyph]}</i><span>${title}</span></div>
            <b>${value}</b>${extra}<em>${sub || '&nbsp;'}</em></div>`;
        const uvBar = uv == null ? '' : `<div class="wxw-uvbar"><i style="left:${Math.min(100, (uv / 11) * 100).toFixed(1)}%"></i></div>`;
        const trendArrow = trend === 'rising' ? '▲' : trend === 'falling' ? '▼' : trend === 'steady' ? '▶' : '';
        const dewC = num(cur.dewC);
        const feelsGap = num(cur.feelsC) != null && num(cur.tempC) != null ? Math.round(tempOf(cur.feelsC) - tempOf(cur.tempC)) : null;
        els.details.innerHTML = [
            tile('uv', 'uv', 'UV Index', uv == null ? '--' : String(Math.round(uv)), uv == null ? '' : uvWord(uv), uvBar),
            tile('feels', 'feels', 'Feels Like', temp(cur.feelsC), feelsGap == null ? '' : feelsGap === 0 ? 'Same as the actual temperature' : feelsGap < 0 ? (num(cur.windKmh) > 10 ? 'Wind makes it feel colder' : 'Feels colder') : (num(cur.humidity) > 60 ? 'Humidity makes it feel warmer' : 'Feels warmer')),
            tile('vis', 'eye', 'Visibility', distance(cur.visibilityM), num(cur.visibilityM) == null ? '' : num(cur.visibilityM) >= 10000 ? 'Clear view' : num(cur.visibilityM) >= 4000 ? 'Haze lowers the view' : 'Poor visibility'),
            tile('pressure', 'gauge', 'Pressure', pressureText(cur.pressure), trend ? `${trendArrow} ${TREND_WORD[trend] || trend}` : ''),
            tile('dew', 'dew', 'Dew Point', temp(dewC), num(cur.humidity) == null ? '' : `Humidity ${Math.round(cur.humidity)}%`),
            tile('cloud', 'cloud', 'Cloud Cover', num(cur.cloud) == null ? '--' : `${Math.round(cur.cloud)}%`, num(cur.cloud) == null ? '' : cur.cloud < 15 ? 'Clear sky' : cur.cloud < 50 ? 'Some clouds' : cur.cloud < 85 ? 'Mostly cloudy' : 'Overcast'),
            tile('gust', 'gust', 'Wind Gusts', cur.gustKmh == null ? '--' : wind(cur.gustKmh), cur.windKmh == null ? '' : `Wind ${wind(cur.windKmh)} ${compass(cur.windDir)}`.trim()),
            tile('rain', 'rain', 'Precipitation', next24 == null ? '--' : precip(next24), next24 == null ? '' : 'Expected in the next 24 h')
        ].join('');
    }

    function moonSvg(phase, size = 34) {
        const age = MOON_AGE[phase] != null ? MOON_AGE[phase] : moonAge();
        const r = 15;
        // terminator: an ellipse whose width follows the phase; waxing lights the right side
        const lit = Math.cos(age * 2 * Math.PI); // 1 new .. -1 full
        const rx = Math.abs(lit) * r;
        const right = age < 0.5;
        const sweepOuter = right ? 1 : 0;
        const sweepInner = lit > 0 ? (right ? 0 : 1) : (right ? 1 : 0);
        const d = `M16 1 A${r} ${r} 0 0 ${sweepOuter} 16 31 A${rx.toFixed(2)} ${r} 0 0 ${sweepInner} 16 1 Z`;
        return `<svg class="wxw-moonsvg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">
            <defs><radialGradient id="wxwMoonLit" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#d9d2b4"/></radialGradient></defs>
            <circle cx="16" cy="16" r="${r}" fill="#2a2f38" stroke="rgba(255,255,255,0.18)"/>
            ${age < 0.02 || age > 0.98 ? '' : `<path d="${d}" fill="url(#wxwMoonLit)"/>`}
        </svg>`;
    }

    function renderSunMoon(data) {
        const today = data && data.daily && data.daily[0];
        if (!today) { els.sunmoon.innerHTML = ''; return; }
        const now = placeNow(data);
        const rise = today.sunrise ? localMs(today.sunrise) : null;
        const set = today.sunset ? localMs(today.sunset) : null;
        let arc = '';
        if (rise && set && set > rise) {
            const f = Math.max(0, Math.min(1, (now - rise) / (set - rise)));
            const ang = Math.PI * (1 - f);
            const x = 100 + Math.cos(ang) * 84;
            const y = 62 - Math.sin(ang) * 50;
            const up = now > rise && now < set;
            arc = `<svg class="wxw-sunarc" viewBox="0 0 200 70" aria-hidden="true">
                <path d="M16 62 A84 50 0 0 1 184 62" class="wxw-sunarc-path"/>
                <path d="M16 62 A84 50 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" class="wxw-sunarc-done"/>
                <line x1="4" y1="62.5" x2="196" y2="62.5" class="wxw-axis"/>
                ${up ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" class="wxw-sunarc-sun"/>` : ''}
            </svg>`;
        }
        const cell = (k, v) => `<div><span>${k}</span><b>${v || '--'}</b></div>`;
        els.sunmoon.innerHTML = `<div class="wxw-sun-side">${arc}
                <div class="wxw-sm-grid">${cell('Sunrise', hm(today.sunrise))}${cell('Sunset', hm(today.sunset))}${cell('Daylight', duration(today.daylightSec))}${cell('First light', hm(today.dawn))}${cell('Last light', hm(today.dusk))}${cell('Solar noon', hm(today.solarNoon))}</div></div>
            <div class="wxw-moon-side">${moonSvg(today.moonPhase, 40)}
                <div class="wxw-moon-name">${MOON_WORD[today.moonPhase] || ''}</div>
                ${today.moonrise || today.moonset ? `<div class="wxw-sm-grid is-moon">${cell('Moonrise', today.moonrise ? hm(today.moonrise) : '')}${cell('Moonset', today.moonset ? hm(today.moonset) : '')}</div>` : ''}</div>`;
    }

    // ---------------------------------------------------------------- graphs

    const GRAPHS = [
        { id: 'temp', label: 'Temperature' },
        { id: 'rain', label: 'Precipitation' },
        { id: 'wind', label: 'Wind' },
        { id: 'humidity', label: 'Humidity' },
        { id: 'uv', label: 'UV Index' },
        { id: 'pressure', label: 'Pressure' }
    ];
    // all ten days are hourly now (#792)
    const GRAPH_RANGES = [[24, '24 h'], [48, '48 h'], [72, '72 h'], [168, '7 days'], [240, '10 days']];
    let graphKind = 'temp';
    let graphRange = 24;
    let graphPick = null; // hour index under the finger

    function openGraphs(kind) {
        if (kind) graphKind = kind;
        graphPick = null;
        pushLayer('graphs');
    }

    function graphSeries(kind, hours) {
        const t = (v) => (num(v) == null ? null : (imperial() ? v * 9 / 5 + 32 : v));
        const w = (v) => (num(v) == null ? null : (imperial() ? v * 0.621371 : v));
        switch (kind) {
            case 'temp': return { lines: [{ v: hours.map((h) => t(h.tempC)), cls: 'temp', area: true }, { v: hours.map((h) => t(h.feelsC)), cls: 'feels', dash: true }], fmt: (v) => `${Math.round(v)}°`, legend: [['temp', 'Temperature'], ['feels', 'Feels like']] };
            case 'rain': return { bars: { v: hours.map((h) => num(h.rain)), cls: 'chance', max: 100 }, lines: [{ v: hours.map((h) => (num(h.precipMm) == null ? null : (imperial() ? h.precipMm / 25.4 : h.precipMm))), cls: 'amount', right: true }], fmt: (v) => `${Math.round(v)}%`, fmtRight: (v) => (imperial() ? `${v.toFixed(2)}"` : `${v.toFixed(1)}`), legend: [['chance', 'Chance %'], ['amount', imperial() ? 'Amount (in)' : 'Amount (mm)']], min: 0, max: 100 };
            case 'wind': return { lines: [{ v: hours.map((h) => w(h.gustKmh)), cls: 'gust', dash: true }, { v: hours.map((h) => w(h.windKmh)), cls: 'wind', area: true }], arrows: hours.map((h) => num(h.windDir)), fmt: (v) => `${Math.round(v)}`, legend: [['wind', imperial() ? 'Wind (mph)' : 'Wind (km/h)'], ['gust', 'Gusts']], min: 0 };
            case 'humidity': return { lines: [{ v: hours.map((h) => num(h.humidity)), cls: 'humidity', area: true }, { v: hours.map((h) => num(h.cloud)), cls: 'cloud', dash: true }], fmt: (v) => `${Math.round(v)}%`, legend: [['humidity', 'Humidity'], ['cloud', 'Cloud cover']], min: 0, max: 100 };
            case 'uv': return { bars: { v: hours.map((h) => num(h.uv)), cls: 'uv', color: (v) => (v < 3 ? '#5bd15b' : v < 6 ? '#f2d43a' : v < 8 ? '#f59a2f' : v < 11 ? '#e8432e' : '#a65bd8') }, fmt: (v) => `${Math.round(v)}`, legend: [], min: 0, max: Math.max(6, ...hours.map((h) => num(h.uv) || 0)) };
            case 'pressure': return { lines: [{ v: hours.map((h) => (num(h.pressure) == null ? null : (imperial() ? h.pressure * 0.02953 : h.pressure))), cls: 'pressure', area: true }], fmt: (v) => (imperial() ? v.toFixed(2) : `${Math.round(v)}`), legend: [['pressure', imperial() ? 'Pressure (inHg)' : 'Pressure (hPa)']] };
            default: return { lines: [], fmt: String, legend: [] };
        }
    }

    function niceRange(values, min, max) {
        const vals = values.filter((v) => v != null);
        let lo = min != null ? min : Math.min(...vals);
        let hi = max != null ? max : Math.max(...vals);
        if (!vals.length) { lo = 0; hi = 1; }
        if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
        const pad = (hi - lo) * 0.12;
        return { lo: min != null ? lo : lo - pad, hi: max != null ? hi : hi + pad };
    }

    function renderGraph() {
        const data = dataOf(selected());
        els.graphTabs.innerHTML = GRAPHS.map((g) => `<button type="button" data-g="${g.id}" class="${g.id === graphKind ? 'is-on' : ''}">${g.label}</button>`).join('');
        els.rangeTabs.innerHTML = GRAPH_RANGES.map(([r, label]) => `<button type="button" data-r="${r}" class="${r === graphRange ? 'is-on' : ''}">${label}</button>`).join('');
        const all = (data && data.hourly) || [];
        const from = nowIndex(data);
        const hours = all.slice(from, from + graphRange);
        const g = GRAPHS.find((x) => x.id === graphKind) || GRAPHS[0];
        els.graphTitle.textContent = g.label;
        if (hours.length < 2) {
            els.graph.innerHTML = '<div class="wxw-tiles-none">No hourly data for this place yet.</div>';
            els.graphSub.textContent = '';
            els.graphTable.innerHTML = '';
            return;
        }
        const S = graphSeries(graphKind, hours);
        const W = 340;
        const H = 170;
        const L = 30;
        const R = S.lines && S.lines.some((l) => l.right) ? 30 : 8;
        const T = 10;
        const B = 26;
        const pw = W - L - R;
        const ph = H - T - B;
        const leftVals = [].concat(...(S.lines || []).filter((l) => !l.right).map((l) => l.v), S.bars ? S.bars.v : []);
        const rng = niceRange(leftVals, S.min, S.max);
        const X = (i) => L + (i / (hours.length - 1)) * pw;
        const Y = (v) => T + ph - ((v - rng.lo) / (rng.hi - rng.lo)) * ph;
        let svg = '';
        // grid and left labels
        for (let k = 0; k <= 4; k++) {
            const v = rng.lo + ((rng.hi - rng.lo) * k) / 4;
            const y = Y(v);
            svg += `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" class="wxw-grid"/><text x="${L - 4}" y="${(y + 3).toFixed(1)}" class="wxw-ylab" text-anchor="end">${S.fmt(v)}</text>`;
        }
        // night shading and day / hour labels
        hours.forEach((h, i) => {
            if (!h.isDay) svg += `<rect x="${(X(i) - pw / (hours.length - 1) / 2).toFixed(1)}" y="${T}" width="${(pw / (hours.length - 1)).toFixed(2)}" height="${ph}" class="wxw-night"/>`;
            const hr = Number(h.time.slice(11, 13));
            const every = graphRange <= 24 ? 3 : graphRange <= 48 ? 6 : graphRange <= 72 ? 12 : 24;
            if (hr % every === 0) svg += `<text x="${X(i).toFixed(1)}" y="${H - B + 12}" class="wxw-xlab" text-anchor="middle">${hr === 0 ? DAYS[dayOf(h.time.slice(0, 10))].slice(0, 3) : hourLabel(h.time).replace(':00', '')}</text>`;
            if (hr === 0 && i > 0) svg += `<line x1="${X(i).toFixed(1)}" y1="${T}" x2="${X(i).toFixed(1)}" y2="${T + ph}" class="wxw-daysep"/>`;
        });
        svg = `<g>${svg}</g>`;
        // bars
        if (S.bars) {
            const bw = Math.max(1.5, (pw / hours.length) * 0.7);
            svg += S.bars.v.map((v, i) => (v == null || v <= 0 ? '' : `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ph - Y(v)).toFixed(1)}" class="wxw-bar-${S.bars.cls}"${S.bars.color ? ` fill="${S.bars.color(v)}"` : ''} rx="1"/>`)).join('');
        }
        // lines
        (S.lines || []).forEach((l) => {
            let Yl = Y;
            if (l.right) {
                const vals = l.v.filter((v) => v != null);
                const top = Math.max(imperial() ? 0.1 : 2, ...vals) * 1.15;
                Yl = (v) => T + ph - (v / top) * ph;
                for (let k = 0; k <= 4; k++) {
                    const v = (top * k) / 4;
                    svg += `<text x="${W - R + 4}" y="${(Yl(v) + 3).toFixed(1)}" class="wxw-ylab is-right">${S.fmtRight(v)}</text>`;
                }
            }
            const pts = l.v.map((v, i) => (v == null ? null : [X(i), Yl(v)])).filter(Boolean);
            if (pts.length < 2) return;
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
            if (l.area) svg += `<path d="${d} L${pts[pts.length - 1][0].toFixed(1)} ${T + ph} L${pts[0][0].toFixed(1)} ${T + ph} Z" class="wxw-area-${l.cls}"/>`;
            svg += `<path d="${d}" class="wxw-line wxw-line-${l.cls}${l.dash ? ' is-dash' : ''}"/>`;
        });
        // wind arrows along the bottom
        if (S.arrows) {
            const every = Math.max(1, Math.round(hours.length / 12));
            S.arrows.forEach((dir, i) => {
                if (dir == null || i % every) return;
                svg += `<path d="M0 -4 L3 3 L0 1.5 L-3 3 Z" transform="translate(${X(i).toFixed(1)} ${T + ph - 7}) rotate(${(dir + 180) % 360})" class="wxw-windarrow"/>`;
            });
        }
        // the finger's hour
        const pick = graphPick != null && graphPick < hours.length ? graphPick : 0;
        svg += `<line x1="${X(pick).toFixed(1)}" y1="${T}" x2="${X(pick).toFixed(1)}" y2="${T + ph}" class="wxw-pick"/>`;
        (S.lines || []).filter((l) => !l.right).forEach((l) => { const v = l.v[pick]; if (v != null) svg += `<circle cx="${X(pick).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.2" class="wxw-pick-dot wxw-line-${l.cls}"/>`; });
        els.graph.innerHTML = `<svg class="wxw-chart" viewBox="0 0 ${W} ${H}" data-l="${L}" data-pw="${pw}" data-n="${hours.length}">${svg}</svg>
            <div class="wxw-legend">${(S.legend || []).map(([cls, label]) => `<span><i class="wxw-key-${cls}"></i>${label}</span>`).join('')}</div>`;
        const h = hours[pick];
        const cond = condOf(h, h.isDay);
        const readout = {
            temp: `${temp(h.tempC)}, feels like ${temp(h.feelsC)}`,
            rain: `${num(h.rain) == null ? '--' : `${Math.round(h.rain)}%`} chance, ${precip(h.precipMm)}`,
            wind: `${wind(h.windKmh)} ${compass(h.windDir)}, gusts ${wind(h.gustKmh)}`,
            humidity: `${num(h.humidity) == null ? '--' : `${Math.round(h.humidity)}%`} humidity, dew point ${temp(h.dewC)}`,
            uv: num(h.uv) == null ? '--' : `UV ${Math.round(h.uv)} (${uvWord(h.uv)})`,
            pressure: pressureText(h.pressure)
        }[graphKind];
        els.graphSub.textContent = `${pick === 0 ? 'Now' : dayTime(h.time)} · ${cond.text} · ${readout}`;
        // the day's summary under the chart
        const sumRows = [];
        const vals = (k) => hours.map((x) => num(x[k])).filter((v) => v != null);
        if (graphKind === 'temp') { const v = vals('tempC'); if (v.length) sumRows.push(['High', temp(Math.max(...v))], ['Low', temp(Math.min(...v))]); }
        if (graphKind === 'rain') { const tot = sumNext(hours, 0, hours.length, 'precipMm'); sumRows.push(['Total', precip(tot)], ['Peak chance', `${Math.max(0, ...vals('rain'))}%`]); }
        if (graphKind === 'wind') { const g2 = vals('gustKmh'); sumRows.push(['Strongest gust', g2.length ? wind(Math.max(...g2)) : '--'], ['Average wind', vals('windKmh').length ? wind(vals('windKmh').reduce((a, b) => a + b, 0) / vals('windKmh').length) : '--']); }
        if (graphKind === 'humidity') { const v = vals('humidity'); if (v.length) sumRows.push(['Highest', `${Math.round(Math.max(...v))}%`], ['Lowest', `${Math.round(Math.min(...v))}%`]); }
        if (graphKind === 'uv') { const v = vals('uv'); if (v.length) sumRows.push(['Peak', `${Math.round(Math.max(...v))} ${uvWord(Math.max(...v))}`]); }
        if (graphKind === 'pressure') { const v = vals('pressure'); if (v.length > 1) sumRows.push(['Change', `${v[v.length - 1] >= v[0] ? '+' : ''}${imperial() ? ((v[v.length - 1] - v[0]) * 0.02953).toFixed(2) + ' inHg' : Math.round(v[v.length - 1] - v[0]) + ' hPa'}`]); }
        els.graphTable.innerHTML = sumRows.length ? `<div class="wxw-panel wxw-sm-grid">${sumRows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : '';
    }

    function graphPoint(e) {
        const svg = els.graph.querySelector('svg.wxw-chart');
        if (!svg) return;
        const box = svg.getBoundingClientRect();
        const scale = 340 / box.width;
        const L = Number(svg.dataset.l);
        const pw = Number(svg.dataset.pw);
        const n = Number(svg.dataset.n);
        const x = (e.clientX - box.left) * scale;
        const i = Math.round(((x - L) / pw) * (n - 1));
        const next = Math.max(0, Math.min(n - 1, i));
        if (next === graphPick) return;
        graphPick = next;
        // pointer moves come faster than frames: draw once per frame
        if (graphFrame) return;
        graphFrame = (window.requestAnimationFrame || ((f) => setTimeout(f, 16)))(() => { graphFrame = 0; renderGraph(); });
    }
    let graphFrame = 0;

    // ---------------------------------------------------------------- day page

    let dayDate = null;

    function openDay(date) {
        dayDate = date;
        pushLayer('day');
    }

    function stepDay(dir) {
        const data = dataOf(selected());
        const days = (data && data.daily) || [];
        const at = days.findIndex((d) => d.date === dayDate);
        const next = days[at + dir];
        if (!next) return;
        dayDate = next.date;
        renderDay();
        ws.refreshSoftKeys();
        if (els.dayLayer) els.dayLayer.scrollTop = 0;
    }

    function partHtml(title, part, night) {
        if (!part) return '';
        const cond = condOf(part, !night);
        const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
        return `<div class="wxw-panel wxw-part">
            <div class="wxw-part-head">${iconImg(cond.icon, 'wxw-part-icon')}<div><span>${title}</span><b>${ws.escapeHtml(cond.text)}</b></div>
                <div class="wxw-part-temp">${night ? `<span>Low</span> ${temp(part.minC)}` : `<span>High</span> ${temp(part.maxC)}`}</div></div>
            <div class="wxw-sm-grid">${cell('Chance', num(part.rain) == null ? '--' : `${Math.round(part.rain)}%`)}${cell('Amount', precip(part.precipMm))}${cell('Wind', part.windKmh == null ? '--' : `${wind(part.windKmh)} ${compass(part.windDir)}`.trim())}${cell('Humidity', num(part.humidity) == null ? '--' : `${Math.round(part.humidity)}%`)}${part.snowMm ? cell('Snow', precip(part.snowMm)) : ''}${num(part.cloud) != null ? cell('Clouds', `${Math.round(part.cloud)}%`) : ''}</div>
        </div>`;
    }

    function renderDay() {
        const data = dataOf(selected());
        const days = (data && data.daily) || [];
        const at = Math.max(0, days.findIndex((d) => d.date === dayDate));
        const d = days[at];
        if (!d) { els.dayPage.innerHTML = '<div class="wxw-tiles-none">No forecast for this day.</div>'; return; }
        const cond = condOf(d, true);
        const dt = new Date(localMs(d.date));
        const title = at === 0 ? 'Today' : DAYS[dayOf(d.date)];
        ws.setTitle(title);
        const dayHours = ((data && data.hourly) || []).filter((h) => h.time.slice(0, 10) === d.date);
        let mini = '';
        if (dayHours.length > 2) {
            const vals = dayHours.map((h) => num(h.tempC)).filter((v) => v != null);
            const lo = Math.min(...vals) - 1;
            const hi = Math.max(...vals) + 1;
            const W = 300;
            const H = 54;
            const X = (i) => 6 + (i / (dayHours.length - 1)) * (W - 12);
            const Y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 18);
            const pts = dayHours.map((h, i) => (num(h.tempC) == null ? null : `${X(i).toFixed(1)} ${Y(h.tempC).toFixed(1)}`)).filter(Boolean);
            const rainBars = dayHours.map((h, i) => (num(h.rain) ? `<rect x="${(X(i) - 3).toFixed(1)}" y="${(H - 4 - (h.rain / 100) * 14).toFixed(1)}" width="6" height="${((h.rain / 100) * 14).toFixed(1)}" class="wxw-bar-chance"/>` : '')).join('');
            mini = `<div class="wxw-panel wxw-day-mini" role="button" tabindex="-1" data-graph="temp"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${rainBars}<path d="M${pts.join(' L')}" class="wxw-line wxw-line-temp"/></svg>
                <div class="wxw-day-mini-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div></div>`;
        }
        const cell = (k, v) => `<div><span>${k}</span><b>${v || '--'}</b></div>`;
        els.dayPage.innerHTML = `
            <div class="wxw-day-hero">
                ${iconImg(cond.icon, 'wxw-day-hero-icon')}
                <div class="wxw-day-hero-text"><div class="wxw-day-hero-date">${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}</div><b>${ws.escapeHtml(cond.text)}</b>
                    <div class="wxw-day-hero-temps"><span>H</span> ${temp(d.maxC)}&ensp;<span>L</span> ${temp(d.minC)}</div></div>
            </div>
            ${mini}
            ${partHtml('Daytime', d.day, false)}
            ${partHtml('Overnight', d.night, true)}
            <div class="wxw-panel wxw-sm-grid">
                ${cell('Precipitation', `${num(d.rain) == null ? '--' : `${Math.round(d.rain)}%`} · ${precip(d.precipMm)}`)}
                ${d.snowMm ? cell('Snowfall', precip(d.snowMm)) : ''}
                ${cell('UV index', num(d.uv) == null ? '--' : `${Math.round(d.uv)} ${uvWord(d.uv)}`)}
                ${cell('Wind', d.windMaxKmh == null ? wind(d.windKmh) : `up to ${wind(d.windMaxKmh)} ${compass(d.windDir)}`.trim())}
                ${cell('Gusts', d.gustKmh == null ? '--' : wind(d.gustKmh))}
                ${cell('Humidity', num(d.humidity) == null ? '--' : `${Math.round(d.humidity)}%`)}
                ${cell('Feels like', d.feelsMaxC == null ? '--' : `${temp(d.feelsMinC)} to ${temp(d.feelsMaxC)}`)}
            </div>
            <div class="wxw-panel wxw-sunmoon is-day">
                <div class="wxw-sun-side"><div class="wxw-sm-grid">${cell('Sunrise', hm(d.sunrise))}${cell('Sunset', hm(d.sunset))}${cell('Daylight', duration(d.daylightSec))}${cell('First light', hm(d.dawn))}${cell('Last light', hm(d.dusk))}${cell('Solar noon', hm(d.solarNoon))}</div></div>
                <div class="wxw-moon-side">${moonSvg(d.moonPhase, 36)}<div class="wxw-moon-name">${MOON_WORD[d.moonPhase] || ''}</div>
                    ${d.moonrise || d.moonset ? `<div class="wxw-sm-grid is-moon">${cell('Moonrise', d.moonrise ? hm(d.moonrise) : '')}${cell('Moonset', d.moonset ? hm(d.moonset) : '')}</div>` : ''}</div>
            </div>
            <div class="wxw-day-nav">
                <button type="button" class="wxw-glass-btn" data-day-step="-1"${at === 0 ? ' disabled' : ''}>&lsaquo; Previous Day</button>
                <button type="button" class="wxw-glass-btn" data-day-step="1"${at >= days.length - 1 ? ' disabled' : ''}>Next Day &rsaquo;</button>
            </div>`;
        const m = els.dayPage.querySelector('.wxw-day-mini');
        if (m) m.addEventListener('click', () => openGraphs('temp'));
    }

    // ---------------------------------------------------------------- radar map

    const TILE = 256;
    let radar = null; // weather_radar reply
    let radarAt = 0; // when it came
    let radarFrame = 0;
    let radarTimer = null;
    let miniMap = null;
    let miniKey = '';
    let fullMap = null;
    let mapStyle = ['dark', 'light', 'streets'].includes(load('wmWeatherMapStyle', 'dark')) ? load('wmWeatherMapStyle', 'dark') : 'dark';

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

    /**
     * A small slippy map: base tiles, then one layer per radar frame (only the current one shown, the
     * rest kept loaded so the loop does not flicker). Radar tiles stop at radar.maxZoom; past it they
     * are drawn scaled up. interactive: drag to pan, pinch / double-tap to zoom.
     */
    function TileMap(host, opts) {
        const st = { lat: opts.lat, lon: opts.lon, z: opts.zoom || 6, home: { lat: opts.lat, lon: opts.lon, z: opts.zoom || 6 }, dx: 0, dy: 0 };
        host.innerHTML = '<div class="wxw-map-pane"><div class="wxw-map-base"></div><div class="wxw-map-radar"></div></div><div class="wxw-map-pin"></div>';
        const pane = host.querySelector('.wxw-map-pane');
        const baseEl = host.querySelector('.wxw-map-base');
        const radarEl = host.querySelector('.wxw-map-radar');
        const pin = host.querySelector('.wxw-map-pin');
        const frameLayers = new Map(); // frame id -> element

        const tileImg = (src, x, y, size, lazy) => `<img ${lazy ? 'data-src' : 'src'}="${src}" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px" alt="" draggable="false" decoding="async" onerror="this.style.visibility='hidden'">`;
        // a frame's tiles load when it is about to show (it and the next), not all 13 at once
        const fill = (layer) => {
            if (!layer || layer.dataset.filled) return;
            layer.dataset.filled = '1';
            layer.querySelectorAll('img[data-src]').forEach((img) => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
        };

        function layout() {
            const w = host.clientWidth;
            const h = host.clientHeight;
            if (!w || !h) return;
            const z = st.z;
            const cx = lon2x(st.lon, z);
            const cy = lat2y(st.lat, z);
            const left = cx - w / 2;
            const top = cy - h / 2;
            const n = 2 ** z;
            let base = '';
            for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
                if (ty < 0 || ty >= n) continue;
                for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
                    const wx = ((tx % n) + n) % n;
                    base += tileImg(`/weather/tile/base/${mapStyle}/${z}/${wx}/${ty}.png`, Math.round(tx * TILE - left), Math.round(ty * TILE - top), TILE);
                }
            }
            baseEl.innerHTML = base;
            frameLayers.clear();
            radarEl.innerHTML = '';
            const frames = radar && radar.frames ? radar.frames : [];
            const want = opts.allFrames ? frames : frames.slice(-1);
            const rz = Math.min(z, (radar && radar.maxZoom) || 7);
            const scale = 2 ** (z - rz);
            const size = TILE * scale;
            const rn = 2 ** rz;
            want.forEach((f) => {
                const layer = document.createElement('div');
                layer.className = 'wxw-map-frame';
                let html = '';
                for (let ty = Math.floor(top / size); ty <= Math.floor((top + h) / size); ty++) {
                    if (ty < 0 || ty >= rn) continue;
                    for (let tx = Math.floor(left / size); tx <= Math.floor((left + w) / size); tx++) {
                        const wx = ((tx % rn) + rn) % rn;
                        html += tileImg(`/weather/tile/radar/${f.id}/${rz}/${wx}/${ty}.png`, Math.round(tx * size - left), Math.round(ty * size - top), size, true);
                    }
                }
                layer.innerHTML = html;
                radarEl.appendChild(layer);
                frameLayers.set(f.id, layer);
            });
            // labels over the radar (place names stay readable)
            // the street map has its own labels; the grey canvases get theirs on top of the radar
            const labels = mapStyle === 'streets' ? null : mapStyle === 'dark' ? 'dark-labels' : 'labels';
            let lab = '';
            for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
                if (ty < 0 || ty >= n) continue;
                for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
                    const wx = ((tx % n) + n) % n;
                    if (labels) lab += tileImg(`/weather/tile/base/${labels}/${z}/${wx}/${ty}.png`, Math.round(tx * TILE - left), Math.round(ty * TILE - top), TILE);
                }
            }
            const labelLayer = document.createElement('div');
            labelLayer.className = 'wxw-map-labels';
            labelLayer.innerHTML = lab;
            radarEl.appendChild(labelLayer);
            pane.style.transform = '';
            st.dx = 0;
            st.dy = 0;
            placePin();
            show(opts.frameId ? opts.frameId() : null);
        }

        function placePin() {
            const w = host.clientWidth;
            const h = host.clientHeight;
            const px = lon2x(st.home.lon, st.z) - (lon2x(st.lon, st.z) - w / 2);
            const py = lat2y(st.home.lat, st.z) - (lat2y(st.lat, st.z) - h / 2);
            pin.style.transform = `translate(${(px + st.dx).toFixed(1)}px, ${(py + st.dy).toFixed(1)}px)`;
        }

        function show(id) {
            const ids = [...frameLayers.keys()];
            const target = id && frameLayers.has(id) ? id : ids[ids.length - 1];
            const at = ids.indexOf(target);
            fill(frameLayers.get(target));
            fill(frameLayers.get(ids[(at + 1) % ids.length]));
            frameLayers.forEach((el, fid) => el.classList.toggle('is-on', fid === target));
        }

        function zoomBy(dz, anchor) {
            const z = Math.max(3, Math.min(11, st.z + dz));
            if (z === st.z) return;
            if (anchor) {
                const w = host.clientWidth;
                const h = host.clientHeight;
                const ax = lon2x(st.lon, st.z) - w / 2 + anchor.x;
                const ay = lat2y(st.lat, st.z) - h / 2 + anchor.y;
                const alon = x2lon(ax, st.z);
                const alat = y2lat(ay, st.z);
                st.z = z;
                st.lon = x2lon(lon2x(alon, z) - anchor.x + w / 2, z);
                st.lat = y2lat(lat2y(alat, z) - anchor.y + h / 2, z);
            } else {
                st.z = z;
            }
            layout();
        }

        if (opts.interactive) {
            const pts = new Map();
            let pinchFrom = 0;
            let lastTap = 0;
            host.addEventListener('pointerdown', (e) => {
                host.setPointerCapture(e.pointerId);
                pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
                if (pts.size === 2) { const [a, b] = [...pts.values()]; pinchFrom = Math.hypot(a.x - b.x, a.y - b.y); }
                const now = Date.now();
                if (pts.size === 1 && now - lastTap < 300) {
                    const r = host.getBoundingClientRect();
                    zoomBy(1, { x: e.clientX - r.left, y: e.clientY - r.top });
                    lastTap = 0;
                } else lastTap = now;
            });
            host.addEventListener('pointermove', (e) => {
                const p = pts.get(e.pointerId);
                if (!p) return;
                const ddx = e.clientX - p.x;
                const ddy = e.clientY - p.y;
                p.x = e.clientX;
                p.y = e.clientY;
                if (pts.size === 1) {
                    st.dx += ddx;
                    st.dy += ddy;
                    pane.style.transform = `translate(${st.dx}px, ${st.dy}px)`;
                    placePin();
                } else if (pts.size === 2) {
                    const [a, b] = [...pts.values()];
                    const ratio = Math.hypot(a.x - b.x, a.y - b.y) / (pinchFrom || 1);
                    pane.style.transform = `translate(${st.dx}px, ${st.dy}px) scale(${ratio.toFixed(3)})`;
                }
            });
            const end = (e) => {
                if (!pts.has(e.pointerId)) return;
                const wasPinch = pts.size === 2;
                let ratio = 1;
                if (wasPinch) { const [a, b] = [...pts.values()]; ratio = Math.hypot(a.x - b.x, a.y - b.y) / (pinchFrom || 1); }
                pts.delete(e.pointerId);
                if (pts.size) return;
                if (st.dx || st.dy) {
                    const w = host.clientWidth;
                    const h = host.clientHeight;
                    st.lon = x2lon(lon2x(st.lon, st.z) - st.dx, st.z);
                    st.lat = y2lat(lat2y(st.lat, st.z) - st.dy, st.z);
                    void w; void h;
                }
                const dz = wasPinch ? Math.round(Math.log2(ratio)) : 0;
                if (dz) { st.z = Math.max(3, Math.min(11, st.z + dz)); }
                layout();
            };
            host.addEventListener('pointerup', end);
            host.addEventListener('pointercancel', end);
            host.addEventListener('wheel', (e) => {
                e.preventDefault();
                const r = host.getBoundingClientRect();
                zoomBy(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
            }, { passive: false });
        }

        // first paint now, and again whenever the box changes size (a layer shown, the phone turned)
        let lastSize = '';
        const sized = () => {
            const size = `${host.clientWidth}x${host.clientHeight}`;
            if (size === lastSize || !host.clientWidth || !host.clientHeight) return;
            lastSize = size;
            layout();
        };
        if (typeof ResizeObserver === 'function') new ResizeObserver(sized).observe(host);
        sized();

        return {
            layout,
            show,
            zoomBy,
            home() { st.lat = st.home.lat; st.lon = st.home.lon; st.z = st.home.z; layout(); },
            center(lat, lon, z) { st.lat = lat; st.lon = lon; st.home = { lat, lon, z: z || st.z }; if (z) st.z = z; layout(); },
            zoom: () => st.z
        };
    }

    async function loadRadar(force) {
        if (radar && !force && Date.now() - radarAt < 4 * 60 * 1000) return radar;
        const r = await ask('weather_radar', {}, 12000);
        if (r && Array.isArray(r.frames)) {
            radar = r;
            radarAt = Date.now();
            radarFrame = r.frames.length - 1;
        }
        return radar;
    }

    function frameLabel(f) {
        if (!f) return '';
        const d = new Date(f.time * 1000);
        const mins = Math.round((Date.now() - d.getTime()) / 60000);
        const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return mins <= 5 ? `${t} (now)` : `${t} (${mins} min ago)`;
    }

    function renderRadarCard(p) {
        if (!p || !Number.isFinite(p.lat)) { els.radarCard.hidden = true; return; }
        els.radarCard.hidden = false;
        const draw = () => {
            if (!els.miniMap.isConnected) return;
            const key = `${p.lat},${p.lon},${radar && radar.frames.length ? radar.frames[radar.frames.length - 1].id : ''},${mapStyle}`;
            if (!miniMap) miniMap = TileMap(els.miniMap, { lat: p.lat, lon: p.lon, zoom: 6, interactive: false });
            else if (miniKey !== key) miniMap.center(p.lat, p.lon, 6);
            miniKey = key;
            const f = radar && radar.frames[radar.frames.length - 1];
            els.radarCardTime.textContent = f ? frameLabel(f) : '';
        };
        if (radar && Date.now() - radarAt < 4 * 60 * 1000) { draw(); return; }
        loadRadar().then(draw).catch(() => { els.radarCardTime.textContent = 'Radar is not available right now.'; draw(); });
    }

    async function openRadar() {
        const p = selected();
        if (!p || !Number.isFinite(p.lat)) return;
        pushLayer('radar');
        try {
            await ws.busy(() => loadRadar(true), { delay: 250, timeout: 15000 });
        } catch (_) {
            ws.messageBox({ title: 'Weather', icon: 'error', text: 'Radar could not be loaded. Check the data connection, then try again.' });
            return;
        }
        if (layers[layers.length - 1] !== 'radar') return;
        if (!fullMap) fullMap = TileMap(els.fullMap, { lat: p.lat, lon: p.lon, zoom: 7, interactive: true, allFrames: true, frameId: () => (radar && radar.frames[radarFrame] ? radar.frames[radarFrame].id : null) });
        else fullMap.center(p.lat, p.lon, 7);
        const frames = radar.frames;
        buildRadarTrackbar(frames);
        els.mapAttr.textContent = radar.attribution || '';
        setRadarFrame(frames.length - 1);
        startRadarPlay();
    }

    /**
     * The radar's time trackbar: the shell's own WM trackbar (wmSettings.ui.trackbar, Settings' Text
     * Size look), one step per frame, the oldest frame's time and Now at its ends. Never a native
     * range input (Yukimi, Nov 13: a proper slider or the platform's own).
     */
    let radarTrack = null;
    function buildRadarTrackbar(frames) {
        els.mapTrack.innerHTML = '';
        radarTrack = null;
        const ui = window.wmSettings && window.wmSettings.ui;
        if (!ui || typeof ui.trackbar !== 'function' || frames.length < 2) return;
        const first = new Date(frames[0].time * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        radarTrack = ui.trackbar(els.mapTrack, {
            steps: frames.map((_, i) => i),
            value: frames.length - 1,
            lo: first,
            hi: 'Now',
            label: 'Radar time',
            onChange: (i) => { stopRadarPlay(); setRadarFrame(i); }
        });
    }

    function setRadarFrame(i) {
        if (!radar || !radar.frames.length) return;
        radarFrame = Math.max(0, Math.min(radar.frames.length - 1, i));
        if (radarTrack) radarTrack.set(radarFrame);
        const f = radar.frames[radarFrame];
        els.mapTime.textContent = frameLabel(f);
        if (fullMap) fullMap.show(f.id);
    }

    function startRadarPlay() {
        stopRadarPlay();
        if (!radar || radar.frames.length < 2) return;
        els.mapPlay.classList.add('is-playing');
        els.mapPlay.setAttribute('aria-label', 'Pause');
        let hold = 0;
        radarTimer = setInterval(() => {
            if (document.hidden) return;
            if (radarFrame === radar.frames.length - 1 && hold++ < 3) return; // rest on the newest frame
            hold = 0;
            setRadarFrame(radarFrame === radar.frames.length - 1 ? 0 : radarFrame + 1);
        }, 550);
        ws.refreshSoftKeys();
    }

    function stopRadarPlay() {
        clearInterval(radarTimer);
        radarTimer = null;
        if (els && els.mapPlay) { els.mapPlay.classList.remove('is-playing'); els.mapPlay.setAttribute('aria-label', 'Play'); }
        if (ws) ws.refreshSoftKeys();
    }

    function toggleRadarPlay() {
        if (radarTimer) stopRadarPlay(); else startRadarPlay();
    }

    function setMapStyle(style) {
        mapStyle = style;
        save('wmWeatherMapStyle', style);
        if (fullMap) fullMap.layout();
        if (miniMap) miniMap.layout();
    }

    // ---------------------------------------------------------------- header animations (#792)
    //
    // A short full-header play of the weather (our own, in the spirit of HTC Sense's weather intros)
    // when Weather opens, the place changes or the sky is tapped, then the calm CSS scene goes on:
    //   rain / drizzle / heavy   drops land on the glass, swell and run down leaving a wet trail
    //   storm                    the rain, two flashes and a forked bolt
    //   snow / sleet             flakes tumble down, swaying
    //   clear, fair (day)        a flare sweeps across from the sun, ghosts along its line
    //   clear, fair (night)      a shooting star or two over twinkling stars
    //   partly / cloudy          banks of cloud roll through
    //   fog                      mist bands drift through and thin out
    // One canvas over the scene, drawn at the device's pixel ratio; ~3.4 s; stops while hidden; none
    // with reduced motion or Settings > Animated weather effects off.
    const FX_MS = 3400;
    const fx = { canvas: null, ctx: null, raf: 0, t0: 0, scene: '', phase: '', parts: null, w: 0, h: 0, dpr: 1 };
    const rand = (a, b) => a + Math.random() * (b - a);
    const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

    function fxStop() {
        if (fx.raf) cancelAnimationFrame(fx.raf);
        fx.raf = 0;
        if (fx.ctx) fx.ctx.clearRect(0, 0, fx.w, fx.h);
        if (fx.canvas) fx.canvas.classList.remove('is-on');
    }

    function fxSetup() {
        if (!fx.canvas) {
            fx.canvas = document.createElement('canvas');
            fx.canvas.className = 'wxw-fx';
            fx.canvas.setAttribute('aria-hidden', 'true');
            els.scene.insertBefore(fx.canvas, els.scene.querySelector('.wxw-hero'));
            fx.ctx = fx.canvas.getContext('2d');
        }
        const r = els.scene.getBoundingClientRect();
        fx.dpr = Math.min(3, window.devicePixelRatio || 1);
        fx.w = Math.max(1, Math.round(r.width * fx.dpr));
        fx.h = Math.max(1, Math.round(r.height * fx.dpr));
        if (fx.canvas.width !== fx.w) fx.canvas.width = fx.w;
        if (fx.canvas.height !== fx.h) fx.canvas.height = fx.h;
    }

    /** The particles for a scene, in canvas pixels. */
    function fxParts(scene, phase) {
        const { w, h, dpr } = fx;
        const u = dpr * Math.max(0.6, Math.min(1.6, w / dpr / 360));
        if (/^(drizzle|rain|heavy|storm|sleet)$/.test(scene)) {
            const n = scene === 'drizzle' ? 26 : scene === 'heavy' || scene === 'storm' ? 70 : 46;
            return {
                drops: Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(-h * 0.1, h * 0.85), r: rand(2.5, scene === 'drizzle' ? 5 : 8) * u, at: rand(0, 0.55), slide: Math.random() < 0.45, v: rand(40, 140) * u, wob: rand(0, 6) })),
                streaks: Array.from({ length: Math.round(n * 1.6) }, () => ({ x: rand(-w * 0.2, w), y: rand(-h, h), len: rand(14, 34) * u, v: rand(900, 1500) * u })),
                bolt: scene === 'storm' ? fxBolt(w, h) : null,
                snow: scene === 'sleet' ? fxSnow(Math.round(n * 0.6), u) : null
            };
        }
        if (scene === 'snow') return { snow: fxSnow(90, u) };
        if (scene === 'fog') return { bands: Array.from({ length: 5 }, (_, i) => ({ y: h * (0.25 + i * 0.13), hgt: rand(30, 60) * u, x: rand(-w, 0), v: rand(60, 140) * u, a: rand(0.18, 0.32) })) };
        if (scene === 'cloudy' || scene === 'partly') {
            return { clouds: Array.from({ length: scene === 'cloudy' ? 7 : 4 }, (_, i) => ({ y: h * rand(0.05, 0.55), s: rand(0.7, 1.4) * u, x: i % 2 ? w * 1.2 : -w * 0.6, v: (i % 2 ? -1 : 1) * rand(160, 320) * u, a: rand(0.35, 0.7) })) };
        }
        if (phase === 'night') {
            return {
                stars: Array.from({ length: 40 }, () => ({ x: rand(0, w), y: rand(0, h * 0.6), r: rand(0.6, 1.8) * u, at: rand(0, 1) })),
                meteors: Array.from({ length: Math.random() < 0.5 ? 1 : 2 }, (_, i) => ({ x: rand(w * 0.3, w * 1.1), y: rand(0, h * 0.25), at: 0.15 + i * 0.35, v: rand(900, 1300) * u }))
            };
        }
        return { flare: { from: { x: w * 0.82, y: h * 0.16 }, u } };
    }

    function fxSnow(n, u) {
        return Array.from({ length: n }, () => ({ x: rand(0, fx.w), y: rand(-fx.h, 0), r: rand(1.4, 4) * u, v: rand(50, 120) * u, sway: rand(10, 30) * u, ph: rand(0, 6.28), spin: rand(0.6, 2) }));
    }

    /** A forked bolt from the top: a jagged main path and one branch. */
    function fxBolt(w, h) {
        const pts = [];
        let x = rand(w * 0.25, w * 0.75);
        let y = 0;
        while (y < h * 0.78) { pts.push([x, y]); x += rand(-w * 0.06, w * 0.06); y += rand(h * 0.05, h * 0.1); }
        const k = Math.floor(pts.length / 2);
        const branch = [pts[k]];
        let [bx, by] = pts[k];
        for (let i = 0; i < 4; i++) { bx += rand(w * 0.02, w * 0.07) * (pts[k][0] > w / 2 ? -1 : 1); by += rand(h * 0.04, h * 0.08); branch.push([bx, by]); }
        return { pts, branch };
    }

    function fxFrame(now) {
        const t = (now - fx.t0) / FX_MS; // 0..1
        const c = fx.ctx;
        const { w, h } = fx;
        const P = fx.parts;
        c.clearRect(0, 0, w, h);
        if (t >= 1 || document.hidden) { fxStop(); return; }
        const fade = t < 0.08 ? t / 0.08 : t > 0.8 ? (1 - t) / 0.2 : 1;
        const s = (now - fx.t0) / 1000;
        c.save();
        c.globalAlpha = fade;
        if (P.streaks) {
            c.strokeStyle = 'rgba(200, 225, 255, 0.45)';
            c.lineWidth = Math.max(1, fx.dpr * 0.9);
            c.beginPath();
            P.streaks.forEach((k) => {
                const y = ((k.y + k.v * s) % (h * 1.4)) - h * 0.2;
                const x = k.x + (y + h * 0.2) * 0.18;
                c.moveTo(x, y);
                c.lineTo(x + k.len * 0.18, y + k.len);
            });
            c.stroke();
        }
        if (P.drops) {
            P.drops.forEach((d) => {
                if (t < d.at) return;
                const age = (t - d.at) * FX_MS / 1000;
                const grow = Math.min(1, age * 4);
                const y = d.slide ? d.y + Math.max(0, age - 0.25) ** 1.6 * d.v : d.y;
                const x = d.x + Math.sin(age * 3 + d.wob) * (d.slide ? 1.5 * fx.dpr : 0);
                const r = d.r * (0.5 + 0.5 * grow);
                if (d.slide && y > d.y + 2) {
                    // the wet trail it leaves behind
                    const g = c.createLinearGradient(x, d.y, x, y);
                    g.addColorStop(0, 'rgba(210, 230, 255, 0)');
                    g.addColorStop(1, 'rgba(210, 230, 255, 0.22)');
                    c.fillStyle = g;
                    c.fillRect(x - r * 0.35, d.y, r * 0.7, y - d.y);
                }
                // a bead of water: darker rim, a bright highlight up and left (light through glass)
                const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
                g.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
                g.addColorStop(0.35, 'rgba(220, 235, 255, 0.25)');
                g.addColorStop(0.85, 'rgba(40, 60, 90, 0.25)');
                g.addColorStop(1, 'rgba(255, 255, 255, 0.35)');
                c.fillStyle = g;
                c.beginPath();
                c.ellipse(x, y, r, r * (d.slide ? 1.15 : 1), 0, 0, Math.PI * 2);
                c.fill();
            });
        }
        if (P.bolt) {
            [0.22, 0.52].forEach((at, i) => {
                const k = (t - at) / 0.07;
                if (k < 0 || k > 1) return;
                c.fillStyle = `rgba(230, 235, 255, ${(1 - k) * (i ? 0.45 : 0.6)})`;
                c.fillRect(0, 0, w, h);
                if (i === 0) {
                    c.save();
                    c.globalAlpha = fade * (1 - k);
                    c.shadowColor = 'rgba(190, 210, 255, 1)';
                    c.shadowBlur = 18 * fx.dpr;
                    c.strokeStyle = '#fff';
                    c.lineJoin = 'round';
                    [[P.bolt.pts, 3], [P.bolt.branch, 1.6]].forEach(([pts, lw]) => {
                        c.lineWidth = lw * fx.dpr;
                        c.beginPath();
                        pts.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y)));
                        c.stroke();
                    });
                    c.restore();
                }
            });
        }
        if (P.snow) {
            c.fillStyle = 'rgba(255, 255, 255, 0.9)';
            P.snow.forEach((f) => {
                const y = f.y + f.v * s * 1.6 + h * t * 0.4;
                const x = f.x + Math.sin(s * f.spin + f.ph) * f.sway;
                if (y < -10 || y > h + 10) return;
                c.beginPath();
                c.arc(x, y, f.r, 0, Math.PI * 2);
                c.fill();
            });
        }
        if (P.bands) {
            P.bands.forEach((b) => {
                const x = b.x + b.v * s;
                const g = c.createLinearGradient(0, b.y - b.hgt, 0, b.y + b.hgt);
                g.addColorStop(0, 'rgba(235, 240, 245, 0)');
                g.addColorStop(0.5, `rgba(235, 240, 245, ${b.a})`);
                g.addColorStop(1, 'rgba(235, 240, 245, 0)');
                c.fillStyle = g;
                c.fillRect(x, b.y - b.hgt, w * 1.6, b.hgt * 2);
            });
        }
        if (P.clouds) {
            P.clouds.forEach((k) => {
                const x = k.x + k.v * s;
                c.fillStyle = `rgba(255, 255, 255, ${k.a})`;
                c.beginPath();
                [[0, 0, 46], [40, -14, 38], [80, 0, 42], [30, 14, 40], [64, 12, 36]].forEach(([dx, dy, r]) => {
                    c.moveTo(x + dx * k.s + r * k.s, y0(k) + dy * k.s);
                    c.arc(x + dx * k.s, y0(k) + dy * k.s, r * k.s, 0, Math.PI * 2);
                });
                c.fill();
            });
        }
        if (P.stars) {
            c.fillStyle = '#fff';
            P.stars.forEach((st) => {
                c.globalAlpha = fade * (0.35 + 0.65 * Math.abs(Math.sin((t + st.at) * Math.PI * 3)));
                c.beginPath();
                c.arc(st.x, st.y, st.r, 0, Math.PI * 2);
                c.fill();
            });
            c.globalAlpha = fade;
            P.meteors.forEach((m) => {
                const k = (t - m.at) / 0.35;
                if (k < 0 || k > 1) return;
                const x = m.x - m.v * k * 0.6;
                const y = m.y + m.v * k * 0.3;
                const g = c.createLinearGradient(x, y, x + 90 * fx.dpr, y - 45 * fx.dpr);
                g.addColorStop(0, `rgba(255, 255, 255, ${1 - k})`);
                g.addColorStop(1, 'rgba(255, 255, 255, 0)');
                c.strokeStyle = g;
                c.lineWidth = 2 * fx.dpr;
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x + 90 * fx.dpr, y - 45 * fx.dpr);
                c.stroke();
            });
        }
        if (P.flare) {
            // the flare sweeps from the sun across the header; ghosts sit on the line through its centre
            const { from, u } = P.flare;
            const k = Math.min(1, t * 1.25);
            const cx = from.x;
            const cy = from.y;
            const tx = w * (1 - k) * 0.9;
            const ty = h * (0.2 + 0.5 * k);
            c.globalCompositeOperation = 'lighter';
            const glow = c.createRadialGradient(cx, cy, 0, cx, cy, 120 * u);
            glow.addColorStop(0, 'rgba(255, 250, 220, 0.75)');
            glow.addColorStop(1, 'rgba(255, 230, 160, 0)');
            c.fillStyle = glow;
            c.fillRect(0, 0, w, h);
            [[0.25, 18, 'rgba(255, 210, 140, 0.35)'], [0.5, 30, 'rgba(160, 220, 255, 0.25)'], [0.7, 12, 'rgba(255, 180, 220, 0.35)'], [1.0, 46, 'rgba(180, 255, 200, 0.18)']].forEach(([f, r, col]) => {
                const x = cx + (tx - cx) * f;
                const y = cy + (ty - cy) * f;
                c.fillStyle = col;
                c.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = (Math.PI / 3) * i + Math.PI / 6;
                    const px = x + Math.cos(a) * r * u;
                    const py = y + Math.sin(a) * r * u;
                    if (i) c.lineTo(px, py); else c.moveTo(px, py);
                }
                c.closePath();
                c.fill();
            });
            // a streak through the sun
            const sg = c.createLinearGradient(cx - 160 * u, cy, cx + 160 * u, cy);
            sg.addColorStop(0, 'rgba(255, 240, 200, 0)');
            sg.addColorStop(0.5, 'rgba(255, 240, 200, 0.55)');
            sg.addColorStop(1, 'rgba(255, 240, 200, 0)');
            c.fillStyle = sg;
            c.fillRect(cx - 160 * u, cy - 1.5 * u, 320 * u, 3 * u);
            c.globalCompositeOperation = 'source-over';
        }
        c.restore();
        fx.raf = requestAnimationFrame(fxFrame);
    }

    const y0 = (k) => k.y;

    /** Play the intro for the scene on screen (force: replay even when the scene is the same). */
    function fxPlay(force) {
        if (!els || !shown || settings.effects === false || reducedMotion() || document.hidden) return;
        const scene = els.scene.dataset.scene;
        const phase = els.scene.dataset.phase;
        const p = selected();
        if (!p || !dataOf(p)) return;
        const key = `${p.id}|${scene}|${phase}`;
        if (!force && fx.raf && fx.key === key) return;
        fxStop();
        fxSetup();
        fx.key = key;
        fx.parts = fxParts(scene, phase);
        fx.canvas.classList.add('is-on');
        fx.t0 = performance.now();
        fx.raf = requestAnimationFrame(fxFrame);
    }

    window.wmWeatherFx = {
        play: () => fxPlay(true),
        enabled(on) { settings.effects = !!on; if (!on) fxStop(); }
    };

    // ---------------------------------------------------------------- settings (#792)

    const LEADS = [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']];
    const RADII = [[1, '1 km'], [3, '3 km'], [5, '5 km'], [10, '10 km'], [25, '25 km']];

    function openSettings() { pushLayer('settings'); }

    /** Menu > Settings: a WM form (wmSettings.ui), changes apply at once. */
    function renderSettings() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const box = els.settingsBody;
        if (!ui) { box.innerHTML = '<p>Settings are not available.</p>'; return; }
        const admin = isAdmin();
        const off = admin ? '' : 'disabled';
        const placeHtml = (id) => {
            const m = monitored[id];
            if (!m) return `${ui.sub(PLACE_LABEL[id])}${ui.note(`Not set. In Locations, tap and hold a place and choose Save as ${PLACE_LABEL[id]} or Set as ${PLACE_LABEL[id]}.`)}`;
            const lead = (LEADS.find(([v]) => v === (m.rainLeadMin || 15)) || LEADS[2])[1];
            const rad = (RADII.find(([v]) => v === (m.radiusKm || 3)) || [0, `${m.radiusKm} km`])[1];
            return `${ui.sub(`${PLACE_LABEL[id]}: ${m.name}${m.fallback ? ' (configured location)' : ''}`)}
                ${ui.check(`${id}-alerts`, 'Weather alerts', m.alerts !== false, off)}
                ${ui.check(`${id}-rain`, 'Rain alarm', !!m.rainAlarm, off)}
                ${ui.row('Warn me', ui.comboHtml(`${id}-lead`, lead, !admin || !m.rainAlarm))}
                ${ui.row('Radius', ui.comboHtml(`${id}-radius`, rad, !admin))}`;
        };
        box.innerHTML = `
            ${ui.sub('Units')}
            ${ui.radio('unit', 'C', 'Celsius (°C, km/h, mm)', unit() === 'C')}
            ${ui.radio('unit', 'F', 'Fahrenheit (°F, mph, in)', unit() === 'F')}
            ${ui.gap()}
            ${ui.check('feels', 'Use feels-like as the main temperature', settings.feels)}
            ${ui.check('effects', 'Animated weather effects', settings.effects !== false)}
            ${ui.gap()}
            ${placeHtml('home')}
            ${ui.gap()}
            ${placeHtml('work')}
            ${ui.gap()}
            ${ui.note(admin ? 'Home and Work are watched for weather alerts and rain, also while Weather is closed. Sounds: Settings > Sounds & Notifications (Weather: Alert, Weather: Severe alert, Weather: Rain alarm).' : 'Only the administrator can change Home and Work.')}`;
        box.querySelectorAll('input[name="unit"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setUnit(r.value); }));
        box.querySelector('input[name="feels"]').addEventListener('change', (e) => { settings.feels = e.target.checked; saveSettings(); render(); changed(); });
        box.querySelector('input[name="effects"]').addEventListener('change', (e) => {
            settings.effects = e.target.checked;
            saveSettings();
            if (window.wmWeatherFx) window.wmWeatherFx.enabled(settings.effects);
        });
        MONITORED.forEach((id) => {
            if (!monitored[id] || !admin) return;
            const chk = (name, key) => {
                const el = box.querySelector(`input[name="${id}-${name}"]`);
                if (el) el.addEventListener('change', async () => { if (!(await patchMonitored(id, { [key]: el.checked }))) el.checked = !el.checked; renderSettings(); });
            };
            chk('alerts', 'alerts');
            chk('rain', 'rainAlarm');
            const lead = box.querySelector(`[data-act="${id}-lead"]`);
            if (lead && !lead.disabled) ui.bindCombo(lead, LEADS, monitored[id].rainLeadMin || 15, (v) => patchMonitored(id, { rainLeadMin: Number(v) }).then(renderSettings));
            const rad = box.querySelector(`[data-act="${id}-radius"]`);
            if (rad) ui.bindCombo(rad, RADII, monitored[id].radiusKm || 3, (v) => patchMonitored(id, { radiusKm: Number(v) }).then(() => { renderSettings(); render(); }));
        });
    }

    /** The Alert page for Home / Work's alerts (the status bubble's View Alerts). */
    function showAlerts() {
        if (ws) ws.open(APP_ID);
        setTimeout(() => {
            const st = statusState();
            if (st.alerts[0]) {
                const id = st.alerts.find(Boolean);
                const pid = MONITORED.find((m) => ((activeAlerts && activeAlerts.places && activeAlerts.places[m]) || {}).alerts?.some((a) => a.id === id.id));
                if (pid) select(pid);
                layers = layers.filter((l) => l !== 'alert');
                openAlerts(id.id);
            }
        }, 0);
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
            text: `Melaton Weather\nVersion 2.0\n\nCopyright © 2026 Xyridian Corporation. All rights reserved.\n\nForecast data: ${providerName()}.\nRadar: RainViewer. Map: © Esri, HERE, Garmin, © OpenStreetMap contributors.${/Apple/.test(providerName()) ? '' : '\nAlerts (US): National Weather Service.'}`
        });
    }

    function mainMenu() {
        return [
            { label: 'Locations', action: openPlaces },
            { label: 'Add Location...', action: openAdd },
            '-',
            { label: 'Radar', disabled: !(selected() && Number.isFinite(selected().lat)), action: () => openRadar() },
            { label: 'Graphs', disabled: !dataOf(selected()), action: () => openGraphs() },
            { label: 'Alerts', disabled: !placeAlerts(dataOf(selected())).length, action: () => openAlerts() },
            { label: 'Today in Detail', disabled: !(dataOf(selected()) && dataOf(selected()).daily && dataOf(selected()).daily.length), action: () => openDay(dataOf(selected()).daily[0].date) },
            '-',
            {
                label: 'Units',
                submenu: () => [
                    { label: 'Celsius (°C, km/h)', radio: unit() === 'C', action: () => setUnit('C') },
                    { label: 'Fahrenheit (°F, mph)', radio: unit() === 'F', action: () => setUnit('F') }
                ]
            },
            { label: 'Refresh', disabled: !selected(), action: userRefresh },
            { label: 'Settings...', action: openSettings },
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

    /** The server's weather broadcasts (#792): Home / Work, their alerts and rain. */
    let wired = false;
    function wireServer() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        const data = (pk) => (pk && (pk.data || pk)) || {};
        c.on('weather_places_changed', (pk) => applyMonitored(data(pk).places));
        c.on('weather_alerts_changed', (pk) => { activeAlerts = data(pk); if (ws) ws.refreshStatus(); if (shown) render(); });
        c.on('weather_rain_status', (pk) => { rainStatus = data(pk); if (ws) ws.refreshStatus(); });
        loadMonitored();
        return true;
    }

    function register() {
        ws = window.wmShell;
        if (!wireServer()) { let n = 0; const t = setInterval(() => { if (wireServer() || ++n > 120) clearInterval(t); }, 1000); }
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
                // the intro once the page is laid out (and again when first data lands: select / update)
                setTimeout(() => fxPlay(true), 120);
                startPoll();
                // opening is a tap: a first load without any data shows the cursor and answers a failure
                const p = selected();
                if (p && !dataOf(p)) {
                    ws.busy(update(p).then(() => { changed(); render(); fxPlay(true); }), { delay: 250, timeout: 20000 })
                        .catch(() => ws.messageBox({ title: 'Weather', icon: 'error', text: 'Weather information could not be loaded. Check the data connection, then try again.' }));
                } else {
                    quiet(false);
                }
                if (!p) quiet(false);
            },
            hide() {
                shown = false;
                stopRadarPlay();
                fxStop();
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
                if (top === 'radar') {
                    return {
                        left: { label: radarTimer ? 'Pause' : 'Play', action: toggleRadarPlay },
                        right: {
                            label: 'Menu',
                            menu: () => [
                                { label: 'Zoom In', action: () => fullMap && fullMap.zoomBy(1) },
                                { label: 'Zoom Out', action: () => fullMap && fullMap.zoomBy(-1) },
                                { label: 'Show This Place', action: () => fullMap && fullMap.home() },
                                '-',
                                { label: 'Map', submenu: () => [
                                    { label: 'Dark', radio: mapStyle === 'dark', action: () => setMapStyle('dark') },
                                    { label: 'Light', radio: mapStyle === 'light', action: () => setMapStyle('light') },
                                    { label: 'Streets', radio: mapStyle === 'streets', action: () => setMapStyle('streets') }
                                ] },
                                { label: 'Latest Radar', action: () => { stopRadarPlay(); setRadarFrame(radar ? radar.frames.length - 1 : 0); } },
                                { label: 'Refresh', action: () => { radarAt = 0; fullMap = null; els.fullMap.innerHTML = ''; layers.pop(); openRadar(); } },
                                '-',
                                { label: 'Done', action: popLayer }
                            ]
                        }
                    };
                }
                if (top === 'graphs') {
                    return {
                        left: { label: 'Done', action: popLayer },
                        right: {
                            label: 'Menu',
                            menu: () => GRAPHS.map((g) => ({ label: g.label, radio: g.id === graphKind, action: () => { graphKind = g.id; renderGraph(); } }))
                                .concat(['-'], GRAPH_RANGES.map(([r, label]) => ({ label: `Next ${label}`, radio: r === graphRange, action: () => { graphRange = r; renderGraph(); } })))
                        }
                    };
                }
                if (top === 'day') {
                    const days = (dataOf(selected()) || {}).daily || [];
                    const at = days.findIndex((d) => d.date === dayDate);
                    return {
                        left: { label: 'Done', action: popLayer },
                        right: {
                            label: 'Menu',
                            menu: () => [
                                { label: 'Previous Day', disabled: at <= 0, action: () => stepDay(-1) },
                                { label: 'Next Day', disabled: at >= days.length - 1, action: () => stepDay(1) },
                                '-',
                                { label: 'Hourly Graphs', action: () => openGraphs() }
                            ]
                        }
                    };
                }
                if (top === 'alert' || top === 'settings') {
                    return { left: { label: 'Done', action: popLayer }, right: null };
                }
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
            const cond = condOf(cur, cur.isDay !== false);
            const today = data.daily && data.daily[0];
            return {
                place: p.name,
                region: p.here ? '' : [p.region, p.country].filter(Boolean).join(', '),
                here: !!p.here,
                tempC: num(mainC(cur)),
                temp: tempOf(mainC(cur)),
                feelsLike: !!settings.feels,
                unit: unit(),
                code: cur.code,
                condition: cond.text,
                icon: cond.icon,
                iconUrl: iconUrl(cond.icon),
                iconUrl2x: iconUrl(cond.icon, true),
                isDay: cur.isDay !== false,
                hiC: today ? num(hiC(today)) : null,
                loC: today ? num(loC(today)) : null,
                hi: today ? tempOf(hiC(today)) : null,
                lo: today ? tempOf(loC(today)) : null,
                updatedAt: (cache[keyOf(p)] || {}).at || null
            };
        },
        /** The days after today for the selected place: [{ day, condition, iconUrl, iconUrl2x, hi, lo, rain }] (6.5 home screen pages). */
        forecast() {
            const p = selected();
            const data = dataOf(p);
            if (!p || !data || !Array.isArray(data.daily)) return [];
            return data.daily.slice(1, 7).map((d) => {
                const cond = condOf(d, true);
                return { day: DAYS[dayOf(d.date)], condition: cond.text, icon: cond.icon, iconUrl: iconUrl(cond.icon), iconUrl2x: iconUrl(cond.icon, true), hi: tempOf(hiC(d)), lo: tempOf(loC(d)), rain: num(d.rain) };
            });
        },
        open() { if (ws) ws.open(APP_ID); },
        /** A broadcast alert (weatherAlerts.js): the app on its Alert page. */
        showAlert,
        /** The selected place's active alerts. */
        alerts() { return placeAlerts(dataOf(selected())); },
        /** Home / Work alerts and rain for the shell's status icons (cheap). */
        statusState,
        /** The Alert page for Home / Work's alerts. */
        showAlerts,
        /** { home, work } as the server keeps them. */
        monitored: () => monitored,
        refresh() { return quiet(false); },
        unit: () => unit(),
        iconUrl
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
