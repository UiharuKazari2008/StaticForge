/**
 * Shared Textarea Utilities
 * Common functions for creating and managing editable textareas across the application
 */

const textInputCompositionDepth = new WeakMap();

function bindTextInputCompositionTracking(el) {
    if (!el || el.dataset.compositionTracked === '1') return;
    el.dataset.compositionTracked = '1';
    el.addEventListener('compositionstart', () => {
        textInputCompositionDepth.set(el, (textInputCompositionDepth.get(el) || 0) + 1);
    });
    el.addEventListener('compositionend', () => {
        const depth = textInputCompositionDepth.get(el) || 0;
        if (depth <= 1) {
            textInputCompositionDepth.delete(el);
        } else {
            textInputCompositionDepth.set(el, depth - 1);
        }
    });
}

/** True while IME / on-device autocorrect composition is active — avoid programmatic edits. */
function isTextInputComposing(el, e) {
    if (e && e.isComposing) return true;
    if (el && (textInputCompositionDepth.get(el) || 0) > 0) return true;
    return false;
}

const textInputSideEffectRafIds = new WeakMap();
const textInputSideEffectQueues = new WeakMap();

/**
 * Run a non-editing input side effect after the browser commits the keystroke.
 * Coalesces multiple input events and callbacks per textarea per frame (rAF throttle,
 * same-function callbacks deduped — web.dev/debounce-your-input-handlers pattern).
 * Does not stop propagation.
 */
function scheduleTextInputSideEffect(textarea, fn) {
    if (!textarea || typeof fn !== 'function') return;
    if (isTextInputComposing(textarea)) return;

    let queue = textInputSideEffectQueues.get(textarea);
    if (!queue) {
        queue = [];
        textInputSideEffectQueues.set(textarea, queue);
    }
    // Same listener often schedules from both keydown and input in one turn — run once.
    if (queue.indexOf(fn) === -1) {
        queue.push(fn);
    }

    if (textInputSideEffectRafIds.has(textarea)) {
        return;
    }

    const rafId = requestAnimationFrame(() => {
        textInputSideEffectRafIds.delete(textarea);
        const pending = textInputSideEffectQueues.get(textarea) || [];
        textInputSideEffectQueues.delete(textarea);
        if (!textarea.isConnected) return;
        if (isTextInputComposing(textarea)) return;
        for (let i = 0; i < pending.length; i++) {
            pending[i]();
        }
    });
    textInputSideEffectRafIds.set(textarea, rafId);
}

/** Cancel pending rAF side effects for a textarea (e.g. on blur / teardown). */
function cancelTextInputSideEffect(textarea) {
    if (!textarea) return;
    const rafId = textInputSideEffectRafIds.get(textarea);
    if (rafId) {
        cancelAnimationFrame(rafId);
        textInputSideEffectRafIds.delete(textarea);
    }
    textInputSideEffectQueues.delete(textarea);
}

/** Keydown events that will change textarea content (input may fire after keydown in the same turn). */
function isPromptTextareaContentKeydown(e) {
    if (!e || e.ctrlKey || e.metaKey || e.altKey) return false;
    const key = e.key;
    if (key.length === 1) return true;
    return key === 'Backspace' || key === 'Delete' || key === 'Enter';
}

/**
 * Defer resize + emphasis highlight on input (and paste via input).
 * Keep keydown free of visual work so the browser can commit the glyph first
 * (Nolan Lawson / web.dev: light input handlers + rAF-coalesced side effects).
 * Resize runs once per frame; highlight is debounced in emphasisHighlight.js.
 * options.minHeight — passed to autoResizeTextarea; options.onResize — called after resize.
 */
function wirePromptTextareaVisualUpdates(textarea, options = {}) {
    if (!textarea || textarea.dataset.promptVisualUpdatesWired === '1') return;
    textarea.dataset.promptVisualUpdatesWired = '1';

    const minHeight = options.minHeight;
    const onResize = options.onResize;

    const runVisualUpdates = () => {
        if (!textarea.isConnected || isTextInputComposing(textarea)) return;
        // autoResizeTextarea: public/scripts/comp/utilities.js
        if (typeof autoResizeTextarea === 'function') {
            autoResizeTextarea(textarea, minHeight != null ? minHeight : 70);
            if (onResize) onResize();
        }
        // scheduleEmphasisHighlightUpdate: public/scripts/comp/emphasisHighlight.js
        if (typeof scheduleEmphasisHighlightUpdate === 'function') {
            scheduleEmphasisHighlightUpdate(textarea);
        }
    };

    const scheduleVisualUpdates = (e) => {
        if (isTextInputComposing(textarea, e)) return;
        scheduleTextInputSideEffect(textarea, runVisualUpdates);
    };

    // addSafeEventListener: public/scripts/comp/utilities.js
    addSafeEventListener(textarea, 'input', scheduleVisualUpdates, 'promptVisualInput');
}

/**
 * Input listener that defers fn until after native input/IME commit (bubble phase).
 * addSafeEventListener: public/scripts/comp/utilities.js
 */
function addTextareaInputSideEffect(textarea, fn, handlerId) {
    if (!textarea || typeof fn !== 'function') return;
    addSafeEventListener(textarea, 'input', (e) => {
        if (isTextInputComposing(textarea, e)) return;
        scheduleTextInputSideEffect(textarea, fn);
    }, handlerId);
}

document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el) return;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio')) {
        bindTextInputCompositionTracking(el);
    }
}, true);

/**
 * Replace a textarea range without clearing the browser undo stack.
 * Use instead of building a new string and assigning textarea.value.
 * public/scripts/comp/textareaUtils.js
 */
function replaceTextareaRangePreservingUndo(textarea, start, end, text) {
    if (!textarea) return false;
    const replacement = text != null ? String(text) : '';
    const current = textarea.value;
    const safeStart = Math.max(0, Math.min(start, current.length));
    const safeEnd = Math.max(safeStart, Math.min(end, current.length));
    if (current.substring(safeStart, safeEnd) === replacement) return false;
    textarea.setRangeText(replacement, safeStart, safeEnd, 'end');
    return true;
}

/**
 * Replace entire textarea content without clearing the browser undo stack.
 * public/scripts/comp/textareaUtils.js
 */
function setTextareaValuePreservingUndo(textarea, newValue) {
    if (!textarea) return false;
    const text = newValue != null ? String(newValue) : '';
    const current = textarea.value;
    if (current === text) return false;
    textarea.setRangeText(text, 0, current.length, 'end');
    return true;
}

/**
 * Creates an editable textarea container with toolbar
 * @param {Object} options - Configuration options
 * @param {string} options.value - Initial textarea value
 * @param {number} options.rows - Number of textarea rows (default: 2)
 * @param {string} options.placeholder - Placeholder text (default: 'Enter value...')
 * @param {Object} options.dataAttributes - Data attributes to add to textarea (default: {})
 * @returns {HTMLElement} The textarea container element
 */
function createEditableTextareaContainer(options = {}) {
    const {
        value = '',
        rows = 2,
        placeholder = 'Enter value...',
        dataAttributes = {}
    } = options;
    
    const container = document.createElement('div');
    container.className = 'character-prompt-textarea-container';
    
    // Build data attributes string
    const dataAttrsString = Object.entries(dataAttributes)
        .map(([key, val]) => `data-${key}="${escapeHtml(String(val))}"`)
        .join(' ');
    
    container.innerHTML = `
        <div class="character-prompt-textarea-background"></div>
        <textarea 
            class="form-control character-prompt-textarea prompt-textarea"
            rows="${rows}"
            ${dataAttrsString}
            placeholder="${placeholder}"
            autocapitalize="false"
            autocorrect="false"
            spellcheck="false"
            data-ms-editor="false"
        >${escapeHtml(value)}</textarea>
        <div class="prompt-textarea-toolbar hidden">
            <div class="toolbar-left">
                <span class="token-count">0 tokens</span>
            </div>
            <div class="toolbar-right">
                <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="off" title="Toggle Autofill">
                    <i class="fas fa-lightbulb-slash"></i>
                </button>
                <button type="button" class="btn-secondary btn-small toolbar-btn toggle-btn emphasis-group-chip" data-action="emphasis-group-chip" data-state="off" title="Emphasis">
                    <i class="fas fa-dial"></i><span class="emphasis-group-chip-value hidden">1.0</span>
                </button>
                <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                    <i class="fas fa-book-font"></i>
                </button>
            </div>
        </div>
    `;
    
    return container;
}

/**
 * Wire .prompt-textarea fields the same way as manualPrompt in app.js (no per-button toolbar handlers).
 * Toolbar actions and dropdowns are handled by promptTextareaToolbar.js (document delegation + setupDropdown).
 * public/scripts/comp/textareaUtils.js
 */
function wireManualStylePromptTextarea(textarea) {
    if (!textarea || !textarea.matches('.prompt-textarea')) {
        return;
    }
    if (textarea.dataset.manualStylePromptWired === '1') {
        return;
    }
    textarea.dataset.manualStylePromptWired = '1';

    if (typeof handleCharacterAutocompleteInput === 'function') {
        addSafeEventListener(textarea, 'input', handleCharacterAutocompleteInput, 'autocomplete');
    }
    if (typeof handleCharacterAutocompleteKeydown === 'function') {
        addSafeEventListener(textarea, 'keydown', handleCharacterAutocompleteKeydown, 'keydown');
    }
    if (typeof startEmphasisHighlighting === 'function' && !textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) {
        addSafeEventListener(textarea, 'focus', () => startEmphasisHighlighting(textarea), 'emphasisFocus');
    }
    if (typeof applyFormattedText === 'function' && typeof updateEmphasisHighlighting === 'function' && typeof stopEmphasisHighlighting === 'function') {
        addSafeEventListener(textarea, 'blur', () => {
            if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) {
                if (typeof autoResizeTextarea === 'function') {
                    autoResizeTextarea(textarea);
                }
                return;
            }
            applyFormattedText(textarea, true);
            updateEmphasisHighlighting(textarea);
            if (typeof autoResizeTextarea === 'function') {
                autoResizeTextarea(textarea);
            }
            stopEmphasisHighlighting();
            // handlePromptTextareaAutofillBlur: public/scripts/comp/autocompleteUtils.js
            handlePromptTextareaAutofillBlur(textarea);
        }, 'emphasisBlur');
    }
    wirePromptTextareaVisualUpdates(textarea);
    // attachPromptTextareaContextMenu: public/scripts/comp/promptTextareaContextMenu.js
    if (attachPromptTextareaContextMenu) {
        attachPromptTextareaContextMenu(textarea);
    }

    // wireManagedEmphasisCaretGuards: public/scripts/comp/emphasisGroupIdCodec.js
    wireManagedEmphasisCaretGuards(textarea);

    const autofillBtn = textarea.closest('.character-prompt-textarea-container, .prompt-textarea-container')
        ?.querySelector('[data-action="autofill"]');
    // wireAutofillSettingsButton: public/scripts/comp/autofillSettings.js
    if (autofillBtn && typeof wireAutofillSettingsButton === 'function') {
        wireAutofillSettingsButton(autofillBtn);
    }
}

function setupPromptTextareaControls(textarea) {
    wireManualStylePromptTextarea(textarea);
    if (window.promptTextareaToolbar) {
        window.promptTextareaToolbar.updateTokenCount(textarea);
    }
}

/**
 * Setup an editable textarea with standard event listeners
 * @param {HTMLTextAreaElement} textarea - The textarea element to setup
 * @param {Function} customToolbarHandler - Optional custom toolbar action handler
 */
function setupEditableTextarea(textarea, customToolbarHandler = null) {
    if (!textarea || !textarea.matches('.character-prompt-textarea')) return;
    
    // Cache DOM elements to avoid repeated queries
    const container = textarea.closest('.character-prompt-textarea-container');
    const toolbar = container?.querySelector('.prompt-textarea-toolbar');
    
    // Add event listeners for focus/blur to show/hide toolbar
    addSafeEventListener(textarea, 'focus', () => {
        if (toolbar) {
            toolbar.classList.remove('hidden');
            if (window.promptTextareaToolbar) {
                window.promptTextareaToolbar.updateTokenCount(textarea);
            }
        }
        
        if (container) {
            container.classList.add('textarea-focused');
        }
    }, 'toolbar');
    
    addSafeEventListener(textarea, 'blur', () => {
        if (toolbar) {
            toolbar.classList.add('hidden');
        }

        if (container) {
            container.classList.remove('textarea-focused');
        }

        // Handle autocomplete blur — handlePromptTextareaAutofillBlur: public/scripts/comp/autocompleteUtils.js
        handlePromptTextareaAutofillBlur(textarea);
    }, 'toolbar');
    
    // Add input event listener for token count updates with debouncing
    const debouncedTokenUpdate = debounce(() => {
        if (window.promptTextareaToolbar) {
            window.promptTextareaToolbar.updateTokenCount(textarea);
        }
    }, 150); // 150ms debounce for token counting

    addTextareaInputSideEffect(textarea, debouncedTokenUpdate, 'tokenCount');
    
    // Add character autocomplete events
    if (window.handleCharacterAutocompleteInput) {
        addSafeEventListener(textarea, 'input', window.handleCharacterAutocompleteInput, 'autocomplete');
    }
    if (window.handleCharacterAutocompleteKeydown) {
        addSafeEventListener(textarea, 'keydown', window.handleCharacterAutocompleteKeydown, 'keydown');
    }
    if (window.startEmphasisHighlighting) {
        addSafeEventListener(textarea, 'focus', () => window.startEmphasisHighlighting(textarea), 'focus');
    }
    if (window.applyFormattedText && window.updateEmphasisHighlighting && window.stopEmphasisHighlighting) {
        addSafeEventListener(textarea, 'blur', () => {
            window.applyFormattedText(textarea, true);
            window.updateEmphasisHighlighting(textarea);
            window.stopEmphasisHighlighting();
        }, 'blur');
    }
    
    // Setup toolbar button event listeners
    const toolbarElement = textarea.closest('.character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
    if (toolbarElement) {
        setupEditableTextareaToolbar(toolbarElement, textarea, customToolbarHandler);
    }
    
    // Initial token count
    if (window.promptTextareaToolbar) {
        window.promptTextareaToolbar.updateTokenCount(textarea);
    }
}

/**
 * Setup toolbar for an editable textarea
 * @param {HTMLElement} toolbar - The toolbar element
 * @param {HTMLTextAreaElement} textarea - The associated textarea
 * @param {Function} customActionHandler - Optional custom action handler (action, textarea, toolbar, event) => void
 */
function setupEditableTextareaToolbar(toolbar, textarea, customActionHandler = null) {
    if (!toolbar || !textarea) return;
    
    // Handle toolbar button clicks
    const buttons = toolbar.querySelectorAll('.toolbar-btn');
    
    buttons.forEach((button) => {
        const action = button.dataset.action;
        // Toolbox dropdown triggers have no data-action; setupDropdown owns those clicks (manualPrompt pattern).
        if (!action || button.closest('.custom-dropdown')) {
            return;
        }

        // Remove any existing listeners first
        button.removeEventListener('click', button._editableTextareaClickHandler);
        
        // Create new handler
        button._editableTextareaClickHandler = (e) => {
            e.preventDefault();
            
            if (customActionHandler) {
                customActionHandler(action, textarea, toolbar, e);
            } else {
                // Default handler
                handleDefaultToolbarAction(action, textarea, toolbar);
            }
        };
        
        button.addEventListener('click', button._editableTextareaClickHandler);
    });
    
    // Sync autofill button state with global system
    const autofillBtn = toolbar.querySelector('[data-action="autofill"]');
    if (autofillBtn) {
        // Force enable the button if it's disabled
        if (autofillBtn.disabled) {
            autofillBtn.disabled = false;
            autofillBtn.removeAttribute('disabled');
        }
        
        if (window.toggleAutofill) {
            try {
                // Get current global state using the correct function
                let globalState = false;
                if (window.isAutofillEnabled) {
                    globalState = window.isAutofillEnabled();
                } else {
                    globalState = window.autofillEnabled || false;
                }
                
                // Update button to match global state
                autofillBtn.setAttribute('data-state', globalState ? 'on' : 'off');
                
                const icon = autofillBtn.querySelector('i');
                if (icon) {
                    icon.className = globalState ? 'fas fa-lightbulb' : 'fas fa-lightbulb-slash';
                }
            } catch (error) {
                console.error('Error syncing autofill state:', error);
            }
        }
    }
}

/**
 * Default toolbar action handler
 * @param {string} action - The action to perform
 * @param {HTMLTextAreaElement} textarea - The textarea element
 * @param {HTMLElement} toolbar - The toolbar element
 */
function handleDefaultToolbarAction(action, textarea, toolbar) {
    switch (action) {
        case 'quick-access':
            textarea.focus();
            // public/scripts/comp/featureLoader.js
            void featureLoader.loadFeature('dataset_tag_toolbar').then(() => showDatasetTagToolbar());
            break;
        case 'emphasis':
            // Start emphasis editing
            if (window.startEmphasisEditing) {
                window.startEmphasisEditing(textarea);
            }
            
            // Enter emphasis mode
            toolbar.classList.add('emphasis-mode');
            
            // Initialize emphasis mode
            if (window.promptTextareaToolbar) {
                window.promptTextareaToolbar.initializeEmphasisMode(textarea, toolbar);
                window.promptTextareaToolbar.updateEmphasisDisplay(toolbar);
            }
            
            // Ensure textarea maintains focus for keyboard input
            setTimeout(() => textarea.focus(), 10);
            break;
        case 'autofill':
            // Autofill is handled by the main toolbar system automatically
            break;
    }
}

/**
 * Utility function to escape HTML
 * @param {string} text - The text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

