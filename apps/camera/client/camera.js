/**
 * Melaton Camera (#910, Yukimi Nov 20 2026): the computer's camera in a window, to test it and to keep
 * pictures and videos. Vista shipped no webcam program; this one is built like its media programs
 * (Sound Recorder's band and tool buttons, Windows Media Player's black surface, the kit's lists).
 *
 *   preview      getUserMedia; Camera / Microphone lists (enumerateDevices, their labels), Resolution and
 *                Frame rate from the camera track's capabilities; View > Mirror Image (the preview only)
 *   capture      Take Picture (a canvas frame, PNG) into the workspace's Pictures (the gallery, so Lumen
 *                opens it); Start Recording (MediaRecorder, MP4 where the browser records it, else WebM,
 *                with the microphone's sound) into the workspace's Videos folder, Pause / Resume / Stop,
 *                the time and the microphone's peak meter
 *   power        the camera and microphone run only while the window is on screen: minimised, closed or on
 *                a hidden page every track stops (DreamOS powers the FaceTime HD camera down ~3 s later) and
 *                the meter's AudioContext closes. A recording keeps its tracks until it is stopped; only
 *                its drawing (preview, meter, time) sleeps while unseen.
 *   errors       Vista's words on the surface: no camera, access denied, in use, unplugged (devicechange)
 *
 *   melatonApps.define('camera', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const NAME = 'Melaton Camera';
    const ICON16 = '/static_images/app_icons/16/melaton-camera.webp';
    const ICON32 = '/static_images/app_icons/32/melaton-camera.webp';
    const PREFS_KEY = 'melatonCameraPrefs';
    const METER_BARS = 16;
    const TICK_MS = 80;
    // a recording is sent through the socket as base64: stop before the message outgrows it
    const MAX_RECORDING_BYTES = 60 * 1024 * 1024;
    const SIZES = [[320, 240], [640, 480], [800, 600], [1024, 768], [1280, 720], [1280, 960], [1600, 1200], [1920, 1080], [2560, 1440], [3840, 2160]];
    const RATES = [5, 10, 15, 20, 24, 25, 30, 50, 60];
    const TYPES = [
        ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,mp4a', 'mp4'], ['video/mp4', 'mp4'],
        ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']
    ];

    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
    const ws = () => root.wsClient || (typeof wsClient !== 'undefined' ? wsClient : null); // eslint-disable-line no-undef
    const workspace = () => (typeof activeWorkspace !== 'undefined' && activeWorkspace ? activeWorkspace : (root.activeWorkspace || '')); // eslint-disable-line no-undef
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    function readPrefs() {
        try { return Object.assign({ mirror: true }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (_) { return { mirror: true }; }
    }

    /** The recording format: MP4 where the browser records it (Chromium 126+), else WebM. */
    function recordingType() {
        const MR = root.MediaRecorder;
        if (!MR || typeof MR.isTypeSupported !== 'function') return null;
        const hit = TYPES.find(([t]) => { try { return MR.isTypeSupported(t); } catch (_) { return false; } });
        return hit ? { mime: hit[0], ext: hit[1] } : null;
    }

    /**
     * What the surface says, in the words of Vista's media programs (Windows Movie Maker / Live Messenger's
     * webcam pages): title line, the line under it, and whether Try Again is offered.
     */
    const NOTES = {
        starting: ['Starting the camera...', '', false],
        off: ['The camera is off.', 'It turns on when the window is shown.', false],
        nocam: ['No camera was found.', 'Make sure that your camera is connected and turned on, and then click Try Again.', true],
        denied: ['Access to the camera was denied.', 'Allow Melaton Camera to use the camera and the microphone, and then click Try Again.', true],
        busy: ['The camera is being used by another program.', 'Close the other program, and then click Try Again.', true],
        unplugged: ['The camera was disconnected.', 'Reconnect the camera, and then click Try Again.', true],
        format: ['The camera cannot use the selected resolution.', 'Choose another resolution or frame rate.', true],
        unsupported: ['This computer cannot use a camera.', 'The camera can only be used over a secure connection.', false],
        failed: ['The camera could not be started.', '', true]
    };

    function noteFor(err) {
        const n = err && err.name;
        if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'nocam';
        if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') return 'denied';
        if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
        if (n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError') return 'format';
        return 'failed';
    }

    class Camera {
        constructor(app) {
            this.app = app;
            this.prefs = readPrefs();
            this.cams = [];
            this.mics = [];
            this.stream = null;
            this.state = 'off';        // off | starting | live | error
            this.note = 'starting';
            this.openSeq = 0;
            this.rec = null;           // { recorder, chunks, bytes, type, t0, elapsed, paused, done }
            this.ac = null;
            this.analyser = null;
            this.timer = null;
            this.lit = -1;
            this.last = null;          // { kind: 'picture' | 'video', name, filename?, path?, thumb }
            this.caps = null;          // the camera track's capabilities
            this.status = 'Ready';
            this.captureSeq = 0;      // captures in the order they were taken (saves can finish out of order)
            this.shownSeq = 0;
            this.build();
            this.wire();
            void this.enumerate();
            this.onSeen();
        }

        // ---- the window ----

        build() {
            const w = root.desktopAppCreateWindow({
                id: 'melatonCameraModal',
                identifier: 'melatonCamera',
                title: NAME,
                icon16: ICON16,
                taskbarIcon: ICON32,
                className: 'resizeable-window cam-window',
                minimize: true
            });
            const m = w.modal;
            this.modal = m;
            this.closeBtn = w.close;
            m.dataset.windowDefaultWidth = '760';
            m.dataset.windowDefaultHeight = '620';
            m.dataset.windowMinWidth = '560';
            m.dataset.windowMinHeight = '420';
            // a custom program (ui-standard section 6): Melaton's frame and kit, its own surface
            m.dataset.windowKind = 'custom';
            const controls = m.querySelector('.modal-window-controls');
            if (controls && w.close) {
                const max = doc.createElement('button');
                max.type = 'button';
                max.className = 'btn-secondary btn-small modal-work-area-maximize';
                max.title = 'Maximize';
                max.innerHTML = '<i class="fa-regular fa-window-maximize"></i>';
                controls.insertBefore(max, w.close);
            }
            const menus = [['File', 'file'], ['View', 'view'], ['Help', 'help']];
            w.content.classList.add('cam-client');
            w.content.innerHTML = `
                <div class="naxt-menubar" role="menubar" data-win32-menus>${menus.map(([t, id]) => `<button type="button" class="naxt-menu-title" role="menuitem" data-cam-menu="${id}"><u>${t[0]}</u>${t.slice(1)}</button>`).join('')}</div>
                <div class="cam-bar cam-setup" role="toolbar" aria-label="Devices">
                    <label>Camera:</label><button type="button" class="custom-dropdown-btn cam-pick" data-cam-pick="camera" aria-haspopup="listbox"></button>
                    <label>Microphone:</label><button type="button" class="custom-dropdown-btn cam-pick" data-cam-pick="mic" aria-haspopup="listbox"></button>
                    <label>Resolution:</label><button type="button" class="custom-dropdown-btn cam-pick" data-cam-pick="size" aria-haspopup="listbox"></button>
                    <button type="button" class="custom-dropdown-btn cam-pick" data-cam-pick="fps" aria-haspopup="listbox" aria-label="Frame rate"></button>
                </div>
                <div class="cam-stage" aria-label="Preview">
                    <video class="cam-video" muted playsinline disablepictureinpicture></video>
                    <div class="cam-flash"></div>
                    <div class="cam-badge hidden"><span class="cam-badge-time">0:00:00</span></div>
                    <div class="cam-note">
                        <img src="${ICON32.replace('/32/', '/48/')}" alt="">
                        <div class="cam-note-text"></div>
                        <div class="cam-note-sub"></div>
                        <button type="button" class="hidden" data-cam="retry">Try Again</button>
                    </div>
                </div>
                <div class="cam-bar cam-tools" role="toolbar" aria-label="Capture">
                    <button type="button" class="cam-tool" data-cam="picture" title="Take Picture (Space)"><span class="cam-glyph" data-glyph="shutter"></span><span>Take <u>P</u>icture</span></button>
                    <button type="button" class="cam-tool" data-cam="record" title="Start Recording (Alt+R)"><span class="cam-glyph" data-glyph="record"></span><span class="cam-record-label">Start <u>R</u>ecording</span></button>
                    <button type="button" class="cam-tool" data-cam="pause" title="Pause Recording" disabled><span class="cam-glyph" data-glyph="pause"></span><span class="cam-pause-label">Pause</span></button>
                    <span class="cam-sep" aria-hidden="true"></span>
                    <span class="cam-time" aria-label="Recording time">0:00:00</span>
                    <span class="cam-meter is-off" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="${METER_BARS}" aria-valuenow="0">${'<i></i>'.repeat(METER_BARS)}</span>
                    <span class="cam-fill"></span>
                    <button type="button" class="cam-tool cam-last hidden" data-cam="open-last" title="Open the last capture"><img alt=""></button>
                </div>
                <div class="status-bar"><p class="status-bar-field" data-cam-status="text"></p><p class="status-bar-field" data-cam-status="device"></p></div>`;
            this.q = (s) => m.querySelector(s);
            this.video = this.q('.cam-video');
            this.bars = Array.from(m.querySelectorAll('.cam-meter i'));
            themeStyles();
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed || m.hasAttribute('data-window-position-restored')) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 3)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: NAME, terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'camera' }) });
            }
            this.syncMirror();
            this.sync();
        }

        wire() {
            const m = this.modal;
            const sig = { signal: this.app.signal };
            this.closeBtn.addEventListener('click', () => void this.close(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            // the window minimised or back (modalUtils' minimising / minimised classes), the page hidden or
            // the screen off: the camera goes off and on with it
            const mo = new MutationObserver(() => this.onSeen());
            mo.observe(m, { attributes: true, attributeFilter: ['class'] });
            this.app.signal.addEventListener('abort', () => mo.disconnect(), { once: true });
            doc.addEventListener('visibilitychange', () => this.onSeen(), sig);
            root.addEventListener('melatonscreen', () => this.onSeen(), sig);
            const md = navigator.mediaDevices;
            if (md && typeof md.addEventListener === 'function') md.addEventListener('devicechange', () => void this.onDeviceChange(), sig);
            m.addEventListener('click', (ev) => {
                const t = ev.target.closest('[data-cam]');
                if (t && !t.disabled && m.contains(t)) void this.command(t.dataset.cam);
            }, sig);
            m.addEventListener('keydown', (ev) => {
                if (ev.target && ev.target.closest && ev.target.closest('input, textarea')) return;
                const k = ev.key.toLowerCase();
                if (ev.altKey && !ev.ctrlKey && (k === 'p' || k === 'r')) { ev.preventDefault(); void this.command(k === 'p' ? 'picture' : 'record'); return; }
                if (ev.key === ' ' && !ev.altKey && !ev.ctrlKey && !(ev.target && ev.target.closest && ev.target.closest('button'))) { ev.preventDefault(); void this.command('picture'); return; }
                if (ev.key === 'F1') { ev.preventDefault(); this.help(); }
            }, sig);
            const cm = root.contextMenu;
            if (cm) {
                m.querySelectorAll('.naxt-menu-title').forEach((t) => {
                    cm.attachClickMenuToElement(t, {
                        onAction: (a) => void this.command(a),
                        sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.camMenu); } }]
                    });
                });
                const pick = (key, items, value, onSelect) => {
                    const b = this.q(`[data-cam-pick="${key}"]`);
                    if (b && typeof cm.attachPickerMenu === 'function') cm.attachPickerMenu(b, { items, value, onSelect });
                };
                pick('camera', () => (this.cams.length ? this.cams.map((d) => ({ value: d.deviceId, text: d.label })) : [{ value: '', text: '(None)', disabled: true }]),
                    () => this.currentCamId(), (v) => this.choose({ camera: v }));
                pick('mic', () => [{ value: 'none', text: '(None)' }].concat(this.mics.map((d) => ({ value: d.deviceId, text: d.label }))),
                    () => this.currentMicId(), (v) => this.choose({ mic: v }));
                pick('size', () => this.sizeItems(), () => this.currentSizeKey(), (v) => this.choose({ size: v }));
                pick('fps', () => this.rateItems(), () => String(this.currentRate() || ''), (v) => this.choose({ fps: Number(v) || 0 }));
            }
            // a live update waits for the recording to end (app-scope-ownership rule 8)
            if (typeof this.app.onBeforeUpdate === 'function') this.app.onBeforeUpdate(() => (this.rec ? 'Melaton Camera is recording' : undefined));
        }

        menu(id) {
            const live = this.state === 'live';
            const rec = this.rec;
            if (id === 'file') {
                return [
                    { text: 'Take Picture', subtext: 'Space', action: 'picture', disabled: !live },
                    { text: rec ? 'Stop Recording' : 'Start Recording', subtext: 'Alt+R', action: 'record', disabled: !live && !rec },
                    { text: rec && rec.paused ? 'Resume Recording' : 'Pause Recording', action: 'pause', disabled: !rec },
                    { separator: true },
                    { text: 'Open Last Capture', action: 'open-last', disabled: !this.last },
                    { text: 'Open Pictures Folder', action: 'open-pictures', disabled: !workspace() },
                    { text: 'Open Videos Folder', action: 'open-videos', disabled: !workspace() },
                    { separator: true },
                    { text: 'Exit', action: 'exit' }
                ];
            }
            if (id === 'view') {
                return [
                    { text: 'Mirror Image', action: 'mirror', showIndicator: true, checked: !!this.prefs.mirror },
                    { separator: true },
                    { text: 'Refresh Device List', action: 'refresh' }
                ];
            }
            return [
                { text: 'View Help', subtext: 'F1', action: 'help' },
                { separator: true },
                { text: `About ${NAME}`, action: 'about' }
            ];
        }

        async command(c) {
            switch (c) {
                case 'picture': return this.takePicture();
                case 'record': return this.rec ? this.stopRecording() : this.startRecording();
                case 'pause': return this.togglePause();
                case 'retry': return this.open(true);
                case 'open-last': return this.openLast();
                case 'open-pictures': { const w = workspace(); if (w) await call('openExplorerApplet', `/Workspaces/${w}/Pictures`); return undefined; }
                case 'open-videos': { const w = workspace(); if (w && await this.videosFolder(w)) await call('openExplorerApplet', `/Workspaces/${w}/Videos`); return undefined; }
                case 'mirror': this.prefs.mirror = !this.prefs.mirror; this.savePrefs(); this.syncMirror(); return undefined;
                case 'refresh': return this.enumerate();
                case 'help': return this.help();
                case 'about': if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: NAME, owner: this.modal }); return undefined;
                case 'exit': return this.close();
                default: return undefined;
            }
        }

        // ---- devices ----

        async enumerate() {
            const md = navigator.mediaDevices;
            if (!md || typeof md.enumerateDevices !== 'function') return;
            let list = [];
            try { list = await md.enumerateDevices(); } catch (_) { list = []; }
            if (this.app.signal.aborted) return;
            const named = (kind, word) => list.filter((d) => d.kind === kind && d.deviceId !== 'communications')
                .filter((d, i, all) => d.deviceId !== 'default' || all.length === 1)
                .map((d, i) => ({ deviceId: d.deviceId, groupId: d.groupId, label: (d.label || '').replace(/^Default - /, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') || `${word} ${i + 1}` }));
            this.cams = named('videoinput', 'Camera');
            this.mics = named('audioinput', 'Microphone');
            this.sync();
        }

        async onDeviceChange() {
            const hadCam = this.cams.length;
            await this.enumerate();
            if (this.app.signal.aborted) return;
            const track = this.videoTrack();
            // the camera in use went away: its track ends too (onTrackEnded); here only when it did not
            if (track && track.readyState === 'live' && this.prefs.camera && !this.cams.some((d) => d.deviceId === this.prefs.camera) && this.cams.length < hadCam) {
                this.trackEnded();
                return;
            }
            // a camera arrived while the window said there was none (or it was unplugged): start it
            if (this.state === 'error' && (this.note === 'nocam' || this.note === 'unplugged') && this.cams.length && this.seen()) void this.open(true);
        }

        currentCamId() {
            const t = this.videoTrack();
            const s = t && typeof t.getSettings === 'function' ? t.getSettings() : null;
            return (s && s.deviceId) || this.prefs.camera || (this.cams[0] && this.cams[0].deviceId) || '';
        }

        currentMicId() {
            if (this.prefs.mic === 'none') return 'none';
            const t = this.audioTrack();
            const s = t && typeof t.getSettings === 'function' ? t.getSettings() : null;
            return (s && s.deviceId) || this.prefs.mic || (this.mics[0] && this.mics[0].deviceId) || 'none';
        }

        currentSize() {
            const t = this.videoTrack();
            const s = t && typeof t.getSettings === 'function' ? t.getSettings() : null;
            if (s && s.width && s.height) return [s.width, s.height];
            return this.prefs.size ? this.prefs.size.split('x').map(Number) : null;
        }

        currentSizeKey() {
            const s = this.currentSize();
            return s ? `${s[0]}x${s[1]}` : '';
        }

        currentRate() {
            const t = this.videoTrack();
            const s = t && typeof t.getSettings === 'function' ? t.getSettings() : null;
            return s && s.frameRate ? Math.round(s.frameRate) : (this.prefs.fps || 0);
        }

        /** The camera's sizes: the usual ones inside its width / height range, and the one it runs at. */
        sizeItems() {
            const c = this.caps;
            const cur = this.currentSize();
            let list = SIZES.slice();
            if (c && c.width && c.height) {
                list = list.filter(([w, h]) => w <= (c.width.max || w) && h <= (c.height.max || h) && w >= (c.width.min || 0) && h >= (c.height.min || 0));
            }
            if (cur && !list.some(([w, h]) => w === cur[0] && h === cur[1])) list.push(cur);
            list.sort((a, b) => a[0] * a[1] - b[0] * b[1]);
            return list.map(([w, h]) => ({ value: `${w}x${h}`, text: `${w} x ${h}` }));
        }

        rateItems() {
            const c = this.caps && this.caps.frameRate;
            const cur = this.currentRate();
            let list = RATES.slice();
            if (c) list = list.filter((r) => r <= Math.round(c.max || r) && r >= Math.floor(c.min || 0));
            if (cur && !list.includes(cur)) list.push(cur);
            list.sort((a, b) => a - b);
            return list.map((r) => ({ value: String(r), text: `${r} fps` }));
        }

        choose(change) {
            if (this.rec) return;
            if ('camera' in change) {
                this.prefs.camera = change.camera;
                // another camera has other sizes: it starts at its own default
                delete this.prefs.size;
                delete this.prefs.fps;
            }
            if ('mic' in change) this.prefs.mic = change.mic;
            if ('size' in change) this.prefs.size = change.size;
            if ('fps' in change) this.prefs.fps = change.fps;
            this.savePrefs();
            this.sync();
            void this.open(true);
        }

        savePrefs() {
            try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch (_) { /* private mode */ }
        }

        videoTrack() { return this.stream ? this.stream.getVideoTracks()[0] || null : null; }

        audioTrack() { return this.stream ? this.stream.getAudioTracks()[0] || null : null; }

        // ---- the camera on and off ----

        /** On screen: the window shown (not minimised), the page seen, the screen on. */
        seen() {
            const m = this.modal;
            return !!m && m.isConnected && !m.classList.contains('hidden') && !m.classList.contains('minimised') && !m.classList.contains('minimising')
                && !doc.hidden && doc.documentElement.dataset.screenOff === undefined;
        }

        onSeen() {
            if (this.app.signal.aborted) return;
            const seen = this.seen();
            if (seen === this.wasSeen) return;
            this.wasSeen = seen;
            if (seen) {
                if (this.stream) {
                    void this.video.play().catch(() => {});
                    this.syncMeter();
                } else if (this.state !== 'error' || this.note === 'denied' || this.note === 'busy') {
                    void this.open(false);
                }
                return;
            }
            // unseen: no drawing; the camera off unless it is recording
            this.stopMeter();
            try { this.video.pause(); } catch (_) { /* gone */ }
            if (!this.rec) this.release('off');
        }

        async open(force) {
            const md = navigator.mediaDevices;
            if (!md || typeof md.getUserMedia !== 'function') { this.fail('unsupported'); return; }
            if (this.rec) return;
            if (!force && this.state === 'starting') return;
            const seq = ++this.openSeq;
            this.release('starting');
            const p = this.prefs;
            const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
            if (p.camera) video.deviceId = { exact: p.camera };
            if (p.size) { const [w, h] = p.size.split('x').map(Number); if (w && h) { video.width = { ideal: w }; video.height = { ideal: h }; } }
            if (p.fps) video.frameRate = { ideal: p.fps };
            const audio = p.mic === 'none' ? false : (p.mic ? { deviceId: { exact: p.mic } } : true);
            let stream = null;
            try {
                stream = await md.getUserMedia({ video, audio });
            } catch (err) {
                // a camera chosen before and gone now: the default one
                if (err && err.name === 'OverconstrainedError' && err.constraint === 'deviceId' && p.camera) {
                    delete p.camera;
                    this.savePrefs();
                    if (seq === this.openSeq) void this.open(true);
                    return;
                }
                // no microphone (or it is in use) must not keep the picture away
                if (audio && err && (err.name === 'NotFoundError' || err.name === 'NotReadableError' || (err.name === 'OverconstrainedError' && err.constraint === 'deviceId'))) {
                    try { stream = await md.getUserMedia({ video, audio: false }); } catch (err2) { stream = null; err = err2; } // eslint-disable-line no-ex-assign
                }
                if (!stream) {
                    if (seq !== this.openSeq || this.app.signal.aborted) return;
                    this.fail(noteFor(err));
                    void this.enumerate();
                    return;
                }
            }
            // the window went away (closed, minimised, another open) while the browser was asking
            if (seq !== this.openSeq || this.app.signal.aborted || !this.seen()) {
                stream.getTracks().forEach((t) => t.stop());
                if (seq === this.openSeq && !this.app.signal.aborted) { this.state = 'off'; this.note = 'off'; this.sync(); }
                return;
            }
            this.stream = stream;
            stream.getTracks().forEach((t) => t.addEventListener('ended', () => { if (this.stream === stream) this.trackEnded(t); }, { once: true }));
            const vt = this.videoTrack();
            this.caps = vt && typeof vt.getCapabilities === 'function' ? vt.getCapabilities() : null;
            this.video.srcObject = stream;
            void this.video.play().catch(() => {});
            this.state = 'live';
            this.note = '';
            this.setStatus('Ready');
            this.sync();
            this.syncMeter();
            // the labels are there once the browser let the page in
            void this.enumerate();
        }

        /** Every track stopped (the camera light goes out), the meter and its AudioContext gone. */
        release(next) {
            this.stopMeter();
            if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
            this.stream = null;
            try { this.video.srcObject = null; } catch (_) { /* gone */ }
            if (next) {
                this.state = next === 'off' ? 'off' : 'starting';
                this.note = next;
                this.sync();
            }
        }

        fail(note) {
            this.release();
            this.state = 'error';
            this.note = note;
            this.sync();
        }

        /** A track ended by itself: the camera (or microphone) was unplugged or taken away. */
        trackEnded(track) {
            if (this.app.signal.aborted) return;
            if (track && track.kind === 'audio' && this.videoTrack() && this.videoTrack().readyState === 'live') {
                // the microphone went: the picture goes on without sound
                this.stopMeter();
                this.setStatus('The microphone was disconnected.');
                this.sync();
                return;
            }
            if (this.rec) void this.stopRecording();
            this.fail('unplugged');
            void this.enumerate();
        }

        // ---- the level meter and the time: drawn only while the window is seen ----

        syncMeter() {
            const at = this.audioTrack();
            const wantAudio = this.seen() && at && at.readyState === 'live';
            if (wantAudio && !this.ac) {
                const AC = root.AudioContext || root.webkitAudioContext;
                if (AC) {
                    try {
                        this.ac = new AC();
                        this.src = this.ac.createMediaStreamSource(new MediaStream([at]));
                        this.analyser = this.ac.createAnalyser();
                        this.analyser.fftSize = 1024;
                        this.src.connect(this.analyser);
                        this.samples = new Float32Array(this.analyser.fftSize);
                        if (this.ac.state === 'suspended') void this.ac.resume().catch(() => {});
                    } catch (_) { this.stopMeter(); }
                }
            } else if (!wantAudio && this.ac) {
                this.stopMeter();
            }
            const want = this.seen() && (!!this.ac || !!this.rec);
            if (!want) { if (this.timer) { clearInterval(this.timer); this.timer = null; } return; }
            if (this.timer) return;
            this.timer = setInterval(() => {
                if (doc.hidden || doc.documentElement.dataset.screenOff !== undefined || !this.seen()) { this.onSeen(); return; }
                this.tick();
            }, TICK_MS);
            this.tick();
        }

        stopMeter() {
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
            try { if (this.src) this.src.disconnect(); } catch (_) { /* gone */ }
            if (this.ac) void this.ac.close().catch(() => {});
            this.ac = null;
            this.src = null;
            this.analyser = null;
            this.drawLevel(-1);
        }

        tick() {
            if (this.analyser && this.samples) {
                this.analyser.getFloatTimeDomainData(this.samples);
                let peak = 0;
                for (let i = 0; i < this.samples.length; i += 1) { const v = Math.abs(this.samples[i]); if (v > peak) peak = v; }
                // dBFS over the meter's 48 dB, as Vista's peak meters read
                const db = peak > 0 ? 20 * Math.log10(peak) : -100;
                const n = Math.max(0, Math.min(METER_BARS, Math.round(((db + 48) / 48) * METER_BARS)));
                // the bars fall back one at a time (about 1.3 s from full), as a peak meter's do
                this.drawLevel(Math.max(n, this.lit - 1, 0));
            }
            if (this.rec) this.syncTime();
        }

        /** n lit bars (-1: the meter is off); only the bars that change are written. */
        drawLevel(n) {
            if (n === this.lit) return;
            const meter = this.q('.cam-meter');
            const off = n < 0;
            if (meter.classList.contains('is-off') !== off) meter.classList.toggle('is-off', off);
            const was = Math.max(0, this.lit);
            const now = Math.max(0, n);
            for (let i = Math.min(was, now); i < Math.max(was, now); i += 1) this.bars[i].classList.toggle('is-lit', i < now);
            meter.setAttribute('aria-valuenow', String(now));
            this.lit = n;
        }

        syncTime() {
            const r = this.rec;
            const ms = r ? r.elapsed + (r.paused ? 0 : performance.now() - r.t0) : 0;
            const text = clock(ms);
            const t = this.q('.cam-time');
            if (t.textContent !== text) t.textContent = text;
            const b = this.q('.cam-badge-time');
            if (b.textContent !== text) b.textContent = text;
        }

        // ---- capture ----

        async takePicture() {
            const v = this.video;
            if (this.state !== 'live' || !v.videoWidth || !v.videoHeight) return;
            const w = workspace();
            if (!w) { await this.message('There is no workspace to save the picture in. Open a workspace, and then try again.'); return; }
            const canvas = doc.createElement('canvas');
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
            const flash = this.q('.cam-flash');
            flash.classList.remove('is-on');
            void flash.offsetWidth;
            flash.classList.add('is-on');
            flash.addEventListener('animationend', () => flash.classList.remove('is-on'), { once: true });
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            // the frame's canvas is freed at once
            canvas.width = 0;
            canvas.height = 0;
            if (!blob) { await this.message('The picture could not be taken.'); return; }
            const name = `Picture ${stamp(new Date())}.png`;
            const seq = ++this.captureSeq;
            this.setStatus('Saving the picture...');
            try {
                const resp = await ws().uploadWorkspaceImage(await blobToBase64(blob), w, name, { currentIndex: 0, totalCount: 1 });
                if (!resp || resp.success === false || !resp.filename) throw new Error((resp && (resp.message || resp.error)) || 'The server did not keep the picture.');
                this.saved(seq, { kind: 'picture', name, filename: resp.filename }, blob, `${name} was saved to Pictures.`);
                if (typeof root.loadGallery === 'function') root.loadGallery(true);
            } catch (err) {
                this.setStatus('The picture was not saved.');
                await this.message(`The picture could not be saved.\n${(err && err.message) || err}`);
            }
        }

        startRecording() {
            if (this.rec || this.state !== 'live' || !this.stream) return;
            const type = recordingType();
            if (!type) { void this.message('This computer cannot record video.'); return; }
            let recorder;
            try {
                recorder = new MediaRecorder(this.stream, { mimeType: type.mime, videoBitsPerSecond: 4000000, audioBitsPerSecond: 128000 });
            } catch (err) {
                void this.message(`The recording could not be started.\n${(err && err.message) || err}`);
                return;
            }
            const rec = { seq: ++this.captureSeq, recorder, chunks: [], bytes: 0, type, t0: performance.now(), elapsed: 0, paused: false, started: new Date(), sound: !!this.audioTrack() };
            recorder.addEventListener('dataavailable', (e) => {
                if (!e.data || !e.data.size) return;
                rec.chunks.push(e.data);
                rec.bytes += e.data.size;
                if (rec.bytes >= MAX_RECORDING_BYTES && recorder.state !== 'inactive') {
                    rec.full = true;
                    void this.stopRecording();
                }
            });
            recorder.addEventListener('stop', () => void this.saveRecording(rec), { once: true });
            recorder.addEventListener('error', () => { if (recorder.state !== 'inactive') recorder.stop(); });
            this.rec = rec;
            // a chunk a second, so a stop by unplugging keeps what was recorded
            recorder.start(1000);
            this.setStatus(rec.sound ? 'Recording video with sound' : 'Recording video (no microphone)');
            this.sync();
            this.syncMeter();
        }

        togglePause() {
            const r = this.rec;
            if (!r || r.recorder.state === 'inactive') return;
            if (r.paused) {
                r.recorder.resume();
                r.paused = false;
                r.t0 = performance.now();
                this.setStatus('Recording video');
            } else {
                r.recorder.pause();
                r.elapsed += performance.now() - r.t0;
                r.paused = true;
                this.setStatus('Recording paused');
            }
            this.sync();
        }

        stopRecording() {
            const r = this.rec;
            if (!r || r.stopping) return;
            r.stopping = true;
            if (!r.paused) r.elapsed += performance.now() - r.t0;
            r.paused = true;
            try { if (r.recorder.state !== 'inactive') r.recorder.stop(); else void this.saveRecording(r); } catch (_) { void this.saveRecording(r); }
            this.setStatus('Saving the video...');
            this.sync();
        }

        async saveRecording(rec) {
            if (rec.saved) return;
            rec.saved = true;
            if (this.rec === rec) this.rec = null;
            this.sync();
            this.syncMeter();
            // the window was minimised or hidden while it recorded: the camera goes off now
            if (!this.seen() && this.stream) this.release('off');
            const mime = rec.type.mime.split(';')[0];
            const blob = new Blob(rec.chunks, { type: mime });
            rec.chunks = [];
            if (!blob.size) { this.setStatus('Nothing was recorded.'); return; }
            const name = `Video ${stamp(rec.started)}.${rec.type.ext}`;
            const w = workspace();
            try {
                if (!w) throw new Error('There is no workspace to save the video in.');
                const folder = await this.videosFolder(w);
                if (!folder) throw new Error('The Videos folder could not be made.');
                const resp = await vfs().uploadFile(folder, await blobToBase64(blob), name, mime);
                if (!resp || resp.success === false) throw new Error((resp && (resp.message || resp.error)) || 'The server did not keep the video.');
                const stored = (resp.file && resp.file.name) || name;
                this.saved(rec.seq, { kind: 'video', name: stored, path: `${folder}/${stored}` }, await this.posterOf(blob), `${stored} (${clock(rec.elapsed)}) was saved to Videos.`);
                if (rec.full) await this.message('The recording was stopped because the file reached its maximum size. The video was saved to Videos.');
            } catch (err) {
                this.setStatus('The video was not saved.');
                await this.message(`The video could not be saved.\n${(err && err.message) || err}`);
            }
        }

        /** /Workspaces/<ws>/Videos, made the first time (its name is not reserved, so it is a user folder). */
        async videosFolder(w) {
            const base = `/Workspaces/${w}`;
            const path = `${base}/Videos`;
            const has = async () => {
                const r = await vfs().listDirectory(base);
                const items = (r && (r.items || r.entries)) || [];
                return items.some((it) => it && it.name === 'Videos' && (it.kind === 'folder' || it.type === 'folder' || it.isFolder));
            };
            try {
                if (await has()) return path;
                await vfs().createFolder(base, 'Videos');
                return path;
            } catch (_) {
                // made meanwhile (another window): it is there now
                try { return (await has()) ? path : null; } catch (__) { return null; }
            }
        }

        /** The last capture's little picture: the frame itself, or a recording's first frame. */
        posterOf(blob) {
            return new Promise((resolve) => {
                const url = URL.createObjectURL(blob);
                const v = doc.createElement('video');
                v.muted = true;
                v.preload = 'auto';
                const done = (out) => { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(out); };
                const timer = setTimeout(() => done(null), 4000);
                v.addEventListener('loadeddata', () => {
                    clearTimeout(timer);
                    const c = doc.createElement('canvas');
                    const h = 48;
                    c.width = Math.max(1, Math.round((v.videoWidth / Math.max(1, v.videoHeight)) * h));
                    c.height = h;
                    try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (_) { done(null); return; }
                    c.toBlob((b) => { c.width = 0; c.height = 0; done(b); }, 'image/png');
                }, { once: true });
                v.addEventListener('error', () => { clearTimeout(timer); done(null); }, { once: true });
                v.src = url;
            });
        }

        /** A capture saved: it becomes the last capture unless a later one already did (a picture's upload can outlast a video's). */
        saved(seq, last, thumbBlob, text) {
            if (seq < this.shownSeq) return;
            this.shownSeq = seq;
            this.setLast(last, thumbBlob);
            if (!this.rec) this.setStatus(text);
        }

        setLast(last, thumbBlob) {
            if (this.last && this.last.thumb) URL.revokeObjectURL(this.last.thumb);
            last.thumb = thumbBlob ? URL.createObjectURL(thumbBlob) : null;
            this.last = last;
            const b = this.q('.cam-last');
            const img = b.querySelector('img');
            if (last.thumb) img.src = last.thumb; else img.src = last.kind === 'video' ? '/static_images/vista-cmdbar/film.png' : '/static_images/vista-cmdbar/picture.png';
            b.title = `Open ${last.name}`;
            b.classList.remove('hidden');
        }

        async openLast() {
            const l = this.last;
            if (!l) return;
            if (l.kind === 'picture') {
                const found = typeof root.findImageByFilename === 'function' ? root.findImageByFilename(l.filename) : null;
                if (typeof root.openGalleryImageInViewer === 'function') root.openGalleryImageInViewer(found || { filename: l.filename, original: l.filename });
                return;
            }
            const fl = root.featureLoader || (typeof featureLoader !== 'undefined' ? featureLoader : null); // eslint-disable-line no-undef
            if (fl && typeof fl.loadFeature === 'function') await fl.loadFeature('media_player');
            const base = vfs() && vfs().getBasePath();
            if (!base || typeof root.openDesktopMediaPlayerUrl !== 'function') { await this.message('The video could not be opened.'); return; }
            root.openDesktopMediaPlayerUrl(`${base}/fs/read?path=${encodeURIComponent(l.path)}`, l.name);
        }

        // ---- drawing ----

        sync() {
            const q = this.q;
            const live = this.state === 'live';
            const rec = this.rec;
            const set = (el, prop, v) => { if (el && el[prop] !== v) el[prop] = v; };
            // the surface's words
            const note = NOTES[this.note] || null;
            const noteEl = q('.cam-note');
            const showNote = !live && !!note;
            if (noteEl.classList.contains('hidden') === showNote) noteEl.classList.toggle('hidden', !showNote);
            if (note) {
                set(q('.cam-note-text'), 'textContent', note[0]);
                set(q('.cam-note-sub'), 'textContent', note[1]);
                const retry = q('[data-cam="retry"]');
                if (retry.classList.contains('hidden') === note[2]) retry.classList.toggle('hidden', !note[2]);
            }
            // the tools
            set(q('[data-cam="picture"]'), 'disabled', !live);
            set(q('[data-cam="record"]'), 'disabled', !live && !rec);
            const pause = q('[data-cam="pause"]');
            set(pause, 'disabled', !rec || !!rec.stopping);
            const recGlyph = q('[data-cam="record"] .cam-glyph');
            const g = rec ? 'stop' : 'record';
            if (recGlyph.dataset.glyph !== g) recGlyph.dataset.glyph = g;
            const recLabel = rec ? 'Stop <u>R</u>ecording' : 'Start <u>R</u>ecording';
            const rl = q('.cam-record-label');
            if (rl.dataset.html !== recLabel) { rl.innerHTML = recLabel; rl.dataset.html = recLabel; }
            set(q('[data-cam="record"]'), 'title', rec ? 'Stop Recording (Alt+R)' : 'Start Recording (Alt+R)');
            const paused = !!(rec && rec.paused && !rec.stopping);
            const pg = pause.querySelector('.cam-glyph');
            if (pg.dataset.glyph !== (paused ? 'resume' : 'pause')) pg.dataset.glyph = paused ? 'resume' : 'pause';
            set(q('.cam-pause-label'), 'textContent', paused ? 'Resume' : 'Pause');
            set(pause, 'title', paused ? 'Resume Recording' : 'Pause Recording');
            const badge = q('.cam-badge');
            if (badge.classList.contains('hidden') === !!rec) badge.classList.toggle('hidden', !rec);
            if (badge.classList.contains('is-paused') !== paused) badge.classList.toggle('is-paused', paused);
            if (!rec) set(q('.cam-time'), 'textContent', '0:00:00'); else this.syncTime();
            // the lists (fixed while recording)
            const pickText = {
                camera: (this.cams.find((d) => d.deviceId === this.currentCamId()) || this.cams[0] || { label: '(None)' }).label,
                mic: this.currentMicId() === 'none' ? '(None)' : (this.mics.find((d) => d.deviceId === this.currentMicId()) || this.mics[0] || { label: '(None)' }).label,
                size: (() => { const s = this.currentSize(); return s ? `${s[0]} x ${s[1]}` : 'Automatic'; })(),
                fps: this.currentRate() ? `${this.currentRate()} fps` : 'Auto'
            };
            Object.keys(pickText).forEach((k) => {
                const b = q(`[data-cam-pick="${k}"]`);
                set(b, 'textContent', pickText[k]);
                set(b, 'title', pickText[k]);
                set(b, 'disabled', !!rec || (k !== 'camera' && k !== 'mic' && !live));
            });
            // the status bar
            set(q('[data-cam-status="text"]'), 'textContent', this.status);
            let dev = '';
            if (live) {
                const s = this.currentSize();
                dev = `${pickText.camera}${s ? `, ${s[0]} x ${s[1]}` : ''}${this.currentRate() ? `, ${this.currentRate()} fps` : ''}${this.audioTrack() ? '' : ', no sound'}`;
            } else if (this.state === 'off') dev = 'Camera off';
            set(q('[data-cam-status="device"]'), 'textContent', dev);
        }

        syncMirror() {
            const stage = this.q('.cam-stage');
            const on = !!this.prefs.mirror;
            if (stage.classList.contains('is-mirror') !== on) stage.classList.toggle('is-mirror', on);
        }

        setStatus(text) {
            this.status = text;
            const el = this.q('[data-cam-status="text"]');
            if (el && el.textContent !== text) el.textContent = text;
        }

        message(text) {
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: NAME, width: 400, owner: this.modal });
        }

        help() {
            void this.message('Choose the camera and the microphone at the top of the window. Take Picture (Space) saves a picture to Pictures; Start Recording records video with sound into the Videos folder of your workspace, and Stop Recording saves it. Click the picture at the lower right to open the last capture.\nThe camera is off while the window is minimized.');
        }

        /** Vista asks before a recording is thrown away; here the recording is saved first. */
        async close() {
            if (this.rec) {
                const v = await call('showConfirmationDialog', '<p>A video is being recorded. Do you want to stop recording and save the video?</p>', [
                    { text: 'Yes', value: 'yes', className: 'btn-standard primary' }, { text: 'No', value: 'no', className: 'btn-standard' }, { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
                ], null, { title: NAME, width: 400, owner: this.modal });
                if (v === 'cancel' || v === null || v === undefined || v === false) return;
                const r = this.rec;
                if (r && v === 'yes') {
                    const saved = new Promise((resolve) => r.recorder.addEventListener('stop', () => setTimeout(resolve, 0), { once: true }));
                    this.stopRecording();
                    await saved;
                    // the upload goes on: wait for it before the window goes
                    for (let i = 0; i < 600 && !r.saved; i += 1) await new Promise((res) => setTimeout(res, 50)); // eslint-disable-line no-await-in-loop
                } else if (r) {
                    r.saved = true;
                    try { r.recorder.stop(); } catch (_) { /* stopped */ }
                    this.rec = null;
                }
            }
            this.app.exit();
        }

        destroy() {
            this.openSeq += 1;
            if (this.rec) { this.rec.saved = true; try { this.rec.recorder.stop(); } catch (_) { /* stopped */ } this.rec = null; }
            this.release();
            if (this.last && this.last.thumb) URL.revokeObjectURL(this.last.thumb);
            this.last = null;
            if (root.programFaults && typeof root.programFaults.unregisterProgram === 'function') root.programFaults.unregisterProgram(this.modal.id);
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    /** The program's colours: the Vista theme's token block (css/themes/vista/camera.css, ui-standard section 6). */
    function themeStyles() {
        if (doc.querySelector('link[data-cam-theme]')) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/css/themes/vista/camera.css';
        link.dataset.camTheme = '1';
        doc.head.appendChild(link);
    }

    let running = null;

    function start(app) {
        if (running) {
            const m = running.modal;
            if (m.classList.contains('minimised') && typeof root.restoreMinimizedModal === 'function') root.restoreMinimizedModal(m);
            call('bringModalToFront', m);
            app.exit();
            return;
        }
        const c = new Camera(app);
        running = c;
        app.onExit(() => { if (running === c) running = null; c.destroy(); });
    }

    root.melatonCamera = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('camera', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
