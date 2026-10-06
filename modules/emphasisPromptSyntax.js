/**
 * NovelAI emphasis prompt syntax normalization (server).
 * Client mirror: public/scripts/comp/emphasisParse.js (normalizeEmphasisPromptSyntax)
 */

const EMPHASIS_WEIGHT_BEFORE_DELIMITER = /^-?(?:0(?:\.\d+)?|[1-9]\d*(?:\.\d+)?|\.\d+)$/;

function isValidEmphasisWeightBeforeDelimiter(weight) {
    if (!weight) return false;
    return EMPHASIS_WEIGHT_BEFORE_DELIMITER.test(weight);
}

function needsSpaceBeforeDoubleColon(text, index) {
    if (!text || index < 2 || text[index] !== ':' || text[index + 1] !== ':') return false;

    let j = index - 1;
    while (j >= 0 && text[j] === ' ') j--;
    if (j < 0 || !/[\d.\-]/.test(text[j])) return false;

    let digitStart = j;
    while (digitStart >= 0 && /[\d.\-]/.test(text[digitStart])) digitStart--;
    digitStart++;

    const weightStr = text.substring(digitStart, j + 1);
    const charBeforeDigits = digitStart > 0 ? text[digitStart - 1] : '';

    if (/[a-zA-Z_]/.test(charBeforeDigits)) return true;

    if (!isValidEmphasisWeightBeforeDelimiter(weightStr)) return true;

    if (digitStart === 0) return false;
    if (/[\s,]/.test(charBeforeDigits)) return false;
    if (charBeforeDigits === ':' && digitStart >= 2 && text[digitStart - 2] === ':') return false;

    return false;
}

function fixEmphasisDigitBeforeDoubleColon(text) {
    if (!text || !text.includes('::')) return text;

    const positions = [];
    for (let i = 0; i < text.length - 1; i++) {
        if (text[i] === ':' && text[i + 1] === ':') {
            positions.push(i);
            i++;
        }
    }

    for (let p = positions.length - 1; p >= 0; p--) {
        const i = positions[p];
        if (needsSpaceBeforeDoubleColon(text, i)) {
            let k = i - 1;
            while (k >= 0 && text[k] === ' ') k--;
            if (k >= i - 1) {
                text = text.slice(0, i) + ' ' + text.slice(i);
            }
        }
    }

    return text;
}

/**
 * Yukimi 2026-10-05: a delimiter split by spaces is broken syntax — ": :" → "::".
 * Only lone colons on both sides (never touches ":::" runs).
 */
function fixEmphasisSplitDelimiters(text) {
    if (!text || text.indexOf(':') === -1) return text;
    return text.replace(/(^|[^:]):[ \t]+:(?!:)/g, '$1::');
}

/**
 * Yukimi 2026-10-05: spaces between a weight and its OPENING "::" break the
 * syntax — "1.5 ::cat::" → "1.5::cat::", "-1 ::x::" → "-1::x::".
 * Tracks open/close so a closer after a number ("year 2025 ::") is untouched.
 * Inner spacing ("1.5:: cat ::") is valid and kept.
 */
function fixEmphasisWeightOpenerSpacing(text) {
    if (!text || !text.includes('::')) return text;
    let open = false;
    let out = '';
    let last = 0;
    const re = /::/g;
    let m;
    while ((m = re.exec(text))) {
        const i = m.index;
        if (open) {
            open = false;
            continue;
        }
        const before = text.slice(0, i);
        const spaced = before.match(/(^|[\s,(\[{|]|::)(-?(?:\d+(?:\.\d+)?|\.\d+))([ \t]+)$/);
        let isOpener = false;
        if (spaced) {
            isOpener = true;
            const lead = spaced[1];
            const weightStr = spaced[2];
            if (lead && lead.trim() === '') {
                const leadIndex = before.length - spaced[0].length;
                let k = leadIndex - 1;
                while (k >= 0 && /\s/.test(before[k])) k--;
                if (k >= 0 && /[a-zA-Z_]/.test(before[k])) {
                    if (!weightStr.includes('.') && !weightStr.startsWith('-')) {
                        isOpener = false;
                    }
                }
            }
        }
        if (spaced && isOpener && isValidEmphasisWeightBeforeDelimiter(spaced[2])) {
            out += text.slice(last, i - spaced[3].length);
            last = i;
            open = true;
            continue;
        }
        const glued = before.match(/(^|[\s,(\[{|]|::)(-?(?:\d+(?:\.\d+)?|\.\d+))$/);
        let isGluedOpener = false;
        if (glued) {
            isGluedOpener = true;
            const lead = glued[1];
            const weightStr = glued[2];
            if (lead && lead.trim() === '') {
                const leadIndex = before.length - glued[0].length;
                let k = leadIndex - 1;
                while (k >= 0 && /\s/.test(before[k])) k--;
                if (k >= 0 && /[a-zA-Z_]/.test(before[k])) {
                    if (!weightStr.includes('.') && !weightStr.startsWith('-')) {
                        isGluedOpener = false;
                    }
                }
            }
        }
        open = !!(glued && isGluedOpener && isValidEmphasisWeightBeforeDelimiter(glued[2]));
    }
    return out + text.slice(last);
}

function fixEmphasisGroupCommaViolations(text) {
    if (!text || !text.includes('::')) return text;

    // Comma before any "::": "movements, ::" → "movements::", "foo, ::bar" → "foo::bar"
    // Inner spacing before the comma is kept ("cat , ::" → "cat ::") — Yukimi 2026-10-05.
    text = text.replace(/([^:\d])([ \t]*),\s*(?=::)/g, '$1$2');

    // Misplaced comma after next-group opener: "end:: 1.0::, start" → "end::, 1.0::start"
    text = text.replace(/(::)\s*(-?\d+(?:\.\d+)?)::\s*,\s*/g, '$1, $2::');

    // Word then weight::, text (no prior closer): "standing 1.21::, detailed" → "standing::, 1.21::detailed"
    text = text.replace(/([^\s:,]+)\s+(-?\d+(?:\.\d+)?)::,\s*/g, '$1::, $2::');

    // After outer comma, inner "::, " is duplicate: ", 3.54::, unborn" → ", 3.54::unborn"
    text = text.replace(/(,\s*)(-?\d+(?:\.\d+)?)::,\s*/g, '$1$2::');

    // A space before the closing "::" ("kicking ::") is valid NovelAI syntax and
    // is kept (Yukimi 2026-10-05) — the old closer-glue rule was removed.

    return text;
}

function normalizeEmphasisPromptSyntax(text, options = {}) {
    if (!text || typeof text !== 'string') return text;
    let out = fixEmphasisSplitDelimiters(text);
    out = fixEmphasisWeightOpenerSpacing(out);
    out = fixEmphasisDigitBeforeDoubleColon(out);
    if (options.fixCommas !== false) {
        out = fixEmphasisGroupCommaViolations(out);
    }
    return out;
}

module.exports = {
    isValidEmphasisWeightBeforeDelimiter,
    needsSpaceBeforeDoubleColon,
    fixEmphasisDigitBeforeDoubleColon,
    fixEmphasisSplitDelimiters,
    fixEmphasisWeightOpenerSpacing,
    fixEmphasisGroupCommaViolations,
    normalizeEmphasisPromptSyntax
};
