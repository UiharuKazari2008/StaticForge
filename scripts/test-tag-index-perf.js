const assert = require('assert');

// Simulate the old method
function buildOld(tagData) {
    const searchIndex = {};
    const wordIndex = {};
    const prefixIndex = {};
    const suffixIndex = {};
    const wordsIndex = {};

    Object.keys(tagData).forEach(tagName => {
        const tagInfo = tagData[tagName];
        const words = tagName.toLowerCase().split(/\s+/).filter(word => word.length > 0);

        words.forEach(word => {
            if (!wordIndex[word] || !Array.isArray(wordIndex[word])) {
                wordIndex[word] = [];
            }
            if (!wordIndex[word].includes(tagName)) {
                wordIndex[word].push(tagName);
            }

            for (let i = 1; i <= word.length; i++) {
                const prefix = word.substring(0, i);
                if (!prefixIndex[prefix] || !Array.isArray(prefixIndex[prefix])) {
                    prefixIndex[prefix] = [];
                }
                if (!prefixIndex[prefix].includes(tagName)) {
                    prefixIndex[prefix].push(tagName);
                }
            }

            for (let i = 1; i <= word.length; i++) {
                const suffix = word.substring(word.length - i);
                if (!suffixIndex[suffix] || !Array.isArray(suffixIndex[suffix])) {
                    suffixIndex[suffix] = [];
                }
                if (!suffixIndex[suffix].includes(tagName)) {
                    suffixIndex[suffix].push(tagName);
                }
            }
        });

        if (tagInfo.words && Array.isArray(tagInfo.words)) {
            tagInfo.words.forEach(word => {
                const wordLower = word.toLowerCase();
                if (!wordsIndex[wordLower] || !Array.isArray(wordsIndex[wordLower])) {
                    wordsIndex[wordLower] = [];
                }
                if (!wordsIndex[wordLower].includes(tagName)) {
                    wordsIndex[wordLower].push(tagName);
                }
            });
        }

        const fullTagName = tagName.toLowerCase();
        if (!searchIndex[fullTagName]) {
            searchIndex[fullTagName] = [];
        }
        if (!searchIndex[fullTagName].includes(tagName)) {
            searchIndex[fullTagName].push(tagName);
        }
    });
    return { searchIndex, wordIndex, prefixIndex, suffixIndex, wordsIndex };
}

// Simulate the new method
function buildNew(tagData) {
    const searchIndex = {};
    const wordIndex = {};
    const prefixIndex = {};
    const suffixIndex = {};
    const wordsIndex = {};

    Object.keys(tagData).forEach(tagName => {
        const tagInfo = tagData[tagName];
        const words = tagName.toLowerCase().split(/\s+/).filter(word => word.length > 0);

        // JULES: perf sweep - O(N^2) to O(N) deduplication - per-tag uniqueness
        const seenWords = new Set();
        const seenPrefixes = new Set();
        const seenSuffixes = new Set();

        words.forEach(word => {
            if (!seenWords.has(word)) {
                seenWords.add(word);
                if (!wordIndex[word] || !Array.isArray(wordIndex[word])) {
                    wordIndex[word] = [];
                }
                wordIndex[word].push(tagName);
            }

            for (let i = 1; i <= word.length; i++) {
                const prefix = word.substring(0, i);
                if (!seenPrefixes.has(prefix)) {
                    seenPrefixes.add(prefix);
                    if (!prefixIndex[prefix] || !Array.isArray(prefixIndex[prefix])) {
                        prefixIndex[prefix] = [];
                    }
                    prefixIndex[prefix].push(tagName);
                }
            }

            for (let i = 1; i <= word.length; i++) {
                const suffix = word.substring(word.length - i);
                if (!seenSuffixes.has(suffix)) {
                    seenSuffixes.add(suffix);
                    if (!suffixIndex[suffix] || !Array.isArray(suffixIndex[suffix])) {
                        suffixIndex[suffix] = [];
                    }
                    suffixIndex[suffix].push(tagName);
                }
            }
        });

        if (tagInfo.words && Array.isArray(tagInfo.words)) {
            const seenTagWords = new Set();
            tagInfo.words.forEach(word => {
                const wordLower = word.toLowerCase();
                if (!seenTagWords.has(wordLower)) {
                    seenTagWords.add(wordLower);
                    if (!wordsIndex[wordLower] || !Array.isArray(wordsIndex[wordLower])) {
                        wordsIndex[wordLower] = [];
                    }
                    wordsIndex[wordLower].push(tagName);
                }
            });
        }

        const fullTagName = tagName.toLowerCase();
        if (!searchIndex[fullTagName]) {
            searchIndex[fullTagName] = [];
        }
        searchIndex[fullTagName].push(tagName);
    });
    return { searchIndex, wordIndex, prefixIndex, suffixIndex, wordsIndex };
}

// Test with mock data
const mockData = {
    "test tag": { words: ["test", "tag", "extra"] },
    "another tag": { words: ["another", "tag", "duplicate", "duplicate"] },
    "Test Tag": { words: ["test"] },
    "duplicate word word": { words: ["hello", "world"] },
    "aaa": { words: [] }
};

const oldResult = buildOld(mockData);
const newResult = buildNew(mockData);

try {
    assert.deepStrictEqual(oldResult, newResult);
    console.log("✅ Results match exactly!");
} catch (e) {
    console.error("❌ Results do not match!");
    console.error(e);
}
