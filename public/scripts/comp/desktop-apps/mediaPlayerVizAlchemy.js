// Melaton Media Player: Alchemy (WMP 11's Alchemy collection, mpvis.dll), its one entry "Random".
// public/scripts/comp/desktop-apps/mediaPlayerVizAlchemy.js
//
// A port of mpvis.dll's "Tolerance" renderer, read from the x64 DLL with its public symbols (class names are
// mpvis's: CToleranceRenderData, CToleranceShift, CTWonderWave, CTSuperStar, CTAtomBalls, CTColor, ...):
// - A square 32-bit picture (256 x 256 under 30,000 px of stage, else 512 x 512; phones use 256) shown the way
//   WMP's Direct3D quad shows it: the middle 0.828 of it stretched to the stage, point sampled.
// - Every frame the picture is warped through an integer source map and softened by a 5-tap integer blur
//   (3/16 a neighbour, 1/4 the centre, floored), and rows 0 and H-1 are cleared: flat colour fields hold,
//   gradients wear away, black creeps in at the edges.
// - The warps (Linear with its zig-zag shakes, Stretch, Snafu, OScope's mirrors and tiles, sometimes two
//   averaged) change every 90..500 frames, morphing through 22 steps; the next map is built 3 rows a frame.
// - Two elements are drawn on top at a time, each re-rolled every 50..350 frames: WonderWave (a rotating
//   straight line: its amplitude is truncated to 0 in mpvis, which is what leaves the ray fans), SuperStar (a
//   waveform star polygon) and AtomBalls (two orbs mirrored through the middle, joined on beats).
// - Colours are random 24-bit colours drifting with a sine ease (CTColor); the ground is black.
// - WMP runs it about 30 frames a second; a faster display repeats frames. BassBounce is left out: only
//   WMP's full-screen DirectDraw path reads its crop rectangle.
(function () {
    'use strict';

    const PI = Math.PI;
    const rand = () => (Math.random() * 32768) | 0;
    const rnd = () => rand() / 32767;
    const roundA = (v) => (v > 0 ? Math.trunc(v + 0.5) : Math.trunc(v - 0.5));
    const trunc = Math.trunc;

    // colours are ImageData words (0xAABBGGRR); every operation is per channel, so the order does not matter
    const randomColor = () => (0xff000000 | ((rand() & 255) << 16) | ((rand() & 255) << 8) | (rand() & 255)) >>> 0;
    function lerp(c1, c2, t) {
        let out = 0xff000000;
        for (let sh = 0; sh < 24; sh += 8) {
            const a = (c1 >>> sh) & 255;
            const b = (c2 >>> sh) & 255;
            out |= ((a + roundA((b - a) * t)) & 255) << sh;
        }
        return out >>> 0;
    }

    // CTColor: a colour drifting from one random colour to the next with a sine ease, or back and forth
    function tColor() {
        const c = { cur: 0, from: 0, to: 0, step: 0, len: 0, pingpong: false, segs: 1 };
        c.setup = (from, to, len, segs) => {
            c.step = 0;
            if (len <= 0) len = rand() % 100 + 1;
            c.segs = segs;
            c.pingpong = segs > 1;
            if (c.pingpong) len = (len / segs) | 0;
            c.len = len;
            c.from = c.cur = from;
            c.to = to;
        };
        c.advance = () => {
            if (++c.step > c.len) {
                if (c.pingpong) c.setup(c.to, c.from, c.len * c.segs, c.segs);
                else c.setup(c.cur, randomColor(), rand() % 100, 1);
            } else {
                c.cur = lerp(c.from, c.to, Math.sin(c.step / c.len * PI / 2));
            }
        };
        c.from = c.cur = randomColor();
        c.to = randomColor();
        return c;
    }

    function createRandom(canvas, opts) {
        const ctx = canvas.getContext('2d', { alpha: false });
        const off = document.createElement('canvas');
        const octx = off.getContext('2d', { alpha: false });
        const phone = !!(opts && opts.phone);
        const vis = opts && opts.lib;
        let W = 0; let H = 0; let img = null; let front = null; let tmp = null;
        let due = 0;
        const A = new Uint8Array(4096);
        const au = { bass: 0, hist: new Float32Array(30), k: 0, sinceBeat: 0, sinceBig: 0, beat: false, bigBeat: false };

        // ---- audio (CToleranceRenderData::SetLevels) ----
        function levels(d) {
            if (vis) { vis.levels(d.freq); A.set(vis.audio.subarray(0, 0x800)); }
            const n = Math.min(1024, d.wave.length);
            A.set(d.wave.subarray(0, n), 0x800);
            A.set(d.wave.subarray(0, n), 0xc00);
            au.bass = (A[1] + A[3] + A[5] + A[0x402] + A[0x404] + A[0x406]) / 1200;
            au.hist[au.k] = au.bass;
            au.k = (au.k + 1) % 30;
            let avg = 0;
            for (let i = 0; i < 30; i++) avg += au.hist[i];
            avg /= 30;
            au.sinceBeat++; au.sinceBig++; au.beat = false; au.bigBeat = false;
            if (au.sinceBeat >= 10 && au.bass > avg * 1.1) {
                au.beat = true; au.sinceBeat = 0;
                if (au.bass > 0.9 && au.bass > avg * 1.2 && au.sinceBig > 20) { au.bigBeat = true; au.sinceBig = 0; }
            }
        }

        // ---- plotting (CTLineRender) ----
        function plot(x, y, col, mode, t) {
            if (x < 2 || x >= W - 2 || y < 2 || y >= H - 2) return;
            const i = y * W + x;
            const f = front;
            if (mode === 0) { f[i] = lerp(col, f[i], 0.9); return; }
            f[i] = col;
            const k = mode === 1 ? 0.3 : t;
            f[i - 1] = lerp(col, f[i - 1], k); f[i + 1] = lerp(col, f[i + 1], k);
            f[i - W] = lerp(col, f[i - W], k); f[i + W] = lerp(col, f[i + W], k);
            if (mode < 2) return;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const j = i + dy * W + dx;
                    let out = 0xff000000;
                    for (let sh = 0; sh < 24; sh += 8) {
                        const s = ((f[j] >>> sh) & 255) + ((f[j - W] >>> sh) & 255) + ((f[j + W] >>> sh) & 255) + ((f[j - 1] >>> sh) & 255) + ((f[j + 1] >>> sh) & 255);
                        out |= ((s / 5) | 0) << sh;
                    }
                    f[j] = out >>> 0;
                }
            }
        }
        // a DDA from p to q, the end point left out, clipped to the margin
        function segment(x0, y0, x1, y1, col, P) {
            const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
            const m = P.margin || 0;
            for (let i = 0; i < n; i++) {
                const x = roundA(x0 + (x1 - x0) * i / n); const y = roundA(y0 + (y1 - y0) * i / n);
                if (x >= m && x < W - m && y >= m && y < H - m) plot(x, y, col, P.mode, P.t);
            }
        }
        // CTWaveformRender: the waveform along a line, its colour stepping along the line's segments
        function wave(x1, y1, x2, y2, P) {
            const dx = x2 - x1; const dy = y2 - y1;
            const N = Math.min(P.points, Math.max(Math.abs(dx), Math.abs(dy)) + 1);
            if (N < 2) return;
            const a = Math.atan2(dy, dx) + PI / 2;
            const pc = Math.cos(a); const ps = Math.sin(a); const h = N >> 1;
            P.color.len = Math.max(1, (N / P.color.segs) | 0);
            let px = x1; let py = y1;
            let col = P.color.cur; P.color.advance();
            for (let i = 1; i < N; i++) {
                const j = i > h ? 2 * h - i : i;
                let v = P.amp ? P.amp / 128 * ((A[0x800 + j] + A[0xc00 + j]) * 0.5 - 128) : 0;
                if (v) v *= P.env === 0 ? Math.abs(Math.sin(i / N * P.loops * PI)) : P.env === 1 ? (i < h ? i / h : (2 * h - i) / h) : 1;
                const qx = roundA(x1 + dx * i / N + v * pc); const qy = roundA(y1 + dy * i / N + v * ps);
                segment(px, py, qx, qy, col, P);
                px = qx; py = qy;
                col = P.color.cur; P.color.advance();
            }
        }

        // ---- the warps (CToleranceShift's effects) ----
        function linearFx() {
            const e = { kind: 'linear', oobIdent: false, combine: true };
            e.randomize = () => {
                do { e.xs = rand() % 7 - 3; e.ys = rand() % 7 - 3; } while (!e.xs && !e.ys);
                e.falloff = rand() % 3 !== 0; e.px = rnd() * 0.1; e.py = rnd() * 0.1; e.dir = rand() % 8; e.shake = rand() % 3; e.loops = rand() % 15 + 1;
            };
            e.form = (x, y) => {
                if (!e.falloff) { x += e.xs; y += e.ys; }
                else {
                    const d = e.dir;
                    if (d === 0 || d === 4 || d === 6) x = trunc((1 + e.px) * x);
                    if (d === 2 || d === 5 || d === 7) x -= trunc(e.px * (W - x - 1));
                    if (d === 1 || d === 4 || d === 7) y = trunc((1 + e.py) * y);
                    if (d === 3 || d === 5 || d === 6) y -= trunc(e.py * (H - y - 1));
                }
                if (e.shake === 1) x += roundA(Math.sin(y / H * e.loops * PI) * 3 * e.ys);
                if (e.shake === 2) y += roundA(Math.sin(x / W * e.loops * PI) * 3 * e.xs);
                return [x, y];
            };
            return e;
        }
        function stretchFx() {
            const e = { kind: 'stretch', oobIdent: true, combine: true };
            e.randomize = () => {
                e.shake = rand() % 2 === 0; e.loops = rand() % 15 + 1;
                e.rot = e.shake ? rnd() * 0.44 - 0.22 : rnd() * 0.2 - 0.1;
                const move = rnd() * 0.25 + 0.05;
                e.flow = rand() % 2 === 0;
                const clamp = (v) => Math.min(0.99, Math.max(0.01, v));
                e.fx = trunc(W * clamp(rnd() * 0.9 + 0.05)); e.fy = trunc(H * clamp(rnd() * 0.9 + 0.05));
                e.move = trunc(H * move);
                const c = e.flow ? [e.fx, e.fy] : [W >> 1, H >> 1];
                e.maxD = Math.max(Math.hypot(c[0], c[1]), Math.hypot(W - c[0], c[1]), Math.hypot(c[0], H - c[1]), Math.hypot(W - c[0], H - c[1]));
            };
            e.form = (x, y) => {
                const cx = e.flow ? e.fx : W >> 1; const cy = e.flow ? e.fy : H >> 1;
                const dx = x - cx; const dy = y - cy;
                const a = Math.atan2(dy, dx); const r = Math.hypot(dx, dy); const t = r / e.maxD;
                const r2 = r - t * t * t * e.move;
                const a2 = a + e.rot * (e.shake ? Math.sin(e.loops * t * PI) : t);
                return [trunc(Math.cos(a2) * r2) + cx, trunc(Math.sin(a2) * r2) + cy];
            };
            return e;
        }
        function snafuFx() {
            const e = { kind: 'snafu', oobIdent: true, combine: true };
            e.randomize = () => { e.w = rand() % 40 + 1; e.speed = rand() % 4 + 1; e.vertical = rand() % 4 === 0; };
            e.form = (x, y) => {
                const Wd = e.w; const my = y % (2 * Wd); const mx = x % (2 * Wd);
                if (e.vertical) y += mx > Wd ? e.speed : -e.speed;
                else if (my > Wd) { if (W - x < Wd && mx > my - Wd) y += e.speed; else x += e.speed; }
                else if (x < Wd && mx > my) y += e.speed;
                else x -= e.speed;
                return [x, y];
            };
            return e;
        }
        function oscopeFx() {
            const e = { kind: 'oscope', oobIdent: false, combine: false };
            const inner = [stretchFx(), linearFx(), snafuFx()];
            e.randomize = () => {
                e.refl = rand() % 5; e.inner = rand() % 4;
                if (e.inner < 3) inner[e.inner].randomize();
                e.ocean = rnd() * 0.4 - 0.2;
                e.ccr = 50; e.L = 10; e.box = 1;
                if (e.refl === 3) { e.ccr = rand() % 250 + 5; e.L = rand() % 50 + 3; }
                if (e.refl === 4) e.box = rand() % 10 === 0 ? rand() % 300 + 1 : 1;
            };
            const inn = (x, y) => {
                if (e.inner < 3) return inner[e.inner].form(x, y);
                const cx = W >> 1; const cy = H >> 1; const dx = cx - x; const dy = cy - y;
                const r = Math.hypot(dx, dy); const a = Math.atan2(dy, dx) + e.ocean;
                return [(W - cx) - trunc(Math.cos(a) * r), (H - cy) - trunc(Math.sin(a) * r)];
            };
            const quad = (x, y) => { let m = false; const cx = W >> 1; const cy = H >> 1; if (x > cx) { x = W - x; m = true; } if (y > cy) { y = H - y; m = true; } return m ? [x, y] : inn(x, y); };
            e.form = (x, y) => {
                const cx = W >> 1; const cy = H >> 1;
                switch (e.refl) {
                    case 0: return quad(x, y);
                    case 1:
                        if (W * y < H * x) {
                            if (W * y < (W - x) * H) return x >= cx ? [2 * cx - x, y] : inn(x, y);
                            return [cx - x + W, Math.abs(y - cy)];
                        }
                        if (W * y < (W - x) * H) return [cx - x, Math.abs(y - cy)];
                        return [x > cx ? 2 * cx - x : x, H - y];
                    case 2: {
                        const dx = x - cx; const dy = y - cy; const r = Math.hypot(dx, dy); const R = 0.25 * Math.hypot(W, H);
                        if (((trunc(r) / trunc(R)) | 0) === 0) return quad(x, y);
                        const a = Math.atan2(dy, dx); const r2 = 2 * R - r;
                        return [trunc(Math.cos(a) * r2) + cx, trunc(Math.sin(a) * r2) + cy];
                    }
                    case 3: {
                        if (Math.hypot(cx - x, cy - y) <= e.ccr) return inn(x, y);
                        const c = e.L + 2; const s = 2 * e.ccr / e.L;
                        return [roundA((x % c) * s) + cx - e.ccr, roundA((y % c) * s) + cy - e.ccr];
                    }
                    default:
                        if (((x / e.box) | 0) & 1 || ((y / e.box) | 0) & 1) return [x, y];
                        return inn(x, y);
                }
            };
            return e;
        }

        // the shift: the current map, the next one being built, and the morph between them
        const pool = [oscopeFx(), oscopeFx(), oscopeFx(), oscopeFx(), linearFx(), linearFx(), stretchFx(), stretchFx(), snafuFx(), snafuFx()];
        const sh = { cur: null, next: null, old: null, nextRow: 0, nextFx: null, inTrans: false, idx: 0, ctr: 0, mode: 0, T: 1, used: [] };
        function pickFx() {
            const free = pool.filter((e) => !sh.used.includes(e));
            const a = free[rand() % free.length];
            a.randomize();
            let b = null;
            if (rand() % 5 === 0 && a.combine) {
                const rest = free.filter((e) => e !== a && e.combine);
                if (rest.length) { b = rest[rand() % rest.length]; b.randomize(); }
            }
            return [a, b];
        }
        function buildRows(map, fx, from, rows) {
            const [a, b] = fx;
            for (let y = from; y < Math.min(H, from + rows); y++) {
                for (let x = 0; x < W; x++) {
                    let [sx, sy] = a.form(x, y);
                    if (sx >>> 0 >= W) sx = a.oobIdent ? x : 0;
                    if (sy >>> 0 >= H) sy = a.oobIdent ? y : 0;
                    if (b) {
                        let [bx, by] = b.form(sx, sy);
                        if (bx >>> 0 >= W) bx = b.oobIdent ? sx : 0;
                        if (by >>> 0 >= H) by = b.oobIdent ? sy : 0;
                        sx = (bx + x) >> 1; sy = (by + y) >> 1;
                    }
                    map[y * W + x] = sy * W + sx;
                }
            }
            return from + rows;
        }
        function startNext() {
            sh.nextFx = pickFx();
            sh.used = [sh.nextFx[0], sh.nextFx[1]].concat(sh.curFx || []).filter(Boolean);
            sh.next = new Int32Array(W * H);
            sh.nextRow = 0;
        }
        function shiftRandomize() {
            if (sh.inTrans || sh.nextRow < H) return;
            sh.mode = Math.min(rand() % 3, rand() % 3);
            sh.T = rand() % 3 === 0 ? rand() % 15 + 1 : rand() % 5 + 10;
            if ([...(sh.curFx || []), ...sh.nextFx].some((e) => e && e.kind === 'oscope')) sh.T = 1;
            sh.old = sh.cur; sh.cur = sh.next; sh.curFx = sh.nextFx;
            sh.idx = 0; sh.ctr = 0; sh.inTrans = true;
            startNext();
        }
        function shiftRender() {
            if (sh.nextRow < H) sh.nextRow = buildRows(sh.next, sh.nextFx, sh.nextRow, 3);
            let map = sh.cur;
            if (sh.inTrans) {
                if (sh.mode === 0) { const c = sh.ctr++; sh.idx = c > 22 * sh.T ? 22 : Math.max(0, trunc(Math.sin((c + 1) / (22 * sh.T) * PI / 2) * 22)); }
                else if (sh.mode === 1) { if ((sh.ctr++) % sh.T === 0) sh.idx++; }
                else if (rand() % sh.T === 0) sh.idx++;
                if (sh.idx >= 22) sh.inTrans = false;
            }
            const N = W * H;
            const f = front; const t = tmp;
            if (sh.inTrans) {
                const k = (sh.idx + 1) / 23; const o = sh.old; const n = map;
                for (let i = 0; i < N; i++) {
                    const oy = (o[i] / W) | 0; const ox = o[i] - oy * W; const ny = (n[i] / W) | 0; const nx = n[i] - ny * W;
                    t[i] = f[(oy + trunc((ny - oy) * k)) * W + ox + trunc((nx - ox) * k)];
                }
            } else {
                for (let i = 0; i < N; i++) t[i] = f[map[i]];
            }
            // the 5-tap integer blur; rows 0 and H-1 go black
            for (let i = W; i < N - W; i++) {
                const c = t[i]; const l = t[i - 1]; const r = t[i + 1]; const u = t[i - W]; const d = t[i + W];
                const r0 = ((((l & 255) + (r & 255) + (u & 255) + (d & 255)) >> 2) * 3 + (c & 255)) >> 2;
                const g0 = (((((l >>> 8) & 255) + ((r >>> 8) & 255) + ((u >>> 8) & 255) + ((d >>> 8) & 255)) >> 2) * 3 + ((c >>> 8) & 255)) >> 2;
                const b0 = (((((l >>> 16) & 255) + ((r >>> 16) & 255) + ((u >>> 16) & 255) + ((d >>> 16) & 255)) >> 2) * 3 + ((c >>> 16) & 255)) >> 2;
                f[i] = (0xff000000 | (b0 << 16) | (g0 << 8) | r0) >>> 0;
            }
            f.fill(0xff000000, 0, W - 1);
            f.fill(0xff000000, N - W, N - 1);
        }

        // ---- the elements ----
        function wonderWave() {
            const e = { type: 4, weight: 1.0, angle: 0, cA: tColor(), cB: tColor() };
            e.randomize = () => {
                e.mode = rand() % 3; e.points = rand() % 512 + 10; e.loops = rand() % 4 + 1; e.spin = rnd() * 0.26 - 0.13; e.spinMode = rand() % 4;
                e.bassFlex = rand() % 2 === 0; e.cross = rand() % 3 === 0; e.crossMode = rand() % 3; e.crossAng = rnd() * PI - PI / 2;
            };
            e.render = () => {
                e.cA.advance(); e.cB.advance();
                const lc = tColor(); lc.setup(e.cB.cur, e.cA.cur, 0, 2 * e.loops);
                const len = Math.hypot(W, H) * (e.bassFlex ? au.bass : 1);
                const rad = (a) => {
                    const h = len / 2; const cx = W >> 1; const cy = H >> 1;
                    wave(cx + roundA(Math.cos(a) * h), cy + roundA(Math.sin(a) * h), cx + roundA(Math.cos(a + PI) * h), cy + roundA(Math.sin(a + PI) * h),
                        { amp: 0, points: e.points, mode: e.mode, t: 0.1, margin: [0, 1, 9][e.mode], color: lc });
                };
                rad(e.angle + PI / 2);
                if (e.cross) {
                    let a2;
                    if (e.crossMode === 0) { e.crossAng -= e.spin * au.bass * 0.5; a2 = e.crossAng + e.angle; }
                    else if (e.crossMode === 1) a2 = e.crossAng + e.angle;
                    else a2 = e.angle;
                    rad(a2);
                }
                e.angle += [au.bass * au.bass * e.spin, e.spin * au.bass, e.spin, 0][e.spinMode];
            };
            return e;
        }
        function superStar() {
            const e = { type: 4, weight: 0.5, rot: 0, cA: tColor(), cB: tColor() };
            e.randomize = () => {
                e.scale = rnd() * 0.8 + 0.2;
                e.n = rand() % 12 + 3;
                if (e.n === 5 || e.n === 6) e.n += rand() % 3 === 0 ? 15 : 2;
                e.maxSpin = rnd() * 0.6 - 0.3;
            };
            e.render = () => {
                const R = au.bass * (H >> 1) * e.scale;
                const hi = (A[501] + A[503] + A[505] + A[0x400 + 502] + A[0x400 + 504] + A[0x400 + 506]) / 600;
                const k = (e.n >> 1) + 1 + (e.n === 10 || e.n === 14 ? 1 : 0); const st = 2 * PI / e.n * k;
                e.rot += hi * e.maxSpin;
                if (e.rot > 2 * PI) e.rot -= 2 * PI;
                e.cA.advance(); e.cB.advance();
                const lc = tColor(); lc.setup(e.cA.cur, e.cB.cur, 0, 3);
                const cx = W >> 1; const cy = H >> 1;
                let a = e.rot; let px = cx + trunc(Math.cos(a) * R); let py = cy + trunc(Math.sin(a) * R);
                for (let i = 0; i <= e.n; i++) {
                    a += st;
                    const qx = cx + trunc(Math.cos(a) * R); const qy = cy + trunc(Math.sin(a) * R);
                    wave(px, py, qx, qy, { amp: 50, points: 50, env: 0, loops: 2, mode: 3, t: 0.5, margin: 0, color: lc });
                    px = qx; py = qy;
                }
            };
            return e;
        }
        function atomBalls() {
            const e = { type: 4, weight: 0.9, invert: false, link: 0, rv: 0, cA: tColor(), cB: tColor() };
            e.randomize = () => {
                e.x = rand() % W; e.y = rand() % H; e.vx = rnd() * 4 - 2; e.vy = rnd() * 4 - 2;
                e.R1 = rnd() * 21 + 9; e.r = e.R1; e.damp = rnd() * 0.4 + 0.5;
                e.cA.setup(randomColor(), randomColor(), rand() % 50 + 5, 1); e.cB.setup(randomColor(), randomColor(), rand() % 50 + 5, 1);
            };
            const ball = (cx, cy, r, al) => {
                const c = e.invert ? ((0xffffffff - e.cA.cur) | 0xff000000) >>> 0 : e.cA.cur;
                for (let y = cy - r; y <= cy + r; y++) {
                    for (let x = cx - r; x <= cx + r; x++) {
                        if (x >>> 0 >= W || y >>> 0 >= H) continue;
                        const i = y * W + x;
                        const v = (r * r - ((x - cx) * (x - cx) + (y - cy) * (y - cy))) / r;
                        if (v >= 1) front[i] = lerp(c, front[i], Math.cos((v / r) * (v / r) * PI / 2) * al);
                        if (v > -3.14 && v < 3.14) front[i] = lerp(front[i], e.cB.cur, (Math.cos(Math.abs(v)) + 1) / 2);
                    }
                }
            };
            e.render = () => {
                e.x += e.vx; e.y += e.vy;
                let b = false;
                if (e.x < 0 || e.x > W) { e.vx = -e.vx; b = true; } else e.vx *= 0.8;
                if (e.y < 0 || e.y > H) { e.vy = -e.vy; b = true; } else e.vy *= 0.8;
                if (!b) { e.vx += (rand() % 2 * 2 - 1) * au.bass; e.vy += (rand() % 2 * 2 - 1) * au.bass; }
                const x1 = roundA(e.x); const y1 = roundA(e.y); const x2 = W - x1; const y2 = H - y1;
                e.rv += e.R1 - e.r; e.rv = (e.rv + 0.8 * au.bass) * e.damp; e.r += e.rv;
                let r1 = trunc(e.r * au.bass) + 1; let r2 = r1; let alpha = au.bass;
                if (au.beat) { e.invert = !e.invert; e.link = 5; r1 *= 2; r2 *= 2; alpha = 0.4; }
                else if (e.link) r1 = roundA(e.link / 2.5 * r1);
                if (e.link) {
                    const lc = tColor(); lc.setup(e.cA.cur, e.cB.cur, 0, rand() % 6 + 1);
                    wave(x1, y1, x2, y2, { amp: 50, points: 500, env: 0, loops: 2, mode: 1, margin: 1, color: lc });
                    e.link--;
                }
                ball(x1, y1, Math.min(r1, W), Math.min(1, alpha)); ball(x2, y2, Math.min(r2, W), Math.min(1, alpha));
                e.cA.advance(); e.cB.advance();
            };
            return e;
        }

        // ---- the schedule (the one built-in render cycle): the shift, then two element steps ----
        const elements = [wonderWave(), superStar(), atomBalls()];
        const steps = [
            { type: 3, min: 1, max: 1, minDur: 90, maxDur: 500, flags: 0, timer: 0, sel: [] },
            { type: 4, min: 1, max: 2, minDur: 50, maxDur: 350, flags: 2, timer: 0, sel: [] },
            { type: 4, min: 1, max: 3, minDur: 50, maxDur: 350, flags: 2, timer: 0, sel: [] }
        ];
        function select(s) {
            s.sel.forEach((e) => { e.active = false; });
            s.sel = [];
            s.timer = rand() % (s.maxDur - s.minDur + 1) + s.minDur;
            if (s.type === 3) { shiftRandomize(); return; }
            let tries = s.flags & 2 ? 10 : s.flags & 1 ? 3 : 1;
            let cnt = s.max;
            while (tries--) cnt = Math.min(cnt, rand() % (s.max - s.min + 1) + s.min);
            for (let a = 99; a >= 0 && cnt > 0; a--) {
                const e = elements[a >= elements.length ? rand() % elements.length : a];
                if (e.type !== s.type || e.active || rnd() > e.weight) continue;
                s.sel.push(e); e.randomize(); e.active = true; cnt--;
            }
        }

        function size(cw, ch) {
            const S = phone || cw * ch < 30000 ? 256 : 512;
            if (S === W) return;
            W = H = off.width = off.height = S;
            img = octx.createImageData(S, S);
            front = new Uint32Array(img.data.buffer);
            front.fill(0xff000000);
            tmp = new Uint32Array(S * S);
            // the first map is built in full, the next a few rows a frame
            sh.curFx = pickFx();
            sh.used = sh.curFx.filter(Boolean);
            sh.cur = new Int32Array(S * S);
            buildRows(sh.cur, sh.curFx, 0, S);
            sh.inTrans = false;
            startNext();
            steps.forEach((s) => { s.sel.forEach((e) => { e.active = false; }); s.sel = []; s.timer = 0; });
        }

        return {
            frame(d, now) {
                if (!W) size(d.w, d.h);
                if (now < due && due - now < 100) return; // WMP's 30 frames a second
                due = (now - due > 100 ? now : due) + 1000 / 30;
                levels(d);
                for (const s of steps) {
                    if (--s.timer <= 0) select(s);
                    if (s.type === 3) shiftRender();
                    else s.sel.forEach((e) => e.render());
                }
                octx.putImageData(img, 0, 0);
                // WMP's quad shows the middle 0.828 of the texture, point sampled, stretched to the stage
                const v = 0.8284271; const o = (1 - v) / 2 * W;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(off, o, o, v * W, v * H, 0, 0, d.w, d.h);
            },
            resize(cw, ch) { size(cw, ch); due = 0; },
            dispose() { front = tmp = sh.cur = sh.next = sh.old = null; W = H = 0; }
        };
    }

    document.dispatchEvent(new CustomEvent('melaton:wmp-vis-register', {
        detail: { id: 'alchemy', label: 'Alchemy', presets: [{ name: 'Random', create: createRandom }] }
    }));
})();
