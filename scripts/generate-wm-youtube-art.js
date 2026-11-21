#!/usr/bin/env node
/**
 * Art for Melaton Videos (wmYouTube.js on the phone, apps/videos on the desktop; Yozora #839/#861/#920), redrawn
 * Nov 21 2026 (Yukimi: "generate a better icon for mobile and desktop"). Our own drawing, not YouTube's logo: a
 * glossy black widescreen set on a chrome stand, its screen an evening sky over dark hills, with a round red glass
 * play button on it (the program's red accent; a circle, never YouTube's rounded red box).
 *
 *   node scripts/generate-wm-youtube-art.js [--sheet <dir>]
 *
 * One identity, drawn for each platform:
 * - Melaton Mobile 6.1 (flat, lightly glossy, seen from the front, no plate behind it):
 *   public/static_images/wm61/app-youtube.png (16, @2x 32, @4x 64) and app-youtube-lg.png (32, @2x 64, @4x 128).
 *   16 px is its own simpler drawing; 32 px keeps the play button large.
 * - Melaton Mobile 6.5 (its 3D Start art): wm65/start-youtube.png (45, @2x 90, @4x 180) and the home screen panel
 *   ti-x-app-youtube-lg.png (43 x 57, @2x 86 x 113, @4x 172 x 226: the art seated on the floor, then its fading
 *   mirror, as in generate-wm-lapis-art.js).
 * - The desktop (Vista Aero: three-quarter view, soft light, a ground shadow): the 512 px master
 *   public/static_images/app_icons/videos.png, its own small frames app_icons/frames/videos/{16,24,32,48}.png
 *   (16 and 24 face the front, as Vista's small frames do), and apps/videos/assets/videos-48.png (the package icon).
 *
 * With --sheet <dir> it also writes contact sheets of every file it made (on white and on black).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'static_images', 'wm61');
const OUT65 = path.join(ROOT, 'public', 'static_images', 'wm65');
const APP_ICONS = path.join(ROOT, 'public', 'static_images', 'app_icons');
const FRAMES = path.join(APP_ICONS, 'frames', 'videos');
const PKG = path.join(ROOT, 'apps', 'videos', 'assets');

const f = (n) => Math.round(n * 100) / 100;
const pt = (p) => `${f(p[0])},${f(p[1])}`;

// ------------------------------------------------------------------------------------------------- shared parts

/** Gradients and filters every drawing uses (ids prefixed so two drawings never meet in one file). */
const DEFS = `
  <linearGradient id="bz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f57"/><stop offset="0.08" stop-color="#23262b"/><stop offset="0.6" stop-color="#121417"/><stop offset="1" stop-color="#050506"/></linearGradient>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1f4d"/><stop offset="0.38" stop-color="#1f5aa8"/><stop offset="0.7" stop-color="#5fb4e0"/><stop offset="1" stop-color="#c8ecf2"/></linearGradient>
  <linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a5f86"/><stop offset="1" stop-color="#173a57"/></linearGradient>
  <linearGradient id="near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14324a"/><stop offset="1" stop-color="#07131d"/></linearGradient>
  <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7cf0c8" stop-opacity="0"/><stop offset="0.45" stop-color="#9df7d6" stop-opacity="0.85"/><stop offset="1" stop-color="#7cf0c8" stop-opacity="0"/></linearGradient>
  <radialGradient id="orb" cx="0.42" cy="0.3" r="0.78"><stop offset="0" stop-color="#ff8a78"/><stop offset="0.45" stop-color="#e3261c"/><stop offset="0.85" stop-color="#9c0d08"/><stop offset="1" stop-color="#6e0704"/></radialGradient>
  <linearGradient id="orbHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.05"/></linearGradient>
  <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset="0.45" stop-color="#b9c0c8"/><stop offset="0.55" stop-color="#8d959e"/><stop offset="1" stop-color="#d9dee3"/></linearGradient>
  <linearGradient id="neck" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a2d32"/><stop offset="0.5" stop-color="#5b6068"/><stop offset="1" stop-color="#1b1d21"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.04"/></linearGradient>
  <filter id="soft" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>
  <filter id="orbShade" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>`;

/** The red glass play button: an orb with a white play mark and a gloss cap. */
function orb(cx, cy, r, detail = true) {
    const t = [[cx - r * 0.3, cy - r * 0.46], [cx + r * 0.5, cy], [cx - r * 0.3, cy + r * 0.46]];
    const cap = `<ellipse cx="${f(cx)}" cy="${f(cy - r * 0.48)}" rx="${f(r * 0.66)}" ry="${f(r * 0.38)}" fill="url(#orbHi)"${detail ? '' : ' opacity="0.6"'}/>`;
    const mark = `<path d="M${pt(t[0])} L${pt(t[1])} L${pt(t[2])} Z" fill="#ffffff" stroke="#ffffff" stroke-width="${f(r * 0.08)}" stroke-linejoin="round"/>`;
    // small sizes put the gloss under the play mark, so the mark stays pure white
    return `
  ${detail ? `<circle cx="${f(cx + r * 0.06)}" cy="${f(cy + r * 0.14)}" r="${f(r * 1.02)}" fill="#000" opacity="0.45" filter="url(#orbShade)"/>` : ''}
  <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="#5a0503"/>
  <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.93)}" fill="url(#orb)"/>
  ${detail ? `<path d="M${pt(t[0])} L${pt(t[1])} L${pt(t[2])} Z" fill="#6e0704" opacity="0.55" transform="translate(${f(r * 0.05)} ${f(r * 0.07)})"/>` : ''}
  ${detail ? mark + cap : cap + mark}`;
}

/** Bilinear point inside the quad a (top left), b (top right), c (bottom right), d (bottom left). */
function quad(a, b, c, d) {
    return (u, v) => [
        (1 - u) * (1 - v) * a[0] + u * (1 - v) * b[0] + u * v * c[0] + (1 - u) * v * d[0],
        (1 - u) * (1 - v) * a[1] + u * (1 - v) * b[1] + u * v * c[1] + (1 - u) * v * d[1]
    ];
}
const poly = (P, list) => list.map(([u, v]) => pt(P(u, v))).join(' ');

/** The screen's picture drawn through a quad (front view: a rectangle; three-quarter view: a trapezoid). */
function scene(P, id, seek = true) {
    const far = [[0, 0.7], [0.12, 0.63], [0.26, 0.68], [0.42, 0.6], [0.58, 0.67], [0.74, 0.61], [0.88, 0.66], [1, 0.62], [1, 1], [0, 1]];
    const near = [[0, 0.82], [0.18, 0.75], [0.36, 0.8], [0.55, 0.73], [0.78, 0.81], [1, 0.76], [1, 1], [0, 1]];
    const band = [[0, 0.34], [0.3, 0.24], [0.62, 0.32], [1, 0.2], [1, 0.3], [0.62, 0.42], [0.3, 0.33], [0, 0.45]];
    const band2 = [[0, 0.5], [0.4, 0.42], [0.7, 0.47], [1, 0.38], [1, 0.43], [0.7, 0.52], [0.4, 0.47], [0, 0.54]];
    // the player's seek bar along the foot of the picture, played to 40 % (the program's red)
    const bar = seek ? `
    <polygon points="${poly(P, [[0, 0.9], [1, 0.9], [1, 1], [0, 1]])}" fill="#000" opacity="0.55"/>
    <polygon points="${poly(P, [[0.06, 0.935], [0.94, 0.935], [0.94, 0.965], [0.06, 0.965]])}" fill="#ffffff" opacity="0.3"/>
    <polygon points="${poly(P, [[0.06, 0.935], [0.42, 0.935], [0.42, 0.965], [0.06, 0.965]])}" fill="#ff3b2e"/>
    <circle cx="${f(P(0.42, 0.95)[0])}" cy="${f(P(0.42, 0.95)[1])}" r="${f(Math.abs(P(0, 1)[1] - P(0, 0)[1]) * 0.035)}" fill="#ffffff"/>` : '';
    return `
  <clipPath id="${id}"><polygon points="${poly(P, [[0, 0], [1, 0], [1, 1], [0, 1]])}"/></clipPath>
  <g clip-path="url(#${id})">
    <polygon points="${poly(P, [[0, 0], [1, 0], [1, 1], [0, 1]])}" fill="url(#sky)"/>
    <polygon points="${poly(P, band)}" fill="url(#glow)"/>
    <polygon points="${poly(P, band2)}" fill="url(#glow)" opacity="0.55"/>
    <polygon points="${poly(P, far)}" fill="url(#far)"/>
    <polygon points="${poly(P, near)}" fill="url(#near)"/>${bar}
  </g>`;
}

// ------------------------------------------------------------------------------------------------- drawings

/** Front view (Melaton Mobile 6.1, the desktop's 16 / 24 px frames): viewBox 0 0 100 100. */
function front() {
    const S = quad([12, 22], [88, 22], [88, 64], [12, 64]);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${DEFS}</defs>
  <rect x="44" y="72" width="12" height="12" fill="url(#neck)"/>
  <ellipse cx="50" cy="87" rx="30" ry="6.5" fill="#2b2f35"/>
  <ellipse cx="50" cy="86" rx="29" ry="5.5" fill="url(#chrome)"/>
  <rect x="4" y="14" width="92" height="60" rx="4.5" fill="#050506"/>
  <rect x="5.5" y="15.5" width="89" height="57" rx="3.5" fill="url(#bz)"/>
  <rect x="5.5" y="15.5" width="89" height="57" rx="3.5" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1"/>
  <rect x="11" y="21" width="78" height="44" fill="#000"/>
  ${scene(S, 'fs')}
  <path d="M12 22 H88 V36 Q50 46 12 40 Z" fill="url(#sheen)"/>
  <circle cx="50" cy="69" r="1.3" fill="#e8281d" opacity="0.9"/>
  ${orb(50, 43, 15)}
</svg>`;
}

/** 16 px (6.1 small icon, the desktop's 16 px frame): its own drawing on a 16 grid. */
const SMALL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs>${DEFS}</defs>
  <rect x="5" y="12" width="6" height="1.6" fill="#3a3f45"/>
  <rect x="3" y="13.4" width="10" height="1.6" rx="0.8" fill="#a9b1ba"/>
  <rect x="0.5" y="1.5" width="15" height="10.5" rx="1" fill="#16181b" stroke="#050506" stroke-width="1"/>
  <rect x="1.5" y="2.5" width="13" height="8.5" fill="url(#sky)"/>
  <path d="M1.5 8.6 L5 7.3 L9 8.4 L14.5 7 V11 H1.5 Z" fill="#14324a"/>
  <circle cx="8" cy="6.6" r="3.4" fill="#8a0a06"/>
  <circle cx="8" cy="6.6" r="2.9" fill="#e3261c"/>
  <path d="M7 4.9 L10 6.6 L7 8.3 Z" fill="#ffffff"/>
  <rect x="1.5" y="2.5" width="13" height="1" fill="#ffffff" opacity="0.25"/>
</svg>`;

/** 24 px frame: front view, fewer parts than the large one. */
const MID24 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs>${DEFS}</defs>
  <rect x="10" y="17.5" width="4" height="2.5" fill="url(#neck)"/>
  <ellipse cx="12" cy="20.8" rx="7" ry="1.7" fill="#2b2f35"/>
  <ellipse cx="12" cy="20.5" rx="6.6" ry="1.3" fill="url(#chrome)"/>
  <rect x="0.5" y="2.5" width="23" height="15.5" rx="1.4" fill="url(#bz)" stroke="#050506" stroke-width="1"/>
  <rect x="2" y="4" width="20" height="12" fill="url(#sky)"/>
  <path d="M2 12.2 L6 10.6 L11 12 L16 10.4 L22 11.6 V16 H2 Z" fill="#14324a"/>
  <path d="M2 4 H22 V7.4 Q12 9.4 2 8.2 Z" fill="#ffffff" opacity="0.22"/>
  ${orb(12, 9.8, 4.4, false)}
</svg>`;

/** Three-quarter view (the desktop, Melaton Mobile 6.5): viewBox 0 0 256 256, the set turned a little to the right. */
function threeQuarter() {
    const A = [22, 34], B = [232, 54], C = [232, 170], D = [22, 186];
    const BZ = quad(A, B, C, D);
    const S = quad(BZ(0.045, 0.075), BZ(0.955, 0.075), BZ(0.955, 0.885), BZ(0.045, 0.885));
    const side = [A, [A[0] - 9, A[1] + 5], [D[0] - 9, D[1] - 3], D];
    const foot = BZ(0.5, 1);
    const sheen = [[0, 0], [0.62, 0], [0.38, 1], [0, 1]];
    const o = S(0.5, 0.47);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs>${DEFS}
  <linearGradient id="side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3b4047"/><stop offset="1" stop-color="#121417"/></linearGradient>
  <radialGradient id="ground" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
  <ellipse cx="128" cy="228" rx="104" ry="16" fill="url(#ground)"/>
  <ellipse cx="${f(foot[0] + 2)}" cy="220" rx="58" ry="11" fill="#000" opacity="0.35" filter="url(#soft)"/>
  <path d="M${f(foot[0] - 9)} ${f(foot[1] - 4)} L${f(foot[0] + 9)} ${f(foot[1] - 4)} L${f(foot[0] + 12)} 212 L${f(foot[0] - 12)} 212 Z" fill="url(#neck)"/>
  <ellipse cx="${f(foot[0])}" cy="215" rx="56" ry="12.5" fill="#24272c"/>
  <ellipse cx="${f(foot[0])}" cy="213" rx="54" ry="10.5" fill="url(#chrome)"/>
  <ellipse cx="${f(foot[0] - 8)}" cy="210" rx="30" ry="3.2" fill="#ffffff" opacity="0.55"/>
  <polygon points="${side.map(pt).join(' ')}" fill="url(#side)"/>
  <polygon points="${[A, B, C, D].map(pt).join(' ')}" fill="#050506"/>
  <polygon points="${poly(BZ, [[0.006, 0.012], [0.994, 0.012], [0.994, 0.988], [0.006, 0.988]])}" fill="url(#bz)"/>
  <polyline points="${poly(BZ, [[0.006, 0.988], [0.006, 0.012], [0.994, 0.012]])}" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="1.6"/>
  <polygon points="${poly(BZ, [[0.04, 0.068], [0.96, 0.068], [0.96, 0.893], [0.04, 0.893]])}" fill="#000"/>
  ${scene(S, 'qs')}
  <polygon points="${poly(S, sheen)}" fill="url(#sheen)"/>
  <circle cx="${f(BZ(0.5, 0.945)[0])}" cy="${f(BZ(0.5, 0.945)[1])}" r="2.2" fill="#ff5a4d"/>
  ${orb(o[0], o[1], 34)}
</svg>`;
}

// ------------------------------------------------------------------------------------------------- output

const written = [];
async function render(svg, w, h, file) {
    // drawn at 4x the asked size, then scaled down (soft edges at every size)
    const vb = Number((/viewBox="0 0 (\d+)/.exec(svg) || [])[1]) || 100;
    const density = Math.ceil(72 * (Math.max(w, h) * 4) / vb);
    await sharp(Buffer.from(svg), { density }).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(file);
    written.push(file);
    console.log(path.relative(ROOT, file), w, h);
}
const BY_SIZE = (size) => (size <= 16 ? SMALL : front());

/** A 6.5 home screen panel icon at scale k (1 = the 2x frame): the art seated on the floor, then its fading mirror. */
async function panel(k, file) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    const R = Math.round(26 * k);
    // the drawing's stand ends at 236 of 256 (its shadow below it): shift it down so it stands on the panel's floor
    const raw = await sharp(Buffer.from(threeQuarter()), { density: 72 * Math.max(1, A / 16) }).resize(A, A).png().toBuffer();
    const drop = Math.round(A * 0.08);
    const art = await sharp({ create: { width: A, height: A, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp(raw).extract({ left: 0, top: 0, width: A, height: A - drop }).png().toBuffer(), left: 0, top: drop }]).png().toBuffer();
    // two steps: sharp cuts before it flips when both are asked for at once
    const upside = await sharp(art).flip().png().toBuffer();
    const flipped = await sharp(upside).extract({ left: 0, top: 0, width: A, height: R }).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < R; y++) {
        const g = 0.4 * (1 - y / R);
        for (let x = 0; x < A; x++) { const i = (y * A + x) * 4 + 3; flipped[i] = Math.round(flipped[i] * g); }
    }
    const mirror = await sharp(flipped, { raw: { width: A, height: R, channels: 4 } }).png().toBuffer();
    await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: art, left: Math.round(5 * k), top: Math.round(10 * k) }, { input: mirror, left: Math.round(5 * k), top: Math.round(87 * k) }])
        .png()
        .toFile(path.join(OUT65, file));
    written.push(path.join(OUT65, file));
    console.log(file, W, H);
}

async function sheet(dir, name, bg, files) {
    const cell = 200;
    const cols = Math.min(files.length, 6);
    const rows = Math.ceil(files.length / cols);
    const comps = [];
    for (let i = 0; i < files.length; i++) {
        const m = await sharp(files[i]).metadata();
        // small files at 1:1 in the corner and scaled up (nearest) beside it, large ones fitted
        const s = Math.min((cell - 16) / Math.max(m.width, m.height), m.width <= 64 ? 4 : 1);
        const w = Math.max(1, Math.round(m.width * s));
        const h = Math.max(1, Math.round(m.height * s));
        comps.push({ input: await sharp(files[i]).resize(w, h, { kernel: s > 1 ? 'nearest' : 'lanczos3' }).png().toBuffer(), left: (i % cols) * cell + ((cell - w) >> 1), top: Math.floor(i / cols) * cell + ((cell - h) >> 1) });
    }
    await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: bg } }).composite(comps).png().toFile(path.join(dir, name));
}

(async () => {
    fs.mkdirSync(FRAMES, { recursive: true });
    // Melaton Mobile 6.1
    for (const [size, file] of [[16, 'app-youtube.png'], [32, 'app-youtube@2x.png'], [64, 'app-youtube@4x.png'], [32, 'app-youtube-lg.png'], [64, 'app-youtube-lg@2x.png'], [128, 'app-youtube-lg@4x.png']]) {
        // the small icon's @2x / @4x are the 16 px drawing made sharper, as the shell draws them in a 16 px box
        await render(file.startsWith('app-youtube.') || file.startsWith('app-youtube@') ? SMALL : BY_SIZE(size), size, size, path.join(OUT, file));
    }
    // Melaton Mobile 6.5
    for (const [size, file] of [[45, 'start-youtube.png'], [90, 'start-youtube@2x.png'], [180, 'start-youtube@4x.png']]) await render(threeQuarter(), size, size, path.join(OUT65, file));
    await panel(0.5, 'ti-x-app-youtube-lg.png');
    await panel(1, 'ti-x-app-youtube-lg@2x.png');
    await panel(2, 'ti-x-app-youtube-lg@4x.png');
    // the desktop
    await render(threeQuarter(), 512, 512, path.join(APP_ICONS, 'videos.png'));
    await render(SMALL, 16, 16, path.join(FRAMES, '16.png'));
    await render(MID24, 24, 24, path.join(FRAMES, '24.png'));
    await render(threeQuarter(), 32, 32, path.join(FRAMES, '32.png'));
    await render(threeQuarter(), 48, 48, path.join(FRAMES, '48.png'));
    await render(threeQuarter(), 48, 48, path.join(PKG, 'videos-48.png'));

    const at = process.argv.indexOf('--sheet');
    if (at > 0 && process.argv[at + 1]) {
        const dir = path.resolve(process.argv[at + 1]);
        fs.mkdirSync(dir, { recursive: true });
        await sheet(dir, 'videos-icons-white.png', '#ffffff', written);
        await sheet(dir, 'videos-icons-black.png', '#101010', written);
        console.log('sheets in', dir);
    }
})();
