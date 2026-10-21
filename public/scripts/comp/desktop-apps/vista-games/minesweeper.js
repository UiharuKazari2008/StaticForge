// Minesweeper, as Windows Vista's (Yozora #609). Art, layout, sounds, menus and dialogs are the
// game's own (MineSweeper.dll, Minesweeper.exe.mui via scripts/build-vista-games.js); the engine is
// public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js. Measured on the Vista VM:
//
//   - the client is the board panel: 30 px frame on the top / sides, 33 px at the bottom, 18 px tiles
//     (Beginner 222x225, Intermediate 348x351, Advanced 600x351); the window keeps that aspect
//   - the 720 frames of Tiles_Normal / Tiles_Pressed are a lighting map of the 30x24 maximum board;
//     a smaller board takes the centred part of it (frame = (y + oy) * 30 + x + ox)
//   - the clock and mine counter sit at their CustomLayout offsets from the bottom centre at the
//     minimum width, and both groups move outward by 0.35 x the extra width
//   - the first click is never a mine; Restart keeps the layout, and then it can be
//   - losing: the clicked tile goes red (LoseTileColor), every mine shows, then each one plays
//     BadGuessAnimation in turn (MineTrip script, MineExplodeXOffset/Y) with WrongGuess
//   - winning: every mine is flagged, the scan bar sweeps up the board and each mine plays the
//     DisarmAnimation as it passes, then Game Won
//   - dialogs open centred over the game window, never above / left of its top-left corner
//
// The VM's 3D driver does not draw the engine's text (counters, tip text), so the counter font is
// the engine's label box (LabelWidth / LabelHeight, PanelLabelTextColor) in Segoe UI.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const GAME_ID = 'minesweeper';
    const MODAL_ID = 'vistaMinesweeperModal';
    const TILE = 18;
    const LIGHT_W = 30;
    const LIGHT_H = 24;
    const MIN_W = 9 * TILE + 60;

    const DIFFICULTIES = {
        beginner: { w: 9, h: 9, mines: 10, name: 42480 },
        intermediate: { w: 16, h: 16, mines: 40, name: 56413 },
        advanced: { w: 30, h: 16, mines: 99, name: 57645 }
    };
    const DIFF_ORDER = ['beginner', 'intermediate', 'advanced'];

    // MUI command ids (menu 163, accelerators 167)
    const CMD = { NEW: 40006, STATS: 40003, OPTIONS: 40004, APPEARANCE: 40002, EXIT: 40005, HELP: 40008, ABOUT: 40007 };

    const store = VG.store(GAME_ID);
    const DEFAULT_SETTINGS = {
        difficulty: 'beginner',
        custom: { w: 9, h: 9, mines: 10 },
        animations: true,
        sounds: true,
        tips: true,
        continueSaved: false,
        saveOnExit: false,
        questionMarks: true,
        style: 0,
        board: 0,
        askedDifficulty: false
    };

    let ms = null; // the running game

    function settings() {
        return Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
    }

    function saveSettings(s) {
        store.set('settings', s);
    }

    function blankStats() {
        return { played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: [] };
    }

    function stats(diff) {
        const all = store.get('stats', {});
        return Object.assign(blankStats(), all[diff] || {});
    }

    function saveStats(diff, s) {
        const all = store.get('stats', {});
        all[diff] = s;
        store.set('stats', all);
    }

    function fmt(template, ...args) {
        // "%1!d!" / "%1" / "%%" from the MUI string tables
        return String(template).replace(/%(\d)(?:!\w!)?/g, (_, n) => String(args[Number(n) - 1])).replace(/%%/g, '%');
    }

    // ---- assets ----------------------------------------------------------------------------
    class Look {
        constructor(pack, s) {
            this.pack = pack;
            const doc = pack.xml('UI\\Minesweeper.xml');
            const shared = VG.child(doc, 'Shared');
            this.shared = shared;
            this.styles = VG.children(VG.child(doc, 'GameStyles'), 'GameStyle');
            this.boards = VG.children(VG.child(doc, 'BoardStyles'), 'BoardStyle');
            this.layout = VG.child(VG.child(doc, 'Layouts'), 'CustomLayout');
            this.set(s.style, s.board);
        }

        set(styleIndex, boardIndex) {
            const p = this.pack;
            const sh = this.shared;
            const st = this.styles[styleIndex] || this.styles[0];
            const bd = this.boards[boardIndex] || this.boards[0];
            const sp = (node, tag) => p.sprite(VG.text(node, tag));
            this.style = st;
            this.boardStyle = bd;
            this.flowers = styleIndex === 1;
            this.tile = { normal: sp(bd, 'NormalTileSpriteXml'), hilite: sp(bd, 'HiliteTileSpriteXml'), pressed: sp(bd, 'PressedTileSpriteXml') };
            this.flag = sp(bd, 'FlagXml');
            this.x = sp(bd, 'XXml');
            this.question = sp(bd, 'QuestionMarkXml');
            this.numbers = sp(bd, 'NumbersXml');
            this.shadowL = sp(bd, 'TileShadowLeftXml');
            this.shadowU = sp(bd, 'TileShadowUpperXml');
            this.disarm = sp(bd, 'DisarmAnimXml');
            this.disarmSpec = p.xml(VG.text(bd, 'DisarmAnimSpecXml'));
            this.numberPanel = sp(bd, 'NumberPanelSpriteXml');
            this.labelColor = VG.color(VG.text(bd, 'PanelLabelTextColor'), '#fff');
            this.loseColor = VG.color(VG.text(bd, 'LoseTileColor'), '#f00');
            this.mine = sp(st, 'MineXml');
            this.badGuess = sp(st, 'BadGuessAnimXml');
            this.badGuessSpec = p.xml(VG.text(st, 'BadGuessAnimSpecXml'));
            this.panelMine = sp(st, 'PanelMineSpriteXml');
            this.explodeX = VG.num(st, 'MineExplodeXOffset', -18);
            this.explodeY = VG.num(st, 'MineExplodeYOffset', -18);
            this.firstLoseSoundOnly = VG.bool(st, 'PlayOnlyFirstLoseSound');
            this.tips = {};
            VG.children(VG.child(st, 'Tips'), 'Tip').forEach((t) => {
                this.tips[VG.text(t, 'Id')] = { title: VG.text(t, 'Title'), message: VG.text(t, 'Message'), noTimeout: VG.bool(t, 'NoTimeout') };
            });
            this.sounds = new VG.Sounds(p, VG.child(VG.child(st, 'Audio'), 'Sounds'));
            this.clock = sp(sh, 'PanelClockSpriteXml');
            this.scanBar = sp(sh, 'DisarmScanBarXml');
            this.scanSpec = p.xml(VG.text(sh, 'DisarmScanBarAnimXml'));
            const names = ['TopLeftHorz', 'TopLeftVert', 'TopCenter', 'TopRightHorz', 'TopRightVert', 'CenterLeft', 'CenterRight',
                'BottomLeftHorz', 'BottomLeftVert', 'BottomCenter', 'BottomRightHorz', 'BottomRightVert'];
            this.panel = {};
            names.forEach((n) => { this.panel[n] = sp(sh, 'PanelCustom' + n + 'Xml'); });
            const lay = (tag) => {
                const n = VG.child(this.layout, tag);
                return { x: VG.num(n, 'X'), y: VG.num(n, 'Y'), w: VG.num(n, 'Width'), h: VG.num(n, 'Height') };
            };
            this.pos = {
                tileset: lay('Tileset'),
                timeImage: lay('TimeImage'), timeBack: lay('TimeLabelBack'), timeLabel: lay('TimeLabel'),
                mineImage: lay('MineImage'), minesBack: lay('MinesLabelBack'), minesLabel: lay('MinesLabel')
            };
            this.tipStyle = VG.tipStyle(p, 'White');
        }

        allSprites() {
            const list = [this.tile.normal, this.tile.hilite, this.tile.pressed, this.flag, this.x, this.question, this.numbers,
                this.shadowL, this.shadowU, this.disarm, this.numberPanel, this.mine, this.badGuess, this.panelMine, this.clock, this.scanBar]
                .concat(Object.values(this.panel));
            if (this.tipStyle) list.push(...this.tipStyle.sprites());
            return list.filter(Boolean);
        }
    }

    // ---- board -----------------------------------------------------------------------------
    class Board {
        constructor(w, h, mines) {
            this.w = w;
            this.h = h;
            this.mines = mines;
            this.cells = [];
            for (let i = 0; i < w * h; i++) this.cells.push({ mine: false, open: false, mark: 0, count: 0, t: 0 });
            this.placed = false;
            this.opened = 0;
        }

        idx(x, y) { return y * this.w + x; }

        cell(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.cells[this.idx(x, y)] : null; }

        neighbours(x, y, fn) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const c = this.cell(x + dx, y + dy);
                    if (c) fn(c, x + dx, y + dy);
                }
            }
        }

        // mines anywhere but the first click (and, when there is room, its neighbours)
        place(sx, sy) {
            const free = [];
            const keepClear = this.w * this.h - this.mines >= 9;
            for (let y = 0; y < this.h; y++) {
                for (let x = 0; x < this.w; x++) {
                    const near = Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1;
                    if (x === sx && y === sy) continue;
                    if (keepClear && near) continue;
                    free.push(this.idx(x, y));
                }
            }
            for (let i = free.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [free[i], free[j]] = [free[j], free[i]];
            }
            free.slice(0, this.mines).forEach((i) => { this.cells[i].mine = true; });
            this.count();
            this.placed = true;
        }

        count() {
            for (let y = 0; y < this.h; y++) {
                for (let x = 0; x < this.w; x++) {
                    let n = 0;
                    this.neighbours(x, y, (c) => { if (c.mine) n++; });
                    this.cell(x, y).count = n;
                }
            }
        }

        layout() { return this.cells.map((c) => (c.mine ? 1 : 0)); }

        static fromLayout(w, h, mines, layout) {
            const b = new Board(w, h, mines);
            layout.forEach((m, i) => { b.cells[i].mine = !!m; });
            b.count();
            b.placed = true;
            return b;
        }

        flags() { return this.cells.filter((c) => c.mark === 1).length; }
    }

    // ---- game ------------------------------------------------------------------------------
    class Minesweeper {
        constructor(pack) {
            this.pack = pack;
            this.s = settings();
            this.look = new Look(pack, this.s);
            this.hover = null;
            this.press = null;     // { x, y, chord }
            this.buttons = 0;
            this.anims = [];
            this.tip = null;
            this.state = 'ready';  // ready | playing | lost | won | ending
            this.time = 0;
            this.timerStart = 0;
            this.paused = false;
            this.restarted = false;
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: pack.string(102, 'Minesweeper'),
                icon: '/static_images/app_icons/48/vista-minesweeper.webp',
                iconClass: 'fas fa-bomb',
                pack,
                menu: 163,
                accelerators: 167,
                nativeW: MIN_W,
                nativeH: 9 * TILE + 63,
                fill: '#d9dfe7',
                maximizable: true,
                onCommand: (id) => this.command(id),
                onClose: () => this.requestExit(),
                onClosed: () => this.closed(),
                onActivate: (active) => this.setActive(active),
                onKeyDown: (e) => this.key(e)
            });
            const stage = this.win.stage;
            stage.draw = (ctx) => this.draw(ctx);
            stage.onFrame = (now) => this.frame(now);
            this.wirePointer();
            this.newBoard(false);
        }

        // the difficulty of the board in play (Options may already have set the next one)
        get diff() {
            return this.boardDiff || this.s.difficulty;
        }

        boardSize() {
            if (this.s.difficulty === 'custom') return this.s.custom;
            return DIFFICULTIES[this.s.difficulty] || DIFFICULTIES.beginner;
        }

        nativeSize(b) {
            return { w: b.w * TILE + 60, h: b.h * TILE + 63 };
        }

        warm() {
            return VG.warmSprites(this.win.stage, this.pack, this.look.allSprites());
        }

        // ---- game flow -----------------------------------------------------------------------
        newBoard(sameLayout) {
            this.settleEnding();
            const size = this.boardSize();
            const old = this.board;
            if (sameLayout && old && old.placed) this.board = Board.fromLayout(old.w, old.h, old.mines, old.layout());
            else {
                this.board = new Board(size.w, size.h, size.mines);
                this.boardDiff = this.s.difficulty;
            }
            this.restarted = !!sameLayout;
            this.state = 'ready';
            this.time = 0;
            this.timerStart = 0;
            this.anims = [];
            this.loseAt = null;
            this.scan = null;
            this.press = null;
            const n = this.nativeSize(this.board);
            const changed = !this.win.spec || this.win.spec.nativeW !== n.w || this.win.spec.nativeH !== n.h;
            this.win.setNativeSize(n.w, n.h, changed);
            this.light = { ox: Math.floor((LIGHT_W - this.board.w) / 2), oy: Math.floor((LIGHT_H - this.board.h) / 2) };
            if (this.win.isOpen()) this.look.sounds.play('NewBoard');
            if (sameLayout) this.showTip('Restart');
            else if (this.tip && this.tip.id === 'Restart') this.hideTip();
            this.win.stage.invalidate();
        }

        start() {
            this.state = 'playing';
            this.timerStart = VG.now();
            this.time = 0;
            if (this.tip && this.tip.id === 'Start') this.hideTip();
        }

        elapsed() {
            if (this.state !== 'playing') return this.time;
            if (this.paused) return this.time;
            return Math.min(999, this.time + (VG.now() - this.timerStart) / 1000);
        }

        setActive(active) {
            // the clock stops while the window is minimized or another window is active
            if (this.state !== 'playing') {
                this.paused = !active;
                return;
            }
            if (!active && !this.paused) {
                this.time = this.elapsed();
                this.paused = true;
            } else if (active && this.paused) {
                this.paused = false;
                this.timerStart = VG.now();
            }
            this.win.stage.invalidate();
        }

        inProgress() {
            return this.state === 'playing';
        }

        reveal(x, y) {
            const b = this.board;
            const c = b.cell(x, y);
            if (!c || c.open || c.mark === 1) return;
            if (!b.placed) b.place(x, y);
            if (this.state === 'ready') this.start();
            if (c.mine) {
                this.lose(x, y);
                return;
            }
            const now = VG.now();
            // flood fill from the click, timing each tile's fade by its distance (the ripple)
            const queue = [[x, y, 0]];
            let count = 0;
            while (queue.length) {
                const [qx, qy, d] = queue.shift();
                const q = b.cell(qx, qy);
                if (!q || q.open || q.mark === 1 || q.mine) continue;
                q.open = true;
                q.mark = 0;
                q.t = this.s.animations ? now + d * 30 : 0;
                b.opened++;
                count++;
                if (q.count === 0) b.neighbours(qx, qy, (n, nx, ny) => { if (!n.open) queue.push([nx, ny, d + 1]); });
            }
            this.look.sounds.play(count > 1 ? 'MultiReveal' : 'SingleReveal');
            if (b.opened === b.w * b.h - b.mines) this.winGame();
            this.win.stage.invalidate();
        }

        chord(x, y) {
            const b = this.board;
            const c = b.cell(x, y);
            if (!c || !c.open || !c.count) return;
            let flags = 0;
            b.neighbours(x, y, (n) => { if (n.mark === 1) flags++; });
            if (flags !== c.count) {
                this.look.sounds.play('InvalidMove');
                return;
            }
            const targets = [];
            b.neighbours(x, y, (n, nx, ny) => { if (!n.open && n.mark !== 1) targets.push([nx, ny]); });
            for (const [nx, ny] of targets) {
                if (this.state !== 'playing') break;
                this.reveal(nx, ny);
            }
        }

        mark(x, y) {
            const c = this.board.cell(x, y);
            if (!c || c.open) return;
            if (this.state === 'ready') this.start();
            c.mark = c.mark === 0 ? 1 : (c.mark === 1 && this.s.questionMarks ? 2 : 0);
            this.win.stage.invalidate();
        }

        lose(x, y) {
            this.time = this.elapsed();
            this.state = 'ending';
            this.loseAt = { x, y };
            const b = this.board;
            const now = VG.now();
            // the clicked mine first, then the rest outward from it
            const mines = [];
            for (let my = 0; my < b.h; my++) {
                for (let mx = 0; mx < b.w; mx++) {
                    const c = b.cell(mx, my);
                    if (c.mine && c.mark !== 1) mines.push({ x: mx, y: my, d: Math.hypot(mx - x, my - y) });
                }
            }
            mines.sort((a, m) => a.d - m.d);
            b.cells.forEach((c) => { if (c.mine) c.shown = true; });
            const step = this.s.animations ? Math.max(60, Math.min(250, 2500 / mines.length)) : 0;
            mines.forEach((m, i) => {
                const target = { frame: 0 };
                this.anims.push({
                    kind: 'explode', x: m.x, y: m.y, at: now + i * step, target,
                    run: this.s.animations ? new VG.Animator(this.look.badGuessSpec, target) : null,
                    sound: !this.look.firstLoseSoundOnly || i === 0
                });
            });
            this.endAt = now + mines.length * step + (this.s.animations ? 1100 : 0);
            this.result = 'lost';
            this.win.stage.invalidate();
        }

        winGame() {
            this.time = this.elapsed();
            this.state = 'ending';
            const b = this.board;
            b.cells.forEach((c) => { if (c.mine) c.mark = 1; });
            const now = VG.now();
            this.look.sounds.play('BoardCleared');
            if (this.s.animations) {
                const top = this.look.pos.tileset.y;
                const fromY = top + b.h * TILE;
                const bar = { y: fromY };
                this.scan = { bar, run: new VG.Animator(this.look.scanSpec, bar, { targets: { YPosition: top - this.look.scanBar.h } }), start: now, fromY };
                for (let my = 0; my < b.h; my++) {
                    for (let mx = 0; mx < b.w; mx++) {
                        if (!b.cell(mx, my).mine) continue;
                        const target = { frame: 0 };
                        // the bar passes this row at (fromY - rowY) / speed
                        const k = (b.h - my) / (b.h + 2);
                        this.anims.push({ kind: 'disarm', x: mx, y: my, at: now + k * 3000, target, run: new VG.Animator(this.look.disarmSpec, target) });
                    }
                }
                this.endAt = now + 3000 + 600;
            } else this.endAt = now;
            this.result = 'won';
            this.win.stage.invalidate();
        }

        finish() {
            if (this.state !== 'won' && this.state !== 'lost') return;
            const won = this.result === 'won';
            this.record(won);
            store.remove('saved');
            if (won) this.showWon();
            else this.showLost();
        }

        // a game that ends while its last animation plays (New Game, the window closed) still counts
        settleEnding() {
            if (this.state !== 'ending') return;
            this.state = this.result;
            this.record(this.result === 'won');
            store.remove('saved');
        }

        // the window closed: the next open starts a new board (and offers a saved game)
        closed() {
            this.settleEnding();
            this.tip = null;
            this.press = null;
            this.reopenFresh = true;
        }

        // custom boards keep no statistics (the Statistics list has the three levels)
        record(won) {
            this.lastWinBest = false;
            if (this.diff === 'custom') return;
            const st = stats(this.diff);
            st.played += 1;
            if (won) {
                st.won += 1;
                st.streak = st.streak > 0 ? st.streak + 1 : 1;
                st.longestWin = Math.max(st.longestWin, st.streak);
                const t = Math.max(1, Math.ceil(this.time));
                st.best.push({ time: t, date: Date.now() });
                st.best.sort((a, b) => a.time - b.time);
                st.best = st.best.slice(0, 5);
                this.lastWinBest = st.best[0].time === t && st.best.filter((e) => e.time === t).length === 1;
            } else {
                st.streak = st.streak < 0 ? st.streak - 1 : -1;
                st.longestLose = Math.max(st.longestLose, -st.streak);
            }
            saveStats(this.diff, st);
            this.lastStats = st;
        }

        // ---- input ---------------------------------------------------------------------------
        wirePointer() {
            const surface = this.win.surface;
            const pos = (e) => {
                const r = surface.getBoundingClientRect();
                const p = this.win.stage.toNative(e.clientX - r.left, e.clientY - r.top);
                return p;
            };
            const tileAt = (p) => {
                const t = this.look.pos.tileset;
                const x = Math.floor((p.x - t.x) / TILE);
                const y = Math.floor((p.y - t.y) / TILE);
                return this.board.cell(x, y) ? { x, y } : null;
            };
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointermove', (e) => {
                const p = pos(e);
                this.pointer = p;
                if (this.tipHit(p, 'move')) return;
                const t = this.state === 'ready' || this.state === 'playing' ? tileAt(p) : null;
                const key = t ? t.x + ',' + t.y : '';
                if (key !== (this.hover ? this.hover.x + ',' + this.hover.y : '')) {
                    this.hover = t;
                    if (this.press) this.press = t ? Object.assign({}, t, { chord: this.press.chord }) : Object.assign({ x: -1, y: -1 }, { chord: this.press.chord });
                    this.win.stage.invalidate();
                }
            });
            surface.addEventListener('pointerleave', () => {
                this.hover = null;
                this.win.stage.invalidate();
            });
            surface.addEventListener('pointerdown', (e) => {
                surface.focus({ preventScroll: true });
                const p = pos(e);
                if (this.tipHit(p, 'down')) return;
                if (this.state !== 'ready' && this.state !== 'playing') return;
                this.buttons = e.buttons;
                try { surface.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
                const t = tileAt(p);
                if (!t) return;
                const both = (e.buttons & 3) === 3 || e.button === 1;
                if (e.button === 2 && !both) {
                    this.mark(t.x, t.y);
                    return;
                }
                this.press = Object.assign({}, t, { chord: both });
                this.win.stage.invalidate();
            });
            surface.addEventListener('pointerup', (e) => {
                const p = pos(e);
                if (this.tipHit(p, 'up')) return;
                const press = this.press;
                const wasBoth = (this.buttons & 3) === 3;
                this.buttons = e.buttons;
                if (!press) return;
                // releasing one of two held buttons ends the chord
                if (e.buttons && !press.chord) return;
                this.press = null;
                const t = tileAt(p);
                if (t && t.x === press.x && t.y === press.y) {
                    if (press.chord || wasBoth) this.chord(t.x, t.y);
                    else {
                        const c = this.board.cell(t.x, t.y);
                        if (c.open) this.chord(t.x, t.y);
                        else this.reveal(t.x, t.y);
                    }
                }
                this.win.stage.invalidate();
            });
        }

        key(e) {
            if (this.state !== 'ready' && this.state !== 'playing') return;
            const k = e.key;
            const h = this.hover || { x: 0, y: 0 };
            const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
            if (move) {
                e.preventDefault();
                this.hover = { x: Math.max(0, Math.min(this.board.w - 1, h.x + move[0])), y: Math.max(0, Math.min(this.board.h - 1, h.y + move[1])) };
                this.win.stage.invalidate();
            } else if (k === ' ' || k === 'Enter') {
                e.preventDefault();
                if (!this.hover) return;
                const c = this.board.cell(this.hover.x, this.hover.y);
                if (c.open) this.chord(this.hover.x, this.hover.y);
                else this.reveal(this.hover.x, this.hover.y);
            } else if (k === '+' || k === 'f' || k === 'F') {
                if (this.hover) this.mark(this.hover.x, this.hover.y);
            }
        }

        // ---- tips ----------------------------------------------------------------------------
        // force: View Help shows How To Play with tips turned off too
        showTip(id, force) {
            if (!this.s.tips && !force) return;
            const def = this.look.tips[id];
            if (!def) return;
            this.tip = { id, title: def.title, message: def.message, alpha: 0, shownAt: VG.now(), noTimeout: def.noTimeout, target: 1 };
            this.win.stage.invalidate();
        }

        hideTip() {
            if (this.tip) this.tip.target = 0;
            this.win.stage.invalidate();
        }

        tipHit(p, phase) {
            const t = this.tip;
            if (!t || !t.rect || t.target === 0) return false;
            const c = t.rect.close;
            const onClose = p.x >= c.x && p.y >= c.y && p.x < c.x + c.w && p.y < c.y + c.h;
            const onTip = p.x >= t.rect.x && p.y >= t.rect.y && p.x < t.rect.x + t.rect.w && p.y < t.rect.y + t.rect.h;
            if (phase === 'move') {
                if (t.closeHot !== onClose) {
                    t.closeHot = onClose;
                    this.win.stage.invalidate();
                }
                return false;
            }
            if (phase === 'down' && onClose) {
                t.closeDown = true;
                this.win.stage.invalidate();
                return true;
            }
            if (phase === 'up' && t.closeDown) {
                t.closeDown = false;
                if (onClose) this.hideTip();
                return true;
            }
            return onTip;
        }

        // ---- frame / draw --------------------------------------------------------------------
        frame(now) {
            let busy = false;
            if (this.state === 'playing' && !this.paused) busy = true; // the clock
            this.anims.forEach((a) => {
                if (now < a.at) {
                    busy = true;
                    return;
                }
                if (!a.started) {
                    a.started = true;
                    if (a.kind === 'explode' && a.sound) this.look.sounds.play('WrongGuess');
                }
                if (a.run && a.run.step(now)) busy = true;
            });
            if (this.scan && this.scan.run.step(now)) busy = true;
            if (this.board && this.board.cells.some((c) => c.t && now < c.t + 250)) busy = true;
            if (this.tip) {
                const k = this.tip.target ? 1 : -1;
                const before = this.tip.alpha;
                this.tip.alpha = Math.max(0, Math.min(1, this.tip.alpha + k * 0.08));
                if (this.tip.alpha !== before) busy = true;
                if (!this.tip.target && this.tip.alpha <= 0) this.tip = null;
                if (this.tip && !this.tip.noTimeout && this.tip.target && now - this.tip.shownAt > 8000) this.tip.target = 0;
                if (this.tip && !this.tip.noTimeout) busy = true;
            }
            if (this.state === 'ending') {
                busy = true;
                if (now >= this.endAt) {
                    this.state = this.result;
                    setTimeout(() => this.finish(), 0);
                }
            }
            return busy;
        }

        frameIndex(x, y) {
            return (y + this.light.oy) * LIGHT_W + x + this.light.ox;
        }

        draw() {
            const st = this.win.stage;
            const look = this.look;
            const b = this.board;
            const W = this.win.spec.nativeW;
            const H = this.win.spec.nativeH;
            this.drawPanel(st, W, H);
            const ts = look.pos.tileset;
            const now = VG.now();
            const pressSet = new Set();
            if (this.press && this.state !== 'ending') {
                const p = this.press;
                const c = b.cell(p.x, p.y);
                if (c) {
                    if (p.chord || c.open) {
                        b.neighbours(p.x, p.y, (n, nx, ny) => { if (!n.open && n.mark !== 1) pressSet.add(b.idx(nx, ny)); });
                        if (!c.open && c.mark !== 1) pressSet.add(b.idx(p.x, p.y));
                    } else if (!c.open && c.mark !== 1) pressSet.add(b.idx(p.x, p.y));
                }
            }
            for (let y = 0; y < b.h; y++) {
                for (let x = 0; x < b.w; x++) {
                    const c = b.cell(x, y);
                    const px = ts.x + x * TILE;
                    const py = ts.y + y * TILE;
                    const f = this.frameIndex(x, y);
                    const pressed = pressSet.has(b.idx(x, y));
                    if (c.open || pressed) {
                        st.sprite(look.tile.pressed, px, py, { frame: f });
                        // still fading out of the raised tile
                        if (c.open && c.t && now < c.t + 250) {
                            const k = Math.max(0, (now - c.t) / 250);
                            st.sprite(look.tile.normal, px, py, { frame: f, alpha: 1 - k });
                        }
                    } else {
                        st.sprite(look.tile.normal, px, py, { frame: f });
                        if (this.hover && this.hover.x === x && this.hover.y === y && (this.state === 'playing' || this.state === 'ready')) {
                            st.sprite(look.tile.hilite, px, py);
                        }
                    }
                    if (this.loseAt && this.loseAt.x === x && this.loseAt.y === y) {
                        st.sprite(look.tile.pressed, px, py, { frame: f });
                        const ctx = st.ctx;
                        ctx.save();
                        ctx.globalCompositeOperation = 'multiply';
                        ctx.fillStyle = look.loseColor;
                        ctx.globalAlpha = 0.45;
                        ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
                        ctx.restore();
                    }
                }
            }
            // shadows of the raised tiles on the open ones, then the marks and numbers
            for (let y = 0; y < b.h; y++) {
                for (let x = 0; x < b.w; x++) {
                    const c = b.cell(x, y);
                    const px = ts.x + x * TILE;
                    const py = ts.y + y * TILE;
                    if (c.open) {
                        const up = b.cell(x, y - 1);
                        const left = b.cell(x - 1, y);
                        if (up && !up.open) st.sprite(look.shadowU, px, py);
                        if (left && !left.open) st.sprite(look.shadowL, px, py);
                        if (c.count) st.sprite(look.numbers, px + 4, py + 2, { frame: c.count - 1, alpha: c.t && now < c.t ? 0 : 1 });
                        continue;
                    }
                    const lostView = this.state === 'lost' || (this.state === 'ending' && this.result === 'lost');
                    if (c.mark === 1) {
                        if (lostView && !c.mine) st.sprite(look.x, px, py);
                        else st.sprite(look.flag, px, py);
                    } else if (c.mark === 2) st.sprite(look.question, px, py);
                    if (lostView && c.mine && c.mark !== 1) st.sprite(look.mine, px, py);
                }
            }
            // explosions / disarms
            this.anims.forEach((a) => {
                if (!a.started) return;
                const px = ts.x + a.x * TILE;
                const py = ts.y + a.y * TILE;
                if (a.kind === 'explode') {
                    if (a.run) st.sprite(look.badGuess, px + look.explodeX, py + look.explodeY, { frame: a.target.frame });
                } else if (a.kind === 'disarm') {
                    st.sprite(look.disarm, px - Math.round((look.disarm.w - TILE) / 2), py + TILE - look.disarm.h + 16, { frame: a.target.frame });
                }
            });
            if (this.scan && !this.scan.run.done) {
                st.sprite(look.scanBar, Math.round((W - look.scanBar.w) / 2), this.scan.bar.y);
            }
            this.drawCounters(st, W, H);
            if (this.tip) {
                this.tip.rect = VG.drawTip(st, look.tipStyle, Object.assign({}, this.tip, { x: 2, bottom: H - 6, w: 212 }));
            }
        }

        // The frame around the board, located piece by piece on VM captures of all three sizes: the
        // top corners are horizontal pieces with the vertical ones under them; the bottom vertical
        // pieces run to the bottom edge and hold the corners; the bottom bars sit between them (the
        // right one 7 px under its vertical); the 1 px centre pieces stretch over the gaps.
        drawPanel(st, W, H) {
            const p = this.look.panel;
            const topH = p.TopCenter.h;
            const botH = p.BottomCenter.h;
            const side = p.CenterLeft.w;
            const brX = W - side - p.BottomRightHorz.w + 7;
            st.sprite(p.TopCenter, p.TopLeftHorz.w, 0, { w: W - p.TopLeftHorz.w - p.TopRightHorz.w });
            st.sprite(p.BottomCenter, side + p.BottomLeftHorz.w, H - botH, { w: brX - side - p.BottomLeftHorz.w });
            st.sprite(p.CenterLeft, 0, topH, { h: H - topH });
            st.sprite(p.CenterRight, W - side, topH, { h: H - topH });
            st.sprite(p.BottomLeftHorz, side, H - botH);
            st.sprite(p.BottomRightHorz, brX, H - botH);
            st.sprite(p.BottomLeftVert, 0, H - p.BottomLeftVert.h);
            st.sprite(p.BottomRightVert, W - side, H - p.BottomRightVert.h);
            st.sprite(p.TopLeftVert, 0, topH);
            st.sprite(p.TopRightVert, W - side, topH);
            st.sprite(p.TopLeftHorz, 0, 0);
            st.sprite(p.TopRightHorz, W - p.TopRightHorz.w, 0);
        }

        drawCounters(st, W, H) {
            const look = this.look;
            const pos = look.pos;
            const cx = Math.floor(W / 2);
            const spread = Math.round((W - MIN_W) * 0.35);
            const at = (o, side) => ({ x: cx + o.x + side * spread, y: H + o.y });
            const timeImg = at(pos.timeImage, -1);
            const timeBack = at(pos.timeBack, -1);
            const timeLabel = at(pos.timeLabel, -1);
            const mineImg = at(pos.mineImage, 1);
            const minesBack = at(pos.minesBack, 1);
            const minesLabel = at(pos.minesLabel, 1);
            st.sprite(look.clock, timeImg.x, timeImg.y);
            st.sprite(look.numberPanel, timeBack.x, timeBack.y);
            st.sprite(look.panelMine, mineImg.x, mineImg.y);
            st.sprite(look.numberPanel, minesBack.x, minesBack.y);
            const ctx = st.ctx;
            ctx.save();
            ctx.fillStyle = look.labelColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px "Segoe UI", "Noto Sans", sans-serif';
            const t = Math.floor(this.elapsed());
            ctx.fillText(String(t), timeLabel.x + pos.timeLabel.w / 2, timeLabel.y + pos.timeLabel.h / 2 + 1);
            const left = this.board.mines - this.board.flags();
            ctx.fillText(String(left), minesLabel.x + pos.minesLabel.w / 2, minesLabel.y + pos.minesLabel.h / 2 + 1);
            ctx.restore();
        }

        // ---- commands ------------------------------------------------------------------------
        command(id) {
            switch (id) {
            case CMD.NEW: this.askNewGame(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance(); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: this.showAbout(); break;
            case CMD.HELP: this.showTip('Start', true); break;
            default: break;
            }
        }

        askNewGame() {
            if (!this.inProgress()) {
                this.newBoard(false);
                return;
            }
            VG.taskDialog({
                owner: this.win,
                title: this.pack.string(4027, 'New Game'),
                instruction: this.pack.string(4017),
                links: [
                    VG.linkFromString(this.pack.string(4026), 1),
                    VG.linkFromString(this.pack.string(4019), 2),
                    VG.linkFromString(this.pack.string(4020), 3)
                ]
            }).then((r) => {
                if ((r === 1 || r === 2) && this.inProgress()) {
                    this.time = this.elapsed();
                    this.record(false);
                    this.state = 'lost';
                    this.newBoard(r === 2);
                }
            });
        }

        requestExit(fromMenu) {
            if (!this.inProgress()) {
                if (fromMenu) VG.closeWindow(this.win);
                return true;
            }
            if (this.s.saveOnExit) {
                this.saveGame();
                VG.closeWindow(this.win);
                return false;
            }
            VG.taskDialog({
                owner: this.win,
                title: this.pack.string(6001, 'Exit Game'),
                instruction: this.pack.string(6002),
                buttons: [
                    { id: 1, text: this.pack.string(6003, '&Save'), default: true },
                    { id: 2, text: this.pack.string(6004, "&Don't save") },
                    { id: 3, text: this.pack.string(6005, 'Cancel') }
                ],
                check: { text: this.pack.string(6022), checked: this.s.saveOnExit }
            }).then((r, checked) => {
                if (r && typeof r === 'object') {
                    checked = r.checked;
                    r = r.id;
                }
                if (checked !== undefined && checked !== this.s.saveOnExit) {
                    this.s.saveOnExit = checked;
                    saveSettings(this.s);
                }
                if (r === 1) {
                    this.saveGame();
                    VG.closeWindow(this.win);
                } else if (r === 2) {
                    this.time = this.elapsed();
                    this.record(false);
                    store.remove('saved');
                    this.state = 'ready';
                    VG.closeWindow(this.win);
                }
            });
            return false;
        }

        saveGame() {
            const b = this.board;
            store.set('saved', {
                difficulty: this.diff, w: b.w, h: b.h, mines: b.mines, layout: b.layout(),
                cells: b.cells.map((c) => (c.open ? 1 : 0) | (c.mark << 1)), time: this.elapsed(), restarted: this.restarted
            });
        }

        loadSaved(saved) {
            const b = Board.fromLayout(saved.w, saved.h, saved.mines, saved.layout);
            saved.cells.forEach((v, i) => {
                const c = b.cells[i];
                c.open = !!(v & 1);
                c.mark = v >> 1;
                if (c.open) b.opened++;
            });
            this.board = b;
            this.boardDiff = saved.difficulty || this.s.difficulty;
            this.restarted = !!saved.restarted;
            this.state = 'playing';
            this.time = saved.time || 0;
            this.timerStart = VG.now();
            this.loseAt = null;
            this.anims = [];
            const n = this.nativeSize(b);
            this.win.setNativeSize(n.w, n.h, true);
            this.light = { ox: Math.floor((LIGHT_W - b.w) / 2), oy: Math.floor((LIGHT_H - b.h) / 2) };
            store.remove('saved');
            this.win.stage.invalidate();
        }

        afterOpen() {
            const saved = store.get('saved', null);
            if (saved && saved.layout && !this.inProgress()) {
                if (this.s.continueSaved) {
                    this.loadSaved(saved);
                    return;
                }
                VG.taskDialog({
                    owner: this.win,
                    title: this.pack.string(6006, 'Saved Game Found'),
                    instruction: this.pack.string(6007),
                    buttons: [{ id: 1, text: this.pack.string(6008, '&Yes'), default: true }, { id: 2, text: this.pack.string(6009, '&No') }],
                    check: { text: this.pack.string(6023), checked: this.s.continueSaved }
                }).then((r) => {
                    const id = r && typeof r === 'object' ? r.id : r;
                    if (r && typeof r === 'object' && r.checked !== this.s.continueSaved) {
                        this.s.continueSaved = r.checked;
                        saveSettings(this.s);
                    }
                    if (id === 1) this.loadSaved(saved);
                    else store.remove('saved');
                });
                return;
            }
            if (!this.s.askedDifficulty) {
                this.s.askedDifficulty = true;
                saveSettings(this.s);
                VG.taskDialog({
                    owner: this.win,
                    title: this.pack.string(4004, 'Select Difficulty'),
                    instruction: this.pack.string(4005),
                    links: [
                        VG.linkFromString(this.pack.string(4007), 'beginner'),
                        VG.linkFromString(this.pack.string(4008), 'intermediate'),
                        VG.linkFromString(this.pack.string(4009), 'advanced')
                    ],
                    footer: this.pack.string(4006),
                    width: 400
                }).then((r) => {
                    if (DIFFICULTIES[r]) {
                        this.s.difficulty = r;
                        saveSettings(this.s);
                    }
                    this.newBoard(false);
                    this.showTip('Start');
                });
                return;
            }
            if (!this.tip && this.state === 'ready') this.showTip('Start');
        }

        showStats() {
            const pack = this.pack;
            let current = this.diff === 'custom' ? 'beginner' : this.diff;
            const fill = (dlg) => {
                const st = stats(current);
                // the five best times: time / date statics in the Best Times box
                const ids = [[1037, 1041], [1038, 1042], [1039, 1043], [1040, 1044], [1045, 1046]];
                ids.forEach(([t, d], i) => {
                    const e = st.best[i];
                    dlg.text(t, e ? String(e.time) : '');
                    dlg.text(d, e ? VG.formatDate(e.date) : '');
                });
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                dlg.text(1053, fmt(pack.string(59264, 'Games played: %1!d!'), st.played));
                dlg.text(1054, fmt(pack.string(63054, 'Games won: %1!d!'), st.won));
                dlg.text(1056, fmt(pack.string(53163, 'Win percentage: %1!d!%%'), pct));
                dlg.text(1048, fmt(pack.string(58458, 'Longest winning streak: %1!d!'), st.longestWin));
                dlg.text(1050, fmt(pack.string(61345, 'Longest losing streak: %1!d!'), st.longestLose));
                const s = st.streak;
                let cur;
                if (s > 0) cur = fmt(pack.string(s === 1 ? 49206 : 43725, 'Current: %1!d! wins'), s);
                else if (s < 0) cur = fmt(pack.string(-s === 1 ? 49052 : 45651, 'Current streak: %1!d! losses'), -s);
                else cur = fmt(pack.string(43725, 'Current: %1!d! wins'), 0);
                dlg.text(1052, cur);
            };
            VG.dialog(pack, 101, {
                owner: this.win,
                title: fmt(pack.string(47675, 'Minesweeper Statistics - %1'), VG.userName()),
                focus: 1018,
                init: (dlg) => {
                    dlg.setList(1018, DIFF_ORDER.map((d) => ({ value: d, text: pack.string(DIFFICULTIES[d].name, d) })), current);
                    fill(dlg);
                },
                onCommand: (id, dlg, how) => {
                    if (id === 1018 && how === 'change') {
                        current = dlg.listValue(1018);
                        fill(dlg);
                        return false;
                    }
                    if (id === 1001) {
                        VG.taskDialog({
                            owner: this.win,
                            title: pack.string(6010, 'Reset Statistics'),
                            instruction: pack.string(6011),
                            buttons: [{ id: 1, text: pack.string(6012, '&Yes') }, { id: 2, text: pack.string(6013, '&No'), default: true }]
                        }).then((r) => {
                            if (r === 1) {
                                store.set('stats', {});
                                fill(dlg);
                            }
                        });
                        return false;
                    }
                    return true;
                }
            });
        }

        showOptions() {
            const pack = this.pack;
            const s = this.s;
            const radios = { beginner: 1014, intermediate: 1015, advanced: 1016, custom: 1010 };
            const syncCustom = (dlg) => {
                const on = dlg.checked(1010);
                [1042, 1019, 1041, 1011, 1043, 1012].forEach((id) => dlg.enable(id, on));
            };
            VG.dialog(pack, 147, {
                owner: this.win,
                init: (dlg) => {
                    dlg.checked(radios[s.difficulty] || 1014, true);
                    dlg.text(1019, String(s.custom.h));
                    dlg.text(1011, String(s.custom.w));
                    dlg.text(1012, String(s.custom.mines));
                    dlg.checked(1002, s.animations);
                    dlg.checked(1017, s.sounds);
                    dlg.checked(1018, s.tips);
                    dlg.checked(1020, s.continueSaved);
                    dlg.checked(1044, s.saveOnExit);
                    dlg.checked(1013, s.questionMarks);
                    syncCustom(dlg);
                },
                onCommand: (id, dlg) => {
                    if (id === 1010 || id === 1014 || id === 1015 || id === 1016) {
                        syncCustom(dlg);
                        return false;
                    }
                    if (id !== 1) return true;
                    let diff = 'beginner';
                    Object.keys(radios).forEach((d) => { if (dlg.checked(radios[d])) diff = d; });
                    const next = Object.assign({}, s);
                    if (diff === 'custom') {
                        const h = Math.max(9, Math.min(24, parseInt(dlg.text(1019), 10) || 9));
                        const w = Math.max(9, Math.min(30, parseInt(dlg.text(1011), 10) || 9));
                        const maxMines = Math.min(668, Math.floor((w - 1) * (h - 1)));
                        const mines = Math.max(10, Math.min(maxMines, parseInt(dlg.text(1012), 10) || 10));
                        next.custom = { w, h, mines };
                    }
                    next.difficulty = diff;
                    next.animations = dlg.checked(1002);
                    next.sounds = dlg.checked(1017);
                    next.tips = dlg.checked(1018);
                    next.continueSaved = dlg.checked(1020);
                    next.saveOnExit = dlg.checked(1044);
                    next.questionMarks = dlg.checked(1013);
                    const boardChanged = next.difficulty !== s.difficulty
                        || (diff === 'custom' && JSON.stringify(next.custom) !== JSON.stringify(s.custom));
                    this.applySettings(next, boardChanged);
                    return true;
                }
            });
        }

        applySettings(next, boardChanged) {
            this.s = next;
            saveSettings(next);
            this.look.sounds.enabled = next.sounds;
            if (!next.tips) this.hideTip();
            if (!boardChanged) return;
            if (!this.inProgress()) {
                this.newBoard(false);
                return;
            }
            VG.taskDialog({
                owner: this.win,
                title: this.pack.string(6014, 'Changed Game Settings'),
                instruction: this.pack.string(6015),
                links: [VG.linkFromString(this.pack.string(6016), 1), VG.linkFromString(this.pack.string(6017), 2)]
            }).then((r) => {
                if (r === 1 && this.inProgress()) {
                    this.time = this.elapsed();
                    this.record(false);
                    this.state = 'lost';
                    this.newBoard(false);
                }
            });
        }

        showAppearance() {
            const pack = this.pack;
            const look = this.look;
            let style = this.s.style;
            let board = this.s.board;
            VG.dialog(pack, 500, {
                owner: this.win,
                texts: { 5002: pack.string(42350, 'Select Game Style'), 5003: pack.string(42351, 'Select Board'), 5004: pack.string(42352) },
                init: (dlg) => {
                    VG.fillThumbList(dlg.get(5000), look.styles.map((n) => ({ text: n.a.Name, img: pack.imageUrl(n.a.Thumbnail.replace(/\.png$/i, '')) })), style, (i) => { style = i; });
                    VG.fillThumbList(dlg.get(5001), look.boards.map((n) => ({ text: n.a.Name, img: pack.imageUrl(n.a.Thumbnail.replace(/\.png$/i, '')) })), board, (i) => { board = i; });
                    dlg.checked(5004, !!this.s.randomLook);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    this.s.randomLook = dlg.checked(5004);
                    if (this.s.randomLook) {
                        style = Math.floor(Math.random() * look.styles.length);
                        board = Math.floor(Math.random() * look.boards.length);
                    }
                    this.s.style = style;
                    this.s.board = board;
                    saveSettings(this.s);
                    look.set(style, board);
                    look.sounds.enabled = this.s.sounds;
                    this.warm();
                    this.win.stage.invalidate();
                    return true;
                }
            });
        }

        showAbout() {
            VG.aboutBox({ owner: this.win, title: this.pack.string(102, 'Minesweeper'), text: this.pack.string(108), icon: '/static_images/vista-games/icons/minesweeper-48.png' });
        }

        resultTexts(won) {
            const pack = this.pack;
            const st = this.lastStats || stats(this.diff);
            const t = Math.max(won ? 1 : 0, Math.floor(this.time));
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            const best = st.best[0];
            return {
                time: fmt(pack.string(t === 1 ? 56311 : 56310, 'Time: %1!d! seconds'), t),
                best: best ? fmt(pack.string(best.time === 1 ? 52125 : 52124, 'Best time: %1!d! seconds'), best.time) : fmt(pack.string(52124), 0),
                played: fmt(pack.string(44427, 'Games played: %1!d!'), st.played),
                won: fmt(pack.string(55748, 'Games won: %1!d!'), st.won),
                date: fmt(pack.string(49826, 'Date: %1'), VG.formatDate(best ? best.date : Date.now())),
                pct: fmt(pack.string(44696, 'Percentage: %1!d!%%'), pct)
            };
        }

        showLost() {
            const tx = this.resultTexts(false);
            const custom = this.diff === 'custom';
            VG.dialog(this.pack, 136, {
                owner: this.win,
                title: this.pack.string(44981, 'Game Lost'),
                texts: { 1031: tx.time, 1032: tx.best, 1028: tx.played, 1029: tx.won, 1033: tx.date, 1030: tx.pct },
                init: (dlg) => {
                    if (custom) [1032, 1028, 1029, 1033, 1030].forEach((id) => dlg.show(id, false));
                    if (!stats(this.diff).best.length) [1032, 1033].forEach((id) => dlg.show(id, false));
                },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 2) this.newBoard(false);
                    else if (r === 1005) this.newBoard(true);
                    else if (r === 1004) VG.closeWindow(this.win);
                }
            });
        }

        showWon() {
            const tx = this.resultTexts(true);
            const fastest = !!this.lastWinBest && this.diff !== 'custom';
            const custom = this.diff === 'custom';
            // 137's "You have the fastest time" line is a hidden control the game shows: here the
            // template with it visible (VG.dialog builds visible controls only)
            const tpl = this.pack.mui.dialogs[fastest ? 137 : 167];
            const template = fastest ? Object.assign({}, tpl, { controls: tpl.controls.map((c) => (c.id === 1046 ? Object.assign({}, c, { style: c.style | 0x10000000 }) : c)) }) : tpl;
            VG.dialog(this.pack, template, {
                owner: this.win,
                title: this.pack.string(43236, 'Game Won'),
                texts: { 1020: tx.time, 1021: tx.best, 1022: tx.played, 1023: tx.won, 1025: tx.date, 1024: tx.pct },
                init: (dlg) => {
                    if (custom) [1021, 1022, 1023, 1025, 1024].forEach((id) => dlg.show(id, false));
                },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1027) VG.closeWindow(this.win);
                    else this.newBoard(false);
                }
            });
        }
    }

    function open() {
        return VG.loadPack(GAME_ID).then((pack) => {
            const created = !ms;
            if (!ms) ms = new Minesweeper(pack);
            const first = !ms.win.isOpen();
            // Randomly choose game style and board: a new look each time the game starts
            if (created && ms.s.randomLook) {
                ms.s.style = Math.floor(Math.random() * ms.look.styles.length);
                ms.s.board = Math.floor(Math.random() * ms.look.boards.length);
                ms.look.set(ms.s.style, ms.s.board);
            }
            if (first && ms.reopenFresh) {
                ms.reopenFresh = false;
                ms.newBoard(false);
            }
            ms.look.sounds.enabled = ms.s.sounds;
            return ms.warm().then(() => {
                ms.win.open();
                if (first) {
                    ms.look.sounds.warm();
                    ms.afterOpen();
                }
                return ms;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: 'Minesweeper',
        icon: '/static_images/vista-games/icons/minesweeper',
        thumbnail: '/static_images/vista-games/minesweeper/images/rgmh_thumbnail_minesweeper.png',
        feature: 'vista_minesweeper',
        open
    });
    root.openVistaMinesweeper = open;
    // the rules for scripts/test-vista-games.js (statistics per difficulty, games that end late)
    root.VistaMinesweeperRules = Minesweeper.prototype;
    root.vistaMinesweeper = () => ms;
})(typeof window !== 'undefined' ? window : globalThis);
