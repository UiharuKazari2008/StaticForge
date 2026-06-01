/**
 * NAX.moe community vibes gallery — fetch gallery-display.php HTML, parse to JSON, cache ~2h.
 * naxVibesApplet.js (client), websocketHandlers.js (get_nax_vibes_gallery)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('node-html-parser');

const NAX_MOE_ORIGIN = 'https://nax.moe';
const GALLERY_PARTIAL = '/partials/components/gallery-display.php';
const DOWNLOAD_API = '/partials/api/vibe-download.php';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const USER_AGENT = 'StaticForge-NaxVibes/1.0';

/** Preset sort pages (negative) from nax.moe navbar */
const PRESET_PAGES = {
    top: -2,
    hot: -3,
    debated: -5,
    gems: -6
};

const memoryCache = new Map();
let diskCacheDir = null;

function initNaxVibesGallery(cacheRootDir) {
    if (!cacheRootDir) return;
    diskCacheDir = path.join(cacheRootDir, 'nax_vibes_gallery');
    try {
        fs.mkdirSync(diskCacheDir, { recursive: true });
    } catch (e) {
        console.warn('naxVibesGallery: could not create disk cache dir', e.message);
        diskCacheDir = null;
    }
}

function cacheKeyFromParams(params) {
    const normalized = {
        page: params.page,
        search: params.search || '',
        filter45Curated: !!params.filter45Curated,
        filter45Full: !!params.filter45Full,
        filter4Curated: !!params.filter4Curated,
        filter4Full: !!params.filter4Full
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function readDiskEntry(key) {
    if (!diskCacheDir) return null;
    const filePath = path.join(diskCacheDir, `${key}.json`);
    try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeDiskEntry(key, entry) {
    if (!diskCacheDir) return;
    const filePath = path.join(diskCacheDir, `${key}.json`);
    try {
        fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
    } catch (e) {
        console.warn('naxVibesGallery: disk cache write failed', e.message);
    }
}

function getCached(key) {
    const now = Date.now();
    const mem = memoryCache.get(key);
    if (mem && now < mem.expiresAt) {
        return { ...mem.payload, fromCache: true, cachedAt: mem.cachedAt, expiresAt: mem.expiresAt };
    }
    if (mem) memoryCache.delete(key);

    const disk = readDiskEntry(key);
    if (disk && now < disk.expiresAt) {
        memoryCache.set(key, disk);
        return { ...disk.payload, fromCache: true, cachedAt: disk.cachedAt, expiresAt: disk.expiresAt };
    }
    return null;
}

function setCache(key, payload) {
    const now = Date.now();
    const entry = {
        cachedAt: now,
        expiresAt: now + CACHE_TTL_MS,
        payload
    };
    memoryCache.set(key, entry);
    writeDiskEntry(key, entry);
}

function buildGalleryQuery(params) {
    const q = new URLSearchParams();
    q.set('gallery', 'vibes');
    q.set('page', String(params.page));

    const search = (params.search || '').trim();
    if (search) q.set('search', search);

    if (params.filter45Curated) q.set('filter_45_curated', '1');
    else q.set('filter_45_curated', '0');
    if (params.filter45Full) q.set('filter_45_full', '1');
    else q.set('filter_45_full', '0');
    if (params.filter4Curated) q.set('filter_4_curated', '1');
    else q.set('filter_4_curated', '0');
    if (params.filter4Full) q.set('filter_4_full', '1');
    else q.set('filter_4_full', '0');

    return q;
}

function buildDownloadUrl(vibeId, encodingId, single) {
    const q = new URLSearchParams();
    q.set('id', String(vibeId));
    if (single && encodingId) {
        q.set('single', 'true');
        q.set('encoding_id', String(encodingId));
    }
    return `${NAX_MOE_ORIGIN}${DOWNLOAD_API}?${q.toString()}`;
}

function parseIntSafe(text, fallback = 0) {
    const n = parseInt(String(text || '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

function parseGalleryHtml(html) {
    const root = parse(html, { lowerCaseTagName: false });
    const panels = root.querySelectorAll('figure.vibe-panel, figure.imagePanel.vibe-panel');
    const vibes = [];

    for (const panel of panels) {
        const vibeId = parseIntSafe(panel.getAttribute('data-vibe-id'), 0);
        if (!vibeId) continue;

        const captionEl = panel.querySelector('figurecaption.imageText, figurecaption .imageText');
        const nameInput = panel.querySelector('figurecaption input[type="text"]');
        const name = (nameInput && nameInput.getAttribute('value'))
            || (captionEl && captionEl.text.trim())
            || `vibe-${vibeId}`;

        const nsfw = panel.classList.contains('nsfw');

        let upvotes = 0;
        let downvotes = 0;
        const voteBlock = panel.querySelector('.votes');
        if (voteBlock) {
            const upBtn = voteBlock.querySelector('[data-vote="up"] .vote-count');
            const downBtn = voteBlock.querySelector('[data-vote="down"] .vote-count');
            upvotes = parseIntSafe(upBtn && upBtn.text, 0);
            downvotes = parseIntSafe(downBtn && downBtn.text, 0);
        }

        const encodings = [];
        let activeEncodingId = null;
        panel.querySelectorAll('.encoding-thumbnail').forEach((thumb) => {
            const encId = parseIntSafe(thumb.getAttribute('data-encoding-id'), 0);
            if (!encId) return;
            const img = thumb.querySelector('img');
            const model = thumb.getAttribute('data-model') || '';
            const infoExtracted = thumb.getAttribute('data-info-extracted') || '';
            const modelShortEl = thumb.querySelector('.model-short');
            const extractionEl = thumb.querySelector('.extraction');
            const primary = thumb.getAttribute('data-primary') === 'true';
            const active = thumb.classList.contains('active');
            if (active) activeEncodingId = encId;
            encodings.push({
                id: encId,
                model,
                modelShort: (modelShortEl && modelShortEl.text.trim()) || model,
                infoExtracted: (extractionEl && extractionEl.text.trim()) || infoExtracted,
                primary,
                active,
                thumbnailUrl: img ? img.getAttribute('src') : ''
            });
        });

        if (!activeEncodingId && encodings.length) {
            const primaryEnc = encodings.find((e) => e.primary) || encodings[0];
            activeEncodingId = primaryEnc.id;
        }

        const mainImg = panel.querySelector('.imageHolder > img');
        const thumbnailUrl = mainImg ? mainImg.getAttribute('src') : '';

        vibes.push({
            id: vibeId,
            name,
            nsfw,
            upvotes,
            downvotes,
            score: upvotes - downvotes,
            thumbnailUrl,
            encodings,
            activeEncodingId,
            downloadFullUrl: buildDownloadUrl(vibeId, null, false),
            downloadSingleUrl: buildDownloadUrl(vibeId, activeEncodingId, true)
        });
    }

    return vibes;
}

async function fetchGalleryHtml(url) {
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml'
        },
        signal: AbortSignal.timeout(45000)
    });
    if (!res.ok) {
        throw new Error(`NAX gallery HTTP ${res.status}: ${res.statusText}`);
    }
    return res.text();
}

/**
 * @param {object} options
 * @param {string} [options.preset] top|hot|debated|gems — uses negative page numbers
 * @param {number} [options.page] browse page (positive), default 1 when no preset
 * @param {string} [options.search]
 * @param {boolean} [options.filter45Curated]
 * @param {boolean} [options.filter45Full]
 * @param {boolean} [options.filter4Curated]
 * @param {boolean} [options.filter4Full]
 * @param {boolean} [options.forceRefresh] skip cache
 */
async function getNaxVibesGallery(options = {}) {
    let page = 1;
    const preset = options.preset && PRESET_PAGES[options.preset] != null ? options.preset : null;
    if (preset) {
        page = PRESET_PAGES[preset];
    } else if (options.page != null) {
        page = parseInt(options.page, 10);
        if (!Number.isFinite(page) || page < 1) page = 1;
    }

    const params = {
        page,
        search: options.search || '',
        filter45Curated: options.filter45Curated !== false,
        filter45Full: options.filter45Full !== false,
        filter4Curated: options.filter4Curated === true,
        filter4Full: options.filter4Full === true
    };

    const key = cacheKeyFromParams(params);
    if (!options.forceRefresh) {
        const hit = getCached(key);
        if (hit) return hit;
    }

    const query = buildGalleryQuery(params);
    const url = `${NAX_MOE_ORIGIN}${GALLERY_PARTIAL}?${query.toString()}`;
    const html = await fetchGalleryHtml(url);
    const vibes = parseGalleryHtml(html);

    const isBrowsePage = page > 0;
    const payload = {
        vibes,
        page,
        preset: preset || null,
        search: params.search,
        filters: {
            filter45Curated: params.filter45Curated,
            filter45Full: params.filter45Full,
            filter4Curated: params.filter4Curated,
            filter4Full: params.filter4Full
        },
        hasMore: isBrowsePage && vibes.length >= 40,
        sourceUrl: url,
        fromCache: false
    };

    setCache(key, payload);
    const now = Date.now();
    return {
        ...payload,
        cachedAt: now,
        expiresAt: now + CACHE_TTL_MS
    };
}

function clearNaxVibesGalleryCache() {
    memoryCache.clear();
    if (!diskCacheDir || !fs.existsSync(diskCacheDir)) return { cleared: true };
    try {
        for (const name of fs.readdirSync(diskCacheDir)) {
            if (name.endsWith('.json')) fs.unlinkSync(path.join(diskCacheDir, name));
        }
    } catch (e) {
        console.warn('naxVibesGallery: clear disk cache failed', e.message);
    }
    return { cleared: true };
}

module.exports = {
    initNaxVibesGallery,
    getNaxVibesGallery,
    clearNaxVibesGalleryCache,
    PRESET_PAGES,
    CACHE_TTL_MS,
    buildDownloadUrl
};
