/**
 * Weather alerts (Yozora #780, #1127). The server's weather service watches Home, Work and the phone's
 * current location (reported from here, weather_here_set) and broadcasts each new alert once to every signed-in client
 * (weather_alert_issued: { alert, place, source }; modules/weatherService.js pollAlerts).
 *
 *   Desktop  the Weather Alert tray icon (weatherAlertTrayIcon) while any alert is active, its tooltip the alerts'
 *            titles, a click opens Melaton Weather on the alert; each new alert also raises a Vista tray balloon on
 *            that icon (PopoverManager, popup id weather-alert; tray-balloons.mdc) with the alert's name and
 *            severity, where it is and from / until when. No message box: details() falls back to one only when
 *            the Weather program cannot load at all. The active list comes from the server's pushes
 *            (weather_alerts_changed, weather_alert_issued) and one weather_alerts_active once the desktop is up and
 *            the socket is connected; alerts past their end drop out when an event arrives (no timer).
 *   Phone    a WM notification; View opens Melaton Mobile's Weather on the alert
 *            (wmWeather.showAlert). Errors-style notes stay until dismissed.
 *
 * Rain alarm (#792): weather_rain_alarm for Home / Work, once per spell: a WM notification in the
 * Weather: Rain alarm class on phones, a notification on the desktop.
 *
 * Texts (desktop balloon, phone note): where(alert, place) "Home (Setagaya) - Tokyo 23 wards" and windowText(alert,
 * place, now) "From today 6:00 PM until tomorrow 9:00 AM". The server gives startsAt / endsAt (epoch ms) and the
 * place's tz; without them the alert's wall-clock strings (the place's own clock) are used.
 *
 * window.weatherAlerts: last() -> the last alert received, details(alert) opens its text, active() -> the active
 * alerts, _where / _windowText for tests.
 */
(function (root) {
    'use strict';

    const SEVERITY_WORD = { extreme: 'Extreme', severe: 'Severe', moderate: 'Moderate', minor: 'Minor' };
    const shown = new Set();
    let lastAlert = null;
    let wired = false;

    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isPhone = () => root.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');
    /** The notification inbox's copy (#876): used or dismissed here, gone from the inbox and Android too. */
    function inboxDone(id, how) {
        const ni = root.wmNotificationInbox;
        if (!ni) return;
        if (how === 'acted' && typeof ni.acted === 'function') ni.acted(id);
        else if (typeof ni.clear === 'function') ni.clear(id);
    }

    // ---- texts (shared by the desktop balloon and the phone note) ----

    const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_e) { return ''; } };

    /** Offset (ms) of an IANA zone from UTC at an instant. */
    function zoneOffset(ms, tz) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
        }).formatToParts(new Date(ms));
        const v = {};
        parts.forEach((p) => { v[p.type] = Number(p.value); });
        return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(ms / 1000) * 1000;
    }

    /** 'YYYY-MM-DDTHH:MM' on a place's clock -> epoch ms (the viewer's clock when the zone is not known). */
    function wallMs(iso, tz) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || '');
        if (!m) return NaN;
        const parts = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])];
        if (!tz) return new Date(parts[0], parts[1], parts[2], parts[3], parts[4]).getTime();
        try {
            const guess = Date.UTC(parts[0], parts[1], parts[2], parts[3], parts[4]);
            let ms = guess - zoneOffset(guess, tz);
            ms = guess - zoneOffset(ms, tz);
            return ms;
        } catch (_e) {
            return new Date(parts[0], parts[1], parts[2], parts[3], parts[4]).getTime();
        }
    }

    /** The alert's start or end as epoch ms: the server's startsAt / endsAt, else the wall-clock strings. NaN if none. */
    function edgeMs(alert, edge, place) {
        const n = Number(edge === 'start' ? alert.startsAt : alert.endsAt);
        if (Number.isFinite(n) && n > 0) return n;
        const iso = edge === 'start' ? (alert.onset || alert.effective) : (alert.ends || alert.expires);
        return wallMs(iso, place && place.tz);
    }

    /** The zone to write times in: the place's when it is known and not the viewer's own, else the viewer's (undefined). */
    function textZone(place) {
        const tz = place && place.tz;
        return tz && tz !== viewerZone() ? tz : undefined;
    }

    function dayWord(ms, now, zone) {
        const key = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: zone }).split('-').map(Number);
        const a = key(ms);
        const b = key(now);
        const diff = Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
        if (diff === 0) return 'today';
        if (diff === 1) return 'tomorrow';
        if (diff === -1) return 'yesterday';
        const d = new Date(ms);
        const wd = d.toLocaleDateString(undefined, { weekday: 'short', timeZone: zone });
        if (diff > 1 && diff <= 6) return wd;
        return `${wd} ${d.toLocaleDateString(undefined, { day: 'numeric', timeZone: zone })} ${d.toLocaleDateString(undefined, { month: 'short', timeZone: zone })}`;
    }

    const clock = (ms, zone, withZone) => new Date(ms).toLocaleTimeString(undefined, Object.assign({ hour: 'numeric', minute: '2-digit', timeZone: zone }, withZone ? { timeZoneName: 'short' } : {}));

    /** "Home (Setagaya) - Tokyo 23 wards": the place, then the area when it adds something. */
    function where(alert, place) {
        const label = (place && (place.label || place.name)) || '';
        const name = (place && place.name) || '';
        const area = String((alert && alert.area) || '').trim();
        if (!label) return area;
        let out = name && name !== label ? `${label} (${name})` : label;
        if (area && area !== name && area !== label && area.length <= 60) out += ` - ${area}`;
        return out;
    }

    /** "From today 6:00 PM until tomorrow 9:00 AM" / "Until tomorrow 9:00 AM" / "From Wed 6:00 PM" / "Ended 9:00 AM". */
    function windowText(alert, place, now) {
        const t = Number.isFinite(now) ? now : Date.now();
        const zone = textZone(place);
        const start = edgeMs(alert, 'start', place);
        const end = edgeMs(alert, 'end', place);
        const hasEnd = Number.isFinite(end);
        const stamp = (ms, last, skipToday) => {
            const day = dayWord(ms, t, zone);
            return `${skipToday && day === 'today' ? '' : `${day} `}${clock(ms, zone, last && !!zone)}`;
        };
        if (!hasEnd) return Number.isFinite(start) ? `From ${stamp(start, true)}` : '';
        if (end <= t) return `Ended ${stamp(end, true, true)}`;
        if (Number.isFinite(start) && start > t) return `From ${stamp(start, false)} until ${stamp(end, true)}`;
        return `Until ${stamp(end, true)}`;
    }

    /** Where and when on one line (a phone note's text, the toast fallback). */
    function summary(alert, place) {
        return [where(alert, place), windowText(alert, place, Date.now())].filter(Boolean).join('. ');
    }

    const severityOf = (alert) => SEVERITY_WORD[alert.severity] || '';
    const alertTitle = (alert) => `${alert.title || 'Weather Alert'}${severityOf(alert) ? ` (${severityOf(alert)})` : ''}`;

    async function fullText(alert) {
        if (alert.text) return { text: alert.text, instruction: alert.instruction || '' };
        const c = root.wsClient;
        if (!c || typeof c.sendMessage !== 'function' || alert.provider === 'nws') return { text: '', instruction: '' };
        try {
            const r = await c.sendMessage('weather_alert', { id: alert.id }, false);
            const d = r && (r.data || r);
            return { text: (d && d.text) || '', instruction: '' };
        } catch (_e) {
            return { text: '', instruction: '' };
        }
    }

    async function details(alert) {
        if (!alert) return;
        // the Weather app's Alert page on the phone and on the desktop (Melaton Weather, #792); on the desktop
        // melatonWeatherOpener.js's stub loads the program first. The message box below is only for a Weather
        // program that cannot load at all (the stub is still in place after its showAlert answered)
        if (root.wmWeather && typeof root.wmWeather.showAlert === 'function') {
            try { await root.wmWeather.showAlert(alert); } catch (_e) { /* load failed: the box below */ }
            if (root.wmWeather && typeof root.wmWeather.statusState === 'function') return; // the real program's export
        }
        const body = await fullText(alert);
        const sev = SEVERITY_WORD[alert.severity] || '';
        const html = `<div class="weather-alert-dialog">
            <p><strong>${esc(alert.title)}</strong>${sev ? ` (${esc(sev)})` : ''}</p>
            ${alert.headline ? `<p>${esc(alert.headline)}</p>` : ''}
            ${alert.area ? `<p>${esc(alert.area)}</p>` : ''}
            ${body.text ? `<p style="white-space:pre-wrap">${esc(body.text)}</p>` : ''}
            ${body.instruction ? `<p style="white-space:pre-wrap"><strong>What to do:</strong> ${esc(body.instruction)}</p>` : ''}
            <p>${esc(alert.source || '')}</p></div>`;
        if (typeof root.showConfirmationDialog === 'function') {
            root.showConfirmationDialog(html, [{ text: 'Close', value: true, className: 'btn-primary' }], { title: 'Weather Alert' });
        }
    }

    // ---- the desktop's Weather Alert tray icon (no phone code here: the phone has its status bar icon) ----

    const ICON_ID = 'weatherAlertTrayIcon';
    const ICON_ART = '/static_images/app_icons/melaton-weather-16.png'; // Melaton Weather's own 16 px image
    const BALLOON_ART = '/static_images/app_icons/melaton-weather-32.png';
    const active = new Map(); // alert id -> the alert with its place (the server's weather_alerts_active shape)
    let iconEl = null;
    let shownTitle = '';

    const isSevere = (alert) => alert.severity === 'extreme' || alert.severity === 'severe';

    /** Alerts whose end has passed leave the list when the next event arrives (no timer). */
    function pruneActive(now) {
        active.forEach((a, id) => {
            const end = edgeMs(a, 'end', a.place);
            if (Number.isFinite(end) && end <= now) active.delete(id);
        });
    }

    /** weather_alerts_active's shape ({ alerts: [ { ...alert, place } ] }) replaces the list. */
    function setActive(data) {
        const list = data && Array.isArray(data.alerts) ? data.alerts : null;
        if (!list) return;
        active.clear();
        list.forEach((a) => { if (a && a.id) active.set(a.id, a); });
        paintIcon();
    }

    function ensureIcon() {
        if (iconEl && iconEl.isConnected) return iconEl;
        const existing = document.getElementById(ICON_ID);
        if (existing) { iconEl = existing; return iconEl; }
        const anchor = document.getElementById('activeSyncTrayIcon');
        const box = (anchor && anchor.parentNode) || document.querySelector('#desktopTaskbar .taskbar-tray-icons, .taskbar-tray-icons');
        if (!box) return null;
        // the same structure as app.html's static icons (activeSyncTrayIcon): trayOrder.js lays a late one out
        const el = document.createElement('div');
        el.className = 'taskbar-tray-icon hidden';
        el.id = ICON_ID;
        el.tabIndex = 0;
        const img = document.createElement('img');
        img.src = ICON_ART;
        img.alt = '';
        img.width = 16;
        img.height = 16;
        img.draggable = false;
        el.appendChild(img);
        const signal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
        el.addEventListener('click', openFromIcon, { signal });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openFromIcon(); } }, { signal });
        box.insertBefore(el, anchor ? anchor.nextSibling : null);
        iconEl = el;
        return el;
    }

    /** Hover text: "Weather alerts: Heavy Rain Warning, Wind Advisory". */
    function iconTitle() {
        const names = Array.from(active.values()).map((a) => a.title || 'Weather Alert').filter((t, i, all) => all.indexOf(t) === i);
        const shownNames = names.slice(0, 4).join(', ');
        return `Weather alerts: ${shownNames}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`;
    }

    function paintIcon() {
        if (isPhone()) return;
        pruneActive(Date.now());
        if (!active.size) {
            const el = iconEl || document.getElementById(ICON_ID);
            if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
            return;
        }
        const el = ensureIcon();
        if (!el) return;
        const t = iconTitle();
        if (t !== shownTitle || el.title !== t) { shownTitle = t; el.title = t; }
        if (el.classList.contains('hidden')) {
            // revealTrayIconElement: public/scripts/comp/trayIndicators.js
            if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
        }
    }

    /** A click on the icon: Melaton Weather on the alert (the Alert page lists every active one when there are several). */
    function openFromIcon() {
        pruneActive(Date.now());
        const list = Array.from(active.values());
        if (list.length > 1 && root.wmWeather && typeof root.wmWeather.showAlerts === 'function') { void root.wmWeather.showAlerts(); return; }
        const a = list[0] || lastAlert;
        if (a) void details(a);
    }

    /** The Vista balloon on the icon: name and severity, where, and the window of time. */
    function showBalloon(alert, place) {
        const el = ensureIcon();
        const pm = root.PopoverManager;
        const title = alertTitle(alert);
        const lines = [where(alert, place), windowText(alert, place, Date.now())].filter(Boolean);
        if (!el || !pm || typeof pm.showPopover !== 'function') return false;
        const full = Object.assign({ place: place || null }, alert);
        paintIcon();
        pm.showPopover(el, 'warning', esc(title), lines.map(esc).join('<br>'), false, isSevere(alert) ? 30000 : 15000,
            `<img src="${BALLOON_ART}" alt="" width="32" height="32" draggable="false">`, null,
            { popupId: 'weather-alert', position: 'top', arrowPosition: 'bottom-right', onClick: () => { void details(full); } });
        return true;
    }

    /** Ask for the active list once the desktop is up and the socket is connected; again on each reconnect (pushes missed). */
    let desktopUp = false;
    function askActive() {
        const c = root.wsClient;
        if (isPhone() || !desktopUp || !c || typeof c.sendMessage !== 'function' || (typeof c.isConnected === 'function' && !c.isConnected())) return;
        c.sendMessage('weather_alerts_active', {}, false).then((r) => setActive(r && (r.data || r))).catch(() => {});
    }

    function wireDesktop(c, signal) {
        if (isPhone()) return;
        c.on('weather_alerts_changed', (pk) => setActive(pk && (pk.data || pk)), { signal });
        c.on('connected', askActive, { signal });
        const up = () => { desktopUp = true; askActive(); };
        const boot = root.desktopBoot;
        // after the desktop shows (the taskbar is visible), never before
        if (boot && typeof boot.whenTaskbarVisible === 'function') boot.whenTaskbarVisible('weather-alerts', up); else up();
    }

    function onIssued(packet) {
        const data = packet && (packet.data || packet);
        const alert = data && data.alert;
        if (!alert || !alert.id || shown.has(alert.id)) return;
        shown.add(alert.id);
        const issued = Object.assign({ place: data.place || null, source: data.source || '' }, alert);
        lastAlert = issued;
        document.dispatchEvent(new CustomEvent('weatherAlertIssued', { detail: issued }));
        const text = summary(alert, data.place);
        const severe = isSevere(alert);
        // a WM notification of its own sound class (Settings > Sounds & Notifications: Weather: Alert /
        // Weather: Severe alert), View and Dismiss on the soft keys; it stays until dismissed (#792)
        // the server's copy for when the page is not running has this id (#876): done here, done there
        const inboxId = `wx:${alert.id}`; // one notice per event, whichever places it covers (#1194)
        if (isPhone() && root.wmShell && typeof root.wmShell.appNote === 'function') {
            const note = root.wmShell.appNote({
                title: alertTitle(alert),
                html: [where(alert, data.place), windowText(alert, data.place, Date.now())].filter(Boolean).map(esc).join('<br>') || esc('A weather alert was issued.'),
                icon: 'status-weather-alert',
                event: severe ? 'weather-severe' : 'weather-alert',
                softKeys: () => ({
                    left: { label: 'View', action: () => { if (note) note.close(); inboxDone(inboxId, 'acted'); details(issued); } },
                    right: { label: 'Dismiss', action: () => { if (note) note.close(); inboxDone(inboxId, 'cleared'); } }
                })
            });
            if (note) return;
        }
        if (isPhone() && root.wmShell && typeof root.wmShell.notify === 'function') {
            root.wmShell.notify({
                title: alertTitle(alert),
                text: text || 'A weather alert was issued for your area.',
                icon: severe ? 'error' : 'warning',
                asNote: true,
                timeout: false,
                buttons: [{ text: 'View', type: 'primary', closeOnClick: true, onClick: () => details(issued) }]
            });
            return;
        }
        if (!isPhone()) {
            // the desktop: a tray balloon on the Weather Alert icon, its click opens the alert; never a message box
            const end = edgeMs(alert, 'end', data.place);
            if (Number.isFinite(end) && end <= Date.now()) return; // already over: nothing to tell
            active.set(alert.id, Object.assign({ place: data.place || null }, alert));
            if (showBalloon(alert, data.place)) return;
        }
        if (typeof root.showGlassToast === 'function') {
            // no tray to carry the icon: a plain notification with no button (a button would make it a message box)
            root.showGlassToast('warning', esc(alertTitle(alert)), esc(text), false, false, null, null);
        }
    }

    /**
     * The rain alarm for Home / Work (weather_rain_alarm, once per rain spell): a WM notification in
     * the Weather: Rain alarm sound class on phones, a notification on the desktop (#792).
     */
    function onRain(packet) {
        const d = packet && (packet.data || packet);
        if (!d || !d.place) return;
        const key = `${d.place.id}:${Math.floor(Date.now() / 600000)}`;
        if (shown.has(key)) return;
        shown.add(key);
        const where = d.place.label || d.place.name || 'your place';
        const title = `${d.kind || 'Rain'} at ${where} in ${d.startsInMin} min`;
        const text = d.endsInMin ? `${d.kind || 'Rain'} from about ${d.startsInMin} minutes from now, stopping after about ${Math.max(5, d.endsInMin - d.startsInMin)} minutes.` : (d.summary || `${d.kind || 'Rain'} expected in about ${d.startsInMin} minutes.`);
        document.dispatchEvent(new CustomEvent('weatherRainAlarm', { detail: d }));
        if (isPhone() && root.wmShell && typeof root.wmShell.appNote === 'function') {
            const note = root.wmShell.appNote({
                title,
                html: esc(text),
                icon: 'status-rain-alarm',
                event: 'rain-alarm',
                softKeys: () => ({
                    left: { label: 'Weather', action: () => { if (note) note.close(); inboxDone(`rain:${d.place.id || 'place'}`, 'acted'); if (root.wmWeather) root.wmWeather.open(); } },
                    right: { label: 'Dismiss', action: () => { if (note) note.close(); inboxDone(`rain:${d.place.id || 'place'}`, 'cleared'); } }
                })
            });
            if (note) return;
        }
        if (typeof root.showGlassToast === 'function') {
            root.showGlassToast('info', esc(title), esc(text), false, 15000, null,
                root.wmWeather ? [{ text: 'Open Weather', type: 'primary', closeOnClick: true, onClick: () => root.wmWeather.open() }] : null);
        }
    }

    /**
     * Where the phone is (Yozora #1127): each new device fix goes to the server (weather_here_set), which watches
     * that place for alerts and the rain alarm beside Home and Work. Only on a move of 2 km or a half hour; no timer.
     */
    let sentHere = null;
    function reportHere(fix) {
        const c = root.wsClient;
        if (!fix || fix.source !== 'device' || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !c || typeof c.sendMessage !== 'function') return;
        if (sentHere) {
            const dLat = (fix.lat - sentHere.lat) * 111;
            const dLon = (fix.lon - sentHere.lon) * 111 * Math.cos((fix.lat * Math.PI) / 180);
            if (Math.hypot(dLat, dLon) < 2 && Date.now() - sentHere.at < 30 * 60 * 1000) return;
        }
        sentHere = { lat: fix.lat, lon: fix.lon, at: Date.now() };
        c.sendMessage('weather_here_set', { lat: fix.lat, lon: fix.lon }, false).catch(() => { sentHere = null; });
    }

    function wireHere() {
        if (!isPhone()) return;
        const signal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
        document.addEventListener('wmLocationFix', (e) => reportHere(e && e.detail), { signal });
        const loc = root.wmLocation;
        if (loc && typeof loc.get === 'function') {
            // the cached fix answers at once; a stale one asks the phone once (city precision: no GPS radio)
            Promise.resolve(loc.get({ precision: 'city', maxAgeMs: 6 * 60 * 60 * 1000, deviceOnly: true, purpose: 'Weather alerts' })).then(reportHere).catch(() => {});
        }
    }

    function wire() {
        if (wired) return true;
        const c = root.wsClient;
        if (!c || typeof c.on !== 'function') return false;
        wired = true;
        c.on('weather_alert_issued', onIssued);
        c.on('weather_rain_alarm', onRain);
        wireDesktop(c, (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined);
        wireHere();
        return true;
    }

    if (!wire()) {
        // websocket.js loads before this file in app.html; a page that brings wsClient later wires at its
        // load events (no poll, #890)
        const late = () => { if (!wired) wire(); };
        if (root.addEventListener) {
            const signal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
            root.addEventListener('DOMContentLoaded', late, { once: true, signal });
            root.addEventListener('load', late, { once: true, signal });
        }
    }

    root.weatherAlerts = {
        last: () => lastAlert,
        details,
        active: () => Array.from(active.values()),
        _onIssued: onIssued,
        _onRain: onRain,
        _where: where,
        _windowText: windowText,
        _setActive: setActive
    };
})(typeof window !== 'undefined' ? window : globalThis);
