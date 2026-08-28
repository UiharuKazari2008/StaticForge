/**
 * Right-click context menu for .prompt-textarea / .character-prompt-textarea
 * public/scripts/comp/contextMenu.js
 * public/scripts/comp/promptTextareaToolbar.js
 * public/scripts/comp/autocompleteUtils.js
 * public/scripts/comp/requestBodyReplacementsModal.js
 * public/scripts/comp/confirmationDialog.js
 * Emphasis: emphasisParse.js, emphasisEditing.js, emphasisHighlight.js, emphasisSyntaxToggles.js
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

const SET_EMPHASIS_WEIGHTS = [
    1.0, 1.125, 1.25, 1.35, 1.5, 1.75, 1.85, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0,
    0.0, 0.25, 0.5, 0.75, -1, -2
];

function promptCtxCurrentEmphasisWeight(textarea) {
    if (!textarea) return null;
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const pos = textarea.selectionStart;
    const block = findManagedEmphasisBlockAtCursor(textarea.value || '', pos, bag)
        || findManagedEmphasisBlockAtCursor(textarea.value || '', Math.max(0, pos - 1), bag);
    if (block && Number.isFinite(block.weight)) return block.weight;
    return null;
}

function buildSetEmphasisGridItems(textarea) {
    const current = promptCtxCurrentEmphasisWeight(textarea);
    return [{
        type: 'grid',
        items: SET_EMPHASIS_WEIGHTS.map((weight) => ({
            text: String(weight),
            tooltip: `Set emphasis to ${weight}`,
            action: 'prompt-ctx-set-emphasis',
            data: { weight },
            showIndicator: Number.isFinite(current),
            checked: Number.isFinite(current) && current === weight
        }))
    }];
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
    // isCursorInsideDisableBlock: public/scripts/comp/emphasisSyntaxToggles.js
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

/** Plain-text prompt fields (creative directive, director prompt) — spellcheck/thesaurus only. */
function promptCtxIsStandardTextPrompt(textarea) {
    return Boolean(textarea && textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt'));
}

function promptCtxIsCreativeDirectiveTextarea(textarea) {
    return promptCtxIsStandardTextPrompt(textarea);
}

function promptCtxHideMenuItemForStandardPrompt(menuItem, target) {
    const hide = promptCtxIsStandardTextPrompt(target);
    if (menuItem._element) {
        menuItem._element.style.display = hide ? 'none' : '';
    }
    if (hide) {
        menuItem.disabled = true;
    }
}

function promptCtxHasProtectedBlocks(textarea) {
    return /!%[^%]+%/.test(String(textarea && textarea.value ? textarea.value : ''));
}

function promptCtxWillEnableProtectBlock(textarea) {
    // isCursorInsideProtectBlock: public/scripts/comp/emphasisSyntaxToggles.js
    return isCursorInsideProtectBlock && isCursorInsideProtectBlock(textarea);
}

function promptCtxGetProtectToggleIcon(textarea) {
    return promptCtxWillEnableProtectBlock(textarea) ? 'fas fa-circle-check' : 'fas fa-shield-halved';
}

function promptCtxGetProtectToggleTooltip(textarea) {
    if (promptCtxWillEnableProtectBlock(textarea)) {
        return 'Unprotect Selection';
    }
    return 'Protect Selection';
}

function promptCtxCanToggleProtectSyntax(textarea) {
    if (promptCtxWillEnableProtectBlock(textarea)) return true;
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    return start !== end;
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

function promptCtxNormalizeExpanderPrefix(raw) {
    let value = String(raw || '').trim();
    if (value.charAt(0) === '!') value = value.slice(1);
    return value.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

function promptCtxFormatExpanderPrefix(name) {
    const prefix = promptCtxNormalizeExpanderPrefix(name);
    return prefix ? '!' + prefix : '';
}

function promptCtxGetEmbeddedExpanders() {
    return typeof requestBodyReplacements !== 'undefined' && Array.isArray(requestBodyReplacements)
        ? requestBodyReplacements
        : [];
}

function promptCtxNotifyPromptTextareaChanged(textarea) {
    if (!textarea) return;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
    if (window.promptTextareaToolbar) window.promptTextareaToolbar.updateTokenCount(textarea);
}

function promptCtxApplyExpanderPrefixToTextarea(textarea, prefix, rangeStart, rangeEnd, replaceRange) {
    const token = promptCtxFormatExpanderPrefix(prefix);
    if (!textarea || !token) return;
    const value = textarea.value || '';
    const start = Math.max(0, Math.min(Number(rangeStart) || 0, value.length));
    const end = Math.max(start, Math.min(Number(rangeEnd) || start, value.length));
    if (replaceRange) {
        // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
        replaceTextareaRangePreservingUndo(textarea, start, end, token);
        const pos = start + token.length;
        textarea.setSelectionRange(pos, pos);
    } else {
        const insertAt = end;
        replaceTextareaRangePreservingUndo(textarea, insertAt, insertAt, token);
        const pos = insertAt + token.length;
        textarea.setSelectionRange(pos, pos);
    }
    textarea.focus();
    promptCtxNotifyPromptTextareaChanged(textarea);
}

function promptCtxSaveEmbeddedExpander(name, value) {
    if (typeof requestBodyReplacements === 'undefined') {
        showGlassToast('error', null, 'Request expanders are unavailable', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return false;
    }
    requestBodyReplacements.push({
        name: name,
        value: value,
        extend: false
    });
    // renderRequestBodyReplacementsList: public/scripts/comp/requestBodyReplacementsModal.js
    if (renderRequestBodyReplacementsList) renderRequestBodyReplacementsList();
    showGlassToast('success', null, `Added request expander "!${name}"`, false, 3000, '<i class="fas fa-book-font"></i>');
    return true;
}

function promptCtxWireEmbeddedExpanderDialog(defaultPrefix, defaultValue) {
    const dialog = document.getElementById('confirmationDialog');
    if (!dialog) return;
    const prefixInput = dialog.querySelector('#promptCtxExpanderPrefix');
    const valueInput = dialog.querySelector('#promptCtxExpanderValue');
    const saveBtn = dialog.querySelector('#confirmationControls [data-dialog-primary="1"]');
    if (prefixInput) {
        prefixInput.value = defaultPrefix || '';
        prefixInput.addEventListener('input', (e) => {
            e.target.value = promptCtxNormalizeExpanderPrefix(e.target.value);
        });
        prefixInput.focus();
        prefixInput.select();
        setTimeout(() => {
            prefixInput.focus();
            prefixInput.select();
        }, 80);
    }
    if (valueInput) {
        valueInput.value = defaultValue || '';
    }
    const cancelBtn = dialog.querySelector('#confirmationControls button:not([data-dialog-primary])');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            const name = promptCtxNormalizeExpanderPrefix(prefixInput ? prefixInput.value : '');
            const text = valueInput ? String(valueInput.value || '').trim() : '';
            if (!name) {
                e.preventDefault();
                e.stopImmediatePropagation();
                showGlassToast('error', null, 'Please enter a prefix', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                if (prefixInput) prefixInput.focus();
                return;
            }
            if (!text) {
                e.preventDefault();
                e.stopImmediatePropagation();
                showGlassToast('error', null, 'Please enter expander text', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                if (valueInput) valueInput.focus();
            }
        }, true);
    }
}

async function promptCtxShowEmbeddedExpanderDialog(textarea, convert) {
    if (!textarea) return false;
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;
    const rangeStart = Math.min(start, end);
    const rangeEnd = Math.max(start, end);
    const selectedText = convert ? textarea.value.substring(rangeStart, rangeEnd) : '';
    const defaultPrefix = selectedText ? extractFirstTag(selectedText) : '';

    const html = `
        <div class="form-group">
            <label for="promptCtxExpanderPrefix">Prefix</label>
            <input type="text" id="promptCtxExpanderPrefix" class="form-control" placeholder="name" autocomplete="off" spellcheck="false">
        </div>
        <div class="form-group">
            <label for="promptCtxExpanderValue">Text</label>
            <textarea id="promptCtxExpanderValue" class="form-control" rows="6" placeholder="Expander text"></textarea>
        </div>
    `;

    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    // Hidden Cancel option so the window close button resolves as cancel.
    const dialogPromise = showConfirmationDialog(html, [
        { text: 'Save', value: 'ok', className: 'btn-primary', icon: 'fas fa-save', primary: true },
        { text: 'Cancel', value: null, className: 'btn-secondary' }
    ], null, {
        title: convert ? 'Convert Selection' : 'Create Text Expander',
        icon: 'fas fa-book-font',
        width: 480,
        showCloseButton: true,
        resolveValue: (value, dialog) => {
            if (value !== 'ok') return null;
            return {
                prefix: promptCtxNormalizeExpanderPrefix(dialog.querySelector('#promptCtxExpanderPrefix')?.value),
                text: String(dialog.querySelector('#promptCtxExpanderValue')?.value || '').trim()
            };
        }
    });
    setTimeout(() => promptCtxWireEmbeddedExpanderDialog(defaultPrefix, selectedText), 0);

    const result = await dialogPromise;
    if (!result || !result.prefix || !result.text) return false;
    if (!promptCtxSaveEmbeddedExpander(result.prefix, result.text)) return false;
    promptCtxApplyExpanderPrefixToTextarea(textarea, result.prefix, rangeStart, rangeEnd, convert);
    return true;
}

function buildTextExpandersSubmenuItems(textarea) {
    const items = [{
        text: 'Create New',
        icon: 'fas fa-plus',
        action: 'prompt-ctx-expander-create'
    }];
    const state = getPromptTextareaMenuState(textarea);
    if (state.hasSelection && state.selectedText.trim()) {
        items.push({
            text: 'Convert Selection',
            icon: 'fas fa-arrow-right-arrow-left',
            action: 'prompt-ctx-expander-convert'
        });
    }

    const expanders = promptCtxGetEmbeddedExpanders();
    if (expanders.length > 0) {
        items.push({ separator: true, text: 'Embedded' });
        expanders.forEach((exp) => {
            const name = exp && exp.name ? String(exp.name) : '';
            if (!name) return;
            items.push({
                text: '!' + name,
                icon: 'fas fa-book-font',
                action: 'prompt-ctx-expander-insert',
                data: { insertText: '!' + name }
            });
        });
    }
    return items;
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
        isCreativeDirective: promptCtxIsStandardTextPrompt(textarea)
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
            icon: 'fas fa-vial',
            badge: count,
            disabled: count === 0,
            action: 'prompt-ctx-nax-expander-insert',
            data: { insertText: preset.tryPattern || `!NAX_TRY_${preset.id}` }
        });
    });

    items.push({ separator: true, text: 'Any' });
    presets.forEach((preset) => {
        const count = preset.anyCount != null ? preset.anyCount : 0;
        items.push({
            text: preset.label || preset.id || '',
            icon: 'fas fa-layer-group',
            badge: count,
            disabled: count === 0,
            action: 'prompt-ctx-nax-expander-insert',
            data: { insertText: preset.anyPattern || `!NAX_ANY_${preset.id}` }
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

function promptCtxGetSelectionRange(textarea) {
    const rawStart = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const rawEnd = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    return {
        start: Math.min(rawStart, rawEnd),
        end: Math.max(rawStart, rawEnd)
    };
}

function promptCtxApplyPastedText(textarea, start, end, text) {
    if (text == null || text === '') return;
    // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
    replaceTextareaRangePreservingUndo(textarea, start, end, text);
    const pos = start + text.length;
    textarea.setSelectionRange(pos, pos);
    // settleManagedEmphasisAfterPaste: public/scripts/comp/emphasisGroupIdCodec.js
    // Expands classic N:: → managed ids for the target field (main ↔ character safe).
    settleManagedEmphasisAfterPaste(textarea, pos);
}

function promptCtxCopySelectedText(textarea) {
    if (!promptCtxHasMeaningfulSelection(textarea)) return;
    const { start, end } = promptCtxGetSelectionRange(textarea);
    // selectionNeedsManagedClipboardExpand / getManagedEmphasisClipboardTextForSelection:
    //   public/scripts/comp/emphasisGroupIdCodec.js
    const text = selectionNeedsManagedClipboardExpand(textarea.value || '', start, end)
        ? getManagedEmphasisClipboardTextForSelection(textarea)
        : textarea.value.substring(start, end);
    // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
    copyTextToClipboard(text).catch(() => {
        textarea.focus();
        document.execCommand('copy');
    });
}

function promptCtxCutSelectedText(textarea) {
    if (!promptCtxHasMeaningfulSelection(textarea)) return;
    const { start, end } = promptCtxGetSelectionRange(textarea);
    // selectionNeedsManagedClipboardExpand / cutManagedEmphasisSelection:
    //   public/scripts/comp/emphasisGroupIdCodec.js
    if (selectionNeedsManagedClipboardExpand(textarea.value || '', start, end)) {
        const text = cutManagedEmphasisSelection(textarea);
        copyTextToClipboard(text).catch(() => { /* cut already applied */ });
        return;
    }
    const text = textarea.value.substring(start, end);
    // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
    copyTextToClipboard(text).then(() => {
        // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
        replaceTextareaRangePreservingUndo(textarea, start, end, '');
        textarea.setSelectionRange(start, start);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }).catch(() => {
        textarea.focus();
        document.execCommand('cut');
    });
}

function promptCtxPasteIntoTextarea(textarea) {
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    // readClipboardTextFast: public/scripts/utils/dreamscapeClipboard.js
    readClipboardTextFast().then((text) => {
        promptCtxApplyPastedText(textarea, start, end, text);
    }).catch(() => {
        textarea.focus();
        document.execCommand('paste');
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
            promptCtxCutSelectedText(textarea);
            break;
        case 'prompt-ctx-copy':
            promptCtxCopySelectedText(textarea);
            break;
        case 'prompt-ctx-paste':
            promptCtxPasteIntoTextarea(textarea);
            break;
        case 'prompt-ctx-select-all':
            textarea.focus();
            textarea.setSelectionRange(0, textarea.value.length);
            break;
        case 'prompt-ctx-search-wiki': {
            const term = state.contextTerm;
            if (term) {
                // public/scripts/comp/featureLoader.js
                void featureLoader.loadFeature('grimoire').then(() => {
                    tagWikiSearchModal.openSearchForTerm(term);
                });
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
        case 'prompt-ctx-emphasis-groups':
            if (emphasisGroupsToolManager) {
                emphasisGroupsToolManager.openForTextarea(textarea);
            }
            break;
        case 'prompt-ctx-split-emphasis':
            // splitEmphasisBlock: public/scripts/comp/emphasisParse.js
            if (splitEmphasisBlock) splitEmphasisBlock(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
            break;
        case 'prompt-ctx-split-emphasis-commas':
            // splitEmphasisGroupAtCommasAtCursor: public/scripts/comp/emphasisParse.js
            if (splitEmphasisGroupAtCommasAtCursor) splitEmphasisGroupAtCommasAtCursor(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
            break;
        case 'prompt-ctx-clear-emphasis':
            if (removeAllEmphasisFromSelection) removeAllEmphasisFromSelection(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
            break;
        case 'prompt-ctx-trim-start':
            // trimManagedEmphasisStartAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
            trimManagedEmphasisStartAtCaret(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
            if (promptTextareaToolbar) promptTextareaToolbar.updateEmphasisGroupChip(textarea, toolbar);
            break;
        case 'prompt-ctx-trim-end':
            // trimManagedEmphasisEndAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
            trimManagedEmphasisEndAtCaret(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
            if (promptTextareaToolbar) promptTextareaToolbar.updateEmphasisGroupChip(textarea, toolbar);
            break;
        case 'prompt-ctx-remove-emphasis':
            if (promptTextareaToolbar) {
                promptTextareaToolbar.removeEmphasisAtCaretOrSelection(textarea);
            }
            break;
        case 'prompt-ctx-set-emphasis': {
            const weight = item && item.data ? item.data.weight : null;
            // applySetEmphasisWeight: public/scripts/comp/emphasisEditing.js
            applySetEmphasisWeight(textarea, weight);
            if (promptTextareaToolbar) promptTextareaToolbar.updateEmphasisGroupChip(textarea, toolbar);
            break;
        }
        case 'prompt-ctx-lowercase':
            if (window.promptTextareaToolbar) {
                window.promptTextareaToolbar.lowercasePromptText(textarea);
            }
            break;
        case 'prompt-ctx-toggle-disable':
            if (!promptCtxCanToggleDisableSyntax(textarea)) break;
            // toggleDisableSyntax: public/scripts/comp/emphasisSyntaxToggles.js
            if (toggleDisableSyntax) toggleDisableSyntax(textarea);
            break;
        case 'prompt-ctx-toggle-protect':
            if (!promptCtxCanToggleProtectSyntax(textarea)) break;
            // toggleProtectSyntax: public/scripts/comp/emphasisSyntaxToggles.js
            if (toggleProtectSyntax) toggleProtectSyntax(textarea);
            break;
        case 'prompt-ctx-delete-disabled-blocks':
            promptCtxDeleteAllDisabledBlocks(textarea);
            break;
        case 'prompt-ctx-quick-access':
            // public/scripts/comp/featureLoader.js
            void featureLoader.loadFeature('dataset_tag_toolbar').then(() => showDatasetTagToolbar());
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
        case 'prompt-ctx-expander-create':
            void promptCtxShowEmbeddedExpanderDialog(textarea, false);
            break;
        case 'prompt-ctx-expander-convert':
            if (!promptCtxHasMeaningfulSelection(textarea)) break;
            void promptCtxShowEmbeddedExpanderDialog(textarea, true);
            break;
        case 'prompt-ctx-expander-insert': {
            const data = item && item.data;
            if (!data || !data.insertText) break;
            insertTextAtPromptSelection(textarea, data.insertText);
            break;
        }
        case 'prompt-ctx-thesaurus-apply': {
            const data = item && item.data;
            if (data && applyWordLookupInsert) {
                promptCtxWithAutocompleteTarget(textarea, () => {
                    const term = state.contextTerm;
                    const key = term + '|' + (textarea.id || '');
                    const cached = promptCtxThesaurusCache.get(key);
                    // primeWordLookupReplaceContext: public/scripts/comp/autocompleteUtils.js
                    if (typeof primeWordLookupReplaceContext === 'function') {
                        primeWordLookupReplaceContext(textarea, term, cached && cached.data);
                    }
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
                        action: 'prompt-ctx-paste'
                    },
                    {
                        icon: 'fas fa-square-dashed',
                        tooltip: 'Select all',
                        action: 'prompt-ctx-select-all'
                    },
                    {
                        icon: 'fas fa-search',
                        tooltip: 'Find Text',
                        action: 'prompt-ctx-find-in-prompt',
                        loadfn: (icon, target) => {
                            promptCtxHideMenuItemForStandardPrompt(icon, target);
                        }
                    }
                ]
            },
            {
                type: 'icons',
                title: 'Blocks',
                loadfn: (section, target) => {
                    const isStandard = promptCtxIsStandardTextPrompt(target);
                    if (section._element) {
                        section._element.style.display = isStandard && !promptCtxIsDynamicGenerationEnabled() ? 'none' : '';
                    }
                },
                icons: [
                    {
                        icon: 'fas fa-ban',
                        tooltip: 'Disable Selection',
                        action: 'prompt-ctx-toggle-disable',
                        loadfn: (icon, target) => {
                            const isStandard = promptCtxIsStandardTextPrompt(target);
                            if (icon._element) {
                                icon._element.style.display = isStandard ? 'none' : '';
                            }
                            icon.disabled = !promptCtxCanToggleDisableSyntax(target);
                            icon.tooltip = promptCtxGetDisableToggleTooltip(target);
                            icon.icon = promptCtxGetDisableToggleIcon(target);
                        }
                    },
                    {
                        icon: 'fas fa-shield-halved',
                        tooltip: 'Protect Selection',
                        action: 'prompt-ctx-toggle-protect',
                        loadfn: (icon, target) => {
                            if (icon._element) {
                                icon._element.style.display = '';
                            }
                            const dgOn = promptCtxIsDynamicGenerationEnabled();
                            icon.disabled = !dgOn || !promptCtxCanToggleProtectSyntax(target);
                            icon.tooltip = promptCtxGetProtectToggleTooltip(target);
                            icon.icon = promptCtxGetProtectToggleIcon(target);
                        }
                    },
                    {
                        icon: 'fas fa-trash-can',
                        tooltip: 'Remove Disabled Blocks',
                        action: 'prompt-ctx-delete-disabled-blocks',
                        loadfn: (icon, target) => {
                            const isStandard = promptCtxIsStandardTextPrompt(target);
                            if (icon._element) {
                                icon._element.style.display = isStandard ? 'none' : '';
                            }
                            icon.disabled = !promptCtxHasDisabledBlocks(target);
                        }
                    },
                    {
                        icon: 'fas fa-font-case',
                        tooltip: 'Lowercase',
                        action: 'prompt-ctx-lowercase',
                        loadfn: (icon, target) => {
                            const isStandard = promptCtxIsStandardTextPrompt(target);
                            if (icon._element) {
                                icon._element.style.display = isStandard ? 'none' : '';
                            }
                            icon.disabled = isStandard;
                        }
                    },
                    {
                        icon: 'fas fa-book-font',
                        tooltip: 'New Text Expander',
                        action: 'prompt-ctx-new-expander',
                        loadfn: (icon, target) => {
                            const isStandard = promptCtxIsStandardTextPrompt(target);
                            if (icon._element) {
                                icon._element.style.display = isStandard ? 'none' : '';
                            }
                            icon.disabled = isStandard;
                        }
                    }
                ]
            },
            {
                type: 'icons',
                title: 'Emphasis',
                loadfn: (section, target) => {
                    if (section._element) {
                        section._element.style.display = promptCtxIsStandardTextPrompt(target) ? 'none' : '';
                    }
                },
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
                        icon: 'fas fa-weight-scale',
                        tooltip: 'Weight Rack',
                        action: 'prompt-ctx-emphasis-groups',
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
                        icon: 'fas fa-bracket-square',
                        tooltip: 'Trim start',
                        action: 'prompt-ctx-trim-start',
                        loadfn: (icon, target) => {
                            if (promptCtxIsCreativeDirectiveTextarea(target)) {
                                icon.disabled = true;
                                return;
                            }
                            // canTrimManagedEmphasisStartAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                            icon.disabled = !canTrimManagedEmphasisStartAtCaret(target);
                        }
                    },
                    {
                        icon: 'fas fa-bracket-square-right',
                        tooltip: 'Trim end',
                        action: 'prompt-ctx-trim-end',
                        loadfn: (icon, target) => {
                            if (promptCtxIsCreativeDirectiveTextarea(target)) {
                                icon.disabled = true;
                                return;
                            }
                            // canTrimManagedEmphasisEndAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                            icon.disabled = !canTrimManagedEmphasisEndAtCaret(target);
                        }
                    },
                    {
                        icon: 'fas fa-eraser',
                        tooltip: 'Remove Emphasis',
                        action: 'prompt-ctx-remove-emphasis',
                        loadfn: (icon, target) => {
                            icon.disabled = promptCtxIsCreativeDirectiveTextarea(target);
                        }
                    }
                ]
            },
            {
                type: 'list',
                loadfn: (section, target) => {
                    if (section._element) {
                        section._element.style.display = promptCtxIsStandardTextPrompt(target) ? 'none' : '';
                    }
                },
                items: [
                    {
                        icon: 'fas fa-dial',
                        text: 'Set Emphasis',
                        openOnHover: true,
                        loadfn: (menuItem, target) => {
                            menuItem.disabled = promptCtxIsCreativeDirectiveTextarea(target);
                        },
                        optionsfn: (target) => buildSetEmphasisGridItems(target),
                        handlerfn: (subItem, target) => {
                            handlePromptTextareaContextMenuAction(subItem.action, target, subItem);
                        }
                    },
                    {
                        icon: 'fas fa-knife-kitchen',
                        text: 'Subdivide Emphasis',
                        action: 'prompt-ctx-split-emphasis-commas',
                        loadfn: (menuItem, target) => {
                            if (promptCtxIsCreativeDirectiveTextarea(target)) {
                                menuItem.disabled = true;
                                return;
                            }
                            // canSplitEmphasisGroupAtCommasAtCursor: public/scripts/comp/emphasisParse.js
                            menuItem.disabled = !canSplitEmphasisGroupAtCommasAtCursor(target);
                        }
                    },
                    {
                        icon: 'fas fa-broom-wide',
                        text: 'Remove All',
                        action: 'prompt-ctx-clear-emphasis',
                        loadfn: (menuItem, target) => {
                            menuItem.disabled = promptCtxIsCreativeDirectiveTextarea(target);
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
                        action: 'prompt-ctx-quick-access',
                        loadfn: (menuItem, target) => {
                            promptCtxHideMenuItemForStandardPrompt(menuItem, target);
                        }
                    },
                    {
                        icon: 'fas fa-book',
                        text: 'Search Wiki',
                        action: 'prompt-ctx-search-wiki',
                        loadfn: (menuItem, target) => {
                            promptCtxHideMenuItemForStandardPrompt(menuItem, target);
                            const s = getPromptTextareaMenuState(target);
                            menuItem.disabled = !s.contextTerm;
                        }
                    },
                    {
                        icon: 'fab fa-google',
                        text: 'Search Google',
                        action: 'prompt-ctx-search-google',
                        loadfn: (menuItem, target) => {
                            promptCtxHideMenuItemForStandardPrompt(menuItem, target);
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
                loadfn: (section, target) => {
                    if (section._element) {
                        section._element.style.display = promptCtxIsStandardTextPrompt(target) ? 'none' : '';
                    }
                },
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
                        text: 'Text Expanders',
                        openOnHover: true,
                        optionsfn: (target) => buildTextExpandersSubmenuItems(target),
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
