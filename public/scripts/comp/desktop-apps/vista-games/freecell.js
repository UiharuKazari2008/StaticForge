// FreeCell, as Windows Vista's (Yozora #609), on the card table of cardEngine.js (CardGames.dll's
// Layouts\FreeCellLayout.xml) with FreeCell.exe.mui's menus, dialogs and strings. Game numbers
// 1 to 1,000,000 use Microsoft's deal (the C runtime's rand(): seed * 214013 + 2531011), so game
// N here is game N in Windows (checked against #11850 on the VM). Rules: four free cells, four
// home cells, eight row stacks; a run in alternating colours moves as a unit when there is room
// for it ((free cells + 1) x 2 ^ empty stacks); a run dropped on an empty stack asks how many
// cards to move. Click a card to select it, then click where it goes, or drag it; double-click
// sends a card home (or to a free cell).
//
// Measured on the VM: the 800x496 table over the status bar ("Game #11850", "Cards left: 52").
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const C = VG.Cards;
    const fmt = C.fmt;
    const GAME_ID = 'freecell';

    const CMD = { NEW: 40001, SELECT: 40000, UNDO: 40011, HINT: 40012, STATS: 40003, OPTIONS: 40004, APPEARANCE: 40002, EXIT: 40005, HELP: 40008, ABOUT: 40007 };
    // Microsoft's card order is clubs, diamonds, hearts, spades; the deck sheet's is C, D, S, H
    const MS_SUIT = [C.CLUBS, C.DIAMONDS, C.HEARTS, C.SPADES];

    C.microsoftDeal = function (n) {
        let seed = n >>> 0;
        const deck = [];
        for (let i = 0; i < 52; i++) deck.push(i);
        const out = [];
        for (let i = 0; i < 52; i++) {
            seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
            const r = (seed >>> 16) & 0x7fff;
            const j = 51 - i;
            const k = r % (j + 1);
            out.push(deck[k]);
            deck[k] = deck[j];
        }
        return out.map((c) => [MS_SUIT[c % 4], Math.floor(c / 4) + 1]);
    };

    let game = null;

    class FreeCell extends C.CardGame {
        constructor(pack, assets) {
            super(pack, assets, {
                id: GAME_ID,
                modalId: 'vistaFreeCellModal',
                title: pack.string(101, 'FreeCell'),
                icon: '/static_images/app_icons/48/vista-freecell.webp',
                iconClass: 'fas fa-crown',
                menu: 102,
                accelerators: 110,
                layout: 'Layouts\\FreeCellLayout.xml',
                tips: 'Tips\\FreeCell\\FreeCellTips.xml',
                idleHints: true,
                panes: [{}, { width: 188 }]
            });
            this.cells = [1, 2, 3, 4].map((n) => this.table.stack('FreeCell' + n));
            this.homes = [1, 2, 3, 4].map((n) => this.table.stack('SuitStack' + n));
            this.rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => this.table.stack('Stack' + n));
            this.selected = null; // { stack, index }
            this.sounds.define('FREECELL_WIN', 'FreeCellWin.wma', 0.6);
            this.applyLook();
        }

        tableHooks() {
            return {
                canPick: (stack, i) => this.canPick(stack, i),
                canDrop: (stack, cards, from) => this.refusal(stack, cards, from) === null,
                drop: (from, to, cards) => this.tryMove(from, to, cards),
                dropFailed: (d) => this.illegalMove(d.from, this.table.dropTarget(d.x, d.y, d.cards, d.from, { any: true }), d.cards),
                dragStart: () => this.select(null),
                click: (stack, i) => this.click(stack, i),
                doubleClick: (stack, i) => this.doubleClick(stack, i),
                blocked: () => this.ending,
                drawOver: () => this.drawOver()
            };
        }

        isRow(st) { return this.rows.includes(st); }
        isCell(st) { return this.cells.includes(st); }
        isHome(st) { return this.homes.includes(st); }

        newGame(sameDeal, number) {
            this.show = null;
            if (number) this.number = number;
            else if (!sameDeal || !this.number) this.number = 1 + Math.floor(Math.random() * 32000);
            this.table.stacks.forEach((st) => { st.cards = []; });
            const deal = C.microsoftDeal(this.number);
            // the cards fly from the middle of the table to their stacks
            const cards = deal.map(([suit, rank]) => {
                const c = C.makeCard(suit, rank, true);
                c.x = 365;
                c.y = 200;
                return c;
            });
            this.history = [];
            this.moved = false;
            this.time = 0;
            this.running = false;
            this.ending = false;
            this.selected = null;
            cards.forEach((card, i) => {
                card.stack = null;
                this.table.move([card], this.rows[i % 8], { delay: i * 18, duration: 240, instant: !this.s.animations });
            });
            this.sounds.play('DEAL_CARDS');
            this.updateStatus();
            this.hintIndex = 0;
            if (this.s.tips && !this.introShown) {
                this.introShown = true;
                this.showTipId('Start');
            }
            this.armIdle();
        }

        // ---- rules ----
        sequenceFrom(stack, i) {
            const cards = stack.cards;
            for (let k = i + 1; k < cards.length; k++) {
                if (C.isRed(cards[k].suit) === C.isRed(cards[k - 1].suit) || cards[k].rank !== cards[k - 1].rank - 1) return false;
            }
            return true;
        }

        canPick(stack, i) {
            if (this.ending || !stack.cards[i]) return false;
            if (this.isCell(stack)) return true;
            if (this.isHome(stack)) return false;
            return this.sequenceFrom(stack, i);
        }

        // how many cards one move can carry
        capacity(to) {
            const free = this.cells.filter((c) => !c.cards.length).length;
            const empty = this.rows.filter((r) => !r.cards.length && r !== to).length;
            return (free + 1) * Math.pow(2, empty);
        }

        refusal(stack, cards, from) {
            const card = cards[0];
            const top = stack.cards[stack.cards.length - 1];
            if (stack === from) return 48341;
            if (this.isCell(stack)) return top ? 62207 : (cards.length === 1 ? null : 48341);
            if (this.isHome(stack)) {
                if (cards.length !== 1) return 42965;
                if (!top) return card.rank === 1 ? null : 48652;
                if (top.suit !== card.suit) return [49055, 53870, 59258, 47951][top.suit];
                return card.rank === top.rank + 1 ? null : 42965;
            }
            if (!top) return null; // an empty stack: capacity (or a single card) is decided on drop
            if (C.isRed(top.suit) === C.isRed(card.suit)) return C.isRed(card.suit) ? 49781 : 54743;
            if (card.rank !== top.rank - 1) return 48341;
            if (cards.length > this.capacity(stack)) return 'capacity';
            return null;
        }

        illegalMove(from, target, cards) {
            if (!target) return;
            this.sounds.play('ILLEGAL_MOVE');
            const why = this.refusal(target, cards, from);
            const cap = this.capacity(target);
            if (why === 'capacity') this.showTipId(cap === 1 ? 'MoveTooLargeSingular' : 'MoveTooLarge', cards.length, cap);
            else if (why) this.showTip(48927, why);
        }

        // a drop or a click move; runs onto an empty stack ask first
        tryMove(from, to, cards) {
            const why = this.refusal(to, cards, from);
            if (why) {
                this.illegalMove(from, to, cards);
                this.table.arrange(from);
                return;
            }
            if (this.isRow(to) && !to.cards.length && cards.length > 1) {
                const cap = this.capacity(to);
                VG.taskDialog({
                    owner: this.win,
                    title: this.pack.string(58132, 'Empty Stack'),
                    instruction: this.pack.string(58133),
                    links: [VG.linkFromString(this.pack.string(58134), 1), VG.linkFromString(this.pack.string(58135), 2), VG.linkFromString(this.pack.string(58136), 3)]
                }).then((r) => {
                    if (r === 1) this.doMove(from, to, cards.slice(Math.max(0, cards.length - cap)));
                    else if (r === 2) this.doMove(from, to, cards.slice(-1));
                    else this.table.arrange(from);
                });
                return;
            }
            this.doMove(from, to, cards);
        }

        doMove(from, to, cards) {
            this.start();
            this.select(null);
            this.table.move(cards, to, { duration: 140, stagger: cards.length > 1 ? 25 : 0 });
            this.sounds.play(this.isHome(to) ? 'MOVE_TO_HOME' : 'DROP_CARDSET');
            this.history.push({ cards, from, to });
            this.moved = true;
            this.afterMove();
        }

        undo() {
            const op = this.history.pop();
            if (!op || this.ending) return;
            this.select(null);
            this.sounds.play('SHARED_UNDO');
            this.table.move(op.cards, op.from, { duration: 140 });
            this.hintIndex = 0;
            this.updateStatus();
        }

        // click to select, click the destination to move (the selected card glows)
        click(stack, i) {
            if (this.ending || !stack) return;
            const sel = this.selected;
            if (sel) {
                if (sel.stack === stack) {
                    this.select(null);
                    return;
                }
                const cards = sel.stack.cards.slice(sel.index);
                // onto a row stack: the longest run that fits
                let moving = cards;
                if (this.isRow(stack) && stack.cards.length) {
                    const top = stack.cards[stack.cards.length - 1];
                    const k = cards.findIndex((c) => c.rank === top.rank - 1);
                    if (k >= 0) moving = cards.slice(k);
                } else if (!this.isRow(stack)) moving = cards.slice(-1);
                this.tryMove(sel.stack, stack, moving);
                this.select(null);
                return;
            }
            if (i < 0 || this.isHome(stack)) return;
            // a row stack selects its whole movable run
            let index = i;
            if (this.isRow(stack)) {
                index = stack.cards.length - 1;
                while (index > 0 && this.sequenceFrom(stack, index - 1)) index -= 1;
            }
            this.select({ stack, index });
        }

        select(sel) {
            this.selected = sel;
            this.table.highlight = sel ? { stack: sel.stack, index: sel.index } : null;
            this.win.stage.invalidate();
        }

        doubleClick(stack, i) {
            if (this.ending || !stack || i < 0 || i !== stack.cards.length - 1 || this.isHome(stack)) return;
            const card = stack.cards[i];
            const home = this.homes.find((h) => this.refusal(h, [card], stack) === null);
            if (home) {
                this.doMove(stack, home, [card]);
                return;
            }
            if (this.isRow(stack)) {
                const cell = this.cells.find((c) => !c.cards.length);
                if (cell) this.doMove(stack, cell, [card]);
                else {
                    this.sounds.play('ILLEGAL_MOVE');
                    this.showTipId('NoOpenFreeCells');
                }
            }
        }

        afterMove() {
            this.updateStatus();
            this.hintIndex = 0;
            if (this.homes.every((h) => h.cards.length === 13)) {
                this.winGame();
                return;
            }
            clearTimeout(this.noMovesTimer);
            this.noMovesTimer = setTimeout(() => this.noMoreMoves(), 450);
        }

        movesAvailable() {
            const out = [];
            const sources = this.cells.concat(this.rows).filter((s) => s.cards.length);
            sources.forEach((from) => {
                const top = from.cards.length - 1;
                for (const to of this.homes.concat(this.rows, this.cells)) {
                    if (to === from) continue;
                    let start = top;
                    if (this.isRow(from) && this.isRow(to)) {
                        while (start > 0 && this.sequenceFrom(from, start - 1)) start -= 1;
                        if (to.cards.length) {
                            const t = to.cards[to.cards.length - 1];
                            const k = from.cards.findIndex((c, idx) => idx >= start && c.rank === t.rank - 1);
                            if (k < 0) continue;
                            start = k;
                        } else if (start === 0) continue; // a whole stack onto an empty one
                    }
                    const cards = from.cards.slice(start);
                    if (this.isCell(to) && (cards.length !== 1 || this.isCell(from))) continue;
                    if (this.refusal(to, cards, from) === null) out.push({ from, to, cards });
                }
            });
            return out;
        }

        // FreeCell's own No More Moves box (dialog 130): End Game / Return to Game
        noMoreMoves() {
            if (this.ending || !this.moved || this.movesAvailable().length || this.win.dialogs.length) return;
            VG.dialog(this.pack, 130, {
                owner: this.win,
                onClose: (r) => {
                    if (r === 1) this.finish(false);
                }
            });
        }

        // H: the next move (home first, then onto cards, then into a free cell or an empty
        // stack), blue on the cards and then where they go; again shows the one after
        hint(opts) {
            if (this.ending) return;
            const idle = opts && opts.idle;
            const moves = this.movesAvailable();
            const rank = (m) => (this.isHome(m.to) ? 0 : (m.to.cards.length ? 1 : (this.isCell(m.to) ? 3 : 2)));
            moves.sort((a, b) => rank(a) - rank(b));
            if (!moves.length) {
                if (idle) return;
                this.sounds.play('HINT_NOMOVE');
                this.showTipId('InvalidHintRequested');
                return;
            }
            const m = moves[(idle ? opts.index : (this.hintIndex || 0)) % moves.length];
            if (!idle) this.hintIndex = (this.hintIndex || 0) + 1;
            this.table.showHint(m.cards, null, { to: m.to });
            if (idle) return;
            this.sounds.play('HINT_SHOWN');
            if (this.isHome(m.to)) this.showTipId('SuitStackMoveAvailable');
            else if (this.isCell(m.to)) this.showTipId('NoMovesFreeCellsEmpty');
            else if (!m.to.cards.length) this.showTipId(m.cards.length > 1 ? 'OpenStackManyCards' : 'OpenStackOneCard');
            else this.showTipId('MainStackMoveAvailable');
        }

        // ---- win ----
        winGame() {
            this.ending = true;
            this.stopClock();
            this.select(null);
            // counted now: closing the window during the show keeps the win
            this.wonStats = this.record(true);
            this.sounds.play('FREECELL_WIN');
            const order = [];
            for (let r = 13; r >= 1; r--) this.homes.forEach((h) => { const c = h.cards.find((x) => x.rank === r); if (c) order.push(c); });
            this.show = new C.WinShow(this, order, { onDone: () => this.finish(true) });
        }

        stepEffects(now, dt) {
            return this.show ? this.show.step(now, dt) : false;
        }

        drawOver() {
            if (this.show) this.show.draw();
            this.drawTip();
        }

        record(won) {
            const st = this.recordResult(won);
            this.moved = false;
            this.store.remove('saved');
            return st;
        }

        finish(won) {
            this.show = null;
            this.ending = false;
            this.running = false;
            this.showResult(won, won ? (this.wonStats || this.stats()) : this.record(false));
        }

        closed() {
            super.closed();
            this.selected = null;
            this.wonStats = null;
        }

        updateStatus() {
            if (!this.status) return;
            const p = this.pack;
            this.status.set(0, fmt(p.string(54745, 'Game #%1'), this.number || ''));
            const left = 52 - this.homes.reduce((n, h) => n + h.cards.length, 0);
            this.status.set(1, fmt(p.string(46379, 'Cards left: %1'), left));
        }

        serialize() {
            return { number: this.number };
        }

        deserialize(d) {
            this.number = d.number;
        }

        menuState(id) {
            if (id === CMD.UNDO) return { disabled: !this.history.length || this.ending };
            if (id === CMD.HINT) return { disabled: this.ending };
            return null;
        }

        command(id) {
            const p = this.pack;
            switch (id) {
            case CMD.NEW: this.askNew(false); break;
            case CMD.SELECT: this.askNew(true); break;
            case CMD.UNDO: this.undo(); break;
            case CMD.HINT: this.hint(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance({ deckLabel: p.string(52507), bgLabel: p.string(54956), randomLabel: p.string(59678) }); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: VG.aboutBox({ owner: this.win, title: p.string(101, 'FreeCell'), text: p.string(907), icon: '/static_images/vista-games/icons/freecell-48.png' }); break;
            case CMD.HELP: this.showTipId('Start'); break;
            default: break;
            }
        }

        // New Game / Select Game: in progress, the task dialog first (Quit and choose a game)
        askNew(choose) {
            const p = this.pack;
            if (!this.inProgress()) {
                if (choose) this.selectGame();
                else this.newGame(false);
                return;
            }
            VG.taskDialog({
                owner: this.win,
                title: p.string(58128, 'New Game'),
                instruction: p.string(58114),
                links: [VG.linkFromString(p.string(58123), 1), VG.linkFromString(p.string(58126), 2), VG.linkFromString(p.string(58127), 4), VG.linkFromString(p.string(58113), 3)]
            }).then((r) => {
                if (r !== 1 && r !== 2 && r !== 4) return;
                // choosing a game counts the loss once a number is played
                if (r === 4) {
                    this.selectGame(() => this.recordLoss());
                    return;
                }
                this.recordLoss();
                this.newGame(r === 2);
            });
        }

        selectGame(before) {
            const p = this.pack;
            VG.dialog(p, 118, {
                owner: this.win,
                init: (dlg) => {
                    dlg.text(1016, String(1 + Math.floor(Math.random() * 32000)));
                    setTimeout(() => { const e = dlg.get(1016); e.focus(); e.select(); }, 0);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    const n = parseInt(dlg.text(1016), 10);
                    if (!(n >= 1 && n <= 1000000)) {
                        this.sounds.play('ILLEGAL_MOVE');
                        VG.taskDialog({ owner: this.win, title: p.string(101, 'FreeCell'), instruction: p.string(58130), buttons: [{ id: 1, text: 'OK', default: true }] });
                        return false;
                    }
                    if (before) before();
                    this.newGame(false, n);
                    return true;
                }
            });
        }

        showResult(won, st) {
            const p = this.pack;
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            const percent = fmt(p.string(63341, 'Win percentage: %1!d!%%'), pct);
            const texts = won
                ? { 1020: fmt(p.string(44689, 'Games played: %1!d!'), st.played), 1023: fmt(p.string(43090, 'Games won: %1!d!'), st.won), 1026: percent }
                : { 1044: fmt(p.string(44689, 'Games played: %1!d!'), st.played), 1046: fmt(p.string(43090, 'Games won: %1!d!'), st.won), 1048: percent };
            VG.dialog(p, won ? 109 : 108, {
                owner: this.win,
                title: won ? 'Game Won' : 'Game Lost',
                texts,
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1045 || r === 1036) VG.closeWindow(this.win);
                    else if (r === 1031) this.newGame(true);
                    else this.newGame(false);
                }
            });
        }

        showStats() {
            const p = this.pack;
            const fill = (dlg) => {
                const st = this.stats();
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                dlg.text(1021, fmt(p.string(44689, 'Games played: %1!d!'), st.played));
                dlg.text(1024, fmt(p.string(43090, 'Games won: %1!d!'), st.won));
                dlg.text(1027, fmt(p.string(63341, 'Win percentage: %1!d!%%'), pct));
                dlg.text(1030, fmt(p.string(46905, 'Longest winning streak: %1!d!'), st.longestWin));
                dlg.text(1035, fmt(p.string(46897, 'Longest losing streak: %1!d!'), st.longestLose));
                const s = st.streak;
                dlg.text(1040, s >= 0 ? fmt(p.string(s === 1 ? 63457 : 54339), s) : fmt(p.string(54340), -s));
            };
            VG.dialog(p, 105, {
                owner: this.win,
                title: fmt(p.string(6408, 'FreeCell Statistics - %1'), VG.userName()),
                init: fill,
                onCommand: (id, dlg) => {
                    if (id === 1049) {
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
                    dlg.checked(1022, s.animations);
                    dlg.checked(1025, s.sounds);
                    dlg.checked(1043, s.tips);
                    dlg.checked(1033, s.continueSaved);
                    dlg.checked(1064, s.saveOnExit);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    Object.assign(s, {
                        animations: dlg.checked(1022),
                        sounds: dlg.checked(1025),
                        tips: dlg.checked(1043),
                        continueSaved: dlg.checked(1033),
                        saveOnExit: dlg.checked(1064)
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
            if (!game) game = new FreeCell(pack, assets);
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
        name: 'FreeCell',
        icon: '/static_images/vista-games/icons/freecell',
        thumbnail: '/static_images/vista-games/cardgames/images/rgmh_thumbnail_freecell.png',
        feature: 'vista_freecell',
        open
    });
    root.openVistaFreeCell = open;
    root.vistaFreeCell = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
