/**
 * Renkin System Manager
 * Manages Genso (text expanders) in prompt.config.json with a visual interface
 */

let textReplacementData = {};
let originalTextReplacementData = {};
let textReplacementSearchTerm = '';
let textReplacementPaginationInfo = {
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10,
    hasNextPage: false,
    hasPrevPage: false
};

function extractBiasFromTextForDisplay(text) {
    if (!text || typeof text !== 'string') return null;
    if (!/^(-?\d+\.?\d*)::/.test(text)) {
        return null;
    }

    const autoTerminatingPattern = /^(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::)[\s\S])+?)(?=\s*-?\d+\.?\d*::|::|$)/;
    const autoMatch = text.match(autoTerminatingPattern);
    if (autoMatch) {
        return parseFloat(autoMatch[1]);
    }

    const traditionalPattern = /^(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::)[\s\S])+?)::/;
    const traditionalMatch = text.match(traditionalPattern);
    if (traditionalMatch) {
        return parseFloat(traditionalMatch[1]);
    }

    return null;
}

function hasEmphasisGroupForDisplay(text) {
    if (!text || typeof text !== 'string') return false;
    const completeGroupPattern = /^(-?\d+\.?\d*)::[\s\S]+::$/;
    if (completeGroupPattern.test(text)) return true;
    const autoTerminatingPattern = /^(-?\d+\.?\d*)::/;
    return autoTerminatingPattern.test(text);
}

function getReplacementBias(replacement) {
    if (!replacement) return null;
    if (replacement.segment_emphasis !== null && replacement.segment_emphasis !== undefined) {
        return replacement.segment_emphasis;
    }
    return extractBiasFromTextForDisplay(replacement.select_text);
}

function handleTextReplacementManagerKeydown(e) {
    const modal = document.getElementById('textReplacementManagerModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        e.stopPropagation();
        toggleTextReplacementSearch();
        return true;
    }

    if (e.target.closest('.text-replacement-manager-content')) {
        if (e.key === 'PageDown' && textReplacementPaginationInfo.currentPage < (textReplacementPaginationInfo.totalPages || 1)) {
            e.preventDefault();
            e.stopPropagation();
            textReplacementPaginationInfo.currentPage++;
            loadTextReplacements();
            return true;
        }
        if (e.key === 'PageUp' && textReplacementPaginationInfo.currentPage > 1) {
            e.preventDefault();
            e.stopPropagation();
            textReplacementPaginationInfo.currentPage--;
            loadTextReplacements();
            return true;
        }
        if (e.key === 'ArrowRight' && textReplacementPaginationInfo.currentPage < (textReplacementPaginationInfo.totalPages || 1)) {
            e.preventDefault();
            e.stopPropagation();
            textReplacementPaginationInfo.currentPage++;
            loadTextReplacements();
            return true;
        }
        if (e.key === 'ArrowLeft' && textReplacementPaginationInfo.currentPage > 1) {
            e.preventDefault();
            e.stopPropagation();
            textReplacementPaginationInfo.currentPage--;
            loadTextReplacements();
            return true;
        }
    }
}

function handleCreateTextReplacementKeydown(e) {
    const modal = document.getElementById('createTextReplacementModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hideCreateTextReplacementModal();
        return true;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        handleCreateTextReplacementSubmit();
        return true;
    }
}

function handleTextReplacementLockModalKeydown(e) {
    const modal = document.getElementById('textReplacementLockModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const closeBtn = document.getElementById('closeTextReplacementLockModalBtn');
        if (closeBtn && !closeBtn.disabled) closeBtn.click();
        else closeModal(modal);
        return true;
    }

    if (e.key === 'Enter' && !modalKeyboardSkipPrimaryEnter(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        const closeBtn = document.getElementById('closeTextReplacementLockModalBtn');
        if (closeBtn && !closeBtn.disabled) closeBtn.click();
        return true;
    }
}

let textReplacementKeyboardWired = false;

function wireTextReplacementKeyboardShortcuts() {
    if (textReplacementKeyboardWired) return;
    textReplacementKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'textReplacementManagerModal.keydown',
        handler: handleTextReplacementManagerKeydown,
        type: 'whenFocused',
        modalId: 'textReplacementManagerModal',
        priority: 75,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'createTextReplacementModal.keydown',
        handler: handleCreateTextReplacementKeydown,
        type: 'whenFocused',
        modalId: 'createTextReplacementModal',
        priority: 85,
        critical: true,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'textReplacementLockModal.keydown',
        handler: handleTextReplacementLockModalKeydown,
        type: 'whenFocused',
        modalId: 'textReplacementLockModal',
        priority: 76,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('textReplacementManagerModal', 'Text Replacements', [
        { id: 'overlay.textReplacementManager.pageDown', label: 'Next page', keys: 'Page Down', icon: 'fas fa-chevron-down' },
        { id: 'overlay.textReplacementManager.pageUp', label: 'Previous page', keys: 'Page Up', icon: 'fas fa-chevron-up' },
        { id: 'overlay.textReplacementManager.search', label: 'Search', keys: 'Ctrl+F', icon: 'fas fa-search' },
        { id: 'overlay.textReplacementManager.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
    ]);
    registerModalOverlayEntries('createTextReplacementModal', 'Text Replacements', [
        { id: 'overlay.createTextReplacement.save', label: 'Save', keys: 'Ctrl+S', icon: 'fas fa-save' },
        { id: 'overlay.createTextReplacement.close', label: 'Close', keys: 'Esc', icon: 'fas fa-times' }
    ]);
    registerModalOverlayEntries('textReplacementLockModal', 'Inspector', [
        { id: 'overlay.textReplacementLock.apply', label: 'Apply locks', keys: 'Enter', icon: 'fas fa-check' },
        { id: 'overlay.textReplacementLock.close', label: 'Close', keys: 'Esc', icon: 'fas fa-times' }
    ]);
}

// Initialize create text replacement modal
function initializeCreateTextReplacementModal() {
    const modal = document.getElementById('createTextReplacementModal');
    const closeBtn = document.getElementById('closeCreateTextReplacementBtn');
    const cancelBtn = document.getElementById('createTextReplacementCancelBtn');
    const saveBtn = document.getElementById('createTextReplacementSaveBtn');
    const typeSelect = document.getElementById('textReplacementTypeSelect');

    if (closeBtn) {
        closeBtn.addEventListener('click', hideCreateTextReplacementModal);
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideCreateTextReplacementModal);
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', handleCreateTextReplacementSubmit);
    }

    // Add event listener for add array item button
    const addArrayItemBtn = document.getElementById('addCreateArrayItemBtn');
    if (addArrayItemBtn) {
        addArrayItemBtn.addEventListener('click', addCreateArrayItem);
    }
}

// Initialize text replacement manager
function initializeTextReplacementManager() {
    const textReplacementManagerBtn = document.getElementById('textReplacementManagerBtn');
    const closeTextReplacementManagerBtn = document.getElementById('closeTextReplacementManagerBtn');
    const toggleTextReplacementSearchBtn = document.getElementById('toggleTextReplacementSearchBtn');
    const textReplacementSearch = document.getElementById('textReplacementSearch');
    const textReplacementPrevBtn = document.getElementById('textReplacementPrevBtn');
    const textReplacementNextBtn = document.getElementById('textReplacementNextBtn');

    // Event listeners
    if (textReplacementManagerBtn) {
        textReplacementManagerBtn.addEventListener('click', showTextReplacementManager);
    }
    
    if (closeTextReplacementManagerBtn) {
        closeTextReplacementManagerBtn.addEventListener('click', hideTextReplacementManager);
    }
    
    if (toggleTextReplacementSearchBtn) {
        toggleTextReplacementSearchBtn.addEventListener('click', toggleTextReplacementSearch);
    }
    
    if (textReplacementSearch) {
        textReplacementSearch.addEventListener('input', debounce(async () => {
            textReplacementPaginationInfo.currentPage = 1; // Reset to first page when searching
            textReplacementSearchTerm = textReplacementSearch.value;
            await loadTextReplacements();
        }, 300));
    }

    if (textReplacementPrevBtn) {
        textReplacementPrevBtn.addEventListener('click', async () => {
            if (textReplacementPaginationInfo.currentPage > 1) {
                textReplacementPaginationInfo.currentPage--;
                await loadTextReplacements();
            }
        });
    }

    if (textReplacementNextBtn) {
        textReplacementNextBtn.addEventListener('click', async () => {
            const totalPages = textReplacementPaginationInfo.totalPages || 1;
            if (textReplacementPaginationInfo.currentPage < totalPages) {
                textReplacementPaginationInfo.currentPage++;
                await loadTextReplacements();
            }
        });
    }

    // Initialize create text replacement modal
    initializeCreateTextReplacementModal();
    wireTextReplacementLockModalListeners();
    wireTextReplacementKeyboardShortcuts();
}

// Show text replacement manager modal
async function showTextReplacementManager() {
    const modal = document.getElementById('textReplacementManagerModal');
    if (!modal) return;
    
    await loadTextReplacements();
    renderTextReplacementList();
    openModal(modal);
}

// Hide text replacement manager modal
async function hideTextReplacementManager() {
    const modal = document.getElementById('textReplacementManagerModal');
    if (modal) {
        await closeModal(modal);
    }

    // Reset to first page and clear search
    textReplacementPaginationInfo.currentPage = 1;
    const searchInput = document.getElementById('textReplacementSearch');
    if (searchInput) {
        searchInput.value = '';
    }

    const textReplacementSearchContainer = document.getElementById('textReplacementSearchContainer');
    if (textReplacementSearchContainer) {
        textReplacementSearchContainer.classList.add('hidden');
    }
}

// Toggle text replacement search
function toggleTextReplacementSearch() {
    const toggleContainer = document.getElementById('textReplacementSearchContainer');
    if (toggleContainer) {
        toggleContainer.classList.toggle('hidden');
        const searchInput = document.getElementById('textReplacementSearch');
        if (searchInput) {
            searchInput.focus();
        }
    }
}


// Load text replacements from server
async function loadTextReplacements() {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            // Request text replacements via WebSocket with pagination and search parameters
            const result = await window.wsClient.sendMessage('get_text_replacements', {
                page: textReplacementPaginationInfo.currentPage,
                itemsPerPage: 20,
                searchTerm: textReplacementSearchTerm
            });
            
            if (result && result.textReplacements) {
                textReplacementData = { ...result.textReplacements };
                originalTextReplacementData = JSON.parse(JSON.stringify(result.textReplacements));
                
                // Update pagination info
                if (result.pagination) {
                    textReplacementPaginationInfo = { ...result.pagination };
                }

                // Update search state
                textReplacementSearchTerm = result.searchTerm || '';

                // Update search input if it exists
                const searchInput = document.getElementById('textReplacementSearch');
                if (searchInput && searchInput.value !== textReplacementSearchTerm) {
                    searchInput.value = textReplacementSearchTerm;
                }
                
                // Render the updated list
                renderTextReplacementList();
            } else {
                console.warn('No text replacements received from server');
                textReplacementData = {};
                originalTextReplacementData = {};
                textReplacementPaginationInfo = {
                    currentPage: 1,
                    totalPages: 1,
                    itemsPerPage: 20,
                    hasNextPage: false,
                    hasPrevPage: false
                };
            }
        } else {
            console.error('WebSocket connection not available');
            showGlassToast('error', null, 'Unable to load text replacements: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    } catch (error) {
        console.error('Error loading text replacements:', error);
        showGlassToast('error', null, 'Error loading text replacements', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}


// Update pagination controls
function updatePaginationControls() {
    const pageInfo = document.getElementById('textReplacementPageInfo');
    const prevBtn = document.getElementById('textReplacementPrevBtn');
    const nextBtn = document.getElementById('textReplacementNextBtn');

    if (pageInfo) {
        pageInfo.textContent = `Page ${textReplacementPaginationInfo.currentPage} of ${textReplacementPaginationInfo.totalPages} (${textReplacementPaginationInfo.totalItems} items)`;
    }

    if (prevBtn) {
        prevBtn.disabled = textReplacementPaginationInfo.currentPage <= 1;
    }

    if (nextBtn) {
        nextBtn.disabled = textReplacementPaginationInfo.currentPage >= textReplacementPaginationInfo.totalPages;
    }
}

// Render the text replacement list
function renderTextReplacementList() {
    const listContainer = document.getElementById('textReplacementList');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const pageKeys = Object.keys(textReplacementData);

    if (pageKeys.length === 0) {
        if (textReplacementPaginationInfo.totalItems === 0) {
            listContainer.innerHTML = `
                <div class="text-replacement-empty">
                    <p><i class="fas fa-search"></i> No text replacements found</p>
                </div>
            `;
        } else {
            listContainer.innerHTML = `
                <div class="text-replacement-empty">
                    <p><i class="fas fa-file"></i> No items on this page</p>
                </div>
            `;
        }
        updatePaginationControls();
        return;
    }

    pageKeys.forEach(key => {
        const value = textReplacementData[key];
        const isArray = Array.isArray(value);
        const isModified = hasChanges(key, value);
        const isNew = !originalTextReplacementData.hasOwnProperty(key);

        const itemElement = createTextReplacementItem(key, value, isArray, isModified, isNew);
        listContainer.appendChild(itemElement);
    });

    // Update pagination controls
    updatePaginationControls();

    // Scroll to top of the list container when new page is loaded
    scrollTextReplacementListToTop();
}

// Scroll text replacement list to top
function scrollTextReplacementListToTop() {
    const container = document.getElementById('textReplacementListContainer');
    if (!container) return;
    
    // If scrollbar is initialized, scroll the scrollableContent wrapper
    if (window.customScrollbar && window.customScrollbar.scrollbars.has(container)) {
        const data = window.customScrollbar.scrollbars.get(container);
        if (data && data.scrollableContent) {
            data.scrollableContent.scrollTop = 0;
        }
    }
}

// Create a text replacement item element
function createTextReplacementItem(key, value, isArray, isModified, isNew) {
    const item = document.createElement('div');
    item.className = `text-replacement-item ${isModified ? 'modified' : ''} ${isNew ? 'new-item' : ''}`;
    item.dataset.key = key;
    
    const renderFunction = isArray ? renderArrayValue : renderStringValue;
    
    item.innerHTML = `
        <div class="text-replacement-header">
            <div class="text-replacement-name">!${key}</div>
            <div class="text-replacement-actions">
                <div class="text-replacement-type ${isArray ? 'random' : ''}">${isArray ? '<i class="fas fa-dice"></i>' : '<i class="fas fa-input-text"></i>'}</div>
                <button type="button" class="btn-small btn-secondary edit-btn" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn-small btn-primary save-btn hidden" title="Save">
                    <i class="fas fa-save"></i>
                </button>
                <button type="button" class="btn-small btn-danger delete-btn" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        <div class="text-replacement-content">
            <div class="text-replacement-value-container">
                ${renderFunction(key, value)}
            </div>
        </div>
    `;
    
    // Add event listeners for header buttons
    const editBtn = item.querySelector('.edit-btn');
    const saveBtn = item.querySelector('.save-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    
    if (editBtn) {
        editBtn.addEventListener('click', () => toggleTextReplacementEditMode(key));
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveTextReplacementItem(key));
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteTextReplacement(key));
    }
    
    // Add event listener for the "Add Item" button
    const addItemBtn = item.querySelector('.text-replacement-add-item button');
    if (addItemBtn) {
        addItemBtn.addEventListener('click', () => addArrayItem(key));
    }
    
    return item;
}

// Render string value
function renderStringValue(key, value) {
    return `
        <div class="text-replacement-array-items">
            <div class="text-replacement-array-item" data-index="0">
                <div class="text-replacement-value-display">
                    <span class="text-replacement-text">${escapeHtml(value)}</span>
                </div>
            </div>
            <div class="text-replacement-add-item">
                <button class="btn-primary" type="button" title="Add Item">
                    <i class="fas fa-plus"></i> Add Item
                </button>
            </div>
        </div>
    `;
}

// Render array value
function renderArrayValue(key, value) {
    const items = value.map((item, index) => `
        <div class="text-replacement-array-item" data-index="${index}">
            <div class="text-replacement-value-display">
                <span class="text-replacement-text">${escapeHtml(item)}</span>
            </div>
        </div>
    `).join('');
    
    return `
        <div class="text-replacement-array-items">
            ${items}
            <div class="text-replacement-add-item">
                <button class="btn-primary" type="button" title="Add Item">
                    <i class="fas fa-plus"></i> Add Item
                </button>
            </div>
        </div>
    `;
}

// Toggle edit mode for a text replacement
function toggleTextReplacementEditMode(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;

    const isEditing = item.classList.contains('editing');

    if (isEditing) {
        // Exit edit mode and revert changes
        exitTextReplacementEditMode(key, true); // true = revert changes
    } else {
        // Enter edit mode
        enterTextReplacementEditMode(key);
    }
}

// Enter edit mode
function enterTextReplacementEditMode(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    item.classList.add('editing');
    
    // Convert display mode to edit mode
    convertTextReplacementToEditMode(key);
    
    // Update button icons and show/hide buttons
    const editBtn = item.querySelector('.edit-btn');
    const saveBtn = item.querySelector('.save-btn');
    
    if (editBtn) {
        editBtn.innerHTML = '<i class="fas fa-times"></i>';
        editBtn.title = 'Cancel';
        editBtn.className = 'btn-small btn-secondary edit-btn';
    }
    
    if (saveBtn) {
        saveBtn.classList.remove('hidden');
    }
    
    // Focus first input
    const firstInput = item.querySelector('input, textarea');
    if (firstInput) {
        firstInput.focus();
        firstInput.select();
    }
}

// Convert display mode to edit mode
function convertTextReplacementToEditMode(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    const value = textReplacementData[key];
    const isArray = Array.isArray(value);
    
    // Replace display spans with full textarea containers
    const arrayItems = item.querySelectorAll('.text-replacement-array-item');
    
    arrayItems.forEach((arrayItem, index) => {
        const displayDiv = arrayItem.querySelector('.text-replacement-value-display');
        
        if (displayDiv) {
            const itemValue = isArray ? value[index] : value;
            const itemType = isArray ? 'array' : 'string';
            
            // Create full textarea container
            const textareaContainer = document.createElement('div');
            textareaContainer.className = 'character-prompt-textarea-container';
            textareaContainer.innerHTML = `
                <div class="character-prompt-textarea-background"></div>
                <textarea 
                    class="form-control character-prompt-textarea prompt-textarea"
                    rows="${isArray ? '2' : '3'}"
                    data-key="${key}" 
                    data-index="${index}"
                    data-type="${itemType}"
                    placeholder="Enter text replacement value..."
                    autocapitalize="false"
                    autocorrect="false"
                    spellcheck="false"
                    data-ms-editor="false"
                >${escapeHtml(itemValue)}</textarea>
                <div class="prompt-textarea-toolbar hidden">
                    <div class="toolbar-left">
                        <span class="token-count">0 tokens</span>
                    </div>
                    <div class="toolbar-right">
                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="on" title="Toggle SmartText Autofill">
                            <i class="fas fa-lightbulb"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                            <i class="fas fa-dial"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                            <i class="fas fa-book-font"></i>
                        </button>
                    </div>
                </div>
            `;
            
            // Replace display div with textarea container
            displayDiv.replaceWith(textareaContainer);
            
            // Add remove button for array items (but not for single string items)
            // The button should be inside the array-item div, not the textarea container
            if (isArray && value.length > 1) {
                const removeButton = document.createElement('button');
                removeButton.className = 'btn-secondary remove-array-item';
                removeButton.type = 'button';
                removeButton.onclick = () => removeArrayItem(key, index);
                removeButton.title = 'Remove';
                removeButton.innerHTML = '<i class="fas fa-trash-alt"></i>';
                
                // Insert the remove button after the textarea container within the array-item
                arrayItem.appendChild(removeButton);
            }
            
            // Setup the textarea
            const textarea = textareaContainer.querySelector('textarea');
            if (textarea) {
                textarea.readOnly = false;
                textarea.addEventListener('input', () => updateTextReplacementValue(key));
                setupTextReplacementTextarea(textarea);
            }
        }
    });
}

// Convert edit mode to display mode
function convertTextReplacementToDisplayMode(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    const value = textReplacementData[key];
    const isArray = Array.isArray(value);
    
    // Replace textarea containers with display spans
    const arrayItems = item.querySelectorAll('.text-replacement-array-item');
    
    arrayItems.forEach((arrayItem, index) => {
        const textareaContainer = arrayItem.querySelector('.character-prompt-textarea-container');
        
        if (textareaContainer) {
            const textarea = textareaContainer.querySelector('textarea');
            const itemValue = textarea ? textarea.value : (isArray ? value[index] : value);
            
            // Create display div
            const displayDiv = document.createElement('div');
            displayDiv.className = 'text-replacement-value-display';
            displayDiv.innerHTML = `<span class="text-replacement-text">${escapeHtml(itemValue)}</span>`;
            
            // Replace textarea container with display div
            textareaContainer.replaceWith(displayDiv);
        }
    });
}

// Setup text replacement textarea with prompt textarea features
function setupTextReplacementTextarea(textarea) {
    // Use shared utility with custom toolbar handler
    setupEditableTextarea(textarea, handleTextReplacementToolbarAction);
}

// Handle text replacement toolbar actions
function handleTextReplacementToolbarAction(action, textarea, toolbar, event) {
    switch (action) {
        case 'quick-access':
            openTextReplacementQuickAccess(textarea);
            break;
        case 'emphasis':
            openTextReplacementEmphasisMode(textarea, toolbar);
            break;
        case 'autofill':
            // Autofill is handled by the main toolbar system
            // The button click will be handled automatically
            break;
    }
}

// Text replacement toolbar action functions
function openTextReplacementQuickAccess(textarea) {
    // Open the dataset tag toolbar for text replacements
    if (window.showDatasetTagToolbar) {
        // Ensure the textarea has focus so the toolbar can detect it
        textarea.focus();
        
        // Show the dataset tag toolbar
        window.showDatasetTagToolbar();
    }
}

function openTextReplacementEmphasisMode(textarea, toolbar) {
    if (!toolbar) return;
    
    // Use the existing emphasis editing system
    if (window.startEmphasisEditing) {
        window.startEmphasisEditing(textarea);
    }
    
    // Enter emphasis mode
    toolbar.classList.add('emphasis-mode');
    
    // Initialize emphasis mode using the existing system
    if (window.promptTextareaToolbar) {
        window.promptTextareaToolbar.initializeEmphasisMode(textarea, toolbar);
        window.promptTextareaToolbar.updateEmphasisDisplay(toolbar);
    }
    
    // Ensure textarea maintains focus for keyboard input
    setTimeout(() => textarea.focus(), 10);
}

function closeTextReplacementEmphasisMode(toolbar) {
    if (!toolbar) return;
    
    toolbar.classList.remove('emphasis-mode');
}

// Exit edit mode
function exitTextReplacementEditMode(key, revertChanges = false) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    item.classList.remove('editing');
    
    if (revertChanges) {
        // Revert to original values
        const originalValue = originalTextReplacementData[key];
        if (originalValue !== undefined) {
            textReplacementData[key] = JSON.parse(JSON.stringify(originalValue));
        }
        
        // Re-render the item to show original values
        const isArray = Array.isArray(textReplacementData[key]);
        const isModified = hasChanges(key, textReplacementData[key]);
        const isNew = !originalTextReplacementData.hasOwnProperty(key);
        
        const newItem = createTextReplacementItem(key, textReplacementData[key], isArray, isModified, isNew);
        item.replaceWith(newItem);
    } else {
        // Convert edit mode to display mode
        convertTextReplacementToDisplayMode(key);
        
        // Update button icons and show/hide buttons
        const editBtn = item.querySelector('.edit-btn');
        const saveBtn = item.querySelector('.save-btn');
        
        if (editBtn) {
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = 'Edit';
            editBtn.className = 'btn-small btn-secondary edit-btn';
        }
        
        if (saveBtn) {
            saveBtn.classList.add('hidden');
        }
    }
}

// Update text replacement value
function updateTextReplacementValue(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    // Find textareas within character-prompt-textarea-containers
    const textareas = item.querySelectorAll('.character-prompt-textarea-container textarea');
    
    if (textareas.length === 0) {
        // Fallback to old method if no new structure found
        const stringInput = item.querySelector('[data-type="string"]');
        const arrayInputs = item.querySelectorAll('[data-type="array"]');
        
        if (stringInput) {
            textReplacementData[key] = stringInput.value;
        } else if (arrayInputs.length > 0) {
            const arrayValue = Array.from(arrayInputs).map(input => input.value).filter(val => val.trim() !== '');
            textReplacementData[key] = arrayValue;
        }
    } else {
        // Use new structure
        const isArray = textareas.length > 1;
        if (isArray) {
            const arrayValue = Array.from(textareas).map(textarea => textarea.value).filter(val => val.trim() !== '');
            textReplacementData[key] = arrayValue;
        } else {
            textReplacementData[key] = textareas[0].value;
        }
    }
    
    // Mark as modified
    const isModified = hasChanges(key, textReplacementData[key]);
    item.classList.toggle('modified', isModified);
}

// Save individual text replacement item
async function saveTextReplacementItem(key) {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            // Save single text replacement via WebSocket
            const result = await window.wsClient.sendMessage('save_text_replacements', {
                textReplacements: { [key]: textReplacementData[key] }
            });
            
            if (result && result.success) {
                // Update original data for this item
                originalTextReplacementData[key] = JSON.parse(JSON.stringify(textReplacementData[key]));
                
                // Exit edit mode
                exitTextReplacementEditMode(key, false);
                
                // Re-render to remove modified indicator
                renderTextReplacementList();
                
                showGlassToast('success', null, `Text replacement "!${key}" saved successfully`, false, 3000, '<i class="fas fa-save"></i>');
            } else {
                const errorMsg = result?.error || 'Unknown error occurred';
                showGlassToast('error', null, `Failed to save text replacement: ${errorMsg}`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } else {
            showGlassToast('error', null, 'Unable to save text replacement: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    } catch (error) {
        console.error('Error saving text replacement:', error);
        showGlassToast('error', null, 'Error saving text replacement', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Add new array item
function addArrayItem(key) {
    // Convert string to array if needed
    if (!Array.isArray(textReplacementData[key]))
        textReplacementData[key] = [textReplacementData[key]];
    textReplacementData[key].push('');

    // Re-render the specific item
    const item = document.querySelector(`[data-key="${key}"]`);
    if (item) {
        const isArray = Array.isArray(textReplacementData[key]);
        const isModified = hasChanges(key, textReplacementData[key]);
        const isNew = !originalTextReplacementData.hasOwnProperty(key);

        const newItem = createTextReplacementItem(key, textReplacementData[key], isArray, isModified, isNew);

        // Preserve edit mode
        const wasEditing = item.classList.contains('editing');

        item.replaceWith(newItem);

        if (wasEditing) {
            newItem.classList.add('editing');
            convertTextReplacementToEditMode(key);

            // Update button states for edit mode
            const editBtn = newItem.querySelector('.edit-btn');
            const saveBtn = newItem.querySelector('.save-btn');

            if (editBtn) {
                editBtn.innerHTML = '<i class="fas fa-times"></i>';
                editBtn.title = 'Cancel';
                editBtn.className = 'btn-small btn-secondary edit-btn';
            }

            if (saveBtn) {
                saveBtn.classList.remove('hidden');
            }
        }

        // Focus the new item
        const newInput = newItem.querySelector(`[data-index="${textReplacementData[key].length - 1}"]`);
        if (newInput) {
            newInput.focus();
        }
    }
}

// Remove array item
function removeArrayItem(key, index) {
    if (!Array.isArray(textReplacementData[key])) return;
    
    textReplacementData[key].splice(index, 1);
    
    // Convert back to string if only one item remains
    if (textReplacementData[key].length === 1)
        textReplacementData[key] = textReplacementData[key][0];
    
    // Re-render the specific item
    const item = document.querySelector(`[data-key="${key}"]`);
    if (item) {
        const isArray = Array.isArray(textReplacementData[key]);
        const isModified = hasChanges(key, textReplacementData[key]);
        const isNew = !originalTextReplacementData.hasOwnProperty(key);
        
        const newItem = createTextReplacementItem(key, textReplacementData[key], isArray, isModified, isNew);
        
        // Preserve edit mode
        const wasEditing = item.classList.contains('editing');

        item.replaceWith(newItem);

        if (wasEditing) {
            newItem.classList.add('editing');
            convertTextReplacementToEditMode(key);

            // Update button states for edit mode
            const editBtn = newItem.querySelector('.edit-btn');
            const saveBtn = newItem.querySelector('.save-btn');

            if (editBtn) {
                editBtn.innerHTML = '<i class="fas fa-times"></i>';
                editBtn.title = 'Cancel';
                editBtn.className = 'btn-small btn-secondary edit-btn';
            }

            if (saveBtn) {
                saveBtn.classList.remove('hidden');
            }
        }
    }
}

// Delete text replacement
async function deleteTextReplacement(key) {
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete the text replacement "!${key}"?`,
        [
            { text: 'Cancel', value: false, className: 'btn-secondary' },
            { text: 'Delete', value: true, className: 'btn-danger' }
        ]
    );
    
    if (confirmed) {
        try {
            if (window.wsClient && window.wsClient.isConnected()) {
                // Send delete request via WebSocket
                const result = await window.wsClient.sendMessage('delete_text_replacement', {
                    key: key
                });
                
                if (result && result.success) {
                    // Remove from local data
                    delete textReplacementData[key];
                    renderTextReplacementList();
                    
                    showGlassToast('success', null, `Deleted text replacement "!${key}"`, false, 3000, '<i class="fas fa-trash"></i>');
                } else {
                    const errorMsg = result?.error || 'Unknown error occurred';
                    showGlassToast('error', null, `Failed to delete text replacement: ${errorMsg}`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            } else {
                showGlassToast('error', null, 'Unable to delete text replacement: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Error deleting text replacement:', error);
            showGlassToast('error', null, 'Error deleting text replacement', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
}

// Create new text replacement
async function createTextReplacement() {
    showCreateTextReplacementModal();
}

// Show create text replacement modal
function showCreateTextReplacementModal() {
    const modal = document.getElementById('createTextReplacementModal');
    if (!modal) return;
    
    // Reset form
    document.getElementById('textReplacementKeyInput').value = '';
    
    // Clear array items
    const arrayContainer = document.getElementById('createArrayItemsContainer');
    if (arrayContainer) {
        arrayContainer.innerHTML = '';
    }
    
    // Initialize with one array item
    initializeCreateArrayItems();
    
    // Link to parent modal (text replacement manager)
    const parentModal = document.getElementById('textReplacementManagerModal');
    if (parentModal && !parentModal.classList.contains('hidden')) {
        linkToolWindowToParent(modal, parentModal);
    }
    
    // Show modal
    openModal(modal);
    
    // Focus key input
    document.getElementById('textReplacementKeyInput').focus();
}

// Hide create text replacement modal
async function hideCreateTextReplacementModal() {
    const modal = document.getElementById('createTextReplacementModal');
    if (modal) {
        await closeModal(modal);
    }
    const searchInput = document.getElementById('textReplacementSearch');
    if (searchInput) {
        searchInput.value = '';
    }
    const textReplacementSearchContainer = document.getElementById('textReplacementSearchContainer');
    if (textReplacementSearchContainer) {
        textReplacementSearchContainer.classList.add('hidden');
    }
}

// Handle type selection change
function handleTextReplacementTypeChange() {
    const typeSelect = document.getElementById('textReplacementTypeSelect');
    const stringRow = document.getElementById('stringValueRow');
    const arrayRow = document.getElementById('arrayValueRow');
    
    if (typeSelect.value === 'array') {
        stringRow.classList.add('hidden');
        arrayRow.classList.remove('hidden');
        // Initialize with one empty array item
        initializeCreateArrayItems();
    } else {
        stringRow.classList.remove('hidden');
        arrayRow.classList.add('hidden');
    }
}

// Initialize array items for create modal
function initializeCreateArrayItems() {
    const container = document.getElementById('createArrayItemsContainer');
    if (!container) return;
    
    // Clear existing items
    container.innerHTML = '';
    
    // Add one initial empty item
    addCreateArrayItem();
}

// Add new array item to create modal
function addCreateArrayItem() {
    const container = document.getElementById('createArrayItemsContainer');
    if (!container) return;
    
    const itemIndex = container.children.length;
    
    const itemElement = document.createElement('div');
    itemElement.className = 'text-replacement-array-item';
    itemElement.dataset.index = itemIndex;
    
    itemElement.innerHTML = `
        <div class="character-prompt-textarea-container">
            <div class="character-prompt-textarea-background"></div>
            <textarea 
                class="form-control character-prompt-textarea prompt-textarea"
                rows="2"
                data-index="${itemIndex}"
                placeholder="Enter value..."
                autocapitalize="false"
                autocorrect="false"
                spellcheck="false"
                data-ms-editor="false"
            ></textarea>
            <div class="prompt-textarea-toolbar hidden">
                <div class="toolbar-left">
                    <span class="token-count">0 tokens</span>
                    <!-- Search Mode Elements (Hidden by default) -->
                    <div class="toolbar-search-elements">
                        <div class="text-search-label">Search</div>
                        <div class="text-search-input-container">
                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                        </div>
                        <div class="text-search-match-count">0</div>
                    </div>
                </div>
                <div class="toolbar-right">
                    <!-- Regular Toolbar Buttons -->
                    <div class="toolbar-regular-buttons">
                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="off" title="Toggle SmartText Autofill">
                            <i class="fas fa-lightbulb-slash"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                            <i class="fas fa-weight-scale"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                            <i class="fas fa-book-font"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="search" title="Inline Find">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                    <!-- Search Mode Buttons (Hidden by default) -->
                    <div class="toolbar-search-buttons">
                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                    </div>
                </div>
            </div>
        </div>
        <button class="btn-secondary remove-array-item" type="button" title="Remove">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;
    
    container.appendChild(itemElement);
    
    // Add event listener for the remove button
    const removeBtn = itemElement.querySelector('.remove-array-item');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => removeCreateArrayItem(itemIndex));
    }
    
    // Focus the new textarea
    const newTextarea = itemElement.querySelector('textarea');
    if (newTextarea) {
        newTextarea.focus();
        setupTextReplacementTextarea(newTextarea);
    }
    
    // Update remove button visibility
    updateRemoveButtonVisibility();
}

// Remove array item from create modal
function removeCreateArrayItem(index) {
    const container = document.getElementById('createArrayItemsContainer');
    if (!container) return;
    
    const itemToRemove = container.querySelector(`[data-index="${index}"]`);
    if (itemToRemove) {
        itemToRemove.remove();
        
        // Reindex remaining items
        const remainingItems = container.querySelectorAll('.text-replacement-array-item');
        remainingItems.forEach((item, newIndex) => {
            item.dataset.index = newIndex;
            const textarea = item.querySelector('textarea');
            if (textarea) {
                textarea.dataset.index = newIndex;
            }
            const removeBtn = item.querySelector('.remove-array-item');
            if (removeBtn) {
                // Remove old event listener by cloning and replacing
                const newRemoveBtn = removeBtn.cloneNode(true);
                removeBtn.parentNode.replaceChild(newRemoveBtn, removeBtn);
                // Add new event listener with correct index
                newRemoveBtn.addEventListener('click', () => removeCreateArrayItem(newIndex));
            }
        });
        
        // Update remove button visibility based on item count
        updateRemoveButtonVisibility();
    }
}

// Update remove button visibility - hide for single items
function updateRemoveButtonVisibility() {
    const container = document.getElementById('createArrayItemsContainer');
    if (!container) return;
    
    const items = container.querySelectorAll('.text-replacement-array-item');
    items.forEach((item, index) => {
        const removeBtn = item.querySelector('.remove-array-item');
        if (removeBtn) {
            // Hide remove button if there's only one item
            if (items.length === 1) {
                removeBtn.classList.add('hidden');
            } else {
                removeBtn.classList.remove('hidden');
            }
        }
    });
}

// Handle create text replacement form submission
async function handleCreateTextReplacementSubmit() {
    const keyInput = document.getElementById('textReplacementKeyInput');
    
    const key = keyInput.value.trim();
    
    // Validate key
    if (!key) {
        showGlassToast('error', null, 'Please enter a key name', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        keyInput.focus();
        return;
    }
    
    // Check if key already exists
    if (textReplacementData.hasOwnProperty(key)) {
        showGlassToast('error', null, `Text replacement "!${key}" already exists`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        keyInput.focus();
        return;
    }
    
    // Collect values from individual array item textareas
    const arrayTextareas = document.querySelectorAll('#createArrayItemsContainer textarea');
    const arrayValues = Array.from(arrayTextareas).map(textarea => textarea.value.trim()).filter(item => item !== '');
    
    if (arrayValues.length === 0) {
        showGlassToast('error', null, 'Please enter at least one value', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    
    // Auto-detect type: if single item, convert to string; if multiple, keep as array
    let value;
    if (arrayValues.length === 1) {
        value = arrayValues[0]; // Single item becomes string
    } else {
        value = arrayValues; // Multiple items become array
    }
    
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            // Send create request via WebSocket using the same save mechanism
            const result = await window.wsClient.sendMessage('save_text_replacements', {
                textReplacements: { [key]: value }
            });
            
            if (result && result.success) {
                // Add to local data
                textReplacementData[key] = value;
                originalTextReplacementData[key] = JSON.parse(JSON.stringify(value));
                
                // Hide modal
                hideCreateTextReplacementModal();
                
                // Refresh the list to show the new item
                await loadTextReplacements();
                
                showGlassToast('success', null, `Created text replacement "!${key}"`, false, 3000, '<i class="fas fa-plus"></i>');
            } else {
                const errorMsg = result?.error || 'Unknown error occurred';
                showGlassToast('error', null, `Failed to create text replacement: ${errorMsg}`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } else {
            showGlassToast('error', null, 'Unable to create text replacement: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    } catch (error) {
        console.error('Error creating text replacement:', error);
        showGlassToast('error', null, 'Error creating text replacement', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Check if text replacement has changes
function hasChanges(key, currentValue) {
    if (!originalTextReplacementData.hasOwnProperty(key)) {
        return true; // New item
    }
    
    const originalValue = originalTextReplacementData[key];
    
    if (Array.isArray(originalValue) && Array.isArray(currentValue)) {
        if (originalValue.length !== currentValue.length) return true;
        return !originalValue.every((val, index) => val === currentValue[index]);
    }
    
    return originalValue !== currentValue;
}

// Utility function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Favorites Management Variables
let favoritesData = {
    tags: [],
    textReplacements: []
};
let currentFavoritesType = 'tags';

// Initialize favorites manager
function initializeFavoritesManager() {
    const closeFavoritesManagerBtn = document.getElementById('closeFavoritesManagerBtn');
    
    if (closeFavoritesManagerBtn) {
        closeFavoritesManagerBtn.addEventListener('click', hideFavoritesManager);
    }
}

// Show favorites manager modal
async function showFavoritesManager() {
    // openDataManagementDsap: public/scripts/comp/dataManagementDsapApplet.js
    if (typeof openDataManagementDsap === 'function') {
        openDataManagementDsap('favorites');
        return;
    }
    if (typeof openDsapInGrimoire === 'function') {
        openDsapInGrimoire('dsap://data.dreamscape.jp/favorites');
        return;
    }

    const modal = document.getElementById('favoritesManagerModal');
    if (!modal) return;
    
    const wasClosed = modal.classList.contains('hidden');
    console.log('Opening favorites manager...');
    await loadFavorites();
    console.log('Favorites loaded, rendering list...');
    renderFavoritesList();
    
    // Link to parent modal (text replacement manager)
    const parentModal = document.getElementById('textReplacementManagerModal');
    if (parentModal && !parentModal.classList.contains('hidden')) {
        linkToolWindowToParent(modal, parentModal);
    }
    
    openModal(modal);
    
    if (wasClosed && window.customScrollbar) {
        // Initialize custom scrollbars after modal is opened
        setTimeout(() => {
            const favoritesListContainer = document.getElementById('favoritesListContainer');
            if (favoritesListContainer) {
                window.customScrollbar.forceReinit(favoritesListContainer);
            }
        }, 50);
    }
}

// Hide favorites manager modal
async function hideFavoritesManager() {
    const modal = document.getElementById('favoritesManagerModal');
    if (modal) {
        await closeModal(modal);
    }

    // Clear search input when modal is closed
    const searchInput = document.getElementById('favoritesSearch');
    if (searchInput) {
        searchInput.value = '';
    }
    const favoritesSearchContainer = document.getElementById('favoritesSearchContainer');
    if (favoritesSearchContainer) {
        favoritesSearchContainer.classList.add('hidden');
    }
}

// Load favorites from server
// promptTextareaContextMenu.js
function getPromptContextMenuFavorites() {
    return favoritesData;
}

async function ensureFavoritesLoadedForPromptMenu() {
    if (favoritesData.tags.length > 0 || favoritesData.textReplacements.length > 0) {
        return favoritesData;
    }
    await loadFavorites();
    return favoritesData;
}

async function loadFavorites() {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            // Request favorites via WebSocket
            console.log('Client: Requesting favorites from server...');
            const result = await window.wsClient.sendMessage('favorites_get', {});
            console.log('Client: Received result from server:', result);

            // Handle both old and new response formats
            let favorites = null;
            if (result && result.data && result.data.favorites) {
                // New format: {data: {favorites: {...}}}
                console.log('Client: Using new format');
                favorites = result.data.favorites;
            } else if (result && result.favorites) {
                // Old format: {favorites: {...}}
                console.log('Client: Using old format');
                favorites = result.favorites;
            }
            
            if (favorites) {
                // The favorites object should contain tags and textReplacements arrays
                favoritesData = {
                    tags: favorites.tags || [],
                    textReplacements: favorites.textReplacements || []
                };
                updateFavoritesCounts();
                console.log('Loaded favorites:', favoritesData);
            } else {
                console.warn('No favorites received from server:', result);
                favoritesData = { tags: [], textReplacements: [] };
            }
        } else {
            console.error('WebSocket connection not available');
            showGlassToast('error', null, 'Unable to load favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    } catch (error) {
        console.error('Error loading favorites:', error);
        showGlassToast('error', null, 'Error loading favorites', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Update favorites counts in tabs
function updateFavoritesCounts() {
    // Counts are no longer displayed in tabs
}

// Render favorites list for current tab
function renderFavoritesList(targetList, options) {
    const favoritesList = targetList || document.getElementById('favoritesList');
    if (!favoritesList) {
        // dataMgmtDsapRefreshFavoritesIfPresent: public/scripts/comp/dataManagementDsapApplet.js
        if (typeof dataMgmtDsapRefreshFavoritesIfPresent === 'function') {
            dataMgmtDsapRefreshFavoritesIfPresent();
        }
        return;
    }

    favoritesList.innerHTML = '';
    
    // Combine all favorites into a single list with type indicators
    const allFavorites = [];
    
    // Add tags with type indicator
    favoritesData.tags.forEach((tag, index) => {
        allFavorites.push({
            type: 'tag',
            data: tag,
            index: index
        });
    });
    
    // Add text replacements with type indicator
    favoritesData.textReplacements.forEach((textReplacement, index) => {
        allFavorites.push({
            type: 'textReplacement',
            data: textReplacement,
            index: index
        });
    });
    
    if (allFavorites.length === 0) {
        favoritesList.innerHTML = `
            <div class="text-replacement-empty">
                <i class="fas fa-star"></i>
                <p>No favorites yet</p>
                <small>Add tags and text replacements to your favorites from other parts of the app</small>
            </div>
        `;
        // dataMgmtDsapRefreshFavoritesIfPresent: public/scripts/comp/dataManagementDsapApplet.js
        if (typeof dataMgmtDsapRefreshFavoritesIfPresent === 'function') {
            dataMgmtDsapRefreshFavoritesIfPresent();
        }
        return;
    }

    // Render all favorites
    allFavorites.forEach((favorite, globalIndex) => {
        if (favorite.type === 'tag') {
            const tagElement = createFavoriteTagItem(favorite.data, favorite.index);
            favoritesList.appendChild(tagElement);
        } else {
            const textReplacementElement = createFavoriteTextReplacementItem(favorite.data, favorite.index);
            favoritesList.appendChild(textReplacementElement);
        }
    });

    // dataMgmtDsapRefreshFavoritesIfPresent: public/scripts/comp/dataManagementDsapApplet.js
    if (typeof dataMgmtDsapRefreshFavoritesIfPresent === 'function') {
        dataMgmtDsapRefreshFavoritesIfPresent();
    }
}


// Create favorite tag item element
function createFavoriteTagItem(tag, index) {
    const item = document.createElement('div');
    item.className = 'text-replacement-item';
    item.dataset.index = index;
    item.dataset.type = 'tag';

    const description = tag.name !== tag.description ? tag.description : '';

    item.innerHTML = `
        <div class="text-replacement-header">
            <div class="text-replacement-name">${escapeHtml(tag.name)}</div>
            <div class="text-replacement-actions">
                <div class="text-replacement-type">
                    <i class="fas fa-tag"></i>
                </div>
                <button type="button" class="btn-small btn-danger delete-btn remove-favorite-btn" data-type="tags" data-index="${index}" title="Remove from Favorites">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        ${description ? `
        <div class="text-replacement-content">
            <div class="text-replacement-value-container">
                <div class="text-replacement-array-items">
                    <div class="text-replacement-array-item" data-index="0">
                        <div class="text-replacement-value-display">
                            <span class="text-replacement-text">${escapeHtml(description)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        ` : ``}
    `;

    // Add event listener after creating the element
    const removeBtn = item.querySelector('.remove-favorite-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            console.log('Delete button clicked for tags:', index);
            removeFavorite('tags', index);
        });
    }

    return item;
}

// Create favorite text replacement item element
function createFavoriteTextReplacementItem(textReplacement, index) {
    const item = document.createElement('div');
    item.className = 'text-replacement-item';
    item.dataset.index = index;
    item.dataset.type = 'textReplacement';

    const placeholder = textReplacement.placeholder || '';
    const replacementValue = textReplacement.replacementValue || '';

    item.innerHTML = `
        <div class="text-replacement-header">
            <div class="text-replacement-name">!${escapeHtml(placeholder)}</div>
            <div class="text-replacement-actions">
                <div class="text-replacement-type">
                    <i class="fas fa-input-text"></i>
                </div>
                <button type="button" class="btn-small btn-danger delete-btn remove-favorite-btn" data-type="textReplacements" data-index="${index}" title="Remove from Favorites">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        <div class="text-replacement-content">
            <div class="text-replacement-value-container">
                <div class="text-replacement-array-items">
                    <div class="text-replacement-array-item" data-index="0">
                        <div class="text-replacement-value-display">
                            <span class="text-replacement-text">${escapeHtml(replacementValue)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add event listener after creating the element
    const removeBtn = item.querySelector('.remove-favorite-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            console.log('Delete button clicked for textReplacements:', index);
            removeFavorite('textReplacements', index);
        });
    }

    return item;
}

// Remove favorite item
async function removeFavorite(type, index) {
    console.log('removeFavorite called with type:', type, 'index:', index);

    const favorites = favoritesData[type] || [];
    const item = favorites[index];

    console.log('Item found:', item);

    if (!item) {
        console.error('Item not found at index:', index);
        return;
    }

    const itemName = item.name || item.placeholder || 'item';
    console.log('Showing confirmation dialog for:', itemName);

    const confirmed = await showConfirmationDialog(
        `Are you sure you want to remove "${itemName}" from favorites?`,
        [
            { text: 'Cancel', value: false, className: 'btn-secondary' },
            { text: 'Remove', value: true, className: 'btn-danger' }
        ]
    );

    console.log('Confirmation result:', confirmed);

    if (confirmed) {
        try {
            if (window.wsClient && window.wsClient.isConnected()) {
                // Send remove request via WebSocket
                const result = await window.wsClient.sendMessage('favorites_remove', {
                    favoriteType: type,
                    itemId: item.id
                });
                
                if (result && result.success) {
                    // Remove from local data
                    favoritesData[type].splice(index, 1);
                    updateFavoritesCounts();
                    renderFavoritesList();
                    
                    showGlassToast('success', null, `Removed "${itemName}" from favorites`, false, 3000, '<i class="fas fa-trash"></i>');
                } else {
                    const errorMsg = result?.error || 'Unknown error occurred';
                    showGlassToast('error', null, `Failed to remove favorite: ${errorMsg}`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            } else {
                showGlassToast('error', null, 'Unable to remove favorite: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Error removing favorite:', error);
            showGlassToast('error', null, 'Error removing favorite', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
}

// Validate if a dynamic replacement can be applied client-side
function validateDynamicReplacementCanApply(replacement) {
    const applicationContext = window.dynamicGenerationData?.compiled_prompt?.application_context
        || window._lastCompileToPromptsApplicationContext;
    // validateReplacementAgainstResolved: promptApplyPipeline.js
    if (applicationContext?.streams && typeof validateReplacementAgainstResolved === 'function') {
        return validateReplacementAgainstResolved(replacement, applicationContext);
    }

    const action = replacement.action?.toLowerCase() || 'replace';
    
    // For append without select_text, always can apply
    if (action === 'append' && !replacement.select_text) {
        return true;
    }

    // For other actions, need to check if select_text exists in the target
    const targetText = getDynamicReplacementTargetText(replacement);
    if (!targetText) {
        return false; // Can't access target
    }

    const selectText = (replacement?.select_text || '').trim();
    if (!selectText && action !== 'append') {
        return false; // No text to find for delete/replace
    }

    // Check if select_text exists in target
    if (selectText && targetText.indexOf(selectText) !== -1) {
        return true;
    }

    // Check fallback_select_text
    if (replacement.fallback_select_text) {
        const fallbackText = replacement.fallback_select_text.trim();
        if (targetText.indexOf(fallbackText) !== -1) {
            return true;
        }
    }

    // Check anchor text
    const anchorText = (replacement.anchor_text || '').trim();
    if (anchorText && targetText.indexOf(anchorText) !== -1) {
        return true;
    }

    // For optional replacements with alternative_text, can always apply (will append)
    if (!replacement.is_critical && replacement.alternative_text) {
        return true;
    }

    return false;
}

// Get the target text for a dynamic replacement
function getDynamicReplacementTargetText(replacement) {
    if (replacement.targetType === 'prompt') {
        const textarea = document.getElementById('manualPrompt');
        return textarea ? textarea.value : null;
    } else if (replacement.targetType === 'uc') {
        const textarea = document.getElementById('manualUc');
        return textarea ? textarea.value : null;
    } else if (replacement.targetType === 'character') {
        // Access character prompt by index
        const characterPromptsContainer = document.getElementById('characterPromptsContainer');
        if (!characterPromptsContainer) return null;
        
        const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
        const characterIndex = replacement.targetSource;
        
        if (characterIndex < 0 || characterIndex >= characterItems.length) {
            return null; // Invalid character index
        }
        
        const characterItem = characterItems[characterIndex];
        const characterId = characterItem.id;
        const field = replacement.targetField || 'prompt'; // 'prompt' or 'uc'
        
        const textarea = document.getElementById(`${characterId}_${field}`);
        return textarea ? textarea.value : null;
    }
    return null;
}

// Apply a Rentan modification (Tendai) client-side (mimics server logic)
function applyDynamicReplacementClientSide(replacement) {
    const action = replacement.action?.toLowerCase() || 'replace';
    const targetType = replacement.targetType;
    
    // Define the append marker constant (must match server-side)
    const APPEND_MARKER = '__ENSHUTSUKA_APPEND_POINT__';
    
    // Get the target textarea
    let textarea = null;
    if (targetType === 'prompt') {
        textarea = document.getElementById('manualPrompt');
    } else if (targetType === 'uc') {
        textarea = document.getElementById('manualUc');
    } else if (targetType === 'character') {
        // Access character prompt by index
        const characterPromptsContainer = document.getElementById('characterPromptsContainer');
        if (!characterPromptsContainer) {
            return { success: false, error: 'Character prompts container not found' };
        }
        
        const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
        const characterIndex = replacement.targetSource;
        
        if (characterIndex < 0 || characterIndex >= characterItems.length) {
            return { success: false, error: `Character ${characterIndex + 1} not found` };
        }
        
        const characterItem = characterItems[characterIndex];
        const characterId = characterItem.id;
        const field = replacement.targetField || 'prompt'; // 'prompt' or 'uc'
        
        textarea = document.getElementById(`${characterId}_${field}`);
    }

    if (!textarea) {
        return { success: false, error: 'Could not find target textarea' };
    }

    let result = textarea.value;
    const selectText = (replacement?.select_text || '').trim();
    let replaceText = replacement.replace_text || '';
    const fallbackSelectText = replacement.fallback_select_text ? replacement.fallback_select_text.trim() : null;
    const alternativeText = replacement.alternative_text || null;
    const isCritical = replacement.is_critical !== false; // Default to true
    const count = replacement.count;
    const anchorText = (replacement.anchor_text || '').trim();

    // Match server behavior: apply emphasis bias to replacement text when available.
    if (replaceText && (action === 'replace' || action === 'append')) {
        let biasToApply = null;
        if (replacement.segment_emphasis !== null && replacement.segment_emphasis !== undefined) {
            biasToApply = replacement.segment_emphasis;
        } else if (selectText) {
            biasToApply = extractBiasFromTextForDisplay(selectText);
        }
        if (biasToApply !== null && !hasEmphasisGroupForDisplay(replaceText)) {
            replaceText = applyBiasToText(replaceText, biasToApply);
        }
    }

    let method = 'direct';
    let appliedSuccessfully = false;

    if (action === 'delete') {
        // Delete action
        let deleteCount = 0;
        let textToDelete = selectText;
        let usedFallback = false;

        // Try primary select_text
        if (selectText && result.includes(selectText)) {
            if (count !== undefined && count !== null) {
                // Delete specific number of occurrences
                for (let i = 0; i < count; i++) {
                    const index = result.indexOf(textToDelete);
                    if (index === -1) break;
                    result = result.substring(0, index) + result.substring(index + textToDelete.length);
                    deleteCount++;
                }
            } else {
                // Delete all occurrences
                result = result.split(textToDelete).join('');
                deleteCount = 1; // Mark as successful
            }
            appliedSuccessfully = deleteCount > 0;
        }

        // Try fallback if primary failed
        if (!appliedSuccessfully && fallbackSelectText && result.includes(fallbackSelectText)) {
            textToDelete = fallbackSelectText;
            usedFallback = true;
            if (count !== undefined && count !== null) {
                for (let i = 0; i < count; i++) {
                    const index = result.indexOf(textToDelete);
                    if (index === -1) break;
                    result = result.substring(0, index) + result.substring(index + textToDelete.length);
                    deleteCount++;
                }
            } else {
                result = result.split(textToDelete).join('');
                deleteCount = 1;
            }
            appliedSuccessfully = deleteCount > 0;
            if (appliedSuccessfully) method = 'fallback';
        }

        if (!appliedSuccessfully) {
            return { success: false, error: `Could not find text to delete: "${selectText}"` };
        }

    } else if (action === 'replace') {
        // Replace action
        let textToReplace = selectText;
        let usedFallback = false;

        // Try primary select_text
        if (selectText && result.includes(selectText)) {
            result = result.replace(selectText, replaceText);
            appliedSuccessfully = true;
        }

        // Try fallback if primary failed
        if (!appliedSuccessfully && fallbackSelectText && result.includes(fallbackSelectText)) {
            textToReplace = fallbackSelectText;
            result = result.replace(fallbackSelectText, replaceText);
            appliedSuccessfully = true;
            method = 'fallback';
        }

        // Try alternative if both failed and replacement is optional
        if (!appliedSuccessfully && !isCritical && alternativeText) {
            // Append alternative text to end
            const needsComma = result.trim() && !result.trim().endsWith(',') && !result.trim().endsWith('::');
            result = result.trimEnd() + (needsComma ? ', ' : ' ') + alternativeText;
            appliedSuccessfully = true;
            method = 'alternative';
        }

        if (!appliedSuccessfully) {
            return { success: false, error: `Could not find text to replace: "${selectText}"` };
        }

    } else if (action === 'append') {
        // Append action
        let textToAppend = replaceText;
        let insertPosition = result.length;
        let anchorApplied = false;

        if (anchorText) {
            const anchorIndex = result.indexOf(anchorText);
            if (anchorIndex !== -1) {
                insertPosition = anchorIndex + anchorText.length;
                appliedSuccessfully = true;
                anchorApplied = true;
                method = 'anchor';
            }
        }

        if (!anchorApplied && selectText && selectText.trim()) {
            // Try to find select_text and append after it
            const index = result.indexOf(selectText);
            if (index !== -1) {
                insertPosition = index + selectText.length;
                appliedSuccessfully = true;
            } else if (fallbackSelectText && result.includes(fallbackSelectText)) {
                // Try fallback
                const fallbackIndex = result.indexOf(fallbackSelectText);
                insertPosition = fallbackIndex + fallbackSelectText.length;
                appliedSuccessfully = true;
                method = 'fallback';
            } else if (!isCritical && alternativeText) {
                // Use alternative text at end
                textToAppend = alternativeText;
                method = 'alternative';
            }
        } else {
            // No select_text provided, append to end
            // Look for the append marker to insert before presets
            const markerIndex = result.indexOf(APPEND_MARKER);
            if (markerIndex !== -1) {
                // Found marker, insert before it
                insertPosition = markerIndex;
                // Check if there's a comma before the marker that we should remove
                if (insertPosition > 2 && result.substring(insertPosition - 2, insertPosition) === ', ') {
                    insertPosition -= 2; // Remove the comma and space before marker
                }
                console.log(`📍 Found append marker, inserting before presets`);
            } else {
                // No marker found, append to end (fallback)
                insertPosition = result.length;
            }
        }

        // Insert at determined position
        const needsComma = insertPosition > 0 && result[insertPosition - 1] !== ',' && result[insertPosition - 1] !== ' ';
        const separator = needsComma ? ', ' : '';
        result = result.substring(0, insertPosition) + separator + textToAppend + result.substring(insertPosition);
        appliedSuccessfully = true;
    }

    if (!appliedSuccessfully) {
        return { success: false, error: 'Failed to apply replacement' };
    }

    // Remove the append marker before applying to textarea
    // Handle both ", MARKER" and standalone "MARKER" patterns
    result = result.replace(new RegExp(`,\\s*${APPEND_MARKER}|${APPEND_MARKER}`, 'g'), '');

    // Update the textarea
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, result);

    // Trigger input event to update any dependent UI
    const inputEvent = new Event('input', { bubbles: true });
    textarea.dispatchEvent(inputEvent);

    // Trigger other updates (auto-resize, highlighting, etc.)
    if (typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(textarea);
    }
    if (typeof updateEmphasisHighlighting === 'function') {
        updateEmphasisHighlighting(textarea);
    }

    return { success: true, method: method };
}

function getTendaiCategoryIcon(category) {
    const categoryLower = (category || '').toLowerCase();
    if (categoryLower.includes('weather')) return '<i class="fas fa-cloud-rain"></i>';
    if (categoryLower.includes('time of day') || categoryLower.includes('time')) return '<i class="fas fa-clock"></i>';
    if (categoryLower.includes('seasonal')) return '<i class="fas fa-leaf"></i>';
    if (categoryLower.includes('holiday')) return '<i class="fas fa-calendar-star"></i>';
    if (categoryLower.includes('spelling')) return '<i class="fas fa-spell-check"></i>';
    if (categoryLower.includes('text overlay') || categoryLower.includes('overlay')) return '<i class="fas fa-comment-dots"></i>';
    if (categoryLower.includes('conflict resolution') || categoryLower.includes('conflict')) return '<i class="fas fa-wrench"></i>';
    if (categoryLower.includes('enhancement') || categoryLower.includes('enhance')) return '<i class="fas fa-sparkles"></i>';
    if (categoryLower.includes('lighting') || categoryLower.includes('light')) return '<i class="fas fa-lightbulb"></i>';
    if (categoryLower.includes('atmosphere')) return '<i class="fas fa-cloud-sun"></i>';
    if (categoryLower.includes('action verb') || categoryLower.includes('action')) return '<i class="fas fa-running"></i>';
    if (categoryLower.includes('directive')) return '<i class="fas fa-bullseye"></i>';
    return '<i class="fas fa-tag"></i>';
}

function getTendaiCategoryClass(category) {
    if (!category) return '';
    return 'category-' + category.toLowerCase().replace(/\s+/g, '-');
}

function buildTendaiStatusIcon(replacement) {
    if (replacement.applied === false || replacement.error) {
        return {
            statusIcon: '<i class="fas fa-times"></i>',
            statusColor: '#ff8181',
            statusTitle: replacement.error ? `Failed to apply: ${replacement.error}` : 'Failed to apply'
        };
    }
    if (replacement.used_fallback || replacement.application_method === 'fallback') {
        return {
            statusIcon: '<i class="fas fa-exclamation-triangle"></i>',
            statusColor: '#ffc981',
            statusTitle: 'Applied using fallback text'
        };
    }
    if (replacement.used_alternative || replacement.application_method === 'alternative') {
        return {
            statusIcon: '<i class="fas fa-rotate"></i>',
            statusColor: '#81d4ff',
            statusTitle: 'Applied using alternative text'
        };
    }
    if (replacement.applied !== false) {
        return {
            statusIcon: '<i class="fas fa-check"></i>',
            statusColor: '#81ffb3',
            statusTitle: 'Applied successfully'
        };
    }
    return { statusIcon: '', statusColor: '', statusTitle: '' };
}

function buildTendaiStatusIndicators(replacement, mitigations) {
    let statusIndicators = '';
    if (replacement.applied === false || replacement.error) {
        const errorMsg = replacement.error ? escapeHtml(replacement.error) : 'Failed to apply';
        statusIndicators += `<span class="text-replacement-badge text-replacement-badge-danger" title="${errorMsg}"><i class="fas fa-times"></i> Failed</span>`;
    } else {
        if (replacement.used_fallback && replacement.actual_select_text) {
            statusIndicators += `<span class="text-replacement-badge text-replacement-badge-warning" title="Used fallback: ${escapeHtml(replacement.actual_select_text)}"><i class="fas fa-exclamation-triangle"></i> Fallback</span>`;
        }
        if (replacement.used_alternative && replacement.alternative_text_used) {
            statusIndicators += `<span class="text-replacement-badge text-replacement-badge-info" title="Used alternative: ${escapeHtml(replacement.alternative_text_used)}"><i class="fas fa-rotate"></i> Alternative</span>`;
        }
    }
    if (mitigations.some(m => m.type === 'converted_to_append')) {
        statusIndicators += `<span class="text-replacement-badge text-replacement-badge-info" title="Converted from replace to append due to overlapping anchor"><i class="fas fa-share"></i> Converted</span>`;
    }
    return statusIndicators;
}

/**
 * Shared Tendai row for Inspector (lock) or Compile to Prompts (include check).
 * @param {object} replacement
 * @param {number} globalIndex
 * @param {{ mode?: 'lock'|'include', included?: boolean, applicationContext?: object, onIncludeToggle?: function }} options
 */
function createTendaiReplacementRow(replacement, globalIndex, options = {}) {
    const mode = options.mode || 'lock';
    const item = document.createElement('div');
    const action = replacement.action?.toLowerCase() || 'replace';
    item.className = `text-replacement-lock-item dynamic-replacement-type dynamic-action-${action}`;

    if (replacement.targetType === 'uc' || (replacement.targetType === 'character' && replacement.targetField === 'uc')) {
        item.classList.add('negative-prompt');
    }

    item.dataset.globalIndex = globalIndex;

    const actionIcon = action === 'replace' ? 'fa-arrows-rotate' : action === 'append' ? 'fa-plus' : 'fa-trash';
    let locationIcon = '<i class="ri-code-block"></i>';
    let locationColor = '#81ffcb';
    if (replacement.targetType === 'uc') {
        locationIcon = '<i class="ri-eraser-fill"></i>';
        locationColor = '#ff8199';
    } else if (replacement.targetType === 'character' && replacement.targetField === 'uc') {
        locationIcon = '<i class="ri-eraser-fill"></i>';
        locationColor = '#ff8199';
    }

    let actionColor = '#9ca3af';
    if (action === 'replace') actionColor = '#ffb981';
    else if (action === 'append') actionColor = '#81ffcb';
    else if (action === 'delete') actionColor = '#ff8199';

    const applicationContext = options.applicationContext;
    const canApply = mode === 'include'
        ? validateReplacementAgainstResolved(replacement, applicationContext)
        : validateDynamicReplacementCanApply(replacement);

    const mitigations = Array.isArray(replacement.mitigations) ? replacement.mitigations : [];
    const anchorDetails = replacement.anchor_details || null;
    const anchorDisplayText = anchorDetails?.preview || replacement.anchor_text || '';
    const anchorSourceLabel = anchorDetails?.source ? anchorDetails.source.replace(/_/g, ' ') : '';
    const { statusIcon, statusColor, statusTitle } = buildTendaiStatusIcon(replacement);
    const statusIndicators = buildTendaiStatusIndicators(replacement, mitigations);
    const categoryClass = getTendaiCategoryClass(replacement.replacement_category);
    const categoryIcon = getTendaiCategoryIcon(replacement.replacement_category);

    let selectTextPattern = '';
    if (replacement.select_text) {
        selectTextPattern = `"${escapeHtml(replacement.select_text)}"`;
    } else if (action === 'append') {
        selectTextPattern = '<i>append to end</i>';
    } else {
        selectTextPattern = '<i>N/A</i>';
    }

    let replaceTextPattern = '';
    if (action === 'delete') {
        if (replacement.select_text) {
            let selectText = replacement.select_text;
            if (replacement.segment_emphasis !== null && replacement.segment_emphasis !== undefined && !hasEmphasisGroupForDisplay(selectText)) {
                selectText = applyBiasToText(selectText, replacement.segment_emphasis);
            }
            replaceTextPattern = `"${escapeHtml(selectText)}"`;
            if (replacement.count) {
                replaceTextPattern += ` <span style="opacity: 0.7; font-size: 0.9em;">(${replacement.count} occurrence(s))</span>`;
            } else {
                replaceTextPattern += ` <span style="opacity: 0.7; font-size: 0.9em;">(all occurrences)</span>`;
            }
        } else {
            replaceTextPattern = replacement.count
                ? `<i>Delete ${replacement.count} occurrence(s)</i>`
                : '<i>Delete all</i>';
        }
    } else if (replacement.replace_text) {
        let rt = replacement.replace_text;
        const bias = getReplacementBias(replacement);
        if (bias !== null && !hasEmphasisGroupForDisplay(rt)) {
            rt = applyBiasToText(rt, bias);
        }
        replaceTextPattern = `"${escapeHtml(rt)}"`;
    } else {
        replaceTextPattern = '<i>N/A</i>';
    }

    const isLocked = replacement.locked === true;
    const isIncluded = options.included !== false;
    item.classList.toggle('selected', mode === 'lock' ? isLocked : isIncluded);

    const toggleBtnHtml = mode === 'include'
        ? `<button type="button" class="text-replacement-lock-btn btn-secondary btn-small toggle-btn tendai-include-toggle" data-state="${isIncluded ? 'on' : 'off'}" data-global-index="${globalIndex}" title="Include in apply">
                <i class="${isIncluded ? 'fas fa-check' : 'far fa-square'}"></i>
           </button>`
        : `<button type="button" class="text-replacement-lock-btn btn-secondary btn-small toggle-btn" data-state="${isLocked ? 'on' : 'off'}" data-global-index="${globalIndex}" title="Lock for AI Maintenance">
                <i class="fas fa-lock"></i>
           </button>`;

    const applyWarning = mode === 'include' && !canApply
        ? '<span class="text-replacement-badge text-replacement-badge-warning" title="May require expander/preset resolution on apply"><i class="fas fa-exclamation-triangle"></i></span>'
        : '';

    const showFindSection = action === 'append' ? !!replacement.select_text : action !== 'delete' || !replacement.select_text;
    const showReplaceSection = action !== 'delete' || replacement.replace_text || replacement.select_text;

    const anchorSection = anchorDisplayText ? `
        <div class="text-replacement-full-value selectable">
            <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">
                Anchor${anchorSourceLabel ? ` <span class="text-replacement-badge text-replacement-badge-info" style="margin-left: 4px;">${escapeHtml(anchorSourceLabel)}</span>` : ''}
            </div>
            "${escapeHtml(anchorDisplayText)}"
        </div>
    ` : '';

    const mitigationSection = mitigations.length ? `
        <div class="text-replacement-full-value selectable">
            <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">Mitigations</div>
            <ul style="margin: 0; padding-left: 1.25em; font-size: 0.85em; color: var(--text-muted); list-style-type: disc;">
                ${mitigations.map(mit => `<li><strong>${escapeHtml(mit.type)}</strong>${mit.description ? ` – ${escapeHtml(mit.description)}` : ''}</li>`).join('')}
            </ul>
        </div>
    ` : '';

    const referencesSection = replacement.references && replacement.references.length > 0 ? `
        <div class="text-replacement-references" style="font-size: 0.7em;">
            <div style="font-weight: 600; margin-bottom: var(--spacing-xs); opacity: 0.8;">
                <i class="fas fa-book"></i> Research Sources:
            </div>
            ${replacement.references.map(ref => {
                let refContent = '';
                if (ref.type === 'web_search') {
                    refContent = `<i class="fas fa-globe"></i> Web: <a href="${escapeHtml(ref.url || '#')}" target="_blank" style="color: var(--primary-color);">${escapeHtml(ref.query || 'Search')}</a>`;
                } else if (ref.type === 'tag_search') {
                    refContent = `<i class="fas fa-tags"></i> Tags: ${ref.tags ? ref.tags.map(t => escapeHtml(t)).join(', ') : escapeHtml(ref.query || '')}`;
                } else if (ref.type === 'tag_description') {
                    refContent = `<i class="fas fa-search"></i> ${escapeHtml(ref.description || ref.query || 'Tag description')}${ref.tags && ref.tags.length > 0 ? ` (${ref.tags.join(', ')})` : ''}`;
                } else if (ref.type === 'tokenizer') {
                    refContent = `<i class="fas fa-calculator"></i> ${escapeHtml(ref.description || 'Token analysis')}`;
                }
                return `<div style="padding: 2px 1em; opacity: 0.9;">${refContent}</div>`;
            }).join('')}
        </div>
    ` : '';

    item.innerHTML = `
        <div class="text-replacement-lock-content">
            <div class="text-replacement-lock-info">
                ${showFindSection ? `<div class="text-replacement-full-value selectable">
                    <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">Find:</div>
                    ${selectTextPattern}
                </div>` : ''}
                ${showReplaceSection ? `<div class="text-replacement-full-value selectable">
                    <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">${action === 'delete' ? 'Delete:' : (action === 'append' ? 'Insert:' : 'Replace with:')}</div>
                    ${replaceTextPattern}
                </div>` : ''}
                ${anchorSection}
                ${mitigationSection}
                ${replacement.reason ? `<div class="selectable reason-text"><i class="fas fa-quote-left"></i> ${escapeHtml(replacement.reason)}</div>` : ''}
                ${referencesSection}
            </div>
            <div class="text-replacement-lock-row">
                <div class="text-replacement-lock-badges">
                    <span class="text-replacement-badge text-replacement-badge-combined">
                        <span class="badge-icon-location" style="color: ${locationColor};">${locationIcon}</span>
                        ${replacement.targetType === 'character' && replacement.targetSource !== undefined ? `
                            <span class="text-replacement-badge-character">
                                <i class="fas fa-person"></i>
                                <span style="font-size: 0.75em;">${replacement.targetSource + 1}</span>
                            </span>
                        ` : ''}
                        <span class="badge-icon-type" style="color: ${actionColor};"><i class="fas ${actionIcon}"></i></span>
                        ${statusIcon ? `<span class="badge-icon-status" style="color: ${statusColor};" title="${escapeHtml(statusTitle)}">${statusIcon}</span>` : ''}
                    </span>
                    ${statusIndicators}
                    ${applyWarning}
                </div>
                <div class="text-replacement-lock-pattern">
                    ${replacement.replacement_category ? `<span class="text-replacement-badge text-replacement-badge-category ${categoryClass}">${categoryIcon} ${escapeHtml(replacement.replacement_category)}</span>` : ''}
                </div>
                <div class="text-replacement-lock-actions">
                    ${toggleBtnHtml}
                </div>
            </div>
        </div>
    `;

    const toggleBtn = item.querySelector('.text-replacement-lock-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (mode === 'include') {
                const newState = toggleBtn.getAttribute('data-state') !== 'on';
                toggleBtn.setAttribute('data-state', newState ? 'on' : 'off');
                const icon = toggleBtn.querySelector('i');
                if (icon) icon.className = newState ? 'fas fa-check' : 'far fa-square';
                item.classList.toggle('selected', newState);
                if (options.onIncludeToggle) options.onIncludeToggle(globalIndex, newState);
            } else {
                toggleDynamicReplacementLockInModal(globalIndex, toggleBtn, item);
            }
        });
    }

    if (mode === 'lock' && contextMenu) {
        const canApplyLock = validateDynamicReplacementCanApply(replacement);
        contextMenu.attachToElement(item, {
            sections: [{
                type: 'icons',
                position: 'outer',
                icons: [
                    {
                        tooltip: 'Toggle Lock Replacement',
                        icon: 'fas fa-lock',
                        action: 'lock',
                        keepMenuOpen: true,
                        showIndicator: true,
                        loadfn: (menuItem) => {
                            menuItem.checked = replacement.locked === true;
                        }
                    },
                    {
                        tooltip: 'Copy Replacement Value',
                        icon: 'nai-clipboard',
                        action: 'copy-value'
                    },
                    {
                        tooltip: 'Apply Replacement to Prompt',
                        icon: 'fas fa-pen-field',
                        action: 'apply-prompt',
                        disabled: !canApplyLock
                    }
                ]
            }, {
                type: 'list',
                items: [
                    { text: 'Set Emphasis', icon: 'fas fa-dial', action: 'set-emphasis' },
                    { text: 'Report Issue', icon: 'fas fa-flag', action: 'report-issue', className: 'text-danger' },
                    { text: 'Delete', icon: 'fas fa-trash', action: 'delete-replacement', className: 'text-danger' }
                ]
            }],
            onAction: (actionName) => {
                if (actionName === 'apply-prompt') {
                    applyDynamicReplacementFromLockModal(globalIndex);
                } else if (actionName === 'lock') {
                    toggleDynamicReplacementLockInModal(globalIndex, toggleBtn, item);
                } else if (actionName === 'copy-value') {
                    const textToCopy = replacement.value || replacement.replace_text || replacement.select_text || '';
                    if (textToCopy) {
                        copyTextToClipboard(textToCopy).then(() => {
                            showGlassToast('success', null, 'Copied to clipboard', false, 2000, '<i class="nai-clipboard"></i>');
                        });
                    }
                } else if (actionName === 'delete-replacement') {
                    deleteDynamicReplacementFromLockModal(globalIndex);
                } else if (actionName === 'set-emphasis') {
                    setDynamicReplacementEmphasis(globalIndex, item);
                } else if (actionName === 'report-issue') {
                    showDirectorFeedbackModal(
                        replacement.select_text,
                        replacement.replace_text,
                        replacement.action,
                        replacement.reason
                    );
                }
            }
        });
    }

    return item;
}


// Create a Rentan modification (Tsubo) item for the lock modal (matches existing layout)
function createDynamicReplacementItemForLockModal(replacement, globalIndex) {
    return createTendaiReplacementRow(replacement, globalIndex, { mode: 'lock' });
}


// Helper function to find replacement by global index
function findDynamicReplacementByIndex(globalIndex) {
    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        return null;
    }

    const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;
    let currentIndex = 0;

    const arrays = [
        { arr: textReplacements.prompt, type: 'prompt', targetSource: 'base' },
        { arr: textReplacements.uc, type: 'uc', targetSource: 'base' }
    ];

    if (textReplacements.character_prompts) {
        textReplacements.character_prompts.forEach((char, charIndex) => {
            if (char?.prompt) arrays.push({ arr: char.prompt, type: 'character', targetSource: charIndex, targetField: 'prompt' });
            if (char?.uc) arrays.push({ arr: char.uc, type: 'character', targetSource: charIndex, targetField: 'uc' });
        });
    }

    for (const { arr, type, targetSource, targetField } of arrays) {
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
            if (currentIndex === globalIndex) {
                return {
                    replacement: arr[i],
                    arrayRef: arr,
                    arrayIndex: i,
                    metadata: { type, targetSource, targetField }
                };
            }
            currentIndex++;
        }
    }

    return null;
}

// Apply Rentan modification (Tendai) from lock modal
async function applyDynamicReplacementFromLockModal(globalIndex) {
    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        showGlassToast('error', null, 'No Tendai Modifications available', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const found = findDynamicReplacementByIndex(globalIndex);
    if (!found) {
        console.error('Could not find replacement at index', globalIndex);
        showGlassToast('error', null, 'Could not find replacement', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const { replacement, arrayRef, arrayIndex, metadata } = found;

    const replacementWithMetadata = {
        ...replacement,
        targetType: metadata.type,
        targetSource: metadata.targetSource,
        targetField: metadata.targetField
    };

    const applicationContext = window.dynamicGenerationData?.compiled_prompt?.application_context
        || window._lastCompileToPromptsApplicationContext;

  if (applicationContext?.streams && typeof applyTendaiToEditor === 'function') {
        let requestBody = null;
        if (typeof collectManualFormValues === 'function' && typeof addSharedFieldsToRequestBody === 'function') {
            const values = collectManualFormValues();
            requestBody = { model: values.model };
            addSharedFieldsToRequestBody(requestBody, values);
        }
        const result = await applyTendaiToEditor([replacementWithMetadata], applicationContext, { requestBody });
        if (result.success) {
            replacement.applied = true;
            arrayRef.splice(arrayIndex, 1);
            if (typeof renderTextReplacementLockList === 'function') renderTextReplacementLockList();
            if (typeof updateMainLockButtonState === 'function') updateMainLockButtonState();
            showGlassToast('success', null, 'Applied replacement and removed from list', false, 3000, '<i class="fas fa-check"></i>');
        } else {
            showGlassToast('error', null, result.error || 'Failed to apply replacement', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
        return;
    }

    const result = applyDynamicReplacementClientSide(replacementWithMetadata);
    
    if (result.success) {
        replacement.applied = true;
        replacement.application_method = result.method;
        arrayRef.splice(arrayIndex, 1);
        if (typeof renderTextReplacementLockList === 'function') {
            renderTextReplacementLockList();
        }
        if (typeof updateMainLockButtonState === 'function') {
            updateMainLockButtonState();
        }
        showGlassToast('success', null, `Applied replacement${result.method !== 'direct' ? ` (using ${result.method})` : ''} and removed from list`, false, 3000, '<i class="fas fa-check"></i>');
    } else {
        showGlassToast('error', null, result.error || 'Failed to apply replacement', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Compile all Rentan modifications (Tendai) into prompt fields and disable dynamic generation
async function compileAllTendaiReplacements() {
    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        showGlassToast('warning', null, 'No Tendai Modifications available to compile', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;
    const selected = collectTendaiReplacementQueue(textReplacements).map(({ replacement, targetType, targetSource, targetField }) => ({
        ...replacement,
        targetType,
        targetSource,
        targetField
    }));

    if (!selected.length) {
        showGlassToast('warning', null, 'No Tendai Modifications available to compile', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const applicationContext = window.dynamicGenerationData?.compiled_prompt?.application_context
        || window._lastCompileToPromptsApplicationContext;

    let successCount = 0;
    let failedCount = 0;

    if (applicationContext?.streams && typeof applyTendaiToEditor === 'function') {
        let requestBody = null;
        if (typeof collectManualFormValues === 'function' && typeof addSharedFieldsToRequestBody === 'function') {
            const values = collectManualFormValues();
            requestBody = { model: values.model };
            addSharedFieldsToRequestBody(requestBody, values);
        }
        const result = await applyTendaiToEditor(selected, applicationContext, { requestBody });
        successCount = result.applied || 0;
        failedCount = result.failed || 0;
        if (!result.success && failedCount > 0) {
            showGlassToast('warning', null, result.error || 'Some replacements could not be applied', false, 4500, '<i class="fas fa-triangle-exclamation"></i>');
        }
    } else {
        const replacementQueue = collectTendaiReplacementQueue(textReplacements);
        const orderedQueue = orderReplacementQueue(replacementQueue);

        orderedQueue.forEach(({ replacement, targetType, targetSource, targetField }) => {
            const preparedReplacement = {
                ...replacement,
                replace_text: typeof replacement?.replace_text === 'string'
                    ? replacement.replace_text.replace(/<br\s*\/?>/gi, '\n')
                    : replacement?.replace_text,
                alternative_text: typeof replacement?.alternative_text === 'string'
                    ? replacement.alternative_text.replace(/<br\s*\/?>/gi, '\n')
                    : replacement?.alternative_text,
                targetType,
                targetSource,
                targetField
            };
            const result = applyDynamicReplacementClientSide(preparedReplacement);
            if (result.success) successCount++;
            else failedCount++;
        });
    }

    delete window.dynamicGenerationData;

    const dynamicGenerationToggle = document.getElementById('dynamicGenerationToggleBtn');
    const dynamicGenerationSection = document.getElementById('dynamicGenerationGroup');
    const dynamicCarouselElement = document.getElementById('dynamicCarousel');

    if (dynamicGenerationToggle) {
        dynamicGenerationToggle.setAttribute('data-state', 'off');
    }
    if (dynamicGenerationSection) {
        dynamicGenerationSection.classList.add('hidden');
    }
    if (dynamicCarouselElement) {
        dynamicCarouselElement.setAttribute('data-use-cache', 'true');
    }
    // clearDynamicGenerationLockState: public/scripts/comp/dynamicGenerationLockState.js
    clearDynamicGenerationLockState();

    if (window.updateDynamicGenerationToggleBtn) {
        window.updateDynamicGenerationToggleBtn();
    }

    if (window.lockedDynamicReplacements) {
        window.lockedDynamicReplacements = [];
    }

    if (window.renderTextReplacementLockList) {
        window.renderTextReplacementLockList();
    }
    if (window.updateMainLockButtonState) {
        window.updateMainLockButtonState();
    }

    if (failedCount > 0) {
        showGlassToast(
            'warning',
            null,
            `Compiled ${successCount} Tendai replacement${successCount === 1 ? '' : 's'}; ${failedCount} could not be applied`,
            false,
            4500,
            '<i class="fas fa-triangle-exclamation"></i>'
        );
    } else {
        showGlassToast(
            'success',
            null,
            `Compiled and applied ${successCount} Tendai replacement${successCount === 1 ? '' : 's'}. Dynamic generation disabled for next request.`,
            false,
            3500,
            '<i class="fas fa-check"></i>'
        );
    }
}

// Delete Rentan modification (Tendai) from lock modal
async function deleteDynamicReplacementFromLockModal(globalIndex) {
    const found = findDynamicReplacementByIndex(globalIndex);
    if (!found) {
        console.error('Could not find replacement at index', globalIndex);
        showGlassToast('error', null, 'Could not find replacement', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const { replacement, arrayRef, arrayIndex } = found;

    // Show confirmation dialog
    const selectText = replacement.select_text || replacement.replace_text || 'this replacement';
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete this replacement?\n\n${selectText ? `"${selectText}"` : 'Replacement'}`,
        [
            { text: 'Cancel', value: false, className: 'btn-secondary' },
            { text: 'Delete', value: true, className: 'btn-danger' }
        ]
    );

    if (!confirmed) {
        return;
    }

    // Remove from the array
    arrayRef.splice(arrayIndex, 1);

    // Re-render the lock modal list
    if (typeof renderTextReplacementLockList === 'function') {
        renderTextReplacementLockList();
    }

    // Update the main lock button state
    if (typeof updateMainLockButtonState === 'function') {
        updateMainLockButtonState();
    }

    showGlassToast('success', null, 'Replacement deleted from compiled prompts', false, 3000, '<i class="fas fa-trash"></i>');
}

// Toggle Rentan modification (Tsubo) lock in the lock modal
function toggleDynamicReplacementLockInModal(globalIndex, lockBtn, item) {
    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        return;
    }

    // Find the replacement in the data structure
    // Rentan: Tendai Modifications
    const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;
    let replacement = null;
    let currentIndex = 0;

    const arrays = [
        { arr: textReplacements.prompt, type: 'prompt' },
        { arr: textReplacements.uc, type: 'uc' }
    ];

    if (textReplacements.character_prompts) {
        textReplacements.character_prompts.forEach((char, charIndex) => {
            if (char?.prompt) arrays.push({ arr: char.prompt, type: 'character' });
            if (char?.uc) arrays.push({ arr: char.uc, type: 'character' });
        });
    }

    for (const { arr } of arrays) {
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
            if (currentIndex === globalIndex) {
                replacement = arr[i];
                break;
            }
            currentIndex++;
        }
        if (replacement) break;
    }

    if (!replacement) {
        console.error('Could not find replacement at index', globalIndex);
        return;
    }

    // Toggle the locked state
    replacement.locked = !replacement.locked;

    // Update the UI
    const isLocked = replacement.locked;
    lockBtn.setAttribute('data-state', isLocked ? 'on' : 'off');
    if (isLocked) {
        lockBtn.classList.add('active');
        item.classList.add('selected');
    } else {
        lockBtn.classList.remove('active');
        item.classList.remove('selected');
    }

    // Update the saved locked replacements array
    if (window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        const lockedReplacements = [];
        // Rentan: Tendai Modifications
        const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;
        
        // Collect all locked dynamic replacements
        const arrays = [
            textReplacements.prompt,
            textReplacements.uc
        ];
        
        if (textReplacements.character_prompts) {
            textReplacements.character_prompts.forEach(char => {
                if (char?.prompt) arrays.push(char.prompt);
                if (char?.uc) arrays.push(char.uc);
            });
        }
        
        arrays.forEach(arr => {
            if (arr) {
                arr.forEach(rep => {
                    if (rep.locked === true) {
                        lockedReplacements.push(rep);
                    }
                });
            }
        });
        
        window.lockedDynamicReplacements = lockedReplacements;
    }

    // Update the main lock button state
    if (typeof updateMainLockButtonState === 'function') {
        updateMainLockButtonState();
    }

    // Show feedback
    const statusText = isLocked ? 'locked for AI maintenance' : 'unlocked';
    showGlassToast('success', null, `Replacement ${statusText}`, false, 2000, '<i class="fas fa-lock"></i>');
}

// Set emphasis value for a dynamic replacement
async function setDynamicReplacementEmphasis(globalIndex, itemElement) {
    const found = findDynamicReplacementByIndex(globalIndex);
    if (!found) {
        console.error('Could not find replacement at index', globalIndex);
        showGlassToast('error', null, 'Could not find replacement', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const { replacement } = found;
    
    // Get current emphasis value (default to 1.0 if not set)
    const currentEmphasis = replacement.segment_emphasis !== null && replacement.segment_emphasis !== undefined 
        ? String(replacement.segment_emphasis) 
        : '1.0';
    
    // Show input dialog to get new emphasis value
    // showInputDialog returns the input value if OK is clicked, null if cancelled
    const inputValue = await showInputDialog(
        'Enter emphasis value (e.g., 1.0, 1.2, 0.8, -0.5):',
        currentEmphasis,
        '1.0',
        [
            { text: 'Set', value: 'ok', className: 'btn-primary' },
            { text: 'Cancel', value: null, className: 'btn-secondary' },
        ]
    );
    
    if (inputValue === null || inputValue === '') {
        return; // User cancelled or entered empty value
    }
    
    // Parse and validate the value
    const emphasisValue = parseFloat(inputValue);
    if (isNaN(emphasisValue)) {
        showGlassToast('error', null, 'Invalid emphasis value. Must be a number.', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    
    // Set the emphasis value
    replacement.segment_emphasis = emphasisValue;
    
    // Re-render the lock modal list to show updated emphasis
    if (typeof renderTextReplacementLockList === 'function') {
        renderTextReplacementLockList();
    }
    
    showGlassToast('success', null, `Emphasis set to ${emphasisValue.toFixed(1)}`, false, 2000, '<i class="fas fa-dial"></i>');
}



function wireTextReplacementLockModalListeners() {
    if (document.body.dataset.textReplacementLockModalWired === 'true') return;
    document.body.dataset.textReplacementLockModalWired = 'true';

    if (textReplacementLockBtn) {
        textReplacementLockBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!inspectorEditorHasLoadedData()) {
                showGlassToast('warning', null, 'No Data to Inspector.', false, 3000, '<i class="fas fa-glasses-round"></i>');
                return;
            }
            renderTextReplacementModal();
            linkToolWindowToParent(textReplacementLockModal, manualModal);
            openModal(textReplacementLockModal);
        });

        const lockBtnContextMenu = {
            sections: [
                {
                    type: 'list',
                    title: 'Renkin System',
                    items: [],
                    initfn: function (section, target) {
                        section.items.length = 0;
                        const textReplacements = window.lastGenerationTextReplacements || [];
                        if (textReplacements.length === 0) {
                            section.items.push({
                                text: 'No Expanders',
                                icon: 'fas fa-info-circle',
                                disabled: true
                            });
                        } else {
                            textReplacements.forEach((seed, index) => {
                                const isLocked = seed.locked === true;
                                const canLock = seed.can_lock !== undefined ? seed.can_lock !== false : true;
                                const displayKey = seed.key ? `!${seed.key}` : 'Unknown';
                                section.items.push({
                                    text: displayKey,
                                    icon: isLocked ? 'fas fa-lock' : 'fas fa-unlock',
                                    className: isLocked ? 'text-success' : '',
                                    disabled: !canLock,
                                    keepMenuOpen: true,
                                    action: canLock ? `toggleTextReplacementLock_${index}` : null,
                                    loadfn: function (item, target) {
                                        const allReplacements = window.lastGenerationTextReplacements || [];
                                        const currentSeed = allReplacements[index];
                                        if (currentSeed) {
                                            const currentlyLocked = currentSeed.locked === true;
                                            item.icon = currentlyLocked ? 'fas fa-lock' : 'fas fa-unlock';
                                            item.className = currentlyLocked ? 'text-success' : '';
                                            item.checked = currentlyLocked;
                                        }
                                    }
                                });
                            });
                        }
                    }
                },
                {
                    type: 'list',
                    items: [
                        { text: 'Lock All', icon: 'fas fa-lock', action: 'lockAllReplacements' },
                        { text: 'Unlock All', icon: 'fas fa-unlock', action: 'unlockAllReplacements' },
                        { text: 'Compile Tendai', icon: 'fas fa-wand-magic-sparkles', action: 'compileTendaiReplacements' },
                        {
                            text: 'Delete Managed',
                            icon: 'fas fa-trash-alt',
                            action: 'deleteManagedPhases',
                            loadfn: function (item) {
                                // hasManagedBracketArtifacts: public/scripts/comp/bracketGenerationApplet.js
                                const hasManaged = hasManagedBracketArtifacts();
                                item.disabled = !hasManaged;
                            }
                        }
                    ]
                }
            ]
        };
        contextMenu.attachToElement(textReplacementLockBtn, lockBtnContextMenu);
    }

    if (closeTextReplacementLockModalBtn) {
        closeTextReplacementLockModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const lockedSeeds = currentTextReplacementSeeds.filter(seed => seed.locked === true);
            window.lockedTextReplacements = lockedSeeds;
            closeModal(textReplacementLockModal);
        });
    }

    const toggleCompiledPromptsSectionBtn = document.getElementById('toggleCompiledPromptsSectionBtn');
    if (toggleCompiledPromptsSectionBtn) {
        toggleCompiledPromptsSectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleCompiledPromptsSection();
        });
    }

    const refreshInspectorTextReplacementsBtn = document.getElementById('refreshInspectorTextReplacementsBtn');
    if (refreshInspectorTextReplacementsBtn) {
        refreshInspectorTextReplacementsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            refreshInspectorTextReplacementsFromPrompts();
        });
    }

    const textReplacementActionsDropdownBtn = document.getElementById('textReplacementActionsDropdownBtn');
    if (textReplacementActionsDropdownBtn && contextMenu) {
        const textReplacementActionsClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'end',
            maxHeight: 280,
            sections: [{
                type: 'list',
                items: [
                    { text: 'Select All', icon: 'fas fa-check-square', action: 'text-replacement-select-all' },
                    { text: 'Deselect All', icon: 'fas fa-square', action: 'text-replacement-deselect-all' },
                    { separator: true },
                    { text: 'Global Expanders', icon: 'fas fa-book-font', action: 'text-replacement-open-global' },
                    { text: 'Local Expanders', icon: 'fas fa-notebook', action: 'text-replacement-open-local' }
                ]
            }],
            onAction: (action) => {
                if (action === 'text-replacement-select-all') {
                    selectAllTextReplacements();
                } else if (action === 'text-replacement-deselect-all') {
                    deselectAllTextReplacements();
                } else if (action === 'text-replacement-open-global') {
                    showTextReplacementManager();
                } else if (action === 'text-replacement-open-local') {
                    showRequestBodyReplacementsModal();
                }
            }
        };
        contextMenu.attachClickMenuToElement(textReplacementActionsDropdownBtn, textReplacementActionsClickMenuConfig);
    }

    const closeManualSelectionModalBtn = document.getElementById('closeTextReplacementManualSelectionModalBtn');
    const applyManualSelectionBtn = document.getElementById('applyManualSelectionBtn');
    const randomSelectionBtn = document.getElementById('randomSelectionBtn');

    if (closeManualSelectionModalBtn) {
        closeManualSelectionModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const modal = document.getElementById('textReplacementManualSelectionModal');
            closeModal(modal);
        });
    }

    if (applyManualSelectionBtn) {
        applyManualSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            applyManualSelection();
        });
    }

    if (randomSelectionBtn) {
        randomSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentManualSelectionSeed && currentManualSelectionIndex !== null) {
                const menuElement = document.getElementById('manualSelectionDropdownMenu');
                const selectedElement = document.getElementById('manualSelectionDropdownSelected');
                if (menuElement && selectedElement) {
                    const optionElements = menuElement.querySelectorAll('.custom-dropdown-option[data-value][data-key][data-index]');
                    if (optionElements.length > 0) {
                        const randomOption = optionElements[Math.floor(Math.random() * optionElements.length)];
                        copyTextReplacementOptionToSeed(currentManualSelectionSeed, {
                            value: randomOption.dataset.value,
                            key: randomOption.dataset.key,
                            index: parseInt(randomOption.dataset.index, 10),
                            nax_tag: randomOption.dataset.naxTag,
                            nax_gallery_slug: randomOption.dataset.naxGallerySlug,
                            nax_preset_id: randomOption.dataset.naxPresetId,
                            nax_kind: randomOption.dataset.naxKind
                        });
                        currentManualSelectionSeed.locked = true;
                        selectedElement.textContent = currentManualSelectionSeed.value;
                        updateTextReplacementLockItem(currentManualSelectionIndex, currentManualSelectionSeed);
                        const item = document.querySelector(`.text-replacement-lock-item[data-index="${currentManualSelectionIndex}"]`);
                        if (item) {
                            item.classList.add('selected');
                            const lockButton = item.querySelector('.text-replacement-lock-btn');
                            if (lockButton) {
                                lockButton.setAttribute('data-state', 'on');
                            }
                        }
                        updateLockStatusText();
                        const lockedSeeds = currentTextReplacementSeeds.filter(s => s.locked === true);
                        window.lockedTextReplacements = lockedSeeds;
                        updateMainLockButtonState();
                    }
                }
            }
        });
    }
}


// Initialize when DOM is loaded
window.wsClient.registerInitStep(45, 'Initializing Text Replacement Manager', async () => {
    initializeTextReplacementManager();
    initializeFavoritesManager();
});
// TEXT REPLACEMENT LOCK MODAL FUNCTIONS
let currentTextReplacementSeeds = [];

function copyTextReplacementOptionToSeed(seed, option) {
    if (!seed || !option) return;
    seed.value = option.value;
    seed.key = option.key;
    seed.index = option.index;
    if (option.nax_tag != null) seed.nax_tag = option.nax_tag;
    if (option.nax_gallery_slug != null) seed.nax_gallery_slug = option.nax_gallery_slug;
    if (option.nax_preset_id != null) seed.nax_preset_id = option.nax_preset_id;
    if (option.nax_kind != null) seed.nax_kind = option.nax_kind;
}

// Helper function to get display-friendly replacement type names
function getReplacementTypeDisplay(type) {
    switch (type) {
        case 'incrementing':
            return 'Incrementing';
        case 'bracketed_incrementing':
        case 'bracketed_expanded':
        case 'bracketed_prefix':
        case 'bracketed_expanded_pick':
        case 'bracketed_prefix_pick':
        case 'bracketed_expanded_combine':
        case 'bracketed_prefix_combine':
        case 'combine':
            return 'Random';
        case 'combine_incrementing':
            return 'Incrementing (pool)';
        case 'pick_incrementing':
            return 'Incrementing (pick)';
        case 'regular':
            return 'Static';
        case 'nax_internal':
            return 'Atelier';
        default:
            return type.charAt(0).toUpperCase() + type.slice(1);
    }
}

// Get icon for replacement type
function getReplacementTypeIcon(type) {
    switch (type) {
        case 'incrementing':
            return '<i class="fas fa-arrow-up-1-9"></i>';
        case 'bracketed_incrementing':
        case 'bracketed_expanded':
        case 'bracketed_prefix':
        case 'bracketed_expanded_pick':
        case 'bracketed_prefix_pick':
        case 'bracketed_expanded_combine':
        case 'bracketed_prefix_combine':
        case 'combine':
            return '<i class="fas fa-dice"></i>';
        case 'combine_incrementing':
            return '<i class="fas fa-arrow-up-1-9"></i>';
        case 'pick_incrementing':
            return '<i class="fas fa-arrow-up-1-9"></i>';
        case 'regular':
            return '<i class="fas fa-arrows-rotate"></i>';
        case 'nax_internal':
            return '<i class="fas fa-flask"></i>';
        default:
            return '<i class="fas fa-tag"></i>';
    }
}

// Get location badge class based on source
function getLocationBadgeClass(source) {
    const sourceLower = source.toLowerCase();
    if (sourceLower.includes('prompt') || sourceLower === 'prompt') {
        return 'location-prompt';
    } else if (sourceLower.includes('negative') || sourceLower.includes('uc') || sourceLower === 'negative_prompt' || sourceLower === 'input_prompt_negative') {
        return 'location-uc';
    } else if (sourceLower.includes('character')) {
        return 'location-character';
    }
    return '';
}

function getLocationIcon(source) {
    const sourceLower = source.toLowerCase();
    if (sourceLower.includes('prompt') || sourceLower === 'prompt') {
        return '<i class="ri-code-block"></i>';
    } else if (sourceLower.includes('negative') || sourceLower.includes('uc') || sourceLower === 'negative_prompt' || sourceLower === 'input_prompt_negative') {
        return '<i class="ri-eraser-fill"></i>';
    } else if (sourceLower.includes('character')) {
        return '<i class="fas fa-user"></i>';
    }
    return '<i class="fas fa-circle"></i>';
}

function getLocationColor(source) {
    const sourceLower = source.toLowerCase();
    if (sourceLower.includes('prompt') || sourceLower === 'prompt') {
        return '#81ffcb';
    } else if (sourceLower.includes('negative') || sourceLower.includes('uc') || sourceLower === 'negative_prompt' || sourceLower === 'input_prompt_negative') {
        return '#ff8199';
    } else if (sourceLower.includes('character')) {
        return '#b481ff';
    }
    return 'var(--text-secondary)';
}

function getReplacementTypeColor(type) {
    switch (type) {
        case 'incrementing':
            return '#81b4ff'; // Blue for sequential/incrementing
        case 'bracketed_incrementing':
        case 'bracketed_expanded':
        case 'bracketed_prefix':
        case 'bracketed_expanded_pick':
        case 'bracketed_prefix_pick':
        case 'bracketed_expanded_combine':
        case 'bracketed_prefix_combine':
        case 'combine':
            return '#ff81ff'; // Pink/purple for random/combine
        case 'combine_incrementing':
        case 'pick_incrementing':
            return '#81b4ff'; // Blue for sequential
        case 'regular':
            return '#ffb981'; // Orange for standard replacement
        case 'nax_internal':
            return '#c9a0ff'; // Atelier / NAX expanders
        default:
            return '#9ca3af'; // Gray for default
    }
}

function hasEmphasisGroup(text) { return hasEmphasisGroupForDisplay(text); }


// Get icon for dynamic replacement category (based on schema-defined categories)
function getCategoryIcon(category) {
    const categoryLower = (category || '').toLowerCase();

    // Schema-defined categories from dynamicGenerationHandlers.js:
    // 'Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Dialog', 
    // 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere'

    if (categoryLower.includes('weather')) {
        return '<i class="fas fa-cloud-rain"></i>';
    } else if (categoryLower.includes('time of day') || categoryLower.includes('time')) {
        return '<i class="fas fa-clock"></i>';
    } else if (categoryLower.includes('seasonal')) {
        return '<i class="fas fa-leaf"></i>';
    } else if (categoryLower.includes('holiday')) {
        return '<i class="fas fa-calendar-star"></i>';
    } else if (categoryLower.includes('spelling')) {
        return '<i class="fas fa-spell-check"></i>';
    } else if (categoryLower.includes('text overlay') || categoryLower.includes('overlay')) {
        return '<i class="fas fa-comment-dots"></i>';
    } else if (categoryLower.includes('conflict resolution') || categoryLower.includes('conflict')) {
        return '<i class="fas fa-wrench"></i>';
    } else if (categoryLower.includes('enhancement') || categoryLower.includes('enhance')) {
        return '<i class="fas fa-sparkles"></i>';
    } else if (categoryLower.includes('lighting') || categoryLower.includes('light')) {
        return '<i class="fas fa-lightbulb"></i>';
    } else if (categoryLower.includes('atmosphere')) {
        return '<i class="fas fa-cloud-sun"></i>';
    } else if (categoryLower.includes('action verb') || categoryLower.includes('action')) {
        return '<i class="fas fa-running"></i>';
    } else if (categoryLower.includes('directive')) {
        return '<i class="fas fa-bullseye"></i>';
    }

    return '<i class="fas fa-tag"></i>';
}

// Toggle compiled prompts section visibility
function toggleCompiledPromptsSection() {
    const toggleBtn = document.getElementById('toggleCompiledPromptsSectionBtn');
    const expandableSection = document.getElementById('compiledPromptExpandableSection');

    if (!toggleBtn || !expandableSection) return;

    const isHidden = expandableSection.classList.contains('hidden');

    if (isHidden) {
        expandableSection.classList.remove('hidden');
        toggleBtn.innerHTML = '<i class="fas fa-subtitles"></i>';
        toggleBtn.classList.add('active');
    } else {
        expandableSection.classList.add('hidden');
        toggleBtn.innerHTML = '<i class="fa-regular fa-subtitles"></i>';
        toggleBtn.classList.remove('active');
    }
}

// Populate compiled prompts section with emphasis highlighting
function populateCompiledPromptsSection() {
    const expandableSection = document.getElementById('compiledPromptExpandableSection');
    const noDataMessage = document.getElementById('compiledPromptsNoData');
    const basePromptDisplay = document.getElementById('compiledBasePromptDisplay');
    const basePromptOverlay = document.getElementById('compiledBasePromptOverlay');
    const basePromptContainer = document.getElementById('compiledBasePromptContainer');
    const baseUcDisplay = document.getElementById('compiledBaseUcDisplay');
    const baseUcOverlay = document.getElementById('compiledBaseUcOverlay');
    const baseUcContainer = document.getElementById('compiledBaseUcContainer');
    const characterPromptsContainer = document.getElementById('compiledCharacterPromptsContainer');

    if (!expandableSection) return;

    // Get metadata from the last generation or current preview image
    const metadata = window.currentManualPreviewImage?.metadata || window.lastGeneration?.metadata;
    const sessionCp = window.dynamicGenerationData?.compiled_prompt;

    const pickCharacterPromptsArray = (cp) => {
        if (!cp) return null;
        const arr = cp.characterPrompts || cp.character_prompts;
        return Array.isArray(arr) && arr.length > 0 ? arr : null;
    };

    let finalPrompt = '';
    let finalUc = '';
    let finalCharacterPrompts = [];

    if (metadata) {
        if (typeof metadata.compiled_prompt === 'string') {
            finalPrompt = metadata.compiled_prompt;
        } else {
            const dgCp = metadata.dynamic_generation?.compiled_prompt;
            finalPrompt = (dgCp && dgCp.prompt) || metadata.prompt || '';
            if (!finalPrompt && sessionCp) {
                finalPrompt = sessionCp.prompt || '';
            }
        }

        if (metadata.compiled_uc !== undefined && metadata.compiled_uc !== null) {
            finalUc = metadata.compiled_uc;
        } else {
            const dgCpUc = metadata.dynamic_generation?.compiled_prompt;
            finalUc = (dgCpUc && dgCpUc.uc) || metadata.uc || '';
            if (!finalUc && sessionCp) {
                finalUc = sessionCp.uc || '';
            }
        }

        if (metadata.compiled_characterPrompts && Array.isArray(metadata.compiled_characterPrompts) && metadata.compiled_characterPrompts.length > 0) {
            finalCharacterPrompts = metadata.compiled_characterPrompts;
        } else {
            const dgCp = metadata.dynamic_generation?.compiled_prompt;
            const fromDg = pickCharacterPromptsArray(dgCp);
            if (fromDg) {
                finalCharacterPrompts = fromDg;
            } else if (metadata.characterPrompts && Array.isArray(metadata.characterPrompts) && metadata.characterPrompts.length > 0) {
                finalCharacterPrompts = metadata.characterPrompts;
            } else {
                const fromSessionChars = pickCharacterPromptsArray(sessionCp);
                if (fromSessionChars) {
                    finalCharacterPrompts = fromSessionChars;
                }
            }
        }
    } else if (sessionCp) {
        finalPrompt = sessionCp.prompt || '';
        finalUc = sessionCp.uc || '';
        const fromSession = pickCharacterPromptsArray(sessionCp);
        if (fromSession) {
            finalCharacterPrompts = fromSession;
        }
    }

    const hasPrompt = finalPrompt && String(finalPrompt).trim();
    const hasUc = finalUc && String(finalUc).trim();
    const hasChars = finalCharacterPrompts && finalCharacterPrompts.length > 0;

    if (!hasPrompt && !hasUc && !hasChars) {
        // No metadata available, show message
        if (noDataMessage) noDataMessage.classList.remove('hidden');
        if (basePromptContainer) basePromptContainer.classList.add('hidden');
        if (baseUcContainer) baseUcContainer.classList.add('hidden');
        if (characterPromptsContainer) characterPromptsContainer.innerHTML = '';
        return;
    }

    // Hide no data message
    if (noDataMessage) noDataMessage.classList.add('hidden');

    // Populate base prompt
    if (finalPrompt && finalPrompt.trim()) {
        basePromptContainer.classList.remove('hidden');
        basePromptDisplay.textContent = finalPrompt;

        // Apply emphasis highlighting
        const highlightedHtml = highlightEmphasisInText(finalPrompt);
        basePromptOverlay.innerHTML = highlightedHtml;
    } else {
        basePromptContainer.classList.add('hidden');
    }

    // Populate base UC
    if (finalUc && finalUc.trim()) {
        baseUcContainer.classList.remove('hidden');
        baseUcDisplay.textContent = finalUc;

        // Apply emphasis highlighting
        const highlightedHtml = highlightEmphasisInText(finalUc);
        baseUcOverlay.innerHTML = highlightedHtml;
    } else {
        baseUcContainer.classList.add('hidden');
    }

    // Populate character prompts
    if (characterPromptsContainer) {
        characterPromptsContainer.innerHTML = '';

        if (finalCharacterPrompts && Array.isArray(finalCharacterPrompts)) {
            finalCharacterPrompts.forEach((char, index) => {
                if (!char.prompt && !char.uc) return; // Skip if both are empty

                const charContainer = document.createElement('div');
                charContainer.className = 'compiled-prompt-field-container';

                // Character name/label
                const charName = char.chara_name || char.name || `Character ${index + 1}`;

                // Character input prompt
                if (char.prompt && char.prompt.trim()) {
                    const charInputLabel = document.createElement('label');
                    charInputLabel.className = 'compiled-prompt-label';
                    charInputLabel.innerHTML = `<i class="ri-code-block"></i> Prompt - ${charName}`;

                    const charInputWrapper = document.createElement('div');
                    charInputWrapper.className = 'compiled-prompt-display-wrapper';

                    const charInputDisplay = document.createElement('div');
                    charInputDisplay.className = 'compiled-prompt-display';
                    charInputDisplay.textContent = char.prompt;

                    const charInputOverlay = document.createElement('div');
                    charInputOverlay.className = 'emphasis-highlight-overlay';

                    // Apply emphasis highlighting
                    charInputOverlay.innerHTML = highlightEmphasisInText(char.prompt);

                    charInputWrapper.appendChild(charInputDisplay);
                    charInputWrapper.appendChild(charInputOverlay);

                    charContainer.appendChild(charInputLabel);
                    charContainer.appendChild(charInputWrapper);
                }

                // Character UC
                if (char.uc && char.uc.trim()) {
                    const charUcLabel = document.createElement('label');
                    charUcLabel.className = 'compiled-prompt-label';
                    charUcLabel.innerHTML = `<i class="ri-eraser-fill"></i> Negative - ${charName}`;

                    const charUcWrapper = document.createElement('div');
                    charUcWrapper.className = 'compiled-prompt-display-wrapper';

                    const charUcDisplay = document.createElement('div');
                    charUcDisplay.className = 'compiled-prompt-display';
                    charUcDisplay.textContent = char.uc;

                    const charUcOverlay = document.createElement('div');
                    charUcOverlay.className = 'emphasis-highlight-overlay';

                    // Apply emphasis highlighting
                    charUcOverlay.innerHTML = highlightEmphasisInText(char.uc);

                    charUcWrapper.appendChild(charUcDisplay);
                    charUcWrapper.appendChild(charUcOverlay);

                    charContainer.appendChild(charUcLabel);
                    charContainer.appendChild(charUcWrapper);
                }

                characterPromptsContainer.appendChild(charContainer);
            });
        }
    }
}

function getInspectorAppliedTextReplacementSeeds() {
    if (Array.isArray(window.lastGenerationTextReplacements) && window.lastGenerationTextReplacements.length > 0) {
        return window.lastGenerationTextReplacements.slice();
    }
    const metadata = window.currentManualPreviewImage?.metadata || window.lastGeneration;
    const fromPreview = metadata?.text_replacements_seed || metadata?.forge_data?.text_replacements_seed;
    if (Array.isArray(fromPreview) && fromPreview.length > 0) {
        return fromPreview.slice();
    }
    return [];
}

/** Editor has loaded prompt/metadata — Inspector may open even before generation. collectManualFormValues: manualModalManager.js */
function inspectorEditorHasLoadedData() {
    if (typeof collectManualFormValues === 'function') {
        const values = collectManualFormValues();
        if (values.prompt?.trim() || values.uc?.trim() || values.input_prompt_negative?.trim()) {
            return true;
        }
        if (Array.isArray(values.characterPrompts) && values.characterPrompts.some(c => c.prompt?.trim() || c.uc?.trim())) {
            return true;
        }
    }
    if (window.currentManualPreviewImage?.metadata) return true;
    if (window.lastGeneration) return true;
    if (window.dynamicGenerationData?.compiled_prompt) return true;
    if (Array.isArray(window.lastGenerationTextReplacements) && window.lastGenerationTextReplacements.length > 0) {
        return true;
    }
    return false;
}

function syncInspectorTextReplacementsToLoadedMetadata(seeds) {
    const normalized = Array.isArray(seeds) ? seeds : [];
    window.lastGenerationTextReplacements = normalized;
    window.lockedTextReplacements = normalized.filter(s => s.locked === true);

    if (window.currentManualPreviewImage?.metadata) {
        window.currentManualPreviewImage.metadata.text_replacements_seed = normalized;
        if (window.currentManualPreviewImage.metadata.forge_data) {
            window.currentManualPreviewImage.metadata.forge_data.text_replacements_seed = normalized;
        }
    }
    if (window.lastGeneration && typeof window.lastGeneration === 'object') {
        window.lastGeneration.text_replacements_seed = normalized;
        if (window.lastGeneration.forge_data) {
            window.lastGeneration.forge_data.text_replacements_seed = normalized;
        }
    }

    updateMainLockButtonState();
    if (typeof refreshTokenBarCounts === 'function') {
        refreshTokenBarCounts();
    }
}

async function refreshInspectorTextReplacementsFromPrompts() {
    if (!inspectorEditorHasLoadedData()) {
        showGlassToast('warning', null, 'No editor data loaded to scan.', false, 3000, '<i class="fas fa-glasses-round"></i>');
        return;
    }

    const refreshBtn = document.getElementById('refreshInspectorTextReplacementsBtn');
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        const values = collectManualFormValues();
        const payload = {
            prompt: values.prompt,
            uc: values.uc,
            input_prompt_negative: values.input_prompt_negative,
            allCharacterPrompts: values.characterPrompts,
            model: values.model,
            presetName: values.presetName,
            text_replacements: values.text_replacements,
            text_replacements_seed: window.lastGenerationTextReplacements || [],
            dynamic_generation: window.dynamicGenerationData,
            periodKey: window.currentPeriodKey
        };

        const result = await window.wsClient.sendMessage('scan_text_replacements', payload);
        if (!result?.success) {
            throw new Error(result?.error || 'Scan failed');
        }

        const seeds = Array.isArray(result.text_replacements_seed) ? result.text_replacements_seed : [];
        syncInspectorTextReplacementsToLoadedMetadata(seeds);
        refreshTextReplacementLockModalIfOpen();

        const addedMsg = seeds.length === 1 ? '1 expander' : `${seeds.length} expanders`;
        showGlassToast('success', null, seeds.length > 0 ? `Found ${addedMsg} in prompts` : 'No expanders found in prompts', false, 2500, '<i class="fas fa-rotate"></i>');
    } catch (error) {
        console.error('Error refreshing inspector text replacements:', error);
        showGlassToast('error', null, error.message || 'Failed to scan prompts for expanders', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

// ============================================================================
// TEXT REPLACEMENT LOCK MODAL (textReplacementManager.js)
// ============================================================================

function buildInspectorStageTargetBadgeHtml(seed) {
    if (!hasReplacementStageConfiguration(seed?.body_replacement_stages)) return '';
    return `<div class="text-replacement-stages text-replacement-stage-scope" title="Replacement stage scope">${getStagesDisplayText(seed.body_replacement_stages)}</div>`;
}

// Open the Genso lock modal
function renderTextReplacementModal() {
    const modal = document.getElementById('textReplacementLockModal');
    const listContainer = document.getElementById('textReplacementLockList');

    if (!modal || !listContainer) {
        return;
    }

    // Clear previous content
    listContainer.innerHTML = '';

    currentTextReplacementSeeds = getInspectorAppliedTextReplacementSeeds();

    // Populate compiled prompts section
    populateCompiledPromptsSection();

    // Render the Genso list
    renderTextReplacementLockList();

    // Scroll the list container to the top
    const scrollableContainer = document.getElementById('textReplacementLockListContainer');
    if (scrollableContainer) {
        scrollableContainer.querySelector('.scrollable-content').scrollTop = 0;
    }
}

// Refresh the Genso lock modal if it's currently open
function refreshTextReplacementLockModalIfOpen() {
    const modal = document.getElementById('textReplacementLockModal');

    // Check if modal exists and is currently visible (not hidden)
    if (!modal || modal.classList.contains('hidden')) {
        return;
    }

    renderTextReplacementModal();
}

// Select all Genso
function selectAllTextReplacements() {
    const buttons = document.querySelectorAll('.text-replacement-lock-btn');
    buttons.forEach(button => {
        const item = button.closest('.text-replacement-lock-item');
        const index = parseInt(item.dataset.index);

        // Update UI
        item.classList.add('selected');
        button.setAttribute('data-state', 'on');

        // Update data
        if (currentTextReplacementSeeds[index]) {
            currentTextReplacementSeeds[index].locked = true;
        }
    });

    const lockedSeeds = currentTextReplacementSeeds.filter(seed => seed.locked === true);
    window.lockedTextReplacements = lockedSeeds;

    updateLockStatusText();
}

// Deselect all text replacements
function deselectAllTextReplacements() {
    const buttons = document.querySelectorAll('.text-replacement-lock-btn');
    buttons.forEach(button => {
        const item = button.closest('.text-replacement-lock-item');
        const index = parseInt(item.dataset.index);

        // Update UI
        item.classList.remove('selected');
        button.setAttribute('data-state', 'off');

        // Update data
        if (currentTextReplacementSeeds[index]) {
            currentTextReplacementSeeds[index].locked = false;
        }
    });

    window.lockedTextReplacements = [];

    updateLockStatusText();
}

// Update the lock status text in the modal
function updateLockStatusText() {
    const statusText = document.getElementById('textReplacementLockStatusText');
    if (!statusText) return;

    const selectedCount = document.querySelectorAll('.text-replacement-lock-item.selected').length;
    const lockableCount = document.querySelectorAll('.text-replacement-lock-btn').length;

    if (lockableCount === 0) {
        statusText.textContent = 'No lockable replacements';
        return;
    }

    if (selectedCount === 0) {
        statusText.textContent = 'No replacements locked';
    } else if (selectedCount === lockableCount) {
        statusText.textContent = 'All lockable replacements locked';
    } else {
        statusText.textContent = `${selectedCount} of ${lockableCount} lockable replacements locked`;
    }
}

// Update the main lock button indicator state
function updateMainLockButtonState() {
    if (!textReplacementLockBtn) return;

    const lockedCount = window.lockedTextReplacements ? window.lockedTextReplacements.length : 0;

    // Count ALL Genso seeds (not just lockable)
    const allSeedsCount = window.lastGenerationTextReplacements ? window.lastGenerationTextReplacements.length : 0;
    const lockableSeedsCount = window.lastGenerationTextReplacements ?
        window.lastGenerationTextReplacements.filter(r => r.can_lock !== undefined ? r.can_lock !== false : true).length : 0;

    // Check for Rentan modifications (Tendai)
    let dynamicReplacementsCount = 0;
    if (window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        // Rentan: Tendai Modifications
        const dtr = window.dynamicGenerationData.compiled_prompt.text_replacements;
        if (dtr.prompt) dynamicReplacementsCount += dtr.prompt.length;
        if (dtr.uc) dynamicReplacementsCount += dtr.uc.length;
        if (dtr.character_prompts) {
            dtr.character_prompts.forEach(char => {
                if (char?.prompt) dynamicReplacementsCount += char.prompt.length;
                if (char?.uc) dynamicReplacementsCount += char.uc.length;
            });
        }
    }

    const totalReplacementsAvailable = allSeedsCount + dynamicReplacementsCount;

    if (totalReplacementsAvailable === 0) {
        if (inspectorEditorHasLoadedData()) {
            textReplacementLockBtn.removeAttribute('disabled');
            textReplacementLockBtn.setAttribute('data-state', 'off');
            textReplacementLockBtn.title = 'Open Inspector';
        } else {
            textReplacementLockBtn.setAttribute('disabled', '');
            textReplacementLockBtn.setAttribute('data-state', 'off');
            textReplacementLockBtn.title = 'No Genso Expanders Available';
        }
    } else {
        // Replacements available, show button
        textReplacementLockBtn.removeAttribute('disabled', '');

        if (lockedCount === 0) {
            // None locked, button is off
            textReplacementLockBtn.setAttribute('data-state', 'off');
            const tooltipParts = [];
            if (allSeedsCount > 0) tooltipParts.push(`${allSeedsCount} Expander${allSeedsCount !== 1 ? 's' : ''}`);
            if (dynamicReplacementsCount > 0) tooltipParts.push(`${dynamicReplacementsCount} Tsubo${dynamicReplacementsCount !== 1 ? 's' : ''}`);
            textReplacementLockBtn.title = tooltipParts.length > 0 ? tooltipParts.join(' + ') + ' available' : 'Open Genso and Rentan';
        } else if (lockedCount === lockableSeedsCount && lockableSeedsCount > 0 && dynamicReplacementsCount === 0) {
            // All lockable seeds are locked, button is on (only if no dynamic replacements)
            textReplacementLockBtn.setAttribute('data-state', 'on');
            textReplacementLockBtn.title = 'All Lockable Expanders or Tsubo\'s locked';
        } else {
            // Some locked or dynamic replacements present, button is partial
            textReplacementLockBtn.setAttribute('data-state', 'partial');
            const tooltipParts = [];
            if (lockedCount > 0) tooltipParts.push(`${lockedCount} locked`);
            if (lockableSeedsCount - lockedCount > 0) tooltipParts.push(`${lockableSeedsCount - lockedCount} unlocked`);
            if (dynamicReplacementsCount > 0) tooltipParts.push(`${dynamicReplacementsCount} Tsubo`);
            textReplacementLockBtn.title = tooltipParts.join(', ');
        }
    }
}

// Text replacement manual selection modal variables
let currentManualSelectionSeed = null;
let currentManualSelectionIndex = null;

// Open text replacement manual selection modal
let manualSelectionDropdownWired = false;

// Initialize manual selection modal dropdown (called once during app initialization)
function initializeManualSelectionDropdown() {
    if (manualSelectionDropdownWired) {
        return;
    }
    manualSelectionDropdownWired = true;

    const container = document.getElementById('manualSelectionDropdownContainer');
    const button = document.getElementById('manualSelectionDropdownBtn');
    const menu = document.getElementById('manualSelectionDropdownMenu');

    if (container && button && menu) {
        setupDropdown(
            container,
            button,
            menu,
            () => { }, // No render function needed as we populate manually
            () => document.getElementById('manualSelectionDropdownSelected').textContent,
            { preventFocusTransfer: true }
        );
    }
}

async function openTextReplacementManualSelectionModal(seed, index) {
    currentManualSelectionSeed = seed;
    currentManualSelectionIndex = index;

    const modal = document.getElementById('textReplacementManualSelectionModal');
    const selectedElement = document.getElementById('manualSelectionDropdownSelected');
    const menuElement = document.getElementById('manualSelectionDropdownMenu');

    if (!modal || !selectedElement || !menuElement) {
        return;
    }


    // Set initial selected value
    selectedElement.textContent = 'Loading options...';

    // Clear menu
    menuElement.innerHTML = '';

    // Request options from server
    try {
        const result = await window.wsClient.sendMessage('get_text_replacement_options', {
            pattern: seed.pattern || `!${seed.key}`,
            presetName: seed.presetName,
            model: window.currentModel,
            periodKey: window.currentPeriodKey
        });

        if (result && result.success && result.options) {
            populateManualSelectionDropdown(result.options, seed.value);
        } else {
            selectedElement.textContent = 'No options available';
            menuElement.innerHTML = '<div class="custom-dropdown-option">No options available</div>';
        }
    } catch (error) {
        selectedElement.textContent = 'Error loading options';
        menuElement.innerHTML = '<div class="custom-dropdown-option">Error loading options</div>';
    }

    openModal(modal);
}

// Populate the manual selection dropdown with options
function populateManualSelectionDropdown(options, currentValue) {
    const selectedElement = document.getElementById('manualSelectionDropdownSelected');
    const menuElement = document.getElementById('manualSelectionDropdownMenu');

    if (!selectedElement || !menuElement) return;

    // Set current selection - find the option that matches currentValue
    const currentOption = options.find(opt => opt.value === currentValue);
    selectedElement.textContent = currentOption ? currentOption.value : (currentValue || 'Select an option...');

    // Clear menu
    menuElement.innerHTML = '';

    // Add options
    options.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option' +
            (option.value === currentValue ? ' selected' : '');
        optionElement.dataset.value = option.value;
        optionElement.dataset.key = option.key;
        optionElement.dataset.index = option.index;
        if (option.nax_tag != null) optionElement.dataset.naxTag = option.nax_tag;
        if (option.nax_gallery_slug != null) optionElement.dataset.naxGallerySlug = option.nax_gallery_slug;
        if (option.nax_preset_id != null) optionElement.dataset.naxPresetId = option.nax_preset_id;
        if (option.nax_kind != null) optionElement.dataset.naxKind = option.nax_kind;
        optionElement.textContent = option.value;

        optionElement.addEventListener('click', () => {
            selectedElement.textContent = option.value;
            closeDropdown(menuElement, document.getElementById('manualSelectionDropdownBtn'));

            if (currentManualSelectionSeed) {
                copyTextReplacementOptionToSeed(currentManualSelectionSeed, option);
            }
        });

        menuElement.appendChild(optionElement);
    });
}

// Apply manual selection
function applyManualSelection() {
    if (!currentManualSelectionSeed || currentManualSelectionIndex === null) return;

    const selectedElement = document.getElementById('manualSelectionDropdownSelected');
    if (!selectedElement) return;

    const selectedValue = selectedElement.textContent;
    if (selectedValue === 'Select an option...' || selectedValue === 'Loading options...' || selectedValue === 'No options available' || selectedValue === 'Error loading options') {
        return;
    }

    // The seed data should already be updated by the dropdown click handler
    // Just make sure it's locked
    currentManualSelectionSeed.locked = true;

    // Update the UI in the lock modal to show it's locked
    updateTextReplacementLockItem(currentManualSelectionIndex, currentManualSelectionSeed);

    // Also update the lock button state in the UI
    const item = document.querySelector(`.text-replacement-lock-item[data-index="${currentManualSelectionIndex}"]`);
    if (item) {
        // Mark as selected (locked)
        item.classList.add('selected');
        // Update the lock button state
        const lockButton = item.querySelector('.text-replacement-lock-btn');
        if (lockButton) {
            lockButton.setAttribute('data-state', 'on');
        }
    }

    // Update the lock status text
    updateLockStatusText();

    // Update the locked replacements for immediate use in generation
    const lockedSeeds = currentTextReplacementSeeds.filter(seed => seed.locked === true);
    window.lockedTextReplacements = lockedSeeds;

    // Update the main lock button indicator
    updateMainLockButtonState();

    // Close the modal
    const modal = document.getElementById('textReplacementManualSelectionModal');
    closeModal(modal);
}

// Select random text replacement
function selectRandomTextReplacement(seed, index) {
    // Request options from server to get all possible values
    window.wsClient.sendMessage('get_text_replacement_options', {
        pattern: seed.pattern || `!${seed.key}`,
        presetName: seed.presetName,
        model: window.currentModel,
        periodKey: window.currentPeriodKey
    }).then(result => {
        if (result && result.success && result.options && result.options.length > 0) {
            const randomOption = result.options[Math.floor(Math.random() * result.options.length)];

            copyTextReplacementOptionToSeed(seed, randomOption);
            seed.locked = true;
            seed.can_lock = true;

            // Update the UI in the lock modal
            updateTextReplacementLockItem(index, seed);

            // Also update the lock button state in the UI
            const item = document.querySelector(`.text-replacement-lock-item[data-index="${index}"]`);
            if (item) {
                // Mark as selected (locked)
                item.classList.add('selected');
                // Update the lock button state
                const lockButton = item.querySelector('.text-replacement-lock-btn');
                if (lockButton) {
                    lockButton.setAttribute('data-state', 'on');
                }
            }

            // Update the lock status text
            updateLockStatusText();

            // Update the locked replacements for immediate use in generation
            const lockedSeeds = currentTextReplacementSeeds.filter(s => s.locked === true);
            window.lockedTextReplacements = lockedSeeds;

            // Update the main lock button indicator
            updateMainLockButtonState();
        } else {
            console.warn('No options available for random selection');
        }
    }).catch(error => {
        console.error('Error getting options for random selection:', error);
    });
}

// Resolve prompt textarea for a text-replacement seed source (server assigns sources; merge is server-side)
function getTextareaForReplacementSource(source) {
    if (!source) return null;
    if (source === 'prompt') return document.getElementById('manualPrompt');
    if (source === 'negative_prompt') return document.getElementById('manualUc');
    if (source === 'input_prompt_negative') return document.getElementById('manualPromptNegative');
    if (!source.startsWith('character_') || !characterPromptsContainer) return null;

    const charIndex = parseInt(source.split('_')[1], 10);
    if (isNaN(charIndex)) return null;
    const item = characterPromptsContainer.querySelectorAll('.character-prompt-item')[charIndex];
    if (!item) return null;

    if (source.endsWith('_input_prompt_negative')) {
        return document.getElementById(`${item.id}_promptNegative`);
    }
    if (source.endsWith('_uc')) {
        return document.getElementById(`${item.id}_uc`);
    }
    if (source.endsWith('_prompt')) {
        return document.getElementById(`${item.id}_prompt`);
    }
    return null;
}

// Replace placeholder in the corresponding prompt textarea
function replacePlaceholderInPrompt(seed, index) {
    const textarea = getTextareaForReplacementSource(seed.source);
    if (!textarea) {
        console.warn('Could not find textarea for replacement source:', seed.source);
        return;
    }

    // Get the original pattern to replace
    const patternToReplace = seed.pattern || `!${seed.key}`;

    // Escape special regex characters in the pattern
    const escapedPattern = patternToReplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace the pattern with the resolved value
    const currentText = textarea.value;
    const newText = currentText.replace(new RegExp(escapedPattern, 'g'), seed.value);

    // Update the textarea
    textarea.value = newText;

    // Trigger input event to update any dependent UI
    const inputEvent = new Event('input', { bubbles: true });
    textarea.dispatchEvent(inputEvent);

    // Remove this replacement from the current seeds and locked replacements
    removeTextReplacement(index);

    // Show a brief success indication
    showGlassToast('success', null, `Replaced "${patternToReplace}" with "${seed.value}" and removed from replacements`, false, 2500, '<i class="fas fa-exchange-alt"></i>');
}

// Remove a text replacement from both current seeds and locked replacements
function removeTextReplacement(index) {
    // Remove from current text replacement seeds
    if (currentTextReplacementSeeds && currentTextReplacementSeeds[index]) {
        currentTextReplacementSeeds.splice(index, 1);

        // Update the indices of remaining items and refresh the UI
        const modal = document.getElementById('textReplacementLockModal');
        if (modal) {
            const listContainer = modal.querySelector('.text-replacement-lock-list');
            if (listContainer) {
                // Re-render the entire list with updated indices
                renderTextReplacementLockList();
            }
        }
    }

    // Remove from locked replacements if it exists there
    if (window.lockedTextReplacements && Array.isArray(window.lockedTextReplacements)) {
        // Find and remove the replacement at the specified index
        if (window.lockedTextReplacements[index]) {
            window.lockedTextReplacements.splice(index, 1);
        }
    }

    // Update the main lock button indicator
    updateMainLockButtonState();
}

// Re-render the text replacement lock list after changes
function renderTextReplacementLockList() {
    const listContainer = document.getElementById('textReplacementLockList');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    // Check if we have any replacements (Genso seeds or Rentan modifications)
    let hasDynamicReplacements = false;
    if (window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        // Rentan: Tendai Modifications
        const tr = window.dynamicGenerationData.compiled_prompt.text_replacements;
        hasDynamicReplacements = (tr.prompt?.length > 0) || (tr.uc?.length > 0) ||
            (tr.character_prompts?.some(char => char?.prompt?.length > 0 || char?.uc?.length > 0));
    }

    if (currentTextReplacementSeeds.length === 0 && !hasDynamicReplacements) {
        const emptyHint = inspectorEditorHasLoadedData()
            ? 'No Expanders in use, Click Refresh to scan prompts for prefixes.'
            : 'No Genso Expanders Available. Load data or generate an image first.';
        listContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-secondary);">${emptyHint}</div>`;
        updateLockStatusText();
        return;
    }

    currentTextReplacementSeeds.forEach((seed, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'text-replacement-lock-item';
        itemDiv.dataset.index = index;

        const isLocked = seed.locked === true;
        const canLock = seed.can_lock !== undefined ? seed.can_lock !== false : true;
        const canResolve = seed.can_resolve !== undefined ? seed.can_resolve !== false : canLock;

        itemDiv.classList.toggle('selected', isLocked);

        const stageTargetBadge = buildInspectorStageTargetBadgeHtml(seed);

        // Check if source is UC/negative and add class
        const source = seed.source || '';
        if (source === 'negative_prompt' || source === 'input_prompt_negative' ||
            (source.startsWith('character_') && (source.endsWith('_uc') || source.endsWith('_input_prompt_negative')))) {
            itemDiv.classList.add('negative-prompt');
        }

        // Extract character index if it's a character prompt
        // Source format: character_${charIndex}_prompt, character_${charIndex}_uc, character_${charIndex}_input_prompt_negative
        let characterIndex = null;
        if (source.startsWith('character_')) {
            const parts = source.split('_');
            if (parts.length >= 2) {
                const indexPart = parts[1];
                const parsedIndex = parseInt(indexPart, 10);
                if (!isNaN(parsedIndex)) {
                    characterIndex = parsedIndex;
                }
            }
        }

        const indexDisplay = seed.index !== null && seed.index !== undefined ? `<span class="text-replacement-index">${seed.index}</span>` : '';
        let originalPattern = seed.pattern;
        if (!originalPattern) {
            if (seed.type && seed.type.startsWith('bracketed_')) {
                originalPattern = seed.pattern;
            } else {
                originalPattern = `!${seed.key}${seed.type === 'combine_incrementing' ? '~+#' : seed.type === 'pick_incrementing' ? '~#' : seed.type === 'combine' ? '~+' : '~'}`;
            }
        }

        const isStatic = seed.type === 'regular';
        const locationIcon = getLocationIcon(seed.source);
        const locationColor = getLocationColor(seed.source);
        const typeIcon = getReplacementTypeIcon(seed.type);
        const typeColor = getReplacementTypeColor(seed.type);

        // Build character badge if it's a character prompt
        const characterBadge = characterIndex !== null ? `
            <span class="text-replacement-badge text-replacement-badge-character">
                <i class="fas fa-person"></i>
                <span style="font-size: 0.75em;">${characterIndex + 1}</span>
            </span>
        ` : '';

        itemDiv.innerHTML = `
            <div class="text-replacement-lock-content">
                <div class="text-replacement-lock-info">
                    <div class="text-replacement-full-value">${seed.value}</div>
                </div>
                <div class="text-replacement-lock-row">
                    <div class="text-replacement-lock-badges">
                        <span class="text-replacement-badge text-replacement-badge-combined">
                            <span class="badge-icon-location" style="color: ${locationColor};">${locationIcon}</span>
                            ${characterBadge}
                            <span class="badge-icon-type" style="color: ${typeColor};">${typeIcon}</span>
                        </span>
                        ${stageTargetBadge}
                    </div>
                    <div class="text-replacement-lock-pattern">
                        ${!isStatic ? `<span class="text-replacement-original">${originalPattern}</span>
                        <i class="fas fa-arrow-right text-replacement-arrow"></i>
                        <span class="text-replacement-selected">!${seed.key}${indexDisplay}</span>` : `<span class="text-replacement-original">!${seed.key}</span>`}
                    </div>
                    <div class="text-replacement-lock-actions">
                        <button type="button" class="text-replacement-lock-btn btn-secondary btn-small toggle-btn" data-state="${isLocked ? 'on' : 'off'}" id="tr-lock-${index}">
                            <i class="fas fa-lock"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add event listeners for the buttons
        if (canLock) {
            // Lock button
            const lockButton = itemDiv.querySelector('.text-replacement-lock-btn');
            lockButton.addEventListener('click', (e) => {
                e.preventDefault();
                const isCurrentlyLocked = itemDiv.classList.contains('selected');
                const newState = !isCurrentlyLocked;

                itemDiv.classList.toggle('selected', newState);
                lockButton.setAttribute('data-state', newState ? 'on' : 'off');

                currentTextReplacementSeeds[index].locked = newState;
                updateLockStatusText();

                // Update locked replacements
                const lockedSeeds = currentTextReplacementSeeds.filter(seed => seed.locked === true);
                window.lockedTextReplacements = lockedSeeds;
                updateMainLockButtonState();
            });
        } else {
            // For non-lockable replacements, show info only
            // Check if source is UC/negative and add class
            const source = seed.source || '';
            if (source === 'negative_prompt' || source === 'input_prompt_negative' ||
                (source.startsWith('character_') && (source.endsWith('_uc') || source.endsWith('_input_prompt_negative')))) {
                itemDiv.classList.add('negative-prompt');
            }

            // Extract character index if it's a character prompt
            // Source format: character_${charIndex}_prompt, character_${charIndex}_uc, character_${charIndex}_input_prompt_negative
            let characterIndex = null;
            if (source.startsWith('character_')) {
                const parts = source.split('_');
                if (parts.length >= 2) {
                    const indexPart = parts[1];
                    const parsedIndex = parseInt(indexPart, 10);
                    if (!isNaN(parsedIndex)) {
                        characterIndex = parsedIndex;
                    }
                }
            }

            const originalPattern = seed.pattern || `!${seed.key}`;
            const isStatic = seed.type === 'regular';
            const locationIcon = getLocationIcon(seed.source);
            const locationColor = getLocationColor(seed.source);
            const typeIcon = getReplacementTypeIcon(seed.type);
            const typeColor = getReplacementTypeColor(seed.type);

            // Build character badge if it's a character prompt
            const characterBadge = characterIndex !== null ? `
                <span class="text-replacement-badge text-replacement-badge-character">
                    <i class="fas fa-person"></i>
                    <span style="font-size: 0.75em; margin-left: 2px;">${characterIndex + 1}</span>
                </span>
            ` : '';

            itemDiv.innerHTML = `
                <div class="text-replacement-lock-content">
                    <div class="text-replacement-lock-info">
                        <div class="text-replacement-full-value">${seed.value}</div>
                    </div>
                    <div class="text-replacement-lock-row">
                        <div class="text-replacement-lock-badges">
                            <span class="text-replacement-badge text-replacement-badge-combined">
                                <span class="badge-icon-location" style="color: ${locationColor};">${locationIcon}</span>
                                ${characterBadge}
                                <span class="badge-icon-type" style="color: ${typeColor};">${typeIcon}</span>
                            </span>
                            ${stageTargetBadge}
                        </div>
                        <div class="text-replacement-lock-pattern">
                            ${!isStatic ? `<span class="text-replacement-original">${originalPattern}</span>
                            <i class="fas fa-arrow-right text-replacement-arrow"></i>
                            <span class="text-replacement-selected">!${seed.key}</span>` : `<span class="text-replacement-original">!${seed.key}</span>`}
                        </div>
                    </div>
                </div>
            `;
        }

        // Add context menu to the item
        if (contextMenu) {
            contextMenu.attachToElement(itemDiv, {
                sections: [
                    {
                        type: 'icons',
                        position: 'outer',
                        icons: [
                            {
                                tooltip: 'Toggle Lock Resolution',
                                icon: 'fas fa-lock',
                                action: 'lock',
                                keepMenuOpen: true,
                                hidden: !canLock,
                                loadfn: (item, target) => {
                                    const idx = parseInt(target.dataset.index);
                                    item.checked = currentTextReplacementSeeds[idx]?.locked === true;
                                }
                            },
                            {
                                tooltip: 'Randomize Value',
                                icon: 'fas fa-dice',
                                action: 'random-selection',
                                hidden: !canLock
                            },
                            {
                                tooltip: 'Copy Value',
                                icon: 'nai-clipboard',
                                action: 'copy-value'
                            },
                            {
                                tooltip: 'Apply to Prompt',
                                icon: 'fas fa-pen-field',
                                action: 'apply-prompt'
                            },
                        ]
                    },
                    {
                        type: 'list',
                        items: [
                            {
                                text: 'Resolve to...',
                                icon: 'fas fa-book-font',
                                optionsfn: (target) => {
                                    const idx = parseInt(target.dataset.index);
                                    const seed = currentTextReplacementSeeds[idx];
                                    if (!seed) return [];

                                    // Create cache key based on seed properties (not index, as it may change)
                                    const cacheKey = `textReplacementOptions_${seed.key}_${seed.pattern || ''}_${seed.presetName || ''}_${window.currentModel || ''}_${window.currentPeriodKey || ''}`;

                                    // Initialize cache if needed
                                    if (!window.textReplacementOptionsCache) {
                                        window.textReplacementOptionsCache = {};
                                    }

                                    // Check if we have cached options for this seed
                                    if (window.textReplacementOptionsCache[cacheKey]) {
                                        const cached = window.textReplacementOptionsCache[cacheKey];

                                        // If already loading, return loading option
                                        if (cached.loading) {
                                            return [{
                                                icon: 'fas fa-spinner-third fa-spin',
                                                text: 'Please Wait...',
                                                action: 'loading-placeholder',
                                                disabled: true
                                            }];
                                        }

                                        // If we have cached options, return them
                                        if (cached.options && Array.isArray(cached.options) && cached.options.length > 0) {
                                            const distinctKeys = new Set(cached.options.map(o => o.key));
                                            const showSelectorSubtext = distinctKeys.size > 1;
                                            return cached.options.map(opt => ({
                                                icon: 'fas fa-bookmark',
                                                text: opt.value,
                                                subtext: showSelectorSubtext ? `!${opt.key}` : undefined,
                                                badge: opt.index !== null && opt.index !== undefined ? ('#' + String(opt.index)) : null,
                                                action: `select-option-${opt.value}`,
                                                data: { value: opt.value, key: opt.key, index: opt.index }
                                            }));
                                        }

                                        // If cached but no options (error or empty), return that
                                        if (cached.options && Array.isArray(cached.options) && cached.options.length === 0) {
                                            if (cached.error) {
                                                return [{
                                                    icon: 'fas fa-exclamation-triangle',
                                                    text: 'Error loading options',
                                                    action: 'error-loading',
                                                    disabled: true
                                                }];
                                            } else {
                                                return [{
                                                    icon: 'fas fa-empty-set',
                                                    text: 'No options available',
                                                    action: 'no-options',
                                                    disabled: true
                                                }];
                                            }
                                        }
                                    }

                                    // Mark as loading (prevent duplicate requests)
                                    window.textReplacementOptionsCache[cacheKey] = { loading: true };

                                    // Fetch options asynchronously
                                    window.wsClient.sendMessage('get_text_replacement_options', {
                                        pattern: seed.pattern || `!${seed.key}`,
                                        presetName: seed.presetName,
                                        model: window.currentModel,
                                        periodKey: window.currentPeriodKey
                                    }).then(result => {
                                        if (result && result.success && result.options && Array.isArray(result.options) && result.options.length > 0) {
                                            // Cache the options
                                            window.textReplacementOptionsCache[cacheKey] = {
                                                loading: false,
                                                options: result.options
                                            };

                                            // If submenu is still open, refresh it
                                            if (contextMenu && contextMenu.currentSubmenuState) {
                                                contextMenu.refreshSubmenu();
                                            }
                                        } else {
                                            // No options available (empty array, null, undefined, or no success)
                                            window.textReplacementOptionsCache[cacheKey] = {
                                                loading: false,
                                                options: [],
                                                error: false
                                            };
                                            if (contextMenu && contextMenu.currentSubmenuState) {
                                                contextMenu.refreshSubmenu();
                                            }
                                        }
                                    }).catch(error => {
                                        console.error('Error fetching text replacement options:', error);
                                        window.textReplacementOptionsCache[cacheKey] = {
                                            loading: false,
                                            options: [],
                                            error: true
                                        };
                                        if (contextMenu && contextMenu.currentSubmenuState) {
                                            contextMenu.refreshSubmenu();
                                        }
                                    });

                                    // Return loading option
                                    return [{
                                        icon: 'fas fa-spinner-third fa-spin',
                                        text: 'Please Wait...',
                                        action: 'loading-placeholder',
                                        disabled: true
                                    }];
                                },
                                handlerfn: (subItem, target) => {
                                    const action = subItem.action;
                                    if (action === 'loading-placeholder' || action === 'no-options' || action === 'error-loading') {
                                        // Do nothing for placeholder/error states
                                        return;
                                    }

                                    if (action && action.startsWith('select-option-')) {
                                        const idx = parseInt(target.dataset.index);
                                        const seed = currentTextReplacementSeeds[idx];
                                        if (!seed) return;

                                        // Get the selected option data
                                        const optionData = subItem.data;
                                        if (optionData) {
                                            // Update the seed data
                                            seed.value = optionData.value;
                                            seed.key = optionData.key;
                                            seed.index = optionData.index;
                                            seed.locked = true;
                                            seed.can_lock = true;

                                            // Update the UI in the lock modal
                                            updateTextReplacementLockItem(idx, seed);

                                            // Also update the lock button state in the UI
                                            const item = document.querySelector(`.text-replacement-lock-item[data-index="${idx}"]`);
                                            if (item) {
                                                // Mark as selected (locked)
                                                item.classList.add('selected');
                                                // Update the lock button state
                                                const lockButton = item.querySelector('.text-replacement-lock-btn');
                                                if (lockButton) {
                                                    lockButton.setAttribute('data-state', 'on');
                                                }
                                            }

                                            // Update the lock status text
                                            updateLockStatusText();

                                            // Update the locked replacements for immediate use in generation
                                            const lockedSeeds = currentTextReplacementSeeds.filter(s => s.locked === true);
                                            window.lockedTextReplacements = lockedSeeds;

                                            // Update the main lock button indicator
                                            updateMainLockButtonState();

                                            // Close the context menu after selection
                                            if (contextMenu) {
                                                contextMenu.hideMenu();
                                            }
                                        }
                                    }
                                },
                                openOnHover: false,
                                hidden: !canResolve
                            },
                        ]
                    }],
                onAction: (actionName, target) => {
                    if (actionName === 'apply-prompt') {
                        replacePlaceholderInPrompt(seed, index);
                    } else if (actionName === 'random-selection') {
                        selectRandomTextReplacement(seed, index);
                    } else if (actionName === 'copy-value') {
                        const textToCopy = seed.value || '';
                        if (textToCopy) {
                            // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
                            copyTextToClipboard(textToCopy).then(() => {
                                showGlassToast('success', null, 'Copied to clipboard', false, 2000, '<i class="nai-clipboard"></i>');
                            }).catch(err => {
                                console.error('Failed to copy:', err);
                                showGlassToast('error', null, 'Failed to copy to clipboard', false, 2000, '<i class="fas fa-exclamation-triangle"></i>');
                            });
                        }
                    } else if (actionName === 'lock') {
                        const idx = parseInt(target.dataset.index);
                        const isCurrentlyLocked = currentTextReplacementSeeds[idx]?.locked === true;
                        const newState = !isCurrentlyLocked;

                        target.classList.toggle('selected', newState);
                        const lockButton = target.querySelector('.text-replacement-lock-btn');
                        if (lockButton) {
                            lockButton.setAttribute('data-state', newState ? 'on' : 'off');
                        }

                        currentTextReplacementSeeds[idx].locked = newState;
                        updateLockStatusText();

                        const lockedSeeds = currentTextReplacementSeeds.filter(seed => seed.locked === true);
                        window.lockedTextReplacements = lockedSeeds;
                        updateMainLockButtonState();
                    }
                }
            });
        }

        listContainer.appendChild(itemDiv);
    });

    // Check if dynamic replacements exist
    const dtr = window.dynamicGenerationData?.compiled_prompt?.text_replacements;
    const replacements = [];

    // Collect all replacements from different sources (only if dtr exists)
    if (dtr && dtr.prompt && dtr.prompt.length > 0) {
        dtr.prompt.forEach((rep, index) => {
            replacements.push({ ...rep, targetType: 'prompt', targetSource: 'base', index });
        });
    }

    if (dtr && dtr.uc && dtr.uc.length > 0) {
        dtr.uc.forEach((rep, index) => {
            replacements.push({ ...rep, targetType: 'uc', targetSource: 'base', index });
        });
    }

    if (dtr && dtr.character_prompts && dtr.character_prompts.length > 0) {
        dtr.character_prompts.forEach((char, charIndex) => {
            if (char && char.prompt && char.prompt.length > 0) {
                char.prompt.forEach((rep, index) => {
                    replacements.push({ ...rep, targetType: 'character', targetSource: charIndex, targetField: 'prompt', index });
                });
            }
            if (char && char.uc && char.uc.length > 0) {
                char.uc.forEach((rep, index) => {
                    replacements.push({ ...rep, targetType: 'character', targetSource: charIndex, targetField: 'uc', index });
                });
            }
        });
    }

    if (replacements.length > 0) {
        // Add section header
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'dynamic-replacements-section-header';
        sectionHeader.innerHTML = `
            <div class="section-title">
                <i class="ri-pencil-ai-2-fill"></i>
                <span>Tendai Replacements</span>
            </div>
        `;
        listContainer.appendChild(sectionHeader);

        // Add expiration status banner if compiled prompt exists
        const compiledPrompt = window.dynamicGenerationData?.compiled_prompt;
        if (compiledPrompt && compiledPrompt.expiresAt) {
            const now = Date.now();
            const isExpired = now >= compiledPrompt.expiresAt;
            const msUntilExpiry = compiledPrompt.expiresAt - now;
            const minutesUntilExpiry = Math.round(msUntilExpiry / (60 * 1000));
            const hoursUntilExpiry = Math.round(minutesUntilExpiry / 60 * 10) / 10;
            const expiryDate = new Date(compiledPrompt.expiresAt);

            const expirationBanner = document.createElement('div');
            if (isExpired) {
                // Calculate days since expiration
                const daysSinceExpiry = Math.floor(Math.abs(msUntilExpiry) / (1000 * 60 * 60 * 24));
                const currentYear = new Date().getFullYear();
                const expiryYear = expiryDate.getFullYear();

                let expiredTimeText;
                if (daysSinceExpiry < 7) {
                    // Less than 7 days ago: "Expired X Days ago (HH:mm)"
                    const timeStr = expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    if (daysSinceExpiry === 0) {
                        expiredTimeText = `Expired Today (${timeStr})`;
                    } else {
                        const dayText = daysSinceExpiry === 1 ? '1 Day' : `${daysSinceExpiry} Days`;
                        expiredTimeText = `Expired ${dayText} ago (${timeStr})`;
                    }
                } else {
                    // 7 or more days ago: "Expired on MMM dd, YYYY (HH:mm)" with year only if different
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const month = monthNames[expiryDate.getMonth()];
                    const day = expiryDate.getDate();
                    const year = expiryYear !== currentYear ? `, ${expiryYear}` : '';
                    const timeStr = expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    expiredTimeText = `Expired on ${month} ${day}${year} (${timeStr})`;
                }

                expirationBanner.className = 'text-replacement-expiration-banner expired';
                expirationBanner.innerHTML = `
                    <i class="fas fa-triangle-exclamation"></i>
                    <div class="expiration-info">
                        <div class="expiration-status">Cache Expired</div>
                        <div class="expiration-time">${expiredTimeText}</div>
                    </div>
                `;
            } else {
                const timeText = hoursUntilExpiry >= 1
                    ? `${hoursUntilExpiry}h ${minutesUntilExpiry % 60}m`
                    : `${minutesUntilExpiry}m`;
                expirationBanner.className = 'text-replacement-expiration-banner valid';
                expirationBanner.innerHTML = `
                    <i class="fas fa-circle-check"></i>
                    <div class="expiration-info">
                        <div class="expiration-status">Cache Valid</div>
                        <div class="expiration-time">Expires at ${expiryDate.toLocaleTimeString()} (${timeText})</div>
                    </div>
                `;
            }
            listContainer.appendChild(expirationBanner);
        }

        // Add context cards from compiled prompt
        const compiled = window.dynamicGenerationData?.compiled_prompt;
        if (compiled && compiled.context) {
            const contextCardsContainer = document.createElement('div');
            contextCardsContainer.className = 'dynamic-replacements-context-cards';

            // Build context cards using the same logic from showCompiledPromptModal
            const context = compiled.context;
            const weather = context.weather || {};
            const time = context.time || {};

            // Get unit preference
            let useMetric = localStorage.getItem('weather_units_metric') !== 'false';

            // Helper functions (reuse from showCompiledPromptModal scope)
            const celsiusToFahrenheit = (celsius) => Math.round((celsius * 9 / 5) + 32);
            const mpsToMph = (mps) => Math.round(mps * 2.237);
            const getWeatherIcon = (condition, isNight = false) => {
                if (!condition) return isNight ? '<i class="wi wi-night-clear"></i>' : '<i class="wi wi-day-sunny"></i>';

                const timePrefix = isNight ? 'night-alt' : 'day';

                // Icons that don't change between day/night
                const timeNeutralIcons = {
                    'overcast': 'cloudy',
                    'fog': 'fog',
                    'depositing rime fog': 'fog',
                    'moderate snow fall': 'snow',
                    'heavy snow fall': 'snow',
                    'snow grains': 'snow',
                    'heavy snow showers': 'snow'
                };

                if (timeNeutralIcons[condition]) {
                    return `<i class="wi wi-${timeNeutralIcons[condition]}"></i>`;
                }

                // Time-dependent icons
                const iconMap = {
                    'clear sky': isNight ? 'night-clear' : 'day-sunny',
                    'mainly clear': isNight ? 'night-alt-partly-cloudy' : 'day-sunny-overcast',
                    'partly cloudy': `${timePrefix}-cloudy`,
                    'light drizzle': `${timePrefix}-showers`,
                    'moderate drizzle': `${timePrefix}-showers`,
                    'dense drizzle': `${timePrefix}-showers`,
                    'light freezing drizzle': `${timePrefix}-snow`,
                    'dense freezing drizzle': `${timePrefix}-snow`,
                    'slight rain': `${timePrefix}-rain`,
                    'moderate rain': `${timePrefix}-rain`,
                    'heavy rain': `${timePrefix}-rain`,
                    'light freezing rain': `${timePrefix}-snow`,
                    'heavy freezing rain': `${timePrefix}-snow`,
                    'slight snow fall': `${timePrefix}-snow`,
                    'slight rain showers': `${timePrefix}-showers`,
                    'moderate rain showers': `${timePrefix}-rain`,
                    'violent rain showers': `${timePrefix}-storm-showers`,
                    'slight snow showers': `${timePrefix}-snow`,
                    'thunderstorm': `${timePrefix}-thunderstorm`,
                    'thunderstorm with slight hail': `${timePrefix}-thunderstorm`,
                    'thunderstorm with heavy hail': `${timePrefix}-thunderstorm`
                };

                const iconClass = iconMap[condition] || (isNight ? 'night-clear' : 'day-sunny');
                return `<i class="wi wi-${iconClass}"></i>`;
            };
            const getWindDirection = (degrees) => {
                if (degrees === null || degrees === undefined) return 'N/A';
                const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
                const index = Math.round(degrees / 22.5) % 16;
                return directions[index];
            };

            // Build weather content
            let weatherContent = '';
            if (weather.condition || weather.temperature !== undefined) {
                // Determine if it's night based on timePeriod
                const isNight = context.timePeriod?.isDaytime === false;
                const weatherIcon = getWeatherIcon(weather.condition, isNight);
                const tempC = weather.temperature;
                const tempF = tempC !== undefined ? celsiusToFahrenheit(tempC) : null;
                const tempDisplay = useMetric ?
                    (tempC !== undefined ? `${tempC}°C` : 'N/A') :
                    (tempF !== undefined ? `${tempF}°F` : 'N/A');
                const feelsC = weather.feelsLike;
                const feelsF = feelsC !== undefined ? celsiusToFahrenheit(feelsC) : null;
                const feelsDisplay = useMetric ?
                    (feelsC !== undefined ? `${feelsC}°C` : 'N/A') :
                    (feelsF !== undefined ? `${feelsF}°F` : 'N/A');
                const windMps = weather.windSpeed;
                const windMph = windMps !== undefined ? mpsToMph(windMps) : null;
                const windDisplay = useMetric ?
                    (windMps !== undefined ? `${windMps} m/s` : 'N/A') :
                    (windMph !== undefined ? `${windMph} mph` : 'N/A');

                const weatherCondition = weather.condition || 'Unknown';
                const humidityValue = weather.humidity !== undefined ? `${weather.humidity}%` : null;
                const windDirection = weather.windDirection !== undefined ? getWindDirection(weather.windDirection) : null;

                const displayTemp = useMetric ? tempC : tempF;
                const displayFeels = useMetric ? feelsC : feelsF;

                // Determine card background
                let cardBackgroundClass = '';
                if (context.season && weather.pressure !== undefined) {
                    const seasonName = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
                    const season = typeof seasonName === 'string' ? seasonName.toLowerCase() : String(seasonName).toLowerCase();
                    const pressure = weather.pressure;

                    if (season.includes('spring')) {
                        if (pressure < 1000) cardBackgroundClass = 'season-spring-stormy';
                        else if (pressure < 1013) cardBackgroundClass = 'season-spring-unstable';
                        else if (pressure < 1020) cardBackgroundClass = 'season-spring-normal';
                        else cardBackgroundClass = 'season-spring-stable';
                    } else if (season.includes('summer')) {
                        if (pressure < 1000) cardBackgroundClass = 'season-summer-stormy';
                        else if (pressure < 1013) cardBackgroundClass = 'season-summer-unstable';
                        else if (pressure < 1020) cardBackgroundClass = 'season-summer-normal';
                        else cardBackgroundClass = 'season-summer-stable';
                    } else if (season.includes('fall') || season.includes('autumn')) {
                        if (pressure < 1000) cardBackgroundClass = 'season-fall-stormy';
                        else if (pressure < 1013) cardBackgroundClass = 'season-fall-unstable';
                        else if (pressure < 1020) cardBackgroundClass = 'season-fall-normal';
                        else cardBackgroundClass = 'season-fall-stable';
                    } else if (season.includes('winter')) {
                        if (pressure < 1000) cardBackgroundClass = 'season-winter-stormy';
                        else if (pressure < 1013) cardBackgroundClass = 'season-winter-unstable';
                        else if (pressure < 1020) cardBackgroundClass = 'season-winter-normal';
                        else cardBackgroundClass = 'season-winter-stable';
                    }
                } else if (context.season) {
                    const seasonName = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
                    const season = typeof seasonName === 'string' ? seasonName.toLowerCase() : String(seasonName).toLowerCase();
                    if (season.includes('spring')) cardBackgroundClass = 'season-spring-normal';
                    else if (season.includes('summer')) cardBackgroundClass = 'season-summer-normal';
                    else if (season.includes('fall') || season.includes('autumn')) cardBackgroundClass = 'season-fall-normal';
                    else if (season.includes('winter')) cardBackgroundClass = 'season-winter-normal';
                }

                const mainCardHtml = `
                    <div class="weather-main-card ${cardBackgroundClass}">
                        <div class="weather-current-temp">
                            <div class="weather-temp-value">
                                <span class="weather-temp-number clickable" onclick="toggleWeatherUnits(event)" data-metric="${tempC !== undefined ? tempC : ''}" data-imperial="${tempF !== undefined ? tempF : ''}">${displayTemp !== undefined ? displayTemp : '--'}</span>
                                <span class="weather-temp-unit">${useMetric ? '°C' : '°F'}</span>
                            </div>
                            ${displayFeels !== undefined ? `<div class="weather-feels-like" data-metric="${feelsC !== undefined ? feelsC : ''}" data-imperial="${feelsF !== undefined ? feelsF : ''}">Feels like ${displayFeels}°${useMetric ? 'C' : 'F'}</div>` : ''}
                        </div>
                        <div class="weather-condition-display">
                            <div class="weather-condition-icon">${weatherIcon}</div>
                            <div class="weather-condition-text">${weatherCondition}</div>
                            <div class="weather-condition-details">
                                ${humidityValue ? `<div class="weather-condition-detail"><i class="fa-solid fa-droplet"></i>${humidityValue}</div>` : ''}
                                ${windDisplay !== 'N/A' ? `<div class="weather-condition-detail"><i class="fa-solid fa-wind"></i><span class="weather-wind-speed" data-metric="${windMps !== undefined ? windMps : ''}" data-imperial="${windMph !== undefined ? windMph : ''}">${windDisplay}</span>${windDirection ? ` (${windDirection})` : ''}</div>` : ''}
                            </div>
                        </div>
                        ${weather.cloudCoverage !== undefined || weather.visibility !== undefined || weather.uvIndex !== undefined ? `
                        <div class="weather-card-header">
                            <div class="weather-quick-indicators">
                                ${weather.uvIndex !== undefined && weather.uvIndex > 0 ? `
                                <div class="weather-quick-indicator">
                                    <div class="weather-quick-indicator-label">
                                        <i class="fa-solid fa-sun"></i>
                                        <span>UV ${weather.uvIndex}</span>
                                    </div>
                                    <div class="weather-quick-progress-bar">
                                        <div class="weather-quick-progress-fill uv-index" style="width: ${Math.min((weather.uvIndex / 12) * 100, 100)}%"></div>
                                    </div>
                                </div>
                                ` : ''}
                                ${weather.cloudCoverage !== undefined ? `
                                <div class="weather-quick-indicator">
                                    <div class="weather-quick-indicator-label">
                                        <i class="fa-solid fa-cloud"></i>
                                        <span>${weather.cloudCoverage}%</span>
                                    </div>
                                    <div class="weather-quick-progress-bar">
                                        <div class="weather-quick-progress-fill cloud-coverage" style="width: ${weather.cloudCoverage}%"></div>
                                    </div>
                                </div>
                                ` : ''}
                                ${weather.visibility !== undefined ? `
                                <div class="weather-quick-indicator">
                                    <div class="weather-quick-indicator-label">
                                        <i class="fa-solid fa-eye"></i>
                                        <span class="weather-visibility" data-metric="${weather.visibility / 1000}" data-unit="km">${useMetric ? `${(weather.visibility / 1000).toFixed(1)} km` : `${(weather.visibility * 0.000621371).toFixed(1)} mi`}</span>
                                    </div>
                                    <div class="weather-quick-progress-bar">
                                        <div class="weather-quick-progress-fill visibility" style="width: ${Math.min((weather.visibility / 10000) * 100, 100)}%"></div>
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `;

                weatherContent = `<div class="weather-display">${mainCardHtml}</div>`;
            }

            // Build period card
            let periodCardHtml = '';
            const timePeriodInfo = context.timePeriod || {};

            // Calculate season progress and template (needed for both period and holiday cards)
            const seasonProgress = context.season ? calculateSeasonProgress(time, context.season) : 50;
            const seasonNameForTemplate = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
            const seasonForTemplate = typeof seasonNameForTemplate === 'string' ? seasonNameForTemplate : String(seasonNameForTemplate || '');
            const hasHoliday = context.season?.holiday?.primaryHoliday;

            if (context.season && timePeriodInfo.period) {
                let periodBgClass = 'period-default';
                const seasonName = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
                const season = typeof seasonName === 'string' ? seasonName.toLowerCase() : String(seasonName).toLowerCase();
                const period = timePeriodInfo.period ? timePeriodInfo.period.toLowerCase() : '';

                if (season.includes('spring')) {
                    if (period.includes('dawn') || period.includes('sunrise')) periodBgClass = 'period-spring-dawn';
                    else if (period.includes('morning')) periodBgClass = 'period-spring-morning';
                    else if (period.includes('noon') || period.includes('afternoon')) periodBgClass = 'period-spring-day';
                    else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) periodBgClass = 'period-spring-dusk';
                    else if (period.includes('night')) periodBgClass = 'period-spring-night';
                } else if (season.includes('summer')) {
                    if (period.includes('dawn') || period.includes('sunrise')) periodBgClass = 'period-summer-dawn';
                    else if (period.includes('morning') || period.includes('noon') || period.includes('afternoon')) periodBgClass = 'period-summer-day';
                    else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) periodBgClass = 'period-summer-dusk';
                    else if (period.includes('night')) periodBgClass = 'period-summer-night';
                } else if (season.includes('fall') || season.includes('autumn')) {
                    if (period.includes('dawn') || period.includes('sunrise')) periodBgClass = 'period-fall-dawn';
                    else if (period.includes('morning') || period.includes('noon') || period.includes('afternoon')) periodBgClass = 'period-fall-day';
                    else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) periodBgClass = 'period-fall-dusk';
                    else if (period.includes('night')) periodBgClass = 'period-fall-night';
                } else if (season.includes('winter')) {
                    if (period.includes('dawn') || period.includes('sunrise')) periodBgClass = 'period-winter-dawn';
                    else if (period.includes('morning') || period.includes('noon') || period.includes('afternoon')) periodBgClass = 'period-winter-day';
                    else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) periodBgClass = 'period-winter-dusk';
                    else if (period.includes('night')) periodBgClass = 'period-winter-night';
                }

                let shortTitle = 'Time';
                if (timePeriodInfo.periodKey) {
                    const periodKeyMap = {
                        'predawn': 'Pre-Dawn', 'pre_dawn': 'Pre-Dawn',
                        'dawn': 'Dawn', 'sunrise': 'Sunrise',
                        'morning': 'Morning',
                        'latemorning': 'Late Morning', 'late_morning': 'Late Morning',
                        'noon': 'Noon', 'daytime': 'Daytime',
                        'earlyafternoon': 'Early Afternoon', 'early_afternoon': 'Early Afternoon',
                        'afternoon': 'Afternoon',
                        'lateafternoon': 'Late Afternoon', 'late_afternoon': 'Late Afternoon',
                        'goldenhour': 'Golden Hour', 'golden_hour': 'Golden Hour',
                        'evening': 'Evening',
                        'sunset': 'Sunset', 'dusk': 'Dusk', 'twilight': 'Twilight',
                        'night': 'Night', 'midnight': 'Midnight',
                        'latenight': 'Late Night', 'late_night': 'Late Night'
                    };
                    shortTitle = periodKeyMap[timePeriodInfo.periodKey.toLowerCase()] ||
                        timePeriodInfo.periodKey.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                }

                const clockTime = time.hour !== undefined ? `${time.hour}:${String(time.minute || 0).padStart(2, '0')}` : '';
                const dateStr = time.dayOfWeekName && time.monthName ?
                    `${time.dayOfWeekName}, ${time.monthName} ${time.dayOfMonth}, ${time.year}` :
                    (time.month !== undefined && time.dayOfMonth !== undefined && time.year !== undefined ?
                        `${time.month + 1}/${time.dayOfMonth}/${time.year}` : '');
                const location = context.location || {};
                const locationText = location.city && location.country ?
                    `${location.city}, ${location.country}` :
                    location.city || location.country || '';

                const sunProgressRaw = timePeriodInfo.sunProgressRaw !== undefined ? timePeriodInfo.sunProgressRaw : 0;
                const lightLevelRaw = timePeriodInfo.lightLevelRaw !== undefined ? timePeriodInfo.lightLevelRaw : 0;
                const sunPhase = timePeriodInfo.sunPhase || 'rising';
                let sunPositionPercent;
                if (sunPhase === 'rising') {
                    // Rising: sunProgressRaw 0-0.5 maps to 0-50% of total bar
                    sunPositionPercent = (sunProgressRaw / 0.5) * 50;
                } else if (sunPhase === 'setting') {
                    // Setting: sunProgressRaw 0.5-1.0 maps to 50-100% of total bar
                    sunPositionPercent = 50 + ((sunProgressRaw - 0.5) / 0.5) * 50;
                } else {
                    sunPositionPercent = sunPhase === 'pre-dawn' ? 0 : (sunPhase === 'post-dusk' ? 100 : 50);
                }

                periodCardHtml = `
                    <div class="period-info-card ${periodBgClass}">
                        <div class="period-info-content">
                            <div class="period-main-info">
                                <div class="period-title-section">
                                    <div class="period-title clickable" onclick="togglePeriodDetails(this)">
                                        ${shortTitle}
                                        <i class="fa-solid fa-chevron-down period-expand-icon"></i>
                                    </div>
                                    ${context.season ? `<div class="period-season-badge season-${seasonForTemplate.toLowerCase()}">${getSeasonIcon(seasonForTemplate)} ${seasonForTemplate}</div>` : ''}
                                    ${time.hour !== undefined ? `
                                    <div class="period-title-indicators">
                                        ${context.season ? `
                                        <div class="period-title-indicator">
                                            <div class="period-title-indicator-label">
                                                <span>Season</span>
                                                <span class="period-title-indicator-value">${seasonProgress}%</span>
                                            </div>
                                            <div class="period-title-progress-bar season-position season-${seasonForTemplate.toLowerCase()}">
                                                <div class="period-progress-marker" style="left: ${seasonProgress}%"></div>
                                            </div>
                                        </div>
                                        ` : ''}
                                        ${lightLevelRaw !== undefined && lightLevelRaw > 0 ? `
                                        <div class="period-title-indicator">
                                            <div class="period-title-indicator-label">
                                                <span>Sun</span>
                                            </div>
                                            <div class="period-title-progress-bar sun-position">
                                                <div class="period-progress-marker" style="left: ${sunPositionPercent}%"></div>
                                            </div>
                                        </div>
                                        <div class="period-title-indicator">
                                            <div class="period-title-indicator-label">
                                                <span>Light</span>
                                            </div>
                                            <div class="period-title-progress-bar light-level">
                                                <div class="period-progress-fill light-level" style="width: ${lightLevelRaw * 10}%"></div>
                                            </div>
                                        </div>
                                        ` : ''}
                                    </div>
                                    ` : ''}
                                </div>
                                ${clockTime || dateStr || locationText ? `
                                <div class="period-time-date">
                                    ${clockTime ? `<div class="period-time">${clockTime}</div>` : ''}
                                    ${dateStr ? `<div class="period-date">${dateStr}</div>` : ''}
                                    ${locationText ? `<div class="period-location"><i class="fas fa-map-marker-alt"></i> ${locationText}</div>` : ''}
                                </div>
                                ` : ''}
                            </div>
                            <div class="period-details hidden">
                                ${timePeriodInfo.lighting ? `<div class="period-detail"><i class="fa-solid fa-lightbulb"></i><div class="detail-content"><div class="detail-label">Lighting</div><div class="detail-value selectable">${Array.isArray(timePeriodInfo.lighting) ? timePeriodInfo.lighting.map(el => {
                    const text = typeof el === 'object' ? el.text : el;
                    const bias = typeof el === 'object' ? el.bias : 1.0;
                    return `${text} (${bias.toFixed(2)})`;
                }).join(', ') : timePeriodInfo.lighting}</div></div></div>` : ''}
                                ${timePeriodInfo.atmosphere ? `<div class="period-detail"><i class="fa-solid fa-smog"></i><div class="detail-content"><div class="detail-label">Atmosphere</div><div class="detail-value selectable">${Array.isArray(timePeriodInfo.atmosphere) ? timePeriodInfo.atmosphere.map(el => {
                    const text = typeof el === 'object' ? el.text : el;
                    const bias = typeof el === 'object' ? el.bias : 1.0;
                    return `${text} (${bias.toFixed(2)})`;
                }).join(', ') : timePeriodInfo.atmosphere}</div></div></div>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }

            // Build holiday card
            let holidayCardHtml = '';
            if (hasHoliday) {
                const holiday = context.season.holiday;
                const holidayName = holiday.primaryHoliday?.name || 'Holiday';
                const daysUntil = holiday.primaryHoliday?.daysUntil ?? holiday.progressiveElements?.daysUntil;
                const daysUntilText = daysUntil !== undefined && daysUntil !== null ? daysUntil : '?';
                const daysUntilLabel = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'day' : 'days';

                // Calculate holiday progress (0-100%)
                let holidayProgress = 50; // Default
                if (daysUntil !== undefined && daysUntil !== null) {
                    // Assume holiday has a buffer period (e.g., 30 days before/after)
                    const bufferDays = 30;
                    if (daysUntil >= 0 && daysUntil <= bufferDays) {
                        // Before holiday: progress increases as we approach
                        holidayProgress = Math.max(0, Math.min(100, ((bufferDays - daysUntil) / bufferDays) * 100));
                    } else if (daysUntil < 0) {
                        // After holiday: progress decreases
                        const daysPast = Math.abs(daysUntil);
                        holidayProgress = Math.max(0, Math.min(100, ((bufferDays - daysPast) / bufferDays) * 100));
                    }
                }

                // Get holiday data
                const holidayData = holiday.primaryHoliday || {};
                const atmosphere = holidayData.atmosphere || holiday.atmosphere || '';
                const decorations = holidayData.decorations || holiday.decorations || '';
                const colors = holidayData.colors || holiday.colors || '';
                const activities = holidayData.activities || holiday.activities || '';

                // Get country flag icon and region name based on region
                const getCountryFlagIcon = (region) => {
                    const flagMap = {
                        'us': 'fa-flag-usa',
                        'asia': 'fa-flag',
                        'japan': 'fa-flag'
                    };
                    return flagMap[region?.toLowerCase()] || 'fa-flag';
                };
                const getRegionName = (region) => {
                    const regionMap = {
                        'us': 'United States',
                        'asia': 'Asia',
                        'japan': 'Japan'
                    };
                    return regionMap[region?.toLowerCase()] || region || 'Global';
                };
                // Get holiday CSS class name
                const getHolidayClass = (name) => {
                    if (!name) return 'holiday-default';
                    const nameLower = name.toLowerCase();
                    // Map holiday names to CSS classes
                    if (nameLower.includes('christmas') || nameLower.includes('holiday season')) return 'holiday-christmas';
                    if (nameLower.includes('new year') && !nameLower.includes('japanese') && !nameLower.includes('chinese')) return 'holiday-new-year';
                    if (nameLower.includes('halloween')) return 'holiday-halloween';
                    if (nameLower.includes('thanksgiving')) return 'holiday-thanksgiving';
                    if (nameLower.includes('independence day') || nameLower.includes('4th of july')) return 'holiday-independence-day';
                    if (nameLower.includes('valentine')) return 'holiday-valentines-day';
                    if (nameLower.includes('easter') || nameLower.includes('spring holiday')) return 'holiday-easter';
                    if (nameLower.includes('chinese new year')) return 'holiday-chinese-new-year';
                    if (nameLower.includes('setsubun')) return 'holiday-setsubun';
                    if (nameLower.includes('hinamatsuri')) return 'holiday-hinamatsuri';
                    if (nameLower.includes('summer festival')) return 'holiday-summer-festival';
                    if (nameLower.includes('japanese new year') || nameLower.includes('oshogatsu')) return 'holiday-japanese-new-year';
                    if (nameLower.includes('cherry blossom') || nameLower.includes('hanami')) return 'holiday-cherry-blossom';
                    if (nameLower.includes('tanabata') || nameLower.includes('star festival')) return 'holiday-tanabata';
                    if (nameLower.includes('golden week') || nameLower.includes('shukujitsu')) return 'holiday-golden-week';
                    if (nameLower.includes('children') || nameLower.includes('kodomo')) return 'holiday-childrens-day';
                    if (nameLower.includes('mid-autumn') || nameLower.includes('tsukimi')) return 'holiday-mid-autumn';
                    if (nameLower.includes('obon') || nameLower.includes('bon odori')) return 'holiday-obon';
                    return 'holiday-default';
                };
                const region = holidayData.region || holiday.region || 'us';
                const flagIconClass = getCountryFlagIcon(region);
                const regionName = getRegionName(region);
                const holidayClass = getHolidayClass(holidayName);

                holidayCardHtml = `
                    <div class="period-info-card holiday-info-card ${holidayClass}">
                        <div class="period-info-content">
                            <div class="period-main-info">
                                <div class="period-title-section">
                                    <div class="period-title clickable" onclick="togglePeriodDetails(this)">
                                        ${holidayName}
                                        <i class="fa-solid fa-chevron-down period-expand-icon"></i>
                                    </div>
                                    ${time.hour !== undefined ? `
                                    <div class="period-title-indicators">
                                        <div class="period-season-badge">
                                            <i class="fa-solid ${flagIconClass}"></i>
                                            <span>${regionName}</span>
                                        </div>
                                        <div class="period-title-indicator">
                                            <div class="period-title-indicator-label">
                                                <span>Holiday</span>
                                                <span class="period-title-indicator-value">${holidayProgress.toFixed(0)}%</span>
                                            </div>
                                            <div class="period-title-progress-bar light-level">
                                                <div class="period-progress-fill light-level" style="width: ${holidayProgress}%"></div>
                                            </div>
                                        </div>
                                    </div>
                                    ` : ''}
                                </div>
                                <div class="period-time-date">
                                    <div class="period-time" style="font-size: 1.5rem; font-weight: 600;">
                                        ${daysUntilText} ${daysUntilLabel}
                                    </div>
                                </div>
                            </div>
                            <div class="period-details hidden">
                                ${atmosphere ? `<div class="period-detail"><i class="fa-solid fa-smog"></i><div class="detail-content"><div class="detail-label">Atmosphere</div><div class="detail-value selectable">${atmosphere}</div></div></div>` : ''}
                                ${decorations ? `<div class="period-detail"><i class="fa-solid fa-gifts"></i><div class="detail-content"><div class="detail-label">Decorations</div><div class="detail-value selectable">${decorations}</div></div></div>` : ''}
                                ${colors ? `<div class="period-detail"><i class="fa-solid fa-palette"></i><div class="detail-content"><div class="detail-label">Colors</div><div class="detail-value selectable">${colors}</div></div></div>` : ''}
                                ${activities ? `<div class="period-detail"><i class="fa-solid fa-people-group"></i><div class="detail-content"><div class="detail-label">Activities</div><div class="detail-value selectable">${activities}</div></div></div>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }

            // Combine context cards
            const contextCardsHtml = periodCardHtml + holidayCardHtml + weatherContent;
            if (contextCardsHtml) {
                contextCardsContainer.innerHTML = contextCardsHtml;
                listContainer.appendChild(contextCardsContainer);
            }
        }

        // Render each replacement (reuse the same function from textReplacementManager.js)
        replacements.forEach((replacement, globalIndex) => {
            const itemElement = createDynamicReplacementItemForLockModal(replacement, globalIndex);
            listContainer.appendChild(itemElement);
        });
    }

    // Usage section (render phases, calls, per-tool rows with icons/background, reasons, token totals)
    try {
        const usageRoot =
            window.dynamicGenerationData?.compiled_prompt?.usage ||
            window.lastGeneration?.forge_data?.dynamic_generation?.compiled_prompt?.usage ||
            null;
        if (usageRoot && typeof usageRoot === 'object') {
            // Header
            const usageHeader = document.createElement('div');
            usageHeader.className = 'dynamic-replacements-section-header';
            usageHeader.innerHTML = `
                <div class="section-title">
                    <i class="fas fa-gauge-high"></i>
                    <span>Compiler Timeline & Costs</span>
                </div>
            `;
            listContainer.appendChild(usageHeader);

            // Helpers
            const getCallIcon = (call) => {
                if (!call) return '<i class="fas fa-circle"></i>';
                if (call.callType === 'tool_call') return '<i class="fas fa-wrench"></i>';
                if (call.callType === 'request') return '<i class="fas fa-code"></i>';
                return '<i class="fas fa-circle"></i>';
            };
            const formatTokens = (u) => {
                if (!u) return '';
                const toNum = (v) => {
                    if (typeof v === 'number') return v;
                    const n = Number(v);
                    return isNaN(n) ? 0 : n;
                };
                const fmt = (v) => toNum(v).toLocaleString();
                const input = u.input ?? 0;
                const output = u.output ?? 0;
                const cache = u.cache ?? 0;
                const reasoning = u.reasoning ?? 0;
                const totalRaw = (u.total !== undefined && u.total !== null)
                    ? u.total
                    : (toNum(input) + toNum(output) + toNum(cache) + toNum(reasoning));
                return `<i class="fas fa-up-right" title="Input"></i> ${fmt(input)} • <i class="fas fa-down-left" title="Output"></i> ${fmt(output)} • <i class="fas fa-cloud-check" title="Cache"></i> ${fmt(cache)} • <i class="fas fa-gears" title="Reasoning"></i> ${fmt(reasoning)} • <i class="fas fa-equals" title="Total"></i> ${fmt(totalRaw)}`;
            };

            // Check if we have both phase1 and phase2 (2 passes)
            const phaseKeys = Object.keys(usageRoot).filter(key => key === 'phase1' || key === 'phase2');
            const hasTwoPasses = phaseKeys.length === 2 && usageRoot.phase1 && usageRoot.phase2;

            Object.keys(usageRoot).forEach((phaseKey) => {
                const phaseData = usageRoot[phaseKey];
                if (!phaseData) return;

                // Map phase keys to display names
                const phaseDisplayName = phaseKey === 'phase1' ? 'Pass 1' :
                    phaseKey === 'phase2' ? 'Pass 2' :
                        phaseKey;

                // Phase header with totals
                // Use the final call's usage for totals (stateful APIs return cumulative totals)
                let phaseTotals = phaseData.total;
                const calls = Array.isArray(phaseData.calls) ? phaseData.calls : [];

                // Handle case where phaseData.total is an array (multiple usage snapshots)
                if (Array.isArray(phaseTotals) && phaseTotals.length > 0) {
                    // Use the last element (most recent/cumulative totals)
                    phaseTotals = phaseTotals[phaseTotals.length - 1];
                }

                // Check if phaseTotals is missing or all zeros
                const isTotalsEmpty = !phaseTotals || phaseTotals.total === 0;

                // If total is missing or all zeros, use the last call's usage
                if (isTotalsEmpty && calls.length > 0) {
                    // Find the last call with usage data
                    const lastCallWithUsage = [...calls].reverse().find(call => call && call.usage);
                    if (lastCallWithUsage && lastCallWithUsage.usage) {
                        phaseTotals = {
                            total: lastCallWithUsage.usage.total || 0,
                            input: lastCallWithUsage.usage.input || 0,
                            output: lastCallWithUsage.usage.output || 0,
                            cache: lastCallWithUsage.usage.cache || 0,
                            reasoning: lastCallWithUsage.usage.reasoning || 0
                        };
                    } else {
                        phaseTotals = null;
                    }
                }

                // Only show totals if we have meaningful data
                const hasValidTotals = phaseTotals && (phaseTotals.total > 0 || phaseTotals.input > 0 || phaseTotals.output > 0 || phaseTotals.cache > 0 || phaseTotals.reasoning > 0);

                // Only create and append header if we have valid totals
                if (hasValidTotals) {
                    const phaseHeader = document.createElement('div');
                    phaseHeader.className = 'usage-phase-header';
                    // Show phase title when there are 2 passes
                    if (hasTwoPasses && (phaseKey === 'phase1' || phaseKey === 'phase2')) {
                        phaseHeader.innerHTML = `
                            <div class="phase-title">
                                <i class="fas fa-diagram-project"></i>
                                <span>${phaseDisplayName}</span>
                            </div>
                            <div style="color: var(--hover-show-colored-text); font-size: 12px;">${formatTokens(phaseTotals)}</div>
                        `;
                    } else {
                        // Single phase - just show totals
                        phaseHeader.innerHTML = `
                            <div style="color: var(--hover-show-colored-text); font-size: 12px;">${formatTokens(phaseTotals)}</div>
                        `;
                    }
                    listContainer.appendChild(phaseHeader);
                }
                calls.forEach((call) => {
                    const callDiv = document.createElement('div');
                    callDiv.className = 'text-replacement-lock-item usage-call';

                    const typeIcon = getCallIcon(call);
                    const tokens = formatTokens(call.usage || {});

                    if (call.callType === 'tool_call' && Array.isArray(call.tools) && call.tools.length > 0) {
                        // Build inner per-tool rows: name row and reason row, colored with toast manager background/icon
                        const toolsBlocks = call.tools.map((t) => {
                            const toolName = t?.name || '';
                            const toolStyle = getToolIconAndBackground(toolName, 'completed');
                            const display = getToolDisplayName(toolName) || toolName || 'Tool';
                            const toolParams = t?.parameters || {};
                            // Reason priority: tool.reason -> parameters.reason -> call.reason
                            const toolReason = (t && t.reason) || (toolParams && toolParams.reason) || call.reason || '';
                            const tagReasons = (toolName === 'searchTagsBatch' && Array.isArray(toolParams?.tags)) ? toolParams.tags : null;

                            // Special handling for publishAnalysisResults
                            if (toolName === 'publishAnalysisResults') {
                                const { prompt_breakdown, image_analysis, existing_context } = toolParams;

                                // Build prompt breakdown section
                                let promptBreakdownHtml = '';
                                if (prompt_breakdown) {
                                    const { main_subject, scene_environment, actions_poses, mood_atmosphere, style_elements } = prompt_breakdown;
                                    promptBreakdownHtml = `
                                        <div class="usage-tool-section">
                                            <div class="usage-section-header">
                                                <i class="fas fa-file-alt"></i>
                                                <span>Prompt Analysis</span>
                                            </div>
                                            <div class="usage-section-content">
                                                ${main_subject ? `<div class="usage-detail-row"><span class="usage-detail-label">Subject:</span><span class="usage-detail-value selectable">${main_subject}</span></div>` : ''}
                                                ${scene_environment ? `<div class="usage-detail-row"><span class="usage-detail-label">Environment:</span><span class="usage-detail-value selectable">${scene_environment}</span></div>` : ''}
                                                ${mood_atmosphere ? `<div class="usage-detail-row"><span class="usage-detail-label">Mood:</span><span class="usage-detail-value selectable">${mood_atmosphere}</span></div>` : ''}
                                                ${actions_poses && actions_poses.length > 0 ? `<div class="usage-detail-row"><span class="usage-detail-label">Actions:</span><span class="usage-detail-value selectable">${actions_poses.join(', ')}</span></div>` : ''}
                                                ${style_elements && style_elements.length > 0 ? `<div class="usage-detail-row"><span class="usage-detail-label">Style:</span><span class="usage-detail-value selectable">${style_elements.join(', ')}</span></div>` : ''}
                                            </div>
                                        </div>
                                    `;
                                }

                                // Build image analysis section
                                let imageAnalysisHtml = '';
                                if (image_analysis) {
                                    const { visual_elements, time_visible, weather_visible, scene_type_visible, matches_prompt, differences } = image_analysis;
                                    imageAnalysisHtml = `
                                        <div class="usage-tool-section">
                                            <div class="usage-section-header">
                                                <i class="fas fa-image"></i>
                                                <span>Image Analysis</span>
                                            </div>
                                            <div class="usage-section-content">
                                                ${time_visible ? `<div class="usage-detail-row"><span class="usage-detail-label">Time:</span><span class="usage-detail-value selectable">${time_visible}</span></div>` : ''}
                                                ${weather_visible ? `<div class="usage-detail-row"><span class="usage-detail-label">Weather:</span><span class="usage-detail-value selectable">${weather_visible}</span></div>` : ''}
                                                ${scene_type_visible ? `<div class="usage-detail-row"><span class="usage-detail-label">Scene Type:</span><span class="usage-detail-value selectable">${scene_type_visible}</span></div>` : ''}
                                                <div class="usage-detail-row"><span class="usage-detail-label">Matches Prompt:</span><span class="usage-detail-value ${matches_prompt ? 'match-yes' : 'match-no'}">${matches_prompt ? 'Yes' : 'No'}</span></div>
                                                ${visual_elements && visual_elements.length > 0 ? `<div class="usage-detail-row"><span class="usage-detail-label">Elements:</span><span class="usage-detail-value selectable">${visual_elements.join(', ')}</span></div>` : ''}
                                                ${differences && differences.length > 0 ? `<div class="usage-detail-row"><span class="usage-detail-label">Differences:</span><span class="usage-detail-value selectable">${differences.join(', ')}</span></div>` : ''}
                                            </div>
                                        </div>
                                    `;
                                }

                                // Build context detection section (existing logic)
                                let contextDetectionHtml = '';
                                if (existing_context) {
                                    const contextFields = ['time', 'season', 'holiday', 'location', 'weather_condition', 'sky'];
                                    const detectedIcons = contextFields.map(fieldName => {
                                        const field = existing_context[fieldName];
                                        let isMuted = true;
                                        let tooltipText = fieldName;

                                        if (field) {
                                            if (fieldName === 'location') {
                                                const sceneType = field.scene_type || 'unknown';
                                                isMuted = sceneType === 'unknown';
                                                tooltipText = `Location: ${sceneType}`;
                                            } else if (field.found && field.value && field.value !== 'none') {
                                                isMuted = false;
                                                tooltipText = `${fieldName}: ${field.value}`;
                                            } else {
                                                tooltipText = `${fieldName}: Not found`;
                                            }
                                        } else {
                                            tooltipText = `${fieldName}: Not found`;
                                        }

                                        const iconClass = getContextFieldIcon(fieldName);

                                        return `
                                            <span class="usage-context-icon ${isMuted ? 'muted' : ''}" title="${tooltipText}">
                                                <i class="fas ${iconClass}"></i>
                                            </span>
                                        `;
                                    }).join('');

                                    const sceneType = existing_context.location?.scene_type || 'unknown';

                                    contextDetectionHtml = `
                                        <div class="usage-tool-section">
                                            <div class="usage-section-header">
                                                <i class="fas fa-search"></i>
                                                <span>Context Detection</span>
                                            </div>
                                            <div class="usage-section-content">
                                                <div class="usage-context-row">
                                                    <span class="usage-context-label">Detected:</span>
                                                    <div class="usage-context-icons">
                                                        ${detectedIcons}
                                                    </div>
                                                </div>
                                                ${sceneType !== 'unknown' ? `
                                                <div class="usage-context-row">
                                                    <span class="usage-context-label">Scene:</span>
                                                    <span class="usage-context-value selectable">${sceneType}</span>
                                                </div>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }

                                return `
                                    <div class="usage-tool-block expanded" style="background: ${toolStyle.backgroundColor};">
                                        <div class="usage-tool-name-row">
                                            <div class="usage-tool-icon">${toolStyle.icon}</div>
                                            <div class="text-replacement-lock-pattern">
                                                <span class="usage-tool-name selectable">${display}</span>
                                            </div>
                                        </div>
                                        ${promptBreakdownHtml}
                                        ${imageAnalysisHtml}
                                        ${contextDetectionHtml}
                                    </div>
                                `;
                            }

                            // Special handling for planTextReplacements
                            if (toolName === 'planTextReplacements') {
                                const { planned_changes, research, conflicts_to_resolve } = toolParams;
                                const plannedChanges = Array.isArray(planned_changes) ? planned_changes : [];
                                const researchCompleted = research?.completed || [];
                                const researchNeeded = research?.needed || [];
                                const conflictsToResolve = Array.isArray(conflicts_to_resolve) ? conflicts_to_resolve : [];

                                // Build planned changes section
                                let plannedChangesHtml = '';
                                if (plannedChanges.length > 0) {
                                    const changesByCategory = {};
                                    plannedChanges.forEach(change => {
                                        const category = change.category || 'Other';
                                        if (!changesByCategory[category]) {
                                            changesByCategory[category] = [];
                                        }
                                        changesByCategory[category].push(change);
                                    });

                                    const categoryDetails = Object.keys(changesByCategory).map(category => {
                                        const changes = changesByCategory[category];
                                        const changeDetails = changes.map(change => `
                                            <div class="usage-change-item">
                                                <div class="usage-change-header">
                                                    <span class="usage-change-action">${change.action || 'modify'}</span>
                                                    <span class="usage-change-segments">Segments: ${change.target_segments?.join(', ') || 'N/A'}</span>
                                                </div>
                                                <div class="usage-change-reason">${change.reason || 'No reason provided'}</div>
                                                ${change.planned_modifications && change.planned_modifications.length > 0 ?
                                                `<div class="usage-change-tags">Tags: ${change.planned_modifications.join(', ')}</div>` : ''}
                                                ${change.emphasis_value !== undefined ?
                                                `<div class="usage-change-emphasis">Emphasis: ${change.emphasis_value}</div>` : ''}
                                            </div>
                                        `).join('');

                                        return `
                                            <div class="usage-category-section">
                                                <div class="usage-category-header">
                                                    <span class="usage-category-name">${category}</span>
                                                    <span class="usage-category-count">${changes.length} change${changes.length !== 1 ? 's' : ''}</span>
                                                </div>
                                                <div class="usage-category-changes">
                                                    ${changeDetails}
                                                </div>
                                            </div>
                                        `;
                                    }).join('');

                                    plannedChangesHtml = `
                                        <div class="usage-tool-section">
                                            <div class="usage-section-header">
                                                <i class="fas fa-clipboard-list"></i>
                                                <span>Planned Changes (${plannedChanges.length})</span>
                                            </div>
                                            <div class="usage-section-content">
                                                ${categoryDetails}
                                            </div>
                                        </div>
                                    `;
                                }

                                // Build research section
                                let researchHtml = '';
                                if (researchCompleted.length > 0 || researchNeeded.length > 0) {
                                    const completedItems = researchCompleted.map(item => `
                                        <div class="usage-research-item completed">
                                            <span class="usage-research-topic">${item.topic}</span>
                                            <span class="usage-research-tool">Tool: ${item.tool_name} (#${item.call_number})</span>
                                        </div>
                                    `).join('');

                                    const neededItems = researchNeeded.map(item => `
                                        <div class="usage-research-item needed">
                                            <span class="usage-research-topic">${item.topic}</span>
                                            ${item.tool_name ? `<span class="usage-research-tool">Planned: ${item.tool_name}</span>` : ''}
                                        </div>
                                    `).join('');

                                    researchHtml = `
                                        <div class="usage-tool-section">
                                            <div class="usage-section-header">
                                                <i class="fas fa-search"></i>
                                                <span>Research Status</span>
                                            </div>
                                            <div class="usage-section-content">
                                                ${researchCompleted.length > 0 ? `
                                                    <div class="usage-research-group">
                                                        <div class="usage-research-group-header">
                                                            <i class="fas fa-check-circle"></i>
                                                            <span>Completed (${researchCompleted.length})</span>
                                                        </div>
                                                        <div class="usage-research-items">
                                                            ${completedItems}
                                                        </div>
                                                    </div>
                                                ` : ''}
                                                ${researchNeeded.length > 0 ? `
                                                    <div class="usage-research-group">
                                                        <div class="usage-research-group-header">
                                                            <i class="fas fa-clock"></i>
                                                            <span>Needed (${researchNeeded.length})</span>
                                                        </div>
                                                        <div class="usage-research-items">
                                                            ${neededItems}
                                                        </div>
                                                    </div>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }

                                // Build conflicts section
                                let conflictsHtml = '';
                                if (conflictsToResolve.length > 0) {
                                    const conflictItems = conflictsToResolve.map(conflict => `
                                        <div class="usage-conflict-item">
                                            <i class="fas fa-exclamation-triangle"></i>
                                            <span>${conflict}</span>
                                        </div>
                                    `).join('');

                                    conflictsHtml = `
                                        <div class="usage-tool-section">
                                            <div class="usage-section-header">
                                                <i class="fas fa-exclamation-triangle"></i>
                                                <span>Conflicts to Resolve (${conflictsToResolve.length})</span>
                                            </div>
                                            <div class="usage-section-content">
                                                <div class="usage-conflicts-list">
                                                    ${conflictItems}
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }

                                return `
                                    <div class="usage-tool-block expanded" style="background: ${toolStyle.backgroundColor};">
                                        <div class="usage-tool-name-row">
                                            <div class="usage-tool-icon">${toolStyle.icon}</div>
                                            <div class="text-replacement-lock-pattern">
                                                <span class="usage-tool-name selectable">${display}</span>
                                            </div>
                                        </div>
                                        ${plannedChangesHtml}
                                        ${researchHtml}
                                        ${conflictsHtml}
                                    </div>
                                `;
                            }


                            // Two stacked rows (name + reason), both with same background
                            return `
                                <div class="usage-tool-block" style="background: ${toolStyle.backgroundColor};">
                                    <div class="usage-tool-name-row">
                                        <div class="usage-tool-icon">${toolStyle.icon}</div>
                                        <div class="text-replacement-lock-pattern">
                                            <span class="usage-tool-name selectable">${display}</span>
                                        </div>
                                    </div>
                                ${Array.isArray(tagReasons) && tagReasons.length > 0 ? `
                                    ${tagReasons.map(tr => {
                                const tagName = tr?.name || '';
                                const tagReason = tr?.reason || '';
                                const showReason = Boolean(tagReason && tagReason.trim());
                                return `
                                            <div class="usage-tag-row">
                                                <div class="usage-tool-icon"><i class="fas fa-tag"></i></div>
                                                <div class="usage-tag-line">
                                                    <span class="usage-tag-name selectable">${tagName}</span>
                                                    ${showReason ? `<span class="usage-tag-sep">•</span><span class="usage-tag-reason">${tagReason}</span>` : ''}
                                                </div>
                                            </div>
                                        `;
                            }).join('')}
                                ` : (toolReason ? `
                                    <div class="usage-tool-reason-row">
                                        <div class="text-replacement-lock-pattern">
                                            <span class="usage-tool-reason selectable">${toolReason}</span>
                                        </div>
                                    </div>
                                ` : '')}
                                </div>
                            `;
                        }).join('');

                        callDiv.innerHTML = `
                            <div class="text-replacement-lock-content">
                                <div class="text-replacement-lock-row">
                                    <div class="usage-type-icon">${typeIcon}</div>
                                    <div class="text-replacement-lock-pattern">
                                        <span class="usage-call-title">Tool Call</span>
                                    </div>
                                </div>
                                <div class="usage-tool-rows">
                                    ${toolsBlocks}
                                </div>
                                <div class="text-replacement-lock-row">
                                    <div class="text-replacement-lock-pattern"><span class="usage-tokens">${tokens}</span></div>
                                </div>
                            </div>
                        `;
                    } else {
                        // Non-tool call (e.g., request): single line + optional reason + totals
                        const displayName = (call.callType === 'request') ? 'Structured Build Data' : (call.functionName || call.callType || 'Call');
                        const reason = call.reason || '';
                        callDiv.innerHTML = `
                            <div class="text-replacement-lock-content">
                                <div class="text-replacement-lock-row">
                                    <div class="usage-type-icon">${typeIcon}</div>
                                    <div class="text-replacement-lock-pattern">
                                        <span class="usage-call-title">${displayName}</span>
                                    </div>
                                </div>
                                ${reason ? `<div class="text-replacement-lock-info"><div class="text-replacement-full-value">${reason}</div></div>` : ''}
                                <div class="text-replacement-lock-row">
                                    <div class="text-replacement-lock-pattern"><span class="usage-tokens">${tokens}</span></div>
                                </div>
                            </div>
                        `;
                    }
                    listContainer.appendChild(callDiv);
                });
            });
        }
    } catch (err) {
        console.warn('Failed to render usage section:', err);
    }

    updateLockStatusText();
}

// Update text replacement lock item display
function updateTextReplacementLockItem(index, updatedSeed) {
    const item = document.querySelector(`.text-replacement-lock-item[data-index="${index}"]`);
    if (!item) return;

    // Update the value display
    const valueElement = item.querySelector('.text-replacement-full-value');
    if (valueElement) {
        valueElement.textContent = updatedSeed.value;
    }

    // Update the selected pattern display
    const selectedElement = item.querySelector('.text-replacement-selected');
    if (selectedElement && updatedSeed.key) {
        const indexDisplay = updatedSeed.index !== null && updatedSeed.index !== undefined ? `<span class="text-replacement-index">${updatedSeed.index}</span>` : '';
        selectedElement.innerHTML = `!${updatedSeed.key}${indexDisplay}`;
    }

    const badgesRow = item.querySelector('.text-replacement-lock-badges');
    if (badgesRow) {
        const existingTargetBadge = badgesRow.querySelector('.text-replacement-stage-scope');
        const targetHtml = buildInspectorStageTargetBadgeHtml(updatedSeed);
        if (targetHtml) {
            if (existingTargetBadge) {
                existingTargetBadge.outerHTML = targetHtml;
            } else {
                badgesRow.insertAdjacentHTML('beforeend', targetHtml);
            }
        } else if (existingTargetBadge) {
            existingTargetBadge.remove();
        }
    }

    // Update the data
    if (currentTextReplacementSeeds && currentTextReplacementSeeds[index]) {
        currentTextReplacementSeeds[index] = updatedSeed;
    }
}
