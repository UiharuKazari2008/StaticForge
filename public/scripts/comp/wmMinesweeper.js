/**
 * Melaton Mobile: Minesweeper, Yozora #786. Windows Vista's Minesweeper rules (desktop-apps/vista-games/
 * minesweeper.js) redrawn as a Windows Mobile 6 program beside Bubble Breaker and Solitaire: GDI look
 * (flat fills, one-pixel bevels, a shaded mine like Bubble Breaker's balls, Tahoma), WM chrome.
 *
 * Measured on the device (Bubble Breaker, VGA halved): the status row under the title bar is white,
 * 16.5 units tall, Tahoma 12.5 units, labels blue (#0000ff) and values black, 10.5 units in from both
 * edges, a one-pixel black rule under it; soft keys New Game | Menu; Menu = a first command, rule,
 * Options..., Statistics, rule, About. Options / Statistics / About are full pages with ok in the
 * title bar (Solitaire's form look: the shell's .wm-form-hdr / .wm-form / .wm-combo / .wm-check /
 * .wm-button); "New Game?" asks "Do you really want to begin a new game?" (Yes / No, question icon)
 * while a game is under way and Confirm End Game is on, as Bubble Breaker does.
 *
 * Rules as the desktop game: Beginner 9 x 9 / 10 mines, Intermediate 16 x 16 / 40, Advanced 30 x 16 /
 * 99; the first tile uncovered is never a mine (nor its neighbours when there is room); a blank tile
 * opens its area; tapping an uncovered number whose flags match it opens the rest around it (the
 * chord); question marks are an option; abandoning a game under way counts as a loss; statistics per
 * level (played, won, percentage, streaks, the five best times with their dates).
 *
 * Touch: a tap uncovers (on pen up, so a slip off the tile cancels, as the desktop's mouse up);
 * tap-and-hold flags. The hold is the shell's own (wmShell.holdMs): its ring of dots comes up under the
 * pen and when it is whole the shell sends the contextmenu the game takes as "flag", as every WM
 * program's tap-and-hold menu. A mouse's right button flags at once. Keys: arrows move a cursor,
 * Enter / Space uncovers, F / + / 0 flags (as the desktop's keyboard play).
 *
 * The board fits the page: tiles 14 to 32 units; a board that would need smaller tiles scrolls. In a
 * portrait page the Advanced board stands on its side (16 across, 30 down), in landscape it lies as
 * on the desktop; the game itself does not change when the phone turns.
 * The game lives outside the page: X (Smart Minimize / endApp) and a reload come back to the same
 * board and clock (localStorage wmGame:minesweeper); the clock runs only while the game is on screen
 * with no menu or message box over it.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'minesweeper';
    const STORE_KEY = 'wmGame:minesweeper';
    const LEVELS = {
        beginner: { w: 9, h: 9, mines: 10, name: 'Beginner' },
        intermediate: { w: 16, h: 16, mines: 40, name: 'Intermediate' },
        advanced: { w: 30, h: 16, mines: 99, name: 'Advanced' }
    };
    const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced'];
    const DEFAULTS = { difficulty: 'beginner', questionMarks: false, confirmEnd: true };
    // the classic number colours (1 blue ... 8 grey)
    const NUM_COLOURS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
    const MIN_TILE = 14;   // units
    const MIN_SCROLL_TILE = 12;
    const MAX_TILE = 32;
    // Bubble Breaker's board: 10 units in from the sides, 5.5 under the status rule
    const MARGIN_X = 10;
    const MARGIN_Y = 5;

    let ws = null;
    let page = null;
    let view = 'game';     // game | options | stats | about

    // ---------------------------------------------------------------- storage

    function loadStore() {
        try {
            const v = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            return v && typeof v === 'object' ? v : {};
        } catch (_) { return {}; }
    }

    function saveStore(patch) {
        try {
            const v = Object.assign(loadStore(), patch);
            localStorage.setItem(STORE_KEY, JSON.stringify(v));
        } catch (_) { /* storage off: this session only */ }
    }

    function settings() {
        const s = Object.assign({}, DEFAULTS, loadStore().settings || {});
        if (!LEVELS[s.difficulty]) s.difficulty = 'beginner';
        return s;
    }

    function blankStats() {
        return { played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: [] };
    }

    function statsFor(level) {
        const all = loadStore().stats || {};
        return Object.assign(blankStats(), all[level] || {});
    }

    function saveStats(level, st) {
        const all = loadStore().stats || {};
        all[level] = st;
        saveStore({ stats: all });
    }

    // ---------------------------------------------------------------- board (the desktop's rules)

    class Board {
        constructor(w, h, mines) {
            this.w = w;
            this.h = h;
            this.mines = mines;
            this.cells = [];
            for (let i = 0; i < w * h; i++) this.cells.push({ mine: false, open: false, mark: 0, count: 0 });
            this.placed = false;
            this.opened = 0;
        }

        cell(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.cells[y * this.w + x] : null; }

        neighbours(x, y, fn) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const c = this.cell(x + dx, y + dy);
                    if (c) fn(c, x + dx, y + dy);
                }
            }
        }

        // mines anywhere but the first tile (and, when there is room, its neighbours)
        place(sx, sy) {
            const free = [];
            const keepClear = this.w * this.h - this.mines >= 9;
            for (let y = 0; y < this.h; y++) {
                for (let x = 0; x < this.w; x++) {
                    if (x === sx && y === sy) continue;
                    if (keepClear && Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) continue;
                    free.push(y * this.w + x);
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

        flags() { return this.cells.reduce((n, c) => n + (c.mark === 1 ? 1 : 0), 0); }

        // one character per tile: bit 0 mine, bit 1 open, bits 2-3 mark
        encode() { return this.cells.map((c) => String.fromCharCode(48 + (c.mine ? 1 : 0) + (c.open ? 2 : 0) + c.mark * 4)).join(''); }

        static decode(w, h, mines, s, placed) {
            const b = new Board(w, h, mines);
            if (typeof s !== 'string' || s.length !== w * h) return b;
            for (let i = 0; i < s.length; i++) {
                const v = s.charCodeAt(i) - 48;
                const c = b.cells[i];
                c.mine = !!(v & 1);
                c.open = !!(v & 2);
                c.mark = (v >> 2) & 3;
                if (c.open) b.opened++;
            }
            b.placed = !!placed;
            if (b.placed) b.count();
            return b;
        }

        layout() { return this.cells.map((c) => (c.mine ? 1 : 0)); }

        static fromLayout(w, h, mines, layout) {
            const b = new Board(w, h, mines);
            layout.forEach((m, i) => { b.cells[i].mine = !!m; });
            b.count();
            b.placed = true;
            return b;
        }
    }

    // ---------------------------------------------------------------- the game

    const game = {
        s: settings(),
        level: 'beginner',
        board: null,
        state: 'ready',      // ready | playing | won | lost
        time: 0,             // seconds on the clock (fractional while playing)
        loseAt: null,
        restarted: false,
        lastBest: false
    };

    function newBoard(sameLayout) {
        const old = game.board;
        if (sameLayout && old && old.placed) {
            game.board = Board.fromLayout(old.w, old.h, old.mines, old.layout());
        } else {
            game.s = settings();
            game.level = game.s.difficulty;
            const L = LEVELS[game.level];
            game.board = new Board(L.w, L.h, L.mines);
        }
        game.restarted = !!sameLayout;
        game.state = 'ready';
        game.time = 0;
        game.loseAt = null;
        press = null;
        cursor = null;
        save();
        layout();
        render();
    }

    function restore() {
        const v = loadStore().saved;
        game.s = settings();
        if (v && LEVELS[v.level] && v.w && v.h && typeof v.cells === 'string' && v.cells.length === v.w * v.h) {
            game.level = v.level;
            game.board = Board.decode(v.w, v.h, v.mines, v.cells, v.placed);
            game.state = ['ready', 'playing', 'won', 'lost'].includes(v.state) ? v.state : 'ready';
            game.time = Number(v.time) || 0;
            game.loseAt = v.loseAt || null;
            game.restarted = !!v.restarted;
            return;
        }
        game.level = game.s.difficulty;
        const L = LEVELS[game.level];
        game.board = new Board(L.w, L.h, L.mines);
        game.state = 'ready';
        game.time = 0;
    }

    let saveTimer = null;
    function save(now) {
        clearTimeout(saveTimer);
        const write = () => {
            const b = game.board;
            if (!b) return;
            saveStore({ saved: { level: game.level, w: b.w, h: b.h, mines: b.mines, cells: b.encode(), placed: b.placed, state: game.state, time: Math.min(999, game.time), loseAt: game.loseAt, restarted: game.restarted } });
        };
        if (now) write();
        else saveTimer = setTimeout(write, 400);
    }

    function start() {
        game.state = 'playing';
        game.time = 0;
        clock.last = performance.now();
        clockRun();
    }

    function reveal(x, y) {
        const b = game.board;
        const c = b.cell(x, y);
        if (!c || c.open || c.mark === 1) return;
        if (!b.placed) b.place(x, y);
        if (game.state === 'ready') start();
        if (c.mine) { lose(x, y); return; }
        const queue = [[x, y]];
        while (queue.length) {
            const [qx, qy] = queue.pop();
            const q = b.cell(qx, qy);
            if (!q || q.open || q.mark === 1 || q.mine) continue;
            q.open = true;
            q.mark = 0;
            b.opened++;
            if (q.count === 0) b.neighbours(qx, qy, (n, nx, ny) => { if (!n.open) queue.push([nx, ny]); });
        }
        if (b.opened === b.w * b.h - b.mines) winGame();
    }

    function chord(x, y) {
        const b = game.board;
        const c = b.cell(x, y);
        if (!c || !c.open || !c.count) return;
        let flags = 0;
        b.neighbours(x, y, (n) => { if (n.mark === 1) flags++; });
        if (flags !== c.count) return;
        const targets = [];
        b.neighbours(x, y, (n, nx, ny) => { if (!n.open && n.mark !== 1) targets.push([nx, ny]); });
        for (const [nx, ny] of targets) {
            if (game.state !== 'playing') break;
            reveal(nx, ny);
        }
    }

    function mark(x, y) {
        const c = game.board.cell(x, y);
        if (!c || c.open || (game.state !== 'ready' && game.state !== 'playing')) return;
        if (game.state === 'ready') start();
        c.mark = c.mark === 0 ? 1 : (c.mark === 1 && game.s.questionMarks ? 2 : 0);
        afterMove();
    }

    function act(x, y) {
        if (game.state !== 'ready' && game.state !== 'playing') return;
        const c = game.board.cell(x, y);
        if (!c) return;
        if (c.open) chord(x, y);
        else reveal(x, y);
        afterMove();
    }

    function afterMove() {
        save();
        render();
    }

    function lose(x, y) {
        clockStop();
        game.state = 'lost';
        game.loseAt = { x, y };
        record(false);
        save(true);
        render();
        ending(false);
    }

    function winGame() {
        clockStop();
        game.state = 'won';
        game.board.cells.forEach((c) => { if (c.mine) c.mark = 1; });
        record(true);
        save(true);
        render();
        ending(true);
    }

    function record(won) {
        game.lastBest = false;
        const st = statsFor(game.level);
        st.played += 1;
        if (won) {
            st.won += 1;
            st.streak = st.streak > 0 ? st.streak + 1 : 1;
            st.longestWin = Math.max(st.longestWin, st.streak);
            const t = Math.max(1, Math.ceil(game.time));
            st.best.push({ time: t, date: Date.now() });
            st.best.sort((a, b) => a.time - b.time);
            st.best = st.best.slice(0, 5);
            game.lastBest = st.best[0].time === t && st.best.filter((e) => e.time === t).length === 1;
        } else {
            st.streak = st.streak < 0 ? st.streak - 1 : -1;
            st.longestLose = Math.max(st.longestLose, -st.streak);
        }
        saveStats(game.level, st);
    }

    // the end of a game: WM's message box (information that answers the tap), a moment after the
    // board has shown the mines
    function ending(won) {
        const st = statsFor(game.level);
        // the time as the statistics keep it (a win's started second counts, as the best times list)
        const t = won ? Math.max(1, Math.ceil(game.time)) : Math.floor(game.time);
        const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
        const lines = [
            won ? 'Congratulations, you won the game!' : 'Sorry, you lost this game. Better luck next time!',
            ''
        ];
        if (won && game.lastBest) lines.push('You have the fastest time for this difficulty level!', '');
        lines.push(`Time: ${t} ${t === 1 ? 'second' : 'seconds'}`);
        if (st.best[0]) lines.push(`Best time: ${st.best[0].time} ${st.best[0].time === 1 ? 'second' : 'seconds'}`);
        // a phone box keeps it short: the rest is on Statistics
        lines.push(`Win percentage: ${pct}%`, '', 'Play again?');
        setTimeout(() => {
            if (!ws || game.state === 'ready' || game.state === 'playing') return;
            ws.messageBox({
                title: won ? 'Game Won' : 'Game Lost',
                icon: won ? 'info' : 'warning',
                text: lines.join('\n'),
                buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }],
                cancelValue: false,
                modal: true
            }).then((again) => { if (again && (game.state === 'won' || game.state === 'lost')) newBoard(false); });
        }, won ? 350 : 500);
    }

    // a game under way counts as lost when it is left for a new one (the desktop's rule)
    function abandon() {
        if (game.state !== 'playing') return;
        clockStop();
        record(false);
        game.state = 'lost';
    }

    async function askNewGame(sameLayout) {
        if (game.state === 'playing' && game.s.confirmEnd) {
            const yes = await ws.messageBox({
                title: 'New Game?',
                icon: 'question',
                text: sameLayout ? 'Do you really want to restart this game?' : 'Do you really want to begin a new game?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                cancelValue: false
            });
            if (!yes) return;
        }
        abandon();
        newBoard(sameLayout);
    }

    // ---------------------------------------------------------------- the clock

    const clock = { timer: null, last: 0, shown: -1 };

    function clockActive() {
        if (!ws || ws.current !== APP_ID || view !== 'game' || document.hidden) return false;
        if (ws.taskSwitcher && ws.taskSwitcher.isOpen) return false;
        if (document.querySelector('#wmShell .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return false;
        return true;
    }

    // the time since the last look goes on the clock while the game is on screen
    function clockAdd() {
        const now = performance.now();
        const dt = (now - clock.last) / 1000;
        clock.last = now;
        if (game.state === 'playing' && clockActive() && dt > 0 && dt < 5) game.time = Math.min(999, game.time + dt);
        renderStatus();
    }

    function clockTick() {
        if (game.state !== 'playing') { clockStop(); return; }
        clockAdd();
    }

    function clockRun() {
        if (clock.timer || game.state !== 'playing') return;
        clock.last = performance.now();
        clock.timer = setInterval(clockTick, 250);
    }

    function clockStop() {
        if (!clock.timer) return;
        clearInterval(clock.timer);
        clock.timer = null;
        clockAdd();
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (clock.timer) { clockStop(); save(true); } }
        else if (ws && ws.current === APP_ID && view === 'game') clockRun();
    });

    // ---------------------------------------------------------------- drawing

    let canvas = null;
    let ctx = null;
    let geo = null;          // { cell (device px), dpr, cols, rows, transposed }
    let press = null;        // { x, y, id, flagged } board coordinates of the tile under the pen
    let cursor = null;       // keyboard cursor { x, y }
    let colours = null;
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

    function cssColour(value, fallback) {
        const probe = document.createElement('span');
        probe.style.color = value;
        probe.style.display = 'none';
        page.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c && c !== 'rgba(0, 0, 0, 0)' ? c : fallback;
    }

    function readColours() {
        colours = {
            tile: cssColour('var(--wm-tint)', 'rgb(201, 233, 203)'),
            highlight: cssColour('var(--wm-highlight)', 'rgb(55, 211, 63)'),
            font: getComputedStyle(page).fontFamily || 'Tahoma, sans-serif'
        };
    }

    function toView(x, y) { return geo && geo.transposed ? { vx: y, vy: x } : { vx: x, vy: y }; }
    function toBoard(vx, vy) { return geo && geo.transposed ? { x: vy, y: vx } : { x: vx, y: vy }; }

    function layout() {
        if (!page || !canvas || view !== 'game' || page.hidden) return;
        const wrap = page.querySelector('.wmm-board');
        // the scroll bars take room when they come: measure again once if the first pass changes them
        for (let pass = 0; pass < 2; pass++) {
            const was = wrap.classList.contains('is-scroll');
            if (!fit(wrap)) return;
            if (wrap.classList.contains('is-scroll') === was) break;
        }
        readColours();
        render();
    }

    function fit(wrap) {
        const b = game.board;
        const u = unit();
        const dpr = window.devicePixelRatio || 1;
        const W = wrap.clientWidth;
        const H = wrap.clientHeight;
        if (!W || !H) return false;
        const mx = MARGIN_X * u;
        const my = MARGIN_Y * u;
        // portrait: a wide board stands on its side
        const transposed = b.w > b.h && H > W;
        const cols = transposed ? b.h : b.w;
        const rows = transposed ? b.w : b.h;
        const fitW = (W - 2 * mx) / cols;
        const fitH = (H - 2 * my) / rows;
        let tileU = Math.min(fitW, fitH, MAX_TILE * u);
        // too small to tap: fit the roomier side (up to the smallest comfortable tile) and scroll the other
        if (tileU < MIN_TILE * u) tileU = Math.max(MIN_SCROLL_TILE * u, Math.min(Math.max(fitW, fitH), MIN_TILE * u));
        const cell = Math.max(8, Math.floor(tileU * dpr));
        geo = { cell, dpr, cols, rows, transposed };
        const cw = cols * cell;
        const ch = rows * cell;
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
        canvas.style.width = `${cw / dpr}px`;
        canvas.style.height = `${ch / dpr}px`;
        const scrolls = cw / dpr + 2 * mx > W + 0.5 || ch / dpr + 2 * my > H + 0.5;
        wrap.classList.toggle('is-scroll', scrolls);
        return true;
    }

    function render() {
        if (!page) return;
        renderStatus();
        if (drawQueued) return;
        drawQueued = true;
        requestAnimationFrame(() => { drawQueued = false; draw(); });
    }

    function renderStatus() {
        if (!page) return;
        const b = game.board;
        const left = b ? b.mines - b.flags() : 0;
        const t = game.state === 'won' ? Math.max(1, Math.ceil(game.time)) : Math.floor(game.time);
        const mines = page.querySelector('.wmm-mines');
        const time = page.querySelector('.wmm-time');
        if (mines && mines.textContent !== String(left)) mines.textContent = String(left);
        if (time && clock.shown !== t) { time.textContent = String(t); clock.shown = t; }
    }

    function draw() {
        if (!ctx || !geo || view !== 'game' || !page || page.hidden) return;
        const { cell, cols, rows } = geo;
        const b = game.board;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // the press preview: the tile under the pen sinks; on an uncovered number, the covered tiles round it
        const sunk = new Set();
        if (press && !press.flagged && (game.state === 'ready' || game.state === 'playing')) {
            const c = b.cell(press.x, press.y);
            if (c && !c.open && c.mark !== 1) sunk.add(press.y * b.w + press.x);
            else if (c && c.open && c.count) b.neighbours(press.x, press.y, (n, nx, ny) => { if (!n.open && n.mark !== 1) sunk.add(ny * b.w + nx); });
        }
        const over = game.state === 'won' || game.state === 'lost';
        for (let vy = 0; vy < rows; vy++) {
            for (let vx = 0; vx < cols; vx++) {
                const { x, y } = toBoard(vx, vy);
                const c = b.cell(x, y);
                const px = vx * cell;
                const py = vy * cell;
                const lost = game.state === 'lost';
                if (c.open || (lost && c.mine && c.mark !== 1)) {
                    const hit = lost && game.loseAt && game.loseAt.x === x && game.loseAt.y === y;
                    openTile(px, py, cell, hit);
                    if (c.mine) mine(px, py, cell);
                    else if (c.count) number(px, py, cell, c.count);
                } else if (sunk.has(y * b.w + x)) {
                    downTile(px, py, cell);
                } else {
                    tile(px, py, cell);
                    if (c.mark === 1) {
                        flag(px, py, cell);
                        if (lost && !c.mine) cross(px, py, cell);
                    } else if (c.mark === 2) question(px, py, cell);
                }
            }
        }
        if (cursor && !over) {
            const { vx, vy } = toView(cursor.x, cursor.y);
            const lw = Math.max(2, Math.round(cell / 10));
            ctx.strokeStyle = colours.highlight;
            ctx.lineWidth = lw;
            ctx.strokeRect(vx * cell + lw / 2, vy * cell + lw / 2, cell - lw, cell - lw);
        }
    }

    // a covered tile: GDI's raised edge on the button face (the device's system colours: COLOR_BTNFACE
    // = the theme tint, COLOR_BTNHIGHLIGHT #fff, COLOR_BTNSHADOW #808080), the bands growing with the tile
    function tile(px, py, s) {
        const e = Math.max(1, Math.round(s / 16));
        ctx.fillStyle = colours.tile;
        ctx.fillRect(px, py, s, s);
        ctx.fillStyle = '#808080';
        ctx.fillRect(px, py + s - e, s, e);
        ctx.fillRect(px + s - e, py, e, s);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px, py, s - e, e);
        ctx.fillRect(px, py, e, s - e);
        // the corners where light meets shadow are split on the diagonal, as DrawEdge draws them
        ctx.beginPath();
        ctx.moveTo(px + s - e, py); ctx.lineTo(px + s, py); ctx.lineTo(px + s - e, py + e); ctx.closePath();
        ctx.moveTo(px, py + s - e); ctx.lineTo(px + e, py + s - e); ctx.lineTo(px, py + s); ctx.closePath();
        ctx.fill();
    }

    // pressed: flat face, the shadow line at the top / left only (DFCS_PUSHED of a flat button)
    function downTile(px, py, s) {
        const e = Math.max(1, Math.round(s / 24));
        ctx.fillStyle = colours.tile;
        ctx.fillRect(px, py, s, s);
        ctx.fillStyle = '#808080';
        ctx.fillRect(px, py, s, e);
        ctx.fillRect(px, py, e, s);
    }

    function openTile(px, py, s, hit) {
        const e = Math.max(1, Math.round(s / 24));
        ctx.fillStyle = hit ? '#ff0000' : '#ffffff';
        ctx.fillRect(px, py, s, s);
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(px, py + s - e, s, e);
        ctx.fillRect(px + s - e, py, e, s);
    }

    function number(px, py, s, n) {
        ctx.fillStyle = NUM_COLOURS[n];
        ctx.font = `bold ${Math.round(s * 0.66)}px ${colours.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), px + s / 2, py + s / 2 + s * 0.04);
    }

    // the mine: a shaded black ball (Bubble Breaker's GDI ball) with four spikes
    function mine(px, py, s) {
        const cx = px + s / 2;
        const cy = py + s / 2;
        const r = s * 0.27;
        const sp = s * 0.38;
        const lw = Math.max(1, Math.round(s / 12));
        ctx.strokeStyle = '#000';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(cx - sp, cy); ctx.lineTo(cx + sp, cy);
        ctx.moveTo(cx, cy - sp); ctx.lineTo(cx, cy + sp);
        const d = sp * 0.72;
        ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
        ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
        ctx.stroke();
        const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.08, cx, cy, r);
        g.addColorStop(0, '#d6d3d6');
        g.addColorStop(0.35, '#525152');
        g.addColorStop(1, '#000000');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // the flag: a red pennant to the left of a black pole on a two-step foot (16-unit grid)
    function flag(px, py, s) {
        const u = s / 16;
        const r = (v) => Math.round(v * u);
        const pw = Math.max(1, r(1.5));
        const x0 = px + r(9);
        ctx.fillStyle = '#000';
        ctx.fillRect(x0, py + r(2.5), pw, r(9.5));
        ctx.fillRect(px + r(6.5), py + r(11), r(6), Math.max(1, r(1.25)));
        ctx.fillRect(px + r(4.5), py + r(12), r(10), Math.max(1, r(1.75)));
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.moveTo(x0, py + r(2.5));
        ctx.lineTo(x0, py + r(9));
        ctx.lineTo(px + r(3), py + r(5.75));
        ctx.closePath();
        ctx.fill();
    }

    function cross(px, py, s) {
        const m = s * 0.2;
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = Math.max(1, Math.round(s / 10));
        ctx.beginPath();
        ctx.moveTo(px + m, py + m); ctx.lineTo(px + s - m, py + s - m);
        ctx.moveTo(px + s - m, py + m); ctx.lineTo(px + m, py + s - m);
        ctx.stroke();
    }

    function question(px, py, s) {
        ctx.fillStyle = '#000';
        ctx.font = `bold ${Math.round(s * 0.62)}px ${colours.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', px + s / 2, py + s / 2 + s * 0.04);
    }

    // ---------------------------------------------------------------- input

    function tileAt(e) {
        if (!geo) return null;
        const r = canvas.getBoundingClientRect();
        const vx = Math.floor(((e.clientX - r.left) * geo.dpr) / geo.cell);
        const vy = Math.floor(((e.clientY - r.top) * geo.dpr) / geo.cell);
        if (vx < 0 || vy < 0 || vx >= geo.cols || vy >= geo.rows) return null;
        return toBoard(vx, vy);
    }

    function wireBoard() {
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || (game.state !== 'ready' && game.state !== 'playing')) return;
            const t = tileAt(e);
            if (!t) return;
            cursor = null;
            press = { x: t.x, y: t.y, id: e.pointerId, flagged: false };
            render();
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!press || press.id !== e.pointerId || press.flagged) return;
            const t = tileAt(e);
            if (!t || t.x !== press.x || t.y !== press.y) {
                // off the tile: nothing happens on lift (the desktop's mouse up elsewhere)
                if (t) { press.x = t.x; press.y = t.y; } else press.off = true;
                render();
            }
        });
        canvas.addEventListener('pointerup', (e) => {
            if (!press || press.id !== e.pointerId) return;
            const p = press;
            press = null;
            const t = tileAt(e);
            if (!p.flagged && !p.off && t && t.x === p.x && t.y === p.y) act(t.x, t.y);
            else render();
        });
        const cancel = (e) => {
            if (!press || press.id !== e.pointerId) return;
            press = null;
            render();
        };
        canvas.addEventListener('pointercancel', cancel);
        canvas.addEventListener('lostpointercapture', cancel);
        // tap-and-hold (the shell's ring, then its contextmenu) and a mouse's right button: flag
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (game.state !== 'ready' && game.state !== 'playing') return;
            const t = tileAt(e);
            if (!t) return;
            if (press) press.flagged = true;
            mark(t.x, t.y);
        });
    }

    function onKey(e) {
        if (!ws || ws.current !== APP_ID || view !== 'game' || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('#wmShell .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return;
        if (game.state !== 'ready' && game.state !== 'playing') return;
        const b = game.board;
        // the arrows move on the screen as drawn (a board on its side turns with them)
        const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (mv) {
            e.preventDefault();
            const c = cursor || { x: Math.floor(b.w / 2), y: Math.floor(b.h / 2) };
            const v = toView(c.x, c.y);
            const nvx = Math.max(0, Math.min(geo.cols - 1, v.vx + (cursor ? mv[0] : 0)));
            const nvy = Math.max(0, Math.min(geo.rows - 1, v.vy + (cursor ? mv[1] : 0)));
            cursor = toBoard(nvx, nvy);
            scrollToCursor();
            render();
        } else if ((e.key === 'Enter' || e.key === ' ') && cursor) {
            e.preventDefault();
            act(cursor.x, cursor.y);
        } else if ((e.key === 'f' || e.key === 'F' || e.key === '+' || e.key === '0') && cursor) {
            e.preventDefault();
            mark(cursor.x, cursor.y);
        }
    }

    function scrollToCursor() {
        const wrap = page && page.querySelector('.wmm-board');
        if (!wrap || !cursor || !geo) return;
        const { vx, vy } = toView(cursor.x, cursor.y);
        const s = geo.cell / geo.dpr;
        const cr = canvas.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        const left = cr.left - wr.left + vx * s;
        const top = cr.top - wr.top + vy * s;
        if (top < 0) wrap.scrollTop += top;
        else if (top + s > wr.height) wrap.scrollTop += top + s - wr.height;
        if (left < 0) wrap.scrollLeft += left;
        else if (left + s > wr.width) wrap.scrollLeft += left + s - wr.width;
    }

    // ---------------------------------------------------------------- pages: Options, Statistics, About

    let form = null; // the Options page's working copy

    function showView(v) {
        view = v;
        if (!page) return;
        page.dataset.view = v;
        page.querySelectorAll('.wmm-view').forEach((el) => { el.hidden = el.dataset.v !== v; });
        if (v === 'game') {
            ws.setTitle('Minesweeper');
            requestAnimationFrame(layout);
            clockRun();
        }
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    function openPage(v) {
        if (v === 'options') {
            form = Object.assign({}, settings());
            renderOptions();
        } else if (v === 'stats') {
            renderStats(game.level);
        } else if (v === 'about') {
            renderAbout();
        }
        showView(v);
        ws.syncHistory();
    }

    function esc(s) { return ws.escapeHtml(s); }

    function levelLine(id) {
        const L = LEVELS[id];
        return `${L.w} x ${L.h} tiles, ${L.mines} mines`;
    }

    function renderOptions() {
        const box = page.querySelector('.wmm-view[data-v="options"]');
        box.innerHTML = `<div class="wm-form-hdr">Options</div><div class="wm-set-scroll"><div class="wm-form wmm-form">
            <div class="wm-form-row wmm-row"><span class="wm-form-label">Difficulty:</span><button type="button" class="wm-combo" data-act="level"><span>${esc(LEVELS[form.difficulty].name)}</span></button></div>
            <div class="wmm-level-note">${esc(levelLine(form.difficulty))}</div>
            <label class="wm-check"><input type="checkbox" data-f="questionMarks"${form.questionMarks ? ' checked' : ''}><span>Allow question marks</span></label>
            <label class="wm-check"><input type="checkbox" data-f="confirmEnd"${form.confirmEnd ? ' checked' : ''}><span>Confirm End Game</span></label>
            <p class="wmm-help">Tap a tile to uncover it. Tap and hold a tile to flag it${form.questionMarks ? ' (hold again for a question mark)' : ''}. Tap a number whose mines are all flagged to uncover the tiles around it.</p>
        </div></div>`;
        box.querySelectorAll('input[data-f]').forEach((inp) => inp.addEventListener('change', () => {
            form[inp.dataset.f] = inp.checked;
            if (inp.dataset.f === 'questionMarks') renderOptions();
        }));
        const combo = box.querySelector('[data-act="level"]');
        combo.addEventListener('click', (e) => {
            e.stopPropagation();
            ws.dropdown(combo, LEVEL_ORDER.map((id) => ({ label: LEVELS[id].name, radio: form.difficulty === id, action: () => { form.difficulty = id; renderOptions(); } })), 'left');
        });
    }

    async function closeOptions() {
        const next = form;
        form = null;
        if (!next) return;
        const before = game.s;
        saveStore({ settings: { difficulty: next.difficulty, questionMarks: !!next.questionMarks, confirmEnd: !!next.confirmEnd } });
        game.s = settings();
        // a question mark left on the board without the option stays until it is tapped (the desktop keeps it too)
        showView('game');
        ws.syncHistory();
        if (next.difficulty === before.difficulty && next.difficulty === game.level) return;
        if (game.state !== 'playing') { newBoard(false); return; }
        const quit = await ws.messageBox({
            title: 'Changed Game Settings',
            icon: 'question',
            text: 'These settings apply to the next game. Quit the game in progress and start a new game with the new settings? The game counts as lost.',
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false
        });
        if (quit && game.state === 'playing') { abandon(); newBoard(false); }
    }

    function fmtDate(ms) {
        try { return new Date(ms).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }); } catch (_) { return ''; }
    }

    function renderStats(level) {
        const box = page.querySelector('.wmm-view[data-v="stats"]');
        const st = statsFor(level);
        const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
        const s = st.streak;
        const cur = s > 0 ? `${s} ${s === 1 ? 'win' : 'wins'}` : s < 0 ? `${-s} ${s === -1 ? 'loss' : 'losses'}` : '0 wins';
        let best = '';
        for (let i = 0; i < 5; i++) {
            const e = st.best[i];
            best += `<div class="wmm-best-row"><span>${i + 1}.</span><span>${e ? esc(`${e.time} s`) : ''}</span><span>${e ? esc(fmtDate(e.date)) : ''}</span></div>`;
        }
        box.innerHTML = `<div class="wm-form-hdr">Statistics</div><div class="wm-set-scroll"><div class="wm-form wmm-form">
            <div class="wm-form-row wmm-row"><span class="wm-form-label">Level:</span><button type="button" class="wm-combo" data-act="level"><span>${esc(LEVELS[level].name)}</span></button></div>
            <div class="wmm-stats">
                <div class="wmm-sub">Best Times</div>
                <div class="wmm-best">${best}</div>
                <div class="wmm-stat"><span>Games played:</span><span>${st.played}</span></div>
                <div class="wmm-stat"><span>Games won:</span><span>${st.won}</span></div>
                <div class="wmm-stat"><span>Win percentage:</span><span>${pct}%</span></div>
                <div class="wmm-stat"><span>Longest winning streak:</span><span>${st.longestWin}</span></div>
                <div class="wmm-stat"><span>Longest losing streak:</span><span>${st.longestLose}</span></div>
                <div class="wmm-stat"><span>Current streak:</span><span>${esc(cur)}</span></div>
            </div>
            <div class="wm-buttons"><button type="button" class="wm-button wmm-reset">Reset</button></div>
        </div></div>`;
        const combo = box.querySelector('[data-act="level"]');
        combo.addEventListener('click', (e) => {
            e.stopPropagation();
            ws.dropdown(combo, LEVEL_ORDER.map((id) => ({ label: LEVELS[id].name, radio: level === id, action: () => renderStats(id) })), 'left');
        });
        box.querySelector('.wmm-reset').addEventListener('click', async () => {
            const yes = await ws.messageBox({
                title: 'Reset Statistics',
                icon: 'question',
                text: 'Do you really want to reset all of your Minesweeper statistics?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                cancelValue: false
            });
            if (!yes) return;
            saveStore({ stats: {} });
            renderStats(level);
        });
    }

    function renderAbout() {
        const box = page.querySelector('.wmm-view[data-v="about"]');
        box.innerHTML = `<div class="wmm-about">
            <canvas class="wmm-about-art" aria-hidden="true"></canvas>
            <div>Minesweeper</div>
            <div>Designed for Melaton Mobile</div>
            <div>© 2008 Xyridian Corporation.</div>
            <div>All rights reserved.</div>
        </div>`;
        // the game's mark: a flag on a covered tile beside a mine on an uncovered one
        const art = box.querySelector('.wmm-about-art');
        const u = unit();
        const dpr = window.devicePixelRatio || 1;
        const s = Math.round(40 * u * dpr);
        art.width = s * 2;
        art.height = s;
        art.style.width = `${(s * 2) / dpr}px`;
        art.style.height = `${s / dpr}px`;
        const keep = ctx;
        if (!colours) readColours();
        ctx = art.getContext('2d');
        tile(0, 0, s); flag(0, 0, s);
        openTile(s, 0, s, false); mine(s, 0, s);
        ctx = keep;
    }

    // ---------------------------------------------------------------- the app

    function mount(p) {
        page = p;
        p.classList.add('wm-minesweeper');
        p.innerHTML = `
            <div class="wmm-view" data-v="game">
                <div class="wmm-status"><span><b>Mines:</b> <span class="wmm-mines">0</span></span><span><b>Time:</b> <span class="wmm-time">0</span></span></div>
                <div class="wmm-board"><canvas class="wmm-canvas" aria-label="Minesweeper board"></canvas></div>
            </div>
            <div class="wmm-view wm-set" data-v="options" hidden></div>
            <div class="wmm-view wm-set" data-v="stats" hidden></div>
            <div class="wmm-view" data-v="about" hidden></div>`;
        canvas = p.querySelector('.wmm-canvas');
        ctx = canvas.getContext('2d');
        clock.shown = -1;
        wireBoard();
        const ro = new ResizeObserver(() => { if (view === 'game') layout(); });
        ro.observe(p.querySelector('.wmm-board'));
        p.dataset.view = view;
        page.querySelectorAll('.wmm-view').forEach((el) => { el.hidden = el.dataset.v !== view; });
        if (view === 'options' && form) renderOptions();
        else if (view === 'stats') renderStats(game.level);
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
            title: 'Minesweeper',
            icon: 'app-minesweeper',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show() {
                readColours();
                if (view === 'game') { requestAnimationFrame(layout); clockRun(); }
            },
            hide() {
                // Smart Minimize: the board and the clock wait as they are
                clockStop();
                press = null;
                save(true);
            },
            onEnd() {
                clockStop();
                save(true);
                // the page goes; the game stays (and the sub-page closes: X left it)
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
                return {
                    left: { label: 'New Game', action: () => askNewGame(false) },
                    right: {
                        label: 'Menu',
                        menu: () => [
                            { label: 'Restart Game', disabled: !game.board || !game.board.placed, action: () => askNewGame(true) },
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
    }

    // tests and the lead: the running game
    window.wmMinesweeper = {
        get state() { return game.state; },
        get game() { return game; },
        get geo() { return geo; },
        get view() { return view; },
        act, mark, newBoard, levels: LEVELS
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
