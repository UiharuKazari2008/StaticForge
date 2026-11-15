#!/usr/bin/env node
/**
 * Art for Melaton Mobile's Lapis Remote (wmLapis.js, Yozora #835): the car maker's emblem, the slanted
 * H in its oval, as a bright metal badge on a dark field (Yukimi asked for it as the program icon and
 * on the app's plate). Limited colours, stepped shading, no rounded-square plate (2009 WM style).
 *
 *   node scripts/generate-wm-lapis-art.js [car-picture] [--emblem <picture of the mark>]
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

// The emblem (Yukimi, Nov 15 2026: "use the hyundai logo as the icon and in the top of the app"; she then
// supplied the mark itself). Its shape is kept as a mask, public/static_images/lapis/emblem-mask.png
// (white on transparent, made once from her picture with --emblem <picture>); the icons are that shape
// in bright metal with a dark edge, so it reads on the dark title bar and on a light Programs list.
const MASK = path.join(OUT_LAPIS, 'emblem-mask.png');

/** Her picture of the mark (dark on white) as a white-on-transparent mask, trimmed, 1024 px wide. */
async function makeMask(src) {
    const { data, info } = await sharp(src).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < info.width * info.height; i++) {
        out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255;
        out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((200 - data[i]) * 2.2)));
    }
    fs.mkdirSync(OUT_LAPIS, { recursive: true });
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().resize({ width: 1024 }).png().toFile(MASK);
    console.log('emblem-mask.png');
}

/** The emblem as a square icon of `size` px: metal fill, dark edge, a soft shade under it. */
async function emblemPng(size, onFloor) {
    const pad = Math.max(1, Math.round(size * 0.03));
    const w = size - pad * 2;
    const mask = await sharp(MASK).resize({ width: w }).png().toBuffer();
    const mh = (await sharp(mask).metadata()).height;
    // onFloor: the mark stands on the square's bottom edge (the 6.5 panel mirrors the art below it)
    const top = onFloor ? size - mh - Math.max(1, Math.round(size / 24)) : Math.round((size - mh) / 2);
    // a fill cut to the shape: what the mask does not cover is removed (dest-in)
    const tint = async (svgFill) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${mh}">${svgFill}</svg>`)).resize(w, mh).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const metal = await tint(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#e3e8ee"/><stop offset="0.52" stop-color="#b9c2cc"/><stop offset="1" stop-color="#e9edf2"/></linearGradient></defs><rect width="${w}" height="${mh}" fill="url(#g)"/>`);
    const edge = await tint(`<rect width="${w}" height="${mh}" fill="#0b1f3f"/>`);
    const e = Math.max(1, Math.round(size / 48));
    const layers = [];
    // the dark edge: the shape nudged a step every way
    for (const [dx, dy] of [[-e, 0], [e, 0], [0, -e], [0, e], [-e, -e], [e, e], [-e, e], [e, -e], [0, e * 2]]) layers.push({ input: edge, left: pad + dx, top: top + dy });
    layers.push({ input: metal, left: pad, top });
    return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
}

async function render(_src, size, file) {
    await sharp(await emblemPng(size)).toFile(file);
    console.log(path.basename(file), size);
}

/** A 6.5 home screen panel icon at scale k (1 = the 2x frame): art, then its fading mirror. */
async function panel(k, file) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    const R = Math.round(26 * k);
    const art = await emblemPng(A, true);
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
    const em = process.argv.indexOf('--emblem');
    if (em > 0 && process.argv[em + 1]) await makeMask(process.argv[em + 1]);
    await render(null, 16, path.join(OUT, 'app-lapis.png'));
    await render(null, 32, path.join(OUT, 'app-lapis@2x.png'));
    await render(null, 64, path.join(OUT, 'app-lapis@4x.png'));
    await render(null, 32, path.join(OUT, 'app-lapis-lg.png'));
    await render(null, 64, path.join(OUT, 'app-lapis-lg@2x.png'));
    await render(null, 128, path.join(OUT, 'app-lapis-lg@4x.png'));
    await render(null, 45, path.join(OUT65, 'start-lapis.png'));
    await render(null, 90, path.join(OUT65, 'start-lapis@2x.png'));
    await render(null, 180, path.join(OUT65, 'start-lapis@4x.png'));
    await panel(0.5, 'ti-x-app-lapis-lg.png');
    await panel(1, 'ti-x-app-lapis-lg@2x.png');
    await panel(2, 'ti-x-app-lapis-lg@4x.png');
    // the plate's mark: the shape in white, 2x and 4x of its 24 px width
    await sharp(MASK).resize({ width: 192 }).png().toFile(path.join(OUT_LAPIS, 'emblem.png'));
    const car = process.argv.slice(2).find((a, n, all) => !a.startsWith('--') && all[n - 1] !== '--emblem');
    if (car) await carPicture(car);
})();
