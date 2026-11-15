#!/usr/bin/env node
/**
 * Art for Melaton Mobile's Lapis Remote (wmLapis.js, Yozora #835): the car maker's emblem, the slanted
 * H in its oval, as a bright metal badge on a dark field (Yukimi asked for it as the program icon and
 * on the app's plate). Limited colours, stepped shading, no rounded-square plate (2009 WM style).
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

// The emblem (Yukimi, Nov 15 2026: "use the hyundai logo as the icon and in the top of the app"): the
// slanted H in its oval, drawn here as the car's own badge is: bright metal on a dark field.
const emblem = (ring, metal, shade, field) => `
<ellipse cx="32" cy="32" rx="30" ry="18.500" fill="${shade}"/>
<ellipse cx="32" cy="31.200" rx="30" ry="18" fill="${ring}"/>
<ellipse cx="32" cy="31.200" rx="26.200" ry="14.600" fill="${field}"/>
<g fill="${metal}">
  <path d="M19.500 41.500 C14.500 34 17.500 25.500 27 20.800 L29.800 22.600 C23.500 27 22 33.500 25 40.300 Z"/>
  <path d="M44.500 20.900 C49.500 28.400 46.500 36.900 37 41.600 L34.200 39.800 C40.500 35.400 42 28.900 39 22.100 Z"/>
  <path d="M22.300 35.200 C29 34.600 36 31.800 41.600 26.400 L42 29.600 C36.800 34.800 29.800 38 22.900 38.600 Z"/>
</g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
${emblem('#dfe5ec', '#f4f7fa', '#5d6670', '#10233f')}
<path d="M6.500 26 C11 18.500 20 14.200 32 14.200 C44 14.200 53 18.500 57.500 26" fill="none" stroke="#ffffff" stroke-width="1.200" opacity="0.8"/>
</svg>`;

// 16 px: the oval and the H, three tones
const svgSmall = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<ellipse cx="8" cy="8" rx="7.600" ry="5" fill="#dfe5ec"/>
<ellipse cx="8" cy="8" rx="6.300" ry="3.800" fill="#10233f"/>
<path d="M5 10.500 C4 8.500 4.800 6.500 6.800 5.300 L7.600 5.900 C6.300 7 6 8.500 6.600 10.200 Z M11 5.500 C12 7.500 11.200 9.500 9.200 10.700 L8.400 10.100 C9.700 9 10 7.500 9.400 5.800 Z M5.900 9 C7.600 8.800 9.200 8.100 10.300 7 L10.400 8 C9.200 9.100 7.700 9.800 6 9.900 Z" fill="#f4f7fa"/>
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
