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
 *   32 / 64 / 128 px), painted large with real shading and scaled down.
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
    doubles.paintBackdrop(ctx, w, h);
    const side = Math.round(h * 0.9);
    const bx = Math.round((w - side) / 2);
    const by = Math.round((h - side) / 2);
    const px = Math.max(1, w / 256);
    doubles.paintPane(ctx, bx, by, side, side, side * 0.035, px);
    const gap = side * 0.026;
    const t = (side - gap * 5) / 4;
    const shadow = createCanvas(Math.round(t * 1.3), Math.round(t * 1.3));
    doubles.paintShadow(shadow.getContext('2d'), shadow.width);
    const board = [2, 0, 0, 4, 0, 8, 2, 16, 4, 32, 64, 128, 2, 256, 512, 2048];
    board.forEach((v, i) => {
        const x = bx + gap + (i % 4) * (t + gap);
        const y = by + gap + Math.floor(i / 4) * (t + gap);
        doubles.paintWell(ctx, x, y, t);
        if (!v) return;
        ctx.drawImage(shadow, x - t * 0.15, y - t * 0.15, t * 1.3, t * 1.3);
        ctx.drawImage(tile(v, Math.round(t)), x, y, t, t);
    });
    return c;
}

// ---- Windows Mobile program icons ---------------------------------------------------------------
// Each is painted once, large (512 px, with real shading), and brought down to the ROM's sizes with
// a sharp filter: the 64 and 128 px files dense screens use keep the detail, the 16 and 32 px ones
// stay clean.

const sharp = require('sharp');
const MASTER = 512;

// four slabs of the game's own glass; detail: 'none' (16 px: numbers would only be dirt), 'short'
// (32 px), or all of it
function wmDoublesMaster(detail) {
    const c = createCanvas(MASTER, MASTER);
    const ctx = c.getContext('2d');
    const pad = 22;
    const gap = 26;
    const t = Math.floor((MASTER - pad * 2 - gap) / 2);
    const shadow = createCanvas(Math.round(t * 1.3), Math.round(t * 1.3));
    doubles.paintShadow(shadow.getContext('2d'), shadow.width);
    [2, 8, 32, 128].forEach((v, i) => {
        const x = pad + (i % 2) * (t + gap);
        const y = pad + Math.floor(i / 2) * (t + gap) - 6;
        const tc = createCanvas(t, t);
        const tx = tc.getContext('2d');
        const write = tx.fillText.bind(tx);
        if (detail === 'none') tx.fillText = () => {};
        else if (detail === 'short') {
            // at 32 px three digits are a smear: the same glass with 2, 4, 8, 16 on it, larger
            const label = ['2', '4', '8', '16'][i];
            tx.fillText = (text, lx, ly) => { tx.font = `700 ${Math.round(t * (label.length > 1 ? 0.5 : 0.62))}px "Segoe UI", Tahoma, sans-serif`; write(label, lx, ly); };
        }
        doubles.paintTile(tx, t, v, 2048);
        ctx.drawImage(shadow, x - t * 0.15, y - t * 0.15 + 6);
        ctx.drawImage(tc, x, y);
    });
    return c;
}

// a wire waste basket and a ball of crumpled paper on its way in
function wmBinTossMaster(detail) {
    const small = detail === 'none';
    const c = createCanvas(MASTER, MASTER);
    const ctx = c.getContext('2d');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const INK = '#1a2230';
    // the basket's shape: rim at the top, narrower foot
    const top = 250; const bottom = 468; const tl = 150; const tr = 486; const bl = 206; const br = 430;
    const cx = (tl + tr) / 2;
    const rimRy = 40;
    // its shadow on the floor
    const sh = ctx.createRadialGradient(cx, bottom + 6, 10, cx, bottom + 6, 170);
    sh.addColorStop(0, 'rgba(0,0,0,0.38)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(0, bottom + 6);
    ctx.scale(1, 0.2);
    ctx.translate(0, -(bottom + 6));
    ctx.fillStyle = sh;
    ctx.fillRect(cx - 190, bottom - 180, 380, 380);
    ctx.restore();
    // the throw: two arcs behind the paper, fading at the tail
    if (!small) {
        [[40, 250, 70, 120, 170, 84, 22], [92, 276, 104, 180, 176, 140, 16]].forEach(([x0, y0, qx, qy, x1, y1, w]) => {
            const g = ctx.createLinearGradient(x0, y0, x1, y1);
            g.addColorStop(0, 'rgba(70,140,230,0)');
            g.addColorStop(1, 'rgba(110,180,255,0.95)');
            ctx.strokeStyle = g;
            ctx.lineWidth = w;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(qx, qy, x1, y1); ctx.stroke();
        });
    }
    // inside of the basket, seen through the mouth
    const inside = ctx.createLinearGradient(tl, 0, tr, 0);
    inside.addColorStop(0, '#2a323e');
    inside.addColorStop(1, '#515c6c');
    ctx.fillStyle = inside;
    ctx.beginPath(); ctx.ellipse(cx, top, (tr - tl) / 2, rimRy, 0, 0, Math.PI * 2); ctx.fill();
    // the side: brushed metal, lit from the left, with its mesh
    const side = () => {
        ctx.beginPath();
        ctx.moveTo(tl, top);
        ctx.lineTo(bl, bottom - 14);
        ctx.quadraticCurveTo(cx, bottom + 22, br, bottom - 14);
        ctx.lineTo(tr, top);
        ctx.quadraticCurveTo(cx, top + rimRy * 2, tl, top);
        ctx.closePath();
    };
    side();
    const metal = ctx.createLinearGradient(tl, 0, tr, 0);
    metal.addColorStop(0, '#f4f7fa');
    metal.addColorStop(0.3, '#cfd7e0');
    metal.addColorStop(0.75, '#8d99a8');
    metal.addColorStop(1, '#6a7686');
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.save();
    side();
    ctx.clip();
    if (!small) {
        const step = 44;
        for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass ? 'rgba(255,255,255,0.55)' : '#3d4756';
            ctx.lineWidth = pass ? 3 : 9;
            for (let x = -200; x < 720; x += step) {
                const o = pass ? -5 : 0;
                ctx.beginPath(); ctx.moveTo(x + o, top - 10); ctx.lineTo(x + 150 + o, bottom + 30); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + 150 + o, top - 10); ctx.lineTo(x + o, bottom + 30); ctx.stroke();
            }
        }
    }
    // rounder toward the foot and the far side
    const shade = ctx.createLinearGradient(0, top, 0, bottom);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(10,16,28,0.3)');
    ctx.fillStyle = shade;
    ctx.fillRect(tl, top, tr - tl, bottom - top + 30);
    ctx.restore();
    side();
    ctx.strokeStyle = INK;
    ctx.lineWidth = small ? 22 : 12;
    ctx.stroke();
    // the rim: a ring of bright wire
    const ring = ctx.createLinearGradient(0, top - rimRy, 0, top + rimRy);
    ring.addColorStop(0, '#ffffff');
    ring.addColorStop(0.5, '#aab4c2');
    ring.addColorStop(1, '#5c6878');
    ctx.strokeStyle = INK;
    ctx.lineWidth = small ? 46 : 32;
    ctx.beginPath(); ctx.ellipse(cx, top, (tr - tl) / 2, rimRy, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ring;
    ctx.lineWidth = small ? 22 : 16;
    ctx.beginPath(); ctx.ellipse(cx, top, (tr - tl) / 2, rimRy, 0, 0, Math.PI * 2); ctx.stroke();
    // the paper: a ball of flat creased faces, lit from the top left
    const px = 262; const py = 124; const r = 104;
    const ringPts = [[-1, -0.2], [-0.62, -0.84], [0.1, -1], [0.78, -0.66], [1, 0.08], [0.66, 0.8], [-0.14, 1], [-0.84, 0.62]].map(([x, y]) => [px + x * r, py + y * r]);
    const [A, B, C] = [[-0.26, -0.22], [0.32, -0.06], [-0.04, 0.42]].map(([x, y]) => [px + x * r, py + y * r]);
    const tones = ['#ffffff', '#f1f4f8', '#e2e7ed', '#ced5de', '#b8c1cc', '#a3adba'];
    const face = (pts, tone) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = tone;
        ctx.fill();
        if (!small) {
            ctx.strokeStyle = 'rgba(120,132,148,0.5)';
            ctx.lineWidth = 4;
            ctx.stroke();
        }
    };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 10;
    face(ringPts, '#e2e7ed');
    ctx.restore();
    // creased faces about three folds inside it: light at the top left, in shade at the lower right
    const o = ringPts;
    [[[o[0], o[1], A], 1], [[o[1], o[2], A], 0], [[o[2], B, A], 1], [[o[2], o[3], B], 2], [[o[3], o[4], B], 3], [[o[4], o[5], B], 5],
        [[o[5], C, B], 4], [[o[5], o[6], C], 5], [[o[6], o[7], C], 3], [[o[7], A, C], 2], [[o[7], o[0], A], 2], [[A, B, C], 0]].forEach(([pts, t]) => face(pts, tones[t]));
    ctx.beginPath();
    ringPts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = INK;
    ctx.lineWidth = small ? 22 : 12;
    ctx.stroke();
    return c;
}

async function wmSet(id, draw) {
    const out = [];
    const sized = async (name, size) => {
        // the small sizes get simpler masters (16 px: no mesh, no numbers, heavier lines)
        const master = draw(size <= 16 ? 'none' : size <= 32 ? 'short' : 'full').toBuffer('image/png');
        const png = await sharp(master).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
        const file = path.join(PUBLIC, 'static_images/wm61', name);
        fs.writeFileSync(file, png);
        out.push('static_images/wm61/' + name);
    };
    for (const [tag, size] of [['', 16], ['@2x', 32], ['@4x', 64]]) await sized(`app-${id}${tag}.png`, size);
    for (const [tag, size] of [['', 32], ['@2x', 64], ['@4x', 128]]) await sized(`app-${id}-lg${tag}.png`, size);
    return out;
}

async function main() {
    const out = [];
    out.push(write('static_images/app_icons/vista-doubles.png', doublesIcon(256)));
    out.push(write('static_images/vista-games/icons/doubles-16.png', doublesIcon(16)));
    out.push(write('static_images/vista-games/icons/doubles-48.png', doublesIcon(48)));
    out.push(write('static_images/vista-games/doubles/images/thumbnail.png', doublesThumbnail(256, 192)));
    out.push(write('static_images/vista-games/doubles/images/thumbnail@2x.png', doublesThumbnail(512, 384)));
    out.push(...await wmSet('doubles', wmDoublesMaster));
    out.push(...await wmSet('bintoss', wmBinTossMaster));
    console.log('wrote\n  ' + out.join('\n  '));
}

main().catch((err) => { console.error(err); process.exit(1); });
