/**
 * V5 overlay delimiter `Text:` — match any case, but not substrings like `context:`.
 */

const TEXT_COLON_LEN = 5;

function findTextColonIndex(text) {
    if (typeof text !== 'string' || !text) return -1;
    const m = /\btext:/i.exec(text);
    return m ? m.index : -1;
}

function findLastTextColonIndex(text) {
    if (typeof text !== 'string' || !text) return -1;
    const re = /\btext:/ig;
    let last = -1;
    let m;
    while ((m = re.exec(text)) !== null) {
        last = m.index;
    }
    return last;
}

function matchCommaTextColon(text) {
    if (typeof text !== 'string' || !text) return null;
    const m = /,\s*text:/i.exec(text);
    return m ? { index: m.index, length: m[0].length } : null;
}

function isTextColonPrefix(query) {
    return typeof query === 'string' && /^\s*text:/i.test(query);
}

function stripTextColonPrefix(query) {
    return String(query || '').replace(/^\s*text:/i, '').trim();
}

function splitPromptAtTextColon(text) {
    const p = text == null ? '' : String(text);
    const idx = findTextColonIndex(p);
    if (idx === -1) {
        return { tagsPart: p, textSuffix: '', index: -1 };
    }
    let splitAt = idx;
    while (splitAt > 0 && /[ \t]/.test(p.charAt(splitAt - 1))) splitAt--;
    if (splitAt > 0 && p.charAt(splitAt - 1) === ',') splitAt--;
    return {
        tagsPart: p.slice(0, splitAt),
        textSuffix: p.slice(splitAt),
        index: idx
    };
}

function insertBeforeTextColon(prompt, addition) {
    const text = prompt == null ? '' : String(prompt);
    const idx = findTextColonIndex(text);
    if (idx === -1) return null;
    const beforeText = text.substring(0, idx).trim().replace(/,+$/, '');
    const afterText = 'Text:' + text.substring(idx + TEXT_COLON_LEN);
    if (beforeText) return beforeText + ', ' + addition + ', ' + afterText;
    return addition + ', ' + afterText;
}

function insertBeforeTextColonOrFirstGroup(prompt, addition) {
    const inserted = insertBeforeTextColon(prompt, addition);
    if (inserted != null) return inserted;
    const text = prompt == null ? '' : String(prompt);
    const groups = text.split('|').map(group => group.trim());
    if (groups.length > 0) {
        groups[0] = groups[0] ? groups[0] + ', ' + addition : addition;
        return groups.join(' | ');
    }
    return text ? text + ', ' + addition : addition;
}

function stripNoTextTag(text) {
    if (typeof text !== 'string' || !text) return text || '';
    const split = splitPromptAtTextColon(text);
    const cleaned = split.tagsPart
        .replace(/\bno\s+text\b/gi, '')
        .replace(/,\s*,/g, ',')
        .replace(/^\s*,\s*|\s*,\s*$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return cleaned + (split.textSuffix || '');
}

function textOverlayTagEmphasis(textLength) {
    const length = Number(textLength) || 0;
    if (length <= 10) return 1.5;
    if (length >= 200) return 5.5;
    const scaled = 1.5 + ((length - 10) / 190) * 4.0;
    return Math.round(scaled * 10) / 10;
}

/**
 * Overlays that share a prompt compile to one Text: block.
 * Type tags are written once, in front of that Text:.
 * Several lines join with a blank line. One overlay keeps its own newlines.
 * applyBias(tags, emphasis) is imageGeneration.applyBiasToText.
 */
function compileTextOverlayAppend(overlays, textTags, applyBias, wrapDisplayText) {
    const lines = [];
    const typeOrder = [];
    const typeTexts = Object.create(null);
    const list = Array.isArray(overlays) ? overlays : [];
    for (let i = 0; i < list.length; i++) {
        const overlay = list[i] || {};
        const text = String(overlay.text || '');
        if (!text) continue;
        // wrapDisplayText: protectKeyboardDisplayText (exempt from the prompt fold)
        lines.push(typeof wrapDisplayText === 'function' ? wrapDisplayText(text) : text);
        const type = overlay.type || 'speech';
        if (!typeTexts[type]) {
            typeTexts[type] = [];
            typeOrder.push(type);
        }
        typeTexts[type].push(text);
    }
    if (!lines.length) return '';
    const tagsByType = textTags && typeof textTags === 'object' ? textTags : {};
    const tagParts = [];
    for (let i = 0; i < typeOrder.length; i++) {
        const type = typeOrder[i];
        const spec = tagsByType[type];
        const tags = (spec && spec.tags) || 'english text, speech bubble';
        const emphasis = textOverlayTagEmphasis(typeTexts[type].join('\n\n').length);
        const emphasized = typeof applyBias === 'function' ? applyBias(tags, emphasis) : tags;
        tagParts.push(emphasized);
    }
    return `, ${tagParts.join(', ')}, Text: ${lines.join('\n\n')}`;
}

function qualityPresetStripCandidates(qualityValue) {
    const base = String(qualityValue || '').trim();
    if (!base) return [];
    const out = [base];
    if (!/\bno\s+text\b/i.test(base)) {
        out.push(`${base}, no text`);
        out.push(`no text, ${base}`);
    }
    out.sort((a, b) => b.length - a.length);
    return out;
}

module.exports = {
    TEXT_COLON_LEN,
    findTextColonIndex,
    findLastTextColonIndex,
    matchCommaTextColon,
    isTextColonPrefix,
    stripTextColonPrefix,
    splitPromptAtTextColon,
    insertBeforeTextColon,
    insertBeforeTextColonOrFirstGroup,
    stripNoTextTag,
    textOverlayTagEmphasis,
    compileTextOverlayAppend,
    qualityPresetStripCandidates
};
