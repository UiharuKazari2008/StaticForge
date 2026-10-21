#!/usr/bin/env node
/**
 * Art for the two arcade games that sit with the Vista games (Yozora #609): Block Drop
 * (public/scripts/comp/desktop-apps/vista-games/blockdrop.js) and Brick Breaker
 * (public/scripts/comp/desktop-apps/vista-games/brickbreaker.js). Vista never shipped them, so
 * the art is made here in the family of the real games (Oberon's glossy, soft-lit sprites):
 *
 *   - Block Drop's blocks are Minesweeper's own glossy tile (Tiles_Normal of the Silver and Blue
 *     board, minesweeper/sheets/bluesheet1.webp + @2x) recoloured per piece through its
 *     luminance, so the bevel, the gloss and the 1 px dark edge are the original's
 *   - Brick Breaker's bricks, paddle, ball and capsules are drawn with node-canvas: gradients, a
 *     gloss highlight and a 1 px dark outline, at 1x and 2x
 *   - the icons (16 / 48 px for the title bar and Games Explorer, the 256 px master the Start
 *     menu reads) are glossy 3D objects on transparency, as the Vista game icons are
 *
 * Output (the engine's pack layout, public/scripts/comp/desktop-apps/vista-games/
 * vistaGameEngine.js VG.loadPack):
 *
 *   public/static_images/vista-games/<game>/sheets/<sheet>.webp + <sheet>@2x.webp
 *   public/static_images/vista-games/<game>/data.json   { sheets, xml, audio: {}, images: {}, mui }
 *   public/static_images/vista-games/icons/<game>-16.png, <game>-48.png
 *   public/static_images/app_icons/vista-<game>.png      256 px
 *
 * Each sheet frame carries 1 px of padding (2 px at 2x) copied from its edge, as the engine's
 * PreppedForFilter sheets do; the 2x sheet is the 1x layout at twice the size. The games keep
 * their strings, menus and dialogs in their scripts (the display names are one constant there),
 * so data.json holds art only.
 *
 *   node scripts/build-vista-arcade-art.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createCanvas } = require('canvas');

const ROOT = path.join(__dirname, '..');
const GAMES_ROOT = path.join(ROOT, 'public/static_images/vista-games');
const ICON_DIR = path.join(GAMES_ROOT, 'icons');
const APP_ICON_DIR = path.join(ROOT, 'public/static_images/app_icons');

// Block Drop's piece colours (guideline order I O T S Z J L, then G: the grey of a topped-out stack)
const PIECE_COLORS = {
    I: [0, 178, 226],
    O: [246, 196, 0],
    T: [152, 58, 206],
    S: [52, 176, 44],
    Z: [222, 40, 44],
    J: [36, 82, 232],
    L: [248, 128, 8],
    G: [138, 146, 160]
};
const PIECE_ORDER = ['I', 'O', 'T', 'S', 'Z', 'J', 'L', 'G'];

// Brick Breaker's brick colours, top row first
const BRICK_COLORS = [
    [226, 44, 48], [248, 132, 16], [246, 200, 10], [60, 180, 50],
    [0, 176, 222], [40, 90, 230], [150, 64, 206], [230, 80, 160]
];

// ---- helpers -----------------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rgb = (c, a) => (a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

function canvas(w, h) {
    const c = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    return c;
}

function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// RGBA buffer region of an image file
async function readRegion(file, left, top, width, height) {
    const { data, info } = await sharp(file).ensureAlpha().extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
}

function canvasFromRaw(raw) {
    const c = canvas(raw.w, raw.h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(raw.w, raw.h);
    img.data.set(raw.data);
    ctx.putImageData(img, 0, 0);
    return c;
}

// ---- sheets ------------------------------------------------------------------------------------
// sprites: [{ key, w, h, frames: [(scale) -> canvas of w*scale x h*scale] }]. Each sprite takes a
// row of its own (FramesPerRow = its frame count); the result is the two sheets and the sprite
// XML nodes the engine reads (VG.spriteFromNode).

const node = (t, v, c, a) => {
    const n = { t };
    if (a) n.a = a;
    if (c) n.c = c;
    if (v !== undefined) n.v = String(v);
    return n;
};

function spriteNode(texture, s, ox, oy) {
    return node('Root', undefined, [
        node('SourceWidth', s.w),
        node('SourceHeight', s.h),
        node('Animation', undefined, [
            node('Texture', texture),
            node('SheetOffsetX', ox),
            node('SheetOffsetY', oy),
            node('FrameCount', s.frames.length),
            node('FramesPerRow', s.frames.length),
            node('PreppedForFilter', 1)
        ]),
        node('RegistrationX', s.regX || 0),
        node('RegistrationY', s.regY || 0)
    ], { Type: 'Sprite' });
}

// the frame with its edge pixels copied out by `pad` px on every side
function padded(frame, pad) {
    const w = frame.width;
    const h = frame.height;
    const c = canvas(w + pad * 2, h + pad * 2);
    const ctx = c.getContext('2d');
    ctx.drawImage(frame, pad, pad);
    for (let i = 0; i < pad; i++) {
        ctx.drawImage(frame, 0, 0, w, 1, pad, i, w, 1);
        ctx.drawImage(frame, 0, h - 1, w, 1, pad, pad + h + i, w, 1);
    }
    for (let i = 0; i < pad; i++) {
        ctx.drawImage(c, pad, 0, 1, h + pad * 2, i, 0, 1, h + pad * 2);
        ctx.drawImage(c, pad + w - 1, 0, 1, h + pad * 2, pad + w + i, 0, 1, h + pad * 2);
    }
    return c;
}

async function buildSheet(gameDir, sheetName, sprites) {
    const texture = 'Sheets\\' + sheetName + '.sht';
    let y = 0;
    let width = 0;
    const placed = sprites.map((s) => {
        const at = { s, x: 0, y };
        width = Math.max(width, (s.w + 2) * s.frames.length);
        y += s.h + 2;
        return at;
    });
    const height = y;
    const xml = {};
    const outDir = path.join(gameDir, 'sheets');
    fs.mkdirSync(outDir, { recursive: true });
    const dims = [];
    for (const scale of [1, 2]) {
        const sheet = canvas(width * scale, height * scale);
        const ctx = sheet.getContext('2d');
        for (const p of placed) {
            for (let f = 0; f < p.s.frames.length; f++) {
                const frame = await p.s.frames[f](scale);
                const cell = padded(frame, scale);
                ctx.drawImage(cell, (p.x + f * (p.s.w + 2)) * scale, p.y * scale);
            }
            if (scale === 1) xml[p.s.key] = spriteNode(texture, p.s, p.x, p.y);
        }
        const file = path.join(outDir, sheetName.toLowerCase() + (scale === 2 ? '@2x' : '') + '.webp');
        await sharp(sheet.toBuffer('image/png')).webp({ lossless: true, alphaQuality: 100 }).toFile(file);
        dims.push(sheet.width, sheet.height);
    }
    return { key: 'SHEETS_' + sheetName.toUpperCase() + '.SHT', dims, xml };
}

async function writePack(gameDir, sheets) {
    const data = { sheets: {}, xml: {}, audio: {}, images: {}, mui: { strings: {}, menus: {}, dialogs: {}, accelerators: {} } };
    sheets.forEach((s) => {
        data.sheets[s.key] = s.dims;
        Object.assign(data.xml, s.xml);
    });
    fs.writeFileSync(path.join(gameDir, 'data.json'), JSON.stringify(data));
}

// ---- Block Drop --------------------------------------------------------------------------------
// Minesweeper's Tiles_Normal (blueSheet1, 25 frames a row at a 20 px pitch, 18 px tiles): a frame
// a little brighter than the median of its lighting map is the block, recoloured through a
// gradient map on its luminance (dark edge -> colour -> white gloss).

const MS_SHEETS = path.join(GAMES_ROOT, 'minesweeper/sheets');

async function sourceTile() {
    const file = path.join(MS_SHEETS, 'bluesheet1.webp');
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const lum = [];
    for (let f = 0; f < 720; f++) {
        const sx = (f % 25) * 20 + 1;
        const sy = Math.floor(f / 25) * 20 + 1;
        let s = 0;
        for (let y = 4; y < 14; y++) {
            for (let x = 4; x < 14; x++) {
                const i = ((sy + y) * info.width + sx + x) * 4;
                s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            }
        }
        lum.push({ f, l: s / 100 });
    }
    lum.sort((a, b) => a.l - b.l);
    const f = lum[Math.round(lum.length * 0.62)].f;
    const sx = (f % 25) * 20 + 1;
    const sy = Math.floor(f / 25) * 20 + 1;
    return {
        1: await readRegion(file, sx, sy, 18, 18),
        2: await readRegion(path.join(MS_SHEETS, 'bluesheet1@2x.webp'), sx * 2, sy * 2, 36, 36)
    };
}

function bodyLuminance(raw) {
    const ls = [];
    for (let i = 0; i < raw.data.length; i += 4) ls.push(0.299 * raw.data[i] + 0.587 * raw.data[i + 1] + 0.114 * raw.data[i + 2]);
    ls.sort((a, b) => a - b);
    return ls[Math.round(ls.length * 0.55)];
}

// glossy: the tile's shading on the piece colour
function recolour(raw, color, mode) {
    const out = Buffer.from(raw.data);
    const lb = bodyLuminance(raw);
    for (let i = 0; i < out.length; i += 4) {
        const l = 0.299 * raw.data[i] + 0.587 * raw.data[i + 1] + 0.114 * raw.data[i + 2];
        let c;
        if (l <= lb) c = mix(BLACK, color, Math.pow(l / lb, 0.85));
        else c = mix(color, WHITE, Math.pow((l - lb) / (255 - lb), 1.15) * 0.92);
        let a = raw.data[i + 3];
        if (mode === 'crystal') {
            // glass: a pale body you can see the well through, the edge and the gloss kept solid
            const t = l <= lb ? 1 - l / lb : 0;
            const g = l > lb ? (l - lb) / (255 - lb) : 0;
            c = l <= lb ? mix(mix(color, WHITE, 0.42), mix(color, BLACK, 0.55), Math.min(1, t * 1.4)) : mix(mix(color, WHITE, 0.5), WHITE, Math.min(1, g * 1.3));
            a = Math.round(a * clamp(0.7 + t * 0.8 + g * 0.6, 0, 1));
        }
        out[i] = clamp(Math.round(c[0]), 0, 255);
        out[i + 1] = clamp(Math.round(c[1]), 0, 255);
        out[i + 2] = clamp(Math.round(c[2]), 0, 255);
        out[i + 3] = a;
    }
    return { data: out, w: raw.w, h: raw.h };
}

// the landing shadow of the falling piece: a light glass outline in the piece colour
function ghostFrame(color) {
    return (scale) => {
        const s = 18 * scale;
        const c = canvas(s, s);
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        const g = ctx.createLinearGradient(0, 0, 0, 18);
        g.addColorStop(0, rgb(mix(color, WHITE, 0.5), 0.55));
        g.addColorStop(1, rgb(mix(color, WHITE, 0.15), 0.35));
        ctx.fillStyle = g;
        ctx.fillRect(1.5, 1.5, 16, 16);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgb(mix(color, BLACK, 0.15), 0.95);
        ctx.strokeRect(1.5, 1.5, 15.5, 15.5);
        ctx.strokeStyle = rgb(WHITE, 0.55);
        ctx.strokeRect(2.5, 2.5, 13.5, 13.5);
        return c;
    };
}

// Midnight board: an empty cell of a dark well, the Minesweeper cell's bevel in navy
function midnightCell(scale) {
    const s = 18 * scale;
    const c = canvas(s, s);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#050a16';
    ctx.fillRect(0, 0, 18, 18);
    const g = ctx.createLinearGradient(0, 1, 0, 18);
    g.addColorStop(0, '#1d3157');
    g.addColorStop(1, '#0f1c38');
    ctx.fillStyle = g;
    ctx.fillRect(1, 1, 17, 17);
    ctx.fillStyle = 'rgba(160,190,255,0.10)';
    ctx.fillRect(1, 1, 17, 1);
    ctx.fillRect(1, 1, 1, 17);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(1, 17, 17, 1);
    ctx.fillRect(17, 1, 1, 17);
    return c;
}

async function buildBlockDrop() {
    const dir = path.join(GAMES_ROOT, 'blockdrop');
    const src = await sourceTile();
    const tile = (mode, color) => (scale) => canvasFromRaw(recolour(src[scale], color, mode));
    const sheet = await buildSheet(dir, 'blocks', [
        { key: 'BLOCKS_GLOSSY.XML', w: 18, h: 18, frames: PIECE_ORDER.map((p) => tile('glossy', PIECE_COLORS[p])) },
        { key: 'BLOCKS_CRYSTAL.XML', w: 18, h: 18, frames: PIECE_ORDER.map((p) => tile('crystal', PIECE_COLORS[p])) },
        { key: 'BLOCKS_GHOST.XML', w: 18, h: 18, frames: PIECE_ORDER.map((p) => ghostFrame(PIECE_COLORS[p])) },
        { key: 'BLOCKS_MIDNIGHT_CELL.XML', w: 18, h: 18, frames: [midnightCell] }
    ]);
    await writePack(dir, [sheet]);
    return dir;
}

// ---- Brick Breaker ---------------------------------------------------------------------------

// a glossy brick: rounded bar, vertical gradient, the upper half's gloss, a 1 px dark outline
function brickFrame(color, style) {
    return (scale) => {
        const W = 34;
        const H = 14;
        const c = canvas(W * scale, H * scale);
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        const dark = mix(color, BLACK, 0.55);
        if (style === 'crystal') {
            roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 3);
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, rgb(mix(color, WHITE, 0.55), 0.75));
            g.addColorStop(0.5, rgb(mix(color, WHITE, 0.15), 0.45));
            g.addColorStop(1, rgb(color, 0.7));
            ctx.fillStyle = g;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = rgb(mix(color, BLACK, 0.35), 0.95);
            ctx.stroke();
            roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.stroke();
            // facet sparkle
            ctx.beginPath();
            ctx.moveTo(5, 2.5);
            ctx.lineTo(13, 2.5);
            ctx.lineTo(9, 7);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fill();
            return c;
        }
        roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 2.5);
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, rgb(mix(color, WHITE, 0.35)));
        g.addColorStop(0.48, rgb(color));
        g.addColorStop(0.52, rgb(mix(color, BLACK, 0.12)));
        g.addColorStop(1, rgb(mix(color, BLACK, 0.3)));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgb(dark);
        ctx.stroke();
        // gloss on the upper half
        ctx.save();
        roundRect(ctx, 1.5, 1.5, W - 3, H / 2 - 1, 2);
        ctx.clip();
        const gl = ctx.createLinearGradient(0, 1, 0, H / 2);
        gl.addColorStop(0, 'rgba(255,255,255,0.75)');
        gl.addColorStop(1, 'rgba(255,255,255,0.12)');
        ctx.fillStyle = gl;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        // a soft light at the bottom edge (the Vista "glow from below")
        const rg = ctx.createRadialGradient(W / 2, H + 2, 1, W / 2, H + 2, W / 2);
        rg.addColorStop(0, rgb(mix(color, WHITE, 0.6), 0.55));
        rg.addColorStop(1, rgb(color, 0));
        ctx.save();
        roundRect(ctx, 1, 1, W - 2, H - 2, 2);
        ctx.clip();
        ctx.fillStyle = rg;
        ctx.fillRect(0, H / 2, W, H / 2);
        ctx.restore();
        roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.stroke();
        return c;
    };
}

// silver (takes several hits, cracking) and gold (unbreakable) bricks: brushed metal
function metalFrame(kind, cracks) {
    return (scale) => {
        const W = 34;
        const H = 14;
        const c = canvas(W * scale, H * scale);
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        const stops = kind === 'gold'
            ? [[0, '#fff4c2'], [0.35, '#f2c94a'], [0.5, '#c8901a'], [0.75, '#e8b640'], [1, '#8a5a08']]
            : [[0, '#ffffff'], [0.35, '#d6dde8'], [0.5, '#a9b4c4'], [0.75, '#c9d1dd'], [1, '#6f7b8e']];
        roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 2.5);
        const g = ctx.createLinearGradient(0, 0, 0, H);
        stops.forEach(([o, col]) => g.addColorStop(o, col));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = kind === 'gold' ? '#5e3c04' : '#454e5e';
        ctx.stroke();
        roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.stroke();
        if (kind === 'gold') {
            // rivets
            [[5, 7], [W - 5, 7]].forEach(([x, y]) => {
                const r = ctx.createRadialGradient(x - 0.6, y - 0.6, 0.2, x, y, 2);
                r.addColorStop(0, '#fffbe0');
                r.addColorStop(1, '#8a5a08');
                ctx.fillStyle = r;
                ctx.beginPath();
                ctx.arc(x, y, 1.8, 0, Math.PI * 2);
                ctx.fill();
            });
        }
        if (cracks) {
            ctx.strokeStyle = 'rgba(40,46,60,0.85)';
            ctx.lineWidth = 0.8;
            const lines = cracks === 1
                ? [[[14, 1], [16, 5], [13, 8], [15, 13]]]
                : [[[14, 1], [16, 5], [13, 8], [15, 13]], [[16, 5], [22, 4], [26, 1]], [[13, 8], [7, 10], [3, 13]], [[22, 4], [24, 9], [29, 12]]];
            lines.forEach((pts) => {
                ctx.beginPath();
                pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.stroke();
            });
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 0.5;
            lines.forEach((pts) => {
                ctx.beginPath();
                pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 0.7, y + 0.5) : ctx.moveTo(x + 0.7, y + 0.5)));
                ctx.stroke();
            });
        }
        return c;
    };
}

// the paddle in three slices (caps and a stretchable middle); frame 1 is the sticky (catch) glow
const PADDLE_H = 14;
function paddleSlice(part, sticky) {
    return (scale) => {
        const W = part === 'm' ? 8 : 12;
        const H = PADDLE_H;
        const c = canvas(W * scale, H * scale);
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        // the whole paddle is 32 px here (12 + 8 + 12): draw it and keep this slice
        const full = 32;
        const ox = part === 'l' ? 0 : (part === 'm' ? -12 : -20);
        ctx.translate(ox, 0);
        const body = (x, y, w, h, r) => roundRect(ctx, x, y, w, h, r);
        body(0.5, 1.5, full - 1, H - 3, (H - 3) / 2);
        const g = ctx.createLinearGradient(0, 1, 0, H - 1);
        if (sticky) {
            g.addColorStop(0, '#f2fff0');
            g.addColorStop(0.45, '#9be38f');
            g.addColorStop(0.55, '#4fb848');
            g.addColorStop(1, '#2c7a2a');
        } else {
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.45, '#cfd8e6');
            g.addColorStop(0.55, '#96a5bb');
            g.addColorStop(1, '#5f6e86');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = sticky ? '#1f5a1e' : '#3a4558';
        ctx.stroke();
        // the blue glass caps
        [[1, 9], [full - 10, 9]].forEach(([x, w]) => {
            ctx.save();
            body(0.5, 1.5, full - 1, H - 3, (H - 3) / 2);
            ctx.clip();
            const cg = ctx.createLinearGradient(0, 1, 0, H - 1);
            cg.addColorStop(0, '#d8f0ff');
            cg.addColorStop(0.5, '#2f8be0');
            cg.addColorStop(1, '#0b3f8a');
            ctx.fillStyle = cg;
            ctx.fillRect(x - 1, 0, w + 1, H);
            ctx.restore();
        });
        ctx.save();
        body(1.5, 2.5, full - 3, (H - 5) / 2, (H - 5) / 4);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
        ctx.restore();
        return c;
    };
}

// a glossy pearl: bright highlight upper left, a blue rim light lower right
function ballFrame(scale) {
    const S = 12;
    const c = canvas(S * scale, S * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    const r = 5.5;
    const cx = 6;
    const cy = 6;
    const g = ctx.createRadialGradient(cx - 1.8, cy - 2, 0.3, cx, cy, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#dfe9f7');
    g.addColorStop(0.8, '#7f95b8');
    g.addColorStop(1, '#3d4d6c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(30,40,60,0.9)';
    ctx.stroke();
    const rim = ctx.createRadialGradient(cx + 2, cy + 2.5, 0.5, cx + 2, cy + 2.5, 3.5);
    rim.addColorStop(0, 'rgba(140,210,255,0.85)');
    rim.addColorStop(1, 'rgba(140,210,255,0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(cx - 1.7, cy - 2.2, 1.7, 1.1, -0.5, 0, Math.PI * 2);
    ctx.fill();
    return c;
}

// power-up capsules: a glossy pill with a white glyph
const CAPSULES = [
    { id: 'wide', color: [40, 110, 230] },
    { id: 'multi', color: [150, 64, 206] },
    { id: 'slow', color: [52, 170, 60] },
    { id: 'sticky', color: [240, 140, 20] },
    { id: 'life', color: [220, 40, 60] }
];

function capsuleFrame(cap) {
    return (scale) => {
        const W = 26;
        const H = 13;
        const c = canvas(W * scale, H * scale);
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        const col = cap.color;
        roundRect(ctx, 0.5, 0.5, W - 1, H - 1, (H - 1) / 2);
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, rgb(mix(col, WHITE, 0.5)));
        g.addColorStop(0.5, rgb(col));
        g.addColorStop(1, rgb(mix(col, BLACK, 0.4)));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgb(mix(col, BLACK, 0.6));
        ctx.stroke();
        ctx.save();
        roundRect(ctx, 2.5, 1.5, W - 5, H / 2 - 1, (H / 2 - 1) / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
        ctx.restore();
        // glyph
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.4;
        ctx.shadowColor = rgb(mix(col, BLACK, 0.7), 0.9);
        ctx.shadowBlur = 1.5 * scale;
        const cy = H / 2;
        const cx = W / 2;
        ctx.beginPath();
        if (cap.id === 'wide') {
            ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
            ctx.moveTo(cx - 4, cy - 3); ctx.lineTo(cx - 7, cy); ctx.lineTo(cx - 4, cy + 3);
            ctx.moveTo(cx + 4, cy - 3); ctx.lineTo(cx + 7, cy); ctx.lineTo(cx + 4, cy + 3);
            ctx.stroke();
        } else if (cap.id === 'multi') {
            [-5, 0, 5].forEach((d) => { ctx.moveTo(cx + d + 2, cy); ctx.arc(cx + d, cy, 2, 0, Math.PI * 2); });
            ctx.fill();
        } else if (cap.id === 'slow') {
            ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
            ctx.moveTo(cx, cy - 2.4); ctx.lineTo(cx, cy); ctx.lineTo(cx + 2, cy + 1);
            ctx.stroke();
        } else if (cap.id === 'sticky') {
            ctx.moveTo(cx, cy - 4.2);
            ctx.bezierCurveTo(cx + 1, cy - 2, cx + 3.2, cy, cx + 3.2, cy + 1.2);
            ctx.arc(cx, cy + 1.2, 3.2, 0, Math.PI);
            ctx.bezierCurveTo(cx - 3.2, cy, cx - 1, cy - 2, cx, cy - 4.2);
            ctx.fill();
        } else if (cap.id === 'life') {
            ctx.moveTo(cx, cy + 3.6);
            ctx.bezierCurveTo(cx - 6, cy - 0.5, cx - 2.5, cy - 5.5, cx, cy - 2);
            ctx.bezierCurveTo(cx + 2.5, cy - 5.5, cx + 6, cy - 0.5, cx, cy + 3.6);
            ctx.fill();
        }
        return c;
    };
}

async function buildBrickBreaker() {
    const dir = path.join(GAMES_ROOT, 'brickbreaker');
    const sheet = await buildSheet(dir, 'arcade', [
        { key: 'BRICKS_GLOSSY.XML', w: 34, h: 14, frames: BRICK_COLORS.map((c) => brickFrame(c, 'glossy')) },
        { key: 'BRICKS_CRYSTAL.XML', w: 34, h: 14, frames: BRICK_COLORS.map((c) => brickFrame(c, 'crystal')) },
        // silver intact / cracked / badly cracked, then gold
        { key: 'BRICKS_METAL.XML', w: 34, h: 14, frames: [metalFrame('silver', 0), metalFrame('silver', 1), metalFrame('silver', 2), metalFrame('gold', 0)] },
        { key: 'PADDLE_LEFT.XML', w: 12, h: PADDLE_H, frames: [paddleSlice('l', false), paddleSlice('l', true)] },
        { key: 'PADDLE_MIDDLE.XML', w: 8, h: PADDLE_H, frames: [paddleSlice('m', false), paddleSlice('m', true)] },
        { key: 'PADDLE_RIGHT.XML', w: 12, h: PADDLE_H, frames: [paddleSlice('r', false), paddleSlice('r', true)] },
        { key: 'BALL.XML', w: 12, h: 12, regX: 6, regY: 6, frames: [ballFrame] },
        { key: 'CAPSULES.XML', w: 26, h: 13, regX: 13, regY: 6, frames: CAPSULES.map(capsuleFrame) }
    ]);
    await writePack(dir, [sheet]);
    return dir;
}

// ---- icons -------------------------------------------------------------------------------------
// Drawn at 256 px; 48 px is that one scaled down, 16 px a simpler drawing of its own so it stays
// legible (as the Vista game icons have hand-tuned small sizes).

// an isometric glossy cube: top (lit), left (base) and right (shade) faces, gloss on the top
function cube(ctx, x, y, s, color) {
    const h = s * 0.5;
    const top = [[x, y], [x + s, y - h], [x + 2 * s, y], [x + s, y + h]];
    const left = [[x, y], [x + s, y + h], [x + s, y + h + s], [x, y + s]];
    const right = [[x + s, y + h], [x + 2 * s, y], [x + 2 * s, y + s], [x + s, y + h + s]];
    const poly = (pts) => {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
    };
    const line = Math.max(1, s / 28);
    poly(left);
    let g = ctx.createLinearGradient(x, y, x + s, y + s + h);
    g.addColorStop(0, rgb(mix(color, WHITE, 0.15)));
    g.addColorStop(1, rgb(mix(color, BLACK, 0.2)));
    ctx.fillStyle = g;
    ctx.fill();
    poly(right);
    g = ctx.createLinearGradient(x + s, y, x + 2 * s, y + s + h);
    g.addColorStop(0, rgb(mix(color, BLACK, 0.3)));
    g.addColorStop(1, rgb(mix(color, BLACK, 0.5)));
    ctx.fillStyle = g;
    ctx.fill();
    poly(top);
    g = ctx.createLinearGradient(x + s, y - h, x + s, y + h);
    g.addColorStop(0, rgb(mix(color, WHITE, 0.7)));
    g.addColorStop(1, rgb(mix(color, WHITE, 0.25)));
    ctx.fillStyle = g;
    ctx.fill();
    // gloss band on the left face
    ctx.save();
    poly(left);
    ctx.clip();
    const gl = ctx.createLinearGradient(x, y, x + s * 0.4, y + s * 0.9);
    gl.addColorStop(0, 'rgba(255,255,255,0.55)');
    gl.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    gl.addColorStop(0.51, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x, y - h, s * 2, s * 2);
    ctx.restore();
    // edges
    ctx.lineJoin = 'round';
    ctx.lineWidth = line;
    ctx.strokeStyle = rgb(mix(color, BLACK, 0.65), 0.9);
    poly([[x, y], [x + s, y - h], [x + 2 * s, y], [x + 2 * s, y + s], [x + s, y + h + s], [x, y + s]]);
    ctx.stroke();
    ctx.strokeStyle = rgb(mix(color, WHITE, 0.85), 0.8);
    ctx.lineWidth = line * 0.9;
    ctx.beginPath();
    ctx.moveTo(x + line, y + line * 0.3);
    ctx.lineTo(x + s, y + h - line * 0.2);
    ctx.lineTo(x + 2 * s - line, y + line * 0.3);
    ctx.moveTo(x + s, y + h);
    ctx.lineTo(x + s, y + h + s - line);
    ctx.stroke();
}

function floorShadow(ctx, cx, cy, rx, ry, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// isometric grid -> screen: (i, j) on the floor, k up; s = cube edge
function iso(ox, oy, s, i, j, k) {
    return [ox + (i - j) * s, oy + (i + j) * s * 0.5 - k * s];
}

// a flat glossy square (the 16 px icon's blocks): gradient, gloss, 1 px dark edge
function glossSquare(ctx, x, y, s, color) {
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, rgb(mix(color, WHITE, 0.45)));
    g.addColorStop(0.5, rgb(color));
    g.addColorStop(1, rgb(mix(color, BLACK, 0.3)));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x + s * 0.12, y + s * 0.1, s * 0.76, s * 0.36);
    ctx.lineWidth = s / 10;
    ctx.strokeStyle = rgb(mix(color, BLACK, 0.6));
    ctx.strokeRect(x + s / 20, y + s / 20, s - s / 10, s - s / 10);
}

function blockDropIcon(size, simple) {
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    const k = size / 256;
    ctx.scale(k, k);
    if (simple) {
        // 16 px: a purple T dropping onto blue and yellow blocks, face on
        const q = 64;
        const cells = [[0, 0, 'T'], [1, 0, 'T'], [2, 0, 'T'], [1, 1, 'T'], [0, 2, 'J'], [0, 3, 'J'], [1, 3, 'J'], [2, 2, 'O'], [3, 2, 'O'], [2, 3, 'O'], [3, 3, 'O']];
        cells.forEach(([x, y, t]) => glossSquare(ctx, x * q, y * q, q, PIECE_COLORS[t]));
        return c;
    }
    floorShadow(ctx, 128, 228, 112, 22, 0.42);
    const s = 31;
    const placed = [];
    const put = (cells, color, lift) => cells.forEach(([i, j, h]) => placed.push({ i, j, h: h + (lift || 0), color }));
    // the stack: an L (orange), a J (blue) and an O corner (yellow) on the floor, an L-shaped run
    // of green on them
    put([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0]], PIECE_COLORS.L);
    put([[0, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]], PIECE_COLORS.J);
    put([[1, 1, 0]], PIECE_COLORS.O);
    put([[0, 1, 1], [0, 2, 1], [1, 2, 1], [2, 2, 1]], PIECE_COLORS.S);
    // the T coming down, pointing at the gap it fits
    put([[0, 0, 1], [1, 0, 1], [2, 0, 1], [1, 0, 0]], PIECE_COLORS.T, 2.4);
    // painter's order for a view from +i +j above: far to near
    placed.sort((a, b) => (a.i + a.j + a.h) - (b.i + b.j + b.h) || a.h - b.h);
    placed.forEach((p) => {
        const [x, y] = iso(128, 136, s, p.i, p.j, p.h);
        cube(ctx, x - s, y, s, p.color);
    });
    return c;
}

function sphere(ctx, cx, cy, r, base) {
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, rgb(mix(base, WHITE, 0.6)));
    g.addColorStop(0.75, rgb(base));
    g.addColorStop(1, rgb(mix(base, BLACK, 0.55)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    const rim = ctx.createRadialGradient(cx + r * 0.35, cy + r * 0.45, r * 0.05, cx + r * 0.3, cy + r * 0.4, r * 0.75);
    rim.addColorStop(0, 'rgba(170,225,255,0.85)');
    rim.addColorStop(1, 'rgba(170,225,255,0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, r / 22);
    ctx.strokeStyle = rgb(mix(base, BLACK, 0.7), 0.8);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.33, cy - r * 0.45, r * 0.3, r * 0.17, -0.55, 0, Math.PI * 2);
    ctx.fill();
}

// a brick seen from the front and a little above: front face + top face
function brick3d(ctx, x, y, w, h, d, color) {
    const top = [[x, y], [x + d, y - d * 0.8], [x + w + d, y - d * 0.8], [x + w, y]];
    const side = [[x + w, y], [x + w + d, y - d * 0.8], [x + w + d, y + h - d * 0.8], [x + w, y + h]];
    const poly = (pts) => {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
    };
    const line = Math.max(1, h / 22);
    poly(side);
    ctx.fillStyle = rgb(mix(color, BLACK, 0.45));
    ctx.fill();
    poly(top);
    const tg = ctx.createLinearGradient(x, y - d, x, y);
    tg.addColorStop(0, rgb(mix(color, WHITE, 0.75)));
    tg.addColorStop(1, rgb(mix(color, WHITE, 0.3)));
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgb(mix(color, WHITE, 0.3)));
    g.addColorStop(0.5, rgb(color));
    g.addColorStop(0.52, rgb(mix(color, BLACK, 0.12)));
    g.addColorStop(1, rgb(mix(color, BLACK, 0.35)));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x + line, y + line, w - line * 2, h * 0.42);
    ctx.lineWidth = line;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgb(mix(color, BLACK, 0.65), 0.9);
    poly([[x, y], [x + d, y - d * 0.8], [x + w + d, y - d * 0.8], [x + w + d, y + h - d * 0.8], [x + w, y + h], [x, y + h]]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w + d, y - d * 0.8);
    ctx.stroke();
}

function brickBreakerIcon(size, simple) {
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    const k = size / 256;
    ctx.scale(k, k);
    if (simple) {
        brick3d(ctx, 14, 40, 108, 54, 24, BRICK_COLORS[0]);
        brick3d(ctx, 122, 40, 108, 54, 24, BRICK_COLORS[2]);
        brick3d(ctx, 40, 94, 108, 54, 24, BRICK_COLORS[4]);
        floorShadow(ctx, 160, 232, 76, 16, 0.4);
        sphere(ctx, 170, 168, 62, [70, 120, 220]);
        return c;
    }
    // the wall: three rows, staggered
    const rows = [
        { y: 46, x0: 26, colors: [0, 1, 2] },
        { y: 82, x0: 6, colors: [3, 4, 5, 6] },
        { y: 118, x0: 26, colors: [7, 2] }
    ];
    const bw = 64;
    const bh = 34;
    const d = 16;
    rows.forEach((row) => {
        row.colors.forEach((ci, i) => {
            const x = row.x0 + i * bw;
            if (x + bw + d > 250) return;
            brick3d(ctx, x, row.y, bw, bh, d, BRICK_COLORS[ci]);
        });
    });
    // shards of the brick the ball broke
    const shard = (pts, color) => {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
        const g = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
        g.addColorStop(0, rgb(mix(color, WHITE, 0.5)));
        g.addColorStop(1, rgb(mix(color, BLACK, 0.2)));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgb(mix(color, BLACK, 0.6), 0.9);
        ctx.stroke();
    };
    shard([[176, 128], [196, 120], [190, 140]], BRICK_COLORS[2]);
    shard([[208, 140], [224, 134], [222, 152], [210, 150]], BRICK_COLORS[2]);
    shard([[150, 150], [162, 146], [158, 160]], BRICK_COLORS[2]);
    // the paddle
    floorShadow(ctx, 128, 238, 104, 10, 0.35);
    ctx.save();
    roundRect(ctx, 34, 214, 188, 22, 11);
    const pg = ctx.createLinearGradient(0, 214, 0, 236);
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.45, '#cfd8e6');
    pg.addColorStop(0.55, '#96a5bb');
    pg.addColorStop(1, '#5f6e86');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.clip();
    const cg = ctx.createLinearGradient(0, 214, 0, 236);
    cg.addColorStop(0, '#d8f0ff');
    cg.addColorStop(0.5, '#2f8be0');
    cg.addColorStop(1, '#0b3f8a');
    ctx.fillStyle = cg;
    ctx.fillRect(34, 214, 30, 22);
    ctx.fillRect(192, 214, 30, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(34, 216, 188, 7);
    ctx.restore();
    roundRect(ctx, 34, 214, 188, 22, 11);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3a4558';
    ctx.stroke();
    // the ball, with a soft glow and its shadow on the paddle
    floorShadow(ctx, 150, 214, 40, 8, 0.35);
    const glow = ctx.createRadialGradient(152, 166, 20, 152, 166, 64);
    glow.addColorStop(0, 'rgba(150,210,255,0.55)');
    glow.addColorStop(1, 'rgba(150,210,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(152, 166, 64, 0, Math.PI * 2);
    ctx.fill();
    sphere(ctx, 152, 166, 38, [70, 120, 220]);
    return c;
}

async function writeIcon(id, draw) {
    fs.mkdirSync(ICON_DIR, { recursive: true });
    const big = draw(256, false).toBuffer('image/png');
    await sharp(big).png().toFile(path.join(APP_ICON_DIR, 'vista-' + id + '.png'));
    await sharp(big).resize(48, 48, { kernel: 'lanczos3' }).png().toFile(path.join(ICON_DIR, id + '-48.png'));
    const small = draw(64, true).toBuffer('image/png');
    await sharp(small).resize(16, 16, { kernel: 'lanczos3' }).sharpen({ sigma: 0.5 }).png().toFile(path.join(ICON_DIR, id + '-16.png'));
}

(async () => {
    const out = [];
    out.push(await buildBlockDrop());
    out.push(await buildBrickBreaker());
    await writeIcon('blockdrop', blockDropIcon);
    await writeIcon('brickbreaker', brickBreakerIcon);
    out.forEach((d) => console.log('wrote', path.relative(ROOT, d)));
    console.log('wrote icons: blockdrop, brickbreaker');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
