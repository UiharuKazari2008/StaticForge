/**
 * XLink Operator Console (Yozora #719): the arcade cabinets' control menu, replacing the AVS-Menu web
 * app ("XLink Global Management"). Built to feel like the operator software that ships on a CD with
 * the cabinets: Windows 2000 grey, bevels everywhere, an LCD strip per status, a log window nobody
 * reads and a splash screen that takes a little too long.
 *
 *   tree        XLink Global Management > each cabinet (menu.json devices, by position) > Saved Captures
 *   function list   the cabinet's items: State (the status through replace, on an LCD), Control (toggle
 *               buttons, a trackbar, Execute), folders open in place ([+]) with their children
 *   event log   every POLL / CHECK / SEND the server made for this console
 *   dialogs     the item's warning (Reboot Required ...), System Error, Properties, About
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
    const POLL_S = 60;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
    const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${clock(t)}`; };

    /*
     * menu.json names Font Awesome glyphs (AVS-Menu drew them). The console draws Vista's own 16 px art
     * for them instead (.cursor/rules/vista-icons-not-fa.mdc); a name with no entry gets the generic
     * application icon.
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
    const iconUrl = (name) => `/static_images/${ICONS[name] || 'vista-icons/application-16.png'}`;
    const icon = (name) => `<img class="xl-ico" src="${iconUrl(name)}" alt="" width="16" height="16">`;

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
            this.build();
            void this.boot();
        }

        build() {
            const w = this.app.openWindow({ title: 'XLink Operator Console', width: 900, minWidth: 640 });
            this.win = w;
            this.modal = w.modal;
            this.modal.classList.add('xl-window');
            // openWindow sizes the width only (the shell falls back to its 150 px minimum height);
            // the console fills its window, so give it a height unless a saved size is usable
            this.modal.dataset.windowMinHeight = '420';
            if (!(parseFloat(this.modal.style.height) >= 420)) this.modal.style.height = `${Math.min(640, root.innerHeight - 80)}px`;
            w.body.classList.add('xl-root');
            w.body.innerHTML = `
                <div class="xl-menubar">
                    <span data-xl-menu="file"><u>F</u>ile</span><span data-xl-menu="cabinet"><u>C</u>abinet</span><span data-xl-menu="view"><u>V</u>iew</span><span data-xl-menu="tools"><u>T</u>ools</span><span data-xl-menu="help"><u>H</u>elp</span>
                </div>
                <div class="xl-toolbar">
                    <button type="button" class="xl-tb" data-xl="refresh" title="Poll the selected cabinet now (F5)"><img src="/static_images/vista-cmdbar/refresh.png" alt="">Poll</button>
                    <button type="button" class="xl-tb" data-xl="pollall" title="Poll every cabinet"><img src="/static_images/vista-cmdbar/programs.png" alt="">Poll All</button>
                    <span class="xl-tb-sep"></span>
                    <button type="button" class="xl-tb" data-xl="captures" title="Saved Captures"><img src="/static_images/vista-cmdbar/picture.png" alt="">Captures</button>
                    <button type="button" class="xl-tb" data-xl="log" title="Show or hide the event log"><img src="/static_images/vista-cmdbar/text-document.png" alt="">Event Log</button>
                    <span class="xl-tb-sep"></span>
                    <button type="button" class="xl-tb" data-xl="properties" title="Properties"><img src="/static_images/vista-cmdbar/properties.png" alt="">Properties</button>
                    <span class="xl-tb-fill"></span>
                    <span class="xl-link"><span class="xl-led"></span><span class="xl-link-text">OFFLINE</span></span>
                </div>
                <div class="xl-main">
                    <div class="xl-tree" tabindex="0"></div>
                    <div class="xl-split"></div>
                    <div class="xl-pane">
                        <div class="xl-head"></div>
                        <div class="xl-list" tabindex="0"></div>
                    </div>
                </div>
                <div class="xl-logbox">
                    <div class="xl-logbar"><span>Event Log</span><button type="button" data-xl="clearlog">Clear</button><button type="button" data-xl="log" title="Hide">x</button></div>
                    <div class="xl-log"></div>
                </div>
                <div class="xl-status"><span class="xl-st-main">Ready</span><span class="xl-st-nodes">Nodes: 0/0</span><span class="xl-st-poll">Auto poll: ${POLL_S}s</span><span class="xl-st-user">OPERATOR (ADMIN)</span><span class="xl-st-clock"></span></div>
                <div class="xl-splash">
                    <div class="xl-splash-box">
                        <div class="xl-splash-band"><span class="xl-splash-x">X</span><span class="xl-splash-name">XLink<small>Operator Console</small></span></div>
                        <div class="xl-splash-body">
                            <div>AmusementVISION Network Management Suite</div>
                            <div>Version ${VERSION}</div>
                            <div class="xl-splash-step">Initializing...</div>
                            <div class="xl-splash-bar"><span></span></div>
                            <div class="xl-splash-copy">Copyright (C) 2004-2011 AmusementVISION. All rights reserved.<br>Licensed to: BlueSteel Arcade</div>
                        </div>
                    </div>
                </div>
                <div class="xl-dlg-layer hidden"></div>
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
                else if (row.dataset.cap) this.viewCapture(row.dataset.cap);
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
            this.modal.addEventListener('keydown', (ev) => {
                if (ev.key === 'F5') { ev.preventDefault(); void this.command('refresh'); }
            }, sig);
            q('.xl-file').addEventListener('change', () => void this.importFile(), sig);
            q('.xl-splash').addEventListener('click', () => this.splashDone(), sig);
            this.splitter(q('.xl-split'), q('.xl-tree'));
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
                    { text: 'Import Site Settings (config.json)...', action: 'import-config' },
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
                    { text: 'Auto Poll (60 s)', action: 'autopoll', showIndicator: true, checked: this.autoPoll },
                    { separator: true },
                    { text: 'Saved Captures', action: 'captures' }];
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
                case 'captures': this.select('captures'); break;
                case 'log': this.showLog = !this.showLog; this.modal.classList.toggle('xl-nolog', !this.showLog); break;
                case 'clearlog': this.logLines = []; this.el('.xl-log').innerHTML = ''; break;
                case 'autopoll': this.autoPoll = !this.autoPoll; this.countdown = POLL_S; this.tick(); break;
                case 'expandall': this.expandAll(true); break;
                case 'collapseall': this.expandAll(false); break;
                case 'properties': this.properties(); break;
                case 'about': this.about(); break;
                case 'diag': this.diagnostics(); break;
                case 'import-menu': this.importing = 'menu.json'; this.el('.xl-file').click(); break;
                case 'import-config': this.importing = 'config.json'; this.el('.xl-file').click(); break;
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
            html += row('captures', 1, icon('image-landscape'), 'Saved Captures');
            t.innerHTML = html;
            const online = this.devices.filter((d) => d.status && !d.status.failed).length;
            this.el('.xl-st-nodes').textContent = `Nodes: ${online}/${this.devices.length}`;
            const link = this.el('.xl-link');
            link.classList.toggle('is-up', this.devices.length > 0 && online > 0);
            this.el('.xl-link-text').textContent = this.devices.length ? (online ? 'LINK' : 'NO NODES') : 'OFFLINE';
        }

        treeKey(ev) {
            const ids = ['root', ...this.devices.map((d) => `dev:${d.key}`), 'captures'];
            const i = ids.indexOf(this.node);
            if (ev.key === 'ArrowDown' && i < ids.length - 1) { ev.preventDefault(); this.select(ids[i + 1]); }
            if (ev.key === 'ArrowUp' && i > 0) { ev.preventDefault(); this.select(ids[i - 1]); }
        }

        select(id) {
            this.node = id;
            this.renderTree();
            this.countdown = POLL_S;
            if (id === 'captures') void this.showCaptures();
            else if (id.startsWith('dev:')) {
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
                ctl = `<span class="xl-toggle">${it.toggle.map((t, i) => {
                    const bg = colour(t.bg);
                    const fg = colour(t.color) || (bg ? ink(bg) : '');
                    const st = t.active && bg ? ` style="background:${bg};color:${fg}"` : '';
                    const face = t.icon ? `<img src="${iconUrl(t.icon)}" alt="${esc(t.label)}" width="16" height="16">` : esc(t.label);
                    return `<button type="button" class="xl-tgl${t.active ? ' is-on' : ''}" data-xl="toggle" data-path="${path}" data-value="${i}"${st} title="${esc(t.label)}">${face}</button>`;
                }).join('')}</span>`;
            } else if (it.kind === 'slider') {
                const v = Math.max(0, Math.min(100, parseInt(it.status && it.status.text, 10) || 0));
                ctl = it.status && !it.status.failed
                    ? `<span class="xl-slider-box"><input type="range" class="xl-slider" min="0" max="100" step="1" value="${v}" data-path="${path}" data-append="${esc(it.append)}"><span class="xl-slider-val">${v}${esc(it.append)}</span></span>`
                    : '<span class="xl-na">N/A</span>';
            } else if (it.kind === 'button') {
                ctl = `<button type="button" class="xl-btn" data-xl="send" data-path="${path}">Execute</button>`;
            } else if (folder) {
                ctl = `<button type="button" class="xl-btn" data-xl="open" data-path="${path}">${opened ? 'Close' : 'Open'} &gt;&gt;</button>`;
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
                if (this.node === 'captures') await this.showCaptures();
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
            this.el('.xl-st-clock').textContent = clock(Date.now());
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

        // ---------------------------------------------------------------- captures

        async showCaptures() {
            this.head(icon('image-landscape'), 'Saved Captures', 'Reading folder...');
            const list = this.el('.xl-list');
            list.innerHTML = '<div class="xl-empty">Reading capture folder...</div>';
            let r;
            try { r = await this.send('xlink_captures', {}); } catch (err) {
                list.innerHTML = `<div class="xl-empty">Failed to read the captures folder.<br>${esc(err.details || err.message)}</div>`;
                return;
            }
            if (this.node !== 'captures') return;
            this.head(icon('image-landscape'), 'Saved Captures', `${esc(r.folder || '(not configured)')} &nbsp; ${r.files.length} file(s)${r.all ? '' : ', last 7 days'}`);
            if (!r.configured) { list.innerHTML = '<div class="xl-empty">No capture folder is configured.<br><br>Import a config.json with a "captures" folder (File &gt; Import Site Settings).</div>'; return; }
            if (r.missing) { list.innerHTML = `<div class="xl-empty"><img src="/static_images/vista-icons/error-16.png" alt=""> The capture folder could not be opened (${esc(r.reason)}).<br><br>${esc(r.folder)}</div>`; return; }
            if (!r.files.length) { list.innerHTML = '<div class="xl-empty">No Saved Captures</div>'; return; }
            list.innerHTML = `<div class="xl-caps">${r.files.map((f) => `
                <div class="xl-cap" data-cap="${esc(f.name)}" title="${esc(f.name)}">
                    <span class="xl-cap-img"><img loading="lazy" src="/xlink/captures/${encodeURIComponent(f.name)}?thumb=1" alt=""></span>
                    <span class="xl-cap-name">${esc(f.name)}</span>
                    <span class="xl-cap-date">${stamp(f.mtime)}</span>
                </div>`).join('')}</div>`;
            list.querySelector('.xl-caps').addEventListener('dblclick', (ev) => {
                const c = ev.target.closest('[data-cap]');
                if (c) this.viewCapture(c.dataset.cap);
            });
            list.querySelector('.xl-caps').addEventListener('click', (ev) => {
                const c = ev.target.closest('[data-cap]');
                list.querySelectorAll('.xl-cap.is-sel').forEach((x) => x.classList.remove('is-sel'));
                if (c) c.classList.add('is-sel');
            });
        }

        viewCapture(name) {
            const url = `/xlink/captures/${encodeURIComponent(name)}`;
            void this.dialog({
                title: `Capture Viewer - ${name}`,
                cls: 'xl-viewer',
                body: `<div class="xl-viewer-img"><img src="${url}" alt=""></div>`,
                buttons: [{ text: 'Save As...', value: 'save' }, { text: 'Close', value: 'close', def: true }]
            }).then((v) => {
                if (v !== 'save') return;
                const a = doc.createElement('a');
                a.href = url;
                a.download = name;
                a.click();
            });
        }

        // ---------------------------------------------------------------- dialogs

        /** An in-window Win2000-style dialog. Resolves with the button value (null on close). */
        dialog(o) {
            const layer = this.el('.xl-dlg-layer');
            layer.classList.remove('hidden');
            this.dialogOpen = (this.dialogOpen || 0) + 1;
            const box = doc.createElement('div');
            box.className = `xl-dlg ${o.cls || ''}`;
            box.innerHTML = `
                <div class="xl-dlg-cap"><span>${esc(o.title)}</span><button type="button" class="xl-dlg-x" title="Close">x</button></div>
                <div class="xl-dlg-body">${o.body}</div>
                <div class="xl-dlg-btns">${o.buttons.map((b) => `<button type="button" class="xl-btn${b.def ? ' is-def' : ''}" data-v="${esc(b.value)}">${esc(b.text)}</button>`).join('')}</div>`;
            layer.appendChild(box);
            const def = box.querySelector('.is-def') || box.querySelector('.xl-dlg-btns button');
            setTimeout(() => def && def.focus(), 0);
            return new Promise((resolve) => {
                const done = (v) => {
                    box.remove();
                    this.dialogOpen--;
                    if (!layer.childElementCount) layer.classList.add('hidden');
                    resolve(v);
                };
                box.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-v]');
                    if (b) done(b.dataset.v);
                    else if (ev.target.closest('.xl-dlg-x')) done(null);
                });
                box.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape') { ev.stopPropagation(); done(null); }
                });
                this.app.signal.addEventListener('abort', () => done(null));
            });
        }

        async confirm(w, it) {
            // message box art: a red icon_color reads as Vista's error icon, anything else as the warning
            const art = /^(red|#f00|#ff0000)$/i.test(w.iconColor) ? 'msgbox-error-32' : 'msgbox-warning-32';
            const v = await this.dialog({
                title: `XLink - ${it ? it.text : 'Confirm'}`,
                body: `<div class="xl-msg"><img class="xl-msg-ico" src="/static_images/vista-icons/${art}.png" alt=""><div><b>${esc(w.header)}</b><p>${esc(w.message)}</p></div></div>`,
                buttons: [{ text: w.ok || 'OK', value: 'ok' }, { text: 'Cancel', value: 'cancel', def: true }]
            });
            return v === 'ok';
        }

        async error(message) {
            await this.dialog({
                title: 'XLink - System Error',
                body: `<div class="xl-msg"><img class="xl-msg-ico" src="/static_images/vista-icons/msgbox-error-32.png" alt=""><div><b>System Error</b><p>${esc(message)}</p></div></div>`,
                buttons: [{ text: 'OK', value: 'ok', def: true }]
            });
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
            void this.dialog({ title: 'Properties', body, buttons: [{ text: 'OK', value: 'ok', def: true }] });
        }

        async diagnostics() {
            const lines = this.devices.map((d) => `${d.key.toUpperCase().padEnd(8)} ${d.name.padEnd(14)} ${d.status ? (d.status.failed ? 'NO RESPONSE' : `UP   ${d.status.text}`) : 'NO STATUS'}`);
            void this.dialog({
                title: 'Network Diagnostics',
                body: `<pre class="xl-pre">XLINK NETWORK DIAGNOSTICS\n-------------------------\nNODE     CABINET        RESULT\n${esc(lines.join('\n'))}\n\n${this.devices.filter((d) => d.status && !d.status.failed).length} of ${this.devices.length} node(s) responding.</pre>`,
                buttons: [{ text: 'OK', value: 'ok', def: true }]
            });
        }

        about() {
            void this.dialog({
                title: 'About XLink Operator Console',
                cls: 'xl-about',
                body: `<div class="xl-about-band"><span class="xl-splash-x">X</span><span class="xl-splash-name">XLink<small>Operator Console</small></span></div>
                    <div class="xl-about-text">AmusementVISION Network Management Suite<br>Version ${VERSION} (Build 2011/03/12)<br>Copyright (C) 2004-2011 AmusementVISION.<br>All rights reserved.<br><br>Licensed to: BlueSteel Arcade<br>Serial: AVSX-0302-7738-1145<br><br>Node table: ${this.devices.length} cabinet(s)</div>`,
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

    function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const c = new Console(app);
        running = c;
        app.onExit(() => { if (running === c) running = null; });
    }

    root.melatonXLink = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('xlink', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
