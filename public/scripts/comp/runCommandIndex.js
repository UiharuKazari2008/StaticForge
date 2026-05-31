// Run command index — searchable catalog for Run applet
// public/scripts/comp/runCommandIndex.js

const RUN_CATEGORY_LABELS = {
    app: 'Application',
    workspace: 'Workspace',
    note: 'Note',
    shortcut: 'Shortcut',
    wiki: 'Grimoire',
    'gallery-tag': 'Gallery',
    'gallery-date': 'Gallery',
    'text-replacement': 'Expander',
    'quick-access': 'Tag',
    reference: 'Reference',
    preset: 'Spellbook',
    'network-deferred': 'Network',
    'naxt-tag': 'Atelier',
    'naxt-artist': 'Artist',
    'dataset-tag': 'Dataset'
};

const RUN_CATEGORY_ICONS = {
    app: 'fas fa-window',
    workspace: 'fas fa-planet-ringed',
    note: 'fas fa-sticky-note',
    shortcut: 'fas fa-link',
    wiki: 'fas fa-book',
    'gallery-tag': 'fas fa-tags',
    'gallery-date': 'fas fa-calendar',
    'text-replacement': 'fas fa-book-font',
    'quick-access': 'fas fa-tag',
    reference: 'fas fa-swatchbook',
    preset: 'fas fa-book-spells',
    'network-deferred': 'fas fa-wifi',
    'naxt-tag': 'fas fa-flask',
    'naxt-artist': 'fas fa-wheelchair',
    'dataset-tag': 'fas fa-folder-tree'
};

/** Single-line hint shown under the Run search field */
const RUN_SEARCH_PREFIX_HINT = '> apps · note: · wiki: · tag: · # · ! · preset: · ref: · ws: · goto: · artist: · naxt: · dataset:';

const RUN_SCOPED_PREFIX_HINTS = new Set([
    'note', 'wiki', 'gallery-tag', 'gallery-date', 'preset', 'reference', 'workspace', 'app', 'text-replacement'
]);

/** Alternative search terms → launchId(s) for application matching */
const RUN_APP_ALIAS_GROUPS = [
    { aliases: ['editor', 'dream studio', 'dreamstudio', 'manual', 'novelai'], launchIds: ['studio'] },
    { aliases: ['generate', 'generation', 'spellcaster', 'spell caster', 'spell', 'cast'], launchIds: ['studio', 'spellbook'] },
    { aliases: ['spellbook', 'presets', 'preset book', 'spell book'], launchIds: ['spellbook'] },
    { aliases: ['gallery', 'images', 'art', 'results'], launchIds: ['workspace'] },
    { aliases: ['reference', 'references', 'vibe', 'style', 'cache', 'swatchbook'], launchIds: ['reference'] },
    { aliases: ['grimoire', 'wiki', 'e621', 'danbooru', 'e6', 'dan', 'encyclopedia', 'books', 'novelai', 'help', 'search'], launchIds: ['encyclopedia'] },
    { aliases: ['notion', 'notes', 'notebook', 'notepad'], launchIds: ['notebook'] },
    { aliases: ['chat', 'girlfriend', 'friend', 'erp', 'roleplay', 'messages'], launchIds: ['chat'] },
    { aliases: ['atelier', 'naxt', 'vibe', 'style', 'lab', 'novelai'], launchIds: ['naxt'] },
    { aliases: ['expanders', 'text replacement', 'expander', 'prefix', 'prefixes'], launchIds: ['expanders'] },
    { aliases: ['import', 'upload' ,'vibe', 'style'], launchIds: ['import'] },
    { aliases: ['phasewalker', 'phase', 'bracket', 'stages'], launchIds: ['bracket-generation'] },
    { aliases: ['config', 'settings editor', 'settings'], launchIds: ['config-editor'] },
    { aliases: ['request', 'body', 'replacements', 'stages', 'pipeline'], launchIds: ['request-body-replacements'] },
    { aliases: ['wallpaper', 'desktop', 'background'], launchIds: ['desktop-settings'] },
    { aliases: ['websocket', 'ws', 'network monitor', 'requests'], launchIds: ['websocket-requests'] },
    { aliases: ['solar system', 'workspaces', 'manage workspaces', 'planets'], launchIds: ['solar-system'] },
    { aliases: ['favorites', 'favourite', 'stars'], launchIds: ['favorites'] },
    { aliases: ['memories', 'knowledge', 'dna'], launchIds: ['memories'] },
    { aliases: ['rules', 'director'], launchIds: ['rules'] },
    { aliases: ['persona', 'character'], launchIds: ['chat-persona'] },
    { aliases: ['api', 'keys', 'keychain', 'credentials'], launchIds: ['keychain'] },
    { aliases: ['preset manager', 'manage presets'], launchIds: ['presets'] }
];

const RUN_PREFIX_STRIPS = [
    { prefix: 'note:', category: 'note' },
    { prefix: 'wiki:', category: 'wiki' },
    { prefix: 'tag:', category: 'gallery-tag' },
    { prefix: 'preset:', category: 'preset' },
    { prefix: 'ref:', category: 'reference' },
    { prefix: 'ws:', category: 'workspace' },
    { prefix: 'goto:', category: 'gallery-date' },
    { prefix: 'artist:', category: 'naxt-artist' },
    { prefix: 'naxt:', category: 'naxt-tag' },
    { prefix: 'dataset:', category: 'dataset-tag' },
    { prefix: '>', category: 'app' }
];

const RUN_SHORTCUT_MERGE_TYPES = new Set(['note', 'reference', 'preset', 'applet', 'request', 'wiki-page', 'static-wiki-page', 'nax-tag', 'bracket-generation', 'image']);

let runStaticCache = null;
let runNoteCache = null;
let runNoteCacheTime = 0;
let runNaxGalleriesCache = null;
let runNaxGalleriesCacheTime = 0;
let runSearchGeneration = 0;

function getRunPromptInsertTarget() {
    const ae = document.activeElement;
    if (ae && ae.matches('.prompt-textarea, .character-prompt-textarea')) return ae;
    if (window.lastFocusedPromptTextarea && document.contains(window.lastFocusedPromptTextarea)) {
        return window.lastFocusedPromptTextarea;
    }
    return null;
}

function normalizeRunQuery(raw) {
    let query = String(raw || '').trim();
    let categoryHint = null;
    for (const { prefix, category } of RUN_PREFIX_STRIPS) {
        if (query.toLowerCase().startsWith(prefix)) {
            query = query.slice(prefix.length).trim();
            categoryHint = category;
            break;
        }
    }
    if (query.startsWith('#')) {
        query = query.slice(1).trim();
        categoryHint = categoryHint || 'gallery-tag';
    }
    if (query.startsWith('!')) {
        categoryHint = categoryHint || 'text-replacement';
    }
    return { query, categoryHint };
}

function runScoreText(query, text, categoryHint, entryCategory) {
    let score = typeof calculateStringSimilarity === 'function'
        ? calculateStringSimilarity(query, text)
        : 0;
    if (categoryHint && categoryHint === entryCategory) score += 25;
    return score;
}

function runScoreEntry(query, entry, categoryHint) {
    const texts = [entry.label, entry.subtitle, ...(entry.keywords || [])].filter(Boolean);
    let best = 0;
    texts.forEach((t) => {
        best = Math.max(best, runScoreText(query, t, categoryHint, entry.category));
    });
    if (entry.category === 'note' && query.includes(' ')) best += 8;
    if (categoryHint === 'gallery-date' && entry.category === 'gallery-date') best += 30;
    if (categoryHint === 'gallery-tag' && entry.category === 'gallery-tag') best += 20;
    if (categoryHint === 'text-replacement' && entry.category === 'text-replacement') best += 25;
    if (categoryHint === 'preset' && entry.category === 'preset') best += 25;
    if (categoryHint === 'reference' && entry.category === 'reference') best += 25;
    if (categoryHint === 'naxt-artist' && entry.category === 'naxt-artist') best += 30;
    if (categoryHint === 'naxt-tag' && (entry.category === 'naxt-tag' || entry.category === 'naxt-artist')) best += 25;
    if (categoryHint === 'dataset-tag' && entry.category === 'dataset-tag') best += 30;
    if (getRunPromptInsertTarget() && entry.category === 'quick-access' && looksLikeTagQuery(query)) best += 15;
    if (!getRunPromptInsertTarget() && entry.category === 'gallery-tag' && looksLikeTagQuery(query)) best += 15;
    return best;
}

function looksLikeTagQuery(query) {
    if (!query) return false;
    if (query.includes(',')) return true;
    return /^[a-z0-9_]+$/i.test(query.replace(/\s/g, ''));
}

function looksLikeDateQuery(query) {
    if (!query) return false;
    const q = query.toLowerCase().trim();
    if (/^(today|yesterday|tomorrow|last week|last month)$/.test(q)) return true;
    if (/^\d+\s+(day|days|week|weeks|month|months)\s+ago$/i.test(q)) return true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return true;
    if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(q)) return true;
    if (/^[a-z]+\s+\d{1,2}(,\s*\d{4})?$/i.test(q)) return true;
    return false;
}

function queryWordCount(query) {
    return String(query || '').trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function getImageDateForRun(img) {
    if (!img) return null;
    if (img.mtime) {
        const d = new Date(img.mtime);
        if (!isNaN(d.getTime())) return d;
    }
    if (img.receipt && img.receipt.length > 0 && img.receipt[0].timestamp) {
        const d = new Date(img.receipt[0].timestamp);
        if (!isNaN(d.getTime())) return d;
    }
    if (img.metadata && img.metadata.date) {
        const d = new Date(img.metadata.date);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

function parseGalleryDateQuery(text) {
    const q = String(text || '').trim().toLowerCase();
    if (!q) return null;
    const now = new Date();
    if (q === 'today') {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (q === 'yesterday') {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (q === 'tomorrow') {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (q === 'last week') {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (q === 'last month') {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 1);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const rel = q.match(/^(\d+)\s+(day|days|week|weeks|month|months)\s+ago$/i);
    if (rel) {
        const n = parseInt(rel[1], 10);
        const unit = rel[2].toLowerCase();
        const d = new Date(now);
        if (unit.startsWith('day')) d.setDate(d.getDate() - n);
        else if (unit.startsWith('week')) d.setDate(d.getDate() - n * 7);
        else if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
        const d = new Date(q + 'T00:00:00');
        return isNaN(d.getTime()) ? null : d;
    }
    const slash = q.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (slash) {
        const month = parseInt(slash[1], 10) - 1;
        const day = parseInt(slash[2], 10);
        let year = slash[3] ? parseInt(slash[3], 10) : now.getFullYear();
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        return isNaN(d.getTime()) ? null : d;
    }
    const named = q.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i);
    if (named) {
        const d = new Date(`${named[1]} ${named[2]}, ${named[3] || now.getFullYear()}`);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function mapTrueIndexToDisplayIndex(trueIndex) {
    if (typeof window.filteredImageIndices !== 'undefined' && Array.isArray(window.filteredImageIndices)) {
        const filteredPos = window.filteredImageIndices.indexOf(trueIndex);
        if (filteredPos !== -1) return filteredPos;
    }
    return trueIndex;
}

function findGalleryIndexForDate(targetDate) {
    const source = typeof allImages !== 'undefined' ? allImages : [];
    if (!source.length || !targetDate) return -1;
    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    for (let i = 0; i < source.length; i++) {
        const d = getImageDateForRun(source[i]);
        if (!d || isNaN(d.getTime())) continue;
        if (d >= start && d < end) {
            return mapTrueIndexToDisplayIndex(i);
        }
    }
    for (let i = 0; i < source.length; i++) {
        const d = getImageDateForRun(source[i]);
        if (!d || isNaN(d.getTime())) continue;
        if (d < start) {
            return mapTrueIndexToDisplayIndex(i);
        }
    }
    return 0;
}

function resolveTextReplacementValue(key) {
    const map = window.optionsData && window.optionsData.textReplacements;
    if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return '';
    const val = map[key];
    if (Array.isArray(val)) {
        return val.map((v) => (typeof v === 'string' ? v : (v && v.value) || '')).filter(Boolean).join(', ');
    }
    return val !== undefined && val !== null ? String(val) : '';
}

function getTextReplacementSearchBlob(key) {
    const body = resolveTextReplacementValue(key);
    return `${key} ${body}`.toLowerCase();
}

function pasteRunTagIntoPrompt(target, tagName) {
    if (!target || !tagName) return;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;
    const textBefore = currentValue.substring(0, cursorPosition);
    const textAfter = currentValue.substring(cursorPosition);

    let prefix = '';
    if (textBefore.trim().length > 0) {
        const atEmphasisStart = typeof isAtStartOfEmphasisGroup === 'function'
            && isAtStartOfEmphasisGroup(currentValue, cursorPosition);
        if (!atEmphasisStart) {
            if (!textBefore.trim().endsWith(',')) prefix = ', ';
            else if (textBefore.endsWith(',') && !textBefore.endsWith(', ')) prefix = ' ';
        }
    }

    let suffix = '';
    if (textAfter.trim().length > 0) {
        const beforeClosingEmphasis = typeof isAtEndOfEmphasisGroupBefore === 'function'
            && isAtEndOfEmphasisGroupBefore(currentValue, cursorPosition);
        if (!beforeClosingEmphasis) suffix = ', ';
    }

    const newValue = textBefore + prefix + tagName + suffix + textAfter;
    setTextareaValuePreservingUndo(target, newValue);
    const newCursorPosition = cursorPosition + prefix.length + tagName.length + suffix.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(target);
    if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(target);
}

function pasteRunTextIntoPrompt(target, text) {
    if (!target || !text) return;
    if (typeof injectAutocompleteSuggestionAtCursor === 'function') {
        injectAutocompleteSuggestionAtCursor(target, text);
        return;
    }
    const cursor = target.selectionStart || 0;
    replaceTextareaRangePreservingUndo(target, cursor, cursor, text);
    target.setSelectionRange(cursor + text.length, cursor + text.length);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(target);
    if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(target);
}

function runPrefixedSearchBlocksAsync(categoryHint) {
    return categoryHint && RUN_SCOPED_PREFIX_HINTS.has(categoryHint);
}

async function getRunNaxGalleriesCached() {
    const now = Date.now();
    if (runNaxGalleriesCache && now - runNaxGalleriesCacheTime < 60000) {
        return runNaxGalleriesCache;
    }
    if (!window.wsClient || !window.wsClient.isConnected()) {
        return [];
    }
    try {
        const data = await window.wsClient.sendMessage('get_nax_galleries', {}, false);
        runNaxGalleriesCache = (data && data.galleries) || [];
        runNaxGalleriesCacheTime = now;
    } catch (err) {
        console.warn('Run: NAX galleries load failed', err);
        runNaxGalleriesCache = [];
    }
    return runNaxGalleriesCache;
}

async function openRunNaxtGallerySearch(gallerySlug, query) {
    // naxtApplet: public/scripts/comp/naxtApplet.js
    if (!window.naxtApplet) {
        showGlassToast('info', 'Run', 'Atelier is not available', false, 2500);
        return;
    }
    const wasHidden = !window.naxtApplet.modal || window.naxtApplet.modal.classList.contains('hidden');
    if (wasHidden) {
        await window.naxtApplet.open();
    } else {
        await window.naxtApplet.ensureGalleries();
    }
    const state = window.naxtApplet.getBrowseState();
    state.gallerySlug = gallerySlug || state.gallerySlug;
    state.query = query || '';
    window.naxtApplet.applyBrowseState(state);
    await window.naxtApplet.reloadFromTop(false);
}

function buildRunDatasetTagEntry(result, promptTarget) {
    const tag = result.tag || '';
    const pathLabel = (result.paths && result.paths[0]) ? result.paths[0].join(' → ') : 'Dataset';
    return {
        id: `dataset-${tag}`,
        category: 'dataset-tag',
        label: tag,
        subtitle: pathLabel,
        icon: RUN_CATEGORY_ICONS['dataset-tag'],
        keywords: [tag, pathLabel],
        refocusTarget: promptTarget || null,
        execute: async () => {
            const target = getRunPromptInsertTarget();
            if (target) {
                pasteRunTagIntoPrompt(target, tag);
                return;
            }
            showGlassToast('info', 'Run', 'Open a prompt field to insert dataset tags', false, 3000);
        }
    };
}

function buildRunNaxtTagEntry(item, gallery, categoryHint) {
    const tag = item.tag || '';
    const gallerySlug = gallery.slug || '';
    const isArtist = String(gallerySlug).toLowerCase().includes('artist');
    const category = (categoryHint === 'naxt-artist' || isArtist) ? 'naxt-artist' : 'naxt-tag';
    // naxtGalleryBucketLabel, naxtFormatTagFragment: public/scripts/comp/naxtApplet.js
    const galleryLabel = typeof naxtGalleryBucketLabel === 'function'
        ? naxtGalleryBucketLabel(gallerySlug, [gallery])
        : (gallery.name || gallerySlug);
    return {
        id: `naxt-${gallerySlug}-${tag}`,
        category,
        label: tag,
        subtitle: galleryLabel,
        icon: RUN_CATEGORY_ICONS[category],
        keywords: [tag, galleryLabel, gallerySlug],
        naxGallerySlug: gallerySlug,
        execute: async () => {
            const target = getRunPromptInsertTarget();
            if (target && typeof naxtFormatTagFragment === 'function') {
                pasteRunTagIntoPrompt(target, naxtFormatTagFragment(tag, gallerySlug));
                return;
            }
            await openRunNaxtGallerySearch(gallerySlug, tag);
        }
    };
}

async function fetchRunDatasetTagEntries(query, categoryHint, generation, inPrompt) {
    if (!query || query.length < 1) return [];
    if (runPrefixedSearchBlocksAsync(categoryHint)) return [];
    if (inPrompt && categoryHint !== 'dataset-tag') return [];
    if (!window.wsClient || !window.wsClient.isConnected()) return [];

    try {
        const tagResult = await window.wsClient.searchTags(query, false);
        if (generation !== runSearchGeneration) return [];
        const tags = (tagResult && tagResult.results) ? tagResult.results : [];
        const promptTarget = getRunPromptInsertTarget();
        const entries = tags.slice(0, 8).map((result) => buildRunDatasetTagEntry(result, promptTarget));
        return tagNetworkResults(scoreAndFilterEntries(entries, query, categoryHint, 15));
    } catch (err) {
        console.warn('Run: dataset tag search failed', err);
        return [];
    }
}

async function fetchRunNaxtTagEntries(query, categoryHint, generation) {
    if (!query || query.length < 1) return [];
    if (runPrefixedSearchBlocksAsync(categoryHint)) return [];
    const isArtistHint = categoryHint === 'naxt-artist';
    const isNaxtHint = categoryHint === 'naxt-tag';
    const minLen = (isArtistHint || isNaxtHint) ? 1 : 2;
    if (query.length < minLen) return [];
    if (!window.wsClient || !window.wsClient.isConnected()) return [];

    const galleries = await getRunNaxGalleriesCached();
    if (generation !== runSearchGeneration) return [];
    if (!galleries.length) return [];

    let galleriesToSearch = galleries;
    if (isArtistHint) {
        galleriesToSearch = galleries.filter((g) => String(g.slug || '').toLowerCase().includes('artist'));
    } else if (!isNaxtHint) {
        galleriesToSearch = galleries.filter((g) => String(g.slug || '').toLowerCase().includes('artist'));
    }
    const maxGalleries = isNaxtHint ? 6 : 3;
    galleriesToSearch = galleriesToSearch.slice(0, maxGalleries);

    const entries = [];
    for (const gallery of galleriesToSearch) {
        if (generation !== runSearchGeneration) return [];
        try {
            const data = await window.wsClient.sendMessage('get_nax_tags', {
                gallerySlug: gallery.slug,
                query,
                sort: 'score',
                markFilter: 'all',
                offset: 0,
                limit: 5
            }, false);
            if (generation !== runSearchGeneration) return [];
            ((data && data.items) || []).forEach((item) => {
                if (!item || !item.tag) return;
                entries.push(buildRunNaxtTagEntry(item, gallery, categoryHint));
            });
        } catch (err) {
            console.warn('Run: NAX tag search failed', gallery.slug, err);
        }
    }

    return tagNetworkResults(scoreAndFilterEntries(entries, query, categoryHint, 15));
}

async function ensureGalleryReadyForRun() {
    if (typeof isGalleryWindowHidden === 'function' && isGalleryWindowHidden()) {
        if (typeof showGalleryWindow === 'function') showGalleryWindow();
    }
    if (typeof currentGalleryView !== 'undefined' && currentGalleryView !== 'images' && typeof switchGalleryView === 'function') {
        await switchGalleryView('images');
    }
}

function applyRunAppAliases(entries) {
    const byLaunchId = new Map();
    entries.forEach((e) => {
        if (e.launchId) byLaunchId.set(e.launchId, e);
    });
    RUN_APP_ALIAS_GROUPS.forEach((group) => {
        group.launchIds.forEach((launchId) => {
            const entry = byLaunchId.get(launchId);
            if (!entry) return;
            const extra = group.aliases || [];
            entry.keywords = [...new Set([...(entry.keywords || []), ...extra])];
        });
    });
    return entries;
}

function getDesktopShortcutsList() {
    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts && Array.isArray(desktopShortcuts.shortcuts)) {
        return desktopShortcuts.shortcuts;
    }
    return [];
}

function buildRunAppEntries() {
    const entries = [];
    if (typeof collectStartMenuLaunchables === 'function') {
        collectStartMenuLaunchables().forEach((item) => {
            entries.push({
                id: `app-${item.launchId || item.label}`,
                category: 'app',
                launchId: item.launchId,
                label: item.label,
                subtitle: item.subtitle || 'Application',
                icon: item.icon || RUN_CATEGORY_ICONS.app,
                keywords: item.keywords || [],
                execute: item.execute
            });
        });
    }
    applyRunAppAliases(entries);
    return entries;
}

function buildRunWorkspaceEntries() {
    const entries = [];
    const workspacesData = typeof workspaces !== 'undefined' ? workspaces : (window.workspaces || {});
    Object.values(workspacesData).forEach((ws) => {
        if (!ws || !ws.id) return;
        entries.push({
            id: `ws-${ws.id}`,
            category: 'workspace',
            label: ws.name || ws.id,
            subtitle: 'Workspace',
            icon: RUN_CATEGORY_ICONS.workspace,
            keywords: [ws.name, ws.id],
            execute: async () => {
                if (typeof isDesktopStartMenuEnvironment === 'function' && !isDesktopStartMenuEnvironment()) {
                    showGlassToast('info', 'Run', 'Desktop mode required', false, 2500);
                    return;
                }
                if (typeof setActiveWorkspace === 'function') await setActiveWorkspace(ws.id);
            }
        });
    });
    return entries;
}

function buildRunShortcutOnlyEntries() {
    const entries = [];
    getDesktopShortcutsList().forEach((sc) => {
        if (!sc || !sc.name) return;
        if (RUN_SHORTCUT_MERGE_TYPES.has(sc.type)) return;
        entries.push({
            id: `sc-${sc.id}`,
            category: 'shortcut',
            label: sc.name,
            subtitle: sc.type ? `Shortcut · ${sc.type}` : 'Shortcut',
            icon: RUN_CATEGORY_ICONS.shortcut,
            keywords: [sc.name, sc.type],
            shortcut: sc,
            execute: async () => {
                if (typeof isDesktopStartMenuEnvironment === 'function' && !isDesktopStartMenuEnvironment()) {
                    showGlassToast('info', 'Run', 'Desktop mode required', false, 2500);
                    return;
                }
                desktopShortcuts.handleShortcutClick(sc);
            }
        });
    });
    return entries;
}

function buildRunNoteEntriesFromList(notes, shortcuts) {
    const entries = [];
    const shortcutByNoteId = new Map();
    shortcuts.filter((s) => s.type === 'note' && s.data && s.data.noteId).forEach((sc) => {
        const list = shortcutByNoteId.get(sc.data.noteId) || [];
        list.push(sc.name);
        shortcutByNoteId.set(sc.data.noteId, list);
    });

    notes.forEach((note) => {
        if (!note || !note.id) return;
        const aliasNames = shortcutByNoteId.get(note.id) || [];
        const subtitle = aliasNames.length
            ? `Note · ${aliasNames.join(', ')}`
            : 'Note';
        entries.push({
            id: `note-${note.id}`,
            category: 'note',
            noteId: note.id,
            noteData: { id: note.id, name: note.name, icon: note.icon, color: note.color },
            label: note.name || 'Untitled',
            subtitle,
            icon: RUN_CATEGORY_ICONS.note,
            keywords: [note.name, ...aliasNames].filter(Boolean),
            execute: async () => {
                await window.notepadManager.openExistingNote(note.id);
            }
        });
    });
    return entries;
}

function buildRunReferenceEntries(query) {
    const entries = [];
    const images = typeof cacheImages !== 'undefined' && Array.isArray(cacheImages) ? cacheImages : [];
    const q = query.toLowerCase();
    const shortcuts = getDesktopShortcutsList();
    const shortcutByHash = new Map();
    shortcuts.filter((s) => s.type === 'reference' && s.data && s.data.hash).forEach((sc) => {
        shortcutByHash.set(sc.data.hash, sc.name);
    });

    images.forEach((img) => {
        if (!img || !img.hash) return;
        const filename = img.filename || '';
        const displayName = (img.metadata && img.metadata.displayName) || (img.metadata && img.metadata.display_name) || '';
        const hash = img.hash;
        const shortcutName = shortcutByHash.get(hash);
        const searchTexts = [filename, hash, displayName, shortcutName].filter(Boolean);
        let best = 0;
        searchTexts.forEach((t) => {
            best = Math.max(best, runScoreText(query, t, 'reference', 'reference'));
        });
        if (best < 25 && query.length >= 2) return;

        const label = displayName || filename || hash.slice(0, 12);
        entries.push({
            id: `ref-${hash}`,
            category: 'reference',
            label,
            subtitle: shortcutName ? `Reference · ${shortcutName}` : (filename || 'Reference'),
            icon: RUN_CATEGORY_ICONS.reference,
            keywords: searchTexts,
            score: best,
            cacheImage: img,
            execute: async () => {
                if (typeof loadCacheImages === 'function' && (!cacheImages || !cacheImages.length)) {
                    await loadCacheImages();
                }
                let cacheImage = img;
                if (typeof cacheImages !== 'undefined' && Array.isArray(cacheImages)) {
                    const found = cacheImages.find((c) => c.hash === hash);
                    if (found) cacheImage = found;
                }
                if (typeof openReferenceImageInViewer === 'function') {
                    openReferenceImageInViewer(cacheImage);
                } else if (typeof showCacheManagerModal === 'function') {
                    showCacheManagerModal();
                }
            }
        });
    });
    return entries;
}

function buildRunPresetEntriesFast(query) {
    const entries = [];
    const presetsList = window.optionsData && Array.isArray(window.optionsData.presets)
        ? window.optionsData.presets
        : [];
    presetsList.forEach((p) => {
        const name = p && p.name;
        if (!name) return;
        const score = runScoreText(query, name, 'preset', 'preset');
        if (score < 25) return;
        entries.push(createRunPresetEntry(name, 'Spellbook preset', score));
    });
    return entries;
}

function createRunPresetEntry(presetName, subtitle, score) {
    return {
        id: `preset-${presetName}`,
        category: 'preset',
        presetName,
        label: presetName,
        subtitle: subtitle || 'Spellbook preset',
        icon: RUN_CATEGORY_ICONS.preset,
        keywords: [presetName],
        score,
        execute: async () => {
            if (window.spellbookModalManager) {
                window.spellbookModalManager.openModal();
                window.spellbookModalManager.selectPreset(presetName);
            } else if (typeof showPresetManager === 'function') {
                showPresetManager();
            }
        }
    };
}

function buildRunTextReplacementEntries(query) {
    const entries = [];
    const promptTarget = getRunPromptInsertTarget();
    if (!promptTarget || !query) return entries;

    const map = window.optionsData && window.optionsData.textReplacements;
    if (!map) return entries;

    const qLower = query.toLowerCase();

    Object.keys(map).forEach((key) => {
        const displayKey = key.startsWith('!') ? key : `!${key}`;
        const blob = getTextReplacementSearchBlob(key);
        let best = Math.max(
            runScoreText(query, key, 'text-replacement', 'text-replacement'),
            runScoreText(query, displayKey, 'text-replacement', 'text-replacement')
        );
        if (blob.includes(qLower)) best = Math.max(best, 55);
        if (best < 20) return;

        entries.push({
            id: `tr-${key}`,
            category: 'text-replacement',
            label: displayKey,
            subtitle: 'Expander',
            icon: RUN_CATEGORY_ICONS['text-replacement'],
            keywords: [key, displayKey],
            score: best,
            refocusTarget: promptTarget,
            execute: async () => {
                const target = getRunPromptInsertTarget();
                if (!target) {
                    showGlassToast('info', 'Run', 'No prompt field to paste into', false, 2500);
                    return;
                }
                const plainKey = key.replace(/^!/, '');
                const expanded = resolveTextReplacementValue(plainKey) || resolveTextReplacementValue(key);
                pasteRunTextIntoPrompt(target, expanded || displayKey);
            }
        });
    });

    return entries;
}

function buildRunGalleryDateEntry(query, categoryHint) {
    const parsedDate = parseGalleryDateQuery(query);
    if (!parsedDate || !(looksLikeDateQuery(query) || categoryHint === 'gallery-date')) return null;
    const label = query.charAt(0).toUpperCase() + query.slice(1);
    return {
        id: `gallery-date-${query}`,
        category: 'gallery-date',
        label: `Jump to ${label}`,
        subtitle: parsedDate.toLocaleDateString(),
        icon: RUN_CATEGORY_ICONS['gallery-date'],
        keywords: [query],
        score: 80,
        execute: async () => {
            await ensureGalleryReadyForRun();
            const idx = findGalleryIndexForDate(parsedDate);
            if (idx >= 0 && typeof displayGalleryFromStartIndex === 'function') {
                await displayGalleryFromStartIndex(idx, true);
            }
        }
    };
}

function buildRunGalleryTagEntry(query, categoryHint, inPrompt) {
    const tagLike = looksLikeTagQuery(query);
    if (inPrompt || !query || !(tagLike || categoryHint === 'gallery-tag')) return null;
    return {
        id: `gallery-tag-${query}`,
        category: 'gallery-tag',
        label: `Gallery: ${query}`,
        tagName: query,
        subtitle: 'Search by tags',
        icon: RUN_CATEGORY_ICONS['gallery-tag'],
        keywords: [query],
        score: 45,
        execute: async () => {
            await enterGallerySearchMode(query);
        }
    };
}

const RUN_TAG_CATEGORIES = new Set([
    'quick-access',
    'gallery-tag',
    'dataset-tag',
    'naxt-tag',
    'naxt-artist',
    'wiki'
]);

function isRunTagEntry(entry) {
    return Boolean(entry && RUN_TAG_CATEGORIES.has(entry.category));
}

function getRunEntryTagName(entry) {
    if (!entry) return '';
    if (entry.tagName) return String(entry.tagName).trim();
    if (entry.category === 'gallery-tag') {
        return String(entry.label || '').replace(/^Gallery:\s*/i, '').trim();
    }
    return String(entry.label || '').trim();
}

function getRunEntryTagText(entry) {
    const name = getRunEntryTagName(entry);
    if (!name) return '';
    if ((entry.category === 'naxt-tag' || entry.category === 'naxt-artist') && entry.naxGallerySlug
        && typeof naxtFormatTagFragment === 'function') {
        return naxtFormatTagFragment(name, entry.naxGallerySlug);
    }
    return name;
}

async function copyRunTagText(text) {
    const tag = String(text || '').trim();
    if (!tag) return;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(tag);
        } else {
            throw new Error('Clipboard unavailable');
        }
        showGlassToast('success', 'Run', 'Tag copied', false, 2000, '<i class="fas fa-copy"></i>');
    } catch (err) {
        showGlassToast('error', 'Run', 'Failed to copy tag', false, 3000);
    }
}

async function runAppendTagToPhasewalkerStep(tagText, keyword, stepIndex, field, createNew) {
    const add = String(tagText || '').trim();
    if (!add) return;
    // bracketGenEnsureStepStateReady, bracketGenerationApplet: public/scripts/comp/bracketGenerationApplet.js
    if (typeof bracketGenEnsureStepStateReady !== 'function' || !bracketGenEnsureStepStateReady()) {
        showGlassToast('info', 'Run', 'Configure Phasewalker keywords first', false, 2500);
        return;
    }
    const applet = bracketGenerationApplet;
    if (!applet) return;
    const kw = String(keyword || '').trim();
    if (!kw) return;
    const f = field === 'uc' ? 'uc' : 'prompt';
    let idx = stepIndex;
    if (createNew) {
        if (applet.saveStepTextareasToState) applet.saveStepTextareasToState();
        if (applet.saveStepNamesFromInputs) applet.saveStepNamesFromInputs();
        await applet.addStep();
        idx = applet.getMaxStepCount() - 1;
    }
    if (applet.appendTextToStep(kw, idx, f, add)) {
        const stepLabel = applet.getStepDisplayName ? applet.getStepDisplayName(idx) : `Step ${idx + 1}`;
        showGlassToast('success', 'Phasewalker', `Added to ${kw} · ${stepLabel}`, false, 2500, '<i class="fas fa-layer-group"></i>');
    }
}

function openPhasewalkerEditor() {
    if (window.bracketGenerationApplet) {
        window.bracketGenerationApplet.open();
        return;
    }
    const modal = document.getElementById('bracketGenerationModal');
    if (modal && typeof openModal === 'function') openModal(modal);
}

function buildPhasewalkerContextSubmenuItems(tagText, options) {
    const opts = options || {};
    const field = opts.field || 'prompt';
    const stepAction = opts.stepAction || 'run-phasewalker-step';
    const newStepAction = opts.newStepAction || 'run-phasewalker-new-step';
    const openEditorAction = opts.openEditorAction || 'run-phasewalker-open-editor';
    const newPrefixAction = opts.newPrefixAction || 'run-phasewalker-new-prefix';
    const text = String(tagText || '').trim();
    const items = [];
    const menuData = typeof bracketGenGetStepMenuData === 'function' ? bracketGenGetStepMenuData() : null;

    if (typeof buildRunPhasewalkerContextMenuOptions === 'function' && menuData) {
        const pwItems = buildRunPhasewalkerContextMenuOptions(text);
        pwItems.forEach((item) => {
            if (item.separator || item.disabled) {
                items.push(item);
                return;
            }
            if (item.action === 'run-phasewalker-step') {
                items.push({
                    ...item,
                    icon: field === 'uc' ? 'fas fa-minus' : 'fas fa-plus',
                    action: stepAction,
                    data: { ...item.data, field, text, tagText: text }
                });
                return;
            }
            if (item.action === 'run-phasewalker-new-step') {
                items.push({
                    ...item,
                    icon: 'fas fa-plus-circle',
                    action: newStepAction,
                    data: { ...item.data, field, text, tagText: text }
                });
                return;
            }
            items.push(item);
        });
    } else {
        items.push({
            text: 'New Prefix & Step',
            icon: 'fas fa-plus-circle',
            action: newPrefixAction,
            data: { field, text, tagText: text }
        });
    }
    if (items.length > 0) {
        items.push({ separator: true });
    }
    items.push({
        text: 'Open Editor',
        icon: 'fas fa-window-restore',
        action: openEditorAction
    });
    return items;
}

function handlePhasewalkerContextSubmenuAction(subItem, options) {
    const opts = options || {};
    const data = subItem && subItem.data;
    const action = subItem && subItem.action;
    const stepAction = opts.stepAction || 'run-phasewalker-step';
    const newStepAction = opts.newStepAction || 'run-phasewalker-new-step';
    const openEditorAction = opts.openEditorAction || 'run-phasewalker-open-editor';
    const newPrefixAction = opts.newPrefixAction || 'run-phasewalker-new-prefix';
    const text = (data && (data.text || data.tagText)) || '';

    if (action === openEditorAction) {
        openPhasewalkerEditor();
        return;
    }
    if (action === newPrefixAction) {
        openPhasewalkerEditor();
        const applet = window.bracketGenerationApplet;
        if (applet && applet.promptAddKeyword) {
            void applet.promptAddKeyword();
        }
        return;
    }
    if (action === stepAction || action === 'run-phasewalker-step') {
        if (data && text) {
            runAppendTagToPhasewalkerStep(text, data.keyword, data.stepIndex, data.field, false);
        }
        return;
    }
    if (action === newStepAction || action === 'run-phasewalker-new-step') {
        if (data && text) {
            runAppendTagToPhasewalkerStep(text, data.keyword, null, data.field, true);
        }
    }
}

function buildRunPhasewalkerContextMenuOptions(tagText) {
    // bracketGenGetStepMenuData: public/scripts/comp/bracketGenerationApplet.js
    const menuData = typeof bracketGenGetStepMenuData === 'function' ? bracketGenGetStepMenuData() : null;
    if (!menuData) {
        return [{ text: 'No Phasewalker keywords configured', disabled: true }];
    }
    const field = 'prompt';
    const items = [];
    menuData.keywords.forEach((kw) => {
        items.push({ separator: true, text: kw });
        const steps = menuData.keywordSteps[kw] || [];
        steps.forEach((step, index) => {
            items.push({
                text: menuData.stepLabel(index),
                icon: 'fas fa-plus',
                action: 'run-phasewalker-step',
                data: { keyword: kw, stepIndex: index, field, tagText }
            });
        });
        items.push({
            text: 'New Step',
            icon: 'fas fa-plus-circle',
            action: 'run-phasewalker-new-step',
            data: { keyword: kw, field, tagText }
        });
    });
    return items.length ? items : [{ text: 'No steps', disabled: true }];
}

function buildRunPhasewalkerFlatActionItems(tagText) {
    const menuData = typeof bracketGenGetStepMenuData === 'function' ? bracketGenGetStepMenuData() : null;
    if (!menuData) {
        return [{
            icon: 'fas fa-layer-group',
            text: 'Add a Phasewalker keyword first',
            action: 'noop',
            disabled: true
        }];
    }
    const field = 'prompt';
    const items = [];
    menuData.keywords.forEach((kw) => {
        items.push({ header: true, text: kw });
        const steps = menuData.keywordSteps[kw] || [];
        steps.forEach((step, index) => {
            items.push({
                icon: 'fas fa-plus',
                text: menuData.stepLabel(index),
                action: 'phasewalker-step',
                data: { keyword: kw, stepIndex: index, field, tagText }
            });
        });
        items.push({
            icon: 'fas fa-plus-circle',
            text: 'New Step',
            action: 'phasewalker-new-step',
            data: { keyword: kw, field, tagText }
        });
    });
    return items;
}

function buildRunTagActionItems(entry) {
    const tagText = getRunEntryTagText(entry);
    const items = [
        { icon: 'fas fa-copy', text: 'Copy Tag', action: 'copy-tag' },
        { icon: 'fas fa-star', text: 'Add to Favorites', action: 'favorite' }
    ];
    const stepItems = buildRunPhasewalkerFlatActionItems(tagText);
    if (stepItems.length) {
        items.push({ header: true, text: 'Phasewalker' });
        items.push(...stepItems);
    }
    return items;
}

async function handleRunTagAction(action, item, entry) {
    const tagName = getRunEntryTagName(entry);
    const tagText = getRunEntryTagText(entry);
    switch (action) {
        case 'copy-tag':
            await copyRunTagText(tagText);
            return true;
        case 'favorite':
            // showAddToFavoritesDialog: public/scripts/comp/autocompleteUtils.js
            if (showAddToFavoritesDialog) await showAddToFavoritesDialog(tagName);
            return true;
        case 'phasewalker-step':
            await runAppendTagToPhasewalkerStep(
                (item && item.data && item.data.tagText) || tagText,
                item && item.data && item.data.keyword,
                item && item.data && item.data.stepIndex,
                item && item.data && item.data.field,
                false
            );
            return true;
        case 'phasewalker-new-step':
            await runAppendTagToPhasewalkerStep(
                (item && item.data && item.data.tagText) || tagText,
                item && item.data && item.data.keyword,
                null,
                item && item.data && item.data.field,
                true
            );
            return true;
        case 'noop':
            return true;
        default:
            return false;
    }
}

function createRunTagActionMenu(entry, extraItems, extraOnAction) {
    const items = [...buildRunTagActionItems(entry)];
    if (extraItems && extraItems.length) {
        items.push(...extraItems);
    }
    return {
        sections: [{ type: 'list', items }],
        onAction: async (action, item) => {
            if (await handleRunTagAction(action, item, entry)) return;
            if (extraOnAction) await extraOnAction(action, item);
        }
    };
}

function scoreAndFilterEntries(entries, query, categoryHint, minScore) {
    const scored = [];
    entries.forEach((entry) => {
        const score = entry.score != null ? entry.score : runScoreEntry(query, entry, categoryHint);
        const threshold = minScore != null ? minScore : 25;
        if (score >= threshold || entry.category === 'gallery-date' || entry.category === 'gallery-tag') {
            scored.push({ ...entry, score });
        }
    });
    return scored;
}

function tagNetworkResults(entries) {
    return (entries || []).map((entry) => ({ ...entry, isNetworkResult: true }));
}

/** Max entries per category in balanced local/network slices */
const RUN_CATEGORY_SLOT_CAP = {
    'text-replacement': 4,
    'quick-access': 4,
    'dataset-tag': 4,
    'naxt-tag': 4,
    'naxt-artist': 4,
    wiki: 4,
    note: 3,
    preset: 3,
    reference: 3,
    app: 5,
    workspace: 3,
    shortcut: 2,
    'gallery-tag': 1,
    'gallery-date': 1
};

function getRunCategorySlotCap(category) {
    return RUN_CATEGORY_SLOT_CAP[category] != null ? RUN_CATEGORY_SLOT_CAP[category] : 4;
}

/**
 * Round-robin merge so one category cannot fill the list before others get a slot.
 * Categories with higher top scores are visited first each round.
 */
function balanceRunResultsByCategory(entries, cap) {
    if (!entries || !entries.length || cap <= 0) return [];

    const groups = new Map();
    entries.forEach((entry) => {
        const cat = entry.category || 'other';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(entry);
    });

    groups.forEach((list, cat) => {
        list.sort((a, b) => b.score - a.score);
        groups.set(cat, list.slice(0, getRunCategorySlotCap(cat)));
    });

    const categoryOrder = [...groups.keys()].sort((a, b) => {
        return (groups.get(b)[0]?.score || 0) - (groups.get(a)[0]?.score || 0);
    });

    const pointers = new Map(categoryOrder.map((c) => [c, 0]));
    const out = [];
    while (out.length < cap) {
        let addedAny = false;
        for (const cat of categoryOrder) {
            const list = groups.get(cat);
            const idx = pointers.get(cat);
            if (idx < list.length) {
                out.push(list[idx]);
                pointers.set(cat, idx + 1);
                addedAny = true;
                if (out.length >= cap) break;
            }
        }
        if (!addedAny) break;
    }
    return out;
}

function mergeRunResults(scoredLists, limit) {
    const byId = new Map();
    scoredLists.forEach((list) => {
        list.forEach((entry) => {
            const existing = byId.get(entry.id);
            if (!existing || entry.score > existing.score) {
                byId.set(entry.id, entry);
            }
        });
    });
    const merged = Array.from(byId.values());
    const pinned = [];
    const network = [];
    const local = [];
    merged.forEach((entry) => {
        if (entry.pinnedBottom || entry.category === 'network-deferred') {
            pinned.push(entry);
        } else if (entry.isNetworkResult || entry.category === 'wiki') {
            network.push(entry);
        } else {
            local.push(entry);
        }
    });
    pinned.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const cap = limit || 14;
    const pinnedCount = pinned.length;
    const networkSlotCap = Math.min(network.length, Math.max(3, cap - pinnedCount - 4));
    const networkBalanced = balanceRunResultsByCategory(network, networkSlotCap);
    const localCap = Math.max(0, cap - pinnedCount - networkBalanced.length);
    const localBalanced = balanceRunResultsByCategory(local, localCap);
    return [...localBalanced, ...networkBalanced, ...pinned].slice(0, cap);
}

function shouldDeferRunNetworkSearch() {
    if (!window.wsClient || !window.wsClient.isConnected()) return true;
    // shouldShowPingWarning: public/scripts/websocket.js (pingWarningIndicator)
    if (typeof window.wsClient.shouldShowPingWarning === 'function' && window.wsClient.shouldShowPingWarning()) {
        return true;
    }
    return false;
}

function buildRunDeferredNetworkEntry(query) {
    return {
        id: 'run-deferred-network',
        category: 'network-deferred',
        label: 'Search online sources…',
        subtitle: 'Slow network — press Enter to search',
        icon: 'fas fa-cloud-arrow-down',
        keywords: [query],
        pinnedBottom: true,
        sortOrder: 0,
        score: 1,
        isDeferredNetwork: true,
        deferredQuery: query,
        execute: null
    };
}

async function enterGallerySearchMode(query) {
    await ensureGalleryReadyForRun();
    const searchContainer = document.querySelector('#main-menu-bar .file-search-container')
        || document.querySelector('.file-search-container');
    if (searchContainer && searchContainer.classList.contains('closed')) {
        if (typeof toggleSearchContainer === 'function') {
            toggleSearchContainer();
        }
    }
    const searchInput = document.getElementById('fileSearchInput');
    if (window.fileSearch) {
        await window.fileSearch.initializeSearchIfNeeded();
        if (searchInput) {
            searchInput.value = query;
            searchInput.disabled = false;
        }
        await window.fileSearch.performSearch(query);
    }
    if (typeof displayGalleryFromStartIndex === 'function') {
        await displayGalleryFromStartIndex(0, true);
    }
}

function buildRunStaticEntries() {
    return [
        ...buildRunAppEntries(),
        ...buildRunWorkspaceEntries(),
        ...buildRunShortcutOnlyEntries()
    ];
}

async function getRunNoteEntriesCached() {
    const now = Date.now();
    if (!runNoteCache || now - runNoteCacheTime > 30000) {
        const wsId = typeof activeWorkspace !== 'undefined' ? activeWorkspace : (window.activeWorkspace || 'default');
        const shortcuts = getDesktopShortcutsList();
        if (window.notepadManager && typeof window.notepadManager.getNotesArray === 'function') {
            try {
                const notes = await window.notepadManager.getNotesArray(wsId);
                runNoteCache = buildRunNoteEntriesFromList(notes, shortcuts);
            } catch (err) {
                console.warn('Run: failed to load notes', err);
                runNoteCache = [];
            }
        } else {
            runNoteCache = [];
        }
        runNoteCacheTime = now;
    }
    return runNoteCache;
}

function searchRunCommandsFast(rawQuery) {
    const { query, categoryHint } = normalizeRunQuery(rawQuery);
    if (!query) return [];

    const inPrompt = Boolean(getRunPromptInsertTarget());
    const lists = [];

    if (!runStaticCache) runStaticCache = buildRunStaticEntries();
    lists.push(scoreAndFilterEntries(runStaticCache, query, categoryHint));

    if (runNoteCache) {
        lists.push(scoreAndFilterEntries(runNoteCache, query, categoryHint));
    }

    lists.push(scoreAndFilterEntries(buildRunReferenceEntries(query), query, categoryHint, 20));
    lists.push(scoreAndFilterEntries(buildRunPresetEntriesFast(query), query, categoryHint, 20));

    const dateEntry = buildRunGalleryDateEntry(query, categoryHint);
    if (dateEntry) lists.push([dateEntry]);

    const tagEntry = buildRunGalleryTagEntry(query, categoryHint, inPrompt);
    if (tagEntry) lists.push([tagEntry]);

    if (inPrompt) {
        lists.push(scoreAndFilterEntries(buildRunTextReplacementEntries(query), query, categoryHint, 20));
    }

    return mergeRunResults(lists, 14);
}

async function fetchRunAsyncEntries(query, categoryHint, generation) {
    const asyncLists = [];
    const inPrompt = Boolean(getRunPromptInsertTarget());
    const wsId = typeof activeWorkspace !== 'undefined' ? activeWorkspace : (window.activeWorkspace || 'default');

    if (window.tagWikiSearchModal && typeof window.tagWikiSearchModal.searchTagWiki === 'function' && query.length >= 1) {
        try {
            const wikiResults = await window.tagWikiSearchModal.searchTagWiki(query, { limit: 8 });
            if (generation !== runSearchGeneration) return [];
            const wikiEntries = [];
            (wikiResults || []).slice(0, 6).forEach((result, idx) => {
                const name = result.title || result.name || result.tag || query;
                wikiEntries.push({
                    id: `wiki-${name}`,
                    category: 'wiki',
                    label: name,
                    subtitle: result.hasWiki ? 'Grimoire' : 'Search Grimoire',
                    icon: RUN_CATEGORY_ICONS.wiki,
                    keywords: [name],
                    execute: async () => {
                        if (!window.tagWikiSearchModal) return;
                        const opened = await window.tagWikiSearchModal.openStandaloneWikiIfDirectMatch(name);
                        if (!opened) {
                            window.tagWikiSearchModal.openSearchForTerm(name);
                        }
                    }
                });
            });
            asyncLists.push(scoreAndFilterEntries(wikiEntries, query, categoryHint, 15));
        } catch (err) {
            console.warn('Run: wiki search failed', err);
        }
    }

    if (inPrompt && query.length >= 1 && categoryHint !== 'dataset-tag' && window.wsClient && window.wsClient.isConnected()) {
        try {
            const tagResult = await window.wsClient.searchTags(query, false);
            if (generation !== runSearchGeneration) return [];
            const tags = (tagResult && tagResult.results) ? tagResult.results : [];
            const qaEntries = [];
            const promptTarget = getRunPromptInsertTarget();
            tags.slice(0, 8).forEach((tag, idx) => {
                const name = typeof tag === 'string' ? tag : (tag.name || tag.tag || '');
                if (!name) return;
                qaEntries.push({
                    id: `qa-${name}`,
                    category: 'quick-access',
                    label: name,
                    subtitle: 'Tag',
                    icon: RUN_CATEGORY_ICONS['quick-access'],
                    keywords: [name],
                    refocusTarget: promptTarget,
                    execute: async () => {
                        const target = getRunPromptInsertTarget();
                        if (!target) {
                            showGlassToast('info', 'Run', 'No prompt field to paste into', false, 2500);
                            return;
                        }
                        pasteRunTagIntoPrompt(target, name);
                    }
                });
            });
            asyncLists.push(tagNetworkResults(scoreAndFilterEntries(qaEntries, query, categoryHint, 15)));
        } catch (err) {
            console.warn('Run: quick access tag search failed', err);
        }
    }

    const datasetEntries = await fetchRunDatasetTagEntries(query, categoryHint, generation, inPrompt);
    if (datasetEntries.length) asyncLists.push(datasetEntries);

    const naxtEntries = await fetchRunNaxtTagEntries(query, categoryHint, generation);
    if (naxtEntries.length) asyncLists.push(naxtEntries);

    if (window.wsClient && window.wsClient.isConnected() && query.length >= 2) {
        try {
            const presetResp = await window.wsClient.getPresets(1, 30, query);
            if (generation !== runSearchGeneration) return [];
            const presets = (presetResp && presetResp.presets)
                ? presetResp.presets
                : ((presetResp && presetResp.data && presetResp.data.presets) ? presetResp.data.presets : {});
            const presetEntries = [];
            Object.keys(presets).forEach((name) => {
                const p = presets[name];
                let score = runScoreText(query, name, 'preset', 'preset');
                const promptText = p && (p.prompt || p.uc || '');
                if (promptText && String(promptText).toLowerCase().includes(query.toLowerCase())) {
                    score = Math.max(score, 50);
                }
                presetEntries.push(createRunPresetEntry(name, 'Spellbook preset', score));
            });
            asyncLists.push(tagNetworkResults(scoreAndFilterEntries(presetEntries, query, categoryHint, 20)));
        } catch (err) {
            console.warn('Run: preset search failed', err);
        }
    }

    if (queryWordCount(query) >= 2 && window.wsClient && window.wsClient.isConnected()) {
        try {
            const notesWithContent = await window.wsClient.getNotesByWorkspace(wsId);
            if (generation !== runSearchGeneration) return [];
            const qLower = query.toLowerCase();
            const words = qLower.split(/\s+/).filter(Boolean);
            const contentEntries = [];
            (notesWithContent || []).forEach((note) => {
                if (!note || !note.id) return;
                const content = String(note.content || '').toLowerCase();
                const name = String(note.name || '').toLowerCase();
                if (name.includes(qLower)) return;
                const allWords = words.every((w) => content.includes(w));
                if (!allWords) return;
                contentEntries.push({
                    id: `note-${note.id}`,
                    category: 'note',
                    noteId: note.id,
                    noteData: { id: note.id, name: note.name, icon: note.icon, color: note.color },
                    label: note.name || 'Untitled',
                    subtitle: 'Note · content match',
                    icon: RUN_CATEGORY_ICONS.note,
                    keywords: [note.name, query],
                    score: 48,
                    execute: async () => {
                        await window.notepadManager.openExistingNote(note.id);
                    }
                });
            });
            asyncLists.push(tagNetworkResults(scoreAndFilterEntries(contentEntries, query, categoryHint, 30)));
        } catch (err) {
            console.warn('Run: note content search failed', err);
        }
    }

    return asyncLists;
}

function searchRunCommands(rawQuery, onUpdate) {
    const { query, categoryHint } = normalizeRunQuery(rawQuery);
    if (!query) {
        if (typeof onUpdate === 'function') onUpdate([]);
        return Promise.resolve([]);
    }

    const generation = ++runSearchGeneration;
    const deferNetwork = shouldDeferRunNetworkSearch();

    const pushResults = (lists, includeDeferred) => {
        if (generation !== runSearchGeneration) return;
        const allLists = [...lists];
        if (includeDeferred && deferNetwork) {
            allLists.push([buildRunDeferredNetworkEntry(query)]);
        }
        const merged = mergeRunResults(allLists, 14);
        if (typeof onUpdate === 'function') onUpdate(merged);
    };

    pushResults([searchRunCommandsFast(rawQuery)], deferNetwork);

    if (deferNetwork) {
        return Promise.resolve();
    }

    (async () => {
        await getRunNoteEntriesCached();
        if (generation !== runSearchGeneration) return;
        const fast = searchRunCommandsFast(rawQuery);
        const asyncLists = await fetchRunAsyncEntries(query, categoryHint, generation);
        if (generation !== runSearchGeneration) return;
        pushResults([fast, ...asyncLists], false);
    })();

    return Promise.resolve();
}

async function runFetchNetworkSearch(rawQuery, onUpdate) {
    const { query, categoryHint } = normalizeRunQuery(rawQuery);
    if (!query) {
        if (typeof onUpdate === 'function') onUpdate([]);
        return;
    }
    const generation = ++runSearchGeneration;
    await getRunNoteEntriesCached();
    if (generation !== runSearchGeneration) return;
    const fast = searchRunCommandsFast(rawQuery);
    const asyncLists = await fetchRunAsyncEntries(query, categoryHint, generation);
    if (generation !== runSearchGeneration) return;
    const merged = mergeRunResults([fast, ...asyncLists], 14);
    if (typeof onUpdate === 'function') onUpdate(merged);
}

function getRunEntryActionItems(entry) {
    const menu = getRunEntryActionMenu(entry);
    if (!menu || !menu.sections) return null;
    const items = [];
    menu.sections.forEach((section) => {
        (section.items || []).forEach((item) => {
            if (item.separator) return;
            items.push(item);
        });
    });
    if (!items.length) return null;
    return { items, onAction: menu.onAction };
}

function getRunEntryActionMenu(entry) {
    if (!entry) return null;

    if (entry.category === 'note' && entry.noteData && window.notepadManager) {
        const noteData = entry.noteData;
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        { icon: 'fas fa-sticky-note', text: 'Open', action: 'open' },
                        { icon: 'fas fa-notebook', text: 'Open in Notebook', action: 'notebook' },
                        { icon: 'fas fa-window', text: 'Open in Window', action: 'window' },
                        { separator: true },
                        { icon: 'fas fa-cog', text: 'Modify', action: 'modify' },
                        { icon: 'fas fa-trash', text: 'Delete', action: 'delete', className: 'context-menu-item-danger' }
                    ]
                }
            ],
            onAction: async (action) => {
                switch (action) {
                    case 'open':
                        await window.notepadManager.openExistingNote(noteData.id);
                        break;
                    case 'notebook':
                        await window.notepadManager.openNotebook();
                        await window.notepadManager.notebookLoadNote(noteData.id, false);
                        break;
                    case 'window':
                        await window.notepadManager.openExistingNote(noteData.id);
                        break;
                    case 'modify':
                        await window.notepadManager.notebookModifyNote(noteData.id);
                        break;
                    case 'delete':
                        await window.notepadManager.notebookDeleteNote(noteData.id);
                        break;
                }
            }
        };
    }

    if (entry.category === 'preset' && entry.presetName) {
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        { icon: 'fas fa-book-spells', text: 'Open in Spellbook', action: 'spellbook' },
                        { icon: 'fas fa-list', text: 'Preset Manager', action: 'manager' }
                    ]
                }
            ],
            onAction: async (action) => {
                if (action === 'spellbook' && window.spellbookModalManager) {
                    window.spellbookModalManager.openModal();
                    window.spellbookModalManager.selectPreset(entry.presetName);
                } else if (action === 'manager' && typeof showPresetManager === 'function') {
                    showPresetManager();
                }
            }
        };
    }

    if (entry.category === 'reference' && entry.cacheImage) {
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        { icon: 'fas fa-window', text: 'Open in Window', action: 'viewer' },
                        { icon: 'fas fa-swatchbook', text: 'Reference Manager', action: 'manager' }
                    ]
                }
            ],
            onAction: async (action) => {
                if (action === 'viewer' && typeof openReferenceImageInViewer === 'function') {
                    openReferenceImageInViewer(entry.cacheImage);
                } else if (action === 'manager' && typeof showCacheManagerModal === 'function') {
                    showCacheManagerModal();
                }
            }
        };
    }

    if (isRunTagEntry(entry)) {
        const extraItems = entry.category === 'wiki'
            ? [
                { header: true, text: 'Grimoire' },
                { icon: 'fas fa-window', text: 'Standalone Window', action: 'standalone' },
                { icon: 'fas fa-book', text: 'Grimoire Browser', action: 'browser' }
            ]
            : [];
        const extraOnAction = entry.category === 'wiki'
            ? async (action) => {
                const term = entry.label;
                if (!window.tagWikiSearchModal) return;
                if (action === 'standalone') {
                    await window.tagWikiSearchModal.openStandaloneWikiIfDirectMatch(term);
                } else if (action === 'browser') {
                    window.tagWikiSearchModal.openSearchForTerm(term);
                }
            }
            : null;
        return createRunTagActionMenu(entry, extraItems, extraOnAction);
    }

    return null;
}

function getRunEntryContextMenu(entry) {
    if (!entry || entry.isDeferredNetwork) return null;

    const actionMenu = getRunEntryActionMenu(entry);
    if (!isRunTagEntry(entry)) return actionMenu;

    const tagName = getRunEntryTagName(entry);
    const tagText = getRunEntryTagText(entry);
    const listItems = [
        { icon: 'fas fa-star', text: 'Add to Favorites', action: 'run-favorite-tag' },
        {
            icon: 'fas fa-layer-group',
            text: 'Add to Phasewalker Step',
            openOnHover: true,
            optionsfn: () => buildRunPhasewalkerContextMenuOptions(tagText),
            handlerfn: (subItem) => {
                if (subItem.action === 'run-phasewalker-step') {
                    runAppendTagToPhasewalkerStep(
                        subItem.data.tagText,
                        subItem.data.keyword,
                        subItem.data.stepIndex,
                        subItem.data.field,
                        false
                    );
                } else if (subItem.action === 'run-phasewalker-new-step') {
                    runAppendTagToPhasewalkerStep(
                        subItem.data.tagText,
                        subItem.data.keyword,
                        null,
                        subItem.data.field,
                        true
                    );
                }
            },
        }
    ];

    if (actionMenu && actionMenu.sections) {
        actionMenu.sections.forEach((section) => {
            (section.items || []).forEach((item) => {
                if (item.header || item.separator) return;
                if (item.action === 'copy-tag' || item.action === 'favorite') return;
                if (item.action === 'noop' || item.disabled) return;
                if (item.action === 'phasewalker-step' || item.action === 'phasewalker-new-step') return;
                listItems.push(item);
            });
        });
    }

    return {
        sections: [
            {
                type: 'icons',
                icons: [
                    { icon: 'fas fa-copy', tooltip: 'Copy Tag', action: 'run-copy-tag' }
                ]
            },
            { type: 'list', items: listItems }
        ],
        onAction: async (action, target, item) => {
            if (action === 'run-copy-tag') {
                await copyRunTagText(tagText);
                return;
            }
            if (action === 'run-favorite-tag') {
                if (showAddToFavoritesDialog) await showAddToFavoritesDialog(tagName);
                return;
            }
            if (actionMenu && actionMenu.onAction) {
                await actionMenu.onAction(action, item);
            }
        }
    };
}

function invalidateRunStaticCache() {
    runStaticCache = null;
    runNoteCache = null;
    runNaxGalleriesCache = null;
}

window.copyRunTagText = copyRunTagText;
window.runAppendTagToPhasewalkerStep = runAppendTagToPhasewalkerStep;
window.openPhasewalkerEditor = openPhasewalkerEditor;
window.buildPhasewalkerContextSubmenuItems = buildPhasewalkerContextSubmenuItems;
window.handlePhasewalkerContextSubmenuAction = handlePhasewalkerContextSubmenuAction;
window.buildRunPhasewalkerContextMenuOptions = buildRunPhasewalkerContextMenuOptions;
window.getRunPromptInsertTarget = getRunPromptInsertTarget;
window.searchRunCommands = searchRunCommands;
window.getRunEntryActionMenu = getRunEntryActionMenu;
window.getRunEntryActionItems = getRunEntryActionItems;
window.getRunEntryContextMenu = getRunEntryContextMenu;
window.runFetchNetworkSearch = runFetchNetworkSearch;
window.shouldDeferRunNetworkSearch = shouldDeferRunNetworkSearch;
window.invalidateRunStaticCache = invalidateRunStaticCache;
window.RUN_CATEGORY_LABELS = RUN_CATEGORY_LABELS;
window.RUN_CATEGORY_ICONS = RUN_CATEGORY_ICONS;
window.RUN_SEARCH_PREFIX_HINT = RUN_SEARCH_PREFIX_HINT;
