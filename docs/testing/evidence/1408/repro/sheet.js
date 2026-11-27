'use strict';
// node sheet.js out.png "<framedir>|<ms>|<caption>" ...   (frames side by side, nearest frame to <ms>)
const fs = require('fs');
const path = require('path');
const sharp = require('/home/kanmi/staticforge/node_modules/sharp');
(async () => {
    const [, , out, ...specs] = process.argv;
    const comps = [];
    for (let i = 0; i < specs.length; i++) {
        const [dir, ms, caption] = specs[i].split('|');
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => ({ f, t: Number(/-(-?\d+)ms\.png$/.exec(f)[1]) }));
        const c = files.reduce((a, b) => (Math.abs(b.t - ms) < Math.abs(a.t - ms) ? b : a));
        const left = i * 424;
        comps.push({ input: await sharp(path.join(dir, c.f)).toBuffer(), left, top: 44 });
        comps.push({ input: Buffer.from(`<svg width="412" height="44"><rect width="100%" height="100%" fill="#222"/><text x="8" y="18" font-family="sans-serif" font-size="14" fill="#fff">${caption}</text><text x="8" y="37" font-family="sans-serif" font-size="13" fill="#bbb">painted frame at ${c.t} ms</text></svg>`), left, top: 0 });
    }
    await sharp({ create: { width: specs.length * 424 - 12, height: 959, channels: 3, background: '#fff' } }).composite(comps).png({ compressionLevel: 9, palette: true }).toFile(out);
})();
