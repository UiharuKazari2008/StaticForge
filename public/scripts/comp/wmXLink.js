/**
 * Melaton Mobile: XLink, a phone version of the XLink Operator Console (apps/xlink, the arcade
 * cabinets' control menu, Toolbox launchId 'xlink'), Yozora #732 (parent #709). Not the desktop
 * window re-hosted: the same server packets the desktop client sends (xlink_devices / xlink_device /
 * xlink_action, modules/xlink.js through 297-xlinkHandler.js, admins only) on WM 6.1 screens.
 *
 *   cabinets     the XLink band (nodes answering, time of day), one row per cabinet: its icon, name,
 *                badges, the status on a small LCD in the menu's colour; tap opens it. Soft keys
 *                Open / Menu (Poll All, Network Diagnostics, Event Log, Auto Poll, About)
 *   cabinet      its status and last poll, then the function list as a tree: folders open in place
 *                ([+] / [-]), each row's state on the LCD and what its control is (positions, level,
 *                command, "asks first"); tap a function = its page. Soft keys Poll / Menu (Expand
 *                All, Collapse All, Properties, Event Log, Auto Poll)
 *   function     a WM property page, tabs at the bottom: Control (the state, then the positions as
 *                radio buttons with the lit one marked, a level track, or the command) and Properties
 *                (type, endpoints, interlock). Soft key Set / Take sends it
 *   event log    every POLL / CHECK / SEND the server reported for this phone, newest first
 *
 * Nothing reaches a cabinet without a question: every command asks "Send ... to <cabinet>?" first, and
 * a function with an interlock (menu.json warning) then shows the cabinet's own warning from the
 * server before the confirmed send (the desktop's flow). The client names a device, an item path and
 * an operation, never a URL. X asks while a command is on its way (closeQuestion).
 * Styles: public/css/wm-xlink.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'xlink-mobile';
    const TITLE = 'XLink';
    const ICON = 'app-xlink';
    const A = '/melaton-apps/xlink/assets';
    const POLL_MS = 60000;
    const pad = (n) => String(n).padStart(2, '0');
    const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

    // the desktop console's icon table (apps/xlink/client/xlink.js): its own art, else Vista's
    const ICONS = {
        joystick: 'vista-cmdbar/programs.png', video: 'vista-cmdbar/film.png', 'camera-viewfinder': 'vista-cmdbar/film.png',
        'image-slash': 'vista-cmdbar/ban.png', 'sensor-triangle-exclamation': 'vista-icons/warning-16.png', 'rotate-exclamation': 'vista-icons/warning-16.png',
        'exclamation-triangle': 'vista-icons/warning-16.png', 'triangle-exclamation': 'vista-icons/warning-16.png', 'light-switch-on': 'vista-cmdbar/power.png',
        'power-off': 'vista-cmdbar/power.png', leaf: 'vista-cmdbar/power.png', 'disc-drive': 'vista-explorer/drive-removable-16.png',
        'volume-slash': 'vista-icons/volume-mute-16.png', speakers: 'vista-icons/volume-high-16.png', 'volume-high': 'vista-icons/volume-high-16.png',
        ethernet: 'vista-cpl/network-16.png', 'network-wired': 'vista-cpl/network-16.png', 'circle-nodes': 'vista-icons/net-trusted-16.png',
        tv: 'vista-cmdbar/display.png', display: 'vista-cmdbar/display.png', fingerprint: 'vista-cmdbar/keyboard.png', 'credit-card': 'vista-icons/cardspace-16.png',
        'coin-blank': 'vista-cmdbar/add.png', 'lightbulb-cfl-on': 'vista-cpl/bulb-16.png', 'lightbulb-on': 'vista-cpl/bulb-16.png',
        'lightbulb-exclamation-on': 'vista-cpl/bulb-16.png', 'alarm-exclamation': 'vista-cmdbar/clock.png', pickaxe: 'vista-cmdbar/tools.png',
        hammer: 'vista-cmdbar/tools.png', fan: 'vista-cmdbar/gears.png', search: 'vista-cmdbar/find.png', person: 'vista-cpl/users-16.png',
        'image-landscape': 'vista-cmdbar/picture.png'
    };
    const OWN_ICONS = new Set(['joystick', 'video', 'camera-viewfinder', 'image-slash', 'sensor-triangle-exclamation', 'light-switch-on',
        'disc-drive', 'volume-slash', 'speakers', 'ethernet', 'tv', 'credit-card', 'coin-blank', 'lightbulb-cfl-on', 'alarm-exclamation', 'leaf',
        'circle-nodes', 'lightbulb-exclamation-on', 'pickaxe', 'rotate-exclamation', 'fan', 'hammer', 'lightbulb-on', 'search', 'fingerprint',
        'person', 'image-landscape']);
    const iconUrl = (name) => (OWN_ICONS.has(name) ? `${A}/icons/${name}.png` : `/static_images/${ICONS[name] || 'vista-icons/application-16.png'}`);
    const KIND = { toggle: 'Selector switch', slider: 'Analog level', button: 'Command', folder: 'Function group', info: 'Indicator' };

    /** A colour from menu.json, made safe for a style attribute (the desktop's rule). */
    const colour = (c) => (/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(String(c || '').trim()) ? String(c).trim() : '');

    let sh = null;
    let esc = (s) => String(s == null ? '' : s);
    let page = null;
    let devices = [];
    let listError = '';
    let loaded = false;
    let loadedAt = 0;
    const snaps = new Map();
    const open = new Set(); // "<device>|<path>" folders opened
    let layers = []; // { kind: 'device', key } | { kind: 'item', key, path, tab, choice, level } | { kind: 'log' }
    let selectedKey = null;
    let logLines = [];
    let autoPoll = true;
    let sending = 0;
    let sendingTo = '';
    let shown = false;
    let tick = null;

    const top = () => layers[layers.length - 1] || null;
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const deviceOf = (key) => devices.find((d) => d.key === key) || null;

    function icon(name) {
        return `<img class="wxl-ico" src="${iconUrl(name || '')}" alt="" draggable="false">`;
    }

    /** Black or white text for a background colour (the menu often gives bg without color). */
    function ink(bg) {
        const probe = document.createElement('span');
        probe.style.color = bg;
        document.body.appendChild(probe);
        const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
        probe.remove();
        if (!m) return '#000';
        return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) > 140 ? '#000' : '#fff';
    }

    function badges(list) {
        return (list || []).map((b) => {
            const bg = colour(b.color) || '#fff';
            const fg = colour(b.textColor) || ink(bg);
            return `<span class="wxl-badge" style="background:${bg};color:${fg}">${esc(b.text)}</span>`;
        }).join('');
    }

    function lcd(status, append) {
        if (!status) return '<span class="wxl-lcd is-empty">----</span>';
        const c = colour(status.color);
        return `<span class="wxl-lcd${status.failed ? ' is-failed' : ''}"${c ? ` style="--lcd:${c}"` : ''}>${esc(status.text)}${esc(append || '')}</span>`;
    }

    // ---------------------------------------------------------------- server (the desktop client's calls)

    async function send(type, payload) {
        const ws = window.wsClient;
        if (!ws || typeof ws.sendMessage !== 'function' || (typeof ws.isConnected === 'function' && !ws.isConnected())) throw new Error('The server connection is down.');
        let r = await ws.sendMessage(type, payload || {}, false);
        if (r && r.data !== undefined) r = r.data;
        if (r && r.error) {
            const err = new Error(r.error.details || r.error.message || 'XLink error');
            err.code = r.error.code;
            throw err;
        }
        return r;
    }

    function log(verb, text, bad) {
        logLines.push({ line: `${clock(Date.now())}  ${verb.padEnd(5)} ${text}`, bad: !!bad });
        if (logLines.length > 300) logLines.shift();
    }

    function logReq(l) {
        const res = l.ok ? `${l.code} OK` : (l.code ? `${l.code} NG` : `ERR ${l.error || ''}`.trim());
        logLines.push({ line: `${clock(l.t)}  ${String(l.verb).padEnd(5)} ${l.url} -> ${res} (${l.ms} ms)`, bad: !l.ok });
        if (logLines.length > 300) logLines.shift();
    }

    async function loadDevices() {
        try {
            const r = await send('xlink_devices', {});
            devices = r.devices || [];
            listError = '';
            devices.forEach((d) => log('POLL', `${d.name}: ${d.status ? d.status.text : '(no status)'}`, d.status && d.status.failed));
        } catch (err) {
            devices = [];
            listError = (err && err.message) || 'Failed to read the device list';
            log('ERROR', listError, true);
            throw err;
        } finally {
            loaded = true;
            loadedAt = Date.now();
        }
    }

    async function reloadList(opts = {}) {
        try {
            if (opts.quiet) await loadDevices();
            else await sh.busy(loadDevices, { paint: true, timeout: 20000 });
        } catch (err) {
            const text = `The cabinet list could not be read.\n\n${(err && err.message) || ''}`.trim();
            if (opts.quiet) sh.notify({ title: TITLE, icon: 'error', text });
            else await box(text, 'error');
        }
        renderMain();
    }

    function absorb(s) {
        if (!s || !s.key) return;
        if (!s.cached) (s.log || []).forEach(logReq);
        snaps.set(s.key, s);
        const d = deviceOf(s.key);
        if (d) d.status = s.status;
        renderMain();
        const t = top();
        if (t && t.key === s.key && t.kind !== 'log') renderLayer();
    }

    async function poll(key, opts = {}) {
        if (!key) return;
        const run = () => send('xlink_device', { device: key, force: !!opts.force });
        try {
            absorb(opts.quiet ? await run() : await sh.busy(run, { paint: true, timeout: 20000 }));
        } catch (err) {
            const msg = (err && err.message) || 'poll failed';
            log('ERROR', `${key}: ${msg}`, true);
            if (!opts.quiet) await box(`Communication error.\n\n${msg}`, 'error');
            else if (!snaps.has(key)) renderLayer();
        }
    }

    async function pollAll() {
        await reloadList();
        await sh.busy(() => Promise.all(devices.map(async (d) => {
            try { absorb(await send('xlink_device', { device: d.key, force: true })); } catch (err) { log('ERROR', `${d.name}: ${(err && err.message) || ''}`, true); }
        })), { paint: true, timeout: 30000 });
        renderMain();
    }

    // ---------------------------------------------------------------- boxes

    function box(text, kind) {
        return sh.messageBox({ title: TITLE, icon: kind || 'info', text, buttons: [{ text: 'ok', value: true }] });
    }

    // ---------------------------------------------------------------- layers

    function push(layer) {
        layers.push(layer);
        renderLayer();
        sh.syncHistory();
    }

    function renderLayer() {
        if (!page) return;
        const t = top();
        page.querySelector('.wxl-main').hidden = !!t;
        const host = page.querySelector('.wxl-layer');
        host.hidden = !t;
        if (!t) host.innerHTML = '';
        else if (t.kind === 'device') renderDevice(t, host);
        else if (t.kind === 'item') renderItem(t, host);
        else if (t.kind === 'log') renderLog(host);
        if (isCurrent()) {
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    // ---------------------------------------------------------------- cabinets

    function renderMain() {
        if (!page) return;
        const m = page.querySelector('.wxl-main');
        const up = devices.filter((d) => d.status && !d.status.failed).length;
        m.querySelector('.wxl-nodes').textContent = loaded ? `Nodes: ${up}/${devices.length}` : 'Nodes: -';
        m.querySelector('.wxl-band').classList.toggle('is-up', up > 0);
        if (!devices.some((d) => d.key === selectedKey)) selectedKey = devices[0] ? devices[0].key : null;
        m.querySelector('.wxl-list').innerHTML = devices.map((d) => {
            const sel = d.key === selectedKey;
            const st = d.status;
            const led = `<span class="wxl-led${st && !st.failed ? ' is-on' : ''}"${st && colour(st.color) ? ` style="--led:${colour(st.color)}"` : ''}></span>`;
            return `<div class="wxl-row${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-dev="${esc(d.key)}">`
                + `<span class="wxl-row-ico">${icon(d.icon)}</span>`
                + `<span class="wxl-row-name">${esc(d.name)}</span>`
                + `<span class="wxl-row-right">${led}</span>`
                + `<span class="wxl-row-sub">${lcd(st)}${badges(d.badges)}<span class="wxl-dim">${d.items} function${d.items === 1 ? '' : 's'}</span></span></div>`;
        }).join('');
        const note = m.querySelector('.wxl-note');
        note.hidden = !!devices.length || !loaded;
        note.textContent = listError ? `${listError}\n\nMenu > Poll All tries again.` : 'No cabinets are registered. Import menu.json from the desktop console (File > Import Menu Definition).';
        if (isCurrent() && !top()) sh.refreshSoftKeys();
    }

    function selectRow(key) {
        selectedKey = key;
        page.querySelectorAll('.wxl-main .wxl-row').forEach((r) => {
            const on = r.dataset.dev === key;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function openDevice(key) {
        if (!key) return;
        selectedKey = key;
        push({ kind: 'device', key });
        void poll(key, { force: false });
    }

    // ---------------------------------------------------------------- cabinet

    function itemAt(key, path) {
        const s = snaps.get(key);
        if (!s) return null;
        let list = s.items;
        let it = null;
        for (const i of String(path).split('.').map(Number)) { it = list && list[i]; list = it && it.children; }
        return it;
    }

    function controlText(it) {
        if (it.toggle) {
            const lit = it.toggle.find((b) => b.active);
            return `${it.toggle.map((b) => b.label).join(' / ')}${lit ? `, lit: ${lit.label}` : ''}`;
        }
        if (it.kind === 'slider') return `Level 0-100${it.append || ''}`;
        if (it.kind === 'button') return 'Command (Take)';
        if (it.kind === 'folder') return `${it.children.length} function${it.children.length === 1 ? '' : 's'}`;
        return 'Indicator';
    }

    function renderDevice(t, host) {
        const d = deviceOf(t.key);
        const s = snaps.get(t.key);
        const name = (s && s.name) || (d && d.name) || t.key;
        let list;
        if (!s) {
            list = '<p class="wxl-note">Polling cabinet, please wait...</p>';
        } else {
            const rows = [];
            const walk = (items, prefix, depth) => items.forEach((it, i) => {
                const p = prefix.concat(i);
                const path = p.join('.');
                const folder = it.children.length > 0;
                const opened = folder && open.has(`${t.key}|${path}`);
                const state = it.kind === 'folder' && !it.status ? '' : lcd(it.status, it.append);
                rows.push(`<div class="wxl-row wxl-frow${folder ? ' is-folder' : ''}" data-path="${path}" style="--d:${depth}">`
                    + `<span class="wxl-row-ico">${folder ? `<button type="button" class="wxl-twisty" data-twisty="${path}" aria-label="${opened ? 'Collapse' : 'Expand'}">${opened ? '-' : '+'}</button>` : ''}${icon(it.icon)}</span>`
                    + `<span class="wxl-row-name">${esc(it.text)}</span>`
                    + `<span class="wxl-row-right">${state}</span>`
                    + `<span class="wxl-row-sub">${badges(it.badges)}${it.warning ? '<span class="wxl-warn">Asks first</span>' : ''}<span class="wxl-dim">${esc(controlText(it))}</span></span></div>`);
                if (opened) walk(it.children, p, depth + 1);
            });
            walk(s.items, [], 0);
            list = rows.join('') || '<p class="wxl-note">This cabinet has no functions.</p>';
        }
        host.innerHTML = `<div class="wxl-card">
            <div class="wxl-card-head">${icon((s && s.icon) || (d && d.icon))}<span class="wxl-card-name">${esc(name)}</span>${badges((s && s.badges) || (d && d.badges))}</div>
            <div class="wxl-statusline"><span>Status:</span>${lcd((s && s.status) || (d && d.status))}<span class="wxl-dim">${s ? `Polled ${clock(s.polledAt)}` : 'Polling...'}</span></div>
            <div class="wxl-scroll wxl-flist">${list}</div>
        </div>`;
    }

    function toggleOpen(key, path) {
        const k = `${key}|${path}`;
        if (open.has(k)) open.delete(k); else open.add(k);
        renderLayer();
    }

    function expandAll(key, on) {
        const s = snaps.get(key);
        if (!s) return;
        const walk = (items, prefix) => items.forEach((it, i) => {
            const p = prefix.concat(i);
            if (!it.children.length) return;
            const k = `${key}|${p.join('.')}`;
            if (on) open.add(k); else open.delete(k);
            walk(it.children, p);
        });
        walk(s.items, []);
        renderLayer();
    }

    function cabinetInfo(key) {
        const d = deviceOf(key);
        const s = snaps.get(key);
        if (!d) return;
        void sh.messageBox({
            title: 'Properties',
            icon: 'info',
            modal: true,
            text: `Cabinet: ${d.name}\nNode ID: ${d.key.toUpperCase()}\nState: ${d.status ? d.status.text : '-'}\nFunctions: ${d.items}\nLast poll: ${s ? clock(s.polledAt) : '-'}`,
            buttons: [{ text: 'ok', value: true }]
        });
    }

    // ---------------------------------------------------------------- function page

    function openItem(key, path) {
        const it = itemAt(key, path);
        if (!it) return;
        const lit = it.toggle ? it.toggle.findIndex((b) => b.active) : -1;
        const level = Math.max(0, Math.min(100, parseInt(it.status && it.status.text, 10) || 0));
        push({ kind: 'item', key, path, tab: 'control', choice: lit >= 0 ? lit : 0, level });
    }

    function renderItem(t, host) {
        const it = itemAt(t.key, t.path);
        const d = deviceOf(t.key);
        if (!it) { host.innerHTML = '<p class="wxl-note">This function is no longer in the menu.</p>'; return; }
        let body;
        if (t.tab === 'properties') {
            const e = it.endpoints || { toggle: [] };
            const row = (k, v) => (v ? `<div class="wxl-prow"><span class="wxl-plabel">${esc(k)}:</span><span class="wxl-pvalue">${esc(v)}</span></div>` : '');
            body = row('Function', it.text) + row('Cabinet', d ? d.name : t.key) + row('Type', KIND[it.kind]) + row('State', it.status ? it.status.text + (it.append || '') : '')
                + row('Status endpoint', e.status) + row('Command endpoint', e.action) + row('Level endpoint', e.slider ? `${e.slider}<0-100>` : '')
                + (e.toggle || []).map((u, i) => row(`Position ${it.toggle && it.toggle[i] ? it.toggle[i].label : i}`, u)).join('')
                + row('Interlock', it.warning ? 'Operator confirmation required' : 'None') + row('Sub-functions', it.children.length ? String(it.children.length) : '');
        } else {
            let ctl = '';
            if (it.toggle) {
                ctl = `<div class="wm-form-sub">Position:</div><div class="wxl-positions">${it.toggle.map((b, i) => `<label class="wm-check wxl-pos${b.active ? ' is-lit' : ''}"><input type="radio" name="wxl-pos" value="${i}"${t.choice === i ? ' checked' : ''}><span>${b.icon ? `<img class="wxl-ico" src="${iconUrl(b.icon)}" alt="" draggable="false">` : ''}${esc(b.label)}</span>${b.active ? `<span class="wxl-lit"${colour(b.bg) ? ` style="--lamp:${colour(b.bg)}"` : ''}>LIT</span>` : ''}</label>`).join('')}</div>
                    <p class="wxl-hint">Pick a position, then Set.</p>`;
            } else if (it.kind === 'slider') {
                ctl = it.status && !it.status.failed
                    ? `<div class="wm-form-sub">Level:</div><div class="wxl-level"><input type="range" class="wxl-range" min="0" max="100" step="1" value="${t.level}"><b class="wxl-level-val">${t.level}${esc(it.append)}</b></div><p class="wxl-hint">Move the level, then Set.</p>`
                    : '<p>The level cannot be read, so it cannot be set.</p>';
            } else if (it.kind === 'button') {
                ctl = `<p>Take sends this command to ${esc(d ? d.name : t.key)}.</p>`;
            } else {
                ctl = `<p>${it.kind === 'folder' ? 'A function group: open it in the list to see its functions.' : 'An indicator: it has nothing to send.'}</p>`;
            }
            body = `<div class="wm-form-row"><span class="wm-form-label">State:</span><span class="wm-form-value">${it.kind === 'folder' && !it.status ? '-' : lcd(it.status, it.append)}</span></div>
                ${it.warning ? '<p class="wxl-warnline"><span class="wxl-warn">Asks first</span> The cabinet asks for confirmation before this runs.</p>' : ''}
                ${ctl}`;
        }
        host.innerHTML = `<div class="wxl-form">
            <div class="wm-form-hdr">${icon(it.icon)}<span>${esc(it.text)}</span></div>
            <div class="wxl-scroll"><div class="wm-form">${body}</div></div>
            <div class="wm-tabs" role="tablist"><button type="button" class="wm-tab" role="tab" data-itab="control" aria-selected="${t.tab === 'control'}">Control</button><button type="button" class="wm-tab" role="tab" data-itab="properties" aria-selected="${t.tab === 'properties'}">Properties</button></div>
        </div>`;
    }

    /**
     * Send a command: { op: 'toggle' | 'slider' | 'send', value }. Asks first, always; a function with
     * an interlock comes back with the cabinet's warning (r.confirm), asked as its own box, and only a
     * yes there sends it confirmed.
     */
    async function run(key, path, op, value) {
        const it = itemAt(key, path);
        const d = deviceOf(key);
        if (!it || sending) return;
        const cab = d ? d.name : key;
        const what = op === 'toggle' ? `${it.text} -> ${it.toggle[value] ? it.toggle[value].label : value}` : op === 'slider' ? `${it.text} = ${value}${it.append || ''}` : it.text;
        const yes = await sh.messageBox({ title: TITLE, icon: 'question', text: `Send to ${cab}?\n\n${what}`, buttons: [{ text: 'Send', value: true }, { text: 'Cancel', value: false, default: true }] });
        if (yes !== true) return;
        let confirmed = false;
        for (;;) {
            log('CMD', `${key}: ${what}${confirmed ? ' (confirmed)' : ''}`);
            let r;
            sending++;
            sendingTo = cab;
            try {
                r = await sh.busy(() => send('xlink_action', { device: key, path: String(path).split('.').map(Number), op, value, confirmed }), { paint: true, timeout: 35000 });
            } catch (err) {
                sending--;
                const msg = (err && err.message) || 'Failed to get a valid response from the MCU unit';
                log('ERROR', msg, true);
                await box(`System Error\n\n${msg}`, 'error');
                return;
            }
            sending--;
            (r.log || []).forEach(logReq);
            if (r.confirm) {
                const w = r.confirm;
                const ok = await sh.messageBox({
                    title: TITLE,
                    icon: /^(red|#f00|#ff0000)$/i.test(w.iconColor) ? 'error' : 'warning',
                    text: `${w.header}\n\n${w.message}\n\nFunction: ${it.text}`,
                    buttons: [{ text: w.ok || 'OK', value: true }, { text: 'Cancel', value: false, default: true }]
                });
                if (ok !== true) { log('CMD', `${key}: ${what} cancelled by operator`); return; }
                confirmed = true;
                continue;
            }
            if (r.snapshot) absorb(Object.assign({}, r.snapshot, { log: [] }));
            if (!r.ok) await box(`System Error\n\n${r.failure || `The device answered HTTP ${r.code}.`}`, 'error');
            else await box(`Command accepted:\n${what}`, 'info');
            return;
        }
    }

    function itemPrimary(t) {
        const it = itemAt(t.key, t.path);
        if (!it) return null;
        if (it.toggle) return { label: 'Set', action: () => run(t.key, t.path, 'toggle', t.choice) };
        if (it.kind === 'slider') return { label: 'Set', disabled: !(it.status && !it.status.failed), action: () => run(t.key, t.path, 'slider', t.level) };
        if (it.kind === 'button') return { label: 'Take', action: () => run(t.key, t.path, 'send') };
        return null;
    }

    // ---------------------------------------------------------------- Today: XLink quick controls

    /*
     * A Today block (wmShell.registerTodayItem render): the XLink line (tap opens the app), then one
     * line per cabinet: tally LED, name, the state LCD, and its quick control, the cabinet's power
     * selector (a top-level switch named or drawn as power, else its first switch) as small keys, the
     * lit position marked. A key goes through run(): "Send to <cabinet>?" first, then the cabinet's
     * own interlock warning, as in the app. Status is read (xlink_devices / xlink_device polls, no
     * commands) every 60 s while Today is on screen; the block repaints only when its markup changes.
     */
    const TODAY_ID = 'xlink';
    const TODAY_POLL_MS = 60000;
    const POWER_ICONS = new Set(['light-switch-on', 'power-off', 'leaf']);
    const today = { at: 0, loading: false, failed: false, html: null };

    const isAdminUser = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };

    /** The cabinet's quick control: { path, it } for its power switch, else its first switch, else null. */
    function quickOf(key) {
        const s = snaps.get(key);
        if (!s) return null;
        let first = null;
        for (let i = 0; i < s.items.length; i++) {
            const it = s.items[i];
            if (!it.toggle) continue;
            if (POWER_ICONS.has(it.icon) || /power/i.test(it.text)) return { path: String(i), it };
            if (!first) first = { path: String(i), it };
        }
        return first;
    }

    async function todayLoad() {
        const ws = window.wsClient;
        if (today.loading || !ws || (typeof ws.isConnected === 'function' && !ws.isConnected())) return;
        today.loading = true;
        try {
            await loadDevices();
            await Promise.all(devices.map(async (d) => {
                try { absorb(await send('xlink_device', { device: d.key, force: false })); } catch (err) { log('ERROR', `${d.name}: ${(err && err.message) || ''}`, true); }
            }));
            today.failed = false;
        } catch (_) {
            today.failed = true;
        } finally {
            today.at = Date.now();
            today.loading = false;
        }
    }

    function todayRender(el, ctx) {
        if (!isAdminUser()) return false;
        if (!today.loading && Date.now() - today.at >= TODAY_POLL_MS && !sending) void todayLoad();
        if (!el.dataset.wxlBound) {
            el.dataset.wxlBound = '1';
            el.addEventListener('click', (e) => {
                const k = e.target.closest('[data-wxl-key]');
                if (k) {
                    e.stopPropagation();
                    void run(k.dataset.dev, k.dataset.path, 'toggle', Number(k.dataset.wxlKey)).then(() => { today.html = null; });
                    return;
                }
                if (e.target.closest('[data-wxl-open]')) sh.open(APP_ID, { fromStart: true });
            });
        }
        const controls = !ctx || typeof ctx.option !== 'function' || ctx.option('show') !== 'status';
        const up = devices.filter((d) => d.status && !d.status.failed).length;
        let html = `<button type="button" class="wxl-tw-head" data-wxl-open="1">${sh.art.img(ICON)}<b>XLink</b><span>${loaded ? (listError ? 'Not reachable' : `${up}/${devices.length} nodes`) : 'Connecting...'}</span></button>`;
        html += devices.map((d) => {
            const st = d.status;
            const q = controls ? quickOf(d.key) : null;
            const keys = q ? `<span class="wxl-tw-keys" title="${esc(q.it.text)}">${q.it.toggle.map((b, i) => `<button type="button" class="wxl-tw-key${b.active ? ' is-lit' : ''}" data-wxl-key="${i}" data-dev="${esc(d.key)}" data-path="${q.path}"${b.active && colour(b.bg) ? ` style="--lamp:${colour(b.bg)}"` : ''}>${esc(b.label)}</button>`).join('')}</span>` : '';
            return `<div class="wxl-tw-row"><span class="wxl-tw-led${st && !st.failed ? ' is-on' : ''}"${st && colour(st.color) ? ` style="--led:${colour(st.color)}"` : ''}></span>`
                + `<span class="wxl-tw-name" data-wxl-open="1">${esc(d.name)}</span>${lcd(st)}${keys}</div>`;
        }).join('');
        if (html !== today.html) {
            today.html = html;
            el.innerHTML = html;
        }
        // keys wait while a command is on its way
        el.classList.toggle('is-sending', sending > 0);
        return loaded || today.loading;
    }

    /**
     * The 6.5 home screen panel (wmTitanium.js): the node count, then a cabinet a page with its state.
     * Status only: a panel sends no command (the quick controls stay in the app).
     */
    function todayTitanium() {
        if (!isAdminUser()) return null;
        if (!loaded && !today.loading) return null;
        const go = () => sh.open(APP_ID, { fromStart: true });
        const up = devices.filter((d) => d.status && !d.status.failed).length;
        const pages = [{ title: 'XLink', line2: loaded ? (listError ? 'Not reachable' : `${up}/${devices.length} nodes`) : 'Connecting...' }]
            .concat(devices.map((d) => ({ title: d.name, line2: d.status ? (d.status.failed ? 'No response' : (d.status.text || 'Up')) : 'No status' })));
        return { label: 'xlink', icon: 'x:app-xlink-lg', pages, softKey: { label: 'XLink', action: go }, onTap: go };
    }

    // ---------------------------------------------------------------- event log

    function renderLog(host) {
        host.innerHTML = `<div class="wxl-card">
            <div class="wm-form-hdr">Event Log</div>
            <div class="wxl-scroll wxl-log">${logLines.length ? logLines.slice().reverse().map((l) => `<div class="${l.bad ? 'is-bad' : ''}">${esc(l.line)}</div>`).join('') : '<p class="wxl-note">No events yet.</p>'}</div>
        </div>`;
    }

    // ---------------------------------------------------------------- menus and soft keys

    function diagnostics() {
        const lines = devices.map((d) => `${d.key.toUpperCase()}  ${d.name}: ${d.status ? (d.status.failed ? 'NO RESPONSE' : `UP, ${d.status.text}`) : 'NO STATUS'}`);
        const up = devices.filter((d) => d.status && !d.status.failed).length;
        void sh.messageBox({ title: 'Network Diagnostics', icon: 'info', modal: true, text: `${lines.join('\n') || 'No nodes.'}\n\n${up} of ${devices.length} node(s) responding.`, buttons: [{ text: 'ok', value: true }] });
    }

    const autoPollItem = () => ({ label: 'Auto Poll (60 s)', checked: autoPoll, action: () => { autoPoll = !autoPoll; } });
    const logItem = () => ({ label: 'Event Log', action: () => push({ kind: 'log' }) });

    function mainMenu() {
        return [
            { label: 'Open', disabled: !selectedKey, action: () => openDevice(selectedKey) },
            { label: 'Properties', disabled: !selectedKey, action: () => cabinetInfo(selectedKey) },
            '-',
            { label: 'Poll All', action: pollAll },
            { label: 'Network Diagnostics', disabled: !devices.length, action: diagnostics },
            logItem(),
            '-',
            autoPollItem(),
            { label: 'About XLink', action: () => sh.messageBox({ title: TITLE, icon: 'info', modal: true, text: 'XLink Operator Console Mobile\nAmusementVISION 2024 Network Management Suite\n\nThe cabinets\' control menu for phones.', buttons: [{ text: 'ok', value: true }] }) }
        ];
    }

    function softKeys() {
        const t = top();
        if (!t) return { left: { label: 'Open', disabled: !selectedKey, action: () => openDevice(selectedKey) }, right: { label: 'Menu', menu: mainMenu } };
        if (t.kind === 'device') {
            return {
                left: { label: 'Poll', action: () => poll(t.key, { force: true }) },
                right: {
                    label: 'Menu',
                    menu: () => [
                        { label: 'Poll Now', action: () => poll(t.key, { force: true }) },
                        '-',
                        { label: 'Expand All', disabled: !snaps.has(t.key), action: () => expandAll(t.key, true) },
                        { label: 'Collapse All', disabled: !snaps.has(t.key), action: () => expandAll(t.key, false) },
                        '-',
                        { label: 'Properties', action: () => cabinetInfo(t.key) },
                        logItem(),
                        autoPollItem()
                    ]
                }
            };
        }
        if (t.kind === 'item') {
            return {
                left: itemPrimary(t),
                right: { label: 'Menu', menu: () => [{ label: 'Poll Now', action: () => poll(t.key, { force: true }) }, { label: t.tab === 'control' ? 'Properties' : 'Control', action: () => { t.tab = t.tab === 'control' ? 'properties' : 'control'; renderLayer(); } }] }
            };
        }
        if (t.kind === 'log') return { left: { label: 'Clear', disabled: !logLines.length, action: () => { logLines = []; renderLayer(); } }, right: null };
        return { left: null, right: null };
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        layers = [];
        sending = 0;
        p.classList.add('wm-xlink');
        p.innerHTML = `
            <div class="wxl-main">
                <div class="wxl-band"><img class="wxl-logo" src="${A}/xlink-logo.png" alt="XLink" draggable="false"><span class="wxl-band-sub">Operator Console</span><span class="wxl-band-fill"></span><span class="wxl-nodes">Nodes: -</span><span class="wxl-tod">--:--:--</span></div>
                <div class="wxl-head"><span>Cabinet</span><span>State</span></div>
                <div class="wxl-scroll"><div class="wxl-list" role="listbox" aria-label="Cabinets"></div><p class="wxl-note" hidden></p></div>
            </div>
            <div class="wxl-layer" hidden></div>`;
        p.querySelector('.wxl-main .wxl-scroll').addEventListener('click', (e) => {
            const row = e.target.closest('.wxl-row[data-dev]');
            if (!row) return;
            selectRow(row.dataset.dev);
            openDevice(row.dataset.dev);
        });
        const host = p.querySelector('.wxl-layer');
        host.addEventListener('click', (e) => {
            const t = top();
            if (!t) return;
            const tw = e.target.closest('[data-twisty]');
            if (tw && t.kind === 'device') { toggleOpen(t.key, tw.dataset.twisty); return; }
            const row = e.target.closest('.wxl-frow[data-path]');
            if (row && t.kind === 'device') {
                const it = itemAt(t.key, row.dataset.path);
                if (it && it.kind === 'folder') toggleOpen(t.key, row.dataset.path);
                else openItem(t.key, row.dataset.path);
                return;
            }
            const tab = e.target.closest('[data-itab]');
            if (tab && t.kind === 'item') { t.tab = tab.dataset.itab; renderLayer(); }
        });
        host.addEventListener('change', (e) => {
            const t = top();
            if (!t || t.kind !== 'item') return;
            if (e.target.name === 'wxl-pos') { t.choice = Number(e.target.value); host.querySelectorAll('.wxl-pos').forEach((l) => l.classList.toggle('is-picked', l.querySelector('input').checked)); }
            if (e.target.classList.contains('wxl-range')) t.level = Number(e.target.value);
        });
        host.addEventListener('input', (e) => {
            const t = top();
            if (!t || t.kind !== 'item' || !e.target.classList.contains('wxl-range')) return;
            t.level = Number(e.target.value);
            const it = itemAt(t.key, t.path);
            const v = host.querySelector('.wxl-level-val');
            if (v) v.textContent = `${t.level}${(it && it.append) || ''}`;
        });
        renderMain();
    }

    /** The time of day on the band, and the 60 s auto poll of what is on screen (as the desktop polls). */
    function startTick() {
        clearInterval(tick);
        let left = POLL_MS / 1000;
        const tod = () => { const e = page && page.querySelector('.wxl-tod'); if (e) e.textContent = clock(Date.now()); };
        tod();
        tick = setInterval(() => {
            if (!shown || !(sh.onScreen ? sh.onScreen(page) : !document.hidden)) return;
            tod();
            if (!autoPoll || !shown || document.hidden || sending || (sh.isBusy && sh.isBusy())) return;
            if (--left > 0) return;
            left = POLL_MS / 1000;
            const t = top();
            if (t && (t.kind === 'device' || t.kind === 'item')) void poll(t.key, { force: true, quiet: true });
            else if (!t) void reloadList({ quiet: true });
        }, 1000);
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        esc = sh.escapeHtml || esc;
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: ICON,
            inStart: 'programs',
            
            mount,
            show() {
                shown = true;
                renderLayer();
                if (!loaded || Date.now() - loadedAt > 30000) void reloadList({ quiet: loaded });
                startTick();
            },
            hide() {
                shown = false;
                clearInterval(tick);
            },
            onEnd() {
                shown = false;
                clearInterval(tick);
                page = null;
            },
            closeQuestion: () => (sending ? `A command is still on its way to ${sendingTo}. Close XLink?` : null),
            softKeys,
            // X on the cabinet list, ok on a cabinet, a function page and the log (back a step)
            titleKind: () => (top() ? 'ok' : 'close'),
            historyDepth: () => layers.length,
            onBack() {
                if (!layers.length) return false;
                layers.pop();
                renderLayer();
                return true;
            }
        });
        if (typeof sh.registerTodayItem === 'function') {
            sh.registerTodayItem({
                id: TODAY_ID,
                label: 'XLink',
                icon: ICON,
                after: 'tasks',
                options: [{ key: 'show', label: 'Show', choices: [['controls', 'Status and quick controls'], ['status', 'Status only']], value: 'controls' }],
                render: todayRender,
                titanium: todayTitanium
            });
        }
    }

    // tests: state only, no commands
    window.wmXLink = { get state() { return { layers: layers.map((l) => l.kind), devices: devices.length, loaded, listError, snaps: [...snaps.keys()], sending, autoPoll, log: logLines.length }; } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
