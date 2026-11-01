// Prompt spell checker (#689). Pure JS engine in ./spellEngine.js: SCOWL word lists plus
// words from non-artist Danbooru/e621 tags, prompt-aware tokens (artist: names, <expanders>,
// !replacements, 1girl-style tokens are skipped). Replaced the native hunspell addon, whose 2007
// dictionary flagged anime/selfie/emoji and whose suggestions blocked the event loop ~47 ms a word.
const fs = require('fs');
const logger = require('./logger');
const { SpellEngine, foldWord } = require('./spellEngine');

// Tag words load once the tag wiki database is open (it opens after this step at boot).
const TAG_VOCAB_POLL_MS = 5000;
const TAG_VOCAB_POLL_LIMIT = 120;
const TAG_VOCAB_REFRESH_MS = 24 * 60 * 60 * 1000;
const TAG_VOCAB_MIN_COUNT = 20;

class SpellChecker {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('SpellChecker requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        this.customWords = new Set();
        this.engine = new SpellEngine();
        this.engineReady = false;
        this.tagVocabularyLoaded = false;
        this.tagVocabularyLoading = null;
        try {
            const count = this.engine.loadScowl();
            this.engine.ensureTrie();
            this.engineReady = true;
            logger.bootSubStep(`Loaded ${count} dictionary words for spell checking`);
        } catch (error) {
            console.warn(`⚠️ Spell checking is off: the word lists did not load (${String(error.message).split('\n')[0]})`);
        }
        this.loadCustomWords();
        this.scheduleTagVocabulary();
    }

    loadCustomWords() {
        try {
            const customWordsPath = this.globalResources.getPath('customWords');
            if (fs.existsSync(customWordsPath)) {
                const data = fs.readFileSync(customWordsPath, 'utf8');
                const customWordsData = JSON.parse(data);
                this.customWords = new Set((customWordsData.words || []).map(foldWord).filter(Boolean));
                logger.bootSubStep(`Loaded ${this.customWords.size} custom words for spell checking`);
            }
        } catch (error) {
            logger.warn('Could not load customWords.json:', error.message);
        }
    }

    reloadCustomWords() {
        this.loadCustomWords();
    }

    scheduleTagVocabulary(attempt = 0) {
        const timer = setTimeout(() => {
            const db = this.globalResources.tagDatabase && this.globalResources.tagDatabase.db;
            if (!db) {
                if (attempt < TAG_VOCAB_POLL_LIMIT) this.scheduleTagVocabulary(attempt + 1);
                return;
            }
            this.loadTagVocabulary().finally(() => {
                const refresh = setTimeout(() => this.scheduleTagVocabulary(0), TAG_VOCAB_REFRESH_MS);
                if (refresh.unref) refresh.unref();
            });
        }, TAG_VOCAB_POLL_MS);
        if (timer.unref) timer.unref();
    }

    /** Read non-artist tags from tag_wiki.db into the engine. Safe to call again to refresh. */
    async loadTagVocabulary() {
        if (this.tagVocabularyLoading) return this.tagVocabularyLoading;
        const db = this.globalResources.tagDatabase && this.globalResources.tagDatabase.db;
        if (!db || !this.engineReady) return false;
        this.tagVocabularyLoading = (async () => {
            try {
                const started = Date.now();
                const rows = await db.all(
                    `SELECT title, category, COALESCE(d_count, 0) + COALESCE(e_count, 0) AS count
                     FROM tags
                     WHERE (category IS NULL OR category != 1)
                       AND COALESCE(d_count, 0) + COALESCE(e_count, 0) >= ?`,
                    [TAG_VOCAB_MIN_COUNT]
                );
                const added = this.engine.addTagVocabulary(rows);
                this.engine.ensureTrie();
                // Sound-alike index (#693, ~1 s): build here, not on someone's first keystroke.
                this.engine.ensureSoundIndex();
                this.tagVocabularyLoaded = true;
                const stats = this.engine.stats();
                console.log(`✓ Spell checker tag vocabulary: ${added} tag words, ${stats.tagPhrases} tag phrases, ${stats.soundKeys} sound keys from ${rows.length} tags (${Date.now() - started} ms)`);
                return true;
            } catch (error) {
                console.warn('⚠️ Spell checker could not load tag vocabulary:', error.message);
                return false;
            } finally {
                this.tagVocabularyLoading = null;
            }
        })();
        return this.tagVocabularyLoading;
    }

    isCorrect(word) {
        if (!this.engineReady) return true;
        return this.engine.isKnown(word, this.customWords);
    }

    getSuggestions(word) {
        if (!this.engineReady || this.isCorrect(word)) return [];
        return this.engine.suggest(word);
    }

    /** Drop suggestions identical to the typed word (case-insensitive) — not actionable corrections. */
    filterActionableSuggestions(word, suggestions) {
        if (!Array.isArray(suggestions)) return [];
        const wordLower = String(word).toLowerCase();
        const seen = new Set();
        const out = [];
        for (const suggestion of suggestions) {
            if (suggestion == null) continue;
            const key = String(suggestion).toLowerCase();
            if (key === wordLower || seen.has(key)) continue;
            seen.add(key);
            out.push(suggestion);
        }
        return out;
    }

    /**
     * misspelled lists each flagged occurrence in order (the client maps rows to occurrences);
     * a word with no actionable suggestion is not reported. wordPositions covers every checked word.
     * options.soundAlike (default true) adds sound-alike suggestions (SmartText setting, #693).
     */
    checkText(text, options = null) {
        if (!text || typeof text !== 'string') {
            return { misspelled: [], suggestions: {}, originalText: text };
        }
        const checked = this.engineReady ? this.engine.checkPrompt(text, this.customWords) : [];
        const suggestOptions = { soundAlike: !options || options.soundAlike !== false };
        const misspelled = [];
        const byWord = new Map();
        const wordPositions = [];
        for (const token of checked) {
            wordPositions.push({ word: token.word, start: token.start, end: token.end });
            if (token.known) continue;
            if (!byWord.has(token.word)) {
                byWord.set(token.word, this.filterActionableSuggestions(token.word, this.engine.suggest(token.word, undefined, suggestOptions)));
            }
            if (byWord.get(token.word).length === 0) continue;
            misspelled.push(token.word);
        }
        const suggestions = {};
        for (const [word, list] of byWord) {
            if (list.length > 0) suggestions[word] = list;
        }
        return {
            misspelled,
            suggestions,
            originalText: text,
            wordPositions,
            hasErrors: misspelled.length > 0
        };
    }

    addCustomWord(word) {
        if (!word || typeof word !== 'string') {
            return false;
        }

        const normalizedWord = foldWord(word.trim());
        if (normalizedWord) {
            this.customWords.add(normalizedWord);
            this.saveCustomWords();
            return true;
        }
        return false;
    }

    removeCustomWord(word) {
        const normalizedWord = foldWord(String(word || '').trim());
        if (!normalizedWord || !this.customWords.delete(normalizedWord)) return false;
        this.saveCustomWords();
        return true;
    }

    getStats() {
        return {
            ready: this.engineReady,
            tagVocabularyLoaded: this.tagVocabularyLoaded,
            customWords: this.customWords.size,
            ...this.engine.stats()
        };
    }

    saveCustomWords() {
        try {
            const cacheDir = this.globalResources.getPath('cache');
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            const customWordsPath = this.globalResources.getPath('customWords');
            const data = {
                words: Array.from(this.customWords).sort(),
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(customWordsPath, JSON.stringify(data, null, 2));
            console.log(`💾 Saved ${this.customWords.size} custom words`);
        } catch (error) {
            console.error('❌ Could not save customWords.json:', error.message);
        }
    }
}

module.exports = SpellChecker;
