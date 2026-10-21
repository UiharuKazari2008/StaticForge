// Block Drop: a falling-blocks game that sits with the Windows Vista games (Yozora #609). Vista
// never shipped one, so this is built as Oberon would have: on the shared engine
// (public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js), in Minesweeper's frame, with
// Minesweeper's own glossy tile recoloured per piece (scripts/build-vista-arcade-art.js writes
// /static_images/vista-games/blockdrop/), the real games' sounds and Vista's dialog wording.
//
//   - the client is the Minesweeper board panel around a 10 x 20 well of 18 px cells, the Hold box
//     and the score readouts to its left, the Next queue to its right; the clock and the lines
//     still to go sit in the bottom bar where Minesweeper keeps its clock and mine counter
//   - the empty well is the board's open tiles (Tiles_Pressed and its lighting map), the blocks
//     cast the raised tiles' shadows on it
//   - rules: the 7-piece bag, SRS rotation with wall kicks, hold, ghost piece, 0.5 s lock delay
//     (15 resets), soft / hard drop, a level every 10 lines, guideline scoring (T-spins,
//     back-to-back, combos); clearing 150 lines wins the game
//   - the game pauses while its window is inactive or minimized (F3 or P pauses too); the well is
//     covered while paused
//
// The rules are pure (no DOM): scripts/test-vista-arcade.js loads this file in node and tests
// them through module.exports.
(function (root) {
    'use strict';

    // The game's name, everywhere it shows (title bar, menus, dialogs, Games Explorer)
    const DISPLAY_NAME = 'Block Drop';

    // ---- rules --------------------------------------------------------------------------------
    const COLS = 10;
    const ROWS = 22;          // 20 in the well and 2 above it, where pieces spawn
    const HIDDEN = 2;
    const GOAL_LINES = 150;   // clearing this many wins the game
    const MAX_LEVEL = 20;
    const LOCK_DELAY = 500;
    const LOCK_RESETS = 15;
    const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
    // frame of BLOCKS_*.XML; G is the grey of a topped-out stack
    const COLOR = { I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6, G: 7 };
    const WALL = 99;

    // spawn orientation in its box (y down); the other three are the box rotated clockwise
    const SHAPES = {
        I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
        O: { n: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]], fixed: true },
        T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
        S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
        Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
        J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
        L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }
    };
    const CELLS = {};
    TYPES.forEach((t) => {
        const s = SHAPES[t];
        CELLS[t] = [s.cells];
        for (let r = 1; r < 4; r++) {
            CELLS[t].push(s.fixed ? s.cells : CELLS[t][r - 1].map(([x, y]) => [s.n - 1 - y, x]));
        }
    });

    // SRS wall kicks (the guideline's tables with y flipped to point down): tried in order
    const flip = (list) => list.map(([x, y]) => [x, -y]);
    const KICKS = {
        JLSTZ: {
            '0>1': flip([[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]),
            '1>0': flip([[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]),
            '1>2': flip([[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]),
            '2>1': flip([[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]),
            '2>3': flip([[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]),
            '3>2': flip([[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]),
            '3>0': flip([[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]),
            '0>3': flip([[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]])
        },
        I: {
            '0>1': flip([[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]]),
            '1>0': flip([[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]]),
            '1>2': flip([[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]),
            '2>1': flip([[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]]),
            '2>3': flip([[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]]),
            '3>2': flip([[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]]),
            '3>0': flip([[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]]),
            '0>3': flip([[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]])
        }
    };

    // points x level: lines cleared 0-4, and for T-spins (full / mini) 0-3
    const LINE_POINTS = [0, 100, 300, 500, 800];
    const TSPIN_POINTS = [400, 800, 1200, 1600];
    const MINI_POINTS = [100, 200, 400];
    // the T's corners in its 3x3 box, and the two it points at per orientation
    const T_CORNERS = [[0, 0], [2, 0], [0, 2], [2, 2]];
    const T_FRONT = [[[0, 0], [2, 0]], [[2, 0], [2, 2]], [[0, 2], [2, 2]], [[0, 0], [0, 2]]];

    // seconds per row at a level (the guideline's curve), in ms
    function gravityMs(level) {
        const l = Math.max(1, Math.min(MAX_LEVEL, level));
        return 1000 * Math.pow(0.8 - (l - 1) * 0.007, l - 1);
    }

    class Engine {
        // opts: { rng, startLevel, clearDelay (ms the cleared rows stay up), goal (lines; 0 = none) }
        constructor(opts) {
            opts = opts || {};
            this.rng = opts.rng || Math.random;
            this.startLevel = Math.max(1, Math.min(15, opts.startLevel | 0 || 1));
            this.clearDelay = opts.clearDelay || 0;
            this.goal = opts.goal === undefined ? GOAL_LINES : opts.goal;
            this.board = new Array(COLS * ROWS).fill(0);
            this.bag = [];
            this.queue = [];
            this.hold = null;
            this.holdUsed = false;
            this.piece = null;
            this.score = 0;
            this.lines = 0;
            this.combo = -1;
            this.b2b = false;
            this.over = false;
            this.won = false;
            this.clearing = null;
            this.events = [];
            this.counts = { quads: 0, tspins: 0, pieces: 0 };
            this.resetPieceState();
            this.fillQueue();
        }

        get level() {
            return Math.min(MAX_LEVEL, this.startLevel + Math.floor(this.lines / 10));
        }

        emit(type, data) {
            this.events.push(Object.assign({}, data || {}, { type }));
        }

        takeEvents() {
            const e = this.events;
            this.events = [];
            return e;
        }

        resetPieceState() {
            this.gravityAcc = 0;
            this.lockTimer = 0;
            this.lockResets = 0;
            this.lowest = 0;
            this.lastRotate = false;
            this.lastKick = -1;
        }

        // 0 empty, a colour + 1, or WALL outside the well (above it is open)
        cell(x, y) {
            if (x < 0 || x >= COLS || y >= ROWS) return WALL;
            if (y < 0) return 0;
            return this.board[y * COLS + x];
        }

        fits(type, rot, x, y) {
            const cells = CELLS[type][rot];
            for (let i = 0; i < cells.length; i++) {
                if (this.cell(x + cells[i][0], y + cells[i][1])) return false;
            }
            return true;
        }

        // the 7-piece bag: every run of seven holds each piece once
        fillQueue() {
            while (this.queue.length < 7) {
                if (!this.bag.length) {
                    const bag = TYPES.slice();
                    for (let i = bag.length - 1; i > 0; i--) {
                        const j = Math.floor(this.rng() * (i + 1));
                        [bag[i], bag[j]] = [bag[j], bag[i]];
                    }
                    this.bag = bag;
                }
                this.queue.push(this.bag.shift());
            }
        }

        takeNext() {
            const t = this.queue.shift();
            this.fillQueue();
            return t;
        }

        start() {
            if (!this.piece && !this.over && !this.clearing) this.spawn();
        }

        spawn(type) {
            const t = type || this.takeNext();
            this.resetPieceState();
            if (!this.fits(t, 0, 3, 0)) {
                this.piece = { type: t, rot: 0, x: 3, y: 0 };
                this.gameOver('blockout');
                return false;
            }
            this.piece = { type: t, rot: 0, x: 3, y: 0 };
            // spawned above the well, it drops into it at once
            if (this.fits(t, 0, 3, 1)) this.piece.y = 1;
            this.lowest = this.piece.y;
            this.counts.pieces += 1;
            this.emit('spawn', { piece: t });
            return true;
        }

        active() {
            return !!this.piece && !this.over && !this.clearing;
        }

        grounded() {
            const p = this.piece;
            return !!p && !this.fits(p.type, p.rot, p.x, p.y + 1);
        }

        // a move or turn on the ground buys more lock delay (LOCK_RESETS times; a new lowest row
        // starts the count again)
        moved() {
            const p = this.piece;
            if (p.y > this.lowest) {
                this.lowest = p.y;
                this.lockResets = 0;
            }
            if (this.grounded() && this.lockResets < LOCK_RESETS) {
                this.lockTimer = 0;
                this.lockResets += 1;
            }
        }

        move(dx) {
            if (!this.active()) return false;
            const p = this.piece;
            if (!this.fits(p.type, p.rot, p.x + dx, p.y)) return false;
            p.x += dx;
            this.lastRotate = false;
            this.moved();
            this.emit('move', { dx });
            return true;
        }

        // dir 1 clockwise, -1 counter-clockwise
        rotate(dir) {
            if (!this.active()) return false;
            const p = this.piece;
            if (SHAPES[p.type].fixed) {
                this.emit('rotate', { kick: 0 });
                return true;
            }
            const to = (p.rot + (dir < 0 ? 3 : 1)) % 4;
            const table = (p.type === 'I' ? KICKS.I : KICKS.JLSTZ)[p.rot + '>' + to];
            for (let i = 0; i < table.length; i++) {
                const [dx, dy] = table[i];
                if (this.fits(p.type, to, p.x + dx, p.y + dy)) {
                    p.x += dx;
                    p.y += dy;
                    p.rot = to;
                    this.lastRotate = true;
                    this.lastKick = i;
                    this.moved();
                    this.emit('rotate', { kick: i });
                    return true;
                }
            }
            this.emit('blocked', { action: 'rotate' });
            return false;
        }

        dropDistance() {
            const p = this.piece;
            if (!p) return 0;
            let d = 0;
            while (this.fits(p.type, p.rot, p.x, p.y + d + 1)) d++;
            return d;
        }

        hardDrop() {
            if (!this.active()) return false;
            const p = this.piece;
            const d = this.dropDistance();
            const from = p.y;
            p.y += d;
            if (d > 0) this.lastRotate = false;
            this.score += d * 2;
            this.emit('harddrop', { from, to: p.y, cells: this.pieceCells() });
            this.lock();
            return true;
        }

        holdPiece() {
            if (!this.active()) return false;
            if (this.holdUsed) {
                this.emit('blocked', { action: 'hold' });
                return false;
            }
            const t = this.piece.type;
            const held = this.hold;
            this.hold = t;
            this.piece = null;
            this.emit('hold', { piece: t });
            this.spawn(held || undefined);
            this.holdUsed = true;
            return true;
        }

        pieceCells(p) {
            p = p || this.piece;
            if (!p) return [];
            return CELLS[p.type][p.rot].map(([x, y]) => [p.x + x, p.y + y]);
        }

        ghostY() {
            return this.piece ? this.piece.y + this.dropDistance() : 0;
        }

        // ms elapsed; soft: the soft drop key is down (20x gravity, a point a row)
        tick(dt, soft) {
            if (this.over) return;
            if (this.clearing) {
                this.clearing.t -= dt;
                if (this.clearing.t <= 0) this.finishClear();
                return;
            }
            const p = this.piece;
            if (!p) return;
            const g = gravityMs(this.level);
            const interval = soft ? Math.min(g, Math.max(g / 20, 20)) : g;
            this.gravityAcc += dt;
            while (this.gravityAcc >= interval) {
                if (!this.fits(p.type, p.rot, p.x, p.y + 1)) {
                    this.gravityAcc = 0;
                    break;
                }
                this.gravityAcc -= interval;
                p.y += 1;
                this.lastRotate = false;
                if (soft) this.score += 1;
                if (p.y > this.lowest) {
                    this.lowest = p.y;
                    this.lockResets = 0;
                    this.lockTimer = 0;
                }
                if (soft) this.emit('softdrop');
            }
            if (this.grounded()) {
                this.lockTimer += dt;
                if (this.lockTimer >= LOCK_DELAY) this.lock();
            } else this.lockTimer = 0;
        }

        // 3-corner rule: a T that turned into its place with three corners filled. Mini when only
        // one of the corners it points at is filled (unless the last kick moved it 1 x 2).
        tSpin() {
            const p = this.piece;
            if (p.type !== 'T' || !this.lastRotate) return null;
            const filled = (c) => !!this.cell(p.x + c[0], p.y + c[1]);
            const corners = T_CORNERS.filter(filled).length;
            if (corners < 3) return null;
            const front = T_FRONT[p.rot].filter(filled).length;
            return front === 2 || this.lastKick === 4 ? 'full' : 'mini';
        }

        lock() {
            const p = this.piece;
            if (!p) return;
            const cells = this.pieceCells();
            const tspin = this.tSpin();
            cells.forEach(([x, y]) => {
                if (y >= 0) this.board[y * COLS + x] = COLOR[p.type] + 1;
            });
            const lockOut = cells.every(([, y]) => y < HIDDEN);
            const rows = [];
            for (let y = 0; y < ROWS; y++) {
                let full = true;
                for (let x = 0; x < COLS; x++) {
                    if (!this.board[y * COLS + x]) {
                        full = false;
                        break;
                    }
                }
                if (full) rows.push(y);
            }
            const n = rows.length;
            const level = this.level;
            let points;
            if (tspin === 'full') points = TSPIN_POINTS[n] * level;
            else if (tspin === 'mini') points = MINI_POINTS[Math.min(n, 2)] * level;
            else points = LINE_POINTS[n] * level;
            const difficult = n > 0 && (n === 4 || !!tspin);
            let b2b = false;
            if (difficult && this.b2b) {
                points = Math.floor(points * 1.5);
                b2b = true;
            }
            if (n > 0) this.b2b = difficult;
            if (n > 0) {
                this.combo += 1;
                if (this.combo > 0) points += 50 * this.combo * level;
            } else this.combo = -1;
            this.score += points;
            if (n === 4) this.counts.quads += 1;
            if (tspin && n > 0) this.counts.tspins += 1;
            this.piece = null;
            this.holdUsed = false;
            this.emit('lock', { cells, piece: p.type, lines: n, tspin, points, b2b, combo: this.combo });
            if (lockOut && n === 0) {
                this.gameOver('lockout');
                return;
            }
            if (n) {
                this.clearing = { rows, t: this.clearDelay, total: this.clearDelay };
                this.emit('clear', { rows, lines: n, tspin, b2b, combo: this.combo, points });
                if (this.clearDelay <= 0) this.finishClear();
            } else this.spawn();
        }

        finishClear() {
            const rows = this.clearing ? this.clearing.rows : [];
            this.clearing = null;
            const before = this.level;
            const keep = [];
            for (let y = 0; y < ROWS; y++) {
                if (rows.indexOf(y) < 0) keep.push(this.board.slice(y * COLS, (y + 1) * COLS));
            }
            const fresh = [];
            for (let i = 0; i < rows.length; i++) fresh.push(new Array(COLS).fill(0));
            this.board = [].concat(...fresh, ...keep);
            this.lines += rows.length;
            if (this.level > before) this.emit('levelup', { level: this.level });
            if (this.goal && this.lines >= this.goal) {
                this.won = true;
                this.over = true;
                this.emit('win');
                return;
            }
            this.spawn();
        }

        gameOver(why) {
            this.over = true;
            this.emit('gameover', { why });
        }

        serialize() {
            return {
                board: this.board.slice(), bag: this.bag.slice(), queue: this.queue.slice(), hold: this.hold, holdUsed: this.holdUsed,
                piece: this.piece ? Object.assign({}, this.piece) : null, score: this.score, lines: this.lines, combo: this.combo,
                b2b: this.b2b, startLevel: this.startLevel, goal: this.goal, counts: Object.assign({}, this.counts),
                clearing: this.clearing ? this.clearing.rows.slice() : null
            };
        }

        static restore(s, opts) {
            const e = new Engine(Object.assign({}, opts, { startLevel: s.startLevel, goal: s.goal }));
            e.board = s.board.slice();
            e.bag = s.bag.slice();
            e.queue = s.queue.slice();
            e.hold = s.hold;
            e.holdUsed = !!s.holdUsed;
            e.piece = s.piece ? Object.assign({}, s.piece) : null;
            e.score = s.score;
            e.lines = s.lines;
            e.combo = s.combo;
            e.b2b = !!s.b2b;
            e.counts = Object.assign(e.counts, s.counts || {});
            if (e.piece) e.lowest = e.piece.y;
            if (s.clearing && s.clearing.length) {
                e.clearing = { rows: s.clearing, t: 0, total: 0 };
                e.finishClear();
            } else if (!e.piece) e.spawn();
            e.events = [];
            return e;
        }
    }

    const rules = { DISPLAY_NAME, COLS, ROWS, HIDDEN, GOAL_LINES, TYPES, COLOR, CELLS, KICKS, LINE_POINTS, TSPIN_POINTS, gravityMs, Engine };
    if (typeof module === 'object' && module.exports) module.exports = rules;

    const VG = root.VistaGames;
    if (!VG || typeof document === 'undefined') return;

    // ---- game window ------------------------------------------------------------------------
    const GAME_ID = 'blockdrop';
    const MODAL_ID = 'vistaBlockDropModal';
    const ICON = '/static_images/vista-games/icons/' + GAME_ID;
    const TILE = 18;
    const LIGHT_W = 30;       // Minesweeper's lighting map (Tiles_Normal / Tiles_Pressed frames)
    const LIGHT_H = 24;
    const MS_MIN_W = 9 * TILE + 60;
    // native client: frame 30 px (33 at the bottom), 72 px side columns 8 px off the well
    const SIDE = 72;
    const GAP = 8;
    const FX = 30 + SIDE + GAP;
    const FY = 30;
    const FW = COLS * TILE;
    const FH = (ROWS - HIDDEN) * TILE;
    const NATIVE_W = FX + FW + GAP + SIDE + 30;
    const NATIVE_H = FY + FH + 33;
    const LX = 30 + 4;
    const RX = FX + FW + GAP + 4;
    const COL_W = SIDE - 8;
    const DAS = 170;
    const ARR = 50;
    const CLEAR_MS = 320;

    // menu command ids (the Vista games' own, Minesweeper.exe.mui menu 163)
    const CMD = { NEW: 40006, STATS: 40003, OPTIONS: 40004, APPEARANCE: 40002, EXIT: 40005, HELP: 40008, ABOUT: 40007 };
    const MENU = [
        { text: '&Game', items: [
            { id: CMD.NEW, text: '&New Game\tF2' },
            { separator: true },
            { id: CMD.STATS, text: '&Statistics\tF4' },
            { id: CMD.OPTIONS, text: '&Options\tF5' },
            { id: CMD.APPEARANCE, text: 'Change &Appearance\tF7' },
            { separator: true },
            { id: CMD.EXIT, text: 'E&xit' }
        ] },
        { text: '&Help', items: [
            { id: CMD.HELP, text: '&View Help\tF1' },
            { separator: true },
            { id: CMD.ABOUT, text: '&About ' + DISPLAY_NAME }
        ] }
    ];
    // Minesweeper's accelerator table 167 (FVIRTKEY)
    const ACCELERATORS = [
        { flags: 1, key: 112, id: CMD.HELP }, { flags: 1, key: 113, id: CMD.NEW }, { flags: 1, key: 115, id: CMD.STATS },
        { flags: 1, key: 116, id: CMD.OPTIONS }, { flags: 1, key: 118, id: CMD.APPEARANCE }
    ];

    // Vista's wording (Minesweeper.exe.mui / Solitaire.exe.mui) and this game's own lines
    const STR = {
        newGame: 'New Game',
        newGameAsk: 'What do you want to do with the game in progress?',
        quitNew: 'Quit and start a &new game\nThis counts as a loss in your statistics.',
        keepPlaying: '&Keep playing',
        exitGame: 'Exit Game',
        exitAsk: 'What do you want to do with the game in progress?',
        save: '&Save',
        dontSave: "&Don't save",
        cancel: 'Cancel',
        alwaysSave: 'Always save game on exit',
        savedFound: 'Saved Game Found',
        savedAsk: 'Do you want to continue your saved game?',
        yes: '&Yes',
        no: '&No',
        alwaysContinue: 'Always continue saved game',
        resetStats: 'Reset Statistics',
        resetAsk: 'Do you want to reset all your statistics to zero?',
        changed: 'Changed Game Settings',
        changedAsk: "These settings won't apply to the game in progress. What do you want to do?",
        changedQuit: 'Quit and start a &new game with the new settings\nThis counts as a loss in your statistics.',
        changedFinish: '&Finish the game\nThe new settings apply to your next game.',
        gameWon: 'Game Won',
        gameLost: 'Game Lost',
        won: 'Congratulations, you won the game!',
        lost: 'Sorry, you lost this game. Better luck next time!',
        newHigh: 'You have a new high score!',
        played: 'Games played: %1',
        gamesWon: 'Games won: %1',
        winPct: 'Win percentage: %1%',
        longestWin: 'Longest winning streak: %1',
        longestLose: 'Longest losing streak: %1',
        streakWin: ['Current streak: %1 wins', 'Current streak: %1 win'],
        streakLose: ['Current streak: %1 losses', 'Current streak: %1 loss'],
        pct: 'Percentage: %1%',
        score: 'Score: %1',
        highScore: 'High score: %1',
        date: 'Date: %1',
        time: 'Time: %1',
        lines: 'Lines: %1',
        level: 'Level: %1',
        bestLevel: 'Highest level: %1',
        mostLines: 'Most lines: %1',
        totalLines: 'Total lines: %1',
        statsTitle: DISPLAY_NAME + ' Statistics - %1',
        appearance: 'Change Appearance',
        selectStyle: 'Select Block Style',
        selectBoard: 'Select Board',
        randomLook: '&Randomly choose block style and board',
        howTo: 'How To Play',
        howToText: 'Fit the falling blocks together to fill rows across the well; a full row clears. Clear '
            + GOAL_LINES + ' lines to win.',
        controls: 'Controls',
        controlsText: 'Left and Right arrows: move. Up arrow or X: turn. Z or Ctrl: turn the other way. Down arrow: '
            + 'drop faster. Spacebar: drop. C or Shift: hold the piece for later. P or F3: pause.',
        paused: 'Paused',
        resume: 'Press P or click to continue',
        ready: 'Ready?',
        pressKey: 'Press any key to start',
        hold: 'Hold',
        next: 'Next',
        scoreLabel: 'Score',
        levelLabel: 'Level',
        linesLabel: 'Lines',
        levelUp: 'Level %1',
        clearNames: ['', 'Single', 'Double', 'Triple', 'Quadruple'],
        tspin: 'T-Spin',
        mini: 'Mini T-Spin',
        b2b: 'Back-to-Back',
        combo: 'Combo x%1'
    };

    const BLOCK_STYLES = [{ name: 'Glossy', sprite: 'Blocks_Glossy.xml' }, { name: 'Crystal', sprite: 'Blocks_Crystal.xml' }];
    // the empty well: Minesweeper's open tiles per board (lighting map), or the midnight cell
    const BOARDS = [
        { name: 'Silver and Blue', pressed: 'UI\\Blue_Tiles_Pressed.xml', shadowL: 'UI\\Blue_Tile_Shadow_L.xml', shadowU: 'UI\\Blue_Tile_Shadow_U.xml', panel: 'UI\\Blue_Number_Panel.xml', label: '#ffffff' },
        { name: 'Green', pressed: 'UI\\Green_Tiles_Pressed.xml', shadowL: 'UI\\Green_Tile_Shadow_L.xml', shadowU: 'UI\\Green_Tile_Shadow_U.xml', panel: 'UI\\Green_Number_Panel.xml', label: '#ffffff' },
        { name: 'Midnight', cell: 'Blocks_Midnight_Cell.xml', panel: 'UI\\Blue_Number_Panel.xml', label: '#ffffff' }
    ];

    const store = VG.store(GAME_ID);
    const DEFAULT_SETTINGS = {
        animations: true,
        sounds: true,
        tips: true,
        continueSaved: false,
        saveOnExit: false,
        startLevel: 1,
        ghost: true,
        nextCount: 3,
        style: 0,
        board: 0,
        randomLook: false
    };

    let game = null;

    function settings() {
        return Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
    }

    function saveSettings(s) {
        store.set('settings', s);
    }

    function blankStats() {
        return { played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: [], bestLevel: 0, mostLines: 0, totalLines: 0 };
    }

    function stats() {
        return Object.assign(blankStats(), store.get('stats', {}));
    }

    function fmt(template, ...args) {
        return String(template).replace(/%(\d)(?:!\w!)?/g, (_, n) => String(args[Number(n) - 1]));
    }

    // the current streak, as Solitaire's statistics write it (0 counts as wins)
    function streakText(streak) {
        const n = Math.abs(streak);
        const forms = streak < 0 ? STR.streakLose : STR.streakWin;
        return fmt(forms[n === 1 ? 1 : 0], n);
    }

    function clockText(ms) {
        const s = Math.floor(ms / 1000);
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    // the engine's <Sounds> block, written out: [pack, name, file, volume, buffers]
    function soundsNode(list) {
        return {
            t: 'Sounds',
            c: list.map(([name, file, volume, buffers]) => ({
                t: name,
                c: [{ t: 'File', v: file }, { t: 'Volume', v: String(volume) }, { t: 'Buffers', v: String(buffers) }]
            }))
        };
    }

    // three of Mahjong Titans' sounds, without loading its 880 KB pack data
    const MAHJONG_AUDIO = {
        audioUrl: (file) => '/static_images/vista-games/mahjong/audio/' + file.replace(/\.wma$/i, '').toLowerCase() + '.m4a'
    };

    // the background music: Teleport's (PLANET_SWITCHER_BGM, planetSwitcher.js), faded in as play
    // starts and out on pause, game over and close
    const MUSIC = Object.freeze({
        url: '/sounds/planet/innerlight.opus',
        gain: 0.4,
        fadeIn: 3000,
        fadeResume: 1200,
        fadeOut: 500,
        fadeEnd: 1800
    });

    // the balloon (VG.drawTip fills it edge to edge since #609's engine fix)
    function drawTip(st, style, tip) {
        return VG.drawTip(st, style, tip);
    }

    // VG.warmSprites per pack: the sprites come from this game's pack, Minesweeper's and the card
    // games', and each pack loads its own sheets
    function warmSprites(stage, defs) {
        const byPack = new Map();
        defs.forEach((d) => {
            if (!byPack.has(d.pack)) byPack.set(d.pack, []);
            byPack.get(d.pack).push(d);
        });
        return Promise.all(Array.from(byPack, ([pack, list]) => VG.warmSprites(stage, pack, list)));
    }

    // ---- dialog templates (DIALOGEX layout in dialog units, as the Vista games' own) --------
    const BS_GROUPBOX = 0x50000007;
    const BS_DEFPUSH = 0x50030001;
    const BS_PUSH = 0x50010000;
    const BS_CHECK = 0x50010003;
    const BS_RADIO_FIRST = 0x50030009;
    const BS_RADIO = 0x50000009;
    const SS_LEFT = 0x50020000;
    const SS_CENTER = 0x50020001;
    const SS_RIGHT = 0x50020002;
    const ES_NUMBER = 0x50812080;

    const OPTIONS_TPL = {
        cx: 255, cy: 210, title: 'Options',
        controls: [
            { id: -1, className: 'Button', text: 'Game', x: 8, y: 6, cx: 240, cy: 76, style: BS_GROUPBOX },
            { id: 1101, className: 'Static', text: 'Starting &level (1-15):', x: 16, y: 21, cx: 96, cy: 8, style: SS_LEFT },
            { id: 1102, className: 'Edit', text: '', x: 116, y: 19, cx: 30, cy: 14, style: ES_NUMBER },
            { id: 1103, className: 'Static', text: 'Pieces shown in Next:', x: 16, y: 41, cx: 96, cy: 8, style: SS_LEFT },
            { id: 1104, className: 'Button', text: '&1', x: 116, y: 40, cx: 26, cy: 10, style: BS_RADIO_FIRST },
            { id: 1105, className: 'Button', text: '&3', x: 146, y: 40, cx: 26, cy: 10, style: BS_RADIO },
            { id: 1106, className: 'Button', text: '&5', x: 176, y: 40, cx: 26, cy: 10, style: BS_RADIO },
            { id: 1107, className: 'Button', text: 'Show &ghost piece (where the piece will land)', x: 16, y: 58, cx: 226, cy: 13, style: 0x50030003 },
            { id: 1002, className: 'Button', text: '&Display animations', x: 15, y: 92, cx: 233, cy: 13, style: 0x50030003 },
            { id: 1017, className: 'Button', text: '&Play sounds', x: 15, y: 107, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1018, className: 'Button', text: '&Show tips', x: 15, y: 122, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1020, className: 'Button', text: 'Always &continue saved game', x: 15, y: 137, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1044, className: 'Button', text: '&Always save game on exit', x: 15, y: 152, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1, className: 'Button', text: 'OK', x: 95, y: 189, cx: 72, cy: 14, style: BS_DEFPUSH },
            { id: 2, className: 'Button', text: 'Cancel', x: 171, y: 189, cx: 72, cy: 14, style: BS_PUSH }
        ]
    };

    // Solitaire's statistics box (405), the difficulty list left out
    const STATS_TPL = {
        cx: 300, cy: 128, title: '',
        controls: [
            { id: 2, className: 'Button', text: '&Close', x: 113, y: 107, cx: 88, cy: 14, style: BS_DEFPUSH },
            { id: 1001, className: 'Button', text: '&Reset', x: 205, y: 107, cx: 88, cy: 14, style: BS_PUSH },
            { id: -1, className: 'Button', text: 'High Scores', x: 7, y: 6, cx: 136, cy: 62, style: BS_GROUPBOX }
        ].concat([0, 1, 2, 3, 4].reduce((list, i) => list.concat([
            { id: 1201 + i, className: 'Static', text: '', x: 14, y: 17 + i * 9, cx: 50, cy: 8, style: SS_RIGHT },
            { id: 1211 + i, className: 'Static', text: '', x: 72, y: 17 + i * 9, cx: 66, cy: 8, style: SS_LEFT }
        ]), [])).concat([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            // three groups as Solitaire's: games, streaks, this game's own records
            { id: 1221 + i, className: 'Static', text: '', x: 152, y: 6 + i * 10 + Math.floor(i / 3) * 4, cx: 141, cy: 8, style: SS_LEFT }
        )))
    };

    // Solitaire's Game Lost / Game Won boxes (108 / 109) with this game's lines
    function resultTemplate(won) {
        return {
            cx: 248, cy: 128, title: won ? STR.gameWon : STR.gameLost,
            controls: [
                { id: 1300, className: 'Static', text: won ? STR.won : STR.lost, x: 7, y: 8, cx: 234, cy: 12, style: SS_CENTER },
                { id: -1, className: 'Button', text: 'Game Score', x: 7, y: 23, cx: 234, cy: 46, style: BS_GROUPBOX },
                { id: 1301, className: 'Static', text: '', x: 18, y: 36, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1302, className: 'Static', text: '', x: 130, y: 36, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1303, className: 'Static', text: '', x: 18, y: 48, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1304, className: 'Static', text: '', x: 130, y: 48, cx: 104, cy: 8, style: SS_LEFT },
                { id: 1309, className: 'Static', text: STR.newHigh, x: 18, y: 58, cx: 216, cy: 8, style: SS_LEFT },
                { id: 1305, className: 'Static', text: '', x: 13, y: 76, cx: 110, cy: 8, style: SS_LEFT },
                { id: 1306, className: 'Static', text: '', x: 130, y: 76, cx: 110, cy: 8, style: SS_LEFT },
                { id: 1307, className: 'Static', text: '', x: 13, y: 88, cx: 110, cy: 8, style: SS_LEFT },
                { id: 1308, className: 'Static', text: '', x: 130, y: 88, cx: 110, cy: 8, style: SS_LEFT },
                { id: 2, className: 'Button', text: '&Play again', x: 38, y: 107, cx: 80, cy: 14, style: BS_DEFPUSH },
                { id: 1004, className: 'Button', text: 'E&xit', x: 130, y: 107, cx: 80, cy: 14, style: BS_PUSH }
            ]
        };
    }

    // Minesweeper's Change Appearance box (500)
    const APPEARANCE_TPL = {
        cx: 394, cy: 236, title: STR.appearance,
        controls: [
            { id: 1, className: 'Button', text: 'OK', x: 236, y: 215, cx: 72, cy: 14, style: BS_DEFPUSH },
            { id: 2, className: 'Button', text: 'Cancel', x: 310, y: 215, cx: 72, cy: 14, style: BS_PUSH },
            { id: 5002, className: 'Static', text: STR.selectStyle, x: 7, y: 7, cx: 234, cy: 8, style: SS_LEFT },
            { id: 5000, className: 'SysListView32', text: '', x: 7, y: 17, cx: 380, cy: 78, style: 0x5083084c },
            { id: 5003, className: 'Static', text: STR.selectBoard, x: 7, y: 103, cx: 234, cy: 8, style: SS_LEFT },
            { id: 5001, className: 'SysListView32', text: '', x: 7, y: 113, cx: 380, cy: 78, style: 0x5083084c },
            { id: 5004, className: 'Button', text: STR.randomLook, x: 7, y: 198, cx: 233, cy: 10, style: 0x50030003 }
        ]
    };

    // ---- look --------------------------------------------------------------------------------
    class Look {
        constructor(packs, s) {
            this.packs = packs;
            const ms = packs.ms;
            const doc = ms.xml('UI\\Minesweeper.xml');
            const shared = VG.child(doc, 'Shared');
            const sp = (node, tag) => ms.sprite(VG.text(node, tag));
            const names = ['TopLeftHorz', 'TopLeftVert', 'TopCenter', 'TopRightHorz', 'TopRightVert', 'CenterLeft', 'CenterRight',
                'BottomLeftHorz', 'BottomLeftVert', 'BottomCenter', 'BottomRightHorz', 'BottomRightVert'];
            this.panel = {};
            names.forEach((n) => { this.panel[n] = sp(shared, 'PanelCustom' + n + 'Xml'); });
            this.clock = sp(shared, 'PanelClockSpriteXml');
            this.scanBar = sp(shared, 'DisarmScanBarXml');
            const layout = VG.child(VG.child(doc, 'Layouts'), 'CustomLayout');
            const lay = (tag) => {
                const n = VG.child(layout, tag);
                return { x: VG.num(n, 'X'), y: VG.num(n, 'Y'), w: VG.num(n, 'Width'), h: VG.num(n, 'Height') };
            };
            this.pos = { timeImage: lay('TimeImage'), timeBack: lay('TimeLabelBack'), timeLabel: lay('TimeLabel'), mineImage: lay('MineImage'), minesBack: lay('MinesLabelBack'), minesLabel: lay('MinesLabel') };
            this.tipStyle = VG.tipStyle(ms, 'White');
            const cg = packs.cards;
            this.particles = { sparkle: cg.sprite('SparkleParticle.xml'), star: cg.sprite('StarParticle.xml'), blob: cg.sprite('BlobParticle.xml') };
            this.blocks = BLOCK_STYLES.map((b) => packs.game.sprite(b.sprite));
            this.ghost = packs.game.sprite('Blocks_Ghost.xml');
            this.boards = BOARDS.map((b) => ({
                def: b,
                pressed: b.pressed ? ms.sprite(b.pressed) : null,
                cell: b.cell ? packs.game.sprite(b.cell) : null,
                shadowL: b.shadowL ? ms.sprite(b.shadowL) : null,
                shadowU: b.shadowU ? ms.sprite(b.shadowU) : null,
                numberPanel: ms.sprite(b.panel)
            }));
            // the real games' sounds: Mahjong Titans' tile clacks for a piece landing (Minesweeper's
            // tile beeps were far too loud for a sound heard every second), Minesweeper's and the
            // card games' for the rest
            this.sounds = [
                new VG.Sounds(MAHJONG_AUDIO, soundsNode([
                    ['Lock', 'Mahjong_PieceClack01.wma', 80, 3],
                    ['Lock', 'Mahjong_PieceClack02.wma', 80, 3],
                    ['Lock', 'Mahjong_PieceClack03.wma', 80, 3],
                    ['Clear', 'Mahjong_Good.wma', 100, 2]
                ])),
                new VG.Sounds(ms, soundsNode([
                    ['NewGame', 'Minesweeper_GameStart.wma', 45, 1],
                    ['GameOver', 'Minesweeper_Lose.wma', 50, 1],
                    ['Win', 'Minesweeper_Win.wma', 55, 1],
                    ['Blocked', 'InvalidMove.wma', 35, 3]
                ])),
                new VG.Sounds(cg, soundsNode([
                    ['Rotate', 'Shared_MoveCardSetDown.wma', 55, 4],
                    ['Hold', 'Shared_Liftoff.wma', 80, 2],
                    ['HardDrop', 'Hearts_CardPlayed.wma', 90, 3],
                    ['Quad', 'Shared_MoveToHome.wma', 100, 2],
                    ['TSpin', 'Shared_HintShown.wma', 90, 1],
                    ['LevelUp', 'Shared_PointsChange.wma', 100, 1],
                    ['Pause', 'Button_Stereo.wma', 45, 1]
                ]))
            ];
            this.set(s.style, s.board);
        }

        set(style, board) {
            this.styleIndex = Math.max(0, Math.min(BLOCK_STYLES.length - 1, style | 0));
            this.boardIndex = Math.max(0, Math.min(BOARDS.length - 1, board | 0));
            this.block = this.blocks[this.styleIndex];
            this.board = this.boards[this.boardIndex];
        }

        play(name) {
            for (const s of this.sounds) {
                if (s.defs[name]) return s.play(name);
            }
            return null;
        }

        setSound(on) {
            this.sounds.forEach((s) => { s.enabled = on; });
        }

        warmSounds() {
            this.sounds.forEach((s) => s.warm());
        }

        // every sprite of every style (the Change Appearance thumbnails draw them all)
        allSprites() {
            const list = Object.values(this.panel).concat([this.clock, this.scanBar, this.ghost], this.blocks, Object.values(this.particles));
            this.boards.forEach((b) => list.push(b.pressed, b.cell, b.shadowL, b.shadowU, b.numberPanel));
            if (this.tipStyle) list.push(...this.tipStyle.sprites());
            return list.filter(Boolean);
        }
    }

    // ---- music -------------------------------------------------------------------------------
    // One looping track faded with timers, not animation frames, so a fade still finishes in a
    // hidden tab; a fade to silence pauses it where it is (resume carries on from there).
    class Music {
        constructor() {
            this.audio = null;
            this.fade = null;
            this.timer = 0;
        }

        to(gain, ms) {
            if (gain > 0 && !this.audio) {
                this.audio = new Audio(MUSIC.url);
                this.audio.loop = true;
                this.audio.preload = 'auto';
                this.audio.volume = 0;
            }
            const a = this.audio;
            if (!a) return;
            if (gain > 0 && a.paused) {
                const p = a.play();
                if (p && p.catch) p.catch(() => {});
            }
            this.fade = { from: a.volume, to: gain, start: VG.now(), ms: Math.max(1, ms) };
            if (!this.timer) this.step();
        }

        step() {
            this.timer = 0;
            const a = this.audio;
            const f = this.fade;
            if (!a || !f) return;
            const u = Math.min(1, (VG.now() - f.start) / f.ms);
            // rising: eased in, so the first seconds come up gently
            const k = f.to > f.from ? u * u : u;
            a.volume = Math.max(0, Math.min(1, f.from + (f.to - f.from) * k));
            if (u < 1) {
                this.timer = setTimeout(() => this.step(), 30);
                return;
            }
            this.fade = null;
            if (f.to <= 0) a.pause();
        }

        rewind() {
            if (this.audio && this.audio.paused) this.audio.currentTime = 0;
        }
    }

    // ---- game --------------------------------------------------------------------------------
    class BlockDrop {
        constructor(packs) {
            this.packs = packs;
            this.pack = packs.game;
            this.s = settings();
            this.look = new Look(packs, this.s);
            this.music = new Music();
            this.musicOn = false;
            this.state = 'ready';     // ready | playing | ending | over
            this.paused = false;
            this.pauseReason = null;
            this.time = 0;
            this.keys = { left: false, right: false, down: false };
            this.das = { dir: 0, t: 0, arr: 0 };
            this.effects = [];        // particles, popups, trails
            this.tip = null;
            this.last = 0;
            this.pack.mui.accelerators.game = ACCELERATORS;
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: DISPLAY_NAME,
                // the caption / taskbar icon: the app-icon set (getModalIcons, modalUtils.js, keeps the file name)
                icon: '/static_images/app_icons/48/vista-' + GAME_ID + '.webp',
                iconClass: 'fas fa-cubes',
                pack: this.pack,
                menu: MENU,
                accelerators: 'game',
                nativeW: NATIVE_W,
                nativeH: NATIVE_H,
                fill: '#d9dfe7',
                maximizable: true,
                onCommand: (id) => this.command(id),
                onClose: () => this.requestExit(),
                onClosed: () => this.syncMusic(MUSIC.fadeOut, true),
                onActivate: (active) => this.setActive(active),
                onKeyDown: (e) => this.keyDown(e),
                onKeyUp: (e) => this.keyUp(e)
            });
            const stage = this.win.stage;
            stage.draw = (ctx, st) => this.draw(st);
            stage.onFrame = (now) => this.frame(now);
            this.wirePointer();
            document.addEventListener('visibilitychange', () => this.syncMusic());
            this.newGame(false);
        }

        warm() {
            return warmSprites(this.win.stage, this.look.allSprites());
        }

        makeEngine() {
            return new Engine({ startLevel: this.s.startLevel, clearDelay: this.s.animations ? CLEAR_MS : 0 });
        }

        // ---- game flow -------------------------------------------------------------------------
        newGame(sound) {
            this.engine = this.makeEngine();
            this.state = 'ready';
            this.time = 0;
            this.paused = false;
            this.pauseReason = null;
            this.effects = [];
            this.ending = null;
            this.clearFx = null;
            this.releaseKeys();
            if (sound !== false && this.win.isOpen()) this.look.play('NewGame');
            if (this.tip && this.tip.id === 'Help') this.hideTip();
            this.syncMusic();
            this.win.stage.invalidate();
        }

        begin() {
            if (this.state !== 'ready') return;
            this.state = 'playing';
            this.last = VG.now();
            if (this.tip && this.tip.id === 'Start') this.hideTip();
            this.engine.start();
            this.handleEvents();
            this.music.rewind();
            this.syncMusic(MUSIC.fadeIn);
            this.win.stage.invalidate();
        }

        // the music plays while a game runs (Play sounds on, and the desktop's sounds), faded in
        // from silence as it starts and out on pause, game over and close
        syncMusic(ms, closing) {
            const ds = root.desktopSounds;
            const on = !closing && this.s.sounds && VG.soundEnabled && !(ds && ds.isEnabled && !ds.isEnabled())
                && this.state === 'playing' && !this.paused && this.win.isOpen() && !document.hidden;
            if (on === this.musicOn) return;
            this.musicOn = on;
            this.music.to(on ? MUSIC.gain : 0, ms || (on ? MUSIC.fadeResume : MUSIC.fadeOut));
        }

        inProgress() {
            return this.state === 'playing';
        }

        setActive(active) {
            if (!active) {
                this.releaseKeys();
                if (this.state === 'playing' && !this.paused) this.pause('inactive');
            }
            this.win.stage.invalidate();
        }

        pause(reason) {
            if (this.state !== 'playing' || this.paused) return;
            this.paused = true;
            this.pauseReason = reason || 'user';
            this.releaseKeys();
            this.syncMusic();
            this.win.stage.invalidate();
        }

        resume() {
            if (!this.paused) return;
            this.paused = false;
            this.pauseReason = null;
            this.last = VG.now();
            if (this.tip && this.tip.id === 'Help') this.hideTip();
            this.syncMusic();
            this.win.stage.invalidate();
        }

        togglePause() {
            if (this.state !== 'playing') return;
            this.look.play('Pause');
            if (this.paused) this.resume();
            else this.pause('user');
        }

        releaseKeys() {
            this.keys.left = this.keys.right = this.keys.down = false;
            this.das.dir = 0;
        }

        finish() {
            const won = this.engine.won;
            this.state = 'over';
            this.record(won);
            store.remove('saved');
            this.showResult(won);
        }

        record(won) {
            const e = this.engine;
            const st = stats();
            st.played += 1;
            if (won) {
                st.won += 1;
                st.streak = st.streak > 0 ? st.streak + 1 : 1;
                st.longestWin = Math.max(st.longestWin, st.streak);
            } else {
                st.streak = st.streak < 0 ? st.streak - 1 : -1;
                st.longestLose = Math.max(st.longestLose, -st.streak);
            }
            this.lastHigh = false;
            if (e.score > 0) {
                const entry = { score: e.score, date: Date.now(), level: e.level, lines: e.lines };
                st.best.push(entry);
                st.best.sort((a, b) => b.score - a.score || a.date - b.date);
                st.best = st.best.slice(0, 5);
                this.lastHigh = st.best[0] === entry;
            }
            st.bestLevel = Math.max(st.bestLevel, e.level);
            st.mostLines = Math.max(st.mostLines, e.lines);
            st.totalLines += e.lines;
            store.set('stats', st);
            this.lastStats = st;
        }

        // ---- input ---------------------------------------------------------------------------
        wirePointer() {
            const surface = this.win.surface;
            const pos = (e) => {
                const r = surface.getBoundingClientRect();
                return this.win.stage.toNative(e.clientX - r.left, e.clientY - r.top);
            };
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointermove', (e) => {
                if (this.tipHit(pos(e), 'move')) this.win.stage.invalidate();
            });
            surface.addEventListener('pointerdown', (e) => {
                surface.focus({ preventScroll: true });
                const p = pos(e);
                if (this.tipHit(p, 'down')) return;
                if (e.button !== 0) return;
                if (this.state === 'ready') this.begin();
                else if (this.paused) this.togglePause();
            });
            surface.addEventListener('pointerup', (e) => {
                this.tipHit(pos(e), 'up');
            });
        }

        keyDown(e) {
            const k = e.key;
            const lower = k.length === 1 ? k.toLowerCase() : k;
            const gameKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'x', 'z', 'c', 'p', 'Control', 'Shift', 'F3', 'Enter'].indexOf(lower) >= 0;
            if (!gameKey) return;
            e.preventDefault();
            if (this.state === 'ready') {
                if (!e.repeat && lower !== 'Control' && lower !== 'Shift') this.begin();
                return;
            }
            if (this.state !== 'playing') return;
            if (lower === 'p' || lower === 'F3') {
                if (!e.repeat) this.togglePause();
                return;
            }
            if (this.paused) return;
            const en = this.engine;
            switch (lower) {
            case 'ArrowLeft':
            case 'ArrowRight': {
                if (e.repeat) return;
                const dir = lower === 'ArrowLeft' ? -1 : 1;
                this.keys[dir < 0 ? 'left' : 'right'] = true;
                this.das = { dir, t: 0, arr: 0 };
                en.move(dir);
                break;
            }
            case 'ArrowDown':
                this.keys.down = true;
                break;
            case 'ArrowUp':
            case 'x':
                if (!e.repeat) en.rotate(1);
                break;
            case 'z':
            case 'Control':
                if (!e.repeat) en.rotate(-1);
                break;
            case ' ':
                if (!e.repeat) en.hardDrop();
                break;
            case 'c':
            case 'Shift':
                if (!e.repeat) en.holdPiece();
                break;
            default:
                break;
            }
            this.handleEvents();
            this.win.stage.invalidate();
        }

        keyUp(e) {
            const k = e.key;
            if (k === 'ArrowLeft' || k === 'ArrowRight') {
                const dir = k === 'ArrowLeft' ? -1 : 1;
                this.keys[dir < 0 ? 'left' : 'right'] = false;
                if (this.das.dir === dir) {
                    const other = dir < 0 ? this.keys.right : this.keys.left;
                    this.das = { dir: other ? -dir : 0, t: 0, arr: 0 };
                }
            } else if (k === 'ArrowDown') this.keys.down = false;
        }

        // the held direction: one step at once, then after DAS one step every ARR
        autoShift(dt) {
            const d = this.das;
            if (!d.dir) return;
            const before = d.t;
            d.t += dt;
            if (d.t < DAS) return;
            d.arr += d.t - Math.max(before, DAS);
            while (d.arr >= ARR) {
                d.arr -= ARR;
                if (!this.engine.move(d.dir)) {
                    d.arr = 0;
                    break;
                }
            }
        }

        // ---- engine events -> sounds and effects ----------------------------------------------
        handleEvents() {
            const anim = this.s.animations;
            const now = VG.now();
            this.engine.takeEvents().forEach((ev) => {
                switch (ev.type) {
                case 'rotate':
                    this.look.play('Rotate');
                    break;
                case 'blocked':
                    this.look.play('Blocked');
                    break;
                case 'hold':
                    this.look.play('Hold');
                    break;
                case 'harddrop':
                    this.look.play('HardDrop');
                    if (anim && ev.to > ev.from) {
                        ev.cells.forEach(([x, y]) => this.effects.push({ kind: 'trail', x, y0: y - (ev.to - ev.from), y1: y, at: now, life: 220 }));
                    }
                    break;
                case 'lock':
                    if (!ev.lines) this.look.play('Lock');
                    if (ev.lines || ev.tspin) this.popup(ev, now);
                    break;
                case 'clear':
                    this.look.play(ev.lines === 4 ? 'Quad' : (ev.tspin ? 'TSpin' : 'Clear'));
                    if (anim) {
                        this.clearFx = { rows: ev.rows, at: now };
                        ev.rows.forEach((row) => this.sparkleRow(row, now, ev.lines));
                    }
                    break;
                case 'levelup':
                    this.look.play('LevelUp');
                    this.effects.push({ kind: 'text', text: fmt(STR.levelUp, ev.level), x: FX + FW / 2, y: FY + FH * 0.42, at: now + 200, life: 1300, size: 24 });
                    break;
                case 'gameover':
                    this.startEnding(false);
                    break;
                case 'win':
                    this.startEnding(true);
                    break;
                default:
                    break;
                }
            });
        }

        popup(ev, now) {
            const lines = [];
            if (ev.tspin) lines.push((ev.tspin === 'mini' ? STR.mini : STR.tspin) + (ev.lines ? ' ' + STR.clearNames[ev.lines] : ''));
            else if (ev.lines >= 2) lines.push(STR.clearNames[ev.lines]);
            if (ev.b2b) lines.push(STR.b2b);
            if (ev.combo > 0) lines.push(fmt(STR.combo, ev.combo));
            if (ev.points && ev.lines) lines.push('+' + ev.points);
            const y = FY + FH * 0.3;
            lines.forEach((t, i) => this.effects.push({ kind: 'text', text: t, x: FX + FW / 2, y: y + i * 20, at: now + i * 60, life: 1100, size: i === 0 && ev.lines >= 4 ? 22 : 16 }));
        }

        sparkleRow(row, now, n) {
            const y = FY + (row - HIDDEN) * TILE + TILE / 2;
            const count = 8 + n * 2;
            for (let i = 0; i < count; i++) {
                const x = FX + Math.random() * FW;
                this.effects.push({
                    kind: 'particle', sprite: Math.random() < 0.6 ? 'sparkle' : 'star', x, y: y + (Math.random() - 0.5) * 8,
                    vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 90, ay: 160, at: now + Math.random() * 120,
                    life: 500 + Math.random() * 400, size: 14 + Math.random() * 14
                });
            }
        }

        // game over: the stack goes grey from the bottom up; won: the scan bar sweeps it away
        startEnding(won) {
            const now = VG.now();
            this.state = 'ending';
            this.releaseKeys();
            this.look.play(won ? 'Win' : 'GameOver');
            this.syncMusic(MUSIC.fadeEnd);
            const anim = this.s.animations;
            this.ending = { won, at: now, until: now + (anim ? (won ? 2600 : 1400) : 0) };
            if (won && anim) {
                for (let i = 0; i < 40; i++) {
                    this.effects.push({
                        kind: 'particle', sprite: i % 3 ? 'star' : 'sparkle', x: FX + Math.random() * FW, y: FY + FH * (0.2 + Math.random() * 0.6),
                        vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 120, ay: 120, at: now + Math.random() * 1800,
                        life: 700 + Math.random() * 500, size: 18 + Math.random() * 22
                    });
                }
            }
            this.win.stage.invalidate();
        }

        // ---- tips ----------------------------------------------------------------------------
        showTip(id) {
            const defs = { Start: [STR.howTo, STR.howToText], Help: [STR.controls, STR.controlsText] };
            const d = defs[id];
            if (!d) return;
            this.tip = { id, title: d[0], message: d[1], alpha: 0, shownAt: VG.now(), noTimeout: true, target: 1 };
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
            if (phase === 'move') {
                if (t.closeHot !== onClose) {
                    t.closeHot = onClose;
                    return true;
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
            return false;
        }

        // ---- frame -----------------------------------------------------------------------------
        frame(now) {
            const dt = Math.min(100, Math.max(0, now - (this.last || now)));
            this.last = now;
            let busy = false;
            if (this.state === 'playing' && !this.paused) {
                busy = true;
                this.syncMusic();
                this.time += dt;
                this.autoShift(dt);
                this.engine.tick(dt, this.keys.down);
                this.handleEvents();
            }
            if (this.state === 'ending') {
                busy = true;
                if (now >= this.ending.until) {
                    this.state = 'over';
                    setTimeout(() => this.finish(), 0);
                }
            }
            if (this.clearFx && now - this.clearFx.at > CLEAR_MS + 60) this.clearFx = null;
            if (this.clearFx) busy = true;
            this.effects = this.effects.filter((fx) => now < fx.at + fx.life);
            if (this.effects.length) busy = true;
            if (this.tip) {
                const k = this.tip.target ? 1 : -1;
                const before = this.tip.alpha;
                this.tip.alpha = Math.max(0, Math.min(1, this.tip.alpha + k * 0.08));
                if (this.tip.alpha !== before) busy = true;
                if (!this.tip.target && this.tip.alpha <= 0) this.tip = null;
            }
            return busy;
        }

        // ---- drawing ---------------------------------------------------------------------------
        draw(st) {
            const look = this.look;
            const W = NATIVE_W;
            const H = NATIVE_H;
            const now = VG.now();
            this.drawPanel(st, W, H);
            this.drawInterior(st, W, H);
            this.drawWell(st, now);
            this.drawSide(st);
            this.drawEffects(st, now);
            this.drawCounters(st, W, H);
            this.drawOverlay(st, now);
            if (this.tip) {
                this.tip.rect = drawTip(st, look.tipStyle, Object.assign({}, this.tip, { x: FX - 16, y: FY + 150, w: FW + 32 }), this.tip.rect);
            }
        }

        // Minesweeper's frame, piece by piece (minesweeper.js drawPanel)
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

        // inside the frame: the frame's own silver carried across (a column of its left side,
        // stretched), so the well and the side boxes sit in one panel
        drawInterior(st, W, H) {
            const p = this.look.panel;
            const x0 = 30;
            const w = W - 60;
            const col = 18;
            const top = p.TopCenter.h;
            st.sprite(p.CenterLeft, x0, top, { cx: col, sw: 1, h: H - 33 - top, w });
            st.sprite(p.TopLeftVert, x0, top, { cx: col, sw: 1, w });
            const bl = p.BottomLeftVert;
            st.sprite(bl, x0, H - bl.h, { cx: col, sw: 1, sh: bl.h - 33, h: bl.h - 33, w });
        }

        boardFrame(x, y) {
            const ox = Math.floor((LIGHT_W - COLS) / 2);
            const oy = Math.floor((LIGHT_H - (ROWS - HIDDEN)) / 2);
            return (y + oy) * LIGHT_W + x + ox;
        }

        drawWell(st, now) {
            const look = this.look;
            const bd = look.board;
            const en = this.engine;
            const ctx = st.ctx;
            // paused: the well is covered; won: the stack is gone once the sweep has passed
            const covered = this.paused || (en.won && this.state === 'over');
            // the well's edge: the tiles' dark outline carried round
            ctx.fillStyle = '#2e3440';
            ctx.fillRect(FX - 1, FY - 1, FW + 2, FH + 2);
            const blocks = (x, y) => (y < HIDDEN ? 0 : en.cell(x, y));
            for (let y = HIDDEN; y < ROWS; y++) {
                for (let x = 0; x < COLS; x++) {
                    const px = FX + x * TILE;
                    const py = FY + (y - HIDDEN) * TILE;
                    if (bd.pressed) st.sprite(bd.pressed, px, py, { frame: this.boardFrame(x, y - HIDDEN) });
                    else st.sprite(bd.cell, px, py);
                }
            }
            if (covered) return;
            const pieceCells = new Set();
            const p = en.piece;
            if (p && this.state !== 'over') en.pieceCells().forEach(([x, y]) => pieceCells.add(y * COLS + x));
            const filled = (x, y) => (x >= 0 && x < COLS && y >= HIDDEN && y < ROWS) && (blocks(x, y) || pieceCells.has(y * COLS + x));
            // raised tiles throw a shadow on the open ones right of / under them
            if (bd.shadowL) {
                for (let y = HIDDEN; y < ROWS; y++) {
                    for (let x = 0; x < COLS; x++) {
                        if (filled(x, y)) continue;
                        const px = FX + x * TILE;
                        const py = FY + (y - HIDDEN) * TILE;
                        if (filled(x, y - 1)) st.sprite(bd.shadowU, px, py);
                        if (filled(x - 1, y)) st.sprite(bd.shadowL, px, py);
                    }
                }
            }
            const greyFrom = this.greyRow(now);
            const clearing = en.clearing ? en.clearing.rows : [];
            const clearK = this.clearFx ? Math.min(1, (now - this.clearFx.at) / CLEAR_MS) : 1;
            for (let y = HIDDEN; y < ROWS; y++) {
                const py = FY + (y - HIDDEN) * TILE;
                const isClear = clearing.indexOf(y) >= 0;
                for (let x = 0; x < COLS; x++) {
                    const v = blocks(x, y);
                    if (!v) continue;
                    const px = FX + x * TILE;
                    if (isClear) {
                        // the row draws in toward its centre as it clears
                        const shrink = Math.max(0, 1 - clearK * 1.2);
                        if (shrink <= 0) continue;
                        const cx = FX + FW / 2 + (px + TILE / 2 - FX - FW / 2) * (1 - clearK * 0.35);
                        st.sprite(look.block, cx - TILE * shrink / 2, py + TILE * (1 - shrink) / 2, { frame: v - 1, w: TILE * shrink, h: TILE * shrink });
                        continue;
                    }
                    const grey = greyFrom !== null && y >= greyFrom;
                    st.sprite(look.block, px, py, { frame: grey ? COLOR.G : v - 1 });
                }
                if (isClear) {
                    // the row flashes white under Minesweeper's scan bar, both fading
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(FX, FY, FW, FH);
                    ctx.clip();
                    ctx.globalAlpha = Math.max(0, 0.6 * (1 - clearK));
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(FX, py, FW, TILE);
                    const bar = look.scanBar;
                    if (bar) st.sprite(bar, FX - 30, py + TILE / 2 - 16, { w: FW + 60, h: 32, alpha: Math.max(0, 0.9 * (1 - clearK)) });
                    ctx.restore();
                }
            }
            if (this.ending && this.ending.won) this.drawWinSweep(st, now);
            if (!p || this.state === 'ending' || this.state === 'over') return;
            ctx.save();
            ctx.beginPath();
            ctx.rect(FX, FY, FW, FH);
            ctx.clip();
            if (this.s.ghost && this.state === 'playing') {
                const gy = en.ghostY();
                if (gy !== p.y) this.drawPiece(st, p, gy, COLOR[p.type], look.ghost);
            }
            this.drawPiece(st, p, p.y, COLOR[p.type]);
            ctx.restore();
        }

        drawPiece(st, p, y, frame, sprite) {
            CELLS[p.type][p.rot].forEach(([cx, cy]) => {
                const gy = y + cy;
                if (gy < HIDDEN - 1) return;
                st.sprite(sprite || this.look.block, FX + (p.x + cx) * TILE, FY + (gy - HIDDEN) * TILE, { frame });
            });
        }

        // the row from which the topped-out stack is grey, or null
        greyRow(now) {
            if (!this.ending || this.ending.won) return this.state === 'over' && this.engine.over && !this.engine.won ? HIDDEN : null;
            const span = this.ending.until - this.ending.at;
            const k = span > 0 ? Math.min(1, (now - this.ending.at) / span) : 1;
            return ROWS - Math.ceil(k * (ROWS - HIDDEN));
        }

        // won: Minesweeper's scan bar sweeps up the well, lifting the stack away under it
        drawWinSweep(st, now) {
            const span = this.ending.until - this.ending.at;
            const k = span > 0 ? Math.min(1, (now - this.ending.at) / (span * 0.7)) : 1;
            const y = FY + FH - k * (FH + 40);
            const bar = this.look.scanBar;
            const ctx = st.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.rect(FX, Math.max(FY, y + 20), FW, FY + FH - Math.max(FY, y + 20));
            ctx.clip();
            const bd = this.look.board;
            for (let gy = HIDDEN; gy < ROWS; gy++) {
                for (let x = 0; x < COLS; x++) {
                    const px = FX + x * TILE;
                    const py = FY + (gy - HIDDEN) * TILE;
                    if (bd.pressed) st.sprite(bd.pressed, px, py, { frame: this.boardFrame(x, gy - HIDDEN) });
                    else st.sprite(bd.cell, px, py);
                }
            }
            ctx.restore();
            if (bar && k < 1) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(FX - 12, FY - 30, FW + 24, FH + 30);
                ctx.clip();
                st.sprite(bar, FX + FW / 2 - bar.w / 2, y, { w: bar.w, alpha: 1 });
                ctx.restore();
            }
        }

        // a box of the side columns: the frosted glass of the Vista games' panels
        glassBox(ctx, x, y, w, h) {
            ctx.save();
            const r = 4;
            const path = () => {
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + w, y, r);
                ctx.closePath();
            };
            path();
            const g = ctx.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, 'rgba(255,255,255,0.92)');
            g.addColorStop(0.5, 'rgba(240,244,250,0.86)');
            g.addColorStop(1, 'rgba(219,228,240,0.86)');
            ctx.fillStyle = g;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#7f93b2';
            ctx.translate(0.5, 0.5);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w - 1, y, x + w - 1, y + h - 1, r);
            ctx.arcTo(x + w - 1, y + h - 1, x, y + h - 1, r);
            ctx.arcTo(x, y + h - 1, x, y, r);
            ctx.arcTo(x, y, x + w - 1, y, r);
            ctx.closePath();
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.beginPath();
            ctx.moveTo(x + r, y + 1);
            ctx.lineTo(x + w - 1 - r, y + 1);
            ctx.stroke();
            ctx.restore();
        }

        label(ctx, text, x, y, align) {
            ctx.save();
            ctx.font = '12px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.textBaseline = 'top';
            ctx.textAlign = align || 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.fillText(text, x, y + 1);
            ctx.fillStyle = '#1e3c64';
            ctx.fillText(text, x, y);
            ctx.restore();
        }

        // Minesweeper's number panel, stretched by its middle to w
        numberPanel(st, x, y, w, text) {
            // the panel is the 40 x 21 top left of its frame (the green board's frame is 64 x 64)
            const np = this.look.board.numberPanel;
            const pw = 40;
            const ph = 21;
            const cap = 8;
            st.sprite(np, x, y, { sw: cap, sh: ph, w: cap, h: ph });
            st.sprite(np, x + cap, y, { cx: cap, sw: pw - cap * 2, sh: ph, w: w - cap * 2, h: ph });
            st.sprite(np, x + w - cap, y, { cx: pw - cap, sw: cap, sh: ph, w: cap, h: ph });
            const ctx = st.ctx;
            ctx.save();
            ctx.fillStyle = this.look.board.def.label;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.fillText(text, x + w / 2, y + ph / 2 + 1);
            ctx.restore();
        }

        // a piece centred in a box at a cell size
        miniPiece(st, type, cx, cy, size, alpha) {
            const cells = CELLS[type][0];
            let minX = 9;
            let maxX = -1;
            let minY = 9;
            let maxY = -1;
            cells.forEach(([x, y]) => {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            });
            const w = (maxX - minX + 1) * size;
            const h = (maxY - minY + 1) * size;
            const ox = Math.round(cx - w / 2);
            const oy = Math.round(cy - h / 2);
            cells.forEach(([x, y]) => {
                st.sprite(this.look.block, ox + (x - minX) * size, oy + (y - minY) * size, { frame: COLOR[type], w: size, h: size, alpha });
            });
        }

        drawSide(st) {
            const ctx = st.ctx;
            const en = this.engine;
            const hidden = this.paused;
            // left: Hold, then the score readouts
            this.label(ctx, STR.hold, LX + 2, FY + 2);
            this.glassBox(ctx, LX, FY + 20, COL_W, 50);
            if (en.hold && !hidden) this.miniPiece(st, en.hold, LX + COL_W / 2, FY + 45, 13, en.holdUsed ? 0.45 : 1);
            const rows = [[STR.scoreLabel, String(en.score)], [STR.levelLabel, String(en.level)], [STR.linesLabel, String(en.lines)]];
            rows.forEach(([name, value], i) => {
                const y = FY + 88 + i * 46;
                this.label(ctx, name, LX + 2, y);
                this.numberPanel(st, LX, y + 18, COL_W, value);
            });
            // right: the Next queue, the first piece larger
            const n = Math.max(1, Math.min(5, this.s.nextCount | 0));
            const boxH = 46 + (n - 1) * 30;
            this.label(ctx, STR.next, RX + 2, FY + 2);
            this.glassBox(ctx, RX, FY + 20, COL_W, boxH);
            if (!hidden && this.state !== 'ready') {
                en.queue.slice(0, n).forEach((t, i) => {
                    if (i === 0) this.miniPiece(st, t, RX + COL_W / 2, FY + 43, 13);
                    else this.miniPiece(st, t, RX + COL_W / 2, FY + 66 + 30 * (i - 1) + 15, 10);
                });
            }
        }

        drawEffects(st, now) {
            const ctx = st.ctx;
            const parts = this.look.particles;
            ctx.save();
            ctx.beginPath();
            ctx.rect(FX - 40, FY - 20, FW + 80, FH + 20);
            ctx.clip();
            this.effects.forEach((fx) => {
                const t = now - fx.at;
                if (t < 0) return;
                const k = t / fx.life;
                if (fx.kind === 'trail') {
                    const x = FX + fx.x * TILE;
                    const y0 = FY + (Math.max(HIDDEN, fx.y0) - HIDDEN) * TILE;
                    const y1 = FY + (fx.y1 - HIDDEN) * TILE;
                    if (y1 <= y0) return;
                    const g = ctx.createLinearGradient(0, y0, 0, y1);
                    g.addColorStop(0, 'rgba(255,255,255,0)');
                    g.addColorStop(1, 'rgba(255,255,255,' + (0.55 * (1 - k)) + ')');
                    ctx.fillStyle = g;
                    ctx.fillRect(x + 2, y0, TILE - 4, y1 - y0);
                } else if (fx.kind === 'particle') {
                    const s = t / 1000;
                    const x = fx.x + fx.vx * s;
                    const y = fx.y + fx.vy * s + 0.5 * fx.ay * s * s;
                    const size = fx.size * (1 - k * 0.4);
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    st.sprite(parts[fx.sprite], x - size / 2, y - size / 2, { w: size, h: size, alpha: Math.max(0, 1 - k) });
                    ctx.restore();
                }
            });
            ctx.restore();
            this.effects.forEach((fx) => {
                if (fx.kind !== 'text') return;
                const t = now - fx.at;
                if (t < 0) return;
                const k = t / fx.life;
                const a = k < 0.15 ? k / 0.15 : (k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1);
                const rise = k * 14;
                this.outlinedText(ctx, fx.text, fx.x, fx.y - rise, fx.size, a);
            });
        }

        outlinedText(ctx, text, x, y, size, alpha) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = size + 'px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = 'rgba(16,36,72,0.8)';
            ctx.strokeText(text, x, y);
            const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(1, '#cfe3ff');
            ctx.fillStyle = g;
            ctx.fillText(text, x, y);
            ctx.restore();
        }

        // the bottom bar: the clock and time left, lines still to go right (Minesweeper's clock
        // and mine counter, spread as Minesweeper spreads them at this width)
        drawCounters(st, W, H) {
            const look = this.look;
            const pos = look.pos;
            const cx = Math.floor(W / 2);
            const spread = Math.round((W - MS_MIN_W) * 0.35);
            const at = (o, side) => ({ x: cx + o.x + side * spread, y: H + o.y });
            const timeImg = at(pos.timeImage, -1);
            const timeBack = at(pos.timeBack, -1);
            const timeLabel = at(pos.timeLabel, -1);
            const icon = at(pos.mineImage, 1);
            const linesBack = at(pos.minesBack, 1);
            const linesLabel = at(pos.minesLabel, 1);
            st.sprite(look.clock, timeImg.x, timeImg.y);
            st.sprite(look.board.numberPanel, timeBack.x, timeBack.y);
            st.sprite(look.board.numberPanel, linesBack.x, linesBack.y);
            st.sprite(look.block, icon.x + 3, icon.y + 3, { frame: COLOR.I, w: 19, h: 19 });
            const ctx = st.ctx;
            ctx.save();
            ctx.fillStyle = look.board.def.label;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.fillText(clockText(this.time), timeLabel.x + pos.timeLabel.w / 2, timeLabel.y + pos.timeLabel.h / 2 + 1);
            const left = Math.max(0, GOAL_LINES - this.engine.lines);
            ctx.fillText(String(left), linesLabel.x + pos.minesLabel.w / 2, linesLabel.y + pos.minesLabel.h / 2 + 1);
            ctx.restore();
        }

        // Paused / Ready: a small Vista card in the well (main-instruction blue over its note, as
        // the games' task dialogs write them); paused also covers the well, as Purble Place and
        // Chess Titans pause
        drawOverlay(st) {
            const ctx = st.ctx;
            if (!this.paused && this.state !== 'ready') return;
            if (this.paused) {
                ctx.save();
                const g = ctx.createLinearGradient(0, FY, 0, FY + FH);
                g.addColorStop(0, 'rgba(236,241,248,0.94)');
                g.addColorStop(1, 'rgba(206,216,231,0.94)');
                ctx.fillStyle = g;
                ctx.fillRect(FX, FY, FW, FH);
                ctx.restore();
            }
            const title = this.paused ? STR.paused : STR.ready;
            const note = this.paused ? STR.resume : STR.pressKey;
            const font = '"Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            ctx.save();
            ctx.font = '12px ' + font;
            const w = Math.min(FW - 16, Math.max(120, Math.ceil(ctx.measureText(note).width) + 28));
            const h = 58;
            const x = Math.round(FX + (FW - w) / 2) + 0.5;
            const y = Math.round(this.tip && this.state === 'ready' ? FY + 64 : FY + (FH - h) / 2) + 0.5;
            const card = () => {
                ctx.beginPath();
                ctx.roundRect(x, y, w, h, 4);
            };
            ctx.shadowColor = 'rgba(0,0,0,0.28)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
            card();
            const bg = ctx.createLinearGradient(0, y, 0, y + h);
            bg.addColorStop(0, '#ffffff');
            bg.addColorStop(0.55, '#f4f7fb');
            bg.addColorStop(1, '#e3eaf4');
            ctx.fillStyle = bg;
            ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(64,86,120,0.7)';
            ctx.stroke();
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#003399';
            ctx.font = '16px ' + font;
            ctx.fillText(title, FX + FW / 2, y + 20);
            ctx.fillStyle = '#4b4b4b';
            ctx.font = '12px ' + font;
            ctx.fillText(note, FX + FW / 2, y + 40);
            ctx.restore();
        }

        // ---- commands --------------------------------------------------------------------------
        command(id) {
            switch (id) {
            case CMD.NEW: this.askNewGame(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance(); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: this.showAbout(); break;
            case CMD.HELP:
                this.pause('help');
                this.showTip('Help');
                break;
            default: break;
            }
        }

        askNewGame() {
            if (!this.inProgress()) {
                this.newGame();
                return;
            }
            this.pause('dialog');
            VG.taskDialog({
                owner: this.win,
                title: STR.newGame,
                instruction: STR.newGameAsk,
                links: [VG.linkFromString(STR.quitNew, 1), VG.linkFromString(STR.keepPlaying, 3)]
            }).then((r) => {
                if (r === 1) {
                    this.record(false);
                    this.newGame();
                }
            });
        }

        requestExit(fromMenu) {
            if (!this.inProgress()) {
                if (fromMenu) VG.closeWindow(this.win);
                return true;
            }
            this.pause('dialog');
            if (this.s.saveOnExit) {
                this.saveGame();
                VG.closeWindow(this.win);
                return false;
            }
            VG.taskDialog({
                owner: this.win,
                title: STR.exitGame,
                instruction: STR.exitAsk,
                buttons: [{ id: 1, text: STR.save, default: true }, { id: 2, text: STR.dontSave }, { id: 3, text: STR.cancel }],
                check: { text: STR.alwaysSave, checked: this.s.saveOnExit }
            }).then((r) => {
                const id = r && typeof r === 'object' ? r.id : r;
                if (r && typeof r === 'object' && r.checked !== this.s.saveOnExit) {
                    this.s.saveOnExit = r.checked;
                    saveSettings(this.s);
                }
                if (id === 1) {
                    this.saveGame();
                    VG.closeWindow(this.win);
                } else if (id === 2) {
                    this.record(false);
                    store.remove('saved');
                    this.newGame(false);
                    VG.closeWindow(this.win);
                }
            });
            return false;
        }

        saveGame() {
            store.set('saved', { engine: this.engine.serialize(), time: this.time });
            this.newGame(false);
        }

        loadSaved(saved) {
            this.engine = Engine.restore(saved.engine, { clearDelay: this.s.animations ? CLEAR_MS : 0 });
            this.time = saved.time || 0;
            this.state = 'playing';
            this.effects = [];
            this.ending = null;
            this.clearFx = null;
            this.hideTip();
            store.remove('saved');
            // continue paused: the player starts it again
            this.paused = false;
            this.pause('user');
            this.win.stage.invalidate();
        }

        afterOpen() {
            const saved = store.get('saved', null);
            if (saved && saved.engine && !this.inProgress()) {
                if (this.s.continueSaved) {
                    this.loadSaved(saved);
                    return;
                }
                VG.taskDialog({
                    owner: this.win,
                    title: STR.savedFound,
                    instruction: STR.savedAsk,
                    buttons: [{ id: 1, text: STR.yes, default: true }, { id: 2, text: STR.no }],
                    check: { text: STR.alwaysContinue, checked: this.s.continueSaved }
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
            if (this.state === 'ready' && this.s.tips && !this.tip) this.showTip('Start');
        }

        showStats() {
            this.pause('dialog');
            const fill = (dlg) => {
                const st = stats();
                for (let i = 0; i < 5; i++) {
                    const e = st.best[i];
                    dlg.text(1201 + i, e ? String(e.score) : '');
                    dlg.text(1211 + i, e ? VG.formatDate(e.date) : '');
                }
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                dlg.text(1221, fmt(STR.played, st.played));
                dlg.text(1222, fmt(STR.gamesWon, st.won));
                dlg.text(1223, fmt(STR.winPct, pct));
                dlg.text(1224, fmt(STR.longestWin, st.longestWin));
                dlg.text(1225, fmt(STR.longestLose, st.longestLose));
                dlg.text(1226, streakText(st.streak));
                dlg.text(1227, fmt(STR.bestLevel, st.bestLevel));
                dlg.text(1228, fmt(STR.mostLines, st.mostLines));
                dlg.text(1229, fmt(STR.totalLines, st.totalLines));
            };
            VG.dialog(this.pack, STATS_TPL, {
                owner: this.win,
                title: fmt(STR.statsTitle, VG.userName()),
                init: fill,
                onCommand: (id, dlg) => {
                    if (id === 1001) {
                        VG.taskDialog({
                            owner: this.win,
                            title: STR.resetStats,
                            instruction: STR.resetAsk,
                            buttons: [{ id: 1, text: STR.yes }, { id: 2, text: STR.no, default: true }]
                        }).then((r) => {
                            if (r === 1) {
                                store.set('stats', blankStats());
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
            this.pause('dialog');
            const s = this.s;
            const radios = { 1: 1104, 3: 1105, 5: 1106 };
            VG.dialog(this.pack, OPTIONS_TPL, {
                owner: this.win,
                init: (dlg) => {
                    dlg.text(1102, String(s.startLevel));
                    dlg.checked(radios[s.nextCount] || 1105, true);
                    dlg.checked(1107, s.ghost);
                    dlg.checked(1002, s.animations);
                    dlg.checked(1017, s.sounds);
                    dlg.checked(1018, s.tips);
                    dlg.checked(1020, s.continueSaved);
                    dlg.checked(1044, s.saveOnExit);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return id === 2;
                    const next = Object.assign({}, s);
                    next.startLevel = Math.max(1, Math.min(15, parseInt(dlg.text(1102), 10) || 1));
                    next.nextCount = dlg.checked(1104) ? 1 : (dlg.checked(1106) ? 5 : 3);
                    next.ghost = dlg.checked(1107);
                    next.animations = dlg.checked(1002);
                    next.sounds = dlg.checked(1017);
                    next.tips = dlg.checked(1018);
                    next.continueSaved = dlg.checked(1020);
                    next.saveOnExit = dlg.checked(1044);
                    this.applySettings(next, next.startLevel !== s.startLevel);
                    return true;
                }
            });
        }

        applySettings(next, gameChanged) {
            this.s = next;
            saveSettings(next);
            this.look.setSound(next.sounds);
            this.syncMusic();
            this.engine.clearDelay = next.animations ? CLEAR_MS : 0;
            if (!next.tips) this.hideTip();
            this.win.stage.invalidate();
            if (!gameChanged) return;
            if (!this.inProgress()) {
                this.newGame(false);
                return;
            }
            VG.taskDialog({
                owner: this.win,
                title: STR.changed,
                instruction: STR.changedAsk,
                links: [VG.linkFromString(STR.changedQuit, 1), VG.linkFromString(STR.changedFinish, 2)]
            }).then((r) => {
                if (r === 1) {
                    this.record(false);
                    this.newGame();
                }
            });
        }

        // a preview of a block style / board, drawn with the game's own sprites
        thumbnail(style, board) {
            const scale = 2;
            const w = 100;
            const h = 75;
            const c = document.createElement('canvas');
            c.width = w * scale;
            c.height = h * scale;
            const st = Object.create(VG.Stage.prototype);
            st.ctx = c.getContext('2d');
            st.scale = scale;
            st.dpr = 1;
            st.requestSheet = () => {};
            st.ctx.setTransform(scale, 0, 0, scale, 0, 0);
            st.ctx.imageSmoothingEnabled = true;
            const look = this.look;
            const bd = look.boards[board];
            const block = look.blocks[style];
            const size = 12.5;
            // a corner of a well: a few rows of stack and an S piece coming down
            const stack = [
                '..........',
                '....SS....',
                '...SS.....',
                '..........',
                'J......OOL',
                'JJJ.TT.OOL',
                'ZZ.TTIIILL'
            ];
            for (let y = 0; y < 6; y++) {
                for (let x = 0; x < 8; x++) {
                    const px = x * size;
                    const py = y * size;
                    if (bd.pressed) st.sprite(bd.pressed, px, py, { frame: this.boardFrame(x + 1, y + 13), w: size, h: size });
                    else st.sprite(bd.cell, px, py, { w: size, h: size });
                }
            }
            stack.slice(1).forEach((row, y) => {
                for (let x = 0; x < 8; x++) {
                    const ch = row[x + 1];
                    if (ch === '.' || ch === undefined) continue;
                    st.sprite(block, x * size, y * size, { frame: COLOR[ch], w: size, h: size });
                }
            });
            return c.toDataURL('image/png');
        }

        showAppearance() {
            this.pause('dialog');
            const look = this.look;
            let style = this.s.style;
            let board = this.s.board;
            warmSprites(null, look.allSprites()).then(() => {
                VG.dialog(this.pack, APPEARANCE_TPL, {
                    owner: this.win,
                    title: STR.appearance,
                    init: (dlg) => {
                        VG.fillThumbList(dlg.get(5000), BLOCK_STYLES.map((b, i) => ({ text: b.name, img: this.thumbnail(i, board) })), style, (i) => { style = i; });
                        VG.fillThumbList(dlg.get(5001), BOARDS.map((b, i) => ({ text: b.name, img: this.thumbnail(style, i) })), board, (i) => { board = i; });
                        dlg.checked(5004, !!this.s.randomLook);
                    },
                    onCommand: (id, dlg) => {
                        if (id !== 1) return true;
                        this.s.randomLook = dlg.checked(5004);
                        if (this.s.randomLook) {
                            style = Math.floor(Math.random() * BLOCK_STYLES.length);
                            board = Math.floor(Math.random() * BOARDS.length);
                        }
                        this.s.style = style;
                        this.s.board = board;
                        saveSettings(this.s);
                        look.set(style, board);
                        this.win.stage.invalidate();
                        return true;
                    }
                });
            });
        }

        showAbout() {
            VG.aboutBox({ owner: this.win, title: DISPLAY_NAME, text: DISPLAY_NAME + ' developed by MeletonFX.', icon: ICON + '-48.png' });
        }

        showResult(won) {
            const e = this.engine;
            const st = this.lastStats || stats();
            const best = st.best[0];
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            VG.dialog(this.pack, resultTemplate(won), {
                owner: this.win,
                texts: {
                    1301: fmt(STR.score, e.score),
                    1302: fmt(STR.time, clockText(this.time)),
                    1303: fmt(STR.lines, e.lines),
                    1304: fmt(STR.level, e.level),
                    1305: fmt(STR.highScore, best ? best.score : 0),
                    1306: fmt(STR.date, VG.formatDate(best ? best.date : Date.now())),
                    1307: fmt(STR.played, st.played),
                    1308: fmt(STR.pct, pct)
                },
                init: (dlg) => {
                    dlg.show(1309, !!this.lastHigh && st.best.length > 1);
                },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1004) VG.closeWindow(this.win);
                    else this.newGame();
                }
            });
        }
    }

    function open() {
        return Promise.all([VG.loadPack(GAME_ID), VG.loadPack('minesweeper'), VG.loadPack('cardgames')]).then(([g, ms, cards]) => {
            if (!game) game = new BlockDrop({ game: g, ms, cards });
            const first = !game.win.isOpen();
            game.look.setSound(game.s.sounds);
            return game.warm().then(() => {
                game.win.open();
                if (first) {
                    game.look.warmSounds();
                    game.afterOpen();
                }
                return game;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: DISPLAY_NAME,
        icon: ICON,
        thumbnail: '/static_images/vista-games/blockdrop/images/thumbnail.png',
        feature: 'vista_' + GAME_ID,
        open
    });
    root.openVistaBlockDrop = open;
    root.vistaBlockDrop = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
