// Doubles: a slide-and-join number puzzle that sits with the Windows Vista games (Yozora #836).
// Vista never shipped one, so this is a Melaton game built as Block Drop and Brick Breaker are: on
// the shared engine (public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js), drawn by the
// game itself (glass tiles on Vista's blue; no sprite pack), with the real games' sounds and Vista's
// dialog wording. Icons and the Games Explorer thumbnail: scripts/build-new-games-art.js.
//
//   - a square board (3 x 3, 4 x 4 or 5 x 5, Options) of numbered tiles. An arrow key (or W A S D,
//     or a drag with the mouse) slides every tile as far as it goes; two tiles of the same number
//     that meet join into one of twice the number, and the join scores that number. A tile joins
//     once a move. Each move adds a 2 (nine times in ten) or a 4 on an empty square.
//   - the goal is one tile of 2048 (256 on the small board, 4096 on the large one); the game can be
//     played on past it for score. With no empty square and no join left, the game is over.
//   - Undo (Ctrl+Z) takes back the last move, once (Options turns it off).
//   - statistics: five high scores for each board size, games, wins, streaks, the largest tile.
//
// The rules are pure (no DOM): scripts/test-vista-doubles.js loads this file in node and tests
// them through module.exports. public/scripts/comp/wmDoubles.js (the phone's game) carries a copy
// of the rules block: keep the two in step.
(function (root) {
    'use strict';

    // The game's name, everywhere it shows (title bar, menus, dialogs, Games Explorer)
    const DISPLAY_NAME = 'Doubles';
    // who made it (About box, Games Explorer)
    const DEVELOPER = 'Academy City Research P.S.R.';
    const COPYRIGHT = 'Copyright © 2026 ' + DEVELOPER + '  All rights reserved.';

    // ---- rules --------------------------------------------------------------------------------
    const SIZES = [3, 4, 5];
    const GOALS = { 3: 256, 4: 2048, 5: 4096 };
    const DIRS = ['left', 'up', 'right', 'down'];

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // each row or column as cell indexes, in the order tiles reach them when they move `dir`
    function lanes(n, dir) {
        const out = [];
        for (let a = 0; a < n; a++) {
            const lane = [];
            for (let b = 0; b < n; b++) {
                const c = dir === 'left' || dir === 'up' ? b : n - 1 - b;
                lane.push(dir === 'left' || dir === 'right' ? a * n + c : c * n + a);
            }
            out.push(lane);
        }
        return out;
    }

    function addTile(g, rnd) {
        const free = [];
        g.cells.forEach((t, i) => { if (!t) free.push(i); });
        if (!free.length) return null;
        const at = free[Math.floor(rnd() * free.length)];
        const tile = { id: g.nextId++, v: rnd() < 0.9 ? 2 : 4 };
        g.cells[at] = tile;
        if (tile.v > g.top) g.top = tile.v;
        return { at, tile };
    }

    function createGame(n, rnd) {
        const g = { n, goal: GOALS[n] || 2048, cells: new Array(n * n).fill(null), score: 0, moves: 0, top: 0, joined: 0, won: false, over: false, nextId: 1 };
        addTile(g, rnd);
        addTile(g, rnd);
        return g;
    }

    function canMove(g) {
        const n = g.n;
        for (let i = 0; i < n * n; i++) {
            const t = g.cells[i];
            if (!t) return true;
            if (i % n < n - 1 && g.cells[i + 1] && g.cells[i + 1].v === t.v) return true;
            if (i + n < n * n && g.cells[i + n] && g.cells[i + n].v === t.v) return true;
        }
        return false;
    }

    // -> null when nothing moves, or { slides: [{ id, v, from, to, gone }], merges: [{ at, tile }],
    //    spawn: { at, tile }, gained, reached (the goal tile was just made), over }
    function move(g, dir, rnd) {
        if (g.over || DIRS.indexOf(dir) < 0) return null;
        const next = new Array(g.n * g.n).fill(null);
        const slides = [];
        const merges = [];
        let gained = 0;
        let moved = false;
        lanes(g.n, dir).forEach((lane) => {
            let p = 0;
            let last = null; // the tile placed last, while it can still join
            lane.forEach((cell) => {
                const t = g.cells[cell];
                if (!t) return;
                if (last && last.tile.v === t.v) {
                    const tile = { id: g.nextId++, v: t.v * 2 };
                    next[last.cell] = tile;
                    last.slide.gone = true;
                    slides.push({ id: t.id, v: t.v, from: cell, to: last.cell, gone: true });
                    merges.push({ at: last.cell, tile });
                    gained += tile.v;
                    moved = true;
                    last = null;
                } else {
                    const to = lane[p++];
                    next[to] = t;
                    const slide = { id: t.id, v: t.v, from: cell, to, gone: false };
                    slides.push(slide);
                    if (to !== cell) moved = true;
                    last = { tile: t, cell: to, slide };
                }
            });
        });
        if (!moved) return null;
        g.cells = next;
        g.score += gained;
        g.moves += 1;
        g.joined += merges.length;
        merges.forEach((m) => { if (m.tile.v > g.top) g.top = m.tile.v; });
        const reached = !g.won && g.top >= g.goal;
        if (reached) g.won = true;
        const spawn = addTile(g, rnd);
        if (!canMove(g)) g.over = true;
        return { slides, merges, spawn, gained, reached, over: g.over };
    }

    const cloneGame = (g) => JSON.parse(JSON.stringify(g));

    function validGame(g) {
        return !!g && SIZES.indexOf(g.n) >= 0 && Array.isArray(g.cells) && g.cells.length === g.n * g.n
            && g.cells.every((t) => t === null || (t && t.v >= 2 && Number.isInteger(Math.log2(t.v))));
    }

    // ---- look (above the export: scripts/build-new-games-art.js paints the same tiles in node) ----
    const FONT = '"Segoe UI", Tahoma, sans-serif';
    // glass tiles in Aero's colours: [top, bottom, edge, text], by power of two
    const TILE_COLORS = [
        ['#f6fafe', '#cfdff1', '#8fa9c8', '#1e3a5f'], // 2
        ['#dcedfc', '#a5c9ee', '#6f9bcb', '#1e3a5f'], // 4
        ['#8ed6f4', '#3d9fd8', '#256fa4', '#ffffff'], // 8
        ['#62d1cb', '#1b9796', '#0f6c6c', '#ffffff'], // 16
        ['#7ad685', '#2c9a42', '#1b6f2d', '#ffffff'], // 32
        ['#c0de58', '#7ea81a', '#587a0c', '#ffffff'], // 64
        ['#f9d95c', '#dc9e10', '#a47206', '#ffffff'], // 128
        ['#f9ae4e', '#de700e', '#a44e04', '#ffffff'], // 256
        ['#f47c68', '#cf3626', '#96200f', '#ffffff'], // 512
        ['#ee6dab', '#bb256e', '#84124a', '#ffffff'], // 1024
        ['#b08af0', '#683cc4', '#44208e', '#ffffff'], // 2048
        ['#5c6a80', '#1d2532', '#0a0e16', '#ffd866']  // 4096 and up
    ];
    const tileColors = (v) => TILE_COLORS[Math.min(TILE_COLORS.length - 1, Math.max(0, Math.round(Math.log2(v)) - 1))];

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // one tile, painted s px square (device pixels)
    function paintTile(ctx, s, v, goal) {
        const [top, bottom, edge, text] = tileColors(v);
        const r = s * 0.11;
        const inset = Math.max(1, s * 0.012);
        ctx.clearRect(0, 0, s, s);
        // edge, body
        roundRect(ctx, 0, 0, s, s, r);
        ctx.fillStyle = edge;
        ctx.fill();
        roundRect(ctx, inset, inset, s - inset * 2, s - inset * 2, r - inset);
        const g = ctx.createLinearGradient(0, 0, 0, s);
        g.addColorStop(0, top);
        g.addColorStop(1, bottom);
        ctx.fillStyle = g;
        ctx.fill();
        // the glass: a light upper half with a curved lower edge, and a thin inner rim
        ctx.save();
        roundRect(ctx, inset, inset, s - inset * 2, s - inset * 2, r - inset);
        ctx.clip();
        const gl = ctx.createLinearGradient(0, 0, 0, s * 0.55);
        gl.addColorStop(0, 'rgba(255,255,255,0.62)');
        gl.addColorStop(1, 'rgba(255,255,255,0.08)');
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(s, 0);
        ctx.lineTo(s, s * 0.4);
        ctx.quadraticCurveTo(s * 0.5, s * 0.58, 0, s * 0.4);
        ctx.closePath();
        ctx.fill();
        const low = ctx.createLinearGradient(0, s * 0.7, 0, s);
        low.addColorStop(0, 'rgba(255,255,255,0)');
        low.addColorStop(1, 'rgba(255,255,255,0.22)');
        ctx.fillStyle = low;
        ctx.fillRect(0, s * 0.7, s, s * 0.3);
        ctx.restore();
        roundRect(ctx, inset * 2, inset * 2, s - inset * 4, s - inset * 4, r - inset * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = inset;
        ctx.stroke();
        if (v >= goal) {
            roundRect(ctx, inset * 3.5, inset * 3.5, s - inset * 7, s - inset * 7, r - inset * 3);
            ctx.strokeStyle = 'rgba(255,224,120,0.95)';
            ctx.lineWidth = inset * 2;
            ctx.stroke();
        }
        // the number
        const label = String(v);
        const size = s * (label.length <= 2 ? 0.46 : label.length === 3 ? 0.38 : label.length === 4 ? 0.3 : 0.24);
        ctx.font = '600 ' + size + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = text === '#1e3a5f' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)';
        ctx.fillText(label, s / 2, s * 0.53 + Math.max(1, s * 0.012));
        ctx.fillStyle = text;
        ctx.fillText(label, s / 2, s * 0.53);
    }

    const rules = { DISPLAY_NAME, SIZES, GOALS, DIRS, mulberry32, lanes, addTile, createGame, canMove, move, cloneGame, validGame, paintTile, roundRect };
    if (typeof module === 'object' && module.exports) module.exports = rules;

    const VG = root.VistaGames;
    if (!VG || typeof document === 'undefined') return;

    // ---- game window ------------------------------------------------------------------------
    const GAME_ID = 'doubles';
    const MODAL_ID = 'vistaDoublesModal';
    const ICON = '/static_images/vista-games/icons/' + GAME_ID;
    const PAD = 17;
    const HEAD_H = 56;
    const BOARD = 386;
    const BX = PAD;
    const BY = PAD + HEAD_H + 12;
    const NATIVE_W = PAD * 2 + BOARD;
    const NATIVE_H = BY + BOARD + PAD;
    const SLIDE_MS = 110;
    const POP_MS = 150;

    const CMD = { NEW: 40006, UNDO: 40009, STATS: 40003, OPTIONS: 40004, EXIT: 40005, HELP: 40008, ABOUT: 40007 };
    const MENU = [
        { text: '&Game', items: [
            { id: CMD.NEW, text: '&New Game\tF2' },
            { separator: true },
            { id: CMD.UNDO, text: '&Undo\tCtrl+Z' },
            { separator: true },
            { id: CMD.STATS, text: '&Statistics\tF4' },
            { id: CMD.OPTIONS, text: '&Options\tF5' },
            { separator: true },
            { id: CMD.EXIT, text: 'E&xit' }
        ] },
        { text: '&Help', items: [
            { id: CMD.HELP, text: '&View Help\tF1' },
            { separator: true },
            { id: CMD.ABOUT, text: '&About ' + DISPLAY_NAME }
        ] }
    ];
    const ACCELERATORS = [
        { flags: 1, key: 112, id: CMD.HELP }, { flags: 1, key: 113, id: CMD.NEW }, { flags: 1, key: 115, id: CMD.STATS },
        { flags: 1, key: 116, id: CMD.OPTIONS }, { flags: 9, key: 90, id: CMD.UNDO }
    ];

    const STR = {
        newGame: 'New Game',
        newGameAsk: 'What do you want to do with the game in progress?',
        quitNew: 'Quit and start a &new game\nThis counts as a loss in your statistics.',
        quitNewWon: 'Start a &new game\nThis game counts as a win in your statistics.',
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
        goalTitle: 'Game Won',
        goalMade: 'Congratulations, you made the %1 tile!',
        goalKeep: '&Keep playing\nSee how high your score can go.',
        goalNew: 'Start a &new game',
        gameWon: 'Game Won',
        gameLost: 'Game Lost',
        won: 'No more moves. You made the %1 tile: you won the game!',
        lost: 'Sorry, there are no more moves. Better luck next time!',
        newHigh: 'You have a new high score!',
        played: 'Games played: %1',
        gamesWon: 'Games won: %1',
        winPct: 'Win percentage: %1%',
        longestWin: 'Longest winning streak: %1',
        longestLose: 'Longest losing streak: %1',
        streakWin: ['Current streak: %1 wins', 'Current streak: %1 win'],
        streakLose: ['Current streak: %1 losses', 'Current streak: %1 loss'],
        score: 'Score: %1',
        highScore: 'High score: %1',
        date: 'Date: %1',
        tile: 'Largest tile: %1',
        moves: 'Moves: %1',
        topTile: 'Largest tile ever: %1',
        mostMoves: 'Most moves in a game: %1',
        totalJoined: 'Tiles joined: %1',
        statsTitle: DISPLAY_NAME + ' Statistics - %1',
        highScores: 'High Scores (%1 x %1)',
        howTo: 'How to play ' + DISPLAY_NAME,
        howToText: 'Press an arrow key (or W, A, S, D), or drag across the board, to slide every tile that way. '
            + 'Two tiles with the same number join into one tile of twice the number, and the new number is added to your score. '
            + 'Every move puts a new 2 or 4 on the board.\n\n'
            + 'Make the %1 tile to win. You can keep playing after that for a higher score. '
            + 'The game is over when the board is full and no two neighbours match.\n\n'
            + 'Ctrl+Z takes back your last move.',
        ok: 'OK',
        goal: 'Goal: the %1 tile',
        movesShort: 'Moves: %1'
    };

    const fmt = (s, ...args) => String(s).replace(/%(\d)/g, (m, i) => (args[i - 1] !== undefined ? args[i - 1] : m));

    const store = VG.store(GAME_ID);
    const DEFAULT_SETTINGS = { animations: true, sounds: true, undo: true, continueSaved: false, saveOnExit: false, size: 4 };
    let game = null;

    function settings() {
        const s = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
        if (SIZES.indexOf(s.size) < 0) s.size = 4;
        return s;
    }

    function saveSettings(s) {
        store.set('settings', s);
    }

    function blankStats() {
        return { played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: { 3: [], 4: [], 5: [] }, topTile: 0, mostMoves: 0, joined: 0 };
    }

    function stats() {
        const st = Object.assign(blankStats(), store.get('stats', {}));
        st.best = Object.assign(blankStats().best, st.best || {});
        return st;
    }

    function streakText(streak) {
        const n = Math.abs(streak);
        const pair = streak < 0 ? STR.streakLose : STR.streakWin;
        return fmt(n === 1 ? pair[1] : pair[0], n);
    }

    // ---- dialog templates (dialog units, as the games' own) ------------------------------------
    const BS_GROUPBOX = 0x50000007;
    const BS_DEFPUSH = 0x50030001;
    const BS_PUSH = 0x50010000;
    const BS_CHECK = 0x50010003;
    const BS_RADIO_FIRST = 0x50030009;
    const BS_RADIO = 0x50000009;
    const SS_LEFT = 0x50020000;
    const SS_CENTER = 0x50020001;
    const SS_RIGHT = 0x50020002;

    const OPTIONS_TPL = {
        cx: 255, cy: 172, title: 'Options',
        controls: [
            { id: -1, className: 'Button', text: 'Board', x: 8, y: 6, cx: 240, cy: 38, style: BS_GROUPBOX },
            { id: 1104, className: 'Button', text: '&Small (3 x 3)', x: 16, y: 21, cx: 70, cy: 10, style: BS_RADIO_FIRST },
            { id: 1105, className: 'Button', text: 'S&tandard (4 x 4)', x: 88, y: 21, cx: 78, cy: 10, style: BS_RADIO },
            { id: 1106, className: 'Button', text: '&Large (5 x 5)', x: 170, y: 21, cx: 70, cy: 10, style: BS_RADIO },
            { id: 1002, className: 'Button', text: '&Display animations', x: 15, y: 54, cx: 233, cy: 13, style: 0x50030003 },
            { id: 1017, className: 'Button', text: '&Play sounds', x: 15, y: 69, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1018, className: 'Button', text: 'Allow &undo', x: 15, y: 84, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1020, className: 'Button', text: 'Always &continue saved game', x: 15, y: 99, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1044, className: 'Button', text: '&Always save game on exit', x: 15, y: 114, cx: 233, cy: 13, style: BS_CHECK },
            { id: 1, className: 'Button', text: 'OK', x: 95, y: 151, cx: 72, cy: 14, style: BS_DEFPUSH },
            { id: 2, className: 'Button', text: 'Cancel', x: 171, y: 151, cx: 72, cy: 14, style: BS_PUSH }
        ]
    };

    const STATS_TPL = {
        cx: 300, cy: 128, title: '',
        controls: [
            { id: 2, className: 'Button', text: '&Close', x: 113, y: 107, cx: 88, cy: 14, style: BS_DEFPUSH },
            { id: 1001, className: 'Button', text: '&Reset', x: 205, y: 107, cx: 88, cy: 14, style: BS_PUSH },
            { id: 1200, className: 'Button', text: '', x: 7, y: 6, cx: 136, cy: 62, style: BS_GROUPBOX }
        ].concat([0, 1, 2, 3, 4].reduce((list, i) => list.concat([
            { id: 1201 + i, className: 'Static', text: '', x: 14, y: 17 + i * 9, cx: 50, cy: 8, style: SS_RIGHT },
            { id: 1211 + i, className: 'Static', text: '', x: 72, y: 17 + i * 9, cx: 66, cy: 8, style: SS_LEFT }
        ]), [])).concat([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            { id: 1221 + i, className: 'Static', text: '', x: 152, y: 6 + i * 10 + Math.floor(i / 3) * 4, cx: 141, cy: 8, style: SS_LEFT }
        )))
    };

    function resultTemplate(won, goal) {
        return {
            cx: 248, cy: 128, title: won ? STR.gameWon : STR.gameLost,
            controls: [
                { id: 1300, className: 'Static', text: won ? fmt(STR.won, goal) : STR.lost, x: 7, y: 8, cx: 234, cy: 12, style: SS_CENTER },
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

    const audioPack = (dir) => ({ audioUrl: (file) => '/static_images/vista-games/' + dir + '/audio/' + file.replace(/\.wma$/i, '').toLowerCase() + '.m4a' });
    function soundsNode(list) {
        return {
            t: 'Sounds',
            c: list.map(([name, file, volume, buffers]) => ({
                t: name,
                c: [{ t: 'File', v: file }, { t: 'Volume', v: String(volume) }, { t: 'Buffers', v: String(buffers) }]
            }))
        };
    }

    // ---- game --------------------------------------------------------------------------------
    class Doubles {
        constructor() {
            this.s = settings();
            // no pack of its own: the window only needs somewhere to keep its accelerators
            this.pack = { name: GAME_ID, mui: { strings: {}, menus: {}, dialogs: {}, accelerators: { game: ACCELERATORS } } };
            // the real games' sounds: the card games' for the tiles, Mahjong Titans' clack for a
            // join, Minesweeper's for the start and the end
            this.sounds = [
                new VG.Sounds(audioPack('cardgames'), soundsNode([
                    ['Slide', 'Shared_MoveCardSetDown.wma', 70, 3],
                    ['NoMove', 'Shared_IllegalMove.wma', 60, 1],
                    ['Undo', 'Shared_Undo.wma', 80, 1],
                    ['Goal', 'Shared_MoveToHome.wma', 100, 1]
                ])),
                new VG.Sounds(audioPack('mahjong'), soundsNode([
                    ['Join', 'Mahjong_PieceClack01.wma', 80, 3],
                    ['Join', 'Mahjong_PieceClack02.wma', 80, 3],
                    ['Join', 'Mahjong_PieceClack03.wma', 80, 3]
                ])),
                new VG.Sounds(audioPack('minesweeper'), soundsNode([
                    ['NewGame', 'Minesweeper_GameStart.wma', 45, 1],
                    ['GameOver', 'Minesweeper_Lose.wma', 50, 1],
                    ['Win', 'Minesweeper_Win.wma', 55, 1]
                ]))
            ];
            this.tileCache = new Map();
            this.anim = null;
            this.gain = null;
            this.prev = null;
            this.recorded = false;
            this.pending = null;
            this.drag = null;
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: DISPLAY_NAME,
                // the caption / taskbar icon: the app-icon set (getModalIcons, modalUtils.js, keeps the file name)
                icon: '/static_images/app_icons/48/vista-' + GAME_ID + '.webp',
                // behind the image icon only (no Vista art for a game Vista never had)
                iconClass: 'fas fa-table-cells',
                pack: this.pack,
                menu: MENU,
                accelerators: 'game',
                nativeW: NATIVE_W,
                nativeH: NATIVE_H,
                fill: '#0d2c63',
                maximizable: true,
                onCommand: (id) => this.command(id),
                menuState: (id) => (id === CMD.UNDO ? { disabled: !this.canUndo() } : {}),
                onClose: () => this.requestExit(),
                onActivate: () => this.win.stage.invalidate(),
                onKeyDown: (e) => this.keyDown(e)
            });
            const stage = this.win.stage;
            stage.draw = (ctx, st) => this.draw(ctx, st);
            stage.onFrame = (now) => this.frame(now);
            this.wirePointer();
            this.newGame(false);
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

        // ---- game flow -------------------------------------------------------------------------
        newGame(sound) {
            this.g = createGame(this.s.size, Math.random);
            this.anim = null;
            this.gain = null;
            this.prev = null;
            this.pending = null;
            this.recorded = false;
            this.overAt = 0;
            if (sound !== false && this.win.isOpen()) this.play('NewGame');
            this.win.stage.invalidate();
        }

        inProgress() {
            return this.g.moves > 0 && !this.g.over && !this.recorded;
        }

        canUndo() {
            return this.s.undo && !!this.prev && !this.g.over && !this.win.dialogs.length;
        }

        undo() {
            if (!this.canUndo()) return;
            this.settle();
            this.g = this.prev;
            this.prev = null;
            this.play('Undo');
            this.win.stage.invalidate();
        }

        // an animation in flight ends at once (the next key does not wait for it)
        settle() {
            this.anim = null;
            const p = this.pending;
            this.pending = null;
            if (p) this.afterMove(p);
        }

        tryMove(dir) {
            if (this.win.dialogs.length || this.g.over) return;
            this.settle();
            if (this.win.dialogs.length || this.g.over) return;
            const before = this.s.undo ? cloneGame(this.g) : null;
            const r = move(this.g, dir, Math.random);
            if (!r) {
                this.play('NoMove');
                return;
            }
            this.prev = before;
            this.play(r.merges.length ? 'Join' : 'Slide');
            if (r.gained) this.gain = { v: r.gained, at: VG.now() };
            if (this.s.animations) {
                this.anim = { at: VG.now(), r };
                this.pending = r;
            } else this.afterMove(r);
            this.win.stage.invalidate();
        }

        afterMove(r) {
            if (r.over) {
                this.overAt = VG.now();
                this.prev = null;
                const won = this.g.won;
                const high = this.record(won);
                this.play(won ? 'Win' : 'GameOver');
                root.setTimeout(() => { if (this.g.over && this.win.isOpen()) this.showResult(won, high); }, 900);
            } else if (r.reached) {
                this.play('Win');
                VG.taskDialog({
                    owner: this.win,
                    title: STR.goalTitle,
                    instruction: fmt(STR.goalMade, this.g.goal),
                    links: [VG.linkFromString(STR.goalKeep, 1), VG.linkFromString(STR.goalNew, 2)]
                }).then((id) => {
                    if (id === 2) {
                        this.record(true);
                        this.newGame();
                    }
                });
            }
            this.win.stage.invalidate();
        }

        // the game goes into the statistics once; -> true when its score is a new best for the board
        record(won) {
            if (this.recorded) return false;
            this.recorded = true;
            const g = this.g;
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
            st.topTile = Math.max(st.topTile, g.top);
            st.mostMoves = Math.max(st.mostMoves, g.moves);
            st.joined += g.joined;
            const list = st.best[g.n] || (st.best[g.n] = []);
            const high = g.score > 0 && (!list.length || g.score > list[0].score);
            if (g.score > 0) {
                list.push({ score: g.score, date: Date.now(), tile: g.top });
                list.sort((a, b) => b.score - a.score);
                list.length = Math.min(5, list.length);
            }
            store.set('stats', st);
            return high;
        }

        bestScore() {
            const list = stats().best[this.g.n] || [];
            return Math.max(list.length ? list[0].score : 0, this.g.score);
        }

        // ---- input -----------------------------------------------------------------------------
        keyDown(e) {
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
            const dir = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
            if (!dir) return;
            e.preventDefault();
            this.tryMove(dir);
        }

        wirePointer() {
            const surface = this.win.surface;
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointerdown', (e) => {
                surface.focus({ preventScroll: true });
                if (e.button !== 0) return;
                this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
                try { surface.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
            });
            surface.addEventListener('pointermove', (e) => {
                const d = this.drag;
                if (!d || d.id !== e.pointerId) return;
                const dx = e.clientX - d.x;
                const dy = e.clientY - d.y;
                if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
                this.drag = null;
                this.tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
            });
            const end = (e) => { if (this.drag && this.drag.id === e.pointerId) this.drag = null; };
            surface.addEventListener('pointerup', end);
            surface.addEventListener('pointercancel', end);
        }

        // ---- drawing ---------------------------------------------------------------------------
        geometry() {
            const n = this.g.n;
            const gap = n === 5 ? 8 : 10;
            const tile = (BOARD - gap * (n + 1)) / n;
            return { n, gap, tile, x: (i) => BX + gap + (i % n) * (tile + gap), y: (i) => BY + gap + Math.floor(i / n) * (tile + gap) };
        }

        tileImage(v, px) {
            const key = v + '@' + px + '/' + this.g.goal;
            let c = this.tileCache.get(key);
            if (!c) {
                if (this.tileCache.size > 80) this.tileCache.clear();
                c = document.createElement('canvas');
                c.width = c.height = px;
                paintTile(c.getContext('2d'), px, v, this.g.goal);
                this.tileCache.set(key, c);
            }
            return c;
        }

        frame(now) {
            let again = false;
            if (this.anim) {
                if (now - this.anim.at >= SLIDE_MS + POP_MS) this.settle();
                else again = true;
            }
            if (this.gain) {
                if (now - this.gain.at > 700) this.gain = null;
                else again = true;
            }
            if (this.overAt && now - this.overAt < 600) again = true;
            return again;
        }

        drawPanel(ctx, x, y, w, h, label, value) {
            roundRect(ctx, x, y, w, h, 5);
            const g = ctx.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, 'rgba(4,16,44,0.78)');
            g.addColorStop(1, 'rgba(10,32,78,0.62)');
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = 'rgba(170,205,255,0.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.font = '11px ' + FONT;
            ctx.fillStyle = '#a9c8f4';
            ctx.fillText(label, x + w / 2, y + 17);
            ctx.font = '600 22px ' + FONT;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(value), x + w / 2, y + 43);
        }

        draw(ctx, st) {
            const g = this.g;
            const now = VG.now();
            // Vista's blue, lit from the top left
            const bg = ctx.createLinearGradient(0, 0, 0, NATIVE_H);
            bg.addColorStop(0, '#3f7fd0');
            bg.addColorStop(0.45, '#1f56a8');
            bg.addColorStop(1, '#0d2c63');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, NATIVE_W, NATIVE_H);
            const glow = ctx.createRadialGradient(NATIVE_W * 0.2, -40, 10, NATIVE_W * 0.2, -40, NATIVE_W * 0.9);
            glow.addColorStop(0, 'rgba(190,225,255,0.5)');
            glow.addColorStop(1, 'rgba(190,225,255,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, NATIVE_W, NATIVE_H);

            // the header: the goal and the move count on the left, score and best in panels
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.font = '600 15px ' + FONT;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(fmt(STR.goal, g.goal), PAD + 2, PAD + 22);
            ctx.font = '12px ' + FONT;
            ctx.fillStyle = '#cfe2fb';
            ctx.fillText(fmt(STR.movesShort, g.moves), PAD + 2, PAD + 42);
            const pw = 96;
            this.drawPanel(ctx, NATIVE_W - PAD - pw * 2 - 8, PAD, pw, HEAD_H, 'SCORE', g.score);
            this.drawPanel(ctx, NATIVE_W - PAD - pw, PAD, pw, HEAD_H, 'BEST', this.bestScore());
            if (this.gain) {
                const u = Math.min(1, (now - this.gain.at) / 700);
                ctx.globalAlpha = 1 - u;
                ctx.font = '600 15px ' + FONT;
                ctx.textAlign = 'center';
                ctx.fillStyle = '#ffe27a';
                ctx.fillText('+' + this.gain.v, NATIVE_W - PAD - pw * 1.5 - 8, PAD + 30 - u * 26);
                ctx.globalAlpha = 1;
            }

            // the board: a sunken glass tray with a square for every cell
            roundRect(ctx, BX, BY, BOARD, BOARD, 9);
            const tray = ctx.createLinearGradient(0, BY, 0, BY + BOARD);
            tray.addColorStop(0, 'rgba(3,14,40,0.72)');
            tray.addColorStop(1, 'rgba(8,28,70,0.55)');
            ctx.fillStyle = tray;
            ctx.fill();
            ctx.strokeStyle = 'rgba(170,205,255,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
            const geo = this.geometry();
            for (let i = 0; i < geo.n * geo.n; i++) {
                roundRect(ctx, geo.x(i), geo.y(i), geo.tile, geo.tile, geo.tile * 0.11);
                ctx.fillStyle = 'rgba(160,200,255,0.13)';
                ctx.fill();
            }

            const px = Math.max(8, Math.round(geo.tile * st.pixelScale));
            const put = (v, x, y, scale, alpha) => {
                const img = this.tileImage(v, px);
                const s = geo.tile * scale;
                ctx.globalAlpha = alpha;
                ctx.drawImage(img, x + (geo.tile - s) / 2, y + (geo.tile - s) / 2, s, s);
                ctx.globalAlpha = 1;
            };
            const a = this.anim;
            const t = a ? now - a.at : 0;
            if (a && t < SLIDE_MS) {
                // the tiles as they were, on their way
                const u = 1 - Math.pow(1 - t / SLIDE_MS, 2);
                a.r.slides.forEach((s) => {
                    put(s.v, geo.x(s.from) + (geo.x(s.to) - geo.x(s.from)) * u, geo.y(s.from) + (geo.y(s.to) - geo.y(s.from)) * u, 1, 1);
                });
            } else {
                const u = a ? Math.min(1, (t - SLIDE_MS) / POP_MS) : 1;
                const popped = a ? new Set(a.r.merges.map((m) => m.tile.id)) : null;
                const spawnId = a && a.r.spawn ? a.r.spawn.tile.id : 0;
                g.cells.forEach((tile, i) => {
                    if (!tile) return;
                    if (a && tile.id === spawnId) put(tile.v, geo.x(i), geo.y(i), 0.3 + 0.7 * u, u);
                    else if (a && popped.has(tile.id)) put(tile.v, geo.x(i), geo.y(i), 1 + 0.16 * Math.sin(Math.PI * u), 1);
                    else put(tile.v, geo.x(i), geo.y(i), 1, 1);
                });
            }

            if (g.over && !a) {
                const u = this.overAt ? Math.min(1, (now - this.overAt) / 600) : 1;
                roundRect(ctx, BX, BY, BOARD, BOARD, 9);
                ctx.fillStyle = 'rgba(6,20,52,' + (0.62 * u) + ')';
                ctx.fill();
                ctx.globalAlpha = u;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = '600 30px ' + FONT;
                ctx.fillStyle = '#ffffff';
                ctx.fillText(g.won ? STR.gameWon : 'Game Over', BX + BOARD / 2, BY + BOARD / 2);
                ctx.globalAlpha = 1;
            }
        }

        // ---- commands and dialogs ----------------------------------------------------------------
        command(id) {
            switch (id) {
            case CMD.NEW: this.askNewGame(); break;
            case CMD.UNDO: this.undo(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: this.showAbout(); break;
            case CMD.HELP: this.showHelp(); break;
            default: break;
            }
        }

        askNewGame() {
            this.settle();
            if (!this.inProgress()) {
                this.newGame();
                return;
            }
            const won = this.g.won;
            VG.taskDialog({
                owner: this.win,
                title: STR.newGame,
                instruction: STR.newGameAsk,
                links: [VG.linkFromString(won ? STR.quitNewWon : STR.quitNew, 1), VG.linkFromString(STR.keepPlaying, 3)]
            }).then((r) => {
                if (r === 1) {
                    this.record(won);
                    this.newGame();
                }
            });
        }

        requestExit(fromMenu) {
            this.settle();
            if (!this.inProgress()) {
                if (this.g.over) this.newGame(false);
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
                    this.record(this.g.won);
                    store.remove('saved');
                    this.newGame(false);
                    VG.closeWindow(this.win);
                }
            });
            return false;
        }

        saveGame() {
            store.set('saved', { g: this.g });
            this.newGame(false);
        }

        loadSaved(saved) {
            this.g = cloneGame(saved.g);
            this.anim = null;
            this.pending = null;
            this.prev = null;
            this.recorded = false;
            store.remove('saved');
            this.win.stage.invalidate();
        }

        afterOpen() {
            const saved = store.get('saved', null);
            if (!saved || !validGame(saved.g) || saved.g.over) {
                if (saved) store.remove('saved');
                return;
            }
            if (this.inProgress()) return;
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
        }

        showStats() {
            const n = this.g.n;
            const fill = (dlg) => {
                const st = stats();
                const best = st.best[n] || [];
                for (let i = 0; i < 5; i++) {
                    const e = best[i];
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
                dlg.text(1227, fmt(STR.topTile, st.topTile));
                dlg.text(1228, fmt(STR.mostMoves, st.mostMoves));
                dlg.text(1229, fmt(STR.totalJoined, st.joined));
            };
            VG.dialog(this.pack, STATS_TPL, {
                owner: this.win,
                title: fmt(STR.statsTitle, VG.userName()),
                texts: { 1200: fmt(STR.highScores, n) },
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
                                this.win.stage.invalidate();
                            }
                        });
                        return false;
                    }
                    return true;
                }
            });
        }

        showOptions() {
            const s = this.s;
            const sizeIds = { 3: 1104, 4: 1105, 5: 1106 };
            VG.dialog(this.pack, OPTIONS_TPL, {
                owner: this.win,
                init: (dlg) => {
                    dlg.checked(sizeIds[s.size] || 1105, true);
                    dlg.checked(1002, s.animations);
                    dlg.checked(1017, s.sounds);
                    dlg.checked(1018, s.undo);
                    dlg.checked(1020, s.continueSaved);
                    dlg.checked(1044, s.saveOnExit);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return id === 2;
                    const next = Object.assign({}, s);
                    next.size = dlg.checked(1104) ? 3 : (dlg.checked(1106) ? 5 : 4);
                    next.animations = dlg.checked(1002);
                    next.sounds = dlg.checked(1017);
                    next.undo = dlg.checked(1018);
                    next.continueSaved = dlg.checked(1020);
                    next.saveOnExit = dlg.checked(1044);
                    this.applySettings(next, next.size !== s.size);
                    return true;
                }
            });
        }

        applySettings(next, gameChanged) {
            this.s = next;
            saveSettings(next);
            this.setSound(next.sounds);
            if (!next.undo) this.prev = null;
            if (!next.animations) this.settle();
            this.win.stage.invalidate();
            if (!gameChanged) return;
            if (!this.inProgress()) {
                this.newGame(false);
                return;
            }
            const won = this.g.won;
            VG.taskDialog({
                owner: this.win,
                title: STR.changed,
                instruction: STR.changedAsk,
                links: [VG.linkFromString(won ? STR.quitNewWon : STR.changedQuit, 1), VG.linkFromString(STR.changedFinish, 2)]
            }).then((r) => {
                if (r === 1) {
                    this.record(won);
                    this.newGame();
                }
            });
        }

        showHelp() {
            VG.taskDialog({
                owner: this.win,
                title: DISPLAY_NAME,
                instruction: STR.howTo,
                content: fmt(STR.howToText, this.g.goal),
                buttons: [{ id: 1, text: STR.ok, default: true }],
                width: 420
            });
        }

        showAbout() {
            VG.aboutBox({ owner: this.win, title: DISPLAY_NAME, text: DISPLAY_NAME + ' developed by ' + DEVELOPER, copyright: COPYRIGHT, icon: ICON + '-48.png' });
        }

        showResult(won, high) {
            const g = this.g;
            const st = stats();
            const best = (st.best[g.n] || [])[0];
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            VG.dialog(this.pack, resultTemplate(won, g.goal), {
                owner: this.win,
                texts: {
                    1301: fmt(STR.score, g.score),
                    1302: fmt(STR.highScore, best ? best.score : g.score),
                    1303: fmt(STR.tile, g.top),
                    1304: fmt(STR.moves, g.moves),
                    1305: fmt(STR.played, st.played),
                    1306: fmt(STR.date, VG.formatDate(best ? best.date : Date.now())),
                    1307: fmt(STR.gamesWon, st.won),
                    1308: fmt(STR.winPct, pct)
                },
                init: (dlg) => {
                    dlg.show(1309, !!high);
                },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1004) {
                        this.newGame(false);
                        VG.closeWindow(this.win);
                    } else this.newGame();
                }
            });
        }
    }

    function open() {
        if (!game) game = new Doubles();
        const first = !game.win.isOpen();
        game.setSound(game.s.sounds);
        game.win.open();
        if (first) {
            game.sounds.forEach((s) => s.warm());
            game.afterOpen();
        }
        return Promise.resolve(game);
    }

    VG.register({
        id: GAME_ID,
        name: DISPLAY_NAME,
        icon: ICON,
        thumbnail: '/static_images/vista-games/doubles/images/thumbnail.png',
        feature: 'vista_' + GAME_ID,
        open
    });
    root.openVistaDoubles = open;
    root.vistaDoubles = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
