#!/usr/bin/env node
/**
 * The output panel's pictures (StaticForge #1327): the Output combo's own glyphs (wmShell.js GLYPHS: output, headphones,
 * headset, display, jack, speaker, cast) and a check, as white PNG files on transparent with addresses, so the Android
 * app (which cannot draw SVG, and is not given data: strings for pictures it shows again - no-base64-images) can fetch
 * and keep them like every Quick Access picture. The drawings are read from wmShell.js itself, so the panel's pictures
 * are the volume box's pictures, never a second copy of their paths.
 *
 *   node scripts/generate-output-glyphs.js   -> public/static_images/quickaccess/out-<name>.png (96 px)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'public', 'scripts', 'comp', 'wmShell.js');
const OUT = path.join(__dirname, '..', 'public', 'static_images', 'quickaccess');
const SIZE = 96;
const NAMES = ['output', 'headphones', 'headset', 'display', 'jack', 'speaker', 'cast'];
// the mark of the current output: a check, drawn on the same 32 grid
const EXTRA = { check: '<path d="M6 17l7 7 13-14" fill="none" stroke="currentColor" stroke-width="4"/>' };

const text = fs.readFileSync(SRC, 'utf8');
const block = /const GLYPHS = \{([\s\S]*?)\n    \};/.exec(text);
if (!block) throw new Error('GLYPHS not found in wmShell.js');
const glyphs = {};
for (const name of NAMES) {
    const m = new RegExp(`\\n\\s+${name}: '((?:[^'\\\\]|\\\\.)*)'`).exec(block[1]);
    if (!m) throw new Error(`no glyph ${name} in wmShell.js`);
    glyphs[name] = m[1];
}
Object.assign(glyphs, EXTRA);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, body] of Object.entries(glyphs)) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${SIZE}" height="${SIZE}" shape-rendering="crispEdges">${body.replace(/currentColor/g, 'white')}</svg>`;
        await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `out-${name}.png`));
    }
    console.log(`${Object.keys(glyphs).length} glyphs -> ${path.relative(process.cwd(), OUT)}`);
})();
