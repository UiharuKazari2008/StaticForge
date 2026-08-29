/**
 * Global (shared, not per-user) autofill/SmartText ranking configuration.
 * Persisted in config.autofillRanking. Read by:
 *   - modules/tag-lookup.js (server-side searchTagsAutofill + shared ranking helpers)
 *   - public/scripts/comp/autofillRankingConfig.js (client-side calculateComprehensiveRanking + sort)
 *
 * Exposes every tunable magic number used by both ranking stages so the DSAP-SMF
 * "Autofill Ranking" admin applet (autofill.dreamscape.jp) can edit them live.
 */

const AUTOFILL_TYPE_KEYS = [
    'character',
    'textReplacement',
    'tagNovelai',
    'tagDanbooru',
    'tagE621',
    'dynamicPlaceholder',
    'spellcheck'
];

const DEFAULT_AUTOFILL_RANKING = {
    rankingVersion: 1,

    // modules/tag-lookup.js searchTagsAutofill() candidate base scores
    serverBase: {
        exactTitle: 600,
        variantTitle: 580,
        phraseExactBase: 120,
        phraseExactPerToken: 20,
        phrasePrefix: 150,
        wordSeqExact: 100,
        wordExact: 95,
        fuzzyMin: 55,
        fuzzyMax: 95
    },

    // modules/tag-lookup.js getUsageCount() / getNovelTrainingCount() / searchTagsAutofill() bonuses
    serverBonus: {
        usageDivisor: 1500,
        usageCap: 60,
        trainingDivisor: 400,
        trainingCap: 220,
        usageCountEWeight: 4,
        usageCountNWeight: 12,
        novelCap: 10000
    },

    // modules/tag-lookup.js getCategoryAdjustment()
    serverCategory: {
        uncategorizedMultiWordPenalty: 80,
        uncategorizedSingleWordPenalty: 320,
        uncategorizedLowUsagePenalty: 200,
        uncategorizedLowUsageThreshold: 5000,
        uncategorizedLowTrainingThreshold: 1500,
        generalMetaNoGroupPenalty: 90,
        generalMetaLowUsagePenalty: 60,
        generalMetaLowUsageThreshold: 10000,
        generalMetaLowTrainingThreshold: 2000
    },

    // Shared match-tier / coverage / token-score constants used by both search stages
    // (modules/tag-lookup.js getQueryMatchTier/getQueryTokenCoverageScore/getTokenMatchScore
    //  and public/scripts/comp/autocompleteUtils.js client-side mirrors)
    tiers: {
        exactMatchTier: 4,
        prefixMatchTier: 3,
        strongCoverageTier: 2,
        partialCoverageTier: 1,
        strongCoverageThreshold: 90,
        strongCoveragePartialThreshold: 55,
        partialCoverageThreshold: 35,
        allTokensPartialThreshold: 40,
        singleTokenMatchThreshold: 45,
        minTier: 1,
        minCoverage: 35,
        tokenScores: {
            exactScore: 100,
            prefixScore: 90,
            stemStrongScore: 88,
            stemMediumScore: 75,
            stemWeakScore: 65,
            stemMinScore: 55,
            containsScore: 55,
            levenshteinThreshold: 0.72,
            levenshteinBaseMult: 65,
            levenshteinCloseMult: 90,
            levenshteinNearMult: 80
        },
        coverageWeights: {
            firstTokenWeight: 1.4,
            lastTokenWeight: 1.0,
            middleTokenWeight: 1.1,
            sameLengthBonus: 8,
            fewerTitleTokensPenalty: 12
        }
    },

    // public/scripts/comp/autocompleteRanking.js calculateComprehensiveRanking() — tag branch
    clientTierBonus: {
        tier4: 1200,
        tier3: 700,
        tier2: 550,
        tier1: 120,
        tier3OvershootPenalty: 4,
        tier2OvershootPenalty: 3,
        tier1OvershootPenalty: 2,
        coverageMult: 2.5,
        textRelevanceMult: 2,
        apiConfidenceNoMatchMult: 3.5,
        apiConfidenceMatchMult: 0.5,
        tagScoreMult: 1.2,
        frequencyMult: 0.05,
        frequencyCap: 8
    },

    // public/scripts/comp/autocompleteRanking.js calculateComprehensiveRanking() — non-tag branch
    clientNonTag: {
        exactMatchBonus: 1000,
        prefixMatchBonus: 500,
        containsBonus: 200,
        similarityMult: 2,
        characterBonus: 50,
        characterSimilarityMult: 0.5,
        textReplacementBestBonus: 300,
        textReplacementExactPlaceholderBonus: 400,
        dynamicPlaceholderBonus: 40,
        frequencyMult: 0.1,
        frequencyCap: 10
    },

    // Drag order (Type Ranking tab) — first = highest priority tiebreak
    typeOrder: [...AUTOFILL_TYPE_KEYS],

    // Numeric weight/points added to a result's score for its resolved type/source.
    // Per-source tag rule: when a tag matches multiple sources (d/e/n counts), the
    // source with the highest configured weight wins.
    typeWeights: {
        character: 100,
        textReplacement: 90,
        tagNovelai: 80,
        tagDanbooru: 70,
        tagE621: 60,
        dynamicPlaceholder: 50,
        spellcheck: 110
    }
};

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

// [group][key] -> [min, max]. Nested groups (tiers.tokenScores, tiers.coverageWeights)
// are flattened with a dotted key. Missing entries fall back to a generous [0, 1000000] range.
const BOUNDS = {
    serverBase: {
        exactTitle: [0, 5000], variantTitle: [0, 5000], phraseExactBase: [0, 2000],
        phraseExactPerToken: [0, 500], phrasePrefix: [0, 2000], wordSeqExact: [0, 2000],
        wordExact: [0, 2000], fuzzyMin: [0, 100], fuzzyMax: [0, 200]
    },
    serverBonus: {
        usageDivisor: [1, 1000000], usageCap: [0, 10000], trainingDivisor: [1, 1000000],
        trainingCap: [0, 10000], usageCountEWeight: [0, 100], usageCountNWeight: [0, 100],
        novelCap: [0, 10000000]
    },
    serverCategory: {
        uncategorizedMultiWordPenalty: [0, 5000], uncategorizedSingleWordPenalty: [0, 5000],
        uncategorizedLowUsagePenalty: [0, 5000], uncategorizedLowUsageThreshold: [0, 10000000],
        uncategorizedLowTrainingThreshold: [0, 10000000], generalMetaNoGroupPenalty: [0, 5000],
        generalMetaLowUsagePenalty: [0, 5000], generalMetaLowUsageThreshold: [0, 10000000],
        generalMetaLowTrainingThreshold: [0, 10000000]
    },
    tiers: {
        exactMatchTier: [0, 10], prefixMatchTier: [0, 10], strongCoverageTier: [0, 10],
        partialCoverageTier: [0, 10], strongCoverageThreshold: [0, 100], strongCoveragePartialThreshold: [0, 100],
        partialCoverageThreshold: [0, 100], allTokensPartialThreshold: [0, 100], singleTokenMatchThreshold: [0, 100],
        minTier: [0, 10], minCoverage: [0, 100],
        'tokenScores.exactScore': [0, 200], 'tokenScores.prefixScore': [0, 200], 'tokenScores.stemStrongScore': [0, 200],
        'tokenScores.stemMediumScore': [0, 200], 'tokenScores.stemWeakScore': [0, 200], 'tokenScores.stemMinScore': [0, 200],
        'tokenScores.containsScore': [0, 200], 'tokenScores.levenshteinThreshold': [0, 1],
        'tokenScores.levenshteinBaseMult': [0, 200], 'tokenScores.levenshteinCloseMult': [0, 200],
        'tokenScores.levenshteinNearMult': [0, 200],
        'coverageWeights.firstTokenWeight': [0, 10], 'coverageWeights.lastTokenWeight': [0, 10],
        'coverageWeights.middleTokenWeight': [0, 10], 'coverageWeights.sameLengthBonus': [0, 100],
        'coverageWeights.fewerTitleTokensPenalty': [0, 100]
    },
    clientTierBonus: {
        tier4: [0, 10000], tier3: [0, 10000], tier2: [0, 10000], tier1: [0, 10000],
        tier3OvershootPenalty: [0, 100], tier2OvershootPenalty: [0, 100], tier1OvershootPenalty: [0, 100],
        coverageMult: [0, 50], textRelevanceMult: [0, 50], apiConfidenceNoMatchMult: [0, 50],
        apiConfidenceMatchMult: [0, 50], tagScoreMult: [0, 50], frequencyMult: [0, 10], frequencyCap: [0, 10000]
    },
    clientNonTag: {
        exactMatchBonus: [0, 10000], prefixMatchBonus: [0, 10000], containsBonus: [0, 10000],
        similarityMult: [0, 50], characterBonus: [0, 10000], characterSimilarityMult: [0, 50],
        textReplacementBestBonus: [0, 10000], textReplacementExactPlaceholderBonus: [0, 10000],
        dynamicPlaceholderBonus: [0, 10000], frequencyMult: [0, 10], frequencyCap: [0, 10000]
    },
    typeWeights: {
        character: [0, 10000], textReplacement: [0, 10000], tagNovelai: [0, 10000],
        tagDanbooru: [0, 10000], tagE621: [0, 10000], dynamicPlaceholder: [0, 10000], spellcheck: [0, 10000]
    }
};

function normalizeGroup(groupName, rawGroup, defaultGroup) {
    const out = {};
    const bounds = BOUNDS[groupName] || {};
    for (const [key, defaultValue] of Object.entries(defaultGroup)) {
        const rawValue = isPlainObject(rawGroup) ? rawGroup[key] : undefined;
        if (isPlainObject(defaultValue)) {
            // One level of nesting (tiers.tokenScores / tiers.coverageWeights)
            const nestedOut = {};
            for (const [nestedKey, nestedDefault] of Object.entries(defaultValue)) {
                const nestedRaw = isPlainObject(rawValue) ? rawValue[nestedKey] : undefined;
                const [min, max] = bounds[`${key}.${nestedKey}`] || [0, 1000000];
                nestedOut[nestedKey] = clampNum(nestedRaw, min, max, nestedDefault);
            }
            out[key] = nestedOut;
        } else {
            const [min, max] = bounds[key] || [0, 1000000];
            out[key] = clampNum(rawValue, min, max, defaultValue);
        }
    }
    return out;
}

function normalizeTypeOrder(rawOrder) {
    const known = new Set(AUTOFILL_TYPE_KEYS);
    const out = [];
    if (Array.isArray(rawOrder)) {
        for (const key of rawOrder) {
            if (known.has(key) && !out.includes(key)) {
                out.push(key);
            }
        }
    }
    for (const key of AUTOFILL_TYPE_KEYS) {
        if (!out.includes(key)) out.push(key);
    }
    return out;
}

/**
 * Normalize a raw (possibly partial/invalid) autofillRanking config into a fully
 * populated, clamped config object. Always returns a valid object.
 */
function normalizeAutofillRanking(raw) {
    const base = isPlainObject(raw) ? raw : {};
    const version = Number(base.rankingVersion);
    return {
        rankingVersion: Number.isFinite(version) && version >= 1 ? Math.floor(version) : DEFAULT_AUTOFILL_RANKING.rankingVersion,
        serverBase: normalizeGroup('serverBase', base.serverBase, DEFAULT_AUTOFILL_RANKING.serverBase),
        serverBonus: normalizeGroup('serverBonus', base.serverBonus, DEFAULT_AUTOFILL_RANKING.serverBonus),
        serverCategory: normalizeGroup('serverCategory', base.serverCategory, DEFAULT_AUTOFILL_RANKING.serverCategory),
        tiers: normalizeGroup('tiers', base.tiers, DEFAULT_AUTOFILL_RANKING.tiers),
        clientTierBonus: normalizeGroup('clientTierBonus', base.clientTierBonus, DEFAULT_AUTOFILL_RANKING.clientTierBonus),
        clientNonTag: normalizeGroup('clientNonTag', base.clientNonTag, DEFAULT_AUTOFILL_RANKING.clientNonTag),
        typeOrder: normalizeTypeOrder(base.typeOrder),
        typeWeights: normalizeGroup('typeWeights', base.typeWeights, DEFAULT_AUTOFILL_RANKING.typeWeights)
    };
}

function mergeGroupPatch(existingGroup, patchGroup, defaultGroup) {
    if (!isPlainObject(patchGroup)) return existingGroup;
    const out = { ...existingGroup };
    for (const key of Object.keys(defaultGroup)) {
        if (!(key in patchGroup)) continue;
        if (isPlainObject(defaultGroup[key])) {
            out[key] = mergeGroupPatch(existingGroup[key], patchGroup[key], defaultGroup[key]);
        } else {
            out[key] = patchGroup[key];
        }
    }
    return out;
}

/**
 * Merge a partial patch into an existing (raw or already-normalized) config and
 * return a fully normalized/clamped result. Does not bump rankingVersion —
 * callers (the update_autofill_ranking WS handler) own version bumping.
 */
function mergeAutofillRankingPatch(existing, patch) {
    const base = normalizeAutofillRanking(existing);
    if (!isPlainObject(patch)) return base;

    const merged = {
        rankingVersion: base.rankingVersion,
        serverBase: mergeGroupPatch(base.serverBase, patch.serverBase, DEFAULT_AUTOFILL_RANKING.serverBase),
        serverBonus: mergeGroupPatch(base.serverBonus, patch.serverBonus, DEFAULT_AUTOFILL_RANKING.serverBonus),
        serverCategory: mergeGroupPatch(base.serverCategory, patch.serverCategory, DEFAULT_AUTOFILL_RANKING.serverCategory),
        tiers: mergeGroupPatch(base.tiers, patch.tiers, DEFAULT_AUTOFILL_RANKING.tiers),
        clientTierBonus: mergeGroupPatch(base.clientTierBonus, patch.clientTierBonus, DEFAULT_AUTOFILL_RANKING.clientTierBonus),
        clientNonTag: mergeGroupPatch(base.clientNonTag, patch.clientNonTag, DEFAULT_AUTOFILL_RANKING.clientNonTag),
        typeOrder: Array.isArray(patch.typeOrder) ? patch.typeOrder : base.typeOrder,
        typeWeights: mergeGroupPatch(base.typeWeights, patch.typeWeights, DEFAULT_AUTOFILL_RANKING.typeWeights)
    };
    return normalizeAutofillRanking(merged);
}

module.exports = {
    AUTOFILL_TYPE_KEYS,
    DEFAULT_AUTOFILL_RANKING,
    normalizeAutofillRanking,
    mergeAutofillRankingPatch
};
