const natural = require('natural');
const moby = require('moby');
const { isTextColonPrefix } = require('./promptTextBoundary');

const MAX_DEFINITIONS = 5;
const MAX_SYNONYMS = 20;

const POS_LABELS = {
    n: 'noun',
    v: 'verb',
    a: 'adj',
    s: 'adj',
    r: 'adv'
};

// Prepositions, articles, conjunctions — aligned with tag-lookup.js extractKeywords
const FILLER_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'from', 'by', 'as', 'is', 'are', 'was', 'were', 'into', 'onto', 'upon', 'via', 'per'
]);

const MAX_LOOKUP_WORDS = 2;

class WordLookupService {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('WordLookupService requires globalResources and should only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        this.wordnet = null;
        this.cache = new Map();
    }

    getWordNet() {
        if (!this.wordnet) {
            this.wordnet = new natural.WordNet();
        }
        return this.wordnet;
    }

    getSpellChecker() {
        try {
            return this.globalResources.getSpellChecker();
        } catch (_) {
            return null;
        }
    }

    isFillerWord(word) {
        return FILLER_WORDS.has(String(word || '').toLowerCase());
    }

    extractTrailingLookupWords(tokens) {
        const words = [];
        for (let i = tokens.length - 1; i >= 0 && words.length < MAX_LOOKUP_WORDS; i--) {
            if (!this.isFillerWord(tokens[i])) {
                words.unshift(tokens[i]);
            }
        }
        return words;
    }

    parseWordLookupQuery(query) {
        if (!query || typeof query !== 'string') {
            return null;
        }

        const trimmed = query.trim();
        if (!trimmed || trimmed.startsWith('!') || isTextColonPrefix(trimmed)) {
            return null;
        }

        const tokens = trimmed.match(/\b[a-zA-Z]+\b/g);
        if (!tokens || tokens.length === 0) {
            return null;
        }

        const words = this.extractTrailingLookupWords(tokens);
        if (words.length === 0) {
            return null;
        }

        const lastWord = words[words.length - 1];
        if (!trimmed.endsWith(lastWord)) {
            return null;
        }

        if (words.length > 1 && (trimmed.includes('-') || trimmed.includes('_'))) {
            return null;
        }

        return { words };
    }

    wordNetLookup(word) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (results) => {
                if (settled) return;
                settled = true;
                resolve(Array.isArray(results) ? results : []);
            };

            const timeout = setTimeout(() => {
                console.warn(`WordNet lookup timed out for "${word}"`);
                finish([]);
            }, 3000);

            try {
                this.getWordNet().lookup(word.toLowerCase(), (results) => {
                    clearTimeout(timeout);
                    finish(results);
                });
            } catch (error) {
                clearTimeout(timeout);
                console.error(`WordNet lookup failed for "${word}":`, error);
                finish([]);
            }
        });
    }

    getMobySynonyms(word) {
        try {
            return moby.search(word.toLowerCase()) || [];
        } catch (error) {
            console.error(`Moby lookup failed for "${word}":`, error);
            return [];
        }
    }

    isSpellValidPhrase(phrase) {
        const spellChecker = this.getSpellChecker();
        if (!spellChecker || typeof spellChecker.isCorrect !== 'function') {
            return true;
        }

        const parts = phrase.split(/\s+/);
        for (const part of parts) {
            if (!spellChecker.isCorrect(part)) {
                return false;
            }
        }
        return true;
    }

    normalizeSynonym(synonym) {
        return String(synonym || '')
            .replace(/_/g, ' ')
            .trim()
            .toLowerCase();
    }

    formatPos(pos) {
        return POS_LABELS[pos] || pos || '';
    }

    buildDefinitions(records) {
        const seen = new Set();
        const definitions = [];

        for (const record of records) {
            const gloss = record.gloss ? String(record.gloss).trim() : '';
            if (!gloss) continue;

            const pos = this.formatPos(record.pos);
            const key = `${pos}:${gloss.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            definitions.push({ pos, gloss });
            if (definitions.length >= MAX_DEFINITIONS) {
                break;
            }
        }

        return definitions;
    }

    collectWordNetSynonyms(records, word) {
        const wordLower = word.toLowerCase();
        const synonyms = [];
        const seen = new Set([wordLower]);

        for (const record of records) {
            const candidates = Array.isArray(record.synonyms) ? record.synonyms : [];
            for (const candidate of candidates) {
                const normalized = this.normalizeSynonym(candidate);
                if (!normalized || seen.has(normalized)) continue;
                if (normalized.split(/\s+/).length > 2) continue;
                if (!this.isSpellValidPhrase(normalized)) continue;

                seen.add(normalized);
                synonyms.push(normalized);
            }
        }

        return synonyms;
    }

    collectMobySynonyms(rawSynonyms, word, seen) {
        const wordLower = word.toLowerCase();
        const synonyms = [];

        for (const syn of rawSynonyms) {
            const normalized = this.normalizeSynonym(syn);
            if (!normalized || normalized === wordLower || seen.has(normalized)) continue;
            if (normalized.split(/\s+/).length > 2) continue;
            if (!this.isSpellValidPhrase(normalized)) continue;

            seen.add(normalized);
            synonyms.push(normalized);
        }

        return synonyms;
    }

    getSynonymStrength(synonym) {
        try {
            const t5Tokenizer = this.globalResources.getT5Tokenizer();
            const tokenData = t5Tokenizer.getTokenData(synonym);
            if (!tokenData || tokenData.length === 0) {
                return 0;
            }
            return Math.max(...tokenData.map(token => token.strength || 0));
        } catch (_) {
            return 0;
        }
    }

    scoreSynonymEntry(entry, lookupWord) {
        const synonym = entry.synonym;
        let score = 0;

        if (entry.source === 'wordnet') {
            score += 1000 - (entry.sourceIndex * 10);
        } else {
            score += 500 - (entry.sourceIndex * 5);
        }

        const strength = this.getSynonymStrength(synonym);
        score += strength * 10;
        if (strength > 0) {
            score += 50;
        }

        const wordCount = synonym.split(/\s+/).length;
        if (wordCount === 1) {
            score += 30;
        } else if (wordCount === 2) {
            score += 10;
        }

        score -= synonym.length * 0.5;

        const lookupLower = String(lookupWord || '').toLowerCase();
        if (synonym === lookupLower) {
            score -= 1000;
        }

        return score;
    }

    rankSynonyms(wordNetSynonyms, mobySynonyms, lookupWord) {
        const entries = [
            ...wordNetSynonyms.map((synonym, sourceIndex) => ({
                synonym,
                source: 'wordnet',
                sourceIndex
            })),
            ...mobySynonyms.map((synonym, sourceIndex) => ({
                synonym,
                source: 'moby',
                sourceIndex
            }))
        ];

        entries.sort((a, b) => {
            const scoreDiff = this.scoreSynonymEntry(b, lookupWord) - this.scoreSynonymEntry(a, lookupWord);
            if (scoreDiff !== 0) {
                return scoreDiff;
            }
            return a.synonym.localeCompare(b.synonym);
        });

        return entries.map(entry => entry.synonym).slice(0, MAX_SYNONYMS);
    }

    resolveLookupWord(word, spellCheckData) {
        if (!spellCheckData || !Array.isArray(spellCheckData.misspelled)) {
            return word;
        }

        const lower = word.toLowerCase();
        for (const misspelled of spellCheckData.misspelled) {
            if (misspelled.toLowerCase() !== lower) continue;
            const suggestions = spellCheckData.suggestions?.[misspelled] || [];
            if (suggestions.length > 0) {
                return suggestions[0];
            }
        }

        return word;
    }

    async lookupWord(word, displayWord = null) {
        const lookupKey = word.toLowerCase();
        const display = displayWord || word;
        if (this.cache.has(lookupKey)) {
            const cached = this.cache.get(lookupKey);
            return { ...cached, word: display };
        }

        const records = await this.wordNetLookup(word);
        const definitions = this.buildDefinitions(records);
        const wordNetSynonyms = this.collectWordNetSynonyms(records, word);

        const seen = new Set([lookupKey, ...wordNetSynonyms]);
        const mobySynonyms = this.collectMobySynonyms(this.getMobySynonyms(word), word, seen);

        const synonyms = this.rankSynonyms(wordNetSynonyms, mobySynonyms, word);
        const result = {
            word: display,
            lookupWord: word,
            definitions,
            synonyms,
            hasData: definitions.length > 0 || synonyms.length > 0
        };

        this.cache.set(lookupKey, {
            word: display,
            lookupWord: word,
            definitions,
            synonyms,
            hasData: result.hasData
        });
        return result;
    }

    async lookupQuery(query, spellCheckData = null) {
        const parsed = this.parseWordLookupQuery(query);
        if (!parsed) {
            return null;
        }

        const words = await Promise.all(parsed.words.map((token) => {
            const lookupWord = this.resolveLookupWord(token, spellCheckData);
            return this.lookupWord(lookupWord, token);
        }));

        // Trailing lookup words are collected oldest-first; reverse so the word being typed appears first.
        const orderedWords = [...words].reverse();
        const hasData = orderedWords.some((entry) => entry.hasData);

        return {
            query: query.trim(),
            words: orderedWords,
            hasData
        };
    }
}

module.exports = WordLookupService;
