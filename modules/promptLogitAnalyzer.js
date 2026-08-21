class PromptLogitAnalyzer {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('PromptLogitAnalyzer requires globalResources instance and should only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
    }
    /**
     * Analyzes a prompt to identify effective and ineffective parts based on tokenizer probability and tag databases.
     * @param {string} prompt - The prompt string to analyze
     * @returns {Promise<Object>} Analysis result
     */
    async analyzePrompt(prompt) {
        try {
            const tokenizer = await this.globalResources.getT5Tokenizer();
            const animeTags = await this.globalResources.getAnimeTagSearch();
            const furryTags = await this.globalResources.getFurryTagSearch();

            // 1. Parse high-level structure (groups vs plain text)
            const structuralSegments = this.parseStructure(prompt);

            const flatSegments = [];
            let totalScore = 0;
            let totalAttentionMass = 0;

            // 2. Flatten and Analyze
            for (const struct of structuralSegments) {
                // Split content by comma if it's a list inside a group or top level
                const innerParts = struct.text.split(',').map(s => s.trim()).filter(s => s.length > 0);

                for (const part of innerParts) {
                    // Analyze segment using greedy search for embedded tags
                    const analysis = await this.analyzeSegmentGreedy(part, struct.groupWeight, tokenizer, animeTags, furryTags);

                    // We might get multiple sub-segments if we found embedded tags
                    if (Array.isArray(analysis)) {
                        analysis.forEach(sub => {
                            sub.groupWeight = struct.groupWeight;
                            sub.groupText = struct.text;
                            flatSegments.push(sub);
                            totalScore += sub.effectivenessScore;
                            totalAttentionMass += sub.attentionMass;
                        });
                    } else {
                        analysis.groupWeight = struct.groupWeight;
                        analysis.groupText = struct.text;
                        flatSegments.push(analysis);
                        totalScore += analysis.effectivenessScore;
                        totalAttentionMass += analysis.attentionMass;
                    }
                }
            }

            // 3. Calculate Relative Attention Share
            if (totalAttentionMass > 0) {
                flatSegments.forEach(seg => {
                    seg.attentionShare = parseFloat((seg.attentionMass / totalAttentionMass).toFixed(4));
                });
            } else {
                flatSegments.forEach(seg => seg.attentionShare = 0);
            }

            // 4. Group segments by their weight groups for better output organization
            const groupedSegments = this.groupSegmentsByWeight(flatSegments);

            // Tokenize full prompt for overall stats
            const fullTokenData = tokenizer.getTokenData(prompt);

            return {
                prompt,
                segmentCount: flatSegments.length,
                tokenCount: fullTokenData.length,
                totalAttentionMass: parseFloat(totalAttentionMass.toFixed(2)),
                segments: flatSegments,
                groupedSegments,
                overallEffectiveness: flatSegments.length > 0 ? parseFloat((totalScore / flatSegments.length).toFixed(2)) : 0
            };

        } catch (error) {
            this.globalResources.getLogger().error('Error analyzing prompt:', error);
            throw error;
        }
    }

    /**
     * Group segments by their weight groups for organized output
     */
    groupSegmentsByWeight(segments) {
        const groups = {};
        
        segments.forEach(seg => {
            const weightKey = seg.groupWeight === 1.0 ? 'plain' : `weight_${seg.groupWeight}`;
            if (!groups[weightKey]) {
                groups[weightKey] = {
                    weight: seg.groupWeight,
                    label: seg.groupWeight === 1.0 ? 'Plain Tags' : `Group ${seg.groupWeight}::`,
                    segments: []
                };
            }
            groups[weightKey].segments.push(seg);
        });

        return groups;
    }

    /**
     * Parse prompt structure into chunks with base weights.
     */
    parseStructure(text) {
        const segments = [];
        let current = '';
        let i = 0;
        let inGroup = false;
        let currentWeight = 1.0;

        while (i < text.length) {
            // Detect start of weight group
            if (!inGroup) {
                // Match pattern: number::
                const match = text.slice(i).match(/^(-?\d+(?:\.\d+)?)::/);
                if (match) {
                    // Push previous plain text buffer if exists
                    if (current.trim()) {
                        segments.push({ text: current, groupWeight: 1.0 });
                    }
                    
                    // Start new group
                    inGroup = true;
                    currentWeight = parseFloat(match[1]);
                    current = ''; // Reset buffer for group content
                    i += match[0].length;
                    continue;
                }
            } else {
                // Inside group: Check for auto-termination (whitespace + number::)
                // This signals start of NEXT group, implying end of current
                const lookahead = text.slice(i);
                const nextGroupMatch = lookahead.match(/^\s+(-?\d+(?:\.\d+)?)::/);
                
                if (nextGroupMatch) {
                    // Finish current group
                    if (current.trim()) {
                        segments.push({ text: current, groupWeight: currentWeight });
                    }
                    // Reset for next loop to catch the new group
                    current = '';
                    inGroup = false;
                    // Do NOT increment i, let the !inGroup check handle the new group
                    continue;
                }

                // Check for explicit terminator ::
                if (text[i] === ':' && text[i+1] === ':') {
                    if (current.trim()) {
                        segments.push({ text: current, groupWeight: currentWeight });
                    }
                    current = '';
                    inGroup = false;
                    currentWeight = 1.0;
                    i += 2;
                    continue;
                }
            }

            // Accumulate text
            current += text[i];
            i++;
        }

        // Push remaining buffer
        if (current.trim()) {
            segments.push({ text: current, groupWeight: inGroup ? currentWeight : 1.0 });
        }

        return segments;
    }

    /**
     * Parse bracket syntax inside a segment
     */
    parseBrackets(text) {
        let cleanText = text;
        let multiplier = 1.0;

        while (true) {
            if (cleanText.startsWith('{') && cleanText.endsWith('}')) {
                multiplier *= 1.05;
                cleanText = cleanText.substring(1, cleanText.length - 1).trim();
            } else if (cleanText.startsWith('[') && cleanText.endsWith(']')) {
                multiplier *= (1 / 1.05); // NovelAI official weaken = 1/strengthen
                cleanText = cleanText.substring(1, cleanText.length - 1).trim();
            } else {
                break;
            }
        }

        return { cleanText, multiplier };
    }

    /**
     * Helper to create analysis object for a piece of text
     */
    createAnalysisObject(text, groupWeight, localMultiplier, isKnownTag, tagSource, tagCount, tokenizer, animeTags, furryTags, suggestions = [], isNovelAITrained = false) {
        const totalAttention = parseFloat((groupWeight * localMultiplier).toFixed(3));
        
        // Tokenizer Analysis
        const tokenData = tokenizer.getTokenData(text);
        const validTokens = tokenData.filter(t => !t.isSpecial && t.text !== '</s>');
        
        const avgStrength = validTokens.length > 0 
            ? validTokens.reduce((sum, t) => sum + t.strength, 0) / validTokens.length 
            : 0;
        
        // Calculate Mass
        const effectiveTokenCount = Math.max(1, validTokens.length);
        const attentionMass = parseFloat((effectiveTokenCount * totalAttention).toFixed(2));

        // Effectiveness Calculation
        let effectivenessScore = 0;
        let suggestion = '';
        let status = 'unknown';

        if (isKnownTag) {
            const countBoost = Math.min(tagCount, 100000) / 500000;
            effectivenessScore = 0.8 + countBoost;

            let tagInfo = ` (${tagSource})`;
            if (tagCount > 0) {
                tagInfo += `. usage: ${tagCount}`;
            }

            if (totalAttention > 1.1) {
                effectivenessScore = Math.min(1.0, effectivenessScore * 1.1);
                suggestion = `Heavily emphasized known tag${tagInfo} (x${totalAttention}).`;
            } else if (totalAttention < 0.9) {
                effectivenessScore *= totalAttention;
                suggestion = `De-emphasized known tag${tagInfo} (x${totalAttention}).`;
            } else {
                suggestion = `Known tag${tagInfo}.`;
            }
            status = 'effective';
            
        } else {
            // Check for filler words
            const fillerWords = /^(a|an|and|the|in|on|at|to|for|of|with|by)$/i;
            if (fillerWords.test(text)) {
                 effectivenessScore = 0.1;
                 status = 'filler';
                 suggestion = 'Filler word. Does not contribute to tag matching.';
            } else if (avgStrength > 7) {
                effectivenessScore = 0.6;
                status = 'specific';
                suggestion = 'Contains specific/rare tokens.';
            } else if (avgStrength < 3) {
                effectivenessScore = 0.2;
                status = 'weak';
                suggestion = 'Common words/filler.';
            } else {
                effectivenessScore = 0.4;
                status = 'average';
                const hasSuggestions = suggestions && ((suggestions.api && suggestions.api.length > 0) || (suggestions.database && suggestions.database.length > 0));
                suggestion = hasSuggestions ? 'Partial match with suggestions.' : 'Unknown phrase.';
            }

            // Suggest partial matches if available (skip for filler words)
            if (suggestions.length > 0 && status !== 'filler') {
                 const topMatch = suggestions[0];
                 suggestion += ` Did you mean: "${topMatch.tag}"?`;
                 // If very close match, boost score slightly so user sees it
                 if (topMatch.similarity > 0.8) {
                     effectivenessScore = Math.max(effectivenessScore, 0.5);
                 }
            }

            if (totalAttention > 1) {
                if (status === 'specific') {
                    effectivenessScore = Math.min(0.95, effectivenessScore * 1.2);
                    suggestion += ` Emphasized specific concept (x${totalAttention}).`;
                } else {
                    suggestion += ` Emphasized but weak/unknown (x${totalAttention}).`;
                }
            } else if (totalAttention < 1) {
                effectivenessScore *= totalAttention;
                suggestion += ` De-emphasized (x${totalAttention}).`;
            }
        }

        // Handle the new separated suggestion structure
        let processedsuggestions = [];
        if (suggestions && suggestions.api && suggestions.database) {
            // Return the two arrays directly (much cleaner!)
            // The suggestions are already sorted in getsuggestions, so maintain that order
            // unless we need to re-sort by relevance
            const sortByScore = (a, b) => {
                // Check if this is from a search with multiple words
                const hasMultipleWords = text.includes(' ');

                if (hasMultipleWords) {
                    // For multi-word searches, prioritize results containing all words
                    const searchWords = text.toLowerCase().split(/\s+/);
                    const aContainsAllWords = searchWords.every(word =>
                        a.tag.toLowerCase().includes(word) ||
                        a.tag.toLowerCase().replace(/-/g, ' ').includes(word)
                    ) ? 1 : 0;
                    const bContainsAllWords = searchWords.every(word =>
                        b.tag.toLowerCase().includes(word) ||
                        b.tag.toLowerCase().replace(/-/g, ' ').includes(word)
                    ) ? 1 : 0;

                    if (aContainsAllWords !== bContainsAllWords) {
                        return bContainsAllWords - aContainsAllWords;
                    }
                }

                // Fall back to match percent + usage
                const aScore = (a.matchPercent) + Math.log(Math.max(1, a.usage || 0));
                const bScore = (b.matchPercent) + Math.log(Math.max(1, b.usage || 0));
                return bScore - aScore;
            };

            processedsuggestions = {
                api: suggestions.api.map(m => {
                    // Handle both raw data (count/similarity) and processed data (usage/matchPercent)
                    const usage = m.usage !== undefined ? m.usage : (m.count || 0);
                    const matchPercent = m.matchPercent !== undefined ? m.matchPercent : (isNaN(m.similarity) ? 0 : Math.round(m.similarity * 100));
                    return {
                        tag: m.tag,
                        usage: usage,
                        matchPercent: matchPercent,
                        source: m.source,
                        listType: 'api'
                    };
                }).sort(sortByScore),
                database: suggestions.database.map(m => {
                    // Handle both raw data (count/similarity) and processed data (usage/matchPercent)
                    const usage = m.usage !== undefined ? m.usage : (m.count || 0);
                    const matchPercent = m.matchPercent !== undefined ? m.matchPercent : (isNaN(m.similarity) ? 0 : Math.round(m.similarity * 100));
                    return {
                        tag: m.tag,
                        usage: usage,
                        matchPercent: matchPercent,
                        source: m.source,
                        listType: 'database'
                    };
                }).sort(sortByScore)
            };
        }

        return {
            text: text,
            cleanText: text,
            groupWeight,
            localMultiplier,
            totalAttention,
            attentionMass,
            status,
            isKnownTag,
            tagSource,
            tagCount,
            isNovelAITrained: isNovelAITrained || false,
            tokenCount: tokenData.length,
            effectiveTokenCount,
            avgTokenStrength: parseFloat(avgStrength.toFixed(2)),
            effectivenessScore: parseFloat(effectivenessScore.toFixed(2)),
            suggestion,
            suggestions: processedsuggestions,
            tokens: validTokens.map(t => ({
                text: t.text,
                strength: t.strength
            }))
        };
    }

    /**
     * Analyze a single segment using greedy search for tags mixed with description
     * @param {string} rawText - Text potentially containing brackets
     * @param {number} groupWeight - Base weight inherited from parent group
     */
    async analyzeSegmentGreedy(rawText, groupWeight, tokenizer, animeTags, furryTags) {
        // 1. Parse local bracket modifiers first (apply to the whole segment)
        const { cleanText, multiplier } = this.parseBrackets(rawText);
        
        // Helper to get partial matches for unknown text with usage counts
        const getsuggestions = async (text) => {
            // Skip search for filler words
            const fillerWords = /^(a|an|and|the|in|on|at|to|for|of|with|by)$/i;
            if (fillerWords.test(text)) {
                return { api: [], database: [] };
            }

            // Check SQLite cache first
            const db = this.globalResources.getTagSearchDatabase();
            if (db && db.getCachedProcessedResults) {
                const cachedResults = db.getCachedProcessedResults(text);
                if (cachedResults) {
                    console.log(`💾 Using SQLite cached suggestions for: "${text}"`);
                    return cachedResults;
                }
            }

            console.log(`🔍 Searching for suggestions: "${text}"`);

            // Use the existing search system like everyone else in the project
            const searchService = this.globalResources.getSearchService();
            const model = 'nai-diffusion-4-5-full';
            const results = await searchService.performTagSearch(text, model);

            console.log(`📊 Found ${results.length} suggestions`);

            // Separate results into two distinct lists with deduplication
            const apiMap = new Map();
            const dbMap = new Map();

            results.forEach(tag => {
                const isAPI = tag.model && tag.model.includes('nai-diffusion');
                const source = tag.model === 'anime-local' ? 'danbooru' :
                              tag.model === 'furry-local' ? 'e621' :
                              'novelai';

                const result = {
                    tag: tag.tag || tag.name,
                    count: tag.count || tag.n_count || 0,
                    similarity: (tag.confidence && !isNaN(tag.confidence)) ? tag.confidence / 100 : 0.8,
                    source: source
                };

                const key = result.tag.toLowerCase();
                if (isAPI) {
                    if (!apiMap.has(key) || (apiMap.get(key).count < result.count)) {
                        apiMap.set(key, result);
                    }
                } else {
                    if (!dbMap.has(key) || (dbMap.get(key).count < result.count)) {
                        dbMap.set(key, result);
                    }
                }
            });

            const apiResults = Array.from(apiMap.values());
            const databaseResults = Array.from(dbMap.values());


            // Sort each list by score
            // Sort by relevance: results containing search terms first, then similarity + popularity
            const sortByScore = (a, b) => {
                const searchPhrase = text.toLowerCase();
                const searchWords = searchPhrase.split(/\s+/);

                // Check if result contains all search words (allowing for hyphens)
                const aContainsAllWords = searchWords.every(word =>
                    a.tag.toLowerCase().includes(word) ||
                    a.tag.toLowerCase().replace(/-/g, ' ').includes(word)
                ) ? 1 : 0;
                const bContainsAllWords = searchWords.every(word =>
                    b.tag.toLowerCase().includes(word) ||
                    b.tag.toLowerCase().replace(/-/g, ' ').includes(word)
                ) ? 1 : 0;


                if (aContainsAllWords !== bContainsAllWords) {
                    return bContainsAllWords - aContainsAllWords; // Results with all search words first
                }

                // If both or neither contain all words, sort by similarity + log popularity
                const aScore = (a.similarity * 100) + Math.log(Math.max(1, a.count || 0));
                const bScore = (b.similarity * 100) + Math.log(Math.max(1, b.count || 0));
                return bScore - aScore;
            };

            const finalResults = {
                api: apiResults.sort(sortByScore),
                database: databaseResults.sort(sortByScore)
            };

            // Cache the processed results in SQLite
            const tagDb = this.globalResources.getTagSearchDatabase();
            if (tagDb && tagDb.setCachedProcessedResults) {
                tagDb.setCachedProcessedResults(text, finalResults);
            }

            return finalResults;
        };

        // If the text is short or is a known tag exactly, return simple analysis
        if (animeTags.getTagInfo(cleanText) || furryTags.getTagInfo(cleanText)) {
             const animeTag = animeTags.getTagInfo(cleanText);
             const furryTag = furryTags.getTagInfo(cleanText);
             let isKnownTag = !!(animeTag || furryTag);
             let tagSource = animeTag ? 'anime' : (furryTag ? 'furry' : null);
             let tagCount = animeTag ? (animeTag.n_count || animeTag.d_count || 0) : (furryTag ? (furryTag.e_count || 0) : 0);
            let isNovelAITrained = false;

            if (animeTag) {
                isNovelAITrained = animeTag.n_count > 0;
            } else if (furryTag) {
                isNovelAITrained = furryTag.n_count > 0;
            }

             return this.createAnalysisObject(cleanText, groupWeight, multiplier, isKnownTag, tagSource, tagCount, tokenizer, animeTags, furryTags, [], isNovelAITrained);
        }

        // Preprocess: remove parentheses for searching (treat content as regular text)
        const searchText = cleanText.replace(/[()]/g, '');
        const words = searchText.split(/\s+/);
        const results = [];
        let i = 0;
        const MAX_PHRASE_LENGTH = 8; 

        while (i < words.length) {
            // Try to find the longest mergeable phrase by testing combinations
            let bestMergeLength = 1;
            let bestMergedPhrase = words[i];
            let bestSuggestions = await getsuggestions(words[i]);

            // Test 2-word combinations first (most common case)
            if (i < words.length - 1) {
                const twoWordPhrase = words.slice(i, i + 2).join(' ');
                const twoWordSuggestions = await getsuggestions(twoWordPhrase);
                const allTwoWordSuggestions = [
                    ...(twoWordSuggestions.api || []),
                    ...(twoWordSuggestions.database || [])
                ];

                // Check if any suggestion contains this exact 2-word sequence
                const hasTwoWordMatch = allTwoWordSuggestions.some(suggestion =>
                    suggestion.tag.toLowerCase().includes(twoWordPhrase.toLowerCase())
                );

                if (hasTwoWordMatch) {
                    bestMergeLength = 2;
                    bestMergedPhrase = twoWordPhrase;
                    bestSuggestions = twoWordSuggestions;
                }
            }

            // Test longer combinations if 2-word didn't work - but be smarter about it
            if (bestMergeLength === 1 && i < words.length - 2) {
                // First check if the single word suggestions indicate potential longer matches
                const allSingleSuggestions = [
                    ...(bestSuggestions.api || []),
                    ...(bestSuggestions.database || [])
                ];

                // Look for suggestions that contain the current word followed by next words
                let foundLongerMatch = false;
                for (let len = 3; len <= Math.min(5, words.length - i); len++) {
                    const candidatePhrase = words.slice(i, i + len).join(' ');

                    // Check if any single-word suggestion contains this longer candidate
                    const hasLongerMatch = allSingleSuggestions.some(suggestion =>
                        suggestion.tag.toLowerCase().includes(candidatePhrase.toLowerCase())
                    );

                    if (hasLongerMatch) {
                        // Found a potential match - make the API call to confirm
                        const phraseSuggestions = await getsuggestions(candidatePhrase);
                        const allPhraseSuggestions = [
                            ...(phraseSuggestions.api || []),
                            ...(phraseSuggestions.database || [])
                        ];

                        // Double-check that the suggestions actually contain the phrase
                        const confirmedMatch = allPhraseSuggestions.some(suggestion =>
                            suggestion.tag.toLowerCase().includes(candidatePhrase.toLowerCase())
                        );

                        if (confirmedMatch) {
                            bestMergeLength = len;
                            bestMergedPhrase = candidatePhrase;
                            bestSuggestions = phraseSuggestions;
                            foundLongerMatch = true;
                            break; // Take the first confirmed match
                        }
                    }
                }

                // If no longer matches found in single word suggestions, don't bother with API calls
                if (!foundLongerMatch) {
                    console.log(`🚀 Skipping longer combinations for "${words[i]}" - no potential matches found`);
                }
            }

            // Check if the merged phrase is actually a known tag
            const mergedAnimeTag = animeTags.getTagInfo(bestMergedPhrase);
            const mergedFurryTag = furryTags.getTagInfo(bestMergedPhrase);

            if (mergedAnimeTag || mergedFurryTag) {
                // It's a known tag - use tag info
                let tagSource = mergedAnimeTag ? 'anime' : 'furry';
                let tagCount = mergedAnimeTag ? (mergedAnimeTag.n_count || mergedAnimeTag.d_count || 0) : (mergedFurryTag ? (mergedFurryTag.e_count || 0) : 0);
                let isNovelAITrained = false;

                if (mergedAnimeTag) {
                    isNovelAITrained = mergedAnimeTag.n_count > 0;
                } else if (mergedFurryTag) {
                    isNovelAITrained = mergedFurryTag.n_count > 0;
                }

                results.push(this.createAnalysisObject(
                    bestMergedPhrase, groupWeight, multiplier, true, tagSource, tagCount, tokenizer, animeTags, furryTags, [], isNovelAITrained
                ));
            } else {
                // Not a known tag - use the merged phrase with suggestions
                results.push(this.createAnalysisObject(
                    bestMergedPhrase, groupWeight, multiplier, false, null, 0, tokenizer, animeTags, furryTags, bestSuggestions, false
                ));
            }

            i += bestMergeLength;
        }

        return results.length === 1 ? results[0] : results;
    }
}

module.exports = PromptLogitAnalyzer;