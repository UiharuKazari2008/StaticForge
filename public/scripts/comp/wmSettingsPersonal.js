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
    const DRIVE_ACCESS = { on: 'On', ask: 'Not allowed yet', denied: 'Refused', unavailable: 'Not on this phone' };
    // leaving Home or Work (AndroidHome.setDrivePlaces from the location service, background location): 'none' = allowed, no places yet
    const DRIVE_FENCE = { on: 'Watching', ask: 'Not allowed yet', denied: 'Refused', none: 'No places yet' };
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
            ${st.geofence ? ui.value('Home / Work:', DRIVE_FENCE[st.geofence] || st.geofence, { wide: true }) : ''}
            ${(st.activity === 'on' || st.activity === 'unavailable') && (!st.geofence || st.geofence === 'on' || st.geofence === 'none') ? '' : ui.buttons([['drive-access', 'Allow...']])}
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

    // ---- Quick Access (#1017): the swipe at the screen's edge, what its panel holds and in what order. The settings
    // are the app's (AndroidQuickAccess.config / setConfig): the Melaton Bars service draws the tab and panel with no
    // page running
    const QA = () => (window.AndroidQuickAccess && typeof window.AndroidQuickAccess.config === 'function' ? window.AndroidQuickAccess : null);
    const qaRead = (fn) => { try { return JSON.parse(QA()[fn]()); } catch (_) { return null; } };
    const QA_EDGES = [['right', 'Right'], ['left', 'Left']];
    // the zone's place (Yukimi, Nov 22 2026: "a position adjustment slider with radio button for top or bottom aligned. It
    // shows it as you adjust it"): its top or its bottom edge, in twentieths of the screen; the app shows the tab there
    const QA_POS = Array.from({ length: 21 }, (_, i) => i);
    const qaPreview = (q) => { try { if (typeof QA().previewTab === 'function') QA().previewTab(q.zoneTop, q.zoneHeight, q.side); } catch (_) { /* older app */ } };
    const qaClampTop = (q, t) => Math.max(0, Math.min(1 - q.zoneHeight, t));
    // (Yukimi, Nov 22 2026: "the touch area is way too big") the pull zone a few finger widths tall; the tab is drawn as
    // tall as the zone, and its height is a slider (Nov 23 2026: "the quick toggle tab itself is slightly too tall. There
    // should be a setting slash slider to adjust the height"): 4 to 15 hundredths of the screen
    const QA_HEIGHTS = Array.from({ length: 12 }, (_, i) => i + 4);
    const QA_LAYOUTS = [['strip1', 'Sidebar strip, 1 column'], ['strip2', 'Sidebar strip, 2 columns'], ['wide', 'Wide panel']];
    /** Every control the panel can hold: the built-ins, then each installed tile (its app named after it). */
    function qaChoices() {
        const cat = qaRead('catalog') || {};
        return (cat.controls || []).map((c) => ({ id: c.id, label: c.label }))
            .concat((cat.tiles || []).filter((t) => !t.builtIn).map((t) => ({ id: t.id, label: t.app && t.app !== t.label ? `${t.label} (${t.app})` : t.label })));
    }
    function qaRender(el, d, api) {
        const q = d.qa;
        const choices = qaChoices();
        const label = (id) => (choices.find((c) => c.id === id) || { label: id }).label;
        // the panel's controls in their order, then the rest (unticked) to add
        const rows = q.items.map((id) => ({ key: id, label: label(id), checked: true, selected: id === d.qaSel }))
            .concat(choices.filter((c) => !q.items.includes(c.id)).map((c) => ({ key: c.id, label: c.label, checked: false, selected: c.id === d.qaSel })));
        const layout = q.layout === 'wide' ? 'wide' : Number(q.columns) === 2 ? 'strip2' : 'strip1';
        el.innerHTML = `${ui.check('qa-on', 'Swipe from the screen\'s edge for Quick Access', q.enabled, 'data-k="enabled"')}
            ${ui.row('Edge:', ui.comboHtml('qa-edge', (QA_EDGES.find(([v]) => v === q.side) || QA_EDGES[0])[1], !q.enabled), { wide: true })}
            ${ui.sub('Tab height')}
            <div data-f="qa-size"></div>
            ${ui.sub('Position')}
            <div class="wmsp-radios">${ui.radio('qa-anchor', 'top', 'Top aligned', q.anchor !== 'bottom', q.enabled ? '' : 'disabled')}${ui.radio('qa-anchor', 'bottom', 'Bottom aligned', q.anchor === 'bottom', q.enabled ? '' : 'disabled')}</div>
            <div data-f="qa-pos"></div>
            ${ui.row('Show as:', ui.comboHtml('qa-layout', QA_LAYOUTS.find(([v]) => v === layout)[1], !q.enabled), { wide: true })}
            ${ui.sub('Controls')}
            ${ui.listbox(rows, { maxHeight: 150 })}
            ${ui.buttons([['qa-up', 'Move Up', !q.items.includes(d.qaSel) || q.items.indexOf(d.qaSel) === 0], ['qa-down', 'Move Down', !q.items.includes(d.qaSel) || q.items.indexOf(d.qaSel) === q.items.length - 1]])}
            ${ui.note('Tick a control to put it in Quick Access; select one to move it. Other programs\' quick settings tiles are listed too.')}`;
        const on = el.querySelector('input[data-k="enabled"]');
        if (on) on.addEventListener('change', () => { q.enabled = on.checked; api.rerender(); });
        ui.bindCombo(el.querySelector('[data-act="qa-edge"]'), QA_EDGES, q.side, (v) => { q.side = v; qaPreview(q); });
        // a new height keeps the aligned edge where it is; the app shows the tab at it as the slider moves
        ui.trackbar(el.querySelector('[data-f="qa-size"]'), {
            steps: QA_HEIGHTS, value: Math.max(4, Math.min(15, Math.round(q.zoneHeight * 100))), lo: 'Short', hi: 'Tall', label: 'Quick Access tab height', disabled: !q.enabled,
            onChange: (n) => {
                const v = n / 100;
                const bottom = q.zoneTop + q.zoneHeight;
                q.zoneHeight = v;
                q.zoneTop = qaClampTop(q, q.anchor === 'bottom' ? bottom - v : q.zoneTop);
                qaPreview(q);
            }
        });
        el.querySelectorAll('input[name="qa-anchor"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { q.anchor = r.value; api.rerender(); } }));
        const edgeNow = q.anchor === 'bottom' ? q.zoneTop + q.zoneHeight : q.zoneTop;
        ui.trackbar(el.querySelector('[data-f="qa-pos"]'), {
            steps: QA_POS, value: Math.round(edgeNow * 20), lo: 'Top', hi: 'Bottom', label: 'Quick Access position', disabled: !q.enabled,
            onChange: (n) => { q.zoneTop = qaClampTop(q, q.anchor === 'bottom' ? n / 20 - q.zoneHeight : n / 20); qaPreview(q); }
        });
        ui.bindCombo(el.querySelector('[data-act="qa-layout"]'), QA_LAYOUTS, layout, (v) => { q.layout = v === 'wide' ? 'wide' : 'strip'; q.columns = v === 'strip2' ? 2 : 1; });
        ui.bindListbox(el.querySelector('.wm-listbox'), (key) => { d.qaSel = key; api.rerender(); }, (key, checked) => {
            q.items = checked ? q.items.filter((x) => x !== key).concat([key]) : q.items.filter((x) => x !== key);
            d.qaSel = key;
            api.rerender();
        });
        const move = (by) => {
            const i = q.items.indexOf(d.qaSel);
            const j = i + by;
            if (i < 0 || j < 0 || j >= q.items.length) return;
            [q.items[i], q.items[j]] = [q.items[j], q.items[i]];
            api.rerender();
        };
        const up = el.querySelector('[data-act="qa-up"]'); if (up) up.addEventListener('click', () => move(-1));
        const down = el.querySelector('[data-act="qa-down"]'); if (down) down.addEventListener('click', () => move(1));
    }

    // ---- Soft Key Bar (#1067, Yukimi Nov 22: "a full Soft Key manager"): the soft key bar over Android programs, per
    // program - Left, Center and Right each an action, a name, or a menu of its own (named rows, each an action). Stored in
    // the app's Bars config (softProfiles { default, <package>: { left, center, right } }) and applied there by the program
    // in front, page or no page (DSApp SoftKeys.kt); the kit carries each menu's drawing (melatonBars.js softKeyMenus)
    const SK_SIDES = [['left', 'Left soft key'], ['center', 'Center button'], ['right', 'Right soft key']];
    const SK_DEFAULT = { left: 'back', center: 'tasks', right: 'menu' };
    // the actions (WM's <actions> look: in angle brackets, as Program Buttons lists them)
    const SK_ACTIONS = [['back', '<Back>'], ['menu', '<Soft Key Menu>'], ['ownmenu', '<Menu of its own>'], ['home', '<Home>'], ['today', '<Today>'],
        ['start', '<Start>'], ['tasks', '<Running Programs>'], ['recents', '<Recent Programs>'], ['notifications', '<Notifications>'],
        ['quicksettings', '<Quick Settings>'], ['keyboard', '<Show/Hide Keyboard>'], ['program', '<Open a Program>'], ['key', '<Key>'],
        ['combo', '<Key Combination>'], ['do:taskmanager', '<Task Manager>'], ['do:maximize', '<Maximize>'], ['do:minimize', '<Minimize>'],
        ['do:close', '<Close>'], ['do:split', '<Split View>'], ['do:windowed', '<Pop-up Window>'], ['do:flashlight', '<Flashlight>'],
        ['do:screenshot', '<Screenshot>'], ['none', '<None>']];
    // Android's key codes most asked for (any other: typed as its KEYCODE_ name)
    const SK_KEYS = ['ESCAPE', 'ENTER', 'TAB', 'DEL', 'FORWARD_DEL', 'SPACE', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'PAGE_UP', 'PAGE_DOWN',
        'MOVE_HOME', 'MOVE_END', 'SEARCH', 'MENU', 'MEDIA_PLAY_PAUSE', 'MEDIA_NEXT', 'MEDIA_PREVIOUS', 'VOLUME_MUTE', 'SYSRQ', 'CAMERA', 'CALL', 'ENDCALL',
        'BRIGHTNESS_UP', 'BRIGHTNESS_DOWN', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
    const SK_COMBOS = ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+A', 'Ctrl+S', 'Ctrl+F', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Shift+T', 'Ctrl+Tab', 'Alt+Tab', 'Alt+F4', 'Ctrl+Shift+Z'];
    const SK_NAMES = { ctrl: 'CTRL_LEFT', control: 'CTRL_LEFT', shift: 'SHIFT_LEFT', alt: 'ALT_LEFT', win: 'META_LEFT', meta: 'META_LEFT', esc: 'ESCAPE', escape: 'ESCAPE',
        enter: 'ENTER', return: 'ENTER', tab: 'TAB', backspace: 'DEL', bksp: 'DEL', del: 'FORWARD_DEL', delete: 'FORWARD_DEL', space: 'SPACE', up: 'DPAD_UP', down: 'DPAD_DOWN',
        left: 'DPAD_LEFT', right: 'DPAD_RIGHT', pgup: 'PAGE_UP', pageup: 'PAGE_UP', pgdn: 'PAGE_DOWN', pagedown: 'PAGE_DOWN', home: 'MOVE_HOME', end: 'MOVE_END',
        ins: 'INSERT', insert: 'INSERT', ',': 'COMMA', '.': 'PERIOD', '/': 'SLASH', '-': 'MINUS', '=': 'EQUALS', '[': 'LEFT_BRACKET', ']': 'RIGHT_BRACKET', ';': 'SEMICOLON' };
    const SK_SHORT = { CTRL_LEFT: 'Ctrl', CTRL_RIGHT: 'Ctrl', SHIFT_LEFT: 'Shift', SHIFT_RIGHT: 'Shift', ALT_LEFT: 'Alt', ALT_RIGHT: 'Alt', META_LEFT: 'Win', META_RIGHT: 'Win',
        ESCAPE: 'Esc', DEL: 'Backspace', FORWARD_DEL: 'Del', DPAD_UP: 'Up', DPAD_DOWN: 'Down', DPAD_LEFT: 'Left', DPAD_RIGHT: 'Right', PAGE_UP: 'PgUp', PAGE_DOWN: 'PgDn',
        MOVE_HOME: 'Home', MOVE_END: 'End' };
    const skCode = (t) => {
        const k = String(t || '').trim();
        if (!k) return '';
        const n = SK_NAMES[k.toLowerCase()] || k.toUpperCase().replace(/^KEYCODE_/, '');
        return /^[A-Z0-9_]{1,40}$/.test(n) ? n : '';
    };
    /** "Ctrl+Shift+T" as the app's combo:KEYCODE_CTRL_LEFT+KEYCODE_SHIFT_LEFT+KEYCODE_T ('' when a part is not a key). */
    const skCombo = (text) => {
        const parts = String(text || '').split('+').map((x) => x.trim()).filter(Boolean).map(skCode);
        return parts.length >= 2 && parts.length <= 5 && parts.every(Boolean) ? `combo:${parts.map((c) => `KEYCODE_${c}`).join('+')}` : '';
    };
    const skKeyName = (c) => { const n = String(c).replace(/^KEYCODE_/, ''); return SK_SHORT[n] || (n.length === 1 ? n : n.charAt(0) + n.slice(1).toLowerCase()); };
    const skComboText = (a) => a.slice(6).split('+').map(skKeyName).join('+');
    const skPrograms = () => { try { return window.wmShell.todaySoftKeys.programs(); } catch (_) { return []; } };
    // the phone's Android programs a profile can be for (one per package; work-profile copies left out)
    const skAndroidApps = () => {
        const seen = new Set();
        return skPrograms().filter((p) => String(p.id).startsWith('android:') && !String(p.id).includes('@u')).map((p) => ({ pkg: String(p.id).slice(8).split('/')[0], label: p.label }))
            .filter((a) => a.pkg && !seen.has(a.pkg) && seen.add(a.pkg));
    };
    const skKind = (a) => (a.startsWith('open:') ? 'program' : a.startsWith('key:') ? 'key' : a.startsWith('combo:') ? 'combo' : a);
    /** What an action is called in the lists. */
    function skActionText(a) {
        if (!a) return '';
        if (a.startsWith('open:')) { const p = skPrograms().find((x) => x.id === a.slice(5)); return p ? p.label : a.slice(5); }
        if (a.startsWith('key:')) return `Key: ${skKeyName(a.slice(4))}`;
        if (a.startsWith('combo:')) return skComboText(a);
        return (SK_ACTIONS.find(([k]) => k === a) || [a, a])[1];
    }
    /** The name a key shows on the bar when none is typed (DSApp SoftKeys.defaultLabel). */
    function skDefaultName(a) {
        if (a.startsWith('combo:')) return skComboText(a);
        if (a.startsWith('key:')) return skKeyName(a.slice(4));
        return { back: 'Back', menu: 'Menu', ownmenu: 'Menu', home: 'Home', recents: 'Recent', start: 'Start', today: 'Today', notifications: 'Notification', quicksettings: 'Settings', keyboard: 'Keyboard' }[a] || '';
    }
    /** The stored profiles, or Default made from the old left / right settings (Back | the right soft key). */
    function skLoad() {
        let st = null;
        try { st = JSON.parse(window.AndroidBars.getState()); } catch (_) { st = null; }
        const c = (st && st.config) || {};
        const saved = c.softProfiles && typeof c.softProfiles === 'object' ? JSON.parse(JSON.stringify(c.softProfiles)) : {};
        if (!saved.default) saved.default = { left: { action: 'back', label: '' }, center: { action: 'tasks', label: '' }, right: { action: c.softRight || 'menu', label: '' } };
        return saved;
    }
    /**
     * An action's chooser: the action combo, then what it needs (a program, a key, a combination). html(prefix, action) and
     * bind(el, prefix, action, set(newAction), rerender).
     */
    function skActionHtml(prefix, a, side, split = false) {
        const kind = skKind(a);
        const list = SK_ACTIONS.filter(([k]) => prefix === 'sk' || k !== 'ownmenu');
        let more = '';
        if (kind === 'program') {
            const p = skPrograms().find((x) => `open:${x.id}` === a);
            more = ui.row('Program:', ui.comboHtml(`${prefix}-prog`, p ? p.label : ''), { wide: true });
        } else if (kind === 'key') {
            more = `${ui.row('Key:', ui.comboHtml(`${prefix}-keys`, skKeyName(a.slice(4) || 'ESCAPE')), { wide: true })}${ui.row('Key code:', ui.edit('', a.slice(4).replace(/^KEYCODE_/, ''), `data-f="${prefix}-code" maxlength="40"`), { wide: true })}`;
        } else if (kind === 'combo') {
            more = `${ui.row('Keys:', `<div class="wm-combo-edit">${ui.edit('', a.length > 6 ? skComboText(a) : '', `data-f="${prefix}-combo" maxlength="40"`)}<button type="button" class="wm-combo" data-act="${prefix}-combos" aria-label="Presets"></button></div>`, { wide: true })}`;
        }
        const main = ui.comboHtml(`${prefix}-act`, (list.find(([k]) => k === kind) || [kind, skActionText(a)])[1]);
        // (split: the combo for a row of its own and what it needs as rows under it - never rows inside a row)
        return split ? { main, more } : `${main}${more}`;
    }
    function skActionBind(el, prefix, a, side, set, rerender) {
        const kind = skKind(a);
        const list = SK_ACTIONS.filter(([k]) => prefix === 'sk' || k !== 'ownmenu');
        ui.bindCombo(el.querySelector(`[data-act="${prefix}-act"]`), list, kind, (v) => {
            const progs = skPrograms();
            set(v === 'program' ? (progs.length ? `open:${progs[0].id}` : 'none') : v === 'key' ? 'key:KEYCODE_ESCAPE' : v === 'combo' ? 'combo:KEYCODE_CTRL_LEFT+KEYCODE_Z' : v);
            rerender();
        });
        if (kind === 'program') {
            ui.bindCombo(el.querySelector(`[data-act="${prefix}-prog"]`), skPrograms().map((p) => [p.id, p.label]), a.slice(5), (v) => { set(`open:${v}`); rerender(); });
        } else if (kind === 'key') {
            ui.bindCombo(el.querySelector(`[data-act="${prefix}-keys"]`), SK_KEYS.map((k) => [k, skKeyName(k)]), a.slice(4).replace(/^KEYCODE_/, ''), (v) => { set(`key:KEYCODE_${v}`); rerender(); });
            const code = el.querySelector(`[data-f="${prefix}-code"]`);
            // (kept as it is typed: ok may close the page before the box loses focus)
            if (code) { code.addEventListener('input', () => { const c = skCode(code.value); if (c) set(`key:KEYCODE_${c}`); }); code.addEventListener('change', () => rerender()); }
        } else if (kind === 'combo') {
            const edit = el.querySelector(`[data-f="${prefix}-combo"]`);
            if (edit) { edit.addEventListener('input', () => { const v = skCombo(edit.value); if (v) set(v); }); edit.addEventListener('change', () => rerender()); }
            const presets = el.querySelector(`[data-act="${prefix}-combos"]`);
            if (presets) presets.addEventListener('click', (e) => {
                e.stopPropagation();
                window.wmShell.dropdown(presets.parentElement, SK_COMBOS.map((t) => ({ label: t, radio: skCombo(t) === a, action: () => { set(skCombo(t)); rerender(); } })), 'left');
            });
        }
    }
    function skRender(el, d, api) {
        const sk = d.sk;
        const apps = skAndroidApps();
        const appLabel = (pkg) => (pkg === 'default' ? 'Default (all other programs)' : (apps.find((x) => x.pkg === pkg) || { label: pkg }).label);
        const profs = ['default'].concat(Object.keys(sk.profiles).filter((k) => k !== 'default').sort((x, y) => appLabel(x).localeCompare(appLabel(y))));
        if (!sk.profiles[sk.prof]) sk.prof = 'default';
        const prof = sk.profiles[sk.prof];
        const key = prof[sk.sel] || (prof[sk.sel] = { action: SK_DEFAULT[sk.sel], label: '' });
        const keyText = (k) => (k.action === 'ownmenu' ? `Menu (${(k.menu || []).filter((r) => r.action !== 'sep').length} items)` : skActionText(k.action));
        const adds = apps.filter((x) => !sk.profiles[x.pkg]);
        let menuHtml = '';
        if (key.action === 'ownmenu') {
            const items = key.menu || (key.menu = []);
            if (sk.msel >= items.length) sk.msel = items.length - 1;
            const it = items[sk.msel];
            menuHtml = `${ui.sub('Menu')}
                ${ui.listbox(items.map((r, i) => ({ key: String(i), label: r.action === 'sep' ? '— Separator —' : (r.label ? `${r.label} (${skActionText(r.action)})` : skActionText(r.action)), selected: i === sk.msel })), { maxHeight: 120 })}
                ${ui.buttons([['skm-add', 'Add'], ['skm-sep', 'Add Separator'], ['skm-del', 'Remove', !it], ['skm-up', 'Move Up', !it || sk.msel === 0], ['skm-down', 'Move Down', !it || sk.msel === items.length - 1]])}
                ${it && it.action !== 'sep' ? (() => { const h = skActionHtml('skm', it.action, '', true); return `${ui.row('Item name:', ui.edit('', it.label || '', `data-f="skm-name" maxlength="40" placeholder="${esc(skDefaultName(it.action) || skActionText(it.action))}"`), { wide: true })}${ui.row('Item action:', h.main, { wide: true })}${h.more}`; })() : ''}`;
        }
        el.innerHTML = `<p class="wmsp-step">Soft keys over Android programs. Program:</p>
            ${ui.comboHtml('sk-prof', appLabel(sk.prof))}
            <div class="wm-form-row is-wide"><span class="wm-form-label">Add:</span>${ui.comboHtml('sk-add', adds.length ? 'Choose a program...' : '(none)', !adds.length)}</div>
            ${ui.buttons([['sk-remove', 'Remove Program', sk.prof === 'default']])}
            <p class="wmsp-step">1. Select a soft key:</p>
            <div class="wmsp-btn-list" role="listbox" aria-label="Soft keys">
                <div class="wmsp-btn-head"><span>Soft key</span><span>Assignment</span></div>
                ${SK_SIDES.map(([side, label]) => { const k = prof[side] || { action: SK_DEFAULT[side] }; return `<button type="button" class="wmsp-btn-row${side === sk.sel ? ' is-selected' : ''}" role="option" aria-selected="${side === sk.sel}" data-side="${side}">
                    <span class="wmsp-btn-name"><span>${esc(label)}</span></span><span class="wmsp-btn-assign">${esc(k.label ? `${k.label}: ${keyText(k)}` : keyText(k))}</span></button>`; }).join('')}
            </div>
            <p class="wmsp-step">2. Assign an action:</p>
            ${skActionHtml('sk', key.action, sk.sel)}
            ${ui.row('Name:', ui.edit('', key.label || '', `data-f="sk-name" maxlength="24" placeholder="${esc(skDefaultName(key.action))}"`), { wide: true })}
            ${menuHtml}
            ${sk.prof === 'default' ? '' : `${ui.sub('Full screen')}
            ${ui.check('sk-keep-status', 'Keep the title bar when this program fills the screen', !!(sk.keep[sk.prof] && sk.keep[sk.prof].status))}
            ${ui.check('sk-keep-soft', 'Keep the soft key bar when this program fills the screen', !!(sk.keep[sk.prof] && sk.keep[sk.prof].soft))}
            ${ui.note('A program that hides the phone\'s bars (the camera) hides these too. Keep the soft key bar to always have a way out of it.')}`}
            ${ui.gap()}
            <p class="wmsp-step">Hold the Center button to:</p>
            ${ui.comboHtml('hold', (SK_HOLD.find(([k]) => k === d.hold) || SK_HOLD[0])[1])}`;
        ui.bindCombo(el.querySelector('[data-act="sk-prof"]'), profs.map((k) => [k, appLabel(k)]), sk.prof, (v) => { sk.prof = v; sk.msel = 0; api.rerender(); });
        ui.bindCombo(el.querySelector('[data-act="sk-add"]'), adds.map((x) => [x.pkg, x.label]), '', (v) => {
            // a new program starts as a copy of Default
            sk.profiles[v] = JSON.parse(JSON.stringify(sk.profiles.default));
            sk.prof = v; sk.msel = 0;
            api.rerender();
        });
        const rm = el.querySelector('[data-act="sk-remove"]');
        if (rm) rm.addEventListener('click', () => { if (sk.prof !== 'default') { delete sk.profiles[sk.prof]; delete sk.keep[sk.prof]; sk.prof = 'default'; api.rerender(); } });
        el.querySelectorAll('.wmsp-btn-row').forEach((r) => r.addEventListener('click', () => { sk.sel = r.dataset.side; sk.msel = 0; api.rerender(); }));
        skActionBind(el, 'sk', key.action, sk.sel, (v) => { key.action = v; if (v === 'ownmenu' && !key.menu) key.menu = []; }, api.rerender);
        const name = el.querySelector('[data-f="sk-name"]');
        if (name) name.addEventListener('input', () => { key.label = name.value.slice(0, 24); });
        // this program's bars kept over full screen (Yukimi, Nov 23 2026: "applications that do not hide the status bar or
        // the soft key bar. For example, camera"): the app's Bars config keepBars { <package>: { status, soft } }
        for (const [id, field] of [['sk-keep-status', 'status'], ['sk-keep-soft', 'soft']]) {
            const box = el.querySelector(`#${id}, input[data-k="${id}"], input[name="${id}"]`);
            if (box) box.addEventListener('change', () => { const k = sk.keep[sk.prof] || (sk.keep[sk.prof] = { status: false, soft: false }); k[field] = box.checked; });
        }
        ui.bindCombo(el.querySelector('[data-act="hold"]'), SK_HOLD, d.hold, (v) => { d.hold = v; });
        if (key.action !== 'ownmenu') return;
        const items = key.menu;
        ui.bindListbox(el.querySelector('.wm-listbox'), (k) => { sk.msel = Number(k); api.rerender(); });
        const on = (act, fn) => { const b = el.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', fn); };
        const insert = (row) => { const at = Math.min(items.length, sk.msel + 1); items.splice(at, 0, row); sk.msel = at; api.rerender(); };
        on('skm-add', () => insert({ label: '', action: 'combo:KEYCODE_CTRL_LEFT+KEYCODE_Z' }));
        on('skm-sep', () => insert({ label: '-', action: 'sep' }));
        on('skm-del', () => { items.splice(sk.msel, 1); sk.msel = Math.max(0, sk.msel - 1); api.rerender(); });
        const move = (by) => { const j = sk.msel + by; if (j < 0 || j >= items.length) return; [items[sk.msel], items[j]] = [items[j], items[sk.msel]]; sk.msel = j; api.rerender(); };
        on('skm-up', () => move(-1));
        on('skm-down', () => move(1));
        const it = items[sk.msel];
        if (it && it.action !== 'sep') {
            const nm = el.querySelector('[data-f="skm-name"]');
            if (nm) nm.addEventListener('input', () => { it.label = nm.value.slice(0, 40); });
            skActionBind(el, 'skm', it.action, '', (v) => { it.action = v; }, api.rerender);
        }
    }
    const SK_HOLD = [['freeform', 'Open the program as a pop-up window'], ['split', 'Open the program in split screen']];

    wmSettings.registerPage({
        id: 'buttons', tab: 'personal', label: 'Buttons', icon: 'set-buttons',
        // (the app's bridge is there from the page's start)
        tabs: [['program', 'Program Buttons'], ...(QA() ? [['quickaccess', 'Quick Access']] : []), ...(window.AndroidBars ? [['softkey', 'Soft Key Bar']] : [])],
        available: () => !!KEYS(),
        init() {
            const v = KEYS().get();
            const c = QA() ? qaRead('config') : null;
            const qa = c ? { enabled: !!c.enabled, side: c.side || 'right', anchor: c.anchor === 'bottom' ? 'bottom' : 'top', zoneTop: Number(c.zoneTop) || 0.35, zoneHeight: Math.min(0.15, Number(c.zoneHeight) || 0.1), layout: c.layout || 'strip', columns: Number(c.columns) || 1, items: (c.items || []).slice() } : null;
            // the soft key bar's centre button held (#1013, Yukimi Nov 22: "open the current app as freeform or split view
            // (config in buttons settins)"): the app's Bars config holdAction
            let hold = 'freeform';
            try { const st = JSON.parse(window.AndroidBars.getState()); if (st && st.config && st.config.holdAction === 'split') hold = 'split'; } catch (_) { /* no app */ }
            // (keep: the programs whose bars stay over full screen, the app's Bars config keepBars)
            let keep = {};
            try { const st = JSON.parse(window.AndroidBars.getState()); if (st && st.config && st.config.keepBars && typeof st.config.keepBars === 'object') keep = JSON.parse(JSON.stringify(st.config.keepBars)); } catch (_) { /* no app */ }
            const sk = window.AndroidBars ? { profiles: skLoad(), prof: 'default', sel: 'left', msel: 0, keep } : null;
            return { v: { ...v }, saved: { ...v }, sel: 'left', qa, qaSaved: qa ? JSON.stringify(qa) : '', qaSel: null, hold, holdSaved: hold, sk, skSaved: sk ? JSON.stringify(sk.profiles) : '', keepSaved: JSON.stringify(keep) };
        },
        render(el, tab, d, api) {
            if (tab === 'quickaccess' && d.qa) { qaRender(el, d, api); return; }
            if (tab === 'softkey' && d.sk) { skRender(el, d, api); return; }
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
            if (d.qa && JSON.stringify(d.qa) !== d.qaSaved) { try { QA().setConfig(JSON.stringify(d.qa)); } catch (_) { /* older app */ } if (window.wmShell && window.wmShell.quickAccessLayouts) window.wmShell.quickAccessLayouts(); }
            if (d.hold !== d.holdSaved) { try { window.AndroidBars.setConfig(JSON.stringify({ holdAction: d.hold })); } catch (_) { /* older app */ } }
            if (d.sk && JSON.stringify(d.sk.keep) !== d.keepSaved) { try { window.AndroidBars.setConfig(JSON.stringify({ keepBars: d.sk.keep })); } catch (_) { /* older app */ } }
            // the soft keys per program (#1067): the app applies them; the kit is made again for the menus' drawings
            if (d.sk && JSON.stringify(d.sk.profiles) !== d.skSaved) {
                const clean = {};
                Object.keys(d.sk.profiles).forEach((k) => {
                    const p = d.sk.profiles[k];
                    clean[k] = {};
                    SK_SIDES.forEach(([side]) => {
                        const key = p[side] || { action: SK_DEFAULT[side] };
                        clean[k][side] = { action: key.action, label: String(key.label || '').trim() };
                        if (key.action === 'ownmenu') clean[k][side].menu = (key.menu || []).map((r) => ({ label: r.action === 'sep' ? '-' : String(r.label || '').trim() || skDefaultName(r.action) || skActionText(r.action), action: r.action }));
                    });
                });
                try { window.AndroidBars.setConfig(JSON.stringify({ softProfiles: clean })); } catch (_) { /* older app */ }
                try { if (window.melatonBars && typeof window.melatonBars.kitChanged === 'function') window.melatonBars.kitChanged(); } catch (_) { /* no bars */ }
            }
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
            // WM's Open dialog (fileOpenPicker.js), Browse device... in Menu
            el.querySelector('[data-act="browse"]').addEventListener('click', () => void (window.fileOpenPicker ? window.fileOpenPicker.open(input, { title: 'Picture' }) : input.click()));
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
