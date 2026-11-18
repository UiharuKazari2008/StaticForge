/**
 * Melaton Mobile Settings: Personal pages (Buttons, Sounds & Notifications, Input, Lock, Owner Information, Screen accessibility) (Yozora #709).
 * Pages for the Settings app (wmPrograms.js), added through window.wmSettings.registerPage /
 * extendPage and drawn with window.wmSettings.ui so they look like WM 6.1's own pages. Every
 * value is read and saved through the desktop's own store (one source of truth):
 *
 *   Sounds & Notifications  desktopPersonalization (soundScheme, sounds, startupSound; the Sound
 *                           dialog's Sounds tab), desktopSounds.playFile (Test), Dovecote's mail
 *                           options (window.dovecoteMailSettings, kept per browser by Dovecote)
 *                           and the Android Notification Bridge (persistUserGlobalSettingsPatch,
 *                           as taskbarProperties.js saves it). Customize Notifications' hidden
 *                           popups and minimum time are left out: trayRegistry.js keeps them per
 *                           browser and the phone shows no tray popups.
 *   Input                   the Keyboard page's virtual keyboard (setDesktopVirtualKeyboardEnabled,
 *                           this browser's desktop mode only: localStorage) and SmartText + the spell checker (autofillSettings.js,
 *                           saveAutofillSearchSettingsToServer: one server write on ok)
 *   Lock                    the workspace's screen saver { id, wait, resumeLogon }
 *                           (desktopPersonalization.update) and the account PIN state (read only)
 *   Owner Information       + Picture: the account picture (wsClient.setAccountPicture, as User
 *                           Accounts; meletonAccounts follows)
 *   Screen                  + Accessibility: Ease of Access Center's registry key
 *                           (melatonRegistry, melatonAccessibility.apply)
 *   (Workspace was removed, #831: workspaces are managed at Settings > System > Workspaces)
 *
 *   Buttons                 the Today screen's soft keys (a phone browser has no program buttons
 *                           of its own; Back is the shell's), per device: wmShell.todaySoftKeys
 *
 * Sounds & Notifications also keeps this device's own sound options (wmShell.sounds: screen taps,
 * hardware buttons, and each phone event's WM sound, repeat, display and vibrate; localStorage)
 * and, on a Vibration tab the device does not have, its vibration (wmShell.vibration: on, the
 * intensity, calls, errors and warnings; localStorage wmVibration).
 * WM 6.1's Phone item has no Dreamscape analogue and is left out (calls, ring tones, network and
 * SIM services).
 *
 * Styles: public/css/wm-settings-personal.css. Runs only on Melaton Mobile (uiShell 'mobile').
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.registerPage !== 'function') return;
    const ui = wmSettings.ui;
    const esc = ui.esc;

    // Monolith helpers are classic-script globals (not window properties): reached by name with typeof.
    /* global desktopSettingsGlobalState,
       persistUserGlobalSettingsPatch, readDesktopSettingsVirtualKeyboardPreference, setDesktopVirtualKeyboardEnabled,
       getAutofillSearchSettings, saveAutofillSearchSettingsToServer, AUTOFILL_DELAY_PRESETS,
       AUTOFILL_MAX_RESULTS_PRESETS, workspaces, activeWorkspace, localGalleryImageUrl, localCacheUploadUrl,
       localCachePreviewUrl */
    // function declarations of classic scripts are window properties
    const fn = (name) => (typeof window[name] === 'function' ? window[name] : null);
    const call = (name, ...args) => { const f = fn(name); return f ? f(...args) : undefined; };
    const P = () => window.desktopPersonalization || null;
    const S = () => window.desktopSounds || null;
    const ws = () => window.wsClient || null;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const box = (opts) => ui.messageBox(opts);

    /** A check box row with an indent (WM's dependent options sit 19 px in). */
    const checkIn = (name, label, checked, attrs = '') => `<div class="wmsp-indent">${ui.check(name, label, checked, attrs)}</div>`;

    // ======================================================================== Sounds & Notifications

    // the Sound dialog's events (personalizationDialogs.js EVENT_GROUPS, a lazy Control Panel file:
    // its list wins when it is loaded; this copy is the same names for the phone)
    const EVENT_GROUPS = [
        { name: 'Melaton', events: [
            ['critical-stop', 'Critical Stop'], ['dialog', 'Default Beep'], ['warning', 'Exclamation'],
            ['shutdown', 'Exit Melaton'], ['notify', 'New Mail Notification'], ['balloon', 'Notification'],
            ['print-complete', 'Print Complete'], ['error', 'Program Error'], ['unlock', 'Unlock Computer'],
            ['lock', 'Melaton Logoff'], ['logon', 'Melaton Logon'], ['uac', 'Melaton User Account Control']
        ] },
        { name: 'Melaton Explorer', events: [['recycle', 'Empty Recycle Bin'], ['navigate', 'Start Navigation']] },
        { name: 'Dreamscape', events: [
            ['planet-enter', 'Open Planet Switcher'], ['planet-activate', 'Planet Selected'],
            ['planet-switch', 'Planet Switched'], ['print-error', 'Print Failed']
        ] }
    ];
    const eventGroups = () => {
        const pd = window.personalizationDialogs;
        return pd && Array.isArray(pd.EVENT_GROUPS) && pd.EVENT_GROUPS.length ? pd.EVENT_GROUPS : EVENT_GROUPS;
    };

    // WM's "Enable sounds for" groups, over the same per-event sounds. Notifications sits under
    // Programs as its child (WM 6.1), so the Programs group covers the notification events too:
    // Programs off silences both, and Notifications shows unticked until Programs is on again.
    // A group off gives each of its events (None) and remembers what each had; on again puts those
    // back exactly (a chosen file, a scheme sound or an event's own (None)). A group that comes
    // back with no sound at all takes the scheme's sounds instead.
    const NOTIFY_EVENTS = ['notify', 'balloon', 'print-complete'];
    const groupEvents = (group) => {
        const groups = eventGroups();
        if (group === 'notifications') return NOTIFY_EVENTS.slice();
        if (group === 'programs') return groups.filter((g) => g.name !== 'Melaton').flatMap((g) => g.events.map(([id]) => id)).concat(NOTIFY_EVENTS);
        const sys = groups.find((g) => g.name === 'Melaton');
        return (sys ? sys.events.map(([id]) => id) : []).filter((id) => !NOTIFY_EVENTS.includes(id));
    };

    const soundName = (file) => String(file || '').replace(/\.wav$/i, '').replace(/^Windows /, 'Melaton ');

    function eventFile(d, id) {
        if (Object.prototype.hasOwnProperty.call(d.sounds, id)) return d.sounds[id];
        const s = S();
        return s && s.SCHEME && s.SCHEME[id] ? s.SCHEME[id] : '';
    }

    function soundsModified(d) {
        const s = S();
        return Object.keys(d.sounds).some((k) => !s || d.sounds[k] !== s.SCHEME[k]);
    }

    const groupOn = (d, group) => d.scheme !== 'none' && groupEvents(group).some((id) => eventFile(d, id) !== '');

    const UNSET = {};
    function setGroup(d, group, on) {
        const ids = groupEvents(group);
        const has = (id) => Object.prototype.hasOwnProperty.call(d.sounds, id);
        if (!on) {
            for (const id of ids) {
                // the first group to silence an event keeps its sound (Programs off, then Notifications)
                if (!d.stash.has(id)) d.stash.set(id, has(id) ? d.sounds[id] : UNSET);
                d.sounds[id] = '';
            }
            return;
        }
        for (const id of ids) {
            if (!d.stash.has(id)) continue;
            const was = d.stash.get(id);
            d.stash.delete(id);
            if (was === UNSET) delete d.sounds[id]; else d.sounds[id] = was;
        }
        if (!ids.some((id) => eventFile(d, id) !== '')) ids.forEach((id) => { if (d.sounds[id] === '') delete d.sounds[id]; });
    }

    // the phone's own sound events and options (wmShell.js SND_EVENTS, kept per device)
    const SND = () => {
        const s = window.wmShell && window.wmShell.sounds;
        return s && typeof s.events === 'function' && typeof s.setPrefs === 'function' ? s : null;
    };
    const clone = (o) => JSON.parse(JSON.stringify(o));
    // the phone's vibration (wmShell.js vibrate, kept per device)
    const VIB = () => {
        const sh = window.wmShell;
        return sh && typeof sh.vibrate === 'function' && sh.vibration && typeof sh.vibration.setPrefs === 'function' ? sh : null;
    };

    function eventList(d) {
        const rows = [];
        // WM 6.1's list: the phone's notification classes and system sounds (this device's options)
        for (const ev of d.phoneEvents) rows.push({ key: `p:${ev.id}`, label: ev.label });
        // then the workspace's events, shared with the desktop (the Sound dialog's list)
        for (const g of eventGroups()) for (const [id, label] of g.events) rows.push({ key: `s:${id}`, label: `${g.name}: ${label}` });
        return rows;
    }

    function readSounds() {
        const p = P().get();
        // the workspace's own scheme: desktopSounds' browser-wide switch is this browser's desktop
        // mode only (a phone may hold 'off' from an earlier desktop session) and must not read as,
        // or be saved as, No Sounds for the workspace
        const mailApi = window.dovecoteMailSettings;
        const snd = SND();
        const d = {
            scheme: p.soundScheme === 'none' ? 'none' : 'default',
            sounds: { ...p.sounds },
            startupSound: p.startupSound !== false,
            mail: mailApi && typeof mailApi.soundOn === 'function' ? { sound: !!mailApi.soundOn(), notify: !!mailApi.notifyOn() } : null,
            // the phone shows every toast as a WM notification and never routes to the Android
            // Notification Bridge (toastManager.js), so its switches are not offered here (#723)
            bridge: null,
            dev: snd ? clone(snd.prefs()) : null,
            phoneEvents: snd ? snd.events() : [],
            wmFiles: snd ? snd.files() : [],
            vib: VIB() ? clone(VIB().vibration.prefs()) : null,
            vibCaps: VIB() ? VIB().vibration.caps() : null,
            sel: '',
            stash: new Map()
        };
        d.sel = eventList(d)[0] ? eventList(d)[0].key : '';
        d.saved = clone({ scheme: d.scheme, sounds: d.sounds, startupSound: d.startupSound, mail: d.mail, bridge: d.bridge, dev: d.dev, vib: d.vib });
        return d;
    }

    // Screen taps / Hardware buttons: Classic = the device's own clicks (waveapi's TouchSoft /
    // TouchLoud / KeySoft / KeyLoud), Modern = the one click Melaton played before (hwandsw.wav,
    // Soft by gain). Not a WM option: kept in this device's sound options (wmSounds.clicks).
    const CLICK_SETS = [['classic', 'Classic'], ['modern', 'Modern']];

    function renderSoundsTab(el, d, api) {
        const none = d.scheme === 'none';
        const modified = !none && soundsModified(d);
        const schemes = [['default', 'Melaton Default'], ['none', 'No Sounds']];
        if (modified) schemes.splice(1, 0, ['modified', 'Melaton Default (modified)']);
        const cur = none ? 'none' : (modified ? 'modified' : 'default');
        const programs = groupOn(d, 'programs');
        // WM 6.1: Screen taps and Hardware buttons, each Soft or Loud (this device's own)
        const clicks = (name, label, on, loud) => `${ui.check(name, label, on)}
            <div class="wmsp-radios">${ui.radio(`${name}-vol`, 'soft', 'Soft', !loud, on ? '' : 'disabled')}${ui.radio(`${name}-vol`, 'loud', 'Loud', loud, on ? '' : 'disabled')}</div>`;
        el.innerHTML = `${ui.sub('Enable sounds for')}
            ${ui.check('grp-system', 'Events (warnings, system events)', groupOn(d, 'system'), `data-grp="system"${none ? ' disabled' : ''}`)}
            ${ui.check('grp-programs', 'Programs', programs, `data-grp="programs"${none ? ' disabled' : ''}`)}
            ${checkIn('grp-notifications', 'Notifications (mail, prints, balloons)', programs && groupOn(d, 'notifications'), `data-grp="notifications"${none || !programs ? ' disabled' : ''}`)}
            ${d.dev ? clicks('taps', 'Screen taps', d.dev.taps, d.dev.tapsLoud) + clicks('buttons', 'Hardware buttons', d.dev.buttons, d.dev.buttonsLoud)
                + ui.row('Click sounds:', ui.comboHtml('clickset', (CLICK_SETS.find(([v]) => v === d.dev.clicks) || CLICK_SETS[0])[1], !d.dev.taps && !d.dev.buttons), { wide: true }) : ''}
            ${ui.gap()}
            ${ui.row('Sound scheme:', ui.comboHtml('scheme', (schemes.find(([v]) => v === cur) || schemes[0])[1]), { wide: true })}
            ${ui.check('startup', 'Play Melaton Startup sound', d.startupSound, none ? 'disabled' : '')}
            ${ui.gap()}
            ${ui.note('The sound scheme of this workspace, shared with the desktop. Each event\'s sound is on the Notifications tab.')}`;
        el.querySelectorAll('input[data-grp]').forEach((c) => c.addEventListener('change', () => {
            setGroup(d, c.dataset.grp, c.checked);
            api.rerender();
        }));
        if (d.dev) {
            for (const k of ['taps', 'buttons']) {
                el.querySelector(`input[name="${k}"]`).addEventListener('change', (e) => { d.dev[k] = e.target.checked; api.rerender(); });
                el.querySelectorAll(`input[name="${k}-vol"]`).forEach((r) => r.addEventListener('change', () => { if (r.checked) d.dev[`${k}Loud`] = r.value === 'loud'; }));
            }
        }
        if (d.dev) ui.bindCombo(el.querySelector('[data-act="clickset"]'), CLICK_SETS, d.dev.clicks, (v) => { d.dev.clicks = v; api.rerender(); });
        ui.bindCombo(el.querySelector('[data-act="scheme"]'), schemes, cur, (v) => {
            if (v === 'modified') return;
            // as the Sound dialog: picking the scheme starts from its own sounds
            if (v === 'none') d.scheme = 'none';
            else { d.scheme = 'default'; d.sounds = {}; }
            api.rerender();
        });
        el.querySelector('input[name="startup"]').addEventListener('change', (e) => { d.startupSound = e.target.checked; });
    }

    /** A phone event's options in the draft: { on, file (shown in the Sound combo), repeat, display, vibrate, off (the workspace silences it) }. */
    function phoneEvent(d, ev) {
        const o = d.dev.ev[ev.id] || {};
        const own = typeof o.sound === 'string' && o.sound !== '';
        let on = typeof o.sound === 'string' ? o.sound !== '' : ev.play !== false;
        let display = typeof o.display === 'boolean' ? o.display : ev.display !== false;
        if (ev.dovecote && d.mail) { on = d.mail.sound; display = d.mail.notify; }
        // the file: the device's pick; else a desktop sound picked for the event in this workspace; else WM's
        const s = S();
        const ws = Object.prototype.hasOwnProperty.call(d.sounds, ev.desktop) ? d.sounds[ev.desktop] : null;
        const wsPick = ws && s && s.SCHEME && ws !== s.SCHEME[ev.desktop] && (s.FILES || []).includes(ws) ? ws : null;
        const file = own ? o.sound : (o.last || wsPick || ev.sound);
        const off = d.scheme === 'none' || eventFile(d, ev.desktop) === '' || (ev.id === 'startup' && !d.startupSound);
        return {
            on, file, off, display,
            repeat: !!ev.repeatable && (typeof o.repeat === 'boolean' ? o.repeat : !!ev.repeat),
            vibrate: o.vibrate === true
        };
    }

    function renderPhoneEvent(el, d, ev, api) {
        const st = phoneEvent(d, ev);
        const snd = SND();
        const s = S();
        const files = d.wmFiles.map((f) => [f.file, f.label]).concat(((s && s.FILES) || []).map((f) => [f, soundName(f)]));
        const shown = files.find(([f]) => f === st.file) || [st.file, st.file];
        const playOn = st.on && !st.off;
        const note = ev.kind === 'note';
        el.innerHTML = `<div class="wmsp-ev">
                <div class="wmsp-ev-left">
                    ${ui.check('play-on', 'Play sound', playOn, st.off ? 'disabled' : '')}
                    ${note ? checkIn('repeat', 'Repeat', ev.repeatable && playOn && st.repeat, ev.repeatable && playOn ? '' : 'disabled') : ''}
                </div>
                <div class="wmsp-ev-right">
                    ${ui.comboHtml('file', shown[1], !playOn)}
                    <div class="wmsp-media">
                        <button type="button" class="wm-button wmsp-play" data-act="play" aria-label="Play"${st.file ? '' : ' disabled'}></button>
                        <button type="button" class="wm-button wmsp-stop" data-act="stop" aria-label="Stop"></button>
                    </div>
                </div>
            </div>
            ${note ? ui.check('msg-on', 'Display message on screen', st.display) + ui.check('vibrate', 'Vibrate', st.vibrate) : ''}
            ${st.off ? ui.note(d.scheme === 'none' ? 'Sounds are off: pick Melaton Default on the Sounds tab.' : 'This sound is off on the Sounds tab.') : ''}`;
        const o = () => { d.dev.ev[ev.id] = d.dev.ev[ev.id] || {}; return d.dev.ev[ev.id]; };
        el.querySelector('input[name="play-on"]').addEventListener('change', (e) => {
            const on = e.target.checked;
            if (ev.dovecote && d.mail) {
                d.mail.sound = on;
                // the mail sound needs the New Mail event to have one
                if (on && eventFile(d, 'notify') === '') delete d.sounds.notify;
            } else if (on) {
                const x = o();
                if (x.last && x.last !== ev.sound) x.sound = x.last;
                else if (ev.play === false) x.sound = ev.sound;
                else delete x.sound;
            } else {
                const x = o();
                if (typeof x.sound === 'string' && x.sound) x.last = x.sound;
                x.sound = '';
            }
            api.rerender();
        });
        ui.bindCombo(el.querySelector('[data-act="file"]'), files, st.file, (file) => {
            const x = o();
            x.sound = file;
            delete x.last;
            // WM plays the new choice
            if (snd) snd.preview(file);
            api.rerender();
        });
        el.querySelector('[data-act="play"]').addEventListener('click', () => { if (snd && st.file) snd.preview(st.file); });
        el.querySelector('[data-act="stop"]').addEventListener('click', () => { if (snd) snd.stop(); });
        const rep = el.querySelector('input[name="repeat"]');
        if (rep) rep.addEventListener('change', () => { o().repeat = rep.checked; });
        const msg = el.querySelector('input[name="msg-on"]');
        if (msg) msg.addEventListener('change', () => { if (ev.dovecote && d.mail) d.mail.notify = msg.checked; else o().display = msg.checked; });
        const vib = el.querySelector('input[name="vibrate"]');
        if (vib) vib.addEventListener('change', () => { o().vibrate = vib.checked; });
    }

    function renderNotifyTab(el, d, api) {
        const rows = eventList(d);
        if (!rows.some((r) => r.key === d.sel) && rows[0]) d.sel = rows[0].key;
        const sel = rows.find((r) => r.key === d.sel) || { key: '', label: '' };
        const s = S();
        const files = [['', '(None)']].concat(((s && s.FILES) || []).map((f) => [f, soundName(f)]));
        const none = d.scheme === 'none';
        // Customize Notifications' hidden popups and minimum time are not here: the desktop keeps them
        // per browser (trayRegistry.js, localStorage) and the phone never shows those tray popups, so
        // a change here would reach neither the phone nor another computer
        el.innerHTML = `${ui.row('Event:', ui.comboHtml('event', sel.label))}
            <div class="wmsp-event"></div>`;
        ui.bindCombo(el.querySelector('[data-act="event"]'), rows.map((r) => [r.key, r.label]), d.sel, (v) => {
            if (SND()) SND().stop();
            d.sel = v;
            api.rerender();
        });
        const body = el.querySelector('.wmsp-event');
        if (sel.key.startsWith('p:')) {
            const ev = d.phoneEvents.find((e) => e.id === sel.key.slice(2));
            if (ev) renderPhoneEvent(body, d, ev, api);
            return;
        }
        if (!sel.key.startsWith('s:')) return;
        // a workspace event: its desktop sound, shared with the desktop's Sound dialog
        const evId = sel.key.slice(2);
        const on = !none && eventFile(d, evId) !== '';
        const file = on ? eventFile(d, evId) : '';
        const shown = files.find(([f]) => f === file) || files[0];
        body.innerHTML = `${ui.check('play-on', 'Play sound', on, none ? 'disabled' : '')}
            <div class="wmsp-indent wmsp-sound-row">${ui.comboHtml('file', shown[1], none || !on)}
                <button type="button" class="wm-button wmsp-play" data-act="play" aria-label="Play"${none || !file ? ' disabled' : ''}></button></div>
            ${none ? ui.note('Sounds are off: pick Melaton Default on the Sounds tab.') : ui.note('A sound of this workspace, shared with the desktop.')}`;
        body.querySelector('input[name="play-on"]').addEventListener('change', (e) => {
            if (e.target.checked) {
                if (d.sounds[evId] === '') delete d.sounds[evId];
                if (eventFile(d, evId) === '') d.sounds[evId] = 'Windows Default.wav';
            } else {
                d.sounds[evId] = '';
            }
            api.rerender();
        });
        ui.bindCombo(body.querySelector('[data-act="file"]'), files, file, (f) => {
            const sch = s && s.SCHEME;
            if (sch && sch[evId] === f) delete d.sounds[evId];
            else d.sounds[evId] = f;
            // the Sound dialog plays the new choice
            if (f && SND()) SND().preview(f);
            api.rerender();
        });
        body.querySelector('[data-act="play"]').addEventListener('click', () => { const f = eventFile(d, evId); if (f && SND()) SND().preview(f); });
    }

    /**
     * Vibration: not a WM 6.1 / 6.5 tab (the device has only each notification's Vibrate box and
     * the volume bubble's Vibrate), built from the Sounds tab's parts: a switch, the intensity as
     * Screen's trackbar (five steps, amplitude 51 to 255 in the Android app; one strength in a
     * browser or on a motor without amplitude control), Test (a notification's buzz at the level
     * shown, whatever the volume bubble says) and what vibrates while the sound is on that has no
     * box on the Notifications tab.
     */
    function renderVibrationTab(el, d, api) {
        const v = d.vib;
        const caps = d.vibCaps || { vibrator: false, amplitudeControl: false };
        const none = !caps.vibrator;
        const off = none || !v.on;
        const levels = Array.from({ length: VIB().vibration.levels }, (_, i) => i + 1);
        el.innerHTML = `${ui.check('vib-on', 'Turn on vibration', v.on && !none, none ? 'disabled' : '')}
            <div class="wmsp-indent">
                ${ui.sub('Intensity')}
                <div data-f="vib-level"></div>
                ${ui.buttons([['vib-test', 'Test', off]], false)}
            </div>
            ${none ? ui.note('This device cannot vibrate.') : (caps.amplitudeControl ? '' : ui.note('This device vibrates at one strength.'))}
            ${ui.gap()}
            ${ui.sub('With the sound on, vibrate for')}
            ${ui.check('vib-calls', 'Incoming calls', v.calls, off ? 'disabled' : '')}
            ${ui.check('vib-alerts', 'Errors and warnings', v.alerts, off ? 'disabled' : '')}
            ${ui.note('Each notification has its own Vibrate box on the Notifications tab.')}`;
        ui.trackbar(el.querySelector('[data-f="vib-level"]'), {
            steps: levels, value: v.level, lo: 'Low', hi: 'High', label: 'Vibration intensity',
            disabled: off || !caps.amplitudeControl,
            onChange: (n) => { v.level = n; }
        });
        el.querySelector('input[name="vib-on"]').addEventListener('change', (e) => { v.on = e.target.checked; api.rerender(); });
        el.querySelector('input[name="vib-calls"]').addEventListener('change', (e) => { v.calls = e.target.checked; });
        el.querySelector('input[name="vib-alerts"]').addEventListener('change', (e) => { v.alerts = e.target.checked; });
        el.querySelector('[data-act="vib-test"]').addEventListener('click', () => { if (VIB()) VIB().vibrate('notification', { level: v.level, force: true }); });
    }

    /**
     * Volume (Yukimi, Nov 16): the phone's own levels in 10 steps, each on WM's trackbar - Media,
     * Assistant, Ringer, Alarms, Notifications, System (window.AndroidVolume; a level the phone does not
     * have is left out). A change is made at once (no OK needed) and beeps at the new level on its own
     * output, as WM's volume box does; the ringer at 0 is Off.
     */
    const VOL_ROWS = [['media', 'Media'], ['assistant', 'Assistant'], ['ring', 'Ringer'], ['alarm', 'Alarms'], ['notification', 'Notifications'], ['system', 'System']];
    function renderVolumeTab(el) {
        const av = window.AndroidVolume;
        let st = null;
        try { st = av && typeof av.get === 'function' ? JSON.parse(av.get()) : null; } catch (_) { st = null; }
        if (!st) { el.innerHTML = ui.note('The volume levels are the phone\'s: open Melaton Mobile on the phone to set them here.'); return; }
        const rows = VOL_ROWS.filter(([k]) => Number.isFinite(st[k]));
        el.innerHTML = rows.map(([k, label]) => `${ui.sub(label)}<div data-f="vol-${k}"></div>`).join('');
        const steps = Array.from({ length: 11 }, (_, i) => i);
        rows.forEach(([k, label]) => {
            ui.trackbar(el.querySelector(`[data-f="vol-${k}"]`), {
                steps, value: st[k], lo: 'Silent', hi: 'Loud', label: `${label} volume`,
                onChange: (n) => { try { av.set(k, n); if (typeof av.beep === 'function') av.beep(k); } catch (_) { /* older app */ } }
            });
        });
    }

    async function commitSounds(d) {
        const v = d.saved;
        if (SND()) SND().stop();
        // only what changed (the scheme only when one was picked): the Sound dialog's own fields
        const patch = {};
        if (d.scheme !== v.scheme) patch.soundScheme = d.scheme;
        if (!same(d.sounds, v.sounds)) patch.sounds = { ...d.sounds };
        if (d.startupSound !== v.startupSound) patch.startupSound = d.startupSound;
        if (Object.keys(patch).length) P().update(patch);
        const mailApi = window.dovecoteMailSettings;
        if (d.mail && mailApi) {
            if (d.mail.sound !== v.mail.sound) mailApi.setSound(d.mail.sound);
            if (d.mail.notify !== v.mail.notify) mailApi.setNotify(d.mail.notify);
        }
        // this device's own: taps, buttons and each phone event
        const keys = [];
        if (d.dev && SND() && !same(d.dev, v.dev)) { SND().setPrefs(d.dev); keys.push('wmSounds'); }
        if (d.vib && VIB() && !same(d.vib, v.vib)) { VIB().vibration.setPrefs(d.vib); keys.push(VIB().vibration.key); }
        return keys;
    }

    wmSettings.registerPage({
        id: 'sounds', tab: 'personal', label: 'Sounds & Notifications', icon: 'set-sounds',
        tabs: [['volume', 'Volume'], ['sounds', 'Sounds'], ['notifications', 'Notifications'], ['vibration', 'Vibration']],
        available: () => !!(P() && typeof P().get === 'function' && typeof P().update === 'function'),
        init: readSounds,
        render(el, tab, d, api) {
            if (tab === 'volume') renderVolumeTab(el);
            else if (tab === 'vibration') { if (d.vib) renderVibrationTab(el, d, api); else el.innerHTML = ui.note('This device cannot vibrate.'); }
            else if (tab === 'notifications') renderNotifyTab(el, d, api);
            else renderSoundsTab(el, d, api);
        },
        commit: commitSounds
    });

    // ======================================================================== Location (#907)

    // Home and Work for every program (Traffic's commute, Weather's places, the Today items), set once here
    // through the common lookup (wmLocation.pick), and which programs asked for the phone's position lately
    const LOC = () => window.wmLocation || null;
    const WHO = { traffic: 'Traffic', weather: 'Weather', 'dynamic-generation': 'Dynamic Generation', desktop: 'Desktop Background', settings: 'Settings' };
    wmSettings.registerPage({
        id: 'location', tab: 'personal', label: 'Location', icon: 'set-location',
        tabs: [['places', 'Places'], ['drive', 'Drive'], ['use', 'Use']],
        available: () => !!LOC(),
        init() { return { placesTick: 0 }; },
        render(el, tab, d, api) {
            const L = LOC();
            if (!d.wired) {
                d.wired = true;
                const again = () => { if (el.isConnected) api.rerender(); else document.removeEventListener('wmLocationPlaces', again); };
                document.addEventListener('wmLocationPlaces', again);
                void L.placesReady();
            }
            if (tab === 'drive') { renderDrive(el, d, api); return; }
            if (tab === 'use') {
                const rows = L.recent();
                const last = L.last();
                el.innerHTML = `${ui.sub('Programs that asked for this phone\'s location')}
                    ${rows.length ? `<div class="wm-facts">${rows.slice(0, 12).map((r) => `<span>${esc(WHO[r.purpose] || r.purpose)}</span><span>${esc(`${L.SPEC_LABEL[r.precision] || r.precision}, ${{ cache: 'from the last fix', shared: 'shared fix', kept: 'last fix (out of sight)', device: 'the phone', ip: 'the network', home: 'Home', watch: 'following', none: 'not found' }[r.served] || r.served} ${new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)}</span>`).join('')}</div>` : ui.text('No program has asked since Melaton started.')}
                    ${ui.gap()}
                    ${ui.value('Last fix:', last ? `${new Date(last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, about ${last.accuracyM >= 1000 ? `${Math.round(last.accuracyM / 1000)} km` : `${Math.round(last.accuracyM)} m`} (${last.source === 'device' ? 'the phone' : last.source === 'ip' ? 'the network' : 'Home'})` : 'None yet')}
                    ${ui.note('Programs share one position: a program that needs less detail is answered from a recent one instead of asking the phone again.')}`;
                return;
            }
            const p = L.places();
            const row = (id, label) => {
                const v = p[id];
                const text = v ? `${v.label}${v.from === 'legacy' ? ' (from an older setting)' : ''}` : 'Not set';
                return `<div class="wm-form-row is-wide wsl-place"><span class="wm-form-label">${esc(label)}:</span><span class="wm-form-value">${esc(text)}</span></div>
                    ${ui.buttons([[`set:${id}`, 'Change...'], ...(v && !v.from ? [[`clear:${id}`, 'Clear']] : [])])}`;
            };
            el.innerHTML = `${ui.text('Home and Work are used by every program: Traffic\'s commute, Weather and the Today items.')}
                ${row('home', 'Home')}${ui.gap()}${row('work', 'Work')}`;
            el.querySelectorAll('[data-act^="set:"]').forEach((b) => b.addEventListener('click', async () => {
                const id = b.dataset.act.slice(4);
                const cur = L.places()[id];
                const place = await L.pick({ title: id === 'home' ? 'Home' : 'Work', prompt: `Enter your ${id === 'home' ? 'home' : 'work'} address, or a place near it.`, min: 'approximate', max: 'exact', value: cur ? (cur.typed || cur.address || cur.label) : '' });
                if (!place) return;
                try { await L.savePlaces({ [id]: place }); } catch (err) { await box({ title: 'Location', icon: 'error', text: `${id === 'home' ? 'Home' : 'Work'} could not be saved. ${(err && err.message) || ''}`.trim() }); }
                if (el.isConnected) api.rerender();
            }));
            el.querySelectorAll('[data-act^="clear:"]').forEach((b) => b.addEventListener('click', async () => {
                try { await L.savePlaces({ [b.dataset.act.slice(6)]: null }); } catch (_) { /* stays */ }
                if (el.isConnected) api.rerender();
            }));
        },
        commit() { return []; }
    });

    // ---- Location > Drive (#890 drive state, DSApp AndroidHome.getDriveState): how the phone knows it is driving
    // (Activity Recognition, the car's Bluetooth, the car key), which Bluetooth devices are cars. Traffic's camera
    // and police watch and the location service's urgent positions run only while it says driving.
    const driveBridge = () => (window.AndroidHome && typeof window.AndroidHome.getDriveState === 'function' ? window.AndroidHome : null);
    const DRIVE_STATE = { idle: 'Not driving', maybe: 'Maybe driving', driving: 'Driving', parked_in_car: 'Parked, in the car', stopped: 'Stopped' };
    const DRIVE_SOURCE = { activity: 'motion', car_bt: 'the car\'s Bluetooth', carkey: 'the car key', geofence: 'leaving Home or Work', movement: 'moving' };
    const DRIVE_ACCESS = { on: 'On', ask: 'Not allowed yet', denied: 'Refused (allow it in Android Settings)', unavailable: 'Not on this phone' };
    function driveJson(fn) { const H = driveBridge(); try { return H && typeof H[fn] === 'function' ? JSON.parse(H[fn]() || 'null') : null; } catch (_) { return null; } }
    function renderDrive(el, d, api) {
        const H = driveBridge();
        if (!H) { el.innerHTML = ui.text('Drive detection needs the Melaton app with drive detection (an update to the Android app).'); return; }
        if (!d.driveWired) {
            d.driveWired = true;
            const again = () => { if (el.isConnected) api.rerender(); else window.removeEventListener('androiddrive', again); };
            window.addEventListener('androiddrive', again);
        }
        const st = driveJson('getDriveState') || {};
        const cars = driveJson('getDriveCars') || {};
        const chosen = new Set(Array.isArray(cars.cars) ? cars.cars : []);
        let bt = null;
        try { bt = window.AndroidBluetooth && typeof window.AndroidBluetooth.getState === 'function' ? JSON.parse(window.AndroidBluetooth.getState()) : null; } catch (_) { bt = null; }
        const devices = bt && Array.isArray(bt.devices) ? bt.devices : [];
        const since = st.since ? new Date(st.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
        el.innerHTML = `${ui.value('Now:', `${DRIVE_STATE[st.state] || 'Unknown'}${st.source && DRIVE_SOURCE[st.source] ? ` (${DRIVE_SOURCE[st.source]})` : ''}${since ? `, since ${since}` : ''}`, { wide: true })}
            ${ui.value('Motion:', DRIVE_ACCESS[st.activity] || 'Unknown', { wide: true })}
            ${st.activity === 'on' || st.activity === 'unavailable' ? '' : ui.buttons([['drive-access', 'Allow...']])}
            ${ui.note('The phone tells driving from walking with Android\'s motion detection. Traffic\'s camera and police warnings and the GPS follow it: parked in the car, the GPS stays off.')}
            ${ui.gap()}
            ${ui.sub('My cars')}
            ${devices.length ? devices.map((dv) => ui.check(`car:${dv.address}`, `${dv.name || dv.address}${dv.connected ? '  (Connected)' : ''}`, chosen.has(dv.address), `data-car="${esc(dv.address)}"`)).join('') : ui.text(bt ? 'No paired Bluetooth devices. Pair the car in Settings > Connections > Bluetooth.' : 'Bluetooth is not available.')}
            ${ui.note('Connecting to one of these counts as getting in the car.')}`;
        const allow = el.querySelector('[data-act="drive-access"]');
        if (allow) allow.addEventListener('click', () => { try { H.requestDriveAccess(); } catch (_) { /* older app */ } });
        el.querySelectorAll('input[data-car]').forEach((c) => c.addEventListener('change', () => {
            const next = new Set(chosen);
            if (c.checked) next.add(c.dataset.car); else next.delete(c.dataset.car);
            try { H.setDriveCars(JSON.stringify([...next])); } catch (_) { /* older app */ }
            chosen.clear(); next.forEach((a) => chosen.add(a));
        }));
    }

    // ======================================================================== Buttons

    /**
     * WM 6.1 Settings > Buttons (Program Buttons tab: "1. Select a button" list with Button |
     * Assignment columns, "2. Assign a program" combo; ~/.cache/wm61/ref-shell/b1.png). A phone
     * browser has no program buttons of its own, so the buttons here are the Today screen's soft
     * keys (Yukimi, Nov 10), kept per device by the shell (wmShell.todaySoftKeys). The list:
     * WM's <actions> first, then the programs, alphabetical.
     */
    const KEYS = () => {
        const k = window.wmShell && window.wmShell.todaySoftKeys;
        return k && typeof k.get === 'function' ? k : null;
    };
    const KEY_ROWS = [['left', 'Left soft key'], ['right', 'Right soft key']];
    const KEY_ACTION_ICON = { start: 'start-flag', menu: 'set-menus', notifications: 'set-sounds' };

    function keyChoices() {
        const k = KEYS();
        return k.actions().map((a) => ({ value: a.value, label: a.label, icon: KEY_ACTION_ICON[a.value] || '' }))
            .concat(k.programs().map((p) => ({ value: `app:${p.id}`, label: p.label, icon: p.icon || 'app-programs' })));
    }

    wmSettings.registerPage({
        id: 'buttons', tab: 'personal', label: 'Buttons', icon: 'set-buttons',
        tabs: [['program', 'Program Buttons']],
        available: () => !!KEYS(),
        init() {
            const v = KEYS().get();
            return { v: { ...v }, saved: { ...v }, sel: 'left' };
        },
        render(el, tab, d, api) {
            const choices = keyChoices();
            const k = KEYS();
            const choice = (v) => choices.find((c) => c.value === v) || choices.find((c) => c.value === k.defaults()[d.sel]) || choices[0];
            const icon = (c) => {
                if (!c || !c.icon) return '<span class="wmsp-btn-icon"></span>';
                const a = ui.art(c.icon);
                return `<img class="wmsp-btn-icon" src="${esc(a.src)}" srcset="${esc(a.srcset)}" alt="" draggable="false">`;
            };
            el.innerHTML = `<p class="wmsp-step">1. Select a button:</p>
                <div class="wmsp-btn-list" role="listbox" aria-label="Buttons">
                    <div class="wmsp-btn-head"><span>Button</span><span>Assignment</span></div>
                    ${KEY_ROWS.map(([side, label]) => {
                        const c = choice(d.v[side]);
                        return `<button type="button" class="wmsp-btn-row${side === d.sel ? ' is-selected' : ''}" role="option" aria-selected="${side === d.sel}" data-side="${side}">
                            <span class="wmsp-btn-name">${icon(c)}<span>${esc(label)}</span></span><span class="wmsp-btn-assign">${esc(c ? c.label : '')}</span></button>`;
                    }).join('')}
                </div>
                <p class="wmsp-step">2. Assign a program:</p>
                ${ui.comboHtml('assign', (choice(d.v[d.sel]) || {}).label || '')}`;
            el.querySelectorAll('.wmsp-btn-row').forEach((r) => r.addEventListener('click', () => { d.sel = r.dataset.side; api.rerender(); }));
            ui.bindCombo(el.querySelector('[data-act="assign"]'), choices.map((c) => [c.value, c.label]), (choice(d.v[d.sel]) || {}).value, (v) => {
                d.v[d.sel] = v;
                api.rerender();
            });
        },
        commit(d) {
            if (!same(d.v, d.saved)) KEYS().set(d.v);
            return [];
        }
    });

    // ======================================================================== Input

    // autofillSettings.js top-level consts (shared global lexical scope, not window properties)
    const delayPresets = () => (typeof AUTOFILL_DELAY_PRESETS !== 'undefined' ? AUTOFILL_DELAY_PRESETS : null)
        || [{ ms: 0, label: 'Instant (0 ms)' }, { ms: 80, label: 'Fast (80 ms)' }, { ms: 120, label: 'Normal (120 ms)' }, { ms: 200, label: 'Relaxed (200 ms)' }, { ms: 300, label: 'Slow (300 ms)' }, { ms: 500, label: 'Very Slow (500 ms)' }];
    const maxPresets = () => (typeof AUTOFILL_MAX_RESULTS_PRESETS !== 'undefined' ? AUTOFILL_MAX_RESULTS_PRESETS : null)
        || [15, 25, 35, 50, 75].map((count) => ({ count, label: `${count} results` }));

    wmSettings.registerPage({
        id: 'input', tab: 'personal', label: 'Input', icon: 'set-input',
        tabs: [['method', 'Input Method'], ['completion', 'Word Completion'], ['options', 'Options']],
        available: () => !!(fn('getAutofillSearchSettings') && fn('saveAutofillSearchSettingsToServer') && fn('setDesktopVirtualKeyboardEnabled')),
        init() {
            const a = { ...call('getAutofillSearchSettings') };
            const vk = call('readDesktopSettingsVirtualKeyboardPreference') === true;
            return { vk, a, saved: { vk, a: { ...a } } };
        },
        render(el, tab, d, api) {
            const a = d.a;
            if (tab === 'completion') {
                const delays = delayPresets().map((p) => [p.ms, p.label]);
                const maxes = maxPresets().map((p) => [p.count, p.label]);
                const off = !a.enabled;
                const dis = off ? 'disabled' : '';
                el.innerHTML = `${ui.check('enabled', 'Suggest words when entering text', a.enabled)}
                    ${ui.row('Suggest after:', ui.comboHtml('delay', (delays.find(([v]) => v === a.searchDelayMs) || [0, `${a.searchDelayMs} ms`])[1], off), { wide: true })}
                    ${ui.row('Suggest:', ui.comboHtml('max', (maxes.find(([v]) => v === a.maxResults) || [0, `${a.maxResults} results`])[1], off), { wide: true })}
                    ${ui.sub('Suggest from')}
                    ${ui.check('naiAnimeTags', 'NovelAI anime tags', a.naiAnimeTags, dis)}
                    ${ui.check('naiFurryTags', 'NovelAI furry tags', a.naiFurryTags, dis)}
                    ${ui.check('dbAnimeTags', 'Database anime tags', a.dbAnimeTags, dis)}
                    ${ui.check('dbFurryTags', 'Database furry tags', a.dbFurryTags, dis)}
                    ${ui.check('wikiPreviews', 'Show wiki previews', a.wikiPreviews, dis)}`;
                el.querySelector('input[name="enabled"]').addEventListener('change', (e) => { a.enabled = e.target.checked; api.rerender(); });
                ['naiAnimeTags', 'naiFurryTags', 'dbAnimeTags', 'dbFurryTags', 'wikiPreviews'].forEach((k) => {
                    el.querySelector(`input[name="${k}"]`).addEventListener('change', (e) => { a[k] = e.target.checked; });
                });
                ui.bindCombo(el.querySelector('[data-act="delay"]'), delays, a.searchDelayMs, (v) => { a.searchDelayMs = v; });
                ui.bindCombo(el.querySelector('[data-act="max"]'), maxes, a.maxResults, (v) => { a.maxResults = v; });
                return;
            }
            if (tab === 'options') {
                el.innerHTML = `${ui.sub('Spelling')}
                    ${ui.check('spellcheck', 'Spelling suggestions', a.spellcheck)}
                    ${checkIn('spellcheckSoundAlike', 'Sound-alike suggestions', a.spellcheckSoundAlike, a.spellcheck ? '' : 'disabled')}
                    ${ui.check('thesaurus', 'Thesaurus', a.thesaurus)}
                    ${ui.gap()}
                    ${ui.note('SmartText checks the words of a prompt as you type and offers their synonyms.')}`;
                el.querySelector('input[name="spellcheck"]').addEventListener('change', (e) => { a.spellcheck = e.target.checked; api.rerender(); });
                ['spellcheckSoundAlike', 'thesaurus'].forEach((k) => {
                    el.querySelector(`input[name="${k}"]`).addEventListener('change', (e) => { a[k] = e.target.checked; });
                });
                return;
            }
            const methods = [['system', 'Phone keyboard'], ['melaton', 'Melaton Keyboard']];
            el.innerHTML = `${ui.row('Input method:', ui.comboHtml('method', methods[d.vk ? 1 : 0][1]), { wide: true })}
                ${ui.gap()}
                ${ui.note('Saved in this browser only, as Control Panel > Keyboard does: Melaton Keyboard replaces the system keyboard when this browser shows the desktop. Your other computers keep their own choice, and Melaton Mobile always uses the phone\'s own keyboard.')}`;
            ui.bindCombo(el.querySelector('[data-act="method"]'), methods, d.vk ? 'melaton' : 'system', (v) => { d.vk = v === 'melaton'; });
        },
        async commit(d) {
            if (d.vk !== d.saved.vk) call('setDesktopVirtualKeyboardEnabled', d.vk);
            if (same(d.a, d.saved.a)) return [];
            const client = ws();
            if (!client || typeof client.isConnected !== 'function' || !client.isConnected()) {
                await box({ title: 'Input', icon: 'error', text: 'The word completion and spelling settings could not be saved: not connected to Dreamscape.' });
                return false;
            }
            // autofillSettings.js shows its own message when the server turns it down
            const ok = await call('saveAutofillSearchSettingsToServer', { ...d.a });
            if (!ok) return false;
            d.saved.a = { ...d.a };
            return [];
        }
    });

    // ======================================================================== Lock

    // the desktop's savers (personalizationDialogs.js SAVER_NAMES)
    const SAVER_NAMES = { none: '(None)', aurora: 'Aurora', blank: 'Blank', bubbles: 'Bubbles', focus: 'Focus Cover', logo: 'Melaton Logo', mystify: 'Mystify', photos: 'Photos', ribbons: 'Ribbons' };
    const saverName = (id) => {
        const pd = window.personalizationDialogs;
        const names = pd && pd.SAVER_NAMES ? pd.SAVER_NAMES : SAVER_NAMES;
        return (names && names[id]) || SAVER_NAMES[id] || id;
    };
    const WAITS = [1, 2, 3, 4, 5, 10, 15, 20, 30, 45, 60, 120, 180, 240, 360, 720];
    const waitLabel = (m) => (m % 60 === 0 && m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`);

    // ---- 6.5.1 (#850): Settings > Lock > Password, as Windows Mobile 6.5.3's (emulator, 480 x 640) ----
    // "Prompt if phone unused for" with its wait (0 Minutes .. 24 Hours), Password type (Simple PIN;
    // the device's Strong alphanumeric is not offered), Password and Confirm. Ticked with a PIN typed
    // twice: the lock screen asks for it (wmLock65.js keeps only its salted hash, on this device).
    // Cleared: no PIN. A PIN that is set shows as eight stars (device); typing replaces it. The
    // device's Hint tab is left out: what it does with a hint was not seen on the emulator.
    // This keeps the screen private; it is not protection for the data.
    const LOCK_PIN_651 = document.documentElement.dataset.wmRev === '6.5.1';
    const PIN_STARS = '********';
    const pinWaitLabel = (m) => (m < 60 ? `${m} Minute${m === 1 ? '' : 's'}` : `${m / 60} Hour${m === 60 ? '' : 's'}`);
    const lockPin651 = {
        api: () => (window.wmLock && window.wmLock.pin) || null,
        render(el, d) {
            const pin = this.api();
            if (!pin) { el.innerHTML = ''; return; }
            // a PIN is set: the page opens once it has been given (device: the keypad with one wide
            // Unlock key comes up first; its X goes back without opening the page)
            if (!d.pin && !d.pinOk && pin.isSet()) {
                el.innerHTML = '';
                if (!d.pinAsking) {
                    d.pinAsking = true;
                    pin.ask().then((ok) => {
                        d.pinAsking = false;
                        if (ok) { d.pinOk = true; d.rerender(); return; }
                        const sh = window.wmShell;
                        if (sh && sh.current === 'settings' && typeof sh.back === 'function') sh.back();
                    });
                }
                return;
            }
            if (!d.pin) { const s = pin.settings(); d.pin = { on: s.on, wait: s.wait, was: s.on, pw: s.on ? PIN_STARS : '', pw2: s.on ? PIN_STARS : '', typed: false }; }
            const p = d.pin;
            const off = p.on ? '' : ' disabled';
            const field = (f, v) => `<input class="wm-edit" type="password" inputmode="numeric" autocomplete="off" maxlength="16" data-f="${f}" value="${esc(v)}"${off}>`;
            el.innerHTML = `<div class="wmsp-checkcombo">${ui.check('pinOn', 'Prompt if phone unused for', p.on)}${ui.comboHtml('pinWait', pinWaitLabel(p.wait), !p.on)}</div>
                <div class="wm-pin651-rows">${ui.row('Password type', ui.comboHtml('pinType', 'Simple PIN', !p.on))}
                ${ui.row('Password', field('pw', p.pw))}
                ${ui.row('Confirm', field('pw2', p.pw2))}</div>`;
            el.querySelector('input[name="pinOn"]').addEventListener('change', (e) => { p.on = e.target.checked; d.rerender(); });
            ui.bindCombo(el.querySelector('[data-act="pinWait"]'), pin.waits().map((m) => [m, pinWaitLabel(m)]), p.wait, (v) => { p.wait = v; }, 'right');
            ui.bindCombo(el.querySelector('[data-act="pinType"]'), [['pin', 'Simple PIN']], 'pin', () => {});
            el.querySelectorAll('input[data-f]').forEach((inp) => {
                // the stars stand for the PIN that is set: the first key into either box starts both afresh
                inp.addEventListener('focus', () => { if (!p.typed && p.was) { p.typed = true; p.pw = ''; p.pw2 = ''; el.querySelectorAll('input[data-f]').forEach((x) => { x.value = ''; }); } });
                inp.addEventListener('input', () => { p.typed = true; p[inp.dataset.f] = inp.value; });
            });
        },
        box(title, text) {
            const sh = window.wmShell;
            return sh && typeof sh.messageBox === 'function' ? sh.messageBox({ title, text, buttons: [{ text: 'OK', value: true }] }) : Promise.resolve();
        },
        /** Save the password page; false when a box told the user what to fix. */
        async commit(d) {
            const pin = this.api();
            const p = d.pin;
            if (!pin || !p) return true;
            if (!p.on) { if (p.was) { pin.clear(); p.was = false; } return true; }
            const fresh = p.typed || !p.was;
            if (!fresh) { pin.update({ wait: p.wait }); return true; }
            // nothing typed over a PIN that is set (the boxes were only focused): it stays
            if (p.was && !p.pw && !p.pw2) { pin.update({ wait: p.wait }); return true; }
            if (p.pw !== p.pw2) { await this.box('Password Error', 'Passwords do not match. Please retype identical passwords in both boxes.'); return false; }
            const why = pin.problem(p.pw);
            if (why) { await this.box('Password Error', why); return false; }
            if (!pin.canSet() || !(await pin.set(p.pw, { wait: p.wait }))) { await this.box('Password Error', 'The password could not be saved on this device.'); return false; }
            Object.assign(p, { was: true, typed: false, pw: PIN_STARS, pw2: PIN_STARS });
            return true;
        }
    };

    wmSettings.registerPage({
        id: 'lock', tab: 'personal', label: 'Lock', icon: 'set-lock',
        // 6.5.1 (#850): the phone's own password comes first (lockPin651 below); the workspace's screen
        // saver, which was this page's Password tab, keeps its controls on a tab of its own (Display:
        // 6.5's name for the third tab of this applet; "Screen saver" does not fit the tab band)
        tabs: LOCK_PIN_651 ? [['pin', 'Password'], ['password', 'Display']] : [['password', 'Password']],
        available: () => !!(P() && typeof P().update === 'function'),
        init() {
            const ss = P().get().screenSaver;
            const defId = P().DEFAULTS && P().DEFAULTS.screenSaver && P().DEFAULTS.screenSaver.id !== 'none' ? P().DEFAULTS.screenSaver.id : 'logo';
            const d = {
                on: ss.id !== 'none',
                id: ss.id !== 'none' ? ss.id : defId,
                wait: ss.wait,
                resumeLogon: ss.resumeLogon === true,
                saved: { id: ss.id, wait: ss.wait, resumeLogon: ss.resumeLogon === true },
                account: window.meletonAccounts && typeof window.meletonAccounts.current === 'function' ? window.meletonAccounts.current() : 'guest',
                pins: null,
                pinsErr: ''
            };
            const client = ws();
            if (d.account === 'administrator' && client && typeof client.getPinSettings === 'function') {
                client.getPinSettings().then((r) => { d.pins = r && r.success ? r : null; if (d.rerender) d.rerender(); })
                    .catch((err) => { d.pinsErr = (err && err.message) || 'Unknown'; if (d.rerender) d.rerender(); });
            }
            return d;
        },
        render(el, tab, d, api) {
            d.rerender = api.rerender;
            if (tab === 'pin') { lockPin651.render(el, d, api); return; }
            const waits = WAITS.includes(d.wait) ? WAITS.slice() : WAITS.concat([d.wait]).sort((x, y) => x - y);
            let pin = 'Unknown';
            if (d.account !== 'administrator') pin = 'Set by the administrator';
            else if (d.pins) pin = d.pins.adminPinConfigured ? 'Simple PIN' : 'No password';
            else if (!d.pinsErr) pin = 'Reading...';
            el.innerHTML = `<div class="wmsp-checkcombo">${ui.check('on', 'Prompt if device unused for', d.on)}${ui.comboHtml('wait', waitLabel(d.wait), !d.on)}</div>
                ${checkIn('resume', 'On resume, display the logon screen', d.resumeLogon, d.on ? '' : 'disabled')}
                ${ui.value('Screen saver:', saverName(d.on ? d.id : 'none'), { wide: true })}
                ${ui.gap()}
                ${ui.value('Password type:', pin, { wide: true })}
                ${ui.note('Passwords (PINs) are changed on the desktop, in Control Panel > User Accounts. The screen saver and its logon prompt belong to this workspace, as on the desktop.')}`;
            el.querySelector('input[name="on"]').addEventListener('change', (e) => { d.on = e.target.checked; api.rerender(); });
            el.querySelector('input[name="resume"]').addEventListener('change', (e) => { d.resumeLogon = e.target.checked; });
            ui.bindCombo(el.querySelector('[data-act="wait"]'), waits.map((m) => [m, waitLabel(m)]), d.wait, (v) => { d.wait = v; }, 'right');
        },
        async commit(d) {
            // 6.5.1 (#850): the password first; false keeps the page open (its message box was shown)
            if (LOCK_PIN_651 && d.pin && (await lockPin651.commit(d)) === false) return false;
            const next = { id: d.on ? d.id : 'none', wait: d.wait, resumeLogon: d.resumeLogon };
            if (!same(next, d.saved)) { P().update({ screenSaver: next }); d.saved = next; }
            return [];
        }
    });

    // ======================================================================== Owner Information: Picture

    const DEFAULT_PICTURES = ['music', 'starfish', 'leaf', 'robot', 'fish', 'bonsai', 'sports', 'dog', 'chess', 'kitten', 'fireworks', 'guest', 'user'];

    /** An upload drawn into 128x128 (centre crop) as a PNG data URL, as User Accounts sizes it. */
    function toTile(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const size = Math.min(img.naturalWidth, img.naturalHeight);
                const canvas = document.createElement('canvas');
                canvas.width = 128;
                canvas.height = 128;
                canvas.getContext('2d').drawImage(img, (img.naturalWidth - size) / 2, (img.naturalHeight - size) / 2, size, size, 0, 0, 128, 128);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture.')); };
            img.src = url;
        });
    }

    wmSettings.extendPage('owner', {
        id: 'pic',
        tabs: [['pic-picture', 'Picture']],
        after: 'identification',
        available: () => !!(window.meletonAccounts && ws() && typeof ws().setAccountPicture === 'function'),
        init() {
            const acc = window.meletonAccounts;
            const account = typeof acc.current === 'function' ? acc.current() : 'guest';
            const d = { account, canEdit: account === 'administrator', current: null, chosen: null, upload: null, defaults: DEFAULT_PICTURES, url: acc.pictureUrl(account) };
            ws().getAccountPictures().then((res) => {
                if (!res || !res.accounts) return;
                const mine = res.accounts[account] || {};
                d.current = mine.picture || null;
                if (mine.url) d.url = mine.url;
                if (Array.isArray(res.defaults) && res.defaults.length) d.defaults = res.defaults;
                if (d.rerender) d.rerender();
            }).catch(() => { /* the defaults show */ });
            return d;
        },
        render(el, tab, d, api) {
            d.rerender = api.rerender;
            const chosen = d.chosen || d.current;
            let preview = d.url;
            if (d.upload) preview = d.upload;
            else if (d.chosen && d.chosen !== 'custom') preview = `/static_images/account-pictures/${d.chosen}.png`;
            el.innerHTML = `<div class="wmsp-owner">
                    <img class="wmsp-owner-pic" src="${esc(preview)}" alt="" draggable="false">
                    <span class="wmsp-owner-name">${esc(window.meletonAccounts.name(d.account))}</span>
                </div>
                ${ui.text('The picture appears on the Welcome screen and on the Start menu.')}
                <div class="wm-picker is-icons wmsp-pics">${d.defaults.map((name) => `<button type="button" class="wm-picker-cell${chosen === name && !d.upload ? ' is-selected' : ''}" data-pic="${esc(name)}" aria-label="${esc(name)}"${d.canEdit ? '' : ' disabled'}><img src="/static_images/account-pictures/${esc(name)}.png" alt="" loading="lazy" draggable="false"></button>`).join('')}</div>
                ${d.canEdit ? `${ui.buttons([['browse', 'Browse...']])}<input type="file" accept="image/*" hidden data-f="file">` : ui.note('Only an administrator can change the picture.')}`;
            if (!d.canEdit) return;
            el.querySelectorAll('[data-pic]').forEach((c) => c.addEventListener('click', () => { d.chosen = c.dataset.pic; d.upload = null; api.rerender(); }));
            const input = el.querySelector('[data-f="file"]');
            el.querySelector('[data-act="browse"]').addEventListener('click', () => input.click());
            input.addEventListener('change', async () => {
                const file = input.files && input.files[0];
                if (!file) return;
                try {
                    d.upload = await toTile(file);
                    d.chosen = 'custom';
                    api.rerender();
                } catch (err) {
                    await box({ title: 'Owner Information', icon: 'error', text: err.message });
                }
            });
        },
        async commit(d) {
            if (!d.canEdit || !d.chosen || (d.chosen === d.current && d.chosen !== 'custom')) return [];
            try {
                const res = await ws().setAccountPicture(d.account, d.chosen, d.chosen === 'custom' ? d.upload : null);
                if (res && res.accounts) window.meletonAccounts.set(res.accounts);
            } catch (err) {
                await box({ title: 'Owner Information', icon: 'error', text: (err && err.message) || 'The picture could not be changed.' });
                return false;
            }
            return [];
        }
    });

    // ======================================================================== Screen: Accessibility

    // Ease of Access Center's key (cplPages2.js ACCESS). Only what the phone honours: High Contrast
    // and No Animations (melaton-accessibility.css on the whole page) and Narrator (focus speech).
    // Thick Focus and Remove background images are left to the desktop (nothing on the phone reads
    // the second one; the phone has no focus rectangle to thicken).
    const ACCESS = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Accessibility';
    const ACCESS_OPTS = [
        ['HighContrast', 'High Contrast'],
        ['NoAnimations', 'Turn off unnecessary animations'],
        ['Narrator', 'Narrator (read the selected item aloud)']
    ];

    wmSettings.extendPage('screen', {
        id: 'acc',
        tabs: [['acc-access', 'Accessibility']],
        after: 'textsize',
        available: () => !!(window.melatonRegistry && typeof window.melatonRegistry.set === 'function'),
        init() {
            const reg = window.melatonRegistry;
            const values = {};
            ACCESS_OPTS.forEach(([k]) => { values[k] = reg.get(ACCESS, k, false) === true; });
            return { values, saved: { ...values } };
        },
        render(el, tab, d) {
            el.innerHTML = `${ui.text('These settings also apply to the desktop, as in the Ease of Access Center.')}
                ${ACCESS_OPTS.filter(([k]) => k !== 'Narrator' || window.speechSynthesis).map(([k, l]) => ui.check(`acc-${k}`, l, d.values[k], `data-k="${k}"`)).join('')}`;
            el.querySelectorAll('input[data-k]').forEach((c) => c.addEventListener('change', () => { d.values[c.dataset.k] = c.checked; }));
        },
        async commit(d) {
            const patch = {};
            Object.keys(d.values).forEach((k) => { if (d.values[k] !== d.saved[k]) patch[k] = d.values[k]; });
            if (!Object.keys(patch).length) return [];
            try {
                await window.melatonRegistry.set(ACCESS, patch);
            } catch (err) {
                await box({ title: 'Screen', icon: 'error', text: (err && err.message) || 'The accessibility settings could not be saved.' });
                return false;
            }
            if (window.melatonAccessibility) window.melatonAccessibility.apply();
            if (window.cplPages2 && typeof window.cplPages2.applyAccess === 'function') window.cplPages2.applyAccess();
            return [];
        }
    });
})();
