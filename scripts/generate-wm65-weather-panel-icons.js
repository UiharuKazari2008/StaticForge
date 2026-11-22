#!/usr/bin/env node
/**
 * The weather condition icons as Today panel icons (Yukimi, Nov 21 2026: "the weather icon on the clock need to have
 * their reflection version generated for the home ... and they also look very small"): each condition's art
 * (public/static_images/wm61/weather/wx-<key>@4x.png, scripts/generate-wm-weather-art.js) trimmed of its padding and set
 * as the ROM draws a panel icon (modules/wm65PanelIcon.js: on the floor, its own bottom mirrored and fading), at the
 * panel icon's three sizes: public/static_images/wm65/ti-wx-<key>{,@2x,@4x}.png (43 x 57, 86 x 113, 172 x 226).
 * The clock panel shows them in the clock icon's place (wmTitanium.js pageHtml).
 *
 *   node scripts/generate-wm65-weather-panel-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { panelIcon } = require('../modules/wm65PanelIcon');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'static_images', 'wm61', 'weather');
const OUT = path.join(ROOT, 'public', 'static_images', 'wm65');

(async () => {
    const keys = fs.readdirSync(SRC).map((f) => (/^wx-([a-z-]+)@4x\.png$/.exec(f) || [])[1]).filter((k) => k && k !== 'icons');
    for (const key of keys) {
        const art = fs.readFileSync(path.join(SRC, `wx-${key}@4x.png`));
        for (const [k, sfx] of [[0.5, ''], [1, '@2x'], [2, '@4x']]) {
            fs.writeFileSync(path.join(OUT, `ti-wx-${key}${sfx}.png`), await panelIcon(art, k));
        }
        console.log('ti-wx-' + key);
    }
})().catch((err) => { console.error(err); process.exit(1); });
