// Prompt Textarea Toolbar Manager
// Handles the toolbar that appears at the bottom of prompt textareas when active

class PromptTextareaToolbar {
    constructor() {
        this.activeTextarea = null;
        this.tokenCounters = new Map();
        this.searchStates = new Map(); // Map of toolbar -> search state
        this.originalCharacterStates = new Map(); // Track original collapse states
        this._fieldTokenCache = new WeakMap();
        this._groupTotals = { editablePrompt: 0, editableUc: 0, nePrompt: 0, neUc: 0 };
        this._groupTotalsReady = false;
        this._bottomSummaryRaf = null;
        this._pendingBottomSummary = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initializeTokenCounters();
        this.initializeDropdowns();
        // initPromptTextareaContextMenu: public/scripts/comp/promptTextareaContextMenu.js
        if (initPromptTextareaContextMenu) {
            initPromptTextareaContextMenu();
        }
    }

    setupEventListeners() {
        // Optimized event delegation - use a single delegated listener for both focus events
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
                this.handleTextareaFocus(e.target);
            }
        }, true); // Use capture phase for better performance

        document.addEventListener('focusout', (e) => {
            if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
                this.handleTextareaBlur(e.target);
            }
        }, true); // Use capture phase for better performance
        
        // Bubble phase + rAF — passive observer; must not run before native input commits (capture blocked autocorrect).
        document.addEventListener('input', (e) => {
            const textarea = e.target;
            if (!textarea || !textarea.matches('.prompt-textarea, .character-prompt-textarea')) {
                return;
            }
            // scheduleTextInputSideEffect: public/scripts/comp/textareaUtils.js
            if (typeof scheduleTextInputSideEffect === 'function') {
                scheduleTextInputSideEffect(textarea, () => this.updateTokenCount(textarea));
            } else {
                this.updateTokenCount(textarea);
            }
        });

        // Listen for toolbar button clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.prompt-textarea-toolbar .toolbar-btn')) {
                const button = e.target.closest('.toolbar-btn');
                const action = button.dataset.action;
                const textarea = this.getTextareaFromToolbar(button);
                const toolbar = this.getToolbarFromTextarea(textarea);

                if (textarea && action) {
                    // Prevent the click from causing blur
                    e.preventDefault();
                    this.handleToolbarAction(action, textarea, toolbar, e);
                }
            }
        });

        // Prevent toolbar clicks from causing blur
        document.addEventListener('mousedown', (e) => {
            if (e.target.closest('.prompt-textarea-toolbar')) {
                e.preventDefault();
            }
        });

        // Search mode persists until explicitly closed - no auto-close on outside clicks

        // Listen for manual modal close events (only when search belongs to manual modal)
        document.addEventListener('click', (e) => {
            const activeToolbar = this.getActiveSearchToolbar();
            const manualModal = document.getElementById('manualModal');
            if (!activeToolbar || !manualModal || !manualModal.contains(activeToolbar)) {
                return;
            }
            if (!manualModal.contains(e.target) && !e.target.closest('.prompt-textarea-toolbar')) {
                this.resetAllSearchStates();
            }
        });

        // Listen for modal close button clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.close-btn, .close-modal, [data-dismiss="modal"]')) {
                // Modal close button clicked - reset search
                this.resetAllSearchStates();
            }
        }); 
    }

    handleTextareaFocus(textarea) {
        this.activeTextarea = textarea;
        const toolbar = this.getToolbarFromTextarea(textarea);
        const container = textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
        
        if (toolbar) {
            toolbar.classList.remove('hidden');
            if (!this.isStandardTextPromptTextarea(textarea)) {
                this.updateTokenCount(textarea);
                if (this._groupTotalsReady) {
                    this.refreshGroupToolbarTotals(this.isUcTextarea(textarea));
                }
            }
            
            // Add direct emphasis keyboard listener if not already added
            if (!this.isStandardTextPromptTextarea(textarea) &&
                !toolbar.hasAttribute('data-direct-emphasis-listener-added')) {
                this.addDirectEmphasisKeyboardListener(toolbar);
                toolbar.setAttribute('data-direct-emphasis-listener-added', 'true');
            }
            
            // Adjust container height to account for toolbar
            if (window.autoResizeTextarea) {
                setTimeout(() => window.autoResizeTextarea(textarea), 10);
            }
        }
        
        // Add custom class for persistent focus state (works even when window is not active)
        if (container) {
            container.classList.add('textarea-focused');
        }
    }

    handleTextareaBlur(textarea) {
        // Add a small delay to allow for button clicks
        if (this.activeTextarea === textarea) {
            const toolbar = this.getToolbarFromTextarea(textarea);
            const container = textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
            
            // If in search mode, don't hide the toolbar at all
            if (toolbar && toolbar.classList.contains('search-mode')) {
                return; // Keep toolbar visible in search mode
            }

            // Keep toolbar visible while emphasis editor is open
            if (toolbar && toolbar.classList.contains('emphasis-mode')) {
                return;
            }
            
            // Check if the new focus target is within the same container
            const newFocusTarget = document.activeElement;
            const isFocusWithinContainer = container && container.contains(newFocusTarget);
            
            // Hide toolbar if focus is outside container (including other textareas)
            if (toolbar && !isFocusWithinContainer) {
                toolbar.classList.add('hidden');
                this.activeTextarea = null;
                this.updateAllTokenCounts();
                // Adjust container height after toolbar is hidden
                if (window.autoResizeTextarea) {
                    setTimeout(() => window.autoResizeTextarea(textarea), 10);
                }
            }
            
            // Remove custom focus class if focus is outside container
            if (container && !isFocusWithinContainer) {
                container.classList.remove('textarea-focused');
            }
        }
    }

    getToolbarFromTextarea(textarea) {
        const container = textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
        return container ? container.querySelector('.prompt-textarea-toolbar') : null;
    }

    getTextareaFromToolbar(button) {
        const container = button.closest('.prompt-textarea-container, .character-prompt-textarea-container');
        if (!container) return null;

        // UC tab stacks manualUc + manualPromptNegative; querySelector would always return the first.
        if (this.activeTextarea && container.contains(this.activeTextarea)) {
            return this.activeTextarea;
        }

        return container.querySelector('.prompt-textarea, .character-prompt-textarea');
    }

    getActiveSearchToolbar() {
        // Find the toolbar that currently has search mode active
        for (const [toolbar, searchState] of this.searchStates) {
            if (toolbar.classList.contains('search-mode')) {
                return toolbar;
            }
        }
        return null;
    }

    getActiveSearchToolbarFromEvent(event) {
        // Get the toolbar from the event target (button, input, etc.)
        const toolbar = event.target.closest('.prompt-textarea-toolbar');
        if (toolbar && toolbar.classList.contains('search-mode')) {
            return toolbar;
        }
        return null;
    }

    initializeTokenCounters() {
        const textareas = document.querySelectorAll('.prompt-textarea, .character-prompt-textarea');
        textareas.forEach(textarea => {
            this.updateTokenCount(textarea);
        });
    }

    // Initialize dropdowns for character toolbars
    initializeCharacterDropdowns(characterId = null) {
        let characterDropdowns;

        if (characterId) {
            // Initialize dropdowns for a specific character
            const dropdown = document.getElementById(`characterActionsDropdown_${characterId}`);
            const ucDropdown = document.getElementById(`characterUCActionsDropdown_${characterId}`);
            characterDropdowns = [dropdown, ucDropdown].filter(Boolean);
        } else {
            // Initialize all character dropdowns (for loadCharacterPrompts)
            characterDropdowns = document.querySelectorAll('[id^="characterActionsDropdown_"], [id^="characterUCActionsDropdown_"]');
        }

        characterDropdowns.forEach(dropdown => {
            if (!dropdown || !dropdown.id) return;

            const dropdownBtn = document.getElementById(`${dropdown.id.replace('Dropdown', 'DropdownBtn')}`);
            const dropdownMenu = document.getElementById(`${dropdown.id.replace('Dropdown', 'DropdownMenu')}`);

            if (dropdown && dropdown.id && dropdownBtn && dropdownMenu && !dropdown.hasAttribute('data-dropdown-initialized')) {
                setupDropdown(
                    dropdown,
                    dropdownBtn,
                    dropdownMenu,
                    () => this.renderToolbarActionsDropdown(`${dropdown.id.replace('Dropdown', 'DropdownMenu')}`, this.getDreamStudioToolboxOptions({
                        includeTextExpanders: false,
                        includeMemoriesRules: false,
                        includePhasewalker: false
                    })),
                    () => null,
                    {
                        enableKeyboardNav: false,
                        preventFocusTransfer: true
                    }
                );
                dropdown.setAttribute('data-dropdown-initialized', 'true');
            }
        });
    }

    isUcTextarea(textarea) {
        if (!textarea) return false;
        return textarea.id === 'manualUc'
            || (textarea.id && textarea.id.endsWith('_uc'));
    }

    isStandardTextPromptTextarea(textarea) {
        return Boolean(textarea && textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt'));
    }

    collectEditorTokenTextareas() {
        const promptTextareas = [];
        const ucTextareas = [];

        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');
        if (manualPrompt) promptTextareas.push(manualPrompt);
        if (manualUc) ucTextareas.push(manualUc);

        const manualPromptNegative = document.getElementById('manualPromptNegative');
        if (manualPromptNegative) promptTextareas.push(manualPromptNegative);

        promptTextareas.push(...Array.from(document.querySelectorAll('[id$="_prompt"].character-prompt-textarea')));
        promptTextareas.push(...Array.from(document.querySelectorAll('[id$="_promptNegative"].character-prompt-textarea')));
        ucTextareas.push(...Array.from(document.querySelectorAll('[id$="_uc"].character-prompt-textarea')));

        return { promptTextareas, ucTextareas };
    }

    scheduleBottomSummaryUpdate(editablePrompt, editableUc, nePrompt, neUc, maxTokens) {
        this._pendingBottomSummary = { editablePrompt, editableUc, nePrompt, neUc, maxTokens };
        if (this._bottomSummaryRaf) return;
        this._bottomSummaryRaf = requestAnimationFrame(() => {
            this._bottomSummaryRaf = null;
            const pending = this._pendingBottomSummary;
            this._pendingBottomSummary = null;
            if (!pending) return;
            this.updateBottomSummary(
                pending.editablePrompt,
                pending.editableUc,
                pending.nePrompt,
                pending.neUc,
                pending.maxTokens
            );
        });
    }

    refreshGroupToolbarTotals(isUc) {
        const { promptTextareas, ucTextareas } = this.collectEditorTokenTextareas();
        const list = isUc ? ucTextareas : promptTextareas;
        const ne = isUc ? this._groupTotals.neUc : this._groupTotals.nePrompt;
        const editableGroup = isUc ? this._groupTotals.editableUc : this._groupTotals.editablePrompt;
        const groupTotal = editableGroup + ne;
        const maxTokens = 512;

        list.forEach((textarea) => {
            const cached = this._fieldTokenCache.get(textarea);
            const count = cached ? cached.count : this.calculateTokenCount(textarea.value || '');
            this.updateToolbarDisplay(textarea, count, ne, groupTotal, maxTokens);
        });
    }

    updateTokenCount(textarea) {
        if (!this._groupTotalsReady) {
            this.updateAllTokenCounts();
            return;
        }
        this.updateTokenCountIncremental(textarea);
    }

    updateTokenCountIncremental(changedTextarea) {
        if (!t5Tokenizer || !changedTextarea) return;
        if (!this._fieldTokenCache.has(changedTextarea)) {
            this.updateAllTokenCounts();
            return;
        }

        const isUc = this.isUcTextarea(changedTextarea);
        const stripped = stripPromptBlocksForEffectivePrompt(changedTextarea.value || '', { stageIndex: 0, pipelineStageGeneration: false });
        const newCount = t5Tokenizer.countTokens(stripped);
        const prev = this._fieldTokenCache.get(changedTextarea) || { count: 0, expanderNe: 0 };
        const countDelta = newCount - prev.count;

        if (isUc) {
            this._groupTotals.editableUc += countDelta;
        } else {
            this._groupTotals.editablePrompt += countDelta;
        }

        prev.count = newCount;
        this._fieldTokenCache.set(changedTextarea, prev);

        const ne = isUc ? this._groupTotals.neUc : this._groupTotals.nePrompt;
        const editableGroup = isUc ? this._groupTotals.editableUc : this._groupTotals.editablePrompt;
        const groupTotal = editableGroup + ne;

        this.updateToolbarDisplay(changedTextarea, newCount, ne, groupTotal, 512);
        this.scheduleBottomSummaryUpdate(
            this._groupTotals.editablePrompt,
            this._groupTotals.editableUc,
            this._groupTotals.nePrompt,
            this._groupTotals.neUc,
            512
        );
    }

    updateAllTokenCounts() {
        if (!t5Tokenizer) {
            console.warn('T5 Tokenizer not initialized yet');
            return;
        }

        const { promptTextareas, ucTextareas } = this.collectEditorTokenTextareas();

        // Strip stage blocks and disabled blocks (matches server); non-pipeline preview uses stage 0
        const stripForTokens = (s) => stripPromptBlocksForEffectivePrompt(s || '', { stageIndex: 0, pipelineStageGeneration: false });
        const promptTexts = promptTextareas.map((ta) => stripForTokens(ta.value || ''));
        const ucTexts = ucTextareas.map((ta) => stripForTokens(ta.value || ''));

        const promptAnalysis = t5Tokenizer.analyzeTexts(promptTexts);
        const ucAnalysis = t5Tokenizer.analyzeTexts(ucTexts);

        const editablePromptTotal = promptAnalysis.totalTokens;
        const editableUcTotal = ucAnalysis.totalTokens;

        const periodKey = window.currentPeriodKey || null;
        const model = typeof manualSelectedModel !== 'undefined' ? manualSelectedModel : null;
        const nonEditable = typeof getNonEditableTokenTotals === 'function'
            ? getNonEditableTokenTotals(promptTexts, ucTexts, periodKey, model)
            : { prompt: 0, uc: 0 };

        const totalPromptTokens = editablePromptTotal + nonEditable.prompt;
        const totalUcTokens = editableUcTotal + nonEditable.uc;

        this._groupTotals = {
            editablePrompt: editablePromptTotal,
            editableUc: editableUcTotal,
            nePrompt: nonEditable.prompt,
            neUc: nonEditable.uc
        };
        this._groupTotalsReady = true;

        const lockedSeeds = window.lastGenerationTextReplacements || window.lockedTextReplacements || [];
        promptTextareas.forEach((textarea, index) => {
            const result = promptAnalysis.results[index];
            const stripped = promptTexts[index];
            const expanderNe = typeof getExpanderTokenDeltaForText === 'function'
                ? getExpanderTokenDeltaForText(stripped, lockedSeeds, periodKey, model)
                : 0;
            this._fieldTokenCache.set(textarea, {
                count: result ? result.tokenCount : 0,
                expanderNe
            });
        });
        ucTextareas.forEach((textarea, index) => {
            const result = ucAnalysis.results[index];
            const stripped = ucTexts[index];
            const expanderNe = typeof getExpanderTokenDeltaForText === 'function'
                ? getExpanderTokenDeltaForText(stripped, lockedSeeds, periodKey, model)
                : 0;
            this._fieldTokenCache.set(textarea, {
                count: result ? result.tokenCount : 0,
                expanderNe
            });
        });

        const maxTokens = 512;

        // Update individual toolbars
        promptTextareas.forEach((textarea, index) => {
            const result = promptAnalysis.results[index];
            if (result) {
                this.updateToolbarDisplay(
                    textarea,
                    result.tokenCount,
                    nonEditable.prompt,
                    totalPromptTokens,
                    maxTokens
                );
            }
        });

        ucTextareas.forEach((textarea, index) => {
            const result = ucAnalysis.results[index];
            if (result) {
                this.updateToolbarDisplay(
                    textarea,
                    result.tokenCount,
                    nonEditable.uc,
                    totalUcTokens,
                    maxTokens
                );
            }
        });

        const editorTextareas = new Set([...promptTextareas, ...ucTextareas]);
        this.updateStandaloneTextareaTokenCounts(editorTextareas, maxTokens);

        // Update bottom summary
        this.updateBottomSummary(editablePromptTotal, editableUcTotal, nonEditable.prompt, nonEditable.uc, maxTokens);
    }

    // Textareas outside the manual editor (bracket gen, expanders, etc.) — per-field counts only
    updateStandaloneTextareaTokenCounts(editorTextareas, maxTokens = 512) {
        document.querySelectorAll('.prompt-textarea, .character-prompt-textarea').forEach((textarea) => {
            if (editorTextareas.has(textarea)) return;
            const toolbar = this.getToolbarFromTextarea(textarea);
            if (!toolbar) return;
            const tokenCount = this.calculateTokenCount(textarea.value || '');
            this.updateToolbarDisplay(textarea, tokenCount, 0, tokenCount, maxTokens);
        });
    }

    applyTokenProgressWidths(progressFill, editableTokens, nonEditableTokens, groupTotal, maxTokens) {
        if (!progressFill) return;
        const progressInner = progressFill.querySelector('.token-progress-inner');
        const innerNe = progressFill.querySelector('.token-progress-inner-ne');

        const groupPercentage = groupTotal > 0 ? Math.min((groupTotal / maxTokens) * 100, 100) : 0;
        progressFill.style.width = `${groupPercentage}%`;

        const editablePct = groupTotal > 0 ? (editableTokens / groupTotal) * 100 : 0;
        const nePct = groupTotal > 0 ? (nonEditableTokens / groupTotal) * 100 : 0;

        if (progressInner) {
            progressInner.style.width = `${editablePct}%`;
        }
        if (innerNe) {
            innerNe.style.width = `${nePct}%`;
        }
    }

    updateToolbarDisplay(textarea, editableTokens, nonEditableTokens, groupTotal, maxTokens) {
        const toolbar = this.getToolbarFromTextarea(textarea);
        if (!toolbar) return;

        const tokenCountElement = toolbar.querySelector('.token-count');
        const progressFill = toolbar.querySelector('.token-progress-fill');

        if (tokenCountElement) {
            const label = typeof formatTokenCountLabel === 'function'
                ? formatTokenCountLabel(editableTokens, nonEditableTokens)
                : `${editableTokens} tokens`;
            tokenCountElement.textContent = label;
        }

        this.applyTokenProgressWidths(progressFill, editableTokens, nonEditableTokens, groupTotal, maxTokens);
    }

    updateBottomSummary(editablePrompt, editableUc, nePrompt, neUc, maxTokens) {
        const totalPrompt = editablePrompt + nePrompt;
        const totalUc = editableUc + neUc;

        const promptTab = document.querySelector('#prompt-tab');
        const promptFill = promptTab?.querySelector('.token-progress-fill.prompt-total');
        if (promptFill) {
            this.applyTokenProgressWidths(promptFill, editablePrompt, nePrompt, totalPrompt, maxTokens);
        }

        const ucTab = document.querySelector('#uc-tab');
        const ucFill = ucTab?.querySelector('.token-progress-fill.uc-total');
        if (ucFill) {
            this.applyTokenProgressWidths(ucFill, editableUc, neUc, totalUc, maxTokens);
        }
    }

    calculateTokenCount(text) {
        const cleanedText = stripPromptBlocksForEffectivePrompt(text || '', { stageIndex: 0, pipelineStageGeneration: false });
        if (t5Tokenizer) {
            return t5Tokenizer.countTokens(cleanedText);
        }
        
        // Fallback estimation
        if (!cleanedText || cleanedText.trim() === '') return 0;
        const words = cleanedText.trim().split(/\s+/);
        return Math.max(1, Math.ceil(words.length * 1.3));
    }

    getDreamStudioToolboxOptions() {
        const menuOptions = [
            { value: 'search', display: 'Search', icon: 'fas fa-search', toolbarWide: true },
            { value: 'quick-access', display: 'Quick Access', icon: 'fas fa-book-atlas', toolbarWide: true },
            { value: 'lowercase', display: 'Lowercase', icon: 'fas fa-font' },
            { value: 'emphasis', display: 'Edit Emphasis', icon: 'fas fa-scale-unbalanced-flip' },
            { value: 'emphasis-groups-tool', display: 'Emphasis Groups', icon: 'fas fa-sliders' },
            { value: 'clear-emphasis', display: 'Reset Emphasis', icon: 'fas fa-eraser' },
            { value: 'split-emphasis', display: 'Split Emphasis', icon: 'fas fa-scissors', toolbarWide: true },
            { value: 'keep-newlines', display: 'Keep Newlines', icon: 'fas fa-paragraph', toggle: true },
            { value: 'request-body-replacements', display: 'Text Expanders', icon: 'fas fa-book-font' }
        ];
        return menuOptions;
    }

    initializeDropdowns() {
        // Set up dropdown functionality exactly like the dataset dropdown
        const dropdown = document.getElementById('promptActionsDropdown');
        const dropdownBtn = document.getElementById('promptActionsDropdownBtn');
        const dropdownMenu = document.getElementById('promptActionsDropdownMenu');

        if (dropdown && dropdownBtn && dropdownMenu) {
            // Use the exact same setup as dataset dropdown
            setupDropdown(
                dropdown,
                dropdownBtn,
                dropdownMenu,
                () => this.renderToolbarActionsDropdown('promptActionsDropdownMenu', this.getDreamStudioToolboxOptions()),
                () => null, // No getSelectedValue needed
                {
                    enableKeyboardNav: false, // Disable keyboard nav to prevent menu focus
                    preventFocusTransfer: true
                }
            );
        }

        // Also initialize UC actions dropdown
        const ucDropdown = document.getElementById('ucActionsDropdown');
        const ucDropdownBtn = document.getElementById('ucActionsDropdownBtn');
        const ucDropdownMenu = document.getElementById('ucActionsDropdownMenu');

        if (ucDropdown && ucDropdownBtn && ucDropdownMenu) {
            setupDropdown(
                ucDropdown,
                ucDropdownBtn,
                ucDropdownMenu,
                () => this.renderToolbarActionsDropdown('ucActionsDropdownMenu', this.getDreamStudioToolboxOptions()),
                () => null,
                {
                    enableKeyboardNav: false,
                    preventFocusTransfer: true
                }
            );
        }
        
        // Creative directive uses autofill-only toolbar — no toolbox dropdown

        this.initializeExpansionCompiledPromptDropdowns();
    }

    initializeExpansionCompiledPromptDropdowns() {
        const expansionPromptOptions = this.getDreamStudioToolboxOptions({ includeMemoriesRules: false, includePhasewalker: false });
        const expansionUcOptions = this.getDreamStudioToolboxOptions({
            includeTextExpanders: false,
            includeMemoriesRules: false,
            includePhasewalker: false
        });

        const pairs = [
            ['expansionCompiledPromptActionsDropdown', 'expansionCompiledPromptActionsDropdownBtn', 'expansionCompiledPromptActionsDropdownMenu', expansionPromptOptions],
            ['expansionCompiledUcActionsDropdown', 'expansionCompiledUcActionsDropdownBtn', 'expansionCompiledUcActionsDropdownMenu', expansionUcOptions]
        ];

        pairs.forEach(([dropdownId, btnId, menuId, options]) => {
            const dropdown = document.getElementById(dropdownId);
            const dropdownBtn = document.getElementById(btnId);
            const dropdownMenu = document.getElementById(menuId);
            if (!dropdown || !dropdownBtn || !dropdownMenu || dropdown.hasAttribute('data-dropdown-initialized')) {
                return;
            }
            setupDropdown(
                dropdown,
                dropdownBtn,
                dropdownMenu,
                () => this.renderToolbarActionsDropdown(menuId, options),
                () => null,
                { enableKeyboardNav: false, preventFocusTransfer: true }
            );
            dropdown.setAttribute('data-dropdown-initialized', 'true');
        });
    }

    renderToolbarActionsDropdown(dropdownMenuId, options) {
        // Generic render function for toolbar action dropdowns
        const dropdownMenu = document.getElementById(dropdownMenuId);
        if (!dropdownMenu) return;

        dropdownMenu.innerHTML = '';

        options.forEach(option => {
            const isToggleOn = option.toggle && option.value === 'keep-newlines' && !!window.keepPromptNewlines;
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option'
                + (option.toolbarWide ? ' toolbar-menu-only' : '')
                + (isToggleOn ? ' selected' : '');
            optionElement.dataset.value = option.value;
            optionElement.innerHTML = `<i class="${option.icon}"></i> ${option.display}`;

            // Add click handler - find active textarea and toolbar, then call handleToolbarAction
            optionElement.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Find the active textarea (same logic as handleToolbarAction)
                const activeTextarea = this.activeTextarea;
                if (!activeTextarea) return;

                const toolbar = this.getToolbarFromTextarea(activeTextarea);
                if (!toolbar) return;

                // Close the dropdown after handling the action
                if (!option.toggle) {
                    const dropdown = dropdownMenu.closest('.custom-dropdown');
                    if (dropdown) {
                        // Find the correct button for this dropdown
                        const button = dropdown.querySelector('.custom-dropdown-btn') || dropdown.querySelector('button');
                        if (button) {
                            closeDropdown(dropdownMenu, button);
                        }
                    }
                }

                // Call handleToolbarAction with the correct parameters
                this.handleToolbarAction(option.value, activeTextarea, toolbar, e);

                if (option.toggle) {
                    optionElement.classList.toggle('selected', !!window.keepPromptNewlines);
                }
            });

            dropdownMenu.appendChild(optionElement);
        });
    }

    handleToolbarAction(action, textarea, toolbar, event) {
        if (this.isStandardTextPromptTextarea(textarea)) {
            const allowed = new Set(['autofill', 'search', 'search-prev', 'search-next', 'search-select', 'search-close']);
            if (!allowed.has(action)) {
                return;
            }
        }

        switch (action) {
            case 'quick-access':
                this.openQuickAccess(textarea);
                break;
            case 'search':
                this.openSearch(textarea);
                break;
            case 'emphasis':
                this.openEmphasisMode(textarea, toolbar);
                break;
            case 'emphasis-groups-tool':
                if (emphasisGroupsToolManager) {
                    emphasisGroupsToolManager.openForTextarea(textarea);
                }
                break;
            case 'clear-emphasis':
                if (removeAllEmphasisFromSelection) {
                    removeAllEmphasisFromSelection(textarea);
                    if (window.updateEmphasisHighlighting) {
                        window.updateEmphasisHighlighting(textarea);
                    }
                }
                break;
            case 'split-emphasis':
                if (splitEmphasisBlock) {
                    const success = splitEmphasisBlock(textarea);
                    if (success && window.updateEmphasisHighlighting) {
                        window.updateEmphasisHighlighting(textarea);
                    }
                }
                break;
            case 'lowercase':
                this.lowercasePromptText(textarea);
                break;
            case 'search-prev':
                this.navigateSearchResult(-1, toolbar);
                break;
            case 'search-next':
                this.navigateSearchResult(1, toolbar);
                break;
            case 'search-close':
                this.closeSearch(toolbar);
                break;
            case 'request-body-replacements':
                showRequestBodyReplacementsModal();
                break;
            case 'manage-director-rules':
                // Rules now live inside the Memories DSAP (static rules)
                if (typeof openDsapInGrimoire === 'function') {
                    openDsapInGrimoire('dsap://memories.dyna.dreamscape.jp/static_rules');
                } else if (typeof showDirectorRulesManager === 'function') {
                    showDirectorRulesManager(); // legacy fallback
                }
                break;
            case 'enshutsuka-memories':
                if (typeof openDsapInGrimoire === 'function') {
                    openDsapInGrimoire('dsap://memories.dyna.dreamscape.jp');
                } else if (typeof openKnowledgeMemoriesModal === 'function') {
                    openKnowledgeMemoriesModal();
                }
                break;
            case 'phasewalker':
                // bracketGenerationApplet: public/scripts/comp/bracketGenerationApplet.js
                if (window.bracketGenerationApplet) {
                    window.bracketGenerationApplet.open();
                } else {
                    const phasewalkerModal = document.getElementById('bracketGenerationModal');
                    if (phasewalkerModal) openModal(phasewalkerModal);
                }
                break;
            case 'autofill':
                this.toggleAutofill(toolbar);
                break;
            case 'keep-newlines':
                this.toggleKeepNewlines();
                break;
        }
    }

    openQuickAccess(textarea) {
        // Open the dataset tag toolbar
        if (window.showDatasetTagToolbar) {
            window.showDatasetTagToolbar();
        }
    }

    lowercasePromptText(textarea) {
        if (!textarea) return;

        const value = textarea.value;
        if (!value) return;

        const lowercased = value.split('Text:').map((part, index) => {
            const lowerPart = part.toLowerCase();
            return index === 0 ? lowerPart : 'Text:' + lowerPart;
        }).join('');

        if (lowercased === value) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(textarea, lowercased);
        textarea.setSelectionRange(
            Math.min(start, lowercased.length),
            Math.min(end, lowercased.length)
        );
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        this.updateTokenCount(textarea);
        if (window.updateEmphasisHighlighting) {
            window.updateEmphasisHighlighting(textarea);
        }
    }

    openSearch(textarea) {
        const toolbar = this.getToolbarFromTextarea(textarea);
        if (!toolbar) return;

        // Add search mode class to show search elements
        toolbar.classList.add('search-mode');

        // Expand character prompts for main editor search only (not isolated modal fields)
        if (!textarea.closest('#expansionCompiledPromptDialog')) {
            this.expandAllCharacterPrompts();
        }

        // Initialize search functionality
        this.initializeSearchMode(textarea, toolbar);
    }

    initializeSearchMode(textarea, toolbar) {
        const searchElements = toolbar.querySelector('.toolbar-search-elements');
        const searchButtons = toolbar.querySelector('.toolbar-search-buttons');
        
        if (!searchElements || !searchButtons) {
            console.error('Search elements not found in toolbar:', toolbar);
            return;
        }
        
        const searchInput = searchElements.querySelector('.text-search-input');
        const matchCount = searchElements.querySelector('.text-search-match-count');
        const prevBtn = searchButtons.querySelector('.text-search-prev');
        const nextBtn = searchButtons.querySelector('.text-search-next');
        const closeBtn = searchButtons.querySelector('.text-search-close');
        
        // Create select button if it doesn't exist
        let selectBtn = searchButtons.querySelector('.text-search-select');
        if (!selectBtn) {
            selectBtn = document.createElement('button');
            selectBtn.type = 'button';
            selectBtn.className = 'btn-secondary btn-small toolbar-btn text-search-select';
            selectBtn.setAttribute('data-action', 'search-select');
            selectBtn.setAttribute('title', 'Select (Enter)');
            selectBtn.innerHTML = '<i class="fas fa-arrow-right-long-to-line"></i>';
            
            // Insert before the close button
            closeBtn.parentNode.insertBefore(selectBtn, closeBtn);
        }
        
        if (!searchInput || !matchCount || !prevBtn || !nextBtn || !closeBtn) {
            console.error('Required search elements not found');
            return;
        }

        // Search state per toolbar
        const searchState = {
            textarea: textarea,
            toolbar: toolbar,
            searchElements: searchElements,
            searchButtons: searchButtons,
            query: '',
            results: [],
            selectedIndex: -1,
            highlightOverlay: null
        };
        
        this.searchStates.set(toolbar, searchState);

        // Add input event listener to exit search when typing in textarea
        const textareaInputHandler = () => {
            if (toolbar.classList.contains('search-mode')) {
                this.closeSearch(toolbar);
            }
        };
        
        const textareaKeydownHandler = (e) => {
            if (toolbar.classList.contains('search-mode') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Don't exit for navigation keys, but exit for typing
                if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                    this.closeSearch(toolbar);
                }
            }
        };
        
        // Store the handlers so we can remove them later
        textarea._searchInputHandler = textareaInputHandler;
        textarea._searchKeydownHandler = textareaKeydownHandler;
        
        textarea.addEventListener('input', textareaInputHandler);
        textarea.addEventListener('keydown', textareaKeydownHandler);

        // Focus the search input
        searchInput.focus();
        searchInput.select();

        // Add event listeners only if they haven't been added yet
        if (!searchInput.hasAttribute('data-listeners-attached')) {
            searchInput.addEventListener('input', (e) => {
                const searchState = this.searchStates.get(toolbar);
                if (searchState) {
                    searchState.query = e.target.value;
                    this.performSearch(toolbar);
                }
            });

            searchInput.addEventListener('keydown', (e) => {
                this.handleSearchKeydown(e);
            });

            // Ensure search input is clickable
            searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
                searchInput.focus();
            });

            // Mark as having listeners attached
            searchInput.setAttribute('data-listeners-attached', 'true');
        }

        if (!prevBtn.hasAttribute('data-listeners-attached')) {
            prevBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateSearchResult(-1, toolbar);
            });
            prevBtn.setAttribute('data-listeners-attached', 'true');
        }

        if (!nextBtn.hasAttribute('data-listeners-attached')) {
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateSearchResult(1, toolbar);
            });
            nextBtn.setAttribute('data-listeners-attached', 'true');
        }

        if (!selectBtn.hasAttribute('data-listeners-attached')) {
            selectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (searchState.selectedIndex >= 0) {
                    this.jumpToSearchResult(toolbar);
                    // closeSearch will be called from jumpToSearchResult if switching textareas
                }
            });
            selectBtn.setAttribute('data-listeners-attached', 'true');
        }

        if (!closeBtn.hasAttribute('data-listeners-attached')) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeSearch(toolbar);
            });
            closeBtn.setAttribute('data-listeners-attached', 'true');
        }
    }

    performSearch(toolbar = null) {
        // Get the current active search state
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { query, searchElements } = searchState;
        const matchCount = searchElements.querySelector('.text-search-match-count');

        if (!query.trim()) {
            searchState.results = [];
            searchState.selectedIndex = -1;
            matchCount.textContent = '0';
            this.clearAllSearchHighlights();
            return;
        }

        const searchQuery = query.toLowerCase();
        const allResults = [];
        
        // Get the active textarea associated with this toolbar
        const activeTextarea = this.getTextareaFromToolbar(activeToolbar);
        
        // Check if the active textarea is in a single-field prompt container
        const isSingleFieldPromptSearch = activeTextarea && activeTextarea.closest(
            '.prompt-textarea-container.director-prompt, .prompt-textarea-container.text-overlay-prompt, #expansionCompiledPromptDialog .prompt-textarea-container'
        );
        
        // If searching in a director/overlay prompt, only search that specific textarea
        if (isSingleFieldPromptSearch) {
            const text = activeTextarea.value;
            let index = 0;
            
            // Find all occurrences of the search term in this textarea only (case insensitive)
            while ((index = text.toLowerCase().indexOf(searchQuery, index)) !== -1) {
                allResults.push({
                    textarea: activeTextarea,
                    textareaIndex: 0,
                    start: index,
                    end: index + searchQuery.length,
                    text: text.substring(index, index + searchQuery.length)
                });
                index += 1; // Move to next character to avoid infinite loop
            }
        } else {
            // Search across textareas based on current view mode
            const allTextareas = document.querySelectorAll('.prompt-textarea, .character-prompt-textarea');
            
            allTextareas.forEach((textarea, textareaIndex) => {
                // Only include textareas that should be searched based on current view mode
                if (!this.shouldIncludeTextareaInSearch(textarea)) {
                    return;
                }
                
                const text = textarea.value;
                let index = 0;
                
                // Find all occurrences of the search term in this textarea (case insensitive)
                while ((index = text.toLowerCase().indexOf(searchQuery, index)) !== -1) {
                    allResults.push({
                        textarea: textarea,
                        textareaIndex: textareaIndex,
                        start: index,
                        end: index + searchQuery.length,
                        text: text.substring(index, index + searchQuery.length)
                    });
                    index += 1; // Move to next character to avoid infinite loop
                }
            });
        }

        searchState.results = allResults;
        
        // Prioritize selecting a result from the current textarea if available
        if (allResults.length > 0) {
            const currentTextarea = searchState.textarea;
            const currentTextareaResults = allResults.filter(r => r.textarea === currentTextarea);
            
            if (currentTextareaResults.length > 0) {
                // Select first result from current textarea
                searchState.selectedIndex = allResults.indexOf(currentTextareaResults[0]);
            } else {
                // Fall back to first result overall
                searchState.selectedIndex = 0;
            }
        } else {
            searchState.selectedIndex = -1;
        }
        
        this.updateSearchResults(activeToolbar);
        this.highlightAllSearchResults();
    }

    updateSearchResults(toolbar = null) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { searchElements, results, selectedIndex } = searchState;
        const matchCount = searchElements.querySelector('.text-search-match-count');

        if (results.length === 0) {
            matchCount.textContent = '0';
            return;
        }

        // Show current match number and total (e.g., "2/5")
        const currentMatch = selectedIndex >= 0 ? selectedIndex + 1 : 0;
        matchCount.textContent = `${currentMatch}/${results.length}`;
    }

    navigateSearchResult(direction, toolbar = null) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { results, selectedIndex } = searchState;
        if (results.length === 0) return;

        // Simple navigation through all results
        if (direction === -1) {
            // Previous
            searchState.selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : results.length - 1;
        } else {
            // Next
            searchState.selectedIndex = selectedIndex < results.length - 1 ? selectedIndex + 1 : 0;
        }

        this.updateSearchResults(activeToolbar);
        this.highlightAllSearchResults();
        this.scrollToHighlightedResult(activeToolbar);
    }

    highlightSearchResults(toolbar = null) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { textarea, results, selectedIndex } = searchState;
        
        if (results.length === 0) {
            this.clearSearchHighlights(activeToolbar);
            return;
        }

        // Create or update highlight overlay
        if (!searchState.highlightOverlay) {
            searchState.highlightOverlay = ensurePromptSearchHighlightOverlay(textarea);
        }
        if (!searchState.highlightOverlay) return;

        const text = textarea.value;
        
        // Build highlighted text by processing each character and inserting spans at the right positions
        let highlightedText = '';
        let currentPos = 0;
        
        // Sort results by start position to process them in order
        const sortedResults = [...results].sort((a, b) => a.start - b.start);
        
        for (const result of sortedResults) {
            // Add text before this match
            highlightedText += text.substring(currentPos, result.start);
            
            // Add the highlighted match
            const originalIndex = results.indexOf(result);
            const isSelected = originalIndex === selectedIndex;
            const highlightClass = isSelected ? 'search-highlight-selected' : 'search-highlight';
            const matchText = text.substring(result.start, result.end);
            
            highlightedText += `<span class="${highlightClass}">${matchText}</span>`;
            
            // Update position
            currentPos = result.end;
        }
        
        // Add remaining text after the last match
        highlightedText += text.substring(currentPos);

        searchState.highlightOverlay.innerHTML = highlightedText;
        searchState.highlightOverlay.scrollTop = textarea.scrollTop;
        searchState.highlightOverlay.scrollLeft = textarea.scrollLeft;
    }

    highlightAllSearchResults() {
        const activeToolbar = this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { results, selectedIndex } = searchState;
        
        if (results.length === 0) {
            this.clearAllSearchHighlights();
            return;
        }

        // Clear all existing highlights first
        this.clearAllSearchHighlights();

        // Highlight results in all textareas
        results.forEach((result, index) => {
            const isSelected = index === selectedIndex;
            this.highlightSearchResultInTextarea(result, isSelected);
        });
    }

    highlightSearchResultInTextarea(result, isSelected) {
        const { textarea, start, end } = result;
        
        // Create or update highlight overlay for this textarea
        let highlightOverlay = ensurePromptSearchHighlightOverlay(textarea);
        if (!highlightOverlay) return;

        const text = textarea.value;
        
        // Build highlighted text by processing each character and inserting spans at the right positions
        let highlightedText = '';
        let currentPos = 0;
        
        // Find all results for this specific textarea
        const activeToolbar = this.getActiveSearchToolbar();
        const searchState = this.searchStates.get(activeToolbar);
        const textareaResults = searchState ? searchState.results.filter(r => r.textarea === textarea) : [];
        
        // Sort results by start position to process them in order
        const sortedResults = [...textareaResults].sort((a, b) => a.start - b.start);
        
        for (const textareaResult of sortedResults) {
            // Add text before this match
            highlightedText += text.substring(currentPos, textareaResult.start);
            
            // Add the highlighted match
            const originalIndex = searchState.results.indexOf(textareaResult);
            const isResultSelected = originalIndex === searchState.selectedIndex;
            const highlightClass = isResultSelected ? 'search-highlight-selected' : 'search-highlight';
            const matchText = text.substring(textareaResult.start, textareaResult.end);
            
            highlightedText += `<span class="${highlightClass}">${matchText}</span>`;
            
            // Update position
            currentPos = textareaResult.end;
        }
        
        // Add remaining text after the last match
        highlightedText += text.substring(currentPos);

        highlightOverlay.innerHTML = highlightedText;
        highlightOverlay.scrollTop = textarea.scrollTop;
        highlightOverlay.scrollLeft = textarea.scrollLeft;
    }

    clearAllSearchHighlights() {
        // Clear highlights from all textareas
        const allTextareas = document.querySelectorAll('.prompt-textarea, .character-prompt-textarea');
        allTextareas.forEach(textarea => {
            const host = getPromptTextareaOverlayHost(textarea);
            const highlightOverlay = host && host.querySelector(':scope > .search-highlight-overlay');
            if (highlightOverlay) {
                highlightOverlay.remove();
            }
        });
    }

    resetAllSearchStates() {
        // Clear all search states and close any active search modes
        this.searchStates.forEach((searchState, toolbar) => {
            // Remove search mode class
            toolbar.classList.remove('search-mode');
            
            // Reset search label and placeholder
            const searchLabel = toolbar.querySelector('.text-search-label');
            if (searchLabel) {
                searchLabel.textContent = 'Search';
            }
            
            const searchInput = toolbar.querySelector('.text-search-input');
            if (searchInput) {
                searchInput.placeholder = 'Find Tag';
                searchInput.value = '';
            }
            
            // Reset match count
            const matchCount = toolbar.querySelector('.text-search-match-count');
            if (matchCount) {
                matchCount.textContent = '0';
            }
        });
        
        // Clear all search states
        this.searchStates.clear();
        
        // Clear all search highlights
        this.clearAllSearchHighlights();
        
        // Restore character prompt states
        this.restoreCharacterPromptStates();
    }

    expandAllCharacterPrompts() {
        // Store original collapse states and expand all character prompts
        this.originalCharacterStates.clear();
        
        const characterItems = document.querySelectorAll('.character-prompt-item');
        characterItems.forEach(item => {
            const characterId = item.id;
            const isCollapsed = item.classList.contains('collapsed');
            
            // Store original state
            this.originalCharacterStates.set(characterId, isCollapsed);
            
            // Expand if collapsed
            if (isCollapsed) {
                item.classList.remove('collapsed');
                // Update the collapse button state
                if (window.updateCharacterPromptCollapseButton) {
                    window.updateCharacterPromptCollapseButton(characterId, false);
                }
            }
        });
    }

    restoreCharacterPromptStates() {
        // Restore all character prompts to their original collapse states
        this.originalCharacterStates.forEach((wasCollapsed, characterId) => {
            const item = document.getElementById(characterId);
            if (item) {
                if (wasCollapsed) {
                    item.classList.add('collapsed');
                    if (window.updateCharacterPromptCollapseButton) {
                        window.updateCharacterPromptCollapseButton(characterId, true);
                    }
                } else {
                    item.classList.remove('collapsed');
                    if (window.updateCharacterPromptCollapseButton) {
                        window.updateCharacterPromptCollapseButton(characterId, false);
                    }
                }
            }
        });
    }

    expandCharacterPromptWithSelection(textarea) {
        // Find and expand the character prompt that contains the selected textarea
        if (textarea && textarea.id.includes('_')) {
            // Extract character ID from textarea ID (e.g., "char_123_prompt" -> "char_123")
            const characterId = textarea.id.split('_').slice(0, -1).join('_');
            const characterItem = document.getElementById(characterId);
            
            if (characterItem && characterItem.classList.contains('collapsed')) {
                characterItem.classList.remove('collapsed');
                if (window.updateCharacterPromptCollapseButton) {
                    window.updateCharacterPromptCollapseButton(characterId, false);
                }
            }
        }
    }

    getCurrentViewMode() {
        // Check if we're in show-both mode
        const promptTabs = document.querySelector('.prompt-tabs');
        const isShowingBoth = promptTabs && promptTabs.classList.contains('show-both');
        
        if (isShowingBoth) {
            return 'both';
        }
        
        // Check which tab is currently active
        const tabButtons = document.querySelector('#tab-buttons');
        if (tabButtons) {
            const activeTab = tabButtons.getAttribute('data-active');
            return activeTab || 'prompt';
        }
        
        return 'prompt'; // Default to prompt mode
    }

    shouldIncludeTextareaInSearch(textarea) {
        const viewMode = this.getCurrentViewMode();
        const textareaId = textarea.id;
        
        // Always include character prompt textareas
        if (textareaId.includes('_prompt') || textareaId.includes('_uc') || textareaId.includes('_promptNegative')) {
            return true;
        }
        
        // Handle main textareas based on view mode
        if (viewMode === 'both') {
            // Show both mode: include both prompt and UC
            return textareaId === 'manualPrompt' || textareaId === 'manualUc' || textareaId === 'manualPromptNegative';
        } else if (viewMode === 'uc') {
            // UC mode: include UC and inline negative textareas
            return textareaId === 'manualUc' || textareaId === 'manualPromptNegative';
        } else {
            // Prompt mode (default): only include prompt textarea
            return textareaId === 'manualPrompt';
        }
    }

    clearSearchHighlights(toolbar = null) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        if (searchState.highlightOverlay) {
            searchState.highlightOverlay.remove();
            searchState.highlightOverlay = null;
        }
    }

    scrollToHighlightedResult(toolbar = null) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { results, selectedIndex } = searchState;
        
        if (selectedIndex >= 0 && selectedIndex < results.length) {
            const result = results[selectedIndex];
            const textarea = result.textarea;
            
            // Ensure the highlighted text is visible by scrolling
            const textBeforeSelection = textarea.value.substring(0, result.start);
            const tempSpan = document.createElement('span');
            tempSpan.style.font = window.getComputedStyle(textarea).font;
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            tempSpan.style.whiteSpace = 'pre';
            tempSpan.textContent = textBeforeSelection;
            document.body.appendChild(tempSpan);
            
            const textWidth = tempSpan.offsetWidth;
            document.body.removeChild(tempSpan);
            
            // Scroll to make the selection visible
            const container = textarea.parentElement;
            const containerWidth = container.offsetWidth;
            const scrollLeft = textWidth - containerWidth / 2;
            
            if (scrollLeft > 0) {
                textarea.scrollLeft = scrollLeft;
            }
        }
    }

    handleSearchKeydown(e) {
        const activeToolbar = this.getActiveSearchToolbarFromEvent(e);
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.navigateSearchResult(-1, activeToolbar);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.navigateSearchResult(1, activeToolbar);
                break;
            case 'Enter':
                e.preventDefault();
                if (searchState.selectedIndex >= 0) {
                    this.jumpToSearchResult(activeToolbar);
                    // closeSearch will be called from jumpToSearchResult if switching textareas
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.closeSearch(activeToolbar);
                break;
        }
    }

    jumpToSearchResult(toolbar = null) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { results, selectedIndex } = searchState;
        
        if (selectedIndex >= 0 && selectedIndex < results.length) {
            const result = results[selectedIndex];
            const textarea = result.textarea;
            
            // Now we can focus and select the text since Enter was pressed
            // Ensure the textarea is properly focused and activated
            textarea.focus();
            textarea.click(); // Additional activation step
            
            // Add focus styling to the container
            const textareaContainer = textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
            if (textareaContainer) {
                textareaContainer.classList.add('textarea-focused');
            }
            
            // Expand the character prompt if this is a character textarea
            this.expandCharacterPromptWithSelection(textarea);
            
            // Use a longer timeout to ensure the textarea is fully active
            setTimeout(() => {
                try {
                    textarea.setSelectionRange(result.start, result.end);
                    // Ensure the selection is visible
                    textarea.scrollTop = 0;
                    textarea.scrollLeft = 0;
                } catch (e) {
                    console.warn('Failed to set selection range:', e);
                }
            }, 150);
            
            // Ensure the selected text is visible
            const textBeforeSelection = textarea.value.substring(0, result.start);
            const tempSpan = document.createElement('span');
            tempSpan.style.font = window.getComputedStyle(textarea).font;
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            tempSpan.style.whiteSpace = 'pre';
            tempSpan.textContent = textBeforeSelection;
            document.body.appendChild(tempSpan);
            
            const textWidth = tempSpan.offsetWidth;
            document.body.removeChild(tempSpan);
            
            // Scroll to make the selection visible
            const container = textarea.parentElement;
            const containerWidth = container.offsetWidth;
            const scrollLeft = textWidth - containerWidth / 2;
            
            if (scrollLeft > 0) {
                textarea.scrollLeft = scrollLeft;
            }
            
            // Check if we're switching to a different textarea
            const originalTextarea = searchState.textarea;
            const isSwitchingTextareas = textarea !== originalTextarea;
            
            // If switching textareas, hide the toolbar and handle blur for original textarea
            if (isSwitchingTextareas) {
                // Get the original toolbar and hide it
                const originalToolbar = this.getToolbarFromTextarea(originalTextarea);
                if (originalToolbar) {
                    originalToolbar.classList.add('hidden');
                }
                
                // Manually trigger all the blur actions that would normally happen
                const originalContainer = originalTextarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
                
                // Remove focus styling from original textarea container
                if (originalContainer) {
                    originalContainer.classList.remove('textarea-focused');
                }
                
                // Clear the active textarea reference
                if (this.activeTextarea === originalTextarea) {
                    this.activeTextarea = null;
                }
                
                // Adjust container height after toolbar is hidden
                if (window.autoResizeTextarea) {
                    setTimeout(() => window.autoResizeTextarea(originalTextarea), 10);
                }
            }
            
            // Always close search at the end, but keep focus on current element if switching textareas
            this.closeSearch(activeToolbar, isSwitchingTextareas);
        }
    }

    closeSearch(toolbar = null, keepFocusOnCurrent = false) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        // Store reference to original textarea before clearing state
        const originalTextarea = searchState.textarea;
        
        // Remove event listeners if they exist
        if (originalTextarea && originalTextarea._searchInputHandler) {
            originalTextarea.removeEventListener('input', originalTextarea._searchInputHandler);
            originalTextarea._searchInputHandler = null;
        }
        if (originalTextarea && originalTextarea._searchKeydownHandler) {
            originalTextarea.removeEventListener('keydown', originalTextarea._searchKeydownHandler);
            originalTextarea._searchKeydownHandler = null;
        }
        
        // Clear search state
        this.clearAllSearchHighlights();
        this.searchStates.delete(activeToolbar);
        
        // Remove search mode class to hide search elements
        activeToolbar.classList.remove('search-mode');
        
        // Reset the search label
        const searchLabel = activeToolbar.querySelector('.text-search-label');
        if (searchLabel) {
            searchLabel.textContent = 'Search';
        }
        
        // Reset the search input placeholder
        const searchInput = activeToolbar.querySelector('.text-search-input');
        if (searchInput) {
            searchInput.placeholder = 'Find Tag';
        }
        
        // Restore character prompt states to their original collapse/expand state
        this.restoreCharacterPromptStates();
        
        // Only return focus to original textarea if not keeping focus on current element
        if (originalTextarea && !keepFocusOnCurrent) {
            setTimeout(() => originalTextarea.focus(), 10);
        }
    }

    openEmphasis(textarea) {
        // Open the emphasis toolbar
        if (window.startEmphasisEditing) {
            window.startEmphasisEditing(textarea);
        }
    }

    openEmphasisMode(textarea, toolbar) {
        // Start emphasis editing mode in the toolbar
        if (!window.startEmphasisEditing) {
            return;
        }

        // Start emphasis editing
        window.startEmphasisEditing(textarea);

        // Add emphasis mode class to show emphasis elements
        toolbar.classList.add('emphasis-mode');
        toolbar.classList.remove('hidden');

        // Initialize emphasis mode
        this.initializeEmphasisMode(textarea, toolbar);

        // Update emphasis display immediately
        this.updateEmphasisDisplay(toolbar);
        
        // Ensure textarea maintains focus for keyboard input
        setTimeout(() => textarea.focus(), 10);
    }

    initializeEmphasisMode(textarea, toolbar) {
        // Create emphasis elements if they don't exist
        let emphasisElements = toolbar.querySelector('.toolbar-emphasis-elements');
        if (!emphasisElements) {
            emphasisElements = document.createElement('div');
            emphasisElements.className = 'toolbar-emphasis-elements';
            emphasisElements.innerHTML = `
                <div class="emphasis-toolbar">
                    <div class="emphasis-type">New Group</div>
                    <div class="emphasis-value" title="Scroll ±0.1 · Shift+scroll ±0.01">1.0</div>
                    <div class="emphasis-controls">
                        <button class="btn-secondary emphasis-btn btn-small emphasis-up" data-action="emphasis-up" title="Increase">
                            <i class="nai-plus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn btn-small emphasis-down" data-action="emphasis-down" title="Decrease">
                            <i class="nai-minus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn btn-small emphasis-toggle hidden" data-action="emphasis-toggle" title="Toggle Mode">
                            <i class="nai-arrow-left"></i>
                        </button>
                        <div class="emphasis-actions">
                            <button class="btn-secondary emphasis-btn btn-small toolbar-btn emphasis-apply" data-action="emphasis-apply" title="Apply (Enter)">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="btn-secondary emphasis-btn btn-small toolbar-btn emphasis-cancel" data-action="emphasis-cancel" title="Cancel (Esc)">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            toolbar.appendChild(emphasisElements);
        }

        // Add event listeners for emphasis buttons only if they haven't been added yet
        const upBtn = emphasisElements.querySelector('[data-action="emphasis-up"]');
        const downBtn = emphasisElements.querySelector('[data-action="emphasis-down"]');
        const toggleBtn = emphasisElements.querySelector('[data-action="emphasis-toggle"]');
        const applyBtn = emphasisElements.querySelector('[data-action="emphasis-apply"]');
        const cancelBtn = emphasisElements.querySelector('[data-action="emphasis-cancel"]');

        // Check if listeners are already attached to prevent duplicates
        if (upBtn && !upBtn.hasAttribute('data-listeners-attached')) {
            upBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const step = getEmphasisAdjustStep(e.shiftKey);
                this.adjustEmphasis(step, toolbar);
            });
            upBtn.setAttribute('data-listeners-attached', 'true');
        }
        if (downBtn && !downBtn.hasAttribute('data-listeners-attached')) {
            downBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const step = getEmphasisAdjustStep(e.shiftKey);
                this.adjustEmphasis(-step, toolbar);
            });
            downBtn.setAttribute('data-listeners-attached', 'true');
        }
        if (toggleBtn && !toggleBtn.hasAttribute('data-listeners-attached')) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.switchEmphasisMode(toolbar);
            });
            toggleBtn.setAttribute('data-listeners-attached', 'true');
        }
        if (applyBtn && !applyBtn.hasAttribute('data-listeners-attached')) {
            applyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.applyEmphasisEditing) {
                    window.applyEmphasisEditing();
                    this.closeEmphasisMode(toolbar);
                }
            });
            applyBtn.setAttribute('data-listeners-attached', 'true');
        }
        if (cancelBtn && !cancelBtn.hasAttribute('data-listeners-attached')) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.cancelEmphasisEditing) {
                    window.cancelEmphasisEditing();
                    this.closeEmphasisMode(toolbar);
                }
            });
            cancelBtn.setAttribute('data-listeners-attached', 'true');
        }

        const valueEl = emphasisElements.querySelector('.emphasis-value');
        if (valueEl && !valueEl.hasAttribute('data-wheel-attached')) {
            valueEl.addEventListener('wheel', (e) => {
                if (!toolbar.classList.contains('emphasis-mode')) return;
                e.preventDefault();
                const step = getEmphasisAdjustStep(e.shiftKey);
                const delta = e.deltaY > 0 ? -step : step;
                if (window.adjustEmphasisEditing) {
                    window.adjustEmphasisEditing(delta);
                    this.updateEmphasisDisplay(toolbar);
                }
            }, { passive: false });
            valueEl.setAttribute('data-wheel-attached', 'true');
        }

        // Add keyboard event listener for emphasis mode
        this.addEmphasisKeyboardListener(toolbar);
        
        // Update emphasis display
        this.updateEmphasisDisplay(toolbar);
    }

    adjustEmphasis(delta, toolbar) {
        if (window.adjustEmphasisEditing) {
            window.adjustEmphasisEditing(delta);
            this.updateEmphasisDisplay(toolbar);
        }
    }

    switchEmphasisMode(toolbar) {
        if (window.switchEmphasisMode) {
            window.switchEmphasisMode('toggle');
            this.updateEmphasisDisplay(toolbar);
        }
    }

    clearDirectEmphasisPending(toolbar) {
        if (toolbar.directEmphasisApplyTimeout) {
            clearTimeout(toolbar.directEmphasisApplyTimeout);
            toolbar.directEmphasisApplyTimeout = null;
        }
        toolbar.directEmphasisPending = null;
        this.hideDirectEmphasisPreview(toolbar);
    }

    ensureDirectEmphasisPreviewElements(toolbar) {
        let preview = toolbar.querySelector('.toolbar-direct-emphasis-elements');
        if (preview) return preview;

        const toolbarLeft = toolbar.querySelector('.toolbar-left');
        const parent = toolbarLeft || toolbar;
        preview = document.createElement('div');
        preview.className = 'toolbar-direct-emphasis-elements';
        preview.innerHTML = `
            <div class="emphasis-toolbar">
                <div class="emphasis-type mode-normal">New Group</div>
                <div class="emphasis-value direct-emphasis-preview-value" title="Applies shortly">1.0</div>
            </div>
        `;
        parent.appendChild(preview);
        return preview;
    }

    resolveDirectEmphasisPreviewWeight(pending, textarea) {
        let numericValue = this.buildDirectEmphasisWeightFromDigits(pending.digits);
        if (numericValue === null) return null;
        if (pending.isAlt) {
            numericValue = -numericValue;
        }
        if (!textarea) return numericValue;
        const currentMode = this.detectEmphasisMode(textarea, textarea.selectionStart, textarea.selectionEnd);
        if (currentMode === 'brace') {
            numericValue = snapWeightForBraceMode(numericValue);
        }
        return numericValue;
    }

    showDirectEmphasisPreview(toolbar, textarea, pending) {
        const preview = this.ensureDirectEmphasisPreviewElements(toolbar);
        if (!preview) return;

        const numericValue = this.resolveDirectEmphasisPreviewWeight(pending, textarea);
        if (numericValue === null) return;

        const valueEl = preview.querySelector('.direct-emphasis-preview-value');
        const typeEl = preview.querySelector('.emphasis-type');
        if (valueEl) {
            // formatEmphasisWeightDisplay, getEmphasisToolbarColor: public/scripts/comp/emphasisManager.js
            valueEl.textContent = formatEmphasisWeightDisplay(numericValue);
            valueEl.style.color = getEmphasisToolbarColor(numericValue);
        }
        if (typeEl && textarea) {
            const mode = this.detectEmphasisMode(textarea, textarea.selectionStart, textarea.selectionEnd);
            let typeText = 'New Group';
            let modeClass = 'mode-normal';
            switch (mode) {
                case 'brace':
                    typeText = 'Brace Block';
                    modeClass = 'mode-brace';
                    break;
                case 'group':
                    typeText = 'Modify Group';
                    modeClass = 'mode-group';
                    break;
            }
            typeEl.textContent = typeText;
            typeEl.className = `emphasis-type ${modeClass}`;
        }

        toolbar.classList.add('direct-emphasis-preview');
    }

    hideDirectEmphasisPreview(toolbar) {
        if (!toolbar) return;
        toolbar.classList.remove('direct-emphasis-preview');
    }

    buildDirectEmphasisWeightFromDigits(digits) {
        if (!digits || !digits.length) return null;
        if (digits.length === 1) {
            return parseInt(digits, 10);
        }
        return parseFloat(digits.charAt(0) + '.' + digits.slice(1));
    }

    queueDirectEmphasisDigit(toolbar, textarea, digit, isAltPressed) {
        const now = Date.now();
        const selKey = `${textarea.selectionStart}:${textarea.selectionEnd}`;
        let pending = toolbar.directEmphasisPending;

        if (!pending || pending.textarea !== textarea || pending.selKey !== selKey || now - pending.time > 500) {
            pending = { textarea, selKey, digits: '', isAlt: isAltPressed, time: now };
            toolbar.directEmphasisPending = pending;
        }

        pending.digits += String(digit);
        pending.time = now;
        pending.isAlt = isAltPressed;

        this.showDirectEmphasisPreview(toolbar, textarea, pending);

        if (toolbar.directEmphasisApplyTimeout) {
            clearTimeout(toolbar.directEmphasisApplyTimeout);
        }

        toolbar.directEmphasisApplyTimeout = setTimeout(() => {
            const activePending = toolbar.directEmphasisPending;
            toolbar.directEmphasisPending = null;
            toolbar.directEmphasisApplyTimeout = null;
            this.hideDirectEmphasisPreview(toolbar);
            if (!activePending) return;

            let numericValue = this.buildDirectEmphasisWeightFromDigits(activePending.digits);
            if (numericValue === null) return;
            if (activePending.isAlt) {
                numericValue = -numericValue;
            }

            const ta = activePending.textarea;
            const currentMode = this.detectEmphasisMode(ta, ta.selectionStart, ta.selectionEnd);
            if (currentMode === 'brace') {
                numericValue = snapWeightForBraceMode(numericValue);
            }

            const result = applyEmphasisDirectly(ta, numericValue, currentMode);
            if (result && result.success) {
                window.emphasisEditingValue = numericValue;
                this.updateEmphasisDisplay(toolbar);
                ta.setSelectionRange(result.start, result.end);
            }
        }, 500);
    }

    updateEmphasisDisplay(toolbar) {
        const valueElement = toolbar.querySelector('.emphasis-value');
        const typeElement = toolbar.querySelector('.emphasis-type');
        const toggleBtn = toolbar.querySelector('[data-action="emphasis-toggle"]');

        // Get current emphasis state from global variables
        if (window.emphasisEditingValue !== undefined) {
            const emphasisValue = window.emphasisEditingValue;
            
            if (valueElement) {
                // Handle special "---" value
                if (emphasisValue === "---") {
                    valueElement.textContent = "---";
                    valueElement.style.color = getEmphasisToolbarColor('---');
                } else {
                    const displayValue = typeof emphasisValue === 'string' ? parseFloat(emphasisValue) : emphasisValue;
                    // formatEmphasisWeightDisplay: public/scripts/comp/emphasisManager.js
                    valueElement.textContent = formatEmphasisWeightDisplay(displayValue);
                    // getEmphasisToolbarColor: public/scripts/comp/emphasisManager.js
                    valueElement.style.color = getEmphasisToolbarColor(displayValue);
                }
            }
        }

        if (window.emphasisEditingMode !== undefined) {
            const emphasisMode = window.emphasisEditingMode;
            
            if (typeElement) {
                let typeText = '';
                let modeClass = '';
                switch (emphasisMode) {
                    case 'normal':
                        typeText = 'New Group';
                        modeClass = 'mode-normal';
                        break;
                    case 'brace':
                        typeText = 'Brace Block';
                        modeClass = 'mode-brace';
                        break;
                    case 'group':
                        typeText = 'Modify Group';
                        modeClass = 'mode-group';
                        break;
                }
                typeElement.textContent = typeText;
                typeElement.className = `emphasis-type ${modeClass}`;
            }
        }



        // Update toggle button visibility
        if (toggleBtn) {
            if (window.emphasisEditingMode === 'group') {
                toggleBtn.classList.remove('hidden');
                toggleBtn.innerHTML = '<i class="fas fa-brackets-curly"></i>';
                toggleBtn.title = 'Switch to Brace Block';
            } else if (window.emphasisEditingMode === 'brace') {
                toggleBtn.classList.remove('hidden');
                toggleBtn.innerHTML = '<i class="fas fa-colon"></i>';
                toggleBtn.title = 'Switch to Group';
            } else {
                toggleBtn.classList.add('hidden');
            }
        }
    }

    addEmphasisKeyboardListener(toolbar) {
        const container = toolbar.parentElement;
        if (!container) return;

        if (toolbar.emphasisKeydownHandler && toolbar.emphasisKeydownContainer) {
            toolbar.emphasisKeydownContainer.removeEventListener('keydown', toolbar.emphasisKeydownHandler);
            delete toolbar.emphasisKeydownHandler;
            toolbar.emphasisKeydownContainer = null;
        }

        const keydownHandler = (e) => {
            // Only handle keys when in emphasis mode
            if (!toolbar.classList.contains('emphasis-mode')) {
                return;
            }

            const t = e.target;
            if (!t || !t.matches('textarea.prompt-textarea, textarea.character-prompt-textarea')) {
                return;
            }
            if (!container.contains(t)) {
                return;
            }

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.adjustEmphasis(getEmphasisAdjustStep(e.shiftKey), toolbar);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.adjustEmphasis(-getEmphasisAdjustStep(e.shiftKey), toolbar);
                    break;
                case '0':
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                case '6':
                case '7':
                case '8':
                case '9':
                    e.preventDefault();
                    const integerValue = parseInt(e.key);
                    if (window.emphasisEditingValue !== undefined) {
                        window.emphasisEditingValue = clampEmphasisWeight(integerValue);
                        this.updateEmphasisDisplay(toolbar);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (window.switchEmphasisMode) {
                        window.switchEmphasisMode('left');
                        this.updateEmphasisDisplay(toolbar);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (window.switchEmphasisMode) {
                        window.switchEmphasisMode('right');
                        this.updateEmphasisDisplay(toolbar);
                    }
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (window.applyEmphasisEditing) {
                        window.applyEmphasisEditing();
                        this.closeEmphasisMode(toolbar);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    if (window.cancelEmphasisEditing) {
                        window.cancelEmphasisEditing();
                        this.closeEmphasisMode(toolbar);
                    }
                    break;
            }
        };

        toolbar.emphasisKeydownHandler = keydownHandler;
        toolbar.emphasisKeydownContainer = container;
        container.addEventListener('keydown', keydownHandler);
    }

    addDirectEmphasisKeyboardListener(toolbar) {
        const container = toolbar.parentElement;
        if (!container) return;

        const resolveTargetTextarea = (eventTarget) => {
            const t = eventTarget;
            if (!t || !t.matches('textarea.prompt-textarea, textarea.character-prompt-textarea')) {
                return null;
            }
            return container.contains(t) ? t : null;
        };

        // Delegated: UC tab has two stacked fields sharing one toolbar — listeners must run for whichever textarea is focused.
        const directEmphasisHandler = (e) => {
            const textarea = resolveTargetTextarea(e.target);
            if (!textarea) return;

            // Handle ALT + S for splitting emphasis blocks
            if (e.altKey && e.key === 's') {
                e.preventDefault();

                const emphasisInfo = isCursorInsideEmphasisBlock(textarea);
                if (emphasisInfo) {
                    const success = splitEmphasisBlock(textarea);
                    if (success) {
                        if (window.updateEmphasisHighlighting) {
                            window.updateEmphasisHighlighting(textarea);
                        }
                        return;
                    }
                }
                return;
            }

            // Wrap selection with {} or [] (same path as digit → applyEmphasisDirectly; weights match one brace level)
            if ((e.key === '{' || e.key === '[') && !e.altKey && !e.ctrlKey && !e.metaKey) {
                if (!toolbar.classList.contains('emphasis-mode') && document.activeElement === textarea) {
                    if (textarea.selectionStart !== textarea.selectionEnd) {
                        this.clearDirectEmphasisPending(toolbar);
                        const weight = e.key === '{' ? 1.1 : 0.9;
                        const result = applyEmphasisDirectly(textarea, weight, 'brace');
                        if (result && result.success) {
                            window.emphasisEditingValue = weight;
                            this.updateEmphasisDisplay(toolbar);
                            setTimeout(() => {
                                if (result.start !== undefined && result.end !== undefined) {
                                    textarea.setSelectionRange(result.start, result.end);
                                }
                            }, 10);
                            e.preventDefault();
                        }
                    }
                }
                return;
            }

            // Early return for non-numeric keys to improve efficiency
            if (e.key < '0' || e.key > '9' || (e.altKey && (e.key === '™' || e.key === '¡'))) {
                return;
            }

            // Only handle when NOT in emphasis mode and textarea is focused
            if (toolbar.classList.contains('emphasis-mode') || document.activeElement !== textarea) {
                return;
            }

            // Check if there's selected text and apply emphasis directly
            if (textarea.selectionStart !== textarea.selectionEnd) {
                const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();
                if (/^-?\d+(\.\d+)?$/.test(selectedText)) {
                    return;
                }
                e.preventDefault();
                const isAltPressed = e.altKey;
                const digit = (e.key === '™') ? 1 : (e.key === '¡') ? 2 : parseInt(e.key, 10);
                this.queueDirectEmphasisDigit(toolbar, textarea, digit, isAltPressed);
                return;
            }
            // If no text selected, don't prevent default - allow normal typing
        };
        
        toolbar.directEmphasisKeydownHandler = directEmphasisHandler;
        toolbar.directEmphasisDelegatedContainer = container;
        container.addEventListener('keydown', directEmphasisHandler);

        // Android virtual keyboard often does not fire keydown for number keys; it fires beforeinput.
        const directEmphasisBeforeinputHandler = (e) => {
            const textarea = resolveTargetTextarea(e.target);
            if (!textarea) return;
            // isTextInputComposing: public/scripts/comp/textareaUtils.js
            if (typeof isTextInputComposing === 'function' && isTextInputComposing(textarea, e)) return;
            if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
            const char = e.data;
            const isDigit = char >= '0' && char <= '9';
            const isBraceWrap = char === '{' || char === '[';
            if (!isDigit && !isBraceWrap) return;
            if (toolbar.classList.contains('emphasis-mode') || document.activeElement !== textarea) return;
            if (textarea.selectionStart === textarea.selectionEnd) return;

            if (isBraceWrap) {
                this.clearDirectEmphasisPending(toolbar);
                const weight = char === '{' ? 1.1 : 0.9;
                const result = applyEmphasisDirectly(textarea, weight, 'brace');
                if (result && result.success) {
                    e.preventDefault();
                    window.emphasisEditingValue = weight;
                    this.updateEmphasisDisplay(toolbar);
                    setTimeout(() => {
                        if (result.start !== undefined && result.end !== undefined) {
                            textarea.setSelectionRange(result.start, result.end);
                        }
                    }, 10);
                }
                return;
            }

            e.preventDefault();
            this.queueDirectEmphasisDigit(toolbar, textarea, parseInt(char, 10), false);
        };
        toolbar.directEmphasisBeforeinputHandler = directEmphasisBeforeinputHandler;
        container.addEventListener('beforeinput', directEmphasisBeforeinputHandler);
    }
    
    detectEmphasisMode(textarea, selectionStart, selectionEnd) {
        const value = textarea.value;
        
        // Find the current tag boundaries (separated by commas)
        const beforeSelection = value.substring(0, selectionStart);
        const afterSelection = value.substring(selectionEnd);
        
        // Find the start of the current tag (look backwards for comma or start of line)
        let tagStart = selectionStart;
        while (tagStart > 0) {
            const char = value[tagStart - 1];
            if (char === ',') {
                break;
            }
            tagStart--;
        }
        
        // Find the end of the current tag (look forwards for comma or end of line)
        let tagEnd = selectionEnd;
        while (tagEnd < value.length) {
            const char = value[tagEnd];
            if (char === ',') {
                break;
            }
            tagEnd++;
        }
        
        // Extract the current tag content
        const currentTag = value.substring(tagStart, tagEnd).trim();
        
        // Check if the current tag already has emphasis or braces
        const hasExistingEmphasis = /(-?\d+\.\d+)::/.test(currentTag);
        const hasExistingBraces = /\{|\[|\}|\]/.test(currentTag);
        
        if (hasExistingEmphasis) {
            return 'normal';
        }
        
        if (hasExistingBraces) {
            return 'brace';
        }
        
        // Check if we're inside an existing emphasis block (but only within the current tag)
        // First check for auto-terminating emphasis blocks: number::text (without closing ::)
        const autoTerminatingPattern = /(-?\d+\.\d+)::([^:]+?)(?=\s*-?\d+\.?\d*::|::|$)/g;
        let emphasisMatch;
        
        while ((emphasisMatch = autoTerminatingPattern.exec(value)) !== null) {
            const emphasisStart = emphasisMatch.index;
            const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
            
            // Only check if emphasis block is within our current tag
            if (emphasisStart >= tagStart && emphasisEnd <= tagEnd) {
                // Check if our selection overlaps with this emphasis block
                if (selectionStart < emphasisEnd && selectionEnd > emphasisStart) {
                    return 'normal';
                }
            }
        }
        
        // Then check for traditional emphasis blocks: number::text::
        const traditionalEmphasisPattern = /(-?\d+\.\d+)::([^:]+)::/g;
        
        while ((emphasisMatch = traditionalEmphasisPattern.exec(value)) !== null) {
            const emphasisStart = emphasisMatch.index;
            const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
            
            // Only check if emphasis block is within our current tag
            if (emphasisStart >= tagStart && emphasisEnd <= tagEnd) {
                // Check if our selection overlaps with this emphasis block
                if (selectionStart < emphasisEnd && selectionEnd > emphasisStart) {
                    return 'normal';
                }
            }
        }
        
        // Check if we're inside brace blocks (but only within the current tag)
        const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
        let braceMatch;
        
        while ((braceMatch = bracePattern.exec(value)) !== null) {
            const braceStart = braceMatch.index;
            const braceEnd = braceMatch.index + braceMatch[0].length;
            
            // Only check if brace block is within our current tag
            if (braceStart >= tagStart && braceEnd <= tagEnd) {
                // Check if our selection overlaps with this brace block
                if (selectionStart < braceEnd && selectionEnd > braceStart) {
                    return 'brace';
                }
            }
        }
        
        // Default to normal mode - only use brace mode if explicitly needed
        return 'normal';
    }

    closeEmphasisMode(toolbar) {
        // Remove emphasis mode class
        toolbar.classList.remove('emphasis-mode');
        
        if (toolbar.emphasisKeydownHandler && toolbar.emphasisKeydownContainer) {
            toolbar.emphasisKeydownContainer.removeEventListener('keydown', toolbar.emphasisKeydownHandler);
            delete toolbar.emphasisKeydownHandler;
            toolbar.emphasisKeydownContainer = null;
        }
        
        // Refresh emphasis highlighting on the textarea
        const textarea = this.getTextareaFromToolbar(toolbar);
        if (textarea && window.updateEmphasisHighlighting) {
            window.updateEmphasisHighlighting(textarea);
        }
    }

    toggleAutofill(toolbar) {
        const isEnabled = window.toggleAutofill ? window.toggleAutofill() : true;
        const allToolbars = document.querySelectorAll('.prompt-textarea-toolbar');
        allToolbars.forEach((toolbarElement, index) => {
            const autofillBtn = toolbarElement.querySelector('[data-action="autofill"]');
            if (autofillBtn) {
                autofillBtn.setAttribute('data-state', isEnabled ? 'on' : 'off');
                // Update icon to show state
                const icon = autofillBtn.querySelector('i');
                if (icon) {
                    icon.className = isEnabled ? 'fas fa-lightbulb' : 'fas fa-lightbulb-slash';
                }
            } else {
                console.warn(`No autofill button found in toolbar ${index}`);
            }
        });
    }

    toggleKeepNewlines() {
        window.keepPromptNewlines = !window.keepPromptNewlines;
        this.syncKeepNewlinesButtons();
    }

    syncKeepNewlinesButtons() {
        document.querySelectorAll('.custom-dropdown-option[data-value="keep-newlines"]').forEach((option) => {
            option.classList.toggle('selected', !!window.keepPromptNewlines);
        });
    }
}

// Initialize the toolbar manager when the DOM is ready
window.wsClient.registerInitStep(37, 'Initializing Prompt Toolbar', async () => {
    window.keepPromptNewlines = false;
    window.promptTextareaToolbar = new PromptTextareaToolbar();
    window.promptTextareaToolbar.syncKeepNewlinesButtons();
    
    // Expose reset method globally for other components to use
    window.resetInlineSearch = () => {
        if (window.promptTextareaToolbar)
            window.promptTextareaToolbar.resetAllSearchStates();
    };
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PromptTextareaToolbar;
} 