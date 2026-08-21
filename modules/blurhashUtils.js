/**
 * BlurHash encode helpers (server). Client decode: public/scripts/comp/blurhashUtil.js
 */
const sharp = require('sharp');
const { encode, isBlurhashValid } = require('blurhash');

const BLURHASH_MAX_EDGE = 32;
const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;

async function encodeBlurhashFromBuffer(input, options = {}) {
    if (!input) return null;
    const maxEdge = options.maxEdge || BLURHASH_MAX_EDGE;
    const componentX = options.componentX || BLURHASH_COMPONENTS_X;
    const componentY = options.componentY || BLURHASH_COMPONENTS_Y;
    try {
        const { data, info } = await sharp(input, { failOnError: false })
            .rotate()
            .resize(maxEdge, maxEdge, {
                fit: 'inside',
                withoutEnlargement: true,
                kernel: sharp.kernel.nearest
            })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        if (!info?.width || !info?.height || !data?.length) return null;
        const hash = encode(
            new Uint8ClampedArray(data),
            info.width,
            info.height,
            componentX,
            componentY
        );
        return isBlurhashValid(hash)?.result ? hash : null;
    } catch (err) {
        console.warn('encodeBlurhashFromBuffer failed:', err.message);
        return null;
    }
}

async function encodeBlurhashFromFile(filePath, options = {}) {
    if (!filePath) return null;
    return encodeBlurhashFromBuffer(filePath, options);
}

function normalizeBlurhash(value) {
    if (value == null) return null;
    const hash = String(value).trim();
    if (!hash) return null;
    try {
        return isBlurhashValid(hash)?.result ? hash : null;
    } catch (_) {
        return null;
    }
}

module.exports = {
    encodeBlurhashFromBuffer,
    encodeBlurhashFromFile,
    normalizeBlurhash,
    BLURHASH_MAX_EDGE,
    BLURHASH_COMPONENTS_X,
    BLURHASH_COMPONENTS_Y
};
