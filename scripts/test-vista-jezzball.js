#!/usr/bin/env node
// JezzBall (Win 3.x, in the Vista games folder): the decompiled rules and the client's drawing,
// run headless (public/scripts/comp/desktop-apps/vista-games/jezzballReal.js, jezzballCore.js).
//
//   - the demo (seed 17, the recorded clicks) draws the same client, pixel for pixel, as the
//     original on the Vista VM: 57 VM frames matched with 0 different pixels across level 1 and
//     level 2 (2026-10-21); the frames' hashes at five of those ticks pin it here
//   - Turbo Pascal's Random and Real: the area sum drifts below n / 560, so one cell at a time
//     the level ends at 421 cells, not 420, and every exact 5% step reads one lower
//   - a half wall only starts on a free cell: a click on a ball starts the other half alone
//   - pixel -> cell, the bonus, level setup (balls, lives, time), the cheat skips the bonus
//
// Run: node scripts/test-vista-jezzball.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

global.window = undefined;
const dir = path.join(__dirname, '../public/scripts/comp/desktop-apps/vista-games');
require(path.join(dir, 'jezzballReal.js'));
require(path.join(dir, 'jezzballCore.js'));
const JZ = globalThis.JezzBallCore;
const R = JZ.Real;
const ART = path.join(__dirname, '../public/static_images/vista-games/jezzball');

let passed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed += 1;
    } catch (err) {
        console.error('FAIL ' + name);
        throw err;
    }
}

const hash = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 16);

(async () => {
    const { data, info } = await sharp(path.join(ART, 'sheet.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const sheet = { w: info.width, h: info.height, data: new Uint8ClampedArray(data) };
    const json = JSON.parse(fs.readFileSync(path.join(ART, 'jezzball.json'), 'utf8'));
    const font = JZ.fontFromJson(json.fonts.system);
    const sounds = [];
    const make = (opts) => {
        const g = new JZ.Game(Object.assign({ sheet, font, demoScript: json.demo, sound: (n) => sounds.push(n) }, opts));
        g.active = true;
        g.state = JZ.STATE.TITLE;
        return g;
    };

    await test('assets: the sheet and the System font', () => {
        assert.deepStrictEqual([sheet.w, sheet.h], [288, 24]);
        assert.strictEqual(font.height, 16);
        assert.strictEqual(font.width('Score: 0'), font.extent('Score: 0').w);
        assert.ok(json.demo.length === 122);
    });

    await test('Turbo Pascal Random', () => {
        const r = new JZ.TPRandom(17);
        const seq = [r.next(30), r.next(22), r.next(2), r.next(2)];
        // RandSeed = RandSeed * 134775813 + 1, result = Hi(RandSeed) * n shr 16
        let s = 17;
        const ref = [30, 22, 2, 2].map((n) => {
            s = (Math.imul(s, 134775813) + 1) >>> 0;
            return Math.floor((s >>> 16) * n / 65536);
        });
        assert.deepStrictEqual(seq, ref);
    });

    await test('the demo draws the VM frames', () => {
        const g = make();
        g.newGame(true);
        g.paint();
        // ticks counted from 1; hashes of frames that matched the VM's demo shots exactly
        const want = {
            9: ['a9dd0a4a8342923b', 1495, 2],
            47: ['bd4869ce7312c304', 1476, 2],
            288: ['46d5044207a5904c', 1359, 2],
            317: ['9cdd3be1a1bf02e9', 1747, 3],
            567: ['475bf6fe03609bf3', 1622, 3]
        };
        for (let t = 1; t <= 567; t++) {
            g.timer();
            if (want[t]) assert.deepStrictEqual([hash(g.surface.data), g.timeLeft, g.B], want[t], 'tick ' + t);
        }
    });

    await test('Real: one cell at a time the level needs 421 cells', () => {
        let area = R.fromInt(0);
        const at = {};
        for (let c = 1; c <= 560; c++) {
            area = R.add(R.div(R.fromInt(1), R.fromInt(560)), area);
            at[c] = { done: R.cmp(area, R.fromBytes(JZ.REAL_075)) >= 0, pct: R.trunc(R.mul(area, R.fromInt(100))) };
        }
        assert.strictEqual(at[420].done, false);
        assert.strictEqual(at[421].done, true);
        assert.strictEqual(at[420].pct, 74);
        assert.strictEqual(at[28].pct, 4);
        assert.strictEqual(at[560].pct, 99);
        assert.strictEqual(at[29].pct, 5);
        // one fill of 420 divides exactly
        assert.strictEqual(R.cmp(R.add(R.div(R.fromInt(420), R.fromInt(560)), R.fromInt(0)), R.fromBytes(JZ.REAL_075)), 0);
        assert.strictEqual(R.round(R.div(R.fromInt(7), R.fromInt(2))), 4);
    });

    await test('pixel -> cell', () => {
        assert.deepStrictEqual(JZ.Game.pixelToCell(24, 281), [2, 2]);
        assert.deepStrictEqual(JZ.Game.pixelToCell(470, 42), [29, 21]);
        // the original's +1: a cell's rightmost pixel column is the next cell's
        assert.deepStrictEqual(JZ.Game.pixelToCell(471, 42), [30, 21]);
        // left of the board the unsigned shift wraps out of range
        assert.ok(JZ.Game.pixelToCell(2, 100)[0] > 30);
    });

    await test('level setup: balls, lives, time', () => {
        const g = make();
        g.newGame(false);
        assert.strictEqual(g.B, 2);
        assert.strictEqual(g.lives, 2);
        assert.strictEqual(g.timeLeft, 1500);
        for (let i = 1; i <= g.B; i++) {
            const b = g.balls[i];
            assert.ok(b.x >= 2 && b.x <= 29 && b.y >= 2 && b.y <= 21);
            assert.strictEqual(g.ballAt(b.x, b.y), i);
        }
    });

    await test('a click on a ball starts the other half alone', () => {
        const g = make();
        g.newGame(false);
        const b = g.balls[1];
        // horizontal: red starts on the clicked cell, blue on the one to its right
        g.orientation = 0;
        g.arms[1] = { active: false };
        g.arms[2] = { active: false };
        // make the cell to the right free of the other ball
        if (g.ballAt(b.x + 1, b.y)) return;
        sounds.length = 0;
        g.click = { px: g.cellX(b.x) + 4, py: g.cellY(b.y) + 4 };
        g.processClick();
        assert.strictEqual(g.arms[1].active, false, 'no red half on the ball');
        assert.strictEqual(g.arms[2].active, true, 'the blue half starts');
        assert.deepStrictEqual([g.arms[2].x, g.arms[2].y], [b.x + 1, b.y]);
        assert.deepStrictEqual(sounds, [JZ.SND.GAP]);
    });

    await test('a half running to the border becomes wall and scores its cells', () => {
        const g = make();
        g.newGame(false);
        // move the balls out of the way: column 2..3 at the bottom
        for (let i = 1; i <= g.B; i++) {
            const b = g.balls[i];
            g.setBall(b.x, b.y, 0);
            b.x = 26 + i;
            b.y = 18;
            g.setBall(b.x, b.y, i);
        }
        g.orientation = 1;
        g.startArm(1, 5, 2, 0); // up from row 2, alone
        let ticks = 0;
        while (g.arms[1].active && ticks < 200) {
            g.armStep(1);
            if (g.arms[1].active) g.armMove(1);
            ticks++;
        }
        // 20 cells of wall at (B + 5) = 7 points each, and the 3 x 20 strip to its left is filled
        assert.strictEqual(R.round(g.score), 20 * 7 + 60 * 7);
        assert.strictEqual(R.trunc(R.mul(g.area, R.fromInt(100))), Math.floor(80 * 100 / 560));
    });

    await test('bonus: lives, the percent over 80 and 90, time left', () => {
        const g = make();
        g.newGame(false);
        g.lives = 2;
        g.timeLeft = 900;
        // 80.5% as the RTL sums it in one go
        g.area = R.div(R.fromInt(4508), R.fromInt(5600));
        g.endLevel();
        assert.strictEqual(g.bonusValue, 3500 + 175 + 900);
        assert.strictEqual(g.state, JZ.STATE.LEVEL_END);
    });

    await test('the cheat ends the level without a bonus', () => {
        const g = make();
        g.newGame(false);
        g.cheat();
        g.phase = 1;
        g.timer();
        assert.strictEqual(g.state, JZ.STATE.LEVEL_END);
        assert.strictEqual(g.bonusShown, false);
        assert.strictEqual(R.round(g.score), 0);
    });

    await test('Slow halves the points', () => {
        const g = make();
        g.newGame(false);
        g.speed = JZ.SLOW;
        g.addArea(1);
        assert.strictEqual(R.toNumber(g.score), 3.5);
    });

    console.log('test-vista-jezzball: ' + passed + ' passed');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
