// JezzBall's rules and drawing (Microsoft Entertainment Pack 4, 1992, by Dima Pavlovsky; Turbo
// Pascal for Windows), decompiled from JEZZBALL.EXE and checked against the game running on the
// Vista VM under otvdm (notes in docs/vista-games.md, "JezzBall"). The window, menus and dialogs
// are jezzball.js; this file is the client area.
//
//   - the client is a 496 x 322 GDI surface: black, a 30 x 22 grid of 16 x 12 px cells (row 1 at
//     the bottom, y grows upward) whose outer ring is black, so the chamber is 28 x 20 = 560 cells
//   - every drawing call is the original's: SRCCOPY tiles from the JEZZ-NEW sheet, balls XORed on
//     (SRCINVERT, frames pre-XORed with the tile under them), System-font ExtTextOut(ETO_OPAQUE)
//     centred on a point with 8 px of black either side; the surface keeps what was drawn, so the
//     original's leftovers (a shorter status string, XOR garbage where two balls overlap) stay
//   - the game moves in half steps: phase 0 starts a move (half a cell), phase 1 finishes it;
//     one tick per phase, 62.5 ms at Fast and 109.375 ms at Slow (Vista rounds SetTimer(50) and
//     SetTimer(100) up to whole 15.625 ms timer periods; measured on the VM)
//   - score and cleared area are Turbo Pascal 6-byte Reals (JZ.Real, the RTL's own rounding), so
//     the 75% check and the bonus land on the same cell counts as the original
//   - Random is Turbo Pascal's (RandSeed * 134775813 + 1), seeded from the clock like Randomize;
//     the demo seeds 17 and replays the original's recorded clicks
(function (root) {
    'use strict';

    const JZ = root.JezzBallCore || {};
    root.JezzBallCore = JZ;

    // ---- constants ---------------------------------------------------------------------------
    const COLS = 30;
    const ROWS = 22;
    const CELLS = 560; // 28 x 20 open cells
    const CLIENT_W = 496;
    const CLIENT_H = 322;
    const FAST = 50;
    const SLOW = 100;
    // Vista's SetTimer periods for the game's 50 / 100 ms requests
    const TICK_MS = { [FAST]: 62.5, [SLOW]: 109.375 };
    const MAX_BALLS = 50;

    // cell types
    const FILLED = 0;
    const OPEN = 1;

    const SRCCOPY = 0;
    const SRCINVERT = 1;

    // ---- Turbo Pascal Random ------------------------------------------------------------------
    class TPRandom {
        constructor(seed) {
            this.seed = seed >>> 0;
        }

        // Random(n): RandSeed := RandSeed * 134775813 + 1; result := Hi(RandSeed) * n shr 16
        next(n) {
            this.seed = (Math.imul(this.seed, 134775813) + 1) >>> 0;
            return Math.floor(((this.seed >>> 16) * (n & 0xffff)) / 65536);
        }

        // Randomize: DOS Get Time, RandSeed := (second shl 8 or hundredths) shl 16 or (hour shl 8 or minute)
        static clockSeed(d) {
            const t = d || new Date();
            const cx = (t.getHours() << 8) | t.getMinutes();
            const dx = (t.getSeconds() << 8) | Math.floor(t.getMilliseconds() / 10);
            return ((dx << 16) | cx) >>> 0;
        }
    }
    JZ.TPRandom = TPRandom;

    // ---- the 6-byte Real: jezzballReal.js, loaded first -----------------------------------------
    const R = () => JZ.Real;

    // ---- GDI surface ----------------------------------------------------------------------------
    // An RGBA framebuffer with the three operations the game uses. Colours are [r, g, b].
    class Surface {
        constructor(w, h) {
            this.w = 0;
            this.h = 0;
            this.data = null;
            this.dirty = true;
            this.resize(w, h);
        }

        // a larger client keeps what was drawn at the top left; the new area is black
        resize(w, h) {
            w = Math.max(1, Math.floor(w));
            h = Math.max(1, Math.floor(h));
            if (w === this.w && h === this.h) return;
            const next = new Uint8ClampedArray(w * h * 4);
            for (let i = 3; i < next.length; i += 4) next[i] = 255;
            if (this.data) {
                const cw = Math.min(w, this.w);
                const ch = Math.min(h, this.h);
                for (let y = 0; y < ch; y++) {
                    next.set(this.data.subarray(y * this.w * 4, (y * this.w + cw) * 4), y * w * 4);
                }
            }
            this.w = w;
            this.h = h;
            this.data = next;
            this.dirty = true;
        }

        fill(x, y, w, h, rgb) {
            const x0 = Math.max(0, x);
            const y0 = Math.max(0, y);
            const x1 = Math.min(this.w, x + w);
            const y1 = Math.min(this.h, y + h);
            const d = this.data;
            for (let yy = y0; yy < y1; yy++) {
                let o = (yy * this.w + x0) * 4;
                for (let xx = x0; xx < x1; xx++, o += 4) {
                    d[o] = rgb[0];
                    d[o + 1] = rgb[1];
                    d[o + 2] = rgb[2];
                }
            }
            this.dirty = true;
        }

        // BitBlt from a bitmap { w, h, data } (RGBA); rop SRCCOPY or SRCINVERT
        blt(src, sx, sy, w, h, dx, dy, rop) {
            let x0 = dx;
            let y0 = dy;
            if (x0 < 0) { sx -= x0; w += x0; x0 = 0; }
            if (y0 < 0) { sy -= y0; h += y0; y0 = 0; }
            w = Math.min(w, this.w - x0, src.w - sx);
            h = Math.min(h, this.h - y0, src.h - sy);
            if (w <= 0 || h <= 0) return;
            const d = this.data;
            const s = src.data;
            for (let yy = 0; yy < h; yy++) {
                let o = ((y0 + yy) * this.w + x0) * 4;
                let i = ((sy + yy) * src.w + sx) * 4;
                if (rop === SRCINVERT) {
                    for (let xx = 0; xx < w; xx++, o += 4, i += 4) {
                        d[o] ^= s[i];
                        d[o + 1] ^= s[i + 1];
                        d[o + 2] ^= s[i + 2];
                    }
                } else {
                    for (let xx = 0; xx < w; xx++, o += 4, i += 4) {
                        d[o] = s[i];
                        d[o + 1] = s[i + 1];
                        d[o + 2] = s[i + 2];
                    }
                }
            }
            this.dirty = true;
        }

        // ExtTextOut(x, y, ETO_OPAQUE, rect, text) with a bitmap font (JZ.Font)
        text(font, x, y, str, fg, bg, rect) {
            if (rect) this.fill(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1], bg);
            font.draw(this, x, y, str, fg, rect);
        }
    }
    JZ.Surface = Surface;

    // ---- raster fonts ---------------------------------------------------------------------------
    // A Win16 .FON font as an atlas (scripts/build-vista-jezzball.js): meta { height, ascent,
    // first, last, default, glyphs: { code: [x, width] } } and a 1-bit coverage row per pixel row.
    class Font {
        constructor(meta, coverage) {
            this.meta = meta;
            this.height = meta.height;
            this.ascent = meta.ascent;
            this.bits = coverage; // Uint8Array(atlasW * height), 1 = ink
            this.atlasW = coverage.length / meta.height;
            this.glyphs = meta.glyphs;
        }

        code(ch) {
            // Windows-1252 text: the game only uses ASCII and the copyright sign
            let c = ch.charCodeAt(0);
            if (c > 255) c = 0;
            if (!this.glyphs[c]) c = this.meta.default;
            return c;
        }

        width(str) {
            let w = 0;
            for (const ch of String(str)) w += this.glyphs[this.code(ch)][1];
            return w;
        }

        // GetTextExtent
        extent(str) {
            return { w: this.width(str), h: this.height };
        }

        // draw ink pixels at (x, y) (top of the cell), clipped to clip [l, t, r, b] when given
        draw(surface, x, y, str, rgb, clip) {
            const d = surface.data;
            const cl = clip ? Math.max(0, clip[0]) : 0;
            const ct = clip ? Math.max(0, clip[1]) : 0;
            const cr = clip ? Math.min(surface.w, clip[2]) : surface.w;
            const cb = clip ? Math.min(surface.h, clip[3]) : surface.h;
            let pen = x;
            for (const ch of String(str)) {
                const [gx, gw] = this.glyphs[this.code(ch)];
                for (let row = 0; row < this.height; row++) {
                    const py = y + row;
                    if (py < ct || py >= cb) continue;
                    const base = row * this.atlasW + gx;
                    for (let col = 0; col < gw; col++) {
                        const px = pen + col;
                        if (px < cl || px >= cr || !this.bits[base + col]) continue;
                        const o = (py * surface.w + px) * 4;
                        d[o] = rgb[0];
                        d[o + 1] = rgb[1];
                        d[o + 2] = rgb[2];
                    }
                }
                pen += gw;
            }
            surface.dirty = true;
        }
    }
    JZ.Font = Font;

    // jezzball.json's font: metrics plus `bits`, base64 1-bit atlas rows (MSB first)
    JZ.fontFromJson = function (meta) {
        const raw = typeof atob === 'function'
            ? Uint8Array.from(atob(meta.bits), (c) => c.charCodeAt(0))
            : Uint8Array.from(Buffer.from(meta.bits, 'base64'));
        const rowBytes = (meta.atlasW + 7) >> 3;
        const cov = new Uint8Array(meta.atlasW * meta.height);
        for (let y = 0; y < meta.height; y++) {
            for (let x = 0; x < meta.atlasW; x++) {
                cov[y * meta.atlasW + x] = (raw[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
            }
        }
        return new Font(meta, cov);
    };

    // ---- the game -------------------------------------------------------------------------------
    const BLACK = [0, 0, 0];
    const WHITE = [255, 255, 255];

    // arm directions (dir): 0 up (y+1), 1 down (y-1), 2 left (x-1), 3 right (x+1)
    const DIR = [[0, 1], [0, -1], [-1, 0], [1, 0]];

    // states (DS:0B4A)
    const S_CREATED = 0;
    const S_TITLE = 1;
    const S_PLAYING = 2;
    const S_LEVEL_END = 3;
    const S_PAUSED = 4;
    const S_OVER = 7;

    // Sounds by the original's index (seg4): only bounce.wav and jezzdead.wav ship with the game
    const SND = { BOUNCE: 0, GAP: 1, WINLEVEL: 2, GAMELOST: 3, TADA: 4, JEZZDEAD: 5, ALERT: 6, WIPE: 7 };
    JZ.SND = SND;

    // host: { sheet (bitmap { w, h, data }), font (System), demoScript, sound(index, sync),
    //   onState(state), onPausedButton(show), onCursor(), levelEnd(level) -> Promise (Next Level
    //   dialog), gameOver(score) -> Promise<boolean newGame>, redraw() }
    class Game {
        constructor(host) {
            this.host = host;
            this.surface = new Surface(CLIENT_W, CLIENT_H);
            this.sheet = Game.prepareSheet(host.sheet);
            this.font = host.font;
            this.rng = new TPRandom(TPRandom.clockSeed());
            this.speed = FAST;
            this.state = S_CREATED;
            this.demo = false;
            this.active = false;
            this.iconic = false;
            this.cells = new Uint8Array(32 * 24 * 3); // type, tip, ball per cell
            this.balls = [];
            this.arms = [null, { active: false }, { active: false }];
            this.B = 2;
            this.lives = 0;
            this.score = R().fromInt(0);
            this.area = R().fromInt(0);
            this.timeLeft = 0;
            this.countdown = 0;
            this.phase = 0;
            this.orientation = 1;
            this.click = null;
            this.timeOut = false;
            this.bonusShown = false;
            this.bonusValue = 0;
            this.demoIndex = 0;
            this.demoFrame = 0;
            this.bounceAllowed = true;
            this.busy = false; // a modal box from the timer is up
        }

        // the sheet as a DDB with every ball frame XORed with the tile of its row (3:00f8)
        static prepareSheet(src) {
            const out = { w: src.w, h: src.h, data: new Uint8ClampedArray(src.data) };
            const d = out.data;
            for (let row = 0; row < 2; row++) {
                for (let f = 1; f <= 11; f++) {
                    for (let y = row * 12; y < row * 12 + 12; y++) {
                        for (let x = 0; x < 16; x++) {
                            const o = (y * out.w + f * 16 + x) * 4;
                            const b = (y * out.w + x) * 4;
                            d[o] ^= d[b];
                            d[o + 1] ^= d[b + 1];
                            d[o + 2] ^= d[b + 2];
                        }
                    }
                }
            }
            return out;
        }

        // ---- cells ----
        idx(x, y) { return (x * 24 + y) * 3; }
        inRange(x, y) { return x >= 1 && x <= COLS && y >= 1 && y <= ROWS; }
        type(x, y) { return this.cells[this.idx(x, y)]; }
        setType(x, y, t) { this.cells[this.idx(x, y)] = t; }
        tip(x, y) { return this.cells[this.idx(x, y) + 1]; }
        setTip(x, y, v) { this.cells[this.idx(x, y) + 1] = v; }
        ballAt(x, y) { return this.inRange(x, y) ? this.cells[this.idx(x, y) + 2] : 0; }
        setBall(x, y, i) { this.cells[this.idx(x, y) + 2] = i; }
        // free (1:02d1) = canStartArm (1:035f): open, no tip, no ball
        free(x, y) {
            if (!this.inRange(x, y)) return false;
            const o = this.idx(x, y);
            return this.cells[o] === OPEN && !this.cells[o + 1] && !this.cells[o + 2];
        }

        // ---- drawing (seg3) ----
        cellX(x, hx) { return 8 + (((x - 1) * 2 + (hx || 0)) * 16) / 2; }
        cellY(y, hy) { return 282 - (((y - 1) * 2 + (hy || 0)) * 12) / 2; }

        drawCell(x, y) {
            const t = this.type(x, y);
            const src = t === FILLED ? [256, 12] : t === OPEN ? [0, 12] : t === 2 ? [200, 6] : [232, 6];
            this.surface.blt(this.sheet, src[0], src[1], 16, 12, this.cellX(x), this.cellY(y), SRCCOPY);
        }

        drawTip(a) {
            const arm = this.arms[a];
            this.surface.blt(this.sheet, 272, (a - 1) * 12, 16, 12, this.cellX(arm.x, arm.dx), this.cellY(arm.y, arm.dy), SRCCOPY);
        }

        // a 16 x 12 window into the 32 x 24 cross, offset by half a step (3:0379)
        drawPiece(a, x, y, dx, dy) {
            const cx = a === 1 ? 200 : 232;
            this.surface.blt(this.sheet, cx + dx * 8, 6 - dy * 6, 16, 12, this.cellX(x, dx), this.cellY(y, dy), SRCCOPY);
        }

        // XOR the ball at its position plus its move in progress (3:02bd / 3:046e)
        xorBall(b) {
            const row = b.mdx === 0 ? 12 : 0;
            this.surface.blt(this.sheet, b.frame * 16, row, 16, 12, this.cellX(b.x, b.mdx), this.cellY(b.y, b.mdy), SRCINVERT);
        }

        // DrawCentered (3:0002): text centred on (cx, cy), 8 px of background either side
        drawCentered(cx, cy, s) {
            const e = this.font.extent(s);
            const left = cx - Math.trunc(e.w / 2) - 8;
            const top = cy - Math.trunc(e.h / 2);
            const rect = [left, top, left + e.w + 16, top + e.h];
            this.surface.text(this.font, cx - Math.trunc(e.w / 2), top, s, WHITE, BLACK, rect);
        }

        drawScore() { this.drawCentered(248, 10, 'Score: ' + R().round(this.score)); }
        drawLives() { this.drawCentered(62, 20, 'Lives: ' + this.lives); }
        drawTime() { this.drawCentered(415, 20, 'Time Left: ' + this.timeLeft); }
        drawArea() { this.drawCentered(248, 300, 'Area Cleared: ' + R().trunc(R().mul(this.area, R().fromInt(100))) + '%'); }
        drawBonus() { this.drawCentered(248, 30, 'Bonus: ' + this.bonusValue); }

        // FillClient (3:07b4)
        clearClient() {
            this.surface.fill(0, 0, this.surface.w, this.surface.h, BLACK);
        }

        // WM_PAINT into another surface (the host keeps only the newly exposed part)
        paintInto(surface) {
            const keep = this.surface;
            this.surface = surface;
            try { this.paint(); } finally { this.surface = keep; }
        }

        // WM_PAINT: the class brush erases the update region, then the state's picture (3:0841, 3:0810)
        paint() {
            this.clearClient();
            if (this.state === S_TITLE) {
                this.drawCentered(248, 131, 'Jezz Ball');
                this.drawCentered(248, 171, 'Copyright 1992 Xyridian');
            } else if (this.state === S_PLAYING || this.state === S_LEVEL_END || this.state === S_PAUSED) {
                for (let y = 1; y <= ROWS; y++) for (let x = 1; x <= COLS; x++) this.drawCell(x, y);
                if (this.arms[1].active) this.drawTip(1);
                if (this.arms[2].active) this.drawTip(2);
                for (let i = 1; i <= this.B; i++) this.xorBall(this.balls[i]);
                this.drawScore();
                this.drawLives();
                this.drawArea();
                this.drawTime();
                if (this.bonusShown) this.drawBonus();
            }
        }

        // ---- sounds ----
        play(n, sync) {
            if (this.host.sound) this.host.sound(n, !!sync);
        }

        // ---- score and area ----
        // AddScore (1:0195): halved at Slow (r / 2.0), score := score + r
        addScore(r) {
            const Real = R();
            if (this.speed === SLOW) r = Real.div(r, Real.fromInt(2));
            this.score = Real.add(this.score, r);
            this.drawScore();
            return r;
        }

        // AddArea (1:01f1): area := (n / 560.0) + area
        addArea(n) {
            const Real = R();
            this.area = Real.add(Real.div(Real.fromInt(n), Real.fromInt(CELLS)), this.area);
            this.addScore(Real.fromInt((this.B + 5) * n));
            this.drawArea();
        }

        // LevelDone (1:024b)
        levelDone() {
            return R().cmp(this.area, R().fromBytes(JZ.REAL_075)) >= 0 && !this.arms[1].active && !this.arms[2].active;
        }

        // ---- level setup ----
        // ResetGame (1:2699)
        resetGame() {
            this.score = R().fromInt(0);
            this.B = 2;
            if (this.demo) {
                this.rng.seed = 17;
                this.demoIndex = 0;
            }
            this.demoFrame = 0;
        }

        // PlaceBall (1:1d3e)
        placeBall(i) {
            let x;
            let y;
            do {
                x = 1 + this.rng.next(30);
                y = 1 + this.rng.next(22);
            } while (!this.free(x, y));
            const dx = 1 + this.rng.next(2) === 1 ? -1 : 1;
            const dy = 1 + this.rng.next(2) === 1 ? -1 : 1;
            this.balls[i] = { x, y, dx, dy, mdx: 0, mdy: 0, frame: 1 };
            this.setBall(x, y, i);
        }

        // NewLevel (1:1e9b)
        newLevel() {
            this.lives = this.B;
            this.timeLeft = 250 * this.B + 1000;
            this.cells.fill(0);
            for (let x = 1; x <= COLS; x++) {
                for (let y = 1; y <= ROWS; y++) {
                    this.setType(x, y, x === 1 || x === COLS || y === 1 || y === ROWS ? FILLED : OPEN);
                }
            }
            this.arms[1] = { active: false };
            this.arms[2] = { active: false };
            this.balls = [null];
            for (let i = 1; i <= this.B; i++) this.placeBall(i);
            this.orientation = 1;
            this.click = null;
            this.area = R().fromInt(0);
            this.bonusShown = false;
            this.timeOut = false;
            this.clearClient();
            const wasTitle = this.state === S_TITLE;
            this.setState(S_PLAYING);
            if (!wasTitle) this.paint();
            this.phase = 0;
            this.timerOn = true;
            this.host.startTimer && this.host.startTimer(this.speed);
        }

        setState(s) {
            this.state = s;
            if (this.host.onState) this.host.onState(s);
        }

        // New Game (cm 1110) / Demo (cm 1120): states 1, 2, 3, 7
        canStart() {
            return this.state === S_TITLE || this.state === S_PLAYING || this.state === S_LEVEL_END || this.state === S_OVER;
        }

        newGame(demo) {
            if (!this.canStart() || this.busy) return false;
            this.demo = !!demo;
            this.resetGame();
            this.newLevel();
            return true;
        }

        // first WM_ACTIVATE (1:2b32): state 1 then New Game
        start() {
            if (this.state !== S_CREATED) return;
            this.setState(S_TITLE);
            this.newGame(false);
        }

        // ---- input ----
        // WM_LBUTTONDOWN (1:3119): queued for the next phase 0 (a later click replaces it)
        leftDown(px, py) {
            if (this.state === S_PLAYING && !this.demo) this.click = { px, py };
        }

        // WM_RBUTTONDOWN (1:314a)
        rightDown() {
            if (this.state === S_PLAYING && !this.demo) {
                this.orientation ^= 1;
                if (this.host.onCursor) this.host.onCursor();
            }
        }

        // the wall cursor shows only while playing (WM_MOUSEMOVE 1:2ff9); null leaves the cursor as it was
        cursor() {
            if (!(this.active && this.timerOn && this.state === S_PLAYING)) return null;
            return this.orientation === 0 ? 'ew' : 'ns';
        }

        // Ctrl+Shift+F12 (1:3375): area = 1.01, no redraw
        cheat() {
            if (this.state === S_PLAYING && !this.demo) this.area = R().fromBytes(JZ.REAL_101);
        }

        // Pause (cm 1150, F3, the Paused button)
        togglePause() {
            if (this.state === S_PLAYING) {
                this.setState(S_PAUSED);
                if (this.host.onPausedButton) this.host.onPausedButton(true);
            } else if (this.state === S_PAUSED) {
                if (this.host.onPausedButton) this.host.onPausedButton(false);
                this.setState(S_PLAYING);
                this.paint();
            }
        }

        // ---- the timer (WM_TIMER 1:3046) ----
        timer() {
            if (this.busy) return;
            if (!this.active && !((this.state === S_PLAYING || this.state === S_LEVEL_END) && this.demo)) return;
            if (this.iconic) return;
            if (this.state === S_PLAYING) this.gameTick();
            else if (this.state === S_LEVEL_END) this.levelEndTick();
        }

        // GameTick (1:23ce)
        gameTick() {
            this.bounceAllowed = true;
            if (this.phase === 0) {
                this.processClick();
                this.timeTick();
                this.demoFrame++;
                if (this.demo) this.runDemoScript();
                this.armStep(1);
                this.armStep(2);
                for (let i = 1; i <= this.B; i++) this.ballStep(i);
                if (this.speed === SLOW) this.timeTick();
                this.phase = 1;
            } else {
                this.armMove(1);
                this.armMove(2);
                for (let i = 1; i <= this.B; i++) this.ballCommit(i);
                this.phase = 0;
                if (this.timeLeft <= 0) {
                    this.timeOut = true;
                    this.lives = 0;
                    this.drawLives();
                }
                if (this.levelDone() || this.lives <= 0) this.endLevel();
            }
        }

        // TimeTick (1:22ea)
        timeTick() {
            if (this.timeLeft > 0) {
                this.timeLeft--;
                if (this.timeLeft === 200) this.play(SND.ALERT);
                this.drawTime();
            }
        }

        // the demo's recorded clicks (seg2:0048), x as recorded, y 10 px lower
        runDemoScript() {
            const script = this.host.demoScript || [];
            while (this.demoIndex < script.length && script[this.demoIndex][0] === this.demoFrame) {
                const [, action, x, y] = script[this.demoIndex];
                if (action === 0) {
                    this.orientation ^= 1;
                    if (this.host.onCursor) this.host.onCursor();
                } else {
                    this.click = { px: x, py: y + 10 };
                }
                this.demoIndex++;
            }
        }

        // pixel -> cell (3:0520)
        static pixelToCell(px, py) {
            const cx = (((px + 1 - 8) & 0xffff) >> 4) + 1;
            const cy = Math.trunc((293 - py) / 12) + 1;
            return [cx, cy];
        }

        // ProcessClick (1:1b30)
        processClick() {
            if (!this.click) return;
            const [cx, cy] = Game.pixelToCell(this.click.px, this.click.py);
            this.click = null;
            if (this.orientation === 0) {
                this.startArm(1, cx, cy, 2);
                this.startArm(2, cx + 1, cy, 3);
            } else {
                this.startArm(1, cx, cy, 0);
                this.startArm(2, cx, cy - 1, 1);
            }
        }

        // StartArm (1:1a72): each half starts on its own, only on a free cell
        startArm(a, x, y, dir) {
            if (this.arms[a].active || !this.free(x, y)) return;
            this.play(SND.GAP);
            this.arms[a] = { active: true, x, y, dx: 0, dy: 0, dir };
            this.setType(x, y, a + 1);
            this.setTip(x, y, 1);
            this.drawTip(a);
        }

        // ArmStep (1:0a31), phase 0: claim the next cell
        armStep(a) {
            const arm = this.arms[a];
            if (!arm.active) return;
            const [vx, vy] = DIR[arm.dir];
            const nx = arm.x + vx;
            const ny = arm.y + vy;
            if (!this.inRange(nx, ny) || this.type(nx, ny) === FILLED) {
                this.completeArm(a);
                return;
            }
            if (!this.free(nx, ny)) return;
            this.setType(nx, ny, a + 1);
            this.drawPiece(a, arm.x, arm.y, 0, 0);
            arm.dx = vx;
            arm.dy = vy;
            this.drawTip(a);
            this.setTip(nx, ny, 1);
        }

        // ArmMove (1:0b92), phase 1: the tip moves into the claimed cell
        armMove(a) {
            const arm = this.arms[a];
            if (!arm.active) return;
            this.setTip(arm.x, arm.y, 0);
            this.drawPiece(a, arm.x, arm.y, arm.dx, arm.dy);
            arm.x += arm.dx;
            arm.y += arm.dy;
            arm.dx = 0;
            arm.dy = 0;
            this.drawTip(a);
            this.setTip(arm.x, arm.y, 1);
        }

        // CompleteArm (1:085e): the half becomes wall
        completeArm(a) {
            const arm = this.arms[a];
            this.setTip(arm.x, arm.y, 0);
            arm.active = false;
            let n = 0;
            for (let x = 1; x <= COLS; x++) {
                for (let y = 1; y <= ROWS; y++) {
                    if (this.type(x, y) === a + 1) {
                        this.setType(x, y, FILLED);
                        this.drawCell(x, y);
                        n++;
                    }
                }
            }
            this.addArea(n);
            this.fillCheck();
        }

        // FillCheck (1:078f): every open region without a ball is filled
        fillCheck() {
            const seen = new Uint8Array(32 * 24);
            for (let x = 1; x <= COLS; x++) {
                for (let y = 1; y <= ROWS; y++) {
                    if (this.type(x, y) !== OPEN || seen[x * 24 + y]) continue;
                    const region = [];
                    let ball = false;
                    const stack = [[x, y]];
                    seen[x * 24 + y] = 1;
                    while (stack.length) {
                        const [cx, cy] = stack.pop();
                        region.push([cx, cy]);
                        if (this.ballAt(cx, cy)) ball = true;
                        for (const [ox, oy] of DIR) {
                            const nx = cx + ox;
                            const ny = cy + oy;
                            if (!this.inRange(nx, ny) || seen[nx * 24 + ny] || this.type(nx, ny) !== OPEN) continue;
                            seen[nx * 24 + ny] = 1;
                            stack.push([nx, ny]);
                        }
                    }
                    if (ball) continue;
                    this.play(SND.WIPE);
                    region.forEach(([cx, cy]) => {
                        this.setType(cx, cy, FILLED);
                        this.drawCell(cx, cy);
                    });
                    this.addArea(region.length);
                }
            }
        }

        // ArmKilled (1:0940): the half is gone, a life lost
        armKilled(a) {
            this.play(SND.JEZZDEAD);
            if (this.lives > 0) {
                this.lives--;
                this.drawLives();
            }
            const arm = this.arms[a];
            this.setTip(arm.x, arm.y, 0);
            arm.active = false;
            for (let x = 1; x <= COLS; x++) {
                for (let y = 1; y <= ROWS; y++) {
                    if (this.type(x, y) === a + 1) {
                        this.setType(x, y, OPEN);
                        this.drawCell(x, y);
                    }
                }
            }
        }

        // ---- balls ----
        // BallStep (1:12ed), phase 0
        ballStep(i) {
            const b = this.balls[i];
            const bounced = !(this.free(b.x + b.dx, b.y) && this.free(b.x, b.y + b.dy) && this.free(b.x + b.dx, b.y + b.dy));
            if (bounced) this.bounce(i);
            this.move(i);
            if (bounced && b.mdx !== 0 && this.bounceAllowed) {
                this.play(SND.BOUNCE);
                this.bounceAllowed = false;
            }
        }

        // Bounce (1:10b5): balls in the way take this one's direction; then reflect
        bounce(i) {
            const b = this.balls[i];
            const hx = b.x + b.dx;
            const hy = b.y;
            const vx = b.x;
            const vy = b.y + b.dy;
            const dx = b.x + b.dx;
            const dy = b.y + b.dy;
            let j = this.ballAt(hx, hy);
            if (j) this.balls[j].dx = b.dx;
            j = this.ballAt(vx, vy);
            if (j) this.balls[j].dy = b.dy;
            j = this.ballAt(dx, dy);
            if (j) {
                this.balls[j].dx = b.dx;
                this.balls[j].dy = b.dy;
            }
            const fh = this.free(hx, hy);
            const fv = this.free(vx, vy);
            if (!fh && fv) b.dx = -b.dx;
            else if (!fv && fh) b.dy = -b.dy;
            else {
                b.dx = -b.dx;
                b.dy = -b.dy;
            }
        }

        // Move (1:0e9f): start the move half a cell
        move(i) {
            const b = this.balls[i];
            const ok = (ddx, ddy) => this.free(b.x + ddx, b.y) && this.free(b.x, b.y + ddy) && this.free(b.x + ddx, b.y + ddy);
            let tx = b.x;
            let ty = b.y;
            if (ok(b.dx, b.dy)) {
                tx = b.x + b.dx;
                ty = b.y + b.dy;
            } else {
                for (const [ddx, ddy] of [[1, 1], [-1, -1], [-1, 1], [1, -1]]) {
                    if (ok(ddx, ddy)) {
                        b.dx = ddx;
                        b.dy = ddy;
                        tx = b.x + ddx;
                        ty = b.y + ddy;
                        break;
                    }
                }
            }
            this.xorBall(b);
            b.mdx = tx - b.x;
            b.mdy = ty - b.y;
            b.frame = (b.frame % 11) + 1;
            this.xorBall(b);
        }

        // BallCommit (1:1698), phase 1: finish the move, then the wall check
        ballCommit(i) {
            const b = this.balls[i];
            if (b.mdx || b.mdy) {
                let tx = b.x + b.mdx;
                let ty = b.y + b.mdy;
                const j = this.ballAt(tx, ty);
                if (j) {
                    this.balls[j].dx = b.mdx;
                    this.balls[j].dy = b.mdy;
                    b.dx = -b.mdx;
                    b.dy = -b.mdy;
                    tx = b.x;
                    ty = b.y;
                }
                this.setBall(b.x, b.y, 0);
                this.xorBall(b);
                b.x = tx;
                b.y = ty;
                b.mdx = 0;
                b.mdy = 0;
                b.frame = (b.frame % 11) + 1;
                this.xorBall(b);
                this.setBall(tx, ty, i);
            }
            this.wallHitCheck(b.x, b.y);
        }

        // WallHitCheck (1:13f9): a ball next to a growing half kills it
        wallHitCheck(x, y) {
            if (!this.arms[1].active && !this.arms[2].active) return;
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    if (!ox && !oy) continue;
                    const nx = x + ox;
                    const ny = y + oy;
                    if (!this.inRange(nx, ny)) continue;
                    const t = this.type(nx, ny);
                    if (t === 2 && this.arms[1].active) this.armKilled(1);
                    else if (t === 3 && this.arms[2].active) this.armKilled(2);
                }
            }
        }

        // ---- level end ----
        // EndLevel (1:218c)
        endLevel() {
            const Real = R();
            this.play(this.lives <= 0 ? SND.GAMELOST : SND.WINLEVEL, this.lives <= 0);
            if (this.lives > 0 && Real.cmp(this.area, Real.fromInt(1)) <= 0) {
                // four terms, each its own function (1:1f65, 1:1fc4, 1:2089, 1:214e), summed
                // ((t4 + t3) + t2) + t1; the "1.0 *" are the code's and can move the guard byte
                const one = Real.fromInt(1);
                const k = Real.fromInt(this.B + 5);
                const P = Real.mul(this.area, Real.fromInt(100));
                const t4 = Real.mul(Real.mul(Real.mul(Real.fromInt(this.lives), one), Real.fromInt(250)), k);
                const t3 = Real.cmp(P, Real.fromInt(80)) < 0 ? Real.fromInt(0)
                    : Real.mul(Real.mul(Real.mul(one, Real.sub(P, Real.fromInt(80))), Real.fromInt(50)), k);
                const t2 = Real.cmp(P, Real.fromInt(90)) < 0 ? Real.fromInt(0)
                    : Real.mul(Real.mul(Real.mul(one, Real.sub(P, Real.fromInt(90))), Real.fromInt(100)), k);
                const t1 = Real.mul(Real.fromInt(this.timeLeft), one);
                const bonus = Real.add(Real.add(Real.add(t4, t3), t2), t1);
                const added = this.addScore(bonus);
                this.bonusValue = Real.round(added);
                this.bonusShown = true;
                this.drawBonus();
            }
            this.setState(S_LEVEL_END);
            this.countdown = this.speed === SLOW ? 15 : 30;
        }

        // LevelEndTick (1:25f0): the balls spin in place for 1.5 s, then the next level
        levelEndTick() {
            for (let i = 1; i <= this.B; i++) {
                const b = this.balls[i];
                this.xorBall(b);
                b.frame = (b.frame % 11) + 1;
                this.xorBall(b);
            }
            this.countdown--;
            if (this.countdown > 0) return;
            if (this.lives <= 0) {
                this.gameOver();
                return;
            }
            const next = () => {
                if (!this.timeOut) this.B = Math.min(this.B + 1, MAX_BALLS);
                this.newLevel();
            };
            if (this.demo || !this.host.levelEnd) {
                next();
                return;
            }
            this.busy = true;
            Promise.resolve(this.host.levelEnd(this.B - 1)).then(() => {
                this.busy = false;
                next();
                if (this.host.redraw) this.host.redraw();
            });
        }

        // GameOver (1:24ce)
        gameOver() {
            if (this.demo || !this.host.gameOver) {
                this.clearClient();
                this.setState(S_OVER);
                return;
            }
            this.busy = true;
            Promise.resolve(this.host.gameOver(R().round(this.score))).then((again) => {
                this.busy = false;
                if (again) {
                    this.setState(S_OVER);
                    this.newGame(false);
                } else {
                    this.clearClient();
                    this.setState(S_OVER);
                }
                if (this.host.redraw) this.host.redraw();
            });
        }

        // Options > Slow / Fast (cm 1320 / 1310)
        setSpeed(ms) {
            this.speed = ms === SLOW ? SLOW : FAST;
            if (this.timerOn && this.host.startTimer) this.host.startTimer(this.speed);
        }
    }

    // Real constants as the data segment holds them
    JZ.REAL_075 = [0x80, 0x00, 0x00, 0x00, 0x00, 0x40];
    JZ.REAL_101 = [0x81, 0x7b, 0x14, 0xae, 0x47, 0x01];

    Object.assign(JZ, {
        Game, COLS, ROWS, CELLS, CLIENT_W, CLIENT_H, FAST, SLOW, TICK_MS,
        STATE: { CREATED: S_CREATED, TITLE: S_TITLE, PLAYING: S_PLAYING, LEVEL_END: S_LEVEL_END, PAUSED: S_PAUSED, OVER: S_OVER }
    });
})(typeof window !== 'undefined' ? window : globalThis);
