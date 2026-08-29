/**
 * SmartText Ranking DSAP — autofill.dreamscape.jp
 * DSAP-SMF admin applet for the global (shared) autofill/SmartText ranking config
 * (config.autofillRanking, modules/autofillRankingSettings.js). Tunes the numbers used by:
 *   - modules/tag-lookup.js searchTagsAutofill (server ranking)
 *   - public/scripts/comp/autocompleteUtils.js calculateComprehensiveRanking + sort comparator (client ranking)
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js, websocket.js, autofillRankingConfig.js
 * escapeHtml / escapeHtmlAttribute: public/scripts/comp/utilities.js
 */

const AUTOFILL_DSAP_URL = 'autofill.dreamscape.jp';
const AUTOFILL_DSAP_TAB_LABELS = {
    test: 'Test',
    scoring: 'Scoring',
    typeOrder: 'Type Ranking'
};

// Scoring tab groups — rendered generically from the current ranking config so every
// magic number stays editable without hand-maintaining a field list per number.
const AUTOFILL_DSAP_SCORING_GROUPS = [
    { id: 'serverBase', label: 'Server — Base Match Scores' },
    { id: 'serverBonus', label: 'Server — Usage / Training Bonuses' },
    { id: 'serverCategory', label: 'Server — Category Penalties' },
    { id: 'tiers', label: 'Shared — Match Tiers & Coverage' },
    { id: 'clientTierBonus', label: 'Client — Tag Result Bonuses' },
    { id: 'clientNonTag', label: 'Client — Non-Tag Result Bonuses' }
];

// Plain-language explanations shown under each scoring field, mirrored to match the group/key
// (and one level of nesting for tiers.tokenScores / tiers.coverageWeights) shape of
// modules/autofillRankingSettings.js DEFAULT_AUTOFILL_RANKING. Behavior reference:
//   - modules/tag-lookup.js searchTagsAutofill, getUsageCount, getNovelTrainingCount, getCategoryAdjustment,
//     getQueryMatchTier, getQueryTokenCoverageScore, getTokenMatchScore, collectScoredFuzzyWordRows
//   - public/scripts/comp/autocompleteUtils.js calculateComprehensiveRanking
const AUTOFILL_DSAP_FIELD_DESCRIPTIONS = {
    serverBase: {
        exactTitle: 'Points awarded when the query exactly matches a tag\u2019s title \u2014 the highest-confidence server match.',
        variantTitle: 'Points when the query matches a hyphen/underscore/space variant of a tag\u2019s title (e.g. "long hair" vs "long_hair").',
        phraseExactBase: 'Base points when the entire multi-word query is found as an exact stored word sequence in a tag\u2019s title.',
        phraseExactPerToken: 'Extra points added per query word on top of the phrase-match base score.',
        phrasePrefix: 'Points when a tag\u2019s title starts with the full query phrase (prefix, not exact).',
        wordSeqExact: 'Points per individual query word found as an exact stored word sequence.',
        wordExact: 'Points per individual query word that exactly matches one of a tag\u2019s indexed words.',
        fuzzyMin: 'Minimum points awarded for a typo-tolerant (fuzzy) word match.',
        fuzzyMax: 'Maximum points awarded for a very close typo-tolerant (fuzzy) word match.'
    },
    serverBonus: {
        usageDivisor: 'Scales down a tag\u2019s Danbooru/e621 usage count before adding it as a score bonus \u2014 higher means usage matters less.',
        usageCap: 'Maximum bonus points a tag can earn from usage count alone, no matter how popular it is.',
        trainingDivisor: 'Scales down a tag\u2019s NovelAI training count before adding it as a score bonus.',
        trainingCap: 'Maximum bonus points a tag can earn from NovelAI training count alone.',
        usageCountEWeight: 'Multiplier applied to the e621 post count when computing a tag\u2019s overall usage count (used for sort tie-breaks, category penalties, and the min-use-count filter).',
        usageCountNWeight: 'Multiplier applied to the NovelAI training count when computing a tag\u2019s overall usage count (same role as the e621 weight above).',
        novelCap: 'Maximum NovelAI training count considered before weighting, so extremely high-count tags don\u2019t dominate usage comparisons.'
    },
    serverCategory: {
        uncategorizedMultiWordPenalty: 'Points subtracted from a multi-word Uncategorized tag\u2019s score.',
        uncategorizedSingleWordPenalty: 'Points subtracted from a single-word Uncategorized tag\u2019s score (usually larger, since single-word Uncategorized tags tend to be noisy).',
        uncategorizedLowUsagePenalty: 'Extra points subtracted from a single-word Uncategorized tag when its usage and training counts are both below the thresholds below.',
        uncategorizedLowUsageThreshold: 'Usage-count threshold below which the extra low-usage Uncategorized penalty applies.',
        uncategorizedLowTrainingThreshold: 'NovelAI training-count threshold below which the extra low-usage Uncategorized penalty applies.',
        generalMetaNoGroupPenalty: 'Points subtracted from a General/Meta category tag that doesn\u2019t belong to any tag group.',
        generalMetaLowUsagePenalty: 'Extra points subtracted from a group-less General/Meta tag when usage and training counts are both below the thresholds below.',
        generalMetaLowUsageThreshold: 'Usage-count threshold below which the extra low-usage General/Meta penalty applies.',
        generalMetaLowTrainingThreshold: 'NovelAI training-count threshold below which the extra low-usage General/Meta penalty applies.'
    },
    tiers: {
        exactMatchTier: 'Tier value assigned to an exact tag-title match. Higher tiers always outrank lower ones regardless of score.',
        prefixMatchTier: 'Tier value assigned when a tag title starts with the full query.',
        strongCoverageTier: 'Tier value assigned when word-coverage between query and title is strong (see thresholds below).',
        partialCoverageTier: 'Tier value assigned when word-coverage between query and title is only partial.',
        strongCoverageThreshold: 'Coverage score (0\u2013100) at or above which a match counts as "strong" coverage.',
        strongCoveragePartialThreshold: 'Lower coverage score that still counts as strong coverage, as long as every query word at least partially matches a title word.',
        partialCoverageThreshold: 'Coverage score at or above which a match counts as "partial" coverage.',
        allTokensPartialThreshold: 'Minimum per-word match score required for a word to count as "at least partially matched" when checking the strong-coverage-partial condition.',
        singleTokenMatchThreshold: 'Coverage score required when a multi-word query matches a single-word title, for it to still count as a partial-coverage match.',
        minTier: 'Minimum match tier a result must reach to be included in autofill results (unless it also meets Min Coverage).',
        minCoverage: 'Minimum word-coverage score a result must reach to be included in autofill results (unless it also meets Min Tier).',
        tokenScores: {
            exactScore: 'Score for two words that match exactly.',
            prefixScore: 'Score when one word is a prefix of the other (both at least 3 characters).',
            stemStrongScore: 'Score when two words share a long (5+ character) common prefix (stem).',
            stemMediumScore: 'Score for a shorter shared stem when the two words are nearly the same length.',
            stemWeakScore: 'Score for a shorter shared stem when the words differ by up to 2 characters in length.',
            stemMinScore: 'Score for a shorter shared stem when the words differ by more than 2 characters in length.',
            containsScore: 'Score when one word contains the other as a substring (both at least 3 characters).',
            levenshteinThreshold: 'Minimum edit-distance similarity ratio (0\u20131) required for two words to count as a fuzzy/typo match at all.',
            levenshteinBaseMult: 'Multiplier applied to the similarity ratio for the base fuzzy-match score.',
            levenshteinCloseMult: 'Higher multiplier used when the two words are almost the same length and very similar (typo-level difference).',
            levenshteinNearMult: 'Multiplier used for fuzzy matches between the base and "close" cases (words close in length and similarity).'
        },
        coverageWeights: {
            firstTokenWeight: 'Weight given to the first word of a multi-word query when averaging per-word match scores into a coverage score.',
            lastTokenWeight: 'Weight given to the last word of a multi-word query when computing coverage.',
            middleTokenWeight: 'Weight given to any middle word(s) of a multi-word query when computing coverage.',
            sameLengthBonus: 'Bonus added to the coverage score when the title has exactly as many words as the query.',
            fewerTitleTokensPenalty: 'Penalty subtracted from the coverage score when the title has fewer words than the query.'
        }
    },
    clientTierBonus: {
        tier4: 'Score added for an exact tag-name match (highest match tier).',
        tier3: 'Score added for a prefix match (tag name starts with the query), reduced slightly per extra character beyond the query length.',
        tier2: 'Score added for a strong coverage match, reduced slightly per extra character beyond the query length.',
        tier1: 'Score added for a weak partial match, reduced per extra character beyond the query length.',
        tier3OvershootPenalty: 'Points subtracted per extra character the tag name has beyond the query length, for prefix (Tier 3) matches.',
        tier2OvershootPenalty: 'Points subtracted per extra character the tag name has beyond the query length, for strong-coverage (Tier 2) matches.',
        tier1OvershootPenalty: 'Points subtracted per extra character the tag name has beyond the query length, for weak-partial (Tier 1) matches.',
        coverageMult: 'Multiplier that converts the word-coverage score (0\u2013100) into ranking points.',
        textRelevanceMult: 'Multiplier that converts the text relevance score (predictionary/fuzzy text similarity) into ranking points.',
        apiConfidenceNoMatchMult: 'Multiplier applied to the API-provided confidence score when there is no direct text match at all \u2014 lets high-confidence suggestions surface without a literal match.',
        apiConfidenceMatchMult: 'Smaller multiplier applied to the API confidence score as a secondary boost when a text match already exists.',
        tagScoreMult: 'Multiplier applied to the tag\u2019s own base score (e.g. spellcheck/dictionary ranking) when a text match exists.',
        frequencyMult: 'Multiplier that converts a tag\u2019s usage/training frequency count into ranking points.',
        frequencyCap: 'Maximum ranking points a tag can gain from frequency alone, no matter how frequent it is.'
    },
    clientNonTag: {
        exactMatchBonus: 'Points added when a result\u2019s name exactly matches the query.',
        prefixMatchBonus: 'Points added when a result\u2019s name starts with the query (and isn\u2019t an exact match).',
        containsBonus: 'Points added when a result\u2019s name contains the query as a substring (and isn\u2019t an exact or prefix match).',
        similarityMult: 'Multiplier applied to the string-similarity score between the query and the result\u2019s name.',
        characterBonus: 'Flat points added for character-type results, keeping characters generally ranked above other non-tag types.',
        characterSimilarityMult: 'Extra multiplier applied to a character result\u2019s similarity score, on top of the character bonus.',
        textReplacementBestBonus: 'Points added when a text replacement result is the single best-matching replacement for the current input.',
        textReplacementExactPlaceholderBonus: 'Points added when the query exactly matches a text replacement\u2019s placeholder trigger.',
        dynamicPlaceholderBonus: 'Flat points added for dynamic placeholder results.',
        frequencyMult: 'Multiplier that converts a result\u2019s usage/training frequency count into ranking points.',
        frequencyCap: 'Maximum ranking points a non-tag result can gain from frequency alone.'
    }
};

const AUTOFILL_DSAP_TYPE_LABELS = {
    character: 'Character',
    textReplacement: 'Text Replacement',
    tagNovelai: 'Tag — NovelAI',
    tagDanbooru: 'Tag — Danbooru',
    tagE621: 'Tag — E621',
    dynamicPlaceholder: 'Dynamic Placeholder',
    spellcheck: 'Spell Check'
};

// Friendly labels for the score-breakdown components produced by calculateComprehensiveRanking
// (public/scripts/comp/autocompleteUtils.js) — both the tag and non-tag breakdown shapes.
const AUTOFILL_DSAP_BREAKDOWN_LABELS = {
    tierScore: 'Tier',
    coverageScore: 'Coverage',
    textRelevanceScore: 'Text',
    apiConfidenceScore: 'API Conf',
    tagScoreScore: 'Tag Score',
    frequencyScore: 'Freq',
    similarityScore: 'Similarity',
    typeBonus: 'Type Bonus'
};

// Informational (non-additive) breakdown fields shown alongside the additive score components.
const AUTOFILL_DSAP_BREAKDOWN_INFO_LABELS = {
    matchTier: 'match tier',
    matchCoverage: 'match cov'
};

function autofillDsapIsPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function autofillDsapLabel(key) {
    return String(key || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, c => c.toUpperCase());
}

function autofillDsapTypeLabel(typeKey) {
    return AUTOFILL_DSAP_TYPE_LABELS[typeKey] || autofillDsapLabel(typeKey);
}

function autofillDsapSetPath(target, path, value) {
    const parts = String(path || '').split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (!autofillDsapIsPlainObject(cur[key])) cur[key] = {};
        cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
}

function autofillDsapBuildFieldRow(path, label, value, description) {
    const descRow = description
        ? `<tr class="autofill-dsap-field-desc-row"><td colspan="2" class="autofill-dsap-field-desc">${escapeHtml(description)}</td></tr>`
        : '';
    return `<tr class="autofill-dsap-field-row">
    <td class="autofill-dsap-field-label">${escapeHtml(label)}</td>
    <td class="autofill-dsap-field-control">
      <input type="number" step="any" class="dsap-smf-input autofill-dsap-field-input" data-autofill-field="${escapeHtmlAttribute(path)}" value="${escapeHtmlAttribute(value)}">
    </td>
  </tr>${descRow}`;
}

function autofillDsapBuildGroupTable(groupId, groupObj) {
    const rows = [];
    const groupDesc = AUTOFILL_DSAP_FIELD_DESCRIPTIONS[groupId] || {};
    Object.entries(groupObj || {}).forEach(([key, val]) => {
        if (autofillDsapIsPlainObject(val)) {
            const nestedDesc = autofillDsapIsPlainObject(groupDesc[key]) ? groupDesc[key] : {};
            Object.entries(val).forEach(([nestedKey, nestedVal]) => {
                rows.push(autofillDsapBuildFieldRow(
                    `${groupId}.${key}.${nestedKey}`,
                    `${autofillDsapLabel(key)} \u2192 ${autofillDsapLabel(nestedKey)}`,
                    nestedVal,
                    nestedDesc[nestedKey]
                ));
            });
        } else {
            rows.push(autofillDsapBuildFieldRow(`${groupId}.${key}`, autofillDsapLabel(key), val, groupDesc[key]));
        }
    });
    return `<table class="autofill-dsap-field-table" cellspacing="0" cellpadding="0" border="0" width="100%">${rows.join('')}</table>`;
}

function autofillDsapBuildScoringHtml(ranking) {
    return AUTOFILL_DSAP_SCORING_GROUPS.map((group) => `
<div class="autofill-dsap-scoring-group">
  ${dsapSmfBuildSectionHdr(group.label)}
  ${autofillDsapBuildGroupTable(group.id, ranking[group.id])}
</div>`).join('');
}

function autofillDsapBuildTypeOrderHtml(ranking) {
    const weights = ranking.typeWeights || {};
    const rows = (ranking.typeOrder || []).map((typeKey) => `
    <tr class="autofill-dsap-type-row data-mgmt-ws-row" data-type-key="${escapeHtmlAttribute(typeKey)}">
      <td align="center" class="autofill-dsap-type-drag-cell data-mgmt-ws-drag-cell">
        <span class="autofill-dsap-type-drag-handle data-mgmt-ws-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
      </td>
      <td class="autofill-dsap-type-name-cell">${escapeHtml(autofillDsapTypeLabel(typeKey))}</td>
      <td align="center" class="autofill-dsap-type-weight-cell">
        <input type="number" step="any" class="dsap-smf-input autofill-dsap-field-input" data-autofill-weight-field="${escapeHtmlAttribute(typeKey)}" value="${escapeHtmlAttribute(weights[typeKey] ?? 0)}">
      </td>
    </tr>`).join('');

    return `
<p class="autofill-dsap-intro">Drag rows to set tie-break priority (top = highest priority when scores tie) and set the numeric weight added to a result's score for that type/source. When a tag matches multiple sources, the highest-weighted source wins.</p>
<table class="data-mgmt-ws-table autofill-dsap-type-table" cellspacing="0" cellpadding="4" border="1" width="100%">
  <thead>
    <tr><th width="40"></th><th>Type / Source</th><th width="140">Weight</th></tr>
  </thead>
  <tbody id="autofillDsapTypeList">${rows}</tbody>
</table>`;
}

function autofillDsapBuildTestHtml() {
    return `
<div class="autofill-dsap-toolbar dsap-smf-toolbar">
  <div class="autofill-dsap-search-wrap">
    <i class="fas fa-search autofill-dsap-search-icon"></i>
    <input type="text" id="autofillDsapTestQuery" class="dsap-smf-input autofill-dsap-search-input" placeholder="Type a query to test the live mixed autocomplete…">
  </div>
  <button type="button" id="autofillDsapTestRun" class="dsap-smf-btn dsap-smf-btn-primary"><i class="fas fa-play"></i> Run</button>
</div>
<div id="autofillDsapTestStatus" class="dsap-smf-statusbox hidden">
  <span id="autofillDsapTestStatusMessage" class="dsap-smf-status-message"></span>
</div>
<div id="autofillDsapTestEmpty" class="dsap-smf-empty">Run a query to see the full mixed autocomplete result set (tags, characters, text replacements, spellcheck, dynamic placeholders) ordered and scored exactly as users see it, with a per-result score breakdown.</div>
<table id="autofillDsapTestTable" class="sec-data-table autofill-dsap-test-table hidden" cellspacing="0" cellpadding="4" width="100%" border="1">
  <thead>
    <tr>
      <th width="30">#</th><th width="130">Type</th><th>Result</th><th width="70">Total</th><th width="60">Type Wt</th><th>Score Breakdown</th>
    </tr>
  </thead>
  <tbody id="autofillDsapTestBody"></tbody>
</table>`;
}

function autofillDsapBuildHtml(ranking) {
    return `
<div data-dsap="autofill-ranking" class="dsap-root dsap-smf autofill-dsap">
${dsapSmfBuildHeader({ branchTitle: DSAP_SMF_BRANCH_AUTOFILL, toolTitle: AUTOFILL_DSAP_TAB_LABELS.test })}
${dsapSmfBuildTabBar([
        { id: 'test', label: AUTOFILL_DSAP_TAB_LABELS.test, icon: 'fas fa-flask' },
        { id: 'scoring', label: AUTOFILL_DSAP_TAB_LABELS.scoring, icon: 'fas fa-sliders' },
        { id: 'typeOrder', label: AUTOFILL_DSAP_TAB_LABELS.typeOrder, icon: 'fas fa-arrow-down-wide-short' }
    ], 'test', { tabBarId: 'autofillDsapTabBar', dataAttr: 'data-autofill-tab' })}

<div id="autofillDsapAccessDenied" class="dsap-smf-empty hidden"><i class="fas fa-lock"></i> Admin access required.</div>

<div class="autofill-dsap-view" id="autofillDsapTestView" data-autofill-view="test">
  ${autofillDsapBuildTestHtml()}
</div>

<div class="autofill-dsap-view hidden" id="autofillDsapScoringView" data-autofill-view="scoring">
  <div class="autofill-dsap-toolbar dsap-smf-toolbar">
    <button type="button" id="autofillDsapScoringSave" class="dsap-smf-btn dsap-smf-btn-primary"><i class="fas fa-save"></i> Save Scoring</button>
  </div>
  <div id="autofillDsapScoringBody">${autofillDsapBuildScoringHtml(ranking)}</div>
</div>

<div class="autofill-dsap-view hidden" id="autofillDsapTypeOrderView" data-autofill-view="typeOrder">
  <div class="autofill-dsap-toolbar dsap-smf-toolbar">
    <button type="button" id="autofillDsapTypeOrderSave" class="dsap-smf-btn dsap-smf-btn-primary"><i class="fas fa-save"></i> Save Type Ranking</button>
  </div>
  <div id="autofillDsapTypeOrderBody">${autofillDsapBuildTypeOrderHtml(ranking)}</div>
</div>
</div>`;
}

const autofillDsapScopedCss = `
[data-dsap="autofill-ranking"] .autofill-dsap-view { padding: 2px 0; }
[data-dsap="autofill-ranking"] .autofill-dsap-intro { margin: 4px 2px 8px; color: #333333; font-size: 11pt; }
[data-dsap="autofill-ranking"] .autofill-dsap-scoring-group { margin-bottom: 10px; }
[data-dsap="autofill-ranking"] .autofill-dsap-field-table { background: #f8f8f8; border: 1px solid #999999; font-size: 11pt; }
[data-dsap="autofill-ranking"] .autofill-dsap-field-row td { padding: 4px 8px 2px; vertical-align: middle; border-bottom: none; }
[data-dsap="autofill-ranking"] .autofill-dsap-field-label { font-weight: bold; color: #000000; width: 260px; }
[data-dsap="autofill-ranking"] .autofill-dsap-field-control { width: 140px; }
[data-dsap="autofill-ranking"] .autofill-dsap-field-desc-row td { padding: 0 8px 6px; border-bottom: 1px solid #dddddd; }
[data-dsap="autofill-ranking"] .autofill-dsap-field-desc { font-size: 10pt; color: #555555; }
[data-dsap="autofill-ranking"] .autofill-dsap-field-input { width: 110px; }
[data-dsap="autofill-ranking"] .autofill-dsap-type-drag-cell { color: #666; width: 40px; }
[data-dsap="autofill-ranking"] .autofill-dsap-type-drag-handle { cursor: grab; display: inline-block; }
[data-dsap="autofill-ranking"] .autofill-dsap-type-drag-handle:active { cursor: grabbing; }
[data-dsap="autofill-ranking"] .autofill-dsap-type-row.dragging { opacity: 0.55; background: #ffffee; }
[data-dsap="autofill-ranking"] .autofill-dsap-type-row.drag-over { outline: 1px dashed var(--dsap-smf-tab-accent, #ff8c00); }
[data-dsap="autofill-ranking"] .autofill-dsap-type-weight-cell .autofill-dsap-field-input { width: 90px; }
[data-dsap="autofill-ranking"] .autofill-dsap-search-wrap { flex: 1; min-width: 200px; position: relative; }
[data-dsap="autofill-ranking"] .autofill-dsap-search-icon { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); color: #666; font-size: 10pt; }
[data-dsap="autofill-ranking"] .autofill-dsap-search-input { width: 100%; padding-left: 24px !important; box-sizing: border-box; }
[data-dsap="autofill-ranking"] .autofill-dsap-test-table td { text-align: center; }
[data-dsap="autofill-ranking"] .autofill-dsap-test-table td.autofill-dsap-test-name { text-align: left; font-weight: bold; }
[data-dsap="autofill-ranking"] .autofill-dsap-test-table td.autofill-dsap-test-breakdown { text-align: left; font-size: 10pt; color: #333333; }
[data-dsap="autofill-ranking"] .autofill-dsap-test-bd-part { display: inline-block; margin: 0 6px 2px 0; white-space: nowrap; }
[data-dsap="autofill-ranking"] .autofill-dsap-test-bd-info { color: #777777; font-size: 9pt; }
[data-dsap="autofill-ranking"] .autofill-dsap-test-bd-empty { color: #999999; }
[data-dsap="autofill-ranking"] .autofill-dsap-test-toptier td { background: #fffdf0; }
`;

const autofillDsapDriver = {
    _state: null,

    init(host) {
        this._state = { host, ranking: (typeof getAutofillRanking === 'function' ? getAutofillRanking() : null) };

        const root = host.getRoot();
        if (!root) return;

        if (localStorage.getItem('userType') !== 'admin') {
            root.querySelectorAll('.autofill-dsap-view, #autofillDsapTabBar').forEach((el) => el.classList.add('hidden'));
            root.querySelector('#autofillDsapAccessDenied')?.classList.remove('hidden');
            return;
        }

        // dsapSmfWireTabBar: public/scripts/comp/dsapSmfMarkup.js — reuses the same click-to-switch-view
        // pattern as other SMF applets, but stays in-page (no navigate) since all tab state is client-only.
        this._wireTabs(root);
        this._wireTypeDragReorder(root);
        this._wireActions(root);

        host.on('autofill_ranking_updated', (msg) => {
            const ranking = msg?.data?.ranking || msg?.ranking;
            if (ranking) this._onRankingUpdated(root, ranking);
        });
    },

    refresh(host) {
        this.destroy(host);
        this.init(host);
    },

    destroy(host) {
        this._state = null;
    },

    async _ensureWs() {
        if (!wsClient?.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Connection Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-wifi"></i>');
            }
            return false;
        }
        return true;
    },

    _wireTabs(root) {
        const tabBar = root.querySelector('#autofillDsapTabBar');
        if (!tabBar || tabBar.dataset.autofillWired === '1') return;
        tabBar.dataset.autofillWired = '1';
        tabBar.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-autofill-tab]');
            if (!tab) return;
            const tabId = tab.getAttribute('data-autofill-tab');
            root.querySelectorAll('.autofill-dsap-view').forEach((view) => {
                view.classList.toggle('hidden', view.dataset.autofillView !== tabId);
            });
            // dsapSmfSetActiveTab / dsapSmfUpdateHeaderTool: public/scripts/comp/dsapSmfMarkup.js
            dsapSmfSetActiveTab(root, 'data-autofill-tab', tabId, 'dsap-smf-tab');
            dsapSmfUpdateHeaderTool(root, AUTOFILL_DSAP_TAB_LABELS[tabId] || AUTOFILL_DSAP_TAB_LABELS.test);
        });
    },

    _wireActions(root) {
        root.querySelector('#autofillDsapTestRun')?.addEventListener('click', () => this._runTest(root));
        root.querySelector('#autofillDsapTestQuery')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._runTest(root);
        });
        root.querySelector('#autofillDsapScoringSave')?.addEventListener('click', () => this._saveScoring(root));
        root.querySelector('#autofillDsapTypeOrderSave')?.addEventListener('click', () => this._saveTypeOrder(root));
    },

    async _runTest(root) {
        const input = root.querySelector('#autofillDsapTestQuery');
        const query = (input?.value || '').trim();
        const statusBox = root.querySelector('#autofillDsapTestStatus');
        const statusMsg = root.querySelector('#autofillDsapTestStatusMessage');
        const empty = root.querySelector('#autofillDsapTestEmpty');
        const table = root.querySelector('#autofillDsapTestTable');
        const body = root.querySelector('#autofillDsapTestBody');
        if (!query) return;
        if (!(await this._ensureWs())) return;

        statusBox?.classList.remove('hidden');
        if (statusMsg) statusMsg.textContent = 'Running live search…';

        try {
            // Server runs the SAME pipeline live autocomplete uses (searchService.searchCharacters,
            // headless) so results/spellCheck reflect real characters, tags and text replacements.
            // manualModel: public/scripts/comp/manualModalManager.js (global model select element)
            const model = manualModel?.value;
            // getAutofillSearchSettings: public/scripts/comp/autofillSettings.js
            const autofillSettings = getAutofillSearchSettings();
            const data = await wsClient.testAutofillRanking(query, 35, { model, autofillSettings });
            const payload = data?.data || data || {};
            const serverResults = Array.isArray(payload.results) ? payload.results : [];
            const spellCheck = payload.spellCheck || null;

            const ranked = this._buildMixedRankedResults(query, serverResults, spellCheck);
            statusBox?.classList.add('hidden');
            if (!ranked.length) {
                empty?.classList.remove('hidden');
                table?.classList.add('hidden');
                if (empty) empty.textContent = `No results for "${query}".`;
                return;
            }
            empty?.classList.add('hidden');
            table?.classList.remove('hidden');
            if (body) {
                body.innerHTML = ranked.map((result, idx) => this._buildTestRowHtml(result, idx)).join('');
            }
        } catch (err) {
            if (statusMsg) statusMsg.textContent = err.message || 'Search failed';
            statusBox?.classList.remove('hidden');
            table?.classList.add('hidden');
        }
    },

    // Split the server's mixed result set by type, apply the exact client prepare*ForDisplay
    // transforms, add client-only dynamic placeholders, then run the shared live merge/rank path
    // (assembleRankedAutofillResults, public/scripts/comp/autocompleteUtils.js) with breakdowns.
    _buildMixedRankedResults(query, serverResults, spellCheck) {
        const rawCharacters = [];
        const rawTags = [];
        const rawTextReplacements = [];
        for (const result of serverResults) {
            if (!result || typeof result !== 'object') continue;
            // isCharacterResult / isTagResult: public/scripts/comp/autocompleteUtils.js
            if (isTagResult(result)) {
                rawTags.push(result);
            } else if (isCharacterResult(result)) {
                rawCharacters.push(result);
            } else if (result.type === 'textReplacement') {
                rawTextReplacements.push(result);
            }
        }

        // prepare*ForDisplay + getDynamicGenerationPlaceholderResults: public/scripts/comp/autocompleteUtils.js
        const characterResults = rawCharacters.length ? prepareCharacterResultsForDisplay(rawCharacters, query) : [];
        const tagResults = rawTags.length ? prepareTagResultsForDisplay(rawTags, query) : [];
        const textReplacements = rawTextReplacements.length ? prepareTextReplacementResultsForDisplay(rawTextReplacements, query) : [];
        const dynamicPlaceholders = getDynamicGenerationPlaceholderResults(query);

        // Match live getBestSpellCheckResult gating (only surfaced when there are real errors).
        const bestSpellCheckResult = (spellCheck && spellCheck.hasErrors)
            ? { type: 'spellcheck', data: spellCheck, serviceName: 'spellcheck' }
            : null;

        // assembleRankedAutofillResults: public/scripts/comp/autocompleteUtils.js
        return assembleRankedAutofillResults({
            query,
            bestSpellCheckResult,
            characterResults,
            tagResults,
            textReplacements,
            dynamicPlaceholders,
            attachBreakdown: true
        });
    },

    _testResultLabel(result) {
        if (isTagResult(result)) {
            // getTagDisplayLabel: public/scripts/comp/autocompleteUtils.js
            return getTagDisplayLabel(result) || result.name || result.title || '';
        }
        if (result.type === 'spellcheck') {
            const misspelled = result.data && Array.isArray(result.data.misspelled) ? result.data.misspelled : [];
            return misspelled.length ? `Misspelled: ${misspelled.join(', ')}` : 'Spellcheck';
        }
        return result.name || result.placeholder || result.displayName || '';
    },

    _buildTestBreakdownCell(breakdown) {
        if (!breakdown || typeof breakdown !== 'object') return '<span class="autofill-dsap-test-bd-empty">—</span>';
        const fmt = (n) => (typeof n === 'number' ? (Math.round(n * 10) / 10).toString() : '—');
        const parts = [];
        Object.entries(AUTOFILL_DSAP_BREAKDOWN_LABELS).forEach(([key, label]) => {
            const val = breakdown[key];
            if (typeof val === 'number' && val !== 0) {
                parts.push(`<span class="autofill-dsap-test-bd-part">${escapeHtml(label)} <b>${fmt(val)}</b></span>`);
            }
        });
        const info = [];
        Object.entries(AUTOFILL_DSAP_BREAKDOWN_INFO_LABELS).forEach(([key, label]) => {
            const val = breakdown[key];
            if (typeof val === 'number') {
                info.push(`${escapeHtml(label)} ${fmt(val)}`);
            }
        });
        if (!parts.length && !info.length) return '<span class="autofill-dsap-test-bd-empty">type weight only</span>';
        const infoHtml = info.length ? `<span class="autofill-dsap-test-bd-info">(${info.join(', ')})</span>` : '';
        return `${parts.join(' ')} ${infoHtml}`.trim();
    },

    _buildTestRowHtml(result, idx) {
        const breakdown = result._testBreakdown || {};
        // getAutofillTypeKey: public/scripts/comp/autocompleteUtils.js
        const typeKey = getAutofillTypeKey(result);
        const total = typeof result._testScore === 'number' ? result._testScore : 0;
        const typeWeight = typeof breakdown.typeWeight === 'number' ? breakdown.typeWeight : 0;
        const topTier = result._isTopTier ? ' autofill-dsap-test-toptier' : '';
        return `<tr class="${topTier.trim()}">
      <td>${idx + 1}</td>
      <td>${escapeHtml(autofillDsapTypeLabel(typeKey))}</td>
      <td class="autofill-dsap-test-name">${escapeHtml(this._testResultLabel(result))}</td>
      <td><b>${Math.round(total * 10) / 10}</b></td>
      <td>${Math.round(typeWeight * 10) / 10}</td>
      <td class="autofill-dsap-test-breakdown">${this._buildTestBreakdownCell(breakdown)}</td>
    </tr>`;
    },

    async _saveScoring(root) {
        const patch = {};
        root.querySelectorAll('#autofillDsapScoringBody [data-autofill-field]').forEach((input) => {
            const path = input.getAttribute('data-autofill-field');
            const num = Number(input.value);
            if (path && Number.isFinite(num)) autofillDsapSetPath(patch, path, num);
        });
        await this._submitPatch(patch, 'Scoring settings saved');
    },

    async _saveTypeOrder(root) {
        const rows = Array.from(root.querySelectorAll('#autofillDsapTypeList .autofill-dsap-type-row'));
        const typeOrder = rows.map((row) => row.dataset.typeKey);
        const typeWeights = {};
        rows.forEach((row) => {
            const key = row.dataset.typeKey;
            const input = row.querySelector('[data-autofill-weight-field]');
            const num = Number(input?.value);
            typeWeights[key] = Number.isFinite(num) ? num : 0;
        });
        await this._submitPatch({ typeOrder, typeWeights }, 'Type ranking saved');
    },

    async _submitPatch(patch, successMessage) {
        if (!(await this._ensureWs())) return;
        try {
            const data = await wsClient.updateAutofillRanking(patch);
            if (data?.success) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, successMessage, false, 4000, '<i class="fas fa-save"></i>');
                }
                // autofill_ranking_updated broadcast (handled by host.on above) refreshes this view
                // and the global public/scripts/comp/autofillRankingConfig.js cache for every client.
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Error', err.message || 'Failed to save autofill ranking', false, 5000);
            }
        }
    },

    _onRankingUpdated(root, ranking) {
        this._state.ranking = ranking;
        const scoringBody = root.querySelector('#autofillDsapScoringBody');
        const typeOrderBody = root.querySelector('#autofillDsapTypeOrderBody');
        if (scoringBody) scoringBody.innerHTML = autofillDsapBuildScoringHtml(ranking);
        if (typeOrderBody) {
            typeOrderBody.innerHTML = autofillDsapBuildTypeOrderHtml(ranking);
            this._wireTypeDragReorder(root);
        }
    },

    // Drag-and-drop copied from dataMgmtDsapWireWorkspaceDragReorder (public/scripts/comp/dataManagementDsapApplet.js)
    // and adapted for the in-memory typeOrder list (persisted only on "Save Type Ranking", not per-drag).
    _wireTypeDragReorder(root) {
        const list = root.querySelector('#autofillDsapTypeList');
        if (!list || list.dataset.typeDragWired === '1') return;
        list.dataset.typeDragWired = '1';

        let draggedItem = null;
        let draggedIndex = null;

        list.querySelectorAll('.autofill-dsap-type-drag-handle').forEach((handle) => {
            handle.addEventListener('mousedown', startDrag);
            handle.addEventListener('touchstart', startDrag, { passive: false });
            handle.addEventListener('touchmove', onDrag, { passive: false });
            handle.addEventListener('touchend', endDrag);
        });

        function startDrag(e) {
            e.preventDefault();
            e.stopPropagation();

            const item = e.target.closest('.autofill-dsap-type-row');
            if (!item) return;

            draggedItem = item;
            draggedIndex = Array.from(list.children).indexOf(item);
            draggedItem.classList.add('dragging');

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', endDrag);
            document.body.style.userSelect = 'none';
        }

        function onDrag(e) {
            if (!draggedItem) return;
            e.preventDefault();

            let clientY;
            if (e.type === 'mousemove') {
                clientY = e.clientY;
            } else if (e.type === 'touchmove' && e.touches.length > 0) {
                clientY = e.touches[0].clientY;
            } else {
                return;
            }

            const rect = list.getBoundingClientRect();
            const mouseY = clientY - rect.top;
            const items = Array.from(list.children);
            let targetIndex = draggedIndex;

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const itemRect = item.getBoundingClientRect();
                const itemTop = itemRect.top - rect.top;
                const itemBottom = itemTop + itemRect.height;
                if (mouseY >= itemTop && mouseY <= itemBottom) {
                    targetIndex = i;
                    break;
                }
            }

            if (targetIndex !== draggedIndex) {
                items.forEach((item) => item.classList.remove('drag-over'));
                if (targetIndex < items.length) {
                    list.insertBefore(draggedItem, items[targetIndex]);
                } else {
                    list.appendChild(draggedItem);
                }
                const newItems = Array.from(list.children);
                const newIndex = newItems.indexOf(draggedItem);
                if (newIndex < newItems.length) {
                    newItems[newIndex].classList.add('drag-over');
                }
                draggedIndex = targetIndex;
            }
        }

        function endDrag(e) {
            if (!draggedItem) return;
            e.preventDefault();

            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', endDrag);

            draggedItem.classList.remove('dragging');
            Array.from(list.children).forEach((item) => item.classList.remove('drag-over'));
            document.body.style.userSelect = '';

            draggedItem = null;
            draggedIndex = null;
        }
    }
};

function registerAutofillConfigDsapApplet() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: AUTOFILL_DSAP_URL,
        aliases: [
            `dsap://${AUTOFILL_DSAP_URL}`,
            'en.grimoire.jp/applets/autofill',
            'applet.grimoire.jp/autofill'
        ],
        theme: 'dsap-smf',
        getContent() {
            const ranking = (typeof getAutofillRanking === 'function' ? getAutofillRanking() : null) || {};
            return {
                html: autofillDsapBuildHtml(ranking),
                css: autofillDsapScopedCss,
                drivers: autofillDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

function openAutofillRankingDsap() {
    const target = `dsap://${AUTOFILL_DSAP_URL}/`;
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    if (typeof openDsapInGrimoire === 'function') {
        openDsapInGrimoire(target);
        return;
    }
    let tries = 0;
    const t = setInterval(() => {
        tries += 1;
        if (typeof openDsapInGrimoire === 'function') {
            clearInterval(t);
            openDsapInGrimoire(target);
        } else if (tries > 20) {
            clearInterval(t);
        }
    }, 60);
}

registerAutofillConfigDsapApplet();
