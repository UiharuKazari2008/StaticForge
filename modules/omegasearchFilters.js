const { getResolutionFromDimensions } = require('./imageTools');

/** @typedef {'substring'|'word'|'inner'|'start'|'end'} OmegasearchMatchMode */

/**
 * Normalized text block: terms OR together within block; blocks AND across query.
 * @typedef {{ terms: string[], matchMode: OmegasearchMatchMode, orWithinBlock: boolean }} OmegasearchSearchBlock
 */

/**
 * @typedef {Object} OmegasearchFilters
 * @property {{ relative?: string, absolute?: string|number }|null} [dateBefore]
 * @property {{ relative?: string, absolute?: string|number }|null} [dateAfter]
 * @property {{ start?: string|number, end?: string|number }|null} [dateRange]
 * @property {boolean|null} [qualityPreset]
 * @property {number|null} [ucLevel]
 * @property {number|null} [nsfwLevel]
 * @property {'compiled'|'input'} [promptSource]
 * @property {string[]} [models]
 * @property {number|null} [stepsMin]
 * @property {number|null} [stepsMax]
 * @property {string|null} [sampler]
 * @property {string|null} [scheduler]
 * @property {boolean} [consecutiveSeeds]
 * @property {('normal'|'large'|'max')[]} [resolutionPreset]
 * @property {boolean|null} [isUpscaled]
 * @property {number|null} [guidanceMin]
 * @property {number|null} [guidanceMax]
 * @property {number|null} [rescaleMin]
 * @property {number|null} [rescaleMax]
 * @property {boolean|null} [hasDynamicReplacements]
 */

const VALID_MATCH_MODES = new Set(['substring', 'word', 'inner', 'start', 'end']);
const VALID_RESOLUTION_TIERS = new Set(['normal', 'large', 'max']);
const VALID_PROMPT_SOURCES = new Set(['compiled', 'input']);

/** image_search_facets.model_norm forge keys (metadataDatabase extractSearchModelAndPresetFromPngMeta) */
const MODEL_NORM_SLUGS = new Set(['v4_5', 'v4_5_cur', 'v4', 'v4_cur', 'v3', 'v3_furry']);

/** NAI API slugs accepted by legacy search_models → model_norm for facet reader */
const NAI_SLUG_TO_MODEL_NORM = {
    'nai-diffusion-4-5-full': 'v4_5',
    'nai-diffusion-4-5-curated': 'v4_5_cur',
    'nai-diffusion-4-full': 'v4',
    'nai-diffusion-4-curated-preview': 'v4_cur',
    'nai-diffusion-3': 'v3',
    'nai-diffusion-furry-3': 'v3_furry'
};

const RELATIVE_UNIT_MS = {
    d: 86400000,
    day: 86400000,
    days: 86400000,
    w: 604800000,
    week: 604800000,
    weeks: 604800000,
    m: 2592000000,
    month: 2592000000,
    months: 2592000000,
    y: 31536000000,
    year: 31536000000,
    years: 31536000000
};

function parseRelativeDurationMs(relative) {
    if (relative == null || relative === '') return null;
    const raw = String(relative).trim().toLowerCase();
    const match = raw.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
    if (!match) return null;
    const amount = parseFloat(match[1]);
    const unit = match[2];
    const unitMs = RELATIVE_UNIT_MS[unit];
    if (!unitMs || !Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * unitMs);
}

function parseAbsoluteTimestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
}

function resolveDateBoundary(boundary) {
    if (!boundary || typeof boundary !== 'object') return null;
    if (boundary.relative != null && boundary.relative !== '') {
        const delta = parseRelativeDurationMs(boundary.relative);
        if (delta == null) return null;
        return Date.now() - delta;
    }
    return parseAbsoluteTimestamp(boundary.absolute);
}

function splitOrTerms(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    if (raw.includes('|')) {
        return raw.split('|').map((part) => part.trim()).filter(Boolean);
    }
    if (/\s+or\s+/i.test(raw)) {
        return raw.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
    }
    return [raw];
}

function normalizeMatchMode(mode, fallback = 'substring') {
    const normalized = String(mode || fallback).trim().toLowerCase();
    return VALID_MATCH_MODES.has(normalized) ? normalized : fallback;
}

/**
 * Accept legacy string blocks, "a|b" / "a OR b", or structured objects.
 * @param {Array<string|OmegasearchSearchBlock>|string|null|undefined} blocks
 * @param {{ defaultMatchMode?: OmegasearchMatchMode }} [options]
 * @returns {OmegasearchSearchBlock[]}
 */
function normalizeSearchBlocks(blocks, options = {}) {
    const defaultMatchMode = normalizeMatchMode(options.defaultMatchMode, 'substring');
    const raw = Array.isArray(blocks)
        ? blocks
        : (blocks == null || blocks === '' ? [] : String(blocks).split(','));

    const normalized = [];
    const seen = new Set();

    for (const entry of raw) {
        if (entry == null) continue;

        if (typeof entry === 'object' && !Array.isArray(entry)) {
            const termsRaw = Array.isArray(entry.terms)
                ? entry.terms
                : (entry.term != null ? [entry.term] : splitOrTerms(entry.text || entry.value || ''));
            const terms = [];
            for (const termEntry of termsRaw) {
                for (const splitTerm of splitOrTerms(termEntry)) {
                    const term = String(splitTerm || '').trim().toLowerCase();
                    if (!term) continue;
                    terms.push(term);
                }
            }
            if (!terms.length) continue;
            const orWithinBlock = entry.orWithinBlock === true
                || entry.or === true
                || entry.mode === 'or'
                || (terms.length > 1 && entry.orWithinBlock !== false && entry.mode !== 'and');
            const blockKey = `${terms.join('\0')}\0${normalizeMatchMode(entry.matchMode, defaultMatchMode)}\0${orWithinBlock ? 'or' : 'and'}`;
            if (seen.has(blockKey)) continue;
            seen.add(blockKey);
            normalized.push({
                terms,
                matchMode: normalizeMatchMode(entry.matchMode, defaultMatchMode),
                orWithinBlock,
                mode: orWithinBlock ? 'or' : 'and'
            });
            continue;
        }

        const orTerms = splitOrTerms(entry);
        if (orTerms.length > 1) {
            const terms = orTerms.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
            if (!terms.length) continue;
            const blockKey = `${terms.join('\0')}\0${defaultMatchMode}\0or`;
            if (seen.has(blockKey)) continue;
            seen.add(blockKey);
            normalized.push({
                terms,
                matchMode: defaultMatchMode,
                orWithinBlock: true,
                mode: 'or'
            });
            continue;
        }

        const term = String(orTerms[0] || entry || '').trim().toLowerCase();
        if (!term) continue;
        const blockKey = `${term}\0${defaultMatchMode}`;
        if (seen.has(blockKey)) continue;
        seen.add(blockKey);
        normalized.push({
            terms: [term],
            matchMode: defaultMatchMode,
            orWithinBlock: false,
            mode: 'and'
        });
    }

    return normalized;
}

function normalizeStringList(value) {
    if (!value) return [];
    const raw = Array.isArray(value) ? value : String(value).split(',');
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const item = String(entry || '').trim();
        if (!item) continue;
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function normalizeBooleanTriState(value) {
    if (value === true || value === false) return value;
    if (value == null || value === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    return null;
}

function normalizeNumber(value, { min = null, max = null } = {}) {
    if (value == null || value === '') return null;
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(num)) return null;
    if (min != null && num < min) return null;
    if (max != null && num > max) return null;
    return num;
}

function normalizeInteger(value, opts = {}) {
    const num = normalizeNumber(value, opts);
    return num == null ? null : Math.trunc(num);
}

/**
 * @param {OmegasearchFilters|Record<string, unknown>|null|undefined} filters
 * @param {{ promptSource?: string, blockOptions?: { defaultMatchMode?: OmegasearchMatchMode } }} [messageExtras]
 * @returns {OmegasearchFilters}
 */
function normalizeOmegasearchFilters(filters, messageExtras = {}) {
    const src = (filters && typeof filters === 'object') ? filters : {};
    const normalized = {};

    if (src.dateBefore && typeof src.dateBefore === 'object') {
        normalized.dateBefore = {
            relative: src.dateBefore.relative != null ? String(src.dateBefore.relative) : undefined,
            absolute: src.dateBefore.absolute
        };
    }
    if (src.dateAfter && typeof src.dateAfter === 'object') {
        normalized.dateAfter = {
            relative: src.dateAfter.relative != null ? String(src.dateAfter.relative) : undefined,
            absolute: src.dateAfter.absolute
        };
    }
    if (src.dateRange && typeof src.dateRange === 'object') {
        normalized.dateRange = {
            start: src.dateRange.start,
            end: src.dateRange.end
        };
    }

    normalized.qualityPreset = normalizeBooleanTriState(src.qualityPreset);
    normalized.ucLevel = normalizeInteger(src.ucLevel, { min: 0, max: 8 });
    normalized.nsfwLevel = normalizeInteger(src.nsfwLevel, { min: -2, max: 3 });

    const promptSource = src.promptSource || messageExtras.promptSource;
    if (promptSource != null && promptSource !== '') {
        const ps = String(promptSource).trim().toLowerCase();
        if (VALID_PROMPT_SOURCES.has(ps)) {
            normalized.promptSource = ps;
        }
    }

    normalized.models = normalizeStringList(src.models);
    normalized.stepsMin = normalizeInteger(src.stepsMin, { min: 1, max: 150 });
    normalized.stepsMax = normalizeInteger(src.stepsMax, { min: 1, max: 150 });
    if (normalized.stepsMin != null && normalized.stepsMax != null && normalized.stepsMin > normalized.stepsMax) {
        const swap = normalized.stepsMin;
        normalized.stepsMin = normalized.stepsMax;
        normalized.stepsMax = swap;
    }

    if (src.sampler != null && String(src.sampler).trim()) {
        normalized.sampler = String(src.sampler).trim();
    }
    if (src.scheduler != null && String(src.scheduler).trim()) {
        normalized.scheduler = String(src.scheduler).trim();
    }

    normalized.consecutiveSeeds = src.consecutiveSeeds === true;

    const resolutionPreset = normalizeStringList(src.resolutionPreset)
        .map((tier) => String(tier).trim().toLowerCase())
        .filter((tier) => VALID_RESOLUTION_TIERS.has(tier));
    if (resolutionPreset.length) {
        normalized.resolutionPreset = resolutionPreset;
    }

    normalized.isUpscaled = normalizeBooleanTriState(src.isUpscaled);
    normalized.guidanceMin = normalizeNumber(src.guidanceMin, { min: 0, max: 30 });
    normalized.guidanceMax = normalizeNumber(src.guidanceMax, { min: 0, max: 30 });
    if (normalized.guidanceMin != null && normalized.guidanceMax != null && normalized.guidanceMin > normalized.guidanceMax) {
        const swap = normalized.guidanceMin;
        normalized.guidanceMin = normalized.guidanceMax;
        normalized.guidanceMax = swap;
    }

    normalized.rescaleMin = normalizeNumber(src.rescaleMin, { min: 0, max: 1 });
    normalized.rescaleMax = normalizeNumber(src.rescaleMax, { min: 0, max: 1 });
    if (normalized.rescaleMin != null && normalized.rescaleMax != null && normalized.rescaleMin > normalized.rescaleMax) {
        const swap = normalized.rescaleMin;
        normalized.rescaleMin = normalized.rescaleMax;
        normalized.rescaleMax = swap;
    }

    normalized.hasDynamicReplacements = normalizeBooleanTriState(src.hasDynamicReplacements);

    return normalized;
}

function getResolutionTier(width, height) {
    if (!width || !height) return null;
    const presetName = getResolutionFromDimensions(width, height);
    if (!presetName) return 'custom';
    if (presetName.startsWith('small_') || presetName.startsWith('normal_')) return 'normal';
    if (presetName.startsWith('large_')) return 'large';
    if (presetName.startsWith('xlarge_') || presetName.startsWith('wallpaper_')) return 'max';
    return 'custom';
}

/**
 * Build LIKE/GLOB params for a term against indexed text columns.
 * @returns {{ clause: string, params: string[] }}
 */
function buildTermMatchSql(columnExpr, term, matchMode) {
    const mode = normalizeMatchMode(matchMode, 'substring');
    switch (mode) {
        case 'word':
            return { clause: `(${columnExpr} = ?)`, params: [term] };
        case 'start':
            return { clause: `(${columnExpr} LIKE ?)`, params: [`${term}%`] };
        case 'end':
            return { clause: `(${columnExpr} LIKE ?)`, params: [`%${term}`] };
        case 'inner':
        case 'substring':
        default:
            return { clause: `(${columnExpr} LIKE ?)`, params: [`%${term}%`] };
    }
}

/**
 * Build word-boundary match for full-text rows (space-delimited prose).
 */
function buildFullTextWordMatchSql(columnExpr, term) {
    return {
        clause: `((${columnExpr} = ?) OR (' ' || ${columnExpr} || ' ') LIKE ?)`,
        params: [term, `% ${term} %`]
    };
}

function flattenBlocksForDisplay(blocks) {
    return (blocks || []).map((block) => {
        const label = block.terms.join(block.orWithinBlock ? ' OR ' : ' ');
        if (block.matchMode && block.matchMode !== 'substring') {
            return `${label} [${block.matchMode}]`;
        }
        return label;
    });
}

/**
 * Map filter model values to image_search_facets.model_norm slugs (v4_5, v4_5_cur, …).
 * Accepts forge UI keys and NAI API slug aliases used by search_models.
 * @param {string[]} models
 * @returns {string[]}
 */
function resolveModelNormSlugs(models) {
    if (!Array.isArray(models) || !models.length) return [];
    const out = new Set();
    for (const raw of models) {
        const key = String(raw).trim().toLowerCase();
        if (!key) continue;
        if (MODEL_NORM_SLUGS.has(key)) {
            out.add(key);
        } else if (NAI_SLUG_TO_MODEL_NORM[key]) {
            out.add(NAI_SLUG_TO_MODEL_NORM[key]);
        }
    }
    return [...out];
}

function hasActiveMetadataFilters(filters) {
    if (!filters || typeof filters !== 'object') return false;
    return Boolean(
        filters.dateBefore
        || filters.dateAfter
        || filters.dateRange
        || filters.qualityPreset != null
        || filters.ucLevel != null
        || filters.nsfwLevel != null
        || (filters.models && filters.models.length)
        || filters.stepsMin != null
        || filters.stepsMax != null
        || filters.sampler
        || filters.scheduler
        || filters.isUpscaled != null
        || filters.guidanceMin != null
        || filters.guidanceMax != null
        || filters.rescaleMin != null
        || filters.rescaleMax != null
        || filters.hasDynamicReplacements != null
        || (filters.resolutionPreset && filters.resolutionPreset.length)
        || filters.consecutiveSeeds
    );
}

/** Packet schema reference for application keys / client docs. */
const OMEGASEARCH_QUERY_PACKET_SCHEMA = {
    type: 'omegasearch_query',
    fields: {
        blocks: { required: true, type: 'string[]|OmegasearchSearchBlock[]' },
        workspaceId: { required: false, type: 'string|null', note: 'null or "all" searches every workspace' },
        viewType: { required: false, type: '"images"|"scraps"|"pinned"|"upscaled"', default: 'images' },
        offset: { required: false, type: 'number', default: 0 },
        limit: { required: false, type: 'number', default: 60, max: 200 },
        usageLimit: { required: false, type: 'number', default: 120, max: 300 },
        promptSource: { required: false, type: '"compiled"|"input"', note: 'also accepted inside filters' },
        blockOptions: { required: false, type: '{ defaultMatchMode?: OmegasearchMatchMode }' },
        filters: { required: false, type: 'OmegasearchFilters' },
        searchSessionId: { required: false, type: 'string', note: 'server session id for pagination without re-query' },
        forceRefresh: { required: false, type: 'boolean', default: false, note: 'ignore cached session and run full search' }
    }
};

module.exports = {
    OMEGASEARCH_QUERY_PACKET_SCHEMA,
    VALID_MATCH_MODES,
    VALID_RESOLUTION_TIERS,
    normalizeSearchBlocks,
    normalizeOmegasearchFilters,
    normalizeMatchMode,
    parseRelativeDurationMs,
    parseAbsoluteTimestamp,
    resolveDateBoundary,
    getResolutionTier,
    buildTermMatchSql,
    buildFullTextWordMatchSql,
    flattenBlocksForDisplay,
    hasActiveMetadataFilters,
    resolveModelNormSlugs
};
