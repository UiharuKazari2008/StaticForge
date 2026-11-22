#!/usr/bin/env node
/*
 * The soft key bar's centre task button glyph (#1013): a "restore down" mark (two overlapping window outlines),
 * white on clear, in the 16-unit cell of the input panel button's keyboard (sip-keyboard*.png), drawn by hand at
 * 1x and point-doubled for @2x / @4x so it stays crisp at the bar's pixel scale. An original drawing, not a copy
 * of any ROM bitmap. Writes public/static_images/{wm61,wm65}/soft-tasks{,@2x,@4x}.png (the Android app draws the
 * wm65 files over Android programs by these names).
 *   node scripts/generate-wm-soft-tasks-glyph.js
 */
'use strict';
const path = require('path');
const sharp = require('sharp');

// 16 x 16, '#' = white; the rows match the keyboard's (y 3 .. 13)
const MAP = [
    '................',
    '................',
    '................',
    '......########..',
    '......########..',
    '......#......#..',
    '..########...#..',
    '..########...#..',
    '..#......#...#..',
    '..#......#...#..',
    '..#......#####..',
    '..#......#......',
    '..#......#......',
    '..########......',
    '................',
    '................'
];

async function write(file, k) {
    const n = 16 * k;
    const buf = Buffer.alloc(n * n * 4);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (MAP[Math.floor(y / k)][Math.floor(x / k)] !== '#') continue;
            buf.fill(255, (y * n + x) * 4, (y * n + x) * 4 + 4);
        }
    }
    await sharp(buf, { raw: { width: n, height: n, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
}

(async () => {
    const root = path.join(__dirname, '..', 'public', 'static_images');
    for (const v of ['wm61', 'wm65']) {
        for (const [suffix, k] of [['', 1], ['@2x', 2], ['@4x', 4]]) {
            const file = path.join(root, v, `soft-tasks${suffix}.png`);
            await write(file, k);
            console.log(file);
        }
    }
})().catch((err) => { console.error(err); process.exit(1); });
