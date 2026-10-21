// InkBall, as Windows Vista's (Yozora #609). Unlike the other Vista games InkBall is not on the
// Oberon sprite engine: it is the Tablet PC game, a DirectDraw program drawn from one bitmap
// (BITMAP 501) with its boards in one resource (IKL 20001). Both come from inkball.exe through
// scripts/build-vista-inkball.js (inkball/inkball.png, inkball/boards.bin); the menus,
// accelerators and strings are the MUI's (inkball/data.json, scripts/build-vista-games.js).
// The rules below are inkball.exe's own, read from its code (the exe keeps its trace names:
// CBall::Deflect, CBoardTileDrain::DeflectBall, ...); measured on the Vista VM:
//
//   - the window is not resizable (WM_GETMINMAXINFO pins the client to 544x586): a 42 px bar
//     (ball queue 104 px, score + high score 341 px, wall tiles 42 px, clock 58 px) over the
//     board, 17 x 17 tiles of 32 px; balls are 24 px (18 px in the queue)
//   - a board: time limit (0 = none), launch interval, speed range, shuffle flag, the queued
//     balls' colours, then 289 cells (a breakable wall carries the cell under it)
//   - the clock starts with the first launch (4 s after the board appears) and blinks under 11 s;
//     the next ball blinks in the queue for its last 0.8 s
//   - balls move in 4 ms steps, bounce off the board edge, walls, ink and each other; a wall of a
//     colour paints the ball; ink a ball touches disappears (20 strokes at most)
//   - a hole pulls a ball in and shrinks it; the right colour (or a grey ball / grey hole) scores
//     0 / 200 / 400 / 800 / 1600 by ball colour (grey hole: nothing), any other ends the game
//   - every 1600 points earns a wall tile the right button drops on an empty floor tile
//   - a cleared board counts the time left into the score, 1 point a second, while two gold
//     tiles chase round the board's edge; every fifth board is a bonus board (no clock)
//   - Game over (wrong hole / time out) is a MessageBox; OK replays the same board from 0 points
//   - InkBall has no sounds (inkball.exe imports nothing from winmm but timeGetTime)
//
// openModal / closeModal: public/scripts/comp/modalUtils.js (through the engine)
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const GAME_ID = 'inkball';
    const MODAL_ID = 'vistaInkBallModal';
    const ART = '/static_images/vista-games/inkball/';

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

    // CBitmapRects::CBitmapRects (ids into BITMAP 501): [left, top, right, bottom]
    const RECTS = [
        [1, 1, 33, 33], [1, 34, 33, 66], [1, 157, 25, 181], [1, 181, 25, 205], [1, 205, 25, 229], [1, 229, 25, 253], [1, 253, 25, 277],
        [1, 375, 25, 399], [25, 375, 49, 399], [49, 375, 73, 399], [73, 375, 97, 399], [97, 375, 121, 399], [1, 67, 19, 85],
        [1, 85, 19, 103], [1, 103, 19, 121], [1, 121, 19, 139], [1, 139, 19, 157], [34, 1, 66, 33], [66, 1, 98, 33], [34, 33, 66, 65],
        [66, 33, 98, 65], [34, 66, 66, 98], [66, 66, 98, 98], [34, 98, 66, 130], [66, 98, 98, 130], [34, 131, 66, 163], [66, 131, 98, 163],
        [34, 163, 66, 195], [66, 163, 98, 195], [34, 196, 66, 228], [66, 196, 98, 228], [34, 228, 66, 260], [66, 228, 98, 260],
        [34, 261, 66, 293], [66, 261, 98, 293], [34, 293, 66, 325], [66, 293, 98, 325], [99, 1, 131, 33], [99, 34, 131, 66],
        [99, 67, 131, 99], [99, 100, 131, 132], [99, 133, 131, 165], [99, 166, 131, 198], [99, 199, 131, 231], [99, 232, 131, 264],
        [99, 265, 131, 297], [99, 298, 131, 330], [132, 166, 164, 198], [132, 199, 164, 231], [132, 232, 164, 264],
        [132, 265, 164, 297], [132, 298, 164, 330], [165, 1, 197, 33], [165, 34, 197, 66], [165, 67, 197, 99], [165, 100, 197, 132],
        [165, 133, 197, 165], [165, 166, 197, 198], [165, 199, 197, 231], [165, 232, 197, 264], [165, 265, 197, 297],
        [165, 298, 197, 330], [132, 1, 164, 33], [132, 34, 164, 66], [132, 67, 164, 99], [132, 100, 164, 132], [132, 133, 164, 165],
        [0, 0, 0, 0], [231, 199, 263, 231], [231, 232, 263, 264], [231, 265, 263, 297], [231, 298, 263, 330], [0, 0, 0, 0],
        [198, 199, 230, 231], [198, 232, 230, 264], [198, 265, 230, 297], [198, 298, 230, 330], [198, 1, 230, 33], [198, 34, 230, 66],
        [198, 67, 230, 99], [198, 100, 230, 132], [198, 133, 230, 165], [231, 1, 263, 33], [231, 34, 263, 66], [231, 67, 263, 99],
        [231, 100, 263, 132], [231, 133, 263, 165], [264, 1, 296, 33], [264, 34, 296, 66], [264, 67, 296, 99], [264, 100, 296, 132],
        [264, 133, 296, 165], [297, 1, 329, 33], [297, 34, 329, 66], [297, 67, 329, 99], [297, 100, 329, 132], [297, 133, 329, 165],
        [330, 1, 362, 33], [330, 34, 362, 66], [330, 67, 362, 99], [330, 100, 362, 132], [330, 133, 362, 165], [198, 166, 230, 198],
        [231, 166, 263, 198], [348, 355, 380, 387], [348, 322, 380, 354], [264, 236, 368, 278], [1, 332, 342, 374],
        [264, 279, 306, 321], [306, 279, 364, 321], [264, 176, 273, 195], [273, 176, 282, 195], [282, 176, 291, 195],
        [291, 176, 300, 195], [300, 176, 309, 195], [309, 176, 318, 195], [318, 176, 327, 195], [327, 176, 336, 195],
        [336, 176, 345, 195], [345, 176, 354, 195], [354, 176, 363, 195], [363, 176, 372, 195], [264, 196, 273, 215],
        [273, 196, 282, 215], [282, 196, 291, 215], [291, 196, 300, 215], [300, 196, 309, 215], [309, 196, 318, 215],
        [318, 196, 327, 215], [327, 196, 336, 215], [336, 196, 345, 215], [345, 196, 354, 215], [354, 196, 363, 215],
        [363, 196, 372, 215], [273, 166, 282, 175], [282, 166, 291, 175], [291, 166, 300, 175], [300, 166, 309, 175],
        [309, 166, 318, 175], [318, 166, 327, 175], [327, 166, 336, 175], [336, 166, 345, 175], [345, 166, 354, 175],
        [354, 166, 363, 175], [363, 166, 372, 175], [264, 216, 273, 235], [273, 216, 282, 235], [282, 216, 291, 235],
        [291, 216, 300, 235], [300, 216, 309, 235], [309, 216, 318, 235], [318, 216, 327, 235], [327, 216, 336, 235],
        [336, 216, 345, 235], [345, 216, 354, 235], [354, 216, 363, 235], [363, 216, 372, 235], [370, 216, 379, 235],
        [372, 216, 381, 235]
    ];
    // bitmap ids by name (BuildTileObject, the managers' DrawToSurface)
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

    // MUI command ids (menu 102, accelerators 103)
    const CMD = { NEW: 40001, PAUSE: 40010, CLEAR_INK: 40042, EXIT: 40000, HELP: 40040, ABOUT: 40041 };

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

    // GetGoldVersionOfTile: the yellow version the sweep shows
    function goldBitmap(bmp) {
        if (bmp >= BMP.DRAIN && bmp < BMP.DRAIN + 20) return BMP.DRAIN + 16 + (bmp - BMP.DRAIN) % 4;
        if (bmp >= BMP.BREAK && bmp < BMP.BREAK + 5) return BMP.GOLD_BREAK;
        return BMP.GOLD_WALL;
    }

    // ---- the window --------------------------------------------------------------------------------
    const store = VG ? VG.store(GAME_ID) : null;
    let ib = null;

    class InkBall {
        constructor(pack, boards, art, pen) {
            this.pack = pack;
            this.art = art;
            this.active = false;
            this.userPaused = false;
            this.last = 0;
            this.wait = 0;
            this.game = new Game({
                boards,
                difficulty: store.get('difficulty', 0),
                hiScore: store.get('hiScore', DEFAULT_HISCORE),
                onKill: (reason) => this.gameOver(reason),
                onHiScore: (s) => store.set('hiScore', s)
            });
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: pack.string(15000, 'InkBall'),
                icon: '/static_images/app_icons/48/vista-inkball.webp',
                iconClass: 'fas fa-pen',
                pack,
                // menu 102 right-aligns its accelerator text with \b, the engine reads \t
                menu: (pack.mui.menus[102] || []).map((top) => Object.assign({}, top, {
                    items: (top.items || []).map((it) => Object.assign({}, it, { text: String(it.text || '').replace(/\x08/g, '\t') }))
                })),
                accelerators: 103,
                nativeW: NATIVE_W,
                nativeH: NATIVE_H,
                fill: '#dad9e6',
                resizable: false,
                maximizable: false,
                onCommand: (id) => this.command(id),
                menuState: (id) => this.menuState(id),
                onActivate: (active) => this.setActive(active),
                onClosed: () => store.set('difficulty', this.game.difficulty)
            });
            const stage = this.win.stage;
            stage.draw = (ctx) => this.draw(ctx);
            stage.onFrame = (now) => this.frame(now);
            // WinInit: the window class cursor is IDC_PEN
            this.win.surface.style.cursor = pen ? 'url("' + ART + 'pen.png") ' + pen.x + ' ' + pen.y + ', crosshair' : 'crosshair';
            this.wirePointer();
        }

        // BoardIsActive: the game runs while its window is active, not paused, its menus closed
        // and no message box is up
        running() {
            return this.active && !this.userPaused && !this.win.dialogs.length && this.game.state !== 'dead'
                && !this.win.menubar.querySelector('.context-open');
        }

        setActive(active) {
            this.active = active;
            if (active) this.resume();
        }

        resume() {
            this.last = 0;
            this.win.stage.invalidate();
        }

        // the game loop (CGameManager tick). inkball.exe ticks from its idle loop, every
        // timeGetTime step (about 16 ms on the VM), with the time since the last tick mod 66 ms;
        // a slow browser frame is cut into ticks of that size, a stall (over 250 ms) loses all
        // but the mod 66 the way the original does
        frame(now) {
            if (!this.running()) {
                this.last = 0;
                // the menus close without telling the window: look again in a moment
                if (this.active && !this.userPaused && this.game.state !== 'dead') setTimeout(() => this.win.stage.invalidate(), 100);
                return false;
            }
            const ms = Math.floor(now);
            if (!this.last) {
                this.last = ms;
                return true;
            }
            let elapsed = ms - this.last;
            if (!elapsed) return true;
            this.last = ms;
            if (elapsed > 250) elapsed %= 66;
            const ticks = elapsed > 33 ? Math.ceil(elapsed / 16) : 1;
            for (let i = 0; i < ticks && elapsed > 0; i++) {
                const dt = Math.ceil(elapsed / (ticks - i));
                elapsed -= dt;
                this.tick(dt, now);
            }
            // returning true repaints and asks for the next frame (an invalidate here was a second
            // request, and the stage painted the board one more time every frame it ran)
            return true;
        }

        tick(dt, now) {
            const g = this.game;
            if (g.state === 'play') g.update(dt);
            else if (g.state === 'complete') g.completeStep(dt);
            else if (g.state === 'wait') {
                // Sleep(1500) before LoadNextLevel
                if (!this.wait) this.wait = now + 1500;
                else if (now >= this.wait) {
                    this.wait = 0;
                    g.nextBoard();
                }
            }
        }

        // KillPlayer's MessageBox (MB_OK, owner the game window): "Game over!"
        gameOver(reason) {
            const text = this.pack.string(reason === 0 ? 15002 : 15003);
            this.messageBox(this.pack.string(15001, 'Game over!'), text).then(() => {
                this.game.replay();
                this.resume();
            });
            this.win.stage.invalidate();
        }

        // a Vista MessageBox (measured on the VM: client 263 x 116, the text 12 px in on white
        // 68 px high, an 88 x 26 OK button 10 px from the right on the grey strip below)
        messageBox(title, text) {
            const tpl = { cx: 0, cy: 0, controls: [], title };
            const dlg = VG.dialog({ mui: { dialogs: {} } }, tpl, { owner: this.win, title });
            const c = dlg.content;
            Object.assign(c.style, { width: '', height: '', minWidth: '263px', display: 'flex', flexDirection: 'column' });
            const main = VG.el('div', '', text);
            Object.assign(main.style, {
                height: '68px', boxSizing: 'border-box', padding: '25px 40px 0 12px', background: '#fff', whiteSpace: 'nowrap',
                font: '9pt "Segoe UI", "SegoeUI", "Noto Sans", sans-serif', lineHeight: '16px', color: '#000'
            });
            c.appendChild(main);
            const row = VG.el('div');
            Object.assign(row.style, { height: '48px', boxSizing: 'border-box', padding: '11px 10px 0 0', background: '#f0f0f0', display: 'flex', justifyContent: 'flex-end' });
            const ok = VG.el('button', 'vista-game-button default', 'OK');
            ok.type = 'button';
            ok.dataset.dialogPrimary = '1';
            Object.assign(ok.style, { width: '88px', height: '26px', minWidth: '88px', padding: '0' });
            ok.addEventListener('click', () => dlg.close(1));
            row.appendChild(ok);
            c.appendChild(row);
            // a MessageBox centres on the screen
            VG.centerOver(dlg.modal, null);
            try { ok.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
            return dlg.promise;
        }

        // ---- menus ----
        menuState(id) {
            const d = DIFFICULTIES.findIndex((x) => x.cmd === id);
            if (d >= 0) return { checked: d === this.game.difficulty };
            if (id === CMD.PAUSE) return { checked: this.userPaused };
            return {};
        }

        command(id) {
            const g = this.game;
            const d = DIFFICULTIES.findIndex((x) => x.cmd === id);
            if (d >= 0) {
                // the difficulty items load a board of the new difficulty; the score carries on
                g.setDifficulty(d);
                store.set('difficulty', d);
                g.loadBoard(g.pickBoard(false));
                this.resume();
                return;
            }
            switch (id) {
                case CMD.NEW:
                    g.newGame();
                    this.resume();
                    break;
                case CMD.PAUSE:
                    this.userPaused = !this.userPaused;
                    if (this.userPaused) g.endStroke();
                    this.resume();
                    break;
                case CMD.CLEAR_INK:
                    g.clearInk();
                    this.win.stage.invalidate();
                    break;
                case CMD.EXIT:
                    VG.closeWindow(this.win);
                    break;
                case CMD.ABOUT:
                    // ShellAbout(hwnd, "InkBall", "InkBall 6.0.6002")
                    VG.aboutBox({ owner: this.win, title: this.pack.string(15000, 'InkBall'), text: 'InkBall 6.0.6002', icon: '/static_images/vista-games/icons/inkball-48.png' });
                    break;
                default:
                    break; // Help Topics: Windows Help and Support is not on this desktop
            }
        }

        // ---- input ----
        wirePointer() {
            const surface = this.win.surface;
            const pos = (e) => {
                const r = surface.getBoundingClientRect();
                const p = this.win.stage.toNative(e.clientX - r.left, e.clientY - r.top);
                return [Math.round(p.x), Math.round(p.y)];
            };
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointerdown', (e) => {
                const p = pos(e);
                if (e.button === 2) {
                    // WM_RBUTTONDOWN -> DropWallTile
                    if (this.game.dropWall(p[0], p[1])) this.win.stage.invalidate();
                    return;
                }
                if (e.button !== 0 || !this.running() || this.game.state !== 'play') return;
                if (p[1] < BOARD_Y) return;
                try { surface.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
                this.game.beginStroke(p[0], p[1]);
                this.win.stage.invalidate();
            });
            surface.addEventListener('pointermove', (e) => {
                if (!this.game.drawing) return;
                const p = pos(e);
                this.game.extendStroke(p[0], p[1]);
                this.win.stage.invalidate();
            });
            const up = () => {
                if (!this.game.drawing) return;
                this.game.endStroke();
                this.win.stage.invalidate();
            };
            surface.addEventListener('pointerup', up);
            surface.addEventListener('pointercancel', up);
        }

        // ---- drawing (the DirectDraw blits: no filtering) ----
        blit(ctx, id, x, y, w, h, sw) {
            const r = RECTS[id];
            if (!r || r[2] <= r[0]) return;
            const rw = sw !== undefined ? sw : r[2] - r[0];
            ctx.drawImage(this.art, r[0], r[1], rw, r[3] - r[1], x, y, w === undefined ? rw : w, h === undefined ? r[3] - r[1] : h);
        }

        // the DirectDraw stretch of a shrinking ball: destination pixel i takes source pixel
        // floor((i + 1/4) x 24 / size) (a 14 px ball in a hole on the VM matches exactly)
        stretched(id, size) {
            if (size < 1) return null;
            const key = id + ':' + size;
            this.stretchCache = this.stretchCache || new Map();
            if (this.stretchCache.has(key)) return this.stretchCache.get(key);
            const r = RECTS[id];
            const sw = r[2] - r[0];
            if (!this.artPixels) {
                const a = document.createElement('canvas');
                a.width = this.art.width;
                a.height = this.art.height;
                const actx = a.getContext('2d');
                actx.drawImage(this.art, 0, 0);
                this.artPixels = actx.getImageData(0, 0, a.width, a.height);
            }
            const src = this.artPixels;
            const c = document.createElement('canvas');
            c.width = size;
            c.height = size;
            const cctx = c.getContext('2d');
            const out = cctx.createImageData(size, size);
            const idx = [];
            for (let i = 0; i < size; i++) idx.push(Math.min(sw - 1, Math.floor((i + 0.25) * sw / size)));
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const s0 = ((r[1] + idx[y]) * src.width + r[0] + idx[x]) * 4;
                    const d0 = (y * size + x) * 4;
                    for (let k = 0; k < 4; k++) out.data[d0 + k] = src.data[s0 + k];
                }
            }
            cctx.putImageData(out, 0, 0);
            this.stretchCache.set(key, c);
            return c;
        }

        draw(ctx) {
            ctx.imageSmoothingEnabled = false;
            const g = this.game;
            if (!g.grid) return;
            // the board buffer
            g.grid.forEach((t) => this.blit(ctx, t.bmp, t.x, t.y));
            if (g.gold) g.gold.tiles.forEach((t) => { if (t) this.blit(ctx, goldBitmap(t.bmp), t.x, t.y); });
            // the ink buffer
            if (g.strokes.length) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(BOARD_X, BOARD_Y, NATIVE_W - BOARD_X, NATIVE_H - BOARD_Y);
                ctx.clip();
                // the Ink renderer puts a point on the pixel's centre (measured on the VM)
                ctx.translate(0.5, 0.5);
                ctx.strokeStyle = '#000';
                ctx.fillStyle = '#000';
                ctx.lineWidth = INK_HALF * 2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                g.strokes.forEach((s) => {
                    const p = s.points;
                    ctx.beginPath();
                    if (p.length === 1) {
                        ctx.arc(p[0][0], p[0][1], INK_HALF, 0, Math.PI * 2);
                        ctx.fill();
                        return;
                    }
                    ctx.moveTo(p[0][0], p[0][1]);
                    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
                    ctx.stroke();
                });
                ctx.restore();
            }
            // CGameBoard::BltBall: the 24 px ball stretched to its size (sinking), colour keyed
            g.balls.forEach((b) => {
                if (!b.alive) return;
                const o = rectOf(b);
                if (o[2] - o[0] === BALL) this.blit(ctx, b.bmp, o[0], o[1]);
                else {
                    const c = this.stretched(b.bmp, o[2] - o[0]);
                    if (c) ctx.drawImage(c, o[0], o[1]);
                }
            });
            this.drawBar(ctx);
        }

        drawBar(ctx) {
            const g = this.game;
            // CBallManager::DrawToSurface (0..104)
            this.blit(ctx, BMP.QUEUE_BOX, 0, 0);
            g.queue.slots.forEach((s, k) => {
                if (!s.alive || (k === 0 && g.queue.blink)) return;
                const l = Math.trunc(s.x);
                if (l >= 104) return;
                const r = Math.trunc(s.w + s.x);
                const r0 = RECTS[BMP.QUEUE_BALL + s.color];
                const w = r > 104 ? (r0[2] - r0[0]) + (104 - r) : r0[2] - r0[0];
                if (w > 0) this.blit(ctx, BMP.QUEUE_BALL + s.color, l, Math.trunc(s.y), w, undefined, w);
            });
            // CScoreManager::DrawToSurface (104..445): high score (green) then score (white),
            // right-aligned from 12 px inside the bar
            const sx = 104;
            this.blit(ctx, BMP.SCORE_BAR, sx, 0);
            let x = sx + 341 - 12;
            this.blit(ctx, BMP.GREEN_R, x, 13);
            let v = g.hiScore;
            let at;
            do {
                at = x;
                x -= 9;
                this.blit(ctx, BMP.GREEN_0 + v % 10, x, 13);
                v = Math.floor(v / 10);
            } while (v);
            this.blit(ctx, BMP.GREEN_L, at - 18, 13);
            x = at - 38;
            this.blit(ctx, BMP.WHITE_R, x, 13);
            v = g.score;
            do {
                at = x;
                x -= 9;
                this.blit(ctx, BMP.WHITE_0 + v % 10, x, 13);
                v = Math.floor(v / 10);
            } while (v);
            this.blit(ctx, BMP.WHITE_L, at - 18, 13);
            // CTileManager::DrawToSurface (445..487)
            const tx = 445;
            this.blit(ctx, BMP.TILE_BOX, tx, 0);
            if (g.tiles < 100) {
                let n = g.tiles;
                let px = tx + 14;
                do {
                    this.blit(ctx, BMP.SMALL_0 + n % 10, px, 18);
                    px -= 9;
                    n = Math.floor(n / 10);
                } while (n);
            } else this.blit(ctx, BMP.SMALL_PLUS, tx + 14, 18);
            // CTimeManager::DrawToSurface (486..544): three digits in the red box, --- for no limit
            const cx = 486;
            this.blit(ctx, BMP.TIME_BOX, cx, 0);
            let px = cx + 58 - 3 - 9;
            this.blit(ctx, BMP.RED_R, px, 13);
            const c = g.clock;
            const secs = c.time === -1 ? 4294967 : Math.floor(c.time / 1000);
            let s = secs;
            for (let k = 0; k < 3; k++) {
                px -= 9;
                if (secs >= 1000) this.blit(ctx, BMP.RED_DASH, px, 13);
                else if (!c.visible) this.blit(ctx, BMP.RED_BLANK, px, 13);
                else this.blit(ctx, BMP.RED_0 + s % 10, px, 13);
                s = Math.floor(s / 10);
            }
            this.blit(ctx, BMP.RED_L, px - 9, 13);
        }
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('InkBall: ' + url));
            img.src = url;
        });
    }

    let loading = null;
    function open() {
        if (!loading) {
            loading = Promise.all([
                VG.loadPack(GAME_ID),
                fetch(ART + 'boards.bin', { credentials: 'same-origin' }).then((r) => {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.arrayBuffer();
                }),
                loadImage(ART + 'inkball.png'),
                fetch(ART + 'pen.json', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            ]).catch((err) => {
                loading = null;
                throw err;
            });
        }
        return loading.then(([pack, bin, art, pen]) => {
            if (!ib) ib = new InkBall(pack, parseBoards(bin), art, pen);
            const first = !ib.win.isOpen();
            ib.win.open();
            if (first) {
                ib.game.newGame();
                ib.userPaused = false;
                ib.resume();
            }
            return ib;
        });
    }

    root.VistaInkBallCore = { parseBoards, Game, ballPoints, round, DIFFICULTIES, RECTS, BMP, BALL_POINTS };
    if (!VG) return;
    VG.register({
        id: GAME_ID,
        name: 'InkBall',
        icon: '/static_images/vista-games/icons/inkball',
        feature: 'vista_inkball',
        open
    });
    root.openVistaInkBall = open;
    root.vistaInkBall = () => ib;
})(typeof window !== 'undefined' ? window : globalThis);
