'use strict';

/**
 * Spell checking engine for prompts (pure JS, no native addon).
 *
 * Vocabulary: SCOWL word lists (wordlist-english, sizes 10-70, American + British + common
 * English) plus words from Danbooru/e621 tags (tag_wiki.db). Tag titles are spaced, never
 * underscored. Artist tags are not vocabulary (names are not words); the tokenizer skips
 * text after `artist:` entirely.
 *
 * Suggestions walk a typed-array trie with a weighted Damerau distance (doubled letters,
 * neighbouring keys and swapped letters cost less), then rank by distance and word
 * frequency. A lookup takes about a millisecond, so it runs inline without an event-loop stall.
 */

const SCOWL_LEVELS = [10, 20, 35, 40, 50, 55, 60, 70];
const SCOWL_VARIANTS = ['english', 'american', 'british'];
// Rough corpus frequency per SCOWL size (smaller size = more common word).
const LEVEL_FREQ = { 10: 1e6, 20: 3e5, 35: 1e5, 40: 5e4, 50: 1.5e4, 55: 5e3, 60: 800, 70: 100 };

// Tag word frequency = summed Danbooru + e621 post counts of the tags it appears in, scaled.
const TAG_FREQ_SCALE = 0.5;
// Minimum post count for a tag to lend its words, by tag category.
const TAG_MIN_COUNT_GENERAL = 20;
const TAG_MIN_COUNT_NAME = 100; // character (4) and copyright (3)
// Minimum summed weight for a tag word to count as known on its own. Name words (character,
// copyright) need more: obscure names such as "brest" would hide typos ("brest" for breast).
// A name below that still passes when the user types the whole tag (tagPhrases).
const TAG_MIN_WORD_WEIGHT = 50;
const TAG_MIN_NAME_WORD_WEIGHT = 300;
// Name words rank lower as suggestions than vocabulary words of the same post count.
const TAG_NAME_FREQ_FACTOR = 0.1;
const TAG_CATEGORY_ARTIST = 1;
const TAG_NAME_CATEGORIES = new Set([3, 4]);

// Score = cost * DIST_WEIGHT - ln(freq); one full edit is worth about a 150x frequency gap.
const DIST_WEIGHT = 5;
const TRANSPOSE_COST = 0.6;
const FIRST_LETTER_PENALTY = 0.35;
const MAX_SUGGESTIONS = 6;
const SUGGEST_CACHE_LIMIT = 5000;
const MAX_WORD_LENGTH = 40;

// Common contractions SCOWL leaves out (its lists have no apostrophe forms).
const CONTRACTIONS = [
    "ain't", "aren't", "can't", "couldn't", "didn't", "doesn't", "don't", "hadn't", "hasn't",
    "haven't", "he'd", "he'll", "he's", "i'd", "i'll", "i'm", "i've", "isn't", "it'd", "it'll",
    "it's", "let's", "mightn't", "mustn't", "needn't", "shan't", "she'd", "she'll", "she's",
    "shouldn't", "that's", "there's", "they'd", "they'll", "they're", "they've", "wasn't",
    "we'd", "we'll", "we're", "we've", "weren't", "what's", "where's", "who's", "won't",
    "wouldn't", "you'd", "you'll", "you're", "you've", "y'all", "o'clock", "ma'am", "'tis",
    "how's", "here's", "who'd", "who'll", "why's", "when's", "c'mon", "gonna", "wanna", "gotta"
];
const CONTRACTION_SUFFIXES = ["n't", "'re", "'ve", "'ll", "'d", "'m"];
// "dont" -> "don't": a contraction typed without its apostrophe ranks first.
const CONTRACTION_BY_BARE = new Map(CONTRACTIONS.filter((c) => c.includes("'")).map((c) => [c.replace(/'/g, ''), c]));

// Derived forms past SCOWL size 70 (overexaggerated, disproportionately): a common base
// (SCOWL size 55 or tag weight to match) plus one of these passes. The base needs four letters
// after a long prefix, five after a short one (redish is not re + dish), and seven before a
// suffix (shinely is not a word). They never become suggestions.
const DERIVE_PREFIXES = [
    'un', 're', 'non', 'over', 'under', 'pre', 'post', 'anti', 'semi', 'super', 'hyper', 'ultra',
    'mini', 'multi', 'mid', 'sub', 'out', 'half', 'cross', 'counter', 'inter', 'micro', 'mega',
    'neo', 'pseudo', 'dis', 'mis', 'see', 'self'
];
const DERIVE_SUFFIXES = ['ly', 'ally', 'ness', 'less'];
const DERIVE_MIN_BASE_FREQ = 5e3;
// Each half of a run-together split must be at least this common (no "halo wen", "dis proportionately").
const SPLIT_MIN_FREQ = 2e4;
const SPLIT_MIN_FREQ_SHORT = 1e5; // halves of three letters or fewer
// Two-letter words allowed as one half of a run-together split ("inthe" -> "in the").
const SPLIT_SHORT_WORDS = new Set(['a', 'i', 'an', 'in', 'on', 'of', 'to', 'at', 'is', 'my', 'by', 'up', 'no', 'or', 'as', 'it', 'we', 'he', 'me', 'so', 'do', 'go', 'be']);

// QWERTY neighbours: substituting one for another is a cheaper slip.
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const VOWEL_CODES = (() => {
    const t = new Uint8Array(128);
    for (const v of 'aeiou') t[v.charCodeAt(0)] = 1;
    return t;
})();

function buildKeyNeighbours() {
    const pos = new Map();
    KEY_ROWS.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) pos.set(row[c], [r, c + r * 0.5]);
    });
    const out = new Set();
    for (const [a, [ra, ca]] of pos) {
        for (const [b, [rb, cb]] of pos) {
            if (a !== b && Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1) out.add(a + b);
        }
    }
    return out;
}
const KEY_NEIGHBOURS = buildKeyNeighbours();

const WORD_KEY_RE = /^[a-z][a-z'-]*$/;

/** Lowercase, fold accents (cafe with an accent -> cafe) and curly apostrophes. */
function foldWord(word) {
    return String(word || '')
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .replace(/[‘’ʼ`´]/g, "'")
        .toLowerCase();
}

// Substitution cost by char code pair (a-z, apostrophe, hyphen): neighbouring keys and
// vowel-for-vowel slips are cheaper than other substitutions.
const SUB_COST = (() => {
    const table = new Float32Array(128 * 128).fill(1);
    for (let a = 0; a < 128; a++) table[a * 128 + a] = 0;
    for (const pair of KEY_NEIGHBOURS) table[pair.charCodeAt(0) * 128 + pair.charCodeAt(1)] = 0.7;
    for (const a of VOWELS) {
        for (const b of VOWELS) {
            if (a !== b) table[a.charCodeAt(0) * 128 + b.charCodeAt(0)] = Math.min(0.75, table[a.charCodeAt(0) * 128 + b.charCodeAt(0)]);
        }
    }
    return table;
})();

/**
 * Immutable trie over sorted unique words, stored in typed arrays.
 * Node 0 is the root. term[n] is the word index ending at n, or -1.
 */
class WordTrie {
    constructor(sortedWords) {
        const firstChild = [-1];
        const nextSibling = [-1];
        const lastChild = [-1];
        const chars = [0];
        const term = [-1];
        const stack = [0];
        let prev = '';
        for (let i = 0; i < sortedWords.length; i++) {
            const word = sortedWords[i];
            let lcp = 0;
            const lim = Math.min(prev.length, word.length);
            while (lcp < lim && prev.charCodeAt(lcp) === word.charCodeAt(lcp)) lcp++;
            stack.length = lcp + 1;
            let node = stack[lcp];
            for (let k = lcp; k < word.length; k++) {
                const n = chars.length;
                firstChild.push(-1);
                nextSibling.push(-1);
                lastChild.push(-1);
                chars.push(word.charCodeAt(k));
                term.push(-1);
                if (lastChild[node] === -1) firstChild[node] = n;
                else nextSibling[lastChild[node]] = n;
                lastChild[node] = n;
                stack.push(n);
                node = n;
            }
            term[node] = i;
            prev = word;
        }
        this.words = sortedWords;
        this.firstChild = Int32Array.from(firstChild);
        this.nextSibling = Int32Array.from(nextSibling);
        this.chars = Uint8Array.from(chars);
        this.term = Int32Array.from(term);
        this.size = chars.length;
    }

    /**
     * Every word within maxCost of input (weighted optimal string alignment distance).
     * @returns {Array<{word: string, cost: number}>}
     */
    search(input, maxCost) {
        const n = input.length;
        const x = new Uint8Array(n + 1);
        for (let j = 1; j <= n; j++) x[j] = input.charCodeAt(j - 1);
        // extra[j]: cost of input char j being a stray keystroke (half when it doubles its neighbour).
        const extra = new Float32Array(n + 1);
        for (let j = 1; j <= n; j++) extra[j] = (j > 1 && x[j] === x[j - 1]) ? 0.5 : 1;

        const maxDepth = n + Math.ceil(maxCost) + 1;
        const rows = [];
        for (let d = 0; d <= maxDepth; d++) rows.push(new Float32Array(n + 1));
        const path = new Uint8Array(maxDepth + 1);
        const row0 = rows[0];
        row0[0] = 0;
        for (let j = 1; j <= n; j++) row0[j] = row0[j - 1] + extra[j];

        const out = [];
        const { firstChild, nextSibling, chars, term, words } = this;

        const visit = (node, depth) => {
            const c = chars[node];
            path[depth] = c;
            const prevRow = rows[depth - 1];
            const row = rows[depth];
            const cPrev = depth > 1 ? path[depth - 1] : 0;
            // Candidate char missing from the input: half when the candidate doubles it,
            // less for a dropped vowel (blnde -> blonde).
            const missing = (depth > 1 && c === cPrev) ? 0.5 : (VOWEL_CODES[c] ? 0.8 : 1);
            row[0] = prevRow[0] + missing;
            let rowMin = row[0];
            const subRow = c * 128;
            for (let j = 1; j <= n; j++) {
                let best = prevRow[j] + missing;
                const ins = row[j - 1] + extra[j];
                if (ins < best) best = ins;
                const xj = x[j];
                const sub = prevRow[j - 1] + SUB_COST[subRow + xj];
                if (sub < best) best = sub;
                if (depth > 1 && j > 1 && c === x[j - 1] && cPrev === xj && c !== xj) {
                    const tr = rows[depth - 2][j - 2] + TRANSPOSE_COST;
                    if (tr < best) best = tr;
                }
                row[j] = best;
                if (best < rowMin) rowMin = best;
            }
            if (term[node] !== -1 && row[n] <= maxCost) {
                out.push({ word: words[term[node]], cost: row[n] });
            }
            if (rowMin > maxCost || depth >= maxDepth) return;
            for (let child = firstChild[node]; child !== -1; child = nextSibling[child]) {
                visit(child, depth + 1);
            }
        };

        for (let child = firstChild[0]; child !== -1; child = nextSibling[child]) {
            visit(child, 1);
        }
        return out;
    }
}

class SpellEngine {
    constructor() {
        this.baseFreq = new Map();   // SCOWL + contractions: folded word -> frequency
        this.freq = new Map();       // baseFreq plus tag words
        this.tagPhrases = new Set(); // normalized whole tag titles (non-artist)
        this.nameOnlyWords = new Set(); // known only from character / copyright tags
        this.dictionaryWordCount = 0;
        this.tagWordCount = 0;
        this.trie = null;
        this.suggestCache = new Map();
        this.dirty = true;
    }

    /** Load SCOWL lists from wordlist-english. Throws if the package is missing. */
    loadScowl(wordlistDir = null) {
        const dir = wordlistDir || require('path').dirname(require.resolve('wordlist-english/package.json'));
        const path = require('path');
        let count = 0;
        for (const variant of SCOWL_VARIANTS) {
            for (const level of SCOWL_LEVELS) {
                const list = require(path.join(dir, `${variant}-words-${level}.json`));
                const f = LEVEL_FREQ[level];
                for (const w of list) {
                    const k = foldWord(w);
                    if (!WORD_KEY_RE.test(k)) continue;
                    const prev = this.baseFreq.get(k);
                    if (prev === undefined) count++;
                    if (prev === undefined || prev < f) this.baseFreq.set(k, f);
                }
            }
        }
        for (const c of CONTRACTIONS) {
            if (!this.baseFreq.has(c)) this.baseFreq.set(c, 5e3);
        }
        this.freq = new Map(this.baseFreq);
        this.tagWordCount = 0;
        this.dictionaryWordCount = count;
        this.markDirty();
        return count;
    }

    /**
     * Replace the tag words with these. rows: [{ title, category, count }]. Artist tags are ignored.
     * @returns {number} words that became known
     */
    addTagVocabulary(rows) {
        const weights = new Map();     // word -> weight from general-style tags
        const nameWeights = new Map(); // word -> weight from character / copyright tags
        const phrases = new Set();
        for (const row of rows) {
            if (!row || !row.title) continue;
            const category = Number(row.category);
            if (category === TAG_CATEGORY_ARTIST) continue;
            const count = Number(row.count) || 0;
            if (count < TAG_MIN_COUNT_GENERAL) continue;
            const phrase = normalizeTagPhrase(row.title);
            if (phrase && phrase.includes(' ')) phrases.add(phrase);
            const isName = TAG_NAME_CATEGORIES.has(category);
            if (isName && count < TAG_MIN_COUNT_NAME) continue;
            const target = isName ? nameWeights : weights;
            for (const w of tagTitleWords(row.title)) {
                target.set(w, (target.get(w) || 0) + count);
            }
        }
        const nameOnly = new Set();
        for (const [w, weight] of nameWeights) {
            if (weight < TAG_MIN_NAME_WORD_WEIGHT) continue;
            if (!weights.has(w) && !this.baseFreq.has(w)) nameOnly.add(w);
            weights.set(w, (weights.get(w) || 0) + weight * TAG_NAME_FREQ_FACTOR);
        }
        this.tagPhrases = phrases;
        this.nameOnlyWords = nameOnly;
        const freq = new Map(this.baseFreq);
        let added = 0;
        for (const [w, weight] of weights) {
            if (weight < TAG_MIN_WORD_WEIGHT && !nameOnly.has(w)) continue;
            const f = weight * TAG_FREQ_SCALE;
            const prev = freq.get(w);
            if (prev === undefined) added++;
            if (prev === undefined || prev < f) freq.set(w, f);
        }
        this.freq = freq;
        this.tagWordCount = added;
        this.markDirty();
        return added;
    }

    markDirty() {
        this.dirty = true;
        this.suggestCache.clear();
    }

    ensureTrie() {
        if (!this.dirty && this.trie) return this.trie;
        const words = Array.from(this.freq.keys()).sort();
        this.trie = new WordTrie(words);
        this.dirty = false;
        return this.trie;
    }

    hasWord(key) {
        return this.freq.has(key);
    }

    /**
     * @param {string} word raw token
     * @param {Set<string>} [extraWords] folded custom words
     */
    isKnown(word, extraWords = null) {
        const k = foldWord(word);
        if (!k) return true;
        return this._isKnownKey(k, extraWords, 0);
    }

    _isKnownKey(k, extraWords, depth) {
        if (this.freq.has(k) || (extraWords && extraWords.has(k))) return true;
        if (depth > 2) return false;
        if (k.endsWith("'s") && k.length > 2) return this._isKnownKey(k.slice(0, -2), extraWords, depth + 1);
        if (k.endsWith("s'") && k.length > 2) return this._isKnownKey(k.slice(0, -1), extraWords, depth + 1);
        for (const suf of CONTRACTION_SUFFIXES) {
            if (k.endsWith(suf) && k.length > suf.length) {
                return this._isKnownKey(k.slice(0, -suf.length), extraWords, depth + 1);
            }
        }
        if (k.includes('-')) {
            const parts = k.split('-').filter(Boolean);
            return parts.length > 0 && parts.every((p) => this._isKnownKey(p, extraWords, depth + 1));
        }
        return this._isDerived(k);
    }

    _isDerived(k) {
        const common = (base) => (this.freq.get(base) || 0) >= DERIVE_MIN_BASE_FREQ;
        for (const pre of DERIVE_PREFIXES) {
            const minBase = pre.length <= 3 ? 5 : 4;
            if (k.length - pre.length >= minBase && k.startsWith(pre) && common(k.slice(pre.length))) return true;
        }
        for (const suf of DERIVE_SUFFIXES) {
            if (k.length - suf.length >= 7 && k.endsWith(suf) && common(k.slice(0, -suf.length))) return true;
        }
        return false;
    }

    frequency(key) {
        return this.freq.get(key) || 1;
    }

    /**
     * Check a prompt or prose text.
     * A comma / bracket / `::` separated chunk that is exactly a tag title passes whole, so an
     * obscure character name typed as its full tag is not flagged. Unknown hyphenated words are
     * split and each part checked.
     * @param {string} text
     * @param {Set<string>} [extraWords] folded custom words
     * @returns {Array<{word: string, start: number, end: number, known: boolean}>}
     */
    checkPrompt(text, extraWords = null) {
        const tokens = tokenizePrompt(text);
        if (tokens.length === 0) return [];
        const tagSpans = this.tagPhrases.size ? findTagPhraseSpans(text, this.tagPhrases) : [];
        const out = [];
        let si = 0;
        for (const tok of tokens) {
            while (si < tagSpans.length && tagSpans[si][1] <= tok.start) si++;
            if (si < tagSpans.length && tagSpans[si][0] <= tok.start && tok.end <= tagSpans[si][1]) {
                out.push({ ...tok, known: true });
                continue;
            }
            if (this.isKnown(tok.word, extraWords) || !tok.word.includes('-')) {
                out.push({ ...tok, known: this.isKnown(tok.word, extraWords) });
                continue;
            }
            const re = /[^-]+/g;
            let m;
            while ((m = re.exec(tok.word)) !== null) {
                const part = m[0];
                if (part.length < 2) continue;
                const start = tok.start + m.index;
                out.push({ word: part, start, end: start + part.length, known: this.isKnown(part, extraWords) });
            }
        }
        return out;
    }

    /**
     * Ranked corrections for a misspelled word, matching the input's capitalisation.
     * @returns {string[]}
     */
    suggest(word, limit = MAX_SUGGESTIONS) {
        const k = foldWord(word);
        if (!k || k.length > MAX_WORD_LENGTH || !WORD_KEY_RE.test(k)) return [];
        let ranked = this.suggestCache.get(k);
        if (ranked) {
            // Refresh LRU position.
            this.suggestCache.delete(k);
            this.suggestCache.set(k, ranked);
        } else {
            ranked = this._rank(k);
            this.suggestCache.set(k, ranked);
            if (this.suggestCache.size > SUGGEST_CACHE_LIMIT) {
                this.suggestCache.delete(this.suggestCache.keys().next().value);
            }
        }
        return ranked.slice(0, limit).map((s) => matchCase(word, s));
    }

    _rank(k) {
        const trie = this.ensureTrie();
        const maxCost = k.length <= 3 ? 1 : (k.length <= 5 ? 1.5 : 2);
        const scored = new Map();
        for (const { word, cost } of trie.search(k, maxCost)) {
            if (word === k) continue;
            let c = cost;
            if (word[0] !== k[0]) c += FIRST_LETTER_PENALTY;
            const score = c * DIST_WEIGHT - Math.log(this.frequency(word));
            const prev = scored.get(word);
            if (prev === undefined || score < prev) scored.set(word, score);
        }
        // Run-together words: "blondehair" -> "blonde hair".
        if (k.length >= 5) {
            for (let i = 2; i <= k.length - 2; i++) {
                const left = k.slice(0, i);
                const right = k.slice(i);
                const floor = (w) => (w.length <= 3 ? SPLIT_MIN_FREQ_SHORT : SPLIT_MIN_FREQ);
                if (this.frequency(left) < floor(left) || this.frequency(right) < floor(right)) continue;
                if (this.nameOnlyWords.has(left) || this.nameOnlyWords.has(right)) continue;
                if ((left.length < 3 && !SPLIT_SHORT_WORDS.has(left)) || (right.length < 3 && !SPLIT_SHORT_WORDS.has(right))) continue;
                const f = Math.min(this.frequency(left), this.frequency(right));
                const score = DIST_WEIGHT - Math.log(f);
                scored.set(left + ' ' + right, score);
            }
        }
        const contraction = CONTRACTION_BY_BARE.get(k);
        if (contraction) scored.set(contraction, -Infinity);
        return Array.from(scored.entries())
            .sort((a, b) => a[1] - b[1])
            .slice(0, MAX_SUGGESTIONS * 2)
            .map(([w]) => w);
    }

    stats() {
        return {
            words: this.freq.size,
            dictionaryWords: this.dictionaryWordCount,
            tagWords: this.tagWordCount,
            tagPhrases: this.tagPhrases.size,
            trieNodes: this.trie ? this.trie.size : 0
        };
    }
}

/** Words of a tag title: decode %27, drop `species:`-style prefixes, split on spaces. */
function tagTitleWords(title) {
    let t = String(title);
    if (t.includes('%')) {
        try { t = decodeURIComponent(t); } catch (_) { t = t.replace(/%27/g, "'"); }
    }
    t = t.replace(/^[a-z]+:(?=\S)/i, '');
    const out = [];
    const re = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;
    let m;
    while ((m = re.exec(t)) !== null) {
        const raw = m[0];
        const before = t[m.index - 1];
        const after = t[m.index + raw.length];
        if ((before && /[\d_]/.test(before)) || (after && /[\d_]/.test(after))) continue;
        const k = foldWord(raw);
        if (k.length < 2 || !WORD_KEY_RE.test(k)) continue;
        out.push(k);
        if (k.includes('-')) {
            for (const part of k.split('-')) if (part.length >= 2) out.push(part);
        }
    }
    return out;
}

/** Whole-phrase key for tag matching: decoded, folded, underscores as spaces, single-spaced. */
function normalizeTagPhrase(text) {
    let t = String(text || '');
    if (t.includes('%')) {
        try { t = decodeURIComponent(t); } catch (_) { t = t.replace(/%27/g, "'"); }
    }
    return foldWord(t).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchCase(original, suggestion) {
    if (!original) return suggestion;
    const letters = original.replace(/[^\p{L}]/gu, '');
    if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
        return suggestion.toUpperCase();
    }
    const first = original[0];
    if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
        return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
    }
    return suggestion;
}

const CHUNK_SPLIT_RE = /::|[,\n|{}\[\]]/g;
const INVISIBLE_RE = /[\u200B-\u200D\u2060-\u2064\uFEFF]/g;

/** [start, end) spans of chunks that are exactly a known tag title. */
function findTagPhraseSpans(text, phrases) {
    const spans = [];
    let last = 0;
    const consider = (start, end) => {
        const raw = text.slice(start, end);
        if (!raw.includes(' ') && !raw.includes('_')) return;
        const key = normalizeTagPhrase(raw.replace(INVISIBLE_RE, ''));
        if (key && phrases.has(key)) spans.push([start, end]);
    };
    CHUNK_SPLIT_RE.lastIndex = 0;
    let m;
    while ((m = CHUNK_SPLIT_RE.exec(text)) !== null) {
        consider(last, m.index);
        last = m.index + m[0].length;
    }
    consider(last, text.length);
    return spans;
}

// --- Prompt tokenizer ---------------------------------------------------------------------

const WORD_RE = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;
const LATIN_RE = /\p{Script=Latin}/u;

/**
 * Character ranges of a prompt that are not prose: `artist:` names, `<expander>` references,
 * `!name` replacements, URLs. Returns sorted [start, end) pairs.
 */
function findSkipRanges(text) {
    const ranges = [];
    let m;
    const artistRe = /artist\s*:/gi;
    while ((m = artistRe.exec(text)) !== null) {
        const start = m.index;
        let end = m.index + m[0].length;
        while (end < text.length) {
            const ch = text[end];
            if (ch === ',' || ch === '\n' || ch === '|' || ch === '{' || ch === '}' || ch === '[' || ch === ']') break;
            if (ch === ':' && text[end + 1] === ':') break;
            end++;
        }
        ranges.push([start, end]);
    }
    const patterns = [
        /<[^<>\n]*>?/g,                 // <expander> (open while typing)
        /(^|[\s,{[(|])!\S+/g,           // !replacement
        /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, // URLs
        /\bwww\.\S+/gi
    ];
    for (const re of patterns) {
        while ((m = re.exec(text)) !== null) {
            const lead = m[1] ? m[1].length : 0;
            ranges.push([m.index + lead, m.index + m[0].length]);
            if (m[0].length === 0) re.lastIndex++;
        }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    return ranges;
}

/**
 * Words worth spell checking in a prompt, with positions.
 * Skips tokens glued to digits or underscores (1girl, dg_keys), non-Latin script,
 * single letters, short all-caps acronyms, and the skip ranges above.
 * Hyphenated words come back whole; the caller splits them when the whole is unknown.
 * @returns {Array<{word: string, start: number, end: number}>}
 */
function tokenizePrompt(text) {
    if (!text || typeof text !== 'string') return [];
    const skips = findSkipRanges(text);
    const out = [];
    let si = 0;
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text)) !== null) {
        const word = m[0];
        const start = m.index;
        const end = start + word.length;
        while (si < skips.length && skips[si][1] <= start) si++;
        let skipped = false;
        for (let i = si; i < skips.length && skips[i][0] < end; i++) {
            if (skips[i][1] > start) { skipped = true; break; }
        }
        if (skipped) continue;
        const before = text[start - 1];
        const after = text[end];
        if ((before && /[\d_]/.test(before)) || (after && /[\d_]/.test(after))) continue;
        if (word.length < 2 || !LATIN_RE.test(word)) continue;
        const letters = word.replace(/[^\p{L}]/gu, '');
        if (letters.length <= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) continue;
        out.push({ word, start, end });
    }
    return out;
}

module.exports = {
    SpellEngine,
    WordTrie,
    foldWord,
    tagTitleWords,
    normalizeTagPhrase,
    tokenizePrompt,
    findSkipRanges,
    matchCase,
    TAG_CATEGORY_ARTIST
};
