/**
 * XLink Operator Console (Yozora #719): the arcade cabinets' control menu, replacing the AVS-Menu web
 * app ("XLink Global Management"). Built like a broadcast control package from around 2010 (the
 * router / switcher panels it borrows from: charcoal panels, tally lamps, backlit keys, a fader, a
 * time-of-day clock), a little dated: a log window nobody reads and a splash that takes too long.
 *
 *   tree        XLink Global Management > each cabinet (menu.json devices, by position)
 *   function list   the cabinet's items: State (the status through replace, on an LCD), Control (toggle
 *               keys or a rocker, a fader, Take), folders open in place ([+]) with their children
 *   event log   every POLL / CHECK / SEND the server made for this console
 *   dialogs     warnings and System Error are Melaton message boxes; About, Properties, Network
 *               Diagnostics are dialog windows the console owns
 *
 * Everything reaches the cabinets through the server (xlink_* packets, modules/xlink.js); the client
 * names a device, an item path and an operation, never a URL.
 *
 *   melatonApps.define('xlink', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const VERSION = '3.02.0117';
    const A = '/melaton-apps/xlink/assets';
    const POLL_S = 60;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
    const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${clock(t)}`; };

    /*
     * menu.json names Font Awesome glyphs (AVS-Menu drew them). The console never draws the glyphs
     * (.cursor/rules/vista-icons-not-fa.mdc): its own icons below, else Vista's 16 px art for the name.
     */
    const ICONS = {
        joystick: 'vista-cmdbar/programs.png',
        video: 'vista-cmdbar/film.png',
        'camera-viewfinder': 'vista-cmdbar/film.png',
        'image-slash': 'vista-cmdbar/ban.png',
        'sensor-triangle-exclamation': 'vista-icons/warning-16.png',
        'rotate-exclamation': 'vista-icons/warning-16.png',
        'exclamation-triangle': 'vista-icons/warning-16.png',
        'triangle-exclamation': 'vista-icons/warning-16.png',
        'light-switch-on': 'vista-cmdbar/power.png',
        'power-off': 'vista-cmdbar/power.png',
        leaf: 'vista-cmdbar/power.png',
        'disc-drive': 'vista-explorer/drive-removable-16.png',
        'volume-slash': 'vista-icons/volume-mute-16.png',
        speakers: 'vista-icons/volume-high-16.png',
        'volume-high': 'vista-icons/volume-high-16.png',
        ethernet: 'vista-cpl/network-16.png',
        'network-wired': 'vista-cpl/network-16.png',
        'circle-nodes': 'vista-icons/net-trusted-16.png',
        tv: 'vista-cmdbar/display.png',
        display: 'vista-cmdbar/display.png',
        fingerprint: 'vista-cmdbar/keyboard.png',
        'credit-card': 'vista-icons/cardspace-16.png',
        'coin-blank': 'vista-cmdbar/add.png',
        'lightbulb-cfl-on': 'vista-cpl/bulb-16.png',
        'lightbulb-on': 'vista-cpl/bulb-16.png',
        'lightbulb-exclamation-on': 'vista-cpl/bulb-16.png',
        'alarm-exclamation': 'vista-cmdbar/clock.png',
        pickaxe: 'vista-cmdbar/tools.png',
        hammer: 'vista-cmdbar/tools.png',
        fan: 'vista-cmdbar/gears.png',
        search: 'vista-cmdbar/find.png',
        person: 'vista-cpl/users-16.png',
        'image-landscape': 'vista-cmdbar/picture.png'
    };
    // XLink's own function icons (GPT Image, scripts/generate-app-icon.js, 32 px in assets/icons), one per
    // name menu.json uses; another name falls back to the Vista art above, then the application icon
    const OWN_ICONS = new Set(['joystick', 'video', 'camera-viewfinder', 'image-slash', 'sensor-triangle-exclamation', 'light-switch-on',
        'disc-drive', 'volume-slash', 'speakers', 'ethernet', 'tv', 'credit-card', 'coin-blank', 'lightbulb-cfl-on', 'alarm-exclamation', 'leaf',
        'circle-nodes', 'lightbulb-exclamation-on', 'pickaxe', 'rotate-exclamation', 'fan', 'hammer', 'lightbulb-on', 'search', 'fingerprint',
        'person', 'image-landscape']);
    const iconUrl = (name) => (OWN_ICONS.has(name) ? `/melaton-apps/xlink/assets/icons/${name}.png` : `/static_images/${ICONS[name] || 'vista-icons/application-16.png'}`);
    const icon = (name) => (name ? `<img class="xl-ico" src="${iconUrl(name)}" alt="" width="16" height="16">` : '<span class="xl-ico"></span>');

    /** A colour from menu.json, made safe for a style attribute. */
    const colour = (c) => (/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(String(c || '').trim()) ? String(c).trim() : '');

    /** Black or white text for a background colour (the menu often gives bg without color). */
    function ink(bg) {
        const probe = doc.createElement('span');
        probe.style.color = bg;
        doc.body.appendChild(probe);
        const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
        probe.remove();
        if (!m) return '#000';
        return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) > 140 ? '#000' : '#fff';
    }

    function badges(list) {
        return (list || []).map((b) => {
            const bg = colour(b.color) || '#fff';
            const fg = colour(b.textColor) || ink(bg);
            return `<span class="xl-badge" style="background:${bg};color:${fg}">${esc(b.text)}</span>`;
        }).join('');
    }

    function lcd(status, append) {
        if (!status) return '<span class="xl-lcd is-empty">----</span>';
        const c = colour(status.color);
        return `<span class="xl-lcd${status.failed ? ' is-failed' : ''}"${c ? ` style="--lcd:${c}"` : ''}>${esc(status.text)}${esc(append || '')}</span>`;
    }

    class Console {
        constructor(app) {
            this.app = app;
            this.devices = [];
            this.snaps = new Map();
            this.node = 'root';
            this.open = new Set();
            this.busy = 0;
            this.countdown = POLL_S;
            this.logLines = [];
            this.autoPoll = true;
            this.showLog = true;
            this.children = new Set();
            this.build();
            void this.boot();
        }

        /**
         * The console's window, built like the other system packages' (perfmon, wordpad): a stable id and
         * window identifier set before openModal (so its place and size are remembered), default and
         * minimum size, the taskbar image, Minimize and Close (the shell adds Maximize to a resizable window), centred on first open, and
         * registered with programFaults. Closing it ends the app; ending the app closes it.
         */
        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window xl-window';
            m.dataset.windowIdentifier = 'melatonXLink';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = `${A}/xlink-32.png`;
            m.dataset.windowDefaultWidth = '920';
            m.dataset.windowDefaultHeight = '660';
            m.dataset.windowMinWidth = '760';
            m.dataset.windowMinHeight = '440';
            m.style.width = '920px';
            m.style.height = `${Math.min(660, root.innerHeight - 60)}px`;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'XLink Operator Console');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/xlink-16.png" alt=""><span>XLink Operator Console</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small xl-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content xl-client"><div class="xl-root"></div></div>`;
            doc.body.appendChild(m);
            this.modal = m;
            const body = m.querySelector('.xl-root');
            const w = { body };
            w.body.innerHTML = `
                <div class="xl-menubar">
                    <span data-xl-menu="file"><u>F</u>ile</span><span data-xl-menu="cabinet"><u>C</u>abinet</span><span data-xl-menu="view"><u>V</u>iew</span><span data-xl-menu="tools"><u>T</u>ools</span><span data-xl-menu="help"><u>H</u>elp</span>
                </div>
                <div class="xl-toolbar">
                    <button type="button" class="xl-tb" data-xl="refresh" title="Poll the selected cabinet now (F5)">Poll</button>
                    <button type="button" class="xl-tb" data-xl="pollall" title="Poll every cabinet">Poll All</button>
                    <span class="xl-tb-sep"></span>
                    <button type="button" class="xl-tb" data-xl="log" title="Show or hide the event log">Log</button>
                    <button type="button" class="xl-tb" data-xl="properties" title="Properties">Properties</button>
                    <span class="xl-tb-fill"></span>
                    <span class="xl-tc" title="Time of day"><small>TOD</small><b class="xl-tc-v">--:--:--</b></span>
                    <span class="xl-link" title="XLink: no nodes"><img src="${A}/xlink-logo.png" alt="XLink" width="67" height="20"></span>
                </div>
                <div class="xl-main">
                    <div class="xl-side"><div class="xl-panehead">Devices</div><div class="xl-tree" tabindex="0"></div></div>
                    <div class="xl-split"></div>
                    <div class="xl-pane">
                        <div class="xl-head"></div>
                        <div class="xl-list" tabindex="0"></div>
                    </div>
                </div>
                <div class="xl-logbox">
                    <div class="xl-logbar"><span>Event Log</span><button type="button" class="xl-mini" data-xl="clearlog">Clear</button><button type="button" class="xl-mini" data-xl="log" title="Hide">x</button></div>
                    <div class="xl-log"></div>
                </div>
                <div class="xl-status"><span class="xl-st-main">Ready</span><span class="xl-st-nodes">Nodes: 0/0</span><span class="xl-st-poll">Auto poll: ${POLL_S}s</span><span class="xl-st-user">OPERATOR (ADMIN)</span><span class="xl-st-clock"></span></div>
                <div class="xl-splash">
                    <div class="xl-splash-box">
                        <div class="xl-splash-band"><span class="xl-logo-band"><img src="${A}/xlink-logo.png" alt="XLink" width="133" height="39"><small>Operator Console</small></span></div>
                        <div class="xl-splash-body">
                            <div>AmusementVISION 2024 Network Management Suite</div>
                            <div>Version ${VERSION}</div>
                            <div class="xl-splash-step">Initializing...</div>
                            <div class="xl-splash-bar"><span></span></div>
                            <div class="xl-splash-copy">Copyright (C) 2004-2024 AmusementVISION. All rights reserved.<br>Licensed to: BlueSteel Arcade</div>
                        </div>
                    </div>
                </div>
                <input type="file" class="xl-file" accept=".json,application/json" hidden>`;
            const q = (s) => w.body.querySelector(s);
            this.el = q;
            const sig = { signal: this.app.signal };
            w.body.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-xl]');
                if (b && !b.disabled) void this.command(b.dataset.xl, b);
            }, sig);
            q('.xl-tree').addEventListener('click', (ev) => {
                const row = ev.target.closest('[data-node]');
                if (row) this.select(row.dataset.node);
            }, sig);
            q('.xl-tree').addEventListener('keydown', (ev) => this.treeKey(ev), sig);
            q('.xl-list').addEventListener('click', (ev) => this.listClick(ev), sig);
            q('.xl-list').addEventListener('dblclick', (ev) => {
                const row = ev.target.closest('.xl-row[data-path]');
                if (!row || ev.target.closest('button, input')) return;
                if (row.classList.contains('is-folder')) this.toggleOpen(row.dataset.path);
                else if (row.dataset.kind === 'button') void this.run(row.dataset.path, 'send');
            }, sig);
            q('.xl-list').addEventListener('change', (ev) => {
                const s = ev.target.closest('input.xl-slider');
                if (s) void this.run(s.dataset.path, 'slider', Number(s.value));
            }, sig);
            q('.xl-list').addEventListener('input', (ev) => {
                const s = ev.target.closest('input.xl-slider');
                if (s) { const o = s.parentNode.querySelector('.xl-slider-val'); if (o) o.textContent = `${s.value}${s.dataset.append || ''}`; }
            }, sig);
            q('.xl-file').addEventListener('change', () => void this.importFile(), sig);
            q('.xl-splash').addEventListener('click', () => this.splashDone(), sig);
            this.splitter(q('.xl-split'), q('.xl-side'));
            w.body.querySelectorAll('[data-xl-menu]').forEach((t) => {
                if (!root.contextMenu) return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.command(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.xlMenu); } }]
                });
            });
            const tick = setInterval(() => this.tick(), 1000);
            this.app.signal.addEventListener('abort', () => clearInterval(tick));
            this.tick();
            m.querySelector('.xl-close').addEventListener('click', () => this.app.exit(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            // before openModal: an id-less window restores the shared 'unknown' geometry
            m.id = 'melatonXLinkModal';
            // F5 polls (Cabinet > Poll Now), through the desktop's keyboard registry so the browser never reloads
            if (typeof root.registerKeyboardListener === 'function') {
                root.registerKeyboardListener({
                    id: `${m.id}.f5`, type: 'whenFocused', modalId: m.id, priority: 80, label: 'Poll now', keys: 'F5', icon: 'fas fa-rotate',
                    handler: (e) => {
                        if (e.key !== 'F5' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
                        e.preventDefault();
                        e.stopPropagation();
                        if (!e.repeat) void this.command('refresh');
                        return true;
                    }
                });
            }
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed || m.hasAttribute('data-window-position-restored')) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: 'XLink Operator Console', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'xlink' }) });
            }
        }

        destroy() {
            if (typeof root.unregisterKeyboardListener === 'function') root.unregisterKeyboardListener(`${this.modal.id}.f5`);
            this.children.forEach((c) => c.close());
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 400);
        }

        splitter(bar, left) {
            bar.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                const x0 = ev.clientX;
                const w0 = left.getBoundingClientRect().width;
                const move = (e) => { left.style.width = `${Math.max(120, Math.min(420, w0 + e.clientX - x0))}px`; };
                const up = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); };
                doc.addEventListener('pointermove', move);
                doc.addEventListener('pointerup', up);
            }, { signal: this.app.signal });
        }

        menu(name) {
            switch (name) {
                case 'file': return [
                    { text: 'Import Menu Definition (menu.json)...', action: 'import-menu' },
                    { separator: true },
                    { text: 'Export Event Log...', action: 'export-log' },
                    { separator: true },
                    { text: 'Exit', action: 'exit' }];
                case 'cabinet': return [
                    { text: 'Poll Now', subtext: 'F5', action: 'refresh' },
                    { text: 'Poll All Cabinets', action: 'pollall' },
                    { separator: true },
                    { text: 'Expand All Folders', action: 'expandall', disabled: !this.deviceKey() },
                    { text: 'Collapse All Folders', action: 'collapseall', disabled: !this.deviceKey() },
                    { separator: true },
                    { text: 'Properties', action: 'properties' }];
                case 'view': return [
                    { text: 'Event Log', action: 'log', showIndicator: true, checked: this.showLog },
                    { text: 'Auto Poll (60 s)', action: 'autopoll', showIndicator: true, checked: this.autoPoll }];
                case 'tools': return [
                    { text: 'Network Diagnostics...', action: 'diag' },
                    { text: 'Options...', action: 'options', disabled: true }];
                case 'help': return [
                    { text: 'Help Topics', action: 'helptopics', disabled: true },
                    { separator: true },
                    { text: 'About XLink Operator Console...', action: 'about' }];
                default: return [];
            }
        }

        async command(a, el) {
            switch (a) {
                case 'exit': this.app.exit(); break;
                case 'refresh': await this.refresh(true); break;
                case 'pollall': await this.pollAll(); break;
                case 'log': this.showLog = !this.showLog; this.modal.classList.toggle('xl-nolog', !this.showLog); break;
                case 'clearlog': this.logLines = []; this.el('.xl-log').innerHTML = ''; break;
                case 'autopoll': this.autoPoll = !this.autoPoll; this.countdown = POLL_S; this.tick(); break;
                case 'expandall': this.expandAll(true); break;
                case 'collapseall': this.expandAll(false); break;
                case 'properties': this.properties(); break;
                case 'about': this.about(); break;
                case 'diag': this.diagnostics(); break;
                case 'import-menu': this.importing = 'menu.json'; this.el('.xl-file').click(); break;
                case 'export-log': this.exportLog(); break;
                case 'toggle': await this.run(el.dataset.path, 'toggle', Number(el.dataset.value)); break;
                case 'send': await this.run(el.dataset.path, 'send'); break;
                case 'open': this.toggleOpen(el.dataset.path); break;
                default: break;
            }
        }

        async send(type, data) {
            let r = await root.wsClient.sendMessage(type, data || {}, false);
            if (r && r.data !== undefined) r = r.data;
            if (r && r.error) {
                const err = new Error(r.error.message || 'XLink error');
                err.details = r.error.details;
                err.code = r.error.code;
                throw err;
            }
            return r;
        }

        setBusy(on, text) {
            this.busy = Math.max(0, this.busy + (on ? 1 : -1));
            this.modal.classList.toggle('xl-busy', this.busy > 0);
            this.el('.xl-st-main').textContent = this.busy > 0 ? (text || 'Communicating...') : 'Ready';
        }

        // ---------------------------------------------------------------- boot

        async boot() {
            const step = (t, p) => { this.el('.xl-splash-step').textContent = t; this.el('.xl-splash-bar span').style.width = `${p}%`; };
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            step('Loading menu definition...', 10);
            this.log('INFO', `XLink Operator Console ${VERSION} started`);
            await wait(350);
            step('Initializing node table...', 30);
            try {
                await this.loadDevices();
                for (let i = 0; i < this.devices.length; i++) {
                    const d = this.devices[i];
                    step(`Contacting ${d.name}... ${d.status && !d.status.failed ? 'OK' : 'NO RESPONSE'}`, 40 + Math.round(50 * (i + 1) / this.devices.length));
                    await wait(220);
                }
            } catch (err) {
                step(`Error: ${err.message}`, 100);
                await wait(600);
            }
            step('Ready.', 100);
            await wait(250);
            this.splashDone();
            const first = this.devices[0];
            this.select(first ? `dev:${first.key}` : 'root');
        }

        splashDone() {
            const s = this.el('.xl-splash');
            if (s) s.remove();
        }

        async loadDevices() {
            this.setBusy(true, 'Reading node table...');
            try {
                const r = await this.send('xlink_devices', {});
                this.devices = r.devices || [];
                this.devices.forEach((d) => this.log('POLL', `${d.name}: ${d.status ? d.status.text : '(no status)'}`, d.status && d.status.failed ? 'err' : ''));
                this.menuError = '';
            } catch (err) {
                this.devices = [];
                this.menuError = (err && (err.details || err.message)) || 'Failed to read the device list';
                this.log('ERROR', this.menuError, 'err');
                throw new Error(this.menuError);
            } finally {
                this.setBusy(false);
                this.renderTree();
            }
        }

        // ---------------------------------------------------------------- tree

        deviceKey() {
            return this.node.startsWith('dev:') ? this.node.slice(4) : '';
        }

        renderTree() {
            const t = this.el('.xl-tree');
            const row = (id, depth, img, text, extra) => `<div class="xl-tnode${this.node === id ? ' is-sel' : ''}" data-node="${id}" style="--d:${depth}">${img}<span>${text}</span>${extra || ''}</div>`;
            let html = row('root', 0, '<img class="xl-ico" src="/static_images/vista-cpl/network-16.png" alt="">', 'XLink Global Management');
            this.devices.forEach((d) => {
                const st = d.status;
                const led = `<span class="xl-tled${st && !st.failed ? '' : ' is-off'}"${st && colour(st.color) ? ` style="--led:${colour(st.color)}"` : ''}></span>`;
                html += row(`dev:${d.key}`, 1, icon(d.icon), esc(d.name), led);
            });
            t.innerHTML = html;
            const online = this.devices.filter((d) => d.status && !d.status.failed).length;
            this.el('.xl-st-nodes').textContent = `Nodes: ${online}/${this.devices.length}`;
            // the XLink plate is lit while a node answers, dark when none does
            const link = this.el('.xl-link');
            link.classList.toggle('is-up', this.devices.length > 0 && online > 0);
            link.title = this.devices.length ? (online ? `XLink: ${online} node(s) linked` : 'XLink: no nodes answering') : 'XLink: offline';
        }

        treeKey(ev) {
            const ids = ['root', ...this.devices.map((d) => `dev:${d.key}`)];
            const i = ids.indexOf(this.node);
            if (ev.key === 'ArrowDown' && i < ids.length - 1) { ev.preventDefault(); this.select(ids[i + 1]); }
            if (ev.key === 'ArrowUp' && i > 0) { ev.preventDefault(); this.select(ids[i - 1]); }
        }

        select(id) {
            this.node = id;
            this.renderTree();
            this.countdown = POLL_S;
            if (id.startsWith('dev:')) {
                const snap = this.snaps.get(this.deviceKey());
                if (snap) this.renderDevice(snap);
                else this.renderPending();
                void this.refresh(false);
            } else this.renderRoot();
        }

        // ---------------------------------------------------------------- panes

        head(img, title, sub) {
            this.el('.xl-head').innerHTML = `<span class="xl-head-ico">${img}</span><span class="xl-head-title">${title}</span><span class="xl-head-sub">${sub || ''}</span>`;
        }

        renderRoot() {
            this.head('<img src="/static_images/vista-cpl/network-16.png" alt="">', 'XLink Global Management', `${this.devices.length} cabinet(s) registered`);
            const rows = this.devices.map((d) => `
                <div class="xl-row" data-path="" data-dev="${esc(d.key)}">
                    <span class="xl-c-name">${icon(d.icon)}<span class="xl-label">${esc(d.name)}</span>${badges(d.badges)}</span>
                    <span class="xl-c-state">${lcd(d.status)}</span>
                    <span class="xl-c-ctl"><button type="button" class="xl-btn" data-xl-dev="${esc(d.key)}">Connect</button></span>
                </div>`).join('');
            this.el('.xl-list').innerHTML = this.columns('Cabinet') + (rows || `<div class="xl-empty">${esc(this.menuError || 'No cabinets are registered.')}<br><br>Use File &gt; Import Menu Definition to load menu.json.</div>`);
        }

        columns(first) {
            return `<div class="xl-cols"><span class="xl-c-name">${first}</span><span class="xl-c-state">State</span><span class="xl-c-ctl">Control</span></div>`;
        }

        renderPending() {
            const d = this.devices.find((x) => x.key === this.deviceKey());
            this.head(icon(d && d.icon), esc(d ? d.name : ''), 'Polling...');
            this.el('.xl-list').innerHTML = `${this.columns('Function')}<div class="xl-empty">Polling cabinet, please wait...<div class="xl-wait"><span></span></div></div>`;
        }

        renderDevice(s) {
            const fresh = !s.cached;
            this.head(icon(s.icon), `${esc(s.name)} ${badges(s.badges)}`, `Status: ${lcd(s.status)} &nbsp; Last poll ${clock(s.polledAt)}${fresh ? '' : ''}`);
            const rows = [];
            const walk = (items, prefix, depth) => items.forEach((it, i) => {
                const p = prefix.concat(i);
                rows.push(this.row(it, p, depth));
                if (it.children.length && this.open.has(`${s.key}|${p.join('.')}`)) walk(it.children, p, depth + 1);
            });
            walk(s.items, [], 0);
            const list = this.el('.xl-list');
            const top = list.scrollTop;
            list.innerHTML = this.columns('Function') + rows.join('');
            list.scrollTop = top;
        }

        row(it, p, depth) {
            const path = p.join('.');
            const key = this.deviceKey();
            const folder = it.children.length > 0;
            const opened = folder && this.open.has(`${key}|${path}`);
            const twisty = folder ? `<button type="button" class="xl-twisty" data-xl="open" data-path="${path}">${opened ? '-' : '+'}</button>` : '<span class="xl-twisty-sp"></span>';
            let ctl = '';
            if (it.toggle) {
                ctl = this.switches(it, path);
            } else if (it.kind === 'slider') {
                const v = Math.max(0, Math.min(100, parseInt(it.status && it.status.text, 10) || 0));
                ctl = it.status && !it.status.failed
                    ? `<span class="xl-slider-box"><input type="range" class="xl-slider" min="0" max="100" step="1" value="${v}" data-path="${path}" data-append="${esc(it.append)}"><span class="xl-slider-val">${v}${esc(it.append)}</span></span>`
                    : '<span class="xl-na">N/A</span>';
            } else if (it.kind === 'button') {
                ctl = `<button type="button" class="xl-btn" data-xl="send" data-path="${path}">Take</button>`;
            } else if (folder) {
                ctl = `<button type="button" class="xl-btn" data-xl="open" data-path="${path}">${opened ? 'Close' : 'Open'}</button>`;
            }
            const warn = it.warning ? '<img class="xl-warnmark" src="/static_images/vista-icons/warning-16.png" alt="" title="Asks for confirmation">' : '';
            // no status: an unlit LCD on toggles (AVS-Menu showed none; the switch still reads as a panel), else nothing
            const state = it.kind === 'slider' || (!it.status && it.kind !== 'toggle') ? '' : lcd(it.status, it.append);
            return `<div class="xl-row${folder ? ' is-folder' : ''}${depth ? ' is-child' : ''}" data-path="${path}" data-kind="${it.kind}" style="--d:${depth}">
                <span class="xl-c-name">${twisty}${icon(it.icon)}<span class="xl-label">${esc(it.text)}</span>${badges(it.badges)}${warn}</span>
                <span class="xl-c-state">${state}</span>
                <span class="xl-c-ctl">${ctl}</span>
            </div>`;
        }

        /**
         * A function's switch, drawn as panel hardware: a plain I / O pair is a rocker switch (the pressed
         * half is the lit position); any other set is a bank of illuminated push keys on a bezel, the lit
         * key's lamp in the menu's colour (bg), green when the menu gives none.
         */
        switches(it, path) {
            const t = it.toggle;
            const lampOf = (b) => colour(b.bg) || (b.active ? '#39ff5a' : '');
            if (t.length === 2 && t[0].label === 'I' && t[1].label === 'O' && !t[0].icon && !t[1].icon) {
                const on = t[0].active;
                const off = t[1].active;
                const lit = on ? t[0] : off ? t[1] : null;
                const lamp = lit ? lampOf(lit) : '';
                return `<span class="xl-rocker${on ? ' is-on' : off ? ' is-off' : ''}"${lamp ? ` style="--lamp:${lamp}"` : ''}>
                    <button type="button" class="xl-rk xl-rk-i" data-xl="toggle" data-path="${path}" data-value="0" title="I (On)">I</button><button type="button" class="xl-rk xl-rk-o" data-xl="toggle" data-path="${path}" data-value="1" title="O (Off)">O</button></span>`;
            }
            return `<span class="xl-panel">${t.map((b, i) => {
                const lamp = b.active ? lampOf(b) : '';
                const face = b.icon ? `<img src="${iconUrl(b.icon)}" alt="${esc(b.label)}" width="16" height="16">` : esc(b.label);
                return `<button type="button" class="xl-key${b.active ? ' is-lit' : ''}" data-xl="toggle" data-path="${path}" data-value="${i}" title="${esc(b.label)}"${lamp ? ` style="--lamp:${lamp}"` : ''}><span class="xl-lamp"></span><span class="xl-cap">${face}</span></button>`;
            }).join('')}</span>`;
        }

        listClick(ev) {
            const conn = ev.target.closest('[data-xl-dev]');
            if (conn) { this.select(`dev:${conn.dataset.xlDev}`); return; }
            const row = ev.target.closest('.xl-row');
            this.el('.xl-list').querySelectorAll('.xl-row.is-sel').forEach((r) => r.classList.remove('is-sel'));
            if (row) row.classList.add('is-sel');
        }

        toggleOpen(path) {
            const k = `${this.deviceKey()}|${path}`;
            if (this.open.has(k)) this.open.delete(k);
            else this.open.add(k);
            const s = this.snaps.get(this.deviceKey());
            if (s) this.renderDevice(s);
        }

        expandAll(on) {
            const s = this.snaps.get(this.deviceKey());
            if (!s) return;
            const walk = (items, prefix) => items.forEach((it, i) => {
                const p = prefix.concat(i);
                if (it.children.length) {
                    const k = `${s.key}|${p.join('.')}`;
                    if (on) this.open.add(k); else this.open.delete(k);
                    walk(it.children, p);
                }
            });
            walk(s.items, []);
            this.renderDevice(s);
        }

        itemAt(path) {
            const s = this.snaps.get(this.deviceKey());
            if (!s) return null;
            let list = s.items;
            let it = null;
            for (const i of String(path).split('.').map(Number)) { it = list && list[i]; list = it && it.children; }
            return it;
        }

        // ---------------------------------------------------------------- polling and actions

        async refresh(force) {
            const key = this.deviceKey();
            if (!key) {
                if (this.node === 'root') { try { await this.loadDevices(); } catch (_) { /* shown */ } this.renderRoot(); }
                return;
            }
            this.setBusy(true, `Polling ${key}...`);
            try {
                const s = await this.send('xlink_device', { device: key, force });
                this.absorb(s);
            } catch (err) {
                this.log('ERROR', `${key}: ${(err && (err.details || err.message)) || 'poll failed'}`, 'err');
                if (!this.snaps.has(key) && this.deviceKey() === key) {
                    this.el('.xl-list').innerHTML = `${this.columns('Function')}<div class="xl-empty">Communication error.<br>${esc((err && (err.details || err.message)) || '')}</div>`;
                }
            } finally {
                this.setBusy(false);
            }
        }

        absorb(s) {
            if (!s || !s.key) return;
            if (!s.cached) (s.log || []).forEach((l) => this.logReq(l));
            this.snaps.set(s.key, s);
            const d = this.devices.find((x) => x.key === s.key);
            if (d) { d.status = s.status; this.renderTree(); }
            if (this.deviceKey() === s.key) this.renderDevice(s);
        }

        async pollAll() {
            try { await this.loadDevices(); } catch (_) { return; }
            await Promise.all(this.devices.map(async (d) => {
                try { this.absorb(await this.send('xlink_device', { device: d.key, force: true })); } catch (err) { this.log('ERROR', `${d.name}: ${err.details || err.message}`, 'err'); }
            }));
            if (this.node === 'root') this.renderRoot();
        }

        async run(path, op, value, confirmed) {
            const key = this.deviceKey();
            const it = this.itemAt(path);
            if (!key || !it) return;
            const what = op === 'toggle' ? `${it.text} -> ${it.toggle[value] ? it.toggle[value].label : value}` : op === 'slider' ? `${it.text} = ${value}${it.append}` : it.text;
            this.setBusy(true, `Sending command: ${what}`);
            this.log('CMD', `${key}: ${what}${confirmed ? ' (confirmed)' : ''}`);
            let r;
            try {
                r = await this.send('xlink_action', { device: key, path: path.split('.').map(Number), op, value, confirmed: !!confirmed });
            } catch (err) {
                this.setBusy(false);
                this.log('ERROR', (err && (err.details || err.message)) || 'command failed', 'err');
                await this.error((err && (err.details || err.message)) || 'Failed to get a valid response from the MCU unit');
                return;
            }
            this.setBusy(false);
            (r.log || []).forEach((l) => this.logReq(l));
            if (r.confirm) {
                const ok = await this.confirm(r.confirm, it);
                if (ok) await this.run(path, op, value, true);
                else this.log('CMD', `${key}: ${what} cancelled by operator`);
                return;
            }
            if (r.snapshot) this.absorb({ ...r.snapshot, log: [] });
            if (!r.ok) await this.error(r.failure || `The device answered HTTP ${r.code}.`);
            else this.flash(`Command accepted: ${what}`);
        }

        flash(t) {
            const s = this.el('.xl-st-main');
            s.textContent = t;
            clearTimeout(this.flashT);
            this.flashT = setTimeout(() => { if (!this.busy) s.textContent = 'Ready'; }, 4000);
        }

        tick() {
            const now = clock(Date.now());
            this.el('.xl-st-clock').textContent = now;
            this.el('.xl-tc-v').textContent = now;
            const p = this.el('.xl-st-poll');
            if (!this.autoPoll) { p.textContent = 'Auto poll: OFF'; return; }
            if (!this.busy && !this.dialogOpen) this.countdown--;
            p.textContent = `Next poll: ${pad(Math.max(0, this.countdown))}s`;
            if (this.countdown <= 0) { this.countdown = POLL_S; void this.refresh(true); }
        }

        // ---------------------------------------------------------------- event log

        log(verb, text, cls) {
            this.pushLog(`${clock(Date.now())}  ${verb.padEnd(5)} ${text}`, cls);
        }

        logReq(l) {
            const res = l.ok ? `${l.code} OK` : (l.code ? `${l.code} NG` : `ERR ${l.error || ''}`.trim());
            this.pushLog(`${clock(l.t)}  ${String(l.verb).padEnd(5)} GET ${l.url}  ->  ${res}  (${l.ms} ms)`, l.ok ? '' : 'err');
        }

        pushLog(line, cls) {
            this.logLines.push(line);
            if (this.logLines.length > 500) this.logLines.shift();
            const box = this.el('.xl-log');
            const div = doc.createElement('div');
            if (cls) div.className = `is-${cls}`;
            div.textContent = line;
            box.appendChild(div);
            while (box.childElementCount > 500) box.firstChild.remove();
            box.scrollTop = box.scrollHeight;
        }

        exportLog() {
            const blob = new Blob([`${this.logLines.join('\r\n')}\r\n`], { type: 'text/plain' });
            const a = doc.createElement('a');
            a.href = URL.createObjectURL(blob);
            const d = new Date();
            a.download = `XLINK_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.LOG`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }

        // ---------------------------------------------------------------- dialogs

        /**
         * A dialog window of the console's own (About, Properties, Network Diagnostics): a
         * real desktop window owned by the console (its caption takes the console's icon, centred on it),
         * fixed size, the console's grey client inside. Resolves with the button value (null on close).
         */
        dialog(o) {
            const id = `melatonXLinkDialog-${++dialogSeq}`;
            const m = doc.createElement('div');
            m.className = `modal hidden on-top xl-window xl-child ${o.cls || ''}`;
            m.id = id;
            m.dataset.windowIdentifier = `melatonXLink-${o.kind || 'dialog'}`;
            m.dataset.windowRestorePosition = 'false';
            m.dataset.windowRestoreSize = 'false';
            m.dataset.windowFixedSize = o.resizable ? 'false' : 'true';
            if (o.resizable) m.classList.add('resizeable-window');
            m.dataset.windowClient = 'light';
            m.dataset.iconOwnerId = this.modal.id;
            m.dataset.parentModalId = this.modal.id;
            m.dataset.taskbarIcon = `${A}/xlink-32.png`;
            if (o.width) { m.style.width = `${o.width}px`; m.dataset.windowDefaultWidth = String(o.width); }
            if (o.height) { m.style.height = `${o.height}px`; m.dataset.windowDefaultHeight = String(o.height); }
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', o.title);
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/xlink-16.png" alt=""><span>${esc(o.title)}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls"><button type="button" class="btn-danger close-btn btn-small xl-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button></div>
                <div class="modal-content xl-client"><div class="xl-root xl-dlg">
                    <div class="xl-dlg-body">${o.body}</div>
                    <div class="xl-dlg-btns">${o.buttons.map((b) => `<button type="button" class="xl-btn${b.def ? ' is-def' : ''}" data-v="${esc(b.value)}">${esc(b.text)}</button>`).join('')}</div>
                </div></div>`;
            doc.body.appendChild(m);
            return new Promise((resolve) => {
                let done = false;
                const ctl = new AbortController();
                const finish = (v) => {
                    if (done) return;
                    done = true;
                    ctl.abort();
                    this.children.delete(handle);
                    try { call('closeModal', m); } catch (_) { /* gone */ }
                    setTimeout(() => m.remove(), 400);
                    resolve(v);
                };
                const handle = { close: () => finish(null) };
                this.children.add(handle);
                m.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-v]');
                    if (b) finish(b.dataset.v);
                    else if (ev.target.closest('.xl-close')) finish(null);
                }, { signal: ctl.signal });
                m.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape') { ev.stopPropagation(); finish(null); }
                }, { signal: ctl.signal });
                doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                    if (e && e.detail && e.detail.id === id && e.detail.type === 'closed') finish(null);
                }, { signal: ctl.signal });
                call('openModal', m);
                m.classList.remove('hidden');
                requestAnimationFrame(() => {
                    const r = m.getBoundingClientRect();
                    const o2 = this.modal.getBoundingClientRect();
                    call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round(o2.left + (o2.width - r.width) / 2)), Math.max(0, Math.round(o2.top + (o2.height - r.height) / 2)));
                    const def = m.querySelector('.is-def') || m.querySelector('.xl-dlg-btns button');
                    if (def) def.focus({ preventScroll: true });
                });
            });
        }

        /**
         * Message boxes are the system's (a 2011 program calls MessageBox): Melaton's message box with the
         * warning or error icon, titled with the program's name.
         */
        async messageBox(text, buttons, kind) {
            this.dialogOpen = (this.dialogOpen || 0) + 1;
            try {
                return await call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, buttons, null, {
                    title: 'XLink Operator Console',
                    icon: kind === 'error' ? 'fas fa-circle-xmark' : 'fas fa-triangle-exclamation',
                    width: 400
                });
            } finally {
                this.dialogOpen--;
            }
        }

        async confirm(w, it) {
            const text = `${w.header}\n\n${w.message}${it ? `\n\nFunction: ${it.text}` : ''}`;
            const v = await this.messageBox(text, [
                { text: w.ok || 'OK', value: 'ok', className: 'btn-standard' },
                { text: 'Cancel', value: null, className: 'btn-standard primary' }
            ], /^(red|#f00|#ff0000)$/i.test(w.iconColor) ? 'error' : 'warning');
            return v === 'ok';
        }

        async error(message) {
            await this.messageBox(`System Error\n\n${message}`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], 'error');
        }

        properties() {
            const key = this.deviceKey();
            const row = this.el('.xl-list .xl-row.is-sel[data-path]');
            const it = key && row && row.dataset.path ? this.itemAt(row.dataset.path) : null;
            const d = this.devices.find((x) => x.key === key);
            let body;
            if (it) {
                const e = it.endpoints;
                const line = (k, v) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
                body = `<table class="xl-props">
                    ${line('Function', it.text)}${line('Type', { toggle: 'Selector switch', slider: 'Analog level', button: 'Command', folder: 'Function group', info: 'Indicator' }[it.kind])}
                    ${line('State', it.status ? it.status.text + it.append : '')}${line('Status endpoint', e.status)}${line('Command endpoint', e.action)}${line('Level endpoint', e.slider ? `${e.slider}<0-100>` : '')}
                    ${e.toggle.map((u, i) => line(`Position ${it.toggle && it.toggle[i] ? it.toggle[i].label : i}`, u)).join('')}
                    ${line('Interlock', it.warning ? 'Operator confirmation required' : '')}${line('Sub-functions', it.children.length ? String(it.children.length) : '')}</table>`;
            } else if (d) {
                const s = this.snaps.get(key);
                body = `<table class="xl-props"><tr><th>Cabinet</th><td>${esc(d.name)}</td></tr><tr><th>Node ID</th><td>${esc(d.key.toUpperCase())}</td></tr><tr><th>State</th><td>${esc(d.status ? d.status.text : '-')}</td></tr><tr><th>Functions</th><td>${d.items}</td></tr><tr><th>Last poll</th><td>${s ? stamp(s.polledAt) : '-'}</td></tr></table>`;
            } else {
                body = `<table class="xl-props"><tr><th>Cabinets</th><td>${this.devices.length}</td></tr><tr><th>Poll interval</th><td>${POLL_S} s</td></tr><tr><th>Console</th><td>${VERSION}</td></tr></table>`;
            }
            void this.dialog({ title: 'Properties', kind: 'properties', body, buttons: [{ text: 'OK', value: 'ok', def: true }] });
        }

        async diagnostics() {
            const lines = this.devices.map((d) => `${d.key.toUpperCase().padEnd(8)} ${d.name.padEnd(14)} ${d.status ? (d.status.failed ? 'NO RESPONSE' : `UP   ${d.status.text}`) : 'NO STATUS'}`);
            void this.dialog({
                title: 'Network Diagnostics',
                kind: 'diagnostics',
                body: `<pre class="xl-pre">XLINK NETWORK DIAGNOSTICS\n-------------------------\nNODE     CABINET        RESULT\n${esc(lines.join('\n'))}\n\n${this.devices.filter((d) => d.status && !d.status.failed).length} of ${this.devices.length} node(s) responding.</pre>`,
                buttons: [{ text: 'OK', value: 'ok', def: true }]
            });
        }

        about() {
            void this.dialog({
                title: 'About XLink Operator Console',
                kind: 'about',
                cls: 'xl-about',
                body: `<div class="xl-about-band"><span class="xl-logo-band"><img src="${A}/xlink-logo.png" alt="XLink" width="133" height="39"><small>Operator Console</small></span></div>
                    <div class="xl-about-text">AmusementVISION 2024 Network Management Suite<br>Version ${VERSION} (Build 2024/03/12)<br>Copyright (C) 2004-2024 AmusementVISION.<br>All rights reserved.<br><br>Licensed to: BlueSteel Arcade<br>Serial: AVSX-0302-7738-1145<br><br>Node table: ${this.devices.length} cabinet(s)</div>`,
                buttons: [{ text: 'OK', value: 'ok', def: true }]
            });
        }

        async importFile() {
            const input = this.el('.xl-file');
            const f = input.files && input.files[0];
            input.value = '';
            if (!f) return;
            const name = this.importing || 'menu.json';
            try {
                const text = await f.text();
                JSON.parse(text);
                await this.send('xlink_save', { name, text });
                this.log('INFO', `${name} imported from ${f.name}`);
                this.snaps.clear();
                await this.loadDevices();
                this.select(this.node);
                this.flash(`${name} imported.`);
            } catch (err) {
                await this.error(`The file could not be imported.\n${(err && (err.details || err.message)) || ''}`);
            }
        }
    }

    let running = null;
    let dialogSeq = 0;

    function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const c = new Console(app);
        running = c;
        app.onExit(() => { if (running === c) running = null; c.destroy(); });
    }

    root.melatonXLink = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('xlink', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
