// Global (shared, not per-user) autofill/SmartText ranking config — mirrors
// modules/autofillRankingSettings.js. Loaded via WS init step, live-updated via
// autofill_ranking_updated broadcast. Read by:
//   - public/scripts/comp/autocompleteUtils.js (calculateComprehensiveRanking + sort)
//   - public/scripts/comp/autofillConfigDsapApplet.js (DSAP-SMF admin applet)

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
    serverBase: {
        exactTitle: 600, variantTitle: 580, phraseExactBase: 120, phraseExactPerToken: 20,
        phrasePrefix: 150, wordSeqExact: 100, wordExact: 95, fuzzyMin: 55, fuzzyMax: 95
    },
    serverBonus: {
        usageDivisor: 1500, usageCap: 60, trainingDivisor: 400, trainingCap: 220,
        usageCountEWeight: 4, usageCountNWeight: 12, novelCap: 10000
    },
    serverCategory: {
        uncategorizedMultiWordPenalty: 80, uncategorizedSingleWordPenalty: 320,
        uncategorizedLowUsagePenalty: 200, uncategorizedLowUsageThreshold: 5000,
        uncategorizedLowTrainingThreshold: 1500, generalMetaNoGroupPenalty: 90,
        generalMetaLowUsagePenalty: 60, generalMetaLowUsageThreshold: 10000,
        generalMetaLowTrainingThreshold: 2000
    },
    tiers: {
        exactMatchTier: 4, prefixMatchTier: 3, strongCoverageTier: 2, partialCoverageTier: 1,
        strongCoverageThreshold: 90, strongCoveragePartialThreshold: 55, partialCoverageThreshold: 35,
        allTokensPartialThreshold: 40, singleTokenMatchThreshold: 45, minTier: 1, minCoverage: 35,
        tokenScores: {
            exactScore: 100, prefixScore: 90, stemStrongScore: 88, stemMediumScore: 75,
            stemWeakScore: 65, stemMinScore: 55, containsScore: 55, levenshteinThreshold: 0.72,
            levenshteinBaseMult: 65, levenshteinCloseMult: 90, levenshteinNearMult: 80
        },
        coverageWeights: {
            firstTokenWeight: 1.4, lastTokenWeight: 1.0, middleTokenWeight: 1.1,
            sameLengthBonus: 8, fewerTitleTokensPenalty: 12
        }
    },
    clientTierBonus: {
        tier4: 1200, tier3: 700, tier2: 550, tier1: 120,
        tier3OvershootPenalty: 4, tier2OvershootPenalty: 3, tier1OvershootPenalty: 2,
        coverageMult: 2.5, textRelevanceMult: 2, apiConfidenceNoMatchMult: 3.5,
        apiConfidenceMatchMult: 0.5, tagScoreMult: 1.2, frequencyMult: 0.05, frequencyCap: 8
    },
    clientNonTag: {
        exactMatchBonus: 1000, prefixMatchBonus: 500, containsBonus: 200, similarityMult: 2,
        characterBonus: 50, characterSimilarityMult: 0.5, textReplacementBestBonus: 300,
        textReplacementExactPlaceholderBonus: 400, dynamicPlaceholderBonus: 40,
        frequencyMult: 0.1, frequencyCap: 10
    },
    typeOrder: AUTOFILL_TYPE_KEYS.slice(),
    typeWeights: {
        character: 100, textReplacement: 90, tagNovelai: 80, tagDanbooru: 70,
        tagE621: 60, dynamicPlaceholder: 50, spellcheck: 110
    }
};

let autofillRankingConfig = JSON.parse(JSON.stringify(DEFAULT_AUTOFILL_RANKING));

function deepMergeAutofillRankingGroup(target, source) {
    if (!source || typeof source !== 'object') return target;
    const out = { ...target };
    for (const key of Object.keys(target)) {
        if (!(key in source)) continue;
        if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
            out[key] = deepMergeAutofillRankingGroup(target[key], source[key]);
        } else {
            const n = Number(source[key]);
            out[key] = Number.isFinite(n) ? n : target[key];
        }
    }
    return out;
}

function normalizeAutofillRankingClient(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const defaults = DEFAULT_AUTOFILL_RANKING;
    const out = {
        rankingVersion: Number.isFinite(Number(base.rankingVersion)) ? Number(base.rankingVersion) : defaults.rankingVersion,
        serverBase: deepMergeAutofillRankingGroup(defaults.serverBase, base.serverBase),
        serverBonus: deepMergeAutofillRankingGroup(defaults.serverBonus, base.serverBonus),
        serverCategory: deepMergeAutofillRankingGroup(defaults.serverCategory, base.serverCategory),
        tiers: deepMergeAutofillRankingGroup(defaults.tiers, base.tiers),
        clientTierBonus: deepMergeAutofillRankingGroup(defaults.clientTierBonus, base.clientTierBonus),
        clientNonTag: deepMergeAutofillRankingGroup(defaults.clientNonTag, base.clientNonTag),
        typeOrder: Array.isArray(base.typeOrder) ? base.typeOrder.filter(k => AUTOFILL_TYPE_KEYS.includes(k)) : defaults.typeOrder.slice(),
        typeWeights: deepMergeAutofillRankingGroup(defaults.typeWeights, base.typeWeights)
    };
    for (const key of AUTOFILL_TYPE_KEYS) {
        if (!out.typeOrder.includes(key)) out.typeOrder.push(key);
    }
    return out;
}

function getAutofillRanking() {
    return autofillRankingConfig;
}

// clearAutofillRankingScoreCache: public/scripts/comp/autocompleteUtils.js
function applyAutofillRankingToClient(raw) {
    autofillRankingConfig = normalizeAutofillRankingClient(raw);
    clearAutofillRankingScoreCache();
    return autofillRankingConfig;
}

async function loadAutofillRankingFromServer() {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        return applyAutofillRankingToClient(null);
    }
    try {
        const resp = await window.wsClient.getAutofillRanking();
        const ranking = resp?.ranking || resp?.data?.ranking;
        return applyAutofillRankingToClient(ranking);
    } catch (err) {
        console.error('loadAutofillRankingFromServer:', err);
        return applyAutofillRankingToClient(null);
    }
}

function initAutofillRankingBroadcastListener() {
    if (!window.wsClient || typeof window.wsClient.on !== 'function') return;
    window.wsClient.on('autofill_ranking_updated', (msg) => {
        const ranking = msg?.data?.ranking || msg?.ranking;
        if (ranking) applyAutofillRankingToClient(ranking);
    });
}

window.getAutofillRanking = getAutofillRanking;
window.loadAutofillRankingFromServer = loadAutofillRankingFromServer;

window.wsClient.registerInitStep(39, 'Loading autofill ranking config', async () => {
    initAutofillRankingBroadcastListener();
    await loadAutofillRankingFromServer();
});
