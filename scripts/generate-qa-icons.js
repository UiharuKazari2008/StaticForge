#!/usr/bin/env node
/**
 * Quick Access's glyphs for Android's own quick settings (StaticForge #1017, Yukimi Nov 22 2026: "use the icons from
 * android if possible or something that better represents what it is"): Android's quick settings draw Material icons,
 * so the built-in tiles take the Material Design Icons glyph of the same meaning (@mdi/font, Pictogrammers Free
 * License), white on transparent as Android tints them. Tiles that are other apps' TileServices (Samsung's QR scanner,
 * Power saving, Dolby, Modes, Screen recorder, Performance, Power sharing; WireGuard; Traffic Cone) use their own
 * glyph from the phone (appassets app-icon ?tile=1), not these.
 *
 *   node scripts/generate-qa-icons.js     -> public/static_images/quickaccess/<name>.png (96 px)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');

const MDI = path.dirname(require.resolve('@mdi/font/package.json'));
const OUT = path.join(__dirname, '..', 'public', 'static_images', 'quickaccess');
const SIZE = 96;

// file name -> Material glyph (the meaning Android's own tile shows)
const GLYPHS = {
    'wifi': 'wifi', 'wifi-off': 'wifi-off',
    'bluetooth': 'bluetooth', 'bluetooth-off': 'bluetooth-off',
    'brightness': 'brightness-6', 'brightness-auto': 'brightness-auto', 'adaptive-tone': 'white-balance-auto',
    'volume': 'volume-high', 'volume-off': 'volume-off', 'output': 'speaker-wireless',
    'sound': 'volume-high', 'vibrate': 'vibrate', 'mute': 'volume-off',
    'rotate': 'phone-rotate-landscape', 'rotate-lock': 'phone-rotate-portrait',
    'hotspot': 'access-point', 'hotspot-off': 'access-point-off',
    'dnd': 'minus-circle', 'dnd-off': 'minus-circle-outline',
    'flashlight': 'flashlight', 'flashlight-off': 'flashlight-off',
    'eye-comfort': 'eye-check-outline',
    'pointer-flow': 'cursor-default-outline',
    'qr': 'qrcode-scan', 'record': 'record-rec', 'modes': 'tune-variant', 'power-saving': 'battery-heart-variant',
    'network': 'signal-5g', 'dolby': 'surround-sound', 'performance': 'speedometer', 'power-share': 'battery-arrow-up',
    'vpn': 'vpn'
};

const css = fs.readFileSync(path.join(MDI, 'css', 'materialdesignicons.css'), 'utf8');
const code = (name) => {
    const m = new RegExp(`\\.mdi-${name.replace(/[-]/g, '\\-')}::before\\s*\\{\\s*content:\\s*"\\\\([0-9A-Fa-f]+)"`).exec(css);
    if (!m) throw new Error(`no glyph ${name}`);
    return String.fromCodePoint(parseInt(m[1], 16));
};

registerFont(path.join(MDI, 'fonts', 'materialdesignicons-webfont.ttf'), { family: 'MDI' });
fs.mkdirSync(OUT, { recursive: true });
for (const [file, glyph] of Object.entries(GLYPHS)) {
    const c = createCanvas(SIZE, SIZE);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = `${SIZE * 0.86}px MDI`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code(glyph), SIZE / 2, SIZE / 2 + SIZE * 0.02);
    fs.writeFileSync(path.join(OUT, `${file}.png`), c.toBuffer('image/png'));
}
console.log(`${Object.keys(GLYPHS).length} glyphs -> ${path.relative(process.cwd(), OUT)}`);
