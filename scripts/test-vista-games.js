#!/usr/bin/env node
// The Vista games' shared rules (Yozora #609), headless: the engine and the card table load into a
// stub window; the converted packs (public/static_images/vista-games/*/data.json) supply real data.
//   node scripts/test-vista-games.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'public/scripts/comp/desktop-apps/vista-games');
const DATA = (pack) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/static_images/vista-games', pack, 'data.json'), 'utf8'));

const memory = {};
const localStorage = { getItem: (k) => (k in memory ? memory[k] : null), setItem: (k, v) => { memory[k] = String(v); }, removeItem: (k) => { delete memory[k]; } };
const sandbox = { console, Math, Date, JSON, Promise, setTimeout, clearTimeout, localStorage, performance: { now: () => Date.now() } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['vistaGameEngine.js', 'cardEngine.js', 'freecell.js', 'mahjong.js', 'minesweeper.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(GAMES, f), 'utf8'), sandbox, { filename: f }));
const VG = sandbox.VistaGames;
const C = VG.Cards;

let passed = 0;
const test = (name, fn) => {
    fn();
    passed += 1;
    console.log('ok -', name);
};

test('FreeCell game #11850 deals as on the VM', () => {
    const S = 'CDSH';
    const R = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const cols = [[], [], [], [], [], [], [], []];
    Array.from(C.microsoftDeal(11850)).forEach(([suit, rank], i) => cols[i % 8].push(R[rank] + S[suit]));
    assert.deepStrictEqual(cols[0], ['10S', '5S', '7S', '5C', '2S', 'AD', 'KS']);
    assert.deepStrictEqual(cols[1], ['8H', '3D', '4D', '2C', '8D', 'AS', '6D']);
    assert.deepStrictEqual(cols[5], ['4H', 'QS', '4S', '2D', '10C', 'AH']);
    assert.strictEqual(new Set(C.microsoftDeal(1).map((c) => c.join())).size, 52);
});

test('menu labels: mnemonic and accelerator', () => {
    const l = VG.menuLabel('&New Game\tF2');
    assert.strictEqual(l.label, 'New Game');
    assert.strictEqual(l.mnemonic, 'N');
    assert.strictEqual(l.accel, 'F2');
});

test('animation scripts: steps, WaitForComplete, SendComplete', () => {
    const node = VG.child({ c: [DATA('minesweeper').xml['UI_ANIMATIONALPHAQUICKPULSE.XML']] }, 'Root') || DATA('minesweeper').xml['UI_ANIMATIONALPHAQUICKPULSE.XML'];
    const target = { alpha: 0 };
    const events = [];
    const a = new VG.Animator(node, target, { onEvent: (e) => events.push(e) });
    a.step(0);
    a.step(75);
    assert.ok(target.alpha > 100 && target.alpha < 160, 'halfway up: ' + target.alpha);
    a.step(10000);
    assert.strictEqual(target.alpha, 0);
    assert.ok(events.includes('PulseAlphaAnimationComplete'));
    assert.strictEqual(a.step(10001), false);
});

test('card table: Solitaire piles step every 10 cards, fans 7 / 23 px', () => {
    const layout = C.readLayout(DATA('cardgames').xml['LAYOUTS_SOLITAIRELAYOUT.XML']);
    const table = new C.CardTable({ invalidate() {} }, { decks: [{}] }, layout, {});
    const deck = table.stack('Deck');
    deck.cards = C.standardDeck(1).slice(0, 24);
    const pos = table.positions(deck);
    // (objects from the sandbox realm: compare the fields)
    assert.deepStrictEqual([pos[0].x, pos[0].y], [41, 24]);
    assert.deepStrictEqual([pos[23].x, pos[23].y], [45, 28]);
    const row = table.stack('Stack7');
    row.cards = C.standardDeck(1).slice(0, 7);
    row.cards[6].faceUp = true;
    row.cards[5].faceUp = true;
    const rp = table.positions(row);
    assert.strictEqual(rp[1].y - rp[0].y, 7);
    assert.strictEqual(rp[6].y - rp[5].y, 23);
});

test('Mahjong: six layouts of 144 tiles, every deal pairs every tile', () => {
    const data = DATA('mahjong');
    const pack = { xml: (p) => data.xml[VG.key(p)] || null };
    const rules = sandbox.VistaMahjongRules;
    const self = { pack, covers: rules.covers, free: rules.free };
    for (let i = 0; i < 6; i++) {
        const tiles = rules.loadLayout.call(self, i);
        assert.strictEqual(tiles.length, 144, 'layout ' + i);
        assert.ok(rules.deal.call(self, tiles), 'deal ' + i);
        const counts = {};
        tiles.forEach((t) => { counts[t.kind] = (counts[t.kind] || 0) + 1; });
        for (let f = 0; f < 34; f++) assert.strictEqual(counts[f], 4, 'kind ' + f);
        for (let f = 34; f < 42; f++) assert.strictEqual(counts[f], 1, 'kind ' + f);
        assert.ok(tiles.some((t) => self.free(t, tiles)));
    }
});

// a Mahjong game object over a dealt layout, without the window
const mahjongGame = (layout) => {
    const data = DATA('mahjong');
    const rules = sandbox.VistaMahjongRules;
    const self = Object.create(rules);
    Object.assign(self, {
        pack: { xml: (p) => data.xml[VG.key(p)] || null, string: (id) => String(id) },
        s: { tips: true, tileset: 0, animations: false },
        sounds: { play() {} },
        win: { stage: { invalidate() {} } },
        mode: 'play',
        ending: false,
        selected: null
    });
    self.tiles = rules.loadLayout.call(self, layout);
    rules.deal.call(self, self.tiles);
    return self;
};

test('Mahjong: Hint steps through the open pairs, then the selected tile\'s match', () => {
    const g = mahjongGame(1);
    const kind = (t) => (t.kind >= 34 && t.kind <= 37 ? 's' : (t.kind >= 38 ? 'f' : t.kind));
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
        g.hint();
        const [a, b] = g.hints.tiles;
        assert.ok(g.free(a) && g.free(b) && a !== b && kind(a) === kind(b));
        seen.add(a.i + ':' + b.i);
    }
    assert.ok(seen.size > 1, 'more than one pair offered');
    const free = g.remaining().filter((t) => g.free(t));
    const lone = free.find((t) => !free.some((o) => o !== t && kind(o) === kind(t)));
    const paired = free.find((t) => free.some((o) => o !== t && kind(o) === kind(t)));
    g.selected = paired;
    g.hint();
    assert.ok(g.hints.tiles.includes(paired));
    if (lone) {
        g.selected = lone;
        g.hints = null;
        g.hint();
        assert.strictEqual(g.hints, null);
        assert.strictEqual(g.tip.title, '64326');
    }
});

test('Mahjong: Undo does nothing while the last pair goes (the win is under way)', () => {
    const g = mahjongGame(0);
    g.history = [[g.tiles[0], g.tiles[1]]];
    g.ending = true;
    g.undo();
    assert.strictEqual(g.history.length, 1);
});

// a Minesweeper game object without the window: the statistics rules
const minesweeperGame = (difficulty) => {
    const self = Object.create(sandbox.VistaMinesweeperRules);
    Object.assign(self, { s: { difficulty }, boardDiff: difficulty, time: 12, state: 'playing' });
    return self;
};
const msStats = () => JSON.parse(memory['vistaGame:minesweeper'] || '{}').stats || {};

test('Minesweeper: custom boards keep no statistics; a game counts at its own level', () => {
    const g = minesweeperGame('custom');
    g.record(true);
    assert.deepStrictEqual(Object.keys(msStats()), []);
    // Options changed the level mid-game: the game in play still counts as Beginner
    const b = minesweeperGame('beginner');
    b.s.difficulty = 'advanced';
    b.record(true);
    assert.strictEqual(msStats().beginner.won, 1);
    assert.strictEqual(msStats().advanced, undefined);
    assert.ok(b.lastWinBest);
});

test('Minesweeper: a game ending during its last animation is counted once', () => {
    const g = minesweeperGame('intermediate');
    g.state = 'ending';
    g.result = 'lost';
    g.settleEnding();
    g.settleEnding();
    assert.strictEqual(g.state, 'lost');
    assert.strictEqual(msStats().intermediate.played, 1);
    assert.strictEqual(msStats().intermediate.streak, -1);
});

test('MUI: Minesweeper Options dialog template and string table', () => {
    const d = DATA('minesweeper').mui;
    const opt = d.dialogs['147'];
    assert.strictEqual(opt.cx, 255);
    assert.strictEqual(opt.cy, 242);
    assert.strictEqual(opt.font, 'Segoe UI');
    assert.ok(opt.controls.some((c) => c.id === 1013 && /question marks/.test(c.text)));
    assert.strictEqual(d.strings['4005'], 'What level of difficulty do you want to play?');
    const menu = d.menus['163'];
    assert.strictEqual(menu[0].text, '&Game');
    assert.ok(menu[0].items.some((i) => i.id === 40006));
});

test('build: localisable text keeps only the text', () => {
    const b = require('./build-vista-games.js');
    assert.strictEqual(b.localText('|55713|CONFIG|Silver and Blue//config name'), 'Silver and Blue');
    const n = b.parseXml('<Root><A X="1">|1|c|Hi//n</A><B/></Root>');
    assert.strictEqual(n.c[0].v, 'Hi');
    assert.strictEqual(n.c[0].a.X, '1');
    assert.strictEqual(n.c[1].t, 'B');
});

// ---- the card table (cardEngine.js): keyboard focus, hints, statistics keys ----
const cardTable = (layoutKey, hooks) => {
    const data = DATA('cardgames');
    const layout = C.readLayout(data.xml[layoutKey]);
    const assets = {
        decks: [{}],
        pulse: data.xml['ANIMATIONS_PULSEALPHAANIMATION.XML'],
        delayedPulse: data.xml['ANIMATIONS_DELAYEDPULSEALPHAANIMATION.XML']
    };
    return new C.CardTable({ invalidate() {} }, assets, layout, hooks || {});
};

test('card table: the arrows walk the stacks as on the VM (Down from the rows wraps to the top)', () => {
    const table = cardTable('LAYOUTS_SOLITAIRELAYOUT.XML', { canPick: (st, i) => st.cards[i].faceUp });
    table.stacks.forEach((st) => { st.cards = [C.makeCard(0, 5, true)]; });
    table.arrange(null, { instant: true });
    table.setFocus(table.stack('Deck'), 0);
    table.moveFocus('right');
    assert.strictEqual(table.focusTarget().stack.name, 'DealSpace');
    table.setFocus(table.stack('SuitStack2'), 0);
    table.moveFocus('down');
    assert.strictEqual(table.focusTarget().stack.name, 'Stack5');
    table.moveFocus('down');
    assert.strictEqual(table.focusTarget().stack.name, 'SuitStack2');
    table.setFocus(table.stack('Stack7'), 0);
    table.moveFocus('right');
    assert.strictEqual(table.focusTarget().stack.name, 'Stack1');
    // a fan: Up / Down step through the cards that can be picked up first
    const row = table.stack('Stack3');
    row.cards = [C.makeCard(0, 9, false), C.makeCard(0, 8, true), C.makeCard(1, 7, true)];
    table.setFocus(row, 2);
    table.moveFocus('up');
    assert.strictEqual(table.focusTarget().index, 1);
    table.moveFocus('up');
    assert.strictEqual(table.focusTarget().stack.name, 'DealSpace');
});

test('card table: a hint pulses in on the cards, then (delayed) on where they go, until cleared', () => {
    const table = cardTable('LAYOUTS_SOLITAIRELAYOUT.XML');
    const card = C.makeCard(0, 1, true);
    table.stack('Stack1').cards = [card];
    table.stack('SuitStack1').cards = [];
    table.arrange(null, { instant: true });
    table.showHint([card], null, { to: table.stack('SuitStack1') });
    const h = table.hints[0];
    table.step(0);
    table.step(100);
    assert.ok(h.src.alpha > 100 && h.dst.alpha === 0, 'source first: ' + h.src.alpha + ' / ' + h.dst.alpha);
    table.step(2000);
    assert.strictEqual(Math.round(h.src.alpha), 255);
    assert.strictEqual(Math.round(h.dst.alpha), 230);
    table.move([card], table.stack('SuitStack1'), { instant: true });
    assert.strictEqual(table.hints.length, 0);
});

test('card games: a game given up for new settings counts under the old ones', () => {
    const g = Object.create(C.CardGame.prototype);
    Object.assign(g, { store: VG.store('cardtest'), config: { statKind: (s) => 'suits' + s.suits }, s: { suits: 4 } });
    g.statKeyOverride = 'suits1';
    g.recordLoss();
    g.statKeyOverride = null;
    const all = JSON.parse(memory['vistaGame:cardtest']).stats;
    assert.strictEqual(all.suits1.played, 1);
    assert.strictEqual(all.suits4, undefined);
    assert.strictEqual(g.stats().played, 0);
});

console.log(passed + ' passed');
