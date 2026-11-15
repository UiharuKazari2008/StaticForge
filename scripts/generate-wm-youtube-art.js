#!/usr/bin/env node
/**
 * Art for Melaton Mobile's YouTube program (wmYouTube.js, Yozora #839): our own drawing, a small
 * television set with a red screen and a white play mark (not YouTube's logo). Limited colours and
 * stepped shading in the 2009 WM style; no plate behind it.
 *
 *   node scripts/generate-wm-youtube-art.js
 *
 * Writes public/static_images/wm61/app-youtube.png (16, @2x 32, @4x 64) and app-youtube-lg.png (32,
 * @2x 64, @4x 128); for 6.5 the Start icon wm65/start-youtube.png (45, @2x 90, @4x 180) and the home
 * screen panel ti-x-app-youtube-lg.png (43 x 57, @2x 86 x 113, @4x 172 x 226: the art, then its fading
 * mirror, as in generate-wm-lapis-art.js).
 */
'use strict';

const path = require('path');
const sharp = require('sharp');

const OUT = path.resolve(__dirname, '..', 'public', 'static_images', 'wm61');
const OUT65 = path.resolve(__dirname, '..', 'public', 'static_images', 'wm65');

// the set: a dark cabinet with a light edge, two short aerials, a red glass screen, feet
const TV = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="cab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7178"/><stop offset="0.5" stop-color="#3a3f45"/><stop offset="0.52" stop-color="#25282d"/><stop offset="1" stop-color="#33373d"/></linearGradient>
    <linearGradient id="scr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a4d"/><stop offset="0.5" stop-color="#e3261c"/><stop offset="0.52" stop-color="#c2140f"/><stop offset="1" stop-color="#a00d0a"/></linearGradient>
  </defs>
  <path d="M36 6 L50 24 M68 4 L52 24" fill="none" stroke="#2b2f34" stroke-width="5" stroke-linecap="round"/>
  <path d="M36 6 L50 24 M68 4 L52 24" fill="none" stroke="#aab1b9" stroke-width="2" stroke-linecap="round"/>
  <rect x="4" y="22" width="92" height="66" rx="13" fill="#15171a"/>
  <rect x="6.5" y="24.5" width="87" height="61" rx="11" fill="url(#cab)"/>
  <rect x="8" y="26" width="84" height="58" rx="10" fill="none" stroke="#9aa1a9" stroke-width="1.6" opacity="0.7"/>
  <rect x="14" y="31" width="72" height="48" rx="8" fill="#5c0806"/>
  <rect x="15.5" y="32.5" width="69" height="45" rx="7" fill="url(#scr)"/>
  <path d="M20 34 H80 Q83 34 83 38 V50 Q50 60 17 50 V38 Q17 34 20 34 Z" fill="#ffffff" opacity="0.2"/>
  <path d="M42 42 L64 55 L42 68 Z" fill="#7a0907" opacity="0.55" transform="translate(1.5 2)"/>
  <path d="M42 42 L64 55 L42 68 Z" fill="#ffffff"/>
  <rect x="20" y="88" width="14" height="6" rx="2" fill="#1c1e22"/>
  <rect x="66" y="88" width="14" height="6" rx="2" fill="#1c1e22"/>
</svg>`;

// 16 px: the same set with fewer parts so the play mark stays clear
const TV_SMALL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <path d="M5.5 1 L8 4 M10.5 1 L8 4" fill="none" stroke="#3a3f45" stroke-width="1.2" stroke-linecap="round"/>
  <rect x="0.5" y="3.5" width="15" height="11" rx="2.2" fill="#2b2f34" stroke="#15171a" stroke-width="1"/>
  <rect x="2" y="5" width="12" height="8" rx="1.3" fill="#d81f16"/>
  <rect x="2" y="5" width="12" height="3.6" rx="1.3" fill="#ff5a4d" opacity="0.75"/>
  <path d="M6.6 6.6 L10.4 9 L6.6 11.4 Z" fill="#ffffff"/>
</svg>`;

async function icon(size, file, dir = OUT) {
    const svg = size <= 16 ? TV_SMALL : TV;
    await sharp(Buffer.from(svg), { density: 72 * Math.max(1, size / 16) * 4 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(dir, file));
    console.log(file, size);
}

/** A 6.5 home screen panel icon at scale k (1 = the 2x frame): the art seated on the floor, then its fading mirror. */
async function panel(k, file) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    const R = Math.round(26 * k);
    // the drawing's feet end at 94 of 100: shift it down so they stand on the panel's floor
    const raw = await sharp(Buffer.from(TV), { density: 72 * Math.max(1, A / 16) }).resize(A, A).png().toBuffer();
    const drop = Math.round(A * 0.06);
    const art = await sharp({ create: { width: A, height: A, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp(raw).extract({ left: 0, top: 0, width: A, height: A - drop }).png().toBuffer(), left: 0, top: drop }]).png().toBuffer();
    // two steps: sharp cuts before it flips when both are asked for at once
    const upside = await sharp(art).flip().png().toBuffer();
    const flipped = await sharp(upside).extract({ left: 0, top: 0, width: A, height: R }).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < R; y++) {
        const f = 0.4 * (1 - y / R);
        for (let x = 0; x < A; x++) { const i = (y * A + x) * 4 + 3; flipped[i] = Math.round(flipped[i] * f); }
    }
    const mirror = await sharp(flipped, { raw: { width: A, height: R, channels: 4 } }).png().toBuffer();
    await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: art, left: Math.round(5 * k), top: Math.round(10 * k) }, { input: mirror, left: Math.round(5 * k), top: Math.round(87 * k) }])
        .png()
        .toFile(path.join(OUT65, file));
    console.log(file, W, H);
}

(async () => {
    await icon(16, 'app-youtube.png');
    await icon(32, 'app-youtube@2x.png');
    await icon(64, 'app-youtube@4x.png');
    await icon(32, 'app-youtube-lg.png');
    await icon(64, 'app-youtube-lg@2x.png');
    await icon(128, 'app-youtube-lg@4x.png');
    await icon(45, 'start-youtube.png', OUT65);
    await icon(90, 'start-youtube@2x.png', OUT65);
    await icon(180, 'start-youtube@4x.png', OUT65);
    await panel(0.5, 'ti-x-app-youtube-lg.png');
    await panel(1, 'ti-x-app-youtube-lg@2x.png');
    await panel(2, 'ti-x-app-youtube-lg@4x.png');
})();
