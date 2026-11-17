#!/usr/bin/env node
/*
 * Nightshade Network icons (Yozora #895): the service's mark is a full orange square with a
 * stylised N (Yukimi, Nov 16 2026). Square corners, stepped shading in a few flat tones (no
 * airbrush, no gloss sweep, no rounded crop).
 *
 *   public/static_images/vista-icons/nightshade-{16,32,48,256}.png   desktop tray, status panel, Control Panel
 *   public/static_images/vista-icons/nightshade-alert-{16,32}.png    the red ! laid over the tray icon
 *                                                                     (10 / 20 px: the wallet alert's spot)
 *   public/static_images/wm61/set-nightshade{,@2x,@4x}.png           Settings > Connections applet (32 / 64 / 128)
 *   public/static_images/wm61/status-nightshade{,@2x,@4x}.png        the phone's title-bar glyph: 1-bit white,
 *                                                                     drawn at 2x on the mail glyph's rows (6..29)
 *                                                                     like generate-wm-continuity-status-icon.py
 *
 * 16 px is hand-placed pixels; the larger sizes are drawn on a 32-unit grid, 8x supersampled.
 * Usage: node scripts/generate-nightshade-icons.js   (rerun scripts/build-wm-status-atlas.py after)
 */
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const ROOT = path.join(__dirname, '..', 'public', 'static_images');
const VISTA = path.join(ROOT, 'vista-icons');
const WM = path.join(ROOT, 'wm61');

// tones, light to dark (stepped bands, not a gradient)
const C = {
    rim: '#8f3a00', // outer edge
    hi: '#ffb45a', // top highlight row
    band1: '#ff9a2e',
    band2: '#f98418',
    band3: '#ec6f06',
    band4: '#d85f00',
    shadow: '#a94600', // the N's drop shadow
    n: '#ffffff'
};

// the N on the 32-unit grid: a standard N sheared to the right (stylised: italic, sharp diagonal)
const N_POLY = [[8, 24], [8, 8], [12.6, 8], [19.4, 17.6], [19.4, 8], [24, 8], [24, 24], [19.4, 24], [12.6, 14.4], [12.6, 24]];
const SHEAR = 0.16; // x moves right by SHEAR per unit up from the baseline (y = 24)
const sheared = (pts) => pts.map(([x, y]) => [x + (24 - y) * SHEAR - 1.3, y]);

function drawLarge(size) {
    const SS = 8;
    const big = createCanvas(size * SS, size * SS);
    const g = big.getContext('2d');
    const u = (size * SS) / 32;
    const rect = (x0, y0, x1, y1, fill) => { g.fillStyle = fill; g.fillRect(x0 * u, y0 * u, (x1 - x0) * u, (y1 - y0) * u); };
    // square 1..31, rim 1 unit (at 32 px: one pixel)
    rect(1, 1, 31, 31, C.rim);
    const px = 32 / size; // one device pixel in units
    const inner = [1 + px, 1 + px, 31 - px, 31 - px];
    // four flat bands top to bottom, a one-pixel highlight row on top
    const h = inner[3] - inner[1];
    const bands = [C.band1, C.band2, C.band3, C.band4];
    bands.forEach((col, i) => rect(inner[0], inner[1] + (h * i) / 4, inner[2], inner[1] + (h * (i + 1)) / 4 + (i < 3 ? px : 0), col));
    rect(inner[0], inner[1], inner[2], inner[1] + px, C.hi);
    rect(inner[0], inner[1], inner[0] + px, inner[3], C.band1); // lit left edge
    // the N: shadow one pixel down-right (at least 1 unit), then white
    const poly = (pts, dx, dy, fill) => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, (x + dx) * u, (y + dy) * u));
        g.closePath();
        g.fillStyle = fill;
        g.fill();
    };
    const off = Math.max(px, 1);
    poly(sheared(N_POLY), off, off, C.shadow);
    poly(sheared(N_POLY), 0, 0, C.n);
    const out = createCanvas(size, size);
    const o = out.getContext('2d');
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'high';
    o.drawImage(big, 0, 0, size, size);
    return out;
}

// 16 px by hand: the N's white pixels (rows 4..11, stems 2 px, the diagonal 2 px stepping every two
// rows); rim, highlight row, four bands and the shadow (one pixel down-right of the N) are computed
const N16 = {
    4: [4, 5, 6, 10, 11],
    5: [4, 5, 6, 7, 10, 11],
    6: [4, 5, 6, 7, 10, 11],
    7: [4, 5, 7, 8, 10, 11],
    8: [4, 5, 7, 8, 10, 11],
    9: [4, 5, 8, 9, 10, 11],
    10: [4, 5, 8, 9, 10, 11],
    11: [4, 5, 9, 10, 11]
};

function drawSmall() {
    const cv = createCanvas(16, 16);
    const g = cv.getContext('2d');
    const white = (x, y) => (N16[y] || []).includes(x);
    const band = (y) => (y <= 2 ? C.hi : y <= 5 ? C.band1 : y <= 8 ? C.band2 : y <= 11 ? C.band3 : C.band4);
    for (let y = 1; y <= 14; y++) {
        for (let x = 1; x <= 14; x++) {
            let col;
            if (x === 1 || x === 14 || y === 1 || y === 14) col = C.rim;
            else if (white(x, y)) col = C.n;
            else if (white(x - 1, y - 1)) col = C.shadow;
            else if (x === 2 && y > 2) col = C.band1;
            else col = band(y);
            g.fillStyle = col;
            g.fillRect(x, y, 1, 1);
        }
    }
    return cv;
}

// the red !: a red disc with a dark rim and a white exclamation mark (Yukimi: "a red exclamation icon")
function drawAlert(size) {
    const SS = 8;
    const big = createCanvas(size * SS, size * SS);
    const g = big.getContext('2d');
    const s = size * SS;
    const r = s / 2;
    g.fillStyle = '#7d0b0b';
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c81414';
    g.beginPath(); g.arc(r, r, r - s / size, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e83a3a'; // lit upper half, one flat step
    g.beginPath(); g.arc(r, r, r - s / size, Math.PI, 0); g.fill();
    g.fillStyle = '#ffffff';
    const w = s * 0.2;
    g.fillRect(r - w / 2, s * 0.17, w, s * 0.42);
    g.fillRect(r - w / 2, s * 0.67, w, s * 0.16);
    const out = createCanvas(size, size);
    const o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    o.drawImage(big, 0, 0, size, size);
    return out;
}

// the phone's title-bar glyph: a square outline with a solid N inside, 1-bit white, 2 px strokes at 2x
function glyphOn(x, y) {
    const sq = [4, 6, 28, 30]; // x0, y0, x1, y1 (rows 6..29)
    const inSq = x >= sq[0] && x < sq[2] && y >= sq[1] && y < sq[3];
    if (!inSq) return false;
    if (!(x >= sq[0] + 2 && x < sq[2] - 2 && y >= sq[1] + 2 && y < sq[3] - 2)) return true; // outline
    // N inside with a 2 px gap from the outline: stems x 10..13 and 19..22, rows 11..25
    if (y < 11 || y >= 25) return false;
    if (x >= 10 && x < 13) return true;
    if (x >= 19 && x < 22) return true;
    // the diagonal from the left stem's top to the right stem's foot, 3 px wide
    const t = (y - 11) / 14; // 0 at top, 1 at bottom
    const cx = 11.5 + t * 9;
    return Math.abs(x + 0.5 - cx) < 1.6;
}

function writeGlyph() {
    const W = 32;
    const g2 = [];
    for (let y = 0; y < W; y++) { g2.push([]); for (let x = 0; x < W; x++) g2[y].push(glyphOn(x, y) ? 1 : 0); }
    const g1 = [];
    for (let y = 0; y < 16; y++) {
        g1.push([]);
        for (let x = 0; x < 16; x++) g1[y].push(g2[2 * y][2 * x] + g2[2 * y][2 * x + 1] + g2[2 * y + 1][2 * x] + g2[2 * y + 1][2 * x + 1] >= 2 ? 1 : 0);
    }
    const g4 = [];
    for (let y = 0; y < 64; y++) { g4.push([]); for (let x = 0; x < 64; x++) g4[y].push(g2[y >> 1][x >> 1]); }
    const put = (grid, size, file) => {
        const cv = createCanvas(size, size);
        const g = cv.getContext('2d');
        g.fillStyle = '#ffffff';
        grid.forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect(x, y, 1, 1); }));
        fs.writeFileSync(path.join(WM, file), cv.toBuffer('image/png'));
        console.log(path.join('wm61', file));
    };
    put(g1, 16, 'status-nightshade.png');
    put(g2, 32, 'status-nightshade@2x.png');
    put(g4, 64, 'status-nightshade@4x.png');
}

function save(dir, file, cv) {
    fs.writeFileSync(path.join(dir, file), cv.toBuffer('image/png'));
    console.log(path.join(path.basename(dir), file));
}

save(VISTA, 'nightshade-16.png', drawSmall());
for (const s of [32, 48, 256]) save(VISTA, `nightshade-${s}.png`, drawLarge(s));
save(VISTA, 'nightshade-alert-16.png', drawAlert(10));
save(VISTA, 'nightshade-alert-32.png', drawAlert(20));
save(WM, 'set-nightshade.png', drawLarge(32));
save(WM, 'set-nightshade@2x.png', drawLarge(64));
save(WM, 'set-nightshade@4x.png', drawLarge(128));
writeGlyph();
