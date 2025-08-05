const spellchecker = require('spellchecker');
const fs = require('fs');
const path = require('path');

class SpellChecker {
    constructor() {
        this.customWords = new Set();
        this.loadCustomWords();
    }

    loadCustomWords() {
        try {
            const customWordsPath = path.join(__dirname, '/../.cache/customWords.json');
            if (fs.existsSync(customWordsPath)) {
                const data = fs.readFileSync(customWordsPath, 'utf8');
                const customWordsData = JSON.parse(data);
                this.customWords = new Set(customWordsData.words || []);
                console.log(`📚 Loaded ${this.customWords.size} custom words for spell checking`);
            }
        } catch (error) {
            console.warn('⚠️ Could not load customWords.json:', error.message);
        }
    }

    reloadCustomWords() {
        this.loadCustomWords();
    }

    isCorrect(word) {
        // Check if it's a custom word first
        if (this.customWords.has(word.toLowerCase())) {
            return true;
        }
        
        // Check with spellchecker
        return !spellchecker.isMisspelled(word);
    }

    getSuggestions(word) {
        // Don't suggest for custom words
        if (this.customWords.has(word.toLowerCase())) {
            return [];
        }
        
        // Get suggestions from spellchecker
        return spellchecker.getCorrectionsForMisspelling(word);
    }

    checkText(text) {
        if (!text || typeof text !== 'string') {
            return { misspelled: [], suggestions: {}, originalText: text };
        }

        // Split text into words, preserving punctuation and spacing
        const words = text.match(/\b\w+\b/g) || [];
        const misspelled = [];
        const suggestions = {};
        const wordPositions = [];

        // Find positions of each word in the original text
        let currentPos = 0;
        for (const word of words) {
            const wordIndex = text.indexOf(word, currentPos);
            if (wordIndex !== -1) {
                wordPositions.push({
                    word: word,
                    start: wordIndex,
                    end: wordIndex + word.length
                });
                currentPos = wordIndex + word.length;
            }
        }

        for (const word of words) {
            if (!this.isCorrect(word)) {
                misspelled.push(word);
                suggestions[word] = this.getSuggestions(word);
            }
        }

        return { 
            misspelled, 
            suggestions, 
            originalText: text,
            wordPositions: wordPositions,
            hasErrors: misspelled.length > 0
        };
    }

    addCustomWord(word) {
        if (!word || typeof word !== 'string') {
            return false;
        }

        const normalizedWord = word.toLowerCase().trim();
        if (normalizedWord) {
            this.customWords.add(normalizedWord);
            this.saveCustomWords();
            return true;
        }
        return false;
    }

    saveCustomWords() {
        try {
            const cacheDir = path.join(__dirname, '/../.cache');
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            const customWordsPath = path.join(__dirname, '/../.cache/customWords.json');
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