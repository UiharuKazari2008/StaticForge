'use strict';
// Normalize Studio dataset ids (dataset_config.include / bias / settings keys).
// Agents send short names ("furry", "fur"); the real prompt.config ids are
// "fur dataset" etc. Unknown ids must surface as an error, never be dropped silently.

const DATASET_ID_ALIASES = {
    furry: 'fur dataset',
    fur: 'fur dataset',
    'furry dataset': 'fur dataset',
    'fur dataset': 'fur dataset',
    anime: 'anime dataset',
    background: 'background dataset',
    backgrounds: 'background dataset',
    'backgrounds dataset': 'background dataset',
    vn: '__visual_novel__',
    'visual novel': '__visual_novel__',
    visual_novel: '__visual_novel__',
    quality: '__quality__',
    transparency: '__transparency__'
};

// Sub-toggle ids agents sometimes put in include by mistake.
const SUB_TOGGLE_HINTS = {
    furry_human: "furry_human is a sub-toggle: set dataset_config.settings['fur dataset'].furry_human = { enabled: true } (and include 'fur dataset')"
};

function knownDatasetIds(datasets) {
    return (Array.isArray(datasets) ? datasets : [])
        .map((d) => (d && typeof d === 'object' ? d.value : d))
        .filter((v) => typeof v === 'string' && v);
}

/**
 * @param {string} raw
 * @param {string[]} known
 * @returns {string|null}
 */
function resolveDatasetId(raw, known) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    if (known.includes(text)) return text;
    const lower = text.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    const ci = known.find((id) => id.toLowerCase() === text.toLowerCase());
    if (ci) return ci;
    const alias = DATASET_ID_ALIASES[lower] || DATASET_ID_ALIASES[text.toLowerCase()];
    if (alias && (!known.length || known.includes(alias))) return alias;
    const suffixed = known.find((id) => id.toLowerCase() === `${lower} dataset`);
    if (suffixed) return suffixed;
    return null;
}

/**
 * @param {object} cfg dataset_config
 * @param {Array} datasets prompt.config datasets
 * @returns {{ config: object, unknown: string[], remapped: Array<{from:string,to:string}>, hints: string[] }}
 */
function normalizeDatasetConfig(cfg, datasets) {
    const out = { config: cfg, unknown: [], remapped: [], hints: [] };
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return out;
    const known = knownDatasetIds(datasets);
    const next = { ...cfg };
    const mapKey = (raw) => {
        const id = resolveDatasetId(raw, known);
        if (!id) {
            if (!out.unknown.includes(String(raw))) out.unknown.push(String(raw));
            const hint = SUB_TOGGLE_HINTS[String(raw).trim().toLowerCase()];
            if (hint && !out.hints.includes(hint)) out.hints.push(hint);
            return null;
        }
        if (id !== raw && !out.remapped.some((r) => r.from === String(raw))) out.remapped.push({ from: String(raw), to: id });
        return id;
    };
    if (next.include != null) {
        const list = Array.isArray(next.include) ? next.include : [next.include];
        const ids = [];
        list.forEach((raw) => {
            const id = mapKey(raw);
            if (id && !ids.includes(id)) ids.push(id);
        });
        next.include = ids;
    }
    ['bias', 'settings'].forEach((key) => {
        const src = next[key];
        if (!src || typeof src !== 'object' || Array.isArray(src)) return;
        const mapped = {};
        Object.keys(src).forEach((raw) => {
            const id = mapKey(raw);
            if (id) mapped[id] = src[raw];
        });
        next[key] = mapped;
    });
    out.config = next;
    return out;
}

module.exports = { DATASET_ID_ALIASES, resolveDatasetId, normalizeDatasetConfig, knownDatasetIds };
