/**
 * Prompt list fold. Shared by the editor and the generate path.
 * Numbers are T5 token ids. scripts/prompt-list-codec.js encodes and decodes them.
 * Client: loaded before utilities.js. Server: require() this same file.
 */
'use strict';

const DO = '\uE010';
const DC = '\uE011';
const FLOOR = 2;
const SCALE = 2;
const CAP = 6;

const ADJ_IDS = [[1021, 3165], [2214, 9742], [1540, 4503], [423, 4503], [4503], [3165], [10281], [2749], [12766], [9742], [625], [2991], [19041, 26]];
const INT_IDS = [[182], [2033], [3300], [6309], [1066], [882]];
const PF_IDS = [[887], [2335], [3955, 7], [3955], [10989], [9360], [3567], [3202]];
const PM_IDS = [[1076], [388], [5069, 7], [5069], [5234], [4940]];
const PN_IDS = [[151], [568], [6917], [936]];
const IDF_IDS = [[10281, 3955], [10281, 3955, 7], [15533, 89, 7], [15533, 89], [3, 122, 173, 89, 7], [3, 122, 173, 89], [17162, 7], [17162], [1907, 2754], [1907, 51, 9], [3, 7662, 14347], [3542, 15159], [3, 32, 4883, 152], [954, 6255, 120], [657, 160, 3427], [1416, 114, 3, 9, 4503, 2335], [1416, 114, 46, 3165, 2335], [2924, 160, 1246], [1267, 160, 1246], [1416, 160, 1246], [657, 160, 4192], [150, 1200, 3, 9, 3202]];
const IDM_IDS = [[10281, 5069], [10281, 5069, 7], [3, 26, 173, 89, 7], [3, 26, 173, 89], [18573, 7], [18573], [1907, 8020], [1907, 102, 9], [3, 21892, 7, 152], [3, 32, 7, 7, 152], [657, 112, 3427], [1416, 114, 3, 9, 4503, 388], [1416, 114, 46, 3165, 388], [2924, 112, 1246], [1267, 112, 1246], [1416, 112, 1246], [657, 112, 4192], [150, 1200, 3, 9, 4940]];
const IDN_IDS = [[3, 32, 17, 106, 9], [9742, 95], [2991, 13008], [1416, 2749], [1416, 12766], [1416, 10281], [1416, 9742], [1416, 2214, 9742], [19041, 26, 1133], [19041, 26, 522], [3, 75, 3623, 7, 1922], [1416, 114, 46, 3165], [10281, 479], [2749, 479], [12766, 479], [9742, 479], [3165, 479], [625, 479], [479, 2749], [479, 12766], [479, 10281], [479, 9742], [479, 625], [19041, 7], [1246, 6883], [11501, 6883], [8719, 2356], [3, 7, 15242, 1133], [3, 75, 3623, 31, 7, 1922], [625, 1246], [2496, 1246], [2214, 1246], [13, 3, 9, 824, 1246], [4503, 95], [66, 4503, 95], [150, 1200, 1021], [4642, 15596, 2749], [4642, 15596, 9742], [4642, 15596, 12766], [652, 2749], [1416, 4503], [1416, 4503, 95], [168, 139, 3165, 4500], [3957, 13, 3, 5855], [3957, 13, 1246], [1969, 15, 26, 522], [1969, 15, 26, 1133]];
const SOLO_IDS = [[1021, 3513], [1021, 3165], [2214, 9742], [1540, 4503], [423, 4503], [3513], [3165], [10281], [2749], [12766], [9742], [4503], [14032], [2991], [625], [9742, 95]];
const GF_IDS = [[3567], [3202], [887], [2335], [3955, 7], [3955], [10989], [9360]];
const GM_IDS = [[5234], [4940], [1076], [388], [5069, 7], [5069]];
const CF_IDS = [3165, 3955];
const CM_IDS = [3165, 5069];
const YF_IDS = [1021, 3955];
const YM_IDS = [1021, 5069];
const AW_IDS = [[215], [203], [625], [3, 63, 32], [778], [2076], [2214], [1480], [160], [112], [70], [424], [16], [147], [9759], [2641, 15, 35], [4169, 6808], [6786], [12010], [19662], [18358], [27757], [2391, 17, 63], [2641, 63], [4169, 17, 63], [6189], [3, 17, 16103, 725], [3, 17, 9288, 3010], [21, 3010], [361, 89, 3010], [1296, 3010], [2391, 3010], [2641, 725], [4169, 3010]];
const AGE_WORD_IDS = [1246];
const AGED_WORD_IDS = [9742];
const GLUE_IDS = [[16009], [2111], [966], [300], [13]];

let ADJ = [];
let INT = [];
let PF = [];
let PM = [];
let PN = [];
let IDF = [];
let IDM = [];
let IDN = [];
let SOLO = [];
let GF = [];
let GM = [];
let AW = [];
let CANON_F = '';
let CANON_M = '';
let INVERSE_F = '';
let INVERSE_M = '';
let AGE_WORD = '';
let AGED_WORD = '';
let GLUE = [];
let ADJ_RE = /$^/g;
let ID_RE = /$^/g;
let SOLO_RE = /$^/g;
let GENDER_F_RE = /$^/i;
let GENDER_M_RE = /$^/i;
let AGE_RES = [];
let PERSON_SET = new Set();
let ID_G = new Map();
let tablesReady = false;

function esc(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parts(s) {
    return String(s || '').split(/\s+/).filter(Boolean).map(esc).join('[-_\\s]+');
}

function alt(list) {
    return list.slice().sort((a, b) => b.length - a.length).map(parts).filter(Boolean).join('|');
}

function norm(s) {
    return String(s || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function ageRes() {
    const year = AW[0];
    const years = AW[1];
    const old = AW[2];
    const yo = AW[3];
    const early = AW[4];
    const mid = AW[5];
    const middle = AW[6];
    const late = AW[7];
    const her = AW[8];
    const his = AW[9];
    const their = AW[10];
    const something = AW[11];
    const inn = AW[12];
    const over = AW[13];
    const pushing = AW[14];
    const nums = AW.slice(15, 26);
    const decades = AW.slice(26);
    const numAlt = nums.map(esc).join('|');
    const roundAlt = AW.slice(18, 26).map(esc).join('|');
    const decAlt = decades.map(esc).join('|') + '|[2-9]0s';
    const stage = '(?:' + [early, mid, middle, late].map(esc).join('|') + ')';
    const who = '(?:' + [her, his, their].map(esc).join('|') + ')';
    const y = '(?:' + esc(year) + '|' + esc(years) + ')';
    const stated = '(?:' + esc(AGED_WORD) + '|' + esc(AGE_WORD) + ')';
    return [
        new RegExp('\\b(\\d{1,3})(?:\\s*-\\s*|\\s+)' + y + '(?:\\s*-\\s*|\\s+)' + esc(old) + '\\b', 'gi'),
        new RegExp('\\b(\\d{1,3})\\s*' + esc(yo) + '\\b', 'gi'),
        new RegExp('\\b' + stated + '[-_\\s]+(\\d{1,3})\\b', 'gi'),
        new RegExp('\\b(\\d{1,3})[-_\\s]+' + esc(something) + '\\b', 'gi'),
        new RegExp('\\b(?:' + numAlt + ')[-_\\s]*' + y + '[-_\\s]*' + esc(old) + '\\b', 'gi'),
        new RegExp('\\b(?:' + numAlt + ')[-_\\s]*' + esc(something) + '\\b', 'gi'),
        new RegExp('\\b' + stage + '[-_\\s]+(?:' + decAlt + ')\\b', 'gi'),
        new RegExp('\\b(?:' + esc(inn) + '[-_\\s]+)?' + who + '[-_\\s]+(?:' + stage + '[-_\\s]+)?(?:' + decAlt + ')\\b', 'gi'),
        new RegExp('\\b' + esc(over) + '[-_\\s]+(\\d{1,3})\\b', 'gi'),
        new RegExp('\\b' + esc(over) + '[-_\\s]+(?:' + roundAlt + ')\\b', 'gi'),
        new RegExp('\\b' + esc(pushing) + '[-_\\s]+(\\d{1,3})\\b', 'gi'),
        new RegExp('\\b' + esc(pushing) + '[-_\\s]+(?:' + roundAlt + ')\\b', 'gi')
    ].concat(nearAgeRes(y, roundAlt));
}

function nearAgeRes(y, roundAlt) {
    if (!GLUE[0] || !GLUE[4] || !AGE_WORD) return [];
    const near = '(?:' + GLUE.slice(0, 4).map(esc).join('|') + ')';
    return [
        new RegExp('\\b' + near + '[-_\\s]+(\\d{1,3})\\b', 'gi'),
        new RegExp('\\b' + near + '[-_\\s]+(?:' + roundAlt + ')\\b', 'gi'),
        new RegExp('\\b(\\d{1,3})[-_\\s]+' + y + '[-_\\s]+' + esc(GLUE[4]) + '[-_\\s]+' + esc(AGE_WORD) + '\\b', 'gi')
    ];
}

function rebuildTables() {
    PERSON_SET = new Set(PF.concat(PM, PN).map(norm));
    ID_G = new Map();
    IDF.forEach((w) => ID_G.set(norm(w), 1));
    IDM.forEach((w) => ID_G.set(norm(w), 2));
    IDN.forEach((w) => ID_G.set(norm(w), 0));
    PF.forEach((w) => ID_G.set(norm(w), 1));
    PM.forEach((w) => ID_G.set(norm(w), 2));
    const intens = '(?:(?:' + alt(INT) + ')[-_\\s]+)?';
    const people = alt(PF.concat(PM, PN));
    const adjAlt = ADJ.slice().sort((a, b) => b.length - a.length).map((w) => {
        const piece = parts(w);
        if (norm(w) === norm(AW[2] || '')) {
            return '(?<!(?:' + esc(AW[0]) + '|' + esc(AW[1]) + ')[-_\\s])' + piece;
        }
        return piece;
    }).join('|');
    ADJ_RE = new RegExp(intens + '(?:' + adjAlt + ')[-_\\s]+(' + people + ')\\b', 'gi');
    ID_RE = new RegExp('\\b(?:' + alt(IDF.concat(IDM, IDN)) + ')\\b', 'gi');
    SOLO_RE = new RegExp('\\b(?:' + alt(SOLO) + ')\\b', 'gi');
    GENDER_F_RE = new RegExp('(?:^|[^a-z])(?:\\d+\\+?)?(?:' + alt(GF) + ')(?=[^a-z]|$)', 'i');
    GENDER_M_RE = new RegExp('(?:^|[^a-z])(?:\\d+\\+?)?(?:' + alt(GM) + ')(?=[^a-z]|$)', 'i');
    AGE_RES = ageRes();
}

function bindPromptListTokenizer(tokenizer) {
    if (!tokenizer || !tokenizer.decode) return false;
    const dec = (ids) => tokenizer.decode(ids, true).replace(/\s+/g, ' ').trim();
    const many = (rows) => rows.map(dec).filter(Boolean);
    ADJ = many(ADJ_IDS);
    INT = many(INT_IDS);
    PF = many(PF_IDS);
    PM = many(PM_IDS);
    PN = many(PN_IDS);
    IDF = many(IDF_IDS);
    IDM = many(IDM_IDS);
    IDN = many(IDN_IDS);
    SOLO = many(SOLO_IDS);
    GF = many(GF_IDS);
    GM = many(GM_IDS);
    AW = many(AW_IDS);
    CANON_F = dec(CF_IDS);
    CANON_M = dec(CM_IDS);
    INVERSE_F = dec(YF_IDS);
    INVERSE_M = dec(YM_IDS);
    AGE_WORD = dec(AGE_WORD_IDS);
    AGED_WORD = dec(AGED_WORD_IDS);
    GLUE = many(GLUE_IDS);
    if (!CANON_F || !CANON_M || !INVERSE_F || !INVERSE_M || !AW.length) return false;
    rebuildTables();
    tablesReady = true;
    return true;
}

function bindServerTokenizer() {
    if (tablesReady) return true;
    const fs = require('fs');
    const path = require('path');
    const T5Tokenizer = require('../../../modules/t5-tokenizer-standalone');
    const jsonPath = path.join(__dirname, '../../protected/t5_tokenizer.json');
    const config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const next = new T5Tokenizer();
    next.loadFromJSON(config);
    return bindPromptListTokenizer(next);
}

function ensurePromptListTables() {
    if (tablesReady) return true;
    if (typeof t5Tokenizer !== 'undefined' && t5Tokenizer && t5Tokenizer.loaded) {
        return bindPromptListTokenizer(t5Tokenizer);
    }
    if (typeof module === 'undefined' || !module.exports) return false;
    try {
        return bindServerTokenizer();
    } catch (err) {
        return false;
    }
}

function emptyMarks() {
    return { f: 0, m: 0, n: 0 };
}

function bump(marks, g, w) {
    const weight = Math.abs(Number(w)) || 1;
    if (g === 1) marks.f = Math.max(marks.f, weight);
    else if (g === 2) marks.m = Math.max(marks.m, weight);
    else marks.n = Math.max(marks.n, weight);
}

function detectGender(text) {
    const raw = String(text || '');
    GENDER_F_RE.lastIndex = 0;
    GENDER_M_RE.lastIndex = 0;
    const f = GENDER_F_RE.test(raw);
    GENDER_F_RE.lastIndex = 0;
    const m = GENDER_M_RE.test(raw);
    GENDER_M_RE.lastIndex = 0;
    return { f: f, m: m };
}

function classify(text) {
    const n = norm(text);
    let f = false;
    let m = false;
    IDF.forEach((w) => { if (new RegExp('\\b' + parts(w) + '\\b', 'i').test(n)) f = true; });
    IDM.forEach((w) => { if (new RegExp('\\b' + parts(w) + '\\b', 'i').test(n)) m = true; });
    const g = detectGender(n);
    if (g.f) f = true;
    if (g.m) m = true;
    if (f && !m) return 1;
    if (m && !f) return 2;
    return 0;
}

function genderOfNoun(noun) {
    const key = norm(noun);
    if (ID_G.has(key)) return ID_G.get(key);
    return 0;
}

function applyAges(text, onHit) {
    let t = text;
    AGE_RES.forEach((re) => {
        re.lastIndex = 0;
        t = t.replace(re, (match, g1) => {
            if (typeof g1 === 'string' && /^\d+$/.test(g1)) {
                const n = parseInt(g1, 10);
                if (n < 18 || n > 130) return match;
            }
            const repl = onHit ? onHit(match) : '';
            return repl ? ' ' + repl + ' ' : ' ';
        });
    });
    return t;
}

function stripKnown(text) {
    let t = norm(text);
    t = applyAges(t);
    ADJ_RE.lastIndex = 0;
    t = t.replace(ADJ_RE, ' ');
    ID_RE.lastIndex = 0;
    t = t.replace(ID_RE, ' ');
    SOLO_RE.lastIndex = 0;
    t = t.replace(SOLO_RE, ' ');
    t = t.replace(/\b(?:a|an|the)\b/g, ' ');
    return t.replace(/\s+/g, ' ').trim();
}

function isPure(text) {
    const n = norm(text);
    if (!n) return false;
    const left = stripKnown(n);
    if (left === n) return false;
    if (!left) return true;
    return PERSON_SET.has(left);
}

const placeStack = [];

function currentPlace() {
    return placeStack.length ? placeStack[placeStack.length - 1] : null;
}

function takeInverse(g) {
    const st = currentPlace();
    if (!st) return '';
    const bits = [];
    if (g === 1) {
        if (!st.f) {
            st.f = true;
            bits.push(INVERSE_F);
        }
    } else if (g === 2) {
        if (!st.m) {
            st.m = true;
            bits.push(INVERSE_M);
        }
    } else {
        if (st.gender.f && !st.f) {
            st.f = true;
            bits.push(INVERSE_F);
        }
        if (st.gender.m && !st.m) {
            st.m = true;
            bits.push(INVERSE_M);
        }
    }
    return bits.join(', ');
}

function onlyInverse(text) {
    const n = norm(text);
    if (!n) return false;
    return n.split(/\s*,\s*/).every((part) => part === norm(INVERSE_F) || part === norm(INVERSE_M));
}

function tidy(s) {
    let t = String(s || '');
    if (INVERSE_F && PF.length) {
        t = t.replace(new RegExp('\\b' + parts(INVERSE_F) + '[-_\\s]+(?:' + alt(PF) + ')\\b', 'gi'), INVERSE_F);
    }
    if (INVERSE_M && PM.length) {
        t = t.replace(new RegExp('\\b' + parts(INVERSE_M) + '[-_\\s]+(?:' + alt(PM) + ')\\b', 'gi'), INVERSE_M);
    }
    t = t.replace(/-?(?:\d+(?:\.\d+)?|\.\d+)::[ \t]*::/g, ' ');
    t = t.replace(/[ \t]{2,}/g, ' ');
    t = t.replace(/[ \t]+,/g, ',');
    t = t.replace(/,[ \t]*,+/g, ', ');
    t = t.replace(/^[ \t]*,[ \t]*|[ \t]*,[ \t]*$/g, '');
    t = t.replace(/\ban[ \t]+(?=[bcdfghjklmnpqrstvwxyz])/gi, (full) => (full[0] === 'A' ? 'A ' : 'a '));
    t = t.replace(/\ba[ \t]+(?=[aeiou])/gi, (full) => (full[0] === 'A' ? 'An ' : 'an '));
    return t.trim();
}

function visible(s) {
    return String(s || '')
        .replace(/[\u200B-\u200D\u2060\u2063\u2064\uFEFF]/g, '')
        .replace(/-?(?:\d+(?:\.\d+)?|\.\d+)::/g, '')
        .replace(/::/g, '')
        .replace(/[{}\[\]]/g, '')
        .trim();
}

function matchWeightOpen(text, i) {
    if (i > 0 && /[A-Za-z0-9_]/.test(text.charAt(i - 1))) return null;
    const m = text.slice(i).match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*::/);
    if (!m) return null;
    const n = Math.abs(parseFloat(m[1]));
    if (!Number.isFinite(n) || n > 100) return null;
    return { len: m[0].length, weight: parseFloat(m[1]) };
}

function findEmphasisEnd(text, innerStart) {
    let i = innerStart;
    while (i < text.length) {
        if (text.startsWith('::', i)) return { innerEnd: i, end: i + 2, closed: true };
        const open = matchWeightOpen(text, i);
        if (open) return { innerEnd: i, end: i, closed: false };
        i += 1;
    }
    return { innerEnd: text.length, end: text.length, closed: false };
}

function splitDelim(text, delim) {
    const partsOut = [];
    let buf = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const open = matchWeightOpen(text, i);
        if (open) {
            depth += 1;
            buf += text.slice(i, i + open.len);
            i += open.len - 1;
            continue;
        }
        if (depth > 0 && text.startsWith('::', i)) {
            depth -= 1;
            buf += '::';
            i += 1;
            continue;
        }
        if (depth === 0 && text.charAt(i) === delim) {
            partsOut.push(buf);
            buf = '';
            continue;
        }
        buf += text.charAt(i);
    }
    partsOut.push(buf);
    return partsOut;
}

function peel(seg) {
    let t = String(seg || '').trim();
    let w = 1;
    let prev;
    do {
        prev = t;
        const emph = t.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))::([\s\S]*)::$/);
        if (emph && Math.abs(parseFloat(emph[1])) <= 100) {
            w *= Math.abs(parseFloat(emph[1])) || 1;
            t = emph[2].trim();
            continue;
        }
        const br = t.match(/^(\{+)([\s\S]*?)(\}+)$/);
        if (br && br[1].length === br[3].length) {
            w *= Math.pow(1.05, br[1].length);
            t = br[2].trim();
            continue;
        }
        const bk = t.match(/^(\[+)([\s\S]*?)(\]+)$/);
        if (bk && bk[1].length === bk[3].length) {
            w *= Math.pow(1 / 1.05, bk[1].length);
            t = bk[2].trim();
            continue;
        }
        t = t.replace(/^["']+|["']+$/g, '').trim();
        t = t.replace(/^(?:a|an|the)\s+/i, '').trim();
    } while (t !== prev);
    return { text: t, w: w };
}

function inlineStrip(seg, weight, marks) {
    let hit = false;
    const note = (g) => {
        hit = true;
        bump(marks, g, weight);
    };
    let t = String(seg || '');
    ADJ_RE.lastIndex = 0;
    t = t.replace(ADJ_RE, (match, noun) => {
        const g = genderOfNoun(noun);
        note(g);
        return takeInverse(g) || noun;
    });
    ID_RE.lastIndex = 0;
    t = t.replace(ID_RE, (match) => {
        const g = genderOfNoun(match);
        note(g);
        return takeInverse(g);
    });
    const before = t;
    t = applyAges(t, () => {
        const g = classify(seg);
        note(g);
        return takeInverse(g);
    });
    if (t !== before) hit = true;
    if (!hit) return tidy(seg);
    return tidy(t);
}

function cleanSegment(seg, weightMul, marks) {
    const raw = String(seg || '');
    if (!visible(raw)) return '';
    const peeled = peel(raw);
    const weight = weightMul * (peeled.w || 1);
    if (isPure(peeled.text)) {
        const g = classify(peeled.text);
        bump(marks, g, weight);
        return takeInverse(g);
    }
    return inlineStrip(raw, weight, marks);
}

function stripSegments(text, weightMul, marks) {
    const lines = splitDelim(text, '\n');
    const out = [];
    lines.forEach((line) => {
        if (!line.trim()) {
            out.push('');
            return;
        }
        const groups = splitDelim(line, '|');
        const keptGroups = [];
        groups.forEach((group) => {
            const tags = splitDelim(group, ',');
            const kept = [];
            tags.forEach((tag) => {
                const cleaned = cleanSegment(tag, weightMul, marks);
                if (visible(cleaned)) kept.push(cleaned.trim());
            });
            if (kept.length) keptGroups.push(kept.join(', '));
        });
        if (keptGroups.length) out.push(keptGroups.join(' | '));
    });
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
}

function rewriteEmphasis(text, weightMul, marks, depth) {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const open = matchWeightOpen(text, i);
        if (!open) {
            out += text.charAt(i);
            i += 1;
            continue;
        }
        const found = findEmphasisEnd(text, i + open.len);
        const inner = text.slice(i + open.len, found.innerEnd);
        const cleaned = processChunk(inner, weightMul * (Math.abs(open.weight) || 1), marks, depth + 1);
        if (visible(cleaned)) {
            if (onlyInverse(cleaned)) out += cleaned.trim();
            else out += text.slice(i, i + open.len) + cleaned.trim() + (found.closed ? '::' : '');
        }
        i = found.end;
    }
    return out;
}

function processChunk(text, weightMul, marks, depth) {
    if (!text) return '';
    if (depth > 8) return stripSegments(text, weightMul, marks);
    const rewritten = rewriteEmphasis(text, weightMul, marks, depth || 0);
    return stripSegments(rewritten, weightMul, marks);
}

function foldRegions(text, fn) {
    if (text.indexOf(DO) < 0 && text.indexOf(DC) < 0) return fn(text);
    let out = '';
    let i = 0;
    while (i < text.length) {
        const open = text.indexOf(DO, i);
        if (open < 0) {
            out += fn(text.slice(i));
            break;
        }
        const close = text.indexOf(DC, open + 1);
        if (close < 0) {
            out += fn(text.slice(i));
            break;
        }
        out += fn(text.slice(i, open));
        out += text.slice(open, close + 1);
        i = close + 1;
    }
    return out;
}

function splitTextColon(text) {
    const m = /\btext:/i.exec(text);
    if (!m) return { tags: text, suffix: '' };
    let splitAt = m.index;
    while (splitAt > 0 && /[ \t]/.test(text.charAt(splitAt - 1))) splitAt -= 1;
    if (splitAt > 0 && text.charAt(splitAt - 1) === ',') splitAt -= 1;
    return { tags: text.slice(0, splitAt), suffix: text.slice(splitAt) };
}

function withoutProtected(text) {
    return String(text || '').replace(/\uE010[\s\S]*?\uE011/g, ' ');
}

function hasPhrase(text, phrase) {
    if (!phrase) return false;
    return new RegExp('\\b' + parts(phrase) + '\\b', 'i').test(norm(text));
}

function foldPromptList(text) {
    if (typeof text !== 'string' || !text) {
        return { text: text || '', marks: emptyMarks(), gender: { f: false, m: false } };
    }
    if (!ensurePromptListTables()) {
        return { text: text, marks: emptyMarks(), gender: { f: false, m: false } };
    }
    const split = splitTextColon(text);
    const gender = detectGender(withoutProtected(split.tags));
    const marks = emptyMarks();
    placeStack.push({
        f: hasPhrase(split.tags, INVERSE_F),
        m: hasPhrase(split.tags, INVERSE_M),
        gender: gender
    });
    let tags;
    try {
        tags = foldRegions(split.tags, (chunk) => processChunk(chunk, 1, marks, 0));
    } finally {
        placeStack.pop();
    }
    let suffix = split.suffix;
    if (!String(tags || '').trim() && suffix.charAt(0) === ',') suffix = suffix.replace(/^,\s*/, '');
    const joined = (tags + suffix).replace(/[ \t]{2,}/g, ' ');
    return { text: joined.trim(), marks: marks, gender: gender };
}

function emptySlot() {
    return { pos: emptyMarks(), uc: emptyMarks(), gender: { f: false, m: false } };
}

function createFoldBag() {
    return { base: emptySlot(), chars: [] };
}

function mergeMarks(dst, src) {
    if (!src) return;
    dst.f = Math.max(dst.f || 0, src.f || 0);
    dst.m = Math.max(dst.m || 0, src.m || 0);
    dst.n = Math.max(dst.n || 0, src.n || 0);
}

function noteFold(bag, hint, folded) {
    if (!bag || !folded) return;
    const hintStr = String(hint || '');
    const cm = /character_(\d+)/.exec(hintStr);
    let slot;
    if (cm) {
        const idx = Number(cm[1]);
        if (!bag.chars[idx]) bag.chars[idx] = emptySlot();
        slot = bag.chars[idx];
    } else {
        slot = bag.base;
    }
    const side = /uc|negative/.test(hintStr) ? 'uc' : 'pos';
    mergeMarks(slot[side], folded.marks);
    if (side === 'pos' && folded.gender) {
        if (folded.gender.f) slot.gender.f = true;
        if (folded.gender.m) slot.gender.m = true;
    }
}

const folds = new WeakMap();

function rememberPromptFold(obj, bag) {
    if (obj && typeof obj === 'object') folds.set(obj, bag);
}

function fmtW(w) {
    const n = Math.round(Math.abs(Number(w)) * 1000) / 1000;
    if (!Number.isFinite(n) || n <= 0) return '1';
    return String(n);
}

function combineStrength(posW, ucW, auto) {
    let w = 0;
    if (posW > 0) w = Math.min(CAP, Math.max(FLOOR, posW * SCALE));
    else if (auto) w = FLOOR;
    if (ucW > 0) w = Math.max(w, Math.min(CAP, ucW));
    return w;
}

function upsertClause(uc, word, w) {
    const re = new RegExp('(-?\\d+(?:\\.\\d+)?)::' + esc(word) + '::', 'i');
    const shown = fmtW(w);
    if (re.test(String(uc || ''))) {
        re.lastIndex = 0;
        return String(uc).replace(re, () => shown + '::' + word + '::');
    }
    const base = String(uc || '').trim().replace(/[,\s]+$/, '');
    const piece = shown + '::' + word + '::';
    return base ? base + ', ' + piece : piece;
}

function resolveGender(slot, promptText) {
    const g = {
        f: !!(slot && slot.gender && slot.gender.f),
        m: !!(slot && slot.gender && slot.gender.m)
    };
    if (!g.f && !g.m) {
        const dGender = detectGender(promptText || '');
        g.f = dGender.f;
        g.m = dGender.m;
    }
    return g;
}

function mergeUc(uc, prompt, slot) {
    const pos = (slot && slot.pos) || emptyMarks();
    const neg = (slot && slot.uc) || emptyMarks();
    const g = resolveGender(slot, prompt);
    let fW = pos.f || 0;
    let mW = pos.m || 0;
    if (pos.n) {
        if (g.f) fW = Math.max(fW, pos.n);
        if (g.m) mW = Math.max(mW, pos.n);
        if (!g.f && !g.m) {
            fW = Math.max(fW, pos.n);
            mW = Math.max(mW, pos.n);
        }
    }
    let next = uc || '';
    if (g.f || fW > 0 || neg.f > 0) {
        const w = combineStrength(fW, neg.f, g.f || fW > 0);
        if (w > 0) next = upsertClause(next, CANON_F, w);
    }
    if (g.m || mW > 0 || neg.m > 0) {
        const w = combineStrength(mW, neg.m, g.m || mW > 0);
        if (w > 0) next = upsertClause(next, CANON_M, w);
    }
    return next;
}

const compiledPayloads = new WeakSet();

function sealApiPayload(apiOpts, source) {
    if (!apiOpts || typeof apiOpts !== 'object') return apiOpts;
    if (!ensurePromptListTables()) return apiOpts;
    let bag = source ? folds.get(source) : null;
    if (!bag) {
        bag = createFoldBag();
        if (source && typeof source === 'object') folds.set(source, bag);
    }
    if (typeof apiOpts.prompt === 'string') {
        const folded = foldPromptList(apiOpts.prompt);
        apiOpts.prompt = folded.text;
        noteFold(bag, 'prompt', folded);
    }
    const sealed = mergeUc(apiOpts.negative_prompt, apiOpts.prompt, bag.base);
    apiOpts.negative_prompt = sealed;
    if (typeof apiOpts.uc === 'string') apiOpts.uc = sealed;
    if (Array.isArray(apiOpts.characterPrompts)) {
        const srcList = source && Array.isArray(source.allCharacterPrompts) ? source.allCharacterPrompts : null;
        if (srcList) {
            let ai = 0;
            for (let i = 0; i < srcList.length; i++) {
                const char = srcList[i];
                if (!char || !char.enabled) continue;
                const apiChar = apiOpts.characterPrompts[ai++];
                if (!apiChar) break;
                if (typeof apiChar.prompt === 'string') {
                    const folded = foldPromptList(apiChar.prompt);
                    apiChar.prompt = folded.text;
                    noteFold(bag, 'character_' + i, folded);
                }
                apiChar.uc = mergeUc(apiChar.uc, apiChar.prompt, bag.chars[i]);
            }
        } else {
            apiOpts.characterPrompts.forEach((apiChar, i) => {
                if (!apiChar) return;
                if (typeof apiChar.prompt === 'string') {
                    const folded = foldPromptList(apiChar.prompt);
                    apiChar.prompt = folded.text;
                    noteFold(bag, 'character_' + i, folded);
                }
                apiChar.uc = mergeUc(apiChar.uc, apiChar.prompt, bag.chars[i]);
            });
        }
    }
    compiledPayloads.add(apiOpts);
    return apiOpts;
}

function assertTokenCompiler(apiOpts) {
    if (!apiOpts || typeof apiOpts !== 'object' || !compiledPayloads.has(apiOpts)) {
        console.error('Illegal Operation, Token compiler failed to run');
        throw new Error('Illegal Operation, Token compiler failed to run');
    }
}

function maskAgeReadText(text) {
    if (typeof text !== 'string' || !text) return text;
    if (!ensurePromptListTables()) return text;
    const split = splitTextColon(text);
    const masked = foldRegions(split.tags, (chunk) => {
        let next = chunk;
        if (INVERSE_F && CANON_F) {
            next = next.replace(new RegExp('\\b' + parts(INVERSE_F) + '\\b', 'gi'), CANON_F);
        }
        if (INVERSE_M && CANON_M) {
            next = next.replace(new RegExp('\\b' + parts(INVERSE_M) + '\\b', 'gi'), CANON_M);
        }
        return next;
    });
    return masked + split.suffix;
}

function stripWeightedCanon(text) {
    if (typeof text !== 'string' || !text) return text;
    if (!ensurePromptListTables()) return text;
    const split = splitTextColon(text);
    const stripped = foldRegions(split.tags, (chunk) => {
        let next = chunk;
        [CANON_F, CANON_M].forEach((canon) => {
            if (!canon) return;
            next = next.replace(new RegExp('(?:^\\s*|\\s*,\\s*|\\n\\s*)\\d+(?:\\.\\d+)?\\s*::\\s*' + parts(canon) + '\\s*::', 'gi'), '');
        });
        return next;
    });
    return (stripped + split.suffix).replace(/\s*,\s*,\s*/g, ', ').replace(/^\s*,\s*|\s*,\s*$/g, '');
}

function maskCompiledReadText(text) {
    return stripWeightedCanon(maskAgeReadText(text));
}

function maskReadChunk(chunk) {
    if (!chunk || typeof chunk !== 'object') return chunk;
    const out = { ...chunk };
    if (typeof out.text === 'string') out.text = maskAgeReadText(out.text);
    if (typeof out.value === 'string') out.value = maskAgeReadText(out.value);
    return out;
}

function maskReadField(field) {
    if (!field || typeof field !== 'object') return field;
    const out = { ...field };
    if (typeof out.text === 'string') out.text = maskAgeReadText(out.text);
    if (typeof out.replace === 'string') out.replace = maskAgeReadText(out.replace);
    if (Array.isArray(out.chunks)) out.chunks = out.chunks.map(maskReadChunk);
    return out;
}

function maskReadCharacter(row, compiledSide) {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row };
    const mask = compiledSide ? maskCompiledReadText : maskAgeReadText;
    ['prompt', 'uc', 'promptNegative', 'input_prompt_negative', 'negative_prompt', 'input_prompt', 'input_uc'].forEach((key) => {
        if (typeof out[key] === 'string') out[key] = mask(out[key]);
    });
    return out;
}

function maskReplacementRow(item) {
    if (!item || typeof item !== 'object') return item;
    const out = { ...item };
    if (typeof out.value === 'string') out.value = maskAgeReadText(out.value);
    return out;
}

function maskAgentStudioRead(node, compiledSide) {
    if (typeof node === 'string') return compiledSide ? maskCompiledReadText(node) : maskAgeReadText(node);
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((entry) => maskAgentStudioRead(entry, compiledSide));
    const out = { ...node };
    const mask = compiledSide ? maskCompiledReadText : maskAgeReadText;
    ['prompt', 'uc', 'promptNegative', 'input_prompt_negative', 'negative_prompt', 'input_prompt', 'input_uc'].forEach((key) => {
        if (typeof out[key] === 'string') out[key] = mask(out[key]);
    });
    ['compiled_prompt', 'compiled_uc', 'compiledPrompt'].forEach((key) => {
        if (typeof out[key] === 'string') out[key] = maskCompiledReadText(out[key]);
    });
    if (out.compiled_prompt && typeof out.compiled_prompt === 'object' && !Array.isArray(out.compiled_prompt)) {
        out.compiled_prompt = maskAgentStudioRead(out.compiled_prompt, true);
    }
    if (Array.isArray(out.fields)) out.fields = out.fields.map(maskReadField);
    if (Array.isArray(out.characters)) out.characters = out.characters.map((row) => maskReadCharacter(row, compiledSide));
    if (Array.isArray(out.characterPrompts)) out.characterPrompts = out.characterPrompts.map((row) => maskReadCharacter(row, compiledSide));
    if (Array.isArray(out.compiled_characterPrompts)) out.compiled_characterPrompts = out.compiled_characterPrompts.map((row) => maskReadCharacter(row, true));
    if (out.compiled && typeof out.compiled === 'object' && !Array.isArray(out.compiled)) {
        out.compiled = maskAgentStudioRead(out.compiled, true);
    }
    ['dynamic_generation', 'dynamicGeneration'].forEach((key) => {
        if (out[key] && typeof out[key] === 'object') out[key] = maskAgentStudioRead(out[key], false);
    });
    ['text_replacements', 'expanders', 'dg_expanders'].forEach((key) => {
        if (Array.isArray(out[key])) out[key] = out[key].map(maskReplacementRow);
    });
    if (out.change && typeof out.change === 'object') out.change = maskAgentStudioRead(out.change, false);
    if (out.studio && typeof out.studio === 'object') out.studio = maskAgentStudioRead(out.studio, false);
    if (Array.isArray(out.phases)) {
        out.phases = out.phases.map((phase) => {
            if (!phase || typeof phase !== 'object') return phase;
            const next = { ...phase };
            if (typeof next.prompt === 'string') next.prompt = maskAgeReadText(next.prompt);
            if (typeof next.uc === 'string') next.uc = maskAgeReadText(next.uc);
            return next;
        });
    }
    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        foldPromptList,
        bindPromptListTokenizer,
        createFoldBag,
        noteFold,
        rememberPromptFold,
        sealApiPayload,
        assertTokenCompiler,
        maskAgeReadText,
        maskCompiledReadText,
        maskAgentStudioRead
    };
}
