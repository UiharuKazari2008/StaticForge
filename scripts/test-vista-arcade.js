#!/usr/bin/env node
// Block Drop and Brick Breaker (Yozora #609): the rules of the two arcade games that sit with the
// Vista games, run headless. public/scripts/comp/desktop-apps/vista-games/blockdrop.js and
// brickbreaker.js export their pure rules (no DOM) through module.exports when loaded in node.
//
//   Block Drop: piece shapes and rotation, the 7-piece bag, spawning, collision, SRS wall kicks,
//   line clears and guideline scoring (soft / hard drop, T-spins, back-to-back, combos), lock
//   delay, levels, hold, top out, the 150-line win, saved games
//   Brick Breaker: layouts, paddle angles, walls, brick hits (faces and corners), silver and gold
//   bricks, capsules, lives, level clears, the last-level win, saved games
//   Both: every sound file they play is in its pack
//
// Run: node scripts/test-vista-arcade.js
const assert = require('assert');
const path = require('path');

const dir = path.join(__dirname, '../public/scripts/comp/desktop-apps/vista-games');
const BD = require(path.join(dir, 'blockdrop.js'));
const BB = require(path.join(dir, 'brickbreaker.js'));

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
    } catch (err) {
        console.error('FAIL ' + name);
        throw err;
    }
}

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- Block Drop ---------------------------------------------------------------------------------
const { Engine, CELLS, COLS, ROWS, HIDDEN, COLOR } = BD;
const C = (t) => COLOR[t] + 1;

// rows as strings bottom-aligned: '#' filled (grey), '.' empty
function board(e, rows) {
    e.board.fill(0);
    rows.forEach((r, i) => {
        const y = ROWS - rows.length + i;
        for (let x = 0; x < COLS; x++) e.board[y * COLS + x] = r[x] === '.' ? 0 : C('G');
    });
}

function engine(opts) {
    const e = new Engine(Object.assign({ rng: seeded(7) }, opts));
    e.takeEvents();
    return e;
}

const sameSet = (a, b) => JSON.stringify(a.map(String).sort()) === JSON.stringify(b.map(String).sort());

test('shapes: four cells, four turns come back round', () => {
    BD.TYPES.forEach((t) => {
        CELLS[t].forEach((cells) => assert.strictEqual(cells.length, 4, t));
        assert.ok(sameSet(CELLS[t][0], CELLS[t][0]));
    });
    // the I stands in its box's third column when turned clockwise (SRS)
    assert.ok(sameSet(CELLS.I[1], [[2, 0], [2, 1], [2, 2], [2, 3]]));
    // the T points right, down, left in turn
    assert.ok(sameSet(CELLS.T[1], [[1, 0], [1, 1], [2, 1], [1, 2]]));
    assert.ok(sameSet(CELLS.T[2], [[0, 1], [1, 1], [2, 1], [1, 2]]));
    assert.ok(sameSet(CELLS.T[3], [[1, 0], [0, 1], [1, 1], [1, 2]]));
    // the O never changes
    CELLS.O.forEach((c) => assert.ok(sameSet(c, CELLS.O[0])));
});

test('7-piece bag: every run of seven holds each piece once', () => {
    const e = engine();
    const seq = [];
    for (let i = 0; i < 28; i++) seq.push(e.takeNext());
    for (let i = 0; i < 28; i += 7) assert.deepStrictEqual(seq.slice(i, i + 7).sort(), BD.TYPES.slice().sort());
});

test('spawn: centred above the well, dropped into it at once', () => {
    const e = engine();
    e.queue[0] = 'I';
    e.start();
    assert.deepStrictEqual([e.piece.x, e.piece.y, e.piece.rot], [3, 1, 0]);
    // the I lies in the top row of the well
    assert.ok(e.pieceCells().every(([x, y]) => y === HIDDEN && x >= 3 && x <= 6));
    assert.strictEqual(e.takeEvents()[0].type, 'spawn');
});

test('collision: the walls stop a move', () => {
    const e = engine();
    e.queue[0] = 'O';
    e.start();
    let n = 0;
    while (e.move(-1)) n++;
    assert.strictEqual(n, 4);
    assert.strictEqual(Math.min(...e.pieceCells().map((c) => c[0])), 0);
    n = 0;
    while (e.move(1)) n++;
    assert.strictEqual(n, 8);
    assert.strictEqual(Math.max(...e.pieceCells().map((c) => c[0])), COLS - 1);
});

test('SRS: plain turn uses no kick; the wall kicks an I standing against it', () => {
    const e = engine();
    e.queue[0] = 'T';
    e.start();
    e.piece.y = 10;
    assert.ok(e.rotate(1));
    assert.deepStrictEqual([e.piece.x, e.piece.y, e.piece.rot, e.lastKick], [3, 10, 1, 0]);
    // I upright in column 0 (box x = -2), turning 1 -> 2: tests 0 and 1 hit the wall, test 2
    // (+2, 0) fits
    e.piece = { type: 'I', rot: 1, x: -2, y: 10 };
    assert.ok(e.rotate(1));
    assert.deepStrictEqual([e.piece.x, e.piece.y, e.piece.rot, e.lastKick], [0, 10, 2, 2]);
    // counter-clockwise 0 -> 3 for J against the right wall: (+1, 0) is the wall, (+1, -1) too;
    // the kick table's later tests are tried in order
    e.piece = { type: 'J', rot: 0, x: 7, y: 10 };
    assert.ok(e.rotate(-1));
    assert.strictEqual(e.piece.rot, 3);
    // the O turns in place
    e.piece = { type: 'O', rot: 0, x: 3, y: 10 };
    assert.ok(e.rotate(1));
    assert.deepStrictEqual([e.piece.x, e.piece.y], [3, 10]);
});

test('SRS: a floor kick lifts a T turned on the bottom row', () => {
    const e = engine();
    board(e, ['..........']);
    // T flat on the floor pointing up, box at y = 20; turning to point down needs the box one row up
    e.piece = { type: 'T', rot: 0, x: 3, y: 20 };
    // rot 0 -> 1 then 1 -> 2: the second turn puts a cell below the floor without a kick
    assert.ok(e.rotate(1));
    assert.ok(e.rotate(1));
    assert.strictEqual(e.piece.rot, 2);
    assert.ok(e.pieceCells().every(([, y]) => y < ROWS));
    assert.ok(e.fits(e.piece.type, e.piece.rot, e.piece.x, e.piece.y));
});

test('SRS: the fifth test drops a T two rows into a T-spin triple slot', () => {
    const e = engine();
    // everything filled but the T (box at 3, 14, pointing up) and the cells it takes pointing
    // left with the 0 -> 3 table's last offset, (+1, -2) in the guideline's y-up terms
    const open = new Set();
    const at = (rot, bx, by) => CELLS.T[rot].map(([x, y]) => (by + y) * COLS + bx + x);
    at(0, 3, 14).concat(at(3, 4, 16)).forEach((i) => open.add(i));
    for (let i = 13 * COLS; i < ROWS * COLS; i++) e.board[i] = open.has(i) ? 0 : C('G');
    e.piece = { type: 'T', rot: 0, x: 3, y: 14 };
    assert.ok(e.rotate(-1));
    assert.deepStrictEqual([e.piece.x, e.piece.y, e.piece.rot, e.lastKick], [4, 16, 3, 4]);
});

test('a turn with no room fails and says so', () => {
    const e = engine();
    // the I lying in a one-row gap with walls above and below: no kick fits it upright
    board(e, ['##########', '##########', '##########', '##########', '#....#####', '##########', '##########', '##########']);
    e.piece = { type: 'I', rot: 0, x: 1, y: ROWS - 5 };
    assert.ok(e.fits('I', 0, 1, ROWS - 5));
    assert.ok(!e.rotate(1));
    assert.strictEqual(e.piece.rot, 0);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'blocked'));
});

test('line clears: single, double, triple and four lines score 100 / 300 / 500 / 800 x level', () => {
    const cases = [
        [['#########.'], 1, 100],
        [['#########.', '#########.'], 2, 300],
        [['#########.', '#########.', '#########.'], 3, 500],
        [['#########.', '#########.', '#########.', '#########.'], 4, 800]
    ];
    cases.forEach(([rows, n, points]) => {
        const e = engine({ clearDelay: 0 });
        board(e, rows);
        e.piece = { type: 'I', rot: 1, x: 7, y: 2 };
        const drop = e.dropDistance();
        e.hardDrop();
        assert.strictEqual(e.lines, n, n + ' lines');
        assert.strictEqual(e.score, points + drop * 2, n + ' lines score');
        // what was left of the I sits on the floor
        const left = e.board.filter(Boolean).length;
        assert.strictEqual(left, 4 - n);
    });
});

test('cleared rows close up; the rows above drop', () => {
    const e = engine({ clearDelay: 0 });
    board(e, ['#.........', '########..', '.#######..']);
    e.piece = { type: 'O', rot: 0, x: 7, y: 2 };
    e.hardDrop();
    // the O fills cols 8-9 of the two lower rows: the middle row clears
    assert.strictEqual(e.lines, 1);
    const row = (y) => e.board.slice(y * COLS, (y + 1) * COLS).map((v) => (v ? '#' : '.')).join('');
    assert.strictEqual(row(ROWS - 1), '.#########');
    assert.strictEqual(row(ROWS - 2), '#.........');
    assert.strictEqual(row(ROWS - 3), '..........');
});

test('line clear delay: the rows stay until it runs out, then the next piece comes', () => {
    const e = engine({ clearDelay: 300 });
    board(e, ['#########.']);
    e.piece = { type: 'I', rot: 1, x: 7, y: 2 };
    e.hardDrop();
    assert.ok(e.clearing && !e.piece);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'clear' && ev.rows[0] === ROWS - 1));
    e.tick(200);
    assert.ok(e.clearing);
    e.tick(150);
    assert.ok(!e.clearing && e.piece && e.lines === 1);
});

test('back-to-back four-line clears pay 1.5x, combos 50 x combo x level', () => {
    const e = engine({ clearDelay: 0 });
    const quad = () => {
        board(e, ['#########.', '#########.', '#########.', '#########.']);
        e.piece = { type: 'I', rot: 1, x: 7, y: 2 };
        const before = e.score;
        const d = e.dropDistance();
        e.hardDrop();
        return e.score - before - d * 2;
    };
    assert.strictEqual(quad(), 800);
    // level is 1 + floor(4 / 10) = 1 still; b2b and a combo of 1
    assert.strictEqual(quad(), 1200 + 50);
    // a lock with no lines ends the combo but not the back-to-back
    board(e, ['..........']);
    e.piece = { type: 'O', rot: 0, x: 0, y: 2 };
    e.hardDrop();
    assert.strictEqual(e.combo, -1);
    assert.strictEqual(e.b2b, true);
    // a single breaks the back-to-back
    board(e, ['#########.']);
    e.piece = { type: 'I', rot: 1, x: 7, y: 2 };
    e.hardDrop();
    assert.strictEqual(e.b2b, false);
});

test('T-spin double (3-corner rule) scores 1200 x level; mini when one front corner is open', () => {
    const e = engine({ clearDelay: 0 });
    // the T slot: the T pointing down fills cols 2-4 of row 20 and col 3 of row 21, under an
    // overhang at col 2 (it turned in under it)
    board(e, ['###.......', '##...#####', '###.######']);
    e.piece = { type: 'T', rot: 2, x: 2, y: ROWS - 3 };
    e.lastRotate = true;
    e.lastKick = 0;
    e.lock();
    const lock = e.takeEvents().find((ev) => ev.type === 'lock');
    assert.strictEqual(lock.tspin, 'full');
    assert.strictEqual(lock.lines, 2);
    assert.strictEqual(e.score, 1200);
    // the same slot with nothing over it: only 2 corners -> no T-spin, a plain double
    const f = engine({ clearDelay: 0 });
    board(f, ['..........', '##...#####', '###.######']);
    f.piece = { type: 'T', rot: 2, x: 2, y: ROWS - 3 };
    f.lastRotate = true;
    f.lock();
    assert.strictEqual(f.takeEvents().find((ev) => ev.type === 'lock').tspin, null);
    assert.strictEqual(f.score, 300);
    // pointing up with the two corners behind it filled and one in front: mini
    const m = engine({ clearDelay: 0 });
    board(m, ['#.........', '...#######', '#.########']);
    m.piece = { type: 'T', rot: 0, x: 0, y: ROWS - 3 };
    // corners (0,19) (0,21) (2,21) filled, (2,19) open: front corners of rot 0 are the top two
    m.lastRotate = true;
    m.lastKick = 1;
    m.lock();
    assert.strictEqual(m.takeEvents().find((ev) => ev.type === 'lock').tspin, 'mini');
    // a T that only moved is never a T-spin
    const n = engine({ clearDelay: 0 });
    board(n, ['###.......', '##...#####', '###.######']);
    n.piece = { type: 'T', rot: 2, x: 2, y: ROWS - 3 };
    n.lastRotate = false;
    n.lock();
    assert.strictEqual(n.takeEvents().find((ev) => ev.type === 'lock').tspin, null);
});

test('soft drop scores a point a row, hard drop two', () => {
    const e = engine();
    e.queue[0] = 'O';
    e.start();
    const y0 = e.piece.y;
    e.tick(50, true);
    const rows = e.piece.y - y0;
    assert.ok(rows >= 1);
    assert.strictEqual(e.score, rows);
    const d = e.dropDistance();
    e.hardDrop();
    assert.strictEqual(e.score, rows + d * 2);
});

test('gravity: one row a second at level 1, faster each level', () => {
    assert.strictEqual(Math.round(BD.gravityMs(1)), 1000);
    for (let l = 2; l <= 20; l++) assert.ok(BD.gravityMs(l) < BD.gravityMs(l - 1), 'level ' + l);
    const e = engine();
    e.queue[0] = 'T';
    e.start();
    const y = e.piece.y;
    e.tick(999);
    assert.strictEqual(e.piece.y, y);
    e.tick(2);
    assert.strictEqual(e.piece.y, y + 1);
});

test('lock delay: half a second on the ground, moves buy time (15 at most)', () => {
    const e = engine();
    e.queue[0] = 'T';
    e.queue[1] = 'O';
    e.start();
    e.piece.y = ROWS - 2;
    assert.ok(e.grounded());
    e.tick(400);
    assert.strictEqual(e.piece.type, 'T');
    e.move(1);
    e.tick(400);
    assert.strictEqual(e.piece.type, 'T', 'the move reset the lock delay');
    for (let i = 0; i < 20; i++) {
        e.move(i % 2 ? 1 : -1);
        e.tick(100);
    }
    // after 15 resets the delay runs out however it moves
    assert.notStrictEqual(e.piece.type, 'T');
    assert.ok(e.board.some(Boolean));
});

test('levels: one every 10 lines from the starting level', () => {
    const e = engine({ startLevel: 3, clearDelay: 0 });
    assert.strictEqual(e.level, 3);
    e.lines = 9;
    assert.strictEqual(e.level, 3);
    board(e, ['#########.']);
    e.piece = { type: 'I', rot: 1, x: 7, y: 2 };
    e.hardDrop();
    assert.strictEqual(e.level, 4);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'levelup' && ev.level === 4));
});

test('hold: swaps once per piece', () => {
    const e = engine();
    e.queue.splice(0, 2, 'T', 'S');
    e.start();
    assert.ok(e.holdPiece());
    assert.strictEqual(e.hold, 'T');
    assert.strictEqual(e.piece.type, 'S');
    assert.ok(!e.holdPiece(), 'only once until the piece locks');
    e.hardDrop();
    const next = e.piece.type;
    assert.ok(e.holdPiece());
    assert.strictEqual(e.piece.type, 'T');
    assert.strictEqual(e.hold, next);
});

test('top out: a piece that cannot spawn ends the game', () => {
    const e = engine();
    for (let x = 0; x < COLS; x++) e.board[0 * COLS + x] = e.board[1 * COLS + x] = x === 0 ? 0 : C('G');
    e.start();
    assert.ok(e.over && !e.won);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'gameover' && ev.why === 'blockout'));
});

test('lock out: a piece that locks wholly above the well ends the game', () => {
    const e = engine({ clearDelay: 0 });
    // the well full to the top but for column 0: no row is complete
    for (let y = HIDDEN; y < ROWS; y++) for (let x = 0; x < COLS; x++) e.board[y * COLS + x] = x === 0 ? 0 : C('G');
    e.piece = { type: 'O', rot: 0, x: 3, y: 0 };
    e.hardDrop();
    assert.ok(e.over);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'gameover' && ev.why === 'lockout'));
});

test('win: the line goal ends the game won', () => {
    const e = engine({ clearDelay: 0, goal: 4 });
    board(e, ['#########.', '#########.', '#########.', '#########.']);
    e.piece = { type: 'I', rot: 1, x: 7, y: 2 };
    e.hardDrop();
    assert.ok(e.over && e.won);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'win'));
    assert.strictEqual(BD.GOAL_LINES, 150);
});

test('saved game: serialize and restore', () => {
    const e = engine({ clearDelay: 0, startLevel: 2 });
    e.start();
    e.move(-1);
    e.holdPiece();
    e.score = 4321;
    e.lines = 17;
    e.board[ROWS * COLS - 1] = C('Z');
    const s = JSON.parse(JSON.stringify(e.serialize()));
    const r = Engine.restore(s, { rng: seeded(3) });
    assert.deepStrictEqual(r.board, e.board);
    assert.deepStrictEqual(r.piece, e.piece);
    assert.deepStrictEqual(r.queue, e.queue);
    assert.deepStrictEqual([r.hold, r.holdUsed, r.score, r.lines, r.level], [e.hold, e.holdUsed, 4321, 17, 3]);
});

// ---- Brick Breaker ----------------------------------------------------------------------------
const { BrickEngine, FIELD_W, FIELD_H, PADDLE_Y, BALL_R, PADDLE_W, PADDLE_WIDE } = BB;

function breakout(opts) {
    const e = new BrickEngine(Object.assign({ rng: () => 0.99 }, opts));
    e.takeEvents();
    return e;
}

// a brick out of the way, so the level is not cleared under a test
const far = () => ({ kind: 'color', color: 0, col: 0, row: 0, x: 0, y: 30, w: 34, h: 14, hits: 0, maxHits: 1 });

const run = (e, ms, input) => {
    for (let t = 0; t < ms; t += 10) e.step(10, input || {});
};

test('layouts: ten drawn by hand, twelve bricks wide; the rest built the same every time', () => {
    assert.strictEqual(BB.LAYOUTS.length, 10);
    BB.LAYOUTS.forEach((rows, i) => rows.forEach((r) => assert.strictEqual(r.length, 12, 'level ' + (i + 1) + ' ' + r)));
    for (let l = 11; l <= BB.LEVELS; l++) {
        const a = BB.layoutFor(l);
        assert.deepStrictEqual(a, BB.layoutFor(l));
        a.forEach((r) => assert.strictEqual(r.length, 12));
        const bricks = BB.buildBricks(l);
        assert.ok(bricks.filter((b) => b.kind !== 'gold').length >= 16, 'level ' + l);
        // mirrored
        a.forEach((r) => assert.strictEqual(r, r.split('').reverse().join('')));
    }
    // bricks sit in the field
    BB.buildBricks(10).forEach((b) => assert.ok(b.x >= 0 && b.x + b.w <= FIELD_W && b.y + b.h < PADDLE_Y));
});

test('paddle: the angle follows where the ball hits, up to 60 degrees', () => {
    assert.strictEqual(BrickEngine.bounceAngle(0), 0);
    assert.ok(Math.abs(BrickEngine.bounceAngle(1) - Math.PI / 3) < 1e-9);
    assert.ok(Math.abs(BrickEngine.bounceAngle(-3) + Math.PI / 3) < 1e-9);
    const hit = (offsetPx) => {
        const e = breakout();
        e.bricks = [far()];
        const p = e.paddle;
        e.balls = [{ x: p.x + p.w / 2 + offsetPx, y: PADDLE_Y - 20, vx: 0, vy: 300, stuck: false }];
        run(e, 100, { x: p.x + p.w / 2 });
        const b = e.balls[0];
        assert.ok(b.vy < 0, 'goes back up');
        return Math.atan2(b.vx, -b.vy);
    };
    assert.ok(Math.abs(hit(0)) < 0.01);
    assert.ok(hit(20) > 0.5 && hit(20) < Math.PI / 3);
    assert.ok(hit(-20) < -0.5);
    assert.ok(Math.abs(hit(PADDLE_W / 2 + BALL_R) - Math.PI / 3) < 0.01);
});

test('walls: the ball comes back off the sides and the top', () => {
    const e = breakout();
    e.bricks = [far()];
    e.balls = [{ x: 8, y: 200, vx: -300, vy: -100, stuck: false }];
    run(e, 30);
    assert.ok(e.balls[0].vx > 0);
    e.balls = [{ x: 200, y: 8, vx: 50, vy: -300, stuck: false }];
    run(e, 30);
    assert.ok(e.balls[0].vy > 0);
    e.balls = [{ x: FIELD_W - 8, y: 200, vx: 300, vy: -100, stuck: false }];
    run(e, 30);
    assert.ok(e.balls[0].vx < 0);
});

test('bricks: a hit from below breaks it and turns the ball down', () => {
    const e = breakout();
    const br = { kind: 'color', color: 0, col: 5, row: 0, x: 175, y: 100, w: 34, h: 14, hits: 0, maxHits: 1 };
    e.bricks = [br, { kind: 'color', color: 1, col: 0, row: 9, x: 0, y: 30, w: 34, h: 14, hits: 0, maxHits: 1 }];
    e.balls = [{ x: 192, y: 140, vx: 0, vy: -300, stuck: false }];
    run(e, 200);
    assert.strictEqual(e.bricks.indexOf(br), -1);
    assert.ok(e.balls[0].vy > 0);
    assert.strictEqual(e.score, 50);
    assert.strictEqual(e.broken, 1);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'brickbreak' && ev.brick === br));
});

test('bricks: a side hit turns the ball back sideways; a corner hit both ways', () => {
    const e = breakout();
    const wall = { kind: 'gold', x: 200, y: 100, w: 34, h: 14, hits: 0, maxHits: Infinity };
    e.bricks = [wall, far()];
    e.balls = [{ x: 180, y: 107, vx: 300, vy: 90, stuck: false }];
    run(e, 60);
    assert.ok(e.balls[0].vx < 0, 'side');
    assert.ok(e.balls[0].vy > 0);
    // straight at the bottom left corner, diagonally
    e.balls = [{ x: 190, y: 124, vx: 200, vy: -200, stuck: false }];
    run(e, 40);
    assert.ok(e.balls[0].vx < 0 && e.balls[0].vy > 0, 'corner');
});

test('silver bricks take several hits and crack; gold never breaks and is not needed', () => {
    assert.strictEqual(BB.silverHits(1), 2);
    assert.strictEqual(BB.silverHits(8), 3);
    const e = breakout({ startLevel: 6 });
    const silver = e.bricks.find((b) => b.kind === 'silver');
    const gold = e.bricks.find((b) => b.kind === 'gold');
    assert.ok(silver && gold);
    assert.strictEqual(silver.maxHits, 3);
    e.damage(silver);
    e.damage(silver);
    assert.ok(e.bricks.indexOf(silver) >= 0);
    assert.strictEqual(silver.hits, 2);
    e.damage(silver);
    assert.strictEqual(e.bricks.indexOf(silver), -1);
    for (let i = 0; i < 10; i++) e.damage(gold);
    assert.ok(e.bricks.indexOf(gold) >= 0);
    // clear everything breakable: the level is done with the gold still up
    e.bricks.filter((b) => b.kind !== 'gold').forEach((b) => { b.hits = b.maxHits - 1; e.damage(b); });
    e.balls = [{ x: 200, y: 250, vx: 0, vy: -100, stuck: false }];
    e.step(10, {});
    assert.ok(e.cleared);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'levelclear' && ev.level === 6 && ev.bonus === 3000));
});

test('level clear: bonus, then the next level loads with the ball on the paddle', () => {
    const e = breakout();
    e.bricks = [{ kind: 'color', color: 0, col: 0, row: 0, x: 175, y: 100, w: 34, h: 14, hits: 0, maxHits: 1 }];
    e.balls = [{ x: 192, y: 140, vx: 0, vy: -300, stuck: false }];
    run(e, 200);
    assert.ok(e.cleared);
    assert.strictEqual(e.score, 50 + 500);
    run(e, 100);
    assert.strictEqual(e.level, 1, 'waits for nextLevel');
    assert.ok(e.nextLevel());
    assert.strictEqual(e.level, 2);
    assert.ok(e.balls.length === 1 && e.balls[0].stuck);
    assert.deepStrictEqual(e.bricks.length, BB.buildBricks(2).length);
});

test('serve and launch: the ball rides the paddle until launched', () => {
    const e = breakout();
    run(e, 200, { x: 100 });
    const b = e.balls[0];
    assert.ok(b.stuck);
    assert.ok(Math.abs(b.x - 100) < 1e-6);
    assert.ok(e.launch());
    assert.ok(!b.stuck && b.vy < 0);
    assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - e.ballSpeed()) < 1e-6);
});

test('lives: a ball past the paddle costs one; the last one ends the game', () => {
    const e = breakout();
    e.balls = [{ x: 30, y: FIELD_H - 2, vx: 0, vy: 300, stuck: false }];
    e.paddle.x = 300;
    run(e, 100, { x: 330 });
    assert.strictEqual(e.lives, 2);
    assert.ok(e.balls[0].stuck);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'lifelost'));
    e.lives = 1;
    e.balls = [{ x: 30, y: FIELD_H - 2, vx: 0, vy: 300, stuck: false }];
    run(e, 100, { x: 330 });
    assert.ok(e.over && !e.won);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'gameover'));
});

test('capsules: wide, three balls, slow, catch, extra ball', () => {
    const e = breakout();
    e.launch();
    e.collect('wide');
    assert.strictEqual(e.targetWidth(), PADDLE_WIDE);
    run(e, 300, { x: 210 });
    assert.strictEqual(e.paddle.w, PADDLE_WIDE);
    const fast = e.ballSpeed();
    e.collect('slow');
    assert.ok(e.ballSpeed() < fast * 0.75);
    e.collect('multi');
    assert.strictEqual(e.balls.length, 3);
    const lives = e.lives;
    e.collect('life');
    assert.strictEqual(e.lives, lives + 1);
    // catch: the ball stays on the paddle after a hit
    const c = breakout();
    c.collect('sticky');
    c.bricks = [far()];
    c.balls = [{ x: 210, y: PADDLE_Y - 20, vx: 0, vy: 300, stuck: false }];
    run(c, 100, { x: 210 });
    assert.ok(c.balls[0].stuck && c.balls[0].caught);
    // ... and lets it go by itself after a while
    run(c, 3100, { x: 210 });
    assert.ok(!c.balls[0].stuck);
    // a falling capsule is caught by the paddle
    const d = breakout();
    d.capsules = [{ type: 'wide', x: 210, y: PADDLE_Y - 30, t: 0 }];
    run(d, 600, { x: 210 });
    assert.strictEqual(d.capsules.length, 0);
    assert.strictEqual(d.targetWidth(), PADDLE_WIDE);
    // the powers run out
    run(d, 21000, { x: 210 });
    assert.strictEqual(d.targetWidth(), PADDLE_W);
});

test('the ball keeps its speed and never goes flat', () => {
    const e = breakout({ rng: seeded(5) });
    e.launch();
    for (let i = 0; i < 400; i++) {
        e.step(16, { x: e.balls[0] ? e.balls[0].x : 210 });
        if (e.cleared || e.over) break;
        e.balls.forEach((b) => {
            if (b.stuck) return;
            const s = Math.hypot(b.vx, b.vy);
            assert.ok(Math.abs(b.vy) >= 0.27 * s, 'steep enough');
        });
    }
    // the paddle follows the ball, so no ball was lost
    assert.strictEqual(e.lives, 3);
    assert.ok(e.broken > 0);
});

test('win: clearing the last level wins', () => {
    const e = breakout({ levels: 2, startLevel: 2 });
    e.bricks = [{ kind: 'color', color: 0, col: 0, row: 0, x: 175, y: 100, w: 34, h: 14, hits: 0, maxHits: 1 }];
    e.balls = [{ x: 192, y: 140, vx: 0, vy: -300, stuck: false }];
    run(e, 200);
    assert.ok(e.over && e.won);
    assert.ok(e.takeEvents().some((ev) => ev.type === 'win'));
});

test('saved game: serialize and restore', () => {
    const e = breakout({ startLevel: 4 });
    e.score = 999;
    e.lives = 2;
    e.damage(e.bricks[0]);
    const silver = e.bricks.find((b) => b.kind === 'silver');
    if (silver) e.damage(silver);
    const s = JSON.parse(JSON.stringify(e.serialize()));
    const r = BrickEngine.restore(s, {});
    assert.deepStrictEqual([r.level, r.score, r.lives, r.broken], [4, e.score, 2, e.broken]);
    assert.deepStrictEqual(r.bricks.map((b) => [b.col, b.row, b.hits]), e.bricks.map((b) => [b.col, b.row, b.hits]));
});

test('display names stay in one constant, free of trademarked names', () => {
    const fs = require('fs');
    [['blockdrop.js', BD.DISPLAY_NAME], ['brickbreaker.js', BB.DISPLAY_NAME]].forEach(([file, name]) => {
        const src = fs.readFileSync(path.join(dir, file), 'utf8');
        assert.ok(!/tetris|breakout/i.test(src), file);
        assert.strictEqual(src.split("'" + name + "'").length, 2, file + ': the name is written once');
    });
});

test('sounds: every sound file is in its pack, no Minesweeper tile beep per hit', () => {
    const fs = require('fs');
    const games = path.join(__dirname, '../public/static_images/vista-games');
    const key = (p) => String(p).toUpperCase().replace(/[\\/]+/g, '_');
    const packs = {};
    const pack = (name) => packs[name] || (packs[name] = JSON.parse(fs.readFileSync(path.join(games, name, 'data.json'), 'utf8')));
    // the VG.Sounds blocks: new VG.Sounds(<pack>, soundsNode([[name, file, volume, buffers], ...]))
    const where = { ms: 'minesweeper', cg: 'cardgames' };
    ['blockdrop.js', 'brickbreaker.js'].forEach((file) => {
        const src = fs.readFileSync(path.join(dir, file), 'utf8');
        const blocks = [...src.matchAll(/new VG\.Sounds\((\w+), soundsNode\(\[([\s\S]*?)\]\)\)/g)];
        assert.ok(blocks.length >= 2, file);
        blocks.forEach(([, owner, list]) => {
            [...list.matchAll(/\['(\w+)', '([^']+)', (\d+), \d+\]/g)].forEach(([, name, sound]) => {
                let url;
                if (owner === 'MAHJONG_AUDIO') url = 'mahjong/audio/' + sound.replace(/\.wma$/i, '').toLowerCase() + '.m4a';
                else {
                    const p = pack(where[owner]);
                    const n = p.audio['AUDIO_SFX_' + key(sound)] || p.audio['AUDIO_' + key(sound)];
                    assert.ok(n, file + ' ' + name + ': ' + sound + ' is not in ' + where[owner]);
                    url = where[owner] + '/audio/' + n + '.m4a';
                }
                assert.ok(fs.existsSync(path.join(games, url)), file + ' ' + name + ': ' + url);
            });
        });
        // Minesweeper's tile beeps are some 30 dB louder than the card games' sounds: never per hit
        assert.ok(!/Minesweeper_Tile/i.test(src), file + ' plays a Minesweeper tile beep');
    });
});

console.log('vista arcade: ' + passed + ' tests passed');
