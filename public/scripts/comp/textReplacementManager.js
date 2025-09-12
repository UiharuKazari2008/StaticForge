/**
 * Text Replacement Manager
 * Manages text replacements in prompt.config.json with a visual interface
 */

let textReplacementData = {};
let originalTextReplacementData = {};
let currentPage = 1;
const itemsPerPage = 15;
let currentSearchTerm = '';
let paginationInfo = {
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage,
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
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideCreateTextReplacementModal();
            }
        });

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
    const manualTextReplacementManagerBtn = document.getElementById('manualTextReplacementManagerBtn');
    const closeTextReplacementManagerBtn = document.getElementById('closeTextReplacementManagerBtn');
    const textReplacementSearch = document.getElementById('textReplacementSearch');
    const textReplacementPrevBtn = document.getElementById('textReplacementPrevBtn');
    const textReplacementNextBtn = document.getElementById('textReplacementNextBtn');

    // Event listeners
    if (textReplacementManagerBtn) {
        textReplacementManagerBtn.addEventListener('click', showTextReplacementManager);
    }

    if (manualTextReplacementManagerBtn) {
        manualTextReplacementManagerBtn.addEventListener('click', showTextReplacementManager);
    }
    
    if (closeTextReplacementManagerBtn) {
        closeTextReplacementManagerBtn.addEventListener('click', hideTextReplacementManager);
    }
    
    if (textReplacementSearch) {
        textReplacementSearch.addEventListener('input', debounce(async () => {
            currentPage = 1; // Reset to first page when searching
            currentSearchTerm = textReplacementSearch.value;
            await loadTextReplacements();
        }, 300));
    }

    if (textReplacementPrevBtn) {
        textReplacementPrevBtn.addEventListener('click', async () => {
            if (currentPage > 1) {
                currentPage--;
                await loadTextReplacements();
            }
        });
    }

    if (textReplacementNextBtn) {
        textReplacementNextBtn.addEventListener('click', async () => {
            const totalPages = paginationInfo.totalPages || 1;
            if (currentPage < totalPages) {
                currentPage++;
                await loadTextReplacements();
            }
        });
    }

    // Close on outside click
    const modal = document.getElementById('textReplacementManagerModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideTextReplacementManager();
            }
        });

        // Add keyboard navigation for pagination
        modal.addEventListener('keydown', async (e) => {
            if (e.target.closest('.text-replacement-manager-content')) {
                if (e.key === 'PageDown' && currentPage < (paginationInfo.totalPages || 1)) {
                    e.preventDefault();
                    currentPage++;
                    await loadTextReplacements();
                } else if (e.key === 'PageUp' && currentPage > 1) {
                    e.preventDefault();
                    currentPage--;
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
    
    // Focus search input
    const searchInput = document.getElementById('textReplacementSearch');
    if (searchInput) {
        searchInput.focus();
    }
}

// Hide text replacement manager modal
function hideTextReplacementManager() {
    const modal = document.getElementById('textReplacementManagerModal');
    if (modal) {
        closeModal(modal);
    }
    
    // Reset to first page and clear search
    currentPage = 1;
    const searchInput = document.getElementById('textReplacementSearch');
    if (searchInput) {
        searchInput.value = '';
    }
}

// Load text replacements from server
async function loadTextReplacements() {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            // Request text replacements via WebSocket with pagination and search parameters
            const result = await window.wsClient.sendMessage('get_text_replacements', {
                page: currentPage,
                itemsPerPage,
                searchTerm: currentSearchTerm
            });
            
            if (result && result.textReplacements) {
                textReplacementData = { ...result.textReplacements };
                originalTextReplacementData = JSON.parse(JSON.stringify(result.textReplacements));
                
                // Update pagination info
                if (result.pagination) {
                    paginationInfo = { ...result.pagination };
                    currentPage = paginationInfo.currentPage;
                    console.log('Updated pagination info:', paginationInfo);
                    console.log('Current page set to:', currentPage);
                }
                
                // Update search state
                currentSearchTerm = result.searchTerm || '';
                
                // Update search input if it exists
                const searchInput = document.getElementById('textReplacementSearch');
                if (searchInput && searchInput.value !== currentSearchTerm) {
                    searchInput.value = currentSearchTerm;
                }
                
                // Render the updated list
                renderTextReplacementList();
            } else {
                console.warn('No text replacements received from server');
                textReplacementData = {};
                originalTextReplacementData = {};
                paginationInfo = {
                    currentPage: 1,
                    totalPages: 1,
                    itemsPerPage,
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
        pageInfo.textContent = `Page ${paginationInfo.currentPage} of ${paginationInfo.totalPages} (${paginationInfo.totalItems} items)`;
    }
    
    if (prevBtn) {
        prevBtn.disabled = currentPage <= 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = currentPage >= paginationInfo.totalPages;
    }
}

// Render the text replacement list
function renderTextReplacementList() {
    const listContainer = document.getElementById('textReplacementList');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    const pageKeys = Object.keys(textReplacementData);
    
    if (pageKeys.length === 0) {
        if (paginationInfo.totalItems === 0) {
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
                <div class="text-replacement-type ${isArray ? 'random' : ''}">${isArray ? '<span>Random</span><i class="fas fa-dice"></i>' : '<span>Expand</span><i class="fas fa-input-text"></i>'}</div>
                <button type="button" class="btn-small btn-secondary edit-btn" onclick="toggleEditMode('${key}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn-small btn-primary save-btn hidden" onclick="saveTextReplacementItem('${key}')" title="Save">
                    <i class="fas fa-save"></i>
                </button>
                <button type="button" class="btn-small btn-danger delete-btn" onclick="deleteTextReplacement('${key}')" title="Delete">
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
                <button class="btn-primary" type="button" onclick="addArrayItem('${key}')" title="Add Item">
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
                <button class="btn-primary" type="button" onclick="addArrayItem('${key}')" title="Add Item">
                    <i class="fas fa-plus"></i> Add Item
                </button>
            </div>
        </div>
    `;
}



// Toggle edit mode for a text replacement
function toggleEditMode(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    const isEditing = item.classList.contains('editing');
    
    if (isEditing) {
        // Exit edit mode and revert changes
        exitEditMode(key, true); // true = revert changes
    } else {
        // Enter edit mode
        enterEditMode(key);
    }
}

// Enter edit mode
function enterEditMode(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    item.classList.add('editing');
    
    // Convert display mode to edit mode
    convertToEditMode(key);
    
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
function convertToEditMode(key) {
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
                        <div class="divider"></div>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                            <i class="fas fa-scale-unbalanced-flip"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                            <i class="fas fa-book-skull"></i>
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
function convertToDisplayMode(key) {
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
    if (!textarea || !textarea.matches('.character-prompt-textarea')) return;
    
    // Add event listeners for focus/blur to show/hide toolbar
    textarea.addEventListener('focus', () => {
        const toolbar = textarea.closest('.character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
        if (toolbar) {
            toolbar.classList.remove('hidden');
            updateTextReplacementTokenCount(textarea);
        }
        
        // Add focus class to container
        const container = textarea.closest('.character-prompt-textarea-container');
        if (container) {
            container.classList.add('textarea-focused');
        }
    });
    
    textarea.addEventListener('blur', () => {
        const toolbar = textarea.closest('.character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
        const container = textarea.closest('.character-prompt-textarea-container');
        
        if (toolbar) {
            toolbar.classList.add('hidden');
        }
        
        if (container) {
            container.classList.remove('textarea-focused');
        }
    });
    
    // Add input event listener for token count updates
    textarea.addEventListener('input', () => {
        updateTextReplacementTokenCount(textarea);
    });
    
    // Add character autocomplete events
    textarea.addEventListener('input', handleCharacterAutocompleteInput);
    textarea.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    textarea.addEventListener('focus', () => startEmphasisHighlighting(textarea));
    textarea.addEventListener('blur', () => {
        applyFormattedText(textarea, true);
        updateEmphasisHighlighting(textarea);
        stopEmphasisHighlighting();
    });
    
    // Setup toolbar button event listeners
    const toolbar = textarea.closest('.character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
    if (toolbar) {
        setupTextReplacementToolbar(toolbar, textarea);
    }
    
    // Initial token count
    updateTextReplacementTokenCount(textarea);
}

// Setup text replacement toolbar functionality
function setupTextReplacementToolbar(toolbar, textarea) {
    if (!toolbar || !textarea) return;
    
    // Handle toolbar button clicks
    const buttons = toolbar.querySelectorAll('.toolbar-btn');
    
    buttons.forEach((button, index) => {
        const action = button.dataset.action;
        
        // Remove any existing listeners first
        button.removeEventListener('click', button._textReplacementClickHandler);
        
        // Create new handler
        button._textReplacementClickHandler = (e) => {
            e.preventDefault();
            handleTextReplacementToolbarAction(action, textarea, toolbar, e);
        };
        
        button.addEventListener('click', button._textReplacementClickHandler);
    });
    
    // Sync autofill button state with global system
    const autofillBtn = toolbar.querySelector('[data-action="autofill"]');
    if (autofillBtn) {
        // Force enable the button if it's disabled
        if (autofillBtn.disabled) {
            console.log('Forcing button to be enabled...');
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

// Handle text replacement toolbar actions
function handleTextReplacementToolbarAction(action, textarea, toolbar, event) {
    console.log('Handling toolbar action:', action);
    
    switch (action) {
        case 'quick-access':
            console.log('Opening quick access...');
            openTextReplacementQuickAccess(textarea);
            break;
        case 'emphasis':
            console.log('Opening emphasis mode...');
            openTextReplacementEmphasisMode(textarea, toolbar);
            break;
        case 'autofill':
            // Autofill is handled by the main toolbar system
            // The button click will be handled automatically
            break;
        default:
            console.log('Unknown action:', action);
            break;
    }
}

// Update token count for text replacement textarea
function updateTextReplacementTokenCount(textarea) {
    const toolbar = textarea.closest('.character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
    if (!toolbar) return;

    const tokenCountElement = toolbar.querySelector('.token-count');
    if (!tokenCountElement) return;

    const text = textarea.value;
    const tokenCount = calculateTextReplacementTokenCount(text);
    tokenCountElement.textContent = `${tokenCount} tokens`;
}

// Calculate token count for text replacement
function calculateTextReplacementTokenCount(text) {
    if (!text || text.trim() === '') return 0;
    
    // Simple token estimation - roughly 4 characters per token
    const words = text.trim().split(/\s+/);
    let tokenCount = 0;
    
    for (const word of words) {
        if (word.length > 0) {
            // Basic token estimation
            tokenCount += Math.ceil(word.length / 4);
        }
    }
    
    return Math.max(1, tokenCount);
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
function exitEditMode(key, revertChanges = false) {
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
        convertToDisplayMode(key);
        
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
                exitEditMode(key, false);
                
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
        if (item.classList.contains('editing')) {
            newItem.classList.add('editing');
            // Make inputs editable
            const inputs = newItem.querySelectorAll('input, textarea');
            inputs.forEach(input => {
                input.readOnly = false;
                input.addEventListener('input', () => updateTextReplacementValue(key));
            });
            
            // Update button icons and show/hide buttons
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
        
        item.replaceWith(newItem);
        
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
        if (item.classList.contains('editing')) {
            newItem.classList.add('editing');
            // Make inputs editable
            const inputs = newItem.querySelectorAll('input, textarea');
            inputs.forEach(input => {
                input.readOnly = false;
                input.addEventListener('input', () => updateTextReplacementValue(key));
            });
            
            // Update button icons and show/hide buttons
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
        
        item.replaceWith(newItem);
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
                        <div class="divider"></div>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                            <i class="fas fa-scale-unbalanced-flip"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="search" title="Inline Find">
                            <i class="fas fa-search"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                            <i class="fas fa-book-skull"></i>
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
        <button class="btn-secondary remove-array-item" type="button" onclick="removeCreateArrayItem(${itemIndex})" title="Remove">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;
    
    container.appendChild(itemElement);
    
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
            const removeBtn = item.querySelector('button');
            if (removeBtn) {
                removeBtn.onclick = () => removeCreateArrayItem(newIndex);
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

// Initialize when DOM is loaded
window.wsClient.registerInitStep(45, 'Initializing Text Replacement Manager', async () => {
    initializeTextReplacementManager();
});