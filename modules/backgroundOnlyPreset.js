'use strict';

/**
 * Studio preset for scenery gens (#362).
 * "no humans" is the preset's own tag. Character boxes are forced off.
 * Prompt text and character-box prompt/uc text are left as written.
 */

const BACKGROUND_ONLY_PRESET_KEY = 'Background';
const BACKGROUND_ONLY_UUID = 'builtin-background-only';
const NO_HUMANS_TAG = 'no humans';
const NO_HUMANS_RE = /\bno humans\b/i;

function createBackgroundOnlyPreset() {
    return {
        name: BACKGROUND_ONLY_PRESET_KEY,
        preset: BACKGROUND_ONLY_PRESET_KEY,
        uuid: BACKGROUND_ONLY_UUID,
        builtin: true,
        backgroundOnly: true,
        forceCharacterBoxesOff: true,
        prompt: NO_HUMANS_TAG,
        uc: '',
        model: 'v5',
        resolution: 'normal_landscape',
        steps: 23,
        guidance: 5,
        rescale: 0,
        sampler: 'k_euler_ancestral',
        noiseScheduler: 'karras',
        variety: false,
        allow_paid: false,
        append_quality: true,
        append_uc: 0,
        characterPrompts: [],
        dataset_config: { include: [], bias: {}, settings: {} }
    };
}

function isBackgroundOnlyPreset(preset) {
    return !!(preset && (preset.backgroundOnly === true || preset.forceCharacterBoxesOff === true));
}

function isBackgroundOnlyRequest(body, preset) {
    if (body && (body.backgroundOnly === true || body.forceCharacterBoxesOff === true)) return true;
    return isBackgroundOnlyPreset(preset);
}

function promptHasNoHumans(prompt) {
    return NO_HUMANS_RE.test(prompt == null ? '' : String(prompt));
}

/**
 * Append the preset tag when it is missing. Existing tags stay in place.
 * @param {string|null|undefined} prompt
 * @returns {string}
 */
function appendNoHumans(prompt) {
    const text = prompt == null ? '' : String(prompt);
    if (promptHasNoHumans(text)) return text;
    const trimmed = text.trim().replace(/[\s,]+$/u, '');
    if (!trimmed) return NO_HUMANS_TAG;
    return `${trimmed}, ${NO_HUMANS_TAG}`;
}

/**
 * @param {Array|undefined|null} characterPrompts
 * @returns {Array}
 */
function forceCharacterBoxesOff(characterPrompts) {
    if (!Array.isArray(characterPrompts)) return [];
    return characterPrompts.map((char) => {
        if (!char || typeof char !== 'object') return char;
        return { ...char, enabled: false };
    });
}

/**
 * Outgoing generation only. Does not strip tags the user wrote.
 * @param {{ prompt?: string, characterPrompts?: Array }} input
 */
function applyBackgroundOnlyGeneration(input) {
    const source = input || {};
    return {
        prompt: appendNoHumans(source.prompt),
        characterPrompts: forceCharacterBoxesOff(source.characterPrompts),
        backgroundOnly: true
    };
}

function characterPromptSource(body, preset) {
    if (Array.isArray(body && body.allCharacterPrompts)) return body.allCharacterPrompts;
    if (Array.isArray(body && body.characterPrompts)) return body.characterPrompts;
    if (Array.isArray(preset && preset.allCharacterPrompts)) return preset.allCharacterPrompts;
    if (Array.isArray(preset && preset.characterPrompts)) return preset.characterPrompts;
    return undefined;
}

function applyBackgroundOnlyToBody(body, preset) {
    const sourcePrompt = body && body.prompt != null
        ? body.prompt
        : (preset && preset.prompt != null ? preset.prompt : '');
    const sourceChars = characterPromptSource(body, preset);
    const applied = applyBackgroundOnlyGeneration({
        prompt: sourcePrompt,
        characterPrompts: sourceChars
    });
    const next = {
        ...body,
        prompt: applied.prompt,
        backgroundOnly: true,
        forceCharacterBoxesOff: true
    };
    if (Array.isArray(sourceChars)) {
        next.allCharacterPrompts = applied.characterPrompts;
        // API list stays empty. allCharacterPrompts keeps the box text with enabled false.
        next.characterPrompts = [];
    }
    return next;
}

/**
 * Editor payload. Prompt and UC stay as stored. Character boxes are forced off.
 * @param {object} preset
 */
function presentBackgroundOnlyPreset(preset) {
    if (!preset || typeof preset !== 'object') return preset;
    if (!isBackgroundOnlyPreset(preset)) return preset;
    const next = {
        ...preset,
        backgroundOnly: true,
        forceCharacterBoxesOff: true
    };
    if (Array.isArray(preset.characterPrompts)) {
        next.characterPrompts = forceCharacterBoxesOff(preset.characterPrompts);
    }
    if (Array.isArray(preset.allCharacterPrompts)) {
        next.allCharacterPrompts = forceCharacterBoxesOff(preset.allCharacterPrompts);
    }
    return next;
}

function withBuiltinPresets(presets) {
    const base = presets && typeof presets === 'object' && !Array.isArray(presets) ? presets : {};
    const merged = { ...base };
    if (!Object.prototype.hasOwnProperty.call(merged, BACKGROUND_ONLY_PRESET_KEY)) {
        merged[BACKGROUND_ONLY_PRESET_KEY] = createBackgroundOnlyPreset();
    }
    return merged;
}

function findBuiltinPreset({ name, uuid } = {}) {
    if (name === BACKGROUND_ONLY_PRESET_KEY || uuid === BACKGROUND_ONLY_UUID) {
        return { key: BACKGROUND_ONLY_PRESET_KEY, preset: createBackgroundOnlyPreset() };
    }
    return null;
}

function resolvePresetRecord(presets, name) {
    if (presets && Object.prototype.hasOwnProperty.call(presets, name) && presets[name]) {
        return presets[name];
    }
    const builtin = findBuiltinPreset({ name });
    return builtin ? builtin.preset : null;
}

module.exports = {
    BACKGROUND_ONLY_PRESET_KEY,
    BACKGROUND_ONLY_UUID,
    NO_HUMANS_TAG,
    createBackgroundOnlyPreset,
    isBackgroundOnlyPreset,
    isBackgroundOnlyRequest,
    promptHasNoHumans,
    appendNoHumans,
    forceCharacterBoxesOff,
    applyBackgroundOnlyGeneration,
    applyBackgroundOnlyToBody,
    presentBackgroundOnlyPreset,
    withBuiltinPresets,
    findBuiltinPreset,
    resolvePresetRecord
};
