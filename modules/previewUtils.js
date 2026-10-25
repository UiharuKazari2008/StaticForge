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

module.exports = {
    generatePreview,
    generateBlurredPreview,
    generateMobilePreviews,
    STUDIO_PREVIEW_SUFFIX,
    isStudioPreviewName,
    studioPreviewNameForFile,
    ensureStudioPreview
};
