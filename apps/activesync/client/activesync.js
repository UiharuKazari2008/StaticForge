/**
 * Melaton Mobile Device Center (Yozora #747): Windows Mobile Device Center 6.1 as Vista shows it,
 * for Android phones running the Dreamscape app. Layout, art and wording from the VM
 * (~/.cache/vista-vm/wmdc-ref: window 800 x 600, stage 786 x 534 at 8,57), Windows -> Melaton and
 * Microsoft -> Xyridian. The connection itself is public/scripts/comp/activeSyncAgent.js
 * (window.activeSync) and modules/activeSync.js.
 *
 *   no device connected   the two phones, "Not Connected", Mobile Device Settings
 *   a new device          the device, "Connected", and the choice: "Set up your device" (a
 *                         partnership: the device is named, the phone's user agrees) or "Connect
 *                         without setting up your device" (a guest, for this connection)
 *   connected             the tiles; a tile opens under the pointer and lists its tasks. Other files
 *                         add tasks with melatonActiveSync.addTask(tile, task)
 *   bread crumbs          Home > Quick Connect (a guest) or Home > the partnership's name; with
 *                         several devices the last crumb is a menu of them
 *
 *   melatonApps.define('activesync', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const A = '/melaton-apps/activesync/assets';
    const NAME = 'Melaton Mobile Device Center';
    const REG = 'HKCU\\Software\\Xyridian\\Melaton Mobile Device Center';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const as = () => root.activeSync || null;

    // tasks other files add to a tile: { id, text, icon, when(device) -> bool, run(device, center) }
    const extraTasks = { programs: [], media: [], files: [], settings: [] };
    const TILES = [
        { id: 'programs', title: 'Programs and Services', icon: 'programs-64.png' },
        { id: 'media', title: 'Pictures, Music and Video', icon: 'media-64.png' },
        { id: 'files', title: 'File Management', icon: 'files-64.png' },
        { id: 'settings', title: 'Mobile Device Settings', icon: 'settings-64.png' }
    ];

    function bytes(n) {
        if (n == null || !Number.isFinite(Number(n))) return '';
        const u = ['bytes', 'KB', 'MB', 'GB', 'TB'];
        let v = Number(n);
        let i = 0;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
        return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${u[i]}`;
    }

    function when(ms) {
        if (!ms) return 'Never';
        const d = new Date(ms);
        const today = new Date();
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return d.toDateString() === today.toDateString() ? `Today at ${time}` : `${d.toLocaleDateString()} at ${time}`;
    }

    function batteryArt(b) {
        if (!b || b.level == null) return 'battery-5';
        return `battery-${b.level < 10 ? 0 : b.level < 35 ? 1 : b.level < 60 ? 2 : b.level < 85 ? 3 : 4}`;
    }

    class Center {
        constructor(app) {
            this.app = app;
            this.deviceId = (app.args && app.args.deviceId) || null;
            this.page = null;       // null (the home for the device's state) | 'setup' | 'working' | 'done' | 'info'
            this.open = null;       // the open tile
            this.busy = false;      // waiting for the phone's answer
            this.frame = 0;
            this.build();
            const a = as();
            if (a) {
                const off = a.on('state', () => this.render());
                app.signal.addEventListener('abort', off);
                a.refresh().catch(() => { /* a read-only logon lists nothing */ });
            }
            this.render();
        }

        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden asdc-window';
            m.dataset.windowIdentifier = 'melatonMobileDeviceCenter';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = `${A}/activesync-32.png`;
            m.style.width = '800px';
            m.style.height = '600px';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', NAME);
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/activesync-16.png" alt=""><span>${NAME}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small asdc-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="asdc-nav">
                    <button type="button" class="asdc-back" data-asdc="back" title="Back" disabled></button>
                    <div class="asdc-crumbs"></div>
                    <button type="button" class="asdc-help" data-asdc="help" title="Help"></button>
                </div>
                <div class="modal-content asdc-client">
                    <div class="asdc-root">
                        <div class="asdc-stage">
                            <div class="asdc-logo"><img src="/static_images/melaton/melaton-glass-256.png" alt=""><b>Melaton</b><i>Mobile</i></div>
                            <img class="asdc-device" alt="" draggable="false">
                            <div class="asdc-status"><img alt=""><span></span></div>
                            <div class="asdc-body"></div>
                        </div>
                    </div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            const sig = { signal: this.app.signal };
            const q = (s) => m.querySelector(s);
            this.el = q;
            m.addEventListener('click', (ev) => {
                const t = ev.target.closest('[data-asdc]');
                if (t && !t.disabled) void this.command(t.dataset.asdc, t);
            }, sig);
            // a tile opens under the pointer (and by keyboard focus) and closes when the pointer leaves the column
            q('.asdc-body').addEventListener('mouseover', (ev) => {
                const tile = ev.target.closest('.asdc-tile');
                if (tile) this.openTile(tile.dataset.tile);
            }, sig);
            q('.asdc-body').addEventListener('focusin', (ev) => {
                const tile = ev.target.closest('.asdc-tile');
                if (tile) this.openTile(tile.dataset.tile);
            }, sig);
            q('.asdc-stage').addEventListener('mouseleave', () => this.openTile(null), sig);
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && ev.target.matches('.asdc-page input[type="text"]')) { ev.preventDefault(); void this.command('setup-go'); }
                if ((ev.key === 'Backspace' && !ev.target.matches('input')) || (ev.altKey && ev.key === 'ArrowLeft')) { if (this.page && !this.busy) { ev.preventDefault(); void this.command('back'); } }
            }, sig);
            if (root.contextMenu) {
                root.contextMenu.attachClickMenuToElement(q('.asdc-help'), {
                    onAction: (a) => void this.command(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = [{ text: `About ${NAME}`, action: 'about' }]; } }]
                });
            }
            const tick = setInterval(() => this.tick(), 110);
            this.app.signal.addEventListener('abort', () => clearInterval(tick));
            q('.asdc-close').addEventListener('click', () => this.app.exit(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            m.id = 'melatonMobileDeviceCenterModal';
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
                root.programFaults.registerProgram(m.id, { name: NAME, terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'activesync' }) });
            }
        }

        destroy() {
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 400);
        }

        // ---------------------------------------------------------------- state

        devices() {
            const a = as();
            return a ? a.state().devices : [];
        }

        /** The device this window shows: the chosen one, else the first connected, else none. */
        device() {
            const list = this.devices();
            const chosen = this.deviceId && list.find((d) => d.deviceId === this.deviceId);
            if (chosen && (chosen.online || chosen.partner)) return chosen;
            return list.find((d) => d.online) || null;
        }

        select(deviceId) {
            this.deviceId = deviceId;
            this.page = null;
            this.open = null;
            this.render();
        }

        tasks(tile, dev) {
            const out = [];
            if (tile === 'settings') {
                if (dev && dev.online && !dev.partner) out.push({ id: 'setup', text: 'Set up your device', icon: 'setup-32.png' });
                out.push({ id: 'connection', text: 'Connection settings', icon: 'connection-32.png' });
                if (dev) out.push({ id: 'info', text: 'Device information', icon: 'item-32.png' });
                if (dev && dev.partner) out.push({ id: 'end', text: 'End a partnership', icon: 'end-partnership-32.png' });
            }
            for (const t of extraTasks[tile] || []) {
                if (!dev || (typeof t.when === 'function' && !t.when(dev))) continue;
                out.push({ id: `x:${tile}:${t.id}`, text: typeof t.text === 'function' ? t.text(dev) : t.text, icon: t.icon || 'item-32.png', extra: t });
            }
            return out;
        }

        // ---------------------------------------------------------------- drawing

        render() {
            if (this.app.signal.aborted) return;
            const dev = this.device();
            const connected = !!(dev && dev.online);
            const established = connected && (dev.session === 'guest' || dev.session === 'partner');
            // a page that needs the device ends when it goes
            if (this.page && this.page !== 'info' && this.page !== 'done' && !connected) { this.page = null; this.busy = false; }
            if (this.page === 'info' && !dev) this.page = null;

            // bread crumbs
            const crumbs = ['<span>Home</span>'];
            const others = this.devices().filter((d) => d.online || d.partner);
            if (established || (dev && dev.partner)) {
                const label = dev.partner ? dev.name : 'Quick Connect';
                crumbs.push(`<img src="${A}/breadcrumb-arrow.png" alt="">`, others.length > 1 ? `<span class="asdc-crumb-menu">${esc(label)}</span>` : `<span>${esc(label)}</span>`);
            } else if (others.length > 1) {
                crumbs.push(`<img src="${A}/breadcrumb-arrow.png" alt="">`, `<span class="asdc-crumb-menu">${esc(dev ? dev.name : 'Devices')}</span>`);
            }
            const crumbBox = this.el('.asdc-crumbs');
            if (crumbBox.dataset.html !== crumbs.join('')) {
                crumbBox.dataset.html = crumbs.join('');
                crumbBox.innerHTML = crumbs.join('');
                // with several devices the last crumb is a menu of them
                const menu = crumbBox.querySelector('.asdc-crumb-menu');
                if (menu && root.contextMenu) {
                    root.contextMenu.attachClickMenuToElement(menu, {
                        onAction: (action) => this.select(action),
                        sections: [{ type: 'list', initfn: (sec) => {
                            const cur = this.device();
                            sec.items = this.devices().filter((d) => d.online || d.partner).map((d) => ({ text: d.online ? d.name : `${d.name} (not connected)`, action: d.deviceId, checked: !!(cur && cur.deviceId === d.deviceId) }));
                        } }]
                    });
                }
            }
            this.el('.asdc-back').disabled = !this.page || this.busy;

            // the picture and the status line
            this.el('.asdc-device').src = `${A}/${connected ? 'device-pda-256.png' : 'devices-256.png'}`;
            this.status = this.busy ? 'connecting' : connected ? 'connected' : 'notconnected';
            this.paintStatus();

            const body = this.el('.asdc-body');
            let html;
            if (this.page === 'setup') html = this.setupPage(dev);
            else if (this.page === 'working') html = `<div class="asdc-page"><h2>Setting up partnership...</h2><p>${esc(`Please wait while we set up your partnership with ${this.pendingName || dev.name} and save your settings.`)}</p><p>Answer the question on your device to continue.</p></div>`;
            else if (this.page === 'guest') html = `<div class="asdc-page"><h2>Connecting...</h2><p>Answer the question on your device to continue.</p></div>`;
            else if (this.page === 'done') html = `<div class="asdc-page"><h2>You have created a new Melaton Mobile partnership</h2><p>${esc(`${dev ? dev.name : 'Your device'} connects on its own from now on, whenever the Dreamscape app is running on it.`)}</p><div class="asdc-page-buttons"><button type="button" class="btn-standard primary" data-asdc="back">Done</button></div></div>`;
            else if (this.page === 'info') html = this.infoPage(dev);
            else if (connected && !established) html = this.choicePage();
            else html = this.tilesPage(dev, connected);
            if (body.dataset.html !== html) {
                // keep what is being typed when a status report redraws nothing new
                body.dataset.html = html;
                body.innerHTML = html;
                const field = body.querySelector('.asdc-page input[type="text"]');
                if (field) { field.focus({ preventScroll: true }); field.select(); }
            }
            this.applyOpen();
        }

        paintStatus() {
            const img = this.el('.asdc-status img');
            const text = this.el('.asdc-status span');
            this.el('.asdc-status').dataset.status = this.status;
            if (this.status === 'connecting') {
                img.src = `${A}/status-connecting-${(this.frame % 8) + 1}.png`;
                text.textContent = 'Connecting';
            } else {
                img.src = `${A}/status-${this.status}.png`;
                text.textContent = this.status === 'connected' ? 'Connected' : 'Not Connected';
            }
        }

        tick() {
            if (this.status !== 'connecting') return;
            this.frame += 1;
            this.paintStatus();
        }

        choicePage() {
            return `<div class="asdc-choice">
                <button type="button" class="asdc-panel asdc-panel--setup" data-asdc="setup"><img src="${A}/settings-64.png" alt=""><h3>Set up your device</h3><p>Keep a partnership with this device, so it connects on its own and items sent to it wait while it is away.</p></button>
                <button type="button" class="asdc-panel asdc-panel--quick" data-asdc="guest"><img src="${A}/quick-connect-64.png" alt=""><h3>Connect without setting up your device</h3></button>
            </div>`;
        }

        tilesPage(dev, connected) {
            const tiles = TILES.map((t) => ({ t, tasks: this.tasks(t.id, connected ? dev : null) })).filter((x) => x.tasks.length);
            return `<div class="asdc-tiles">${tiles.map(({ t, tasks }) => `
                <div class="asdc-tile" data-tile="${t.id}">
                    <img src="${A}/${t.icon}" alt="">
                    <h3>${esc(t.title)}</h3>
                    <div class="asdc-tile-body">${tasks.slice(0, 3).map((k) => `<button type="button" class="asdc-item" data-asdc="task" data-task="${esc(k.id)}"><img src="${k.icon.includes('/') ? esc(k.icon) : `${A}/${k.icon}`}" alt=""><span>${esc(k.text)}</span></button>`).join('')}
                    ${tasks.length > 3 ? '<button type="button" class="asdc-more" data-asdc="more">more»</button>' : ''}</div>
                </div>`).join('')}</div>`;
        }

        setupPage(dev) {
            return `<div class="asdc-page">
                <h2>Ready to set up the Melaton Mobile partnership</h2>
                <p>Your device will be asked to agree. A partner connects on its own, and items sent to it wait while it is away.</p>
                <label for="asdcDeviceName">Device name:</label>
                <input type="text" id="asdcDeviceName" maxlength="40" value="${esc(this.pendingName || (dev && dev.name) || '')}" spellcheck="false" autocomplete="off">
                <div class="asdc-error">${esc(this.setupError || '')}</div>
                <div class="asdc-page-buttons"><button type="button" class="btn-standard primary" data-asdc="setup-go">Set Up</button><button type="button" class="btn-standard" data-asdc="back">Cancel</button></div>
            </div>`;
        }

        infoPage(dev) {
            const st = (dev && dev.status) || {};
            const rows = [];
            const row = (k, v) => { if (v) rows.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`); };
            row('Device name:', esc(dev.name));
            row('Model:', esc(dev.model));
            row('Operating system:', esc(dev.os));
            row('Program:', esc(dev.app));
            row('Status:', esc(!dev.online ? 'Not Connected' : dev.session === 'partner' ? 'Connected (partnership)' : dev.session === 'guest' ? 'Connected (guest)' : 'Connected'));
            if (dev.online && st.battery && st.battery.level != null) {
                row('Battery:', `<img src="${A}/${batteryArt(st.battery)}-16.png" alt="">${Math.round(st.battery.level)}%${st.battery.charging ? ', charging' : ''}${st.battery.saver ? ', battery saver on' : ''}`);
            }
            if (dev.online && st.wifi && st.wifi.connected) row('Wi-Fi:', esc(`${st.wifi.ssid || 'Connected'}${st.wifi.level != null ? `, signal ${st.wifi.level} of 4` : ''}`));
            if (dev.online && st.cellular && st.cellular.present) {
                row('Cellular:', esc(st.cellular.airplane ? 'Flight mode' : [st.cellular.operator, st.cellular.dataType, st.cellular.roaming ? 'roaming' : ''].filter(Boolean).join(', ') || 'No service'));
            }
            for (const s of (dev.online && st.storage) || []) {
                if (s.total == null || s.free == null || !(s.total > 0)) continue;
                const used = Math.max(0, Math.min(1, 1 - s.free / s.total));
                row(`${s.name || 'Storage'}:`, `<span class="asdc-bar${used > 0.9 ? ' is-full' : ''}"><i style="width:${(used * 100).toFixed(1)}%"></i></span>${esc(`${bytes(s.free)} free of ${bytes(s.total)}`)}`);
            }
            if (dev.partner) row('Last sync:', esc(when(dev.lastSync)));
            if (dev.queued) row('Waiting for device:', esc(`${dev.queued} item${dev.queued === 1 ? '' : 's'}`));
            if (!dev.online) row('Last connected:', esc(when(dev.lastSeen)));
            return `<div class="asdc-page" style="top:70px"><h2>Device information</h2><dl class="asdc-info">${rows.join('')}</dl><div class="asdc-page-buttons"><button type="button" class="btn-standard primary" data-asdc="back">Close</button></div></div>`;
        }

        openTile(id) {
            if (this.open === id) return;
            this.open = id;
            this.applyOpen();
        }

        applyOpen() {
            this.modal.querySelectorAll('.asdc-tile').forEach((t) => t.classList.toggle('is-open', t.dataset.tile === this.open));
        }

        // ---------------------------------------------------------------- commands

        async messageBox(text, buttons, kind) {
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, {
                title: NAME,
                icon: kind === 'error' ? 'fas fa-circle-xmark' : kind === 'question' ? 'fas fa-circle-question' : 'fas fa-triangle-exclamation',
                width: 400
            });
        }

        async command(cmd, el) {
            const a = as();
            const dev = this.device();
            if (cmd === 'back') { this.page = null; this.setupError = ''; this.render(); return; }
            if (cmd === 'about') { await this.about(); return; }
            if (cmd === 'more') { this.openTile(el.closest('.asdc-tile').dataset.tile); return; }
            if (cmd === 'task') {
                const id = el.dataset.task;
                if (id.startsWith('x:')) {
                    const [, tile, tid] = id.split(':');
                    const t = (extraTasks[tile] || []).find((k) => k.id === tid);
                    if (t && dev) {
                        try { await t.run(dev, this); } catch (e) { await this.messageBox((e && e.message) || 'The task could not be completed.', null, 'error'); }
                    }
                    return;
                }
                cmd = id;
            }
            if (!a) return;
            if (cmd === 'setup') { this.page = 'setup'; this.setupError = ''; this.pendingName = ''; this.render(); return; }
            if (cmd === 'info') { this.page = 'info'; this.render(); return; }
            if (cmd === 'connection') { await this.connectionSettings(); return; }
            if (cmd === 'guest' && dev) {
                this.page = 'guest';
                await this.propose(dev, 'guest', {});
                return;
            }
            if (cmd === 'setup-go' && dev) {
                const field = this.el('#asdcDeviceName');
                const name = String((field && field.value) || '').trim();
                // Device Center's own three refusals (NPWDeviceNameError*)
                if (!name) this.setupError = 'Please enter a name for your device.';
                else if (/[^\p{L}\p{N} _-]/u.test(name)) this.setupError = 'Device names cannot include punctuation or symbols. Please choose a different name.';
                else this.setupError = '';
                this.pendingName = name;
                if (this.setupError) { this.el('.asdc-body').dataset.html = ''; this.render(); return; }
                this.page = 'working';
                await this.propose(dev, 'partner', { name });
                return;
            }
            if (cmd === 'end' && dev) {
                const yes = await this.messageBox(`Are you sure you want to end the partnership with ${dev.name}?\n\nEnding a partnership removes any Device Center information associated with that device from this computer.`, [
                    { text: 'End partnership', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
                ], 'question');
                if (yes !== true) return;
                try { await a.endPartnership(dev.deviceId); } catch (e) { await this.messageBox(e.message || 'Could not save Partnership Settings', null, 'error'); }
                this.render();
            }
        }

        async propose(dev, mode, opts) {
            const a = as();
            this.busy = true;
            this.render();
            let res = null;
            let failure = null;
            try { res = await a.propose(dev.deviceId, mode, opts); } catch (e) { failure = e; }
            if (this.app.signal.aborted) return;
            this.busy = false;
            if (failure) {
                if (failure.code === 'NAME_IN_USE') { this.page = 'setup'; this.setupError = failure.message; this.el('.asdc-body').dataset.html = ''; this.render(); return; }
                this.page = mode === 'partner' ? 'setup' : null;
                this.render();
                await this.messageBox(failure.code === 'TIMEOUT' || failure.code === 'OFFLINE' || failure.code === 'DISCONNECTED'
                    ? 'There is a problem with your connection.  Please disconnect and reconnect your device and try again.'
                    : (failure.message || 'There is a problem with your connection.'), null, 'error');
                return;
            }
            if (!res.accepted) {
                this.page = mode === 'partner' ? 'setup' : null;
                this.render();
                await this.messageBox(mode === 'partner' ? 'The partnership was not set up: it was refused on the device.' : 'The connection was refused on the device.', null, 'warning');
                return;
            }
            this.page = mode === 'partner' ? 'done' : null;
            this.render();
        }

        async connectionSettings() {
            const reg = root.melatonRegistry;
            const get = (n) => (reg ? reg.get(REG, n, 1) : 1) !== 0;
            const id = `asdcConn${Date.now()}`;
            const html = `<p><b>${this.device() && this.device().online ? 'Connected' : 'Waiting for device to connect'}</b></p>
                <label class="asdc-check"><input type="checkbox" id="${id}Open"${get('OpenOnConnect') ? ' checked' : ''}> Open Mobile Device Center when a new device connects</label>
                <label class="asdc-check"><input type="checkbox" id="${id}Notify"${get('NotifyOnConnect') ? ' checked' : ''}> Show a notification when a device connects or disconnects</label>`;
            const read = () => ({ open: doc.getElementById(`${id}Open`), notify: doc.getElementById(`${id}Notify`) });
            let picked = null;
            const grab = () => { const r = read(); if (r.open && r.notify) picked = { OpenOnConnect: r.open.checked ? 1 : 0, NotifyOnConnect: r.notify.checked ? 1 : 0 }; };
            doc.addEventListener('change', grab, true);
            let ok;
            try {
                ok = await call('showConfirmationDialog', html, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: 'Connection Settings', width: 420 });
            } finally {
                doc.removeEventListener('change', grab, true);
            }
            if (ok === true && picked && reg) void reg.set(REG, picked);
        }

        async about() {
            await call('showConfirmationDialog', `<p><b>${NAME}</b><br>Version 6.1.6965.0</p><p>© 2007 Xyridian Corporation. All rights reserved.</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: `About ${NAME}`, width: 380 });
        }
    }

    let running = null;

    function start(app) {
        if (running) {
            if (app.args && app.args.deviceId) running.select(app.args.deviceId);
            call('bringModalToFront', running.modal);
            app.exit();
            return;
        }
        const c = new Center(app);
        running = c;
        app.onExit(() => { if (running === c) running = null; c.destroy(); });
    }

    /** A task in a tile ('programs' | 'media' | 'files' | 'settings'): { id, text, icon, when(device), run(device, center) }. */
    function addTask(tile, task) {
        if (!extraTasks[tile] || !task || !task.id || typeof task.run !== 'function') return;
        const at = extraTasks[tile].findIndex((t) => t.id === task.id);
        if (at >= 0) extraTasks[tile][at] = task; else extraTasks[tile].push(task);
        if (running) running.render();
    }

    root.melatonActiveSync = Object.assign(root.melatonActiveSync || {}, { start, addTask, _running: () => running, _tasks: extraTasks });
    // tasks registered before this file loaded (other features queue them on melatonActiveSync.pending)
    (root.melatonActiveSync.pending || []).splice(0).forEach(([tile, task]) => addTask(tile, task));
    if (typeof melatonApps !== 'undefined') melatonApps.define('activesync', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
