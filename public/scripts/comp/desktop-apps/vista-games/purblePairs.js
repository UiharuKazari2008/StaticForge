// Purble Place: Purble Pairs, the school (Yozora #609). The layout is
// UI\Concentration\ConcentrationGame.xml: the classroom (UI\Concentration\Background.png), the
// game board (GameBoard.png at 150, 2, 95 %), the glass jar the matched pictures fall into
// (JarContainer 15, 315), the Sneak Peek coin holder (SneakPeekContainer 0, 398), the board
// progress icons on the chalkboard (ProgressMeterContainer 665, 40, 55 px apart), the time meter
// (TimeBarContainer, Intermediate / Advanced with the timer on) and the professor's movies
// (ProfessorContainer 295, 70: Pro_Enter / Pro_Talking / Pro_Idle / Pro_Win / Pro_Lose / Pro_Exit).
// Cards.xml lists the pictures; the backs change per board (shamrock, heart, smiley, gumdrop);
// the levels' CardPairs say which pairs a board holds (purbleRules.js pairsDeck).
//
// Measured on the VM (Beginner): the 5 x 5 tiles are the 141 px card buttons at 0.56 (84.5 px
// apart, the grid centred on the board at 380, 237); a click turns the tile over sideways, a
// second picture that does not match turns both back after about a second; the Score / Tiles
// Turned panes are the status bar's second and third; the professor walks in and talks while the
// How To Play tip (617, 152) is up; the bonus coin sits on a tile's top-left corner.
// The jar fills from the bottom: the n-th pair's picture goes at the n-th point of the board's
// <back>_Points.xml (28 spots: the corner of the card-sized picture box in the jar; the size, 35 %
// of the card, is fitted to the jar - not seen on the VM, which never got a jar filled). The Game Lost box hides the high score and its
// date until there is one (DialogConcentrationLose, PurblePlace.exe).
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const PP = root.VistaPurble = root.VistaPurble || {};
    const DIFF_NAMES = ['Beginner', 'Intermediate', 'Advanced'];
    // the grid (cards + spacing + borders, scaled) fills this square, centred here (VM Beginner)
    const GRID_SIZE = 428;
    const GRID_CX = 380;
    const GRID_CY = 237;
    const CARD_W = 141;
    const CARD_H = 146;
    const FLIP_MS = 260;
    const MISS_MS = 1000;
    // the balloon's box on the VM: 617, 152 - 785, 268 (anchored by its lower edge)
    const TIP_AT = { x: 617, bottom: 268, w: 175 };
    const JAR_ITEM = 0.35;

    class Pairs {
        constructor(pp) {
            this.pp = pp;
            this.id = 'pairs';
            const pack = this.pack = pp.pack;
            const doc = pack.xml('UI\\Concentration\\ConcentrationGame.xml');
            this.doc = doc;
            const pos = (tag) => {
                const n = VG.child(doc, tag);
                return { x: VG.num(n, 'x', VG.num(n, 'X', 0)), y: VG.num(n, 'y', VG.num(n, 'Y', 0)), n };
            };
            const spriteOf = (tag) => {
                const n = VG.child(doc, tag);
                return pack.sprite(VG.text(VG.child(n, 'Desc'), 'Sprite'));
            };
            const k = VG.child(doc, 'Constants');
            this.k = {
                sneakBonus: VG.num(k, 'SneakMatchBonus', 20),
                coinFreq: VG.num(k, 'SneakPeakIconFreq', 10),
                coinDur: VG.num(k, 'SneakPeakIconDur', 20),
                points: VG.num(k, 'MatchPointsNormal', 10),
                reveal: VG.num(k, 'SneakRevealDuration', 45) / 10,
                timeBonus: VG.num(k, 'TimeBonusPercent', 25),
                sneakTime: VG.num(k, 'SneakTimeDecrement', 5)
            };
            this.modes = VG.children(VG.child(doc, 'DifficultyModes')).map((m) => ({
                tokens: VG.num(m, 'NumStartTokens', 0),
                tricky: VG.num(m, 'NumTricky', 0),
                superTricky: VG.num(m, 'NumSuperTricky', 0),
                cols: VG.num(m, 'NumCols', 5),
                rows: VG.num(m, 'NumRows', 5),
                spacing: VG.num(m, 'XSpacing', 10),
                levels: VG.children(VG.child(m, 'Levels'), 'Level').map((l) => ({
                    time: VG.num(l, 'TotalTime', 0),
                    pairs: VG.text(l, 'CardPairs')
                }))
            }));
            this.background = pack.sprite('UI\\Concentration\\Hearts.xml');
            const play = VG.child(doc, 'PlayArea');
            this.board = { sprite: spriteOf('PlayArea'), x: VG.num(play, 'x', 150), y: VG.num(play, 'y', 2), scale: VG.num(play, 'scale', 95) / 100 };
            this.jar = pos('JarContainer');
            this.jarBase = spriteOf('JarBase');
            this.jarBkg = spriteOf('JarBkg');
            this.jarFg = spriteOf('JarFg');
            this.sneak = pos('SneakPeekContainer');
            this.sneakArea = spriteOf('SneakPeekBackground');
            this.tokenSprite = spriteOf('SneakPeekTokenAnimate');
            this.tokenSlots = VG.children(VG.child(doc, 'SneakPeekTokens'), 'SneakPeekToken').map((t) => ({ x: VG.num(t, 'x', 0), y: VG.num(t, 'y', 0) }));
            this.progress = pos('ProgressMeterContainer');
            this.progressStep = VG.num(VG.child(doc, 'ProgressMeterIndicators'), 'yOffSet', 55);
            this.timeBar = pos('TimeBarContainer');
            this.timeBkg = spriteOf('TimeBarBkg');
            this.timeGreen = spriteOf('TimeBarGreen');
            this.timeRed = spriteOf('TimeBarRed');
            this.timeCover = pack.sprite('UI\\Concentration\\TimerBar_Cover.xml');
            this.prof = pos('ProfessorContainer');
            const movie = (tag) => PP.movie(pack, VG.text(VG.child(VG.child(doc, tag), 'Desc'), 'Movie'));
            this.movies = {
                enter: movie('ProfessorEnterAnimation'), exit: movie('ProfessorExitAnimation'), talk: movie('ProfessorTalkAnimation'),
                idle: movie('ProfessorIdleAnimation'), lose: movie('ProfessorLoseAnimation'), win: movie('ProfessorWinAnimation'),
                bonus: movie('BonusTileAnimation'), sneak: movie('SneakMovie'), fireworks: movie('FireWorks')
            };
            this.home = { item: { x: VG.num(VG.child(doc, 'ReturnToMainMenu'), 'X', 700), y: VG.num(VG.child(doc, 'ReturnToMainMenu'), 'Y', 440) }, sprite: pack.sprite(VG.text(VG.child(VG.child(doc, 'ReturnToMainMenu'), 'Desc'), 'Button')) };
            // the card backs per board: button (normal / hot / pressed), the picture, the progress icon
            this.backs = VG.children(pack.xml('UI\\Concentration\\CardBacks.xml'), 'Back').map((b) => ({
                button: pack.sprite(VG.text(b, 'buttonpath')),
                image: pack.sprite(VG.text(b, 'imagepath')),
                progress: pack.sprite(VG.text(b, 'progpath')),
                burst: VG.text(b, 'moviepath'),
                // the jar spots: Shamrock_Points.xml ... (one <ImageInstance> per spot)
                points: VG.children(pack.xml('UI\\Concentration\\' + VG.text(b, 'desc') + '_Points.xml'), 'ImageInstance').map((i) => {
                    const f = (VG.child(i, 'Frame') || {}).a || {};
                    return { x: parseFloat(f.x) || 0, y: parseFloat(f.y) || 0 };
                })
            })).filter((b) => b.button);
            this.cards = VG.children(pack.xml('UI\\Concentration\\Cards.xml'), 'Card').map((c) => ({
                id: VG.num(c, 'id'), type: VG.num(c, 'type'), chef: /true|1/i.test(VG.text(c, 'chefitem')), sprite: pack.sprite(VG.text(c, 'path'))
            })).filter((c) => c.sprite);
            this.cardById = {};
            this.cards.forEach((c) => { this.cardById[c.id] = c; });
            this.blank = pack.sprite('UI\\Concentration\\BlankCardButton.xml');
            this.outline = pack.sprite('UI\\Concentration\\Highlite_Outline.xml');
            this.coinIcon = pack.sprite('UI\\Concentration\\SneakPeakMiniIcon.xml');
            this.tips = PP.loadTips(pack, 'UI\\Concentration\\Tips.xml');
            this.cells = [];
            this.anims = [];
            this.profState = null;
            this.active = true;
        }

        sprites() {
            const list = [this.background, this.board.sprite, this.jarBase, this.jarBkg, this.jarFg, this.sneakArea, this.tokenSprite,
                this.timeBkg, this.timeGreen, this.timeRed, this.timeCover, this.blank, this.outline, this.coinIcon, this.home.sprite];
            this.backs.forEach((b) => list.push(b.button, b.image, b.progress));
            this.cards.forEach((c) => list.push(c.sprite));
            Object.values(this.movies).forEach((m) => { if (m) list.push(...m.sprites()); });
            return list.filter(Boolean);
        }

        warm() {
            return this.pp.warm(this.sprites());
        }

        get s() {
            return this.pp.s.pairs;
        }

        // ---- game ----
        begin(saved) {
            const d = saved && saved.difficulty !== undefined ? saved.difficulty : this.s.difficulty;
            this.diff = d;
            this.mode = this.modes[d] || this.modes[0];
            this.timed = d > 0 && !(saved && saved.timerOff !== undefined ? saved.timerOff : this.s.timerOff);
            this.points = 0;
            this.turned = 0;
            this.matchedTiles = 0;
            this.tokens = Math.min(3, this.mode.tokens);
            this.moved = false;
            this.over = false;
            this.anims = [];
            this.shownTips = {};
            this.peekUntil = 0;
            this.fireworks = null;
            this.gen = (this.gen || 0) + 1;
            this.res = null;
            if (saved) {
                Object.assign(this, {
                    level: saved.level, points: saved.points, turned: saved.turned, matchedTiles: saved.matchedTiles,
                    tokens: saved.tokens, timeLeft: saved.timeLeft, moved: true
                });
                this.timeTotal = (this.mode.levels[saved.level] || {}).time || 0;
                this.layout(saved.cards.length);
                this.cells.forEach((c, i) => {
                    c.card = saved.cards[i];
                    c.matched = !!saved.matched[i];
                });
                this.coin = saved.coin;
            } else {
                this.startLevel(0);
            }
            this.coinTurns = 0;
            this.lastTick = VG.now();
            this.profPlay('enter', false, () => {
                if (!saved && this.pp.s.tips) {
                    const first = !this.pp.s.pairsIntroShown;
                    this.tip(first ? 'ProIntro' : 'ProWelcome', true);
                    this.pp.s.pairsIntroShown = true;
                    this.pp.saveSettings();
                } else this.profPlay('idle', true);
            });
            if (saved) this.pp.playSound('Con_NewScreen');
            this.pp.updateStatus();
        }

        startLevel(level) {
            const L = this.mode.levels[level] || this.mode.levels[0];
            this.level = level;
            this.timeTotal = L.time || 0;
            this.timeLeft = this.timeTotal;
            this.layout(this.mode.cols * this.mode.rows);
            const deck = PP.Rules.pairsDeck({ pairs: L.pairs, tricky: this.mode.tricky, superTricky: this.mode.superTricky }, this.cells.length, this.cards);
            this.cells.forEach((c, i) => { c.card = deck[i]; });
            this.coin = Math.floor(Math.random() * this.cells.length);
            this.open = [];
            // the new board deals in: each tile grows from its centre, in a scattered order (VM)
            const now = VG.now();
            const order = PP.Rules.shuffle(this.cells.map((c) => c.i));
            order.forEach((i, n) => { this.cells[i].dealAt = now + 150 + n * (900 / this.cells.length); });
            this.pp.playSound('Con_NewScreen');
        }

        layout(count) {
            const m = this.mode;
            const sp = m.spacing;
            const n = m.cols;
            const k = GRID_SIZE / (n * CARD_W + (n - 1) * sp + 20);
            this.k = Object.assign(this.k || {}, {});
            this.scale = k;
            const left = GRID_CX - GRID_SIZE / 2 + 10 * k;
            const top = GRID_CY - GRID_SIZE / 2 + 10 * k;
            this.cells = [];
            for (let i = 0; i < count; i++) {
                const col = i % n;
                const row = Math.floor(i / n);
                this.cells.push({
                    i, col, row, card: 0, matched: false, up: false, flipAt: 0,
                    x: left + col * (CARD_W + sp) * k, y: top + row * (CARD_H + sp) * k, w: CARD_W * k, h: CARD_H * k
                });
            }
            this.open = [];
        }

        typeOf(id) {
            const c = this.cardById[id];
            return c ? c.type : 0;
        }

        cellAt(p) {
            return this.cells.find((c) => p.x >= c.x && p.y >= c.y && p.x < c.x + c.w && p.y < c.y + c.h) || null;
        }

        click(cell) {
            if (this.over || this.busy()) return;
            if (cell.matched) {
                this.tip('BlankCard');
                return;
            }
            if (cell.up) return;
            if (this.open.length >= 2) this.closeOpen();
            this.flip(cell, true);
            this.turned += 1;
            this.moved = true;
            this.open.push(cell);
            this.pp.playSound('Con_TileFlip');
            this.firstFlipTip(cell);
            this.moveCoin();
            if (this.open.length === 2) this.judge();
            this.pp.updateStatus();
        }

        flip(cell, up) {
            cell.up = up;
            cell.flipAt = VG.now();
        }

        closeOpen() {
            this.open.forEach((c) => { if (!c.matched) this.flip(c, false); });
            this.open = [];
            clearTimeout(this.missTimer);
        }

        judge() {
            const [a, b] = this.open;
            const r = PP.Rules.pairsMatch(a.card, b.card, (id) => this.typeOf(id));
            if (r === 'miss') {
                this.pp.playSound('Con_TileFlip_Incorrect');
                this.missTimer = setTimeout(() => {
                    if (this.open[0] === a && this.open[1] === b) this.closeOpen();
                    this.invalidate();
                }, FLIP_MS + MISS_MS);
                return;
            }
            const pair = [a, b];
            if (r === 'joker') {
                // the joker finds the other tile's partner
                const other = this.typeOf(a.card) === 8 ? b : a;
                if (this.typeOf(other.card) !== 8) {
                    const partner = this.cells.find((c) => !c.matched && c !== other && c !== a && c !== b && c.card === other.card);
                    if (partner) {
                        this.flip(partner, true);
                        pair.push(partner);
                    }
                }
            }
            this.open = [];
            this.later(() => this.matched(pair), FLIP_MS + 250);
        }

        matched(cells) {
            const type = this.typeOf(cells[0].card === cells[1].card ? cells[0].card : (this.typeOf(cells[0].card) === 8 ? cells[1].card : cells[0].card));
            cells.forEach((c) => {
                c.matched = true;
                c.matchedAt = VG.now();
                this.flyToJar(c);
            });
            this.matchedTiles += cells.length;
            this.points += this.k.points;
            this.pp.playSound('Con_Correct');
            if (cells.some((c) => c.i === this.coin)) {
                this.tokens = Math.min(3, this.tokens + 1);
                this.points += this.k.sneakBonus;
                this.pp.playSound('Con_SneakPeek_Get');
                this.anims.push({ kind: 'bonus', movie: this.movies.bonus, at: VG.now(), x: cells[0].x + cells[0].w / 2, y: cells[0].y + cells[0].h / 2 });
                this.coin = -1;
                this.moveCoin(true);
            }
            if (!this.shownTips.firstMatch) {
                this.shownTips.firstMatch = true;
                this.tip(this.timed ? 'ProFlipNoMatchTimed' : 'ProFlipMatchUntimed');
            }
            if (type === 3) this.mix();
            else if (type === 6 && this.timed) {
                this.timeLeft = Math.min(this.timeTotal, this.timeLeft + this.timeTotal * this.k.timeBonus / 100);
                this.timeGlow = VG.now();
                this.pp.playSound('Con_TimeDelay');
            } else if (type === 1) this.chefTakesCake();
            this.pp.updateStatus();
            this.invalidate();
            if (this.cells.every((c) => c.matched)) this.later(() => this.boardDone(), 700);
        }

        // the matched picture's back item arcs into the jar (ArcAnimation: 25 frames)
        flyToJar(cell) {
            const back = this.backs[this.level % this.backs.length];
            if (!back || !back.image) return;
            this.anims.push({ kind: 'arc', sprite: back.image, at: VG.now(), x0: cell.x + cell.w / 2, y0: cell.y + cell.h / 2, x1: this.jar.x + 56, y1: this.jar.y + 30, scale: this.scale });
            this.jarCount = (this.jarCount || 0) + 1;
        }

        // the mixer: every tile still face down trades places
        mix() {
            const rest = this.cells.filter((c) => !c.matched);
            const cards = PP.Rules.shuffle(rest.map((c) => c.card));
            rest.forEach((c, i) => {
                c.card = cards[i];
                c.mixAt = VG.now();
            });
            if (this.coin >= 0 && this.cells[this.coin].matched) this.coin = -1;
            this.pp.playSound('Con_Mixer');
        }

        // the Purble Chef takes a cake pair off the board
        chefTakesCake() {
            const rest = this.cells.filter((c) => !c.matched && this.cardById[c.card] && this.cardById[c.card].chef);
            for (const c of rest) {
                const twin = rest.find((o) => o !== c && o.card === c.card);
                if (twin) {
                    this.pp.playSound('Con_PurbleChef');
                    [c, twin].forEach((t) => this.flip(t, true));
                    this.later(() => this.matched([c, twin]), 900);
                    return;
                }
            }
        }

        moveCoin(force) {
            this.coinTurns = (this.coinTurns || 0) + 1;
            if (!force && this.coin >= 0 && this.coinTurns < this.k.coinFreq) return;
            this.coinTurns = 0;
            const free = this.cells.filter((c) => !c.matched && !c.up);
            this.coin = free.length && Math.random() < 0.85 ? free[Math.floor(Math.random() * free.length)].i : -1;
        }

        firstFlipTip(cell) {
            const t = this.typeOf(cell.card);
            const id = { 3: 'MixerFlip', 6: 'ClockFlip', 8: 'JokerFlip', 1: 'ChefFlip' }[t];
            if (id && !this.shownTips[id]) {
                this.shownTips[id] = true;
                this.tip(id);
            } else if (cell.i === this.coin && !this.shownTips.SneakFlip) {
                this.shownTips.SneakFlip = true;
                this.tip('SneakFlip');
            }
        }

        useToken(slot) {
            if (this.over || this.peekUntil > VG.now()) return;
            if (slot >= this.tokens) {
                this.tip('EmptySneak');
                return;
            }
            this.tokens -= 1;
            this.closeOpen();
            this.pp.playSound('Con_SneakPeek_Click');
            this.pp.playSound('Con_SneakPeek_Starburst');
            const sx = this.sneak.x + this.tokenSlots[slot].x + 22;
            const sy = this.sneak.y + this.tokenSlots[slot].y + 22;
            this.anims.push({ kind: 'bonus', movie: this.movies.sneak, at: VG.now(), x: sx, y: sy });
            this.peekUntil = VG.now() + this.k.reveal * 1000;
            this.cells.forEach((c) => { if (!c.matched) this.flip(c, true); });
            if (this.timed) this.timeLeft = Math.max(1, this.timeLeft - this.k.sneakTime);
            this.moved = true;
            if (!this.shownTips.SneakPeak) {
                this.shownTips.SneakPeak = true;
                this.tip('SneakPeak');
            }
            this.later(() => {
                this.cells.forEach((c) => { if (!c.matched) this.flip(c, false); });
                this.peekUntil = 0;
                this.invalidate();
            }, this.k.reveal * 1000);
            this.invalidate();
        }

        busy() {
            return this.peekUntil > VG.now() || this.cells.some((c) => c.mixAt && VG.now() - c.mixAt < 600);
        }

        boardDone() {
            if (this.over) return;
            const last = this.level >= this.mode.levels.length - 1;
            this.anims.push({ kind: 'burst', movie: PP.movie(this.pack, (this.backs[this.level % this.backs.length] || {}).burst || ''), at: VG.now() });
            if (!last) {
                this.tip(this.diff === 2 ? 'ProAdvLevelChange' : 'ProIntLevelChange');
                this.levelDoneAt = VG.now();
                this.later(() => {
                    this.startLevel(this.level + 1);
                    this.jarCount = 0;
                    this.pp.updateStatus();
                    this.invalidate();
                }, 2000);
                return;
            }
            this.win();
        }

        win() {
            this.over = true;
            this.pp.playSound('Con_Win');
            this.profPlay('win', false, () => this.profPlay('idle', true));
            this.fireworks = VG.now();
            this.tip('ProWin' + (1 + Math.floor(Math.random() * 3)));
            this.settle(true);
            this.later(() => this.finish(true), 3500);
        }

        // a timer for this game only (not after New Game, the town or closing the window)
        later(fn, ms) {
            const gen = this.gen;
            setTimeout(() => {
                if (gen === this.gen && this.pp.mod === this && this.pp.win.isOpen()) fn();
            }, ms);
        }

        lose() {
            this.over = true;
            this.timeLeft = 0;
            this.pp.playSound('Con_GameOver');
            this.profPlay('lose', false, () => this.profPlay('idle', true));
            this.tip('ProLose' + (1 + Math.floor(Math.random() * 2)));
            this.cells.forEach((c) => { if (!c.matched) this.flip(c, true); });
            this.settle(false);
            this.later(() => this.finish(false), 3000);
        }

        // the score and the statistics, recorded as the game ends (the box comes after the movie)
        settle(won) {
            const pp = this.pp;
            const sc = PP.Rules.pairsScore({
                difficulty: this.diff, timed: this.timed, points: this.points, tilesTurned: this.turned,
                tilesMatched: Math.max(1, this.matchedTiles), secondsLeft: Math.floor(this.timeLeft), totalSeconds: this.timeTotal
            });
            const st = pp.recordGame('pairs' + this.diff, { won, score: sc.final, avg: this.turned });
            this.moved = false;
            this.res = { won, sc, st };
            return this.res;
        }

        finish(won) {
            const p = this.pack;
            const pp = this.pp;
            const { sc, st } = this.res && this.res.won === won ? this.res : this.settle(won);
            const best = st.best[0];
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            const avg = st.count ? Math.round(st.sum / st.count) : 0;
            if (won) {
                pp.endDialog(221, {
                    1132: p.string(41049, 'Congratulations, you won the game!').trim() || 'Congratulations, you won the game!',
                    1133: p.string(191 + sc.rank),
                    1157: String(this.turned),
                    1156: String(this.points),
                    1185: String(this.turned),
                    1183: String(sc.avg),
                    1178: String(sc.flipBonus),
                    1161: this.timed ? String(Math.floor(this.timeLeft)) : '0',
                    1163: String(sc.timeBonus),
                    1169: PP.fmt(p.string(57409, 'Final Score: %1!d!'), sc.final),
                    1168: PP.fmt(p.string(47149, 'High score: %1!d!'), best ? best.score : sc.final),
                    1166: PP.fmt(p.string(42197, 'Average tiles turned per game: %1!d!'), avg),
                    1165: PP.fmt(p.string(41237, 'Games played: %1!d!'), st.played),
                    1172: PP.fmt(p.string(41532, 'Games won: %1!d!'), st.won),
                    1164: PP.fmt(p.string(41060, 'Win percentage: %1!d!%%'), pct),
                    1167: PP.fmt(p.string(44135, 'Date: %1'), VG.formatDate(best ? best.date : Date.now()))
                }, { menu: 1170, exit: 1171 });
            } else {
                pp.endDialog(223, {
                    1175: PP.fmt(p.string(47149, 'High score: %1!d!'), best ? best.score : 0),
                    1174: PP.fmt(p.string(42197, 'Average tiles turned per game: %1!d!'), avg),
                    1176: PP.fmt(p.string(41237, 'Games played: %1!d!'), st.played),
                    1179: PP.fmt(p.string(41532, 'Games won: %1!d!'), st.won),
                    1177: PP.fmt(p.string(41060, 'Win percentage: %1!d!%%'), pct),
                    1178: PP.fmt(p.string(44135, 'Date: %1'), VG.formatDate(best ? best.date : Date.now()))
                }, { menu: 1180, exit: 1181 }, best ? [] : [1175, 1178]);
            }
        }

        recordLoss() {
            if (!this.moved) return;
            this.pp.recordGame('pairs' + this.diff, { won: false, avg: this.turned });
            this.moved = false;
        }

        inProgress() {
            return this.moved && !this.over;
        }

        saveState() {
            return {
                level: this.level, points: this.points, turned: this.turned, matchedTiles: this.matchedTiles, tokens: this.tokens,
                timeLeft: this.timeLeft, coin: this.coin, cards: this.cells.map((c) => c.card), matched: this.cells.map((c) => (c.matched ? 1 : 0)),
                difficulty: this.diff, timerOff: !this.timed
            };
        }

        leave() {
            clearTimeout(this.missTimer);
            this.over = true;
            this.gen = (this.gen || 0) + 1;
            this.pp.hideTip();
        }

        setActive(active) {
            this.active = active;
            this.lastTick = VG.now();
        }

        // ---- professor ----
        profPlay(name, loop, then) {
            const m = this.movies[name];
            if (!m) {
                if (then) then();
                return;
            }
            this.profState = { name, movie: m, at: VG.now(), loop, then };
        }

        // the professor walks in to say a tip and talks while it is up; he leaves once it closes
        tip(id, sticky) {
            const t = this.tips[id];
            if (!t || !this.pp.s.tips) return;
            this.pp.showTip(t, TIP_AT);
            const ps = this.profState;
            if (!ps || ps.name === 'exit') this.profPlay('enter', false, () => this.profPlay('talk', false, () => this.profPlay('idle', true)));
            else if (ps.name === 'idle' || ps.name === 'talk' || sticky) this.profPlay('talk', false, () => this.profPlay('idle', true));
        }

        helpTip() {
            this.tip('ProIntro', true);
        }

        // ---- status ----
        statusTexts() {
            const p = this.pack;
            // (VM: Intermediate / Advanced leave Tiles Turned blank until the first tile turns)
            const turned = this.turned || this.diff === 0 ? PP.fmt(p.string(51843, 'Tiles Turned: %1!d!'), this.turned || 0) : '';
            return ['', PP.fmt(p.string(41658, 'Score: %1!d!'), this.points || 0), turned];
        }

        invalidate() {
            this.pp.win.stage.invalidate();
        }

        // ---- frame ----
        frame() {
            // performance.now, the clock every start time here was taken from
            const now = VG.now();
            let busy = false;
            // Engine.xml PauseOnLostFocus 0: the meter runs on while the window is inactive
            if (this.timed && !this.over && this.moved && this.peekUntil < now) {
                const dt = Math.max(0, now - this.lastTick) / 1000;
                this.timeLeft = Math.max(0, this.timeLeft - dt);
                if (this.timeLeft <= 0) this.lose();
                busy = true;
            }
            this.lastTick = now;
            if (this.profState && this.profState.name === 'idle' && !this.pp.tip && !this.over && now - this.profState.at > 1500) {
                this.profPlay('exit', false, () => { this.profState = null; });
            }
            if (this.profState) {
                const ps = this.profState;
                const elapsed = now - ps.at;
                if (!ps.loop && elapsed >= ps.movie.duration) {
                    const then = ps.then;
                    ps.then = null;
                    if (then) then();
                    else ps.loop = true;
                }
                busy = true;
            }
            this.anims = this.anims.filter((a) => {
                const dur = a.kind === 'arc' ? 25 / 30 * 1000 : (a.movie ? a.movie.duration : 0);
                return now - a.at < dur;
            });
            if (this.anims.length || this.cells.some((c) => now - c.flipAt < FLIP_MS || (c.mixAt && now - c.mixAt < 600) || (c.dealAt && now - c.dealAt < 260))) busy = true;
            if (this.fireworks) busy = true;
            if (this.timeGlow && now - this.timeGlow < 1500) busy = true;
            return busy;
        }

        // ---- draw ----
        draw(st) {
            const now = VG.now();
            if (this.background) st.sprite(this.background, 0, 0);
            const b = this.board;
            if (b.sprite) st.sprite(b.sprite, b.x, b.y, { w: b.sprite.w * b.scale, h: b.sprite.h * b.scale });
            this.drawProgress(st);
            if (this.timed) this.drawTimer(st);
            this.drawJar(st);
            this.drawTokens(st);
            this.drawCells(st, now);
            this.drawHome(st);
            if (this.profState) {
                const ps = this.profState;
                ps.movie.draw(st, ps.movie.frameAt(now - ps.at, ps.loop), this.prof.x, this.prof.y);
            }
            this.anims.forEach((a) => this.drawAnim(st, a, now));
            if (this.fireworks && this.movies.fireworks) {
                const m = this.movies.fireworks;
                const t = now - this.fireworks;
                for (let i = 0; i < 4; i++) {
                    const ti = t - i * 450;
                    if (ti < 0) continue;
                    const f = m.frameAt(ti % m.duration, true);
                    m.draw(st, f, [-120, 160, 30, 260][i], [-40, 10, 120, 80][i]);
                }
            }
        }

        // a sprite at scale k with its frame top-left at x / y
        put(st, def, x, y, k, opts) {
            if (!def) return;
            st.sprite(def, x + def.regX * (1 - k) - def.regX * 0 + def.regX * k - def.regX * k, y, Object.assign({ w: def.w * k, h: def.h * k }, opts || {}));
        }

        drawCells(st, now) {
            const back = this.backs[this.level % this.backs.length] || this.backs[0];
            const k = this.scale;
            const peek = this.peekUntil > now;
            this.cells.forEach((c) => {
                const t = Math.min(1, (now - c.flipAt) / FLIP_MS);
                // sideways turn: the old side narrows to the middle, then the new side opens
                const showUp = c.up ? t >= 0.5 : t < 0.5;
                const squeeze = Math.abs(Math.cos(t * Math.PI));
                const mix = c.mixAt && now - c.mixAt < 600 ? Math.abs(Math.cos((now - c.mixAt) / 600 * Math.PI)) : 1;
                const deal = c.dealAt ? Math.max(0, Math.min(1, (now - c.dealAt) / 250)) : 1;
                if (deal <= 0) return;
                const sx = (t < 1 ? squeeze : 1) * mix;
                let def;
                let anim = 0;
                if (c.matched && !(c.up && now - (c.matchedAt || 0) < 400)) def = this.blank;
                else if (showUp) def = (this.cardById[c.card] || {}).sprite;
                else {
                    def = back.button;
                    if (!this.over && !peek) {
                        if (this.down === c.i && this.hot === c.i) anim = 2;
                        else if (this.hot === c.i) anim = 1;
                    }
                }
                if (!def) return;
                const w = def.w * k * sx * deal;
                const h = def.h * k * deal;
                const x = c.x + (c.w - w) / 2;
                st.sprite(def, x + def.regX, c.y + (c.h - h) / 2 + def.regY * k, { anim: Math.min(anim, def.anims.length - 1), w, h });
                if (!c.matched && !c.up && c.i === this.coin && this.coinIcon && t >= 1) {
                    const ck = k * 0.95;
                    st.sprite(this.coinIcon, c.x + 6 * k + this.coinIcon.regX, c.y - 4 * k + this.coinIcon.regY, { w: this.coinIcon.w * ck, h: this.coinIcon.h * ck });
                }
            });
        }

        drawProgress(st) {
            const levels = this.mode.levels.length;
            for (let i = 0; i < levels; i++) {
                const back = this.backs[i % this.backs.length];
                if (!back || !back.progress) continue;
                const done = i < this.level || (i === this.level && this.levelDoneAt && this.cells.every((c) => c.matched));
                st.sprite(back.progress, this.progress.x + back.progress.regX * 0, this.progress.y + i * this.progressStep, { frame: done ? 1 : 0 });
            }
        }

        // the time meter on the left wall (TimeBarContainer 60, -17; the tube, the bar and the cover
        // at 3, 21): the bar is 226 one-pixel rows (green, red in the last quarter) drained from the
        // top, the empty glass showing above it
        drawTimer(st) {
            const x = this.timeBar.x + 3;
            const y = this.timeBar.y + 21;
            if (this.timeBkg) st.sprite(this.timeBkg, x, y);
            const frac = this.timeTotal ? Math.max(0, Math.min(1, this.timeLeft / this.timeTotal)) : 0;
            const bar = frac > 0.25 ? this.timeGreen : this.timeRed;
            if (bar) {
                const rows = bar.anims[0].count;
                const filled = Math.round(rows * frac);
                for (let r = rows - filled; r < rows; r++) st.sprite(bar, x, y + 26 + r, { frame: r });
            }
        }

        drawJar(st) {
            const j = this.jar;
            if (this.jarBase) st.sprite(this.jarBase, j.x, j.y);
            if (this.jarBkg) st.sprite(this.jarBkg, j.x, j.y);
            const back = this.backs[this.level % this.backs.length];
            if (back && back.image) {
                const n = Math.min(back.points.length, Math.floor((this.jarCount || 0) / 2));
                for (let i = 0; i < n; i++) {
                    const pt = back.points[i];
                    // the spot is the picture's card-sized box (the frame's trim offset scales with it)
                    const im = back.image;
                    st.sprite(im, j.x + pt.x + im.regX * (1 - JAR_ITEM), j.y + pt.y + im.regY * (1 - JAR_ITEM), { w: im.w * JAR_ITEM, h: im.h * JAR_ITEM });
                }
            }
            if (this.jarFg) st.sprite(this.jarFg, j.x, j.y);
        }

        drawTokens(st) {
            const s = this.sneak;
            if (this.sneakArea) st.sprite(this.sneakArea, s.x, s.y);
            if (!this.tokenSprite) return;
            this.tokenSlots.forEach((t, i) => {
                if (i >= this.tokens) return;
                let anim = 0;
                if (this.hotToken === i) anim = this.downToken === i ? 2 : 1;
                st.sprite(this.tokenSprite, s.x + t.x, s.y + t.y, { anim });
            });
        }

        drawHome(st) {
            const h = this.home;
            if (!h.sprite) return;
            const anim = this.hotHome ? (this.downHome ? 2 : 1) : 0;
            st.sprite(h.sprite, h.item.x, h.item.y, { anim: Math.min(anim, h.sprite.anims.length - 1) });
        }

        drawAnim(st, a, now) {
            const t = now - a.at;
            if (a.kind === 'arc') {
                const k = Math.min(1, t / (25 / 30 * 1000));
                const x = a.x0 + (a.x1 - a.x0) * k;
                const y = a.y0 + (a.y1 - a.y0) * k - Math.sin(k * Math.PI) * 120;
                const s = a.scale * (1 - 0.6 * k);
                st.sprite(a.sprite, x - a.sprite.w * s / 2 + a.sprite.regX, y - a.sprite.h * s / 2 + a.sprite.regY, { w: a.sprite.w * s, h: a.sprite.h * s, alpha: k > 0.9 ? (1 - k) * 10 : 1 });
                return;
            }
            if (!a.movie) return;
            const f = a.movie.frameAt(t, false);
            if (a.kind === 'burst') {
                a.movie.draw(st, f, 0, 0);
                return;
            }
            // effect movies are drawn about their own centre
            if (!a.movie.centre) a.movie.centre = movieCentre(a.movie);
            a.movie.draw(st, f, a.x - a.movie.centre.x, a.y - a.movie.centre.y);
        }

        // ---- input ----
        homeHit(p) {
            const h = this.home;
            if (!h.sprite) return false;
            const x = h.item.x - h.sprite.regX;
            const y = h.item.y - h.sprite.regY;
            return p.x >= x && p.y >= y && p.x < x + h.sprite.w && p.y < y + h.sprite.h;
        }

        tokenHit(p) {
            const s = this.sneak;
            for (let i = 0; i < this.tokenSlots.length; i++) {
                const t = this.tokenSlots[i];
                const x = s.x + t.x - (this.tokenSprite ? this.tokenSprite.regX : 0);
                const y = s.y + t.y - (this.tokenSprite ? this.tokenSprite.regY : 0);
                if (p.x >= x && p.y >= y && p.x < x + 45 && p.y < y + 46) return i;
            }
            return -1;
        }

        pointer(type, p) {
            const cell = this.cellAt(p);
            const home = this.homeHit(p);
            const token = this.tokenHit(p);
            if (type === 'move' || type === 'leave') {
                const hot = type === 'leave' ? -1 : (cell && !cell.matched && !cell.up ? cell.i : -1);
                const ht = type === 'leave' ? -1 : (token < this.tokens ? token : -1);
                if (hot !== this.hot || home !== this.hotHome || ht !== this.hotToken) {
                    this.hot = hot;
                    this.hotHome = type !== 'leave' && home;
                    this.hotToken = ht;
                    this.invalidate();
                }
                return;
            }
            if (type === 'down') {
                this.down = cell ? cell.i : -1;
                this.downHome = home;
                this.downToken = token;
                this.invalidate();
                return;
            }
            if (type === 'up') {
                const down = this.down;
                const downHome = this.downHome;
                const downToken = this.downToken;
                this.down = -1;
                this.downHome = false;
                this.downToken = -1;
                this.invalidate();
                if (downHome && home) {
                    this.pp.playSound('UI_BUTTON');
                    this.pp.askMainMenu();
                    return;
                }
                if (downToken >= 0 && downToken === token) {
                    this.useToken(token);
                    return;
                }
                if (cell && cell.i === down) this.click(cell);
            }
        }
    }

    // the middle of a movie's first drawn frame (the effect movies are authored at a fixed spot)
    function movieCentre(m) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        m.instances.forEach((inst) => {
            inst.states.forEach((s) => {
                if (!s) return;
                const w = inst.sprite ? inst.sprite.w * s.xs : 0;
                const h = inst.sprite ? inst.sprite.h * s.ys : 0;
                x0 = Math.min(x0, s.x);
                y0 = Math.min(y0, s.y);
                x1 = Math.max(x1, s.x + w);
                y1 = Math.max(y1, s.y + h);
            });
        });
        return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: 0, y: 0 };
    }

    PP.Pairs = Pairs;
    PP.DIFF_NAMES = DIFF_NAMES;
})(typeof window !== 'undefined' ? window : globalThis);
