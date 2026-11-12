#!/usr/bin/env node
'use strict';

/**
 * Director mascot layers that are derived from the sprite sets (#742). Everything here is cut or
 * warped from StygianRook's own sprites (tmp/2021-12_garuda..., tmp/2021-11_chiyo...,
 * tmp/2022-01_yozora...): no generated frames.
 *
 *   node scripts/director-mascot-build.js faces    eat / lick faces for each face set, mouth points
 *   node scripts/director-mascot-build.js stuffed  Yumiya's third stage (the bigger_vore sprites)
 *   node scripts/director-mascot-build.js grow     in-between growth frames (belly warp) + manifest
 *   node scripts/director-mascot-build.js meta     warp settings, belly discs and pose-morph centres
 *                                                  into the manifests (for the WebGL body, no sheets)
 *   node scripts/director-mascot-build.js all
 *   node scripts/director-mascot-build.js preview <dir>   contact sheets of the growth frames
 *
 * Growth frames: each stage's bodies get `<body>_g1`, `<body>_g2` (the belly a little larger: the
 * steps between two stages) and a stage that is grown into gets `<body>_p2`, `<body>_p1` (its belly a
 * little smaller: the last frames of the morph into it). The warp scales the picture about a fixed
 * point `a` by `m` inside a radius, fading to nothing at the radius and above `yTop` (the shoulders),
 * so the head, which is a separate layer, never moves.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/static_images/director-mascots');
const SRC = {
    wren: path.join(ROOT, 'tmp/2021-12_garuda_base_sprites_alts_high-res'),
    xi: path.join(ROOT, 'tmp/2022-01_yozora_base_sprites_alts_high-res'),
    kabuki: path.join(ROOT, 'tmp/2021-11_chiyo_base_sprites_alts_high-res')
};

// source sprite -> canvas: canvas = source * scale + offset, per sprite set [scale, x, y]
// (searched against the shipped neutral faces; the wider sets were cropped onto the canvas)
const MAP = {
    wren: { '01': [0.64021, -39.4, -153.5], '02': [0.64021, -39.4, -153.5] },
    xi: { '01': [0.5139, -156.8, -31.8], '02': [0.5139, -156.8, -31.8] },
    kabuki: { '04': [0.55743, 925.1, 14.5], '05': [0.55703, 693.3, 14.5], '06': [0.55703, -3.9, -0.6] }
};

// face set -> the sprites its extra faces are cut from (same box as the set's neutral face)
const FACES = {
    wren: {
        base: { set: '01', neutral: 'yumiya_base_neutral_01.png', eat: 'yumiya_base_burp2_01.png' }
    },
    xi: {
        base: { set: '01', neutral: 'yozora_base_neutral_01.png', eat: 'yozora_base_burp4_01.png' },
        big: { set: '02', neutral: 'yozora_base_neutral2_bigger_02.png', eat: 'yozora_base_burp3_bigger_02.png' }
    },
    kabuki: {
        fan: { set: '04', neutral: 'chiyo_base_neutral-04.png', eat: 'chiyo_base_oh-04.png', lick: 'chiyo_base_licky-04.png' },
        rub: { set: '05', neutral: 'chiyo_base_neutral_bigger_rub-05.png', eat: 'chiyo_base_oh_bigger_rub-05.png', lick: 'chiyo_base_yummy_bigger_rub_kicky-05.png' },
        big2: { set: '06', neutral: 'chiyo_base_neutral_bigger2_rub-06.png', eat: 'chiyo_base_oh_bigger2_rub-06.png', lick: 'chiyo_base_licky_bigger2_rub-06.png' }
    }
};

// Yumiya's third stage: bodies composed from the bigger_vore sprites
const STUFFED = {
    bigger_vore_mask: 'yumiya_base_neutral_mask_bigger_vore_02.png',
    bigger_vore_wings: 'yumiya_base_neutral_mask_wings_bigger_vore_02.png'
};

// belly warp per stage: a = fixed point, R = radius, yTop = no movement above it (+ ramp),
// up = [m of _g1, m of _g2], down = [m of _p1, m of _p2] (arrival frames; omitted = none)
const GROW = {
    wren: {
        base: { a: [1376, 1010], R: 600, yTop: 610, ramp: 160, up: [1.1, 1.2] },
        bigger: { a: [2450, 1450], R: 2000, yTop: 600, ramp: 260, up: [1.035, 1.07], down: [0.96, 0.92] },
        stuffed: { a: [2450, 1450], R: 2000, yTop: 600, ramp: 260, up: [1.03, 1.06] }
    },
    xi: {
        base: { a: [952, 1050], R: 760, yTop: 480, ramp: 160, up: [1.07, 1.14] },
        bigger: { a: [1700, 1350], R: 1500, yTop: 470, ramp: 260, up: [1.035, 1.07], down: [0.965, 0.93] }
    },
    kabuki: {
        base: { a: [1560, 1150], R: 860, yTop: 570, ramp: 160, up: [1.06, 1.12] },
        bigger: { a: [1500, 1150], R: 940, yTop: 570, ramp: 160, up: [1.06, 1.12], down: [0.97, 0.94] },
        bigger2: { a: [1500, 1500], R: 1900, yTop: 660, ramp: 260, up: [1.02, 1.04] }
    }
};

// the belly as a disc per stage (centre, radius): where the lumps of a swallowed print show
const BELLY = {
    wren: { base: [1376, 990, 315], bigger: [1836, 1388, 760], stuffed: [1836, 1388, 760] },
    xi: { base: [952, 995, 450], bigger: [1146, 1286, 690] },
    kabuki: { base: [1468, 1120, 480], bigger: [1376, 1103, 525], bigger2: [893, 1477, 830] }
};

// arriving in a stage (the shader body's stage morph): the new sheet's belly starts deflated and
// inflates. A scale about f (where the belly meets her body) of everything inside the disc c / R,
// from `from` to 1; nothing above yTop moves.
const ARRIVE = {
    // p: the part of R that moves whole. The fading ring (R * (1 - p)) is wider than the largest
    // move ((1 - from) times the far edge's distance from f), or the picture would fold over itself.
    wren: {
        bigger: { f: [1150, 820], c: [1836, 1388], R: 1560, p: 0.5, yTop: 600, ramp: 200, from: 0.62 },
        stuffed: { f: [1150, 820], c: [1836, 1388], R: 1080, p: 0.72, yTop: 600, ramp: 200, from: 0.94 }
    },
    xi: { bigger: { f: [700, 900], c: [1146, 1286], R: 1340, p: 0.52, yTop: 470, ramp: 200, from: 0.64 } },
    kabuki: {
        bigger: { f: [1500, 700], c: [1376, 1103], R: 900, p: 0.6, yTop: 570, ramp: 160, from: 0.9 },
        bigger2: { f: [1500, 900], c: [893, 1477], R: 1680, p: 0.5, yTop: 660, ramp: 200, from: 0.64 }
    }
};

// growth thresholds per persona (points); steps sit a third and two thirds of the way to the next
// stage, and 12 / 24 points past the last one
const POINTS = { wren: [0, 20, 50], xi: [0, 20], kabuki: [0, 20, 50] };

const WEBP = { quality: 90, alphaQuality: 100, effort: 5 };

const manifestPath = (p) => path.join(OUT, p, 'manifest.json');
const readManifest = (p) => JSON.parse(fs.readFileSync(manifestPath(p), 'utf8'));
const writeManifest = (p, m) => fs.writeFileSync(manifestPath(p), `${JSON.stringify(m, null, 1)}\n`);

async function raw(input) {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

function alphaBox(img) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            if (img.data[(y * img.width + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * A source sprite laid on the persona's canvas (full sprite, as the body layers are), or only the
 * part inside `box` (a face). The part starts on a whole source pixel, so it lands within a third
 * of a canvas pixel of the shipped layers.
 */
async function compose(persona, set, file, box) {
    const m = readManifest(persona);
    const [W, H] = m.size;
    const [scale, ox, oy] = MAP[persona][set];
    const src = path.join(SRC[persona], file);
    const meta = await sharp(src).metadata();
    const want = box || { x: 0, y: 0, w: W, h: H };
    const left = Math.max(want.x, Math.ceil(ox));
    const top = Math.max(want.y, Math.ceil(oy));
    const sx = Math.max(0, Math.round((left - ox) / scale));
    const sy = Math.max(0, Math.round((top - oy) / scale));
    const sw = Math.min(meta.width - sx, Math.floor((want.x + want.w - left) / scale));
    const sh = Math.min(meta.height - sy, Math.floor((want.y + want.h - top) / scale));
    const part = await sharp(src).extract({ left: sx, top: sy, width: sw, height: sh })
        .resize(Math.round(sw * scale), Math.round(sh * scale), { kernel: 'lanczos3', fit: 'fill' }).png().toBuffer();
    return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: part, left, top }]).png().toBuffer();
}

/**
 * A face cut from a composed canvas as a full-canvas layer. The shipped faces are feathered at
 * their edge, so the new one takes the neutral face's alpha: it blends into the head the same way.
 */
async function faceLayer(canvasPng, neutralFile, size) {
    const face = await raw(canvasPng);
    const mask = await raw(neutralFile);
    for (let i = 0; i < face.data.length; i += 4) {
        face.data[i + 3] = Math.round((face.data[i + 3] * mask.data[i + 3]) / 255);
    }
    return sharp(face.data, { raw: { width: size[0], height: size[1], channels: 4 } }).webp(WEBP).toBuffer();
}

/** Mean colour difference inside `box` (6 px in from its edge: face layers are feathered there). */
async function meanDiff(aPng, bInput, box) {
    const inner = { left: box.x + 6, top: box.y + 6, width: box.w - 12, height: box.h - 12 };
    const a = await raw(await sharp(aPng).extract(inner).png().toBuffer());
    const b = await raw(await sharp(bInput).extract(inner).png().toBuffer());
    let sum = 0;
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i + 3] < 250 || b.data[i + 3] < 250) continue;
        sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        n += 3;
    }
    return n ? sum / n : 255;
}

async function buildFaces() {
    for (const persona of Object.keys(FACES)) {
        const m = readManifest(persona);
        for (const [setId, def] of Object.entries(FACES[persona])) {
            const set = m.faceSets[setId];
            const neutralFile = path.join(OUT, persona, set.expressions.neutral);
            const box = alphaBox(await raw(neutralFile));
            // check the mapping against the shipped neutral face before cutting new ones
            const neutral = await compose(persona, def.set, def.neutral, box);
            const diff = await meanDiff(neutral, neutralFile, box);
            console.log(`${persona}/${setId}: face box ${box.x},${box.y} ${box.w}x${box.h}, neutral check diff ${diff.toFixed(2)}`);
            if (diff > 10) throw new Error(`${persona}/${setId}: the source does not line up with the shipped face (diff ${diff.toFixed(2)})`);
            for (const key of ['eat', 'lick']) {
                if (!def[key]) continue;
                const file = `face-${setId}-${key}.webp`;
                fs.writeFileSync(path.join(OUT, persona, file), await faceLayer(await compose(persona, def.set, def[key], box), neutralFile, m.size));
                set.expressions[key] = file;
            }
            // where a print goes in: the middle of the talk mouth's box
            if (set.mouth && set.mouth.talk) {
                const mb = alphaBox(await raw(path.join(OUT, persona, set.mouth.talk)));
                if (mb) set.mouthAt = [Math.round(mb.x + mb.w / 2), Math.round(mb.y + mb.h / 2)];
            }
        }
        writeManifest(persona, m);
    }
}

async function buildStuffed() {
    const persona = 'wren';
    const m = readManifest(persona);
    // the head layer's cut-out as a mask: head alpha over body alpha of a shipped pair
    const refBody = await raw(path.join(OUT, persona, m.bodies.mask_bigger.body));
    const refHead = await raw(path.join(OUT, persona, m.bodies.mask_bigger.head));
    const check = await compose(persona, '02', 'yumiya_base_neutral_mask_bigger_02.png');
    const cb = alphaBox(refBody);
    console.log(`wren stuffed: body check diff ${(await meanDiff(check, path.join(OUT, persona, m.bodies.mask_bigger.body), cb)).toFixed(2)}`);
    for (const [id, file] of Object.entries(STUFFED)) {
        const png = await compose(persona, '02', file);
        fs.writeFileSync(path.join(OUT, persona, `body-${id}.webp`), await sharp(png).webp(WEBP).toBuffer());
        const body = await raw(png);
        const head = Buffer.from(body.data);
        for (let i = 0; i < head.length; i += 4) {
            const ba = refBody.data[i + 3];
            const k = ba > 0 ? Math.min(1, refHead.data[i + 3] / ba) : 0;
            head[i + 3] = Math.round(head[i + 3] * k);
        }
        fs.writeFileSync(path.join(OUT, persona, `head-${id}.webp`),
            await sharp(head, { raw: { width: body.width, height: body.height, channels: 4 } }).webp(WEBP).toBuffer());
        m.bodies[id] = { body: `body-${id}.webp`, head: `head-${id}.webp`, faces: 'mask', belly: m.bodies.bigger_vore.belly };
    }
    m.stages.stuffed = { body: 'bigger_vore', gesture: 'bigger_vore_mask', celebrate: 'bigger_vore_wings' };
    writeManifest(persona, m);
}

const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** The belly warp: forward move D(q) = (q - a) * (m - 1) * w(|q - a| / R) * v(q.y), drawn by inverse lookup. */
function warp(img, { a, R, yTop, ramp }, m) {
    const { width: W, height: H, data } = img;
    // premultiplied floats, so edges do not pick up the colour of clear pixels
    const pre = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        const al = data[i * 4 + 3] / 255;
        pre[i * 4] = data[i * 4] * al;
        pre[i * 4 + 1] = data[i * 4 + 1] * al;
        pre[i * 4 + 2] = data[i * 4 + 2] * al;
        pre[i * 4 + 3] = data[i * 4 + 3];
    }
    const out = Buffer.alloc(W * H * 4);
    const gain = m - 1;
    const weight = (x, y) => {
        const r = Math.hypot(x - a[0], y - a[1]) / R;
        if (r >= 1) return 0;
        const w = r <= 0.72 ? 1 : 1 - smooth((r - 0.72) / 0.28);
        return gain * w * smooth((y - yTop) / ramp);
    };
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4;
            let sx = x, sy = y;
            if (Math.hypot(x - a[0], y - a[1]) < R * 1.3 && y > yTop - 4) {
                // q + D(q) = p, solved by iteration from q = p
                for (let i = 0; i < 6; i++) {
                    const k = weight(sx, sy);
                    sx = x - (sx - a[0]) * k;
                    sy = y - (sy - a[1]) * k;
                }
            }
            if (sx === x && sy === y) {
                out[o] = data[o]; out[o + 1] = data[o + 1]; out[o + 2] = data[o + 2]; out[o + 3] = data[o + 3];
                continue;
            }
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
            const fx = sx - x0, fy = sy - y0;
            const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
            const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
            const al = pre[i00 + 3] * w00 + pre[i10 + 3] * w10 + pre[i01 + 3] * w01 + pre[i11 + 3] * w11;
            if (al < 0.5) continue;
            const k = 255 / al;
            out[o] = Math.min(255, Math.round((pre[i00] * w00 + pre[i10] * w10 + pre[i01] * w01 + pre[i11] * w11) * k));
            out[o + 1] = Math.min(255, Math.round((pre[i00 + 1] * w00 + pre[i10 + 1] * w10 + pre[i01 + 1] * w01 + pre[i11 + 1] * w11) * k));
            out[o + 2] = Math.min(255, Math.round((pre[i00 + 2] * w00 + pre[i10 + 2] * w10 + pre[i01 + 2] * w01 + pre[i11 + 2] * w11) * k));
            out[o + 3] = Math.round(al);
        }
    }
    return { data: out, width: W, height: H };
}

// the stage's poses (body, kicky, gesture ...): its string values; grow / belly are settings
const stageBodies = (stage) => [...new Set(Object.values(stage).filter((v) => typeof v === 'string'))];

async function buildGrow(only) {
    for (const persona of Object.keys(GROW)) {
        if (only && only !== persona) continue;
        const m = readManifest(persona);
        const order = Object.keys(GROW[persona]).filter((key) => m.stages[key]);
        const points = POINTS[persona];
        const steps = {};
        const transitions = {};
        for (const [at, stageId] of order.entries()) {
            const cfg = GROW[persona][stageId];
            const stage = m.stages[stageId];
            const variants = [['_g1', cfg.up[0]], ['_g2', cfg.up[1]]];
            for (const bodyId of stageBodies(stage)) {
                const body = m.bodies[bodyId];
                const src = await raw(path.join(OUT, persona, body.body));
                const list = bodyId === stage.body && cfg.down ? variants.concat([['_p1', cfg.down[0]], ['_p2', cfg.down[1]]]) : variants;
                for (const [suffix, mul] of list) {
                    const file = `body-${bodyId}${suffix}.webp`;
                    const out = warp(src, cfg, mul);
                    fs.writeFileSync(path.join(OUT, persona, file),
                        await sharp(out.data, { raw: { width: out.width, height: out.height, channels: 4 } }).webp(WEBP).toBuffer());
                    // the print lands on the moved belly
                    const belly = Array.isArray(body.belly)
                        ? [Math.round(cfg.a[0] + (body.belly[0] - cfg.a[0]) * mul), Math.round(cfg.a[1] + (body.belly[1] - cfg.a[1]) * mul)]
                        : undefined;
                    m.bodies[`${bodyId}${suffix}`] = Object.assign({}, body, { body: file }, belly ? { belly } : {});
                    console.log(`${persona}: ${file}`);
                }
            }
            const from = points[at];
            const next = points[at + 1];
            steps[stageId] = next != null
                ? [{ at: Math.round(from + (next - from) / 3), suffix: '_g1' }, { at: Math.round(from + (2 * (next - from)) / 3), suffix: '_g2' }]
                : [{ at: from + 12, suffix: '_g1' }, { at: from + 24, suffix: '_g2' }];
            // the morph into the next stage: this one's growth frames, then the next one's arrival frames
            const nextId = order[at + 1];
            if (nextId) {
                const arrive = GROW[persona][nextId].down ? [`${m.stages[nextId].body}_p2`, `${m.stages[nextId].body}_p1`] : [];
                transitions[`${stageId}>${nextId}`] = { frames: [`${stage.body}_g1`, `${stage.body}_g2`, ...arrive], frameMs: 300 };
            }
        }
        m.behaviour.growth = { order, points: points.slice(0, order.length), steps };
        m.transitions = transitions;
        writeManifest(persona, m);
    }
}

/**
 * What the WebGL body (directorMascot.js DirectorMascotGL) needs to warp the base sheets itself:
 * each stage's warp (`grow`: a, R, yTop, ramp, max = the _g2 scale, min = the _p2 scale), its belly
 * disc, and for every other pose of the stage the middle of what differs from the stage's body
 * (`morphs["body|pose"]`): a pose change grows out of / shrinks into that point.
 */
// What keeps its shape while her belly grows, per stage (sheet pixels, placed by eye over the art on a
// 100 px grid): [cx, cy, rx, ry, restX, restY, pivotX, pivotY]. Her chest rides on the belly (rest = where
// it sits on it); an arm swings from its shoulder (pivot) with the hand staying on the belly (rest).
// The shader body moves each as one piece (Yukimi 2026-11-12: no stretched chests, no crushed arms).
const PIN = {
    xi: {
        base: [[897, 520, 270, 125], [600, 900, 130, 360, 665, 880, 560, 600]],
        bigger: [[897, 520, 270, 125], [600, 900, 130, 360, 665, 880, 560, 600]]
    },
    kabuki: {
        base: [[1600, 492, 225, 95]],
        bigger: [[1560, 485, 220, 90]],
        bigger2: [[1560, 520, 530, 215], [1045, 640, 70, 50, 1045, 680]]
    },
    wren: {
        base: [[1190, 665, 250, 88], [930, 950, 180, 330, 1090, 1000, 900, 640]],
        bigger: [[1190, 665, 250, 88], [930, 950, 180, 330, 1190, 1010, 900, 640]],
        stuffed: [[1190, 665, 250, 88], [930, 950, 180, 330, 1190, 1010, 900, 640]]
    }
};

async function buildMeta() {
    for (const persona of Object.keys(GROW)) {
        const m = readManifest(persona);
        m.morphs = {};
        for (const [stageId, cfg] of Object.entries(GROW[persona])) {
            const stage = m.stages[stageId];
            if (!stage) continue;
            stage.grow = { a: cfg.a, R: cfg.R, yTop: cfg.yTop, ramp: cfg.ramp, max: cfg.up[1], min: cfg.down ? cfg.down[1] : 1 };
            stage.belly = BELLY[persona][stageId];
            // what stands in front of her belly and must not move with it: her chest, [cx, cy, rx, ry]
            if (PIN[persona] && PIN[persona][stageId]) stage.pin = PIN[persona][stageId];
            if (ARRIVE[persona][stageId]) stage.arrive = ARRIVE[persona][stageId];
            const small = async (id) => {
                const b = m.bodies[id];
                return sharp(path.join(OUT, persona, b.body)).resize(Math.round(m.size[0] / 4), Math.round(m.size[1] / 4)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            };
            const base = await small(stage.body);
            for (const poseId of stageBodies(stage)) {
                if (poseId === stage.body) continue;
                const pose = await small(poseId);
                const W = base.info.width;
                let sx = 0, sy = 0, n = 0;
                for (let i = 0; i < base.data.length; i += 4) {
                    const d = Math.abs(base.data[i] - pose.data[i]) + Math.abs(base.data[i + 1] - pose.data[i + 1])
                        + Math.abs(base.data[i + 2] - pose.data[i + 2]) + Math.abs(base.data[i + 3] - pose.data[i + 3]);
                    if (d > 90) { const px = (i / 4) % W; sx += px; sy += Math.floor(i / 4 / W); n += 1; }
                }
                if (n > 20) {
                    let at = [Math.round((sx / n) * 4), Math.round((sy / n) * 4)];
                    // wings spread from her back, not from the middle of the larger wing; the belly
                    // after a print (printed) swells from the belly's own centre
                    if (poseId === stage.celebrate && n * 16 > 200000) at = [m.headPivot[0], m.shouldersY + 80];
                    if (poseId === stage.printed) at = BELLY[persona][stageId].slice(0, 2);
                    m.morphs[`${stage.body}|${poseId}`] = at;
                    console.log(`${persona}: ${stage.body}|${poseId} differs around ${m.morphs[`${stage.body}|${poseId}`]} (${n * 16} px)`);
                }
            }
        }
        // Kicks (#766): a kick is the same picture pushed out from inside, so the pose change is drawn as
        // a deformation, not a blend. For each un-kicked / kicked pair of a stage: where the two sheets
        // differ (c), how wide (R), and how far the picture moved there (d), fitted to the art below; a list,
        // one entry per place the sheets differ. The shader moves the picture by d while
        // it changes sheets, so her sash and seams bend into the kick instead of fading into it.
        m.kicks = {};
        for (const [stageId] of Object.entries(GROW[persona])) {
            const stage = m.stages[stageId];
            if (!stage || !Array.isArray(stage.belly)) continue;
            const pairs = [[stage.body, stage.kicky], [stage.rub, stage.rubKicky], [stage.gesture, stage.gestureKicky]]
                .filter(([from, to]) => from && to && m.bodies[from] && m.bodies[to]);
            for (const [from, to] of pairs) {
                const load = async (id) => sharp(path.join(OUT, persona, m.bodies[id].body)).resize(Math.round(m.size[0] / 2), Math.round(m.size[1] / 2)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
                const A = await load(from); const B = await load(to);
                const W = A.info.width; const H = A.info.height;
                let sx = 0, sy = 0, n = 0;
                const hits = [];
                for (let i = 0; i < A.data.length; i += 4) {
                    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) + Math.abs(A.data[i + 3] - B.data[i + 3]);
                    if (d > 90) { const px = (i / 4) % W; const py = Math.floor(i / 4 / W); sx += px; sy += py; n += 1; hits.push(px, py); }
                }
                if (n < 30) continue;
                // A kick sheet can differ in more than one place (Yozora: the bulge at her side and the
                // sash bending over a second bump): each place gets its own push. Places = groups of
                // differing pixels that touch on a 10 px grid.
                const CELL = 10;
                const cells = new Map();
                for (let k = 0; k < hits.length; k += 2) {
                    const key = `${Math.floor(hits[k] / CELL)},${Math.floor(hits[k + 1] / CELL)}`;
                    if (!cells.has(key)) cells.set(key, []);
                    cells.get(key).push(hits[k], hits[k + 1]);
                }
                const groups = [];
                const seen = new Set();
                for (const key of cells.keys()) {
                    if (seen.has(key)) continue;
                    const group = [];
                    const queue = [key];
                    seen.add(key);
                    while (queue.length) {
                        const cur = queue.pop();
                        group.push(...cells.get(cur));
                        const [gx, gy] = cur.split(',').map(Number);
                        for (let oy = -2; oy <= 2; oy += 1) {
                            for (let ox = -2; ox <= 2; ox += 1) {
                                const next = `${gx + ox},${gy + oy}`;
                                if (cells.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
                            }
                        }
                    }
                    if (group.length / 2 >= 24) groups.push(group);
                }
                groups.sort((g1, g2) => g2.length - g1.length);
                const sm = (x) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };
                const px = (img, x, y, ch) => {
                    const xi = Math.max(0, Math.min(W - 1, Math.round(x))); const yi = Math.max(0, Math.min(H - 1, Math.round(y)));
                    return img.data[(yi * W + xi) * 4 + ch];
                };
                const pushes = [];
                for (const group of groups.slice(0, 3)) {
                    let gx = 0, gy = 0;
                    const gn = group.length / 2;
                    for (let k = 0; k < group.length; k += 2) { gx += group[k]; gy += group[k + 1]; }
                    const cx = gx / gn; const cy = gy / gn;
                    let spread = 0;
                    for (let k = 0; k < group.length; k += 2) spread += (group[k] - cx) ** 2 + (group[k + 1] - cy) ** 2;
                    spread = Math.sqrt(spread / gn);
                    // Fit the push to the art: move the plain sheet by d with the shader's own fall-off
                    // (1 - smoothstep(r / R)) about the middle of this place, and keep the size, width
                    // and angle that leave it closest to the kicked sheet. (Her outline alone is no
                    // measure: tails and sleeves stand behind the belly.)
                    const cost = (dx, dy, R) => {
                        const reach = Math.ceil(Math.max(R, spread * 2.5));
                        let sum = 0;
                        for (let y = Math.max(0, Math.round(cy - reach)); y < Math.min(H, cy + reach); y += 2) {
                            for (let x = Math.max(0, Math.round(cx - reach)); x < Math.min(W, cx + reach); x += 2) {
                                const w = 1 - sm(Math.hypot(x - cx, y - cy) / R);
                                const ax = x - dx * w; const ay = y - dy * w;
                                const i = (y * W + x) * 4;
                                sum += Math.abs(px(A, ax, ay, 0) - B.data[i]) + Math.abs(px(A, ax, ay, 1) - B.data[i + 1])
                                    + Math.abs(px(A, ax, ay, 2) - B.data[i + 2]) + Math.abs(px(A, ax, ay, 3) - B.data[i + 3]);
                            }
                        }
                        return sum;
                    };
                    const still = cost(0, 0, 100);
                    let fit = { cost: still, score: still, d: 0, ang: 0, R: 100 };
                    // A line sliding along itself matches as well as one moving sideways, so the angle is
                    // held: at her outline a kick pushes straight out from the belly's middle (a little
                    // either way); only a bump inside the belly (her sash bending) may point anywhere.
                    // A longer push has to earn its length.
                    const bx = stage.belly[0] / 2; const by = stage.belly[1] / 2;
                    const radial = Math.atan2(cy - by, cx - bx);
                    const rim = Math.hypot(cx - bx, cy - by) > (stage.belly[2] / 2) * 0.6;
                    const angles = [];
                    if (rim) { for (let off = -0.3; off <= 0.3001; off += 0.1) angles.push(radial + off); }
                    else { for (let ang = 0; ang < Math.PI * 2 - 0.001; ang += Math.PI / 12) angles.push(ang); }
                    for (const R of [40, 55, 70, 95, 125, 160, 200, 250]) {
                        for (const ang of angles) {
                            for (let d = 2; d <= 44; d += 2) {
                                const c0 = cost(Math.cos(ang) * d, Math.sin(ang) * d, R);
                                const score = c0 * (1 + d * 0.006);
                                if (score < fit.score) fit = { cost: c0, score, d, ang, R };
                            }
                        }
                    }
                    const at = [Math.round(cx * 2), Math.round(cy * 2)];
                    if (fit.d < 2 || fit.cost > still * 0.92) {
                        console.log(`${persona}: ${from}|${to} at ${at}: no push fits (${Math.round((fit.cost / still) * 100)} % left), left to the blend`);
                        continue;
                    }
                    const push = { c: at, R: fit.R * 2, d: [Math.round(Math.cos(fit.ang) * fit.d * 2), Math.round(Math.sin(fit.ang) * fit.d * 2)], fit: Math.round((fit.cost / still) * 100) };
                    pushes.push(push);
                    console.log(`${persona}: ${from}|${to} kick at ${push.c} R ${push.R} moves ${push.d} (${push.fit} % of the difference left)`);
                }
                if (pushes.length) m.kicks[`${from}|${to}`] = pushes;
            }
        }
        writeManifest(persona, m);
    }
}

async function preview(dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const persona of Object.keys(GROW)) {
        const m = readManifest(persona);
        for (const stageId of Object.keys(GROW[persona])) {
            const stage = m.stages[stageId];
            if (!stage) continue;
            const ids = [`${stage.body}_p2`, `${stage.body}_p1`, stage.body, `${stage.body}_g1`, `${stage.body}_g2`].filter((id) => m.bodies[id]);
            const tiles = [];
            const h = 620;
            const w = Math.round((m.size[0] / m.size[1]) * h);
            for (const id of ids) {
                const b = m.bodies[id];
                const layers = b.head ? [{ input: path.join(OUT, persona, b.head) }] : [];
                const full = await sharp(path.join(OUT, persona, b.body)).composite(layers).png().toBuffer();
                tiles.push(await sharp(full).resize(w, h).flatten({ background: '#5a5a64' }).png().toBuffer());
            }
            await sharp({ create: { width: w * tiles.length, height: h, channels: 3, background: '#5a5a64' } })
                .composite(tiles.map((input, i) => ({ input, left: i * w, top: 0 }))).jpeg({ quality: 82 }).toFile(path.join(dir, `grow-${persona}-${stageId}.jpg`));
            console.log(`grow-${persona}-${stageId}.jpg: ${ids.join(' ')}`);
        }
    }
}

/**
 * Part masks (#766): what must keep its shape while her belly grows (her chest, an arm) is cut out
 * precisely by Segment Anything, not guessed with ellipses.
 *   sam-jobs <dir>   writes each pose sheet as <dir>/<persona>-<bodyId>.png and <dir>/jobs.json (point
 *                    prompts from the PIN table: inside the piece, and not on the belly / other pieces)
 *   (scripts/director-mascot-sam.py runs the model over <dir>, on any machine with torch; it writes
 *   <persona>-<bodyId>-<part>.png masks)
 *   (python director-mascot-sam.py <dir> under paints the pieces out of each sheet: <sheet>.under.png)
 *   parts <dir>      packs the masks as parts-<bodyId>.png beside the sheets (half size; red = chest,
 *                    green = arm or hand, blue = belly with its outline; soft edges) and names it in
 *                    manifest.bodies. The shader draws them as layers: the belly grows over the rest of
 *                    her, the chest and arm move on top (directorMascot.js)
 * A pose whose arm is somewhere else (a gesture) keeps only the pieces that match the stage's own.
 */
const partName = (pin, j) => (j === 0 ? 'chest' : (pin.length > 7 ? 'arm' : 'hand'));

async function buildSamJobs(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const jobs = [];
    for (const persona of Object.keys(PIN)) {
        const m = readManifest(persona);
        for (const [stageId, stage] of Object.entries(m.stages)) {
            const pins = PIN[persona][stageId];
            if (!pins || !Array.isArray(stage.belly)) continue;
            for (const bodyId of stageBodies(stage)) {
                if (!m.bodies[bodyId] || jobs.some((job) => job.persona === persona && job.bodyId === bodyId)) continue;
                const file = `${persona}-${bodyId}.png`;
                await sharp(path.join(OUT, persona, m.bodies[bodyId].body)).flatten({ background: '#808890' }).png().toFile(path.join(dir, file));
                // the sheet as it is (with its alpha), for the under-layer fill
                await sharp(path.join(OUT, persona, m.bodies[bodyId].body)).png().toFile(path.join(dir, file.replace('.png', '.rgba.png')));
                const parts = pins.map((q, j) => {
                    const pos = [];
                    if (q.length > 7) { for (const t of [0.25, 0.5, 0.75, 0.95]) pos.push([q[6] + (q[4] - q[6]) * t, q[7] + (q[5] - q[7]) * t]); }
                    else pos.push([q[0], q[1]], [q[0] - q[2] * 0.5, q[1]], [q[0] + q[2] * 0.5, q[1]]);
                    return { name: partName(q, j), small: j > 0, pos, neg: [[stage.belly[0], stage.belly[1]]].concat(pins.filter((_, k) => k !== j).map((o) => [o[0], o[1]])) };
                });
                parts.push({ name: 'belly', small: false, pos: [[stage.belly[0], stage.belly[1]], [stage.belly[0] + stage.belly[2] * 0.4, stage.belly[1]], [stage.belly[0], stage.belly[1] + stage.belly[2] * 0.4]], neg: pins.map((o) => [o[0], o[1]]) });
                jobs.push({ persona, stageId, bodyId, base: bodyId === stage.body, file, parts });
            }
        }
    }
    fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
    console.log(`${jobs.length} sheets in ${dir}`);
}

async function buildParts(dir) {
    const jobs = JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8'));
    for (const persona of Object.keys(PIN)) {
        const m = readManifest(persona);
        const W = Math.round(m.size[0] / 2); const H = Math.round(m.size[1] / 2);
        const mask = async (job, name) => {
            const file = path.join(dir, job.file.replace('.png', `-${name}.png`));
            if (!fs.existsSync(file)) return null;
            return sharp(file).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();
        };
        const count = (buf) => { let n = 0; for (let i = 0; i < buf.length; i++) if (buf[i] > 127) n += 1; return n; };
        const overlap = (a, b) => { let both = 0, any = 0; for (let i = 0; i < a.length; i++) { const x = a[i] > 127, y = b[i] > 127; if (x && y) both += 1; if (x || y) any += 1; } return any ? both / any : 0; };
        const mine = jobs.filter((job) => job.persona === persona);
        for (const job of mine) {
            const base = mine.find((other) => other.stageId === job.stageId && other.base) || job;
            const names = job.parts.map((part) => part.name);
            const channel = async (name) => {
                if (!name) return null;
                const own = await mask(job, name);
                if (!own) return null;
                // the opaque sheet is about a third of the frame: a "piece" larger than a fifth of it is the figure
                if (name !== 'belly' && count(own) > W * H * 0.2) { console.log(`${persona} ${job.bodyId}: ${name} mask is the whole figure, dropped`); return null; }
                if (job !== base && name !== 'belly') {
                    const ref = await mask(base, name);
                    if (ref && overlap(own, ref) < 0.55) { console.log(`${persona} ${job.bodyId}: ${name} is elsewhere in this pose, not pinned`); return null; }
                }
                return own;
            };
            const r = await channel('chest');
            const g = await channel(names.find((name) => name === 'arm' || name === 'hand'));
            let b = await channel('belly');
            // the belly layer takes its own outline with it: grown by 3 px (half-size pixels) into the line
            if (b) {
                for (let pass = 0; pass < 3; pass++) {
                    const next = Buffer.from(b);
                    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (b[i] < 128 && (b[i - 1] > 127 || b[i + 1] > 127 || b[i - W] > 127 || b[i + W] > 127)) next[i] = 255; }
                    b = next;
                }
            }
            const out = Buffer.alloc(W * H * 3);
            for (let i = 0; i < W * H; i++) { out[i * 3] = r ? r[i] : 0; out[i * 3 + 1] = g && !(r && r[i] > 127) ? g[i] : 0; out[i * 3 + 2] = b ? b[i] : 0; }
            const name = `parts-${job.bodyId}.png`;
            await sharp(out, { raw: { width: W, height: H, channels: 3 } }).blur(1.2).png({ compressionLevel: 9 }).toFile(path.join(OUT, persona, name));
            m.bodies[job.bodyId].parts = name;
            // the under-layer: the sheet with those pieces painted out (director-mascot-sam.py under), shown
            // where a piece has moved off its place, so no ghost of it is left on the belly
            const under = path.join(dir, job.file.replace('.png', '.under.png'));
            if (fs.existsSync(under)) {
                const underName = `under-${job.bodyId}.webp`;
                await sharp(under).webp({ quality: 88, alphaQuality: 90 }).toFile(path.join(OUT, persona, underName));
                m.bodies[job.bodyId].under = underName;
            } else delete m.bodies[job.bodyId].under;
            // the sized sheets (_g1, _p2 ...) of the image fallback are not warped by the shader: no mask
            console.log(`${persona} ${job.bodyId}: ${name} chest ${r ? count(r) : 0} piece ${g ? count(g) : 0} belly ${b ? count(b) : 0}`);
        }
        writeManifest(persona, m);
    }
}

(async () => {
    const [cmd, arg] = process.argv.slice(2);
    if (cmd === 'faces' || cmd === 'all') await buildFaces();
    if (cmd === 'stuffed' || cmd === 'all') await buildStuffed();
    if (cmd === 'grow' || cmd === 'all') await buildGrow(cmd === 'grow' ? arg : null);
    if (cmd === 'meta' || cmd === 'all') await buildMeta();
    if (cmd === 'preview') await preview(arg || path.join(ROOT, 'tmp/mascot-preview'));
    if (cmd === 'sam-jobs') await buildSamJobs(arg || path.join(ROOT, 'tmp/mascot-sam'));
    if (cmd === 'parts') await buildParts(arg || path.join(ROOT, 'tmp/mascot-sam'));
    if (!['faces', 'stuffed', 'grow', 'meta', 'all', 'preview', 'sam-jobs', 'parts'].includes(cmd)) {
        console.log('usage: director-mascot-build.js faces | stuffed | grow [persona] | meta | all | preview <dir> | sam-jobs <dir> | parts <dir>');
        process.exit(1);
    }
})().catch((err) => { console.error(err); process.exit(1); });
