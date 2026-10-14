#!/usr/bin/env node
/**
 * Generate the Reference Manager's cork pinboard (Yukimi 2026-10-14: "yes lets add cork pinboard
 * design"; references are printed photo cards pinned to it). A seamless, natural-colour cork tile
 * from the latest GPT Image model (key: OPENAI_API_KEY, otherwise secure.config.json, like the app
 * icons). Unlike the Studio's felt (scripts/generate-studio-felt.js) the cork keeps its own colour:
 * it is not dyed by the workspace accent.
 *
 *   node scripts/generate-cork-board.js                  # latest model, high quality
 *   node scripts/generate-cork-board.js --model gpt-image-1.5
 *   node scripts/generate-cork-board.js --from <png>     # post-process only, no request
 *
 * The build evens the light (each channel's mean kept, a very wide blur of the luminance divided
 * out so no hot spot or gradient repeats), then makes the tile seamless with the felt's
 * offset-and-crossfade, per channel. Writes public/static_images/reference-cork/: cork-source.png
 * (the model's original), cork.webp (512 px, drawn at 256 CSS px) and cork-1x.webp (256 px).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const { resolveOpenAiKey, DEFAULT_MODEL } = require('../modules/appIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'public', 'static_images', 'reference-cork');
const REQUEST_TIMEOUT_MS = 300000;
const TILE = 512;

const PROMPT = [
    'Seamless tileable texture, straight top-down macro photograph of a natural cork pinboard,',
    'fine to medium compressed cork granules in warm light brown and honey tones with small darker',
    'and lighter flecks, evenly lit from straight above, uniform density across the whole frame.',
    'No pins, no holes, no paper, no notes, no frame, no edges, no shadows, no vignette, no lighting',
    'gradient, no text, no logo. Fills the entire frame edge to edge.'
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
        else if (arg === '--help' || arg === '-h') opts.help = true;
        else throw new Error(`Unknown option ${arg}`);
    }
    return opts;
}

async function requestTile(opts) {
    const { apiKey, source } = resolveOpenAiKey(PROJECT_ROOT);
    const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const result = await client.images.generate({
        model: opts.model,
        prompt: PROMPT,
        size: opts.size,
        quality: opts.quality,
        background: 'opaque',
        output_format: 'png',
        n: 1
    });
    const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) throw new Error('the response had no image data');
    return { png: Buffer.from(b64, 'base64'), keySource: source };
}

// even the light: divide each pixel by the local (very wide) luminance relative to the mean
async function evenLight(png) {
    const rgb = await sharp(png).resize(TILE, TILE, { fit: 'cover', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
    const lum = await sharp(rgb, { raw: { width: TILE, height: TILE, channels: 3 } }).greyscale().blur(48).raw().toBuffer();
    let mean = 0;
    for (let i = 0; i < lum.length; i++) mean += lum[i];
    mean /= lum.length;
    const out = Buffer.alloc(rgb.length);
    for (let p = 0; p < lum.length; p++) {
        const k = mean / Math.max(1, lum[p]);
        for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.max(0, Math.min(255, Math.round(rgb[p * 3 + c] * k)));
    }
    return out;
}

// offset-and-crossfade (scripts/generate-studio-felt.js makeSeamless), per channel
function makeSeamless(px) {
    const n = TILE;
    const half = n / 2;
    const feather = n * 0.22;
    const out = Buffer.alloc(px.length);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
            const t = Math.max(0, Math.min(1, (edge - n * 0.08) / feather));
            const m = t * t * (3 - 2 * t);
            const i = (y * n + x) * 3;
            const j = (((y + half) % n) * n + ((x + half) % n)) * 3;
            for (let c = 0; c < 3; c++) out[i + c] = Math.round(px[i + c] * m + px[j + c] * (1 - m));
        }
    }
    return out;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log('node scripts/generate-cork-board.js [--model <id>] [--quality high] [--size 1024x1024] [--from <png>]');
        return;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    let png;
    let keySource = null;
    if (opts.from) {
        png = fs.readFileSync(opts.from);
    } else {
        const got = await requestTile(opts);
        png = got.png;
        keySource = got.keySource;
        fs.writeFileSync(path.join(OUT_DIR, 'cork-source.png'), png);
    }
    const tile = makeSeamless(await evenLight(png));
    const raw = { raw: { width: TILE, height: TILE, channels: 3 } };
    await sharp(tile, raw).webp({ quality: 86 }).toFile(path.join(OUT_DIR, 'cork.webp'));
    await sharp(tile, raw).resize(TILE / 2, TILE / 2, { kernel: 'lanczos3' }).webp({ quality: 86 }).toFile(path.join(OUT_DIR, 'cork-1x.webp'));
    console.log(JSON.stringify({ model: opts.from ? null : opts.model, keySource, outDir: OUT_DIR, tile: TILE }));
}

main().catch((err) => {
    console.error(`generate-cork-board: ${err.message}`);
    process.exit(1);
});
