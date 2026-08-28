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

module.exports = {
    TEXT_COLON_LEN,
    findTextColonIndex,
    findLastTextColonIndex,
    matchCommaTextColon,
    isTextColonPrefix,
    stripTextColonPrefix,
    splitPromptAtTextColon,
    insertBeforeTextColon,
    insertBeforeTextColonOrFirstGroup
};
