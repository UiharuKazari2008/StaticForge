/**
 * Text Replacement Manager
 * Manages text replacements in prompt.config.json with a visual interface
 */

let textReplacementData = {};
let originalTextReplacementData = {};
let filteredReplacements = {};

// Pagination variables
let currentPage = 1;
const itemsPerPage = 10;

// Initialize text replacement manager
function initializeTextReplacementManager() {
    const textReplacementManagerBtn = document.getElementById('textReplacementManagerBtn');
    const closeTextReplacementManagerBtn = document.getElementById('closeTextReplacementManagerBtn');
    const saveTextReplacementsBtn = document.getElementById('saveTextReplacementsBtn');
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
    
    if (saveTextReplacementsBtn) {
        saveTextReplacementsBtn.addEventListener('click', saveTextReplacements);
    }
    
    if (textReplacementSearch) {
        textReplacementSearch.addEventListener('input', () => {
            currentPage = 1; // Reset to first page when searching
            filterTextReplacements();
        });
    }

    if (textReplacementPrevBtn) {
        textReplacementPrevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderTextReplacementList();
            }
        });
    }

    if (textReplacementNextBtn) {
        textReplacementNextBtn.addEventListener('click', () => {
            const totalPages = getTotalPages();
            if (currentPage < totalPages) {
                currentPage++;
                renderTextReplacementList();
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
        modal.addEventListener('keydown', (e) => {
            if (e.target.closest('.text-replacement-manager-content')) {
                const totalPages = getTotalPages();
                
                if (e.key === 'PageDown' && currentPage < totalPages) {
                    e.preventDefault();
                    currentPage++;
                    renderTextReplacementList();
                } else if (e.key === 'PageUp' && currentPage > 1) {
                    e.preventDefault();
                    currentPage--;
                    renderTextReplacementList();
                }
            }
        });
    }
}

// Show text replacement manager modal
async function showTextReplacementManager() {
    const modal = document.getElementById('textReplacementManagerModal');
    if (!modal) return;
    
    await loadTextReplacements();
    renderTextReplacementList();
    modal.style.display = 'flex';
    
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
        modal.style.display = 'none';
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
            // Request text replacements via WebSocket using sendMessage for proper response handling
            const result = await window.wsClient.sendMessage('get_text_replacements');
            
            if (result && result.textReplacements) {
                textReplacementData = { ...result.textReplacements };
                originalTextReplacementData = JSON.parse(JSON.stringify(result.textReplacements));
                filteredReplacements = { ...textReplacementData };
            } else {
                console.warn('No text replacements received from server');
                textReplacementData = {};
                originalTextReplacementData = {};
                filteredReplacements = {};
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

// Filter text replacements based on search
function filterTextReplacements() {
    const searchInput = document.getElementById('textReplacementSearch');
    const searchTerm = searchInput?.value.toLowerCase() || '';
    
    if (!searchTerm) {
        filteredReplacements = { ...textReplacementData };
    } else {
        filteredReplacements = {};
        Object.keys(textReplacementData).forEach(key => {
            const value = textReplacementData[key];
            const searchableText = `${key} ${Array.isArray(value) ? value.join(' ') : value}`.toLowerCase();
            
            if (searchableText.includes(searchTerm)) {
                filteredReplacements[key] = value;
            }
        });
    }
    
    renderTextReplacementList();
}

// Get total number of pages
function getTotalPages() {
    const totalItems = Object.keys(filteredReplacements).length;
    return Math.max(1, Math.ceil(totalItems / itemsPerPage));
}

// Get items for current page
function getCurrentPageItems() {
    const sortedKeys = Object.keys(filteredReplacements).sort();
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageKeys = sortedKeys.slice(startIndex, endIndex);
    
    const pageItems = {};
    pageKeys.forEach(key => {
        pageItems[key] = filteredReplacements[key];
    });
    
    return pageItems;
}

// Update pagination controls
function updatePaginationControls() {
    const totalPages = getTotalPages();
    const pageInfo = document.getElementById('textReplacementPageInfo');
    const prevBtn = document.getElementById('textReplacementPrevBtn');
    const nextBtn = document.getElementById('textReplacementNextBtn');
    
    if (pageInfo) {
        const totalItems = Object.keys(filteredReplacements).length;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} items)`;
    }
    
    if (prevBtn) {
        prevBtn.disabled = currentPage <= 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = currentPage >= totalPages;
    }
}

// Render the text replacement list
function renderTextReplacementList() {
    const listContainer = document.getElementById('textReplacementList');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    // Get current page items
    const pageItems = getCurrentPageItems();
    const pageKeys = Object.keys(pageItems);
    
    if (pageKeys.length === 0) {
        if (Object.keys(filteredReplacements).length === 0) {
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
        const value = pageItems[key];
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
    
    item.innerHTML = `
        <div class="text-replacement-header">
            <div class="text-replacement-name">!${key}</div>
            <div class="text-replacement-actions">
                <div class="text-replacement-type">${isArray ? 'Array' : 'String'}</div>
                <button type="button" class="edit-btn" onclick="toggleEditMode('${key}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="delete delete-btn" onclick="deleteTextReplacement('${key}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        <div class="text-replacement-content">
            <div class="text-replacement-value-container">
                ${isArray ? renderArrayValue(key, value) : renderStringValue(key, value)}
            </div>
        </div>
    `;
    
    return item;
}

// Render string value
function renderStringValue(key, value) {
    return `
        <textarea 
            class="text-replacement-value" 
            data-key="${key}" 
            data-type="string"
            placeholder="Enter text replacement value..."
            readonly
        >${escapeHtml(value)}</textarea>
    `;
}

// Render array value
function renderArrayValue(key, value) {
    const items = value.map((item, index) => `
        <div class="text-replacement-array-item" data-index="${index}">
            <input 
                type="text" 
                value="${escapeHtml(item)}" 
                data-key="${key}" 
                data-index="${index}"
                data-type="array"
                placeholder="Array item..."
                readonly
            />
            <button type="button" class="remove-array-item" onclick="removeArrayItem('${key}', ${index})" title="Remove">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
    
    return `
        <div class="text-replacement-array-items">
            ${items}
            <div class="text-replacement-add-item">
                <button type="button" onclick="addArrayItem('${key}')" title="Add Item">
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
        // Exit edit mode
        item.classList.remove('editing');
        
        // Make inputs readonly
        const inputs = item.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            input.readOnly = true;
        });
        
        // Update button icon
        const editBtn = item.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = 'Edit';
        }
    } else {
        // Enter edit mode
        item.classList.add('editing');
        
        // Make inputs editable
        const inputs = item.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            input.readOnly = false;
            input.addEventListener('input', () => updateTextReplacementValue(key));
        });
        
        // Update button icon
        const editBtn = item.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.innerHTML = '<i class="fas fa-check"></i>';
            editBtn.title = 'Save';
        }
        
        // Focus first input
        const firstInput = item.querySelector('input, textarea');
        if (firstInput) {
            firstInput.focus();
            firstInput.select();
        }
    }
}

// Update text replacement value
function updateTextReplacementValue(key) {
    const item = document.querySelector(`[data-key="${key}"]`);
    if (!item) return;
    
    const stringInput = item.querySelector('[data-type="string"]');
    const arrayInputs = item.querySelectorAll('[data-type="array"]');
    
    if (stringInput) {
        // Update string value
        textReplacementData[key] = stringInput.value;
    } else if (arrayInputs.length > 0) {
        // Update array value
        const arrayValue = Array.from(arrayInputs).map(input => input.value).filter(val => val.trim() !== '');
        textReplacementData[key] = arrayValue;
    }
    
    // Update filteredReplacements if this item is currently visible
    if (filteredReplacements.hasOwnProperty(key)) {
        filteredReplacements[key] = textReplacementData[key];
    }
    
    // Mark as modified
    const isModified = hasChanges(key, textReplacementData[key]);
    item.classList.toggle('modified', isModified);
}

// Add new array item
function addArrayItem(key) {
    if (!Array.isArray(textReplacementData[key])) return;
    
    textReplacementData[key].push('');
    filteredReplacements[key] = textReplacementData[key];
    
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
            
            // Update button icon
            const editBtn = newItem.querySelector('.edit-btn');
            if (editBtn) {
                editBtn.innerHTML = '<i class="fas fa-check"></i>';
                editBtn.title = 'Save';
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
    filteredReplacements[key] = textReplacementData[key];
    
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
            
            // Update button icon
            const editBtn = newItem.querySelector('.edit-btn');
            if (editBtn) {
                editBtn.innerHTML = '<i class="fas fa-check"></i>';
                editBtn.title = 'Save';
            }
        }
        
        item.replaceWith(newItem);
    }
}

// Delete text replacement
async function deleteTextReplacement(key) {
    const confirmed = await showGlassDialog(
        'Confirm Delete',
        `Are you sure you want to delete the text replacement "!${key}"?`,
        [
            { text: 'Cancel', value: false, className: 'btn-secondary' },
            { text: 'Delete', value: true, className: 'btn-danger' }
        ]
    );
    
    if (confirmed) {
        delete textReplacementData[key];
        delete filteredReplacements[key];
        renderTextReplacementList();
        
        showGlassToast('success', null, `Deleted text replacement "!${key}"`, false, 3000, '<i class="fas fa-trash"></i>');
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

// Save text replacements
async function saveTextReplacements() {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            // Save text replacements via WebSocket using sendMessage for proper response handling
            const result = await window.wsClient.sendMessage('save_text_replacements', {
                textReplacements: textReplacementData
            });
            
            if (result && result.success) {
                // Update original data
                originalTextReplacementData = JSON.parse(JSON.stringify(textReplacementData));
                
                // Re-render to remove modified indicators
                renderTextReplacementList();
                
                showGlassToast('success', null, 'Text replacements saved successfully', false, 3000, '<i class="fas fa-save"></i>');
            } else {
                const errorMsg = result?.error || 'Unknown error occurred';
                showGlassToast('error', null, `Failed to save text replacements: ${errorMsg}`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } else {
            showGlassToast('error', null, 'Unable to save text replacements: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    } catch (error) {
        console.error('Error saving text replacements:', error);
        showGlassToast('error', null, 'Error saving text replacements', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeTextReplacementManager);