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
    // the radios (Yukimi, Nov 20 2026): three docked receivers after hers (a glossy one, the Onyx Plus with its colour
    // screen and silver ring, the Onyx EZ with its blue LCD and pad), a car head unit and a tabletop set
    const BODIES = [['gloss', 'Gloss Receiver'], ['onyxplus', 'Onyx Plus Receiver'], ['onyxez', 'Onyx EZ Receiver'], ['stratus', 'Stratus Receiver'], ['roady', 'Roady XT Receiver'], ['car', 'Car Radio'], ['table', 'Tabletop Radio']];
    const DOCKED = new Set(['gloss', 'onyxplus', 'onyxez', 'stratus', 'roady']);
    // the docked receivers' screens are their own: colour on the Gloss and the Onyx Plus, an LCD on the Onyx EZ
    const MODEL_DISPLAY = { gloss: 'tft', onyxplus: 'tft', onyxez: 'lcd', stratus: 'lcd', roady: 'dotlcd' };
    // the faceplate's brand, by era (Yukimi, Nov 20 2026, her logos): each tints the display as its radios did, XM's
    // yellowish orange, Sirius' light blue, SiriusXM's blues before and after the 2023 rebrand
    const ERAS = [['xm', 'XM Satellite Radio'], ['sirius', 'Sirius Satellite Radio'], ['sxm2011', 'SiriusXM (2011)'], ['sxm2023', 'SiriusXM (2023)']];
    // the radio's own width per body (the window scales it: resizable, Yukimi Nov 20 2026)
    const NATURAL_W = { gloss: 560, onyxplus: 560, onyxez: 560, stratus: 560, roady: 520, car: 660, table: 620 };
    const DISPLAYS = [['lcd', 'LCD'], ['dot', 'Dot Matrix'], ['tft', 'TFT']];
    const BANDS = ['A', 'B', 'C'];
    // the faceplate's quality switch (Yukimi, Nov 20 2026): SiriusXM's own 256k / 128k / 32k, then Opus re-encoded on the
    // server for a very slow connection
    const QUALITIES = [['hi', '256', 'High: 256 kbit/s'], ['std', '128', 'Standard: 128 kbit/s'], ['low', '32', 'Low: 32 kbit/s'], ['eco24', 'E24', 'Economy: 24 kbit/s, re-encoded on the server'], ['eco16', 'E16', 'Economy: 16 kbit/s, re-encoded on the server']];
    const SVG = {
        back: '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M8 0v10L1 5zM15 0v10L8 5z"/></svg>',
        play: '<svg viewBox="0 0 20 10" aria-hidden="true"><path d="M1 0v10l7-5zM11 0h3v10h-3zM16 0h3v10h-3z"/></svg>',
        fwd: '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 0v10l7-5zM8 0v10l7-5z"/></svg>'
    };
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
            body: BODIES.some((b) => b[0] === p.body) ? p.body : 'gloss',
            display: DISPLAYS.some((d) => d[0] === p.display) ? p.display : 'lcd',
            volume: Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : 0.7,
            band: BANDS.includes(p.band) ? p.band : 'A',
            info: INFO_MODES.includes(p.info) ? p.info : 'song',
            quality: QUALITIES.some((q) => q[0] === p.quality) ? p.quality : 'hi',
            era: ERAS.some((e) => e[0] === p.era) ? p.era : 'xm',
            zoom: Number(p.zoom) > 0 ? Number(p.zoom) : 1,
            // what the keyboard's media keys do (Yukimi, Nov 20 2026): skip through the stream, or change channel
            mediaKeys: p.mediaKeys === 'channel' ? 'channel' : 'transport',
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
            w.content.innerHTML = `<div class="xr-radio" tabindex="0" aria-label="${NAME}"><div class="xr-shell"></div><audio class="xr-audio" preload="none"></audio></div>`;
            this.root = m.querySelector('.xr-radio');
            this.audio = m.querySelector('.xr-audio');
            this.mountFaceplate();
            this.applyLook();
            this.wire(w);
            this.paint();
            call('openModal', m);
            m.classList.remove('hidden');
            this.place();
            void this.load();
        }

        /** The display: the same on every radio (the menu is drawn on it). */
        displayHtml() {
            return `<div class="xr-bezel"><div class="xr-display" aria-live="polite">
                <canvas class="xr-d-bg" data-f="bg" width="320" height="180" aria-hidden="true"></canvas>
                <div class="xr-d-top"><span data-f="band"></span><span data-f="pre"></span><span class="xr-d-fill"></span><span data-f="replay"></span><span class="xr-sig" data-f="sig"><i></i><i></i><i></i></span><span data-f="clock"></span></div>
                <div class="xr-d-main">
                    <canvas class="xr-d-art" data-f="art" width="64" height="64" aria-hidden="true"></canvas>
                    <div class="xr-d-text">
                        <div class="xr-d-l1"><span class="xr-d-num" data-f="num"></span><span class="xr-d-name" data-f="name"></span></div>
                        <div class="xr-d-l2"><span class="xr-run" data-f="l2"></span></div>
                        <div class="xr-d-l3"><span class="xr-run" data-f="l3"></span></div>
                    </div>
                    <canvas class="xr-d-logo" data-f="logo" width="60" height="48" aria-hidden="true"></canvas>
                </div>
                <div class="xr-d-menu" data-f="menu" hidden><div class="xr-m-title" data-f="mtitle"></div><ol class="xr-m-list" data-f="mlist"></ol></div>
            </div></div>`;
        }

        /** A preset / number key: a press tunes (or types a digit in Direct Tune), a long press stores. */
        numKey(n, cls) {
            const d = n === 10 ? 0 : n;
            return `<button type="button" class="${cls} xr-pre" data-pre="${n}" title="${d} (hold to store a preset)"><img class="xr-pre-logo" alt="" draggable="false" hidden><span class="xr-pre-n">${d}</span></button>`;
        }

        /** The faceplate of a model: its own keys, the shared display. */
        faceplateHtml(model) {
            const disp = this.displayHtml();
            const brand = '<div class="xr-brand" data-f="brand"></div>';
            const dock = '';
            const key = (b, label, sub, cls) => `<span class="xr-kw${cls ? ` ${cls}` : ''}"><button type="button" class="xr-sk" data-b="${b}" title="${esc(label)}">${label}</button>${sub ? `<i>${esc(sub)}</i>` : ''}</span>`;
            const transport = `<button type="button" class="xr-tk xr-glyph" data-b="back" title="Back 15 seconds">${SVG.back}</button><button type="button" class="xr-tk xr-glyph" data-b="play" title="Pause / Play">${SVG.play}</button><button type="button" class="xr-tk xr-glyph" data-b="fwd" title="Forward 15 seconds">${SVG.fwd}</button>`;
            if (model === 'gloss') {
                return `<div class="xr-g-edge"><button type="button" class="xr-ek" data-b="power" title="Power">&#x23FB;</button>${brand}<span class="xr-g-edge-fill"></span><button type="button" class="xr-ek" data-b="menu" title="Menu">menu</button><button type="button" class="xr-ek" data-b="band" title="Preset bank">fav</button></div>
                    ${disp}
                    <div class="xr-g-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => this.numKey(n, 'xr-rk')).join('')}<button type="button" class="xr-rk" data-b="direct" title="Direct tune">#</button></div>
                    <div class="xr-g-knob" data-k="tune" title="Tune (turn); press to select"><span class="xr-g-ring"></span><button type="button" class="xr-g-cap" data-nav="select" aria-label="Select"></button></div>
                    <div class="xr-g-bottom">${transport}<button type="button" class="xr-tk" data-b="jump" title="Jump to the last channel">jump</button><button type="button" class="xr-tk xr-g-arrow" data-nav="left" title="Back">&#x2039;</button><button type="button" class="xr-tk xr-g-arrow" data-nav="right" title="Forward">&#x203A;</button></div>
                    ${dock}`;
            }
            if (model === 'stratus') {
                // the Stratus (Yukimi's photo, Nov 20 2026): glossy black, a blue LCD, the brand above it, paired number keys
                const sk = (attr, html, title, cls) => `<button type="button" class="xr-stk${cls ? ` ${cls}` : ''}" ${attr} title="${esc(title)}">${html}</button>`;
                const pair = (a, b) => `<span class="xr-st-pair">${this.numKey(a, 'xr-stn')}<i class="xr-st-screw"></i>${this.numKey(b, 'xr-stn')}</span>`;
                return `<div class="xr-st-left">${sk('data-b="power"', '&#x23FB;', 'Power', 'is-power')}${sk('data-b="menu"', '<i class="xr-st-tape"></i><span>menu</span>', 'Menu', 'is-blue')}${sk('data-b="jump"', '&#x21B7;', 'Jump to the last channel', 'is-blue')}</div>
                    <div class="xr-st-mid">${brand}${disp}<div class="xr-st-under">${sk('data-b="disp"', '', 'Display information', 'xr-st-square')}<span class="xr-st-rocker">${sk('data-nav="left"', '&#x25C0;', 'Back 15 seconds', 'is-blue')}${sk('data-nav="right"', '&#x25B6;', 'Forward 15 seconds', 'is-blue')}</span></div></div>
                    <div class="xr-st-right">${sk('data-nav="up"', '&#x25B2;', 'Channel up', 'is-blue')}${sk('data-b="band"', '<i class="xr-st-dog"></i>', 'Preset bank', 'is-blue')}${sk('data-nav="down"', '&#x25BC;', 'Channel down', 'is-blue')}</div>
                    <div class="xr-st-nums">${pair(1, 2)}${pair(3, 4)}${pair(5, 6)}${pair(7, 8)}${pair(9, 10)}</div>`;
            }
            if (model === 'roady') {
                // the Roady XT (Yukimi's photo, Nov 20 2026): silver, a dot-matrix LCD, the maker's name rewritten
                const rk = (b, label, nav) => `<button type="button" class="xr-rdk"${nav ? ` data-nav="${nav}"` : ` data-b="${b}"`} title="${esc(label)}"><span>${label}</span><i></i></button>`;
                const pair = (a, b) => `<span class="xr-rd-pair">${this.numKey(a, 'xr-rdn')}${this.numKey(b, 'xr-rdn')}</span>`;
                return `<div class="xr-rd-left">${rk('power', '&#x23FC;')}${rk('menu', 'menu')}${rk('disp', 'disp')}</div>
                    <div class="xr-rd-win">${disp}<div class="xr-rd-print"><b class="xr-rd-maker">XYRIDIAN</b>${brand}<b class="xr-rd-model">roady<sup>xt</sup></b></div></div>
                    <div class="xr-rd-right">${rk('', '&#x25B2;', 'up')}${rk('', 'select', 'select')}${rk('', '&#x25BC;', 'down')}</div>
                    <div class="xr-rd-row"><i class="xr-rd-led"></i>${rk('direct', 'pre/dir')}${rk('band', 'memory')}${rk('jump', 'jump')}${rk('guide', 'search')}</div>
                    <div class="xr-rd-nums">${pair(1, 2)}${pair(3, 4)}${pair(5, 6)}${pair(7, 8)}${pair(9, 10)}</div>`;
            }
            if (model === 'onyxplus' || model === 'onyxez') {
                const ez = model === 'onyxez';
                const pad = ez
                    ? '<div class="xr-o-pad" data-k="tune" title="Up / down: channel"><button type="button" class="xr-o-dir is-up" data-nav="up" aria-label="Up"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-dir is-right" data-nav="right" aria-label="Right"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-dir is-down" data-nav="down" aria-label="Down"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-dir is-left" data-nav="left" aria-label="Left"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-center" data-nav="select" aria-label="Select"></button></div>'
                    : '<div class="xr-o-ring" data-k="tune" title="Up / down: channel"><button type="button" class="xr-o-zone is-up" data-nav="up" aria-label="Up"></button><button type="button" class="xr-o-zone is-right" data-nav="right" aria-label="Right"></button><button type="button" class="xr-o-zone is-down" data-nav="down" aria-label="Down"></button><button type="button" class="xr-o-zone is-left" data-nav="left" aria-label="Left"></button><button type="button" class="xr-o-center" data-nav="select" aria-label="Select"><i></i></button></div>';
                const side = ez
                    ? key('power', '&#x23FB;', '', 'is-power') + key('menu', 'menu', '', 'is-menu') + key('band', 'band', '') + key('jump', 'jump', '')
                    : key('power', '&#x23FB;', 'power', 'is-power') + key('menu', 'menu', 'guide', 'is-menu') + key('disp', 'info', 'disp') + key('jump', '&#x21B6;', 'jump');
                const last = ez ? '<button type="button" class="xr-bk" data-b="direct" title="Direct tune">direct</button>' : '<button type="button" class="xr-bk" data-b="band" title="Preset bank">b/#</button>';
                return `${brand}${disp}<div class="xr-o-nav">${pad}${ez ? '' : `<div class="xr-o-transport">${transport}</div>`}</div>
                    <div class="xr-o-side">${side}</div>
                    <div class="xr-o-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => this.numKey(n, 'xr-bk')).join('')}${last}</div>
                    ${dock}`;
            }
            // the car radio and the tabletop set
            return `<div class="xr-grille" aria-hidden="true"></div>
                <div class="xr-top">${brand}</div>
                <button type="button" class="xr-knob xr-vol" data-k="vol" title="Volume" aria-label="Volume"><i class="xr-knob-cap"></i><i class="xr-knob-mark"></i></button>
                ${disp}
                <button type="button" class="xr-knob xr-tune" data-k="tune" title="Tune (channel up / down)" aria-label="Tune"><i class="xr-knob-cap"></i><i class="xr-knob-mark"></i></button>
                <div class="xr-presets">${[1, 2, 3, 4, 5, 6].map((n) => this.numKey(n, 'xr-key')).join('')}</div>
                <div class="xr-fn">
                    <button type="button" class="xr-key xr-power" data-b="power" title="Power">&#x23FB;</button>
                    <button type="button" class="xr-key" data-b="band" title="Preset band">BAND</button>
                    <button type="button" class="xr-key" data-b="disp" title="Display information">DISP</button>
                    <button type="button" class="xr-key" data-b="direct" title="Direct tune">DIRECT</button>
                    <button type="button" class="xr-key" data-b="menu" title="Menu">MENU</button>
                </div>
                <div class="xr-replay">${transport.replace(/xr-tk/g, 'xr-key')}<button type="button" class="xr-key" data-b="live" title="Back to live">LIVE</button></div>`;
        }

        /** Builds the model's faceplate (again when the radio changes) and finds its display fields. */
        mountFaceplate() {
            const model = this.prefs.body;
            if (this.mounted === model) return;
            this.mounted = model;
            const shell = this.root.querySelector('.xr-shell');
            shell.innerHTML = this.faceplateHtml(model);
            this.f = {};
            this.root.querySelectorAll('[data-f]').forEach((el) => { this.f[el.dataset.f] = el; });
            this.artKey = null;
            this.logoKey = null;
            this.bgKey = null;
            this.paintPresets();
        }

        /** The display type: the docked receivers' own, else the one chosen. */
        displayType() { return MODEL_DISPLAY[this.prefs.body] || this.prefs.display; }

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
            this.mountFaceplate();
            this.root.dataset.body = this.prefs.body;
            this.root.dataset.docked = String(DOCKED.has(this.prefs.body));
            this.root.dataset.display = this.displayType();
            this.modal.dataset.xrBody = this.prefs.body;
            const era = ERAS.find((e) => e[0] === this.prefs.era) || ERAS[0];
            this.root.dataset.era = era[0];
            if (!this.f.brand.firstElementChild || this.f.brand.dataset.era !== era[0]) {
                this.f.brand.dataset.era = era[0];
                this.f.brand.innerHTML = `<img class="xr-brand-img" src="${A}/brand-${era[0]}.png" alt="${esc(era[1])}" draggable="false">`;
            }
            this.f.brand.title = era[1];
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
                const n = e.target.closest('[data-nav]');
                if (n) { this.nav(n.dataset.nav); return; }
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
            // the caption buttons fade a few seconds after the pointer stops (Yukimi, Nov 20 2026) and come back on a move
            const showCaption = () => {
                this.modal.classList.add('xr-caption-shown');
                clearTimeout(this.captionTimer);
                this.captionTimer = setTimeout(() => this.modal.classList.remove('xr-caption-shown'), 3000);
            };
            this.modal.addEventListener('pointermove', showCaption, sig);
            this.modal.addEventListener('pointerdown', showCaption, sig);
            showCaption();
            // the window's resize grip scales the radio (no polling: the browser says when the size changed)
            if (typeof root.ResizeObserver === 'function') {
                const ro = new root.ResizeObserver(() => this.fit(true));
                ro.observe(this.modal);
                this.app.signal.addEventListener('abort', () => ro.disconnect());
            }
            // the right button opens the on-screen menu too
            this.root.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this.menu) this.openMenu(); }, sig);
            // a click on a menu row picks it
            this.root.addEventListener('click', (e) => {
                const mi = e.target.closest('[data-mi]');
                const lv = this.menuLevel();
                if (!mi || !lv) return;
                lv.i = Number(mi.dataset.mi);
                this.nav('select');
            }, sig);
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
            const want = [...new Set(ids.filter((id) => id && this.byId.has(id) && (!this.byId.get(id).logo || !this.byId.get(id).bg) && !this.logoAsked.has(id)))];
            if (!want.length) { this.paintPresets(); return; }
            want.forEach((id) => this.logoAsked.add(id));
            try {
                const r = await this.ask('xmradio_logos', { ids: want });
                for (const [id, url] of Object.entries((r && r.logos) || {})) { const c = this.byId.get(id); if (c) c.logo = url; }
                for (const [id, url] of Object.entries((r && r.backgrounds) || {})) { const c = this.byId.get(id); if (c) c.bg = url; }
            } catch (_) { /* the number alone */ }
            this.paintPresets();
            this.paint();
            if (this.booklet && this.booklet.open) this.paintBooklet();
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
            if (this.channel && this.channel.id !== ch.id) this.prevChannel = this.channel.id;
            this.channel = ch;
            this.prefs.channel = ch.id;
            this.savePrefs();
            this.state = 'acquiring';
            this.paint();
            const seq = ++this.tuneSeq;
            let r;
            try {
                r = await this.ask('xmradio_tune', { channelId: ch.id, quality: this.prefs.quality });
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
            if (b === 'menu') { if (this.menu) this.closeMenu(); else this.openMenu(); return; }
            if (b === 'jump') { this.jump(); return; }
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
                this.openBooklet();
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

        // ---------------------------------------------------------------- the channel guide: a printed booklet

        /**
         * GUIDE opens the channel guide as the booklet that came with a receiver (Yukimi, Nov 20 2026): a cover in the
         * era's brand, then two-page spreads of the plan's channels (logo, number, name, what is on now). A row tunes the
         * radio; the page corners, the arrow keys and the wheel turn pages. Its own window, owned by the radio.
         */
        openBooklet() {
            if (this.booklet && this.booklet.modal.isConnected) { call('bringModalToFront', this.booklet.modal); return; }
            const w = root.desktopAppCreateWindow({ id: 'xmRadioGuideModal', identifier: 'xmRadioGuide', title: `${NAME} Channel Guide`, icon16: `${A}/xmradio-16.png`, className: 'xr-guide-window', fixed: true, minimize: false });
            const m = w.modal;
            m.dataset.windowKind = 'custom';
            m.dataset.parentModalId = this.modal.id;
            w.content.classList.add('xr-guide-client');
            w.content.innerHTML = `<div class="xr-book" data-era="${this.prefs.era}"><div class="xr-book-spread"><section class="xr-page xr-page-l"></section><section class="xr-page xr-page-r"></section></div>
                <button type="button" class="xr-book-turn is-prev" aria-label="Previous pages"></button><button type="button" class="xr-book-turn is-next" aria-label="Next pages"></button></div>`;
            const b = { modal: m, spread: 0, open: true, el: w.content.querySelector('.xr-book') };
            this.booklet = b;
            const ac = new AbortController();
            const sig = { signal: AbortSignal.any ? AbortSignal.any([ac.signal, this.app.signal]) : ac.signal };
            const close = () => { b.open = false; ac.abort(); Promise.resolve(call('closeModal', m)).finally(() => { if (m.isConnected) m.remove(); }); this.paint(); };
            w.close.addEventListener('click', close, sig);
            this.app.signal.addEventListener('abort', () => { if (m.isConnected) m.remove(); }, { once: true });
            b.el.querySelector('.is-prev').addEventListener('click', () => this.turnBooklet(-1), sig);
            b.el.querySelector('.is-next').addEventListener('click', () => this.turnBooklet(1), sig);
            b.el.addEventListener('wheel', (e) => { e.preventDefault(); this.turnBooklet(e.deltaY > 0 ? 1 : -1); }, Object.assign({ passive: false }, sig));
            m.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight' || e.key === 'PageDown') this.turnBooklet(1);
                else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.turnBooklet(-1);
                else if (e.key === 'Escape') close();
                else return;
                e.preventDefault();
            }, sig);
            b.el.addEventListener('click', (e) => {
                const row = e.target.closest('[data-ch]');
                if (!row) return;
                const ch = this.byId.get(row.dataset.ch);
                if (ch) void this.tune(ch);
            }, sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => { if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') { b.open = false; ac.abort(); this.paint(); } }, sig);
            call('openModal', m);
            m.classList.remove('hidden');
            this.paintBooklet();
            this.paint();
        }

        /** The booklet's pages: the cover, then 14 channels a page. */
        bookletPages() {
            const list = this.lineup.filter((c) => c.sub !== false);
            const pages = [{ cover: true }];
            for (let i = 0; i < list.length; i += 14) pages.push({ rows: list.slice(i, i + 14) });
            return pages;
        }

        turnBooklet(dir) {
            const b = this.booklet;
            if (!b || !b.open) return;
            const spreads = Math.ceil(this.bookletPages().length / 2);
            const next = Math.max(0, Math.min(spreads - 1, b.spread + dir));
            if (next === b.spread) return;
            b.spread = next;
            b.el.classList.remove('is-turning-next', 'is-turning-prev');
            void b.el.offsetWidth;
            b.el.classList.add(dir > 0 ? 'is-turning-next' : 'is-turning-prev');
            this.paintBooklet();
        }

        paintBooklet() {
            const b = this.booklet;
            if (!b || !b.open) return;
            const pages = this.bookletPages();
            const era = ERAS.find((e) => e[0] === this.prefs.era) || ERAS[0];
            b.el.dataset.era = era[0];
            const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            const pageHtml = (pg, n) => {
                if (!pg) return '<div class="xr-page-blank"></div>';
                if (pg.cover) {
                    return `<div class="xr-cover"><img class="xr-cover-logo" src="${A}/brand-${era[0]}.png" alt="${esc(era[1])}" draggable="false">
                        <div class="xr-cover-title">Channel Guide</div><div class="xr-cover-sub">${esc(month)}</div>
                        <div class="xr-cover-count">${this.lineup.filter((c) => c.sub !== false).length} channels in your plan</div></div>`;
                }
                const first = pg.rows[0];
                const last = pg.rows[pg.rows.length - 1];
                return `<header class="xr-page-head"><span>Channels ${first.number}&ndash;${last.number}</span></header>
                    <ol class="xr-page-rows">${pg.rows.map((c) => {
                        const now = this.now.get(c.id);
                        const line = now ? (now.ad ? (now.s || '') : [now.a, now.t].filter(Boolean).join(' \u2013 ')) : '';
                        const cur = this.channel && this.channel.id === c.id ? ' is-current' : '';
                        return `<li class="xr-row${cur}" data-ch="${esc(c.id)}" title="Tune ${c.number} ${esc(c.name)}"><span class="xr-row-logo">${c.logo ? `<img src="${esc(c.logo)}" alt="" draggable="false">` : ''}</span><b class="xr-row-num">${c.number}</b><span class="xr-row-text"><span class="xr-row-name">${esc(c.name)}</span><span class="xr-row-now">${esc(line)}</span></span></li>`;
                    }).join('')}</ol>
                    <footer class="xr-page-foot">${n}</footer>`;
            };
            const i = b.spread * 2;
            b.el.querySelector('.xr-page-l').innerHTML = pageHtml(pages[i], i);
            b.el.querySelector('.xr-page-r').innerHTML = pageHtml(pages[i + 1], i + 1);
            b.el.querySelector('.is-prev').disabled = b.spread === 0;
            b.el.querySelector('.is-next').disabled = i + 2 >= pages.length;
            // the logos of the channels on these pages, asked once
            void this.wantLogos([...(pages[i] && pages[i].rows ? pages[i].rows : []), ...(pages[i + 1] && pages[i + 1].rows ? pages[i + 1].rows : [])].map((c) => c.id));
        }

        /** The quality switch moved: remembered on this computer; a playing channel is tuned again at it. */
        setQuality(q) {
            if (!QUALITIES.some((x) => x[0] === q) || q === this.prefs.quality) return;
            this.prefs.quality = q;
            this.savePrefs();
            const label = (QUALITIES.find((x) => x[0] === q) || [])[1];
            if (this.on) this.say(`QUALITY ${label}`);
            if (this.on && this.channel && this.state !== 'nosub') void this.tune(this.channel);
        }

        // ---------------------------------------------------------------- the on-screen menu and the pad

        /**
         * MENU is drawn on the display (Yukimi, Nov 20 2026): the pad, the knob and the keyboard move through it. Items:
         * { label, run(), sub() -> items, mark (checked), hint }.
         */
        menuRoot() {
            const radio = (list, cur, set) => list.map(([id, label]) => ({ label, mark: cur === id, run: () => { set(id); this.closeMenu(); } }));
            const signed = this.signedIn();
            const items = [
                { label: 'Channel Guide', run: () => { this.closeMenu(); this.openBooklet(); } },
                { label: 'Direct Tune', run: () => { this.closeMenu(); this.button('direct'); } },
                { label: 'Audio Quality', sub: () => radio([['hi', 'High 256k'], ['std', 'Standard 128k'], ['low', 'Low 32k'], ['eco24', 'Economy 24k'], ['eco16', 'Economy 16k']], this.prefs.quality, (id) => this.setQuality(id)) },
                { label: 'Display Info', sub: () => radio([['song', 'Artist and Song'], ['channel', 'Channel'], ['show', 'Show']], this.prefs.info, (id) => { this.prefs.info = id; this.savePrefs(); this.paint(); }) },
                { label: `Volume  ${Math.round(this.prefs.volume * 100)}`, adjust: (d) => this.knobStep('vol', d) },
                { label: 'Media Keys', sub: () => radio([['transport', 'Skip Back / Forward'], ['channel', 'Channel Down / Up']], this.prefs.mediaKeys, (id) => { this.prefs.mediaKeys = id; this.savePrefs(); }) },
                { label: 'Brand', sub: () => radio(ERAS, this.prefs.era, (id) => { this.prefs.era = id; this.savePrefs(); this.applyLook(); }) },
                { label: 'Radio', sub: () => radio(BODIES, this.prefs.body, (id) => { this.prefs.body = id; this.prefs.zoom = 1; this.savePrefs(); this.applyLook(); }) }
            ];
            if (!DOCKED.has(this.prefs.body)) items.push({ label: 'Display', sub: () => radio(DISPLAYS, this.prefs.display, (id) => { this.prefs.display = id; this.savePrefs(); this.applyLook(); }) });
            items.push(
                { label: 'Refresh Lineup', run: () => { this.closeMenu(); void this.refreshLineup(); }, off: !signed },
                signed
                    ? { label: 'Sign Out', run: () => { this.closeMenu(); void this.signOut(); } }
                    : { label: 'Sign In', sub: () => [
                        ...(this.account && this.account.card ? [{ label: 'With CardSpace Card', run: () => { this.closeMenu(); void this.signInCard(); } }] : []),
                        { label: 'In Alchemy', run: () => { this.closeMenu(); void this.signInBrowser(); } },
                        { label: 'Type It Here', run: () => { this.closeMenu(); void this.signIn(); } }
                    ] },
                { label: 'About', run: () => { this.closeMenu(); this.about(); } }
            );
            return items.filter((x) => !x.off);
        }

        openMenu() {
            this.menu = { stack: [{ title: 'Menu', items: () => this.menuRoot(), i: 0 }] };
            this.directMode = false;
            this.paintMenu();
        }

        closeMenu() {
            this.menu = null;
            this.paintMenu();
            this.paint();
        }

        menuLevel() { return this.menu && this.menu.stack[this.menu.stack.length - 1]; }

        /** The pad and the knob (and the arrow keys): the menu when it is open, else channels and replay. */
        nav(dir) {
            const lv = this.menuLevel();
            if (lv) {
                const items = lv.items();
                const cur = items[lv.i];
                if (dir === 'up' || dir === 'down') lv.i = (lv.i + (dir === 'down' ? 1 : -1) + items.length) % items.length;
                else if (dir === 'left' && cur && cur.adjust) cur.adjust(-1);
                else if (dir === 'right' && cur && cur.adjust) cur.adjust(1);
                else if (dir === 'left' || dir === 'back') { if (this.menu.stack.length > 1) this.menu.stack.pop(); else { this.closeMenu(); return; } }
                else if ((dir === 'select' || dir === 'right') && cur) {
                    if (cur.sub) {
                        const sub = cur.sub;
                        const list = sub();
                        this.menu.stack.push({ title: cur.label, items: sub, i: Math.max(0, list.findIndex((x) => x.mark)) });
                    } else if (cur.run) { cur.run(); return; }
                }
                this.paintMenu();
                return;
            }
            if (!this.on) { if (dir === 'select') this.power(); return; }
            if (dir === 'up') this.knobStep('tune', 1);
            else if (dir === 'down') this.knobStep('tune', -1);
            else if (dir === 'left') this.seekBy(-15);
            else if (dir === 'right') this.seekBy(15);
            else if (dir === 'select') this.button('disp');
        }

        paintMenu() {
            const f = this.f;
            const open = !!this.menu;
            this.root.classList.toggle('is-menu', open);
            f.menu.hidden = !open;
            if (!open) return;
            const lv = this.menuLevel();
            const items = lv.items();
            if (lv.i >= items.length) lv.i = 0;
            f.mtitle.textContent = lv.title;
            // a window of rows around the highlighted one (the LCD shows fewer than the colour screens)
            const rows = this.displayType() === 'tft' ? 6 : 4;
            const start = Math.max(0, Math.min(items.length - rows, lv.i - Math.floor(rows / 2)));
            f.mlist.innerHTML = items.slice(start, start + rows).map((it, k) => {
                const idx = start + k;
                const tail = it.sub ? '<i class="xr-m-more">&#x203A;</i>' : it.adjust ? '<i class="xr-m-more">&#x2039; &#x203A;</i>' : it.mark ? '<i class="xr-m-mark">&#x2713;</i>' : '';
                return `<li class="xr-m-item${idx === lv.i ? ' is-sel' : ''}" data-mi="${idx}"><span>${esc(it.label)}</span>${tail}</li>`;
            }).join('');
        }

        /** jump: back to the channel before this one. */
        jump() {
            const prev = this.prevChannel && this.byId.get(this.prevChannel);
            if (prev && this.on) void this.tune(prev);
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
                // Direct Tune waiting: the number keys type the channel
                if (this.directMode && this.on) {
                    this.direct = (this.direct + String(n % 10)).slice(-3);
                    this.paint();
                    return;
                }
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
            if (this.on) this.step(dir);
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

        /**
         * The keyboard (Yukimi, Nov 20 2026: "make sure to accept keyboard keys"): with the on-screen menu open the arrows,
         * Enter and Escape / Backspace move through it; otherwise digits tune (Enter), Up / Down change channel, Left /
         * Right replay 15 s, Space pauses, End goes live, M menu, G guide, J jump, B preset bank, D display info, P power,
         * + / - volume.
         */
        key(e) {
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            const k = e.key;
            const NAV = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select' };
            if (this.menu) {
                if (NAV[k]) this.nav(NAV[k]);
                else if (k === 'Escape' || k === 'Backspace') this.nav('back');
                else if (k === 'm' || k === 'M') this.closeMenu();
                else return;
                e.preventDefault();
                return;
            }
            if (/^[0-9]$/.test(k) && this.on) {
                this.directMode = true;
                this.direct = (this.direct + k).slice(-3);
                this.paint();
            } else if (k === 'Enter' && this.directMode) {
                const n = Number(this.direct);
                const ch = this.lineup.find((c) => c.number === n && c.sub !== false) || this.lineup.find((c) => c.number === n);
                this.directMode = false;
                this.direct = '';
                if (ch) void this.tune(ch); else this.say('INVALID CHANNEL');
            } else if (k === 'Escape' && this.directMode) {
                this.directMode = false; this.direct = ''; this.paint();
            } else if (k === 'Backspace' && this.directMode) {
                this.direct = this.direct.slice(0, -1); this.paint();
            } else if (NAV[k]) this.nav(NAV[k]);
            else if (k === 'End' && this.on) this.goLive();
            else if (k === ' ' && this.on) this.button('play');
            else if (k === 'm' || k === 'M') this.openMenu();
            else if (k === 'g' || k === 'G') this.openBooklet();
            else if ((k === 'j' || k === 'J') && this.on) this.jump();
            else if ((k === 'b' || k === 'B') && this.on) this.button('band');
            else if ((k === 'd' || k === 'D') && this.on) this.button('disp');
            else if (k === 'p' || k === 'P') this.power();
            else if (k === '+' || k === '=') this.knobStep('vol', 1);
            else if (k === '-' || k === '_') this.knobStep('vol', -1);
            else return;
            e.preventDefault();
        }

        mediaKeys() {
            const ms = root.navigator && root.navigator.mediaSession;
            if (!ms || typeof ms.setActionHandler !== 'function') return;
            const h = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (_) { /* not supported */ } };
            h('play', () => { if (this.on) void this.audio.play().catch(() => {}); });
            h('pause', () => this.audio.pause());
            h('nexttrack', () => { if (this.prefs.mediaKeys === 'channel') this.step(1); else this.seekBy(15); });
            h('previoustrack', () => { if (this.prefs.mediaKeys === 'channel') this.step(-1); else this.seekBy(-15); });
            h('seekbackward', () => this.seekBy(-15));
            h('seekforward', () => this.seekBy(15));
            this.app.signal.addEventListener('abort', () => { for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward']) h(a, null); });
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
            f.pre.textContent = this.on && preIdx >= 0 ? `P${preIdx + 1}` : '';
            let l1num = '';
            let l1name = '';
            let l2 = '';
            let l3 = '';
            const shown = ch;
            const shownNow = now;
            if (!this.on) {
                l1name = '';
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
                // the receivers show the number as it is (31, 56); the car and tabletop sets pad it (008)
                l1num = DOCKED.has(this.prefs.body) ? String(ch.number || 0) : pad(ch.number || 0, 3);
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
            f.band.textContent = this.on ? this.prefs.band : '';
            r.classList.toggle('is-guide', !!(this.booklet && this.booklet.open));
            // the song's art (else the channel's logo) and the channel's logo, in the display's own manner
            const songArt = this.on && shown && shownNow && !shownNow.ad && shownNow.i ? shownNow.i : '';
            const logo = this.on && shown && shown.logo ? shown.logo : '';
            this.drawArt(f.art, songArt || logo, 'artKey');
            this.drawArt(f.logo, songArt ? logo : '', 'logoKey');
            // the channel's background picture behind a colour screen's text (as the Onyx Plus shows its genre art)
            this.drawBg(this.on && this.displayType() === 'tft' && shown && shown.bg ? shown.bg : '');
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
            const dt = this.displayType();
            const key = url ? `${url}|${dt}|${this.prefs.era}` : '';
            if (this[keyName] === key) return;
            this[keyName] = key;
            canvas.classList.toggle('is-empty', !url);
            const g = canvas.getContext('2d');
            if (!url) { g.clearRect(0, 0, canvas.width, canvas.height); return; }
            const img = new root.Image();
            img.decoding = 'async';
            img.onload = () => {
                if (this[keyName] !== key) return;
                // drawn at the box's own size (a fixed canvas shape stretched the logos, Yukimi Nov 20 2026)
                const box = canvas.getBoundingClientRect();
                const scale = (root.devicePixelRatio || 1) * (this.zoom || 1);
                if (box.width > 0 && box.height > 0) {
                    canvas.width = Math.max(8, Math.round(box.width / (this.zoom || 1) * scale));
                    canvas.height = Math.max(8, Math.round(box.height / (this.zoom || 1) * scale));
                }
                const W = canvas.width;
                const H = canvas.height;
                g.clearRect(0, 0, W, H);
                // a logo's 5:4 picture is mostly clear margin round its lettering: fit what is drawn, not the margin
                const src = this.inkBox(img);
                const sc = Math.min(W / src.w, H / src.h);
                const w = Math.round(src.w * sc);
                const h = Math.round(src.h * sc);
                const x = Math.round((W - w) / 2);
                const y = Math.round((H - h) / 2);
                g.drawImage(img, src.x, src.y, src.w, src.h, x, y, w, h);
                if (dt === 'tft') return;
                // the era's ink (the theme's --xr-ink-rgb: dark on the LCD's backlight, the dot matrix's glow)
                const rgb = root.getComputedStyle(this.root.querySelector('.xr-display')).getPropertyValue('--xr-ink-rgb').split(',').map(Number);
                const ink = rgb.length === 3 && rgb.every((v) => v >= 0) ? rgb : (dt === 'dot' ? [111, 243, 255] : [27, 36, 16]);
                const data = g.getImageData(0, 0, W, H);
                const d = data.data;
                const lum = new Float32Array(W * H);
                for (let i = 0; i < W * H; i++) {
                    const a = d[i * 4 + 3] / 255;
                    // transparent logo parts read as the panel's background
                    const v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a);
                    lum[i] = dt === 'dot' ? 255 - v : v;
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

        /** The part of a picture that is not transparent (a logo's lettering inside its clear margin). */
        inkBox(img) {
            const full = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
            try {
                const c = doc.createElement('canvas');
                c.width = full.w;
                c.height = full.h;
                const g = c.getContext('2d', { willReadFrequently: true });
                g.drawImage(img, 0, 0);
                const d = g.getImageData(0, 0, full.w, full.h).data;
                let x0 = full.w; let y0 = full.h; let x1 = -1; let y1 = -1;
                for (let y = 0; y < full.h; y++) {
                    for (let x = 0; x < full.w; x++) {
                        if (d[(y * full.w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
                    }
                }
                if (x1 < 0) return full;
                return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
            } catch (_) { return full; }
        }

        /** The colour screen's background: the channel's picture, covering, dimmed towards the text. */
        drawBg(url) {
            const c = this.f.bg;
            if (!c || this.bgKey === url) return;
            this.bgKey = url;
            c.classList.toggle('is-empty', !url);
            const g = c.getContext('2d');
            if (!url) { g.clearRect(0, 0, c.width, c.height); return; }
            const img = new root.Image();
            img.decoding = 'async';
            img.onload = () => {
                if (this.bgKey !== url) return;
                const box = c.getBoundingClientRect();
                if (box.width > 0 && box.height > 0) {
                    c.width = Math.round(box.width * (root.devicePixelRatio || 1));
                    c.height = Math.round(box.height * (root.devicePixelRatio || 1));
                }
                const W = c.width;
                const H = c.height;
                const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight);
                const w = img.naturalWidth * sc;
                const h = img.naturalHeight * sc;
                g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
                const shade = g.createLinearGradient(0, 0, 0, H);
                shade.addColorStop(0, 'rgba(0, 0, 0, 0.15)');
                shade.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
                g.fillStyle = shade;
                g.fillRect(0, 0, W, H);
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
