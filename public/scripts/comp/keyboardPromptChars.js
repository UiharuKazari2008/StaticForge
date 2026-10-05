/**
 * Fold typographic lookalikes to keyboard ASCII before NovelAI.
 *
 * Keeps CJK, emoji, danbooru symbols (stars, hearts, katakana middle dot),
 * wave dash, lone fullwidth brackets/colon (text, never NAI syntax), and
 * managed emphasis invisibles
 * (modules/emphasisGroupIdSyntax.js: WJ, invisible separator/plus, ZWSP, ZWNJ).
 *
 * Client: loaded before utilities.js. Server: require() this same file.
 */
'use strict';

/** Single-char (or short string) replacements. Keys are unicode escapes, never the glyphs. */
const KEYBOARD_PROMPT_CHAR_MAP = {
    '\u00A0': ' ',
    '\u00AD': '-',
    '\u00B4': "'",
    '\u00D7': 'x',
    '\u00F7': '/',
    '\u02B9': "'",
    '\u02BC': "'",
    '\u02DC': '~',
    '\u1680': ' ',
    '\u2000': ' ',
    '\u2001': ' ',
    '\u2002': ' ',
    '\u2003': ' ',
    '\u2004': ' ',
    '\u2005': ' ',
    '\u2006': ' ',
    '\u2007': ' ',
    '\u2008': ' ',
    '\u2009': ' ',
    '\u200A': ' ',
    '\u200E': '',
    '\u200F': '',
    '\u2010': '-',
    '\u2011': '-',
    '\u2012': '-',
    '\u2013': '-',
    '\u2014': '-',
    '\u2015': '-',
    '\u2018': "'",
    '\u2019': "'",
    '\u201A': "'",
    '\u201B': "'",
    '\u201C': '"',
    '\u201D': '"',
    '\u201E': '"',
    '\u201F': '"',
    '\u2022': ', ',
    '\u2026': '...',
    '\u202A': '',
    '\u202B': '',
    '\u202C': '',
    '\u202D': '',
    '\u202E': '',
    '\u202F': ' ',
    '\u2032': "'",
    '\u2033': '"',
    '\u2035': "'",
    '\u2043': '-',
    '\u205F': ' ',
    '\u2066': '',
    '\u2067': '',
    '\u2068': '',
    '\u2069': '',
    '\u2212': '-',
    '\u2219': ', ',
    '\u223C': '~',
    '\u22EF': '...',
    '\u2A2F': 'x',
    '\u2E3A': '--',
    '\u2E3B': '---',
    '\u3000': ' ',
    '\uFB00': 'ff',
    '\uFB01': 'fi',
    '\uFB02': 'fl',
    '\uFB03': 'ffi',
    '\uFB04': 'ffl',
    '\uFB05': 'st',
    '\uFB06': 'st',
    '\uFE58': '-',
    '\uFE63': '-',
    '\uFEFF': '',
    '\u2715': 'x',
    '\u2716': 'x'
};

const KEYBOARD_PROMPT_CHAR_RE = /[\u00A0\u00AD\u00B4\u00D7\u00F7\u02B9\u02BC\u02DC\u1680\u2000-\u200A\u200E\u200F\u2010-\u2015\u2018-\u201F\u2022\u2026\u202A-\u202E\u202F\u2032\u2033\u2035\u2043\u205F\u2066-\u2069\u2212\u2219\u223C\u22EF\u2A2F\u2E3A\u2E3B\u3000\uFB00-\uFB06\uFE58\uFE63\uFEFF\u2715\u2716\uFF01-\uFF5E]/;

/**
 * Fullwidth chars that would fold into NovelAI syntax ( ) [ ] { } : / ::.
 * Yukimi 2026-10-05: keep them as display text, never emphasis.
 */
const KEYBOARD_PROMPT_KEEP_FULLWIDTH = new Set([
    0xFF08, // fullwidth (
    0xFF09, // fullwidth )
    0xFF1A, // fullwidth :
    0xFF3B, // fullwidth [
    0xFF3D, // fullwidth ]
    0xFF5B, // fullwidth {
    0xFF5D  // fullwidth }
]);

const KEYBOARD_EMPHASIS_WEIGHT_RE = /^-?(?:0(?:\.\d+)?|[1-9]\d*(?:\.\d+)?|\.\d+)$/;

/**
 * COMPLETE fullwidth blocks become ASCII NovelAI syntax (Yukimi 2026-10-05):
 * ｛…｝ → {…}, ［…］ → […], W：：…：： → W::…::. Inner spacing is kept; only
 * the syntax-breaking spaces go (weight→opening delimiter, "： ：" splits).
 * Lone fullwidth brackets/colons and （…） stay as display text.
 */
function convertFullwidthEmphasisBlocks(text) {
    if (!/[\uFF1A\uFF3B\uFF3D\uFF5B\uFF5D]/.test(text)) return text;
    let out = text.replace(
        /(^|[\s,(\[{|]|::)(-?(?:\d+(?:\.\d+)?|\.\d+))[ \t]*\uFF1A[ \t]*\uFF1A([^\uFF1A]*?)\uFF1A[ \t]*\uFF1A/g,
        (match, lead, weight, body) => (KEYBOARD_EMPHASIS_WEIGHT_RE.test(weight)
            ? `${lead}${weight}::${body}::`
            : match)
    );
    for (let guard = 0; guard < 64; guard++) {
        const next = out
            .replace(/\uFF5B([^\uFF5B\uFF5D]*)\uFF5D/g, '{$1}')
            .replace(/\uFF3B([^\uFF3B\uFF3D]*)\uFF3D/g, '[$1]');
        if (next === out) break;
        out = next;
    }
    return out;
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeKeyboardPromptChars(text) {
    if (typeof text !== 'string' || text.length === 0) return text;
    if (!KEYBOARD_PROMPT_CHAR_RE.test(text)) return text;

    let out = '';
    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i);
        const width = cp > 0xFFFF ? 2 : 1;
        if (cp >= 0xFF01 && cp <= 0xFF5E && !KEYBOARD_PROMPT_KEEP_FULLWIDTH.has(cp)) {
            out += String.fromCharCode(cp - 0xFEE0);
        } else if (width === 1 && Object.prototype.hasOwnProperty.call(KEYBOARD_PROMPT_CHAR_MAP, text[i])) {
            out += KEYBOARD_PROMPT_CHAR_MAP[text[i]];
        } else {
            out += text.slice(i, i + width);
        }
        i += width;
    }
    return convertFullwidthEmphasisBlocks(out);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeKeyboardPromptChars, KEYBOARD_PROMPT_KEEP_FULLWIDTH };
}
