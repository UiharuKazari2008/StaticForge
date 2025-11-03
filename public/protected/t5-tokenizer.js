/**
 * T5 Tokenizer - Standalone Implementation
 * Works in both browser and Node.js environments
 * 
 * @author Extracted from NovelAI
 * @license MIT
 */

(function(global, factory) {
    // UMD pattern for browser and Node.js compatibility
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        // Node.js
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD
        define([], factory);
    } else {
        // Browser globals
        global.T5Tokenizer = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    // ============================================================================
    // Utility: Detect environment and create compatible APIs
    // ============================================================================
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
    
    // Text encoder/decoder (works in both browser and Node.js)
    const TextEncoder = globalThis.TextEncoder || (isNode ? require('util').TextEncoder : null);
    const TextDecoder = globalThis.TextDecoder || (isNode ? require('util').TextDecoder : null);
    
    // Base64 decode function
    function base64Decode(base64) {
        if (isNode) {
            return Buffer.from(base64, 'base64').toString('utf8');
        } else {
            return atob(base64);
        }
    }
    
    // Decompression function (for .def files)
    async function decompressDEF(data) {
        if (isNode) {
            // Node.js: try to use fflate if available, otherwise throw error
            try {
                const fflate = require('fflate');
                return fflate.decompressSync(new Uint8Array(data));
            } catch (e) {
                throw new Error('fflate package required for .def file support in Node.js. Install with: npm install fflate');
            }
        } else {
            // Browser: use fflate from global or throw error
            if (typeof fflate !== 'undefined') {
                return fflate.decompressSync(new Uint8Array(data));
            } else {
                throw new Error('fflate library required for .def file support. Include: <script src="https://unpkg.com/fflate"></script>');
            }
        }
    }

    // ============================================================================
    // Trie for efficient prefix search
    // ============================================================================
    class TrieNode {
        constructor() {
            this.children = new Map();
            this.isLeaf = false;
        }
    }

    class Trie {
        constructor() {
            this.root = new TrieNode();
        }

        push(token) {
            let node = this.root;
            for (const char of token) {
                if (!node.children.has(char)) {
                    node.children.set(char, new TrieNode());
                }
                node = node.children.get(char);
            }
            node.isLeaf = true;
        }

        *commonPrefixSearch(text) {
            let node = this.root;
            let prefix = '';
            
            for (let i = 0; i < text.length && node; i++) {
                const char = text[i];
                prefix += char;
                node = node.children.get(char);
                
                if (node && node.isLeaf) {
                    yield prefix;
                }
            }
        }
    }

    // ============================================================================
    // Lattice Node for Viterbi algorithm
    // ============================================================================
    class LatticeNode {
        constructor(tokenId, nodeId, pos, length, score) {
            this.tokenId = tokenId;
            this.nodeId = nodeId;
            this.pos = pos;
            this.length = length;
            this.score = score;
            this.prev = null;
            this.backtraceScore = 0;
        }

        clone() {
            const node = new LatticeNode(this.tokenId, this.nodeId, this.pos, this.length, this.score);
            node.prev = this.prev;
            node.backtraceScore = this.backtraceScore;
            return node;
        }
    }

    // ============================================================================
    // Lattice for Viterbi decoding
    // ============================================================================
    class Lattice {
        constructor(sentence, bosTokenId, eosTokenId) {
            this.sentence = sentence;
            this.len = sentence.length;
            this.bosTokenId = bosTokenId;
            this.eosTokenId = eosTokenId;
            this.nodes = [];
            this.beginNodes = Array.from({ length: this.len + 1 }, () => []);
            this.endNodes = Array.from({ length: this.len + 1 }, () => []);
            
            const bosNode = new LatticeNode(bosTokenId, 0, 0, 0, 0);
            const eosNode = new LatticeNode(eosTokenId, 1, this.len, 0, 0);
            
            this.nodes.push(bosNode, eosNode);
            this.beginNodes[this.len].push(eosNode);
            this.endNodes[0].push(bosNode);
        }

        insert(pos, length, score, tokenId) {
            const node = new LatticeNode(tokenId, this.nodes.length, pos, length, score);
            this.beginNodes[pos].push(node);
            this.endNodes[pos + length].push(node);
            this.nodes.push(node);
        }

        viterbi() {
            const len = this.len;
            
            for (let pos = 0; pos <= len; pos++) {
                if (this.beginNodes[pos].length === 0) {
                    return [];
                }
                
                for (const node of this.beginNodes[pos]) {
                    node.prev = null;
                    let bestScore = 0;
                    let bestNode = null;
                    
                    for (const prevNode of this.endNodes[pos]) {
                        const score = prevNode.backtraceScore + node.score;
                        if (bestNode === null || score > bestScore) {
                            bestNode = prevNode.clone();
                            bestScore = score;
                        }
                    }
                    
                    if (bestNode === null) {
                        return [];
                    }
                    
                    node.prev = bestNode;
                    node.backtraceScore = bestScore;
                }
            }
            
            const result = [];
            let node = this.beginNodes[len][0].prev;
            
            if (node === null) {
                return [];
            }
            
            while (node.prev !== null) {
                result.push(node.clone());
                node = node.prev.clone();
            }
            
            return result.reverse();
        }

        tokenIds() {
            return this.viterbi().map(node => node.tokenId);
        }
    }

    // ============================================================================
    // Pre-tokenizers
    // ============================================================================
    class WhitespaceSplit {
        preTokenize(texts) {
            const result = [];
            for (const text of texts) {
                const parts = text.split(/\s+/);
                result.push(...parts.filter(p => p.length > 0));
            }
            return result;
        }
    }

    class Metaspace {
        constructor(replacement, addPrefixSpace) {
            this.replacement = replacement;
            this.addPrefixSpace = addPrefixSpace;
            this.strRep = replacement;
        }

        preTokenize(texts) {
            const result = [];
            for (const text of texts) {
                let processed = text.replace(/ /g, this.strRep);
                if (this.addPrefixSpace && !processed.startsWith(this.replacement)) {
                    processed = this.strRep + processed;
                }
                result.push(processed);
            }
            return result;
        }
    }

    class SequencePreTokenizer {
        constructor(pretokenizers) {
            this.pretokenizers = pretokenizers;
        }

        preTokenize(texts) {
            let result = texts;
            for (const pretokenizer of this.pretokenizers) {
                result = pretokenizer.preTokenize(result);
            }
            return result;
        }
    }

    // ============================================================================
    // Main T5 Tokenizer Class
    // ============================================================================
    class T5TokenizerCore {
        constructor(config) {
            this.vocab = config.model.vocab;
            this.unkTokenId = config.model.unk_id;
            this.specialTokens = config.added_tokens;
            this.bosTokenId = 0;
            this.eosTokenId = 1;
            
            // Build vocabulary map and trie
            this.vocabMap = new Map();
            this.trie = new Trie();
            this.minScore = Infinity;
            
            for (let i = 0; i < this.vocab.length; i++) {
                const [token, score] = this.vocab[i];
                this.vocabMap.set(token, { id: i, score });
                this.trie.push(token);
                this.minScore = Math.min(this.minScore, score);
            }
            
            this.unkScore = this.minScore - 10;
            
            // Set up pre-tokenizer
            const metaspace = new Metaspace('▁', true);
            const whitespace = new WhitespaceSplit();
            this.preTokenizer = new SequencePreTokenizer([whitespace, metaspace]);
        }

        getTokenId(token) {
            const entry = this.vocabMap.get(token);
            return entry ? entry.id : this.unkTokenId;
        }

        getScore(token) {
            const entry = this.vocabMap.get(token);
            return entry ? entry.score : this.unkScore;
        }

        getToken(tokenId) {
            if (tokenId >= 0 && tokenId < this.vocab.length) {
                return this.vocab[tokenId][0];
            }
            return '<unk>';
        }

        tokenize(text) {
            const lattice = new Lattice(text, this.bosTokenId, this.eosTokenId);
            
            for (let i = 0; i < text.length; i++) {
                const substring = text.slice(i);
                let foundAny = false;
                
                for (const token of this.trie.commonPrefixSearch(substring)) {
                    const tokenId = this.getTokenId(token);
                    const score = this.getScore(token);
                    const length = token.length;
                    
                    lattice.insert(i, length, score, tokenId);
                    
                    if (!foundAny && length === 1) {
                        foundAny = true;
                    }
                }
                
                if (!foundAny) {
                    lattice.insert(i, 1, this.unkScore, this.unkTokenId);
                }
            }
            
            return lattice.tokenIds();
        }

        encode(text) {
            if (!text || text.length === 0) {
                return [this.eosTokenId];
            }
            
            // Remove special characters (NovelAI behavior)
            text = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '');
            
            // Pre-tokenize
            const preTokenized = this.preTokenizer.preTokenize([text]);
            
            // Tokenize each pre-token
            const tokens = [];
            for (const preToken of preTokenized) {
                const tokenIds = this.tokenize(preToken);
                tokens.push(...tokenIds);
            }
            
            // Add EOS token
            tokens.push(this.eosTokenId);
            
            return tokens;
        }

        decode(tokenIds, skipSpecialTokens = false) {
            const tokens = tokenIds.map(id => {
                if (skipSpecialTokens) {
                    const specialToken = this.specialTokens.find(t => t.id === id);
                    if (specialToken) return '';
                }
                return this.getToken(id);
            });
            
            // Join and remove metaspace markers
            return tokens.join('').replace(/▁/g, ' ').trim();
        }
    }

    // ============================================================================
    // Public API
    // ============================================================================
    class T5Tokenizer {
        constructor() {
            this.tokenizer = null;
            this.loaded = false;
            this.specialTokens = [];
        }

        /**
         * Load tokenizer from JSON configuration
         * @param {Object|string} config - JSON object or JSON string
         */
        async loadFromJSON(config) {
            if (typeof config === 'string') {
                config = JSON.parse(config);
            }
            
            this.tokenizer = new T5TokenizerCore(config);
            this.specialTokens = config.added_tokens || [];
            this.loaded = true;
            return this;
        }

        /**
         * Load tokenizer from .def file (compressed format)
         * @param {ArrayBuffer|Uint8Array} defData - Compressed .def file data
         */
        async loadFromDEF(defData) {
            const decompressed = await decompressDEF(defData);
            const decoder = new TextDecoder('utf-8');
            const jsonText = decoder.decode(decompressed);
            const config = JSON.parse(jsonText);
            
            return this.loadFromJSON(config);
        }

        /**
         * Load tokenizer from URL
         * @param {string} url - URL to JSON or .def file
         */
        async loadFromURL(url) {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            
            if (url.endsWith('.def')) {
                return this.loadFromDEF(buffer);
            } else {
                const text = new TextDecoder('utf-8').decode(buffer);
                return this.loadFromJSON(text);
            }
        }

        _checkLoaded() {
            if (!this.loaded) {
                throw new Error('Tokenizer not loaded. Call loadFromJSON() or loadFromDEF() first.');
            }
        }

        /**
         * Encode text to token IDs
         * @param {string} text - Input text
         * @returns {number[]} Array of token IDs
         */
        encode(text) {
            this._checkLoaded();
            return this.tokenizer.encode(text);
        }

        /**
         * Decode token IDs to text
         * @param {number[]} tokenIds - Array of token IDs
         * @param {boolean} skipSpecialTokens - Whether to skip special tokens
         * @returns {string} Decoded text
         */
        decode(tokenIds, skipSpecialTokens = false) {
            this._checkLoaded();
            return this.tokenizer.decode(tokenIds, skipSpecialTokens);
        }

        /**
         * Count tokens in text
         * @param {string} text - Input text
         * @returns {number} Number of tokens
         */
        countTokens(text) {
            this._checkLoaded();
            return this.tokenizer.encode(text).length;
        }

        /**
         * Normalize token score to intuitive strength value
         * Converts SentencePiece log probabilities to positive influence scores
         * @private
         */
        _normalizeStrength(rawScore, isSpecial) {
            if (isSpecial || rawScore === 0) {
                return 0; // Special tokens are neutral
            }
            
            // SentencePiece scores are negative log probabilities
            // More negative = rarer/more specific
            // We invert and normalize to make it intuitive:
            // Positive = strong influence (rare/important tokens)
            // Scale: roughly 0-10 range, where higher = more influence
            
            const absScore = Math.abs(rawScore);
            
            // Common tokens: -3 to -7 → low influence (0-3)
            // Rare tokens: -10 to -13 → high influence (6-10)
            const normalized = Math.min(10, Math.max(0, (absScore - 3) * 1.5));
            
            return parseFloat(normalized.toFixed(2));
        }

        /**
         * Get detailed information about a token
         * @param {number} tokenId - Token ID
         * @returns {Object} Token details
         */
        getTokenDetails(tokenId) {
            this._checkLoaded();
            
            const token = this.tokenizer.getToken(tokenId);
            const rawScore = this.tokenizer.getScore(this.tokenizer.getToken(tokenId));
            const isSpecial = this.specialTokens.find(t => t.id === tokenId);
            
            return {
                tokenId: tokenId,
                text: token,
                isValid: tokenId !== this.tokenizer.unkTokenId,
                strength: this._normalizeStrength(rawScore, !!isSpecial),
                isSpecial: !!isSpecial,
                rawScore: rawScore // Keep original for advanced users
            };
        }

        /**
         * Analyze multiple texts (e.g., from multiple text boxes)
         * @param {string[]} texts - Array of text strings
         * @param {boolean} detailed - Return detailed token objects (default: false)
         * @returns {Object} Analysis results
         */
        analyzeTexts(texts, detailed = false) {
            this._checkLoaded();
            
            const results = texts.map(text => {
                const tokenIds = this.tokenizer.encode(text);
                
                // Create detailed token objects if requested
                const tokenData = detailed 
                    ? tokenIds.map(id => {
                        const token = this.tokenizer.getToken(id);
                        const rawScore = this.tokenizer.getScore(token);
                        const isSpecial = this.specialTokens.find(t => t.id === id);
                        
                        return {
                            tokenId: id,
                            text: token,
                            isValid: id !== this.tokenizer.unkTokenId,
                            strength: this._normalizeStrength(rawScore, !!isSpecial),
                            isSpecial: !!isSpecial,
                            rawScore: rawScore // Keep original for reference
                        };
                    })
                    : tokenIds; // Return simple array of IDs for backward compatibility
                
                return {
                    text: text,
                    tokenCount: tokenIds.length,
                    tokenIds: detailed ? undefined : tokenIds, // Only include if not detailed
                    tokens: detailed ? tokenData : tokenIds.map(id => this.tokenizer.getToken(id)),
                    ...(detailed && { detailedTokens: tokenData }) // Add detailedTokens if in detailed mode
                };
            });
            
            const totalTokens = results.reduce((sum, r) => sum + r.tokenCount, 0);
            
            // Add percentages
            results.forEach(r => {
                r.percentage = totalTokens > 0 ? (r.tokenCount / totalTokens * 100).toFixed(2) : 0;
            });
            
            return {
                totalTokens: totalTokens,
                results: results
            };
        }

        /**
         * Get token from ID
         * @param {number} tokenId - Token ID
         * @returns {string} Token string
         */
        getToken(tokenId) {
            this._checkLoaded();
            return this.tokenizer.getToken(tokenId);
        }

        /**
         * Get token ID from token string
         * @param {string} token - Token string
         * @returns {number} Token ID
         */
        getTokenId(token) {
            this._checkLoaded();
            return this.tokenizer.getTokenId(token);
        }
    }

    // Export the main class
    return T5Tokenizer;
}));

