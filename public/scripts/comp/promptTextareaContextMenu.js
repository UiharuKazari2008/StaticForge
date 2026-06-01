/**
 * Right-click context menu for .prompt-textarea / .character-prompt-textarea
 * public/scripts/comp/contextMenu.js
 * public/scripts/comp/promptTextareaToolbar.js
 * public/scripts/comp/autocompleteUtils.js
 * public/scripts/comp/emphasisManager.js
 */

const PROMPT_CTX_DYNAMIC_PLACEHOLDERS = [
    { name: 'TIME', label: 'Time of Day', icon: 'fas fa-clock' },
    { name: 'WEATHER', label: 'Weather', icon: 'fas fa-cloud-rain' },
    { name: 'SEASON', label: 'Season', icon: 'fas fa-leaf' },
    { name: 'CLOTHING', label: 'Clothing', icon: 'fas fa-tshirt' },
    { name: 'ACTION', label: 'Activity', icon: 'fas fa-running' },
    { name: 'ENV', label: 'Environment', icon: 'fas fa-tree' }
];

const promptCtxThesaurusCache = new Map();
let promptCtxNaxFavoritesCache = null;
let promptCtxNaxFavoritesLoadPromise = null;
let promptCtxNaxGalleriesCache = null;
let promptCtxNaxGalleriesLoadPromise = null;
let promptCtxNaxExpanderPresetsCache = null;
let promptCtxNaxExpanderPresetsCacheModel = null;
let promptCtxNaxExpanderPresetsLoadPromise = null;

const PROMPT_CTX_FAV_GRID_CLASS = 'prompt-ctx-fav-grid';
const PROMPT_CTX_FAV_GRID_CELL_CLASS = 'prompt-ctx-fav-grid-cell';

/** Loose slug before constrained — image/data from loose wins when tag exists in both. NAX_FAVORITE_MERGE_GROUPS: modules/naxTagsDatabase.js */
const PROMPT_CTX_NAX_FAV_MERGE_GROUPS = [
    {
        slugs: ['danbooru-artist-tags-2-v4.5', 'danbooru-artist-tags-v4.5'],
        title: 'Artists'
    }
];

function promptCtxGetCurrentModel() {
    // getMappedManualModel: public/scripts/comp/autocompleteUtils.js
    if (typeof getMappedManualModel === 'function') {
        return getMappedManualModel();
    }
    return window.currentModel || '';
}

function promptCtxIsPromptTextarea(el) {
    return el && el.matches && el.matches('textarea.prompt-textarea, textarea.character-prompt-textarea');
}

function promptCtxGetFieldKind(textarea) {
    const id = textarea.id || '';
    if (id === 'manualUc' || id.endsWith('_uc')) return 'uc';
    if (id === 'manualPrompt' || id === 'manualPromptNegative' || id.endsWith('_prompt') || id.endsWith('_promptNegative')) {
        return 'prompt';
    }
    const pane = textarea.closest('.tab-pane');
    if (pane && pane.id && pane.id.endsWith('_uc-tab')) return 'uc';
    if (pane && pane.id && pane.id.endsWith('_prompt-tab')) return 'prompt';
    return 'prompt';
}

function promptCtxIsDynamicGenerationEnabled() {
    const group = document.getElementById('dynamicGenerationGroup');
    return Boolean(group && !group.classList.contains('hidden'));
}

function promptCtxHasTagContext(state) {
    if (!state) return false;
    return state.hasSelection && Boolean(String(state.selectedText || '').trim());
}

function promptCtxOpenPhasewalkerEditor() {
    // openPhasewalkerEditor: public/scripts/comp/runCommandIndex.js
    if (openPhasewalkerEditor) openPhasewalkerEditor();
}

function promptCtxHasMeaningfulSelection(textarea) {
    const state = getPromptTextareaMenuState(textarea);
    return state.hasSelection && Boolean(String(state.selectedText || '').trim());
}

function promptCtxElevateDialogZIndex(dialog) {
    if (dialog) {
        dialog.style.zIndex = '5100';
    }
}

function promptCtxTruncateSelectionLabel(text, maxLen) {
    const t = String(text || '').trim();
    const limit = maxLen || 48;
    if (t.length <= limit) return t;
    return t.substring(0, limit - 1) + '…';
}

function promptCtxHasDisabledBlocks(textarea) {
    return /!\/[^\/]+\//.test(String(textarea && textarea.value ? textarea.value : ''));
}

function promptCtxDeleteAllDisabledBlocks(textarea) {
    if (!textarea || !stripDisabledPromptBlocks) return;
    const next = stripDisabledPromptBlocks(textarea.value);
    if (next === textarea.value) return;
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, next);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
    if (window.promptTextareaToolbar) window.promptTextareaToolbar.updateTokenCount(textarea);
}

function promptCtxWillEnableDisableBlock(textarea) {
    // isCursorInsideDisableBlock: public/scripts/comp/emphasisManager.js
    return isCursorInsideDisableBlock && isCursorInsideDisableBlock(textarea);
}

function promptCtxGetDisableToggleIcon(textarea) {
    return promptCtxWillEnableDisableBlock(textarea) ? 'fas fa-circle-check' : 'fas fa-ban';
}

function promptCtxGetDisableToggleTooltip(textarea) {
    if (promptCtxWillEnableDisableBlock(textarea)) {
        return 'Enable Selection';
    }
    return 'Disable Selection';
}

function promptCtxCanToggleDisableSyntax(textarea) {
    if (promptCtxWillEnableDisableBlock(textarea)) return true;
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    return start !== end;
}

function promptCtxIsCreativeDirectiveTextarea(textarea) {
    return getPromptTextareaMenuState(textarea).isCreativeDirective;
}

function promptCtxRefreshThesaurusSubmenuIfOpen(textarea) {
    if (!contextMenu || !contextMenu.isOpen || contextMenu.currentTarget !== textarea) return;
    if (contextMenu.currentSubmenuState && contextMenu.currentSubmenuState.optionsfn) {
        contextMenu.refreshSubmenu();
    }
}

function promptCtxShowTextExpanderDialog(selectedText) {
    const text = String(selectedText || '').trim();
    const defaultName = text ? extractFirstTag(text) : '';

    return new Promise((resolve) => {
        const existingDialog = document.querySelector('.favorites-dialog, .favorites-text-replacement-dialog, .prompt-ctx-expander-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }

        const dialog = document.createElement('div');
        dialog.className = 'confirmation-dialog favorites-text-replacement-dialog prompt-ctx-expander-dialog';
        dialog.innerHTML = `
            <div class="confirmation-dialog-content">
                <div class="confirmation-message">
                    <strong>Add Genso Expander</strong>
                    ${text ? `<div class="selected-text-preview">Selected: "${text}"</div>` : ''}
                </div>
                <div class="text-replacement-form">
                    <div class="form-row">
                        <label for="replacementName">Name:</label>
                        <input type="text" id="replacementName" class="form-control" value="${defaultName}" placeholder="replacement_name">
                    </div>
                    ${text ? '' : `
                    <div class="form-row">
                        <label for="replacementValue">Value:</label>
                        <input type="text" id="replacementValue" class="form-control" placeholder="replacement text">
                    </div>`}
                    <div class="form-row">
                        <label>Scope:</label>
                        <div class="confirmation-controls" style="justify-content: flex-start; gap: 8px;">
                            <button type="button" class="btn btn-primary" id="expanderScopeRequest" data-state="on">Request</button>
                            <button type="button" class="btn btn-secondary" id="expanderScopeGlobal" data-state="off">Global</button>
                        </div>
                    </div>
                    <div class="form-hint">
                        <i class="fas fa-info-circle"></i> Will be available as !<span id="namePreview">${defaultName || 'replacement_name'}</span>
                    </div>
                </div>
                <div class="confirmation-controls">
                    <button class="btn btn-secondary" id="cancelTextReplacement">Cancel</button>
                    <button class="btn btn-primary" id="saveTextReplacement">Add Expander</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        promptCtxElevateDialogZIndex(dialog);
        positionCustomDialog(dialog);
        dialog.classList.remove('hidden');

        const nameInput = dialog.querySelector('#replacementName');
        const valueInput = dialog.querySelector('#replacementValue');
        const namePreview = dialog.querySelector('#namePreview');
        const cancelBtn = dialog.querySelector('#cancelTextReplacement');
        const saveBtn = dialog.querySelector('#saveTextReplacement');
        const scopeRequestBtn = dialog.querySelector('#expanderScopeRequest');
        const scopeGlobalBtn = dialog.querySelector('#expanderScopeGlobal');
        let scope = 'request';

        const setScope = (nextScope) => {
            scope = nextScope === 'global' ? 'global' : 'request';
            if (scopeRequestBtn) {
                scopeRequestBtn.setAttribute('data-state', scope === 'request' ? 'on' : 'off');
                scopeRequestBtn.classList.toggle('btn-primary', scope === 'request');
                scopeRequestBtn.classList.toggle('btn-secondary', scope !== 'request');
            }
            if (scopeGlobalBtn) {
                scopeGlobalBtn.setAttribute('data-state', scope === 'global' ? 'on' : 'off');
                scopeGlobalBtn.classList.toggle('btn-primary', scope === 'global');
                scopeGlobalBtn.classList.toggle('btn-secondary', scope !== 'global');
            }
        };

        if (scopeRequestBtn) scopeRequestBtn.addEventListener('click', () => setScope('request'));
        if (scopeGlobalBtn) scopeGlobalBtn.addEventListener('click', () => setScope('global'));

        nameInput.focus();
        nameInput.select();

        nameInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\s+/g, '_');
            e.target.value = value;
            namePreview.textContent = value || 'replacement_name';
        });

        cancelBtn.addEventListener('click', () => {
            dialog.remove();
            resolve(false);
        });

        const handleSave = async () => {
            const name = nameInput.value.trim();
            const replacementValue = text || (valueInput ? valueInput.value.trim() : '');
            if (!name) {
                showGlassToast('error', null, 'Please enter a name for the replacement', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                nameInput.focus();
                return;
            }
            if (!replacementValue) {
                showGlassToast('error', null, 'Please enter replacement text', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                if (valueInput) valueInput.focus();
                return;
            }

            if (scope === 'global') {
                const itemData = {
                    type: 'textReplacement',
                    name: name,
                    originalName: replacementValue,
                    description: replacementValue,
                    placeholder: name,
                    replacementValue: replacementValue
                };
                if (window.wsClient && window.wsClient.isConnected()) {
                    window.wsClient.send({
                        type: 'favorites_add',
                        favoriteType: 'textReplacements',
                        item: itemData,
                        requestId: `favorite_add_${Date.now()}`
                    });
                    showGlassToast('success', null, `Added text replacement "!${name}" to config`, false, 3000, '<i class="fas fa-lambda"></i>');
                } else {
                    showGlassToast('error', null, 'Unable to add to favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            } else if (typeof requestBodyReplacements !== 'undefined') {
                requestBodyReplacements.push({
                    name: name,
                    value: replacementValue,
                    extend: false
                });
                // renderRequestBodyReplacementsList: public/scripts/comp/requestBodyReplacementsModal.js
                if (renderRequestBodyReplacementsList) renderRequestBodyReplacementsList();
                showGlassToast('success', null, `Added request expander "!${name}"`, false, 3000, '<i class="fas fa-book-font"></i>');
            } else {
                showGlassToast('error', null, 'Request expanders are unavailable', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }

            dialog.remove();
            resolve(true);
        };

        saveBtn.addEventListener('click', handleSave);
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                dialog.remove();
                resolve(false);
            }
        });
    });
}

function getPromptTextareaMenuState(textarea) {
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    const hasSelection = start !== end;
    const selectedText = hasSelection ? textarea.value.substring(Math.min(start, end), Math.max(start, end)) : '';
    // getWikiTermFromPromptTextareaForKeyboard: public/scripts/comp/autocompleteUtils.js
    const contextTerm = getWikiTermFromPromptTextareaForKeyboard(textarea);
    return {
        textarea,
        hasSelection,
        selectedText,
        contextTerm,
        fieldKind: promptCtxGetFieldKind(textarea),
        isCreativeDirective: Boolean(textarea.closest('.creative-directive-container'))
    };
}

function wrapDynamicTagSection(token, innerText) {
    const t = String(token || '').trim();
    const inner = String(innerText || '').trim();
    if (!t || !inner) return inner;
    return `${t}%${inner}%`;
}

function insertTextAtPromptSelection(textarea, insertText) {
    if (!textarea || !insertText) return;
    const prev = currentCharacterAutocompleteTarget;
    currentCharacterAutocompleteTarget = textarea;
    // injectAutocompleteSuggestionAtCursor: public/scripts/comp/autocompleteUtils.js
    injectAutocompleteSuggestionAtCursor(textarea, insertText);
    currentCharacterAutocompleteTarget = prev;
}

function insertDynamicPlaceholderAtCaret(textarea, placeholder) {
    const prev = currentCharacterAutocompleteTarget;
    currentCharacterAutocompleteTarget = textarea;
    // selectDynamicPlaceholder: public/scripts/comp/autocompleteUtils.js
    selectDynamicPlaceholder(placeholder);
    currentCharacterAutocompleteTarget = prev;
}

function setDynamicPlaceholderOnSelection(textarea, placeholder, selectedText) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    const wrapped = wrapDynamicTagSection(placeholder, selectedText.trim());
    const newValue = before + wrapped + after;
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, newValue);
    const pos = before.length + wrapped.length;
    textarea.setSelectionRange(pos, pos);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
    if (window.promptTextareaToolbar) window.promptTextareaToolbar.updateTokenCount(textarea);
}

function promptCtxWithAutocompleteTarget(textarea, fn) {
    const prev = currentCharacterAutocompleteTarget;
    currentCharacterAutocompleteTarget = textarea;
    try {
        return fn();
    } finally {
        currentCharacterAutocompleteTarget = prev;
    }
}

async function promptCtxEnsureFavoritesLoaded() {
    // ensureFavoritesLoadedForPromptMenu: public/scripts/comp/textReplacementManager.js
    if (ensureFavoritesLoadedForPromptMenu) {
        await ensureFavoritesLoadedForPromptMenu();
    }
}

async function promptCtxEnsureNaxGalleriesLoaded() {
    if (promptCtxNaxGalleriesCache) return promptCtxNaxGalleriesCache;
    if (promptCtxNaxGalleriesLoadPromise) return promptCtxNaxGalleriesLoadPromise;
    promptCtxNaxGalleriesLoadPromise = (async () => {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            promptCtxNaxGalleriesCache = [];
            return [];
        }
        try {
            const data = await window.wsClient.sendMessage('get_nax_galleries', {}, false);
            promptCtxNaxGalleriesCache = (data && data.galleries) || [];
        } catch {
            promptCtxNaxGalleriesCache = [];
        }
        return promptCtxNaxGalleriesCache;
    })();
    return promptCtxNaxGalleriesLoadPromise;
}

async function promptCtxEnsureNaxFavoritesLoaded() {
    if (promptCtxNaxFavoritesCache) return promptCtxNaxFavoritesCache;
    if (promptCtxNaxFavoritesLoadPromise) return promptCtxNaxFavoritesLoadPromise;
    promptCtxNaxFavoritesLoadPromise = (async () => {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            promptCtxNaxFavoritesCache = [];
            return [];
        }
        try {
            const data = await window.wsClient.sendMessage('get_nax_marked_tags', { markFilter: 'favorites' }, false);
            promptCtxNaxFavoritesCache = (data && data.items) || [];
        } catch {
            promptCtxNaxFavoritesCache = [];
        }
        return promptCtxNaxFavoritesCache;
    })();
    return promptCtxNaxFavoritesLoadPromise;
}

async function promptCtxEnsureNaxExpanderPresetsLoaded() {
    const model = promptCtxGetCurrentModel();
    if (promptCtxNaxExpanderPresetsCache && promptCtxNaxExpanderPresetsCacheModel === model) {
        return promptCtxNaxExpanderPresetsCache;
    }
    if (promptCtxNaxExpanderPresetsLoadPromise) return promptCtxNaxExpanderPresetsLoadPromise;
    promptCtxNaxExpanderPresetsLoadPromise = (async () => {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            promptCtxNaxExpanderPresetsCache = [];
            promptCtxNaxExpanderPresetsCacheModel = model;
            return [];
        }
        try {
            const data = await window.wsClient.sendMessage('get_nax_expander_presets', { model }, false);
            promptCtxNaxExpanderPresetsCache = (data && data.presets) || [];
            promptCtxNaxExpanderPresetsCacheModel = model;
        } catch {
            promptCtxNaxExpanderPresetsCache = [];
            promptCtxNaxExpanderPresetsCacheModel = model;
        }
        promptCtxNaxExpanderPresetsLoadPromise = null;
        return promptCtxNaxExpanderPresetsCache;
    })();
    return promptCtxNaxExpanderPresetsLoadPromise;
}

function promptCtxNaxGalleryLabel(gallerySlug, galleries) {
    // naxtGalleryBucketLabel: public/scripts/comp/naxtApplet.js
    if (typeof naxtGalleryBucketLabel === 'function') {
        return naxtGalleryBucketLabel(gallerySlug, galleries || []);
    }
    return gallerySlug || '';
}

function promptCtxNaxFavGridTitle(gallerySlug, galleries, titleOverride) {
    const label = titleOverride || promptCtxNaxGalleryLabel(gallerySlug, galleries);
    if (!label) return 'Atelier';
    return 'Atelier - ' + label;
}

function promptCtxFormatNaxTag(tag, gallerySlug) {
    // naxtFormatTagFragment: public/scripts/comp/naxtApplet.js
    if (typeof naxtFormatTagFragment === 'function') {
        return naxtFormatTagFragment(tag, gallerySlug);
    }
    return tag;
}

function promptCtxNaxImageUrl(entry) {
    if (!entry || !entry.gallerySlug || !entry.filename) return '';
    const slug = encodeURIComponent(entry.gallerySlug);
    const file = encodeURIComponent(entry.filename);
    return `/naxCache/${slug}/${file}`;
}

function promptCtxMakeFavoriteGridCell({ tooltip, action, data, image, icon = 'fas fa-tag' }) {
    const cell = {
        tooltip,
        action,
        data,
        className: PROMPT_CTX_FAV_GRID_CELL_CLASS
    };
    if (image) {
        cell.image = image;
        cell.imageAlt = tooltip || '';
    } else {
        cell.icon = icon;
    }
    return cell;
}

function promptCtxNaxFavMergePriority(slug, mergeGroup) {
    const idx = mergeGroup.slugs.indexOf(slug);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function promptCtxMergeNaxFavoriteGroup(grouped, mergeGroup) {
    const byTag = new Map();
    mergeGroup.slugs.forEach((slug) => {
        const entries = grouped.get(slug) || [];
        entries.forEach((entry) => {
            const tag = entry.tag || '';
            if (!tag) return;
            const priority = promptCtxNaxFavMergePriority(slug, mergeGroup);
            const existing = byTag.get(tag);
            if (!existing || priority < existing.priority) {
                byTag.set(tag, { entry, priority });
            }
        });
        grouped.delete(slug);
    });
    return Array.from(byTag.values())
        .map(({ entry }) => entry)
        .sort((a, b) => String(a.tag || '').localeCompare(String(b.tag || ''), undefined, { sensitivity: 'base' }));
}

function promptCtxAppendNaxFavoriteGridSection(items, title, entries) {
    if (!entries.length) return;
    items.push({
        type: 'grid',
        title,
        className: PROMPT_CTX_FAV_GRID_CLASS,
        items: entries.map((entry) => {
            const tag = entry.tag || '';
            const slug = entry.gallerySlug || '';
            const imageUrl = promptCtxNaxImageUrl(entry);
            return promptCtxMakeFavoriteGridCell({
                tooltip: tag,
                action: 'prompt-ctx-nax-favorite-insert',
                data: { tag, gallerySlug: slug },
                image: imageUrl || null,
                icon: 'fas fa-star'
            });
        })
    });
}

function promptCtxAppendNaxFavoriteGrids(items, galleries) {
    void promptCtxEnsureNaxFavoritesLoaded();
    if (!promptCtxNaxFavoritesCache && promptCtxNaxFavoritesLoadPromise) {
        items.push({ text: 'Loading…', disabled: true });
        return;
    }

    const favorites = promptCtxNaxFavoritesCache || [];
    if (!favorites.length) return;

    const grouped = new Map();
    favorites.forEach((entry) => {
        const slug = entry.gallerySlug || '';
        const tag = entry.tag || '';
        if (!slug || !tag) return;
        if (!grouped.has(slug)) grouped.set(slug, []);
        grouped.get(slug).push(entry);
    });

    PROMPT_CTX_NAX_FAV_MERGE_GROUPS.forEach((mergeGroup) => {
        const hasAny = mergeGroup.slugs.some((slug) => (grouped.get(slug) || []).length > 0);
        if (!hasAny) return;
        const merged = promptCtxMergeNaxFavoriteGroup(grouped, mergeGroup);
        promptCtxAppendNaxFavoriteGridSection(
            items,
            promptCtxNaxFavGridTitle(null, galleries, mergeGroup.title),
            merged
        );
    });

    grouped.forEach((entries, slug) => {
        promptCtxAppendNaxFavoriteGridSection(
            items,
            promptCtxNaxFavGridTitle(slug, galleries),
            entries
        );
    });
}

function buildNaxtExpanderSubmenuItems(textarea) {
    void textarea;
    void promptCtxEnsureNaxExpanderPresetsLoaded();
    if (!promptCtxNaxExpanderPresetsCache && promptCtxNaxExpanderPresetsLoadPromise) {
        return [{ text: 'Loading…', disabled: true }];
    }
    const presets = promptCtxNaxExpanderPresetsCache || [];
    if (!presets.length) {
        return [{ text: 'Atelier expanders unavailable', disabled: true }];
    }

    const items = [{ separator: true, text: 'Favorites' }];
    presets.forEach((preset) => {
        const count = preset.favCount != null ? preset.favCount : 0;
        items.push({
            text: preset.label || preset.id || '',
            icon: 'fas fa-star',
            badge: count,
            disabled: count === 0,
            action: 'prompt-ctx-nax-expander-insert',
            data: { insertText: preset.favPattern || `!NAX_FAV_${preset.id}` }
        });
    });

    items.push({ separator: true, text: 'Test' });
    presets.forEach((preset) => {
        const count = preset.tryCount != null ? preset.tryCount : 0;
        items.push({
            text: preset.label || preset.id || '',
            icon: 'fas fa-flask',
            badge: count,
            disabled: count === 0,
            action: 'prompt-ctx-nax-expander-insert',
            data: { insertText: preset.tryPattern || `!NAX_TRY_${preset.id}` }
        });
    });
    return items;
}

function buildFavoritesSubmenuItems(textarea) {
    const items = [];
    const state = getPromptTextareaMenuState(textarea);
    if (state.hasSelection && state.selectedText.trim()) {
        items.push({
            separator: true,
            text: promptCtxTruncateSelectionLabel(state.selectedText.trim())
        });
        items.push({
            text: 'Save selection',
            icon: 'fas fa-heart',
            action: 'prompt-ctx-save-favorite'
        });
        items.push({ separator: true });
    }

    const data = getPromptContextMenuFavorites ? getPromptContextMenuFavorites() : { tags: [], textReplacements: [] };
    const tags = data.tags || [];
    const expanders = data.textReplacements || [];
    const galleries = promptCtxNaxGalleriesCache || [];
    void promptCtxEnsureNaxGalleriesLoaded();
    void promptCtxEnsureNaxFavoritesLoaded();

    if (tags.length > 0) {
        items.push({ separator: true, text: 'Tags' });
        tags.forEach((tag) => {
            const name = tag.name || tag.originalName || '';
            if (!name) return;
            items.push({
                text: name,
                icon: 'fas fa-tag',
                action: 'prompt-ctx-favorite-insert',
                data: { insertText: name, category: tag.category || '' }
            });
        });
    }

    if (expanders.length > 0) {
        items.push({ separator: true, text: 'Genso Expanders' });
        expanders.forEach((exp) => {
            const ph = exp.placeholder || exp.name || '';
            if (!ph) return;
            items.push({
                text: '!' + ph,
                icon: 'fas fa-book-font',
                action: 'prompt-ctx-favorite-insert',
                data: { insertText: '!' + ph }
            });
        });
    }

    const listItemCount = items.length;
    if (listItemCount > 0) {
        items.push({ separator: true, text: 'Atelier' });
    }
    promptCtxAppendNaxFavoriteGrids(items, galleries);

    if (items.length === 0) {
        items.push({ text: 'No favorites', disabled: true });
    }
    return items;
}

function buildInsertSubmenuItems(textarea) {
    const state = getPromptTextareaMenuState(textarea);
    return PROMPT_CTX_DYNAMIC_PLACEHOLDERS.map((entry) => ({
        text: entry.label,
        icon: entry.icon,
        action: state.hasSelection ? 'prompt-ctx-set-insert' : 'prompt-ctx-add-insert',
        data: { placeholder: entry.name }
    }));
}

function buildAddToStepSubmenuItems(textarea) {
    const field = promptCtxGetFieldKind(textarea) === 'uc' ? 'uc' : 'prompt';
    const text = getPromptTextareaMenuState(textarea);
    const tagText = String(text.selectedText || '').trim();
    // buildPhasewalkerContextSubmenuItems: public/scripts/comp/runCommandIndex.js
    if (typeof buildPhasewalkerContextSubmenuItems === 'function') {
        return buildPhasewalkerContextSubmenuItems(tagText, {
            field,
            stepAction: 'prompt-ctx-add-to-step',
            newStepAction: 'prompt-ctx-add-to-new-step',
            openEditorAction: 'prompt-ctx-open-phasewalker',
            newPrefixAction: 'prompt-ctx-new-prefix-step'
        });
    }
    return [{ text: 'Unavailable', disabled: true }];
}

function buildThesaurusSubmenuItems(textarea) {
    prefetchThesaurusForTextarea(textarea);
    const term = getPromptTextareaMenuState(textarea).contextTerm;
    if (!term) return [{ text: 'No word selected', disabled: true }];
    const key = term + '|' + (textarea.id || '');
    const cached = promptCtxThesaurusCache.get(key);
    if (!cached || cached.status === 'loading') {
        return [{ text: 'Loading…', disabled: true }];
    }
    if (cached.status === 'error' || !cached.data || !cached.data.hasData) {
        return [{ text: 'No suggestions', disabled: true }];
    }
    const items = [];
    const words = cached.data.words || [];
    words.forEach((entry) => {
        const syns = entry.synonyms || [];
        if (syns.length === 0 && entry.definitions && entry.definitions.length > 0) {
            entry.definitions.slice(0, 5).forEach((def) => {
                if (def && def.length < 80) {
                    items.push({
                        text: def,
                        action: 'prompt-ctx-thesaurus-apply',
                        data: { original: entry.word, synonym: def }
                    });
                }
            });
        } else {
            syns.slice(0, 12).forEach((syn) => {
                items.push({
                    text: syn,
                    action: 'prompt-ctx-thesaurus-apply',
                    data: { original: entry.word, synonym: syn }
                });
            });
        }
    });
    return items.length ? items : [{ text: 'No suggestions', disabled: true }];
}

function prefetchThesaurusForTextarea(textarea) {
    const state = getPromptTextareaMenuState(textarea);
    const term = state.contextTerm;
    if (!term || term.length < 1) return;
    const key = term + '|' + (textarea.id || '');
    const existing = promptCtxThesaurusCache.get(key);
    if (existing && (existing.status === 'loading' || existing.status === 'done')) return;
    promptCtxThesaurusCache.set(key, { status: 'loading' });
    // fetchWordLookupForTerm: public/scripts/comp/autocompleteUtils.js
    fetchWordLookupForTerm(term, textarea).then((data) => {
        promptCtxThesaurusCache.set(key, { status: 'done', data });
        promptCtxRefreshThesaurusSubmenuIfOpen(textarea);
    }).catch(() => {
        promptCtxThesaurusCache.set(key, { status: 'error', data: null });
        promptCtxRefreshThesaurusSubmenuIfOpen(textarea);
    });
}

function handlePromptTextareaContextMenuAction(action, textarea, item) {
    if (!textarea || !promptCtxIsPromptTextarea(textarea)) return;

    const state = getPromptTextareaMenuState(textarea);
    const toolbar = window.promptTextareaToolbar
        ? window.promptTextareaToolbar.getToolbarFromTextarea(textarea)
        : null;

    switch (action) {
        case 'prompt-ctx-cut':
            if (!promptCtxHasMeaningfulSelection(textarea)) break;
            textarea.focus();
            document.execCommand('cut');
            break;
        case 'prompt-ctx-copy':
            if (!promptCtxHasMeaningfulSelection(textarea)) break;
            textarea.focus();
            document.execCommand('copy');
            break;
        case 'prompt-ctx-paste':
            textarea.focus();
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then((text) => {
                    if (text == null) return;
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const val = textarea.value;
                    const next = val.substring(0, start) + text + val.substring(end);
                    setTextareaValuePreservingUndo(textarea, next);
                    const pos = start + text.length;
                    textarea.setSelectionRange(pos, pos);
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }).catch(() => document.execCommand('paste'));
            } else {
                document.execCommand('paste');
            }
            break;
        case 'prompt-ctx-select-all':
            textarea.focus();
            textarea.setSelectionRange(0, textarea.value.length);
            break;
        case 'prompt-ctx-search-wiki': {
            const term = state.contextTerm;
            if (term && tagWikiSearchModal) {
                tagWikiSearchModal.openSearchForTerm(term);
            }
            break;
        }
        case 'prompt-ctx-search-google': {
            if (!promptCtxHasMeaningfulSelection(textarea)) break;
            const term = state.selectedText.trim();
            if (term) {
                window.open('https://www.google.com/search?q=' + encodeURIComponent(term), '_blank', 'noopener,noreferrer');
            }
            break;
        }
        case 'prompt-ctx-find-in-prompt':
            if (window.promptTextareaToolbar) {
                window.promptTextareaToolbar.openSearch(textarea);
                if (state.contextTerm) {
                    const tbar = window.promptTextareaToolbar.getToolbarFromTextarea(textarea);
                    const input = tbar && tbar.querySelector('.text-search-input');
                    if (input) {
                        input.value = state.contextTerm;
                        const searchState = window.promptTextareaToolbar.searchStates.get(tbar);
                        if (searchState) searchState.query = state.contextTerm;
                        window.promptTextareaToolbar.performSearch(tbar);
                    }
                }
            }
            break;
        case 'prompt-ctx-emphasis':
            if (toolbar && window.promptTextareaToolbar) {
                window.promptTextareaToolbar.openEmphasisMode(textarea, toolbar);
            }
            break;
        case 'prompt-ctx-split-emphasis':
            // splitEmphasisBlock: public/scripts/comp/emphasisManager.js
            if (splitEmphasisBlock) splitEmphasisBlock(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
            break;
        case 'prompt-ctx-clear-emphasis':
            if (removeAllEmphasisFromSelection) removeAllEmphasisFromSelection(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
            break;
        case 'prompt-ctx-lowercase':
            if (window.promptTextareaToolbar) {
                window.promptTextareaToolbar.lowercasePromptText(textarea);
            }
            break;
        case 'prompt-ctx-toggle-disable':
            if (!promptCtxCanToggleDisableSyntax(textarea)) break;
            // toggleDisableSyntax: public/scripts/comp/emphasisManager.js
            if (toggleDisableSyntax) toggleDisableSyntax(textarea);
            break;
        case 'prompt-ctx-delete-disabled-blocks':
            promptCtxDeleteAllDisabledBlocks(textarea);
            break;
        case 'prompt-ctx-quick-access':
            if (showDatasetTagToolbar) showDatasetTagToolbar();
            break;
        case 'prompt-ctx-save-favorite':
            if (promptCtxHasMeaningfulSelection(textarea) && showAddToFavoritesDialog) {
                showAddToFavoritesDialog(state.selectedText.trim());
            }
            break;
        case 'prompt-ctx-favorite-insert': {
            const data = item && item.data;
            if (!data || !data.insertText) break;
            let text = data.insertText;
            if (data.category) {
                text = getTagInsertStringForAutocomplete(data.insertText, data.category);
            }
            insertTextAtPromptSelection(textarea, text);
            break;
        }
        case 'prompt-ctx-nax-favorite-insert': {
            const data = item && item.data;
            if (!data || !data.tag || !data.gallerySlug) break;
            insertTextAtPromptSelection(textarea, promptCtxFormatNaxTag(data.tag, data.gallerySlug));
            break;
        }
        case 'prompt-ctx-nax-expander-insert': {
            const data = item && item.data;
            if (!data || !data.insertText) break;
            insertTextAtPromptSelection(textarea, data.insertText);
            break;
        }
        case 'prompt-ctx-add-insert': {
            const ph = item && item.data && item.data.placeholder;
            if (ph) insertDynamicPlaceholderAtCaret(textarea, ph);
            break;
        }
        case 'prompt-ctx-set-insert': {
            const ph = item && item.data && item.data.placeholder;
            if (ph && promptCtxHasMeaningfulSelection(textarea)) {
                setDynamicPlaceholderOnSelection(textarea, ph, state.selectedText);
            }
            break;
        }
        case 'prompt-ctx-new-expander':
            if (promptCtxHasMeaningfulSelection(textarea)) {
                promptCtxShowTextExpanderDialog(state.selectedText.trim());
            } else {
                promptCtxShowTextExpanderDialog('');
            }
            break;
        case 'prompt-ctx-thesaurus-apply': {
            const data = item && item.data;
            if (data && applyWordLookupInsert) {
                promptCtxWithAutocompleteTarget(textarea, () => {
                    applyWordLookupInsert(textarea, data.original, data.synonym);
                });
            }
            break;
        }
        case 'prompt-ctx-add-to-step':
        case 'prompt-ctx-add-to-new-step':
        case 'prompt-ctx-open-phasewalker':
        case 'prompt-ctx-new-prefix-step':
            // handlePhasewalkerContextSubmenuAction: public/scripts/comp/runCommandIndex.js
            if (handlePhasewalkerContextSubmenuAction) {
                handlePhasewalkerContextSubmenuAction(item || { action, data: item && item.data }, {
                    stepAction: 'prompt-ctx-add-to-step',
                    newStepAction: 'prompt-ctx-add-to-new-step',
                    openEditorAction: 'prompt-ctx-open-phasewalker',
                    newPrefixAction: 'prompt-ctx-new-prefix-step'
                });
            }
            break;
        default:
            break;
    }
}

function getPromptTextareaContextMenuConfig() {
    return {
        maxHeight: true,
        onAction: (action, target, item) => {
            handlePromptTextareaContextMenuAction(action, target, item);
        },
        sections: [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fas fa-copy',
                        tooltip: 'Copy',
                        action: 'prompt-ctx-copy',
                        loadfn: (icon, target) => {
                            const s = getPromptTextareaMenuState(target);
                            icon.disabled = !s.hasSelection;
                        }
                    },
                    {
                        icon: 'fas fa-cut',
                        tooltip: 'Cut',
                        action: 'prompt-ctx-cut',
                        loadfn: (icon, target) => {
                            const s = getPromptTextareaMenuState(target);
                            icon.disabled = !s.hasSelection;
                        }
                    },
                    {
                        icon: 'fas fa-paste',
                        tooltip: 'Paste',
                        action: 'prompt-ctx-paste',
                        loadfn: (icon) => {
                            icon.disabled = !(navigator.clipboard && navigator.clipboard.readText);
                        }
                    },
                    {
                        icon: 'fas fa-square-dashed',
                        tooltip: 'Select all',
                        action: 'prompt-ctx-select-all'
                    },
                    {
                        icon: 'fas fa-search',
                        tooltip: 'Find Text',
                        action: 'prompt-ctx-find-in-prompt'
                    }
                ]
            },
            {
                type: 'icons',
                title: 'Blocks',
                icons: [
                    {
                        icon: 'fas fa-ban',
                        tooltip: 'Disable Selection',
                        action: 'prompt-ctx-toggle-disable',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target) || !promptCtxCanToggleDisableSyntax(target);
                            icon.tooltip = promptCtxGetDisableToggleTooltip(target);
                            icon.icon = promptCtxGetDisableToggleIcon(target);
                        }
                    },
                    {
                        icon: 'fas fa-trash-can',
                        tooltip: 'Remove Disabled Blocks',
                        action: 'prompt-ctx-delete-disabled-blocks',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target) || !promptCtxHasDisabledBlocks(target);
                        }
                    },
                    {
                        icon: 'fas fa-font-case',
                        tooltip: 'Lowercase',
                        action: 'prompt-ctx-lowercase',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target);
                        }
                    },
                    {
                        icon: 'fas fa-book-font',
                        tooltip: 'New Text Expander',
                        action: 'prompt-ctx-new-expander',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target);
                        }
                    }
                ]
            },
            {
                type: 'icons',
                title: 'Emphasis',
                icons: [
                    {
                        icon: 'fas fa-dial',
                        tooltip: 'Edit',
                        action: 'prompt-ctx-emphasis',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target);
                        }
                    },
                    {
                        icon: 'fas fa-distribute-spacing-horizontal',
                        tooltip: 'Split',
                        action: 'prompt-ctx-split-emphasis',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target);
                        }
                    },
                    {
                        icon: 'fas fa-broom-wide',
                        tooltip: 'Reset',
                        action: 'prompt-ctx-clear-emphasis',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target);
                        }
                    }
                ]
            },
            {
                type: 'list',
                initfn: (section, target) => {
                    if (promptCtxIsPromptTextarea(target)) {
                        promptCtxEnsureFavoritesLoaded();
                        void promptCtxEnsureNaxGalleriesLoaded();
                        void promptCtxEnsureNaxFavoritesLoaded();
                        void promptCtxEnsureNaxExpanderPresetsLoaded();
                    }
                },
                items: [
                    {
                        icon: 'fas fa-book-atlas',
                        text: 'Quick Access',
                        action: 'prompt-ctx-quick-access'
                    },
                    {
                        icon: 'fas fa-book',
                        text: 'Search Wiki',
                        action: 'prompt-ctx-search-wiki',
                        loadfn: (menuItem, target) => {
                            const s = getPromptTextareaMenuState(target);
                            menuItem.disabled = !s.contextTerm;
                        }
                    },
                    {
                        icon: 'fab fa-google',
                        text: 'Search Google',
                        action: 'prompt-ctx-search-google',
                        loadfn: (menuItem, target) => {
                            menuItem.disabled = !promptCtxHasMeaningfulSelection(target);
                        }
                    },
                    {
                        icon: 'fas fa-book-open',
                        text: 'Thesaurus',
                        openOnHover: true,
                        optionsfn: (target) => buildThesaurusSubmenuItems(target),
                        handlerfn: (subItem, target) => {
                            handlePromptTextareaContextMenuAction(subItem.action, target, subItem);
                        },
                        loadfn: (menuItem, target) => {
                            const s = getPromptTextareaMenuState(target);
                            menuItem.disabled = !s.contextTerm;
                        }
                    }
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-star',
                        text: 'Favorites',
                        openOnHover: true,
                        optionsfn: (target) => buildFavoritesSubmenuItems(target),
                        handlerfn: (subItem, target) => {
                            handlePromptTextareaContextMenuAction(subItem.action, target, subItem);
                        }
                    },
                    {
                        icon: 'fas fa-book-font',
                        text: 'Atelier Expanders',
                        openOnHover: true,
                        optionsfn: (target) => buildNaxtExpanderSubmenuItems(target),
                        handlerfn: (subItem, target) => {
                            handlePromptTextareaContextMenuAction(subItem.action, target, subItem);
                        }
                    },
                    {
                        icon: 'ri-pencil-ai-2-fill',
                        text: 'Tendai Block',
                        openOnHover: true,
                        loadfn: (menuItem, target) => {
                            menuItem.disabled = !promptCtxIsDynamicGenerationEnabled();
                        },
                        optionsfn: (target) => buildInsertSubmenuItems(target),
                        handlerfn: (subItem, target) => {
                            handlePromptTextareaContextMenuAction(subItem.action, target, subItem);
                        }
                    },
                    {
                        icon: 'fas fa-layer-group',
                        text: 'PhaseWalker',
                        action: 'prompt-ctx-open-phasewalker',
                        loadfn: (menuItem, target) => {
                            const show = !promptCtxHasTagContext(getPromptTextareaMenuState(target));
                            if (menuItem._element) {
                                menuItem._element.style.display = show ? '' : 'none';
                            }
                        }
                    },
                    {
                        icon: 'fas fa-layer-group',
                        text: 'PhaseWalker',
                        openOnHover: true,
                        optionsfn: (target) => buildAddToStepSubmenuItems(target),
                        handlerfn: (subItem, target) => {
                            handlePromptTextareaContextMenuAction(subItem.action, target, subItem);
                        },
                        loadfn: (menuItem, target) => {
                            const show = promptCtxHasTagContext(getPromptTextareaMenuState(target));
                            if (menuItem._element) {
                                menuItem._element.style.display = show ? '' : 'none';
                            }
                        }
                    }
                ]
            }
        ]
    };
}

const promptTextareaContextMenuConfig = getPromptTextareaContextMenuConfig();

function attachPromptTextareaContextMenu(textarea) {
    if (!textarea || !promptCtxIsPromptTextarea(textarea)) return;
    if (!contextMenu || textarea.hasAttribute('data-prompt-ctx-menu')) return;
    contextMenu.attachToElement(textarea, promptTextareaContextMenuConfig);
    textarea.setAttribute('data-prompt-ctx-menu', '1');
}

function initPromptTextareaContextMenu() {
    if (!contextMenu) return;
    document.querySelectorAll('textarea.prompt-textarea, textarea.character-prompt-textarea').forEach((ta) => {
        attachPromptTextareaContextMenu(ta);
    });
}

if (typeof window !== 'undefined') {
    window.initPromptTextareaContextMenu = initPromptTextareaContextMenu;
    window.attachPromptTextareaContextMenu = attachPromptTextareaContextMenu;
    window.invalidatePromptCtxNaxFavoritesCache = function invalidatePromptCtxNaxFavoritesCache() {
        promptCtxNaxFavoritesCache = null;
        promptCtxNaxFavoritesLoadPromise = null;
    };
    window.invalidatePromptCtxNaxExpanderPresetsCache = function invalidatePromptCtxNaxExpanderPresetsCache() {
        promptCtxNaxExpanderPresetsCache = null;
        promptCtxNaxExpanderPresetsCacheModel = null;
        promptCtxNaxExpanderPresetsLoadPromise = null;
    };
}
