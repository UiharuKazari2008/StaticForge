'use strict';

const fs = require('fs');
const path = require('path');

let cachedFeatures = null;
let cachedPath = null;

/**
 * Load model feature caps from config/model-features.json (boot-cached).
 * @param {string} [filePath]
 * @returns {Record<string, object>}
 */
function loadModelFeatures(filePath) {
    const resolved = filePath || path.resolve(__dirname, '..', 'config', 'model-features.json');
    if (cachedFeatures && cachedPath === resolved) {
        return cachedFeatures;
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    cachedFeatures = JSON.parse(raw);
    cachedPath = resolved;
    return cachedFeatures;
}

/**
 * @param {string} forgeModel - Dreamscape forge key (e.g. v5, v4_5)
 * @param {Record<string, object>|null} [features]
 * @returns {object|null}
 */
function getModelFeatures(forgeModel, features = null) {
    if (!forgeModel) return null;
    const map = features || cachedFeatures || loadModelFeatures();
    const key = String(forgeModel).toLowerCase().replace(/_inp$/, '');
    return map[key] || null;
}

/**
 * Resolve NekoAI Model enum key / API slug for generate or inpaint.
 * @param {string} forgeModel
 * @param {{ inpaint?: boolean }} [opts]
 * @param {Record<string, object>|null} [features]
 * @returns {string|null} API model slug
 */
function normalizeEffort(value) {
    return String(value || '').toLowerCase() === 'medium' ? 'medium' : 'high';
}

function mediumEffortConfig(forgeModel, features = null) {
    const caps = getModelFeatures(forgeModel, features);
    const medium = caps && caps.effort && caps.effort.medium;
    return medium && typeof medium === 'object' ? medium : null;
}

/**
 * NovelAI Source strings for V5 Full medium effort (image-app, 2026-10-08).
 * @param {string} forgeModel
 * @param {Record<string, object>|null} [features]
 * @returns {string[]}
 */
function mediumEffortSources(forgeModel, features = null) {
    const medium = mediumEffortConfig(forgeModel || 'v5', features);
    return Array.isArray(medium && medium.sources) ? medium.sources.slice() : [];
}

function isMediumEffortSource(source, features = null) {
    const text = String(source || '');
    if (!text) return false;
    const sources = mediumEffortSources('v5', features);
    return sources.indexOf(text) !== -1;
}

function isMediumEffortSlug(slug) {
    const value = String(slug || '').toLowerCase();
    return value === 'nai-diffusion-5-full-medium'
        || value === 'nai-diffusion-5-full-medium-inpainting';
}

function resolveApiModelSlug(forgeModel, opts = {}, features = null) {
    const caps = getModelFeatures(forgeModel, features);
    if (!caps) return null;
    const medium = normalizeEffort(opts.effort) === 'medium'
        ? mediumEffortConfig(forgeModel, features)
        : null;
    if (medium) {
        if (opts.inpaint) {
            return medium.inpaintApiModel || caps.inpaintApiModel || medium.apiModel || caps.apiModel || null;
        }
        return medium.apiModel || caps.apiModel || null;
    }
    if (opts.inpaint) {
        return caps.inpaintApiModel || caps.apiModel || null;
    }
    return caps.apiModel || null;
}

/**
 * Remap dataset include values for the active model (e.g. furry dataset → fur dataset on V5).
 * @param {string[]} include
 * @param {string} forgeModel
 * @param {Record<string, object>|null} [features]
 * @returns {string[]}
 */
function remapDatasetInclude(include, forgeModel, features = null) {
    if (!Array.isArray(include) || !include.length) return include || [];
    const caps = getModelFeatures(forgeModel, features);
    const aliases = caps && caps.datasetAliases ? caps.datasetAliases : null;
    if (!aliases || !Object.keys(aliases).length) return include.slice();
    return include.map((value) => (aliases[value] != null ? aliases[value] : value));
}

/**
 * Whether forge model is V5 family.
 * @param {string} forgeModel
 * @returns {boolean}
 */
function isV5ForgeModel(forgeModel) {
    const key = String(forgeModel || '').toLowerCase();
    return key === 'v5' || key === 'v5_cur' || key.startsWith('v5_');
}

/** Omit-default forge key for MCP / new memories / ranking tests. Pass an explicit model to override. */
const DEFAULT_FORGE_MODEL = 'v5';

module.exports = {
    loadModelFeatures,
    getModelFeatures,
    resolveApiModelSlug,
    remapDatasetInclude,
    isV5ForgeModel,
    normalizeEffort,
    mediumEffortConfig,
    mediumEffortSources,
    isMediumEffortSource,
    isMediumEffortSlug,
    DEFAULT_FORGE_MODEL
};
