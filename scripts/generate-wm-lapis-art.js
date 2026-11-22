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
// the bare emblem (slanted H in its oval) at target width w: chrome metal with a dark edge, transparent
async function emblemChrome(w) {
    const ww = Math.round(w);
    const mask = await sharp(MASK).resize({ width: ww }).png().toBuffer();
    const mh = (await sharp(mask).metadata()).height;
    const tint = async (fill) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ww}" height="${mh}">${fill}</svg>`)).resize(ww, mh).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const metal = await tint(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#e3e8ee"/><stop offset="0.52" stop-color="#b9c2cc"/><stop offset="1" stop-color="#e9edf2"/></linearGradient></defs><rect width="${ww}" height="${mh}" fill="url(#g)"/>`);
    const edge = await tint(`<rect width="${ww}" height="${mh}" fill="#0b1f3f"/>`);
    const e = Math.max(1, Math.round(w / 40));
    const layers = [];
    for (const [dx, dy] of [[-e, 0], [e, 0], [0, -e], [0, e], [-e, -e], [e, e], [-e, e], [e, -e], [0, e * 2]]) layers.push({ input: edge, left: e + dx, top: e + dy });
    layers.push({ input: metal, left: e, top: e });
    const W = ww + e * 2, H = mh + e * 3;
    const buf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
    return { buf, w: W, h: H };
}

// the program icon (Programs, Start): the emblem centred on transparent (these sit on light lists)
async function emblemPng(size) {
    let em = await emblemChrome(size * 0.86);
    // the emblem plus its dark edge must fit the square (tiny sizes round up)
    if (em.w > size || em.h > size) {
        const buf = await sharp(em.buf).resize({ width: Math.min(size, Math.round(size * em.w / Math.max(em.w, em.h))), fit: 'inside' }).png().toBuffer();
        const m = await sharp(buf).metadata();
        em = { buf, w: m.width, h: m.height };
    }
    return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: em.buf, left: Math.round((size - em.w) / 2), top: Math.round((size - em.h) / 2) }]).png().toBuffer();
}

async function render(_src, size, file) {
    await sharp(await emblemPng(size)).toFile(file);
    console.log(path.basename(file), size);
}

// ---- panel glyphs (the 6.5 Today slider): a solid icon filling the square, seated on the floor ----

/** An AxA square with `buf` scaled to `widthFrac` of A and sat on the bottom edge. */
async function seat(A, buf, widthFrac = 0.96, bottomPad = 0.02) {
    const w = Math.round(A * widthFrac);
    const r = await sharp(buf).resize({ width: w }).png().toBuffer();
    const h = (await sharp(r).metadata()).height;
    const top = Math.max(0, A - h - Math.round(A * bottomPad));
    return sharp({ create: { width: A, height: A, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: r, left: Math.round((A - w) / 2), top }]).png().toBuffer();
}

/** The logo page: the chrome emblem on a glossy blue badge (reads on the dark panel), filling the square. */
async function logoSquare(A) {
    const badge = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 92" width="${A}" height="${Math.round(A * 0.92)}">
        <defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a93dd"/><stop offset="0.5" stop-color="#1e63ad"/><stop offset="0.52" stop-color="#14528f"/><stop offset="1" stop-color="#0b3straight"/></linearGradient></defs>
        <rect x="6" y="4" width="88" height="84" rx="20" fill="#0a2a4d"/>
        <rect x="7" y="5" width="86" height="82" rx="19" fill="url(#b)"/>
        <path d="M14 10 H86 Q92 10 92 20 V44 Q50 58 8 44 V20 Q8 10 14 10 Z" fill="#ffffff" opacity="0.16"/>
        <rect x="9" y="7" width="82" height="78" rx="17" fill="none" stroke="#6fb0e8" stroke-width="1.4" opacity="0.55"/>
    </svg>`.replace('#0b3straight', '#0b3a66'))).png().toBuffer();
    const bh = (await sharp(badge).metadata()).height;
    const em = await emblemChrome(A * 0.68);
    const sq = sharp({ create: { width: A, height: A, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([
            { input: badge, left: 0, top: A - bh },
            { input: em.buf, left: Math.round((A - em.w) / 2), top: Math.round(A - bh + (bh - em.h) / 2 - A * 0.02) },
        ]);
    return sq.png().toBuffer();
}

const KEY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="fob" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d424a"/><stop offset="0.48" stop-color="#191c21"/><stop offset="0.5" stop-color="#0b0c0f"/><stop offset="1" stop-color="#262a30"/></linearGradient>
    <linearGradient id="ch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f8f9"/><stop offset="0.5" stop-color="#c3ccd4"/><stop offset="1" stop-color="#eef0f2"/></linearGradient>
    <radialGradient id="rs" cx="0.5" cy="0.35" r="0.7"><stop offset="0" stop-color="#4fd0f5"/><stop offset="0.6" stop-color="#00aad2"/><stop offset="1" stop-color="#0a3a52"/></radialGradient>
  </defs>
  <circle cx="50" cy="12" r="8" fill="none" stroke="url(#ch)" stroke-width="5"/>
  <rect x="24" y="16" width="52" height="82" rx="16" fill="url(#ch)"/>
  <rect x="27.5" y="19.5" width="45" height="75" rx="13" fill="url(#fob)"/>
  <ellipse cx="50" cy="36" rx="15" ry="9" fill="none" stroke="#cfd6de" stroke-width="2.4"/>
  <path d="M43 31 q1.5 10 0 14 M57 31 q-1.5 10 0 14 M43.5 36.5 q6.5 3 13 0" fill="none" stroke="#cfd6de" stroke-width="2.2" stroke-linecap="round"/>
  <rect x="35" y="52" width="30" height="10" rx="5" fill="#2b2f35" stroke="#4a515a" stroke-width="1.2"/>
  <rect x="35" y="65" width="30" height="10" rx="5" fill="#2b2f35" stroke="#4a515a" stroke-width="1.2"/>
  <circle cx="50" cy="86" r="9" fill="url(#rs)" stroke="#0a3a52" stroke-width="1.4"/>
  <path d="M50 81.5 V86 M46.5 83.5 a4.5 4.5 0 1 0 7 0" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const TOOLBOX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef5a48"/><stop offset="0.5" stop-color="#c7382a"/><stop offset="1" stop-color="#9c271c"/></linearGradient>
    <linearGradient id="lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f26c5a"/><stop offset="1" stop-color="#cf3e2f"/></linearGradient>
    <linearGradient id="hc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0f2"/><stop offset="1" stop-color="#9aa3ad"/></linearGradient>
  </defs>
  <path d="M33 34 q17 -15 34 0" fill="none" stroke="#2b2f35" stroke-width="6" stroke-linecap="round"/>
  <rect x="30" y="30" width="40" height="9" rx="3.5" fill="#34383f"/>
  <rect x="14" y="38" width="72" height="20" rx="5" fill="url(#lid)" stroke="#8c2318" stroke-width="1.4"/>
  <rect x="14" y="56" width="72" height="36" rx="5" fill="url(#red)" stroke="#8c2318" stroke-width="1.4"/>
  <rect x="14" y="70" width="72" height="3" fill="#9c271c" opacity="0.8"/>
  <rect x="42" y="50" width="16" height="13" rx="2" fill="url(#hc)" stroke="#5d6670" stroke-width="1"/>
  <rect x="46.5" y="53" width="7" height="7" rx="1.5" fill="#2b2f35"/>
  <rect x="18" y="60" width="9" height="5" rx="1.5" fill="#f26c5a" opacity="0.7"/>
  <rect x="73" y="60" width="9" height="5" rx="1.5" fill="#f26c5a" opacity="0.7"/>
</svg>`;

/** A 6.5 home screen panel icon at scale k (1 = the 2x frame): the square art, then its fading mirror. */
async function panel(k, file, squareFn) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    const art = await sharp(await squareFn(A)).resize(A, A, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    // the ROM's own geometry and a mirror of the art's bottom (modules/wm65PanelIcon.js, Nov 21 2026)
    fs.writeFileSync(path.join(OUT65, file), await require('../modules/wm65PanelIcon').panelIcon(art, k));
    console.log(file, W, H);
}

const svgSquare = (svg) => async (A) => seat(A, Buffer.from(svg), 0.9, 0.03);

/** Each Today panel icon at its three sizes: ti-x-<name>-lg{,@2x,@4x}.png. */
async function panels(name, squareFn) {
    await panel(0.5, `ti-x-${name}-lg.png`, squareFn);
    await panel(1, `ti-x-${name}-lg@2x.png`, squareFn);
    await panel(2, `ti-x-${name}-lg@4x.png`, squareFn);
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
    // the Today slider's per-page icons (logo on the main page, key on remote start, toolbox on maintenance)
    await panels('app-lapis', logoSquare);
    await panels('lapis-key', svgSquare(KEY_SVG));
    await panels('lapis-wrench', svgSquare(TOOLBOX_SVG));
    // the plate's mark: the shape in white, 2x and 4x of its 24 px width
    await sharp(MASK).resize({ width: 192 }).png().toFile(path.join(OUT_LAPIS, 'emblem.png'));
    const car = process.argv.slice(2).find((a, n, all) => !a.startsWith('--') && all[n - 1] !== '--emblem');
    if (car) await carPicture(car);
})();
