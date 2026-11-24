#!/usr/bin/env node
/* Pack many small images into one tile sheet (#1135): one request instead of N.
   Usage: node scripts/build-tile-sheet.js <out-name> <dir|files...>
   Writes <out-name>.png (row-packed, 1 px transparent gutter), <out-name>.json (name -> x,y,w,h) and
   <out-name>.css (.<out-name>-<name> { background: url(<out-name>.png) -Xpx -Ypx; width; height }).
   Use for icons/glyphs that sit at 1:1. Frames and 9-slice borders keep their own files. */
'use strict';
const fs = require('fs'), path = require('path'), sharp = require('sharp');
(async () => {
    const [out, ...src] = process.argv.slice(2);
    if (!out || !src.length) { console.error('usage: build-tile-sheet.js <out-name> <dir|files...>'); process.exit(2); }
    const files = src.flatMap(s => fs.statSync(s).isDirectory()
        ? fs.readdirSync(s).filter(f => /\.png$/i.test(f)).sort().map(f => path.join(s, f)) : [s]);
    const items = [];
    for (const f of files) { const m = await sharp(f).metadata(); items.push({ f, name: path.basename(f, '.png'), w: m.width, h: m.height }); }
    items.sort((a, b) => b.h - a.h || a.name.localeCompare(b.name));
    const area = items.reduce((s, i) => s + (i.w + 1) * (i.h + 1), 0), maxW = Math.max(Math.ceil(Math.sqrt(area)), ...items.map(i => i.w + 1));
    let x = 0, y = 0, rowH = 0, sheetW = 0;
    for (const i of items) {
        if (x + i.w + 1 > maxW) { x = 0; y += rowH + 1; rowH = 0; }
        i.x = x; i.y = y; x += i.w + 1; rowH = Math.max(rowH, i.h); sheetW = Math.max(sheetW, x);
    }
    const sheetH = y + rowH, base = path.basename(out);
    await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(items.map(i => ({ input: i.f, left: i.x, top: i.y }))).png({ compressionLevel: 9 }).toFile(out + '.png');
    fs.writeFileSync(out + '.json', JSON.stringify(Object.fromEntries(items.map(i => [i.name, { x: i.x, y: i.y, w: i.w, h: i.h }])), null, 1));
    fs.writeFileSync(out + '.css', items.map(i => `.${base}-${i.name} { background: url(${base}.png) -${i.x}px -${i.y}px no-repeat; width: ${i.w}px; height: ${i.h}px; }`).join('\n') + '\n');
    console.log(`${items.length} images -> ${out}.png ${sheetW}x${sheetH}`);
})();
