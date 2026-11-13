/**
 * Melaton Mobile: Block Drop, Yozora #786. The desktop Block Drop's rules (desktop-apps/vista-games/
 * blockdrop.js; Academy City Research P.S.R.) redrawn as a Windows Mobile 6 program beside Bubble
 * Breaker and Solitaire: GDI look (flat blocks with one raised edge, a one-pixel black well frame,
 * Tahoma), WM chrome. The rules section below is the desktop file's own, copied by script (from
 * "---- rules" to the end of its Engine class): the 7-piece bag, SRS rotation with wall kicks,
 * hold, ghost piece, 0.5 s lock delay (15 resets), soft / hard drop, a level every 10 lines, guideline
 * scoring (T-spins, back-to-back, combos), 150 lines to win.
 *
 * Page as Bubble Breaker (VGA halved): the white status row under the title bar (Score left, Level
 * right, blue labels, a one-pixel rule), then the well with Next, Hold and Lines beside it; soft keys
 * Pause / Resume (New Game once a game is over) | Menu (New Game, rule, Options..., Statistics, rule,
 * About). Options / Statistics / About are full pages with ok in the title bar (the shell's settings
 * page classes); game over / won is a message box (it answers the last move).
 *
 * Touch, chosen for a phone screen with no room to spare for on-screen buttons and for the stylus
 * that 6.1 was made for alike: the piece follows a sideways drag column by column; a tap turns it
 * clockwise; holding the pen down after a downward drag drops it faster (soft drop); a quick flick
 * down drops it at once (hard drop); a flick up, or a tap on the Hold box, holds it. The well has no
 * tap-and-hold ring (data-wm-no-hold). Keys (d-pad / keyboard): Left / Right move, Up / X turn, Z
 * turns back, Down drops faster, Space / Enter drops, C / Shift holds, P pauses.
 *
 * One rAF loop runs only while a game is running on screen; it stops for a menu, a message box, the
 * task switcher, another program (hide) and a hidden page, and the game comes back paused (the well
 * covered, "Tap to continue"), as the desktop pauses when its window loses the focus. The game is
 * kept in localStorage wmGame:blockdrop with the settings and statistics, so X (endApp) and a reload
 * come back to it.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    // ---- rules: copied by script from desktop-apps/vista-games/blockdrop.js (keep them in step) ----
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

    // ---- the phone program ----------------------------------------------------------------------

    const APP_ID = 'blockdrop';
    const STORE_KEY = 'wmGame:blockdrop';
    const CLEAR_MS = 320;     // the desktop's: the full rows stay up this long (they flash)
    const DEFAULTS = { startLevel: 1, nextCount: 3, ghost: true };
    // GDI colours per piece (COLOR order: I O T S Z J L, G = a topped-out stack)
    const FILL = ['#00b5e7', '#f7d300', '#a521c6', '#29b521', '#e71c18', '#2142de', '#f78a10', '#848284'];
    const MARGIN_X = 10;      // units (Bubble Breaker's board)
    const MARGIN_Y = 5;
    const SIDE_CELLS = 5;     // the side column, in well cells
    const GAP_CELLS = 0.6;
    const MAX_CELL = 24;      // units

    let ws = null;
    let page = null;
    let view = 'game';        // game | options | stats | about

    // ---------------------------------------------------------------- storage

    function loadStore() {
        try {
            const v = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            return v && typeof v === 'object' ? v : {};
        } catch (_) { return {}; }
    }

    function saveStore(patch) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(loadStore(), patch))); } catch (_) { /* this session only */ }
    }

    function settings() {
        const s = Object.assign({}, DEFAULTS, loadStore().settings || {});
        s.startLevel = Math.max(1, Math.min(15, s.startLevel | 0 || 1));
        if (![1, 3, 5].includes(s.nextCount)) s.nextCount = 3;
        s.ghost = s.ghost !== false;
        return s;
    }

    function blankStats() {
        return { played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: [], bestLevel: 0, mostLines: 0, totalLines: 0 };
    }

    function stats() { return Object.assign(blankStats(), loadStore().stats || {}); }

    // ---------------------------------------------------------------- the game

    const game = {
        s: settings(),
        engine: null,
        state: 'ready',       // ready (tap to start) | running | paused | over
        time: 0,              // ms played
        lastHigh: false,
        flash: null           // rows flashing while they clear
    };

    function newGame() {
        game.s = settings();
        game.engine = new Engine({ startLevel: game.s.startLevel, clearDelay: CLEAR_MS });
        game.state = 'ready';
        game.time = 0;
        game.flash = null;
        soft.on = false;
        save(true);
        render();
        loopStop();
    }

    function restore() {
        const v = loadStore().saved;
        game.s = settings();
        if (v && v.engine && Array.isArray(v.engine.board) && v.engine.board.length === COLS * ROWS) {
            try {
                game.engine = Engine.restore(v.engine, { clearDelay: CLEAR_MS });
                game.time = Number(v.time) || 0;
                // a game under way comes back paused; one that was waiting to start still waits
                game.state = v.state === 'over' || game.engine.over ? 'over' : (v.state === 'ready' ? 'ready' : 'paused');
                return;
            } catch (_) { /* a bad save: a new game */ }
        }
        game.engine = new Engine({ startLevel: game.s.startLevel, clearDelay: CLEAR_MS });
        game.state = 'ready';
        game.time = 0;
    }

    function save() {
        const e = game.engine;
        if (!e) return;
        saveStore({ saved: { engine: e.serialize(), time: game.time, state: game.state } });
    }

    function startOrResume() {
        if (game.state === 'ready') {
            game.engine.start();
            game.state = 'running';
        } else if (game.state === 'paused') game.state = 'running';
        else return;
        ws.refreshSoftKeys();
        loopRun();
        render();
    }

    function pause() {
        if (game.state !== 'running') return;
        game.state = 'paused';
        soft.on = false;
        loopStop();
        save();
        keysAfterMenu();
        render();
    }

    // the left soft key reads Resume now; a menu that is up (it paused the game) is left alone and the
    // key follows once it has closed
    let keysTimer = null;
    function keysAfterMenu() {
        clearTimeout(keysTimer);
        if (!ws || ws.current !== APP_ID) return;
        if (document.querySelector('#wmShell .wm-popup:not([hidden])')) { keysTimer = setTimeout(keysAfterMenu, 250); return; }
        ws.refreshSoftKeys();
    }

    function record(won) {
        const e = game.engine;
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
        game.lastHigh = false;
        if (e.score > 0) {
            const entry = { score: e.score, date: Date.now(), level: e.level, lines: e.lines };
            st.best.push(entry);
            st.best.sort((a, b) => b.score - a.score || a.date - b.date);
            st.best = st.best.slice(0, 5);
            game.lastHigh = st.best[0] === entry;
        }
        st.bestLevel = Math.max(st.bestLevel, e.level);
        st.mostLines = Math.max(st.mostLines, e.lines);
        st.totalLines += e.lines;
        saveStore({ stats: st });
    }

    function clockText(ms) {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function ended() {
        const e = game.engine;
        const won = !!e.won;
        game.state = 'over';
        soft.on = false;
        loopStop();
        record(won);
        save();
        ws.refreshSoftKeys();
        render();
        const lines = [won ? 'Congratulations, you won the game!' : 'Sorry, you lost this game. Better luck next time!', ''];
        if (game.lastHigh) lines.push('You have a new high score!', '');
        lines.push(`Score: ${e.score.toLocaleString('en-US')}`, `Lines: ${e.lines}`, `Level: ${e.level}`, `Time: ${clockText(game.time)}`, '', 'Play again?');
        setTimeout(() => {
            if (game.state !== 'over') return;
            ws.messageBox({
                title: won ? 'Game Won' : 'Game Lost',
                icon: won ? 'info' : 'warning',
                text: lines.join('\n'),
                buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }],
                cancelValue: false,
                modal: true
            }).then((again) => { if (again && game.state === 'over') newGame(); });
        }, 450);
    }

    // a game under way counts as lost when it is left for a new one (the desktop's rule)
    function abandon() {
        if (game.state !== 'running' && game.state !== 'paused') return;
        if (!game.engine.piece && !game.engine.clearing && game.engine.counts.pieces === 0) return;
        record(false);
        game.state = 'over';
    }

    async function askNewGame() {
        if (game.state === 'running' || game.state === 'paused') {
            pause();
            const yes = await ws.messageBox({
                title: 'New Game?',
                icon: 'question',
                text: 'Quit this game and start a new game? This counts as a loss in your statistics.',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                cancelValue: false
            });
            if (!yes) return;
            abandon();
        }
        newGame();
    }

    // ---------------------------------------------------------------- the loop

    const loop = { raf: 0, last: 0 };
    const soft = { on: false };

    function onScreen() {
        if (!ws || ws.current !== APP_ID || view !== 'game' || document.hidden || !page || page.hidden) return false;
        if (ws.taskSwitcher && ws.taskSwitcher.isOpen) return false;
        if (document.querySelector('#wmShell .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return false;
        return true;
    }

    function loopRun() {
        if (loop.raf || game.state !== 'running') return;
        loop.last = performance.now();
        loop.raf = requestAnimationFrame(frame);
    }

    function loopStop() {
        if (loop.raf) cancelAnimationFrame(loop.raf);
        loop.raf = 0;
    }

    function frame(now) {
        loop.raf = 0;
        if (game.state !== 'running') return;
        // a menu, a box, another program: the game pauses (and waits for a tap to go on)
        if (!onScreen()) { pause(); return; }
        const dt = Math.min(100, Math.max(0, now - loop.last));
        loop.last = now;
        step(dt);
        if (game.state === 'running') loop.raf = requestAnimationFrame(frame);
    }

    function step(dt) {
        const e = game.engine;
        game.time += dt;
        e.tick(dt, soft.on);
        events();
        if (e.over) { ended(); return; }
        draw();
        renderStatus();
    }

    // what the engine did: rows to flash while they clear
    function events() {
        const list = game.engine.takeEvents();
        for (const ev of list) {
            if (ev.type === 'clear') game.flash = ev.rows.slice();
            else if (ev.type === 'spawn') game.flash = null;
        }
    }

    // a move from the pen or a key: the engine acts at once, the board redraws now
    function input(fn) {
        if (game.state === 'ready' || game.state === 'paused') { startOrResume(); return; }
        if (game.state !== 'running') return;
        fn(game.engine);
        events();
        if (game.engine.over) { ended(); return; }
        draw();
        renderStatus();
    }

    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

    // ---------------------------------------------------------------- drawing

    let canvas = null;
    let ctx = null;
    let geo = null;     // device px: cell, well { x, y, w, h }, side x, boxes { next, hold }, dpr
    let font = 'Tahoma, sans-serif';
    let drawQueued = false;

    function unit() {
        if (!page) return 1;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(100 * var(--wm-px));height:0';
        page.appendChild(probe);
        const u = probe.getBoundingClientRect().width / 100 || 1;
        probe.remove();
        return u;
    }

    function layout() {
        if (!page || !canvas || view !== 'game' || page.hidden) return;
        const wrap = page.querySelector('.wbd-board');
        const W = wrap.clientWidth;
        const H = wrap.clientHeight;
        if (!W || !H) return;
        const u = unit();
        const dpr = window.devicePixelRatio || 1;
        const vis = ROWS - HIDDEN;
        const across = COLS + GAP_CELLS + SIDE_CELLS;
        const cssCell = Math.max(6 * u, Math.min((W - 2 * MARGIN_X * u) / across, (H - 2 * MARGIN_Y * u) / vis, MAX_CELL * u));
        // the side column (Next with five pieces, Hold, Lines) may stand taller than the well: the
        // cells shrink until both fit the page
        const availH = (H - 2 * MARGIN_Y * u) * dpr;
        let cell = Math.max(5, Math.floor(cssCell * dpr));
        for (let pass = 0; pass < 8; pass++) {
            const frame = Math.max(1, Math.round(0.5 * u * dpr));   // one VGA pixel
            const wellW = COLS * cell + 2 * frame;
            const wellH = vis * cell + 2 * frame;
            const label = Math.round(10.5 * u * dpr);          // the side labels: Tahoma 10.5 units (the system font)
            const lh = Math.round(label * 1.35);
            font = getComputedStyle(page).fontFamily || font;
            // the side column: five cells, or as wide as its widest line ("To go: 150") where the cells are small
            ctx.font = `normal ${label}px ${font}`;
            const textW = Math.ceil(ctx.measureText('To go:').width + ctx.measureText(' 150').width + label * 0.8);
            const sideX = wellW + Math.round(GAP_CELLS * cell);
            const sideW = Math.max(SIDE_CELLS * cell, textW);
            // five previews close up so the column stays as tall as the well
            const nextStep = game.s.nextCount === 5 ? 1.9 : 2.25;
            const nextH = Math.round(cell * (game.s.nextCount === 1 ? 3 : 1.25 + nextStep * game.s.nextCount));
            const next = { x: sideX, y: lh, w: sideW, h: nextH };
            const hold = { x: sideX, y: lh + nextH + lh + Math.round(cell * 0.4), w: sideW, h: Math.round(cell * 3) };
            const linesY = hold.y + hold.h + Math.round(cell * 0.4);
            const cw = sideX + sideW;
            const ch = Math.max(wellH, linesY + Math.round(lh * 2.3));
            if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
            canvas.style.width = `${cw / dpr}px`;
            canvas.style.height = `${ch / dpr}px`;
            geo = { cell, dpr, frame, u, well: { x: 0, y: 0, w: wellW, h: wellH }, side: { x: sideX, w: sideW }, label, lh, next, nextStep, hold, lines: { y: linesY } };
            if (ch <= availH + 1 || cell <= 5) break;
            cell = Math.max(5, Math.min(cell - 1, Math.floor(cell * availH / ch)));
        }
        render();
    }

    function render() {
        if (!page) return;
        renderStatus();
        if (drawQueued) return;
        drawQueued = true;
        requestAnimationFrame(() => { drawQueued = false; draw(); });
    }

    function renderStatus() {
        if (!page || !game.engine) return;
        const sc = page.querySelector('.wbd-score');
        const lv = page.querySelector('.wbd-level');
        const s = game.engine.score.toLocaleString('en-US');
        const l = String(game.engine.level);
        if (sc && sc.textContent !== s) sc.textContent = s;
        if (lv && lv.textContent !== l) lv.textContent = l;
    }

    function shade(hex, k) {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        const f = (c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
        return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
    }

    // a block: flat colour, a light band at the top / left and a dark one at the bottom / right (GDI's raised edge)
    function paintBlock(c, px, py, s, ci) {
        const base = FILL[ci] || FILL[7];
        const e = Math.max(1, Math.round(s / 8));
        c.fillStyle = base;
        c.fillRect(px, py, s, s);
        c.fillStyle = shade(base, -0.45);
        c.fillRect(px, py + s - e, s, e);
        c.fillRect(px + s - e, py, e, s);
        c.fillStyle = shade(base, 0.55);
        c.fillRect(px, py, s - e, e);
        c.fillRect(px, py, e, s - e);
        c.beginPath();
        c.moveTo(px + s - e, py); c.lineTo(px + s, py); c.lineTo(px + s - e, py + e); c.closePath();
        c.moveTo(px, py + s - e); c.lineTo(px + e, py + s - e); c.lineTo(px, py + s); c.closePath();
        c.fill();
    }

    function paintGhost(c, px, py, s, ci) {
        const base = FILL[ci] || FILL[7];
        const e = Math.max(1, Math.round(s / 10));
        c.fillStyle = shade(base, 0.8);
        c.fillRect(px, py, s, s);
        c.strokeStyle = base;
        c.lineWidth = e;
        c.strokeRect(px + e / 2, py + e / 2, s - e, s - e);
    }

    // Each block and ghost block is drawn once per colour and size into a sprite sheet (one row per
    // size: the colours, then their ghosts) and copied from it, instead of edges and colour maths for
    // every block of every frame.
    const sheets = new Map(); // size -> canvas
    function sheetFor(s) {
        let sh = sheets.get(s);
        if (sh) return sh;
        if (sheets.size > 8) sheets.clear();
        const n = FILL.length;
        sh = document.createElement('canvas');
        sh.width = s * n * 2;
        sh.height = s;
        const c = sh.getContext('2d');
        for (let ci = 0; ci < n; ci++) { paintBlock(c, ci * s, 0, s, ci); paintGhost(c, (n + ci) * s, 0, s, ci); }
        sheets.set(s, sh);
        return sh;
    }

    function block(px, py, s, ci) {
        const i = FILL[ci] ? ci : 7;
        ctx.drawImage(sheetFor(s), i * s, 0, s, s, px, py, s, s);
    }

    function ghostBlock(px, py, s, ci) {
        const i = FILL[ci] ? ci : 7;
        ctx.drawImage(sheetFor(s), (FILL.length + i) * s, 0, s, s, px, py, s, s);
    }

    // a piece in a box (Next, Hold), centred, at a cell size of its own
    function preview(type, box, y, s, dim) {
        if (!type) return;
        const cells = CELLS[type][0];
        const xs = cells.map((c) => c[0]);
        const ys = cells.map((c) => c[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const w = (maxX - minX + 1) * s;
        const h = (maxY - minY + 1) * s;
        const ox = Math.round(box.x + (box.w - w) / 2);
        const oy = Math.round(y - h / 2);
        for (const [cx, cy] of cells) {
            if (dim) ghostBlock(ox + (cx - minX) * s, oy + (cy - minY) * s, s, COLOR[type]);
            else block(ox + (cx - minX) * s, oy + (cy - minY) * s, s, COLOR[type]);
        }
    }

    function frameBox(b) {
        const f = geo.frame;
        ctx.fillStyle = '#000';
        ctx.fillRect(b.x, b.y, b.w, f);
        ctx.fillRect(b.x, b.y + b.h - f, b.w, f);
        ctx.fillRect(b.x, b.y, f, b.h);
        ctx.fillRect(b.x + b.w - f, b.y, f, b.h);
    }

    function text(str, x, y, colour, size, weight, align) {
        ctx.fillStyle = colour;
        ctx.font = `${weight || 'normal'} ${size}px ${font}`;
        ctx.textAlign = align || 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(str, x, y);
    }

    function draw() {
        if (!ctx || !geo || view !== 'game' || !page || page.hidden || !game.engine) return;
        const e = game.engine;
        const { cell, frame: f, well } = geo;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // the well: white, a faint grid (GDI dotted look as a light grey line), one-pixel black frame
        const ix = well.x + f;
        const iy = well.y + f;
        const vis = ROWS - HIDDEN;
        ctx.fillStyle = '#efefef';
        for (let x = 1; x < COLS; x++) ctx.fillRect(ix + x * cell, iy, 1, vis * cell);
        for (let y = 1; y < vis; y++) ctx.fillRect(ix, iy + y * cell, COLS * cell, 1);
        frameBox(well);
        const covered = game.state === 'paused';
        if (!covered) {
            const flash = game.flash && e.clearing ? new Set(game.flash) : null;
            const on = flash && Math.floor((e.clearing.total - e.clearing.t) / 80) % 2 === 0;
            for (let y = HIDDEN; y < ROWS; y++) {
                for (let x = 0; x < COLS; x++) {
                    const v = e.board[y * COLS + x];
                    if (!v) continue;
                    const px = ix + x * cell;
                    const py = iy + (y - HIDDEN) * cell;
                    if (flash && flash.has(y)) {
                        ctx.fillStyle = on ? '#ffffff' : '#000000';
                        ctx.fillRect(px, py, cell, cell);
                    } else block(px, py, cell, e.over && !e.won ? 7 : v - 1);
                }
            }
            if (e.piece && !e.over && game.state !== 'ready') {
                const ci = COLOR[e.piece.type];
                if (game.s.ghost) {
                    const gy = e.ghostY();
                    if (gy !== e.piece.y) {
                        for (const [cx, cy] of CELLS[e.piece.type][e.piece.rot]) {
                            const yy = gy + cy;
                            if (yy >= HIDDEN) ghostBlock(ix + (e.piece.x + cx) * cell, iy + (yy - HIDDEN) * cell, cell, ci);
                        }
                    }
                }
                for (const [cx, cy] of CELLS[e.piece.type][e.piece.rot]) {
                    const yy = e.piece.y + cy;
                    if (yy >= HIDDEN) block(ix + (e.piece.x + cx) * cell, iy + (yy - HIDDEN) * cell, cell, ci);
                }
            }
        }
        // a message in the well: Ready / Paused (the well is covered while paused, as the desktop)
        if (game.state === 'ready' || covered) {
            if (covered) { ctx.fillStyle = '#ffffff'; ctx.fillRect(ix, iy, COLS * cell, vis * cell); }
            const cx = ix + (COLS * cell) / 2;
            const cy = iy + (vis * cell) / 2;
            text(covered ? 'Paused' : 'Ready?', cx, cy, '#0000ff', Math.round(geo.label * 1.25), 'bold', 'center');
            text('Tap to ' + (covered ? 'continue' : 'start'), cx, cy + Math.round(geo.lh * 1.2), '#000', geo.label, 'normal', 'center');
        }
        // the side column: Next, Hold, Lines (labels in the status row's blue)
        const side = geo.side;
        text('Next', side.x, geo.next.y - Math.round(geo.lh * 0.3), '#0000ff', geo.label);
        frameBox(geo.next);
        const n = game.s.nextCount;
        const nq = covered ? [] : e.queue.slice(0, n);
        const big = Math.max(4, Math.round(cell * 0.8));
        const small = Math.max(3, Math.round(cell * 0.6));
        nq.forEach((t, i) => {
            const s = i === 0 ? big : small;
            const yMid = n === 1 ? geo.next.y + geo.next.h / 2 : geo.next.y + Math.round(cell * (1.4 + geo.nextStep * i));
            preview(t, geo.next, yMid, s, false);
        });
        text('Hold', side.x, geo.hold.y - Math.round(geo.lh * 0.3), '#0000ff', geo.label);
        frameBox(geo.hold);
        if (!covered) preview(e.hold, geo.hold, geo.hold.y + geo.hold.h / 2, big, e.holdUsed);
        const ly = geo.lines.y + geo.lh;
        text('Lines:', side.x, ly, '#0000ff', geo.label);
        text(String(e.lines), side.x + side.w, ly, '#000', geo.label, 'normal', 'right');
        text('To go:', side.x, ly + geo.lh, '#0000ff', geo.label);
        text(String(Math.max(0, GOAL_LINES - e.lines)), side.x + side.w, ly + geo.lh, '#000', geo.label, 'normal', 'right');
    }

    // ---------------------------------------------------------------- input

    // the pen: drag sideways to move, tap to turn, drag down and hold for a soft drop, flick down to
    // drop, flick up (or tap the Hold box) to hold
    const pen = { id: null, x0: 0, y0: 0, t0: 0, col: 0, moved: false, down: 0, lastY: 0, lastT: 0, vy: 0 };

    function local(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * geo.dpr, y: (e.clientY - r.top) * geo.dpr };
    }

    function inBox(p, b) { return p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h; }

    function wireBoard() {
        const wrap = page.querySelector('.wbd-board');
        wrap.addEventListener('pointerdown', (e) => {
            if (!geo || (e.pointerType === 'mouse' && e.button !== 0)) return;
            pen.id = e.pointerId;
            pen.x0 = e.clientX;
            pen.y0 = e.clientY;
            pen.t0 = performance.now();
            pen.lastY = e.clientY;
            pen.lastT = pen.t0;
            pen.vy = 0;
            pen.moved = false;
            pen.down = 0;
            pen.col = game.engine.piece ? game.engine.piece.x : 0;
            try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
        });
        wrap.addEventListener('pointermove', (e) => {
            if (pen.id !== e.pointerId || game.state !== 'running') return;
            const css = geo.cell / geo.dpr;
            const dx = e.clientX - pen.x0;
            const dy = e.clientY - pen.y0;
            const now = performance.now();
            const dt = now - pen.lastT;
            if (dt > 0) pen.vy = 0.6 * pen.vy + 0.4 * ((e.clientY - pen.lastY) / dt);
            pen.lastY = e.clientY;
            pen.lastT = now;
            if (!pen.moved && Math.hypot(dx, dy) > css * 0.5) pen.moved = true;
            if (!pen.moved) return;
            // sideways: the piece follows the pen a column per cell width
            if (Math.abs(dx) >= Math.abs(dy) * 0.7 || pen.down === 0) {
                const target = pen.col + Math.round(dx / css);
                input((en) => {
                    let guard = COLS;
                    while (en.piece && en.piece.x < target && guard-- && en.move(1));
                    while (en.piece && en.piece.x > target && guard-- && en.move(-1));
                });
            }
            // down: a soft drop while the pen stays below where it went down
            const downCells = Math.floor(dy / css);
            pen.down = Math.max(pen.down, downCells);
            soft.on = dy > css && Math.abs(dy) > Math.abs(dx);
        });
        const up = (e) => {
            if (pen.id !== e.pointerId) return;
            pen.id = null;
            soft.on = false;
            const dt = performance.now() - pen.t0;
            const dx = e.clientX - pen.x0;
            const dy = e.clientY - pen.y0;
            const css = geo.cell / geo.dpr;
            if (e.type === 'pointercancel') return;
            if (game.state === 'ready' || game.state === 'paused') { if (!pen.moved) startOrResume(); return; }
            if (game.state !== 'running') return;
            if (!pen.moved && dt < 500) {
                if (inBox(local(e), geo.hold)) input((en) => en.holdPiece());
                else input((en) => en.rotate(1));
                return;
            }
            // a flick: fast and mostly vertical
            const fast = Math.abs(dy) > css * 1.5 && Math.abs(dy) > Math.abs(dx) * 1.5 && (Math.abs(pen.vy) > 0.6 || dt < 220);
            pen.last = { dx, dy, dt: Math.round(dt), vy: pen.vy, fast, moved: pen.moved };
            if (fast && dy > 0) input((en) => en.hardDrop());
            else if (fast && dy < 0) input((en) => en.holdPiece());
        };
        wrap.addEventListener('pointerup', up);
        wrap.addEventListener('pointercancel', up);
        wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    function onKey(e) {
        if (!ws || ws.current !== APP_ID || view !== 'game' || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('#wmShell .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return;
        const k = e.key;
        const map = {
            ArrowLeft: (en) => en.move(-1), ArrowRight: (en) => en.move(1),
            ArrowUp: (en) => en.rotate(1), x: (en) => en.rotate(1), X: (en) => en.rotate(1),
            z: (en) => en.rotate(-1), Z: (en) => en.rotate(-1),
            ' ': (en) => en.hardDrop(), Enter: (en) => en.hardDrop(),
            c: (en) => en.holdPiece(), C: (en) => en.holdPiece(), Shift: (en) => en.holdPiece()
        };
        if (k === 'p' || k === 'P') {
            e.preventDefault();
            if (game.state === 'running') pause(); else startOrResume();
            return;
        }
        if (k === 'ArrowDown') {
            e.preventDefault();
            if (game.state === 'running') soft.on = true;
            else startOrResume();
            return;
        }
        const fn = map[k];
        if (!fn) return;
        e.preventDefault();
        if (e.repeat && (k === ' ' || k === 'Enter' || k === 'c' || k === 'C' || k === 'Shift')) return;
        input(fn);
    }

    function onKeyUp(e) {
        if (e.key === 'ArrowDown') soft.on = false;
    }

    // ---------------------------------------------------------------- pages

    let form = null;

    function showView(v) {
        view = v;
        if (!page) return;
        page.dataset.view = v;
        page.querySelectorAll('.wbd-view').forEach((el) => { el.hidden = el.dataset.v !== v; });
        if (v === 'game') requestAnimationFrame(layout);
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    function openPage(v) {
        pause();
        if (v === 'options') { form = Object.assign({}, settings()); renderOptions(); }
        else if (v === 'stats') renderStats();
        else if (v === 'about') renderAbout();
        showView(v);
        ws.syncHistory();
    }

    const esc = (s) => ws.escapeHtml(s);

    function renderOptions() {
        const box = page.querySelector('.wbd-view[data-v="options"]');
        box.innerHTML = `<div class="wm-form-hdr">Options</div><div class="wm-set-scroll"><div class="wm-form wbd-form">
            <div class="wm-form-row is-wide"><span class="wm-form-label">Starting level:</span><button type="button" class="wm-combo" data-act="level"><span>${form.startLevel}</span></button></div>
            <div class="wm-form-row is-wide"><span class="wm-form-label">Next pieces:</span><button type="button" class="wm-combo" data-act="next"><span>${form.nextCount}</span></button></div>
            <label class="wm-check"><input type="checkbox" data-f="ghost"${form.ghost ? ' checked' : ''}><span>Show where the piece will land</span></label>
            <p class="wbd-help">Drag sideways to move the piece. Tap to turn it. Drag down and hold to drop it faster; flick down to drop it at once. Flick up or tap Hold to keep the piece for later. Clear ${GOAL_LINES} lines to win.</p>
        </div></div>`;
        box.querySelector('input[data-f="ghost"]').addEventListener('change', (e) => { form.ghost = e.target.checked; });
        box.querySelectorAll('.wm-combo').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const rows = b.dataset.act === 'level'
                ? Array.from({ length: 15 }, (_, i) => ({ label: String(i + 1), radio: form.startLevel === i + 1, action: () => { form.startLevel = i + 1; renderOptions(); } }))
                : [1, 3, 5].map((n) => ({ label: String(n), radio: form.nextCount === n, action: () => { form.nextCount = n; renderOptions(); } }));
            ws.dropdown(b, rows, 'left');
        }));
    }

    async function closeOptions() {
        const next = form;
        form = null;
        if (!next) return;
        const before = game.s;
        saveStore({ settings: { startLevel: next.startLevel, nextCount: next.nextCount, ghost: !!next.ghost } });
        game.s = settings();
        showView('game');
        ws.syncHistory();
        if (next.startLevel === before.startLevel) return;
        // the starting level is the game's: a game that has not begun takes it at once
        if (game.state === 'ready' || game.state === 'over') { newGame(); return; }
        const quit = await ws.messageBox({
            title: 'Changed Game Settings',
            icon: 'question',
            text: "These settings won't apply to the game in progress. Quit and start a new game with the new settings? This counts as a loss in your statistics.",
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false
        });
        if (quit && (game.state === 'running' || game.state === 'paused')) { abandon(); newGame(); }
    }

    function fmtDate(ms) {
        try { return new Date(ms).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }); } catch (_) { return ''; }
    }

    function renderStats() {
        const box = page.querySelector('.wbd-view[data-v="stats"]');
        const st = stats();
        const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
        const s = st.streak;
        const cur = s < 0 ? `${-s} ${s === -1 ? 'loss' : 'losses'}` : `${s} ${s === 1 ? 'win' : 'wins'}`;
        let best = '';
        for (let i = 0; i < 5; i++) {
            const b = st.best[i];
            best += `<div class="wbd-best-row"><span>${i + 1}.</span><span>${b ? esc(b.score.toLocaleString('en-US')) : ''}</span><span>${b ? esc(fmtDate(b.date)) : ''}</span></div>`;
        }
        const row = (label, value) => `<div class="wbd-stat"><span>${esc(label)}</span><span>${esc(String(value))}</span></div>`;
        box.innerHTML = `<div class="wm-form-hdr">Statistics</div><div class="wm-set-scroll"><div class="wm-form wbd-form">
            <div class="wbd-sub">High Scores</div>
            <div class="wbd-best">${best}</div>
            ${row('Games played:', st.played)}${row('Games won:', st.won)}${row('Win percentage:', `${pct}%`)}
            ${row('Longest winning streak:', st.longestWin)}${row('Longest losing streak:', st.longestLose)}${row('Current streak:', cur)}
            ${row('Highest level:', st.bestLevel)}${row('Most lines:', st.mostLines)}${row('Total lines:', st.totalLines)}
            <div class="wm-buttons"><button type="button" class="wm-button wbd-reset">Reset</button></div>
        </div></div>`;
        box.querySelector('.wbd-reset').addEventListener('click', async () => {
            const yes = await ws.messageBox({
                title: 'Reset Statistics',
                icon: 'question',
                text: 'Do you want to reset all your statistics to zero?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                cancelValue: false
            });
            if (!yes) return;
            saveStore({ stats: blankStats() });
            renderStats();
        });
    }

    function renderAbout() {
        const box = page.querySelector('.wbd-view[data-v="about"]');
        box.innerHTML = `<div class="wbd-about">
            <canvas class="wbd-about-art" aria-hidden="true"></canvas>
            <div>Block Drop</div>
            <div>Designed for Melaton Mobile</div>
            <div>by Academy City Research P.S.R.</div>
            <div>© 2008 Xyridian Corporation.</div>
            <div>All rights reserved.</div>
        </div>`;
        // the game's mark: a T, an L and an I stacked in a little well
        const art = box.querySelector('.wbd-about-art');
        const u = unit();
        const dpr = window.devicePixelRatio || 1;
        const s = Math.round(12 * u * dpr);
        art.width = s * 6;
        art.height = s * 4;
        art.style.width = `${(s * 6) / dpr}px`;
        art.style.height = `${(s * 4) / dpr}px`;
        const keep = ctx;
        ctx = art.getContext('2d');
        [[0, 3, 0], [1, 3, 0], [2, 3, 0], [3, 3, 0], [4, 3, 6], [5, 3, 6], [5, 2, 6], [5, 1, 6], [1, 2, 2], [2, 2, 2], [3, 2, 2], [2, 1, 2]]
            .forEach(([x, y, c]) => block(x * s, y * s, s, c));
        ctx = keep;
    }

    // ---------------------------------------------------------------- the app

    function mount(p) {
        page = p;
        p.classList.add('wm-blockdrop');
        p.innerHTML = `
            <div class="wbd-view" data-v="game">
                <div class="wbd-status"><span><b>Score:</b> <span class="wbd-score">0</span></span><span><b>Level:</b> <span class="wbd-level">1</span></span></div>
                <div class="wbd-board" data-wm-no-hold><canvas class="wbd-canvas" aria-label="Block Drop"></canvas></div>
            </div>
            <div class="wbd-view wm-set" data-v="options" hidden></div>
            <div class="wbd-view wm-set" data-v="stats" hidden></div>
            <div class="wbd-view" data-v="about" hidden></div>`;
        canvas = p.querySelector('.wbd-canvas');
        ctx = canvas.getContext('2d');
        wireBoard();
        new ResizeObserver(() => { if (view === 'game') layout(); }).observe(p.querySelector('.wbd-board'));
        p.dataset.view = view;
        p.querySelectorAll('.wbd-view').forEach((el) => { el.hidden = el.dataset.v !== view; });
        if (view === 'options' && form) renderOptions();
        else if (view === 'stats') renderStats();
        else if (view === 'about') renderAbout();
    }

    function leaveSubpage() {
        if (view === 'options') { closeOptions(); return true; }
        if (view === 'stats' || view === 'about') { showView('game'); ws.syncHistory(); return true; }
        return false;
    }

    function register() {
        ws = window.wmShell;
        restore();
        ws.registerApp({
            id: APP_ID,
            title: 'Block Drop',
            icon: 'app-blockdrop',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show() { if (view === 'game') requestAnimationFrame(layout); },
            hide() { pause(); save(); },
            onEnd() {
                pause();
                save();
                if (view === 'options') closeOptions();
                view = 'game';
                page = null;
                canvas = null;
                ctx = null;
            },
            titleKind: () => (view === 'game' ? 'close' : 'ok'),
            onTitleOk: () => leaveSubpage(),
            historyDepth: () => (view === 'game' ? 0 : 1),
            onBack: () => leaveSubpage(),
            softKeys() {
                if (view !== 'game') return { left: null, right: null };
                const left = game.state === 'over'
                    ? { label: 'New Game', action: () => newGame() }
                    : game.state === 'running'
                        ? { label: 'Pause', action: () => pause() }
                        : { label: game.state === 'ready' ? 'Start' : 'Resume', action: () => startOrResume() };
                return {
                    left,
                    right: {
                        label: 'Menu',
                        menu: () => [
                            { label: 'New Game', action: () => askNewGame() },
                            '-',
                            { label: 'Options...', action: () => openPage('options') },
                            { label: 'Statistics', action: () => openPage('stats') },
                            '-',
                            { label: 'About', action: () => openPage('about') }
                        ]
                    }
                };
            }
        });
        document.addEventListener('keydown', onKey);
        document.addEventListener('keyup', onKeyUp);
    }

    // tests and the lead: the running game
    window.wmBlockDrop = {
        get game() { return game; },
        get geo() { return geo; },
        get view() { return view; },
        get pen() { return pen; },
        start: () => startOrResume(),
        pause,
        input,
        newGame
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
