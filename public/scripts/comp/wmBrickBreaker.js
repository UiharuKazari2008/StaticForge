/**
 * Melaton Mobile: Brick Breaker, Yozora #786 (Melaton Mobile games). Redrawn in WM style: the desktop
 * game's rules (public/scripts/comp/desktop-apps/vista-games/brickbreaker.js, Vista games #609) as a
 * Windows Mobile 6 program would have shipped beside Bubble Breaker and Solitaire in 2008.
 *
 * Rules (the desktop's BrickEngine, copied by script; only the field height is a parameter here, so
 * the field fits a portrait or landscape screen; the field stays 420 units wide): 20 levels, 10 drawn
 * by hand and 10 from a seed; silver bricks take 2-4 hits, gold never break; the ball leaves the
 * paddle at up to 60 degrees by where it hits; capsules for wide paddle, three balls, slow ball,
 * catch and the rare extra ball; ball speed Slow / Medium / Fast, faster by level and by paddle hits;
 * 3 lives (6 at most); scoring 50 + 10 per level a brick, 100 + 20 a silver one, 500 x level a clear.
 * Physics run in sub-steps of 2 field units from the frame's own time (60-120 Hz alike).
 *
 * Look, measured on the device's Bubble Breaker (emulator instances, 6.1 + 6.5, VGA): white page; a
 * status row under the title bar (VGA rows 52-84 = 16.5 units, Tahoma 13 units, labels pure blue,
 * values black, 10 units in from both sides) and a 1 VGA px black rule under it; GDI drawing (flat
 * fills, 3D bevels, shaded balls); soft keys New Game | Menu; Menu = Pause, rule, Options...,
 * Statistics, rule, About (Bubble Breaker: Undo Move, rule, Options..., Statistics, rule, About);
 * New Game in a game asks "New Game?" (question icon, Yes / No) while Confirm end game is on;
 * Options / Statistics / About are full pages with ok in the title corner and no soft keys.
 *
 * Controls: the paddle follows the finger (drag anywhere on the field), a tap launches the ball (or
 * a caught one); d-pad / arrows move it, Enter / Space / Up launch. Tap the field to continue after
 * a pause. The game pauses (Paused box) when the app is hidden (X: Smart Minimize keeps the game),
 * the screen goes off, or a menu or message box comes up; one rAF loop runs only while something
 * moves. Settings, statistics and a game left in progress live in localStorage wmGame:brickbreaker.
 * Styles: public/css/wm-brickbreaker.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'brickbreaker';
    const TITLE = 'Brick Breaker';
    const DEVELOPER = 'Academy City Research P.S.R.';
    const STORE_KEY = 'wmGame:brickbreaker';

    // ---- rules: brickbreaker.js lines 31-526, copied by script (PADDLE_Y / FIELD_H -> this.paddleY /
    // this.fieldH inside the engine) ---------------------------------------------------------------
    // field units (native px inside the frame)
    const FIELD_W = 420;
    const FIELD_H = 337;
    const BRICK_COLS = 12;
    const BRICK_W = 34;
    const BRICK_H = 14;
    const BRICK_PITCH_X = 35;
    const BRICK_PITCH_Y = 15;
    const BRICK_TOP = 30;
    const PADDLE_Y = FIELD_H - 26;  // top of the paddle sprite; its body starts 2 px lower
    const PADDLE_H = 14;
    const PADDLE_W = 64;
    const PADDLE_WIDE = 96;
    const BALL_R = 5;
    const MAX_ANGLE = Math.PI / 3;
    const MAX_BALLS = 8;
    const LEVELS = 20;
    const START_LIVES = 3;
    const MAX_LIVES = 6;
    const POWER_MS = { wide: 20000, slow: 15000, sticky: 20000 };
    const CAPSULE_SPEED = 95;
    const CAPSULE_CHANCE = 0.13;
    const CATCH_RELEASE_MS = 3000;
    const KEY_SPEED = 430;
    const SPEEDS = { slow: 250, medium: 310, fast: 370 };
    const CAPSULE_TYPES = ['wide', 'multi', 'slow', 'sticky', 'life'];

    // r o y g c b p k: the colours of BRICKS_*.XML; s silver (several hits); G gold (never breaks)
    const BRICK_CHARS = 'roygcbpk';
    const LAYOUTS = [
        // 1 Rainbow
        ['rrrrrrrrrrrr', 'oooooooooooo', 'yyyyyyyyyyyy', 'gggggggggggg', 'cccccccccccc', 'bbbbbbbbbbbb'],
        // 2 Pyramid
        ['.....pp.....', '....bbbb....', '...cccccc...', '..gggggggg..', '.yyyyyyyyyy.', 'oooooooooooo', 'rrrrrrrrrrrr'],
        // 3 Panes
        ['rrrrr..ggggg', 'rrrrr..ggggg', 'rrrrr..ggggg', '............', 'bbbbb..yyyyy', 'bbbbb..yyyyy', 'bbbbb..yyyyy'],
        // 4 Checkers
        ['c.c.c.c.c.c.', '.s.s.s.s.s.s', 'b.b.b.b.b.b.', '.s.s.s.s.s.s', 'p.p.p.p.p.p.', '.k.k.k.k.k.k'],
        // 5 Diamond
        ['.....yy.....', '....yooy....', '...yorroy...', '..yorkkroy..', '...yorroy...', '....yooy....', '.....yy.....'],
        // 6 Fortress
        ['GG.GG..GG.GG', 'ss.ss..ss.ss', 'ssssssssssss', 's.bbbbbbbb.s', 's.bccccccb.s', 's.bbbbbbbb.s', 'ssss....ssss'],
        // 7 Columns
        ['r.o.y.g.c.b.', 'r.o.y.g.c.b.', '.p.k.r.o.y.g', '.p.k.r.o.y.g', 'r.o.y.g.c.b.', 'r.o.y.g.c.b.', 'ssssssssssss'],
        // 8 Chevrons
        ['p..........p', 'pp........pp', '.pp......pp.', '..pp....pp..', 'b..bb..bb..b', 'bb..bbbb..bb', '.bb..bb..bb.', '..bb....bb..'],
        // 9 Invader
        ['..g......g..', '...g....g...', '..gggggggg..', '.gg.gggg.gg.', 'gggggggggggg', 'g.gggggggg.g', 'g.g......g.g', '...gg..gg...'],
        // 10 Finale
        ['ssssssssssss', 'rrGrrrrrrGrr', 'oooooooooooo', 'yyyyssssyyyy', 'gggggggggggg', 'ccGccccccGcc', 'bbbbbbbbbbbb', 'pppppppppppp']
    ];

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // levels past the hand-made ones: mirrored rows from a seed, more silver as they go
    function proceduralLayout(level) {
        const rnd = mulberry32(level * 7919 + 17);
        const rows = 6 + Math.floor(rnd() * 4);
        const density = 0.55 + rnd() * 0.3;
        const silver = Math.min(0.3, 0.06 + (level - LAYOUTS.length) * 0.02);
        const gold = level > LAYOUTS.length + 3 ? 0.04 : 0;
        const out = [];
        const band = Math.floor(rnd() * BRICK_CHARS.length);
        for (let y = 0; y < rows; y++) {
            const half = [];
            const color = BRICK_CHARS[(band + y) % BRICK_CHARS.length];
            for (let x = 0; x < BRICK_COLS / 2; x++) {
                const r = rnd();
                if (r > density) half.push('.');
                else if (r < gold) half.push('G');
                else if (r < gold + silver) half.push('s');
                else half.push(color);
            }
            out.push(half.join('') + half.slice().reverse().join(''));
        }
        // never a level of nothing but metal
        const breakable = out.join('').replace(/[.G]/g, '').length;
        if (breakable < 16) out.push(BRICK_CHARS[band].repeat(BRICK_COLS));
        return out;
    }

    function layoutFor(level) {
        return level <= LAYOUTS.length ? LAYOUTS[level - 1] : proceduralLayout(level);
    }

    function silverHits(level) {
        return level <= 5 ? 2 : (level <= 12 ? 3 : 4);
    }

    function buildBricks(level) {
        const bricks = [];
        layoutFor(level).forEach((row, y) => {
            for (let x = 0; x < BRICK_COLS; x++) {
                const ch = row[x];
                if (!ch || ch === '.') continue;
                const b = { col: x, row: y, x: x * BRICK_PITCH_X, y: BRICK_TOP + y * BRICK_PITCH_Y, w: BRICK_W, h: BRICK_H, hits: 0 };
                if (ch === 's') {
                    b.kind = 'silver';
                    b.maxHits = silverHits(level);
                } else if (ch === 'G') {
                    b.kind = 'gold';
                    b.maxHits = Infinity;
                } else {
                    b.kind = 'color';
                    b.color = BRICK_CHARS.indexOf(ch);
                    b.maxHits = 1;
                }
                bricks.push(b);
            }
        });
        return bricks;
    }

    class BrickEngine {
        // opts: { rng, startLevel, speed ('slow' | 'medium' | 'fast'), levels }
        constructor(opts) {
            opts = opts || {};
            this.rng = opts.rng || Math.random;
            this.speedName = SPEEDS[opts.speed] ? opts.speed : 'medium';
            this.levels = opts.levels || LEVELS;
            this.level = Math.max(1, Math.min(this.levels, opts.startLevel | 0 || 1));
            this.score = 0;
            this.lives = START_LIVES;
            this.broken = 0;
            this.over = false;
            this.won = false;
            this.cleared = false;
            this.events = [];
            this.fieldH = opts.fieldH || FIELD_H;
            this.paddle = { x: (FIELD_W - PADDLE_W) / 2, w: PADDLE_W, vx: 0 };
            this.loadLevel(this.level);
        }

        // the paddle sits 26 units above the bottom of the field (its height follows the screen)
        get paddleY() {
            return this.fieldH - 26;
        }

        emit(type, data) {
            this.events.push(Object.assign({}, data || {}, { type }));
        }

        takeEvents() {
            const e = this.events;
            this.events = [];
            return e;
        }

        loadLevel(level) {
            this.level = level;
            this.bricks = buildBricks(level);
            this.cleared = false;
            this.capsules = [];
            this.hitsThisLife = 0;
            this.resetPowers();
            this.serve();
        }

        resetPowers() {
            this.powers = { wide: 0, slow: 0, sticky: 0 };
        }

        // a ball waiting on the paddle
        serve() {
            const p = this.paddle;
            this.balls = [{ x: p.x + p.w / 2, y: this.paddleY - BALL_R, vx: 0, vy: 0, stuck: true, offset: p.w / 2, held: 0 }];
            this.hitsThisLife = 0;
        }

        breakable() {
            return this.bricks.filter((b) => b.kind !== 'gold').length;
        }

        // px / s now: the chosen speed, faster by level and by paddle hits, slower under Slow
        ballSpeed() {
            const base = SPEEDS[this.speedName];
            const level = 1 + Math.min(0.6, (this.level - 1) * 0.035);
            const ramp = 1 + Math.min(0.25, Math.floor(this.hitsThisLife / 8) * 0.03);
            return base * level * ramp * (this.powers.slow > 0 ? 0.68 : 1);
        }

        targetWidth() {
            return this.powers.wide > 0 ? PADDLE_WIDE : PADDLE_W;
        }

        // the ball leaves the paddle at an angle from where it hit: -1 (left end) .. 1 (right end)
        static bounceAngle(offset) {
            return Math.max(-1, Math.min(1, offset)) * MAX_ANGLE;
        }

        launch() {
            let any = false;
            this.balls.forEach((b) => {
                if (!b.stuck) return;
                const p = this.paddle;
                const offset = (b.x - (p.x + p.w / 2)) / (p.w / 2);
                // straight off the middle drifts a little, so a serve is never exactly upright
                const a = BrickEngine.bounceAngle(offset * 0.8) || (this.rng() < 0.5 ? -0.18 : 0.18);
                const s = this.ballSpeed();
                b.vx = s * Math.sin(a);
                b.vy = -s * Math.cos(a);
                b.stuck = false;
                any = true;
            });
            if (any) this.emit('launch');
            return any;
        }

        // input: { x: paddle centre wanted (field px) or null, dir: -1 / 0 / 1 (keys) }
        step(dt, input) {
            if (this.over || this.cleared) return;
            input = input || {};
            const ms = dt;
            ['wide', 'slow', 'sticky'].forEach((k) => {
                if (this.powers[k] > 0) {
                    this.powers[k] = Math.max(0, this.powers[k] - ms);
                    if (!this.powers[k]) this.emit('powerend', { power: k });
                }
            });
            const p = this.paddle;
            // the paddle grows / shrinks about its centre over a fifth of a second
            const tw = this.targetWidth();
            if (p.w !== tw) {
                const c = p.x + p.w / 2;
                const d = Math.sign(tw - p.w) * Math.min(Math.abs(tw - p.w), dt * 0.16);
                p.w += d;
                p.x = c - p.w / 2;
            }
            const before = p.x;
            if (typeof input.x === 'number') p.x = input.x - p.w / 2;
            else if (input.dir) p.x += input.dir * KEY_SPEED * dt / 1000;
            p.x = Math.max(0, Math.min(FIELD_W - p.w, p.x));
            p.vx = dt > 0 ? (p.x - before) / (dt / 1000) : 0;
            // balls in steps of at most 2 px
            const speed = Math.max(1, ...this.balls.map((b) => Math.hypot(b.vx, b.vy)));
            const steps = Math.max(1, Math.ceil(speed * dt / 1000 / 2));
            const h = dt / 1000 / steps;
            for (let i = 0; i < steps && !this.cleared; i++) this.substep(h);
            this.stepCapsules(dt / 1000);
            if (!this.balls.length) this.loseLife();
            else if (!this.cleared && this.breakable() === 0) this.clearLevel();
        }

        substep(h) {
            const p = this.paddle;
            const target = this.ballSpeed();
            this.balls.forEach((b) => {
                if (b.stuck) {
                    b.x = p.x + Math.max(BALL_R, Math.min(p.w - BALL_R, b.offset));
                    b.y = this.paddleY - BALL_R;
                    b.held += h * 1000;
                    if (b.caught && b.held >= CATCH_RELEASE_MS) this.launch();
                    return;
                }
                // ease toward the speed this moment wants
                const s = Math.hypot(b.vx, b.vy) || 1;
                const k = (s + (target - s) * Math.min(1, h * 4)) / s;
                b.vx *= k;
                b.vy *= k;
                this.keepSteep(b);
                const nx = b.x + b.vx * h;
                const ny = b.y + b.vy * h;
                if (!this.hitBricks(b, nx, ny)) {
                    b.x = nx;
                    b.y = ny;
                }
                // walls (the frame) on three sides
                if (b.x < BALL_R) {
                    b.x = BALL_R;
                    b.vx = Math.abs(b.vx);
                    this.emit('wall');
                } else if (b.x > FIELD_W - BALL_R) {
                    b.x = FIELD_W - BALL_R;
                    b.vx = -Math.abs(b.vx);
                    this.emit('wall');
                }
                if (b.y < BALL_R) {
                    b.y = BALL_R;
                    b.vy = Math.abs(b.vy);
                    this.emit('wall');
                }
                this.hitPaddle(b, h);
                if (b.y - BALL_R > this.fieldH) b.lost = true;
            });
            const lost = this.balls.filter((b) => b.lost);
            if (lost.length) {
                this.balls = this.balls.filter((b) => !b.lost);
                lost.forEach((b) => this.emit('balllost', { x: b.x, remaining: this.balls.length }));
            }
        }

        // never close to flat: at least 0.28 of the speed goes up or down
        keepSteep(b) {
            const s = Math.hypot(b.vx, b.vy);
            if (!s) return;
            const min = 0.28 * s;
            if (Math.abs(b.vy) < min) {
                b.vy = (b.vy < 0 ? -1 : 1) * min;
                b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, s * s - min * min));
            }
        }

        // the ball at (nx, ny) against the bricks: reflect off the nearest it overlaps (its face, or
        // its corner along the corner's normal) and hit every brick it overlaps. True when it hit.
        hitBricks(b, nx, ny) {
            const hits = [];
            for (const br of this.bricks) {
                const cx = Math.max(br.x, Math.min(nx, br.x + br.w));
                const cy = Math.max(br.y, Math.min(ny, br.y + br.h));
                const dx = nx - cx;
                const dy = ny - cy;
                const d2 = dx * dx + dy * dy;
                if (d2 < BALL_R * BALL_R) hits.push({ br, dx, dy, d2 });
            }
            if (!hits.length) return false;
            hits.sort((a, c) => a.d2 - c.d2);
            const first = hits[0];
            let { dx, dy } = first;
            if (!dx && !dy) {
                // the centre went inside (a fast ball): push back the way it came
                const br = first.br;
                const fromLeft = b.x < br.x;
                const fromRight = b.x > br.x + br.w;
                if (fromLeft || fromRight) dx = fromLeft ? -1 : 1;
                else dy = b.y < br.y + br.h / 2 ? -1 : 1;
            }
            const len = Math.hypot(dx, dy) || 1;
            let nxn = dx / len;
            let nyn = dy / len;
            // a face hit (one axis) when the corner is shallow
            if (Math.abs(nxn) < 0.35) {
                nxn = 0;
                nyn = Math.sign(nyn) || -1;
            } else if (Math.abs(nyn) < 0.35) {
                nyn = 0;
                nxn = Math.sign(nxn) || -1;
            }
            const dot = b.vx * nxn + b.vy * nyn;
            if (dot < 0) {
                b.vx -= 2 * dot * nxn;
                b.vy -= 2 * dot * nyn;
            }
            hits.slice(0, 2).forEach((hit) => this.damage(hit.br, b));
            return true;
        }

        damage(br, ball) {
            if (br.kind === 'gold') {
                this.emit('brickhit', { brick: br, solid: true });
                return;
            }
            br.hits += 1;
            if (br.hits < br.maxHits) {
                this.score += 10;
                this.emit('brickhit', { brick: br });
                return;
            }
            const i = this.bricks.indexOf(br);
            if (i >= 0) this.bricks.splice(i, 1);
            const points = br.kind === 'silver' ? 100 + 20 * (this.level - 1) : 50 + 10 * (this.level - 1);
            this.score += points;
            this.broken += 1;
            this.emit('brickbreak', { brick: br, points, vx: ball ? ball.vx : 0, vy: ball ? ball.vy : 0 });
            if (this.rng() < CAPSULE_CHANCE) this.dropCapsule(br);
        }

        dropCapsule(br) {
            if (this.capsules.length >= 3) return;
            const r = this.rng();
            // the extra ball is rare; the others even
            const type = r < 0.06 ? 'life' : CAPSULE_TYPES[Math.floor((r - 0.06) / 0.94 * 4)];
            this.capsules.push({ type, x: br.x + br.w / 2, y: br.y + br.h / 2, t: 0 });
            this.emit('capsule', { capsule: type });
        }

        hitPaddle(b, h) {
            if (b.vy <= 0) return;
            const p = this.paddle;
            const top = this.paddleY + 2;
            const prevBottom = b.y - b.vy * h + BALL_R;
            if (b.y + BALL_R < top || prevBottom > top + 6) return;
            if (b.x < p.x - BALL_R || b.x > p.x + p.w + BALL_R) return;
            b.y = top - BALL_R;
            this.hitsThisLife += 1;
            const offset = (b.x - (p.x + p.w / 2)) / (p.w / 2 + BALL_R);
            const a = BrickEngine.bounceAngle(offset);
            const s = this.ballSpeed();
            b.vx = s * Math.sin(a);
            b.vy = -s * Math.cos(a);
            this.emit('paddle', { offset });
            if (this.powers.sticky > 0) {
                b.stuck = true;
                b.caught = true;
                b.held = 0;
                b.offset = b.x - p.x;
                b.vx = 0;
                b.vy = 0;
                this.emit('catch');
            }
        }

        stepCapsules(s) {
            const p = this.paddle;
            this.capsules.forEach((c) => {
                c.t += s;
                c.y += CAPSULE_SPEED * s;
                const caught = c.y + 6 >= this.paddleY + 2 && c.y - 6 <= this.paddleY + PADDLE_H && c.x + 13 >= p.x && c.x - 13 <= p.x + p.w;
                if (caught) {
                    c.done = true;
                    this.collect(c.type);
                } else if (c.y - 7 > this.fieldH) c.done = true;
            });
            this.capsules = this.capsules.filter((c) => !c.done);
        }

        collect(type) {
            this.score += 100;
            if (type === 'multi') {
                // a ball still on the paddle goes now, so there are three in play
                if (this.balls.every((b) => b.stuck)) this.launch();
                const out = [];
                this.balls.forEach((b) => {
                    out.push(b);
                    if (b.stuck) return;
                    // two more, turned 26 degrees either way
                    [-0.45, 0.45].forEach((turn) => {
                        const c = Math.cos(turn);
                        const sn = Math.sin(turn);
                        out.push({ x: b.x, y: b.y, vx: b.vx * c - b.vy * sn, vy: b.vx * sn + b.vy * c, stuck: false });
                    });
                });
                this.balls = out.slice(0, MAX_BALLS);
            } else if (type === 'life') {
                this.lives = Math.min(MAX_LIVES, this.lives + 1);
            } else this.powers[type] = POWER_MS[type];
            this.emit('collect', { capsule: type });
        }

        loseLife() {
            this.lives -= 1;
            this.capsules = [];
            this.resetPowers();
            this.paddle.w = PADDLE_W;
            if (this.lives <= 0) {
                this.lives = 0;
                this.over = true;
                this.emit('gameover');
                return;
            }
            this.emit('lifelost', { lives: this.lives });
            this.serve();
        }

        clearLevel() {
            this.cleared = true;
            const bonus = 500 * this.level;
            this.score += bonus;
            this.capsules = [];
            this.emit('levelclear', { level: this.level, bonus });
            if (this.level >= this.levels) {
                this.won = true;
                this.over = true;
                this.emit('win');
            }
        }

        nextLevel() {
            if (!this.cleared || this.over) return false;
            this.loadLevel(this.level + 1);
            this.paddle.w = PADDLE_W;
            this.emit('level', { level: this.level });
            return true;
        }

        serialize() {
            return {
                level: this.level, score: this.score, lives: this.lives, broken: this.broken, speed: this.speedName,
                bricks: this.bricks.map((b) => [b.col, b.row, b.hits])
            };
        }

        static restore(s, opts) {
            const e = new BrickEngine(Object.assign({}, opts, { startLevel: s.level, speed: s.speed }));
            e.score = s.score;
            e.lives = s.lives;
            e.broken = s.broken || 0;
            const keep = new Map(s.bricks.map(([c, r, hits]) => [c + ',' + r, hits]));
            e.bricks = e.bricks.filter((b) => keep.has(b.col + ',' + b.row));
            e.bricks.forEach((b) => { b.hits = keep.get(b.col + ',' + b.row) || 0; });
            e.events = [];
            return e;
        }
    }
    // ---------------------------------------------------------------- storage

    const DEFAULTS = { sounds: true, confirmEnd: true, animations: true, startLevel: 1, speed: 'medium' };

    function store() {
        try {
            const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
            return v && typeof v === 'object' ? v : {};
        } catch (_) { return {}; }
    }

    function storePut(patch) {
        const v = Object.assign(store(), patch);
        Object.keys(v).forEach((k) => { if (v[k] === undefined) delete v[k]; });
        try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (_) { /* this session only */ }
    }

    function settings() {
        const s = Object.assign({}, DEFAULTS, store().settings || {});
        s.startLevel = Math.max(1, Math.min(LAYOUTS.length, s.startLevel | 0 || 1));
        if (!SPEEDS[s.speed]) s.speed = 'medium';
        return s;
    }

    function blankStats() {
        return { played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: [], bestLevel: 0, mostBricks: 0, totalBricks: 0 };
    }

    function stats() {
        return Object.assign(blankStats(), store().stats || {});
    }

    // ---------------------------------------------------------------- strings (the desktop's)

    const STR = {
        newGameTitle: 'New Game?',
        newGameAsk: 'Do you really want to begin a new game?',
        gameWon: 'Game Won',
        gameLost: 'Game Lost',
        won: 'Congratulations, you won the game!',
        lost: 'Sorry, you lost this game. Better luck next time!',
        newHigh: 'You have a new high score!',
        again: 'Do you want to play again?',
        resetTitle: 'Reset Statistics',
        resetAsk: 'Do you want to reset all your statistics to zero?',
        paused: 'Paused',
        resume: 'Tap to continue',
        ready: 'Tap to launch the ball',
        levelTitle: 'Level %1',
        levelCleared: 'Level %1 cleared',
        bonus: 'Bonus %1',
        powerNames: { wide: 'Wide Paddle', multi: 'Three Balls', slow: 'Slow Ball', sticky: 'Catch', life: 'Extra Ball' }
    };
    const fmt = (t, ...a) => String(t).replace(/%(\d)/g, (_, n) => String(a[Number(n) - 1]));

    // ---------------------------------------------------------------- look (GDI)

    // r o y g c b p k as the desktop's BRICK_COLORS, a little purer for a white page (as Bubble
    // Breaker's balls); silver and gold for the metal bricks
    const BRICK_RGB = [[214, 24, 24], [247, 125, 0], [247, 207, 0], [24, 166, 33], [0, 170, 214], [24, 77, 222], [140, 49, 198], [231, 73, 156]];
    const SILVER = [173, 178, 189];
    const GOLD = [214, 162, 16];
    const CAPSULE = {
        wide: { rgb: [24, 77, 222], text: 'W' },
        multi: { rgb: [24, 166, 33], text: '3' },
        slow: { rgb: [247, 125, 0], text: 'S' },
        sticky: { rgb: [140, 49, 198], text: 'C' },
        life: { rgb: [214, 24, 24], text: '+' }
    };
    const LEVEL_PAUSE = 1800;
    const TAP_SLOP = 10;     // CSS px a tap may wander
    const TAP_MS = 400;

    const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const WHITE = [255, 255, 255];
    const BLACK = [0, 0, 0];

    // ---------------------------------------------------------------- state

    let ws = null;
    let page = null;
    let view = 'main';          // 'main' | 'options' | 'stats' | 'about'
    let cv = null;
    let ctx = null;
    let bricksLayer = null;     // the bricks, drawn again only when they change
    let bricksDirty = true;
    const L = { w: 0, h: 0, dpr: 1, ox: 0, oy: 0, scale: 1, fieldH: 440, unit: 1.5, font: 'Tahoma, sans-serif' };
    const G = {
        engine: null, s: settings(), state: 'ready', paused: false, started: false, clock: 0,
        effects: [], between: null, ending: null, pointerX: null, keys: { left: false, right: false }
    };
    let raf = 0;
    let last = 0;
    let draft = null;           // Options while open
    let colors = { paddle: [49, 211, 57], text: [0, 0, 255] };

    // ---------------------------------------------------------------- sounds

    // short GDI-era blips (WebAudio), only with Play sounds on and the phone's sound on
    let actx = null;
    function soundOn() {
        if (!G.s.sounds) return 0;
        try {
            const sh = ws && ws.sounds;
            if (sh && typeof sh.silent === 'function' && sh.silent()) return 0;
            const tv = window.tabVolume;
            if (tv && typeof tv.isMuted === 'function' && tv.isMuted()) return 0;
            if (localStorage.getItem('wmSoundMode') === 'vibrate') return 0;
            const raw = localStorage.getItem('wmRingerLevel');
            const lvl = raw == null || raw === '' ? 5 : Number(raw);
            return Number.isFinite(lvl) ? Math.max(0, Math.min(5, lvl)) / 5 : 1;
        } catch (_) { return 1; }
    }
    function unlockAudio() {
        if (!G.s.sounds) return;
        try {
            if (!actx) {
                const C = window.AudioContext || window.webkitAudioContext;
                if (!C) return;
                actx = new C();
            }
            if (actx.state === 'suspended') actx.resume().catch(() => {});
        } catch (_) { actx = null; }
    }
    const SOUNDS = {
        paddle: [[523, 0.045, 'square']],
        wall: [[392, 0.03, 'square']],
        brick: [[880, 0.05, 'square']],
        dent: [[660, 0.04, 'square']],
        solid: [[247, 0.06, 'square']],
        collect: [[659, 0.06, 'square'], [880, 0.06, 'square'], [1175, 0.08, 'square']],
        lost: [[392, 0.12, 'triangle'], [262, 0.12, 'triangle'], [165, 0.22, 'triangle']],
        cleared: [[523, 0.09, 'square'], [659, 0.09, 'square'], [784, 0.09, 'square'], [1047, 0.18, 'square']],
        over: [[330, 0.16, 'triangle'], [262, 0.16, 'triangle'], [196, 0.32, 'triangle']],
        win: [[523, 0.1, 'square'], [659, 0.1, 'square'], [784, 0.1, 'square'], [1047, 0.1, 'square'], [1319, 0.3, 'square']]
    };
    let lastSound = { name: '', at: 0 };
    function play(name) {
        const vol = soundOn();
        if (!vol || !actx || actx.state !== 'running') return;
        const now = performance.now();
        // a burst of the same blip in one frame (several bricks) sounds once
        if (lastSound.name === name && now - lastSound.at < 30) return;
        lastSound = { name, at: now };
        try {
            let t = actx.currentTime;
            for (const [f, d, type] of SOUNDS[name] || []) {
                const o = actx.createOscillator();
                const g = actx.createGain();
                o.type = type;
                o.frequency.value = f;
                g.gain.setValueAtTime(0.06 * vol, t);
                g.gain.setValueAtTime(0.06 * vol, t + d * 0.7);
                g.gain.linearRampToValueAtTime(0, t + d);
                o.connect(g).connect(actx.destination);
                o.start(t);
                o.stop(t + d + 0.01);
                t += d;
            }
        } catch (_) { /* no sound */ }
    }

    // ---------------------------------------------------------------- game flow

    function newEngine(level) {
        return new BrickEngine({ startLevel: level, speed: G.s.speed, fieldH: L.fieldH });
    }

    function newGame() {
        G.s = settings();
        G.engine = newEngine(G.s.startLevel);
        G.state = 'ready';
        G.paused = false;
        G.started = false;
        G.effects = [];
        G.between = null;
        G.ending = null;
        G.keys.left = G.keys.right = false;
        bricksDirty = true;
        banner(fmt(STR.levelTitle, G.engine.level));
        storePut({ saved: undefined });
        renderStatus();
        draw();
    }

    // a ball has left the paddle this game: only then does quitting count as a loss
    function inProgress() {
        return !!G.engine && G.started && (G.state === 'ready' || G.state === 'playing' || G.state === 'between');
    }

    function live() {
        return G.state === 'ready' || G.state === 'playing' || G.state === 'between';
    }

    function pause() {
        if (G.paused || !(G.state === 'playing' || G.state === 'between')) return;
        G.paused = true;
        G.keys.left = G.keys.right = false;
        stopLoop();
        saveGame();
        draw();
        if (ws) ws.refreshSoftKeys();
    }

    function resume() {
        if (!G.paused) return;
        G.paused = false;
        last = 0;
        draw();
        kick();
        if (ws) ws.refreshSoftKeys();
    }

    function launch() {
        if (G.paused || !live() || G.state === 'between') return;
        if (G.engine.launch()) {
            G.started = true;
            G.state = 'playing';
            G.effects = G.effects.filter((fx) => fx.kind !== 'banner');
            handleEvents();
            kick();
        }
    }

    async function askNewGame() {
        if (inProgress() && G.s.confirmEnd) {
            const wasPaused = G.paused;
            pause();
            const yes = await ws.messageBox({
                title: STR.newGameTitle, text: STR.newGameAsk, icon: 'question', modal: true, cancelValue: false,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            if (!yes) { if (!wasPaused) draw(); return; }
        }
        if (inProgress()) record(false);
        newGame();
    }

    function record(won) {
        const e = G.engine;
        const st = stats();
        st.played += 1;
        if (won) {
            st.won += 1;
            st.streak = st.streak > 0 ? st.streak + 1 : 1;
            st.longestWin = Math.max(st.longestWin, st.streak);
        } else {
            st.streak = st.streak < 0 ? st.streak - 1 : -1;
            st.longestLose = Math.max(st.longestLose, -st.streak);
        }
        let high = false;
        if (e.score > 0) {
            const entry = { score: e.score, date: Date.now(), level: e.level };
            st.best.push(entry);
            st.best.sort((a, b) => b.score - a.score || a.date - b.date);
            st.best = st.best.slice(0, 5);
            high = st.best[0] === entry && st.best.length > 1;
        }
        st.bestLevel = Math.max(st.bestLevel, e.level);
        st.mostBricks = Math.max(st.mostBricks, e.broken);
        st.totalBricks += e.broken;
        storePut({ stats: st, saved: undefined });
        return high;
    }

    async function finish() {
        const e = G.engine;
        const won = e.won;
        G.state = 'over';
        const high = record(won);
        draw();
        const text = `${won ? STR.won : STR.lost}\n\nScore: ${e.score}\nLevel: ${e.level}${high ? `\n${STR.newHigh}` : ''}\n\n${STR.again}`;
        const yes = await ws.messageBox({
            title: won ? STR.gameWon : STR.gameLost, text, icon: 'info', modal: true, cancelValue: false,
            buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }]
        });
        if (yes && G.engine === e) newGame();
    }

    function saveGame() {
        if (!G.engine || !inProgress()) return;
        storePut({ saved: Object.assign(G.engine.serialize(), { started: true }) });
    }

    function restoreGame() {
        const s = store().saved;
        if (!s || !Array.isArray(s.bricks)) return false;
        try {
            G.engine = BrickEngine.restore(s, { fieldH: L.fieldH });
        } catch (_) { return false; }
        G.state = 'ready';
        G.paused = false;
        G.started = true;
        G.effects = [];
        G.between = null;
        G.ending = null;
        bricksDirty = true;
        banner(fmt(STR.levelTitle, G.engine.level));
        return true;
    }

    // ---------------------------------------------------------------- engine events

    function handleEvents() {
        const e = G.engine;
        const anim = G.s.animations;
        const now = G.clock;
        e.takeEvents().forEach((ev) => {
            switch (ev.type) {
            case 'paddle': play('paddle'); break;
            case 'wall': play('wall'); break;
            case 'brickhit':
                play(ev.solid ? 'solid' : 'dent');
                if (!ev.solid) bricksDirty = true;
                break;
            case 'brickbreak':
                play('brick');
                bricksDirty = true;
                if (anim) shatter(ev.brick, ev, now);
                break;
            case 'collect':
                play('collect');
                if (anim) G.effects.push({ kind: 'text', text: STR.powerNames[ev.capsule], x: e.paddle.x + e.paddle.w / 2, y: e.paddleY - 30, at: now, life: 1100, size: 13, rise: 18 });
                break;
            case 'balllost':
                if (!ev.remaining) play('lost');
                break;
            case 'lifelost':
                G.state = 'ready';
                banner(null);
                break;
            case 'levelclear':
                play('cleared');
                G.state = 'between';
                G.between = { until: now + (anim ? LEVEL_PAUSE : 600) };
                G.effects.push({ kind: 'text', text: fmt(STR.levelCleared, ev.level), x: FIELD_W / 2, y: L.fieldH * 0.42, at: now, life: anim ? LEVEL_PAUSE : 600, size: 18, bold: true, blue: true });
                G.effects.push({ kind: 'text', text: fmt(STR.bonus, ev.bonus), x: FIELD_W / 2, y: L.fieldH * 0.42 + 26, at: now, life: anim ? LEVEL_PAUSE : 600, size: 13 });
                break;
            case 'gameover':
            case 'win':
                startEnding(ev.type === 'win');
                break;
            default: break;
            }
        });
        renderStatus();
    }

    // the broken brick's four quarters fall away (Display animations)
    function shatter(br, ev, now) {
        const base = br.kind === 'silver' ? SILVER : BRICK_RGB[br.color] || SILVER;
        const qw = br.w / 2;
        const qh = br.h / 2;
        const sx = (ev.vx || 0) * 0.15;
        for (let i = 0; i < 4; i++) {
            G.effects.push({
                kind: 'shard', rgb: base, w: qw, h: qh, x: br.x + (i % 2) * qw, y: br.y + Math.floor(i / 2) * qh,
                vx: (i % 2 ? 40 : -40) + sx + (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 60, ay: 520, at: now, life: 650
            });
        }
    }

    function startEnding(won) {
        play(won ? 'win' : 'over');
        G.state = 'ending';
        G.ending = { until: G.clock + (G.s.animations ? (won ? 1600 : 900) : 0) };
        if (won) G.effects.push({ kind: 'text', text: STR.won.split(',')[0], x: FIELD_W / 2, y: L.fieldH * 0.42, at: G.clock, life: 1600, size: 18, bold: true, blue: true });
    }

    // the level title and the hint while the ball waits on the paddle
    function banner(title) {
        G.effects = G.effects.filter((fx) => fx.kind !== 'banner');
        G.effects.push({ kind: 'banner', title, at: G.clock });
    }

    // ---------------------------------------------------------------- loop

    function blocked() {
        if (!page || page.hidden || document.hidden || view !== 'main' || (ws && ws.current !== APP_ID)) return true;
        return !!document.querySelector('#wmShell .wm-popup:not([hidden]):not(.wm-popup-ghost), #wmShell .wm-msgbox-layer:not([hidden])');
    }

    function needsLoop() {
        if (G.paused) return false;
        return G.state === 'playing' || G.state === 'between' || G.state === 'ending' || G.keys.left || G.keys.right
            || G.effects.some((fx) => fx.kind !== 'banner');
    }

    function kick() {
        if (!raf && needsLoop() && !blocked()) { last = 0; raf = requestAnimationFrame(tick); }
    }

    function stopLoop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    }

    function tick(ts) {
        raf = 0;
        if (blocked()) {
            // a menu, a box, the screen off or the app hidden: the game stops where it is
            pause();
            return;
        }
        const dt = last ? Math.min(50, Math.max(0, ts - last)) : 16;
        last = ts;
        step(dt);
        draw();
        if (needsLoop()) raf = requestAnimationFrame(tick);
    }

    function step(dt) {
        const e = G.engine;
        G.clock += dt;
        const now = G.clock;
        if (G.state === 'ready' || G.state === 'playing') {
            const dir = (G.keys.right ? 1 : 0) - (G.keys.left ? 1 : 0);
            const input = dir ? { dir } : (G.pointerX !== null ? { x: G.pointerX } : {});
            e.step(dt, input);
            if (dir) G.pointerX = null;
            handleEvents();
        }
        if (G.state === 'between' && now >= G.between.until) {
            G.between = null;
            e.nextLevel();
            e.takeEvents();
            G.state = 'ready';
            bricksDirty = true;
            banner(fmt(STR.levelTitle, e.level));
            renderStatus();
            saveGame();
        }
        if (G.state === 'ending' && now >= G.ending.until) {
            G.state = 'over';
            setTimeout(finish, 0);
        }
        const s = dt / 1000;
        G.effects.forEach((fx) => {
            if (fx.kind !== 'shard') return;
            fx.vy += fx.ay * s;
            fx.x += fx.vx * s;
            fx.y += fx.vy * s;
        });
        G.effects = G.effects.filter((fx) => fx.kind === 'banner' || now < fx.at + fx.life);
    }

    // ---------------------------------------------------------------- layout and drawing

    function layout() {
        if (!page || !cv) return;
        const box = cv.parentElement;
        const w = box.clientWidth;
        const h = box.clientHeight;
        if (!w || !h) return;
        const probe = page.querySelector('.wbb-probe');
        L.unit = probe ? probe.offsetWidth / 100 : 1.5;
        const m = Math.round(3 * L.unit);
        const aw = w - 2 * m;
        const ah = h - m;
        // the field keeps the desktop's width (420) and takes the screen's shape: taller in portrait
        const fh = Math.round(Math.max(300, Math.min(900, FIELD_W * ah / aw)));
        L.fieldH = fh;
        L.scale = Math.min(aw / FIELD_W, ah / fh);
        L.ox = Math.round((w - FIELD_W * L.scale) / 2);
        L.oy = m;
        L.w = w;
        L.h = h;
        L.dpr = window.devicePixelRatio || 1;
        cv.width = Math.round(w * L.dpr);
        cv.height = Math.round(h * L.dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        // on the device pixel grid (the box can start between two pixels), so 1 px lines stay sharp
        const br = box.getBoundingClientRect();
        const snap = (v) => -(((v * L.dpr) % 1 + 1) % 1) / L.dpr;
        cv.style.left = `${snap(br.left)}px`;
        cv.style.top = `${snap(br.top)}px`;
        if (G.engine && G.engine.fieldH !== fh) {
            const e = G.engine;
            e.fieldH = fh;
            e.balls.forEach((b) => { if (b.stuck) b.y = e.paddleY - BALL_R; });
        }
        const cs = getComputedStyle(page);
        L.font = cs.fontFamily || L.font;
        colors.paddle = parseColor(cs.getPropertyValue('--wm-highlight')) || colors.paddle;
        bricksDirty = true;
        draw();
    }

    function parseColor(v) {
        v = String(v || '').trim();
        let m = /^#([0-9a-f]{6})$/i.exec(v);
        if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)];
        m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    }

    // field units -> device pixels, snapped
    const DX = (x) => Math.round((L.ox + x * L.scale) * L.dpr);
    const DY = (y) => Math.round((L.oy + y * L.scale) * L.dpr);
    const DS = (v) => v * L.scale * L.dpr;

    // a raised GDI block: fill, a light edge top and left, a dark edge bottom and right, a dark frame
    function bevel(c, x, y, w, h, col, edge) {
        const x0 = DX(x);
        const y0 = DY(y);
        const x1 = DX(x + w);
        const y1 = DY(y + h);
        const e = Math.max(1, Math.round(edge));
        c.fillStyle = rgb(mix(col, BLACK, 0.55));
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        c.fillStyle = rgb(mix(col, BLACK, 0.25));
        c.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
        c.fillStyle = rgb(mix(col, WHITE, 0.55));
        c.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2 - e, e);
        c.fillRect(x0 + 1, y0 + 1, e, y1 - y0 - 2 - e);
        c.fillStyle = rgb(col);
        c.fillRect(x0 + 1 + e, y0 + 1 + e, x1 - x0 - 2 - 2 * e, y1 - y0 - 2 - 2 * e);
    }

    function drawBrick(c, br) {
        const edge = DS(1.6);
        if (br.kind === 'gold') {
            bevel(c, br.x, br.y, br.w, br.h, GOLD, edge);
            // the shine: a short light stroke across the top left
            c.fillStyle = rgb(mix(GOLD, WHITE, 0.75));
            c.fillRect(DX(br.x + 5), DY(br.y + 4), Math.max(1, Math.round(DS(9))), Math.max(1, Math.round(DS(1.5))));
            return;
        }
        if (br.kind === 'silver') {
            bevel(c, br.x, br.y, br.w, br.h, SILVER, edge);
            // a crack for every hit taken
            c.strokeStyle = rgb(mix(SILVER, BLACK, 0.6));
            c.lineWidth = Math.max(1, Math.round(DS(1)));
            const cracks = [[[10, 2], [14, 7], [11, 12]], [[24, 2], [21, 6], [25, 12]], [[17, 3], [19, 8], [16, 11]]];
            for (let i = 0; i < Math.min(br.hits, cracks.length); i++) {
                c.beginPath();
                cracks[i].forEach(([px, py], k) => (k ? c.lineTo : c.moveTo).call(c, DX(br.x + px), DY(br.y + py)));
                c.stroke();
            }
            return;
        }
        bevel(c, br.x, br.y, br.w, br.h, BRICK_RGB[br.color] || SILVER, edge);
    }

    function renderBricks() {
        if (!bricksLayer) bricksLayer = document.createElement('canvas');
        if (bricksLayer.width !== cv.width || bricksLayer.height !== cv.height) {
            bricksLayer.width = cv.width;
            bricksLayer.height = cv.height;
        }
        const c = bricksLayer.getContext('2d');
        c.clearRect(0, 0, bricksLayer.width, bricksLayer.height);
        if (G.engine) G.engine.bricks.forEach((br) => drawBrick(c, br));
        bricksDirty = false;
    }

    // Bubble Breaker's shaded ball: a radial light up and to the left, a dark rim
    function drawBall(c, b) {
        const x = (L.ox + b.x * L.scale) * L.dpr;
        const y = (L.oy + b.y * L.scale) * L.dpr;
        const r = Math.max(2, DS(BALL_R));
        const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, '#b5bac6');
        g.addColorStop(0.8, '#4a5063');
        g.addColorStop(1, '#21242c');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
    }

    function drawPaddle(c) {
        const e = G.engine;
        const p = e.paddle;
        const top = e.paddleY + 2;
        const x0 = DX(p.x);
        const x1 = DX(p.x + p.w);
        const y0 = DY(top);
        const y1 = DY(top + PADDLE_H - 4);
        const h = y1 - y0;
        const col = colors.paddle;
        // a bar with round ends: dark frame, the colour, a light band in its upper third
        c.fillStyle = rgb(mix(col, BLACK, 0.6));
        roundRect(c, x0, y0, x1 - x0, h, h / 2);
        c.fill();
        c.fillStyle = rgb(col);
        roundRect(c, x0 + 1, y0 + 1, x1 - x0 - 2, h - 2, (h - 2) / 2);
        c.fill();
        c.fillStyle = rgb(mix(col, WHITE, 0.6));
        const band = Math.max(1, Math.round(h * 0.22));
        roundRect(c, x0 + Math.round(h * 0.45), y0 + Math.max(2, Math.round(h * 0.18)), x1 - x0 - Math.round(h * 0.9), band, band / 2);
        c.fill();
    }

    function roundRect(c, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    function drawCapsule(c, cap) {
        const k = CAPSULE[cap.type] || CAPSULE.wide;
        const w = DS(26);
        const h = DS(12);
        const x = (L.ox + cap.x * L.scale) * L.dpr - w / 2;
        const y = (L.oy + cap.y * L.scale) * L.dpr - h / 2;
        c.fillStyle = rgb(mix(k.rgb, BLACK, 0.55));
        roundRect(c, Math.round(x), Math.round(y), Math.round(w), Math.round(h), h / 2);
        c.fill();
        c.fillStyle = rgb(k.rgb);
        roundRect(c, Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2, h / 2 - 1);
        c.fill();
        c.fillStyle = '#fff';
        c.font = `bold ${Math.round(DS(10))}px ${L.font}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(k.text, x + w / 2, y + h / 2 + DS(0.5));
    }

    function text(c, str, x, y, size, opts = {}) {
        c.font = `${opts.bold ? 'bold ' : ''}${Math.round(size * L.unit * L.dpr)}px ${L.font}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = opts.color || '#000';
        c.fillText(str, x, y);
    }

    // a GDI box in the middle of the field: white, 1 VGA px black frame, two lines
    function centreBox(c, title, sub) {
        const u = L.unit * L.dpr;
        c.font = `bold ${Math.round(13 * u)}px ${L.font}`;
        const tw = c.measureText(title).width;
        c.font = `${Math.round(10.5 * u)}px ${L.font}`;
        const sw = sub ? c.measureText(sub).width : 0;
        const w = Math.round(Math.max(tw, sw) + 24 * u);
        const h = Math.round((sub ? 44 : 28) * u);
        const cx = (L.ox + FIELD_W / 2 * L.scale) * L.dpr;
        const cy = (L.oy + L.fieldH * 0.5 * L.scale) * L.dpr;
        const x = Math.round(cx - w / 2);
        const y = Math.round(cy - h / 2);
        const line = Math.max(1, Math.round(u / 2));
        c.fillStyle = '#000';
        c.fillRect(x, y, w, h);
        c.fillStyle = '#fff';
        c.fillRect(x + line, y + line, w - 2 * line, h - 2 * line);
        text(c, title, cx, y + (sub ? 15 : 14) * u, 13, { bold: true, color: rgb(colors.text) });
        if (sub) text(c, sub, cx, y + 31 * u, 10.5);
    }

    function draw() {
        if (!ctx || !G.engine || !L.w) return;
        const c = ctx;
        const e = G.engine;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = '#fff';
        c.fillRect(0, 0, cv.width, cv.height);
        // the walls: a 1 VGA px black line left, top and right; the bottom is open
        const line = Math.max(1, Math.round(L.unit * L.dpr / 2));
        const fx0 = DX(0) - line;
        const fx1 = DX(FIELD_W);
        const fy0 = DY(0) - line;
        const fy1 = cv.height;
        c.fillStyle = '#000';
        c.fillRect(fx0, fy0, fx1 - fx0 + line, line);
        c.fillRect(fx0, fy0, line, fy1 - fy0);
        c.fillRect(fx1, fy0, line, fy1 - fy0);
        if (bricksDirty) renderBricks();
        c.drawImage(bricksLayer, 0, 0);
        const now = G.clock;
        G.effects.forEach((fx) => {
            if (fx.kind !== 'shard' || now < fx.at) return;
            const t = (now - fx.at) / fx.life;
            const col = mix(fx.rgb, WHITE, Math.min(1, t * 0.9));
            c.fillStyle = rgb(col);
            c.fillRect(DX(fx.x), DY(fx.y), Math.max(1, Math.round(DS(fx.w))), Math.max(1, Math.round(DS(fx.h))));
        });
        e.capsules.forEach((cap) => drawCapsule(c, cap));
        if (G.state !== 'over' || e.won) drawPaddle(c);
        e.balls.forEach((b) => drawBall(c, b));
        G.effects.forEach((fx) => {
            if (fx.kind !== 'text' || now < fx.at) return;
            const t = (now - fx.at) / fx.life;
            c.font = `${fx.bold ? 'bold ' : ''}${Math.round(fx.size * L.unit * L.dpr)}px ${L.font}`;
            // kept inside the walls (a power's name over a paddle at the edge)
            const half = c.measureText(fx.text).width / 2 / (L.scale * L.dpr) + 4;
            const fxx = Math.max(half, Math.min(FIELD_W - half, fx.x));
            const x = (L.ox + fxx * L.scale) * L.dpr;
            const y = (L.oy + (fx.y - (fx.rise || 0) * t) * L.scale) * L.dpr;
            text(c, fx.text, x, y, fx.size, { bold: fx.bold, color: fx.blue ? rgb(colors.text) : '#000' });
        });
        const ban = G.effects.find((fx) => fx.kind === 'banner');
        if (G.paused) {
            centreBox(c, STR.paused, STR.resume);
        } else if (ban && G.state === 'ready') {
            const cx = (L.ox + FIELD_W / 2 * L.scale) * L.dpr;
            const cy = (L.oy + L.fieldH * 0.55 * L.scale) * L.dpr;
            if (ban.title) text(c, ban.title, cx, cy, 15, { bold: true, color: rgb(colors.text) });
            text(c, STR.ready, cx, cy + (ban.title ? 20 : 0) * L.unit * L.dpr, 10.5);
        }
    }

    function renderStatus() {
        if (!page || !G.engine) return;
        const e = G.engine;
        const set = (k, v) => { const el = page.querySelector(`.wbb-status [data-v="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = String(v); };
        set('score', e.score);
        set('lives', e.lives);
        set('level', e.level);
    }

    // ---------------------------------------------------------------- input

    const ptr = { id: null, x0: 0, y0: 0, t0: 0, moved: false };

    function fieldX(clientX) {
        const r = cv.getBoundingClientRect();
        return (clientX - r.left - L.ox) / L.scale;
    }

    function onDown(e) {
        if (view !== 'main' || !G.engine) return;
        unlockAudio();
        if (ptr.id !== null && e.pointerId !== ptr.id) return;
        ptr.id = e.pointerId;
        ptr.x0 = e.clientX;
        ptr.y0 = e.clientY;
        ptr.t0 = performance.now();
        ptr.moved = false;
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        e.preventDefault();
        if (G.paused) { ptr.resumeTap = true; return; }
        ptr.resumeTap = false;
        if (G.state === 'ready' || G.state === 'playing') {
            G.pointerX = fieldX(e.clientX);
            follow();
        }
    }

    function onMove(e) {
        if (view !== 'main' || !G.engine) return;
        const mouseHover = e.pointerType === 'mouse' && ptr.id === null;
        if (e.pointerId !== ptr.id && !mouseHover) return;
        if (!mouseHover && Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > TAP_SLOP) ptr.moved = true;
        if (G.paused || ptr.resumeTap) return;
        if (G.state === 'ready' || G.state === 'playing') {
            G.pointerX = fieldX(e.clientX);
            follow();
        }
    }

    function onUp(e) {
        if (e.pointerId !== ptr.id) return;
        ptr.id = null;
        const tap = !ptr.moved && performance.now() - ptr.t0 < TAP_MS;
        if (ptr.resumeTap) {
            ptr.resumeTap = false;
            if (tap || !ptr.moved) resume();
            return;
        }
        if (tap && e.type === 'pointerup') launch();
    }

    // the paddle follows at once while nothing else runs the loop (the ball on the paddle)
    function follow() {
        if (raf) return;
        if (G.state === 'ready') {
            G.engine.step(0, { x: G.pointerX });
            G.engine.takeEvents();
            draw();
        }
    }

    function onKey(e) {
        if (!ws || ws.current !== APP_ID || view !== 'main' || !G.engine || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('#wmShell .wm-popup:not([hidden]):not(.wm-popup-ghost), #wmShell .wm-msgbox-layer:not([hidden])')) return;
        const down = e.type === 'keydown';
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            if (down && G.paused) return;
            G.keys[e.key === 'ArrowLeft' ? 'left' : 'right'] = down;
            kick();
            return;
        }
        if (!down) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp') {
            e.preventDefault();
            unlockAudio();
            if (G.paused) resume();
            else launch();
        } else if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            if (G.paused) resume(); else pause();
        }
    }

    // ---------------------------------------------------------------- pages: Options, Statistics, About

    const esc = (s) => (ws ? ws.escapeHtml(s) : String(s));
    const SPEED_LABEL = { slow: 'Slow', medium: 'Medium', fast: 'Fast' };

    function showView(v) {
        view = v;
        page.dataset.view = v;
        page.querySelectorAll('.wbb-view').forEach((el) => { el.hidden = el.dataset.view !== v; });
        if (v === 'options') renderOptions();
        else if (v === 'stats') renderStats();
        else if (v === 'about') renderAbout();
        else requestAnimationFrame(() => { layout(); });
        ws.refreshTitleAction();
        ws.refreshSoftKeys();
    }

    function openPage(v) {
        pause();
        if (v === 'options') draft = settings();
        showView(v);
        ws.syncHistory();
    }

    function renderOptions() {
        const d = draft;
        const box = page.querySelector('.wbb-view[data-view="options"]');
        const check = (k, label) => `<label class="wm-check"><input type="checkbox" data-opt="${k}"${d[k] ? ' checked' : ''}><span>${esc(label)}</span></label>`;
        box.innerHTML = `<div class="wm-form-hdr">Options</div><div class="wm-set-scroll"><div class="wm-form wbb-form">`
            + `<div class="wm-form-row is-wide"><span class="wm-form-label">Starting level:</span><button type="button" class="wm-combo" data-act="startLevel"><span>${d.startLevel}</span></button></div>`
            + `<div class="wm-form-row is-wide"><span class="wm-form-label">Ball speed:</span><button type="button" class="wm-combo" data-act="speed"><span>${SPEED_LABEL[d.speed]}</span></button></div>`
            + `<div class="wbb-checks">${check('sounds', 'Play sounds')}${check('confirmEnd', 'Confirm end game')}${check('animations', 'Display animations')}</div>`
            + '</div></div>';
        box.querySelectorAll('[data-opt]').forEach((el) => el.addEventListener('change', () => { d[el.dataset.opt] = el.checked; }));
        box.querySelectorAll('.wm-combo').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.dataset.act;
            const pick = (v) => { d[act] = v; renderOptions(); };
            const rows = act === 'startLevel'
                ? LAYOUTS.map((_, i) => ({ label: String(i + 1), radio: d.startLevel === i + 1, action: () => pick(i + 1) }))
                : Object.keys(SPEEDS).map((k) => ({ label: SPEED_LABEL[k], radio: d.speed === k, action: () => pick(k) }));
            ws.dropdown(b, rows, 'left');
        }));
    }

    function commitOptions() {
        if (!draft) return;
        storePut({ settings: draft });
        G.s = Object.assign(settings(), { speed: G.s.speed, startLevel: G.s.startLevel });
        // sound, confirmation and animations act now; level and speed with the next game
        const next = settings();
        G.s.sounds = next.sounds;
        G.s.confirmEnd = next.confirmEnd;
        G.s.animations = next.animations;
        draft = null;
    }

    function dateText(ms) {
        const d = new Date(ms);
        return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
    }

    function streakText(n) {
        if (n < 0) return `${-n} ${n === -1 ? 'loss' : 'losses'}`;
        return `${n} ${n === 1 ? 'win' : 'wins'}`;
    }

    function renderStats() {
        const st = stats();
        const box = page.querySelector('.wbb-view[data-view="stats"]');
        const best = [0, 1, 2, 3, 4].map((i) => st.best[i]);
        const pct = st.played ? Math.round(st.won / st.played * 100) : 0;
        const rows = [
            ['Games played', st.played], ['Games won', st.won], ['Win percentage', `${pct}%`],
            ['Longest winning streak', st.longestWin], ['Longest losing streak', st.longestLose], ['Current streak', streakText(st.streak)],
            ['Highest level', st.bestLevel], ['Most bricks in a game', st.mostBricks], ['Bricks broken', st.totalBricks]
        ];
        box.innerHTML = `<div class="wm-form-hdr">Statistics</div><div class="wm-set-scroll"><div class="wbb-stats">`
            + '<table class="wbb-high"><thead><tr><th class="is-rank"></th><th>Score</th><th>Level</th><th>Date</th></tr></thead><tbody>'
            + best.map((b, i) => `<tr><td class="is-rank">${i + 1}.</td><td>${b ? b.score : '-'}</td><td>${b ? b.level : '-'}</td><td>${b ? dateText(b.date) : '-'}</td></tr>`).join('')
            + '</tbody></table>'
            + `<table class="wbb-totals"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
            + '<div class="wbb-reset"><button type="button" class="wm-button" data-act="reset">Reset</button></div>'
            + '</div></div>';
        box.querySelector('[data-act="reset"]').addEventListener('click', async () => {
            const yes = await ws.messageBox({
                title: STR.resetTitle, text: STR.resetAsk, icon: 'question', modal: true, cancelValue: false,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            if (yes) { storePut({ stats: blankStats() }); renderStats(); }
        });
    }

    function renderAbout() {
        const box = page.querySelector('.wbb-view[data-view="about"]');
        box.innerHTML = '<div class="wm-set-scroll"><div class="wbb-about"><canvas class="wbb-logo" aria-hidden="true"></canvas>'
            + `<p>${esc(TITLE)}&trade;</p><p>Designed for Melaton Mobile&trade;</p><p>by ${esc(DEVELOPER)}</p>`
            + '<p class="wbb-copy">Copyright &copy; 2026 Xyridian Corporation. All rights reserved.</p></div></div>';
        requestAnimationFrame(() => drawLogo(box.querySelector('.wbb-logo')));
    }

    // the About picture: a wall of bricks, the ball and the paddle, drawn as the game draws them
    function drawLogo(canvas) {
        if (!canvas) return;
        const css = canvas.clientWidth;
        if (!css) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(css * dpr);
        canvas.height = Math.round(css * dpr);
        const c = canvas.getContext('2d');
        const keep = Object.assign({}, L);
        // draw in a 120 x 120 field of its own
        L.ox = 0; L.oy = 0; L.scale = css / 120; L.dpr = dpr;
        const rows = ['rrr', 'oyy', 'gcb', 'bpk'];
        rows.forEach((row, y) => {
            for (let x = 0; x < 3; x++) {
                const shift = y % 2 ? 0 : 0;
                drawBrick(c, { kind: 'color', color: BRICK_CHARS.indexOf(row[x]), x: 6 + shift + x * 37, y: 10 + y * 15, w: 34, h: 14, hits: 0 });
            }
        });
        drawBall(c, { x: 76, y: 86 });
        const fake = { paddle: { x: 30, w: 60 }, paddleY: 98 };
        const saved = G.engine;
        G.engine = fake;
        drawPaddle(c);
        G.engine = saved;
        Object.assign(L, keep);
    }

    // ---------------------------------------------------------------- app

    function mount(p) {
        page = p;
        p.classList.add('wm-brickbreaker');
        p.dataset.view = 'main';
        p.innerHTML = `
            <div class="wbb-probe" aria-hidden="true"></div>
            <div class="wbb-view" data-view="main">
                <div class="wbb-status">
                    <span><b>Score:</b> <i data-v="score">0</i></span>
                    <span><b>Lives:</b> <i data-v="lives">3</i></span>
                    <span><b>Level:</b> <i data-v="level">1</i></span>
                </div>
                <div class="wbb-field" data-wm-no-hold><canvas aria-label="${esc(TITLE)}"></canvas></div>
            </div>
            <div class="wbb-view" data-view="options" hidden></div>
            <div class="wbb-view" data-view="stats" hidden></div>
            <div class="wbb-view" data-view="about" hidden></div>`;
        cv = p.querySelector('.wbb-field canvas');
        ctx = cv.getContext('2d');
        cv.addEventListener('pointerdown', onDown);
        cv.addEventListener('pointermove', onMove);
        cv.addEventListener('pointerup', onUp);
        cv.addEventListener('pointercancel', onUp);
        cv.addEventListener('contextmenu', (e) => e.preventDefault());
        if (window.ResizeObserver) new ResizeObserver(() => { if (view === 'main') layout(); }).observe(cv.parentElement);
        layout();
        // the game in memory comes back as it was left (X ends the page, not the game); after a
        // restart of the page the one saved on the way out (its ball back on the paddle)
        if (G.engine && live()) {
            bricksDirty = true;
            if (G.state === 'playing' || G.state === 'between') G.paused = true;
        } else if (!restoreGame()) newGame();
        renderStatus();
        layout();
    }

    function show() {
        if (view === 'main') requestAnimationFrame(() => { layout(); kick(); });
    }

    function hide() {
        pause();
        saveGame();
        stopLoop();
        G.keys.left = G.keys.right = false;
    }

    function softKeys() {
        if (view !== 'main') return { left: null, right: null };
        return {
            left: { label: 'New Game', action: askNewGame },
            right: {
                label: 'Menu',
                // the game stops while the menu is up (as the device's games do): Resume heads it then
                menu: () => (pause(), [
                    G.paused
                        ? { label: 'Resume', action: resume }
                        : { label: 'Pause', disabled: !(G.state === 'playing' || G.state === 'between'), action: pause },
                    '-',
                    { label: 'Options...', action: () => openPage('options') },
                    { label: 'Statistics', action: () => openPage('stats') },
                    '-',
                    { label: 'About', action: () => openPage('about') }
                ])
            }
        };
    }

    function backToGame(apply) {
        if (view === 'options' && apply) commitOptions();
        draft = null;
        showView('main');
        ws.syncHistory();
        return true;
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: 'app-brickbreaker',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show,
            hide,
            titleKind: () => (view === 'main' ? 'close' : 'ok'),
            onTitleOk: () => (view === 'main' ? false : backToGame(true)),
            historyDepth: () => (view === 'main' ? 0 : 1),
            onBack: () => (view === 'main' ? false : backToGame(view !== 'options')),
            onEnd() { hide(); view = 'main'; page = null; cv = null; ctx = null; },
            softKeys
        });
        document.addEventListener('keydown', onKey);
        document.addEventListener('keyup', onKey);
        document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    }

    // tests: the engine and the game state
    window.wmBrickBreaker = { BrickEngine, LAYOUTS, game: G, layout: L, newGame, launch, pause, resume, draw, step: (dt) => { step(dt); draw(); } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
