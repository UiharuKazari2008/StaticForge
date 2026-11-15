#!/usr/bin/env node
/**
 * Art for Melaton Mobile's Lapis Remote (wmLapis.js, Yozora #835), our own design: a cut lapis lazuli
 * stone (stepped blue facets, two gold flecks) in a silver claw setting. Limited colours, stepped
 * shading, no rounded-square plate (2009 WM style).
 *
 *   node scripts/generate-wm-lapis-art.js [car-picture]
 *
 * Writes public/static_images/wm61/app-lapis.png (16, @2x 32, @4x 64) and app-lapis-lg.png (32, @2x 64,
 * @4x 128); for 6.5 the Start icon wm65/start-lapis.png (45, @2x 90, @4x 180) and the home screen panel
 * ti-x-app-lapis-lg.png (43 x 57, @2x 86 x 113, @4x 172 x 226; the panel frame of
 * generate-wm-traffic-art.js).
 *
 * With a picture path it also writes the built-in car picture public/static_images/lapis/car.webp
 * (720 px wide) and car-sm.webp (240 px): the picture Yukimi supplied of her car's model in grey,
 * repainted gloss black (a gamma curve on the neutral tones; lamps and chrome keep their colour).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.resolve(__dirname, '..', 'public', 'static_images', 'wm61');
const OUT65 = path.resolve(__dirname, '..', 'public', 'static_images', 'wm65');
const OUT_LAPIS = path.resolve(__dirname, '..', 'public', 'static_images', 'lapis');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<!-- setting: silver band and claws -->
<path d="M8 25 L20 9 L44 9 L56 25 L32 58 Z" fill="#59616b"/>
<path d="M10.5 25 L21.2 11 L42.8 11 L53.5 25 L32 54.5 Z" fill="#0b1d6e"/>
<!-- crown facets (stepped blues) -->
<path d="M21.2 11 L42.8 11 L38 25 L26 25 Z" fill="#4f7df0"/>
<path d="M21.2 11 L26 25 L10.5 25 Z" fill="#2b53d0"/>
<path d="M42.8 11 L53.5 25 L38 25 Z" fill="#1c3aa8"/>
<path d="M21.2 11 L32 11 L26 25 Z" fill="#7da2ff"/>
<!-- pavilion facets -->
<path d="M10.5 25 L26 25 L32 54.5 Z" fill="#1f41b8"/>
<path d="M26 25 L38 25 L32 54.5 Z" fill="#2f5be0"/>
<path d="M38 25 L53.5 25 L32 54.5 Z" fill="#11267e"/>
<!-- girdle line and table shine -->
<path d="M10.5 25 H53.5" stroke="#a9c2ff" stroke-width="1.2"/>
<path d="M23.5 13 L31 13 L27.5 21.5 Z" fill="#d6e3ff"/>
<!-- pyrite flecks -->
<path d="M40 16 l2.4 1.2 l-1 2.4 l-2.4 -1.2 z" fill="#e6c25a"/>
<path d="M29 33 l2 1 l-0.8 2 l-2 -1 z" fill="#e6c25a"/>
<path d="M36.5 39 l1.4 0.7 l-0.6 1.4 l-1.4 -0.7 z" fill="#c9a23c"/>
<!-- claws -->
<path d="M17.5 8 L23 8 L22 14 L18 14 Z" fill="#e8edf2" stroke="#59616b" stroke-width="0.8"/>
<path d="M41 8 L46.5 8 L46 14 L42 14 Z" fill="#c5ccd4" stroke="#59616b" stroke-width="0.8"/>
<path d="M6 23 L11.5 21.5 L13 27 L7.5 28 Z" fill="#e8edf2" stroke="#59616b" stroke-width="0.8"/>
<path d="M58 23 L52.5 21.5 L51 27 L56.5 28 Z" fill="#aab2bb" stroke="#59616b" stroke-width="0.8"/>
<path d="M29 56 L35 56 L32 61 Z" fill="#c5ccd4" stroke="#59616b" stroke-width="0.8"/>
</svg>`;

// 16 px: the stone alone, four tones
const svgSmall = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<path d="M1.5 6 L5 1.5 L11 1.5 L14.5 6 L8 15 Z" fill="#12277f" stroke="#59616b" stroke-width="0.8"/>
<path d="M5 2 L11 2 L9.5 6 L6.5 6 Z" fill="#5a86f2"/>
<path d="M5 2 L6.5 6 L2.2 6 Z" fill="#2b53d0"/>
<path d="M6.5 6 L9.5 6 L8 14 Z" fill="#2f5be0"/>
<path d="M2.2 6 L6.5 6 L8 14 Z" fill="#1f41b8"/>
<path d="M5.8 2.8 L7.6 2.8 L6.8 5 Z" fill="#d6e3ff"/>
<rect x="10" y="3.5" width="1" height="1" fill="#e6c25a"/>
</svg>`;

async function render(src, size, file) {
    await sharp(Buffer.from(src), { density: Math.max(72, Math.round((72 * size) / 16)) }).resize(size, size).png().toFile(file);
    console.log(path.basename(file), size);
}

/** A 6.5 home screen panel icon at scale k (1 = the 2x frame): art, then its fading mirror. */
async function panel(k, file) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    const R = Math.round(26 * k);
    const art = await sharp(Buffer.from(svg), { density: Math.round((72 * A) / 64) * 2 }).resize(A, A).png().toBuffer();
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

/** The supplied grey car repainted gloss black: neutral tones through a gamma curve, coloured parts kept. */
async function carPicture(src) {
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const l = (r + g + b) / 3;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const l2 = Math.pow(Math.max(0, (l - 0.08) / 0.92), 1.9);
        const k = Math.min(1, sat * 4); // 1 = a coloured pixel (lamp, reflector): keep its hue
        const gain = l > 0.001 ? Math.sqrt(l2 / l) : 0;
        const mix = (c, tint) => Math.round(255 * Math.min(1, (l2 * tint) * (1 - k) + c * gain * k));
        data[i] = mix(r, 0.94);
        data[i + 1] = mix(g, 0.98);
        data[i + 2] = mix(b, 1.07);
    }
    fs.mkdirSync(OUT_LAPIS, { recursive: true });
    const img = () => sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim();
    await img().resize({ width: 720 }).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(OUT_LAPIS, 'car.webp'));
    await img().resize({ width: 240 }).webp({ quality: 84, alphaQuality: 90 }).toFile(path.join(OUT_LAPIS, 'car-sm.webp'));
    console.log('car.webp, car-sm.webp');
}

(async () => {
    await render(svgSmall, 16, path.join(OUT, 'app-lapis.png'));
    await render(svg, 32, path.join(OUT, 'app-lapis@2x.png'));
    await render(svg, 64, path.join(OUT, 'app-lapis@4x.png'));
    await render(svg, 32, path.join(OUT, 'app-lapis-lg.png'));
    await render(svg, 64, path.join(OUT, 'app-lapis-lg@2x.png'));
    await render(svg, 128, path.join(OUT, 'app-lapis-lg@4x.png'));
    await render(svg, 45, path.join(OUT65, 'start-lapis.png'));
    await render(svg, 90, path.join(OUT65, 'start-lapis@2x.png'));
    await render(svg, 180, path.join(OUT65, 'start-lapis@4x.png'));
    await panel(0.5, 'ti-x-app-lapis-lg.png');
    await panel(1, 'ti-x-app-lapis-lg@2x.png');
    await panel(2, 'ti-x-app-lapis-lg@4x.png');
    if (process.argv[2]) await carPicture(process.argv[2]);
})();
