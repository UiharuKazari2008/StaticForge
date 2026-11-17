/**
 * Melaton Mobile: Doubles (Yozora #836), the desktop's slide-and-join number puzzle
 * (public/scripts/comp/desktop-apps/vista-games/doubles.js; Academy City Research P.S.R.) drawn as a
 * phone program with the desktop game's own look: slabs of coloured glass on a frosted tray over a
 * table of blue light (soft keys New Game | Menu; the form pages are the shell's).
 *
 * Play: flick the board (or press the d-pad) to slide every tile that way. Two tiles of the same
 * number that meet join into one of twice the number, which is added to the score; each move puts a
 * new 2 or 4 on an empty square. Make the goal tile (2048 on the standard board, 256 on the small one,
 * 4096 on the large one) to win, then play on for score; with the board full and no two neighbours
 * alike the game is over. Menu > Undo takes back the last move, once.
 * Options: board size, sounds, undo, confirm end game. Statistics: five high scores a board size,
 * games played and won, the largest tile.
 * Settings, statistics and the game in progress: localStorage wmGame:doubles.
 * Only on phones. Styles: public/css/wm-doubles.css.
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'doubles';
    const TITLE = 'Doubles';
    const DEVELOPER = 'Academy City Research P.S.R.';
    const KEY = 'wmGame:doubles';
    const SLIDE_MS = 110;
    const POP_MS = 150;
    const BURST_MS = 460;
    const SIZE_NAMES = { 3: 'Small (3 x 3)', 4: 'Standard (4 x 4)', 5: 'Large (5 x 5)' };

    // ---- rules: copied from desktop-apps/vista-games/doubles.js (keep them in step) ----
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


    function validGame(g) {
        return !!g && SIZES.indexOf(g.n) >= 0 && Array.isArray(g.cells) && g.cells.length === g.n * g.n
            && g.cells.every((t) => t === null || (t && t.v >= 2 && Number.isInteger(Math.log2(t.v))));
    }

    // ---------------------------------------------------------------- state

    let ws = null;
    let page = null;
    let cv = null;
    let ctx = null;
    let view = 'main';
    let draft = null;
    let G = null; // the game (rules state)
    let prev = null; // the game before the last move (Undo)
    let recorded = false;
    let L = null; // layout
    let raf = 0;
    let anim = null; // { at, r } while tiles move
    let cut = null; // a move that ends the game or makes the goal, its animation cut by hide(): its end comes on show
    let fx = []; // the light of joins in flight: { cell, at, color, big }
    let press = null;
    let audio = null;
    let busyBox = false; // a message box is up
    const sprites = new Map();

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ---------------------------------------------------------------- storage

    const DEFAULTS = { size: 4, sounds: true, undo: true, confirmEnd: true };
    function store() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
    function storePut(patch) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(store(), patch))); } catch (_) { /* private mode */ } }
    function settings() { const s = Object.assign({}, DEFAULTS, store().settings || {}); if (SIZES.indexOf(s.size) < 0) s.size = 4; return s; }
    function blankStats() { return { best: { 3: [], 4: [], 5: [] }, played: 0, won: 0, topTile: 0, joined: 0 }; }
    function stats() { const s = Object.assign(blankStats(), store().stats || {}); s.best = Object.assign(blankStats().best, s.best || {}); return s; }

    function save() {
        if (!G) return;
        storePut({ saved: G.over || recorded ? undefined : { g: G } });
    }

    function restore() {
        const s = store().saved;
        if (!s || !validGame(s.g) || s.g.over) return false;
        G = JSON.parse(JSON.stringify(s.g));
        prev = null;
        recorded = false;
        return true;
    }

    // ---------------------------------------------------------------- the game

    function newGame() {
        G = createGame(settings().size, Math.random);
        prev = null;
        anim = null;
        recorded = false;
        save();
        renderStatus();
        if (L && L.n !== G.n) layout(); else draw();
        if (ws) ws.refreshSoftKeys();
    }

    const inProgress = () => !!G && G.moves > 0 && !G.over && !recorded;

    /** The game goes into the statistics once; true when its score is the board's new best. */
    function record() {
        if (recorded || !G) return false;
        recorded = true;
        const st = stats();
        st.played += 1;
        if (G.won) st.won += 1;
        st.topTile = Math.max(st.topTile, G.top);
        st.joined += G.joined;
        let high = false;
        if (G.score > 0) {
            const list = st.best[G.n] || [];
            const entry = { score: G.score, tile: G.top, date: Date.now() };
            list.push(entry);
            list.sort((a, b) => b.score - a.score || a.date - b.date);
            st.best[G.n] = list.slice(0, 5);
            high = st.best[G.n][0] === entry;
        }
        storePut({ stats: st });
        return high;
    }

    function bestScore() {
        const list = stats().best[G.n] || [];
        return Math.max(list.length ? list[0].score : 0, G.score);
    }

    function settle() {
        if (!anim) { endCut(); return; }
        const r = anim.r;
        anim = null;
        afterMove(r);
    }

    /**
     * A move whose animation hide() cut (the screen went off mid-slide): what it ends with (Game Over,
     * the goal's question) comes now, the game on screen again.
     */
    function endCut() {
        if (!cut || busyBox) return;
        const r = cut;
        cut = null;
        afterMove(r);
    }

    function tryMove(dir) {
        if (!G || G.over || busyBox || view !== 'main') return;
        settle();
        if (G.over || busyBox) return;
        const before = settings().undo ? JSON.parse(JSON.stringify(G)) : null;
        const r = move(G, dir, Math.random);
        if (!r) { sound('no'); return; }
        prev = before;
        sound(r.merges.length ? 'join' : 'slide', r.merges.reduce((m, x) => Math.max(m, x.tile.v), 0));
        save();
        renderStatus();
        anim = { at: performance.now(), r };
        r.merges.forEach((m) => fx.push({ cell: m.at, at: anim.at + SLIDE_MS, color: tileColors(m.tile.v)[0], big: m.tile.v >= G.goal }));
        loop();
        ws.refreshSoftKeys();
    }

    async function afterMove(r) {
        draw();
        if (r.over) {
            prev = null;
            const won = G.won;
            // (a game hide() already put into the statistics keeps the high score it made there)
            const high = record() || r.high === true;
            save();
            sound(won ? 'win' : 'over');
            busyBox = true;
            const yes = await ws.messageBox({
                title: 'Game Over', icon: 'info', modal: true, cancelValue: false,
                text: `${won ? `No more moves. You made the ${G.goal} tile: you won!` : 'There are no more moves.'}\n\nScore: ${G.score}\nLargest tile: ${G.top}${high ? '\nNew high score!' : ''}\n\nDo you want to play again?`,
                buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }]
            });
            busyBox = false;
            if (yes) newGame();
            else if (ws) ws.refreshSoftKeys();
        } else if (r.reached) {
            sound('win');
            busyBox = true;
            const keep = await ws.messageBox({
                title: TITLE, icon: 'info', modal: true, cancelValue: true,
                text: `Congratulations, you made the ${G.goal} tile!\n\nDo you want to keep playing for a higher score?`,
                buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }]
            });
            busyBox = false;
            if (!keep) { record(); newGame(); }
        }
    }

    function undo() {
        if (!prev || !G || G.over) return;
        settle();
        if (!prev) return;
        G = prev;
        prev = null;
        sound('undo');
        save();
        renderStatus();
        draw();
        ws.refreshSoftKeys();
    }

    async function askNewGame() {
        settle();
        if (inProgress() && settings().confirmEnd) {
            busyBox = true;
            const yes = await ws.messageBox({
                title: 'New Game?', text: 'Do you really want to begin a new game?', icon: 'question', modal: true, cancelValue: false,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            busyBox = false;
            if (!yes) return;
        }
        if (inProgress()) record();
        newGame();
    }

    // ---------------------------------------------------------------- sound

    function sound(kind, v) {
        if (!settings().sounds) return;
        try {
            if (ws.sounds && typeof ws.sounds.silent === 'function' && ws.sounds.silent()) return;
            if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === 'suspended') audio.resume();
            const tone = (f, t, d, type = 'square', vol = 0.05) => {
                const o = audio.createOscillator();
                const g = audio.createGain();
                o.type = type; o.frequency.value = f;
                g.gain.setValueAtTime(vol, audio.currentTime + t);
                g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + d);
                o.connect(g).connect(audio.destination);
                o.start(audio.currentTime + t); o.stop(audio.currentTime + t + d + 0.02);
            };
            if (kind === 'slide') tone(300, 0, 0.04, 'triangle', 0.06);
            // a join rings higher the larger the tile it makes
            else if (kind === 'join') tone(330 * Math.pow(1.122, Math.min(14, Math.log2(v || 4))), 0, 0.09);
            else if (kind === 'no') tone(180, 0, 0.1, 'sawtooth', 0.04);
            else if (kind === 'undo') { tone(520, 0, 0.05, 'triangle', 0.06); tone(390, 0.06, 0.07, 'triangle', 0.06); }
            else if (kind === 'win') { tone(660, 0, 0.08); tone(880, 0.09, 0.08); tone(1320, 0.18, 0.16); }
            else if (kind === 'over') { tone(440, 0, 0.12, 'triangle', 0.08); tone(330, 0.13, 0.2, 'triangle', 0.08); }
        } catch (_) { /* no audio */ }
    }

    // ---------------------------------------------------------------- drawing
    //
    // The desktop game's glass (desktop-apps/vista-games/doubles.js, its look block copied here):
    // slabs of coloured glass on a frosted tray over a table of blue light. What stays put is painted
    // once per size (a layer); each tile value once per size (a sprite); a frame is blits.

    const FONT = 'Tahoma, "Segoe UI", Verdana, sans-serif';
    // slabs of coloured glass: [top, bottom, edge, text], by power of two
    const TILE_COLORS = [
        ['#f8fbff', '#c9dcf2', '#7f9cc0', '#1e3a5f'], // 2
        ['#d6eaff', '#93bfee', '#5a8cc4', '#1e3a5f'], // 4
        ['#86d8fb', '#2b97d8', '#17639a', '#ffffff'], // 8
        ['#5cdcd2', '#12908f', '#086262', '#ffffff'], // 16
        ['#7fe08a', '#23933b', '#126626', '#ffffff'], // 32
        ['#c8e85c', '#76a312', '#4d7206', '#ffffff'], // 64
        ['#ffe066', '#dc9a08', '#9a6a02', '#ffffff'], // 128
        ['#ffb655', '#de6a06', '#9a4400', '#ffffff'], // 256
        ['#ff8470', '#cf2e1e', '#8e1a0c', '#ffffff'], // 512
        ['#f777b6', '#b81e69', '#7c0e44', '#ffffff'], // 1024
        ['#b995fa', '#6234c4', '#3c1a88', '#ffffff'], // 2048
        ['#66768e', '#1b2330', '#080b12', '#ffd866']  // 4096 and up
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

    // a four-point glint
    function glint(ctx, x, y, r) {
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y);
        ctx.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
        ctx.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y);
        ctx.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r);
        ctx.closePath();
        ctx.fill();
    }

    // One tile, painted s px square (device pixels): a slab of thick coloured glass. Light comes
    // through it from below, the upper half carries the room's reflection, a bright spot sits at
    // the top left, and a rim of light runs round the inside of its edge.
    function paintTile(ctx, s, v, goal) {
        const [top, bottom, edge, text] = tileColors(v);
        const r = s * 0.15;
        const u = Math.max(1, s * 0.012);
        ctx.clearRect(0, 0, s, s);
        roundRect(ctx, 0, 0, s, s, r);
        ctx.fillStyle = edge;
        ctx.fill();
        roundRect(ctx, u, u, s - u * 2, s - u * 2, r - u);
        const body = ctx.createLinearGradient(0, 0, 0, s);
        body.addColorStop(0, top);
        body.addColorStop(0.5, bottom);
        body.addColorStop(1, edge);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.save();
        roundRect(ctx, u, u, s - u * 2, s - u * 2, r - u);
        ctx.clip();
        // light through the glass, pooling at the bottom
        const through = ctx.createRadialGradient(s * 0.5, s * 1.08, s * 0.05, s * 0.5, s * 1.08, s * 0.8);
        through.addColorStop(0, 'rgba(255,255,255,0.62)');
        through.addColorStop(0.45, 'rgba(255,255,255,0.2)');
        through.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = through;
        ctx.fillRect(0, 0, s, s);
        // the reflection: the upper part, ending in a curve
        const gloss = ctx.createLinearGradient(0, 0, 0, s * 0.56);
        gloss.addColorStop(0, 'rgba(255,255,255,0.74)');
        gloss.addColorStop(0.6, 'rgba(255,255,255,0.2)');
        gloss.addColorStop(1, 'rgba(255,255,255,0.06)');
        ctx.fillStyle = gloss;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(s, 0);
        ctx.lineTo(s, s * 0.36);
        ctx.quadraticCurveTo(s * 0.5, s * 0.6, 0, s * 0.42);
        ctx.closePath();
        ctx.fill();
        // the bright spot
        const spot = ctx.createRadialGradient(s * 0.26, s * 0.2, 0, s * 0.26, s * 0.2, s * 0.26);
        spot.addColorStop(0, 'rgba(255,255,255,0.7)');
        spot.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = spot;
        ctx.fillRect(0, 0, s * 0.6, s * 0.5);
        ctx.restore();
        // the rim of light inside the edge: bright along the top, faint at the foot
        roundRect(ctx, u * 1.8, u * 1.8, s - u * 3.6, s - u * 3.6, r - u * 1.8);
        const rim = ctx.createLinearGradient(0, 0, 0, s);
        rim.addColorStop(0, 'rgba(255,255,255,0.95)');
        rim.addColorStop(0.5, 'rgba(255,255,255,0.3)');
        rim.addColorStop(1, 'rgba(255,255,255,0.5)');
        ctx.strokeStyle = rim;
        ctx.lineWidth = u * 1.2;
        ctx.stroke();
        if (v >= goal) {
            // the goal and beyond: a band of gold, and two glints
            roundRect(ctx, u * 4, u * 4, s - u * 8, s - u * 8, r - u * 3.5);
            ctx.strokeStyle = 'rgba(255,220,110,0.95)';
            ctx.lineWidth = u * 2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            glint(ctx, s * 0.84, s * 0.17, s * 0.09);
            glint(ctx, s * 0.15, s * 0.82, s * 0.05);
        }
        // the number, cut into the glass
        const label = String(v);
        const size = s * (label.length <= 2 ? 0.48 : label.length === 3 ? 0.39 : label.length === 4 ? 0.31 : 0.25);
        ctx.font = '700 ' + size + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const dark = text === '#1e3a5f';
        ctx.save();
        ctx.shadowColor = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = dark ? 0 : s * 0.07;
        ctx.shadowOffsetY = Math.max(1, s * 0.016);
        ctx.fillStyle = text;
        ctx.fillText(label, s / 2, s * 0.53);
        ctx.restore();
    }

    // the soft shadow a tile throws on the tray (s px across; the tile sits in its middle 10/13)
    function paintShadow(ctx, s) {
        const t = s / 1.3;
        const o = (s - t) / 2;
        ctx.clearRect(0, 0, s, s);
        ctx.save();
        ctx.shadowColor = 'rgba(0,6,24,0.6)';
        ctx.shadowBlur = t * 0.1;
        ctx.shadowOffsetY = t * 0.045;
        roundRect(ctx, o + t * 0.04, o + t * 0.04, t * 0.92, t * 0.92, t * 0.14);
        ctx.fillStyle = 'rgba(0,6,24,0.55)';
        ctx.fill();
        ctx.restore();
    }

    // The table the glass lies on: deep blue with pools of coloured light, soft discs out of focus,
    // shafts of light across it and darker corners. w x h px; seed fixes where the discs fall.
    function paintBackdrop(ctx, w, h) {
        const base = ctx.createLinearGradient(0, 0, w * 0.3, h);
        base.addColorStop(0, '#16407f');
        base.addColorStop(0.5, '#0c2a66');
        base.addColorStop(1, '#061236');
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const pool = (x, y, r, c) => {
            const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w);
            g.addColorStop(0, c);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        };
        pool(0.12, 0.02, 0.85, 'rgba(96,170,255,0.55)');
        pool(0.95, 0.3, 0.6, 'rgba(60,220,200,0.2)');
        pool(0.25, 0.95, 0.7, 'rgba(120,90,255,0.24)');
        pool(0.8, 1.02, 0.55, 'rgba(40,150,255,0.26)');
        const rnd = mulberry32(2048);
        for (let i = 0; i < 16; i++) {
            const x = rnd() * w;
            const y = rnd() * h;
            const r = (0.03 + rnd() * 0.07) * w;
            const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
            const a = 0.05 + rnd() * 0.07;
            g.addColorStop(0, 'rgba(170,215,255,' + a + ')');
            g.addColorStop(0.9, 'rgba(170,215,255,' + a * 1.3 + ')');
            g.addColorStop(1, 'rgba(170,215,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        for (let i = 0; i < 3; i++) {
            const x = (0.1 + i * 0.3) * w;
            const g = ctx.createLinearGradient(x, 0, x + w * 0.22, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(0.5, 'rgba(255,255,255,0.06)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + w * 0.22, 0);
            ctx.lineTo(x + w * 0.22 - h * 0.45, h);
            ctx.lineTo(x - h * 0.45, h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        const dim = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
        dim.addColorStop(0, 'rgba(0,0,0,0)');
        dim.addColorStop(1, 'rgba(0,4,20,0.5)');
        ctx.fillStyle = dim;
        ctx.fillRect(0, 0, w, h);
    }

    // A pane of frosted glass (the tray, the score panels): x, y, w, h, corner r, in the context's units
    function paintPane(ctx, x, y, w, h, r, px) {
        roundRect(ctx, x, y, w, h, r);
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(255,255,255,0.2)');
        g.addColorStop(0.12, 'rgba(255,255,255,0.08)');
        g.addColorStop(1, 'rgba(255,255,255,0.04)');
        ctx.fillStyle = 'rgba(4,14,44,0.42)';
        ctx.fill();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,225,255,0.55)';
        ctx.lineWidth = px;
        ctx.stroke();
        // the light caught along its top edge
        ctx.save();
        roundRect(ctx, x, y, w, h, r);
        ctx.clip();
        const edge = ctx.createLinearGradient(0, y, 0, y + Math.min(h * 0.5, 26 * px));
        edge.addColorStop(0, 'rgba(255,255,255,0.22)');
        edge.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = edge;
        ctx.fillRect(x, y, w, h * 0.5);
        ctx.restore();
    }

    // a square of the tray where a tile can lie: sunk, darker, a line of light along its foot
    function paintWell(ctx, x, y, s) {
        const r = s * 0.15;
        roundRect(ctx, x, y, s, s, r);
        const g = ctx.createLinearGradient(0, y, 0, y + s);
        g.addColorStop(0, 'rgba(0,6,30,0.5)');
        g.addColorStop(0.25, 'rgba(6,20,60,0.3)');
        g.addColorStop(1, 'rgba(40,80,160,0.2)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(0,4,20,0.5)';
        ctx.lineWidth = s * 0.04;
        roundRect(ctx, x, y + s * 0.015, s, s, r);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = 'rgba(190,220,255,0.16)';
        ctx.lineWidth = Math.max(1, s * 0.012);
        ctx.beginPath();
        ctx.moveTo(x + r, y + s);
        ctx.lineTo(x + s - r, y + s);
        ctx.stroke();
    }

    // A join: a ring of light opening from the tile and eight glints thrown outward. u 0..1 through
    // its life; x, y the tile's middle, s the tile's size, color the new tile's light tone.
    function paintBurst(ctx, x, y, s, u, color) {
        const out = 1 - Math.pow(1 - u, 2);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, 1 - u) * 0.8;
        ctx.strokeStyle = color;
        ctx.lineWidth = s * 0.07 * (1 - u) + 1;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.5 + out * 0.42), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4 + 0.4;
            const d = s * (0.5 + out * 0.55);
            glint(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.085 * (1 - u) + 0.5);
        }
        ctx.restore();
    }

    function sprite(key, size, paint) {
        let c = sprites.get(key);
        if (c) return c;
        if (sprites.size > 60) sprites.clear();
        c = document.createElement('canvas');
        c.width = c.height = size;
        paint(c.getContext('2d'), size);
        sprites.set(key, c);
        return c;
    }

    const tileSprite = (v) => sprite(`${v}@${L.tilePx}/${G.goal}`, L.tilePx, (x, s) => paintTile(x, s, v, G.goal));
    const shadowSprite = () => sprite(`shadow@${L.tilePx}`, Math.round(L.tilePx * 1.3), (x, s) => paintShadow(x, s));

    let layer = null;
    let layerKey = '';

    /** The table, the tray and its wells for this size of screen and board. */
    function staticLayer() {
        const key = `${cv.width}x${cv.height}/${L.n}/${L.ox}/${L.oy}`;
        if (layer && layerKey === key) return layer;
        layer = layer || document.createElement('canvas');
        layer.width = cv.width;
        layer.height = cv.height;
        const x = layer.getContext('2d');
        paintBackdrop(x, layer.width, layer.height);
        paintPane(x, L.ox, L.oy, L.boardPx, L.boardPx, L.tilePx * 0.16, Math.max(1, L.dpr * 0.5));
        for (let i = 0; i < L.n * L.n; i++) paintWell(x, cellX(i), cellY(i), L.tilePx);
        layerKey = key;
        return layer;
    }

    function layout() {
        if (!cv || !G) return;
        const box = cv.parentElement;
        const w = Math.max(1, box.clientWidth);
        const h = Math.max(1, box.clientHeight);
        if (w < 8 || h < 8) return;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const unit = parseFloat(getComputedStyle(page.querySelector('.wdb-probe')).width) / 100 || 1;
        const n = G.n;
        const margin = Math.round(6 * unit);
        const side = Math.max(16, Math.min(w, h) - margin * 2);
        // everything on whole device pixels
        const gapPx = Math.max(2, Math.round((n === 5 ? 3 : 4) * unit * dpr));
        const tilePx = Math.floor((side * dpr - gapPx * (n + 1)) / n);
        const boardPx = tilePx * n + gapPx * (n + 1);
        L = {
            n, dpr, unit, w, h, gapPx, tilePx, boardPx,
            ox: Math.round((w * dpr - boardPx) / 2),
            oy: Math.round(Math.min((h * dpr - boardPx) / 2, margin * dpr * 2 + (h * dpr - boardPx) * 0.25))
        };
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
            cv.width = Math.round(w * dpr);
            cv.height = Math.round(h * dpr);
        }
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        draw();
    }

    const cellX = (i) => L.ox + L.gapPx + (i % L.n) * (L.tilePx + L.gapPx);
    const cellY = (i) => L.oy + L.gapPx + Math.floor(i / L.n) * (L.tilePx + L.gapPx);

    function draw() {
        if (!ctx || !L || !G || L.n !== G.n) return;
        const now = performance.now();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(staticLayer(), 0, 0);
        const shadow = shadowSprite();
        const put = (v, x, y, scale, alpha) => {
            const s = Math.round(L.tilePx * scale);
            const o = Math.round((L.tilePx - s) / 2);
            ctx.globalAlpha = alpha;
            if (alpha > 0.5) ctx.drawImage(shadow, Math.round(x + o - s * 0.15), Math.round(y + o - s * 0.15), Math.round(s * 1.3), Math.round(s * 1.3));
            ctx.drawImage(tileSprite(v), Math.round(x) + o, Math.round(y) + o, s, s);
            ctx.globalAlpha = 1;
        };
        const t = anim ? now - anim.at : 0;
        if (anim && t < SLIDE_MS) {
            // the tiles as they were, on their way, each trailing a little of itself
            const k = 1 - Math.pow(1 - t / SLIDE_MS, 2);
            const at = (s, u) => [cellX(s.from) + (cellX(s.to) - cellX(s.from)) * u, cellY(s.from) + (cellY(s.to) - cellY(s.from)) * u];
            anim.r.slides.forEach((s) => {
                if (s.from === s.to) return;
                [[0.3, 0.14], [0.15, 0.26]].forEach(([back, alpha]) => { const p = at(s, Math.max(0, k - back)); put(s.v, p[0], p[1], 1, alpha); });
            });
            anim.r.slides.forEach((s) => { const p = at(s, k); put(s.v, p[0], p[1], 1, 1); });
        } else {
            const k = anim ? Math.min(1, (t - SLIDE_MS) / POP_MS) : 1;
            const popped = anim ? new Set(anim.r.merges.map((m) => m.tile.id)) : null;
            const spawnId = anim && anim.r.spawn ? anim.r.spawn.tile.id : 0;
            G.cells.forEach((tile, i) => {
                if (!tile) return;
                if (anim && tile.id === spawnId) put(tile.v, cellX(i), cellY(i), 0.3 + 0.7 * k, k);
                else if (anim && popped.has(tile.id)) put(tile.v, cellX(i), cellY(i), 1 + 0.14 * Math.sin(Math.PI * k), 1);
                else put(tile.v, cellX(i), cellY(i), 1, 1);
            });
        }
        // the light a join throws
        fx.forEach((f) => {
            const u = (now - f.at) / BURST_MS;
            if (u < 0 || u >= 1) return;
            paintBurst(ctx, cellX(f.cell) + L.tilePx / 2, cellY(f.cell) + L.tilePx / 2, L.tilePx * (f.big ? 1.25 : 1), u, f.color);
        });
    }

    function loop() {
        if (raf) return;
        const step = () => {
            raf = 0;
            const now = performance.now();
            if (anim && now - anim.at >= SLIDE_MS + POP_MS) settle();
            fx = fx.filter((f) => now - f.at < BURST_MS);
            draw();
            if (anim || fx.length) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    }

    function renderStatus() {
        if (!page || !G) return;
        const set = (k, v) => { const el = page.querySelector(`.wdb-status [data-v="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = v; };
        set('score', G.score);
        set('best', bestScore());
        set('goal', G.goal);
    }

    // ---------------------------------------------------------------- input

    function onDown(e) {
        if (!G || view !== 'main') return;
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        press = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }

    function onMove(e) {
        if (!press || e.pointerId !== press.id || !L) return;
        const dx = e.clientX - press.x;
        const dy = e.clientY - press.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < Math.max(14, L.tilePx / L.dpr * 0.3)) return;
        press = null;
        tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }

    function onUp(e) { if (press && e.pointerId === press.id) press = null; }

    function onKey(e) {
        if (!page || page.hidden || view !== 'main' || !G || ws.current !== APP_ID) return;
        if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
        const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
        if (!dirs[e.key]) return;
        e.preventDefault();
        tryMove(dirs[e.key]);
    }

    // ---------------------------------------------------------------- pages

    function showView(v) {
        view = v;
        page.dataset.view = v;
        page.querySelectorAll('.wdb-view').forEach((el) => { el.hidden = el.dataset.view !== v; });
        if (v === 'options') renderOptions();
        if (v === 'stats') renderStats();
        if (v === 'about') renderAbout();
        if (v === 'main') requestAnimationFrame(() => { layout(); renderStatus(); endCut(); });
        ws.refreshTitleAction();
        ws.refreshSoftKeys();
    }

    function openPage(v) {
        settle();
        if (v === 'options') draft = settings();
        showView(v);
        ws.syncHistory();
    }

    function renderOptions() {
        const d = draft;
        const box = page.querySelector('.wdb-view[data-view="options"]');
        const check = (k, label) => `<label class="wm-check"><input type="checkbox" data-opt="${k}"${d[k] ? ' checked' : ''}><span>${esc(label)}</span></label>`;
        box.innerHTML = '<div class="wm-form-hdr">Options</div><div class="wm-set-scroll"><div class="wm-form wdb-form">'
            + `<div class="wm-form-row is-wide"><span class="wm-form-label">Board:</span><button type="button" class="wm-combo" data-act="size"><span>${SIZE_NAMES[d.size]}</span></button></div>`
            + `<div class="wdb-checks">${check('sounds', 'Play sounds')}${check('undo', 'Allow undo')}${check('confirmEnd', 'Confirm end game')}</div>`
            + '</div></div>';
        box.querySelectorAll('[data-opt]').forEach((el) => el.addEventListener('change', () => { d[el.dataset.opt] = el.checked; }));
        box.querySelector('.wm-combo').addEventListener('click', (e) => {
            e.stopPropagation();
            ws.dropdown(e.currentTarget, SIZES.map((n) => ({ label: SIZE_NAMES[n], radio: d.size === n, action: () => { d.size = n; renderOptions(); } })), 'left');
        });
    }

    function commitOptions() {
        if (!draft) return;
        const sizeChanged = draft.size !== settings().size;
        storePut({ settings: draft });
        if (!draft.undo) prev = null;
        draft = null;
        // a new board size starts a new game
        if (sizeChanged) {
            if (inProgress()) record();
            newGame();
        }
    }

    function dateText(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`; }

    function renderStats() {
        const st = stats();
        const box = page.querySelector('.wdb-view[data-view="stats"]');
        const n = (G && G.n) || settings().size;
        const best = [0, 1, 2, 3, 4].map((i) => (st.best[n] || [])[i]);
        const rows = [['Games played', st.played], ['Games won', st.won], ['Largest tile', st.topTile || '-'], ['Tiles joined', st.joined]];
        box.innerHTML = '<div class="wm-form-hdr">Statistics</div><div class="wm-set-scroll"><div class="wdb-stats">'
            + `<p class="wdb-stats-type">High scores (${n} x ${n}):</p>`
            + '<table class="wdb-high"><thead><tr><th class="is-rank"></th><th>Score</th><th>Tile</th><th>Date</th></tr></thead><tbody>'
            + best.map((b, i) => `<tr><td class="is-rank">${i + 1}.</td><td>${b ? b.score : '-'}</td><td>${b ? b.tile : '-'}</td><td>${b ? dateText(b.date) : '-'}</td></tr>`).join('')
            + '</tbody></table>'
            + `<table class="wdb-totals"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
            + '<div class="wdb-reset"><button type="button" class="wm-button" data-act="reset">Reset</button></div>'
            + '</div></div>';
        box.querySelector('[data-act="reset"]').addEventListener('click', async () => {
            const yes = await ws.messageBox({
                title: 'Reset Statistics', text: 'Do you want to reset all statistics?', icon: 'question', modal: true, cancelValue: false,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            if (yes) { storePut({ stats: blankStats() }); renderStats(); }
        });
    }

    function renderAbout() {
        const box = page.querySelector('.wdb-view[data-view="about"]');
        box.innerHTML = '<div class="wm-set-scroll"><div class="wdb-about"><canvas class="wdb-logo" aria-hidden="true"></canvas>'
            + `<p>${esc(TITLE)}&trade;</p><p>Designed for Melaton Mobile&trade;</p><p>by ${esc(DEVELOPER)}</p>`
            + '<p class="wdb-copy">Copyright &copy; 2026 Xyridian Corporation. All rights reserved.</p></div></div>';
        requestAnimationFrame(() => {
            const lc = box.querySelector('.wdb-logo');
            const css = lc && lc.clientWidth;
            if (!css || !L) return;
            const dpr = window.devicePixelRatio || 1;
            lc.width = lc.height = Math.round(css * dpr);
            const c = lc.getContext('2d');
            const s = Math.floor(lc.width / 2);
            [[2, 0, 0], [8, s, 0], [32, 0, s], [128, s, s]].forEach(([v, x, y]) => c.drawImage(tileSprite(v), x + 2, y + 2, s - 4, s - 4));
        });
    }

    function backToGame(apply) {
        if (view === 'options' && apply) commitOptions();
        draft = null;
        showView('main');
        ws.syncHistory();
        return true;
    }

    // ---------------------------------------------------------------- app

    function mount(p) {
        page = p;
        p.classList.add('wm-doubles');
        p.dataset.view = 'main';
        p.innerHTML = '<div class="wdb-probe" aria-hidden="true"></div>'
            + '<div class="wdb-view" data-view="main">'
            + '<div class="wdb-status"><span><b>Score:</b> <i data-v="score">0</i></span><span><b>Best:</b> <i data-v="best">0</i></span><span><b>Goal:</b> <i data-v="goal">2048</i></span></div>'
            + `<div class="wdb-field" data-wm-no-hold><canvas aria-label="${esc(TITLE)}"></canvas></div></div>`
            + '<div class="wdb-view" data-view="options" hidden></div><div class="wdb-view" data-view="stats" hidden></div><div class="wdb-view" data-view="about" hidden></div>';
        cv = p.querySelector('.wdb-field canvas');
        ctx = cv.getContext('2d');
        cv.addEventListener('pointerdown', onDown);
        cv.addEventListener('pointermove', onMove);
        cv.addEventListener('pointerup', onUp);
        cv.addEventListener('pointercancel', () => { press = null; });
        cv.addEventListener('contextmenu', (e) => e.preventDefault());
        if (window.ResizeObserver) new ResizeObserver(() => { if (view === 'main') layout(); }).observe(cv.parentElement);
        if (!(G && !G.over) && !restore()) newGame();
        renderStatus();
        layout();
    }

    function show() {
        if (view === 'main') requestAnimationFrame(() => { sprites.clear(); layout(); renderStatus(); endCut(); });
    }

    function hide() {
        // an animation in flight ends at once (a game that just ended still goes into the statistics;
        // its board is there, finished, on the way back, with its Game Over or goal box: endCut)
        if (anim) {
            const r = anim.r;
            anim = null;
            if (r.over) r.high = record();
            if (r.over || r.reached) cut = r;
        }
        fx = [];
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        save();
    }

    function softKeys() {
        if (view !== 'main') return { left: null, right: null };
        return {
            left: { label: 'New Game', action: askNewGame },
            right: {
                label: 'Menu',
                menu: () => [
                    { label: 'Undo', disabled: !prev || !G || G.over || !settings().undo, action: undo },
                    '-',
                    { label: 'Options...', action: () => openPage('options') },
                    { label: 'Statistics', action: () => openPage('stats') },
                    '-',
                    { label: 'About', action: () => openPage('about') }
                ]
            }
        };
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: 'app-doubles',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show,
            hide,
            titleKind: () => (view === 'main' ? 'close' : 'ok'),
            onTitleOk: () => (view === 'main' ? false : backToGame(true)),
            historyDepth: () => (view === 'main' ? 0 : 1),
            onBack: () => (view === 'main' ? false : backToGame(view !== 'options')),
            onEnd() { hide(); cut = null; view = 'main'; page = null; cv = null; ctx = null; L = null; },
            softKeys
        });
        document.addEventListener('keydown', onKey);
        // not seen (the page hidden, the screen off - the page is not hidden then -, behind an Android
        // program): what moves ends and the game is kept. Seen again in front: the board drawn as it is
        // now (a slide the screen cut stopped mid-way on the canvas) and the end of that move (show)
        const away = () => document.hidden || document.documentElement.dataset.screenOff !== undefined || document.documentElement.dataset.wmBehind !== undefined;
        let wasAway = false;
        const onSeen = () => {
            if (away()) { if (page) { hide(); wasAway = true; } return; }
            if (!wasAway) return;
            wasAway = false;
            if (page && !page.hidden && ws.current === APP_ID) show();
        };
        document.addEventListener('visibilitychange', onSeen, { signal: appScopeSignal });
        window.addEventListener('melatonscreen', onSeen, { signal: appScopeSignal });
        document.addEventListener('wmBehind', onSeen, { signal: appScopeSignal });
    }

    // tests
    window.wmDoubles = { createGame, move, canMove, get game() { return G; }, set game(g) { G = g; prev = null; recorded = false; renderStatus(); layout(); }, newGame, tryMove, undo };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
