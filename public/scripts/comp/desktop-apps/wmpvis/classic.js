// Melaton Media Player: the older visualizations (Windows Media Player 9 Series / 10), a downloadable package
// ('wmpvis-classic', public/scripts/launch/assetPackages.js): Download Visualizations installs it, and
// mediaPlayerViz.js loads this file as a segment once the package is on the computer.
// public/scripts/comp/desktop-apps/wmpvis/classic.js
//
// The collections and presets as WMP 10 (10.0.0.3802, the XP reference VM) lists them: Ambience (Random, Swirl,
// Warp, Anon, Falloff, Water, Bubble, Dizzy, Windmill, Niagara, Blender, X Marks the Spot, Down the Drain,
// Thingus), Particle (Particle, Rotating Particle), Plenoptic (Random, Smokey Circles, Smokey Lines, Vox, Flame,
// Fountain, Spyro), Spikes (Spike, Amoeba). Drawn after the XP VM's frames (~/.cache/xp-vm/cap: c1-c56); the
// effects' own code (WMP 10 wmp.dll) is not used, so motion is matched by eye.
(function () {
    'use strict';

    const TAU = Math.PI * 2;
    const MAXW = 360;
    const wv = (d, i) => (d.wave[((i % d.wave.length) + d.wave.length) % d.wave.length] - 128) / 128;
    const band = (d, a, b) => { let s = 0; for (let i = a; i < b; i++) s += d.freq[i]; return s / ((b - a) * 255); };
    const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;

    // ---- Spikes: measured on the VM at 693x452 - lines from the middle out to the spectrum, mirrored into four
    // quarters (a diamond-ish star about 0.3 of the height), yellow #F0F858 lightening to #F8F880; Amoeba is
    // the same outline alone, 1px ----

    function spikeRadii(d, n, R) {
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const q = (i % (n / 4)) / (n / 4);
            const f = q < 0.5 ? q * 2 : (1 - q) * 2; // mirrored within each quarter
            const v = d.freq[1 + Math.floor(f * 180)] / 255;
            out[i] = R * (0.25 + v * 0.75);
        }
        return out;
    }

    function createSpike(canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        return {
            frame(d) {
                const { w, h } = d;
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                const n = 360;
                const r = spikeRadii(d, n, h * 0.32);
                for (let i = 0; i < n; i++) {
                    const a = i / n * TAU;
                    const v = r[i] / (h * 0.32);
                    ctx.strokeStyle = 'rgb(' + (240 + Math.round(v * 8)) + ',248,' + (88 + Math.round(v * 40)) + ')';
                    ctx.beginPath();
                    ctx.moveTo(w / 2, h / 2);
                    ctx.lineTo(w / 2 + Math.cos(a) * r[i], h / 2 + Math.sin(a) * r[i]);
                    ctx.stroke();
                }
            },
            resize() {},
            dispose() {}
        };
    }

    function createAmoeba(canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        return {
            frame(d) {
                const { w, h } = d;
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                const n = 360;
                const r = spikeRadii(d, n, h * 0.33);
                ctx.strokeStyle = '#f0f858';
                ctx.beginPath();
                for (let i = 0; i <= n; i++) {
                    const a = i / n * TAU;
                    const x = w / 2 + Math.cos(a) * r[i % n];
                    const y = h / 2 + Math.sin(a) * r[i % n];
                    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                }
                ctx.stroke();
            },
            resize() {},
            dispose() {}
        };
    }

    // ---- a small palette feedback engine (Ambience): warp the last frame, fade, draw the waveform ----

    function feedback(canvas, opts) {
        const ctx = canvas.getContext('2d', { alpha: false });
        const off = document.createElement('canvas');
        const octx = off.getContext('2d', { alpha: false });
        let w = 0; let h = 0; let buf = null; let tmp = null; let map = null; let img = null; let px = null;
        let t = 0;
        const pal = opts.palette;
        function size(cw, ch) {
            const k = Math.min(1, MAXW / Math.max(1, cw));
            w = Math.max(16, Math.round(cw * k));
            h = Math.max(16, Math.round(ch * k));
            off.width = w; off.height = h;
            buf = new Uint8Array(w * h); tmp = new Uint8Array(w * h);
            img = octx.createImageData(w, h); px = new Uint32Array(img.data.buffer);
            map = new Int32Array(w * h);
            const s = Math.min(w, h) / 2;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const dx = (x - w / 2) / s; const dy = (y - h / 2) / s;
                    const [sx, sy] = opts.warp(dx, dy, Math.hypot(dx, dy), Math.atan2(dy, dx));
                    const ix = Math.round(w / 2 + sx * s); const iy = Math.round(h / 2 + sy * s);
                    map[y * w + x] = ix < 0 || iy < 0 || ix >= w || iy >= h ? -1 : iy * w + ix;
                }
            }
        }
        const plot = (x, y, v) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < w && y < h && buf[y * w + x] < v) buf[y * w + x] = v; };
        const line = (x0, y0, x1, y1, v) => {
            const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
            for (let i = 0; i <= n; i++) plot(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, v);
        };
        // a waveform along a line through the middle (angle a, offset o of the half height)
        const waveLine = (d, a, o) => {
            const ca = Math.cos(a); const sa = Math.sin(a);
            const len = Math.hypot(w, h) * 0.55;
            let lx = 0; let ly = 0;
            for (let i = 0; i <= 96; i++) {
                const f = i / 96 * 2 - 1;
                const j = wv(d, i * 8) * h * 0.06 + o * h / 2;
                const x = w / 2 + ca * f * len - sa * j;
                const y = h / 2 + sa * f * len + ca * j;
                if (i) { line(lx, ly, x, y, 255); line(lx, ly + 1, x, y + 1, 230); line(lx, ly - 1, x, y - 1, 230); }
                lx = x; ly = y;
            }
        };
        return {
            frame(d) {
                if (!buf) size(d.w, d.h);
                t += 1;
                const last = buf.length - w - 1;
                // the warp samples a 2x2 average: the VM's Ambience smears into smooth fields
                for (let i = 0; i < map.length; i++) {
                    const s = map[i];
                    const v = s < 0 || s > last ? 0 : (buf[s] + buf[s + 1] + buf[s + w] + buf[s + w + 1]) >> 2;
                    tmp[i] = (v * opts.keep) >> 8;
                }
                const sw = buf; buf = tmp; tmp = sw;
                opts.draw({ d, t, w, h, plot, line, waveLine, bass: band(d, 1, 24) });
                for (let i = 0; i < px.length; i++) px[i] = pal[buf[i]];
                octx.putImageData(img, 0, 0);
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(off, 0, 0, d.w, d.h);
            },
            resize(cw, ch) { size(cw, ch); },
            dispose() { buf = tmp = map = null; }
        };
    }

    // Ambience's blue: black, #0000F0 at the middle, white at the top (the VM's frames)
    const BLUE = (() => {
        const p = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            const a = Math.min(1, i / 110);
            const b = Math.max(0, (i - 150) / 105);
            p[i] = rgb(Math.round(30 * a + 225 * b), Math.round(30 * a + 225 * b), Math.round(60 + 180 * a + 15 * b));
        }
        return p;
    })();

    const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const AMBIENCE = [
        ['Swirl', { keep: 250, warp: (dx, dy, r, a) => polar(r * 0.99, a + 0.04), draw: (k) => { k.waveLine(k.d, 0, -0.5); k.waveLine(k.d, 0, 0.5); } }],
        ['Warp', { keep: 254, warp: (dx, dy, r, a) => polar(r * 0.96 + 0.004, a + 0.01), draw: (k) => k.waveLine(k.d, k.t * 0.02, 0) }],
        ['Anon', { keep: 254, warp: (dx, dy) => [dx * 0.99 + dy * 0.02, dy * 0.99], draw: (k) => k.waveLine(k.d, 0, 0) }],
        ['Falloff', { keep: 255, warp: (dx, dy, r, a) => [dx * 1.02, dy * 0.97], draw: (k) => k.waveLine(k.d, 0, 0) }],
        ['Water', { keep: 254, warp: (dx, dy, r, a) => polar(r * 0.97, a), draw: (k) => { k.waveLine(k.d, 0, 0); } }],
        ['Bubble', { keep: 252, warp: (dx, dy, r, a) => polar(r < 0.8 ? r * 1.02 : r * 0.97, a + 0.02), draw: (k) => k.waveLine(k.d, k.t * 0.01, 0) }],
        ['Dizzy', { keep: 254, warp: (dx, dy, r, a) => polar(r * 0.99, a + 0.06 * (1 - r)), draw: (k) => { k.waveLine(k.d, 0.2, -0.4); k.waveLine(k.d, 0.2, 0.4); } }],
        ['Windmill', { keep: 254, warp: (dx, dy, r, a) => polar(r * 1.01, a + 0.03), draw: (k) => { k.waveLine(k.d, -0.3, -0.5); k.waveLine(k.d, -0.3, 0.5); } }],
        ['Niagara', { keep: 244, warp: (dx, dy) => [dx, dy - 0.03], draw: (k) => { for (let i = 0; i < 6; i++) k.plot(k.w / 2 + (Math.random() - 0.5) * 6, k.h * 0.8 + i, 255 * k.bass); k.waveLine(k.d, Math.PI / 2, 0); } }],
        ['Blender', { keep: 252, warp: (dx, dy, r, a) => polar(r * 0.985, a + 0.05 * r), draw: (k) => k.waveLine(k.d, 0, 0) }],
        ['X Marks the Spot', { keep: 252, warp: (dx, dy, r, a) => polar(r * 1.015, a), draw: (k) => { k.waveLine(k.d, 0.35, 0); k.waveLine(k.d, -1.35, 0); } }],
        ['Down the Drain', { keep: 254, warp: (dx, dy, r, a) => polar(r * 0.98, a + 0.05), draw: (k) => { k.waveLine(k.d, 1.1, -0.5); k.waveLine(k.d, 1.1, 0.5); } }],
        ['Thingus', { keep: 254, warp: (dx, dy, r, a) => polar(r * 0.99, a + 0.08 * Math.max(0, 1 - r)), draw: (k) => k.waveLine(k.d, k.t * 0.015, 0) }]
    ];

    function randomOf(list, period) {
        return (canvas) => {
            let cur = null; let since = 0;
            return {
                frame(d, now) {
                    if (!cur || now - since > period) {
                        if (cur) cur.dispose();
                        cur = list[Math.floor(Math.random() * list.length)](canvas);
                        cur.resize(d.w, d.h);
                        since = now;
                    }
                    cur.frame(d, now);
                },
                resize(cw, ch) { if (cur) cur.resize(cw, ch); },
                dispose() { if (cur) cur.dispose(); cur = null; }
            };
        };
    }

    const ambienceMakers = AMBIENCE.map(([, o]) => (c) => feedback(c, Object.assign({ palette: BLUE }, o)));

    // ---- Particle (WMP 10's Dotplane): a turning cloud of coloured dots; Rotating Particle: a line of them ----

    function createParticle(canvas, line) {
        const ctx = canvas.getContext('2d', { alpha: false });
        const N = line ? 160 : 600;
        const pts = Array.from({ length: N }, (_, i) => line ? [0, (i / N) * 2 - 1, 0] : [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
        let ax = 0; let ay = 0;
        return {
            frame(d) {
                const { w, h } = d;
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(0, 0, w, h);
                ax += 0.011; ay += 0.017;
                const e = band(d, 1, 40);
                const s = Math.min(w, h) * (0.18 + e * 0.12);
                for (let i = 0; i < N; i++) {
                    let [x, y, z] = pts[i];
                    const c1 = Math.cos(ay); const s1 = Math.sin(ay);
                    [x, z] = [x * c1 - z * s1, x * s1 + z * c1];
                    const c2 = Math.cos(ax); const s2 = Math.sin(ax);
                    [y, z] = [y * c2 - z * s2, y * s2 + z * c2];
                    const p = 2.5 / (3 + z);
                    const v = d.freq[1 + (i * 3) % 300] / 255;
                    ctx.fillStyle = 'hsl(' + Math.round((i * 7 + ay * 40) % 360) + ',80%,' + Math.round(20 + v * 45) + '%)';
                    ctx.fillRect(w / 2 + x * s * p, h / 2 + y * s * p, 2, 2);
                }
            },
            resize() {},
            dispose() {}
        };
    }

    // ---- Plenoptic: smoky colour fields fed by the waveform ----

    function smoky(canvas, paint) {
        const ctx = canvas.getContext('2d', { alpha: false });
        let t = 0;
        return {
            frame(d) {
                t += 1;
                ctx.globalCompositeOperation = 'source-over';
                paint(ctx, d, d.w, d.h, t);
            },
            resize() { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); },
            dispose() {}
        };
    }

    const blob = (ctx, d, cx, cy, R, col) => {
        ctx.strokeStyle = col;
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
            const a = i / 64 * TAU;
            const r = R * (1 + wv(d, i * 16) * 0.3);
            const x = cx + Math.cos(a) * r; const y = cy + Math.sin(a) * r;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
    };

    const PLENOPTIC = [
        ['Smokey Circles', (c) => smoky(c, (g, d, w, h) => {
            g.fillStyle = 'rgba(0,0,0,0.04)'; g.fillRect(0, 0, w, h);
            g.fillStyle = 'rgba(0,0,200,0.05)'; g.fillRect(0, 0, w / 2, h);
            g.fillStyle = 'rgba(0,180,0,0.05)'; g.fillRect(w / 2, 0, w / 2, h);
            blob(g, d, w * 0.25, h / 2, h * 0.16, 'rgba(60,60,255,0.8)');
            blob(g, d, w * 0.75, h / 2, h * 0.16, 'rgba(60,255,60,0.8)');
        })],
        ['Smokey Lines', (c) => smoky(c, (g, d, w, h) => {
            g.drawImage(c, 0, -1);
            g.fillStyle = 'rgba(0,0,0,0.03)'; g.fillRect(0, 0, w, h);
            for (let x = 0; x < w; x += 2) {
                const v = wv(d, x);
                g.fillStyle = 'rgba(0,20,230,0.35)'; g.fillRect(x, h * 0.08 + v * h * 0.1, 2, h * 0.3);
                g.fillStyle = 'rgba(230,30,0,0.35)'; g.fillRect(x, h * 0.45 - v * h * 0.1, 2, h * 0.42);
            }
        })],
        ['Vox', (c) => smoky(c, (g, d, w, h) => {
            g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, h);
            for (let x = 0; x < w * 0.6; x++) {
                const f = x / (w * 0.6);
                const env = Math.pow(1 - Math.abs(f * 2 - 1), 2.5);
                const v = Math.abs(wv(d, x * 3)) * h * 0.25 * env;
                g.fillStyle = 'rgb(240,' + Math.round(140 + env * 100) + ',0)';
                g.fillRect(w * 0.2 + x, h / 2 - v, 1, v * 2 + 1);
            }
        })],
        ['Flame', (c) => smoky(c, (g, d, w, h) => {
            g.drawImage(c, 0, -3);
            g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#0000f0';
            g.beginPath(); g.ellipse(w / 2, h * 0.88, w * 0.08, h * 0.04, 0, 0, TAU); g.fill();
            for (let i = 0; i < 60; i++) {
                const v = d.freq[1 + (i % 40) * 4] / 255;
                const x = w / 2 + (Math.random() - 0.5) * w * 0.12;
                const y = h * 0.82 - Math.random() * v * h * 0.12;
                g.fillStyle = Math.random() < 0.5 ? 'rgb(240,' + Math.round(150 + v * 100) + ',0)' : 'rgb(230,40,0)';
                g.fillRect(x, y, 5, 6);
            }
        })],
        ['Fountain', (c) => smoky(c, (g, d, w, h, t) => {
            g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, h);
            for (let i = 0; i < 180; i++) {
                const a = i / 180 * TAU + t * 0.01;
                const v = d.freq[1 + (i * 2) % 200] / 255;
                const x = w / 2 + Math.cos(a) * w * 0.16 * (1 + v * 0.2);
                const y = h * 0.62 + Math.sin(a) * h * 0.08 * (1 + v * 0.3) - v * h * 0.05;
                g.fillStyle = ['#fff', '#f0f000', '#f00080', '#4040ff'][i % 4];
                g.fillRect(x, y, 4, 4);
            }
            const gr = g.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h * 0.62, w * 0.12);
            gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,60,200,0.5)'); gr.addColorStop(1, 'rgba(240,240,0,0)');
            g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.62, w * 0.15, h * 0.08, 0, 0, TAU); g.fill();
        })],
        ['Spyro', (c) => smoky(c, (g, d, w, h, t) => {
            g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 0, w, h);
            for (let i = 0; i < 160; i++) {
                const a = i / 160 * TAU + t * 0.03;
                const v = d.freq[1 + (i * 2) % 200] / 255;
                const x = w * 0.22 + Math.cos(a) * w * 0.1 * (0.3 + (i % 3) * 0.35 + v * 0.3);
                const y = h * 0.82 + Math.sin(a) * h * 0.05 * (0.3 + (i % 3) * 0.35 + v * 0.3);
                g.fillStyle = ['#fff', '#f00000', '#4040ff', '#f0f000'][i % 4];
                g.fillRect(x, y, 5, 4);
            }
        })]
    ];

    const reg = (detail) => document.dispatchEvent(new CustomEvent('melaton:wmp-vis-register', { detail: Object.assign({ pkg: 'wmpvis-classic' }, detail) }));
    reg({
        id: 'ambience',
        label: 'Ambience',
        presets: [{ name: 'Random', create: randomOf(ambienceMakers, 20000) }].concat(AMBIENCE.map(([name], i) => ({ name, create: ambienceMakers[i] })))
    });
    reg({ id: 'particle', label: 'Particle', presets: [{ name: 'Particle', create: (c) => createParticle(c, false) }, { name: 'Rotating Particle', create: (c) => createParticle(c, true) }] });
    reg({
        id: 'plenoptic',
        label: 'Plenoptic',
        presets: [{ name: 'Random', create: randomOf(PLENOPTIC.map((p) => p[1]), 20000) }].concat(PLENOPTIC.map(([name, create]) => ({ name, create })))
    });
    reg({ id: 'spikes', label: 'Spikes', presets: [{ name: 'Spike', create: createSpike }, { name: 'Amoeba', create: createAmoeba }] });
})();
