#!/usr/bin/env node
/**
 * Melaton Mobile Solitaire (Yozora #786): card sheets from Windows Mobile's pegcards.dll.
 *
 *   node scripts/build-wm-solitaire-art.js [--src ~/.cache/wm61/dump/png] [--no-4x]
 *
 * Source: the bitmaps of pegcards.dll (96 DPI, 29 x 41 cards) and pegcards.192.dll (192 DPI,
 * 58 x 82), dumped from the WM 6.1 emulator (~/.cache/wm61/dump/png/<module>/bmp_<id>.png).
 * Ids: 1-52 the faces (clubs, diamonds, hearts, spades; ace to king), 61-66 the six card backs,
 * 78 the empty deck "O" (deal again), 79 the "X" (no more passes), 80 the empty suit stack.
 * The bitmaps are opaque: their black frame and the dark green shadow column / row are drawn in.
 * The empty suit stack is not bitmap 80 as stored: the device draws it as a dithered grey / teal /
 * purple field with a dark green frame (a palette quirk of the real device, kept on purpose). Its
 * 58 x 82 capture from the 6.1 emulator, <src>/pegcards-device-slot.png, replaces cell 80 when present
 * (1x: point sampled; 4x: pixel doubled, no upscaler).
 *
 * Writes public/static_images/wm-games/solitaire/cards.png (1x), cards@2x.png and cards@4x.webp (q92):
 * 13 columns x 5 rows, rows 0-3 the suits, row 4 the backs, O, X and the empty stack. The @4x sheet
 * is the 192 DPI art upscaled 4x by the Ruiko GPU worker (RealESRGAN_x4plus: 4x-UltraSharp hollows the black pips) and halved, cell by cell
 * with a margin so no card bleeds into its neighbour (phones draw cards at ~4x the 96 DPI size).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const SRC = opt('--src', path.join(os.homedir(), '.cache/wm61/dump/png'));
const OUT = path.join(ROOT, 'public/static_images/wm-games/solitaire');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wmsol-'));
const COLS = 13;
const CELLS = [];
for (let n = 1; n <= 52; n++) CELLS.push(n);
CELLS.push(61, 62, 63, 64, 65, 66, 78, 79, 80);

const DEVICE_SLOT = path.join(SRC, 'pegcards-device-slot.png');
const slotSrc = (dir) => {
    if (!fs.existsSync(DEVICE_SLOT)) return path.join(SRC, dir, 'bmp_80.png');
    const out = path.join(TMP, `slot-${dir}.png`);
    if (!fs.existsSync(out)) execFileSync('convert', [DEVICE_SLOT, ...(dir === 'pegcards.dll' ? ['-sample', '29x41!'] : []), out]);
    return out;
};
const cellSrc = (dir, id) => (id === 80 ? slotSrc(dir) : path.join(SRC, dir, `bmp_${id}.png`));

function sheet(dir, w, h, out, margin = 0, bg = 'none') {
    const args = ['-size', `${COLS * (w + margin * 2)}x${5 * (h + margin * 2)}`, `xc:${bg === 'none' ? '#008000' : bg}`];
    CELLS.forEach((id, i) => {
        const x = (i % COLS) * (w + margin * 2) + margin;
        const y = Math.floor(i / COLS) * (h + margin * 2) + margin;
        args.push(cellSrc(dir, id), '-geometry', `+${x}+${y}`, '-composite');
    });
    // opaque: with an alpha channel left over, the PNG writer marks black transparent (tRNS)
    args.push('-alpha', 'off', '-define', 'png:color-type=2', out);
    execFileSync('convert', args);
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    sheet('pegcards.dll', 29, 41, path.join(OUT, 'cards.png'));
    sheet('pegcards.192.dll', 58, 82, path.join(OUT, 'cards@2x.png'));
    console.log('cards.png, cards@2x.png');
    if (argv.includes('--no-4x')) return;
    // 4x: a margin of 4 px (2x) around each card, filled by edge stretching, so the model sees
    // each card alone; upscaled x4, halved, then each card cut back out at 116 x 164
    const M = 4;
    const padded = path.join(TMP, 'pad.png');
    const args = ['-size', `${COLS * (58 + M * 2)}x${5 * (82 + M * 2)}`, 'xc:#008000'];
    CELLS.forEach((id, i) => {
        const x = (i % COLS) * (58 + M * 2);
        const y = Math.floor(i / COLS) * (82 + M * 2);
        args.push('(', path.join(SRC, 'pegcards.192.dll', `bmp_${id}.png`), '-virtual-pixel', 'edge', '-set', 'option:distort:viewport', `${58 + M * 2}x${82 + M * 2}-${M}-${M}`, '-distort', 'SRT', '0', '+repage', ')', '-geometry', `+${x}+${y}`, '-composite');
    });
    args.push(padded);
    execFileSync('convert', args);
    const secure = JSON.parse(fs.readFileSync(path.join(ROOT, 'secure.config.json'), 'utf8'));
    const gr = { getSecureConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), secure) };
    const worker = require(path.join(ROOT, 'modules/localUpscaleWorker.js'));
    const buf = await worker.upscaleBufferWithLocalWorker(gr, fs.readFileSync(padded), { scale: 4, model: process.env.WMSOL_MODEL || 'RealESRGAN_x4plus' });
    const b = Buffer.isBuffer(buf) ? buf : (buf && (buf.buffer || buf.imageBuffer || buf.data));
    if (!Buffer.isBuffer(b)) throw new Error('unexpected upscale result');
    const up = path.join(TMP, 'up.png');
    fs.writeFileSync(up, b);
    const half = path.join(TMP, 'half.png');
    execFileSync('convert', [up, '-filter', 'Lanczos', '-resize', '50%', half]);
    const cw = (58 + M * 2) * 2;
    const ch = (82 + M * 2) * 2;
    const out = ['-size', `${COLS * 116}x${5 * 164}`, 'xc:#008000'];
    CELLS.forEach((id, i) => {
        const cx = (i % COLS) * cw + M * 2;
        const cy = Math.floor(i / COLS) * ch + M * 2;
        out.push('(', half, '-crop', `116x164+${cx}+${cy}`, '+repage', ')', '-geometry', `+${(i % COLS) * 116}+${Math.floor(i / COLS) * 164}`, '-composite');
    });
    // the device's empty suit stack: its dither pixel doubled, not upscaled
    const slotAt = CELLS.indexOf(80);
    out.push('(', slotSrc('pegcards.192.dll'), '-sample', '116x164!', ')', '-geometry', `+${(slotAt % COLS) * 116}+${Math.floor(slotAt / COLS) * 164}`, '-composite');
    out.push('-alpha', 'off', '-quality', '92', path.join(OUT, 'cards@4x.webp'));
    execFileSync('convert', out);
    console.log('cards@4x.webp');
    fs.rmSync(TMP, { recursive: true, force: true });
})().catch((err) => { console.error(err); process.exit(1); });
