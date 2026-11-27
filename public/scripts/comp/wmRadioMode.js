/**
 * Melaton Mobile Settings > Connections > Wireless Manager > Network Mode (Yozora #1328): the cellular
 * network mode (NR only, Auto, LTE, ...) and the places that want one (a place, a radius, a mode; leaving
 * goes back to Auto). The Dreamscape app reads the phone, writes the mode and keeps the geofences
 * (window.AndroidDevice, DSApp DeviceControl); this page only shows and edits. Which modes exist and what
 * their masks are is CafeTasks.lib.radio (public/scripts/tasks/radio-mode.js), looked up when used: it may
 * load after this file. Places come from the location service (wmLocation: Home, Work, the lookup, a fix).
 * Styles: public/css/wm-radio-mode.css. Runs only on Melaton Mobile; an app without getRadioMode has
 * neither the Wireless Manager bar nor this page.
 *
 *   window.wmRadioMode.available() -> whether the app has the network mode bridge
 *   window.wmRadioMode.row()       -> { text, busy }  the Wireless Manager state box
 *   window.wmRadioMode.open()      -> opens the page
 *   window.wmRadioMode.refresh()   -> asks the app to read the phone (the answer: 'dreamscape:radiomode')
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.registerPage !== 'function') return;

    const ui = wmSettings.ui;
    const esc = ui.esc;
    const root = window;
    const PAGE_ID = 'radio-mode';
    const PICKER_APP = 'wm-location-pick';
    const MAX_RULES = 20;
    const DEFAULT_RADIUS_M = 300;
    const FOOT_M = 0.3048;
    // a saved point this close to Home / Work is shown as Home / Work
    const SAME_PLACE_M = 30;

    const shell = () => root.wmShell || null;
    const lib = () => (root.CafeTasks && root.CafeTasks.lib && root.CafeTasks.lib.radio) || null;
    const bridge = () => (root.AndroidDevice && typeof root.AndroidDevice.getRadioMode === 'function' ? root.AndroidDevice : null);
    const places = () => (root.wmLocation ? root.wmLocation.places() : { home: null, work: null });

    function read() {
        const b = bridge();
        if (!b) return null;
        try {
            const s = JSON.parse(b.getRadioMode());
            return s && typeof s === 'object' ? s : null;
        } catch (_) { return null; }
    }

    function refresh() {
        const b = bridge();
        if (b && typeof b.refreshRadioMode === 'function') { try { b.refreshRadioMode(); } catch (_) { /* the bar keeps what it has */ } }
    }

    // ---------------------------------------------------------------- what is shown

    const rulesOf = (s) => (s && Array.isArray(s.rules) ? s.rules : []);
    const currentMode = (s) => { const L = lib(); return L && s ? L.modeOf(s.current, s.supported, s.baseline) : null; };
    const modeText = (id) => (id === 'other' ? 'Other' : id ? lib().label(id) : 'Unknown');
    const offered = (s) => { const L = lib(); return L && s && s.supported ? L.modes(s.supported) : []; };
    const forcedModes = (s) => offered(s).filter((m) => m.id !== 'auto');

    /** The place whose rule the phone is on now: the app applied it and the phone still reads that mode. */
    function placeInForce(s) {
        const a = s && s.applied;
        if (!a || !a.ruleId || a.mode !== currentMode(s)) return '';
        const rule = rulesOf(s).find((r) => r.id === a.ruleId);
        return a.name || (rule && rule.name) || '';
    }

    function row() {
        const s = read();
        if (!s || !lib()) return { text: '', busy: false };
        // the app's own word: an ask this page never got an answer to does not keep the bar busy
        if (s.busy) return { text: op && op.checking ? 'Checking...' : 'Changing...', busy: true };
        if (!s.ready) return { text: s.error ? 'Unknown' : 'Reading...', busy: false };
        const place = placeInForce(s);
        const mode = modeText(currentMode(s));
        return { text: place ? `${mode} - ${place}` : mode, busy: false };
    }

    const metres = (m) => `${Number(m).toLocaleString('en-US')} m`;
    const radiusText = (m) => `${metres(m)} (${Math.round(m / FOOT_M).toLocaleString('en-US')} ft)`;

    function placeText(e) {
        if (e.placeText) return e.placeText;
        if (!Number.isFinite(e.lat)) return 'Choose...';
        const L = lib();
        const p = places();
        for (const [id, label] of [['home', 'Home'], ['work', 'Work']]) {
            if (p[id] && L && L.distM({ lat: e.lat, lon: e.lon }, { lat: Number(p[id].lat), lon: Number(p[id].lon) }) <= SAME_PLACE_M) return label;
        }
        return 'Saved position';
    }

    /**
     * 'ask' / 'denied' while Android does not let the app use the location in the background, else ''. With no
     * rule on, the radio fence reads 'off' either way, so the app's drive geofence (same permission) answers.
     */
    function accessNeeded(s) {
        if (s.fence === 'ask' || s.fence === 'denied') return s.fence;
        if (s.fence !== 'off') return '';
        const H = root.AndroidHome;
        if (!H || typeof H.getDriveState !== 'function') return '';
        try {
            const g = (JSON.parse(H.getDriveState() || 'null') || {}).geofence;
            return g === 'ask' || g === 'denied' ? g : '';
        } catch (_) { return ''; }
    }

    function accessBlock(s) {
        const need = accessNeeded(s);
        if (!need) return '';
        const H = root.AndroidHome;
        const can = !!(H && typeof H.requestDriveAccess === 'function');
        return `${ui.note(`Places work only when Dreamscape may use the location all the time. ${need === 'denied' ? 'Android has refused it.' : 'It is not allowed yet.'}`)}
            ${can ? ui.buttons([['access', 'Allow...']]) : ui.note('Allow it in Android\'s settings for Dreamscape.')}`;
    }

    // ---------------------------------------------------------------- the page on screen, and one operation

    let view = null; // { el, d, api, sig }: the last draw
    let live = null; // AbortController of the page's listeners
    let op = null; // { kind: 'set' | 'rules', checking, release, done(result) }: asked of the app, not answered
    let resume = null; // the draft a trip to the location lookup comes back to

    const visible = () => {
        const sh = shell();
        return !!(view && view.el.isConnected && !(sh && sh.onScreen && !sh.onScreen(view.el)));
    };

    /** Everything the open screen shows; a push that changes none of it redraws nothing (typing is left alone). */
    function signature(d, s) {
        if (!s) return 'none';
        const common = [d.view, !!lib(), s.supported, s.baseline, s.shell, s.task, accessNeeded(s), op ? op.kind : '', places()];
        if (d.view === 'edit') return JSON.stringify(common);
        return JSON.stringify(common.concat([s.ready, s.current, s.busy, s.error, rulesOf(s), s.applied, s.fence, s.fenceError]));
    }

    function repaint(force) {
        if (!view || !view.el.isConnected) { if (!op) detach(); return; }
        if (!visible()) return;
        if (!force && signature(view.d, read()) === view.sig) return;
        view.api.rerender();
    }

    function onRadioMode(e) {
        const result = e && e.detail && e.detail.result;
        if (op && result && result.op === op.kind) finish(result);
        else repaint(false);
    }
    function onSeenAgain() {
        if (document.hidden || !visible()) return;
        // back from Android's permission screen: the app reads the fence again
        if (view.d.askedAccess) refresh();
        repaint(false);
    }
    function onDrive() {
        if (view && view.d.askedAccess && visible()) { view.d.askedAccess = false; refresh(); }
        repaint(false);
    }
    const onPlaces = () => repaint(false);

    function attach() {
        if (live) return;
        live = new AbortController();
        const signal = live.signal;
        root.addEventListener('dreamscape:radiomode', onRadioMode, { signal });
        root.addEventListener('androiddrive', onDrive, { signal });
        root.addEventListener('melatonscreen', onSeenAgain, { signal });
        document.addEventListener('visibilitychange', onSeenAgain, { signal });
        document.addEventListener('wmLocationPlaces', onPlaces, { signal });
    }

    function detach() {
        if (live) live.abort();
        live = null;
    }

    function finish(result) {
        const o = op;
        if (!o) return;
        op = null;
        o.release();
        o.done(result);
    }

    /**
     * Asks the app for one change. call() is the bridge call ({ ok, pending } | { ok: false, error }); the
     * outcome comes as the event's result. done(result) runs once; the wait cursor is the shell's.
     */
    function start(kind, call, done, checking = false) {
        if (op) return;
        const sh = shell();
        const release = sh && typeof sh.busy === 'function' ? sh.busy(true, { delay: 150, timeout: 30000 }) : () => {};
        const mine = { kind, checking, release, done };
        op = mine;
        attach();
        let answer = null;
        try { answer = JSON.parse(call()); } catch (_) { answer = null; }
        if (op !== mine) return; // the event came before the call returned
        if (!answer || !answer.ok) { finish({ ok: false, error: (answer && answer.error) || 'The Dreamscape app did not answer.' }); return; }
        if (!answer.pending) { finish({ ok: true }); return; }
        repaint(true);
    }

    /** A refusal: the app's reason, as the answer to her tap. Off screen the page's own line keeps it instead. */
    async function refused(lead, error) {
        if (!visible()) return;
        const d = view.d;
        d.boxUp = true; // the page does not say the same thing under the box
        repaint(true);
        // notice: radio-mode-refused
        await ui.messageBox({ title: 'Network Mode', icon: 'warning', text: `${lead} ${error || 'The phone gave no reason.'}`, modal: true });
        d.boxUp = false;
        repaint(true);
    }

    /** A screen of this page: a new one starts at its top, the main screen comes back where it was. */
    function show(d, name) {
        const scroller = () => (view && view.el.isConnected ? view.el.closest('.wm-set-scroll') : null);
        const list = () => (view && view.el.isConnected ? view.el.querySelector('.wm-rmode-list') : null);
        if (d.view === 'main' && name !== 'main') {
            const sc = scroller();
            const lb = list();
            d.mainTop = sc ? sc.scrollTop : 0;
            d.listTop = lb ? lb.scrollTop : 0;
        }
        const same = d.view === name;
        d.view = name;
        if (!view || view.d !== d) return;
        view.api.rerender();
        if (same) return;
        const sc = scroller();
        if (sc) sc.scrollTop = name === 'main' ? d.mainTop : 0; // reset: another screen of the page
        const lb = list();
        if (lb && name === 'main') lb.scrollTop = d.listTop;
    }

    // ---------------------------------------------------------------- the mode, by hand

    async function setMode(d, id) {
        repaint(true); // the radios show what the phone is on, not the tap
        const before = read();
        if (op || !before || before.busy) return;
        if (id === 'nr') {
            // notice: radio-mode-confirm-nr
            const yes = await ui.messageBox({
                title: 'Network Mode',
                icon: 'question',
                text: 'Use NR only? Where there is no 5G, the phone may have no mobile data until you change the mode.',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            if (!yes || op || !visible()) return;
        }
        const s = read();
        const mask = s && lib() ? lib().maskFor(id, s.supported, s.baseline) : null;
        if (!mask) { await refused('The network mode was not changed.', 'This phone does not support that mode.'); return; }
        start('set', () => bridge().setRadioMode(id, mask), (result) => {
            repaint(true);
            if (!result.ok) void refused('The network mode was not changed.', result.error);
        });
    }

    // ---------------------------------------------------------------- saving the places

    /** The whole list with the masks the app needs, computed from what the phone reports. */
    function payload(s, rules) {
        const L = lib();
        const masks = {};
        L.MODES.forEach((m) => {
            if (m.id === 'auto') return;
            const mask = L.maskFor(m.id, s.supported, s.baseline);
            if (mask) masks[m.id] = mask;
        });
        return JSON.stringify({ rules, autoMask: L.autoMask(s.supported, s.baseline) || '', masks });
    }

    function saveRules(rules, lead, saved) {
        const s = read();
        if (!s || !lib()) return;
        const json = payload(s, rules);
        start('rules', () => bridge().saveRadioRules(json), (result) => {
            if (result.ok) { saved(); repaint(true); return; }
            repaint(true);
            void refused(lead, result.error);
        }, rules.some((r) => r.on));
    }

    async function deleteRule(d, id) {
        const rule = rulesOf(read()).find((r) => r.id === id);
        if (!rule || op) return;
        // notice: radio-mode-confirm-delete
        const yes = await ui.messageBox({
            title: 'Network Mode',
            icon: 'question',
            text: `Delete the place ${rule.name}?`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
        });
        if (!yes || op) return;
        // the list as it is now, not as it was when the question came up
        saveRules(rulesOf(read()).filter((r) => r.id !== id), 'The place was not deleted.', () => {
            if (d.sel === id) d.sel = null;
            if (d.view === 'edit' && d.edit && d.edit.id === id) { d.edit = null; show(d, 'main'); }
        });
    }

    // ---------------------------------------------------------------- the editor

    const editKey = (e) => JSON.stringify([String(e.name).trim(), e.lat, e.lon, e.radiusM, e.mode, !!e.on]);

    function openEditor(d, id) {
        const s = read();
        const rule = id ? rulesOf(s).find((r) => r.id === id) : null;
        if (op || (id && !rule)) return;
        const first = forcedModes(s)[0];
        const e = rule
            ? { isNew: false, id: rule.id, name: rule.name, lat: rule.lat, lon: rule.lon, radiusM: rule.radiusM, mode: rule.mode, on: !!rule.on }
            : { isNew: true, id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '', lat: null, lon: null, radiusM: DEFAULT_RADIUS_M, mode: first ? first.id : '', on: true };
        e.placeText = '';
        e.autoName = '';
        e.orig = editKey(e);
        d.edit = e;
        if (root.wmLocation) void root.wmLocation.placesReady().then(() => repaint(false));
        show(d, 'edit');
    }

    function closeEditor(d) {
        d.edit = null;
        show(d, 'main');
    }

    function say(text) {
        // notice: radio-mode-input
        void ui.messageBox({ title: 'Network Mode', icon: 'warning', text, modal: true });
    }

    /** ok on the editor: saves it; the editor stays until the app has taken it. */
    function saveEditor(d) {
        const e = d.edit;
        if (op || !e) return;
        if (editKey(e) === e.orig) { closeEditor(d); return; } // nothing changed: nothing to save
        const s = read();
        const L = lib();
        if (!s || !L) return;
        if (!String(e.name).trim()) { say('Type a name for this place.'); return; }
        if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) { say('Choose the place.'); return; }
        if (e.on && !L.maskFor(e.mode, s.supported, s.baseline)) { say('Choose a mode this phone supports.'); return; }
        const rule = L.cleanRule({ id: e.id, name: e.name, lat: e.lat, lon: e.lon, radiusM: e.radiusM, mode: e.mode, on: e.on });
        if (!rule) { say('This place cannot be saved. Check the name, the place and the mode.'); return; }
        const rules = rulesOf(s).slice();
        const at = rules.findIndex((r) => r.id === rule.id);
        if (at >= 0) rules[at] = rule;
        else rules.push(rule);
        saveRules(rules, 'The place was not saved.', () => {
            if (d.edit !== e) return;
            d.sel = rule.id;
            closeEditor(d);
        });
    }

    function placed(e, lat, lon, text, name) {
        e.lat = lat;
        e.lon = lon;
        e.placeText = text;
        // the name follows the place until she types her own
        if (name && (!e.name.trim() || e.name === e.autoName)) {
            e.name = String(name).trim().slice(0, 60);
            e.autoName = e.name;
        }
    }

    /**
     * The location service's lookup is a program of its own, and Settings coming back starts at its grid:
     * the editor is opened again with her input. Left any other way (Home), nothing is pulled back.
     */
    async function lookUp(d, e) {
        let back = null;
        const trip = new AbortController();
        document.addEventListener('wmAppChange', (ev) => { if (ev.detail && ev.detail.prev === PICKER_APP) back = ev.detail.id; }, { signal: trip.signal });
        const place = await root.wmLocation.pick({ title: 'Place', prompt: 'Enter the address or name of the place.', min: 'approximate', max: 'exact' });
        trip.abort();
        if (back !== 'settings' || d.edit !== e) return;
        if (place) placed(e, Number(place.lat), Number(place.lon), place.label, place.label);
        resume = d;
        wmSettings.open(PAGE_ID);
        resume = null;
    }

    async function choosePlace(d, kind) {
        const e = d.edit;
        const W = root.wmLocation;
        if (!e || !W || op) return;
        if (kind === 'find') { await lookUp(d, e); return; }
        if (kind === 'home' || kind === 'work') {
            const p = W.places()[kind];
            const label = kind === 'home' ? 'Home' : 'Work';
            if (p) placed(e, Number(p.lat), Number(p.lon), label, label);
            repaint(true);
            return;
        }
        const sh = shell();
        const release = sh && typeof sh.busy === 'function' ? sh.busy(true, { delay: 0, timeout: 30000 }) : () => {};
        let fix = null;
        try {
            fix = await W.get({ precision: 'exact', urgent: true, deviceOnly: true, purpose: 'Network mode place' });
        } catch (_) { fix = null; }
        release();
        if (d.edit !== e || !visible()) return;
        if (!fix) { say('The phone\'s position could not be found. Turn on location, or choose the place another way.'); return; }
        placed(e, fix.lat, fix.lon, `Here (within ${metres(Math.max(1, Math.round(fix.accuracyM || 0)))})`, '');
        repaint(true);
    }

    function placeChoices() {
        const W = root.wmLocation;
        if (!W) return [];
        const p = W.places();
        return [
            ...(p.home ? [['home', 'Home']] : []),
            ...(p.work ? [['work', 'Work']] : []),
            ['here', 'Here (where you are now)'],
            ...(W.canPick() ? [['find', 'Look up a place...']] : [])
        ];
    }

    function busyText() {
        if (!op) return 'The phone is changing its network mode.';
        if (op.kind === 'set') return 'Changing the network mode. Mobile data may pause for a moment.';
        return op.checking ? 'Checking that the phone can switch back to Auto. Mobile data may pause for a moment.' : 'Saving...';
    }
    const status = (text) => `<p class="wm-form-note" role="status">${esc(text)}</p>`;
    const allRadii = (e) => {
        const list = lib().RADII.slice();
        if (!list.includes(e.radiusM)) { list.push(e.radiusM); list.sort((a, b) => a - b); }
        return list;
    };

    function renderEdit(el, d, s) {
        const e = d.edit;
        const off = !!op;
        const dis = off ? ' disabled' : '';
        const modes = forcedModes(s);
        // a saved mode this phone does not offer stays visible, so it is not changed behind her back
        const unsupported = e.mode && !modes.some((m) => m.id === e.mode);
        el.innerHTML = `${ui.row('Name:', ui.edit('wrmName', e.name, `maxlength="60"${dis}`), { for: 'wrmName' })}
            ${ui.row('Place:', ui.comboHtml('place', placeText(e), off))}
            ${ui.row('Radius:', ui.comboHtml('radius', radiusText(e.radiusM), off))}
            ${ui.sub('Mode at this place')}
            ${modes.map((m) => ui.radio('wrmMode', m.id, m.label, e.mode === m.id, dis)).join('')}
            ${unsupported ? ui.radio('wrmMode', e.mode, `${lib().label(e.mode)} (not on this phone)`, true, 'disabled') : ''}
            ${ui.gap()}
            ${ui.check('wrmOn', 'Use this place', e.on, dis)}
            ${ui.note('When you leave the place, the phone goes back to Auto.')}
            ${off ? status(busyText()) : ''}
            ${s.task === false ? ui.note('Places need a newer Dreamscape app.') : ''}
            ${accessBlock(s)}`;
        const name = el.querySelector('#wrmName');
        name.addEventListener('input', () => { e.name = name.value; });
        const placeBtn = el.querySelector('.wm-combo[data-act="place"]');
        ui.bindCombo(placeBtn, placeChoices(), null, (v) => {
            const span = placeBtn.querySelector('span');
            if (span) span.textContent = placeText(e); // the box names the place, once there is one
            void choosePlace(d, v);
        });
        ui.bindCombo(el.querySelector('.wm-combo[data-act="radius"]'), allRadii(e).map((m) => [m, radiusText(m)]), e.radiusM, (v) => { e.radiusM = Number(v); });
        el.querySelectorAll('input[name="wrmMode"]').forEach((r) => r.addEventListener('change', () => { e.mode = r.value; }));
        el.querySelector('input[name="wrmOn"]').addEventListener('change', (ev) => { e.on = ev.target.checked; });
    }

    // ---------------------------------------------------------------- the main screen

    function ruleList(d, rules) {
        const L = lib();
        return `<div class="wm-listbox wm-rmode-list" role="listbox" aria-label="Places">${rules.map((r) => `<button type="button" class="wm-listbox-row${r.id === d.sel ? ' is-selected' : ''}" role="option" aria-selected="${r.id === d.sel}" data-key="${esc(r.id)}">
            <span class="wm-rmode-name">${esc(r.name)}</span><span class="wm-rmode-mode">${esc(L.label(r.mode))}</span><span class="wm-rmode-radius">${esc(metres(r.radiusM))}</span><span class="wm-rmode-on">${r.on ? 'On' : 'Off'}</span></button>`).join('')}</div>`;
    }

    const canAdd = (s) => !op && !s.busy && s.task !== false && forcedModes(s).length > 0 && rulesOf(s).length < MAX_RULES;

    function renderMain(el, d, s) {
        const pending = !!(op || s.busy);
        const rules = rulesOf(s);
        if (!rules.some((r) => r.id === d.sel)) d.sel = null;
        const mode = currentMode(s);
        const now = pending ? (op && op.checking ? 'Checking...' : op && op.kind === 'rules' ? 'Saving...' : 'Changing...')
            : !s.ready ? (s.error ? 'Unknown' : 'Reading...') : modeText(mode);
        const place = pending ? '' : placeInForce(s);
        const modes = offered(s);
        const noShell = s.ready && s.shell === false;
        el.innerHTML = `${ui.value('Now:', now)}
            ${place ? ui.value('Place:', place) : ''}
            ${pending ? status(busyText()) : ''}
            ${!pending && !d.boxUp && s.error ? status(`Last problem: ${s.error}`) : ''}
            ${noShell && !s.error ? ui.note('Changing the network mode needs Shizuku, which is not working on this phone.') : ''}
            ${s.ready && !s.supported ? `${ui.note('The phone\'s network modes could not be read.')}${ui.buttons([['read', 'Check Again']])}` : ''}
            ${modes.length ? `${ui.sub('Network mode')}
                ${modes.map((m) => ui.radio('rmode', m.id, m.label, mode === m.id, pending || noShell ? 'disabled' : '')).join('')}` : ''}
            ${mode === 'other' && !pending ? ui.note('The phone is on a setting made outside Melaton.') : ''}
            ${ui.sub('Places')}
            ${ui.note('At a place the phone uses its mode. When you leave, it goes back to Auto.')}
            ${s.task === false ? ui.note('Places need a newer Dreamscape app.') : ''}
            ${s.ready && s.supported && !forcedModes(s).length ? ui.note('This phone offers no mode a place could use.') : ''}
            ${accessBlock(s)}
            ${s.fence === 'error' ? status(`Android could not watch the places. ${s.fenceError || ''}`.trim()) : ''}
            ${rules.length ? ruleList(d, rules) : ui.text('No places yet.')}
            ${ui.buttons([['new', 'New', !canAdd(s)], ['edit', 'Edit', !d.sel || pending], ['delete', 'Delete', !d.sel || pending]])}`;
        el.querySelectorAll('input[name="rmode"]').forEach((r) => r.addEventListener('change', () => { void setMode(d, r.value); }));
        el.querySelectorAll('.wm-rmode-list .wm-listbox-row').forEach((b) => b.addEventListener('click', () => {
            const id = b.dataset.key;
            if (d.sel === id) { openEditor(d, id); return; } // a second tap on the chosen one opens it
            d.sel = id;
            repaint(true);
        }));
        const on = (act, fn) => { const b = el.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', fn); };
        on('read', refresh);
        on('new', () => openEditor(d, null));
        on('edit', () => openEditor(d, d.sel));
        on('delete', () => { void deleteRule(d, d.sel); });
    }

    // ---------------------------------------------------------------- the page

    function mainMenu(d) {
        const s = read();
        const pending = !!(op || (s && s.busy));
        return [
            { label: 'New Place', disabled: !s || !lib() || !canAdd(s), action: () => openEditor(d, null) },
            { label: 'Edit Place', disabled: !d.sel || pending, action: () => openEditor(d, d.sel) },
            { label: 'Delete Place', disabled: !d.sel || pending, action: () => { void deleteRule(d, d.sel); } },
            { label: 'Check Again', action: refresh }
        ];
    }

    function editMenu(d) {
        // while the app works there is nothing left to cancel: the page can only be left
        if (op) return [{ label: 'Back to Network Mode', action: () => closeEditor(d) }];
        return [
            { label: 'Cancel', action: () => closeEditor(d) },
            ...(d.edit && !d.edit.isNew ? [{ label: 'Delete Place', action: () => { void deleteRule(d, d.edit.id); } }] : [])
        ];
    }

    /** ok / back on the main screen: Wireless Manager, which the page was opened from. */
    function toWirelessManager() {
        if (!op) detach();
        wmSettings.open('wireless');
    }

    wmSettings.registerPage({
        id: PAGE_ID,
        tab: 'connections',
        label: 'Network Mode',
        icon: 'set-wireless',
        hidden: true, // reached from Wireless Manager, not from the Settings grid
        available: () => !!bridge(),
        init() {
            if (resume) return resume;
            // opened again with the app idle: an ask that never got its answer is let go
            const s = read();
            if (op && s && !s.busy) { op.release(); op = null; }
            return { view: 'main', sel: null, edit: null, mainTop: 0, listTop: 0, fresh: true, boxUp: false, askedAccess: false };
        },
        render(el, tab, d, api) {
            el.classList.add('wm-setc', 'wm-rmode');
            view = { el, d, api, sig: '' };
            attach();
            const header = el.closest('.wm-set') && el.closest('.wm-set').querySelector('.wm-form-hdr');
            if (header && d.view === 'edit') header.textContent = d.edit.isNew ? 'New Place' : 'Edit Place';
            const s = read();
            view.sig = signature(d, s);
            if (!lib() || !s) {
                el.innerHTML = ui.text(!s ? 'The Dreamscape app did not report the network mode.' : 'Network Mode did not load. Restart Melaton.');
                return;
            }
            if (d.view === 'edit') renderEdit(el, d, s);
            else renderMain(el, d, s);
            const allow = el.querySelector('[data-act="access"]');
            if (allow) allow.addEventListener('click', () => {
                d.askedAccess = true;
                try { root.AndroidHome.requestDriveAccess(); } catch (_) { /* older app */ }
            });
            // the phone is read once each time the page is opened; the answer comes as the event
            if (d.fresh) { d.fresh = false; refresh(); }
        },
        softKeys(d) {
            if (d.view === 'edit') return { left: null, right: { label: 'Menu', menu: () => editMenu(d) } };
            return {
                left: { label: 'Done', action: () => root.history.back() },
                right: { label: 'Menu', menu: () => mainMenu(d) }
            };
        },
        // ok and the back key: the editor saves; the main screen goes back to Wireless Manager. The page
        // moves on by itself, so Settings is always told to keep it
        commit(d) {
            if (d.view === 'edit') saveEditor(d);
            // after Settings has put its back-key history entry back
            else setTimeout(toWirelessManager, 0);
            return false;
        }
    });

    // app-scope: allow phone shell service for Wireless Manager's bar, loaded once from app.html
    root.wmRadioMode = {
        available: () => !!bridge(),
        row,
        open: () => !!wmSettings.open(PAGE_ID),
        refresh
    };
})();
