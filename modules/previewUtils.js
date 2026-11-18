const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { encodeBlurhashFromBuffer } = require('./blurhashUtils');

// Generate a preview for an image
async function generatePreview(imagePath, previewPath) {
    try {
        await sharp(imagePath)
            .resize(256, 256, { fit: 'cover' })
            .jpeg({ quality: 70 })
            .toFile(previewPath);
        return true;
    } catch (e) {
        console.error('Failed to generate preview for', imagePath, e.message);
        return false;
    }
}

/**
 * @deprecated @blur.webp removed — use blurhash via encodeBlurhashFromBuffer / generateMobilePreviews
 */
async function generateBlurredPreview() {
    return false;
}

/**
 * Generate main / @2x / @lq previews and a BlurHash string (replaces @blur.webp).
 * @returns {Promise<{ ok: boolean, blurhash: string|null }>}
 */
async function generateMobilePreviews(imagePath, basename) {
    if (!imagePath || !basename) {
        console.error('generateMobilePreviews: Missing required parameters');
        return { ok: false, blurhash: null };
    }

    if (!fs.existsSync(imagePath)) {
        console.error('generateMobilePreviews: Source image does not exist:', imagePath);
        return { ok: false, blurhash: null };
    }

    try {
        const previewsDir = path.resolve(__dirname, '../.previews');

        const mainPreviewPath = path.join(previewsDir, `${basename}.webp`);
        const retinaPreviewPath = path.join(previewsDir, `${basename}@2x.webp`);
        const lowQualityPreviewPath = path.join(previewsDir, `${basename}@lq.webp`);

        const metadata = await sharp(imagePath).metadata();
        const { width, height } = metadata;

        if (!width || !height) {
            console.error('generateMobilePreviews: Invalid image metadata for', imagePath);
            return { ok: false, blurhash: null };
        }

        let newWidth;
        let newHeight;
        if (width > height) {
            newWidth = 128;
            newHeight = Math.round((height * 128) / width);
        } else {
            newHeight = 128;
            newWidth = Math.round((width * 128) / height);
        }

        const image = sharp(imagePath, {
            failOnError: false,
            unlimited: true,
            sequentialRead: true,
            density: 72
        });

        const qualitySettings = {
            high: { quality: 70, effort: 4 },
            low: { quality: 40, effort: 2 }
        };

        const commonWebPOptions = {
            smartSubsample: true,
            reductionEffort: 3
        };

        const commonResizeOptions = {
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
            fastShrinkOnLoad: true
        };

        const blurhashPromise = encodeBlurhashFromBuffer(imagePath);

        const previewPromises = [
            image.clone()
                .resize(512, 512, {
                    fit: 'cover',
                    ...commonResizeOptions
                })
                .webp({
                    ...qualitySettings.high,
                    ...commonWebPOptions
                })
                .toFile(retinaPreviewPath),

            image.clone()
                .resize(256, 256, {
                    fit: 'cover',
                    ...commonResizeOptions
                })
                .webp({
                    ...qualitySettings.high,
                    ...commonWebPOptions
                })
                .toFile(mainPreviewPath),

            image.clone()
                .resize(newWidth, newHeight, {
                    fit: 'inside',
                    ...commonResizeOptions
                })
                .webp({
                    ...qualitySettings.low,
                    ...commonWebPOptions
                })
                .toFile(lowQualityPreviewPath)
        ];

        // the picture in its own proportions for Melaton Mobile's Pictures & Videos cells (#788),
        // named after the file like the Studio preview
        previewPromises.push(image.clone()
            .resize(FIT_PREVIEW_EDGE, FIT_PREVIEW_EDGE, { fit: 'inside', ...commonResizeOptions })
            .webp({ quality: 72, effort: 2 })
            .toFile(path.join(previewsDir, fitPreviewNameForFile(imagePath))));

        const [previewResults, blurhash] = await Promise.all([
            Promise.allSettled(previewPromises),
            blurhashPromise
        ]);

        const failures = previewResults.filter((result) => result.status === 'rejected');
        if (failures.length > 0) {
            console.error(`Failed to generate ${failures.length} previews for ${basename}:`,
                failures.map((f) => f.reason?.message || 'Unknown error').join(', '));
            return { ok: false, blurhash: blurhash || null };
        }

        return { ok: true, blurhash: blurhash || null };
    } catch (e) {
        console.error('Failed to generate mobile previews for', imagePath, ':', e.message);
        return { ok: false, blurhash: null };
    }
}

// Studio preview: the gallery file as an optimised WebP at its own pixel size (no metadata), so
// Studio shows it without downloading the PNG; opening it still loads /images/ (Yozora #648).
// Named after the file, not the base: an original and its _upscaled share a base name.
const STUDIO_PREVIEW_SUFFIX = '@studio.webp';
const STUDIO_PREVIEW_SOURCE_EXTS = ['.png', '.jpg', '.jpeg'];
const studioPreviewJobs = new Map();

function isStudioPreviewName(name) {
    return typeof name === 'string' && name.endsWith(STUDIO_PREVIEW_SUFFIX);
}

function studioPreviewNameForFile(filename) {
    return `${path.basename(filename).replace(/\.(png|jpe?g)$/i, '')}${STUDIO_PREVIEW_SUFFIX}`;
}

async function statOrNullAsync(p) {
    try { return await fs.promises.stat(p); } catch (_) { return null; }
}

/**
 * Make sure previewsDir/<stem>@studio.webp exists and is not older than its source in imagesDir.
 * @returns {Promise<string|null>} the WebP path, or null when there is no source image
 */
async function ensureStudioPreview(imagesDir, previewsDir, previewName) {
    if (!isStudioPreviewName(previewName)) return null;
    const name = path.basename(previewName);
    const stem = name.slice(0, -STUDIO_PREVIEW_SUFFIX.length);
    if (!stem) return null;
    let sourcePath = null;
    let sourceStat = null;
    for (const ext of STUDIO_PREVIEW_SOURCE_EXTS) {
        const candidate = path.join(imagesDir, `${stem}${ext}`);
        const st = await statOrNullAsync(candidate);
        if (st && st.isFile()) { sourcePath = candidate; sourceStat = st; break; }
    }
    if (!sourcePath) return null;
    const outPath = path.join(previewsDir, name);
    const outStat = await statOrNullAsync(outPath);
    if (outStat && outStat.isFile() && outStat.size > 0 && outStat.mtimeMs >= sourceStat.mtimeMs) return outPath;

    // One encode per file; concurrent requests wait for it
    if (studioPreviewJobs.has(outPath)) return studioPreviewJobs.get(outPath);
    const job = (async () => {
        const tmpPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;
        try {
            // effort 2: within ~2% of effort 4's size at a third of the time (1024² ~0.1 s, 4096² ~1.2 s)
            await sharp(sourcePath)
                .webp({ quality: 85, effort: 2 })
                .toFile(tmpPath);
            await fs.promises.rename(tmpPath, outPath);
            return outPath;
        } catch (e) {
            fs.promises.unlink(tmpPath).catch(() => {});
            console.error('Failed to generate Studio preview for', sourcePath, ':', e.message);
            return null;
        }
    })().finally(() => studioPreviewJobs.delete(outPath));
    studioPreviewJobs.set(outPath, job);
    return job;
}

// Fit preview (#788): the gallery file at most 320 px on its long side in its own proportions,
// for Melaton Mobile's Pictures & Videos (WM fits each picture into its cell, never crops it).
// Made with new prints (generateMobilePreviews) and, for older ones, on first request.
const FIT_PREVIEW_SUFFIX = '@fit.webp';
const FIT_PREVIEW_EDGE = 320;

function isFitPreviewName(name) {
    return typeof name === 'string' && name.endsWith(FIT_PREVIEW_SUFFIX);
}

function fitPreviewNameForFile(filename) {
    return `${path.basename(filename).replace(/\.(png|jpe?g|webp)$/i, '')}${FIT_PREVIEW_SUFFIX}`;
}

// at most two encodes at once: a phone opening a large gallery must not starve the server
const FIT_CONCURRENCY = 2;
const FIT_WAIT_MS = 1500;
const fitJobs = new Map();
const fitWaiting = [];
let fitRunning = 0;
function fitSlot() {
    return new Promise((resolve) => {
        const grant = () => {
            fitRunning++;
            let done = false;
            resolve(() => {
                if (done) return;
                done = true;
                fitRunning--;
                const next = fitWaiting.shift();
                if (next) next();
            });
        };
        if (fitRunning < FIT_CONCURRENCY) grant(); else fitWaiting.push(grant);
    });
}

/** The gallery file a fit preview is made from: { path, stat } or null. */
async function fitPreviewSource(imagesDir, previewName) {
    if (!isFitPreviewName(previewName)) return null;
    const stem = path.basename(previewName).slice(0, -FIT_PREVIEW_SUFFIX.length);
    if (!stem) return null;
    for (const ext of [...STUDIO_PREVIEW_SOURCE_EXTS, '.webp']) {
        const candidate = path.join(imagesDir, `${stem}${ext}`);
        const st = await statOrNullAsync(candidate);
        if (st && st.isFile()) return { path: candidate, stat: st };
    }
    return null;
}

async function ensureFitPreview(imagesDir, previewsDir, previewName, opts) {
    if (!isFitPreviewName(previewName)) return null;
    const name = path.basename(previewName);
    const source = await fitPreviewSource(imagesDir, name);
    if (!source) return null;
    const sourcePath = source.path;
    const sourceStat = source.stat;
    const outPath = path.join(previewsDir, name);
    const outStat = await statOrNullAsync(outPath);
    if (outStat && outStat.isFile() && outStat.size > 0 && outStat.mtimeMs >= sourceStat.mtimeMs) return outPath;
    let job = fitJobs.get(outPath);
    if (!job) {
        job = fitSlot().then(async (release) => {
            const tmpPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;
            try {
                await sharp(sourcePath, { failOnError: false })
                    .resize(FIT_PREVIEW_EDGE, FIT_PREVIEW_EDGE, { fit: 'inside', withoutEnlargement: true, fastShrinkOnLoad: true })
                    .webp({ quality: 72, effort: 2 })
                    .toFile(tmpPath);
                await fs.promises.rename(tmpPath, outPath);
                return outPath;
            } catch (e) {
                fs.promises.unlink(tmpPath).catch(() => {});
                console.error('Failed to generate fit preview for', sourcePath, ':', e.message);
                return null;
            } finally { release(); }
        }).finally(() => fitJobs.delete(outPath));
        fitJobs.set(outPath, job);
    }
    // a grid asks for a hundred at once: a request waits a moment, then the client shows the square
    // preview and the fit one is there next time (the encode carries on)
    if (!opts || opts.wait !== false) {
        const timer = new Promise((resolve) => setTimeout(() => resolve(null), FIT_WAIT_MS).unref());
        return Promise.race([job, timer]);
    }
    return job;
}

// Lossless preview (#890 P14): the gallery PNG as a lossless WebP (the same pixels, alpha kept; about a
// third smaller), for the screen saver, which shows originals. <stem>@ll.webp, made from images/<stem>.png
// on the first request (the request waits for it) and kept like the other previews; a PNG it cannot
// copy exactly (16-bit, or one with an embedded colour profile sharp would convert) gets no
// lossless copy, so the request is a 404 and the page loads the PNG as before.
const LOSSLESS_PREVIEW_SUFFIX = '@ll.webp';
// an encode is CPU-bound (~1.2 s per megapixel at effort 4): one at a time, never starving the server
const LOSSLESS_CONCURRENCY = 1;
// past this many pixels (an upscale) the fastest effort: ~0.5 s per megapixel, still lossless
const LOSSLESS_FAST_PIXELS = 4.2e6;
const losslessJobs = new Map();
const losslessWaiting = [];
let losslessRunning = 0;
// PNGs found unfit for an exact copy (16-bit, a colour profile, unreadable), by path -> mtimeMs: the
// screen saver asks for the same picture every time it comes round, answered at once instead of a
// metadata read each time; a changed file (new mtime) is looked at again
const losslessRefused = new Map();
const LOSSLESS_REFUSED_MAX = 5000;

function refuseLossless(sourcePath, mtimeMs) {
    losslessRefused.delete(sourcePath);
    losslessRefused.set(sourcePath, mtimeMs);
    if (losslessRefused.size > LOSSLESS_REFUSED_MAX) losslessRefused.delete(losslessRefused.keys().next().value);
}

function isLosslessPreviewName(name) {
    return typeof name === 'string' && name.endsWith(LOSSLESS_PREVIEW_SUFFIX);
}

function losslessPreviewNameForFile(filename) {
    return `${path.basename(filename).replace(/\.png$/i, '')}${LOSSLESS_PREVIEW_SUFFIX}`;
}

function losslessSlot() {
    return new Promise((resolve) => {
        const grant = () => {
            losslessRunning++;
            let done = false;
            resolve(() => {
                if (done) return;
                done = true;
                losslessRunning--;
                const next = losslessWaiting.shift();
                if (next) next();
            });
        };
        if (losslessRunning < LOSSLESS_CONCURRENCY) grant(); else losslessWaiting.push(grant);
    });
}

/**
 * Make sure previewsDir/<stem>@ll.webp exists and is not older than images/<stem>.png.
 * @returns {Promise<string|null>} the WebP path, or null (no PNG, or one that cannot be copied exactly)
 */
async function ensureLosslessPreview(imagesDir, previewsDir, previewName) {
    if (!isLosslessPreviewName(previewName)) return null;
    const name = path.basename(previewName);
    const stem = name.slice(0, -LOSSLESS_PREVIEW_SUFFIX.length);
    if (!stem) return null;
    const sourcePath = path.join(imagesDir, `${stem}.png`);
    const sourceStat = await statOrNullAsync(sourcePath);
    if (!sourceStat || !sourceStat.isFile()) return null;
    const outPath = path.join(previewsDir, name);
    const outStat = await statOrNullAsync(outPath);
    if (outStat && outStat.isFile() && outStat.size > 0 && outStat.mtimeMs >= sourceStat.mtimeMs) return outPath;
    if (losslessRefused.get(sourcePath) === sourceStat.mtimeMs) return null;
    let job = losslessJobs.get(outPath);
    if (!job) {
        job = (async () => {
            // the header read happens before the encode slot: a refused PNG never waits behind an encode
            let meta;
            try {
                meta = await sharp(sourcePath).metadata();
            } catch (e) {
                refuseLossless(sourcePath, sourceStat.mtimeMs);
                console.error('Failed to read', sourcePath, 'for a lossless preview:', e.message);
                return null;
            }
            // 8 bits per channel and no colour profile: the WebP holds exactly the PNG's pixels
            if (meta.depth !== 'uchar' || meta.icc || !meta.width || !meta.height) {
                refuseLossless(sourcePath, sourceStat.mtimeMs);
                return null;
            }
            const effort = meta.width * meta.height > LOSSLESS_FAST_PIXELS ? 0 : 4;
            const release = await losslessSlot();
            const tmpPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;
            try {
                await sharp(sourcePath).webp({ lossless: true, effort }).toFile(tmpPath);
                await fs.promises.rename(tmpPath, outPath);
                return outPath;
            } catch (e) {
                // not remembered: a full disk or a file mid-write may succeed next time
                fs.promises.unlink(tmpPath).catch(() => {});
                console.error('Failed to generate lossless preview for', sourcePath, ':', e.message);
                return null;
            } finally { release(); }
        })().finally(() => losslessJobs.delete(outPath));
        losslessJobs.set(outPath, job);
    }
    return job;
}

/**
 * The gallery base name a previews/*.webp file belongs to, for the boot orphan sweep (syncPreviews): the
 * Studio, fit and lossless previews are named after the file (<stem>[_upscaled]@studio|fit|ll.webp), the
 * others after the base (<base>.webp, @lq, @2x). null: not a preview name.
 */
function previewSweepBase(preview) {
    const name = String(preview || '');
    if (/@(studio|fit|ll)\.webp$/.test(name)) return name.replace(/@(studio|fit|ll)\.webp$/, '').replace(/_upscaled$/, '');
    if (name.endsWith('@lq.webp')) return name.replace(/@lq\.webp$/, '');
    if (name.endsWith('@2x.webp')) return name.replace(/@2x\.webp$/, '');
    if (name.endsWith('.webp')) return name.replace(/\.webp$/, '');
    return null;
}

/**
 * A preview encode's temp file (<preview>.webp.<pid>.<ms>.tmp, every generator here) left by a process
 * that stopped mid-encode. The current process's own are in progress, never stale.
 */
function isStalePreviewTmp(name, pid = process.pid) {
    const m = /\.webp\.(\d+)\.\d+\.tmp$/.exec(String(name || ''));
    return !!m && Number(m[1]) !== pid;
}

module.exports = {
    LOSSLESS_PREVIEW_SUFFIX,
    isLosslessPreviewName,
    losslessPreviewNameForFile,
    ensureLosslessPreview,
    isStalePreviewTmp,
    previewSweepBase,
    FIT_PREVIEW_SUFFIX,
    isFitPreviewName,
    fitPreviewNameForFile,
    fitPreviewSource,
    ensureFitPreview,
    generatePreview,
    generateBlurredPreview,
    generateMobilePreviews,
    STUDIO_PREVIEW_SUFFIX,
    isStudioPreviewName,
    studioPreviewNameForFile,
    ensureStudioPreview
};
