/**
 * Server-side autofill / SmartText search preferences (persisted in config.userGlobalSettings.autofillSearch).
 */

const AUTOFILL_SEARCH_DELAY_PRESETS = [0, 80, 120, 200, 300, 500];
const AUTOFILL_SEARCH_MAX_RESULTS_PRESETS = [15, 25, 35, 50, 75];

const DEFAULT_AUTOFILL_SEARCH_SETTINGS = {
    enabled: true,
    spellcheck: true,
    thesaurus: true,
    naiAnimeTags: true,
    naiFurryTags: true,
    dbAnimeTags: true,
    dbFurryTags: true,
    wikiPreviews: true,
    searchDelayMs: 120,
    maxResults: 35
};

function pickPreset(value, presets, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return presets.includes(n) ? n : fallback;
}

function normalizeAutofillSearchSettings(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: base.enabled !== false,
        spellcheck: base.spellcheck !== false,
        thesaurus: base.thesaurus !== false,
        naiAnimeTags: base.naiAnimeTags !== false,
        naiFurryTags: base.naiFurryTags !== false,
        dbAnimeTags: base.dbAnimeTags !== false,
        dbFurryTags: base.dbFurryTags !== false,
        wikiPreviews: base.wikiPreviews !== false,
        searchDelayMs: pickPreset(base.searchDelayMs, AUTOFILL_SEARCH_DELAY_PRESETS, DEFAULT_AUTOFILL_SEARCH_SETTINGS.searchDelayMs),
        maxResults: pickPreset(base.maxResults, AUTOFILL_SEARCH_MAX_RESULTS_PRESETS, DEFAULT_AUTOFILL_SEARCH_SETTINGS.maxResults)
    };
}

function mergeAutofillSearchSettingsPatch(existing, patch) {
    const out = normalizeAutofillSearchSettings(existing);
    if (!patch || typeof patch !== 'object') return out;

    const boolKeys = [
        'enabled', 'spellcheck', 'thesaurus',
        'naiAnimeTags', 'naiFurryTags', 'dbAnimeTags', 'dbFurryTags', 'wikiPreviews'
    ];
    for (const key of boolKeys) {
        if (typeof patch[key] === 'boolean') {
            out[key] = patch[key];
        }
    }
    if (typeof patch.searchDelayMs !== 'undefined') {
        out.searchDelayMs = pickPreset(patch.searchDelayMs, AUTOFILL_SEARCH_DELAY_PRESETS, out.searchDelayMs);
    }
    if (typeof patch.maxResults !== 'undefined') {
        out.maxResults = pickPreset(patch.maxResults, AUTOFILL_SEARCH_MAX_RESULTS_PRESETS, out.maxResults);
    }
    return out;
}

module.exports = {
    AUTOFILL_SEARCH_DELAY_PRESETS,
    AUTOFILL_SEARCH_MAX_RESULTS_PRESETS,
    DEFAULT_AUTOFILL_SEARCH_SETTINGS,
    normalizeAutofillSearchSettings,
    mergeAutofillSearchSettingsPatch
};
