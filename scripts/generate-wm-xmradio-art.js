#!/usr/bin/env node
/**
 * Art for Melaton Mobile's XM Radio (wmXmRadio.js, Yozora #989): the desktop program's own icon
 * (apps/xmradio/assets/xmradio-256.png), at Windows Mobile's sizes.
 *
 *   node scripts/generate-wm-xmradio-art.js
 *
 * Writes public/static_images/wm61/app-xmradio.png (16, @2x 32, @4x 64) and app-xmradio-lg.png (32, @2x 64,
 * @4x 128); for 6.5 the Start icon wm65/start-xmradio.png (45, @2x 90, @4x 180) and the home screen panel
 * ti-x-app-xmradio-lg.png (43 x 57, @2x 86 x 113, @4x 172 x 226: the art, then its fading mirror, as Videos').
 */
'use strict';

const path = require('path');
const sharp = require('sharp');

const SRC = path.resolve(__dirname, '..', 'apps', 'xmradio', 'assets', 'xmradio-256.png');
const OUT = path.resolve(__dirname, '..', 'public', 'static_images', 'wm61');
const OUT65 = path.resolve(__dirname, '..', 'public', 'static_images', 'wm65');
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function icon(size, file, dir = OUT) {
    await sharp(SRC).resize(size, size, { fit: 'contain', background: CLEAR, kernel: 'lanczos3' }).png().toFile(path.join(dir, file));
    console.log(file, size);
}

async function panel(k, file) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    const R = Math.round(26 * k);
    const art = await sharp(SRC).resize(A, A, { fit: 'contain', background: CLEAR }).png().toBuffer();
    const upside = await sharp(art).flip().png().toBuffer();
    const flipped = await sharp(upside).extract({ left: 0, top: 0, width: A, height: R }).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < R; y++) {
        const f = 0.4 * (1 - y / R);
        for (let x = 0; x < A; x++) { const i = (y * A + x) * 4 + 3; flipped[i] = Math.round(flipped[i] * f); }
    }
    const mirror = await sharp(flipped, { raw: { width: A, height: R, channels: 4 } }).png().toBuffer();
    await sharp({ create: { width: W, height: H, channels: 4, background: CLEAR } })
        .composite([{ input: art, left: Math.round(5 * k), top: Math.round(10 * k) }, { input: mirror, left: Math.round(5 * k), top: Math.round(87 * k) }])
        .png()
        .toFile(path.join(OUT65, file));
    console.log(file, W, H);
}

(async () => {
    await icon(16, 'app-xmradio.png');
    await icon(32, 'app-xmradio@2x.png');
    await icon(64, 'app-xmradio@4x.png');
    await icon(32, 'app-xmradio-lg.png');
    await icon(64, 'app-xmradio-lg@2x.png');
    await icon(128, 'app-xmradio-lg@4x.png');
    await icon(45, 'start-xmradio.png', OUT65);
    await icon(90, 'start-xmradio@2x.png', OUT65);
    await icon(180, 'start-xmradio@4x.png', OUT65);
    await panel(0.5, 'ti-x-app-xmradio-lg.png');
    await panel(1, 'ti-x-app-xmradio-lg@2x.png');
    await panel(2, 'ti-x-app-xmradio-lg@4x.png');
})();
