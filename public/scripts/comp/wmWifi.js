/**
 * Melaton Mobile's Wi-Fi (Yozora #1038): WM 6.1 / 6.5's "Configure Wireless Networks" (netui, tshres.dll dialogs
 * 12290 / 12320 / 12330 / 12405, menus 12304 / 12509, wizard keys 80 - 82) on the phone's own Wi-Fi, and the Wi-Fi
 * adapter's IP Address / Name Servers pages (dialogs 12044 / 12045) plus its proxy, for the network in use.
 *
 * Settings > Connections > Network Cards (6.5: Wi-Fi) has two tabs when the phone has Wi-Fi, as WM had with a
 * wireless card: Wireless (this file) and Network Adapters (wmSettingsConnections.js, whose Wi-Fi adapter row opens
 * this file's adapter page). wmSettingsConnections.js hands its tab, soft keys and ok here.
 *
 * Everything goes through the Android app's AndroidWifi (DSApp WifiControl), which joins, saves, forgets and
 * configures networks straight through the app's own shell (Localhost ADB or Shizuku: cmd wifi connect-network /
 * add-network / forget-network, ShellWifi ipget / ipset). Yukimi's decision (Nov 22 2026): no network suggestions and
 * no Android sheets; without the shell the page says so. The page listens only while it is open (AndroidWifi.watch):
 * the app pushes 'androidwifi' (state) and 'androidwifiscan' (scan results, also the ones Android makes itself);
 * nothing here polls.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const root = window;
    // the page-wide listeners below belong to this app (app-scope-ownership)
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    const owned = { signal: appScopeSignal };
    const wmSettings = root.wmSettings;
    if (!wmSettings || !wmSettings.ui) return;
    const ui = wmSettings.ui;
    const esc = ui.esc;
    const shell = () => root.wmShell || null;
    const host = () => (root.AndroidWifi && typeof root.AndroidWifi.get === 'function' ? root.AndroidWifi : null);
    const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : null; } catch (_) { return null; } };
    const callHost = (fn, ...a) => { const h = host(); if (!h || typeof h[fn] !== 'function') return null; try { return h[fn](...a); } catch (_) { return null; } };
    const has = (fn) => { const h = host(); return !!(h && typeof h[fn] === 'function'); };

    // ---- requests the app answers with 'androidwifiresult' { id, result }
    let seq = 0;
    const waiting = new Map();
    root.addEventListener('androidwifiresult', (e) => {
        const d = e && e.detail;
        const w = d && waiting.get(String(d.id));
        if (!w) return;
        waiting.delete(String(d.id));
        clearTimeout(w.timer);
        w.resolve((d && d.result) || {});
    }, owned);
    function ask(fn, ...args) {
        if (!has(fn)) return Promise.resolve({ error: 'This version of the Dreamscape app cannot do this yet.' });
        const id = `wf${Date.now().toString(36)}${(++seq).toString(36)}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => { waiting.delete(id); resolve({ error: 'The phone did not answer.' }); }, 45000);
            waiting.set(id, { resolve, timer });
            try { root.AndroidWifi[fn](...args, id); } catch (err) { clearTimeout(timer); waiting.delete(id); resolve({ error: String((err && err.message) || err) }); }
        });
    }

    // ---- the phone's Wi-Fi as last read or pushed (read when the page draws, then from the pushes)
    let state = null;
    let scanned = [];
    let saved = [];
    function readAll() {
        state = parse(callHost('get')) || state;
        const n = parse(callHost('networks'));
        if (n && Array.isArray(n.networks)) scanned = n.networks;
        const k = parse(callHost('known'));
        if (k && Array.isArray(k.networks)) saved = k.networks;
    }
    const canShell = () => !!(state && state.can && state.can.join);

    // listening: only while the Wireless tab or the adapter page is on screen (the app stops on its own off screen)
    let watching = false;
    let watchEl = null;
    let repaint = null;
    function watch(el, paint) {
        watchEl = el;
        repaint = paint;
        if (!watching) { watching = true; callHost('watch', true); }
    }
    function unwatchIfGone() {
        if (!watching) return;
        const sh = shell();
        if (watchEl && watchEl.isConnected && !watchEl.closest('[hidden]') && !(sh && sh.onScreen && !sh.onScreen(watchEl))) return;
        watching = false;
        watchEl = null;
        repaint = null;
        callHost('watch', false);
    }
    let paintQueued = false;
    const paintSoon = () => {
        if (paintQueued) return;
        paintQueued = true;
        requestAnimationFrame(() => { paintQueued = false; unwatchIfGone(); if (repaint) repaint(); });
    };
    root.addEventListener('androidwifi', (e) => { if (!watching) return; if (e && e.detail && typeof e.detail === 'object') state = e.detail; const k = parse(callHost('known')); if (k && Array.isArray(k.networks)) saved = k.networks; paintSoon(); }, owned);
    root.addEventListener('androidwifiscan', (e) => { if (!watching) return; const d = e && e.detail; if (d && Array.isArray(d.networks)) scanned = d.networks; paintSoon(); }, owned);
    // leaving Settings, another program in front, the screen off: stop listening (a redraw starts it again)
    document.addEventListener('wmAppChange', () => setTimeout(unwatchIfGone, 0), owned);
    document.addEventListener('wmBehind', () => setTimeout(unwatchIfGone, 0), owned);
    root.addEventListener('melatonscreen', () => setTimeout(unwatchIfGone, 0), owned);

    // ---- the list (dialog 12290): Add New..., then the networks with their state (strings 7168ff)
    // icons: tshres.192 bitmap 12302, 14 frames of 32 px (wifi-nets-strip): 2 = access point not in range,
    // 6 - 9 = an open network's 1 - 4 bars, 10 - 13 = a secured network's
    const ACCESS = [['all', 'All Available'], ['ap', 'Only access points'], ['adhoc', 'Only computer-to-computer']];
    const bars = (pct) => (pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : 1);
    function networkRows(d) {
        const cur = state && state.state === 'connected' && state.network ? state.network.name : null;
        const by = new Map();
        for (const n of scanned) if (n && n.name) by.set(n.name, { name: n.name, security: n.security || 'open', pct: Number(n.signalPercent) || 0, inRange: true, known: !!n.known });
        for (const s of saved) {
            if (!s || !s.name) continue;
            const x = by.get(s.name);
            if (x) x.known = true;
            else by.set(s.name, { name: s.name, security: s.security || 'open', pct: 0, inRange: false, known: true });
        }
        if (cur && !by.has(cur)) by.set(cur, { name: cur, security: (state.network && state.network.security) || 'psk', pct: Number(state.network && state.network.signalPercent) || 0, inRange: true, known: true });
        const list = [...by.values()].map((x) => {
            const status = x.name === cur ? 'Connected' : d.connecting === x.name ? 'Connecting' : x.inRange ? 'Available' : 'Unavailable';
            const frame = !x.inRange ? 2 : (x.security === 'open' ? 6 : 10) + bars(x.name === cur && state.network ? Number(state.network.signalPercent) || x.pct : x.pct) - 1;
            return { ...x, status, frame, rank: x.name === cur ? 0 : d.connecting === x.name ? 1 : x.inRange && x.known ? 2 : x.inRange ? 3 : 4 };
        });
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        list.sort((a, b) => a.rank - b.rank || (a.rank === 3 ? b.pct - a.pct : 0) || coll.compare(a.name, b.name));
        // Android has no computer-to-computer (ad-hoc) networks
        return d.access === 'adhoc' ? [] : list;
    }
    const rowHtml = (r, sel) => `<button type="button" class="wm-listbox-row wm-wifi-row${sel ? ' is-selected' : ''}" data-key="${esc(r.name)}"><i class="wm-wifi-ic" style="--f:${r.frame}"></i><span class="wm-wifi-name">${esc(r.name)}</span><span class="wm-wifi-state">${esc(r.status)}</span></button>`;

    function message(text, icon = 'info') {
        const sh = shell();
        if (sh && typeof sh.messageBox === 'function') return sh.messageBox({ title: 'Wireless', icon, text });
        return Promise.resolve();
    }
    const refreshKeys = () => { const sh = shell(); if (sh && typeof sh.refreshSoftKeys === 'function') sh.refreshSoftKeys(); };
    const noShellText = 'Joining and changing networks needs Localhost ADB or Shizuku. Turn one on in Settings > Android Bridge.';

    function selected(d) {
        if (!d.sel) return null;
        return networkRows(d).find((r) => r.name === d.sel) || null;
    }

    /** Connect (soft key, hold menu): a saved network with its own key, a new open one at once, else the wizard for its key. */
    async function connect(d, r) {
        if (!r) return;
        if (!canShell()) { await message(noShellText); return; }
        if (!r.known && r.security !== 'open' && r.security !== 'owe') { startWizard(d, r); return; }
        d.connecting = r.name;
        if (d.rerender) d.rerender();
        const res = await ask('join', JSON.stringify({ ssid: r.name, security: r.security === 'psk' ? 'wpa2' : r.security }));
        if (res.error) { d.connecting = null; if (d.rerender) d.rerender(); await message(res.error, 'warning'); return; }
        // 'Connecting' shows until the app pushes the new state (or 20 s, when Android gave up)
        setTimeout(() => { if (d.connecting === r.name) { d.connecting = null; paintSoon(); } }, 20000);
    }

    async function removeSettings(d, r) {
        if (!r || !r.known) return;
        if (!canShell()) { await message(noShellText); return; }
        const sh = shell();
        const yes = sh ? await sh.messageBox({ title: 'Wireless', icon: 'question', text: `Remove the settings for ${r.name}? You will need to enter them again to connect to it.`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] }) : true;
        if (!yes) return;
        const res = await ask('forget', r.name);
        if (res.error) { await message(res.error, 'warning'); return; }
        d.sel = null;
        readAll();
        if (d.rerender) d.rerender();
        refreshKeys();
    }

    // ---- Add New / Edit: Configure Wireless Network (12320), Configure Network Authentication (12330)
    // Authentication as WM lists it (strings 7186ff) where Android can join it; WPA3-PSK is Android's SAE
    const AUTH = [['open', 'Open'], ['shared', 'Shared'], ['wpa-psk', 'WPA-PSK'], ['wpa2-psk', 'WPA2-PSK'], ['wpa3-psk', 'WPA3-PSK']];
    const ENC = { open: [['disabled', 'Disabled'], ['wep', 'WEP'], ['aes', 'AES']], shared: [['wep', 'WEP']], 'wpa-psk': [['tkip', 'TKIP'], ['aes', 'AES']], 'wpa2-psk': [['tkip', 'TKIP'], ['aes', 'AES']], 'wpa3-psk': [['aes', 'AES']] };
    const CONNECTS = [['internet', 'The Internet'], ['work', 'Work']];
    const label = (list, v) => (list.find(([k]) => k === v) || list[0])[1];
    /** Android's security kind for cmd wifi (open | owe | wep | wpa2 | wpa3) from WM's two combos. */
    function kindOf(f) {
        if (f.auth === 'wpa3-psk') return 'wpa3';
        if (f.auth === 'wpa-psk' || f.auth === 'wpa2-psk') return 'wpa2';
        if (f.enc === 'wep') return 'wep';
        return f.enc === 'aes' ? 'owe' : 'open';
    }
    const connectsKey = 'wmWifiConnectsTo';
    function connectsTo(name) { try { return (JSON.parse(localStorage.getItem(connectsKey) || '{}') || {})[name] || 'internet'; } catch (_) { return 'internet'; } }
    function setConnectsTo(name, v) {
        try {
            const m = JSON.parse(localStorage.getItem(connectsKey) || '{}') || {};
            if (v === 'internet') delete m[name]; else m[name] = v;
            localStorage.setItem(connectsKey, JSON.stringify(m));
        } catch (_) { /* storage off */ }
    }

    function startWizard(d, r) {
        const sec = r ? r.security : 'psk';
        const auth = sec === 'open' || sec === 'owe' || sec === 'wep' ? 'open' : 'wpa2-psk';
        d.view = 'wizard';
        d.step = 1;
        d.form = {
            edit: !!(r && r.known), ssid: r ? r.name : '', original: r ? r.name : '', hidden: false, connects: r ? connectsTo(r.name) : 'internet',
            auth, enc: sec === 'owe' ? 'aes' : sec === 'wep' ? 'wep' : sec === 'open' ? 'disabled' : 'aes', key: '', index: 1
        };
        if (d.rerender) d.rerender();
        refreshKeys();
    }

    function wizardBack(d) {
        if (d.step > 1) d.step -= 1; else { d.view = 'list'; d.form = null; }
        if (d.rerender) d.rerender();
        refreshKeys();
    }

    async function wizardNext(d) {
        const f = d.form;
        if (d.step === 1) {
            f.ssid = String(f.ssid || '').trim();
            if (!f.ssid) { await message('A network name is required. Please enter a valid network name.', 'warning'); return; }
            if (new TextEncoder().encode(f.ssid).length > 32) { await message('The network name is not valid. Please enter a valid network name.', 'warning'); return; }
            if (!f.edit && saved.some((s) => s.name === f.ssid)) { await message('The network name you\'ve chosen is already in use. Please enter a new name for the network.', 'warning'); return; }
            d.step = 2;
            if (d.rerender) d.rerender();
            refreshKeys();
            return;
        }
        await finish(d);
    }

    async function finish(d) {
        const f = d.form;
        const kind = kindOf(f);
        const needsKey = kind === 'wpa2' || kind === 'wpa3' || kind === 'wep';
        // an edit with no new key keeps the saved one (same security); a new network needs its key
        if (needsKey && !f.key && !f.edit) { await message('The network key you entered is not correct. Please try again.', 'warning'); return; }
        if ((kind === 'wpa2' || kind === 'wpa3') && f.key && (f.key.length < 8 || f.key.length > 64)) { await message('The network key you entered is not correct. Please try again.', 'warning'); return; }
        if (!canShell()) { await message(noShellText); return; }
        const sh = shell();
        const go = async () => {
            // a renamed network is a new one: the old settings go
            if (f.edit && f.original && f.original !== f.ssid) await ask('forget', f.original);
            return ask('join', JSON.stringify({ ssid: f.ssid, security: kind, key: f.key || undefined, hidden: !!f.hidden }));
        };
        const res = sh && typeof sh.busy === 'function' ? await sh.busy(go) : await go();
        if (res && res.error) { await message(res.error, 'warning'); return; }
        setConnectsTo(f.ssid, f.connects);
        d.connecting = res && res.connecting ? f.ssid : null;
        d.sel = f.ssid;
        d.reveal = true;
        d.view = 'list';
        d.form = null;
        readAll();
        if (d.rerender) d.rerender();
        refreshKeys();
    }

    function renderWizard(el, d) {
        const f = d.form;
        const setHeader = (t) => { const h = el.closest('.wm-set') && el.closest('.wm-set').querySelector('.wm-form-hdr'); if (h) h.textContent = t; };
        hideTabs(el, true);
        if (d.step === 1) {
            setHeader('Configure Wireless Network');
            el.innerHTML = `<div class="wm-wifi-wiz">
                ${ui.row('Network name:', ui.edit('', f.ssid, 'data-k="ssid" maxlength="32" autocapitalize="off" spellcheck="false"'))}
                ${ui.row('Connects to:', ui.comboHtml('connects', label(CONNECTS, f.connects)))}
                ${ui.check('hidden', 'This is a hidden network', f.hidden, 'data-k="hidden"')}
                ${ui.check('adhoc', 'This is a device-to-device (ad-hoc) connection', false, 'disabled')}
            </div>`;
            const name = el.querySelector('[data-k="ssid"]');
            name.addEventListener('input', () => { f.ssid = name.value; });
            el.querySelector('[data-k="hidden"]').addEventListener('change', (e) => { f.hidden = e.target.checked; });
            ui.bindCombo(el.querySelector('[data-act="connects"]'), CONNECTS, f.connects, (v) => { f.connects = v; });
            return;
        }
        setHeader('Configure Network Authentication');
        const encs = ENC[f.auth] || ENC.open;
        if (!encs.some(([k]) => k === f.enc)) f.enc = encs[encs.length > 1 && f.auth !== 'open' ? 1 : 0][0];
        const needsKey = kindOf(f) !== 'open' && kindOf(f) !== 'owe';
        el.innerHTML = `<div class="wm-wifi-wiz">
            ${ui.row('Authentication:', ui.comboHtml('auth', label(AUTH, f.auth)))}
            ${ui.row('Data Encryption:', ui.comboHtml('enc', label(encs, f.enc)))}
            ${ui.check('auto', 'The key is automatically provided', false, 'disabled')}
            <div class="wm-wifi-indent">
                ${ui.row('Network key:', ui.edit('', f.key, `data-k="key" autocapitalize="off" spellcheck="false" maxlength="64"${needsKey ? '' : ' disabled'}${f.edit && needsKey ? ' placeholder="(unchanged)"' : ''}`))}
                ${ui.row('Key index:', ui.comboHtml('index', String(f.index), f.enc !== 'wep'))}
            </div>
        </div>`;
        const key = el.querySelector('[data-k="key"]');
        key.addEventListener('input', () => { f.key = key.value; });
        ui.bindCombo(el.querySelector('[data-act="auth"]'), AUTH, f.auth, (v) => { f.auth = v; if (d.rerender) d.rerender(); });
        ui.bindCombo(el.querySelector('[data-act="enc"]'), encs, f.enc, (v) => { f.enc = v; if (d.rerender) d.rerender(); });
        ui.bindCombo(el.querySelector('[data-act="index"]'), [[1, '1'], [2, '2'], [3, '3'], [4, '4']], f.index, (v) => { f.index = v; });
    }

    /** The page's tab strip hidden while a wizard or a sub-page with its own tabs shows (WM puts those on a page of their own). */
    function hideTabs(el, hide) {
        const page = el.closest('.wm-set');
        const strip = page && page.querySelector(':scope > .wm-tabs');
        if (strip) strip.style.display = hide ? 'none' : ''; // .wm-tabs is display: flex, which [hidden] does not beat
    }

    // ---- Wi-Fi Advanced Settings (12405)
    function renderAdvanced(el, d) {
        const h = el.closest('.wm-set') && el.closest('.wm-set').querySelector('.wm-form-hdr');
        if (h) h.textContent = 'Wi-Fi Advanced Settings';
        hideTabs(el, true);
        const adv = d.adv || (d.adv = { notify: null });
        el.innerHTML = `${ui.check('notify', 'Turn on available network notification', !!adv.notify, `data-k="notify"${adv.notify == null ? ' disabled' : ''}`)}`;
        el.querySelector('[data-k="notify"]').addEventListener('change', (e) => { adv.want = e.target.checked; });
        if (adv.notify == null && !adv.asked) {
            adv.asked = true;
            ask('advanced', null).then((r) => { if (r && typeof r.notify === 'boolean') { adv.notify = r.notify; if (d.view === 'advanced' && d.rerender) d.rerender(); } });
        }
    }

    // ---- the Wireless tab
    function render(el, d, api) {
        el.classList.add('wm-setc', 'wm-wifi');
        d.rerender = api.rerender;
        if (!d.access) { try { d.access = localStorage.getItem('wmWifiAccess') || 'all'; } catch (_) { d.access = 'all'; } }
        if (d.view === 'wizard' && d.form) { renderWizard(el, d); return; }
        if (d.view === 'advanced') { renderAdvanced(el, d); return; }
        hideTabs(el, false);
        const h = el.closest('.wm-set') && el.closest('.wm-set').querySelector('.wm-form-hdr');
        if (h) h.textContent = 'Configure Wireless Networks';
        if (!host()) {
            el.innerHTML = `<p>${esc('Wireless networks are configured here in the Dreamscape app for Android.')}</p>`;
            return;
        }
        readAll();
        if (!d.scanned) { d.scanned = true; callHost('scan'); }
        el.innerHTML = `<div class="wm-listbox wm-wifi-list"></div>
            <p class="wm-setc-gap-top">Networks to access:</p>
            ${ui.comboHtml('access', label(ACCESS, d.access))}`;
        const box = el.querySelector('.wm-wifi-list');
        ui.bindCombo(el.querySelector('[data-act="access"]'), ACCESS, d.access, (v) => { d.access = v; try { localStorage.setItem('wmWifiAccess', v); } catch (_) { /* storage off */ } paint(); });
        let lastHtml = '';
        const paint = () => {
            if (!box.isConnected) return;
            let html;
            if (state && state.radio === false) html = `<p class="wm-wifi-off">To configure your wireless network, please enable your wireless network card.</p>`;
            else {
                const list = networkRows(d);
                if (d.sel && !list.some((r) => r.name === d.sel)) d.sel = null;
                html = `<button type="button" class="wm-listbox-row wm-wifi-row${d.sel === '+add' ? ' is-selected' : ''}" data-key="+add"><i class="wm-wifi-ic is-none"></i><span class="wm-wifi-name">Add New...</span></button>${list.map((r) => rowHtml(r, r.name === d.sel)).join('')}`;
            }
            if (html === lastHtml) return;
            lastHtml = html;
            box.innerHTML = html;
            // a network just added or edited is selected: shown, as the list view keeps its selection in view
            const on = d.sel && d.sel !== '+add' ? box.querySelector('.wm-wifi-row.is-selected') : null;
            if (on && d.reveal) { d.reveal = false; on.scrollIntoView({ block: 'nearest' }); }
            refreshKeys();
        };
        paint();
        // taps: Add New... opens the wizard; a network is selected (a second tap on it: Edit); hold: its menu (12304)
        box.addEventListener('click', (e) => {
            const row = e.target.closest('.wm-wifi-row');
            if (!row || row._held) { if (row) row._held = false; return; }
            const key = row.dataset.key;
            if (key === '+add') { d.sel = '+add'; startWizard(d, null); return; }
            const again = d.sel === key;
            d.sel = key;
            box.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
            row.classList.add('is-selected');
            refreshKeys();
            if (again) { const r = selected(d); if (r) startWizard(d, r); }
        });
        let holdTimer = null;
        box.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.wm-wifi-row');
            clearTimeout(holdTimer);
            if (!row || row.dataset.key === '+add') return;
            const x = e.clientX; const y = e.clientY;
            holdTimer = setTimeout(() => {
                row._held = true;
                d.sel = row.dataset.key;
                box.querySelectorAll('.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                refreshKeys();
                const r = selected(d);
                const sh = shell();
                if (!r || !sh || typeof sh.menuAt !== 'function') return;
                sh.menuAt(x, y, [
                    { label: 'Connect', disabled: r.status === 'Connected' || !r.inRange, action: () => connect(d, r) },
                    { label: 'Add New...', action: () => startWizard(d, null) },
                    { label: 'Remove Settings', disabled: !r.known, action: () => removeSettings(d, r) },
                    { label: 'Edit', action: () => startWizard(d, r) }
                ]);
            }, (sh0() && sh0().holdMs) || 600);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => box.addEventListener(t, () => clearTimeout(holdTimer)));
        box.addEventListener('contextmenu', (e) => e.preventDefault());
        watch(el, paint);
    }
    const sh0 = () => root.wmShell;

    function softKeys(d) {
        if (d.view === 'wizard' && d.form) {
            return d.step === 1
                ? { left: { label: 'Cancel', action: () => wizardBack(d) }, right: { label: 'Next', action: () => wizardNext(d) } }
                : { left: { label: 'Back', action: () => wizardBack(d) }, right: { label: 'Finish', action: () => finish(d) } };
        }
        if (d.view === 'advanced') return null;
        const r = selected(d);
        return {
            left: { label: 'Connect', disabled: !r || !r.inRange || r.status === 'Connected', action: () => connect(d, selected(d)) },
            right: {
                label: 'Menu',
                menu: () => {
                    const s = selected(d);
                    return [
                        { label: 'Add New...', action: () => startWizard(d, null) },
                        { label: 'Remove Settings', disabled: !(s && s.known), action: () => removeSettings(d, s) },
                        { label: 'Edit', disabled: !s, action: () => startWizard(d, s) },
                        '-',
                        { label: 'Advanced', disabled: !has('advanced'), action: () => { d.view = 'advanced'; d.adv = null; if (d.rerender) d.rerender(); refreshKeys(); } }
                    ];
                }
            }
        };
    }

    /** ok: a wizard page or Advanced goes back to the list (Advanced saving first); on the list nothing to save. */
    function commit(d) {
        if (d.view === 'advanced') {
            const adv = d.adv;
            if (adv && typeof adv.want === 'boolean' && adv.want !== adv.notify) ask('advanced', adv.want ? '1' : '0');
            d.view = 'list';
            d.adv = null;
            if (d.rerender) d.rerender();
            refreshKeys();
            return false;
        }
        if (d.view === 'wizard') {
            d.view = 'list';
            d.form = null;
            if (d.rerender) d.rerender();
            refreshKeys();
            return false;
        }
        return null;
    }

    // ---- the Wi-Fi adapter's page (Network Adapters > the Wi-Fi row): IP Address (12044), Name Servers (12045) and
    // the proxy, for the network in use (Android keeps these per network). Its own tabs replace the page's strip.
    const SUB_TABS = [['ip', 'IP Address'], ['ns', 'Name Servers'], ['proxy', 'Proxy']];
    const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    const maskToPrefix = (m) => { if (!IPV4.test(m)) return null; const bits = m.split('.').map((x) => Number(x).toString(2).padStart(8, '0')).join(''); return /^1*0*$/.test(bits) ? bits.indexOf('0') < 0 ? 32 : bits.indexOf('0') : null; };
    const prefixToMask = (p) => { const n = Math.max(0, Math.min(32, Number(p) || 0)); const bits = '1'.repeat(n).padEnd(32, '0'); return [0, 8, 16, 24].map((i) => parseInt(bits.slice(i, i + 8), 2)).join('.'); };

    /** What a save would change: the fields that count for the mode and proxy chosen. */
    const settingsKey = (s) => JSON.stringify(s.mode === 'static' ? [s.mode, s.address, s.mask, s.gateway, s.dns1, s.dns2] : [s.mode])
        + JSON.stringify(s.proxy ? [true, s.server, s.exclusions] : [false]);

    function renderAdapter(el, d, api, iface) {
        el.classList.add('wm-setc', 'wm-wifi');
        d.rerender = api.rerender;
        const name = state && state.state === 'connected' && state.network ? state.network.name : null;
        if (!d.ipSub) d.ipSub = 'ip';
        const page = el.closest('.wm-set');
        const strip = page && page.querySelector(':scope > .wm-tabs');
        if (strip) {
            strip.innerHTML = SUB_TABS.map(([id, l]) => `<button type="button" class="wm-tab" role="tab" data-sub="${id}" aria-selected="${id === d.ipSub}">${esc(l)}</button>`).join('');
            strip.querySelectorAll('[data-sub]').forEach((t) => t.addEventListener('click', (e) => { e.stopImmediatePropagation(); d.ipSub = t.dataset.sub; api.rerender(); }, true));
        }
        const h = page && page.querySelector('.wm-form-hdr');
        if (h) h.textContent = iface ? iface.label : 'Wi-Fi';
        readAll();
        watch(el, () => {});
        if (!name) { el.innerHTML = `<p>Connect to a wireless network to change its IP settings. Android keeps them for each network.</p>`; return; }
        if (!canShell()) { el.innerHTML = `<p>${esc(noShellText)}</p>`; return; }
        if (!d.ip || d.ip.ssid !== name) {
            d.ip = { ssid: name, loading: true };
            ask('settings', name).then((r) => {
                if (!d.ip || d.ip.ssid !== name) return;
                if (r.error) { d.ip = { ssid: name, error: r.error }; } else {
                    const ip = r.ip || {};
                    const px = r.proxy || {};
                    const dns = Array.isArray(ip.dns) ? ip.dns : [];
                    d.ip = {
                        ssid: name, mode: ip.mode === 'static' ? 'static' : 'dhcp', address: ip.address || '', mask: ip.prefix != null ? prefixToMask(ip.prefix) : '', gateway: ip.gateway || '',
                        dns1: dns[0] || '', dns2: dns[1] || '', proxy: px.mode === 'manual' || px.mode === 'pac', server: px.mode === 'pac' ? px.pac || '' : px.host ? `${px.host}:${px.port}` : '',
                        exclusions: px.exclusions || '', dirty: false
                    };
                    // what Android gave the adapter now, for a switch to a specific address
                    if (d.ip.mode === 'dhcp' && iface) {
                        // the interface row's address carries its prefix ("192.168.1.5/24")
                        const [a, p] = String((iface.ip && iface.ip[0]) || '').split('/');
                        d.ip.address = IPV4.test(a || '') ? a : '';
                        d.ip.mask = d.ip.address ? prefixToMask(p != null && p !== '' ? p : 24) : '';
                        d.ip.gateway = IPV4.test(iface.gateway || '') ? iface.gateway : '';
                    }
                    d.ip.orig = settingsKey(d.ip);
                }
                if (el.isConnected) api.rerender();
            });
        }
        const s = d.ip;
        if (s.loading) { el.innerHTML = '<p>Reading the settings...</p>'; return; }
        if (s.error) { el.innerHTML = `<p>${esc(s.error)}</p>`; return; }
        const bind = () => el.querySelectorAll('[data-k]').forEach((x) => {
            const k = x.dataset.k;
            x.addEventListener(x.type === 'checkbox' || x.type === 'radio' ? 'change' : 'input', () => {
                s.dirty = true;
                if (x.type === 'radio') { s.mode = x.value; api.rerender(); return; }
                if (x.type === 'checkbox') { s[k] = x.checked; api.rerender(); return; }
                s[k] = x.value.trim();
            });
        });
        const ipEdit = (k, off) => ui.edit('', s[k], `data-k="${k}" inputmode="decimal" maxlength="15"${off ? ' disabled' : ''}`);
        if (d.ipSub === 'ns') {
            el.innerHTML = `<p class="wm-wifi-for">${esc(name)}</p>
                <p>Name server addresses may be automatically assigned if DHCP is enabled on this adapter.</p>
                ${ui.row('DNS:', ipEdit('dns1', s.mode !== 'static'))}
                ${ui.row('Alt DNS:', ipEdit('dns2', s.mode !== 'static'))}`;
        } else if (d.ipSub === 'proxy') {
            el.innerHTML = `<p class="wm-wifi-for">${esc(name)}</p>
                ${ui.check('proxy', 'This network uses a proxy server to connect to the Internet', s.proxy, 'data-k="proxy"')}
                ${ui.row('Proxy server:', ui.edit('', s.server, `data-k="server" autocapitalize="off" spellcheck="false" placeholder="host:port"${s.proxy ? '' : ' disabled'}`))}
                ${ui.row('Exceptions:', ui.edit('', s.exclusions, `data-k="exclusions" autocapitalize="off" spellcheck="false"${s.proxy ? '' : ' disabled'}`))}
                ${ui.note('A proxy server address ending in .pac is used as an automatic configuration script.')}`;
        } else {
            el.innerHTML = `<p class="wm-wifi-for">${esc(name)}</p>
                ${ui.radio('ipmode', 'dhcp', 'Use server-assigned IP address', s.mode !== 'static', 'data-k="mode"')}
                ${ui.radio('ipmode', 'static', 'Use specific IP address', s.mode === 'static', 'data-k="mode"')}
                ${ui.row('IP address:', ipEdit('address', s.mode !== 'static'))}
                ${ui.row('Subnet mask:', ipEdit('mask', s.mode !== 'static'))}
                ${ui.row('Default gateway:', ipEdit('gateway', s.mode !== 'static'))}`;
        }
        bind();
    }

    /** ok on the adapter page: validate, save through the app (the network reconnects), back to the list; false keeps it open. */
    async function commitAdapter(d) {
        const s = d.ip;
        const done = () => { d.ip = null; d.ipSub = null; return true; };
        // nothing changed (or changed back): no save, so the network in use does not reconnect for nothing
        if (!s || !s.dirty || s.error || s.loading || settingsKey(s) === s.orig) return done();
        const bad = (what) => message(`${what} is not a valid entry.`, 'warning').then(() => false);
        const want = {};
        if (s.mode === 'static') {
            if (!IPV4.test(s.address)) {
                await message('No IP address was specified. An IP address is required to identify this workstation on the TCP/IP network.', 'warning');
                return false;
            }
            const prefix = maskToPrefix(s.mask || '255.255.255.0');
            if (prefix == null) return bad('The subnet mask');
            if (s.gateway && !IPV4.test(s.gateway)) return bad('The default gateway');
            const dns = [s.dns1, s.dns2].filter(Boolean);
            if (dns.some((x) => !IPV4.test(x))) return bad('The DNS address');
            want.ip = { mode: 'static', address: s.address, prefix, gateway: s.gateway || '', dns };
        } else want.ip = { mode: 'dhcp' };
        if (s.proxy) {
            const v = String(s.server || '').trim();
            if (/\.pac(\?.*)?$/i.test(v) || /^https?:\/\//i.test(v)) want.proxy = { mode: 'pac', pac: v };
            else {
                const m = /^([^\s:/]+):(\d{1,5})$/.exec(v);
                if (!m || Number(m[2]) > 65535) return bad('The proxy server');
                want.proxy = { mode: 'manual', host: m[1], port: Number(m[2]), exclusions: s.exclusions || '' };
            }
        } else want.proxy = { mode: 'none' };
        const sh = shell();
        const go = () => ask('configure', s.ssid, JSON.stringify(want));
        const res = sh && typeof sh.busy === 'function' ? await sh.busy(go) : await go();
        if (res && res.error) { await message(res.error, 'warning'); return false; }
        return done();
    }

    root.wmWifi = {
        available: () => !!host(),
        init: () => ({ view: 'list', step: 1, sel: null, form: null, access: null, connecting: null }),
        render,
        softKeys,
        commit,
        renderAdapter,
        commitAdapter,
        /** Network Cards drew another tab / closed: stop listening if this page's element is gone. */
        idle: () => unwatchIfGone(),
        /** The page closed: stop listening. */
        stop: () => { if (watching) { watching = false; watchEl = null; repaint = null; callHost('watch', false); } },
        /** Wireless Manager / the status bar: Settings > Network Cards on its Wireless tab. */
        open: () => !!(wmSettings.open && wmSettings.open('network-cards', 'nc-wireless'))
    };
})();
