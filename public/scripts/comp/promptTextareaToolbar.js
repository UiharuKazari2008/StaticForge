// Prompt Textarea Toolbar Manager
// Handles the toolbar that appears at the bottom of prompt textareas when active

// Studio prompt-option globals (defaults). Declared here so utilities.js / dropdowns
// can read them during earlier init steps before registerInitStep(37) runs.
var keepPromptNewlines = false;
var autoCharNumerize = true;
var autoFormatOnBlur = true;
var promptNormalize = true;
var deduplicateTags = true;
var promptTextareaToolbar = null;
var resetInlineSearch = null;

class PromptTextareaToolbar {
    constructor() {
        this.activeTextarea = null;
        /** @type {WeakMap<Element, HTMLTextAreaElement>} last focused field per shared toolbar container */
        this._lastTextareaByContainer = new WeakMap();
        this.tokenCounters = new Map();
        this.searchStates = new Map(); // Map of toolbar -> search state
        this.originalCharacterStates = new Map(); // Track original collapse states
        this._fieldTokenCache = new WeakMap();
        this._groupTotals = { editablePrompt: 0, editableUc: 0, nePrompt: 0, neUc: 0 };
        this._groupTotalsReady = false;
        this._tokenizerReadyRecountPending = false;
        this._bottomSummaryRaf = null;
        this._pendingBottomSummary = null;
        this.init();
    }

    init() {
        if (this._toolbarInitialized) {
            return;
        }
        this._toolbarInitialized = true;

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
        if (container) {
            this._lastTextareaByContainer.set(container, textarea);
        }

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

            if (!this.isStandardTextPromptTextarea(textarea)) {
                this.ensureEmphasisGroupChip(toolbar);
                this.wireEmphasisGroupChipUpdates(textarea, toolbar);
                this.updateEmphasisGroupChip(textarea, toolbar);
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

        // UC tab stacks manualUc + manualPromptNegative (and char UC + promptNegative);
        // querySelector would always return the first — prefer active, then last focused.
        if (this.activeTextarea && container.contains(this.activeTextarea)) {
            return this.activeTextarea;
        }
        const last = this._lastTextareaByContainer.get(container);
        if (last && container.contains(last)) {
            return last;
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

    /** Same strip pipeline for full recount and incremental (managed delimiters must not inflate bars). */
    stripTextForTokenCount(text) {
        let stripped = stripPromptBlocksForEffectivePrompt(text || '', {
            stageIndex: 0,
            pipelineStageGeneration: false
        });
        // stripManagedEmphasisDelimitersForCounting: public/scripts/comp/emphasisGroupIdCodec.js
        stripped = stripManagedEmphasisDelimitersForCounting(stripped);
        return stripped;
    }

    refreshGroupToolbarTotals(isUc) {
        const { promptTextareas, ucTextareas } = this.collectEditorTokenTextareas();
        const list = isUc ? ucTextareas : promptTextareas;
        const ne = isUc ? this._groupTotals.neUc : this._groupTotals.nePrompt;
        const editableGroup = Math.max(0, isUc ? this._groupTotals.editableUc : this._groupTotals.editablePrompt);
        const groupTotal = editableGroup + Math.max(0, ne);
        const maxTokens = getPromptTokenLimit();

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
        const tokenizer = getPromptTokenizer();
        if (!tokenizer || !changedTextarea) return;
        if (!this._fieldTokenCache.has(changedTextarea)) {
            this.updateAllTokenCounts();
            return;
        }

        const isUc = this.isUcTextarea(changedTextarea);
        const stripped = this.stripTextForTokenCount(changedTextarea.value || '');
        const newCount = tokenizer.countTokens(stripped);
        const prev = this._fieldTokenCache.get(changedTextarea) || { count: 0, expanderNe: 0 };
        const countDelta = newCount - prev.count;

        if (isUc) {
            this._groupTotals.editableUc = Math.max(0, this._groupTotals.editableUc + countDelta);
        } else {
            this._groupTotals.editablePrompt = Math.max(0, this._groupTotals.editablePrompt + countDelta);
        }

        prev.count = newCount;
        this._fieldTokenCache.set(changedTextarea, prev);

        const ne = isUc ? this._groupTotals.neUc : this._groupTotals.nePrompt;
        const editableGroup = isUc ? this._groupTotals.editableUc : this._groupTotals.editablePrompt;
        const groupTotal = editableGroup + ne;

        const maxTokens = getPromptTokenLimit();
        this.updateToolbarDisplay(changedTextarea, newCount, ne, groupTotal, maxTokens);
        this.scheduleBottomSummaryUpdate(
            this._groupTotals.editablePrompt,
            this._groupTotals.editableUc,
            this._groupTotals.nePrompt,
            this._groupTotals.neUc,
            maxTokens
        );
    }

    updateAllTokenCounts() {
        const tokenizer = getPromptTokenizer();
        if (!tokenizer) {
            if (this._tokenizerReadyRecountPending) return;
            this._tokenizerReadyRecountPending = true;
            // ensurePromptTokenizerForModel: public/scripts/comp/utilities.js
            ensurePromptTokenizerForModel().then(() => {
                this._tokenizerReadyRecountPending = false;
                if (getPromptTokenizer()) {
                    this.updateAllTokenCounts();
                }
            }).catch((error) => {
                this._tokenizerReadyRecountPending = false;
                console.error('Failed to load prompt tokenizer:', error);
            });
            return;
        }

        const { promptTextareas, ucTextareas } = this.collectEditorTokenTextareas();

        // Must match stripTextForTokenCount / incremental — otherwise blur recount inflates the bar
        // with managed delimiter glyphs while focused edits use stripped counts.
        const promptTexts = promptTextareas.map((ta) => this.stripTextForTokenCount(ta.value || ''));
        const ucTexts = ucTextareas.map((ta) => this.stripTextForTokenCount(ta.value || ''));

        const promptAnalysis = tokenizer.analyzeTexts(promptTexts);
        const ucAnalysis = tokenizer.analyzeTexts(ucTexts);

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

        const maxTokens = getPromptTokenLimit();

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

        // updateManualTokenFreeDisplay: public/scripts/comp/utilities.js
        if (typeof updateManualTokenFreeDisplay === 'function') {
            updateManualTokenFreeDisplay(this._groupTotals);
        }
    }

    // Textareas outside the manual editor (bracket gen, expanders, etc.) — per-field counts only
    updateStandaloneTextareaTokenCounts(editorTextareas, maxTokens = null) {
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
        if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
            progressFill.style.width = '0';
            return;
        }

        const safeGroup = Math.max(0, Number(groupTotal) || 0);
        const safeEditable = Math.max(0, Number(editableTokens) || 0);
        const safeNe = Math.max(0, Number(nonEditableTokens) || 0);
        const cap = Math.max(1, Number(maxTokens));

        const groupPercentage = safeGroup > 0 ? Math.min((safeGroup / cap) * 100, 100) : 0;
        progressFill.style.width = `${groupPercentage}%`;

        // Inner segments are shares of the fill — never let them sum past 100% (overflows the track).
        let editablePct = safeGroup > 0 ? (safeEditable / safeGroup) * 100 : 0;
        let nePct = safeGroup > 0 ? (safeNe / safeGroup) * 100 : 0;
        const innerSum = editablePct + nePct;
        if (innerSum > 100) {
            editablePct = (editablePct / innerSum) * 100;
            nePct = (nePct / innerSum) * 100;
        }

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
        const cleanedText = this.stripTextForTokenCount(text);
        const tokenizer = getPromptTokenizer();
        if (tokenizer) {
            return tokenizer.countTokens(cleanedText);
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
            { value: 'emphasis', display: 'Edit Emphasis', icon: 'fas fa-dial' },
            { value: 'emphasis-groups-tool', display: 'Weight Rack', icon: 'fas fa-weight-scale' },
            { value: 'trim-emphasis-start', display: 'Trim Start', icon: 'fas fa-bracket-square' },
            { value: 'trim-emphasis-end', display: 'Trim End', icon: 'fas fa-bracket-square-right' },
            { value: 'clear-emphasis', display: 'Reset Emphasis', icon: 'fas fa-eraser' },
            { value: 'reindex-group-ids', display: 'Reset Group IDs', icon: 'fas fa-list-ol' },
            { value: 'split-emphasis', display: 'Split Emphasis', icon: 'fas fa-scissors', toolbarWide: true },
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
            case 'emphasis-group-chip':
                this.openEmphasisMode(textarea, toolbar);
                break;
            case 'emphasis-groups-tool':
                if (emphasisGroupsToolManager) {
                    emphasisGroupsToolManager.openForTextarea(textarea);
                }
                break;
            case 'trim-emphasis-start':
                // trimManagedEmphasisStartAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                trimManagedEmphasisStartAtCaret(textarea);
                this.updateEmphasisGroupChip(textarea, toolbar);
                break;
            case 'trim-emphasis-end':
                // trimManagedEmphasisEndAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                trimManagedEmphasisEndAtCaret(textarea);
                this.updateEmphasisGroupChip(textarea, toolbar);
                break;
            case 'clear-emphasis':
                if (removeAllEmphasisFromSelection) {
                    removeAllEmphasisFromSelection(textarea);
                    if (window.updateEmphasisHighlighting) {
                        window.updateEmphasisHighlighting(textarea);
                    }
                }
                break;
            case 'reindex-group-ids':
                this.reindexEmphasisGroupIds(textarea, toolbar);
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
                    openDsapInGrimoire('dsap://memories.dyna.dreamscape.jp/rules');
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
                // openBracketGenerationApplet: public/scripts/comp/featureLoader.js
                void openBracketGenerationApplet();
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
        // public/scripts/comp/featureLoader.js
        void featureLoader.loadFeature('dataset_tag_toolbar').then(() => showDatasetTagToolbar());
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

        // Close the autofill window if open so it doesn't overlap the search bar
        // dismissAutocompleteForTextareaNavigation: public/scripts/comp/autocompleteUtils.js
        dismissAutocompleteForTextareaNavigation();

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
            highlightOverlay: null,
            highlightedTextareas: new Set(),
            searchRevision: 0,
            performSearchTimer: null,
            highlightRaf: null
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
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeSearch(toolbar);
                    return;
                }
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
                    this.schedulePerformSearch(toolbar);
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

    cancelPendingSearchWork(searchState) {
        if (!searchState) return;
        if (searchState.performSearchTimer) {
            clearTimeout(searchState.performSearchTimer);
            searchState.performSearchTimer = null;
        }
        if (searchState.highlightRaf) {
            cancelAnimationFrame(searchState.highlightRaf);
            searchState.highlightRaf = null;
        }
    }

    /** Release Map entry + timers when a toolbar is about to be removed from the DOM. */
    disposeToolbar(toolbar) {
        if (!toolbar || !this.searchStates.has(toolbar)) return;
        this.closeSearch(toolbar);
    }

    /** Defer scan/highlight so search input can paint before heavy work. */
    schedulePerformSearch(toolbar) {
        const searchState = this.searchStates.get(toolbar);
        if (!searchState) return;

        searchState.searchRevision = (searchState.searchRevision || 0) + 1;
        const revision = searchState.searchRevision;

        if (searchState.performSearchTimer) {
            clearTimeout(searchState.performSearchTimer);
        }

        searchState.performSearchTimer = setTimeout(() => {
            searchState.performSearchTimer = null;
            requestAnimationFrame(() => {
                if (!this.searchStates.has(toolbar)) return;
                const state = this.searchStates.get(toolbar);
                if (!state || state.searchRevision !== revision) return;
                this.performSearch(toolbar);
            });
        }, 32);
    }

    scheduleSearchHighlightRefresh(toolbar, scrollToMatch = true) {
        const searchState = this.searchStates.get(toolbar);
        if (!searchState) return;

        if (searchState.highlightRaf) return;

        searchState.highlightRaf = requestAnimationFrame(() => {
            searchState.highlightRaf = null;
            if (!this.searchStates.has(toolbar)) return;
            this.updateSearchResults(toolbar);
            this.highlightAllSearchResults();
            if (scrollToMatch) {
                this.scrollToHighlightedResult(toolbar);
            }
        });
    }

    findSearchMatchesInText(text, searchQuery) {
        const matches = [];
        if (!searchQuery) return matches;

        const lowerText = text.toLowerCase();
        let index = 0;
        while ((index = lowerText.indexOf(searchQuery, index)) !== -1) {
            matches.push({
                start: index,
                end: index + searchQuery.length,
                text: text.substring(index, index + searchQuery.length)
            });
            index += 1;
        }
        return matches;
    }

    getSearchTargetTextareas(activeTextarea, isSingleFieldPromptSearch) {
        if (isSingleFieldPromptSearch) {
            return activeTextarea ? [activeTextarea] : [];
        }

        const textareas = [];
        document.querySelectorAll('.prompt-textarea, .character-prompt-textarea').forEach((textarea) => {
            if (this.shouldIncludeTextareaInSearch(textarea)) {
                textareas.push(textarea);
            }
        });
        return textareas;
    }

    clearSearchHighlightsForTextarea(textarea) {
        if (!textarea) return;
        // getPromptTextareaOverlayHost: public/scripts/comp/emphasisParse.js
        const host = getPromptTextareaOverlayHost(textarea);
        const highlightOverlay = host && host.querySelector(':scope > .search-highlight-overlay');
        if (highlightOverlay) {
            highlightOverlay.textContent = '';
        }
    }

    clearTrackedSearchHighlights(searchState) {
        if (!searchState || !searchState.highlightedTextareas || searchState.highlightedTextareas.size === 0) {
            this.clearAllSearchHighlights();
            if (searchState) {
                searchState.highlightedTextareas = new Set();
            }
            return;
        }
        searchState.highlightedTextareas.forEach((textarea) => {
            this.clearSearchHighlightsForTextarea(textarea);
        });
        searchState.highlightedTextareas = new Set();
    }

    buildSearchHighlightHtml(text, textareaResults, selectedIndex, allResults) {
        let highlightedText = '';
        let currentPos = 0;
        const sortedResults = [...textareaResults].sort((a, b) => a.start - b.start);

        for (const textareaResult of sortedResults) {
            highlightedText += escapeHtml(text.substring(currentPos, textareaResult.start));
            const originalIndex = allResults.indexOf(textareaResult);
            const isResultSelected = originalIndex === selectedIndex;
            const highlightClass = isResultSelected ? 'search-highlight-selected' : 'search-highlight';
            const matchText = escapeHtml(text.substring(textareaResult.start, textareaResult.end));
            highlightedText += `<span class="${highlightClass}">${matchText}</span>`;
            currentPos = textareaResult.end;
        }
        highlightedText += escapeHtml(text.substring(currentPos));
        return highlightedText;
    }

    applySearchHighlightsToTextarea(textarea, textareaResults, selectedIndex, allResults) {
        if (!textareaResults.length) {
            this.clearSearchHighlightsForTextarea(textarea);
            return;
        }

        // ensurePromptSearchHighlightOverlay: public/scripts/comp/emphasisParse.js
        const highlightOverlay = ensurePromptSearchHighlightOverlay(textarea);
        if (!highlightOverlay) return;

        const text = textarea.value;
        highlightOverlay.innerHTML = this.buildSearchHighlightHtml(text, textareaResults, selectedIndex, allResults);
        highlightOverlay.scrollTop = textarea.scrollTop;
        highlightOverlay.scrollLeft = textarea.scrollLeft;
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
            this.clearTrackedSearchHighlights(searchState);
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

        const targetTextareas = this.getSearchTargetTextareas(activeTextarea, isSingleFieldPromptSearch);
        targetTextareas.forEach((textarea, textareaIndex) => {
            const text = textarea.value;
            const matches = this.findSearchMatchesInText(text, searchQuery);
            matches.forEach((match) => {
                allResults.push({
                    textarea: textarea,
                    textareaIndex: textareaIndex,
                    start: match.start,
                    end: match.end,
                    text: match.text
                });
            });
        });

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

        this.scheduleSearchHighlightRefresh(activeToolbar, false);
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

        this.scheduleSearchHighlightRefresh(activeToolbar);
    }

    highlightAllSearchResults() {
        const activeToolbar = this.getActiveSearchToolbar();
        if (!activeToolbar) return;

        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;

        const { results, selectedIndex } = searchState;

        if (results.length === 0) {
            this.clearTrackedSearchHighlights(searchState);
            return;
        }

        const byTextarea = new Map();
        results.forEach((result) => {
            if (!byTextarea.has(result.textarea)) {
                byTextarea.set(result.textarea, []);
            }
            byTextarea.get(result.textarea).push(result);
        });

        const prevHighlighted = searchState.highlightedTextareas || new Set();
        const nextHighlighted = new Set(byTextarea.keys());

        prevHighlighted.forEach((textarea) => {
            if (!nextHighlighted.has(textarea)) {
                this.clearSearchHighlightsForTextarea(textarea);
            }
        });

        byTextarea.forEach((textareaResults, textarea) => {
            this.applySearchHighlightsToTextarea(textarea, textareaResults, selectedIndex, results);
        });

        searchState.highlightedTextareas = nextHighlighted;
    }

    clearAllSearchHighlights() {
        document.querySelectorAll('.prompt-textarea, .character-prompt-textarea').forEach((textarea) => {
            this.clearSearchHighlightsForTextarea(textarea);
        });
        this.searchStates.forEach((searchState) => {
            if (searchState.highlightedTextareas) {
                searchState.highlightedTextareas = new Set();
            }
        });
    }

    resetAllSearchStates() {
        // Clear all search states and close any active search modes
        this.searchStates.forEach((searchState, toolbar) => {
            this.cancelPendingSearchWork(searchState);
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

        this.cancelPendingSearchWork(searchState);

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

    /**
     * Compact chip: icon outside a group; 1dp weight or % inside.
     * Click opens the full direct-emphasis toolbar (openEmphasisMode).
     */
    ensureEmphasisGroupChip(toolbar) {
        if (!toolbar) return null;
        const regular = toolbar.querySelector('.toolbar-regular-buttons') || toolbar;
        let chip = toolbar.querySelector('[data-action="emphasis-group-chip"]');
        if (!chip) {
            // Fallback only if static HTML missing (legacy toolbars)
            const autofillBtn = regular.querySelector('[data-action="autofill"]');
            const actionsDropdown = regular.querySelector('#promptActionsDropdown')
                || Array.from(regular.querySelectorAll('.custom-dropdown')).find((el) =>
                    /ActionsDropdown/i.test(el.id || ''))
                || null;
            chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'btn-secondary btn-small toolbar-btn toggle-btn emphasis-group-chip';
            chip.dataset.action = 'emphasis-group-chip';
            chip.setAttribute('data-state', 'off');
            chip.title = 'Emphasis';
            chip.innerHTML = '<i class="fas fa-dial"></i><span class="emphasis-group-chip-value hidden">1.0</span>';
            if (autofillBtn) {
                autofillBtn.insertAdjacentElement('afterend', chip);
            } else if (actionsDropdown) {
                regular.insertBefore(chip, actionsDropdown);
            } else {
                regular.appendChild(chip);
            }
        }
        chip.classList.add('toggle-btn');
        if (!chip.hasAttribute('data-state')) chip.setAttribute('data-state', 'off');
        this.wireEmphasisGroupChipContextMenu(chip, toolbar);
        return chip;
    }

    wireEmphasisGroupChipContextMenu(chip, toolbar) {
        if (!chip || chip.dataset.emphasisChipMenuWired === '1') return;
        chip.dataset.emphasisChipMenuWired = '1';
        // contextMenu.attachToElement: public/scripts/comp/contextMenu.js
        if (!contextMenu || !contextMenu.attachToElement) return;
        contextMenu.attachToElement(chip, {
            sections: [
                {
                    type: 'icons',
                    icons: [
                        {
                            icon: 'fas fa-dial',
                            tooltip: 'Edit',
                            action: 'emphasis-edit'
                        },
                        {
                            icon: 'fas fa-scissors',
                            tooltip: 'Split around selection',
                            action: 'emphasis-split',
                            loadfn: (icon, target) => {
                                const ta = this.getTextareaFromToolbar(chip);
                                icon.disabled = !(ta && ta.selectionStart !== ta.selectionEnd);
                            }
                        },
                        {
                            icon: 'fas fa-bracket-square',
                            tooltip: 'Trim start',
                            action: 'emphasis-trim-start',
                            loadfn: (icon) => {
                                const ta = this.getTextareaFromToolbar(chip);
                                // canTrimManagedEmphasisStartAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                                icon.disabled = !canTrimManagedEmphasisStartAtCaret(ta);
                            }
                        },
                        {
                            icon: 'fas fa-bracket-square-right',
                            tooltip: 'Trim end',
                            action: 'emphasis-trim-end',
                            loadfn: (icon) => {
                                const ta = this.getTextareaFromToolbar(chip);
                                // canTrimManagedEmphasisEndAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                                icon.disabled = !canTrimManagedEmphasisEndAtCaret(ta);
                            }
                        },
                        {
                            icon: 'fas fa-eraser',
                            tooltip: 'Remove emphasis',
                            action: 'emphasis-remove'
                        },
                        {
                            icon: 'fas fa-weight-scale',
                            tooltip: 'Weight Rack',
                            action: 'emphasis-weight-rack'
                        }
                    ]
                },
                {
                    type: 'list',
                    items: [
                        {
                            text: 'Show Syntax',
                            icon: 'fas fa-eye',
                            action: 'emphasis-show-syntax',
                            title: 'Toggle visible weights globally (all prompt / UC / negative fields)',
                            showIndicator: true,
                            keepMenuOpen: true,
                            loadfn: (item) => {
                                // getGlobalEmphasisSyntaxMode / getEmphasisSyntaxModeForTextarea:
                                //   public/scripts/comp/emphasisGroupIdCodec.js
                                const ta = this.getTextareaFromToolbar(chip);
                                const g = getGlobalEmphasisSyntaxMode();
                                item.checked = g === 'visible'
                                    || (g == null && getEmphasisSyntaxModeForTextarea(ta) === 'visible');
                            }
                        },
                        {
                            text: 'Convert {}/[]',
                            icon: 'fas fa-brackets-curly',
                            action: 'emphasis-convert-braces',
                            title: 'Convert pre-v4 braces/brackets to weight groups in this field',
                            loadfn: (item) => {
                                const ta = this.getTextareaFromToolbar(chip);
                                // countConvertibleBraceEmphasis: public/scripts/comp/emphasisGroupIdCodec.js
                                item.disabled = !ta || countConvertibleBraceEmphasis(ta.value || '') === 0;
                            }
                        },
                        {
                            text: 'Reset Group IDs',
                            icon: 'fas fa-list-ol',
                            action: 'emphasis-reindex-ids',
                            title: 'Regenerate sequential group ids from 0 in this field',
                            loadfn: (item) => {
                                const ta = this.getTextareaFromToolbar(chip);
                                // countEmphasisGroupsForIdReindex: public/scripts/comp/emphasisGroupIdCodec.js
                                item.disabled = !ta || countEmphasisGroupsForIdReindex(ta.value || '') === 0;
                            }
                        },
                        {
                            text: 'Remove All',
                            icon: 'fas fa-trash-alt',
                            action: 'emphasis-clear-all',
                            title: 'Strip all emphasis from this field'
                        }
                    ]
                }
            ],
            onAction: (action) => {
                const textarea = this.getTextareaFromToolbar(chip);
                const tb = toolbar || this.getToolbarFromTextarea(textarea);
                this.handleEmphasisChipContextAction(action, textarea, tb);
            }
        });
    }

    handleEmphasisChipContextAction(action, textarea, toolbar) {
        if (!textarea) return;
        // setGlobalEmphasisSyntaxMode: public/scripts/comp/emphasisGroupIdCodec.js
        if (action === 'emphasis-show-syntax') {
            const ta = textarea;
            const g = getGlobalEmphasisSyntaxMode();
            const currentlyVisible = g === 'visible'
                || (g == null && getEmphasisSyntaxModeForTextarea(ta) === 'visible');
            const next = currentlyVisible ? 'hidden' : 'visible';
            setGlobalEmphasisSyntaxMode(next);
            this.updateEmphasisGroupChip(textarea, toolbar);
            return;
        }
        if (action === 'emphasis-weight-rack') {
            if (emphasisGroupsToolManager && emphasisGroupsToolManager.openForTextarea) {
                emphasisGroupsToolManager.openForTextarea(textarea);
            }
            return;
        }
        if (action === 'emphasis-edit') {
            this.openEmphasisMode(textarea, toolbar);
            return;
        }
        if (action === 'emphasis-remove') {
            this.removeEmphasisAtCaretOrSelection(textarea);
            return;
        }
        if (action === 'emphasis-split') {
            this.splitEmphasisAroundSelection(textarea);
            return;
        }
        if (action === 'emphasis-trim-start') {
            // trimManagedEmphasisStartAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
            trimManagedEmphasisStartAtCaret(textarea);
            this.updateEmphasisGroupChip(textarea, toolbar);
            return;
        }
        if (action === 'emphasis-trim-end') {
            // trimManagedEmphasisEndAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
            trimManagedEmphasisEndAtCaret(textarea);
            this.updateEmphasisGroupChip(textarea, toolbar);
            return;
        }
        if (action === 'emphasis-convert-braces') {
            // convertBraceEmphasisGroupsForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
            const result = convertBraceEmphasisGroupsForTextarea(textarea);
            this.updateEmphasisGroupChip(textarea, toolbar);
            if (result?.imported) {
                // showShortcutActionToast: public/scripts/comp/keyboardShortcuts.js
                showShortcutActionToast(
                    result.imported === 1
                        ? 'Converted 1 brace group'
                        : `Converted ${result.imported} brace groups`
                );
            }
            return;
        }
        if (action === 'emphasis-reindex-ids') {
            this.reindexEmphasisGroupIds(textarea, toolbar);
            return;
        }
        if (action === 'emphasis-clear-all') {
            this.clearAllEmphasisInTextarea(textarea);
        }
    }

    reindexEmphasisGroupIds(textarea, toolbar) {
        if (!textarea) return;
        // reindexManagedEmphasisGroupIdsForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
        const result = reindexManagedEmphasisGroupIdsForTextarea(textarea);
        this.updateEmphasisGroupChip(textarea, toolbar || this.getToolbarFromTextarea(textarea));
        if (!result) return;
        // showShortcutActionToast: public/scripts/comp/keyboardShortcuts.js
        if (result.overflow) {
            showShortcutActionToast('Too many groups to reindex (max 256)');
            return;
        }
        if (result.alreadySequential) {
            showShortcutActionToast('Group IDs already sequential');
            return;
        }
        if (result.remapped) {
            showShortcutActionToast(
                result.remapped === 1
                    ? 'Reset 1 group ID'
                    : `Reset ${result.remapped} group IDs`
            );
            return;
        }
        if (result.imported) {
            showShortcutActionToast(
                result.imported === 1
                    ? 'Imported 1 classic group'
                    : `Imported ${result.imported} classic groups`
            );
        }
    }

    removeEmphasisAtCaretOrSelection(textarea) {
        // startEmphasisEditing + apply with --- : public/scripts/comp/emphasisEditing.js
        startEmphasisEditing(textarea);
        if (!emphasisEditingActive) return;
        emphasisEditingValue = '---';
        applyEmphasisEditing();
        this.updateEmphasisGroupChip(textarea, this.getToolbarFromTextarea(textarea));
    }

    splitEmphasisAroundSelection(textarea) {
        if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;
        const value = textarea.value || '';
        const selStart = textarea.selectionStart;
        const selEnd = textarea.selectionEnd;
        const bag = resolveEmphasisBagForTextarea(textarea) || {};
        const mode = getEmphasisSyntaxModeForTextarea(textarea);
        const managedMode = mode === 'visible' ? 'visible' : 'hidden';

        const block = findManagedEmphasisBlockAtCursor(value, selStart, bag)
            || findManagedEmphasisBlockAtCursor(value, Math.max(selStart, selEnd - 1), bag);
        if (block && selStart >= block.openEnd && selEnd <= block.closeStart) {
            const left = value.slice(block.openEnd, selStart);
            const mid = value.slice(selStart, selEnd);
            const right = value.slice(selEnd, block.closeStart);
            const groupsById = pruneEmphasisGroupsByIdToLiveText(bag.groupsById || {}, value);
            const weight = Number.isFinite(resolveWeightForEmphasisGroupId(block.id, bag))
                ? resolveWeightForEmphasisGroupId(block.id, bag)
                : 1;
            const idLeft = block.id;
            const idMid = allocateNextManagedEmphasisGroupId(groupsById);
            if (idMid < 0) return;
            groupsById[idMid] = weight;
            let idRight = null;
            let parts = '';
            if (left.trim()) {
                groupsById[idLeft] = weight;
                parts += buildManagedEmphasisGroupText(idLeft, left, { mode: managedMode, weight });
            } else {
                delete groupsById[idLeft];
            }
            parts += buildManagedEmphasisGroupText(idMid, mid, { mode: managedMode, weight });
            if (right.trim()) {
                idRight = allocateNextManagedEmphasisGroupId(groupsById);
                if (idRight < 0) return;
                groupsById[idRight] = weight;
                parts += buildManagedEmphasisGroupText(idRight, right, { mode: managedMode, weight });
            }
            const next = value.slice(0, block.start) + parts + value.slice(block.end);
            setTextareaValuePreservingUndo(textarea, next);
            writeManagedEmphasisGroupWeightsForTextarea(textarea, Object.keys(groupsById).map((id) => ({
                id: Number(id),
                weight: groupsById[id]
            })));
            // sync bag fully
            const store = getEmphasisNormalizationFieldStore();
            getEmphasisNormalizationDualWriteKeys(textarea.id).forEach((key) => {
                store[key] = { ...(store[key] || {}), groupsById: { ...groupsById }, syntaxMode: managedMode };
            });
            syncEmphasisNormalizationPreviewMetadata();
            dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
            refreshEmphasisGroupsToolInstancesFromForgeState();
            return;
        }

        // No managed group under selection: wrap selection as a new managed group in current mode
        const selected = value.slice(selStart, selEnd);
        if (!selected.trim()) return;
        const groupsById = pruneEmphasisGroupsByIdToLiveText(bag.groupsById || {}, value);
        const id = allocateNextManagedEmphasisGroupId(groupsById);
        if (id < 0) return;
        const weight = 1;
        groupsById[id] = weight;
        const wrapped = buildManagedEmphasisGroupText(id, selected, { mode: managedMode, weight });
        setTextareaValuePreservingUndo(textarea, value.slice(0, selStart) + wrapped + value.slice(selEnd));
        const store = getEmphasisNormalizationFieldStore();
        getEmphasisNormalizationDualWriteKeys(textarea.id).forEach((key) => {
            store[key] = { ...(store[key] || {}), groupsById: { ...groupsById }, syntaxMode: managedMode };
        });
        syncEmphasisNormalizationPreviewMetadata();
        dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
        refreshEmphasisGroupsToolInstancesFromForgeState();
    }

    clearAllEmphasisInTextarea(textarea) {
        const value = textarea.value || '';
        // stripEmphasisFromText: public/scripts/comp/emphasisSyntaxToggles.js
        const cleaned = stripEmphasisFromText(value);
        if (cleaned !== value) {
            setTextareaValuePreservingUndo(textarea, cleaned);
            dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
        }
        const store = getEmphasisNormalizationFieldStore();
        getEmphasisNormalizationDualWriteKeys(textarea.id).forEach((key) => {
            if (!store[key]) return;
            const next = { ...store[key] };
            delete next.groupsById;
            next.syntaxMode = 'hidden';
            store[key] = next;
        });
        syncEmphasisNormalizationPreviewMetadata();
        refreshEmphasisGroupsToolInstancesFromForgeState();
        this.updateEmphasisGroupChip(textarea, this.getToolbarFromTextarea(textarea));
    }

    wireEmphasisGroupChipUpdates(textarea, toolbar) {
        if (!textarea || textarea.hasAttribute('data-emphasis-group-chip-wired')) return;
        textarea.setAttribute('data-emphasis-group-chip-wired', 'true');
        const refresh = () => {
            if (typeof textarea.selectionStart === 'number') {
                textarea._emphasisLastCaret = textarea.selectionStart;
            }
            if (this.activeTextarea !== textarea) return;
            this.updateEmphasisGroupChip(textarea, toolbar);
        };
        textarea.addEventListener('keyup', refresh);
        textarea.addEventListener('click', refresh);
        textarea.addEventListener('input', refresh);
        textarea.addEventListener('select', refresh);
    }

    isWeightRackOpenForTextarea(textarea) {
        // emphasisGroupsToolManager.getInstanceByTextareaId: public/scripts/comp/emphasisGroupsToolManager.js
        if (!emphasisGroupsToolManager || !textarea?.id) return false;
        return !!emphasisGroupsToolManager.getInstanceByTextareaId(textarea.id);
    }

    formatEmphasisChipWeight(weight) {
        const w = Number.isFinite(weight) ? weight : 1;
        return (Math.round(w * 10) / 10).toFixed(1);
    }

    resolveEmphasisGroupChipState(textarea) {
        if (!textarea) return { inside: false };
        const value = textarea.value || '';
        const pos = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
        // resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
        const bag = resolveEmphasisBagForTextarea(textarea);

        // Managed invisible groups — content range only (openEnd..closeStart).
        // Outer edges / mid-delimiter after leave = outside. No lastCaret fallback.
        // isCaretInManagedEmphasisContent / listManagedEmphasisBlocks: emphasisGroupIdCodec.js
        if (hasManagedEmphasisGroupIds(value)) {
            if (!isCaretInManagedEmphasisContent(value, pos)) {
                return { inside: false };
            }
            const blocks = listManagedEmphasisBlocks(value);
            const block = blocks.find((b) => pos >= b.openEnd && pos <= b.closeStart);
            if (block) {
                const entry = bag?.groupsById?.[block.id] ?? bag?.groupsById?.[String(block.id)];
                let weight = typeof entry === 'number' ? entry : entry?.weight;
                if (!Number.isFinite(weight)) {
                    // resolveWeightForEmphasisGroupId: public/scripts/comp/emphasisGroupIdCodec.js
                    weight = resolveWeightForEmphasisGroupId(block.id, bag);
                }
                const share = (entry && typeof entry === 'object' && Number.isFinite(entry.share))
                    ? entry.share
                    : null;
                if (bag?.enabled && Number.isFinite(share)) {
                    return { inside: true, label: `${Math.round(share)}%`, weight };
                }
                if (!Number.isFinite(weight) && Number.isFinite(block.textWeight)) {
                    weight = block.textWeight;
                }
                if (!Number.isFinite(weight)) weight = 1;
                return { inside: true, label: this.formatEmphasisChipWeight(weight), weight };
            }
            return { inside: false };
        }

        // Classic N::
        // isCursorInsideEmphasisBlock: public/scripts/comp/emphasisParse.js
        const classic = isCursorInsideEmphasisBlock(textarea);
        if (classic) {
            const weight = parseFloat(classic.weight);
            // Content-only: exclude sitting on the trailing "::" close (end of full match)
            // and the "N::" open prefix — treat those as outside for the dial indicator.
            const openLen = String(classic.weight).length + 2;
            const contentStart = classic.start + openLen;
            const contentEnd = classic.isAutoTerminating
                ? classic.end
                : classic.end - 2;
            if (pos < contentStart || pos > contentEnd) {
                return { inside: false };
            }
            if (bag?.enabled && Array.isArray(bag.percentages)) {
                const groups = listAllEmphasisTargets(value).filter((t) => t.type === 'group');
                const idx = groups.findIndex((g) => pos >= g.start && g.end >= pos);
                if (idx >= 0 && Number.isFinite(bag.percentages[idx])) {
                    return {
                        inside: true,
                        label: `${Math.round(bag.percentages[idx])}%`,
                        weight: Number.isFinite(weight) ? weight : 1
                    };
                }
            }
            const w = Number.isFinite(weight) ? weight : 1;
            return { inside: true, label: this.formatEmphasisChipWeight(w), weight: w };
        }

        return { inside: false };
    }

    updateEmphasisGroupChip(textarea, toolbar) {
        if (!toolbar || !textarea) return;
        const chip = this.ensureEmphasisGroupChip(toolbar);
        if (!chip) return;

        // Keep chip visible while Weight Rack is open — Edit Emphasis still needs it.
        const hideChip = toolbar.classList.contains('emphasis-mode')
            || toolbar.classList.contains('search-mode')
            || toolbar.classList.contains('direct-emphasis-preview')
            || this.isStandardTextPromptTextarea(textarea);

        chip.classList.toggle('hidden', hideChip);
        if (hideChip) return;

        const state = this.resolveEmphasisGroupChipState(textarea);
        chip.setAttribute('data-state', state.inside ? 'on' : 'off');
        const icon = chip.querySelector('i');
        const valueEl = chip.querySelector('.emphasis-group-chip-value');
        if (state.inside) {
            if (icon) icon.classList.add('hidden');
            if (valueEl) {
                valueEl.textContent = state.label;
                valueEl.classList.remove('hidden');
            }
            chip.title = `Emphasis ${state.label} — click to edit`;
            chip.classList.add('has-group-value');
        } else {
            if (icon) icon.classList.remove('hidden');
            if (valueEl) valueEl.classList.add('hidden');
            chip.title = 'Emphasis — click to edit';
            chip.classList.remove('has-group-value');
        }
    }

    openEmphasisMode(textarea, toolbar) {
        // Start emphasis editing mode in the toolbar
        if (!window.startEmphasisEditing) {
            return;
        }

        // Blur/format can leave selection at end — restore last in-group caret first.
        if (Number.isFinite(textarea._emphasisLastCaret)
            && textarea.selectionStart === textarea.selectionEnd
            && textarea.selectionStart !== textarea._emphasisLastCaret) {
            const pos = Math.max(0, Math.min(textarea.value.length, textarea._emphasisLastCaret));
            textarea.setSelectionRange(pos, pos);
        }

        // Start emphasis editing
        window.startEmphasisEditing(textarea);
        toolbar.emphasisEditorDigits = '';

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
                        <button type="button" class="btn-secondary emphasis-btn btn-small emphasis-trim-start" data-action="emphasis-trim-start" title="Trim start">
                            <i class="fas fa-bracket-square"></i>
                        </button>
                        <button type="button" class="btn-secondary emphasis-btn btn-small emphasis-trim-end" data-action="emphasis-trim-end" title="Trim end">
                            <i class="fas fa-bracket-square-right"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn btn-small emphasis-suggest hidden" data-action="emphasis-suggest" title="Use suggested value">
                            <i class="fas fa-bullseye-arrow"></i>
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
        } else {
            if (!emphasisElements.querySelector('[data-action="emphasis-suggest"]')) {
                const toggleBtnExisting = emphasisElements.querySelector('[data-action="emphasis-toggle"]');
                const suggestBtn = document.createElement('button');
                suggestBtn.type = 'button';
                suggestBtn.className = 'btn-secondary emphasis-btn btn-small emphasis-suggest hidden';
                suggestBtn.dataset.action = 'emphasis-suggest';
                suggestBtn.title = 'Use suggested value';
                suggestBtn.innerHTML = '<i class="fas fa-bullseye-arrow"></i>';
                if (toggleBtnExisting) {
                    toggleBtnExisting.insertAdjacentElement('beforebegin', suggestBtn);
                }
            }
            if (!emphasisElements.querySelector('[data-action="emphasis-trim-end"]')) {
                const suggestExisting = emphasisElements.querySelector('[data-action="emphasis-suggest"]');
                const trimStartBtn = document.createElement('button');
                trimStartBtn.type = 'button';
                trimStartBtn.className = 'btn-secondary emphasis-btn btn-small emphasis-trim-start';
                trimStartBtn.dataset.action = 'emphasis-trim-start';
                trimStartBtn.title = 'Trim start';
                trimStartBtn.innerHTML = '<i class="fas fa-bracket-square"></i>';
                const trimEndBtn = document.createElement('button');
                trimEndBtn.type = 'button';
                trimEndBtn.className = 'btn-secondary emphasis-btn btn-small emphasis-trim-end';
                trimEndBtn.dataset.action = 'emphasis-trim-end';
                trimEndBtn.title = 'Trim end';
                trimEndBtn.innerHTML = '<i class="fas fa-bracket-square-right"></i>';
                const insertBefore = suggestExisting
                    || emphasisElements.querySelector('[data-action="emphasis-toggle"]')
                    || emphasisElements.querySelector('.emphasis-actions');
                if (insertBefore) {
                    insertBefore.insertAdjacentElement('beforebegin', trimStartBtn);
                    insertBefore.insertAdjacentElement('beforebegin', trimEndBtn);
                }
            }
        }

        // Add event listeners for emphasis buttons only if they haven't been added yet
        const upBtn = emphasisElements.querySelector('[data-action="emphasis-up"]');
        const downBtn = emphasisElements.querySelector('[data-action="emphasis-down"]');
        const trimStartBtn = emphasisElements.querySelector('[data-action="emphasis-trim-start"]');
        const trimEndBtn = emphasisElements.querySelector('[data-action="emphasis-trim-end"]');
        const suggestBtn = emphasisElements.querySelector('[data-action="emphasis-suggest"]');
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
        if (trimStartBtn && !trimStartBtn.hasAttribute('data-listeners-attached')) {
            trimStartBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.runEmphasisTrimFromEditor(toolbar, 'start');
            });
            trimStartBtn.setAttribute('data-listeners-attached', 'true');
        }
        if (trimEndBtn && !trimEndBtn.hasAttribute('data-listeners-attached')) {
            trimEndBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.runEmphasisTrimFromEditor(toolbar, 'end');
            });
            trimEndBtn.setAttribute('data-listeners-attached', 'true');
        }
        if (suggestBtn && !suggestBtn.hasAttribute('data-listeners-attached')) {
            suggestBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // applySuggestedEmphasisEditing: public/scripts/comp/emphasisEditing.js
                if (applySuggestedEmphasisEditing()) {
                    this.updateEmphasisDisplay(toolbar);
                }
            });
            suggestBtn.setAttribute('data-listeners-attached', 'true');
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
        if (toolbar) {
            toolbar.emphasisEditorDigits = '';
        }
        if (window.adjustEmphasisEditing) {
            window.adjustEmphasisEditing(delta);
            this.updateEmphasisDisplay(toolbar);
        }
    }

    /**
     * Trim start/end from the Edit Emphasis bar using the in-group caret when possible.
     * which: 'start' | 'end'
     */
    runEmphasisTrimFromEditor(toolbar, which) {
        const textarea = this.getTextareaFromToolbar(toolbar) || window.emphasisEditingTarget;
        if (!textarea) return;

        let pos = Number.isFinite(textarea._emphasisLastCaret)
            ? textarea._emphasisLastCaret
            : textarea.selectionStart;
        if (window.emphasisEditingSelection) {
            const sel = window.emphasisEditingSelection;
            const bag = resolveEmphasisBagForTextarea(textarea) || {};
            const block = findManagedEmphasisBlockAtCursor(textarea.value, sel.start, bag)
                || findManagedEmphasisBlockAtCursor(textarea.value, Math.max(sel.start, sel.end - 1), bag);
            if (block) {
                const inContent = pos >= block.openEnd && pos <= block.closeStart;
                if (!inContent) {
                    pos = which === 'end' ? block.closeStart : Math.min(block.closeStart, block.openEnd + 1);
                }
            }
        }
        pos = Math.max(0, Math.min(textarea.value.length, pos));
        textarea.setSelectionRange(pos, pos);

        const ok = which === 'start'
            ? trimManagedEmphasisStartAtCaret(textarea)
            : trimManagedEmphasisEndAtCaret(textarea);
        if (!ok) {
            this.updateEmphasisDisplay(toolbar);
            return;
        }

        const bag = resolveEmphasisBagForTextarea(textarea) || {};
        const caret = textarea.selectionStart;
        const block = findManagedEmphasisBlockAtCursor(textarea.value, caret, bag)
            || findManagedEmphasisBlockAtCursor(textarea.value, Math.max(0, caret - 1), bag);
        if (block) {
            window.emphasisEditingSelection = { start: block.start, end: block.end };
            window.emphasisEditingMode = 'group';
            textarea._emphasisLastCaret = Math.max(block.openEnd, Math.min(caret, block.closeStart));
        }
        this.updateEmphasisDisplay(toolbar);
        setTimeout(() => textarea.focus(), 0);
    }

    switchEmphasisMode(toolbar) {
        if (toolbar) {
            toolbar.emphasisEditorDigits = '';
        }
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
        // resolveDirectEmphasisWeightFromDigits: public/scripts/comp/emphasisGroupIdCodec.js
        const resolved = resolveDirectEmphasisWeightFromDigits(
            pending.digits,
            pending.isAlt,
            textarea
        );
        if (!resolved) return null;
        let numericValue = resolved.weight;
        if (!textarea) return { weight: numericValue, sharePercent: resolved.sharePercent, band: resolved.band };
        const currentMode = this.detectEmphasisMode(textarea, textarea.selectionStart, textarea.selectionEnd);
        if (currentMode === 'brace') {
            numericValue = snapWeightForBraceMode(numericValue);
        }
        return { weight: numericValue, sharePercent: resolved.sharePercent, band: resolved.band };
    }

    showDirectEmphasisPreview(toolbar, textarea, pending) {
        const preview = this.ensureDirectEmphasisPreviewElements(toolbar);
        if (!preview) return;

        const resolved = this.resolveDirectEmphasisPreviewWeight(pending, textarea);
        if (!resolved || resolved.weight == null) return;
        const numericValue = resolved.weight;

        const valueEl = preview.querySelector('.direct-emphasis-preview-value');
        const typeEl = preview.querySelector('.emphasis-type');
        if (valueEl) {
            if (resolved.band?.enabled && Number.isFinite(resolved.sharePercent)) {
                valueEl.textContent = `${Math.round(resolved.sharePercent)}%`;
                valueEl.style.color = getEmphasisToolbarColor(numericValue);
                valueEl.title = `→ ${formatEmphasisWeightDisplay(numericValue)}`;
            } else {
                valueEl.textContent = formatEmphasisWeightDisplay(numericValue);
                valueEl.style.color = getEmphasisToolbarColor(numericValue);
                valueEl.title = 'Applies shortly';
            }
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
                default:
                    if (resolved.band?.enabled) {
                        typeText = resolved.band.distribution ? 'Distribution' : 'Share';
                    }
                    break;
            }
            typeEl.textContent = typeText;
            typeEl.className = `emphasis-type ${modeClass}`;
        }

        toolbar.classList.add('direct-emphasis-preview');
        toolbar.classList.remove('hidden');
        preview.classList.remove('hidden');
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
            this.flushDirectEmphasisPending(toolbar);
        }, 500);
    }

    // Commit the pending direct-emphasis digits immediately (shared by the apply timeout and arrow-key commit)
    flushDirectEmphasisPending(toolbar) {
        if (toolbar.directEmphasisApplyTimeout) {
            clearTimeout(toolbar.directEmphasisApplyTimeout);
            toolbar.directEmphasisApplyTimeout = null;
        }
        const activePending = toolbar.directEmphasisPending;
        toolbar.directEmphasisPending = null;
        this.hideDirectEmphasisPreview(toolbar);
        if (!activePending) return null;

        // resolveDirectEmphasisWeightFromDigits: public/scripts/comp/emphasisGroupIdCodec.js
        const resolved = resolveDirectEmphasisWeightFromDigits(
            activePending.digits,
            activePending.isAlt,
            activePending.textarea
        );
        if (!resolved) return null;
        let numericValue = resolved.weight;

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
            return result;
        }
        return null;
    }

    updateEmphasisDisplay(toolbar) {
        const valueElement = toolbar.querySelector('.emphasis-value:not(.direct-emphasis-preview-value)');
        const typeElement = toolbar.querySelector('.toolbar-emphasis-elements .emphasis-type');
        const toggleBtn = toolbar.querySelector('[data-action="emphasis-toggle"]');
        const suggestBtn = toolbar.querySelector('[data-action="emphasis-suggest"]');
        const trimStartBtn = toolbar.querySelector('[data-action="emphasis-trim-start"]');
        const trimEndBtn = toolbar.querySelector('[data-action="emphasis-trim-end"]');
        const textarea = this.getTextareaFromToolbar(toolbar) || window.emphasisEditingTarget;

        if ((trimStartBtn || trimEndBtn) && textarea) {
            const prevStart = textarea.selectionStart;
            const prevEnd = textarea.selectionEnd;
            let probePos = Number.isFinite(textarea._emphasisLastCaret)
                ? textarea._emphasisLastCaret
                : prevStart;
            if (window.emphasisEditingSelection) {
                const sel = window.emphasisEditingSelection;
                const bag = resolveEmphasisBagForTextarea(textarea) || {};
                const block = findManagedEmphasisBlockAtCursor(textarea.value, sel.start, bag)
                    || findManagedEmphasisBlockAtCursor(textarea.value, Math.max(sel.start, sel.end - 1), bag);
                if (block) {
                    const inContent = probePos >= block.openEnd && probePos <= block.closeStart;
                    if (!inContent) probePos = block.closeStart;
                }
            }
            textarea.setSelectionRange(probePos, probePos);
            if (trimStartBtn) {
                // canTrimManagedEmphasisStartAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                trimStartBtn.disabled = !canTrimManagedEmphasisStartAtCaret(textarea);
            }
            if (trimEndBtn) {
                // canTrimManagedEmphasisEndAtCaret: public/scripts/comp/emphasisGroupIdCodec.js
                trimEndBtn.disabled = !canTrimManagedEmphasisEndAtCaret(textarea);
            }
            textarea.setSelectionRange(prevStart, prevEnd);
        } else {
            if (trimStartBtn) trimStartBtn.disabled = true;
            if (trimEndBtn) trimEndBtn.disabled = true;
        }

        if (window.emphasisEditingValue !== undefined) {
            const emphasisValue = window.emphasisEditingValue;
            const unit = window.emphasisEditingValueUnit || 'weight';

            if (valueElement) {
                if (emphasisValue === "---") {
                    valueElement.textContent = "---";
                    valueElement.style.color = getEmphasisToolbarColor('---');
                } else if (unit === 'percent') {
                    const pct = typeof emphasisValue === 'string' ? parseFloat(emphasisValue) : emphasisValue;
                    valueElement.textContent = `${formatEmphasisShareDisplay(pct)}%`;
                    const band = getEmphasisNormalizeBandForTextarea(window.emphasisEditingTarget);
                    const w = shareToWeightFromRange(pct, band.minWeight, band.maxWeight);
                    valueElement.style.color = getEmphasisToolbarColor(w);
                    valueElement.title = `Share · → ${formatEmphasisWeightDisplay(w)}`;
                } else {
                    const displayValue = typeof emphasisValue === 'string' ? parseFloat(emphasisValue) : emphasisValue;
                    valueElement.textContent = formatEmphasisWeightDisplay(displayValue);
                    valueElement.style.color = getEmphasisToolbarColor(displayValue);
                    valueElement.title = window.emphasisEditingMode === 'brace'
                        ? 'Scroll ±1 brace level (NovelAI 1.05×)'
                        : 'Scroll ±0.1 · Shift+scroll ±0.01';
                }
            }
        }

        if (window.emphasisEditingMode !== undefined) {
            const emphasisMode = window.emphasisEditingMode;
            const band = getEmphasisNormalizeBandForTextarea(window.emphasisEditingTarget);

            if (typeElement) {
                let typeText = '';
                let modeClass = '';
                if (band.enabled && window.emphasisEditingValueUnit === 'percent') {
                    typeText = band.distribution ? 'Distribution' : 'Share';
                    modeClass = 'mode-group';
                } else {
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
                }
                typeElement.textContent = typeText;
                typeElement.className = `emphasis-type ${modeClass}`;
            }
        }

        if (suggestBtn) {
            const band = getEmphasisNormalizeBandForTextarea(window.emphasisEditingTarget);
            const show = !!(band.enabled && window.emphasisEditingMode === 'group');
            suggestBtn.classList.toggle('hidden', !show);
        }

        // Update toggle button visibility
        if (toggleBtn) {
            if (window.emphasisEditingMode === 'group' && window.emphasisEditingValueUnit !== 'percent') {
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
                    const now = Date.now();
                    let pendingDigits = toolbar.emphasisEditorDigits || '';
                    const pendingTime = toolbar.emphasisEditorDigitsTime || 0;

                    if (now - pendingTime > 1000 || pendingDigits.length >= 4) {
                        pendingDigits = '';
                    }

                    pendingDigits += e.key;
                    toolbar.emphasisEditorDigits = pendingDigits;
                    toolbar.emphasisEditorDigitsTime = now;

                    const resolved = resolveDirectEmphasisWeightFromDigits(
                        pendingDigits,
                        e.altKey,
                        t
                    );
                    if (resolved && resolved.weight != null) {
                        if (window.emphasisEditingValue !== undefined) {
                            if (resolved.band?.enabled && resolved.sharePercent != null) {
                                window.emphasisEditingValue = clampEmphasisShare(resolved.sharePercent);
                                window.emphasisEditingValueUnit = 'percent';
                            } else {
                                window.emphasisEditingValue = clampEmphasisWeight(resolved.weight);
                                window.emphasisEditingValueUnit = 'weight';
                            }
                            this.updateEmphasisDisplay(toolbar);

                            if (window.emphasisEditingTarget && window.emphasisEditingSelection) {
                                if (typeof window.addEmphasisSelectionHighlight === 'function') {
                                    window.addEmphasisSelectionHighlight(window.emphasisEditingTarget, window.emphasisEditingSelection);
                                }
                            }
                        }
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    toolbar.emphasisEditorDigits = '';
                    if (window.switchEmphasisMode) {
                        window.switchEmphasisMode('left');
                        this.updateEmphasisDisplay(toolbar);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    toolbar.emphasisEditorDigits = '';
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

    /**
     * Alt+E: inside group → edit; selection outside → wrap 1.0/optimal; caret outside → comma-select + edit.
     */
    handleAltEEmphasisShortcut(textarea, toolbar) {
        if (!textarea) return;
        const tb = toolbar || this.getToolbarFromTextarea(textarea);
        const value = textarea.value || '';
        const selStart = textarea.selectionStart;
        const selEnd = textarea.selectionEnd;
        const bag = resolveEmphasisBagForTextarea(textarea);
        const hasSel = selStart !== selEnd;

        const managedAt = (pos) => {
            // Content range only — outer delimiter edges match the dial (outside).
            // isCaretInManagedEmphasisContent / findManagedEmphasisBlockAtCursor: emphasisGroupIdCodec.js
            if (!isCaretInManagedEmphasisContent(value, pos)) return null;
            return findManagedEmphasisBlockAtCursor(value, pos, bag);
        };
        const insideManaged = managedAt(selStart)
            || (hasSel ? managedAt(Math.max(selStart, selEnd - 1)) : null);
        // isCursorInsideEmphasisBlock: public/scripts/comp/emphasisParse.js
        const classicInside = !insideManaged && isCursorInsideEmphasisBlock(textarea);

        if (insideManaged || classicInside) {
            this.openEmphasisMode(textarea, tb);
            // showShortcutActionToast: public/scripts/comp/keyboardShortcuts.js
            showShortcutActionToast('Edit Emphasis');
            return;
        }

        if (hasSel) {
            const weight = computeOptimalEmphasisWeightForNewGroup(textarea);
            const result = wrapOrUpdateManagedEmphasisSelection(textarea, weight);
            if (result && result.success) {
                textarea.setSelectionRange(result.start, result.end);
                const band = getEmphasisNormalizeBandForTextarea(textarea);
                const msg = band.enabled
                    ? `Emphasis ${formatEmphasisWeightDisplay(weight)}`
                    : 'Emphasis 1.0';
                showShortcutActionToast(msg);
            }
            return;
        }

        // Caret outside: select between commas then open editor
        // findAutoDetectTagBounds: public/scripts/comp/emphasisSelection.js
        const bounds = findAutoDetectTagBounds(value, selStart);
        if (!bounds || bounds.end - bounds.start < 1) return;
        textarea.setSelectionRange(bounds.start, bounds.end);
        textarea._emphasisLastCaret = bounds.start;

        if (bounds.mode === 'group' || bounds.mode === 'brace') {
            this.openEmphasisMode(textarea, tb);
            showShortcutActionToast('Edit Emphasis');
            return;
        }

        // Plain tag span — wrap as managed group then open editor
        const weight = computeOptimalEmphasisWeightForNewGroup(textarea);
        const wrapped = wrapOrUpdateManagedEmphasisSelection(textarea, weight, {
            start: bounds.start,
            end: bounds.end
        });
        if (wrapped && wrapped.success) {
            textarea.setSelectionRange(wrapped.start + 1, wrapped.end - 1);
            textarea._emphasisLastCaret = wrapped.start + 1;
        }
        this.openEmphasisMode(textarea, tb);
        showShortcutActionToast('Edit Emphasis');
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
            const key = e.key;
            const hasAlt = e.altKey;
            const hasCtrlMeta = e.ctrlKey || e.metaKey;

            // Fast reject: plain typing that cannot be digit wrap / Alt shortcut / pending flush
            if (!hasAlt && !hasCtrlMeta && !toolbar.directEmphasisPending) {
                if (key.length !== 1) return;
                if ((key < '0' || key > '9') && key !== '{' && key !== '[') return;
            }

            const textarea = resolveTargetTextarea(e.target);
            if (!textarea) return;

            // While digits are pending, an arrow key commits the emphasis immediately, then the cursor moves as pressed
            if (toolbar.directEmphasisPending && (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')) {
                this.flushDirectEmphasisPending(toolbar);
                return;
            }

            // ALT+E — select-to-group / edit emphasis
            if (hasAlt && !hasCtrlMeta && (key === 'e' || key === 'E')) {
                e.preventDefault();
                this.handleAltEEmphasisShortcut(textarea, toolbar);
                return;
            }

            // ALT+SHIFT+S — split emphasis group at commas (classic N:: or managed)
            if (hasAlt && !hasCtrlMeta && e.shiftKey && (key === 's' || key === 'S')) {
                e.preventDefault();
                // splitEmphasisGroupAtCommasAtCursor: public/scripts/comp/emphasisParse.js
                const success = splitEmphasisGroupAtCommasAtCursor(textarea);
                if (success) {
                    // updateEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
                    updateEmphasisHighlighting(textarea);
                    // showShortcutActionToast: public/scripts/comp/keyboardShortcuts.js
                    showShortcutActionToast('Split Group at Commas');
                }
                return;
            }

            // ALT+S / ALT+, — split at caret (classic N:: or managed; classic first like Alt+E)
            if (hasAlt && !hasCtrlMeta && !e.shiftKey && (key === 's' || key === 'S' || key === ',')) {
                e.preventDefault();

                const addComma = key === ',';
                const bag = resolveEmphasisBagForTextarea(textarea);
                const value = textarea.value || '';
                const pos = textarea.selectionStart;
                // findManagedEmphasisBlockAtCursor / isCaretInManagedEmphasisContent: emphasisGroupIdCodec.js
                const insideManaged = isCaretInManagedEmphasisContent(value, pos)
                    ? findManagedEmphasisBlockAtCursor(value, pos, bag)
                    : null;
                // isCursorInsideEmphasisBlock: public/scripts/comp/emphasisParse.js
                const classicInside = !insideManaged && isCursorInsideEmphasisBlock(textarea);
                if (!insideManaged && !classicInside) return;

                // splitEmphasisBlock: public/scripts/comp/emphasisParse.js (managed when managedId, else classic)
                const success = splitEmphasisBlock(textarea, { addComma });
                if (success) {
                    // updateEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
                    updateEmphasisHighlighting(textarea);
                    // showShortcutActionToast: public/scripts/comp/keyboardShortcuts.js
                    showShortcutActionToast(addComma ? 'Split Emphasis ,' : 'Split Emphasis');
                }
                return;
            }

            // Wrap selection with {} or [] (same path as digit → applyEmphasisDirectly; weights match one brace level)
            if ((key === '{' || key === '[') && !hasAlt && !hasCtrlMeta) {
                if (!toolbar.classList.contains('emphasis-mode') && document.activeElement === textarea) {
                    if (textarea.selectionStart !== textarea.selectionEnd) {
                        this.clearDirectEmphasisPending(toolbar);
                        const weight = key === '{'
                            ? weightFromBraceLevel(1, 'brace')
                            : weightFromBraceLevel(1, 'bracket');
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
            if (key < '0' || key > '9' || (hasAlt && (key === '™' || key === '¡'))) {
                return;
            }

            // Only handle when NOT in emphasis mode and textarea is focused
            if (toolbar.classList.contains('emphasis-mode') || document.activeElement !== textarea) {
                return;
            }

            // Check if there's selected text and apply emphasis directly
            if (textarea.selectionStart !== textarea.selectionEnd) {
                // isSelectionEmphasisWeightValue / isSelectionPlainNumberForReplace: public/scripts/comp/emphasisParse.js
                if (isSelectionEmphasisWeightValue(textarea) || isSelectionPlainNumberForReplace(textarea)) {
                    return;
                }
                e.preventDefault();
                const isAltPressed = hasAlt;
                const digit = (key === '™') ? 1 : (key === '¡') ? 2 : parseInt(key, 10);
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

            // Typed "::" — managed: add/move end marker; classic: Alt+S split (type-only; never paste)
            if (e.inputType === 'insertText' && e.data === ':') {
                // tryManagedEmphasisEndMarkerOnTypedColon: public/scripts/comp/emphasisGroupIdCodec.js
                if (tryManagedEmphasisEndMarkerOnTypedColon(textarea)) {
                    e.preventDefault();
                    return;
                }
                // tryAutoSplitEmphasisOnTypedColon: public/scripts/comp/emphasisParse.js
                if (tryAutoSplitEmphasisOnTypedColon(textarea)) {
                    e.preventDefault();
                    if (window.updateEmphasisHighlighting) {
                        window.updateEmphasisHighlighting(textarea);
                    }
                }
                return;
            }

            if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
            const char = e.data;
            const isDigit = char >= '0' && char <= '9';
            const isBraceWrap = char === '{' || char === '[';
            if (!isDigit && !isBraceWrap) return;
            if (toolbar.classList.contains('emphasis-mode') || document.activeElement !== textarea) return;
            if (textarea.selectionStart === textarea.selectionEnd) return;

            // Editing a weight value (or any plain number selection) — let the digit replace the selection
            // isSelectionEmphasisWeightValue / isSelectionPlainNumberForReplace: public/scripts/comp/emphasisParse.js
            if (isDigit && (isSelectionEmphasisWeightValue(textarea) || isSelectionPlainNumberForReplace(textarea))) {
                return;
            }

            if (isBraceWrap) {
                this.clearDirectEmphasisPending(toolbar);
                const weight = char === '{'
                    ? weightFromBraceLevel(1, 'brace')
                    : weightFromBraceLevel(1, 'bracket');
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

        // Fallback when beforeinput does not fire for ":" (some mobile keyboards)
        const autoSplitColonInputFallback = (e) => {
            const textarea = resolveTargetTextarea(e.target);
            if (!textarea) return;
            // isTextInputComposing: public/scripts/comp/textareaUtils.js
            if (typeof isTextInputComposing === 'function' && isTextInputComposing(textarea, e)) return;
            if (e.inputType !== 'insertText' || e.data !== ':') return;
            // tryManagedEmphasisEndMarkerOnTypedColon: public/scripts/comp/emphasisGroupIdCodec.js
            if (tryManagedEmphasisEndMarkerOnTypedColon(textarea, { phase: 'afterBothColons' })) {
                return;
            }
            // tryAutoSplitEmphasisOnTypedColon: public/scripts/comp/emphasisParse.js
            if (tryAutoSplitEmphasisOnTypedColon(textarea, { phase: 'afterBothColons' })) {
                if (window.updateEmphasisHighlighting) {
                    window.updateEmphasisHighlighting(textarea);
                }
            }
        };
        toolbar.autoSplitColonInputFallback = autoSplitColonInputFallback;
        container.addEventListener('input', autoSplitColonInputFallback);
    }

    detectEmphasisMode(textarea, selectionStart, selectionEnd) {
        const value = textarea.value;

        // Find the current tag boundaries (separated by commas / managed open-close)
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

        // Clamp inside managed ZWSP groups so the tag slice does not swallow open/close magic
        // findManagedEmphasisBlockAtCursor / listManagedEmphasisBlocks: public/scripts/comp/emphasisGroupIdCodec.js
        const managedAtSel = findManagedEmphasisBlockAtCursor(value, selectionStart);
        if (managedAtSel
            && selectionStart >= managedAtSel.openEnd
            && selectionEnd <= managedAtSel.closeStart) {
            tagStart = Math.max(tagStart, managedAtSel.openEnd);
            tagEnd = Math.min(tagEnd, managedAtSel.closeStart);
            // Existing managed group — same mode token as classic N:: (applyEmphasisDirectly uses managed path)
            const hasExistingBraces = /\{|\[|\}|\]/.test(value.substring(tagStart, tagEnd));
            return hasExistingBraces ? 'brace' : 'normal';
        }
        if (hasManagedEmphasisGroupIds(value)) {
            const managedBlocks = listManagedEmphasisBlocks(value);
            for (let i = 0; i < managedBlocks.length; i++) {
                const b = managedBlocks[i];
                if (b.end <= selectionStart) tagStart = Math.max(tagStart, b.end);
                if (b.openEnd <= selectionStart && selectionStart <= b.closeStart) {
                    tagStart = Math.max(tagStart, b.openEnd);
                }
                if (b.start >= selectionEnd) tagEnd = Math.min(tagEnd, b.start);
                if (b.closeStart >= selectionEnd && selectionEnd >= b.openEnd) {
                    tagEnd = Math.min(tagEnd, b.closeStart);
                }
            }
        }

        // Extract the current tag content
        const currentTag = value.substring(tagStart, tagEnd).trim();

        // Check if the current tag already has emphasis or braces
        const hasExistingEmphasis = /(-?\d+\.\d+)::/.test(currentTag)
            || hasManagedEmphasisGroupIds(currentTag);
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
        if (toolbar) {
            toolbar.emphasisEditorDigits = '';
        }
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
        if (textarea) {
            this.updateEmphasisGroupChip(textarea, toolbar);
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
        keepPromptNewlines = !keepPromptNewlines;
        this.syncKeepNewlinesButtons();
        // updatePromptStatusIcons: public/scripts/comp/utilities.js
        updatePromptStatusIcons();
    }

    syncKeepNewlinesButtons() {
        document.querySelectorAll('.custom-dropdown-option[data-value="keep-newlines"]').forEach((option) => {
            option.classList.toggle('selected', !!keepPromptNewlines);
        });
    }
}

// Initialize the toolbar manager when the DOM is ready
window.wsClient.registerInitStep(37, 'Initializing Prompt Toolbar', async () => {
    // isV5Model: public/scripts/comp/utilities.js
    keepPromptNewlines = isV5Model(manualSelectedModel);
    autoCharNumerize = true;
    autoFormatOnBlur = true;
    promptNormalize = true;
    deduplicateTags = true;
    promptTextareaToolbar = new PromptTextareaToolbar();
    promptTextareaToolbar.syncKeepNewlinesButtons();

    // Expose reset method globally for other components to use
    resetInlineSearch = () => {
        if (promptTextareaToolbar) {
            promptTextareaToolbar.resetAllSearchStates();
        }
    };
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PromptTextareaToolbar;
} 