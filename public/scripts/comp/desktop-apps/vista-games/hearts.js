// Hearts, as Windows Vista's (Yozora #609), on the card table of cardEngine.js (CardGames.dll's
// Layouts\HeartsLayout.xml: your hand along the bottom, West, North and East around the table,
// the four played-card spots in the middle) with Hearts.exe.mui's menus, dialogs and strings.
// Rules: pass three cards left, right, across, then keep (no pass), and round again; the 2 of
// clubs leads the first trick; follow suit when you can; no hearts or Queen of Spades on the first
// trick; hearts cannot be led until broken; hearts are a point each and the Queen of Spades 13;
// taking all 26 shoots the moon (the others take 26); the game ends when someone reaches 100 and
// the lowest score wins. Illegal plays explain themselves in a tip.
//
// Measured on the VM: the 800x496 table over the status bar ("Points taken this hand: 0", right);
// the others' three passed cards slide 30 px toward the middle and the pass arrow sits between.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const C = VG.Cards;
    const fmt = C.fmt;
    const GAME_ID = 'hearts';

    const CMD = { NEW: 40001, STATS: 40003, OPTIONS: 40004, APPEARANCE: 40002, EXIT: 40005, HELP: 40024, ABOUT: 40007 };
    const PASS = ['left', 'right', 'across', 'none'];
    // pass target: players 0 (you, bottom), 1 West, 2 North, 3 East, clockwise
    const PASS_TO = { left: 1, right: 3, across: 2 };
    // the others' passed cards slide toward the middle
    const PASS_LIFT = [[0, -20], [30, 0], [0, 30], [-30, 0]];
    // Tips\Hearts\HeartsTips.xml ids
    const SUIT_TIP = { [C.SPADES]: 'PlayASpade', [C.CLUBS]: 'PlayAClub', [C.DIAMONDS]: 'PlayADiamond', [C.HEARTS]: 'PlayAHeart' };
    const PASS_TIP = { left: 'PassingLeft', right: 'PassingRight', across: 'PassingAcross' };
    // hand order on the VM: clubs, diamonds, spades, hearts; 2 up to Ace
    const sortValue = (c) => c.suit * 20 + (c.rank === 1 ? 14 : c.rank);
    const high = (c) => (c.rank === 1 ? 14 : c.rank);
    const points = (c) => (c.suit === C.HEARTS ? 1 : (c.suit === C.SPADES && c.rank === 12 ? 13 : 0));
    const isQueen = (c) => c.suit === C.SPADES && c.rank === 12;

    let game = null;

    class Hearts extends C.CardGame {
        constructor(pack, assets) {
            super(pack, assets, {
                id: GAME_ID,
                modalId: 'vistaHeartsModal',
                title: pack.string(101, 'Hearts'),
                icon: '/static_images/app_icons/48/vista-hearts.webp',
                iconClass: 'fas fa-heart',
                menu: 102,
                accelerators: 109,
                layout: 'Layouts\\HeartsLayout.xml',
                tips: 'Tips\\Hearts\\HeartsTips.xml',
                panes: [{}, { width: 336 }],
                lowBest: true,
                defaults: { names: [pack.string(64135, 'West'), pack.string(64136, 'North'), pack.string(64137, 'East')] }
            });
            this.hands = [1, 2, 3, 4].map((n) => this.table.stack('Player' + n));
            this.inPlay = [1, 2, 3, 4].map((n) => this.table.stack('Player' + n + 'InPlay'));
            this.tricks = [1, 2, 3, 4].map((n) => this.table.stack('Player' + n + 'Tricks'));
            this.deckStack = this.table.stack('Deck');
            this.deckStack.hidden = true;
            const ap = assets.pack;
            this.passButtons = { left: ap.sprite('PassButtonLeft.xml'), right: ap.sprite('PassButtonRight.xml'), across: ap.sprite('PassButtonUp.xml') };
            this.heartBreak = ap.sprite('Animations\\HeartBreakAnimNode.xml');
            // the pass arrow is a button over the table: hot under the pointer, pressed while down
            const tipHit = this.table.hooks.overlay;
            this.table.hooks.overlay = (p, phase) => tipHit(p, phase) || this.passButtonHit(p, phase);
            this.applyLook();
        }

        tableHooks() {
            return {
                canPick: () => false,
                click: (stack, i, e, point) => this.click(stack, i, point),
                blocked: () => this.ending || this.busyTurn,
                // the keyboard: along your hand; Space / Enter picks (Enter passes three picked cards)
                focusable: (stack) => stack === this.hands[0],
                focusCard: (stack) => stack === this.hands[0],
                keyActivate: (stack, i, e) => {
                    if (this.phase === 'pass' && e.key === 'Enter' && this.selected.length === 3) this.doPass();
                    else this.click(stack, i);
                },
                hoverable: (stack, i) => stack === this.hands[0] && i >= 0 && (this.phase === 'pass' || (this.phase === 'play' && this.turn === 0)),
                drawUnder: () => this.drawLabels(),
                drawOver: () => this.drawOver()
            };
        }

        passButtonHit(p, phase) {
            const r = this.phase === 'pass' && !this.busyTurn ? this.passButtonRect() : null;
            const on = !!r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
            if (phase === 'move') {
                if (on !== !!this.passHot) {
                    this.passHot = on;
                    this.win.stage.invalidate();
                }
                return false;
            }
            if (phase === 'down') {
                if (!on) return false;
                this.passPressed = true;
                this.win.stage.invalidate();
                return true;
            }
            if (!this.passPressed) return false;
            this.passPressed = false;
            this.win.stage.invalidate();
            if (on && this.selected.length === 3) this.doPass();
            return true;
        }

        warm() {
            return Promise.all([super.warm(), VG.warmSprites(this.win.stage, this.assets.pack, Object.values(this.passButtons).concat([this.heartBreak]))]);
        }

        names() {
            return [VG.userName()].concat(this.s.names);
        }

        // ---- game / hand ----
        newGame() {
            this.scores = [];
            this.totals = [0, 0, 0, 0];
            this.handNo = 0;
            this.moved = false;
            this.ending = false;
            this.running = false;
            this.time = 0;
            this.newHand();
            if (this.s.tips && !this.introShown) {
                this.introShown = true;
                this.showTipId('HowToPlay');
            }
        }

        newHand() {
            this.table.stacks.forEach((st) => { st.cards = []; });
            const cards = C.shuffle(C.standardDeck(1));
            this.taken = [0, 0, 0, 0];
            this.takenCards = [[], [], [], []];
            this.heartsBroken = false;
            this.trickNo = 0;
            this.passDir = PASS[this.handNo % 4];
            this.selected = [];
            this.aiPass = [];
            this.trick = [];
            this.phase = 'deal';
            this.busyTurn = true;
            // dealt from the middle, one card a player at a time
            cards.forEach((c, i) => {
                c.x = 365;
                c.y = 200;
                c.faceUp = false;
            });
            const hands = [[], [], [], []];
            cards.forEach((c, i) => hands[i % 4].push(c));
            hands.forEach((h) => h.sort((a, b) => sortValue(a) - sortValue(b)));
            let k = 0;
            for (let r = 0; r < 13; r++) {
                for (let p = 0; p < 4; p++) {
                    this.table.move([hands[p][r]], this.hands[p], { delay: k * 14, duration: 220, flip: p === 0 ? true : undefined, instant: !this.s.animations });
                    k++;
                }
            }
            this.sounds.play('DEAL_CARDS');
            this.updateStatus();
            this.later(() => this.startPassing(), this.s.animations ? 52 * 14 + 300 : 0);
        }

        startPassing() {
            this.busyTurn = false;
            if (this.passDir === 'none') {
                this.startPlay();
                return;
            }
            this.phase = 'pass';
            // the computer players choose at once; their cards slide toward the middle
            for (let p = 1; p < 4; p++) {
                const pick = this.choosePass(this.hands[p].cards);
                pick.forEach((c) => {
                    c.liftX = PASS_LIFT[p][0];
                    c.liftY = PASS_LIFT[p][1];
                });
                this.aiPass = this.aiPass || [];
                this.aiPass[p] = pick;
                this.table.arrange(this.hands[p]);
            }
            this.showTipId(PASS_TIP[this.passDir]);
            this.win.stage.invalidate();
        }

        // pass the dangerous cards: Q K A of spades, high hearts, then the highest of short suits
        choosePass(hand) {
            const scored = hand.map((c) => {
                let v = high(c);
                if (c.suit === C.SPADES && c.rank !== 1 && high(c) >= 12) v += 20;
                if (c.suit === C.SPADES && c.rank === 1) v += 18;
                if (c.suit === C.HEARTS) v += 6;
                const count = hand.filter((x) => x.suit === c.suit).length;
                if (count <= 3 && c.suit !== C.SPADES) v += 5;
                if (c.suit === C.SPADES && high(c) < 12) v -= 10;
                return { c, v };
            });
            scored.sort((a, b) => b.v - a.v);
            return scored.slice(0, 3).map((s) => s.c);
        }

        // the arrows share a centre (the left one measured at 343, 287); the across one is upright
        passButtonRect() {
            const b = this.passButtons[this.passDir];
            if (!b) return null;
            return { x: 381 - b.w / 2, y: 317 - b.h / 2, w: b.w, h: b.h };
        }

        click(stack, i) {
            if (this.ending || this.busyTurn) return;
            if (this.phase === 'pass') {
                if (stack !== this.hands[0] || i < 0) return;
                const card = stack.cards[i];
                if (this.selected.includes(card)) {
                    this.selected = this.selected.filter((c) => c !== card);
                    card.liftY = 0;
                } else {
                    if (this.selected.length >= 3) {
                        this.sounds.play('ILLEGAL_MOVE');
                        this.showTipId('CanOnlyPassThree');
                        return;
                    }
                    this.selected.push(card);
                    card.liftY = -20;
                }
                this.sounds.play('CARD_SELECT');
                this.table.arrange(stack);
                return;
            }
            if (this.phase === 'play' && this.turn === 0 && stack === this.hands[0] && i >= 0) {
                const card = stack.cards[i];
                const why = this.refusal(0, card);
                if (why) {
                    this.sounds.play('ILLEGAL_MOVE');
                    this.showTipId(why);
                    return;
                }
                this.hideTip();
                this.play(0, card);
            }
        }

        doPass() {
            const to = PASS_TO[this.passDir];
            this.start();
            this.moved = true;
            const passes = [this.selected.slice()];
            for (let p = 1; p < 4; p++) passes[p] = this.aiPass[p];
            this.received = [];
            passes.forEach((cards, from) => {
                const target = (from + to) % 4;
                cards.forEach((c) => {
                    c.liftX = 0;
                    c.liftY = target === 0 ? -20 : 0;
                    this.received.push(target === 0 ? c : null);
                });
            });
            passes.forEach((cards, from) => {
                const target = (from + to) % 4;
                this.table.move(cards, this.hands[target], { duration: 320, flip: target === 0 ? true : false });
            });
            this.hands.forEach((h) => {
                h.cards.sort((a, b) => sortValue(a) - sortValue(b));
                this.table.arrange(h);
            });
            this.selected = [];
            this.phase = 'passed';
            this.hideTip();
            this.busyTurn = true;
            this.sounds.play('DEAL_CARDS');
            // the received cards stay raised a moment, then settle and play starts
            this.later(() => {
                this.hands[0].cards.forEach((c) => { c.liftY = 0; });
                this.table.arrange(this.hands[0]);
                this.busyTurn = false;
                this.startPlay();
            }, this.s.animations ? 1300 : 0);
        }

        // ---- play ----
        startPlay() {
            this.phase = 'play';
            this.start();
            this.trick = [];
            const leader = this.hands.findIndex((h) => h.cards.some((c) => c.suit === C.CLUBS && c.rank === 2));
            this.turn = leader;
            this.leader = leader;
            if (leader === 0) this.showTipId('2OfClubs');
            this.nextTurn();
        }

        legalCards(p) {
            const hand = this.hands[p].cards;
            return hand.filter((c) => !this.refusal(p, c));
        }

        // why a play is illegal: the tip's id, or null
        refusal(p, card) {
            const hand = this.hands[p].cards;
            if (this.trickNo === 0 && !this.trick.length) {
                return card.suit === C.CLUBS && card.rank === 2 ? null : '2OfClubs';
            }
            if (this.trick.length) {
                const led = this.trick[0].card.suit;
                if (card.suit !== led && hand.some((c) => c.suit === led)) return SUIT_TIP[led];
                if (this.trickNo === 0 && points(card) && hand.some((c) => !points(c))) return 'NoPointsOnFirstTrick';
                return null;
            }
            if (card.suit === C.HEARTS && !this.heartsBroken && hand.some((c) => c.suit !== C.HEARTS)) return 'HeartsNotBroken';
            return null;
        }

        nextTurn() {
            if (this.ending) return;
            if (this.trick.length === 4) {
                this.finishTrick();
                return;
            }
            if (this.turn === 0) {
                this.busyTurn = false;
                if (this.trickNo > 0 || this.trick.length) this.showTipId('YourTurn');
                return;
            }
            this.busyTurn = true;
            this.later(() => {
                if (this.ending) return;
                this.play(this.turn, this.choosePlay(this.turn));
            }, this.s.animations ? 520 : 0);
        }

        // The computer players: follow under the winner when they can, dump the Queen of Spades
        // and high hearts when void, lead low, keep the Queen from being drawn out.
        choosePlay(p) {
            const legal = this.legalCards(p);
            if (legal.length === 1) return legal[0];
            const byHigh = (a, b) => high(a) - high(b);
            if (!this.trick.length) {
                // lead: a low card of the longest safe suit; never lead high spades while holding the Queen
                const holdsQ = legal.some(isQueen);
                const safe = legal.filter((c) => !(c.suit === C.SPADES && (holdsQ ? high(c) >= 12 : high(c) >= 13)));
                const pool = (safe.length ? safe : legal).slice().sort(byHigh);
                return pool[0];
            }
            const led = this.trick[0].card.suit;
            const following = legal.filter((c) => c.suit === led);
            const winning = this.trick.filter((t) => t.card.suit === led).map((t) => t.card).sort(byHigh).pop();
            const trickPoints = this.trick.reduce((n, t) => n + points(t.card), 0);
            if (following.length) {
                const under = following.filter((c) => high(c) < high(winning)).sort(byHigh);
                if (under.length) return under[under.length - 1];
                // must win: last to play with no points takes it with the highest, else the lowest
                if (this.trick.length === 3 && !trickPoints && !following.some(isQueen)) return following.sort(byHigh).pop();
                const noQ = following.filter((c) => !isQueen(c)).sort(byHigh);
                return (noQ.length ? noQ : following.sort(byHigh))[0];
            }
            // void: get rid of the Queen, then hearts high to low, then the highest card
            const q = legal.find(isQueen);
            if (q) return q;
            const hearts = legal.filter((c) => c.suit === C.HEARTS).sort(byHigh);
            if (hearts.length) return hearts.pop();
            return legal.slice().sort(byHigh).pop();
        }

        play(p, card) {
            if (p === 0) this.moved = true;
            this.trick.push({ p, card });
            card.liftY = 0;
            this.table.move([card], this.inPlay[p], { duration: 260, flip: true });
            this.table.arrange(this.hands[p]);
            if (card.suit === C.HEARTS && !this.heartsBroken) {
                this.heartsBroken = true;
                this.sounds.play('HEARTS_BROKEN');
                this.breakAnim = { x: this.inPlay[p].x + 6, y: this.inPlay[p].y - 6, start: VG.now() + 260 };
            } else if (isQueen(card)) this.sounds.play('HEARTS_QOSPLAYED');
            else this.sounds.play('HEARTS_CARDPLAYED');
            this.turn = (p + 1) % 4;
            this.win.stage.invalidate();
            this.later(() => this.nextTurn(), this.s.animations ? 280 : 0);
        }

        finishTrick() {
            this.busyTurn = true;
            const led = this.trick[0].card.suit;
            const winner = this.trick.filter((t) => t.card.suit === led).sort((a, b) => high(b.card) - high(a.card))[0].p;
            const cards = this.trick.map((t) => t.card);
            const pts = cards.reduce((n, c) => n + points(c), 0);
            this.later(() => {
                this.table.move(cards, this.tricks[winner], { duration: 420, stagger: 30, flip: false });
                this.sounds.play('HEARTS_CARDSCLEARED');
                this.taken[winner] += pts;
                this.takenCards[winner].push(...cards);
                this.trick = [];
                this.trickNo += 1;
                this.updateStatus();
                if (this.trickNo === 13) {
                    this.later(() => this.endHand(), this.s.animations ? 600 : 0);
                    return;
                }
                this.turn = winner;
                this.leader = winner;
                this.later(() => this.nextTurn(), this.s.animations ? 450 : 0);
            }, this.s.animations ? 1000 : 0);
        }

        endHand() {
            let hand = this.taken.slice();
            const moon = hand.findIndex((n) => n === 26);
            if (moon >= 0) {
                hand = hand.map((n, i) => (i === moon ? 0 : 26));
                this.sounds.play(moon === 0 ? 'HEARTS_PLAYERSHOOTSMOON' : 'HEARTS_OPPONENTSHOOTSMOON');
            }
            this.scores.push(hand);
            this.totals = this.totals.map((t, i) => t + hand[i]);
            this.handNo += 1;
            this.phase = 'scores';
            const over = this.totals.some((t) => t >= 100);
            this.showScores(moon, over);
        }

        place(p) {
            return this.totals.filter((t) => t < this.totals[p]).length;
        }

        showScores(moon, over) {
            const p = this.pack;
            const names = this.names();
            const placeTitle = [60481, 61046, 53430, 58912][this.place(0)];
            const texts = {};
            [1064, 1081, 1082, 1083].forEach((id, i) => { texts[id] = names[i]; });
            // 16 hand rows x 4 columns: 1065.. (rows 1-4), 1084.. (5-8), 1100.. (9-12), 1116.. (13-16)
            const blocks = [1065, 1084, 1100, 1116];
            for (let r = 0; r < 16; r++) {
                const base = blocks[Math.floor(r / 4)] + (r % 4);
                for (let col = 0; col < 4; col++) {
                    const id = base + col * 4;
                    texts[id] = this.scores[r] ? String(this.scores[r][col]) : '';
                }
            }
            [1135, 1136, 1137, 1138].forEach((id, i) => { texts[id] = String(this.totals[i]); });
            texts[1139] = moon >= 0 ? fmt(p.string(42303, '%1 shot the moon!'), names[moon]) : '';
            VG.dialog(p, 117, {
                owner: this.win,
                title: p.string(placeTitle, 'Current Game Score'),
                texts,
                init: (dlg) => {
                    for (let r = 0; r < 16; r++) dlg.show([1132, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 1162, 1163, 1164, 1165, 1166, 1167, 1168][r], r < Math.max(this.scores.length, 1));
                    if (over) dlg.text(2, p.string(53303, 'OK'));
                },
                closeOn: 'any',
                onClose: () => {
                    if (over) this.gameOver();
                    else this.newHand();
                }
            });
        }

        gameOver() {
            const won = this.place(0) === 0;
            this.ending = false;
            this.running = false;
            const st = this.recordResult(won, { score: this.totals[0] });
            this.moved = false;
            this.phase = null;
            this.store.remove('saved');
            if (won) this.sounds.play('HEARTS_WIN');
            const p = this.pack;
            const names = this.names();
            const order = [0, 1, 2, 3].sort((a, b) => this.totals[a] - this.totals[b]);
            const best = st.best[0];
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            const nameIds = won ? [1037, 1040, 1042, 1043] : [1056, 1057, 1058, 1059];
            const scoreIds = won ? [1038, 1041, 1044, 1045] : [1060, 1061, 1062, 1063];
            const texts = {};
            order.forEach((who, i) => {
                texts[nameIds[i]] = names[who];
                texts[scoreIds[i]] = String(this.totals[who]);
            });
            Object.assign(texts, won
                ? { 1046: fmt(p.string(41023, 'Best score: %1!d!'), best ? best.score : 0), 1047: fmt(p.string(54819, 'Date: %1'), VG.formatDate(best ? best.date : Date.now())), 1048: fmt(p.string(45573), st.played), 1049: fmt(p.string(45574), st.won), 1050: fmt(p.string(62848, 'Percentage: %1!d!%%'), pct) }
                : { 1051: fmt(p.string(41023, 'Best score: %1!d!'), best ? best.score : 0), 1055: fmt(p.string(54819, 'Date: %1'), VG.formatDate(best ? best.date : Date.now())), 1052: fmt(p.string(45573), st.played), 1053: fmt(p.string(45574), st.won), 1054: fmt(p.string(62848, 'Percentage: %1!d!%%'), pct) });
            VG.dialog(p, won ? 109 : 108, {
                owner: this.win,
                title: won ? 'Game Won' : 'Game Lost',
                texts,
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1018 || r === 1016) VG.closeWindow(this.win);
                    else this.newGame();
                }
            });
        }

        // ---- drawing ----
        drawLabels() {
            const st = this.win.stage;
            const ctx = st.ctx;
            const names = this.names();
            this.hands.forEach((stack, i) => {
                const label = stack.label && stack.label.node;
                if (!label) return;
                const x = stack.x + VG.num(label, 'X');
                const y = stack.y + VG.num(label, 'Y');
                const w = VG.num(label, 'W', 125);
                const h = VG.num(label, 'H', 30);
                const centred = VG.text(label, 'Justify') === '64';
                ctx.save();
                ctx.font = VG.pt(VG.num(label, 'FontSize', 12)) + 'px "Segoe UI", "Noto Sans", sans-serif';
                ctx.fillStyle = '#fff';
                ctx.globalAlpha = i === this.turn && this.phase === 'play' ? 1 : 0.85;
                ctx.textBaseline = 'middle';
                ctx.textAlign = centred ? 'center' : 'left';
                ctx.shadowColor = '#0006';
                ctx.shadowBlur = 3;
                ctx.fillText(names[i], centred ? x + w / 2 : x, y + h / 2);
                ctx.restore();
            });
        }

        drawOver() {
            const st = this.win.stage;
            if (this.phase === 'pass') {
                const b = this.passButtons[this.passDir];
                const r = this.passButtonRect();
                if (b && r) st.sprite(b, r.x, r.y, { anim: this.passPressed ? 2 : (this.passHot ? 1 : 0) });
            }
            if (this.breakAnim) {
                // Animations\HeartBreakAnim.xml: seven frames in a second
                const t = (VG.now() - this.breakAnim.start) / 1000;
                if (t >= 1) this.breakAnim = null;
                else if (t >= 0) st.sprite(this.heartBreak, this.breakAnim.x, this.breakAnim.y, { frame: Math.floor(t * 7) });
            }
            this.drawTip();
        }

        stepEffects() {
            return !!this.breakAnim;
        }

        updateStatus() {
            if (this.status) this.status.set(1, fmt(this.pack.string(56961, 'Points taken this hand: %1'), this.taken ? this.taken[0] : 0));
        }

        // ---- save: the hand as it stands ----
        serialize() {
            return {
                scores: this.scores, totals: this.totals, handNo: this.handNo, phase: this.phase, passDir: this.passDir,
                turn: this.turn, leader: this.leader, trickNo: this.trickNo, heartsBroken: this.heartsBroken,
                trick: (this.trick || []).map((t) => t.p)
            };
        }

        deserialize(d) {
            this.scores = d.scores || [];
            this.totals = d.totals || [0, 0, 0, 0];
            this.handNo = d.handNo || 0;
            this.selected = [];
            this.aiPass = [];
            this.table.stacks.forEach((st) => st.cards.forEach((c) => { c.liftX = 0; c.liftY = 0; }));
            const phase = d.phase;
            if (phase !== 'play' && phase !== 'pass' && phase !== 'passed') {
                // dealt but not passed yet (or between hands): the next hand
                this.later(() => this.newHand(), 0);
                return;
            }
            this.passDir = d.passDir || PASS[this.handNo % 4];
            this.trickNo = d.trickNo || 0;
            this.heartsBroken = !!d.heartsBroken;
            this.takenCards = this.tricks.map((t) => t.cards.slice());
            this.taken = this.takenCards.map((list) => list.reduce((n, c) => n + points(c), 0));
            this.leader = d.leader || 0;
            this.turn = d.turn || 0;
            this.trick = (d.trick || []).map((p) => ({ p, card: this.inPlay[p].cards[0] })).filter((t) => t.card);
            this.inPlay.forEach((st) => st.cards.forEach((c) => { c.faceUp = true; }));
            this.updateStatus();
            this.later(() => {
                if (phase === 'pass') this.startPassing();
                else if (phase === 'passed') this.startPlay();
                else {
                    this.phase = 'play';
                    this.busyTurn = false;
                    this.nextTurn();
                }
            }, 0);
        }

        closed() {
            super.closed();
            this.scores = null;
            this.phase = null;
            this.trick = [];
            this.busyTurn = false;
            this.breakAnim = null;
            this.passHot = false;
            this.passPressed = false;
        }

        command(id) {
            const p = this.pack;
            switch (id) {
            case CMD.NEW: this.askNewGame({ title: 41017, instruction: 41005, newLink: 41006, restartLink: 41008, keepLink: 41008 }); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance({ deckLabel: p.string(64437), bgLabel: p.string(51599), randomLabel: p.string(45007) }); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: VG.aboutBox({ owner: this.win, title: p.string(101, 'Hearts'), text: p.string(903), icon: '/static_images/vista-games/icons/hearts-48.png' }); break;
            case CMD.HELP: this.showTipId('HowToPlay'); break;
            default: break;
            }
        }

        // Hearts' New Game offers only a new game or to keep playing
        askNewGame() {
            if (!this.inProgress()) {
                this.newGame();
                return;
            }
            const p = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: p.string(41017, 'New Game'),
                instruction: p.string(41005),
                links: [VG.linkFromString(p.string(41006), 1), VG.linkFromString(p.string(41008), 3)]
            }).then((r) => {
                if (r !== 1) return;
                this.recordLoss();
                this.newGame();
            });
        }

        showStats() {
            const p = this.pack;
            let lines = [];
            const fill = (dlg) => {
                lines.forEach((n) => n.remove());
                const st = this.stats();
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                const texts = [
                    fmt(p.string(44810), st.played), fmt(p.string(47327), st.won), fmt(p.string(43159, 'Win Percentage: %1!d!%%'), pct),
                    fmt(p.string(45575), st.longestWin), fmt(p.string(45576), st.longestLose),
                    st.streak >= 0 ? fmt(p.string(st.streak === 1 ? 64008 : 60856), st.streak) : fmt(p.string(-st.streak === 1 ? 57408 : 47351), -st.streak)
                ];
                // the template only holds the list: the figures go to its right, as Vista lays them
                lines = texts.map((t, i) => {
                    const n = VG.el('div', 'vista-game-static vista-game-ctl', t);
                    Object.assign(n.style, { left: Math.round(146 * 1.5) + 'px', top: Math.round((8 + i * 11) * 1.625) + 'px', width: '360px', height: '14px' });
                    dlg.content.appendChild(n);
                    return n;
                });
            };
            VG.dialog(p, 105, {
                owner: this.win,
                title: fmt(p.string(44629, 'Hearts Statistics - %1'), VG.userName()),
                focus: 1021,
                init: (dlg) => {
                    dlg.setList(1021, [{ value: 'all', text: p.string(44537, 'Overall statistics') }], 'all');
                    fill(dlg);
                },
                onCommand: (id, dlg) => {
                    if (id === 1020) {
                        this.confirmResetStats(() => fill(dlg));
                        return false;
                    }
                    return true;
                }
            });
        }

        showOptions() {
            const s = this.s;
            VG.dialog(this.pack, 104, {
                owner: this.win,
                init: (dlg) => {
                    [1033, 1034, 1035].forEach((id, i) => dlg.text(id, s.names[i]));
                    dlg.checked(1029, s.animations);
                    dlg.checked(1030, s.sounds);
                    dlg.checked(1036, s.tips);
                    dlg.checked(1031, s.continueSaved);
                    dlg.checked(1047, s.saveOnExit);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    s.names = [1033, 1034, 1035].map((i, k) => dlg.text(i).trim() || this.config.defaults.names[k]);
                    Object.assign(s, {
                        animations: dlg.checked(1029),
                        sounds: dlg.checked(1030),
                        tips: dlg.checked(1036),
                        continueSaved: dlg.checked(1031),
                        saveOnExit: dlg.checked(1047)
                    });
                    this.saveSettings();
                    this.applyLook();
                    if (!s.tips) this.hideTip();
                    return true;
                }
            });
        }
    }

    function open() {
        return Promise.all([VG.loadPack(GAME_ID), C.loadAssets()]).then(([pack, assets]) => {
            const first = !game;
            if (!game) game = new Hearts(pack, assets);
            if (first && game.s.randomLook) {
                game.s.deck = Math.floor(Math.random() * assets.decks.length);
                game.s.background = Math.floor(Math.random() * game.backgrounds.length);
                game.applyLook();
            }
            return game.warm().then(() => {
                const wasOpen = game.win.isOpen();
                game.win.open();
                if (!wasOpen) {
                    game.sounds.warm();
                    game.afterOpen(() => {
                        if (first || !game.scores) game.newGame();
                    });
                }
                return game;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: 'Hearts',
        icon: '/static_images/vista-games/icons/hearts',
        thumbnail: '/static_images/vista-games/cardgames/images/rgmh_thumbnail_hearts.png',
        feature: 'vista_hearts',
        open
    });
    root.openVistaHearts = open;
    root.vistaHearts = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
