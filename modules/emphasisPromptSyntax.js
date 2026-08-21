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

function fixEmphasisGroupCommaViolations(text) {
    if (!text || !text.includes('::')) return text;

    // Comma before any "::": "movements, ::" → "movements::", "foo, ::bar" → "foo::bar"
    text = text.replace(/([^:\d])\s*,\s*(?=::)/g, '$1');

    // Misplaced comma after next-group opener: "end:: 1.0::, start" → "end::, 1.0::start"
    text = text.replace(/(::)\s*(-?\d+(?:\.\d+)?)::\s*,\s*/g, '$1, $2::');

    // Word then weight::, text (no prior closer): "standing 1.21::, detailed" → "standing::, 1.21::detailed"
    text = text.replace(/([^\s:,]+)\s+(-?\d+(?:\.\d+)?)::,\s*/g, '$1::, $2::');

    // After outer comma, inner "::, " is duplicate: ", 3.54::, unborn" → ", 3.54::unborn"
    text = text.replace(/(,\s*)(-?\d+(?:\.\d+)?)::,\s*/g, '$1$2::');

    // Closing terminator inside a weight group: "kicking ::" → "kicking::"
    // Also: next group without comma ("kicking :: 1.1::"), comma after close ("clothed ::,"), disable close ("womb::/")
    // Never glue onto a digit — "2025 ::" must stay spaced (years / numbers are not closers to absorb).
    text = text.replace(
        /([^:,\s])\s+(::)(?=\s*(?:,\s*|\/|-?\d+(?:\.\d+)?::|\s*$))/g,
        (match, before, delim, offset, whole) => {
            if (/\d/.test(before)) return match;
            const closeIndex = offset + before.length;
            const ifStripped = whole.slice(0, closeIndex) + '::' + whole.slice(offset + match.length);
            if (needsSpaceBeforeDoubleColon(ifStripped, closeIndex)) {
                return match;
            }
            return before + delim;
        }
    );

    return text;
}

function normalizeEmphasisPromptSyntax(text, options = {}) {
    if (!text || typeof text !== 'string') return text;
    let out = fixEmphasisDigitBeforeDoubleColon(text);
    if (options.fixCommas !== false) {
        out = fixEmphasisGroupCommaViolations(out);
    }
    return out;
}

module.exports = {
    isValidEmphasisWeightBeforeDelimiter,
    needsSpaceBeforeDoubleColon,
    fixEmphasisDigitBeforeDoubleColon,
    fixEmphasisGroupCommaViolations,
    normalizeEmphasisPromptSyntax
};
