#!/usr/bin/env node
/**
 * Generate Vista-style notification-area icons with GPT Image for tray items Vista never had
 * (Yukimi, 2026-10-12). Vista's own tray icons (static_images/vista-icons/, ripped from a
 * Vista Aero VM) go in as style references, so the results match the system set: flat,
 * limited colour, bold shapes that read at 16 px, soft Vista gloss.
 *
 *   node scripts/generate-vista-tray-icons.js                 # every icon
 *   node scripts/generate-vista-tray-icons.js --only account-manager,dovecote
 *   node scripts/generate-vista-tray-icons.js --out-dir /tmp/tray --quality high
 *
 * Writes <name>-<size>-src.png (the model's 1024 px pixel-art original) into --out-dir and,
 * unless --no-install, <name>-16.png / <name>-32.png into public/static_images/vista-icons/
 * (one sample per pixel cell, so the icons are crisp at the size they are shown). Key: modules/appIconGenerator.js
 * resolveOpenAiKey (OPENAI_API_KEY or secure.config.json).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const { resolveOpenAiKey } = require('../modules/appIconGenerator');

const ROOT = path.join(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'public/static_images/vista-icons');
const DEFAULT_MODEL = 'gpt-image-2.5-sunburst';
// Vista's own tray icons (ripped from the VM) as style references
const REF_DIR = path.join(__dirname, 'assets/vista-tray-refs');
// the flat tray set: network, volume, limited network (Yukimi: flat flat, like those)
const REFERENCE_NAMES = ['net-internet', 'volume', 'net-limited'];
// Pixel grid mode (Yukimi: downscaled art is blurry, generate at the size it is shown): the model
// draws true N x N pixel art on the 1024 canvas (N x N equal cells), the references are Vista's
// own N px tray icons enlarged pixel for pixel, and each cell's centre is sampled back to N px.
const PIXEL_SIZES = [16, 32];

const STYLE = 'A single Windows Vista notification area (system tray) icon, drawn exactly like the reference tray icons '
    + '(Vista network and volume icons): FLAT, a handful of solid colours, at most a very soft single gradient per shape, '
    + 'a thin dark grey outline, no glossy 3D rendering, no bevels, no drop shadow, simple geometric shapes, pixel-aligned, '
    + 'built to read at 16x16 pixels. One centred subject filling the square, no text, no letters, transparent background.';

const ICONS = {
    'workspace-switcher': 'Two square panes of light blue glass in a staggered arrangement: one at the top right and one at the bottom left, overlapping a little. The lower (back) pane is hollowed out, only its glass frame with an empty centre; the upper (front) pane is solid glass.',
    'service-worker': 'A flat grey hard drive seen from the front at a slight angle, with a small flat green circular arrow on its lower right corner (offline cache).',
    'dev-warnings': 'A flat grey gear with a small flat yellow warning triangle with a black exclamation mark overlapping its lower right.',
    'account-manager': 'A flat rolodex card file: a few cream index cards on a small dark rotary stand, the front card with a tiny flat blue person silhouette.',
    'dovecote': 'A flat white dove in profile carrying a small cream envelope with a blue edge.',
    'remote-access': 'Only the top right corner of a computer monitor (cropped by the icon edge like the reference network icon), blue screen, with two flat curved signal waves coming out of its corner.'
};

function parseArgs(argv) {
    const opts = { only: null, outDir: path.join(ROOT, 'tmp/vista-tray-icons'), quality: 'high', model: DEFAULT_MODEL, install: true };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
        else if (a === '--out-dir') opts.outDir = argv[++i];
        else if (a === '--quality') opts.quality = argv[++i];
        else if (a === '--model') opts.model = argv[++i];
        else if (a === '--no-install') opts.install = false;
        else if (a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
        else throw new Error(`Unknown option ${a}`);
    }
    return opts;
}

async function referenceFiles(size) {
    const files = [];
    for (const base of REFERENCE_NAMES) {
        const name = `${base}-${size}.png`;
        const p = path.join(REF_DIR, name);
        if (!fs.existsSync(p)) continue;
        // enlarge pixel for pixel to the canvas, so the model sees the grid it must draw on
        const buf = await sharp(p).resize(1024, 1024, { kernel: 'nearest' }).png().toBuffer();
        files.push(await OpenAI.toFile(buf, name, { type: 'image/png' }));
    }
    return files;
}

/** Sample the centre of each of the N x N cells of a 1024 px pixel-art image. */
async function sampleGrid(src, size) {
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(size * size * 4);
    const cell = info.width / size;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const sx = Math.min(info.width - 1, Math.floor((x + 0.5) * cell));
            const sy = Math.min(info.height - 1, Math.floor((y + 0.5) * cell));
            const si = (sy * info.width + sx) * 4;
            const di = (y * size + x) * 4;
            data.copy(out, di, si, si + 4);
            // clean the edges: nearly transparent is transparent, nearly opaque is opaque
            if (out[di + 3] < 40) out[di + 3] = 0;
            else if (out[di + 3] > 215) out[di + 3] = 255;
        }
    }
    return sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

async function main() {
    const opts = parseArgs(process.argv);
    const { apiKey, source } = resolveOpenAiKey(ROOT);
    const client = new OpenAI({ apiKey, timeout: 240000 });
    fs.mkdirSync(opts.outDir, { recursive: true });
    const names = opts.only || Object.keys(ICONS);
    const done = [];
    for (const size of PIXEL_SIZES) {
        const refs = await referenceFiles(size);
        for (const name of names) {
            if (!ICONS[name]) throw new Error(`Unknown icon ${name}`);
            const prompt = `${STYLE} Draw it as true ${size}x${size} pixel art: the whole square canvas is a grid of `
                + `${size} by ${size} equal square cells, every cell one flat colour or fully transparent, hard pixel edges, `
                + `no anti-aliasing, no sub-cell detail, exactly like the reference images, which are ${size}x${size} Vista `
                + `tray icons enlarged pixel for pixel. Use the whole grid like they do. Subject: ${ICONS[name]}`;
            const result = await client.images.edit({
                model: opts.model,
                image: refs,
                prompt,
                size: '1024x1024',
                quality: opts.quality,
                background: 'transparent',
                output_format: 'png'
            });
            const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
            if (!b64) throw new Error(`No image for ${name} @${size}`);
            const src = Buffer.from(b64, 'base64');
            fs.writeFileSync(path.join(opts.outDir, `${name}-${size}-src.png`), src);
            if (opts.install) {
                fs.writeFileSync(path.join(ICON_DIR, `${name}-${size}.png`), await sampleGrid(src, size));
            }
            done.push(`${name}@${size}`);
            console.log(`generated ${name} @${size}`);
        }
    }
    console.log(JSON.stringify({ model: opts.model, keySource: source, done }));
}

main().catch((err) => {
    console.error(`generate-vista-tray-icons: ${err.message}`);
    process.exit(1);
});
