/**
 * Melaton Mobile Settings: Personal pages (Sounds & Notifications, Input, Lock, Owner Information, Screen accessibility, Workspace) (Yozora #709).
 * Pages for the Settings app (wmPrograms.js), added through window.wmSettings.registerPage /
 * extendPage and drawn with window.wmSettings.ui so they look like WM 6.1's own pages. Every
 * value is read and saved through the desktop's own store (one source of truth):
 *
 *   Sounds & Notifications  desktopPersonalization (soundScheme, sounds, startupSound; the Sound
 *                           dialog's Sounds tab), desktopSounds.playFile (Test), Dovecote's mail
 *                           options (window.dovecoteMailSettings), the notification area's
 *                           Customize Notifications (trayRegistry.js: hidden popups, minimum time)
 *                           and the Android Notification Bridge (persistUserGlobalSettingsPatch,
 *                           as taskbarProperties.js saves it)
 *   Input                   the Keyboard page's virtual keyboard (setDesktopVirtualKeyboardEnabled)
 *                           and SmartText + the spell checker (autofillSettings.js,
 *                           saveAutofillSearchSettingsToServer: one server write on ok)
 *   Lock                    the workspace's screen saver { id, wait, resumeLogon }
 *                           (desktopPersonalization.update) and the account PIN state (read only)
 *   Owner Information       + Picture: the account picture (wsClient.setAccountPicture, as User
 *                           Accounts; meletonAccounts follows)
 *   Screen                  + Accessibility: Ease of Access Center's registry key
 *                           (melatonRegistry, melatonAccessibility.apply)
 *   Workspace               Theme Settings' Themes tab (another workspace's look, copied whole) and
 *                           the accent colour + Window Color and Appearance's swatches
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
    /* global trayPopupCatalog, trayPopupHidden, traySetPopupHidden, trayMinPopupMs, traySetMinPopupMs,
       trayPopupTimeChoices, isAndroidNotificationBridgeDetected, readDesktopSettingsNotificationBridgeEnabledPreference,
       readDesktopSettingsBypassNotificationBridgeDesktopPreference, desktopSettingsGlobalState,
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

    // WM's "Enable sounds for" groups, over the same per-event sounds: a group off gives each of its
    // events (None); on again takes the (None) back to the scheme's sound (a chosen file stays)
    const NOTIFY_EVENTS = ['notify', 'balloon', 'print-complete'];
    const groupEvents = (group) => {
        const groups = eventGroups();
        if (group === 'notifications') return NOTIFY_EVENTS.slice();
        if (group === 'programs') return groups.filter((g) => g.name !== 'Melaton').flatMap((g) => g.events.map(([id]) => id));
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

    function setGroup(d, group, on) {
        for (const id of groupEvents(group)) {
            if (on) { if (d.sounds[id] === '') delete d.sounds[id]; } else d.sounds[id] = '';
        }
    }

    function eventList(d) {
        const rows = [];
        for (const g of eventGroups()) for (const [id, label] of g.events) rows.push({ key: `s:${id}`, label: `${g.name}: ${label}` });
        if (d.mail) rows.push({ key: 'mail', label: 'Dovecote: New mail' });
        for (const p of d.popups) rows.push({ key: `n:${p.id}`, label: `Notification: ${p.label}` });
        return rows;
    }

    function readSounds() {
        const p = P().get();
        const s = S();
        // the browser-wide switch (desktopSounds.setEnabled) off reads as No Sounds, as on the desktop
        const masterOff = !!(s && typeof s.isEnabled === 'function' && !s.isEnabled());
        const mailApi = window.dovecoteMailSettings;
        const popups = fn('trayPopupCatalog') ? call('trayPopupCatalog') : [];
        const hidden = {};
        popups.forEach((r) => { hidden[r.id] = call('trayPopupHidden', r.id) === true; });
        const detected = call('isAndroidNotificationBridgeDetected') === true;
        const d = {
            scheme: masterOff ? 'none' : p.soundScheme,
            sounds: { ...p.sounds },
            startupSound: p.startupSound !== false,
            mail: mailApi && typeof mailApi.soundOn === 'function' ? { sound: !!mailApi.soundOn(), notify: !!mailApi.notifyOn() } : null,
            popups,
            hidden,
            minMs: fn('trayMinPopupMs') ? Number(call('trayMinPopupMs')) : 8000,
            bridge: detected ? {
                on: call('readDesktopSettingsNotificationBridgeEnabledPreference') !== false,
                bypass: call('readDesktopSettingsBypassNotificationBridgeDesktopPreference') === true
            } : null,
            sel: ''
        };
        d.sel = eventList(d)[0] ? eventList(d)[0].key : '';
        d.saved = JSON.parse(JSON.stringify({ scheme: d.scheme, sounds: d.sounds, startupSound: d.startupSound, mail: d.mail, hidden: d.hidden, minMs: d.minMs, bridge: d.bridge }));
        return d;
    }

    function renderSoundsTab(el, d, api) {
        const none = d.scheme === 'none';
        const modified = !none && soundsModified(d);
        const schemes = [['default', 'Melaton Default'], ['none', 'No Sounds']];
        if (modified) schemes.splice(1, 0, ['modified', 'Melaton Default (modified)']);
        const cur = none ? 'none' : (modified ? 'modified' : 'default');
        const programs = groupOn(d, 'programs');
        el.innerHTML = `${ui.sub('Enable sounds for')}
            ${ui.check('grp-system', 'Events (warnings, system events)', groupOn(d, 'system'), `data-grp="system"${none ? ' disabled' : ''}`)}
            ${ui.check('grp-programs', 'Programs', programs, `data-grp="programs"${none ? ' disabled' : ''}`)}
            ${checkIn('grp-notifications', 'Notifications (mail, prints, balloons)', groupOn(d, 'notifications'), `data-grp="notifications"${none || !programs ? ' disabled' : ''}`)}
            ${ui.gap()}
            ${ui.row('Sound scheme:', ui.comboHtml('scheme', (schemes.find(([v]) => v === cur) || schemes[0])[1]), { wide: true })}
            ${ui.check('startup', 'Play Melaton Startup sound', d.startupSound, none ? 'disabled' : '')}
            ${ui.gap()}
            ${ui.note('The sound scheme of this workspace, shared with the desktop. Each event\'s sound is on the Notifications tab.')}`;
        el.querySelectorAll('input[data-grp]').forEach((c) => c.addEventListener('change', () => {
            setGroup(d, c.dataset.grp, c.checked);
            api.rerender();
        }));
        ui.bindCombo(el.querySelector('[data-act="scheme"]'), schemes, cur, (v) => {
            if (v === 'modified') return;
            // as the Sound dialog: picking the scheme starts from its own sounds
            if (v === 'none') d.scheme = 'none';
            else { d.scheme = 'default'; d.sounds = {}; }
            api.rerender();
        });
        el.querySelector('input[name="startup"]').addEventListener('change', (e) => { d.startupSound = e.target.checked; });
    }

    function renderNotifyTab(el, d, api) {
        const rows = eventList(d);
        if (!rows.some((r) => r.key === d.sel) && rows[0]) d.sel = rows[0].key;
        const sel = rows.find((r) => r.key === d.sel) || { key: '', label: '' };
        const s = S();
        const files = [['', '(None)']].concat(((s && s.FILES) || []).map((f) => [f, soundName(f)]));
        const none = d.scheme === 'none';
        const soundRow = (id, on, checkName, label, disabled) => {
            const file = on ? eventFile(d, id) : '';
            const shown = files.find(([f]) => f === file) || files[0];
            return `${ui.check(checkName, label, on, disabled ? 'disabled' : '')}
                <div class="wmsp-indent wmsp-sound-row">${ui.comboHtml('file', shown[1], disabled || !on)}
                    <button type="button" class="wm-button wmsp-play" data-act="play" aria-label="Play"${disabled || !file ? ' disabled' : ''}></button></div>`;
        };
        let body = '';
        if (sel.key.startsWith('s:')) {
            const id = sel.key.slice(2);
            body = soundRow(id, !none && eventFile(d, id) !== '', 'play-on', 'Play sound', none)
                + (none ? ui.note('Sounds are off: pick Melaton Default on the Sounds tab.') : '');
        } else if (sel.key === 'mail') {
            // Dovecote's own options (Control Panel Mail): its sound is the New Mail Notification event
            body = soundRow('notify', d.mail.sound && !none && eventFile(d, 'notify') !== '', 'play-on', 'Play sound', none)
                + ui.check('msg-on', 'Display message on screen', d.mail.notify);
        } else if (sel.key.startsWith('n:')) {
            const id = sel.key.slice(2);
            body = ui.check('msg-on', 'Display message on screen', !d.hidden[id])
                + ui.note('This notification has no sound of its own.');
        }
        const times = fn('trayPopupTimeChoices') ? call('trayPopupTimeChoices').map((c) => [Number(c.value), c.text]) : [[8000, '8 seconds']];
        if (!times.some(([v]) => v === d.minMs)) times.push([d.minMs, `${Math.round(d.minMs / 1000)} seconds`]);
        el.innerHTML = `${ui.row('Event:', ui.comboHtml('event', sel.label))}
            <div class="wmsp-event">${body}</div>
            ${ui.gap()}
            ${ui.sub('All notifications')}
            ${ui.row('Show for at least:', ui.comboHtml('mintime', (times.find(([v]) => v === d.minMs) || times[0])[1]), { wide: true })}
            ${d.bridge ? `${ui.check('bridge-on', 'Send notifications to the Android Notification Bridge', d.bridge.on)}
                ${checkIn('bridge-bypass', 'On the desktop, show them here instead', d.bridge.bypass, d.bridge.on ? '' : 'disabled')}` : ''}`;
        ui.bindCombo(el.querySelector('[data-act="event"]'), rows.map((r) => [r.key, r.label]), d.sel, (v) => { d.sel = v; api.rerender(); });
        ui.bindCombo(el.querySelector('[data-act="mintime"]'), times, d.minMs, (v) => { d.minMs = v; });
        const evId = sel.key === 'mail' ? 'notify' : (sel.key.startsWith('s:') ? sel.key.slice(2) : '');
        const playOn = el.querySelector('input[name="play-on"]');
        if (playOn) {
            playOn.addEventListener('change', () => {
                if (sel.key === 'mail') {
                    d.mail.sound = playOn.checked;
                    // the mail sound needs the New Mail event to have one
                    if (playOn.checked && eventFile(d, 'notify') === '') delete d.sounds.notify;
                } else if (playOn.checked) {
                    if (d.sounds[evId] === '') delete d.sounds[evId];
                    if (eventFile(d, evId) === '') d.sounds[evId] = 'Windows Default.wav';
                } else {
                    d.sounds[evId] = '';
                }
                api.rerender();
            });
        }
        ui.bindCombo(el.querySelector('[data-act="file"]'), files, evId ? eventFile(d, evId) : '', (file) => {
            const sch = S() && S().SCHEME;
            if (sch && sch[evId] === file) delete d.sounds[evId];
            else d.sounds[evId] = file;
            // the Sound dialog plays the new choice
            if (file && S()) S().playFile(file);
            api.rerender();
        });
        const play = el.querySelector('[data-act="play"]');
        if (play) play.addEventListener('click', () => { const f = eventFile(d, evId); if (f && S()) S().playFile(f); });
        const msg = el.querySelector('input[name="msg-on"]');
        if (msg) {
            msg.addEventListener('change', () => {
                if (sel.key === 'mail') d.mail.notify = msg.checked;
                else d.hidden[sel.key.slice(2)] = !msg.checked;
            });
        }
        const bOn = el.querySelector('input[name="bridge-on"]');
        if (bOn) bOn.addEventListener('change', () => { d.bridge.on = bOn.checked; api.rerender(); });
        const bBy = el.querySelector('input[name="bridge-bypass"]');
        if (bBy) bBy.addEventListener('change', () => { d.bridge.bypass = bBy.checked; });
    }

    async function commitSounds(d) {
        const v = d.saved;
        const p = P();
        const s = S();
        if (d.scheme !== v.scheme || !same(d.sounds, v.sounds) || d.startupSound !== v.startupSound) {
            p.update({ soundScheme: d.scheme, sounds: { ...d.sounds }, startupSound: d.startupSound });
            // choosing a scheme turns the browser-wide switch back on (the Sound dialog's Apply)
            if (d.scheme !== 'none' && s && typeof s.isEnabled === 'function' && !s.isEnabled()) s.setEnabled(true);
        }
        const mailApi = window.dovecoteMailSettings;
        if (d.mail && mailApi) {
            if (d.mail.sound !== v.mail.sound) mailApi.setSound(d.mail.sound);
            if (d.mail.notify !== v.mail.notify) mailApi.setNotify(d.mail.notify);
        }
        if (fn('traySetPopupHidden')) Object.keys(d.hidden).forEach((id) => { if (d.hidden[id] !== v.hidden[id]) call('traySetPopupHidden', id, d.hidden[id]); });
        if (d.minMs !== v.minMs) call('traySetMinPopupMs', d.minMs);
        if (d.bridge && v.bridge && (d.bridge.on !== v.bridge.on || d.bridge.bypass !== v.bridge.bypass)) {
            // as Taskbar and Start Menu Properties' Customize Notifications: the server-held pair
            const desktop = { notificationBridgeEnabled: d.bridge.on, bypassNotificationBridgeInDesktopMode: d.bridge.bypass };
            try {
                const gs = typeof desktopSettingsGlobalState !== 'undefined' ? desktopSettingsGlobalState : null;
                if (gs) { gs.notificationBridgeEnabled = d.bridge.on; gs.bypassNotificationBridgeInDesktopMode = d.bridge.bypass; }
                if (fn('persistUserGlobalSettingsPatch')) await call('persistUserGlobalSettingsPatch', { desktop });
            } catch (err) {
                await box({ title: 'Sounds & Notifications', icon: 'error', text: (err && err.message) || 'The notification bridge setting could not be saved.' });
                return false;
            }
        }
        return [];
    }

    wmSettings.registerPage({
        id: 'sounds', tab: 'personal', label: 'Sounds & Notifications', icon: 'set-sounds',
        tabs: [['sounds', 'Sounds'], ['notifications', 'Notifications']],
        available: () => !!(P() && typeof P().get === 'function' && typeof P().update === 'function'),
        init: readSounds,
        render(el, tab, d, api) {
            if (tab === 'notifications') renderNotifyTab(el, d, api);
            else renderSoundsTab(el, d, api);
        },
        commit: commitSounds
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
                ${ui.note('Melaton Keyboard replaces the system keyboard on the desktop (Control Panel > Keyboard). Melaton Mobile always uses the phone\'s own keyboard.')}`;
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

    wmSettings.registerPage({
        id: 'lock', tab: 'personal', label: 'Lock', icon: 'set-lock',
        tabs: [['password', 'Password']],
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
        commit(d) {
            const next = { id: d.on ? d.id : 'none', wait: d.wait, resumeLogon: d.resumeLogon };
            if (!same(next, d.saved)) P().update({ screenSaver: next });
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

    // ======================================================================== Workspace

    const wsList = () => (typeof workspaces !== 'undefined' && workspaces ? workspaces : null);
    const wsActive = () => (typeof activeWorkspace !== 'undefined' && activeWorkspace) || window.currentWorkspace || 'default';

    /** A workspace's desktop background (the Theme Settings sample, personalizationDialogs.js). */
    function wallpaperUrlFor(w) {
        const path = w && w.wallpaper;
        if (!path) return '/static_images/wallpapers/aurora.webp';
        const [type, ...rest] = String(path).split(':');
        const id = rest.join(':');
        switch (type) {
            case 'url': return /^(\/|https?:)/.test(id) ? id : '';
            case 'wallpaper': return `/cache/wallpapers/${encodeURIComponent(`${id}.png`)}`;
            case 'file': return fn('localGalleryImageUrl') ? call('localGalleryImageUrl', id) : `/images/${encodeURIComponent(id)}`;
            case 'cache': return fn('localCacheUploadUrl') ? call('localCacheUploadUrl', id) : '';
            case 'cache-preview': return fn('localCachePreviewUrl') ? call('localCachePreviewUrl', id) : '';
            case 'vibe': return `/cache/vibe/${id}`;
            default: return '/static_images/wallpapers/aurora.webp';
        }
    }

    const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;

    wmSettings.registerPage({
        id: 'workspace', tab: 'personal', label: 'Workspace', icon: 'set-workspace',
        tabs: [['theme', 'Theme'], ['color', 'Color']],
        available: () => !!(wsList() && P() && ws() && typeof ws().updateWorkspaceSettings === 'function'),
        init() {
            const id = wsActive();
            const w = wsList()[id] || {};
            const p = P().get();
            const d = { id, theme: '', color: w.color || '#102040', windowColor: p.windowColor, intensity: p.intensity, transparency: p.transparency };
            d.saved = { color: d.color, windowColor: d.windowColor, intensity: d.intensity, transparency: d.transparency };
            return d;
        },
        render(el, tab, d, api) {
            const list = wsList() || {};
            if (tab === 'color') {
                const pp = P();
                const sws = (pp.SWATCHES || []).filter((s) => s.id !== 'custom');
                const custom = d.windowColor === 'custom';
                const steps = [];
                for (let i = pp.INTENSITY_MIN || 10; i <= (pp.INTENSITY_MAX || 85); i += 5) steps.push(i);
                if (!steps.includes(d.intensity)) { steps.push(d.intensity); steps.sort((a, b) => a - b); }
                const wsColor = (list[d.id] && (list[d.id].backgroundColor || list[d.id].color)) || '#0a1a2a';
                el.innerHTML = `${ui.row('Accent color:', `<label class="wmsp-color"><input type="color" value="${esc(d.color)}" data-f="accent"><span>${esc(d.color.toUpperCase())}</span></label>`, { wide: true })}
                    ${ui.note('The phone\'s title bars and highlights follow the accent color.')}
                    ${ui.sub('Window color (desktop)')}
                    <div class="wm-picker is-icons wmsp-swatches">${sws.map((s) => `<button type="button" class="wm-picker-cell${d.windowColor === s.id ? ' is-selected' : ''}" data-sw="${esc(s.id)}" title="${esc(s.name)}" aria-label="${esc(s.name)}">${s.id === 'workspace'
                        ? `<span class="wmsp-swatch-ws" style="background:${esc(wsColor)}"></span>`
                        : `<img src="/static_images/vista-personalization/swatch-${esc(s.id)}.png" alt="" draggable="false">`}</button>`).join('')}</div>
                    ${custom ? ui.note('A custom color from the desktop\'s color mixer is in use.') : ''}
                    <div data-f="intensity"></div>
                    ${ui.check('transparency', 'Enable transparency', d.transparency)}`;
                const accent = el.querySelector('[data-f="accent"]');
                accent.addEventListener('input', () => { d.color = accent.value; accent.nextElementSibling.textContent = accent.value.toUpperCase(); });
                el.querySelectorAll('[data-sw]').forEach((b) => b.addEventListener('click', () => {
                    d.windowColor = b.dataset.sw;
                    // Vista: a swatch brings its own intensity
                    const def = pp.swatch(d.windowColor);
                    if (def && def.intensity) d.intensity = def.intensity;
                    api.rerender();
                }));
                const host = el.querySelector('[data-f="intensity"]');
                host.insertAdjacentHTML('beforeend', ui.sub('Color intensity'));
                ui.trackbar(host, { steps, value: d.intensity, lo: 'Low', hi: 'High', label: 'Color intensity', onChange: (v) => { d.intensity = v; } });
                el.querySelector('input[name="transparency"]').addEventListener('change', (e) => { d.transparency = e.target.checked; });
                return;
            }
            const rows = [{ key: '', label: `${(list[d.id] && list[d.id].name) || 'This workspace'} (current)` }]
                .concat(Object.keys(list).filter((k) => k !== d.id).map((k) => ({ key: k, label: list[k].name || k })));
            el.innerHTML = `${ui.text('Select a theme for this workspace:')}
                <div class="wm-listbox-side">
                    ${ui.listbox(rows.map((r) => ({ ...r, selected: r.key === d.theme })), { maxHeight: 190 })}
                    <div class="wm-preview-box" data-f="preview"></div>
                </div>
                ${ui.gap()}
                ${ui.note('Another workspace\'s theme copies its colors, fonts, desktop background, window color, sounds and screen saver to this workspace.')}`;
            const prev = el.querySelector('[data-f="preview"]');
            const url = wallpaperUrlFor(list[d.theme || d.id]);
            if (url) prev.style.backgroundImage = cssUrl(url);
            ui.bindListbox(el.querySelector('.wm-listbox'), (key) => {
                d.theme = key;
                const u = wallpaperUrlFor(list[d.theme || d.id]);
                prev.style.backgroundImage = u ? cssUrl(u) : '';
            });
            const sel = el.querySelector('.wm-listbox-row.is-selected');
            if (sel) sel.scrollIntoView({ block: 'nearest' });
        },
        async commit(d) {
            const list = wsList() || {};
            const client = ws();
            const pp = P();
            const settings = {};
            let look = null;
            if (d.theme && list[d.theme]) {
                // Theme Settings' Apply (personalizationDialogs.js applyTheme): another workspace's look, copied whole
                const src = list[d.theme];
                ['color', 'backgroundColor', 'primaryFont', 'textareaFont', 'wallpaper', 'wallpaperPosition'].forEach((k) => {
                    settings[k] = src[k] === undefined ? null : src[k];
                });
                look = pp.read(d.theme);
                settings.personalization = look;
            } else if (d.color !== d.saved.color) {
                settings.color = d.color;
            }
            if (Object.keys(settings).length) {
                try {
                    // the server's settings_updated broadcast repaints this workspace (workspaceUtils.js)
                    await client.updateWorkspaceSettings(d.id, settings);
                } catch (err) {
                    await box({ title: 'Workspace', icon: 'error', text: `The theme could not be saved: ${(err && err.message) || err}` });
                    return false;
                }
                if (look) { pp.update(look, { id: d.id }); return []; }
            }
            const win = { windowColor: d.windowColor, intensity: d.intensity, transparency: d.transparency };
            if (!same(win, { windowColor: d.saved.windowColor, intensity: d.saved.intensity, transparency: d.saved.transparency })) {
                // Window Color and Appearance's OK: the page's own fields only
                pp.update(win, { save: true });
            }
            return [];
        }
    });
})();
