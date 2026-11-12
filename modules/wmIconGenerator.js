/**
 * Windows Mobile 6.1 Professional style program icons for Melaton Mobile (Yozora #732).
 * CLI: scripts/generate-wm-icon.js   Studio: scripts/wm-icon-studio.js
 * Style notes: docs/design/wm61-icon-style.md
 *
 * One transparent 1024 px master per icon (kept in .cache/wm-icons/originals, not served) is cropped
 * to its body with WM's tight margin and rendered at the shell's sizes in public/static_images/wm61:
 *
 *   app-<name>.png        16  (1x small: Start menu, title bar, lists)
 *   app-<name>@2x.png     32  (2x small)
 *   app-<name>@4x.png     64  (4x small, listed in wmShell HD_ART)
 *   app-<name>-lg.png     32  (1x large: Programs grid, wmPrograms wmLargeIcon)
 *   app-<name>-lg@2x.png  64  (2x large)
 *   app-<name>-lg@4x.png  128 (4x large)
 *
 * WM ships the 16 px frame as its own simplified drawing; pass a "small" master (generated with
 * small: true from the large one) and the 16 px file is drawn from it instead.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const appIconGenerator = require('./appIconGenerator');

const toFile = OpenAI.toFile;
const { AppIconError, TRANSPARENT_MODELS, DEFAULT_MODEL, DEFAULT_SIZE, MAX_REFERENCES } = appIconGenerator;

const DEFAULT_QUALITY = 'high';
const REQUEST_TIMEOUT_MS = 240000;
/** WM art fills its square: the long side is 56-64 of 64 px in the ROM icons. */
const WM_INSET = 0.03;
const BODY_ALPHA = 128;
/** Alpha at or under this on the master is haze (soft shadow, glow) and is cleared before scaling. */
const HAZE_ALPHA = 24;

const SIZES = Object.freeze([
    { suffix: '', size: 16, density: '1x', small: true },
    { suffix: '@2x', size: 32, density: '2x' },
    { suffix: '@4x', size: 64, density: '4x' },
    { suffix: '-lg', size: 32, density: '1x', large: true },
    { suffix: '-lg@2x', size: 64, density: '2x', large: true },
    { suffix: '-lg@4x', size: 128, density: '4x', large: true }
]);

function collapse(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function wmArtDir(projectRoot) {
    return path.join(projectRoot, 'public', 'static_images', 'wm61');
}

function originalsDir(projectRoot) {
    return path.join(projectRoot, '.cache', 'wm-icons', 'originals');
}

/** "Teleport", "teleport.png", "app-teleport" -> "app-teleport". */
function artName(name) {
    let base = collapse(name).toLowerCase().replace(/\.png$/i, '').replace(/(@\dx|-lg(@\dx)?)$/, '');
    if (!base.startsWith('app-')) base = `app-${base}`;
    if (!/^app-[a-z0-9][a-z0-9-]{0,47}$/.test(base)) {
        throw new AppIconError('--name must be letters, numbers or "-", such as teleport (written as app-teleport).');
    }
    return base;
}

function buildWmIconPrompt({ input, from, extra, referenceCount, small } = {}) {
    const subject = collapse(input);
    if (!subject && !small) {
        throw new AppIconError('--input is required (the physical thing the icon shows).');
    }
    const replacing = collapse(from);
    const notes = collapse(extra);
    const refs = Number(referenceCount) || 0;
    const lines = [];
    if (small) {
        lines.push(
            `Redraw the attached program icon${subject ? ` of "${subject}"` : ''} as its own 16 x 16 pixel frame for a 2008 Windows Mobile 6.1 Pocket PC, drawn large on this canvas.`,
            'Same subject, colours and outline as the attached icon, but simplified the way the era\'s 16 pixel icons were: turned straight to face the viewer, only the two or three largest shapes kept, small parts and accessories merged or dropped, thicker dark outline, broad flat colour areas with one simple light-to-dark gradient and one highlight. No interior detail smaller than about one sixteenth of the icon (no small markings, lines or speckles).',
            'It must still read as the same icon when shrunk to 16 pixels.'
        );
    } else {
        lines.push(
            `Create a program icon of "${subject}" for a 2008 Windows Mobile 6.1 Professional Pocket PC (VGA screen), in that era's icon style: the glossy Vista-generation look, simplified to stay crisp at 64, 32 and 16 pixels.`,
            'Style: bold, compact silhouette made of a few large simple shapes. Front-on view or a slight three-quarter turn at most, no strong isometric perspective. Every shape has a clean thin outline in a darker shade of its own colour (not black). Light from the upper left, smooth gradients, one crisp glossy highlight on the upper part of each main shape. Clear saturated colours (sky blue, leaf green, warm amber, tomato red), off-white paper, cool steel grey. Smooth plastic, glass, paper and metal; no fine texture, grain or tiny details.'
        );
        if (replacing) {
            lines.push(`It is the phone version of the "${replacing}" program: show that job clearly with one main object, plus at most one small overlapping accessory in the lower right corner (the way WM icons add a gear, magnifier, arrow or badge). Do not copy another icon's layout.`);
        } else {
            lines.push('One main object, plus at most one small overlapping accessory in the lower right corner.');
        }
    }
    lines.push(
        'The object fills the square canvas almost edge to edge, centred, about 94% of the canvas on its longest side.',
        'Original artwork: no logos, flags or trademarks of any company (no Windows flag, no Microsoft or Internet Explorer marks), and no text, letters or numbers anywhere.',
        'Transparent background: no floor, plate, backdrop, drop shadow, contact shadow, reflection or glow. Clean anti-aliased silhouette edge with no fringe or halo.',
        'Keep surfaces off pure white so highlights stay visible.'
    );
    if (refs > 0) {
        lines.push(small
            ? `The attached image${refs > 1 ? 's are' : ' is'} the icon to simplify; match ${refs > 1 ? 'them' : 'it'}.`
            : `Reference images are attached in order (${refs}). Keep their subject and distinctive details, redrawn in the style above. Do not copy their background, framing or layout.`);
    }
    if (notes) {
        lines.push(`Required user direction, follow this even when it conflicts with the defaults above: ${notes}`);
    }
    return lines.join('\n');
}

function assertQuality(quality, model) {
    const name = collapse(quality) || DEFAULT_QUALITY;
    const allowed = /^gpt-image-2\.[5-9]/.test(String(model || ''))
        ? ['low', 'medium', 'high', 'xhigh', 'max']
        : ['low', 'medium', 'high'];
    if (!allowed.includes(name)) {
        throw new AppIconError(`--quality must be ${allowed.join(', ')} for ${model}.`);
    }
    return name;
}

function atomicWrite(filePath, buffer) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, filePath);
}

async function referenceFiles(references) {
    const list = Array.isArray(references) ? references : [];
    if (list.length > MAX_REFERENCES) throw new AppIconError(`Up to ${MAX_REFERENCES} reference images.`);
    const files = [];
    for (let i = 0; i < list.length; i++) {
        const buffer = list[i] && list[i].buffer;
        if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new AppIconError(`Reference ${i + 1} is not an image.`);
        const png = await sharp(buffer).rotate()
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        const name = collapse(list[i].name).replace(/[^\w.-]+/g, '_') || `reference-${i + 1}.png`;
        files.push(await toFile(png, name.endsWith('.png') ? name : `${name}.png`, { type: 'image/png' }));
    }
    return files;
}

/** Bounding box of pixels with alpha >= minAlpha, in pixels; null when empty. */
async function bodyBox(buffer, minAlpha = BODY_ALPHA) {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width; let minY = info.height; let maxX = -1; let maxY = -1;
    for (let y = 0; y < info.height; y++) {
        const row = y * info.width * 4;
        for (let x = 0; x < info.width; x++) {
            if (data[row + x * 4 + 3] < minAlpha) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < 0) return null;
    return { minX, minY, maxX, maxY, width: info.width, height: info.height };
}

/** Square crop around the body with WM's tight margin. */
async function autoCrop(buffer, inset = WM_INSET) {
    const box = await bodyBox(buffer);
    if (!box) throw new AppIconError('The image has no opaque pixels.', 'API');
    const bw = box.maxX - box.minX + 1;
    const bh = box.maxY - box.minY + 1;
    const side = Math.max(bw, bh) / Math.max(0.5, 1 - inset * 2);
    return {
        x: Math.round((box.minX + box.maxX + 1) / 2 - side / 2),
        y: Math.round((box.minY + box.maxY + 1) / 2 - side / 2),
        size: Math.round(side)
    };
}

/** The crop as a square RGBA buffer at its own resolution, faint haze cleared. */
async function squareFromCrop(buffer, crop) {
    const meta = await sharp(buffer).metadata();
    const side = Math.round(Number(crop && crop.size));
    const left = Math.round(Number(crop && crop.x));
    const top = Math.round(Number(crop && crop.y));
    if (!Number.isFinite(side) || !Number.isFinite(left) || !Number.isFinite(top) || side < 8) {
        throw new AppIconError('Crop needs numeric x, y, and a size of at least 8 pixels.');
    }
    const srcLeft = Math.max(0, left);
    const srcTop = Math.max(0, top);
    const srcW = Math.min(meta.width, left + side) - srcLeft;
    const srcH = Math.min(meta.height, top + side) - srcTop;
    const layers = [];
    if (srcW > 0 && srcH > 0) {
        layers.push({
            input: await sharp(buffer).extract({ left: srcLeft, top: srcTop, width: srcW, height: srcH }).png().toBuffer(),
            left: srcLeft - left,
            top: srcTop - top
        });
    }
    const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(layers).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = square;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] <= HAZE_ALPHA) { data[i] = 0; data[i - 1] = 0; data[i - 2] = 0; data[i - 3] = 0; }
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Alpha ramp lo..hi -> 0..255: WM's small frames have near-binary edges (one step of anti-aliasing). */
async function hardenAlpha(buffer, lo, hi) {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) {
        const a = data[i];
        data[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round((a - lo) * 255 / (hi - lo));
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/**
 * One output size (sharp premultiplies alpha when resizing). Small frames are supersampled at 2x,
 * sharpened, scaled down, sharpened again with a touch of contrast, and get harder alpha edges, so
 * 16 and 32 px read crisp like the ROM art instead of a soft Lanczos thumbnail.
 */
async function renderSize(square, size) {
    let out;
    if (size <= 16) {
        const twice = await sharp(square).resize(size * 2, size * 2, { kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 0.6, m1: 1, m2: 2 }).png().toBuffer();
        out = await hardenAlpha(await sharp(twice).resize(size, size, { kernel: sharp.kernel.lanczos3 })
            .sharpen({ sigma: 0.4, m1: 0.8, m2: 1.6 }).modulate({ saturation: 1.1 }).linear(1.08, -8).png().toBuffer(), 50, 190);
    } else if (size <= 32) {
        out = await hardenAlpha(await sharp(square).resize(size, size, { kernel: sharp.kernel.lanczos3 })
            .sharpen({ sigma: 0.5, m1: 1, m2: 2 }).png().toBuffer(), 30, 220);
    } else if (size <= 64) {
        out = await sharp(square).resize(size, size, { kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 0.6, m1: 0.5, m2: 1 }).png().toBuffer();
    } else {
        out = await sharp(square).resize(size, size, { kernel: sharp.kernel.lanczos3 }).png().toBuffer();
    }
    return sharp(out).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
}

function readManifest(projectRoot) {
    const file = path.join(wmArtDir(projectRoot), 'manifest.json');
    return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function manifestEntries(name, info) {
    const src = (label) => `generated (${info.model || 'GPT Image'}, scripts/generate-wm-icon.js), master .cache/wm-icons/originals/${label}.png, Lanczos-downscaled`;
    const smallSrc = info.hasSmall ? src(`${name}-16`) : src(name);
    const subject = info.input ? ` Subject: ${collapse(info.input)}.` : '';
    const forApp = info.from ? ` For ${collapse(info.from)}.` : '';
    return {
        [name]: {
            '1x': { source: smallSrc, size: [16, 16] },
            '2x': { source: src(name), size: [32, 32] },
            '4x': { source: src(name), size: [64, 64] },
            flags: ['generated', ...(info.hasSmall ? ['1x-own-16px-frame'] : [])],
            notes: `Not ROM art: our own WM 6.1 style icon (docs/design/wm61-icon-style.md).${forApp}${subject}`
        },
        [`${name}-lg`]: {
            '1x': { source: src(name), size: [32, 32] },
            '2x': { source: src(name), size: [64, 64] },
            '4x': { source: src(name), size: [128, 128] },
            flags: ['generated'],
            notes: `Large (Programs grid) version of ${name}. Not ROM art.`
        }
    };
}

function updateManifest(projectRoot, name, info) {
    const { file, data } = readManifest(projectRoot);
    data.items = data.items || {};
    Object.assign(data.items, manifestEntries(name, info));
    atomicWrite(file, Buffer.from(`${JSON.stringify(data, null, 2)}\n`));
    return file;
}

/**
 * Render every WM size for an icon from its stored master(s) and record it in manifest.json.
 * options: { projectRoot, name, crop?, smallCrop?, inset?, manifest?: false, model?, input?, from? }
 */
async function saveWmIcon(options = {}) {
    const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
    const name = artName(options.name);
    const origDir = originalsDir(projectRoot);
    const masterPath = path.join(origDir, `${name}.png`);
    if (!fs.existsSync(masterPath)) throw new AppIconError(`No master for ${name} in ${origDir}. Generate it first.`);
    const master = fs.readFileSync(masterPath);
    const crop = options.crop || await autoCrop(master, options.inset);
    const square = await squareFromCrop(master, crop);
    const smallPath = path.join(origDir, `${name}-16.png`);
    const hasSmall = options.useSmall !== false && fs.existsSync(smallPath);
    let smallSquare = null;
    if (hasSmall) {
        const small = fs.readFileSync(smallPath);
        smallSquare = await squareFromCrop(small, options.smallCrop || await autoCrop(small, options.inset));
    }
    const outDir = options.outDir ? path.resolve(options.outDir) : wmArtDir(projectRoot);
    const written = [];
    for (const s of SIZES) {
        const src = s.small && smallSquare ? smallSquare : square;
        const file = path.join(outDir, `${name}${s.suffix}.png`);
        atomicWrite(file, await renderSize(src, s.size));
        written.push(file);
    }
    let manifest = null;
    if (options.manifest !== false && !options.outDir) {
        manifest = updateManifest(projectRoot, name, { model: options.model, input: options.input, from: options.from, hasSmall });
    }
    return { name, crop, hasSmall, written, manifest, masterPath };
}

async function requestImage({ projectRoot, model, quality, prompt, files }) {
    const { apiKey, source } = appIconGenerator.resolveOpenAiKey(projectRoot);
    const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const request = { model, prompt, background: 'transparent', output_format: 'png', size: DEFAULT_SIZE, quality, n: 1 };
    let result;
    try {
        if (files.length) {
            request.image = files;
            if (!/^gpt-image-2\.[5-9]/.test(String(model))) request.input_fidelity = 'high'; // 2.5 and later reject it
            result = await client.images.edit(request);
        } else {
            result = await client.images.generate(request);
        }
    } catch (err) {
        throw new AppIconError(`Image request failed (${model}): ${err && err.message ? err.message : err}`, 'API');
    }
    const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) throw new AppIconError('Image response had no PNG data.', 'API');
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50) throw new AppIconError('Image response was not a PNG.', 'API');
    return { buffer, keySource: source };
}

/**
 * Generate the master (and with small: true, also the simplified 16 px master from it), then
 * render the WM sizes unless save === false.
 * options: { projectRoot, name, input, from, extra, references[], model, quality, small, force,
 *            save, inset, dryRun }
 */
async function generateWmIcon(options = {}) {
    const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
    const model = appIconGenerator.assertTransparentModel(options.model);
    const quality = assertQuality(options.quality, model);
    const name = artName(options.name);
    const references = Array.isArray(options.references) ? options.references : [];
    const prompt = buildWmIconPrompt({ ...options, small: false, referenceCount: references.length });
    const origDir = originalsDir(projectRoot);
    const masterPath = path.join(origDir, `${name}.png`);
    const smallPath = path.join(origDir, `${name}-16.png`);
    const smallPrompt = options.small ? buildWmIconPrompt({ input: options.input, extra: options.extra, small: true, referenceCount: 1 }) : null;

    if (options.dryRun) {
        return { dryRun: true, name, model, quality, prompt, smallPrompt, masterPath };
    }
    const skipLarge = options.smallOnly === true;
    if (!skipLarge && fs.existsSync(masterPath) && options.force !== true) {
        throw new AppIconError(`${masterPath} already exists. Pass --force to replace it, or --small-only to add the 16 px frame.`);
    }
    let keySource = null;
    if (!skipLarge) {
        const files = await referenceFiles(references);
        const got = await requestImage({ projectRoot, model, quality, prompt, files });
        atomicWrite(masterPath, got.buffer);
        keySource = got.keySource;
    } else if (!fs.existsSync(masterPath)) {
        throw new AppIconError(`--small-only needs an existing master at ${masterPath}.`);
    }
    let hasSmall = false;
    if (options.small || skipLarge) {
        const sp = smallPrompt || buildWmIconPrompt({ input: options.input, extra: options.extra, small: true, referenceCount: 1 });
        const ref = await sharp(await squareFromCrop(fs.readFileSync(masterPath), await autoCrop(fs.readFileSync(masterPath)))).resize(1024, 1024).png().toBuffer();
        const files = [await toFile(ref, `${name}.png`, { type: 'image/png' })];
        const got = await requestImage({ projectRoot, model, quality, prompt: sp, files });
        atomicWrite(smallPath, got.buffer);
        keySource = keySource || got.keySource;
        hasSmall = true;
    }
    const alpha = await appIconGenerator.alphaSummary(fs.readFileSync(masterPath));
    let saved = null;
    if (options.save !== false) {
        saved = await saveWmIcon({ projectRoot, name, inset: options.inset, model, input: options.input, from: options.from });
    }
    return { dryRun: false, name, model, quality, prompt, smallPrompt, masterPath, smallPath: hasSmall ? smallPath : null, alpha, keySource, saved };
}

module.exports = {
    TRANSPARENT_MODELS,
    DEFAULT_MODEL,
    DEFAULT_QUALITY,
    WM_INSET,
    SIZES,
    AppIconError,
    artName,
    wmArtDir,
    originalsDir,
    buildWmIconPrompt,
    bodyBox,
    autoCrop,
    squareFromCrop,
    renderSize,
    hardenAlpha,
    manifestEntries,
    updateManifest,
    saveWmIcon,
    generateWmIcon
};
