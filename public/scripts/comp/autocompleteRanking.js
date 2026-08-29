/**
 * Autofill ranking, string-similarity, and tag-result merge/dedupe.
 * Incremental extract from autocompleteUtils.js (Yozora #22).
 *
 * Callers remain in public/scripts/comp/autocompleteUtils.js
 * (assembleRankedAutofillResults, prepareTagResultsForDisplay, …).
 * Tag accessors (isTagResult, getTagScore, getTagDisplayLabel, …) stay there.
 * getPreferredLocalResult: public/scripts/comp/autocompleteUtils.js
 * getAutofillRanking: public/scripts/comp/autofillRankingConfig.js
 */

// Calculate comprehensive ranking for search results.
// getAutofillRanking: public/scripts/comp/autofillRankingConfig.js
// Pass withBreakdown=true (DSAP-SMF Autofill Ranking Test tab) to get a score component breakdown.
function calculateComprehensiveRanking(result, query, bestTextReplacement = null, withBreakdown = false) {
    const rankingCfg = getAutofillRanking();
    const resultType = result.type || '';
    const resultName = isTagResult(result)
        ? getTagDisplayLabel(result)
        : (result.name || result.placeholder || '');
    const queryLower = query.toLowerCase();
    const nameLower = resultName.toLowerCase();
    const typeKey = getAutofillTypeKey(result);
    const typeWeight = rankingCfg.typeWeights[typeKey] || 0;

    let score = 0;
    let isExactMatch = false;
    let isPrefixMatch = false;
    let textMatchTier = 0;
    const breakdown = withBreakdown ? { typeKey, typeWeight } : null;

    if (isTagResult(result)) {
        const cfg = rankingCfg.clientTierBonus;
        const matchInfo = resolveTagTextMatchInfo(result, query);
        textMatchTier = matchInfo.tier;
        isExactMatch = matchInfo.isExactMatch;
        isPrefixMatch = matchInfo.isPrefixMatch;

        const textRelevance = result.predictionaryScore ||
            getTagTextRelevanceScore(query, resultName);

        const queryNormLen = normalizeTagSearchText(query).length;
        const nameNormLen = normalizeTagSearchText(resultName).length;

        let tierScore = 0;
        if (matchInfo.tier === 4) {
            tierScore = cfg.tier4;
        } else if (matchInfo.tier === 3) {
            tierScore = cfg.tier3 - Math.max(0, nameNormLen - queryNormLen - 1) * cfg.tier3OvershootPenalty;
        } else if (matchInfo.tier === 2) {
            tierScore = cfg.tier2 - Math.max(0, nameNormLen - queryNormLen - 1) * cfg.tier2OvershootPenalty;
        } else if (matchInfo.tier === 1) {
            tierScore = cfg.tier1 - Math.max(0, nameNormLen - queryNormLen) * cfg.tier1OvershootPenalty;
        }
        score += tierScore;

        const coverageScore = matchInfo.matchCoverage ? matchInfo.matchCoverage * cfg.coverageMult : 0;
        score += coverageScore;

        const textRelevanceScore = textRelevance * cfg.textRelevanceMult;
        score += textRelevanceScore;

        const apiConfidence = getRawApiTagConfidence(result);
        let apiConfidenceScore = 0;
        let tagScoreScore = 0;
        if (matchInfo.tier === 0 && apiConfidence > 0) {
            apiConfidenceScore = apiConfidence * cfg.apiConfidenceNoMatchMult;
            score += apiConfidenceScore;
        } else {
            tagScoreScore = getTagScore(result) * cfg.tagScoreMult;
            score += tagScoreScore;
            if (apiConfidence > 0) {
                apiConfidenceScore = apiConfidence * cfg.apiConfidenceMatchMult;
                score += apiConfidenceScore;
            }
        }

        const frequency = getTagNCount(result) || result.frequency || result.n || 0;
        const frequencyScore = Math.min(frequency * cfg.frequencyMult, cfg.frequencyCap);
        score += frequencyScore;

        score += typeWeight;

        if (breakdown) {
            Object.assign(breakdown, {
                matchTier: matchInfo.tier,
                matchCoverage: matchInfo.matchCoverage,
                tierScore, coverageScore, textRelevanceScore, apiConfidenceScore, tagScoreScore, frequencyScore
            });
        }

        return {
            score: Math.round(score * 100) / 100,
            isExactMatch,
            isPrefixMatch,
            textMatchTier,
            breakdown
        };
    }

    const cfg = rankingCfg.clientNonTag;

    // Base score from similarity calculation (non-tag results)
    const similarityScore = result.predictionaryScore ||
        result.enhancedSimilarity ||
        result.matchScore ||
        calculateStringSimilarity(query, resultName);

    // Exact match bonus (highest priority)
    if (nameLower === queryLower) {
        score += cfg.exactMatchBonus;
        isExactMatch = true;
    }

    // Prefix match bonus (second highest priority)
    if (!isExactMatch && nameLower.startsWith(queryLower)) {
        score += cfg.prefixMatchBonus;
        isPrefixMatch = true;
    }

    // Contains query bonus
    if (!isExactMatch && !isPrefixMatch && nameLower.includes(queryLower)) {
        score += cfg.containsBonus;
    }

    // Add similarity score (weighted)
    const similarityBonus = similarityScore * cfg.similarityMult;
    score += similarityBonus;

    // Type-specific adjustments
    let typeBonus = 0;
    switch (resultType) {
        case 'character':
        case 'characterTag':
            typeBonus += cfg.characterBonus;
            if (result.similarity) {
                typeBonus += result.similarity * cfg.characterSimilarityMult;
            }
            break;

        case 'textReplacement':
            if (bestTextReplacement &&
                resultName === bestTextReplacement.name &&
                result.placeholder === bestTextReplacement.placeholder) {
                typeBonus += cfg.textReplacementBestBonus;
            }
            if (result.placeholder && result.placeholder.toLowerCase() === queryLower) {
                typeBonus += cfg.textReplacementExactPlaceholderBonus;
            }
            break;

        case 'dynamicPlaceholder':
            typeBonus += cfg.dynamicPlaceholderBonus;
            break;
    }
    score += typeBonus;

    const frequency = getTagNCount(result) || result.frequency || result.n || 0;
    const frequencyScore = Math.min(frequency * cfg.frequencyMult, cfg.frequencyCap);
    score += frequencyScore;

    score += typeWeight;

    if (breakdown) {
        Object.assign(breakdown, { similarityScore: similarityBonus, typeBonus, frequencyScore });
    }

    return {
        score: Math.round(score * 100) / 100,
        isExactMatch,
        isPrefixMatch,
        textMatchTier,
        breakdown
    };
}

function getCachedComprehensiveRanking(result, query, bestTextReplacement = null) {
    if (!result) {
        return { score: 0, isExactMatch: false, isPrefixMatch: false, textMatchTier: 0 };
    }
    // getAutofillRanking: public/scripts/comp/autofillRankingConfig.js — version keeps cache
    // entries fresh across live ranking config saves without a separate invalidation pass.
    const cacheKey = (query || '') + '|' + (bestTextReplacement?.name || '') + '|' + getAutofillRanking().rankingVersion;
    if (result._rankCacheKey === cacheKey && result._rankCache) {
        return result._rankCache;
    }
    const ranking = calculateComprehensiveRanking(result, query, bestTextReplacement);
    result._rankCacheKey = cacheKey;
    result._rankCache = ranking;
    return ranking;
}

// Called by public/scripts/comp/autofillRankingConfig.js after a live ranking config update.
// Per-result caches already key on rankingVersion (see getCachedComprehensiveRanking above),
// so this is a light hook kept for future cache strategies / explicit invalidation needs.
function clearAutofillRankingScoreCache() {
    /* no-op: rankingVersion is embedded in the cache key */
}

// Calculate string similarity score for better ranking
function calculateStringSimilarity(query, text) {
    if (!query || !text) return 0;

    const queryNorm = normalizeTagSearchText(query);
    const textNorm = normalizeTagSearchText(text);
    if (!queryNorm || !textNorm) return 0;

    if (textNorm === queryNorm) return 100;
    if (textNorm.startsWith(queryNorm)) return 85;
    if (textNorm.includes(queryNorm)) return 60;

    const queryWords = tokenizeTagSearchText(query);
    const textWords = tokenizeTagSearchText(text);
    if (queryWords.length === 0) return 0;

    let matchScore = 0;
    const totalWords = queryWords.length;

    for (const queryWord of queryWords) {
        let bestWordScore = 0;
        for (const textWord of textWords) {
            bestWordScore = Math.max(bestWordScore, getTokenMatchScore(queryWord, textWord));
        }
        matchScore += bestWordScore;
    }

    return totalWords > 0 ? matchScore / totalWords : 0;
}

// Get the best text replacement match for the current query
function getBestTextReplacementMatch(textReplacements, query) {
    if (!textReplacements || textReplacements.length === 0 || !query) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const replacement of textReplacements) {
        // Use existing match score if available, otherwise calculate it
        const totalScore = replacement.matchScore || calculateStringSimilarity(query, replacement.name);

        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestMatch = { ...replacement, matchScore: totalScore };
        }
    }

    // Only return a best match if it has a high enough score (>= 70)
    // This prevents mediocre matches from appearing at the top
    return bestMatch && bestMatch.matchScore >= 70 ? bestMatch : null;
}

// Enhance character results with string similarity scores
function enhanceCharacterResultsWithStringSimilarity(results, query) {
    if (!results || !Array.isArray(results) || !query) return results;

    return results.map(result => {
        if (result.type === 'character' || result.type === 'characterTag') {
            const stringScore = calculateStringSimilarity(query, result.name);
            return {
                ...result,
                stringSimilarity: stringScore,
                // More balanced weighting: 50% string similarity, 50% existing similarity
                enhancedSimilarity: (stringScore * 0.5) + ((result.similarity || 0) * 0.5)
            };
        }
        return result;
    });
}

// Debug function to log ranking information
function logRankingDebug(results, query) {
    if (!results || results.length === 0) return;
    const typeCounts = {};
    results.forEach(result => {
        typeCounts[result.type] = (typeCounts[result.type] || 0) + 1;
    });

    // Log top 5 results with their scores
    const topResults = results.slice(0, 5);
    topResults.forEach((result, index) => {
        let score = 'N/A';
        if (isTagResult(result)) {
            const enhancedConfidence = getTagScore(result);
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `enhanced: ${enhancedConfidence.toFixed(1)}, score: ${result.score || result.confidence || 0}, predictionary: ${predictionaryScore}`;
        } else if (result.type === 'character' || result.type === 'characterTag') {
            const stringScore = result.stringSimilarity || calculateStringSimilarity(query, result.name);
            const enhancedScore = result.enhancedSimilarity || (stringScore * 0.5) + ((result.similarity || 0) * 0.5);
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `enhanced: ${enhancedScore.toFixed(1)}, string: ${stringScore.toFixed(1)}, similarity: ${result.similarity || 0}, predictionary: ${predictionaryScore}`;
        } else if (result.type === 'textReplacement') {
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `matchScore: ${result.matchScore || 0}, predictionary: ${predictionaryScore}`;
        }
    });
}

// Deduplicate results from different services
function deduplicateResults(results) {
    if (!results || results.length === 0) return results;

    const tagMap = new Map(); // Map of tag name to best result
    const characterMap = new Map(); // Map of character name to best result
    const textReplacementMap = new Map(); // Map of text replacement key to best result
    const finalResults = [];

    for (const result of results) {
        if (isTagResult(result)) {
            const tagName = getTagDedupeKey(result);

            if (tagMap.has(tagName)) {
                // We have a duplicate tag - merge them intelligently
                const existingResult = tagMap.get(tagName);
                const mergedResult = mergeTagResults(existingResult, result);
                tagMap.set(tagName, mergedResult);
            } else {
                // First occurrence of this tag
                tagMap.set(tagName, result);
            }
        } else if (isCharacterResult(result)) {
            const characterName = result.name;

            if (characterMap.has(characterName)) {
                // We have a duplicate character - keep the one with better similarity
                const existingResult = characterMap.get(characterName);
                const existingScore = existingResult.enhancedSimilarity || existingResult.similarity || 0;
                const currentScore = result.enhancedSimilarity || result.similarity || 0;

                if (currentScore > existingScore) {
                    characterMap.set(characterName, result);
                }
            } else {
                // First occurrence of this character
                characterMap.set(characterName, result);
            }
        } else if (result.type === 'textReplacement') {
            const replacementKey = `${result.name}:${result.placeholder}`;

            if (textReplacementMap.has(replacementKey)) {
                // We have a duplicate text replacement - keep the one with better match score
                const existingResult = textReplacementMap.get(replacementKey);
                const existingScore = existingResult.matchScore || 0;
                const currentScore = result.matchScore || 0;

                if (currentScore > existingScore) {
                    textReplacementMap.set(replacementKey, result);
                }
            } else {
                // First occurrence of this text replacement
                textReplacementMap.set(replacementKey, result);
            }
        } else {
            // Non-duplicatable results (spellcheck, etc.) - add directly
            finalResults.push(result);
        }
    }

    // Merge characters that share a name with a tag result
    for (const [characterName, characterResult] of characterMap) {
        const matchKey = getCharacterDedupeKey(characterResult);
        if (tagMap.has(matchKey)) {
            const tagResult = tagMap.get(matchKey);
            tagMap.delete(matchKey);
            characterMap.set(characterName, mergeCharacterTagResults(characterResult, tagResult));
        }
    }

    // Add all deduplicated results to final results
    for (const result of tagMap.values()) {
        finalResults.push(result);
    }
    for (const result of characterMap.values()) {
        finalResults.push(result);
    }
    for (const result of textReplacementMap.values()) {
        finalResults.push(result);
    }

    return finalResults;
}

// Merge two tag results intelligently
function mergeTagResults(result1, result2) {
    if (isDualMatchTagResult(result1) && isLocalTagResult(result2)) {
        const mergedServices = [...new Set([
            ...(result1.mergedServices || []),
            getTagServiceKey(result2)
        ])];
        return mergeTagEnhancementFields(result1, result2, {
            ...result1,
            mergedServices,
            e_count: Math.max(result1.e_count || 0, result2.e_count || 0),
            d_count: Math.max(result1.d_count || 0, result2.d_count || 0),
            n_count: result1.n_count ?? result2.n_count ?? getTagNCount(result1),
            localResult: getPreferredLocalResult(result1.localResult || result1, result2)
        });
    }
    if (isDualMatchTagResult(result2) && isLocalTagResult(result1)) {
        return mergeTagResults(result2, result1);
    }

    const isResult1Api = isApiTagResult(result1);
    const isResult2Api = isApiTagResult(result2);
    const isResult1Local = isLocalTagResult(result1);
    const isResult2Local = isLocalTagResult(result2);

    if ((isResult1Api && isResult2Local) || (isResult1Local && isResult2Api)) {
        const apiResult = isResult1Api ? result1 : result2;
        const localResult = isResult1Local ? result1 : result2;
        const mergedServices = [
            getTagServiceKey(apiResult),
            getTagServiceKey(localResult)
        ];

        return mergeTagEnhancementFields(apiResult, localResult, {
            type: 'tag',
            source: 'dual-match',
            serviceName: 'dual-match',
            id: localResult.id,
            title: localResult.title || getTagDisplayLabel(localResult) || getTagDisplayLabel(apiResult),
            name: getTagInsertName(localResult) || getTagInsertName(apiResult),
            category: localResult.category ?? apiResult.category,
            categoryName: getTagCategoryLabel(localResult) || getTagCategoryLabel(apiResult),
            d_count: localResult.d_count ?? apiResult.d_count,
            e_count: localResult.e_count ?? apiResult.e_count,
            n_count: localResult.n_count ?? getTagNCount(apiResult),
            n: localResult.n ?? apiResult.n,
            datasets: localResult.datasets || [],
            hasWiki: localResult.hasWiki,
            wikiSources: localResult.wikiSources || [],
            primaryBody: localResult.primaryBody || apiResult.primaryBody || '',
            score: Math.max(getTagScore(apiResult), getTagScore(localResult)),
            enhancedConfidence: Math.max(getTagScore(apiResult), getTagScore(localResult)),
            mergedServices,
            isDualMatch: true,
            apiResult,
            localResult
        });
    }

    if (isResult1Local && isResult2Local) {
        const preferred = getPreferredLocalResult(result1, result2);
        return mergeTagEnhancementFields(result1, result2, preferred);
    }

    const preferred = getTagScore(result2) > getTagScore(result1) ? result2 : result1;
    return mergeTagEnhancementFields(result1, result2, preferred);
}
