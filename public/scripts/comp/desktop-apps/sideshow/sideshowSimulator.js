/**
 * Device Simulator for Melaton SideShow (Yozora #655): Device Simulator 3.0 for Windows SideShow
 * (VirtualSideShow.exe /button, portrait and landscape), 1:1 from the Vista VM. The window's client
 * is the VM capture (static_images/vista-sideshow/simulator/portrait.png, landscape.png): black, the
 * LCD's sunken frame, Back / Menu and the D-pad drawn from VirtualSideShow.exe's own bitmaps, whose
 * pressed copies (*-down.png) lay over them while held, and the "Always on top" check box.
 *
 *   portrait   client 256 x 546, LCD 240 x 320 at (9, 8), "Virtual SideShow - 3"
 *   landscape  client 515 x 256, LCD 320 x 240 at (9, 8), "Virtual SideShow - 2"
 *
 * The LCD runs the SideShow firmware's screens from tinyclr_microsoft_*.dat's art (fw-*.png/jpg):
 * the splash, the home list (Welcome, then the gadgets) and the Dreamscape Slideshow gadget. The
 * simulator is a real Melaton SideShow device: its own socket (?dreamscapeClient=VirtualSideShow/3.0)
 * sends client_identify / client_device_state and takes device_command from Control Panel's
 * Melaton SideShow pages (modules/slideshowDevices.js, Yozora #654).
 *
 *   openSideShowSimulator('portrait' | 'landscape')
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-sideshow/simulator';
    const ICON = `${ART}/window-16.png`;
    const APP = 'VirtualSideShow/3.0';
    const GADGET = 'Dreamscape Slideshow';

    // measured on the VM (client coordinates)
    const MODES = {
        portrait: {
            pid: 3, client: [256, 546], lcd: [9, 8, 240, 320], check: [156, 527], checkMark: [158, 529],
            buttons: {
                back: [73, 339, 64, 32], menu: [137, 339, 64, 32], up: [102, 382, 68, 40], left: [72, 421, 30, 48],
                ok: [102, 420, 68, 48], right: [170, 421, 30, 48], down: [102, 470, 68, 40]
            }
        },
        landscape: {
            pid: 2, client: [515, 256], lcd: [9, 8, 320, 240], check: [415, 237], checkMark: [417, 239],
            buttons: {
                back: [361, 38, 64, 32], menu: [425, 38, 64, 32], up: [390, 81, 68, 40], left: [360, 120, 30, 48],
                ok: [390, 119, 68, 48], right: [458, 120, 30, 48], down: [390, 169, 68, 40]
            }
        }
    };
    const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', ' ': 'ok', Backspace: 'back', Escape: 'back', F10: 'menu', ContextMenu: 'menu' };
    const DEFAULT_SETTINGS = { viewType: 'images', intervalSec: 45, poolSize: 0, shuffle: true, pairPortraits: true, infoOverlay: 'minimal' };
    const VIEW_TYPES = new Set(['images', 'pinned', 'upscaled']);
    const OVERLAYS = new Set(['off', 'minimal', 'full']);

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function store(key, value) {
        try {
            if (value === undefined) return JSON.parse(root.localStorage.getItem(key) || 'null');
            root.localStorage.setItem(key, JSON.stringify(value));
        } catch (_) { /* private mode */ }
        return value;
    }

    function previewUrl(filename) {
        const base = String(filename || '').replace(/\.(png|jpg|jpeg|webp)$/i, '').replace(/_upscaled$/i, '');
        return base ? `/previews/${encodeURIComponent(`${base}.webp`)}` : '';
    }

    /** "8/4 9:53 PM" (portrait) / "Fri 8/4 9:52 PM" (landscape), as the firmware's header clock. */
    function clockText(landscape) {
        const d = new Date();
        const h = d.getHours() % 12 || 12;
        const t = `${d.getMonth() + 1}/${d.getDate()} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
        return landscape ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${t}` : t;
    }

    class Simulator {
        constructor(mode) {
            this.mode = MODES[mode] ? mode : 'portrait';
            this.m = MODES[this.mode];
            this.key = `dreamscape.sideshowSim.${this.mode}`;
            const saved = store(this.key) || {};
            this.deviceId = /^[0-9a-f]{12}$/.test(saved.deviceId || '') ? saved.deviceId
                : Array.from(root.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
            this.name = saved.name || `Virtual SideShow - ${this.m.pid}`;
            this.settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings || {});
            this.onTop = saved.onTop !== false;
            this.save();
            this.screen = 'splash';
            this.homeIndex = 1;
            this.menuIndex = 0;
            this.images = []; // sparse: the server's list by position, filled a page at a time
            this.total = 0;
            this.seed = '';
            this.pages = new Map(); // page offset -> pending fetch
            this.pos = 0;
            this.paused = false;
            this.ws = null;
            this.timer = null;
            this.clockTimer = null;
            this.tall = new Set();
            this.build();
        }

        save() {
            store(this.key, { deviceId: this.deviceId, name: this.name, settings: this.settings, onTop: this.onTop });
        }

        get landscape() {
            return this.mode === 'landscape';
        }

        build() {
            const [cw, ch] = this.m.client;
            const [lx, ly, lw, lh] = this.m.lcd;
            const w = doc.createElement('div');
            w.id = `sideshowSimulatorModal-${this.mode}`;
            w.className = `modal hidden sss-window is-${this.mode}`;
            w.dataset.windowIdentifier = `sideshowSimulator-${this.mode}`;
            w.dataset.windowClient = 'light';
            w.dataset.windowFixedSize = 'true';
            w.dataset.windowRestoreSize = 'false';
            w.dataset.taskbarIcon = ICON;
            w.setAttribute('role', 'dialog');
            w.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON}" alt=""><span class="sss-title">${esc(this.windowTitle())}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small" title="Maximize" disabled><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small sss-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content sss-client" tabindex="0" style="width:${cw}px;height:${ch}px;background-image:url('${ART}/${this.mode}.png')">
                    <div class="sss-lcd" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px"></div>
                    ${Object.entries(this.m.buttons).map(([k, [x, y, bw, bh]]) => `<button type="button" class="sss-btn" data-sss="${k}" aria-label="${k}" style="left:${x}px;top:${y}px;width:${bw}px;height:${bh}px;--down:url('${ART}/${k}-down.png')"></button>`).join('')}
                    <label class="sss-ontop" style="left:${this.m.check[0]}px;top:${this.m.check[1] - 2}px"><input type="checkbox"${this.onTop ? ' checked' : ''}><span class="sss-mark" style="left:${this.m.checkMark[0] - this.m.check[0]}px;top:${this.m.checkMark[1] - this.m.check[1] + 2}px;background-image:url('${ART}/check.png')"></span></label>
                </div>`;
            doc.body.appendChild(w);
            this.modal = w;
            this.lcd = w.querySelector('.sss-lcd');
            w.querySelector('.sss-close').addEventListener('click', () => this.close());
            const client = w.querySelector('.sss-client');
            client.addEventListener('pointerdown', (ev) => {
                const b = ev.target.closest('.sss-btn');
                if (!b) return;
                ev.preventDefault();
                b.classList.add('is-down');
                client.focus();
                const up = () => { b.classList.remove('is-down'); root.removeEventListener('pointerup', up); };
                root.addEventListener('pointerup', up);
                this.press(b.dataset.sss);
            });
            client.addEventListener('keydown', (ev) => {
                const k = KEYS[ev.key];
                if (!k) return;
                ev.preventDefault();
                const b = w.querySelector(`.sss-btn[data-sss="${k}"]`);
                if (b && !ev.repeat) { b.classList.add('is-down'); setTimeout(() => b.classList.remove('is-down'), 120); }
                this.press(k);
            });
            w.querySelector('.sss-ontop input').addEventListener('change', (ev) => {
                this.onTop = ev.target.checked;
                this.save();
                this.applyOnTop();
            });
        }

        windowTitle() {
            return `Virtual SideShow - ${this.m.pid}`;
        }

        applyOnTop() {
            this.modal.classList.toggle('on-top', this.onTop);
            this.modal.classList.toggle('sss-ontop-off', !this.onTop);
            callGlobal('bringModalToFront', this.modal);
        }

        show() {
            callGlobal('openModal', this.modal);
            this.modal.classList.remove('hidden');
            this.applyOnTop();
            requestAnimationFrame(() => {
                const r = this.modal.getBoundingClientRect();
                callGlobal('setModalOffsetsFromViewportTopLeft', this.modal, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
                const c = this.modal.querySelector('.sss-client');
                if (c) c.focus();
            });
        }

        boot() {
            this.screen = 'splash';
            this.render();
            clearInterval(this.clockTimer);
            this.clockTimer = setInterval(() => {
                this.lcd.querySelectorAll('.sss-clock').forEach((el) => { el.textContent = clockText(this.landscape); });
            }, 15000);
            // the firmware's splash, then the home list once the device is connected
            setTimeout(() => {
                if (this.screen === 'splash') {
                    this.screen = 'home';
                    this.render();
                }
            }, 2500);
            this.connect();
        }

        // ---- the device socket ----

        connect() {
            if (this.ws) return;
            const proto = root.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${proto}//${root.location.host}/?agentClientId=${this.deviceId}&dreamscapeClient=${encodeURIComponent(APP)}`);
            this.ws = ws;
            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (_) { return; }
                if (msg.requestId && this.pending && this.pending.has(msg.requestId)) {
                    const done = this.pending.get(msg.requestId);
                    this.pending.delete(msg.requestId);
                    done(msg);
                    if (msg.type !== 'client_identify_response') return;
                }
                if (msg.type === 'connection') this.identify();
                else if (msg.type === 'client_identify_response') this.onIdentified(msg.data || {});
                else if (msg.type === 'device_command') this.onCommand(msg);
            };
            ws.onclose = () => {
                if (this.ws !== ws) return;
                this.ws = null;
                // the tab lost the server: reconnect while the window is open
                if (this.modal.isConnected && !this.closing) setTimeout(() => this.connect(), 5000);
            };
        }

        send(obj) {
            if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
        }

        /** A request on the device socket; resolves with the reply (or null after 15 s). */
        request(type, data) {
            if (!this.ws || this.ws.readyState !== 1) return Promise.resolve(null);
            if (!this.pending) this.pending = new Map();
            const requestId = `sim-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            return new Promise((resolve) => {
                const t = setTimeout(() => { this.pending.delete(requestId); resolve(null); }, 15000);
                this.pending.set(requestId, (msg) => { clearTimeout(t); resolve(msg); });
                this.send({ type, requestId, data: data || {} });
            });
        }

        identify() {
            const [, , lw, lh] = this.m.lcd;
            this.send({
                type: 'client_identify',
                requestId: `sim-${Date.now()}`,
                data: {
                    kind: 'slideshow', deviceId: this.deviceId, name: this.name, app: APP,
                    model: 'Device Simulator 3.0', os: 'Melaton SideShow',
                    display: { width: lw, height: lh, orientation: this.mode }, settings: this.settings
                }
            });
        }

        onIdentified(data) {
            if (data.name) this.name = String(data.name);
            if (data.settings) this.applySettings(data.settings);
            this.save();
            this.reportState();
            if (this.screen === 'gadget') void this.loadImages();
        }

        applySettings(s) {
            const src = s || {};
            if (VIEW_TYPES.has(src.viewType)) this.settings.viewType = src.viewType;
            if (Number.isFinite(Number(src.intervalSec))) this.settings.intervalSec = Math.min(3600, Math.max(5, Math.round(Number(src.intervalSec))));
            if (Number.isFinite(Number(src.poolSize))) this.settings.poolSize = Math.min(1000000, Math.max(0, Math.round(Number(src.poolSize))));
            if (typeof src.shuffle === 'boolean') this.settings.shuffle = src.shuffle;
            if (typeof src.pairPortraits === 'boolean') this.settings.pairPortraits = src.pairPortraits;
            if (OVERLAYS.has(src.infoOverlay)) this.settings.infoOverlay = src.infoOverlay;
            this.save();
        }

        onCommand(msg) {
            const d = msg.data || {};
            let ok = true;
            switch (d.command) {
                case 'next': this.openGadget(); this.step(1); break;
                case 'previous': this.openGadget(); this.step(-1); break;
                case 'pause': this.setPaused(true); break;
                case 'resume': this.setPaused(false); break;
                case 'refresh': this.openGadget(); void this.loadImages(); break;
                case 'show': this.openGadget(); this.showFile(String(d.filename || '')); break;
                case 'set_settings': {
                    const before = JSON.stringify([this.settings.viewType, this.settings.poolSize]);
                    this.applySettings(d.settings);
                    const src = d.settings || {};
                    const sourceChanged = JSON.stringify([this.settings.viewType, this.settings.poolSize]) !== before
                        || 'workspaces' in src || 'maxAgeDays' in src || 'search' in src;
                    if (this.screen === 'gadget') {
                        if (sourceChanged) void this.loadImages();
                        else { this.render(); this.arm(); }
                    }
                    break;
                }
                case 'rename': if (d.name) { this.name = String(d.name).slice(0, 64); this.save(); } break;
                default: ok = false;
            }
            this.send({ type: 'device_command_ack', commandId: msg.commandId, data: ok ? { ok: true } : { ok: false, error: 'Unknown command' } });
        }

        reportState() {
            // stopped only when the window closes (close()): the splash and home list are a running device
            let state = 'paused';
            let showing = [];
            if (this.screen === 'gadget' || this.screen === 'menu') {
                state = this.paused ? 'paused' : 'showing';
                showing = this.current();
            }
            this.send({ type: 'client_device_state', data: { deviceId: this.deviceId, state, showing, since: Date.now() } });
        }

        // ---- the slideshow ----

        /**
         * The server keeps the whole list for this device's settings (workspaces, age, Image Search);
         * the simulator holds a window of it: 50 names a page, the next page asked for a few pictures
         * ahead, each picture loaded only when it is shown (and the next two prefetched).
         */
        async loadImages() {
            this.loading = true;
            this.render();
            this.images = [];
            this.pages.clear();
            this.total = 0;
            this.pos = 0;
            this.seed = this.settings.shuffle ? String(Math.floor(Math.random() * 2147483647) + 1) : '';
            await this.fetchPage(0);
            this.loading = false;
            this.render();
            this.arm();
            this.reportState();
        }

        fetchPage(offset) {
            const PAGE = 50;
            const start = Math.floor(offset / PAGE) * PAGE;
            if (this.pages.has(start)) return this.pages.get(start);
            const job = this.request('device_slideshow_images', { offset: start, limit: PAGE, seed: this.seed || undefined }).then((res) => {
                const data = (res && res.data) || {};
                if (Number.isFinite(data.total)) this.total = data.total;
                (data.items || []).forEach((it, k) => {
                    this.images[start + k] = it.filename;
                    if (it.width && it.height && it.height > it.width) this.tall.add(it.filename);
                });
                if (!res) this.pages.delete(start);
            });
            this.pages.set(start, job);
            return job;
        }

        /** The name at a position (wrapping), or null while its page is on the way. */
        at(i) {
            if (!this.total) return null;
            const k = ((i % this.total) + this.total) % this.total;
            const name = this.images[k];
            if (!name) void this.fetchPage(k).then(() => { if (this.screen === 'gadget' && this.images[((this.pos % this.total) + this.total) % this.total]) this.render(); });
            return name || null;
        }

        /** Keep the next page coming before the cursor gets there. */
        prefetchAhead() {
            if (!this.total) return;
            for (let d = 0; d <= 5; d++) this.at(this.pos + d);
        }

        /** One picture, or two tall ones side by side on the landscape screen. */
        current() {
            const a = this.at(this.pos);
            if (!a) return [];
            const pair = this.pairAt(this.pos);
            return pair ? [a, pair] : [a];
        }

        pairAt(pos) {
            if (!this.landscape || !this.settings.pairPortraits || this.total < 2) return null;
            const a = this.at(pos);
            const b = this.at(pos + 1);
            return a && b && this.tall.has(a) && this.tall.has(b) ? b : null;
        }

        step(dir) {
            if (!this.total) return;
            const n = this.total;
            const span = dir > 0 && this.pairAt(this.pos) ? 2 : 1;
            this.pos = (((this.pos + dir * span) % n) + n) % n;
            this.prefetchAhead();
            this.render();
            this.arm();
            this.reportState();
        }

        showFile(name) {
            const i = this.images.indexOf(name);
            if (i >= 0) this.pos = i;
            else if (name) this.images[((this.pos % this.total) + this.total) % this.total || 0] = name;
            this.render();
            this.arm();
            this.reportState();
        }

        setPaused(on) {
            this.paused = !!on;
            if (this.screen === 'gadget') this.render();
            this.arm();
            this.reportState();
        }

        arm() {
            clearTimeout(this.timer);
            if (this.screen !== 'gadget' || this.paused || this.total < 2) return;
            this.timer = setTimeout(() => this.step(1), this.settings.intervalSec * 1000);
        }

        openGadget() {
            if (this.screen === 'gadget') return;
            this.screen = 'gadget';
            if (!this.total) void this.loadImages();
            else { this.render(); this.arm(); }
        }

        // ---- the buttons ----

        press(k) {
            if (this.screen === 'splash') return;
            if (this.screen === 'home') {
                if (k === 'up' || k === 'down') {
                    this.homeIndex = k === 'up' ? 0 : 1;
                    this.render();
                } else if (k === 'ok' || k === 'right') {
                    if (this.homeIndex === 1) { this.openGadget(); this.reportState(); }
                }
                return;
            }
            if (this.screen === 'menu') {
                const items = this.menuItems();
                if (k === 'up') this.menuIndex = (this.menuIndex + items.length - 1) % items.length;
                else if (k === 'down') this.menuIndex = (this.menuIndex + 1) % items.length;
                else if (k === 'back' || k === 'menu') this.screen = 'gadget';
                else if (k === 'ok') { this.screen = 'gadget'; items[this.menuIndex].run(); }
                this.render();
                return;
            }
            // the gadget
            if (k === 'left' || k === 'up') this.step(-1);
            else if (k === 'right' || k === 'down') this.step(1);
            else if (k === 'ok') this.setPaused(!this.paused);
            else if (k === 'menu') { this.screen = 'menu'; this.menuIndex = 0; this.render(); }
            else if (k === 'back') { this.screen = 'home'; clearTimeout(this.timer); this.render(); this.reportState(); }
        }

        menuItems() {
            return [
                { text: this.paused ? 'Resume slide show' : 'Pause slide show', run: () => this.setPaused(!this.paused) },
                { text: 'Refresh pictures', run: () => void this.loadImages() },
                { text: this.settings.shuffle ? 'Shuffle: On' : 'Shuffle: Off', run: () => { this.settings.shuffle = !this.settings.shuffle; this.save(); this.identify(); void this.loadImages(); } }
            ];
        }

        // ---- the LCD ----

        header() {
            return `<div class="sss-header" style="background-image:url('${ART}/fw-header.png')"><span class="sss-clock">${esc(clockText(this.landscape))}</span></div>`;
        }

        render() {
            const L = this.landscape;
            if (this.screen === 'splash') {
                this.lcd.innerHTML = `<div class="sss-splash" style="background-image:url('${ART}/fw-splash.jpg')"></div>`;
                return;
            }
            if (this.screen === 'home') {
                if (L) {
                    const items = [
                        { title: 'Welcome', text: 'Welcome to Melaton SideShow', icon: `${ART}/fw-logo.png` },
                        { title: GADGET, text: this.total ? `${this.total.toLocaleString('en-US')} pictures` : 'Pictures from your gallery', icon: '/static_images/vista-sideshow/slideshow-gadget-32.png' }
                    ];
                    const sel = items[this.homeIndex];
                    this.lcd.innerHTML = `<div class="sss-home is-landscape" style="background-image:url('${ART}/fw-bg-landscape.jpg')">
                        <span class="sss-clock sss-clock-free">${esc(clockText(true))}</span>
                        <div class="sss-tiles">${items.map((it, i) => `<div class="sss-tile${i === this.homeIndex ? ' is-selected' : ''}"><img src="${esc(it.icon)}" alt=""></div>`).join('')}</div>
                        <div class="sss-home-text"><b>${esc(sel.title)}</b><span>${esc(sel.text)}</span></div>
                    </div>`;
                } else {
                    this.lcd.innerHTML = `${this.header()}<div class="sss-home is-portrait" style="background-image:url('${ART}/fw-welcome-portrait.jpg')">
                        <div class="sss-welcome${this.homeIndex === 0 ? ' is-selected' : ''}"><b>Welcome</b><span>Welcome to Melaton SideShow</span><img src="/static_images/vista-sideshow/sideshow-48.png" alt=""></div>
                        <div class="sss-item${this.homeIndex === 1 ? ' is-selected' : ''}" style="--sel:url('${ART}/fw-select.png')">${esc(GADGET)}</div>
                    </div>`;
                }
                return;
            }
            const files = this.current();
            const s = this.settings;
            let info = '';
            if (files.length && s.infoOverlay === 'minimal') info = `<div class="sss-info">${(this.pos % this.total + 1).toLocaleString('en-US')} of ${this.total.toLocaleString('en-US')}</div>`;
            else if (files.length && s.infoOverlay === 'full') info = `<div class="sss-info is-full">${esc(files.join('  '))}<br>${(this.pos % this.total + 1).toLocaleString('en-US')} of ${this.total.toLocaleString('en-US')}</div>`;
            const body = this.loading ? '<div class="sss-msg">Updating...</div>'
                : !files.length ? '<div class="sss-msg">There are no pictures to show.</div>'
                    : `<div class="sss-pics${files.length > 1 ? ' is-pair' : ''}">${files.map((f) => `<img src="${esc(previewUrl(f))}" alt="" data-file="${esc(f)}">`).join('')}</div>`;
            this.lcd.innerHTML = `${this.header()}<div class="sss-gadget" style="background-image:url('${ART}/fw-bg-${L ? 'landscape' : 'portrait'}.jpg')">
                ${body}${info}${this.paused ? '<div class="sss-paused">Paused</div>' : ''}
                ${this.screen === 'menu' ? `<div class="sss-menu">${this.menuItems().map((it, i) => `<div class="sss-menu-item${i === this.menuIndex ? ' is-selected' : ''}" style="--bar:url('${ART}/fw-menu-item.png')">${esc(it.text)}</div>`).join('')}</div>` : ''}
            </div>`;
            // learn which pictures are tall, for portrait pairs on the landscape screen
            this.lcd.querySelectorAll('.sss-pics img').forEach((img) => {
                img.addEventListener('load', () => {
                    const tall = img.naturalHeight > img.naturalWidth;
                    if (tall && !this.tall.has(img.dataset.file)) {
                        this.tall.add(img.dataset.file);
                        if (this.landscape && this.settings.pairPortraits && this.current().length === 1 && this.pairAt(this.pos)) this.render();
                    }
                }, { once: true });
            });
            // and the next ones, so a pair is known before it comes up
            [this.at(this.pos + 1), this.at(this.pos + 2)].filter(Boolean).forEach((f) => {
                if (this.tall.has(f)) return;
                const im = new Image();
                im.onload = () => { if (im.naturalHeight > im.naturalWidth) this.tall.add(f); };
                im.src = previewUrl(f);
            });
        }

        close() {
            this.closing = true;
            clearTimeout(this.timer);
            clearInterval(this.clockTimer);
            this.screen = 'stopped';
            this.send({ type: 'client_device_state', data: { deviceId: this.deviceId, state: 'stopped', showing: [], since: Date.now() } });
            if (this.ws) {
                const ws = this.ws;
                this.ws = null;
                setTimeout(() => { try { ws.close(); } catch (_) { /* gone */ } }, 100);
            }
            callGlobal('closeModal', this.modal);
            this.modal.remove();
            delete sims[this.mode];
        }
    }

    const sims = {};

    async function openSideShowSimulator(mode) {
        if (!doc) return null;
        const m = MODES[mode] ? mode : 'portrait';
        if (sims[m] && sims[m].modal.isConnected) {
            sims[m].show();
            return sims[m];
        }
        const sim = new Simulator(m);
        sims[m] = sim;
        sim.show();
        sim.boot();
        return sim;
    }

    root.openSideShowSimulator = openSideShowSimulator;
    root.melatonSideShowSimulator = { open: openSideShowSimulator, MODES };
})(typeof window !== 'undefined' ? window : globalThis);
