#!/usr/bin/env node
/*
 * Purble Place's pure rules (public/scripts/comp/desktop-apps/vista-games/purbleRules.js, Yozora #609):
 * Purble Pairs' deck / matching / scoring, Comfy Cakes' orders and cake building, Purble Shop's
 * feedback counts. Card catalogue and levels come from the game's own XML (the converted pack).
 *
 *   node scripts/test-vista-purble.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'desktop-apps', 'vista-games', 'purbleRules.js'));
const data = require(path.join(__dirname, '..', 'public', 'static_images', 'vista-games', 'purble', 'data.json'));

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('ok   ' + name);
    } catch (err) {
        console.log('FAIL ' + name);
        console.log('     ' + (err && err.message));
        process.exitCode = 1;
    }
}

// a seeded Math.random stand-in
function rng(seed) {
    let x = seed >>> 0;
    return () => {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        return x / 4294967296;
    };
}

const child = (n, t) => (n && n.c ? n.c.find((k) => k.t === t) : null);
const children = (n, t) => (n && n.c ? n.c.filter((k) => !t || k.t === t) : []);
const text = (n, t) => { const c = child(n, t); return c && c.v !== undefined ? String(c.v) : ''; };

// ---- Purble Pairs ----------------------------------------------------------------------------
const cards = children(data.xml['UI_CONCENTRATION_CARDS.XML'], 'Card')
    .map((c) => ({ id: +text(c, 'id'), type: +text(c, 'type'), chef: /true|1/i.test(text(c, 'chefitem')), path: text(c, 'path') }))
    .filter((c) => data.xml[c.path.toUpperCase().replace(/[\\/]+/g, '_')]);
const typeOf = (id) => (cards.find((c) => c.id === id) || {}).type;
const modes = children(child(data.xml['UI_CONCENTRATION_CONCENTRATIONGAME.XML'], 'DifficultyModes')).map((m) => ({
    cols: +text(m, 'NumCols'), rows: +text(m, 'NumRows'), tricky: +text(m, 'NumTricky') || 0, superTricky: +text(m, 'NumSuperTricky') || 0,
    levels: children(child(m, 'Levels'), 'Level').map((l) => text(l, 'CardPairs'))
}));

test('pairs: every level of every difficulty fills its board with pairs (an odd board gets one joker)', () => {
    modes.forEach((m, d) => m.levels.forEach((pairs, li) => {
        const cells = m.cols * m.rows;
        const deck = R.pairsDeck({ pairs, tricky: m.tricky, superTricky: m.superTricky }, cells, cards, rng(d * 10 + li + 1));
        assert.strictEqual(deck.length, cells, `difficulty ${d} level ${li}: ${deck.length} cards for ${cells} cells`);
        const counts = {};
        deck.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
        Object.entries(counts).forEach(([id, n]) => {
            if (typeOf(+id) === 8) return; // jokers pair with anything
            assert.strictEqual(n % 2, 0, `difficulty ${d} level ${li}: card ${id} appears ${n} times`);
        });
        if (cells % 2) assert.ok(deck.some((id) => typeOf(id) === 8), 'the odd board has a joker');
    }));
});

test('pairs: Beginner uses only plain pictures, Advanced adds look-alikes', () => {
    const beg = modes[0];
    const deck = R.pairsDeck({ pairs: beg.levels[0], tricky: beg.tricky, superTricky: beg.superTricky }, 25, cards, rng(7));
    assert.ok(deck.every((id) => typeOf(id) === 0 || typeOf(id) === 8), 'beginner: plain + joker only');
    const adv = modes[2];
    const deck2 = R.pairsDeck({ pairs: adv.levels[0], tricky: adv.tricky, superTricky: adv.superTricky }, 64, cards, rng(9));
    assert.ok(deck2.some((id) => typeOf(id) === 4 || typeOf(id) === 5), 'advanced has tricky cards');
    assert.ok(deck2.some((id) => typeOf(id) === 6) && deck2.some((id) => typeOf(id) === 3), 'advanced has a clock and a mixer pair');
});

test('pairs: matching', () => {
    const plain = cards.find((c) => c.type === 0).id;
    const other = cards.filter((c) => c.type === 0)[1].id;
    const joker = cards.find((c) => c.type === 8).id;
    assert.strictEqual(R.pairsMatch(plain, plain, typeOf), 'match');
    assert.strictEqual(R.pairsMatch(plain, other, typeOf), 'miss');
    assert.strictEqual(R.pairsMatch(joker, other, typeOf), 'joker');
});

test('pairs: score (Ranks.xml flip and time bonuses, rank)', () => {
    // a perfect beginner game: 24 matched tiles turned 24 times
    const a = R.pairsScore({ difficulty: 0, timed: false, points: 120, tilesTurned: 25, tilesMatched: 25, secondsLeft: 0, totalSeconds: 0 });
    assert.strictEqual(a.flipBonus, 2300);
    assert.strictEqual(a.timeBonus, 0);
    assert.strictEqual(a.final, 2420);
    assert.strictEqual(a.rank, 4); // Purble Master (BeginnerUntimed >= 2000)
    // intermediate, timed, 2.2 turns per tile, 40 % of the time left
    const b = R.pairsScore({ difficulty: 1, timed: true, points: 180, tilesTurned: 79, tilesMatched: 36, secondsLeft: 84, totalSeconds: 210 });
    assert.strictEqual(b.flipBonus, 1500);
    assert.strictEqual(b.timeBonus, 600);
    assert.strictEqual(b.final, 2280);
    assert.strictEqual(b.rank, 2);
});

// ---- Comfy Cakes -------------------------------------------------------------------------------
test('cakes: an order has the difficulty\'s layers and toppings', () => {
    for (let d = 0; d < 3; d++) {
        const o = R.cakeOrder(d, rng(d + 3));
        assert.strictEqual(o.layers.length, [1, 2, 3][d]);
        assert.strictEqual(o.fillings.length, o.layers.length - 1);
        assert.ok(o.deco >= 0 && o.deco <= 3);
        if (d < 2) assert.ok(o.icing >= 0 && !o.final, 'Beginner / Intermediate: icing + decoration');
    }
    // Advanced (GenerateCorrectCake): half without icing, half with a final touch; glaze only on
    // icing; a heart cake takes only the heart or the gumdrops
    const adv = [];
    for (let seed = 1; seed < 400; seed++) adv.push(R.cakeOrder(2, rng(seed * 7 + 1)));
    const share = (f) => adv.filter(f).length / adv.length;
    assert.ok(Math.abs(share((o) => o.icing < 0) - 0.5) < 0.12, 'about half the Advanced cakes have no icing');
    assert.ok(Math.abs(share((o) => !!o.final) - 0.5) < 0.12, 'about half have a final touch');
    assert.ok(adv.every((o) => o.final !== 'glaze' || o.icing >= 0), 'glaze only on icing');
    assert.ok(adv.concat([0, 1].map((d) => R.cakeOrder(d, rng(d + 40)))).every((o) => o.shape !== 2 || o.deco === 0 || o.deco === 2), 'heart cakes: heart or gumdrops');
});

// build `order` with the tool types the buttons send
function build(order) {
    const steps = [];
    order.layers.forEach((b, i) => {
        steps.push(R.T.PAN + order.shape, R.T.BATTER + b);
        if (i < order.fillings.length) steps.push(R.T.FILLING + order.fillings[i]);
    });
    if (order.icing >= 0) steps.push(R.T.ICING + order.icing);
    if (order.final === 'sugar') steps.push(R.T.SUGAR);
    if (order.deco >= 0) steps.push(R.T.DECO + order.deco);
    if (order.final === 'glaze') steps.push(R.T.GLAZE);
    return steps;
}

test('cakes: following the order builds a matching cake in the minimum moves', () => {
    for (let d = 0; d < 3; d++) {
        for (let seed = 1; seed < 20; seed++) {
            const order = R.cakeOrder(d, rng(seed * 31 + d));
            let cake = null;
            build(order).forEach((t) => {
                const r = R.cakeApply(cake, t, true);
                assert.ok(r.ok, `step ${t} refused: ${r.tip}`);
                assert.ok(R.cakeOnTrack(r.cake, order), 'still on track');
                cake = r.cake;
            });
            assert.ok(R.cakeMatches(cake, order), 'matches');
            assert.strictEqual(cake.steps, R.cakeMinMoves(order));
        }
    }
});

test('cakes: illegal moves are refused with their tips', () => {
    const tip = (cake, t, paper) => R.cakeApply(cake, t, paper === undefined ? true : paper).tip;
    assert.strictEqual(tip(null, R.T.PAN, false), 'NeedWaxPaper');
    assert.strictEqual(tip(null, R.T.BATTER), 'IllegalMoveBatterOnEmpty');
    const pan = R.cakeApply(null, R.T.PAN + 1, true).cake;
    assert.strictEqual(tip(pan, R.T.PAN), 'GamePlayDoubleCakePan');
    assert.strictEqual(tip(pan, R.T.ICING), 'IllegalMoveIcingOnPanOrEmpty');
    assert.strictEqual(tip(pan, R.T.FILLING), 'IllegalMoveFillingOnPanOrEmpty');
    assert.strictEqual(tip(pan, R.T.DECO), 'IllegalMoveDecorationsOnPanOrEmpty');
    const layer = R.cakeApply(pan, R.T.BATTER, true).cake;
    assert.strictEqual(tip(layer, R.T.BATTER + 2), 'IllegalMoveBatterOnBatter');
    assert.strictEqual(tip(layer, R.T.GLAZE), 'IllegalMoveGlazeNoIcing');
    // a second layer needs its own pan: batter on a filling is refused, a pan goes on it
    const filled = R.cakeApply(layer, R.T.FILLING, true).cake;
    assert.strictEqual(R.cakeApply(filled, R.T.BATTER, true).ok, false);
    assert.ok(R.cakeApply(filled, R.T.PAN + 1, true).ok);
    assert.strictEqual(tip(R.cakeApply(filled, R.T.PAN + 1, true).cake, R.T.ICING), 'IllegalMoveIcingOnPanOrEmpty');
    // GetLayerOperation: a decoration replaces the decoration; icing strips the layer to its batter
    const deco = R.cakeApply(R.cakeApply(layer, R.T.ICING, true).cake, R.T.DECO, true).cake;
    const deco2 = R.cakeApply(deco, R.T.DECO + 1, true);
    assert.ok(deco2.ok && deco2.cake.deco === 1 && deco2.cake.icing === 0);
    const reiced = R.cakeApply(deco2.cake, R.T.ICING + 2, true).cake;
    assert.ok(reiced.icing === 2 && reiced.deco === -1);
    assert.strictEqual(R.cakeApply(filled, R.T.ICING + 1, true).cake.fillings.length, 0, 'icing replaces the top filling');
    assert.strictEqual(tip(R.cakeApply(layer, R.T.SUGAR, true).cake, R.T.GLAZE), 'IllegalMoveGlazeNoIcing');
});

test('cakes: a wrong part takes the cake off track and it does not match', () => {
    const order = { shape: 0, layers: [1], fillings: [], icing: 2, deco: 3, final: null };
    let c = R.cakeApply(null, R.T.PAN, true).cake;
    c = R.cakeApply(c, R.T.BATTER + 0, true).cake; // chocolate, not strawberry
    assert.ok(!R.cakeOnTrack(c, order));
    c = R.cakeApply(R.cakeApply(c, R.T.ICING + 2, true).cake, R.T.DECO + 3, true).cake;
    assert.ok(!R.cakeMatches(c, order));
});

test('cakes: score and efficiency (ComfyCakesVars.xml)', () => {
    assert.strictEqual(R.cakeEfficiency(0, 20, 20), 1600);
    assert.strictEqual(R.cakeEfficiency(0, 24, 20), 900); // 20 % over
    assert.strictEqual(R.cakeEfficiency(0, 21, 20), 1250); // over the minimum: the 10 % row
    assert.strictEqual(R.cakeEfficiency(2, 40, 20), 30);
    assert.strictEqual(R.cakeEfficiency(2, 41, 20), 0); // past twice the minimum
    const s = R.cakeScore({ difficulty: 1, right: 5, wrong: 1, moves: 40, minMoves: 40 });
    assert.strictEqual(s.rightScore, 250);
    assert.strictEqual(s.wrongPenalty, -50);
    assert.strictEqual(s.efficiency, 2000);
    assert.strictEqual(s.final, 2200);
    assert.strictEqual(s.rank, 4); // Master Chef from 2000 (Intermediate)
    assert.strictEqual(R.cakeScore({ difficulty: 1, right: 5, wrong: 1, moves: 40, minMoves: 40, singleCake: true }).efficiency, 1900);
    assert.strictEqual(R.cakeScore({ difficulty: 0, right: 0, wrong: 3, moves: 99, minMoves: 20 }).final, -30, 'no floor at 0');
    assert.strictEqual(R.cakeMinMoves({ layers: [0, 1], fillings: [2], icing: 1, deco: 0, final: null }), 7, 'a pan per layer');
});

// ---- Purble Shop -------------------------------------------------------------------------------
test('shop: feedback counts (right colour right feature / right colour wrong feature)', () => {
    const fb = R.shopFeedback;
    assert.deepStrictEqual(fb([0, 1, 2], [0, 1, 2]), { rcrf: 3, rcwf: 0 });
    assert.deepStrictEqual(fb([0, 1, 2], [2, 0, 1]), { rcrf: 0, rcwf: 3 });
    assert.deepStrictEqual(fb([0, 0, 1], [0, 1, 1]), { rcrf: 2, rcwf: 0 });
    assert.deepStrictEqual(fb([0, 0, 1, 3], [1, 1, 0, 3]), { rcrf: 1, rcwf: 2 });
    assert.deepStrictEqual(fb([4, 4, 4, 4, 4], [0, 1, 2, 3, 4]), { rcrf: 1, rcwf: 0 });
    assert.deepStrictEqual(fb([2, 3, 4, 0, 1], [1, 2, 3, 4, 0]), { rcrf: 0, rcwf: 5 });
});

test('shop: hidden looks use the difficulty\'s features and colours', () => {
    for (let d = 0; d < 3; d++) {
        const h = R.shopHidden(d, rng(d + 11));
        assert.strictEqual(h.length, [3, 4, 5][d]);
        assert.ok(h.every((c) => c >= 0 && c < d + 3));
    }
});

test('shop: score bonus for few guesses and hints', () => {
    // BAPConstants' tables (PurblePlace.exe)
    const s = R.shopScore({ difficulty: 0, guesses: 3, hints: 1, points: 130 });
    assert.strictEqual(s.total, 4);
    assert.strictEqual(s.bonus, 400);
    assert.strictEqual(s.final, 530);
    assert.strictEqual(s.rank, 0);
    assert.strictEqual(R.shopScore({ difficulty: 1, guesses: 7, hints: 2, points: 100 }).bonus, 200);
    assert.strictEqual(R.shopScore({ difficulty: 2, guesses: 1, hints: 0, points: 150 }).final, 6150);
    assert.strictEqual(R.shopScore({ difficulty: 2, guesses: 1, hints: 0, points: 150 }).rank, 4);
    assert.strictEqual(R.shopScore({ difficulty: 0, guesses: 16, hints: 0, points: 260 }).bonus, 0);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
