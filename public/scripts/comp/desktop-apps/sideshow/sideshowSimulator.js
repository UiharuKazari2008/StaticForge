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
 * Like the Windows Dreamscape SlideShow it also describes settings of its own (deviceConfig: a schema
 * and values, DS-SlideShow-win64/docs/DEVICE_CONFIG_PROTOCOL.md) and two gadgets, the slideshow and a
 * clock with two faces; it takes set_device_config / set_mode, keeps clock time frames, and reports
 * changes with client_device_config. The clock is also on the device's own home list (OK opens it,
 * left / right change the face, Back returns to the list and selects the slideshow again). It also shows Control Panel what it looks like: a bezel drawn on
 * a canvas with the screen cut out (client_device_preview) and captures of its LCD redrawn on a canvas
 * (client_device_screen) after each change and every 30 s while the clock shows.
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
    const CLOCK_ICON = '/static_images/vista-cpl/categories/clock-language-and-region-32.png';
    // the home list: Welcome, then the gadgets
    const HOME = ['welcome', 'slideshow', 'clock'];

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

    // the device's own settings, as it describes them to the server (non-live ones restart it)
    const FACES = [{ id: 'analog', name: 'Analog', kind: 'analog' }, { id: 'digital', name: 'Digital', kind: 'digital' }];
    const MODE_OPTIONS = [{ value: 'slideshow', label: 'Slideshow' }, { value: 'clock', label: 'Clock' }];
    const FACE_OPTIONS = FACES.map((f) => ({ value: f.id, label: f.name }));
    const SCHEMA = [
        { key: 'mode', label: 'Showing', group: 'Display', type: 'enum', live: true, options: MODE_OPTIONS },
        { key: 'clockFace', label: 'Clock face', group: 'Display', type: 'enum', live: true, options: FACE_OPTIONS },
        { key: 'header', label: 'Show the title bar', group: 'Display', type: 'bool', live: true },
        { key: 'dim', label: 'Dim the screen', group: 'Screen', type: 'int', min: 0, max: 80, step: 5, unit: '%', live: true },
        { key: 'caption', label: 'Caption', group: 'Screen', type: 'string', maxLength: 24, live: true, help: 'Shown under the clock; empty hides it' },
        { key: 'background', label: 'Background', group: 'Screen', type: 'enum', options: [{ value: 'firmware', label: 'Firmware art' }, { value: 'black', label: 'Black' }], help: 'Changing it restarts the device' },
        { key: 'schedule.enabled', label: 'Use time frames', group: 'Clock time frames', type: 'bool', live: true },
        {
            key: 'schedule.entries', label: 'Time frames', group: 'Clock time frames', type: 'list', live: true, maxItems: 4,
            item: [
                { key: 'start', label: 'From', type: 'time' }, { key: 'end', label: 'Until', type: 'time' }, { key: 'days', label: 'Days', type: 'days' },
                { key: 'mode', label: 'Show', type: 'enum', options: MODE_OPTIONS.slice().reverse() }, { key: 'face', label: 'Clock face', type: 'enum', options: FACE_OPTIONS }
            ]
        }
    ];
    const DEFAULT_CONFIG = { mode: 'slideshow', clockFace: 'analog', header: true, dim: 0, caption: '', background: 'firmware', 'schedule.enabled': false, 'schedule.entries': [] };
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

    /** Why a value does not fit its descriptor (the device's own check), or null. */
    function fieldError(f, v) {
        switch (f.type) {
            case 'bool': return typeof v === 'boolean' ? null : 'must be true or false';
            case 'int': return Number.isInteger(v) && v >= f.min && v <= f.max ? null : `must be a whole number from ${f.min} to ${f.max}`;
            case 'string': return typeof v === 'string' && v.length <= f.maxLength ? null : `at most ${f.maxLength} characters`;
            case 'enum': return f.options.some((o) => o.value === v) ? null : 'not one of the choices';
            case 'time': return typeof v === 'string' && HHMM.test(v) ? null : 'must be HH:mm';
            case 'days': return Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? null : 'weekdays are 0 to 6';
            case 'list':
                if (!Array.isArray(v) || v.length > f.maxItems) return `at most ${f.maxItems} items`;
                for (const it of v) {
                    for (const s of f.item) {
                        const e = it && typeof it === 'object' ? fieldError(s, it[s.key]) : 'must be an object';
                        if (e) return `${s.label} ${e}`;
                    }
                }
                return null;
            default: return 'unknown';
        }
    }

    function minutes(hhmm) {
        const [h, m] = String(hhmm).split(':').map(Number);
        return h * 60 + m;
    }

    /** The first time frame covering now (index), or -1; one ending before it starts runs past midnight and belongs to the day it starts on. */
    function activeFrame(entries, now) {
        const t = now.getHours() * 60 + now.getMinutes();
        const today = now.getDay();
        const yesterday = (today + 6) % 7;
        return (entries || []).findIndex((e) => {
            const s = minutes(e.start);
            const end = minutes(e.end);
            const on = (day) => !e.days || !e.days.length || e.days.includes(day);
            if (s === end) return on(today);
            if (s < end) return on(today) && t >= s && t < end;
            return (on(today) && t >= s) || (on(yesterday) && t < end);
        });
    }

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
            this.config = Object.assign({}, DEFAULT_CONFIG, saved.config || {});
            this.frame = -1; // the time frame on now
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
            store(this.key, { deviceId: this.deviceId, name: this.name, settings: this.settings, config: this.config, onTop: this.onTop });
        }

        // ---- gadgets and the device's own settings ----

        /** What is on screen: the time frame's choice while one is on, else the selected mode / face. */
        get shown() {
            const e = this.frame >= 0 ? this.config['schedule.entries'][this.frame] : null;
            return e ? { mode: e.mode, face: e.face || this.config.clockFace } : { mode: this.config.mode, face: this.config.clockFace };
        }

        deviceConfig() {
            return { version: 1, schema: SCHEMA, values: Object.assign({}, this.config) };
        }

        gadgets() {
            const s = this.shown;
            return {
                mode: s.mode, face: s.face, selectedMode: this.config.mode, selectedFace: this.config.clockFace,
                scheduleEntry: this.frame >= 0 ? this.frame : null,
                available: [{ id: 'slideshow', name: GADGET }, { id: 'clock', name: 'Clock', faces: FACES }]
            };
        }

        sendConfig() {
            this.send({ type: 'client_device_config', data: { deviceId: this.deviceId, deviceConfig: this.deviceConfig(), gadgets: this.gadgets() } });
        }

        /** Re-check the time frames (every 10 s, and after a change); a switch redraws and reports. */
        evalFrames(report) {
            const before = JSON.stringify(this.shown) + this.frame;
            this.frame = this.config['schedule.enabled'] ? activeFrame(this.config['schedule.entries'], new Date()) : -1;
            const changed = JSON.stringify(this.shown) + this.frame !== before;
            if (changed || report) {
                if (this.screen !== 'splash' && this.screen !== 'stopped') this.render();
                this.reportState();
            }
            return changed;
        }

        /** set_device_config: the valid keys are applied, the rest rejected; a non-live change restarts the device. */
        applyConfig(raw) {
            const applied = [];
            const rejected = {};
            let restarting = false;
            Object.entries(raw && typeof raw === 'object' ? raw : {}).forEach(([key, value]) => {
                const f = SCHEMA.find((x) => x.key === key);
                const err = f ? fieldError(f, value) : 'unknown setting';
                if (err) { rejected[key] = err; return; }
                if (JSON.stringify(this.config[key]) === JSON.stringify(value)) return;
                this.config[key] = value;
                applied.push(key);
                if (!f.live) restarting = true;
            });
            this.save();
            return { ok: !Object.keys(rejected).length, applied, rejected, restarting };
        }

        afterConfig(res) {
            this.sendConfig();
            if (res.restarting) {
                // the cabinet restarts its slideshow (~1 s) and identifies again
                this.restart();
                return;
            }
            this.evalFrames(true);
        }

        restart() {
            const ws = this.ws;
            this.ws = null;
            this.screen = 'splash';
            this.render();
            setTimeout(() => { try { if (ws) ws.close(); } catch (_) { /* gone */ } }, 100);
            setTimeout(() => {
                if (this.closing || !this.modal.isConnected) return;
                this.screen = 'home';
                this.evalFrames(false);
                this.render();
                this.connect();
            }, 1000);
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
            // the clock face ticks every second; time frames are re-checked every 10 s
            clearInterval(this.tickTimer);
            let n = 0;
            this.tickTimer = setInterval(() => {
                if (++n % 10 === 0) this.evalFrames(false);
                if (this.screen === 'clock') this.drawClock();
                if (this.screen === 'clock' && n % 30 === 0) void this.sendScreen();
            }, 1000);
            this.evalFrames(false);
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
                    display: { width: lw, height: lh, orientation: this.mode }, settings: this.settings,
                    deviceConfig: this.deviceConfig(), gadgets: this.gadgets()
                }
            });
        }

        onIdentified(data) {
            if (data.name) this.name = String(data.name);
            if (data.settings) this.applySettings(data.settings);
            this.save();
            this.sendPreview();
            this.reportState();
            if (this.screen === 'gadget') void this.loadImages();
        }

        // ---- the device preview (DEVICE_CONFIG_PROTOCOL.md section 4) ----

        /** The bezel around the LCD: { width, height, pad, chin }, in LCD pixels. */
        bezel() {
            const [, , lw, lh] = this.m.lcd;
            const pad = 16;
            const chin = this.landscape ? 16 : 34;
            return { width: lw + pad * 2, height: lh + pad + chin, pad, lw, lh };
        }

        /**
         * client_device_preview, once per connection: a glossy black monitor bezel drawn on a canvas,
         * the screen cut out (transparent), a mask that is opaque only there, and where the capture goes.
         */
        sendPreview() {
            if (!doc) return;
            const b = this.bezel();
            const canvas = (w, h) => Object.assign(doc.createElement('canvas'), { width: w, height: h });
            const frame = canvas(b.width, b.height);
            const g = frame.getContext('2d');
            const round = (ctx, x, y, w, h, r) => {
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + w, y, r);
                ctx.closePath();
            };
            const grad = g.createLinearGradient(0, 0, b.width * 0.3, b.height);
            grad.addColorStop(0, '#5a5a5a');
            grad.addColorStop(0.38, '#262626');
            grad.addColorStop(0.39, '#050505');
            grad.addColorStop(1, '#000');
            round(g, 0.5, 0.5, b.width - 1, b.height - 1, 12);
            g.fillStyle = grad;
            g.fill();
            g.strokeStyle = '#000';
            g.stroke();
            // the LCD's sunken edge, then the opening itself
            g.strokeStyle = '#3c3c3c';
            g.strokeRect(b.pad - 1.5, b.pad - 1.5, b.lw + 3, b.lh + 3);
            g.clearRect(b.pad, b.pad, b.lw, b.lh);
            // a power light in the chin
            g.fillStyle = '#4fd34f';
            g.beginPath();
            g.arc(b.width / 2, b.pad + b.lh + (b.height - b.pad - b.lh) / 2, 2, 0, Math.PI * 2);
            g.fill();
            const mask = canvas(b.width, b.height);
            const mg = mask.getContext('2d');
            mg.fillStyle = '#fff';
            mg.fillRect(b.pad, b.pad, b.lw, b.lh);
            const b64 = (c) => c.toDataURL('image/png').replace(/^data:[^,]*,/, '');
            this.send({
                type: 'client_device_preview',
                data: {
                    deviceId: this.deviceId, version: 1, model: 'virtual-sideshow', width: b.width, height: b.height,
                    frame: b64(frame), mask: b64(mask),
                    screen: { x: b.pad, y: b.pad, width: b.lw, height: b.lh, sourceWidth: b.lw, sourceHeight: b.lh },
                    shape: { type: 'rect', x: b.pad, y: b.pad, width: b.lw, height: b.lh }
                }
            });
            this.captureSoon(500);
        }

        /** A capture ~delay ms from now (a later call moves it); the slideshow settles first. */
        captureSoon(delay) {
            clearTimeout(this.captureTimer);
            this.captureTimer = setTimeout(() => void this.sendScreen(), delay);
        }

        /**
         * client_device_screen: the LCD redrawn on a canvas (the picture or pair on screen, the clock,
         * or the home screen's backdrop), the header bar and the dimming, sent as a small JPEG.
         */
        async sendScreen() {
            if (!doc || !this.ws || this.ws.readyState !== 1 || this.closing || this.screen === 'stopped') return;
            const [, , lw, lh] = this.m.lcd;
            const c = Object.assign(doc.createElement('canvas'), { width: lw, height: lh });
            const g = c.getContext('2d');
            const load = (src) => new Promise((resolve) => {
                const im = new Image();
                im.onload = () => resolve(im);
                im.onerror = () => resolve(null);
                im.src = src;
            });
            const contain = (im, x, y, w, h) => {
                const s = Math.min(w / im.naturalWidth, h / im.naturalHeight);
                const dw = im.naturalWidth * s;
                const dh = im.naturalHeight * s;
                g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
            };
            const top = this.config.header === false || this.screen === 'splash' ? 0 : 18;
            g.fillStyle = '#000';
            g.fillRect(0, 0, lw, lh);
            const bgName = this.screen === 'splash' ? 'fw-splash.jpg' : `fw-bg-${this.landscape ? 'landscape' : 'portrait'}.jpg`;
            if (this.screen !== 'gadget' && this.screen !== 'menu' && !(this.screen === 'clock' && this.config.background === 'black')) {
                const bg = await load(`${ART}/${bgName}`);
                if (bg) g.drawImage(bg, 0, 0, lw, lh);
            }
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            if (this.screen === 'clock') {
                const face = this.lcd.querySelector('.sss-face svg');
                const size = Math.min(lw, lh - top) * 0.7;
                if (face) {
                    const im = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(face))}`);
                    if (im) g.drawImage(im, (lw - size) / 2, top + (lh - top - size) / 2, size, size);
                } else {
                    const now = new Date();
                    const pad = (n) => String(n).padStart(2, '0');
                    g.fillStyle = '#fff';
                    g.font = `bold ${Math.round(lw / 5)}px "Segoe UI", sans-serif`;
                    g.fillText(`${pad(now.getHours())}:${pad(now.getMinutes())}`, lw / 2, top + (lh - top) / 2);
                }
                if (this.config.caption) {
                    g.fillStyle = '#fff';
                    g.font = '13px "Segoe UI", sans-serif';
                    g.fillText(this.config.caption, lw / 2, lh - 16);
                }
            } else if (this.screen === 'gadget' || this.screen === 'menu') {
                const imgs = Array.from(this.lcd.querySelectorAll('.sss-pics img')).filter((im) => im.complete && im.naturalWidth);
                const w = (lw) / Math.max(1, imgs.length);
                imgs.forEach((im, i) => contain(im, i * w, top, w, lh - top));
                if (this.paused) {
                    g.fillStyle = 'rgba(0,0,0,.6)';
                    g.fillRect(lw / 2 - 40, lh - 34, 80, 22);
                    g.fillStyle = '#fff';
                    g.font = '13px "Segoe UI", sans-serif';
                    g.fillText('Paused', lw / 2, lh - 23);
                }
            } else if (this.screen === 'home') {
                g.fillStyle = '#fff';
                g.font = 'bold 15px "Segoe UI", sans-serif';
                g.fillText('Melaton SideShow', lw / 2, top + 30);
                g.font = '13px "Segoe UI", sans-serif';
                g.fillText(GADGET, lw / 2, top + 54);
            }
            if (top) {
                g.fillStyle = '#1c2a3a';
                g.fillRect(0, 0, lw, top);
                g.fillStyle = '#fff';
                g.font = '11px "Segoe UI", sans-serif';
                g.textAlign = 'right';
                g.fillText(clockText(this.landscape), lw - 6, top / 2);
            }
            const dim = Number(this.config.dim) || 0;
            if (dim > 0) {
                g.fillStyle = `rgba(0,0,0,${dim / 100})`;
                g.fillRect(0, 0, lw, lh);
            }
            const image = c.toDataURL('image/jpeg', 0.8).replace(/^data:[^,]*,/, '');
            this.send({ type: 'client_device_screen', data: { deviceId: this.deviceId, format: 'jpeg', image, width: lw, height: lh, at: Date.now() } });
        }

        applySettings(s) {
            const src = s || {};
            if (VIEW_TYPES.has(src.viewType)) this.settings.viewType = src.viewType;
            if (Number.isFinite(Number(src.intervalSec))) this.settings.intervalSec = Math.min(86400, Math.max(5, Math.round(Number(src.intervalSec))));
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
                case 'set_device_config':
                case 'set_mode': {
                    // set_mode is set_device_config's { mode, clockFace }
                    const config = d.command === 'set_mode' ? Object.assign({ mode: d.mode }, d.face ? { clockFace: d.face } : {}) : d.config;
                    const res = this.applyConfig(config);
                    this.send({ type: 'device_command_ack', commandId: msg.commandId, data: res });
                    this.afterConfig(res);
                    return;
                }
                default: ok = false;
            }
            this.send({ type: 'device_command_ack', commandId: msg.commandId, data: ok ? { ok: true } : { ok: false, error: 'Unknown command' } });
        }

        reportState() {
            // stopped only when the window closes (close()): the splash and home list are a running device
            let state = 'paused';
            let showing = [];
            const s = this.shown;
            if (s.mode === 'clock') {
                state = 'showing';
            } else if (this.screen === 'gadget' || this.screen === 'menu') {
                state = this.paused ? 'paused' : 'showing';
                showing = this.current();
            }
            this.send({
                type: 'client_device_state',
                data: { deviceId: this.deviceId, state, showing, since: Date.now(), mode: s.mode, face: s.mode === 'clock' ? s.face : null, scheduleEntry: this.frame >= 0 ? this.frame : null }
            });
            // the screen as it now looks, once the picture has loaded
            this.captureSoon(2000);
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

        /** The manual choice of gadget (set_mode's, made on the device); reported like any config change. */
        selectMode(mode) {
            if (this.config.mode === mode) return;
            this.config.mode = mode;
            this.save();
            this.sendConfig();
        }

        /** The Clock gadget from the home list; an active time frame may still show the slideshow. */
        openClock() {
            this.selectMode('clock');
            this.evalFrames(true);
        }

        /** Left / right on the clock: the other face, kept as the selected face. */
        stepFace(dir) {
            const i = FACES.findIndex((f) => f.id === this.config.clockFace);
            this.config.clockFace = FACES[(Math.max(0, i) + dir + FACES.length) % FACES.length].id;
            this.save();
            this.sendConfig();
            this.render();
            this.reportState();
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
            if (this.screen === 'clock') {
                // Back leaves the clock for the home list (and selects the slideshow again); a time
                // frame that shows the clock keeps it on screen
                if (k === 'left' || k === 'up') this.stepFace(-1);
                else if (k === 'right' || k === 'down' || k === 'ok') this.stepFace(1);
                else if (k === 'back') {
                    this.selectMode('slideshow');
                    this.screen = 'home';
                    this.evalFrames(true);
                }
                return;
            }
            if (this.screen === 'home') {
                if (k === 'up' || k === 'down') {
                    this.homeIndex = Math.max(0, Math.min(HOME.length - 1, this.homeIndex + (k === 'up' ? -1 : 1)));
                    this.render();
                } else if (k === 'ok' || k === 'right') {
                    if (HOME[this.homeIndex] === 'slideshow') { this.openGadget(); this.reportState(); }
                    else if (HOME[this.homeIndex] === 'clock') this.openClock();
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
            if (this.config.header === false) return '';
            return `<div class="sss-header" style="background-image:url('${ART}/fw-header.png')"><span class="sss-clock">${esc(clockText(this.landscape))}</span></div>`;
        }

        /** The gadget screens' background (the firmware's art, or black) and the dimming over the LCD. */
        backdrop() {
            return this.config.background === 'black' ? 'background:#000' : `background-image:url('${ART}/fw-bg-${this.landscape ? 'landscape' : 'portrait'}.jpg')`;
        }

        dimmer() {
            const dim = Number(this.config.dim) || 0;
            return dim > 0 ? `<div class="sss-dim" style="opacity:${dim / 100}"></div>` : '';
        }

        renderClock() {
            const caption = this.config.caption ? `<div class="sss-caption">${esc(this.config.caption)}</div>` : '';
            this.lcd.innerHTML = `${this.header()}<div class="sss-gadget sss-clockface${this.config.header === false ? ' is-bare' : ''}" style="${this.backdrop()}"><div class="sss-face"></div>${caption}</div>${this.dimmer()}`;
            this.drawClock();
        }

        /** The clock: hands on a dial, or the time in digits, redrawn every second. */
        drawClock() {
            const el = this.lcd.querySelector('.sss-face');
            if (!el) return;
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            if (this.shown.face === 'digital') {
                el.innerHTML = `<div class="sss-digital">${pad(now.getHours())}:${pad(now.getMinutes())}<small>:${pad(now.getSeconds())}</small></div><div class="sss-date">${esc(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</div>`;
                return;
            }
            const hand = (deg, len, w, color) => {
                const r = (deg - 90) * Math.PI / 180;
                return `<line x1="60" y1="60" x2="${(60 + len * Math.cos(r)).toFixed(2)}" y2="${(60 + len * Math.sin(r)).toFixed(2)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
            };
            const ticks = Array.from({ length: 60 }, (_, i) => {
                const r = (i * 6 - 90) * Math.PI / 180;
                const a = i % 5 ? 52 : 46;
                return `<line x1="${(60 + a * Math.cos(r)).toFixed(2)}" y1="${(60 + a * Math.sin(r)).toFixed(2)}" x2="${(60 + 55 * Math.cos(r)).toFixed(2)}" y2="${(60 + 55 * Math.sin(r)).toFixed(2)}" stroke="#222" stroke-width="${i % 5 ? 1 : 3}"/>`;
            }).join('');
            const s = now.getSeconds();
            const m = now.getMinutes() + s / 60;
            const h = (now.getHours() % 12) + m / 60;
            el.innerHTML = `<svg viewBox="0 0 120 120" class="sss-analog"><circle cx="60" cy="60" r="58" fill="#fff" stroke="#333" stroke-width="2"/>${ticks}${hand(h * 30, 30, 5, '#222')}${hand(m * 6, 44, 3.5, '#222')}${hand(s * 6, 46, 1.2, '#c00')}<circle cx="60" cy="60" r="3" fill="#c00"/></svg>`;
        }

        render() {
            const L = this.landscape;
            if (this.screen === 'splash') {
                this.lcd.innerHTML = `<div class="sss-splash" style="background-image:url('${ART}/fw-splash.jpg')"></div>`;
                return;
            }
            // the clock gadget takes the screen while it is selected or a time frame shows it
            if (this.shown.mode === 'clock') {
                if (this.screen !== 'clock') { clearTimeout(this.timer); this.screen = 'clock'; }
                this.renderClock();
                return;
            }
            if (this.screen === 'clock') {
                this.screen = 'gadget';
                if (!this.total) { void this.loadImages(); return; }
                this.arm();
            }
            if (this.screen === 'home') {
                if (L) {
                    const items = [
                        { title: 'Welcome', text: 'Welcome to Melaton SideShow', icon: `${ART}/fw-logo.png` },
                        { title: GADGET, text: this.total ? `${this.total.toLocaleString('en-US')} pictures` : 'Pictures from your gallery', icon: '/static_images/vista-sideshow/slideshow-gadget-32.png' },
                        { title: 'Clock', text: `${(FACES.find((f) => f.id === this.config.clockFace) || FACES[0]).name} clock`, icon: CLOCK_ICON }
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
                        <div class="sss-item${this.homeIndex === 2 ? ' is-selected' : ''}" style="--sel:url('${ART}/fw-select.png')">Clock</div>
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
            this.lcd.innerHTML = `${this.header()}<div class="sss-gadget${this.config.header === false ? ' is-bare' : ''}" style="${this.backdrop()}">
                ${body}${info}${this.paused ? '<div class="sss-paused">Paused</div>' : ''}
                ${this.screen === 'menu' ? `<div class="sss-menu">${this.menuItems().map((it, i) => `<div class="sss-menu-item${i === this.menuIndex ? ' is-selected' : ''}" style="--bar:url('${ART}/fw-menu-item.png')">${esc(it.text)}</div>`).join('')}</div>` : ''}
            </div>${this.dimmer()}`;
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
            clearTimeout(this.captureTimer);
            clearInterval(this.clockTimer);
            clearInterval(this.tickTimer);
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
