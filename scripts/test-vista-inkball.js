#!/usr/bin/env node
/**
 * InkBall tests (Yozora #609): the IKL 20001 board format and the difficulty lists, and the rules
 * public/scripts/comp/desktop-apps/vista-games/inkball.js takes from inkball.exe: ball movement
 * and bounces (edge, walls, ink, other balls), holes (scoring, the wrong colour, grey holes),
 * breakable / coloured / one-way walls, chevrons, the clock and the launches, wall tiles, the end
 * of a board and the bonus boards.
 *
 *   node scripts/test-vista-inkball.js
 */
const fs = require('fs');
const path = require('path');

require(path.join(__dirname, '../public/scripts/comp/desktop-apps/vista-games/inkball.js'));
const core = globalThis.VistaInkBallCore;
const BIN = path.join(__dirname, '../public/static_images/vista-games/inkball/boards.bin');

let failed = 0;
const check = (name, ok, detail) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
    if (!ok) failed++;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

// ---- the board resource ----------------------------------------------------------------------
const bin = fs.readFileSync(BIN);
const boards = core.parseBoards(bin);
check('551 boards', boards.length === 551, boards.length);
let consumed = 0;
for (let p = 0; p + 2 <= bin.length;) {
    const len = (bin[p] << 8 | bin[p + 1]) + 2;
    consumed += len;
    p += len;
}
// the resource ends in one byte of padding
check('the length fields walk the whole resource', consumed === bin.length - 1 && bin[bin.length - 1] === 0, consumed + ' / ' + bin.length);
check('every board has 17 x 17 cells', boards.every((b) => b.cells.length === 289));
check('every cell type is one the game builds', boards.every((b) => b.cells.every((v) => (v >> 12) <= 10)));
check('every breakable wall carries the cell under it', boards.every((b) => b.cells.every((v, k) => (v >> 12) !== 4 || b.under[k] !== undefined)));
check('speeds are 50..300 px/s, min <= max', boards.every((b) => b.minSpeed >= 50 && b.maxSpeed <= 300 && b.minSpeed <= b.maxSpeed));
check('at most 64 queued balls, colours 0..4', boards.every((b) => b.balls.length <= 64 && b.balls.every((c) => c <= 4)));
let next = 0;
const lists = [];
core.DIFFICULTIES.forEach((d) => { lists.push(d.main, d.bonus); });
check('the difficulty lists cover the boards in order', lists.every((l) => {
    const ok = l[0] === next;
    next += l[1];
    return ok;
}) && next === 551);
check('board 0: 120 s, a ball every 4 s, 50..150 px/s, shuffled orange + blue',
    boards[0].time === 120 && boards[0].launch === 4 && boards[0].minSpeed === 50 && boards[0].maxSpeed === 150 && boards[0].shuffle && boards[0].balls.join() === '1,2');
// board 65 is the Beginner board captured on the VM: launcher at (9, 9), orange hole at (2, 2),
// blue hole at (11, 11)
const b65 = boards[65];
check('board 65 as on the VM', b65.cells[9 * 17 + 9] === 0x1fff && b65.cells[2 * 17 + 2] === 0x2001 && b65.cells[11 * 17 + 11] === 0x2002 && b65.time === 120);
check('board 489 (Expert): 79 s, 12 green balls, 240..300 px/s', boards[489].time === 79 && boards[489].balls.length === 12 && boards[489].balls.every((c) => c === 3) && boards[489].minSpeed === 240);
check('the bonus boards have no time limit', [138, 139, 141, 264, 534].every((i) => boards[i].time === 0));

// ---- helpers ---------------------------------------------------------------------------------
check('rim points of a 24 px ball', JSON.stringify(core.ballPoints(24).slice(0, 9)) === '[[-12,0],[-11,-2],[-11,-4],[-9,-6],[-8,-8],[-6,-9],[-4,-11],[-2,-11],[0,-12]]');
check('rim points are symmetric', core.ballPoints(24).every((p, i, a) => a[(16 + i) % 32][0] === -p[0] && a[(16 + i) % 32][1] === -p[1]));
check('Round() floors every negative fraction', core.round(-0.75) === -1 && core.round(-0.2) === -1 && core.round(0.4) === 0 && core.round(0.5) === 1 && core.round(-3) === -3);

// a custom board: grey walls round the edge, cells { 'col,row': value }
function board(cells, opts) {
    const b = Object.assign({ index: -1, time: 120, launch: 4, minSpeed: 100, maxSpeed: 100, shuffle: false, balls: [], cells: [], under: [] }, opts || {});
    for (let r = 0; r < 17; r++) {
        for (let c = 0; c < 17; c++) b.cells.push(r === 0 || c === 0 || r === 16 || c === 16 ? 0x3000 : 0);
    }
    Object.entries(cells || {}).forEach(([k, v]) => {
        const [c, r] = k.split(',').map(Number);
        if (Array.isArray(v)) {
            b.cells[r * 17 + c] = v[0];
            b.under[r * 17 + c] = v[1];
        } else b.cells[r * 17 + c] = v;
    });
    return b;
}
function game(cells, opts, extra) {
    const kills = [];
    const g = new core.Game(Object.assign({ boards, rng: () => 0.5, onKill: (r) => kills.push(r) }, extra || {}));
    g.loadBoard(board(cells, opts));
    g.kills = kills;
    return g;
}
// a live ball at native (x, y) (top left) with a velocity
function put(g, color, x, y, vx, vy) {
    const b = g.addBall(color, false);
    b.alive = true;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    g.queue.left = 0; // no launches
    return b;
}
const run = (g, ms) => { for (let t = 0; t < ms; t += 16) g.update(16); };

// ---- movement and bounces ------------------------------------------------------------------
{
    const g = game({});
    const b = put(g, 1, 200, 300, 100, 0);
    run(g, 160);
    check('a ball moves at its speed (100 px/s for 0.16 s)', near(b.x, 216, 0.01), b.x);
}
{
    const g = game({});
    g.grid = g.grid.map((t) => (t.kind === 'wall' ? Object.assign(t, { kind: 'floor', bmp: 0 }) : t)); // open edge
    const b = put(g, 1, 3, 300, -100, 0);
    run(g, 100);
    check('the board edge bounces a ball', b.vx > 0 && b.x >= 0, b.vx);
}
{
    const g = game({ '10,8': 0x3000 });
    const b = put(g, 1, 280, 8 * 32 + 42 + 4, 100, 0); // rolling right into the wall at x 320
    run(g, 600);
    check('a grey wall bounces a ball straight back', b.vx < 0 && near(b.vy, 0, 1e-9) && b.x + b.w <= 320, b.vx + ', ' + b.vy);
    check('a grey wall keeps the colour', b.color === 1);
}
{
    const g = game({ '10,8': 0x3003 });
    const b = put(g, 1, 280, 8 * 32 + 42 + 4, 100, 0);
    run(g, 600);
    check('a coloured wall paints the ball (orange -> green)', b.color === 3 && b.vx < 0);
}
{
    const g = game({});
    const a = put(g, 1, 200, 300, 100, 0);
    const c = put(g, 2, 260, 300, -100, 0);
    run(g, 400);
    check('two balls meeting head on swap their velocities', a.vx < 0 && c.vx > 0 && near(a.vx, -100, 1e-6), a.vx + ', ' + c.vx);
}
{
    const g = game({});
    const b = put(g, 1, 200, 200, 0, 100);
    g.strokes.push({ points: [[150, 260], [300, 260]] });
    run(g, 600);
    check('ink bounces a ball', b.vy < 0, b.vy);
    check('the stroke a ball hits disappears', g.strokes.length === 0);
}
{
    const g = game({});
    for (let i = 0; i < 25; i++) {
        g.beginStroke(100 + i, 100);
        g.extendStroke(120 + i, 120);
        g.endStroke();
    }
    check('at most 20 strokes (the oldest goes)', g.strokes.length === 20 && g.strokes[0].points[0][0] === 105);
}

// ---- holes ---------------------------------------------------------------------------------
const hole = (col, row, color) => ({
    [col + ',' + row]: 0x2000 | color,
    [(col + 1) + ',' + row]: 0x2010 | color,
    [col + ',' + (row + 1)]: 0x2020 | color,
    [(col + 1) + ',' + (row + 1)]: 0x2030 | color
});
// the hole at cols 8-9, rows 8-9: centre (288, 42 + 288)
const hx = 288;
const hy = 42 + 288;
{
    const g = game(hole(8, 8, 2));
    const b = put(g, 2, hx - 12 - 60, hy - 12, 80, 0);
    let shrank = false;
    for (let t = 0; t < 3000 && b.alive; t += 16) {
        g.update(16);
        if (b.w < 24) shrank = true;
    }
    check('a hole pulls a ball in and shrinks it', shrank);
    check('the right colour scores (blue 400)', !b.alive && g.score === 400, g.score);
    check('the last ball ends the board', g.state === 'complete');
}
{
    const g = game(hole(8, 8, 1));
    put(g, 2, hx - 12 - 60, hy - 12, 80, 0);
    run(g, 3000);
    check('the wrong colour is game over (KillPlayer 1)', g.kills.join() === '1' && g.state === 'dead' && g.score === 0);
}
{
    const g = game(hole(8, 8, 0));
    const b = put(g, 4, hx - 12 - 60, hy - 12, 80, 0);
    put(g, 1, 40, 60, 0, 0); // a second ball keeps the board going
    run(g, 3000);
    check('a grey hole takes any colour for no points', !b.alive && g.score === 0 && g.kills.length === 0 && g.state === 'play');
}
{
    const g = game(hole(8, 8, 3));
    const b = put(g, 0, hx - 12 - 60, hy - 12, 80, 0);
    put(g, 1, 40, 60, 0, 0);
    run(g, 3000);
    check('a grey ball goes into any hole for no points', !b.alive && g.score === 0 && g.kills.length === 0);
}
check('points by ball colour', core.BALL_POINTS.join() === '0,200,400,800,1600');

// ---- special tiles ---------------------------------------------------------------------------
{
    const g = game({ '10,8': [0x4000, 0] });
    const b = put(g, 3, 280, 8 * 32 + 42 + 4, 100, 0);
    run(g, 600);
    check('a grey breakable wall breaks for any ball (+10)', g.grid[8 * 17 + 10].kind === 'floor' && g.score === 10 && b.vx < 0);
}
{
    const g = game({ '10,8': [0x4002, 0x8030] });
    put(g, 3, 280, 8 * 32 + 42 + 4, 100, 0);
    run(g, 600);
    check('a blue breakable wall holds against green', g.grid[8 * 17 + 10].kind === 'break' && g.score === 0);
    const h = game({ '10,8': [0x4002, 0x8030] });
    put(h, 2, 280, 8 * 32 + 42 + 4, 100, 0);
    run(h, 600);
    check('... breaks for blue and leaves the cell under it (a chevron)', h.grid[8 * 17 + 10].kind === 'chevron' && h.score === 10);
}
{
    const g = game({ '8,8': 0x8030 });
    const b = put(g, 1, 8 * 32 + 4, 8 * 32 + 42 + 4, 0, 0);
    run(g, 32);
    check('a right chevron speeds a ball right (3 px/s per 4 ms step)', b.vx > 0 && near(b.vx % 3, 0), b.vx);
    const h = game({ '8,8': 0x8000 });
    const c = put(h, 1, 8 * 32 + 4, 8 * 32 + 42 + 4, 0, -399);
    run(h, 8);
    check('chevrons stop at 400 px/s', c.vy === -400, c.vy);
}
{
    // one-way, bar on top (arrow up): a ball from above bounces, from below passes
    const g = game({ '8,8': 0x5000 });
    const down = put(g, 1, 8 * 32 + 4, 8 * 32 + 42 - 40, 0, 100);
    run(g, 600);
    check('a one-way tile stops a ball from its bar side', down.vy < 0, down.vy);
    const h = game({ '8,8': 0x5000 });
    const up = put(h, 1, 8 * 32 + 4, 9 * 32 + 42 + 10, 0, -100);
    run(h, 900);
    check('... and lets one through the other way', up.vy < 0 && up.y < 8 * 32 + 42, up.y);
}
{
    // a blue bar: blue passes, orange bounces
    const g = game({ '8,8': 0xa002 });
    const blue = put(g, 2, 8 * 32 + 4, 8 * 32 + 42 - 40, 0, 100);
    run(g, 900);
    check('a coloured bar lets its colour through', blue.vy > 0 && blue.y > 9 * 32 + 42, blue.y);
    const h = game({ '8,8': 0xa002 });
    const orange = put(h, 1, 8 * 32 + 4, 8 * 32 + 42 - 40, 0, 100);
    run(h, 900);
    check('... and bounces the others', orange.vy < 0, orange.vy);
}
{
    // a coloured wall raised (frame 4) goes down when a ball of its colour is sunk
    const g = game(Object.assign(hole(8, 8, 2), { '3,3': 0x7042 }));
    put(g, 2, hx - 12 - 60, hy - 12, 80, 0);
    put(g, 1, 40, 460, 0, 0);
    const w = g.grid[3 * 17 + 3];
    check('a raised coloured wall bounces balls', g.care(w, g.balls[1], null) === 2);
    run(g, 3000);
    check('sinking its colour lowers it frame by frame', w.frame === 0 && g.care(w, g.balls[1], null) === 0, w.frame);
}
{
    // a grey timed wall: up 1 s, down 1 s (a = b = 1), starting raised
    const g = game({ '3,3': 0x6114 });
    put(g, 1, 400, 400, 0, 0);
    const w = g.grid[3 * 17 + 3];
    const seen = new Set();
    for (let t = 0; t < 5000; t += 16) {
        g.update(16);
        seen.add(w.frame);
    }
    check('a timed wall goes down and up again', seen.has(0) && seen.has(4));
}

// ---- clock, launches, tiles, the end of a board ------------------------------------------------
{
    const g = game({ '8,8': 0x1fff }, { balls: [1, 2, 3], launch: 2, time: 30 });
    g.update(16);
    check('the queue holds the coming balls', g.queue.slots.filter((s) => s.alive).length === 3);
    run(g, 2000);
    check('the queue slides to x 6, 24, 42', g.queue.slots.slice(0, 3).map((s) => Math.round(s.x)).join() === '6,24,42');
    check('the clock waits for the first ball', g.clock.time === 30000 && !g.clock.started);
    run(g, 2100);
    check('the first ball goes 4 s after the board appears', g.balls[0].alive && g.queue.left === 2 && g.clock.started);
    const b = g.balls[0];
    check('a launched ball sits on the launcher and moves at the board speed', near(Math.hypot(b.vx, b.vy), 100, 1e-6));
    run(g, 2000);
    check('the next ball follows the launch interval', g.balls[1].alive && g.queue.left === 1);
}
{
    const g = game({ '8,8': 0x1fff }, { balls: [1], time: 5 });
    run(g, 4100 + 5000);
    check('the clock running out is game over (KillPlayer 0)', g.kills.join() === '0');
}
{
    const g = game({});
    g.score = 3300;
    g.countTiles();
    check('a wall tile every 1600 points', g.tiles === 2);
    check('the right button drops a grey wall on empty floor', g.dropWall(200, 200) && g.tileAt(200, 200).kind === 'wall' && g.tiles === 1);
    check('... not on a wall', !g.dropWall(5, 100));
}
{
    const g = game(hole(8, 8, 2), { time: 0 });
    const b = put(g, 2, hx - 12 - 60, hy - 12, 80, 0);
    run(g, 3000);
    check('a board without a clock ends straight into the next', !b.alive && g.state === 'complete');
    for (let t = 0; t < 100; t += 16) g.completeStep(21);
    check('... then waits (1.5 s) for the next board', g.state === 'wait' && g.level === 1);
}
{
    const g = game(hole(8, 8, 2), { time: 60 });
    g.clock.started = true;
    const b = put(g, 2, hx - 12 - 60, hy - 12, 80, 0);
    run(g, 3000);
    const left = Math.ceil(g.clock.time / 1000);
    const score = g.score;
    let steps = 0;
    while (g.state === 'complete' && steps < 1000) {
        g.completeStep(21);
        steps++;
    }
    check('the time left is added to the score, a point a (started) second', g.score === score + left, (g.score - score) + ' for ' + left + ' s');
    check('the gold pair went round the edge', steps > 17);
    g.level = 5;
    g.nextBoard();
    check('every fifth board is a bonus board', g.board.index >= 138 && g.board.index < 186, g.board.index);
    g.level = 1;
    g.nextBoard();
    check('the others come from the main list', g.board.index >= 0 && g.board.index < 138, g.board.index);
    check('a ball was sunk before', !b.alive);
}
{
    const g = new core.Game({ boards, rng: Math.random, difficulty: 4 });
    const seen = [];
    for (let i = 0; i < 30; i++) seen.push(g.pickBoard(false).index);
    check('Expert draws from its own boards', seen.every((i) => i >= 489 && i < 534));
    const recent = seen.slice(-10);
    check('a board is not drawn again within the last ten', recent.every((v, i) => recent.indexOf(v) === i));
}
{
    const g = game({});
    g.score = 777;
    g.tiles = 3;
    g.newGame();
    check('New Game starts from 0 points and no tiles', g.score === 0 && g.tiles === 0 && g.state === 'play' && g.kills.length === 0);
}

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
