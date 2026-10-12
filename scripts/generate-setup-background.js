#!/usr/bin/env node
/**
 * Generate Vista-style aurora backgrounds with GPT Image: the Melaton installer backdrop on
 * /launch and the default wallpaper for workspaces with no image (Yozora #419, plan #411).
 * The composition follows the Vista desktop aurora: a vast dark backdrop, the flow gathered
 * along the bottom, one sharp bright crease near the lower right corner. The OpenAI key
 * resolves like the app icons: OPENAI_API_KEY, otherwise secure.config.json.
 *
 *   node scripts/generate-setup-background.js --variant all --out-dir /tmp/setup-bg
 *   node scripts/generate-setup-background.js --variant vista-aurora --quality high
 *   node scripts/generate-setup-background.js --help
 *
 * Generation stays small (auroras are soft, so a Lanczos upscale holds up): each variant
 * writes <name>.png (the model's original), <name>.webp (cover-scaled to --target, default
 * 3840x2160, for the wallpaper) and <name>-1920.webp (1920x1080 cover crop).
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
const DEFAULT_TARGET = '3840x2160';
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, 'public', 'static_images', 'setup');
const REQUEST_TIMEOUT_MS = 300000;

const BASE = [
    'Abstract widescreen desktop wallpaper in the manner of the Windows Vista default aurora',
    'wallpaper (2006-2007 Frutiger Aero), clean high-end render.',
    'Composition: a vast, dark, almost empty backdrop. The upper two thirds are a deep smooth',
    'gradient from near-black at the top edge to a dark tint, open and spacious, with only the',
    'faintest haze. All of the light lives in the bottom third: a broad sweep of luminous',
    'translucent ribbons and veils of light flows in from the lower left and curves gently',
    'upward towards the lower right. Near the lower right corner the ribbons fold over each',
    'other into one crisp, sharply defined bright crease: a thin, well-lit edge with a hard',
    'highlight, clearly sharper than the soft glow around it. Faint secondary light rays fan',
    'upward from that fold and fade long before the top. Glassy depth, smooth gradients, no',
    'noise. No text, no letters, no logos, no flags, no user interface, no people, no',
    'landscape, no stars, no bokeh dots, no sun, no vignette frame.'
].join(' ');

const VARIANTS = {
    'vista': 'Palette: faithful to Vista. Backdrop near-black blending into deep blue-green. Ribbons in teal, emerald and fresh green with cyan highlights; the crease glows white-green.',
    'vista-blue': 'Palette: cooler Vista. Backdrop near-black to deep navy. Ribbons in cyan, azure and ice blue with a touch of teal; the crease glows bright white-blue.',
    'vista-dusk': 'Palette: Dreamscape night. Backdrop near-black to deep indigo. Ribbons in violet, magenta and teal with cyan highlights; the crease glows white-lavender.',
    'vista-emerald': 'Palette: darkest. Backdrop pure near-black to very dark green. Ribbons in deep emerald and jade with restrained mint highlights; the crease glows pale green.'
};

function printHelp() {
    console.log(`Generate Windows Setup-style aurora backgrounds (GPT Image).

Options:
  --variant <name|all>   ${Object.keys(VARIANTS).join(', ')}, or all (default all)
  --extra <text>         Extra direction appended to the prompt
  --model <id>           GPT Image model (default ${DEFAULT_MODEL})
  --quality <level>      low, medium, high (2.5 also xhigh, max; default ${DEFAULT_QUALITY})
  --size <WxH>           Model output size (default ${DEFAULT_SIZE})
  --target <WxH>         Upscaled wallpaper size, cover crop (default ${DEFAULT_TARGET})
  --out-dir <path>       Where to write (default public/static_images/setup)
  --dry-run              Print the prompts, no API call
  --json                 Print one JSON object
  --help                 Show this help

Key: OPENAI_API_KEY, otherwise the OpenAI key in secure.config.json.`);
}

function parseArgs(argv) {
    const opts = { variant: 'all', model: DEFAULT_MODEL, quality: DEFAULT_QUALITY, size: DEFAULT_SIZE, target: DEFAULT_TARGET, outDir: DEFAULT_OUT_DIR, extra: '' };
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
        else if (arg === '--target') opts.target = value();
        else if (arg === '--out-dir') opts.outDir = path.resolve(value());
        else throw new Error(`Unknown option ${arg}`);
    }
    return opts;
}

function promptFor(name, extra) {
    return [BASE, VARIANTS[name], extra].filter(Boolean).join(' ');
}

function parseSize(text) {
    const m = /^(\d+)x(\d+)$/.exec(String(text || ''));
    if (!m) throw new Error(`Size must look like 3840x2160, got "${text}"`);
    return { width: Number(m[1]), height: Number(m[2]) };
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
    const target = parseSize(opts.target);
    const pngPath = path.join(opts.outDir, `${name}.png`);
    const fullWebpPath = path.join(opts.outDir, `${name}.webp`);
    const webpPath = path.join(opts.outDir, `${name}-1920.webp`);
    fs.writeFileSync(pngPath, png);
    const meta = await sharp(png).metadata();
    await sharp(png).resize({ ...target, fit: 'cover', kernel: 'lanczos3' }).webp({ quality: 90 }).toFile(fullWebpPath);
    await sharp(png).resize({ width: 1920, height: 1080, fit: 'cover', kernel: 'lanczos3' }).webp({ quality: 88 }).toFile(webpPath);
    return {
        name, generated: `${meta.width}x${meta.height}`, wallpaper: opts.target,
        png: pngPath, webp: fullWebpPath, preview: webpPath, bytes: png.length,
        seconds: Math.round((Date.now() - started) / 1000)
    };
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
    const summary = { model: opts.model, quality: opts.quality, size: opts.size, target: opts.target, keySource: source, done, failed };
    console.log(opts.json ? JSON.stringify(summary) : summary);
    if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
    console.error(`generate-setup-background: ${err.message}`);
    process.exit(1);
});
