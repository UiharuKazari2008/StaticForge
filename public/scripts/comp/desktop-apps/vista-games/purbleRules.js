// Purble Place's rules without the drawing (Yozora #609): Purble Pairs' deck and scoring
// (UI\Concentration\ConcentrationGame.xml, Cards.xml, Ranks.xml), Comfy Cakes' orders and cake
// building (ComfyCakesVars.xml, UI\ComfyCakes\Layers.xml, the tool button types) and Purble Shop's
// feedback (UI\BuildAPurble\Constants.xml); what the XML does not hold (recipes, layer rules,
// bonus tables, rank cut-offs) is PurblePlace.exe's, read from its code. purblePairs.js /
// purbleCakes.js / purbleShop.js use them; scripts/test-vista-purble.js runs them in node.
(function (root, factory) {
    'use strict';
    const R = factory();
    if (typeof module === 'object' && module.exports) module.exports = R;
    else (root.VistaPurble = root.VistaPurble || {}).Rules = R;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const R = {};

    R.shuffle = function (list, rng) {
        const r = rng || Math.random;
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };

    // ---- Purble Pairs ------------------------------------------------------------------------
    // Card types (Cards.xml <type>): 0 plain, 1 Purble Chef, 3 mixer, 4 tricky (look-alikes),
    // 5 super tricky, 6 clock (time bonus), 8 joker (wild card)
    R.CARD = { PLAIN: 0, CHEF: 1, MIXER: 3, TRICKY: 4, SUPER: 5, CLOCK: 6, JOKER: 8 };
    // CardPairs letters: one letter is one pair; a repeated letter is more pairs of that picture.
    // T a clock pair, J a joker pair, M a mixer pair, P a Purble Chef pair; every other letter is
    // a picture of its own
    R.SPECIAL_LETTERS = { T: 6, J: 8, M: 3, P: 1 };

    // level: { pairs: 'AAABBBCCCDDD', tricky, superTricky }, cells: cols * rows,
    // cards: [{ id, type, chef }] -> [card id per cell] (an odd board gets one joker more)
    R.pairsDeck = function (level, cells, cards, rng) {
        const r = rng || Math.random;
        const byType = (t) => R.shuffle(cards.filter((c) => c.type === t), r);
        const letters = String(level.pairs || '').toUpperCase().split('').filter((c) => /[A-Z]/.test(c));
        const plainLetters = Array.from(new Set(letters.filter((c) => !R.SPECIAL_LETTERS[c])));
        // the look-alike pictures go to random letters
        const order = R.shuffle(plainLetters, r);
        const pools = { 0: byType(0), 4: byType(4), 5: byType(5) };
        const picture = {};
        order.forEach((letter, i) => {
            let pool = pools[0];
            if (i < (level.superTricky || 0) && pools[5].length) pool = pools[5];
            else if (i < (level.superTricky || 0) + (level.tricky || 0) && pools[4].length) pool = pools[4];
            const card = pool.shift() || pools[0].shift() || pools[4].shift() || pools[5].shift();
            picture[letter] = card ? card.id : 0;
        });
        const special = {};
        Object.entries(R.SPECIAL_LETTERS).forEach(([letter, type]) => {
            const c = cards.find((k) => k.type === type);
            if (c) special[letter] = c.id;
        });
        const deck = [];
        letters.forEach((letter) => {
            const id = R.SPECIAL_LETTERS[letter] ? special[letter] : picture[letter];
            if (id === undefined) return;
            deck.push(id, id);
        });
        const joker = special.J !== undefined ? special.J : (cards.find((k) => k.type === 8) || {}).id;
        while (deck.length < cells && joker !== undefined) deck.push(joker);
        return R.shuffle(deck.slice(0, cells), r);
    };

    // two face-up cards: 'match' (same picture, or a joker with anything), or 'miss'
    R.pairsMatch = function (a, b, typeOf) {
        if (a === b) return 'match';
        if (typeOf(a) === 8 || typeOf(b) === 8) return 'joker';
        return 'miss';
    };

    // Ranks.xml FlipBonus: the first row whose multiplier is >= the average turns per match
    // (tiles turned / tiles matched: 1 is a perfect game)
    R.FLIP_BONUS = [
        [1.5, 2300, 3000, 5000], [2, 1600, 2000, 3000], [2.5, 1100, 1500, 2200], [3, 700, 1000, 1700],
        [4, 400, 600, 1100], [5, 200, 300, 600], [6, 100, 100, 300], [99999, 50, 50, 100]
    ];
    // TimeBonus: percent of the time left, [floor, ceil) -> intermediate / advanced
    R.TIME_BONUS = [[0, 5, 0, 0], [5, 10, 100, 300], [10, 30, 300, 600], [30, 50, 600, 1100], [50, 60, 1000, 1700], [60, 70, 1500, 2200], [70, 75, 2000, 3000], [75, 101, 3000, 5000]];
    R.PAIRS_RANKS = {
        BeginnerUntimed: [540, 860, 1600, 2000], IntermediateTimed: [820, 1820, 3000, 5000], IntermediateUntimed: [500, 820, 1800, 3000],
        AdvancedTimed: [1260, 3100, 5000, 10000], AdvancedUnTimed: [960, 2000, 3500, 5000]
    };

    // r: { difficulty 0-2, timed, points, tilesTurned, tilesMatched, secondsLeft, totalSeconds }
    R.pairsScore = function (r) {
        const avg = r.tilesMatched ? r.tilesTurned / r.tilesMatched : 0;
        const row = R.FLIP_BONUS.find((b) => avg <= b[0]) || R.FLIP_BONUS[R.FLIP_BONUS.length - 1];
        const flipBonus = row[1 + r.difficulty];
        let timeBonus = 0;
        if (r.timed && r.difficulty > 0 && r.totalSeconds > 0) {
            const pct = Math.max(0, r.secondsLeft) * 100 / r.totalSeconds;
            const t = R.TIME_BONUS.find((b) => pct >= b[0] && pct < b[1]) || R.TIME_BONUS[0];
            timeBonus = t[1 + r.difficulty];
        }
        const final = r.points + flipBonus + timeBonus;
        const table = r.difficulty === 0 ? 'BeginnerUntimed' : (r.difficulty === 1 ? (r.timed ? 'IntermediateTimed' : 'IntermediateUntimed') : (r.timed ? 'AdvancedTimed' : 'AdvancedUnTimed'));
        const rank = R.PAIRS_RANKS[table].filter((c) => final >= c).length;
        return { avg: Math.round(avg * 100) / 100, flipBonus, timeBonus, final, rank };
    };

    // ---- Comfy Cakes -------------------------------------------------------------------------
    // Tool button types (Layers.xml order): batter 0-2 (chocolate, strawberry, vanilla), pan 3-5
    // (round, rectangle, heart), decoration 6-9 (heart, smiley, gumdrop, shamrock), filling 10-12
    // (fudge, raspberry, vanilla), final touch 13 (toasty glaze) / 14 (powdered sugar), icing
    // 15-17 (chocolate, strawberry, vanilla)
    R.T = { BATTER: 0, PAN: 3, DECO: 6, FILLING: 10, GLAZE: 13, SUGAR: 14, ICING: 15 };
    R.kindOf = function (type) {
        if (type <= 2) return 'batter';
        if (type <= 5) return 'pan';
        if (type <= 9) return 'deco';
        if (type <= 12) return 'filling';
        if (type === 13) return 'glaze';
        if (type === 14) return 'sugar';
        return 'icing';
    };

    // ComfyCakesVars.xml per difficulty (Expert = Advanced). The recipes are
    // ComfyCakesGame::GenerateCorrectCake's (PurblePlace.exe): Beginner and Intermediate always
    // icing + one decoration (MaxToppings is not read for them); Advanced draws three toppings:
    // icing or a decoration, a decoration, then a decoration or a final touch (glaze or powdered
    // sugar on icing, sugar without), a decoration on a decoration replacing it - so half its cakes
    // have no icing and half a final touch. A heart cake only takes the heart or the gumdrops.
    R.CAKE_LEVELS = [
        { right: 10, wrong: -10, needed: 5, missed: 3, slide: 4, slidesToAdd: 5, layers: 1, toppings: 2, moves: [1600, 1250, 900, 650, 400, 200, 130, 100, 75, 50, 30] },
        { right: 50, wrong: -50, needed: 5, missed: 3, slide: 5, slidesToAdd: 7, layers: 2, toppings: 2, moves: [2000, 1500, 1000, 750, 500, 300, 150, 100, 75, 50, 30] },
        { right: 100, wrong: -100, needed: 6, missed: 2, slide: 4, slidesToAdd: 7, layers: 3, toppings: 3, moves: [3000, 2000, 1000, 600, 400, 300, 200, 100, 75, 50, 30] }
    ];
    // DialogCCWon::OnDialogInit: the final score each rank starts at (Kitchen Trainee .. Master Chef)
    R.CAKE_RANKS = [[0, 130, 400, 1250, 1600], [0, 150, 500, 1500, 2000], [0, 200, 400, 2000, 3000]];

    // an order: { shape 0-2, layers: [batter 0-2], fillings: [0-2] (one between each two layers),
    // icing 0-2 or -1, deco 0-3, final: null / 'glaze' / 'sugar' }
    R.cakeOrder = function (difficulty, rng) {
        const r = rng || Math.random;
        const L = R.CAKE_LEVELS[difficulty] || R.CAKE_LEVELS[0];
        const pick = (n) => Math.floor(r() * n);
        const order = { shape: pick(3), layers: [], fillings: [], icing: -1, deco: -1, final: null };
        for (let i = 0; i < L.layers; i++) {
            order.layers.push(pick(3));
            if (i < L.layers - 1) order.fillings.push(pick(3));
        }
        // gumdrop, heart, shamrock, smiley; heart pans: heart, gumdrop
        const decos = order.shape === 2 ? [0, 2] : [2, 0, 3, 1];
        const deco = () => { order.deco = decos.splice(pick(decos.length), 1)[0]; };
        if (L.toppings < 3) {
            order.icing = pick(3);
            deco();
            return order;
        }
        if (pick(100) < 50) order.icing = pick(3);
        else deco();
        deco();
        if (pick(100) < 50 && decos.length) deco();
        else order.final = order.icing >= 0 && pick(2) === 0 ? 'glaze' : 'sugar';
        return order;
    };

    // a cake: the order's fields, plus pan (a pan on top waiting for its batter) and steps (the
    // parts put on it); final may be 'both' (glazed and sugared)
    R.emptyCake = () => ({ shape: -1, pan: false, mixed: false, layers: [], fillings: [], icing: -1, deco: -1, final: null, steps: 0 });

    // the tool presses an order takes (the minimum ComfyCakesGame scores the moves against): a pan
    // and its batter per layer, the fillings, icing, decoration, final touch
    R.cakeMinMoves = (order) => 2 * order.layers.length + order.fillings.length + (order.icing >= 0 ? 1 : 0) + (order.deco >= 0 ? 1 : 0) + (order.final ? 1 : 0);

    // apply tool `type` to `cake` (null = an empty wax paper). Returns { ok, cake, tip }:
    // ok false = an illegal move (nothing changes; tip = the Tips.xml id, or null for none).
    // Cake::CanAddLayer / AddLayer with GetLayerOperation's table (top part -> part added): a pan
    // goes on the paper or on a filling (the next layer; on anything else it is refused here),
    // the batter replaces the pan; a filling or icing on a topped layer strips the layer back to
    // its batter first; a decoration replaces the decoration; glaze needs icing; sugar goes on
    // anything with a layer (the decoration stays on top)
    R.cakeApply = function (cake, type, hasPaper) {
        const kind = R.kindOf(type);
        const c = cake ? JSON.parse(JSON.stringify(cake)) : R.emptyCake();
        const layers = c.layers.length;
        const topFilling = layers > 0 && c.fillings.length === layers;
        const topped = c.icing >= 0 || c.deco >= 0 || !!c.final;
        const fail = (tip) => ({ ok: false, cake, tip });
        const strip = () => {
            if (topFilling) c.fillings.pop();
            c.icing = -1;
            c.deco = -1;
            c.final = null;
        };
        // on an empty paper or a pan only a pan (or, on the pan, its batter) goes
        if (kind !== 'pan' && !(kind === 'batter' && c.pan) && (c.pan || !layers)) {
            const tips = { batter: 'IllegalMoveBatterOnEmpty', filling: 'IllegalMoveFillingOnPanOrEmpty', icing: 'IllegalMoveIcingOnPanOrEmpty', deco: 'IllegalMoveDecorationsOnPanOrEmpty', sugar: 'IllegalMoveSugarOnPanOrEmpty', glaze: 'IllegalMoveGlazeOnPanOrEmpty' };
            return fail(tips[kind] || null);
        }
        switch (kind) {
        case 'pan':
            if (!hasPaper) return fail('NeedWaxPaper');
            if (c.pan) return fail('GamePlayDoubleCakePan');
            if (layers && (!topFilling || topped)) return fail(topped ? null : 'GamePlayDoubleBatter');
            if (c.shape >= 0 && c.shape !== type - R.T.PAN) c.mixed = true;
            if (c.shape < 0) c.shape = type - R.T.PAN;
            c.pan = true;
            break;
        case 'batter':
            if (!c.pan) {
                if (topFilling || topped) return fail(null);
                return fail(c.layers[layers - 1] === type - R.T.BATTER ? 'GamePlayDoubleBatter' : 'IllegalMoveBatterOnBatter');
            }
            c.pan = false;
            c.layers.push(type - R.T.BATTER);
            break;
        case 'filling':
            if (topFilling || topped) strip();
            c.fillings.push(type - R.T.FILLING);
            break;
        case 'icing':
            if (topFilling || topped) strip();
            c.icing = type - R.T.ICING;
            break;
        case 'deco':
            c.deco = type - R.T.DECO;
            break;
        case 'sugar':
            c.final = c.final === 'glaze' || c.final === 'both' ? 'both' : 'sugar';
            break;
        case 'glaze':
            if (c.icing < 0) return fail('IllegalMoveGlazeNoIcing');
            c.final = c.final === 'sugar' || c.final === 'both' ? 'both' : 'glaze';
            break;
        default:
            return fail(null);
        }
        c.steps = (c.steps || 0) + 1;
        return { ok: true, cake: c, tip: null };
    };

    R.cakeMatches = function (cake, order) {
        if (!cake || cake.shape !== order.shape || cake.pan || cake.mixed) return false;
        if (cake.layers.length !== order.layers.length || cake.fillings.length !== order.fillings.length) return false;
        if (cake.layers.some((v, i) => v !== order.layers[i]) || cake.fillings.some((v, i) => v !== order.fillings[i])) return false;
        return cake.icing === order.icing && cake.deco === order.deco && (cake.final || null) === (order.final || null);
    };

    // can the cake still become the order? (false: GamePlayBadCakePart)
    R.cakeOnTrack = function (cake, order) {
        if (!cake || cake.shape < 0) return true;
        if (cake.shape !== order.shape || cake.mixed) return false;
        if (cake.layers.length > order.layers.length || cake.fillings.length > order.fillings.length) return false;
        if (cake.layers.some((v, i) => v !== order.layers[i]) || cake.fillings.some((v, i) => v !== order.fillings[i])) return false;
        if (cake.pan && cake.layers.length >= order.layers.length) return false;
        const done = cake.layers.length === order.layers.length && cake.fillings.length === order.fillings.length;
        if ((cake.icing >= 0 || cake.deco >= 0 || cake.final) && !done) return false;
        if (cake.icing >= 0 && cake.icing !== order.icing) return false;
        if (cake.deco >= 0 && cake.deco !== order.deco) return false;
        if (cake.final && cake.final !== order.final) return false;
        return true;
    };

    // ComfyCakesGame's efficiency bonus: MovesMadeScorePercent0 for at most the minimum moves,
    // ...10 up to 10 % over (the minimum + its tenth, truncated), ... 100 up to twice the
    // minimum, nothing past that
    R.cakeEfficiency = function (difficulty, movesTaken, minMoves) {
        const L = R.CAKE_LEVELS[difficulty] || R.CAKE_LEVELS[0];
        if (!minMoves) return 0;
        for (let i = 0; i <= 10; i++) {
            if (movesTaken <= minMoves + Math.trunc(minMoves * i / 10 + 1e-6)) return L.moves[i];
        }
        return 0;
    };

    // r: { difficulty, right, wrong, moves, minMoves, singleCake } -> the Game Won box's figures
    // ("one cake at a time" past Beginner costs 100 of the efficiency bonus; the score may go
    // below 0)
    R.cakeScore = function (r) {
        const L = R.CAKE_LEVELS[r.difficulty] || R.CAKE_LEVELS[0];
        const rightScore = r.right * L.right;
        const wrongPenalty = r.wrong * L.wrong;
        let efficiency = R.cakeEfficiency(r.difficulty, r.moves, r.minMoves);
        if (r.difficulty > 0 && r.singleCake) efficiency = Math.max(0, efficiency - 100);
        const final = rightScore + wrongPenalty + efficiency;
        const steps = R.CAKE_RANKS[r.difficulty] || R.CAKE_RANKS[0];
        const rank = Math.max(0, steps.filter((c) => final >= c).length - 1);
        return { rightScore, wrongPenalty, efficiency, final, rank };
    };

    // ---- Purble Shop -------------------------------------------------------------------------
    // Beginner: eyes / nose / mouth in red, purple, yellow; Intermediate: + hair, + blue;
    // Advanced: + outfit, + green
    R.SHOP_FEATURES = [['Eye', 'Nose', 'Mouth'], ['Hair', 'Eye', 'Nose', 'Mouth'], ['Hair', 'Eye', 'Nose', 'Mouth', 'Accessory']];
    R.SHOP_COLORS = ['Red', 'Purple', 'Yellow', 'Blue', 'Green'];
    // Constants.xml: MaxGuessesINT 7, MaxGuessesADV 13 (Beginner has no limit)
    R.SHOP_MAX_GUESSES = [0, 7, 13];
    R.SHOP_POINTS = { initial: 100, rcrf: 10, rcwf: 5 };

    R.shopHidden = function (difficulty, rng) {
        const r = rng || Math.random;
        const n = R.SHOP_FEATURES[difficulty].length;
        const colors = difficulty + 3;
        return R.SHOP_FEATURES[difficulty].map(() => Math.floor(r() * colors)).slice(0, n);
    };

    // hidden / guess: color index per feature -> { rcrf: exactly right, rcwf: right color on a
    // wrong feature (each hidden color counted once) }
    R.shopFeedback = function (hidden, guess) {
        let rcrf = 0;
        const restH = {};
        const restG = {};
        hidden.forEach((h, i) => {
            if (guess[i] === h) rcrf += 1;
            else {
                restH[h] = (restH[h] || 0) + 1;
                restG[guess[i]] = (restG[guess[i]] || 0) + 1;
            }
        });
        let rcwf = 0;
        Object.keys(restG).forEach((c) => { rcwf += Math.min(restG[c], restH[c] || 0); });
        return { rcrf, rcwf };
    };

    // the Game Won box (BuildAPurbleGame::CalculateScore): the game points (100 + 10 per exact
    // feature + 5 per right colour reported, the advanced count) and the bonus for guesses + hints,
    // BAPConstants' table per difficulty (nothing past 15)
    R.SHOP_BONUS = [
        [2000, 1200, 700, 400, 200, 100, 50, 30, 10, 0, 0, 0, 0, 0, 0],
        [2000, 1500, 1200, 1000, 800, 600, 500, 400, 200, 50, 35, 20, 10, 5, 0],
        [6000, 4500, 3000, 2000, 1200, 700, 400, 220, 120, 70, 35, 20, 10, 5, 0]
    ];
    // DialogBAPWon::OnDialogInit: the final score each rank starts at (Junior Detective .. Purble
    // Master)
    R.SHOP_RANKS = [[0, 551, 951, 1341, 2000], [0, 751, 950, 1200, 1340], [0, 400, 650, 950, 2000]];
    R.shopScore = function (r) {
        const total = r.guesses + r.hints;
        const table = R.SHOP_BONUS[r.difficulty] || R.SHOP_BONUS[0];
        const bonus = total >= 1 && total <= table.length ? table[total - 1] : 0;
        const final = r.points + bonus;
        const steps = R.SHOP_RANKS[r.difficulty] || R.SHOP_RANKS[0];
        return { total, bonus, final, rank: Math.max(0, steps.filter((c) => final >= c).length - 1) };
    };

    return R;
});
