#!/usr/bin/env node
/**
 * Generate Windows Setup-style aurora backgrounds for the Melaton installer on /launch
 * (Yozora #419, plan #411) with GPT Image. The OpenAI key resolves like the app icons:
 * OPENAI_API_KEY, otherwise the OpenAI key in secure.config.json (appIconGenerator).
 *
 *   node scripts/generate-setup-background.js --variant all --out-dir /tmp/setup-bg
 *   node scripts/generate-setup-background.js --variant vista-aurora --quality high
 *   node scripts/generate-setup-background.js --help
 *
 * Each variant writes <name>.png (the model's original) and <name>-1920.webp (a 1920x1080
 * cover crop, the size the installer shows).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const { resolveOpenAiKey } = require('../modules/appIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MODEL = 'gpt-image-2.5-sunburst';
const DEFAULT_QUALITY = 'high';
const DEFAULT_SIZE = '1536x1024';
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, 'public', 'static_images', 'setup');
const REQUEST_TIMEOUT_MS = 180000;

const BASE = [
    'Abstract full-screen background for an operating system setup screen, in the manner of the',
    'Windows Vista installer aurora (2006-2007 Frutiger Aero).',
    'Smooth flowing ribbons and veils of light sweeping in long diagonal curves, soft light rays,',
    'glassy translucent bands with gentle depth, very smooth gradients, slightly darker at the',
    'edges so a centred window reads well on top.',
    'No text, no letters, no logos, no flags, no user interface, no people, no landscape, no',
    'stars that look like dots of noise, no hard edges, no vignette frame.'
].join(' ');

const VARIANTS = {
    'vista-aurora': 'Palette: deep ocean blue in the lower left blending through teal into fresh spring green on the right, a bright soft white-green glow and light rays fanning from the upper left. Faithful to the original Vista setup look.',
    'dreamscape-dusk': 'Palette: Dreamscape night colours, deep indigo base with violet and magenta veils, luminous cyan and teal ribbons crossing them, a soft lavender glow from the upper left.',
    'emerald-night': 'Palette: dark navy almost black base, emerald and jade green aurora curtains rising from the lower right, faint cyan highlights, calm and dim so white text stays readable.',
    'daybreak': 'Palette: high-key and airy, pale aqua and sky blue base, lime and mint green ribbons, warm white light from the upper left, like early morning.'
};

function printHelp() {
    console.log(`Generate Windows Setup-style aurora backgrounds (GPT Image).

Options:
  --variant <name|all>   ${Object.keys(VARIANTS).join(', ')}, or all (default all)
  --extra <text>         Extra direction appended to the prompt
  --model <id>           GPT Image model (default ${DEFAULT_MODEL})
  --quality <level>      low, medium, high (2.5 also xhigh, max; default ${DEFAULT_QUALITY})
  --size <WxH>           Model output size (default ${DEFAULT_SIZE})
  --out-dir <path>       Where to write (default public/static_images/setup)
  --dry-run              Print the prompts, no API call
  --json                 Print one JSON object
  --help                 Show this help

Key: OPENAI_API_KEY, otherwise the OpenAI key in secure.config.json.`);
}

function parseArgs(argv) {
    const opts = { variant: 'all', model: DEFAULT_MODEL, quality: DEFAULT_QUALITY, size: DEFAULT_SIZE, outDir: DEFAULT_OUT_DIR, extra: '' };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value`);
            i += 1;
            return next;
        };
        if (arg === '--help' || arg === '-h') opts.help = true;
        else if (arg === '--dry-run') opts.dryRun = true;
        else if (arg === '--json') opts.json = true;
        else if (arg === '--variant') opts.variant = value();
        else if (arg === '--extra') opts.extra = value();
        else if (arg === '--model') opts.model = value();
        else if (arg === '--quality') opts.quality = value();
        else if (arg === '--size') opts.size = value();
        else if (arg === '--out-dir') opts.outDir = path.resolve(value());
        else throw new Error(`Unknown option ${arg}`);
    }
    return opts;
}

function promptFor(name, extra) {
    return [BASE, VARIANTS[name], extra].filter(Boolean).join(' ');
}

async function generateOne(client, name, opts) {
    const prompt = promptFor(name, opts.extra);
    const started = Date.now();
    const result = await client.images.generate({
        model: opts.model,
        prompt,
        size: opts.size,
        quality: opts.quality,
        background: 'opaque',
        output_format: 'png',
        n: 1
    });
    const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) throw new Error(`${name}: the response had no image data`);
    const png = Buffer.from(b64, 'base64');
    const pngPath = path.join(opts.outDir, `${name}.png`);
    const webpPath = path.join(opts.outDir, `${name}-1920.webp`);
    fs.writeFileSync(pngPath, png);
    await sharp(png).resize({ width: 1920, height: 1080, fit: 'cover' }).webp({ quality: 88 }).toFile(webpPath);
    return { name, png: pngPath, webp: webpPath, bytes: png.length, seconds: Math.round((Date.now() - started) / 1000) };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) return printHelp();
    const names = opts.variant === 'all' ? Object.keys(VARIANTS) : [opts.variant];
    names.forEach((name) => {
        if (!VARIANTS[name]) throw new Error(`Unknown variant "${name}". Use one of: ${Object.keys(VARIANTS).join(', ')}, all`);
    });
    if (opts.dryRun) {
        const prompts = Object.fromEntries(names.map((name) => [name, promptFor(name, opts.extra)]));
        console.log(opts.json ? JSON.stringify({ dryRun: true, model: opts.model, size: opts.size, prompts }) : prompts);
        return;
    }
    fs.mkdirSync(opts.outDir, { recursive: true });
    const { apiKey, source } = resolveOpenAiKey(PROJECT_ROOT);
    const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const settled = await Promise.allSettled(names.map((name) => generateOne(client, name, opts)));
    const done = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    const failed = settled.map((s, i) => (s.status === 'rejected' ? { name: names[i], error: s.reason && s.reason.message } : null)).filter(Boolean);
    const summary = { model: opts.model, quality: opts.quality, size: opts.size, keySource: source, done, failed };
    console.log(opts.json ? JSON.stringify(summary) : summary);
    if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
    console.error(`generate-setup-background: ${err.message}`);
    process.exit(1);
});
