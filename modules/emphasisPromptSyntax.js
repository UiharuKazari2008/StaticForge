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
 * Kept for callers; split delimiters are now fixed only inside complete blocks
 * by fixEmphasisWeightOpenerSpacing (Yukimi 2026-10-07).
 */
function fixEmphasisSplitDelimiters(text) {
    return fixEmphasisWeightOpenerSpacing(text);
}

/**
 * Yukimi 2026-10-07 (cases from Jules GH #286): fix only syntax-breaking spaces,
 * and only inside a COMPLETE block. A weight opener "N ::" / "N : :" becomes "N::"
 * only when a closer follows on the same line; a split closer ": :" becomes "::"
 * only when it closes an open block. "year 2025 ::" with no closer stays as typed;
 * "cat 2 :: dog ::" → "cat 2:: dog ::". Inner spacing ("1.5:: cat ::") and a
 * space before the closing "::" are kept. A weight right after a comma or line
 * start ("…, 1.2::") opens a new group, so it never counts as the closer.
 * Server: modules/emphasisPromptSyntax.js — client: public/scripts/comp/emphasisParse.js
 * (must stay byte-identical; scripts/test-emphasis-prompt-syntax.js checks parity).
 */
function fixEmphasisWeightOpenerSpacing(text) {
    if (!text || text.indexOf(':') === -1) return text;
    const tokens = [];
    const re = /::|:[ \t]+:/g;
    let m;
    while ((m = re.exec(text))) {
        const s = m.index;
        const e = s + m[0].length;
        const split = m[0] !== '::';
        if (split && (text[s - 1] === ':' || text[e] === ':')) {
            re.lastIndex = s + 1;
            continue;
        }
        tokens.push({ s, e, split });
    }
    if (!tokens.length) return text;
    const weightBefore = (end) => {
        const w = text.slice(0, end).match(/(^|[\s,(\[{|]|::)(-?(?:\d+(?:\.\d+)?|\.\d+))([ \t]*)$/);
        return w && isValidEmphasisWeightBeforeDelimiter(w[2]) ? { gap: w[3].length } : null;
    };
    const opensNewGroup = (end) => {
        const w = text.slice(0, end).match(/(^|[,\n])[ \t]*(-?(?:\d+(?:\.\d+)?|\.\d+))[ \t]*$/);
        return !!(w && isValidEmphasisWeightBeforeDelimiter(w[2]));
    };
    let out = '';
    let last = 0;
    let open = false;
    for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k];
        if (open) {
            open = false;
            if (t.split) {
                out += text.slice(last, t.s) + '::';
                last = t.e;
            }
            continue;
        }
        const w = weightBefore(t.s);
        if (!w) continue;
        const next = tokens[k + 1];
        const nl = text.indexOf('\n', t.e);
        const complete = !!next && (nl < 0 || next.s < nl) && !opensNewGroup(next.s);
        if (!complete) continue;
        if (w.gap || t.split) {
            out += text.slice(last, t.s - w.gap) + '::';
            last = t.e;
        }
        open = true;
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
    let out = fixEmphasisWeightOpenerSpacing(text);
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
