/**
 * Text Replacement Manager
 * Manages text replacements in prompt.config.json with a visual interface
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
function hideTextReplacementManager() {
    const modal = document.getElementById('textReplacementManagerModal');
    if (modal) {
        closeModal(modal);
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
                itemsPerPage: 10,
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
                    itemsPerPage: 10,
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
    const modal = document.getElementById('textReplacementManagerModal');
    if (modal) {
        // Scroll the list container to top
        const listContainer = modal.querySelector('.text-replacement-list-container .text-replacement-list');
        if (listContainer) {
            listContainer.scrollTop = 0;
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
    
    // Use the existing emphasis editing system to close
    if (window.stopEmphasisEditing) {
        window.stopEmphasisEditing();
    }
    
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
    
    // Show modal
    openModal(modal);
    
    // Focus key input
    document.getElementById('textReplacementKeyInput').focus();
}

// Hide create text replacement modal
function hideCreateTextReplacementModal() {
    const modal = document.getElementById('createTextReplacementModal');
    if (modal) {
        closeModal(modal);
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
    
    console.log('Opening favorites manager...');
    await loadFavorites();
    console.log('Favorites loaded, rendering list...');
    renderFavoritesList();
    openModal(modal);
}

// Hide favorites manager modal
function hideFavoritesManager() {
    const modal = document.getElementById('favoritesManagerModal');
    if (modal) {
        closeModal(modal);
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
            <div class="favorites-empty">
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
    item.className = 'favorites-item';
    item.dataset.index = index;
    item.dataset.type = 'tag';

    item.innerHTML = `
        <div class="favorites-item-content">
            <div class="favorites-item-icon">
                <i class="fas fa-tag"></i>
            </div>
            <div class="favorites-item-details">
                <div class="favorites-item-name">
                    <span class="favorites-item-type-badge tag-badge">Tag</span>
                    ${escapeHtml(tag.name)}
                </div>
                ${tag.description ? `<div class="favorites-item-description">${escapeHtml(tag.description)}</div>` : ''}
                <div class="favorites-item-meta">
                    <span class="favorites-item-date">Added: ${new Date(tag.dateAdded).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
        <div class="favorites-item-actions">
            <button type="button" class="btn-secondary btn-small remove-favorite-btn" data-type="tags" data-index="${index}" title="Remove from Favorites">
                <i class="fas fa-trash"></i>
            </button>
        </div>
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
    item.className = 'favorites-item';
    item.dataset.index = index;
    item.dataset.type = 'textReplacement';

    item.innerHTML = `
        <div class="favorites-item-content">
            <div class="favorites-item-icon">
                <i class="fas fa-lambda"></i>
            </div>
            <div class="favorites-item-details">
                <div class="favorites-item-name">
                    <span class="favorites-item-type-badge text-replacement-badge">Text</span>
                    !${escapeHtml(textReplacement.placeholder)}
                </div>
                ${textReplacement.replacementValue ? `<div class="favorites-item-description">${escapeHtml(textReplacement.replacementValue)}</div>` : ''}
                <div class="favorites-item-meta">
                    <span class="favorites-item-date">Added: ${new Date(textReplacement.dateAdded).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
        <div class="favorites-item-actions">
            <button type="button" class="btn-secondary btn-small remove-favorite-btn" data-type="textReplacements" data-index="${index}" title="Remove from Favorites">
                <i class="fas fa-trash"></i>
            </button>
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
    const action = replacement.action || 'replace';
    
    // For append without select_text, always can apply
    if (action === 'append' && !replacement.select_text) {
        return true;
    }

    // For other actions, need to check if select_text exists in the target
    const targetText = getDynamicReplacementTargetText(replacement);
    if (!targetText) {
        return false; // Can't access target
    }

    const selectText = (replacement.select_text || '').trim();
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
        const field = replacement.targetField || 'input'; // 'input' or 'uc'
        
        const textarea = document.getElementById(`${characterId}_${field === 'input' ? 'prompt' : 'uc'}`);
        return textarea ? textarea.value : null;
    }
    return null;
}

// Apply a dynamic replacement client-side (mimics server logic)
function applyDynamicReplacementClientSide(replacement) {
    const action = replacement.action || 'replace';
    const targetType = replacement.targetType;
    
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
        const field = replacement.targetField || 'input'; // 'input' or 'uc'
        
        textarea = document.getElementById(`${characterId}_${field === 'input' ? 'prompt' : 'uc'}`);
    }

    if (!textarea) {
        return { success: false, error: 'Could not find target textarea' };
    }

    let result = textarea.value;
    const selectText = (replacement.select_text || '').trim();
    const replaceText = replacement.replace_text || '';
    const fallbackSelectText = replacement.fallback_select_text ? replacement.fallback_select_text.trim() : null;
    const alternativeText = replacement.alternative_text || null;
    const isCritical = replacement.is_critical !== false; // Default to true
    const count = replacement.count;

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

        if (selectText && selectText.trim()) {
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

    // Update the textarea
    textarea.value = result;

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


// Create a dynamic replacement item for the lock modal (matches existing layout)
function createDynamicReplacementItemForLockModal(replacement, globalIndex) {
    const item = document.createElement('div');
    const action = replacement.action || 'replace';
    item.className = `text-replacement-lock-item dynamic-replacement-type dynamic-action-${action}`;
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
    
    // Determine target label (for location badge)
    let targetLabel = '';
    let locationBadgeClass = '';
    if (replacement.targetType === 'prompt') {
        targetLabel = 'Prompt';
        locationBadgeClass = 'location-prompt';
    } else if (replacement.targetType === 'uc') {
        targetLabel = 'Negative';
        locationBadgeClass = 'location-uc';
    } else if (replacement.targetType === 'character') {
        targetLabel = `Character ${replacement.targetSource + 1} ${replacement.targetField === 'input' ? 'Prompt' : 'Negative'}`;
        locationBadgeClass = replacement.targetField === 'input' ? 'location-prompt' : 'location-uc';
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
    
    if (replacement.used_fallback || replacement.application_method === 'fallback') {
        statusIcon = '<i class="fas fa-exclamation-triangle"></i>';
        statusClass = 'status-fallback';
        statusTitle = 'Applied using fallback text';
    } else if (replacement.used_alternative || replacement.application_method === 'alternative') {
        statusIcon = '<i class="fas fa-rotate"></i>';
        statusClass = 'status-alternative';
        statusTitle = 'Applied using alternative text';
    } else if (replacement.select_text || action !== 'append') {
        statusIcon = '<i class="fas fa-check"></i>';
        statusClass = 'status-direct';
        statusTitle = 'Applied successfully';
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
        replaceTextPattern = replacement.count 
            ? `<i>Delete ${replacement.count} occurrence(s)</i>` 
            : '<i>Delete all</i>';
    } else {
        replaceTextPattern = replacement.replace_text 
            ? `"${escapeHtml(replacement.replace_text)}"` 
            : '<i>N/A</i>';
    }

    // Build status indicator icons
    let statusIndicators = '';
    if (replacement.used_fallback && replacement.actual_select_text) {
        statusIndicators += `<span class="text-replacement-badge text-replacement-badge-warning" title="Used fallback: ${escapeHtml(replacement.actual_select_text)}"><i class="fas fa-exclamation-triangle"></i> Fallback</span>`;
    }
    if (replacement.used_alternative && replacement.alternative_text_used) {
        statusIndicators += `<span class="text-replacement-badge text-replacement-badge-info" title="Used alternative: ${escapeHtml(replacement.alternative_text_used)}"><i class="fas fa-rotate"></i> Alternative</span>`;
    }

    // Validate if can be applied client-side
    const canApply = validateDynamicReplacementCanApply(replacement);

    // Create unique ID for feedback
    const repId = `dynamic_lock_${globalIndex}_${Math.random().toString(36).substr(2, 9)}`;

    item.innerHTML = `
        <div class="text-replacement-lock-content">
            <div class="text-replacement-lock-info">
                <div class="text-replacement-lock-row">
                    <div class="text-replacement-lock-pattern">
                        ${statusIcon ? `<span class="status-icon ${statusClass}" title="${statusTitle}">${statusIcon}</span>` : ''}
                        ${replacement.replacement_category ? `<span class="text-replacement-badge text-replacement-badge-category ${getCategoryClass(replacement.replacement_category)}">${getCategoryIconLocal(replacement.replacement_category)} ${escapeHtml(replacement.replacement_category)}</span>` : ''}
                    </div>
                    <div class="text-replacement-lock-badges">
                        <span class="text-replacement-badge text-replacement-badge-location ${locationBadgeClass}">${targetLabel}</span>
                        <span class="text-replacement-badge text-replacement-badge-type"><i class="fas ${actionIcon}"></i> ${actionDisplay}</span>
                        ${statusIndicators}
                    </div>
                </div>
                ${replacement.select_text || action !== 'delete' ? `<div class="text-replacement-full-value">
                    <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">Find:</div>
                    ${selectTextPattern}
                </div>` : ''}
                ${action !== 'delete' || replacement.replace_text ? `<div class="text-replacement-full-value">
                    <div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">${action === 'delete' ? 'Action:' : (action === 'append' ? 'Insert:' : 'Replace with:')}</div>
                    ${replaceTextPattern}
                </div>` : ''}
                ${replacement.reason ? `<div style="color: var(--text-secondary); font-size: 0.75em; padding: var(--spacing-xs) 0; line-height: 1.3;">
                    <i class="fas fa-info-circle"></i> ${escapeHtml(replacement.reason)}
                </div>` : ''}
            </div>
            <div class="text-replacement-lock-actions">
                <button type="button" class="btn-danger btn-small feedback-btn btn-small" data-rep-id="${repId}" data-select-text="${escapeHtml(replacement.select_text || '')}" data-replace-text="${escapeHtml(replacement.replace_text || '')}" data-action="${action}" data-reason="${escapeHtml(replacement.reason || '')}" title="Report Issue">
                    <i class="fas fa-flag"></i>
                </button>
                ${canApply ? `<button type="button" class="text-replacement-replace-btn btn-secondary btn-small" data-global-index="${globalIndex}" title="Apply to Prompt">
                    <i class="fas fa-pen-field"></i>
                </button>` : ''}
                <button type="button" class="text-replacement-lock-btn btn-secondary btn-small btn-toggle" data-state="${isLocked ? 'on' : 'off'}" data-global-index="${globalIndex}" title="Lock for AI Maintenance">
                    <i class="fas fa-lock"></i>
                </button>
            </div>
        </div>
    `;

    // Add event listeners
    const applyBtn = item.querySelector('.text-replacement-replace-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            applyDynamicReplacementFromLockModal(globalIndex);
        });
    }

    const lockBtn = item.querySelector('.text-replacement-lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDynamicReplacementLockInModal(globalIndex, lockBtn, item);
        });
    }

    const feedbackBtn = item.querySelector('.feedback-btn');
    if (feedbackBtn) {
        feedbackBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const selectText = feedbackBtn.dataset.selectText;
            const replaceText = feedbackBtn.dataset.replaceText;
            const action = feedbackBtn.dataset.action;
            const reason = feedbackBtn.dataset.reason;
            if (typeof showDirectorFeedbackModal === 'function') {
                showDirectorFeedbackModal(selectText, replaceText, action, reason);
            }
        });
    }

    return item;
}

// Apply dynamic replacement from lock modal
function applyDynamicReplacementFromLockModal(globalIndex) {
    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        showGlassToast('error', null, 'No dynamic generation data available', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Find the replacement in the data structure
    const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;
    let replacement = null;
    let replacementArrayRef = null;
    let replacementArrayIndex = -1;
    let currentIndex = 0;

    const arrays = [
        { arr: textReplacements.prompt, type: 'prompt' },
        { arr: textReplacements.uc, type: 'uc' }
    ];

    if (textReplacements.character_prompts) {
        textReplacements.character_prompts.forEach((char, charIndex) => {
            if (char?.input) arrays.push({ arr: char.input, type: 'character' });
            if (char?.uc) arrays.push({ arr: char.uc, type: 'character' });
        });
    }

    for (const { arr } of arrays) {
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
            if (currentIndex === globalIndex) {
                replacement = arr[i];
                replacementArrayRef = arr;
                replacementArrayIndex = i;
                break;
            }
            currentIndex++;
        }
        if (replacement) break;
    }

    if (!replacement) {
        console.error('Could not find replacement at index', globalIndex);
        showGlassToast('error', null, 'Could not find replacement', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Apply the replacement using client-side logic
    const result = applyDynamicReplacementClientSide(replacement);
    
    if (result.success) {
        // Mark as applied
        replacement.applied = true;
        replacement.application_method = result.method;

        // Remove from the array
        if (replacementArrayRef && replacementArrayIndex !== -1) {
            replacementArrayRef.splice(replacementArrayIndex, 1);
        }

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

// Toggle dynamic replacement lock in the lock modal
function toggleDynamicReplacementLockInModal(globalIndex, lockBtn, item) {
    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        return;
    }

    // Find the replacement in the data structure
    const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;
    let replacement = null;
    let currentIndex = 0;

    const arrays = [
        { arr: textReplacements.prompt, type: 'prompt' },
        { arr: textReplacements.uc, type: 'uc' }
    ];

    if (textReplacements.character_prompts) {
        textReplacements.character_prompts.forEach((char, charIndex) => {
            if (char?.input) arrays.push({ arr: char.input, type: 'character' });
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

    // Update the main lock button state
    if (typeof updateMainLockButtonState === 'function') {
        updateMainLockButtonState();
    }

    // Show feedback
    const statusText = isLocked ? 'locked for AI maintenance' : 'unlocked';
    showGlassToast('success', null, `Replacement ${statusText}`, false, 2000, '<i class="fas fa-lock"></i>');
}


// Initialize when DOM is loaded
window.wsClient.registerInitStep(45, 'Initializing Text Replacement Manager', async () => {
    initializeTextReplacementManager();
    initializeFavoritesManager();
});