// Solitaire (Klondike), as Windows Vista's (Yozora #609). Table, decks, backgrounds, sounds and
// layout are CardGames.dll's (public/scripts/comp/desktop-apps/vista-games/cardEngine.js); menus,
// dialogs, tips and strings are Solitaire.exe.mui's. Rules and scoring are Windows Solitaire's:
//
//   Draw one / Draw three; scoring None, Standard (+5 deal to row, +10 to home, +5 turn over,
//   -15 home to row, recycling -100 when drawing one and -20 when drawing three past the third
//   pass; timed: -2 every 10 seconds and a 700,000 / seconds bonus on a win over 30 s), Vegas
//   (-$52 a game, +$5 a card home, one pass when drawing one and three when drawing three,
//   optionally cumulative). Double-click sends a card home; right-click on the table sends every
//   eligible card home. Illegal moves explain themselves in a tip (Show tips).
//
// Measured on the VM: the client is the 800x496 table over a 23 px status bar (Time padded to
// three digits, Score); the window keeps the table's aspect.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const C = VG.Cards;
    const fmt = C.fmt;
    const GAME_ID = 'solitaire';

    // MUI ids (menu 102, accelerators 109: D deals, as XP's Solitaire did)
    const CMD = { NEW: 40001, UNDO: 40011, HINT: 40012, STATS: 40003, OPTIONS: 40004, APPEARANCE: 40002, EXIT: 40005, HELP: 40008, ABOUT: 40007, DEAL: 40037 };
    const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n);

    let game = null;

    class Solitaire extends C.CardGame {
        constructor(pack, assets) {
            super(pack, assets, {
                id: GAME_ID,
                modalId: 'vistaSolitaireModal',
                title: pack.string(101, 'Solitaire'),
                icon: '/static_images/app_icons/48/vista-solitaire.webp',
                menu: 102,
                accelerators: 109,
                layout: 'Layouts\\SolitaireLayout.xml',
                tips: 'Tips\\Solitaire\\SolitaireTips.xml',
                idleHints: true,
                panes: [{}, { width: 139 }, { width: 166 }],
                defaults: { draw: 1, scoring: 'standard', cumulative: false, timed: true, balance: 0 },
                // the Statistics list: Standard timed, Standard non-timed, Vegas
                statKind: (s) => (s.scoring === 'vegas' ? 'vegas' : (s.timed ? 'timed' : 'untimed'))
            });
            this.deckStack = this.table.stack('Deck');
            this.waste = this.table.stack('DealSpace');
            this.homes = [1, 2, 3, 4].map((n) => this.table.stack('SuitStack' + n));
            this.rows = [1, 2, 3, 4, 5, 6, 7].map((n) => this.table.stack('Stack' + n));
            this.score = 0;
            this.passes = 0;
            this.applyLook();
        }

        tableHooks() {
            return {
                canPick: (stack, i) => this.canPick(stack, i),
                canDrop: (stack, cards) => this.refusal(stack, cards) === null,
                drop: (from, to, cards) => this.drop(from, to, cards),
                dropFailed: (d) => this.illegalMove(d),
                // the deck deals; a card is selected, then goes where the next click says
                click: (stack, i) => {
                    if (this.ending) return;
                    if (stack === this.deckStack && !this.table.highlight) this.dealFromDeck();
                    else this.clickSelect(stack, i);
                },
                keyActivate: (stack, i) => {
                    if (stack === this.deckStack && !this.table.highlight) this.dealFromDeck();
                    else this.keyMove(stack, i, (stack.cards.length - i === 1 ? this.homes : []).concat(this.rows));
                },
                hoverable: (stack, i) => (stack === this.deckStack ? (this.deckStack.cards.length > 0 || this.passes + 1 < this.maxPasses()) : this.canPick(stack, i)),
                doubleClick: (stack, i) => this.doubleClick(stack, i),
                rightClick: () => this.sendAllHome(),
                blocked: () => this.ending,
                drawOver: () => this.drawOver()
            };
        }

        refuseMove(from, to, cards) {
            this.sounds.play('ILLEGAL_MOVE');
            const why = this.refusal(to, cards);
            if (why) this.showTip(59577, why);
        }

        applyLook() {
            super.applyLook();
            if (this.waste) this.waste.fanCount = this.s.draw;
        }

        maxPasses() {
            return this.s.scoring === 'vegas' ? (this.s.draw === 1 ? 1 : 3) : Infinity;
        }

        // ---- deal ----
        newGame(sameDeal) {
            const s = this.s;
            this.show = null;
            if (!sameDeal || !this.dealOrder) this.dealOrder = C.shuffle(C.standardDeck(1)).map((c) => [c.suit, c.rank]);
            this.table.stacks.forEach((st) => { st.cards = []; });
            this.deckStack.cards = this.dealOrder.map(([suit, rank]) => C.makeCard(suit, rank, false));
            this.table.arrange(null, { instant: true });
            this.history = [];
            this.passes = 0;
            this.moved = false;
            this.time = 0;
            this.running = false;
            this.ending = false;
            this.lastPenalty = 0;
            this.bonus = 0;
            if (s.scoring === 'vegas') {
                this.score = (s.cumulative ? s.balance : 0) - 52;
                if (s.cumulative) {
                    s.balance = this.score;
                    this.saveSettings();
                }
            } else this.score = 0;
            // seven row stacks dealt left to right a row at a time, the last card of each face up
            let k = 0;
            for (let row = 0; row < 7; row++) {
                for (let col = row; col < 7; col++) {
                    const card = this.deckStack.cards[this.deckStack.cards.length - 1];
                    this.table.move([card], this.rows[col], { delay: k * 35, duration: 200, flip: col === row ? true : undefined, instant: !s.animations });
                    k++;
                }
            }
            this.sounds.play('DEAL_CARDS');
            this.updateStatus();
            this.table.highlight = null;
            this.hintIndex = 0;
            if (s.tips && !this.introShown) {
                this.introShown = true;
                this.showTipId('Start');
            }
            this.armIdle();
        }

        // ---- rules ----
        isHome(st) { return this.homes.includes(st); }
        isRow(st) { return this.rows.includes(st); }

        canPick(stack, i) {
            if (this.ending) return false;
            const card = stack.cards[i];
            if (!card || !card.faceUp) return false;
            if (stack === this.waste || this.isHome(stack)) return i === stack.cards.length - 1;
            return this.isRow(stack);
        }

        // why a drop is illegal (the tip's string id), or null when it is legal
        refusal(stack, cards) {
            const card = cards[0];
            const top = stack.cards[stack.cards.length - 1];
            if (stack === this.waste || stack === this.deckStack) return 63134;
            if (this.isHome(stack)) {
                if (cards.length !== 1) return 42879;
                if (!top) return card.rank === 1 ? null : 60131;
                if (top.suit !== card.suit) return [45864, 60196, 43120, 61728][top.suit];
                return card.rank === top.rank + 1 ? null : 42879;
            }
            if (this.isRow(stack)) {
                if (!top) return card.rank === 13 ? null : 49733;
                if (!top.faceUp) return 56417;
                if (C.isRed(top.suit) === C.isRed(card.suit)) return C.isRed(card.suit) ? 54033 : 62296;
                return card.rank === top.rank - 1 ? null : 56417;
            }
            return 56417;
        }

        canDrop(stack, cards) {
            return this.refusal(stack, cards) === null;
        }

        // ---- scoring ----
        addScore(n, kind) {
            const s = this.s;
            if (s.scoring === 'none') return;
            if (s.scoring === 'vegas') {
                if (kind === 'home') this.score += 5;
                else if (kind === 'unhome') this.score -= 5;
                else return;
                if (s.cumulative) {
                    s.balance = this.score;
                    this.saveSettings();
                }
            } else this.score = Math.max(0, this.score + n);
            this.updateStatus();
        }

        tick(t) {
            // timed Standard: 2 points off every 10 seconds
            if (this.s.scoring === 'standard' && this.s.timed && t > 0 && t % 10 === 0 && t !== this.lastPenalty) {
                this.lastPenalty = t;
                this.score = Math.max(0, this.score - 2);
            }
        }

        // ---- moves (each one undoable) ----
        drop(from, to, cards) {
            this.start();
            const before = this.score;
            this.table.move(cards, to, { duration: 120 });
            let flipped = null;
            const below = from.cards[from.cards.length - 1];
            if (this.isRow(from) && below && !below.faceUp) {
                this.table.flip(below, true);
                flipped = below;
                this.addScore(5);
            }
            if (this.isHome(to)) {
                this.addScore(10, 'home');
                this.sounds.play('SOLITAIRE_MOVEHOME');
            } else this.sounds.play('DROP_CARDSET');
            if (from === this.waste && this.isRow(to)) this.addScore(5);
            if (this.isHome(from) && this.isRow(to)) this.addScore(-15, 'unhome');
            this.history.push({ type: 'move', cards, from, to, flipped, score: before });
            this.moved = true;
            this.afterMove();
        }

        illegalMove(d) {
            const target = this.table.dropTarget(d.x, d.y, d.cards, d.from, { any: true });
            if (!target) return;
            this.sounds.play('ILLEGAL_MOVE');
            const why = this.refusal(target, d.cards);
            if (why) this.showTip(59577, why);
        }

        dealFromDeck() {
            const s = this.s;
            this.start();
            const before = this.score;
            if (!this.deckStack.cards.length) {
                if (!this.waste.cards.length) return;
                if (this.passes + 1 >= this.maxPasses()) {
                    this.sounds.play('ILLEGAL_MOVE');
                    return;
                }
                this.passes += 1;
                this.table.move(this.waste.cards.slice().reverse(), this.deckStack, { flip: false, duration: 160 });
                // Standard: -100 a pass after the first (draw one), -20 a pass after the third (draw three)
                if (s.scoring === 'standard') {
                    if (s.draw === 1) this.addScore(-100);
                    else if (this.passes >= 3) this.addScore(-20);
                }
                this.sounds.play('DEAL_CARDS');
                this.history.push({ type: 'recycle', score: before });
            } else {
                const take = this.deckStack.cards.slice(-Math.min(s.draw, this.deckStack.cards.length)).reverse();
                this.table.move(take, this.waste, { flip: true, stagger: 60, duration: 180 });
                this.sounds.play('DEAL_CARDS');
                this.history.push({ type: 'deal', cards: take, score: before });
            }
            this.moved = true;
            this.afterMove();
        }

        undo() {
            const op = this.history.pop();
            if (!op || this.ending) return;
            this.table.highlight = null;
            this.sounds.play('SHARED_UNDO');
            if (op.type === 'move') {
                if (op.flipped) this.table.flip(op.flipped, false);
                this.table.move(op.cards, op.from, { duration: 160 });
            } else if (op.type === 'deal') {
                this.table.move(op.cards.slice().reverse(), this.deckStack, { flip: false, duration: 160 });
            } else if (op.type === 'recycle') {
                this.passes -= 1;
                this.table.move(this.deckStack.cards.slice().reverse(), this.waste, { flip: true, duration: 160 });
            }
            this.score = op.score;
            this.updateStatus();
        }

        doubleClick(stack, i) {
            this.table.highlight = null;
            if (this.ending || !stack || i < 0 || i !== stack.cards.length - 1) return;
            const card = stack.cards[i];
            if (!card.faceUp || this.isHome(stack)) return;
            const home = this.homes.find((h) => this.canDrop(h, [card]));
            if (home) this.drop(stack, home, [card]);
        }

        // right-click: every card that can go home goes home, one at a time
        sendAllHome() {
            if (this.ending) return;
            const step = () => {
                if (this.ending) return;
                for (const src of [this.waste].concat(this.rows)) {
                    const card = src.cards[src.cards.length - 1];
                    if (!card || !card.faceUp) continue;
                    const home = this.homes.find((h) => this.canDrop(h, [card]));
                    if (home) {
                        this.drop(src, home, [card]);
                        this.later(step, this.s.animations ? 90 : 0);
                        return;
                    }
                }
            };
            step();
        }

        afterMove() {
            this.updateStatus();
            if (this.homes.every((h) => h.cards.length === 13)) {
                this.winGame();
                return;
            }
            this.hintIndex = 0;
            clearTimeout(this.noMovesTimer);
            this.noMovesTimer = setTimeout(() => this.noMoreMoves(), 450);
        }

        // a legal move left anywhere, counting the cards the stock can still reach
        anyMove() {
            const tops = [];
            this.rows.forEach((r) => r.cards.forEach((c, i) => { if (c.faceUp) tops.push({ cards: r.cards.slice(i), from: r }); }));
            const w = this.waste.cards[this.waste.cards.length - 1];
            if (w) tops.push({ cards: [w], from: this.waste });
            for (const t of tops) {
                for (const dest of this.homes.concat(this.rows)) {
                    if (dest === t.from) continue;
                    if (this.isRow(dest) && !dest.cards.length && t.from.cards[0] === t.cards[0]) continue;
                    if (this.canDrop(dest, t.cards)) return true;
                }
            }
            if (this.passes + 1 >= this.maxPasses() && !this.deckStack.cards.length) return false;
            const pool = this.waste.cards.concat(this.deckStack.cards.slice().reverse());
            return pool.some((card) => this.homes.concat(this.rows).some((dest) => this.canDrop(dest, [card])));
        }

        noMoreMoves() {
            if (this.ending || !this.moved || this.anyMove() || this.win.dialogs.length) return;
            VG.taskDialog({
                owner: this.win,
                title: this.pack.string(4024, 'No More Moves'),
                instruction: this.pack.string(4021),
                links: [VG.linkFromString(this.pack.string(4022), 2), VG.linkFromString(this.pack.string(4023), 1)]
            }).then((r) => {
                if (r === 1) this.finish(false);
            });
        }

        // ---- hint: H shows the next useful move (blue on the cards, then where they go), with its
        // tip; again shows the one after. Idle (opts.idle): the glows only.
        hintMoves() {
            const sources = [];
            const w = this.waste.cards[this.waste.cards.length - 1];
            if (w) sources.push({ cards: [w], from: this.waste });
            this.rows.forEach((r) => {
                const i = r.cards.findIndex((c) => c.faceUp);
                if (i < 0) return;
                sources.push({ cards: [r.cards[r.cards.length - 1]], from: r });
                if (i < r.cards.length - 1) sources.push({ cards: r.cards.slice(i), from: r });
            });
            const moves = [];
            for (const src of sources) {
                for (const dest of this.homes.concat(this.rows)) {
                    if (dest === src.from || !this.canDrop(dest, src.cards)) continue;
                    if (this.isRow(dest) && !dest.cards.length && src.from.cards[0] === src.cards[0]) continue;
                    // a single card onto a row: only when it uncovers something or comes from the waste
                    if (this.isRow(dest) && this.isRow(src.from) && src.cards.length === 1 && src.from.cards.length > 1 && src.from.cards[src.from.cards.length - 2].faceUp) continue;
                    moves.push({ cards: src.cards, from: src.from, to: dest });
                    break;
                }
            }
            return moves;
        }

        hint(opts) {
            if (this.ending) return;
            const idle = opts && opts.idle;
            const moves = this.hintMoves();
            if (moves.length) {
                const m = moves[(idle ? opts.index : this.hintIndex) % moves.length];
                if (!idle) this.hintIndex += 1;
                this.table.showHint(m.cards, null, { to: m.to });
                if (idle) return;
                this.sounds.play('HINT_SHOWN');
                this.showTipId(m.cards.length > 1 ? 'CanMoveGroupOnIdle' : (m.cards[0].rank === 1 && this.isHome(m.to) ? 'CanMoveAceOnIdle' : 'CanMoveCardOnIdle'));
                return;
            }
            if (this.deckStack.cards.length || (this.waste.cards.length && this.passes + 1 < this.maxPasses())) {
                const top = this.deckStack.cards[this.deckStack.cards.length - 1];
                this.table.showHint(top ? [top] : [], null, { from: this.deckStack });
                if (idle) return;
                this.sounds.play('HINT_SHOWN');
                this.showTipId('UseDealStackOnIdle');
                return;
            }
            if (idle) return;
            this.sounds.play('HINT_NOMOVE');
            this.showTipId('InvalidHintRequest');
        }

        // ---- win ----
        winGame() {
            this.ending = true;
            this.stopClock();
            this.table.highlight = null;
            this.bonus = this.s.scoring === 'standard' && this.s.timed && this.time >= 30 ? Math.round(700000 / this.time) : 0;
            // counted now: closing the window during the show keeps the win
            this.wonStats = this.record(true);
            const order = [];
            for (let r = 13; r >= 1; r--) this.homes.forEach((h) => { const c = h.cards.find((x) => x.rank === r); if (c) order.push(c); });
            this.show = new C.WinShow(this, order, { onDone: () => this.finish(true) });
            this.win.stage.invalidate();
        }

        stepEffects(now, dt) {
            return this.show ? this.show.step(now, dt) : false;
        }

        drawOver() {
            // an empty stock: O (click to redeal) or, with no passes left, X
            if (!this.deckStack.cards.length && !this.ending) this.table.drawMarker(this.deckStack, this.passes + 1 >= this.maxPasses() ? 'x' : 'o');
            if (this.show) this.show.draw();
            this.drawTip();
        }

        // count a game: the score into the high scores, Vegas money won / lost
        record(won) {
            const st = this.recordResult(won, this.s.scoring !== 'none' && won ? { score: this.score + (this.bonus || 0) } : null);
            if (this.statKey() === 'vegas') {
                st.mostWon = Math.max(st.mostWon || 0, this.score);
                st.mostLost = Math.min(st.mostLost || 0, this.score);
                this.saveStats(st);
            }
            this.moved = false;
            this.store.remove('saved');
            return st;
        }

        recordLoss() {
            return this.record(false);
        }

        finish(won) {
            this.show = null;
            this.ending = false;
            this.running = false;
            if (won) {
                this.showResult(true, this.wonStats || this.stats());
                return;
            }
            this.stopClock();
            this.showResult(false, this.record(false));
        }

        closed() {
            // a win still flying counts (winGame), its dialog is skipped
            super.closed();
            this.wonStats = null;
        }

        // ---- status bar ----
        updateStatus() {
            if (!this.status) return;
            const s = this.s;
            const p = this.pack;
            // the VM pads the seconds to three digits ("Time:  20")
            const t = String(Math.floor(this.elapsed())).padStart(3, ' ');
            this.status.set(1, s.scoring === 'standard' && !s.timed ? p.string(58651, 'Time: -') : fmt(p.string(56510, 'Time: %1'), t));
            if (s.scoring === 'none') this.status.set(2, '');
            else this.status.set(2, fmt(p.string(54528, 'Score: %1'), s.scoring === 'vegas' ? money(this.score) : this.score));
        }

        // ---- save ----
        serialize() {
            return { score: this.score, passes: this.passes, deal: this.dealOrder };
        }

        deserialize(d) {
            this.score = d.score;
            this.passes = d.passes || 0;
            this.dealOrder = d.deal;
        }

        // ---- menus ----
        menuState(id) {
            if (id === CMD.UNDO) return { disabled: !this.history.length || this.ending };
            if (id === CMD.HINT) return { disabled: this.ending };
            return null;
        }

        command(id) {
            const p = this.pack;
            switch (id) {
            case CMD.NEW: this.askNewGame({ title: 118, instruction: 119, newLink: 121, restartLink: 120, keepLink: 122 }); break;
            case CMD.UNDO: this.undo(); break;
            case CMD.HINT: this.hint(); break;
            case CMD.DEAL: if (!this.ending) this.dealFromDeck(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance({ deckLabel: p.string(41994), bgLabel: p.string(42008), randomLabel: p.string(46190) }); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: VG.aboutBox({ owner: this.win, title: p.string(101, 'Solitaire'), text: p.string(903), icon: '/static_images/vista-games/icons/solitaire-48.png' }); break;
            case CMD.HELP: this.showTipId('Start'); break;
            default: break;
            }
        }

        // ---- dialogs ----
        // Game Won (9 timed, with the time bonus; 109 otherwise) or Game Lost (108): Play again,
        // Restart this game (lost), Exit
        showResult(won, st) {
            const p = this.pack;
            const timed = this.s.scoring === 'standard' && this.s.timed;
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            const best = st.best[0];
            const score = this.s.scoring === 'vegas' ? money(this.score) : this.score;
            const texts = won ? {
                1038: fmt(p.string(56266, 'Score: %1'), score),
                1041: fmt(p.string(56510, 'Time: %1'), C.clock(this.time)),
                1045: fmt(p.string(55194, 'Time Bonus: %1'), this.bonus || 0),
                1046: fmt(p.string(46623, 'Total Score: %1'), this.score + (this.bonus || 0)),
                1039: fmt(p.string(51954, 'High score: %1'), best ? best.score : 0),
                1040: fmt(p.string(51899, 'Games played: %1!d!'), st.played),
                1042: fmt(p.string(47827, 'Games won: %1!d!'), st.won),
                1044: fmt(p.string(49592, 'Date: %1'), VG.formatDate(best ? best.date : Date.now())),
                1043: fmt(p.string(57172, 'Win percentage: %1!d!%%'), pct)
            } : {
                1032: fmt(p.string(60009, 'Score: %1'), score),
                1033: fmt(p.string(56510, 'Time: %1'), C.clock(this.time)),
                1030: fmt(p.string(55438, 'High score: %1'), best ? best.score : 0),
                1034: fmt(p.string(57664, 'Games played: %1!d!'), st.played),
                1035: fmt(p.string(56019, 'Games won: %1!d!'), st.won),
                1037: fmt(p.string(55765, 'Date: %1'), VG.formatDate(best ? best.date : Date.now())),
                1036: fmt(p.string(64735, 'Win percentage: %1!d!%%'), pct)
            };
            VG.dialog(p, won ? (timed ? 9 : 109) : 108, {
                owner: this.win,
                title: won ? 'Game Won' : 'Game Lost',
                texts,
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1018 || r === 1016) VG.closeWindow(this.win);
                    else this.newGame(r === 1015);
                }
            });
        }

        showStats() {
            const p = this.pack;
            const kinds = [['timed', p.string(41605, 'Standard timed')], ['untimed', p.string(60026, 'Standard non-timed')], ['vegas', p.string(49974, 'Vegas')]];
            let current = this.statKey();
            const fill = (dlg) => {
                const st = this.stats(current);
                [[1009, 1014], [1010, 1015], [1011, 1016], [1012, 1017], [1013, 1018]].forEach(([t, d], i) => {
                    const e = st.best[i];
                    dlg.text(t, e ? (current === 'vegas' ? money(e.score) : String(e.score)) : '');
                    dlg.text(d, e ? VG.formatDate(e.date) : '');
                });
                const legend = dlg.get(1028) && dlg.get(1028).querySelector('legend');
                if (legend) legend.textContent = p.string(current === 'vegas' ? 62724 : 50756);
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                dlg.text(1022, fmt(p.string(57535, 'Games played: %1!d!'), st.played));
                dlg.text(1023, fmt(p.string(50653, 'Games won: %1!d!'), st.won));
                dlg.text(1024, fmt(p.string(63518, 'Win percentage: %1!d!%%'), pct));
                if (current === 'vegas') {
                    dlg.text(1025, fmt(p.string(62767, 'Most money won: %1'), money(st.mostWon || 0)));
                    dlg.text(1026, fmt(p.string(46309, 'Most money lost: %1'), money(st.mostLost || 0)));
                    dlg.text(1027, fmt(p.string(52053, 'Balance: %1'), money(this.s.balance)));
                } else {
                    dlg.text(1025, fmt(p.string(50808, 'Longest winning streak: %1!d!'), st.longestWin));
                    dlg.text(1026, fmt(p.string(43054, 'Longest losing streak: %1!d!'), st.longestLose));
                    const s = st.streak;
                    dlg.text(1027, s >= 0 ? fmt(p.string(s === 1 ? 57067 : 57066), s) : fmt(p.string(-s === 1 ? 53499 : 53498), -s));
                }
            };
            VG.dialog(p, 105, {
                owner: this.win,
                title: fmt(p.string(60010, 'Solitaire Statistics - %1'), VG.userName()),
                focus: 1021,
                init: (dlg) => {
                    dlg.setList(1021, kinds.map(([value, text]) => ({ value, text })), current);
                    fill(dlg);
                },
                onCommand: (id, dlg, how) => {
                    if (id === 1021 && how === 'change') {
                        current = dlg.listValue(1021);
                        fill(dlg);
                        return false;
                    }
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
            const sync = (dlg) => {
                dlg.enable(1010, dlg.checked(1008));
                dlg.enable(1011, dlg.checked(1007));
            };
            VG.dialog(this.pack, 104, {
                owner: this.win,
                init: (dlg) => {
                    dlg.checked(s.draw === 3 ? 1006 : 1005, true);
                    dlg.checked({ none: 1009, standard: 1007, vegas: 1008 }[s.scoring], true);
                    dlg.checked(1010, s.cumulative);
                    dlg.checked(1011, s.timed);
                    dlg.checked(1012, s.animations);
                    dlg.checked(1013, s.sounds);
                    dlg.checked(1015, s.tips);
                    dlg.checked(1016, s.continueSaved);
                    dlg.checked(1047, s.saveOnExit);
                    sync(dlg);
                },
                onCommand: (id, dlg) => {
                    if ([1007, 1008, 1009].includes(id)) {
                        sync(dlg);
                        return false;
                    }
                    if (id !== 1) return true;
                    const before = { draw: s.draw, scoring: s.scoring, timed: s.timed, cumulative: s.cumulative };
                    const prevKey = this.statKey();
                    Object.assign(s, {
                        draw: dlg.checked(1006) ? 3 : 1,
                        scoring: dlg.checked(1008) ? 'vegas' : (dlg.checked(1007) ? 'standard' : 'none'),
                        cumulative: dlg.checked(1010),
                        timed: dlg.checked(1011),
                        animations: dlg.checked(1012),
                        sounds: dlg.checked(1013),
                        tips: dlg.checked(1015),
                        continueSaved: dlg.checked(1016),
                        saveOnExit: dlg.checked(1047)
                    });
                    this.saveSettings();
                    this.applyLook();
                    if (!s.tips) this.hideTip();
                    if (Object.keys(before).some((k) => before[k] !== s[k])) this.settingsChangedGame(prevKey);
                    this.updateStatus();
                    return true;
                }
            });
        }
    }

    function open() {
        return Promise.all([VG.loadPack(GAME_ID), C.loadAssets()]).then(([pack, assets]) => {
            const first = !game;
            if (!game) game = new Solitaire(pack, assets);
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
                        if (first || !game.table.stacks.some((st) => st.cards.length)) game.newGame(false);
                    });
                }
                return game;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: 'Solitaire',
        icon: '/static_images/vista-games/icons/solitaire',
        thumbnail: '/static_images/vista-games/cardgames/images/rgmh_thumbnail_solitaire.png',
        feature: 'vista_solitaire',
        open
    });
    root.openVistaSolitaire = open;
    root.vistaSolitaire = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
