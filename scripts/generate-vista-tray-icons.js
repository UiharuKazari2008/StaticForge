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
 * Writes <name>-src.png (the model's 1024 px original) into --out-dir and, unless
 * --no-install, <name>-16.png / <name>-32.png / <name>-48.png into
 * public/static_images/vista-icons/ (sharp, Lanczos). Key: modules/appIconGenerator.js
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
const REFERENCES = ['net-internet-32.png', 'search-32.png', 'warning-32.png', 'drive-26-32.png', 'switch-windows-32.png'];

const STYLE = 'A single Windows Vista notification area (system tray) icon, in exactly the style of the reference icons: '
    + 'Vista system icon art, simple bold shapes with a thin dark outline, a few flat colours with a soft glossy '
    + 'highlight, slight 3/4 perspective, designed to stay readable at 16x16 pixels. One centred object filling the '
    + 'square, no text, no letters, no background, no shadow plate, transparent background.';

const ICONS = {
    'workspace-switcher': 'Two overlapping desktop windows, the front one showing a small blue planet with a ring, like switching between workspaces.',
    'service-worker': 'A silver hard drive with a small green circular sync arrow on its corner, meaning the app is cached for offline use.',
    'dev-warnings': 'A small grey gear with a yellow warning triangle overlapping its lower right, meaning developer warnings.',
    'account-manager': 'A rolodex card file: a small rotary index of cream cards on a dark chrome stand, the front card with a tiny blue person silhouette. Account Manager.',
    'dovecote': 'A white dove carrying a small closed envelope, mail program tray icon, envelope cream with a blue edge.',
    'remote-access': 'A small computer monitor with a blue screen and two curved blue connection waves above it, meaning remote access by an agent.'
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

async function referenceFiles() {
    const files = [];
    for (const name of REFERENCES) {
        const p = path.join(REF_DIR, name);
        if (!fs.existsSync(p)) continue;
        // upscale the 32 px originals so the model sees the pixels, not mush
        const buf = await sharp(p).resize(256, 256, { kernel: 'nearest' }).png().toBuffer();
        files.push(await OpenAI.toFile(buf, name, { type: 'image/png' }));
    }
    return files;
}

async function main() {
    const opts = parseArgs(process.argv);
    const { apiKey, source } = resolveOpenAiKey(ROOT);
    const client = new OpenAI({ apiKey, timeout: 240000 });
    fs.mkdirSync(opts.outDir, { recursive: true });
    const refs = await referenceFiles();
    const names = opts.only || Object.keys(ICONS);
    const done = [];
    for (const name of names) {
        if (!ICONS[name]) throw new Error(`Unknown icon ${name}`);
        const prompt = `${STYLE} Subject: ${ICONS[name]}`;
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
        if (!b64) throw new Error(`No image for ${name}`);
        const src = Buffer.from(b64, 'base64');
        fs.writeFileSync(path.join(opts.outDir, `${name}-src.png`), src);
        if (opts.install) {
            // trim the transparent margin first so the object fills the small sizes
            const trimmed = await sharp(src).trim({ threshold: 1 }).toBuffer();
            for (const size of [16, 32, 48]) {
                await sharp(trimmed)
                    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
                    .png()
                    .toFile(path.join(ICON_DIR, `${name}-${size}.png`));
            }
        }
        done.push(name);
        console.log(`generated ${name}`);
    }
    console.log(JSON.stringify({ model: opts.model, keySource: source, done }));
}

main().catch((err) => {
    console.error(`generate-vista-tray-icons: ${err.message}`);
    process.exit(1);
});
