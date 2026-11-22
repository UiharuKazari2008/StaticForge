#!/usr/bin/env node
/**
 * 6.5 art for Melaton Mobile's Wallet (wmWallet.js, Yozora #874), from the program icon's master.
 * The icon itself is generated in the ROM's realistic style (Yukimi: "more realistic, not
 * cartoony"; a fan of real plastic cards, a white membership card with a barcode in front):
 *
 *   node scripts/generate-wm-icon.js --name wallet --small --force \
 *     --input "a fanned hand of three real plastic cards held together: behind, a dark blue bank card
 *              with a gold EMV chip and a green card; in front, a glossy white membership card with a
 *              printed black barcode and a coloured band" \
 *     --from "Wallet (quick access to payment cards and membership barcodes)" \
 *     --extra "photoreal material rendering like the Windows Mobile 6 ROM icons: real plastic sheen,
 *              accurate card proportions 85.6 x 54 mm, subtle embossed edge, soft studio lighting from
 *              top left; not cartoony, no thick outlines, no flat fills"
 *
 * which writes wm61/app-wallet*.png and keeps the 1024 px master in .cache/wm-icons/originals
 * (`--resave wallet` renders the wm61 sizes again from it). This script then writes, from that
 * master, the 6.5 Start icon wm65/start-wallet.png (45, @2x 90, @4x 180) and the home screen panel
 * ti-x-app-wallet-lg.png (43 x 57, @2x 86 x 113, @4x 172 x 226: the art, then its fading mirror, as in
 * generate-wm-youtube-art.js). It never touches the wm61 files.
 *
 *   node scripts/generate-wm-wallet-art.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT65 = path.join(ROOT, 'public', 'static_images', 'wm65');
const MASTER = path.join(ROOT, '.cache', 'wm-icons', 'originals', 'app-wallet.png');

async function art(size) {
    // the master's empty margin trimmed, so the cards fill the frame like the other Start icons
    const trimmed = await sharp(MASTER).trim({ threshold: 1 }).png().toBuffer();
    return sharp(trimmed).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).png().toBuffer();
}

async function start(size, file) {
    await sharp(await art(size)).toFile(path.join(OUT65, file));
    console.log(file, size);
}

/** A 6.5 home screen panel icon at scale k (1 = the 2x frame): the art seated on the floor, then its fading mirror. */
async function panel(k, file) {
    const W = Math.round(86 * k);
    const H = Math.round(113 * k);
    const A = Math.round(76 * k);
    // the cards are wider than tall (contain leaves space under them): seat their lowest row on the floor
    const raw = await art(A);
    const { info } = await sharp(raw).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    const bottom = -(info.trimOffsetTop || 0) + info.height;
    const drop = Math.max(0, A - bottom);
    const seated = await sharp({ create: { width: A, height: A, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp(raw).extract({ left: 0, top: 0, width: A, height: A - drop }).png().toBuffer(), left: 0, top: drop }]).png().toBuffer();
    // the ROM's own geometry and a mirror of the art's bottom (modules/wm65PanelIcon.js, Nov 21 2026)
    fs.writeFileSync(path.join(OUT65, file), await require('../modules/wm65PanelIcon').panelIcon(seated, k));
    console.log(file, W, H);
}

(async () => {
    if (!fs.existsSync(MASTER)) { console.error(`No master at ${MASTER}: run scripts/generate-wm-icon.js first (see the header).`); process.exit(1); }
    await start(45, 'start-wallet.png');
    await start(90, 'start-wallet@2x.png');
    await start(180, 'start-wallet@4x.png');
    await panel(0.5, 'ti-x-app-wallet-lg.png');
    await panel(1, 'ti-x-app-wallet-lg@2x.png');
    await panel(2, 'ti-x-app-wallet-lg@4x.png');
})();
