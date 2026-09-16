'use strict';

/**
 * Resolve a NekoAI string enum member from a key or API/meta value.
 * Accepts DPM2S_ANC, k_dpmpp_2s_ancestral, or case variants.
 * Fallback only when raw is missing/blank — unknown input throws.
 *
 * @param {Record<string, string>|null|undefined} enumObj
 * @param {string|null|undefined} raw
 * @param {*} fallback
 * @param {string} [label]
 * @returns {*}
 */
function resolveNekoEnumValue(enumObj, raw, fallback, label) {
    if (raw === undefined || raw === null) return fallback;
    const input = String(raw).trim();
    if (!input) return fallback;
    const kind = label || 'enum';
    if (!enumObj) {
        throw new Error(`Unknown ${kind}: ${input}`);
    }

    if (enumObj[input] !== undefined) return enumObj[input];

    const lower = input.toLowerCase();
    const keys = Object.keys(enumObj);
    const valueHit = keys.find((k) => String(enumObj[k]).toLowerCase() === lower);
    if (valueHit !== undefined) return enumObj[valueHit];

    const upper = input.toUpperCase();
    if (enumObj[upper] !== undefined) return enumObj[upper];
    const keyHit = keys.find((k) => k.toUpperCase() === upper);
    if (keyHit !== undefined) return enumObj[keyHit];

    throw new Error(`Unknown ${kind}: ${input}`);
}

module.exports = {
    resolveNekoEnumValue
};
