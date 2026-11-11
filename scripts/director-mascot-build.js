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
async function buildMeta() {
    for (const persona of Object.keys(GROW)) {
        const m = readManifest(persona);
        m.morphs = {};
        for (const [stageId, cfg] of Object.entries(GROW[persona])) {
            const stage = m.stages[stageId];
            if (!stage) continue;
            stage.grow = { a: cfg.a, R: cfg.R, yTop: cfg.yTop, ramp: cfg.ramp, max: cfg.up[1], min: cfg.down ? cfg.down[1] : 1 };
            stage.belly = BELLY[persona][stageId];
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

(async () => {
    const [cmd, arg] = process.argv.slice(2);
    if (cmd === 'faces' || cmd === 'all') await buildFaces();
    if (cmd === 'stuffed' || cmd === 'all') await buildStuffed();
    if (cmd === 'grow' || cmd === 'all') await buildGrow(cmd === 'grow' ? arg : null);
    if (cmd === 'meta' || cmd === 'all') await buildMeta();
    if (cmd === 'preview') await preview(arg || path.join(ROOT, 'tmp/mascot-preview'));
    if (!['faces', 'stuffed', 'grow', 'meta', 'all', 'preview'].includes(cmd)) {
        console.log('usage: director-mascot-build.js faces | stuffed | grow [persona] | meta | all | preview <dir>');
        process.exit(1);
    }
})().catch((err) => { console.error(err); process.exit(1); });
