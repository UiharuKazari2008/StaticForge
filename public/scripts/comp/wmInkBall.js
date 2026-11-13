/**
 * Melaton Mobile: InkBall, Yozora #786 (Melaton Mobile games). Redrawn in WM style: the desktop
 * game's rules (public/scripts/comp/desktop-apps/vista-games/inkball.js, inkball.exe's own, Vista
 * games #609) as a Windows Mobile 6 program would have shipped beside Bubble Breaker and Solitaire.
 * InkBall was the Tablet PC's pen game, so the ink is drawn with the finger.
 *
 * Rules (the desktop's Game, copied by script, unchanged): the boards of IKL 20001
 * (/static_images/vista-games/inkball/boards.bin, the desktop's file, read at the first start),
 * 17 x 17 tiles; difficulties Beginner / Novice / Intermediate / Advanced / Expert each draw from
 * their own boards (the last ten never again), every fifth board a bonus board; balls leave the
 * launchers from the queue, bounce off the edge, walls, ink and each other; a coloured wall paints
 * the ball; a ball a stroke touches removes that stroke, and a 21st stroke takes the oldest (there
 * is no fade on a clock in inkball.exe: ink goes when a ball hits it or when it is the oldest of
 * 21); the right hole (or grey) scores 0 / 200 / 400 / 800 / 1600 by colour, a wrong one ends the
 * game, as does the clock; every 1600 points earns a wall tile; a cleared board counts its time
 * left into the score while two gold tiles chase round the edge. The game runs in inkball.exe's
 * 16 ms ticks (balls in 4 ms steps) from an accumulator, drawn between ticks, so it plays the
 * same at 60-120 Hz.
 *
 * Look: Bubble Breaker's page (status row of blue labels and black values, 1 VGA px rule), the
 * board drawn in GDI (flat fills, 3D bevels, shaded balls in InkBall's five colours), the ball queue
 * and the wall tiles in hand in a strip over the board. Soft keys New Game | Menu; Menu = Pause,
 * Clear Ink, rule, Difficulty (Beginner ... Expert), rule, Statistics, rule, About. Game over is a
 * message box ("Game over!", the exe's own texts); ok plays the same board again from 0 points.
 * Tap and hold an empty floor tile to drop a wall tile (the desktop's right button).
 * The game stops while a menu or a box is up and pauses (Paused box, tap to go on) when the app
 * is hidden (X keeps it) or the screen goes off; one rAF loop while it runs.
 * High score, difficulty and statistics: localStorage wmGame:inkball. Styles: wm-inkball.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'inkball';
    const TITLE = 'InkBall';
    const DEVELOPER = 'Academy City Research P.S.R.';
    const STORE_KEY = 'wmGame:inkball';
    const BOARDS_URL = '/static_images/vista-games/inkball/boards.bin';
    const DIFFICULTY_NAMES = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Expert'];
    const STR = {
        gameOver: 'Game over!',
        timeOut: 'You ran out of time.',
        wrongHole: 'A ball entered a hole of the wrong color.',
        paused: 'Paused',
        resume: 'Tap to continue',
        resetTitle: 'Reset Statistics',
        resetAsk: 'Do you want to reset all your statistics to zero?',
        loadError: 'Cannot load the game board. Please close other applications and try again.'
    };

    // ---- rules: inkball.js lines 35-47, 82-103, 108-146, 148-1094, copied by script ----------
    // CGameBoard::CGameBoard
    const TILE = 32;
    const COLS = 17;
    const ROWS = 17;
    const BOARD_X = 0;
    const BOARD_Y = 42;
    const NATIVE_W = 544;
    const NATIVE_H = 586;
    const BALL = 24;
    const QUEUE_BALL = 18;
    const STEP_MS = 4; // CGameBoard::PerformUpdate moves the balls in steps of at most 4 ms
    const INK_HALF = 5; // ink width 100 ink units = 10 px (CInk works in px x 10)
    const MAX_STROKES = 20;

    const BMP = {
        FLOOR: 0, LAUNCHER: 1, BALL: 2, BALL_SUNK: 7, QUEUE_BALL: 12, DRAIN: 17, WALL: 37, BREAK: 42, OWF: 47,
        BUMPER: 67, RL: 77, CHEVRON: 102, QUEUE_BOX: 106, SCORE_BAR: 107, TILE_BOX: 108, TIME_BOX: 109,
        WHITE_L: 110, WHITE_0: 111, WHITE_R: 121, GREEN_L: 122, GREEN_0: 123, GREEN_R: 133, SMALL_0: 134, SMALL_PLUS: 144,
        RED_L: 145, RED_0: 146, RED_DASH: 156, RED_BLANK: 157, RED_R: 158, GOLD_WALL: 41, GOLD_BREAK: 46
    };

    // scores (inkball.exe .data): a ball in a hole by ball colour; a broken wall
    const BALL_POINTS = [0, 200, 400, 800, 1600];
    const BREAK_POINTS = 10;
    const POINTS_PER_TILE = 1600;
    const DEFAULT_HISCORE = 5000;

    // CBoardManager::SetDifficulty: the boards of IKL 20001 each difficulty draws from
    // ([first, count] of the main boards and of the bonus boards every fifth level takes)
    const DIFFICULTIES = [
        { cmd: 40002, main: [0, 138], bonus: [138, 48] },
        { cmd: 40003, main: [186, 78], bonus: [264, 28] },
        { cmd: 40004, main: [292, 77], bonus: [369, 26] },
        { cmd: 40005, main: [395, 73], bonus: [468, 21] },
        { cmd: 40006, main: [489, 45], bonus: [534, 17] }
    ];

    // ---- boards (IKL 20001) ---------------------------------------------------------------------
    // A board: u16 BE length of the rest, u16 BE time limit (s, 0 = none), u8 launch interval (s),
    // u16 BE min speed, u16 BE max speed (px/s), u8 shuffle, u8 count + count ball colours, then
    // 17 x 17 cells of u16 BE (type << 12 | ...); a type 4 cell (breakable wall) is followed by the
    // u16 cell under it. A few boards carry spare bytes after the grid (the length skips them).
    function parseBoards(buffer) {
        const d = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const boards = [];
        let p = 0;
        while (p + 2 <= d.length) {
            const len = (d[p] << 8 | d[p + 1]) + 2;
            const r = d.subarray(p, p + len);
            const n = r[10];
            const board = {
                index: boards.length,
                time: r[2] << 8 | r[3],
                launch: r[4],
                minSpeed: r[5] << 8 | r[6],
                maxSpeed: r[7] << 8 | r[8],
                shuffle: r[9] !== 0,
                balls: Array.from(r.subarray(11, 11 + n)),
                cells: [],
                under: []
            };
            let q = 11 + n;
            for (let k = 0; k < COLS * ROWS && q + 1 < r.length; k++) {
                const v = r[q] << 8 | r[q + 1];
                q += 2;
                board.cells.push(v);
                if ((v >> 12) === 4) {
                    board.under[k] = r[q] << 8 | r[q + 1];
                    q += 2;
                }
            }
            boards.push(board);
            p += len;
        }
        return boards;
    }

    // ---- the game (CGameManager / CGameBoard; no DOM, scripts/test-vista-inkball.js runs it) ------
    const tdiv = (a, b) => Math.trunc(a / b);

    // GetCenterPoint / GetBoundingRect truncate the double position
    const center = (o) => [Math.trunc((o.w >> 1) + o.x), Math.trunc((o.h >> 1) + o.y)];
    const rectOf = (o) => [Math.trunc(o.x), Math.trunc(o.y), Math.trunc(o.w + o.x), Math.trunc(o.h + o.y)];
    const inRect = (x, y, r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];

    // sind / cosd: inkball.exe's degree factor
    const DEG = 0.017453277777777776;
    const sind = (a) => Math.sin(a * DEG);
    const cosd = (a) => Math.cos(a * DEG);

    // BallPoints::BallPoints: 32 points round the rim (11.25 degree steps from the left, the first
    // quadrant computed and mirrored, truncated to whole pixels)
    function ballPoints(w) {
        const r = w * 0.5;
        const q = [[Math.trunc(-r), 0]];
        for (let i = 1; i < 8; i++) q.push([Math.trunc(-cosd(i * 11.25) * r), Math.trunc(-sind(i * 11.25) * r)]);
        const pts = q.slice();
        pts.push([0, Math.trunc(-r)]);
        for (let i = 7; i >= 1; i--) pts.push([-q[i][0], q[i][1]]);
        pts.push([Math.trunc(r), 0]);
        for (let i = 15; i >= 9; i--) pts.push([pts[i][0], -pts[i][1]]);
        pts.push([0, Math.trunc(r)]);
        for (let i = 23; i >= 17; i--) pts.push([-pts[i][0], pts[i][1]]);
        return pts;
    }
    const POINT_CACHE = new Map();
    const pointsFor = (w) => {
        if (!POINT_CACHE.has(w)) POINT_CACHE.set(w, ballPoints(w));
        return POINT_CACHE.get(w);
    };

    // Round(): modf's fraction under .5 floors, else ceils (so every negative fraction floors)
    function round(v) {
        const f = v - Math.trunc(v);
        return f < 0.5 ? Math.floor(v) : Math.ceil(v);
    }

    function distToSegment(px, py, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const x = a[0] + t * dx - px;
        const y = a[1] + t * dy - py;
        return Math.sqrt(x * x + y * y);
    }

    class Game {
        // opts: { boards, rng () -> [0, 1), difficulty, hiScore, onKill(reason), onHiScore(score) }
        constructor(opts) {
            this.boards = opts.boards;
            this.rng = opts.rng || Math.random;
            this.onKill = opts.onKill || (() => {});
            this.onHiScore = opts.onHiScore || (() => {});
            this.hiScore = opts.hiScore || DEFAULT_HISCORE;
            this.score = 0;
            this.tiles = 0;      // CTileManager: wall tiles in hand
            this.tileBase = 0;   // the score the tiles were last counted at
            this.level = 0;      // boards cleared since the game began (every fifth is a bonus board)
            this.state = 'play'; // 'play' | 'complete' | 'wait' | 'dead'
            this.strokes = [];
            this.drawing = null; // the stroke the pointer is drawing
            this.seen = { main: [], bonus: [] }; // fPrevSeen: the last 10 boards drawn
            this.setDifficulty(opts.difficulty || 0);
        }

        // rand() % n, as the C runtime's 15-bit rand
        rand(n) {
            return Math.floor(this.rng() * 32768) % n;
        }

        setDifficulty(d) {
            this.difficulty = Math.max(0, Math.min(4, d | 0));
            this.seen = { main: [], bonus: [] };
        }

        // CBoardManager::LoadRandomBoardFromResources (+ the bonus list): a random board that is
        // not one of the last ten of that list
        pickBoard(bonus) {
            const list = DIFFICULTIES[this.difficulty][bonus ? 'bonus' : 'main'];
            const seen = this.seen[bonus ? 'bonus' : 'main'];
            for (;;) {
                const i = this.rand(list[1]);
                if (seen.includes(i)) continue;
                if (seen.length < 10 && seen.length + 1 < list[1]) seen.unshift(i);
                else {
                    seen.pop();
                    seen.unshift(i);
                }
                return this.boards[list[0] + i];
            }
        }

        newGame() {
            this.kill(2);
            this.loadBoard(this.pickBoard(false));
        }

        // ---- CGameManager::LoadBoard ----
        loadBoard(board) {
            this.board = board;
            this.state = 'play';
            this.balls = [];
            this.ballsLeft = 0;
            this.objects = []; // the update list after the time and ball managers (RL walls)
            this.rlColored = [];
            this.gold = null;
            this.goldAcc = 0;
            // CTimeManager::InitTime
            const t = board.time ? Math.min(board.time * 1000, 999000) : -1;
            this.clock = { time: t, started: false, timedOut: false, visible: true, blinkAcc: 0 };
            // CBallManager::Init
            this.queue = {
                launched: 0,
                left: board.balls.length,
                interval: board.launch * 1000,
                minSpeed: board.minSpeed,
                maxSpeed: board.maxSpeed,
                launchers: [],
                needInit: true,
                countdown: 4000,
                blink: false,
                blinkAcc: 0,
                slots: Array.from({ length: 6 }, () => ({ x: 0, y: 14, w: QUEUE_BALL, vx: 0, vy: 0, color: 0, alive: false }))
            };
            board.balls.forEach((c) => this.addBall(c, false));
            if (board.shuffle) {
                // CGameBoard::RandomizeBallOrder
                const n = this.balls.length;
                for (let i = 0; i < n; i++) {
                    const j = this.rand(n);
                    const tmp = this.balls[i];
                    this.balls[i] = this.balls[j];
                    this.balls[j] = tmp;
                }
                this.balls.forEach((b, i) => { b.idx = i; });
            }
            this.grid = new Array(COLS * ROWS);
            for (let k = 0; k < COLS * ROWS; k++) {
                const col = k % COLS;
                const row = tdiv(k, COLS);
                const t = this.buildTile(board.cells[k] || 0, col, row);
                if (t.kind === 'break') t.under = board.under[k] !== undefined ? this.buildTile(board.under[k], col, row) : null;
                this.grid[k] = t;
            }
        }

        // AddBallToBoard / AddAliveBallToBoard
        addBall(color, alive, at, angle) {
            const b = {
                idx: this.balls.length, x: 0, y: 0, w: BALL, h: BALL, vx: 0, vy: 0,
                color, bmp: BMP.BALL + color, alive: false, tall: 0
            };
            this.balls.push(b);
            this.ballsLeft++;
            if (alive) {
                b.x = at[0] - BALL * 0.5;
                b.y = at[1] - BALL * 0.5;
                this.setBallSpeed(b, angle);
                b.alive = true;
            }
            return b;
        }

        // BuildTileObject: cell = type << 12 | a << 8 | b << 4 | c
        buildTile(v, col, row) {
            const type = v >> 12 & 15;
            const a = v >> 8 & 15;
            const b = v >> 4 & 15;
            const c = v & 15;
            const t = { kind: 'floor', bmp: BMP.FLOOR, col, row, x: BOARD_X + col * TILE, y: BOARD_Y + row * TILE, w: TILE, h: TILE, color: 0 };
            switch (type) {
                case 1:
                    t.kind = 'launcher';
                    t.bmp = BMP.LAUNCHER;
                    this.queue.launchers.push(t);
                    break;
                case 2: // a hole quadrant: b = 0 top left, 1 top right, 2 bottom left, 3 bottom right
                    if (c > 4 || b > 3) break;
                    t.kind = 'drain';
                    t.color = c;
                    t.quad = b;
                    t.bmp = BMP.DRAIN + b + c * 4;
                    break;
                case 3:
                    if (c > 4) break;
                    t.kind = 'wall';
                    t.color = c;
                    t.bmp = BMP.WALL + c;
                    break;
                case 4:
                    if (c > 4) break;
                    t.kind = 'break';
                    t.color = c;
                    t.bmp = BMP.BREAK + c;
                    break;
                case 5: // one-way: b = the side the bar is on (0 top, 1 bottom, 2 left, 3 right)
                    if (c > 4 || b > 3) break;
                    t.kind = 'owf';
                    t.color = c;
                    t.dir = b;
                    t.bmp = BMP.OWF + b * 5 + c;
                    break;
                case 6: // a grey wall on a clock: up (a + 1) / 2 s, down (b + 1) / 2 s, c = its frame
                    if (c > 4) break;
                    t.kind = 'rlgray';
                    t.frame = c;
                    t.up = (a + 1) * 500;
                    t.down = (b + 1) * 500;
                    t.phase = c ? 2 : 0;
                    t.timer = 0;
                    t.stepAcc = 0;
                    t.bmp = BMP.RL + c * 5;
                    this.objects.push(t);
                    break;
                case 7: // a coloured wall a ball in a hole of its colour raises / lowers; b = frame
                    if (c > 4 || b > 4) break;
                    t.kind = 'rlcolor';
                    t.color = c;
                    t.frame = b;
                    t.phase = b ? 2 : 0;
                    t.timer = 0;
                    t.bmp = BMP.RL + b * 5 + c;
                    this.objects.push(t);
                    this.rlColored.push(t);
                    break;
                case 8: // b = 0 up, 1 down, 2 left, 3 right
                    if (b > 3) break;
                    t.kind = 'chevron';
                    t.dir = b;
                    t.bmp = BMP.CHEVRON + b;
                    break;
                case 9: // floor with a ball already rolling: angle (a << 4 | b) x 11.25 deg, 255 random
                    if (c <= 4) {
                        const ang = a << 4 | b;
                        if (ang === 255 || ang <= 31) this.addBall(c, true, [t.x + 16, t.y + 16], ang === 255 ? -1 : ang * 11.25);
                    }
                    break;
                case 10: // a bar only its colour passes: b = 0 across, 1 upright
                    if (c > 4 || b > 1) break;
                    t.kind = 'bumper';
                    t.color = c;
                    t.dir = b * 2;
                    t.bmp = BMP.BUMPER + b * 5 + c;
                    break;
                default:
                    break;
            }
            return t;
        }

        tileAt(x, y) {
            const col = tdiv(x - BOARD_X, TILE);
            const row = tdiv(y - BOARD_Y, TILE);
            if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
            return this.grid[row * COLS + col];
        }

        // CBallManager::SetBallSpeed: angle -1 = random, else degrees clockwise from up
        setBallSpeed(b, angle) {
            const q = this.queue;
            let s = q.maxSpeed;
            if (s !== q.minSpeed) s = this.rand(s - q.minSpeed) + q.minSpeed;
            if (angle === -1) {
                b.vx = this.rand(100) / 100 * s;
                b.vy = Math.sqrt(s * s - b.vx * b.vx);
                if (this.rand(2)) b.vx = -b.vx;
                if (this.rand(2)) b.vy = -b.vy;
                return;
            }
            if (angle === 0) angle = 360;
            if (angle <= 90) {
                b.vx = cosd(90 - angle) * s;
                b.vy = -sind(90 - angle) * s;
            } else if (angle <= 180) {
                b.vx = sind(180 - angle) * s;
                b.vy = cosd(180 - angle) * s;
            } else if (angle <= 270) {
                b.vx = -cosd(270 - angle) * s;
                b.vy = sind(270 - angle) * s;
            } else {
                b.vx = -sind(360 - angle) * s;
                b.vy = -cosd(360 - angle) * s;
            }
        }

        // CGameBoard::BallOnTile: a corner of a live ball inside the tile
        ballOnTile(t) {
            const r = [t.x, t.y, t.x + t.w, t.y + t.h];
            return this.balls.some((b) => {
                if (!b.alive) return false;
                const o = rectOf(b);
                return inRect(o[0], o[1], r) || inRect(o[2], o[1], r) || inRect(o[0], o[3], r) || inRect(o[2], o[3], r);
            });
        }

        // ---- CGameBoard::PerformUpdate ----
        update(dt) {
            if (this.state !== 'play') return;
            this.updateClock(dt);
            if (this.state !== 'play') return;
            this.updateQueue(dt);
            this.objects.forEach((t) => this.updateTile(t, dt));
            while (dt > 0 && this.state === 'play') {
                const step = Math.min(STEP_MS, dt);
                for (let i = 0; i < this.balls.length && this.state === 'play'; i++) this.moveBall(this.balls[i], step);
                dt -= step;
            }
            this.countTiles();
        }

        // CTileManager::SetTiles
        countTiles() {
            if (this.score === 0) {
                this.tileBase = 0;
                return;
            }
            const diff = this.score - this.tileBase;
            if (diff >= POINTS_PER_TILE) {
                this.tiles += Math.floor(diff / POINTS_PER_TILE);
                this.tileBase = Math.floor(this.score / POINTS_PER_TILE) * POINTS_PER_TILE;
            }
        }

        addScore(n) {
            this.score += n;
            if (this.score >= this.hiScore) {
                this.hiScore = this.score;
                this.onHiScore(this.hiScore);
            }
        }

        // CTimeManager::UpdateObject
        updateClock(dt) {
            const c = this.clock;
            if (!c.started) return;
            let blinked = false;
            if (!c.timedOut) {
                if (c.time !== -1) {
                    if (dt < c.time) {
                        c.time -= dt;
                        if (c.time < 11000) {
                            c.blinkAcc += dt;
                            if (c.blinkAcc > 332) {
                                c.blinkAcc = 0;
                                c.visible = !c.visible;
                                blinked = true;
                            }
                        }
                    } else {
                        c.time = 0;
                        c.visible = true;
                    }
                }
            } else {
                this.kill(0);
                return;
            }
            if (c.time !== -1 && c.time < 1000 && !c.timedOut) {
                c.visible = true;
                c.timedOut = true;
            }
            return blinked;
        }

        // CBallManager::UpdateObject
        updateQueue(dt) {
            const q = this.queue;
            if (q.needInit) {
                this.fillQueue();
                q.slots[0].x = 104;
                q.slots[0].y = 14;
                for (let i = 1; i < 6; i++) {
                    q.slots[i].x = q.slots[i - 1].w + q.slots[i - 1].x;
                    q.slots[i].y = 14;
                }
                q.blink = false;
                q.needInit = false;
            }
            if (q.left < 1) {
                this.clock.started = true;
                return;
            }
            this.slideQueue(dt);
            q.countdown -= dt;
            if (q.countdown < 801) {
                q.blinkAcc += dt;
                if (q.blinkAcc > 99) {
                    q.blink = !q.blink;
                    q.blinkAcc = 0;
                }
            }
            if (q.countdown < 1 && q.launchers.length > 0) {
                const l = q.launchers[this.rand(q.launchers.length)];
                if (!this.ballOnTile(l)) {
                    const b = this.balls[q.launched++];
                    b.x = l.x + 16 - (b.w / 2 | 0);
                    b.y = l.y + 16 - (b.w / 2 | 0);
                    this.setBallSpeed(b, -1);
                    b.alive = true;
                    q.left--;
                    q.countdown = q.interval;
                    q.blink = false;
                    this.fillQueue();
                    this.clock.started = true;
                } else {
                    q.countdown = 0;
                }
            }
        }

        // CBallManager::UpdateBallList: the slots shift left, the coming balls take their colours
        fillQueue() {
            const q = this.queue;
            const first = q.slots.shift();
            q.slots.forEach((s) => { s.alive = false; });
            first.alive = false;
            q.slots.push(first);
            for (let k = 0; k < 6 && k < q.left; k++) {
                q.slots[k].color = this.balls[q.launched + k].color;
                q.slots[k].alive = true;
            }
        }

        // CBallManager::UpdateBallPositions: the first slot runs to x 6, the rest close up behind
        slideQueue(dt) {
            const s = dt / 1000;
            const sl = this.queue.slots;
            if (sl[0].x > 6) {
                sl[0].vx -= 6;
                sl[0].x += s * sl[0].vx;
            } else {
                sl[0].vx = 0;
                sl[0].x = 6;
            }
            for (let i = 1; i < 6; i++) {
                const prev = sl[i - 1];
                if (prev.w + prev.x < sl[i].x) {
                    sl[i].vx -= 6 - i;
                    sl[i].x += s * sl[i].vx;
                } else {
                    sl[i].vx = 0;
                    sl[i].x = prev.w + prev.x;
                }
            }
        }

        // CBoardTileRLGray / CBoardTileRLColored::UpdateObject: a frame every 50 ms
        updateTile(t, dt) {
            const was = t.frame;
            t.timer += dt;
            if (t.kind === 'rlgray') {
                t.stepAcc += dt;
                if (t.phase === 0) {
                    if (t.timer < t.down) {
                        if (t.frame > 0 && t.stepAcc > 50) {
                            t.frame--;
                            t.stepAcc = 0;
                        }
                    } else {
                        t.phase = 1;
                        t.timer = 0;
                    }
                } else if (t.phase === 1) {
                    if (t.timer > t.up) {
                        t.phase = 0;
                        t.timer = 0;
                    } else if (!this.ballOnTile(t)) {
                        t.phase = 2;
                        t.timer = 0;
                        t.stepAcc = 0;
                    }
                } else if (t.timer < t.up) {
                    if (t.frame < 4 && t.stepAcc > 50) {
                        t.frame++;
                        t.stepAcc = 0;
                    }
                } else {
                    t.phase = 0;
                    t.timer = 0;
                    t.stepAcc = 0;
                }
                if (t.frame !== was) t.bmp = BMP.RL + t.frame * 5;
                return;
            }
            if (t.phase === 0) {
                if (t.frame > 0 && t.timer > 50) {
                    t.frame--;
                    t.timer = 0;
                }
            } else if (t.phase === 1) {
                if (!this.ballOnTile(t)) {
                    t.phase = 2;
                    t.timer = 0;
                }
            } else if (t.frame < 4 && t.timer > 50) {
                t.frame++;
                t.timer = 0;
            }
            if (t.frame !== was) t.bmp = BMP.RL + t.frame * 5 + t.color;
        }

        // ToggleRLWalls: a ball sunk in a hole of a colour flips that colour's walls
        toggleWalls(color) {
            this.rlColored.forEach((t) => {
                if (t.color === color) t.phase = t.phase === 0 ? 1 : 0;
            });
        }

        // ---- CBall::UpdateObject ----
        moveBall(b, ms) {
            if (!b.alive) return;
            const s = ms / 1000;
            const px = b.x;
            const py = b.y;
            b.x += s * b.vx;
            b.y += s * b.vy;
            if (this.checkBounds(b)) return;
            this.collideNonDeflecting(b);
            if (!b.alive || this.state !== 'play') return;
            if (Math.trunc(b.x) === Math.trunc(px) && Math.trunc(b.y) === Math.trunc(py)) return;
            for (let i = 0; i < this.balls.length; i++) {
                const o = this.balls[i];
                if (o !== b && o.alive) this.collideBalls(b, o);
            }
            this.collideInk(b);
            this.collideTiles(b);
        }

        // CBall::CheckBoardBounds
        checkBounds(b) {
            let hit = false;
            if (b.x >= BOARD_X) {
                const r = NATIVE_W - b.w;
                if (b.x > r) {
                    b.vx = -b.vx;
                    b.x = r - 1;
                    hit = true;
                }
            } else {
                b.x = BOARD_X;
                b.vx = -b.vx;
                hit = true;
            }
            if (b.y >= BOARD_Y) {
                const r = NATIVE_H - b.h;
                if (b.y > r) {
                    b.y = r - 1;
                    b.vy = -b.vy;
                    hit = true;
                }
            } else {
                b.y = BOARD_Y;
                b.vy = -b.vy;
                hit = true;
            }
            return hit;
        }

        // CBall::Collide (ball against ball): equal masses swap their velocity along the line of
        // centres, when this ball is moving towards the other one
        collideBalls(a, o) {
            const dx = a.x - o.x;
            const dy = a.y - o.y;
            const d = Math.sqrt(dy * dy + dx * dx);
            if (o.w * 0.5 + a.w * 0.5 <= d) return false;
            if ((o.x - a.x) * a.vx + (o.y - a.y) * a.vy <= 0) return true;
            let nx = (a.w * 0.5 + a.x) - (o.w * 0.5 + o.x);
            let ny = (a.w * 0.5 + a.y) - (o.w * 0.5 + o.y);
            const n = Math.sqrt(ny * ny + nx * nx);
            nx /= n;
            ny /= n;
            const p = ((a.vx * nx + a.vy * ny) - (ny * o.vy + nx * o.vx)) * 2 / 2;
            a.vx -= p * nx;
            a.vy -= p * ny;
            o.vx += p * nx;
            o.vy += p * ny;
            return true;
        }

        // CBall::Deflect: mirror the velocity about the normal (px, py)
        deflect(b, px, py) {
            const k = ((b.vy * py + b.vx * px) * 2) / (px * px + py * py);
            b.vy -= k * py;
            b.vx -= k * px;
        }

        // CBall::InitBallPoints + GetNextPoint: the 17 rim points round the leading point; the hits'
        // middle point is the normal (PerformStandardWallDeflection, CBall::Collide with ink)
        rimDeflect(b, hit) {
            const pts = pointsFor(b.w);
            let best = pts[0][1] * b.vy + pts[0][0] * b.vx;
            let lead = 0;
            for (let i = 1; i < 32; i++) {
                const v = pts[i][1] * b.vy + pts[i][0] * b.vx;
                if (best < v) {
                    best = v;
                    lead = i;
                }
            }
            let start = lead - 8;
            if (start < 0) start = lead + 24;
            const c = center(b);
            let first = -1;
            let last = -1;
            for (let k = 0; k < 17; k++) {
                const i = (start + k) % 32;
                if (hit(c[0] + pts[i][0], c[1] + pts[i][1])) {
                    if (first === -1) first = i;
                    last = i;
                }
            }
            if (first === -1) return false;
            let mid = tdiv(last + first, 2);
            if (last < first) mid = (mid + 16) % 32;
            this.deflect(b, pts[mid][0], pts[mid][1]);
            return true;
        }

        // CBall::SetTallness: the ball sinking into a hole (negative) or back to full size (0)
        setTallness(b, t) {
            const d = t - b.tall;
            if (!d) return;
            b.w += d * 2;
            b.h += d * 2;
            b.x -= d;
            b.y -= d;
            this.checkBounds(b);
            b.tall = t;
        }

        // ---- tiles ----
        // CareAboutCollisions: 0 = pass, 1 = it acts on the ball without bouncing it, 2 = bounce
        care(t, b, pt) {
            if (!t) return 0;
            switch (t.kind) {
                case 'floor':
                case 'launcher':
                    return b.tall !== 0 ? 1 : 0;
                case 'drain':
                case 'chevron':
                    return 1;
                case 'wall':
                case 'break':
                    return 2;
                case 'rlgray':
                case 'rlcolor':
                    return t.frame > 0 ? 2 : 0;
                case 'owf': return this.careOneWay(t, b, pt);
                case 'bumper': return this.careBumper(t, b, pt);
                default: return 0;
            }
        }

        // CBoardTileOWF::CareAboutCollisions: the bar side blocks a ball coming at it; a coloured
        // one also stops the other colours inside its bar
        careOneWay(t, b, pt) {
            const c = center(b);
            const r = [t.x, t.y, t.x + t.w, t.y + t.h];
            const thick = Math.trunc(t.w / 1.6);
            if (t.dir === 0) {
                r[3] -= thick;
                if (c[1] < tdiv(r[1] + r[3], 2) && b.vy > 0) return 2;
            } else if (t.dir === 1) {
                r[1] += thick;
                if (tdiv(r[3] + r[1], 2) < c[1] && b.vy < 0) return 2;
            } else if (t.dir === 2) {
                r[2] -= thick;
                if (c[0] < tdiv(r[0] + r[2], 2) && b.vx > 0) return 2;
            } else {
                r[0] += thick;
                if (tdiv(r[2] + r[0], 2) < c[0] && b.vx < 0) return 2;
            }
            if (t.color !== 0 && t.color !== b.color) {
                if (!pt) return 2;
                if (inRect(pt[0], pt[1], r)) return 2;
            }
            return 0;
        }

        // CBoardTileBumper::CareAboutCollisions: a bar the other colours bounce off
        careBumper(t, b, pt) {
            if (t.color === 0 || t.color === b.color) return 0;
            if (!pt) return 2;
            const r = [t.x, t.y, t.x + t.w, t.y + t.h];
            const thick = tdiv(t.w, 3);
            if (t.dir === 0) {
                r[1] += thick;
                r[3] -= thick;
            } else {
                r[0] += thick;
                r[2] -= thick;
            }
            return inRect(pt[0], pt[1], r) ? 2 : 0;
        }

        // CheckForBallCollisionWithTile / ...WithNonDeflectingTile: of the tiles under the ball's
        // corners that care, the nearest one a rim point is inside of acts on the ball
        pickTile(b, want) {
            const c = center(b);
            const o = rectOf(b);
            const corners = [[o[0], o[1]], [o[2], o[1]], [o[0], o[3]], [o[2], o[3]]];
            const pts = pointsFor(b.w);
            let best = null;
            let bestD = Infinity;
            corners.forEach((pt) => {
                const t = this.tileAt(pt[0], pt[1]);
                if (!t || this.care(t, b, want === 2 ? pt : null) !== want) return;
                const r = [t.x, t.y, t.x + t.w, t.y + t.h];
                if (!pts.some((p) => inRect(c[0] + p[0], c[1] + p[1], r))) return;
                const tx = t.x + 16 - c[0];
                const ty = t.y + 16 - c[1];
                const d = Math.sqrt(ty * ty + tx * tx);
                if (d < bestD) {
                    bestD = d;
                    best = t;
                }
            });
            return best;
        }

        collideNonDeflecting(b) {
            const t = this.pickTile(b, 1);
            if (t) this.actOn(t, b);
        }

        collideTiles(b) {
            const t = this.pickTile(b, 2);
            if (t) this.actOn(t, b);
        }

        // PerformStandardWallDeflection: the rim points inside a tile that bounces this ball
        standardDeflect(b) {
            this.rimDeflect(b, (x, y) => {
                const t = this.tileAt(x, y);
                const p = [x, y];
                return !!t && this.care(t, b, p) !== 0 && this.care(t, b, p) !== 1;
            });
        }

        // DeflectBall of each tile kind
        actOn(t, b) {
            switch (t.kind) {
                case 'floor':
                case 'launcher':
                    this.setTallness(b, 0);
                    break;
                case 'wall':
                    if (t.color) {
                        // SetBallColor
                        b.color = t.color;
                        b.bmp = BMP.BALL + t.color;
                    }
                    this.standardDeflect(b);
                    break;
                case 'break':
                    this.standardDeflect(b);
                    if (t.color === 0 || t.color === b.color) {
                        this.convertToFloor(t);
                        this.addScore(BREAK_POINTS);
                    }
                    break;
                case 'chevron': {
                    // +-3 px/s per 4 ms step towards the arrows, at most 400
                    const axis = t.dir < 2 ? 'vy' : 'vx';
                    const v = b[axis] + (t.dir === 0 || t.dir === 2 ? -3 : 3);
                    b[axis] = Math.abs(v) > 400 ? v / Math.abs(v) * 400 : v;
                    break;
                }
                case 'drain':
                    this.drain(t, b);
                    break;
                default:
                    this.standardDeflect(b);
                    break;
            }
        }

        // ConvertTileToFloor: a broken wall leaves what was under it
        convertToFloor(t) {
            const k = t.row * COLS + t.col;
            this.grid[k] = t.under || { kind: 'floor', bmp: BMP.FLOOR, col: t.col, row: t.row, x: t.x, y: t.y, w: TILE, h: TILE, color: 0 };
        }

        // CBoardTileDrain::DeflectBall: the hole's centre is the quadrant's inner corner
        drain(t, b) {
            const hx = t.quad === 0 || t.quad === 2 ? t.x + t.w : t.x;
            const hy = t.quad === 0 || t.quad === 1 ? t.y + t.h : t.y;
            const c = center(b);
            const dx = c[0] - hx;
            const dy = c[1] - hy;
            const d = Math.sqrt(dy * dy + dx * dx);
            b.bmp = (d > 42 ? BMP.BALL : BMP.BALL_SUNK) + b.color;
            if (b.w * 0.5 + d > 12) {
                if (d <= 32) {
                    const k = 1 / (d * d);
                    b.vx = b.vx * 0.993 - dx * k * 25;
                    b.vy = b.vy * 0.993 - dy * k * 25;
                    this.setTallness(b, round(0 - (3 / d) * 8));
                }
                return;
            }
            if (t.color === b.color || t.color === 0 || b.color === 0) {
                // ScoreBall
                if (t.color !== 0) this.addScore(BALL_POINTS[b.color]);
                b.alive = false;
                this.ballsLeft--;
                if (t.color !== 0 && b.color !== 0) this.toggleWalls(t.color);
                if (this.ballsLeft < 1) this.complete();
            } else {
                this.kill(1);
            }
        }

        // ---- ink (CInk::HitCircleTest; the strokes are polylines 10 px wide) ----
        inkHits(x, y, r) {
            const hits = [];
            this.strokes.forEach((s, i) => {
                const pts = s.points;
                for (let k = 0; k < pts.length; k++) {
                    const a = pts[k];
                    const e = pts[Math.min(k + 1, pts.length - 1)];
                    if (distToSegment(x, y, a, e) <= r + INK_HALF) {
                        hits.push(i);
                        return;
                    }
                }
            });
            return hits;
        }

        // CheckForBallCollisionWithInk: bounce off the stroke, which goes
        collideInk(b) {
            if (!this.strokes.length) return false;
            const c = center(b);
            const r = tdiv(b.w, 2);
            if (!this.inkHits(c[0], c[1], r).length) return false;
            if (!this.rimDeflect(b, (x, y) => this.inkHits(x, y, 0.1).length > 0)) return false;
            const hits = this.inkHits(c[0], c[1], r);
            hits.sort((p, q) => q - p).forEach((i) => {
                if (this.strokes[i] === this.drawing) this.drawing = null; // the pen lifts
                this.strokes.splice(i, 1);
            });
            return true;
        }

        // CSink::CursorDown / Packets / CursorUp
        beginStroke(x, y) {
            if (this.strokes.length > MAX_STROKES - 1) this.strokes.shift();
            this.drawing = { points: [[x, y]] };
            this.strokes.push(this.drawing);
        }

        extendStroke(x, y) {
            if (!this.drawing) return;
            const pts = this.drawing.points;
            const l = pts[pts.length - 1];
            if (l[0] !== x || l[1] !== y) pts.push([x, y]);
        }

        endStroke() {
            this.drawing = null;
        }

        clearInk() {
            this.strokes = [];
            this.drawing = null;
        }

        // CGameManager::DropWallTile (right button): a grey wall on an empty floor tile
        dropWall(x, y) {
            if (!(x > BOARD_X && x < NATIVE_W && y > BOARD_Y && y < NATIVE_H)) return false;
            const t = this.tileAt(x, y);
            if (!t || t.kind !== 'floor' || this.ballOnTile(t) || this.tiles === 0) return false;
            this.tiles--;
            this.grid[t.row * COLS + t.col] = { kind: 'wall', bmp: BMP.WALL, col: t.col, row: t.row, x: t.x, y: t.y, w: TILE, h: TILE, color: 0 };
            return true;
        }

        // ---- the end of a board ----
        complete() {
            this.state = 'complete';
            this.goldAcc = 0;
            this.gold = { i: 0, phase: 0, tiles: [] };
        }

        // the cleared board's count-down (CGameManager tick, state 2): every 20 ms a second of the
        // clock goes into the score and the gold pair moves on; then 1.5 s and the next board
        completeStep(dt) {
            if (this.state !== 'complete') return false;
            this.goldAcc += dt;
            if (this.goldAcc <= 20) return false;
            this.goldAcc = 0;
            const c = this.clock;
            if (c.time === 0 || c.time === -1) {
                this.gold = null;
                this.level++;
                this.state = 'wait';
                return true;
            }
            c.time = c.time < 1001 ? 0 : c.time - 1000;
            c.visible = true;
            this.addScore(1);
            this.countTiles();
            const g = this.gold;
            const at = (row, col) => this.grid[row * COLS + col];
            if (g.phase === 0) {
                g.tiles = [at(0, g.i), at(ROWS - 1, COLS - 1 - g.i)];
                if (++g.i >= COLS) {
                    g.i = 0;
                    g.phase = 1;
                }
            } else {
                g.tiles = [at(g.i, COLS - 1), at(ROWS - 1 - g.i, 0)];
                if (++g.i >= ROWS) {
                    g.i = 0;
                    g.phase = 0;
                }
            }
            return true;
        }

        // LoadNextLevel: every fifth board is a bonus board
        nextBoard() {
            this.loadBoard(this.pickBoard(this.level % 5 === 0));
        }

        // KillPlayer: 0 time out, 1 wrong hole (both a MessageBox, then the same board again from
        // 0 points), 2 New Game
        kill(reason) {
            this.level = 0;
            this.score = 0;
            this.tiles = 0;
            this.tileBase = 0;
            if (reason === 2) return;
            this.state = 'dead';
            this.onKill(reason);
        }

        replay() {
            this.loadBoard(this.board);
        }
    }
    // ---------------------------------------------------------------- storage

    function store() {
        try {
            const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
            return v && typeof v === 'object' ? v : {};
        } catch (_) { return {}; }
    }

    function storePut(patch) {
        const v = Object.assign(store(), patch);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (_) { /* this session only */ }
    }

    function blankStats() {
        return { hiScore: DEFAULT_HISCORE, bestBoards: 0, boards: 0 };
    }

    function stats() {
        return Object.assign(blankStats(), store().stats || {});
    }

    function noteStats(patch) {
        storePut({ stats: Object.assign(stats(), patch) });
    }

    // ---------------------------------------------------------------- look (GDI)

    // the five ball colours of inkball.exe's art (grey, orange, blue, green, yellow)
    const COLOR = [[180, 182, 193], [252, 155, 0], [11, 150, 233], [29, 183, 35], [228, 204, 1]];
    const FLOOR = [222, 221, 232];
    const GOLD = [240, 196, 32];
    const TICK = 16;          // inkball.exe's tick (timeGetTime steps on the VM)
    const HOLD_MS = 650;      // tap and hold: drop a wall tile
    const HOLD_SLOP = 8;      // CSS px

    const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const WHITE = [255, 255, 255];
    const BLACK = [0, 0, 0];

    // ---------------------------------------------------------------- state

    let ws = null;
    let page = null;
    let view = 'main';        // 'main' | 'stats' | 'about'
    let cv = null;
    let ctx = null;
    let boards = null;
    let loading = null;
    let game = null;
    let tilesLayer = null;
    let tilesKey = '';
    const L = { w: 0, h: 0, dpr: 1, ox: 0, oy: 0, scale: 1, unit: 1.5, font: 'Tahoma, sans-serif' };
    const R = { paused: false, acc: 0, last: 0, wait: 0, clock: 0, over: false };
    let raf = 0;
    let poll = 0;

    function difficulty() {
        const d = store().difficulty;
        return Number.isInteger(d) && d >= 0 && d <= 4 ? d : 0;
    }

    // ---------------------------------------------------------------- game

    function loadBoards() {
        if (boards) return Promise.resolve(boards);
        if (!loading) {
            loading = fetch(BOARDS_URL, { credentials: 'same-origin' })
                .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
                .then((buf) => { boards = parseBoards(buf); return boards; })
                .catch((err) => { loading = null; throw err; });
        }
        return loading;
    }

    function makeGame() {
        game = new Game({
            boards,
            difficulty: difficulty(),
            hiScore: stats().hiScore,
            onKill: (reason) => { if (reason !== 2) gameOver(reason); },
            onHiScore: (s) => noteStats({ hiScore: s })
        });
        game.newGame();
        R.paused = false;
        R.over = false;
        R.acc = 0;
        R.wait = 0;
        tilesKey = '';
        renderStatus();
        draw();
        kick();
    }

    async function start() {
        if (game) return;
        try {
            await ws.busy(loadBoards());
        } catch (_) {
            await ws.messageBox({ title: 'Error', text: STR.loadError, icon: 'error', modal: true });
            return;
        }
        if (!game) makeGame();
    }

    function newGame() {
        if (!boards) { start(); return; }
        if (!game) { makeGame(); return; }
        noteBoards();
        game.newGame();
        R.paused = false;
        R.over = false;
        R.acc = 0;
        R.wait = 0;
        tilesKey = '';
        renderStatus();
        draw();
        kick();
    }

    // the boards cleared this game, before a kill or a new game sets them back to 0
    function noteBoards() {
        if (!game || !game.level) return;
        const st = stats();
        noteStats({ bestBoards: Math.max(st.bestBoards, game.level) });
    }

    async function gameOver(reason) {
        R.over = true;
        stopLoop();
        draw();
        renderStatus();
        await ws.messageBox({ title: STR.gameOver, text: reason === 0 ? STR.timeOut : STR.wrongHole, icon: 'info', modal: true });
        if (!game || game.state !== 'dead') return;
        game.replay();
        R.over = false;
        R.acc = 0;
        tilesKey = '';
        renderStatus();
        draw();
        kick();
    }

    function setDifficulty(d) {
        storePut({ difficulty: d });
        if (!game) return;
        // as the desktop: a board of the new difficulty, the score carries on
        game.setDifficulty(d);
        game.loadBoard(game.pickBoard(false));
        R.paused = false;
        R.acc = 0;
        tilesKey = '';
        renderStatus();
        draw();
        kick();
    }

    function pause() {
        if (R.paused || !game || R.over) return;
        R.paused = true;
        game.endStroke();
        stopLoop();
        draw();
        if (ws) ws.refreshSoftKeys();
    }

    function resume() {
        if (!R.paused) return;
        R.paused = false;
        R.last = 0;
        draw();
        kick();
        if (ws) ws.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- loop

    function hidden() {
        return !page || page.hidden || document.hidden || view !== 'main' || (ws && ws.current !== APP_ID);
    }

    function menuUp() {
        return !!document.querySelector('#wmShell .wm-popup:not([hidden]):not(.wm-popup-ghost), #wmShell .wm-msgbox-layer:not([hidden])');
    }

    function running() {
        return !!game && !R.paused && !R.over && game.state !== 'dead';
    }

    function kick() {
        if (raf || !running() || hidden()) return;
        R.last = 0;
        raf = requestAnimationFrame(tick);
    }

    function stopLoop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        clearTimeout(poll);
        poll = 0;
    }

    function tick(ts) {
        raf = 0;
        if (hidden()) { pause(); return; }
        if (!running()) return;
        if (menuUp()) {
            // BoardIsActive: nothing moves while a menu or a box is up; look again in a moment
            R.last = 0;
            clearTimeout(poll);
            poll = setTimeout(kick, 100);
            return;
        }
        let dt = R.last ? ts - R.last : TICK;
        R.last = ts;
        // a stall loses its time (inkball.exe keeps only the time mod 66 ms after a long one)
        if (dt > 250) dt %= 66;
        R.acc += dt;
        let n = 0;
        while (R.acc >= TICK && n < 20 && running()) {
            R.acc -= TICK;
            n++;
            step(TICK);
        }
        if (n >= 20) R.acc = 0;
        renderStatus();
        draw();
        if (running()) raf = requestAnimationFrame(tick);
    }

    function step(dt) {
        const g = game;
        R.clock += dt;
        g.balls.forEach((b) => { b.px = b.x; b.py = b.y; b.pw = b.w; });
        if (g.state === 'play') g.update(dt);
        else if (g.state === 'complete') {
            g.completeStep(dt);
            if (g.state === 'wait') {
                const st = stats();
                noteStats({ boards: st.boards + 1, bestBoards: Math.max(st.bestBoards, g.level) });
            }
        } else if (g.state === 'wait') {
            // Sleep(1500) before LoadNextLevel
            if (!R.wait) R.wait = R.clock + 1500;
            else if (R.clock >= R.wait) {
                R.wait = 0;
                g.nextBoard();
                tilesKey = '';
                g.balls.forEach((b) => { b.px = b.x; b.py = b.y; b.pw = b.w; });
            }
        }
    }

    // ---------------------------------------------------------------- layout and drawing

    function layout() {
        if (!page || !cv) return;
        const box = cv.parentElement;
        const w = box.clientWidth;
        const h = box.clientHeight;
        if (!w || !h) return;
        const probe = page.querySelector('.wib-probe');
        L.unit = probe ? probe.offsetWidth / 100 : 1.5;
        const m = Math.round(2 * L.unit);
        L.scale = Math.min((w - 2 * m) / NATIVE_W, (h - m) / NATIVE_H);
        L.ox = Math.round((w - NATIVE_W * L.scale) / 2);
        L.oy = m;
        L.w = w;
        L.h = h;
        L.dpr = window.devicePixelRatio || 1;
        cv.width = Math.round(w * L.dpr);
        cv.height = Math.round(h * L.dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        const br = box.getBoundingClientRect();
        const snap = (v) => -(((v * L.dpr) % 1 + 1) % 1) / L.dpr;
        cv.style.left = `${snap(br.left)}px`;
        cv.style.top = `${snap(br.top)}px`;
        L.font = getComputedStyle(page).fontFamily || L.font;
        tilesKey = '';
        inkLayerKey = '';
        draw();
    }

    // native units -> device pixels, snapped
    const DX = (x) => Math.round((L.ox + x * L.scale) * L.dpr);
    const DY = (y) => Math.round((L.oy + y * L.scale) * L.dpr);
    const DS = (v) => v * L.scale * L.dpr;

    // a raised GDI square: a dark frame, a light edge top and left, a dark edge bottom and right
    function bevel(c, x0, y0, x1, y1, col, e) {
        c.fillStyle = rgb(mix(col, BLACK, 0.5));
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        c.fillStyle = rgb(mix(col, WHITE, 0.6));
        c.fillRect(x0, y0, x1 - x0 - 1, y1 - y0 - 1);
        c.fillStyle = rgb(mix(col, BLACK, 0.25));
        c.fillRect(x0 + e, y0 + e, x1 - x0 - 1 - e, y1 - y0 - 1 - e);
        c.fillStyle = rgb(col);
        c.fillRect(x0 + e, y0 + e, x1 - x0 - 1 - 2 * e, y1 - y0 - 1 - 2 * e);
    }

    function tileBox(t) {
        return [DX(t.x), DY(t.y), DX(t.x + TILE), DY(t.y + TILE)];
    }

    function drawFloor(c, x0, y0, x1, y1) {
        c.fillStyle = rgb(mix(FLOOR, BLACK, 0.12));
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        c.fillStyle = rgb(mix(FLOOR, WHITE, 0.6));
        c.fillRect(x0, y0, x1 - x0 - 1, y1 - y0 - 1);
        c.fillStyle = rgb(FLOOR);
        c.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    }

    function poly(c, pts, col) {
        c.fillStyle = col;
        c.beginPath();
        pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath();
        c.fill();
    }

    // an arrow head pointing dir (0 up, 1 down, 2 left, 3 right) in the box
    function arrow(c, cx, cy, s, dir, col) {
        const P = { 0: [[0, -1], [1, 0.4], [-1, 0.4]], 1: [[0, 1], [1, -0.4], [-1, -0.4]], 2: [[-1, 0], [0.4, -1], [0.4, 1]], 3: [[1, 0], [-0.4, -1], [-0.4, 1]] }[dir];
        poly(c, P.map(([x, y]) => [cx + x * s, cy + y * s]), col);
    }

    function drawTile(c, t, gold) {
        const [x0, y0, x1, y1] = tileBox(t);
        const w = x1 - x0;
        const e = Math.max(1, Math.round(DS(2.5)));
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        if (gold) { bevel(c, x0, y0, x1, y1, GOLD, e); return; }
        switch (t.kind) {
        case 'wall':
            bevel(c, x0, y0, x1, y1, COLOR[t.color], e);
            return;
        case 'break': {
            // a wall that breaks: lighter, cracked
            const col = mix(COLOR[t.color], WHITE, 0.35);
            bevel(c, x0, y0, x1, y1, col, e);
            c.strokeStyle = rgb(mix(COLOR[t.color], BLACK, 0.45));
            c.lineWidth = Math.max(1, Math.round(DS(1.5)));
            c.beginPath();
            c.moveTo(x0 + w * 0.2, y0 + w * 0.3); c.lineTo(x0 + w * 0.45, y0 + w * 0.5); c.lineTo(x0 + w * 0.35, y0 + w * 0.8);
            c.moveTo(x0 + w * 0.45, y0 + w * 0.5); c.lineTo(x0 + w * 0.75, y0 + w * 0.4); c.lineTo(x0 + w * 0.85, y0 + w * 0.15);
            c.moveTo(x0 + w * 0.6, y0 + w * 0.45); c.lineTo(x0 + w * 0.7, y0 + w * 0.75);
            c.stroke();
            return;
        }
        case 'rlgray':
        case 'rlcolor': {
            // a wall that rises (frame 4) and sinks (frame 0) on a clock or by a hole of its colour
            const col = t.kind === 'rlgray' ? COLOR[0] : COLOR[t.color];
            drawFloor(c, x0, y0, x1, y1);
            if (t.frame > 0) {
                const inset = Math.round((4 - t.frame) / 4 * w * 0.3);
                bevel(c, x0 + inset, y0 + inset, x1 - inset, y1 - inset, col, Math.max(1, Math.round(e * t.frame / 4)));
            }
            // its mark: a keyhole (colour) or a clock face (grey)
            const r = w * 0.13;
            c.fillStyle = rgb(mix(col, BLACK, t.frame > 0 ? 0.55 : 0.2));
            if (t.kind === 'rlcolor') {
                c.beginPath(); c.arc(cx, cy - r * 0.6, r, 0, Math.PI * 2); c.fill();
                poly(c, [[cx - r * 0.6, cy - r * 0.4], [cx + r * 0.6, cy - r * 0.4], [cx + r * 0.9, cy + r * 1.6], [cx - r * 0.9, cy + r * 1.6]], c.fillStyle);
            } else {
                c.lineWidth = Math.max(1, Math.round(DS(1.5)));
                c.strokeStyle = c.fillStyle;
                c.beginPath(); c.arc(cx, cy + r * 0.2, r * 1.4, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.moveTo(cx, cy + r * 0.2); c.lineTo(cx, cy - r * 0.8); c.moveTo(cx, cy + r * 0.2); c.lineTo(cx + r * 0.7, cy + r * 0.2); c.stroke();
                c.fillRect(cx - r * 0.4, cy - r * 1.9, r * 0.8, r * 0.5);
            }
            return;
        }
        case 'owf': {
            // one way: the bar on one side (a colour lets only its balls in), the arrow the way in
            drawFloor(c, x0, y0, x1, y1);
            const th = Math.round(w * 0.3);
            const col = COLOR[t.color];
            const b = t.dir === 0 ? [x0, y0, x1, y0 + th] : t.dir === 1 ? [x0, y1 - th, x1, y1] : t.dir === 2 ? [x0, y0, x0 + th, y1] : [x1 - th, y0, x1, y1];
            bevel(c, b[0], b[1], b[2], b[3], col, Math.max(1, Math.round(e * 0.6)));
            const ax = t.dir === 2 ? x0 + th + (w - th) / 2 : t.dir === 3 ? x0 + (w - th) / 2 : cx;
            const ay = t.dir === 0 ? y0 + th + (w - th) / 2 : t.dir === 1 ? y0 + (w - th) / 2 : cy;
            // the arrow points into the bar: the way the ball may pass
            arrow(c, ax, ay, w * 0.17, t.dir, rgb(mix(col, BLACK, 0.4)));
            return;
        }
        case 'chevron': {
            drawFloor(c, x0, y0, x1, y1);
            const col = rgb(mix(FLOOR, BLACK, 0.3));
            const off = w * 0.16;
            const d = t.dir;
            const sx = d === 2 ? -1 : d === 3 ? 1 : 0;
            const sy = d === 0 ? -1 : d === 1 ? 1 : 0;
            arrow(c, cx + sx * off, cy + sy * off, w * 0.22, d, col);
            c.fillStyle = rgb(FLOOR);
            arrow(c, cx + sx * (off - w * 0.12), cy + sy * (off - w * 0.12), w * 0.2, d, rgb(FLOOR));
            arrow(c, cx - sx * off * 0.6, cy - sy * off * 0.6, w * 0.22, d, col);
            arrow(c, cx - sx * (off * 0.6 + w * 0.12), cy - sy * (off * 0.6 + w * 0.12), w * 0.2, d, rgb(FLOOR));
            return;
        }
        case 'bumper': {
            // a bar across the tile only its colour passes
            drawFloor(c, x0, y0, x1, y1);
            const th = Math.round(w / 3);
            const col = COLOR[t.color];
            if (t.dir === 0) bevel(c, x0 + 2, Math.round(cy - th / 2), x1 - 2, Math.round(cy + th / 2), col, Math.max(1, Math.round(e * 0.6)));
            else bevel(c, Math.round(cx - th / 2), y0 + 2, Math.round(cx + th / 2), y1 - 2, col, Math.max(1, Math.round(e * 0.6)));
            return;
        }
        case 'drain': {
            // a quarter of the hole: its colour's plate, the hole's quarter at the inner corner
            // one plate over the four tiles: its bevel only on the outer edges
            const col = COLOR[t.color];
            const top = t.quad < 2;
            const left = t.quad % 2 === 0;
            c.fillStyle = rgb(col);
            c.fillRect(x0, y0, x1 - x0, y1 - y0);
            c.fillStyle = rgb(mix(col, WHITE, 0.6));
            if (top) c.fillRect(x0, y0, x1 - x0, e);
            if (left) c.fillRect(x0, y0, e, y1 - y0);
            c.fillStyle = rgb(mix(col, BLACK, 0.3));
            if (!top) c.fillRect(x0, y1 - e - 1, x1 - x0, e);
            if (!left) c.fillRect(x1 - e - 1, y0, e, y1 - y0);
            c.fillStyle = rgb(mix(col, BLACK, 0.5));
            if (!top) c.fillRect(x0, y1 - 1, x1 - x0, 1);
            if (!left) c.fillRect(x1 - 1, y0, 1, y1 - y0);
            return;
        }
        case 'launcher': {
            drawFloor(c, x0, y0, x1, y1);
            c.fillStyle = '#424242';
            c.beginPath(); c.arc(cx, cy, w * 0.22, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#ce1010';
            const d = Math.max(1, Math.round(DS(2.5)));
            [[x0 + d * 1.5, y0 + d * 1.5], [x1 - d * 2.5, y0 + d * 1.5], [x0 + d * 1.5, y1 - d * 2.5], [x1 - d * 2.5, y1 - d * 2.5]].forEach(([x, y]) => c.fillRect(Math.round(x), Math.round(y), d, d));
            return;
        }
        default:
            drawFloor(c, x0, y0, x1, y1);
        }
    }

    // the holes over their plates: a dark well with a lighter rim, one per 2 x 2 group (drawn from
    // each top left quadrant)
    function drawHoles(c, g) {
        g.grid.forEach((t) => {
            if (!t || t.kind !== 'drain' || t.quad !== 0) return;
            const x = (L.ox + (t.x + TILE) * L.scale) * L.dpr;
            const y = (L.oy + (t.y + TILE) * L.scale) * L.dpr;
            const r = DS(19);
            const col = COLOR[t.color];
            c.fillStyle = rgb(mix(col, BLACK, 0.45));
            c.beginPath(); c.arc(x, y, r + DS(3), 0, Math.PI * 2); c.fill();
            c.fillStyle = rgb(mix(col, WHITE, 0.55));
            c.beginPath(); c.arc(x, y, r + DS(1.5), 0, Math.PI * 2); c.fill();
            const gr = c.createRadialGradient(x + r * 0.35, y + r * 0.35, r * 0.1, x, y, r);
            gr.addColorStop(0, '#5a5a5a');
            gr.addColorStop(0.6, '#181818');
            gr.addColorStop(1, '#000');
            c.fillStyle = gr;
            c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        });
    }

    let inkLayer = null;
    let inkLayerKey = '';
    function renderInk(g, bx0, by0, bx1, by1) {
        if (!inkLayer) inkLayer = document.createElement('canvas');
        if (inkLayer.width !== cv.width || inkLayer.height !== cv.height) { inkLayer.width = cv.width; inkLayer.height = cv.height; }
        const c = inkLayer.getContext('2d');
        c.clearRect(0, 0, inkLayer.width, inkLayer.height);
        c.save();
        c.beginPath();
        c.rect(bx0, by0, bx1 - bx0, by1 - by0);
        c.clip();
        c.strokeStyle = '#000';
        c.fillStyle = '#000';
        c.lineWidth = DS(INK_HALF * 2);
        c.lineCap = 'round';
        c.lineJoin = 'round';
        const X = (v) => (L.ox + v * L.scale) * L.dpr;
        const Y = (v) => (L.oy + v * L.scale) * L.dpr;
        g.strokes.forEach((st) => {
            const p = st.points;
            c.beginPath();
            if (p.length === 1) {
                c.arc(X(p[0][0]), Y(p[0][1]), DS(INK_HALF), 0, Math.PI * 2);
                c.fill();
                return;
            }
            c.moveTo(X(p[0][0]), Y(p[0][1]));
            for (let i = 1; i < p.length; i++) c.lineTo(X(p[i][0]), Y(p[i][1]));
            c.stroke();
        });
        c.restore();
    }

    function renderTiles() {
        if (!tilesLayer) tilesLayer = document.createElement('canvas');
        if (tilesLayer.width !== cv.width || tilesLayer.height !== cv.height) {
            tilesLayer.width = cv.width;
            tilesLayer.height = cv.height;
        }
        const c = tilesLayer.getContext('2d');
        c.clearRect(0, 0, tilesLayer.width, tilesLayer.height);
        game.grid.forEach((t) => { if (t) drawTile(c, t, false); });
        drawHoles(c, game);
    }

    // what the tiles look like now (the moving walls, broken walls, dropped tiles change it)
    function tilesNow() {
        let k = '';
        for (const t of game.grid) k += t ? (t.kind[0] + (t.frame || 0)) : '-';
        return k;
    }

    // inkball.exe's ball, as Bubble Breaker shades its own: a light up and to the left, a dark rim.
    // Drawn once per colour and size into a sprite (radius kept to half device pixels).
    const ballSprites = new Map();
    function drawBall(c, x, y, r, col, sunk) {
        const rq = Math.max(1, Math.round(r * 2) / 2);
        const key = `${col.join(',')}|${rq}|${sunk ? 1 : 0}`;
        let sp = ballSprites.get(key);
        if (!sp) {
            if (ballSprites.size > 64) ballSprites.clear();
            const d = Math.ceil(rq * 2) + 2;
            sp = document.createElement('canvas');
            sp.width = sp.height = d;
            const g = sp.getContext('2d');
            const cx = d / 2;
            const base = sunk ? mix(col, BLACK, 0.35) : col;
            const gr = g.createRadialGradient(cx - rq * 0.35, cx - rq * 0.4, rq * 0.08, cx, cx, rq);
            gr.addColorStop(0, rgb(mix(base, WHITE, 0.85)));
            gr.addColorStop(0.4, rgb(base));
            gr.addColorStop(0.85, rgb(mix(base, BLACK, 0.45)));
            gr.addColorStop(1, rgb(mix(base, BLACK, 0.7)));
            g.fillStyle = gr;
            g.beginPath();
            g.arc(cx, cx, rq, 0, Math.PI * 2);
            g.fill();
            ballSprites.set(key, sp);
        }
        c.drawImage(sp, x - sp.width / 2, y - sp.height / 2);
    }

    function text(c, str, x, y, size, opts = {}) {
        c.font = `${opts.bold ? 'bold ' : ''}${Math.round(size * L.unit * L.dpr)}px ${L.font}`;
        c.textAlign = opts.align || 'center';
        c.textBaseline = 'middle';
        c.fillStyle = opts.color || '#000';
        c.fillText(str, x, y);
    }

    function drawBar(c, g) {
        // the queue: a sunken box 104 wide (the exe's), the coming balls slide in from the right
        const line = Math.max(1, Math.round(L.unit * L.dpr / 2));
        const qx0 = DX(2);
        const qx1 = DX(104);
        const qy0 = DY(8);
        const qy1 = DY(36);
        c.fillStyle = '#808080';
        c.fillRect(qx0, qy0, qx1 - qx0, qy1 - qy0);
        c.fillStyle = '#fff';
        c.fillRect(qx0 + line, qy0 + line, qx1 - qx0 - line, qy1 - qy0 - line);
        c.fillStyle = rgb(FLOOR);
        c.fillRect(qx0 + line, qy0 + line, qx1 - qx0 - 2 * line, qy1 - qy0 - 2 * line);
        c.save();
        c.beginPath();
        c.rect(qx0 + line, qy0 + line, qx1 - qx0 - 2 * line, qy1 - qy0 - 2 * line);
        c.clip();
        g.queue.slots.forEach((s, k) => {
            if (!s.alive || (k === 0 && g.queue.blink)) return;
            if (s.x >= 104) return;
            const r = DS(s.w / 2) - 0.5;
            drawBall(c, (L.ox + (s.x + s.w / 2) * L.scale) * L.dpr, (L.oy + (s.y + s.w / 2 - 3) * L.scale) * L.dpr, r, COLOR[s.color] || COLOR[0], false);
        });
        c.restore();
        // the wall tiles in hand: a small grey tile and the count (tap and hold a floor tile)
        const tx = DX(NATIVE_W - 74);
        const ty = DY(10);
        const ts = Math.round(DS(24));
        bevel(c, tx, ty, tx + ts, ty + ts, COLOR[0], Math.max(1, Math.round(DS(2))));
        text(c, `× ${g.tiles > 99 ? '99+' : g.tiles}`, tx + ts + DS(6), ty + ts / 2, 11, { align: 'left' });
    }

    function centreBox(c, title, sub) {
        const u = L.unit * L.dpr;
        c.font = `bold ${Math.round(13 * u)}px ${L.font}`;
        const tw = c.measureText(title).width;
        c.font = `${Math.round(10.5 * u)}px ${L.font}`;
        const sw = sub ? c.measureText(sub).width : 0;
        const w = Math.round(Math.max(tw, sw) + 24 * u);
        const h = Math.round((sub ? 44 : 28) * u);
        const cx = (L.ox + NATIVE_W / 2 * L.scale) * L.dpr;
        const cy = (L.oy + (BOARD_Y + (NATIVE_H - BOARD_Y) / 2) * L.scale) * L.dpr;
        const x = Math.round(cx - w / 2);
        const y = Math.round(cy - h / 2);
        const line = Math.max(1, Math.round(u / 2));
        c.fillStyle = '#000';
        c.fillRect(x, y, w, h);
        c.fillStyle = '#fff';
        c.fillRect(x + line, y + line, w - 2 * line, h - 2 * line);
        text(c, title, cx, y + (sub ? 15 : 14) * u, 13, { bold: true, color: '#0000ff' });
        if (sub) text(c, sub, cx, y + 31 * u, 10.5);
    }

    function draw() {
        if (!ctx || !L.w) return;
        const c = ctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = '#fff';
        c.fillRect(0, 0, cv.width, cv.height);
        const g = game;
        if (!g || !g.grid) return;
        // the board: 1 VGA px black frame round the tiles
        const line = Math.max(1, Math.round(L.unit * L.dpr / 2));
        const bx0 = DX(0);
        const by0 = DY(BOARD_Y);
        const bx1 = DX(NATIVE_W);
        const by1 = DY(NATIVE_H);
        c.fillStyle = '#000';
        c.fillRect(bx0 - line, by0 - line, bx1 - bx0 + 2 * line, by1 - by0 + 2 * line);
        const key = tilesNow();
        if (key !== tilesKey) { renderTiles(); tilesKey = key; }
        c.drawImage(tilesLayer, 0, 0);
        if (g.gold) g.gold.tiles.forEach((t) => { if (t) drawTile(c, t, true); });
        // the ink: black, 10 units wide, round ends (the Ink renderer's), in a layer of its own that
        // is drawn again only when a stroke is added, grows or goes
        if (g.strokes.length) {
            const inkKey = `${cv.width}x${cv.height}|${g.strokes.map((st) => st.points.length + ':' + (st.points[0] || []).join(',')).join(';')}`;
            if (inkKey !== inkLayerKey) { renderInk(g, bx0, by0, bx1, by1); inkLayerKey = inkKey; }
            c.drawImage(inkLayer, 0, 0);
        }
        // the balls, between the last two ticks
        const a = running() && g.state === 'play' ? Math.min(1, R.acc / TICK) : 1;
        g.balls.forEach((b) => {
            if (!b.alive) return;
            const px = b.px === undefined ? b.x : b.px;
            const py = b.py === undefined ? b.y : b.py;
            const pw = b.pw === undefined ? b.w : b.pw;
            const w = pw + (b.w - pw) * a;
            const x = px + (b.x - px) * a + w / 2;
            const y = py + (b.y - py) * a + w / 2;
            drawBall(c, (L.ox + x * L.scale) * L.dpr, (L.oy + y * L.scale) * L.dpr, Math.max(1, DS(w / 2)), COLOR[b.color] || COLOR[0], b.bmp >= BMP.BALL_SUNK && b.bmp < BMP.BALL_SUNK + 5);
        });
        drawBar(c, g);
        if (R.paused) centreBox(c, STR.paused, STR.resume);
    }

    function renderStatus() {
        if (!page) return;
        const g = game;
        const set = (k, v) => { const el = page.querySelector(`.wib-status [data-v="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = String(v); };
        if (!g || !g.clock) { set('score', 0); set('high', stats().hiScore); set('time', '---'); return; }
        set('score', g.score);
        set('high', g.hiScore);
        const c = g.clock;
        const secs = c.time === -1 ? '---' : String(Math.floor(c.time / 1000));
        set('time', secs);
        const el = page.querySelector('.wib-status [data-v="time"]');
        if (el) el.style.visibility = c.visible || c.time === -1 ? '' : 'hidden';
    }

    // ---------------------------------------------------------------- input

    const ptr = { id: null, x0: 0, y0: 0, moved: false, hold: 0, resumeTap: false };

    function native(e) {
        const r = cv.getBoundingClientRect();
        return [Math.round((e.clientX - r.left - L.ox) / L.scale), Math.round((e.clientY - r.top - L.oy) / L.scale)];
    }

    function onDown(e) {
        if (view !== 'main' || !game) return;
        if (ptr.id !== null) return;
        e.preventDefault();
        ptr.id = e.pointerId;
        ptr.x0 = e.clientX;
        ptr.y0 = e.clientY;
        ptr.moved = false;
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        if (R.paused) { ptr.resumeTap = true; return; }
        ptr.resumeTap = false;
        if (!running() || game.state !== 'play') return;
        const p = native(e);
        if (p[1] < BOARD_Y) return;
        game.beginStroke(p[0], p[1]);
        // tap and hold an empty floor tile: a wall tile goes there instead (the right button)
        clearTimeout(ptr.hold);
        ptr.hold = setTimeout(() => {
            ptr.hold = 0;
            if (ptr.moved || ptr.id === null || !game) return;
            const t = game.tileAt(p[0], p[1]);
            if (!t || t.kind !== 'floor' || game.tiles === 0 || game.ballOnTile(t)) return;
            const s = game.drawing;
            if (game.dropWall(p[0], p[1])) {
                if (s) { game.strokes = game.strokes.filter((x) => x !== s); game.drawing = null; }
                draw();
            }
        }, HOLD_MS);
        draw();
    }

    function onMove(e) {
        if (e.pointerId !== ptr.id) return;
        if (Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > HOLD_SLOP) ptr.moved = true;
        if (!game || !game.drawing) return;
        const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        (list.length ? list : [e]).forEach((ev) => {
            const p = native(ev);
            game.extendStroke(p[0], p[1]);
        });
        if (!raf) draw();
    }

    function onUp(e) {
        if (e.pointerId !== ptr.id) return;
        ptr.id = null;
        clearTimeout(ptr.hold);
        ptr.hold = 0;
        if (ptr.resumeTap) { ptr.resumeTap = false; resume(); return; }
        if (game && game.drawing) { game.endStroke(); if (!raf) draw(); }
    }

    function onKey(e) {
        if (!ws || ws.current !== APP_ID || view !== 'main' || !game || e.ctrlKey || e.metaKey || e.altKey) return;
        if (menuUp()) return;
        if (e.key === 'Enter' && R.paused) { e.preventDefault(); resume(); } else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (R.paused) resume(); else pause(); } else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); game.clearInk(); draw(); }
    }

    // ---------------------------------------------------------------- pages: Statistics, About

    const esc = (s) => (ws ? ws.escapeHtml(s) : String(s));

    function showView(v) {
        view = v;
        page.dataset.view = v;
        page.querySelectorAll('.wib-view').forEach((el) => { el.hidden = el.dataset.view !== v; });
        if (v === 'stats') renderStats();
        else if (v === 'about') renderAbout();
        else requestAnimationFrame(() => { layout(); });
        ws.refreshTitleAction();
        ws.refreshSoftKeys();
    }

    function openPage(v) {
        pause();
        showView(v);
        ws.syncHistory();
    }

    function renderStats() {
        const st = stats();
        const box = page.querySelector('.wib-view[data-view="stats"]');
        const rows = [['High score', st.hiScore], ['Most boards cleared in a game', st.bestBoards], ['Boards cleared', st.boards]];
        box.innerHTML = `<div class="wm-form-hdr">Statistics</div><div class="wm-set-scroll"><div class="wib-stats">`
            + `<table class="wib-totals"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
            + '<div class="wib-reset"><button type="button" class="wm-button" data-act="reset">Reset</button></div>'
            + '</div></div>';
        box.querySelector('[data-act="reset"]').addEventListener('click', async () => {
            const yes = await ws.messageBox({
                title: STR.resetTitle, text: STR.resetAsk, icon: 'question', modal: true, cancelValue: false,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            if (!yes) return;
            storePut({ stats: blankStats() });
            if (game) game.hiScore = Math.max(DEFAULT_HISCORE, game.score);
            renderStats();
        });
    }

    function renderAbout() {
        const box = page.querySelector('.wib-view[data-view="about"]');
        box.innerHTML = '<div class="wm-set-scroll"><div class="wib-about"><canvas class="wib-logo" aria-hidden="true"></canvas>'
            + `<p>${esc(TITLE)}&trade;</p><p>Designed for Melaton Mobile&trade;</p><p>by ${esc(DEVELOPER)}</p>`
            + '<p class="wib-copy">Copyright &copy; 2026 Xyridian Corporation. All rights reserved.</p></div></div>';
        requestAnimationFrame(() => drawLogo(box.querySelector('.wib-logo')));
    }

    // the About picture: a blue hole, an ink stroke and the five balls, drawn as the board draws them
    function drawLogo(canvas) {
        if (!canvas || !canvas.clientWidth) return;
        const css = canvas.clientWidth;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(css * dpr);
        canvas.height = Math.round(css * dpr);
        const c = canvas.getContext('2d');
        const keep = Object.assign({}, L);
        L.ox = 0; L.oy = 0; L.scale = css / 128; L.dpr = dpr;
        // a 2 x 2 hole in the middle of a floor of 4 x 4 tiles
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const inHole = row >= 1 && row <= 2 && col >= 1 && col <= 2;
                const t = { kind: inHole ? 'drain' : 'floor', color: 2, quad: (row - 1) * 2 + (col - 1), x: col * 32, y: row * 32 };
                drawTile(c, t, false);
            }
        }
        drawHoles(c, { grid: [{ kind: 'drain', quad: 0, color: 2, x: 32, y: 32 }] });
        c.strokeStyle = '#000';
        c.lineWidth = DS(10);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(DS(10), DS(112)); c.quadraticCurveTo(DS(40), DS(124), DS(60), DS(104));
        c.stroke();
        [[0, 18, 18], [1, 108, 20], [2, 112, 108], [3, 22, 60], [4, 90, 80]].forEach(([k, x, y]) => drawBall(c, DS(x), DS(y), DS(12), COLOR[k], false));
        Object.assign(L, keep);
    }

    // ---------------------------------------------------------------- app

    function mount(p) {
        page = p;
        p.classList.add('wm-inkball');
        p.dataset.view = 'main';
        p.innerHTML = `
            <div class="wib-probe" aria-hidden="true"></div>
            <div class="wib-view" data-view="main">
                <div class="wib-status">
                    <span><b>Score:</b> <i data-v="score">0</i></span>
                    <span><b>High:</b> <i data-v="high">${DEFAULT_HISCORE}</i></span>
                    <span><b>Time:</b> <i data-v="time">---</i></span>
                </div>
                <div class="wib-field" data-wm-no-hold><canvas aria-label="${esc(TITLE)}"></canvas></div>
            </div>
            <div class="wib-view" data-view="stats" hidden></div>
            <div class="wib-view" data-view="about" hidden></div>`;
        cv = p.querySelector('.wib-field canvas');
        ctx = cv.getContext('2d');
        cv.addEventListener('pointerdown', onDown);
        cv.addEventListener('pointermove', onMove);
        cv.addEventListener('pointerup', onUp);
        cv.addEventListener('pointercancel', onUp);
        cv.addEventListener('contextmenu', (e) => e.preventDefault());
        if (window.ResizeObserver) new ResizeObserver(() => { if (view === 'main') layout(); }).observe(cv.parentElement);
        layout();
        renderStatus();
        // the game in memory comes back as it was left (X ends the page, not the game)
        if (game) {
            tilesKey = '';
            if (!R.over && game.state !== 'dead') R.paused = true;
            draw();
        }
    }

    function show() {
        if (view !== 'main') return;
        requestAnimationFrame(() => {
            layout();
            if (!game) start();
            else kick();
        });
    }

    function hide() {
        pause();
        stopLoop();
    }

    function softKeys() {
        if (view !== 'main') return { left: null, right: null };
        const d = difficulty();
        return {
            left: { label: 'New Game', action: newGame },
            right: {
                label: 'Menu',
                menu: () => (pause(), [
                    { label: 'Pause', checked: R.paused, disabled: !game || R.over, action: () => (R.paused ? resume() : pause()) },
                    { label: 'Clear Ink', disabled: !game || !game.strokes.length, action: () => { game.clearInk(); draw(); } },
                    '-',
                    { label: 'Difficulty', submenu: DIFFICULTY_NAMES.map((n, i) => ({ label: n, radio: d === i, action: () => setDifficulty(i) })) },
                    '-',
                    { label: 'Statistics', action: () => openPage('stats') },
                    '-',
                    { label: 'About', action: () => openPage('about') }
                ])
            }
        };
    }

    function backToGame() {
        showView('main');
        ws.syncHistory();
        return true;
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: 'app-inkball',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show,
            hide,
            titleKind: () => (view === 'main' ? 'close' : 'ok'),
            onTitleOk: () => (view === 'main' ? false : backToGame()),
            historyDepth: () => (view === 'main' ? 0 : 1),
            onBack: () => (view === 'main' ? false : backToGame()),
            onEnd() { hide(); view = 'main'; page = null; cv = null; ctx = null; },
            softKeys
        });
        document.addEventListener('keydown', onKey);
        document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    }

    // tests
    window.wmInkBall = { Game, parseBoards, get game() { return game; }, run: R, layout: L, newGame, pause, resume, draw, step: (dt) => { step(dt); renderStatus(); draw(); } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
