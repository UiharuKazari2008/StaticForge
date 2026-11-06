'use strict';

// Complexity typed into a prompt ("high complexity", "1.3::low complexity::") moves into the Quality
// preset's Complexity group (prompt.config.json __quality__ sub_toggles, group "complexity"), so the
// compiled prompt does not carry it twice. Studio does the same on the client
// (public/scripts/comp/imageGenerationSettings.js studioLiftComplexity) so the dropdown shows it.

function normalizeTag(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// The Quality preset's complexity toggles allowed on this model.
function complexityToggles(promptConfig, model) {
    const quality = ((promptConfig && promptConfig.datasets) || []).find((row) => row && row.isQualityPreset);
    const key = String(model || '').toLowerCase();
    return ((quality && quality.sub_toggles) || []).filter((st) => {
        if (!st || st.group !== 'complexity' || !st.value) return false;
        const models = Array.isArray(st.models) ? st.models.map((m) => String(m).toLowerCase()) : null;
        return !models || models.includes(key);
    });
}

// Top-level comma pieces; a "N::...::" block stays one piece even when it holds commas.
function splitTopLevel(text) {
    const out = [];
    const source = String(text || '');
    let depth = 0;
    let start = 0;
    for (let i = 0; i < source.length; i++) {
        if (source.startsWith('::', i)) {
            // "1.2::" opens (a number before it), a bare "::" closes
            const before = source.slice(start, i).trim();
            if (depth === 0 && /^-?\d*\.?\d+$/.test(before.split(/[,\s]/).pop() || '')) depth = 1;
            else if (depth === 1) depth = 0;
            i += 1;
            continue;
        }
        if (source[i] === ',' && depth === 0) {
            out.push(source.slice(start, i));
            start = i + 1;
        }
    }
    out.push(source.slice(start));
    return out;
}

/**
 * Remove complexity tags from text. Returns { text, pick: { id, bias } | null }; the last tag wins
 * (the Complexity group is one choice). A weighted block that holds only the tag keeps its weight as bias.
 */
function liftComplexity(text, toggles) {
    const source = String(text || '');
    if (!source || !toggles || !toggles.length || !/complexity/i.test(source)) return { text: source, pick: null };
    const byValue = new Map(toggles.map((st) => [normalizeTag(st.value), st]));
    let pick = null;
    const kept = [];
    splitTopLevel(source).forEach((piece) => {
        const trimmed = piece.trim();
        const weighted = /^(-?\d*\.?\d+)::\s*([^:]+?)\s*::$/.exec(trimmed);
        const tag = normalizeTag(weighted ? weighted[2] : trimmed);
        const st = byValue.get(tag);
        const bias = weighted ? Number(weighted[1]) : 1;
        if (st && bias > 0) {
            pick = { id: st.id, bias: Number.isFinite(bias) ? bias : 1 };
            return;
        }
        kept.push(piece);
    });
    if (!pick) return { text: source, pick: null };
    const joined = kept.map((piece) => piece.trim()).filter(Boolean).join(', ');
    return { text: joined, pick };
}

// Select the picked level in dataset_config.settings.__quality__ and switch the others in the group off.
function applyComplexityPick(body, pick, toggles) {
    if (!body || !pick) return;
    const dataset = body.dataset_config && typeof body.dataset_config === 'object' ? body.dataset_config : {};
    const settings = dataset.settings && typeof dataset.settings === 'object' ? dataset.settings : {};
    const quality = settings.__quality__ && typeof settings.__quality__ === 'object' ? settings.__quality__ : {};
    toggles.forEach((st) => {
        const current = quality[st.id] && typeof quality[st.id] === 'object' ? quality[st.id] : {};
        quality[st.id] = st.id === pick.id
            ? { ...current, enabled: true, bias: pick.bias, value: current.value || st.value }
            : { ...current, enabled: false };
    });
    settings.__quality__ = quality;
    dataset.settings = settings;
    body.dataset_config = dataset;
}

module.exports = { complexityToggles, liftComplexity, applyComplexityPick, _test: { splitTopLevel } };
