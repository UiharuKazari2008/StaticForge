/**
 * Melaton Mobile: Gems (Yozora #786), an original swap-and-match jewel game for the phone, drawn as a
 * Windows Mobile 6 program would have been (the device's Bubble Breaker is the style: white page,
 * blue Tahoma status row, GDI-shaded pieces, soft keys New Game | Menu).
 *
 * Play: an 8 x 8 board of six cuts of gem. Tap a gem, then a gem beside it, or drag a gem toward its
 * neighbour, to swap them; a swap must line up three or more of a kind across or down, or it swaps
 * back. Matched gems clear, the gems above fall and new ones drop in from the top; a line that forms
 * as they land is a cascade and scores more. Four in a line leave a Cross gem of that colour (when it
 * clears, its whole row and column clear with it); five or more, or two lines meeting, leave a Star,
 * which counts as every colour and doubles the score of the rest of that cascade.
 * Scores: 3 in a line 30, each gem past three 20 more, times the cascade step, times 2 after a Star.
 * The bar under the board fills toward the next level (a new level asks for more points).
 * Game types (Options): Normal (the game ends when no swap is left), Timed (the bar is a clock that
 * matches refill; time out ends it) and Endless (no end: a stuck board is shuffled). Hints (Menu >
 * Hint, or by themselves after 10 s idle when Show hints is on) frame a gem that can move.
 * Statistics: the five best scores for each game type, games played, best cascade, gems cleared.
 * Settings and statistics: localStorage wmGame:gems (the game in progress is saved there too).
 * Only on phones. Styles: public/css/wm-gems.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'gems';
    const TITLE = 'Gems';
    const DEVELOPER = 'Academy City Research P.S.R.';
    const KEY = 'wmGame:gems';
    const N = 8;
    const KINDS = 6;
    const STAR = 7; // the wild gem's kind
    const HINT_IDLE_MS = 10000;
    const TIMED_START = 90; // s on the clock
    const TIMED_MAX = 120;
    const TYPES = { normal: 'Normal', timed: 'Timed', endless: 'Endless' };

    // the six cuts and their colours: face, light facet, dark facet, outline (WM's stepped shading)
    const GEMS = [
        { name: 'ruby', face: '#d8202a', light: '#ff6a5e', dark: '#8c0c14', line: '#5e0408' },
        { name: 'topaz', face: '#f2b318', light: '#ffe27a', dark: '#b06e00', line: '#6e4200' },
        { name: 'emerald', face: '#1d9a3a', light: '#6edc7c', dark: '#0a5a1e', line: '#063a12' },
        { name: 'sapphire', face: '#2558d6', light: '#7aa6ff', dark: '#0e2f88', line: '#081c58' },
        { name: 'amethyst', face: '#8a2ec8', light: '#cc8cf2', dark: '#521682', line: '#340c56' },
        { name: 'pearl', face: '#c9d3dc', light: '#ffffff', dark: '#8a96a2', line: '#4e5862' }
    ];

    let ws = null;
    let page = null;
    let cv = null;
    let ctx = null;
    let view = 'main';
    let draft = null;
    let G = null; // the game
    let L = { s: 1, ox: 0, oy: 0, cell: 1, dpr: 1, barY: 0 };
    let raf = 0;
    let anim = null; // { kind, t0, dur, ... } while something moves
    let sel = null; // { x, y } the selected gem
    let press = null;
    let hint = null; // { x, y, t0 }
    let idleTimer = 0;
    let clock = 0;
    let lastTick = 0;
    let audio = null;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ---------------------------------------------------------------- storage

    const DEFAULTS = { type: 'normal', sounds: true, hints: true, confirmEnd: true };
    function store() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
    function storePut(patch) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(store(), patch))); } catch (_) { /* private mode */ } }
    const settings = () => Object.assign({}, DEFAULTS, store().settings || {});
    function blankStats() { return { best: { normal: [], timed: [], endless: [] }, played: 0, bestCascade: 0, gems: 0, bestLevel: 0 }; }
    function stats() { const s = Object.assign(blankStats(), store().stats || {}); s.best = Object.assign(blankStats().best, s.best || {}); return s; }

    // ---------------------------------------------------------------- the board

    const rnd = (n) => Math.floor(Math.random() * n);
    const at = (b, x, y) => (x >= 0 && y >= 0 && x < N && y < N ? b[y * N + x] : null);
    const kindOf = (g) => (g ? g.k : -1);

    function freshGem(k) { return { k, sp: 0, id: Math.random().toString(36).slice(2, 9) }; }

    /** Lines of three or more in board b: [{ cells: [[x, y]...], dir: 'h' | 'v' }] */
    function findLines(b) {
        const out = [];
        for (const dir of ['h', 'v']) {
            for (let a = 0; a < N; a++) {
                let run = [];
                let k = -1;
                const flush = () => { if (run.length >= 3) out.push({ cells: run, dir, k }); };
                for (let c = 0; c < N; c++) {
                    const x = dir === 'h' ? c : a;
                    const y = dir === 'h' ? a : c;
                    const g = at(b, x, y);
                    // a Star joins either neighbour's colour
                    const gk = g ? g.k : -2;
                    const fits = run.length && g && (gk === STAR || k === STAR || gk === k);
                    if (fits) {
                        run.push([x, y]);
                        if (k === STAR && gk !== STAR) k = gk;
                    } else {
                        flush();
                        // Stars at the end of the broken run start the next one too (R * B B)
                        const carry = [];
                        for (let i = run.length - 1; i >= 0; i--) {
                            const r = at(b, run[i][0], run[i][1]);
                            if (r && r.k === STAR) carry.unshift(run[i]); else break;
                        }
                        run = g ? carry.concat([[x, y]]) : [];
                        k = g ? gk : -1;
                    }
                }
                flush();
            }
        }
        return out;
    }

    function anyMove(b) {
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                for (const [dx, dy] of [[1, 0], [0, 1]]) {
                    if (x + dx >= N || y + dy >= N) continue;
                    const t = b.slice();
                    swapIn(t, x, y, x + dx, y + dy);
                    if (findLines(t).length) return { x, y, x2: x + dx, y2: y + dy };
                }
            }
        }
        return null;
    }

    function swapIn(b, x1, y1, x2, y2) {
        const i = y1 * N + x1;
        const j = y2 * N + x2;
        const t = b[i]; b[i] = b[j]; b[j] = t;
    }

    function newBoard() {
        // no lines at the start, and at least one move
        for (let tries = 0; tries < 200; tries++) {
            const b = [];
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    let k;
                    do { k = rnd(KINDS); } while ((x >= 2 && kindOf(b[y * N + x - 1]) === k && kindOf(b[y * N + x - 2]) === k)
                        || (y >= 2 && kindOf(b[(y - 1) * N + x]) === k && kindOf(b[(y - 2) * N + x]) === k));
                    b.push(freshGem(k));
                }
            }
            if (anyMove(b)) return b;
        }
        return null;
    }

    function shuffleBoard(b) {
        for (let tries = 0; tries < 200; tries++) {
            const g = b.slice();
            for (let i = g.length - 1; i > 0; i--) { const j = rnd(i + 1); [g[i], g[j]] = [g[j], g[i]]; }
            if (!findLines(g).length && anyMove(g)) return g;
        }
        return newBoard();
    }

    const levelTarget = (level) => 600 + (level - 1) * 400;

    function newGame() {
        const s = settings();
        G = {
            type: s.type,
            board: newBoard(),
            score: 0,
            level: 1,
            levelPts: 0,
            time: TIMED_START,
            cascadeBest: 0,
            cleared: 0,
            over: false,
            started: false,
            paused: false
        };
        sel = null;
        hint = null;
        anim = null;
        save();
        renderStatus();
        draw();
        armHint();
    }

    function save() {
        if (!G) return;
        const keep = G.over ? undefined : { type: G.type, board: G.board.map((g) => g ? [g.k, g.sp] : [0, 0]), score: G.score, level: G.level, levelPts: G.levelPts, time: G.time, cascadeBest: G.cascadeBest, cleared: G.cleared, started: G.started };
        storePut({ saved: keep });
    }

    function restore() {
        const s = store().saved;
        if (!s || !Array.isArray(s.board) || s.board.length !== N * N) return false;
        G = Object.assign({ over: false, paused: false }, s, { board: s.board.map(([k, sp]) => Object.assign(freshGem(k), { sp })) });
        if (!anyMove(G.board) && G.type !== 'normal') G.board = shuffleBoard(G.board);
        return true;
    }

    // ---------------------------------------------------------------- turns

    function trySwap(x1, y1, x2, y2) {
        if (!G || G.over || anim || Math.abs(x1 - x2) + Math.abs(y1 - y2) !== 1) return;
        sel = null;
        hint = null;
        G.started = true;
        const t = G.board.slice();
        swapIn(t, x1, y1, x2, y2);
        const ok = findLines(t).length > 0;
        startAnim({ kind: 'swap', dur: 160, a: [x1, y1], b: [x2, y2], back: !ok }, () => {
            if (!ok) {
                startAnim({ kind: 'swap', dur: 160, a: [x2, y2], b: [x1, y1] }, () => { sound('no'); armHint(); });
                return;
            }
            G.board = t;
            resolve(1, 1, [x2, y2]);
        });
    }

    /** Clear the lines on the board, drop, and look again (a cascade step each time round). */
    function resolve(step, mult, moved) {
        const lines = findLines(G.board);
        if (!lines.length) { settle(); return; }
        G.cascadeBest = Math.max(G.cascadeBest, step);
        const clear = new Set();
        const makes = []; // specials left behind: { x, y, k, sp }
        let pts = 0;
        let starHit = false;
        // cells two lines share (an L or T) make a Star
        const count = new Map();
        lines.forEach((ln) => ln.cells.forEach(([x, y]) => count.set(y * N + x, (count.get(y * N + x) || 0) + 1)));
        for (const ln of lines) {
            pts += 30 + (ln.cells.length - 3) * 20;
            ln.cells.forEach(([x, y]) => clear.add(y * N + x));
            const cross = ln.cells.find(([x, y]) => count.get(y * N + x) > 1);
            const pick = cross || ln.cells.find(([x, y]) => moved && x === moved[0] && y === moved[1]) || ln.cells[Math.floor(ln.cells.length / 2)];
            if (ln.cells.length >= 5 || cross) makes.push({ x: pick[0], y: pick[1], k: STAR, sp: 2 });
            else if (ln.cells.length === 4) makes.push({ x: pick[0], y: pick[1], k: ln.k === STAR ? rnd(KINDS) : ln.k, sp: 1 });
        }
        // specials caught in the clear go off
        let grew = true;
        while (grew) {
            grew = false;
            for (const i of [...clear]) {
                const g = G.board[i];
                if (!g) continue;
                if (g.k === STAR) starHit = true;
                if (g.sp === 1 && !g.fired) {
                    g.fired = true;
                    const x = i % N;
                    const y = Math.floor(i / N);
                    for (let c = 0; c < N; c++) {
                        for (const j of [y * N + c, c * N + x]) if (!clear.has(j)) { clear.add(j); grew = true; pts += 10; }
                    }
                }
            }
        }
        if (starHit) mult = Math.max(mult, 2);
        // a special is not made where an earlier one of the same clear already sits
        const made = new Map();
        makes.forEach((m) => { if (!made.has(m.y * N + m.x)) made.set(m.y * N + m.x, m); });
        const gain = pts * step * mult;
        addScore(gain);
        G.cleared += clear.size;
        if (G.type === 'timed') G.time = Math.min(TIMED_MAX, G.time + clear.size * 0.5);
        sound(step > 1 ? 'cascade' : 'match', step);
        startAnim({ kind: 'clear', dur: 220, cells: clear, gain, at: centreOf(clear) }, () => {
            for (const i of clear) {
                const m = made.get(i);
                G.board[i] = m ? Object.assign(freshGem(m.k), { sp: m.sp }) : null;
            }
            drop(() => resolve(step + 1, mult, null));
        });
    }

    function centreOf(set) {
        let sx = 0; let sy = 0;
        for (const i of set) { sx += i % N; sy += Math.floor(i / N); }
        return [sx / set.size, sy / set.size];
    }

    function drop(done) {
        const falls = []; // { g, x, from, to }
        for (let x = 0; x < N; x++) {
            let write = N - 1;
            for (let y = N - 1; y >= 0; y--) {
                const g = G.board[y * N + x];
                if (g) {
                    if (write !== y) { G.board[write * N + x] = g; G.board[y * N + x] = null; falls.push({ g, x, from: y, to: write }); }
                    write--;
                }
            }
            for (let y = write, k = 1; y >= 0; y--, k++) {
                const g = freshGem(rnd(KINDS));
                G.board[y * N + x] = g;
                falls.push({ g, x, from: -k, to: y });
            }
        }
        const far = falls.reduce((m, f) => Math.max(m, f.to - f.from), 0);
        startAnim({ kind: 'fall', dur: 90 + far * 45, falls }, done);
    }

    function addScore(n) {
        G.score += n;
        G.levelPts += n;
        while (G.levelPts >= levelTarget(G.level)) {
            G.levelPts -= levelTarget(G.level);
            G.level++;
            if (G.type === 'timed') G.time = Math.min(TIMED_MAX, G.time + 20);
            sound('level');
        }
        renderStatus();
    }

    function settle() {
        save();
        const move = anyMove(G.board);
        if (move) { armHint(); draw(); return; }
        if (G.type === 'normal') { gameOver('No more moves.'); return; }
        // Timed and Endless: shuffle a stuck board
        ws.messageBox({ title: TITLE, text: 'No more moves. The gems will be shuffled.', icon: 'info', modal: true }).then(() => {
            G.board = shuffleBoard(G.board);
            save();
            draw();
            armHint();
        });
    }

    function record() {
        const st = stats();
        st.played += 1;
        st.bestCascade = Math.max(st.bestCascade, G.cascadeBest);
        st.gems += G.cleared;
        st.bestLevel = Math.max(st.bestLevel, G.level);
        let high = false;
        if (G.score > 0) {
            const list = st.best[G.type] || [];
            const entry = { score: G.score, level: G.level, date: Date.now() };
            list.push(entry);
            list.sort((a, b) => b.score - a.score || a.date - b.date);
            st.best[G.type] = list.slice(0, 5);
            high = st.best[G.type][0] === entry;
        }
        storePut({ stats: st });
        return high;
    }

    async function gameOver(why) {
        G.over = true;
        stopClock();
        const high = record();
        save();
        draw();
        sound('over');
        const yes = await ws.messageBox({
            title: 'Game Over', icon: 'info', modal: true, cancelValue: false,
            text: `${why}\n\nScore: ${G.score}\nLevel: ${G.level}${high ? '\nNew high score!' : ''}\n\nDo you want to play again?`,
            buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }]
        });
        if (yes) newGame();
    }

    async function askNewGame() {
        if (G && G.started && !G.over && settings().confirmEnd) {
            pause();
            const yes = await ws.messageBox({
                title: 'New Game?', text: 'Do you really want to begin a new game?', icon: 'question', modal: true, cancelValue: false,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            resume();
            if (!yes) return;
        }
        if (G && G.started && !G.over) record();
        newGame();
    }

    // ---------------------------------------------------------------- hints and the clock

    function armHint() {
        clearTimeout(idleTimer);
        if (!G || G.over || !settings().hints) return;
        idleTimer = setTimeout(() => { if (view === 'main' && !anim && page && !page.hidden) showHint(); }, HINT_IDLE_MS);
    }

    function showHint() {
        const m = G && !G.over && anyMove(G.board);
        if (!m) return;
        // the gem of the pair whose move makes the line
        const t = G.board.slice();
        swapIn(t, m.x, m.y, m.x2, m.y2);
        const lines = findLines(t);
        const onLine = (x, y) => lines.some((ln) => ln.cells.some(([a, b]) => a === x && b === y));
        hint = onLine(m.x2, m.y2) ? { x: m.x, y: m.y, t0: performance.now() } : { x: m.x2, y: m.y2, t0: performance.now() };
        kick();
    }

    function startClock() {
        if (clock || !G || G.type !== 'timed' || G.over || !G.started || view !== 'main' || G.paused || !page || page.hidden) return;
        lastTick = performance.now();
        clock = setInterval(() => {
            if (!G || G.paused || anim && anim.kind === 'none') return;
            const now = performance.now();
            G.time = Math.max(0, G.time - (now - lastTick) / 1000);
            lastTick = now;
            draw();
            if (G.time <= 0 && !anim) { gameOver('Time is up.'); }
        }, 200);
    }

    function stopClock() { clearInterval(clock); clock = 0; }

    function pause() { if (G) G.paused = true; stopClock(); }
    function resume() { if (G) G.paused = false; startClock(); }

    // ---------------------------------------------------------------- sound

    function sound(kind, step) {
        if (!settings().sounds) return;
        try {
            if (ws.sounds && typeof ws.sounds.silent === 'function' && ws.sounds.silent()) return;
            if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === 'suspended') audio.resume();
            const tone = (f, t, d, type = 'square', v = 0.05) => {
                const o = audio.createOscillator();
                const g = audio.createGain();
                o.type = type; o.frequency.value = f;
                g.gain.setValueAtTime(v, audio.currentTime + t);
                g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + d);
                o.connect(g).connect(audio.destination);
                o.start(audio.currentTime + t); o.stop(audio.currentTime + t + d + 0.02);
            };
            if (kind === 'match') tone(880, 0, 0.08);
            else if (kind === 'cascade') tone(880 * Math.pow(1.122, Math.min(8, step || 2)), 0, 0.09);
            else if (kind === 'no') tone(180, 0, 0.12, 'sawtooth');
            else if (kind === 'level') { tone(660, 0, 0.08); tone(880, 0.09, 0.08); tone(1320, 0.18, 0.14); }
            else if (kind === 'over') { tone(440, 0, 0.12, 'triangle', 0.08); tone(330, 0.13, 0.2, 'triangle', 0.08); }
        } catch (_) { /* no audio */ }
    }

    // ---------------------------------------------------------------- animation

    function startAnim(a, done) {
        anim = Object.assign(a, { t0: performance.now(), done });
        kick();
    }

    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

    function frame(now) {
        raf = 0;
        if (!page || page.hidden || view !== 'main') return;
        if (anim && now - anim.t0 >= anim.dur) {
            const a = anim;
            anim = null;
            if (a.done) a.done();
        }
        draw(now);
        // keep going while something moves (a hint pulses for 3 s)
        if (anim || (hint && now - hint.t0 < 3000)) kick();
        else if (hint) { hint = null; draw(now); }
    }

    // ---------------------------------------------------------------- layout and drawing

    function layout() {
        if (!cv) return;
        const box = cv.parentElement;
        const w = Math.max(1, box.clientWidth);
        const h = Math.max(1, box.clientHeight);
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const unit = parseFloat(getComputedStyle(page.querySelector('.wgm-probe')).width) / 100 || 1;
        const bar = Math.round(9 * unit);
        const gap = Math.round(4 * unit);
        const side = Math.max(8, Math.min(w - gap * 2, h - bar - gap * 3));
        const cell = Math.floor(side / N);
        const bw = cell * N;
        const cs = getComputedStyle(page);
        L = {
            dpr, cell, unit, ox: Math.round((w - bw) / 2), oy: Math.max(gap, Math.round((h - bw - bar - gap) / 2)), bw, bar, gap, w, h,
            // theme colours read once per layout (show() lays out again after a theme change)
            tint: cs.getPropertyValue('--wm-tint').trim() || '#d6ebce',
            hl: cs.getPropertyValue('--wm-highlight').trim() || '#31d339'
        };
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
            cv.width = Math.round(w * dpr);
            cv.height = Math.round(h * dpr);
        }
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        buildSprites();
        draw();
    }

    // ---------------------------------------------------------------- sprites
    //
    // Everything that does not move is drawn once per size and theme: the board (checker and frame)
    // as one layer, and the gems as a sprite sheet (row 0 the six cuts, row 1 the six Cross gems,
    // then the Star), each a cell at device pixels. A frame is then a layer copy and a blit per gem.

    let boardLayer = null;
    let gemSheet = null;
    let spriteKey = '';

    function buildSprites() {
        const { dpr, cell, bw } = L;
        if (!bw || !cell) return;
        const key = [cell, dpr, L.tint].join('|');
        if (key === spriteKey && boardLayer && gemSheet) return;
        spriteKey = key;
        const px = Math.round(bw * dpr);
        boardLayer = boardLayer || document.createElement('canvas');
        boardLayer.width = px;
        boardLayer.height = px;
        const b = boardLayer.getContext('2d');
        b.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                b.fillStyle = (x + y) % 2 ? L.tint : '#fff';
                b.fillRect(x * cell, y * cell, cell, cell);
            }
        }
        b.strokeStyle = '#000';
        b.lineWidth = 1 / dpr;
        b.strokeRect(0.5 / dpr, 0.5 / dpr, bw - 1 / dpr, bw - 1 / dpr);
        const cp = Math.round(cell * dpr);
        gemSheet = gemSheet || document.createElement('canvas');
        gemSheet.width = cp * KINDS;
        gemSheet.height = cp * 3;
        const g = gemSheet.getContext('2d');
        g.clearRect(0, 0, gemSheet.width, gemSheet.height);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let sp = 0; sp < 2; sp++) for (let k = 0; k < KINDS; k++) drawGem(g, { k, sp }, k * cell, sp * cell, cell, 1, 0);
        drawGem(g, { k: STAR, sp: 2 }, 0, 2 * cell, cell, 1, 0);
        gemSheet.cell = cp;
    }

    /** A gem from the sheet at (x, y) in css px, shrunk about its centre by sc. */
    function blitGem(c, gem, x, y, sc) {
        if (sc <= 0) return;
        const cp = gemSheet.cell;
        const col = gem.k === STAR ? 0 : gem.k;
        const row = gem.k === STAR ? 2 : (gem.sp === 1 ? 1 : 0);
        const d = L.cell * sc;
        c.drawImage(gemSheet, col * cp, row * cp, cp, cp, x + (L.cell - d) / 2, y + (L.cell - d) / 2, d, d);
    }

    const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
    const easeIn = (t) => ease(t) * ease(t);

    function draw(now) {
        // nothing to draw on before the first layout (a new game is dealt in mount, before it)
        if (!ctx || !G || !L.bw || !L.w) return;
        now = now || performance.now();
        const c = ctx;
        const { dpr, cell, ox, oy, bw } = L;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = '#fff';
        c.fillRect(0, 0, L.w, L.h);
        if (!boardLayer || !gemSheet) buildSprites();
        if (!boardLayer || !boardLayer.width || !gemSheet || !gemSheet.width) return;
        // the board layer (checker in the theme tint, 1 px frame), copied 1:1 in device pixels
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(boardLayer, Math.round(ox * dpr), Math.round(oy * dpr));
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        // gems
        const a = anim;
        const p = a ? ease((now - a.t0) / a.dur) : 1;
        const pos = new Map(); // gem -> [x, y] in cells (fractional)
        const scale = new Map();
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const g = G.board[y * N + x]; if (g) pos.set(g, [x, y]); }
        if (a && a.kind === 'swap') {
            const ga = at(G.board, a.a[0], a.a[1]);
            const gb = at(G.board, a.b[0], a.b[1]);
            if (ga) pos.set(ga, [a.a[0] + (a.b[0] - a.a[0]) * p, a.a[1] + (a.b[1] - a.a[1]) * p]);
            if (gb) pos.set(gb, [a.b[0] + (a.a[0] - a.b[0]) * p, a.b[1] + (a.a[1] - a.b[1]) * p]);
        } else if (a && a.kind === 'clear') {
            for (const i of a.cells) { const g = G.board[i]; if (g) scale.set(g, 1 - p); }
        } else if (a && a.kind === 'fall') {
            const t = (now - a.t0) / a.dur;
            for (const f of a.falls) pos.set(f.g, [f.x, f.from + (f.to - f.from) * easeIn(t)]);
        }
        c.save();
        c.beginPath();
        c.rect(ox, oy, bw, bw);
        c.clip();
        for (const [g, [x, y]] of pos) blitGem(c, g, ox + x * cell, oy + y * cell, scale.has(g) ? scale.get(g) : 1);
        c.restore();
        // selection and hint frames: the theme's highlight, 2 units
        const frameAt = (x, y, col) => {
            c.strokeStyle = col;
            c.lineWidth = Math.max(2, Math.round(L.unit * 1.5));
            const i = c.lineWidth / 2;
            c.strokeRect(ox + x * cell + i, oy + y * cell + i, cell - i * 2, cell - i * 2);
        };
        const hl = L.hl;
        if (sel && !a) frameAt(sel.x, sel.y, hl);
        if (hint && !a && Math.floor((now - hint.t0) / 300) % 2 === 0) frameAt(hint.x, hint.y, '#000');
        // points rising from a clear
        if (a && a.kind === 'clear' && a.gain) {
            c.font = `bold ${Math.round(12 * L.unit)}px Tahoma, sans-serif`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            const tx = ox + (a.at[0] + 0.5) * cell;
            const ty = oy + (a.at[1] + 0.5) * cell - p * cell * 0.6;
            c.lineWidth = Math.max(2, L.unit * 2);
            c.strokeStyle = '#fff';
            c.strokeText(String(a.gain), tx, ty);
            c.fillStyle = '#0000ff';
            c.fillText(String(a.gain), tx, ty);
        }
        // the bar: level progress (Normal, Endless) or the clock (Timed), WM's progress bar
        const by = oy + bw + L.gap;
        const frac = G.type === 'timed' ? G.time / TIMED_MAX : G.levelPts / levelTarget(G.level);
        c.fillStyle = '#fff';
        c.fillRect(ox, by, bw, L.bar);
        c.fillStyle = G.type === 'timed' && G.time < 10 && Math.floor(now / 250) % 2 ? '#d8202a' : hl;
        c.fillRect(ox + 1, by + 1, Math.max(0, (bw - 2) * Math.min(1, frac)), L.bar - 2);
        c.strokeStyle = '#000';
        c.lineWidth = 1 / dpr;
        c.strokeRect(ox + 0.5 / dpr, by + 0.5 / dpr, bw - 1 / dpr, L.bar - 1 / dpr);
        renderStatus();
    }

    /** One gem, GDI style: a cut outline in a dark shade, flat facets in three tones, a light corner. */
    function drawGem(c, g, x, y, size, sc, now) {
        if (sc <= 0) return;
        const m = size * 0.1;
        const s = (size - m * 2) * sc;
        const cx = x + size / 2;
        const cy = y + size / 2;
        const r = s / 2;
        c.save();
        c.translate(cx, cy);
        c.lineJoin = 'round';
        c.lineWidth = Math.max(1, size / 26);
        if (g.k === STAR) { drawStar(c, r); c.restore(); return; }
        const col = GEMS[g.k];
        const poly = (pts) => { c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px * r, py * r) : c.moveTo(px * r, py * r))); c.closePath(); };
        const facet = (pts, fill) => { poly(pts); c.fillStyle = fill; c.fill(); };
        let outer;
        let table;
        switch (col.name) {
            case 'ruby': // round brilliant
                outer = []; table = [];
                for (let i = 0; i < 8; i++) { const t = Math.PI / 8 + i * Math.PI / 4; outer.push([Math.cos(t), Math.sin(t)]); table.push([Math.cos(t) * 0.55, Math.sin(t) * 0.55]); }
                break;
            case 'topaz': // trillion (triangle)
                outer = [[0, -1], [0.95, 0.75], [-0.95, 0.75]];
                table = [[0, -0.45], [0.45, 0.4], [-0.45, 0.4]];
                break;
            case 'emerald': // emerald cut (cut-corner rectangle)
                outer = [[-0.55, -0.95], [0.55, -0.95], [0.8, -0.7], [0.8, 0.7], [0.55, 0.95], [-0.55, 0.95], [-0.8, 0.7], [-0.8, -0.7]];
                table = outer.map(([px, py]) => [px * 0.58, py * 0.7]);
                break;
            case 'sapphire': // princess (square)
                outer = [[-0.85, -0.85], [0.85, -0.85], [0.85, 0.85], [-0.85, 0.85]];
                table = outer.map(([px, py]) => [px * 0.5, py * 0.5]);
                break;
            case 'amethyst': // marquise (pointed oval)
                outer = []; table = [];
                for (let i = 0; i < 12; i++) {
                    const t = i * Math.PI / 6;
                    const px = Math.sin(t) * 0.62;
                    const py = -Math.cos(t);
                    outer.push([px, py]); table.push([px * 0.5, py * 0.55]);
                }
                break;
            default: // pearl: a round bead, shaded like Bubble Breaker's balls
                {
                    const grd = c.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
                    grd.addColorStop(0, col.light);
                    grd.addColorStop(0.55, col.face);
                    grd.addColorStop(1, col.dark);
                    c.beginPath(); c.arc(0, 0, r * 0.88, 0, Math.PI * 2);
                    c.fillStyle = grd; c.fill();
                    c.strokeStyle = col.line; c.stroke();
                    c.beginPath(); c.ellipse(-r * 0.3, -r * 0.38, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
                    c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
                    special(c, g, r, col, now);
                    c.restore();
                    return;
                }
        }
        // crown facets: each outer edge to the table, lit from the upper left
        poly(outer); c.fillStyle = col.face; c.fill();
        for (let i = 0; i < outer.length; i++) {
            const a = outer[i];
            const b = outer[(i + 1) % outer.length];
            const ta = table[i % table.length];
            const tb = table[(i + 1) % table.length];
            const mx = (a[0] + b[0]) / 2;
            const my = (a[1] + b[1]) / 2;
            const lit = -(mx + my); // toward the upper left
            facet([a, b, tb, ta], lit > 0.35 ? col.light : lit < -0.35 ? col.dark : col.face);
        }
        facet(table, col.face);
        // the table's light corner
        const tl = table.reduce((best, p) => (p[0] + p[1] < best[0] + best[1] ? p : best), table[0]);
        c.beginPath();
        c.moveTo(tl[0] * r, tl[1] * r);
        c.lineTo(tl[0] * r * 0.4, tl[1] * r * 0.4 + r * 0.05);
        c.lineTo(tl[0] * r * 0.4 + r * 0.05, tl[1] * r * 0.4);
        c.closePath();
        c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
        poly(outer); c.strokeStyle = col.line; c.stroke();
        special(c, g, r, col, now);
        c.restore();
    }

    /** A Cross gem: a white plus over it, outlined in the gem's dark shade. */
    function special(c, g, r, col) {
        if (g.sp !== 1) return;
        const w = r * 0.22;
        const l = r * 0.7;
        c.beginPath();
        c.rect(-w / 2, -l, w, l * 2);
        c.rect(-l, -w / 2, l * 2, w);
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.fill();
        c.strokeStyle = col.line;
        c.lineWidth = Math.max(1, r / 14);
        c.stroke();
    }

    /** The Star: a five-point star in the colours of the six gems, a dark outline. */
    function drawStar(c, r) {
        const hue = 40;
        c.beginPath();
        for (let i = 0; i < 10; i++) {
            const t = -Math.PI / 2 + i * Math.PI / 5;
            const rr = i % 2 ? r * 0.42 : r * 0.98;
            const px = Math.cos(t) * rr;
            const py = Math.sin(t) * rr;
            if (i) c.lineTo(px, py); else c.moveTo(px, py);
        }
        c.closePath();
        const grd = c.createLinearGradient(-r, -r, r, r);
        grd.addColorStop(0, `hsl(${hue}, 90%, 72%)`);
        grd.addColorStop(0.5, `hsl(${(hue + 120) % 360}, 85%, 55%)`);
        grd.addColorStop(1, `hsl(${(hue + 240) % 360}, 85%, 40%)`);
        c.fillStyle = grd;
        c.fill();
        c.strokeStyle = '#333';
        c.stroke();
    }

    function renderStatus() {
        if (!page || !G) return;
        const set = (k, v) => { const el = page.querySelector(`.wgm-status [data-v="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = String(v); };
        set('score', G.score);
        set('level', G.level);
        set('type', TYPES[G.type]);
    }

    // ---------------------------------------------------------------- input

    function cellAt(e) {
        const r = cv.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left - L.ox) / L.cell);
        const y = Math.floor((e.clientY - r.top - L.oy) / L.cell);
        return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
    }

    function onDown(e) {
        if (!G || G.over || view !== 'main') return;
        e.preventDefault();
        if (G.paused) { resume(); }
        const c = cellAt(e);
        if (!c || anim) return;
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        press = { c, sx: e.clientX, sy: e.clientY, id: e.pointerId, done: false };
        clearTimeout(idleTimer);
        if (hint) { hint = null; draw(); }
    }

    function onMove(e) {
        if (!press || press.done || e.pointerId !== press.id) return;
        const dx = e.clientX - press.sx;
        const dy = e.clientY - press.sy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < L.cell * 0.4) return;
        press.done = true;
        const step = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        const t = { x: press.c.x + step[0], y: press.c.y + step[1] };
        if (t.x >= 0 && t.y >= 0 && t.x < N && t.y < N) trySwap(press.c.x, press.c.y, t.x, t.y);
    }

    function onUp(e) {
        if (!press || e.pointerId !== press.id) return;
        const p = press;
        press = null;
        if (p.done) return;
        // a tap: select, or swap with the selected neighbour
        const c = p.c;
        if (sel && Math.abs(sel.x - c.x) + Math.abs(sel.y - c.y) === 1) { trySwap(sel.x, sel.y, c.x, c.y); return; }
        sel = sel && sel.x === c.x && sel.y === c.y ? null : c;
        draw();
        armHint();
    }

    function onKey(e) {
        if (!page || page.hidden || view !== 'main' || !G || G.over || anim) return;
        if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
        const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (dirs[e.key]) {
            e.preventDefault();
            // d-pad: move the frame; Enter picks it up, then a direction swaps
            if (sel && sel.held) { const [dx, dy] = dirs[e.key]; const t = { x: sel.x + dx, y: sel.y + dy }; if (t.x >= 0 && t.y >= 0 && t.x < N && t.y < N) trySwap(sel.x, sel.y, t.x, t.y); return; }
            const s = sel || { x: 3, y: 3 };
            sel = { x: Math.max(0, Math.min(N - 1, s.x + dirs[e.key][0])), y: Math.max(0, Math.min(N - 1, s.y + dirs[e.key][1])) };
            draw();
        } else if (e.key === 'Enter' && sel) {
            e.preventDefault();
            sel.held = !sel.held;
            draw();
        }
    }

    // ---------------------------------------------------------------- pages

    function showView(v) {
        view = v;
        page.dataset.view = v;
        page.querySelectorAll('.wgm-view').forEach((el) => { el.hidden = el.dataset.view !== v; });
        if (v === 'options') renderOptions();
        if (v === 'stats') renderStats();
        if (v === 'about') renderAbout();
        if (v === 'main') { requestAnimationFrame(() => { layout(); startClock(); }); armHint(); } else { stopClock(); clearTimeout(idleTimer); }
        ws.refreshTitleAction();
        ws.refreshSoftKeys();
    }

    function openPage(v) {
        pause();
        if (v === 'options') draft = settings();
        showView(v);
        ws.syncHistory();
    }

    function renderOptions() {
        const d = draft;
        const box = page.querySelector('.wgm-view[data-view="options"]');
        const check = (k, label) => `<label class="wm-check"><input type="checkbox" data-opt="${k}"${d[k] ? ' checked' : ''}><span>${esc(label)}</span></label>`;
        box.innerHTML = '<div class="wm-form-hdr">Options</div><div class="wm-set-scroll"><div class="wm-form wgm-form">'
            + `<div class="wm-form-row is-wide"><span class="wm-form-label">Game type:</span><button type="button" class="wm-combo" data-act="type"><span>${TYPES[d.type]}</span></button></div>`
            + `<div class="wgm-checks">${check('sounds', 'Play sounds')}${check('hints', 'Show hints')}${check('confirmEnd', 'Confirm end game')}</div>`
            + '</div></div>';
        box.querySelectorAll('[data-opt]').forEach((el) => el.addEventListener('change', () => { d[el.dataset.opt] = el.checked; }));
        box.querySelector('.wm-combo').addEventListener('click', (e) => {
            e.stopPropagation();
            ws.dropdown(e.currentTarget, Object.keys(TYPES).map((k) => ({ label: TYPES[k], radio: d.type === k, action: () => { d.type = k; renderOptions(); } })), 'left');
        });
    }

    async function commitOptions() {
        if (!draft) return;
        const typeChanged = draft.type !== settings().type;
        storePut({ settings: draft });
        draft = null;
        // a new game type starts a new game
        if (typeChanged) {
            if (G && G.started && !G.over) record();
            newGame();
        }
    }

    function dateText(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`; }

    function renderStats() {
        const st = stats();
        const box = page.querySelector('.wgm-view[data-view="stats"]');
        const type = (G && G.type) || settings().type;
        const best = [0, 1, 2, 3, 4].map((i) => (st.best[type] || [])[i]);
        const rows = [['Games played', st.played], ['Highest level', st.bestLevel], ['Longest cascade', st.bestCascade], ['Gems cleared', st.gems]];
        box.innerHTML = '<div class="wm-form-hdr">Statistics</div><div class="wm-set-scroll"><div class="wgm-stats">'
            + `<p class="wgm-stats-type">High scores (${esc(TYPES[type])}):</p>`
            + '<table class="wgm-high"><thead><tr><th class="is-rank"></th><th>Score</th><th>Level</th><th>Date</th></tr></thead><tbody>'
            + best.map((b, i) => `<tr><td class="is-rank">${i + 1}.</td><td>${b ? b.score : '-'}</td><td>${b ? b.level : '-'}</td><td>${b ? dateText(b.date) : '-'}</td></tr>`).join('')
            + '</tbody></table>'
            + `<table class="wgm-totals"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
            + '<div class="wgm-reset"><button type="button" class="wm-button" data-act="reset">Reset</button></div>'
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
        const box = page.querySelector('.wgm-view[data-view="about"]');
        box.innerHTML = '<div class="wm-set-scroll"><div class="wgm-about"><canvas class="wgm-logo" aria-hidden="true"></canvas>'
            + `<p>${esc(TITLE)}&trade;</p><p>Designed for Melaton Mobile&trade;</p><p>by ${esc(DEVELOPER)}</p>`
            + '<p class="wgm-copy">Copyright &copy; 2026 Xyridian Corporation. All rights reserved.</p></div></div>';
        requestAnimationFrame(() => {
            const lc = box.querySelector('.wgm-logo');
            const css = lc && lc.clientWidth;
            if (!css) return;
            const dpr = window.devicePixelRatio || 1;
            lc.width = lc.height = Math.round(css * dpr);
            const c = lc.getContext('2d');
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            const s = css / 2;
            drawGem(c, { k: 0, sp: 0 }, 0, s * 0.15, s * 1.05, 1, 0);
            drawGem(c, { k: 3, sp: 0 }, s * 0.9, s * 0.05, s * 1.05, 1, 0);
            drawGem(c, { k: 2, sp: 0 }, s * 0.45, s * 0.85, s * 1.05, 1, 0);
        });
    }

    function backToGame(apply) {
        if (view === 'options' && apply) commitOptions();
        draft = null;
        showView('main');
        resume();
        ws.syncHistory();
        return true;
    }

    // ---------------------------------------------------------------- app

    function mount(p) {
        page = p;
        p.classList.add('wm-gems');
        p.dataset.view = 'main';
        p.innerHTML = '<div class="wgm-probe" aria-hidden="true"></div>'
            + '<div class="wgm-view" data-view="main">'
            + '<div class="wgm-status"><span><b>Score:</b> <i data-v="score">0</i></span><span><b>Level:</b> <i data-v="level">1</i></span><span data-v="type">Normal</span></div>'
            + `<div class="wgm-field" data-wm-no-hold><canvas aria-label="${esc(TITLE)}"></canvas></div></div>`
            + '<div class="wgm-view" data-view="options" hidden></div><div class="wgm-view" data-view="stats" hidden></div><div class="wgm-view" data-view="about" hidden></div>';
        cv = p.querySelector('.wgm-field canvas');
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
        if (view === 'main') requestAnimationFrame(() => { layout(); if (G && !G.paused) startClock(); armHint(); });
    }

    function hide() {
        pause();
        save();
        stopLoop();
        clearTimeout(idleTimer);
        // an animation in flight finishes at once so the saved board is whole
        while (anim) { const a = anim; anim = null; if (a.done) a.done(); }
        save();
    }

    function softKeys() {
        if (view !== 'main') return { left: null, right: null };
        return {
            left: { label: 'New Game', action: askNewGame },
            right: {
                label: 'Menu',
                menu: () => [
                    { label: 'Hint', disabled: !G || G.over || !!anim, action: () => showHint() },
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
            icon: 'app-gems',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show,
            hide,
            titleKind: () => (view === 'main' ? 'close' : 'ok'),
            onTitleOk: () => (view === 'main' ? false : backToGame(true)),
            historyDepth: () => (view === 'main' ? 0 : 1),
            onBack: () => (view === 'main' ? false : backToGame(view !== 'options')),
            onEnd() { hide(); view = 'main'; page = null; cv = null; ctx = null; },
            softKeys
        });
        document.addEventListener('keydown', onKey);
        document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); save(); } else if (page && !page.hidden && view === 'main') resume(); });
    }

    // tests
    window.wmGems = { findLines, anyMove, newBoard, get game() { return G; }, newGame, showHint, trySwap };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
