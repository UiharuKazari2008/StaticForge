/**
 * QuickCast (Yozora #734): the AmusementVISION live launcher. Pick a cabinet, look at its picture and
 * its audio, press GO LIVE: OBS on Ruiko streams it to YouTube. STOP ends the stream.
 *
 *   Cabinets   the Remote Play scenes (config.json on the server); picking one starts OBS on Ruiko when
 *              it is closed, switches OBS to the Remote Play collection and the QuickCast profile, and
 *              puts the cabinet's scene on program (while live: asks first, it changes the stream)
 *   Monitor    a screenshot of the cabinet's scene twice a second (what goes on air)
 *   VU meter   what the stream hears with that scene on: stereo master + every source, peak hold
 *   Checks     OBS, scene, profile, stream key, picture, sound; GO LIVE asks only when one is not green
 *   Title      the YouTube title (pre-filled with the last one); signed in to YouTube, GO LIVE creates the
 *              broadcast with it, and while live Update changes the live video's title
 *   Settings   Broadcast (title, description, privacy, category, latency, DVR), Encoder (video / audio
 *              bitrate, rate control, resolution, fps), Account (stream key, API key, Google sign-in)
 *   Chat       the live chat, with a reply box when signed in
 *
 * Every request goes through the server (quickcast_* packets, modules/quickcast.js), which talks to
 * obs-websocket and holds the YouTube stream key. The key never comes back to the client.
 *
 *   melatonApps.define('quickcast', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const A = '/melaton-apps/quickcast/assets';
    const VERSION = '1.0.0734';
    // 5x7 dot-matrix font (character LCD / VFD style): 7 rows of 5 bits, MSB = left column
    const DM_FONT = {
        ' ': [0, 0, 0, 0, 0, 0, 0], '!': [4, 4, 4, 4, 0, 0, 4], '"': [10, 10, 0, 0, 0, 0, 0], '#': [10, 31, 10, 10, 10, 31, 10],
        '%': [24, 25, 2, 4, 8, 19, 3], '&': [12, 18, 20, 8, 21, 18, 13], "'": [4, 4, 0, 0, 0, 0, 0], '(': [2, 4, 8, 8, 8, 4, 2],
        ')': [8, 4, 2, 2, 2, 4, 8], '*': [0, 4, 21, 14, 21, 4, 0], '+': [0, 4, 4, 31, 4, 4, 0], ',': [0, 0, 0, 0, 12, 4, 8],
        '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], '/': [0, 1, 2, 4, 8, 16, 0], ':': [0, 12, 12, 0, 12, 12, 0],
        ';': [0, 12, 12, 0, 12, 4, 8], '<': [2, 4, 8, 16, 8, 4, 2], '=': [0, 0, 31, 0, 31, 0, 0], '>': [8, 4, 2, 1, 2, 4, 8],
        '?': [14, 17, 1, 2, 4, 0, 4], '@': [14, 17, 1, 13, 21, 21, 14], '[': [14, 8, 8, 8, 8, 8, 14], ']': [14, 2, 2, 2, 2, 2, 14],
        '_': [0, 0, 0, 0, 0, 0, 31], '|': [4, 4, 4, 4, 4, 4, 4],
        0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
        4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
        8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
        A: [14, 17, 17, 17, 31, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
        E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
        I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
        M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
        Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
        U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
        Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], '►': [16, 24, 28, 30, 28, 24, 16], '█': [31, 31, 31, 31, 31, 31, 31], '◄': [1, 3, 7, 15, 7, 3, 1]
    };
    const DM_COLS = 20;
    const DM_ROWS = 3;
    /** Draw up to 3 lines on a dot-matrix canvas: every character cell is 5x7 dots, unlit dots glow faintly. */
    const drawDotMatrix = (cv, lines, color) => {
        const P = 3; // dot pitch (px)
        const cw = 6;
        const ch = 9;
        const W = DM_COLS * cw * P;
        const H = DM_ROWS * ch * P;
        if (cv.width !== W) { cv.width = W; cv.height = H; }
        const g = cv.getContext('2d');
        g.fillStyle = '#060402';
        g.fillRect(0, 0, W, H);
        for (let r = 0; r < DM_ROWS; r++) {
            const text = String(lines[r] || '').toUpperCase().padEnd(DM_COLS).slice(0, DM_COLS);
            for (let c = 0; c < DM_COLS; c++) {
                const glyph = DM_FONT[text[c]] || DM_FONT['?'];
                for (let y = 0; y < 7; y++) {
                    for (let x = 0; x < 5; x++) {
                        const on = (glyph[y] >> (4 - x)) & 1;
                        g.fillStyle = on ? color : 'rgba(255, 150, 30, 0.07)';
                        g.beginPath();
                        g.arc((c * cw + x) * P + P / 2, (r * ch + y + 1) * P + P / 2, P * 0.42, 0, Math.PI * 2);
                        g.fill();
                    }
                }
            }
        }
    };

    // 7-segment LCD digits (broadcast gear clocks): lit segments over dim ghost segments
    const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
    const SEG_PATH = {
        a: 'M2 1h8l-1.5 1.5h-5z', b: 'M10.5 1.5v8l-1.5-1v-5.5z', c: 'M10.5 10.5v8l-1.5-1.5v-5.5z', d: 'M2 19h8l-1.5-1.5h-5z',
        e: 'M1.5 10.5v8l1.5-1.5v-5.5z', f: 'M1.5 1.5v8l1.5-1v-5.5z', g: 'M2.5 10l1.5-1h4l1.5 1-1.5 1h-4z'
    };
    const segChar = (ch) => {
        if (ch === ':') return '<svg class="qc-seg qc-seg-c" viewBox="0 0 4 20" aria-hidden="true"><rect class="on" x="1" y="5.5" width="2" height="2"/><rect class="on" x="1" y="12.5" width="2" height="2"/></svg>';
        if (ch === '.') return '<svg class="qc-seg qc-seg-c" viewBox="0 0 4 20" aria-hidden="true"><rect class="on" x="1" y="17" width="2" height="2"/></svg>';
        const lit = SEG[ch] == null ? '' : SEG[ch];
        return `<svg class="qc-seg" viewBox="0 0 12 20" aria-hidden="true">${Object.keys(SEG_PATH).map((k) => `<path class="${lit.includes(k) ? 'on' : 'off'}" d="${SEG_PATH[k]}"/>`).join('')}</svg>`;
    };
    const segs = (text) => String(text).split('').map(segChar).join('');
    const setSegs = (el, text) => {
        if (!el || el.dataset.text === text) return;
        el.dataset.text = text;
        el.innerHTML = segs(text);
        el.setAttribute('aria-label', text);
    };
    const checksAuthTip = (st) => {
        const a = st.youtube && st.youtube.account;
        if (a && a.signedIn) return `Signed in to YouTube as ${(a.profile && a.profile.title) || a.channel || 'a channel'}: VisionCaster makes the broadcast`;
        return a && a.apiKey ? 'YouTube API key only: chat can be read; sign in (Settings > Account) to set titles and reply' : 'Not signed in to YouTube: YouTube Studio\'s settings apply';
    };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const pad = (n) => String(n).padStart(2, '0');
    const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
    const STATUS_MS = 200;
    const PREVIEW_MS = 500;
    // preview rates: frames a second from still grabs, or RT = a realtime MJPEG stream
    const PV_RATES = [{ id: 'off', label: 'OFF', fps: 0 }, { id: '1', label: '1', fps: 1 }, { id: '2', label: '2', fps: 2 }, { id: '5', label: '5', fps: 5 }, { id: 'rt', label: 'RT', fps: 0 }];
    const lsGet = (k, d) => { try { const v = root.localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
    const lsSet = (k, v) => { try { root.localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
    const METER_MIN = -60;
    const DECAY_DB_S = 24;      // meter fall-back, PPM-like
    const PEAK_HOLD_MS = 1500;
    const AUDIO_OK_DB = -50;    // a sound above this in the last 3 s counts as "sound"
    const SCALE = [0, -6, -12, -18, -24, -30, -40, -50, -60];
    const LS_KEY = 'quickcast.cabinet';

    const meterPct = (db) => Math.max(0, Math.min(100, ((Math.max(METER_MIN, db) - METER_MIN) / -METER_MIN) * 100));

    /** A falling bar with a peak-hold tick: set() with fresh readings, frame() every animation frame. */
    class Bar {
        constructor(fill, tick) { this.fill = fill; this.tick = tick; this.v = -100; this.pk = -100; this.pkAt = 0; this.t = 0; }
        set(mag, peak) {
            const now = performance.now();
            const lvl = Math.max(mag, peak); // the bar shows peak level like a broadcast PPM
            if (lvl > this.v) this.v = lvl;
            if (peak > this.pk || now - this.pkAt > PEAK_HOLD_MS) { this.pk = Math.max(peak, mag); this.pkAt = now; }
        }
        frame(now) {
            const dt = this.t ? (now - this.t) / 1000 : 0;
            this.t = now;
            this.v = Math.max(-100, this.v - DECAY_DB_S * dt);
            if (now - this.pkAt > PEAK_HOLD_MS) this.pk = Math.max(this.v, this.pk - DECAY_DB_S * 2 * dt);
            const p = meterPct(this.v); // v follows the PEAK level (PPM-style), the tick holds the highest
            this.fill.style.setProperty('--qc-lv', `${p}%`);
            if (this.tick) {
                this.tick.style.setProperty('--qc-pk', `${meterPct(this.pk)}%`);
                this.tick.classList.toggle('is-hot', this.pk > -6);
                this.tick.style.opacity = this.pk > METER_MIN ? '1' : '0';
            }
        }
    }

    class QuickCast {
        constructor(app) {
            this.app = app;
            this.st = null;
            this.cabinet = '';
            this.busy = '';
            this.lastSound = 0;
            this.video = null;     // { ok, at } from the last preview
            this.previewFor = '';
            this.inputBars = new Map();
            this.children = new Set();
            this.winSeq = 0;
            this.wasLive = false;
            try { this.cabinet = root.localStorage.getItem(LS_KEY) || ''; } catch (_) { this.cabinet = ''; }
            try { this.sourcesShown = root.localStorage.getItem('quickcast.sources') !== 'hidden'; } catch (_) { this.sourcesShown = true; }
            this.build();
            this.loop();
        }

        // ---------------------------------------------------------------- the main window

        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window qc-window';
            m.dataset.windowIdentifier = 'melatonQuickCast';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = `${A}/quickcast-32.png`;
            m.dataset.windowDefaultWidth = '940';
            m.dataset.windowDefaultHeight = '620';
            m.dataset.windowMinWidth = '980';
            m.dataset.windowMinHeight = '540';
            m.style.width = `${Math.min(1160, root.innerWidth - 40)}px`;
            m.style.height = `${Math.min(620, root.innerHeight - 60)}px`;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'VisionCaster');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/quickcast-16.png" alt=""><span>VisionCaster - Video Mixer Remote</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small qc-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content qc-client"><div class="qc-root">
                    <div class="qc-menubar"><span data-qc-menu="file"><u>F</u>ile</span><span data-qc-menu="stream"><u>S</u>tream</span><span data-qc-menu="help"><u>H</u>elp</span></div>
                    <div class="qc-band">
                        <div class="qc-brand"><img class="qc-avlogo" src="${A}/amusementvision-logo.png" alt="AmusementVISION" width="252" height="36"><span class="qc-brand-sub"><span class="qc-word">VISION<b>CASTER</b></span><small>Video Mixer Remote</small></span></div>
                        <span class="qc-fill"></span>
                        <button type="button" class="qc-yt"><span class="qc-yt-dot"></span><img class="qc-yt-av" alt="" width="34" height="34" referrerpolicy="no-referrer" hidden><span class="qc-yt-names"><span class="qc-yt-text">YouTube: not signed in</span><small class="qc-yt-sub"></small><small class="qc-yt-live"></small></span><span class="qc-yt-arrow"></span></button>
                        <button type="button" class="qc-tb qc-copy" data-qc="copyurl" hidden title="Copy the broadcast's YouTube watch link">COPY WATCH LINK</button>
                        <div class="qc-tally"><span class="qc-tally-text">OFF AIR</span><span class="qc-tc qc-lcd" title="Time on air">${segs('--:--:--')}</span></div>
                        <div class="qc-todbox" title="Time of day"><em>TOD</em><span class="qc-tod qc-lcd">${segs('--:--:--')}</span></div>
                    </div>
                    <div class="qc-titlebar">
                        <label class="qc-title-label" for="qcTitleInput">TITLE</label>
                        <input type="text" id="qcTitleInput" class="qc-title" maxlength="100" spellcheck="true" placeholder="Stream title">
                        <button type="button" class="qc-tb qc-title-update" data-qc="updatetitle" title="Change the live video's title now">UPDATE</button>
                    </div>
                    <div class="qc-main">
                        <div class="qc-centre">
                            <div class="qc-monitor">
                                <img class="qc-pic" alt="">
                                <div class="qc-noimg">NO SIGNAL</div>
                                <div class="qc-mon-tag"><span class="qc-mon-kind">PREVIEW</span><span class="qc-mon-name"></span></div>
                                <div class="qc-mon-age"></div>
                                <div class="qc-pvrate" title="Preview frame rate: lower it when you are not watching, RT (realtime stream) when hunting a problem">${PV_RATES.map((r) => `<button type="button" class="qc-bk qc-pvk k-white" data-pv="${r.id}">${r.label}</button>`).join('')}</div>
                                <div class="qc-mon-busy"><span class="qc-spin"></span><span class="qc-mon-busy-text"></span></div>
                            </div>
                            <div class="qc-diag">
                                <div class="qc-drow qc-dcols"><span class="qc-drow-h"></span><div class="qc-dcells">${['SOURCE', 'CLOCK', 'PROCESS', 'ENCODE', 'TRANSPORT', 'DESTINATION'].map((c) => `<span>${c}</span>`).join('')}</div></div>
                                <div class="qc-drow" data-row="output"><span class="qc-drow-h"><em>OUTPUT</em><b>SATELLITE</b><small class="qc-drow-src">RUIKO</small></span><div class="qc-dcells"></div></div>
                                <div class="qc-drow" data-row="input"><span class="qc-drow-h"><em>INPUT</em><b>CABINET</b><small class="qc-drow-src">-</small></span><div class="qc-dcells"></div></div>
                                <div class="qc-dverdict is-off"><i></i><span class="qc-dverdict-text">-</span></div>
                            </div>
                            <div class="qc-srcs"><div class="qc-head qc-srcs-head">INPUTS ON AIR <small>(program audio mix)</small><button type="button" class="qc-mini qc-srcs-tog" data-qc="togglesrcs" title="Show or hide the source list">HIDE</button></div><div class="qc-srclist"></div></div>
                        </div>
                        <div class="qc-side">
                        <div class="qc-vu">
                            <div class="qc-head">AUDIO</div>
                            <div class="qc-vu-body">
                                <div class="qc-scale">${SCALE.map((d) => `<i style="bottom:${meterPct(d)}%">${d}</i>`).join('')}</div>
                                <div class="qc-ch"><div class="qc-bar" data-ch="0"><span class="qc-bar-fill"></span><span class="qc-bar-pk"></span></div><b>L</b></div>
                                <div class="qc-ch"><div class="qc-bar" data-ch="1"><span class="qc-bar-fill"></span><span class="qc-bar-pk"></span></div><b>R</b></div>
                            </div>
                            <div class="qc-vu-db">-inf dB</div>
                        </div>
                        </div>
                    </div>
                    <div class="qc-deck">
                        <div class="qc-bus qc-cbus"><span class="qc-bus-label">CABINET <small>TAKE</small></span><div class="qc-cablist"></div></div>
                        <div class="qc-bus qc-xbus qc-ctl"><span class="qc-bus-label">CABINET CONTROL <small class="qc-ctl-dev"></small></span><div class="qc-ctl-body"><p class="qc-ctl-none">Pick a cabinet.</p></div></div>
                        <div class="qc-bus qc-vbus"><span class="qc-bus-label">VIDEO</span><div class="qc-vkeys"><span class="qc-bus-none">-</span></div></div>
                        <div class="qc-side-keys">
                            <button type="button" class="qc-bk k-white" data-qc="remote" title="Remote front panel of a unit: its display, LEDs and controls">FRONT PANEL</button>
                            <button type="button" class="qc-bk k-white" data-qc="chat">LIVE CHAT</button>
                            <button type="button" class="qc-bk k-white" data-qc="settings">SETTINGS</button>
                        </div>
                        <button type="button" class="qc-bk qc-key qc-go k-red" data-qc="golive" disabled title="Go live">LIVE</button>
                        <button type="button" class="qc-bk qc-key qc-stop k-orange" data-qc="stop" disabled title="Stop the stream" aria-label="Stop"><span class="qc-key-sq"></span></button>
                    </div>
                    <div class="qc-status"><span class="qc-st-main">Ready</span><span class="qc-checks">
                        <span class="qc-chk" data-chk="obs"><i></i>LINK</span><span class="qc-chk" data-chk="scene"><i></i>PGM</span><span class="qc-chk" data-chk="profile"><i></i>PRESET</span><span class="qc-chk" data-chk="key"><i></i>UPLINK</span><span class="qc-chk" data-chk="auth"><i></i>AUTH</span><span class="qc-chk" data-chk="video"><i></i>VIDEO</span><span class="qc-chk" data-chk="audio"><i></i>AUDIO</span>
                    </span><span class="qc-st-obs">-</span><span class="qc-st-time">-</span></div>
                </div></div>`;
            doc.body.appendChild(m);
            this.modal = m;
            const q = (s) => m.querySelector(s);
            this.el = q;
            const sig = { signal: this.app.signal };
            m.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-qc]');
                if (b && !b.disabled && m.contains(b)) void this.command(b.dataset.qc);
                const c = ev.target.closest('[data-cab]');
                if (c && !c.disabled) void this.pick(c.dataset.cab);
                const x = ev.target.closest('[data-xl]');
                if (x && !x.disabled && x.dataset.xl !== 'game') void this.xlinkPress(x.dataset.xl, Number(x.dataset.n));
            }, sig);
            m.querySelectorAll('[data-qc-menu]').forEach((t) => {
                if (!root.contextMenu) return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.command(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.qcMenu); } }]
                });
            });
            if (root.contextMenu) {
                root.contextMenu.attachClickMenuToElement(q('.qc-yt'), {
                    onAction: (a) => void this.channelAction(a),
                    sections: [{ type: 'list', initfn: (sec) => { sec.items = this.channelItems(); } }]
                });
            } else q('.qc-yt').addEventListener('click', () => this.settingsWin('account'), sig);
            q('.qc-close').addEventListener('click', () => this.app.exit(), sig);
            const title = q('.qc-title');
            title.addEventListener('input', () => { this.titleDirty = true; this.render(); }, sig);
            title.addEventListener('keydown', (ev) => {
                if (ev.key !== 'Enter') return;
                ev.preventDefault();
                if (this.st && this.st.stream && this.st.stream.active) void this.command('updatetitle'); else void this.saveTitle();
            }, sig);
            title.addEventListener('change', () => { if (!(this.st && this.st.stream && this.st.stream.active)) void this.saveTitle(); }, sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            this.showSources(this.sourcesShown);
            q('.qc-srclist').addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-mute]');
                if (b && !b.disabled) void this.toggleMute(Number(b.dataset.mute), b);
            }, sig);
            this.master = [0, 1].map((ch) => new Bar(q(`.qc-bar[data-ch="${ch}"] .qc-bar-fill`), q(`.qc-bar[data-ch="${ch}"] .qc-bar-pk`)));
            q('.qc-pic').addEventListener('load', () => this.checkPicture(), sig);
            m.id = 'melatonQuickCastModal';
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
                root.programFaults.registerProgram(m.id, { name: 'VisionCaster', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'quickcast' }) });
            }
        }

        destroy() {
            this.children.forEach((c) => c.close());
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 400);
        }

        menu(name) {
            const live = !!(this.st && this.st.stream && this.st.stream.active);
            const online = !!(this.st && this.st.obs.state === 'online');
            switch (name) {
                case 'file': return [{ text: 'Exit', action: 'exit' }];
                case 'stream': return [
                    { text: 'Take to Air', action: 'golive', disabled: live || !this.canGo() },
                    { text: 'End Broadcast', action: 'stop', disabled: !live },
                    { separator: true },
                    { text: 'Broadcast Settings...', action: 'settings' },
                    { text: 'Encoder Settings...', action: 'encoder' },
                    { text: 'Uplink Key and YouTube Account...', action: 'key' },
                    { text: 'Live Chat', action: 'chat' },
                    { text: 'Start Satellite Engine', action: 'launch', disabled: online },
                    { text: 'Copy Watch Link', action: 'copyurl', disabled: !this.streamUrl() },
                    { text: 'Open Watch Page', action: 'watch', disabled: !this.streamUrl() }];
                case 'help': return [{ text: 'About VisionCaster...', action: 'about' }];
                default: return [];
            }
        }

        async command(a) {
            switch (a) {
                case 'exit': this.app.exit(); break;
                case 'golive': await this.goLive(); break;
                case 'stop': await this.stopStream(); break;
                case 'key': this.settingsWin('account'); break;
                case 'settings': this.settingsWin('broadcast'); break;
                case 'encoder': this.settingsWin('encoder'); break;
                case 'chat': this.chatWin(); break;
                case 'remote': this.remoteWin(); break;
                case 'updatetitle': await this.updateLiveTitle(); break;
                case 'togglesrcs': this.showSources(!this.sourcesShown); break;
                case 'launch':
                case 'obson': await this.run(`Starting ${this.satName()}'s encoder engine...`, 'quickcast_launch', {}); break;
                case 'obsoff':
                    if (!await this.ask(`Shut down ${this.satName()}'s encoder engine?\n\nIts outputs (and the NDI feeds it sends) stop too. Bring it back with ENGINE ON or by taking a cabinet.`)) break;
                    await this.run(`Shutting down ${this.satName()}'s encoder engine...`, 'quickcast_obs_off', {});
                    break;
                case 'watch': if (this.streamUrl()) root.open(this.streamUrl(), '_blank', 'noopener'); break;
                case 'copyurl': await this.copyUrl(); break;
                case 'about': this.about(); break;
                default: break;
            }
        }

        // ---------------------------------------------------------------- server

        async send(type, data) {
            let r = await root.wsClient.sendMessage(type, data || {}, false);
            if (r && r.data !== undefined) r = r.data;
            if (r && r.error) {
                const err = new Error(r.error.details || r.error.message || 'VisionCaster error');
                err.code = r.error.code;
                throw err;
            }
            return r;
        }

        /** One long operation with the monitor's busy band; failures in a message box. */
        async run(text, type, data) {
            this.setBusy(text);
            try {
                return await this.send(type, data);
            } catch (err) {
                await this.box(err.message, 'error');
                return null;
            } finally {
                this.setBusy('');
            }
        }

        setBusy(text) {
            this.busy = text;
            this.modal.classList.toggle('qc-is-busy', !!text);
            this.el('.qc-mon-busy-text').textContent = text;
            this.el('.qc-st-main').textContent = text || 'Ready';
            this.render();
        }

        loop() {
            const sig = this.app.signal;
            const poll = async () => {
                if (sig.aborted) return;
                try { this.st = await this.send('quickcast_status', { cabinet: this.cabinet || '' }); } catch (_) { /* keep the last */ }
                if (sig.aborted) return;
                this.render();
                setTimeout(poll, STATUS_MS);
            };
            // REALTIME by default; a lower rate is remembered when chosen
            this.pvRate = PV_RATES.some((r) => r.id === lsGet('visioncaster.pvRate', 'rt')) ? lsGet('visioncaster.pvRate', 'rt') : 'rt';
            this.rtFor = '';
            const pic = () => this.el('.qc-pic');
            const stopRt = () => { if (this.rtFor) { this.rtFor = ''; pic().removeAttribute('src'); } };
            const shot = async () => {
                if (sig.aborted) { stopRt(); return; }
                const c = this.cabinet;
                const st = this.st;
                const cab = st && st.cabinets.find((x) => x.id === c);
                const ready = c && st && st.obs.state === 'online' && cab && cab.present && !doc.hidden;
                const rate = PV_RATES.find((r) => r.id === this.pvRate) || PV_RATES[2];
                if (rate.id !== 'rt' || !ready || this.rtFor !== c) stopRt();
                if (ready && rate.id === 'rt') {
                    if (this.rtFor !== c) {
                        try {
                            const t = await this.send('quickcast_live_ticket', { cabinet: c, width: 960 });
                            this.rtFor = c;
                            pic().src = t.url;
                            this.previewFor = c;
                            this.previewAt = 0;
                        } catch (_) { this.previewFor = ''; }
                    }
                } else if (ready && rate.fps) {
                    try {
                        const r = await this.send('quickcast_preview', { cabinet: c, width: 640 });
                        if (r.cabinet === this.cabinet && r.image && this.pvRate !== 'rt') {
                            pic().src = r.image;
                            this.previewFor = r.cabinet;
                            this.previewAt = r.at;
                        }
                    } catch (_) { this.previewFor = ''; }
                } else if (!ready) this.previewFor = ''; // OFF keeps the last frame on the monitor
                this.shotT = setTimeout(shot, rate.fps ? 1000 / rate.fps : 500);
            };
            this.setPvRate = (id) => {
                this.pvRate = id;
                lsSet('visioncaster.pvRate', id);
                this.modal.querySelectorAll('.qc-pvk').forEach((b) => { const on = b.dataset.pv === id; b.classList.toggle('is-on', on); b.classList.toggle('k-orange', on && id !== 'rt'); b.classList.toggle('k-red', on && id === 'rt'); b.classList.toggle('k-white', !on); });
                this.modal.classList.toggle('qc-pv-off', id === 'off');
                this.modal.classList.toggle('qc-pv-rt', id === 'rt');
                clearTimeout(this.shotT);
                void shot();
            };
            this.modal.querySelectorAll('.qc-pvk').forEach((b) => b.addEventListener('click', () => this.setPvRate(b.dataset.pv)));
            const ctl = async () => {
                if (sig.aborted) return;
                if (this.cabinet && !doc.hidden && !this.ctlBusy) await this.loadControls(false);
                setTimeout(ctl, 6000);
            };
            void poll();
            this.setPvRate(this.pvRate);
            setTimeout(ctl, 800);
            const frame = (now) => {
                if (sig.aborted) return;
                this.master.forEach((b) => b.frame(now));
                this.inputBars.forEach((b) => b.frame(now));
                const db = Math.max(this.master[0].v, this.master[1].v);
                this.el('.qc-vu-db').textContent = db > -99 ? `${db.toFixed(1)} dB` : '-inf dB';
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
            const tick = setInterval(() => {
                this.el('.qc-st-time').textContent = clock(Date.now());
                setSegs(this.el('.qc-tod'), clock(Date.now()));
                const age = this.previewAt ? Math.round((Date.now() - this.previewAt) / 100) / 10 : null;
                this.el('.qc-mon-age').textContent = this.pvRate === 'rt' && this.rtFor ? 'REALTIME' : this.pvRate === 'off' ? 'PREVIEW HELD' : this.previewFor && age != null ? `${clock(this.previewAt)}  (${age.toFixed(1)} s)` : '';
            }, 250);
            sig.addEventListener('abort', () => clearInterval(tick));
        }

        // ---------------------------------------------------------------- render

        render() {
            const st = this.st;
            if (!st) return;
            const q = this.el;
            const online = st.obs.state === 'online';
            const live = !!(st.stream && st.stream.active);
            // first status: follow OBS's program scene when it is a cabinet and nothing is remembered
            if (!this.cabinet && st.programCabinet) this.cabinet = st.programCabinet;
            if (live && st.programCabinet && !this.busy) this.cabinet = st.programCabinet;

            // link lamp, tally
            this.modal.classList.toggle('qc-is-online', online);
            this.modal.classList.toggle('qc-is-launching', st.obs.state === 'launching');
            this.modal.classList.toggle('qc-is-live', live);
            this.modal.classList.toggle('qc-is-reconnecting', live && st.stream.reconnecting);
            q('.qc-tally-text').textContent = live ? (st.stream.reconnecting ? 'RECONNECTING' : 'ON AIR') : 'OFF AIR';
            setSegs(q('.qc-tc'), live ? String(st.stream.timecode).slice(0, 8) : '--:--:--');
            if (this.wasLive && !live && !this.busy) this.flash('The stream has ended.');
            this.wasLive = live;

            // cabinets
            const list = q('.qc-cablist');
            const sig = st.cabinets.map((c) => `${c.id}:${c.present}`).join('|');
            if (list.dataset.sig !== sig) {
                list.dataset.sig = sig;
                list.innerHTML = st.cabinets.map((c) => `<button type="button" class="qc-bk qc-cab k-white" data-cab="${esc(c.id)}" title="${esc(c.name)}: scene ${esc(c.scene)}${online && !c.present ? ' (missing)' : ''}">
                    <span class="qc-cab-label">${esc(String(c.short || c.name).slice(0, 4).toUpperCase())}</span>
                    <span class="qc-cab-tally"></span></button>`).join('');
            }
            list.querySelectorAll('[data-cab]').forEach((b) => {
                const c = st.cabinets.find((x) => x.id === b.dataset.cab);
                b.classList.toggle('is-sel', b.dataset.cab === this.cabinet);
                b.classList.toggle('is-pgm', !!c && st.programCabinet === c.id);
                b.classList.toggle('is-air', live && st.programCabinet === b.dataset.cab);
                // switcher tally: the picked cabinet is lit green (PVW), the one on air red (PGM)
                const pgm = live && st.programCabinet === b.dataset.cab;
                b.classList.toggle('k-red', pgm);
                b.classList.toggle('k-orange', !pgm && b.dataset.cab === this.cabinet);
                b.classList.toggle('k-white', !pgm && b.dataset.cab !== this.cabinet);
                b.classList.toggle('is-on', pgm || b.dataset.cab === this.cabinet);
                b.querySelector('.qc-cab-tally').textContent = pgm ? 'PGM' : b.dataset.cab === this.cabinet ? 'PVW' : '';
                b.disabled = !!this.busy || (online && !!c && !c.present);
            });

            // monitor
            const cab = st.cabinets.find((c) => c.id === this.cabinet);
            q('.qc-mon-name').textContent = cab ? cab.name : 'Pick a cabinet';
            const onAirPic = live && cab && st.programCabinet === cab.id;
            q('.qc-mon-kind').textContent = onAirPic ? 'ON AIR' : 'PREVIEW';
            this.modal.classList.toggle('qc-pic-air', !!onAirPic);
            const hasPic = !!(this.previewFor && this.previewFor === this.cabinet);
            this.modal.classList.toggle('qc-has-pic', hasPic);
            q('.qc-noimg').textContent = !online ? (st.obs.state === 'launching' ? 'ENGINE STARTING' : 'SATELLITE OFFLINE') : !cab ? 'TAKE A CABINET' : 'NO SIGNAL';

            // pipeline diagnostics: output (Ruiko) row, input (cabinet mux) row, verdict
            this.renderDiag(st);
            this.litVideoBus();

            // meters
            if (st.master) {
                this.master[0].set(st.master.mag[0], st.master.peak[0]);
                this.master[1].set(st.master.mag[1], st.master.peak[1]);
                if (Math.max(st.master.peak[0], st.master.peak[1]) > AUDIO_OK_DB) this.lastSound = Date.now();
            }
            this.renderSources(st.inputs || []);

            // checks
            const picOk = hasPic && this.video && this.video.ok;
            const sound = Date.now() - this.lastSound < 3000;
            const checks = {
                obs: online ? 'ok' : st.obs.state === 'launching' ? 'wait' : 'bad',
                scene: !online || !cab ? 'off' : !cab.present ? 'bad' : st.programCabinet === cab.id ? 'ok' : 'wait',
                profile: !online ? 'off' : st.profile === st.want.profile ? 'ok' : 'wait',
                key: st.key.set ? 'ok' : 'bad',
                video: !online || !cab ? 'off' : picOk ? 'ok' : hasPic ? 'warn' : 'bad',
                audio: !online || !st.master ? 'off' : sound ? 'ok' : 'warn',
                auth: st.youtube && st.youtube.account && st.youtube.account.signedIn ? 'ok' : st.youtube && st.youtube.account && st.youtube.account.apiKey ? 'warn' : 'off'
            };
            const tips = {
                obs: online ? `Control link to ${this.satName()} is up` : st.obs.state === 'launching' ? `${this.satName()}'s encoder engine is starting...` : `No control link to ${this.satName()}${st.obs.error ? `: ${st.obs.error}` : ''}. Take a cabinet to start its engine.`,
                scene: cab ? (st.programCabinet === cab.id ? `"${cab.scene}" is on program` : `"${cab.scene}" goes on program when you pick the cabinet or go live`) : 'Pick a cabinet',
                profile: st.profile === st.want.profile ? `Output preset ${st.want.profile} loaded` : `The output preset changes from "${st.profile || '-'}" to ${st.want.profile} on LIVE`,
                key: st.key.set ? `Uplink key ${st.key.hint}` : 'No uplink key: Stream > Uplink Key...',
                video: picOk ? 'Video present' : hasPic ? 'Video is black or one flat colour' : 'No video from the satellite yet',
                audio: sound ? 'Sound in the last 3 seconds' : `Nothing above ${AUDIO_OK_DB} dB in the last 3 seconds`,
                auth: checksAuthTip(st)
            };
            this.checks = checks;
            Object.entries(checks).forEach(([k, s]) => {
                const e = q(`[data-chk="${k}"]`);
                e.className = `qc-chk is-${s}`;
                e.title = tips[k];
            });

            // title, YouTube account
            const yt = st.youtube || { account: {}, last: {} };
            const ti = q('.qc-title');
            if (!this.titleDirty && doc.activeElement !== ti && ti.value !== (yt.last.title || '')) ti.value = yt.last.title || '';
            const signed = !!yt.account.signedIn;
            this.modal.classList.toggle('qc-yt-on', signed);
            const prof = yt.account.profile;
            q('.qc-yt-text').textContent = signed ? (prof ? prof.title : yt.account.channel || 'Signed in') : yt.account.apiKey ? 'YouTube: API key only' : 'YouTube: not signed in';
            q('.qc-yt-sub').textContent = signed && prof ? [prof.handle, prof.subscribers == null ? '' : `${prof.subscribers.toLocaleString('en-US')} subscribers`].filter(Boolean).join(' \u00b7 ') : '';
            const lv = yt.live;
            q('.qc-yt-live').textContent = live ? (lv && lv.viewers != null ? `\u25cf ${lv.viewers.toLocaleString('en-US')} watching${lv.likes != null ? ` \u00b7 ${lv.likes.toLocaleString('en-US')} likes` : ''}` : '\u25cf LIVE') : '';
            const av = q('.qc-yt-av');
            const avUrl = signed && prof && prof.avatar ? prof.avatar : '';
            if (av.dataset.src !== avUrl) { av.dataset.src = avUrl; if (avUrl) av.src = avUrl; else av.removeAttribute('src'); }
            av.hidden = !avUrl;
            q('.qc-yt').title = signed ? 'The channel GO LIVE streams to. Click to switch or add a channel.' : 'Not signed in: the title and settings in YouTube Studio apply. Click to sign in.';
            if (signed && !this.profileAsked) { this.profileAsked = true; void this.send('quickcast_yt_profile', {}).catch(() => {}); }
            const copy = q('.qc-copy');
            copy.hidden = !(live && this.streamUrl());
            ti.disabled = false;
            ti.title = signed ? 'The YouTube title. Enter saves it (while live: changes the live title).' : 'Saved for the next stream. Sign in to YouTube (Settings > Account) so VisionCaster can set it.';
            const tu = q('.qc-title-update');
            tu.hidden = !(live && signed);
            tu.disabled = !!this.busy || !ti.value.trim();

            // latched self-test faults on the units in this chain: banner, LIVE locked
            const faults = st.faults || [];
            const lock = faults.filter((f) => !f.overridden);
            // (no banner: the fault shows on the unit's self-test card and its front panel ALARM led)
            this.faultLock = lock;

            // keys
            q('.qc-go').disabled = live || !this.canGo();
            // LIVE: an on / off flash while armed (ready, not live), solid red only on air
            q('.qc-go').classList.toggle('is-armed', !live && !q('.qc-go').disabled);
            q('.qc-go').classList.toggle('is-on', live);
            // transport STOP: lit while stopped (not live), dark while on air until pressed
            q('.qc-stop').classList.toggle('is-on', !live);
            q('.qc-go').title = live ? 'Already on air' : this.busy ? this.busy : !cab ? 'Take a cabinet first' : !st.key.set ? 'Set the uplink key first (Stream > Uplink Key...)' : st.obs.state === 'launching' ? `${this.satName()}'s encoder engine is starting` : online && !cab.present ? `The layout "${cab.scene}" is missing on ${this.satName()}` : `Take ${cab.name} to air on YouTube`;
            q('.qc-stop').disabled = !live || !!this.busy;
            q('.qc-st-obs').textContent = online ? `PGM ${st.program || '-'} \u00b7 PRESET ${st.profile || '-'}` : (st.obs.error || 'Satellite offline');
            if (!this.busy && !this.flashT) q('.qc-st-main').textContent = live ? `Live: ${cab ? cab.name : st.program}` : lock.length ? `Advisory: ${lock.map((f) => f.unit).join(', ')} failed self test (front panel ALARM)` : 'Ready';
        }

        showSources(on) {
            this.sourcesShown = !!on;
            this.modal.classList.toggle('qc-srcs-hidden', !on);
            this.el('.qc-srcs-tog').textContent = on ? 'HIDE' : 'SHOW';
            try { root.localStorage.setItem('quickcast.sources', on ? 'shown' : 'hidden'); } catch (_) { /* private mode */ }
        }

        async toggleMute(n, btn) {
            const inp = this.inputs && this.inputs[n];
            if (!inp) return;
            const live = !!(this.st && this.st.stream && this.st.stream.active);
            if (!inp.muted && live && !await this.ask(`Mute "${inp.name}" on the live stream?`)) return;
            btn.disabled = true;
            try {
                await this.send('quickcast_mute', { name: inp.name, muted: !inp.muted });
                this.flash(`${inp.name} ${inp.muted ? 'unmuted' : 'muted'}.`);
            } catch (err) { await this.box(err.message, 'error'); }
            btn.disabled = false;
        }

        renderDiag(st) {
            const q = (sel) => this.modal.querySelector(sel);
            const d = st.diag || null;
            const rowOf = (name, data, fallback) => {
                const row = q(`.qc-drow[data-row="${name}"]`);
                const cells = row.querySelector('.qc-dcells');
                const stages = data && data.stages && data.stages.length ? data.stages : null;
                row.querySelector('.qc-drow-src').textContent = (data && data.source) || (name === 'output' ? 'RUIKO' : '-');
                row.querySelector('.qc-drow-h').title = (data && data.sourceDetail) || '';
                if (!stages) {
                    if (cells.dataset.ids !== '') { cells.dataset.ids = ''; cells.innerHTML = '<span class="qc-dnote"></span>'; }
                    cells.querySelector('.qc-dnote').textContent = (data && data.note) || fallback;
                    return;
                }
                // six fixed slots (the shared columns), so matching parts of both rows sit one above the other
                if (cells.dataset.ids !== 'grid') {
                    cells.dataset.ids = 'grid';
                    cells.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<span class="qc-dc is-off" data-col="${i}"><em><i></i><span></span></em><b></b></span>`).join('');
                }
                const byCol = new Map(stages.map((x) => [x.col, x]));
                cells.querySelectorAll('[data-col]').forEach((c) => {
                    const x = byCol.get(Number(c.dataset.col));
                    c.className = x ? `qc-dc is-${x.state}${x.blink ? ' is-blink' : ''}` : 'qc-dc is-empty';
                    c.querySelector('em span').textContent = x ? x.label : '';
                    c.querySelector('b').textContent = x ? x.value || '-' : '';
                    c.title = x ? x.detail || '' : '';
                });
            };
            const online = st.obs && st.obs.state === 'online';
            rowOf('output', d && d.output, online ? '...' : 'No link to the satellite encoder');
            rowOf('input', d && d.input, !this.cabinet ? 'Take a cabinet to check its mixer' : online ? '...' : 'Needs the satellite link to find the cabinet feed');
            const v = (d && d.verdict) || { state: 'off', text: online ? '' : 'Satellite offline' };
            const vb = q('.qc-dverdict');
            vb.className = `qc-dverdict is-${v.state}`;
            vb.querySelector('.qc-dverdict-text').textContent = v.text ? `DIAG: ${v.text}` : 'DIAG: -';
            const bad = v.stage && [...(d.input.stages || []), ...(d.output.stages || [])].find((x) => x.id === v.stage);
            vb.title = bad ? bad.detail : 'Hover a stage for its numbers. Signal order: cabinet capture > mixer > NDI out > link > satellite NDI RX > render > encoder > network > YouTube.';
        }

        renderSources(inputs) {
            this.inputs = inputs;
            const list = this.el('.qc-srclist');
            // an input OBS sends no meter for has no audio at all (a browser overlay): dimmed, not hidden
            const sig = inputs.map((i) => `${i.name}:${i.muted}:${i.mag.length > 0}`).join('|');
            if (list.dataset.sig !== sig) {
                list.dataset.sig = sig;
                const ordered = inputs.map((i, n) => ({ i, n })).sort((a, b) => (b.i.mag.length > 0) - (a.i.mag.length > 0) || a.i.muted - b.i.muted);
                list.innerHTML = inputs.length ? ordered.map(({ i, n }) => `<div class="qc-src${i.muted ? ' is-muted' : ''}${i.mag.length ? '' : ' is-silent'}" data-src="${n}">
                    <span class="qc-src-name" title="${esc(i.name)}">${esc(i.name)}</span>
                    <span class="qc-hbar"><span class="qc-bar-fill"></span><span class="qc-bar-pk"></span></span>
                    <span class="qc-src-state">${i.muted ? 'MUTED' : i.mag.length ? '' : 'NO AUDIO'}</span>
                    ${i.mag.length || i.muted ? `<button type="button" class="qc-bk qc-mute k-red${i.muted ? ' is-on' : ''}" data-mute="${n}" title="${i.muted ? 'Unmute' : 'Mute'} ${esc(i.name)}">MUTE</button>` : '<span class="qc-mute-none"></span>'}</div>`).join('')
                    : '<div class="qc-src-none">No audio sources in this scene.</div>';
                this.inputBars = new Map();
                inputs.forEach((i, n) => {
                    const row = list.querySelector(`[data-src="${n}"]`);
                    this.inputBars.set(i.name, new Bar(row.querySelector('.qc-bar-fill'), row.querySelector('.qc-bar-pk')));
                });
            }
            inputs.forEach((i) => {
                const b = this.inputBars.get(i.name);
                if (b && i.mag.length) b.set(Math.max(...i.mag), Math.max(...i.peak));
            });
        }

        /** A black or flat picture is not a signal: luma spread over a 32x18 copy. */
        checkPicture() {
            const img = this.el('.qc-pic');
            try {
                const c = this.cv || (this.cv = doc.createElement('canvas'));
                c.width = 32; c.height = 18;
                const g = c.getContext('2d', { willReadFrequently: true });
                g.drawImage(img, 0, 0, 32, 18);
                const d = g.getImageData(0, 0, 32, 18).data;
                let sum = 0; let sq = 0; const n = d.length / 4;
                for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += y; sq += y * y; }
                const mean = sum / n;
                const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
                this.video = { ok: sd > 6 || mean > 24, at: Date.now() };
            } catch (_) { this.video = { ok: true, at: Date.now() }; }
        }

        canGo() {
            const st = this.st;
            if (!st || this.busy || !this.cabinet || !st.key.set || st.obs.state === 'launching') return false;
            const cab = st.cabinets.find((c) => c.id === this.cabinet);
            if (!cab) return false;
            return st.obs.state !== 'online' || cab.present;
        }

        flash(t) {
            const s = this.el('.qc-st-main');
            s.textContent = t;
            clearTimeout(this.flashT);
            this.flashT = setTimeout(() => { this.flashT = null; }, 5000);
        }

        // ---------------------------------------------------------------- commands

        async pick(id) {
            if (this.busy) return;
            const st = this.st;
            const live = !!(st && st.stream && st.stream.active);
            const cab = st && st.cabinets.find((c) => c.id === id);
            if (!cab) return;
            this.cabinet = id;
            try { root.localStorage.setItem(LS_KEY, id); } catch (_) { /* private mode */ }
            this.previewFor = '';
            this.controls = null;
            this.renderControls();
            void this.loadControls(false);
            this.render();
            const text = st && st.obs.state !== 'online' ? `Starting ${this.satName()}'s encoder engine...` : live ? `Switching the stream to ${cab.name}...` : `Getting ${cab.name} ready...`;
            const r = await this.run(text, 'quickcast_prepare', { cabinet: id, confirmed: live });
            if (r && r.ok) this.flash(`${cab.name} is ready${r.steps && r.steps.length ? ` (${r.steps.join(', ')} switched)` : ''}.`);
        }

        async goLive() {
            if (!this.canGo()) return;
            const st = this.st;
            const cab = st.cabinets.find((c) => c.id === this.cabinet);
            const c = this.checks || {};
            const warn = [];
            if (c.video !== 'ok') warn.push('- No picture: the preview is black, flat or missing.');
            if (c.audio !== 'ok') warn.push(`- No sound: nothing above ${AUDIO_OK_DB} dB in the last 3 seconds.`);
            if (c.obs !== 'ok') warn.push(`- ${this.satName()}'s encoder engine is not running yet: it starts first.`);
            // self-test faults are advisory: listed here, never a lock
            (this.faultLock || []).forEach((f) => warn.push(`- ${f.unit} failed its self test: ${f.items.map((i) => `${i.label} ${i.detail}`).join(', ')}.`));
            if (warn.length && !await this.ask(`Go live with ${cab.name} anyway?\n\n${warn.join('\n')}`)) return;
            const title = this.el('.qc-title').value.trim();
            if (st.youtube && st.youtube.account.signedIn && !title) { await this.box('Enter a stream title first.', 'warning'); return; }
            const r = await this.run(`Going live with ${cab.name}...`, 'quickcast_golive', { cabinet: cab.id, settings: title ? { title } : undefined });
            if (r && r.ok) { this.titleDirty = false; this.flash(`${cab.name} is live on YouTube${r.broadcast ? `: ${r.broadcast.title}` : ''}.`); }
        }

        async stopStream() {
            const st = this.st;
            if (!st || !st.stream || !st.stream.active) return;
            if (!await this.ask(`Stop the live stream?\n\nOn air for ${String(st.stream.timecode).slice(0, 8)}. YouTube ends the broadcast.`)) return;
            const r = await this.run('Stopping the stream...', 'quickcast_stop', {});
            if (r && r.ok) this.flash('The stream has stopped.');
        }

        // ---------------------------------------------------------------- windows

        /** The satellite unit's name, as on its panel. */
        satName() { return (this.st && this.st.satellite && this.st.satellite.name) || 'SATELLITE'; }

        openWin(o) {
            const id = `melatonQuickCastWin-${++this.winSeq}`;
            const m = doc.createElement('div');
            // QuickCast's own panels (remote, chat, settings) are tool windows of the main window
            m.className = `modal hidden ${o.resizable ? 'resizeable-window' : 'on-top'} tool-window qc-window qc-child ${o.cls || ''}`;
            m.id = id;
            m.dataset.windowIdentifier = `melatonQuickCast-${o.kind}`;
            m.dataset.windowRestorePosition = o.resizable ? 'true' : 'false';
            m.dataset.windowRestoreSize = o.resizable ? 'true' : 'false';
            if (!o.resizable) m.dataset.windowFixedSize = 'true';
            if (o.height) { m.style.height = `${o.height}px`; m.dataset.windowDefaultHeight = String(o.height); m.dataset.windowMinHeight = '300'; }
            if (o.resizable) { m.dataset.windowDefaultWidth = String(o.width); m.dataset.windowMinWidth = '300'; }
            m.dataset.windowClient = 'light';
            m.dataset.iconOwnerId = this.modal.id;
            m.dataset.parentModalId = this.modal.id;
            m.dataset.taskbarIcon = `${A}/quickcast-32.png`;
            if (o.width) m.style.width = `${o.width}px`;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', o.title);
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/quickcast-16.png" alt=""><span>${esc(o.title)}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls"><button type="button" class="btn-danger close-btn btn-small qc-x" title="Close"><i class="fa-regular fa-xmark-large"></i></button></div>
                <div class="modal-content qc-client"><div class="qc-root qc-form">
                    <div class="qc-form-body">${o.body}</div>
                    <div class="qc-form-btns"${(o.buttons || []).length ? '' : ' hidden'}>${(o.buttons || []).map((b) => `<button type="button" class="qc-btn${b.def ? ' is-def' : ''}" data-v="${esc(b.value)}">${esc(b.text)}</button>`).join('')}</div>
                </div></div>`;
            doc.body.appendChild(m);
            const ctl = new AbortController();
            let closed = false;
            const w = {
                modal: m,
                val: (s) => { const e = m.querySelector(s); return e ? e.value.trim() : ''; },
                busy: (on) => { m.querySelectorAll('.qc-form-btns button').forEach((b) => { b.disabled = on; }); },
                close: () => {
                    if (closed) return;
                    closed = true;
                    ctl.abort();
                    this.children.delete(w);
                    try { call('closeModal', m); } catch (_) { /* gone */ }
                    setTimeout(() => m.remove(), 400);
                }
            };
            this.children.add(w);
            m.addEventListener('click', async (ev) => {
                if (ev.target.closest('.qc-x')) { w.close(); return; }
                const b = ev.target.closest('[data-v]');
                if (!b || b.disabled) return;
                if (b.dataset.v === 'cancel') { w.close(); return; }
                if (o.onButton && await o.onButton(b.dataset.v, w)) w.close();
            }, { signal: ctl.signal });
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape' && !o.resizable) { ev.stopPropagation(); w.close(); }
                if (ev.key === 'Enter' && ev.target.matches('input')) { const d = m.querySelector('.qc-form-btns .is-def'); if (d) { ev.preventDefault(); d.click(); } }
            }, { signal: ctl.signal });
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === id && e.detail.type === 'closed') w.close();
            }, { signal: ctl.signal });
            call('openModal', m);
            m.classList.remove('hidden');
            requestAnimationFrame(() => {
                const r = m.getBoundingClientRect();
                const p = this.modal.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round(p.left + (p.width - r.width) / 2)), Math.max(0, Math.round(p.top + (p.height - r.height) / 2)));
                const f = m.querySelector('input:not([type=checkbox])');
                if (f) f.focus({ preventScroll: true });
            });
            return w;
        }

        // ---------------------------------------------------------------- XLink cabinet control

        async loadControls(force) {
            const id = this.cabinet;
            if (!id) return;
            try {
                const c = await this.send('quickcast_cabinet', { cabinet: id, force: !!force });
                if (id === this.cabinet) { this.controls = c; this.ctlError = ''; }
            } catch (err) { if (id === this.cabinet) this.ctlError = err.message; }
            this.renderControls();
        }

        renderControls() {
            const body = this.el('.qc-ctl-body');
            const c = this.controls;
            const dev = this.el('.qc-ctl-dev');
            if (!c || !c.available || c.cabinet !== this.cabinet || !this.cabinet) body.dataset.sig = '';
            if (!c || !c.available || c.cabinet !== this.cabinet) this.renderVideoBus(null);
            if (!this.cabinet) { body.innerHTML = '<p class="qc-ctl-none">Pick a cabinet.</p>'; dev.textContent = ''; return; }
            if (!c || c.cabinet !== this.cabinet) { body.innerHTML = `<p class="qc-ctl-none">${this.ctlError ? esc(this.ctlError) : 'Reading XLink...'}</p>`; return; }
            if (!c.available) { body.innerHTML = '<p class="qc-ctl-none">No XLink device for this cabinet.</p>'; dev.textContent = ''; return; }
            dev.textContent = `XLink: ${c.device.name}`;
            const lamp = (s) => (s ? `<span class="qc-xs" style="${s.color ? `--qc-xs:${esc(s.color)}` : ''}">${esc(s.text)}</span>` : '');
            const tone = (kind, label) => (kind === 'power' ? (label === 'I' ? 'k-green' : label === 'O' ? 'k-red' : 'k-amber') : /v-?blk/i.test(label) ? 'k-amber' : 'k-green');
            const keys = (sec, kind, cls) => sec.buttons.map((b) => `<button type="button" class="qc-bk ${cls || 'qc-xk'} ${tone(kind, b.label)}${b.active ? ' is-on' : ''}" data-xl="${kind}" data-n="${b.n}" title="${esc(b.label)}">${esc(b.label)}</button>`).join('');
            this.renderVideoBus(c, keys);
            const sigNow = JSON.stringify([c.video, c.power, c.game && c.game.status, this.ctlBusy]);
            this.modal.classList.toggle('qc-ctl-busy', !!this.ctlBusy);
            if (body.dataset.sig === sigNow && body.querySelector('.qc-xcol')) return;
            body.dataset.sig = sigNow;
            body.innerHTML = `
                ${c.power ? `<div class="qc-xcol"><span class="qc-xl">POWER ${lamp(c.power.status)}</span><span class="qc-xkeys">${keys(c.power, 'power')}</span></div>` : ''}
                ${c.game ? `<div class="qc-xcol qc-xcol-game"><span class="qc-xl">GAME</span><button type="button" class="qc-bk qc-xk qc-xwide qc-xgame k-blue" data-xl="game"><span>${esc(c.game.status ? c.game.status.text : 'Select...')}</span><i></i></button></div>` : ''}`;
            body.querySelectorAll('.qc-xk').forEach((b) => { b.disabled = !!this.ctlBusy; });
            const gb = body.querySelector('[data-xl="game"]');
            if (gb && root.contextMenu && root.contextMenu.attachPickerMenu) {
                root.contextMenu.attachPickerMenu(gb, {
                    items: () => (this.controls && this.controls.game ? this.controls.game.options.map((o, i) => ({ value: i, text: o.text })) : []),
                    value: () => {
                        const g = this.controls && this.controls.game;
                        const cur = g && g.status ? g.status.text.toLowerCase() : '';
                        const i = g ? g.options.findIndex((o) => o.text.toLowerCase() === cur) : -1;
                        return i < 0 ? null : i;
                    },
                    onSelect: (v) => void this.xlinkPress('game', Number(v))
                });
            }
        }

        /** The deck's VIDEO bus: big backlit GAME / V-BLK (Nostalgia PAN / NBT / V-BLK) keys and RESET ENC. */
        renderVideoBus(c, keys) {
            const bus = this.el('.qc-vkeys');
            const v = c && c.video;
            const sig = v ? JSON.stringify([c.cabinet, v.buttons, !!v.resetPath, !!this.ctlBusy]) : '';
            if (bus.dataset.sig === sig && bus.children.length) return;
            bus.dataset.sig = sig;
            bus.innerHTML = v ? keys(v, 'video', 'qc-vk') : '<span class="qc-bus-none">NO VIDEO CONTROL</span>'; // RESET is on the unit's front panel
            bus.querySelectorAll('button').forEach((b) => { b.disabled = !!this.ctlBusy; });
            this.litVideoBus();
        }

        /**
         * Light the VIDEO bus key for the cabinet mixer's current state: XLink's own report when it has one,
         * else the mixer's program scene (a cleared / blank / break scene = V-BLK, anything else = GAME).
         * The bus label carries the mixer's program scene.
         */
        litVideoBus() {
            const c = this.controls;
            const v = c && c.cabinet === this.cabinet && c.video;
            const st = this.st || {};
            const pgm = st.diag && st.diag.input && st.diag.input.program;
            const label = this.el('.qc-vbus .qc-bus-label');
            if (label) label.innerHTML = pgm ? `VIDEO <small>PGM ${esc(pgm)}</small>` : 'VIDEO';
            if (!v) return;
            let on = v.buttons.findIndex((b) => b.active);
            if (on < 0 && pgm) {
                const blank = /clear|blank|break|v-?blk|black|standby/i.test(pgm);
                on = v.buttons.findIndex((b) => (blank ? /v-?blk|blank/i : /game|auto/i).test(b.label));
            }
            this.el('.qc-vkeys').querySelectorAll('[data-xl="video"]').forEach((k) => {
                const lit = Number(k.dataset.n) === on;
                k.classList.toggle('is-on', lit);
            });
        }

        /** Press a cabinet control: power and RESET ENC are confirmed (then XLink's own warning); video and game switch at once. */
        async xlinkPress(kind, n) {
            const c = this.controls;
            if (!c || this.ctlBusy) return;
            const name = c.device.name;
            const live = !!(this.st && this.st.stream && this.st.stream.active);
            let req;
            let ask = '';
            if (kind === 'video') {
                const b = c.video.buttons[n];
                req = { path: c.video.path, op: 'toggle', value: n };
            } else if (kind === 'reset') {
                req = { path: c.video.resetPath, op: 'send' };
                ask = `Reset ${name}'s video encoder?${live ? '\n\nYou are live: the picture drops out for a few seconds.' : ''}`;
            } else if (kind === 'power') {
                const b = c.power.buttons[n];
                req = { path: c.power.path, op: 'toggle', value: n };
                ask = `Set ${name}'s power to ${b.label === 'I' ? 'ON (I)' : b.label === 'O' ? 'OFF (O)' : b.label === 'STB' ? 'STANDBY' : b.label}?`;
            } else if (kind === 'game') {
                const o = c.game.options[n];
                req = { path: o.path, op: 'send' };
            } else return;
            if (ask && !await this.ask(ask)) return false;
            this.ctlBusy = true;
            this.renderControls();
            try {
                // power and RESET ENC ask first (above, plus XLink's own warnings); video and game switch at once
                let r = await this.send('quickcast_cabinet_action', { cabinet: this.cabinet, ...req, confirmed: kind === 'video' || kind === 'game' });
                if (r.confirm) {
                    const v = await this.box(`${r.confirm.header}\n\n${r.confirm.message}`, 'warning', [{ text: r.confirm.ok || 'OK', value: 'yes', className: 'btn-standard' }, { text: 'Cancel', value: null, className: 'btn-standard primary' }]);
                    if (v !== 'yes') return false;
                    r = await this.send('quickcast_cabinet_action', { cabinet: this.cabinet, ...req, confirmed: true });
                }
                if (r.controls) this.controls = r.controls;
                if (r.ok === false) { await this.box(`${name} did not accept the command.\n\n${r.failure || ''}`, 'error'); return false; }
                this.flash(`${name}: done.`);
                return true;
            } catch (err) {
                await this.box(err.message, 'error');
                return false;
            } finally {
                this.ctlBusy = false;
                this.renderControls();
            }
        }

        /** The link viewers open: QuickCast's broadcast, else the saved watch page, else the channel's /live. */
        streamUrl() {
            const st = this.st;
            if (!st) return '';
            const yt = st.youtube || {};
            if (yt.broadcast && yt.broadcast.shortUrl) return yt.broadcast.shortUrl;
            if (st.watchUrl) return st.watchUrl;
            const p = yt.account && yt.account.profile;
            return p ? (p.handle ? `https://www.youtube.com/${p.handle}/live` : `https://www.youtube.com/channel/${p.id}/live`) : '';
        }

        async copyUrl() {
            const url = this.streamUrl();
            if (!url) return;
            let ok = false;
            try { await root.navigator.clipboard.writeText(url); ok = true; } catch (_) {
                const t = doc.createElement('textarea');
                t.value = url;
                t.style.cssText = 'position:fixed;left:-9999px';
                doc.body.appendChild(t);
                t.select();
                try { ok = doc.execCommand('copy'); } catch (__) { ok = false; }
                t.remove();
            }
            const b = this.el('.qc-copy');
            if (ok) { b.textContent = 'COPIED!'; b.classList.add('is-done'); setTimeout(() => { b.textContent = 'COPY WATCH LINK'; b.classList.remove('is-done'); }, 1500); this.flash(`Copied ${url}`); } else await this.box(`Copy this link:\n\n${url}`, 'info');
        }

        /** The channel chip's menu: saved channels (switch), add one, sign out, account settings. */
        channelItems() {
            const a = (this.st && this.st.youtube && this.st.youtube.account) || {};
            const live = !!(this.st && this.st.stream && this.st.stream.active);
            const items = (a.channels || []).map((c) => ({ text: `${c.active ? '\u2713 ' : ''}${c.title}`, subtext: c.handle || '', action: `ch:${c.id}`, disabled: c.active || live }));
            if (items.length) items.push({ separator: true });
            items.push({ text: 'Add Channel...', action: 'add', disabled: !a.client || live });
            if (a.signedIn) items.push({ text: 'Sign Out of This Channel', action: 'out', disabled: live });
            items.push({ separator: true }, { text: 'Account Settings...', action: 'acct' });
            return items;
        }

        async channelAction(act) {
            const a = (this.st && this.st.youtube && this.st.youtube.account) || {};
            if (act === 'acct') this.settingsWin('account');
            else if (act === 'add') {
                this.settingsWin('account');
                setTimeout(() => { const w = [...this.children].find((c) => c.kind === 'settings'); const b = w && w.modal.querySelector('[data-act="signin"]'); if (b && !b.disabled) b.click(); }, 800);
            } else if (act === 'out') {
                if (await this.ask(`Sign VisionCaster out of ${a.profile ? a.profile.title : 'this channel'}?`)) await this.send('quickcast_yt_signout', {}).catch((e) => this.box(e.message, 'error'));
            } else if (String(act).startsWith('ch:')) {
                try { await this.send('quickcast_yt_select', { channelId: act.slice(3) }); await this.send('quickcast_yt_profile', {}); this.flash('Channel switched.'); } catch (e) { await this.box(e.message, 'error'); }
            }
        }

        async saveTitle() {
            const t = this.el('.qc-title').value.trim();
            if (!t) return;
            try { await this.send('quickcast_yt_settings', { title: t }); this.titleDirty = false; } catch (err) { this.flash(err.message); }
        }

        async updateLiveTitle() {
            const t = this.el('.qc-title').value.trim();
            if (!t) return;
            this.setBusy('Changing the live title...');
            try {
                const r = await this.send('quickcast_yt_settings', { title: t, applyLive: true });
                this.titleDirty = false;
                this.setBusy('');
                this.flash(r.updatedLive ? 'The live title is changed.' : 'Saved for the next stream.');
            } catch (err) { this.setBusy(''); await this.box(err.message, 'error'); }
        }

        /** Broadcast Settings: Broadcast | Encoder | Account tabs. */
        settingsWin(tab) {
            const open = [...this.children].find((c) => c.kind === 'settings');
            if (open) { open.showTab(tab); call('bringModalToFront', open.modal); return; }
            const CATS = [['20', 'Gaming'], ['24', 'Entertainment'], ['10', 'Music'], ['22', 'People & Blogs'], ['28', 'Science & Technology'], ['1', 'Film & Animation']];
            const opt = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('');
            const w = this.openWin({
                kind: 'settings', title: 'Broadcast Settings', width: 560, cls: 'qc-settings',
                body: `<div class="qc-tabs"><button type="button" class="qc-tab" data-tab="broadcast">Broadcast</button><button type="button" class="qc-tab" data-tab="encoder">Encoder</button><button type="button" class="qc-tab" data-tab="account">Account</button></div>
                    <div class="qc-pane" data-pane="broadcast"><p class="qc-dim qc-loading">Loading...</p></div>
                    <div class="qc-pane" data-pane="encoder"><p class="qc-dim qc-loading">Reading the satellite encoder...</p></div>
                    <div class="qc-pane" data-pane="account"><p class="qc-dim qc-loading">Loading...</p></div>`,
                buttons: [{ text: 'Apply', value: 'apply', def: true }, { text: 'Close', value: 'cancel' }],
                onButton: async (v) => { if (v === 'apply') await apply(); return false; }
            });
            w.kind = 'settings';
            const m = w.modal;
            const pane = (n) => m.querySelector(`[data-pane="${n}"]`);
            w.showTab = (n) => {
                w.tab = n;
                m.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === n));
                m.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== n; });
                if (n === 'encoder' && !w.encLoaded) void loadEncoder();
            };
            m.addEventListener('click', (ev) => { const b = ev.target.closest('[data-tab]'); if (b) w.showTab(b.dataset.tab); });

            const fillBroadcast = (last) => {
                pane('broadcast').innerHTML = `
                    <label class="qc-field"><span>Title</span><input type="text" class="qc-s-title" maxlength="100" value="${esc(last.title)}"></label>
                    <label class="qc-field"><span>Description</span><textarea class="qc-s-desc" rows="5" maxlength="5000">${esc(last.description)}</textarea></label>
                    <div class="qc-grid">
                        <label class="qc-field"><span>Privacy</span><select class="qc-s-priv">${opt([['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Private']], last.privacy)}</select></label>
                        <label class="qc-field"><span>Category</span><select class="qc-s-cat">${opt(CATS, last.categoryId)}</select></label>
                        <label class="qc-field"><span>Latency</span><select class="qc-s-lat">${opt([['normal', 'Normal'], ['low', 'Low'], ['ultraLow', 'Ultra-low']], last.latency)}</select></label>
                    </div>
                    <label class="qc-check"><input type="checkbox" class="qc-s-dvr"${last.dvr ? ' checked' : ''}> DVR (viewers can rewind)</label>
                    <label class="qc-check"><input type="checkbox" class="qc-s-kids"${last.madeForKids ? ' checked' : ''}> Made for kids</label>
                    <p class="qc-dim">Used for the next LIVE when VisionCaster is signed in to YouTube. While live, Apply also changes the live title, description and category (privacy, latency and DVR apply next time).</p>`;
            };
            const fillAccount = (a, signIn) => {
                const st = this.st || { key: {} };
                pane('account').innerHTML = `
                    <div class="qc-group"><b>Stream key</b>
                        <p>The persistent key from YouTube Studio (Go live &gt; Stream &gt; Stream key). Kept on the Dreamscape server and loaded into the satellite encoder's uplink when you go live.</p>
                        <label class="qc-field"><span>Stream key</span><input type="password" class="qc-a-key" autocomplete="off" spellcheck="false" placeholder="${st.key.set ? `Saved: ${esc(st.key.hint)} (blank keeps it)` : 'xxxx-xxxx-xxxx-xxxx-xxxx'}"></label>
                        <label class="qc-field"><span>Watch page (optional)</span><input type="text" class="qc-a-url" spellcheck="false" value="${esc(st.watchUrl || '')}" placeholder="https://www.youtube.com/@channel/live"></label>
                    </div>
                    <div class="qc-group"><b>YouTube API</b>
                        <p>From your Google Cloud project (the StickerBoard one is fine) with YouTube Data API v3 on. The API key reads chat; the OAuth client (type <i>TVs and Limited Input devices</i>) lets VisionCaster set the title and reply in chat. Blank keeps a saved value.</p>
                        <label class="qc-field"><span>API key ${a.apiKey ? '(saved)' : ''}</span><input type="password" class="qc-a-api" autocomplete="off" spellcheck="false" placeholder="${a.apiKey ? 'Saved (blank keeps it)' : 'AIza...'}"></label>
                        <div class="qc-grid2">
                            <label class="qc-field"><span>OAuth client ID ${a.client ? '(saved)' : ''}</span><input type="text" class="qc-a-cid" autocomplete="off" spellcheck="false" placeholder="${a.clientId ? esc(a.clientId) : '....apps.googleusercontent.com'}"></label>
                            <label class="qc-field"><span>OAuth client secret</span><input type="password" class="qc-a-csec" autocomplete="off" spellcheck="false" placeholder="${a.client ? 'Saved (blank keeps it)' : 'GOCSPX-...'}"></label>
                        </div>
                        <label class="qc-field"><span>Channel ID (only for reading chat without sign-in)</span><input type="text" class="qc-a-ch" spellcheck="false" placeholder="${a.channelId ? esc(a.channelId) : 'UC...'}"></label>
                    </div>
                    <div class="qc-group qc-signin"><b>YouTube channels</b>
                        ${(a.channels || []).map((c) => `<div class="qc-prof${c.active ? ' is-active' : ''}">
                            ${c.avatar ? `<img class="qc-prof-av" src="${esc(c.avatar)}" alt="" width="40" height="40" referrerpolicy="no-referrer">` : '<span class="qc-prof-av"></span>'}
                            <span class="qc-prof-text"><b>${esc(c.title)}</b><small>${esc(c.handle || c.id)}</small><small>${c.subscribers == null ? 'Subscribers hidden' : `${c.subscribers.toLocaleString('en-US')} subscribers`} \u00b7 ${c.videos.toLocaleString('en-US')} videos</small></span>
                            <span class="qc-fill"></span>
                            ${c.active ? '<span class="qc-prof-on">STREAMS HERE</span>' : `<button type="button" class="qc-btn" data-act="select" data-ch="${esc(c.id)}">Use</button>`}
                            <button type="button" class="qc-btn" data-act="signout" data-ch="${esc(c.id)}">Sign Out</button></div>`).join('') || `<p>${a.client ? 'No channel signed in.' : 'Save the OAuth client first.'}</p>`}
                        <div class="qc-signin-row"><span class="qc-dim">Google asks which channel (brand accounts too) when you add one.</span><span class="qc-fill"></span><button type="button" class="qc-btn" data-act="signin"${a.client ? '' : ' disabled'}>Add Channel...</button></div>
                        <div class="qc-code" hidden></div>
                    </div>`;
                if (signIn && signIn.state === 'waiting') showCode(signIn);
            };
            const showCode = (si) => {
                const c = pane('account').querySelector('.qc-code');
                if (!c) return;
                c.hidden = false;
                c.innerHTML = `On any device, open <a href="${esc(si.url)}" target="_blank" rel="noopener">${esc(si.url.replace(/^https?:\/\//, ''))}</a> and enter<div class="qc-usercode">${esc(si.userCode)}</div><span class="qc-dim">Waiting for Google...</span>`;
            };
            const loadAccount = async () => {
                try {
                    await this.send('quickcast_yt_profile', {}).catch(() => {});
                    const r = await this.send('quickcast_yt_account', {});
                    fillAccount(r.account, r.signIn);
                    if (!w.bcLoaded) { fillBroadcast(r.last); w.bcLoaded = true; }
                } catch (err) { pane('account').innerHTML = `<p class="qc-bad">${esc(err.message)}</p>`; }
            };
            const loadEncoder = async () => {
                w.encLoaded = true;
                try {
                    const e = await this.send('quickcast_encoder', {});
                    pane('encoder').innerHTML = `
                        <div class="qc-grid">
                            <label class="qc-field"><span>Video bitrate (kb/s)</span><input type="number" class="qc-e-br" min="500" max="51000" step="500" value="${e.bitrate}"></label>
                            <label class="qc-field"><span>Rate control</span><select class="qc-e-rc">${opt([['CBR', 'CBR (constant)'], ['VBR', 'VBR (variable)']], e.rateControl)}</select></label>
                            <label class="qc-field"><span>Audio bitrate (kb/s)</span><select class="qc-e-ab">${opt(e.audioRates.map((n) => [n, String(n)]), e.audioBitrate)}</select></label>
                            <label class="qc-field"><span>Resolution</span><select class="qc-e-h">${opt(e.heights.map((h) => [h, `${h}p`]), e.height)}</select></label>
                            <label class="qc-field"><span>Frame rate</span><select class="qc-e-fps">${opt([[30, '30 fps'], [60, '60 fps']], e.fps)}</select></label>
                        </div>
                        <div class="qc-presets"><span class="qc-dim">YouTube suggests:</span>
                            <button type="button" class="qc-btn" data-preset="720,30,4000">720p30 4 Mb</button>
                            <button type="button" class="qc-btn" data-preset="1080,30,8000">1080p30 8 Mb</button>
                            <button type="button" class="qc-btn" data-preset="1080,60,12000">1080p60 12 Mb</button>
                            <button type="button" class="qc-btn" data-preset="1440,60,24000">1440p60 24 Mb</button></div>
                        <p class="qc-dim">The satellite's hardware encoder (NVENC). Not while live. The uplink must carry the bitrate with room to spare; watch NETWORK in the OUTPUT row once live.</p>`;
                    pane('encoder').addEventListener('click', (ev) => {
                        const b = ev.target.closest('[data-preset]');
                        if (!b) return;
                        const [h, f, br] = b.dataset.preset.split(',');
                        pane('encoder').querySelector('.qc-e-h').value = h;
                        pane('encoder').querySelector('.qc-e-fps').value = f;
                        pane('encoder').querySelector('.qc-e-br').value = br;
                    });
                } catch (err) { w.encLoaded = false; pane('encoder').innerHTML = `<p class="qc-bad">${esc(err.message)}</p><p class="qc-dim">The satellite\'s encoder engine must be running to read the encoder.</p>`; }
            };
            pane('account').addEventListener('click', async (ev) => {
                const b = ev.target.closest('[data-act]');
                if (!b) return;
                if (b.dataset.act === 'select' || b.dataset.act === 'signout') {
                    if (this.st && this.st.stream && this.st.stream.active) { await this.box('Stop the stream before changing channels.', 'warning'); return; }
                    try {
                        await this.send('quickcast_yt_select', { channelId: b.dataset.ch });
                        if (b.dataset.act === 'signout') {
                            if (!await this.ask('Sign VisionCaster out of this channel?')) { void loadAccount(); return; }
                            await this.send('quickcast_yt_signout', {});
                        }
                        await this.send('quickcast_yt_profile', {}).catch(() => {});
                    } catch (err) { await this.box(err.message, 'error'); }
                    void loadAccount();
                    return;
                }
                b.disabled = true;
                try {
                    const si = await this.send('quickcast_yt_signin', {});
                    showCode(si);
                    const poll = async () => {
                        if (!m.isConnected) return;
                        const r = await this.send('quickcast_yt_signin_state', {}).catch(() => null);
                        if (!r || r.signIn.state === 'waiting') { setTimeout(poll, 3000); return; }
                        if (r.signIn.state === 'failed') await this.box(`YouTube sign-in failed: ${r.signIn.error}`, 'error');
                        else this.flash(`Signed in to YouTube${r.account.channel ? `: ${r.account.channel}` : ''}.`);
                        void loadAccount();
                    };
                    setTimeout(poll, 3000);
                } catch (err) { b.disabled = false; await this.box(err.message, 'error'); }
            });

            const val = (sel) => { const e = m.querySelector(sel); return e ? e.value.trim() : ''; };
            const apply = async () => {
                const live = !!(this.st && this.st.stream && this.st.stream.active);
                try {
                    if (w.tab === 'broadcast') {
                        if (!m.querySelector('.qc-s-title')) return;
                        const r = await this.send('quickcast_yt_settings', {
                            title: val('.qc-s-title'), description: m.querySelector('.qc-s-desc').value, privacy: val('.qc-s-priv'), categoryId: val('.qc-s-cat'),
                            latency: val('.qc-s-lat'), dvr: m.querySelector('.qc-s-dvr').checked, madeForKids: m.querySelector('.qc-s-kids').checked, applyLive: live
                        });
                        this.titleDirty = false;
                        this.el('.qc-title').value = r.last.title;
                        this.flash(r.updatedLive ? 'Broadcast settings saved and the live video updated.' : 'Broadcast settings saved for the next stream.');
                    } else if (w.tab === 'encoder') {
                        if (!m.querySelector('.qc-e-br')) return;
                        if (live) { await this.box('Stop the stream before changing the encoder.', 'warning'); return; }
                        w.busy(true);
                        this.setBusy(`Loading the encoder settings into ${this.satName()}...`);
                        let r;
                        try {
                            r = await this.send('quickcast_setencoder', { bitrate: Number(val('.qc-e-br')), rateControl: val('.qc-e-rc'), audioBitrate: Number(val('.qc-e-ab')), height: Number(val('.qc-e-h')), fps: Number(val('.qc-e-fps')) });
                        } finally { this.setBusy(''); w.busy(false); }
                        if (r.videoPending) await this.box(`Bitrates are set. The new resolution / frame rate is stored in ${this.satName()}'s output preset and takes effect the next time its encoder engine starts: an always-on output (NDI) holds the video pipeline until then.`, 'info');
                        else this.flash('Encoder settings applied.');
                    } else if (w.tab === 'account') {
                        const key = val('.qc-a-key');
                        await this.send('quickcast_setkey', { key: key || undefined, watchUrl: val('.qc-a-url') });
                        const cred = { apiKey: val('.qc-a-api') || undefined, clientId: val('.qc-a-cid') || undefined, clientSecret: val('.qc-a-csec') || undefined, channelId: val('.qc-a-ch') || undefined };
                        if (Object.values(cred).some(Boolean)) await this.send('quickcast_yt_credentials', cred);
                        this.flash('Account settings saved.');
                        void loadAccount();
                    }
                } catch (err) { await this.box(err.message, 'error'); }
            };
            w.showTab(tab || 'broadcast');
            void loadAccount();
        }

        /** Live Chat: its own resizable window; messages twice a second from the server's reader. */
        /**
         * The box remote: the menus are drawn by the box itself, in its video output (avOsd.js), the way a
         * hardware mixer draws its OSD; this is only the remote. The monitor shows the cabinet's picture
         * (its NDI feed on the satellite), so the cabinet OSD is seen there; the satellite OSD sits on the
         * satellite's program output.
         */
        remoteWin() {
            const open = [...this.children].find((c) => c.kind === 'remote');
            if (open) { call('bringModalToFront', open.modal); return; }
            const key = (k, label, cls) => `<button type="button" class="qc-bk qc-rk ${cls || 'k-white'}" data-rk="${k}">${label}</button>`;
            // the unit's front panel, as on the box: dot-matrix display, then
            //   POWER / ALARM leds | gap | MENU  | D-pad | EXIT
            //   RESET              | gap | INFO  | D-pad | DIAG
            const w = this.openWin({
                kind: 'remote', title: 'Remote Front Panel', width: 1120, height: 200, cls: 'qc-remotewin',
                body: `<div class="qc-fp">
                    <div class="qc-fp-sel"><button type="button" class="qc-bk qc-rsel k-white" data-target="cab">CABINET MIXER</button><button type="button" class="qc-bk qc-rsel k-white" data-target="sat">SATELLITE</button></div>
                    <div class="qc-fp-face">
                        <span class="qc-fp-ear"><i></i><i></i></span>
                        <div class="qc-fp-disp">
                            <div class="qc-fp-badge"><img class="qc-fp-logo" alt=""><span class="qc-fp-model"></span><span class="qc-fp-type"></span></div>
                            <canvas class="qc-fp-dm" width="360" height="81"></canvas>
                        </div>
                        <div class="qc-fp-ctl">
                            <div class="qc-fp-leds"><span class="qc-led" data-led="power"><i></i>POWER</span><span class="qc-led" data-led="alarm"><i></i>ALARM</span></div>
                            <div class="qc-fp-btns"><button type="button" class="qc-bk qc-fp-key k-red qc-fp-reset" data-rk="reset" title="Reset the unit">RESET</button><button type="button" class="qc-bk qc-fp-key k-green qc-fp-pwr" data-rk="power" title="Encoder engine power">PWR</button><button type="button" class="qc-bk qc-fp-key k-blue qc-fp-xl" data-rk="xlink" title="XLink: the cabinet's controls (power, volume, ...) on the unit's OSD" aria-label="XLink"><img class="qc-fp-xlogo" src="${A}/xlink-logo.png" alt="XLink" width="38" height="11"></button></div>
                            <span class="qc-fp-gap"></span>
                            ${key('menu', 'MENU', 'k-amber qc-fp-menu')}${key('info', 'INFO', 'k-white qc-fp-info')}
                            <div class="qc-rm-pad">${key('up', '&#9650;', 'is-up k-white')}${key('left', '&#9664;', 'is-left k-white')}${key('ok', 'OK', 'is-ok k-blue')}${key('right', '&#9654;', 'is-right k-white')}${key('down', '&#9660;', 'is-down k-white')}</div>
                            ${key('exit', 'EXIT', 'k-white qc-fp-exit')}${key('diag', 'DIAG', 'k-white qc-fp-diag')}
                        </div>
                        <div class="qc-fp-ind"></div>
                        <span class="qc-fp-ear"><i></i><i></i></span>
                    </div>
                </div>`,
                buttons: []
            });
            w.kind = 'remote';
            const m = w.modal;
            let target = this.remoteTarget || 'cab';
            let dmColor = '#ffb02e';
            const dm = (l1, l2, l3) => drawDotMatrix(m.querySelector('.qc-fp-dm'), [l1, l2, l3], dmColor);
            const lcd = (v, err) => {
                const unit = v && v.box ? v.box.name : target === 'sat' ? this.satName() : (this.cabinet ? 'CABINET MIXER' : 'NO CABINET');
                if (v && v.box) {
                    const logo = m.querySelector('.qc-fp-logo');
                    const art = `${A}/unit-${v.box.theme === 'amuvision' ? 'amuvision' : 'takao'}.png`;
                    if (logo.getAttribute('src') !== art) logo.setAttribute('src', art);
                    logo.alt = [v.box.maker, v.box.line].filter(Boolean).join(' ');
                    m.querySelector('.qc-fp-model').textContent = v.box.model || '';
                    m.querySelector('.qc-fp-type').textContent = v.box.type || '';
                    m.querySelector('.qc-fp-face').dataset.theme = v.box.theme || '';
                }
                if (resetting) return; // the panel is running its reset / lamp test
                dmColor = '#ffb02e';
                if (err) { dmColor = '#ff5a3a'; dm(unit, 'ERROR', err); return; }
                if (v && v.toast) { dm(unit, v.toast.slice(0, 20), v.toast.slice(20, 40)); return; }
                if (v && v.standby && !(v.open && v.page)) { dmColor = '#ffb028'; dm(unit, v.standby.phase === 'boot' ? 'STANDBY BOOT...' : 'STANDBY MODE', ''); return; }
                if (v && v.post) { if (v.post.phase === 'fault') dmColor = '#ff5a3a'; dm(v.post.phase === 'fault' ? 'FAULT - DO NOT AIR' : 'SELF TEST', (v.post.text || '').slice(0, 20), (v.post.text || '').slice(20, 40)); return; }
                if (v && v.open && v.page) {
                    if (v.page.id === 'xlink') dmColor = '#5fd0ff';
                    const r = (v.page.rows || [])[v.page.cursor - (v.page.first || 0)] || {};
                    dm(v.page.title, `\u25ba${r.label || ''}`, r.value ? `  ${r.value}` : '');
                    return;
                }
                const st = this.st || {};
                const row = (target === 'sat' ? (st.diag && st.diag.output) : (st.diag && st.diag.input)) || {};
                const clk = (row.stages || []).find((x) => x.id === 'clock');
                const mix = (row.stages || []).find((x) => x.id === (target === 'sat' ? 'render' : 'mixer'));
                const pgm = target === 'sat' ? st.program : row.program;
                const onAir = target === 'sat' && st.stream && st.stream.active;
                dm(`${unit}${onAir ? ' ON AIR' : ''}`, pgm ? `PGM ${pgm}` : (v && v.info ? 'STATUS STRIP ON' : 'READY'), [clk && clk.value, mix && mix.value.replace(/\s*fps\s*\u00b7\s*/i, 'FPS ').replace(/\s*ms$/i, 'MS')].filter(Boolean).join(' '));
            };
            // POWER / ALARM leds from the window's status: power = control link to the unit; alarm = a latched
            // self-test fault (blinks), or a failing pipeline stage on that unit (steady)
            let resetting = false;
            let lastView = null;
            const leds = () => {
                if (!m.isConnected) return;
                if (resetting) { setTimeout(leds, 500); return; }
                // follow the unit's own state (standby, self test, faults) even when no key is pressed
                if (!inFlight && Date.now() - (this.fpViewAt || 0) > 3000 && (target === 'sat' || this.cabinet)) {
                    this.fpViewAt = Date.now();
                    void this.send('quickcast_osd_view', { target, cabinet: this.cabinet || '' }).then((v) => { if (!inFlight) lastView = v; }).catch(() => {});
                }
                if (lastView === null || !(lastView.open || lastView.post || lastView.toast)) lcd(lastView);
                const st = this.st || {};
                const d = st.diag || {};
                const sat = target === 'sat';
                const rowSt = (sat ? d.output : d.input) || {};
                const linkSt = sat ? (st.obs && st.obs.state) : ((rowSt.stages || []).some((x) => x.id === 'mixer') ? 'online' : (rowSt.stages || []).some((x) => x.id === 'link' && x.state === 'bad') ? 'offline' : 'unknown');
                const machine = rowSt.source;
                const fault = (st.faults || []).find((f) => (sat ? f.kind === 'satellite' : f.machine === machine) && !f.overridden);
                const bad = (rowSt.stages || []).some((x) => x.state === 'bad');
                const pw = m.querySelector('[data-led="power"]');
                pw.className = `qc-led ${lastView && lastView.standby && !sat ? 'is-amber' : linkSt === 'online' ? 'is-green' : linkSt === 'launching' || linkSt === 'stopping' ? 'is-amber is-blink' : linkSt === 'offline' ? 'is-red' : ''}`;
                const al = m.querySelector('[data-led="alarm"]');
                const inStandby = !!(lastView && lastView.standby && !sat);
                al.className = `qc-led ${inStandby ? '' : fault ? 'is-red is-blink' : bad ? 'is-red' : ''}`; // no alarm states in standby
                m.classList.toggle('qc-fp-sat', sat);
                // the unit's own indicators: each pipeline stage it owns, plus the satellite's air / uplink lamps
                const stg = (id) => (rowSt.stages || []).find((x) => x.id === id);
                const tone = (x) => (!x ? '' : x.state === 'ok' ? 'is-green' : x.state === 'warn' ? 'is-amber' : x.state === 'bad' ? 'is-red' : '') + (x && x.blink ? ' is-blink' : '');
                const live = !!(st.stream && st.stream.active);
                const lamps = sat ? [
                    ['ON AIR', live ? (st.stream.reconnecting ? 'is-red is-blink' : 'is-red') : ''],
                    ['UPLINK', !st.key || !st.key.set ? 'is-red' : live ? (st.stream.reconnecting ? 'is-amber is-blink' : 'is-green') : 'is-amber'],
                    ['NDI RX', tone(stg('rx'))], ['CLOCK', tone(stg('clock'))], ['RENDER', tone(stg('render'))],
                    ['ENCODE', tone(stg('encoder'))], ['NETWORK', tone(stg('network'))], ['BROADCAST', tone(stg('youtube'))]
                ] : [
                    ['SIGNAL', tone(stg('capture'))], ['CLOCK', tone(stg('clock'))], ['MIXER', tone(stg('mixer'))],
                    ['NDI OUT', tone(stg('ndiout'))], ['LINK', tone(stg('link'))], ['LOCK', tone(stg('lock'))]
                ];
                // standby: the low-power image runs no pipeline, so the unit's stage leds are dark
                if (lastView && lastView.standby && !sat) lamps.forEach((l) => { l[1] = ''; });
                const ind = m.querySelector('.qc-fp-ind');
                const html = lamps.map(([n, c]) => `<span class="qc-led ${c}"><i></i>${n}</span>`).join('');
                if (ind.dataset.html !== html) { ind.dataset.html = html; ind.innerHTML = html; }
                const pwr = m.querySelector('.qc-fp-pwr');
                pwr.hidden = !sat;
                m.querySelector('.qc-fp-xl').hidden = sat;
                m.querySelector('.qc-fp-xl').classList.toggle('is-on', !!(lastView && lastView.open && lastView.page && lastView.page.id === 'xlink'));
                pwr.classList.toggle('is-on', sat && linkSt === 'online');
                pwr.title = sat ? (linkSt === 'online' ? `Shut down ${this.satName()}'s encoder engine` : `Start ${this.satName()}'s encoder engine`) : '';
                setTimeout(leds, 500);
            };
            const sel = () => {
                m.querySelectorAll('.qc-rsel').forEach((b) => { b.classList.toggle('is-on', b.dataset.target === target); b.classList.toggle('k-orange', b.dataset.target === target); b.classList.toggle('k-white', b.dataset.target !== target); });
                lcd(null);
                void this.send('quickcast_osd_view', { target, cabinet: this.cabinet || '' }).then((v) => { lastView = v; lcd(v); }).catch((e) => lcd(null, e.message));
            };
            // one key on the wire at a time, plus at most one waiting: a held key never piles up
            let inFlight = false;
            let next = null;
            const press = async (k) => {
                if (target === 'cab' && !this.cabinet) { lcd(null, 'Take a cabinet first'); return; }
                const b = m.querySelector(`[data-rk="${k}"]`);
                if (b) { b.classList.add('is-on'); setTimeout(() => b.classList.remove('is-on'), 110); }
                if (inFlight) { next = k; return; }
                inFlight = true;
                try { lastView = await this.send('quickcast_osd_key', { target, cabinet: this.cabinet || '', key: k }); lcd(lastView); } catch (e) { lcd(null, e.message); }
                inFlight = false;
                if (next) { const n = next; next = null; void press(n); }
            };
            m.querySelectorAll('.qc-rsel').forEach((b) => b.addEventListener('click', () => { target = b.dataset.target; this.remoteTarget = target; sel(); }));
            m.querySelectorAll('[data-rk]').forEach((b) => b.addEventListener('click', () => {
                if (b.dataset.rk === 'reset') void this.unitReset(target).then((done) => { if (done) void panelReset(); });
                else if (b.dataset.rk === 'xlink') void press('xlink'); // the unit draws the XLINK menu on its output
                else if (b.dataset.rk === 'power') void this.command(this.st && this.st.obs && this.st.obs.state === 'online' ? 'obsoff' : 'obson');
                else void press(b.dataset.rk);
            }));
            // a hardware reset of the panel itself: everything dark, then the lamp / display test, then boot
            const panelReset = async () => {
                if (resetting) return;
                resetting = true;
                const face = m.querySelector('.qc-fp-face');
                const cv = m.querySelector('.qc-fp-dm');
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                face.classList.add('is-dark');
                drawDotMatrix(cv, ['', '', ''], '#000');
                await wait(1200);
                face.classList.remove('is-dark');
                face.classList.add('is-lamptest');
                const full = '\u2588'.repeat(DM_COLS);
                drawDotMatrix(cv, [full, full, full], '#ffb02e');
                await wait(900);
                for (const c of ['is-test-red', 'is-test-green', 'is-test-amber']) { face.classList.add(c); await wait(350); face.classList.remove(c); }
                face.classList.remove('is-lamptest');
                const u = lastView && lastView.box ? lastView.box : {};
                drawDotMatrix(cv, [[u.maker, u.model].filter(Boolean).join(' ') || 'NETWORK VIDEO MIXER', 'BOOTING...', ''], '#ffb02e');
                await wait(1500);
                drawDotMatrix(cv, [[u.maker, u.model].filter(Boolean).join(' '), 'SELF TEST', ''], '#ffb02e');
                await wait(1200);
                resetting = false;
                lcd(lastView);
            };
            leds();
            const keymap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'exit', m: 'menu', d: 'diag', i: 'info', x: 'xlink' };
            m.addEventListener('keydown', (e) => {
                const k = keymap[e.key];
                if (!k || e.target.closest('input, textarea')) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.repeat && k !== 'up' && k !== 'down' && k !== 'left' && k !== 'right') return; // only the D-pad repeats
                if (e.repeat && inFlight) return;
                void press(k);
            });
            m.tabIndex = -1;
            sel();
        }

        /** Front panel RESET: a cabinet mixer resets through XLink (VISION Control > Reset Encoder); the
         *  satellite restarts its encoder engine (refused on air). Both ask first. */
        async unitReset(target) {
            if (target !== 'sat') {
                if (!this.cabinet) { await this.box('Take a cabinet first.', 'info'); return; }
                if (!this.controls || this.controls.cabinet !== this.cabinet) await this.loadControls(true);
                if (!this.controls || !this.controls.video || !this.controls.video.resetPath) { await this.box('This cabinet\'s mixer has no reset control in XLink.', 'warning'); return; }
                return this.xlinkPress('reset');
            }
            const live = !!(this.st && this.st.stream && this.st.stream.active);
            if (live) { await this.box('On air: end the broadcast before resetting the satellite.', 'warning'); return false; }
            if (!await this.ask(`Reset ${this.satName()}?\n\nIts encoder engine shuts down and starts again (boot screen and self test).`)) return false;
            await this.run(`Resetting ${this.satName()}...`, 'quickcast_obs_off', {});
            void this.run(`Starting ${this.satName()}...`, 'quickcast_launch', {});
            return true;
        }

        chatWin() {
            const open = [...this.children].find((c) => c.kind === 'chat');
            if (open) { call('bringModalToFront', open.modal); return; }
            const w = this.openWin({
                kind: 'chat', title: 'Live Chat', width: 380, height: 560, resizable: true, cls: 'qc-chatwin',
                body: `<div class="qc-chat-head"><span class="qc-chat-state">Connecting...</span><span class="qc-fill"></span><button type="button" class="qc-tb qc-chat-pop" title="Open the video on YouTube" disabled>WATCH</button></div>
                    <div class="qc-chat-list"></div>
                    <div class="qc-chat-send"><input type="text" class="qc-chat-input" maxlength="200" placeholder="Say something..." spellcheck="true"><button type="button" class="qc-btn is-def qc-chat-go">Send</button></div>`,
                buttons: []
            });
            w.kind = 'chat';
            const m = w.modal;
            const list = m.querySelector('.qc-chat-list');
            const input = m.querySelector('.qc-chat-input');
            const go = m.querySelector('.qc-chat-go');
            let since = 0;
            let watch = '';
            const row = (x) => {
                const d = new Date(x.at);
                const badge = x.owner ? '<i class="qc-cb is-owner">OWNER</i>' : x.mod ? '<i class="qc-cb is-mod">MOD</i>' : x.member ? '<i class="qc-cb is-mem">MEMBER</i>' : '';
                return `<div class="qc-msg${x.amount ? ' is-paid' : ''}${x.owner ? ' is-own' : ''}"><span class="qc-msg-time">${pad(d.getHours())}:${pad(d.getMinutes())}</span>${x.avatar ? `<img class="qc-msg-av" src="${esc(x.avatar)}" alt="" width="20" height="20" referrerpolicy="no-referrer">` : ''}<span class="qc-msg-body"><b class="qc-msg-name">${esc(x.author)}</b>${badge}${x.amount ? `<i class="qc-cb is-paid">${esc(x.amount)}</i>` : ''} <span class="qc-msg-text">${esc(x.text)}</span></span></div>`;
            };
            const pollChat = async () => {
                if (!m.isConnected || this.app.signal.aborted) return;
                try {
                    const r = await this.send('quickcast_chat', { since });
                    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
                    if (r.messages.length) {
                        list.querySelector('.qc-chat-empty')?.remove();
                        list.insertAdjacentHTML('beforeend', r.messages.map(row).join(''));
                        while (list.children.length > 300) list.firstElementChild.remove();
                        if (atEnd || since === 0) list.scrollTop = list.scrollHeight;
                    } else if (!list.children.length) list.innerHTML = '<div class="qc-chat-empty">No messages yet.</div>';
                    since = r.seq;
                    m.querySelector('.qc-chat-state').textContent = r.problem ? r.problem : !r.canRead ? 'Set up YouTube in Settings > Account' : r.broadcast ? r.broadcast.title : 'Live chat';
                    m.classList.toggle('qc-chat-err', !!r.problem || !r.canRead);
                    input.disabled = !r.canReply;
                    go.disabled = !r.canReply;
                    input.placeholder = r.canReply ? 'Say something...' : 'Sign in to YouTube to reply (Settings > Account)';
                    watch = r.broadcast ? r.broadcast.watchUrl : (this.st && this.st.watchUrl) || '';
                    m.querySelector('.qc-chat-pop').disabled = !watch;
                } catch (err) { m.querySelector('.qc-chat-state').textContent = err.message; }
                setTimeout(pollChat, 1000);
            };
            const sendIt = async () => {
                const t = input.value.trim();
                if (!t || go.disabled) return;
                go.disabled = true;
                try { await this.send('quickcast_chat_send', { text: t }); input.value = ''; } catch (err) { await this.box(err.message, 'error'); }
                go.disabled = false;
                input.focus();
            };
            go.addEventListener('click', () => void sendIt());
            input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); void sendIt(); } });
            m.querySelector('.qc-chat-pop').addEventListener('click', () => { if (watch) root.open(watch, '_blank', 'noopener'); });
            void pollChat();
        }

        about() {
            this.openWin({
                kind: 'about', title: 'About VisionCaster', width: 380,
                body: `<div class="qc-about"><img src="${A}/quickcast-48.png" alt="" width="48" height="48"><div><b>VisionCaster</b><br>Video Mixer Remote<br>Version ${VERSION}<br>AmusementVISION 2024<br><br>Satellite: ${esc(this.satName())}${this.st && this.st.satellite && this.st.satellite.model ? `<br>${esc(this.st.satellite.model)}` : ''}</div></div>`,
                buttons: [{ text: 'OK', value: 'cancel', def: true }]
            });
        }

        /** Melaton's message box, titled with the program. */
        async box(text, kind, buttons) {
            const icon = kind === 'error' ? 'fas fa-circle-xmark' : kind === 'warning' ? 'fas fa-triangle-exclamation' : 'fas fa-circle-info';
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'VisionCaster', icon, width: 400 });
        }

        async ask(text) {
            const v = await this.box(text, 'warning', [{ text: 'Yes', value: 'yes', className: 'btn-standard' }, { text: 'No', value: null, className: 'btn-standard primary' }]);
            return v === 'yes';
        }
    }

    let running = null;

    function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const p = new QuickCast(app);
        running = p;
        app.onExit(() => { if (running === p) running = null; p.destroy(); });
    }

    root.melatonQuickCast = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('quickcast', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
