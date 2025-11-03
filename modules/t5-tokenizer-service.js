// t5-tokenizer-service.js
// Server-side T5 Tokenizer Service
const T5Tokenizer = require('./t5-tokenizer-standalone.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class T5TokenizerService {
    constructor() {
        this.tokenizer = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return true;

        try {
            this.tokenizer = new T5Tokenizer();
            
            // Load config from public/protected
            const configPath = path.join(__dirname, '../public/protected/t5_tokenizer.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            
            await this.tokenizer.loadFromJSON(config);
            this.initialized = true;
            
            logger.bootSubStep('T5 Tokenizer initialized');
            return true;
        } catch (error) {
            logger.error('Failed to initialize T5 Tokenizer Service:', error);
            return false;
        }
    }

    countTokens(text) {
        this._ensureInitialized();
        return this.tokenizer.countTokens(text);
    }

    encode(text) {
        this._ensureInitialized();
        return this.tokenizer.encode(text);
    }

    decode(tokenIds, skipSpecial = true) {
        this._ensureInitialized();
        return this.tokenizer.decode(tokenIds, skipSpecial);
    }

    analyzeTexts(texts, includeDetailedTokens = false) {
        this._ensureInitialized();
        return this.tokenizer.analyzeTexts(texts, includeDetailedTokens);
    }

    /**
     * Get detailed token breakdown for a single text string
     * Used for tag breakdown analysis - returns array of token objects
     * @param {string} text - Text to tokenize
     * @returns {Array} Array of token objects with tokenId, text, strength, isValid, isSpecial
     */
    getTokenData(text) {
        this._ensureInitialized();
        
        // Use analyzeTexts with detailed mode to get token breakdown
        const analysis = this.tokenizer.analyzeTexts([text], true);
        
        if (analysis.results && analysis.results.length > 0 && analysis.results[0].detailedTokens) {
            return analysis.results[0].detailedTokens;
        }
        
        // Fallback: build manually if detailedTokens not available
        const tokenIds = this.tokenizer.encode(text);
        return tokenIds.map(id => this.tokenizer.getTokenDetails(id));
    }

    _ensureInitialized() {
        if (!this.initialized) {
            throw new Error('T5 Tokenizer not initialized. Call initialize() first.');
        }
    }
}

// Singleton instance
const t5TokenizerService = new T5TokenizerService();

module.exports = t5TokenizerService;

