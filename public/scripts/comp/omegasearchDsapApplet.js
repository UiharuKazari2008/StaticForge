/**
 * Image Search DSAP — ispy.dreamscape.jp
 * Fast prompt-block search across workspace images with gallery + usage browser.
 *
 * Depends on: dsapRegistry.js, websocket.js, contextMenu.js
 */

const ISPY_DSAP_URL = 'ispy.dreamscape.jp';
const ISPY_DSAP_TITLE = 'Image Search';
const ISPY_DSAP_DATA_ID = 'ispy-dyna';
const OMEGASEARCH_DSAP_TAB_LABELS = {
    search: 'Search',
    gallery: 'Gallery',
    usages: 'Prompt Usages'
};
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
const OMEGASEARCH_RESOLUTION_TIERS = [
    { value: 'normal', label: 'Normal' },
    { value: 'large', label: 'Large' },
    { value: 'max', label: 'Max / wallpaper' }
];
const OMEGASEARCH_RELATIVE_DATE_PRESETS = [
    { value: '1d', label: '1 day' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: '90d', label: '90 days' },
    { value: '1y', label: '1 year' }
];
const OMEGASEARCH_NSFW_SLIDER_MIN = -2;
const OMEGASEARCH_NSFW_SLIDER_MAX = 3;
const OMEGASEARCH_UC_SLIDER_MIN = 0;
const OMEGASEARCH_UC_SLIDER_MAX = 8;
const OMEGASEARCH_NSFW_LEVEL_LABELS = {
    '-2': 'Clense',
    '-1': 'Remove',
    '0': 'Neutral',
    '1': 'Allow',
    '2': 'Skimpy',
    '3': 'Nude'
};
const OMEGASEARCH_UC_LEVEL_LABELS = ['None', 'Human Focus', 'Light', 'Heavy', 'Curated'];
const OMEGASEARCH_DEFAULT_LIMIT = 60;
const OMEGASEARCH_SESSION_STORAGE_KEY = 'ispy-dsap-search-sessions-v1';
let omegasearchDsapLastActiveSearch = null;
/** Module-level cache — survives DSAP destroy/init within the same page load. */
const omegasearchDsapSearchSessions = new Map();
let omegasearchDsapNextSessionSerial = 1;
let omegasearchDsapNextSearchGeneration = 0;

function omegasearchDsapGetWsClient() {
    // wsClient: public/scripts/websocket.js (window.wsClient)
    if (typeof wsClient !== 'undefined' && wsClient) return wsClient;
    return null;
}

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

function omegasearchDsapNsfwLevelLabel(value) {
    if (value == null) return OMEGASEARCH_NSFW_LEVEL_LABELS['0'];
    return OMEGASEARCH_NSFW_LEVEL_LABELS[String(value)] || String(value);
}

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

function omegasearchDsapEscapeAttr(text) {
    return String(text || '').replace(/"/g, '&quot;');
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
    return `/previews/${encodeURIComponent(previewPath)}`;
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

function omegasearchDsapTriStateLabel(prefix, value) {
    if (value === true) return `${prefix}: Yes`;
    if (value === false) return `${prefix}: No`;
    return `${prefix}: Any`;
}

function omegasearchDsapIsFilterValueUnset(value) {
    return value == null || value === '';
}

function omegasearchDsapIsDateBoundaryUnset(boundary) {
    if (boundary == null) return true;
    return omegasearchDsapIsFilterValueUnset(boundary.relative)
        && omegasearchDsapIsFilterValueUnset(boundary.absolute);
}

function omegasearchDsapEnumSelectionHighlighted(itemValue, currentValue) {
    if (omegasearchDsapIsFilterValueUnset(itemValue)) {
        return omegasearchDsapIsFilterValueUnset(currentValue);
    }
    return String(itemValue) === String(currentValue);
}

function omegasearchDsapApplyMenuItemHighlight(item, highlighted) {
    item.highlighted = !!highlighted;
    if (item._element) {
        item._element.classList.toggle('context-menu-item-highlighted', item.highlighted);
    }
}

function omegasearchDsapMatchModeLabel(mode) {
    const match = OMEGASEARCH_MATCH_MODES.find((entry) => entry.value === mode);
    return match ? match.label : 'Substring';
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

function omegasearchDsapHasActiveFilters(filters) {
    const f = filters || {};
    return Boolean(
        (f.dateBefore && (f.dateBefore.relative || f.dateBefore.absolute))
        || (f.dateAfter && (f.dateAfter.relative || f.dateAfter.absolute))
        || (f.dateRange && (f.dateRange.start || f.dateRange.end))
        || f.qualityPreset != null
        || f.ucLevel != null
        || f.nsfwLevel != null
        || (f.models && f.models.length)
        || f.stepsMin != null
        || f.stepsMax != null
        || f.sampler
        || f.scheduler
        || f.isUpscaled != null
        || f.guidanceMin != null
        || f.guidanceMax != null
        || f.rescaleMin != null
        || f.rescaleMax != null
        || f.hasDynamicReplacements != null
        || (f.resolutionPreset && f.resolutionPreset.length)
        || f.consecutiveSeeds
    );
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

function omegasearchDsapResolvePromptSource(host) {
    const fromFilters = omegasearchDsapResolveFilters(host).promptSource;
    return fromFilters || null;
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
    const lower = raw.toLowerCase();
    const ranges = [];

    for (const term of sorted) {
        const termLower = term.toLowerCase();
        let idx = 0;
        while (idx < lower.length) {
            const found = lower.indexOf(termLower, idx);
            if (found === -1) break;
            ranges.push({ start: found, end: found + term.length });
            idx = found + 1;
        }
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

function omegasearchDsapBuildModelBadgeHtml(modelKey) {
    const key = String(modelKey || '').toLowerCase();
    const badge = modelBadges[key];
    if (!badge) return omegasearchDsapEscapeHtml(modelKey || 'Unknown');
    const badgeLabel = badge.badge_full || badge.badge;
    const badgeClass = badge.badge_class || '';
    const display = badge.display_full || badge.display || key;
    if (badgeLabel) {
        return `<span class="preset-model ${omegasearchDsapEscapeAttr(badgeClass)}"><span>NovelAI ${omegasearchDsapEscapeHtml(display)}</span><span class="custom-dropdown-badge ${omegasearchDsapEscapeAttr(badgeClass)}">${omegasearchDsapEscapeHtml(badgeLabel)}</span></span>`;
    }
    const name = modelNames[key] || display;
    return `<span class="preset-model">${omegasearchDsapEscapeHtml(name)}</span>`;
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

function omegasearchDsapFormatExpanderList(items) {
    if (!items) return '<div class="omega-dsap-detail-empty">None</div>';
    const list = Array.isArray(items) ? items : [items];
    if (!list.length) return '<div class="omega-dsap-detail-empty">None</div>';
    const rows = list.map((item) => {
        if (item == null) return '';
        if (typeof item === 'string') {
            return `<div class="omega-dsap-expander-row">${omegasearchDsapEscapeHtml(item)}</div>`;
        }
        const label = item.name || item.key || item.select_text || item.pattern || item.id || 'Expander';
        const body = item.replacement || item.value || item.text || item.replacement_text || '';
        return `<div class="omega-dsap-expander-row"><strong>${omegasearchDsapEscapeHtml(label)}</strong>${body ? `<div class="omega-dsap-expander-body">${omegasearchDsapEscapeHtml(body)}</div>` : ''}</div>`;
    }).filter(Boolean);
    return rows.length ? rows.join('') : '<div class="omega-dsap-detail-empty">None</div>';
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

    const qs = q.toString();
    return qs ? `dsap://${ISPY_DSAP_URL}/?${qs}` : `dsap://${ISPY_DSAP_URL}/`;
}

function openIspyDsap(params = {}) {
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    openDsapInGrimoire(omegasearchDsapBuildUrl(params));
}

function openOmegasearchDsap(params = {}) {
    openIspyDsap(params);
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

function omegasearchDsapResolveActiveTab(host) {
    const view = omegasearchDsapResolveView(host);
    if (view === 'detail') return 'gallery';
    if (view === 'usages') return 'usages';
    if (view === 'search') return 'search';
    const blocks = omegasearchDsapResolveBlocks(host);
    if (!blocks.length) return 'search';
    return 'gallery';
}

function omegasearchDsapBuildTabBarHtml(activeTabId) {
    // dsapSmfBuildTabBar: public/scripts/comp/dsapSmfMarkup.js
    return dsapSmfBuildTabBar([
        { id: 'search', label: 'Search', icon: 'fas fa-search' },
        { id: 'gallery', label: 'Gallery', icon: 'fas fa-images' },
        { id: 'usages', label: 'Prompt Usages', icon: 'fas fa-list' }
    ], activeTabId || 'search', { tabBarId: 'omegaTabBar', dataAttr: 'data-omega-tab' });
}

function omegasearchDsapBuildContextBarHtml() {
    // dsapSmfBuildContextBar: public/scripts/comp/dsapSmfMarkup.js
    return dsapSmfBuildContextBar(`
  <span class="omega-dsap-context-label">Workspace:</span>
  <button type="button" id="omegaWorkspaceBtn" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-context-btn" title="Select workspace">
    <span id="omegaWorkspaceLabel">—</span> <i class="fas fa-caret-down"></i>
  </button>
  <button type="button" id="omegaWorkspaceThisBtn" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-context-btn" title="Use current active workspace">This</button>
  · Corpus: <span id="omegaCorpusSize">0</span> files`);
}

function omegasearchDsapBuildStatsHtml() {
    // dsapSmfBuildStatsTable: public/scripts/comp/dsapSmfMarkup.js
    return dsapSmfBuildStatsTable([
        { label: 'Matches', valueHtml: '<span id="omegaStatMatches">0</span>', width: '33%' },
        { label: 'Showing', valueHtml: '<span id="omegaStatShowing">0</span>', width: '33%' },
        { label: 'Usages', valueHtml: '<span id="omegaStatUsages">0</span>', width: '34%' }
    ], 'omegaStatsTable');
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

function omegasearchDsapBuildHtml() {
    const searchToolbarHtml = `
    <label class="omega-dsap-search-label" for="omegaPrimaryInput">Search</label>
    <input type="text" id="omegaPrimaryInput" class="dsap-smf-input omega-dsap-search-input" placeholder="Enter block, tag, or term1 | term2… then Enter to add" autocomplete="off">
    <button type="button" id="omegaViewTypeBtn" class="dsap-smf-btn" title="View type">
      <i class="fas fa-layer-group"></i>
      <span id="omegaViewTypeSelected">Images</span>
      <i class="fas fa-caret-down"></i>
    </button>
    <button type="button" id="omegaSearchBtn" class="dsap-smf-btn dsap-smf-btn-primary" title="Search"><i class="fas fa-search"></i> Search</button>`;

    return `
<div data-dsap="${ISPY_DSAP_DATA_ID}" class="dsap-root dsap-smf omegasearch-dsap">
${dsapSmfBuildHeader({
    branchTitle: DSAP_SMF_BRANCH_DATA_MGMT,
    toolTitle: OMEGASEARCH_DSAP_TAB_LABELS.search
})}
<div id="omegaSearchProgressBanner" class="omega-dsap-search-progress-banner hidden" role="status" aria-live="polite">
  <i class="fas fa-spinner-third fa-spin"></i>
  <span id="omegaSearchProgressText">Searching workspace corpus…</span>
</div>
${omegasearchDsapBuildTabBarHtml('search')}
${omegasearchDsapBuildContextBarHtml()}

<div class="omega-dsap-view" id="omegaSearchView">
<div class="omega-dsap-search-panel" id="omegaSearchPanel">
  <div class="omega-dsap-landing-hint" id="omegaLandingHint">
    <p><strong>I spy with my little eye…</strong> Search prompt blocks across <strong>Global</strong> (all workspaces) or a single workspace. Type a tag or phrase and press <strong>Enter</strong> to add AND blocks (<code>|</code> or <code> OR </code> for alternates within a block). Press <strong>Enter</strong> on an empty field or click <strong>Search</strong> to run the query.</p>
  </div>
  <div class="omega-dsap-active-search-restore hidden" id="omegaActiveSearchRestore">
    <button type="button" id="omegaReturnToSearchBtn" class="dsap-smf-btn dsap-smf-btn-primary"><i class="fas fa-arrow-right"></i> Return to active search</button>
    <span class="omega-dsap-active-search-label" id="omegaActiveSearchLabel"></span>
  </div>
  ${dsapSmfBuildToolbar(searchToolbarHtml, 'omegaSearchToolbar')}
  <div id="omegaBlockChips" class="omega-dsap-block-chips"></div>

  <div class="omega-dsap-advanced-filters" id="omegaAdvancedFilters">
    <div class="omega-dsap-advanced-hdr omega-dsap-section-toggle-hdr" id="omegaAdvancedFiltersToggle" role="button" tabindex="0" title="Show or hide metadata filters">
      <i class="fas fa-chevron-right omega-dsap-section-chevron" aria-hidden="true"></i>
      <strong>Metadata filters</strong>
      <span class="omega-dsap-advanced-hint">Adjust filters, then click Search to apply</span>
      <button type="button" id="omegaFiltersCollapseBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Hide metadata filters"><i class="fas fa-chevron-up" id="omegaFiltersCollapseIcon" aria-hidden="true"></i> <span id="omegaFiltersCollapseLabel">Hide filters</span></button>
      <button type="button" id="omegaClearFiltersBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Clear all metadata filters"><i class="fas fa-eraser"></i> Clear</button>
    </div>
    <div class="omega-dsap-advanced-body" id="omegaAdvancedFiltersBody">
    <table class="omega-dsap-settings-table" cellspacing="0" cellpadding="4" border="0" width="100%">
      <tr>
        <td class="omega-dsap-setting-label">Prompt source</td>
        <td class="omega-dsap-setting-control">
          <button type="button" id="omegaPromptCompiledBtn" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-toggle-btn" data-state="on" data-ispy-prompt-source="compiled"><i class="fas fa-file-code"></i> Compiled</button>
          <button type="button" id="omegaPromptInputBtn" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-toggle-btn" data-state="on" data-ispy-prompt-source="input"><i class="fas fa-keyboard"></i> Input</button>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Default match</td>
        <td class="omega-dsap-setting-control">
          <button type="button" id="omegaDefaultMatchBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Default match mode for new blocks"><i class="fas fa-text-width"></i> <span id="omegaDefaultMatchLabel">Substring</span> <i class="fas fa-caret-down"></i></button>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Quality preset</td>
        <td class="omega-dsap-setting-control">
          <div class="omega-dsap-toggle-group" data-ispy-tristate="qualityPreset">
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn omega-dsap-tristate-active" data-tristate-value="">Any</button>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn" data-tristate-value="1">Yes</button>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn" data-tristate-value="0">No</button>
          </div>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">UC preset</td>
        <td class="omega-dsap-setting-control">
          <button type="button" id="omegaUcAnyBtn" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-toggle-btn omega-dsap-tristate-active" data-ispy-uc-any="1">Any</button>
          <div class="omega-dsap-slider-wrap" id="omegaUcSliderWrap">
            <div class="omega-dsap-slider-track">
              <span class="omega-dsap-slider-value" id="omegaUcSliderValue">0</span>
              <input type="range" id="omegaUcSlider" class="omega-dsap-slider-input" min="${OMEGASEARCH_UC_SLIDER_MIN}" max="${OMEGASEARCH_UC_SLIDER_MAX}" step="1" value="0">
            </div>
          </div>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">NSFW level</td>
        <td class="omega-dsap-setting-control">
          <button type="button" id="omegaNsfwAnyBtn" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-toggle-btn omega-dsap-tristate-active" data-ispy-nsfw-any="1">Any</button>
          <div class="omega-dsap-slider-wrap omega-dsap-slider-wrap-centered" id="omegaNsfwSliderWrap">
            <div class="omega-dsap-slider-track">
              <span class="omega-dsap-slider-value" id="omegaNsfwSliderValue">0</span>
              <input type="range" id="omegaNsfwSlider" class="omega-dsap-slider-input" min="${OMEGASEARCH_NSFW_SLIDER_MIN}" max="${OMEGASEARCH_NSFW_SLIDER_MAX}" step="1" value="0">
            </div>
          </div>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Date</td>
        <td class="omega-dsap-setting-control">
          <div class="omega-dsap-toggle-group" data-ispy-date-mode>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-date-mode-btn omega-dsap-tristate-active" data-date-mode="relative">Relative</button>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-date-mode-btn" data-date-mode="exact">Exact</button>
          </div>
          <div class="omega-dsap-date-relative" id="omegaDateRelativeControls">
            <span class="omega-dsap-inline-field">
              <button type="button" id="omegaDateAfterBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Created after"><i class="fas fa-calendar-plus"></i> <span id="omegaDateAfterLabel">After: Any</span> <i class="fas fa-caret-down"></i></button>
              <button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="dateAfter" title="Clear after date"><i class="fas fa-times"></i></button>
            </span>
            <span class="omega-dsap-inline-field">
              <button type="button" id="omegaDateBeforeBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Created before"><i class="fas fa-calendar-minus"></i> <span id="omegaDateBeforeLabel">Before: Any</span> <i class="fas fa-caret-down"></i></button>
              <button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="dateBefore" title="Clear before date"><i class="fas fa-times"></i></button>
            </span>
          </div>
          <div class="omega-dsap-date-exact hidden" id="omegaDateExactControls">
            <label class="omega-dsap-inline-field" title="Date range start"><span>From</span><input type="date" id="omegaDateRangeStart" class="dsap-smf-input omega-dsap-mini-input"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="dateRangeStart" title="Clear from date"><i class="fas fa-times"></i></button></label>
            <label class="omega-dsap-inline-field" title="Date range end"><span>To</span><input type="date" id="omegaDateRangeEnd" class="dsap-smf-input omega-dsap-mini-input"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="dateRangeEnd" title="Clear to date"><i class="fas fa-times"></i></button></label>
          </div>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Model</td>
        <td class="omega-dsap-setting-control">
          <button type="button" id="omegaModelsBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Models (multi-select)"><i class="fas fa-microchip"></i> <span id="omegaModelsLabel">All models</span> <i class="fas fa-caret-down"></i></button>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Sampler / scheduler</td>
        <td class="omega-dsap-setting-control">
          <button type="button" id="omegaSamplerBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Sampler"><span id="omegaSamplerLabel">Any sampler</span> <i class="fas fa-caret-down"></i></button>
          <button type="button" id="omegaSchedulerBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Noise scheduler"><span id="omegaSchedulerLabel">Any scheduler</span> <i class="fas fa-caret-down"></i></button>
          <button type="button" id="omegaResolutionBtn" class="dsap-smf-btn dsap-smf-btn-small" title="Resolution tier"><i class="fas fa-expand"></i> <span id="omegaResolutionLabel">All resolutions</span> <i class="fas fa-caret-down"></i></button>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Steps</td>
        <td class="omega-dsap-setting-control">
          <label class="omega-dsap-inline-field" title="Minimum steps"><span>≥</span><input type="number" id="omegaStepsMin" class="dsap-smf-input omega-dsap-mini-input" min="1" max="150" placeholder="—"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="stepsMin" title="Clear minimum steps"><i class="fas fa-times"></i></button></label>
          <label class="omega-dsap-inline-field" title="Maximum steps"><span>≤</span><input type="number" id="omegaStepsMax" class="dsap-smf-input omega-dsap-mini-input" min="1" max="150" placeholder="—"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="stepsMax" title="Clear maximum steps"><i class="fas fa-times"></i></button></label>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Guidance</td>
        <td class="omega-dsap-setting-control">
          <label class="omega-dsap-inline-field" title="Minimum guidance"><span>≥</span><input type="number" id="omegaGuidanceMin" class="dsap-smf-input omega-dsap-mini-input" min="0" max="30" step="0.1" placeholder="—"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="guidanceMin" title="Clear minimum guidance"><i class="fas fa-times"></i></button></label>
          <label class="omega-dsap-inline-field" title="Maximum guidance"><span>≤</span><input type="number" id="omegaGuidanceMax" class="dsap-smf-input omega-dsap-mini-input" min="0" max="30" step="0.1" placeholder="—"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="guidanceMax" title="Clear maximum guidance"><i class="fas fa-times"></i></button></label>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Rescale</td>
        <td class="omega-dsap-setting-control">
          <label class="omega-dsap-inline-field" title="Minimum rescale"><span>≥</span><input type="number" id="omegaRescaleMin" class="dsap-smf-input omega-dsap-mini-input" min="0" max="1" step="0.01" placeholder="—"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="rescaleMin" title="Clear minimum rescale"><i class="fas fa-times"></i></button></label>
          <label class="omega-dsap-inline-field" title="Maximum rescale"><span>≤</span><input type="number" id="omegaRescaleMax" class="dsap-smf-input omega-dsap-mini-input" min="0" max="1" step="0.01" placeholder="—"><button type="button" class="omega-dsap-field-clear hidden" data-ispy-clear-filter="rescaleMax" title="Clear maximum rescale"><i class="fas fa-times"></i></button></label>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Upscaled</td>
        <td class="omega-dsap-setting-control">
          <div class="omega-dsap-toggle-group" data-ispy-tristate="isUpscaled">
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn omega-dsap-tristate-active" data-tristate-value="">Any</button>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn" data-tristate-value="1">Yes</button>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn" data-tristate-value="0">No</button>
          </div>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Dyn. replacements</td>
        <td class="omega-dsap-setting-control">
          <div class="omega-dsap-toggle-group" data-ispy-tristate="hasDynamicReplacements">
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn omega-dsap-tristate-active" data-tristate-value="">Any</button>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn" data-tristate-value="1">Yes</button>
            <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-tristate-btn" data-tristate-value="0">No</button>
          </div>
        </td>
      </tr>
      <tr>
        <td class="omega-dsap-setting-label">Consecutive seeds</td>
        <td class="omega-dsap-setting-control">
          <button type="button" id="omegaConsecutiveSeedsBtn" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-toggle-btn" data-state="off" title="Same seed within 24h runs"><i class="fas fa-toggle-off"></i> <span id="omegaConsecutiveSeedsLabel">Off</span></button>
        </td>
      </tr>
    </table>
    </div>
  </div>
</div>
</div>

<div class="omega-dsap-results hidden" id="omegaResultsSection">
${omegasearchDsapBuildStatsHtml().replace('class="dsap-smf-stats"', 'class="dsap-smf-stats hidden" id="omegaStatsTable"')}

<div class="omega-dsap-view omega-dsap-gallery-view" id="omegaGalleryView">
  <div id="omegaGalleryLoading" class="omega-dsap-loading hidden"><i class="fas fa-spinner-third fa-spin"></i> Searching…</div>
  <div id="omegaGalleryEmpty" class="omega-dsap-empty hidden"><i class="fas fa-search"></i> No images match all blocks</div>
  <div id="omegaGalleryGrid" class="omega-dsap-gallery-grid"></div>
  <div class="omega-dsap-pager hidden" id="omegaGalleryPager">
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-pager="prev" id="omegaGalleryPrev"><i class="fas fa-chevron-left"></i> Prev</button>
    <span class="omega-dsap-pager-info">Page <strong id="omegaGalleryPage">1</strong> / <span id="omegaGalleryTotalPages">1</span></span>
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-pager="next" id="omegaGalleryNext">Next <i class="fas fa-chevron-right"></i></button>
  </div>
</div>

<div class="omega-dsap-view omega-dsap-usages-view hidden" id="omegaUsagesView">
  <div id="omegaUsagesLoading" class="omega-dsap-loading hidden"><i class="fas fa-spinner-third fa-spin"></i> Loading usages…</div>
  <div id="omegaUsagesEmpty" class="omega-dsap-empty hidden"><i class="fas fa-info-circle"></i> No prompt usages for current filters</div>
  <table class="omega-dsap-usages-table" id="omegaUsagesTable" cellspacing="0" cellpadding="4" width="100%" border="1">
    <thead>
      <tr>
        <th align="left">Block</th>
        <th align="left">Location</th>
        <th align="left">Text</th>
        <th align="right" width="70">Files</th>
      </tr>
    </thead>
    <tbody id="omegaUsagesBody"></tbody>
  </table>
</div>

<div class="omega-dsap-view omega-dsap-detail-view hidden" id="omegaDetailView">
  ${dsapSmfBuildToolbar(`<button type="button" id="omegaDetailBack" class="dsap-smf-btn" title="Back to gallery results"><i class="fas fa-arrow-left"></i> Back to results</button>
    <span class="omega-dsap-detail-filename" id="omegaDetailFilename"></span>`, 'omegaDetailToolbar')}
  <div id="omegaDetailLoading" class="omega-dsap-loading hidden"><i class="fas fa-spinner-third fa-spin"></i> <span id="omegaDetailProgressText">Loading image details…</span></div>
  <div id="omegaDetailError" class="omega-dsap-empty hidden"><i class="fas fa-exclamation-triangle"></i> <span id="omegaDetailErrorText">Failed to load image</span></div>
  <div class="omega-dsap-detail-layout hidden" id="omegaDetailLayout">
    <div class="omega-dsap-detail-image-wrap">
      <div id="omegaDetailImageLoading" class="omega-dsap-loading hidden"><i class="fas fa-spinner-third fa-spin"></i> Loading preview…</div>
      <img id="omegaDetailImage" class="omega-dsap-detail-image" alt="">
    </div>
    <div class="omega-dsap-detail-panel">
      <div class="dsap-smf-toolbar" id="omegaDetailActions">
        <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-detail-action="jump" disabled title="Jump to image in gallery"><i class="fas fa-crosshairs"></i> Jump to Image</button>
        <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-detail-action="workspace" disabled title="Switch to image workspace"><i class="fas fa-planet-ringed"></i> Go to Workspace</button>
        <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-detail-action="editor" disabled title="Open in DreamStudio editor"><i class="fas fa-compass-drafting"></i> Open in Editor</button>
        <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-detail-action="favorite" disabled title="Favorite image"><i class="fa-regular fa-star" id="omegaDetailFavoriteIcon"></i> <span id="omegaDetailFavoriteLabel">Favorite</span></button>
        <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-detail-action="window" disabled title="Open in Lumen window"><i class="fas fa-window"></i> Open in Window</button>
        <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-detail-action="download" disabled title="Download image"><i class="fas fa-download"></i> Download</button>
      </div>
      <div id="omegaDetailMetaLoading" class="omega-dsap-loading hidden"><i class="fas fa-spinner-third fa-spin"></i> Loading metadata…</div>
      <div class="omega-dsap-detail-meta hidden" id="omegaDetailMeta"></div>
      <div class="omega-dsap-detail-controls">
        <div class="dsap-smf-tabbar-flex omega-dsap-detail-tabbar" id="omegaDetailMainTabs">
          <button type="button" class="omega-dsap-tab omega-dsap-tab-active" data-omega-detail-tab="prompts"><i class="fas fa-align-left"></i> Prompts</button>
          <button type="button" class="omega-dsap-tab" data-omega-detail-tab="uc"><i class="fas fa-ban"></i> UC / Negative</button>
          <button type="button" class="omega-dsap-tab" data-omega-detail-tab="expanders"><i class="fas fa-wand-magic-sparkles"></i> Expanders</button>
        </div>
        <div class="omega-dsap-detail-togglebar hidden" id="omegaDetailPromptToggle">
          <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-toggle-active" data-omega-prompt-mode="input">Input prompt</button>
          <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-prompt-mode="compiled">Final / compiled</button>
        </div>
        <div class="omega-dsap-detail-subtabbar hidden" id="omegaDetailExpanderTabs">
          <button type="button" class="dsap-smf-btn dsap-smf-btn-small omega-dsap-toggle-active" data-omega-expander-tab="genso">Text expanders</button>
          <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-omega-expander-tab="tenso">Tendai expanders</button>
        </div>
      </div>
      <div class="omega-dsap-detail-body" id="omegaDetailBody"></div>
    </div>
  </div>
</div>
</div>
</div>`;
}

const omegasearchDsapScopedCss = `
[data-dsap="ispy-dyna"].omegasearch-dsap {
  min-height: 100%;
}
[data-dsap="ispy-dyna"] .omega-dsap-search-progress-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #ff8c00;
  color: #1a1200;
  border: 2px solid #cc7000;
  font-size: 14pt;
  font-weight: bold;
  padding: 12px 16px;
  margin: 0 0 6px;
  text-align: center;
}
[data-dsap="ispy-dyna"] .omega-dsap-search-progress-banner.hidden {
  display: none !important;
}
[data-dsap="ispy-dyna"] .omega-dsap-active-search-restore {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  padding: 8px 10px;
  background: #fff8ee;
  border: 1px solid #cc7000;
}
[data-dsap="ispy-dyna"] .omega-dsap-active-search-restore.hidden {
  display: none !important;
}
[data-dsap="ispy-dyna"] .omega-dsap-active-search-label {
  color: #553300;
  font-size: 11pt;
}
/* Header, tabs, context bar, section hdr, stats, toolbar, buttons, inputs, loading/empty, usages table: public/css/dsap-smf.css */
[data-dsap="ispy-dyna"] .dsap-smf-contextbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
[data-dsap="ispy-dyna"] .dsap-smf-contextbar .omega-dsap-context-btn {
  background: #004488;
  color: #fff;
  border-color: #6699cc;
}
[data-dsap="ispy-dyna"] .dsap-smf-contextbar .omega-dsap-context-btn:hover {
  background: #0055aa;
}
[data-dsap="ispy-dyna"] .omega-dsap-toggle-btn[data-state="on"],
[data-dsap="ispy-dyna"] .omega-dsap-toggle-btn.omega-dsap-tristate-active,
[data-dsap="ispy-dyna"] .omega-dsap-tristate-btn.omega-dsap-tristate-active,
[data-dsap="ispy-dyna"] .omega-dsap-date-mode-btn.omega-dsap-tristate-active {
  background: #c8e6c8;
  color: #003300;
  border-color: #006600;
}
[data-dsap="ispy-dyna"] .omega-dsap-toggle-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
}
[data-dsap="ispy-dyna"] .omega-dsap-settings-table {
  background: #f8f8f8;
  border: 1px solid #999999;
  margin: 5px 0;
  font-size: 11pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-settings-table td {
  padding: 6px 8px;
  vertical-align: middle;
  border-bottom: 1px solid #dddddd;
}
[data-dsap="ispy-dyna"] .omega-dsap-setting-label {
  font-weight: bold;
  color: #000000;
  white-space: nowrap;
  width: 130px;
}
[data-dsap="ispy-dyna"] .omega-dsap-setting-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
[data-dsap="ispy-dyna"] .omega-dsap-date-relative,
[data-dsap="ispy-dyna"] .omega-dsap-date-exact {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-wrap {
  flex: 1 1 160px;
  max-width: 220px;
  min-width: 140px;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-wrap.hidden {
  display: none !important;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-track {
  position: relative;
  height: 22px;
  background: #ffffff;
  border: 1px solid #666666;
  display: flex;
  align-items: center;
  overflow: hidden;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-value {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 10pt;
  font-weight: bold;
  color: #003366;
  pointer-events: none;
  z-index: 1;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-input {
  position: relative;
  z-index: 2;
  width: 100%;
  margin: 0;
  height: 22px;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 18px;
  background: #003366;
  border: 1px solid #001a33;
  cursor: pointer;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-input::-moz-range-thumb {
  width: 10px;
  height: 18px;
  background: #003366;
  border: 1px solid #001a33;
  cursor: pointer;
}
[data-dsap="ispy-dyna"] .omega-dsap-slider-wrap-centered .omega-dsap-slider-track::before {
  content: '';
  position: absolute;
  left: 40%;
  top: 3px;
  bottom: 3px;
  width: 1px;
  background: #99aabb;
  pointer-events: none;
  z-index: 0;
}
[data-dsap="ispy-dyna"] .omega-dsap-search-panel {
  background: #fff;
  border: 1px solid #999;
  padding: 6px;
  margin-bottom: 5px;
}
[data-dsap="ispy-dyna"].omega-dsap-landing .omega-dsap-search-panel {
  padding: 12px 10px;
  margin-bottom: 0;
}
[data-dsap="ispy-dyna"] .omega-dsap-landing-hint {
  display: none;
  margin: 0 0 10px;
  padding: 8px 10px;
  background: #f5f8fc;
  border: 1px solid #c5d4e8;
  font-size: 10.5pt;
  line-height: 1.45;
}
[data-dsap="ispy-dyna"].omega-dsap-landing .omega-dsap-landing-hint {
  display: block;
}
[data-dsap="ispy-dyna"] .omega-dsap-landing-hint code {
  background: #e8eef5;
  padding: 0 3px;
  font-size: 10pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-search-label {
  font-weight: bold;
  font-size: 11pt;
  min-width: 56px;
}
[data-dsap="ispy-dyna"] .omega-dsap-search-input {
  flex: 1 1 180px;
  min-width: 120px;
}
[data-dsap="ispy-dyna"].omega-dsap-landing .omega-dsap-search-input {
  min-width: 220px;
  padding: 6px 8px;
  font-size: 12pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-block-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 4px;
  margin-top: 4px;
}
[data-dsap="ispy-dyna"] .omega-dsap-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #dde8f5;
  border: 1px solid #6699cc;
  padding: 2px 6px;
  font-size: 10pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-chip-or {
  background: #e8f0dd;
  border-color: #88aa66;
}
[data-dsap="ispy-dyna"] .omega-dsap-chip-remove {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #003366;
  padding: 0 2px;
}
[data-dsap="ispy-dyna"] .omega-dsap-chip-match {
  font-size: 9pt;
  color: #335577;
  font-style: italic;
}
[data-dsap="ispy-dyna"] .omega-dsap-advanced-filters {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #c5d4e8;
}
[data-dsap="ispy-dyna"] .omega-dsap-advanced-body {
  margin-top: 6px;
}
[data-dsap="ispy-dyna"] .omega-dsap-advanced-hdr {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 10.5pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-section-toggle-hdr {
  cursor: pointer;
  user-select: none;
}
[data-dsap="ispy-dyna"] .omega-dsap-section-chevron {
  font-size: 9pt;
  color: #335577;
  transition: transform 0.15s ease;
}
[data-dsap="ispy-dyna"] .omega-dsap-advanced-filters:not(.omega-dsap-filters-collapsed) .omega-dsap-section-chevron {
  transform: rotate(90deg);
}
[data-dsap="ispy-dyna"] .omega-dsap-advanced-filters.omega-dsap-filters-collapsed .omega-dsap-advanced-body {
  display: none;
}
[data-dsap="ispy-dyna"] .omega-dsap-advanced-hint {
  flex: 1 1 160px;
  color: #555;
  font-size: 10pt;
  font-weight: normal;
}
[data-dsap="ispy-dyna"] .omega-dsap-inline-field {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10pt;
  color: #333;
}
[data-dsap="ispy-dyna"] .omega-dsap-inline-field span {
  white-space: nowrap;
}
[data-dsap="ispy-dyna"] .omega-dsap-mini-input {
  width: 88px;
}
[data-dsap="ispy-dyna"] .omega-dsap-mini-input[type="date"] {
  width: 128px;
}
[data-dsap="ispy-dyna"] .omega-dsap-field-clear {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #666;
  padding: 0 2px;
  font-size: 9pt;
  line-height: 1;
}
[data-dsap="ispy-dyna"] .omega-dsap-field-clear:hover {
  color: #003366;
}
[data-dsap="ispy-dyna"].omega-dsap-filters-active .omega-dsap-advanced-hdr strong {
  color: #003366;
}
[data-dsap="ispy-dyna"] .omega-dsap-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 6px;
  padding: 4px;
  background: #fff;
  border: 1px solid #999;
  min-height: 80px;
}
[data-dsap="ispy-dyna"] .omega-dsap-gallery-item {
  position: relative;
  border: 1px solid #666;
  background: #f5f5f5;
  cursor: pointer;
  aspect-ratio: 1;
  overflow: hidden;
}
[data-dsap="ispy-dyna"] .omega-dsap-gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
[data-dsap="ispy-dyna"] .omega-dsap-gallery-item-score {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 9pt;
  padding: 2px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-dsap="ispy-dyna"] .omega-dsap-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
[data-dsap="ispy-dyna"] .omega-dsap-usage-text {
  word-break: break-word;
}
[data-dsap="ispy-dyna"] mark.omega-dsap-highlight {
  background: #fff3a0;
  color: inherit;
  padding: 0 1px;
}
[data-dsap="ispy-dyna"] .omega-dsap-usage-expand-btn {
  border: none;
  background: transparent;
  color: #003366;
  cursor: pointer;
  padding: 0 4px;
  font-size: 10pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-usage-expand-row td {
  background: #f8fafc;
  border-top: none;
}
[data-dsap="ispy-dyna"] .omega-dsap-usage-full-prompt {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 10pt;
  line-height: 1.4;
  padding: 4px 0;
}
[data-dsap="ispy-dyna"] .omega-dsap-usage-char-block {
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px dashed #ccc;
}
[data-dsap="ispy-dyna"] .omega-dsap-usage-char-label {
  font-weight: bold;
  font-size: 9.5pt;
  color: #336699;
  margin-bottom: 2px;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-view {
  margin-top: 4px;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-filename {
  font-size: 10pt;
  color: #333;
  word-break: break-all;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-layout {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  background: #fff;
  border: 1px solid #999;
  padding: 6px;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-image-wrap {
  flex: 1 1 280px;
  min-width: 200px;
  max-width: 100%;
  text-align: center;
  position: relative;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-image-wrap > .omega-dsap-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 245, 245, 0.9);
  z-index: 1;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-image {
  max-width: 100%;
  max-height: min(70vh, 720px);
  object-fit: contain;
  border: 1px solid #666;
  background: #f5f5f5;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-image.omega-dsap-detail-image-loading {
  opacity: 0.35;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-panel {
  flex: 1 1 320px;
  min-width: 260px;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-meta {
  background: #f5f8fc;
  border: 1px solid #c5d4e8;
  padding: 6px 8px;
  margin-bottom: 6px;
  font-size: 10pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 4px;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-meta-item label {
  display: block;
  font-size: 9pt;
  color: #555;
  font-weight: bold;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-meta-item .omega-dsap-meta-value {
  font-size: 10.5pt;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-controls {
  margin-bottom: 4px;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-togglebar,
[data-dsap="ispy-dyna"] .omega-dsap-detail-subtabbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
[data-dsap="ispy-dyna"] .omega-dsap-toggle-active {
  background: #003366;
  color: #fff;
  border-color: #001a33;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-body {
  background: #fff;
  border: 1px solid #999;
  padding: 8px;
  min-height: 120px;
  max-height: 50vh;
  overflow: auto;
  font-size: 10pt;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-prompt-section {
  margin-bottom: 10px;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-prompt-section h4 {
  margin: 0 0 4px;
  font-size: 10pt;
  color: #003366;
}
[data-dsap="ispy-dyna"] .omega-dsap-detail-empty {
  color: #666;
  font-style: italic;
}
[data-dsap="ispy-dyna"] .omega-dsap-expander-row {
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e0e0e0;
}
[data-dsap="ispy-dyna"] .omega-dsap-expander-body {
  margin-top: 2px;
  color: #333;
  white-space: pre-wrap;
}
[data-dsap="ispy-dyna"].omega-dsap-detail-mode #omegaTabBar {
  display: none;
}
`;

const omegasearchDsapDriver = {
    _state: null,
    _clickMenuTargets: [],
    _chipMenuTargets: [],
    _filtersCollapsed: null,

    init(host) {
        omegasearchDsapRestoreSessionsFromStorage();
        this._filtersCollapsed = null;
        const blockOptions = omegasearchDsapResolveBlockOptions(host);
        const filters = omegasearchDsapResolveFilters(host);
        const promptSourceFromUrl = filters.promptSource || omegasearchDsapResolvePromptSource(host);
        const promptSourceCompiled = promptSourceFromUrl !== 'input';
        const promptSourceInput = promptSourceFromUrl !== 'compiled';

        const blocks = omegasearchDsapResolveBlocks(host);
        let view = omegasearchDsapResolveView(host);
        if (view === 'gallery' && !blocks.length) {
            view = 'search';
        }

        this._state = {
            host,
            workspaceId: omegasearchDsapResolveWorkspaceId(host),
            blocks,
            view,
            viewType: omegasearchDsapResolveViewType(host),
            detailFile: omegasearchDsapResolveDetailFile(host),
            filters,
            blockOptions,
            promptSourceCompiled,
            promptSourceInput,
            promptSource: promptSourceFromUrl,
            chipMenuIndex: null,
            detailMetadata: null,
            detailPromptTab: 'prompts',
            detailPromptMode: 'input',
            detailExpanderTab: 'genso',
            detailLoading: false,
            detailImageReady: false,
            detailToken: 0,
            expandedUsages: new Set(),
            usagePromptCache: {},
            page: omegasearchDsapResolvePage(host),
            pageSize: OMEGASEARCH_DEFAULT_LIMIT,
            total: 0,
            results: [],
            usages: [],
            loading: false,
            searchSessionId: null,
            serverSearchSessionId: null,
            resultsActive: (omegasearchDsapResolveBlocks(host) || []).length > 0
        };

        const root = host.getRoot();
        if (!root) return;

        this._cacheElements(root);
        this._wireEvents(root);
        this._wireMainTabs(host);
        setTimeout(() => {
            this._wireClickMenus(root);
            this._wireChipMatchMenus();
        }, 0);
        this._syncInputsFromState();
        this._syncFilterControlsFromState();
        this._renderBlockChips();
        this._syncViewTabs();
        this._updateWorkspaceLabel();
        this._updateCorpusEstimate();
        this._syncDateModeVisibility();
        this._syncTriStateToggleGroups();
        this._syncPromptSourceToggles();
        this._syncSliderControls();
        this._syncResultsVisibility();
        this._syncActiveSearchRestore();
        if (this._hasQuery()) {
            if (this._state.view !== 'search') {
                this._state.resultsActive = true;
            }
            this._syncResultsVisibility();
            if (this._state.view === 'detail') {
                this._restoreSearchFromSessionOrRun(false);
            } else if (this._state.view === 'gallery' || this._state.view === 'usages') {
                this._restoreSearchFromSessionOrRun(false);
            }
        }
        if (this._state.view === 'detail' && this._state.detailFile) {
            const resolvedFile = omegasearchDsapResolveMetadataFilename(this._state.detailFile, this);
            if (resolvedFile) {
                this._state.detailFile = resolvedFile;
                this._loadDetail(resolvedFile);
            }
        }
    },

    refresh(host) {
        this.destroy(host);
        this.init(host);
    },

    destroy(host) {
        const state = this._state;
        if (!state && !host?._omegaDsapWire) return;

        const root = host?.getRoot?.();
        this._unwireEvents(host, root);
        this._teardownClickMenus();
        this._teardownChipMenus();
        if (state && state.host === host) {
            this._state = null;
            this._filtersCollapsed = null;
        }
    },

    _teardownChipMenus() {
        // contextMenu.detachClickMenuFromElement: public/scripts/comp/contextMenu.js
        if (!contextMenu || !this._chipMenuTargets.length) {
            this._chipMenuTargets = [];
            return;
        }
        this._chipMenuTargets.forEach((el) => {
            contextMenu.detachClickMenuFromElement(el);
        });
        this._chipMenuTargets = [];
    },

    _teardownClickMenus() {
        // contextMenu.detachClickMenuFromElement: public/scripts/comp/contextMenu.js
        if (!contextMenu || !this._clickMenuTargets.length) {
            this._clickMenuTargets = [];
            return;
        }
        this._clickMenuTargets.forEach((el) => {
            contextMenu.detachClickMenuFromElement(el);
        });
        this._clickMenuTargets = [];
    },

    _unwireEvents(host, root) {
        const wire = host?._omegaDsapWire;
        if (!wire || !root || wire.root !== root) return;
        root.removeEventListener('click', wire.onClick);
        root.removeEventListener('keydown', wire.onKeydown);
        if (wire.onInput) root.removeEventListener('input', wire.onInput);
        delete host._omegaDsapWire;
    },

    _cacheElements(root) {
        this._els = {
            root,
            searchView: root.querySelector('#omegaSearchView'),
            primaryInput: root.querySelector('#omegaPrimaryInput'),
            searchBtn: root.querySelector('#omegaSearchBtn'),
            chips: root.querySelector('#omegaBlockChips'),
            workspaceBtn: root.querySelector('#omegaWorkspaceBtn'),
            workspaceThisBtn: root.querySelector('#omegaWorkspaceThisBtn'),
            workspaceLabel: root.querySelector('#omegaWorkspaceLabel'),
            corpusSize: root.querySelector('#omegaCorpusSize'),
            viewTypeBtn: root.querySelector('#omegaViewTypeBtn'),
            viewTypeSelected: root.querySelector('#omegaViewTypeSelected'),
            resultsSection: root.querySelector('#omegaResultsSection'),
            statMatches: root.querySelector('#omegaStatMatches'),
            statShowing: root.querySelector('#omegaStatShowing'),
            statUsages: root.querySelector('#omegaStatUsages'),
            statsTable: root.querySelector('#omegaStatsTable'),
            searchProgressBanner: root.querySelector('#omegaSearchProgressBanner'),
            searchProgressText: root.querySelector('#omegaSearchProgressText'),
            activeSearchRestore: root.querySelector('#omegaActiveSearchRestore'),
            returnToSearchBtn: root.querySelector('#omegaReturnToSearchBtn'),
            activeSearchLabel: root.querySelector('#omegaActiveSearchLabel'),
            galleryView: root.querySelector('#omegaGalleryView'),
            usagesView: root.querySelector('#omegaUsagesView'),
            galleryLoading: root.querySelector('#omegaGalleryLoading'),
            galleryEmpty: root.querySelector('#omegaGalleryEmpty'),
            galleryGrid: root.querySelector('#omegaGalleryGrid'),
            galleryPager: root.querySelector('#omegaGalleryPager'),
            galleryPage: root.querySelector('#omegaGalleryPage'),
            galleryTotalPages: root.querySelector('#omegaGalleryTotalPages'),
            usagesLoading: root.querySelector('#omegaUsagesLoading'),
            usagesEmpty: root.querySelector('#omegaUsagesEmpty'),
            usagesBody: root.querySelector('#omegaUsagesBody'),
            detailView: root.querySelector('#omegaDetailView'),
            detailBack: root.querySelector('#omegaDetailBack'),
            detailFilename: root.querySelector('#omegaDetailFilename'),
            detailLoading: root.querySelector('#omegaDetailLoading'),
            detailProgressText: root.querySelector('#omegaDetailProgressText'),
            detailError: root.querySelector('#omegaDetailError'),
            detailErrorText: root.querySelector('#omegaDetailErrorText'),
            detailLayout: root.querySelector('#omegaDetailLayout'),
            detailImage: root.querySelector('#omegaDetailImage'),
            detailImageLoading: root.querySelector('#omegaDetailImageLoading'),
            detailActions: root.querySelector('#omegaDetailActions'),
            detailFavoriteIcon: root.querySelector('#omegaDetailFavoriteIcon'),
            detailFavoriteLabel: root.querySelector('#omegaDetailFavoriteLabel'),
            detailMetaLoading: root.querySelector('#omegaDetailMetaLoading'),
            detailMeta: root.querySelector('#omegaDetailMeta'),
            detailBody: root.querySelector('#omegaDetailBody'),
            detailMainTabs: root.querySelector('#omegaDetailMainTabs'),
            detailPromptToggle: root.querySelector('#omegaDetailPromptToggle'),
            detailExpanderTabs: root.querySelector('#omegaDetailExpanderTabs'),
            advancedFilters: root.querySelector('#omegaAdvancedFilters'),
            advancedFiltersToggle: root.querySelector('#omegaAdvancedFiltersToggle'),
            advancedFiltersBody: root.querySelector('#omegaAdvancedFiltersBody'),
            filtersCollapseBtn: root.querySelector('#omegaFiltersCollapseBtn'),
            filtersCollapseIcon: root.querySelector('#omegaFiltersCollapseIcon'),
            filtersCollapseLabel: root.querySelector('#omegaFiltersCollapseLabel'),
            clearFiltersBtn: root.querySelector('#omegaClearFiltersBtn'),
            promptCompiledBtn: root.querySelector('#omegaPromptCompiledBtn'),
            promptInputBtn: root.querySelector('#omegaPromptInputBtn'),
            defaultMatchBtn: root.querySelector('#omegaDefaultMatchBtn'),
            defaultMatchLabel: root.querySelector('#omegaDefaultMatchLabel'),
            ucAnyBtn: root.querySelector('#omegaUcAnyBtn'),
            ucSlider: root.querySelector('#omegaUcSlider'),
            ucSliderValue: root.querySelector('#omegaUcSliderValue'),
            ucSliderWrap: root.querySelector('#omegaUcSliderWrap'),
            nsfwAnyBtn: root.querySelector('#omegaNsfwAnyBtn'),
            nsfwSlider: root.querySelector('#omegaNsfwSlider'),
            nsfwSliderValue: root.querySelector('#omegaNsfwSliderValue'),
            nsfwSliderWrap: root.querySelector('#omegaNsfwSliderWrap'),
            dateRelativeControls: root.querySelector('#omegaDateRelativeControls'),
            dateExactControls: root.querySelector('#omegaDateExactControls'),
            dateAfterBtn: root.querySelector('#omegaDateAfterBtn'),
            dateAfterLabel: root.querySelector('#omegaDateAfterLabel'),
            dateBeforeBtn: root.querySelector('#omegaDateBeforeBtn'),
            dateBeforeLabel: root.querySelector('#omegaDateBeforeLabel'),
            dateRangeStart: root.querySelector('#omegaDateRangeStart'),
            dateRangeEnd: root.querySelector('#omegaDateRangeEnd'),
            modelsBtn: root.querySelector('#omegaModelsBtn'),
            modelsLabel: root.querySelector('#omegaModelsLabel'),
            samplerBtn: root.querySelector('#omegaSamplerBtn'),
            samplerLabel: root.querySelector('#omegaSamplerLabel'),
            schedulerBtn: root.querySelector('#omegaSchedulerBtn'),
            schedulerLabel: root.querySelector('#omegaSchedulerLabel'),
            resolutionBtn: root.querySelector('#omegaResolutionBtn'),
            resolutionLabel: root.querySelector('#omegaResolutionLabel'),
            stepsMin: root.querySelector('#omegaStepsMin'),
            stepsMax: root.querySelector('#omegaStepsMax'),
            guidanceMin: root.querySelector('#omegaGuidanceMin'),
            guidanceMax: root.querySelector('#omegaGuidanceMax'),
            rescaleMin: root.querySelector('#omegaRescaleMin'),
            rescaleMax: root.querySelector('#omegaRescaleMax'),
            consecutiveSeedsBtn: root.querySelector('#omegaConsecutiveSeedsBtn'),
            consecutiveSeedsLabel: root.querySelector('#omegaConsecutiveSeedsLabel')
        };
    },

    _wireMainTabs(host) {
        const root = this._els?.root;
        if (!root) return;
        const tabBar = root.querySelector('#omegaTabBar');
        if (!tabBar || tabBar.dataset.omegaTabsWired === '1') return;
        tabBar.dataset.omegaTabsWired = '1';
        tabBar.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-omega-tab]');
            if (!tab || !this._state) return;
            const tabId = tab.getAttribute('data-omega-tab');
            if (!tabId || tabId === this._state.view) return;
            e.preventDefault();
            this._switchMainTab(tabId);
        });
    },

    _switchMainTab(tabId) {
        const state = this._state;
        if (!state || !tabId) return;
        state.filters = this._collectFiltersFromInputs();
        state.view = tabId;
        state.detailFile = null;
        state.detailMetadata = null;
        if (tabId === 'gallery' || tabId === 'usages') {
            state.resultsActive = true;
        }
        this._syncViewTabs();
        this._syncResultsVisibility();
        if ((tabId === 'gallery' || tabId === 'usages') && this._hasQuery()) {
            this._restoreSearchFromSessionOrRun(false);
        }
        this._pushUrl();
    },

    _applyHostUrlToState() {
        const host = this._state?.host;
        if (!host) return;
        const blockOptions = omegasearchDsapResolveBlockOptions(host);
        const filters = omegasearchDsapResolveFilters(host);
        const promptSourceFromUrl = filters.promptSource || omegasearchDsapResolvePromptSource(host);
        this._state.blocks = omegasearchDsapResolveBlocks(host);
        this._state.view = omegasearchDsapResolveView(host);
        if (this._state.view === 'gallery' && !this._state.blocks.length) {
            this._state.view = 'search';
        }
        this._state.viewType = omegasearchDsapResolveViewType(host);
        this._state.workspaceId = omegasearchDsapResolveWorkspaceId(host);
        this._state.detailFile = omegasearchDsapResolveDetailFile(host);
        this._state.page = omegasearchDsapResolvePage(host);
        this._state.filters = filters;
        this._state.blockOptions = blockOptions;
        this._state.promptSourceCompiled = promptSourceFromUrl !== 'input';
        this._state.promptSourceInput = promptSourceFromUrl !== 'compiled';
        this._state.promptSource = promptSourceFromUrl;
    },

    _wireClickMenus(root) {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!contextMenu) return;
        this._teardownClickMenus();

        const viewTypeBtn = root.querySelector('#omegaViewTypeBtn');
        const workspaceBtn = root.querySelector('#omegaWorkspaceBtn');

        this._viewTypeClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'end',
            maxHeight: 240,
            beforeShow: () => this._refreshViewTypeClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-view-type' || !item.viewTypeValue) return;
                this._state.viewType = item.viewTypeValue;
                if (this._els.viewTypeSelected) {
                    this._els.viewTypeSelected.textContent = item.text || item.viewTypeValue;
                }
                this._state.page = 1;
                this._updateCorpusEstimate();
            }
        };

        this._workspaceClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: () => this._refreshWorkspaceClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-workspace' || item.workspaceValue == null) return;
                this._state.workspaceId = item.workspaceValue;
                this._updateWorkspaceLabel();
                this._updateCorpusEstimate();
                this._state.page = 1;
            }
        };

        if (viewTypeBtn) {
            contextMenu.attachClickMenuToElement(viewTypeBtn, this._viewTypeClickMenuConfig);
            this._clickMenuTargets.push(viewTypeBtn);
        }
        if (workspaceBtn) {
            contextMenu.attachClickMenuToElement(workspaceBtn, this._workspaceClickMenuConfig);
            this._clickMenuTargets.push(workspaceBtn);
        }

        this._wireAdvancedFilterMenus(root);
    },

    _attachFilterMenu(btn, config) {
        if (!btn || !contextMenu) return;
        contextMenu.attachClickMenuToElement(btn, config);
        this._clickMenuTargets.push(btn);
    },

    _wireAdvancedFilterMenus(root) {
        if (!contextMenu) return;
        const driver = this;

        this._defaultMatchClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 260,
            beforeShow: () => driver._refreshDefaultMatchClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-default-match' || !item.matchModeValue) return;
                driver._state.blockOptions.defaultMatchMode = item.matchModeValue;
                driver._syncFilterLabels();
                driver._onFiltersChanged();
            }
        };

        this._dateAfterClickMenuConfig = driver._buildRelativeDateMenuConfig('dateAfter', 'select-date-after');
        this._dateBeforeClickMenuConfig = driver._buildRelativeDateMenuConfig('dateBefore', 'select-date-before');

        this._modelsClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 420,
            beforeShow: () => driver._refreshModelsClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'toggle-model' || !item.modelValue) return;
                const models = new Set(driver._state.filters.models || []);
                if (models.has(item.modelValue)) models.delete(item.modelValue);
                else models.add(item.modelValue);
                driver._state.filters.models = [...models];
                driver._syncFilterLabels();
                driver._onFiltersChanged();
            }
        };

        this._samplerClickMenuConfig = driver._buildEnumMenuConfig(
            () => [{ value: '', label: 'Any sampler' }, ...omegasearchDsapGetSamplerOptions()],
            () => driver._state.filters.sampler,
            'select-sampler',
            (value) => {
                driver._state.filters.sampler = value || null;
                driver._syncFilterLabels();
                driver._onFiltersChanged();
            },
            'samplerValue'
        );

        this._schedulerClickMenuConfig = driver._buildEnumMenuConfig(
            () => [{ value: '', label: 'Any scheduler' }, ...omegasearchDsapGetSchedulerOptions()],
            () => driver._state.filters.scheduler,
            'select-scheduler',
            (value) => {
                driver._state.filters.scheduler = value || null;
                driver._syncFilterLabels();
                driver._onFiltersChanged();
            },
            'schedulerValue'
        );

        this._resolutionClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 220,
            beforeShow: () => driver._refreshResolutionClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'toggle-resolution' || !item.resolutionValue) return;
                const tiers = new Set(driver._state.filters.resolutionPreset || []);
                if (tiers.has(item.resolutionValue)) tiers.delete(item.resolutionValue);
                else tiers.add(item.resolutionValue);
                driver._state.filters.resolutionPreset = [...tiers];
                driver._syncFilterLabels();
                driver._onFiltersChanged();
            }
        };

        this._attachFilterMenu(root.querySelector('#omegaDefaultMatchBtn'), this._defaultMatchClickMenuConfig);
        this._attachFilterMenu(root.querySelector('#omegaDateAfterBtn'), this._dateAfterClickMenuConfig);
        this._attachFilterMenu(root.querySelector('#omegaDateBeforeBtn'), this._dateBeforeClickMenuConfig);
        this._attachFilterMenu(root.querySelector('#omegaModelsBtn'), this._modelsClickMenuConfig);
        this._attachFilterMenu(root.querySelector('#omegaSamplerBtn'), this._samplerClickMenuConfig);
        this._attachFilterMenu(root.querySelector('#omegaSchedulerBtn'), this._schedulerClickMenuConfig);
        this._attachFilterMenu(root.querySelector('#omegaResolutionBtn'), this._resolutionClickMenuConfig);
    },

    _parseTriStateValue(raw) {
        if (raw === '' || raw == null) return null;
        if (raw === '1' || raw === true) return true;
        if (raw === '0' || raw === false) return false;
        return null;
    },

    _serializeTriStateForToggle(value) {
        if (value === true) return '1';
        if (value === false) return '0';
        return '';
    },

    _syncTriStateToggleGroups() {
        const root = this._els.root;
        if (!root || !this._state) return;
        const filters = this._state.filters || {};
        root.querySelectorAll('[data-ispy-tristate]').forEach((group) => {
            const key = group.dataset.ispyTristate;
            const current = this._serializeTriStateForToggle(filters[key]);
            group.querySelectorAll('.omega-dsap-tristate-btn').forEach((btn) => {
                const btnRaw = btn.getAttribute('data-tristate-value');
                const btnVal = btnRaw == null ? '' : btnRaw;
                const active = btnVal === current;
                btn.classList.toggle('omega-dsap-tristate-active', active);
            });
        });
    },

    _syncPromptSourceToggles() {
        if (!this._state) return;
        const setBtn = (btn, on) => {
            if (!btn) return;
            btn.setAttribute('data-state', on ? 'on' : 'off');
        };
        setBtn(this._els.promptCompiledBtn, this._state.promptSourceCompiled !== false);
        setBtn(this._els.promptInputBtn, this._state.promptSourceInput !== false);
    },

    _resolvePromptSourceForPayload() {
        const compiled = this._state?.promptSourceCompiled !== false;
        const input = this._state?.promptSourceInput !== false;
        if (compiled && input) return null;
        if (compiled) return 'compiled';
        if (input) return 'input';
        return null;
    },

    _syncSliderControls() {
        const filters = this._state?.filters || {};
        const ucActive = filters.ucLevel != null;
        const nsfwActive = filters.nsfwLevel != null;
        if (this._els.ucAnyBtn) {
            this._els.ucAnyBtn.classList.toggle('omega-dsap-tristate-active', !ucActive);
        }
        if (this._els.ucSlider) {
            const val = ucActive ? filters.ucLevel : OMEGASEARCH_UC_SLIDER_MIN;
            this._els.ucSlider.value = String(val);
        }
        if (this._els.ucSliderValue) {
            this._els.ucSliderValue.textContent = ucActive
                ? omegasearchDsapUcLevelLabel(filters.ucLevel)
                : omegasearchDsapUcLevelLabel(OMEGASEARCH_UC_SLIDER_MIN);
        }
        if (this._els.nsfwAnyBtn) {
            this._els.nsfwAnyBtn.classList.toggle('omega-dsap-tristate-active', !nsfwActive);
        }
        if (this._els.nsfwSlider) {
            const val = nsfwActive ? filters.nsfwLevel : 0;
            this._els.nsfwSlider.value = String(val);
        }
        if (this._els.nsfwSliderValue) {
            const nsfwVal = nsfwActive ? filters.nsfwLevel : 0;
            this._els.nsfwSliderValue.textContent = omegasearchDsapNsfwLevelLabel(nsfwVal);
        }
    },

    _syncDateModeVisibility() {
        const mode = this._state?.filters?.dateMode || 'relative';
        const root = this._els.root;
        if (!root) return;
        root.querySelectorAll('.omega-dsap-date-mode-btn').forEach((btn) => {
            btn.classList.toggle('omega-dsap-tristate-active', btn.dataset.dateMode === mode);
        });
        this._els.dateRelativeControls?.classList.toggle('hidden', mode !== 'relative');
        this._els.dateExactControls?.classList.toggle('hidden', mode !== 'exact');
    },

    _setDateMode(mode) {
        if (!this._state) return;
        this._state.filters.dateMode = mode === 'exact' ? 'exact' : 'relative';
        if (this._state.filters.dateMode === 'exact') {
            this._state.filters.dateBefore = null;
            this._state.filters.dateAfter = null;
        } else {
            this._state.filters.dateRange = null;
            if (this._els.dateRangeStart) this._els.dateRangeStart.value = '';
            if (this._els.dateRangeEnd) this._els.dateRangeEnd.value = '';
        }
        this._syncDateModeVisibility();
        this._syncFilterLabels();
        this._syncClearButtons();
        this._onFiltersChanged();
    },

    _setTriStateFilter(filterKey, rawValue) {
        if (!this._state) return;
        this._state.filters[filterKey] = this._parseTriStateValue(rawValue);
        this._syncTriStateToggleGroups();
        this._syncFilterLabels();
        this._onFiltersChanged();
    },

    _selectThisWorkspace() {
        const wsId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : null;
        if (!wsId) return;
        this._state.workspaceId = wsId;
        this._updateWorkspaceLabel();
        this._updateCorpusEstimate();
        this._state.page = 1;
    },

    _buildEnumMenuConfig(getOptions, getCurrent, actionName, onSelect, valueKey) {
        const driver = this;
        const config = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: () => {
                const current = getCurrent();
                config.sections[0].items = getOptions().map((opt) => ({
                    text: opt.label,
                    action: actionName,
                    [valueKey]: opt.value,
                    loadfn: (item) => {
                        omegasearchDsapApplyMenuItemHighlight(
                            item,
                            omegasearchDsapEnumSelectionHighlighted(item[valueKey], current)
                        );
                    }
                }));
            },
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== actionName) return;
                onSelect(omegasearchDsapIsFilterValueUnset(item[valueKey]) ? null : item[valueKey]);
            }
        };
        return config;
    },

    _buildRelativeDateMenuConfig(filterKey, actionName) {
        const driver = this;
        const config = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 320,
            beforeShow: () => {
                const boundary = driver._state.filters[filterKey];
                const current = boundary?.relative || '';
                const items = [
                    {
                        text: 'Any',
                        action: actionName,
                        relativeValue: '',
                        loadfn: (item) => {
                            omegasearchDsapApplyMenuItemHighlight(
                                item,
                                omegasearchDsapIsDateBoundaryUnset(boundary)
                            );
                        }
                    }
                ];
                OMEGASEARCH_RELATIVE_DATE_PRESETS.forEach((preset) => {
                    items.push({
                        text: preset.label,
                        action: actionName,
                        relativeValue: preset.value,
                        loadfn: (item) => {
                            omegasearchDsapApplyMenuItemHighlight(
                                item,
                                !omegasearchDsapIsDateBoundaryUnset(boundary)
                                    && item.relativeValue === current
                            );
                        }
                    });
                });
                config.sections[0].items = items;
            },
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== actionName) return;
                if (omegasearchDsapIsFilterValueUnset(item.relativeValue)) {
                    driver._state.filters[filterKey] = null;
                } else {
                    driver._state.filters[filterKey] = { relative: item.relativeValue };
                }
                driver._syncFilterLabels();
                driver._syncClearButtons();
                driver._onFiltersChanged();
            }
        };
        return config;
    },

    _refreshDefaultMatchClickMenuItems() {
        if (!this._defaultMatchClickMenuConfig) return;
        const current = this._state?.blockOptions?.defaultMatchMode || 'substring';
        this._defaultMatchClickMenuConfig.sections[0].items = OMEGASEARCH_MATCH_MODES.map((entry) => ({
            text: entry.label,
            action: 'select-default-match',
            matchModeValue: entry.value,
            loadfn: (item) => { item.highlighted = item.matchModeValue === current; }
        }));
    },

    _refreshModelsClickMenuItems() {
        if (!this._modelsClickMenuConfig) return;
        const selected = new Set(this._state?.filters?.models || []);
        const items = [];
        let lastGroup = null;
        omegasearchDsapGetModelOptions().forEach((opt) => {
            if (opt.group && opt.group !== lastGroup) {
                items.push({ separator: true, text: opt.group });
                lastGroup = opt.group;
            }
            items.push({
                text: opt.label,
                action: 'toggle-model',
                modelValue: opt.value,
                keepMenuOpen: true,
                showIndicator: true,
                loadfn: (item) => { item.checked = selected.has(item.modelValue); }
            });
        });
        if (!items.length) items.push({ text: 'No models available', disabled: true });
        this._modelsClickMenuConfig.sections[0].items = items;
    },

    _refreshResolutionClickMenuItems() {
        if (!this._resolutionClickMenuConfig) return;
        const selected = new Set(this._state?.filters?.resolutionPreset || []);
        this._resolutionClickMenuConfig.sections[0].items = OMEGASEARCH_RESOLUTION_TIERS.map((entry) => ({
            text: entry.label,
            action: 'toggle-resolution',
            resolutionValue: entry.value,
            keepMenuOpen: true,
            showIndicator: true,
            loadfn: (item) => { item.checked = selected.has(item.resolutionValue); }
        }));
    },

    _wireChipMatchMenus() {
        this._teardownChipMenus();
        if (!contextMenu) return;
        const chips = this._els.chips?.querySelectorAll('.omega-dsap-chip-menu-target');
        if (!chips || !chips.length) return;

        this._chipMatchClickMenuConfig = this._chipMatchClickMenuConfig || {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 260,
            beforeShow: (event, target) => {
                const index = Number(target?.dataset?.omegaChipIndex);
                this._state.chipMenuIndex = Number.isFinite(index) ? index : null;
                this._refreshChipMatchClickMenuItems();
            },
            sections: [
                { type: 'list', key: 'matchModes', items: [] },
                {
                    type: 'list',
                    key: 'actions',
                    items: [
                        {
                            text: 'Remove block',
                            icon: 'fas fa-times',
                            action: 'remove-chip',
                            className: 'context-menu-item-danger'
                        }
                    ]
                }
            ],
            onAction: (action, target, item) => {
                if (action === 'remove-chip') {
                    const index = Number(target?.dataset?.omegaChipIndex);
                    if (!Number.isFinite(index)) return;
                    this._removeBlockAtIndex(index);
                    return;
                }
                if (action !== 'select-chip-match' || item.matchModeValue == null) return;
                const index = Number(target?.dataset?.omegaChipIndex);
                if (!Number.isFinite(index) || !this._state.blocks[index]) return;
                this._state.blocks[index].matchMode = item.matchModeValue;
                this._renderBlockChips();
            }
        };

        chips.forEach((chip) => {
            contextMenu.attachClickMenuToElement(chip, this._chipMatchClickMenuConfig);
            this._chipMenuTargets.push(chip);
        });
    },

    _refreshChipMatchClickMenuItems() {
        if (!this._chipMatchClickMenuConfig) return;
        const index = this._state?.chipMenuIndex;
        const current = (index != null && this._state.blocks[index])
            ? (this._state.blocks[index].matchMode || 'substring')
            : 'substring';
        this._chipMatchClickMenuConfig.sections[0].items = OMEGASEARCH_MATCH_MODES.map((entry) => ({
            text: entry.label,
            action: 'select-chip-match',
            matchModeValue: entry.value,
            loadfn: (item) => { item.highlighted = item.matchModeValue === current; }
        }));
    },

    _syncFilterControlsFromState() {
        const filters = this._state.filters || omegasearchDsapDefaultFilters();
        if (this._els.dateRangeStart) {
            this._els.dateRangeStart.value = filters.dateRange?.start
                ? String(filters.dateRange.start).slice(0, 10)
                : '';
        }
        if (this._els.dateRangeEnd) {
            this._els.dateRangeEnd.value = filters.dateRange?.end
                ? String(filters.dateRange.end).slice(0, 10)
                : '';
        }
        if (this._els.stepsMin) this._els.stepsMin.value = filters.stepsMin != null ? String(filters.stepsMin) : '';
        if (this._els.stepsMax) this._els.stepsMax.value = filters.stepsMax != null ? String(filters.stepsMax) : '';
        if (this._els.guidanceMin) this._els.guidanceMin.value = filters.guidanceMin != null ? String(filters.guidanceMin) : '';
        if (this._els.guidanceMax) this._els.guidanceMax.value = filters.guidanceMax != null ? String(filters.guidanceMax) : '';
        if (this._els.rescaleMin) this._els.rescaleMin.value = filters.rescaleMin != null ? String(filters.rescaleMin) : '';
        if (this._els.rescaleMax) this._els.rescaleMax.value = filters.rescaleMax != null ? String(filters.rescaleMax) : '';
        this._syncTriStateToggleGroups();
        this._syncPromptSourceToggles();
        this._syncSliderControls();
        this._syncDateModeVisibility();
        this._syncFilterLabels();
        this._syncClearButtons();
    },

    _syncClearButtons() {
        const root = this._els.root;
        if (!root || !this._state) return;
        const filters = this._state.filters || {};
        const inputHasValue = (el) => !!(el && String(el.value || '').trim());
        root.querySelectorAll('[data-ispy-clear-filter]').forEach((btn) => {
            const key = btn.dataset.ispyClearFilter;
            let hasValue = false;
            switch (key) {
                case 'dateAfter':
                    hasValue = !!(filters.dateAfter && filters.dateAfter.relative);
                    break;
                case 'dateBefore':
                    hasValue = !!(filters.dateBefore && filters.dateBefore.relative);
                    break;
                case 'dateRangeStart':
                    hasValue = inputHasValue(this._els.dateRangeStart);
                    break;
                case 'dateRangeEnd':
                    hasValue = inputHasValue(this._els.dateRangeEnd);
                    break;
                case 'stepsMin':
                    hasValue = filters.stepsMin != null || inputHasValue(this._els.stepsMin);
                    break;
                case 'stepsMax':
                    hasValue = filters.stepsMax != null || inputHasValue(this._els.stepsMax);
                    break;
                case 'guidanceMin':
                    hasValue = filters.guidanceMin != null || inputHasValue(this._els.guidanceMin);
                    break;
                case 'guidanceMax':
                    hasValue = filters.guidanceMax != null || inputHasValue(this._els.guidanceMax);
                    break;
                case 'rescaleMin':
                    hasValue = filters.rescaleMin != null || inputHasValue(this._els.rescaleMin);
                    break;
                case 'rescaleMax':
                    hasValue = filters.rescaleMax != null || inputHasValue(this._els.rescaleMax);
                    break;
                default:
                    break;
            }
            btn.classList.toggle('hidden', !hasValue);
        });
    },

    _clearFilterField(key) {
        if (!this._state || !key) return;
        const filters = this._state.filters;
        switch (key) {
            case 'dateAfter':
                filters.dateAfter = null;
                break;
            case 'dateBefore':
                filters.dateBefore = null;
                break;
            case 'dateRangeStart':
                if (this._els.dateRangeStart) this._els.dateRangeStart.value = '';
                break;
            case 'dateRangeEnd':
                if (this._els.dateRangeEnd) this._els.dateRangeEnd.value = '';
                break;
            case 'stepsMin':
                filters.stepsMin = null;
                if (this._els.stepsMin) this._els.stepsMin.value = '';
                break;
            case 'stepsMax':
                filters.stepsMax = null;
                if (this._els.stepsMax) this._els.stepsMax.value = '';
                break;
            case 'guidanceMin':
                filters.guidanceMin = null;
                if (this._els.guidanceMin) this._els.guidanceMin.value = '';
                break;
            case 'guidanceMax':
                filters.guidanceMax = null;
                if (this._els.guidanceMax) this._els.guidanceMax.value = '';
                break;
            case 'rescaleMin':
                filters.rescaleMin = null;
                if (this._els.rescaleMin) this._els.rescaleMin.value = '';
                break;
            case 'rescaleMax':
                filters.rescaleMax = null;
                if (this._els.rescaleMax) this._els.rescaleMax.value = '';
                break;
            default:
                return;
        }
        this._syncFilterLabels();
        this._syncClearButtons();
        this._onFiltersChanged();
    },

    _syncFilterLabels() {
        const filters = this._state?.filters || {};
        const blockOptions = this._state?.blockOptions || omegasearchDsapDefaultBlockOptions();
        if (this._els.defaultMatchLabel) {
            this._els.defaultMatchLabel.textContent = omegasearchDsapMatchModeLabel(blockOptions.defaultMatchMode);
        }
        if (this._els.dateAfterLabel) {
            const rel = filters.dateAfter?.relative;
            this._els.dateAfterLabel.textContent = rel ? `After: ${rel}` : 'After: Any';
        }
        if (this._els.dateBeforeLabel) {
            const rel = filters.dateBefore?.relative;
            this._els.dateBeforeLabel.textContent = rel ? `Before: ${rel}` : 'Before: Any';
        }
        if (this._els.modelsLabel) {
            const count = (filters.models || []).length;
            this._els.modelsLabel.textContent = count ? `${count} model${count === 1 ? '' : 's'}` : 'All models';
        }
        if (this._els.samplerLabel) {
            const sampler = filters.sampler;
            if (!sampler) this._els.samplerLabel.textContent = 'Any sampler';
            else {
                const match = omegasearchDsapGetSamplerOptions().find((e) => e.value === sampler);
                this._els.samplerLabel.textContent = match ? match.label : sampler;
            }
        }
        if (this._els.schedulerLabel) {
            const scheduler = filters.scheduler;
            if (!scheduler) this._els.schedulerLabel.textContent = 'Any scheduler';
            else {
                const match = omegasearchDsapGetSchedulerOptions().find((e) => e.value === scheduler);
                this._els.schedulerLabel.textContent = match ? match.label : scheduler;
            }
        }
        if (this._els.resolutionLabel) {
            const tiers = filters.resolutionPreset || [];
            this._els.resolutionLabel.textContent = tiers.length
                ? tiers.map((t) => OMEGASEARCH_RESOLUTION_TIERS.find((e) => e.value === t)?.label || t).join(', ')
                : 'All resolutions';
        }
        if (this._els.consecutiveSeedsBtn) {
            const on = !!filters.consecutiveSeeds;
            this._els.consecutiveSeedsBtn.setAttribute('data-state', on ? 'on' : 'off');
            this._els.consecutiveSeedsBtn.innerHTML = on
                ? '<i class="fas fa-toggle-on"></i> <span id="omegaConsecutiveSeedsLabel">On</span>'
                : '<i class="fas fa-toggle-off"></i> <span id="omegaConsecutiveSeedsLabel">Off</span>';
            this._els.consecutiveSeedsLabel = this._els.root?.querySelector('#omegaConsecutiveSeedsLabel');
        }

        const promptFiltered = !(this._state?.promptSourceCompiled !== false && this._state?.promptSourceInput !== false);
        const active = omegasearchDsapHasActiveFilters(filters)
            || promptFiltered
            || (blockOptions.defaultMatchMode && blockOptions.defaultMatchMode !== 'substring');
        this._els.root?.classList.toggle('omega-dsap-filters-active', active);
        const markActive = (btn, isOn) => {
            if (!btn) return;
            btn.classList.toggle('omega-dsap-filter-active', !!isOn);
            btn.setAttribute('data-state', isOn ? 'on' : 'off');
        };
        markActive(this._els.defaultMatchBtn, blockOptions.defaultMatchMode && blockOptions.defaultMatchMode !== 'substring');
        markActive(this._els.dateAfterBtn, !!(filters.dateAfter && filters.dateAfter.relative));
        markActive(this._els.dateBeforeBtn, !!(filters.dateBefore && filters.dateBefore.relative));
        markActive(this._els.modelsBtn, (filters.models || []).length > 0);
        markActive(this._els.samplerBtn, !!filters.sampler);
        markActive(this._els.schedulerBtn, !!filters.scheduler);
        markActive(this._els.resolutionBtn, (filters.resolutionPreset || []).length > 0);
    },

    _collectFiltersFromInputs() {
        if (!this._state) return omegasearchDsapDefaultFilters();
        const filters = { ...(this._state.filters || omegasearchDsapDefaultFilters()) };
        const mode = filters.dateMode || 'relative';
        if (mode === 'exact') {
            const startVal = (this._els.dateRangeStart?.value || '').trim();
            const endVal = (this._els.dateRangeEnd?.value || '').trim();
            if (startVal || endVal) {
                filters.dateRange = {
                    start: startVal || undefined,
                    end: endVal || undefined
                };
            } else {
                filters.dateRange = null;
            }
            filters.dateBefore = null;
            filters.dateAfter = null;
        } else {
            filters.dateRange = null;
        }
        filters.stepsMin = omegasearchDsapParseOptionalInt(this._els.stepsMin?.value);
        filters.stepsMax = omegasearchDsapParseOptionalInt(this._els.stepsMax?.value);
        filters.guidanceMin = omegasearchDsapParseOptionalFloat(this._els.guidanceMin?.value);
        filters.guidanceMax = omegasearchDsapParseOptionalFloat(this._els.guidanceMax?.value);
        filters.rescaleMin = omegasearchDsapParseOptionalFloat(this._els.rescaleMin?.value);
        filters.rescaleMax = omegasearchDsapParseOptionalFloat(this._els.rescaleMax?.value);
        const promptSource = this._resolvePromptSourceForPayload();
        filters.promptSource = promptSource;
        this._state.promptSource = promptSource;
        return filters;
    },

    _clearAllFilters() {
        this._state.filters = omegasearchDsapDefaultFilters();
        this._state.promptSourceCompiled = true;
        this._state.promptSourceInput = true;
        this._state.promptSource = null;
        this._state.blockOptions = omegasearchDsapDefaultBlockOptions();
        this._syncFilterControlsFromState();
        this._onFiltersChanged();
    },

    _onFiltersChanged() {
        this._state.filters = this._collectFiltersFromInputs();
        this._syncFilterLabels();
        this._syncClearButtons();
    },

    _refreshViewTypeClickMenuItems() {
        if (!this._viewTypeClickMenuConfig) return;
        const current = this._state?.viewType || 'images';
        this._viewTypeClickMenuConfig.sections[0].items = OMEGASEARCH_VIEW_TYPES.map((entry) => ({
            text: entry.label,
            action: 'select-view-type',
            viewTypeValue: entry.value,
            loadfn: (item) => {
                item.highlighted = item.viewTypeValue === current;
            }
        }));
    },

    _refreshWorkspaceClickMenuItems() {
        if (!this._workspaceClickMenuConfig) return;
        const current = this._state?.workspaceId || OMEGASEARCH_GLOBAL_WORKSPACE;
        const items = [{
            text: 'Global',
            action: 'select-workspace',
            workspaceValue: OMEGASEARCH_GLOBAL_WORKSPACE,
            loadfn: (item) => {
                item.highlighted = current === OMEGASEARCH_GLOBAL_WORKSPACE;
            }
        }];
        omegasearchDsapGetWorkspaceList().forEach((ws) => {
            items.push({
                text: ws.name || ws.id,
                action: 'select-workspace',
                workspaceValue: ws.id,
                loadfn: (item) => {
                    item.highlighted = item.workspaceValue === current;
                }
            });
        });
        this._workspaceClickMenuConfig.sections[0].items = items;
    },

    _wireEvents(root) {
        const state = this._state;
        const host = state.host;
        this._unwireEvents(host, root);

        const onClick = (e) => {
            if (this._state?.host !== host) return;
            this._onClick(e);
        };
        const onKeydown = (e) => {
            if (this._state?.host !== host) return;
            this._onKeydown(e);
        };
        const onInput = (e) => {
            if (this._state?.host !== host) return;
            const id = e.target?.id;
            if (id === 'omegaDateRangeStart' || id === 'omegaDateRangeEnd'
                || id === 'omegaStepsMin' || id === 'omegaStepsMax'
                || id === 'omegaGuidanceMin' || id === 'omegaGuidanceMax'
                || id === 'omegaRescaleMin' || id === 'omegaRescaleMax') {
                this._onFiltersChanged();
            }
            if (id === 'omegaUcSlider') {
                const val = omegasearchDsapParseOptionalInt(e.target.value);
                this._state.filters.ucLevel = val;
                if (this._els.ucSliderValue) {
                    this._els.ucSliderValue.textContent = omegasearchDsapUcLevelLabel(val);
                }
                this._syncSliderControls();
                this._onFiltersChanged();
            }
            if (id === 'omegaNsfwSlider') {
                const val = omegasearchDsapParseOptionalInt(e.target.value);
                this._state.filters.nsfwLevel = val;
                if (this._els.nsfwSliderValue) {
                    this._els.nsfwSliderValue.textContent = omegasearchDsapNsfwLevelLabel(val);
                }
                this._syncSliderControls();
                this._onFiltersChanged();
            }
        };

        host._omegaDsapWire = { root, onClick, onKeydown, onInput };
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeydown);
        root.addEventListener('input', onInput);
    },

    _hasQuery() {
        return (this._state?.blocks || []).length > 0;
    },

    _syncActiveSearchRestore() {
        const restoreEl = this._els.activeSearchRestore;
        if (!restoreEl || !this._state) return;
        const saved = omegasearchDsapLastActiveSearch;
        const session = saved?.queryKey ? this._findSessionByQueryKey(saved.queryKey) : null;
        const hasCachedResults = session && (session.total > 0 || Object.keys(session.pages || {}).length > 0);
        const onSearchTab = this._state.view === 'search';
        const queryDrift = saved?.queryKey && saved.queryKey !== this._buildSearchCacheKey();
        const showRestore = saved && hasCachedResults && (onSearchTab || queryDrift || !this._hasQuery());
        restoreEl.classList.toggle('hidden', !showRestore);
        if (this._els.activeSearchLabel && saved?.label) {
            this._els.activeSearchLabel.textContent = saved.label;
        }
    },

    _restoreActiveSearch() {
        if (!this._state) return;
        const saved = omegasearchDsapLastActiveSearch;
        if (!saved) return;

        if (saved.queryKey && saved.queryKey === this._buildSearchCacheKey()) {
            this._state.view = 'gallery';
            this._state.resultsActive = true;
            this._syncViewTabs();
            this._syncResultsVisibility();
            const session = this._findSessionByQueryKey(saved.queryKey);
            if (session) {
                this._state.searchSessionId = session.id;
                this._state.serverSearchSessionId = session.serverSessionId || null;
                this._state.page = this._resolveInitialPage(session);
            }
            if (!this._applySessionPage(session)) {
                this._restoreSearchFromSessionOrRun(false);
            }
            this._pushUrl();
            return;
        }

        if (!saved.url || !this._state.host) return;
        const host = this._state.host;
        if (host.setUrl && host.setUrl(saved.url)) {
            this._applyHostUrlToState();
            this._syncInputsFromState();
            this._syncFilterControlsFromState();
            this._renderBlockChips();
            this._state.resultsActive = true;
            this._syncViewTabs();
            this._syncResultsVisibility();
            this._restoreSearchFromSessionOrRun(false);
            return;
        }
        host.navigate(saved.url);
    },

    _saveActiveSearchSnapshot() {
        const state = this._state;
        if (!state || !(state.blocks || []).length) return;
        const blocks = state.blocks || [];
        const label = blocks.map((b) => omegasearchDsapFormatBlockLabel(b)).join(' · ');
        omegasearchDsapLastActiveSearch = {
            url: omegasearchDsapBuildUrl({
                blocks: state.blocks,
                view: state.view === 'search' ? 'gallery' : state.view,
                viewType: state.viewType,
                workspaceId: state.workspaceId,
                file: state.view === 'detail' ? state.detailFile : null,
                page: state.page,
                filters: this._collectFiltersFromInputs(),
                promptSource: this._resolvePromptSourceForPayload(),
                blockOptions: state.blockOptions
            }),
            queryKey: this._buildSearchCacheKey(),
            label: label || 'Active search'
        };
        omegasearchDsapPersistSessionsToStorage();
        this._syncActiveSearchRestore();
    },
    _syncResultsVisibility() {
        const view = this._state?.view;
        const hasQuery = this._hasQuery();
        const isDetail = view === 'detail';
        const onLanding = view === 'search' && !hasQuery && !isDetail;
        if (onLanding) {
            this._filtersCollapsed = null;
        }
        this._els.root?.classList.toggle('omega-dsap-landing', onLanding);
        this._els.searchView?.classList.toggle('hidden', view !== 'search' || isDetail);
        const showResults = view === 'gallery' || view === 'usages' || isDetail;
        this._els.resultsSection?.classList.toggle('hidden', !showResults);
        const hasResultStats = (this._state?.total || 0) > 0;
        this._els.statsTable?.classList.toggle('hidden', !hasResultStats);
        this._syncFiltersCollapseState();
        this._syncActiveSearchRestore();
    },

    _isFiltersEffectivelyCollapsed() {
        if (!this._state) return false;
        const onLanding = this._state.view === 'search' && !this._hasQuery();
        const onResults = (this._state.view === 'gallery' || this._state.view === 'usages') && this._hasQuery();
        if (onLanding) return false;
        if (onResults) return this._filtersCollapsed !== false;
        return this._filtersCollapsed === true;
    },

    _toggleFiltersCollapsed() {
        this._filtersCollapsed = !this._isFiltersEffectivelyCollapsed();
        this._syncFiltersCollapseState();
    },

    _syncFiltersCollapseState() {
        if (!this._els.advancedFilters || !this._state) return;
        const collapsed = this._isFiltersEffectivelyCollapsed();
        this._els.advancedFilters.classList.toggle('omega-dsap-filters-collapsed', collapsed);
        if (this._els.filtersCollapseIcon) {
            this._els.filtersCollapseIcon.className = collapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        }
        if (this._els.filtersCollapseLabel) {
            this._els.filtersCollapseLabel.textContent = collapsed ? 'Show filters' : 'Hide filters';
        }
        if (this._els.filtersCollapseBtn) {
            this._els.filtersCollapseBtn.title = collapsed ? 'Show metadata filters' : 'Hide metadata filters';
        }
    },

    _createSearchSessionId() {
        return `ispy-${omegasearchDsapNextSessionSerial++}-${Date.now().toString(36)}`;
    },

    _createSearchSession(queryKey) {
        const id = this._createSearchSessionId();
        const session = {
            id,
            queryKey,
            total: 0,
            usages: [],
            pages: {},
            corpusSize: null,
            lastPage: 1,
            pageSize: OMEGASEARCH_DEFAULT_LIMIT,
            serverSessionId: null
        };
        omegasearchDsapSearchSessions.set(id, session);
        omegasearchDsapPersistSessionsToStorage();
        return id;
    },

    _findSessionByQueryKey(queryKey) {
        if (!queryKey) return null;
        for (const session of omegasearchDsapSearchSessions.values()) {
            if (session.queryKey === queryKey) return session;
        }
        return null;
    },

    _getActiveSession() {
        const id = this._state?.searchSessionId;
        return id ? omegasearchDsapSearchSessions.get(id) || null : null;
    },

    _isStaleSearchResponse(generation, requestQueryKey, requestSessionId, requestPage) {
        if (!this._state) return true;
        if (generation !== omegasearchDsapNextSearchGeneration) return true;
        if (requestQueryKey !== this._buildSearchCacheKey()) return true;
        if (requestSessionId !== this._state.searchSessionId) return true;
        if (requestPage !== this._state.page) return true;
        return false;
    },

    _recoverResultsAfterStaleSearch() {
        const session = this._getActiveSession();
        if (!session || !this._applySessionPage(session)) return false;
        this._syncResultsVisibility();
        this._syncActiveSearchRestore();
        return true;
    },

    _ensureSearchSession(force) {
        const queryKey = this._buildSearchCacheKey();
        let session = this._getActiveSession();

        if (force) {
            this._state.serverSearchSessionId = null;
            if (session?.queryKey === queryKey) {
                session.pages = {};
                session.serverSessionId = null;
            } else {
                const existing = this._findSessionByQueryKey(queryKey);
                if (existing) {
                    this._state.searchSessionId = existing.id;
                    existing.pages = {};
                    existing.serverSessionId = null;
                    session = existing;
                } else {
                    this._state.searchSessionId = this._createSearchSession(queryKey);
                    session = this._getActiveSession();
                }
            }
            omegasearchDsapPersistSessionsToStorage();
        } else if (!session || session.queryKey !== queryKey) {
            const existing = this._findSessionByQueryKey(queryKey);
            if (existing) {
                this._state.searchSessionId = existing.id;
                this._state.serverSearchSessionId = existing.serverSessionId || null;
                session = existing;
            } else {
                this._state.searchSessionId = this._createSearchSession(queryKey);
                this._state.serverSearchSessionId = null;
                session = this._getActiveSession();
            }
        } else if (session.serverSessionId) {
            this._state.serverSearchSessionId = session.serverSessionId;
        }
        return session;
    },

    _removeBlockAtIndex(index) {
        if (!this._state) return;
        const blocks = [...(this._state.blocks || [])];
        if (index < 0 || index >= blocks.length) return;
        blocks.splice(index, 1);
        this._state.blocks = blocks;
        this._state.serverSearchSessionId = null;
        this._state.searchSessionId = null;
        this._syncInputsFromState();
        this._renderBlockChips();
        this._syncResultsVisibility();
        this._state.page = 1;
        if (this._hasQuery()) {
            this._state.view = 'gallery';
            this._state.resultsActive = true;
            this._syncViewTabs();
            this._pushUrl();
            this._runSearch(true);
        } else {
            this._state.view = 'search';
            this._state.resultsActive = false;
            this._state.results = [];
            this._state.total = 0;
            this._syncViewTabs();
            this._syncResultsVisibility();
            this._pushUrl();
        }
    },

    _applySessionPage(session) {
        const state = this._state;
        if (!state || !session) return false;
        const pageResults = session.pages[state.page];
        if (!pageResults) return false;
        state.results = pageResults;
        state.total = session.total;
        state.usages = session.usages;
        session.lastPage = state.page;
        if (session.corpusSize != null && this._els.corpusSize) {
            this._els.corpusSize.textContent = String(session.corpusSize);
        }
        this._renderResults();
        this._renderUsages();
        this._updateStats(session.total);
        this._setLoading(false);
        return true;
    },

    _resolveInitialPage(session) {
        const pageParam = this._state?.host?.getQueryParam?.('page');
        if (pageParam) {
            const parsed = parseInt(String(pageParam), 10);
            if (Number.isFinite(parsed) && parsed >= 1) return parsed;
        }
        return session?.lastPage || this._state?.page || 1;
    },

    _restoreSearchFromSessionOrRun(force) {
        const state = this._state;
        if (!state || !this._hasQuery()) return;

        const existingSession = this._findSessionByQueryKey(this._buildSearchCacheKey());
        if (existingSession) {
            state.searchSessionId = existingSession.id;
            state.serverSearchSessionId = existingSession.serverSessionId || null;
            state.page = this._resolveInitialPage(existingSession);
            if (!force && this._applySessionPage(existingSession)) {
                this._syncResultsVisibility();
                this._syncActiveSearchRestore();
                return;
            }
        }

        if (state.view === 'search' && !force) {
            this._syncActiveSearchRestore();
            return;
        }

        this._runSearch(force);
    },

    _syncInputsFromState() {
        if (this._els.primaryInput) {
            this._els.primaryInput.value = '';
        }
        const match = OMEGASEARCH_VIEW_TYPES.find((entry) => entry.value === this._state.viewType);
        if (this._els.viewTypeSelected && match) {
            this._els.viewTypeSelected.textContent = match.label;
        }
    },

    _collectBlocksFromInputs() {
        return omegasearchDsapNormalizeBlocks(this._state?.blocks || [], {
            defaultMatchMode: this._state?.blockOptions?.defaultMatchMode || 'substring'
        });
    },

    _renderBlockChips() {
        const el = this._els.chips;
        if (!el || !this._state) return;
        const blocks = this._state.blocks || [];
        el.innerHTML = '';
        blocks.forEach((block, index) => {
            const chip = document.createElement('span');
            const isOr = block.mode === 'or' && (block.terms || []).length > 1;
            chip.className = 'omega-dsap-chip omega-dsap-chip-menu-target' + (isOr ? ' omega-dsap-chip-or' : '');
            chip.dataset.omegaChipIndex = String(index);
            chip.title = 'Click for match mode or remove';
            chip.innerHTML = `
                <span>${omegasearchDsapEscapeHtml(omegasearchDsapFormatBlockLabel(block))}</span>
                <button type="button" class="omega-dsap-chip-remove" data-omega-chip-remove="${index}" title="Remove filter"><i class="fas fa-times"></i></button>
            `;
            el.appendChild(chip);
        });
        setTimeout(() => this._wireChipMatchMenus(), 0);
    },

    _syncViewTabs() {
        const view = this._state.view;
        const isDetail = view === 'detail';
        const activeTab = isDetail ? 'gallery' : (view === 'usages' ? 'usages' : view === 'search' ? 'search' : 'gallery');
        // dsapSmfSetActiveTab: public/scripts/comp/dsapSmfMarkup.js
        if (this._els.root) {
            dsapSmfSetActiveTab(this._els.root, 'data-omega-tab', activeTab);
            // dsapSmfUpdateHeaderTool: public/scripts/comp/dsapSmfMarkup.js
            dsapSmfUpdateHeaderTool(this._els.root, OMEGASEARCH_DSAP_TAB_LABELS[activeTab] || 'Search');
        }
        this._els.root?.classList.toggle('omega-dsap-detail-mode', isDetail);
        this._els.galleryView?.classList.toggle('hidden', view !== 'gallery');
        this._els.usagesView?.classList.toggle('hidden', view !== 'usages');
        this._els.detailView?.classList.toggle('hidden', !isDetail);
    },

    _updateWorkspaceLabel() {
        if (this._els.workspaceLabel) {
            this._els.workspaceLabel.textContent = omegasearchDsapWorkspaceLabel(this._state.workspaceId);
        }
    },

    _updateCorpusEstimate() {
        if (!this._els.corpusSize) return;
        const estimate = omegasearchDsapEstimateCorpusSize(this._state.workspaceId, this._state.viewType);
        this._els.corpusSize.textContent = String(estimate);
    },

    _pushUrl(options = {}) {
        const host = this._state.host;
        this._state.filters = this._collectFiltersFromInputs();
        const nextUrl = omegasearchDsapBuildUrl({
            blocks: this._state.blocks,
            view: this._state.view,
            viewType: this._state.viewType,
            workspaceId: this._state.workspaceId,
            file: this._state.view === 'detail' ? this._state.detailFile : null,
            page: this._state.page,
            filters: this._collectFiltersFromInputs(),
            promptSource: this._resolvePromptSourceForPayload(),
            blockOptions: this._state.blockOptions
        });
        const currentUrl = host.shell?._dsapState?.url || host.url;
        if (currentUrl === nextUrl) return false;
        if (host.setUrl && host.setUrl(nextUrl, { skipHistory: !!options.skipHistory })) {
            return true;
        }
        host.navigate(nextUrl);
        return true;
    },

    _onKeydown(e) {
        if (!this._state) return;
        if (e.key !== 'Enter') return;
        const target = e.target;
        if (target?.id === 'omegaPrimaryInput') {
            e.preventDefault();
            this._handlePrimaryEnter();
        }
    },

    _handlePrimaryEnter() {
        const text = (this._els.primaryInput?.value || '').trim();
        if (text) {
            this._addBlockFromText(text);
            return;
        }
        this._executeSearch();
    },

    _addBlockFromText(text, options = {}) {
        const filterBlock = omegasearchDsapParseBlockInput(text);
        if (!filterBlock) return false;
        filterBlock.matchMode = this._state.blockOptions?.defaultMatchMode || 'substring';
        const blocks = [...(this._state.blocks || []), filterBlock];
        this._state.blocks = omegasearchDsapNormalizeBlocks(blocks, {
            defaultMatchMode: this._state.blockOptions?.defaultMatchMode || 'substring'
        });
        if (this._els.primaryInput) this._els.primaryInput.value = '';
        if (!options.keepResultsActive) {
            this._state.resultsActive = false;
        }
        this._renderBlockChips();
        this._syncResultsVisibility();
        if (!options.skipPush) {
            this._pushUrl();
        }
        return true;
    },

    _executeSearch() {
        if (!this._state) return;
        if (!this._hasQuery()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', 'I Spy', 'Add a tag or phrase, then click Search', false, 3500, '<i class="fas fa-info-circle"></i>');
            }
            return;
        }
        this._state.page = 1;
        this._filtersCollapsed = null;
        this._state.view = 'gallery';
        this._state.resultsActive = true;
        this._syncViewTabs();
        this._syncResultsVisibility();
        this._pushUrl();
        this._runSearch(true);
        this._saveActiveSearchSnapshot();
    },

    _onClick(e) {
        if (!this._state) return;
        const toggleHdr = e.target.closest('#omegaAdvancedFiltersToggle');
        if (toggleHdr && !e.target.closest('#omegaClearFiltersBtn') && !e.target.closest('#omegaFiltersCollapseBtn')) {
            e.preventDefault();
            this._toggleFiltersCollapsed();
            return;
        }
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.id === 'omegaDetailBack') {
            e.preventDefault();
            if (!this._state) return;
            this._state.view = 'gallery';
            this._state.detailFile = null;
            this._state.detailMetadata = null;
            this._syncViewTabs();
            this._syncResultsVisibility();
            this._pushUrl();
            if (this._state.results?.length) {
                this._renderResults();
                this._updateStats(this._state.total || 0);
            }
            return;
        }

        const detailTab = btn.dataset.omegaDetailTab;
        if (detailTab) {
            e.preventDefault();
            if (!this._state) return;
            this._state.detailPromptTab = detailTab;
            this._syncDetailTabs();
            this._renderDetailBody();
            return;
        }

        const detailAction = btn.dataset.omegaDetailAction;
        if (detailAction) {
            e.preventDefault();
            this._handleDetailAction(detailAction);
            return;
        }

        const promptMode = btn.dataset.omegaPromptMode;
        if (promptMode) {
            e.preventDefault();
            if (!this._state) return;
            this._state.detailPromptMode = promptMode;
            this._syncDetailTabs();
            this._renderDetailBody();
            return;
        }

        const expanderTab = btn.dataset.omegaExpanderTab;
        if (expanderTab) {
            e.preventDefault();
            if (!this._state) return;
            this._state.detailExpanderTab = expanderTab;
            this._syncDetailTabs();
            this._renderDetailBody();
            return;
        }

        const usageToggle = btn.dataset.omegaUsageToggle;
        if (usageToggle != null) {
            e.preventDefault();
            this._toggleUsageExpand(Number(usageToggle));
            return;
        }

        if (btn.id === 'omegaWorkspaceThisBtn') {
            e.preventDefault();
            this._selectThisWorkspace();
            return;
        }

        const promptSourceKey = btn.dataset.ispyPromptSource;
        if (promptSourceKey === 'compiled' || promptSourceKey === 'input') {
            e.preventDefault();
            if (promptSourceKey === 'compiled') {
                this._state.promptSourceCompiled = !this._state.promptSourceCompiled;
            } else {
                this._state.promptSourceInput = !this._state.promptSourceInput;
            }
            if (!this._state.promptSourceCompiled && !this._state.promptSourceInput) {
                if (promptSourceKey === 'compiled') this._state.promptSourceInput = true;
                else this._state.promptSourceCompiled = true;
            }
            this._syncPromptSourceToggles();
            this._onFiltersChanged();
            return;
        }

        const clearFilterKey = btn.dataset.ispyClearFilter;
        if (clearFilterKey) {
            e.preventDefault();
            this._clearFilterField(clearFilterKey);
            return;
        }

        const tristateBtn = btn.closest('[data-ispy-tristate]');
        if (tristateBtn && btn.classList.contains('omega-dsap-tristate-btn')) {
            e.preventDefault();
            const rawVal = btn.hasAttribute('data-tristate-value')
                ? btn.getAttribute('data-tristate-value')
                : null;
            this._setTriStateFilter(tristateBtn.dataset.ispyTristate, rawVal);
            return;
        }

        const dateMode = btn.dataset.dateMode;
        if (dateMode === 'relative' || dateMode === 'exact') {
            e.preventDefault();
            this._setDateMode(dateMode);
            return;
        }

        if (btn.id === 'omegaUcAnyBtn') {
            e.preventDefault();
            this._state.filters.ucLevel = null;
            this._syncSliderControls();
            this._onFiltersChanged();
            return;
        }

        if (btn.id === 'omegaNsfwAnyBtn') {
            e.preventDefault();
            this._state.filters.nsfwLevel = null;
            this._syncSliderControls();
            this._onFiltersChanged();
            return;
        }

        if (btn.id === 'omegaConsecutiveSeedsBtn') {
            e.preventDefault();
            this._state.filters.consecutiveSeeds = !this._state.filters.consecutiveSeeds;
            this._syncFilterLabels();
            this._onFiltersChanged();
            return;
        }

        if (btn.id === 'omegaReturnToSearchBtn') {
            e.preventDefault();
            this._restoreActiveSearch();
            return;
        }

        if (btn.id === 'omegaSearchBtn') {
            e.preventDefault();
            const text = (this._els.primaryInput?.value || '').trim();
            if (text) {
                this._addBlockFromText(text, { skipPush: true, keepResultsActive: true });
            }
            this._executeSearch();
            return;
        }
        if (btn.id === 'omegaFiltersCollapseBtn') {
            e.preventDefault();
            this._toggleFiltersCollapsed();
            return;
        }
        if (btn.id === 'omegaClearFiltersBtn') {
            e.preventDefault();
            this._clearAllFilters();
            return;
        }

        const chipRemove = btn.dataset.omegaChipRemove;
        if (chipRemove != null) {
            e.preventDefault();
            e.stopPropagation();
            this._removeBlockAtIndex(Number(chipRemove));
            return;
        }

        const pager = btn.dataset.omegaPager;
        if (pager === 'prev' && this._state.page > 1) {
            this._state.page -= 1;
            this._pushUrl();
            this._runSearch(false);
            return;
        }
        if (pager === 'next') {
            const totalPages = Math.max(1, Math.ceil((this._state.total || 0) / this._state.pageSize));
            if (this._state.page < totalPages) {
                this._state.page += 1;
                this._pushUrl();
                this._runSearch(false);
            }
            return;
        }

        const galleryItem = btn.closest('.omega-dsap-gallery-item');
        if (galleryItem?.dataset.filename) {
            e.preventDefault();
            const state = this._state;
            if (!state) return;
            const filename = galleryItem.dataset.filename;
            state.view = 'detail';
            state.detailFile = filename;
            this._syncViewTabs();
            this._syncResultsVisibility();
            this._pushUrl();
            this._loadDetail(filename);
        }
    },

    _buildSearchCacheKey() {
        const state = this._state;
        if (!state) return '';
        const blockOptions = state.blockOptions || omegasearchDsapDefaultBlockOptions();
        const filters = omegasearchDsapBuildFiltersPayload(this._collectFiltersFromInputs());
        let promptSource = state.promptSource;
        if (!promptSource) promptSource = this._resolvePromptSourceForPayload();
        return omegasearchDsapBuildSearchCacheKey(
            state.blocks,
            filters,
            state.workspaceId,
            state.viewType,
            promptSource,
            blockOptions
        );
    },

    _setLoading(isLoading) {
        const state = this._state;
        if (!state) return;
        state.loading = isLoading;
        const showProgress = isLoading && state.view !== 'search';
        this._els.searchProgressBanner?.classList.toggle('hidden', !showProgress);
        if (this._els.searchProgressText) {
            this._els.searchProgressText.textContent = isLoading
                ? `Search in progress…`
                : 'Searching workspace corpus…';
        }
        this._els.galleryLoading?.classList.toggle('hidden', !isLoading);
        this._els.usagesLoading?.classList.toggle('hidden', !isLoading);
        this._els.galleryGrid?.classList.toggle('hidden', isLoading);
        this._els.usagesBody?.closest('#omegaUsagesTable')?.classList.toggle('hidden', isLoading);
        const btn = this._els.searchBtn;
        if (btn) {
            btn.disabled = isLoading;
            if (isLoading) {
                if (!btn.dataset.omegaSearchBtnHtml) {
                    btn.dataset.omegaSearchBtnHtml = btn.innerHTML;
                }
                btn.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i> Searching…';
            } else if (btn.dataset.omegaSearchBtnHtml) {
                btn.innerHTML = btn.dataset.omegaSearchBtnHtml;
            }
        }
        this._els.galleryPager?.querySelectorAll('button').forEach((pagerBtn) => {
            pagerBtn.disabled = isLoading;
        });
    },

    async _runSearch(force) {
        const state = this._state;
        if (!state) return;

        const blocks = state.blocks || [];
        if (!blocks.length) {
            state.results = [];
            state.usages = [];
            state.total = 0;
            state.searchSessionId = null;
            state.serverSearchSessionId = null;
            return;
        }

        const session = this._ensureSearchSession(force);
        if (!force && session && this._applySessionPage(session)) {
            return;
        }

        if (!omegasearchDsapGetWsClient()?.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'I Spy', 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
            }
            return;
        }

        const omegaWs = omegasearchDsapGetWsClient();
        const generation = ++omegasearchDsapNextSearchGeneration;
        const requestQueryKey = this._buildSearchCacheKey();
        const requestSessionId = state.searchSessionId;
        const requestPage = state.page;
        this._setLoading(true);
        this._els.galleryEmpty?.classList.add('hidden');

        try {
            const offset = (state.page - 1) * state.pageSize;
            const filters = omegasearchDsapBuildFiltersPayload(this._collectFiltersFromInputs());
            const blockOptions = state.blockOptions || omegasearchDsapDefaultBlockOptions();
            const payload = {
                blocks: omegasearchDsapBlocksForSearchPayload(blocks, blockOptions),
                workspaceId: state.workspaceId,
                viewType: state.viewType,
                offset,
                limit: state.pageSize,
                blockOptions: { defaultMatchMode: blockOptions.defaultMatchMode || 'substring' }
            };
            if (state.promptSource) payload.promptSource = state.promptSource;
            else {
                const resolved = this._resolvePromptSourceForPayload();
                if (resolved) payload.promptSource = resolved;
            }
            if (Object.keys(filters).length) payload.filters = filters;
            if (force) {
                payload.forceRefresh = true;
            } else if (state.serverSearchSessionId) {
                payload.searchSessionId = state.serverSearchSessionId;
            }

            const data = await omegaWs.sendMessage('omegasearch_query', payload, false);

            if (this._isStaleSearchResponse(generation, requestQueryKey, requestSessionId, requestPage)) {
                if (!this._recoverResultsAfterStaleSearch() && generation === omegasearchDsapNextSearchGeneration) {
                    this._setLoading(false);
                }
                return;
            }

            this._state.resultsActive = true;
            this._syncResultsVisibility();
            this._state.total = data?.total || 0;
            this._state.results = data?.results || [];
            this._state.usages = data?.usages || [];
            if (data?.workspaceId) this._state.workspaceId = data.workspaceId;
            if (data?.searchSessionId) {
                this._state.serverSearchSessionId = data.searchSessionId;
            }

            const activeSession = this._getActiveSession();
            if (activeSession && activeSession.id === requestSessionId && activeSession.queryKey === requestQueryKey) {
                activeSession.total = data?.total || 0;
                activeSession.usages = data?.usages || [];
                activeSession.pages[requestPage] = data?.results || [];
                activeSession.lastPage = requestPage;
                if (data?.corpusSize != null) activeSession.corpusSize = data.corpusSize;
                if (data?.searchSessionId) activeSession.serverSessionId = data.searchSessionId;
                omegasearchDsapPersistSessionsToStorage();
            }

            if (this._els.corpusSize && data?.corpusSize != null) {
                this._els.corpusSize.textContent = String(data.corpusSize);
            }
            this._updateWorkspaceLabel();
            this._renderResults();
            this._renderUsages();
            this._updateStats(data?.total || 0);
            this._saveActiveSearchSnapshot();
        } catch (err) {
            if (this._isStaleSearchResponse(generation, requestQueryKey, requestSessionId, requestPage)) {
                if (!this._recoverResultsAfterStaleSearch() && generation === omegasearchDsapNextSearchGeneration) {
                    this._setLoading(false);
                }
                return;
            }
            console.error('[ispy-dsap] search failed:', err);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'I Spy', err.message || 'Search failed', false, 4000, '<i class="fas fa-exclamation-circle"></i>');
            }
            this._els.galleryEmpty?.classList.remove('hidden');
            if (this._els.galleryEmpty) {
                this._els.galleryEmpty.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Search failed';
            }
        } finally {
            if (this._state && generation === omegasearchDsapNextSearchGeneration) {
                this._setLoading(false);
            }
        }
    },

    _updateStats(total) {
        const showing = this._state.results?.length || 0;
        const usages = this._state.usages?.length || 0;
        if (this._els.statMatches) this._els.statMatches.textContent = String(total);
        if (this._els.statShowing) this._els.statShowing.textContent = String(showing);
        if (this._els.statUsages) this._els.statUsages.textContent = String(usages);
        this._els.statsTable?.classList.toggle('hidden', !(total > 0));
    },

    _renderResults() {
        const grid = this._els.galleryGrid;
        if (!grid) return;
        grid.innerHTML = '';
        grid.classList.remove('hidden');

        const results = this._state.results || [];
        if (!results.length) {
            this._els.galleryEmpty?.classList.remove('hidden');
            if (this._els.galleryEmpty) {
                this._els.galleryEmpty.innerHTML = '<i class="fas fa-search"></i> No images match all blocks';
            }
            this._els.galleryPager?.classList.add('hidden');
            return;
        }

        this._els.galleryEmpty?.classList.add('hidden');
        const frag = document.createDocumentFragment();
        results.forEach((row) => {
            const filename = row.filename;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'omega-dsap-gallery-item';
            item.dataset.filename = filename;
            item.title = filename;
            const meta = row.metadata || {};
            const dims = meta.width && meta.height ? `${meta.width}×${meta.height}` : '';
            item.innerHTML = `
                <img src="${omegasearchDsapPreviewUrl(filename)}" alt="${omegasearchDsapEscapeAttr(filename)}" loading="lazy">
                <div class="omega-dsap-gallery-item-score">${omegasearchDsapEscapeHtml(dims || filename)}</div>
            `;
            frag.appendChild(item);
        });
        grid.appendChild(frag);

        const totalPages = Math.max(1, Math.ceil((this._state.total || 0) / this._state.pageSize));
        if (this._els.galleryPage) this._els.galleryPage.textContent = String(this._state.page);
        if (this._els.galleryTotalPages) this._els.galleryTotalPages.textContent = String(totalPages);
        this._els.galleryPager?.classList.toggle('hidden', totalPages <= 1);
    },

    _renderUsages() {
        const body = this._els.usagesBody;
        if (!body) return;
        body.innerHTML = '';
        body.closest('#omegaUsagesTable')?.classList.remove('hidden');

        const usages = this._state.usages || [];
        if (!usages.length) {
            this._els.usagesEmpty?.classList.remove('hidden');
            return;
        }
        this._els.usagesEmpty?.classList.add('hidden');

        const highlightTerms = omegasearchDsapFlattenBlockTerms(this._state.blocks);
        const frag = document.createDocumentFragment();
        usages.forEach((usage, index) => {
            const usageKey = omegasearchDsapUsageKey(usage, index);
            const isExpanded = this._state.expandedUsages.has(usageKey);
            const locationParts = [omegasearchDsapSourceLabel(usage.source)];
            if (usage.character) locationParts.push(usage.character);

            const tr = document.createElement('tr');
            tr.className = 'omega-dsap-usage-row';
            tr.innerHTML = `
                <td>${omegasearchDsapEscapeHtml(usage.block || '')}</td>
                <td>${omegasearchDsapEscapeHtml(locationParts.join(' · '))}</td>
                <td class="omega-dsap-usage-text">
                    <button type="button" class="omega-dsap-usage-expand-btn" data-omega-usage-toggle="${index}" title="${isExpanded ? 'Collapse' : 'Expand full prompt'}">
                        <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
                    </button>
                    <span class="omega-dsap-usage-snippet">${omegasearchDsapHighlightTerms(usage.displayText || '', highlightTerms)}</span>
                </td>
                <td align="right">${omegasearchDsapEscapeHtml(String(usage.fileCount || 0))}</td>
            `;
            frag.appendChild(tr);

            const expandTr = document.createElement('tr');
            expandTr.className = 'omega-dsap-usage-expand-row' + (isExpanded ? '' : ' hidden');
            expandTr.dataset.omegaUsageExpand = String(index);
            expandTr.innerHTML = `<td colspan="4"><div class="omega-dsap-usage-full-prompt" id="omegaUsageExpand-${index}">${isExpanded ? '<i class="fas fa-spinner-third fa-spin"></i> Loading…' : ''}</div></td>`;
            frag.appendChild(expandTr);

            if (isExpanded) {
                setTimeout(() => this._fillUsageExpand(index, usage, usageKey), 0);
            }
        });
        body.appendChild(frag);
    },

    async _toggleUsageExpand(index) {
        const usage = this._state.usages?.[index];
        if (!usage) return;
        const usageKey = omegasearchDsapUsageKey(usage, index);
        if (this._state.expandedUsages.has(usageKey)) {
            this._state.expandedUsages.delete(usageKey);
        } else {
            this._state.expandedUsages.add(usageKey);
        }
        this._renderUsages();
    },

    async _fillUsageExpand(index, usage, usageKey) {
        const container = this._els.usagesBody?.querySelector(`#omegaUsageExpand-${index}`);
        if (!container) return;

        const highlightTerms = omegasearchDsapFlattenBlockTerms(this._state.blocks);
        const cached = this._state.usagePromptCache[usageKey];
        if (cached) {
            container.innerHTML = cached;
            return;
        }

        if (usage.fullPrompt) {
            const html = this._buildUsagePromptHtml(usage, highlightTerms);
            this._state.usagePromptCache[usageKey] = html;
            container.innerHTML = html;
            return;
        }

        const sampleFile = usage.sampleFilename
            || (this._state.results?.[0]?.filename);
        const metadataFilename = sampleFile
            ? omegasearchDsapResolveMetadataFilename(sampleFile, this)
            : '';
        if (!metadataFilename || !omegasearchDsapGetWsClient()?.isConnected()) {
            const html = this._buildUsagePromptHtml({
                ...usage,
                fullPrompt: usage.displayText || ''
            }, highlightTerms);
            this._state.usagePromptCache[usageKey] = html;
            container.innerHTML = html;
            return;
        }

        try {
            // getImageMetadata: public/scripts/comp/galleryView.js
            const metadata = typeof getImageMetadata === 'function'
                ? await getImageMetadata(metadataFilename)
                : await omegasearchDsapGetWsClient().requestImageMetadata(metadataFilename);
            const bundle = this._extractUsagePromptBundle(metadata, usage);
            const html = this._buildUsagePromptHtml({ ...usage, ...bundle }, highlightTerms);
            this._state.usagePromptCache[usageKey] = html;
            if (this._state.expandedUsages.has(usageKey)) {
                container.innerHTML = html;
            }
        } catch (err) {
            container.innerHTML = `<span class="omega-dsap-detail-empty">Could not load full prompt: ${omegasearchDsapEscapeHtml(err.message || 'error')}</span>`;
        }
    },

    _extractUsagePromptBundle(metadata, usage) {
        if (!metadata) return { fullPrompt: usage.displayText || '' };
        const source = usage.source || 'prompt';
        const charName = usage.character;

        if (source === 'character_prompt' && charName) {
            const chars = metadata.characterPrompts || [];
            const match = chars.find((c) => c.chara_name === charName) || chars[0];
            return {
                fullPrompt: match?.prompt || usage.displayText || '',
                fullUc: match?.uc || '',
                characterName: match?.chara_name || charName
            };
        }

        if (source === 'v4_character_caption') {
            const compiled = metadata.compiled_characterPrompts || metadata.compiledCharacterPrompts || [];
            const match = compiled.find((c) => c.chara_name === charName) || compiled[0];
            return {
                fullPrompt: match?.prompt || usage.displayText || '',
                fullUc: match?.uc || '',
                characterName: match?.chara_name || charName || 'V4 character'
            };
        }

        return {
            fullPrompt: metadata.prompt || usage.displayText || '',
            fullUc: metadata.uc || '',
            characterPrompts: metadata.characterPrompts || []
        };
    },

    _buildUsagePromptHtml(usage, highlightTerms) {
        const parts = [];
        const mainText = usage.fullPrompt || usage.displayText || '';
        if (mainText) {
            const label = usage.characterName ? 'Character prompt' : (usage.source === 'character_prompt' ? 'Character prompt' : 'Main prompt');
            parts.push(`<div class="omega-dsap-usage-char-label">${omegasearchDsapEscapeHtml(label)}</div>`);
            parts.push(`<div>${omegasearchDsapHighlightTerms(mainText, highlightTerms)}</div>`);
        }
        if (usage.fullUc) {
            parts.push(`<div class="omega-dsap-usage-char-block"><div class="omega-dsap-usage-char-label">UC</div><div>${omegasearchDsapHighlightTerms(usage.fullUc, highlightTerms)}</div></div>`);
        }
        const chars = usage.characterPrompts;
        if (Array.isArray(chars) && chars.length && !usage.characterName) {
            chars.forEach((char) => {
                if (!char?.prompt && !char?.uc) return;
                const name = char.chara_name || 'Character';
                parts.push(`<div class="omega-dsap-usage-char-block"><div class="omega-dsap-usage-char-label">${omegasearchDsapEscapeHtml(name)}</div>`);
                if (char.prompt) {
                    parts.push(`<div>${omegasearchDsapHighlightTerms(char.prompt, highlightTerms)}</div>`);
                }
                if (char.uc) {
                    parts.push(`<div class="omega-dsap-usage-char-block"><div class="omega-dsap-usage-char-label">UC</div><div>${omegasearchDsapHighlightTerms(char.uc, highlightTerms)}</div></div>`);
                }
                parts.push('</div>');
            });
        }
        return parts.join('') || `<span class="omega-dsap-detail-empty">${omegasearchDsapHighlightTerms(usage.displayText || '', highlightTerms)}</span>`;
    },

    async _loadDetail(filename) {
        const state = this._state;
        if (!state || !filename) return;
        const resolved = omegasearchDsapResolveMetadataFilename(filename, this);
        if (!resolved) return;
        filename = resolved;
        state.detailFile = filename;
        if (this._els.detailFilename) this._els.detailFilename.textContent = filename;

        const token = ++state.detailToken;
        state.detailLoading = true;
        state.detailImageReady = false;
        this._els.detailError?.classList.add('hidden');
        this._els.detailLayout?.classList.remove('hidden');
        this._els.detailMeta?.classList.add('hidden');
        this._els.detailMetaLoading?.classList.remove('hidden');
        if (this._els.detailBody) {
            this._els.detailBody.innerHTML = '<div class="omega-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading prompt data…</div>';
        }
        this._syncDetailActions(false);
        this._syncDetailLoadProgress();

        if (this._els.detailImage) {
            const img = this._els.detailImage;
            const imageToken = token;
            img.classList.add('omega-dsap-detail-image-loading');
            this._els.detailImageLoading?.classList.remove('hidden');
            const onImageDone = () => {
                if (!this._state || imageToken !== state.detailToken) return;
                img.classList.remove('omega-dsap-detail-image-loading');
                this._els.detailImageLoading?.classList.add('hidden');
                state.detailImageReady = true;
                this._syncDetailLoadProgress();
            };
            img.onload = onImageDone;
            img.onerror = onImageDone;
            img.src = `/images/${encodeURIComponent(filename)}`;
            img.alt = filename;
            if (img.complete) onImageDone();
        }

        if (!omegasearchDsapGetWsClient()?.isConnected()) {
            state.detailLoading = false;
            this._els.detailMetaLoading?.classList.add('hidden');
            this._syncDetailLoadProgress();
            this._els.detailError?.classList.remove('hidden');
            if (this._els.detailErrorText) {
                this._els.detailErrorText.textContent = 'WebSocket not connected';
            }
            return;
        }

        try {
            const omegaWs = omegasearchDsapGetWsClient();
            const metadata = await omegaWs.requestImageMetadata(filename);
            if (!this._state || token !== state.detailToken) return;
            this._state.detailMetadata = metadata;
            this._els.detailMetaLoading?.classList.add('hidden');
            this._els.detailMeta?.classList.remove('hidden');
            this._renderDetailMeta(metadata);
            this._syncDetailTabs();
            this._renderDetailBody();
            this._syncDetailActions(true);
        } catch (err) {
            if (!this._state || token !== state.detailToken) return;
            this._els.detailMetaLoading?.classList.add('hidden');
            this._els.detailError?.classList.remove('hidden');
            if (this._els.detailErrorText) {
                this._els.detailErrorText.textContent = err.message || 'Failed to load image metadata';
            }
            this._syncDetailActions(false);
        } finally {
            if (this._state && token === state.detailToken) {
                this._state.detailLoading = false;
                this._syncDetailLoadProgress();
            }
        }
    },

    _syncDetailLoadProgress() {
        const state = this._state;
        if (!state) return;
        const imageReady = !!state.detailImageReady;
        const metaReady = !state.detailLoading;
        const textEl = this._els.detailProgressText;
        const banner = this._els.detailLoading;
        if (!imageReady && !metaReady) {
            if (textEl) textEl.textContent = 'Loading preview and metadata…';
        } else if (!imageReady) {
            if (textEl) textEl.textContent = 'Loading preview…';
        } else if (!metaReady) {
            if (textEl) textEl.textContent = 'Loading metadata…';
        }
        if (!imageReady || !metaReady) {
            banner?.classList.remove('hidden');
        } else {
            banner?.classList.add('hidden');
        }
    },

    _syncDetailActions(enabled) {
        const filename = this._state?.detailFile;
        const metadata = this._state?.detailMetadata;
        const workspaceId = omegasearchDsapGetDetailWorkspaceId(metadata);
        const isPinned = omegasearchDsapIsDetailImagePinned(filename, metadata);
        const actionBtns = this._els.detailActions?.querySelectorAll('[data-omega-detail-action]');
        actionBtns?.forEach((btn) => {
            btn.disabled = !enabled || !filename;
            if (btn.dataset.omegaDetailAction === 'workspace') {
                btn.disabled = !enabled || !workspaceId;
            }
        });
        if (this._els.detailFavoriteIcon) {
            this._els.detailFavoriteIcon.className = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
        }
        if (this._els.detailFavoriteLabel) {
            this._els.detailFavoriteLabel.textContent = isPinned ? 'Unfavorite' : 'Favorite';
        }
        const favBtn = this._els.detailActions?.querySelector('[data-omega-detail-action="favorite"]');
        if (favBtn) {
            favBtn.title = isPinned ? 'Remove from favorites' : 'Add to favorites';
        }
    },

    _handleDetailAction(action) {
        const state = this._state;
        if (!state?.detailFile || state.detailLoading) return;
        switch (action) {
            case 'jump':
                void this._jumpDetailToGallery();
                break;
            case 'workspace':
                this._goToDetailWorkspace();
                break;
            case 'editor':
                this._openDetailInEditor();
                break;
            case 'favorite':
                void this._toggleDetailFavorite();
                break;
            case 'window':
                this._openDetailInWindow();
                break;
            case 'download':
                this._downloadDetailImage();
                break;
            default:
                break;
        }
    },

    async _jumpDetailToGallery() {
        const filename = this._state?.detailFile;
        if (!filename) return;
        const metadata = this._state?.detailMetadata;
        const imageWorkspaceId = omegasearchDsapGetDetailWorkspaceId(metadata);
        const currentWorkspaceId = activeWorkspace || 'default';

        const findImageIndex = () => {
            if (!allImages || !Array.isArray(allImages) || !allImages.length) return -1;
            return allImages.findIndex((img) =>
                img && (img.filename === filename || img.original === filename || img.upscaled === filename)
            );
        };

        let imageIndex = findImageIndex();

        if (imageIndex === -1 && imageWorkspaceId && imageWorkspaceId !== currentWorkspaceId) {
            const workspaceName = workspaces?.[imageWorkspaceId]?.name || imageWorkspaceId;
            const confirmed = await showConfirmationDialog(
                `This image is in the "${workspaceName}" workspace. Switch to that workspace and jump to the image?`,
                [
                    { text: 'Switch & Jump', value: true, className: 'btn-primary' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            if (!confirmed) return;
            // setActiveWorkspace: public/scripts/comp/workspaceUtils.js
            await setActiveWorkspace(imageWorkspaceId);
            // loadGallery: public/scripts/comp/galleryView.js
            if (loadGallery) await loadGallery(true);
            imageIndex = findImageIndex();
        }

        if (imageIndex === -1 && loadGallery) {
            await loadGallery(true);
            imageIndex = findImageIndex();
        }

        if (imageIndex === -1) {
            showGlassToast('warning', 'Not Found', 'Image not found in workspace', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        let targetIndex = imageIndex;
        if (typeof window.filteredImageIndices !== 'undefined' && Array.isArray(window.filteredImageIndices)) {
            const filteredIndex = window.filteredImageIndices.indexOf(imageIndex);
            if (filteredIndex !== -1) {
                targetIndex = filteredIndex;
            } else {
                showGlassToast('warning', 'Not Visible', 'Image is filtered out of current view', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }
        }

        const galleryWindow = document.getElementById('galleryWindow');
        if (galleryWindow) {
            // isGalleryWindowHidden, openModal, bringModalToFront: public/scripts/comp/modalUtils.js
            if (isGalleryWindowHidden()) {
                openModal(galleryWindow);
                if (typeof window.isGalleryHidden !== 'undefined') {
                    window.isGalleryHidden = false;
                }
            } else {
                bringModalToFront(galleryWindow);
            }
        }

        // displayGalleryFromStartIndex: public/scripts/comp/galleryView.js
        if (displayGalleryFromStartIndex) {
            await displayGalleryFromStartIndex(targetIndex, true);
        }
    },

    _goToDetailWorkspace() {
        const workspaceId = omegasearchDsapGetDetailWorkspaceId(this._state?.detailMetadata);
        if (!workspaceId) {
            showGlassToast('warning', 'Not Available', 'No workspace found for this image', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        // setActiveWorkspace: public/scripts/comp/workspaceUtils.js
        setActiveWorkspace(workspaceId);
    },

    _openDetailInEditor() {
        const filename = this._state?.detailFile;
        const metadata = this._state?.detailMetadata;
        if (!filename) return;
        const image = omegasearchDsapResolveDetailImage(filename, metadata);
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        openManualModalWithContent({
            type: 'image',
            image,
            metadata: metadata || image?.metadata || null
        });
    },

    async _toggleDetailFavorite() {
        const filename = this._state?.detailFile;
        const metadata = this._state?.detailMetadata;
        if (!filename) return;
        const image = omegasearchDsapResolveDetailImage(filename, metadata);
        // togglePinImage: public/scripts/comp/galleryView.js
        await togglePinImage(image);
        this._syncDetailActions(true);
    },

    _openDetailInWindow() {
        const filename = this._state?.detailFile;
        const metadata = this._state?.detailMetadata;
        if (!filename) return;
        const image = omegasearchDsapResolveDetailImage(filename, metadata);
        // openGalleryImageInViewer: public/scripts/comp/imageViewer.js
        const viewer = openGalleryImageInViewer(image);
        if (viewer?.element) {
            viewer.element.dataset.imageData = JSON.stringify(image);
        }
    },

    _downloadDetailImage() {
        const filename = this._state?.detailFile;
        const metadata = this._state?.detailMetadata;
        if (!filename) return;
        const image = omegasearchDsapResolveDetailImage(filename, metadata);
        // downloadImage: public/scripts/comp/galleryView.js
        downloadImage(image);
    },

    _renderDetailMeta(metadata) {
        const el = this._els.detailMeta;
        if (!el || !metadata) return;

        const modelKey = metadata.model
            || (typeof determineModelFromMetadata === 'function' ? determineModelFromMetadata(metadata) : null);
        const modelHtml = metadata.model_display_name
            || omegasearchDsapBuildModelBadgeHtml(modelKey);

        let samplerHtml = metadata.sampler || '—';
        if (typeof getSamplerMeta === 'function' && metadata.sampler) {
            const samplerObj = getSamplerMeta(metadata.sampler);
            if (samplerObj) {
                samplerHtml = `${omegasearchDsapEscapeHtml(samplerObj.display_short || samplerObj.display)}${samplerObj.badge ? ` <span class="custom-dropdown-badge ${omegasearchDsapEscapeAttr(samplerObj.badge_class)}">${omegasearchDsapEscapeHtml(samplerObj.badge)}</span>` : ''}`;
            }
        }

        let resolutionText = '—';
        if (typeof formatResolution === 'function' && (metadata.resolution || metadata.width)) {
            resolutionText = formatResolution(metadata.resolution, metadata.width, metadata.height);
        } else if (metadata.width && metadata.height) {
            resolutionText = `${metadata.width}×${metadata.height}`;
        }

        const datasetLabel = omegasearchDsapFormatDatasetLabel(metadata.dataset_config);
        const presetName = metadata.preset_name || metadata.forge_data?.preset_name || 'Manual';
        const workspaceLabel = omegasearchDsapFormatImageWorkspaces(metadata);
        const steps = metadata.steps != null ? String(metadata.steps) : '—';
        const guidance = metadata.scale != null ? Number(metadata.scale).toFixed(1) : '—';

        el.innerHTML = `
            <div class="omega-dsap-detail-meta-row">
                <div class="omega-dsap-detail-meta-item"><label>Workspace</label><div class="omega-dsap-meta-value">${omegasearchDsapEscapeHtml(workspaceLabel)}</div></div>
                <div class="omega-dsap-detail-meta-item"><label>Model</label><div class="omega-dsap-meta-value">${modelHtml}</div></div>
                <div class="omega-dsap-detail-meta-item"><label>Preset</label><div class="omega-dsap-meta-value">${omegasearchDsapEscapeHtml(presetName)}</div></div>
                <div class="omega-dsap-detail-meta-item"><label>Dataset</label><div class="omega-dsap-meta-value">${omegasearchDsapEscapeHtml(datasetLabel)}</div></div>
            </div>
            <div class="omega-dsap-detail-meta-row">
                <div class="omega-dsap-detail-meta-item"><label>Resolution</label><div class="omega-dsap-meta-value">${omegasearchDsapEscapeHtml(resolutionText)}</div></div>
                <div class="omega-dsap-detail-meta-item"><label>Steps</label><div class="omega-dsap-meta-value">${omegasearchDsapEscapeHtml(steps)}</div></div>
                <div class="omega-dsap-detail-meta-item"><label>Guidance</label><div class="omega-dsap-meta-value">${omegasearchDsapEscapeHtml(guidance)}</div></div>
                <div class="omega-dsap-detail-meta-item"><label>Sampler</label><div class="omega-dsap-meta-value">${samplerHtml}</div></div>
            </div>
        `;
    },

    _syncDetailTabs() {
        const tab = this._state.detailPromptTab || 'prompts';
        const mode = this._state.detailPromptMode || 'input';
        const expanderTab = this._state.detailExpanderTab || 'genso';

        this._els.detailMainTabs?.querySelectorAll('[data-omega-detail-tab]').forEach((btn) => {
            btn.classList.toggle('omega-dsap-tab-active', btn.dataset.omegaDetailTab === tab);
        });
        this._els.detailPromptToggle?.classList.toggle('hidden', tab === 'expanders');
        this._els.detailExpanderTabs?.classList.toggle('hidden', tab !== 'expanders');

        this._els.detailPromptToggle?.querySelectorAll('[data-omega-prompt-mode]').forEach((btn) => {
            btn.classList.toggle('omega-dsap-toggle-active', btn.dataset.omegaPromptMode === mode);
        });
        this._els.detailExpanderTabs?.querySelectorAll('[data-omega-expander-tab]').forEach((btn) => {
            btn.classList.toggle('omega-dsap-toggle-active', btn.dataset.omegaExpanderTab === expanderTab);
        });
    },

    _renderDetailBody() {
        const el = this._els.detailBody;
        const state = this._state;
        const metadata = state?.detailMetadata;
        if (!el || !state || !metadata) return;

        const highlightTerms = omegasearchDsapFlattenBlockTerms(state.blocks);
        const compiled = state.detailPromptMode === 'compiled';
        const tab = state.detailPromptTab || 'prompts';
        const fields = omegasearchDsapResolveDetailPromptFields(metadata, compiled);

        if (tab === 'expanders') {
            if (state.detailExpanderTab === 'tenso') {
                const tendai = metadata.dynamic_generation?.compiled_prompt?.text_replacements
                    || metadata.dynamic_generation?.text_replacements
                    || metadata.dynamic_generation;
                el.innerHTML = `<div class="omega-dsap-detail-prompt-section"><h4>Tendai expanders</h4>${omegasearchDsapFormatExpanderList(tendai)}</div>`;
            } else {
                const genso = metadata.text_replacements_seed
                    || metadata.text_replacements
                    || metadata.forge_data?.text_replacements_seed
                    || metadata.forge_data?.text_replacements;
                el.innerHTML = `<div class="omega-dsap-detail-prompt-section"><h4>Text expanders (Genso)</h4>${omegasearchDsapFormatExpanderList(genso)}</div>`;
            }
            return;
        }

        if (tab === 'uc') {
            const mainUc = compiled
                ? (fields.mainUc || metadata.compiled_uc || metadata.uc || '')
                : fields.mainUc;
            const negPrompt = fields.negPrompt;
            const parts = [];
            if (mainUc) {
                parts.push(`<div class="omega-dsap-detail-prompt-section"><h4>Undesired content</h4><div>${omegasearchDsapHighlightTerms(mainUc, highlightTerms)}</div></div>`);
            }
            if (negPrompt) {
                parts.push(`<div class="omega-dsap-detail-prompt-section"><h4>Negative prompt</h4><div>${omegasearchDsapHighlightTerms(negPrompt, highlightTerms)}</div></div>`);
            }
            const chars = fields.chars;
            if (Array.isArray(chars)) {
                chars.forEach((char, idx) => {
                    if (!char?.uc) return;
                    const name = char.chara_name || `Character ${idx + 1}`;
                    parts.push(`<div class="omega-dsap-detail-prompt-section"><h4>${omegasearchDsapEscapeHtml(name)} UC</h4><div>${omegasearchDsapHighlightTerms(char.uc, highlightTerms)}</div></div>`);
                });
            }
            el.innerHTML = parts.length ? parts.join('') : '<div class="omega-dsap-detail-empty">No UC or negative prompt data</div>';
            return;
        }

        const mainPrompt = fields.mainPrompt;
        const parts = [];
        if (mainPrompt) {
            parts.push(`<div class="omega-dsap-detail-prompt-section"><h4>Main prompt</h4><div>${omegasearchDsapHighlightTerms(mainPrompt, highlightTerms)}</div></div>`);
        }
        const chars = fields.chars;
        if (Array.isArray(chars)) {
            chars.forEach((char, idx) => {
                if (!char?.prompt) return;
                const name = char.chara_name || `Character ${idx + 1}`;
                const disabled = char.enabled === false ? ' (disabled)' : '';
                parts.push(`<div class="omega-dsap-detail-prompt-section"><h4>${omegasearchDsapEscapeHtml(name + disabled)}</h4><div>${omegasearchDsapHighlightTerms(char.prompt, highlightTerms)}</div></div>`);
            });
        }
        el.innerHTML = parts.length ? parts.join('') : '<div class="omega-dsap-detail-empty">No prompt data</div>';
    }
};

function registerOmegasearchDsapApplet() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: ISPY_DSAP_URL,
        theme: 'dsap-smf',
        getContent() {
            return {
                html: omegasearchDsapBuildHtml(),
                css: omegasearchDsapScopedCss,
                drivers: omegasearchDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

registerOmegasearchDsapApplet();
