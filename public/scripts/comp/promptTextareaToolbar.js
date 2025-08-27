// Prompt Textarea Toolbar Manager
// Handles the toolbar that appears at the bottom of prompt textareas when active

class PromptTextareaToolbar {
    constructor() {
        this.activeTextarea = null;
        this.tokenCounters = new Map();
        this.searchStates = new Map(); // Map of toolbar -> search state
        this.originalCharacterStates = new Map(); // Track original collapse states
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
        
        // Listen for manual modal close events
        document.addEventListener('click', (e) => {
            // Check if clicking outside the manual modal
            const manualModal = document.getElementById('manualModal');
            if (manualModal && !manualModal.contains(e.target) && !e.target.closest('.prompt-textarea-toolbar')) {
                // Clicked outside modal and not on toolbar - reset search
                this.resetAllSearchStates();
            }
        });
        
        // Listen for modal close button clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.modal-close, .close-modal, [data-dismiss="modal"]')) {
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
            this.updateTokenCount(textarea);
            
            // Add direct emphasis keyboard listener if not already added
            if (!toolbar.hasAttribute('data-direct-emphasis-listener-added')) {
                this.addDirectEmphasisKeyboardListener(textarea, toolbar);
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

        // Expand all character prompts for better search visibility
        this.expandAllCharacterPrompts();

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
        let highlightOverlay = textarea.parentElement.querySelector('.search-highlight-overlay');
        if (!highlightOverlay) {
            highlightOverlay = document.createElement('div');
            highlightOverlay.className = 'search-highlight-overlay';
            textarea.parentElement.appendChild(highlightOverlay);
        }

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
            const highlightOverlay = textarea.parentElement.querySelector('.search-highlight-overlay');
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
        if (textareaId.includes('_prompt') || textareaId.includes('_uc')) {
            return true;
        }
        
        // Handle main textareas based on view mode
        if (viewMode === 'both') {
            // Show both mode: include both prompt and UC
            return textareaId === 'manualPrompt' || textareaId === 'manualUc';
        } else if (viewMode === 'uc') {
            // UC mode: only include UC textarea
            return textareaId === 'manualUc';
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
                    <div class="emphasis-type" id="emphasisType">New Group</div>
                    <div class="emphasis-value" id="emphasisValue">1.0</div>
                    <div class="emphasis-controls">
                        <button class="btn-secondary emphasis-btn btn-small emphasis-up" data-action="emphasis-up" title="Increase">
                            <i class="nai-plus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn btn-small emphasis-down" data-action="emphasis-down" title="Decrease">
                            <i class="nai-minus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn btn-small emphasis-toggle" data-action="emphasis-toggle" title="Toggle Mode" style="display: none;">
                            <i class="nai-arrow-left"></i>
                        </button>
                        <div class="emphasis-actions">
                            <button class="btn-secondary emphasis-btn btn-small emphasis-apply" data-action="emphasis-apply" title="Apply (Enter)">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="btn-secondary emphasis-btn btn-small emphasis-cancel" data-action="emphasis-cancel" title="Cancel (Esc)">
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
                this.adjustEmphasis(0.1, toolbar);
            });
            upBtn.setAttribute('data-listeners-attached', 'true');
        }
        if (downBtn && !downBtn.hasAttribute('data-listeners-attached')) {
            downBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.adjustEmphasis(-0.1, toolbar);
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
                        window.emphasisEditingValue = integerValue;
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
    
    addDirectEmphasisKeyboardListener(textarea, toolbar) {        
        // Add a separate listener for direct emphasis application when NOT in emphasis mode
        const directEmphasisHandler = (e) => {
            // Early return for non-numeric keys to improve efficiency
            if (e.key < '0' || e.key > '9' || (e.altKey && (e.key === '™' || e.key === '¡'))) {
                return;
            }
            
            // Only handle when NOT in emphasis mode and textarea is focused
            if (toolbar.classList.contains('emphasis-mode') || document.activeElement !== textarea) {
                return;
            }
            
            // Check if there's selected text and apply emphasis directly
            if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
                e.preventDefault(); // Only prevent default when we're actually doing something
                
                // Handle alt + number for negative values
                const isAltPressed = e.altKey;
                
                let numericValue = (e.key === '™') ? 1 : (e.key === '¡') ? 2 : parseInt(e.key);
                
                // Check for second number input within 500ms for decimal values
                const now = Date.now();
                const lastNumberTime = toolbar.lastNumberTime || 0;
                const lastNumberValue = toolbar.lastNumberValue || 0;
                
                if (now - lastNumberTime < 500 && lastNumberValue >= 0 && lastNumberValue <= 9) {
                    // Second number within 500ms - use as decimal
                    numericValue = lastNumberValue + (numericValue / 10);
                }
                
                // Apply alt modifier for negative values
                if (isAltPressed) {
                    numericValue = -numericValue;
                }
                
                // Store current number for potential decimal input
                toolbar.lastNumberTime = now;
                toolbar.lastNumberValue = parseInt(e.key);
                
                // Clear decimal state after 500ms
                setTimeout(() => {
                    if (toolbar.lastNumberTime === now) {
                        toolbar.lastNumberValue = null;
                    }
                }, 500);
                                
                if (window.applyEmphasisDirectly) {
                    // Auto-detect emphasis mode based on context
                    const currentMode = this.detectEmphasisMode(textarea, textarea.selectionStart, textarea.selectionEnd);
                    const result = window.applyEmphasisDirectly(textarea, numericValue, currentMode);

                    if (result && result.success) {
                        // Update the emphasis value for future use
                        window.emphasisEditingValue = numericValue;
                        this.updateEmphasisDisplay(toolbar);
                        
                        // Reselect the emphasized text so user can see what was emphasized
                        setTimeout(() => {
                            if (result.start !== undefined && result.end !== undefined) {
                                textarea.setSelectionRange(result.start, result.end);
                            }
                        }, 10);
                        
                        return;
                    }
                }
            }
            // If no text selected, don't prevent default - allow normal typing
        };
        
        // Store the handler reference for cleanup
        toolbar.directEmphasisKeydownHandler = directEmphasisHandler;
        textarea.addEventListener('keydown', directEmphasisHandler);
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
        const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/g;
        let emphasisMatch;
        
        while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
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
        
        // Remove emphasis mode keyboard listener only
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
}

// Initialize the toolbar manager when the DOM is ready
window.wsClient.registerInitStep(37, 'Initializing Prompt Toolbar', async () => {
    window.promptTextareaToolbar = new PromptTextareaToolbar();
    
    // Expose reset method globally for other components to use
    window.resetInlineSearch = () => {
        if (window.promptTextareaToolbar) {
            window.promptTextareaToolbar.resetAllSearchStates();
        }
    };
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