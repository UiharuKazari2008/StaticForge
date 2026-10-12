/**
 * Dreamscape Mainframe Server (Yozora #431): the small window that shows the server's own boot
 * progress at the logon screen (first boot and the restart lock), styled like a vendor's
 * winlogon hook that keeps directory clients off the custom AD DS implementation while it
 * restarts. websocket.js _updatePreStartupStageProgress drives it from /status and
 * /status/stream; the logon dialog itself never shows a bar.
 *
 *   mainframeServerWindow.update(percent, stageMessage)   open / refresh
 *   mainframeServerWindow.hide()
 *
 * The icon is an old-school custom animated "building blocks" icon (256-colour look, drawn on
 * a 48 px canvas, pixelated when scaled): tetrominoes fall one by one and build up until the
 * well is exactly full, flash, clear, and start again with a new arrangement. Each round is a
 * fresh tiling of the 8 x 8 well (tileWell) where every piece lands on the floor or on blocks
 * already there, so nothing overhangs, floats or overflows.
 */
(function (root) {
    'use strict';

    const COLS = 8;
    const ROWS = 8;
    const CELL = 5;
    const BORDER = 4;              // 2 px sunken bevel + 2 px gap around the well
    const SIZE = COLS * CELL + BORDER * 2; // 48
    const FALL_MS = 55;            // one row per tick
    const FLASH_MS = 120;
    const HOLD_MS = 700;
    const CLEAR_ROW_MS = 60;

    // y grows upwards (0 = floor) while building; flipped when drawn
    const BASE_SHAPES = {
        I: [[0, 0], [1, 0], [2, 0], [3, 0]],
        O: [[0, 0], [1, 0], [0, 1], [1, 1]],
        T: [[0, 0], [1, 0], [2, 0], [1, 1]],
        S: [[0, 0], [1, 0], [1, 1], [2, 1]],
        Z: [[1, 0], [2, 0], [0, 1], [1, 1]],
        J: [[0, 0], [1, 0], [2, 0], [0, 1]],
        L: [[0, 0], [1, 0], [2, 0], [2, 1]]
    };

    // VGA-ish 256-colour palette, one per piece, with bevel tones
    const COLORS = {
        I: '#00c8d0', O: '#f0d000', T: '#b800b8', S: '#20b020', Z: '#d01818', J: '#2040e0', L: '#f08000'
    };

    function shade(hex, amount) {
        const n = parseInt(hex.slice(1), 16);
        const mix = (c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
        const r = mix((n >> 16) & 255);
        const g = mix((n >> 8) & 255);
        const b = mix(n & 255);
        return `rgb(${r}, ${g}, ${b})`;
    }

    function normalize(cells) {
        const minX = Math.min(...cells.map((c) => c[0]));
        const minY = Math.min(...cells.map((c) => c[1]));
        return cells.map(([x, y]) => [x - minX, y - minY]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    }

    /** Every distinct rotation of every piece, with its bottom profile per column. */
    const ORIENTATIONS = (() => {
        const out = [];
        Object.entries(BASE_SHAPES).forEach(([type, base]) => {
            const seen = new Set();
            let cells = base;
            for (let r = 0; r < 4; r++) {
                const norm = normalize(cells);
                const key = JSON.stringify(norm);
                if (!seen.has(key)) {
                    seen.add(key);
                    const width = Math.max(...norm.map((c) => c[0])) + 1;
                    const bottom = [];
                    const top = [];
                    for (let x = 0; x < width; x++) {
                        const ys = norm.filter((c) => c[0] === x).map((c) => c[1]);
                        bottom.push(Math.min(...ys));
                        top.push(Math.max(...ys));
                    }
                    out.push({ type, cells: norm, width, bottom, top });
                }
                cells = cells.map(([x, y]) => [y, -x]);
            }
        });
        return out;
    })();

    function shuffled(list, rand) {
        const copy = list.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    /**
     * Fill a cols x rows well with tetrominoes in a droppable order: each column stays a solid
     * stack from the floor, every piece rests exactly on the stacks under it and nothing passes
     * the rim. Returns [{ type, cells: [[x, y]...] (y from the floor), x, y }] in drop order, or
     * null when the size cannot be tiled (cols * rows must be a multiple of 4).
     */
    function tileWell(cols = COLS, rows = ROWS, rand = Math.random) {
        if ((cols * rows) % 4 !== 0) return null;
        const heights = new Array(cols).fill(0);
        const placed = [];
        let budget = 200000; // backtracking steps

        function solve() {
            if (--budget < 0) return false;
            let target = -1;
            for (let c = 0; c < cols; c++) {
                if (heights[c] < rows && (target < 0 || heights[c] < heights[target])) target = c;
            }
            if (target < 0) return true; // full
            for (const o of shuffled(ORIENTATIONS, rand)) {
                // every horizontal offset that covers the lowest column
                for (let dx = 0; dx < o.width; dx++) {
                    const x0 = target - dx;
                    if (x0 < 0 || x0 + o.width > cols) continue;
                    const base = heights[x0] - o.bottom[0];
                    let fits = base >= 0;
                    for (let i = 0; fits && i < o.width; i++) {
                        if (heights[x0 + i] - o.bottom[i] !== base) fits = false;
                        else if (base + o.top[i] >= rows) fits = false;
                    }
                    if (!fits) continue;
                    for (let i = 0; i < o.width; i++) heights[x0 + i] = base + o.top[i] + 1;
                    placed.push({ type: o.type, cells: o.cells, x: x0, y: base });
                    if (solve()) return true;
                    placed.pop();
                    for (let i = 0; i < o.width; i++) heights[x0 + i] = base + o.bottom[i];
                }
            }
            return false;
        }

        return solve() ? placed : null;
    }

    // ---- the animated icon ----------------------------------------------------------------

    function createBlocksIcon(canvas) {
        const ctx = canvas.getContext('2d');
        let pieces = [];
        let index = 0;
        let fallY = 0;            // current piece's y while falling
        let phase = 'fall';       // fall | flash | hold | clear
        let phaseTick = 0;
        let clearedRows = 0;
        let timer = null;
        const reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

        function newRound() {
            pieces = tileWell(COLS, ROWS) || [];
            index = 0;
            fallY = ROWS;
            phase = 'fall';
            phaseTick = 0;
            clearedRows = 0;
        }

        function drawCell(x, y, color, bright) {
            // y from the floor → canvas rows from the top
            const px = BORDER + x * CELL;
            const py = BORDER + (ROWS - 1 - y) * CELL;
            if (py < BORDER) return; // above the rim (still falling in)
            ctx.fillStyle = bright ? shade(color, 0.55) : color;
            ctx.fillRect(px, py, CELL, CELL);
            ctx.fillStyle = shade(color, bright ? 0.8 : 0.5);
            ctx.fillRect(px, py, CELL, 1);
            ctx.fillRect(px, py, 1, CELL);
            ctx.fillStyle = shade(color, -0.5);
            ctx.fillRect(px, py + CELL - 1, CELL, 1);
            ctx.fillRect(px + CELL - 1, py, 1, CELL);
        }

        function drawFrame() {
            ctx.clearRect(0, 0, SIZE, SIZE);
            // sunken well: dark top / left, light bottom / right
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, SIZE, 1);
            ctx.fillRect(0, 0, 1, SIZE);
            ctx.fillStyle = '#404040';
            ctx.fillRect(1, 1, SIZE - 2, 1);
            ctx.fillRect(1, 1, 1, SIZE - 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, SIZE - 1, SIZE, 1);
            ctx.fillRect(SIZE - 1, 0, 1, SIZE);
            ctx.fillStyle = '#dfdfdf';
            ctx.fillRect(1, SIZE - 2, SIZE - 2, 1);
            ctx.fillRect(SIZE - 2, 1, 1, SIZE - 2);
            ctx.fillStyle = '#000028';
            ctx.fillRect(2, 2, SIZE - 4, SIZE - 4);
            // faint grid dots, like the old well backgrounds
            ctx.fillStyle = '#10104a';
            for (let x = 1; x < COLS; x++) {
                for (let y = 1; y < ROWS; y++) ctx.fillRect(BORDER + x * CELL, BORDER + y * CELL, 1, 1);
            }
        }

        function render() {
            drawFrame();
            const bright = phase === 'flash' && phaseTick % 2 === 0;
            const landed = phase === 'fall' ? index : pieces.length;
            for (let i = 0; i < landed; i++) {
                const p = pieces[i];
                p.cells.forEach(([cx, cy]) => {
                    const y = p.y + cy;
                    if (phase === 'clear' && y >= ROWS - clearedRows) return;
                    drawCell(p.x + cx, y, COLORS[p.type], bright);
                });
            }
            if (phase === 'fall' && index < pieces.length) {
                const p = pieces[index];
                p.cells.forEach(([cx, cy]) => drawCell(p.x + cx, fallY + cy, COLORS[p.type], false));
            }
        }

        function tick() {
            phaseTick++;
            if (phase === 'fall') {
                const p = pieces[index];
                if (!p) {
                    phase = 'flash';
                    phaseTick = 0;
                } else if (fallY > p.y) {
                    fallY--;
                } else {
                    index++;
                    fallY = ROWS;
                }
            } else if (phase === 'flash') {
                if (phaseTick * FALL_MS >= FLASH_MS * 4) {
                    phase = 'hold';
                    phaseTick = 0;
                }
            } else if (phase === 'hold') {
                if (phaseTick * FALL_MS >= HOLD_MS) {
                    phase = 'clear';
                    phaseTick = 0;
                }
            } else if (phase === 'clear') {
                if (phaseTick * FALL_MS >= CLEAR_ROW_MS) {
                    phaseTick = 0;
                    clearedRows++;
                    if (clearedRows > ROWS) newRound();
                }
            }
            render();
        }

        function start() {
            if (timer) return;
            if (!pieces.length) newRound();
            if (reduced) {
                index = pieces.length;
                phase = 'hold';
                render();
                return;
            }
            render();
            timer = setInterval(tick, FALL_MS);
        }

        function stop() {
            if (timer) clearInterval(timer);
            timer = null;
        }

        return { start, stop, render };
    }

    // ---- the window --------------------------------------------------------------------------

    const doc = typeof document !== 'undefined' ? document : null;
    let modal = null;
    let icon = null;

    function el(selector) {
        return modal ? modal.querySelector(selector) : null;
    }

    function ensureModal() {
        if (modal || !doc) return modal;
        modal = doc.createElement('div');
        modal.id = 'mainframeServerModal';
        modal.className = 'modal hidden on-top boot-dialog vpn-dialog mainframe-server-modal';
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.setAttribute('role', 'dialog');
        modal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main"><span>Dreamscape Mainframe Server</span></div>
            </div>
            <div class="modal-window-controls"></div>
            <div class="modal-content vpn-dialog-content mainframe-content">
                <canvas class="mainframe-blocks" width="${SIZE}" height="${SIZE}" aria-hidden="true"></canvas>
                <div class="mainframe-text">
                    <p class="mainframe-heading">The domain controller is starting.</p>
                    <p class="mainframe-sub">Logons are held until the directory is ready.</p>
                    <p class="mainframe-stage"></p>
                    <div role="progressbar" class="mainframe-progress" aria-valuemin="0" aria-valuemax="100">
                        <div class="mainframe-bar"></div>
                    </div>
                </div>
            </div>`;
        doc.body.appendChild(modal);
        icon = createBlocksIcon(el('.mainframe-blocks'));
        return modal;
    }

    function isOpen() {
        return !!(modal && !modal.classList.contains('hidden') && !modal.classList.contains('closing'));
    }

    function update(percent, stageMessage) {
        if (!ensureModal()) return;
        const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        const stage = String(stageMessage || '').replace(/\s*\(\d+%\)\s*$/, '');
        el('.mainframe-stage').textContent = stage ? `${stage} (${pct}%)` : `${pct}%`;
        el('.mainframe-bar').style.width = `${pct}%`;
        el('.mainframe-progress').setAttribute('aria-valuenow', String(pct));
        if (!isOpen()) {
            if (typeof root.openModal === 'function') root.openModal(modal);
            else modal.classList.remove('hidden');
            // Bottom-right quadrant, off the grid (melatonNetworkDialogs.placeLogonWindow)
            if (root.melatonNetworkDialogs) root.melatonNetworkDialogs.placeLogonWindow(modal, 'mainframe');
            icon.start();
        }
    }

    function hide() {
        if (icon) icon.stop();
        if (!isOpen()) return;
        if (typeof root.closeModal === 'function') root.closeModal(modal);
        else modal.classList.add('hidden');
    }

    const api = { update, hide, isOpen, tileWell, ORIENTATIONS, _test: { createBlocksIcon, SIZE } };
    if (root) root.mainframeServerWindow = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
