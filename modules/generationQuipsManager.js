const crypto = require('crypto');
const { z } = require('zod');
const {
    SHARED_QUIPS_WORKSPACE_ID,
    dedupeQuipEntries
} = require('./generationQuipsDatabase');
const {
    normalizeWorkspaceQuipSettings,
    getServerAutoUpdateConfig,
    getWorkspaceImageCount,
    shouldRunTimeBasedAutoUpdate,
    shouldRunCountBasedAutoUpdate,
    buildAutoUpdateStatus,
    computeGenerationProgress,
    MIN_PHRASES_PER_TERM,
    MAX_PHRASES_PER_TERM,
    DEFAULT_PHRASES_PER_TERM
} = require('./generationQuipsAutoUpdate');

function normalizePhrasesPerTerm(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return DEFAULT_PHRASES_PER_TERM;
    return Math.max(MIN_PHRASES_PER_TERM, Math.min(MAX_PHRASES_PER_TERM, n));
}

function buildQuipSchemas(phrasesPerTerm = DEFAULT_PHRASES_PER_TERM) {
    const min = normalizePhrasesPerTerm(phrasesPerTerm);
    const max = Math.max(min, MAX_PHRASES_PER_TERM);
    const QuipBatchSchema = z.object({
        quips: z.array(z.object({
            term: z.string(),
            phrases: z.array(z.string()).min(min).max(max)
        }))
    });
    const QuipSingleTermSchema = z.object({
        quips: z.array(z.object({
            term: z.string(),
            phrases: z.array(z.string()).min(min).max(max)
        })).min(1).max(1)
    });
    return { QuipBatchSchema, QuipSingleTermSchema, minPhrases: min, maxPhrases: max };
}

const STATIC_QUALITY_TERMS = new Set([
    'masterpiece', 'very aesthetic', 'no text', 'absurdres', 'best quality', 'amazing quality',
    'highres', 'high quality', 'great quality', 'good quality', 'normal quality', 'low quality',
    'worst quality', 'lowres', 'rating:general', 'rating:sensitive', 'rating:questionable',
    'rating:explicit', 'detailed eyes', 'detailed face', 'detailed skin', 'detailed realistic lived in background',
    'detailed', 'beautiful', 'intricate', 'intricate details', 'beautiful intricate details',
    'expert shading', 'expert lighting', 'deep shadows', 'deep skin', 'simple background', 'flat color',
    'flat colors', 'simple illustration', 'simple eyes', 'halftone', 'halftone background',
    'furry dataset', 'anime dataset', 'background dataset', 'not furry', 'location', 'indoors', 'outdoors',
    'three quarter view', 'cowboy shot', 'full body', 'from side', 'side view', 'solo',
    'girl', '1girl', '1boy', 'realistic', 'photorealistic', 'photorealism', 'hyperrealism',
    'negative space', 'blank page', 'white background', 'transparent background',
    'worst quality', 'bad quality', 'jpeg artifacts', 'chromatic aberration', 'film grain', 'scan artifacts',
    'artistic error', 'very displeasing', 'too many watermarks', 'multiple views', 'logo'
]);

const CATEGORY_PATTERNS = [
    { category: 'body', pattern: /\b(breast|hip|thigh|belly|waist|obese|plump|muscular|petite|curvy|thick|wide|huge|hyper|pear|chubby|fat|skinny|tall|short|body|torso|navel|abs|muscle)\b/i },
    { category: 'action', pattern: /\b(standing|sitting|lying|walking|running|eating|holding|looking|posing|spread|bending|kneeling|squatting|dancing|sleeping|streaming|selfie)\b/i },
    { category: 'transformation', pattern: /\b(expansion|transformation|morph|growth|inflation|weight gain|tf|hyper|alternate body)\b/i },
    { category: 'clothing', pattern: /\b(dress|skirt|uniform|bikini|lingerie|nude|naked|clothed|underwear|panties|bra|latex|bodysuit|shirt|pants|stockings|thighhighs)\b/i },
    { category: 'style', pattern: /\b(anime|realistic|3d|pixel|sketch|watercolor|oil painting|cel shading|lineart|monochrome|photorealistic|painterly)\b/i },
    { category: 'character', pattern: /\b(1girl|1boy|2girls|2boys|multiple girls|oc|original character)\b/i },
    { category: 'nsfw', pattern: /\b(nsfw|nude|naked|explicit|lewd|ecchi|hentai|nipples|pussy|penis|sex|cum|ahegao|orgasm)\b/i }
];

const GENERIC_DETAIL_PATTERN = /^(\{+|\}+)?\s*(detailed|beautiful|expert|intricate|perfect|high|amazing|best|aesthetic|quality|wallpaper|masterpiece)\b/i;
const QUALITY_ONLY_TAG_PATTERN = /^(masterpiece|best quality|very aesthetic|amazing quality|absurdres|highres|lowres|no text|location|detailed|beautiful|intricate|expert shading|expert lighting|anime dataset|furry dataset|background dataset|not furry|simple background|flat color|rating:(general|sensitive|questionable|explicit)|worst quality|bad quality|jpeg artifacts|negative space|blank page)$/i;
const UC_ARTIFACT_PATTERN = /\b(worst quality|bad quality|lowres|jpeg artifacts|bad anatomy|bad hands|watermark|unfinished|displeasing|chromatic aberration|scan artifacts|film grain|artistic error|mismatched pupils|glowing eyes|@_@)\b/i;

const TEXT_REPLACEMENT_NOISE_KEY = /^(quality|detailed|wallpaper|painterly|nquality_|nuc_)/i;

function normalizeFilterTerm(tag) {
    if (!tag || typeof tag !== 'string') return '';
    return tag.replace(/^[\{|\}|:]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isArtistTag(term) {
    const normalized = normalizeFilterTerm(term);
    return /^artist:/i.test(normalized) || /^art by /i.test(normalized);
}

function parseArtistDisplayName(term) {
    const normalized = normalizeFilterTerm(term);
    let name = normalized
        .replace(/^artist:\s*/i, '')
        .replace(/^art by\s+/i, '')
        .trim();
    name = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return name || normalized;
}

function parseCharacterDisplayName(term) {
    const normalized = normalizeFilterTerm(term);
    const name = normalized.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return name || normalized;
}

function isCharacterQuipTerm(t) {
    return t.kind === 'character' || t.category === 'character';
}

function categorizeTerm(term) {
    if (!term) return 'subject';
    if (isArtistTag(term)) return 'artist';
    if (/\([^)]+\)/.test(term) && !/rating:/i.test(term)) return 'character';
    for (const { category, pattern } of CATEGORY_PATTERNS) {
        if (pattern.test(term)) return category;
    }
    return 'subject';
}

const LEADING_MODIFIER_WORDS = new Set([
    'huge', 'hyper', 'large', 'small', 'thick', 'thin', 'wide', 'narrow', 'long', 'short',
    'very', 'extremely', 'slightly', 'super', 'mega', 'giant', 'mini', 'micro', 'big', 'little',
    'beautiful', 'detailed', 'alternate', 'perfect', 'plump', 'obese', 'skinny', 'chubby',
    'deep', 'raised', 'lowered', 'open', 'closed', 'half', 'full', 'bare', 'extra', 'massive',
    'enormous', 'gigantic', 'petite', 'muscular', 'heavy', 'light', 'soft', 'hard', 'tight', 'loose'
]);

function mapDbCategoryToQuipCategory(categoryName, entry) {
    if (!categoryName) return null;
    const lower = String(categoryName).toLowerCase();
    if (lower === 'character' || lower === 'copyright') return 'character';
    if (lower === 'artist') return 'artist';
    if (lower === 'species') return 'subject';
    if (lower === 'meta' || lower === 'general') {
        if (['body', 'clothing', 'action', 'transformation', 'nsfw'].includes(entry.category)) {
            return entry.category;
        }
        return 'subject';
    }
    return null;
}

function buildTagLookupCandidates(rawTerm) {
    const candidates = [];
    const add = (value) => {
        const normalized = normalizeFilterTerm(value);
        if (!normalized || normalized.length < 2) return;
        if (!candidates.includes(normalized)) candidates.push(normalized);
    };

    if (!rawTerm || typeof rawTerm !== 'string') return candidates;

    if (rawTerm.includes(PAIR_TERM_DELIMITER)) {
        for (const part of rawTerm.split(PAIR_TERM_DELIMITER)) add(part);
        return candidates;
    }

    const term = normalizeFilterTerm(rawTerm);
    if (!term) return candidates;

    if (isArtistTag(term)) {
        add(parseArtistDisplayName(term));
        return candidates;
    }

    add(term);

    let parenStripped = term;
    while (/\s*\([^)]+\)\s*$/.test(parenStripped)) {
        parenStripped = parenStripped.replace(/\s*\([^)]+\)\s*$/, '').trim();
        add(parenStripped);
    }

    const words = term.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
        let start = 0;
        while (start < words.length - 1 && LEADING_MODIFIER_WORDS.has(words[start])) {
            start += 1;
        }
        if (start > 0) add(words.slice(start).join(' '));

        for (let i = 1; i < words.length; i += 1) {
            add(words.slice(i).join(' '));
        }
    }

    return candidates;
}

async function lookupTagRowLight(tagLookup, candidate) {
    if (!tagLookup?.db || !candidate) return null;

    const normalized = tagLookup.normalizeTagName(candidate);
    const statements = tagLookup.getStatements();
    let row = await tagLookup.db.get(statements.getTagByNormalizedTitle, [normalized]);

    if (!row) {
        for (const variant of tagLookup.getTagNameLookupVariants(normalized)) {
            if (variant === normalized) continue;
            row = await tagLookup.db.get(statements.getTagByNormalizedTitle, [variant]);
            if (row) break;
        }
    }

    if (!row) {
        row = await tagLookup.db.get(statements.getTagByOtherNameExact, [normalized]);
    }

    if (!row) {
        for (const variant of tagLookup.getTagNameLookupVariants(normalized)) {
            if (variant === normalized) continue;
            row = await tagLookup.db.get(statements.getTagByOtherNameExact, [variant]);
            if (row) break;
        }
    }

    if (!row) return null;
    return tagLookup.mapRowToTag(row);
}

async function resolveTagLookupMatch(tagLookup, rawTerm) {
    const candidates = buildTagLookupCandidates(rawTerm);
    for (const candidate of candidates) {
        const tag = await lookupTagRowLight(tagLookup, candidate);
        if (tag) return { tag, matchedVia: candidate };
    }
    return { tag: null, matchedVia: null };
}

function tokenizeQualityText(text) {
    const terms = new Set();
    if (!text || typeof text !== 'string') return terms;

    const normalized = text
        .replace(/\{|\}|::/g, ' ')
        .replace(/\|/g, ',')
        .toLowerCase();

    normalized.split(',').forEach((part) => {
        const cleaned = part.replace(/\s+/g, ' ').trim();
        if (cleaned.length >= 2) terms.add(cleaned);
        cleaned.split(/\s+/).forEach((word) => {
            if (word.length >= 3) terms.add(word);
        });
    });

    return terms;
}

function buildPromptNoiseFilterSets(promptConfig) {
    const qualityFilters = new Set(STATIC_QUALITY_TERMS);
    const ucFilters = new Set();

    const addTokens = (value, targetSet) => {
        if (!value) return;
        if (typeof value === 'string') {
            tokenizeQualityText(value).forEach((t) => targetSet.add(t));
            return;
        }
        if (typeof value === 'object' && value.value) {
            tokenizeQualityText(value.value).forEach((t) => targetSet.add(t));
        }
    };

    if (!promptConfig) {
        return { qualityFilters, ucFilters };
    }

    if (promptConfig.quality_presets) {
        for (const presets of Object.values(promptConfig.quality_presets)) {
            if (typeof presets === 'string') addTokens(presets, qualityFilters);
            else if (Array.isArray(presets)) presets.forEach((v) => addTokens(v, qualityFilters));
        }
    }

    if (promptConfig.uc_presets) {
        for (const presets of Object.values(promptConfig.uc_presets)) {
            if (Array.isArray(presets)) {
                presets.forEach((v) => addTokens(v, ucFilters));
            } else {
                addTokens(presets, ucFilters);
            }
        }
    }

    if (Array.isArray(promptConfig.datasets)) {
        for (const dataset of promptConfig.datasets) {
            const target = dataset.negative ? ucFilters : qualityFilters;
            if (dataset.value) addTokens(dataset.value, target);
            if (Array.isArray(dataset.sub_toggles)) {
                for (const sub of dataset.sub_toggles) {
                    if (!sub.value) continue;
                    const subTarget = sub.negative ? ucFilters : target;
                    addTokens(sub.value, subTarget);
                }
            }
        }
    }

    if (promptConfig.text_replacements) {
        for (const [key, value] of Object.entries(promptConfig.text_replacements)) {
            if (/^GIC_[MF]_/i.test(key)) continue;
            if (!TEXT_REPLACEMENT_NOISE_KEY.test(key) && !/wallpaper|mixed_quality/i.test(key)) continue;
            if (/^NUC_/i.test(key)) {
                addTokens(value, ucFilters);
            } else {
                addTokens(value, qualityFilters);
            }
        }
    }

    for (const noise of ucFilters) {
        qualityFilters.add(noise);
    }

    return { qualityFilters, ucFilters };
}

function buildQualityFilterSet(promptConfig) {
    return buildPromptNoiseFilterSets(promptConfig).qualityFilters;
}

function termMatchesConfiguredNoise(tag, noiseSet) {
    const normalized = normalizeFilterTerm(tag);
    if (!normalized || normalized.length < 3) return true;

    if (noiseSet.has(normalized) || noiseSet.has(tag)) return true;
    if (QUALITY_ONLY_TAG_PATTERN.test(normalized)) return true;
    if (GENERIC_DETAIL_PATTERN.test(normalized)) return true;
    if (UC_ARTIFACT_PATTERN.test(normalized)) return true;
    if (/realistic-detailed|beautiful intricate/i.test(normalized)) return true;
    if (isArtistTag(normalized)) return false;

    for (const noise of noiseSet) {
        if (!noise || noise.length < 8) continue;
        if (normalized === noise) return true;
        if (noise.includes(normalized) && normalized.split(/\s+/).length <= 3) return true;
    }

    return false;
}

/** Drop tags that appear in too large a share of the workspace corpus. */
const MAX_UBIQUITY_RATIO = 0.4;

/** Sweet-spot band for distinctive-but-not-noise terms (share of corpus files). */
const DISTINCTIVE_RATIO_LOW = 0.06;
const DISTINCTIVE_RATIO_HIGH = 0.38;

const PAIR_TERM_DELIMITER = ' + ';

function isExcludedTerm(tag, qualityFilters, corpusFileCount, occurrenceCount) {
    if (!tag || tag.length < 3) return true;

    const normalized = normalizeFilterTerm(tag);
    if (!normalized || normalized.length < 3) return true;

    if (!isArtistTag(tag) && termMatchesConfiguredNoise(tag, qualityFilters)) return true;

    if (!isArtistTag(tag) && corpusFileCount >= 12 && occurrenceCount / corpusFileCount >= MAX_UBIQUITY_RATIO) {
        return true;
    }

    return false;
}

const CATEGORY_SCORE_BOOST = {
    character: 1.85,
    artist: 1.0,
    body: 1.4,
    clothing: 1.15,
    action: 1.5,
    transformation: 1.6,
    subject: 1.1,
    combo: 1.05,
    nsfw: 1.0,
    style: 0.55
};

function termFrequencyRatio(occurrenceCount, corpusFileCount) {
    if (!corpusFileCount) return 0;
    return occurrenceCount / corpusFileCount;
}

function distinctivenessBandBoost(ratio) {
    if (ratio < DISTINCTIVE_RATIO_LOW || ratio > DISTINCTIVE_RATIO_HIGH) {
        return 0.55;
    }
    const center = (DISTINCTIVE_RATIO_LOW + DISTINCTIVE_RATIO_HIGH) / 2;
    const halfSpan = (DISTINCTIVE_RATIO_HIGH - DISTINCTIVE_RATIO_LOW) / 2;
    return 0.75 + 0.25 * (1 - Math.abs(ratio - center) / halfSpan);
}

function scoreTermDistinctiveness(row, corpusFileCount) {
    const count = row.occurrenceCount || 0;
    if (count < 1) return 0;

    const ratio = termFrequencyRatio(count, corpusFileCount);
    if (ratio >= MAX_UBIQUITY_RATIO) return 0;

    const idf = Math.log((corpusFileCount + 1) / (count + 1));
    const displayTerm = row.originalTag || row.tag || '';
    const wordCount = displayTerm.trim().split(/\s+/).length;
    const phraseBoost = wordCount >= 2 ? 1 + Math.min(wordCount - 1, 3) * 0.3 : 1;
    const weightBoost = 1 + Math.min(Math.max((row.avgWeight || 1) - 1, 0), 1.5) * 0.2;

    let ubiquityPenalty = 1;
    if (ratio > 0.28) {
        ubiquityPenalty = Math.max(0.08, 1 - ((ratio - 0.28) / (MAX_UBIQUITY_RATIO - 0.28)));
    }

    const category = categorizeTerm(displayTerm);
    const categoryBoost = CATEGORY_SCORE_BOOST[category] ?? 1;

    return Math.sqrt(count) * idf * phraseBoost * weightBoost * ubiquityPenalty
        * distinctivenessBandBoost(ratio) * categoryBoost;
}

function scoreTagPairDistinctiveness(row, corpusFileCount, tagCounts) {
    const count = row.coOccurrenceCount || 0;
    if (count < 1) return 0;

    const count1 = tagCounts.get(row.tag1) || count;
    const count2 = tagCounts.get(row.tag2) || count;
    const ratio1 = termFrequencyRatio(count1, corpusFileCount);
    const ratio2 = termFrequencyRatio(count2, corpusFileCount);

    if (ratio1 >= MAX_UBIQUITY_RATIO || ratio2 >= MAX_UBIQUITY_RATIO) return 0;

    const ratio = termFrequencyRatio(count, corpusFileCount);
    if (ratio >= 0.42) return 0;

    const expectedCo = (count1 * count2) / Math.max(corpusFileCount, 1);
    const associationLift = count / Math.max(expectedCo, 1);
    if (associationLift < 1.1) return 0;

    const idf = Math.log((corpusFileCount + 1) / (count + 1));
    const weightBoost = 1 + Math.min(Math.max((row.avgWeight || 1) - 1, 0), 1.5) * 0.15;
    const liftBoost = Math.min(associationLift, 3);

    let ubiquityPenalty = 1;
    if (ratio > 0.22) {
        ubiquityPenalty = Math.max(0.1, 1 - ((ratio - 0.22) / 0.2));
    }

    return Math.sqrt(count) * idf * weightBoost * ubiquityPenalty
        * distinctivenessBandBoost(ratio) * liftBoost;
}

function selectDiverseTerms(scoredCandidates, limit, options = {}) {
    const defaultCap = options.maxPerCategory ?? Math.max(3, Math.ceil(limit / 6));
    const categoryCaps = options.categoryCaps || {};
    const sorted = [...scoredCandidates].sort((a, b) => b.score - a.score);
    const selected = [];
    const selectedTerms = new Set();
    const categoryCounts = {};

    const tryAdd = (item) => {
        if (selected.length >= limit || selectedTerms.has(item.term)) return false;
        const cat = item.category || 'subject';
        const cap = categoryCaps[cat] ?? defaultCap;
        if ((categoryCounts[cat] || 0) >= cap) return false;
        selected.push(item);
        selectedTerms.add(item.term);
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        return true;
    };

    for (const item of sorted) {
        tryAdd(item);
        if (selected.length >= limit) break;
    }

    if (selected.length < limit) {
        for (const item of sorted) {
            if (selected.length >= limit) break;
            if (selectedTerms.has(item.term)) continue;
            selected.push(item);
            selectedTerms.add(item.term);
        }
    }

    return selected;
}

function buildSharedAndUniqueTerms(extracted) {
    const termToWorkspaces = new Map();
    const uniqueByWorkspace = {};

    for (const [workspaceId, data] of Object.entries(extracted)) {
        uniqueByWorkspace[workspaceId] = {
            ...data,
            terms: []
        };

        for (const termRow of data.terms || []) {
            const key = normalizeFilterTerm(termRow.term);
            if (!key) continue;

            if (!termToWorkspaces.has(key)) {
                termToWorkspaces.set(key, {
                    workspaces: new Set(),
                    term: {
                        ...termRow,
                        term: key
                    }
                });
            }

            const record = termToWorkspaces.get(key);
            record.workspaces.add(workspaceId);
            record.term.occurrenceCount = (record.term.occurrenceCount || 0) + (termRow.occurrenceCount || 0);
        }
    }

    const sharedTerms = [];

    for (const record of termToWorkspaces.values()) {
        if (record.workspaces.size > 1) {
            sharedTerms.push(record.term);
            continue;
        }

        const workspaceId = [...record.workspaces][0];
        uniqueByWorkspace[workspaceId].terms.push(record.term);
    }

    return { sharedTerms, uniqueByWorkspace };
}

class GenerationQuipsManager {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('GenerationQuipsManager requires globalResources instance');
        }
        this.globalResources = globalResources;
        this._pipelineRunning = false;
        this._autoUpdateMinuteTimer = null;
        this._autoUpdateCountTimer = null;
        this._wsServer = null;
        this._generationPreviews = [];
        this.getDatabase().reconcileStaleGenerationState({ forceIfRunning: true });
    }

    updateWorkspaceQuipSettings(workspaceId, patch) {
        const current = this.getAutoUpdateUserSettings(workspaceId);
        const merged = normalizeWorkspaceQuipSettings({ ...current, ...patch });
        this.getDatabase().persistWorkspaceQuipSettings(workspaceId, merged);
        this.notifyQuipsSettingsChanged();
        return merged;
    }

    applyWorkspaceQuipSettingsPatch(patch) {
        if (!patch?.byWorkspace || typeof patch.byWorkspace !== 'object') return;

        for (const [workspaceId, wsPatch] of Object.entries(patch.byWorkspace)) {
            this.updateWorkspaceQuipSettings(workspaceId, wsPatch);
        }
    }

    getWsServer() {
        return this._wsServer || this.globalResources.webSocketServer || null;
    }

    notifyQuipsSettingsChanged() {
        if (!this.getWsServer()) return;
        this.startAutoUpdateScheduler();
        this.broadcastQuipsStatus();
    }

    clearGenerationPreviews() {
        this._generationPreviews = [];
    }

    addGenerationPreviews(entries, workspaceName) {
        if (!Array.isArray(entries) || entries.length === 0) return;
        for (const entry of entries) {
            if (!entry?.term || !Array.isArray(entry.phrases) || entry.phrases.length === 0) continue;
            this._generationPreviews.push({
                term: entry.term,
                phrase: entry.phrases[0],
                workspaceName: workspaceName || null
            });
        }
        if (this._generationPreviews.length > 24) {
            this._generationPreviews = this._generationPreviews.slice(-24);
        }
    }

    broadcastQuipsProgress(wsServer, payload) {
        const target = wsServer || this.getWsServer();
        if (!target || typeof target.broadcastToAll !== 'function') return;
        target.broadcastToAll({
            type: 'generation_quips_progress',
            data: {
                ...payload,
                status: payload.status || this.buildBroadcastStatus()
            },
            timestamp: new Date().toISOString()
        });
    }

    buildBroadcastStatus() {
        const db = this.getDatabase();
        const stats = db.getStats();
        const generation = db.reconcileStaleGenerationState({ maxRunningIdleSec: 180 });
        const generationWithLive = generation.status === 'running'
            ? {
                ...generation,
                progress: computeGenerationProgress(generation),
                recentPreviews: this._generationPreviews.slice(-8)
            }
            : generation;

        const config = this.globalResources.getConfig() || {};
        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        const nowSec = Math.floor(Date.now() / 1000);
        const STALE_QUIP_AGE_SEC = 90 * 24 * 60 * 60;
        const workspaceSummaries = [];
        const autoUpdateByWorkspace = {};

        for (const [id, ws] of Object.entries(workspaces)) {
            const wsQuips = db.getWorkspaceQuipStats(id);
            let needsGeneration = wsQuips.termCount === 0;
            let generationStaleReason = needsGeneration ? 'none' : null;

            if (!needsGeneration) {
                if (!wsQuips.lastGeneratedAt) {
                    needsGeneration = true;
                    generationStaleReason = 'missing';
                } else if (nowSec - wsQuips.lastGeneratedAt > STALE_QUIP_AGE_SEC) {
                    needsGeneration = true;
                    generationStaleReason = 'stale';
                }
            }

            workspaceSummaries.push({
                id,
                name: ws.name || id,
                termCount: wsQuips.termCount,
                phraseCount: wsQuips.phraseCount,
                extractedTermCount: wsQuips.extractedTermCount,
                minPhrasesPerTerm: wsQuips.minPhrasesPerTerm,
                maxPhrasesPerTerm: wsQuips.maxPhrasesPerTerm,
                lastGeneratedAt: wsQuips.lastGeneratedAt,
                needsGeneration,
                generationStaleReason
            });

            autoUpdateByWorkspace[id] = this.getAutoUpdateStatus(id);
        }

        return {
            versionHash: stats.versionHash,
            totalQuipTerms: stats.quipCount,
            totalWorkspacesWithQuips: stats.workspaceCount,
            extractedTermRows: stats.extractedTermRows,
            generation: generationWithLive,
            workspaces: workspaceSummaries,
            autoUpdateByWorkspace
        };
    }

    broadcastQuipsStatus(wsServer = null) {
        const target = wsServer || this.getWsServer();
        if (!target || typeof target.broadcastToAll !== 'function') return;
        target.broadcastToAll({
            type: 'generation_quips_status',
            data: this.buildBroadcastStatus(),
            timestamp: new Date().toISOString()
        });
    }

    publishGenerationProgress(statePatch, options = {}) {
        const db = this.getDatabase();
        const generation = db.updateGenerationState(statePatch);

        if (options.previews && options.previews.length) {
            this.addGenerationPreviews(options.previews, options.workspaceName);
        }

        const progress = computeGenerationProgress(generation);
        this.broadcastQuipsProgress(options.wsServer || this.getWsServer(), {
            status: 'progress',
            generation,
            progress,
            recentPreviews: this._generationPreviews.slice(-8)
        });

        return generation;
    }

    getAutoUpdateUserSettings(workspaceId = 'default') {
        const raw = this.getDatabase().getWorkspaceQuipSettingsRaw(workspaceId);
        return normalizeWorkspaceQuipSettings(raw);
    }

    getAutoUpdateStatus(workspaceId = 'default') {
        const config = this.globalResources.getConfig() || {};
        const settings = this.getAutoUpdateUserSettings(workspaceId);
        const state = this.getDatabase().getAutoUpdateState(workspaceId);
        return buildAutoUpdateStatus(settings, state, this.globalResources, config, workspaceId);
    }

    recordAutoUpdateRun(workspaceId, schedule) {
        const imageCount = getWorkspaceImageCount(this.globalResources, workspaceId);
        return this.getDatabase().updateAutoUpdateState(workspaceId, {
            last_run_at: Math.floor(Date.now() / 1000),
            last_run_schedule: schedule || null,
            image_count: imageCount
        });
    }

    touchCountBasedCheckTimestamp(workspaceId) {
        return this.getDatabase().updateAutoUpdateState(workspaceId, {
            last_count_check_at: Math.floor(Date.now() / 1000)
        });
    }

    startAutoUpdateScheduler() {
        const wsServer = this.getWsServer();
        if (wsServer) this._wsServer = wsServer;
        this.stopAutoUpdateScheduler();

        this._autoUpdateMinuteTimer = setInterval(() => {
            this.evaluateAutoUpdate('time').catch((error) => {
                console.error('❌ Generation quips time-based auto-update check failed:', error);
            });
        }, 60 * 1000);

        const serverConfig = getServerAutoUpdateConfig(this.globalResources.getConfig() || {});
        const countIntervalMs = serverConfig.countBasedCheckIntervalHours * 60 * 60 * 1000;
        this._autoUpdateCountTimer = setInterval(() => {
            this.evaluateAutoUpdate('count').catch((error) => {
                console.error('❌ Generation quips count-based auto-update check failed:', error);
            });
        }, countIntervalMs);

        setImmediate(() => {
            this.evaluateAutoUpdate('count').catch(() => {});
        });
    }

    stopAutoUpdateScheduler() {
        if (this._autoUpdateMinuteTimer) {
            clearInterval(this._autoUpdateMinuteTimer);
            this._autoUpdateMinuteTimer = null;
        }
        if (this._autoUpdateCountTimer) {
            clearInterval(this._autoUpdateCountTimer);
            this._autoUpdateCountTimer = null;
        }
    }

    async evaluateAutoUpdate(kind = 'time') {
        if (this.isPipelineRunning()) return { skipped: 'running' };

        const config = this.globalResources.getConfig() || {};
        const serverConfig = getServerAutoUpdateConfig(config);
        const nowMs = Date.now();
        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();

        for (const workspaceId of Object.keys(workspaces)) {
            const settings = this.getAutoUpdateUserSettings(workspaceId);
            if (!settings.enabled || settings.schedule === 'disabled') continue;

            const state = this.getDatabase().getAutoUpdateState(workspaceId);
            let due = false;

            if (kind === 'count') {
                this.touchCountBasedCheckTimestamp(workspaceId);
                due = shouldRunCountBasedAutoUpdate(
                    settings, state, nowMs, serverConfig, this.globalResources, workspaceId
                );
            } else {
                due = shouldRunTimeBasedAutoUpdate(settings, state, nowMs, serverConfig);
            }

            if (!due) continue;

            const pipelineOptions = {
                workspaceFilter: workspaceId,
                limit: settings.termLimit,
                grokBatchSize: settings.grokBatchSize,
                phrasesPerTerm: settings.phrasesPerTerm
            };

            console.log(`🕒 Auto-updating generation quips for "${workspaceId}" (${settings.schedule})…`);
            this.recordAutoUpdateRun(workspaceId, settings.schedule);

            const result = this.startPipelineInBackground(pipelineOptions, this.getWsServer());
            if (result.started === false) {
                console.warn(`⚠️ Generation quips auto-update for "${workspaceId}" could not start:`, result.message);
            }
            return { ...result, workspaceId };
        }

        return { skipped: 'not_due' };
    }

    reconcileGenerationState() {
        return this.getDatabase().reconcileStaleGenerationState({ maxRunningIdleSec: 180 });
    }

    isPipelineRunning() {
        if (this._pipelineRunning) return true;
        const state = this.reconcileGenerationState();
        return state?.status === 'running';
    }

    broadcastQuipsUpdate(wsServer, payload) {
        if (!wsServer || typeof wsServer.broadcastToAll !== 'function') return;
        wsServer.broadcastToAll({
            type: 'generation_quips_updated',
            data: payload,
            timestamp: new Date().toISOString()
        });
    }

    startPipelineInBackground(options = {}, wsServer = null) {
        if (this.isPipelineRunning()) {
            return {
                started: false,
                reason: 'already_running',
                message: 'A quip scan is already in progress'
            };
        }

        this._pipelineRunning = true;
        this.clearGenerationPreviews();
        if (wsServer) this._wsServer = wsServer;
        const workspaceFilter = options.workspaceFilter || null;
        const scopeLabel = workspaceFilter ? 'workspace' : 'all';

        this.publishGenerationProgress({
            status: 'running',
            phase: 'extracting',
            message: workspaceFilter
                ? 'Scanning and updating quips for this workspace…'
                : 'Scanning and updating quips for all workspaces…',
            error: null,
            started_at: Math.floor(Date.now() / 1000)
        }, { wsServer });

        setImmediate(async () => {
            try {
                const result = await this.runFullPipeline({
                    workspaceFilter,
                    extractOnly: options.extractOnly === true,
                    generateOnly: options.generateOnly === true,
                    limit: options.limit,
                    grokBatchSize: options.grokBatchSize,
                    phrasesPerTerm: options.phrasesPerTerm
                }, wsServer);

                const completeMessage = options.extractOnly === true
                    ? `Terms extracted for ${Object.keys(result.extracted || {}).length} workspace(s)`
                    : (result.stats && result.totalQuips != null
                        ? `Quips updated — ${result.totalQuips} terms (${scopeLabel})`
                        : 'Quips updated');

                this.broadcastQuipsUpdate(wsServer, {
                    versionHash: result.versionHash || result.stats?.versionHash,
                    totalQuips: result.totalQuips,
                    workspaceFilter,
                    scope: scopeLabel,
                    status: 'complete',
                    message: completeMessage
                });
                this.broadcastQuipsStatus(wsServer);
            } catch (error) {
                console.error('❌ Generation quips pipeline failed:', error);
                this.broadcastQuipsUpdate(wsServer, {
                    status: 'error',
                    workspaceFilter,
                    scope: scopeLabel,
                    message: error.message || 'Quip generation failed'
                });
                this.broadcastQuipsStatus(wsServer);
            } finally {
                this._pipelineRunning = false;
            }
        });

        return {
            started: true,
            scope: scopeLabel,
            workspaceFilter,
            message: workspaceFilter
                ? 'Scanning and updating quips for this workspace…'
                : 'Scanning and updating quips for all workspaces…'
        };
    }

    getDatabase() {
        return this.globalResources.getGenerationQuipsDatabase();
    }

    buildQualityFilters() {
        const promptConfig = this.globalResources.getPromptConfig({ clone: false });
        return buildPromptNoiseFilterSets(promptConfig).qualityFilters;
    }

    async enrichTermsWithTagLookup(terms) {
        if (!terms || terms.length === 0) return terms;

        const tagLookup = this.globalResources.getTagDatabase();
        if (!tagLookup?.db) return terms;

        const matchResults = await Promise.all(terms.map(async (entry) => {
            if (entry.kind === 'pair') {
                const parts = (entry.originalTag || entry.term).split(PAIR_TERM_DELIMITER);
                const partMatches = await Promise.all(parts.map((part) => resolveTagLookupMatch(tagLookup, part)));
                return { entry, tag: null, matchedVia: null, partMatches };
            }

            const { tag, matchedVia } = await resolveTagLookupMatch(tagLookup, entry.term);
            return { entry, tag, matchedVia, partMatches: null };
        }));

        const wikiTags = [];
        for (const result of matchResults) {
            if (result.tag?.id && result.tag.hasWiki) wikiTags.push(result.tag);
            if (result.partMatches) {
                for (const part of result.partMatches) {
                    if (part.tag?.id && part.tag.hasWiki) wikiTags.push(part.tag);
                }
            }
        }

        if (wikiTags.length > 0) {
            await tagLookup.attachPrimaryBodyPreviews(wikiTags);
        }

        for (const { entry, tag, matchedVia, partMatches } of matchResults) {
            if (partMatches) {
                const parts = (entry.originalTag || entry.term).split(PAIR_TERM_DELIMITER);
                const wikiParts = [];
                const dbCategories = [];
                const lookupVias = [];

                partMatches.forEach((part, index) => {
                    if (!part.tag) return;
                    const partLabel = parts[index] || part.matchedVia || `part ${index + 1}`;
                    const categoryName = part.tag.categoryName || tagLookup.getCategoryName(part.tag.category);
                    if (categoryName) dbCategories.push(categoryName);
                    if (part.matchedVia && part.matchedVia !== normalizeFilterTerm(partLabel)) {
                        lookupVias.push(`${partLabel}→${part.matchedVia}`);
                    }
                    if (part.tag.primaryBody) {
                        wikiParts.push(`${partLabel}: ${part.tag.primaryBody}`);
                    }
                });

                if (dbCategories.length > 0) {
                    entry.tagDbCategoryName = [...new Set(dbCategories)].join(' + ');
                }
                if (lookupVias.length > 0) entry.tagLookupVia = lookupVias.join('; ');
                if (wikiParts.length > 0) entry.wikiContext = wikiParts.join(' | ');
                continue;
            }

            if (!tag) continue;

            entry.tagDbTitle = tag.title || entry.originalTag || entry.term;
            entry.tagDbCategoryName = tag.categoryName || tagLookup.getCategoryName(tag.category);

            if (matchedVia && matchedVia !== normalizeFilterTerm(entry.term)) {
                entry.tagLookupVia = matchedVia;
            }

            if (tag.primaryBody) {
                entry.wikiContext = tag.primaryBody;
            }

            if (entry.kind !== 'artist' && entry.category !== 'artist') {
                const mapped = mapDbCategoryToQuipCategory(entry.tagDbCategoryName, entry);
                if (mapped) entry.category = mapped;
            }
        }

        return terms;
    }

    async extractTermsForWorkspace(workspaceId, workspaceFiles, options = {}) {
        const {
            limit = 50,
            minFileCount = 4,
            minCorpusFiles = 12,
            pairSlotRatio = 0.28
        } = options;

        const metadataDb = this.globalResources.getMetadataDatabase();
        const qualityFilters = this.buildQualityFilters();
        const corpusFileCount = workspaceFiles.length;

        if (corpusFileCount < minCorpusFiles) {
            return [];
        }

        const pairLimit = Math.max(6, Math.round(limit * pairSlotRatio));
        const singleLimit = Math.max(1, limit - pairLimit);
        const categoryCaps = {
            character: Math.max(10, Math.ceil(limit * 0.34)),
            artist: Math.max(4, Math.ceil(limit * 0.12)),
            style: 3,
            subject: Math.ceil(limit / 4)
        };

        const [rawSingles, rawPairs, rawCharacters] = await Promise.all([
            metadataDb.getPromptTermStatsForFilenames(workspaceFiles, {
                limit: limit * 5,
                sources: ['prompt', 'character_prompt', 'v4_character_caption']
            }),
            metadataDb.getPromptTagPairStatsForFilenames(workspaceFiles, {
                limit: Math.max(300, pairLimit * 20),
                minCoCount: minFileCount,
                sources: ['prompt', 'character_prompt', 'v4_character_caption']
            }),
            metadataDb.getCharacterStatsForFilenames(workspaceFiles, { limit: 40 })
        ]);

        const scoredSingles = [];
        const seenTerms = new Set();

        for (const row of rawCharacters) {
            const term = normalizeFilterTerm(row.characterName);
            if (!term || term.length < 3 || seenTerms.has(term)) continue;
            if (isExcludedTerm(term, qualityFilters, corpusFileCount, row.occurrenceCount)) continue;

            const score = scoreTermDistinctiveness({
                tag: term,
                originalTag: row.characterName,
                occurrenceCount: row.occurrenceCount,
                avgWeight: 1.2
            }, corpusFileCount) * 1.25;

            if (score <= 0) continue;

            scoredSingles.push({
                term,
                originalTag: row.characterName,
                occurrenceCount: row.occurrenceCount,
                avgWeight: 1.2,
                category: 'character',
                score,
                kind: 'character'
            });
            seenTerms.add(term);
        }

        for (const row of rawSingles) {
            if (row.occurrenceCount < minFileCount) continue;
            if (seenTerms.has(row.tag)) continue;
            if (isExcludedTerm(row.tag, qualityFilters, corpusFileCount, row.occurrenceCount)) continue;

            const category = categorizeTerm(row.tag);
            const score = scoreTermDistinctiveness(row, corpusFileCount);
            if (score <= 0) continue;

            const entry = {
                term: row.tag,
                originalTag: row.originalTag,
                occurrenceCount: row.occurrenceCount,
                avgWeight: row.avgWeight,
                category,
                score,
                kind: category === 'artist' ? 'artist' : 'single'
            };
            if (category === 'artist') {
                entry.artistName = parseArtistDisplayName(row.tag);
            }

            scoredSingles.push(entry);
            seenTerms.add(row.tag);
        }

        const tagCounts = new Map(rawSingles.map((row) => [row.tag, row.occurrenceCount]));

        const scoredPairs = [];
        for (const row of rawPairs) {
            if (row.coOccurrenceCount < minFileCount) continue;

            const count1 = tagCounts.get(row.tag1) || row.coOccurrenceCount;
            const count2 = tagCounts.get(row.tag2) || row.coOccurrenceCount;
            if (isExcludedTerm(row.tag1, qualityFilters, corpusFileCount, count1)) continue;
            if (isExcludedTerm(row.tag2, qualityFilters, corpusFileCount, count2)) continue;

            const score = scoreTagPairDistinctiveness(row, corpusFileCount, tagCounts);
            if (score <= 0) continue;

            const originalTag = `${row.originalTag1}${PAIR_TERM_DELIMITER}${row.originalTag2}`;
            scoredPairs.push({
                term: originalTag.toLowerCase(),
                originalTag,
                occurrenceCount: row.coOccurrenceCount,
                avgWeight: row.avgWeight,
                category: 'combo',
                score,
                kind: 'pair'
            });
        }

        const pickedPairs = selectDiverseTerms(scoredPairs, pairLimit, {
            maxPerCategory: pairLimit
        });
        const pickedSingles = selectDiverseTerms(scoredSingles, singleLimit + (pairLimit - pickedPairs.length), {
            categoryCaps
        });

        const merged = [...pickedSingles, ...pickedPairs].map((entry) => {
            const mapped = {
                term: entry.term,
                originalTag: entry.originalTag,
                occurrenceCount: entry.occurrenceCount,
                avgWeight: entry.avgWeight,
                category: entry.category,
                kind: entry.kind
            };
            if (entry.artistName) mapped.artistName = entry.artistName;
            return mapped;
        });

        return this.enrichTermsWithTagLookup(merged);
    }

    async extractAllWorkspaceTerms(options = {}) {
        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        const results = {};
        const workspaceFilter = options.workspaceFilter || null;

        for (const [workspaceId, workspace] of Object.entries(workspaces)) {
            if (workspaceFilter && workspaceId !== workspaceFilter) continue;

            const files = [...(workspace.files || []), ...(workspace.scraps || [])];
            if (files.length < 12) continue;

            const terms = await this.extractTermsForWorkspace(workspaceId, files, options);
            if (terms.length === 0) continue;

            this.getDatabase().replaceExtractedTerms(workspaceId, terms);
            results[workspaceId] = {
                name: workspace.name || workspaceId,
                fileCount: files.length,
                terms
            };
        }

        return results;
    }

    buildGrokSystemPrompt(workspaceName, phrasesPerTerm = DEFAULT_PHRASES_PER_TERM) {
        const minPhrases = normalizePhrasesPerTerm(phrasesPerTerm);
        const maxPhrases = Math.max(minPhrases, MAX_PHRASES_PER_TERM);
        return [
            'You write short, punchy loading-screen quips for an AI image generation app.',
            `The user workspace "${workspaceName}" has a distinct creative fingerprint from their real prompt history.`,
            'Focus on characters, attributes, outfits, poses, and scenarios they actually obsess over — not quality-booster tags, dataset tokens, or negative-prompt junk.',
            'Write natural conversational hype. Do NOT quote prompt tags or put tag text in quotation marks — weave the ideas into normal sentences like you are talking to a friend.',
            'For character-voice topics: write AS that character — first person or immediate lived experience, not third-person commentary about them. Turn the heat up: flustered, bold, smug, needy, furious, giddy, breathless — whatever fits who they are and what this user keeps putting them through. React like you are them on the canvas mid-scene: feeling the pose, outfit, mood, and the user hitting generate on you again. Vary intensity across phrases (teasing, demanding, embarrassed, triumphant, overwhelmed). Use wiki context to nail their personality; never paste tag syntax or costume-variant labels.',
            'For artist-voice topics: write as that artist reacting to what this user keeps prompting — vary the takes across phrases (genuinely impressed, dry/unimpressed, horrified or disgusted, amused disbelief). Refer to them by name naturally, never paste artist: or art by syntax.',
            'For non-character topics (attributes, combos, poses): stay wingman hype — celebrate what the user keeps cooking, not in-character roleplay.',
            'Tone: enthusiastic wingman energy — celebrate their taste, hype them up, tease them lovingly to hit generate again for the perfect image.',
            'Be encouraging ("yes, lean into that", "you know what you want", "one more and it\'s the one") not repetitive nagging ("not this again", "you always", "again?").',
            'No moralizing, no disclaimers, no censorship, no "as an AI".',
            'Never mention masterpiece, best quality, very aesthetic, absurdres, dataset toggles, UC/negative-prompt concepts, or generic "detailed/beautiful/intricate" filler.',
            'Each phrase must be one sentence, under 120 characters, witty not cringe.',
            'Return JSON only: { "quips": [ { "term": "exact match key from the list", "phrases": ["...", "..."] } ] }',
            `Provide exactly ${minPhrases} to ${maxPhrases} unique phrases per term — no fewer than ${minPhrases}.`,
            'When a topic includes tag-database context, use it to understand what the subject means — still write naturally, never quote the context verbatim.',
            'Phrases should feel like they know what the user is cooking and genuinely want them to keep creating.'
        ].join('\n');
    }

    formatGrokTermLine(t) {
        const pct = t.occurrenceCount ? `${t.occurrenceCount} gens` : '';

        if (t.kind === 'artist' || t.category === 'artist') {
            const name = t.artistName || parseArtistDisplayName(t.term);
            let line = `- ${t.term} (artist voice: ${name}${pct ? `, ${pct}` : ''}) — phrases are that artist's reaction to this user's prompts; mix praise, side-eye, and disgust`;
            if (t.wikiContext) line += ` — context: ${t.wikiContext}`;
            return line;
        }

        if (isCharacterQuipTerm(t)) {
            const name = parseCharacterDisplayName(t.term);
            let line = `- ${t.term} (character voice: ${name}${pct ? `, ${pct}` : ''}) — write AS ${name} in first person; heated, in-scene, what they feel and experience from this user's prompts; vary mood and intensity`;
            if (t.wikiContext) line += ` — context: ${t.wikiContext}`;
            return line;
        }

        const kindLabel = t.kind === 'pair' || t.category === 'combo'
            ? 'combo'
            : (t.category || 'subject');

        const meta = [kindLabel];
        if (t.tagDbCategoryName) meta.push(`tag DB: ${t.tagDbCategoryName}`);
        if (t.tagLookupVia) meta.push(`matched via ${t.tagLookupVia}`);
        if (pct) meta.push(pct);

        let line = `- ${t.term} (${meta.join(', ')})`;
        if (t.wikiContext) line += ` — context: ${t.wikiContext}`;
        return line;
    }

    buildGrokUserPrompt(terms, workspaceName, phrasesPerTerm = DEFAULT_PHRASES_PER_TERM) {
        const minPhrases = normalizePhrasesPerTerm(phrasesPerTerm);
        const lines = terms.map((t) => this.formatGrokTermLine(t));

        return [
            `Generate targeted quips for workspace "${workspaceName}".`,
            'Topics below are characters, artists, attributes, and combos this user returns to (quality presets, datasets, and UC noise already stripped):',
            'Lines marked "character voice" must be in-character, first-person, heated reactions — what that person is living through on the page, not a narrator describing them.',
            'Lines marked "artist voice" are that creator reacting to the user\'s prompt habits.',
            'Combo topics use " + " — allude to both ideas together in natural speech.',
            'Context lines come from the local tag wiki when available — use them for meaning, not as text to repeat.',
            ...lines,
            '',
            `Return the exact term key for each entry (lowercase). Provide at least ${minPhrases} phrases per term.`,
            'Write phrases in plain conversational English — mention the subject naturally, never paste or quote the raw tag string.'
        ].join('\n');
    }

    parseQuipResponse(grokService, raw, schema) {
        if (typeof raw !== 'string' || !raw.trim()) return null;
        try {
            const json = JSON.parse(raw);
            const validated = schema.safeParse(json);
            if (validated.success) return validated.data.quips;
        } catch {
            const graceful = grokService.gracefulParse(schema, raw, 'generation quips');
            if (graceful.success) return graceful.data.quips;
        }
        return null;
    }

    normalizeQuipEntry(entry) {
        if (!entry?.term || !Array.isArray(entry.phrases)) return null;
        const phrases = entry.phrases
            .filter((p) => typeof p === 'string' && p.trim())
            .map((p) => p.trim());
        if (phrases.length === 0) return null;
        return {
            term: entry.term.toLowerCase().trim(),
            phrases
        };
    }

    async callGrokForQuips(grokService, workspaceName, terms, schemaOptions = {}) {
        const { QuipBatchSchema, QuipSingleTermSchema } = buildQuipSchemas(schemaOptions.phrasesPerTerm);
        const schema = schemaOptions.singleTerm ? QuipSingleTermSchema : QuipBatchSchema;
        const messages = [
            { role: 'system', content: this.buildGrokSystemPrompt(workspaceName, schemaOptions.phrasesPerTerm) },
            { role: 'user', content: this.buildGrokUserPrompt(terms, workspaceName, schemaOptions.phrasesPerTerm) }
        ];

        const result = await grokService.callDirectorAIWithCompletion(messages, {
            model: grokService.getDefaultGrokModel(),
            responseSchema: schema,
            max_completion_tokens: 16000,
            temperature: 1.05,
            toolLoops: 1
        });

        return this.parseQuipResponse(grokService, result?.content || result?.message || '', schema);
    }

    async generateQuipsForWorkspace(workspaceId, terms, workspaceName, progressCtx = null, options = {}) {
        const grokBatchSize = options.grokBatchSize ?? 3;
        const phrasesPerTerm = options.phrasesPerTerm ?? DEFAULT_PHRASES_PER_TERM;
        const { minPhrases } = buildQuipSchemas(phrasesPerTerm);
        if (!terms || terms.length === 0) return [];

        terms = await this.enrichTermsWithTagLookup(terms);

        const grokService = this.globalResources.getGrokService();
        const batchSize = Math.max(1, Math.min(5, parseInt(grokBatchSize, 10) || 3));
        const allQuips = [];
        const batchTotal = Math.ceil(terms.length / batchSize);

        for (let i = 0; i < terms.length; i += batchSize) {
            const batchIndex = Math.floor(i / batchSize) + 1;
            const batch = terms.slice(i, i + batchSize);

            if (progressCtx) {
                this.publishGenerationProgress({
                    status: 'running',
                    phase: 'generating',
                    workspace_id: workspaceId,
                    workspace_name: workspaceName,
                    workspace_index: progressCtx.workspaceIndex,
                    workspace_total: progressCtx.workspaceTotal,
                    batch_index: batchIndex,
                    batch_total: batchTotal,
                    terms_complete: allQuips.length,
                    terms_total: terms.length,
                    message: `Grok: ${workspaceName} — batch ${batchIndex}/${batchTotal}`
                }, { wsServer: progressCtx.wsServer });
            }

            let parsed = await this.callGrokForQuips(grokService, workspaceName, batch, { phrasesPerTerm });
            const batchResults = [];

            if (Array.isArray(parsed)) {
                for (const entry of parsed) {
                    const normalized = this.normalizeQuipEntry(entry);
                    if (normalized) batchResults.push(normalized);
                }
            }

            const gotTerms = new Set(batchResults.map((q) => q.term));
            for (const termRow of batch) {
                const termKey = termRow.term.toLowerCase().trim();
                const existing = batchResults.find((q) => q.term === termKey);
                if (!existing || existing.phrases.length < minPhrases) {
                    const retry = await this.callGrokForQuips(grokService, workspaceName, [termRow], { phrasesPerTerm, singleTerm: true });
                    if (Array.isArray(retry) && retry[0]) {
                        const normalized = this.normalizeQuipEntry(retry[0]);
                        if (normalized) {
                            if (existing) {
                                existing.phrases = normalized.phrases;
                            } else {
                                batchResults.push(normalized);
                            }
                        }
                    }
                }
            }

            if (batchResults.length > 0 && progressCtx) {
                this.publishGenerationProgress({
                    status: 'running',
                    phase: 'generating',
                    workspace_id: workspaceId,
                    workspace_name: workspaceName,
                    workspace_index: progressCtx.workspaceIndex,
                    workspace_total: progressCtx.workspaceTotal,
                    batch_index: batchIndex,
                    batch_total: batchTotal,
                    terms_complete: allQuips.length + batchResults.length,
                    terms_total: terms.length,
                    message: `Grok: ${workspaceName} — batch ${batchIndex}/${batchTotal}`
                }, {
                    wsServer: progressCtx.wsServer,
                    previews: batchResults,
                    workspaceName
                });
            }

            for (const entry of batchResults) {
                if (entry.phrases.length >= minPhrases || !gotTerms.has(entry.term)) {
                    allQuips.push(entry);
                } else if (entry.phrases.length > 0) {
                    allQuips.push(entry);
                }
            }
        }

        return dedupeQuipEntries(allQuips);
    }

    async generateGlobalFallbackQuips(allWorkspaceTerms, excludeTerms = [], options = {}) {
        const excludeSet = new Set(
            excludeTerms.map((t) => normalizeFilterTerm(typeof t === 'string' ? t : t.term)).filter(Boolean)
        );
        const termCounts = new Map();

        for (const entry of Object.values(allWorkspaceTerms)) {
            for (const t of entry.terms || []) {
                const key = normalizeFilterTerm(t.term);
                if (!key || excludeSet.has(key)) continue;

                const existing = termCounts.get(key) || { ...t, term: key, occurrenceCount: 0 };
                existing.occurrenceCount += t.occurrenceCount || 0;
                termCounts.set(key, existing);
            }
        }

        const topGlobal = [...termCounts.values()]
            .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
            .slice(0, 40);

        if (topGlobal.length === 0) return [];

        return this.generateQuipsForWorkspace(null, topGlobal, 'All Workspaces', null, options);
    }

    async runFullPipeline(options = {}, wsServer = null) {
        const {
            extractOnly = false,
            generateOnly = false,
            workspaceFilter = null,
            limit,
            grokBatchSize,
            phrasesPerTerm
        } = options;

        const generationOptions = {
            grokBatchSize,
            phrasesPerTerm
        };

        const extractOptions = {};
        if (limit != null) extractOptions.limit = limit;

        const db = this.getDatabase();
        let extracted = {};

        if (!generateOnly) {
            this.publishGenerationProgress({
                status: 'running',
                phase: 'extracting',
                message: 'Analyzing prompt metadata per workspace…',
                error: null,
                started_at: Math.floor(Date.now() / 1000)
            }, { wsServer });
            extracted = await this.extractAllWorkspaceTerms({ ...extractOptions, workspaceFilter });
            console.log(`📊 Extracted terms for ${Object.keys(extracted).length} workspaces`);
        } else {
            extracted = this.loadExtractedTermsFromDatabase(workspaceFilter);
            console.log(`📊 Loaded ${Object.keys(extracted).length} workspaces from extracted_terms`);
        }

        if (extractOnly) {
            this.publishGenerationProgress({
                status: 'complete',
                phase: null,
                message: `Extracted terms for ${Object.keys(extracted).length} workspace(s)`
            }, { wsServer });
            return { extracted, stats: db.getStats(), versionHash: db.getVersionHash() };
        }

        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        let totalQuips = 0;
        let sharedTerms = [];

        let extractedForGeneration = extracted;
        if (!workspaceFilter && Object.keys(extracted).length > 1) {
            const split = buildSharedAndUniqueTerms(extracted);
            sharedTerms = split.sharedTerms;
            extractedForGeneration = split.uniqueByWorkspace;
            if (sharedTerms.length > 0) {
                console.log(`🔗 ${sharedTerms.length} terms shared across workspaces → ${SHARED_QUIPS_WORKSPACE_ID}`);
            }
        }

        const workspaceEntries = Object.entries(extractedForGeneration)
            .filter(([id]) => !workspaceFilter || id === workspaceFilter);
        const workspaceTotal = workspaceEntries.length;
        const sharedSlot = (!workspaceFilter && sharedTerms.length > 0) ? 1 : 0;
        const generationSteps = workspaceTotal + sharedSlot + (workspaceFilter ? 0 : 1);

        this.publishGenerationProgress({
            status: 'running',
            phase: 'generating',
            workspace_total: generationSteps,
            terms_total: workspaceEntries.reduce((n, [, d]) => n + (d.terms?.length || 0), 0) + sharedTerms.length,
            message: generateOnly ? 'Starting Grok quip generation…' : 'Extract complete, starting Grok…',
            error: null,
            started_at: Math.floor(Date.now() / 1000)
        }, { wsServer });

        try {
            let workspaceIndex = 0;
            for (const [workspaceId, data] of workspaceEntries) {
                workspaceIndex += 1;
                const wsName = data.name || workspaces[workspaceId]?.name || workspaceId;
                if (!data.terms || data.terms.length === 0) {
                    db.replaceWorkspaceQuips(workspaceId, []);
                    continue;
                }

                console.log(`🤖 Generating quips for "${wsName}" (${data.terms.length} terms)...`);

                const quips = await this.generateQuipsForWorkspace(workspaceId, data.terms, wsName, {
                    workspaceIndex,
                    workspaceTotal: generationSteps,
                    wsServer
                }, generationOptions);
                db.replaceWorkspaceQuips(workspaceId, quips);
                totalQuips += quips.length;
                console.log(`   ✓ ${quips.length} term entries`);
            }

            if (!workspaceFilter) {
                if (sharedTerms.length > 0) {
                    workspaceIndex += 1;
                    this.publishGenerationProgress({
                        status: 'running',
                        phase: 'generating',
                        message: 'Generating shared cross-workspace quips…'
                    }, { wsServer });
                    console.log(`🔗 Generating shared quips (${sharedTerms.length} terms)...`);
                    const sharedQuips = await this.generateQuipsForWorkspace(
                        SHARED_QUIPS_WORKSPACE_ID,
                        sharedTerms,
                        'Shared Across Workspaces',
                        { workspaceIndex, workspaceTotal: generationSteps },
                        generationOptions
                    );
                    db.replaceWorkspaceQuips(SHARED_QUIPS_WORKSPACE_ID, sharedQuips);
                    totalQuips += sharedQuips.length;
                    console.log(`   ✓ ${sharedQuips.length} shared term entries`);
                }

                workspaceIndex += 1;
                this.publishGenerationProgress({
                    status: 'running',
                    phase: 'generating',
                    message: 'Generating global fallback quips…'
                }, { wsServer });
                const globalQuips = await this.generateGlobalFallbackQuips(extracted, sharedTerms, generationOptions);
                db.replaceGlobalQuips(globalQuips);
                totalQuips += globalQuips.length;
                console.log(`🌐 Global fallback: ${globalQuips.length} term entries`);
            }

            const versionHash = db.bumpVersionHash();
            this.publishGenerationProgress({
                status: 'complete',
                phase: null,
                message: `Complete — ${totalQuips} term entries across ${workspaceTotal} workspace(s)`,
                terms_complete: totalQuips,
                batch_index: 0,
                batch_total: 0,
                progress: 100
            }, { wsServer });
            this.clearGenerationPreviews();

            return {
                extracted,
                totalQuips,
                versionHash,
                stats: db.getStats()
            };
        } catch (error) {
            this.publishGenerationProgress({
                status: 'error',
                phase: null,
                message: 'Generation failed',
                error: error.message
            }, { wsServer });
            this.clearGenerationPreviews();
            throw error;
        }
    }

    loadExtractedTermsFromDatabase(workspaceFilter = null) {
        const rows = this.getDatabase().getExtractedTermRows(workspaceFilter);
        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        const extracted = {};

        for (const row of rows) {
            if (!extracted[row.workspace_id]) {
                extracted[row.workspace_id] = {
                    name: workspaces[row.workspace_id]?.name || row.workspace_id,
                    fileCount: (workspaces[row.workspace_id]?.files || []).length,
                    terms: []
                };
            }
            extracted[row.workspace_id].terms.push({
                term: row.term,
                occurrenceCount: row.occurrence_count,
                avgWeight: row.avg_weight,
                category: row.category
            });
        }

        return extracted;
    }

    clearWorkspaceQuips(workspaceId, wsServer = null) {
        if (!workspaceId) {
            throw new Error('workspaceId is required');
        }
        if (this.isPipelineRunning()) {
            throw new Error('A quip scan is already in progress');
        }

        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        const wsName = workspaces[workspaceId]?.name || workspaceId;
        const versionHash = this.getDatabase().clearWorkspaceData(workspaceId);

        this.broadcastQuipsUpdate(wsServer, {
            versionHash,
            workspaceFilter: workspaceId,
            scope: 'workspace',
            status: 'complete',
            message: `Cleared quips and extracted terms for ${wsName}`
        });

        return { workspaceId, workspaceName: wsName, versionHash };
    }

    getClientPayload() {
        return this.getDatabase().getAllQuipsForClient();
    }

    getStatus(activeWorkspaceId = 'default') {
        const db = this.getDatabase();
        const stats = db.getStats();
        const generation = db.reconcileStaleGenerationState({ maxRunningIdleSec: 180 });
        const generationWithLive = generation.status === 'running'
            ? {
                ...generation,
                progress: computeGenerationProgress(generation),
                recentPreviews: this._generationPreviews.slice(-8)
            }
            : generation;
        const workspaceStats = db.getWorkspaceQuipStats(activeWorkspaceId);
        const globalStats = db.getWorkspaceQuipStats(null);

        const STALE_QUIP_AGE_SEC = 90 * 24 * 60 * 60;
        const nowSec = Math.floor(Date.now() / 1000);

        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        const workspaceSummaries = Object.entries(workspaces).map(([id, ws]) => {
            const wsQuips = db.getWorkspaceQuipStats(id);
            let needsGeneration = wsQuips.termCount === 0;
            let generationStaleReason = needsGeneration ? 'none' : null;

            if (!needsGeneration) {
                if (!wsQuips.lastGeneratedAt) {
                    needsGeneration = true;
                    generationStaleReason = 'missing';
                } else if (nowSec - wsQuips.lastGeneratedAt > STALE_QUIP_AGE_SEC) {
                    needsGeneration = true;
                    generationStaleReason = 'stale';
                }
            }

            return {
                id,
                name: ws.name || id,
                termCount: wsQuips.termCount,
                phraseCount: wsQuips.phraseCount,
                extractedTermCount: wsQuips.extractedTermCount,
                minPhrasesPerTerm: wsQuips.minPhrasesPerTerm,
                maxPhrasesPerTerm: wsQuips.maxPhrasesPerTerm,
                lastGeneratedAt: wsQuips.lastGeneratedAt,
                needsGeneration,
                generationStaleReason
            };
        });

        return {
            versionHash: stats.versionHash,
            totalQuipTerms: stats.quipCount,
            totalWorkspacesWithQuips: stats.workspaceCount,
            extractedTermRows: stats.extractedTermRows,
            activeWorkspaceId,
            activeWorkspace: workspaceSummaries.find((w) => w.id === activeWorkspaceId) || null,
            global: globalStats,
            generation: generationWithLive,
            workspaces: workspaceSummaries,
            autoUpdate: this.getAutoUpdateStatus(activeWorkspaceId)
        };
    }

    applyClientStatus(activeWorkspaceId, broadcastStatus) {
        if (!broadcastStatus) return null;
        const wsId = activeWorkspaceId || 'default';
        return {
            ...broadcastStatus,
            activeWorkspaceId: wsId,
            activeWorkspace: broadcastStatus.workspaces?.find((w) => w.id === wsId) || null,
            autoUpdate: broadcastStatus.autoUpdateByWorkspace?.[wsId]
                || this.getAutoUpdateStatus(wsId)
        };
    }

    buildWikiHtml(scope = {}) {
        const { workspaceId = null, viewAll = false } = scope;
        const db = this.getDatabase();
        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        const escape = (s) => String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        const navLinks = [];
        if (!viewAll && workspaceId) {
            navLinks.push(`<a href="#" class="quip-wiki-nav-link" data-quip-view="all">View all workspaces</a>`);
            for (const [id, ws] of Object.entries(workspaces)) {
                if (id === workspaceId) continue;
                navLinks.push(`<a href="#" class="quip-wiki-nav-link" data-quip-ws="${escape(id)}">${escape(ws.name || id)}</a>`);
            }
        } else if (viewAll) {
            for (const [id, ws] of Object.entries(workspaces)) {
                navLinks.push(`<a href="#" class="quip-wiki-nav-link" data-quip-ws="${escape(id)}">${escape(ws.name || id)}</a>`);
            }
        }

        const sections = [];

        const formatTimestamp = (unixSec) => {
            if (!unixSec) return 'Never';
            try {
                return new Date(unixSec * 1000).toLocaleString();
            } catch {
                return 'Unknown';
            }
        };

        const renderControlsPanel = (id, label) => {
            const stats = db.getWorkspaceQuipStats(id);
            const ws = workspaces[id] || {};
            const corpusFiles = (ws.files || []).length + (ws.scraps || []).length;
            const minLabel = stats.minPhrasesPerTerm != null ? stats.minPhrasesPerTerm : '—';
            const maxLabel = stats.maxPhrasesPerTerm != null ? stats.maxPhrasesPerTerm : '—';

            return `
                <section class="quip-wiki-controls" data-quip-controls-ws="${escape(id)}">
                    <h2 class="quip-wiki-controls-title">Statistics &amp; controls — ${escape(label)}</h2>
                    <dl class="quip-wiki-stats">
                        <div class="quip-wiki-stat"><dt>Quip terms</dt><dd>${stats.termCount}</dd></div>
                        <div class="quip-wiki-stat"><dt>Phrases</dt><dd>${stats.phraseCount}</dd></div>
                        <div class="quip-wiki-stat"><dt>Extracted terms</dt><dd>${stats.extractedTermCount}</dd></div>
                        <div class="quip-wiki-stat"><dt>Phrases / term</dt><dd>${minLabel}–${maxLabel}</dd></div>
                        <div class="quip-wiki-stat"><dt>Corpus files</dt><dd>${corpusFiles}</dd></div>
                        <div class="quip-wiki-stat"><dt>Last generated</dt><dd>${escape(formatTimestamp(stats.lastGeneratedAt))}</dd></div>
                    </dl>
                    <div class="quip-wiki-controls-actions">
                        <button type="button" class="btn-primary quip-wiki-action-btn" data-quip-action="generate" data-quip-workspace-id="${escape(id)}"><i class="fas fa-wand-magic-sparkles"></i> Generate quips</button>
                        <button type="button" class="btn-secondary quip-wiki-action-btn" data-quip-action="extract" data-quip-workspace-id="${escape(id)}"><i class="fas fa-list"></i> Re-extract terms</button>
                        <button type="button" class="btn-secondary quip-wiki-action-btn" data-quip-action="refresh-cache" data-quip-workspace-id="${escape(id)}"><i class="fas fa-download"></i> Refresh client cache</button>
                        <button type="button" class="btn-danger quip-wiki-action-btn" data-quip-action="clear" data-quip-workspace-id="${escape(id)}"><i class="fas fa-trash"></i> Clear all</button>
                    </div>
                </section>
            `;
        };

        const renderWorkspaceSection = (id, label) => {
            const entries = db.getWorkspaceQuipEntries(id);
            if (entries.length === 0) {
                sections.push(`<section class="quip-wiki-section" id="quip-ws-${escape(id || 'global')}"><h2>${escape(label)}</h2><p class="quip-wiki-empty">No quips generated yet for this workspace.</p></section>`);
                return;
            }
            const termBlocks = entries.map((entry) => {
                const phraseItems = entry.phrases.map((p) => `<li>${escape(p)}</li>`).join('');
                return `<article class="quip-wiki-term"><h3 class="quip-wiki-term-title">${escape(entry.term)} <span class="quip-wiki-phrase-count">${entry.phrases.length} phrases</span></h3><ul class="quip-wiki-phrases">${phraseItems}</ul></article>`;
            }).join('');
            sections.push(`<section class="quip-wiki-section" id="quip-ws-${escape(id || 'global')}"><h2>${escape(label)}</h2>${termBlocks}</section>`);
        };

        if (viewAll) {
            for (const [id, ws] of Object.entries(workspaces)) {
                renderWorkspaceSection(id, ws.name || id);
            }
            renderWorkspaceSection(SHARED_QUIPS_WORKSPACE_ID, 'Shared across workspaces');
            renderWorkspaceSection(null, 'Global fallback');
        } else if (workspaceId) {
            const ws = workspaces[workspaceId];
            const wsLabel = ws?.name || workspaceId;
            renderWorkspaceSection(SHARED_QUIPS_WORKSPACE_ID, 'Shared across workspaces');
            renderWorkspaceSection(workspaceId, wsLabel);
            sections.push(renderControlsPanel(workspaceId, wsLabel));
        } else {
            renderWorkspaceSection(SHARED_QUIPS_WORKSPACE_ID, 'Shared across workspaces');
            renderWorkspaceSection(null, 'Global fallback');
        }

        return `
            <div class="quip-wiki-doc">
                <nav class="quip-wiki-nav">${navLinks.join(' · ')}</nav>
                ${sections.join('')}
            </div>
        `;
    }
}

module.exports = {
    GenerationQuipsManager,
    SHARED_QUIPS_WORKSPACE_ID,
    buildQualityFilterSet,
    buildPromptNoiseFilterSets,
    categorizeTerm,
    isArtistTag,
    parseArtistDisplayName,
    buildTagLookupCandidates,
    mapDbCategoryToQuipCategory,
    STATIC_QUALITY_TERMS
};
