#!/usr/bin/env node
/**
 * Wireless Manager's VPN glyph (StaticForge #1019): wrls-vpn-on / wrls-vpn-off at 16, 32 and 64 px, in the style
 * of the ROM's Wireless Manager glyphs (1-bit black, the shell whitens them). WM 6.1 had no VPN row, so the mark is
 * Melaton's own: a padlock. The "off" X and the gap cut around it are taken from Melaton's NFC pair (wrls-nfc-off
 * minus wrls-nfc-on), so every off glyph carries the same X.
 *
 *   node scripts/generate-wm-vpn-glyph.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const DIR = path.join(__dirname, '..', 'public', 'static_images', 'wm61');
const SIZES = [[16, ''], [32, '@2x'], [64, '@4x']];

/**
 * The padlock, placed by hand on the 16 px grid as the ROM glyphs are (a drawing scaled down came out uneven at 16 px):
 * a 2 px shackle, a 10 x 8 body, a 2 x 4 keyhole. 32 and 64 px are the same pixels scaled up without smoothing.
 */
const LOCK = [
    '................',
    '.....######.....',
    '....########....',
    '....##....##....',
    '....##....##....',
    '....##....##....',
    '...##########...',
    '...##########...',
    '...####..####...',
    '...####..####...',
    '...####..####...',
    '...####..####...',
    '...##########...',
    '...##########...',
    '................',
    '................'
];
function drawLock(ctx, s) {
    const u = s / 16;
    ctx.fillStyle = '#000';
    LOCK.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') ctx.fillRect(x * u, y * u, u, u); }));
}

const black = (d, i) => d[i + 3] >= 128 && d[i] < 128;

async function one(size, suffix) {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    drawLock(ctx, size);
    // 1-bit: what is half covered is black, the rest clear (the ROM glyphs have no grey)
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const on = d[i + 3] >= 128;
        d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = on ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    fs.writeFileSync(path.join(DIR, `wrls-vpn-on${suffix}.png`), c.toBuffer('image/png'));

    // off: the NFC pair's X and its cleared margin, at the same size
    const on = await loadImage(path.join(DIR, `wrls-nfc-on${suffix}.png`));
    const off = await loadImage(path.join(DIR, `wrls-nfc-off${suffix}.png`));
    const read = (im) => { const k = createCanvas(size, size).getContext('2d'); k.drawImage(im, 0, 0, size, size); return k.getImageData(0, 0, size, size).data; };
    const a = read(on), b = read(off);
    const out = ctx.getImageData(0, 0, size, size);
    const o = out.data;
    // the X: black in off, not in on; the margin: a pixel next to the X
    const isX = (x, y) => x >= 0 && y >= 0 && x < size && y < size && black(b, (y * size + x) * 4) && !black(a, (y * size + x) * 4);
    const gap = Math.max(1, Math.round(size / 16));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (isX(x, y)) { o[i] = o[i + 1] = o[i + 2] = 0; o[i + 3] = 255; continue; }
        let near = false;
        for (let dy = -gap; dy <= gap && !near; dy++) for (let dx = -gap; dx <= gap; dx++) if (isX(x + dx, y + dy)) { near = true; break; }
        if (near) o[i + 3] = 0;
    }
    ctx.putImageData(out, 0, 0);
    fs.writeFileSync(path.join(DIR, `wrls-vpn-off${suffix}.png`), c.toBuffer('image/png'));
}

(async () => {
    for (const [s, sfx] of SIZES) await one(s, sfx);
    console.log('wrls-vpn-on / -off written (16, 32, 64)');
})();
