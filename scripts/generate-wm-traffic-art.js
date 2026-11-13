#!/usr/bin/env node
/**
 * Art for Melaton Mobile's Traffic app (wmTraffic.js, Yozora #795): the program icon, our own design.
 * A traffic signal (black housing, red / amber / green lamps, green lit) standing over a road that
 * runs into the distance. Limited colours, stepped shading, no rounded-square plate (2009 WM style).
 *
 *   node scripts/generate-wm-traffic-art.js
 *
 * Writes public/static_images/wm61/app-traffic.png (16, @2x 32, @4x 64) and app-traffic-lg.png
 * (32, @2x 64, @4x 128); for 6.5 the Start icon public/static_images/wm65/start-traffic.png (45, @2x
 * 90, @4x 180) and the home screen panel ti-x-app-traffic-lg.png (43 x 57, @2x 86 x 113, @4x 172 x 226):
 * the real panels' frame as ~/.cache/wm65/art/build.sh panel() measures it (at 2x: art 76 x 76 at 5,10,
 * its mirror image from y 87, 40% fading to nothing over 26 px), drawn here at every size from the SVG.
 */
'use strict';

const path = require('path');
const sharp = require('sharp');

const OUT = path.resolve(__dirname, '..', 'public', 'static_images', 'wm61');
const OUT65 = path.resolve(__dirname, '..', 'public', 'static_images', 'wm65');

// The lit lamp of Today's panel follows the app's report (Yukimi, Nov 13; the program icon stays green):
// heavy = red, moderate = amber, clear = green (the default files), none = every lamp dark (no report).
const LAMPS = [
    { cy: 11, dark: '#3a0d0b', lit: ['#ffd6cc', '#ff3b1e', '#9c1606'], glow: '#ff5a3a', small: { cy: 2.8, dark: '#5a1210', lit: '#ff3b1e', hi: '#ffe0d6' } },
    { cy: 22, dark: '#3d2a06', lit: ['#fff3c4', '#ffb31a', '#a86400'], glow: '#ffc23a', small: { cy: 6, dark: '#5a420a', lit: '#ffb31a', hi: '#fff4cc' } },
    { cy: 33, dark: '#0d2e08', lit: ['#d8ffb8', '#4bd62a', '#1c7d10'], glow: '#7dff52', small: { cy: 9.2, dark: '#123d0c', lit: '#46d628', hi: '#e4ffd0' } }
];
const LIT = { heavy: 0, moderate: 1, clear: 2, none: -1 };

const svgFor = (level) => {
    const on = LIT[level];
    const lamps = LAMPS.map((l, i) => i === on
        ? `<circle cx="47" cy="${l.cy}" r="9" fill="url(#glow${i})"/><circle cx="47" cy="${l.cy}" r="5.2" fill="url(#lamp${i})" stroke="#000" stroke-width="0.8"/>`
        : `<circle cx="47" cy="${l.cy}" r="5.2" fill="${l.dark}" stroke="#000" stroke-width="0.8"/>`).join('\n');
    const shines = LAMPS.map((l, i) => `<ellipse cx="45.4" cy="${l.cy - 1.6}" rx="${i === on ? 1.8 : 1.6}" ry="${i === on ? 1.1 : 1}" fill="#fff" opacity="${i === on ? 0.8 : 0.18}"/>`).join('\n');
    const defs = LAMPS.map((l, i) => `<radialGradient id="lamp${i}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="${l.lit[0]}"/><stop offset="0.45" stop-color="${l.lit[1]}"/><stop offset="1" stop-color="${l.lit[2]}"/></radialGradient>
  <radialGradient id="glow${i}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${l.glow}" stop-opacity="0.75"/><stop offset="1" stop-color="${l.glow}" stop-opacity="0"/></radialGradient>`).join('\n  ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
  <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5d6670"/><stop offset="0.5" stop-color="#454c55"/><stop offset="1" stop-color="#2f343b"/>
  </linearGradient>
  <linearGradient id="house" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3a3f46"/><stop offset="0.35" stop-color="#22262b"/><stop offset="1" stop-color="#101215"/>
  </linearGradient>
  <linearGradient id="pole" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9aa3ad"/><stop offset="0.5" stop-color="#6b737c"/><stop offset="1" stop-color="#454b52"/>
  </linearGradient>
  ${defs}
</defs>
<!-- road into the distance -->
<path d="M2 62 L26 30 L38 30 L62 62 Z" fill="url(#road)"/>
<path d="M2 62 L26 30 L27.5 30 L5.5 62 Z" fill="#c9ced4"/>
<path d="M62 62 L38 30 L36.5 30 L58.5 62 Z" fill="#c9ced4"/>
<path d="M31.2 33 L32.8 33 L33.2 38 L30.8 38 Z M30.4 42 L33.6 42 L34.3 50 L29.7 50 Z M29.2 54 L34.8 54 L35.6 62 L28.4 62 Z" fill="#ffd23a"/>
<!-- pole -->
<rect x="45" y="30" width="4" height="30" fill="url(#pole)"/>
<rect x="43" y="58" width="8" height="3" fill="#3d4247"/>
<!-- housing with hoods -->
<rect x="38" y="2" width="18" height="40" rx="3" fill="url(#house)" stroke="#05070a" stroke-width="1.2"/>
<rect x="39.3" y="3.2" width="2" height="37.6" rx="1" fill="#5a616a" opacity="0.7"/>
${lamps}
<path d="M42.6 9.3 Q47 4.8 51.4 9.3" fill="none" stroke="#8e969f" stroke-width="1.4"/>
<path d="M42.6 20.3 Q47 15.8 51.4 20.3" fill="none" stroke="#8e969f" stroke-width="1.4"/>
<path d="M42.6 31.3 Q47 26.8 51.4 31.3" fill="none" stroke="#8e969f" stroke-width="1.4"/>
${shines}
</svg>`;
};

// the 16 px icon: fewer parts (the signal alone, lamps one pixel bigger), so it stays readable
const svgSmallFor = (level) => {
    const on = LIT[level];
    const lamps = LAMPS.map((l, i) => i === on
        ? `<circle cx="12.5" cy="${l.small.cy}" r="1.45" fill="${l.small.lit}"/><circle cx="12.1" cy="${l.small.cy - 0.4}" r="0.45" fill="${l.small.hi}"/>`
        : `<circle cx="12.5" cy="${l.small.cy}" r="1.35" fill="${l.small.dark}"/>`).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<path d="M0 16 L6 9 L10 9 L16 16 Z" fill="#454c55"/>
<path d="M7.6 10 h0.8 v1.6 h-0.8 z M7.4 13 h1.2 v2.4 h-1.2 z" fill="#ffd23a"/>
<rect x="10" y="0.5" width="5" height="11" rx="1" fill="#1a1d21" stroke="#000" stroke-width="0.5"/>
${lamps}
<rect x="12" y="11.5" width="1" height="4" fill="#7b838c"/>
</svg>`;
};

let svg = svgFor('clear');

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

async function render(src, size, file) {
    await sharp(Buffer.from(src), { density: Math.max(72, Math.round((72 * size) / 16)) })
        .resize(size, size)
        .png()
        .toFile(path.isAbsolute(file) ? file : path.join(OUT, file));
    console.log(path.basename(file), size);
}

(async () => {
    // the program icon (6.1 Programs, 6.5 Start): the green signal, as it always was
    svg = svgFor('clear');
    await render(svgSmallFor('clear'), 16, 'app-traffic.png');
    await render(svg, 32, 'app-traffic@2x.png');
    await render(svg, 64, 'app-traffic@4x.png');
    await render(svg, 32, 'app-traffic-lg.png');
    await render(svg, 64, 'app-traffic-lg@2x.png');
    await render(svg, 128, 'app-traffic-lg@4x.png');
    await render(svg, 45, path.join(OUT65, 'start-traffic.png'));
    await render(svg, 90, path.join(OUT65, 'start-traffic@2x.png'));
    await render(svg, 180, path.join(OUT65, 'start-traffic@4x.png'));
    // Today's panel lights the report's lamp (wmTraffic.js levelSuffix): clear keeps the plain name
    for (const level of ['clear', 'moderate', 'heavy', 'none']) {
        const sfx = level === 'clear' ? '' : `-${level}`;
        svg = svgFor(level);
        await panel(0.5, `ti-x-app-traffic-lg${sfx}.png`);
        await panel(1, `ti-x-app-traffic-lg${sfx}@2x.png`);
        await panel(2, `ti-x-app-traffic-lg${sfx}@4x.png`);
    }
})();
