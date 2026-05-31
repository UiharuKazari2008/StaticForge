// Local Prompt Optimizer
// Optimizes prompts locally before AI processing by replacing words/phrases
// with lower token count alternatives while maintaining semantic strength

const fs = require('fs');
const path = require('path');

class LocalPromptOptimizer {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('LocalPromptOptimizer requires globalResources');
        }
        this.globalResources = globalResources;
        this.vocabulary = null;
        this.tokenIndex = null;
        this.synonymCache = new Map(); // Cache for synonym lookups
        this.spellChecker = null;
        this.fastTagSearch = null;
        this.tagCache = new Map(); // Cache for tag lookups
        this.initialized = false;
    }

    /**
     * Initialize the optimizer with vocabulary and WordNet
     */
    async initialize() {
        if (this.initialized) return true;

        try {
            // Get T5 tokenizer from global resources
            const t5TokenizerService = this.globalResources.getT5Tokenizer();

            // Load T5 vocabulary with strength ratings
            const vocabPath = this.globalResources.getPath('t5Vocabulary');
            
            if (!fs.existsSync(vocabPath)) {
                console.warn('⚠️ T5 vocabulary file not found, local optimization disabled');
                return false;
            }

            const vocabData = JSON.parse(fs.readFileSync(vocabPath, 'utf8'));
            this.vocabulary = vocabData.vocabulary;

            // Build token index: maps normalized text to token data
            this.tokenIndex = new Map();
            this.vocabulary.forEach(token => {
                if (!token.isSpecial && token.text) {
                    const normalized = this.normalizeText(token.text);
                    if (!this.tokenIndex.has(normalized)) {
                        this.tokenIndex.set(normalized, []);
                    }
                    this.tokenIndex.get(normalized).push(token);
                }
            });

            // Get services from global resources instead of creating new instances
            this.spellChecker = this.globalResources.getSpellChecker();
            // FastTagSearch is optional at boot (may lazy-load with tag search services later)
            if (this.globalResources.fastTagSearch) {
                this.fastTagSearch = this.globalResources.fastTagSearch;
            }

            this.initialized = true;
            console.log(`✅ Local Prompt Optimizer initialized with ${this.vocabulary.length} tokens`);
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Local Prompt Optimizer:', error);
            return false;
        }
    }

    /**
     * Normalize text for comparison (handles case, spacing, special characters)
     */
    normalizeText(text) {
        return text.toLowerCase()
            .replace(/[_\-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Parse NovelAI emphasis syntax
     * Returns { weight, text, cleanText, rawText, hasEmphasis }
     */
    parseEmphasis(text) {
        let weight = 1.0;
        let cleanText = text;
        let hasNumericEmphasis = false;
        
        // First check for auto-terminating pattern: number::text (without closing ::)
        const autoTerminatingPattern = /^(\d+\.?\d*)::(.+?)(?=\s*\d+\.?\d*::|::|$)/;
        const autoTerminatingMatch = text.match(autoTerminatingPattern);
        
        if (autoTerminatingMatch) {
            weight = parseFloat(autoTerminatingMatch[1]);
            cleanText = autoTerminatingMatch[2].trim();
            hasNumericEmphasis = true;
        } else {
            // Pattern: number::text::
            const numericPattern = /^(\d+\.?\d*)::(.+?)::$/;
            const numericMatch = text.match(numericPattern);
            
            if (numericMatch) {
                weight = parseFloat(numericMatch[1]);
                cleanText = numericMatch[2].trim();
                hasNumericEmphasis = true;
            }
        }
        
        // Count curly braces (each pair = ~1.05x weight)
        let braceCount = 0;
        let tempText = cleanText;
        
        while (tempText.startsWith('{') && tempText.endsWith('}')) {
            braceCount++;
            tempText = tempText.substring(1, tempText.length - 1).trim();
        }
        
        if (braceCount > 0) {
            weight *= Math.pow(1.05, braceCount);
            cleanText = tempText;
        }
        
        // Count square brackets (each pair = ~0.95x weight)
        let bracketCount = 0;
        tempText = cleanText;
        
        while (tempText.startsWith('[') && tempText.endsWith(']')) {
            bracketCount++;
            tempText = tempText.substring(1, tempText.length - 1).trim();
        }
        
        if (bracketCount > 0) {
            weight *= Math.pow(0.95, bracketCount);
            cleanText = tempText;
        }
        
        return {
            weight,
            text: cleanText,
            rawText: text,
            hasEmphasis: hasNumericEmphasis || braceCount > 0 || bracketCount > 0,
            braceCount,
            bracketCount
        };
    }

    /**
     * Calculate score for a replacement based on balanced optimization strategy
     * @param {number} tokensSaved - Tokens saved by replacement
     * @param {number} strength - Strength of replacement
     * @param {number} strengthGain - Strength gain over original
     * @param {number} emphasisWeight - Weight from NovelAI emphasis (1.0 = normal)
     * @returns {number|null} Score or null if replacement should not be considered
     */
    calculateScore(tokensSaved, strength, strengthGain, emphasisWeight = 1.0) {
        let score = null;
        
        // For emphasized text (weight > 1.0), require higher strength gain
        // The more emphasized, the more selective we are
        const emphasisMultiplier = Math.max(1.0, emphasisWeight);
        const minStrengthGainForEmphasis = 1.0 + (emphasisMultiplier - 1.0) * 2.0;
        
        if (tokensSaved > 0) {
            // Token reduction: highly favored
            // Accept if:
            // 1. Not emphasized, OR
            // 2. Emphasized but doesn't significantly weaken (loss < 2.0), OR
            // 3. Emphasized and maintains/improves strength
            if (emphasisWeight > 1.2 && strengthGain < -2.0) {
                // Don't significantly weaken heavily emphasized text
                return null;
            }
            // If replacement has low/no strength data, still accept if it saves tokens
            // but give it lower priority
            const effectiveStrength = strength > 0 ? strength : 3.0; // Default strength for unknown words
            score = (tokensSaved * 100) + effectiveStrength;
        } else if (tokensSaved === 0 && strengthGain >= 1.5) {
            // Same tokens but stronger (lowered from 2.0 to 1.5)
            // For emphasized text, need higher gain
            if (emphasisWeight > 1.0 && strengthGain < minStrengthGainForEmphasis) {
                return null;
            }
            score = strength;
        } else if (tokensSaved === -1 && strength >= 9.0 && strengthGain >= 2.5) {
            // Trade 1 token for high-strength word (lowered from 3.0 to 2.5)
            // Must be very strong (≥9.0) to justify the token cost
            // For emphasized text, need exceptional gain
            if (emphasisWeight > 1.0 && strengthGain < minStrengthGainForEmphasis + 1.0) {
                return null;
            }
            score = strength - 50; // Lower priority than token-saving
        }
        
        return score;
    }

    /**
     * Get synonyms for a word using shared word lookup with T5 strength filtering
     * @param {string} word - The word to get synonyms for
     * @returns {Array} Array of {synonym, safeForLocal} objects
     */
    getSynonyms(word) {
        // Check cache first
        const cacheKey = word.toLowerCase();
        if (this.synonymCache.has(cacheKey)) {
            return this.synonymCache.get(cacheKey);
        }

        try {
            let rawSynonyms = [];
            const wordLookupService = this.globalResources.getWordLookupService();
            const cachedLookup = wordLookupService.cache.get(cacheKey);
            if (cachedLookup) {
                rawSynonyms = cachedLookup.synonyms;
            } else {
                rawSynonyms = wordLookupService.getMobySynonyms(word);
                wordLookupService.lookupWord(word).catch(() => {});
            }

            // Filter and categorize synonyms
            const filtered = [];

            for (const syn of rawSynonyms) {
                // Skip complex multi-word phrases (more than 2 words)
                const wordCount = syn.split(/\s+/).length;
                if (wordCount > 2) continue;

                // Check spelling
                const words = syn.split(/\s+/);
                let allCorrect = true;
                for (const w of words) {
                    if (!this.spellChecker.isCorrect(w)) {
                        allCorrect = false;
                        break;
                    }
                }

                if (!allCorrect) continue;

                // Check if this synonym exists in our T5 vocabulary
                const synTokenData = this.getTokenData(syn);
                const hasStrengthData = synTokenData && synTokenData.length > 0;
                const strength = hasStrengthData ? Math.max(...synTokenData.map(t => t.strength || 0)) : 0;

                //  Mark as safe for local application only if:
                // 1. It has T5 strength data (means it's in the model vocabulary)
                // 2. Strength is decent (≥ 7.0)
                const safeForLocal = hasStrengthData && strength >= 7.0;

                filtered.push({
                    synonym: syn,
                    safeForLocal: safeForLocal,
                    strength: strength
                });
            }

            // Cache the result
            this.synonymCache.set(cacheKey, filtered);

            return filtered;
        } catch (error) {
            console.error(`Error getting synonyms for "${word}":`, error);
            return [];
        }
    }

    /**
     * Check if text is an exact NovelAI tag and get its groups
     * @param {string} text - The text to check
     * @param {string} dataset - 'anime' or 'furry'
     * @returns {Object|null} Tag data with groups, or null if not an exact tag
     */
    checkIfExactTag(text, dataset = 'anime') {
        if (!this.fastTagSearch) return null;

        const exact = this.fastTagSearch.exactMatch(text, dataset);
        if (!exact) {
            return null;
        }

        return {
            tag: exact.name,
            nCount: exact.n_count || 0,
            dCount: exact.d_count || 0,
            eCount: exact.e_count || 0,
            groups: exact.d_group || [],
            isGolden: (exact.n_count || 0) > 5000,
            isProtected: this.isProtectedGroup(exact.d_group || [])
        };
    }

    /**
     * Determine if tag groups indicate this is a protected category
     * Protected categories shouldn't be casually replaced
     */
    isProtectedGroup(groups) {
        if (!groups || groups.length === 0) return false;
        
        const protectedPatterns = [
            '/composition/framing',             // Camera angles/framing (cowboy shot, wide shot, etc.)
            '/composition/camera',              // Camera angles
            '/composition/perspective',         // Perspective (pov, etc.)
            '/attire/',                         // Clothing items
            '/eyes/',                           // Eye details
            '/hair/',                           // Hair styles/details
            '/quality',                         // Quality descriptors
            'character',                        // Character tags
            'copyright',                        // Series/copyright
            '/bodyparts/',                      // Specific body parts
            '/posture/'                         // Postures (standing, sitting, etc.)
        ];
        
        for (const group of groups) {
            for (const pattern of protectedPatterns) {
                if (group.includes(pattern)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Find related tags from same group using sliding window
     * Only returns exact matches and related tags from same category
     * @param {string} text - The text to search
     * @param {string} dataset - 'anime' or 'furry'
     * @returns {Object} { exactMatch, relatedTags, context }
     */
    findMatchingTags(text, dataset = 'anime') {
        const cacheKey = `${dataset}:${text.toLowerCase()}`;
        if (this.tagCache.has(cacheKey)) {
            return this.tagCache.get(cacheKey);
        }

        if (!this.fastTagSearch) {
            return {
                exactMatch: null,
                relatedTags: [],
                contextGroups: new Set()
            };
        }
        
        const result = {
            exactMatch: null,
            relatedTags: [],
            contextGroups: new Set()
        };
        
        const words = text.trim().split(/\s+/);
        const totalWords = words.length;

        for (let windowSize = totalWords; windowSize >= 1; windowSize--) {
            for (let startPos = 0; startPos <= totalWords - windowSize; startPos++) {
                const windowWords = words.slice(startPos, startPos + windowSize);
                const windowPhrase = windowWords.join(' ');

                const tagResult = this.fastTagSearch.exactMatch(windowPhrase, dataset);
                if (!tagResult) {
                    continue;
                }

                const exactTagData = {
                    tag: tagResult.name,
                    nCount: tagResult.n_count || 0,
                    dCount: tagResult.d_count || 0,
                    eCount: tagResult.e_count || 0,
                    groups: tagResult.d_group || [],
                    isGolden: (tagResult.n_count || 0) > 5000,
                    isProtected: this.isProtectedGroup(tagResult.d_group || []),
                    matchedPhrase: windowPhrase.toLowerCase(),
                    windowSize: windowSize,
                    coverage: (windowSize / totalWords) * 100
                };

                if (!result.exactMatch || exactTagData.nCount > result.exactMatch.nCount) {
                    result.exactMatch = exactTagData;
                }

                exactTagData.groups.forEach(g => result.contextGroups.add(g));
            }
        }
        
        // Cache and return
        this.tagCache.set(cacheKey, result);
        return result;
    }

    /**
     * Get tag context data for AI decision-making
     * Provides information about what tags exist and their power levels
     */
    getTagContext(text) {
        if (!this.fastTagSearch) return null;

        const normalized = text.trim();
        const animeMatch = this.fastTagSearch.exactMatch(normalized, 'anime');
        const furryMatch = this.fastTagSearch.exactMatch(normalized, 'furry');
        const bestMatch = animeMatch || furryMatch;

        if (!bestMatch) {
            return null;
        }

        return {
            tag: bestMatch.name,
            nCount: bestMatch.n_count || 0,
            dCount: bestMatch.d_count || 0,
            isGolden: (bestMatch.n_count || 0) > 5000,
            isProtected: this.isProtectedGroup(bestMatch.d_group || []),
            groups: bestMatch.d_group || [],
            coverage: 100,
            matchedPhrase: normalized.toLowerCase()
        };
    }

    /**
     * Simplified alternative finder - just collect data, don't make decisions
     * Returns ALL viable alternatives with their metrics for AI to decide
     */
    getTagAlternatives(text, emphasisWeight = 1.0) {
        // Tags just provide context, not replacements
        // Actual suggestions come from Moby/patterns
        return [];
    }

    /**
     * Get common phrase replacements
     * These are grammatical patterns that Moby/tags won't catch
     */
    getCommonPhraseReplacements() {
        // Only keep patterns that WordNet can't handle (grammatical transformations)
        return new Map([
            // Verb forms - "is/are doing" → "does"
            ['is standing', ['stands']],
            ['is sitting', ['sits']],
            ['is walking', ['walks']],
            ['is running', ['runs']],
            ['is looking', ['looks']],
            ['is smiling', ['smiles']],
            ['is laughing', ['laughs']],
            ['is crying', ['cries']],
            ['is holding', ['holds']],
            ['is wearing', ['wears']],
            ['are standing', ['stand']],
            ['are sitting', ['sit']],
            ['are walking', ['walk']],
            
            // Prepositions - "in the X" → "X"
            ['in the center', ['centered', 'central']],
            ['in the middle', ['centered', 'central']],
            ['in the background', ['background']],
            ['in the foreground', ['foreground']],
            ['on the left', ['left']],
            ['on the right', ['right']],
            ['at the top', ['top']],
            ['at the bottom', ['bottom']],
            
            // Time prepositions
            ['during the day', ['daytime']],
            ['during the night', ['nighttime']],
            ['in the morning', ['morning']],
            ['in the afternoon', ['afternoon']],
            ['in the evening', ['evening']],
            ['at night', ['nighttime']],
            
            // Common redundancies
            ['standing pose', ['standing']],
            ['sitting pose', ['sitting']],
            ['walking pose', ['walking']],
            ['facial expression', ['expression']],
            ['hand gesture', ['gesture']],
        ]);
    }

    /**
     * Get token data for a given text
     */
    getTokenData(text) {
        if (!this.initialized) return null;
        
        const normalized = this.normalizeText(text);
        return this.tokenIndex.get(normalized) || null;
    }

    /**
     * Count tokens for a given text
     */
    countTokens(text) {
        try {
            const t5TokenizerService = this.globalResources.getT5Tokenizer();
            return t5TokenizerService.countTokens(text);
        } catch (error) {
            // Fallback: estimate by word count
            return text.split(/\s+/).length;
        }
    }

    /**
     * Find alternative replacements for a word/phrase using Moby Thesaurus and common patterns
     * Returns array of alternatives sorted by score, or null if no alternatives found
     * @param {string} text - The text to find alternatives for
     * @param {boolean} preserveCase - Whether to preserve original capitalization
     * @param {number} maxAlternatives - Maximum number of alternatives to return
     * @param {number} emphasisWeight - Weight from NovelAI emphasis (default 1.0)
     * @param {string} fullContext - Full segment text for POS tagging context
     * @returns {Array|null} Array of {replacement, tokenSaved, strengthScore, score} or null
     */
    findBestAlternative(text, preserveCase = false, maxAlternatives = 5, emphasisWeight = 1.0, fullContext = '') {
        if (!this.initialized) return null;

        const originalTokens = this.countTokens(text);
        const normalized = this.normalizeText(text);

        const alternatives = []; // Collect all viable alternatives

        // Get original word strength for comparison
        const originalTokenData = this.getTokenData(text);
        const originalStrength = originalTokenData && originalTokenData.length > 0
            ? Math.max(...originalTokenData.map(t => t.strength || 5.0))
            : 5.0;

        // STRATEGY: Collect ALL alternatives from different sources
        // 1. NovelAI Tags (golden standard for exact concepts)
        // 2. Common Phrase Patterns (grammatical improvements)
        // 3. Moby Synonyms (semantic alternatives)
        // Then let AI choose the best based on context
        
        // SOURCE 1: NovelAI Tags
        const tagAlternatives = this.getTagAlternatives(text, emphasisWeight);
        alternatives.push(...tagAlternatives);

        // SOURCE 2: Common phrase replacements (grammatical patterns)
        const commonPhrases = this.getCommonPhraseReplacements();
        if (commonPhrases.has(normalized)) {
            const phraseAlts = commonPhrases.get(normalized);
            
            for (const alt of phraseAlts) {
                const altTokens = this.countTokens(alt);
                const tokensSaved = originalTokens - altTokens;
                
                // Get strength of alternative
                const altTokenData = this.getTokenData(alt);
                const strength = altTokenData && altTokenData.length > 0 
                    ? Math.max(...altTokenData.map(t => t.strength || 5.0))
                    : 5.0;
                
                const strengthGain = strength - originalStrength;
                const score = this.calculateScore(tokensSaved, strength, strengthGain, 1.0); // Common phrases don't have emphasis
                
                if (score !== null) {
                    alternatives.push({
                        replacement: preserveCase ? this.preserveCase(alt, text) : alt,
                        tokensSaved: tokensSaved,
                        strengthScore: strength,
                        originalTokens: originalTokens,
                        newTokens: altTokens,
                        strengthGain: strengthGain,
                        score: score,
                        source: 'phrase_pattern',
                        safeForLocal: true  // Common phrases are always safe
                    });
                }
            }
        }

        // SOURCE 3: Moby Thesaurus synonyms
        const words = text.split(/\s+/);
        if (words.length <= 2 && words.length > 0) {
            try {
                // Get synonyms from Moby Thesaurus with spell checking
                const synonymResults = this.getSynonyms(text);
                
        for (const synData of synonymResults) {
            const syn = synData.synonym;
            const synTokens = this.countTokens(syn);
            const tokensSaved = originalTokens - synTokens;
            
            // Get strength of synonym
            const strength = synData.strength || 5.0;
            const strengthGain = strength - originalStrength;
            let score = this.calculateScore(tokensSaved, strength, strengthGain, emphasisWeight);
            
            // Special case: both original and synonym are very high strength (>= 9.0)
            // Offer as equivalent alternatives even if gain is small
            if (score === null && tokensSaved === 0 && strength >= 9.0 && originalStrength >= 9.0) {
                score = strength; // Same scoring as strength upgrade
            }
            
            if (score !== null) {
                alternatives.push({
                    replacement: preserveCase ? this.preserveCase(syn, text) : syn,
                    tokensSaved: tokensSaved,
                    strengthScore: strength,
                    originalTokens: originalTokens,
                    newTokens: synTokens,
                    strengthGain: strengthGain,
                    score: score,
                    source: 'moby_thesaurus',
                    emphasisWeight: emphasisWeight,
                    safeForLocal: synData.safeForLocal,  // Only apply locally if verified safe
                    isEquivalent: score === strength && tokensSaved === 0 && strengthGain < 1.5 // Mark as equivalent alternative
                });
            }
        }
            } catch (error) {
                // If Moby lookup fails, continue with alternatives found so far
                console.debug(`Moby Thesaurus lookup failed for "${text}":`, error.message);
            }
        }

        // Also check for single-word case optimization
        if (words.length === 1) {
            const tokenData = this.getTokenData(text);
            if (tokenData && tokenData.length > 1) {
                // If the same word has multiple token representations, prefer the stronger one
                const sorted = [...tokenData].sort((a, b) => {
                    const strengthDiff = (b.strength || 0) - (a.strength || 0);
                    if (Math.abs(strengthDiff) > 0.5) return strengthDiff;
                    // If strength is similar, prefer the one that matches case
                    return a.text === text ? -1 : 1;
                });
                
                if (sorted[0].text !== text && sorted[0].strength >= (tokenData[0].strength || 0)) {
                    const strengthGain = sorted[0].strength - originalStrength;
                    const score = this.calculateScore(0, sorted[0].strength, strengthGain, emphasisWeight);
                    
                    if (score !== null) {
                        alternatives.push({
                            replacement: preserveCase ? this.preserveCase(sorted[0].text, text) : sorted[0].text,
                            tokensSaved: 0,
                            strengthScore: sorted[0].strength,
                            originalTokens: originalTokens,
                            newTokens: originalTokens,
                            strengthGain: strengthGain,
                            score: score,
                            source: 'case_optimization',
                            emphasisWeight: emphasisWeight,
                            safeForLocal: true  // Case optimization is always safe
                        });
                    }
                }
            }
        }

        // Sort by score (descending) and return top N alternatives
        if (alternatives.length === 0) return null;
        
        alternatives.sort((a, b) => b.score - a.score);
        return alternatives.slice(0, maxAlternatives);
    }

    /**
     * Preserve the case pattern of the original text
     */
    preserveCase(newText, originalText) {
        // Check if original is all caps
        if (originalText === originalText.toUpperCase()) {
            return newText.toUpperCase();
        }
        
        // Check if original is title case (first letter caps)
        if (originalText[0] === originalText[0].toUpperCase() && 
            originalText.slice(1) === originalText.slice(1).toLowerCase()) {
            return newText[0].toUpperCase() + newText.slice(1).toLowerCase();
        }
        
        // Check if original is sentence case (first letter caps, rest as-is)
        if (originalText[0] === originalText[0].toUpperCase()) {
            return newText[0].toUpperCase() + newText.slice(1);
        }
        
        // Otherwise return lowercase
        return newText.toLowerCase();
    }

    /**
     * Optimize a single prompt text
     * @param {string} text - The prompt text to optimize
     * @param {object} options - Optimization options
     * @returns {object} - {optimized: string, changes: Array, tokensSaved: number}
     */
    optimizePrompt(text, options = {}) {
        if (!this.initialized || !text) {
            return { optimized: text, changes: [], tokensSaved: 0 };
        }

        const {
            minTokenSavings = 1,      // Minimum tokens to save for a replacement
            minStrength = 5.0,        // Minimum strength score for alternatives
            preserveCase = true,      // Preserve original capitalization
            maxReplacements = null    // Maximum number of replacements (null = unlimited)
        } = options;

        let optimized = text;
        const changes = [];
        let totalTokensSaved = 0;

        // Build a list of all possible replacements with their positions
        const allReplacements = [];
        const phrases = this.extractPhrases(text, 6); // Up to 6-word phrases
        
        for (const {phrase, start, end, emphasisWeight, hasEmphasis, segmentContext} of phrases) {
            const alternatives = this.findBestAlternative(phrase, preserveCase, maxReplacements || 10, emphasisWeight || 1.0, segmentContext || '');
            
            if (alternatives && alternatives.length > 0) {
                // SELECTION STRATEGY FOR LOCAL APPLICATION:
                // 1. Prefer phrase patterns (always safe, grammatical)
                // 2. Then high-strength token optimizations (Moby with safeForLocal=true)
                // 3. Skip tags unless exact match (let AI choose between tags)
                
                const phrasePat = alternatives.find(alt => alt.source === 'phrase_pattern');
                const safeToken = alternatives.find(alt => alt.source === 'moby_thesaurus' && alt.safeForLocal === true && alt.strengthScore >= 8.0);
                
                let bestAlt = phrasePat || safeToken;
                const applyLocally = bestAlt !== undefined;
                
                // If no safe alternative, don't apply locally but still track for AI
                if (!bestAlt) {
                    bestAlt = alternatives[0];
                }
                
                if (bestAlt.tokensSaved >= minTokenSavings &&
                    bestAlt.strengthScore >= minStrength) {
                    
                    allReplacements.push({
                        phrase,
                        start,
                        end,
                        replacement: bestAlt.replacement,
                        tokensSaved: bestAlt.tokensSaved,
                        strength: bestAlt.strengthScore,
                        score: bestAlt.score,
                        source: bestAlt.source,
                        strengthGain: bestAlt.strengthGain,
                        emphasisWeight: emphasisWeight || 1.0,
                        hasEmphasis: hasEmphasis || false,
                        applyLocally: applyLocally,  // Only apply phrase patterns and safe tokens
                        allAlternatives: alternatives // Store ALL alternatives for AI consumption
                    });
                }
            }
        }

        // Sort by score (descending), then by length (longer first), then by position
        allReplacements.sort((a, b) => {
            if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
            if (b.phrase.length !== a.phrase.length) return b.phrase.length - a.phrase.length;
            return a.start - b.start;
        });

        // Apply replacements in a way that avoids overlaps
        const appliedRanges = [];
        const appliedReplacements = [];

        for (const replacement of allReplacements) {
            // Skip if not safe for local application
            // These will still be provided to AI as alternatives
            if (!replacement.applyLocally) {
                continue;
            }
            
            // Check if this replacement overlaps with any already applied
            const overlaps = appliedRanges.some(range => 
                (replacement.start >= range.start && replacement.start < range.end) ||
                (replacement.end > range.start && replacement.end <= range.end) ||
                (replacement.start <= range.start && replacement.end >= range.end)
            );

            if (!overlaps) {
                appliedRanges.push({ start: replacement.start, end: replacement.end });
                appliedReplacements.push(replacement);
                
                if (maxReplacements && appliedReplacements.length >= maxReplacements) {
                    break;
                }
            }
        }

        // Sort by position (descending) so we can replace from end to start
        // This way we don't need to adjust indices
        appliedReplacements.sort((a, b) => b.start - a.start);

        // Apply replacements from end to start
        for (const replacement of appliedReplacements) {
            const before = optimized.substring(0, replacement.start);
            const after = optimized.substring(replacement.end);
            optimized = before + replacement.replacement + after;
            
            changes.push({
                original: replacement.phrase,
                replacement: replacement.replacement,
                tokensSaved: replacement.tokensSaved,
                strength: replacement.strength,
                position: replacement.start,
                allAlternatives: replacement.allAlternatives  // Include alternatives in change record
            });
            
            totalTokensSaved += replacement.tokensSaved;
        }
        
        // Also track AI-only suggestions (not applied locally but available for AI)
        const aiOnlySuggestions = allReplacements.filter(r => !r.applyLocally).map(r => ({
            original: r.phrase,
            allAlternatives: r.allAlternatives,
            reason: 'Not applied locally - semantic verification needed by AI'
        }));

        // Sort changes by position for logging
        changes.sort((a, b) => a.position - b.position);

        return {
            optimized,
            changes,
            tokensSaved: totalTokensSaved,
            originalTokenCount: this.countTokens(text),
            optimizedTokenCount: this.countTokens(optimized),
            aiOnlySuggestions: aiOnlySuggestions // Suggestions not applied locally
        };
    }

    /**
     * Split prompt into segments respecting emphasis groups
     * Handles nested emphasis: 1.5::{{{text, with, commas}}}::
     */
    splitPreservingEmphasis(text) {
        const segments = [];
        let i = 0;
        
        while (i < text.length) {
            // Skip whitespace and commas
            while (i < text.length && (text[i].match(/\s/) || text[i] === ',')) i++;
            if (i >= text.length) break;
            
            let segment = '';
            let braceDepth = 0;
            let bracketDepth = 0;
            
            // Check if starting with numeric emphasis pattern
            const numericMatch = text.substring(i).match(/^(\d+\.?\d*)::/);
            let inNumericEmphasis = !!numericMatch;
            
            if (inNumericEmphasis) {
                // Add the number:: part
                segment += numericMatch[0];
                i += numericMatch[0].length;
                
                // Now collect everything until we find closing :: at depth 0
                while (i < text.length) {
                    const char = text[i];
                    const nextChar = text[i + 1] || '';
                    
                    // Track braces and brackets
                    if (char === '{') braceDepth++;
                    if (char === '}') braceDepth--;
                    if (char === '[') bracketDepth++;
                    if (char === ']') bracketDepth--;
                    
                    segment += char;
                    i++;
                    
                    // Check for closing :: at depth 0
                    if (char === ':' && nextChar === ':' && braceDepth === 0 && bracketDepth === 0) {
                        segment += nextChar;
                        i++;
                        break;
                    }
                }
            } else {
                // Normal segment or brace/bracket emphasized
                while (i < text.length) {
                    const char = text[i];
                    
                    // Track braces and brackets
                    if (char === '{') braceDepth++;
                    if (char === '}') braceDepth--;
                    if (char === '[') bracketDepth++;
                    if (char === ']') bracketDepth--;
                    
                    // Stop at comma if we're at depth 0
                    if (char === ',' && braceDepth === 0 && bracketDepth === 0) {
                        break;
                    }
                    
                    segment += char;
                    i++;
                }
            }
            
            if (segment.trim()) {
                segments.push(segment.trim());
            }
        }
        
        return segments;
    }

    /**
     * Extract all phrases of various lengths from text
     * Handles NovelAI emphasis syntax and protects exact tag matches
     */
    extractPhrases(text, maxWords = 6) {
        const phrases = [];
        const protectedRanges = []; // Track tag ranges to avoid splitting
        
        // Split by commas while preserving emphasis groups
        const segments = this.splitPreservingEmphasis(text);
        
        for (const segment of segments) {
            const segmentStart = text.indexOf(segment);
            
            // Parse emphasis from segment
            const parsed = this.parseEmphasis(segment);
            const cleanSegment = parsed.text;
            const emphasisWeight = parsed.weight;
            
            // Check if this segment (or parts of it) is an exact PROTECTED tag
            const tagData = this.findMatchingTags(cleanSegment, 'anime');
            const protectedWords = new Set(); // Track which word indices are protected
            
            // ONLY protect if the tag is actually in a protected category
            if (tagData.exactMatch && tagData.exactMatch.isProtected) {
                // Find which words are part of the protected tag
                const tagWords = tagData.exactMatch.matchedPhrase.toLowerCase().split(/\s+/);
                const segmentWords = cleanSegment.toLowerCase().split(/\s+/);
                
                // Find where the tag starts in the word array
                for (let i = 0; i <= segmentWords.length - tagWords.length; i++) {
                    let matches = true;
                    for (let j = 0; j < tagWords.length; j++) {
                        if (segmentWords[i + j] !== tagWords[j]) {
                            matches = false;
                            break;
                        }
                    }
                    if (matches) {
                        // Mark these word indices as protected
                        for (let j = 0; j < tagWords.length; j++) {
                            protectedWords.add(i + j);
                        }
                        console.log(`🛡️ Protected tag "${tagData.exactMatch.tag}" at word indices [${i}-${i + tagWords.length - 1}]`);
                        break;
                    }
                }
            } else if (tagData.exactMatch && !tagData.exactMatch.isProtected) {
                console.log(`📌 Non-protected tag "${tagData.exactMatch.tag}" - allowing optimization`);
            }
            
            const words = cleanSegment.split(/\s+/);
            
            // Extract phrases of different lengths from clean text (including single words)
            for (let len = maxWords; len >= 1; len--) {
                for (let i = 0; i <= words.length - len; i++) {
                    const phraseWordIndices = Array.from({length: len}, (_, idx) => i + idx);
                    
                    // Skip if ANY word in this phrase is part of a protected tag
                    if (protectedWords.size > 0) {
                        const touchesProtected = phraseWordIndices.some(idx => protectedWords.has(idx));
                        const spansProtected = !touchesProtected && 
                            phraseWordIndices.some(idx => idx < Math.min(...protectedWords)) &&
                            phraseWordIndices.some(idx => idx > Math.max(...protectedWords));
                        
                        if (touchesProtected || spansProtected) {
                            continue; // Skip phrases involving protected words
                        }
                    }
                    // If no protected words, extract all phrases
                    
                    const phrase = words.slice(i, i + len).join(' ');
                    const phraseStart = segmentStart + cleanSegment.indexOf(phrase);
                    const phraseEnd = phraseStart + phrase.length;
                    
                    phrases.push({
                        phrase,
                        start: phraseStart,
                        end: phraseEnd,
                        emphasisWeight: emphasisWeight,
                        hasEmphasis: parsed.hasEmphasis,
                        segmentContext: cleanSegment  // Pass full segment for context
                    });
                }
            }
        }
        
        return phrases;
    }

    /**
     * Format alternatives for AI consumption
     * Returns a structured object that the AI can use to make context-aware decisions
     */
    formatAlternativesForAI(optimizationResult) {
        const suggestions = [];
        
        if (optimizationResult.changes && optimizationResult.changes.length > 0) {
            optimizationResult.changes.forEach(change => {
                if (change.allAlternatives && change.allAlternatives.length > 1) {
                    suggestions.push({
                        original: change.original,
                        options: change.allAlternatives.map(alt => ({
                            text: alt.replacement,
                            tokens: alt.newTokens,
                            tokensSaved: alt.tokensSaved,
                            strength: alt.strengthScore.toFixed(1),
                            strengthGain: alt.strengthGain ? alt.strengthGain.toFixed(1) : '0.0',
                            score: alt.score.toFixed(1),
                            source: alt.source,
                            nCount: alt.nCount || 0,
                            isGolden: alt.isGolden || false,
                            confidence: alt.confidence || 0,
                            losesInfo: alt.losesInfo || false,
                            matchedPhrase: alt.windowMetadata?.matchedPhrase,
                            coverage: alt.windowMetadata?.coverage
                        })),
                        context: 'Choose the best alternative based on context. NovelAI tags are exact concepts, synonyms may need semantic verification.'
                    });
                }
            });
        }
        
        return {
            hasSuggestions: suggestions.length > 0,
            suggestions,
            instruction: 'Multiple alternatives available from NovelAI tags (exact), phrase patterns (grammar), and synonyms (verify meaning). Choose based on semantic fit and context.'
        };
    }

    /**
     * Optimize multiple prompts (batch operation)
     */
    optimizePrompts(prompts, options = {}) {
        if (!Array.isArray(prompts)) {
            prompts = [prompts];
        }

        return prompts.map(prompt => this.optimizePrompt(prompt, options));
    }

    /**
     * Optimize a full generation request (prompt, UC, character prompts)
     */
    optimizeGenerationRequest(prompt, uc, characterPrompts = [], options = {}) {
        if (!this.initialized) {
            return {
                prompt,
                uc,
                characterPrompts,
                optimized: false,
                stats: { totalTokensSaved: 0, changes: [] }
            };
        }

        const stats = {
            totalTokensSaved: 0,
            changes: []
        };

        // Optimize main prompt
        const promptResult = this.optimizePrompt(prompt, options);
        if (promptResult.tokensSaved > 0) {
            prompt = promptResult.optimized;
            stats.totalTokensSaved += promptResult.tokensSaved;
            stats.changes.push({
                type: 'prompt',
                ...promptResult
            });
        }

        // Optimize UC
        const ucResult = this.optimizePrompt(uc, options);
        if (ucResult.tokensSaved > 0) {
            uc = ucResult.optimized;
            stats.totalTokensSaved += ucResult.tokensSaved;
            stats.changes.push({
                type: 'uc',
                ...ucResult
            });
        }

        // Optimize character prompts
        const optimizedCharacterPrompts = characterPrompts.map((char, index) => {
            const charPromptResult = this.optimizePrompt(char.prompt || '', options);
            const charUcResult = this.optimizePrompt(char.uc || '', options);
            
            const optimizedChar = { ...char };
            
            if (charPromptResult.tokensSaved > 0) {
                optimizedChar.prompt = charPromptResult.optimized;
                stats.totalTokensSaved += charPromptResult.tokensSaved;
                stats.changes.push({
                    type: 'character_prompt',
                    characterIndex: index,
                    ...charPromptResult
                });
            }
            
            if (charUcResult.tokensSaved > 0) {
                optimizedChar.uc = charUcResult.optimized;
                stats.totalTokensSaved += charUcResult.tokensSaved;
                stats.changes.push({
                    type: 'character_uc',
                    characterIndex: index,
                    ...charUcResult
                });
            }
            
            return optimizedChar;
        });

        return {
            prompt,
            uc,
            characterPrompts: optimizedCharacterPrompts,
            optimized: stats.totalTokensSaved > 0,
            stats
        };
    }

    /**
     * Generate tree-formatted prompt analysis for AI (optimized, without token breakdown)
     * @param {string} prompt - The prompt to analyze
     * @returns {string} Tree-formatted analysis
     */
    formatPromptAnalysisTree(prompt, tokenCount = null, tokenLimit = 512, warningLevel = null) {
        if (!this.initialized || !this.fastTagSearch) {
            return '';
        }

        // Extract text overlay if present (", Text: ..." at the end)
        let textOverlay = null;
        let promptToAnalyze = prompt;
        
        const textMatch = prompt.match(/Text:\s*(.+)$/i);
        if (textMatch) {
            textOverlay = textMatch[1].trim();
            promptToAnalyze = prompt.substring(0, prompt.lastIndexOf('Text:')).trim();
        }

        const lines = [];
        const totalTokens = tokenCount !== null ? tokenCount : this.countTokens(prompt);
        const percentage = Math.round((totalTokens / tokenLimit) * 100);
        
        lines.push('PROMPT ANALYSIS');
        lines.push(`Total tokens: ${totalTokens}/${tokenLimit} (${percentage}% used)`);
        
        // Add warning if needed
        if (warningLevel === 'critical') {
            lines.push('🚨 CRITICAL: Token limit exceeded! MUST reduce token usage.');
        } else if (warningLevel === 'warning') {
            lines.push('⚠️ WARNING: Approaching limit. Be careful with additions.');
        }
        
        lines.push('');
        
        // Parse emphasis groups (without text overlay)
        const emphasisGroups = this.splitPreservingEmphasis(promptToAnalyze);
        
        emphasisGroups.forEach((group, groupIdx) => {
            const parsed = this.parseEmphasis(group);
            const emphasis = parsed.weight;
            const cleanGroup = parsed.text;
            const groupTokens = this.countTokens(cleanGroup);
            const isLastGroup = groupIdx === emphasisGroups.length - 1;
            
            const emphNote = emphasis !== 1.0 ? `[${emphasis.toFixed(2)}x] ` : '';
            lines.push(`${isLastGroup ? '└──' : '├──'} ${emphNote}"${cleanGroup}" (${groupTokens} tokens)`);
            
            // Split by comma within the group
            const items = cleanGroup.split(',').map(s => s.trim()).filter(s => s.length > 0);
            
            items.forEach((item, itemIdx) => {
                const isLastItem = itemIdx === items.length - 1;
                const prefix = isLastGroup ? '    ' : '│   ';
                
                // Parse nested emphasis
                const itemParsed = this.parseEmphasis(item);
                const itemClean = itemParsed.text;
                const itemEmphasis = itemParsed.weight;
                const totalEmphasis = emphasis * itemEmphasis;
                
                // Token count - subtract 1 for </s>
                const t5TokenizerService = this.globalResources.getT5Tokenizer();
                const rawTokenCount = t5TokenizerService.encode(itemClean).length;
                const itemTokens = rawTokenCount > 0 ? rawTokenCount - 1 : 0;
                
                // Get token breakdown (fragmentations/splits)
                const tokenIds = t5TokenizerService.encode(itemClean);
                const tokenStrings = [];
                
                tokenIds.forEach(id => {
                    const vocabEntry = this.vocabulary.find(v => v.id === id);
                    if (vocabEntry && vocabEntry.text !== '</s>') {
                        tokenStrings.push(vocabEntry.text);
                    }
                });
                
                const tokenSplit = tokenStrings.join('|');
                
                // Tag analysis
                const analysis = this.fastTagSearch.analyzeSegment(itemClean, 'anime', this);
                const validTags = analysis.tags.filter(tag => tag.n_count > 0);
                
                // Show nested emphasis if different from group
                const itemEmphNote = totalEmphasis !== emphasis && totalEmphasis !== 1.0 ? `[${totalEmphasis.toFixed(2)}x] ` : '';
                lines.push(`${prefix}${isLastItem ? '└──' : '├──'} ${itemEmphNote}"${itemClean}" (${itemTokens} tokens)`);
                
                // Show token fragmentation/split (show as ├── if there are tags after, └── otherwise)
                const hasTagsAfter = validTags.length > 0;
                lines.push(`${prefix}${isLastItem ? '    ' : '│   '}${hasTagsAfter ? '├──' : '└──'} "${tokenSplit}"`);
                
                // Show matched tags (simplified, no group paths)
                if (validTags.length > 0) {
                    validTags.forEach((tag, tagIdx) => {
                        const power = Math.min(100, (Math.log10(tag.n_count) / Math.log10(10000)) * 100);
                        const samples = tag.d_count || 0;
                        const isLastTag = tagIdx === validTags.length - 1;
                        
                        lines.push(`${prefix}${isLastItem ? '    ' : '│   '}${isLastTag ? '└──' : '├──'} Matched Tag: "${tag.tag}" [ Quality: ${power.toFixed(0)}% / Samples: ${samples} ]`);
                    });
                }
            });
        });
        
        // Add text overlay section if present
        if (textOverlay) {
            lines.push('');
            lines.push('***Text Overlay:***');
            lines.push('```');
            lines.push(textOverlay);
            lines.push('```');
        }
        
        return lines.join('\n');
    }
}

module.exports = LocalPromptOptimizer;

