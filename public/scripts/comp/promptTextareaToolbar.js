// Prompt Textarea Toolbar Manager
// Handles the toolbar that appears at the bottom of prompt textareas when active

class PromptTextareaToolbar {
    constructor() {
        this.activeTextarea = null;
        this.tokenCounters = new Map();
        this.searchStates = new Map(); // Map of toolbar -> search state
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initializeTokenCounters();
    }

    setupEventListeners() {
        // Listen for focus events on prompt textareas
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
                this.handleTextareaFocus(e.target);
            }
        });

        // Listen for blur events
        document.addEventListener('focusout', (e) => {
            if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
                this.handleTextareaBlur(e.target);
            }
        });

        // Listen for input events to update token count
        document.addEventListener('input', (e) => {
            if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
                this.updateTokenCount(e.target);
            }
        });

        // Listen for toolbar button clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.toolbar-btn')) {
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
    }

    handleTextareaFocus(textarea) {
        this.activeTextarea = textarea;
        const toolbar = this.getToolbarFromTextarea(textarea);
        const container = textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
        
        if (toolbar) {
            toolbar.classList.remove('hidden');
            this.updateTokenCount(textarea);
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
            
            // Check if the new focus target is within the same container
            const newFocusTarget = document.activeElement;
            const isFocusWithinContainer = container && container.contains(newFocusTarget);
            
            // Hide toolbar if focus is outside container (including other textareas)
            if (toolbar && !isFocusWithinContainer) {
                toolbar.classList.add('hidden');
                this.activeTextarea = null;
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
        return container ? container.querySelector('.prompt-textarea, .character-prompt-textarea') : null;
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

    // Method to handle dynamically created textareas
    handleDynamicTextarea(textarea) {
        if (textarea && (textarea.matches('.prompt-textarea') || textarea.matches('.character-prompt-textarea'))) {
            this.updateTokenCount(textarea);
        }
    }

    updateTokenCount(textarea) {
        const toolbar = this.getToolbarFromTextarea(textarea);
        if (!toolbar) return;

        const tokenCountElement = toolbar.querySelector('.token-count');
        if (!tokenCountElement) return;

        const text = textarea.value;
        const tokenCount = this.calculateTokenCount(text);
        tokenCountElement.textContent = `${tokenCount} tokens`;
    }

    calculateTokenCount(text) {
        // Simple token estimation - roughly 4 characters per token
        // This is a basic approximation, actual tokenization varies by model
        if (!text || text.trim() === '') return 0;
        
        // Count words and punctuation as separate tokens
        const words = text.trim().split(/\s+/);
        let tokenCount = 0;
        
        for (const word of words) {
            if (word.length === 0) continue;
            
            // Basic token estimation
            if (word.length <= 4) {
                tokenCount += 1;
            } else {
                // Longer words get additional tokens
                tokenCount += Math.ceil(word.length / 4);
            }
        }
        
        return Math.max(1, tokenCount);
    }

    handleToolbarAction(action, textarea, toolbar, event) {
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
            case 'search-prev':
                this.navigateSearchResult(-1, toolbar);
                break;
            case 'search-next':
                this.navigateSearchResult(1, toolbar);
                break;
            case 'search-close':
                this.closeSearch(toolbar);
                break;
            case 'autofill':
                this.toggleAutofill(toolbar);
                break;
        }
    }

    openQuickAccess(textarea) {
        // Open the dataset tag toolbar
        if (window.showDatasetTagToolbar) {
            window.showDatasetTagToolbar();
        }
    }

    openSearch(textarea) {
        const toolbar = this.getToolbarFromTextarea(textarea);
        if (!toolbar) return;

        // Add search mode class to show search elements
        toolbar.classList.add('search-mode');

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

        // Focus the search input
        searchInput.focus();
        searchInput.select();

        // Add event listeners
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

        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.navigateSearchResult(-1, toolbar);
        });
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.navigateSearchResult(1, toolbar);
        });
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.closeSearch(toolbar);
        });
    }

    performSearch(toolbar = null) {
        // Get the current active search state
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        const { textarea, query, searchElements } = searchState;
        const matchCount = searchElements.querySelector('.text-search-match-count');

        if (!query.trim()) {
            searchState.results = [];
            searchState.selectedIndex = -1;
            matchCount.textContent = '0';
            this.clearSearchHighlights(activeToolbar);
            return;
        }

        const text = textarea.value;
        const searchQuery = query.toLowerCase();
        const results = [];
        
        // Find all occurrences of the search term (case insensitive)
        let index = 0;
        while ((index = text.toLowerCase().indexOf(searchQuery, index)) !== -1) {
            results.push({
                start: index,
                end: index + searchQuery.length,
                text: text.substring(index, index + searchQuery.length)
            });
            index += 1; // Move to next character to avoid infinite loop
        }

        searchState.results = results;
        searchState.selectedIndex = results.length > 0 ? 0 : -1;
        
        this.updateSearchResults(activeToolbar);
        this.highlightSearchResults(activeToolbar);
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
        
        const { results } = searchState;
        if (results.length === 0) return;

        if (direction === -1) {
            // Previous
            searchState.selectedIndex = searchState.selectedIndex > 0 ? 
                searchState.selectedIndex - 1 : results.length - 1;
        } else {
            // Next
            searchState.selectedIndex = searchState.selectedIndex < results.length - 1 ? 
                searchState.selectedIndex + 1 : 0;
        }

        this.updateSearchResults(activeToolbar);
        this.highlightSearchResults(activeToolbar);
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
            searchState.highlightOverlay = document.createElement('div');
            searchState.highlightOverlay.className = 'search-highlight-overlay';
            textarea.parentElement.appendChild(searchState.highlightOverlay);
        }

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
        
        const { textarea, results, selectedIndex } = searchState;
        
        if (selectedIndex >= 0 && selectedIndex < results.length) {
            const result = results[selectedIndex];
            
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
                    this.closeSearch(activeToolbar);
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
        
        const { textarea, results, selectedIndex } = searchState;
        
        if (selectedIndex >= 0 && selectedIndex < results.length) {
            const result = results[selectedIndex];
            textarea.setSelectionRange(result.start, result.end);
            textarea.focus();
            
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
        }
    }

    closeSearch(toolbar = null) {
        const activeToolbar = toolbar || this.getActiveSearchToolbar();
        if (!activeToolbar) return;
        
        const searchState = this.searchStates.get(activeToolbar);
        if (!searchState) return;
        
        // Clear search state
        this.clearSearchHighlights(activeToolbar);
        this.searchStates.delete(activeToolbar);
        
        // Remove search mode class to hide search elements
        activeToolbar.classList.remove('search-mode');
        
        // Return focus to the textarea
        if (searchState.textarea) {
            searchState.textarea.focus();
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
        
        // Initialize emphasis mode
        this.initializeEmphasisMode(textarea, toolbar);
        
        // Update emphasis display immediately
        this.updateEmphasisDisplay(toolbar);
    }

    initializeEmphasisMode(textarea, toolbar) {
        // Create emphasis elements if they don't exist
        let emphasisElements = toolbar.querySelector('.toolbar-emphasis-elements');
        if (!emphasisElements) {
            emphasisElements = document.createElement('div');
            emphasisElements.className = 'toolbar-emphasis-elements';
            emphasisElements.innerHTML = `
                <div class="emphasis-toolbar">
                    <div class="emphasis-type" id="emphasisType">New Group</div>
                    <div class="emphasis-value" id="emphasisValue">1.0</div>
                    <div class="emphasis-controls">
                        <button class="btn-secondary emphasis-btn emphasis-up" data-action="emphasis-up" title="Increase">
                            <i class="nai-plus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn emphasis-down" data-action="emphasis-down" title="Decrease">
                            <i class="nai-minus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn emphasis-toggle" data-action="emphasis-toggle" title="Toggle Mode" style="display: none;">
                            <i class="nai-arrow-left"></i>
                        </button>
                    </div>
                </div>
            `;
            toolbar.appendChild(emphasisElements);
        }

        // Add event listeners for emphasis buttons
        const upBtn = emphasisElements.querySelector('[data-action="emphasis-up"]');
        const downBtn = emphasisElements.querySelector('[data-action="emphasis-down"]');
        const toggleBtn = emphasisElements.querySelector('[data-action="emphasis-toggle"]');

        if (upBtn) {
            upBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.adjustEmphasis(0.1, toolbar);
            });
        }
        if (downBtn) {
            downBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.adjustEmphasis(-0.1, toolbar);
            });
        }
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchEmphasisMode(toolbar);
            });
        }

        // Add keyboard event listener for emphasis mode
        this.addEmphasisKeyboardListener(textarea, toolbar);
        
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

    updateEmphasisDisplay(toolbar) {
        const valueElement = toolbar.querySelector('#emphasisValue');
        const typeElement = toolbar.querySelector('#emphasisType');
        const toggleBtn = toolbar.querySelector('[data-action="emphasis-toggle"]');

        // Get current emphasis state from global variables
        if (window.emphasisEditingValue !== undefined) {
            const emphasisValue = window.emphasisEditingValue;
            
            if (valueElement) {
                // Handle special "---" value
                if (emphasisValue === "---") {
                    valueElement.textContent = "---";
                    valueElement.style.color = '#ff6b6b'; // Red for remove emphasis
                } else {
                    // Handle integer inputs by converting to float
                    const displayValue = typeof emphasisValue === 'string' ? parseFloat(emphasisValue) : emphasisValue;
                    valueElement.textContent = displayValue.toFixed(1);
                    
                    // Color code the emphasis value
                    if (displayValue > 1.0) {
                        valueElement.style.color = '#ff8c00'; // Orange for > 1
                    } else if (displayValue < 1.0) {
                        valueElement.style.color = '#87ceeb'; // Light blue for < 1
                    } else {
                        valueElement.style.color = '#ffffff'; // White for = 1
                    }
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
                toggleBtn.style.display = 'block';
                toggleBtn.innerHTML = '<i class="fas fa-brackets-curly"></i>';
                toggleBtn.title = 'Switch to Brace Block';
            } else if (window.emphasisEditingMode === 'brace') {
                toggleBtn.style.display = 'block';
                toggleBtn.innerHTML = '<i class="fas fa-colon"></i>';
                toggleBtn.title = 'Switch to Group';
            } else {
                toggleBtn.style.display = 'none';
            }
        }
    }

    addEmphasisKeyboardListener(textarea, toolbar) {
        const keydownHandler = (e) => {
            // Only handle keys when in emphasis mode
            if (!toolbar.classList.contains('emphasis-mode')) {
                return;
            }

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.adjustEmphasis(0.1, toolbar);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.adjustEmphasis(-0.1, toolbar);
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
                        window.emphasisEditingValue = integerValue.toFixed(1);
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

        // Store the handler reference for cleanup
        toolbar.emphasisKeydownHandler = keydownHandler;
        textarea.addEventListener('keydown', keydownHandler);
    }

    closeEmphasisMode(toolbar) {
        // Remove emphasis mode class
        toolbar.classList.remove('emphasis-mode');
        
        // Remove keyboard listener
        if (toolbar.emphasisKeydownHandler) {
            const textarea = this.getTextareaFromToolbar(toolbar);
            if (textarea) {
                textarea.removeEventListener('keydown', toolbar.emphasisKeydownHandler);
            }
            delete toolbar.emphasisKeydownHandler;
        }
        
        // Refresh emphasis highlighting on the textarea
        const textarea = this.getTextareaFromToolbar(toolbar);
        if (textarea && window.updateEmphasisHighlighting) {
            window.updateEmphasisHighlighting(textarea);
        }
    }

    toggleAutofill(toolbar) {
        console.log('toggleAutofill method called');
        // Toggle the autofill state globally
        const isEnabled = window.toggleAutofill ? window.toggleAutofill() : true;
        console.log('Autofill state after toggle:', isEnabled);
        
        // Update all autofill toggle buttons across all toolbars
        const allToolbars = document.querySelectorAll('.prompt-textarea-toolbar');
        console.log('Found toolbars to update:', allToolbars.length);
        allToolbars.forEach((toolbarElement, index) => {
            const autofillBtn = toolbarElement.querySelector('[data-action="autofill"]');
            if (autofillBtn) {
                console.log(`Updating toolbar ${index} autofill button to state: ${isEnabled ? 'on' : 'off'}`);
                autofillBtn.setAttribute('data-state', isEnabled ? 'on' : 'off');
                // Update icon to show state
                const icon = autofillBtn.querySelector('i');
                if (icon) {
                    icon.className = isEnabled ? 'fas fa-lightbulb' : 'fas fa-lightbulb-slash';
                }
            } else {
                console.log(`No autofill button found in toolbar ${index}`);
            }
        });
    }
}

// Initialize the toolbar manager when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.promptTextareaToolbar = new PromptTextareaToolbar();
});

// Expose method for handling dynamic textareas
window.handleDynamicTextarea = (textarea) => {
    if (window.promptTextareaToolbar) {
        window.promptTextareaToolbar.handleDynamicTextarea(textarea);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PromptTextareaToolbar;
} 