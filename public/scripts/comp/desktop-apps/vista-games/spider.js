// Spider Solitaire, as Windows Vista's (Yozora #609), on the card table of cardEngine.js
// (CardGames.dll's layout Layouts\SpiderSolitaireLayout.xml) with SpiderSolitaire.exe.mui's
// menus, dialogs and strings. Rules: 104 cards (one suit, two suits or four), ten row stacks
// (6 cards in the first four, 5 in the rest, the last face up), the deck deals a row of ten
// (never onto an empty stack); a run of one suit can move as a unit onto the next card up of any
// suit; a full King-to-Ace run of one suit leaves for the completed pile. Score: 500, -1 a move,
// +100 a completed suit. The win is a firework show over the table ("You've won!"), then the
// Game Won dialog on a key or click.
//
// Measured on the VM: the 800x496 table over the status bar (Score, Moves padded to three
// digits); the deck sits bottom right, stepping 6 px left every 13 cards.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const C = VG.Cards;
    const fmt = C.fmt;
    const GAME_ID = 'spider';

    // MUI ids (menu 102, accelerators 109: H and M show a move, D deals a row, as XP's Spider did)
    const CMD = { NEW: 40001, UNDO: 40011, HINT: 40012, STATS: 40003, OPTIONS: 40004, APPEARANCE: 40002, EXIT: 40005, HELP: 40008, ABOUT: 40007, DEAL: 40047 };
    const SUITS = { 1: [C.SPADES], 2: [C.SPADES, C.HEARTS], 4: [C.CLUBS, C.DIAMONDS, C.SPADES, C.HEARTS] };
    const DIFF_NAMES = { 1: 53015, 2: 51645, 4: 53110 };

    let game = null;

    class Spider extends C.CardGame {
        constructor(pack, assets) {
            super(pack, assets, {
                id: GAME_ID,
                modalId: 'vistaSpiderModal',
                title: pack.string(101, 'Spider Solitaire'),
                icon: '/static_images/app_icons/48/vista-spider.webp',
                iconClass: 'fas fa-spider',
                menu: 102,
                accelerators: 109,
                layout: 'Layouts\\SpiderSolitaireLayout.xml',
                tips: 'Tips\\SpiderSolitaire\\SpiderSolitaireTips.xml',
                idleHints: true,
                panes: [{}, { width: 161 }, { width: 144 }],
                defaults: { suits: 1, askedDifficulty: false },
                statKind: (s) => 'suits' + s.suits
            });
            this.deckStack = this.table.stack('Deck');
            this.complete = this.table.stack('Complete');
            this.rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => this.table.stack('Stack' + n));
            this.score = 500;
            this.moves = 0;
            this.hintIndex = 0;
            this.applyLook();
        }

        tableHooks() {
            return {
                canPick: (stack, i) => this.canPick(stack, i),
                canDrop: (stack, cards, from) => this.canDrop(stack, cards, from),
                drop: (from, to, cards) => this.drop(from, to, cards),
                dropFailed: (d) => this.illegalMove(d),
                // the deck deals a row; a card is selected, then goes where the next click says
                click: (stack, i) => {
                    if (this.fireworks) this.endFireworks();
                    else if (this.ending) return;
                    else if (stack === this.deckStack && !this.table.highlight) this.dealRow();
                    else if (!this.clickSelect(stack, i) && stack && this.isRow(stack) && stack.cards[i] && stack.cards[i].faceUp) {
                        // a face-up card with a mixed run on it
                        this.sounds.play('ILLEGAL_MOVE');
                        this.showTipId('InvalidGroupMove');
                    }
                },
                keyActivate: (stack, i) => {
                    if (stack === this.deckStack && !this.table.highlight) this.dealRow();
                    else this.keyMove(stack, i, this.places(stack.cards[i]));
                },
                hoverable: (stack, i) => (stack === this.deckStack ? this.deckStack.cards.length > 0 : this.canPick(stack, i)),
                blocked: () => this.ending && !this.fireworks,
                drawOver: () => this.drawOver()
            };
        }

        // where a card can go, best first: onto its own suit, onto another suit, an empty stack
        places(card) {
            const rank = (st) => {
                const top = st.cards[st.cards.length - 1];
                if (!top) return 2;
                return card && top.suit === card.suit ? 0 : 1;
            };
            return this.rows.slice().sort((a, b) => rank(a) - rank(b));
        }

        refuseMove() {
            this.sounds.play('ILLEGAL_MOVE');
            this.showTipId('InvalidSequenceDropMove');
        }

        introTip() {
            this.showTipId(this.s.suits === 1 ? 'Start' : 'StartAdvanced');
        }

        // ---- deal ----
        newGame(sameDeal) {
            const s = this.s;
            this.fireworks = null;
            if (!sameDeal || !this.dealOrder) {
                const suits = SUITS[s.suits] || SUITS[1];
                this.dealOrder = C.shuffle(C.standardDeck(8 / suits.length, suits)).map((c) => [c.suit, c.rank]);
            }
            this.table.stacks.forEach((st) => { st.cards = []; });
            this.deckStack.cards = this.dealOrder.map(([suit, rank]) => C.makeCard(suit, rank, false));
            this.table.arrange(null, { instant: true });
            this.history = [];
            this.moved = false;
            this.time = 0;
            this.running = false;
            this.ending = false;
            this.score = 500;
            this.moves = 0;
            this.hintIndex = 0;
            // 54 cards a row at a time: six in the first four stacks, five in the rest
            let k = 0;
            for (let row = 0; row < 6; row++) {
                this.rows.forEach((stack, col) => {
                    if (row === 5 && col >= 4) return;
                    const last = (col < 4 && row === 5) || (col >= 4 && row === 4);
                    const card = this.deckStack.cards[this.deckStack.cards.length - 1];
                    this.table.move([card], stack, { delay: k * 28, duration: 260, flip: last ? true : undefined, instant: !s.animations });
                    k++;
                });
            }
            this.sounds.play('DEAL_CARDS');
            this.updateStatus();
            this.table.highlight = null;
            if (s.tips && !this.introShown) {
                this.introShown = true;
                this.introTip();
            }
            this.armIdle();
        }

        // ---- rules ----
        isRow(st) { return this.rows.includes(st); }

        // the cards from i down are one suit, each one lower than the last
        canPick(stack, i) {
            if (this.ending || !this.isRow(stack)) return false;
            const cards = stack.cards;
            if (!cards[i] || !cards[i].faceUp) return false;
            for (let k = i + 1; k < cards.length; k++) {
                if (cards[k].suit !== cards[k - 1].suit || cards[k].rank !== cards[k - 1].rank - 1) return false;
            }
            return true;
        }

        refusal(stack, cards, from) {
            if (!this.isRow(stack)) return 53168;
            if (from && from === stack) return 53168;
            const top = stack.cards[stack.cards.length - 1];
            if (!top) return null;
            return top.faceUp && top.rank === cards[0].rank + 1 ? null : 53168;
        }

        canDrop(stack, cards, from) {
            return this.refusal(stack, cards, from) === null;
        }

        countMove() {
            this.moves += 1;
            this.score -= 1;
            this.moved = true;
        }

        drop(from, to, cards) {
            this.start();
            const before = { score: this.score, moves: this.moves };
            this.table.move(cards, to, { duration: 120 });
            const flipped = this.flipTop(from);
            this.countMove();
            this.sounds.play('DROP_CARDSET');
            const op = { type: 'move', cards, from, to, flipped, before };
            this.history.push(op);
            op.completed = this.checkComplete(to);
            this.afterMove();
        }

        flipTop(stack) {
            const below = stack.cards[stack.cards.length - 1];
            if (below && !below.faceUp) {
                this.table.flip(below, true);
                return below;
            }
            return null;
        }

        illegalMove(d) {
            const target = this.table.dropTarget(d.x, d.y, d.cards, d.from, { any: true });
            if (!target) return;
            this.sounds.play('ILLEGAL_MOVE');
            if (this.refusal(target, d.cards, d.from)) this.showTipId('InvalidSequenceDropMove');
        }

        // a full King-to-Ace run of one suit at the bottom of a stack leaves for the completed pile
        checkComplete(stack) {
            const cards = stack.cards;
            if (cards.length < 13) return null;
            const run = cards.slice(-13);
            const ok = run.every((c, i) => c.faceUp && c.suit === run[0].suit && c.rank === 13 - i);
            if (!ok) return null;
            this.table.move(run.slice().reverse(), this.complete, { stagger: 40, duration: 260, delay: 150 });
            this.score += 100;
            this.sounds.play('MOVE_TO_HOME');
            const flipped = this.flipTop(stack);
            return { stack, run, flipped };
        }

        dealRow() {
            this.table.highlight = null;
            if (!this.deckStack.cards.length) {
                this.sounds.play('ILLEGAL_MOVE');
                this.showTipId('InvalidDealRequest');
                return;
            }
            if (this.rows.some((r) => !r.cards.length)) {
                this.sounds.play('ILLEGAL_MOVE');
                // fewer cards out than stacks: only Undo can fill them all
                const out = this.rows.reduce((n, r) => n + r.cards.length, 0);
                this.showTipId(out < this.rows.length ? 'InvalidDrawWhenNotEnoughCards' : 'InvalidDrawWhenEmptyStackMove');
                return;
            }
            this.start();
            const before = { score: this.score, moves: this.moves };
            const dealt = [];
            this.rows.forEach((stack, i) => {
                const card = this.deckStack.cards[this.deckStack.cards.length - 1];
                dealt.push(card);
                this.table.move([card], stack, { delay: i * 45, duration: 240, flip: true });
            });
            this.sounds.play('DEAL_CARDS');
            this.countMove();
            const op = { type: 'deal', cards: dealt, before, completed: [] };
            this.history.push(op);
            this.later(() => {
                this.rows.forEach((r) => {
                    const c = this.checkComplete(r);
                    if (c) op.completed.push(c);
                });
                this.afterMove();
            }, this.s.animations ? 10 * 45 + 260 : 0);
        }

        undo() {
            const op = this.history.pop();
            if (!op || this.ending) return;
            this.table.highlight = null;
            this.sounds.play('SHARED_UNDO');
            const undoComplete = (c) => {
                if (!c) return;
                if (c.flipped) this.table.flip(c.flipped, false);
                this.table.move(c.run, c.stack, { duration: 160 });
            };
            if (op.type === 'move') {
                undoComplete(op.completed);
                if (op.flipped) this.table.flip(op.flipped, false);
                this.table.move(op.cards, op.from, { duration: 160 });
            } else if (op.type === 'deal') {
                op.completed.slice().reverse().forEach(undoComplete);
                this.table.move(op.cards.slice().reverse(), this.deckStack, { flip: false, duration: 160 });
            }
            this.score = op.before.score - 1;
            this.moves = op.before.moves + 1;
            this.updateStatus();
        }

        afterMove() {
            this.updateStatus();
            this.hintIndex = 0;
            if (this.complete.cards.length === 104) {
                this.winGame();
                return;
            }
            clearTimeout(this.noMovesTimer);
            this.noMovesTimer = setTimeout(() => this.noMoreMoves(), 450);
        }

        // the moves worth making, best first: onto the same suit, then ones that turn a card over
        // or empty a stack, then the rest (a run whose parent already continues it is no progress)
        hintMoves() {
            const moves = [];
            this.rows.forEach((from) => {
                for (let i = 0; i < from.cards.length; i++) {
                    if (!this.canPick(from, i)) continue;
                    const cards = from.cards.slice(i);
                    const parent = from.cards[i - 1];
                    if (parent && parent.faceUp && parent.rank === cards[0].rank + 1 && parent.suit === cards[0].suit) continue;
                    this.rows.forEach((to) => {
                        if (to === from || !to.cards.length || !this.canDrop(to, cards, from)) return;
                        const top = to.cards[to.cards.length - 1];
                        const value = (top.suit === cards[0].suit ? 0 : 2) + (!parent || !parent.faceUp ? 0 : 1);
                        moves.push({ cards, from, to, value });
                    });
                }
            });
            return moves.sort((a, b) => a.value - b.value);
        }

        noMoreMoves() {
            if (this.ending || !this.moved || this.win.dialogs.length) return;
            if (this.deckStack.cards.length || this.hintMoves().length || this.rows.some((r) => !r.cards.length)) return;
            const p = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: p.string(4036, 'No More Moves'),
                instruction: p.string(4021),
                links: [VG.linkFromString(p.string(4022), 2), VG.linkFromString(p.string(4023), 1)]
            }).then((r) => {
                if (r === 1) this.finish(false);
            });
        }

        // ---- hint: each H (or M) shows the next possible move; idle: the glows only ----
        hint(opts) {
            if (this.ending) return;
            const idle = opts && opts.idle;
            const moves = this.hintMoves();
            const empty = this.rows.find((r) => !r.cards.length);
            if (moves.length) {
                const m = moves[(idle ? opts.index : this.hintIndex) % moves.length];
                if (!idle) this.hintIndex = (this.hintIndex || 0) + 1;
                this.table.showHint(m.cards, null, { to: m.to });
                if (idle) return;
                this.sounds.play('HINT_SHOWN');
                this.showTipId(m.cards.length > 1 ? 'CanMoveGroupOnIdle' : 'CanMoveCardOnIdle');
            } else if (empty && this.rows.some((r) => r.cards.length)) {
                this.table.showHint([], null, { from: empty });
                if (idle) return;
                this.sounds.play('HINT_SHOWN');
                this.showTipId('UseEmptyStackOnIdle');
            } else if (this.deckStack.cards.length) {
                this.table.showHint([this.deckStack.cards[this.deckStack.cards.length - 1]]);
                if (idle) return;
                this.sounds.play('HINT_SHOWN');
                this.showTipId('UseDealStackOnIdle');
            } else if (!idle) {
                this.sounds.play('HINT_NOMOVE');
                this.showTipId('InvalidHintRequested');
            }
        }

        // ---- win: fireworks ----
        winGame() {
            this.ending = true;
            this.stopClock();
            this.table.highlight = null;
            // counted now: closing the window during the show keeps the win
            this.wonStats = this.record(true);
            const pack = this.assets.pack;
            this.fireworks = {
                defs: [pack.sprite('StarParticle.xml'), pack.sprite('SparkleParticle.xml'), pack.sprite('StreakParticle.xml'), pack.sprite('BlobParticle.xml')],
                particles: [],
                next: VG.now() + 300,
                bursts: 0
            };
            VG.warmSprites(this.win.stage, pack, this.fireworks.defs);
            this.showTipId('ClickToSkipFireworks');
            this.win.stage.invalidate();
        }

        stepEffects(now, dt) {
            const f = this.fireworks;
            if (!f) return false;
            if (now >= f.next && f.bursts < 40) {
                f.bursts += 1;
                f.next = now + 350 + Math.random() * 500;
                const x = 120 + Math.random() * 560;
                const y = 80 + Math.random() * 220;
                const tint = ['#ffd75e', '#7fd4ff', '#ff7f9f', '#b4ff8f', '#ffffff'][Math.floor(Math.random() * 5)];
                const n = 26 + Math.floor(Math.random() * 14);
                for (let i = 0; i < n; i++) {
                    const a = (i / n) * Math.PI * 2;
                    const v = 140 + Math.random() * 120;
                    f.particles.push({ def: f.defs[i % 2], x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now, life: 900 + Math.random() * 500, tint });
                }
                this.sounds.play('FIREWORKS' + (1 + Math.floor(Math.random() * 3)));
            }
            f.particles = f.particles.filter((p) => now - p.born < p.life);
            f.particles.forEach((p) => {
                p.vx *= 0.985;
                p.vy = p.vy * 0.985 + 200 * dt * 0.6;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            });
            if (f.bursts >= 40 && !f.particles.length) this.endFireworks();
            return true;
        }

        endFireworks() {
            if (!this.fireworks) return;
            this.fireworks = null;
            this.hideTip();
            this.finish(true);
        }

        keyDown(e) {
            if (this.fireworks) this.endFireworks();
            else super.keyDown(e);
        }

        drawOver() {
            const f = this.fireworks;
            if (f) {
                const st = this.win.stage;
                const ctx = st.ctx;
                const now = VG.now();
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                f.particles.forEach((p) => {
                    const a = Math.max(0, 1 - (now - p.born) / p.life);
                    st.sprite(p.def, p.x - p.def.w / 4, p.y - p.def.h / 4, { alpha: a, w: p.def.w / 2, h: p.def.h / 2 });
                });
                ctx.restore();
                ctx.save();
                ctx.font = '27px "Segoe UI", "Noto Sans", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#fff';
                ctx.shadowColor = '#0008';
                ctx.shadowBlur = 6;
                ctx.fillText(this.pack.string(55851, "You've won!"), 400, 250);
                ctx.restore();
            }
            this.drawTip();
        }

        // count a game: a win's score into the best scores
        record(won) {
            const st = this.recordResult(won, won ? { score: this.score, moves: this.moves } : null);
            this.moved = false;
            this.store.remove('saved');
            return st;
        }

        finish(won) {
            this.ending = false;
            this.running = false;
            this.showResult(won, won ? (this.wonStats || this.stats()) : this.record(false));
        }

        closed() {
            super.closed();
            this.fireworks = null;
            this.wonStats = null;
        }

        // ---- status bar ----
        updateStatus() {
            if (!this.status) return;
            const p = this.pack;
            this.status.set(1, fmt(p.string(60236, 'Score: %1!d!'), this.score));
            this.status.set(2, fmt(p.string(54787, 'Moves: %1'), String(this.moves).padStart(3, ' ')));
        }

        serialize() {
            return { score: this.score, moves: this.moves, deal: this.dealOrder };
        }

        deserialize(d) {
            this.score = d.score;
            this.moves = d.moves;
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
            if (this.fireworks) this.endFireworks();
            switch (id) {
            case CMD.NEW: this.askNewGame({ title: 4024, instruction: 4017, newLink: 4018, restartLink: 4019, keepLink: 4020 }); break;
            case CMD.UNDO: this.undo(); break;
            case CMD.HINT: this.hint(); break;
            case CMD.DEAL: if (!this.ending) this.dealRow(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance({ deckLabel: p.string(64949), bgLabel: p.string(60618), randomLabel: p.string(52175) }); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: VG.aboutBox({ owner: this.win, title: p.string(101, 'Spider Solitaire'), text: p.string(903), icon: '/static_images/vista-games/icons/spider-48.png' }); break;
            case CMD.HELP: this.introTip(); break;
            default: break;
            }
        }

        askDifficulty() {
            const p = this.pack;
            this.s.askedDifficulty = true;
            this.saveSettings();
            return VG.taskDialog({
                owner: this.win,
                title: p.string(4037, 'Select Difficulty'),
                instruction: p.string(50000),
                // (link ids clear of 2, the close button's)
                links: [VG.linkFromString(p.string(50001), 11), VG.linkFromString(p.string(50002), 12), VG.linkFromString(p.string(50003), 14)],
                footer: p.string(50004),
                width: 400
            }).then((r) => {
                if (SUITS[r - 10]) {
                    this.s.suits = r - 10;
                    this.saveSettings();
                }
            });
        }

        // ---- dialogs ----
        showResult(won, st) {
            const p = this.pack;
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            const best = st.best[0];
            VG.dialog(p, won ? 133 : 131, {
                owner: this.win,
                title: won ? 'Game Won' : 'Game Lost',
                texts: {
                    1044: fmt(p.string(60236, 'Score: %1!d!'), this.score),
                    1043: fmt(p.string(60235, 'Moves: %1!d!'), this.moves),
                    1041: fmt(p.string(60234, 'High score: %1!d!'), best ? best.score : 0),
                    1042: fmt(p.string(59988, 'Date: %1'), VG.formatDate(best ? best.date : Date.now())),
                    1038: fmt(p.string(60221, 'Games played: %1!d!'), st.played),
                    1039: fmt(p.string(60222, 'Games won: %1!d!'), st.won),
                    1040: fmt(p.string(60223, 'Win percentage: %1!d!%%'), pct)
                },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1017 || r === 1001) VG.closeWindow(this.win);
                    else this.newGame(r === 1002);
                }
            });
        }

        showStats() {
            const p = this.pack;
            let current = this.statKey();
            const fill = (dlg) => {
                const st = this.stats(current);
                [[1022, 1027], [1023, 1028], [1024, 1029], [1025, 1030], [1026, 1031]].forEach(([t, d], i) => {
                    const e = st.best[i];
                    dlg.text(t, e ? String(e.score) : '');
                    dlg.text(d, e ? VG.formatDate(e.date) : '');
                });
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                dlg.text(1032, fmt(p.string(60221), st.played));
                dlg.text(1033, fmt(p.string(60222), st.won));
                dlg.text(1034, fmt(p.string(60223), pct));
                dlg.text(1036, fmt(p.string(60224), st.longestWin));
                dlg.text(1035, fmt(p.string(60225), st.longestLose));
                const s = st.streak;
                dlg.text(1037, s >= 0 ? fmt(p.string(s === 1 ? 58171 : 60227), s) : fmt(p.string(-s === 1 ? 53138 : 60226), -s));
            };
            VG.dialog(p, 144, {
                owner: this.win,
                title: fmt(p.string(60220, 'Spider Solitaire Statistics - %1'), VG.userName()),
                focus: 1020,
                init: (dlg) => {
                    dlg.setList(1020, [1, 2, 4].map((n) => ({ value: 'suits' + n, text: p.string(DIFF_NAMES[n]) })), current);
                    fill(dlg);
                },
                onCommand: (id, dlg, how) => {
                    if (id === 1020 && how === 'change') {
                        current = dlg.listValue(1020);
                        fill(dlg);
                        return false;
                    }
                    if (id === 1001) {
                        this.confirmResetStats(() => fill(dlg));
                        return false;
                    }
                    return true;
                }
            });
        }

        showOptions() {
            const s = this.s;
            VG.dialog(this.pack, 149, {
                owner: this.win,
                init: (dlg) => {
                    dlg.checked({ 1: 1010, 2: 1011, 4: 1013 }[s.suits] || 1010, true);
                    dlg.checked(1002, s.animations);
                    dlg.checked(1003, s.sounds);
                    dlg.checked(1005, s.tips);
                    dlg.checked(1012, s.continueSaved);
                    dlg.checked(1047, s.saveOnExit);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    const suits = dlg.checked(1013) ? 4 : (dlg.checked(1011) ? 2 : 1);
                    const changed = suits !== s.suits;
                    const prevKey = this.statKey();
                    Object.assign(s, {
                        suits,
                        animations: dlg.checked(1002),
                        sounds: dlg.checked(1003),
                        tips: dlg.checked(1005),
                        continueSaved: dlg.checked(1012),
                        saveOnExit: dlg.checked(1047)
                    });
                    this.saveSettings();
                    this.applyLook();
                    if (!s.tips) this.hideTip();
                    if (changed) this.settingsChangedGame(prevKey);
                    return true;
                }
            });
        }
    }

    function open() {
        return Promise.all([VG.loadPack(GAME_ID), C.loadAssets()]).then(([pack, assets]) => {
            const first = !game;
            if (!game) game = new Spider(pack, assets);
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
                        if (!first && game.table.stacks.some((st) => st.cards.length)) return;
                        if (!game.s.askedDifficulty) game.askDifficulty().then(() => game.newGame(false));
                        else game.newGame(false);
                    });
                }
                return game;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: 'Spider Solitaire',
        icon: '/static_images/vista-games/icons/spider',
        thumbnail: '/static_images/vista-games/cardgames/images/rgmh_thumbnail_spider.png',
        feature: 'vista_spider',
        open
    });
    root.openVistaSpider = open;
    root.vistaSpider = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
