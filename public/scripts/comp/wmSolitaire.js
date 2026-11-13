/**
 * Melaton Mobile: Solitaire, Windows Mobile 6's own (\Windows\solitare.exe), 1:1. Yozora #786.
 *
 * Yukimi (Nov 13 2026) chose the device's Solitaire over a port of the desktop's Vista Solitaire,
 * as Calculator replaced the desktop one: Programs > Games / Start > Games list this in its place.
 *
 * Measured on the WM 6.1 and 6.5 emulators (VGA; ~/.cache/claude-run/wmgames/ref), lengths below in
 * VGA pixels (vp, half a shell unit): the table #008000 under the title bar; cards 58 x 82 from
 * pegcards.192.dll (the 96 DPI set for 1x, an upscale for dense screens; their black frame and the
 * dark green shadow column / row are in the bitmaps, scripts/build-wm-solitaire-art.js). The deck at
 * (13, 8), the cards under its top one showing as edges 4 right / 2 down (one more per 10 cards, at
 * most 3), the empty deck "O" while it can be turned over and "X" when it cannot. The draw pile from
 * (92, 8), Draw Three fanning the last cards dealt 19 right / 2 down. Suit stacks at x 211 + 66 n,
 * y 8, the empty one a grey card. Row stacks at x 13 + 66 n, y 100: a face-down card 6 below the one
 * before, a face-up card 20 below. The status strip at the bottom (42 vp, 40 on 6.5) in the theme's
 * tint: "Time:" at x 4, its number at 75, "Score:" at 165, its number at 240, Tahoma 24 vp.
 *
 * Play as the device: tap the deck (or the Draw soft key) to deal; drag a card (and the cards on it)
 * to move it, dropping anywhere else puts it back at once; tap a face-down row card to turn it (it is
 * not turned for you); double-tap a card to send it to its suit stack. Menu: Undo (one move), New
 * Game, Options... Options is a property sheet: Game Rules (Draw One / Three cards; Scoring
 * Standard / Vegas / None; Time game; Display status; Keep cumulative score, Vegas only) and Card
 * Back (six backs, the chair is the default). Winning asks "Congratulations!  Deal again?".
 * Scoring follows the device's help (soltr.htm) and what it did: Standard 10 to a suit stack, 5 from
 * the deck to a row, 5 for a turned card, -15 from a suit stack to a row, row to row 0 (the help says
 * 3; the device scored 0), -2 every 10 seconds of a timed game, -20 a pass after the fourth (Three) /
 * -100 every pass after the first (One), never below 0, and a time bonus on a timed win; Vegas: $52
 * ante, $5 a card on a suit stack, one pass (One) or three (Three), optionally kept from game to game.
 * The game and the options are kept (localStorage wmGame:solitaire), as the device keeps them in
 * HKCU\Software\Microsoft\Solitaire, so a closed game opens where it was. Only on phones.
 * Styles: public/css/wm-solitaire.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'solitaire';
    const KEY = 'wmGame:solitaire';
    const SHEET = '/static_images/wm-games/solitaire/';
    const CW = 58; // card, vp
    const CH = 82;
    const TABLE = '#008000';
    const STOCK_X = 13; const TOP_Y = 8;
    const WASTE_X = 92; const FAN_DX = 19; const FAN_DY = 2;
    const FOUND_X = 211; const PITCH = 66;
    const ROW_X = 13; const ROW_Y = 100; const DOWN_DY = 6; const UP_DY = 20;
    const LAYOUT_W = 480;
    // sheet cells: 0..51 faces (suit * 13 + rank - 1), then the backs, O, X, the empty suit stack
    const CELL_BACK = 52; const CELL_O = 58; const CELL_X = 59; const CELL_SLOT = 60;
    const DOUBLE_TAP_MS = 450;
    const DRAG_START = 4; // css px before a press becomes a drag

    let ws = null;
    let page = null;
    let canvas = null;
    let ctx = null;
    let view = 'game'; // 'game' | 'options'
    let optTab = 'rules';
    let draft = null; // options being edited
    let st = null; // the game
    let opts = null;
    let undo = null;
    let drag = null;
    let lastTap = null;
    let timer = 0;
    let geo = { s: 1, ox: 0, dpr: 1, w: 0, h: 0 };
    let sheets = {}; // scale -> Image
    let resizeObs = null;
    let winAsked = false;

    // ---------------------------------------------------------------- storage

    const DEFAULT_OPTS = { draw: 3, scoring: 'standard', timed: true, status: true, cumulative: false, back: 4 };

    function load() {
        let v = null;
        try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { v = null; }
        return v && typeof v === 'object' ? v : {};
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify({ opts, game: st, bank: bank() })); } catch (_) { /* private mode */ }
    }

    let vegasBank = null; // the cumulative Vegas score carried into this game
    function bank() { return vegasBank; }

    // ---------------------------------------------------------------- the game

    const suitOf = (c) => Math.floor(c / 13); // 0 clubs, 1 diamonds, 2 hearts, 3 spades
    const rankOf = (c) => (c % 13) + 1;
    const red = (c) => suitOf(c) === 1 || suitOf(c) === 2;

    function shuffled() {
        const d = [];
        for (let i = 0; i < 52; i++) d.push(i);
        const r = new Uint32Array(52);
        try { crypto.getRandomValues(r); } catch (_) { for (let i = 0; i < 52; i++) r[i] = Math.floor(Math.random() * 2 ** 32); }
        for (let i = 51; i > 0; i--) { const j = r[i] % (i + 1); [d[i], d[j]] = [d[j], d[i]]; }
        return d;
    }

    function deal() {
        const d = shuffled();
        const rows = [];
        for (let i = 0; i < 7; i++) {
            rows.push([]);
            for (let j = 0; j <= i; j++) rows[i].push({ c: d.pop(), up: j === i });
        }
        let score = 0;
        if (opts.scoring === 'vegas') {
            if (opts.cumulative && vegasBank !== null) score = vegasBank - 52;
            else score = -52;
        }
        st = {
            stock: d.reverse(), // the deck, top card last
            waste: [],
            fan: 0, // waste cards fanned (Draw Three)
            found: [[], [], [], []],
            rows,
            score,
            seconds: 0,
            started: false,
            passes: 0, // times the deck was turned over
            won: false,
            draw: opts.draw,
            scoring: opts.scoring,
            timed: opts.timed
        };
        undo = null;
        winAsked = false;
        stopTimer();
        save();
    }

    const clone = (o) => JSON.parse(JSON.stringify(o));

    function remember() { undo = clone(st); }

    function addScore(n) {
        if (st.scoring === 'none') return;
        st.score += n;
        if (st.scoring === 'standard' && st.score < 0) st.score = 0;
    }

    function begin() {
        if (st.started || st.won) return;
        st.started = true;
        startTimer();
    }

    /** May the deck be turned over again? */
    function canRedeal() {
        if (st.scoring !== 'vegas') return true;
        return st.passes < (st.draw === 1 ? 0 : 2); // one pass (One), three (Three)
    }

    function drawCards() {
        if (st.won) return;
        if (!st.stock.length) {
            if (!st.waste.length || !canRedeal()) return;
            remember();
            begin();
            st.stock = st.waste.reverse();
            st.waste = [];
            st.fan = 0;
            st.passes++;
            if (st.scoring === 'standard') {
                if (st.draw === 1) addScore(-100);
                else if (st.passes >= 4) addScore(-20);
            }
        } else {
            remember();
            begin();
            const n = Math.min(st.draw, st.stock.length);
            for (let i = 0; i < n; i++) st.waste.push(st.stock.pop());
            st.fan = n;
        }
        changed();
    }

    function canOnRow(c, row) {
        if (!row.length) return rankOf(c) === 13;
        const top = row[row.length - 1];
        return top.up && rankOf(top.c) === rankOf(c) + 1 && red(top.c) !== red(c);
    }

    function canOnFound(c, pile) {
        if (!pile.length) return rankOf(c) === 1;
        const top = pile[pile.length - 1];
        return suitOf(top) === suitOf(c) && rankOf(c) === rankOf(top) + 1;
    }

    /** The cards a pick takes: { from: 'waste' | 'found' | 'row', i, at, cards } */
    function cardsOf(pick) {
        if (pick.from === 'waste') return [st.waste[st.waste.length - 1]];
        if (pick.from === 'found') return [st.found[pick.i][st.found[pick.i].length - 1]];
        return st.rows[pick.i].slice(pick.at).map((x) => x.c);
    }

    function takeFrom(pick) {
        if (pick.from === 'waste') {
            st.waste.pop();
            if (st.fan > 1) st.fan--;
            else st.fan = st.waste.length ? 1 : 0;
        } else if (pick.from === 'found') st.found[pick.i].pop();
        else st.rows[pick.i].splice(pick.at);
    }

    /** Move a pick to a target ({ to: 'row' | 'found', i }); false when the rules refuse it. */
    function moveTo(pick, target) {
        const cards = cardsOf(pick);
        if (!cards.length) return false;
        if (target.to === 'found') {
            if (cards.length !== 1 || (pick.from === 'found' && pick.i === target.i)) return false;
            if (!canOnFound(cards[0], st.found[target.i])) return false;
            remember();
            begin();
            takeFrom(pick);
            st.found[target.i].push(cards[0]);
            if (st.scoring === 'standard' && pick.from !== 'found') addScore(10);
            if (st.scoring === 'vegas' && pick.from !== 'found') addScore(5);
        } else {
            if (pick.from === 'row' && pick.i === target.i) return false;
            if (!canOnRow(cards[0], st.rows[target.i])) return false;
            remember();
            begin();
            takeFrom(pick);
            for (const c of cards) st.rows[target.i].push({ c, up: true });
            if (st.scoring === 'standard') {
                if (pick.from === 'waste') addScore(5);
                if (pick.from === 'found') addScore(-15);
            }
            if (st.scoring === 'vegas' && pick.from === 'found') addScore(-5);
        }
        changed();
        checkWin();
        return true;
    }

    function turnRowCard(i) {
        const row = st.rows[i];
        const top = row[row.length - 1];
        if (!top || top.up) return;
        remember();
        begin();
        top.up = true;
        if (st.scoring === 'standard') addScore(5);
        changed();
    }

    /** Double-tap: the card to its suit stack, if it goes on one. */
    function sendHome(pick) {
        const cards = cardsOf(pick);
        if (cards.length !== 1) return false;
        for (let i = 0; i < 4; i++) {
            if (canOnFound(cards[0], st.found[i])) return moveTo(pick, { to: 'found', i });
        }
        return false;
    }

    function checkWin() {
        if (st.won || st.found.some((f) => f.length !== 13)) return;
        st.won = true;
        stopTimer();
        if (st.scoring === 'standard' && st.timed && st.seconds >= 30) addScore(Math.floor(700000 / st.seconds));
        if (st.scoring === 'vegas' && opts.cumulative) vegasBank = st.score;
        save();
        paintStatus();
        askDealAgain();
    }

    async function askDealAgain() {
        if (winAsked) return;
        winAsked = true;
        const yes = await ws.messageBox({ title: 'Solitaire', text: 'Congratulations!  Deal again?', icon: 'question', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }], cancelValue: false, modal: true });
        if (yes) newGame();
    }

    function newGame() {
        // Vegas, cumulative: the money left on the table carries over
        if (st && st.scoring === 'vegas' && opts.cumulative) vegasBank = st.score;
        else if (!opts.cumulative) vegasBank = null;
        deal();
        changed();
    }

    function doUndo() {
        if (!undo) return;
        const seconds = st.seconds;
        st = undo;
        st.seconds = seconds; // the clock runs on
        undo = null;
        changed();
    }

    function changed() {
        save();
        paint();
        paintStatus();
        if (ws) ws.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- clock

    function startTimer() {
        if (timer || !st || !st.started || st.won || !visible()) return;
        timer = setInterval(() => {
            if (!st || !visible()) return;
            st.seconds++;
            if (st.timed && st.scoring === 'standard' && st.seconds % 10 === 0) addScore(-2);
            paintStatus();
            if (st.seconds % 5 === 0) save();
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timer);
        timer = 0;
    }

    const visible = () => !!(page && !page.hidden) && !document.hidden && view === 'game';

    // ---------------------------------------------------------------- geometry

    function fit() {
        if (!canvas) return;
        const box = canvas.parentElement;
        const w = Math.max(1, box.clientWidth);
        const h = Math.max(1, box.clientHeight);
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        // the device's 480 vp across the page; a wide landscape page keeps the height of the deal
        let s = w / LAYOUT_W;
        if (w > h) s = Math.min(s, h / 330);
        geo = { s, ox: Math.round((w - LAYOUT_W * s) / 2), dpr, w, h };
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        if (drag) drag.layer = false; // the drag layer is redrawn at the new size
        paint();
    }

    const toX = (vx) => geo.ox + vx * geo.s;
    const toY = (vy) => vy * geo.s;

    function stockLayers(n) { return n ? Math.min(3, 1 + Math.floor(n / 10)) : 0; }

    function stockTop() {
        const l = stockLayers(st.stock.length);
        return { x: STOCK_X + Math.max(0, l - 1) * 4, y: TOP_Y + Math.max(0, l - 1) * 2 };
    }

    function wasteShown() {
        // the cards drawn face up on the draw pile, bottom first, with their place
        const out = [];
        if (!st.waste.length) return out;
        const n = st.draw === 1 ? 1 : Math.max(1, Math.min(st.fan || 1, 3, st.waste.length));
        for (let k = 0; k < n; k++) {
            const c = st.waste[st.waste.length - n + k];
            out.push({ c, x: WASTE_X + k * FAN_DX, y: TOP_Y + k * FAN_DY });
        }
        return out;
    }

    /** Offsets of a row's cards; the face-up step closes up when the row would run off the table. */
    function rowLayout(i) {
        const row = st.rows[i];
        const room = geo.h / geo.s - 4;
        let up = UP_DY;
        const downs = row.filter((x) => !x.up).length;
        const ups = row.length - downs;
        const need = (r) => ROW_Y + downs * DOWN_DY + Math.max(0, ups - 1) * r + CH;
        while (up > 6 && need(up) > room) up--;
        const ys = [];
        let y = ROW_Y;
        row.forEach((x, k) => { ys.push(y); y += (x.up ? up : DOWN_DY); if (k === row.length - 1) ys.length = row.length; });
        return ys;
    }

    // ---------------------------------------------------------------- drawing

    function sheetFor() {
        const px = geo.s * geo.dpr; // device px per vp
        const want = px <= 0.6 ? 1 : px <= 1.25 ? 2 : 4;
        for (const k of [want, 2, 4, 1]) if (sheets[k] && sheets[k].complete && sheets[k].naturalWidth) return { img: sheets[k], k };
        return null;
    }

    function loadSheets() {
        const want = (geo.s * geo.dpr) <= 0.6 ? [1] : (geo.s * geo.dpr) <= 1.25 ? [2] : [4, 2];
        for (const k of want) {
            if (sheets[k]) continue;
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => paint();
            img.src = SHEET + (k === 1 ? 'cards.png' : k === 2 ? 'cards@2x.png' : 'cards@4x.webp');
            sheets[k] = img;
        }
    }

    function cell(ctxx, sh, n, vx, vy) {
        const cw = 29 * sh.k;
        const chh = 41 * sh.k;
        const sx = (n % 13) * cw;
        const sy = Math.floor(n / 13) * chh;
        ctxx.drawImage(sh.img, sx, sy, cw, chh, toX(vx) * geo.dpr, toY(vy) * geo.dpr, CW * geo.s * geo.dpr, CH * geo.s * geo.dpr);
    }

    function paint() {
        if (!ctx || !st) return;
        loadSheets();
        const sh = sheetFor();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = TABLE;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!sh) return;
        const back = CELL_BACK + Math.max(0, Math.min(5, (opts.back || 4) - 1));
        const lifted = drag && drag.active ? drag : null;
        // the deck
        const n = st.stock.length;
        if (!n) cell(ctx, sh, canRedeal() ? CELL_O : CELL_X, STOCK_X, TOP_Y);
        else for (let k = 0; k < stockLayers(n); k++) cell(ctx, sh, back, STOCK_X + k * 4, TOP_Y + k * 2);
        // the draw pile
        const shown = wasteShown();
        shown.forEach((w, k) => {
            if (lifted && lifted.pick.from === 'waste' && k === shown.length - 1) return;
            cell(ctx, sh, w.c, w.x, w.y);
        });
        // suit stacks
        for (let i = 0; i < 4; i++) {
            const f = st.found[i];
            const x = FOUND_X + i * PITCH;
            let top = f.length - 1;
            if (lifted && lifted.pick.from === 'found' && lifted.pick.i === i) top--;
            cell(ctx, sh, top >= 0 ? f[top] : CELL_SLOT, x, TOP_Y);
        }
        // row stacks
        for (let i = 0; i < 7; i++) {
            const ys = rowLayout(i);
            const row = st.rows[i];
            const end = lifted && lifted.pick.from === 'row' && lifted.pick.i === i ? lifted.pick.at : row.length;
            for (let k = 0; k < end; k++) cell(ctx, sh, row[k].up ? row[k].c : back, ROW_X + i * PITCH, ys[k]);
        }
        // the cards under the pen
        if (lifted) {
            lifted.cards.forEach((c, k) => cell(ctx, sh, c, lifted.vx, lifted.vy + k * UP_DY));
        }
    }

    // While cards are dragged the table under them does not change: it is kept as a layer and each
    // pen move copies it and draws only the lifted cards.
    let dragLayer = null;
    function paintDrag() {
        const sh = sheetFor();
        if (!sh || !drag || !drag.active) { paint(); return; }
        if (!drag.layer) {
            const keep = drag.vx;
            dragLayer = dragLayer || document.createElement('canvas');
            dragLayer.width = canvas.width;
            dragLayer.height = canvas.height;
            const lifted = drag;
            drag = Object.assign({}, lifted, { cards: [] }); // the table with the lifted cards taken off
            paint();
            dragLayer.getContext('2d').drawImage(canvas, 0, 0);
            drag = lifted;
            drag.vx = keep;
            drag.layer = true;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(dragLayer, 0, 0);
        drag.cards.forEach((c, k) => cell(ctx, sh, c, drag.vx, drag.vy + k * UP_DY));
    }

    function paintStatus() {
        if (!page || !st) return;
        const bar = page.querySelector('.wsol-status');
        bar.hidden = !opts.status;
        const show = (sel, on, text) => {
            const el = bar.querySelector(sel);
            el.hidden = !on;
            if (text !== undefined) el.textContent = text;
        };
        show('.wsol-time-l', st.timed);
        show('.wsol-time', st.timed, String(st.seconds));
        const money = st.scoring === 'vegas';
        show('.wsol-score-l', st.scoring !== 'none');
        show('.wsol-score', st.scoring !== 'none', money ? `${st.score < 0 ? '-' : ''}$${Math.abs(st.score)}` : String(st.score));
    }

    // ---------------------------------------------------------------- input

    function hit(vx, vy) {
        const inCard = (x, y) => vx >= x && vx < x + CW && vy >= y && vy < y + CH;
        // row stacks, top card first
        for (let i = 0; i < 7; i++) {
            const row = st.rows[i];
            const ys = rowLayout(i);
            for (let k = row.length - 1; k >= 0; k--) {
                if (inCard(ROW_X + i * PITCH, ys[k])) {
                    if (!row[k].up) return k === row.length - 1 ? { kind: 'turn', i } : null;
                    return { kind: 'card', pick: { from: 'row', i, at: k }, x: ROW_X + i * PITCH, y: ys[k] };
                }
            }
        }
        const t = stockTop();
        if (vx >= STOCK_X && vx < t.x + CW && vy >= TOP_Y && vy < t.y + CH) return { kind: 'stock' };
        const shown = wasteShown();
        const top = shown[shown.length - 1];
        if (top && inCard(top.x, top.y)) return { kind: 'card', pick: { from: 'waste' }, x: top.x, y: top.y };
        for (let i = 0; i < 4; i++) {
            if (st.found[i].length && inCard(FOUND_X + i * PITCH, TOP_Y)) return { kind: 'card', pick: { from: 'found', i }, x: FOUND_X + i * PITCH, y: TOP_Y };
        }
        return null;
    }

    /** Where dragged cards land: the pile whose card the dragged one overlaps most. */
    function dropTarget(vx, vy) {
        const area = (x, y) => Math.max(0, Math.min(vx + CW, x + CW) - Math.max(vx, x)) * Math.max(0, Math.min(vy + CH, y + CH) - Math.max(vy, y));
        let best = null;
        let bestA = 0;
        for (let i = 0; i < 4; i++) {
            const a = area(FOUND_X + i * PITCH, TOP_Y);
            if (a > bestA) { bestA = a; best = { to: 'found', i }; }
        }
        for (let i = 0; i < 7; i++) {
            const ys = rowLayout(i);
            const y = st.rows[i].length ? ys[ys.length - 1] : ROW_Y;
            const a = area(ROW_X + i * PITCH, y);
            if (a > bestA) { bestA = a; best = { to: 'row', i }; }
        }
        return best;
    }

    function vpOf(e) {
        const r = canvas.getBoundingClientRect();
        return { vx: (e.clientX - r.left - geo.ox) / geo.s, vy: (e.clientY - r.top) / geo.s, cx: e.clientX, cy: e.clientY };
    }

    function onDown(e) {
        if (view !== 'game' || !st || drag) return;
        if (e.button !== undefined && e.button !== 0) return;
        const p = vpOf(e);
        const h = hit(p.vx, p.vy);
        if (!h) return;
        e.preventDefault();
        // the deck and a face-down card act on pen down, as the device does
        if (h.kind === 'stock') { drawCards(); return; }
        if (h.kind === 'turn') { turnRowCard(h.i); return; }
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        drag = { pick: h.pick, cards: cardsOf(h.pick), gx: p.vx - h.x, gy: p.vy - h.y, vx: h.x, vy: h.y, sx: p.cx, sy: p.cy, active: false, id: e.pointerId };
    }

    function onMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const p = vpOf(e);
        if (!drag.active && Math.hypot(p.cx - drag.sx, p.cy - drag.sy) < DRAG_START) return;
        drag.active = true;
        drag.vx = p.vx - drag.gx;
        drag.vy = p.vy - drag.gy;
        e.preventDefault();
        paintDrag();
    }

    function onUp(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        if (d.active) {
            const t = dropTarget(d.vx, d.vy);
            if (!(t && moveTo(d.pick, t))) paint(); // back at once, as the device puts it back
            lastTap = null;
            return;
        }
        // a tap; two on the same card send it home
        const now = performance.now();
        const same = lastTap && now - lastTap.t < DOUBLE_TAP_MS && JSON.stringify(lastTap.pick) === JSON.stringify(d.pick);
        if (same) { lastTap = null; sendHome(d.pick); return; }
        lastTap = { t: now, pick: d.pick };
    }

    function onCancel() {
        if (!drag) return;
        drag = null;
        paint();
    }

    function onKey(e) {
        if (!page || page.hidden || view !== 'game' || e.defaultPrevented) return;
        if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drawCards(); }
    }

    // ---------------------------------------------------------------- options

    function openOptions() {
        draft = Object.assign({}, opts);
        optTab = 'rules';
        view = 'options';
        stopTimer();
        renderOptions();
        page.dataset.view = 'options';
        ws.syncHistory();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    function renderOptions() {
        const box = page.querySelector('.wsol-options');
        const esc = ws.escapeHtml;
        const drawLabel = draft.draw === 1 ? 'One card' : 'Three cards';
        const scoreLabel = { standard: 'Standard', vegas: 'Vegas', none: 'None' }[draft.scoring];
        const check = (k, label, on, disabled) => `<label class="wm-check"><input type="checkbox" data-opt="${k}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}><span>${esc(label)}</span></label>`;
        const rules = `<div class="wsol-rules"${optTab === 'rules' ? '' : ' hidden'}>`
            + `<div class="wsol-row"><span>Draw:</span><button type="button" class="wm-combo" data-act="draw"><span>${esc(drawLabel)}</span></button></div>`
            + `<div class="wsol-row"><span>Scoring:</span><button type="button" class="wm-combo" data-act="scoring"><span>${esc(scoreLabel)}</span></button></div>`
            + check('timed', 'Time game', draft.timed, false)
            + check('status', 'Display status', draft.status, false)
            + check('cumulative', 'Keep cumulative score', draft.cumulative && draft.scoring === 'vegas', draft.scoring !== 'vegas')
            + '</div>';
        let backs = '';
        for (let i = 1; i <= 6; i++) {
            backs += `<button type="button" class="wsol-back${draft.back === i ? ' is-selected' : ''}" data-back="${i}" aria-label="Card back ${i}" aria-pressed="${draft.back === i}"><i style="--n:${i - 1}"></i></button>`;
        }
        const cardBack = `<div class="wsol-cardback"${optTab === 'back' ? '' : ' hidden'}><p>Select a card back:</p><div class="wsol-backs">${backs}</div></div>`;
        box.innerHTML = '<div class="wm-form-hdr">Options</div>'
            + `<div class="wsol-opt-body">${rules}${cardBack}</div>`
            + '<div class="wm-tabs" role="tablist">'
            + `<button type="button" class="wm-tab" role="tab" data-tab="rules" aria-selected="${optTab === 'rules'}">Game Rules</button>`
            + `<button type="button" class="wm-tab" role="tab" data-tab="back" aria-selected="${optTab === 'back'}">Card Back</button></div>`;
        box.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { optTab = t.dataset.tab; renderOptions(); }));
        box.querySelectorAll('input[data-opt]').forEach((inp) => inp.addEventListener('change', () => {
            draft[inp.dataset.opt] = inp.checked;
        }));
        box.querySelectorAll('.wsol-back').forEach((b) => b.addEventListener('click', () => { draft.back = Number(b.dataset.back); renderOptions(); }));
        box.querySelectorAll('.wm-combo').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.dataset.act;
            const pick = (k, v) => { draft[k] = v; if (k === 'scoring' && v !== 'vegas') draft.cumulative = false; renderOptions(); };
            const rows = act === 'draw'
                ? [{ label: 'One card', radio: draft.draw === 1, action: () => pick('draw', 1) }, { label: 'Three cards', radio: draft.draw === 3, action: () => pick('draw', 3) }]
                : [['standard', 'Standard'], ['vegas', 'Vegas'], ['none', 'None']].map(([k, l]) => ({ label: l, radio: draft.scoring === k, action: () => pick('scoring', k) }));
            ws.dropdown(b, rows, 'left');
        }));
    }

    /** ok: the options take effect; a new draw or scoring rule deals a new game (as Windows did). */
    function closeOptions(apply) {
        if (view !== 'options') return;
        const before = opts;
        if (apply && draft) {
            opts = Object.assign({}, draft);
            if (!opts.cumulative) vegasBank = null;
        }
        draft = null;
        view = 'game';
        page.dataset.view = 'game';
        page.querySelector('.wsol-options').innerHTML = '';
        if (apply && (before.draw !== opts.draw || before.scoring !== opts.scoring)) {
            deal();
        } else if (st) {
            if (st.timed !== opts.timed) { st.timed = opts.timed; }
        }
        save();
        fit();
        paintStatus();
        startTimer();
        ws.syncHistory();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wm-solitaire');
        p.dataset.view = 'game';
        p.innerHTML = '<div class="wsol-table"><canvas class="wsol-canvas" aria-label="Solitaire table"></canvas></div>'
            + '<div class="wsol-status"><span class="wsol-time-l">Time:</span><span class="wsol-time">0</span><span class="wsol-score-l">Score:</span><span class="wsol-score">0</span></div>'
            + '<div class="wsol-options"></div>';
        canvas = p.querySelector('.wsol-canvas');
        ctx = canvas.getContext('2d', { alpha: false });
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onCancel);
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('keydown', onKey);
        document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTimer(); save(); } else startTimer(); });
        if (typeof ResizeObserver === 'function') {
            resizeObs = new ResizeObserver(() => fit());
            resizeObs.observe(p.querySelector('.wsol-table'));
        }
        const saved = load();
        opts = Object.assign({}, DEFAULT_OPTS, saved.opts || {});
        vegasBank = typeof saved.bank === 'number' ? saved.bank : null;
        if (saved.game && Array.isArray(saved.game.rows) && saved.game.rows.length === 7) st = saved.game;
        else deal();
    }

    function show() {
        if (view === 'game') {
            fit();
            paintStatus();
            startTimer();
        }
    }

    function hide() {
        stopTimer();
        if (drag) onCancel();
        save();
    }

    function init() {
        ws = window.wmShell;
        if (!ws) return;
        ws.registerApp({
            id: APP_ID,
            title: 'Solitaire',
            icon: 'app-solitaire',
            art65: 'solitaire',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show,
            hide,
            softKeys() {
                if (view === 'options') return { left: null, right: null };
                return {
                    left: { label: 'Draw', action: () => drawCards() },
                    right: {
                        label: 'Menu',
                        menu: () => [
                            { label: 'Undo', disabled: !undo, action: () => doUndo() },
                            { label: 'New Game', action: () => newGame() },
                            { label: 'Options...', action: () => openOptions() }
                        ]
                    }
                };
            },
            titleKind: () => (view === 'options' ? 'ok' : 'close'),
            onTitleOk() { if (view === 'options') { closeOptions(true); return true; } return false; },
            historyDepth: () => (view === 'options' ? 1 : 0),
            onBack() { if (view === 'options') { closeOptions(true); return true; } return false; }
        });
    }

    if (window.wmShell) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
