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

module.exports = {
    generatePreview,
    generateBlurredPreview,
    generateMobilePreviews
};
