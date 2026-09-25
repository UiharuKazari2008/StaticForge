'use strict';

/**
 * In-memory generation dedup key for handleGeneration (MCP + Studio/WS).
 * Compile-time flags that are stripped from apiOpts before the NovelAI call
 * must be listed here — their effect can be a no-op on already-clean text,
 * so the compiled prompt/payload alone is not enough.
 */

function flagWithDefault(value, defaultValue) {
    if (value === undefined || value === null) return !!defaultValue;
    return !!value;
}

function canonicalizeApiOptions(apiOpts, upscale, compileFlags) {
    if (!apiOpts || typeof apiOpts !== 'object') return '';
    const flags = compileFlags && typeof compileFlags === 'object' ? compileFlags : {};
    const cleanObject = (obj) => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(cleanObject);
        const sorted = {};
        Object.keys(obj).sort().forEach((k) => {
            if (k === 'requestId' || k === 'stepPreviewHeight' || k === 'stepPreviewWidth') return;
            let value = obj[k];
            if (k === 'deduplicate_tags') {
                value = flagWithDefault(value, true);
            }
            sorted[k] = cleanObject(value);
        });
        return sorted;
    };
    const api = cleanObject(apiOpts);
    if (!Object.prototype.hasOwnProperty.call(api, 'deduplicate_tags')) {
        api.deduplicate_tags = true;
    }
    return JSON.stringify({
        api,
        upscale: !!upscale,
        prompt_normalize: flagWithDefault(flags.prompt_normalize, true),
        keep_newlines: flagWithDefault(flags.keep_newlines, false),
        auto_char_numerize: flagWithDefault(flags.auto_char_numerize, true),
        auto_clean_uc: flagWithDefault(flags.auto_clean_uc, true)
    });
}

module.exports = {
    canonicalizeApiOptions,
    flagWithDefault
};
