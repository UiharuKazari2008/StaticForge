#!/usr/bin/env node
/**
 * XM Radio's and Melaton Videos' icons from their GPT Image masters (Yukimi, Nov 21 2026: "make that icon much better,
 * are you not using GPT image? same for videos, just look at Media Player on desktop and mobile's icon"). Each program
 * has two masters made with scripts/generate-app-icon.js (Media Player's icon as the reference): a three-quarter Vista
 * one for the desktop and a front-facing one for the phone.
 *
 *   node scripts/generate-app-icon-sets.js [xmradio|videos]
 *
 * Masters: apps/xmradio/assets/art/xmradio-{desktop,mobile}.png, apps/videos/assets/art/videos-{desktop,mobile}.png
 * (1024, transparent). Each is trimmed and set square with a small margin, then written:
 *   desktop  XM: apps/xmradio/assets/xmradio-16/-32/-48/-256.png, public/static_images/app_icons/xmradio.png (256)
 *            Videos: app_icons/videos.png (512), app_icons/frames/videos/{16,24,32,48}.png, apps/videos/assets/videos-48.png
 *   phone    wm61/app-<id>.png (16, @2x 32, @4x 64), app-<id>-lg.png (32, @2x 64, @4x 128); wm65/start-<id>.png (45, @2x
 *            90, @4x 180); wm65/ti-x-app-<id>-lg.png (43 x 57, @2x 86 x 113, @4x 172 x 226: the art standing on the box's
 *            floor, its fading mirror below, as every program's Today panel icon)
 */
'use strict';

const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'public', 'static_images');
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

const SETS = {
    xmradio: {
        desktop: path.join(ROOT, 'apps/xmradio/assets/art/xmradio-desktop.png'),
        mobile: path.join(ROOT, 'apps/xmradio/assets/art/xmradio-mobile.png'),
        phoneId: 'xmradio',
        desktopOut: [[16, 'apps/xmradio/assets/xmradio-16.png'], [32, 'apps/xmradio/assets/xmradio-32.png'], [48, 'apps/xmradio/assets/xmradio-48.png'],
            [256, 'apps/xmradio/assets/xmradio-256.png'], [256, 'public/static_images/app_icons/xmradio.png'], [256, 'apps/xmradio/assets/xmradio-mobile-256.png', 'mobile']]
    },
    videos: {
        desktop: path.join(ROOT, 'apps/videos/assets/art/videos-desktop.png'),
        mobile: path.join(ROOT, 'apps/videos/assets/art/videos-mobile.png'),
        phoneId: 'youtube',
        desktopOut: [[512, 'public/static_images/app_icons/videos.png'], [16, 'public/static_images/app_icons/frames/videos/16.png'],
            [24, 'public/static_images/app_icons/frames/videos/24.png'], [32, 'public/static_images/app_icons/frames/videos/32.png'],
            [48, 'public/static_images/app_icons/frames/videos/48.png'], [48, 'apps/videos/assets/videos-48.png']]
    }
};

/** The master trimmed of its empty edge and centred on a square with a 4% margin (the drawing's own shadow kept). */
async function squared(file) {
    const t = await sharp(file).ensureAlpha().trim({ threshold: 4 }).png().toBuffer({ resolveWithObject: true });
    const side = Math.round(Math.max(t.info.width, t.info.height) * 1.08);
    return sharp({ create: { width: side, height: side, channels: 4, background: CLEAR } })
        .composite([{ input: t.data, left: Math.round((side - t.info.width) / 2), top: Math.round((side - t.info.height) / 2) }])
        .png().toBuffer();
}

async function write(src, size, rel) {
    // 16 and 24 a touch sharper: small icons lose their edges
    const img = sharp(src).resize(size, size, { kernel: 'lanczos3' });
    if (size <= 24) img.sharpen({ sigma: 0.5 });
    await img.png({ compressionLevel: 9, effort: 8 }).toFile(path.join(ROOT, rel));
    console.log(rel, size);
}

/** The Today panel icon as the ROM draws its own (modules/wm65PanelIcon.js: the art on the floor, its bottom mirrored). */
async function panel(src, k, rel) {
    const fs = require('fs');
    fs.writeFileSync(path.join(ROOT, rel), await require('../modules/wm65PanelIcon').panelIcon(src, k));
    console.log(rel, Math.round(86 * k), Math.round(113 * k));
}

async function build(name) {
    const set = SETS[name];
    const desk = await squared(set.desktop);
    const mob = await squared(set.mobile);
    for (const [size, rel, which] of set.desktopOut) await write(which === 'mobile' ? mob : desk, size, rel);
    const id = set.phoneId;
    for (const [s, f] of [[16, `app-${id}.png`], [32, `app-${id}@2x.png`], [64, `app-${id}@4x.png`], [32, `app-${id}-lg.png`], [64, `app-${id}-lg@2x.png`], [128, `app-${id}-lg@4x.png`]]) {
        await write(mob, s, `public/static_images/wm61/${f}`);
    }
    for (const [s, f] of [[45, `start-${id}.png`], [90, `start-${id}@2x.png`], [180, `start-${id}@4x.png`]]) await write(mob, s, `public/static_images/wm65/${f}`);
    for (const [k, f] of [[0.5, `ti-x-app-${id}-lg.png`], [1, `ti-x-app-${id}-lg@2x.png`], [2, `ti-x-app-${id}-lg@4x.png`]]) await panel(mob, k, `public/static_images/wm65/${f}`);
}

(async () => {
    const only = process.argv[2];
    for (const name of Object.keys(SETS)) if (!only || only === name) await build(name);
})().catch((err) => { console.error(err); process.exit(1); });
