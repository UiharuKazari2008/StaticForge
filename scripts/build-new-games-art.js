#!/usr/bin/env node
/*
 * Art for the games of Yozora #836, drawn here (no source images):
 *
 *   Doubles on the desktop (public/scripts/comp/desktop-apps/vista-games/doubles.js)
 *     public/static_images/app_icons/vista-doubles.png            256 px master of the app-icon set
 *     public/static_images/vista-games/icons/doubles-{16,48}.png  About box, Games Explorer fallback
 *     public/static_images/vista-games/doubles/images/thumbnail{,@2x}.png   Games Explorer preview
 *   Doubles and Bin Toss on the phone (wmDoubles.js, wmBinToss.js): Windows Mobile program icons in
 *   the ROM's sizes, public/static_images/wm61/app-<id>{,-lg}{,@2x,@4x}.png (16 / 32 / 64 and
 *   32 / 64 / 128 px), drawn in the device's way: a dark outline, flat colours, stepped shading.
 *
 * The desktop tiles are painted by the game's own painter (doubles.js exports it), so the icon and
 * the thumbnail match the board.
 *
 *   node scripts/build-new-games-art.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const PUBLIC = path.join(__dirname, '..', 'public');
const doubles = require(path.join(PUBLIC, 'scripts/comp/desktop-apps/vista-games/doubles.js'));

function write(rel, canvas) {
    const file = path.join(PUBLIC, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, canvas.toBuffer('image/png', { compressionLevel: 9 }));
    return rel;
}

// ---- Doubles, desktop ---------------------------------------------------------------------------

function tile(v, px) {
    const c = createCanvas(px, px);
    doubles.paintTile(c.getContext('2d'), px, v, 2048);
    return c;
}

// four glass tiles in a square, each with a soft shadow
function doublesIcon(size) {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    const pad = Math.max(1, Math.round(size * 0.035));
    const gap = Math.max(1, Math.round(size * 0.04));
    const t = Math.floor((size - pad * 2 - gap) / 2);
    const vals = [2, 8, 32, 128];
    vals.forEach((v, i) => {
        const x = pad + (i % 2) * (t + gap);
        const y = pad + Math.floor(i / 2) * (t + gap) - (size >= 48 ? Math.round(size * 0.01) : 0);
        if (size >= 48) {
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = size * 0.035;
            ctx.shadowOffsetY = size * 0.02;
            ctx.drawImage(tile(v, t), x, y);
            ctx.restore();
        } else ctx.drawImage(tile(v, t), x, y);
    });
    return c;
}

// the board in mid game, as the window draws it
function doublesThumbnail(w, h) {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#3f7fd0');
    bg.addColorStop(0.45, '#1f56a8');
    bg.addColorStop(1, '#0d2c63');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.2, -h * 0.1, 4, w * 0.2, -h * 0.1, w * 0.9);
    glow.addColorStop(0, 'rgba(190,225,255,0.5)');
    glow.addColorStop(1, 'rgba(190,225,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const side = Math.round(h * 0.9);
    const bx = Math.round((w - side) / 2);
    const by = Math.round((h - side) / 2);
    doubles.roundRect(ctx, bx, by, side, side, side * 0.025);
    ctx.fillStyle = 'rgba(3,14,40,0.66)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,205,255,0.5)';
    ctx.lineWidth = Math.max(1, w / 256);
    ctx.stroke();
    const gap = side * 0.026;
    const t = (side - gap * 5) / 4;
    const board = [2, 0, 0, 4, 0, 8, 2, 16, 4, 32, 64, 128, 2, 256, 512, 2048];
    board.forEach((v, i) => {
        const x = bx + gap + (i % 4) * (t + gap);
        const y = by + gap + Math.floor(i / 4) * (t + gap);
        doubles.roundRect(ctx, x, y, t, t, t * 0.11);
        ctx.fillStyle = 'rgba(160,200,255,0.13)';
        ctx.fill();
        if (v) ctx.drawImage(tile(v, Math.round(t)), x, y, t, t);
    });
    return c;
}

// ---- Windows Mobile program icons ---------------------------------------------------------------

const OUTLINE = '#1c2430';

// a flat tile with the device's two-step bevel; the digit only where it can be read
function wmTile(ctx, x, y, s, face, light, dark, label, textColor, px) {
    const u = px;
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = dark;
    ctx.fillRect(x + u, y + u, s - u * 2, s - u * 2);
    ctx.fillStyle = light;
    ctx.fillRect(x + u, y + u, s - u * 3, s - u * 3);
    ctx.fillStyle = face;
    ctx.fillRect(x + u * 2, y + u * 2, s - u * 4, s - u * 4);
    if (label && s >= 13) {
        ctx.font = `bold ${Math.round(s * (label.length > 1 ? 0.5 : 0.66))}px "Segoe UI", Tahoma, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = textColor;
        ctx.fillText(label, x + s / 2, y + s / 2 + s * 0.04);
    }
}

function wmDoublesIcon(size) {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    const px = Math.max(1, Math.round(size / 32));
    const gap = px;
    const s = Math.floor((size - gap) / 2);
    const o = Math.floor((size - s * 2 - gap) / 2);
    const tiles = [
        ['#ffffff', '#ffffff', '#b4bfcc', '2', '#000000'],
        ['#52aee6', '#a4d8f8', '#1f6ea6', '4', '#ffffff'],
        ['#eab016', '#ffe07a', '#a67400', '8', '#ffffff'],
        ['#de4432', '#ff8e7c', '#981c0e', '16', '#ffffff']
    ];
    tiles.forEach(([face, light, dark, label, text], i) => {
        wmTile(ctx, o + (i % 2) * (s + gap), o + Math.floor(i / 2) * (s + gap), s, face, light, dark, label, text, px);
    });
    return c;
}

// a wire waste basket and a ball of paper on its way in; drawn on a 32-unit grid
function wmBinTossIcon(size) {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    const k = size / 32;
    const line = Math.max(1, Math.round(k));
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // the throw: two arcs behind the paper
    if (size >= 32) {
        ctx.strokeStyle = '#5a8fd0';
        ctx.lineWidth = Math.max(1, line) / k;
        ctx.beginPath(); ctx.moveTo(2.5, 15.5); ctx.quadraticCurveTo(4, 8, 10, 5.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5.5, 17); ctx.quadraticCurveTo(6.5, 11.5, 11, 9); ctx.stroke();
    }
    // the basket: back of the rim, the tapered side with its mesh, the front of the rim
    const top = 15; const bottom = 30; const tl = 9; const tr = 30; const bl = 12.5; const br = 26.5;
    ctx.fillStyle = size >= 32 ? '#39424e' : '#6a7686';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = line / k;
    ctx.beginPath(); ctx.ellipse((tl + tr) / 2, top, (tr - tl) / 2, 2.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tl, top); ctx.lineTo(bl, bottom - 1); ctx.quadraticCurveTo((bl + br) / 2, bottom + 1.4, br, bottom - 1); ctx.lineTo(tr, top);
    ctx.quadraticCurveTo((tl + tr) / 2, top + 5.2, tl, top); ctx.closePath();
    ctx.fillStyle = '#c9d2dc';
    ctx.fill();
    ctx.save();
    ctx.clip();
    // stepped shading: a lighter band on the left, a darker one on the right
    ctx.fillStyle = '#eef2f6'; ctx.fillRect(tl, top, 5, 17);
    ctx.fillStyle = '#9aa6b4'; ctx.fillRect(24.5, top, 6, 17);
    ctx.strokeStyle = '#5c6876';
    ctx.lineWidth = Math.max(0.6, (size >= 32 ? 1 : 0.8) / k);
    const step = size >= 64 ? 3 : 4;
    // at 16 px the mesh would only be mud: the shaded side alone
    for (let x = -10; x < 44 && size >= 32; x += step) {
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + 9, bottom + 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 9, top); ctx.lineTo(x, bottom + 2); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = line / k;
    ctx.beginPath(); ctx.moveTo(tl, top); ctx.lineTo(bl, bottom - 1); ctx.quadraticCurveTo((bl + br) / 2, bottom + 1.4, br, bottom - 1); ctx.lineTo(tr, top); ctx.stroke();
    ctx.beginPath(); ctx.ellipse((tl + tr) / 2, top, (tr - tl) / 2, 2.6, 0, 0, Math.PI); ctx.stroke();
    // the paper: a creased ball, white with grey folds
    const cx = 16.5; const cy = 7.5; const r = 6;
    const pts = [[-1, -0.25], [-0.55, -0.9], [0.15, -1], [0.8, -0.62], [1, 0.1], [0.6, 0.85], [-0.2, 1], [-0.85, 0.6]].map(([x, y]) => [cx + x * r, cy + y * r]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#c4ccd6';
    ctx.beginPath(); ctx.moveTo(cx + r, cy - r * 0.2); ctx.lineTo(cx + r * 0.1, cy + r * 0.25); ctx.lineTo(cx - r * 0.3, cy + r * 1.1); ctx.lineTo(cx + r, cy + r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e2e7ed';
    ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.7); ctx.lineTo(cx - r * 0.35, cy - r * 0.1); ctx.lineTo(cx + r * 0.1, cy + r * 0.25); ctx.lineTo(cx - r * 0.3, cy + r * 1.1); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = line / k;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    if (size >= 32) {
        ctx.strokeStyle = '#7c8794';
        ctx.lineWidth = Math.max(0.5, 0.8 / k);
        ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy - r * 0.1); ctx.lineTo(cx + r * 0.1, cy + r * 0.25); ctx.lineTo(cx + r * 0.9, cy - r * 0.15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy - r * 0.1); ctx.lineTo(cx + r * 0.1, cy - r * 0.9); ctx.stroke();
    }
    return c;
}

function wmSet(id, draw) {
    const out = [];
    [['', 16], ['@2x', 32], ['@4x', 64]].forEach(([tag, size]) => out.push(write(`static_images/wm61/app-${id}${tag}.png`, draw(size))));
    [['', 32], ['@2x', 64], ['@4x', 128]].forEach(([tag, size]) => out.push(write(`static_images/wm61/app-${id}-lg${tag}.png`, draw(size))));
    return out;
}

function main() {
    const out = [];
    out.push(write('static_images/app_icons/vista-doubles.png', doublesIcon(256)));
    out.push(write('static_images/vista-games/icons/doubles-16.png', doublesIcon(16)));
    out.push(write('static_images/vista-games/icons/doubles-48.png', doublesIcon(48)));
    out.push(write('static_images/vista-games/doubles/images/thumbnail.png', doublesThumbnail(256, 192)));
    out.push(write('static_images/vista-games/doubles/images/thumbnail@2x.png', doublesThumbnail(512, 384)));
    out.push(...wmSet('doubles', wmDoublesIcon));
    out.push(...wmSet('bintoss', wmBinTossIcon));
    console.log('wrote\n  ' + out.join('\n  '));
}

main();
