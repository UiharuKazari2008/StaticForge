/**
 * Autofill Ranking (Yozora #828): the MMC snap-in that replaced the SmartText Ranking DSAP on the
 * desktop (dsap://autofill.dreamscape.jp/ opens it there; elsewhere the DSAP page stays,
 * public/scripts/comp/autofillConfigDsapApplet.js). Admin only: anyone else gets the access-denied
 * page. It edits the shared ranking config (config.autofillRanking, modules/autofillRankingSettings.js)
 * that these read:
 *   - modules/tag-lookup.js searchTagsAutofill (server ranking)
 *   - public/scripts/comp/autocompleteRanking.js calculateComprehensiveRanking (client ranking)
 *   - public/scripts/comp/autocompleteUtils.js sort comparator (client ranking)
 *
 *   Autofill Ranking (Local)   the ranking at a glance
 *     Test                     a query run through the live mixed autocomplete (test_autofill_ranking,
 *                              then the client's own merge), every result with its score breakdown
 *     Scoring                  every number of the server and client scoring, with what it does
 *     Type Ranking             the order of the result types (Move Up / Move Down) and their weights
 *
 * Saves go through update_autofill_ranking; autofill_ranking_updated brings every change back.
 *
 *   window.openAutofillRankingConsole(node?)   node: 'root' | 'test' | 'scoring' | 'types'
 */
(function (root) {
    'use strict';

    /* global getAutofillRanking, AUTOFILL_TYPE_KEYS, manualModel, getAutofillSearchSettings, escapeHtml,
       isTagResult, isCharacterResult, prepareCharacterResultsForDisplay, prepareTagResultsForDisplay,
       prepareTextReplacementResultsForDisplay, getDynamicGenerationPlaceholderResults,
       assembleRankedAutofillResults, getTagDisplayLabel, getAutofillTypeKey */

    const ID = 'autofillRanking';
    const TITLE = 'Autofill Ranking';
    const ITEMS = '/static_images/vista-cpl/items';
    const VI = '/static_images/vista-icons';
    const ICON16 = `${ITEMS}/keyboard-16.png`;
    const ICON32 = `${ITEMS}/keyboard-32.png`;
    const ICON_TEST = `${VI}/search-16.png`;
    const ICON_SCORING = `${ITEMS}/performance-information-and-tools-16.png`;
    const ICON_TYPES = '/static_images/vista-sideshow/reorder-16.png';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const ws = () => root.wsClient || null;
    const connected = () => { const c = ws(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };
    const typeKeys = () => (typeof AUTOFILL_TYPE_KEYS !== 'undefined' ? AUTOFILL_TYPE_KEYS : ['character', 'textReplacement', 'tagNovelai', 'tagDanbooru', 'tagE621', 'dynamicPlaceholder', 'spellcheck']);

    const SCORING_GROUPS = [
        { id: 'serverBase', label: 'Server: Base Match Scores' },
        { id: 'serverBonus', label: 'Server: Usage and Training Bonuses' },
        { id: 'serverCategory', label: 'Server: Category Penalties' },
        { id: 'tiers', label: 'Shared: Match Tiers and Coverage' },
        { id: 'clientTierBonus', label: 'Client: Tag Result Bonuses' },
        { id: 'clientNonTag', label: 'Client: Non-Tag Result Bonuses' }
    ];

    const TYPE_LABELS = {
        character: 'Character',
        textReplacement: 'Text Replacement',
        tagNovelai: 'Tag (NovelAI)',
        tagDanbooru: 'Tag (Danbooru)',
        tagE621: 'Tag (E621)',
        dynamicPlaceholder: 'Dynamic Placeholder',
        spellcheck: 'Spell Check'
    };

    // Copied from autofillConfigDsapApplet.js (the DSAP keeps its own copy for the non-desktop page):
    // what each scoring number does, by group / key (and one level of nesting for tiers.tokenScores
    // and tiers.coverageWeights), mirroring modules/autofillRankingSettings.js DEFAULT_AUTOFILL_RANKING.
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

    // Copied from autofillConfigDsapApplet.js: the score-breakdown labels of calculateComprehensiveRanking.
    // Friendly labels for the score-breakdown components produced by calculateComprehensiveRanking
    // (public/scripts/comp/autocompleteUtils.js) - both the tag and non-tag breakdown shapes.
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

    const typeLabel = (k) => TYPE_LABELS[k] || autofillDsapLabel(k);

    const state = {
        ranking: null,      // the saved ranking (getAutofillRanking / autofill_ranking_updated)
        drafts: new Map(),  // Scoring: path -> typed text, until saved
        types: null,        // Type Ranking: { order, weights } while it has unsaved changes
        saving: false,
        test: { query: '', rows: null, error: '', running: false }
    };

    const ranking = () => state.ranking || (typeof getAutofillRanking === 'function' ? getAutofillRanking() : null) || {};

    // ---- Test ----------------------------------------------------------------------------------------

    // Copied from autofillConfigDsapApplet.js (autofillDsapDriver): the live mixed rank of a result set.
    const rank = {
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
        if (!breakdown || typeof breakdown !== 'object') return '<span class="autofill-dsap-test-bd-empty">-</span>';
        const fmt = (n) => (typeof n === 'number' ? (Math.round(n * 10) / 10).toString() : '-');
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
    };

    async function runTest(c) {
        const t = state.test;
        const query = String(t.query || '').trim();
        if (!query) return;
        if (!connected()) { await c.box('<p>Melaton is not connected to the server.</p>', null, { icon: 'error' }); return; }
        t.running = true;
        t.error = '';
        c.note('Running live search...');
        c.refresh();
        try {
            // the same pipeline live autocomplete uses (searchService.searchCharacters, headless);
            // manualModel: manualModalManager.js, getAutofillSearchSettings: autofillSettings.js
            const model = typeof manualModel !== 'undefined' && manualModel ? manualModel.value : undefined;
            const autofillSettings = typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : undefined;
            const data = await ws().testAutofillRanking(query, 35, { model, autofillSettings });
            const payload = (data && data.data) || data || {};
            const serverResults = Array.isArray(payload.results) ? payload.results : [];
            t.rows = rank._buildMixedRankedResults(query, serverResults, payload.spellCheck || null);
            t.ran = query;
            c.note(`${t.rows.length} result${t.rows.length === 1 ? '' : 's'} for "${query}"`);
        } catch (err) {
            t.rows = null;
            t.error = (err && err.message) || 'The search failed.';
            c.note('');
        } finally {
            t.running = false;
        }
        c.refresh();
    }

    function testPage(c) {
        const t = state.test;
        const fmt = (n) => String(Math.round((Number(n) || 0) * 10) / 10);
        const cols = [
            { t: '#', w: 36, num: true, text: (d) => String(d.n) },
            { t: 'Type', w: 130, text: (d) => d.type },
            { t: 'Result', w: 190, text: (d) => d.label, html: (d) => (d.top ? `<i class="afr-top">${esc(d.label)}</i>` : `<i>${esc(d.label)}</i>`) },
            { t: 'Total', w: 60, num: true, text: (d) => fmt(d.total) },
            { t: 'Type Wt', w: 60, num: true, text: (d) => fmt(d.weight) },
            { t: 'Score Breakdown', w: 520, text: (d) => d.bdText, html: (d) => `<i class="afr-bd" title="${esc(d.bdText)}">${d.bd}</i>` }
        ];
        const rows = (t.rows || []).map((r, i) => {
            const bdObj = r._testBreakdown || {};
            const bd = rank._buildTestBreakdownCell(bdObj);
            const tmp = document.createElement('div');
            tmp.innerHTML = bd;
            return {
                key: String(i),
                data: {
                    n: i + 1,
                    type: typeLabel(typeof getAutofillTypeKey === 'function' ? getAutofillTypeKey(r) : r.type),
                    label: rank._testResultLabel(r),
                    total: typeof r._testScore === 'number' ? r._testScore : 0,
                    weight: typeof bdObj.typeWeight === 'number' ? bdObj.typeWeight : 0,
                    bd,
                    bdText: tmp.textContent.replace(/\s+/g, ' ').trim(),
                    top: !!r._isTopTier
                }
            };
        });
        let empty = 'Type a query and click Run to see the full mixed autocomplete result set (tags, characters, text replacements, spell check, dynamic placeholders) ranked and scored exactly as users see it.';
        if (t.running) empty = 'Running live search...';
        else if (t.error) empty = t.error;
        else if (t.rows && !t.rows.length) empty = `No results for "${t.ran || t.query}".`;
        return {
            html: `<div class="afr-query"><label for="afr-query">Query:</label><input type="text" id="afr-query" data-field="afr-query" value="${esc(t.query)}" spellcheck="false" autocomplete="off"><button type="button" class="btn-standard" data-act="run"${t.running ? ' disabled' : ''}>Run</button></div>${c.listView(cols, rows, { empty })}`,
            list: true,
            mount: (pane) => {
                const input = pane.querySelector('#afr-query');
                if (!input) return;
                input.addEventListener('input', () => { t.query = input.value; });
                input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); t.query = input.value; void runTest(c); } });
            }
        };
    }

    // ---- Scoring -------------------------------------------------------------------------------------

    /** Every editable number: [{ group, path, label, value, desc }] in the config's own order. */
    function scoringFields() {
        const r = ranking();
        const out = [];
        SCORING_GROUPS.forEach((g) => {
            const desc = AUTOFILL_DSAP_FIELD_DESCRIPTIONS[g.id] || {};
            Object.entries(r[g.id] || {}).forEach(([key, val]) => {
                if (autofillDsapIsPlainObject(val)) {
                    const nested = autofillDsapIsPlainObject(desc[key]) ? desc[key] : {};
                    Object.entries(val).forEach(([k2, v2]) => out.push({ group: g.id, path: `${g.id}.${key}.${k2}`, label: `${autofillDsapLabel(key)}: ${autofillDsapLabel(k2)}`, value: v2, desc: nested[k2] }));
                } else {
                    out.push({ group: g.id, path: `${g.id}.${key}`, label: autofillDsapLabel(key), value: val, desc: desc[key] });
                }
            });
        });
        return out;
    }

    /** The descriptions' typographic marks as keyboard text (they were written for the DSAP page). */
    const plain = (s) => String(s || '').replace(/[\u2018\u2019]/g, '\'').replace(/[\u2013\u2014]/g, '-').replace(/\u2192/g, '>');

    const fieldValue = (f) => (state.drafts.has(f.path) ? state.drafts.get(f.path) : String(f.value));
    const badValue = (v) => String(v).trim() === '' || !Number.isFinite(Number(v));

    function scoringPage(c) {
        const fields = scoringFields();
        const dirty = state.drafts.size > 0;
        const sections = [{ id: 'afr-scoring-about', title: 'Scoring', body: `<p>These numbers decide how autofill scores a match: the server's search scores, the match tiers both sides share, and the client's final ranking. They apply to everyone. Changes take effect when you click Save.</p>
            <div class="mmc-buttons"><button type="button" class="btn-standard" data-act="save-scoring"${dirty ? '' : ' disabled'}>Save</button><button type="button" class="btn-standard" data-act="discard-scoring"${dirty ? '' : ' disabled'}>Discard Changes</button></div>` }];
        SCORING_GROUPS.forEach((g) => {
            const rows = fields.filter((f) => f.group === g.id).map((f) => {
                const v = fieldValue(f);
                const id = `afr-f-${f.path.replace(/\./g, '-')}`;
                return `<label for="${id}">${esc(f.label)}:</label><input type="text" inputmode="decimal" id="${id}" data-field="${esc(f.path)}" value="${esc(v)}" class="${state.drafts.has(f.path) ? 'is-changed' : ''}${badValue(v) ? ' is-bad' : ''}" spellcheck="false" autocomplete="off">${f.desc ? `<div class="afr-desc">${esc(plain(f.desc))}</div>` : ''}`;
            }).join('');
            sections.push({ id: `afr-${g.id}`, title: g.label, body: `<div class="afr-fields">${rows}</div>` });
        });
        return {
            html: c.page('Scoring', dirty ? `${state.drafts.size} change${state.drafts.size === 1 ? '' : 's'} not saved` : '', sections),
            mount: (pane) => {
                pane.querySelectorAll('.afr-fields input[data-field]').forEach((input) => {
                    input.addEventListener('input', () => {
                        const f = fields.find((x) => x.path === input.dataset.field);
                        if (!f) return;
                        const was = state.drafts.size;
                        if (input.value === String(f.value)) state.drafts.delete(f.path); else state.drafts.set(f.path, input.value);
                        input.classList.toggle('is-changed', state.drafts.has(f.path));
                        input.classList.toggle('is-bad', badValue(input.value));
                        // the title band and the buttons follow the first and the last change
                        if ((was === 0) !== (state.drafts.size === 0)) { c.renderActions(); c.render(); } else { updateDirtyBand(pane); c.renderStatus(); }
                    });
                });
            }
        };
    }

    function updateDirtyBand(pane) {
        const side = pane.querySelector('.mmc-page-title > span');
        const n = state.drafts.size;
        if (side) side.textContent = n ? `${n} change${n === 1 ? '' : 's'} not saved` : '';
    }

    async function saveScoring(c) {
        const fields = scoringFields();
        const bad = fields.filter((f) => state.drafts.has(f.path) && badValue(state.drafts.get(f.path)));
        if (bad.length) {
            await c.box(`<p>Type a number for ${esc(bad[0].label)}.</p>`, null, { icon: 'error' });
            const el = c.el(`[data-field="${CSS.escape(bad[0].path)}"]`);
            if (el) { el.focus(); el.select(); }
            return;
        }
        const patch = {};
        fields.forEach((f) => {
            const n = Number(fieldValue(f));
            if (Number.isFinite(n)) autofillDsapSetPath(patch, f.path, n);
        });
        if (await submit(c, patch)) { state.drafts.clear(); c.note('The scoring settings were saved.'); c.refresh(); }
    }

    // ---- Type Ranking --------------------------------------------------------------------------------

    function typesDraft() {
        if (state.types) return state.types;
        const r = ranking();
        const order = (Array.isArray(r.typeOrder) && r.typeOrder.length ? r.typeOrder : typeKeys()).slice();
        typeKeys().forEach((k) => { if (!order.includes(k)) order.push(k); });
        return { order, weights: Object.assign({}, r.typeWeights || {}) };
    }

    function typesDirty() {
        if (!state.types) return false;
        const r = ranking();
        const saved = typesDraftFrom(r);
        return JSON.stringify(saved.order) !== JSON.stringify(state.types.order)
            || saved.order.some((k) => Number(saved.weights[k] || 0) !== Number(state.types.weights[k] || 0));
    }

    function typesDraftFrom(r) {
        const keep = state.types;
        state.types = null;
        const d = typesDraft();
        state.types = keep;
        return d;
    }

    function editTypes() {
        if (!state.types) state.types = typesDraft();
        return state.types;
    }

    function typesPage(c) {
        const d = typesDraft();
        const dirty = typesDirty();
        const cols = [
            { t: 'Type / Source', w: 200, text: (x) => x.label },
            { t: 'Priority', w: 70, num: true, text: (x) => String(x.n) },
            { t: 'Weight', w: 80, num: true, text: (x) => String(x.weight) }
        ];
        const rows = d.order.map((k, i) => ({ key: k, data: { n: i + 1, label: typeLabel(k), weight: Number(d.weights[k] || 0) } }));
        return c.page('Type Ranking', dirty ? 'Changes not saved' : '', [
            { id: 'afr-types', title: 'Type Ranking', body: `<p>The order breaks ties: when two results score the same, the type higher in the list comes first. The weight is added to every result of that type or source; when a tag matches several sources, the source with the highest weight wins.</p>
                ${c.listView(cols, rows, { fit: true })}
                <div class="mmc-buttons">
                    <button type="button" class="btn-standard" data-act="move-up"${!c.sel || d.order.indexOf(c.sel) <= 0 ? ' disabled' : ''}>Move Up</button>
                    <button type="button" class="btn-standard" data-act="move-down"${!c.sel || d.order.indexOf(c.sel) < 0 || d.order.indexOf(c.sel) >= d.order.length - 1 ? ' disabled' : ''}>Move Down</button>
                    <button type="button" class="btn-standard" data-act="set-weight"${c.sel ? '' : ' disabled'}>Set Weight...</button>
                </div>
                <div class="mmc-buttons">
                    <button type="button" class="btn-standard" data-act="save-types"${dirty ? '' : ' disabled'}>Save</button>
                    <button type="button" class="btn-standard" data-act="discard-types"${dirty ? '' : ' disabled'}>Discard Changes</button>
                </div>` }
        ]);
    }

    function move(c, by) {
        const d = editTypes();
        const i = d.order.indexOf(c.sel);
        const j = i + by;
        if (i < 0 || j < 0 || j >= d.order.length) return;
        [d.order[i], d.order[j]] = [d.order[j], d.order[i]];
        c.renderActions();
        c.render();
        const list = c.el('.mmc-result .mmc-list');
        if (list) list.focus({ preventScroll: true });
    }

    async function setWeight(c) {
        const k = c.sel;
        if (!k) return;
        const d = typesDraft();
        let input = null;
        const html = `<p>Type the weight added to the score of every ${esc(typeLabel(k))} result.</p><p><label for="afrWeightInput">Weight:</label> <input type="text" inputmode="decimal" id="afrWeightInput" value="${esc(d.weights[k] != null ? d.weights[k] : 0)}" style="width:90px" autocomplete="off"></p>`;
        const ok = await c.box(html, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], {
            icon: 'question',
            title: `${typeLabel(k)} Weight`,
            onDialogReady: () => {
                input = document.getElementById('afrWeightInput');
                if (input) {
                    input.focus();
                    input.select();
                    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const b = document.querySelector('#confirmationDialog .btn-standard.primary'); if (b) { ev.preventDefault(); b.click(); } } });
                }
            }
        });
        if (ok !== true) return;
        const v = input ? input.value : '';
        if (badValue(v)) { await c.box('<p>The weight must be a number.</p>', null, { icon: 'error' }); return; }
        editTypes().weights[k] = Number(v);
        c.renderActions();
        c.render();
    }

    async function saveTypes(c) {
        const d = typesDraft();
        const typeWeights = {};
        d.order.forEach((k) => { const n = Number(d.weights[k]); typeWeights[k] = Number.isFinite(n) ? n : 0; });
        if (await submit(c, { typeOrder: d.order.slice(), typeWeights })) { state.types = null; c.note('The type ranking was saved.'); c.refresh(); }
    }

    // ---- saving and live updates ------------------------------------------------------------------------

    async function submit(c, patch) {
        if (!connected()) { await c.box('<p>Melaton is not connected to the server. Nothing was saved.</p>', null, { icon: 'error' }); return false; }
        state.saving = true;
        c.note('Saving...');
        try {
            const data = await ws().updateAutofillRanking(patch);
            if (!(data && data.success)) throw new Error((data && (data.error || data.message)) || 'The server did not save the ranking.');
            if (data.ranking) state.ranking = data.ranking;
            return true;
        } catch (err) {
            c.note('');
            await c.box(`<p>The autofill ranking could not be saved.</p><p>${esc((err && err.message) || 'The server did not answer.')}</p>`, null, { icon: 'error' });
            return false;
        } finally {
            state.saving = false;
        }
    }

    function bind(c) {
        const client = ws();
        if (!client || typeof client.on !== 'function') return;
        c.data.onUpdated = (msg) => {
            const r = (msg && msg.data && msg.data.ranking) || (msg && msg.ranking);
            if (!r) return;
            state.ranking = r;
            // unsaved edits are kept; a change made elsewhere shows under them
            if (!state.saving && (state.drafts.size || state.types)) c.note('The ranking was changed by someone else. Unsaved changes are kept.');
            const focused = document.activeElement;
            if (focused && c.modal.contains(focused) && focused.tagName === 'INPUT' && c.node === 'scoring') { c.renderActions(); return; }
            c.refresh();
        };
        client.on('autofill_ranking_updated', c.data.onUpdated);
    }

    function unbind(c) {
        const client = ws();
        if (client && typeof client.off === 'function' && c.data.onUpdated) client.off('autofill_ranking_updated', c.data.onUpdated);
    }

    // ---- the console ------------------------------------------------------------------------------------

    function nodes() {
        if (!isAdmin()) return [{ id: 'root', name: `${TITLE} (Local)`, icon: ICON16 }];
        return [{
            id: 'root',
            name: `${TITLE} (Local)`,
            icon: ICON16,
            children: [
                { id: 'test', name: 'Test', icon: ICON_TEST },
                { id: 'scoring', name: 'Scoring', icon: ICON_SCORING },
                { id: 'types', name: 'Type Ranking', icon: ICON_TYPES }
            ]
        }];
    }

    function deniedPage(c) {
        return c.page(TITLE, '', [{ id: 'afr-denied', title: 'Access Denied', body: `<div class="mmc-overview"><img src="${VI}/error-32.png" alt=""><div><p><b>Access is denied.</b></p><p>Only an administrator can view or change the autofill ranking. Sign in with an administrator account to use ${TITLE}.</p></div></div>` }]);
    }

    function rootPage(c) {
        const d = typesDraft();
        const r = ranking();
        const link = (id, name, text) => `<p><span class="mmc-link" data-act="nav:${id}">${esc(name)}</span><br>${esc(text)}</p>`;
        return c.page(TITLE, '', [
            { id: 'afr-overview', title: 'Overview', body: c.overview(ICON32, [
                'Autofill Ranking decides the order of the suggestions SmartText and autofill show while you type a prompt: tags, characters, text replacements, spell check and dynamic placeholders.',
                'The settings are shared by every user and take effect for everyone as soon as they are saved.'
            ]) },
            { id: 'afr-summary', title: 'Summary', body: c.props([
                ['Highest priority type', esc(typeLabel(d.order[0]))],
                ['Type order', esc(d.order.map(typeLabel).join(', '))],
                ['Scoring numbers', esc(String(scoringFields().length))],
                ['Ranking version', esc(String(r.rankingVersion != null ? r.rankingVersion : 1))]
            ]) },
            { id: 'afr-tasks', title: 'Tasks', body: link('test', 'Test a query', 'Run a query through the live autocomplete and see how every result was scored.')
                + link('scoring', 'Change the scoring', 'Tune match scores, usage bonuses, category penalties and match tiers.')
                + link('types', 'Change the type ranking', 'Set which result types come first and how much weight each one gets.') }
        ]);
    }

    function page(node, c) {
        if (!isAdmin()) return deniedPage(c);
        switch (node.id) {
            case 'test': return testPage(c);
            case 'scoring': return scoringPage(c);
            case 'types': return typesPage(c);
            default: return rootPage(c);
        }
    }

    function commands(node, c) {
        if (!isAdmin()) return [];
        switch (node.id) {
            case 'test': return [{ text: 'Run', action: 'run', disabled: state.test.running || !String(state.test.query || '').trim() }];
            case 'scoring': return [{ text: 'Save', action: 'save-scoring', disabled: !state.drafts.size }, { text: 'Discard Changes', action: 'discard-scoring', disabled: !state.drafts.size }];
            case 'types': return [{ text: 'Save', action: 'save-types', disabled: !typesDirty() }, { text: 'Discard Changes', action: 'discard-types', disabled: !typesDirty() }];
            default: return [];
        }
    }

    function selCommands(node, key) {
        if (node.id !== 'types' || !key) return null;
        const d = typesDraft();
        const i = d.order.indexOf(key);
        if (i < 0) return null;
        return { title: typeLabel(key), items: [
            { text: 'Move Up', action: 'move-up', disabled: i <= 0 },
            { text: 'Move Down', action: 'move-down', disabled: i >= d.order.length - 1 },
            { separator: true },
            { text: 'Set Weight...', action: 'set-weight' }
        ] };
    }

    async function action(a, c) {
        if (!isAdmin() && a !== 'help' && a !== 'refresh') return true;
        switch (a) {
            case 'refresh':
                if (typeof getAutofillRanking === 'function') state.ranking = getAutofillRanking();
                c.refresh();
                return true;
            case 'run': {
                const input = c.el('#afr-query');
                if (input) state.test.query = input.value;
                await runTest(c);
                return true;
            }
            case 'save-scoring': await saveScoring(c); return true;
            case 'discard-scoring': state.drafts.clear(); c.note(''); c.refresh(); return true;
            case 'move-up': move(c, -1); return true;
            case 'move-down': move(c, 1); return true;
            case 'set-weight': await setWeight(c); return true;
            case 'save-types': await saveTypes(c); return true;
            case 'discard-types': state.types = null; c.note(''); c.refresh(); return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('autofill-ranking'); return true;
            default: return false;
        }
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            nodes,
            page,
            commands,
            selCommands,
            toolbar: (node) => (node.id === 'root' || !isAdmin() ? [] : [{ id: 'refresh', i: 3, title: 'Refresh' }]),
            action,
            rowOpen: (key, node, c) => { if (node.id === 'types') void setWeight(c); },
            onSelectRow: (key, node, c) => { if (node.id === 'types') c.render(); },
            status: (node) => {
                if (!isAdmin()) return 'Access is denied.';
                if (node.id === 'test') return state.test.rows ? `${state.test.rows.length} results` : '';
                if (node.id === 'scoring') return state.drafts.size ? `${state.drafts.size} unsaved change${state.drafts.size === 1 ? '' : 's'}` : `${scoringFields().length} settings`;
                if (node.id === 'types') return typesDirty() ? 'Unsaved changes' : `${typesDraft().order.length} types`;
                return '';
            },
            about: { version: '1.0.0', lines: ['Autofill Ranking tunes how SmartText and autofill order their suggestions.'] },
            onOpen: (c) => { bind(c); },
            onClose: (c) => { unbind(c); }
        };
    }

    async function openAutofillRankingConsole(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        return root.mmcConsole.open(def(), node ? { node } : {});
    }

    root.openAutofillRankingConsole = openAutofillRankingConsole;
    root.mmcAutofillRanking = { open: openAutofillRankingConsole, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
