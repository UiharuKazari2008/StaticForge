// datasetTagToolbar.js
// Dataset tag toolbar for hierarchical tag selection

let datasetTagToolbar = null;
let currentTarget = null;
let currentPath = [];
let selectedTags = [];
let dropdowns = [];
let allCategories = [];
let datasetTagToolbarKeyboardScopeWired = false;
let currentActiveDropdown = 0; // Track which dropdown is currently active for keyboard nav
let lastSelectedPath = []; // Track the path we came from for Left navigation
// Tag-to-path index is now queried from server on demand
let isSearchMode = false; // Track if we're in search mode
let searchResults = []; // Current search results
let isNavigating = false; // Track if we're in the middle of navigation
let loadingDropdowns = new Set(); // Track which dropdowns are loading
let isInitializing = false; // Track if we're in initial loading state
let datasetTagSearchTimeout = null;
const datasetTagSearchDebounceMs = 350;

// contextMenu.detachClickMenuFromElement: public/scripts/comp/contextMenu.js
function teardownDatasetTagDropdownLevelsFrom(fromLevel) {
    for (let i = dropdowns.length - 1; i >= fromLevel; i--) {
        if (dropdowns[i] && dropdowns[i].button) contextMenu.detachClickMenuFromElement(dropdowns[i].button);
    }
}

function removeDatasetTagDropdownWrappersFrom(fromLevel) {
    for (let i = dropdowns.length - 1; i >= fromLevel; i--) {
        const entry = dropdowns[i];
        if (entry && entry.wrapper) {
            entry.wrapper.remove();
        }
    }
}

function teardownAllDatasetTagDropdowns() {
    teardownDatasetTagDropdownLevelsFrom(0);
}

// Helper function to update dropdown button states based on loading
function updateDropdownButtonStates() {
    dropdowns.forEach((dropdown, index) => {
        if (dropdown && dropdown.button) {
            // Disable buttons if we're loading or initializing
            if (isInitializing || isNavigating) {
                dropdown.button.disabled = true;
            } else {
                dropdown.button.disabled = false;
            }
        }
    });
}

let _datasetTagWsConnectedHandler = null;

function wireDatasetTagWsConnected() {
    if (_datasetTagWsConnectedHandler || !window.wsClient) {
        return;
    }
    _datasetTagWsConnectedHandler = () => {
        loadDatasetTagGroups();
    };
    window.wsClient.on('connected', _datasetTagWsConnectedHandler);
}

// Initialize the dataset tag toolbar
function initializeDatasetTagToolbar() {
    createDatasetTagToolbar();
    
    // Wait for WebSocket to be available before loading data
    if (window.wsClient) {
        if (window.wsClient.isConnected()) {
            loadDatasetTagGroups();
        } else {
            wireDatasetTagWsConnected();
        }
    } else {
        // Wait for WebSocket client to be created
        const checkWebSocket = () => {
            if (window.wsClient) {
                if (window.wsClient.isConnected()) {
                    loadDatasetTagGroups();
                } else {
                    wireDatasetTagWsConnected();
                }
            } else {
                setTimeout(checkWebSocket, 100);
            }
        };
        checkWebSocket();
    }
}

// Create the dataset tag toolbar overlay
function createDatasetTagToolbar() {
    datasetTagToolbar = document.createElement('div');
    datasetTagToolbar.id = 'datasetTagToolbar';
    datasetTagToolbar.className = 'modal hidden transient tool-window on-top dataset-tag-toolbar';
    datasetTagToolbar.innerHTML = `
        <div class="dataset-tag-toolbar-content">
            <div class="dataset-tag-label">Quick Access</div>
            <div class="dataset-tag-dropdowns-container">
                <!-- Hierarchical dropdowns will be created here -->
            </div>
            <div class="dataset-tag-controls">
                <input type="text" id="datasetTagSearchInput" class="dataset-tag-search-input hidden" placeholder="Find Tag"/>
                <div class="dataset-tag-loading-spinner">
                    <i class="fas fa-spinner-third fa-spin"></i>
                </div>
                <button class="btn-secondary dataset-tag-reset-btn" title="Reset"><i class="nai-undo"></i></button>
                <button class="btn-secondary dataset-tag-close" title="Close"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `;
    
    document.body.appendChild(datasetTagToolbar);

    wireDatasetTagToolbarKeyboardScope();
    
    // Add event listeners
        datasetTagToolbar.addEventListener('keydown', handleDatasetTagToolbarKeydown);
        const resetBtn = datasetTagToolbar.querySelector('.dataset-tag-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', handleReset);
        }
        const closeBtn = datasetTagToolbar.querySelector('.dataset-tag-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', hideDatasetTagToolbar);
        }
}

// Load dataset tag groups from server via WebSocket
async function loadDatasetTagGroups() {
    if (isInitializing) return; // Prevent multiple simultaneous initializations
    
    isInitializing = true;
    showLoadingSpinner();
    updateDropdownButtonStates();
    
    try {
        // Check if WebSocket client is available and connected
        if (window.wsClient && window.wsClient.isConnected()) {
            // Use WebSocket to get top-level categories - send a wildcard query
            const result = await window.wsClient.searchDatasetTags('*', []);
            if (result && result.results) {
                // Store the results for initial display
                allCategories = result.results;
                
                createDropdowns();
            }
        } else {
            console.warn('WebSocket client not available or not connected');
        }
    } catch (error) {
        console.error('Error loading dataset tag groups:', error);
    } finally {
        isInitializing = false;
        hideLoadingSpinner();
        updateDropdownButtonStates();
    }
}

// Show the dataset tag toolbar
function showDatasetTagToolbar() {
    if (!datasetTagToolbar) {
        initializeDatasetTagToolbar();
    }
    
    // Get the currently focused textarea
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
        currentTarget = activeElement;
    } else {
        // Default to manual prompt textarea
        currentTarget = document.getElementById('manualPrompt');
    }
    
    if (!currentTarget) {
        console.error('No valid target found for dataset tag toolbar');
        return;
    }
    
    // Reset state
    currentPath = [];
    selectedTags = [];
    dropdowns = [];
    isInitializing = false;
    
    // Show loading spinner immediately
    showLoadingSpinner();
    
    // Position the toolbar
    positionToolbar();

    // Show the toolbar
    // openModal, assignModalZIndex — public/scripts/comp/modalUtils.js
    openModal(datasetTagToolbar);
    assignModalZIndex(datasetTagToolbar);
    
    // Load categories and create dropdowns
    loadDatasetTagGroups().then(() => {
        // Try to auto-navigate based on cursor position after initial load
        setTimeout(() => {
            autoNavigateFromCursor();
        }, 100);
    });
}

// Hide the dataset tag toolbar
function hideDatasetTagToolbar() {
    if (!datasetTagToolbar) return;

    if (contextMenu.isOpen && datasetTagToolbar.contains(contextMenu.currentTarget)) contextMenu.hideMenu({ instant: true });
    teardownAllDatasetTagDropdowns();
    currentTarget = null;
    currentPath = [];
    selectedTags = [];
    dropdowns = [];
    currentActiveDropdown = 0;
    isInitializing = false;
    hideLoadingSpinner();

    // closeModal — public/scripts/comp/modalUtils.js
    closeModal(datasetTagToolbar);
}

// Create hierarchical dropdowns
function createDropdowns() {
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    teardownAllDatasetTagDropdowns();
    container.innerHTML = '';
    container.classList.remove('hidden'); // Ensure dropdowns are visible
    dropdowns = [];
    
    // Create first dropdown for top-level categories
    // For the initial dropdown, we don't have main tags yet since we're at the root level
    createDropdown(container, 0, allCategories, []);
    
    // Don't auto-open the first dropdown - wait for auto-navigation or user interaction
    // The dropdown will be disabled until data is ready
}

/** One level of the path: a wrapper holding the level's button (its click menu is attached by the caller). */
function createDatasetTagLevelButton(container, level, html, loading) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dataset-tag-dropdown-wrapper' + (loading ? ' loading' : '');
    wrapper.dataset.level = level;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'custom-dropdown-btn hover-show';
    button.innerHTML = html;
    wrapper.appendChild(button);
    container.appendChild(wrapper);
    return { wrapper, button };
}

// Create a category level: its button opens a click menu of the level's groups and main tags
function createDropdown(container, level, options, mainTags = []) {
    const { wrapper, button } = createDatasetTagLevelButton(container, level, `
        <span class="dataset-button-text">
            <i class="fas fa-folder-grid"></i>
        <span class="dataset-tag-dropdown-text">Select Category</span>
        </span>
        <i class="fas fa-slash-forward"></i>
    `);
    dropdowns[level] = { wrapper, button, options, mainTags };
    attachDatasetTagLevelMenu(level);
}

function datasetTagMainKeyPrettyName() {
    const mainKey = currentPath[0] || '';
    const mainCategory = mainKey && allCategories ? allCategories.find(cat => cat.name === mainKey) : null;
    if (mainCategory && mainCategory.prettyName) return mainCategory.prettyName;
    return mainKey ? (mainKey.charAt(0).toUpperCase() + mainKey.slice(1)) : '';
}

function datasetTagRowContent(icon, label, itemCount, description) {
    const count = itemCount !== undefined ? `<div class="dataset-tag-item-count badge">${itemCount}</div>` : '';
    const desc = description ? ` <span class="dataset-tag-description">${description}</span>` : '';
    return `<div class="dataset-tag-option"><div class="dataset-tag-option-container">`
        + `<div class="dataset-tag-name"><i class="fas ${icon}"></i><span>${label}</span></div>${count}</div>${desc}</div>`;
}

/** Menu sections for a category level: its groups, then its main tags (inserted directly). */
function datasetTagLevelMenuSections(level) {
    const entry = dropdowns[level];
    const options = entry.options || [];
    const mainTags = entry.mainTags || [];
    const groupRows = options.map((option) => ({
        action: 'dataset-tag-open',
        value: option.name,
        highlighted: currentPath[level] === option.name,
        content: datasetTagRowContent(option.icon || 'fas fa-folder',
            option.prettyName || option.name.charAt(0).toUpperCase() + option.name.slice(1),
            option.itemCount, option.description)
    }));
    const mainRows = mainTags.map((tag) => ({
        action: 'dataset-tag-insert',
        value: tag.name,
        content: datasetTagRowContent(tag.icon || 'fas fa-tag', tag.prettyName, tag.itemCount, tag.description)
    }));
    if (!groupRows.length) return [{ type: 'list', items: mainRows }];
    const sections = [{ type: 'list', title: datasetTagMainKeyPrettyName() || 'Categories', items: groupRows }];
    if (mainRows.length) sections.push({ type: 'list', title: 'Main Tags', items: mainRows });
    return sections;
}

/** Menu sections for the final level: the tags at this path. */
function datasetTagTagMenuSections(level) {
    return [{
        type: 'list',
        title: datasetTagMainKeyPrettyName() || 'Tags',
        items: (dropdowns[level].options || []).map((tag) => ({
            action: 'dataset-tag-insert',
            value: tag,
            highlighted: selectedTags[0] === tag,
            content: datasetTagRowContent('fa-tag', tag)
        }))
    }];
}

/** Each level's click menu. Right drills in (or inserts a tag and stays), Left backs out a level. */
function attachDatasetTagLevelMenu(level) {
    const entry = dropdowns[level];
    const config = {
        position: 'anchor',
        anchorAlign: 'start',
        maxHeight: 420,
        sections: [],
        beforeShow: () => {
            currentActiveDropdown = level;
            config.sections = entry.isTagDropdown ? datasetTagTagMenuSections(level) : datasetTagLevelMenuSections(level);
        },
        onAction: (action, target, item) => {
            if (isInitializing || isNavigating || !item) return;
            if (action === 'dataset-tag-insert') selectDatasetTag(item.value, level);
            else if (action === 'dataset-tag-open') handleSelectOption(level, item.value);
        },
        onNavigateRight: (item) => {
            if (isInitializing || isNavigating || !item) return;
            if (item.action === 'dataset-tag-insert') {
                handleTagNavigateRight(level, item.value);
                return;
            }
            contextMenu.hideMenu({ instant: true });
            handleNavigateRight(level, item.value);
        },
        onNavigateLeft: () => {
            if (isInitializing || isNavigating) return;
            contextMenu.hideMenu({ instant: true });
            handleNavigateLeft(level);
        }
    };
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(entry.button, config);
}

/** Open a level's menu from the keyboard flow, the keyboard row on focusValue when given. */
function openDatasetTagLevelMenu(level, focusValue) {
    const entry = dropdowns[level];
    if (!entry || !entry.button || entry.button.disabled || entry.isLoading) return;
    currentActiveDropdown = level;
    // contextMenu.openClickMenu: public/scripts/comp/contextMenu.js
    contextMenu.openClickMenu(entry.button, focusValue);
}

// Select a dropdown option
async function selectDropdownOption(option, level) {
    // Update current path
    currentPath[level] = option.name;
    currentPath = currentPath.slice(0, level + 1);
    
    // Update dropdown button text
    const dropdown = dropdowns[level];
    if (dropdown && dropdown.button) {
        const textElement = dropdown.button.querySelector('.dataset-tag-dropdown-text');
        if (textElement) {
            textElement.textContent = option.prettyName || option.name;
        }
    }
    
    // Clear all subsequent dropdowns and paths
    teardownDatasetTagDropdownLevelsFrom(level + 1);
    removeDatasetTagDropdownWrappersFrom(level + 1);
    
    // Remove dropdowns from array and clear current path beyond this level
    dropdowns.splice(level + 1);
    currentPath = currentPath.slice(0, level + 1);
    
    // If this is a group with children, create next dropdown
    if (option.hasChildren) {
        await createNextDropdown(level + 1, option.path);
    } else if (option.isTagArray) {
        // This is a tag array, create final dropdown for tag selection
        await createTagSelectionDropdown(level + 1, option.path);
    } else {
        // This is a group with only "main" array, go directly to the main tags
        const mainPath = [...option.path, 'main'];
        await createTagSelectionDropdown(level + 1, mainPath);
    }
}

// Create next dropdown in hierarchy
async function createNextDropdown(level, path) {
    // Show loading spinner
    showLoadingSpinner();
    updateDropdownButtonStates();
    
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
            
            teardownDatasetTagDropdownLevelsFrom(level);
            removeDatasetTagDropdownWrappersFrom(level);
            
            // Remove dropdowns from array
            dropdowns.splice(level);
            
            // Create loading dropdown first
            createLoadingDropdown(container, level);
            
            // Fetch data from server
            const result = await window.wsClient.searchDatasetTags('*', path);
            
            // Remove loading dropdown
            const loadingDropdown = container.querySelector(`[data-level="${level}"]`);
            if (loadingDropdown) {
                loadingDropdown.remove();
            }
            loadingDropdowns.delete(level);
            
            if (result && result.results) {
                // Create new dropdown with main tags
                createDropdown(container, level, result.results, result.mainTags || []);
                
                // Auto-focus the new dropdown if it was created via keyboard navigation
                currentActiveDropdown = level;
                setTimeout(() => openDatasetTagLevelMenu(level), 50);
            }
        }
    } catch (error) {
        console.error('Error creating next dropdown:', error);
        // Remove loading state on error
        const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
        const loadingDropdown = container.querySelector(`[data-level="${level}"]`);
        if (loadingDropdown) {
            loadingDropdown.remove();
        }
        loadingDropdowns.delete(level);
    } finally {
        hideLoadingSpinner();
        updateDropdownButtonStates();
    }
}

// Create final dropdown for tag selection
async function createTagSelectionDropdown(level, path) {
    // Show loading spinner
    showLoadingSpinner();
    updateDropdownButtonStates();
    
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
            
            teardownDatasetTagDropdownLevelsFrom(level);
            removeDatasetTagDropdownWrappersFrom(level);
            
            // Remove dropdowns from array
            dropdowns.splice(level);
            
            // Create loading dropdown first
            createLoadingDropdown(container, level);
            
            // Fetch data from server
            const result = await window.wsClient.getTagsForPath(path);
            
            // Remove loading dropdown
            const loadingDropdown = container.querySelector(`[data-level="${level}"]`);
            if (loadingDropdown) {
                loadingDropdown.remove();
            }
            loadingDropdowns.delete(level);
            
            if (result && result.tags) {
                // Create tag selection dropdown
                createTagDropdown(container, level, result.tags, path);
                
                // Auto-focus the new tag dropdown if it was created via keyboard navigation
                currentActiveDropdown = level;
                setTimeout(() => openDatasetTagLevelMenu(level), 50);
            } else if (Array.isArray(result)) {
                // Handle case where result is an array directly (e.g., allTextReplacements)
                createTagDropdown(container, level, result, path);
                
                // Auto-focus the new tag dropdown if it was created via keyboard navigation
                currentActiveDropdown = level;
                setTimeout(() => openDatasetTagLevelMenu(level), 50);
            } else {
                console.warn('No tags found in result:', result);
            }
        }
    } catch (error) {
        console.error('Error creating tag selection dropdown:', error);
        // Remove loading state on error
        const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
        const loadingDropdown = container.querySelector(`[data-level="${level}"]`);
        if (loadingDropdown) {
            loadingDropdown.remove();
        }
        loadingDropdowns.delete(level);
    } finally {
        hideLoadingSpinner();
        updateDropdownButtonStates();
    }
}

// Create a loading dropdown placeholder
function createLoadingDropdown(container, level) {
    const { wrapper, button } = createDatasetTagLevelButton(container, level, `
        <span class="dataset-button-text">
            <i class="fas fa-spinner-third fa-spin"></i>
            <span class="dataset-tag-dropdown-text">Loading...</span>
        </span>
    `, true);
    button.disabled = true;
    dropdowns[level] = { wrapper, button, options: [], mainTags: [], isLoading: true };

    // Mark as loading
    loadingDropdowns.add(level);
}

// Create the final level: its click menu lists the tags at this path
function createTagDropdown(container, level, tags, path) {
    const { wrapper, button } = createDatasetTagLevelButton(container, level, `
        <span class="dataset-button-text">
        <i class="fas fa-plus"></i>
        <span class="dataset-tag-dropdown-text">Select Tag</span>
        </span>
    `);
    dropdowns[level] = { wrapper, button, options: tags, isTagDropdown: true };
    attachDatasetTagLevelMenu(level);
}

// Select a tag from the dataset tag toolbar
function selectDatasetTag(tag, level) {
    selectedTags = [tag];
    
    // Update dropdown button text if dropdown exists
    const dropdown = dropdowns[level];
    if (dropdown && dropdown.button) {
        const textElement = dropdown.button.querySelector('.dataset-tag-dropdown-text');
        if (textElement) {
            textElement.textContent = tag;
        }
    }
    
    // Automatically insert the tag and close toolbar
    insertTagIntoTextarea(tag);
    hideDatasetTagToolbar();
}

// Handle reset button click
function handleReset() {
    // Show loading spinner
    showLoadingSpinner();
    updateDropdownButtonStates();
    
    currentPath = [];
    selectedTags = [];
    
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    teardownAllDatasetTagDropdowns();
    container.innerHTML = '';
    dropdowns = [];
    
    // Recreate first dropdown
    createDropdown(container, 0, allCategories, []);
    
    // Hide loading spinner after a short delay to ensure UI updates
    setTimeout(() => {
        hideLoadingSpinner();
        updateDropdownButtonStates();
    }, 100);
}

// Handle toolbar keydown events
function handleDatasetTagToolbarKeydown(event) {
    // Stop propagation to prevent conflicts with other keyboard listeners
    event.stopPropagation();
    
    switch (event.key) {
        case 'Escape':
            event.preventDefault();
            hideDatasetTagToolbar();
            break;
    }
}


// Insert tag into textarea with core functionality
function insertTagIntoTextarea(tag) {
    if (!currentTarget) {
        console.error('No current target for tag insertion');
        return;
    }
    
    try {
        // Ensure the target has focus
        currentTarget.focus();
        
        // Use our own implementation based on autocompleteUtils.js logic
        insertTagDirect(currentTarget, tag);
    } catch (error) {
        console.error('Error inserting tag:', error);
    }
}

// Direct tag insertion implementation - simple append with comma safety
function insertTagDirect(target, tagName) {
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get text before and after cursor
    const textBefore = currentValue.substring(0, cursorPosition);
    const textAfter = currentValue.substring(cursorPosition);
    
    // Determine prefix - add comma if there's content before cursor
    let prefix = '';
    if (textBefore.trim().length > 0) {
        // autocompleteUtils.js
        const atEmphasisStart = typeof isAtStartOfEmphasisGroup === 'function'
            && isAtStartOfEmphasisGroup(currentValue, cursorPosition);
        if (!atEmphasisStart) {
            // Add comma if the text before doesn't end with a comma or space
            if (!textBefore.trim().endsWith(',')) {
                prefix = ', ';
            } else if (textBefore.endsWith(',') && !textBefore.endsWith(', ')) {
                prefix = ' ';
            }
        }
    }

    // Determine suffix - add comma for safety if there's content after
    let suffix = '';
    if (textAfter.trim().length > 0) {
        const beforeClosingEmphasis = typeof isAtEndOfEmphasisGroupBefore === 'function'
            && isAtEndOfEmphasisGroupBefore(currentValue, cursorPosition);
        if (!beforeClosingEmphasis) {
            suffix = ', ';
        }
    }
    
    // Build new value
    const newValue = textBefore + prefix + tagName + suffix + textAfter;
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);

    // Position cursor after the inserted tag and suffix
    const newCursorPosition = cursorPosition + prefix.length + tagName.length + suffix.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Focus back on the target field
    target.focus();
    
    // Trigger events
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Try to call autoResize if available
    if (typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(target);
    }
    
    // Try to call emphasis highlighting if available
    if (typeof updateEmphasisHighlighting === 'function') {
        updateEmphasisHighlighting(target);
    }
}

// Auto-navigate to the tag before cursor if it exists on the server
async function autoNavigateFromCursor() {
    if (!currentTarget) return;
    
    // Only auto-navigate if we haven't already navigated somewhere
    if (currentPath.length > 0) {
        console.warn('Already navigated to a path, skipping auto-navigation');
        return;
    }
    
    // Show loading spinner
    showLoadingSpinner();
    
    const cursorPosition = currentTarget.selectionStart;
    const text = currentTarget.value;
    const textBefore = text.substring(0, cursorPosition);
    
    // Find the last tag before the cursor
    const tagMatch = textBefore.match(/([^,]+?)(?:,\s*)?$/);
    if (tagMatch) {
        const potentialTag = tagMatch[1].trim();
        
        // Query server for this tag's paths
        try {
            if (window.wsClient && window.wsClient.isConnected()) {
                
                const result = await window.wsClient.searchTags(potentialTag, true);
                
                if (result && result.results && result.results.length > 0) {
                    // Since we're using single_match: true, the first result should be the exact match
                    const exactMatch = result.results[0];
                    
                    if (exactMatch && exactMatch.paths && exactMatch.paths.length > 0) {
                        // Use the first path found
                        const targetPath = exactMatch.paths[0];
                        console.log(`Auto-navigating to tag "${potentialTag}" at path:`, targetPath);
                        
                        // Navigate to this path
                        await navigateToPath(targetPath, potentialTag);
                    } else {
                        setTimeout(() => openDatasetTagLevelMenu(0), 10);
                    }
                } else {
                    setTimeout(() => openDatasetTagLevelMenu(0), 10);
                }
            }
        } catch (error) {
            console.error('Error querying server for tag paths:', error);
        } finally {
            // Hide loading spinner
            hideLoadingSpinner();
        }
    } else {
        hideLoadingSpinner();
    }
}

// Navigate to a specific path and select a tag
async function navigateToPath(targetPath, selectTag = null) {
    if (isNavigating) {
        return; // Prevent multiple simultaneous navigations
    }
    isNavigating = true;
    
    // Show loading spinner
    showLoadingSpinner();
    updateDropdownButtonStates();
    
    try {
        // Reset current state
        currentPath = [];
        const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
        
        teardownAllDatasetTagDropdowns();
        container.innerHTML = '';
        dropdowns = [];
        
        // Build all path levels in parallel (targetPath is already known; each level only needs its parent path)
        const levelResults = await Promise.all(
            targetPath.map((_, i) => window.wsClient.searchDatasetTags('*', targetPath.slice(0, i)))
        );

        for (let i = 0; i < targetPath.length; i++) {
            const result = levelResults[i];
            
            if (result && result.results) {
                // Create dropdown for this level with main tags
                createDropdown(container, i, result.results, result.mainTags || []);
                
                // Find and select the next item in the path
                const nextItem = targetPath[i];
                
                const option = result.results.find(opt => opt.name === nextItem);
                
                if (option) {
                    currentPath[i] = option.name;
                    
                    // Update dropdown button text
                    const dropdown = dropdowns[i];
                    if (dropdown && dropdown.button) {
                        const textElement = dropdown.button.querySelector('.dataset-tag-dropdown-text');
                        if (textElement) {
                            textElement.textContent = option.prettyName || option.name;
                        }
                    }
                    
                    // If this is the last level and we have a tag to select
                    if (i === targetPath.length - 1) {
                        if (option.isTagArray || !option.hasChildren) {
                            // Create tag selection dropdown
                            const tags = await window.wsClient.getTagsForPath(targetPath);
                            if (tags && tags.tags) {
                                createTagDropdown(container, i + 1, tags.tags, targetPath);
                                
                                // Open the tag level on the specific tag if provided
                                if (selectTag) {
                                    setTimeout(() => openDatasetTagLevelMenu(i + 1, selectTag), 100);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Set active dropdown to the last one
        currentActiveDropdown = Math.max(0, dropdowns.length - 1);
        
    } catch (error) {
        console.error('Error navigating to path:', error);
    } finally {
        isNavigating = false;
        hideLoadingSpinner();
        updateDropdownButtonStates();
    }
}

// Global keyboard navigation while toolbar is open (scoped via modalListenerScope)
function handleDatasetTagToolbarGlobalKeydown(event) {
    if (!datasetTagToolbar || datasetTagToolbar.classList.contains('hidden')) return;

    if (dropdowns.length === 0) {
        return;
    }

    // Don't interfere if user is typing in an input/textarea (except our target)
    const activeElement = document.activeElement;
    if (activeElement &&
        (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') &&
        activeElement !== currentTarget &&
        !datasetTagToolbar.contains(activeElement)) {
        return;
    }

    return handleGlobalKeyboardNav(event);
}

function wireDatasetTagToolbarKeyboardScope() {
    if (!datasetTagToolbar || datasetTagToolbarKeyboardScopeWired) return;
    datasetTagToolbarKeyboardScopeWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'datasetTagToolbar.keydown',
        handler: handleDatasetTagToolbarGlobalKeydown,
        type: 'whenFocused',
        modalId: 'datasetTagToolbar',
        priority: 70,
        critical: false,
        showInOverlay: false
    });
    [
        { id: 'overlay.datasetTagToolbar.close', label: 'Close toolbar', keys: 'Esc', icon: 'fas fa-times' },
        { id: 'overlay.datasetTagToolbar.down', label: 'Next option', keys: '↓', icon: 'fas fa-chevron-down' },
        { id: 'overlay.datasetTagToolbar.up', label: 'Previous option', keys: '↑', icon: 'fas fa-chevron-up' },
        { id: 'overlay.datasetTagToolbar.select', label: 'Select option', keys: 'Enter', icon: 'fas fa-check' },
        { id: 'overlay.datasetTagToolbar.right', label: 'Next dropdown', keys: '→', icon: 'fas fa-chevron-right' },
        { id: 'overlay.datasetTagToolbar.left', label: 'Previous dropdown', keys: '←', icon: 'fas fa-chevron-left' }
    ].forEach((entry) => {
        registerKeyboardListener({
            id: entry.id,
            type: 'whenFocused',
            modalId: 'datasetTagToolbar',
            label: entry.label,
            keys: entry.keys,
            overlayIcon: entry.icon,
            overlayGroup: 'Tag Toolbar',
            overlayOnly: true,
            priority: -10
        });
    });
}

function handleGlobalKeyboardNav(event) {
    // If we're in search mode, don't handle dropdown navigation
    if (isSearchMode) {
        return;
    }
    
    // Don't handle navigation if we're loading or initializing
    if (isInitializing || isNavigating) {
        return;
    }
    
    // Don't handle navigation if we're in character detail view (enhancers list)
    const characterDetailContent = document.querySelector('.character-detail-content');
    if (characterDetailContent) {
        return;
    }
    
    const currentDropdown = dropdowns[currentActiveDropdown];
    if (!currentDropdown) return;
    
    // Don't interact if dropdown is disabled
    if (currentDropdown.button && currentDropdown.button.disabled) {
        return;
    }
    
    // An open level menu takes its own arrow / Enter keys (contextMenu.handleMenuNavigationKey); these keys open it.
    const focusValue = currentDropdown.isTagDropdown ? selectedTags[0] : currentPath[currentActiveDropdown];
    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'PageDown':
        case 'PageUp':
        case 'Home':
        case 'End':
        case 'Enter':
        case 'ArrowRight':
            openDatasetTagLevelMenu(currentActiveDropdown, focusValue);
            break;
            
        case 'ArrowLeft':
            handleNavigateLeft(currentActiveDropdown);
            break;
            
        case 'Tab':
            // Move to next dropdown if available
            if (currentActiveDropdown < dropdowns.length - 1) {
                contextMenu.hideMenu({ instant: true });
                openDatasetTagLevelMenu(currentActiveDropdown + 1);
            }
            break;
            
        case 'Escape':
            if (contextMenu.isOpen) contextMenu.hideMenu();
            else hideDatasetTagToolbar();
            break;
            
        default:
            // Letters and digits start a search
            if (!/^[a-zA-Z0-9]$/.test(event.key)) return false;
            contextMenu.hideMenu({ instant: true });
            enterSearchMode(event.key);
            break;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
}

// Position the toolbar
function positionToolbar() {
    if (!currentTarget || !datasetTagToolbar) return;
    
    const rect = currentTarget.getBoundingClientRect();
    const toolbar = datasetTagToolbar.querySelector('.dataset-tag-toolbar-content');
    
    // Position below the textarea, accounting for page scroll
    datasetTagToolbar.style.left = (rect.left + window.scrollX) + 'px';
    datasetTagToolbar.style.top = (rect.bottom + window.scrollY + 5) + 'px';
}

// Global function to show toolbar (called from keyboard shortcuts)
window.showDatasetTagToolbar = showDatasetTagToolbar;

// Global function to hide toolbar
window.hideDatasetTagToolbar = hideDatasetTagToolbar;

// Test spinner functions (for debugging)
window.testShowSpinner = showLoadingSpinner;
window.testHideSpinner = hideLoadingSpinner;

// Loading spinner functions
function showLoadingSpinner() {
    if (!datasetTagToolbar) return;
    
    const spinner = datasetTagToolbar.querySelector('.dataset-tag-loading-spinner');
    if (spinner) {
        spinner.classList.remove('hidden');
    }
}

function hideLoadingSpinner() {
    if (!datasetTagToolbar) return;
    
    const spinner = datasetTagToolbar.querySelector('.dataset-tag-loading-spinner');
    if (spinner) {
        spinner.classList.add('hidden');
    }
} 

// Search mode functions
function enterSearchMode(initialQuery = '') {
    isSearchMode = true;
    searchResults = [];
    
    // Hide all dropdowns
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    if (container) {
        container.classList.add('hidden');
    }
    
    // Show and focus the search input
    const searchInput = document.getElementById('datasetTagSearchInput');
    if (searchInput) {
        searchInput.classList.remove('hidden');
        searchInput.value = initialQuery;
        searchInput.focus();
        
        // If we have an initial query, trigger search immediately
        if (initialQuery) {
            // Set cursor position to end of input
            searchInput.setSelectionRange(initialQuery.length, initialQuery.length);
            // Trigger search input event to start searching
            setTimeout(() => {
                const inputEvent = new Event('input', { bubbles: true });
                searchInput.dispatchEvent(inputEvent);
            }, 10);
        }
        
        // Add search input listeners if not already added
        if (!searchInput.hasAttribute('data-listeners-added')) {
            searchInput.addEventListener('input', handleSearchInput);
            searchInput.addEventListener('keydown', (e) => {
                e.stopPropagation(); // Prevent global handler from interfering
                handleSearchKeydown(e);
            });
            searchInput.setAttribute('data-listeners-added', 'true');
        }
    }
}

function exitSearchMode() {
    isSearchMode = false;
    searchResults = [];
    
    // Hide search input
    const searchInput = document.getElementById('datasetTagSearchInput');
    if (searchInput) {
        searchInput.classList.add('hidden');
        searchInput.value = '';
    }
    
    // Hide search results dropdown
    hideSearchResults();
    
    // Show dropdowns again
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    if (container) {
        container.classList.remove('hidden');
    }
}

async function handleSearchInput(event) {
    const query = event.target.value.toLowerCase().trim();
    
    // Allow single character searches (useful when typing any letter to start search)
    if (query.length < 1) {
        clearTimeout(datasetTagSearchTimeout);
        searchResults = [];
        hideSearchResults();
        return;
    }
    
    clearTimeout(datasetTagSearchTimeout);
    datasetTagSearchTimeout = setTimeout(() => runDatasetTagSearch(query), datasetTagSearchDebounceMs);
}

async function runDatasetTagSearch(query) {
    // Query server for matching tags
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            // Show loading spinner
            showLoadingSpinner();
            
            const result = await window.wsClient.searchTags(query, false); // Use false for regular search
            
            if (result && result.results) {
                searchResults = result.results;
                showSearchResults();
            } else {
                searchResults = [];
                hideSearchResults();
            }
        }
    } catch (error) {
        console.error('Error searching tags on server:', error);
        searchResults = [];
        hideSearchResults();
    } finally {
        // Hide loading spinner
        hideLoadingSpinner();
    }
}

// An open results menu takes Up / Down / Page / Enter on a row (contextMenu.handleMenuNavigationKey).
function handleSearchKeydown(event) {
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (searchResults.length > 0) showSearchResults(searchResults[0].tag);
            break;
            
        case 'Enter':
            event.preventDefault();
            if (searchResults.length > 0) selectSearchResult(searchResults[0]);
            break;
            
        case 'Escape':
            event.preventDefault();
            exitSearchMode();
            break;
    }
}

/** Search results as a click menu under the search field; it stays open and re-renders while the field is typed in. */
function showSearchResults(focusTag) {
    const searchInput = document.getElementById('datasetTagSearchInput');
    if (!searchInput || searchResults.length === 0) {
        hideSearchResults();
        return;
    }
    if (!searchInput.dataset.clickMenu) {
        const config = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 420,
            keepOpenWhileTyping: true,
            refreshOnAction: true,
            sections: [],
            beforeShow: () => {
                config.sections = [{
                    type: 'list',
                    title: 'Search Results',
                    items: searchResults.map((result) => ({
                        action: 'dataset-tag-search-select',
                        value: result.tag,
                        content: `<div class="dataset-tag-search-result">`
                            + `<div class="dataset-tag-search-tag">${result.tag}</div>`
                            + `<div class="dataset-tag-search-path">${result.paths[0].join(' → ')}</div></div>`
                    }))
                }];
            },
            onAction: (action, target, item) => {
                const result = item && searchResults.find(r => r.tag === item.value);
                if (result) selectSearchResult(result);
            }
        };
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        contextMenu.attachClickMenuToElement(searchInput, config);
    }
    if (contextMenu.isOpen && contextMenu.currentTarget === searchInput && focusTag === undefined) {
        contextMenu.refreshOpenMenuFromConfig();
        return;
    }
    contextMenu.openClickMenu(searchInput, focusTag);
}

function hideSearchResults() {
    const searchInput = document.getElementById('datasetTagSearchInput');
    if (!searchInput || !searchInput.dataset.clickMenu) return;
    if (contextMenu.isOpen && contextMenu.currentTarget === searchInput) contextMenu.hideMenu({ instant: true });
    contextMenu.detachClickMenuFromElement(searchInput);
}

async function selectSearchResult(result) {
    showLoadingSpinner();
    exitSearchMode();
    await navigateToPath(result.paths[0], result.tag);
    // Note: hideLoadingSpinner() is called in navigateToPath() finally block
}

// Keyboard navigation handlers
function handleNavigateRight(level, value) {
    const option = dropdowns[level].options.find(opt => opt.name === value);
    if (option) {
        if (option.hasChildren) {
            // Navigate into the category
            selectDropdownOption(option, level);
        } else {
            // This is either a tag array or a group with only "main" array
            selectDropdownOption(option, level);
        }
    }
}

function handleNavigateLeft(level) {
    if (level > 0) {
        // Remember the item we're leaving
        const itemWereLeaving = currentPath[level - 1];
        
        // Go back to previous dropdown using the dropdowns array (not a full [data-level] scan)
        teardownDatasetTagDropdownLevelsFrom(level);
        removeDatasetTagDropdownWrappersFrom(level);
        
        // Remove dropdowns from array and update path
        dropdowns.splice(level);
        currentPath = currentPath.slice(0, level);
        
        // Update active dropdown index
        currentActiveDropdown = Math.max(0, level - 1);
        
        // Reopen the previous level on the item we just left
        setTimeout(() => openDatasetTagLevelMenu(currentActiveDropdown, itemWereLeaving), 50);
    }
}

function handleSelectOption(level, value, trigger) {
    const option = dropdowns[level].options.find(opt => opt.name === value);
    if (option) {
        selectDropdownOption(option, level);
    }
}

function handleTagNavigateRight(level, value) {
    // Temporarily disable autofill to prevent triggering during tag insertion
    const wasAutofillEnabled = window.isAutofillEnabled ? window.isAutofillEnabled() : true;
    if (window.setAutofillEnabled) {
        window.setAutofillEnabled(false);
    }
    
    // Insert tag but keep dropdown open
    insertTagIntoTextarea(value);
    
    // Re-enable autofill after a short delay
    setTimeout(() => {
        if (window.setAutofillEnabled) {
            window.setAutofillEnabled(wasAutofillEnabled);
        }
    }, 100);
}
