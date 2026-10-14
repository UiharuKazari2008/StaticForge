#!/usr/bin/env node
/**
 * Generate the Studio's felt: a neutral grey, seamless billiard / card-table cloth tile that the
 * Studio window dyes with the workspace accent colour in CSS (Yukimi 2026-10-14: a felt like a
 * pool table or blackjack board, generated with the latest GPT Image model, clean and repeatable,
 * "dyed" by the workspace accent; Frutiger Aero / pre-2010 design language). The OpenAI key
 * resolves like the app icons: OPENAI_API_KEY, otherwise secure.config.json.
 *
 *   node scripts/generate-studio-felt.js                      # latest model, high quality
 *   node scripts/generate-studio-felt.js --model gpt-image-1.5
 *   node scripts/generate-studio-felt.js --from <existing.png> # post-process only, no request
 *
 * The model's tile is not truly seamless, so the build makes it so: greyscale, levels centred on
 * mid grey (CSS overlay-blends it over the accent, so 50% grey keeps the accent's own colour and
 * the fibres darken / lighten it), then an offset-and-crossfade: the tile is shifted by half in
 * both directions (its edges now continuous) and blended into the original under a feathered mask
 * that keeps the original's continuous centre over the shifted copy's centre seams. Felt is
 * isotropic noise, so the crossfade leaves no visible ghost.
 *
 * Writes public/static_images/studio-felt/: felt-source.png (the model's original), felt.webp
 * (the 512 px tile, drawn at 256 CSS px) and felt-1x.webp (256 px).
 *
 *   node scripts/generate-studio-felt.js --wear            # the wear layer instead
 *   node scripts/generate-studio-felt.js --wear --from <png>
 *
 * --wear (Yukimi 2026-10-14: "a layer of wear marks and or a drink ring stain. Nothing very
 * noticeable but subtle ... overlayed from the main background so that it can scale"): one
 * wide, non-repeating map of faint marks on neutral grey (rubbed nap, a couple of drink rings,
 * soft scuffs) on neutral grey, turned into a transparent overlay (buildWear: dark marks black at
 * low alpha, light marks white at lower alpha, clean cloth transparent) and drawn over the felt
 * at the Studio client's size (background-size 100% 100%) -> wear-source.png, wear.webp
 * (1536x1024 RGBA).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const { resolveOpenAiKey, DEFAULT_MODEL } = require('../modules/appIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'public', 'static_images', 'studio-felt');
const REQUEST_TIMEOUT_MS = 300000;
const TILE = 512;

const WEAR_SIZE = { width: 1536, height: 1024 };
const WEAR_PROMPT = [
    'Wide flat top-down image of a uniform plain neutral mid-grey surface, used as a wear map.',
    'Almost all of it is perfectly even mid grey. A few very faint, low-contrast signs of use on',
    'a card table cloth, only slightly darker or lighter than the grey: one faint circular drink',
    'ring stain (a thin uneven ring, partly broken, as left by the base of a glass) in the lower',
    'left quarter, a second fainter partial ring near the left edge in the upper half, a soft',
    'slightly lighter rubbed patch where forearms rest along the bottom edge, a few long soft',
    'scuff streaks near the bottom, a faint darker smudge or two. All marks soft-edged, blurred',
    'and subtle; the right half is nearly clean. Neutral grey only, no colour. No texture, no',
    'fibres, no noise, no grain, no text, no objects, no shadows, no vignette, no border.'
].join(' ');

const PROMPT = [
    'Seamless tileable texture, straight top-down macro photograph of the woven wool baize cloth',
    'of a billiard table or a casino blackjack table, perfectly flat and evenly lit from straight',
    'above. Fine dense felt fibres with a soft nap and a very subtle woven grain, tiny natural',
    'variations in the fibre density, uniform across the whole frame. Neutral mid-grey cloth with',
    'no colour cast. No vignette, no lighting gradient, no shadows, no folds, no creases, no seams,',
    'no stitching, no chalk marks, no lines, no markings, no cushions or rails, no balls, no cards,',
    'no chips, no text, no logo. Fills the entire frame edge to edge.'
].join(' ');

function parseArgs(argv) {
    const opts = { model: DEFAULT_MODEL, quality: 'high', size: '1024x1024', from: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => argv[++i];
        if (arg === '--model') opts.model = value();
        else if (arg === '--quality') opts.quality = value();
        else if (arg === '--size') opts.size = value();
        else if (arg === '--from') opts.from = value();
        else if (arg === '--wear') opts.wear = true;
        else if (arg === '--help' || arg === '-h') opts.help = true;
        else throw new Error(`Unknown option ${arg}`);
    }
    return opts;
}

async function requestTile(opts, prompt, size) {
    const { apiKey, source } = resolveOpenAiKey(PROJECT_ROOT);
    const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const result = await client.images.generate({
        model: opts.model,
        prompt: prompt || PROMPT,
        size: size || opts.size,
        quality: opts.quality,
        background: 'opaque',
        output_format: 'png',
        n: 1
    });
    const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) throw new Error('the response had no image data');
    return { png: Buffer.from(b64, 'base64'), keySource: source };
}

// greyscale, TILE x TILE, levels so the mean sits on 128 with a gentle spread
async function normalise(png) {
    const grey = await sharp(png).resize(TILE, TILE, { fit: 'cover', kernel: 'lanczos3' }).greyscale().raw().toBuffer();
    let sum = 0;
    for (let i = 0; i < grey.length; i++) sum += grey[i];
    const mean = sum / grey.length;
    let varSum = 0;
    for (let i = 0; i < grey.length; i++) varSum += (grey[i] - mean) ** 2;
    const sd = Math.sqrt(varSum / grey.length) || 1;
    // keep the fibres readable but quiet: a standard deviation of ~32 levels around mid grey
    const gain = 32 / sd;
    const out = Buffer.alloc(grey.length);
    for (let i = 0; i < grey.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(128 + (grey[i] - mean) * gain)));
    return out;
}

// offset-and-crossfade into a seamless tile
function makeSeamless(px) {
    const n = TILE;
    const half = n / 2;
    const shifted = Buffer.alloc(px.length);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            shifted[y * n + x] = px[((y + half) % n) * n + ((x + half) % n)];
        }
    }
    // mask 1 = original (its centre is continuous; it covers the shifted copy's centre seams),
    // 0 = shifted (its edges are continuous). Distance from the tile edge, feathered.
    const feather = n * 0.22;
    const out = Buffer.alloc(px.length);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
            const t = Math.max(0, Math.min(1, (edge - n * 0.08) / feather));
            const m = t * t * (3 - 2 * t);
            const i = y * n + x;
            out[i] = Math.round(px[i] * m + shifted[i] * (1 - m));
        }
    }
    return out;
}

// the wear layer as a transparent overlay (Yukimi: "make it transparent so it can overlay the main
// layer"): darker marks become black at low alpha, lighter rubbed nap white at lower alpha, the
// clean cloth fully transparent. The most common level is the clean cloth; a dead zone around it
// drops the model's faint blotchy haze, and a soft ramp keeps every mark faint.
const WEAR_DEAD = 2;            // levels either side of the clean cloth that stay transparent (the haze is ±1-2)
const WEAR_DARK_MAX = 0.24;     // alpha cap for stains / rings
const WEAR_LIGHT_MAX = 0.10;    // alpha cap for rubbed (lighter) nap
const WEAR_DARK_RANGE = 7;      // levels past the dead zone to reach the cap (the marks sit at most ~10 off the cloth)
const WEAR_LIGHT_RANGE = 9;

// Caster tracks (Yukimi 2026-10-14: streaks "like you have been sliding the character prompt boxes
// along it and they have wheels on the bottom"): dual-wheel tracks of crushed nap rolled up the
// Studio's left column (x in client px: the layer is drawn 1:1 from the client's bottom-left),
// one pair per box travel, a darker pressed core with a lighter brushed shoulder each side,
// broken up along the length and fading out where the box stopped.
const TRACKS = [
    { x: 66, top: 330, drift: 6, seed: 1 },
    { x: 606, top: 330, drift: 6, seed: 2 },
    { x: 94, top: 560, drift: -10, seed: 3 },
    { x: 634, top: 560, drift: -10, seed: 4 },
    { x: 42, top: 740, drift: 14, seed: 5 },
    { x: 582, top: 740, drift: 14, seed: 6 }
];
const TRACK_TWIN_GAP = 9;        // px between the two wheels of a caster
const TRACK_DARK_MAX = 0.12;
const TRACK_LIGHT_MAX = 0.025;
const EDGE_FADE = 0.16;          // the layer fades out over this share of its width / height at the
                                 // top and right, so a client larger than the layer never shows an edge

function seeded(seed) {
    let t = seed * 2654435761 >>> 0;
    return () => {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function paintTracks(dark, light, width, height) {
    const smooth = (t) => t * t * (3 - 2 * t);
    TRACKS.forEach((track) => {
        const rand = seeded(track.seed);
        const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
        const span = height - track.top;
        for (let y = track.top; y < height; y++) {
            const along = (height - y) / span;                       // 0 at the bottom, 1 at the top
            const cx = track.x + track.drift * Math.pow(along, 1.3) + 1.4 * Math.sin(y / 90 + phases[0]);
            // pressure varies along the run; the nap recovers towards where the box stopped
            const press = (0.55 + 0.25 * Math.sin(y / 37 + phases[1]) + 0.2 * Math.sin(y / 11 + phases[2]))
                * smooth(Math.min(1, (y - track.top) / 140));
            if (press <= 0) continue;
            for (let dx = -14; dx <= 14; dx++) {
                const x = Math.round(cx) + dx;
                if (x < 0 || x >= width) continue;
                let core = 0;
                let shoulder = 0;
                [-TRACK_TWIN_GAP / 2, TRACK_TWIN_GAP / 2].forEach((off) => {
                    const d = Math.abs(x - (cx + off));
                    // a wheel presses a band about 6 px wide; the nap beside it is brushed up
                    core = Math.max(core, smooth(Math.max(0, 1 - d / 3.4)));
                    if (d > 3.4 && d < 9) shoulder = Math.max(shoulder, Math.sin(((d - 3.4) / 5.6) * Math.PI));
                });
                const i = y * width + x;
                dark[i] = Math.max(dark[i], TRACK_DARK_MAX * core * press);
                light[i] = Math.max(light[i], TRACK_LIGHT_MAX * shoulder * press * (1 - core));
            }
        }
    });
}

async function buildWear(png) {
    const { width, height } = WEAR_SIZE;
    const grey = await sharp(png).resize(width, height, { fit: 'cover', kernel: 'lanczos3' })
        .greyscale().blur(1.6).raw().toBuffer();
    const hist = new Array(256).fill(0);
    for (let i = 0; i < grey.length; i++) hist[grey[i]] += 1;
    const mode = hist.indexOf(Math.max(...hist));
    const smooth = (t) => t * t * (3 - 2 * t);
    const dark = new Float32Array(grey.length);
    const light = new Float32Array(grey.length);
    for (let i = 0; i < grey.length; i++) {
        const dev = grey[i] - mode;
        if (dev < -WEAR_DEAD) dark[i] = WEAR_DARK_MAX * smooth(Math.min(1, (-dev - WEAR_DEAD) / WEAR_DARK_RANGE));
        else if (dev > WEAR_DEAD) light[i] = WEAR_LIGHT_MAX * smooth(Math.min(1, (dev - WEAR_DEAD) / WEAR_LIGHT_RANGE));
    }
    paintTracks(dark, light, width, height);
    const out = Buffer.alloc(width * height * 4);
    let marked = 0;
    const fadeW = width * EDGE_FADE;
    const fadeH = height * EDGE_FADE;
    for (let y = 0; y < height; y++) {
        const fy = smooth(Math.min(1, y / fadeH));
        for (let x = 0; x < width; x++) {
            const fade = fy * smooth(Math.min(1, (width - 1 - x) / fadeW));
            const i = y * width + x;
            const o = i * 4;
            const isDark = dark[i] >= light[i];
            const alpha = (isDark ? dark[i] : light[i]) * fade;
            const v = isDark ? 0 : 255;
            out[o] = v; out[o + 1] = v; out[o + 2] = v;
            out[o + 3] = Math.round(alpha * 255);
            if (out[o + 3] > 0) marked += 1;
        }
    }
    return { out, width, height, mode, coverage: +(marked / grey.length).toFixed(3) };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.wear) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        let png;
        let keySource = null;
        if (opts.from) {
            png = fs.readFileSync(opts.from);
        } else {
            const got = await requestTile(opts, WEAR_PROMPT, `${WEAR_SIZE.width}x${WEAR_SIZE.height}`);
            png = got.png;
            keySource = got.keySource;
            fs.writeFileSync(path.join(OUT_DIR, 'wear-source.png'), png);
        }
        const wear = await buildWear(png);
        await sharp(wear.out, { raw: { width: wear.width, height: wear.height, channels: 4 } })
            .webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(OUT_DIR, 'wear.webp'));
        console.log(JSON.stringify({ wear: true, model: opts.from ? null : opts.model, keySource, mode: wear.mode, coverage: wear.coverage }));
        return;
    }
    if (opts.help) {
        console.log('node scripts/generate-studio-felt.js [--model <id>] [--quality high] [--size 1024x1024] [--from <png>]');
        return;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const sourcePath = path.join(OUT_DIR, 'felt-source.png');
    let keySource = null;
    let png;
    if (opts.from) {
        png = fs.readFileSync(opts.from);
    } else {
        const got = await requestTile(opts);
        png = got.png;
        keySource = got.keySource;
        fs.writeFileSync(sourcePath, png);
    }
    const tile = makeSeamless(await normalise(png));
    const raw = { raw: { width: TILE, height: TILE, channels: 1 } };
    await sharp(tile, raw).webp({ quality: 88 }).toFile(path.join(OUT_DIR, 'felt.webp'));
    await sharp(tile, raw).resize(TILE / 2, TILE / 2, { kernel: 'lanczos3' }).webp({ quality: 88 }).toFile(path.join(OUT_DIR, 'felt-1x.webp'));
    console.log(JSON.stringify({ model: opts.from ? null : opts.model, keySource, outDir: OUT_DIR, tile: TILE }));
}

main().catch((err) => {
    console.error(`generate-studio-felt: ${err.message}`);
    process.exit(1);
});
