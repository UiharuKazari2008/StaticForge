/**
 * Transparent Vista / Frutiger Aero start-menu icon generation.
 * CLI: scripts/generate-app-icon.js
 * Masters land in public/static_images/app_icons and are sized by modules/appIconRuntimeAssets.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OpenAI = require('openai');
const toFile = OpenAI.toFile;
const appIconRuntimeAssets = require('./appIconRuntimeAssets');

/**
 * GPT Image models that accept background=transparent.
 * gpt-image-2 returns 400 for transparent backgrounds.
 * GPT Image 2.5 Flare and Sunburst both accept background=transparent.
 * DALL-E does not.
 */
const TRANSPARENT_MODELS = Object.freeze([
    'gpt-image-1',
    'gpt-image-1-mini',
    'gpt-image-1.5',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-flare-2026-09-08',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-sunburst-2026-09-08'
]);

const DEFAULT_MODEL = 'gpt-image-2.5-sunburst';
const DEFAULT_QUALITY = 'high';
const DEFAULT_SIZE = '1024x1024';
const QUALITIES = Object.freeze(['low', 'medium', 'high']);
const QUALITIES_25 = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const REQUEST_TIMEOUT_MS = 180000;
const MAX_REFERENCES = 8;

class AppIconError extends Error {
    constructor(message, code = 'USAGE') {
        super(message);
        this.name = 'AppIconError';
        this.code = code;
    }
}

function collapse(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildAppIconPrompt({ input, from, extra, referenceCount } = {}) {
    const subject = collapse(input);
    if (!subject) {
        throw new AppIconError('--input is required (the physical thing the icon shows).');
    }
    const replacing = collapse(from);
    const notes = collapse(extra);
    const refs = Number(referenceCount) || 0;
    const lines = [
        `Create a skeuomorphic isometric realistic 3D Windows Vista Aero icon of "${subject}".`,
        'Design language: Windows Vista, Frutiger Aero, Emirhan Avcı, and mid-2000s Microsoft business icons. Glossy glass, polished metal, fabric, and functional detail. Light, realistic, accurate proportions. Avoid cartoon and squishy shapes. Use bright yellows, blues, and greens only when the user did not specify other colors.'
    ];
    if (replacing) {
        lines.push(`It stands in for "${replacing}": communicate that same job clearly in this design language, without copying another icon's layout.`);
    } else {
        lines.push('It should clearly communicate the subject.');
    }
    lines.push(
        'One centered object or a tight still-life, three-quarter view, with enough padding to stay readable at 32 pixels.',
        'No text, letters, or numbers anywhere, including labels, signs, and markings on the object. No watermark or interface chrome.',
        'No floor, room, gradient plate, or colored backdrop. The background stays empty so the PNG alpha is transparent. A soft contact shadow may sit in that transparency under the object. The silhouette edge is clean, with no speckled fringe or halo.',
        'Keep the object itself off pure white so highlights stay silver and glass instead of blown-out white.'
    );
    if (refs > 0) {
        lines.push(`Reference images are attached in order (${refs}). They are required visual input. Match their subject, materials, and distinctive details. Do not copy their background, framing, or layout.`);
    }
    if (notes) {
        lines.push(`Required user direction, follow this even when it conflicts with the default palette, props, or reference layout: ${notes}`);
    }
    return lines.join('\n');
}

function assertReferenceCount(count) {
    const total = Number(count) || 0;
    if (!Number.isInteger(total) || total < 0) {
        throw new AppIconError('Reference images must be a list.');
    }
    if (total > MAX_REFERENCES) {
        throw new AppIconError(`Up to ${MAX_REFERENCES} reference images.`);
    }
    return total;
}

async function referenceFiles(references) {
    const list = Array.isArray(references) ? references : [];
    assertReferenceCount(list.length);
    const files = [];
    for (let i = 0; i < list.length; i++) {
        const ref = list[i];
        const buffer = ref && ref.buffer;
        if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
            throw new AppIconError(`Reference ${i + 1} is not an image.`);
        }
        const png = await sharp(buffer)
            .rotate()
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();
        const name = collapse(ref.name).replace(/[^\w.-]+/g, '_') || `reference-${i + 1}.png`;
        files.push(await toFile(png, name.endsWith('.png') ? name : `${name}.png`, { type: 'image/png' }));
    }
    return files;
}

function assertTransparentModel(model) {
    const name = collapse(model) || DEFAULT_MODEL;
    if (!TRANSPARENT_MODELS.includes(name)) {
        throw new AppIconError(
            `"${name}" is not a transparent GPT Image model. Use one of: ${TRANSPARENT_MODELS.join(', ')}.`
        );
    }
    return name;
}

function assertQuality(quality, model) {
    const name = collapse(quality) || DEFAULT_QUALITY;
    const allowed = String(model || '').startsWith('gpt-image-2.5') ? QUALITIES_25 : QUALITIES;
    if (!allowed.includes(name)) {
        throw new AppIconError(`--quality must be ${allowed.join(', ')} for ${model || 'this model'}.`);
    }
    return name;
}

function assertSize(size) {
    const name = collapse(size) || DEFAULT_SIZE;
    if (name !== DEFAULT_SIZE) {
        throw new AppIconError(`--size must be ${DEFAULT_SIZE} so the master stays square.`);
    }
    return name;
}

function iconBasename(name) {
    const base = collapse(name).toLowerCase().replace(/\.png$/i, '');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(base)) {
        throw new AppIconError('--name must be a filename of letters, numbers, "_" or "-", such as notebook.');
    }
    return `${base}.png`;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveOpenAiKey(projectRoot) {
    if (process.env.OPENAI_API_KEY) {
        return { apiKey: process.env.OPENAI_API_KEY, source: 'OPENAI_API_KEY' };
    }
    const securePath = path.join(projectRoot, 'secure.config.json');
    if (!fs.existsSync(securePath)) {
        throw new AppIconError('No OpenAI key. Set OPENAI_API_KEY or add one in secure.config.json.', 'CONFIG');
    }
    const secure = readJson(securePath);
    const keys = secure && secure.openai && Array.isArray(secure.openai.keys) ? secure.openai.keys : [];
    let index = 0;
    const configPath = path.join(projectRoot, 'config.json');
    if (fs.existsSync(configPath)) {
        const config = readJson(configPath);
        const selected = config && config.selectedApiKeys && config.selectedApiKeys.openai;
        if (Number.isInteger(selected) && selected >= 0) {
            index = selected;
        }
    }
    const chosen = keys[index] && keys[index].apiKey ? keys[index] : keys.find((entry) => entry && entry.apiKey);
    if (!chosen || !chosen.apiKey) {
        throw new AppIconError('No OpenAI key. Set OPENAI_API_KEY or add one in secure.config.json.', 'CONFIG');
    }
    return { apiKey: chosen.apiKey, source: 'secure.config.json' };
}

function atomicWrite(filePath, buffer) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, filePath);
}

const ICON_OUTPUT_SIZE = appIconRuntimeAssets.DEFAULT_SIZE;
const SAFE_INSET = 0.12;
const EDGE_ALPHA = 16;
const BODY_ALPHA = 128;

function originalsDirFor(projectRoot) {
    return path.join(appIconRuntimeAssets.getPublicIconsDir(projectRoot), 'originals');
}

function paddingFromRaw(data, width, height, minAlpha) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        const row = y * width * 4;
        for (let x = 0; x < width; x++) {
            if (data[row + x * 4 + 3] < minAlpha) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < 0) {
        return { left: 1, top: 1, right: 1, bottom: 1, empty: true };
    }
    return {
        left: minX / width,
        top: minY / height,
        right: (width - 1 - maxX) / width,
        bottom: (height - 1 - maxY) / height,
        empty: false
    };
}

async function measurePadding(buffer) {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
        width: info.width,
        height: info.height,
        edge: paddingFromRaw(data, info.width, info.height, EDGE_ALPHA),
        body: paddingFromRaw(data, info.width, info.height, BODY_ALPHA)
    };
}

async function cropAndScale(buffer, crop, outputSize = ICON_OUTPUT_SIZE) {
    const meta = await sharp(buffer).metadata();
    const side = Math.round(Number(crop && crop.size));
    const left = Math.round(Number(crop && crop.x));
    const top = Math.round(Number(crop && crop.y));
    if (!Number.isFinite(side) || !Number.isFinite(left) || !Number.isFinite(top) || side < 8) {
        throw new AppIconError('Crop needs numeric x, y, and a size of at least 8 pixels.');
    }
    const srcLeft = Math.max(0, left);
    const srcTop = Math.max(0, top);
    const srcRight = Math.min(meta.width, left + side);
    const srcBottom = Math.min(meta.height, top + side);
    const srcW = srcRight - srcLeft;
    const srcH = srcBottom - srcTop;
    let pipeline = sharp({
        create: {
            width: side,
            height: side,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    });
    if (srcW > 0 && srcH > 0) {
        const extracted = await sharp(buffer)
            .extract({ left: srcLeft, top: srcTop, width: srcW, height: srcH })
            .png()
            .toBuffer();
        pipeline = pipeline.composite([{
            input: extracted,
            left: srcLeft - left,
            top: srcTop - top
        }]);
    }
    const squared = await pipeline.png().toBuffer();
    return sharp(squared)
        .resize(outputSize, outputSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
}

async function saveFinalIcon(options = {}) {
    const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
    const filename = iconBasename(options.name);
    const mastersDir = options.mastersDir
        ? path.resolve(options.mastersDir)
        : appIconRuntimeAssets.getPublicIconsDir(projectRoot);
    const originalsDir = options.originalsDir
        ? path.resolve(options.originalsDir)
        : path.join(mastersDir, 'originals');
    const outputSize = options.outputSize || ICON_OUTPUT_SIZE;
    const sourceBuffer = options.sourceBuffer;
    if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length < 8) {
        throw new AppIconError('Missing source image.', 'CONFIG');
    }
    const originalPath = path.join(originalsDir, filename);
    let storedOriginal = false;
    if (!fs.existsSync(originalPath)) {
        atomicWrite(originalPath, sourceBuffer);
        storedOriginal = true;
    }
    const scaled = await cropAndScale(sourceBuffer, options.crop, outputSize);
    const masterPath = path.join(mastersDir, filename);
    atomicWrite(masterPath, scaled);
    let compiled = false;
    const realMasters = appIconRuntimeAssets.getPublicIconsDir(projectRoot);
    if (options.compile !== false && mastersDir === path.resolve(realMasters)) {
        const webPath = `${appIconRuntimeAssets.APP_ICONS_WEB_ROOT}/${filename}`;
        const compiledResult = await appIconRuntimeAssets.ensureCompiledForRequest(projectRoot, webPath);
        compiled = compiledResult.changed === true;
    }
    return {
        filename,
        originalPath,
        masterPath,
        outputSize,
        storedOriginal,
        compiled,
        bytes: scaled.length
    };
}

async function alphaSummary(buffer) {
    const meta = await sharp(buffer).metadata();
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    const pixels = info.width * info.height;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 16) {
            transparent += 1;
        }
    }
    return {
        width: info.width,
        height: info.height,
        hasAlpha: meta.hasAlpha === true,
        transparentRatio: pixels > 0 ? transparent / pixels : 0
    };
}

async function generateAppIcon(options = {}) {
    const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
    const model = assertTransparentModel(options.model);
    const quality = assertQuality(options.quality, model);
    const size = assertSize(options.size);
    const references = Array.isArray(options.references) ? options.references : [];
    const prompt = buildAppIconPrompt({ ...options, referenceCount: assertReferenceCount(references.length) });
    const filename = iconBasename(options.name);
    const outDir = options.outDir
        ? path.resolve(options.outDir)
        : appIconRuntimeAssets.getPublicIconsDir(projectRoot);
    const filePath = path.join(outDir, filename);
    const mastersDir = appIconRuntimeAssets.getPublicIconsDir(projectRoot);
    const compile = options.compile !== false && path.resolve(outDir) === path.resolve(mastersDir);

    if (options.dryRun) {
        return { dryRun: true, model, quality, size, prompt, path: filePath, filename };
    }

    if (fs.existsSync(filePath) && options.force !== true) {
        throw new AppIconError(`${filePath} already exists. Pass --force to replace it.`);
    }

    const { apiKey, source } = resolveOpenAiKey(projectRoot);
    const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const files = await referenceFiles(references);
    let result;
    try {
        const request = {
            model,
            prompt,
            background: 'transparent',
            output_format: 'png',
            size,
            quality,
            n: 1
        };
        if (files.length) {
            request.image = files;
            request.input_fidelity = 'high';
            result = await client.images.edit(request);
        } else {
            result = await client.images.generate(request);
        }
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        throw new AppIconError(
            `Image request failed (${model}): ${message}. If this model rejected transparency, retry with --model ${DEFAULT_MODEL}.`,
            'API'
        );
    }

    const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) {
        throw new AppIconError('Image response had no PNG data.', 'API');
    }
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50) {
        throw new AppIconError('Image response was not a PNG.', 'API');
    }

    atomicWrite(filePath, buffer);
    const alpha = await alphaSummary(buffer);
    let compiled = false;
    if (compile) {
        const webPath = `${appIconRuntimeAssets.APP_ICONS_WEB_ROOT}/${filename}`;
        const compiledResult = await appIconRuntimeAssets.ensureCompiledForRequest(projectRoot, webPath);
        compiled = compiledResult.changed === true;
    }

    return {
        dryRun: false,
        model,
        quality,
        size,
        prompt,
        path: filePath,
        filename,
        bytes: buffer.length,
        keySource: source,
        referenceCount: files.length,
        background: result.background || null,
        alpha,
        compiled
    };
}

module.exports = {
    TRANSPARENT_MODELS,
    DEFAULT_MODEL,
    DEFAULT_QUALITY,
    DEFAULT_SIZE,
    MAX_REFERENCES,
    AppIconError,
    buildAppIconPrompt,
    assertReferenceCount,
    assertTransparentModel,
    iconBasename,
    resolveOpenAiKey,
    ICON_OUTPUT_SIZE,
    SAFE_INSET,
    originalsDirFor,
    measurePadding,
    cropAndScale,
    saveFinalIcon,
    alphaSummary,
    generateAppIcon
};
