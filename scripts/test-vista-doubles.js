#!/usr/bin/env node
// Doubles (Yozora #836): the rules of public/scripts/comp/desktop-apps/vista-games/doubles.js, and
// that the phone's copy (public/scripts/comp/wmDoubles.js) is the same text.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'scripts', 'comp');
const R = require(path.join(dir, 'desktop-apps', 'vista-games', 'doubles.js'));

const board = (n, vals) => {
    const g = { n, goal: R.GOALS[n], cells: vals.map((v, i) => (v ? { id: i + 1, v } : null)), score: 0, moves: 0, top: Math.max(...vals), joined: 0, won: false, over: false, nextId: 100 };
    return g;
};
const row = (g, r) => g.cells.slice(r * g.n, r * g.n + g.n).map((t) => (t ? t.v : 0));
const fixed = (at) => { let i = 0; const seq = [at, 0]; return () => seq[i++ % 2]; }; // spawn in the first free cell, a 2

// a tile joins once a move, nearest the wall first
{
    const g = board(4, [2, 2, 2, 2, 4, 0, 4, 0, 2, 4, 2, 0, 0, 0, 0, 0]);
    const r = R.move(g, 'left', () => 0.999); // the new tile in the last free square
    assert.deepStrictEqual(row(g, 0), [4, 4, 0, 0]);
    assert.deepStrictEqual(row(g, 1), [8, 0, 0, 0]);
    assert.deepStrictEqual(row(g, 2), [2, 4, 2, 0]);
    assert.strictEqual(r.gained, 16);
    assert.strictEqual(g.score, 16);
    assert.strictEqual(r.merges.length, 3);
    assert.ok(r.spawn && g.cells[r.spawn.at] === r.spawn.tile);
}
{
    const g = board(4, [4, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    R.move(g, 'right', fixed(0));
    assert.deepStrictEqual(row(g, 0).slice(2), [4, 4]);
}
// up and down work on columns
{
    const g = board(3, [2, 0, 4, 2, 0, 4, 8, 0, 0]);
    R.move(g, 'down', fixed(0));
    assert.deepStrictEqual([g.cells[3].v, g.cells[6].v, g.cells[8].v], [4, 8, 8]);
}
// nothing moves: no move, no new tile
{
    const g = board(4, [2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.strictEqual(R.move(g, 'left', Math.random), null);
    assert.strictEqual(g.moves, 0);
    assert.strictEqual(g.cells.filter(Boolean).length, 4);
}
// the goal is reported once; the game goes on
{
    const g = board(4, [1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = R.move(g, 'left', fixed(0));
    assert.ok(r.reached && g.won && !g.over);
    g.cells[1] = { id: 500, v: 2048 };
    assert.strictEqual(R.move(g, 'left', fixed(0)).reached, false);
}
// the small board's goal is 256
assert.strictEqual(R.createGame(3, Math.random).goal, 256);
// full board, no neighbours alike: over
{
    const g = board(4, [8, 16, 8, 16, 16, 8, 16, 8, 8, 16, 8, 32, 64, 128, 256, 0]);
    const r = R.move(g, 'right', Math.random);
    assert.ok(r.over && g.over && !R.canMove(g));
    assert.strictEqual(R.move(g, 'left', Math.random), null);
}
// random games always end, never with a move left, and the sum of the tiles only grows by the new tile
{
    const rnd = R.mulberry32(11);
    for (let k = 0; k < 60; k++) {
        const g = R.createGame(R.SIZES[k % 3], rnd);
        let guard = 0;
        while (!g.over && guard++ < 20000) {
            const before = g.cells.reduce((a, t) => a + (t ? t.v : 0), 0);
            const dir = R.DIRS.find((d) => R.move(R.cloneGame(g), d, R.mulberry32(1)));
            const r = R.move(g, dir, rnd);
            assert.strictEqual(g.cells.reduce((a, t) => a + (t ? t.v : 0), 0), before + r.spawn.tile.v);
            assert.strictEqual(new Set(g.cells.filter(Boolean).map((t) => t.id)).size, g.cells.filter(Boolean).length);
        }
        assert.ok(g.over && !R.canMove(g));
        assert.ok(R.validGame(g));
    }
}
// the phone carries the same rules
{
    const cut = (file, from, to) => { const s = fs.readFileSync(file, 'utf8'); return s.slice(s.indexOf(from), s.indexOf(to)).replace(/^.*\n/, ''); };
    const desk = cut(path.join(dir, 'desktop-apps', 'vista-games', 'doubles.js'), '    // ---- rules', '    const cloneGame');
    const phone = cut(path.join(dir, 'wmDoubles.js'), '    // ---- rules', '    function validGame');
    assert.ok(desk.length > 2000 && phone.trim() === desk.trim(), 'wmDoubles.js rules differ from doubles.js');
}
console.log('doubles: ok');
