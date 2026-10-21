#!/usr/bin/env node
/**
 * InkBall's web assets (Yozora #609). InkBall is not on the Oberon sprite engine the other Vista
 * games share: it is the Tablet PC game, a DirectDraw / GDI program whose whole look is one
 * bitmap and whose boards are one binary resource of inkball.exe (dumped on the Vista VM with
 * C:\agent\dumpres.exe into ~/.cache/vista-vm/games/inkball/):
 *
 *   2_501.bmp      BITMAP 501, 381x400 24-bit: tiles, holes, balls, digits, the bar pieces.
 *                  The game blits it with the colour key 0xFF00FF (CGameBoard::CGameBoard ->
 *                  CSurface::SetColorKey), so magenta becomes transparent here.
 *   IKL_20001.bin  IKL 20001, the 551 boards (format: public/scripts/comp/desktop-apps/
 *                  vista-games/inkball.js, parseBoards). Copied as it is; the game parses it.
 *   aero_pen.cur   (optional) C:\Windows\Cursors\aero_pen.cur, the window class cursor
 *                  (LoadCursor IDC_PEN in WinInit); written as a PNG + its hot spot.
 *
 * Output:
 *   public/static_images/vista-games/inkball/inkball.png
 *   public/static_images/vista-games/inkball/boards.bin
 *   public/static_images/vista-games/inkball/pen.png + pen.json { x, y } (when the .cur is there)
 *
 * The menus, accelerators and strings come from the MUI through scripts/build-vista-games.js
 * (inkball/data.json); this script does not touch that file.
 *
 *   node scripts/build-vista-inkball.js [--src ~/.cache/vista-vm/games/inkball]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/static_images/vista-games/inkball');
const args = process.argv.slice(2);
const i = args.indexOf('--src');
const SRC = i >= 0 && args[i + 1] ? args[i + 1] : path.join(os.homedir(), '.cache/vista-vm/games/inkball');

// BITMAPFILEHEADER + BITMAPINFOHEADER, 24 bpp, bottom-up rows padded to 4 bytes
function readBmp24(file) {
    const b = fs.readFileSync(file);
    if (b.toString('latin1', 0, 2) !== 'BM') throw new Error(file + ': not a BMP');
    const off = b.readUInt32LE(10);
    const w = b.readInt32LE(18);
    const hRaw = b.readInt32LE(22);
    const bpp = b.readUInt16LE(28);
    if (bpp !== 24) throw new Error(file + ': ' + bpp + ' bpp, expected 24');
    const h = Math.abs(hRaw);
    const stride = Math.ceil(w * 3 / 4) * 4;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        const row = off + (hRaw > 0 ? h - 1 - y : y) * stride;
        for (let x = 0; x < w; x++) {
            const s = row + x * 3;
            const d = (y * w + x) * 4;
            const bl = b[s];
            const g = b[s + 1];
            const r = b[s + 2];
            rgba[d] = r;
            rgba[d + 1] = g;
            rgba[d + 2] = bl;
            // the DirectDraw colour key: exact magenta only
            rgba[d + 3] = r === 255 && g === 0 && bl === 255 ? 0 : 255;
        }
    }
    return { w, h, rgba };
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const bmp = readBmp24(path.join(SRC, '2_501.bmp'));
    await sharp(bmp.rgba, { raw: { width: bmp.w, height: bmp.h, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(path.join(OUT, 'inkball.png'));
    console.log('inkball.png', bmp.w + 'x' + bmp.h);

    const ikl = fs.readFileSync(path.join(SRC, 'IKL_20001.bin'));
    fs.writeFileSync(path.join(OUT, 'boards.bin'), ikl);
    console.log('boards.bin', ikl.length, 'bytes');

    // the pen cursor: ImageMagick reads .cur; the hot spot is in the ICONDIRENTRY (bytes 10..13)
    const cur = path.join(SRC, 'aero_pen.cur');
    if (fs.existsSync(cur)) {
        const c = fs.readFileSync(cur);
        const count = c.readUInt16LE(4);
        let best = 0;
        let bestW = 0;
        for (let k = 0; k < count; k++) {
            const w = c[6 + k * 16] || 256;
            if (w === 32) { best = k; bestW = w; break; }
            if (w > bestW && w <= 48) { best = k; bestW = w; }
        }
        const hot = { x: c.readUInt16LE(6 + best * 16 + 4), y: c.readUInt16LE(6 + best * 16 + 6) };
        execFileSync('convert', [cur + '[' + best + ']', path.join(OUT, 'pen.png')]);
        fs.writeFileSync(path.join(OUT, 'pen.json'), JSON.stringify(hot) + '\n');
        console.log('pen.png', bestW + 'px, hot spot', hot.x + ',' + hot.y);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
