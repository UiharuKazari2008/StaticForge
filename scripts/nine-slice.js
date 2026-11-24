#!/usr/bin/env node
/* Nine-slice helper (#1135): checks a frame image and prints the CSS to draw it at any size.
   Usage: node scripts/nine-slice.js <image.png> <top> <right> <bottom> <left> [selector] [--scale N]
   A frame that is one file with border-image replaces the 4+ edge/corner files; the centre fills
   (fill keyword) or is left transparent. Warns when the slice leaves no stretchable centre or the
   centre is not uniform along the stretch axis (then it would visibly smear). */
'use strict';
const sharp = require('sharp');
(async () => {
    const a = process.argv.slice(2).filter(x => x !== '--scale');
    const si = process.argv.indexOf('--scale'), scale = si > 0 ? +process.argv[si + 1] : 1;
    if (si > 0) a.splice(a.indexOf(process.argv[si + 1]), 1);
    const [file, t, r, b, l, sel = '.frame'] = a;
    const [T, R, B, L] = [t, r, b, l].map(Number);
    if (!file || [T, R, B, L].some(n => !(n >= 0))) { console.error('usage: nine-slice.js <img> <top> <right> <bottom> <left> [selector] [--scale N]'); process.exit(2); }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    if (L + R >= w || T + B >= h) { console.error('slice leaves no centre'); process.exit(1); }
    const px = (x, y) => data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4).join(',');
    let smear = 0;
    for (let x = L; x < w - R; x++) { const ref = px(x, T); for (let y = T; y < h - B; y++) if (px(x, y) !== ref) { smear++; break; } }
    if (smear) console.error(`warning: ${smear} centre columns vary vertically; border-image-repeat: stretch will smear them`);
    const sc = n => (n * scale) + 'px';
    console.log(`${sel} {\n    border-style: solid;\n    border-width: ${sc(T)} ${sc(R)} ${sc(B)} ${sc(L)};\n` +
        `    border-image: url(${file.replace(/^.*public/, '')}) ${T} ${R} ${B} ${L} fill / ${sc(T)} ${sc(R)} ${sc(B)} ${sc(L)} stretch;\n}`);
})();
