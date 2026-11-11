#!/usr/bin/env node
/**
 * Art for Melaton Mobile's Weather app (wmWeather.js, Yozora #732): glossy 2009-style condition
 * icons and the scene's clouds and moon, drawn here as SVG and rendered to PNG at 1x and 2x.
 * All shapes are our own; no third-party weather art.
 *
 *   node scripts/generate-wm-weather-art.js
 *
 * Writes public/static_images/wm61/weather/<name>.png and <name>@2x.png.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.resolve(__dirname, '..', 'public', 'static_images', 'wm61', 'weather');

// ---------------------------------------------------------------- shared pieces

const DEFS = `
<defs>
  <radialGradient id="sunCore" cx="40%" cy="35%" r="70%">
    <stop offset="0" stop-color="#fffbd0"/><stop offset="0.45" stop-color="#ffd52a"/><stop offset="1" stop-color="#f39200"/>
  </radialGradient>
  <linearGradient id="sunRay" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffd84a"/><stop offset="1" stop-color="#f7a000"/>
  </linearGradient>
  <linearGradient id="moonFill" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#e9c96a"/>
  </linearGradient>
  <linearGradient id="cloudLight" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#e8f1fb"/><stop offset="1" stop-color="#b9d0ea"/>
  </linearGradient>
  <linearGradient id="cloudGrey" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e9eef4"/><stop offset="1" stop-color="#9eabbb"/>
  </linearGradient>
  <linearGradient id="cloudDark" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9aa5b3"/><stop offset="1" stop-color="#4f5a6a"/>
  </linearGradient>
  <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#bfe6ff"/><stop offset="1" stop-color="#1a78dc"/>
  </linearGradient>
  <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff59a"/><stop offset="1" stop-color="#ffb000"/>
  </linearGradient>
  <linearGradient id="fogBar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f4f6f8"/><stop offset="1" stop-color="#a9b3bf"/>
  </linearGradient>
  <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
</defs>`;

/** Sun at (cx, cy), core radius r, 10 rays. */
function sun(cx, cy, r) {
    let rays = '';
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const w = 0.2;
        const p = (ang, rad) => `${(cx + Math.cos(ang) * rad).toFixed(2)},${(cy + Math.sin(ang) * rad).toFixed(2)}`;
        rays += `<polygon points="${p(a - w, r * 1.12)} ${p(a, r * 1.62)} ${p(a + w, r * 1.12)}" fill="url(#sunRay)" stroke="#d98200" stroke-width="${(r * 0.07).toFixed(2)}" stroke-linejoin="round"/>`;
    }
    return `<g>${rays}
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sunCore)" stroke="#d47a00" stroke-width="${(r * 0.08).toFixed(2)}"/>
      <ellipse cx="${cx - r * 0.18}" cy="${cy - r * 0.42}" rx="${r * 0.62}" ry="${r * 0.4}" fill="url(#gloss)" opacity="0.85"/></g>`;
}

/** Crescent moon at (cx, cy), radius r. */
function moon(cx, cy, r, id) {
    return `<g>
      <mask id="mm${id}"><rect x="0" y="0" width="200" height="200" fill="#fff"/><circle cx="${cx + r * 0.55}" cy="${cy - r * 0.35}" r="${r * 0.86}" fill="#000"/></mask>
      <g mask="url(#mm${id})">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#moonFill)" stroke="#b39132" stroke-width="${(r * 0.09).toFixed(2)}"/>
        <ellipse cx="${cx - r * 0.45}" cy="${cy - r * 0.2}" rx="${r * 0.3}" ry="${r * 0.55}" fill="url(#gloss)" opacity="0.8"/>
      </g></g>`;
}

function star(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 ? r * 0.32 : r;
        pts.push(`${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="#fff8c8" stroke="#c9a640" stroke-width="0.6" stroke-linejoin="round"/>`;
}

/**
 * A puffy cloud in a box (x, y, w, h): outline pass, fill pass, then a gloss clipped to the shape.
 * fill: url id; edge: outline colour.
 */
function cloud(x, y, w, h, fill, edge, id) {
    const parts = [
        ['c', x + w * 0.28, y + h * 0.62, h * 0.34],
        ['c', x + w * 0.5, y + h * 0.42, h * 0.42],
        ['c', x + w * 0.74, y + h * 0.6, h * 0.32],
        ['r', x + w * 0.16, y + h * 0.6, w * 0.7, h * 0.36, h * 0.18]
    ];
    const shapes = (extra) => parts.map((p) => (p[0] === 'c'
        ? `<circle cx="${p[1].toFixed(2)}" cy="${p[2].toFixed(2)}" r="${p[3].toFixed(2)}" ${extra}/>`
        : `<rect x="${p[1].toFixed(2)}" y="${p[2].toFixed(2)}" width="${p[3].toFixed(2)}" height="${p[4].toFixed(2)}" rx="${p[5].toFixed(2)}" ${extra}/>`)).join('');
    const sw = Math.max(1, h * 0.06).toFixed(2);
    return `<g>
      <clipPath id="cc${id}">${shapes('')}</clipPath>
      ${shapes(`fill="${edge}" stroke="${edge}" stroke-width="${sw * 2}"`)}
      ${shapes(`fill="url(#${fill})"`)}
      <g clip-path="url(#cc${id})"><ellipse cx="${x + w * 0.45}" cy="${y + h * 0.18}" rx="${w * 0.38}" ry="${h * 0.3}" fill="url(#gloss)" opacity="0.75"/></g>
    </g>`;
}

function drop(cx, cy, s) {
    return `<path d="M ${cx} ${cy - s} C ${cx + s * 0.15} ${cy - s * 0.5} ${cx + s * 0.6} ${cy} ${cx + s * 0.6} ${cy + s * 0.4}
      A ${s * 0.6} ${s * 0.6} 0 0 1 ${cx - s * 0.6} ${cy + s * 0.4} C ${cx - s * 0.6} ${cy} ${cx - s * 0.15} ${cy - s * 0.5} ${cx} ${cy - s} Z"
      fill="url(#drop)" stroke="#145cad" stroke-width="${(s * 0.14).toFixed(2)}" transform="rotate(14 ${cx} ${cy})"/>`;
}

function flake(cx, cy, r) {
    let arms = '';
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        const dx = Math.cos(a) * r;
        const dy = Math.sin(a) * r;
        arms += `<line x1="${(cx - dx).toFixed(2)}" y1="${(cy - dy).toFixed(2)}" x2="${(cx + dx).toFixed(2)}" y2="${(cy + dy).toFixed(2)}"/>`;
    }
    return `<g stroke-linecap="round"><g stroke="#4a86c8" stroke-width="${(r * 0.62).toFixed(2)}">${arms}</g><g stroke="#ffffff" stroke-width="${(r * 0.3).toFixed(2)}">${arms}</g></g>`;
}

function boltShape(x, y, s) {
    const p = [[0.55, 0], [0.12, 0.55], [0.42, 0.55], [0.25, 1], [0.86, 0.38], [0.54, 0.38], [0.78, 0]];
    return `<polygon points="${p.map(([a, b]) => `${(x + a * s * 0.7).toFixed(2)},${(y + b * s).toFixed(2)}`).join(' ')}" fill="url(#bolt)" stroke="#c96f00" stroke-width="${(s * 0.05).toFixed(2)}" stroke-linejoin="round"/>`;
}

function fogBars(x, y, w) {
    return [0, 1, 2].map((i) => `<rect x="${x + (i % 2 ? 6 : 0)}" y="${y + i * 6.5}" width="${w - 6}" height="4.6" rx="2.3" fill="url(#fogBar)" stroke="#7d8896" stroke-width="0.8"/>`).join('');
}

// ---------------------------------------------------------------- icons (64 x 64)

const ICONS = {
    'clear-day': () => sun(32, 32, 15),
    'clear-night': () => moon(30, 33, 20, 'a') + star(48, 14, 5) + star(53, 30, 3.2),
    'partly-day': () => sun(24, 22, 11) + cloud(14, 24, 48, 34, 'cloudLight', '#7f9fc4', 'a'),
    'partly-night': () => moon(24, 22, 14, 'b') + star(50, 10, 3.5) + cloud(14, 24, 48, 34, 'cloudLight', '#7f9fc4', 'b'),
    cloudy: () => cloud(18, 8, 44, 30, 'cloudGrey', '#76839a', 'a') + cloud(2, 22, 50, 36, 'cloudLight', '#7f9fc4', 'b'),
    fog: () => cloud(6, 4, 52, 36, 'cloudGrey', '#76839a', 'a') + fogBars(8, 42, 50),
    drizzle: () => cloud(6, 4, 52, 38, 'cloudGrey', '#76839a', 'a') + drop(22, 50, 5) + drop(34, 54, 5) + drop(46, 50, 5),
    rain: () => cloud(6, 2, 52, 38, 'cloudDark', '#3d4756', 'a') + drop(18, 49, 6.5) + drop(30, 54, 6.5) + drop(42, 49, 6.5) + drop(53, 55, 5),
    sleet: () => cloud(6, 2, 52, 38, 'cloudGrey', '#76839a', 'a') + drop(22, 50, 6.5) + flake(42, 52, 7),
    snow: () => cloud(6, 2, 52, 38, 'cloudGrey', '#76839a', 'a') + flake(18, 50, 6.5) + flake(34, 55, 6.5) + flake(50, 50, 6.5),
    storm: () => cloud(6, 2, 52, 38, 'cloudDark', '#3d4756', 'a') + boltShape(26, 32, 30) + drop(16, 50, 5.5) + drop(50, 50, 5.5)
};

// ---------------------------------------------------------------- scene art

/** A soft scene cloud: overlapping lobes with a lit top and a shaded base, slightly blurred edges. */
function sceneCloud(w, h, lobes, palette, id) {
    const [top, mid, base, rim] = palette;
    // the lobes and a flat base that joins them into one body
    const circles = lobes.map(([x, y, r]) => `<circle cx="${(x * w).toFixed(1)}" cy="${(y * h).toFixed(1)}" r="${(r * h).toFixed(1)}"/>`).join('')
        + `<ellipse cx="${(w * 0.5).toFixed(1)}" cy="${(h * 0.78).toFixed(1)}" rx="${(w * 0.34).toFixed(1)}" ry="${(h * 0.15).toFixed(1)}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="g${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${(h * 0.1).toFixed(1)}" x2="0" y2="${h}">
          <stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${mid}"/><stop offset="1" stop-color="${base}"/>
        </linearGradient>
        <filter id="f${id}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${(h * 0.018).toFixed(2)}"/></filter>
        <filter id="s${id}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${(h * 0.06).toFixed(2)}"/></filter>
        <clipPath id="c${id}">${circles}</clipPath>
      </defs>
      <g filter="url(#f${id})">
        <g fill="url(#g${id})">${circles}</g>
        <g clip-path="url(#c${id})">
          <ellipse cx="${w * 0.42}" cy="${h * 0.12}" rx="${w * 0.4}" ry="${h * 0.28}" fill="${rim}" opacity="0.55" filter="url(#s${id})"/>
          <rect x="0" y="${h * 0.78}" width="${w}" height="${h * 0.3}" fill="${base}" opacity="0.55" filter="url(#s${id})"/>
        </g>
      </g>
    </svg>`;
}

const LOBES = {
    a: [[0.2, 0.68, 0.26], [0.36, 0.5, 0.36], [0.56, 0.42, 0.4], [0.75, 0.56, 0.3], [0.88, 0.7, 0.2], [0.5, 0.72, 0.26]],
    b: [[0.22, 0.66, 0.3], [0.45, 0.46, 0.42], [0.7, 0.58, 0.34], [0.5, 0.74, 0.24]],
    c: [[0.12, 0.7, 0.2], [0.28, 0.6, 0.3], [0.46, 0.55, 0.32], [0.64, 0.6, 0.3], [0.82, 0.66, 0.24], [0.5, 0.76, 0.22]]
};

const LIGHT = ['#ffffff', '#f1f5fa', '#c3d2e3', '#ffffff'];
const DARK = ['#a3acb8', '#7a8594', '#4a5361', '#c7cfd9'];

const SCENE = {
    'cloud-a': () => sceneCloud(260, 120, LOBES.a, LIGHT, 'a'),
    'cloud-b': () => sceneCloud(180, 96, LOBES.b, LIGHT, 'b'),
    'cloud-c': () => sceneCloud(320, 96, LOBES.c, LIGHT, 'c'),
    'cloud-a-dark': () => sceneCloud(260, 120, LOBES.a, DARK, 'd'),
    'cloud-b-dark': () => sceneCloud(180, 96, LOBES.b, DARK, 'e'),
    'cloud-c-dark': () => sceneCloud(320, 96, LOBES.c, DARK, 'f'),
    moon: () => {
        const craters = [[0.38, 0.36, 0.1], [0.62, 0.3, 0.07], [0.56, 0.6, 0.12], [0.3, 0.64, 0.06], [0.7, 0.5, 0.05]];
        return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
          <defs>
            <radialGradient id="m" cx="38%" cy="34%" r="72%"><stop offset="0" stop-color="#fffef4"/><stop offset="0.7" stop-color="#e9e4cf"/><stop offset="1" stop-color="#c6bea0"/></radialGradient>
            <radialGradient id="k" cx="40%" cy="40%" r="60%"><stop offset="0" stop-color="#b9b196" stop-opacity="0.35"/><stop offset="1" stop-color="#9b937a" stop-opacity="0.75"/></radialGradient>
          </defs>
          <circle cx="48" cy="48" r="46" fill="url(#m)"/>
          ${craters.map(([x, y, r]) => `<circle cx="${x * 96}" cy="${y * 96}" r="${r * 96}" fill="url(#k)"/>`).join('')}
        </svg>`;
    }
};

// ---------------------------------------------------------------- write

async function render(name, svg, size1x) {
    const buf = Buffer.from(svg);
    for (const [suffix, scale] of [['', 1], ['@2x', 2]]) {
        const file = path.join(OUT, `${name}${suffix}.png`);
        const img = sharp(buf, { density: 72 * scale });
        const out = size1x ? img.resize(size1x[0] * scale, size1x[1] * scale) : img;
        await out.png({ compressionLevel: 9 }).toFile(file);
    }
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, draw] of Object.entries(ICONS)) {
        await render(`wx-${name}`, `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${DEFS}${draw()}</svg>`, [64, 64]);
    }
    for (const [name, draw] of Object.entries(SCENE)) await render(name, draw());
    console.log('wrote', Object.keys(ICONS).length + Object.keys(SCENE).length, 'pieces to', path.relative(process.cwd(), OUT));
}

main().catch((err) => { console.error(err); process.exit(1); });
