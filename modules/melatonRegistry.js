/**
 * Melaton's registry (Yozora #632): the settings Control Panel items keep that drive nothing on
 * the server yet (Mouse, Date and Time, Power Options, Folder Options...). Stored in config.json
 * as userGlobalSettings.registry, so Runes shows and edits it like regedit:
 *
 *   registry = { "HKCU\\Control Panel\\Mouse": { "DoubleClickSpeed": 500, "SwapMouseButtons": false }, ... }
 *
 * Keys are full paths under HKCU / HKLM / HKCR / HKU / HKCC. Values are a string, a finite
 * number, a boolean, or a list of strings (REG_MULTI_SZ). A patch merges per value: null deletes a
 * value, a key set to null deletes the key. Client: public/scripts/comp/melatonRegistry.js.
 */

const MAX_KEYS = 600;
const MAX_VALUES = 128;
const MAX_KEY_LENGTH = 255;
const MAX_NAME_LENGTH = 128;
const MAX_STRING = 4096;
const MAX_MULTI = 64;
const KEY_RE = /^(HKCU|HKLM|HKCR|HKU|HKCC)(\\[^\\\0]{1,128})*$/;

function normalizeKey(key) {
    if (typeof key !== 'string') return null;
    const k = key.trim().replace(/\\+$/, '');
    if (!k || k.length > MAX_KEY_LENGTH || !KEY_RE.test(k)) return null;
    return k;
}

function normalizeValue(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') return value.slice(0, MAX_STRING);
    if (Array.isArray(value)) {
        return value.filter((v) => typeof v === 'string').slice(0, MAX_MULTI).map((v) => v.slice(0, 1024));
    }
    return undefined;
}

function normalizeValues(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    let n = 0;
    for (const [name, value] of Object.entries(raw)) {
        if (n >= MAX_VALUES) break;
        if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) continue;
        const v = normalizeValue(value);
        if (v === undefined) continue;
        out[name] = v;
        n += 1;
    }
    return out;
}

function normalizeRegistry(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    let n = 0;
    for (const [key, values] of Object.entries(raw)) {
        if (n >= MAX_KEYS) break;
        const k = normalizeKey(key);
        if (!k) continue;
        const vals = normalizeValues(values);
        if (!Object.keys(vals).length) continue;
        out[k] = vals;
        n += 1;
    }
    return out;
}

function mergeRegistryPatch(existing, patch) {
    const out = normalizeRegistry(existing);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
    for (const [key, values] of Object.entries(patch)) {
        const k = normalizeKey(key);
        if (!k) continue;
        if (values === null) {
            delete out[k];
            continue;
        }
        if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
        const next = { ...(out[k] || {}) };
        for (const [name, value] of Object.entries(values)) {
            if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) continue;
            if (value === null) {
                delete next[name];
                continue;
            }
            const v = normalizeValue(value);
            if (v !== undefined) next[name] = v;
        }
        if (Object.keys(next).length) out[k] = normalizeValues(next);
        else delete out[k];
    }
    return normalizeRegistry(out);
}

module.exports = { normalizeRegistry, mergeRegistryPatch };
