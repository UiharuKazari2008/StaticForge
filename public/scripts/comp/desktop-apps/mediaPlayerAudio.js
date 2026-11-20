// Melaton Media Player: the Web Audio graph behind Windows Media Player 11's enhancements, and the Graphic
// Equalizer pane (Now Playing > Enhancements > Graphic Equalizer), 1:1 with WMP 11 on the Vista VM.
// public/scripts/comp/desktop-apps/mediaPlayerAudio.js
//
// The pane is wmploc.dll's EqualizerSettings view (EQUALIZER.WSZ / EQUALIZER.JS): the Turn on / Turn off link,
// Reset, the preset drop-down (the 22 presets of WMP 11's effects object, read off the VM's sliders: 24 px of
// thumb travel = 14 dB, so each step is 7/12 dB), ten sliders at 31 Hz ... 16 kHz (-14 ... +14, the skin's
// range), the three spline-tension radios (independently / loose group 3 / tight group 9, their pull on the
// neighbours measured on the VM) and the previous / next enhancement arrows and the close box of the pane.
// Art: static_images/vista-wmp/eq (wmploc bitmaps 2167 sliders, 1797-1799 thumbs, 2120-2122 radios,
// 506/509/512 + 1703-1705 tension icons, 1723-1728 arrows, 522-524 close).
//
// Audio: MediaElementAudioSourceNode -> ten peaking BiquadFilters -> destination, built only once the equalizer
// is on and something same-origin plays (no AudioContext at all while it is off); the context is suspended
// while nothing plays, and torn down (closed, the <video> swapped for a fresh one: a browser binds an element
// to one context for good) when the window closes or a cross-origin source comes next (it would play silent
// through the graph). Settings persist in localStorage 'wmpEnhancements' (like the ratings, wmpRatings).
//
// The player (mediaPlayer.js) announces itself with the 'melaton:wmp-player' event (each file of the feature runs in
// its own scope, melatonSegments.js; the player brings swapMedia / showView); this file sets
// player.audio = { menuItems, runAction, beforeSource, close, analyser } for it.
(function () {
    'use strict';

    // page listeners end with this file's segment (app-scope, #872)
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined;

    const ART = '/static_images/vista-wmp/eq';
    const STORE = 'wmpEnhancements';
    const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const LABELS = ['31Hz', '62', '125', '250', '500', '1KHz', '2', '4', '8', '16KHz'];
    const NAMES = ['31 Hz', '62 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz'];
    const MAX = 14;
    const TRAVEL = 24; // px of thumb travel for MAX dB
    // WMP 11's presets as the VM's sliders show them, in thumb pixels above the middle (x 7/12 = dB)
    const PRESETS = [
        ['Default', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ['Rock', [-2, 1, 3, 5, -1, -2, 0, 0, 6, 6]],
        ['Rap', [-2, 0, 3, 3, -1, -2, 0, 0, 6, 10]],
        ['Grunge', [-7, 0, 0, -3, 0, 0, 3, 5, 0, -5]],
        ['Metal', [-7, 0, 0, 0, 0, 0, 5, 0, 5, 2]],
        ['Dance', [-2, 7, 9, 2, -2, -2, 0, 0, 7, 7]],
        ['Techno', [-10, 2, 7, -2, -2, -3, 0, 0, 9, 9]],
        ['Country', [-2, 0, 0, 3, 3, 0, 0, 0, 5, 5]],
        ['Jazz', [0, 0, 0, 5, 5, 5, 0, 3, 6, 7]],
        ['Acoustic', [0, 2, 3, 0, 0, 0, 0, 0, 3, 3]],
        ['Folk', [-2, 0, 2, 0, 3, 0, 0, 0, 3, 0]],
        ['New Age', [0, 5, 5, 0, 0, 0, 0, 0, 2, 2]],
        ['Classical', [0, 10, 10, 5, 0, 0, 0, 0, 3, 3]],
        ['Blues', [-2, 0, 3, 2, 0, 0, 0, 0, -2, -5]],
        ['Oldies', [-3, 0, 3, 2, 0, 0, 0, 0, -3, -9]],
        ['Reggae', [-2, 0, 0, -5, 0, 5, 7, 0, 5, 7]],
        ['Opera', [0, 0, 0, 5, 7, 3, 9, 3, 0, 0]],
        ['Swing', [-2, 0, 0, 0, 5, 5, 0, 3, 7, 7]],
        ['Speech', [-3, 0, 3, 2, 0, 0, 0, 0, -3, -9]],
        ['Music 56K', [0, 0, 0, 0, 0, 0, 0, 0, -3, 0]],
        ['Music 28K', [0, 0, 0, 0, 0, 0, 0, -3, -5, 0]],
        ['Custom', null]
    ];
    const CUSTOM = PRESETS.length - 1;
    // the share of a slider's move its neighbours take (by distance), measured on the VM
    const PULL = {
        loose: [1, 0.81, 0.38, 0.19, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02],
        tight: [1, 1, 0.7, 0.46, 0.29, 0.19, 0.14, 0.1, 0.08, 0.05]
    };
    const MODES = [
        { id: 'off', icon: 'st-off', tip: 'Set equalizer sliders to move independently' },
        { id: 'loose', icon: 'st-loose', tip: 'Set equalizer sliders to move together in a loose group' },
        { id: 'tight', icon: 'st-tight', tip: 'Set equalizer sliders to move together in a tight group' }
    ];

    const pxToDb = (px) => Math.round(px * MAX / TRAVEL * 100) / 100;
    const clamp = (v) => Math.max(-MAX, Math.min(MAX, v));

    function loadSettings() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { s = null; }
        s = s && typeof s === 'object' ? s : {};
        const custom = Array.isArray(s.custom) && s.custom.length === 10 ? s.custom.map((v) => clamp(Number(v) || 0)) : BANDS.map(() => 0);
        const preset = Number.isInteger(s.preset) && s.preset >= 0 && s.preset < PRESETS.length ? s.preset : 0;
        return {
            on: s.on === true, // WMP 11 starts with the equalizer off
            shown: s.shown === true,
            preset,
            custom,
            mode: MODES.some((m) => m.id === s.mode) ? s.mode : 'loose',
            viz: typeof s.viz === 'string' ? s.viz : ''
        };
    }

    function gainsOf(settings) {
        const p = PRESETS[settings.preset];
        return p && p[1] ? p[1].map(pxToDb) : settings.custom.slice();
    }

    function sameOrigin(url) {
        if (!url) return true;
        if (/^(blob|data):/i.test(url)) return true;
        try { return new URL(url, location.href).origin === location.origin; } catch (_) { return false; }
    }

    // ---- the graph ----

    function createAudio(player) {
        const settings = loadSettings();
        const state = { gains: gainsOf(settings), graph: null, pane: null, analysers: 0 };

        function save() {
            try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (_) { /* private mode */ }
        }

        function wanted() {
            return settings.on || state.analysers > 0;
        }

        /** Build the graph on the element (once the equalizer is on and a same-origin source plays). */
        function ensureGraph() {
            if (state.graph) return state.graph;
            const media = player.el.media;
            const src = media.currentSrc || media.getAttribute('src') || '';
            if (!src || !sameOrigin(src) || typeof AudioContext === 'undefined') return null;
            let ctx;
            try {
                ctx = new AudioContext({ latencyHint: 'balanced' });
            } catch (_) { return null; }
            let source;
            try {
                source = ctx.createMediaElementSource(media);
            } catch (_) {
                void ctx.close();
                return null;
            }
            const filters = BANDS.map((f, i) => {
                const b = ctx.createBiquadFilter();
                b.type = 'peaking';
                b.frequency.value = f;
                b.Q.value = 1.41; // an octave per band
                b.gain.value = state.gains[i];
                return b;
            });
            for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
            state.graph = { ctx, source, filters, media, analyser: null };
            route();
            if (media.paused) void ctx.suspend();
            return state.graph;
        }

        /** source -> (equalizer) -> destination, and the analyser (visualizations) off the end. */
        function route() {
            const g = state.graph;
            if (!g) return;
            g.source.disconnect();
            g.filters[g.filters.length - 1].disconnect();
            const tail = settings.on ? g.filters[g.filters.length - 1] : g.source;
            if (settings.on) g.source.connect(g.filters[0]);
            tail.connect(g.ctx.destination);
            if (g.analyser) tail.connect(g.analyser);
        }

        function applyGains() {
            const g = state.graph;
            if (!g) return;
            const t = g.ctx.currentTime;
            g.filters.forEach((f, i) => f.gain.setTargetAtTime(state.gains[i], t, 0.01));
        }

        /** Close the context and give the window a fresh element (the old one stays bound to the closed context). */
        function teardown() {
            const g = state.graph;
            if (!g) return player.el.media;
            state.graph = null;
            void g.ctx.close().catch(() => {});
            const media = player.swapMedia();
            wireMedia(media);
            return media;
        }

        function wireMedia(media) {
            media.addEventListener('play', () => {
                if (!wanted()) return;
                const g = ensureGraph();
                if (g && g.ctx.state !== 'running') void g.ctx.resume();
                if (state.onPlay) state.onPlay();
            });
            const idle = () => {
                const g = state.graph;
                if (g && g.ctx.state === 'running') void g.ctx.suspend();
                if (state.onPause) state.onPause();
            };
            media.addEventListener('pause', idle);
            media.addEventListener('ended', idle);
            media.addEventListener('emptied', idle);
        }

        // ---- the pane ----

        function buildPane() {
            const host = player.content.querySelector('.wmp-settings');
            if (!host || state.pane) return state.pane;
            const radios = MODES.map((m, i) => ''
                + '<button type="button" class="wmp-eq-radio" role="radio" data-mode="' + m.id + '" title="' + m.tip + '" aria-label="' + m.tip + '" style="top:' + (46 + i * 20) + 'px"></button>'
                + '<span class="wmp-eq-st wmp-eq-st-' + m.id + '" data-mode="' + m.id + '" title="' + m.tip + '" style="top:' + (44 + i * 20) + 'px"></span>').join('');
            const bands = BANDS.map((f, i) => ''
                + '<div class="wmp-eq-band" role="slider" tabindex="0" data-band="' + i + '" aria-label="' + NAMES[i] + ', Equalizer Slider" aria-valuemin="-' + MAX + '" aria-valuemax="' + MAX + '" style="left:' + (69 + 22 * i) + 'px"><span class="wmp-eq-thumb"></span></div>'
                + '<span class="wmp-eq-label" style="left:' + (78 + 22 * i) + 'px">' + LABELS[i] + '</span>').join('');
            host.innerHTML = ''
                + '<div class="wmp-set-head">'
                + '<button type="button" class="wmp-set-prev" title="Click for previous enhancement" aria-label="Click for previous enhancement"></button>'
                + '<button type="button" class="wmp-set-next" title="Click for next enhancement" aria-label="Click for next enhancement"></button>'
                + '<span class="wmp-set-title" title="Current enhancement">Graphic Equalizer</span>'
                + '<button type="button" class="wmp-set-close" title="Close" aria-label="Close"></button>'
                + '</div>'
                + '<div class="wmp-eq">'
                + '<button type="button" class="wmp-eq-link wmp-eq-onoff"></button>'
                + '<button type="button" class="wmp-eq-link wmp-eq-reset" title="Reset sliders to default">Reset</button>'
                + '<button type="button" class="wmp-eq-link wmp-eq-preset" aria-haspopup="menu"><span></span><i class="wmp-eq-menu-at"></i></button>'
                + '<div class="wmp-eq-sliders">' + radios + bands + '</div>'
                + '<div class="wmp-eq-gray"></div>'
                + '</div>';
            const q = (sel) => host.querySelector(sel);
            const pane = {
                host,
                onoff: q('.wmp-eq-onoff'),
                reset: q('.wmp-eq-reset'),
                preset: q('.wmp-eq-preset'),
                presetName: q('.wmp-eq-preset span'),
                bands: Array.from(host.querySelectorAll('.wmp-eq-band')),
                radios: Array.from(host.querySelectorAll('.wmp-eq-radio'))
            };
            state.pane = pane;
            pane.onoff.addEventListener('click', () => setOn(!settings.on));
            pane.reset.addEventListener('click', () => { if (settings.on) setPreset(0); });
            q('.wmp-set-close').addEventListener('click', () => setShown(false));
            // WMP 11 steps through its nine enhancement panes; Melaton has the equalizer only, so it stays
            q('.wmp-set-prev').addEventListener('click', () => syncPane());
            q('.wmp-set-next').addEventListener('click', () => syncPane());
            host.querySelectorAll('[data-mode]').forEach((node) => node.addEventListener('click', () => {
                if (!settings.on) return;
                settings.mode = node.dataset.mode;
                save();
                syncPane();
            }));
            const cm = typeof contextMenu !== 'undefined' ? contextMenu : null;
            if (cm) {
                const attach = () => {
                    cm.detachClickMenuFromElement(pane.preset);
                    if (!settings.on) return;
                    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js (WMP's own pop-up: radio dot on the current preset)
                    cm.attachClickMenuToElement(pane.preset, {
                        position: 'anchor',
                        anchorAlign: 'start',
                        // WMP's menu opens over the link, from the arrow's left (the VM: 8px under the link's top)
                        anchorElement: () => pane.preset.querySelector('.wmp-eq-menu-at'),
                        sections: [{ type: 'list', items: PRESETS.map((p, i) => ({ text: p[0], action: 'preset:' + i, showIndicator: true, indicatorMark: 'radio', checked: i === settings.preset })) }],
                        onAction: (action) => { if (String(action).indexOf('preset:') === 0) setPreset(Number(action.slice(7))); }
                    });
                };
                pane.preset.addEventListener('pointerdown', attach, true);
                pane.preset.addEventListener('focus', attach);
                pane.attachMenu = attach;
            }
            pane.bands.forEach((band, i) => wireBand(band, i));
            syncPane();
            return pane;
        }

        function syncPane() {
            const pane = state.pane;
            if (!pane) return;
            pane.host.classList.toggle('is-off', !settings.on);
            pane.onoff.textContent = settings.on ? 'Turn off' : 'Turn on';
            pane.onoff.title = settings.on ? 'Turn off graphic equalizer' : 'Turn on graphic equalizer';
            pane.presetName.textContent = PRESETS[settings.preset][0];
            pane.reset.disabled = !settings.on;
            pane.preset.disabled = !settings.on;
            pane.radios.forEach((r) => {
                const on = r.dataset.mode === settings.mode;
                r.setAttribute('aria-checked', String(on));
                // turned off, WMP draws every radio unchecked (the choice comes back with Turn on)
                r.classList.toggle('is-on', on && settings.on);
                r.disabled = !settings.on;
            });
            pane.bands.forEach((band, i) => {
                const v = state.gains[i];
                band.style.setProperty('--wmp-eq-y', (26 - Math.round(v * TRAVEL / MAX)) + 'px');
                band.setAttribute('aria-valuenow', String(Math.round(v)));
                band.title = String(Math.round(v));
                band.setAttribute('aria-disabled', String(!settings.on));
            });
            if (pane.attachMenu) pane.attachMenu();
        }

        function wireBand(band, i) {
            let drag = null;
            const valueAt = (clientY) => {
                const rect = band.getBoundingClientRect();
                // the thumb's middle follows the pointer: middle at 30px = 0 dB, 24px either way = 14 dB
                return clamp(Math.round((30 - (clientY - rect.top)) * MAX / TRAVEL));
            };
            band.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 || !settings.on) return;
                e.preventDefault();
                band.focus();
                band.setPointerCapture(e.pointerId);
                band.classList.add('is-down');
                drag = { start: state.gains.slice(), shift: e.shiftKey };
                if (!e.target.classList.contains('wmp-eq-thumb')) move(i, valueAt(e.clientY), drag.start, e.shiftKey);
                else drag.offset = valueAt(e.clientY) - state.gains[i];
            });
            band.addEventListener('pointermove', (e) => {
                if (!drag) return;
                move(i, clamp(valueAt(e.clientY) - (drag.offset || 0)), drag.start, e.shiftKey);
            });
            const end = () => {
                if (!drag) return;
                drag = null;
                band.classList.remove('is-down');
                save();
            };
            band.addEventListener('pointerup', end);
            band.addEventListener('lostpointercapture', end);
            band.addEventListener('pointercancel', end);
            band.addEventListener('keydown', (e) => {
                if (!settings.on) return;
                const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1
                    : e.key === 'PageUp' ? 5 : e.key === 'PageDown' ? -5 : 0;
                const to = e.key === 'Home' ? MAX : e.key === 'End' ? -MAX : null;
                if (!step && to === null) return;
                e.preventDefault();
                move(i, clamp(to !== null ? to : Math.round(state.gains[i]) + step), state.gains.slice(), e.shiftKey);
                save();
            });
        }

        /** One slider to `value`; with a group mode its neighbours follow by the VM's pull (Shift moves it alone). */
        function move(i, value, start, alone) {
            const pull = settings.mode === 'off' || alone ? null : PULL[settings.mode];
            const delta = value - start[i];
            state.gains = start.map((v, j) => {
                if (j === i) return value;
                if (!pull) return state.gains[j];
                return clamp(Math.round((v + pull[Math.abs(i - j)] * delta) * 100) / 100);
            });
            settings.preset = CUSTOM;
            settings.custom = state.gains.slice();
            applyGains();
            syncPane();
        }

        function setPreset(index) {
            settings.preset = Math.max(0, Math.min(CUSTOM, index | 0));
            state.gains = gainsOf(settings);
            save();
            applyGains();
            syncPane();
        }

        function setOn(on) {
            settings.on = !!on;
            save();
            if (settings.on && !player.el.media.paused) {
                const g = ensureGraph();
                if (g && g.ctx.state !== 'running') void g.ctx.resume();
            }
            route();
            applyGains();
            syncPane();
        }

        function setShown(shown) {
            settings.shown = !!shown;
            save();
            const host = player.content.querySelector('.wmp-settings');
            if (!host) return;
            if (settings.shown) buildPane();
            host.classList.toggle('hidden', !settings.shown);
        }

        // ---- what the player calls ----

        function menuItems() {
            return [
                {
                    text: 'Enhancements',
                    submenu: [
                        { text: 'Show Enhancements', action: 'enh:toggle', showIndicator: true, indicatorMark: 'check', checked: settings.shown },
                        { separator: true },
                        { text: 'Graphic Equalizer', action: 'enh:eq', showIndicator: true, indicatorMark: 'radio', checked: true }
                    ]
                }
            ];
        }

        function runAction(action) {
            if (action === 'enh:toggle') setShown(!settings.shown);
            else if (action === 'enh:eq') {
                if (player.view !== 'now-playing') player.showView('now-playing');
                setShown(true);
            } else if (state.runAction) state.runAction(action);
        }

        /** Before the element takes a new source: a cross-origin one cannot go through the graph. */
        function beforeSource(url) {
            if (state.graph && !sameOrigin(url)) return teardown();
            return player.el.media;
        }

        /** An AnalyserNode on what plays (the visualizations); release() when they stop showing. */
        function analyser() {
            state.analysers += 1;
            const g = ensureGraph();
            if (g && !g.analyser) {
                g.analyser = g.ctx.createAnalyser();
                route();
            }
            if (g && !player.el.media.paused && g.ctx.state !== 'running') void g.ctx.resume();
            let released = false;
            return {
                node: () => (state.graph && state.graph.analyser) || null,
                retry: () => {
                    const again = ensureGraph();
                    if (again && !again.analyser) { again.analyser = again.ctx.createAnalyser(); route(); }
                    return (again && again.analyser) || null;
                },
                release: () => {
                    if (released) return;
                    released = true;
                    state.analysers -= 1;
                    const cur = state.graph;
                    if (state.analysers <= 0 && cur && cur.analyser) {
                        cur.analyser.disconnect();
                        cur.analyser = null;
                        route();
                    }
                }
            };
        }

        function close() {
            teardown();
        }

        wireMedia(player.el.media);
        if (settings.shown) setShown(true);

        return { menuItems, runAction, beforeSource, close, analyser, settings, save, state };
    }

    function attach(player) {
        if (!player || player.audio) return;
        player.audio = createAudio(player);
    }

    // the feature's scripts load together (featureLoader media_player), before any window is built
    document.addEventListener('melaton:wmp-player', (e) => attach(e.detail), { signal: appScopeSignal });
})();
