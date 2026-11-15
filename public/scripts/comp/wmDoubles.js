/**
 * Melaton Mobile: Doubles (Yozora #836), the desktop's slide-and-join number puzzle
 * (public/scripts/comp/desktop-apps/vista-games/doubles.js; Academy City Research P.S.R.) drawn as a
 * Windows Mobile 6 program would have been (the device's Bubble Breaker is the style: white page,
 * blue Tahoma status row, GDI-shaded pieces, soft keys New Game | Menu).
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

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'doubles';
    const TITLE = 'Doubles';
    const DEVELOPER = 'Academy City Research P.S.R.';
    const KEY = 'wmGame:doubles';
    const SLIDE_MS = 110;
    const POP_MS = 150;
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
        if (!anim) return;
        const r = anim.r;
        anim = null;
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
        loop();
        ws.refreshSoftKeys();
    }

    async function afterMove(r) {
        draw();
        if (r.over) {
            prev = null;
            const won = G.won;
            const high = record();
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
    // GDI-style pieces: a black outline with clipped corners, a flat face, one lighter band along the
    // top and left and one darker along the bottom and right (the device's stepped shading), the
    // number in bold Tahoma. Each value is painted once per size (a sprite); a frame is blits.

    // face, light, dark, text
    const COLORS = [
        ['#ffffff', '#ffffff', '#b4bfcc', '#000000'], // 2
        ['#cfe3fa', '#eef6ff', '#86a4c8', '#000000'], // 4
        ['#52aee6', '#a4d8f8', '#1f6ea6', '#ffffff'], // 8
        ['#22a6a4', '#7fdcd6', '#0c6a6a', '#ffffff'], // 16
        ['#35a94c', '#8ade95', '#17702a', '#ffffff'], // 32
        ['#8fba1e', '#cbe46c', '#587c08', '#ffffff'], // 64
        ['#eab016', '#ffe07a', '#a67400', '#ffffff'], // 128
        ['#ee8218', '#ffbe6a', '#a85000', '#ffffff'], // 256
        ['#de4432', '#ff8e7c', '#981c0e', '#ffffff'], // 512
        ['#cc3382', '#f690c0', '#86124c', '#ffffff'], // 1024
        ['#7a4cd6', '#b99cf6', '#44208e', '#ffffff'], // 2048
        ['#2a3442', '#66768c', '#0a0e16', '#ffd866']  // 4096 and up
    ];
    const colorsOf = (v) => COLORS[Math.min(COLORS.length - 1, Math.max(0, Math.round(Math.log2(v)) - 1))];

    function tileSprite(v) {
        const s = L.tilePx;
        const key = `${v}@${s}/${G.goal}`;
        let c = sprites.get(key);
        if (c) return c;
        if (sprites.size > 60) sprites.clear();
        c = document.createElement('canvas');
        c.width = c.height = s;
        const x = c.getContext('2d');
        const [face, light, dark, text] = colorsOf(v);
        const u = Math.max(1, Math.round(L.unit * L.dpr * 0.5)); // one VGA pixel
        const band = Math.max(u, Math.round(s * 0.07));
        // outline, corners clipped by one VGA pixel
        x.fillStyle = '#000';
        x.fillRect(u, 0, s - u * 2, s);
        x.fillRect(0, u, s, s - u * 2);
        x.fillStyle = dark;
        x.fillRect(u, u, s - u * 2, s - u * 2);
        x.fillStyle = light;
        x.fillRect(u, u, s - u * 2 - band, s - u * 2 - band);
        x.fillStyle = face;
        x.fillRect(u + band, u + band, s - u * 2 - band * 2, s - u * 2 - band * 2);
        if (v >= G.goal) {
            x.strokeStyle = '#ffd400';
            x.lineWidth = u;
            x.strokeRect(u + band + u * 1.5, u + band + u * 1.5, s - (u + band) * 2 - u * 3, s - (u + band) * 2 - u * 3);
        }
        const label = String(v);
        const size = Math.round(s * (label.length <= 2 ? 0.46 : label.length === 3 ? 0.36 : label.length === 4 ? 0.28 : 0.22));
        x.font = `bold ${size}px Tahoma, Verdana, sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = text;
        x.fillText(label, s / 2, s / 2 + Math.round(size * 0.04));
        sprites.set(key, c);
        return c;
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
        const cs = getComputedStyle(page);
        L = {
            n, dpr, unit, w, h, gapPx, tilePx, boardPx,
            ox: Math.round((w * dpr - boardPx) / 2),
            oy: Math.round(Math.min((h * dpr - boardPx) / 2, margin * dpr * 2 + (h * dpr - boardPx) * 0.25)),
            tint: cs.getPropertyValue('--wm-tint').trim() || '#d6ebce'
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
        const u = Math.max(1, Math.round(L.unit * L.dpr * 0.5));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        // the board: a black frame around the theme's tint, a white well for every square
        ctx.fillStyle = '#000';
        ctx.fillRect(L.ox, L.oy, L.boardPx, L.boardPx);
        ctx.fillStyle = L.tint;
        ctx.fillRect(L.ox + u, L.oy + u, L.boardPx - u * 2, L.boardPx - u * 2);
        for (let i = 0; i < L.n * L.n; i++) {
            ctx.fillStyle = '#808080';
            ctx.fillRect(cellX(i), cellY(i), L.tilePx, L.tilePx);
            ctx.fillStyle = '#fff';
            ctx.fillRect(cellX(i) + u, cellY(i) + u, L.tilePx - u, L.tilePx - u);
        }
        const put = (v, x, y, scale) => {
            const s = Math.round(L.tilePx * scale);
            const o = Math.round((L.tilePx - s) / 2);
            ctx.drawImage(tileSprite(v), Math.round(x) + o, Math.round(y) + o, s, s);
        };
        const t = anim ? now - anim.at : 0;
        if (anim && t < SLIDE_MS) {
            const k = 1 - Math.pow(1 - t / SLIDE_MS, 2);
            anim.r.slides.forEach((s) => put(s.v, cellX(s.from) + (cellX(s.to) - cellX(s.from)) * k, cellY(s.from) + (cellY(s.to) - cellY(s.from)) * k, 1));
        } else {
            const k = anim ? Math.min(1, (t - SLIDE_MS) / POP_MS) : 1;
            const popped = anim ? new Set(anim.r.merges.map((m) => m.tile.id)) : null;
            const spawnId = anim && anim.r.spawn ? anim.r.spawn.tile.id : 0;
            G.cells.forEach((tile, i) => {
                if (!tile) return;
                if (anim && tile.id === spawnId) put(tile.v, cellX(i), cellY(i), 0.3 + 0.7 * k);
                else if (anim && popped.has(tile.id)) put(tile.v, cellX(i), cellY(i), 1 + 0.14 * Math.sin(Math.PI * k));
                else put(tile.v, cellX(i), cellY(i), 1);
            });
        }
    }

    function loop() {
        if (raf) return;
        const step = () => {
            raf = 0;
            if (!anim) return;
            if (performance.now() - anim.at >= SLIDE_MS + POP_MS) { settle(); return; }
            draw();
            raf = requestAnimationFrame(step);
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
        if (v === 'main') requestAnimationFrame(() => { layout(); renderStatus(); });
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
            [[2, 0, 0], [4, s, 0], [8, 0, s], [16, s, s]].forEach(([v, x, y]) => c.drawImage(tileSprite(v), x + 1, y + 1, s - 2, s - 2));
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
        if (view === 'main') requestAnimationFrame(() => { sprites.clear(); layout(); renderStatus(); });
    }

    function hide() {
        // an animation in flight ends at once (a game that just ended still goes into the statistics;
        // its board is there, finished, on the way back)
        if (anim) { const r = anim.r; anim = null; if (r.over) record(); }
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
            onEnd() { hide(); view = 'main'; page = null; cv = null; ctx = null; L = null; },
            softKeys
        });
        document.addEventListener('keydown', onKey);
        document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
    }

    // tests
    window.wmDoubles = { createGame, move, canMove, get game() { return G; }, set game(g) { G = g; prev = null; recorded = false; renderStatus(); layout(); }, newGame, tryMove, undo };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
