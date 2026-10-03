/**
 * Quick Start preview images — download once from NovelAI static, serve from .cache/quickstart/.
 * Client: public/scripts/comp/imageGenerationSettings.js (URLs are /cache/quickstart/ only).
 * Catalog prompts stay in public/data/nai-quickstart-v5.json.
 */

const fs = require('fs');
const path = require('path');
const { browserRequest } = require('./browserHttp');

const CATALOG_PATH = path.join(__dirname, '../public/data/nai-quickstart-v5.json');
const UPSTREAM_BASE = 'https://static.novelai.net/quickstart/v5/';
const FILE_RE = /^(\d{4})(_tiny)?\.webp$/;
const WARM_CONCURRENCY = 3;

let cacheDir = null;
const inFlight = new Map();
let warmPromise = null;

function initQuickstartGalleryCache(cacheRootDir) {
    if (!cacheRootDir) return;
    cacheDir = path.join(cacheRootDir, 'quickstart');
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
    } catch (e) {
        console.warn('quickstartGalleryCache: could not create cache dir', e.message);
        cacheDir = null;
        return;
    }
    setTimeout(() => {
        warmQuickstartImages().catch((e) => {
            console.warn('quickstartGalleryCache: warm failed', e.message);
        });
    }, 2000);
}

function isQuickstartFileName(name) {
    return FILE_RE.test(String(name || ''));
}

async function downloadQuickstartFile(base, dest) {
    const res = await browserRequest(`${UPSTREAM_BASE}${base}`, null, {
        acceptResType: 'image',
        json: false,
        timeoutMs: 30000
    });
    if (res.statusCode !== 200) {
        throw new Error(`HTTP ${res.statusCode}`);
    }
    if (!res.body || res.body.length < 12 || res.body.slice(0, 4).toString('ascii') !== 'RIFF') {
        throw new Error('Response was not a webp');
    }
    const part = `${dest}.part`;
    fs.writeFileSync(part, res.body);
    fs.renameSync(part, dest);
    return dest;
}

async function ensureQuickstartFile(name) {
    const base = path.basename(String(name || ''));
    if (!isQuickstartFileName(base)) {
        throw new Error('Invalid quickstart image name');
    }
    if (!cacheDir) {
        throw new Error('Quickstart cache is not initialized');
    }
    const dest = path.join(cacheDir, base);
    try {
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
    } catch {
        /* re-download */
    }
    if (inFlight.has(base)) return inFlight.get(base);

    const work = downloadQuickstartFile(base, dest).finally(() => {
        inFlight.delete(base);
    });
    inFlight.set(base, work);
    return work;
}

function catalogFileNames() {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const ids = Array.isArray(catalog.ids) ? catalog.ids : [];
    const names = [];
    ids.forEach((id) => {
        const file = String(id).padStart(4, '0');
        if (!/^\d{4}$/.test(file)) return;
        names.push(`${file}_tiny.webp`, `${file}.webp`);
    });
    return names;
}

async function warmQuickstartImages() {
    if (warmPromise) return warmPromise;
    warmPromise = (async () => {
        const names = catalogFileNames();
        let cursor = 0;
        const workers = Array.from({ length: WARM_CONCURRENCY }, async () => {
            while (cursor < names.length) {
                const name = names[cursor];
                cursor += 1;
                try {
                    await ensureQuickstartFile(name);
                } catch (e) {
                    console.warn('quickstartGalleryCache:', name, e.message);
                }
            }
        });
        await Promise.all(workers);
        console.log(`✓ Quickstart images cached (${names.length} files)`);
        return names.length;
    })().finally(() => {
        warmPromise = null;
    });
    return warmPromise;
}

module.exports = {
    initQuickstartGalleryCache,
    ensureQuickstartFile,
    isQuickstartFileName,
    warmQuickstartImages,
    FILE_RE
};
