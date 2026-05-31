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

// Initialize create text replacement modal
function initializeCreateTextReplacementModal() {
    const modal = document.getElementById('createTextReplacementModal');
    const closeBtn = document.getElementById('closeCreateTextReplacementBtn');
    const cancelBtn = document.getElementById('createTextReplacementCancelBtn');
    const saveBtn = document.getElementById('createTextReplacementSaveBtn');
    const typeSelect = document.getElementById('textReplacementTypeSelect');

    if (modal) {

        // Close on escape key
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideCreateTextReplacementModal();
            }
        });
    }

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

    // Close on outside click
    const modal = document.getElementById('textReplacementManagerModal');
    if (modal) {

        // Add keyboard navigation for pagination
        modal.addEventListener('keydown', async (e) => {
            if (e.target.closest('.text-replacement-manager-content')) {
                if (e.key === 'PageDown' && textReplacementPaginationInfo.currentPage < (textReplacementPaginationInfo.totalPages || 1)) {
                    e.preventDefault();
                    textReplacementPaginationInfo.currentPage++;
                    await loadTextReplacements();
                } else if (e.key === 'PageUp' && textReplacementPaginationInfo.currentPage > 1) {
                    e.preventDefault();
                    textReplacementPaginationInfo.currentPage--;
                    await loadTextReplacements();
                }
            }
        });
    }

    // Initialize create text replacement modal
    initializeCreateTextReplacementModal();
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
                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="on" title="Toggle Autofill">
                            <i class="fas fa-lightbulb"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                            <i class="fas fa-scale-unbalanced-flip"></i>
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
                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="off" title="Toggle Autofill">
                            <i class="fas fa-lightbulb-slash"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                            <i class="fas fa-scale-unbalanced-flip"></i>
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
function renderFavoritesList() {
    const favoritesList = document.getElementById('favoritesList');
    if (!favoritesList) return;
    
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


// Create a Rentan modification (Tsubo) item for the lock modal (matches existing layout)
function createDynamicReplacementItemForLockModal(replacement, globalIndex) {
    const item = document.createElement('div');
    const action = replacement.action?.toLowerCase() || 'replace';
    item.className = `text-replacement-lock-item dynamic-replacement-type dynamic-action-${action}`;
    
    // Add UC class if targetType is uc
    if (replacement.targetType === 'uc' || (replacement.targetType === 'character' && replacement.targetField === 'uc')) {
        item.classList.add('negative-prompt');
    }
    
    item.dataset.globalIndex = globalIndex;

    const actionDisplay = action === 'replace' ? 'Replace' : action === 'append' ? 'Append' : 'Delete';
    const actionIcon = action === 'replace' ? 'fa-arrows-rotate' : action === 'append' ? 'fa-plus' : 'fa-trash';
    
    // Helper function to get category icon (based on schema-defined categories)
    const getCategoryIconLocal = (category) => {
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
    };
    
    // Determine target label and icon (for location badge)
    let targetLabel = '';
    let locationIcon = '';
    let locationColor = '';
    if (replacement.targetType === 'prompt') {
        targetLabel = 'Prompt';
        locationIcon = '<i class="ri-code-block"></i>';
        locationColor = '#81ffcb';
    } else if (replacement.targetType === 'uc') {
        targetLabel = 'Negative';
        locationIcon = '<i class="ri-eraser-fill"></i>';
        locationColor = '#ff8199';
    } else if (replacement.targetType === 'character') {
        targetLabel = `Character ${replacement.targetSource + 1} ${replacement.targetField === 'prompt' ? 'Prompt' : 'Negative'}`;
        if (replacement.targetField === 'prompt') {
            locationIcon = '<i class="ri-code-block"></i>';
            locationColor = '#81ffcb';
        } else {
            locationIcon = '<i class="ri-eraser-fill"></i>';
            locationColor = '#ff8199';
        }
    }

    // Get action type color
    // Anchor + mitigation context
    const mitigations = Array.isArray(replacement.mitigations) ? replacement.mitigations : [];
    const anchorDetails = replacement.anchor_details || null;
    const anchorDisplayText = anchorDetails?.preview || replacement.anchor_text || '';
    const anchorSourceLabel = anchorDetails?.source ? anchorDetails.source.replace(/_/g, ' ') : '';

    // Get action type color
    let actionColor = '#9ca3af'; // Default gray
    if (action === 'replace') {
        actionColor = '#ffb981'; // Orange for replace
    } else if (action === 'append') {
        actionColor = '#81ffcb'; // Cyan for append/add
    } else if (action === 'delete') {
        actionColor = '#ff8199'; // Pink/red for delete
    }

    // Get application method for type badge
    let applicationMethod = 'Direct';
    if (replacement.used_fallback || replacement.application_method === 'fallback') {
        applicationMethod = 'Fallback';
    } else if (replacement.used_alternative || replacement.application_method === 'alternative') {
        applicationMethod = 'Alternative';
    }

    // Get application method icon and label for status icon
    let statusIcon = '';
    let statusClass = '';
    let statusTitle = '';
    let statusColor = '';
    
    // Check if replacement failed to apply
    if (replacement.applied === false || replacement.error) {
        statusIcon = '<i class="fas fa-times"></i>';
        statusClass = 'status-failed';
        statusTitle = replacement.error ? `Failed to apply: ${replacement.error}` : 'Failed to apply';
        statusColor = '#ff8181';
    } else if (replacement.used_fallback || replacement.application_method === 'fallback') {
        statusIcon = '<i class="fas fa-exclamation-triangle"></i>';
        statusClass = 'status-fallback';
        statusTitle = 'Applied using fallback text';
        statusColor = '#ffc981';
    } else if (replacement.used_alternative || replacement.application_method === 'alternative') {
        statusIcon = '<i class="fas fa-rotate"></i>';
        statusClass = 'status-alternative';
        statusTitle = 'Applied using alternative text';
        statusColor = '#81d4ff';
    } else if (replacement.applied !== false) {
        // Only show success if not explicitly marked as failed
        statusIcon = '<i class="fas fa-check"></i>';
        statusClass = 'status-direct';
        statusTitle = 'Applied successfully';
        statusColor = '#81ffb3';
    }

    // Helper function to convert category to CSS class name
    const getCategoryClass = (category) => {
        if (!category) return '';
        return 'category-' + category.toLowerCase().replace(/\s+/g, '-');
    };

    // Check if locked
    const isLocked = replacement.locked === true;
    item.classList.toggle('selected', isLocked);

    // Build the pattern display (matching existing layout)
    let selectTextPattern = '';
    if (replacement.select_text) {
        selectTextPattern = `"${escapeHtml(replacement.select_text)}"`;
    } else if (action === 'append') {
        selectTextPattern = '<i>append to end</i>';
    } else {
        selectTextPattern = '<i>N/A</i>';
    }

    // Build the replacement display
    let replaceTextPattern = '';
    if (action === 'delete') {
        if (replacement.select_text) {
            let selectText = replacement.select_text;
            // Apply bias if replacement has segment_emphasis property
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
    } else {
        if (replacement.replace_text) {
            let replaceText = replacement.replace_text;
            const replacementBias = getReplacementBias(replacement);
            if (replacementBias !== null && !hasEmphasisGroupForDisplay(replaceText)) {
                replaceText = applyBiasToText(replaceText, replacementBias);
            }
            replaceTextPattern = `"${escapeHtml(replaceText)}"`;
        } else {
            replaceTextPattern = '<i>N/A</i>';
        }
    }

    // Build status indicator badges
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
    const wasConverted = mitigations.some(m => m.type === 'converted_to_append');
    if (wasConverted) {
        statusIndicators += `<span class="text-replacement-badge text-replacement-badge-info" title="Converted from replace to append due to overlapping anchor"><i class="fas fa-share"></i> Converted</span>`;
    }

    // Validate if can be applied client-side
    const canApply = validateDynamicReplacementCanApply(replacement);

    // Create unique ID for feedback
    const repId = `dynamic_lock_${globalIndex}_${Math.random().toString(36).substr(2, 9)}`;

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

    item.innerHTML = `
        <div class="text-replacement-lock-content">
            <div class="text-replacement-lock-info">
                ${(action === 'append' ? !!replacement.select_text : action !== 'delete' || !replacement.select_text) ? `<div class="text-replacement-full-value selectable">
                    <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">Find:</div>
                    ${selectTextPattern}
</div>` : ''}
                ${action !== 'delete' || replacement.replace_text || replacement.select_text ? `<div class="text-replacement-full-value selectable">
                    <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">${action === 'delete' ? 'Delete:' : (action === 'append' ? 'Insert:' : 'Replace with:')}</div>
                    ${replaceTextPattern}
                </div>` : ''}
                ${anchorSection}
                ${mitigationSection}
                ${replacement.reason ? `<div class="selectable reason-text">
                    <i class="fas fa-quote-left"></i> ${escapeHtml(replacement.reason)}
                </div>` : ''}
                ${replacement.references && replacement.references.length > 0 ? `<div class="text-replacement-references" style="font-size: 0.7em;">
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
                </div>` : ''}
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
                        ${statusIcon ? `<span class="badge-icon-status" style="color: ${statusColor};" title="${statusTitle}">${statusIcon}</span>` : ''}
                    </span>
                    ${statusIndicators}
                </div>
                <div class="text-replacement-lock-pattern">
                    ${replacement.replacement_category ? `<span class="text-replacement-badge text-replacement-badge-category ${getCategoryClass(replacement.replacement_category)}">${getCategoryIconLocal(replacement.replacement_category)} ${escapeHtml(replacement.replacement_category)}</span>` : ''}
                </div>
                <div class="text-replacement-lock-actions">
                    <button type="button" class="text-replacement-lock-btn btn-secondary btn-small toggle-btn" data-state="${isLocked ? 'on' : 'off'}" data-global-index="${globalIndex}" title="Lock for AI Maintenance">
                        <i class="fas fa-lock"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    const lockBtn = item.querySelector('.text-replacement-lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDynamicReplacementLockInModal(globalIndex, lockBtn, item);
        });
    }
    // Add context menu to the item
    if (contextMenu) {
        contextMenu.attachToElement(item, {
            sections: [
                
                {
                    type: 'icons',
                    position: 'outer',
                    icons: [
                        {
                            tooltip: 'Toggle Lock Replacement',
                            icon: 'fas fa-lock',
                            action: 'lock',
                            keepMenuOpen: true,
                            showIndicator: true,
                            loadfn: (item, target) => {
                                item.checked = replacement.locked === true;
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
                            disabled: !canApply
                        },
                    ]
                },
                {
                type: 'list',
                items: [
                    {
                        text: 'Set Emphasis',
                        icon: 'fas fa-sliders-h',
                        action: 'set-emphasis',
                    },
                    {
                        text: 'Report Issue',
                        icon: 'fas fa-flag',
                        action: 'report-issue',
                        className: 'text-danger',
                    },
                    {
                        text: 'Delete',
                        icon: 'fas fa-trash',
                        action: 'delete-replacement',
                        className: 'text-danger',
                    },
                ]
            }],
            onAction: (actionName, target) => {
                if (actionName === 'apply-prompt') {
                    applyDynamicReplacementFromLockModal(globalIndex);
                } else if (actionName === 'copy-value') {
                    // Copy replacement value or replace_text
                    let textToCopy = replacement.value || replacement.replace_text || '';
                    if (textToCopy && navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            showGlassToast('success', null, 'Copied to clipboard', false, 2000, '<i class="nai-clipboard"></i>');
                        }).catch(err => {
                            console.error('Failed to copy:', err);
                            showGlassToast('error', null, 'Failed to copy to clipboard', false, 2000, '<i class="fas fa-exclamation-triangle"></i>');
                        });
                    }
                } else if (actionName === 'report-issue') {
                    const selectText = feedbackBtn.dataset.selectText;
                    const replaceText = feedbackBtn.dataset.replaceText;
                    const action = feedbackBtn.dataset.action.toLowerCase();
                    const reason = feedbackBtn.dataset.reason;
                    showDirectorFeedbackModal(selectText, replaceText, action, reason);
                } else if (actionName === 'lock') {
                    toggleDynamicReplacementLockInModal(globalIndex, lockBtn, item);
                } else if (actionName === 'delete-replacement') {
                    deleteDynamicReplacementFromLockModal(globalIndex);
                } else if (actionName === 'set-emphasis') {
                    setDynamicReplacementEmphasis(globalIndex, item);
                }
            }
        });
    }

    return item;
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
function applyDynamicReplacementFromLockModal(globalIndex) {
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

    // Add targetType metadata to the replacement object
    const replacementWithMetadata = {
        ...replacement,
        targetType: metadata.type,
        targetSource: metadata.targetSource,
        targetField: metadata.targetField
    };

    // Apply the replacement using client-side logic
    const result = applyDynamicReplacementClientSide(replacementWithMetadata);
    
    if (result.success) {
        // Mark as applied
        replacement.applied = true;
        replacement.application_method = result.method;

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

        showGlassToast('success', null, `Applied replacement${result.method !== 'direct' ? ` (using ${result.method})` : ''} and removed from list`, false, 3000, '<i class="fas fa-check"></i>');
    } else {
        showGlassToast('error', null, result.error || 'Failed to apply replacement', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Compile all Rentan modifications (Tendai) into prompt fields and disable dynamic generation
function compileAllTendaiReplacements() {
    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        showGlassToast('warning', null, 'No Tendai Modifications available to compile', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;
    const replacementQueue = [];

    if (Array.isArray(textReplacements.prompt)) {
        textReplacements.prompt.forEach((replacement) => {
            replacementQueue.push({
                replacement,
                targetType: 'prompt',
                targetSource: 'base'
            });
        });
    }

    if (Array.isArray(textReplacements.uc)) {
        textReplacements.uc.forEach((replacement) => {
            replacementQueue.push({
                replacement,
                targetType: 'uc',
                targetSource: 'base'
            });
        });
    }

    if (Array.isArray(textReplacements.character_prompts)) {
        textReplacements.character_prompts.forEach((characterPrompt, characterIndex) => {
            if (Array.isArray(characterPrompt?.prompt)) {
                characterPrompt.prompt.forEach((replacement) => {
                    replacementQueue.push({
                        replacement,
                        targetType: 'character',
                        targetSource: characterIndex,
                        targetField: 'prompt'
                    });
                });
            }

            if (Array.isArray(characterPrompt?.uc)) {
                characterPrompt.uc.forEach((replacement) => {
                    replacementQueue.push({
                        replacement,
                        targetType: 'character',
                        targetSource: characterIndex,
                        targetField: 'uc'
                    });
                });
            }
        });
    }

    if (replacementQueue.length === 0) {
        showGlassToast('warning', null, 'No Tendai Modifications available to compile', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Match server behavior: apply replaces/deletes first, then appends (per target stream).
    // Applying appends too early can shift replacement anchors and cause output divergence.
    const replacementStreams = new Map();
    replacementQueue.forEach((entry) => {
        const streamKey = `${entry.targetType}:${entry.targetSource ?? 'base'}:${entry.targetField ?? 'none'}`;
        if (!replacementStreams.has(streamKey)) {
            replacementStreams.set(streamKey, []);
        }
        replacementStreams.get(streamKey).push(entry);
    });

    const orderedQueue = [];
    replacementStreams.forEach((entries) => {
        const phaseReplaceDelete = entries.filter(({ replacement }) => {
            const action = (replacement?.action || 'replace').toLowerCase();
            return action !== 'append';
        });
        const phaseAppend = entries.filter(({ replacement }) => {
            const action = (replacement?.action || 'replace').toLowerCase();
            return action === 'append';
        });
        orderedQueue.push(...phaseReplaceDelete, ...phaseAppend);
    });

    let successCount = 0;
    let failedCount = 0;

    orderedQueue.forEach(({ replacement, targetType, targetSource, targetField }) => {
        const preparedReplacement = {
            ...replacement,
            // Server translates <br> to newlines before applying replacements.
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

        if (result.success) {
            successCount++;
        } else {
            failedCount++;
        }
    });

    // Clear compiled dynamic replacements and disable dynamic generation for upcoming requests.
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
        dynamicCarouselElement.setAttribute('data-state', 'off');
        dynamicCarouselElement.setAttribute('data-use-cache', 'false');
    }

    if (window.updateDynamicGenerationToggleBtn) {
        window.updateDynamicGenerationToggleBtn();
    }
    if (window.updateCarouselIndicators) {
        window.updateCarouselIndicators();
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
    
    showGlassToast('success', null, `Emphasis set to ${emphasisValue.toFixed(1)}`, false, 2000, '<i class="fas fa-sliders-h"></i>');
}


// Initialize when DOM is loaded
window.wsClient.registerInitStep(45, 'Initializing Text Replacement Manager', async () => {
    initializeTextReplacementManager();
    initializeFavoritesManager();
});