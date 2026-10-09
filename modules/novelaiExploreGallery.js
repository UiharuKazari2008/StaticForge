/**
 * NovelAI Explore (Agora) — proxy explore.novelai.net/post/search + thumbnail/blob cache.
 * Client: public/scripts/comp/exploreDsapApplet.js
 * WS: modules/ws/handlers/105-exploreHandler.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { browserRequest } = require('./browserHttp');

const EXPLORE_ORIGIN = 'https://explore.novelai.net';
const SEARCH_PATH = '/post/search';
const CACHE_TTL_MS = 60 * 60 * 1000;
const PAGE_LIMIT = 50;
const MIN_UPSTREAM_GAP_MS = 2500;

const memoryCache = new Map();
const inFlightSearch = new Map();
const inFlightImages = new Map();

let pageCacheDir = null;
let imageCacheDir = null;
let lastUpstreamAt = 0;
let apiKeyResolver = null;
let userSelfCache = null;
const USER_SELF_TTL_MS = 5 * 60 * 1000;
let undesiredIdSet = null;

function initNovelaiExploreGallery(cacheRootDir, options = {}) {
    if (!cacheRootDir) return;
    pageCacheDir = path.join(cacheRootDir, 'novelai_explore_gallery');
    imageCacheDir = path.join(cacheRootDir, 'explore_files');
    try {
        fs.mkdirSync(pageCacheDir, { recursive: true });
        fs.mkdirSync(imageCacheDir, { recursive: true });
    } catch (e) {
        console.warn('novelaiExploreGallery: could not create cache dirs', e.message);
        pageCacheDir = null;
        imageCacheDir = null;
    }
    if (typeof options.getApiKey === 'function') {
        apiKeyResolver = options.getApiKey;
    }
}

function setApiKeyResolver(fn) {
    apiKeyResolver = fn;
}

function resolveApiKey() {
    if (typeof apiKeyResolver === 'function') {
        return apiKeyResolver();
    }
    return null;
}

function cacheKeyFromParams(params) {
    const normalized = {
        sort: params.sort || 'new',
        period: params.period || 'day',
        search: (params.search || '').trim().toLowerCase(),
        model: (params.model || '').trim().toLowerCase(),
        aspect: (params.aspect || '').trim().toLowerCase(),
        vt: (params.vt || '').trim().toLowerCase(),
        creatorId: (params.creatorId || '').trim(),
        offset: params.offset || 0,
        limit: params.limit || PAGE_LIMIT
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function readDiskEntry(key) {
    if (!pageCacheDir) return null;
    const filePath = path.join(pageCacheDir, `${key}.json`);
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeDiskEntry(key, entry) {
    if (!pageCacheDir) return;
    try {
        fs.writeFileSync(path.join(pageCacheDir, `${key}.json`), JSON.stringify(entry), 'utf8');
    } catch (e) {
        console.warn('novelaiExploreGallery: page cache write failed', e.message);
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
    const entry = { cachedAt: now, expiresAt: now + CACHE_TTL_MS, payload };
    memoryCache.set(key, entry);
    writeDiskEntry(key, entry);
}

/** Queries that 500 on the upstream tag/tokenizer path when sent with spaces. */
const EXPLORE_TEXT_QUERY_CASES = [
    'mutual hug',
    'double hand grab',
    'fingers interlaced',
    'cicada',
    'clinging',
    'arms around neck'
];

/**
 * Explore's model filter is the image-model id (`system:model:<id>`).
 * `nai-diffusion-v4` is not an id — V4.5 Full is `nai-diffusion-4-5-full` —
 * and the upstream search 500s on the unknown slug.
 */
const EXPLORE_MODEL_ALIASES = {
    'nai-diffusion-v4': 'nai-diffusion-4-5-full',
    'nai-diffusion-v4-full': 'nai-diffusion-4-5-full',
    'nai-diffusion-v4.5': 'nai-diffusion-4-5-full',
    'nai-diffusion-v4.5-full': 'nai-diffusion-4-5-full',
    'nai-diffusion-4.5': 'nai-diffusion-4-5-full',
    'nai-diffusion-4.5-full': 'nai-diffusion-4-5-full',
    'v4.5': 'nai-diffusion-4-5-full',
    'v4_5': 'nai-diffusion-4-5-full',
    'nai-diffusion-v4-curated': 'nai-diffusion-4-5-curated',
    'nai-diffusion-v4.5-curated': 'nai-diffusion-4-5-curated',
    'nai-diffusion-4.5-curated': 'nai-diffusion-4-5-curated',
    'nai-diffusion-4-curated': 'nai-diffusion-4-curated-preview',
    v4: 'nai-diffusion-4-full',
    v3: 'nai-diffusion-3',
    furry: 'nai-diffusion-furry-3',
    v5: 'nai-diffusion-5-full',
    'v5-full': 'nai-diffusion-5-full',
    'v5-curated': 'nai-diffusion-5-curated',
    'nai-diffusion-5-full': 'nai-diffusion-5-full',
    'nai-diffusion-5-curated': 'nai-diffusion-5-curated',
    'nai-diffusion-4-5-full': 'nai-diffusion-4-5-full',
    'nai-diffusion-4-5-curated': 'nai-diffusion-4-5-curated',
    'nai-diffusion-4-full': 'nai-diffusion-4-full',
    'nai-diffusion-4-curated-preview': 'nai-diffusion-4-curated-preview',
    'nai-diffusion-3': 'nai-diffusion-3',
    'nai-diffusion-furry-3': 'nai-diffusion-furry-3'
};

let exploreRandomSalt = '';

function exploreRandomSaltValue(explicit) {
    const given = String(explicit || '').trim();
    if (given) return given.slice(0, 32);
    if (!exploreRandomSalt) {
        exploreRandomSalt = Math.random().toString(36).slice(2, 8);
    }
    return exploreRandomSalt;
}

function normalizeSort(sort) {
    const s = String(sort || 'new').toLowerCase();
    if (s === 'top' || s === 'hot' || s === 'new' || s === 'random') return s;
    if (s === 'created_at' || s === 'latest') return 'new';
    return 'new';
}

function normalizePeriod(period) {
    const p = String(period == null || period === '' ? 'day' : period).trim().toLowerCase();
    if (p === 'week' || p === 'month' || p === 'day' || p === 'all') return p;
    return 'day';
}

function normalizeExploreModel(model) {
    const raw = String(model || '').trim().toLowerCase();
    if (!raw) return '';
    return EXPLORE_MODEL_ALIASES[raw] || raw;
}

/**
 * Comma-separated tag query → one selector each.
 * Spaces become underscores. The upstream tokenizer 500s on raw multi-word
 * values (`mutual hug`, `arms around neck`, …) and on the same path for a
 * few single tokens when they arrive unnormalized.
 */
function exploreSearchTags(search) {
    const raw = String(search || '').trim();
    if (!raw) return [];
    const tags = [];
    raw.split(',').forEach((part) => {
        const trimmed = part.trim().replace(/\s+/g, ' ');
        if (!trimmed) return;
        const wire = trimmed.replace(/ /g, '_');
        if (wire) tags.push(wire);
    });
    return tags;
}

function readExploreLikeCount(raw) {
    if (!raw || typeof raw !== 'object') return 0;
    const buckets = [raw, raw.stats, raw.counts, raw.image];
    const keys = ['like_count', 'likes', 'likeCount', 'upvote_count', 'upvotes'];
    for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b];
        if (!bucket || typeof bucket !== 'object') continue;
        for (let k = 0; k < keys.length; k++) {
            const value = bucket[keys[k]];
            if (value == null || value === '') continue;
            const n = Number(value);
            if (!Number.isFinite(n)) continue;
            if (n > 0) return n;
        }
    }
    return 0;
}

function buildSearchBody({
    sort,
    period,
    search,
    model,
    aspect,
    vt,
    creatorId,
    offset,
    limit,
    honorPeriod,
    randomSalt
}) {
    const selectors = [];
    const setSelector = (field, value) => {
        const idx = selectors.findIndex((row) => row.field === field);
        const next = { field, value };
        if (idx >= 0) selectors[idx] = next;
        else selectors.push(next);
    };

    const cid = (creatorId || '').trim();
    const pagination = { limit, offset };
    if (cid) {
        setSelector('creator_id', cid);
        return {
            orderers: [{ field: 'created_at', sort_direction: 'desc' }],
            selectors,
            pagination,
            effectiveSort: 'new',
            periodApplied: false
        };
    }

    const textTags = exploreSearchTags(search);
    const unwindowed = period === 'all';
    const periodValue = unwindowed ? null : (period || 'day');
    const periodWanted = !!periodValue && (
        sort === 'top'
        || sort === 'hot'
        || sort === 'random'
        || (!!honorPeriod && textTags.length > 0)
    );
    let effectiveSort = (sort === 'new' || (unwindowed && sort !== 'random')) ? 'new' : sort;

    if (sort === 'random') {
        const salt = exploreRandomSaltValue(randomSalt);
        return {
            orderers: [{ field: 'random', sort_direction: 'desc' }],
            selectors: [{ field: 'random', value: `${periodValue || 'day'}:${salt}` }],
            pagination,
            effectiveSort: 'random',
            periodApplied: true
        };
    }

    if (periodWanted && sort !== 'random') {
        const rank = sort === 'hot' ? 'hot' : 'top';
        setSelector(rank, periodValue);
        effectiveSort = rank === 'hot' ? 'hot' : 'top';
    }

    textTags.forEach((tag) => {
        selectors.push({ field: 'tag', value: tag });
    });
    const modelSlug = normalizeExploreModel(model);
    if (modelSlug) selectors.push({ field: 'tag', value: 'system:model:' + modelSlug });
    if (aspect) selectors.push({ field: 'tag', value: 'system:aspect:' + aspect });
    if (vt === 'with') selectors.push({ field: 'tag', value: 'system:has_vt' });
    setSelector('moderation_status', '1');

    const orderField = effectiveSort === 'new' ? 'created_at' : effectiveSort;
    return {
        orderers: [{ field: orderField, sort_direction: 'desc' }],
        selectors,
        pagination,
        effectiveSort,
        periodApplied: periodWanted && effectiveSort !== 'new'
    };
}

function publicThumbUrl(id, ext) {
    return `/cache/explore_files/thumb_${id}${ext || ''}`;
}

function publicBlobUrl(id, ext) {
    return `/cache/explore_files/blob_${id}${ext || ''}`;
}

function findExistingImageFile(kind, id) {
    if (!imageCacheDir) return null;
    const prefix = kind === 'blob' ? `blob_${id}` : `thumb_${id}`;
    try {
        const names = fs.readdirSync(imageCacheDir);
        const hit = names.find((n) => n === prefix || n.startsWith(`${prefix}.`));
        if (hit) return path.join(imageCacheDir, hit);
    } catch {
        /* empty */
    }
    return null;
}

function extFromContentType(contentType) {
    const ct = String(contentType || '').toLowerCase();
    if (ct.includes('webp')) return '.webp';
    if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
    if (ct.includes('png')) return '.png';
    if (ct.includes('gif')) return '.gif';
    return '';
}

function normalizeResult(raw) {
    const id = raw && raw.id ? String(raw.id) : '';
    if (!id) return null;
    const thumbExisting = findExistingImageFile('thumbnail', id);
    const blobExisting = findExistingImageFile('blob', id);
    const thumbExt = thumbExisting ? path.extname(thumbExisting) : '';
    const blobExt = blobExisting ? path.extname(blobExisting) : '';

    return {
        id,
        type: raw.type,
        title: raw.title || '',
        description: raw.description || '',
        created_at: raw.created_at || null,
        moderation_status: raw.moderation_status,
        like_count: readExploreLikeCount(raw),
        liked_by_self: raw.liked_by_self == null ? null : !!raw.liked_by_self,
        creator: raw.creator
            ? { id: raw.creator.id, name: raw.creator.name }
            : { id: raw.creator_id || null, name: '' },
        image: {
            width: raw.image?.width || null,
            height: raw.image?.height || null,
            blurhash: raw.image?.blurhash || null,
            nai_metadata: raw.image?.nai_metadata || null
        },
        thumbnailUrl: publicThumbUrl(id, thumbExt),
        blobUrl: publicBlobUrl(id, blobExt),
        thumbReady: !!thumbExisting,
        blobReady: !!blobExisting
    };
}

async function waitUpstreamGap() {
    const now = Date.now();
    const wait = MIN_UPSTREAM_GAP_MS - (now - lastUpstreamAt);
    if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
    }
}

async function postSearch(body, apiKey, apiKeyManager) {
    await waitUpstreamGap();
    lastUpstreamAt = Date.now();

    const payload = JSON.stringify(body);
    const res = await browserRequest({
        hostname: 'explore.novelai.net',
        port: 443,
        path: SEARCH_PATH,
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiKey}`
        }
    }, Buffer.from(payload), { acceptResType: 'json' });

    if (res.statusCode !== 200) {
        let msg = `HTTP ${res.statusCode}`;
        try {
            const errJson = JSON.parse(res.body.toString('utf8'));
            msg = errJson.message || errJson.error || msg;
        } catch {
            /* ignore */
        }
        if (apiKeyManager) {
            apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        }
        throw new Error(`NovelAI Explore search failed: ${msg}`);
    }

    if (apiKeyManager) {
        apiKeyManager.recordApiSuccess('novelai');
    }

    return JSON.parse(res.body.toString('utf8'));
}

function undesiredPath() {
    if (!pageCacheDir) return null;
    return path.join(pageCacheDir, 'undesired_ids.json');
}

function loadUndesiredIdSet() {
    if (undesiredIdSet) return undesiredIdSet;
    undesiredIdSet = new Set();
    const filePath = undesiredPath();
    if (!filePath || !fs.existsSync(filePath)) return undesiredIdSet;
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const ids = Array.isArray(raw?.ids) ? raw.ids : (Array.isArray(raw) ? raw : []);
        ids.forEach((id) => {
            const s = String(id || '').trim();
            if (s) undesiredIdSet.add(s);
        });
    } catch (e) {
        console.warn('novelaiExploreGallery: undesired list read failed', e.message);
    }
    return undesiredIdSet;
}

function saveUndesiredIdSet() {
    const filePath = undesiredPath();
    if (!filePath || !undesiredIdSet) return;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({
            ids: Array.from(undesiredIdSet),
            updatedAt: new Date().toISOString()
        }, null, 2), 'utf8');
    } catch (e) {
        console.warn('novelaiExploreGallery: undesired list write failed', e.message);
    }
}

function filterUndesiredResults(results) {
    const badPosts = loadUndesiredIdSet();
    const badCreators = loadBlockedCreatorIdSet();
    if (!badPosts.size && !badCreators.size) {
        return Array.isArray(results) ? results : [];
    }
    return (results || []).filter((r) => r && !isExploreResultHidden(r));
}

function isExploreResultHidden(r) {
    if (!r || !r.id) return true;
    const badPosts = loadUndesiredIdSet();
    if (badPosts.has(String(r.id))) return true;
    const badCreators = loadBlockedCreatorIdSet();
    const cid = r.creator?.id != null ? String(r.creator.id)
        : (r.creator_id != null ? String(r.creator_id) : '');
    if (cid && badCreators.has(cid)) return true;
    return false;
}

/** Max extra upstream pages to pull when local filters shrink a page. */
const MAX_FILTER_BACKFILL_PAGES = 8;

/**
 * Keep requesting upstream pages until `limit` visible results are collected
 * (or upstream is exhausted). Advances nextOffset past consumed upstream items.
 */
async function collectFilteredResults({
    startOffset,
    limit,
    fetchRawPage
}) {
    const out = [];
    const seen = new Set();
    let fetchOffset = Math.max(0, startOffset || 0);
    let nextOffset = fetchOffset;
    let upstreamTotal = null;
    let lastRawCount = 0;
    let pagesFetched = 0;
    let fromCache = true;
    let cachedAt = null;

    while (out.length < limit && pagesFetched < MAX_FILTER_BACKFILL_PAGES) {
        const page = await fetchRawPage(fetchOffset, limit);
        pagesFetched += 1;
        if (!page?.fromCache) fromCache = false;
        if (page?.cachedAt) cachedAt = page.cachedAt;

        const rawResults = Array.isArray(page?.rawResults) ? page.rawResults : [];
        lastRawCount = rawResults.length;
        if (page?.pagination?.total != null) {
            upstreamTotal = page.pagination.total;
        }

        for (let i = 0; i < rawResults.length; i++) {
            const r = rawResults[i];
            if (!r?.id || seen.has(r.id)) continue;
            if (isExploreResultHidden(r)) continue;
            seen.add(r.id);
            out.push(r);
            nextOffset = fetchOffset + i + 1;
            if (out.length >= limit) break;
        }

        if (out.length >= limit) break;

        if (lastRawCount < limit) {
            nextOffset = fetchOffset + lastRawCount;
            break;
        }
        fetchOffset += limit;
        nextOffset = fetchOffset;
    }

    const hasMore = upstreamTotal != null
        ? nextOffset < upstreamTotal
        : (out.length >= limit && lastRawCount >= limit);

    return {
        results: out.slice(0, limit),
        pagination: {
            limit,
            offset: Math.max(0, startOffset || 0),
            nextOffset,
            total: upstreamTotal,
            hasMore
        },
        fromCache,
        cachedAt,
        backfillPages: pagesFetched
    };
}

function blockedCreatorsPath() {
    if (!pageCacheDir) return null;
    return path.join(pageCacheDir, 'blocked_creators.json');
}

let blockedCreatorIdSet = null;
let blockedCreatorNames = null;

function loadBlockedCreatorIdSet() {
    if (blockedCreatorIdSet) return blockedCreatorIdSet;
    blockedCreatorIdSet = new Set();
    blockedCreatorNames = Object.create(null);
    const filePath = blockedCreatorsPath();
    if (!filePath || !fs.existsSync(filePath)) return blockedCreatorIdSet;
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const ids = Array.isArray(raw?.ids) ? raw.ids : (Array.isArray(raw) ? raw : []);
        const names = raw?.names && typeof raw.names === 'object' ? raw.names : {};
        ids.forEach((id) => {
            const s = String(id || '').trim();
            if (s) blockedCreatorIdSet.add(s);
        });
        Object.keys(names).forEach((id) => {
            const s = String(id || '').trim();
            if (s) blockedCreatorNames[s] = String(names[id] || '');
        });
    } catch (e) {
        console.warn('novelaiExploreGallery: blocked creators read failed', e.message);
    }
    return blockedCreatorIdSet;
}

function saveBlockedCreatorIdSet() {
    const filePath = blockedCreatorsPath();
    if (!filePath || !blockedCreatorIdSet) return;
    try {
        fs.writeFileSync(filePath, JSON.stringify({
            updatedAt: new Date().toISOString(),
            ids: Array.from(blockedCreatorIdSet),
            names: blockedCreatorNames || {}
        }, null, 2), 'utf8');
    } catch (e) {
        console.warn('novelaiExploreGallery: blocked creators write failed', e.message);
    }
}

function addExploreBlockedCreator(id, name = '') {
    const creatorId = String(id || '').trim();
    if (!creatorId) throw new Error('Creator id required');
    const set = loadBlockedCreatorIdSet();
    set.add(creatorId);
    if (!blockedCreatorNames) blockedCreatorNames = Object.create(null);
    if (name) blockedCreatorNames[creatorId] = String(name);
    saveBlockedCreatorIdSet();
    return { id: creatorId, blocked: true, count: set.size };
}

function removeExploreBlockedCreator(id) {
    const creatorId = String(id || '').trim();
    if (!creatorId) throw new Error('Creator id required');
    const set = loadBlockedCreatorIdSet();
    set.delete(creatorId);
    if (blockedCreatorNames) delete blockedCreatorNames[creatorId];
    saveBlockedCreatorIdSet();
    return { id: creatorId, blocked: false, count: set.size };
}

function listExploreBlockedCreators() {
    const set = loadBlockedCreatorIdSet();
    const names = blockedCreatorNames || {};
    return {
        ids: Array.from(set),
        creators: Array.from(set).map((id) => ({ id, name: names[id] || '' }))
    };
}

function isExploreCreatorBlocked(id) {
    return loadBlockedCreatorIdSet().has(String(id || '').trim());
}

function addExploreUndesiredId(id) {
    const postId = String(id || '').trim();
    if (!postId) throw new Error('Post id required');
    const set = loadUndesiredIdSet();
    set.add(postId);
    saveUndesiredIdSet();
    return { id: postId, undesired: true, count: set.size };
}

function removeExploreUndesiredId(id) {
    const postId = String(id || '').trim();
    if (!postId) throw new Error('Post id required');
    const set = loadUndesiredIdSet();
    set.delete(postId);
    saveUndesiredIdSet();
    return { id: postId, undesired: false, count: set.size };
}

function listExploreUndesiredIds() {
    return { ids: Array.from(loadUndesiredIdSet()) };
}

function isExploreUndesired(id) {
    return loadUndesiredIdSet().has(String(id || '').trim());
}

function refreshNormalizedResult(r) {
    return normalizeResult({
        id: r.id,
        type: r.type,
        title: r.title,
        description: r.description,
        created_at: r.created_at,
        moderation_status: r.moderation_status,
        like_count: r.like_count,
        liked_by_self: r.liked_by_self,
        creator: r.creator,
        image: r.image
    }) || r;
}

async function resolveExploreApiKey(options = {}) {
    const getKey = options.getApiKey || apiKeyResolver;
    const apiKey = typeof getKey === 'function' ? getKey() : resolveApiKey();
    if (!apiKey) {
        throw new Error('NovelAI API key is not configured. Add one to secure.config.json or set NOVELAI_API_KEY.');
    }
    const apiKeyManager = options.apiKeyManager || null;
    if (apiKeyManager && apiKeyManager.isServiceLocked('novelai')) {
        throw new Error('NovelAI is temporarily locked after repeated API errors. An admin must unlock it in Security Center.');
    }
    return { apiKey, apiKeyManager };
}

/**
 * GET explore.novelai.net/user/self — detect Explore registration status.
 * Captures a successful registered payload to disk for later API wiring.
 */
async function getExploreUserSelf(options = {}) {
    const force = !!options.forceRefresh;
    const now = Date.now();
    if (!force && userSelfCache && (now - userSelfCache.at) < USER_SELF_TTL_MS) {
        return { ...userSelfCache.data, fromCache: true };
    }

    const { apiKey, apiKeyManager } = await resolveExploreApiKey(options);
    await waitUpstreamGap();
    lastUpstreamAt = Date.now();

    const res = await browserRequest({
        hostname: 'explore.novelai.net',
        port: 443,
        path: '/user/self',
        method: 'GET',
        headers: {
            authorization: `Bearer ${apiKey}`
        }
    }, null, { acceptResType: 'json' });

    let bodyJson = null;
    try {
        bodyJson = JSON.parse(res.body.toString('utf8'));
    } catch {
        bodyJson = null;
    }

    const message = bodyJson?.message || bodyJson?.error || '';
    const notRegistered = res.statusCode === 403
        && /not registered/i.test(String(message));

    if (res.statusCode === 200 && bodyJson && typeof bodyJson === 'object') {
        if (apiKeyManager) apiKeyManager.recordApiSuccess('novelai');
        // Capture registered account shape for later feature work
        if (pageCacheDir) {
            try {
                fs.writeFileSync(
                    path.join(pageCacheDir, 'user_self_sample.json'),
                    JSON.stringify({ capturedAt: new Date().toISOString(), user: bodyJson }, null, 2),
                    'utf8'
                );
            } catch (e) {
                console.warn('novelaiExploreGallery: user_self sample write failed', e.message);
            }
        }
        const data = {
            registered: true,
            statusCode: 200,
            message: null,
            user: {
                id: bodyJson.id != null ? String(bodyJson.id) : '',
                name: bodyJson.name != null ? String(bodyJson.name) : '',
                type: bodyJson.type,
                is_currently_banned: !!bodyJson.is_currently_banned
            },
            registerUrl: 'https://novelai.net/explore/register'
        };
        userSelfCache = { at: now, data };
        return { ...data, fromCache: false };
    }

    if (notRegistered) {
        // Not an API-key failure — Explore account simply not linked yet
        const data = {
            registered: false,
            statusCode: 403,
            message: message || 'User not registered',
            user: null,
            registerUrl: 'https://novelai.net/explore/register'
        };
        userSelfCache = { at: now, data };
        return { ...data, fromCache: false };
    }

    if (apiKeyManager) {
        apiKeyManager.recordApiFailure('novelai', res.statusCode, message || `HTTP ${res.statusCode}`);
    }
    throw new Error(`NovelAI Explore user/self failed: ${message || `HTTP ${res.statusCode}`}`);
}

/**
 * GET explore.novelai.net/post/:id — post detail including like_count.
 * Works without Explore registration (authOptional on NovelAI side).
 */
async function getExplorePost(id, options = {}) {
    const postId = String(id || '').trim();
    if (!postId) throw new Error('Post id required');
    const { apiKey, apiKeyManager } = await resolveExploreApiKey(options);

    await waitUpstreamGap();
    lastUpstreamAt = Date.now();

    const res = await browserRequest({
        hostname: 'explore.novelai.net',
        port: 443,
        path: `/post/${encodeURIComponent(postId)}`,
        method: 'GET',
        headers: {
            authorization: `Bearer ${apiKey}`
        }
    }, null, { acceptResType: 'json' });

    let bodyJson = null;
    try {
        bodyJson = JSON.parse(res.body.toString('utf8'));
    } catch {
        bodyJson = null;
    }

    if (res.statusCode !== 200 || !bodyJson) {
        const msg = bodyJson?.message || bodyJson?.error || `HTTP ${res.statusCode}`;
        if (apiKeyManager) {
            apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        }
        throw new Error(`NovelAI Explore post failed: ${msg}`);
    }

    if (apiKeyManager) {
        apiKeyManager.recordApiSuccess('novelai');
    }

    const normalized = normalizeResult(bodyJson);
    if (!normalized) throw new Error('NovelAI Explore post returned empty id');
    return normalized;
}

/**
 * POST or DELETE explore.novelai.net/post/like/:id
 */
async function setExplorePostLike(id, like, options = {}) {
    const postId = String(id || '').trim();
    if (!postId) throw new Error('Post id required');
    const wantLike = !!like;
    const { apiKey, apiKeyManager } = await resolveExploreApiKey(options);

    await waitUpstreamGap();
    lastUpstreamAt = Date.now();

    const res = await browserRequest({
        hostname: 'explore.novelai.net',
        port: 443,
        path: `/post/like/${encodeURIComponent(postId)}`,
        method: wantLike ? 'POST' : 'DELETE',
        headers: {
            authorization: `Bearer ${apiKey}`
        }
    }, null, { acceptResType: 'any' });

    if (res.statusCode === 403) {
        let msg = 'Forbidden';
        try {
            const errJson = JSON.parse(res.body.toString('utf8'));
            msg = errJson.message || msg;
        } catch { /* ignore */ }
        if (/not registered/i.test(msg)) {
            userSelfCache = null;
            const err = new Error('User not registered');
            err.code = 'EXPLORE_NOT_REGISTERED';
            err.registerUrl = 'https://novelai.net/explore/register';
            throw err;
        }
        if (apiKeyManager) apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        throw new Error(`NovelAI Explore like failed: ${msg}`);
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
        let msg = `HTTP ${res.statusCode}`;
        try {
            const errJson = JSON.parse(res.body.toString('utf8'));
            msg = errJson.message || errJson.error || msg;
        } catch { /* ignore */ }
        if (apiKeyManager) apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        throw new Error(`NovelAI Explore like failed: ${msg}`);
    }

    if (apiKeyManager) apiKeyManager.recordApiSuccess('novelai');
    return {
        id: postId,
        liked_by_self: wantLike,
        ok: true
    };
}

async function postLikedBySelfSearch({ offset, limit, sortDirection }, apiKey, apiKeyManager) {
    await waitUpstreamGap();
    lastUpstreamAt = Date.now();
    const body = {
        sort_direction: sortDirection === 'asc' ? 'asc' : 'desc',
        pagination: { limit, offset }
    };
    const res = await browserRequest({
        hostname: 'explore.novelai.net',
        port: 443,
        path: '/post/search/liked_by_self',
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiKey}`
        }
    }, Buffer.from(JSON.stringify(body)), { acceptResType: 'json' });

    if (res.statusCode === 403) {
        let msg = 'Forbidden';
        try {
            const errJson = JSON.parse(res.body.toString('utf8'));
            msg = errJson.message || msg;
        } catch { /* ignore */ }
        if (/not registered/i.test(msg)) {
            userSelfCache = null;
            const err = new Error('User not registered');
            err.code = 'EXPLORE_NOT_REGISTERED';
            err.registerUrl = 'https://novelai.net/explore/register';
            throw err;
        }
        if (apiKeyManager) apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        throw new Error(`NovelAI Explore liked search failed: ${msg}`);
    }

    if (res.statusCode !== 200) {
        let msg = `HTTP ${res.statusCode}`;
        try {
            const errJson = JSON.parse(res.body.toString('utf8'));
            msg = errJson.message || errJson.error || msg;
        } catch { /* ignore */ }
        if (apiKeyManager) apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        throw new Error(`NovelAI Explore liked search failed: ${msg}`);
    }

    if (apiKeyManager) apiKeyManager.recordApiSuccess('novelai');
    return JSON.parse(res.body.toString('utf8'));
}

async function getExploreLikedGallery(options = {}) {
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || PAGE_LIMIT, 1), PAGE_LIMIT);
    let offset = 0;
    if (options.offset != null) {
        offset = Math.max(0, parseInt(options.offset, 10) || 0);
    } else if (options.page != null) {
        const page = Math.max(1, parseInt(options.page, 10) || 1);
        offset = (page - 1) * limit;
    }

    const { apiKey, apiKeyManager } = await resolveExploreApiKey(options);
    const collected = await collectFilteredResults({
        startOffset: offset,
        limit,
        fetchRawPage: async (fetchOffset, pageLimit) => {
            const raw = await postLikedBySelfSearch({
                offset: fetchOffset,
                limit: pageLimit,
                sortDirection: options.sortDirection || 'desc'
            }, apiKey, apiKeyManager);
            const rawResults = Array.isArray(raw.results)
                ? raw.results.map(normalizeResult).filter(Boolean)
                : [];
            return {
                rawResults,
                pagination: raw.pagination || { limit: pageLimit, offset: fetchOffset, total: null },
                fromCache: false
            };
        }
    });

    return {
        results: collected.results,
        pagination: collected.pagination,
        likedBySelf: true,
        fromCache: false,
        backfillPages: collected.backfillPages
    };
}

/**
 * Prefetch thumbnails gently (sequential, gap). Fire-and-forget from getExploreGallery.
 */
async function prefetchThumbnails(ids, apiKey, apiKeyManager) {
    for (const id of ids) {
        try {
            await ensureExploreImage(id, 'thumbnail', { apiKey, apiKeyManager });
        } catch (e) {
            console.warn('novelaiExploreGallery: thumb prefetch failed', id, e.message);
        }
        await new Promise((r) => setTimeout(r, 400));
    }
}

/**
 * Convert cached explore blob → PNG and embed NovelAI tEXt metadata when available.
 * Used for clipboard (image/png) and workspace import without dropping Comment/Source.
 */
async function ensureExplorePngExport(id, opts = {}) {
    const postId = String(id || '').trim();
    if (!postId) throw new Error('Missing explore post id');
    if (!imageCacheDir) {
        throw new Error('Explore image cache not initialized');
    }

    const pngName = `png_${postId}.png`;
    const pngPath = path.join(imageCacheDir, pngName);
    const pngMetadata = opts.pngMetadata || null;

    let meta = opts.naiMetadata || null;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { meta = null; }
    }
    if (!meta || typeof meta !== 'object') {
        const post = getExplorePostFromCache(postId);
        meta = post?.image?.nai_metadata || null;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch { meta = null; }
        }
    }

    const hasEmbeddableMeta = !!(meta && typeof meta === 'object' && (
        meta.Comment || meta.Source || meta.Software || meta.Description || meta.Title
    ));

    if (fs.existsSync(pngPath) && !opts.forceRefresh) {
        let cachedHasComment = false;
        if (pngMetadata && hasEmbeddableMeta) {
            try {
                const existing = fs.readFileSync(pngPath);
                const read = pngMetadata.readMetadata?.(existing);
                cachedHasComment = !!(read?.tEXt?.Comment || read?.tEXt?.Source);
            } catch {
                cachedHasComment = false;
            }
        } else if (!hasEmbeddableMeta) {
            cachedHasComment = true; // nothing to embed — cache ok
        }
        if (cachedHasComment || !hasEmbeddableMeta) {
            return {
                publicUrl: `/cache/explore_files/${pngName}`,
                filePath: pngPath,
                fromCache: true,
                mime: 'image/png',
                hasMetadata: cachedHasComment
            };
        }
        // Stale PNG without tEXt — rebuild with metadata
        try { fs.unlinkSync(pngPath); } catch { /* ignore */ }
    }

    const flightKey = `png:${postId}`;
    if (inFlightImages.has(flightKey)) {
        return inFlightImages.get(flightKey);
    }

    const work = (async () => {
        const blobInfo = await ensureExploreImage(postId, 'blob', opts);
        const sharp = require('sharp');
        let pngBuffer = await sharp(blobInfo.filePath).png().toBuffer();

        let embedded = false;
        if (pngMetadata && hasEmbeddableMeta) {
            const keys = ['Comment', 'Source', 'Software', 'Description', 'Title'];
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                let val = meta[key];
                if (val == null || val === '') continue;
                if (typeof val === 'object') val = JSON.stringify(val);
                // insertTextChunk: modules/pngMetadata.js
                pngBuffer = pngMetadata.insertTextChunk(pngBuffer, key, String(val));
                embedded = true;
            }
        }

        fs.writeFileSync(pngPath, pngBuffer);
        return {
            publicUrl: `/cache/explore_files/${pngName}`,
            filePath: pngPath,
            fromCache: false,
            mime: 'image/png',
            hasMetadata: embedded
        };
    })();

    inFlightImages.set(flightKey, work);
    try {
        return await work;
    } finally {
        inFlightImages.delete(flightKey);
    }
}

/**
 * Ensure thumbnail, blob, or PNG export is on disk under .cache/explore_files/
 * @returns {{ publicUrl: string, filePath: string, fromCache: boolean, mime?: string }}
 */
async function ensureExploreImage(id, kind, opts = {}) {
    const postId = String(id || '').trim();
    if (!postId) throw new Error('Missing explore post id');
    if (kind === 'png') {
        return ensureExplorePngExport(postId, opts);
    }
    if (kind !== 'thumbnail' && kind !== 'blob') {
        throw new Error('kind must be thumbnail, blob, or png');
    }
    if (!imageCacheDir) {
        throw new Error('Explore image cache not initialized');
    }

    const existing = findExistingImageFile(kind, postId);
    if (existing) {
        const base = path.basename(existing);
        return {
            publicUrl: `/cache/explore_files/${base}`,
            filePath: existing,
            fromCache: true
        };
    }

    const flightKey = `${kind}:${postId}`;
    if (inFlightImages.has(flightKey)) {
        return inFlightImages.get(flightKey);
    }

    const work = (async () => {
        const apiKey = opts.apiKey || resolveApiKey();
        if (!apiKey) {
            throw new Error('NovelAI API key is not configured');
        }
        const apiKeyManager = opts.apiKeyManager || null;
        if (apiKeyManager && apiKeyManager.isServiceLocked('novelai')) {
            throw new Error('NovelAI is temporarily locked after repeated API errors');
        }

        await waitUpstreamGap();
        lastUpstreamAt = Date.now();

        const upstreamPath = kind === 'blob'
            ? `/post/blob/${postId}`
            : `/post/thumbnail/${postId}`;
        const res = await browserRequest({
            hostname: 'explore.novelai.net',
            port: 443,
            path: upstreamPath,
            method: 'GET',
            headers: {
                accept: 'image/webp,image/*,*/*',
                authorization: `Bearer ${apiKey}`
            }
        }, null, { acceptResType: 'image', json: false });

        if (res.statusCode !== 200) {
            if (apiKeyManager) {
                apiKeyManager.recordApiFailure('novelai', res.statusCode, `explore ${kind} HTTP ${res.statusCode}`);
            }
            throw new Error(`Failed to fetch explore ${kind}: HTTP ${res.statusCode}`);
        }

        if (apiKeyManager) {
            apiKeyManager.recordApiSuccess('novelai');
        }

        const ext = extFromContentType(res.headers['content-type']);
        const prefix = kind === 'blob' ? `blob_${postId}` : `thumb_${postId}`;
        const fileName = `${prefix}${ext}`;
        const filePath = path.join(imageCacheDir, fileName);
        fs.writeFileSync(filePath, res.body);

        return {
            publicUrl: `/cache/explore_files/${fileName}`,
            filePath,
            fromCache: false
        };
    })();

    inFlightImages.set(flightKey, work);
    try {
        return await work;
    } finally {
        inFlightImages.delete(flightKey);
    }
}

/**
 * @param {object} options
 * @param {string} [options.sort] new|top|hot
 * @param {string} [options.period] day|week|month
 * @param {string} [options.search]
 * @param {number} [options.page] 1-based
 * @param {number} [options.offset]
 * @param {number} [options.limit]
 * @param {boolean} [options.forceRefresh]
 * @param {function} [options.getApiKey]
 * @param {object} [options.apiKeyManager]
 */
function decodeExploreCursor(cursor) {
    const raw = String(cursor || '').trim();
    if (!raw) return null;
    try {
        const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        const offset = Math.max(0, parseInt(json && json.o, 10) || 0);
        if (!json || typeof json !== 'object') return null;
        return { offset };
    } catch {
        return null;
    }
}

function encodeExploreCursor(offset) {
    const o = Math.max(0, parseInt(offset, 10) || 0);
    return Buffer.from(JSON.stringify({ o }), 'utf8').toString('base64url');
}

async function getExploreGallery(options = {}) {
    if (options.likedBySelf) {
        return getExploreLikedGallery(options);
    }

    const requestedSort = normalizeSort(options.sort);
    const period = normalizePeriod(options.period);
    const search = (options.search || '').trim();
    const model = normalizeExploreModel(options.model);
    const aspect = (options.aspect || '').trim().toLowerCase();
    const vt = (options.vt || '').trim().toLowerCase();
    const creatorId = (options.creatorId || '').trim();
    const honorPeriod = !!options.honorPeriod;
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || PAGE_LIMIT, 1), PAGE_LIMIT);

    let offset = 0;
    if (options.cursor) {
        const decoded = decodeExploreCursor(options.cursor);
        if (!decoded) {
            const err = new Error('Invalid explore cursor');
            err.status = 400;
            throw err;
        }
        offset = decoded.offset;
    } else if (options.offset != null) {
        offset = Math.max(0, parseInt(options.offset, 10) || 0);
    } else if (options.page != null) {
        const page = Math.max(1, parseInt(options.page, 10) || 1);
        offset = (page - 1) * limit;
    }

    const previewBody = buildSearchBody({
        sort: creatorId ? 'new' : requestedSort,
        period,
        search,
        model,
        aspect,
        vt,
        creatorId,
        offset: 0,
        limit,
        honorPeriod,
        randomSalt: options.randomSalt
    });
    const sort = previewBody.effectiveSort || requestedSort;

    const baseParams = {
        sort: creatorId ? 'new' : sort,
        period,
        search: exploreSearchTags(search).join(','),
        model,
        aspect,
        vt,
        creatorId,
        honorPeriod: honorPeriod ? 1 : 0
    };

    const { apiKey, apiKeyManager } = await resolveExploreApiKey(options);

    const fetchRawPage = async (fetchOffset, pageLimit) => {
        const params = { ...baseParams, offset: fetchOffset, limit: pageLimit };
        const key = cacheKeyFromParams(params);

        if (!options.forceRefresh) {
            const hit = getCached(key);
            if (hit) {
                const rawResults = (hit.rawResults || hit.results || [])
                    .map((r) => refreshNormalizedResult(r))
                    .filter(Boolean);
                return {
                    rawResults,
                    pagination: hit.pagination || { limit: pageLimit, offset: fetchOffset, total: null },
                    fromCache: true,
                    cachedAt: hit.cachedAt || null
                };
            }
        }

        if (inFlightSearch.has(key)) {
            const shared = await inFlightSearch.get(key);
            return {
                rawResults: (shared.rawResults || shared.results || []).map((r) => refreshNormalizedResult(r)),
                pagination: shared.pagination,
                fromCache: !!shared.fromCache,
                cachedAt: shared.cachedAt || null
            };
        }

        const work = (async () => {
            const prepared = buildSearchBody({
                ...params,
                honorPeriod,
                randomSalt: options.randomSalt
            });
            const body = {
                orderers: prepared.orderers,
                selectors: prepared.selectors,
                pagination: prepared.pagination
            };
            const raw = await postSearch(body, apiKey, apiKeyManager);
            const rawResults = Array.isArray(raw.results)
                ? raw.results.map(normalizeResult).filter(Boolean)
                : [];
            const pagination = raw.pagination || { limit: pageLimit, offset: fetchOffset, total: null };
            const now = Date.now();
            const payload = {
                // Keep unfiltered results in cache so later local bans can backfill correctly
                rawResults,
                results: rawResults,
                pagination: {
                    limit: pagination.limit != null ? pagination.limit : pageLimit,
                    offset: pagination.offset != null ? pagination.offset : fetchOffset,
                    total: pagination.total != null ? pagination.total : null
                },
                sort: baseParams.sort,
                period: creatorId || sort === 'new' ? null : period,
                search,
                creatorId: creatorId || null,
                fromCache: false,
                cachedAt: now,
                expiresAt: now + CACHE_TTL_MS
            };
            setCache(key, payload);
            return payload;
        })();

        inFlightSearch.set(key, work);
        try {
            const payload = await work;
            return {
                rawResults: payload.rawResults || payload.results || [],
                pagination: payload.pagination,
                fromCache: false,
                cachedAt: payload.cachedAt
            };
        } finally {
            inFlightSearch.delete(key);
        }
    };

    const collected = await collectFilteredResults({
        startOffset: offset,
        limit,
        fetchRawPage
    });

    // Gentle thumb prefetch (do not block response). Studio feed warms thumbs once itself.
    if (!options.skipThumbPrefetch) {
        const ids = collected.results.map((r) => r.id);
        setTimeout(() => {
            prefetchThumbnails(ids, apiKey, apiKeyManager).catch(() => {});
        }, 0);
    }

    const now = Date.now();
    return {
        results: collected.results,
        pagination: collected.pagination,
        sort: baseParams.sort,
        period: creatorId ? null : (previewBody.periodApplied ? period : null),
        periodApplied: !!previewBody.periodApplied,
        search,
        creatorId: creatorId || null,
        fromCache: collected.fromCache,
        cachedAt: collected.cachedAt || now,
        expiresAt: (collected.cachedAt || now) + CACHE_TTL_MS,
        backfillPages: collected.backfillPages
    };
}

const EXPLORE_UPLOAD_RESTRICTION_MESSAGES = {
    not_novelai: 'Only images generated by NovelAI can be uploaded.',
    img2img: 'Image-to-Image generated images are not allowed in NovelAI Explore.',
    inpainting: 'Inpainting generated images are not allowed in NovelAI Explore.',
    character_reference: 'Character Reference generated images are not allowed in NovelAI Explore.',
    director_tools: 'Director Tools generated images are not allowed in NovelAI Explore.'
};

const EXPLORE_UPLOAD_TITLE_MIN = 3;
const EXPLORE_UPLOAD_TITLE_MAX = 40;

/**
 * Server kill switch — must be explicitly true (config novelaiExplore.uploadsEnabled).
 * Missing / false / anything else keeps uploads disabled.
 */
function isExploreUploadsEnabled(options = {}) {
    return options.uploadsEnabled === true;
}

function assertExploreUploadsEnabled(options = {}) {
    if (isExploreUploadsEnabled(options)) return;
    const err = new Error('NovelAI Explore uploads are disabled on this server.');
    err.code = 'EXPLORE_UPLOADS_DISABLED';
    throw err;
}

/**
 * Match NovelAI Explore client upload checks (gallery layout K()).
 * Software must include "NovelAI"; Comment.request_type / director refs / req_type block upload.
 */
function checkExploreUploadEligibilityFromMetadata(tEXtLike) {
    const software = String(tEXtLike?.Software || '');
    if (!software.includes('NovelAI')) {
        return {
            type: 'not_novelai',
            message: EXPLORE_UPLOAD_RESTRICTION_MESSAGES.not_novelai
        };
    }

    let comment = null;
    try {
        if (tEXtLike?.Comment) {
            comment = typeof tEXtLike.Comment === 'string'
                ? JSON.parse(tEXtLike.Comment)
                : tEXtLike.Comment;
        }
    } catch {
        // NovelAI client treats parse failure as no restriction
        return null;
    }
    if (!comment || typeof comment !== 'object') return null;

    if (comment.request_type === 'Img2ImgRequest') {
        return { type: 'img2img', message: EXPLORE_UPLOAD_RESTRICTION_MESSAGES.img2img };
    }
    if (comment.request_type === 'NativeInfillingRequest') {
        return { type: 'inpainting', message: EXPLORE_UPLOAD_RESTRICTION_MESSAGES.inpainting };
    }
    if (Array.isArray(comment.director_reference_strengths)
        && comment.director_reference_strengths.length > 0) {
        return {
            type: 'character_reference',
            message: EXPLORE_UPLOAD_RESTRICTION_MESSAGES.character_reference
        };
    }
    if (comment.req_type !== undefined) {
        return {
            type: 'director_tools',
            message: EXPLORE_UPLOAD_RESTRICTION_MESSAGES.director_tools
        };
    }
    return null;
}

function normalizeExploreUploadTitle(title) {
    return String(title || '').trim();
}

function validateExploreUploadTitle(title) {
    const trimmed = normalizeExploreUploadTitle(title);
    if (trimmed.length < EXPLORE_UPLOAD_TITLE_MIN || trimmed.length > EXPLORE_UPLOAD_TITLE_MAX) {
        return {
            ok: false,
            title: trimmed,
            message: `Title must be between ${EXPLORE_UPLOAD_TITLE_MIN} and ${EXPLORE_UPLOAD_TITLE_MAX} characters long.`
        };
    }
    return { ok: true, title: trimmed, message: null };
}

function resolveExploreUploadFilePath(filename, imagesDir) {
    const name = path.basename(String(filename || '').trim());
    if (!name || name !== String(filename || '').trim()) {
        throw new Error('Invalid filename');
    }
    if (!/\.(png|webp)$/i.test(name)) {
        const err = new Error('Invalid image format, must be PNG or WEBP.');
        err.code = 'EXPLORE_INVALID_FORMAT';
        throw err;
    }
    if (!imagesDir) throw new Error('Images directory not configured');
    const filePath = path.join(imagesDir, name);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Image not found: ${name}`);
    }
    return { filename: name, filePath };
}

/**
 * Preflight: registration + NovelAI metadata restrictions for a workspace image.
 * Does not upload. Honors novelaiExplore.uploadsEnabled kill switch first.
 */
async function checkExploreUploadImage(filename, options = {}) {
    assertExploreUploadsEnabled(options);

    const { filePath, filename: safeName } = resolveExploreUploadFilePath(
        filename,
        options.imagesDir
    );

    const userSelf = await getExploreUserSelf({
        forceRefresh: !!options.forceRefreshUser,
        ...options
    });
    if (!userSelf?.registered) {
        const err = new Error('Explore registration required');
        err.code = 'EXPLORE_NOT_REGISTERED';
        err.registerUrl = userSelf?.registerUrl || 'https://novelai.net/explore/register';
        throw err;
    }
    if (userSelf?.user?.is_currently_banned) {
        const err = new Error('Your NovelAI Explore account is currently banned.');
        err.code = 'EXPLORE_BANNED';
        throw err;
    }

    const buffer = fs.readFileSync(filePath);
    const pngMetadata = options.pngMetadata;
    let tEXt = null;
    if (pngMetadata && typeof pngMetadata.readMetadata === 'function') {
        const meta = pngMetadata.readMetadata(buffer);
        tEXt = meta?.tEXt || null;
    }
    if (!tEXt) {
        return {
            filename: safeName,
            registered: true,
            uploadsEnabled: true,
            restriction: {
                type: 'not_novelai',
                message: EXPLORE_UPLOAD_RESTRICTION_MESSAGES.not_novelai
            },
            canUpload: false
        };
    }

    const restriction = checkExploreUploadEligibilityFromMetadata(tEXt);
    return {
        filename: safeName,
        registered: true,
        uploadsEnabled: true,
        restriction,
        canUpload: !restriction
    };
}

/**
 * POST explore.novelai.net/post/image — { title, blob: base64 }.
 * Same client-side checks NovelAI Explore uses before submit.
 * Blocked unless options.uploadsEnabled === true (config novelaiExplore.uploadsEnabled).
 */
async function uploadExploreImage(filename, title, options = {}) {
    assertExploreUploadsEnabled(options);

    const titleCheck = validateExploreUploadTitle(title);
    if (!titleCheck.ok) {
        const err = new Error(titleCheck.message);
        err.code = 'EXPLORE_TITLE_INVALID';
        throw err;
    }

    const preflight = await checkExploreUploadImage(filename, options);
    if (preflight.restriction) {
        const err = new Error(preflight.restriction.message);
        err.code = 'EXPLORE_UPLOAD_RESTRICTED';
        err.restriction = preflight.restriction;
        throw err;
    }

    const { filePath, filename: safeName } = resolveExploreUploadFilePath(
        filename,
        options.imagesDir
    );
    const buffer = fs.readFileSync(filePath);
    const { apiKey, apiKeyManager } = await resolveExploreApiKey(options);

    await waitUpstreamGap();
    lastUpstreamAt = Date.now();

    const payload = JSON.stringify({
        title: titleCheck.title,
        blob: buffer.toString('base64')
    });

    const res = await browserRequest({
        hostname: 'explore.novelai.net',
        port: 443,
        path: '/post/image',
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiKey}`
        }
    }, Buffer.from(payload), { acceptResType: 'json', timeoutMs: 120000 });

    let bodyJson = null;
    try {
        bodyJson = JSON.parse(res.body.toString('utf8'));
    } catch {
        bodyJson = null;
    }

    if (res.statusCode === 403) {
        const msg = bodyJson?.message || bodyJson?.error || 'Forbidden';
        if (/not registered/i.test(String(msg))) {
            userSelfCache = null;
            const err = new Error('User not registered');
            err.code = 'EXPLORE_NOT_REGISTERED';
            err.registerUrl = 'https://novelai.net/explore/register';
            throw err;
        }
        if (apiKeyManager) apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        throw new Error(msg);
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
        const msg = bodyJson?.message || bodyJson?.error || `HTTP ${res.statusCode}`;
        if (apiKeyManager) apiKeyManager.recordApiFailure('novelai', res.statusCode, msg);
        const err = new Error(msg);
        err.code = 'EXPLORE_UPLOAD_FAILED';
        err.statusCode = res.statusCode;
        throw err;
    }

    if (apiKeyManager) apiKeyManager.recordApiSuccess('novelai');

    const id = bodyJson?.id != null ? String(bodyJson.id) : '';
    return {
        success: true,
        id,
        title: titleCheck.title,
        filename: safeName,
        post: bodyJson && typeof bodyJson === 'object' ? bodyJson : { id },
        exploreUrl: id ? `https://novelai.net/explore/image/${id}` : null
    };
}

/** Studio empty-state Explorer: Top for Week, then Month posts not already in that week list. */
const STUDIO_EXPLORE_PAGES = 3;
const STUDIO_EXPLORE_REFRESH_MS = 12 * 60 * 60 * 1000;
const STUDIO_FEED_FILE = 'studio_explore_feed.json';
const STUDIO_FEED_KIND = 'top-week-month';

let studioFeedRefreshPromise = null;
let studioFeedTimer = null;
let studioFeedScheduleStarted = false;

function studioFeedPath() {
    if (!pageCacheDir) return null;
    return path.join(pageCacheDir, STUDIO_FEED_FILE);
}

function thumbExtById(ids) {
    const wanted = new Set(ids);
    const map = new Map();
    if (!imageCacheDir || !wanted.size) return map;
    let names = [];
    try {
        names = fs.readdirSync(imageCacheDir);
    } catch {
        return map;
    }
    names.forEach((name) => {
        const match = /^thumb_([0-9a-fA-F-]{36})(\.[a-zA-Z0-9]+)?$/.exec(name);
        if (!match || !wanted.has(match[1])) return;
        if (!map.has(match[1])) map.set(match[1], match[2] || '');
    });
    return map;
}

function slimStudioExploreItem(row, ext) {
    if (!row || !row.id) return null;
    const item = {
        id: String(row.id),
        title: row.title || '',
        thumbnailUrl: publicThumbUrl(row.id, ext || ''),
        width: row.width || row.image?.width || null,
        height: row.height || row.image?.height || null,
        creatorName: row.creatorName || row.creator?.name || ''
    };
    if (row.period === 'week' || row.period === 'month') item.period = row.period;
    return item;
}

function readStudioExploreFeed() {
    const filePath = studioFeedPath();
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const rows = Array.isArray(raw.results) ? raw.results : [];
        const exts = thumbExtById(rows.map((row) => row && row.id).filter(Boolean));
        const results = rows.map((row) => slimStudioExploreItem(row, exts.get(String(row.id)) || '')).filter(Boolean);
        return {
            results,
            refreshedAt: raw.refreshedAt || null,
            pageCount: raw.pageCount || STUDIO_EXPLORE_PAGES,
            feedKind: raw.feedKind || null
        };
    } catch (e) {
        console.warn('novelaiExploreGallery: studio feed read failed', e.message);
        return null;
    }
}

function writeStudioExploreFeed(payload) {
    const filePath = studioFeedPath();
    if (!filePath) return;
    try {
        const part = `${filePath}.part`;
        fs.writeFileSync(part, JSON.stringify(payload));
        fs.renameSync(part, filePath);
    } catch (e) {
        console.warn('novelaiExploreGallery: studio feed write failed', e.message);
    }
}

function studioFeedIsCurrent(feed) {
    return Boolean(feed && feed.feedKind === STUDIO_FEED_KIND && feed.results && feed.results.length);
}

async function appendStudioExplorePeriod(period, options, seen, merged) {
    let pageError = null;
    for (let page = 1; page <= STUDIO_EXPLORE_PAGES; page++) {
        try {
            const data = await getExploreGallery({
                sort: 'top',
                period,
                page,
                limit: PAGE_LIMIT,
                forceRefresh: true,
                skipThumbPrefetch: true,
                getApiKey: options.getApiKey,
                apiKey: options.apiKey,
                apiKeyManager: options.apiKeyManager
            });
            (data.results || []).forEach((row) => {
                if (!row?.id || seen.has(row.id)) return;
                seen.add(row.id);
                const slim = slimStudioExploreItem(row, '');
                if (!slim) return;
                slim.period = period;
                merged.push(slim);
            });
        } catch (e) {
            pageError = e;
            console.warn(`novelaiExploreGallery: studio feed ${period} page ${page} failed`, e.message);
            break;
        }
    }
    return pageError;
}

async function refreshStudioExploreFeed(options = {}) {
    if (studioFeedRefreshPromise) return studioFeedRefreshPromise;
    studioFeedRefreshPromise = (async () => {
        const merged = [];
        const seen = new Set();
        const weekError = await appendStudioExplorePeriod('week', options, seen, merged);
        const monthError = await appendStudioExplorePeriod('month', options, seen, merged);
        if (!merged.length) {
            throw weekError || monthError || new Error('Studio Explorer feed is empty');
        }
        const payload = {
            refreshedAt: Date.now(),
            pageCount: STUDIO_EXPLORE_PAGES,
            feedKind: STUDIO_FEED_KIND,
            results: merged
        };
        writeStudioExploreFeed(payload);
        const ids = merged.map((row) => row.id);
        setTimeout(() => {
            resolveExploreApiKey(options).then(({ apiKey, apiKeyManager }) => {
                prefetchThumbnails(ids, apiKey, apiKeyManager).catch(() => {});
            }).catch((e) => {
                console.warn('novelaiExploreGallery: studio thumb prefetch skipped', e.message);
            });
        }, 0);
        const weekCount = merged.filter((row) => row.period === 'week').length;
        const monthCount = merged.filter((row) => row.period === 'month').length;
        console.log(`✓ Studio Explorer feed cached (${merged.length} posts, top week ${weekCount} + month ${monthCount})`);
        return readStudioExploreFeed() || payload;
    })().finally(() => {
        studioFeedRefreshPromise = null;
    });
    return studioFeedRefreshPromise;
}

async function getStudioExploreFeed(options = {}) {
    const existing = readStudioExploreFeed();
    if (!studioFeedRefreshPromise && !studioFeedIsCurrent(existing)) {
        refreshStudioExploreFeed(options).catch((e) => {
            console.warn('novelaiExploreGallery: studio feed refresh failed', e.message);
        });
    }
    if (studioFeedRefreshPromise) {
        try {
            await studioFeedRefreshPromise;
        } catch (e) {
            if (existing && existing.results.length) {
                return { ...existing, fromCache: true, error: e.message };
            }
            throw e;
        }
        const fresh = readStudioExploreFeed();
        if (fresh && fresh.results.length) return { ...fresh, fromCache: false };
    }
    if (existing && existing.results.length) return { ...existing, fromCache: true };
    const after = readStudioExploreFeed();
    if (after) return { ...after, fromCache: false };
    return { results: [], refreshedAt: null, pageCount: STUDIO_EXPLORE_PAGES, feedKind: null, fromCache: false };
}

function startStudioExploreFeedSchedule() {
    if (studioFeedScheduleStarted) return;
    studioFeedScheduleStarted = true;
    const run = () => {
        refreshStudioExploreFeed().catch((e) => {
            console.warn('novelaiExploreGallery: studio feed refresh failed', e.message);
            const retry = setTimeout(() => {
                refreshStudioExploreFeed().catch((err) => {
                    console.warn('novelaiExploreGallery: studio feed retry failed', err.message);
                });
            }, 30000);
            if (retry.unref) retry.unref();
        });
    };
    // After listen. A refresh started inside boot init times out while the event loop is busy.
    const bootTimer = setTimeout(run, 60000);
    if (bootTimer.unref) bootTimer.unref();
    studioFeedTimer = setInterval(run, STUDIO_EXPLORE_REFRESH_MS);
    if (studioFeedTimer.unref) studioFeedTimer.unref();
    console.log('✓ Studio Explorer feed scheduled (boot + 12h, top week then month)');
}

function clearExploreGalleryCache(options = {}) {
    memoryCache.clear();
    let clearedPages = 0;
    if (pageCacheDir && fs.existsSync(pageCacheDir)) {
        try {
            for (const name of fs.readdirSync(pageCacheDir)) {
                // Keep local preference / capture files across gallery cache clears
                if (name === 'undesired_ids.json'
                    || name === 'blocked_creators.json'
                    || name === 'user_self_sample.json') continue;
                if (name.endsWith('.json')) {
                    fs.unlinkSync(path.join(pageCacheDir, name));
                    clearedPages += 1;
                }
            }
        } catch (e) {
            console.warn('novelaiExploreGallery: clear page cache failed', e.message);
        }
    }

    let clearedImages = 0;
    if (options.clearImages && imageCacheDir && fs.existsSync(imageCacheDir)) {
        try {
            for (const name of fs.readdirSync(imageCacheDir)) {
                fs.unlinkSync(path.join(imageCacheDir, name));
                clearedImages += 1;
            }
        } catch (e) {
            console.warn('novelaiExploreGallery: clear image cache failed', e.message);
        }
    }

    setTimeout(() => {
        refreshStudioExploreFeed().catch((e) => {
            console.warn('novelaiExploreGallery: studio feed refresh after clear failed', e.message);
        });
    }, 0);

    return { cleared: true, clearedPages, clearedImages };
}

function getExplorePostFromCache(id) {
    const postId = String(id || '').trim();
    if (!postId || !pageCacheDir) return null;
    try {
        for (const name of fs.readdirSync(pageCacheDir)) {
            if (!name.endsWith('.json')) continue;
            const entry = JSON.parse(fs.readFileSync(path.join(pageCacheDir, name), 'utf8'));
            const results = entry?.payload?.results || [];
            const hit = results.find((r) => r.id === postId);
            if (hit) {
                return refreshNormalizedResult(hit);
            }
        }
    } catch {
        /* ignore */
    }
    return null;
}

function parseExploreMetadata(raw) {
    if (!raw) return null;
    let meta = raw;
    if (typeof raw === 'string') {
        try {
            meta = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!meta || typeof meta !== 'object') return null;
    let comment = meta.Comment || meta.comment || null;
    if (typeof comment === 'string') {
        try {
            comment = JSON.parse(comment);
        } catch {
            comment = null;
        }
    }
    const merged = {
        ...(comment && typeof comment === 'object' ? comment : {}),
        ...(meta.Comment || meta.comment ? {} : meta)
    };
    if (meta.Source || meta.source) merged.source = meta.Source || meta.source;
    if (meta.Description && !merged.prompt && !merged.Description) merged.Description = meta.Description;
    if (!merged.prompt) {
        merged.prompt = (comment && comment.v4_prompt && comment.v4_prompt.caption && comment.v4_prompt.caption.base_caption)
            || meta.Description
            || '';
    }
    if (!merged.uc) {
        merged.uc = (comment && comment.v4_negative_prompt && comment.v4_negative_prompt.caption && comment.v4_negative_prompt.caption.base_caption)
            || '';
    }
    return merged;
}

function exploreCenter(cap) {
    if (!cap || typeof cap !== 'object') return { x: null, y: null };
    const raw = Array.isArray(cap.centers) ? cap.centers[0] : cap.center;
    if (Array.isArray(raw)) return { x: raw[0] ?? null, y: raw[1] ?? null };
    if (raw && typeof raw === 'object') return { x: raw.x ?? null, y: raw.y ?? null };
    return { x: null, y: null };
}

function exploreCharacterRows(meta) {
    if (!meta) return [];
    const caps = meta.v4_prompt && meta.v4_prompt.caption && meta.v4_prompt.caption.char_captions;
    const negs = meta.v4_negative_prompt && meta.v4_negative_prompt.caption && meta.v4_negative_prompt.caption.char_captions;
    const positive = Array.isArray(caps) ? caps : [];
    const negative = Array.isArray(negs) ? negs : [];
    const count = Math.max(positive.length, negative.length);
    const rows = [];
    for (let i = 0; i < count; i++) {
        const prompt = positive[i] && positive[i].char_caption ? String(positive[i].char_caption) : '';
        const uc = negative[i] && negative[i].char_caption ? String(negative[i].char_caption) : '';
        if (!prompt && !uc) continue;
        const center = exploreCenter(positive[i] || negative[i]);
        rows.push({ prompt, uc, x: center.x, y: center.y });
    }
    return rows;
}

function exploreHasVibe(meta) {
    if (!meta || typeof meta !== 'object') return false;
    if (Array.isArray(meta.reference_image_multiple) && meta.reference_image_multiple.length > 0) return true;
    if (Array.isArray(meta.reference_strength_multiple) && meta.reference_strength_multiple.some((n) => Number(n) > 0)) return true;
    if (Array.isArray(meta.reference_information_extracted_multiple) && meta.reference_information_extracted_multiple.length > 0) return true;
    if (meta.vibe_transfer || meta.vibeTransfer) return true;
    return false;
}

function exploreModelFromMeta(meta) {
    if (!meta) return null;
    const direct = meta.model || meta.model_name || meta.diffusion_model;
    if (direct) return String(direct);
    const source = String(meta.source || meta.Source || '');
    if (/nai-diffusion/i.test(source)) return source;
    return source || null;
}

function exploreHashFromMeta(meta) {
    if (!meta) return null;
    const hash = meta.hash || meta.image_hash || meta.signed_hash || null;
    return hash == null || hash === '' ? null : String(hash);
}

const EXPLORE_COMPACT_KEYS = [
    'id', 'creator', 'timestamp', 'model', 'hash', 'sampler', 'steps', 'guidance',
    'rescale', 'seed', 'quality', 'ucPreset', 'prompt', 'uc', 'characters', 'vt',
    'likes', 'previewUrl', 'thumbnailId'
];

function compactExplorePost(post, options = {}) {
    const row = post && typeof post === 'object' ? post : {};
    const meta = parseExploreMetadata(row.image && row.image.nai_metadata) || parseExploreMetadata(row.nai_metadata) || {};
    const id = row.id != null ? String(row.id) : '';
    const creator = row.creator && typeof row.creator === 'object'
        ? { id: row.creator.id != null ? String(row.creator.id) : null, name: row.creator.name || '' }
        : { id: row.creator_id != null ? String(row.creator_id) : null, name: '' };
    const compact = {
        id,
        creator,
        timestamp: row.created_at || row.timestamp || null,
        model: exploreModelFromMeta(meta),
        hash: exploreHashFromMeta(meta),
        sampler: meta.sampler != null ? meta.sampler : null,
        steps: meta.steps != null ? meta.steps : null,
        guidance: meta.scale != null ? meta.scale : (meta.guidance != null ? meta.guidance : null),
        rescale: meta.cfg_rescale != null ? meta.cfg_rescale : (meta.rescale != null ? meta.rescale : null),
        seed: meta.seed != null ? meta.seed : null,
        quality: meta.qualityToggle != null ? meta.qualityToggle : (meta.append_quality != null ? meta.append_quality : (meta.quality_preset != null ? meta.quality_preset : null)),
        ucPreset: meta.ucPreset != null ? meta.ucPreset : (meta.uc_preset != null ? meta.uc_preset : (meta.append_uc != null ? meta.append_uc : null)),
        prompt: meta.prompt || row.prompt || '',
        uc: meta.uc || row.uc || '',
        characters: exploreCharacterRows(meta),
        vt: exploreHasVibe(meta),
        likes: readExploreLikeCount(row),
        previewUrl: row.thumbnailUrl || (id ? publicThumbUrl(id, '') : null),
        thumbnailId: id || null
    };
    if (row.prompt && !compact.prompt) compact.prompt = row.prompt;
    const extra = {};
    if (options.includeImage && (row.imageUrl || row.blobUrl)) {
        extra.imageUrl = row.imageUrl || row.blobUrl;
    }
    const requested = Array.isArray(options.fields) ? options.fields : [];
    requested.forEach((name) => {
        const key = String(name || '').trim();
        if (!key || EXPLORE_COMPACT_KEYS.includes(key) || key === 'imageUrl' || key === 'nai_metadata' || key === 'blobUrl') return;
        if (key === 'title') extra.title = row.title || '';
        else if (key === 'description') extra.description = row.description || '';
        else if (key === 'width') extra.width = row.image && row.image.width != null ? row.image.width : null;
        else if (key === 'height') extra.height = row.image && row.image.height != null ? row.image.height : null;
        else if (key === 'blurhash') extra.blurhash = row.image && row.image.blurhash ? row.image.blurhash : null;
        else if (key === 'likedBySelf') extra.likedBySelf = row.liked_by_self == null ? null : !!row.liked_by_self;
        else if (key === 'noiseSchedule') extra.noiseSchedule = meta.noise_schedule || null;
        else if (key === 'source') extra.source = meta.source || null;
        else if (Object.prototype.hasOwnProperty.call(row, key)) extra[key] = row[key];
    });
    if (requested.includes('nai_metadata') && row.image && row.image.nai_metadata != null) {
        extra.nai_metadata = row.image.nai_metadata;
    }
    return { ...compact, ...extra };
}

function shapeExploreSearchForAgent(data, input = {}) {
    const mode = String((input && input.mode) || 'compact').toLowerCase() === 'full' ? 'full' : 'compact';
    const rows = Array.isArray(data && data.results) ? data.results
        : (Array.isArray(data && data.rawResults) ? data.rawResults : []);
    const extraFields = mode === 'full'
        ? ['title', 'description', 'width', 'height', 'likedBySelf', 'noiseSchedule']
        : [];
    const requested = extraFields.concat(Array.isArray(input && input.fields) ? input.fields : []);
    const posts = rows.map((row) => compactExplorePost(row, { fields: requested, includeImage: false }));
    const pagination = data && data.pagination ? data.pagination : {};
    const hasMore = !!pagination.hasMore;
    return {
        success: true,
        mode,
        posts,
        nextCursor: hasMore ? encodeExploreCursor(pagination.nextOffset) : null,
        pagination: {
            limit: pagination.limit != null ? pagination.limit : null,
            offset: pagination.offset != null ? pagination.offset : null,
            total: pagination.total != null ? pagination.total : null,
            hasMore
        },
        sort: data && data.sort ? data.sort : null,
        period: data && data.periodApplied ? data.period : (data && data.period ? data.period : null),
        periodApplied: !!(data && data.periodApplied),
        search: data && data.search ? data.search : ''
    };
}

const EXPLORE_COUNT_MAX_PAGES = 6;

function exploreCreatorId(row) {
    if (!row || typeof row !== 'object') return '';
    if (row.creator && row.creator.id != null) return String(row.creator.id);
    if (row.creator_id != null) return String(row.creator_id);
    return '';
}

function exploreInTimeWindow(row, fromMs, toMs) {
    if (fromMs == null && toMs == null) return true;
    const ts = Date.parse(row && (row.created_at || row.timestamp));
    if (!Number.isFinite(ts)) return false;
    if (fromMs != null && ts < fromMs) return false;
    if (toMs != null && ts > toMs) return false;
    return true;
}

async function scanExploreCount(search, base, windowMs) {
    const creators = new Set();
    let scanned = 0;
    let matched = 0;
    let posts = null;
    let offset = 0;
    let complete = false;
    const customWindow = windowMs.fromMs != null || windowMs.toMs != null;
    for (let page = 0; page < EXPLORE_COUNT_MAX_PAGES; page++) {
        const data = await search({
            ...base,
            offset,
            limit: PAGE_LIMIT,
            skipThumbPrefetch: true,
            honorPeriod: !customWindow
        });
        const rows = Array.isArray(data && data.results) ? data.results
            : (Array.isArray(data && data.rawResults) ? data.rawResults : []);
        rows.forEach((row) => {
            scanned += 1;
            const ts = Date.parse(row && (row.created_at || row.timestamp));
            if (base.creatorId && windowMs.fromMs != null && Number.isFinite(ts) && ts < windowMs.fromMs) {
                complete = true;
                return;
            }
            if (!exploreInTimeWindow(row, windowMs.fromMs, windowMs.toMs)) return;
            matched += 1;
            const id = exploreCreatorId(row);
            if (id) creators.add(id);
        });
        const total = data && data.pagination && data.pagination.total;
        if (!customWindow && total != null && posts == null) posts = Number(total);
        const hasMore = !!(data && data.pagination && data.pagination.hasMore);
        if (!hasMore || rows.length === 0 || complete) {
            complete = true;
            break;
        }
        offset = data.pagination.nextOffset != null ? data.pagination.nextOffset : offset + rows.length;
    }
    if (customWindow) {
        posts = matched;
    } else if (posts == null) {
        posts = matched;
        complete = complete || scanned === matched;
    }
    const creatorsComplete = complete && (posts == null || scanned >= posts || customWindow);
    return {
        posts: Number.isFinite(posts) ? posts : matched,
        creators: creators.size,
        creatorsComplete
    };
}

function exploreCountList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (value == null || value === '') return [];
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function periodStartMs(period, now = Date.now()) {
    if (period === 'day') return now - (24 * 60 * 60 * 1000);
    if (period === 'week') return now - (7 * 24 * 60 * 60 * 1000);
    if (period === 'month') return now - (30 * 24 * 60 * 60 * 1000);
    return null;
}

async function countExplore(options = {}, hooks) {
    const tags = exploreCountList(options.tags != null ? options.tags : options.tag);
    const creators = exploreCountList(options.creators != null ? options.creators : options.creatorId);
    if (!tags.length && !creators.length) {
        const err = new Error('tags or creators is required');
        err.status = 400;
        throw err;
    }
    const period = normalizePeriod(options.period);
    const fromMs = options.from ? Date.parse(options.from) : null;
    const toMs = options.to ? Date.parse(options.to) : null;
    const windowMs = {
        fromMs: Number.isFinite(fromMs) ? fromMs : null,
        toMs: Number.isFinite(toMs) ? toMs : null
    };
    const search = (hooks && typeof hooks.search === 'function')
        ? hooks.search
        : (opts) => getExploreGallery(opts);
    const shared = {
        sort: options.sort || 'top',
        period,
        model: options.model,
        aspect: options.aspect,
        vt: options.vt,
        honorPeriod: true
    };
    const periodFrom = periodStartMs(period);
    const counts = [];
    for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const row = await scanExploreCount(search, { ...shared, search: tag }, windowMs);
        counts.push({ tag, posts: row.posts, creators: row.creators, creatorsComplete: row.creatorsComplete });
    }
    for (let i = 0; i < creators.length; i++) {
        const creator = creators[i];
        const creatorWindow = {
            fromMs: windowMs.fromMs != null ? windowMs.fromMs : periodFrom,
            toMs: windowMs.toMs
        };
        const row = await scanExploreCount(search, { ...shared, creatorId: creator, search: '' }, creatorWindow);
        counts.push({
            creator,
            posts: row.posts,
            creators: row.posts > 0 ? 1 : 0,
            creatorsComplete: row.creatorsComplete
        });
    }
    return {
        success: true,
        period,
        from: windowMs.fromMs != null ? new Date(windowMs.fromMs).toISOString() : null,
        to: windowMs.toMs != null ? new Date(windowMs.toMs).toISOString() : null,
        counts
    };
}

module.exports = {
    initNovelaiExploreGallery,
    setApiKeyResolver,
    getExploreGallery,
    getStudioExploreFeed,
    startStudioExploreFeedSchedule,
    getExploreLikedGallery,
    getExploreUserSelf,
    getExplorePost,
    setExplorePostLike,
    addExploreUndesiredId,
    removeExploreUndesiredId,
    listExploreUndesiredIds,
    isExploreUndesired,
    addExploreBlockedCreator,
    removeExploreBlockedCreator,
    listExploreBlockedCreators,
    isExploreCreatorBlocked,
    clearExploreGalleryCache,
    ensureExploreImage,
    ensureExplorePngExport,
    getExplorePostFromCache,
    checkExploreUploadImage,
    uploadExploreImage,
    checkExploreUploadEligibilityFromMetadata,
    validateExploreUploadTitle,
    isExploreUploadsEnabled,
    assertExploreUploadsEnabled,
    EXPLORE_UPLOAD_RESTRICTION_MESSAGES,
    EXPLORE_UPLOAD_TITLE_MIN,
    EXPLORE_UPLOAD_TITLE_MAX,
    PAGE_LIMIT,
    CACHE_TTL_MS,
    EXPLORE_TEXT_QUERY_CASES,
    normalizeExploreModel,
    exploreSearchTags,
    buildSearchBody,
    readExploreLikeCount,
    compactExplorePost,
    shapeExploreSearchForAgent,
    encodeExploreCursor,
    decodeExploreCursor,
    countExplore
};
