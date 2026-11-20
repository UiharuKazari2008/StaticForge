/**
 * XM Radio (Yozora #989): a SiriusXM radio for the Melaton desktop that looks like one (Yukimi, Nov 20 2026: "a
 * Skeuomorphic XM Radio player app, designed to look like a radio with a selectable display design (LCD, Dot Matrix,
 * TFT)"). Three bodies, all ours: a portable receiver on its dock, a double-DIN car head unit and a tabletop radio;
 * three displays: a backlit LCD, a vacuum-fluorescent dot matrix and a colour TFT. Chosen apart (Radio > Body / Display),
 * remembered on this computer.
 *
 * The account and the stream are the server's (modules/xmRadio.js, packets xmradio_*): the radio asks for a channel
 * and plays our copy of its HLS playlist with hls.js (public/dist/hlsjs); the token never comes here. What is on every
 * channel is pushed (status feed `xmradio`) while the radio is on.
 *
 *   Power       on / off (off: the display shows the clock, nothing plays or is subscribed)
 *   TUNE knob   channel up / down (wheel, drag, or the knob's halves); keys Up / Down
 *   Presets     1-6 in bands A, B and C (BAND); a press tunes, a long press stores (shared with the phone)
 *   DIRECT      type a channel number (or just type digits), Enter tunes
 *   Replay      pause / play, back 15 s, forward 15 s and LIVE within the channel's buffer (keys Space, Left, Right, End)
 *   VOLUME knob the radio's own volume
 *   DISP        what the display's second and third lines show (artist / title, channel / genre, show)
 *   MENU        (and the right button) Sign In / Out, Body, Display, Direct Tune, About
 *
 * Power (phone-power-client): nothing runs while the radio is off; while it plays and is seen, the clock is drawn once a
 * minute and long lines scroll; minimised or covered, only the sound goes on.
 *
 *   melatonApps.define('xmradio', start)
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const A = '/melaton-apps/xmradio/assets';
    const NAME = 'XM Radio';
    const PREFS_KEY = 'xmradio.prefs';
    const BODIES = [['dock', 'Receiver and Dock'], ['car', 'Car Radio'], ['table', 'Tabletop Radio']];
    // each body wears one of the service's names of its era (Yukimi, Nov 20 2026): the portable receiver XM Radio, the
    // car radio Sirius, the tabletop SiriusXM. Our own wordmarks in the brands' manner, not their artwork.
    const BRAND = {
        dock: '<span class="xr-wm-xm"><b>XM</b><i>Radio</i></span>',
        car: '<span class="xr-wm-sirius"><b>SIRIUS</b><i class="xr-wm-star" aria-hidden="true"></i></span>',
        table: '<span class="xr-wm-sxm"><b>Sirius</b><i>XM</i></span>'
    };
    const BRAND_NAME = { dock: 'XM Radio', car: 'Sirius', table: 'SiriusXM' };
    // the radio's own width per body (the window scales it: resizable, Yukimi Nov 20 2026)
    const NATURAL_W = { dock: 440, car: 660, table: 620 };
    const DISPLAYS = [['lcd', 'LCD'], ['dot', 'Dot Matrix'], ['tft', 'TFT']];
    const BANDS = ['A', 'B', 'C'];
    const INFO_MODES = ['song', 'channel', 'show'];
    const HLS_SRC = '/dist/hlsjs/hls.light.min.js';
    const LONG_PRESS_MS = 900;
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = (n, w) => String(n).padStart(w, '0');

    function readPrefs() {
        let p = {};
        try { p = JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { p = {}; }
        return {
            body: BODIES.some((b) => b[0] === p.body) ? p.body : 'dock',
            display: DISPLAYS.some((d) => d[0] === p.display) ? p.display : 'lcd',
            volume: Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : 0.7,
            band: BANDS.includes(p.band) ? p.band : 'A',
            info: INFO_MODES.includes(p.info) ? p.info : 'song',
            channel: typeof p.channel === 'string' ? p.channel : ''
        };
    }

    let hlsLoading = null;
    function loadHls() {
        if (root.Hls) return Promise.resolve(root.Hls);
        if (hlsLoading) return hlsLoading;
        hlsLoading = new Promise((resolve, reject) => {
            const s = doc.createElement('script');
            s.src = HLS_SRC;
            s.onload = () => (root.Hls ? resolve(root.Hls) : reject(new Error('hls.js did not load')));
            s.onerror = () => { hlsLoading = null; reject(new Error('hls.js did not load')); };
            doc.head.appendChild(s);
        });
        return hlsLoading;
    }

    class Radio {
        constructor(app) {
            this.app = app;
            this.sig = { signal: app.signal };
            this.prefs = readPrefs();
            this.on = false;
            this.account = null;
            this.lineup = []; // [{ id, number, name, genre, logo }] by number
            this.byId = new Map();
            this.now = new Map(); // channelId -> { a, t, s, ad }
            this.presets = { A: [], B: [], C: [] };
            this.channel = null;
            this.state = 'off'; // off | signin | acquiring | playing | paused | nosignal
            this.direct = '';
            this.flash = null; // a message on the display for a moment { text, until }
            this.hubOn = false;
            this.hls = null;
            this.tuneSeq = 0;
            this.build();
        }

        // ---------------------------------------------------------------- the radio

        build() {
            const w = root.desktopAppCreateWindow({
                id: 'xmRadioModal', identifier: 'xmRadio', title: NAME,
                icon16: `${A}/xmradio-16.png`, taskbarIcon: `${A}/xmradio-32.png`,
                className: 'xr-window resizeable-window', minimize: true
            });
            const m = w.modal;
            m.dataset.windowKind = 'custom';
            // the radio is the window (Yukimi, Nov 20 2026): no Melaton frame; Vista's minimise and close sit in the
            // radio's top-right corner, and the invisible caption over its top edge still moves it
            m.dataset.xrFrame = 'radio';
            // minimise and close only (Yukimi, Nov 20 2026): no work-area maximise box on this resizable window
            m.dataset.windowNoMaximize = 'true';
            this.modal = m;
            w.content.classList.add('xr-client');
            w.content.innerHTML = `
                <div class="xr-radio" tabindex="0" aria-label="${NAME}">
                    <div class="xr-shell">
                        <div class="xr-grille" aria-hidden="true"></div>
                        <div class="xr-brand" data-f="brand"></div>
                        <button type="button" class="xr-knob xr-vol" data-k="vol" title="Volume" aria-label="Volume"><i class="xr-knob-cap"></i><i class="xr-knob-mark"></i></button>
                        <div class="xr-bezel"><div class="xr-display" aria-live="polite">
                            <div class="xr-d-top"><span data-f="band"></span><span data-f="pre"></span><span class="xr-d-fill"></span><span data-f="replay"></span><span class="xr-sig" data-f="sig"><i></i><i></i><i></i></span><span data-f="clock"></span></div>
                            <div class="xr-d-main">
                                <canvas class="xr-d-art" data-f="art" width="64" height="64" aria-hidden="true"></canvas>
                                <div class="xr-d-text">
                                    <div class="xr-d-l1"><canvas class="xr-d-logo" data-f="logo" width="40" height="32" aria-hidden="true"></canvas><span class="xr-d-num" data-f="num"></span><span class="xr-d-name" data-f="name"></span></div>
                                    <div class="xr-d-l2"><span class="xr-run" data-f="l2"></span></div>
                                    <div class="xr-d-l3"><span class="xr-run" data-f="l3"></span></div>
                                </div>
                            </div>
                        </div></div>
                        <button type="button" class="xr-knob xr-tune" data-k="tune" title="Tune (channel up / down)" aria-label="Tune"><i class="xr-knob-cap"></i><i class="xr-knob-mark"></i></button>
                        <div class="xr-presets">${[1, 2, 3, 4, 5, 6].map((n) => `<button type="button" class="xr-key xr-pre" data-pre="${n}" title="Preset ${n} (hold to store)"><img class="xr-pre-logo" alt="" draggable="false" hidden><span class="xr-pre-n">${n}</span></button>`).join('')}</div>
                        <div class="xr-fn">
                            <button type="button" class="xr-key xr-power" data-b="power" title="Power">&#x23FB;</button>
                            <button type="button" class="xr-key" data-b="band" title="Preset band">BAND</button>
                            <button type="button" class="xr-key" data-b="disp" title="Display information">DISP</button>
                            <button type="button" class="xr-key" data-b="guide" title="Channel guide">GUIDE</button>
                            <button type="button" class="xr-key" data-b="direct" title="Direct tune">DIRECT</button>
                            <button type="button" class="xr-key" data-b="menu" title="Menu">MENU</button>
                        </div>
                        <div class="xr-replay">
                            <button type="button" class="xr-key" data-b="back" title="Back 15 seconds">&#x25C0;&#xFE0E;&#x25C0;&#xFE0E;</button>
                            <button type="button" class="xr-key" data-b="play" title="Pause / Play">&#x25B6;&#xFE0E;&#x275A;&#x275A;</button>
                            <button type="button" class="xr-key" data-b="fwd" title="Forward 15 seconds">&#x25B6;&#xFE0E;&#x25B6;&#xFE0E;</button>
                            <button type="button" class="xr-key" data-b="live" title="Back to live">LIVE</button>
                        </div>
                        <div class="xr-dock" aria-hidden="true"><i class="xr-dock-led"></i></div>
                    </div>
                    <audio class="xr-audio" preload="none"></audio>
                </div>`;
            this.root = m.querySelector('.xr-radio');
            this.audio = m.querySelector('.xr-audio');
            this.f = {};
            m.querySelectorAll('[data-f]').forEach((el) => { this.f[el.dataset.f] = el; });
            this.applyLook();
            this.wire(w);
            this.paint();
            this.paintPresets();
            call('openModal', m);
            m.classList.remove('hidden');
            this.place();
            void this.load();
        }

        place() {
            const m = this.modal;
            requestAnimationFrame(() => {
                if (m.hasAttribute('data-window-position-restored')) return;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            });
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: NAME, terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'xmradio' }) });
            }
        }

        applyLook() {
            this.root.dataset.body = this.prefs.body;
            this.root.dataset.display = this.prefs.display;
            this.modal.dataset.xrBody = this.prefs.body;
            this.f.brand.innerHTML = BRAND[this.prefs.body];
            this.f.brand.title = BRAND_NAME[this.prefs.body];
            const nat = NATURAL_W[this.prefs.body];
            this.modal.dataset.windowMinWidth = String(Math.round(nat * 0.6));
            this.modal.dataset.windowMaxWidth = String(Math.round(nat * 2));
            this.fit();
            // the art redraws in the new display's manner
            this.artKey = null;
            this.logoKey = null;
            this.audio.volume = this.prefs.volume;
            this.setKnob('vol', this.prefs.volume * 270 - 135);
        }

        /** The radio scales with the window's width (its height follows); a body change sets the width it wants. */
        fit(fromResize) {
            const nat = NATURAL_W[this.prefs.body];
            const m = this.modal;
            if (!fromResize) {
                const z0 = Number(this.prefs.zoom) || 1;
                m.style.width = `${Math.round(nat * z0)}px`;
            }
            const w = m.clientWidth || nat;
            const z = Math.max(0.6, Math.min(2, w / nat));
            if (Math.abs(z - (this.zoom || 0)) < 0.002) return;
            this.zoom = z;
            this.root.style.zoom = String(Math.round(z * 1000) / 1000);
            if (fromResize) { this.prefs.zoom = z; this.savePrefsSoon(); }
        }

        savePrefsSoon() {
            clearTimeout(this.prefsTimer);
            this.prefsTimer = setTimeout(() => this.savePrefs(), 600);
        }

        savePrefs() {
            try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch (_) { /* private mode */ }
        }

        /** The window is on screen and not covered by a minimise (long lines scroll, the clock is drawn). */
        seen() {
            return !doc.hidden && !this.modal.classList.contains('minimised') && !this.modal.classList.contains('hidden');
        }

        wire(w) {
            const sig = this.sig;
            w.close.addEventListener('click', () => this.app.exit(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === this.modal.id && e.detail.type === 'closed') this.app.exit();
                else if (e && e.detail && e.detail.id === this.modal.id) this.syncSeen();
            }, sig);
            doc.addEventListener('visibilitychange', () => this.syncSeen(), sig);
            this.root.addEventListener('click', (e) => {
                const b = e.target.closest('[data-b]');
                if (b) { this.button(b.dataset.b, b); return; }
                const k = e.target.closest('[data-k]');
                if (k && !this.dragged) this.knobClick(k.dataset.k, e, k);
            }, sig);
            // presets: a press tunes, a long press stores
            this.root.addEventListener('pointerdown', (e) => {
                const p = e.target.closest('[data-pre]');
                if (p && e.button === 0) this.presetDown(Number(p.dataset.pre), p);
                const k = e.target.closest('[data-k]');
                if (k && e.button === 0) this.knobDrag(k.dataset.k, e, k);
            }, sig);
            this.root.addEventListener('wheel', (e) => {
                const k = e.target.closest('[data-k]');
                if (!k) return;
                e.preventDefault();
                this.knobStep(k.dataset.k, e.deltaY < 0 ? 1 : -1);
            }, Object.assign({ passive: false }, sig));
            this.root.addEventListener('keydown', (e) => this.key(e), sig);
            // the window's resize grip scales the radio (no polling: the browser says when the size changed)
            if (typeof root.ResizeObserver === 'function') {
                const ro = new root.ResizeObserver(() => this.fit(true));
                ro.observe(this.modal);
                this.app.signal.addEventListener('abort', () => ro.disconnect());
            }
            // in the guide, the display picks the channel shown
            this.root.querySelector('.xr-display').addEventListener('click', () => { if (this.guide) this.guidePick(); }, sig);
            this.root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(e.clientX, e.clientY); }, sig);
            const a = this.audio;
            for (const t of ['playing', 'pause', 'waiting', 'error', 'timeupdate']) a.addEventListener(t, () => this.onAudio(t), sig);
            const c = root.wsClient;
            if (c && typeof c.on === 'function') {
                c.on('xmradio_status', (msg) => this.applyHub((msg && (msg.changed || (msg.data && msg.data.changed))) || {}), sig);
                c.on('connected', () => { this.hubOn = false; void this.syncHub(); }, sig);
            }
            this.app.signal.addEventListener('abort', () => this.stop(true));
            this.mediaKeys();
        }

        // ---------------------------------------------------------------- data

        async ask(type, data) {
            const c = root.wsClient;
            if (!c || typeof c.sendMessage !== 'function') throw new Error('Not connected to Dreamscape.');
            const run = () => c.sendMessage(type, data || {}, false);
            return typeof c.handlesErrors === 'function' ? c.handlesErrors(run) : run();
        }

        async load() {
            try {
                const r = await this.ask('xmradio_get', {});
                this.account = r && r.account;
            } catch (_) { this.account = null; }
            await this.loadLineup();
            this.paint();
        }

        async loadLineup() {
            if (!this.account || !this.account.signedIn) return;
            try {
                const r = await this.ask('xmradio_lineup', {});
                this.lineup = (r && r.channels) || [];
                this.byId = new Map(this.lineup.map((c) => [c.id, c]));
                if (r && r.presets) this.presets = Object.assign({ A: [], B: [], C: [] }, r.presets);
                void this.wantLogos([...this.presets.A, ...this.presets.B, ...this.presets.C, this.prefs.channel]);
            } catch (err) {
                this.say(err && err.message ? 'NO LINEUP' : 'NO LINEUP');
            }
        }

        /** Channel logos the server has not given yet (the presets, the channel, the guide's channel): asked once. */
        async wantLogos(ids) {
            this.logoAsked = this.logoAsked || new Set();
            const want = [...new Set(ids.filter((id) => id && this.byId.has(id) && !this.byId.get(id).logo && !this.logoAsked.has(id)))];
            if (!want.length) { this.paintPresets(); return; }
            want.forEach((id) => this.logoAsked.add(id));
            try {
                const r = await this.ask('xmradio_logos', { ids: want });
                for (const [id, url] of Object.entries((r && r.logos) || {})) { const c = this.byId.get(id); if (c) c.logo = url; }
            } catch (_) { /* the number alone */ }
            this.paintPresets();
            this.paint();
        }

        async syncHub() {
            // on, or waiting for a sign-in in Alchemy (the account item says when it is done)
            const want = this.on || !!this.browserWait;
            const c = root.wsClient;
            if (want === this.hubOn || !c) return;
            this.hubOn = want;
            try {
                const r = await c.sendMessage(want ? 'status_subscribe' : 'status_unsubscribe', { feed: 'xmradio' }, false);
                const items = r && (r.items || (r.data && r.data.items));
                if (want && items) this.applyHub(items);
            } catch (_) { if (want) this.hubOn = false; }
        }

        applyHub(items) {
            let mine = false;
            for (const [k, v] of Object.entries(items || {})) {
                if (k === 'account') {
                    const was = this.account && this.account.signedIn;
                    this.account = v;
                    if (this.browserWait && v && (v.signedIn || !v.browserSignIn)) {
                        this.browserWait = false;
                        this.say(v.signedIn ? 'SIGNED IN' : 'NOT SIGNED IN');
                        void this.syncHub();
                        if (v.signedIn && this.on) { const ch = this.byId.get(this.prefs.channel) || this.lineup[0]; void this.loadLineup().then(() => { const c = this.byId.get(this.prefs.channel) || this.lineup[0] || ch; if (c) void this.tune(c); }); }
                    }
                    if (!was && v && v.signedIn) void this.loadLineup().then(() => this.paint());
                    if (was && !(v && v.signedIn)) this.stop();
                    mine = true;
                } else if (k === 'lineup') {
                    // the server finished reading the lineup (the first read takes a few minutes)
                    if (v && v.at && v.at !== this.lineupAt && this.signedIn()) { this.lineupAt = v.at; void this.loadLineup().then(() => this.paint()); }
                } else if (k.startsWith('ch:')) {
                    const id = k.slice(3);
                    this.now.set(id, v);
                    if (this.channel && this.channel.id === id) mine = true;
                }
            }
            if (mine) this.paint();
        }

        // ---------------------------------------------------------------- tuning and sound

        signedIn() { return !!(this.account && this.account.signedIn); }

        power() {
            if (this.on) { this.stop(); this.on = false; this.state = 'off'; void this.syncHub(); this.paint(); return; }
            this.on = true;
            void this.syncHub();
            if (!this.signedIn()) { this.state = 'signin'; this.paint(); return; }
            const last = this.byId.get(this.prefs.channel) || this.lineup.find((c) => c.sub !== false);
            if (last) void this.tune(last); else { this.state = 'nosignal'; this.paint(); }
        }

        async tune(ch) {
            if (!ch) return;
            if (!this.on) { this.on = true; void this.syncHub(); }
            this.channel = ch;
            this.prefs.channel = ch.id;
            this.savePrefs();
            this.state = 'acquiring';
            this.paint();
            const seq = ++this.tuneSeq;
            let r;
            try {
                r = await this.ask('xmradio_tune', { channelId: ch.id });
            } catch (err) {
                if (seq !== this.tuneSeq) return;
                const code = err && err.code;
                if (code === 'XMRADIO_NOT_SUBSCRIBED') ch.sub = false;
                this.state = code === 'XMRADIO_SIGNED_OUT' ? 'signin' : code === 'XMRADIO_NOT_SUBSCRIBED' ? 'nosub' : 'nosignal';
                this.paint();
                return;
            }
            if (seq !== this.tuneSeq || !this.on) return;
            if (r.channel && r.channel.logo) ch.logo = r.channel.logo;
            await this.play(r.url, seq);
        }

        async play(url, seq) {
            const a = this.audio;
            this.dropHls();
            let Hls;
            try { Hls = await loadHls(); } catch (_) { Hls = null; }
            if (seq !== this.tuneSeq) return;
            if (Hls && Hls.isSupported()) {
                const hls = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 3600, enableWorker: true });
                this.hls = hls;
                hls.on(Hls.Events.ERROR, (ev, d) => {
                    if (!d || !d.fatal || this.hls !== hls) return;
                    if (d.type === Hls.ErrorTypes.NETWORK_ERROR && (this.retries = (this.retries || 0) + 1) <= 3) { hls.startLoad(); return; }
                    this.state = 'nosignal';
                    this.paint();
                });
                hls.loadSource(url);
                hls.attachMedia(a);
            } else if (a.canPlayType('application/vnd.apple.mpegurl')) {
                a.src = url;
            } else {
                this.state = 'nosignal';
                this.paint();
                return;
            }
            this.retries = 0;
            try { await a.play(); } catch (_) { /* the user's press started it; a refusal shows as paused */ }
        }

        dropHls() {
            if (this.hls) { try { this.hls.destroy(); } catch (_) { /* gone */ } this.hls = null; }
            const a = this.audio;
            a.pause();
            a.removeAttribute('src');
            try { a.load(); } catch (_) { /* nothing loaded */ }
        }

        stop(final) {
            this.tuneSeq++;
            this.dropHls();
            if (!final) this.paint();
        }

        onAudio(t) {
            if (!this.on) return;
            if (t === 'playing') this.state = 'playing';
            else if (t === 'pause' && this.state === 'playing') this.state = 'paused';
            else if (t === 'waiting' && this.state !== 'paused') this.state = 'acquiring';
            else if (t === 'error') this.state = 'nosignal';
            else if (t === 'timeupdate') { this.paintReplay(); return; }
            this.paint();
        }

        /** How far behind live (seconds), 0 at the live edge. */
        behind() {
            const h = this.hls;
            const a = this.audio;
            const live = h && Number.isFinite(h.liveSyncPosition) ? h.liveSyncPosition : (a.seekable.length ? a.seekable.end(a.seekable.length - 1) : 0);
            return Math.max(0, live - a.currentTime);
        }

        seekBy(sec) {
            const a = this.audio;
            if (!a.seekable.length) return;
            const lo = a.seekable.start(0);
            const hi = this.hls && Number.isFinite(this.hls.liveSyncPosition) ? this.hls.liveSyncPosition : a.seekable.end(a.seekable.length - 1);
            a.currentTime = Math.max(lo, Math.min(hi, a.currentTime + sec));
            this.paintReplay();
        }

        goLive() {
            const a = this.audio;
            const live = this.hls && Number.isFinite(this.hls.liveSyncPosition) ? this.hls.liveSyncPosition : (a.seekable.length ? a.seekable.end(a.seekable.length - 1) : null);
            if (live != null) a.currentTime = live;
            if (a.paused) void a.play().catch(() => {});
            this.paintReplay();
        }

        step(dir) {
            if (!this.lineup.length) return;
            // channels outside the plan are passed by, as a receiver skips unsubscribed channels
            const list = this.lineup.filter((c) => c.sub !== false || (this.channel && c.id === this.channel.id));
            const i = this.channel ? list.findIndex((c) => c.id === this.channel.id) : -1;
            const n = list.length;
            if (!n) return;
            const next = list[((i < 0 ? 0 : i + dir) % n + n) % n];
            void this.tune(next);
        }

        // ---------------------------------------------------------------- controls

        button(b) {
            if (b === 'power') { this.power(); return; }
            if (b === 'menu') { const r = this.root.querySelector('[data-b="menu"]').getBoundingClientRect(); this.menu(r.left, r.bottom); return; }
            if (!this.on) return;
            if (b === 'band') {
                this.prefs.band = BANDS[(BANDS.indexOf(this.prefs.band) + 1) % BANDS.length];
                this.savePrefs();
                this.paintPresets();
                this.say(`PRESETS ${this.prefs.band}`);
            } else if (b === 'disp') {
                this.prefs.info = INFO_MODES[(INFO_MODES.indexOf(this.prefs.info) + 1) % INFO_MODES.length];
                this.savePrefs();
                this.paint();
            } else if (b === 'guide') {
                if (this.guide) this.guide = null;
                else this.guideOpen();
                this.paint();
            } else if (b === 'direct') {
                this.direct = '';
                this.directMode = true;
                this.paint();
                this.root.focus();
            } else if (b === 'play') {
                if (this.audio.paused) void this.audio.play().catch(() => {}); else this.audio.pause();
            } else if (b === 'back') this.seekBy(-15);
            else if (b === 'fwd') this.seekBy(15);
            else if (b === 'live') this.goLive();
        }

        // ---------------------------------------------------------------- the channel guide (EPG)

        /** The guide: every channel in the plan with what is on it now; TUNE browses, the display or Enter picks. */
        guideList() { return this.lineup.filter((c) => c.sub !== false); }

        guideOpen() {
            const list = this.guideList();
            if (!list.length) { this.say('NO LINEUP'); return; }
            const i = this.channel ? Math.max(0, list.findIndex((c) => c.id === this.channel.id)) : 0;
            this.guide = { i };
            this.directMode = false;
            void this.wantLogos([list[i].id]);
        }

        guideMove(dir) {
            const list = this.guideList();
            if (!this.guide || !list.length) return;
            this.guide.i = ((this.guide.i + dir) % list.length + list.length) % list.length;
            void this.wantLogos([list[this.guide.i].id]);
            this.paint();
        }

        guidePick() {
            const list = this.guideList();
            const ch = this.guide && list[this.guide.i];
            this.guide = null;
            if (ch) void this.tune(ch); else this.paint();
        }

        presetDown(n, el) {
            let stored = false;
            const t = setTimeout(() => {
                stored = true;
                if (!this.on || !this.channel) return;
                const list = (this.presets[this.prefs.band] || []).slice();
                list[n - 1] = this.channel.id;
                this.presets[this.prefs.band] = list;
                el.classList.add('is-stored');
                setTimeout(() => el.classList.remove('is-stored'), 400);
                this.say(`${this.prefs.band}${n} STORED`);
                this.paintPresets();
                void this.ask('xmradio_presets_set', { presets: this.presets }).catch(() => {});
            }, LONG_PRESS_MS);
            // one press: its listeners go when it ends (or the program does)
            const press = new AbortController();
            const sig = { signal: AbortSignal.any ? AbortSignal.any([press.signal, this.app.signal]) : press.signal };
            const up = () => {
                clearTimeout(t);
                press.abort();
                if (stored) return;
                if (!this.on) { this.power(); if (!this.on) return; }
                const id = (this.presets[this.prefs.band] || [])[n - 1];
                const ch = id && this.byId.get(id);
                if (ch) void this.tune(ch); else this.say(`${this.prefs.band}${n} EMPTY`);
            };
            el.addEventListener('pointerup', up, sig);
            el.addEventListener('pointerleave', up, sig);
        }

        setKnob(k, deg) {
            const el = this.root.querySelector(`[data-k="${k}"] .xr-knob-mark`);
            if (el) el.parentElement.style.setProperty('--xr-turn', `${Math.round(deg)}deg`);
        }

        knobStep(k, dir) {
            if (k === 'vol') {
                this.prefs.volume = Math.max(0, Math.min(1, Math.round((this.prefs.volume + dir * 0.05) * 100) / 100));
                this.audio.volume = this.prefs.volume;
                this.setKnob('vol', this.prefs.volume * 270 - 135);
                this.savePrefs();
                if (this.on) this.say(`VOLUME ${Math.round(this.prefs.volume * 100)}`);
                return;
            }
            this.tuneTurn = (this.tuneTurn || 0) + dir * 15;
            this.setKnob('tune', this.tuneTurn);
            if (this.on && this.guide) this.guideMove(dir);
            else if (this.on) this.step(dir);
        }

        knobClick(k, e, el) {
            const r = el.getBoundingClientRect();
            this.knobStep(k, e.clientX >= r.left + r.width / 2 ? 1 : -1);
        }

        knobDrag(k, e, el) {
            const y0 = e.clientY;
            let acc = 0;
            this.dragged = false;
            el.setPointerCapture(e.pointerId);
            const move = (ev) => {
                const d = y0 - ev.clientY - acc;
                if (Math.abs(d) < 14) return;
                const dir = d > 0 ? 1 : -1;
                acc += dir * 14;
                this.dragged = true;
                this.knobStep(k, dir);
            };
            const drag = new AbortController();
            const sig = { signal: AbortSignal.any ? AbortSignal.any([drag.signal, this.app.signal]) : drag.signal };
            const done = () => {
                drag.abort();
                setTimeout(() => { this.dragged = false; }, 0);
            };
            el.addEventListener('pointermove', move, sig);
            el.addEventListener('pointerup', done, sig);
            el.addEventListener('pointercancel', done, sig);
        }

        key(e) {
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            const k = e.key;
            if (/^[0-9]$/.test(k) && this.on) {
                this.directMode = true;
                this.direct = (this.direct + k).slice(-3);
                this.paint();
            } else if (this.guide && (k === 'Enter' || k === 'Escape')) {
                if (k === 'Enter') this.guidePick(); else { this.guide = null; this.paint(); }
            } else if (k === 'Enter' && this.directMode) {
                const n = Number(this.direct);
                const ch = this.lineup.find((c) => c.number === n);
                this.directMode = false;
                this.direct = '';
                if (ch) void this.tune(ch); else this.say('INVALID CHANNEL');
            } else if (k === 'Escape' && this.directMode) {
                this.directMode = false; this.direct = ''; this.paint();
            } else if (k === 'Backspace' && this.directMode) {
                this.direct = this.direct.slice(0, -1); this.paint();
            } else if (k === 'ArrowUp') this.knobStep('tune', 1);
            else if (k === 'ArrowDown') this.knobStep('tune', -1);
            else if (k === 'ArrowLeft' && this.on) this.seekBy(-15);
            else if (k === 'ArrowRight' && this.on) this.seekBy(15);
            else if (k === 'End' && this.on) this.goLive();
            else if (k === ' ' && this.on) this.button('play');
            else return;
            e.preventDefault();
        }

        mediaKeys() {
            const ms = root.navigator && root.navigator.mediaSession;
            if (!ms || typeof ms.setActionHandler !== 'function') return;
            const h = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (_) { /* not supported */ } };
            h('play', () => { if (this.on) void this.audio.play().catch(() => {}); });
            h('pause', () => this.audio.pause());
            h('nexttrack', () => this.step(1));
            h('previoustrack', () => this.step(-1));
            h('seekbackward', () => this.seekBy(-15));
            h('seekforward', () => this.seekBy(15));
            this.app.signal.addEventListener('abort', () => { for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward']) h(a, null); });
        }

        menu(x, y) {
            const cm = root.contextMenu;
            if (!cm) return;
            const acts = {};
            const item = (text, fn, extra) => { const id = `xr-${Object.keys(acts).length}`; acts[id] = fn; return Object.assign({ text, action: id }, extra || {}); };
            const signed = this.signedIn();
            const items = [
                ...(signed
                    ? [item(`Sign Out${this.account.handle ? ` (${this.account.handle})` : ''}`, () => void this.signOut())]
                    : [
                        ...(this.account && this.account.card ? [item('Sign In', () => void this.signInCard(), { className: 'context-menu-item-default' })] : []),
                        item('Sign In in Alchemy...', () => void this.signInBrowser(), this.account && this.account.card ? null : { className: 'context-menu-item-default' }),
                        item('Sign In Here...', () => void this.signIn())
                    ]),
                { separator: true },
                { text: 'Body', submenu: BODIES.map(([id, label]) => item(label, () => { this.prefs.body = id; this.savePrefs(); this.applyLook(); }, { showIndicator: true, indicatorMark: 'radio', checked: this.prefs.body === id })) },
                { text: 'Display', submenu: DISPLAYS.map(([id, label]) => item(label, () => { this.prefs.display = id; this.savePrefs(); this.applyLook(); this.paint(); }, { showIndicator: true, indicatorMark: 'radio', checked: this.prefs.display === id })) },
                item('Channel Guide', () => this.button('guide'), { disabled: !this.on || !this.lineup.length }),
                item('Direct Tune', () => this.button('direct'), { disabled: !this.on || !this.lineup.length }),
                item('Refresh Lineup', () => void this.refreshLineup(), { disabled: !signed }),
                { separator: true },
                item(`About ${NAME}`, () => this.about())
            ];
            const anchor = this.root;
            cm.attachToElement(anchor, { sections: [{ type: 'list', items }], onAction: (a) => { const fn = acts[a]; if (fn) fn(); } });
            cm.showMenu({ clientX: Math.round(x), clientY: Math.round(y), preventDefault() {}, stopPropagation() {} }, anchor);
        }

        // ---------------------------------------------------------------- account

        async signIn() {
            if (typeof root.showConfirmationDialog !== 'function') return;
            const html = `<div class="xr-signin"><p>Sign in with your SiriusXM account.</p>
                <label>Email or username<input type="text" class="xr-si-user" autocomplete="username" spellcheck="false" data-autofocus></label>
                <label>Password<input type="password" class="xr-si-pass" autocomplete="current-password"></label>
                <p class="xr-si-note">The login is kept in Dreamscape CardSpace, so XM Radio can sign in again by itself.</p></div>`;
            const v = await root.showConfirmationDialog(html, [{ text: 'Sign In', value: 'ok' }, { text: 'Cancel', value: null }], null, {
                title: 'Sign In to SiriusXM', icon: 'fas fa-radio', owner: this.modal,
                onDialogReady: () => { setTimeout(() => { const i = doc.querySelector('#confirmationDialog .xr-si-user'); if (i) i.focus(); }, 60); },
                resolveValue: (value, dlg) => (value === 'ok' ? { handle: dlg.querySelector('.xr-si-user').value.trim(), password: dlg.querySelector('.xr-si-pass').value } : null)
            });
            if (!v || !v.handle || !v.password) return;
            this.say('SIGNING IN');
            try {
                const r = await this.ask('xmradio_signin', v);
                this.account = r && r.account;
                await this.loadLineup();
                this.say('SIGNED IN');
                if (this.on && this.state === 'signin') { const ch = this.byId.get(this.prefs.channel) || this.lineup[0]; if (ch) void this.tune(ch); }
            } catch (err) {
                this.say('SIGN IN FAILED');
                await root.showConfirmationDialog(`<div>${esc((err && err.message) || 'SiriusXM could not sign you in.')}</div>`, [{ text: 'OK', value: true }], null, { title: NAME, icon: 'fas fa-circle-xmark', owner: this.modal });
            }
        }

        /** The SiriusXM card in CardSpace signs the radio in. */
        async signInCard() {
            this.say('SIGNING IN');
            try {
                const r = await this.ask('xmradio_signin_card', {});
                this.account = r && r.account;
                await this.loadLineup();
                this.say('SIGNED IN');
                if (this.on) { const ch = this.byId.get(this.prefs.channel) || this.lineup[0]; if (ch) void this.tune(ch); }
            } catch (err) {
                this.say('SIGN IN FAILED');
                await root.showConfirmationDialog(`<div>${esc((err && err.message) || 'SiriusXM could not sign you in.')}</div>`, [{ text: 'OK', value: true }], null, { title: NAME, icon: 'fas fa-circle-xmark', owner: this.modal });
            }
        }

        /**
         * The sign-in page in Alchemy, where 1Password is (Yukimi, Nov 20 2026: what is copied there cannot be pasted
         * into the Melaton page): a one-time page of the server's own; the account item is pushed when it is done.
         */
        async signInBrowser() {
            let r;
            try {
                r = await this.ask('xmradio_signin_browser', {});
            } catch (err) {
                await root.showConfirmationDialog(`<div>${esc((err && err.message) || 'Alchemy could not be reached.')}</div>`, [{ text: 'OK', value: true }], null, { title: NAME, icon: 'fas fa-circle-xmark', owner: this.modal });
                return;
            }
            this.browserWait = true;
            void this.syncHub();
            this.say('SIGN IN IN ALCHEMY');
            const go = root.openGrimoireUrl;
            if (typeof go === 'function') Promise.resolve().then(() => go(r.url)).catch(() => {});
        }

        /** MENU > Refresh Lineup: the server reads SiriusXM's channels again now (it does once a month by itself). */
        async refreshLineup() {
            this.say('UPDATING');
            try {
                const r = await this.ask('xmradio_lineup', { fresh: true });
                this.lineup = (r && r.channels) || this.lineup;
                this.byId = new Map(this.lineup.map((c) => [c.id, c]));
                this.say(`${this.lineup.length} CHANNELS`);
            } catch (_) {
                // a long read outlasts the request: the lineup item is pushed when it is done
                this.say('UPDATING');
            }
        }

        async signOut() {
            const ok = await root.showConfirmationDialog('<div>Sign out of SiriusXM on this Dreamscape? The radio stops until you sign in again.</div>', [{ text: 'Sign Out', value: true }, { text: 'Cancel', value: false }], null, { title: NAME, icon: 'fas fa-triangle-exclamation', owner: this.modal });
            if (ok !== true) return;
            try {
                const r = await this.ask('xmradio_signout', {});
                this.account = r && r.account;
            } catch (_) { /* shown by the next paint */ }
            this.stop();
            if (this.on) this.state = 'signin';
            this.paint();
        }

        about() {
            void root.showConfirmationDialog(`<div><b>${NAME}</b><br>Version 1.0<br><br>A SiriusXM radio for Melaton.<br>SiriusXM and XM are trademarks of Sirius XM Radio LLC.<br><br>&copy; 2026 Xyridian Corporation.</div>`, [{ text: 'OK', value: true }], null, { title: `About ${NAME}`, icon: 'fas fa-circle-info', owner: this.modal });
        }

        // ---------------------------------------------------------------- the display

        /** A short message on the display's top line for two seconds (as a receiver shows its own). */
        say(text) {
            this.flash = { text: String(text), until: Date.now() + 2000 };
            clearTimeout(this.flashTimer);
            this.flashTimer = setTimeout(() => { this.flash = null; this.paint(); }, 2000);
            this.paint();
        }

        paint() {
            const f = this.f;
            const r = this.root;
            r.classList.toggle('is-on', this.on);
            r.dataset.state = this.state;
            const ch = this.channel;
            const now = ch ? this.now.get(ch.id) : null;
            const preIdx = ch ? (this.presets[this.prefs.band] || []).indexOf(ch.id) : -1;
            f.pre.textContent = this.on && !this.guide && preIdx >= 0 ? `P${preIdx + 1}` : '';
            let l1num = '';
            let l1name = '';
            let l2 = '';
            let l3 = '';
            // the channel the art and logo slots show: the guide's, else the tuned one
            let shown = ch;
            let shownNow = now;
            if (!this.on) {
                l1name = '';
            } else if (this.guide) {
                const g = this.guideList()[this.guide.i];
                shown = g || null;
                shownNow = g ? this.now.get(g.id) : null;
                l1num = g ? pad(g.number || 0, 3) : '';
                l1name = g ? g.name : '';
                l2 = shownNow ? (shownNow.ad ? 'SiriusXM' : shownNow.a || shownNow.s) : 'GUIDE';
                l3 = shownNow ? (shownNow.ad ? 'Commercial' : shownNow.t) : 'Turn TUNE, press to tune';
            } else if (this.directMode) {
                l1num = 'CH';
                l1name = `${this.direct.padEnd(3, '_')}`;
                l2 = 'DIRECT TUNE';
                l3 = 'Type a number, Enter';
            } else if (this.browserWait && !this.signedIn()) {
                l1name = 'SIGN IN';
                l2 = 'In Alchemy';
                l3 = 'XM Radio sign-in page';
            } else if (this.account && this.account.cardRefused) {
                l1name = 'SIGN IN';
                l2 = 'PASSWORD REFUSED';
                l3 = 'Edit the CardSpace card';
            } else if (this.state === 'signin' || !this.signedIn()) {
                l1name = 'SIGN IN';
                l2 = 'MENU > Sign In';
                l3 = 'SiriusXM account';
            } else if (!ch) {
                l1name = this.lineup.length ? 'XM RADIO' : 'UPDATING';
                l2 = this.lineup.length ? 'Turn TUNE' : 'Channels loading';
            } else {
                l1num = pad(ch.number || 0, 3);
                l1name = ch.name || '';
                if (this.state === 'acquiring') { l2 = 'ACQUIRING SIGNAL'; l3 = ''; }
                else if (this.state === 'nosignal') { l2 = 'NO SIGNAL'; l3 = 'Check connection'; }
                else if (this.state === 'nosub') { l2 = 'NOT SUBSCRIBED'; l3 = 'Not in your plan'; }
                else if (this.prefs.info === 'channel') { l2 = ch.name || ''; l3 = ch.genre || ''; }
                else if (this.prefs.info === 'show') { l2 = (now && now.s) || ch.name || ''; l3 = (now && now.ad) ? 'Commercial' : ''; }
                else { l2 = now ? (now.ad ? 'SiriusXM' : now.a) : ''; l3 = now ? (now.ad ? 'Commercial' : now.t) : ''; }
            }
            if (this.flash && this.on) { l2 = this.flash.text; }
            f.num.textContent = l1num;
            f.name.textContent = l1name;
            this.setRun(f.l2, l2);
            this.setRun(f.l3, l3);
            f.band.textContent = this.on ? (this.guide ? 'GUIDE' : this.prefs.band) : '';
            r.classList.toggle('is-guide', !!this.guide);
            // the song's art (else the channel's logo) and the channel's logo, in the display's own manner
            const songArt = this.on && shown && shownNow && !shownNow.ad && shownNow.i ? shownNow.i : '';
            const logo = this.on && shown && shown.logo ? shown.logo : '';
            this.drawArt(f.art, songArt || logo, 'artKey');
            this.drawArt(f.logo, songArt ? logo : '', 'logoKey');
            if (this.on && shown && !shown.logo && shown.id) void this.wantLogos([shown.id]);
            f.sig.dataset.bars = !this.on ? '0' : this.state === 'playing' || this.state === 'paused' ? '3' : this.state === 'acquiring' ? '1' : '0';
            this.paintReplay();
            this.paintClock();
            this.mediaMeta(ch, now);
            const led = r.querySelector('.xr-dock-led');
            if (led) led.classList.toggle('is-on', this.on);
        }

        /**
         * A picture on the display: colour on the TFT; on the LCD and the dot matrix redrawn in the display's one ink
         * (Floyd-Steinberg dithered, as a graphic LCD shows a picture). Drawn once per picture, never on a timer.
         */
        drawArt(canvas, url, keyName) {
            const key = url ? `${url}|${this.prefs.display}` : '';
            if (this[keyName] === key) return;
            this[keyName] = key;
            canvas.classList.toggle('is-empty', !url);
            const g = canvas.getContext('2d');
            if (!url) { g.clearRect(0, 0, canvas.width, canvas.height); return; }
            const img = new root.Image();
            img.decoding = 'async';
            img.onload = () => {
                if (this[keyName] !== key) return;
                const W = canvas.width;
                const H = canvas.height;
                g.clearRect(0, 0, W, H);
                const sc = Math.min(W / img.naturalWidth, H / img.naturalHeight);
                const w = Math.round(img.naturalWidth * sc);
                const h = Math.round(img.naturalHeight * sc);
                const x = Math.round((W - w) / 2);
                const y = Math.round((H - h) / 2);
                g.drawImage(img, x, y, w, h);
                if (this.prefs.display === 'tft') return;
                const ink = this.prefs.display === 'dot' ? [111, 243, 255] : [27, 36, 16];
                const data = g.getImageData(0, 0, W, H);
                const d = data.data;
                const lum = new Float32Array(W * H);
                for (let i = 0; i < W * H; i++) {
                    const a = d[i * 4 + 3] / 255;
                    // transparent logo parts read as the panel's background
                    const v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a);
                    lum[i] = this.prefs.display === 'dot' ? 255 - v : v;
                }
                for (let yy = 0; yy < H; yy++) {
                    for (let xx = 0; xx < W; xx++) {
                        const i = yy * W + xx;
                        const old = lum[i];
                        const on = old < 128; // dark pixels on the LCD, lit dots on the dot matrix
                        const err = old - (on ? 0 : 255);
                        if (xx + 1 < W) lum[i + 1] += err * 7 / 16;
                        if (yy + 1 < H) {
                            if (xx > 0) lum[i + W - 1] += err * 3 / 16;
                            lum[i + W] += err * 5 / 16;
                            if (xx + 1 < W) lum[i + W + 1] += err * 1 / 16;
                        }
                        d[i * 4] = ink[0]; d[i * 4 + 1] = ink[1]; d[i * 4 + 2] = ink[2];
                        d[i * 4 + 3] = on ? 255 : 0;
                    }
                }
                g.putImageData(data, 0, 0);
            };
            img.src = url;
        }

        /** The preset keys show their channels' logos (the band's six). */
        paintPresets() {
            const list = this.presets[this.prefs.band] || [];
            this.root.querySelectorAll('[data-pre]').forEach((b) => {
                const ch = this.byId.get(list[Number(b.dataset.pre) - 1]);
                const img = b.querySelector('.xr-pre-logo');
                const src = ch && ch.logo ? ch.logo : '';
                if (src && img.getAttribute('src') !== src) img.src = src;
                img.hidden = !src;
                b.classList.toggle('has-logo', !!src);
                b.title = ch ? `Preset ${this.prefs.band}${b.dataset.pre}: ${ch.number} ${ch.name} (hold to store)` : `Preset ${this.prefs.band}${b.dataset.pre} (hold to store)`;
            });
        }

        /** A line too long for the display scrolls (only while the radio plays and is seen). */
        setRun(el, text) {
            if (el.textContent !== text) {
                el.textContent = text;
                el.style.removeProperty('--xr-run');
            }
            requestAnimationFrame(() => {
                const box = el.parentElement;
                const over = el.scrollWidth - box.clientWidth;
                const run = over > 4 && this.on && this.seen();
                el.classList.toggle('is-running', run);
                if (run) { el.style.setProperty('--xr-run', `${-over}px`); el.style.setProperty('--xr-run-s', `${Math.max(4, Math.round(over / 18))}s`); }
            });
        }

        paintReplay() {
            const f = this.f;
            if (!this.on || !this.channel || (this.state !== 'playing' && this.state !== 'paused')) { f.replay.textContent = ''; return; }
            const b = Math.round(this.behind());
            const txt = this.audio.paused ? 'PAUSED' : b > 5 ? `REPLAY -${Math.floor(b / 60)}:${pad(b % 60, 2)}` : '';
            if (f.replay.textContent !== txt) f.replay.textContent = txt;
        }

        paintClock() {
            const d = new Date();
            let h = d.getHours() % 12;
            if (h === 0) h = 12;
            this.f.clock.textContent = `${h}:${pad(d.getMinutes(), 2)}`;
            clearTimeout(this.clockTimer);
            if (!this.seen()) return;
            // the next minute, not a running tick
            this.clockTimer = setTimeout(() => this.paintClock(), (60 - d.getSeconds()) * 1000 + 50);
        }

        syncSeen() {
            if (this.seen()) this.paint();
            else {
                clearTimeout(this.clockTimer);
                this.root.querySelectorAll('.xr-run.is-running').forEach((el) => el.classList.remove('is-running'));
            }
        }

        mediaMeta(ch, now) {
            const ms = root.navigator && root.navigator.mediaSession;
            if (!ms || typeof root.MediaMetadata !== 'function') return;
            const key = ch && this.on ? `${ch.id}|${now ? now.a : ''}|${now ? now.t : ''}` : '';
            if (key === this.metaKey) return;
            this.metaKey = key;
            try {
                ms.metadata = key ? new root.MediaMetadata({ title: now && !now.ad ? now.t : ch.name, artist: now && !now.ad ? now.a : 'SiriusXM', album: `${ch.number} ${ch.name}`, artwork: ch.logo ? [{ src: ch.logo }] : [] }) : null;
            } catch (_) { /* not supported */ }
        }

        destroy() {
            clearTimeout(this.clockTimer);
            clearTimeout(this.flashTimer);
            this.on = false;
            void this.syncHub();
            this.stop(true);
            if (this.modal && this.modal.isConnected) {
                const m = this.modal;
                Promise.resolve(call('closeModal', m)).finally(() => { if (m.isConnected) m.remove(); });
            }
        }
    }

    /** The radio's look: its theme stylesheet (theme files hold the materials and colours), once. */
    function themeStyles() {
        if (doc.querySelector('link[data-xr-theme]')) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/css/themes/vista/xmradio.css';
        link.dataset.xrTheme = '1';
        doc.head.appendChild(link);
    }

    let running = null;
    function start(app) {
        themeStyles();
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        if (typeof root.desktopAppCreateWindow !== 'function') { app.exit(); return; }
        const r = new Radio(app);
        running = r;
        app.onExit(() => { if (running === r) running = null; r.destroy(); });
    }

    root.melatonXmRadio = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('xmradio', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
