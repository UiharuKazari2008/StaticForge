// Image Expansion Modal Component

let expansionModalData = {
    filename: null, // The current file that was clicked to open the modal (never changes, used for resolution)
    originalImage: null, // The source/original image (may be different if current file is expanded)
    originalDimensions: null,
    lastImage: null, // The actual image to expand (different from source if expanding current/last)
    targetImage: null, // The image that will be expanded (determined by mode)
    expansionMode: 'source', // 'source', 'current', or 'last'
    selectedResolution: null,
    selectedBias: 2, // Default to center
    upscaleAfterComplete: false,
    overrideParams: {},
    enableAI: false, // Default to disabled
    enableInset: false, // Default to disabled
    expandSourcePixels: null, // { width, height } of image being expanded (for inset eligibility)
    compiledPrompt: null, // { prompt, uc, characterPrompts } baseline from server (not sent unless editor save)
    savedPromptOverrides: null, // { prompt, uc, characterPrompts } set only via expansion prompt editor Save
    compiledPromptReady: false
};

let expansionCompiledPromptLoadToken = 0;
let expansionCompiledPromptReloadTimer = null;
let expansionModalBootstrapping = false;

/** Tear down manual preview + Rentan overlay after expand/reroll (success, error, or cancel). */
function finishExpansionGenerationUi() {
    const manualForm = document.getElementById('manualForm');
    if (manualForm) {
        manualForm.classList.remove('generating', 'streaming');
    }
    if (window.wsClient) {
        window.wsClient.clearStreamingStepQueues(null, true);
    }
    // hideDynamicGenerationProgressOverlayImmediate: public/scripts/comp/manualModalManager.js
    hideDynamicGenerationProgressOverlayImmediate();
    if (typeof stopPreviewAnimation === 'function') {
        stopPreviewAnimation();
    }
}

function normalizeExpansionCharacterPrompts(arr) {
    if (!Array.isArray(arr)) {
        return [];
    }
    return arr.map((char) => ({ ...char }));
}

function getExpansionCharacterDisplayName(char, index) {
    return char.chara_name || char.name || `Character ${index + 1}`;
}

function isExpansionCompiledPromptEditorOpen() {
    const dialog = document.getElementById('expansionCompiledPromptDialog');
    return !!(dialog && dialog.classList.contains('visible'));
}

function clearExpansionCompiledCharacterFields() {
    const promptContainer = document.getElementById('expansionCompiledCharacterPromptsContainer');
    const ucContainer = document.getElementById('expansionCompiledCharacterUcContainer');

    [promptContainer, ucContainer].forEach((container) => {
        if (!container) return;

        container.querySelectorAll('textarea').forEach((textarea) => {
            // stopEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
            if (emphasisHighlightingTarget === textarea) {
                stopEmphasisHighlighting();
            }
            // cleanupSafeEventListeners: public/scripts/comp/utilities.js
            cleanupSafeEventListeners(textarea);
        });

        container.querySelectorAll('.prompt-textarea-toolbar.search-mode').forEach((toolbar) => {
            // closeSearch: public/scripts/comp/promptTextareaToolbar.js
            if (window.promptTextareaToolbar) {
                window.promptTextareaToolbar.closeSearch(toolbar);
            }
        });

        // teardownDropdown: public/scripts/comp/dropdown.js
        container.querySelectorAll('.custom-dropdown').forEach((dropdown) => {
            teardownDropdown(dropdown);
        });

        container.innerHTML = '';
    });
}

/** Reinit custom scrollbars on prompt/UC tab panes — customScrollbar.js */
function refreshExpansionCompiledPromptScrollbars() {
    if (!window.customScrollbar) {
        return;
    }
    const promptTab = document.getElementById('expansionCompiledPrompt-tab');
    const ucTab = document.getElementById('expansionCompiledUc-tab');
    if (promptTab) {
        window.customScrollbar.forceReinit(promptTab);
    }
    if (ucTab) {
        window.customScrollbar.forceReinit(ucTab);
    }
}

/** Character textarea markup from loadCharacterPrompts() in app.js; dropdowns via initializeCharacterDropdowns() in promptTextareaToolbar.js */
function getExpansionCharacterPromptTextareaHtml(characterId, field, text) {
    const body = text != null ? text : '';
    const safeId = escapeHtmlAttribute(characterId);

    if (field === 'uc') {
        return `
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <div class="prompt-textarea-emphasis-wrap">
                                <textarea id="${safeId}_uc" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter undesired content..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${escapeHtml(body)}</textarea>
                            </div>
                            <div class="prompt-textarea-emphasis-wrap">
                                <textarea id="${safeId}_promptNegative" class="form-control character-prompt-textarea prompt-textarea" placeholder="Inline negative (merged into prompt as -1::...::)..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false"></textarea>
                            </div>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <div class="token-info-container">
                                        <div class="token-info-top"><span class="token-count">0 tokens</span></div>
                                        <div class="token-progress-bar"><div class="token-progress-fill"><div class="token-progress-inner"></div><div class="token-progress-inner-ne"></div></div></div>
                                    </div>
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container"><input type="text" class="text-search-input" placeholder="Find Tag" /></div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="quick-access" title="Quick Access"><i class="fas fa-book-atlas"></i></button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="search" title="Search"><i class="fas fa-search"></i></button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toggle-btn" data-action="autofill" data-state="on" title="Toggle Autofill"><i class="fas fa-lightbulb"></i></button>
                                        <div id="characterUCActionsDropdown_${safeId}" class="custom-dropdown dark dropright">
                                            <button type="button" id="characterUCActionsDropdownBtn_${safeId}" class="btn-secondary btn-small toolbar-btn"><i class="fas fa-toolbox"></i></button>
                                            <div id="characterUCActionsDropdownMenu_${safeId}" class="custom-dropdown-menu hidden"></div>
                                        </div>
                                    </div>
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>`;
    }

    return `
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${safeId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${escapeHtml(body)}</textarea>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <div class="token-info-container">
                                        <div class="token-info-top"><span class="token-count">0 tokens</span></div>
                                        <div class="token-progress-bar"><div class="token-progress-fill"><div class="token-progress-inner"></div><div class="token-progress-inner-ne"></div></div></div>
                                    </div>
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container"><input type="text" class="text-search-input" placeholder="Find Tag" /></div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="quick-access" title="Quick Access"><i class="fas fa-book-atlas"></i></button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="search" title="Search"><i class="fas fa-search"></i></button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toggle-btn" data-action="autofill" data-state="on" title="Toggle Autofill"><i class="fas fa-lightbulb"></i></button>
                                        <div id="characterActionsDropdown_${safeId}" class="custom-dropdown dark dropright">
                                            <button type="button" id="characterActionsDropdownBtn_${safeId}" class="btn-secondary btn-small toolbar-btn"><i class="fas fa-toolbox"></i></button>
                                            <div id="characterActionsDropdownMenu_${safeId}" class="custom-dropdown-menu hidden"></div>
                                        </div>
                                    </div>
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>`;
}

function renderExpansionCompiledCharacterFields(source) {
    const promptContainer = document.getElementById('expansionCompiledCharacterPromptsContainer');
    const ucContainer = document.getElementById('expansionCompiledCharacterUcContainer');
    if (!promptContainer || !ucContainer) {
        return;
    }

    clearExpansionCompiledCharacterFields();
    const characterPrompts = normalizeExpansionCharacterPrompts(source?.characterPrompts);

    characterPrompts.forEach((char, index) => {
        if (char.enabled === false) {
            return;
        }

        const charName = getExpansionCharacterDisplayName(char, index);
        const promptValue = char.prompt != null ? char.prompt : '';
        const ucValue = char.uc != null ? char.uc : '';
        const promptNegativeValue = char.input_prompt_negative != null ? char.input_prompt_negative : '';

        const promptField = document.createElement("div");
        promptField.className = 'compiled-prompt-field-container';
        promptField.innerHTML = `<label class="compiled-prompt-label"><i class="ri-code-block"></i> Prompt - ${escapeHtml(charName)}</label>`;
        const characterId = `expansionChar_${index}`;
        promptField.innerHTML += getExpansionCharacterPromptTextareaHtml(characterId, 'prompt', promptValue);
        promptContainer.appendChild(promptField);
        const promptTextarea = document.getElementById(`${characterId}_prompt`);
        if (promptTextarea) {
            promptTextarea.setAttribute('data-char-index', String(index));
            setupPromptTextareaControls(promptTextarea);
            if (typeof initializeEmphasisOverlay === 'function') {
                initializeEmphasisOverlay(promptTextarea);
            }
        }

        const ucField = document.createElement('div');
        ucField.className = 'compiled-prompt-field-container';
        ucField.innerHTML = `<label class="compiled-prompt-label"><i class="ri-eraser-fill"></i> Negative - ${escapeHtml(charName)}</label>`;
        ucField.innerHTML += getExpansionCharacterPromptTextareaHtml(characterId, 'uc', ucValue);
        ucContainer.appendChild(ucField);
        const ucTextarea = document.getElementById(`${characterId}_uc`);
        const ucPromptNegativeTextarea = document.getElementById(`${characterId}_promptNegative`);
        if (ucPromptNegativeTextarea && promptNegativeValue) {
            ucPromptNegativeTextarea.value = promptNegativeValue;
        }
        if (ucTextarea) {
            ucTextarea.setAttribute('data-char-index', String(index));
            setupPromptTextareaControls(ucTextarea);
            if (typeof initializeEmphasisOverlay === 'function') {
                initializeEmphasisOverlay(ucTextarea);
            }
        }

        if (promptTextarea && typeof autoResizeTextarea === 'function') {
            autoResizeTextarea(promptTextarea);
        }
        if (ucTextarea && typeof autoResizeTextarea === 'function') {
            autoResizeTextarea(ucTextarea);
        }
        if (promptTextarea && typeof updateEmphasisHighlighting === 'function') {
            updateEmphasisHighlighting(promptTextarea);
        }
        if (ucTextarea && typeof updateEmphasisHighlighting === 'function') {
            updateEmphasisHighlighting(ucTextarea);
        }
    });

    if (window.promptTextareaToolbar) {
        promptTextareaToolbar.initializeCharacterDropdowns();
    }

    requestAnimationFrame(() => {
        refreshExpansionCompiledPromptScrollbars();
    });
}

function collectExpansionCompiledPromptState() {
    const baseline = expansionModalData.savedPromptOverrides || expansionModalData.compiledPrompt;
    const fullChars = normalizeExpansionCharacterPrompts(baseline?.characterPrompts);
    const promptInput = document.getElementById('expansionCompiledPromptInput');
    const ucInput = document.getElementById('expansionCompiledUcInput');

    const characterPrompts = fullChars.map((char, index) => {
        const next = { ...char };
        if (char.enabled !== false) {
            const promptEl = document.getElementById(`expansionChar_${index}_prompt`);
            const ucEl = document.getElementById(`expansionChar_${index}_uc`);
            const promptNegativeEl = document.getElementById(`expansionChar_${index}_promptNegative`);
            if (promptEl) {
                next.prompt = promptEl.value;
            }
            if (ucEl) {
                next.uc = ucEl.value;
            }
            if (promptNegativeEl) {
                next.input_prompt_negative = promptNegativeEl.value;
            }
        }
        return next;
    });

    return {
        prompt: promptInput ? promptInput.value : (baseline?.prompt || ''),
        uc: ucInput ? ucInput.value : (baseline?.uc || ''),
        characterPrompts
    };
}

function applyExpansionSavedOverridesToParams(overrideParams) {
    if (!expansionModalData.savedPromptOverrides) {
        return overrideParams;
    }
    const merged = { ...overrideParams };
    merged.expansionPromptOverride = expansionModalData.savedPromptOverrides.prompt;
    merged.expansionUcOverride = expansionModalData.savedPromptOverrides.uc;
    if (Array.isArray(expansionModalData.savedPromptOverrides.characterPrompts)) {
        merged.expansionCharacterPromptsOverride = expansionModalData.savedPromptOverrides.characterPrompts;
    }
    return merged;
}

function syncExpansionEnableAIFromToggle() {
    const aiToggle = document.getElementById('expansionAIToggle');
    expansionModalData.enableAI = aiToggle ? aiToggle.getAttribute('data-state') === 'on' : false;
}

function clearExpansionSavedPromptOverrides() {
    expansionModalData.savedPromptOverrides = null;
    updateExpansionEditCompiledPromptBtnState();
}

function updateExpansionEditCompiledPromptBtnState() {
    const btn = document.getElementById('expansionEditCompiledPromptBtn');
    if (btn) {
        btn.setAttribute('data-state', expansionModalData.savedPromptOverrides ? 'on' : 'off');
    }
}

function switchExpansionCompiledPromptTab(targetTab, shouldFocus = false) {
    const dialog = document.getElementById('expansionCompiledPromptDialog');
    if (!dialog) {
        return;
    }

    const toggleGroup = dialog.querySelector('.prompt-tabs .gallery-toggle-group');
    const tabButtons = dialog.querySelectorAll('.prompt-tabs .gallery-toggle-btn');
    const tabPanes = dialog.querySelectorAll('.prompt-tabs .tab-pane');
    const previouslyFocused = document.activeElement;

    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabPanes.forEach(pane => pane.classList.remove('active'));

    const targetButton = dialog.querySelector(`.prompt-tabs .gallery-toggle-btn[data-tab="${targetTab}"]`);
    const targetPane = document.getElementById(
        targetTab === 'prompt' ? 'expansionCompiledPrompt-tab' : 'expansionCompiledUc-tab'
    );

    if (targetButton) {
        targetButton.classList.add('active');
    }
    if (targetPane) {
        targetPane.classList.add('active');
    }
    if (toggleGroup) {
        toggleGroup.setAttribute('data-active', targetTab);
    }

    let focusTarget = null;
    if (shouldFocus || (previouslyFocused && previouslyFocused.closest('#expansionCompiledPromptDialog'))) {
        if (targetPane) {
            focusTarget = targetPane.querySelector('textarea');
        }
        if (!focusTarget) {
            focusTarget = targetTab === 'prompt'
                ? document.getElementById('expansionCompiledPromptInput')
                : document.getElementById('expansionCompiledUcInput');
        }
    }

    if (focusTarget) {
        setTimeout(() => {
            if (focusTarget && focusTarget.focus) {
                focusTarget.focus();
            }
            if (typeof autoResizeTextarea === 'function') {
                autoResizeTextarea(focusTarget);
            }
        }, 0);
    }

    requestAnimationFrame(() => {
        if (targetPane && window.customScrollbar && window.customScrollbar.scrollbars.has(targetPane)) {
            window.customScrollbar.updateScrollbar(targetPane);
        } else if (targetPane) {
            refreshExpansionCompiledPromptScrollbars();
        }
    });
}

function setupExpansionCompiledPromptTabSwitcher() {
    const dialog = document.getElementById('expansionCompiledPromptDialog');
    if (!dialog || dialog.dataset.expansionTabSwitcherInit === '1') {
        return;
    }
    dialog.dataset.expansionTabSwitcherInit = '1';

    dialog.querySelectorAll('.prompt-tabs .gallery-toggle-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            switchExpansionCompiledPromptTab(button.getAttribute('data-tab'));
        });
    });
}

function openExpansionCompiledPromptEditor() {
    if (!expansionModalData.compiledPromptReady || !expansionModalData.compiledPrompt) {
        showGlassToast('error', 'Error', 'Compiled prompt is not ready yet', false, 5000, '<i class="nai-cross"></i>');
        return;
    }

    const dialog = document.getElementById('expansionCompiledPromptDialog');
    const promptInput = document.getElementById('expansionCompiledPromptInput');
    const ucInput = document.getElementById('expansionCompiledUcInput');
    if (!dialog || !promptInput || !ucInput) {
        return;
    }

    const source = expansionModalData.savedPromptOverrides || expansionModalData.compiledPrompt;
    promptInput.value = source.prompt != null ? source.prompt : '';
    ucInput.value = source.uc != null ? source.uc : '';
    renderExpansionCompiledCharacterFields(source);

    switchExpansionCompiledPromptTab('prompt');

    const parentModal = document.getElementById('imageExpansionDialog');
    if (parentModal && typeof linkToolWindowToParent === 'function') {
        linkToolWindowToParent(dialog, parentModal);
    }

    openModal(dialog);
    dialog.classList.add('visible');

    if (window.promptTextareaToolbar && typeof window.promptTextareaToolbar.initializeExpansionCompiledPromptDropdowns === 'function') {
        window.promptTextareaToolbar.initializeExpansionCompiledPromptDropdowns();
    }

    if (typeof bringModalToFront === 'function') {
        bringModalToFront(dialog);
    }

    if (typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(promptInput);
        autoResizeTextarea(ucInput);
    }
    if (typeof updateEmphasisHighlighting === 'function') {
        updateEmphasisHighlighting(promptInput);
        updateEmphasisHighlighting(ucInput);
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            refreshExpansionCompiledPromptScrollbars();
            if (typeof cascadeModalFromParentIfConfigured === 'function') {
                cascadeModalFromParentIfConfigured(dialog);
            } else if (typeof ensureModalWithinViewport === 'function') {
                ensureModalWithinViewport(dialog);
            }
        });
    });
}

function closeExpansionCompiledPromptEditor() {
    const dialog = document.getElementById('expansionCompiledPromptDialog');
    if (!dialog) {
        return;
    }
    if (window.promptTextareaToolbar) {
        dialog.querySelectorAll('.prompt-textarea-toolbar.search-mode').forEach((toolbar) => {
            window.promptTextareaToolbar.closeSearch(toolbar);
        });
    }
    clearExpansionCompiledCharacterFields();
    dialog.classList.remove('visible');
    closeModal(dialog);
}

function setupExpansionCompiledPromptTextareas() {
    const promptInput = document.getElementById('expansionCompiledPromptInput');
    const ucInput = document.getElementById('expansionCompiledUcInput');
    if (promptInput) {
        setupPromptTextareaControls(promptInput);
    }
    if (ucInput) {
        setupPromptTextareaControls(ucInput);
    }
    // Toolbox dropdowns: promptTextareaToolbar.initializeDropdowns() (init step 37, after this DOM exists)
}

function saveExpansionCompiledPromptForSubmission() {
    const promptInput = document.getElementById('expansionCompiledPromptInput');
    const ucInput = document.getElementById('expansionCompiledUcInput');
    if (!promptInput || !ucInput) {
        return;
    }

    expansionModalData.savedPromptOverrides = collectExpansionCompiledPromptState();
    updateExpansionEditCompiledPromptBtnState();
    closeExpansionCompiledPromptEditor();
}

function getExpansionPreviewParamsFromUI() {
    syncExpansionEnableAIFromToggle();

    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    const upscaleAfterComplete = upscaleToggle ? upscaleToggle.getAttribute('data-state') === 'on' : false;
    const insetToggle = document.getElementById('expansionInsetToggle');
    expansionModalData.enableInset = insetToggle ? insetToggle.getAttribute('data-state') === 'on' : false;

    let overrideParams = {};
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    if (advancedSection && !advancedSection.classList.contains('hidden')) {
        overrideParams = getExpansionOverrideParams();
    }
    const requestedContentTextarea = document.getElementById('expansionRequestedContent');
    if (requestedContentTextarea && requestedContentTextarea.value.trim()) {
        overrideParams.requestedContent = requestedContentTextarea.value.trim();
    }
    overrideParams.inset = expansionModalData.enableInset;

    return {
        filename: expansionModalData.targetImage,
        sourceFilename: expansionModalData.originalImage || expansionModalData.targetImage,
        resolution: expansionModalData.selectedResolution,
        imageBias: expansionModalData.selectedBias,
        upscaleAfterComplete,
        overrideParams,
        inset: expansionModalData.enableInset,
        enableInset: expansionModalData.enableInset,
        workspace: activeWorkspace || null,
        enableAI: expansionModalData.enableAI
    };
}

async function fetchExpansionCompiledPrompt(options = {}) {
    const { showToast = false, blockUI = false } = options;

    if (!expansionModalData.targetImage || !expansionModalData.selectedResolution) {
        return { ok: false, error: new Error('Missing image or resolution') };
    }
    if (!wsClient || !wsClient.isConnected()) {
        return { ok: false, error: new Error('WebSocket not connected') };
    }

    const loadToken = ++expansionCompiledPromptLoadToken;
    if (blockUI) {
        expansionModalData.compiledPrompt = null;
        expansionModalData.compiledPromptReady = false;
        clearExpansionSavedPromptOverrides();
    }

    let toastId = null;
    if (showToast) {
        toastId = showGlassToast('info', 'Preparing expansion', 'Compiling prompt for generation…', true, false, '<i class="mdi mdi-1-25 mdi-relative-scale"></i>');
    }

    try {
        const data = await wsClient.previewExpandImagePrompt(getExpansionPreviewParamsFromUI());
        if (loadToken !== expansionCompiledPromptLoadToken) {
            return { ok: false, cancelled: true };
        }
        expansionModalData.compiledPrompt = {
            prompt: data.prompt != null ? data.prompt : '',
            uc: data.uc != null ? data.uc : '',
            characterPrompts: normalizeExpansionCharacterPrompts(data.characterPrompts)
        };
        expansionModalData.compiledPromptReady = true;
        clearExpansionSavedPromptOverrides();
        if (isExpansionCompiledPromptEditorOpen()) {
            const promptInput = document.getElementById('expansionCompiledPromptInput');
            const ucInput = document.getElementById('expansionCompiledUcInput');
            if (promptInput) {
                promptInput.value = expansionModalData.compiledPrompt.prompt;
            }
            if (ucInput) {
                ucInput.value = expansionModalData.compiledPrompt.uc;
            }
            renderExpansionCompiledCharacterFields(expansionModalData.compiledPrompt);
            if (typeof autoResizeTextarea === 'function') {
                if (promptInput) {
                    autoResizeTextarea(promptInput);
                }
                if (ucInput) {
                    autoResizeTextarea(ucInput);
                }
            }
        }
        if (toastId) {
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Expansion ready',
                message: data.expansionReasonDisplay ? String(data.expansionReasonDisplay) : 'Use the prompt button to edit before generating.',
                showProgress: false
            });
        }
        return { ok: true, data };
    } catch (error) {
        if (loadToken !== expansionCompiledPromptLoadToken) {
            return { ok: false, cancelled: true };
        }
        expansionModalData.compiledPrompt = null;
        expansionModalData.compiledPromptReady = false;
        clearExpansionSavedPromptOverrides();
        if (toastId) {
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Could not compile prompt',
                message: error.message || 'Failed',
                showProgress: false
            });
        }
        return { ok: false, error };
    }
}

function scheduleExpansionCompiledPromptReload() {
    if (expansionModalBootstrapping) {
        return;
    }
    const modal = document.getElementById('imageExpansionDialog');
    if (!modal || !modal.classList.contains('visible')) {
        return;
    }
    if (expansionCompiledPromptReloadTimer) {
        clearTimeout(expansionCompiledPromptReloadTimer);
    }
    expansionCompiledPromptReloadTimer = setTimeout(async () => {
        expansionCompiledPromptReloadTimer = null;
        if (!expansionModalData.selectedResolution) {
            return;
        }
        await fetchExpansionCompiledPrompt({ showToast: false, blockUI: true });
    }, 450);
}

// Open image expansion modal
async function openImageExpansionModal(imageFilename, imageDimensions = null) {
    console.log('📦 Opening image expansion modal for:', imageFilename);
    
    // Validate filename
    if (!imageFilename) {
        console.error('No filename provided to expansion modal');
        showGlassToast('error', 'Error', 'No image filename provided', false, 5000, '<i class="nai-cross"></i>');
        return;
    }
    
    const modal = document.getElementById('imageExpansionDialog');
    if (!modal) {
        console.error('Image expansion dialog not found');
        return;
    }
    
    expansionModalBootstrapping = true;
    try {

    // Reset modal data
    expansionModalData = {
        filename: imageFilename, // The current file clicked (never changes, used for resolution)
        originalImage: imageFilename, // Will be set to source if this is an expanded image
        originalDimensions: imageDimensions,
        lastImage: imageFilename, // Default to the provided filename
        targetImage: imageFilename, // Default to the provided filename
        expansionMode: 'source', // Default to source mode
        selectedResolution: null,
        selectedBias: 2,
        upscaleAfterComplete: false,
        overrideParams: {},
        enableAI: false, // Reset to disabled
        enableInset: false, // Reset to disabled
        expandSourcePixels: null,
        compiledPrompt: null,
        savedPromptOverrides: null,
        compiledPromptReady: false
    };
    
    // Reset AI toggle state
    const aiToggle = document.getElementById('expansionAIToggle');
    if (aiToggle) {
        aiToggle.setAttribute('data-state', 'off');
    }
    
    // Hide requested content by default
    const requestedContentGroup = document.getElementById('expansionRequestedContentGroup');
    if (requestedContentGroup) {
        requestedContentGroup.classList.add('hidden');
    }
    
    console.log('📊 Received imageDimensions:', imageDimensions);
    
    // If dimensions not provided, fetch from metadata
    let metadata = null;
    if (!imageDimensions && imageFilename) {
        try {
            metadata = await getImageMetadata(imageFilename);

            // Check if this is an already expanded image
            if (metadata?.forge_data?.expansion_source) {
                console.log('📋 Image is expanded, source image:', metadata.forge_data.expansion_source);
                // Get dimensions from the source image initially
                const dimsSource = metadata.forge_data.expansion_source;
                try {
                    const dimsMetadata = await getImageMetadata(dimsSource);
                    if (dimsMetadata) {
                        expansionModalData.originalDimensions = {
                            width: dimsMetadata.actual_width || dimsMetadata.width,
                            height: dimsMetadata.actual_height || dimsMetadata.height
                        };
                    }
                } catch (dimsError) {
                    console.error('Failed to get dimensions for expansion source:', dimsError);
                }
            } else {
                if (metadata) {
                    expansionModalData.originalDimensions = {
                        width: metadata.actual_width || metadata.width,
                        height: metadata.actual_height || metadata.height
                    };
                }
            }
        } catch (error) {
            console.error('Failed to fetch image dimensions:', error);
        }
    } else if (imageDimensions) {
        // Try to get metadata for expansion settings
        try {
            metadata = await getImageMetadata(imageFilename);
        } catch (error) {
            console.error('Failed to fetch metadata:', error);
        }
    }
    
    // Check if this image has expansion metadata (was previously expanded)
    if (metadata?.forge_data?.expansion_source) {
        console.log('📋 Image is expanded, source image:', metadata.forge_data.expansion_source);
        expansionModalData.expansionMode = 'current';
        expansionModalData.originalImage = metadata.forge_data.expansion_source || imageFilename;

        console.log('📋 Loading previous expansion settings');
    }
    
    // Populate resolution dropdown with filtered options (after updating dimensions if needed)
    await populateExpansionResolutionDropdown();
    
    // Load previous expansion settings if available
    if (metadata?.forge_data?.expansion_source) {
        
        // Set previous expansion resolution
        if (metadata.forge_data.expansion_resolution) {
            expansionModalData.selectedResolution = metadata.forge_data.expansion_resolution;
            const resData = RESOLUTIONS.find(r => r.value === metadata.forge_data.expansion_resolution);
            const selectedElement = document.getElementById('expansionResolutionSelected');
            if (selectedElement && resData) {
                selectedElement.textContent = resData.display;
            }
        }
        
        // Set previous bias
        if (metadata.forge_data.expansion_bias !== undefined) {
            selectExpansionBias(metadata.forge_data.expansion_bias);
        } else {
            selectExpansionBias(2);
        }
        
        // Set upscale toggle if it was used (check both possible property names)
        const upscaleToggle = document.getElementById('expansionUpscaleToggle');
        if (upscaleToggle) {
            const wasUpscaled = metadata.forge_data.expansion_params?.upscale || 
                               metadata.forge_data.expansion_params?.upscaleAfterComplete
            upscaleToggle.setAttribute('data-state', wasUpscaled ? 'on' : 'off');
        }
        
        // Set inset toggle if it was used
        const insetToggle = document.getElementById('expansionInsetToggle');
        if (insetToggle) {
            const wasInset = metadata.forge_data?.expansion_inset === true ||
                metadata.forge_data.expansion_params?.inset === true ||
                metadata.forge_data.expansion_params?.inset === 'true';
            insetToggle.setAttribute('data-state', wasInset ? 'on' : 'off');
            expansionModalData.enableInset = wasInset;
        }

        // Set requested content if it was used (input to AI — not the compiled prompt)
        const requestedContentTextarea = document.getElementById('expansionRequestedContent');
        if (requestedContentTextarea && metadata.forge_data.expansion_requested_content) {
            requestedContentTextarea.value = metadata.forge_data.expansion_requested_content;
            if (aiToggle) {
                aiToggle.setAttribute('data-state', 'on');
                expansionModalData.enableAI = true;
            }
            if (requestedContentGroup) {
                requestedContentGroup.classList.remove('hidden');
            }
        } else if (requestedContentTextarea) {
            requestedContentTextarea.value = '';
        }
        
        // Load advanced params if they were used
        if (metadata.forge_data.expansion_params) {
            const params = metadata.forge_data.expansion_params;
            
            if (params.model) {
                document.getElementById('expansionModelInput').value = params.model;
                const modelSelected = document.getElementById('expansionModelSelected');
                if (modelSelected) {
                    // Find model name
                    for (const group of modelGroups) {
                        const model = group.options.find(opt => opt.value === params.model);
                        if (model) {
                            modelSelected.textContent = model.name;
                            break;
                        }
                    }
                }
            }
            
            if (params.steps) document.getElementById('expansionStepsInput').value = params.steps;
            if (params.guidance) document.getElementById('expansionGuidanceInput').value = params.guidance;
            if (params.rescale !== undefined) {
                document.getElementById('expansionRescaleInput').value = params.rescale;
                const rescaleOverlay = document.getElementById('expansionRescaleOverlay');
                if (rescaleOverlay) {
                    rescaleOverlay.textContent = `${Math.round(params.rescale * 100)}%`;
                }
            }
            if (params.sampler) {
                document.getElementById('expansionSamplerInput').value = params.sampler;
                const samplerSelected = document.getElementById('expansionSamplerSelected');
                if (samplerSelected) {
                    const sampler = SAMPLER_MAP.find(s => s.meta === params.sampler);
                    if (sampler) samplerSelected.textContent = sampler.display;
                }
            }
            if (params.noise_schedule) {
                document.getElementById('expansionNoiseSchedulerInput').value = params.noise_schedule;
                const noiseSchedulerSelected = document.getElementById('expansionNoiseSchedulerSelected');
                if (noiseSchedulerSelected) {
                    const noise = NOISE_MAP.find(n => n.meta === params.noise_schedule);
                    if (noise) noiseSchedulerSelected.textContent = noise.display;
                }
            }
            if (params.noise !== undefined) {
                document.getElementById('expansionNoiseInput').value = params.noise;
                const noiseOverlay = document.getElementById('expansionNoiseOverlay');
                if (noiseOverlay) {
                    noiseOverlay.textContent = `${Math.round(params.noise * 100)}%`;
                }
            }
            if (params.seed) document.getElementById('expansionSeedInput').value = params.seed;
        }
    } else {
        // No previous expansion, use defaults and clear inputs
        selectExpansionBias(2);
        
        const upscaleToggle = document.getElementById('expansionUpscaleToggle');
        if (upscaleToggle) {
            upscaleToggle.setAttribute('data-state', 'off');
        }
        const insetToggle = document.getElementById('expansionInsetToggle');
        if (insetToggle) {
            insetToggle.setAttribute('data-state', 'on');
            expansionModalData.enableInset = true;
        }
        
        // Clear advanced inputs
        document.getElementById('expansionModelInput').value = '';
        document.getElementById('expansionStepsInput').value = '';
        document.getElementById('expansionGuidanceInput').value = '';
        document.getElementById('expansionRescaleInput').value = '';
        document.getElementById('expansionSamplerInput').value = '';
        document.getElementById('expansionNoiseSchedulerInput').value = '';
        document.getElementById('expansionNoiseInput').value = '';
        document.getElementById('expansionSeedInput').value = '';

        // Clear requested content textarea
        const requestedContentTextarea = document.getElementById('expansionRequestedContent');
        if (requestedContentTextarea) {
            requestedContentTextarea.value = '';
        }
        
        // Reset dropdown displays
        const modelSelected = document.getElementById('expansionModelSelected');
        const samplerSelected = document.getElementById('expansionSamplerSelected');
        const noiseSchedulerSelected = document.getElementById('expansionNoiseSchedulerSelected');
        if (modelSelected) modelSelected.textContent = 'Select model...';
        if (samplerSelected) samplerSelected.textContent = 'Select sampler...';
        if (noiseSchedulerSelected) noiseSchedulerSelected.textContent = 'Select scheduler...';
    }
    
    hideExpansionAdvancedOptions();

    expansionModalData.compiledPrompt = null;
    expansionModalData.compiledPromptReady = false;
    clearExpansionSavedPromptOverrides();
    syncExpansionEnableAIFromToggle();

    // Setup expansion mode dropdown (only once)
    const expansionModeDropdown = document.getElementById('expansionModeDropdown');
    if (expansionModeDropdown && !expansionModeDropdown.dataset.initialized) {
        setupExpansionModeDropdown();
        expansionModeDropdown.dataset.initialized = 'true';
    } else {
        // Update display if already initialized
        updateExpansionModeDisplay();
    }

    updateExpansionInsetToggleVisibility();

    } finally {
        expansionModalBootstrapping = false;
    }

    if (!expansionModalData.selectedResolution) {
        showGlassToast('error', 'Expand Canvas', 'No valid target resolution for this image', false, 5000, '<i class="nai-cross"></i>');
        return;
    }

    const prepared = await fetchExpansionCompiledPrompt({ showToast: true, blockUI: true });
    if (!prepared.ok) {
        if (prepared.error && !prepared.cancelled) {
            const msg = prepared.error.message || 'Could not compile expansion prompt';
            if (!prepared.error.message || prepared.error.message !== 'WebSocket not connected') {
                showGlassToast('error', 'Expand Canvas', msg, false, 5000, '<i class="nai-cross"></i>');
            }
        }
        return;
    }

    openModal(modal);
    modal.classList.add('visible');

    if (typeof ensureModalWithinViewport === 'function') {
        ensureModalWithinViewport(modal);
    }
}

// Close image expansion modal
function closeImageExpansionModal() {
    expansionCompiledPromptLoadToken++;
    if (expansionCompiledPromptReloadTimer) {
        clearTimeout(expansionCompiledPromptReloadTimer);
        expansionCompiledPromptReloadTimer = null;
    }

    closeExpansionCompiledPromptEditor();

    expansionModalData.compiledPrompt = null;
    expansionModalData.savedPromptOverrides = null;
    expansionModalData.overrideParams = {};
    expansionModalData.compiledPromptReady = false;
    expansionModalData.expandSourcePixels = null;
    expansionModalData.filename = null;
    expansionModalData.originalImage = null;
    expansionModalData.targetImage = null;
    expansionModalData.lastImage = null;
    expansionModalData.originalDimensions = null;

    const modal = document.getElementById('imageExpansionDialog');
    if (modal) {
        modal.classList.remove('visible');
        closeModal(modal);
    }
}

// Setup expansion mode dropdown
function setupExpansionModeDropdown() {
    const dropdown = document.getElementById('expansionModeDropdown');
    const dropdownBtn = document.getElementById('expansionModeDropdownBtn');
    const dropdownMenu = document.getElementById('expansionModeDropdownMenu');
    const selectedDisplay = document.getElementById('expansionModeSelected');

    if (!dropdown || !dropdownBtn || !dropdownMenu || !selectedDisplay) {
        console.warn('Expansion mode dropdown elements not found');
        return;
    }

    // Populate dropdown options
    populateExpansionModeDropdown();

    // Set initial display
    updateExpansionModeDisplay();

    // Setup dropdown using the standard setupDropdown function
    setupDropdown(
        dropdown,
        dropdownBtn,
        dropdownMenu,
        renderExpansionModeDropdown,
        () => expansionModalData.expansionMode,
        { preventFocusTransfer: true }
    );
}

// Populate expansion mode dropdown options
function populateExpansionModeDropdown() {
    const dropdownMenu = document.getElementById('expansionModeDropdownMenu');
    if (!dropdownMenu) return;

    dropdownMenu.innerHTML = '';

    const modes = [
        { value: 'source', label: 'Source', description: 'Use original source image' },
        { value: 'current', label: 'Current', description: 'Use current displayed image' },
        { value: 'last', label: 'Last', description: 'Use last expanded version' }
    ];

    modes.forEach(mode => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.dataset.value = mode.value;
        option.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 500;">${mode.label}</span>
                <span style="font-size: 0.85em; opacity: 0.7;">${mode.description}</span>
            </div>
        `;

        option.addEventListener('click', () => {
            selectExpansionMode(mode.value);
            closeDropdown(dropdownMenu, document.getElementById('expansionModeDropdownBtn'));
        });

        dropdownMenu.appendChild(option);
    });
}

// Render expansion mode dropdown options
function renderExpansionModeDropdown(selectedValue) {
    const dropdownMenu = document.getElementById('expansionModeDropdownMenu');
    if (!dropdownMenu) return;

    // Update selected state
    const options = dropdownMenu.querySelectorAll('.custom-dropdown-option');
    options.forEach(option => {
        if (option.dataset.value === selectedValue) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
}

// Select expansion mode and update UI
async function selectExpansionMode(mode) {
    console.log('🔄 Switching to expansion mode:', mode);

    const previousMode = expansionModalData.expansionMode;
    expansionModalData.expansionMode = mode;

    try {
        // Use the filename (clicked image) to determine source relationships
        const metadata = await getImageMetadata(expansionModalData.filename);

        switch (mode) {
            case 'source':
                // Use the original source image
                if (metadata?.forge_data?.expansion_source) {
                    expansionModalData.targetImage = metadata.forge_data.expansion_source;
                } else {
                    expansionModalData.targetImage = expansionModalData.filename;
                }
                // Don't touch lastImage in source mode
                break;

            case 'current':
                // Use the current displayed image (the one that was clicked)
                expansionModalData.targetImage = expansionModalData.filename;
                // Don't update lastImage in current mode - keep existing reference
                break;

            case 'last':
                // Use the lastImage for expansion
                expansionModalData.targetImage = expansionModalData.lastImage || expansionModalData.filename;
                // After using lastImage, update it to the current image
                expansionModalData.lastImage = expansionModalData.filename;
                break;
        }

        // Update dimensions based on the current mode
        await populateExpansionResolutionDropdown();

        // Update display
        updateExpansionModeDisplay();

        // Update reroll button visibility
        updateRerollButtonVisibility();

        scheduleExpansionCompiledPromptReload();

    } catch (error) {
        console.error('Failed to switch expansion mode:', error);
    }
}

// Update expansion mode display text
function updateExpansionModeDisplay() {
    const selectedDisplay = document.getElementById('expansionModeSelected');
    if (!selectedDisplay) return;

    const modeLabels = {
        'source': 'Source',
        'current': 'Current',
        'last': 'Last'
    };

    selectedDisplay.textContent = modeLabels[expansionModalData.expansionMode] || 'Source';
}

// Populate resolution dropdown with filtered options
async function populateExpansionResolutionDropdown() {
    const dropdown = document.getElementById('expansionResolutionDropdownMenu');
    if (!dropdown) return;

    dropdown.innerHTML = '';

    let dimsToUse, resPresetToUse;

    // Use the target image that was determined by selectExpansionMode
    const imageForDimensions = expansionModalData.targetImage;

    try {
        const metadata = await getImageMetadata(imageForDimensions);
        if (metadata) {
            dimsToUse = {
                width: metadata.actual_width || metadata.width,
                height: metadata.actual_height || metadata.height
            };
            resPresetToUse = (metadata.actual_resolution || metadata.resPreset || metadata.resolution || '').toLowerCase();
            console.log(`📐 Using ${expansionModalData.expansionMode} image dimensions for resolution filtering:`, dimsToUse, 'preset:', resPresetToUse);
        } else {
            console.warn('No metadata available for selected image');
            dimsToUse = expansionModalData.originalDimensions;
            resPresetToUse = (expansionModalData.originalDimensions?.resPreset || '').toLowerCase();
        }
    } catch (error) {
        console.error('Failed to get image metadata for resolution filtering:', error);
        dimsToUse = expansionModalData.originalDimensions;
        resPresetToUse = (expansionModalData.originalDimensions?.resPreset || '').toLowerCase();
    }

    if (!dimsToUse) {
        console.warn('No dimensions available');
        expansionModalData.expandSourcePixels = null;
        updateExpansionInsetToggleVisibility();
        const noOptions = document.createElement('div');
        noOptions.className = 'custom-dropdown-option';
        noOptions.style.opacity = '0.5';
        noOptions.textContent = 'Unable to determine dimensions';
        dropdown.appendChild(noOptions);
        return;
    }

    const baseW = parseInt(dimsToUse.width, 10) || 0;
    const baseH = parseInt(dimsToUse.height, 10) || 0;
    expansionModalData.expandSourcePixels = { width: baseW, height: baseH };

    // Filter RESOLUTION_GROUPS: hide small presets and any preset with the same aspect ratio as the image (exact rational match)
    const filteredGroups = RESOLUTION_GROUPS.map(group => {
        const filteredOptions = group.options.filter(opt => {
            if (opt.value === 'custom') return false;

            if (opt.value.startsWith('small_')) {
                return false;
            }

            if (samePixelAspectRatio(baseW, baseH, opt.width, opt.height)) {
                return false;
            }

            return true;
        });

        return {
            ...group,
            options: filteredOptions
        };
    }).filter(group => group.options.length > 0);
    
    // Use renderGroupedDropdown with badges
    if (filteredGroups.length > 0) {
        renderGroupedDropdown(
            dropdown,
            filteredGroups,
            selectExpansionResolution,
            closeExpansionResolutionDropdown,
            expansionModalData.selectedResolution,
            (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`,
            { preventFocusTransfer: true }
        );
    } else {
        const noOptions = document.createElement('div');
        noOptions.className = 'custom-dropdown-option';
        noOptions.style.opacity = '0.5';
        noOptions.textContent = 'No expansion options available';
        dropdown.appendChild(noOptions);
    }

    if (!expansionModalData.selectedResolution && filteredGroups.length > 0 && filteredGroups[0].options.length > 0) {
        const firstOpt = filteredGroups[0].options[0];
        selectExpansionResolution(firstOpt.value, filteredGroups[0].group);
    }

    updateExpansionInsetToggleVisibility();
}

/** Target canvas is strictly larger than source on both axes (inset letterbox is meaningful). */
function expansionInsetTargetApplicable(sw, sh, tw, th) {
    const swN = parseInt(sw, 10) || 0;
    const shN = parseInt(sh, 10) || 0;
    const twN = parseInt(tw, 10) || 0;
    const thN = parseInt(th, 10) || 0;
    return swN > 0 && shN > 0 && twN > 0 && thN > 0 && twN > swN && thN > shN;
}

/** Show inset toggle only when output is larger than source on both dimensions; otherwise hide and clear inset. */
function updateExpansionInsetToggleVisibility() {
    const btn = document.getElementById('expansionInsetToggle');
    if (!btn) return;

    const px = expansionModalData.expandSourcePixels;
    const res = expansionModalData.selectedResolution;
    const target = res ? getDimensionsFromResolution(res) : null;

    if (!px || !px.width || !px.height || !target || !expansionInsetTargetApplicable(px.width, px.height, target.width, target.height)) {
        btn.classList.add('hidden');
        btn.setAttribute('data-state', 'off');
        expansionModalData.enableInset = false;
        return;
    }

    const wasHidden = btn.classList.contains('hidden');
    btn.classList.remove('hidden');
    if (wasHidden) {
        btn.setAttribute('data-state', 'on');
        expansionModalData.enableInset = true;
    }
}

// Select expansion resolution
function selectExpansionResolution(value, group) {
    expansionModalData.selectedResolution = value;
    
    const selectedElement = document.getElementById('expansionResolutionSelected');
    if (selectedElement) {
        // Find the resolution name from RESOLUTIONS array
        const resData = RESOLUTIONS.find(r => r.value === value);
        if (resData) {
            selectedElement.textContent = resData.display;
        } else {
            selectedElement.textContent = value;
        }
    }
    
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    if (upscaleToggle && typeof calculateUpscaleInfo === 'function') {
        const dimensions = getDimensionsFromResolution(value);
        if (dimensions) {
            const upscaleInfo = calculateUpscaleInfo(dimensions.width, dimensions.height);
            if (upscaleInfo.available) {
                upscaleToggle.disabled = false;
                upscaleToggle.title = 'Enable upscaling after expansion';
            } else {
                upscaleToggle.disabled = true;
                upscaleToggle.title = upscaleInfo.reason || 'Upscaling not available for this resolution';
                // Turn off the toggle if it was on
                if (upscaleToggle.getAttribute('data-state') === 'on') {
                    upscaleToggle.setAttribute('data-state', 'off');
                }
            }
        }
    }

    updateExpansionInsetToggleVisibility();

    scheduleExpansionCompiledPromptReload();
}

// Close expansion resolution dropdown
function closeExpansionResolutionDropdown() {
    const menu = document.getElementById('expansionResolutionDropdownMenu');
    const btn = document.getElementById('expansionResolutionDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Render bias dropdown
function renderExpansionBiasDropdown(selectedVal) {
    const menu = document.getElementById('expansionBiasDropdownMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    // Determine orientation based on original dimensions
    const origDims = expansionModalData.originalDimensions;
    let isPortraitImage = false;
    
    if (origDims) {
        // Check if it's a portrait-oriented image (width < height)
        isPortraitImage = origDims.width < origDims.height;
    }
    
    const biasOptions = [
        { value: '0', display: isPortraitImage ? 'Top' : 'Left' },
        { value: '1', display: '⅖' + (isPortraitImage ? ' Top' : ' Left') },
        { value: '2', display: 'Center' },
        { value: '3', display: '⅘' + (isPortraitImage ? ' Bottom' : ' Right') },
        { value: '4', display: isPortraitImage ? 'Bottom' : 'Right' }
    ];
    
    biasOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option' + (selectedVal === option.value ? ' selected' : '');
        optionElement.dataset.value = option.value;
        
        // Create grid based on orientation
        let gridHTML = '';
        for (let i = 0; i < 15; i++) {
            gridHTML += '<div class="grid-cell"></div>';
        }
        
        optionElement.innerHTML = `
            <div class="mask-bias-option-content">
                <div class="mask-bias-grid" data-bias="${option.value}" data-orientation="${isPortraitImage ? 'portrait' : 'landscape'}">
                    ${gridHTML}
                </div>
                <span class="mask-bias-label">${option.display}</span>
            </div>
        `;
        
        optionElement.addEventListener('click', () => {
            selectExpansionBias(parseInt(option.value));
            closeExpansionBiasDropdown();
        });
        
        menu.appendChild(optionElement);
    });
}

// Select expansion bias
function selectExpansionBias(value) {
    expansionModalData.selectedBias = value;
    
    const selectedElement = document.getElementById('expansionBiasSelected');
    const buttonGrid = document.getElementById('expansionBiasGrid');
    
    if (selectedElement && buttonGrid) {
        // Update display text based on value
        const origDims = expansionModalData.originalDimensions;
        let isPortraitImage = false;
        
        if (origDims) {
            // Check if it's a portrait-oriented image (width < height)
            isPortraitImage = origDims.width < origDims.height;
        }
        
        const biasLabels = [
            isPortraitImage ? 'Top' : 'Left',
            '⅖' + (isPortraitImage ? ' Top' : ' Left'),
            'Center',
            '⅘' + (isPortraitImage ? ' Bottom' : ' Right'),
            isPortraitImage ? 'Bottom' : 'Right'
        ];
        
        selectedElement.textContent = biasLabels[value] || 'Center';
        
        // Update button grid
        buttonGrid.setAttribute('data-bias', value);
        buttonGrid.setAttribute('data-orientation', isPortraitImage ? 'portrait' : 'landscape');
    }
    
    // Re-render dropdown to update selected state
    renderExpansionBiasDropdown(value.toString());

    scheduleExpansionCompiledPromptReload();
}

// Close expansion bias dropdown
function closeExpansionBiasDropdown() {
    const menu = document.getElementById('expansionBiasDropdownMenu');
    const btn = document.getElementById('expansionBiasDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Update reroll button visibility
async function updateRerollButtonVisibility() {
    const rerollBtn = document.getElementById('rerollExpansionBtn');
    if (!rerollBtn) return;
    
    // Show only when:
    // 1. Mode is 'current' or 'last' (not 'source')
    // 2. Metadata has expansion_prompt (is an expanded image)
    try {
        const metadata = await getImageMetadata(expansionModalData.targetImage);
        const hasExpansionData = metadata?.forge_data?.expansion_prompt;
        
        if (hasExpansionData && expansionModalData.expansionMode !== 'source') {
            rerollBtn.classList.remove('hidden');
        } else {
            rerollBtn.classList.add('hidden');
        }
    } catch (error) {
        rerollBtn.classList.add('hidden');
    }
}

// Toggle auto-seed
async function toggleAutoSeed() {
    const toggle = document.getElementById('expansionAutoSeedToggle');
    const seedInput = document.getElementById('expansionSeedInput');
    
    if (!toggle || !seedInput) return;
    
    const currentState = toggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    toggle.setAttribute('data-state', newState);
    
    if (newState === 'off') {
        // Use saved seed - make readonly and populate from metadata
        try {
            const metadata = await getImageMetadata(expansionModalData.targetImage);
            const savedSeed = metadata?.seed;
            if (savedSeed) {
                seedInput.value = savedSeed;
                seedInput.setAttribute('readonly', 'readonly');
            }
        } catch (error) {
            console.error('Failed to load saved seed:', error);
        }
    } else {
        // Random seed - clear readonly and clear value
        seedInput.removeAttribute('readonly');
        seedInput.value = '';
    }
}

// Submit image expansion reroll
async function submitImageExpansionReroll() {
    // Validate
    if (!expansionModalData.targetImage) {
        showGlassToast('error', 'Error', 'No image selected');
        return;
    }
    
    // Get override params from advanced options
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    const overrideParams = {};
    
    if (advancedSection && !advancedSection.classList.contains('hidden')) {
        Object.assign(overrideParams, getExpansionOverrideParams());
    }
    const insetToggleReroll = document.getElementById('expansionInsetToggle');
    const rerollInsetOn = insetToggleReroll ? insetToggleReroll.getAttribute('data-state') === 'on' : false;
    overrideParams.inset = rerollInsetOn;

    Object.assign(overrideParams, applyExpansionSavedOverridesToParams({}));
    
    closeImageExpansionModal();
    
    // Show progress
    const manualForm = document.getElementById('manualForm');
    if (manualForm) {
        manualForm.classList.add('generating');
        manualForm.classList.add('streaming');
    }
    if (typeof startPreviewAnimation === 'function') {
        startPreviewAnimation();
    }
    
    if (!progressToastId) {
        progressToastId = showGlassToast('info', 'Rerolling Expansion', 'Regenerating expanded image...', true, false, '<i class="mdi mdi-1-25 mdi-refresh"></i>');
    }
    
    try {
        const result = await wsClient.rerollExpandedImage({
            filename: expansionModalData.targetImage,
            overrideParams: overrideParams,
            inset: rerollInsetOn,
            enableInset: rerollInsetOn,
            workspace: activeWorkspace || null,
            enableStreaming: true
        });
        
        if (result) {
            updateGlassToastComplete(progressToastId, {
                type: 'success',
                title: 'Expansion Rerolled',
                message: 'Image regenerated successfully!',
                customIcon: '<i class="mdi mdi-1-25 mdi-refresh"></i>',
                showProgress: false
            });
            progressToastId = null;

            let finalizeResult = { prefetchedBlobUrl: null, skippedDownloadUi: false };
            if (wsClient && wsClient.finalizeGenerationPreview) {
                finalizeResult = await wsClient.finalizeGenerationPreview('manual', {
                    filename: result.filename,
                    contentLength: result.contentLength
                });
            }

            const imageSrc = `/images/${result.filename}`;
            const mockResponse = {
                headers: {
                    get: (headerName) => {
                        if (headerName === 'X-Generated-Filename') return result.filename;
                        if (headerName === 'X-Seed') return result.seed;
                        if (headerName === 'Content-Length' && result.contentLength) {
                            return String(result.contentLength);
                        }
                        return null;
                    }
                },
                prefetchedBlobUrl: finalizeResult.prefetchedBlobUrl || null,
                skippedDownloadUi: finalizeResult.skippedDownloadUi === true
            };

            await handleImageResult(imageSrc, undefined, result.seed, mockResponse, result.metadata);
        }
    } catch (error) {
        if (error && error.code === 'CLIENT_CANCELLED') {
            return;
        }
        console.error('❌ Image reroll failed:', error);
        
        updateGlassToastComplete(progressToastId, {
            type: 'error',
            title: 'Reroll Failed',
            message: error.message || 'Failed to reroll image',
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
        progressToastId = null;
    } finally {
        finishExpansionGenerationUi();
    }
}

// Render model dropdown
function renderExpansionModelDropdown(selectedVal) {
    const menu = document.getElementById('expansionModelDropdownMenu');
    if (!menu) return;
    
    // Use global modelGroups array
    renderGroupedDropdown(
        menu,
        modelGroups,
        selectExpansionModel,
        closeExpansionModelDropdown,
        selectedVal,
        (opt, group) => `<span>${opt.name}</span>`,
        { preventFocusTransfer: true }
    );
}

// Select model
function selectExpansionModel(value) {
    const modelInput = document.getElementById('expansionModelInput');
    if (modelInput) {
        modelInput.value = value;
    }
    
    // Update display text
    const selectedElement = document.getElementById('expansionModelSelected');
    if (selectedElement) {
        // Find the model name from modelGroups
        let modelName = value;
        for (const group of modelGroups) {
            const model = group.options.find(opt => opt.value === value);
            if (model) {
                modelName = model.name;
                break;
            }
        }
        selectedElement.textContent = modelName;
    }
}

// Close model dropdown
function closeExpansionModelDropdown() {
    const menu = document.getElementById('expansionModelDropdownMenu');
    const btn = document.getElementById('expansionModelDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Render sampler dropdown
function renderExpansionSamplerDropdown(selectedVal) {
    const menu = document.getElementById('expansionSamplerDropdownMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    // Use global SAMPLER_MAP array
    SAMPLER_MAP.forEach(sampler => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedVal === sampler.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = sampler.meta;
        option.innerHTML = `<span>${sampler.display}</span>`;
        
        const action = () => {
            selectExpansionSampler(sampler.meta);
            closeExpansionSamplerDropdown();
        };
        
        option.addEventListener('click', action);
        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });
        
        menu.appendChild(option);
    });
}

// Select sampler
function selectExpansionSampler(value) {
    const samplerInput = document.getElementById('expansionSamplerInput');
    if (samplerInput) {
        samplerInput.value = value;
    }
    
    // Update display text
    const selectedElement = document.getElementById('expansionSamplerSelected');
    if (selectedElement) {
        // Find the sampler name from SAMPLER_MAP
        const sampler = SAMPLER_MAP.find(s => s.meta === value);
        selectedElement.textContent = sampler ? sampler.display : value;
    }
}

// Close sampler dropdown
function closeExpansionSamplerDropdown() {
    const menu = document.getElementById('expansionSamplerDropdownMenu');
    const btn = document.getElementById('expansionSamplerDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Render noise scheduler dropdown
function renderExpansionNoiseSchedulerDropdown(selectedVal) {
    const menu = document.getElementById('expansionNoiseSchedulerDropdownMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    // Use global NOISE_MAP array
    NOISE_MAP.forEach(noise => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedVal === noise.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = noise.meta;
        option.innerHTML = `<span>${noise.display}</span>`;
        
        const action = () => {
            selectExpansionNoiseScheduler(noise.meta);
            closeExpansionNoiseSchedulerDropdown();
        };
        
        option.addEventListener('click', action);
        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });
        
        menu.appendChild(option);
    });
}

// Select noise scheduler
function selectExpansionNoiseScheduler(value) {
    const noiseSchedulerInput = document.getElementById('expansionNoiseSchedulerInput');
    if (noiseSchedulerInput) {
        noiseSchedulerInput.value = value;
    }
    
    // Update display text
    const selectedElement = document.getElementById('expansionNoiseSchedulerSelected');
    if (selectedElement) {
        // Find the noise scheduler name from NOISE_MAP
        const noise = NOISE_MAP.find(n => n.meta === value);
        selectedElement.textContent = noise ? noise.display : value;
    }
}

// Close noise scheduler dropdown
function closeExpansionNoiseSchedulerDropdown() {
    const menu = document.getElementById('expansionNoiseSchedulerDropdownMenu');
    const btn = document.getElementById('expansionNoiseSchedulerDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Toggle expansion advanced options
function toggleExpansionAdvancedOptions() {
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    
    if (advancedSection) {
        if (advancedSection.classList.contains('hidden')) {
            advancedSection.classList.remove('hidden');
        } else {
            advancedSection.classList.add('hidden');
        }
    }
}

// Hide expansion advanced options
function hideExpansionAdvancedOptions() {
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    
    if (advancedSection) {
        advancedSection.classList.add('hidden');
    }
}

// Get expansion override parameters from UI
function getExpansionOverrideParams() {
    const params = {};
    
    // Get model
    const modelInput = document.getElementById('expansionModelInput');
    if (modelInput && modelInput.value) {
        params.model = modelInput.value;
    }
    
    // Get steps
    const stepsInput = document.getElementById('expansionStepsInput');
    if (stepsInput && stepsInput.value) {
        params.steps = parseInt(stepsInput.value);
    }
    
    // Get guidance
    const guidanceInput = document.getElementById('expansionGuidanceInput');
    if (guidanceInput && guidanceInput.value) {
        params.guidance = parseFloat(guidanceInput.value);
    }
    
    // Get rescale
    const rescaleInput = document.getElementById('expansionRescaleInput');
    if (rescaleInput && rescaleInput.value) {
        params.rescale = parseFloat(rescaleInput.value);
    }
    
    // Get sampler
    const samplerInput = document.getElementById('expansionSamplerInput');
    if (samplerInput && samplerInput.value) {
        params.sampler = samplerInput.value;
    }
    
    // Get noise scheduler
    const noiseSchedulerInput = document.getElementById('expansionNoiseSchedulerInput');
    if (noiseSchedulerInput && noiseSchedulerInput.value) {
        params.noise_schedule = noiseSchedulerInput.value;
    }
    
    // Get noise
    const noiseInput = document.getElementById('expansionNoiseInput');
    if (noiseInput && noiseInput.value) {
        params.noise = parseFloat(noiseInput.value);
    }
    
    // Get seed
    const seedInput = document.getElementById('expansionSeedInput');
    if (seedInput && seedInput.value) {
        params.seed = parseInt(seedInput.value);
    }
    
    return params;
}

// Submit image expansion
async function submitImageExpansion() {
    // Use the target image that was determined by selectExpansionMode
    const imageToExpand = expansionModalData.targetImage;

    // Validate required fields
    if (!imageToExpand) {
        showGlassToast('error', 'Error', 'No image selected');
        return;
    }
    
    if (!expansionModalData.selectedResolution) {
        showGlassToast('error', 'Error', 'Please select a target resolution');
        return;
    }

    if (!expansionModalData.compiledPromptReady) {
        showGlassToast('error', 'Error', 'Compiled prompt is not ready yet');
        return;
    }
    
    // Get upscale toggle state
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    expansionModalData.upscaleAfterComplete = upscaleToggle ? upscaleToggle.getAttribute('data-state') === 'on' : false;
    
    // Get inset toggle state
    const insetToggle = document.getElementById('expansionInsetToggle');
    expansionModalData.enableInset = insetToggle ? insetToggle.getAttribute('data-state') === 'on' : false;
    
    // Get override parameters from advanced options
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    if (advancedSection && !advancedSection.classList.contains('hidden')) {
        expansionModalData.overrideParams = getExpansionOverrideParams();
    } else {
        expansionModalData.overrideParams = {};
    }
    
    // Get requested content if provided
    const requestedContentTextarea = document.getElementById('expansionRequestedContent');
    if (requestedContentTextarea && requestedContentTextarea.value.trim()) {
        expansionModalData.overrideParams.requestedContent = requestedContentTextarea.value.trim();
    }
    
    // Persist inset in existing override params channel
    expansionModalData.overrideParams.inset = expansionModalData.enableInset;

    expansionModalData.overrideParams = applyExpansionSavedOverridesToParams(expansionModalData.overrideParams);

    // Close modal
    closeImageExpansionModal();
    
    // Add generating class to manual preview container if in manual modal
    const manualForm = document.getElementById('manualForm');
    const previewContainer = document.getElementById('manualPreviewContainer');
    if (manualForm) {
        manualForm.classList.add('generating');
        manualForm.classList.add('streaming');
    }
    // Start preview animation if available
    if (typeof startPreviewAnimation === 'function') {
        startPreviewAnimation();
    }
    
    // Show progress toast (use global progressToastId for websocket handler compatibility)
    if (!progressToastId) {
        progressToastId = showGlassToast('info', 'Expanding Canvas', 'Analyzing image and generating expansion...', true, false, '<i class="mdi mdi-1-25 mdi-relative-scale"></i>');
    }

    try {
        // Send expansion request via WebSocket with streaming enabled
        const result = await wsClient.expandImage({
            filename: imageToExpand, // The image to actually expand (target)
            sourceFilename: expansionModalData.originalImage || imageToExpand, // The source image for metadata tracking
            expansionMode: expansionModalData.expansionMode, // Track which mode was used
            resolution: expansionModalData.selectedResolution,
            imageBias: expansionModalData.selectedBias,
            upscaleAfterComplete: expansionModalData.upscaleAfterComplete,
            overrideParams: expansionModalData.overrideParams,
            inset: expansionModalData.enableInset,
            enableInset: expansionModalData.enableInset,
            workspace: activeWorkspace || null,
            enableStreaming: true,
            enableAI: expansionModalData.enableAI
        });
        
        if (result) {
            // Show success
            updateGlassToastComplete(progressToastId, {
                type: 'success',
                title: 'Canvas Expanded',
                message: `Image expanded successfully!`,
                customIcon: '<i class="mdi mdi-1-25 mdi-relative-scale"></i>',
                showProgress: false
            });

            // Clear the toast ID for future expansions
            progressToastId = null;

            // Finalize buffered streaming steps before setting final image
            let finalizeResult = { prefetchedBlobUrl: null, skippedDownloadUi: false };
            if (wsClient && wsClient.finalizeGenerationPreview) {
                finalizeResult = await wsClient.finalizeGenerationPreview('manual', {
                    filename: result.filename,
                    contentLength: result.contentLength
                });
            } else if (wsClient && wsClient.waitForStreamingStepsComplete) {
                await wsClient.waitForStreamingStepsComplete('manual');
            }

            // Remove streaming class before setting final image
            if (manualForm) {
                manualForm.classList.remove('streaming');
            }

            const imageSrc = `/images/${result.filename}`;
            const mockResponse = {
                headers: {
                    get: (headerName) => {
                        if (headerName === 'X-Generated-Filename') {
                            return result.filename;
                        }
                        if (headerName === 'X-Seed') {
                            return result.seed;
                        }
                        if (headerName === 'Content-Length' && result.contentLength) {
                            return String(result.contentLength);
                        }
                        return null;
                    }
                },
                prefetchedBlobUrl: finalizeResult.prefetchedBlobUrl || null,
                skippedDownloadUi: finalizeResult.skippedDownloadUi === true
            };

            // Update the current manual preview image object to include the expanded version
            if (window.currentManualPreviewImage) {
                window.currentManualPreviewImage.expanded = result.filename;
                // Update dimensions if available in metadata
                if (result.metadata) {
                    window.currentManualPreviewImage.width = result.metadata.width || window.currentManualPreviewImage.width;
                    window.currentManualPreviewImage.height = result.metadata.height || window.currentManualPreviewImage.height;
                }
            }

            await handleImageResult(imageSrc, undefined, result.seed, mockResponse, result.metadata);
            
            console.log('✨ Expansion prompt:', result.expansionPrompt);
            console.log('💭 Expansion reason:', result.expansionReason);
        }
    } catch (error) {
        if (error && error.code === 'CLIENT_CANCELLED') {
            return;
        }
        console.error('❌ Image expansion failed:', error);
        
        updateGlassToastComplete(progressToastId, {
            type: 'error',
            title: 'Expansion Failed',
            message: error.message || 'Failed to expand image',
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });

        // Clear the toast ID for future expansions
        progressToastId = null;
    } finally {
        finishExpansionGenerationUi();
    }
}

// Setup expansion resolution dropdown
function setupExpansionResolutionDropdown() {
    const container = document.getElementById('expansionResolutionDropdown');
    const button = document.getElementById('expansionResolutionDropdownBtn');
    const menu = document.getElementById('expansionResolutionDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        () => {
            // Render is already handled by populateExpansionResolutionDropdown
        },
        () => expansionModalData.selectedResolution,
        { preventFocusTransfer: true }
    );
}

// Setup expansion bias dropdown
function setupExpansionBiasDropdown() {
    const container = document.getElementById('expansionBiasDropdown');
    const button = document.getElementById('expansionBiasDropdownBtn');
    const menu = document.getElementById('expansionBiasDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionBiasDropdown,
        () => expansionModalData.selectedBias.toString(),
        { preventFocusTransfer: true }
    );
}

// Setup expansion model dropdown
function setupExpansionModelDropdown() {
    const container = document.getElementById('expansionModelDropdown');
    const button = document.getElementById('expansionModelDropdownBtn');
    const menu = document.getElementById('expansionModelDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionModelDropdown,
        () => document.getElementById('expansionModelInput')?.value || '',
        { preventFocusTransfer: true }
    );
}

// Setup expansion sampler dropdown
function setupExpansionSamplerDropdown() {
    const container = document.getElementById('expansionSamplerDropdown');
    const button = document.getElementById('expansionSamplerDropdownBtn');
    const menu = document.getElementById('expansionSamplerDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionSamplerDropdown,
        () => document.getElementById('expansionSamplerInput')?.value || '',
        { preventFocusTransfer: true }
    );
}

// Setup expansion noise scheduler dropdown
function setupExpansionNoiseSchedulerDropdown() {
    const container = document.getElementById('expansionNoiseSchedulerDropdown');
    const button = document.getElementById('expansionNoiseSchedulerDropdownBtn');
    const menu = document.getElementById('expansionNoiseSchedulerDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionNoiseSchedulerDropdown,
        () => document.getElementById('expansionNoiseSchedulerInput')?.value || '',
        { preventFocusTransfer: true }
    );
}

// Toggle upscale indicator
function toggleExpansionUpscale() {
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    if (!upscaleToggle) return;
    
    const currentState = upscaleToggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    upscaleToggle.setAttribute('data-state', newState);
}

// Toggle inset padding behavior
function toggleExpansionInset() {
    const insetToggle = document.getElementById('expansionInsetToggle');
    if (!insetToggle) return;
    
    const currentState = insetToggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    insetToggle.setAttribute('data-state', newState);
    expansionModalData.enableInset = newState === 'on';
}

// Toggle AI enhancement
function toggleExpansionAI() {
    const toggle = document.getElementById('expansionAIToggle');
    const requestedContentGroup = document.getElementById('expansionRequestedContentGroup');
    
    if (!toggle) return;
    
    const currentState = toggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    toggle.setAttribute('data-state', newState);
    
    expansionModalData.enableAI = newState === 'on';
    
    // Show/hide requested content group
    if (requestedContentGroup) {
        if (newState === 'on') {
            requestedContentGroup.classList.remove('hidden');
        } else {
            requestedContentGroup.classList.add('hidden');
        }
    }

    scheduleExpansionCompiledPromptReload();
}

// Update percentage overlay for an input
function updateExpansionPercentageOverlay(input, overlay, minVal = 0) {
    if (!input || !overlay) return;
    
    const value = parseFloat(input.value) || 0;
    const percentage = Math.round(value * 100);
    overlay.textContent = `${percentage}%`;
}

let imageExpansionKeyboardWired = false;

function isImageExpansionKeyboardContext() {
    const modal = document.getElementById('imageExpansionDialog');
    if (!modal || modal.classList.contains('hidden')) return false;

    const child = document.getElementById('expansionCompiledPromptDialog');
    if (child && !child.classList.contains('hidden') && !child.classList.contains('minimised')) {
        if (window.isDesktop && child.classList.contains('active-window')) {
            return false;
        }
        if (!window.isDesktop) {
            return false;
        }
    }

    // isModalActive: public/scripts/comp/modalUtils.js
    if (window.isDesktop && typeof isModalActive === 'function') {
        return isModalActive(modal);
    }
    return true;
}

function onImageExpansionKeydown(e) {
    if (!isImageExpansionKeyboardContext()) return;

    if (e.key === 'F5') {
        e.preventDefault();
        e.stopPropagation();
        const btn = document.getElementById('submitExpansionBtn');
        if (btn && !btn.disabled) btn.click();
        return true;
    }
}

function wireImageExpansionKeyboardShortcuts() {
    if (imageExpansionKeyboardWired) return;
    imageExpansionKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'imageExpansionDialog.keydown',
        handler: onImageExpansionKeydown,
        type: 'whenFocused',
        modalId: 'imageExpansionDialog',
        priority: 75,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('imageExpansionDialog', 'Expansion', [
        { id: 'overlay.imageExpansionDialog.run', label: 'Run expansion', keys: 'F5', icon: 'nai-sparkles' },
        { id: 'overlay.imageExpansionDialog.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
    ]);
}

// Initialize expansion modal when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    wireImageExpansionKeyboardShortcuts();
    // Setup all dropdowns
    setupExpansionResolutionDropdown();
    setupExpansionBiasDropdown();
    setupExpansionModelDropdown();
    setupExpansionSamplerDropdown();
    setupExpansionNoiseSchedulerDropdown();
    
    // Setup close button
    const closeBtn = document.getElementById('closeExpansionModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeImageExpansionModal);
    }
    
    // Setup submit button
    const submitBtn = document.getElementById('submitExpansionBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', submitImageExpansion);
    }
    
    // Setup advanced toggle
    const advancedToggle = document.getElementById('expansionAdvancedToggle');
    if (advancedToggle) {
        advancedToggle.addEventListener('click', toggleExpansionAdvancedOptions);
    }
    
    // Setup upscale toggle
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    if (upscaleToggle) {
        upscaleToggle.addEventListener('click', toggleExpansionUpscale);
    }
    
    // Setup inset toggle
    const insetToggle = document.getElementById('expansionInsetToggle');
    if (insetToggle) {
        insetToggle.addEventListener('click', toggleExpansionInset);
    }
    
    // Setup reroll button
    const rerollBtn = document.getElementById('rerollExpansionBtn');
    if (rerollBtn) {
        rerollBtn.addEventListener('click', submitImageExpansionReroll);
    }
    
    // Setup auto-seed toggle
    const autoSeedToggle = document.getElementById('expansionAutoSeedToggle');
    if (autoSeedToggle) {
        autoSeedToggle.addEventListener('click', toggleAutoSeed);
    }
    
    // Setup AI toggle
    const aiToggle = document.getElementById('expansionAIToggle');
    if (aiToggle) {
        aiToggle.addEventListener('click', toggleExpansionAI);
    }

    const expansionRequestedContent = document.getElementById('expansionRequestedContent');
    if (expansionRequestedContent) {
        expansionRequestedContent.addEventListener('input', () => {
            if (expansionModalData.enableAI) {
                scheduleExpansionCompiledPromptReload();
            }
        });
    }

    const expansionEditCompiledPromptBtn = document.getElementById('expansionEditCompiledPromptBtn');
    if (expansionEditCompiledPromptBtn) {
        expansionEditCompiledPromptBtn.addEventListener('click', openExpansionCompiledPromptEditor);
    }

    const saveExpansionCompiledPromptBtn = document.getElementById('saveExpansionCompiledPromptBtn');
    if (saveExpansionCompiledPromptBtn) {
        saveExpansionCompiledPromptBtn.addEventListener('click', saveExpansionCompiledPromptForSubmission);
    }

    const closeExpansionCompiledPromptBtn = document.getElementById('closeExpansionCompiledPromptBtn');
    if (closeExpansionCompiledPromptBtn) {
        closeExpansionCompiledPromptBtn.addEventListener('click', closeExpansionCompiledPromptEditor);
    }

    setupExpansionCompiledPromptTextareas();
    setupExpansionCompiledPromptTabSwitcher();

    // Setup wheel event listeners for numeric inputs with percentage overlays
    const rescaleInput = document.getElementById('expansionRescaleInput');
    const rescaleOverlay = document.getElementById('expansionRescaleOverlay');
    if (rescaleInput && rescaleOverlay) {
        rescaleInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.05) : (e.shiftKey ? 0.1 : 0.05);
            const currentValue = parseFloat(this.value) || 0;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateExpansionPercentageOverlay(this, rescaleOverlay, 0);
        });
        
        rescaleInput.addEventListener('input', function() {
            updateExpansionPercentageOverlay(this, rescaleOverlay, 0);
        });
    }
    
    const noiseInput = document.getElementById('expansionNoiseInput');
    const noiseOverlay = document.getElementById('expansionNoiseOverlay');
    if (noiseInput && noiseOverlay) {
        noiseInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            const currentValue = parseFloat(this.value) || 0;
            const newValue = Math.max(0, Math.min(0.99, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateExpansionPercentageOverlay(this, noiseOverlay, 0);
        });
        
        noiseInput.addEventListener('input', function() {
            updateExpansionPercentageOverlay(this, noiseOverlay, 0);
        });
    }
    
    // Setup wheel events for other numeric inputs
    const stepsInput = document.getElementById('expansionStepsInput');
    if (stepsInput) {
        stepsInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentValue = parseInt(this.value) || 28;
            const newValue = Math.max(1, Math.min(50, currentValue + delta));
            this.value = newValue;
        });
    }
    
    const guidanceInput = document.getElementById('expansionGuidanceInput');
    if (guidanceInput) {
        guidanceInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            const currentValue = parseFloat(this.value) || 5.0;
            const newValue = Math.max(0, Math.min(10, currentValue + delta));
            this.value = newValue.toFixed(1);
        });
    }
});
