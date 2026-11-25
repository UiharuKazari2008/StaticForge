/**
 * MCP image compare (same-seed pixel diff) and workspace theme frequency.
 */

const sharp = require('sharp');

const DIFF_THRESHOLD = 12;
const AMPLIFY = 3;
const THEME_SAMPLE_MAX = 120;
const OVERUSED_SHARE = 0.25;

const COMPARE_MAX_SIDE = 2048;
const PANEL_MAX_W = 640;
const PANEL_MAX_H = 640;

async function loadPadded(file, width, height) {
    // fit inside the shared canvas, centred; padding stays alpha 0 (never stretched)
    return sharp(file)
        .rotate()
        .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .raw()
        .toBuffer();
}

function changedRegions(mask, width, height, limit) {
    const cell = Math.max(8, Math.round(Math.max(width, height) / 96));
    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    const counts = new Uint32Array(cols * rows);
    for (let y = 0; y < height; y++) {
        const row = Math.floor(y / cell) * cols;
        for (let x = 0; x < width; x++) {
            if (mask[y * width + x]) counts[row + Math.floor(x / cell)] += 1;
        }
    }
    const hot = new Uint8Array(cols * rows);
    const minHits = Math.max(2, Math.round(cell * cell * 0.02));
    for (let i = 0; i < hot.length; i++) hot[i] = counts[i] >= minHits ? 1 : 0;
    const seen = new Uint8Array(hot.length);
    const regions = [];
    const total = width * height;
    for (let start = 0; start < hot.length; start++) {
        if (!hot[start] || seen[start]) continue;
        const stack = [start];
        seen[start] = 1;
        let minC = cols, maxC = 0, minR = rows, maxR = 0, hits = 0;
        while (stack.length) {
            const idx = stack.pop();
            const c = idx % cols;
            const r = (idx - c) / cols;
            hits += counts[idx];
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const nc = c + dc;
                    const nr = r + dr;
                    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
                    const ni = nr * cols + nc;
                    if (hot[ni] && !seen[ni]) {
                        seen[ni] = 1;
                        stack.push(ni);
                    }
                }
            }
        }
        const x0 = minC * cell;
        const y0 = minR * cell;
        const x1 = Math.min(width, (maxC + 1) * cell);
        const y1 = Math.min(height, (maxR + 1) * cell);
        regions.push({
            hits,
            box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
            xPercent: Number((100 * x0 / width).toFixed(1)),
            yPercent: Number((100 * y0 / height).toFixed(1)),
            wPercent: Number((100 * (x1 - x0) / width).toFixed(1)),
            hPercent: Number((100 * (y1 - y0) / height).toFixed(1)),
            changedPercentOfImage: Number((100 * hits / total).toFixed(2))
        });
    }
    regions.sort((l, r) => r.hits - l.hits);
    return regions.slice(0, limit).map((row, i) => {
        const { hits, ...rest } = row;
        return { rank: i + 1, changedPixels: hits, ...rest };
    });
}

async function sidePanel(raw, width, height, scale, boxes) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    let img = sharp(raw, { raw: { width, height, channels: 4 } }).resize(w, h, { fit: 'fill' });
    if (boxes && boxes.length) {
        const rects = boxes.map((r) => `<rect x="${Math.round(r.box.x * scale)}" y="${Math.round(r.box.y * scale)}" width="${Math.round(r.box.w * scale)}" height="${Math.round(r.box.h * scale)}" fill="none" stroke="#ffe000" stroke-width="2"/>`
            + `<text x="${Math.round(r.box.x * scale) + 3}" y="${Math.round(r.box.y * scale) + 14}" font-size="13" font-family="sans-serif" fill="#ffe000">${r.rank}</text>`).join('');
        img = img.composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`) }]);
    }
    return { buffer: await img.png().toBuffer(), w, h };
}

async function compareImageFiles(pathA, pathB, options) {
    const opts = options || {};
    const metaA = await sharp(pathA).rotate().metadata();
    const metaB = await sharp(pathB).rotate().metadata();
    const dimA = { w: metaA.width || 0, h: metaA.height || 0 };
    const dimB = { w: metaB.width || 0, h: metaB.height || 0 };
    // (rotate() metadata keeps raw size; swap for EXIF 5-8)
    if (metaA.orientation >= 5) [dimA.w, dimA.h] = [dimA.h, dimA.w];
    if (metaB.orientation >= 5) [dimB.w, dimB.h] = [dimB.h, dimB.w];
    if (!dimA.w || !dimA.h || !dimB.w || !dimB.h) {
        const err = new Error('Could not read image dimensions');
        err.status = 400;
        throw err;
    }
    let width = Math.max(dimA.w, dimB.w);
    let height = Math.max(dimA.h, dimB.h);
    const cap = Math.max(width, height) > COMPARE_MAX_SIDE ? COMPARE_MAX_SIDE / Math.max(width, height) : 1;
    width = Math.max(1, Math.round(width * cap));
    height = Math.max(1, Math.round(height * cap));

    const rawA = await loadPadded(pathA, width, height);
    const rawB = await loadPadded(pathB, width, height);
    const diff = Buffer.alloc(rawA.length);
    const mask = new Uint8Array(width * height);
    let changed = 0;
    let sum = 0;
    let compared = 0;
    for (let p = 0, i = 0; i < rawA.length; i += 4, p++) {
        if (rawA[i + 3] < 128 || rawB[i + 3] < 128) {
            // padded in one of the two: not compared, shown dark grey
            diff[i] = 40; diff[i + 1] = 40; diff[i + 2] = 40; diff[i + 3] = 255;
            continue;
        }
        compared += 1;
        const dr = Math.abs(rawA[i] - rawB[i]);
        const dg = Math.abs(rawA[i + 1] - rawB[i + 1]);
        const db = Math.abs(rawA[i + 2] - rawB[i + 2]);
        const mag = Math.max(dr, dg, db);
        const amplified = Math.min(255, mag * AMPLIFY);
        diff[i] = amplified;
        diff[i + 1] = 0;
        diff[i + 2] = amplified;
        diff[i + 3] = 255;
        if (mag > DIFF_THRESHOLD) {
            changed += 1;
            mask[p] = 1;
        }
        sum += (dr + dg + db) / 3;
    }
    const pixels = width * height;
    const denom = compared || 1;
    const regions = changedRegions(mask, width, height, Math.max(1, Math.min(20, Number(opts.regions) || 8)));

    const scale = Math.min(1, PANEL_MAX_W / width, PANEL_MAX_H / height);
    const flat = (raw) => {
        const out = Buffer.from(raw);
        for (let i = 3; i < out.length; i += 4) out[i] = 255;
        return out;
    };
    const [pa, pd, pb] = await Promise.all([
        sidePanel(flat(rawA), width, height, scale, regions),
        sidePanel(diff, width, height, scale, regions),
        sidePanel(flat(rawB), width, height, scale, regions)
    ]);
    const gap = 6;
    const montageW = pa.w + pd.w + pb.w + gap * 2;
    const bytes = await sharp({ create: { width: montageW, height: pa.h, channels: 3, background: '#202020' } })
        .composite([
            { input: pa.buffer, left: 0, top: 0 },
            { input: pd.buffer, left: pa.w + gap, top: 0 },
            { input: pb.buffer, left: pa.w + pd.w + gap * 2, top: 0 }
        ])
        .webp({ quality: 85 })
        .toBuffer();

    const paddedA = !(dimA.w === Math.round(width / cap) && dimA.h === Math.round(height / cap));
    const paddedB = !(dimB.w === Math.round(width / cap) && dimB.h === Math.round(height / cap));
    return {
        width,
        height,
        pixels,
        sizeA: `${dimA.w}x${dimA.h}`,
        sizeB: `${dimB.w}x${dimB.h}`,
        padded: (paddedA || paddedB)
            ? `Sizes differ: the smaller image sits centred on a ${width}x${height} canvas (aspect kept, nothing stretched); padded area is not counted (${Number((100 * (pixels - compared) / pixels).toFixed(1))}% of the canvas).`
            : undefined,
        downscaledTo: cap < 1 ? `${width}x${height}` : undefined,
        changedPixels: changed,
        changedPercent: Number(((100 * changed) / denom).toFixed(2)),
        meanDelta: Number((sum / denom).toFixed(2)),
        regions,
        layout: 'one image: A | difference (magenta) | B, regions boxed in yellow and numbered by size',
        image: { mimeType: 'image/webp', bytes, filename: 'mcp-compare.webp' }
    };
}

function parseRegion(input, width, height) {
    const raw = input && (input.region || input.box);
    if (!raw || typeof raw !== 'object') return { left: 0, top: 0, width, height };
    const unit = String(raw.unit || (Number(raw.x) <= 1 && Number(raw.w) <= 1 && Number(raw.y) <= 1 && Number(raw.h) <= 1 ? 'fraction' : 'px')).toLowerCase();
    let [x, y, w, h] = [Number(raw.x) || 0, Number(raw.y) || 0, Number(raw.w ?? raw.width) || 0, Number(raw.h ?? raw.height) || 0];
    if (unit === 'fraction') { x *= width; y *= height; w *= width; h *= height; }
    else if (unit === 'percent') { x *= width / 100; y *= height / 100; w *= width / 100; h *= height / 100; }
    x = Math.max(0, Math.min(width - 1, Math.round(x)));
    y = Math.max(0, Math.min(height - 1, Math.round(y)));
    w = Math.max(1, Math.min(width - x, Math.round(w) || width - x));
    h = Math.max(1, Math.min(height - y, Math.round(h) || height - y));
    return { left: x, top: y, width: w, height: h };
}

async function dHash(file) {
    const raw = await sharp(file).rotate().flatten({ background: '#fff' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
    return bits;
}

function hashDistance(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d += 1;
    return d;
}

async function dominantColors(buffer, count) {
    const raw = await sharp(buffer).flatten({ background: '#fff' }).resize(48, 48, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const bins = new Map();
    const ch = raw.info.channels;
    for (let i = 0; i < raw.data.length; i += ch) {
        const key = ((raw.data[i] >> 5) << 6) | ((raw.data[i + 1] >> 5) << 3) | (raw.data[i + 2] >> 5);
        const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        bin.n += 1; bin.r += raw.data[i]; bin.g += raw.data[i + 1]; bin.b += raw.data[i + 2];
        bins.set(key, bin);
    }
    const total = raw.data.length / ch;
    return [...bins.values()].sort((l, r) => r.n - l.n).slice(0, count).map((bin) => {
        const hex = [bin.r, bin.g, bin.b].map((v) => Math.round(v / bin.n).toString(16).padStart(2, '0')).join('');
        return { hex: `#${hex}`, percent: Number((100 * bin.n / total).toFixed(1)) };
    });
}

/**
 * image_inspect for one resolved file. mode: crop | stats | ocr.
 * ("similar" needs a gallery list and lives in the facade, on dHash/hashDistance.)
 */
async function inspectImageFile(file, mode, input) {
    const meta = await sharp(file).rotate().metadata();
    const swap = meta.orientation >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;
    const region = parseRegion(input, width, height);
    const base = sharp(file).rotate().extract(region);
    if (mode === 'crop') {
        const zoom = Math.max(0.1, Math.min(8, Number(input && input.zoom) || 0));
        const target = Math.max(64, Math.min(1536, Number(input && input.maxSide) || 1024));
        let out = base;
        let ow = region.width;
        let oh = region.height;
        const fitScale = zoom || Math.min(4, target / Math.max(region.width, region.height));
        ow = Math.max(1, Math.round(region.width * fitScale));
        oh = Math.max(1, Math.round(region.height * fitScale));
        if (Math.max(ow, oh) > 2048) { const k = 2048 / Math.max(ow, oh); ow = Math.round(ow * k); oh = Math.round(oh * k); }
        out = out.resize(ow, oh, { fit: 'fill', kernel: 'lanczos3' });
        const bytes = await out.webp({ quality: 90 }).toBuffer();
        return { meta: { mode, source: `${width}x${height}`, region, output: `${ow}x${oh}` }, image: { mimeType: 'image/webp', bytes, filename: 'mcp-crop.webp' } };
    }
    if (mode === 'stats') {
        const png = await base.clone().png().toBuffer();
        const st = await sharp(png).stats();
        const [r, g, b] = st.channels;
        const luma = 0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean;
        const gcd = (a, c) => (c ? gcd(c, a % c) : a);
        const dv = gcd(width, height);
        return {
            meta: {
                mode,
                width, height,
                aspectRatio: Number((width / height).toFixed(4)),
                aspect: `${width / dv}:${height / dv}`,
                megapixels: Number((width * height / 1e6).toFixed(2)),
                format: meta.format,
                hasAlpha: !!meta.hasAlpha,
                region,
                regionBrightness: Number((luma / 2.55).toFixed(1)),
                regionMean: { r: Math.round(r.mean), g: Math.round(g.mean), b: Math.round(b.mean) },
                regionStdDev: { r: Math.round(r.stdev), g: Math.round(g.stdev), b: Math.round(b.stdev) },
                regionRange: { min: Math.min(r.min, g.min, b.min), max: Math.max(r.max, g.max, b.max) },
                dominantColors: await dominantColors(png, Math.max(1, Math.min(10, Number(input && input.colors) || 5)))
            }
        };
    }
    if (mode === 'ocr') {
        let createWorker;
        try {
            ({ createWorker } = require('tesseract.js'));
        } catch (_) {
            const err = new Error('OCR is not installed on this server (tesseract.js missing)');
            err.status = 501;
            throw err;
        }
        const png = await base.clone().flatten({ background: '#fff' }).resize({ width: Math.min(3000, Math.max(region.width, 1200)), withoutEnlargement: false }).png().toBuffer();
        const worker = await createWorker(String((input && input.lang) || 'eng'));
        try {
            const res = await worker.recognize(png);
            const data = res.data || {};
            return {
                meta: {
                    mode, region,
                    text: String(data.text || '').trim(),
                    confidence: Number(data.confidence) || 0,
                    words: (data.words || []).slice(0, 80).map((w) => ({ text: w.text, confidence: Math.round(w.confidence) }))
                }
            };
        } finally {
            await worker.terminate().catch(() => {});
        }
    }
    const err = new Error(`Unknown mode ${mode}`);
    err.status = 400;
    throw err;
}

function splitPromptTags(text) {
    return String(text || '')
        .split(/[,\n]/)
        .map((part) => part.replace(/[{}[\]()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((part) => part.length >= 3 && part.length <= 80);
}

function metadataPromptBlob(row) {
    const meta = row && (row.metadata || row);
    const forge = (meta && meta.forge_data) || {};
    const parts = [
        meta && meta.prompt,
        forge.input_prompt,
        Array.isArray(forge.characterNames) ? forge.characterNames.join(', ') : '',
        Array.isArray(forge.allCharacters)
            ? forge.allCharacters.map((ch) => (ch && (ch.chara_name || ch.prompt)) || '').join(', ')
            : ''
    ];
    return parts.filter(Boolean).join(', ');
}

function countFrequencies(items) {
    const counts = new Map();
    items.forEach((item) => {
        counts.set(item, (counts.get(item) || 0) + 1);
    });
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count }));
}

function evaluateThemeRows(rows) {
    const sample = Array.isArray(rows) ? rows.slice(0, THEME_SAMPLE_MAX) : [];
    const n = sample.length;
    const characterHits = [];
    const tagHits = [];

    sample.forEach((row) => {
        const meta = row && (row.metadata || row);
        const forge = (meta && meta.forge_data) || {};
        const names = Array.isArray(forge.characterNames) ? forge.characterNames : [];
        names.forEach((name) => {
            const cleaned = String(name || '').trim().toLowerCase();
            if (cleaned) characterHits.push(cleaned);
        });
        splitPromptTags(metadataPromptBlob(row)).forEach((tag) => tagHits.push(tag));
    });

    const characters = countFrequencies(characterHits);
    const tags = countFrequencies(tagHits);
    const overusedCharacters = characters.filter((row) => n > 0 && row.count / n >= OVERUSED_SHARE);
    const overusedTags = tags.filter((row) => n > 0 && row.count / n >= OVERUSED_SHARE).slice(0, 16);

    return {
        success: true,
        sample: n,
        overusedCharacters,
        overusedTags,
        topCharacters: characters.slice(0, 12),
        topTags: tags.slice(0, 20),
        suggestions: {
            characters: overusedCharacters.length
                ? 'Those character names dominate this folder. Try a new subject or swap the lead.'
                : 'No single character is dominating. You can still introduce a new lead.',
            scenes: 'If backgrounds and locations repeat in the overused tags, change the setting (indoors/outdoors, time of day, weather).',
            kinks: 'If the same pose / clothing / fetish tags sit in the overused list, drop two of them and add one you have not used in this sample.'
        }
    };
}

module.exports = {
    DIFF_THRESHOLD,
    compareImageFiles,
    inspectImageFile,
    dHash,
    hashDistance,
    splitPromptTags,
    evaluateThemeRows,
    metadataPromptBlob
};
