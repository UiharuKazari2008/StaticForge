/**
 * Request Body Text Replacements Modal Manager
 * Manages ephemeral text replacements that are merged with prompt.config.json at request time
 */

// Global state for request body replacements
let requestBodyReplacements = [];
let originalRequestBodyReplacements = [];

// Initialize request body replacements modal
function initializeRequestBodyReplacementsModal() {
    const modal = document.getElementById('requestBodyReplacementsModal');
    const closeBtn = document.getElementById('closeRequestBodyReplacementsBtn');
    const addBtn = document.getElementById('addRequestBodyReplacementBtn');
    const manageBtn = document.getElementById('manageTextReplacementsBtn');

    if (modal) {
        // Close on escape key
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideRequestBodyReplacementsModal();
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', hideRequestBodyReplacementsModal);
    }

    if (addBtn) {
        addBtn.addEventListener('click', showCreateRequestBodyReplacementModal);
    }

    if (manageBtn) {
        manageBtn.addEventListener('click', () => {
            hideRequestBodyReplacementsModal();
            showTextReplacementManager();
        });
    }

    // Initialize create modal
    initializeCreateRequestBodyReplacementModal();
}

// Initialize create request body replacement modal
function initializeCreateRequestBodyReplacementModal() {
    const modal = document.getElementById('createRequestBodyReplacementModal');
    const closeBtn = document.getElementById('closeCreateRequestBodyReplacementBtn');
    const cancelBtn = document.getElementById('createRequestBodyReplacementCancelBtn');
    const saveBtn = document.getElementById('createRequestBodyReplacementSaveBtn');
    const typeSelect = document.getElementById('requestBodyReplacementTypeSelect');
    const extendBtn = document.getElementById('requestBodyReplacementExtendBtn');

    if (modal) {
        // Close on escape key
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideCreateRequestBodyReplacementModal();
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', hideCreateRequestBodyReplacementModal);
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideCreateRequestBodyReplacementModal);
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', handleCreateRequestBodyReplacementSubmit);
    }

    // Setup custom dropdown for stage type
    setupCreateStageTypeDropdown();

    if (extendBtn) {
        extendBtn.addEventListener('click', () => {
            const isExtend = extendBtn.getAttribute('data-state') === 'on';
            extendBtn.setAttribute('data-state', isExtend ? 'off' : 'on');
            extendBtn.title = isExtend ? 'Replace Mode' : 'Extend Mode';
        });
    }

    // Add event listener for add array item button
    const addArrayItemBtn = document.getElementById('addCreateRequestBodyArrayItemBtn');
    if (addArrayItemBtn) {
        addArrayItemBtn.addEventListener('click', addCreateRequestBodyArrayItem);
    }
}

// Show request body replacements modal
function showRequestBodyReplacementsModal() {
    const modal = document.getElementById('requestBodyReplacementsModal');
    if (!modal) return;
    
    renderRequestBodyReplacementsList();
    openModal(modal);
}

// Hide request body replacements modal
function hideRequestBodyReplacementsModal() {
    const modal = document.getElementById('requestBodyReplacementsModal');
    if (modal) {
        closeModal(modal);
    }
}

// Show create request body replacement modal
function showCreateRequestBodyReplacementModal() {
    const modal = document.getElementById('createRequestBodyReplacementModal');
    if (!modal) return;
    
    // Reset form
    document.getElementById('requestBodyReplacementKeyInput').value = '';
    
    // Reset stage type dropdown
    const typeSelected = document.getElementById('requestBodyReplacementTypeSelected');
    if (typeSelected) {
        typeSelected.textContent = 'All';
    }
    
    // Reset range inputs
    const rangeStartInput = document.getElementById('rangeStartInput');
    const rangeEndInput = document.getElementById('rangeEndInput');
    if (rangeStartInput) rangeStartInput.value = '';
    if (rangeEndInput) rangeEndInput.value = '';
    
    // Reset extend button
    const extendBtn = document.getElementById('requestBodyReplacementExtendBtn');
    if (extendBtn) {
        extendBtn.setAttribute('data-state', 'off');
        extendBtn.title = 'Replace Mode';
    }
    
    // Clear array items
    const arrayContainer = document.getElementById('createRequestBodyArrayItemsContainer');
    if (arrayContainer) {
        arrayContainer.innerHTML = '';
    }
    
    // Initialize with one array item
    initializeCreateRequestBodyArrayItems();
    
    // Update stage configuration visibility
    updateCreateStageConfigurationVisibility();
    
    // Show modal
    openModal(modal);
    
    // Focus key input
    document.getElementById('requestBodyReplacementKeyInput').focus();
}

// Hide create request body replacement modal
function hideCreateRequestBodyReplacementModal() {
    const modal = document.getElementById('createRequestBodyReplacementModal');
    if (modal) {
        closeModal(modal);
    }
}


// Build stage selection dropdown from pipeline stages
function buildStageSelectionDropdown() {
    const dropdown = document.getElementById('specificStagesDropdown');
    const button = document.getElementById('specificStagesBtn');
    const menu = document.getElementById('specificStagesMenu');
    const selected = document.getElementById('specificStagesSelected');
    
    if (!dropdown) return;
    
    const stages = getAvailableStages();
    
    if (stages.length === 0) {
        selected.textContent = 'No stages available';
        return;
    }
    
    // Store selected stages on the dropdown element for access
    dropdown.selectedStages = [];
    
    // Update selected text
    function updateSelectedText() {
        if (dropdown.selectedStages.length === 0) {
            selected.textContent = 'Select stages...';
        } else if (dropdown.selectedStages.length === 1) {
            selected.textContent = stages[dropdown.selectedStages[0]];
        } else {
            selected.textContent = `${dropdown.selectedStages.length} stages`;
        }
    }
    
    function renderStageSelectionDropdown() {
        menu.innerHTML = '';
        stages.forEach((stage, index) => {
            const isSelected = dropdown.selectedStages.includes(index);
            
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option' + (isSelected ? ' selected' : '');
            optionElement.dataset.value = index;
            optionElement.textContent = stage;
            
            optionElement.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent dropdown from closing
                toggleStageSelection(index);
            });
            
            menu.appendChild(optionElement);
        });
    }
    
    function toggleStageSelection(stageIndex) {
        const index = dropdown.selectedStages.indexOf(stageIndex);
        if (index > -1) {
            dropdown.selectedStages.splice(index, 1); // Remove if selected
        } else {
            dropdown.selectedStages.push(stageIndex); // Add if not selected
        }
        
        // Update display
        renderStageSelectionDropdown();
        updateSelectedText();
    }
    
    // Setup dropdown (only once)
    if (!dropdown.dataset.setupComplete) {
        setupDropdown(
            dropdown,
            button,
            menu,
            renderStageSelectionDropdown,
            () => dropdown.selectedStages,
            { preventFocusTransfer: true }
        );
        dropdown.dataset.setupComplete = 'true';
    }
    
    // Initial render
    updateSelectedText();
    renderStageSelectionDropdown();
}

// Get available stages from pipeline container
function getAvailableStages() {
    const stages = ['Base Layer']; // Always include base layer (stage 0)
    
    const pipelineContainer = document.getElementById('pipelineStagesContainer');
    if (pipelineContainer) {
        const stageItems = pipelineContainer.querySelectorAll('.pipeline-stage-item');
        stageItems.forEach((item, index) => {
            const stageType = item.querySelector('.stage-type')?.textContent || `Stage ${index + 1}`;
            stages.push(`Stage ${index + 1} (${stageType})`);
        });
    }
    
    return stages;
}

// Initialize array items for create modal
function initializeCreateRequestBodyArrayItems() {
    const container = document.getElementById('createRequestBodyArrayItemsContainer');
    if (!container) return;
    
    // Clear existing items
    container.innerHTML = '';
    
    // Add one initial empty item
    addCreateRequestBodyArrayItem();
}

// Add new array item to create modal
function addCreateRequestBodyArrayItem() {
    const container = document.getElementById('createRequestBodyArrayItemsContainer');
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
                </div>
                <div class="toolbar-right">
                    <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="off" title="Toggle Autofill">
                        <i class="fas fa-lightbulb-slash"></i>
                    </button>
                    <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                        <i class="fas fa-scale-unbalanced-flip"></i>
                    </button>
                    <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                        <i class="fas fa-book-font"></i>
                    </button>
                </div>
            </div>
        </div>
        <button class="btn-secondary remove-array-item" type="button" title="Remove">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;
    
    container.appendChild(itemElement);
    
    // Add event listener for remove button
    const removeBtn = itemElement.querySelector('.remove-array-item');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            removeCreateRequestBodyArrayItem(itemIndex);
        });
    }
    
    // Focus the new textarea
    const newTextarea = itemElement.querySelector('textarea');
    if (newTextarea) {
        newTextarea.focus();
        setupRequestBodyReplacementTextarea(newTextarea);
    }
    
    // Update remove button visibility
    updateCreateRequestBodyRemoveButtonVisibility();
}

// Setup stage controls for inline editing
function setupEditStageControls(index, replacement) {
    const stageTypeDropdown = document.getElementById(`editStageTypeDropdown_${index}`);
    const stageTypeBtn = document.getElementById(`editStageTypeBtn_${index}`);
    const stageTypeMenu = document.getElementById(`editStageTypeMenu_${index}`);
    const stageTypeSelected = document.getElementById(`editStageTypeSelected_${index}`);
    const specificStagesRow = document.getElementById(`editSpecificStagesRow_${index}`);
    const rangeStagesRow = document.getElementById(`editRangeStagesRow_${index}`);
    const rangeStartInput = document.getElementById(`editRangeStartInput_${index}`);
    const rangeEndInput = document.getElementById(`editRangeEndInput_${index}`);
    
    if (!stageTypeDropdown) return;
    
    // Set initial stage type based on replacement.stages
    let stageType = 'all';
    if (replacement.stages) {
        if (Array.isArray(replacement.stages)) {
            stageType = 'specific';
        } else if (typeof replacement.stages === 'object') {
            stageType = 'range';
        }
    }
    
    // Setup custom dropdown
    const stageOptions = [
        { value: 'all', name: 'All' },
        { value: 'specific', name: 'Select' },
        { value: 'range', name: 'Range' }
    ];
    
    function renderEditStageTypeDropdown(selectedValue) {
        stageTypeMenu.innerHTML = '';
        stageOptions.forEach(option => {
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option' + 
                (selectedValue === option.value ? ' selected' : '');
            optionElement.dataset.value = option.value;
            optionElement.textContent = option.name;
            
            optionElement.addEventListener('click', () => {
                selectEditStageType(option.value);
                closeDropdown(stageTypeMenu, stageTypeBtn);
            });
            
            stageTypeMenu.appendChild(optionElement);
        });
    }
    
    function selectEditStageType(value) {
        const option = stageOptions.find(opt => opt.value === value);
        if (option) {
            stageTypeSelected.textContent = option.name;
        }
        
        // Hide all stage control rows
        specificStagesRow.classList.add('hidden');
        rangeStagesRow.classList.add('hidden');
        
        // Show relevant row
        if (value === 'specific') {
            specificStagesRow.classList.remove('hidden');
            buildEditStageSelectionDropdown([], index);
        } else if (value === 'range') {
            rangeStagesRow.classList.remove('hidden');
        }
    }
    
    // Setup dropdown
    setupDropdown(
        stageTypeDropdown,
        stageTypeBtn,
        stageTypeMenu,
        renderEditStageTypeDropdown,
        () => stageType,
        { preventFocusTransfer: true }
    );
    
    // Set initial selection
    selectEditStageType(stageType);
    
    // Initialize stage controls based on current replacement
    if (stageType === 'specific' && Array.isArray(replacement.stages)) {
        specificStagesRow.classList.remove('hidden');
        buildEditStageSelectionDropdown(replacement.stages, index);
    } else if (stageType === 'range' && typeof replacement.stages === 'object') {
        rangeStagesRow.classList.remove('hidden');
        if (replacement.stages.start !== undefined) {
            rangeStartInput.value = replacement.stages.start;
        }
        if (replacement.stages.end !== undefined) {
            rangeEndInput.value = replacement.stages.end;
        }
    }
}

// Build stage selection dropdown for inline editing
function buildEditStageSelectionDropdown(selectedStages = [], index) {
    const dropdown = document.getElementById(`editSpecificStagesDropdown_${index}`);
    const button = document.getElementById(`editSpecificStagesBtn_${index}`);
    const menu = document.getElementById(`editSpecificStagesMenu_${index}`);
    const selected = document.getElementById(`editSpecificStagesSelected_${index}`);
    
    if (!dropdown) return;
    
    const stages = getAvailableStages();
    
    // Store selected stages on the dropdown element for access
    dropdown.selectedStages = [...selectedStages];
    
    // Update selected text
    function updateSelectedText() {
        if (dropdown.selectedStages.length === 0) {
            selected.textContent = 'Select stages...';
        } else if (dropdown.selectedStages.length === 1) {
            selected.textContent = stages[dropdown.selectedStages[0]];
        } else {
            selected.textContent = `${dropdown.selectedStages.length} stages`;
        }
    }
    
    function toggleEditStageSelection(stageIndex) {
        const selectedIndex = dropdown.selectedStages.indexOf(stageIndex);
        if (selectedIndex > -1) {
            dropdown.selectedStages.splice(selectedIndex, 1); // Remove if selected
        } else {
            dropdown.selectedStages.push(stageIndex); // Add if not selected
        }
        
        // Update display
        renderEditStageSelectionDropdown();
        updateSelectedText();
    }
    
    function renderEditStageSelectionDropdown() {
        menu.innerHTML = '';
        stages.forEach((stage, stageIndex) => {
            const isSelected = dropdown.selectedStages.includes(stageIndex);
            
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option' + (isSelected ? ' selected' : '');
            optionElement.dataset.value = stageIndex;
            optionElement.textContent = stage;
            
            optionElement.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent dropdown from closing
                toggleEditStageSelection(stageIndex);
            });
            
            menu.appendChild(optionElement);
        });
    }
    
    // Setup dropdown using setupDropdown (only once)
    if (!dropdown.dataset.setupComplete) {
        setupDropdown(
            dropdown,
            button,
            menu,
            renderEditStageSelectionDropdown,
            () => dropdown.selectedStages,
            { preventFocusTransfer: true }
        );
        dropdown.dataset.setupComplete = 'true';
    }
    
    // Initial render
    updateSelectedText();
    renderEditStageSelectionDropdown();
}

// Get stage configuration from edit mode controls
function getEditStageConfiguration(index) {
    const stageTypeSelected = document.getElementById(`editStageTypeSelected_${index}`);
    if (!stageTypeSelected) return undefined;
    
    const stageTypeText = stageTypeSelected.textContent;
    let stageType = 'all';
    
    if (stageTypeText === 'Select') {
        stageType = 'specific';
    } else if (stageTypeText === 'Range') {
        stageType = 'range';
    }
    
    if (stageType === 'all') {
        return undefined;
    } else if (stageType === 'specific') {
        const dropdown = document.getElementById(`editSpecificStagesDropdown_${index}`);
        const selectedStages = dropdown && dropdown.selectedStages ? dropdown.selectedStages : [];
        return selectedStages.length > 0 ? selectedStages : undefined;
    } else if (stageType === 'range') {
        const startInput = document.getElementById(`editRangeStartInput_${index}`);
        const endInput = document.getElementById(`editRangeEndInput_${index}`);
        
        const start = startInput.value ? parseInt(startInput.value) : undefined;
        const end = endInput.value ? parseInt(endInput.value) : undefined;
        
        if (start !== undefined || end !== undefined) {
            return { start, end };
        }
        return undefined;
    }
    
    return undefined;
}

// Setup custom dropdown for create modal stage type
function setupCreateStageTypeDropdown() {
    const dropdown = document.getElementById('requestBodyReplacementTypeDropdown');
    const button = document.getElementById('requestBodyReplacementTypeBtn');
    const menu = document.getElementById('requestBodyReplacementTypeMenu');
    const selected = document.getElementById('requestBodyReplacementTypeSelected');
    
    if (!dropdown) return;
    
    const stageOptions = [
        { value: 'all', name: 'All' },
        { value: 'specific', name: 'Select' },
        { value: 'range', name: 'Range' }
    ];
    
    function renderCreateStageTypeDropdown(selectedValue) {
        menu.innerHTML = '';
        stageOptions.forEach(option => {
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option' + 
                (selectedValue === option.value ? ' selected' : '');
            optionElement.dataset.value = option.value;
            optionElement.textContent = option.name;
            
            optionElement.addEventListener('click', () => {
                selectCreateStageType(option.value);
                closeDropdown(menu, button);
            });
            
            menu.appendChild(optionElement);
        });
    }
    
    function selectCreateStageType(value) {
        const option = stageOptions.find(opt => opt.value === value);
        if (option) {
            selected.textContent = option.name;
        }
        updateCreateStageConfigurationVisibility();
    }
    
    // Setup dropdown
    setupDropdown(
        dropdown,
        button,
        menu,
        renderCreateStageTypeDropdown,
        () => 'all',
        { preventFocusTransfer: true }
    );
}

// Update stage configuration visibility for create modal
function updateCreateStageConfigurationVisibility() {
    const selected = document.getElementById('requestBodyReplacementTypeSelected');
    const specificStagesRow = document.getElementById('specificStagesRow');
    const rangeStagesRow = document.getElementById('rangeStagesRow');
    
    if (!selected) return;
    
    const stageTypeText = selected.textContent;
    
    // Hide all stage configuration rows
    if (specificStagesRow) specificStagesRow.classList.add('hidden');
    if (rangeStagesRow) rangeStagesRow.classList.add('hidden');
    
    // Check if there are any stages available
    const stages = getAvailableStages();
    const hasStages = stages.length > 1; // More than just "Base Layer"
    
    // Show relevant row based on selection
    if (stageTypeText === 'Select' && hasStages) {
        if (specificStagesRow) {
            specificStagesRow.classList.remove('hidden');
            buildStageSelectionDropdown();
        }
    } else if (stageTypeText === 'Range' && hasStages) {
        if (rangeStagesRow) {
            rangeStagesRow.classList.remove('hidden');
        }
    } else if (!hasStages && (stageTypeText === 'Select' || stageTypeText === 'Range')) {
        // If no stages available, force back to "all"
        const typeSelected = document.getElementById('requestBodyReplacementTypeSelected');
        if (typeSelected) {
            typeSelected.textContent = 'All';
        }
        showGlassToast('info', null, 'No pipeline stages available. Using "All Stages" instead.', false, 3000, '<i class="fas fa-info-circle"></i>');
    }
}

// Remove array item from create modal
function removeCreateRequestBodyArrayItem(index) {
    const container = document.getElementById('createRequestBodyArrayItemsContainer');
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
                removeBtn.onclick = () => removeCreateRequestBodyArrayItem(newIndex);
            }
        });
        
        // Update remove button visibility based on item count
        updateCreateRequestBodyRemoveButtonVisibility();
    }
}

// Update remove button visibility - hide for single items
function updateCreateRequestBodyRemoveButtonVisibility() {
    const container = document.getElementById('createRequestBodyArrayItemsContainer');
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

// Setup textarea with prompt textarea features
function setupRequestBodyReplacementTextarea(textarea) {
    // Use shared utility with custom toolbar handler
    setupEditableTextarea(textarea, handleRequestBodyReplacementToolbarAction);
}

// Handle toolbar actions
function handleRequestBodyReplacementToolbarAction(action, textarea, toolbar, event) {
    switch (action) {
        case 'quick-access':
            openRequestBodyReplacementQuickAccess(textarea);
            break;
        case 'emphasis':
            openRequestBodyReplacementEmphasisMode(textarea, toolbar);
            break;
        case 'autofill':
            // Autofill is handled by the main toolbar system
            break;
    }
}

// Open quick access
function openRequestBodyReplacementQuickAccess(textarea) {
    if (window.showDatasetTagToolbar) {
        textarea.focus();
        window.showDatasetTagToolbar();
    }
}

// Open emphasis mode
function openRequestBodyReplacementEmphasisMode(textarea, toolbar) {
    if (!toolbar) return;
    
    if (window.startEmphasisEditing) {
        window.startEmphasisEditing(textarea);
    }
    
    toolbar.classList.add('emphasis-mode');
    
    if (window.promptTextareaToolbar) {
        window.promptTextareaToolbar.initializeEmphasisMode(textarea, toolbar);
        window.promptTextareaToolbar.updateEmphasisDisplay(toolbar);
    }
    
    setTimeout(() => textarea.focus(), 10);
}

// Handle create request body replacement form submission
async function handleCreateRequestBodyReplacementSubmit() {
    const keyInput = document.getElementById('requestBodyReplacementKeyInput');
    const typeSelect = document.getElementById('requestBodyReplacementTypeSelect');
    const extendBtn = document.getElementById('requestBodyReplacementExtendBtn');
    
    const name = keyInput.value.trim();
    
    // Validate name
    if (!name) {
        showGlassToast('error', null, 'Please enter a name', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        keyInput.focus();
        return;
    }
    
    // Validate name format (alphanumeric and underscores only)
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        showGlassToast('error', null, 'Name can only contain letters, numbers, and underscores', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        keyInput.focus();
        return;
    }
    
    // Note: Duplicate names are now allowed - they will auto-merge when applicable to the same stage
    
    // Collect values from individual array item textareas
    const arrayTextareas = document.querySelectorAll('#createRequestBodyArrayItemsContainer textarea');
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
    
    // Determine stages configuration
    const typeSelected = document.getElementById('requestBodyReplacementTypeSelected');
    const stageTypeText = typeSelected ? typeSelected.textContent : 'All';
    
    let stages = undefined;
    if (stageTypeText === 'Select') {
        const dropdown = document.getElementById('specificStagesDropdown');
        const selectedStages = dropdown && dropdown.selectedStages ? dropdown.selectedStages : [];
        if (selectedStages.length > 0) {
            stages = selectedStages;
        }
    } else if (stageTypeText === 'Range') {
        const startInput = document.getElementById('rangeStartInput');
        const endInput = document.getElementById('rangeEndInput');
        const start = startInput ? parseInt(startInput.value) : undefined;
        const end = endInput ? parseInt(endInput.value) : undefined;
        
        // Validate range values
        if (start !== undefined && (isNaN(start) || start < 0)) {
            showGlassToast('error', null, 'Start stage must be a non-negative number', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        if (end !== undefined && (isNaN(end) || end < 0)) {
            showGlassToast('error', null, 'End stage must be a non-negative number', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        if (start !== undefined && end !== undefined && start > end) {
            showGlassToast('error', null, 'Start stage cannot be greater than end stage', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        
        if (start !== undefined || end !== undefined) {
            stages = {};
            if (start !== undefined) stages.start = start;
            if (end !== undefined) stages.end = end;
        }
    }
    
    // Create replacement object
    const replacement = {
        name: name,
        value: value,
        extend: extendBtn ? extendBtn.getAttribute('data-state') === 'on' : false,
        stages: stages
    };
    
    // Add to array
    requestBodyReplacements.push(replacement);
    
    // Hide modal
    hideCreateRequestBodyReplacementModal();
    
    // Refresh the list
    renderRequestBodyReplacementsList();
    
    showGlassToast('success', null, `Created request body replacement "${name}"`, false, 3000, '<i class="fas fa-plus"></i>');
}

// Render the request body replacements list
function renderRequestBodyReplacementsList() {
    const listContainer = document.getElementById('requestBodyReplacementsList');
    if (!listContainer) return;

    // Don't re-render if any item is currently being edited
    const editingItem = listContainer.querySelector('.text-replacement-item.editing');
    if (editingItem) {
        console.log('Skipping re-render because item is being edited');
        return;
    }

    listContainer.innerHTML = '';

    if (requestBodyReplacements.length === 0) {
        listContainer.innerHTML = `
            <div class="text-replacement-empty">
                <p><i class="fas fa-search"></i> No request body replacements found</p>
            </div>
        `;
        return;
    }

    requestBodyReplacements.forEach((replacement, index) => {
        const itemElement = createRequestBodyReplacementItem(replacement, index);
        listContainer.appendChild(itemElement);
    });
}

// Create a request body replacement item element
function createRequestBodyReplacementItem(replacement, index) {
    const item = document.createElement('div');
    item.className = 'text-replacement-item';
    item.dataset.index = index;
    
    const isArray = Array.isArray(replacement.value);
    const stagesText = getStagesDisplayText(replacement.stages);
    
    item.innerHTML = `
        <div class="text-replacement-header">
            <div class="text-replacement-name-container">
                <div class="text-replacement-name">${escapeHtml(replacement.name)}</div>
                <div class="text-replacement-extend ${replacement.extend ? 'extend' : 'replace'}" title="${replacement.extend ? 'Extend Mode' : 'Replace Mode'}">
                    <i class="fas ${replacement.extend ? 'fa-square-dashed-circle-plus' : 'fa-square-dashed'}"></i>
                </div>
            </div>
            <div class="text-replacement-actions">
                <div class="text-replacement-type ${isArray ? 'random' : ''}">${isArray ? '<i class="fas fa-dice"></i>' : '<i class="fas fa-input-text"></i>'}</div>
                <div class="text-replacement-stages">${stagesText}</div>
                <button type="button" class="btn-small btn-secondary edit-btn" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn-small btn-danger delete-btn" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        <div class="text-replacement-content">
            <div class="text-replacement-value-container">
                ${renderRequestBodyReplacementValue(replacement.name, replacement.value)}
            </div>
        </div>
    `;
    
    // Add event listeners
    const editBtn = item.querySelector('.edit-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            editRequestBodyReplacement(index);
        });
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            deleteRequestBodyReplacement(index);
        });
    }
    
    return item;
}

// Get stages display text
function getStagesDisplayText(stages) {
    if (!stages) return '<span class="stages-all">All</span>';
    
    if (Array.isArray(stages)) {
        return `<span class="stages-specific">${stages.join(', ')}</span>`;
    }
    
    if (typeof stages === 'object') {
        const { start, end } = stages;
        if (start !== undefined && end !== undefined) {
            return `<span class="stages-range">${start}-${end}</span>`;
        } else if (start !== undefined) {
            return `<span class="stages-range">${start}+</span>`;
        } else if (end !== undefined) {
            return `<span class="stages-range">0-${end}</span>`;
        }
    }
    
    return '<span class="stages-all">All</span>';
}

// Render replacement value
function renderRequestBodyReplacementValue(name, value) {
    if (Array.isArray(value)) {
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
            </div>
        `;
    } else {
        return `
            <div class="text-replacement-array-items">
                <div class="text-replacement-array-item" data-index="0">
                    <div class="text-replacement-value-display">
                        <span class="text-replacement-text">${escapeHtml(value)}</span>
                    </div>
                </div>
            </div>
        `;
    }
}

// Edit request body replacement (inline editing)
function editRequestBodyReplacement(index) {
    const replacement = requestBodyReplacements[index];
    if (!replacement) {
        console.error('Replacement not found at index:', index);
        return;
    }
    
    const listContainer = document.getElementById('requestBodyReplacementsList');
    if (!listContainer) {
        console.error('List container not found');
        return;
    }
    
    const item = listContainer.querySelector(`.text-replacement-item[data-index="${index}"]`);
    if (!item) {
        console.error('Item element not found for index:', index);
        return;
    }
    
    // Toggle edit mode
    if (item.classList.contains('editing')) {
        exitEditMode(item);
    } else {
        enterEditMode(item, index);
    }
}

// Enter edit mode for inline editing
function enterEditMode(item, index) {
    const replacement = requestBodyReplacements[index];
    if (!replacement) return;
    
    item.classList.add('editing');
    
    const nameElement = item.querySelector('.text-replacement-name');
    const valueContainer = item.querySelector('.text-replacement-content .text-replacement-value-container');
    
    if (!nameElement || !valueContainer) {
        console.error('Could not find required elements for inline editing');
        console.error('Available elements:', item.querySelectorAll('*'));
        console.error('Looking for:', '.text-replacement-name', '.text-replacement-content .text-replacement-value-container');
        return;
    }
    
    // Convert name to input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-control hover-show colored';
    nameInput.value = replacement.name;
    nameInput.maxLength = 50;
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveRequestBodyReplacement(index);
            exitEditMode(item);
        } else if (e.key === 'Escape') {
            exitEditMode(item, true);
        }
    });
    
    nameElement.innerHTML = '';
    nameElement.appendChild(nameInput);
    nameInput.focus();
    nameInput.select();
    
    // Add stage configuration controls
    const stageControlsContainer = document.createElement('div');
    stageControlsContainer.className = 'text-replacement-stage-controls';
    stageControlsContainer.innerHTML = `
        <div class="form-group">
            <div class="form-group-row">
                <div id="editStageTypeDropdown_${index}" class="custom-dropdown">
                    <button type="button" id="editStageTypeBtn_${index}" class="custom-dropdown-btn hover-show colored">
                        <span id="editStageTypeSelected_${index}">All Stages</span>
                    </button>
                    <div id="editStageTypeMenu_${index}" class="custom-dropdown-menu hidden">
                        <!-- Options will be populated by JavaScript -->
                    </div>
                </div>
            </div>
        </div>
        <div id="editSpecificStagesRow_${index}" class="form-row hidden">
            <div class="form-group">
                <div id="editSpecificStagesDropdown_${index}" class="custom-dropdown">
                    <button type="button" id="editSpecificStagesBtn_${index}" class="custom-dropdown-btn hover-show colored">
                        <span id="editSpecificStagesSelected_${index}">Select stages...</span>
                    </button>
                    <div id="editSpecificStagesMenu_${index}" class="custom-dropdown-menu hidden">
                        <!-- Stage options will be populated here -->
                    </div>
                </div>
            </div>
        </div>
        <div id="editRangeStagesRow_${index}" class="form-row hidden">
            <div class="form-group">
                <div class="form-row">
                    <div class="form-group">
                        <input type="number" id="editRangeStartInput_${index}" class="form-control hover-show colored" placeholder="Start" min="0" style="width: 50px;">
                    </div>
                    <div class="form-group">
                        <input type="number" id="editRangeEndInput_${index}" class="form-control hover-show colored" placeholder="End" min="0" style="width: 50px;">
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Insert stage controls after the name input
    nameElement.parentNode.insertBefore(stageControlsContainer, nameElement.nextSibling);
    
    // Setup stage controls
    setupEditStageControls(index, replacement);
    
    // Convert values to editable textareas
    const values = Array.isArray(replacement.value) ? replacement.value : [replacement.value];
    valueContainer.innerHTML = '';
    
    values.forEach((value, valueIndex) => {
        const arrayItem = document.createElement('div');
        arrayItem.className = 'text-replacement-array-item';
        arrayItem.dataset.index = valueIndex;
        
        arrayItem.innerHTML = `
            <div class="character-prompt-textarea-container">
                <div class="character-prompt-textarea-background"></div>
                <textarea 
                    class="form-control character-prompt-textarea prompt-textarea"
                    rows="2"
                    data-index="${valueIndex}"
                    placeholder="Enter value..."
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
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                            <i class="fas fa-scale-unbalanced-flip"></i>
                        </button>
                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                            <i class="fas fa-book-font"></i>
                        </button>
                    </div>
                </div>
            </div>
            <button class="btn-secondary remove-array-item" type="button" title="Remove">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;
        
        valueContainer.appendChild(arrayItem);
        
        // Add event listener for remove button
        const removeBtn = arrayItem.querySelector('.remove-array-item');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                removeRequestBodyArrayItem(index, valueIndex);
            });
        }
        
        // Setup textarea
        const textarea = arrayItem.querySelector('textarea');
        if (textarea) {
            setupRequestBodyReplacementTextarea(textarea);
        }
    });
    
    // Add "Add Item" button
    const addItemBtn = document.createElement('div');
    addItemBtn.className = 'text-replacement-add-item';
    addItemBtn.innerHTML = `
        <button type="button" class="btn-primary" title="Add Item">
            <i class="fas fa-plus"></i> Add Item
        </button>
    `;
    valueContainer.appendChild(addItemBtn);
    
    // Add event listener for "Add Item" button
    const addBtn = addItemBtn.querySelector('button');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            addRequestBodyArrayItem(index);
        });
    }
    
    // Hide edit/delete buttons and display mode indicators
    const editBtn = item.querySelector('.edit-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    const extendIndicator = item.querySelector('.text-replacement-extend');
    const stagesIndicator = item.querySelector('.text-replacement-stages');
    const typeIndicator = item.querySelector('.text-replacement-type');
    
    if (editBtn) editBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (extendIndicator) extendIndicator.style.display = 'none';
    if (stagesIndicator) stagesIndicator.style.display = 'none';
    if (typeIndicator) typeIndicator.style.display = 'none';
    
    // Add extend mode toggle button
    const extendToggleBtn = document.createElement('button');
    extendToggleBtn.type = 'button';
    extendToggleBtn.className = `btn-secondary btn-small indicator ${replacement.extend ? 'active' : ''}`;
    extendToggleBtn.setAttribute('data-state', replacement.extend ? 'on' : 'off');
    extendToggleBtn.title = replacement.extend ? 'Extend Mode' : 'Replace Mode';
    extendToggleBtn.innerHTML = `<i class="fas ${replacement.extend ? 'fa-square-dashed-circle-plus' : 'fa-square-dashed'}"></i>`;
    extendToggleBtn.addEventListener('click', () => {
        const isExtend = extendToggleBtn.getAttribute('data-state') === 'on';
        const newState = isExtend ? 'off' : 'on';
        extendToggleBtn.setAttribute('data-state', newState);
        extendToggleBtn.title = newState === 'on' ? 'Extend Mode' : 'Replace Mode';
        extendToggleBtn.classList.toggle('active', newState === 'on');
        
        // Update icon
        const icon = extendToggleBtn.querySelector('i');
        if (icon) {
            icon.className = `fas ${newState === 'on' ? 'fa-square-dashed-circle-plus' : 'fa-square-dashed'}`;
        }
    });
    
    // Add save/cancel buttons
    const actionButtons = document.createElement('div');
    actionButtons.className = 'text-replacement-edit-actions';
    
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-primary btn-small';
    saveBtn.title = 'Save';
    saveBtn.innerHTML = '<i class="fas fa-check"></i>';
    saveBtn.addEventListener('click', () => {
        saveRequestBodyReplacement(index);
    });
    
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary btn-small';
    cancelBtn.title = 'Cancel';
    cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
    cancelBtn.addEventListener('click', () => {
        exitEditMode(item, true);
    });
    
    actionButtons.appendChild(saveBtn);
    actionButtons.appendChild(cancelBtn);
    
    const actionsContainer = item.querySelector('.text-replacement-actions');
    actionsContainer.insertBefore(extendToggleBtn, actionsContainer.firstChild);
    actionsContainer.appendChild(actionButtons);
}

// Exit edit mode
function exitEditMode(item, cancel = false) {
    if (!item.classList.contains('editing')) return;
    
    const index = parseInt(item.dataset.index);
    const replacement = requestBodyReplacements[index];
    if (!replacement) return;
    
    // Restore display mode
    item.classList.remove('editing');
    
    // Show edit/delete buttons and display mode indicators
    const editBtn = item.querySelector('.edit-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    const extendIndicator = item.querySelector('.text-replacement-extend');
    const stagesIndicator = item.querySelector('.text-replacement-stages');
    const typeIndicator = item.querySelector('.text-replacement-type');
    
    if (editBtn) editBtn.style.display = '';
    if (deleteBtn) deleteBtn.style.display = '';
    if (extendIndicator) extendIndicator.style.display = '';
    if (stagesIndicator) stagesIndicator.style.display = '';
    if (typeIndicator) typeIndicator.style.display = '';
    
    // Remove action buttons and extend toggle
    const actionButtons = item.querySelector('.text-replacement-edit-actions');
    const extendToggleBtn = item.querySelector('.text-replacement-actions button.indicator');
    if (actionButtons) {
        actionButtons.remove();
    }
    if (extendToggleBtn && extendToggleBtn.title.includes('Mode')) {
        extendToggleBtn.remove();
    }
    
    // Restore name display
    const nameElement = item.querySelector('.text-replacement-name');
    if (nameElement) {
        nameElement.innerHTML = escapeHtml(replacement.name);
    }
    
    // Restore value display
    const valueContainer = item.querySelector('.text-replacement-value-container');
    if (valueContainer) {
        valueContainer.innerHTML = renderRequestBodyReplacementValue(replacement.name, replacement.value);
    }
    
    // Rerender the entire modal to update all displays
    renderRequestBodyReplacementsList();
}

// Save request body replacement (inline)
function saveRequestBodyReplacement(index) {
    const listContainer = document.getElementById('requestBodyReplacementsList');
    if (!listContainer) return;
    
    const item = listContainer.querySelector(`.text-replacement-item[data-index="${index}"]`);
    if (!item) return;
    
    const replacement = requestBodyReplacements[index];
    if (!replacement) return;
    
    // Get name
    const nameInput = item.querySelector('.text-replacement-name input');
    const newName = nameInput ? nameInput.value.trim() : replacement.name;
    
    // Validate name
    if (!newName) {
        showGlassToast('error', null, 'Name cannot be empty', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(newName)) {
        showGlassToast('error', null, 'Name can only contain letters, numbers, and underscores', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    
    // Note: Duplicate names are now allowed - they will auto-merge when applicable to the same stage
    
    // Get values
    const textareas = item.querySelectorAll('.text-replacement-value-container textarea');
    const values = Array.from(textareas).map(textarea => textarea.value.trim()).filter(value => value !== '');
    
    if (values.length === 0) {
        showGlassToast('error', null, 'At least one value is required', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    
    // Get extend mode from toggle button
    const extendToggleBtn = item.querySelector('.text-replacement-actions button.indicator');
    const isExtend = extendToggleBtn ? extendToggleBtn.getAttribute('data-state') === 'on' : replacement.extend;
    
    // Get stage configuration
    const stageConfig = getEditStageConfiguration(index);
    
    // Update replacement
    replacement.name = newName;
    replacement.value = values.length === 1 ? values[0] : values;
    replacement.extend = isExtend;
    replacement.stages = stageConfig;
    
    // Exit edit mode (this will restore the display)
    exitEditMode(item);
    
    showGlassToast('success', null, `Updated request body replacement "${newName}"`, false, 2000, '<i class="fas fa-check"></i>');
}

// Add array item (inline editing)
function addRequestBodyArrayItem(index) {
    const listContainer = document.getElementById('requestBodyReplacementsList');
    if (!listContainer) return;
    
    const item = listContainer.querySelector(`.text-replacement-item[data-index="${index}"]`);
    if (!item) return;
    
    const valueContainer = item.querySelector('.text-replacement-value-container');
    const addItemBtn = valueContainer.querySelector('.text-replacement-add-item');
    
    const arrayItem = document.createElement('div');
    arrayItem.className = 'text-replacement-array-item';
    arrayItem.dataset.index = valueContainer.children.length - 1; // -1 for add button
    
    arrayItem.innerHTML = `
        <div class="character-prompt-textarea-container">
            <div class="character-prompt-textarea-background"></div>
            <textarea 
                class="form-control character-prompt-textarea prompt-textarea"
                rows="2"
                data-index="${valueContainer.children.length - 1}"
                placeholder="Enter value..."
                autocapitalize="false"
                autocorrect="false"
                spellcheck="false"
                data-ms-editor="false"
            ></textarea>
            <div class="prompt-textarea-toolbar hidden">
                <div class="toolbar-left">
                    <span class="token-count">0 tokens</span>
                </div>
                <div class="toolbar-right">
                    <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="off" title="Toggle Autofill">
                        <i class="fas fa-lightbulb-slash"></i>
                    </button>
                    <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                        <i class="fas fa-scale-unbalanced-flip"></i>
                    </button>
                    <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                        <i class="fas fa-book-font"></i>
                    </button>
                </div>
            </div>
        </div>
        <button class="btn-secondary remove-array-item" type="button" title="Remove">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;
    
    valueContainer.insertBefore(arrayItem, addItemBtn);
    
    // Add event listener for remove button
    const removeBtn = arrayItem.querySelector('.remove-array-item');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            removeRequestBodyArrayItem(index, valueContainer.children.length - 1);
        });
    }
    
    // Setup textarea
    const textarea = arrayItem.querySelector('textarea');
    if (textarea) {
        setupRequestBodyReplacementTextarea(textarea);
        textarea.focus();
    }
}

// Remove array item (inline editing)
function removeRequestBodyArrayItem(index, valueIndex) {
    const listContainer = document.getElementById('requestBodyReplacementsList');
    if (!listContainer) return;
    
    const item = listContainer.querySelector(`.text-replacement-item[data-index="${index}"]`);
    if (!item) return;
    
    const valueContainer = item.querySelector('.text-replacement-value-container');
    const arrayItems = valueContainer.querySelectorAll('.text-replacement-array-item');
    
    if (arrayItems.length <= 1) {
        showGlassToast('error', null, 'At least one value is required', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    
    const itemToRemove = valueContainer.querySelector(`[data-index="${valueIndex}"]`);
    if (itemToRemove) {
        itemToRemove.remove();
        
        // Reindex remaining items
        const remainingItems = valueContainer.querySelectorAll('.text-replacement-array-item');
        remainingItems.forEach((item, newIndex) => {
            item.dataset.index = newIndex;
            const textarea = item.querySelector('textarea');
            if (textarea) {
                textarea.dataset.index = newIndex;
            }
            const removeBtn = item.querySelector('button');
            if (removeBtn) {
                removeBtn.onclick = () => removeRequestBodyArrayItem(index, newIndex);
            }
        });
    }
}

// Delete request body replacement
async function deleteRequestBodyReplacement(index) {
    const replacement = requestBodyReplacements[index];
    if (!replacement) return;
    
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete the request body replacement "${replacement.name}"?`,
        [
            { text: 'Cancel', value: false, className: 'btn-secondary' },
            { text: 'Delete', value: true, className: 'btn-danger' }
        ]
    );
    
    if (confirmed) {
        requestBodyReplacements.splice(index, 1);
        renderRequestBodyReplacementsList();
        showGlassToast('success', null, `Deleted request body replacement "${replacement.name}"`, false, 3000, '<i class="fas fa-trash"></i>');
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is loaded
window.wsClient.registerInitStep(46, 'Initializing Request Body Replacements Modal', async () => {
    initializeRequestBodyReplacementsModal();
});
