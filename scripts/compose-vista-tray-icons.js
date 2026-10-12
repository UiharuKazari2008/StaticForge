#!/usr/bin/env node
/**
 * Compose the MeletonFX tray icons from Vista's own pixels (Yukimi, 2026-10-12: generated
 * art scaled to 16 px is blurry, sampled "pixel art" is destroyed; take the Vista icons and
 * apply the edits). Every icon is built at 16 and 32 px directly from the 16 / 32 px Vista
 * originals in scripts/assets/vista-tray-parts/ (ripped from a Vista Aero VM), so nothing is
 * rescaled except the half-size sync badge on the 16 px drive. Shapes Vista never had (the
 * staggered glass panes, the rolodex, the monitor corner) are hand-pixelled in the network
 * icon's own palette, sampled from its pixels.
 *
 *   node scripts/compose-vista-tray-icons.js     # writes public/static_images/vista-icons/
 */
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PARTS = path.join(__dirname, 'assets/vista-tray-parts');
const OUT = path.join(ROOT, 'public/static_images/vista-icons');

async function load(name, size) {
    const { data, info } = await sharp(path.join(PARTS, `${name}-${size}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== size || info.height !== size) throw new Error(`${name}-${size} is ${info.width}x${info.height}`);
    return { size, data: Buffer.from(data) };
}

function blank(size) { return { size, data: Buffer.alloc(size * size * 4) }; }
function px(img, x, y) { const i = (y * img.size + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; }

function put(img, x, y, c) {
    if (x < 0 || y < 0 || x >= img.size || y >= img.size || !c) return;
    const i = (y * img.size + x) * 4;
    const a = c[3] === undefined ? 255 : c[3];
    if (a >= 255 || img.data[i + 3] === 0) { img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = a; return; }
    const t = a / 255;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(c[k] * t + img.data[i + k] * (1 - t));
    img.data[i + 3] = Math.max(img.data[i + 3], a);
}

/** Alpha-over src onto dst at (dx, dy); `only` keeps a pixel when only(x, y, rgba) is true. */
function blit(dst, src, dx = 0, dy = 0, only) {
    for (let y = 0; y < src.size; y++) {
        for (let x = 0; x < src.size; x++) {
            const c = px(src, x, y);
            if (c[3] === 0 || (only && !only(x, y, c))) continue;
            put(dst, x + dx, y + dy, c);
        }
    }
}

/** The pixels of a that differ from b (a badge or an overlay Vista drew on top of b). */
function diff(a, b) {
    const out = blank(a.size);
    for (let y = 0; y < a.size; y++) {
        for (let x = 0; x < a.size; x++) {
            const p = px(a, x, y);
            const q = px(b, x, y);
            if (p.some((v, k) => Math.abs(v - q[k]) > 8)) put(out, x, y, p);
        }
    }
    return out;
}

/** 2:1 box reduction (exact factor, so edges stay on the grid). */
function half(img) {
    const out = blank(img.size / 2);
    for (let y = 0; y < out.size; y++) {
        for (let x = 0; x < out.size; x++) {
            const cs = [px(img, 2 * x, 2 * y), px(img, 2 * x + 1, 2 * y), px(img, 2 * x, 2 * y + 1), px(img, 2 * x + 1, 2 * y + 1)];
            const a = cs.reduce((s, c) => s + c[3], 0);
            if (a < 255) continue;
            const c = [0, 1, 2].map((k) => Math.round(cs.reduce((s, cc) => s + cc[k] * cc[3], 0) / a));
            put(out, x, y, [...c, Math.min(255, Math.round(a / 4) > 200 ? 255 : Math.round(a / 4))]);
        }
    }
    return out;
}

function rect(img, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(img, x, y, c); }
function frame(img, x0, y0, x1, y1, c, t = 1) {
    rect(img, x0, y0, x1, y0 + t - 1, c); rect(img, x0, y1 - t + 1, x1, y1, c);
    rect(img, x0, y0, x0 + t - 1, y1, c); rect(img, x1 - t + 1, y0, x1, y1, c);
}

async function save(img, name) {
    await sharp(img.data, { raw: { width: img.size, height: img.size, channels: 4 } }).png().toFile(path.join(OUT, `${name}-${img.size}.png`));
}

async function main() {
    for (const n of [16, 32]) {
        const k = n / 16; // 1 at 16 px, 2 at 32 px
        const net = await load('p27', n);
        // the network icon's palette: outline, bezel, screen light / mid / shade
        const OUTLINE = [0, 0, 0, 255];
        const BEZEL = px(net, Math.round(5 * k), Math.round(1 * k)).slice(0, 3).concat(255);
        const S_LIGHT = px(net, Math.round(6 * k), Math.round(2 * k) + (k > 1 ? 1 : 0));
        const S_MID = px(net, Math.round(8 * k), Math.round(4 * k));
        const S_SHADE = px(net, Math.round(12 * k), Math.round(4 * k));

        // service worker: Vista's drive with the sync arrows as a half-size badge
        {
            const img = await load('drive', n);
            const badge = n === 32 ? await load('s238', 16) : half(await load('s238', 16));
            blit(img, badge, n - badge.size, n - badge.size);
            await save(img, 'service-worker');
        }
        // developer warnings: Vista's gears with the network icon's own warning badge
        {
            const img = await load('s71', n);
            blit(img, diff(await load('p30', n), net));
            await save(img, 'dev-warnings');
        }
        // Dovecote: Windows Mail
        await save(await load('mail', n), 'dovecote');

        // Remote Access: the top right corner of a monitor (the rest off the icon), with
        // Vista's signal waves (the volume icon's waves) coming off it
        {
            const img = blank(n);
            const cx = Math.round(9 * k) + (k > 1 ? 1 : 0); // monitor's right outline column
            const cy = Math.round(6 * k);                   // monitor's top outline row
            const b = k;                                     // bezel width
            rect(img, 0, cy, cx, n - 1, OUTLINE);
            rect(img, 0, cy + 1, cx - 1, n - 1, BEZEL);
            rect(img, 0, cy + 1 + b, cx - 1 - b, n - 1, S_MID);
            rect(img, 0, cy + 1 + b, cx - 1 - b, cy + b + k, S_LIGHT);          // top light band
            rect(img, cx - b - k, cy + 1 + b, cx - 1 - b, n - 1, S_SHADE);      // right shade band
            const waves = diff(await load('vol3', n), await load('vol0', n));
            blit(img, waves, Math.round(1 * k), -Math.round(3 * k), (x) => x >= Math.round(8 * k));
            await save(img, 'remote-access');
        }
        // Workspace switcher: two staggered panes of glass, top right solid, bottom left hollow
        {
            const img = blank(n);
            const GLASS_EDGE = [26, 79, 138, 255];
            const GLASS_TOP = [205, 236, 255, 255];
            const GLASS_BOTTOM = [104, 176, 230, 255];
            const pane = (x0, y0, s, hollow) => {
                const x1 = x0 + s - 1;
                const y1 = y0 + s - 1;
                for (let y = y0 + 1; y < y1; y++) {
                    const t = (y - y0) / (s - 1);
                    const c = [0, 1, 2].map((i) => Math.round(GLASS_TOP[i] + (GLASS_BOTTOM[i] - GLASS_TOP[i]) * t)).concat(255);
                    for (let x = x0 + 1; x < x1; x++) {
                        const inner = x > x0 + 1 + k && x < x1 - 1 - k && y > y0 + 1 + k && y < y1 - 1 - k;
                        if (hollow && inner) continue;
                        put(img, x, y, c);
                    }
                }
                frame(img, x0, y0, x1, y1, GLASS_EDGE);
                rect(img, x0 + 1, y0 + 1, x1 - 1, y0 + 1, [255, 255, 255, 230]);   // top glint
                rect(img, x0 + 1, y0 + 1, x0 + 1, y1 - 1, [255, 255, 255, 170]);   // left glint
                if (hollow) frame(img, x0 + 2 + k, y0 + 2 + k, x1 - 2 - k, y1 - 2 - k, GLASS_EDGE);
            };
            const s = Math.round(10 * k);
            pane(0, n - s - (k > 1 ? 1 : 0), s, true);
            pane(n - s - (k > 1 ? 1 : 0), 0, s, false);
            await save(img, 'workspace-switcher');
        }
        // Account Manager: a rolodex, cream cards on a dark rotary stand, a person on the front card
        {
            const img = blank(n);
            const CARD = [251, 243, 220, 255];
            const CARD_BACK = [228, 216, 186, 255];
            const CARD_EDGE = [120, 104, 70, 255];
            const STAND = [64, 64, 64, 255];
            const STAND_HI = [140, 140, 140, 255];
            const PERSON = [58, 120, 208, 255];
            const u = (v) => Math.round(v * k);
            // back cards fanned behind
            rect(img, u(4), u(2), u(11) + (k > 1 ? 1 : 0), u(9), CARD_BACK); frame(img, u(4), u(2), u(11) + (k > 1 ? 1 : 0), u(9), CARD_EDGE);
            rect(img, u(3), u(3), u(12) + (k > 1 ? 1 : 0), u(10), CARD_BACK); frame(img, u(3), u(3), u(12) + (k > 1 ? 1 : 0), u(10), CARD_EDGE);
            // front card
            rect(img, u(2), u(5), u(13) + (k > 1 ? 1 : 0), u(12), CARD); frame(img, u(2), u(5), u(13) + (k > 1 ? 1 : 0), u(12), CARD_EDGE);
            // person: head and shoulders
            rect(img, u(7), u(6) + 1, u(8) + (k > 1 ? 1 : 0), u(7) + (k > 1 ? 1 : 0), PERSON);
            rect(img, u(5) + 1, u(9), u(10) - (k > 1 ? 0 : 1) + (k > 1 ? 1 : 0), u(11) - (k > 1 ? 0 : 0), PERSON);
            // rotary stand: rod, knob, base
            rect(img, u(1), u(12) + 1, u(14) + (k > 1 ? 1 : 0), u(12) + k, STAND);
            rect(img, u(14), u(11), u(15) + (k > 1 ? 1 : 0), u(13) + (k > 1 ? 1 : 0), STAND);
            put(img, u(14), u(11), STAND_HI);
            rect(img, u(4), u(14), u(11) + (k > 1 ? 1 : 0), u(15) + (k > 1 ? 1 : 0), STAND);
            rect(img, u(4), u(14), u(11) + (k > 1 ? 1 : 0), u(14), STAND_HI);
            await save(img, 'account-manager');
        }
    }
    console.log('composed: service-worker, dev-warnings, dovecote, remote-access, workspace-switcher, account-manager (16, 32)');
}

main().catch((err) => {
    console.error(`compose-vista-tray-icons: ${err.message}`);
    process.exit(1);
});
