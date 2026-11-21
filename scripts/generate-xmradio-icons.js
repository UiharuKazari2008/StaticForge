#!/usr/bin/env node
/**
 * XM Radio's icons, desktop and phone drawn apart (Yukimi, Nov 21 2026: "Generate a better icon for desktop and mobile
 * separately ... a desktop wooden accented radio with a satellite above it with its solar panels (kinda like the GPS
 * icon)"). Sources: apps/xmradio/assets/art/xmradio-desktop.svg (Vista: the walnut set, the lit dial, the satellite
 * with its signal) and xmradio-mobile.svg (Windows Mobile: the same idea in bold shapes that read at 16 px).
 *
 *   node scripts/generate-xmradio-icons.js && node scripts/generate-wm-xmradio-art.js
 *
 * Writes apps/xmradio/assets/xmradio-16/-32/-48/-256.png and public/static_images/app_icons/xmradio.png (48) from the
 * desktop art, apps/xmradio/assets/xmradio-mobile-256.png from the phone art (generate-wm-xmradio-art.js makes the
 * phone's sizes from it).
 */
'use strict';

const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const ART = path.join(ROOT, 'apps', 'xmradio', 'assets', 'art');
const OUT = path.join(ROOT, 'apps', 'xmradio', 'assets');

async function render(svg, size, file) {
    await sharp(path.join(ART, svg), { density: Math.max(72, Math.round((size / 256) * 72 * 4)) })
        .resize(size, size, { kernel: 'lanczos3' }).png().toFile(file);
    console.log(path.relative(ROOT, file), size);
}

(async () => {
    for (const s of [16, 32, 48, 256]) await render('xmradio-desktop.svg', s, path.join(OUT, `xmradio-${s}.png`));
    await render('xmradio-desktop.svg', 48, path.join(ROOT, 'public', 'static_images', 'app_icons', 'xmradio.png'));
    await render('xmradio-mobile.svg', 256, path.join(OUT, 'xmradio-mobile-256.png'));
})().catch((err) => { console.error(err); process.exit(1); });
