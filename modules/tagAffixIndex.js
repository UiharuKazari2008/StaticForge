/**
 * Tag Affix Index
 * Prefix and suffix lookups for animeTagSearch / furryTagSearch, derived from the
 * word index on demand instead of read from the *_prefix_index / *_suffix_index
 * JSON files. Those maps cost 3.7s of synchronous parse at boot and 523MB of heap
 * (2026-10-20) for exact-key lookups only.
 *
 * index[key] is what the built map held: the tags (in tagData key order, each
 * once) that have a word starting (prefix) or ending (suffix) with key, or
 * undefined when no word does. Words are the wordIndex keys, which come from
 * the same per-tag word split the maps were built from.
 */

const CACHE_LIMIT = 500;

function lowerBound(sorted, needle) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < needle) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// Code-unit reversal, matching the maps' word.substring() suffixes.
function reverseUnits(text) {
    return text.split('').reverse().join('');
}

/**
 * @param {Object<string, string[]>} wordIndex
 * @param {Object<string, object>} tagData
 * @param {'prefix'|'suffix'} kind
 * @returns {Object<string, string[]>} read-only lookup object
 */
function createAffixIndex(wordIndex, tagData, kind) {
    const reversed = kind === 'suffix';
    const words = Object.keys(wordIndex).filter((word) => Array.isArray(wordIndex[word]));
    // [match key, word] sorted by match key (the word, or the word reversed for suffixes).
    const keyed = words.map((word) => [reversed ? reverseUnits(word) : word, word]);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const sortedKeys = keyed.map((row) => row[0]);
    let rank = null;
    const cache = new Map();

    function tagRank() {
        if (!rank) {
            rank = new Map();
            Object.keys(tagData).forEach((tagName, at) => rank.set(tagName, at));
        }
        return rank;
    }

    function lookup(key) {
        const needle = reversed ? reverseUnits(key) : key;
        const lists = [];
        for (let i = lowerBound(sortedKeys, needle); i < sortedKeys.length && sortedKeys[i].startsWith(needle); i++) {
            lists.push(wordIndex[keyed[i][1]]);
        }
        if (!lists.length) return undefined;
        if (lists.length === 1) return lists[0].slice();
        const tags = new Set();
        lists.forEach((list) => list.forEach((tagName) => tags.add(tagName)));
        const order = tagRank();
        return Array.from(tags).sort((a, b) => order.get(a) - order.get(b));
    }

    return new Proxy(Object.create(null), {
        get(_target, key) {
            if (typeof key !== 'string' || !key) return undefined;
            if (cache.has(key)) return cache.get(key);
            const found = lookup(key);
            if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
            cache.set(key, found);
            return found;
        },
        set() {
            return false;
        }
    });
}

module.exports = { createAffixIndex };
