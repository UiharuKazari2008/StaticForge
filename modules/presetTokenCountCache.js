'use strict';

/**
 * Pre-compute T5 token counts for static prompt.config preset strings.
 * Built at server boot / promptConfig reload; sent to clients via get_app_options.
 */

function countPresetString(tokenizer, text, withSeparator = false) {
    if (!text || typeof text !== 'string') return 0;
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const toCount = withSeparator && !trimmed.endsWith(', ')
        ? `${trimmed}, `
        : trimmed;
    return tokenizer.countTokens(toCount);
}

function buildQualityEntry(tokenizer, modelPresets) {
    if (typeof modelPresets === 'string') {
        return { tokens: countPresetString(tokenizer, modelPresets, true) };
    }
    if (!Array.isArray(modelPresets) || modelPresets.length === 0) {
        return null;
    }
    if (typeof modelPresets[0] === 'string') {
        return { tokens: countPresetString(tokenizer, modelPresets[0], true) };
    }
    if (typeof modelPresets[0] === 'object' && modelPresets[0] !== null) {
        return modelPresets.map((item) => ({
            id: item.id,
            name: item.name,
            match: item.match,
            tokens: countPresetString(tokenizer, item.value, true)
        }));
    }
    return null;
}

function buildUcEntry(tokenizer, modelPresets) {
    if (!Array.isArray(modelPresets) || modelPresets.length === 0) {
        return [];
    }
    if (typeof modelPresets[0] === 'string') {
        return modelPresets.map((str, index) => ({
            level: index + 1,
            tokens: countPresetString(tokenizer, str, true)
        }));
    }
    if (typeof modelPresets[0] === 'object' && modelPresets[0] !== null) {
        return modelPresets.map((item, index) => ({
            level: index + 1,
            id: item.id,
            name: item.name,
            match: item.match,
            tokens: countPresetString(tokenizer, item.value, true)
        }));
    }
    return [];
}

/**
 * @param {object} promptConfig - Full prompt.config (not cloned subset)
 * @param {{ countTokens: function }} tokenizer
 * @returns {object}
 */
function buildPresetTokenCountCache(promptConfig, tokenizer) {
    if (!promptConfig || !tokenizer || typeof tokenizer.countTokens !== 'function') {
        return { datasets: [], quality: {}, uc: {}, nsfw: {}, expanders: {} };
    }

    const cache = {
        datasets: [],
        quality: {},
        uc: {},
        nsfw: {},
        expanders: {}
    };

    if (Array.isArray(promptConfig.datasets)) {
        cache.datasets = promptConfig.datasets.map((ds) => {
            const entry = {
                type: ds.type || 'dataset',
                value: ds.value,
                tokens: (ds.skipPromptValue || ds.isQualityPreset || ds.isTransparencyPreset)
                    ? 0
                    : countPresetString(tokenizer, ds.value, true)
            };
            if (Array.isArray(ds.sub_toggles) && ds.sub_toggles.length > 0) {
                entry.sub_toggles = ds.sub_toggles.map((st) => ({
                    id: st.id,
                    tokens: countPresetString(tokenizer, st.value, true)
                }));
            }
            return entry;
        });
    }

    if (promptConfig.quality_presets && typeof promptConfig.quality_presets === 'object') {
        for (const [modelKey, presets] of Object.entries(promptConfig.quality_presets)) {
            const built = buildQualityEntry(tokenizer, presets);
            if (built !== null) {
                cache.quality[modelKey] = built;
            }
        }
    }

    if (promptConfig.uc_presets && typeof promptConfig.uc_presets === 'object') {
        for (const [modelKey, presets] of Object.entries(promptConfig.uc_presets)) {
            cache.uc[modelKey] = buildUcEntry(tokenizer, presets);
        }
    }

    if (promptConfig.nsfw_presets && typeof promptConfig.nsfw_presets === 'object') {
        for (const [key, preset] of Object.entries(promptConfig.nsfw_presets)) {
            const entry = {};
            const promptParts = [preset.add?.base_prefix, preset.add?.base].filter(Boolean);
            const ucParts = [preset.add?.uc_prefix, preset.add?.uc].filter(Boolean);
            if (promptParts.length) {
                entry.prompt = countPresetString(tokenizer, promptParts.join(', '), true);
            }
            if (ucParts.length) {
                entry.uc = countPresetString(tokenizer, ucParts.join(', '), true);
            }
            if (entry.prompt !== undefined || entry.uc !== undefined) {
                cache.nsfw[String(key)] = entry;
            }
        }
    }

    if (promptConfig.text_replacements && typeof promptConfig.text_replacements === 'object') {
        for (const [key, value] of Object.entries(promptConfig.text_replacements)) {
            if (Array.isArray(value)) {
                cache.expanders[key] = value.map((v) => countPresetString(tokenizer, String(v), false));
            } else if (typeof value === 'string') {
                cache.expanders[key] = countPresetString(tokenizer, value, false);
            }
        }
    }

    return cache;
}

module.exports = {
    buildPresetTokenCountCache,
    countPresetString
};
