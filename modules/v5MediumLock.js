'use strict';

const {
    loadModelFeatures,
    getModelFeatures,
    normalizeEffort,
    mediumEffortConfig
} = require('./modelFeatures');

/** UI order: 0 None, 1 Human Focus, 2 Light, 3 Heavy, 4 Curated, 5 Furry Focus. */
const UC_PRESET_ID_LEVEL = {
    none: 0,
    human_focus: 1,
    light: 2,
    heavy: 3,
    curated: 4,
    furry_focus: 5
};

/**
 * @param {string} id ucPresetId such as "heavy"
 * @returns {number}
 */
function ucPresetLevel(id) {
    const text = String(id == null ? '' : id).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!text) return UC_PRESET_ID_LEVEL.heavy;
    if (Object.prototype.hasOwnProperty.call(UC_PRESET_ID_LEVEL, text)) return UC_PRESET_ID_LEVEL[text];
    const numeric = parseInt(text, 10);
    return Number.isFinite(numeric) ? numeric : UC_PRESET_ID_LEVEL.heavy;
}

/**
 * Locks for V5 Medium. v5_medium.fixedSettings / clearsUserUc always apply.
 * V5 Full with effort "medium" uses the same locks (Studio's Medium toggle).
 * @param {string} forgeModel
 * @param {string} [effort]
 * @param {Record<string, object>|null} [features]
 * @returns {object|null}
 */
/**
 * An explicit effort (high or medium) on a v5_medium model key means V5 Full with that effort.
 * @param {string} forgeModel
 * @param {string} [effort]
 * @returns {string}
 */
function explicitEffortModelKey(forgeModel, effort) {
    const key = String(forgeModel || '').toLowerCase();
    const e = String(effort == null ? '' : effort).toLowerCase();
    if ((e === 'high' || e === 'medium') && /^v5_medium(_inp)?$/.test(key)) return key.replace('v5_medium', 'v5');
    return key;
}

function resolveMediumLock(forgeModel, effort, features = null) {
    const map = features || loadModelFeatures();
    const key = String(forgeModel || '').toLowerCase().replace(/_inp$/, '');
    const caps = getModelFeatures(key, map);
    const hasFixed = !!(caps && caps.fixedSettings);
    const effortOn = normalizeEffort(effort) === 'medium' && !!mediumEffortConfig(key, map);
    if (!hasFixed && !effortOn) return null;

    const mediumRow = getModelFeatures('v5_medium', map);
    const fixed = hasFixed ? caps.fixedSettings : (mediumRow && mediumRow.fixedSettings) || {};
    const fromEffort = effortOn ? mediumEffortConfig(key, map) : {};
    const shared = fixed && fixed.steps != null ? fixed : fromEffort;
    return {
        steps: Number(shared.steps != null ? shared.steps : fromEffort.steps) || 14,
        sampler: shared.sampler || fromEffort.sampler || 'k_euler_ancestral',
        ucPresetId: shared.ucPresetId || fromEffort.ucPresetId || 'heavy',
        clearsUserUc: hasFixed ? caps.clearsUserUc !== false : true,
        cfgRescale: false,
        varietyPlus: false,
        noiseSchedule: false,
        dynamicThresholding: false,
        smea: false
    };
}

/**
 * Heavy (or other named) UC preset text. Level 3 is index 2 in the per-model array.
 * v5_medium tables fall back to v5.
 * @param {object|null} ucPresets
 * @param {string} modelKey
 * @param {number} level
 * @returns {string}
 */
function lookupUcPresetText(ucPresets, modelKey, level) {
    if (!ucPresets || typeof ucPresets !== 'object' || !(level > 0)) return '';
    const key = String(modelKey || 'v5').toLowerCase().replace(/_inp$/, '');
    const order = [];
    [key, key === 'v5_medium' ? 'v5' : '', 'v5', 'v4_5'].forEach((candidate) => {
        if (candidate && order.indexOf(candidate) === -1) order.push(candidate);
    });
    let list = null;
    for (let i = 0; i < order.length; i++) {
        if (ucPresets[order[i]] != null) {
            list = ucPresets[order[i]];
            break;
        }
    }
    if (typeof list === 'string') return level === 1 ? list : '';
    if (!Array.isArray(list)) return '';
    const item = list[level - 1];
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && item.value != null) return String(item.value);
    const wanted = level === UC_PRESET_ID_LEVEL.heavy ? 'heavy' : '';
    if (wanted) {
        const named = list.find((row) => row && typeof row === 'object'
            && String(row.id || row.name || '').toLowerCase().replace(/[\s-]+/g, '_') === wanted);
        if (named && named.value != null) return String(named.value);
    }
    return '';
}

function clearCharacterUc(list) {
    if (!Array.isArray(list)) return list;
    return list.map((char) => (char && typeof char === 'object' ? { ...char, uc: '' } : char));
}

/**
 * Force a generation options object onto Medium's fixed request.
 * User UC is replaced by the heavy preset text. Box UC is cleared. Name and other box fields stay.
 * Guidance (scale) is left alone.
 * @param {object} options
 * @param {object|null} lock
 * @param {object|null} [ucPresets]
 * @param {string} [modelKey]
 * @returns {object}
 */
function applyMediumLocksToOptions(options, lock, ucPresets, modelKey) {
    if (!options || !lock) return options;
    const level = ucPresetLevel(lock.ucPresetId);
    const presetText = lock.clearsUserUc
        ? lookupUcPresetText(ucPresets, modelKey || options.model || 'v5', level)
        : (options.negative_prompt || '');
    const next = { ...options };
    next.steps = lock.steps;
    next.sampler = lock.sampler;
    next.ucPresetId = lock.ucPresetId;
    next.append_uc = level;
    next.variety = false;
    next.dynamic_thresholding = false;
    next.dynamicThresholding = false;
    next.autoSmea = false;
    delete next.cfg_rescale;
    delete next.rescale;
    delete next.ucPreset;
    delete next.skip_cfg_above_sigma;
    delete next.noise_schedule;
    delete next.noiseScheduler;
    delete next.sm;
    delete next.sm_dyn;
    if (lock.clearsUserUc) {
        next.negative_prompt = presetText;
        next.uc = presetText;
    }
    next.characterPrompts = clearCharacterUc(next.characterPrompts);
    next.allCharacterPrompts = clearCharacterUc(next.allCharacterPrompts);
    if (next.dynamic_generation && typeof next.dynamic_generation === 'object' && next.dynamic_generation.compiled_prompt) {
        const compiled = { ...next.dynamic_generation.compiled_prompt };
        if (lock.clearsUserUc) compiled.uc = presetText;
        compiled.characterPrompts = clearCharacterUc(compiled.characterPrompts);
        next.dynamic_generation = { ...next.dynamic_generation, compiled_prompt: compiled };
    }
    return next;
}

/** Split on top-level commas; commas inside ::weight groups:: or brackets stay with their phrase. */
function splitTopLevelPhrases(text) {
    const out = [];
    let buf = '';
    let depth = 0;
    let inGroup = false;
    const src = String(text || '');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === ':' && src[i + 1] === ':') { inGroup = !inGroup; buf += '::'; i += 1; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth -= 1;
        if (ch === ',' && depth === 0 && !inGroup) { out.push(buf); buf = ''; continue; }
        buf += ch;
    }
    out.push(buf);
    return out.map((part) => part.trim()).filter(Boolean);
}

/**
 * V5 Medium sends no user UC, but the inline negative (-1::...:: in the prompt) still works.
 * Prepend UC phrases to the inline negative, deduped, comma-joined. Empty UC returns inline unchanged.
 * @param {string} uc
 * @param {string} inline
 * @returns {string}
 */
function foldUcIntoInlineNegative(uc, inline) {
    const ucParts = splitTopLevelPhrases(uc);
    const inlineText = String(inline == null ? '' : inline);
    if (!ucParts.length) return inlineText;
    const inlineParts = splitTopLevelPhrases(inlineText);
    const seen = new Set();
    const merged = [];
    ucParts.concat(inlineParts).forEach((part) => {
        const key = part.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(part);
    });
    return merged.join(', ');
}

module.exports = {
    foldUcIntoInlineNegative,
    splitTopLevelPhrases,
    explicitEffortModelKey,
    UC_PRESET_ID_LEVEL,
    ucPresetLevel,
    resolveMediumLock,
    lookupUcPresetText,
    applyMediumLocksToOptions
};
