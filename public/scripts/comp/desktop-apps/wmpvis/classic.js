// Melaton Media Player: the older visualizations (Windows Media Player 9 Series / 10), a downloadable package
// ('wmpvis-classic', public/scripts/launch/assetPackages.js): Download Visualizations installs it, and
// mediaPlayerViz.js loads this file as a segment once the package is on the computer.
// public/scripts/comp/desktop-apps/wmpvis/classic.js
//
// The collections and presets as WMP 10 (10.0.0.3802, the XP reference VM) lists them: Ambience (Random, Swirl,
// Warp, Anon, Falloff, Water, Bubble, Dizzy, Windmill, Niagara, Blender, X Marks the Spot, Down the Drain,
// Thingus), Particle (Particle, Rotating Particle), Plenoptic (Random, Smokey Circles, Smokey Lines, Vox, Flame,
// Fountain, Spyro), Spikes (Spike, Amoeba). Particle is Battery's DotPlane, ported from WMP 11's wmp.dll, and
// Ambience runs on the ported Battery palette engine (mediaPlayerVizBattery.js, handed over as the Battery collection's lib), which
// WMP 10 shares; WMP 10's own Ambience presets, Plenoptic and Spikes have no symbols, so their shifts, lines
// and particles are matched by eye to the XP VM (~/.cache/xp-vm/cap c1-c56, bursts in ~/.cache/claude-run/
// wmpviz/seq).
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

    // ---- Ambience: WMP 10's Ambience runs on the same palette engine as Battery (mediaPlayerVizBattery.js,
    // lib.battery): random palettes from a dark first colour (the VM's navy / black grounds), the
    // 5-tap blur that takes one palette step a frame, a shift table, and the waveform drawn as bright lines.
    // WMP 10's Ambience code is not in a build with symbols, so each preset's shift and lines are chosen to
    // match the XP VM's frames (~/.cache/claude-run/wmpviz/seq/a-*); the engine itself is WMP's. Ambience
    // draws smoother than Battery, so the picture is stretched with smoothing. ----

    // a waveform line through the picture: angle a, centre offset o (of the half height), length k (of the
    // diagonal), or from the bottom up (rise) with the level setting its height
    function waveDraw(eng, a, o, k, rise) {
        return {
            flags: 2,
            render(buf) {
                const [W, H] = eng.size;
                const A = eng.audio;
                const put = (x, y) => { x |= 0; y |= 0; if (x >= 0 && y >= 1 && x < W && y < H - 1) { buf[y * W + x] = 255; buf[(y + 1) * W + x] = 250; buf[(y - 1) * W + x] = 250; } };
                if (rise) {
                    let lvl = 0;
                    for (let i = 1; i < 24; i++) lvl += A[i];
                    // three strands of the waveform up from the bottom middle, as tall as the bass is loud
                    const top = H - 1 - Math.min(1, lvl / (23 * 200)) * H * 0.65;
                    for (let k = 0; k < 3; k++) {
                        let px = W / 2 + (k - 1) * 6; let py = H - 1;
                        for (let y = H - 1; y > top; y -= 2) {
                            const x = W / 2 + (k - 1) * 6 + (A[0x800 + ((H - y) * 3 + k * 170 & 1023)] - 128) / 128 * W * 0.05;
                            const n = Math.max(1, Math.ceil(Math.max(Math.abs(x - px), Math.abs(y - py))));
                            for (let j = 0; j <= n; j++) put(px + (x - px) * j / n, py + (y - py) * j / n);
                            px = x; py = y;
                        }
                    }
                    return;
                }
                const ca = Math.cos(a); const sa = Math.sin(a);
                const len = Math.hypot(W, H) * 0.5 * k;
                let lx = 0; let ly = 0;
                for (let i = 0; i <= 128; i++) {
                    const f = i / 64 - 1;
                    const j = (A[0x800 + i * 6] - 128) / 128 * H * 0.08 + o * H / 2;
                    const x = W / 2 + ca * f * len - sa * j;
                    const y = H / 2 + sa * f * len + ca * j;
                    if (i) { const n = Math.max(1, Math.ceil(Math.max(Math.abs(x - lx), Math.abs(y - ly)))); for (let m = 0; m <= n; m++) put(lx + (x - lx) * m / n, ly + (y - ly) * m / n); }
                    lx = x; ly = y;
                }
            }
        };
    }
    // a shift of its own: the source of each pixel in centred units (r, a about the middle)
    function ownShift(fn, wrap) {
        return {
            wrap: !!wrap,
            form(x, y, p, W, H) {
                const s = Math.min(W, H) / 2;
                const dx = (x - W / 2) / s; const dy = (y - H / 2) / s;
                const [sx, sy] = fn(dx, dy, Math.hypot(dx, dy), Math.atan2(dy, dx));
                // truncated toward the middle like WMP's own shifts (SetCenterData): the bias is what lets a
                // small zoom move pixels at 384 x 288 at all
                return [(W >> 1) + Math.trunc(sx * s), (H >> 1) + Math.trunc(sy * s)];
            }
        };
    }
    const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const line = (a, o, k) => (eng) => [waveDraw(eng, a, o || 0, k || 1)];
    const AMBIENCE = [
        ['Swirl', ['ZoomShift', [0.03, -0.008]], [line(0, -0.5), line(0, 0.5)]],
        ['Warp', [ownShift((dx, dy, r, a) => polar(r * 0.96 + 0.004, a + 0.01), true)], [line(0, 0)]],
        ['Anon', [ownShift((dx, dy) => [dx * 0.99 + dy * 0.02, dy * 0.99], true)], [line(0, 0)]],
        ['Falloff', [ownShift((dx, dy) => [dx * 1.02, dy * 0.97], true)], [line(0, 0)]],
        ['Water', [ownShift((dx, dy, r, a) => polar(r * 0.97, a), true)], [line(0, 0)]],
        ['Bubble', [ownShift((dx, dy, r, a) => polar(r < 0.8 ? r * 1.02 : r * 0.97, a + 0.02), true)], [line(0, 0)]],
        ['Dizzy', ['Twirlocity', [3, 0.06, 0]], [line(0, -0.45), line(0, 0.45)]],
        ['Windmill', [ownShift((dx, dy, r, a) => polar(r * 1.01, a + 0.03), true)], [line(-0.7, 0)]],
        ['Niagara', ['LinearShift', [0, 2]], [(eng) => [waveDraw(eng, 0, 0, 0, true)]]],
        ['Blender', ['ZoomShift', [0.06, -0.004]], [line(0, 0)]],
        ['X Marks the Spot', [ownShift((dx, dy, r, a) => polar(r * 1.015, a), true)], [line(0.6, 0), line(-0.6, 0)]],
        ['Down the Drain', [ownShift((dx, dy, r, a) => polar(r * 1.02 + 0.004, a + 0.05), true)], [line(0, -0.6), line(0, 0.6)]],
        ['Thingus', ['ThingusShift', [0.35, 0.05]], [line(0.8, 0)]]
    ];
    const NONE = { frame() {}, resize() {}, dispose() {} };
    const ambienceMakers = AMBIENCE.map(([, shift, draws]) => (c, o) => (o && o.lib ? o.lib.battery(c, { shift, post: draws.map((f) => (typeof f === 'function' ? f(o.lib) : f)), smooth: true }) : NONE));

    function randomOf(list, period) {
        return (canvas, opts) => {
            let cur = null; let since = 0;
            return {
                frame(d, now) {
                    if (!cur || now - since > period) {
                        if (cur) cur.dispose();
                        cur = list[Math.floor(Math.random() * list.length)](canvas, opts);
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


    // ---- Particle (WMP 10's Dotplane): Battery's DotPlane (wmp.dll CDotPlane, lib.dotPlane) drawn
    // at the stage's size: a 37 x 37 spectrum waterfall of single-pixel dots, new rows at the far edge, the
    // camera WMP's. Dots take their colour from their height as on the XP VM (~/.cache/claude-run/wmpviz/
    // seq/particle): red on the floor, through magenta and violet to pale cyan and white on the peaks.
    // Rotating Particle turns the plane about its vertical axis (CDotPlane's rotation bit 2, 300 frames a turn).
    // WMP's 30 frames a second. ----

    const DOT_RAMP = (() => {
        const st = [[0, 255, 0, 0], [0.12, 255, 0, 200], [0.22, 240, 10, 255], [0.4, 150, 80, 255], [0.6, 160, 220, 255], [0.85, 255, 255, 255], [1, 255, 255, 255]];
        const out = new Uint32Array(64);
        for (let i = 0; i < 64; i++) {
            const t = i / 63;
            let k = 0;
            while (k < st.length - 2 && t > st[k + 1][0]) k++;
            const f = (t - st[k][0]) / (st[k + 1][0] - st[k][0]);
            const c = [1, 2, 3].map((j) => Math.round(st[k][j] + (st[k + 1][j] - st[k][j]) * f));
            out[i] = rgb(c[0], c[1], c[2]);
        }
        return out;
    })();

    function createParticle(canvas, rotating, lib) {
        const ctx = canvas.getContext('2d', { alpha: false });
        const core = lib ? lib.dotPlane() : null;
        let img = null; let px = null; let due = 0;
        return {
            frame(d, now) {
                if (!core) return;
                if (now < due && due - now < 100) return;
                due = (now - due > 100 ? now : due) + 1000 / 30;
                lib.levels(d.freq);
                const { w, h } = d;
                if (!img || img.width !== w || img.height !== h) { img = ctx.createImageData(w, h); px = new Uint32Array(img.data.buffer); }
                px.fill(0xff000000);
                core.update(37, rotating ? 2 : 0, true);
                core.project(37, w, h, (x, y, ht) => { px[y * w + x] = DOT_RAMP[Math.min(63, (ht / 60 * 63) | 0)]; });
                ctx.putImageData(img, 0, 0);
            },
            resize() { img = null; },
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

    // ---- Plenoptic's particle scenes (Flame, Spyro): soft light sprites added together on a half-size picture
    // that is stretched to the stage, so crowded sprites burn out to yellow / white as on the VM. Each particle is
    // drawn at a few points along this frame's move: WMP's dotted streaks (~/.cache/xp-vm/cap c49/c51 and the
    // ~110 ms bursts in ~/.cache/claude-run/wmpviz/seq/flame, seq/spyro). Motion is per elapsed time, so a phone's
    // 30 frames a second moves as far as a desktop's 60. ----

    const spriteCache = new Map();
    function sprite(r, g, b) {
        const key = (r << 16) | (g << 8) | b;
        let s = spriteCache.get(key);
        if (s) return s;
        s = document.createElement('canvas');
        s.width = s.height = 16;
        const g2 = s.getContext('2d');
        const gr = g2.createRadialGradient(8, 8, 0, 8, 8, 8);
        gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
        gr.addColorStop(0.45, 'rgba(' + r + ',' + g + ',' + b + ',0.55)');
        gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
        g2.fillStyle = gr;
        g2.fillRect(0, 0, 16, 16);
        if (spriteCache.size > 96) spriteCache.clear();
        spriteCache.set(key, s);
        return s;
    }
    // a colour ramp quantised to 24 sprites
    const ramp = (stops) => {
        const out = [];
        for (let i = 0; i < 24; i++) {
            const t = i / 23 * (stops.length - 1);
            const k = Math.min(stops.length - 2, Math.floor(t));
            const f = t - k;
            const c = [0, 1, 2].map((j) => Math.round(stops[k][j] + (stops[k + 1][j] - stops[k][j]) * f));
            out.push(c);
        }
        return out;
    };
    const rnd = (a, b) => a + Math.random() * (b - a);

    function particleScene(canvas, scene) {
        const ctx = canvas.getContext('2d', { alpha: false });
        const off = document.createElement('canvas');
        const g = off.getContext('2d', { alpha: false });
        let w = 0; let h = 0; let last = 0;
        const parts = [];
        const st = { t: 0 };
        function size(cw, ch) {
            const k = Math.min(0.5, MAXW / Math.max(1, cw));
            w = off.width = Math.max(16, Math.round(cw * k));
            h = off.height = Math.max(16, Math.round(ch * k));
        }
        // one sprite: centre (x, y) in 0..1 of the stage, radii in px of the half-size picture
        const blob = (x, y, rx, ry, c, a) => {
            if (a <= 0.01) return;
            g.globalAlpha = a > 1 ? 1 : a;
            g.drawImage(sprite(c[0], c[1], c[2]), x * w - rx, y * h - ry, rx * 2, ry * 2);
        };
        return {
            frame(d, now) {
                if (!w) size(d.w, d.h);
                const dt = last ? Math.min(3, (now - last) / 33.3) : 1; // in WMP frames (~30 a second)
                last = now;
                st.t += dt;
                g.globalCompositeOperation = 'source-over';
                g.globalAlpha = 1;
                g.fillStyle = '#000';
                g.fillRect(0, 0, w, h);
                const lv = { bass: band(d, 1, 12), mid: band(d, 12, 90), all: band(d, 1, 200) };
                scene.spawn(parts, st, lv, dt, d);
                g.globalCompositeOperation = 'lighter';
                scene.under && scene.under(blob, st, lv, w, h, g);
                for (let i = parts.length - 1; i >= 0; i--) {
                    const p = parts[i];
                    p.age += dt;
                    if (p.age >= p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
                    scene.move(p, dt, st);
                    const f = p.age / p.life;
                    const c = p.ramp[Math.min(23, Math.floor(f * 24))];
                    const a = p.bright * (1 - f);
                    // a dotted streak: the particle where it is and where it was the last few frames
                    const n = p.trail || 1;
                    for (let s = 0; s < n; s++) blob(p.x - p.vx * s * p.gap, p.y - p.vy * s * p.gap, p.rx, p.ry, c, a * (1 - s / (n + 1)));
                }
                scene.over && scene.over(blob, st, lv, w, h, g);
                g.globalAlpha = 1;
                g.globalCompositeOperation = 'source-over';
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(off, 0, 0, d.w, d.h);
            },
            resize(cw, ch) { size(cw, ch); },
            dispose() { parts.length = 0; }
        };
    }

    // Flame (VM, 698x498): a yellow core about 0.26 of the width wide from 0.6 to 0.8 of the height, tongues to
    // red #BA0B00 above it and sparks in dotted columns to the top; a #0000F6 burner dome under it at 0.89-0.98
    const FIRE = ramp([[255, 210, 0], [250, 150, 0], [220, 60, 0], [170, 10, 0], [60, 0, 0]]);
    const SPARK = ramp([[240, 120, 0], [200, 50, 0], [150, 10, 0], [70, 0, 0]]);
    const flameScene = {
        spawn(parts, st, lv, dt) {
            // the core: big short-lived sprites that pile up to yellow
            const n = (10 + lv.all * 30 + lv.bass * 18) * dt;
            for (let i = 0; i < n && parts.length < 700; i++) {
                // a rounded bowl: wide at the top, curving in towards 0.8 of the height
                const dx = (Math.random() + Math.random() - 1) * 0.16;
                const q = dx / 0.16;
                parts.push({
                    x: 0.5 + dx, y: 0.8 - q * q * 0.08 - rnd(0, 0.16), vx: 0, vy: -rnd(0.002, 0.007) * (0.6 + lv.mid),
                    age: 0, life: rnd(8, 20), ramp: FIRE, bright: 0.42, rx: 10, ry: 9, trail: 1, gap: 1
                });
            }
            // tongues and sparks: smaller, from columns across the top of the core, rising in dotted lines
            const m = (1 + lv.all * 7 + lv.bass * 5) * dt;
            for (let i = 0; i < m && parts.length < 700; i++) {
                const spark = Math.random() < 0.45;
                parts.push({
                    x: 0.5 + (Math.floor(rnd(0, 11)) - 5) * 0.026 + rnd(-0.006, 0.006), y: rnd(0.56, 0.64), vx: 0,
                    vy: -(spark ? rnd(0.018, 0.026) : rnd(0.008, 0.014)), age: 0,
                    life: spark ? rnd(22, 40) : rnd(14, 24), ramp: spark ? SPARK : FIRE.slice(9),
                    bright: spark ? 0.75 : 0.6, rx: spark ? 3 : 5.5, ry: spark ? 2.6 : 6, trail: spark ? 3 : 2, gap: spark ? 1.6 : 1
                });
            }
        },
        move(p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; },
        over(blob, st, lv, w, h, g) {
            // the burner: a solid blue dome under the flame, a little bigger on the beat
            const k = 1 + lv.bass * 0.08;
            g.globalCompositeOperation = 'source-over';
            g.globalAlpha = 1;
            g.fillStyle = '#0000f6';
            g.beginPath();
            g.ellipse(w * 0.5, h * 0.985, w * 0.09 * k, h * 0.095 * k, 0, Math.PI, TAU);
            g.fill();
        }
    };

    // Spyro (VM): a spinning ring of lights low in the picture (centre 0.5 / 0.86, about 0.8 x 0.3 of the stage)
    // with a blue middle; the lights fling red and orange sparks sideways and up in dotted streaks
    const RING = ramp([[255, 255, 255], [255, 220, 120], [120, 120, 255], [30, 30, 255]]);
    const FLING = ramp([[255, 90, 10], [235, 35, 0], [215, 15, 0], [150, 0, 0], [60, 0, 0]]);
    const SPIN = [1, 0.7, 0.42];
    const spyroScene = {
        spawn(parts, st, lv, dt) {
            st.spin = (st.spin || 0) + (0.06 + lv.mid * 0.08) * dt;
            const n = (0.4 + lv.all * 2.5 + lv.bass * 2) * dt;
            for (let i = 0; i < n && parts.length < 400; i++) {
                const ring = Math.floor(Math.random() * 3);
                const dir = ring % 2 ? -1.3 : 1;
                const a = st.spin * dir + Math.floor(Math.random() * 4) / 4 * TAU;
                parts.push({
                    x: 0.5 + Math.cos(a) * 0.42 * SPIN[ring], y: 0.85 + Math.sin(a) * 0.15 * SPIN[ring],
                    vx: -Math.sin(a) * Math.sign(dir) * rnd(0.01, 0.02), vy: -rnd(0.003, 0.008) * (0.6 + lv.mid),
                    age: 0, life: rnd(60, 130), ramp: FLING, bright: 0.95, rx: 5.5, ry: 4, trail: 4, gap: 1.8
                });
            }
        },
        move(p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.975, dt); },
        under(blob, st, lv) {
            // the blue body inside the ring
            for (let i = 0; i < 7; i++) blob(0.5 + (i - 3) * 0.085 + Math.sin(st.t * 0.05 + i) * 0.02, 0.87 + (i % 2) * 0.05, 34, 20, [10, 10, 255], 0.5 + lv.bass * 0.4);
            // the ring's lights, smeared into arcs along their turn
            for (let ring = 0; ring < 3; ring++) {
                const dir = ring % 2 ? -1.3 : 1;
                for (let k = 0; k < 2; k++) {
                    const a0 = st.spin * dir + k / 2 * TAU + ring;
                    const e = Math.min(1, lv.all * 0.9 + (k % 2 ? lv.bass : lv.mid) * 0.7);
                    for (let s = 0; s < 9; s++) {
                        const a = a0 - Math.sign(dir) * s * 0.07;
                        blob(0.5 + Math.cos(a) * 0.42 * SPIN[ring], 0.85 + Math.sin(a) * 0.15 * SPIN[ring], 8, 6, RING[Math.min(23, Math.floor((1 - e) * 12) + s)], (0.35 + e * 0.7) * (1 - s / 10));
                    }
                }
            }
        }
    };

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
        ['Flame', (c) => particleScene(c, flameScene)],
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
        ['Spyro', (c) => particleScene(c, spyroScene)]
    ];

    const reg = (detail) => document.dispatchEvent(new CustomEvent('melaton:wmp-vis-register', { detail: Object.assign({ pkg: 'wmpvis-classic' }, detail) }));
    reg({
        id: 'ambience',
        label: 'Ambience',
        presets: [{ name: 'Random', create: randomOf(ambienceMakers, 20000) }].concat(AMBIENCE.map(([name], i) => ({ name, create: ambienceMakers[i] })))
    });
    reg({ id: 'particle', label: 'Particle', presets: [{ name: 'Particle', create: (c, o) => createParticle(c, false, o && o.lib) }, { name: 'Rotating Particle', create: (c, o) => createParticle(c, true, o && o.lib) }] });
    reg({
        id: 'plenoptic',
        label: 'Plenoptic',
        presets: [{ name: 'Random', create: randomOf(PLENOPTIC.map((p) => p[1]), 20000) }].concat(PLENOPTIC.map(([name, create]) => ({ name, create })))
    });
    reg({ id: 'spikes', label: 'Spikes', presets: [{ name: 'Spike', create: createSpike }, { name: 'Amoeba', create: createAmoeba }] });
})();
