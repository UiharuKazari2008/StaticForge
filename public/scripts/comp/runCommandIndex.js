// Run command index — searchable catalog for Run applet
// public/scripts/comp/runCommandIndex.js

const RUN_CATEGORY_LABELS = {
    app: 'Application',
    workspace: 'Workspace',
    note: 'Note',
    shortcut: 'Desktop Shortcut',
    wiki: 'Grimoire',
    'gallery-tag': 'Gallery Search',
    'gallery-date': 'Gallery Date',
    'text-replacement': 'Expander',
    'quick-access': 'Quick Access'
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
    'quick-access': 'fas fa-tag'
};

const RUN_PREFIX_STRIPS = [
    { prefix: 'note:', category: 'note' },
    { prefix: 'wiki:', category: 'wiki' },
    { prefix: 'tag:', category: 'gallery-tag' },
    { prefix: 'ws:', category: 'workspace' },
    { prefix: 'goto:', category: 'gallery-date' },
    { prefix: '>', category: 'app' }
];

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
    // calculateStringSimilarity: public/scripts/comp/autocompleteUtils.js
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
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
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
    // injectAutocompleteSuggestionAtCursor: public/scripts/comp/autocompleteUtils.js
    if (typeof injectAutocompleteSuggestionAtCursor === 'function') {
        injectAutocompleteSuggestionAtCursor(target, text);
        return;
    }
    const cursor = target.selectionStart || 0;
    const before = target.value.substring(0, cursor);
    const after = target.value.substring(cursor);
    // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
    replaceTextareaRangePreservingUndo(target, cursor, cursor, text);
    target.setSelectionRange(cursor + text.length, cursor + text.length);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(target);
    if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(target);
}

async function ensureGalleryReadyForRun() {
    if (typeof isGalleryWindowHidden === 'function' && isGalleryWindowHidden()) {
        if (typeof showGalleryWindow === 'function') showGalleryWindow();
    }
    if (typeof currentGalleryView !== 'undefined' && currentGalleryView !== 'images' && typeof switchGalleryView === 'function') {
        await switchGalleryView('images');
    }
}

function buildRunStaticEntries() {
    const entries = [];

    if (typeof collectStartMenuLaunchables === 'function') {
        collectStartMenuLaunchables().forEach((item) => {
            entries.push({
                id: `app-${item.launchId || item.label}`,
                category: 'app',
                label: item.label,
                subtitle: item.subtitle || 'Application',
                icon: item.icon || RUN_CATEGORY_ICONS.app,
                keywords: item.keywords || [],
                execute: item.execute
            });
        });
    }

    const workspacesData = typeof workspaces !== 'undefined' ? workspaces : (window.workspaces || {});
    Object.values(workspacesData).forEach((ws) => {
        if (!ws || !ws.id) return;
        entries.push({
            id: `ws-${ws.id}`,
            category: 'workspace',
            label: ws.name || ws.id,
            subtitle: 'Switch workspace',
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

    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts && Array.isArray(desktopShortcuts.shortcuts)) {
        desktopShortcuts.shortcuts.forEach((sc) => {
            if (!sc || !sc.name) return;
            entries.push({
                id: `sc-${sc.id}`,
                category: 'shortcut',
                label: sc.name,
                subtitle: sc.type ? `Shortcut · ${sc.type}` : 'Desktop shortcut',
                icon: RUN_CATEGORY_ICONS.shortcut,
                keywords: [sc.name, sc.type],
                execute: async () => {
                    if (typeof isDesktopStartMenuEnvironment === 'function' && !isDesktopStartMenuEnvironment()) {
                        showGlassToast('info', 'Run', 'Desktop mode required', false, 2500);
                        return;
                    }
                    desktopShortcuts.handleShortcutClick(sc);
                }
            });
        });
    }

    return entries;
}

async function buildRunNoteEntries() {
    const entries = [];
    const wsId = typeof activeWorkspace !== 'undefined' ? activeWorkspace : (window.activeWorkspace || 'default');
    if (!window.notepadManager || typeof window.notepadManager.getNotesArray !== 'function') return entries;
    try {
        const notes = await window.notepadManager.getNotesArray(wsId);
        notes.forEach((note) => {
            if (!note || !note.id) return;
            entries.push({
                id: `note-${note.id}`,
                category: 'note',
                label: note.name || 'Untitled',
                subtitle: 'Open note',
                icon: RUN_CATEGORY_ICONS.note,
                keywords: [note.name],
                execute: async () => {
                    await window.notepadManager.openExistingNote(note.id);
                }
            });
        });
    } catch (err) {
        console.warn('Run: failed to load notes', err);
    }
    return entries;
}

function buildRunTextReplacementEntries(query) {
    const entries = [];
    const promptTarget = getRunPromptInsertTarget();
    if (!promptTarget || !query) return entries;

    const map = window.optionsData && window.optionsData.textReplacements;
    if (!map) return entries;

    Object.keys(map).forEach((key) => {
        const displayKey = key.startsWith('!') ? key : `!${key}`;
        const score = runScoreText(query, key, 'text-replacement', 'text-replacement');
        const scoreName = runScoreText(query, displayKey, 'text-replacement', 'text-replacement');
        const best = Math.max(score, scoreName);
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

async function fetchRunAsyncEntries(query, categoryHint) {
    const asyncEntries = [];
    const promptTarget = getRunPromptInsertTarget();

    if (window.tagWikiSearchModal && typeof window.tagWikiSearchModal.searchTagWiki === 'function' && query.length >= 1) {
        try {
            const wikiResults = await window.tagWikiSearchModal.searchTagWiki(query, { limit: 8 });
            (wikiResults || []).slice(0, 6).forEach((result, idx) => {
                const name = result.title || result.name || result.tag || query;
                asyncEntries.push({
                    id: `wiki-${idx}-${name}`,
                    category: 'wiki',
                    label: name,
                    subtitle: result.hasWiki ? 'Grimoire page' : 'Search Grimoire',
                    icon: RUN_CATEGORY_ICONS.wiki,
                    keywords: [name],
                    execute: async () => {
                        if (!window.tagWikiSearchModal) return;
                        const term = name;
                        const opened = await window.tagWikiSearchModal.openStandaloneWikiIfDirectMatch(term);
                        if (!opened) window.tagWikiSearchModal.openSearchForTerm(term);
                    }
                });
            });
        } catch (err) {
            console.warn('Run: wiki search failed', err);
        }
    }

    const inPrompt = Boolean(promptTarget);
    const tagLike = looksLikeTagQuery(query);

    if (!inPrompt && query.length >= 1 && (tagLike || categoryHint === 'gallery-tag')) {
        asyncEntries.push({
            id: `gallery-tag-${query}`,
            category: 'gallery-tag',
            label: `Search gallery: ${query}`,
            subtitle: 'Filter gallery by tags',
            icon: RUN_CATEGORY_ICONS['gallery-tag'],
            keywords: [query],
            execute: async () => {
                await ensureGalleryReadyForRun();
                if (window.fileSearch) {
                    await window.fileSearch.initializeSearchIfNeeded();
                    await window.fileSearch.performSearch(query);
                    if (typeof displayGalleryFromStartIndex === 'function') {
                        await displayGalleryFromStartIndex(0, true);
                    }
                }
            }
        });
    }

    const parsedDate = parseGalleryDateQuery(query);
    if (parsedDate && (looksLikeDateQuery(query) || categoryHint === 'gallery-date')) {
        const label = query.charAt(0).toUpperCase() + query.slice(1);
        asyncEntries.push({
            id: `gallery-date-${query}`,
            category: 'gallery-date',
            label: `Jump gallery to ${label}`,
            subtitle: parsedDate.toLocaleDateString(),
            icon: RUN_CATEGORY_ICONS['gallery-date'],
            keywords: [query],
            execute: async () => {
                await ensureGalleryReadyForRun();
                const idx = findGalleryIndexForDate(parsedDate);
                if (idx >= 0 && typeof displayGalleryFromStartIndex === 'function') {
                    await displayGalleryFromStartIndex(idx, true);
                }
            }
        });
    }

    if (inPrompt && query.length >= 1 && window.wsClient && window.wsClient.isConnected()) {
        try {
            const tagResult = await window.wsClient.searchTags(query, false);
            const tags = (tagResult && tagResult.results) ? tagResult.results : [];
            tags.slice(0, 8).forEach((tag, idx) => {
                const name = typeof tag === 'string' ? tag : (tag.name || tag.tag || '');
                if (!name) return;
                asyncEntries.push({
                    id: `qa-${idx}-${name}`,
                    category: 'quick-access',
                    label: name,
                    subtitle: 'Quick Access tag',
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
        } catch (err) {
            console.warn('Run: quick access tag search failed', err);
        }

        asyncEntries.push(...buildRunTextReplacementEntries(query));
    }

    return asyncEntries;
}

let runStaticCache = null;
let runNoteCache = null;
let runNoteCacheTime = 0;

async function getRunStaticEntries() {
    if (!runStaticCache) runStaticCache = buildRunStaticEntries();
    const now = Date.now();
    if (!runNoteCache || now - runNoteCacheTime > 30000) {
        runNoteCache = await buildRunNoteEntries();
        runNoteCacheTime = now;
    }
    return [...runStaticCache, ...runNoteCache];
}

function invalidateRunStaticCache() {
    runStaticCache = null;
    runNoteCache = null;
}

async function searchRunCommands(rawQuery) {
    const { query, categoryHint } = normalizeRunQuery(rawQuery);
    if (!query) return [];

    const staticEntries = await getRunStaticEntries();
    const scored = [];

    staticEntries.forEach((entry) => {
        const score = runScoreEntry(query, entry, categoryHint);
        if (score >= 25) scored.push({ ...entry, score });
    });

    const asyncEntries = await fetchRunAsyncEntries(query, categoryHint);
    asyncEntries.forEach((entry) => {
        const score = entry.score != null ? entry.score : runScoreEntry(query, entry, categoryHint);
        if (score >= 20 || entry.category === 'gallery-date' || entry.category === 'gallery-tag') {
            scored.push({ ...entry, score });
        }
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 12);
}

window.getRunPromptInsertTarget = getRunPromptInsertTarget;
window.searchRunCommands = searchRunCommands;
window.invalidateRunStaticCache = invalidateRunStaticCache;
window.RUN_CATEGORY_LABELS = RUN_CATEGORY_LABELS;
window.RUN_CATEGORY_ICONS = RUN_CATEGORY_ICONS;
