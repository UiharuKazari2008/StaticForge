/**
 * Shared BlurHash backfill helpers (DB only — never rewrite PNG file metadata).
 * Used by boot syncPreviews and scripts/tools/backfill-blurhash.js.
 */
const fs = require('fs');
const path = require('path');
const { encodeBlurhashFromFile, encodeBlurhashFromBuffer } = require('./blurhashUtils');

const DEFAULT_BATCH = 200;
const DEFAULT_CONCURRENCY = 4;

function getBaseName(filename) {
    return String(filename || '')
        .replace(/\.(png|jpg|jpeg|webp)$/i, '')
        .replace(/_upscaled$/i, '');
}

async function mapPool(items, limitN, mapper) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            out[i] = await mapper(items[i], i);
        }
    }
    const workers = Array.from({ length: Math.min(limitN, items.length || 1) }, () => worker());
    await Promise.all(workers);
    return out;
}

async function encodeGalleryBlurhash(filename, { imagesDir, previewsDir }) {
    const base = getBaseName(filename);
    const previewPath = path.join(previewsDir, `${base}.webp`);
    if (fs.existsSync(previewPath)) {
        return encodeBlurhashFromFile(previewPath);
    }
    const imagePath = path.join(imagesDir, filename);
    if (fs.existsSync(imagePath)) {
        return encodeBlurhashFromFile(imagePath);
    }
    return null;
}

async function encodeReferenceFileBlurhash(hashKey, { previewCacheDir, uploadCacheDir }) {
    const previewPath = path.join(previewCacheDir, `${hashKey}.webp`);
    if (fs.existsSync(previewPath)) {
        return encodeBlurhashFromFile(previewPath);
    }
    const filePath = path.join(uploadCacheDir, hashKey);
    if (fs.existsSync(filePath)) {
        return encodeBlurhashFromFile(filePath);
    }
    return null;
}

async function encodeVibeBlurhash(vibe, { previewCacheDir, lookupCacheBlurhash }) {
    let blurhash = null;
    const previewKey = vibe.preview_hash || (vibe.type === 'cache' ? vibe.image_source : null);
    if (previewKey) {
        const previewPath = path.join(previewCacheDir, `${previewKey}.webp`);
        if (fs.existsSync(previewPath)) {
            blurhash = await encodeBlurhashFromFile(previewPath);
        } else if (lookupCacheBlurhash) {
            blurhash = lookupCacheBlurhash(previewKey) || null;
        }
    }
    if (!blurhash && vibe.type === 'base64' && vibe.image_source) {
        const raw = String(vibe.image_source);
        const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
        blurhash = await encodeBlurhashFromBuffer(Buffer.from(b64, 'base64'));
    }
    return blurhash;
}

/**
 * Encode a list of row objects in chunks; commitPairs([[hash, key], ...]) may be sync or async.
 */
async function processInChunks(rows, {
    batchSize = DEFAULT_BATCH,
    concurrency = DEFAULT_CONCURRENCY,
    label = 'rows',
    encodeOne,
    commitPairs,
    log = console.log
}) {
    const totals = { updated: 0, failed: 0, processed: 0, total: rows.length };
    const started = Date.now();
    if (!rows.length) {
        log(`  … ${label} 0/0 (nothing to do)`);
        return totals;
    }

    const size = Math.max(1, batchSize);
    const conc = Math.max(1, concurrency);

    for (let offset = 0; offset < rows.length; offset += size) {
        const chunk = rows.slice(offset, offset + size);
        const encoded = await mapPool(chunk, conc, async (item) => {
            try {
                return await encodeOne(item);
            } catch (err) {
                console.warn(`  ⚠️ ${label} encode failed: ${err.message}`);
                return null;
            }
        });

        const pairs = [];
        let failed = 0;
        for (const pair of encoded) {
            if (pair && pair[0] && pair[1] != null) {
                pairs.push(pair);
            } else {
                failed++;
            }
        }

        if (pairs.length) {
            await commitPairs(pairs);
        }

        totals.updated += pairs.length;
        totals.failed += failed;
        totals.processed += chunk.length;

        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        log(
            `  … ${label} ${totals.processed}/${totals.total}` +
            ` (committed ${pairs.length} this chunk, ` +
            `updated ${totals.updated}, failed ${totals.failed}) ${elapsed}s`
        );
        await new Promise((r) => setImmediate(r));
    }

    return totals;
}

function resolveOptions(options = {}) {
    return {
        batchSize: Math.max(1, parseInt(options.batchSize || DEFAULT_BATCH, 10) || DEFAULT_BATCH),
        concurrency: Math.max(1, parseInt(options.concurrency || DEFAULT_CONCURRENCY, 10) || DEFAULT_CONCURRENCY),
        limit: parseInt(options.limit || 0, 10) || 0,
        force: options.force === true || options.force === 1 || options.force === '1',
        log: options.log || console.log
    };
}

module.exports = {
    DEFAULT_BATCH,
    DEFAULT_CONCURRENCY,
    getBaseName,
    mapPool,
    encodeGalleryBlurhash,
    encodeReferenceFileBlurhash,
    encodeVibeBlurhash,
    processInChunks,
    resolveOptions
};
