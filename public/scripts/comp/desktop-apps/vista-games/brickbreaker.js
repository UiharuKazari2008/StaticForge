// Brick Breaker: a paddle-and-ball game that sits with the Windows Vista games (Yozora #609).
// Vista never shipped one, so this is built as Oberon would have: on the shared engine
// (public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js), in Minesweeper's frame,
// with glossy bricks, paddle, ball and capsules in the games' style
// (scripts/build-vista-arcade-art.js writes /static_images/vista-games/brickbreaker/), the card
// games' particles and the real games' sounds, and Vista's dialog wording.
//
//   - the client is the Minesweeper board panel around a 420 x 337 field; lives, score and level
//     sit in the bottom bar where Minesweeper keeps its clock and mine counter
//   - the paddle follows the mouse (or the Left / Right arrows, Options); the ball leaves it at an
//     angle set by where it hits, up to 60 degrees from upright
//   - 20 levels: 10 drawn by hand, then 10 built from a seed per level; silver bricks take several
//     hits and crack, gold ones never break; clearing level 20 wins the game
//   - capsules: wide paddle, three balls, slow ball, catch (the ball sticks to the paddle), and a
//     rare extra ball
//   - the game pauses while its window is inactive or minimized (F3 or P pauses too); the field is
//     covered while paused, and Paused / Ready show on Block Drop's Vista card
//
// The rules are pure (no DOM): scripts/test-vista-arcade.js loads this file in node and tests
// them through module.exports.
(function (root) {
    'use strict';

    // The game's name, everywhere it shows (title bar, menus, dialogs, Games Explorer)
    const DISPLAY_NAME = 'Brick Breaker';
    // who made it (About box, Games Explorer)
    const DEVELOPER = 'Academy City Research P.S.R.';
    const COPYRIGHT = 'Copyright \u00a9 2026 ' + DEVELOPER + '\u00a0 All rights reserved.';

    // ---- rules --------------------------------------------------------------------------------
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
            this.paddle = { x: (FIELD_W - PADDLE_W) / 2, w: PADDLE_W, vx: 0 };
            this.loadLevel(this.level);
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
            this.balls = [{ x: p.x + p.w / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck: true, offset: p.w / 2, held: 0 }];
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
                    b.y = PADDLE_Y - BALL_R;
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
                if (b.y - BALL_R > FIELD_H) b.lost = true;
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
            const top = PADDLE_Y + 2;
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
                const caught = c.y + 6 >= PADDLE_Y + 2 && c.y - 6 <= PADDLE_Y + PADDLE_H && c.x + 13 >= p.x && c.x - 13 <= p.x + p.w;
                if (caught) {
                    c.done = true;
                    this.collect(c.type);
                } else if (c.y - 7 > FIELD_H) c.done = true;
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

    const rules = {
        DISPLAY_NAME, FIELD_W, FIELD_H, BRICK_COLS, BRICK_W, BRICK_H, BRICK_TOP, PADDLE_Y, PADDLE_W, PADDLE_WIDE, BALL_R, MAX_ANGLE,
        LEVELS, LAYOUTS, SPEEDS, layoutFor, buildBricks, silverHits, mulberry32, BrickEngine
    };
    if (typeof module === 'object' && module.exports) module.exports = rules;

    const VG = root.VistaGames;
    if (!VG || typeof document === 'undefined') return;

    // ---- game window ------------------------------------------------------------------------
    const GAME_ID = 'brickbreaker';
    const MODAL_ID = 'vistaBrickBreakerModal';
    const ICON = '/static_images/vista-games/icons/' + GAME_ID;
    const FX = 30;
    const FY = 30;
    const NATIVE_W = FX + FIELD_W + 30;
    const NATIVE_H = FY + FIELD_H + 33;
    const MS_MIN_W = 9 * 18 + 60;
    const LEVEL_PAUSE = 1800;

    const CMD = { NEW: 40006, STATS: 40003, OPTIONS: 40004, APPEARANCE: 40002, EXIT: 40005, HELP: 40008, ABOUT: 40007 };
    const MENU = [
        { text: '&Game', items: [
            { id: CMD.NEW, text: '&New Game\tF2' },
            { separator: true },
            { id: CMD.STATS, text: '&Statistics\tF4' },
            { id: CMD.OPTIONS, text: '&Options\tF5' },
            { id: CMD.APPEARANCE, text: 'Change &Appearance\tF7' },
            { separator: true },
            { id: CMD.EXIT, text: 'E&xit' }
        ] },
        { text: '&Help', items: [
            { id: CMD.HELP, text: '&View Help\tF1' },
            { separator: true },
            { id: CMD.ABOUT, text: '&About ' + DISPLAY_NAME }
        ] }
    ];
    const ACCELERATORS = [
        { flags: 1, key: 112, id: CMD.HELP }, { flags: 1, key: 113, id: CMD.NEW }, { flags: 1, key: 115, id: CMD.STATS },
        { flags: 1, key: 116, id: CMD.OPTIONS }, { flags: 1, key: 118, id: CMD.APPEARANCE }
    ];

    const STR = {
        newGame: 'New Game',
        newGameAsk: 'What do you want to do with the game in progress?',
        quitNew: 'Quit and start a &new game\nThis counts as a loss in your statistics.',
        keepPlaying: '&Keep playing',
        exitGame: 'Exit Game',
        exitAsk: 'What do you want to do with the game in progress?',
        save: '&Save',
        dontSave: "&Don't save",
        cancel: 'Cancel',
        alwaysSave: 'Always save game on exit',
        savedFound: 'Saved Game Found',
        savedAsk: 'Do you want to continue your saved game?',
        yes: '&Yes',
        no: '&No',
        alwaysContinue: 'Always continue saved game',
        resetStats: 'Reset Statistics',
        resetAsk: 'Do you want to reset all your statistics to zero?',
        changed: 'Changed Game Settings',
        changedAsk: "These settings won't apply to the game in progress. What do you want to do?",
        changedQuit: 'Quit and start a &new game with the new settings\nThis counts as a loss in your statistics.',
        changedFinish: '&Finish the game\nThe new settings apply to your next game.',
        gameWon: 'Game Won',
        gameLost: 'Game Lost',
        won: 'Congratulations, you won the game!',
        lost: 'Sorry, you lost this game. Better luck next time!',
        newHigh: 'You have a new high score!',
        played: 'Games played: %1',
        gamesWon: 'Games won: %1',
        winPct: 'Win percentage: %1%',
        longestWin: 'Longest winning streak: %1',
        longestLose: 'Longest losing streak: %1',
        streakWin: ['Current streak: %1 wins', 'Current streak: %1 win'],
        streakLose: ['Current streak: %1 losses', 'Current streak: %1 loss'],
        pct: 'Percentage: %1%',
        score: 'Score: %1',
        highScore: 'High score: %1',
        date: 'Date: %1',
        time: 'Time: %1',
        level: 'Level: %1',
        bricks: 'Bricks: %1',
        bestLevel: 'Highest level: %1',
        mostBricks: 'Most bricks in a game: %1',
        totalBricks: 'Bricks broken: %1',
        statsTitle: DISPLAY_NAME + ' Statistics - %1',
        appearance: 'Change Appearance',
        selectBricks: 'Select Bricks',
        selectBackground: 'Select Background',
        randomLook: '&Randomly choose bricks and background',
        howTo: 'How To Play',
        howToText: 'Bounce the ball off your paddle to break every brick. Where the ball hits the paddle sets its angle. '
            + 'Catch the capsules that fall for wide paddle, three balls, slow ball, catch and extra ball.',
        controls: 'Controls',
        controlsMouse: 'Move the mouse to move the paddle. Click to launch the ball. P or F3: pause.',
        controlsKeys: 'Left and Right arrows: move the paddle. Spacebar or Up arrow: launch the ball. P or F3: pause.',
        paused: 'Paused',
        resume: 'Press P or click to continue',
        ready: 'Ready?',
        launchMouse: 'Click to launch the ball',
        launchKeys: 'Press Spacebar to launch the ball',
        levelTitle: 'Level %1',
        levelCleared: 'Level %1 cleared',
        bonus: 'Bonus %1',
        powerNames: { wide: 'Wide Paddle', multi: 'Three Balls', slow: 'Slow Ball', sticky: 'Catch', life: 'Extra Ball' }
    };

    const BRICK_STYLES = [{ name: 'Glossy', sprite: 'Bricks_Glossy.xml' }, { name: 'Crystal', sprite: 'Bricks_Crystal.xml' }];
    // field backgrounds, painted (cached per pixel scale)
    const BACKGROUNDS = [
        { name: 'Aurora', paint: paintAurora },
        { name: 'Twilight', paint: paintTwilight },
        { name: 'Frost', paint: paintFrost, light: true }
    ];

    // Vista's Aurora: deep blue, ribbons of green and cyan light
    function paintAurora(ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#06173a');
        g.addColorStop(0.6, '#0d2f66');
        g.addColorStop(1, '#1b4f92');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ribbons(ctx, w, h, [[90, 220, 170], [60, 180, 255], [140, 255, 200]], 0.22);
        glow(ctx, w * 0.5, h * 1.05, w * 0.7, 'rgba(120,190,255,0.35)');
    }

    function paintTwilight(ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#120a2e');
        g.addColorStop(0.55, '#3a1c5c');
        g.addColorStop(0.85, '#8a3a64');
        g.addColorStop(1, '#d0704a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        const rnd = mulberry32(42);
        for (let i = 0; i < 70; i++) {
            const x = rnd() * w;
            const y = rnd() * h * 0.6;
            const r = 0.4 + rnd() * 0.9;
            ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + rnd() * 0.6) + ')';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ribbons(ctx, w, h, [[255, 150, 200], [180, 120, 255]], 0.12);
        glow(ctx, w * 0.5, h * 1.1, w * 0.6, 'rgba(255,170,110,0.45)');
    }

    function paintFrost(ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#f4f7fb');
        g.addColorStop(0.5, '#dfe7f1');
        g.addColorStop(1, '#bfcde0');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.globalAlpha = 0.5;
        for (let i = -2; i < 6; i++) {
            const x = i * w / 4;
            const sg = ctx.createLinearGradient(x, 0, x + w / 3, h);
            sg.addColorStop(0, 'rgba(255,255,255,0)');
            sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
            sg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + w / 8, 0);
            ctx.lineTo(x + w / 8 + h * 0.6, h);
            ctx.lineTo(x + h * 0.6, h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    function ribbons(ctx, w, h, colors, alpha) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        colors.forEach((c, i) => {
            const y0 = h * (0.25 + i * 0.18);
            ctx.beginPath();
            ctx.moveTo(-20, y0);
            for (let x = -20; x <= w + 20; x += 10) ctx.lineTo(x, y0 + Math.sin(x / w * Math.PI * (2 + i) + i) * h * 0.08);
            ctx.lineTo(w + 20, y0 + h * 0.18);
            for (let x = w + 20; x >= -20; x -= 10) ctx.lineTo(x, y0 + h * 0.18 + Math.sin(x / w * Math.PI * (1.5 + i) + i * 2) * h * 0.1);
            ctx.closePath();
            const g = ctx.createLinearGradient(0, y0 - h * 0.1, 0, y0 + h * 0.3);
            g.addColorStop(0, 'rgba(' + c.join(',') + ',0)');
            g.addColorStop(0.5, 'rgba(' + c.join(',') + ',' + alpha + ')');
            g.addColorStop(1, 'rgba(' + c.join(',') + ',0)');
            ctx.fillStyle = g;
            ctx.filter = 'blur(6px)';
            ctx.fill();
            ctx.filter = 'none';
        });
        ctx.restore();
    }

    function glow(ctx, x, y, r, color) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    const store = VG.store(GAME_ID);
    const DEFAULT_SETTINGS = {
        animations: true,
        sounds: true,
        tips: true,
        continueSaved: false,
        saveOnExit: false,
        startLevel: 1,
        speed: 'medium',
        control: 'mouse',
        style: 0,
        background: 0,
        randomLook: false
    };

    let game = null;

    function settings() {
        return Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
    }

    function saveSettings(s) {
        store.set('settings', s);
    }

    function blankStats() {
        return { played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: [], bestLevel: 0, mostBricks: 0, totalBricks: 0 };
    }

    function stats() {
        return Object.assign(blankStats(), store.get('stats', {}));
    }

    function fmt(template, ...args) {
        return String(template).replace(/%(\d)(?:!\w!)?/g, (_, n) => String(args[Number(n) - 1]));
    }

    // the current streak, as Solitaire's statistics write it (0 counts as wins)
    function streakText(streak) {
        const n = Math.abs(streak);
        const forms = streak < 0 ? STR.streakLose : STR.streakWin;
        return fmt(forms[n === 1 ? 1 : 0], n);
    }

    function clockText(ms) {
        const s = Math.floor(ms / 1000);
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function soundsNode(list) {
        return {
            t: 'Sounds',
            c: list.map(([name, file, volume, buffers]) => ({
                t: name,
                c: [{ t: 'File', v: file }, { t: 'Volume', v: String(volume) }, { t: 'Buffers', v: String(buffers) }]
            }))
        };
    }

    // three of Mahjong Titans' sounds, without loading its 880 KB pack data (as Block Drop's)
    const MAHJONG_AUDIO = {
        audioUrl: (file) => '/static_images/vista-games/mahjong/audio/' + file.replace(/\.wma$/i, '').toLowerCase() + '.m4a'
    };

    // the balloon (VG.drawTip fills it edge to edge since #609's engine fix)
    function drawTip(st, style, tip) {
        return VG.drawTip(st, style, tip);
    }

    // VG.warmSprites per pack: the sprites come from this game's pack, Minesweeper's and the card
    // games', and each pack loads its own sheets
    function warmSprites(stage, defs) {
        const byPack = new Map();
        defs.forEach((d) => {
            if (!byPack.has(d.pack)) byPack.set(d.pack, []);
            byPack.get(d.pack).push(d);
        });
        return Promise.all(Array.from(byPack, ([pack, list]) => VG.warmSprites(stage, pack, list)));
    }

    // ---- dialog templates (DIALOGEX layout in dialog units) ----------------------------------
    const BS_GROUPBOX = 0x50000007;
    const BS_DEFPUSH = 0x50030001;
    const BS_PUSH = 0x50010000;
    const BS_CHECK = 0x50010003;
    const BS_RADIO_FIRST = 0x50030009;
    const BS_RADIO = 0x50000009;
    const SS_LEFT = 0x50020000;
    const SS_CENTER = 0x50020001;
    const SS_RIGHT = 0x50020002;
    const ES_NUMBER = 0x50812080;

    const OPTIONS_TPL = {
        cx: 255, cy: 210, title: 'Options',
        controls: [
            { id: -1, className: 'Button', text: 'Game', x: 8, y: 6, cx: 240, cy: 76, style: BS_GROUPBOX },
            { id: 1101, className: 'Static', text: 'Starting &level (1-10):', x: 16, y: 21, cx: 96, cy: 8, style: SS_LEFT },
            { id: 1102, className: 'Edit', text: '', x: 116, y: 19, cx: 30, cy: 14, style: ES_NUMBER },
            { id: 1103, className: 'Static', text: 'Ball speed:', x: 16, y: 41, cx: 96, cy: 8, style: SS_LEFT },
            { id: 1104, className: 'Button', text: 'Sl&ow', x: 116, y: 40, cx: 38, cy: 10, style: BS_RADIO_FIRST },
            { id: 1105, className: 'Button', text: 'M&edium', x: 156, y: 40, cx: 42, cy: 10, style: BS_RADIO },
            { id: 1106, className: 'Button', text: '&Fast', x: 202, y: 40, cx: 38, cy: 10, style: BS_RADIO },
            { id: 1107, className: 'Static', text: 'Move the paddle with:', x: 16, y: 59, cx: 96, cy: 8, style: SS_LEFT },
            { id: 1108, className: 'Button', text: 'The &mouse', x: 116, y: 58, cx: 50, cy: 10, style: BS_RADIO_FIRST },
            { id: 1109, className: 'Button', text: 'The &keyboard', x: 170, y: 58, cx: 70, cy: 10, style: BS_RADIO },
            { id: 1002, className: 'Button', text: '&Display animations', x: 15, y: 92, cx: 233, cy: 13, style: 0x50030003 },
            { id: 1017, className: 'Button', text: '&Play sounds', x: 15, y: 107, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1018, className: 'Button', text: '&Show tips', x: 15, y: 122, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1020, className: 'Button', text: 'Always &continue saved game', x: 15, y: 137, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1044, className: 'Button', text: '&Always save game on exit', x: 15, y: 152, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1, className: 'Button', text: 'OK', x: 95, y: 189, cx: 72, cy: 14, style: BS_DEFPUSH },
            { id: 2, className: 'Button', text: 'Cancel', x: 171, y: 189, cx: 72, cy: 14, style: BS_PUSH }
        ]
    };

    const STATS_TPL = {
        cx: 300, cy: 128, title: '',
        controls: [
            { id: 2, className: 'Button', text: '&Close', x: 113, y: 107, cx: 88, cy: 14, style: BS_DEFPUSH },
            { id: 1001, className: 'Button', text: '&Reset', x: 205, y: 107, cx: 88, cy: 14, style: BS_PUSH },
            { id: -1, className: 'Button', text: 'High Scores', x: 7, y: 6, cx: 136, cy: 62, style: BS_GROUPBOX }
        ].concat([0, 1, 2, 3, 4].reduce((list, i) => list.concat([
            { id: 1201 + i, className: 'Static', text: '', x: 14, y: 17 + i * 9, cx: 50, cy: 8, style: SS_RIGHT },
            { id: 1211 + i, className: 'Static', text: '', x: 72, y: 17 + i * 9, cx: 66, cy: 8, style: SS_LEFT }
        ]), [])).concat([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            // three groups as Solitaire's: games, streaks, this game's own records
            { id: 1221 + i, className: 'Static', text: '', x: 152, y: 6 + i * 10 + Math.floor(i / 3) * 4, cx: 141, cy: 8, style: SS_LEFT }
        )))
    };

    function resultTemplate(won) {
        return {
            cx: 248, cy: 128, title: won ? STR.gameWon : STR.gameLost,
            controls: [
                { id: 1300, className: 'Static', text: won ? STR.won : STR.lost, x: 7, y: 8, cx: 234, cy: 12, style: SS_CENTER },
                { id: -1, className: 'Button', text: 'Game Score', x: 7, y: 23, cx: 234, cy: 46, style: BS_GROUPBOX },
                { id: 1301, className: 'Static', text: '', x: 18, y: 36, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1302, className: 'Static', text: '', x: 130, y: 36, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1303, className: 'Static', text: '', x: 18, y: 48, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1304, className: 'Static', text: '', x: 130, y: 48, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1309, className: 'Static', text: STR.newHigh, x: 18, y: 58, cx: 216, cy: 8, style: SS_LEFT },
                { id: 1305, className: 'Static', text: '', x: 13, y: 76, cx: 110, cy: 8, style: SS_LEFT },
                { id: 1306, className: 'Static', text: '', x: 130, y: 76, cx: 110, cy: 8, style: SS_LEFT },
                { id: 1307, className: 'Static', text: '', x: 13, y: 88, cx: 110, cy: 8, style: SS_LEFT },
                { id: 1308, className: 'Static', text: '', x: 130, y: 88, cx: 110, cy: 8, style: SS_LEFT },
                { id: 2, className: 'Button', text: '&Play again', x: 38, y: 107, cx: 80, cy: 14, style: BS_DEFPUSH },
                { id: 1004, className: 'Button', text: 'E&xit', x: 130, y: 107, cx: 80, cy: 14, style: BS_PUSH }
            ]
        };
    }

    const APPEARANCE_TPL = {
        cx: 394, cy: 236, title: STR.appearance,
        controls: [
            { id: 1, className: 'Button', text: 'OK', x: 236, y: 215, cx: 72, cy: 14, style: BS_DEFPUSH },
            { id: 2, className: 'Button', text: 'Cancel', x: 310, y: 215, cx: 72, cy: 14, style: BS_PUSH },
            { id: 5002, className: 'Static', text: STR.selectBricks, x: 7, y: 7, cx: 234, cy: 8, style: SS_LEFT },
            { id: 5000, className: 'SysListView32', text: '', x: 7, y: 17, cx: 380, cy: 78, style: 0x5083084c },
            { id: 5003, className: 'Static', text: STR.selectBackground, x: 7, y: 103, cx: 234, cy: 8, style: SS_LEFT },
            { id: 5001, className: 'SysListView32', text: '', x: 7, y: 113, cx: 380, cy: 78, style: 0x5083084c },
            { id: 5004, className: 'Button', text: STR.randomLook, x: 7, y: 198, cx: 233, cy: 10, style: 0x50030003 }
        ]
    };

    // ---- look --------------------------------------------------------------------------------
    class Look {
        constructor(packs, s) {
            const ms = packs.ms;
            const doc = ms.xml('UI\\Minesweeper.xml');
            const shared = VG.child(doc, 'Shared');
            const sp = (node, tag) => ms.sprite(VG.text(node, tag));
            const names = ['TopLeftHorz', 'TopLeftVert', 'TopCenter', 'TopRightHorz', 'TopRightVert', 'CenterLeft', 'CenterRight',
                'BottomLeftHorz', 'BottomLeftVert', 'BottomCenter', 'BottomRightHorz', 'BottomRightVert'];
            this.panel = {};
            names.forEach((n) => { this.panel[n] = sp(shared, 'PanelCustom' + n + 'Xml'); });
            this.numberPanel = ms.sprite('UI\\Blue_Number_Panel.xml');
            const layout = VG.child(VG.child(doc, 'Layouts'), 'CustomLayout');
            const lay = (tag) => {
                const n = VG.child(layout, tag);
                return { x: VG.num(n, 'X'), y: VG.num(n, 'Y'), w: VG.num(n, 'Width'), h: VG.num(n, 'Height') };
            };
            this.pos = { timeImage: lay('TimeImage'), timeBack: lay('TimeLabelBack'), timeLabel: lay('TimeLabel'), mineImage: lay('MineImage'), minesBack: lay('MinesLabelBack'), minesLabel: lay('MinesLabel') };
            this.tipStyle = VG.tipStyle(ms, 'White');
            const cg = packs.cards;
            this.particles = { sparkle: cg.sprite('SparkleParticle.xml'), star: cg.sprite('StarParticle.xml'), blob: cg.sprite('BlobParticle.xml') };
            const g = packs.game;
            this.bricks = BRICK_STYLES.map((b) => g.sprite(b.sprite));
            this.metal = g.sprite('Bricks_Metal.xml');
            this.paddle = { l: g.sprite('Paddle_Left.xml'), m: g.sprite('Paddle_Middle.xml'), r: g.sprite('Paddle_Right.xml') };
            this.ball = g.sprite('Ball.xml');
            this.capsules = g.sprite('Capsules.xml');
            // the real games' sounds, at Block Drop's levels: Mahjong Titans' tile clacks for a brick
            // breaking (Minesweeper's tile beep, some 30 dB louder than the card games' sounds, was far
            // too loud for a sound heard several times a second), Minesweeper's and the card games'
            // for the rest
            this.sounds = [
                new VG.Sounds(MAHJONG_AUDIO, soundsNode([
                    ['Brick', 'Mahjong_PieceClack01.wma', 80, 3],
                    ['Brick', 'Mahjong_PieceClack02.wma', 80, 3],
                    ['Brick', 'Mahjong_PieceClack03.wma', 80, 3]
                ])),
                new VG.Sounds(ms, soundsNode([
                    ['NewGame', 'Minesweeper_GameStart.wma', 45, 1],
                    ['GameOver', 'Minesweeper_Lose.wma', 50, 1],
                    ['Win', 'Minesweeper_Win.wma', 55, 1],
                    ['Solid', 'InvalidMove.wma', 35, 3]
                ])),
                new VG.Sounds(cg, soundsNode([
                    ['Paddle', 'Hearts_CardPlayed.wma', 85, 3],
                    ['Dent', 'Shared_MoveCardSetDown.wma', 90, 3],
                    ['Shatter', 'Shared_CardShatter1.wma', 60, 2],
                    ['Shatter', 'Shared_CardShatter2.wma', 60, 2],
                    ['Shatter', 'Shared_CardShatter3.wma', 60, 2],
                    ['Launch', 'Shared_Liftoff.wma', 70, 2],
                    ['Collect', 'Shared_PointsChange.wma', 100, 2],
                    ['Capsule', 'Shared_HintShown.wma', 45, 2],
                    ['Lost', 'Shared_CardFalling.wma', 100, 1],
                    ['Cleared', 'Shared_MoveToHome.wma', 100, 1],
                    ['Firework', 'Spider_Fireworks01.wma', 80, 3],
                    ['Firework', 'Spider_Fireworks02.wma', 80, 3],
                    ['Firework', 'Spider_Fireworks03.wma', 80, 3],
                    ['Pause', 'Button_Stereo.wma', 45, 1]
                ]))
            ];
            this.bgCache = new Map();
            this.set(s.style, s.background);
        }

        set(style, background) {
            this.styleIndex = Math.max(0, Math.min(BRICK_STYLES.length - 1, style | 0));
            this.bgIndex = Math.max(0, Math.min(BACKGROUNDS.length - 1, background | 0));
            this.brick = this.bricks[this.styleIndex];
            this.bg = BACKGROUNDS[this.bgIndex];
        }

        // the field background at this pixel scale, painted once
        background(index, pixelScale) {
            const s = Math.max(1, Math.round(pixelScale * 4) / 4);
            const key = index + '@' + s;
            if (!this.bgCache.has(key)) {
                const c = document.createElement('canvas');
                c.width = Math.round(FIELD_W * s);
                c.height = Math.round(FIELD_H * s);
                const ctx = c.getContext('2d');
                ctx.scale(s, s);
                BACKGROUNDS[index].paint(ctx, FIELD_W, FIELD_H);
                this.bgCache.set(key, c);
            }
            return this.bgCache.get(key);
        }

        play(name) {
            for (const s of this.sounds) {
                if (s.defs[name]) return s.play(name);
            }
            return null;
        }

        setSound(on) {
            this.sounds.forEach((s) => { s.enabled = on; });
        }

        warmSounds() {
            this.sounds.forEach((s) => s.warm());
        }

        allSprites() {
            const list = Object.values(this.panel).concat([this.numberPanel, this.metal, this.ball, this.capsules], this.bricks,
                Object.values(this.paddle), Object.values(this.particles));
            if (this.tipStyle) list.push(...this.tipStyle.sprites());
            return list.filter(Boolean);
        }
    }

    // ---- game --------------------------------------------------------------------------------
    class BrickBreaker {
        constructor(packs) {
            this.packs = packs;
            this.pack = packs.game;
            this.s = settings();
            this.look = new Look(packs, this.s);
            this.state = 'ready';     // ready (ball on the paddle) | playing | between | ending | over
            this.paused = false;
            this.time = 0;
            this.keys = { left: false, right: false };
            this.pointerX = null;
            this.effects = [];
            this.trails = new Map();
            this.tip = null;
            this.last = 0;
            this.pack.mui.accelerators.game = ACCELERATORS;
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: DISPLAY_NAME,
                // the caption / taskbar icon: the app-icon set (getModalIcons, modalUtils.js, keeps the file name)
                icon: '/static_images/app_icons/48/vista-' + GAME_ID + '.webp',
                iconClass: 'fas fa-table-tennis-paddle-ball',
                pack: this.pack,
                menu: MENU,
                accelerators: 'game',
                nativeW: NATIVE_W,
                nativeH: NATIVE_H,
                fill: '#d9dfe7',
                maximizable: true,
                onCommand: (id) => this.command(id),
                onClose: () => this.requestExit(),
                onActivate: (active) => this.setActive(active),
                onKeyDown: (e) => this.keyDown(e),
                onKeyUp: (e) => this.keyUp(e)
            });
            const stage = this.win.stage;
            stage.draw = (ctx, st) => this.draw(st);
            stage.onFrame = (now) => this.frame(now);
            this.wirePointer();
            this.newGame(false);
        }

        warm() {
            return warmSprites(this.win.stage, this.look.allSprites());
        }

        // ---- game flow -------------------------------------------------------------------------
        newGame(sound) {
            this.engine = new BrickEngine({ startLevel: this.s.startLevel, speed: this.s.speed });
            this.state = 'ready';
            this.started = false;
            this.time = 0;
            this.paused = false;
            this.effects = [];
            this.trails = new Map();
            this.ending = null;
            this.between = null;
            this.keys.left = this.keys.right = false;
            this.banner(fmt(STR.levelTitle, this.engine.level));
            if (sound !== false && this.win.isOpen()) this.look.play('NewGame');
            if (this.tip && this.tip.id === 'Help') this.hideTip();
            this.win.stage.invalidate();
        }

        // started: a ball has left the paddle this game (only then does quitting count)
        inProgress() {
            return this.started && (this.state === 'ready' || this.state === 'playing' || this.state === 'between');
        }

        live() {
            return this.state === 'ready' || this.state === 'playing' || this.state === 'between';
        }

        setActive(active) {
            if (!active) {
                this.keys.left = this.keys.right = false;
                if (this.live() && !this.paused) this.pause();
            }
            this.win.stage.invalidate();
        }

        pause() {
            if (!this.live() || this.paused) return;
            this.paused = true;
            this.keys.left = this.keys.right = false;
            this.win.stage.invalidate();
        }

        resume() {
            if (!this.paused) return;
            this.paused = false;
            this.last = VG.now();
            if (this.tip && this.tip.id === 'Help') this.hideTip();
            this.win.stage.invalidate();
        }

        togglePause() {
            if (!this.live()) return;
            this.look.play('Pause');
            if (this.paused) this.resume();
            else this.pause();
        }

        launch() {
            if (this.paused || !this.live() || this.state === 'between') return;
            if (this.engine.launch()) {
                this.started = true;
                this.state = 'playing';
                if (this.tip && this.tip.id === 'Start') this.hideTip();
                this.last = VG.now();
                this.handleEvents();
                this.win.stage.invalidate();
            }
        }

        finish() {
            const won = this.engine.won;
            this.state = 'over';
            this.record(won);
            store.remove('saved');
            this.showResult(won);
        }

        record(won) {
            const e = this.engine;
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
            this.lastHigh = false;
            if (e.score > 0) {
                const entry = { score: e.score, date: Date.now(), level: e.level };
                st.best.push(entry);
                st.best.sort((a, b) => b.score - a.score || a.date - b.date);
                st.best = st.best.slice(0, 5);
                this.lastHigh = st.best[0] === entry;
            }
            st.bestLevel = Math.max(st.bestLevel, e.level);
            st.mostBricks = Math.max(st.mostBricks, e.broken);
            st.totalBricks += e.broken;
            store.set('stats', st);
            this.lastStats = st;
        }

        // ---- input -----------------------------------------------------------------------------
        wirePointer() {
            const surface = this.win.surface;
            const pos = (e) => {
                const r = surface.getBoundingClientRect();
                return this.win.stage.toNative(e.clientX - r.left, e.clientY - r.top);
            };
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointermove', (e) => {
                const p = pos(e);
                if (this.tipHit(p, 'move')) this.win.stage.invalidate();
                if (this.s.control === 'mouse') {
                    this.pointerX = p.x - FX;
                    if (this.live() && !this.paused) this.win.stage.invalidate();
                }
            });
            surface.addEventListener('pointerdown', (e) => {
                surface.focus({ preventScroll: true });
                const p = pos(e);
                if (this.tipHit(p, 'down')) return;
                if (e.button !== 0) return;
                if (this.paused) {
                    this.togglePause();
                    return;
                }
                this.launch();
            });
            surface.addEventListener('pointerup', (e) => {
                this.tipHit(pos(e), 'up');
            });
        }

        keyDown(e) {
            const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'p', 'F3', 'Enter'];
            if (keys.indexOf(k) < 0) return;
            e.preventDefault();
            if (k === 'p' || k === 'F3') {
                if (!e.repeat) this.togglePause();
                return;
            }
            if (this.paused) return;
            if (k === 'ArrowLeft' || k === 'ArrowRight') {
                this.keys[k === 'ArrowLeft' ? 'left' : 'right'] = true;
                // the keys take over from the mouse until it moves again
                this.pointerX = null;
                this.win.stage.invalidate();
            } else if (!e.repeat) this.launch();
        }

        keyUp(e) {
            if (e.key === 'ArrowLeft') this.keys.left = false;
            else if (e.key === 'ArrowRight') this.keys.right = false;
        }

        // ---- engine events -> sounds and effects ----------------------------------------------
        handleEvents() {
            const anim = this.s.animations;
            const now = VG.now();
            this.engine.takeEvents().forEach((ev) => {
                switch (ev.type) {
                case 'launch':
                    this.look.play('Launch');
                    break;
                case 'paddle':
                    this.look.play('Paddle');
                    break;
                case 'brickhit':
                    this.look.play(ev.solid ? 'Solid' : 'Dent');
                    if (anim) this.effects.push({ kind: 'flash', brick: ev.brick, at: now, life: 160 });
                    break;
                case 'brickbreak':
                    this.look.play(ev.brick.kind === 'silver' ? 'Shatter' : 'Brick');
                    if (anim) this.shatter(ev.brick, ev, now);
                    break;
                case 'capsule':
                    this.look.play('Capsule');
                    break;
                case 'collect':
                    this.look.play('Collect');
                    this.effects.push({ kind: 'text', text: STR.powerNames[ev.capsule], x: FX + this.engine.paddle.x + this.engine.paddle.w / 2, y: FY + 260, at: now, life: 1100, size: 15 });
                    break;
                case 'balllost':
                    if (ev.remaining) break;
                    this.look.play('Lost');
                    break;
                case 'lifelost':
                    this.state = 'ready';
                    this.trails = new Map();
                    break;
                case 'levelclear':
                    this.look.play('Cleared');
                    this.state = 'between';
                    this.between = { at: now, until: now + (anim ? LEVEL_PAUSE : 600) };
                    this.effects.push({ kind: 'text', text: fmt(STR.levelCleared, ev.level), x: FX + FIELD_W / 2, y: FY + FIELD_H * 0.42, at: now, life: LEVEL_PAUSE, size: 24 });
                    this.effects.push({ kind: 'text', text: fmt(STR.bonus, ev.bonus), x: FX + FIELD_W / 2, y: FY + FIELD_H * 0.42 + 28, at: now + 150, life: LEVEL_PAUSE - 150, size: 15 });
                    if (anim) this.fireworks(now, 3);
                    break;
                case 'gameover':
                    this.startEnding(false);
                    break;
                case 'win':
                    this.startEnding(true);
                    break;
                default:
                    break;
                }
            });
        }

        // the broken brick: its four quarters fall away, sparks fly
        shatter(br, ev, now) {
            const frame = br.kind === 'silver' ? { sprite: this.look.metal, frame: 2 } : { sprite: this.look.brick, frame: br.color };
            const qw = br.w / 2;
            const qh = br.h / 2;
            const sx = (ev.vx || 0) * 0.15;
            for (let i = 0; i < 4; i++) {
                const cx = (i % 2) * qw;
                const cy = Math.floor(i / 2) * qh;
                this.effects.push({
                    kind: 'shard', sprite: frame.sprite, frame: frame.frame, cx, cy, w: qw, h: qh, x: br.x + cx, y: br.y + cy,
                    vx: (i % 2 ? 40 : -40) + sx + (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 60, ay: 520, at: now, life: 650
                });
            }
            for (let i = 0; i < 4; i++) {
                this.effects.push({
                    kind: 'particle', sprite: i % 2 ? 'sparkle' : 'star', x: br.x + Math.random() * br.w, y: br.y + Math.random() * br.h,
                    vx: (Math.random() - 0.5) * 80, vy: -20 - Math.random() * 60, ay: 140, at: now + Math.random() * 60, life: 380 + Math.random() * 200, size: 12 + Math.random() * 12
                });
            }
        }

        fireworks(now, bursts) {
            for (let b = 0; b < bursts; b++) {
                const at = now + b * 420;
                const x = 60 + Math.random() * (FIELD_W - 120);
                const y = 50 + Math.random() * 120;
                this.effects.push({ kind: 'sound', name: 'Firework', at, life: 1 });
                for (let i = 0; i < 18; i++) {
                    const a = i / 18 * Math.PI * 2;
                    const sp = 70 + Math.random() * 50;
                    this.effects.push({
                        kind: 'particle', sprite: i % 3 ? 'star' : 'sparkle', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 60,
                        at, life: 800 + Math.random() * 300, size: 14 + Math.random() * 10
                    });
                }
            }
        }

        startEnding(won) {
            const now = VG.now();
            this.state = 'ending';
            this.look.play(won ? 'Win' : 'GameOver');
            const anim = this.s.animations;
            this.ending = { won, at: now, until: now + (anim ? (won ? 2800 : 1200) : 0) };
            if (won && anim) this.fireworks(now + 300, 5);
            this.win.stage.invalidate();
        }

        banner(text) {
            this.effects = this.effects.filter((fx) => fx.kind !== 'banner');
            this.effects.push({ kind: 'banner', text, x: FX + FIELD_W / 2, y: FY + 200, at: VG.now(), life: 1600, size: 26 });
        }

        // ---- tips ----------------------------------------------------------------------------
        showTip(id) {
            const mouse = this.s.control === 'mouse';
            const defs = { Start: [STR.howTo, STR.howToText], Help: [STR.controls, mouse ? STR.controlsMouse : STR.controlsKeys] };
            const d = defs[id];
            if (!d) return;
            this.tip = { id, title: d[0], message: d[1], alpha: 0, shownAt: VG.now(), noTimeout: true, target: 1 };
            this.win.stage.invalidate();
        }

        hideTip() {
            if (this.tip) this.tip.target = 0;
            this.win.stage.invalidate();
        }

        tipHit(p, phase) {
            const t = this.tip;
            if (!t || !t.rect || t.target === 0) return false;
            const c = t.rect.close;
            const onClose = p.x >= c.x && p.y >= c.y && p.x < c.x + c.w && p.y < c.y + c.h;
            if (phase === 'move') {
                if (t.closeHot !== onClose) {
                    t.closeHot = onClose;
                    return true;
                }
                return false;
            }
            if (phase === 'down' && onClose) {
                t.closeDown = true;
                this.win.stage.invalidate();
                return true;
            }
            if (phase === 'up' && t.closeDown) {
                t.closeDown = false;
                if (onClose) this.hideTip();
                return true;
            }
            return false;
        }

        // ---- frame -----------------------------------------------------------------------------
        frame(now) {
            const dt = Math.min(50, Math.max(0, now - (this.last || now)));
            this.last = now;
            let busy = false;
            const e = this.engine;
            const running = !this.paused && (this.state === 'ready' || this.state === 'playing');
            if (running) {
                if (this.state === 'playing') this.time += dt;
                const dir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
                const input = this.s.control === 'mouse' && this.pointerX !== null && !dir ? { x: this.pointerX } : { dir };
                e.step(dt, input);
                this.handleEvents();
                this.trackTrails(now);
                busy = this.state === 'playing' || dir !== 0 || this.state === 'ready';
            }
            if (this.state === 'between' && !this.paused) {
                busy = true;
                if (now >= this.between.until) {
                    this.between = null;
                    e.nextLevel();
                    e.takeEvents();
                    this.state = 'ready';
                    this.trails = new Map();
                    this.banner(fmt(STR.levelTitle, e.level));
                }
            }
            if (this.state === 'ending') {
                busy = true;
                if (now >= this.ending.until) {
                    this.state = 'over';
                    setTimeout(() => this.finish(), 0);
                }
            }
            this.effects.forEach((fx) => {
                if (fx.kind === 'sound' && !fx.played && now >= fx.at) {
                    fx.played = true;
                    this.look.play(fx.name);
                }
            });
            this.effects = this.effects.filter((fx) => now < fx.at + fx.life || (fx.kind === 'sound' && !fx.played));
            if (this.effects.length) busy = true;
            if (this.tip) {
                const k = this.tip.target ? 1 : -1;
                const before = this.tip.alpha;
                this.tip.alpha = Math.max(0, Math.min(1, this.tip.alpha + k * 0.08));
                if (this.tip.alpha !== before) busy = true;
                if (!this.tip.target && this.tip.alpha <= 0) this.tip = null;
            }
            return busy;
        }

        // the last few places of each ball (the streak behind it)
        trackTrails(now) {
            if (!this.s.animations) return;
            const seen = new Set();
            this.engine.balls.forEach((b) => {
                seen.add(b);
                if (!this.trails.has(b)) this.trails.set(b, []);
                const t = this.trails.get(b);
                if (b.stuck) {
                    t.length = 0;
                    return;
                }
                t.push({ x: b.x, y: b.y, at: now });
                while (t.length && now - t[0].at > 90) t.shift();
            });
            Array.from(this.trails.keys()).forEach((b) => { if (!seen.has(b)) this.trails.delete(b); });
        }

        // ---- drawing ---------------------------------------------------------------------------
        draw(st) {
            const now = VG.now();
            // the pointer hides over the field while the mouse drives the paddle
            const hide = this.s.control === 'mouse' && this.state === 'playing' && !this.paused;
            if (hide !== !!this.cursorHidden) {
                this.cursorHidden = hide;
                this.win.surface.style.cursor = hide ? 'none' : '';
            }
            this.drawPanel(st, NATIVE_W, NATIVE_H);
            this.drawField(st, now);
            this.drawCounters(st, NATIVE_W, NATIVE_H);
            this.drawOverlay(st);
            if (this.tip) {
                this.tip.rect = drawTip(st, this.look.tipStyle, Object.assign({}, this.tip, { x: FX + FIELD_W / 2 - 130, y: FY + 168, w: 260 }), this.tip.rect);
            }
        }

        drawPanel(st, W, H) {
            const p = this.look.panel;
            const topH = p.TopCenter.h;
            const botH = p.BottomCenter.h;
            const side = p.CenterLeft.w;
            const brX = W - side - p.BottomRightHorz.w + 7;
            st.sprite(p.TopCenter, p.TopLeftHorz.w, 0, { w: W - p.TopLeftHorz.w - p.TopRightHorz.w });
            st.sprite(p.BottomCenter, side + p.BottomLeftHorz.w, H - botH, { w: brX - side - p.BottomLeftHorz.w });
            st.sprite(p.CenterLeft, 0, topH, { h: H - topH });
            st.sprite(p.CenterRight, W - side, topH, { h: H - topH });
            st.sprite(p.BottomLeftHorz, side, H - botH);
            st.sprite(p.BottomRightHorz, brX, H - botH);
            st.sprite(p.BottomLeftVert, 0, H - p.BottomLeftVert.h);
            st.sprite(p.BottomRightVert, W - side, H - p.BottomRightVert.h);
            st.sprite(p.TopLeftVert, 0, topH);
            st.sprite(p.TopRightVert, W - side, topH);
            st.sprite(p.TopLeftHorz, 0, 0);
            st.sprite(p.TopRightHorz, W - p.TopRightHorz.w, 0);
        }

        drawField(st, now) {
            const ctx = st.ctx;
            const look = this.look;
            const e = this.engine;
            ctx.drawImage(look.background(look.bgIndex, st.pixelScale), FX, FY, FIELD_W, FIELD_H);
            // the frame's inner edge
            ctx.save();
            ctx.strokeStyle = 'rgba(20,28,44,0.85)';
            ctx.lineWidth = 1;
            ctx.strokeRect(FX - 0.5, FY - 0.5, FIELD_W + 1, FIELD_H + 1);
            ctx.restore();
            if (this.paused) return;
            ctx.save();
            ctx.beginPath();
            ctx.rect(FX, FY, FIELD_W, FIELD_H);
            ctx.clip();
            const light = look.bg.light;
            // brick shadows, then the bricks
            ctx.fillStyle = light ? 'rgba(40,60,90,0.22)' : 'rgba(0,0,0,0.35)';
            e.bricks.forEach((b) => ctx.fillRect(FX + b.x + 2, FY + b.y + 3, b.w, b.h));
            e.bricks.forEach((b) => this.drawBrick(st, b, FX + b.x, FY + b.y));
            this.effects.forEach((fx) => {
                if (fx.kind !== 'flash' || now < fx.at) return;
                const k = (now - fx.at) / fx.life;
                ctx.save();
                ctx.globalAlpha = Math.max(0, 0.7 * (1 - k));
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(FX + fx.brick.x + 1, FY + fx.brick.y + 1, fx.brick.w - 2, fx.brick.h - 2);
                ctx.restore();
            });
            // capsules
            e.capsules.forEach((c) => {
                const bob = Math.sin(c.t * 6) * 1;
                st.sprite(look.capsules, FX + c.x, FY + c.y + bob, { frame: CAPSULE_TYPES.indexOf(c.type) });
            });
            this.drawPaddle(st, now);
            if (this.state !== 'between') this.drawBalls(st, now);
            this.drawEffects(st, now);
            ctx.restore();
            this.drawTexts(st, now);
        }

        // a served ball waits on the paddle (not one the Catch capsule holds)
        serving() {
            return this.state === 'ready' && !this.paused && this.engine.balls.some((b) => b.stuck && !b.caught);
        }

        drawBrick(st, b, x, y) {
            if (b.kind === 'color') st.sprite(this.look.brick, x, y, { frame: b.color });
            else if (b.kind === 'gold') st.sprite(this.look.metal, x, y, { frame: 3 });
            else st.sprite(this.look.metal, x, y, { frame: Math.min(2, b.hits) });
        }

        drawPaddle(st) {
            const e = this.engine;
            const p = e.paddle;
            const look = this.look;
            const frame = e.powers.sticky > 0 ? 1 : 0;
            const x = FX + p.x;
            const y = FY + PADDLE_Y;
            const capL = look.paddle.l.w;
            const capR = look.paddle.r.w;
            const ctx = st.ctx;
            ctx.save();
            ctx.fillStyle = look.bg.light ? 'rgba(40,60,90,0.2)' : 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            ctx.ellipse(x + p.w / 2, y + 16, p.w / 2, 3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            st.sprite(look.paddle.l, x, y, { frame });
            st.sprite(look.paddle.m, x + capL, y, { frame, w: Math.max(0, p.w - capL - capR) });
            st.sprite(look.paddle.r, x + p.w - capR, y, { frame });
            // the power about to run out blinks
            const ending = Math.max(e.powers.wide, e.powers.sticky);
            if (ending > 0 && ending < 2500 && Math.floor(ending / 180) % 2) {
                ctx.save();
                ctx.globalAlpha = 0.35;
                ctx.globalCompositeOperation = 'lighter';
                st.sprite(look.paddle.l, x, y, { frame });
                st.sprite(look.paddle.m, x + capL, y, { frame, w: Math.max(0, p.w - capL - capR) });
                st.sprite(look.paddle.r, x + p.w - capR, y, { frame });
                ctx.restore();
            }
        }

        drawBalls(st) {
            const ctx = st.ctx;
            const look = this.look;
            const glowSprite = look.particles.blob;
            this.trails.forEach((t) => {
                t.forEach((p, i) => {
                    const k = (i + 1) / (t.length + 1);
                    ctx.save();
                    ctx.globalCompositeOperation = look.bg.light ? 'source-over' : 'lighter';
                    const s = 12 * k;
                    st.sprite(glowSprite, FX + p.x - s / 2, FY + p.y - s / 2, { w: s, h: s, alpha: (look.bg.light ? 0.15 : 0.3) * k });
                    ctx.restore();
                });
            });
            this.engine.balls.forEach((b) => {
                if (!look.bg.light) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    st.sprite(glowSprite, FX + b.x - 12, FY + b.y - 12, { w: 24, h: 24, alpha: 0.35 });
                    ctx.restore();
                }
                st.sprite(look.ball, FX + b.x, FY + b.y);
            });
        }

        drawEffects(st, now) {
            const ctx = st.ctx;
            const parts = this.look.particles;
            this.effects.forEach((fx) => {
                const t = now - fx.at;
                if (t < 0) return;
                const k = t / fx.life;
                const s = t / 1000;
                if (fx.kind === 'shard') {
                    const x = fx.x + fx.vx * s;
                    const y = fx.y + fx.vy * s + 0.5 * fx.ay * s * s;
                    const sc = 1 - k * 0.5;
                    st.sprite(fx.sprite, FX + x, FY + y, { frame: fx.frame, cx: fx.cx, cy: fx.cy, sw: fx.w, sh: fx.h, w: fx.w * sc, h: fx.h * sc, alpha: Math.max(0, 1 - k) });
                } else if (fx.kind === 'particle') {
                    const x = fx.x + fx.vx * s;
                    const y = fx.y + fx.vy * s + 0.5 * fx.ay * s * s;
                    const size = fx.size * (1 - k * 0.4);
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    st.sprite(parts[fx.sprite], FX + x - size / 2, FY + y - size / 2, { w: size, h: size, alpha: Math.max(0, 1 - k) });
                    ctx.restore();
                }
            });
        }

        drawTexts(st, now) {
            const ctx = st.ctx;
            this.effects.forEach((fx) => {
                if (fx.kind !== 'text' && fx.kind !== 'banner') return;
                const t = now - fx.at;
                if (t < 0) return;
                const k = t / fx.life;
                const a = k < 0.12 ? k / 0.12 : (k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1);
                const rise = fx.kind === 'text' ? k * 12 : 0;
                this.outlinedText(ctx, fx.text, fx.x, fx.y - rise, fx.size, a);
            });
        }

        outlinedText(ctx, text, x, y, size, alpha) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = size + 'px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = 'rgba(16,36,72,0.8)';
            ctx.strokeText(text, x, y);
            const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(1, '#cfe3ff');
            ctx.fillStyle = g;
            ctx.fillText(text, x, y);
            ctx.restore();
        }

        // Minesweeper's number panel, stretched by its middle to w
        numberPanel(st, x, y, w, text) {
            const np = this.look.numberPanel;
            const cap = 8;
            const pw = 40;
            const ph = 21;
            st.sprite(np, x, y, { sw: cap, sh: ph, w: cap, h: ph });
            st.sprite(np, x + cap, y, { cx: cap, sw: pw - cap * 2, sh: ph, w: w - cap * 2, h: ph });
            st.sprite(np, x + w - cap, y, { cx: pw - cap, sw: cap, sh: ph, w: cap, h: ph });
            const ctx = st.ctx;
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.fillText(text, x + w / 2, y + ph / 2 + 1);
            ctx.restore();
        }

        // the bottom bar: balls left (Minesweeper's clock slot), the score in the middle, the level
        // (its mine counter slot)
        drawCounters(st, W, H) {
            const look = this.look;
            const pos = look.pos;
            const e = this.engine;
            const cx = Math.floor(W / 2);
            const spread = Math.round((W - MS_MIN_W) * 0.35);
            const at = (o, side) => ({ x: cx + o.x + side * spread, y: H + o.y });
            const livesImg = at(pos.timeImage, -1);
            const livesBack = at(pos.timeBack, -1);
            const levelImg = at(pos.mineImage, 1);
            const levelBack = at(pos.minesBack, 1);
            const ctx = st.ctx;
            // the ball sprite is registered at its centre: centre it in the 25 px icon slot
            st.sprite(look.ball, livesImg.x + 12.5 - 3, livesImg.y + 12.5 - 3, { w: 18, h: 18 });
            this.numberPanel(st, livesBack.x, livesBack.y, 40, String(e.lives));
            this.numberPanel(st, cx - 44, H - 26, 88, String(e.score));
            this.numberPanel(st, levelBack.x, levelBack.y, 40, String(e.level));
            st.sprite(look.brick, levelImg.x + 1, levelImg.y + 7, { frame: 0, w: 26, h: 11 });
        }

        // Paused / Ready: Block Drop's small Vista card (main-instruction blue over its note, as the
        // games' task dialogs write them); paused also covers the field. Ready sits between the
        // bricks and the paddle, under the level banner, and gives way to the Start tip.
        drawOverlay(st) {
            const ctx = st.ctx;
            const ready = this.serving() && !this.tip;
            if (!this.paused && !ready) return;
            if (this.paused) {
                ctx.save();
                const g = ctx.createLinearGradient(0, FY, 0, FY + FIELD_H);
                g.addColorStop(0, 'rgba(236,241,248,0.94)');
                g.addColorStop(1, 'rgba(206,216,231,0.94)');
                ctx.fillStyle = g;
                ctx.fillRect(FX, FY, FIELD_W, FIELD_H);
                ctx.restore();
            }
            const title = this.paused ? STR.paused : STR.ready;
            const note = this.paused ? STR.resume : (this.s.control === 'mouse' ? STR.launchMouse : STR.launchKeys);
            const font = '"Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.save();
            ctx.font = '12px ' + font;
            const w = Math.min(FIELD_W - 16, Math.max(120, Math.ceil(ctx.measureText(note).width) + 28));
            const h = 58;
            const x = Math.round(FX + (FIELD_W - w) / 2) + 0.5;
            const y = Math.round(this.paused ? FY + (FIELD_H - h) / 2 : FY + 222) + 0.5;
            const card = () => {
                ctx.beginPath();
                ctx.roundRect(x, y, w, h, 4);
            };
            ctx.shadowColor = 'rgba(0,0,0,0.28)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
            card();
            const bg = ctx.createLinearGradient(0, y, 0, y + h);
            bg.addColorStop(0, '#ffffff');
            bg.addColorStop(0.55, '#f4f7fb');
            bg.addColorStop(1, '#e3eaf4');
            ctx.fillStyle = bg;
            ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(64,86,120,0.7)';
            ctx.stroke();
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#003399';
            ctx.font = '16px ' + font;
            ctx.fillText(title, FX + FIELD_W / 2, y + 20);
            ctx.fillStyle = '#4b4b4b';
            ctx.font = '12px ' + font;
            ctx.fillText(note, FX + FIELD_W / 2, y + 40);
            ctx.restore();
        }

        // ---- commands --------------------------------------------------------------------------
        command(id) {
            switch (id) {
            case CMD.NEW: this.askNewGame(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance(); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: this.showAbout(); break;
            case CMD.HELP:
                this.pause();
                this.showTip('Help');
                break;
            default: break;
            }
        }

        askNewGame() {
            if (!this.inProgress()) {
                this.newGame();
                return;
            }
            this.pause();
            VG.taskDialog({
                owner: this.win,
                title: STR.newGame,
                instruction: STR.newGameAsk,
                links: [VG.linkFromString(STR.quitNew, 1), VG.linkFromString(STR.keepPlaying, 3)]
            }).then((r) => {
                if (r === 1) {
                    this.record(false);
                    this.newGame();
                }
            });
        }

        requestExit(fromMenu) {
            if (!this.inProgress()) {
                if (fromMenu) VG.closeWindow(this.win);
                return true;
            }
            this.pause();
            if (this.s.saveOnExit) {
                this.saveGame();
                VG.closeWindow(this.win);
                return false;
            }
            VG.taskDialog({
                owner: this.win,
                title: STR.exitGame,
                instruction: STR.exitAsk,
                buttons: [{ id: 1, text: STR.save, default: true }, { id: 2, text: STR.dontSave }, { id: 3, text: STR.cancel }],
                check: { text: STR.alwaysSave, checked: this.s.saveOnExit }
            }).then((r) => {
                const id = r && typeof r === 'object' ? r.id : r;
                if (r && typeof r === 'object' && r.checked !== this.s.saveOnExit) {
                    this.s.saveOnExit = r.checked;
                    saveSettings(this.s);
                }
                if (id === 1) {
                    this.saveGame();
                    VG.closeWindow(this.win);
                } else if (id === 2) {
                    this.record(false);
                    store.remove('saved');
                    this.newGame(false);
                    VG.closeWindow(this.win);
                }
            });
            return false;
        }

        // a level is saved as it stands; the ball goes back on the paddle
        saveGame() {
            store.set('saved', { engine: this.engine.serialize(), time: this.time });
            this.newGame(false);
        }

        loadSaved(saved) {
            this.engine = BrickEngine.restore(saved.engine, {});
            this.time = saved.time || 0;
            // the ball waits on the paddle, so the game needs no pause to start again
            this.state = 'ready';
            this.started = true;
            this.paused = false;
            this.effects = [];
            this.trails = new Map();
            this.ending = null;
            this.between = null;
            this.hideTip();
            store.remove('saved');
            this.banner(fmt(STR.levelTitle, this.engine.level));
            this.win.stage.invalidate();
        }

        afterOpen() {
            const saved = store.get('saved', null);
            if (saved && saved.engine && !this.inProgress()) {
                if (this.s.continueSaved) {
                    this.loadSaved(saved);
                    return;
                }
                VG.taskDialog({
                    owner: this.win,
                    title: STR.savedFound,
                    instruction: STR.savedAsk,
                    buttons: [{ id: 1, text: STR.yes, default: true }, { id: 2, text: STR.no }],
                    check: { text: STR.alwaysContinue, checked: this.s.continueSaved }
                }).then((r) => {
                    const id = r && typeof r === 'object' ? r.id : r;
                    if (r && typeof r === 'object' && r.checked !== this.s.continueSaved) {
                        this.s.continueSaved = r.checked;
                        saveSettings(this.s);
                    }
                    if (id === 1) this.loadSaved(saved);
                    else store.remove('saved');
                });
                return;
            }
            if (this.state === 'ready' && !this.started && this.s.tips && !this.tip) this.showTip('Start');
        }

        showStats() {
            this.pause();
            const fill = (dlg) => {
                const st = stats();
                for (let i = 0; i < 5; i++) {
                    const e = st.best[i];
                    dlg.text(1201 + i, e ? String(e.score) : '');
                    dlg.text(1211 + i, e ? VG.formatDate(e.date) : '');
                }
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                dlg.text(1221, fmt(STR.played, st.played));
                dlg.text(1222, fmt(STR.gamesWon, st.won));
                dlg.text(1223, fmt(STR.winPct, pct));
                dlg.text(1224, fmt(STR.longestWin, st.longestWin));
                dlg.text(1225, fmt(STR.longestLose, st.longestLose));
                dlg.text(1226, streakText(st.streak));
                dlg.text(1227, fmt(STR.bestLevel, st.bestLevel));
                dlg.text(1228, fmt(STR.mostBricks, st.mostBricks));
                dlg.text(1229, fmt(STR.totalBricks, st.totalBricks));
            };
            VG.dialog(this.pack, STATS_TPL, {
                owner: this.win,
                title: fmt(STR.statsTitle, VG.userName()),
                init: fill,
                onCommand: (id, dlg) => {
                    if (id === 1001) {
                        VG.taskDialog({
                            owner: this.win,
                            title: STR.resetStats,
                            instruction: STR.resetAsk,
                            buttons: [{ id: 1, text: STR.yes }, { id: 2, text: STR.no, default: true }]
                        }).then((r) => {
                            if (r === 1) {
                                store.set('stats', blankStats());
                                fill(dlg);
                            }
                        });
                        return false;
                    }
                    return true;
                }
            });
        }

        showOptions() {
            this.pause();
            const s = this.s;
            const speedIds = { slow: 1104, medium: 1105, fast: 1106 };
            VG.dialog(this.pack, OPTIONS_TPL, {
                owner: this.win,
                init: (dlg) => {
                    dlg.text(1102, String(s.startLevel));
                    dlg.checked(speedIds[s.speed] || 1105, true);
                    dlg.checked(s.control === 'keyboard' ? 1109 : 1108, true);
                    dlg.checked(1002, s.animations);
                    dlg.checked(1017, s.sounds);
                    dlg.checked(1018, s.tips);
                    dlg.checked(1020, s.continueSaved);
                    dlg.checked(1044, s.saveOnExit);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return id === 2;
                    const next = Object.assign({}, s);
                    next.startLevel = Math.max(1, Math.min(10, parseInt(dlg.text(1102), 10) || 1));
                    next.speed = dlg.checked(1104) ? 'slow' : (dlg.checked(1106) ? 'fast' : 'medium');
                    next.control = dlg.checked(1109) ? 'keyboard' : 'mouse';
                    next.animations = dlg.checked(1002);
                    next.sounds = dlg.checked(1017);
                    next.tips = dlg.checked(1018);
                    next.continueSaved = dlg.checked(1020);
                    next.saveOnExit = dlg.checked(1044);
                    if (next.control === 'keyboard') this.pointerX = null;
                    this.applySettings(next, next.startLevel !== s.startLevel || next.speed !== s.speed);
                    return true;
                }
            });
        }

        applySettings(next, gameChanged) {
            this.s = next;
            saveSettings(next);
            this.look.setSound(next.sounds);
            if (!next.tips) this.hideTip();
            this.win.stage.invalidate();
            if (!gameChanged) return;
            if (!this.inProgress()) {
                this.newGame(false);
                return;
            }
            VG.taskDialog({
                owner: this.win,
                title: STR.changed,
                instruction: STR.changedAsk,
                links: [VG.linkFromString(STR.changedQuit, 1), VG.linkFromString(STR.changedFinish, 2)]
            }).then((r) => {
                if (r === 1) {
                    this.record(false);
                    this.newGame();
                }
            });
        }

        // a preview of a brick style / background with the game's own sprites
        thumbnail(style, background) {
            const scale = 2;
            const w = 100;
            const h = 75;
            const c = document.createElement('canvas');
            c.width = w * scale;
            c.height = h * scale;
            const st = Object.create(VG.Stage.prototype);
            st.ctx = c.getContext('2d');
            st.scale = scale;
            st.dpr = 1;
            st.requestSheet = () => {};
            const ctx = st.ctx;
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            const look = this.look;
            const bg = look.background(background, scale);
            ctx.drawImage(bg, 0, 0, bg.width, bg.width * h / w, 0, 0, w, h);
            const k = 0.42;
            ctx.save();
            ctx.scale(k, k);
            const brick = look.bricks[style];
            ['rrrrrr', 'oyyoyo', 'gggggg', 'cbcbcb'].forEach((row, y) => {
                for (let x = 0; x < 6; x++) {
                    const bx = 6 + x * BRICK_PITCH_X;
                    const by = 10 + y * BRICK_PITCH_Y;
                    ctx.fillStyle = BACKGROUNDS[background].light ? 'rgba(40,60,90,0.22)' : 'rgba(0,0,0,0.35)';
                    ctx.fillRect(bx + 2, by + 3, BRICK_W, BRICK_H);
                    st.sprite(brick, bx, by, { frame: BRICK_CHARS.indexOf(row[x]) });
                }
            });
            st.sprite(look.ball, 120, 120);
            const px = 80;
            st.sprite(look.paddle.l, px, 150);
            st.sprite(look.paddle.m, px + 12, 150, { w: 40 });
            st.sprite(look.paddle.r, px + 52, 150);
            ctx.restore();
            return c.toDataURL('image/png');
        }

        showAppearance() {
            this.pause();
            const look = this.look;
            let style = this.s.style;
            let background = this.s.background;
            VG.dialog(this.pack, APPEARANCE_TPL, {
                owner: this.win,
                title: STR.appearance,
                init: (dlg) => {
                    VG.fillThumbList(dlg.get(5000), BRICK_STYLES.map((b, i) => ({ text: b.name, img: this.thumbnail(i, background) })), style, (i) => { style = i; });
                    VG.fillThumbList(dlg.get(5001), BACKGROUNDS.map((b, i) => ({ text: b.name, img: this.thumbnail(style, i) })), background, (i) => { background = i; });
                    dlg.checked(5004, !!this.s.randomLook);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    this.s.randomLook = dlg.checked(5004);
                    if (this.s.randomLook) {
                        style = Math.floor(Math.random() * BRICK_STYLES.length);
                        background = Math.floor(Math.random() * BACKGROUNDS.length);
                    }
                    this.s.style = style;
                    this.s.background = background;
                    saveSettings(this.s);
                    look.set(style, background);
                    this.win.stage.invalidate();
                    return true;
                }
            });
        }

        showAbout() {
            VG.aboutBox({ owner: this.win, title: DISPLAY_NAME, text: DISPLAY_NAME + ' developed by ' + DEVELOPER, copyright: COPYRIGHT, icon: ICON + '-48.png' });
        }

        showResult(won) {
            const e = this.engine;
            const st = this.lastStats || stats();
            const best = st.best[0];
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            VG.dialog(this.pack, resultTemplate(won), {
                owner: this.win,
                texts: {
                    1301: fmt(STR.score, e.score),
                    1302: fmt(STR.time, clockText(this.time)),
                    1303: fmt(STR.level, e.level),
                    1304: fmt(STR.bricks, e.broken),
                    1305: fmt(STR.highScore, best ? best.score : 0),
                    1306: fmt(STR.date, VG.formatDate(best ? best.date : Date.now())),
                    1307: fmt(STR.played, st.played),
                    1308: fmt(STR.pct, pct)
                },
                init: (dlg) => {
                    dlg.show(1309, !!this.lastHigh && st.best.length > 1);
                },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1004) VG.closeWindow(this.win);
                    else this.newGame();
                }
            });
        }
    }

    function open() {
        return Promise.all([VG.loadPack(GAME_ID), VG.loadPack('minesweeper'), VG.loadPack('cardgames')]).then(([g, ms, cards]) => {
            if (!game) game = new BrickBreaker({ game: g, ms, cards });
            const first = !game.win.isOpen();
            game.look.setSound(game.s.sounds);
            return game.warm().then(() => {
                game.win.open();
                if (first) {
                    game.look.warmSounds();
                    game.afterOpen();
                }
                return game;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: DISPLAY_NAME,
        icon: ICON,
        thumbnail: '/static_images/vista-games/brickbreaker/images/thumbnail.png',
        feature: 'vista_' + GAME_ID,
        open
    });
    root.openVistaBrickBreaker = open;
    root.vistaBrickBreaker = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
