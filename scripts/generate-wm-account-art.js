#!/usr/bin/env node
/**
 * Service icons for Melaton Mobile's Accounts (wmAccounts.js, Yozora #829): one per account kind the
 * Account Manager lists, for the 6.1 Today block's rows and the 6.5 home screen's accounts panel.
 *
 *   node scripts/generate-wm-account-art.js
 *
 * Drawn here (2009 WM style: limited colours, stepped shading, no plate, no badge):
 *   novelai      NovelAI's pen nib, its own mark, in brand indigo
 *   cursor       Cursor's cube, its own mark, in greys
 *   tokenrouter  TokenRouter's router mark (one node fanning out to three), in brand blue
 *   runpod       a GPU card (RunPod rents GPUs; the CardSpace card shows one too), purple-grey
 * Taken from the Program Icons store (#773, already WM style, rebuilt per Yukimi's rules):
 *   claude       com-anthropic-claude, deepseek com-deepseek-chat, gemini com-google-android-apps-bard
 *
 * Writes public/static_images/wm61/svc-<name>.png (16, @2x 32, @4x 64) and svc-<name>-lg.png (32,
 * @2x 64, @4x 128); public/static_images/wm65/ti-x-svc-<name>-lg.png (43 x 57, @2x 86 x 113, @4x
 * 172 x 226): the 6.5 panel frame (art 76 x 76 at 5,10 of the 2x frame, its mirror from y 87, 40%
 * fading to nothing over 26 px), as scripts/generate-wm-traffic-art.js draws it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', 'public', 'static_images');
const OUT61 = path.join(ROOT, 'wm61');
const OUT65 = path.join(ROOT, 'wm65');
const STORE = path.join(ROOT, 'wm-android');

const SVG = {
    novelai: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
  <linearGradient id="l" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9c95f0"/><stop offset="0.5" stop-color="#6a62e0"/><stop offset="1" stop-color="#4a42b8"/>
  </linearGradient>
  <linearGradient id="r" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3f37a6"/><stop offset="0.6" stop-color="#2f2888"/><stop offset="1" stop-color="#231d6a"/>
  </linearGradient>
  <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5a52cc"/><stop offset="1" stop-color="#2c2580"/>
  </linearGradient>
</defs>
<!-- the two blades -->
<path d="M28.6 4 L28.6 30.5 A4.6 4.6 0 0 0 26.2 36.8 L18.6 44 L13.2 38.6 C12.4 37.8 12.6 36.6 13.4 35.6 C20 27.6 24.6 15 27.2 5 C27.4 4.4 28 4 28.6 4 Z" fill="url(#l)" stroke="#120e40" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M35.4 4 L35.4 30.5 A4.6 4.6 0 0 1 37.8 36.8 L45.4 44 L50.8 38.6 C51.6 37.8 51.4 36.6 50.6 35.6 C44 27.6 39.4 15 36.8 5 C36.6 4.4 36 4 35.4 4 Z" fill="url(#r)" stroke="#120e40" stroke-width="1.3" stroke-linejoin="round"/>
<!-- the breather hole and the slit's end -->
<circle cx="32" cy="35" r="5.4" fill="url(#b)" stroke="#120e40" stroke-width="1.3"/>
<circle cx="30.6" cy="33.4" r="1.6" fill="#c9c4ff" opacity="0.8"/>
<!-- the foot -->
<path d="M30 41.6 L25.4 46.2 C24.6 47 24.6 48.4 25.4 49.2 C26.2 50 27.6 50 28.4 49.2 L33.2 44.4 L37.6 48.8 L36.4 58 C36.3 59 35.6 59.6 34.6 59.6 L22.6 59.6 C21.6 59.6 20.9 59 20.6 58 L18.6 50.4 Z" fill="url(#b)" stroke="#120e40" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M20.8 51 L22.3 57.2 L27 57.2" fill="none" stroke="#8d86ee" stroke-width="1.4" opacity="0.8"/>
<!-- highlights on the left blade -->
<path d="M26 9 C24.2 17 21 25.6 16.4 33" fill="none" stroke="#d6d2ff" stroke-width="1.6" opacity="0.75"/>
</svg>`,

    cursor: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<!-- the cube: top, left and right faces, then the facet that runs from the top face into the corner -->
<path d="M32 4 L56 17.6 L32 31.2 L8 17.6 Z" fill="#d9dbde"/>
<path d="M8 17.6 L32 31.2 L32 60 L8 46.4 Z" fill="#8d9197"/>
<path d="M56 17.6 L32 31.2 L32 60 L56 46.4 Z" fill="#3a3d42"/>
<path d="M8.8 17.6 L55.2 17.6 L32 58.6 Z" fill="#f3f4f5" opacity="0.92"/>
<path d="M32 31.2 L55.2 17.6 L32 58.6 Z" fill="#5b5f66" opacity="0.9"/>
<path d="M32 4 L56 17.6 L56 46.4 L32 60 L8 46.4 L8 17.6 Z" fill="none" stroke="#111214" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M10.5 19 L32 31.2" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.6"/>
</svg>`,

    tokenrouter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
  <radialGradient id="n" cx="38%" cy="34%" r="70%">
    <stop offset="0" stop-color="#bfe2ff"/><stop offset="0.45" stop-color="#2b9bff"/><stop offset="1" stop-color="#0058b0"/>
  </radialGradient>
</defs>
<path d="M12 32 C26 32 30 13 50 13 M12 32 H50 M12 32 C26 32 30 51 50 51" fill="none" stroke="#0a2f5c" stroke-width="7" stroke-linecap="round"/>
<path d="M12 32 C26 32 30 13 50 13 M12 32 H50 M12 32 C26 32 30 51 50 51" fill="none" stroke="#3d9df5" stroke-width="3.6" stroke-linecap="round"/>
<path d="M14 30.8 C26 30.6 30 11.8 48 11.8 M14 30.8 H48" fill="none" stroke="#bfe0ff" stroke-width="1" stroke-linecap="round" opacity="0.8"/>
<circle cx="12" cy="32" r="9" fill="url(#n)" stroke="#0a2f5c" stroke-width="1.6"/>
<circle cx="51" cy="13" r="7.4" fill="url(#n)" stroke="#0a2f5c" stroke-width="1.6"/>
<circle cx="51" cy="32" r="7.4" fill="url(#n)" stroke="#0a2f5c" stroke-width="1.6"/>
<circle cx="51" cy="51" r="7.4" fill="url(#n)" stroke="#0a2f5c" stroke-width="1.6"/>
</svg>`,

    runpod: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
  <linearGradient id="c" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#b4aee0"/><stop offset="0.5" stop-color="#8178c4"/><stop offset="1" stop-color="#4f468f"/>
  </linearGradient>
  <radialGradient id="f" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#4a4560"/><stop offset="0.7" stop-color="#26232f"/><stop offset="1" stop-color="#121016"/>
  </radialGradient>
</defs>
<!-- bracket -->
<path d="M4 14 H9 V52 H4 Z" fill="#c4c8cf" stroke="#2a2d33" stroke-width="1.2"/>
<rect x="5.2" y="20" width="2.6" height="5" fill="#2a2d33"/><rect x="5.2" y="29" width="2.6" height="5" fill="#2a2d33"/><rect x="5.2" y="38" width="2.6" height="5" fill="#2a2d33"/>
<!-- the card's shroud -->
<path d="M9 14 H58 C59.4 14 60 14.8 60 16 V46 C60 47.2 59.4 48 58 48 H9 Z" fill="url(#c)" stroke="#221d45" stroke-width="1.4"/>
<path d="M10.5 15.6 H57.6" stroke="#e2dfff" stroke-width="1.2" opacity="0.8"/>
<!-- two fans -->
<circle cx="23" cy="31" r="11.2" fill="url(#f)" stroke="#191621" stroke-width="1.2"/>
<circle cx="46" cy="31" r="11.2" fill="url(#f)" stroke="#191621" stroke-width="1.2"/>
<g fill="#6c6688" opacity="0.95">
  <path d="M23 31 C21 25 22 21.5 25.5 20.6 C24.4 24 24.6 27.6 23 31 Z"/><path d="M23 31 C28 27.4 31.6 28 33 31.2 C29.6 30.6 26.6 31.8 23 31 Z"/><path d="M23 31 C25.4 36.6 24 40.2 20.6 41 C22 37.8 21.8 34.4 23 31 Z"/><path d="M23 31 C18 34.4 14.4 33.6 13 30.6 C16.4 31.2 19.4 30.2 23 31 Z"/>
  <path d="M46 31 C44 25 45 21.5 48.5 20.6 C47.4 24 47.6 27.6 46 31 Z"/><path d="M46 31 C51 27.4 54.6 28 56 31.2 C52.6 30.6 49.6 31.8 46 31 Z"/><path d="M46 31 C48.4 36.6 47 40.2 43.6 41 C45 37.8 44.8 34.4 46 31 Z"/><path d="M46 31 C41 34.4 37.4 33.6 36 30.6 C39.4 31.2 42.4 30.2 46 31 Z"/>
</g>
<circle cx="23" cy="31" r="3" fill="#8d86c8" stroke="#191621" stroke-width="0.8"/>
<circle cx="46" cy="31" r="3" fill="#8d86c8" stroke="#191621" stroke-width="0.8"/>
<!-- the edge connector -->
<path d="M16 48 H48 V53 H16 Z" fill="#2d6b2a"/>
<path d="M17 48 H47 V52 H17 Z" fill="#e0b13a"/>
<path d="M17 48.2 V52 M20 48.2 V52 M23 48.2 V52 M26 48.2 V52 M29 48.2 V52 M35 48.2 V52 M38 48.2 V52 M41 48.2 V52 M44 48.2 V52" stroke="#8a6512" stroke-width="0.9"/>
</svg>`
};

// The Program Icons store's sets (WM style already): name -> store prefix
const FROM_STORE = {
    claude: 'com-anthropic-claude-914a0e-mwebcd1x',
    deepseek: 'com-deepseek-chat-a49b51-mwecc8m4',
    gemini: 'com-google-android-apps-bard-0de5c5-mweccb00'
};

async function renderSvg(svg, size) {
    return sharp(Buffer.from(svg), { density: Math.max(72, Math.round((72 * size) / 64) * 2) }).resize(size, size).png().toBuffer();
}

/** A 6.5 home screen panel icon at scale k (1 = the 2x frame) from a square source picture. */
async function panel(src, k, file) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    const R = Math.round(26 * k);
    const art = await src(A);
    const flipped = await sharp(art).flip().extract({ left: 0, top: 0, width: A, height: R }).ensureAlpha().raw().toBuffer();
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
    for (const [name, svg] of Object.entries(SVG)) {
        const sizes = [[16, ''], [32, '@2x'], [64, '@4x']];
        for (const [s, sfx] of sizes) await sharp(await renderSvg(svg, s)).toFile(path.join(OUT61, `svc-${name}${sfx}.png`));
        for (const [s, sfx] of sizes) await sharp(await renderSvg(svg, s * 2)).toFile(path.join(OUT61, `svc-${name}-lg${sfx}.png`));
        const src = (A) => renderSvg(svg, A);
        await panel(src, 0.5, `ti-x-svc-${name}-lg.png`);
        await panel(src, 1, `ti-x-svc-${name}-lg@2x.png`);
        await panel(src, 2, `ti-x-svc-${name}-lg@4x.png`);
        console.log('svc', name);
    }
    for (const [name, prefix] of Object.entries(FROM_STORE)) {
        for (const sfx of ['', '@2x', '@4x', '-lg', '-lg@2x', '-lg@4x']) {
            fs.copyFileSync(path.join(STORE, `${prefix}${sfx}.png`), path.join(OUT61, `svc-${name}${sfx}.png`));
        }
        const big = path.join(STORE, `${prefix}-lg@4x.png`);
        const src = (A) => sharp(big).ensureAlpha().resize(A, A, { kernel: 'lanczos3' }).png().toBuffer();
        await panel(src, 0.5, `ti-x-svc-${name}-lg.png`);
        await panel(src, 1, `ti-x-svc-${name}-lg@2x.png`);
        await panel(src, 2, `ti-x-svc-${name}-lg@4x.png`);
        console.log('store', name);
    }
})();
