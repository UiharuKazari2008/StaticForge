// datasetTagToolbar.js
// Dataset tag toolbar for hierarchical tag selection

let datasetTagToolbar = null;
let currentTarget = null;
let currentPath = [];
let selectedTags = [];
let dropdowns = [];
let allCategories = [];
let globalKeyboardHandler = null;
let currentActiveDropdown = 0; // Track which dropdown is currently active for keyboard nav
let lastSelectedPath = []; // Track the path we came from for Left navigation
let tagToPathIndex = new Map(); // Fast lookup: tag name -> array of paths
let isSearchMode = false; // Track if we're in search mode
let searchResults = []; // Current search results
let selectedDatasetSearchIndex = -1; // Currently selected search result
let isNavigating = false; // Track if we're in the middle of navigation

// Helper function to remove active state from all dropdown buttons except the specified one
function removeActiveStateFromOtherDropdowns(exceptLevel = -1) {
    dropdowns.forEach((dropdown, index) => {
        if (index !== exceptLevel && dropdown && dropdown.button) {
            dropdown.button.classList.remove('active');
        }
    });
}

// Initialize the dataset tag toolbar
function initializeDatasetTagToolbar() {
    createDatasetTagToolbar();
    
    // Wait for WebSocket to be available before loading data
    if (window.wsClient) {
        // If WebSocket is already available, load data
        if (window.wsClient.isConnected()) {
            loadDatasetTagGroups();
        } else {
            // Wait for connection
            window.wsClient.on('connected', () => {
                loadDatasetTagGroups();
            });
        }
    } else {
        // Wait for WebSocket client to be created
        const checkWebSocket = () => {
            if (window.wsClient) {
                if (window.wsClient.isConnected()) {
                    loadDatasetTagGroups();
                } else {
                    window.wsClient.on('connected', () => {
                        loadDatasetTagGroups();
                    });
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
    datasetTagToolbar.className = 'dataset-tag-toolbar hidden';
    datasetTagToolbar.innerHTML = `
        <div class="dataset-tag-toolbar-content">
            <div class="dataset-tag-label">Quick Access</div>
            <div class="dataset-tag-dropdowns-container">
                <!-- Hierarchical dropdowns will be created here -->
            </div>
            <div class="dataset-tag-controls">
                <input type="text" id="datasetTagSearchInput" class="dataset-tag-search-input" placeholder="Search tags..." style="display: none;" />
                <button class="btn-secondary dataset-tag-reset-btn" title="Reset"><i class="fas fa-undo"></i></button>
                <button class="btn-secondary dataset-tag-close" title="Close"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `;
    
    document.body.appendChild(datasetTagToolbar);
    
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
    try {
        // Check if WebSocket client is available and connected
        if (window.wsClient && window.wsClient.isConnected()) {
            // Use WebSocket to get top-level categories - send a wildcard query
            const result = await window.wsClient.searchDatasetTags('*', []);
            if (result && result.results) {
                // Store the results for initial display
                allCategories = result.results;
                
                // Build tag-to-path index for fast lookups
                await buildTagToPathIndex();
                
                createDropdowns();
            }
        } else {
            console.warn('WebSocket client not available or not connected');
        }
    } catch (error) {
        console.error('Error loading dataset tag groups:', error);
    }
}

// Build index mapping tag names to their paths for fast lookup
async function buildTagToPathIndex() {
    tagToPathIndex.clear();
    console.log('Building tag-to-path index...');
    
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            await buildIndexRecursive([]);
        }
        console.log(`Tag index built with ${tagToPathIndex.size} entries`);
    } catch (error) {
        console.error('Error building tag index:', error);
    }
}

// Recursively build the tag index
async function buildIndexRecursive(path) {
    try {
        const result = await window.wsClient.searchDatasetTags('*', path);
        if (result && result.results) {
            for (const item of result.results) {
                if (item.isTagArray) {
                    // This is a tag array, get the actual tags
                    const tags = await window.wsClient.getTagsForPath(item.path);
                    if (tags && tags.tags) {
                        for (const tag of tags.tags) {
                            if (!tagToPathIndex.has(tag)) {
                                tagToPathIndex.set(tag, []);
                            }
                            tagToPathIndex.get(tag).push(item.path);
                        }
                    }
                } else if (item.hasChildren) {
                    // Recursively index children
                    await buildIndexRecursive(item.path);
                } else {
                    // This is a group with only "main" array
                    const mainPath = [...item.path, 'main'];
                    const tags = await window.wsClient.getTagsForPath(mainPath);
                    if (tags && tags.tags) {
                        for (const tag of tags.tags) {
                            if (!tagToPathIndex.has(tag)) {
                                tagToPathIndex.set(tag, []);
                            }
                            tagToPathIndex.get(tag).push(mainPath);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error in buildIndexRecursive:', error);
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
    
    // Load categories and create dropdowns
    loadDatasetTagGroups();
    
    // Try to auto-navigate based on cursor position
    setTimeout(() => {
        autoNavigateFromCursor();
    }, 1000); // Increased delay to ensure initial dropdowns are fully created
    
    // Position the toolbar
    positionToolbar();

    // Show the toolbar
    datasetTagToolbar.classList.remove('hidden');
    
    // Add global keyboard navigation
    addGlobalKeyboardHandler();
}

// Hide the dataset tag toolbar
function hideDatasetTagToolbar() {
    if (datasetTagToolbar) {
        datasetTagToolbar.classList.add('hidden');
    }
    
    // Remove global keyboard handler
    removeGlobalKeyboardHandler();
    
    currentTarget = null;
    currentPath = [];
    selectedTags = [];
    dropdowns = [];
    currentActiveDropdown = 0;
}

// Create hierarchical dropdowns
function createDropdowns() {
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    container.innerHTML = '';
    container.style.display = 'flex'; // Ensure dropdowns are visible
    dropdowns = [];
    
    // Create first dropdown for top-level categories
    // For the initial dropdown, we don't have main tags yet since we're at the root level
    createDropdown(container, 0, allCategories, []);
    
    // Only auto-open if we don't have a specific path to navigate to
    if (currentPath.length === 0) {
        // Auto-open the first dropdown and set up keyboard navigation
        currentActiveDropdown = 0;
        setTimeout(() => {
            if (dropdowns[0] && dropdowns[0].menu && dropdowns[0].button) {
                openDropdown(dropdowns[0].menu, dropdowns[0].button);
                updateSelectedOption(dropdowns[0].menu, -1); // Start with no selection
            }
        }, 100);
    }
    
}

// Create a dropdown for a specific level using existing dropdown system
function createDropdown(container, level, options, mainTags = []) {
    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.className = 'dataset-tag-dropdown-wrapper';
    dropdownWrapper.dataset.level = level;
    
    const dropdown = document.createElement('div');
    dropdown.className = 'custom-dropdown';
    
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'custom-dropdown-btn hover-show';
    button.innerHTML = `
        <span class="dataset-button-text">
            <i class="fas fa-folder-grid"></i>
        <span class="dataset-tag-dropdown-text">Select Category</span>
        </span>
        <i class="fas fa-slash-forward"></i>
    `;
    
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.style.display = 'none';
    
    dropdown.appendChild(button);
    dropdown.appendChild(menu);
    dropdownWrapper.appendChild(dropdown);
    container.appendChild(dropdownWrapper);
    
    // Store dropdown reference
    dropdowns[level] = {
        wrapper: dropdownWrapper,
        dropdown: dropdown,
        button: button,
        menu: menu,
        options: options,
        mainTags: mainTags
    };
    
    // Setup dropdown using existing system with keyboard navigation
    setupDropdown(dropdown, button, menu, (selectedValue) => {
        renderDropdownOptions(level, options, mainTags);
    }, () => currentPath[level] || '', {
        enableKeyboardNav: true,
        enableRightKey: true,
        onNavigateRight: (value, group) => handleNavigateRight(level, value),
        onNavigateLeft: () => handleNavigateLeft(level),
        onSelectOption: (value, group, trigger) => handleSelectOption(level, value, trigger)
    });
    
    // Initial render of dropdown options
    renderDropdownOptions(level, options, mainTags);
    
}

// Render dropdown options using existing system
function renderDropdownOptions(level, options, mainTags = []) {
    const dropdown = dropdowns[level];
    if (!dropdown) return;
    
    // Get the main key from the current path (first level)
    const mainKey = currentPath[0] || '';
    let mainKeyPrettyName = mainKey ? (mainKey.charAt(0).toUpperCase() + mainKey.slice(1)) : '';
    
    // Try to get the pretty name from allCategories if available
    if (mainKey && allCategories) {
        const mainCategory = allCategories.find(cat => cat.name === mainKey);
        if (mainCategory && mainCategory.prettyName) {
            mainKeyPrettyName = mainCategory.prettyName;
        }
    }
    
    // Build groups array
    const groups = [];
    
    // If we only have main tags and no regular options, show them without a group header
    if (mainTags.length > 0 && options.length === 0) {
        groups.push({
            group: '',
            options: mainTags.map(tag => ({
                value: tag.name,
                label: tag.prettyName,
                description: tag.description,
                itemCount: tag.itemCount,
                hasChildren: tag.hasChildren,
                path: tag.path,
                icon: tag.icon,
                isMainTag: true
            }))
        });
    } else {
        
        // Add regular options
        if (options.length > 0) {
            groups.push({
                group: mainKeyPrettyName || 'Categories',
                options: options.map(option => ({
                    value: option.name,
                    label: option.prettyName || option.name.charAt(0).toUpperCase() + option.name.slice(1),
                    description: option.description,
                    itemCount: option.itemCount,
                    hasChildren: option.hasChildren,
                    path: option.path,
                    icon: option.icon
                }))
            });
        }
        // Add main tags at the top if they exist (with other options)
        if (mainTags.length > 0) {
            groups.push({
                group: 'Main Tags',
                options: mainTags.map(tag => ({
                    value: tag.name,
                    label: tag.prettyName,
                    description: tag.description,
                    itemCount: tag.itemCount,
                    hasChildren: tag.hasChildren,
                    path: tag.path,
                    icon: tag.icon,
                    isMainTag: true
                }))
            });
        }
    }
    
    renderGroupedDropdown(
        dropdown.menu,
        groups,
        (value, group) => {
            // Handle main tags differently - they should be inserted directly
            const mainTag = mainTags.find(tag => tag.name === value);
            if (mainTag && mainTag.isMainTag) {
                insertTagIntoTextarea(value);
                hideDatasetTagToolbar();
                return;
            }
            
            // Handle regular options normally
            selectDropdownOption(options.find(opt => opt.name === value), level);
        },
        () => closeDropdown(dropdown.menu, dropdown.button),
        currentPath[level] || '',
        (opt, group) => {
            // Use icon from option data if available, otherwise fall back to default icons
            let icon = 'fas fa-folder';
            if (opt.icon) {
                icon = opt.icon;
            } else if (opt.hasChildren) {
                icon = 'fas fa-folder';
            } else if (opt.isMainTag) {
                icon = 'fas fa-tag'; // Use tag icon for main tags
            }
            
            const description = opt.description ? ` <span class="dataset-tag-description">${opt.description}</span>` : '';
            return `
            <div class="dataset-tag-option">
            <div class="dataset-tag-option-container">
                <div class="dataset-tag-name">
                    <i class="${icon}"></i>
                    <span>${opt.label}</span>
                </div>
                <div class="dataset-tag-item-count badge">${opt.itemCount}</div>
            </div>${description}</div>`;
        }
    );
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
    
    // Close dropdown and remove active state from button
    if (dropdown && dropdown.menu) {
        dropdown.menu.style.display = 'none';
        if (dropdown.button) {
            dropdown.button.classList.remove('active');
        }
    }
    
    // Clear all subsequent dropdowns and paths
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    const existingDropdowns = container.querySelectorAll(`[data-level]`);
    existingDropdowns.forEach(d => {
        const dropdownLevel = parseInt(d.dataset.level);
        if (dropdownLevel > level) {
            d.remove();
        }
    });
    
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
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            const result = await window.wsClient.searchDatasetTags('*', path);
            if (result && result.results) {
                const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
                
                // Remove any existing dropdowns at this level and beyond
                const existingDropdowns = container.querySelectorAll(`[data-level]`);
                existingDropdowns.forEach(d => {
                    const dropdownLevel = parseInt(d.dataset.level);
                    if (dropdownLevel >= level) {
                        d.remove();
                    }
                });
                
                // Remove dropdowns from array
                dropdowns.splice(level);
                
                // Create new dropdown with main tags
                createDropdown(container, level, result.results, result.mainTags || []);
                
                // Remove active state from all previous dropdown buttons
                removeActiveStateFromOtherDropdowns(level);
                
                // Auto-focus the new dropdown if it was created via keyboard navigation
                currentActiveDropdown = level;
                setTimeout(() => {
                    if (dropdowns[level] && dropdowns[level].menu && dropdowns[level].button) {
                        openDropdown(dropdowns[level].menu, dropdowns[level].button);
                        updateSelectedOption(dropdowns[level].menu, -1);
                    }
                }, 50);
            }
        }
    } catch (error) {
        console.error('Error creating next dropdown:', error);
    }
}

// Create final dropdown for tag selection
async function createTagSelectionDropdown(level, path) {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            const result = await window.wsClient.getTagsForPath(path);
            if (result && result.tags) {
                const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
                
                // Remove any existing dropdowns at this level and beyond
                const existingDropdowns = container.querySelectorAll(`[data-level]`);
                existingDropdowns.forEach(d => {
                    const dropdownLevel = parseInt(d.dataset.level);
                    if (dropdownLevel >= level) {
                        d.remove();
                    }
                });
                
                // Remove dropdowns from array
                dropdowns.splice(level);
                
                // Create tag selection dropdown
                createTagDropdown(container, level, result.tags, path);
                
                // Remove active state from all previous dropdown buttons
                removeActiveStateFromOtherDropdowns(level);
                
                // Auto-focus the new tag dropdown if it was created via keyboard navigation
                currentActiveDropdown = level;
                setTimeout(() => {
                    if (dropdowns[level] && dropdowns[level].menu && dropdowns[level].button) {
                        openDropdown(dropdowns[level].menu, dropdowns[level].button);
                        updateSelectedOption(dropdowns[level].menu, -1);
                    }
                }, 50);
            }
        }
    } catch (error) {
        console.error('Error creating tag selection dropdown:', error);
    }
}

// Create a dropdown specifically for tag selection
function createTagDropdown(container, level, tags, path) {
    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.className = 'dataset-tag-dropdown-wrapper';
    dropdownWrapper.dataset.level = level;
    
    const dropdown = document.createElement('div');
    dropdown.className = 'custom-dropdown';
    
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'custom-dropdown-btn hover-show';
    button.innerHTML = `
        <span class="dataset-button-text">
        <i class="fas fa-plus"></i>
        <span class="dataset-tag-dropdown-text">Select Tag</span>
        </span>
    `;
    
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.style.display = 'none';
    
    dropdown.appendChild(button);
    dropdown.appendChild(menu);
    dropdownWrapper.appendChild(dropdown);
    container.appendChild(dropdownWrapper);
    
    // Store dropdown reference
    dropdowns[level] = {
        wrapper: dropdownWrapper,
        dropdown: dropdown,
        button: button,
        menu: menu,
        options: tags,
        isTagDropdown: true
    };
    
    // Setup dropdown using existing system with keyboard navigation
    setupDropdown(dropdown, button, menu, (selectedValue) => {
        renderTagOptions(level, tags);
    }, () => selectedTags[0] || '', {
        enableKeyboardNav: true,
        enableRightKey: true,
        onNavigateRight: (value, group) => handleTagNavigateRight(level, value),
        onNavigateLeft: () => handleNavigateLeft(level),
        onSelectOption: (value, group, trigger) => handleTagSelectOption(level, value, trigger)
    });
    
    // Render the tag options
    renderTagOptions(level, tags);
}

// Render tag options using existing system
function renderTagOptions(level, tags) {
    const dropdown = dropdowns[level];
    if (!dropdown) return;
    
    // Get the main key from the current path (first level)
    const mainKey = currentPath[0] || '';
    let mainKeyPrettyName = mainKey ? (mainKey.charAt(0).toUpperCase() + mainKey.slice(1)) : '';
    
    // Try to get the pretty name from allCategories if available
    if (mainKey && allCategories) {
        const mainCategory = allCategories.find(cat => cat.name === mainKey);
        if (mainCategory && mainCategory.prettyName) {
            mainKeyPrettyName = mainCategory.prettyName;
        }
    }
    
    const groups = [{
        group: mainKeyPrettyName || 'Tags',
        options: tags.map(tag => ({
            value: tag,
            label: tag,
            description: '',
            isTag: true
        }))
    }];
    
    renderGroupedDropdown(
        dropdown.menu,
        groups,
        (value, group) => selectDatasetTag(value, level),
        () => closeDropdown(dropdown.menu, dropdown.button),
        selectedTags[0] || '',
        (opt, group) => {
            return `<div class="dataset-tag-option">
            <div class="dataset-tag-option-container">
                <div class="dataset-tag-name">
                    <i class="fas fa-tag"></i>
                    <span>${opt.label}</span>
                </div>
            </div></div>`;
        }
    );
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
    
    // Close dropdown if it exists
    if (dropdown && dropdown.menu && dropdown.button) {
    closeDropdown(dropdown.menu, dropdown.button);
    }
    
    // Automatically insert the tag and close toolbar
    insertTagIntoTextarea(tag);
    hideDatasetTagToolbar();
}



// Handle reset button click
function handleReset() {
    currentPath = [];
    selectedTags = [];
    
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    container.innerHTML = '';
    dropdowns = [];
    
    // Recreate first dropdown
    createDropdown(container, 0, allCategories, []);

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
    
    console.log('Inserting tag:', tag, 'into target:', currentTarget);
    
    try {
        // Ensure the target has focus
        currentTarget.focus();
        
        // Use our own implementation based on autocompleteUtils.js logic
        insertTagDirect(currentTarget, tag);
        
        console.log('Tag inserted successfully');
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
        // Add comma if the text before doesn't end with a comma or space
        if (!textBefore.trim().endsWith(',')) {
            prefix = ', ';
        } else if (textBefore.endsWith(',') && !textBefore.endsWith(', ')) {
            prefix = ' ';
        }
    }

    // Determine suffix - add comma for safety if there's content after
    let suffix = '';
    if (textAfter.trim().length > 0) {
        suffix = ', ';
    }
    
    // Build new value
    const newValue = textBefore + prefix + tagName + suffix + textAfter;
    target.value = newValue;

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

// Helper functions for comma placement (copied from autocompleteUtils.js)
function shouldAddCommaBefore(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const trimmed = textBeforeCursor.trim();
    
    // Don't add comma if:
    // 1. We're at the start of text
    if (trimmed === '') return false;
    
    // 2. We're at the start of an emphasis group (right after opening ::)
    if (isAtStartOfEmphasisGroup(text, cursorPosition)) return false;
    
    // 3. We're at the end of a line with : or |
    if (trimmed.endsWith(':') && !trimmed.endsWith('::')) return false;
    if (trimmed.endsWith('|')) return false;
    
    // Add comma in all other cases (including inside emphasis groups and at the end of emphasis groups)
    return true;
}

function shouldAddCommaAfter(text, cursorPosition) {
    const textAfterCursor = text.substring(cursorPosition);
    const trimmed = textAfterCursor.trim();
    
    // Don't add comma if:
    // 1. We're at the end of text
    if (trimmed === '') return false;
    
    // 2. We're at the end of an emphasis group (right before closing ::)
    if (isAtEndOfEmphasisGroupBefore(text, cursorPosition)) {
        return false;
    }
    
    // Add comma in all other cases (including inside emphasis groups)
    return true;
}

function isAtStartOfEmphasisGroup(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const trimmed = textBeforeCursor.trim();
    
    // Look for the pattern: weight:: at the end of text before cursor
    const emphasisStartPattern = /(-?\d+\.?\d*)::$/;
    const result = emphasisStartPattern.test(trimmed);
    
    // If the pattern doesn't match at the end, check if we're right after a weight:: pattern
    if (!result) {
        // Look for the last occurrence of weight:: in the text before cursor
        const lastWeightPattern = trimmed.match(/(-?\d+\.?\d*)::/g);
        if (lastWeightPattern) {
            const lastMatch = lastWeightPattern[lastWeightPattern.length - 1];
            const lastMatchIndex = trimmed.lastIndexOf(lastMatch);
            
            // Check if the cursor is right after this weight:: pattern
            if (lastMatchIndex + lastMatch.length === trimmed.length) {
                return true;
    } else {
                // Check if we're inside an emphasis group and at the start of its content
                const textAfterWeight = trimmed.substring(lastMatchIndex + lastMatch.length);
                
                // If the text after the weight:: is just whitespace or very short, 
                // we might be at the start of the emphasis group content
                if (textAfterWeight.trim().length <= 10) { // Allow for some short content
                    return true;
                }
            }
        }
    }
    
    return result;
}

function isAtEndOfEmphasisGroupBefore(text, cursorPosition) {
    const textAfterCursor = text.substring(cursorPosition);
    
    // Look for the pattern: :: right after cursor
    return textAfterCursor.trim().startsWith('::');
}

// Auto-navigate to the tag before cursor if it exists in our index
async function autoNavigateFromCursor() {
    if (!currentTarget || tagToPathIndex.size === 0) return;
    
    // Only auto-navigate if we haven't already navigated somewhere
    if (currentPath.length > 0) {
        console.log('Already navigated to a path, skipping auto-navigation');
        return;
    }
    
    const cursorPosition = currentTarget.selectionStart;
    const text = currentTarget.value;
    const textBefore = text.substring(0, cursorPosition);
    
    // Find the last tag before the cursor
    const tagMatch = textBefore.match(/([^,]+?)(?:,\s*)?$/);
    if (tagMatch) {
        const potentialTag = tagMatch[1].trim();
        
        // Check if this tag exists in our index
        if (tagToPathIndex.has(potentialTag)) {
            const paths = tagToPathIndex.get(potentialTag);
            if (paths.length > 0) {
                // Use the first path found
                const targetPath = paths[0];
                console.log(`Auto-navigating to tag "${potentialTag}" at path:`, targetPath);
                
                // Navigate to this path
                await navigateToPath(targetPath, potentialTag);
            }
        }
    }
}

// Navigate to a specific path and select a tag
async function navigateToPath(targetPath, selectTag = null) {
    if (isNavigating) return; // Prevent multiple simultaneous navigations
    
    isNavigating = true;
    try {
        // Reset current state
        currentPath = [];
        const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
        container.innerHTML = '';
        dropdowns = [];
        
        // Build path step by step
        for (let i = 0; i < targetPath.length; i++) {
            const partialPath = targetPath.slice(0, i);
            const result = await window.wsClient.searchDatasetTags('*', partialPath);
            
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
                                
                                // Remove active state from all previous dropdown buttons
                                removeActiveStateFromOtherDropdowns(i + 1);
                                
                                // Select the specific tag if provided
                                if (selectTag) {
                                    setTimeout(() => {
                                        const tagDropdown = dropdowns[i + 1];
                                        if (tagDropdown && tagDropdown.menu) {
                                            const options = tagDropdown.menu.querySelectorAll('.custom-dropdown-option');
                                            options.forEach((opt, index) => {
                                                if (opt.dataset.value === selectTag) {
                                                    updateSelectedOption(tagDropdown.menu, index);
                                                    currentActiveDropdown = i + 1;
                                                    openDropdown(tagDropdown.menu, tagDropdown.button);
                                                }
                                            });
                                        }
                                    }, 100);
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
    }
}

// Global keyboard navigation when toolbar is open
function addGlobalKeyboardHandler() {
    removeGlobalKeyboardHandler(); // Remove any existing handler
    
    globalKeyboardHandler = function(event) {
        // Only handle if toolbar is visible and we have dropdowns
        if (!datasetTagToolbar || datasetTagToolbar.classList.contains('hidden') || dropdowns.length === 0) {
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
        
        // Handle keyboard navigation
        handleGlobalKeyboardNav(event);
    };
    
    document.addEventListener('keydown', globalKeyboardHandler, true); // Use capture phase
}

function removeGlobalKeyboardHandler() {
    if (globalKeyboardHandler) {
        document.removeEventListener('keydown', globalKeyboardHandler, true);
        globalKeyboardHandler = null;
    }
}

function handleGlobalKeyboardNav(event) {
    // If we're in search mode, don't handle dropdown navigation
    if (isSearchMode) {
        return;
    }
    
    // Stop propagation to prevent conflicts
    const currentDropdown = dropdowns[currentActiveDropdown];
    if (!currentDropdown) return;
    
    // Ensure the current dropdown is open
    if (currentDropdown.menu.style.display === 'none') {
        openDropdown(currentDropdown.menu, currentDropdown.button);
    }
    
    const options = currentDropdown.menu.querySelectorAll('.custom-dropdown-option');
    if (options.length === 0) return;
    
    // Get current selected index from the dropdown
    let selectedIndex = -1;
    options.forEach((option, index) => {
        if (option.classList.contains('keyboard-selected')) {
            selectedIndex = index;
        }
    });
    
    let handled = false;
    
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            event.stopPropagation();
            selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
            updateSelectedOption(currentDropdown.menu, selectedIndex);
            handled = true;
            break;
            
        case 'ArrowUp':
            event.preventDefault();
            event.stopPropagation();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedOption(currentDropdown.menu, selectedIndex);
            handled = true;
            break;
            
        case 'PageDown':
            event.preventDefault();
            event.stopPropagation();
            if (selectedIndex === -1) {
                selectedIndex = 0;
            } else {
                selectedIndex = Math.min(selectedIndex + 10, options.length - 1);
            }
            updateSelectedOption(currentDropdown.menu, selectedIndex);
            handled = true;
            break;
            
        case 'PageUp':
            event.preventDefault();
            event.stopPropagation();
            if (selectedIndex === -1) {
                selectedIndex = 0;
            } else {
                selectedIndex = Math.max(selectedIndex - 10, 0);
            }
            updateSelectedOption(currentDropdown.menu, selectedIndex);
            handled = true;
            break;
            
        case 'Home':
            event.preventDefault();
            event.stopPropagation();
            selectedIndex = 0;
            updateSelectedOption(currentDropdown.menu, selectedIndex);
            handled = true;
            break;
            
        case 'End':
            event.preventDefault();
            event.stopPropagation();
            selectedIndex = options.length - 1;
            updateSelectedOption(currentDropdown.menu, selectedIndex);
            handled = true;
            break;
            
        case 'Enter':
            event.preventDefault();
            event.stopPropagation();
            if (selectedIndex >= 0 && options[selectedIndex]) {
                const option = options[selectedIndex];
                const value = option.dataset.value;
                
                if (currentDropdown.isTagDropdown) {
                    handleTagSelectOption(currentActiveDropdown, value, 'enter');
                } else {
                    handleSelectOption(currentActiveDropdown, value, 'enter');
                }
            }
            handled = true;
            break;
            
        case 'ArrowRight':
            event.preventDefault();
            event.stopPropagation();
            if (selectedIndex >= 0 && options[selectedIndex]) {
                const option = options[selectedIndex];
                const value = option.dataset.value;
                
                if (currentDropdown.isTagDropdown) {
                    handleTagNavigateRight(currentActiveDropdown, value);
                } else {
                    handleNavigateRight(currentActiveDropdown, value);
                }
            }
            handled = true;
            break;
            
        case 'ArrowLeft':
            event.preventDefault();
            event.stopPropagation();
            handleNavigateLeft(currentActiveDropdown);
            handled = true;
            break;
            
        case 'Tab':
            event.preventDefault();
            event.stopPropagation();
            // Move to next dropdown if available
            if (currentActiveDropdown < dropdowns.length - 1) {
                // Remove active state from current dropdown button
                removeActiveStateFromOtherDropdowns(currentActiveDropdown);
                
                currentActiveDropdown++;
                const nextDropdown = dropdowns[currentActiveDropdown];
                if (nextDropdown) {
                    openDropdown(nextDropdown.menu, nextDropdown.button);
                    updateSelectedOption(nextDropdown.menu, -1);
                }
            }
            handled = true;
            break;
            
        case 'Escape':
            event.preventDefault();
            event.stopPropagation();
            if (isSearchMode) {
                exitSearchMode();
            } else {
                hideDatasetTagToolbar();
            }
            handled = true;
            break;
            
        case 'q':
        case 'Q':
            if (!isSearchMode) {
                event.preventDefault();
                event.stopPropagation();
                enterSearchMode();
                handled = true;
            }
            break;
    }
    
    if (handled) {
        // Focus the current dropdown menu to maintain keyboard state
        setTimeout(() => {
            if (currentDropdown.menu) {
                currentDropdown.menu.focus();
            }
        }, 1);
    }
}

// Position the toolbar
function positionToolbar() {
    if (!currentTarget || !datasetTagToolbar) return;
    
    const rect = currentTarget.getBoundingClientRect();
    const toolbar = datasetTagToolbar.querySelector('.dataset-tag-toolbar-content');
    
    // Position below the textarea
    datasetTagToolbar.style.left = rect.left + 'px';
    datasetTagToolbar.style.top = (rect.bottom + 5) + 'px';
}

// Global function to show toolbar (called from keyboard shortcuts)
window.showDatasetTagToolbar = showDatasetTagToolbar;

// Global function to hide toolbar
window.hideDatasetTagToolbar = hideDatasetTagToolbar; 

// Search mode functions
function enterSearchMode() {
    isSearchMode = true;
    searchResults = [];
    selectedDatasetSearchIndex = -1;
    
    // Hide all dropdowns
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    if (container) {
        container.style.display = 'none';
    }
    
    // Show and focus the search input
    const searchInput = document.getElementById('datasetTagSearchInput');
    if (searchInput) {
        searchInput.style.display = 'block';
        searchInput.value = '';
        searchInput.focus();
        
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
    selectedDatasetSearchIndex = -1;
    
    // Hide search input
    const searchInput = document.getElementById('datasetTagSearchInput');
    if (searchInput) {
        searchInput.style.display = 'none';
        searchInput.value = '';
    }
    
    // Hide search results dropdown
    hideSearchResults();
    
    // Show dropdowns again
    const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
    if (container) {
        container.style.display = 'flex';
    }
}

function handleSearchInput(event) {
    const query = event.target.value.toLowerCase().trim();
    
    if (query.length < 2) {
        searchResults = [];
        hideSearchResults();
        return;
    }
    
    // Search through our tag index
    searchResults = [];
    for (const [tag, paths] of tagToPathIndex.entries()) {
        if (tag.toLowerCase().includes(query)) {
            searchResults.push({
                tag: tag,
                paths: paths
            });
        }
    }
    
    // Sort by relevance (exact match first, then starts with, then contains)
    searchResults.sort((a, b) => {
        const aTag = a.tag.toLowerCase();
        const bTag = b.tag.toLowerCase();
        
        if (aTag === query) return -1;
        if (bTag === query) return 1;
        if (aTag.startsWith(query) && !bTag.startsWith(query)) return -1;
        if (bTag.startsWith(query) && !aTag.startsWith(query)) return 1;
        
        return aTag.localeCompare(bTag);
    });
    
    // Limit results
    searchResults = searchResults.slice(0, 20);
    selectedDatasetSearchIndex = -1; // Don't auto-select, wait for arrow keys
    
    showSearchResults();
}

function handleSearchKeydown(event) {
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (searchResults.length > 0) {
                if (selectedDatasetSearchIndex === -1) {
                    // If nothing is selected, select the first item
                    selectedDatasetSearchIndex = 0;
                } else {
                    selectedDatasetSearchIndex = Math.min(selectedDatasetSearchIndex + 1, searchResults.length - 1);
                }
                updateSearchSelection();
            }
            break;
            
        case 'ArrowUp':
            event.preventDefault();
            if (searchResults.length > 0 && selectedDatasetSearchIndex > 0) {
                selectedDatasetSearchIndex = Math.max(selectedDatasetSearchIndex - 1, 0);
                updateSearchSelection();
            }
            break;
            
        case 'PageDown':
            event.preventDefault();
            if (searchResults.length > 0) {
                if (selectedDatasetSearchIndex === -1) {
                    selectedDatasetSearchIndex = 0;
                } else {
                    selectedDatasetSearchIndex = Math.min(selectedDatasetSearchIndex + 10, searchResults.length - 1);
                }
                updateSearchSelection();
            }
            break;
            
        case 'PageUp':
            event.preventDefault();
            if (searchResults.length > 0) {
                if (selectedDatasetSearchIndex === -1) {
                    selectedDatasetSearchIndex = 0;
                } else {
                    selectedDatasetSearchIndex = Math.max(selectedDatasetSearchIndex - 10, 0);
                }
                updateSearchSelection();
            }
            break;
            
        case 'Home':
            event.preventDefault();
            if (searchResults.length > 0) {
                selectedDatasetSearchIndex = 0;
                updateSearchSelection();
            }
            break;
            
        case 'End':
            event.preventDefault();
            if (searchResults.length > 0) {
                selectedDatasetSearchIndex = searchResults.length - 1;
                updateSearchSelection();
            }
            break;
            
        case 'Enter':
            event.preventDefault();
            if (searchResults.length > 0) {
                if (selectedDatasetSearchIndex >= 0 && searchResults[selectedDatasetSearchIndex]) {
                    // If something is selected, use that
                    const selectedResult = searchResults[selectedDatasetSearchIndex];
                    selectSearchResult(selectedResult);
                } else {
                    // If nothing is selected, click the first result
                    const firstResult = searchResults[0];
                    selectSearchResult(firstResult);
                }
            }
            break;
            
        case 'Escape':
            event.preventDefault();
            exitSearchMode();
            break;
    }
}

function showSearchResults() {
    // Remove existing results dropdown if any
    hideSearchResults();
    
    if (searchResults.length === 0) return;
    
    // Create results dropdown
    const searchDropdown = document.createElement('div');
    searchDropdown.id = 'datasetTagSearchDropdown';
    searchDropdown.className = 'custom-dropdown-menu dataset-tag-search-dropdown';
    searchDropdown.style.display = 'block';
    
    // Create grouped results
    const groups = [{
        group: 'Search Results',
        options: searchResults.map((result, index) => ({
            value: result.tag,
            label: result.tag,
            description: result.paths[0].join(' → '),
            data: result
        }))
    }];
    
    // Render using existing dropdown system
    renderGroupedDropdown(
        searchDropdown,
        groups,
        (value, group) => {
            const result = searchResults.find(r => r.tag === value);
            if (result) {
                selectSearchResult(result);
            }
        },
        () => hideSearchResults(),
        '',
        (opt, group) => {
            return `<div class="dataset-tag-search-result">
                <div class="dataset-tag-search-tag">${opt.label}</div>
                <div class="dataset-tag-search-path">${opt.description}</div>
            </div>`;
        }
    );
    
    // Position the dropdown below the search input in the controls
    const controlsContainer = datasetTagToolbar.querySelector('.dataset-tag-controls');
    controlsContainer.appendChild(searchDropdown);
    
    // Set up keyboard navigation for the dropdown
    setupSearchDropdownKeyboard();
}

function hideSearchResults() {
    const searchDropdown = document.getElementById('datasetTagSearchDropdown');
    if (searchDropdown) {
        searchDropdown.remove();
    }
}

function setupSearchDropdownKeyboard() {
    const searchDropdown = document.getElementById('datasetTagSearchDropdown');
    if (!searchDropdown) return;
    
    // Add keyboard navigation to the dropdown
    searchDropdown.addEventListener('keydown', (e) => {
        e.stopPropagation(); // Prevent global handler from interfering
        
        const options = searchDropdown.querySelectorAll('.custom-dropdown-option');
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (selectedDatasetSearchIndex === -1) {
                    // If nothing is selected, select the first item
                    selectedDatasetSearchIndex = 0;
                } else {
                    selectedDatasetSearchIndex = Math.min(selectedDatasetSearchIndex + 1, options.length - 1);
                }
                updateSearchSelection();
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                if (selectedDatasetSearchIndex <= 0) {
                    // If we're at the first item or no selection, refocus the textbox
                    const searchInput = document.getElementById('datasetTagSearchInput');
                    if (searchInput) {
                        searchInput.focus();
                        // Move cursor to end of text
                        const length = searchInput.value.length;
                        searchInput.setSelectionRange(length, length);
                    }
                } else {
                    selectedDatasetSearchIndex = Math.max(selectedDatasetSearchIndex - 1, 0);
                    updateSearchSelection();
                }
                break;
                
            case 'PageDown':
                e.preventDefault();
                if (selectedDatasetSearchIndex === -1) {
                    selectedDatasetSearchIndex = 0;
                } else {
                    selectedDatasetSearchIndex = Math.min(selectedDatasetSearchIndex + 10, options.length - 1);
                }
                updateSearchSelection();
                break;
                
            case 'PageUp':
                e.preventDefault();
                if (selectedDatasetSearchIndex === -1) {
                    selectedDatasetSearchIndex = 0;
                } else {
                    selectedDatasetSearchIndex = Math.max(selectedDatasetSearchIndex - 10, 0);
                }
                updateSearchSelection();
                break;
                
            case 'Home':
                e.preventDefault();
                selectedDatasetSearchIndex = 0;
                updateSearchSelection();
                break;
                
            case 'End':
                e.preventDefault();
                selectedDatasetSearchIndex = options.length - 1;
                updateSearchSelection();
                break;
                
            case 'Enter':
                e.preventDefault();
                if (selectedDatasetSearchIndex >= 0 && options[selectedDatasetSearchIndex]) {
                    options[selectedDatasetSearchIndex].click();
                }
                break;
                
            case 'Escape':
                e.preventDefault();
                exitSearchMode();
                break;
        }
    });
    
    // Set initial selection (but don't focus the dropdown)
    updateSearchSelection();
}

function updateSearchSelection() {
    const searchDropdown = document.getElementById('datasetTagSearchDropdown');
    if (!searchDropdown) return;
    
    const options = searchDropdown.querySelectorAll('.custom-dropdown-option');
    options.forEach((option, index) => {
        if (index === selectedDatasetSearchIndex) {
            option.classList.add('keyboard-selected');
            option.scrollIntoView({ block: 'nearest' });
        } else {
            option.classList.remove('keyboard-selected');
        }
    });
}

async function selectSearchResult(result) {
    exitSearchMode();
    
    // Navigate to the tag's path
    await navigateToPath(result.paths[0], result.tag);
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
        
        // Go back to previous dropdown
        const container = datasetTagToolbar.querySelector('.dataset-tag-dropdowns-container');
        const existingDropdowns = container.querySelectorAll(`[data-level]`);
        existingDropdowns.forEach(d => {
            const dropdownLevel = parseInt(d.dataset.level);
            if (dropdownLevel >= level) {
                d.remove();
            }
        });
        
        // Remove dropdowns from array and update path
        dropdowns.splice(level);
        currentPath = currentPath.slice(0, level);
        
        // Update active dropdown index
        currentActiveDropdown = Math.max(0, level - 1);
        
        // Remove active state from all dropdown buttons except the one we're going to
        removeActiveStateFromOtherDropdowns(currentActiveDropdown);
        
        // Focus the previous dropdown and select the item we just left
        if (dropdowns[currentActiveDropdown] && dropdowns[currentActiveDropdown].menu) {
            setTimeout(() => {
                openDropdown(dropdowns[currentActiveDropdown].menu, dropdowns[currentActiveDropdown].button);
                
                // Find and select the item we just left
                const options = dropdowns[currentActiveDropdown].menu.querySelectorAll('.custom-dropdown-option');
                let foundIndex = -1;
                options.forEach((option, index) => {
                    if (option.dataset.value === itemWereLeaving) {
                        foundIndex = index;
                    }
                });
                
                updateSelectedOption(dropdowns[currentActiveDropdown].menu, foundIndex);
            }, 50);
        }
    }
}

function handleSelectOption(level, value, trigger) {
    const option = dropdowns[level].options.find(opt => opt.name === value);
    if (option) {
        selectDropdownOption(option, level);
    }
}

function handleTagNavigateRight(level, value) {
    // Insert tag but keep dropdown open
    insertTagIntoTextarea(value);
}

function handleTagSelectOption(level, value, trigger) {
    if (trigger === 'enter') {
        // Enter closes the toolbar
        selectDatasetTag(value, level);
    } else {
        // Other selections also close the toolbar
        selectDatasetTag(value, level);
    }
}