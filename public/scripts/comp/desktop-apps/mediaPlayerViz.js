// Melaton Media Player: WMP 11's visualizations in Now Playing (Now Playing > Visualizations, and the stage's
// right-click menu), with the menu as the Vista VM lists it: No Visualization, Album Art, the collections
// (Alchemy, Bars and Waves, Battery, and any downloaded older collection), Download Visualizations, Options...
// public/scripts/comp/desktop-apps/mediaPlayerViz.js
//
// Renderers draw into one canvas over the stage, fed by an AnalyserNode on the Web Audio graph of
// mediaPlayerAudio.js (player.audio.analyser(), created only while a visualization is drawn). Drawing runs on
// requestAnimationFrame only while all of this holds: a visualization (not Album Art / No Visualization) is
// chosen, a song (not a video) plays, Now Playing is the shown view, the window is open and not minimised and
// the page is visible. Every one of those is an event (media play / pause, the view's and window's class
// changes, visibilitychange); nothing polls. Phones draw at most 30 frames a second.
//
// Collections register with the 'melaton:wmp-vis-register' event ({ id, label, presets: [{ name, create }] }):
// Bars and Waves is in this file, Battery in mediaPlayerVizBattery.js, Alchemy in mediaPlayerVizAlchemy.js;
// the older (WMP 9 / 10) collections arrive as downloadable packages (wmpvis/). A renderer is
// create(canvas) -> { frame(data, now), resize(w, h), dispose() } where data = { freq: Uint8Array(1024),
// wave: Uint8Array(1024), w, h }.
(function () {
    'use strict';

    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined;

    const collections = [];
    const hosts = new Set();

    function register(col) {
        if (!col || !col.id || !Array.isArray(col.presets)) return;
        const at = collections.findIndex((c) => c.id === col.id);
        if (at !== -1) collections.splice(at, 1, col);
        else collections.push(col);
        // the VM lists them by name (Alchemy, Ambience, Bars and Waves, Battery, ...)
        collections.sort((a, b) => a.label.localeCompare(b.label));
        hosts.forEach((h) => h.refresh());
    }

    // ---- Bars and Waves (wmp.dll {48501FF0-...}): Bars, Ocean Mist, Fire Storm, Scope ----
    // Measured on the VM at 808x574: Bars are 5px wide with a 1px gap, #A4EB0C, a 1px #EEF3FA peak line that
    // hangs and falls; Ocean Mist and Fire Storm fill one column per frequency (#0000FF / #FFA500) and leave a
    // falling trail 20 (15) steps darker per frame; Scope is the waveform, 1px #A4EB0C, about the middle.

    function imageSurface(canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        let img = null;
        let px = null;
        return {
            ctx,
            begin(w, h) {
                if (!img || img.width !== w || img.height !== h) {
                    img = ctx.createImageData(w, h);
                    px = new Uint32Array(img.data.buffer);
                }
                px.fill(0xff000000);
                return px;
            },
            end() { ctx.putImageData(img, 0, 0); }
        };
    }

    const rgba = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0; // little-endian ImageData word

    function vline(px, w, h, x, y0, y1, c) {
        if (x < 0 || x >= w) return;
        const a = Math.max(0, Math.min(y0, y1));
        const b = Math.min(h - 1, Math.max(y0, y1));
        for (let y = a; y <= b; y++) px[y * w + x] = c;
    }

    function level(freq, from, to) {
        let s = 0;
        let n = 0;
        for (let i = from; i < to && i < freq.length; i++) { s += freq[i]; n++; }
        return n ? s / n : 0;
    }

    function createBars(canvas) {
        const surf = imageSurface(canvas);
        const COUNT = 49;
        const BAR = rgba(0xa4, 0xeb, 0x0c);
        const PEAK = rgba(0xee, 0xf3, 0xfa);
        const peaks = new Float32Array(COUNT);
        const hang = new Int16Array(COUNT);
        return {
            frame(d) {
                const { w, h } = d;
                const px = surf.begin(w, h);
                const left = Math.round((w - COUNT * 6 + 1) / 2);
                for (let i = 0; i < COUNT; i++) {
                    const v = level(d.freq, i * 4, i * 4 + 4) / 255;
                    const top = Math.round(h - v * h);
                    const x0 = left + i * 6;
                    for (let x = x0; x < x0 + 5; x++) vline(px, w, h, x, top, h - 1, BAR);
                    // the peak: hangs 4 frames, then falls 4px a frame
                    if (top <= peaks[i] || !peaks[i]) { peaks[i] = top - 1; hang[i] = 4; }
                    else if (hang[i] > 0) hang[i]--;
                    else peaks[i] = Math.min(top - 1, peaks[i] + 4);
                    const py = Math.round(peaks[i]) - 11;
                    if (py >= 0 && py < h) for (let x = x0; x < x0 + 5; x++) px[py * w + x] = PEAK;
                }
                surf.end();
            },
            resize() { peaks.fill(0); },
            dispose() {}
        };
    }

    function createMist(canvas, base, step, edge) {
        const surf = imageSurface(canvas);
        const TRAIL = Math.floor(255 / step);
        let hist = null;
        let peaks = null;
        let at = 0;
        const shade = [];
        for (let k = 0; k <= TRAIL; k++) shade.push(rgba(Math.max(0, base[0] - k * step * (base[0] / 255)), Math.max(0, base[1] - k * step * (base[1] ? 1 : 0)), Math.max(0, base[2] - k * step * (base[2] / 255))));
        return {
            frame(d) {
                const { w, h } = d;
                if (!hist || hist.w !== w) {
                    hist = { w, rows: Array.from({ length: TRAIL + 1 }, () => new Int16Array(w).fill(h)) };
                    peaks = new Float32Array(w).fill(h);
                }
                const px = surf.begin(w, h);
                at = (at + 1) % hist.rows.length;
                const cur = hist.rows[at];
                for (let x = 0; x < w; x++) {
                    const bin = w <= d.freq.length ? x : Math.floor(x * d.freq.length / w); // one column per frequency, as the VM draws
                    cur[x] = Math.round(h - (d.freq[bin] / 255) * h);
                }
                // oldest trail first, the current level on top
                for (let k = hist.rows.length - 1; k >= 0; k--) {
                    const row = hist.rows[(at - k + hist.rows.length) % hist.rows.length];
                    const c = shade[k];
                    for (let x = 0; x < w; x++) vline(px, w, h, x, row[x], h - 1, c);
                }
                if (edge) {
                    for (let x = 0; x < w; x++) {
                        if (cur[x] < peaks[x]) peaks[x] = cur[x];
                        else peaks[x] = Math.min(h, peaks[x] + 2);
                        const y = Math.round(peaks[x]) - 2;
                        if (y > 0 && y < h && (x + Math.round(peaks[x])) % 3 === 0) px[y * w + x] = edge;
                    }
                }
                surf.end();
            },
            resize() { hist = null; },
            dispose() {}
        };
    }

    function createScope(canvas) {
        const surf = imageSurface(canvas);
        const C = rgba(0xa4, 0xeb, 0x0c);
        return {
            frame(d) {
                const { w, h } = d;
                const px = surf.begin(w, h);
                const n = d.wave.length;
                let prev = -1;
                for (let x = 0; x < w; x++) {
                    const v = (d.wave[Math.floor(x * n / w)] - 128) / 128;
                    const y = Math.max(0, Math.min(h - 1, Math.round(h / 2 - v * h / 2)));
                    vline(px, w, h, x, prev < 0 ? y : prev, y, C);
                    prev = y;
                }
                surf.end();
            },
            resize() {},
            dispose() {}
        };
    }

    register({
        id: 'bars',
        label: 'Bars and Waves',
        presets: [
            { name: 'Bars', create: createBars },
            { name: 'Ocean Mist', create: (c) => createMist(c, [0, 0, 255], 20, rgba(0xc8, 0xc8, 0xc8)) },
            { name: 'Fire Storm', create: (c) => createMist(c, [255, 165, 0], 15, 0) },
            { name: 'Scope', create: createScope }
        ]
    });

    // ---- the host, one per player ----

    function createHost(player) {
        const audio = player.audio;
        const settings = audio.settings;
        const stage = player.el.stage;
        const canvas = document.createElement('canvas');
        canvas.className = 'wmp-vis hidden';
        stage.insertBefore(canvas, stage.querySelector('.wmp-stage-status'));
        const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

        let renderer = null;
        let rendererKey = '';
        let tap = null;
        let raf = 0;
        let lastFrame = 0;
        let freq = new Uint8Array(1024);
        let wave = new Uint8Array(1024).fill(128);
        let dbs = null;
        let tilt = null;

        function choice() {
            const v = settings.viz || 'album-art';
            if (v === 'none' || v === 'album-art') return { kind: v };
            const [cid, idx] = v.split(':');
            const col = collections.find((c) => c.id === cid);
            const preset = col && col.presets[Number(idx) || 0];
            return preset ? { kind: 'vis', col, preset, key: v } : { kind: 'album-art' };
        }

        function shouldRun() {
            const c = choice();
            if (c.kind !== 'vis') return false;
            const media = player.el.media;
            if (media.paused || media.ended || !media.getAttribute('src')) return false;
            if (stage.dataset.kind === 'video') return false;
            if (player.view !== 'now-playing') return false;
            const m = player.modal;
            if (m.classList.contains('hidden') || m.classList.contains('minimised') || m.classList.contains('hidden-alt')) return false;
            return !document.hidden;
        }

        function syncLook() {
            const c = choice();
            const video = stage.dataset.kind === 'video';
            stage.classList.toggle('wmp-vis-none', c.kind === 'none' && !video);
            stage.classList.toggle('wmp-vis-on', c.kind === 'vis' && !video);
            canvas.classList.toggle('hidden', c.kind !== 'vis' || video);
        }

        function stop() {
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            if (tap) { tap.release(); tap = null; }
        }

        function ensureRenderer() {
            const c = choice();
            if (c.kind !== 'vis') {
                if (renderer) { renderer.dispose(); renderer = null; rendererKey = ''; }
                return null;
            }
            if (rendererKey !== c.key) {
                if (renderer) renderer.dispose();
                renderer = c.preset.create(canvas, { phone });
                rendererKey = c.key;
            }
            return renderer;
        }

        function tick(now) {
            raf = 0;
            if (!shouldRun()) { stop(); return; }
            raf = requestAnimationFrame(tick);
            if (phone && now - lastFrame < 32) return;
            lastFrame = now;
            const r = ensureRenderer();
            if (!r) return;
            const w = Math.max(1, stage.clientWidth);
            const h = Math.max(1, stage.clientHeight);
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                r.resize(w, h);
            }
            const node = tap ? (tap.node() || tap.retry()) : null;
            if (node) {
                if (node.fftSize !== 2048) { node.fftSize = 2048; node.smoothingTimeConstant = 0.5; }
                if (!dbs || freq.length !== node.frequencyBinCount) {
                    freq = new Uint8Array(node.frequencyBinCount);
                    dbs = new Float32Array(node.frequencyBinCount);
                    wave = new Uint8Array(node.fftSize >> 1);
                    tilt = new Float32Array(node.frequencyBinCount).map((_, i) => 3 * Math.log2(Math.max(1, i) / 4));
                }
                // WMP's levels run flatter than Web Audio's dB bytes: 3 dB an octave of tilt over 85 dB of range
                node.getFloatFrequencyData(dbs);
                for (let i = 0; i < freq.length; i++) {
                    const v = (dbs[i] + tilt[i] + 100) * (255 / 85);
                    freq[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
                }
                node.getByteTimeDomainData(wave);
            } else {
                freq.fill(0);
                wave.fill(128);
            }
            r.frame({ freq, wave, w, h }, now);
        }

        function sync() {
            syncLook();
            if (shouldRun()) {
                if (!tap) tap = audio.analyser();
                if (!raf) raf = requestAnimationFrame(tick);
            } else {
                stop();
            }
        }

        function setChoice(v) {
            settings.viz = v;
            audio.save();
            sync();
        }

        function menuItems() {
            const cur = settings.viz || 'album-art';
            const radio = (text, v) => ({ text, action: 'vis:' + v, showIndicator: true, indicatorMark: 'radio', checked: cur === v });
            const items = [radio('No Visualization', 'none'), { separator: true }, radio('Album Art', 'album-art')];
            collections.forEach((col) => {
                const inCol = cur.indexOf(col.id + ':') === 0;
                items.push({
                    text: col.label,
                    showIndicator: true,
                    indicatorMark: 'radio',
                    checked: inCol,
                    submenu: col.presets.map((p, i) => radio(p.name, col.id + ':' + i))
                });
            });
            items.push({ separator: true });
            items.push({ text: 'Download Visualizations', action: 'vis-download' });
            items.push({ text: 'Options...', action: 'vis-options', disabled: true });
            return items;
        }

        function runAction(action) {
            if (String(action).indexOf('vis:') === 0) setChoice(action.slice(4));
            else if (action === 'vis-download') document.dispatchEvent(new CustomEvent('melaton:wmp-vis-download', { detail: player }));
        }

        const mo = new MutationObserver(sync);
        mo.observe(player.modal, { attributes: true, attributeFilter: ['class'] });
        player.content.querySelectorAll('.wmp-view').forEach((v) => mo.observe(v, { attributes: true, attributeFilter: ['class'] }));
        mo.observe(stage, { attributes: true, attributeFilter: ['data-kind'] });
        document.addEventListener('visibilitychange', sync, { signal: appScopeSignal });

        const host = {
            menuItems,
            stageItems: () => menuItems().slice(0, -3).concat([{ separator: true }]),
            runAction,
            sync,
            refresh() {
                if (renderer && !choice().preset) { renderer.dispose(); renderer = null; rendererKey = ''; }
                sync();
            },
            dispose() {
                stop();
                mo.disconnect();
                if (renderer) renderer.dispose();
                renderer = null;
                hosts.delete(host);
            }
        };
        hosts.add(host);
        sync();
        return host;
    }

    function attach(player) {
        if (!player || !player.audio || player.viz) return;
        const host = createHost(player);
        player.viz = host;
        const audio = player.audio;
        // the audio module's hooks: menu items after Enhancements, actions, play / pause
        const menuItems = audio.menuItems;
        audio.menuItems = () => menuItems().concat([{ text: 'Visualizations', submenu: host.menuItems() }]);
        audio.state.runAction = (action) => host.runAction(action);
        audio.state.onPlay = () => host.sync();
        audio.state.onPause = () => host.sync();
    }

    document.addEventListener('melaton:wmp-vis-register', (e) => register(e.detail), { signal: appScopeSignal });
    document.addEventListener('melaton:wmp-player', (e) => attach(e.detail), { signal: appScopeSignal });
})();
