/**
 * Melaton Mobile Settings > Sounds & Notifications > Chime tab (StaticForge #1108 / #1158): the hour / half-hour chime.
 * The choices live on the server (hour_chime_get / hour_chime_set, modules/hourChime.js) and go to the phone in its status
 * snapshot; the reminder itself is the CaféReady task hour-chime run by the Android app with this page asleep
 * (rule cafeready-background), so nothing here runs at the chime. Added through wmSettings.extendPage.
 *
 *   Chime   Off | Every hour | Every half hour, the hour sound, the half-hour sound (each with Play), and
 *           "Strike the hour" (the hour's sound once per hour on a 12 h dial, so the tones tell the time).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.extendPage !== 'function') return;
    const ui = wmSettings.ui;

    // the app's sound set (public/sounds/wm61): [name, file extension]; the app bundles the same files (assets/chime-sounds)
    const SOUNDS = [
        ['Alarm-01', 'mp3'], ['Alarm-02', 'mp3'], ['Alarm-03', 'mp3'], ['Alarm-04', 'mp3'], ['Alarm-05', 'mp3'],
        ['Alarm-06', 'mp3'], ['Alarm-07', 'mp3'], ['Alarm-08', 'mp3'], ['Alarm-09', 'mp3'], ['Alarm-10', 'mp3'],
        ['Alarm1', 'mp3'], ['Alarm2', 'wav'], ['Alarm3', 'mp3'], ['Alarm4', 'mp3'], ['Alarm5', 'wav'],
        ['Remind-01', 'mp3'], ['Remind-02', 'mp3'], ['Remind-03', 'mp3'], ['Remind-04', 'mp3'], ['Remind-05', 'mp3'],
        ['Ring-Standard', 'mp3'], ['Ring-Vision', 'mp3'], ['Ring-WindowsMobile', 'mp3'],
        ['notify', 'mp3'], ['online', 'mp3'], ['drive', 'mp3'], ['paloma', 'mp3'], ['type', 'mp3'],
        ['Default', 'wav'], ['Infbeg', 'wav'], ['Infend', 'wav'], ['TimerSound', 'wav'], ['SoftwareUpdate', 'wav'],
        ['RecEnd', 'wav'], ['Voicbeep', 'wav'], ['ShutterSound', 'wav'], ['RainAlarm', 'wav'], ['WeatherAlert', 'wav'],
        ['LapisUnlocked', 'wav'], ['TrafficCamera', 'wav']
    ];
    const CHOICES = SOUNDS.map(([n]) => [n, n.replace(/-/g, ' ')]);
    const MODES = [['off', 'Off'], ['hour', 'Every hour'], ['half', 'Every half hour']];
    const ext = (name) => (SOUNDS.find(([n]) => n === name) || [])[1] || 'mp3';
    const label = (list, v) => (list.find(([k]) => k === v) || list[0])[1];

    const client = () => (window.wsClient && typeof window.wsClient.sendMessage === 'function' ? window.wsClient : null);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    let audio = null;
    function play(name) {
        stop();
        if (!name) return;
        audio = new Audio(`/sounds/wm61/${encodeURIComponent(name)}.${ext(name)}`);
        audio.play().catch(() => { /* a refused play just stays silent */ });
    }
    function stop() { if (audio) { audio.pause(); audio = null; } }

    wmSettings.extendPage('sounds', {
        id: 'chime',
        tabs: [['chime-chime', 'Chime']],
        available: () => !!client(),
        init() {
            const d = { chime: null, saved: null, failed: false };
            client().sendMessage('hour_chime_get', {}, false).then((res) => {
                if (res && res.chime) { d.chime = { ...res.chime }; d.saved = { ...res.chime }; } else d.failed = true;
                if (d.rerender) d.rerender();
            }).catch(() => { d.failed = true; if (d.rerender) d.rerender(); });
            return d;
        },
        render(el, tab, d, api) {
            d.rerender = api.rerender;
            const c = d.chime;
            if (!c) { el.innerHTML = ui.note(d.failed ? 'The chime settings could not be read.' : 'Reading the chime settings...'); return; }
            const off = c.mode === 'off';
            const row = (key, text) => `<div class="wm-form-row is-wide"><span class="wm-form-label">${text}</span><div class="wmsp-sound-row">${ui.comboHtml(key, label(CHOICES, c[key]), off)}
                <button type="button" class="wm-button wmsp-play" data-act="play-${key}" aria-label="Play"${off ? ' disabled' : ''}></button></div></div>`;
            el.innerHTML = `<div class="wm-form-row is-wide"><span class="wm-form-label">Chime:</span>${ui.comboHtml('mode', label(MODES, c.mode))}</div>
                ${row('hourSound', 'Hour sound:')}
                ${c.mode === 'half' ? row('halfSound', 'Half hour sound:') : ''}
                ${ui.check('strike', 'Strike the hour (one tone per hour)', c.strike, off ? 'disabled' : '')}
                ${ui.note('The chime sounds on this phone from the Melaton app, even with the screen off and Melaton closed.')}`;
            ui.bindCombo(el.querySelector('[data-act="mode"]'), MODES, c.mode, (v) => { c.mode = v; api.rerender(); });
            for (const k of ['hourSound', 'halfSound']) {
                const cb = el.querySelector(`[data-act="${k}"]`);
                if (cb) ui.bindCombo(cb, CHOICES, c[k], (v) => { c[k] = v; play(v); api.rerender(); });
                const pb = el.querySelector(`[data-act="play-${k}"]`);
                if (pb) pb.addEventListener('click', () => play(c[k]));
            }
            el.querySelector('input[name="strike"]').addEventListener('change', (e) => { c.strike = e.target.checked; });
        },
        async commit(d) {
            stop();
            if (!d.chime || same(d.chime, d.saved)) return [];
            try {
                const res = await client().sendMessage('hour_chime_set', { chime: d.chime });
                if (res && res.chime) d.saved = { ...res.chime };
            } catch (err) {
                await ui.messageBox({ title: 'Sounds & Notifications', icon: 'error', text: (err && err.message) || 'The chime could not be saved.' });
                return false;
            }
            return [];
        }
    });
})();
