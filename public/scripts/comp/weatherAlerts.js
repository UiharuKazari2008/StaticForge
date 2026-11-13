/**
 * Weather alerts for the primary location (Yozora #780). The server's weather service watches the
 * configured home location and broadcasts each new alert once to every signed-in client
 * (weather_alert_issued: { alert, place, source }; modules/weatherService.js pollAlerts).
 *
 *   Desktop  a warning notification with the alert, where and until when; Details opens its full
 *            text (Apple Weather's own text is fetched with weather_alert).
 *   Phone    a WM notification; View opens Melaton Mobile's Weather on the alert
 *            (wmWeather.showAlert). Errors-style notes stay until dismissed.
 *
 * window.weatherAlerts: last() -> the last alert received, details(alert) opens its text.
 */
(function (root) {
    'use strict';

    const SEVERITY_WORD = { extreme: 'Extreme', severe: 'Severe', moderate: 'Moderate', minor: 'Minor' };
    const shown = new Set();
    let lastAlert = null;
    let wired = false;

    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isPhone = () => root.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');

    /** 'YYYY-MM-DDTHH:MM' (the place's wall clock) -> "Fri 11:00 AM". */
    function when(iso) {
        if (!iso || iso.length < 16) return '';
        const d = new Date(`${iso}:00Z`);
        if (Number.isNaN(d.getTime())) return '';
        const day = d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
        const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
        return `${day} ${time}`;
    }

    function summary(alert, place) {
        const bits = [];
        const where = (place && place.name) || alert.area || '';
        if (where) bits.push(where);
        const until = when(alert.ends || alert.expires);
        if (until) bits.push(`until ${until}`);
        return bits.join(', ');
    }

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
        if (isPhone() && root.wmWeather && typeof root.wmWeather.showAlert === 'function') {
            root.wmWeather.showAlert(alert);
            return;
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

    function onIssued(packet) {
        const data = packet && (packet.data || packet);
        const alert = data && data.alert;
        if (!alert || !alert.id || shown.has(alert.id)) return;
        shown.add(alert.id);
        lastAlert = Object.assign({ place: data.place || null, source: data.source || '' }, alert);
        document.dispatchEvent(new CustomEvent('weatherAlertIssued', { detail: lastAlert }));
        const text = summary(alert, data.place);
        if (isPhone() && root.wmShell && typeof root.wmShell.notify === 'function') {
            root.wmShell.notify({
                title: alert.title || 'Weather Alert',
                text: text || 'A weather alert was issued for your area.',
                icon: alert.severity === 'extreme' || alert.severity === 'severe' ? 'error' : 'warning',
                asNote: true,
                timeout: false,
                buttons: [{ text: 'View', type: 'primary', closeOnClick: true, onClick: () => details(lastAlert) }]
            });
            return;
        }
        if (typeof root.showGlassToast === 'function') {
            root.showGlassToast('warning', esc(`Weather Alert: ${alert.title || 'Alert'}`), esc(text), false, false, null,
                [{ text: 'Details', type: 'primary', closeOnClick: true, onClick: () => details(lastAlert) }]);
        }
    }

    function wire() {
        if (wired) return true;
        const c = root.wsClient;
        if (!c || typeof c.on !== 'function') return false;
        wired = true;
        c.on('weather_alert_issued', onIssued);
        return true;
    }

    if (!wire()) {
        let tries = 0;
        const timer = setInterval(() => { if (wire() || ++tries > 240) clearInterval(timer); }, 500);
    }

    root.weatherAlerts = { last: () => lastAlert, details, _onIssued: onIssued };
})(typeof window !== 'undefined' ? window : globalThis);
