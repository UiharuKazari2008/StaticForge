/**
 * Offline tag suggest cutoffs and title matching for tag_wiki.db.
 *
 * V4.5-and-older models: hide tags created after 2025-05-29 (existing untrained date).
 * V5 and up: hide tags created after the end of July 2026 (2026-08-01T00:00:00Z).
 * Wiki pages are always stored and browsable; only tag suggestion uses these cutoffs.
 */

const V45_CUTOFF_MS = Date.parse('2025-05-29T00:00:00Z');
const V5_CUTOFF_MS = Date.parse('2026-08-01T00:00:00Z');

function normalizeOfflineTagTitle(title) {
    if (!title) return '';
    return String(title).toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

function parseCreatedAtMs(dateStr) {
    if (!dateStr) return null;
    const raw = String(dateStr).trim();
    if (!raw) return null;
    const date = new Date(raw);
    const ms = date.getTime();
    return Number.isNaN(ms) ? null : ms;
}

function isAfterV45Cutoff(dateStr) {
    const ms = parseCreatedAtMs(dateStr);
    return ms != null && ms > V45_CUTOFF_MS;
}

function isAfterV5Cutoff(dateStr) {
    const ms = parseCreatedAtMs(dateStr);
    return ms != null && ms >= V5_CUTOFF_MS;
}

function isV5SuggestModel(model) {
    const key = String(model || '').toLowerCase();
    if (!key) return false;
    if (key === 'v5' || key === 'v5_cur' || key.startsWith('v5_')) return true;
    if (key.includes('nai-diffusion-5') || key.includes('diffusion-5')) return true;
    return false;
}

function getTagSuggestCutoffMs(model) {
    return isV5SuggestModel(model) ? V5_CUTOFF_MS : V45_CUTOFF_MS;
}

function isTagSuggestable(createdAt, model) {
    if (!createdAt) return true;
    const ms = parseCreatedAtMs(createdAt);
    if (ms == null) return true;
    if (isV5SuggestModel(model)) {
        return ms < V5_CUTOFF_MS;
    }
    return ms <= V45_CUTOFF_MS;
}

module.exports = {
    V45_CUTOFF_MS,
    V5_CUTOFF_MS,
    normalizeOfflineTagTitle,
    parseCreatedAtMs,
    isAfterV45Cutoff,
    isAfterV5Cutoff,
    isV5SuggestModel,
    getTagSuggestCutoffMs,
    isTagSuggestable
};
