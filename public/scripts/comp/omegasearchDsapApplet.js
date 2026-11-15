/**
 * Image Search's search library (Yozora #831): what is left of the retired Global Search DSAP
 * (ispy.dreamscape.jp, whose addresses open the Image Search program: dsapManifests.js). Its helpers and
 * search sessions (omegasearchDsap*, OMEGASEARCH_*) serve Image Search (imageSearchApp.js) and the phone's
 * Search Pictures (wmSearchPictures.js). Loaded as featureLoader 'image_search_lib' (featureLoader.js).
 * Depends on: websocket.js, utilities.js (UC_PRESET_LEVEL_LABELS)
 */

const ISPY_DSAP_URL = 'ispy.dreamscape.jp';
const OMEGASEARCH_GLOBAL_WORKSPACE = '*';
const OMEGASEARCH_VIEW_TYPES = [
    { value: 'images', label: 'Images' },
    { value: 'scraps', label: 'Scraps' },
    { value: 'pinned', label: 'Pinned' },
    { value: 'upscaled', label: 'Upscaled' }
];
const OMEGASEARCH_MATCH_MODES = [
    { value: 'substring', label: 'Substring' },
    { value: 'word', label: 'Whole word' },
    { value: 'inner', label: 'Inner match' },
    { value: 'start', label: 'Starts with' },
    { value: 'end', label: 'Ends with' }
];
// UC_PRESET_LEVEL_LABELS: public/scripts/comp/utilities.js
const OMEGASEARCH_UC_LEVEL_LABELS = UC_PRESET_LEVEL_LABELS;
const OMEGASEARCH_DEFAULT_LIMIT = 60;
const OMEGASEARCH_SESSION_STORAGE_KEY = 'ispy-dsap-search-sessions-v1';
let omegasearchDsapLastActiveSearch = null;
/** Module-level cache — survives DSAP destroy/init within the same page load. */
const omegasearchDsapSearchSessions = new Map();
let omegasearchDsapNextSessionSerial = 1;
let omegasearchDsapNextSearchGeneration = 0;

function omegasearchDsapPersistSessionsToStorage() {
    try {
        const sessions = [];
        for (const session of omegasearchDsapSearchSessions.values()) {
            sessions.push({
                id: session.id,
                queryKey: session.queryKey,
                total: session.total,
                usages: session.usages,
                pages: session.pages,
                corpusSize: session.corpusSize,
                lastPage: session.lastPage,
                pageSize: session.pageSize,
                serverSessionId: session.serverSessionId || null
            });
        }
        sessionStorage.setItem(OMEGASEARCH_SESSION_STORAGE_KEY, JSON.stringify({
            sessions,
            lastActive: omegasearchDsapLastActiveSearch
        }));
    } catch (e) {
        // private mode / quota
    }
}

function omegasearchDsapRestoreSessionsFromStorage() {
    try {
        const raw = sessionStorage.getItem(OMEGASEARCH_SESSION_STORAGE_KEY);
        if (!raw) return;
        const payload = JSON.parse(raw);
        if (payload.lastActive && !omegasearchDsapLastActiveSearch) {
            omegasearchDsapLastActiveSearch = payload.lastActive;
        }
        if (!Array.isArray(payload.sessions)) return;
        for (const entry of payload.sessions) {
            if (!entry?.id || !entry.queryKey) continue;
            if (omegasearchDsapSearchSessions.has(entry.id)) continue;
            omegasearchDsapSearchSessions.set(entry.id, {
                id: entry.id,
                queryKey: entry.queryKey,
                total: entry.total || 0,
                usages: entry.usages || [],
                pages: entry.pages || {},
                corpusSize: entry.corpusSize ?? null,
                lastPage: entry.lastPage || 1,
                pageSize: entry.pageSize || OMEGASEARCH_DEFAULT_LIMIT,
                serverSessionId: entry.serverSessionId || null
            });
        }
    } catch (e) {
        // ignore corrupt storage
    }
}

omegasearchDsapRestoreSessionsFromStorage();

function omegasearchDsapUcLevelLabel(value) {
    if (value == null) return OMEGASEARCH_UC_LEVEL_LABELS[0];
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n < OMEGASEARCH_UC_LEVEL_LABELS.length) {
        return OMEGASEARCH_UC_LEVEL_LABELS[n];
    }
    return `Level ${value}`;
}

function omegasearchDsapEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function omegasearchDsapPreviewBaseName(filename) {
    return String(filename || '')
        .replace(/_upscaled(?=\.)/, '')
        .replace(/_pipeline_upscaled(?=\.)/, '')
        .replace(/@blur(?=\.)/, '')
        .replace(/@lq(?=\.)/, '')
        .replace(/@2x(?=\.)/, '')
        .replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

function omegasearchDsapPreviewUrl(filename) {
    if (!filename) return '';
    let previewPath = `${omegasearchDsapPreviewBaseName(filename)}.webp`;
    // deviceUtils.getGalleryPreviewUrl: public/scripts/utils/deviceUtils.js
    if (globalThis.deviceUtils && typeof globalThis.deviceUtils.getGalleryPreviewUrl === 'function') {
        previewPath = globalThis.deviceUtils.getGalleryPreviewUrl(previewPath);
    }
    // localGalleryPreviewUrl: public/scripts/comp/assetUrlResolver.js
    return localGalleryPreviewUrl(previewPath);
}

function omegasearchDsapDefaultFilters() {
    return {
        dateBefore: null,
        dateAfter: null,
        dateRange: null,
        qualityPreset: null,
        ucLevel: null,
        nsfwLevel: null,
        models: [],
        stepsMin: null,
        stepsMax: null,
        sampler: null,
        scheduler: null,
        consecutiveSeeds: false,
        resolutionPreset: [],
        isUpscaled: null,
        guidanceMin: null,
        guidanceMax: null,
        rescaleMin: null,
        rescaleMax: null,
        hasDynamicReplacements: null,
        dateMode: 'relative'
    };
}

function omegasearchDsapDefaultBlockOptions() {
    return { defaultMatchMode: 'substring' };
}

function omegasearchDsapParseTriStateParam(value) {
    if (value == null || value === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return null;
}

function omegasearchDsapSerializeTriStateParam(value) {
    if (value === true) return '1';
    if (value === false) return '0';
    return '';
}

function omegasearchDsapParseOptionalInt(value) {
    if (value == null || value === '') return null;
    const num = parseInt(String(value), 10);
    return Number.isFinite(num) ? num : null;
}

function omegasearchDsapParseOptionalFloat(value) {
    if (value == null || value === '') return null;
    const num = parseFloat(String(value));
    return Number.isFinite(num) ? num : null;
}

function omegasearchDsapGetModelOptions() {
    const out = [];
    if (typeof modelGroups !== 'undefined' && Array.isArray(modelGroups)) {
        modelGroups.forEach((group) => {
            (group.options || []).forEach((opt) => {
                out.push({
                    value: opt.value,
                    label: opt.name || opt.display_full || opt.display || opt.value,
                    group: group.group || ''
                });
            });
        });
    }
    return out;
}

function omegasearchDsapGetSamplerOptions() {
    if (typeof SAMPLER_MAP === 'undefined' || !Array.isArray(SAMPLER_MAP)) return [];
    return SAMPLER_MAP.map((entry) => ({
        value: entry.meta,
        label: entry.display || entry.meta
    }));
}

function omegasearchDsapGetSchedulerOptions() {
    if (typeof NOISE_MAP === 'undefined' || !Array.isArray(NOISE_MAP)) return [];
    return NOISE_MAP.map((entry) => ({
        value: entry.meta,
        label: entry.display || entry.meta
    }));
}

function omegasearchDsapBuildFiltersPayload(filters) {
    const src = filters || {};
    const out = {};
    if (src.dateBefore && (src.dateBefore.relative || src.dateBefore.absolute)) {
        out.dateBefore = { ...src.dateBefore };
    }
    if (src.dateAfter && (src.dateAfter.relative || src.dateAfter.absolute)) {
        out.dateAfter = { ...src.dateAfter };
    }
    if (src.dateRange && (src.dateRange.start || src.dateRange.end)) {
        out.dateRange = { ...src.dateRange };
    }
    if (src.qualityPreset === true || src.qualityPreset === false) out.qualityPreset = src.qualityPreset;
    if (src.ucLevel != null && src.ucLevel !== '') out.ucLevel = src.ucLevel;
    if (src.nsfwLevel != null && src.nsfwLevel !== '') out.nsfwLevel = src.nsfwLevel;
    if (src.models && src.models.length) out.models = [...src.models];
    if (src.stepsMin != null) out.stepsMin = src.stepsMin;
    if (src.stepsMax != null) out.stepsMax = src.stepsMax;
    if (src.sampler) out.sampler = src.sampler;
    if (src.scheduler) out.scheduler = src.scheduler;
    if (src.consecutiveSeeds) out.consecutiveSeeds = true;
    if (src.resolutionPreset && src.resolutionPreset.length) out.resolutionPreset = [...src.resolutionPreset];
    if (src.isUpscaled === true || src.isUpscaled === false) out.isUpscaled = src.isUpscaled;
    if (src.guidanceMin != null) out.guidanceMin = src.guidanceMin;
    if (src.guidanceMax != null) out.guidanceMax = src.guidanceMax;
    if (src.rescaleMin != null) out.rescaleMin = src.rescaleMin;
    if (src.rescaleMax != null) out.rescaleMax = src.rescaleMax;
    if (src.hasDynamicReplacements === true || src.hasDynamicReplacements === false) {
        out.hasDynamicReplacements = src.hasDynamicReplacements;
    }
    return out;
}

function omegasearchDsapResolveFilters(host) {
    const filters = omegasearchDsapDefaultFilters();
    if (!host || typeof host.getQueryParam !== 'function') return filters;

    const afterRel = host.getQueryParam('dateAfter') || host.getQueryParam('after');
    const beforeRel = host.getQueryParam('dateBefore') || host.getQueryParam('before');
    if (afterRel) filters.dateAfter = { relative: afterRel };
    if (beforeRel) filters.dateBefore = { relative: beforeRel };

    const rangeStart = host.getQueryParam('dateStart');
    const rangeEnd = host.getQueryParam('dateEnd');
    if (rangeStart || rangeEnd) {
        filters.dateRange = { start: rangeStart || undefined, end: rangeEnd || undefined };
    }

    filters.qualityPreset = omegasearchDsapParseTriStateParam(host.getQueryParam('quality'));
    filters.ucLevel = omegasearchDsapParseOptionalInt(host.getQueryParam('uc'));
    filters.nsfwLevel = omegasearchDsapParseOptionalInt(host.getQueryParam('nsfw'));
    filters.stepsMin = omegasearchDsapParseOptionalInt(host.getQueryParam('stepsMin'));
    filters.stepsMax = omegasearchDsapParseOptionalInt(host.getQueryParam('stepsMax'));
    filters.guidanceMin = omegasearchDsapParseOptionalFloat(host.getQueryParam('guidanceMin'));
    filters.guidanceMax = omegasearchDsapParseOptionalFloat(host.getQueryParam('guidanceMax'));
    filters.rescaleMin = omegasearchDsapParseOptionalFloat(host.getQueryParam('rescaleMin'));
    filters.rescaleMax = omegasearchDsapParseOptionalFloat(host.getQueryParam('rescaleMax'));
    filters.dateMode = host.getQueryParam('dateMode') === 'exact' ? 'exact' : 'relative';
    filters.sampler = host.getQueryParam('sampler') || null;
    filters.scheduler = host.getQueryParam('scheduler') || null;
    filters.isUpscaled = omegasearchDsapParseTriStateParam(host.getQueryParam('upscaled'));
    filters.hasDynamicReplacements = omegasearchDsapParseTriStateParam(host.getQueryParam('dynRepl'));
    filters.consecutiveSeeds = host.getQueryParam('consecutiveSeeds') === '1';

    const modelsRaw = host.getQueryParam('models');
    if (modelsRaw) {
        filters.models = modelsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const resolutionRaw = host.getQueryParam('resolution');
    if (resolutionRaw) {
        filters.resolutionPreset = resolutionRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }

    const promptSource = (host.getQueryParam('promptSource') || '').trim().toLowerCase();
    if (promptSource === 'compiled' || promptSource === 'input') {
        filters.promptSource = promptSource;
    }

    return filters;
}

function omegasearchDsapResolveBlockOptions(host) {
    const options = omegasearchDsapDefaultBlockOptions();
    if (!host || typeof host.getQueryParam !== 'function') return options;
    const modesRaw = host.getQueryParam('modes') || host.getQueryParam('matchMode');
    if (modesRaw) {
        const first = String(modesRaw).split(',')[0].trim().toLowerCase();
        if (OMEGASEARCH_MATCH_MODES.some((entry) => entry.value === first)) {
            options.defaultMatchMode = first;
        }
    }
    return options;
}

function omegasearchDsapParseBlockModesFromUrl(host, blockCount) {
    if (!host || typeof host.getQueryParam !== 'function' || blockCount <= 0) return [];
    const modesRaw = host.getQueryParam('modes');
    if (!modesRaw) return [];
    return String(modesRaw).split(',').map((s) => s.trim().toLowerCase()).slice(0, blockCount);
}

function omegasearchDsapApplyBlockModes(blocks, modes) {
    if (!blocks || !blocks.length || !modes || !modes.length) return blocks;
    return blocks.map((block, index) => {
        const mode = modes[index];
        if (!mode || !OMEGASEARCH_MATCH_MODES.some((entry) => entry.value === mode)) return block;
        return { ...block, matchMode: mode };
    });
}

function omegasearchDsapFlattenBlockTerms(blocks) {
    const terms = [];
    omegasearchDsapNormalizeBlocks(blocks).forEach((block) => {
        (block.terms || []).forEach((term) => {
            const trimmed = String(term || '').trim();
            if (trimmed) terms.push(trimmed);
        });
    });
    return terms;
}

function omegasearchDsapHighlightTerms(text, terms) {
    const raw = String(text ?? '');
    const normalized = (terms || []).map((t) => String(t || '').trim()).filter((t) => t.length > 0);
    if (!raw || !normalized.length) return omegasearchDsapEscapeHtml(raw);

    const sorted = [...normalized].sort((a, b) => b.length - a.length);
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = sorted.map(escapeRegExp).join('|');
    if (!pattern) return omegasearchDsapEscapeHtml(raw);

    const re = new RegExp(pattern, 'gi');
    const ranges = [];
    let match;
    while ((match = re.exec(raw)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
        // Advance one char so overlapping hits match the old indexOf(+1) scan
        re.lastIndex = match.index + 1;
    }

    if (!ranges.length) return omegasearchDsapEscapeHtml(raw);

    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (!last || range.start >= last.end) {
            merged.push({ start: range.start, end: range.end });
        } else {
            last.end = Math.max(last.end, range.end);
        }
    }

    let out = '';
    let pos = 0;
    for (const range of merged) {
        out += omegasearchDsapEscapeHtml(raw.slice(pos, range.start));
        out += `<mark class="omega-dsap-highlight">${omegasearchDsapEscapeHtml(raw.slice(range.start, range.end))}</mark>`;
        pos = range.end;
    }
    out += omegasearchDsapEscapeHtml(raw.slice(pos));
    return out;
}

function omegasearchDsapUsageKey(usage, index) {
    return [
        usage?.block || '',
        usage?.source || '',
        usage?.character || '',
        usage?.displayText || '',
        index
    ].join('\0');
}

function omegasearchDsapFormatDatasetLabel(datasetConfig) {
    const include = datasetConfig?.include;
    if (!Array.isArray(include) || !include.length) return 'Anime (default)';
    const labels = include.map((entry) => {
        const key = String(entry || '').toLowerCase();
        if (key === 'furry') return 'Furry';
        if (key === 'backgrounds') return 'Backgrounds';
        return entry;
    });
    return labels.join(', ');
}

function omegasearchDsapParseBlockSegment(segment) {
    const text = String(segment || '').trim();
    if (!text) return null;
    const parts = text.split(/\s+\|\s+|\s+OR\s+|\|/i).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1) {
        return { terms: [parts[0]], mode: 'and' };
    }
    return { terms: parts, mode: 'or' };
}

function omegasearchDsapParseBlockInput(text) {
    return omegasearchDsapParseBlockSegment(text);
}

function omegasearchDsapNormalizeBlocks(blocks, options = {}) {
    const defaultMatchMode = options.defaultMatchMode || 'substring';
    if (!blocks) return [];
    const raw = Array.isArray(blocks) ? blocks : String(blocks).split(',');
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        let block = null;
        if (entry && typeof entry === 'object' && Array.isArray(entry.terms)) {
            const terms = entry.terms.map((t) => String(t || '').trim()).filter(Boolean);
            if (!terms.length) continue;
            const matchMode = entry.matchMode || defaultMatchMode;
            block = {
                terms,
                mode: entry.mode === 'or' || entry.orWithinBlock ? 'or' : 'and',
                matchMode: OMEGASEARCH_MATCH_MODES.some((m) => m.value === matchMode) ? matchMode : defaultMatchMode
            };
        } else {
            block = omegasearchDsapParseBlockSegment(entry);
            if (block) block.matchMode = defaultMatchMode;
        }
        if (!block) continue;
        const key = `${block.mode}:${block.matchMode}:${block.terms.map((t) => t.toLowerCase()).sort().join('|')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(block);
    }
    return out;
}

function omegasearchDsapSerializeBlocksForUrl(blocks) {
    return omegasearchDsapNormalizeBlocks(blocks).map((block) => {
        const terms = block.terms || [];
        if (block.mode === 'or' && terms.length > 1) return terms.join('|');
        return terms[0] || '';
    }).filter(Boolean).join(',');
}

function omegasearchDsapSerializeBlockModesForUrl(blocks) {
    const normalized = omegasearchDsapNormalizeBlocks(blocks);
    if (!normalized.length) return '';
    const modes = normalized.map((block) => block.matchMode || 'substring');
    if (modes.every((mode) => mode === 'substring')) return '';
    return modes.join(',');
}

function omegasearchDsapFormatBlockLabel(block) {
    if (typeof block === 'string') return block;
    const terms = block?.terms || [];
    if (!terms.length) return '';
    let label = '';
    if (block.mode === 'or' && terms.length > 1) label = terms.join(' | ');
    else label = terms[0];
    if (block.matchMode && block.matchMode !== 'substring') {
        label += ` [${block.matchMode}]`;
    }
    return label;
}

function omegasearchDsapBlocksForSearchPayload(blocks, blockOptions = {}) {
    const defaultMatchMode = blockOptions.defaultMatchMode || 'substring';
    return omegasearchDsapNormalizeBlocks(blocks, { defaultMatchMode }).map((block) => ({
        terms: block.terms,
        matchMode: block.matchMode || defaultMatchMode,
        orWithinBlock: block.mode === 'or',
        mode: block.mode === 'or' ? 'or' : 'and'
    }));
}

function omegasearchDsapBuildSearchCacheKey(blocks, filters, workspaceId, viewType, promptSource, blockOptions) {
    return JSON.stringify({
        blocks: omegasearchDsapBlocksForSearchPayload(blocks, blockOptions),
        filters: filters || {},
        workspaceId: workspaceId || OMEGASEARCH_GLOBAL_WORKSPACE,
        viewType: viewType || 'images',
        promptSource: promptSource || 'both',
        defaultMatchMode: blockOptions?.defaultMatchMode || 'substring'
    });
}

function omegasearchDsapResolveDetailPromptFields(metadata, compiled) {
    if (!metadata || typeof metadata !== 'object') {
        return { mainPrompt: '', mainUc: '', negPrompt: '', chars: [] };
    }
    const forge = metadata.forge_data || {};
    const dgCompiled = metadata.dynamic_generation?.compiled_prompt;

    if (compiled) {
        let mainPrompt = '';
        if (typeof metadata.compiled_prompt === 'string') {
            mainPrompt = metadata.compiled_prompt;
        } else {
            mainPrompt = metadata.compiled_prompt?.prompt
                || dgCompiled?.prompt
                || dgCompiled?.text_prompt
                || metadata.prompt
                || '';
        }
        const mainUc = metadata.compiled_uc != null
            ? metadata.compiled_uc
            : (dgCompiled?.uc ?? metadata.uc ?? '');
        const negPrompt = metadata.input_prompt_negative
            || forge.input_prompt_negative
            || dgCompiled?.input_prompt_negative
            || '';
        let chars = metadata.compiled_characterPrompts
            || metadata.compiledCharacterPrompts
            || [];
        if (!chars.length) {
            const fromDg = dgCompiled?.character_prompts || dgCompiled?.characterPrompts;
            if (Array.isArray(fromDg)) chars = fromDg;
        }
        return { mainPrompt, mainUc, negPrompt, chars };
    }

  // Input lane: forge_data.input_prompt, then extractRelevantFields prompt (metadata.prompt)
    const mainPrompt = forge.input_prompt
        || metadata.input_prompt
        || metadata.prompt
        || '';
    const mainUc = forge.input_uc
        || metadata.input_uc
        || metadata.uc
        || '';
    const negPrompt = forge.input_prompt_negative
        || metadata.input_prompt_negative
        || '';
    const rawChars = forge.allCharacters || metadata.characterPrompts || [];
    const chars = (Array.isArray(rawChars) ? rawChars : []).map((c) => ({
        ...c,
        prompt: c.prompt || c.input_prompt || '',
        uc: c.uc || c.input_uc || '',
        chara_name: c.chara_name || c.name
    }));
    return { mainPrompt, mainUc, negPrompt, chars };
}

function omegasearchDsapBuildUrl(params = {}) {
    const q = new URLSearchParams();
    const serialized = omegasearchDsapSerializeBlocksForUrl(params.blocks);
    if (serialized) q.set('blocks', serialized);
    const modesSerialized = omegasearchDsapSerializeBlockModesForUrl(params.blocks);
    if (modesSerialized) q.set('modes', modesSerialized);
    if (params.view && params.view !== 'gallery') q.set('view', params.view);
    if (params.file) q.set('file', params.file);
    if (params.viewType && params.viewType !== 'images') q.set('viewType', params.viewType);
    if (params.workspaceId && params.workspaceId !== OMEGASEARCH_GLOBAL_WORKSPACE) {
        q.set('workspace', params.workspaceId);
    }

    const filters = params.filters || {};
    const promptSource = params.promptSource || filters.promptSource;
    if (promptSource) q.set('promptSource', promptSource);

    if (filters.dateAfter?.relative) q.set('dateAfter', filters.dateAfter.relative);
    if (filters.dateBefore?.relative) q.set('dateBefore', filters.dateBefore.relative);
    if (filters.dateRange?.start) q.set('dateStart', String(filters.dateRange.start));
    if (filters.dateRange?.end) q.set('dateEnd', String(filters.dateRange.end));

    const quality = omegasearchDsapSerializeTriStateParam(filters.qualityPreset);
    if (quality) q.set('quality', quality);
    const upscaled = omegasearchDsapSerializeTriStateParam(filters.isUpscaled);
    if (upscaled) q.set('upscaled', upscaled);
    const dynRepl = omegasearchDsapSerializeTriStateParam(filters.hasDynamicReplacements);
    if (dynRepl) q.set('dynRepl', dynRepl);

    if (filters.ucLevel != null && filters.ucLevel !== '') q.set('uc', String(filters.ucLevel));
    if (filters.nsfwLevel != null && filters.nsfwLevel !== '') q.set('nsfw', String(filters.nsfwLevel));
    if (filters.stepsMin != null) q.set('stepsMin', String(filters.stepsMin));
    if (filters.stepsMax != null) q.set('stepsMax', String(filters.stepsMax));
    if (filters.guidanceMin != null) q.set('guidanceMin', String(filters.guidanceMin));
    if (filters.guidanceMax != null) q.set('guidanceMax', String(filters.guidanceMax));
    if (filters.rescaleMin != null) q.set('rescaleMin', String(filters.rescaleMin));
    if (filters.rescaleMax != null) q.set('rescaleMax', String(filters.rescaleMax));
    if (filters.dateMode === 'exact') q.set('dateMode', 'exact');
    if (filters.sampler) q.set('sampler', filters.sampler);
    if (filters.scheduler) q.set('scheduler', filters.scheduler);
    if (filters.consecutiveSeeds) q.set('consecutiveSeeds', '1');
    if (filters.models && filters.models.length) q.set('models', filters.models.join(','));
    if (filters.resolutionPreset && filters.resolutionPreset.length) {
        q.set('resolution', filters.resolutionPreset.join(','));
    }

    const blockOptions = params.blockOptions || {};
    if (blockOptions.defaultMatchMode && blockOptions.defaultMatchMode !== 'substring' && !modesSerialized) {
        q.set('matchMode', blockOptions.defaultMatchMode);
    }

    if (params.page && Number(params.page) > 1) {
        q.set('page', String(params.page));
    }
    if (params.frame) q.set('frame', params.frame);

    const qs = q.toString();
    return qs ? `dsap://${ISPY_DSAP_URL}/?${qs}` : `dsap://${ISPY_DSAP_URL}/`;
}

function omegasearchDsapResolveWorkspaceId(host) {
    const fromQuery = host.getQueryParam('workspace') || host.getQueryParam('ws');
    if (fromQuery === 'all' || fromQuery === '*') return OMEGASEARCH_GLOBAL_WORKSPACE;
    if (fromQuery) return fromQuery;
    return OMEGASEARCH_GLOBAL_WORKSPACE;
}

function omegasearchDsapResolveBlocks(host) {
    const fromQuery = host.getQueryParam('blocks') || host.getQueryParam('q');
    if (!fromQuery) return [];
    const blockOptions = omegasearchDsapResolveBlockOptions(host);
    const blocks = omegasearchDsapNormalizeBlocks(fromQuery, blockOptions);
    const modes = omegasearchDsapParseBlockModesFromUrl(host, blocks.length);
    return omegasearchDsapApplyBlockModes(blocks, modes);
}

function omegasearchDsapResolveView(host) {
    const view = (host.getQueryParam('view') || 'gallery').toLowerCase();
    if (view === 'detail') return 'detail';
    if (view === 'usages') return 'usages';
    if (view === 'search') return 'search';
    return 'gallery';
}

function omegasearchDsapResolvePage(host) {
    if (!host || typeof host.getQueryParam !== 'function') return 1;
    const raw = host.getQueryParam('page');
    if (!raw) return 1;
    const parsed = parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function omegasearchDsapNormalizeMetadataFilename(raw) {
    if (!raw) return '';
    let name = String(raw).trim();
    try {
        if (name.includes('%')) name = decodeURIComponent(name);
    } catch (e) {
        // keep raw name when decode fails
    }
    name = name.replace(/^\/+/, '').replace(/^images\//i, '');
    const slash = name.lastIndexOf('/');
    if (slash >= 0) name = name.slice(slash + 1);
    return name;
}

function omegasearchDsapFindFilenameInSession(driver, raw) {
    const target = omegasearchDsapNormalizeMetadataFilename(raw);
    if (!target) return null;

    const matchName = (candidate) => {
        if (!candidate) return null;
        const normalized = omegasearchDsapNormalizeMetadataFilename(candidate);
        if (normalized === target) return normalized;
        if (normalized.toLowerCase() === target.toLowerCase()) return normalized;
        const base = omegasearchDsapPreviewBaseName(normalized).toLowerCase();
        const targetBase = omegasearchDsapPreviewBaseName(target).toLowerCase();
        if (base && base === targetBase) return normalized;
        return null;
    };

    const state = driver._state;
    if (state?.results) {
        for (const row of state.results) {
            const hit = matchName(row.filename);
            if (hit) return hit;
        }
    }

    for (const session of omegasearchDsapSearchSessions.values()) {
        for (const page of Object.values(session.pages || {})) {
            if (!Array.isArray(page)) continue;
            for (const row of page) {
                const hit = matchName(row.filename);
                if (hit) return hit;
            }
        }
    }
    return null;
}

function omegasearchDsapResolveMetadataFilename(raw, driver) {
    const fromSession = omegasearchDsapFindFilenameInSession(driver, raw);
    if (fromSession) return fromSession;
    return omegasearchDsapNormalizeMetadataFilename(raw);
}

function omegasearchDsapResolveDetailFile(host) {
    if (!host || typeof host.getQueryParam !== 'function') return null;
    const raw = host.getQueryParam('file') || host.getQueryParam('image');
    return raw ? omegasearchDsapNormalizeMetadataFilename(raw) : null;
}

function omegasearchDsapResolveViewType(host) {
    const viewType = (host.getQueryParam('viewType') || 'images').toLowerCase();
    return OMEGASEARCH_VIEW_TYPES.some((entry) => entry.value === viewType) ? viewType : 'images';
}

function omegasearchDsapWorkspaceLabel(workspaceId) {
    if (workspaceId === OMEGASEARCH_GLOBAL_WORKSPACE) return 'Global';
    if (typeof workspaces !== 'undefined' && workspaces[workspaceId]?.name) {
        return workspaces[workspaceId].name;
    }
    return workspaceId || '—';
}

function omegasearchDsapFormatImageWorkspaces(metadata) {
    const ids = Array.isArray(metadata?.workspaceIds) && metadata.workspaceIds.length
        ? metadata.workspaceIds
        : (metadata?.workspaceId ? [metadata.workspaceId] : []);
    if (!ids.length) return '—';
    return ids.map((id) => omegasearchDsapWorkspaceLabel(id)).join(', ');
}

function omegasearchDsapGetDetailWorkspaceId(metadata) {
    if (!metadata) return null;
    if (metadata.workspaceId) return metadata.workspaceId;
    if (metadata.workspace) return metadata.workspace;
    if (Array.isArray(metadata.workspaceIds) && metadata.workspaceIds.length) {
        return metadata.workspaceIds[0];
    }
    return null;
}

function omegasearchDsapResolveDetailImage(filename, metadata) {
    if (!filename) return null;
    // findImageByFilename: public/scripts/comp/galleryView.js
    const found = findImageByFilename(filename);
    if (found) return found;
    const base = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '').replace(/_upscaled$/, '');
    return {
        filename,
        original: filename,
        base,
        upscaled: filename.includes('_upscaled') ? filename : undefined,
        metadata: metadata || null
    };
}

function omegasearchDsapIsDetailImagePinned(filename, metadata) {
    // findTrueImageIndexInGallery: public/scripts/comp/galleryView.js
    const imageIndex = findTrueImageIndexInGallery(filename);
    if (imageIndex !== -1 && allImages[imageIndex]?.isPinned !== undefined) {
        return !!allImages[imageIndex].isPinned;
    }
    return !!metadata?.isPinned;
}

function omegasearchDsapGetWorkspaceList() {
    const list = [];
    if (typeof workspaces !== 'undefined') {
        Object.entries(workspaces).forEach(([id, ws]) => {
            list.push({ id, name: ws.name || id });
        });
    }
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
}

function omegasearchDsapEstimateCorpusSize(workspaceId, viewType) {
    if (typeof workspaces === 'undefined') return 0;
    const countForWorkspace = (ws) => {
        if (!ws) return 0;
        switch (viewType) {
            case 'scraps':
                if (Array.isArray(ws.scraps)) return ws.scraps.length;
                return ws.scrapCount || 0;
            case 'pinned':
                if (Array.isArray(ws.pinned)) return ws.pinned.length;
                return 0;
            case 'upscaled':
            default:
                if (Array.isArray(ws.files)) return ws.files.length;
                return ws.fileCount || 0;
        }
    };
    if (workspaceId === OMEGASEARCH_GLOBAL_WORKSPACE) {
        return Object.values(workspaces).reduce((sum, ws) => sum + countForWorkspace(ws), 0);
    }
    return countForWorkspace(workspaces[workspaceId]);
}

function omegasearchDsapSourceLabel(source) {
    switch (source) {
        case 'character_prompt': return 'Character prompt';
        case 'v4_character_caption': return 'V4 character caption';
        case 'prompt':
        default:
            return 'Main prompt';
    }
}
