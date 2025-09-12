/**
 * Preset Manager
 * Manages presets with a visual interface similar to text replacement manager
 */

let presetData = {};
let originalPresetData = {};

// Get queue status using event system
function getQueueStatus() {
    return new Promise((resolve) => {
        // Create a one-time event listener for queue status response
        const handleQueueStatusResponse = (event) => {
            document.removeEventListener('queueStatusResponse', handleQueueStatusResponse);
            resolve(event.detail);
        };
        
        // Listen for the queue status response
        document.addEventListener('queueStatusResponse', handleQueueStatusResponse, { once: true });
        
        // Dispatch event to request queue status from main app
        const requestEvent = new CustomEvent('requestQueueStatus', {
            detail: { requestId: Date.now() }
        });
        document.dispatchEvent(requestEvent);
        
        // Fallback timeout in case no response is received
        setTimeout(() => {
            document.removeEventListener('queueStatusResponse', handleQueueStatusResponse);
            // Default to allowing generation if we can't get queue status
            resolve({ isBlocked: false });
        }, 1000);
    });
}

// Initialize preset manager
function initializePresetManager() {
    const presetManagerBtn = document.getElementById('presetManagerBtn');
    const closePresetManagerBtn = document.getElementById('closePresetManagerBtn');
    const presetSearch = document.getElementById('presetSearch');
    const presetPrevBtn = document.getElementById('presetPrevBtn');
    const presetNextBtn = document.getElementById('presetNextBtn');

    // Event listeners
    closePresetManagerBtn.addEventListener('click', hidePresetManager);
    presetSearch.addEventListener('input', debounce(async () => {
        currentPage = 1; // Reset to first page when searching
        currentSearchTerm = presetSearch.value;
        await loadPresets();
    }, 300));
    

    if (presetPrevBtn) {
        presetPrevBtn.addEventListener('click', async () => {
            if (currentPage > 1) {
                currentPage--;
                await loadPresets();
            }
        });
    }

    if (presetNextBtn) {
        presetNextBtn.addEventListener('click', async () => {
            const totalPages = paginationInfo.totalPages || 1;
            if (currentPage < totalPages) {
                currentPage++;
                await loadPresets();
            }
        });
    }

    // Close on outside click
    const modal = document.getElementById('presetManagerModal');
    if (modal) {
        // Add keyboard navigation for pagination
        modal.addEventListener('keydown', async (e) => {
            if (e.target.closest('.preset-manager-content')) {
                if (e.key === 'PageDown' && currentPage < (paginationInfo.totalPages || 1)) {
                    e.preventDefault();
                    currentPage++;
                    await loadPresets();
                } else if (e.key === 'PageUp' && currentPage > 1) {
                    e.preventDefault();
                    currentPage--;
                    await loadPresets();
                }
            }
        });
    }
}

// No dropdown initialization needed - only simple updates allowed
function initializePresetDropdowns() {
    // Workspace dropdown
    const workspaceDropdown = document.getElementById('presetWorkspaceDropdown');
    if (workspaceDropdown) {
        const workspaceBtn = document.getElementById('presetWorkspaceDropdownBtn');
        const workspaceMenu = document.getElementById('presetWorkspaceDropdownMenu');
        const workspaceSelected = document.getElementById('presetWorkspaceSelected');
        
        if (workspaceBtn && workspaceMenu && workspaceSelected) {
            workspaceBtn.addEventListener('click', () => toggleDropdown(workspaceMenu, workspaceBtn));
            
            // Populate workspace options
            if (workspaces) {
                workspaceMenu.innerHTML = '';
                Object.keys(workspaces).forEach(workspaceId => {
                    const workspace = workspaces[workspaceId];
                    const option = document.createElement('div');
                    option.className = 'custom-dropdown-option';
                    option.textContent = workspace.name;
                    option.dataset.value = workspaceId;
                    option.addEventListener('click', () => {
                        workspaceSelected.textContent = option.textContent;
                        workspaceSelected.dataset.value = workspaceId;
                        closeDropdown(workspaceMenu, workspaceBtn);
                    });
                    workspaceMenu.appendChild(option);
                });
            }
        }
    }
}

// Show preset manager modal
async function showPresetManager() {
    const modal = document.getElementById('presetManagerModal');
    
    if (!modal) {
        return;
    }
    
    await loadPresets();
    await renderPresetList();
    openModal(modal);
}

// Hide preset manager modal
function hidePresetManager() {
    const modal = document.getElementById('presetManagerModal');
    if (modal) {
        closeModal(modal);
    }
    
    // Reset to first page and clear search
    currentPage = 1;
    const searchInput = document.getElementById('presetSearch');
    if (searchInput) {
        searchInput.value = '';
    }
}

// Load presets from server
async function loadPresets() {
    try {
        if (wsClient && wsClient.isConnected()) {
            // Request presets via WebSocket with pagination and search parameters
            const result = await wsClient.getPresets(currentPage, itemsPerPage, currentSearchTerm);
            
            if (result && result.presets) {
                presetData = { ...result.presets };
                originalPresetData = JSON.parse(JSON.stringify(result.presets));
                
                // Update pagination info
                if (result.pagination) {
                    paginationInfo = { ...result.pagination };
                    currentPage = paginationInfo.currentPage;
                }
                
                // Update search state
                currentSearchTerm = result.searchTerm || '';
                
                // Update search input if it exists
                const searchInput = document.getElementById('presetSearch');
                if (searchInput && searchInput.value !== currentSearchTerm) {
                    searchInput.value = currentSearchTerm;
                }
                
                // Render the updated list
                await renderPresetList();
            } else {
                presetData = {};
                originalPresetData = {};
                paginationInfo = {
                    currentPage: 1,
                    totalPages: 1,
                    totalItems: 0,
                    itemsPerPage,
                    hasNextPage: false,
                    hasPrevPage: false
                };
            }
        } else {
            showGlassToast('error', null, 'Unable to load presets: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    } catch (error) {
        console.error('Error loading presets:', error);
        showGlassToast('error', null, 'Error loading presets', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Update pagination controls
function updatePaginationControls() {
    const pageInfo = document.getElementById('presetPageInfo');
    const prevBtn = document.getElementById('presetPrevBtn');
    const nextBtn = document.getElementById('presetNextBtn');
    
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

// Render the preset list
async function renderPresetList() {
    const listContainer = document.getElementById('presetList');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    const pageKeys = Object.keys(presetData);
    
    if (pageKeys.length === 0) {
        if (paginationInfo.totalItems === 0) {
            listContainer.innerHTML = `
                <div class="text-replacement-empty">
                    <p><i class="fas fa-search"></i> No presets found</p>
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
    
    // Use Promise.all to handle async createPresetItem calls
    const itemPromises = pageKeys.map(async (key) => {
        const preset = presetData[key];
        return await createPresetItem(key, preset);
    });
    
    const itemElements = await Promise.all(itemPromises);
    itemElements.forEach(itemElement => {
        listContainer.appendChild(itemElement);
    });
    
    // Update pagination controls
    updatePaginationControls();
}

// Create a preset item element
async function createPresetItem(key, preset) {
    const item = document.createElement('div');
    item.className = 'text-replacement-item';
    item.dataset.key = key;

    // Create preview text (prompt + character prompts, truncated)
    let previewText = [preset.prompt];
    if (preset.characterPrompts && preset.characterPrompts.length > 0) {
        const characterText = preset.characterPrompts.map(cp => cp.prompt);
        previewText.unshift(...characterText);
    }

    // Resolve workspace name and color
    let workspaceName = 'Default';
    let workspaceColor = '#102040';
    if (preset.target_workspace) {
        const workspace = workspaces[preset.target_workspace];
        if (workspace) {
            workspaceName = workspace.name;
            workspaceColor = workspace.color || '#102040';
        } else {
            workspaceName = preset.target_workspace; // Fallback to ID
        }
    }

    // Header
    const header = document.createElement('div');
    header.className = 'text-replacement-header';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'text-replacement-name-container';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'text-replacement-name';
    nameSpan.textContent = preset.name || key;

    const colorIndicator = document.createElement('div');
    colorIndicator.className = 'workspace-color-indicator';
    colorIndicator.style.backgroundColor = workspaceColor;
    nameDiv.appendChild(colorIndicator);
    nameDiv.appendChild(nameSpan);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'text-replacement-actions';

    // Button factory
    function makeBtn({className, title, iconClass, onClick}) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.title = title;
        btn.appendChild(document.createElement('i')).className = iconClass;
        btn.addEventListener('click', onClick);
        return btn;
    }

    // Generate
    actionsDiv.appendChild(makeBtn({
        className: 'btn-small btn-primary generate-btn',
        title: 'Generate Image',
        iconClass: 'nai-sparkles',
        onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            generateFromPreset(key);
            hidePresetManager();
        }
    }));

    // Edit (manual modal)
    actionsDiv.appendChild(makeBtn({
        className: 'btn-small btn-secondary edit-btn manual-modal-btn',
        title: 'Edit Preset',
        iconClass: 'nai-penwriting',
        onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            hidePresetManager();
            showManualModal(key);
        }
    }));

    // Edit (cog)
    actionsDiv.appendChild(makeBtn({
        className: 'btn-small btn-secondary edit-btn cog-edit-btn',
        title: 'Edit Request Settings',
        iconClass: 'fas fa-cog',
        onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            editPreset(key);
        }
    }));

    // Copy UUID
    actionsDiv.appendChild(makeBtn({
        className: 'btn-small btn-secondary copy-btn',
        title: 'Copy UUID',
        iconClass: 'fas fa-link-horizontal',
        onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            copyPresetUuid(key);
        }
    }));

    // Regenerate UUID
    actionsDiv.appendChild(makeBtn({
        className: 'btn-small btn-danger regenerate-btn',
        title: 'Regenerate UUID',
        iconClass: 'fas fa-sync',
        onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            regeneratePresetUuid(key);
        }
    }));

    // Delete
    actionsDiv.appendChild(makeBtn({
        className: 'btn-small btn-danger delete-btn',
        title: 'Delete',
        iconClass: 'fas fa-trash',
        onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            deletePreset(key);
        }
    }));

    header.appendChild(nameDiv);
    header.appendChild(actionsDiv);

    // Content
    const content = document.createElement('div');
    content.className = 'text-replacement-content';

    // Value container
    const valueContainer = document.createElement('div');
    valueContainer.className = 'text-replacement-value-container';

    // Array items
    const arrayItems = document.createElement('div');
    arrayItems.className = 'text-replacement-array-items';
    previewText.forEach((text, index) => {
        const arrayItem = document.createElement('div');
        arrayItem.className = 'text-replacement-array-item';
        arrayItem.dataset.index = index;

        const valueDisplay = document.createElement('div');
        valueDisplay.className = 'text-replacement-value-display';

        const span = document.createElement('span');
        span.className = 'text-replacement-text';
        span.textContent = text;

        valueDisplay.appendChild(span);
        arrayItem.appendChild(valueDisplay);
        arrayItems.appendChild(arrayItem);
    });
    valueContainer.appendChild(arrayItems);

    // Preset details
    const details = document.createElement('div');
    details.className = 'preset-details';

    // Indicators row
    const indicatorsRow = document.createElement('div');
    indicatorsRow.className = 'indicators-row';

    // Model
    const modelSpan = document.createElement('span');
    modelSpan.className = 'preset-model';
    let group = null;
    for (const g of modelGroups) {
        const found = g.options.find(o => o.value === preset.model.toLowerCase());
        if (found) {
        group = g.group;
        break;
        }
    }
    const groupObj = modelGroups.find(g => g.group === group);
    const optObj = groupObj ? groupObj.options.find(o => o.value === preset.model.toLowerCase()) : null;
    if (optObj) {
        modelSpan.innerHTML = [
            `${optObj.display}`,
            optObj.badge_full ? `<span class="custom-dropdown-badge ${optObj.badge_class}">${optObj.badge_full}</span>` : optObj.badge ? `<span class="custom-dropdown-badge ${optObj.badge_class}">${optObj.badge}</span>` : '',
        ].filter(Boolean).join(' ');
    } else {
        modelSpan.textContent = preset.model || 'V4.5?';
    }
    indicatorsRow.appendChild(modelSpan);

    // Resolution
    const resSpan = document.createElement('span');
    resSpan.className = 'preset-resolution';
    
    // Get proper resolution display name and check if it's large/wallpaper
    let resolutionDisplay = preset.resolution || 'Portrait?';    
    if (preset.resolution) {
        const found = RESOLUTIONS.find(opt => opt.value.toLowerCase() === preset.resolution.toLowerCase());
        if (found) {
            resolutionDisplay = found.display.replace('Normal ', ' ');
        }
    }
    
    // Create resolution content with icon if needed
    const resolutionContent = document.createElement('div');
    resolutionContent.className = 'resolution-content';
    
    if (preset.resolution.toLowerCase().startsWith('large_') || preset.resolution.toLowerCase().startsWith('wallpaper_')) {
        const dollarIcon = document.createElement('i');
        dollarIcon.className = 'fas fa-dollar-sign';
        dollarIcon.style.marginRight = '4px';
        dollarIcon.style.color = '#ffd700';
        resolutionContent.appendChild(dollarIcon);
    }
    
    const resolutionText = document.createElement('span');
    resolutionText.textContent = resolutionDisplay;
    resolutionContent.appendChild(resolutionText);
    
    resSpan.appendChild(resolutionContent);
    indicatorsRow.appendChild(resSpan);

    // Steps
    if (preset.steps !== undefined) {
        const stepsSpan = document.createElement('span');
        stepsSpan.className = 'preset-steps';
        
        const stepsContent = document.createElement('div');
        stepsContent.className = 'steps-content';
        
        // Add dollar icon if steps > 28
        if (preset.steps > 28) {
            const dollarIcon = document.createElement('i');
            dollarIcon.className = 'fas fa-dollar-sign';
            dollarIcon.style.marginRight = '4px';
            dollarIcon.style.color = '#ffd700';
            stepsContent.appendChild(dollarIcon);
        }
        
        const stepsText = document.createElement('span');
        stepsText.textContent = `${preset.steps} Steps`;
        stepsContent.appendChild(stepsText);
        
        stepsSpan.appendChild(stepsContent);
        indicatorsRow.appendChild(stepsSpan);
    }

    // Guidance/Rescale
    if (preset.guidance !== undefined && preset.guidance > 0) {
        const guidanceSpan = document.createElement('span');
        guidanceSpan.className = 'preset-guidance';
        guidanceSpan.textContent = `${preset.guidance}${preset.rescale ? ' / ' + (preset.rescale * 100).toFixed(1) + '%' : ''}`;
        indicatorsRow.appendChild(guidanceSpan);
    }

    // Workspace
    const workspaceSpan = document.createElement('span');
    workspaceSpan.className = 'preset-workspace';

    const workspaceContent = document.createElement('div');
    workspaceContent.className = 'workspace-option-content';

    if (workspaceName !== 'Default') {
    const workspaceNameSpan = document.createElement('span');
        workspaceNameSpan.textContent = workspaceName;
        workspaceContent.appendChild(workspaceNameSpan);
        workspaceSpan.appendChild(workspaceContent);
        indicatorsRow.appendChild(workspaceSpan);
    }

    // Add indicators row to details
    details.appendChild(indicatorsRow);

    // Icons row
    const iconsRow = document.createElement('div');
    iconsRow.className = 'icons-row';

    // Preset icons
    const iconsDiv = document.createElement('div');
    iconsDiv.className = 'preset-icons';

    
    if (preset.allow_paid) {
        const icon = document.createElement('i');
        icon.className = 'nai-anla';
        icon.title = 'Paid Requests Enabled';
        iconsDiv.appendChild(icon);
    }
    if (preset.characterPrompts && preset.characterPrompts.length > 0) {
        const icon = document.createElement('i');
        icon.className = 'fas fa-users';
        icon.title = 'Character prompts';
        iconsDiv.appendChild(icon);
        if (preset.use_coords) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-location-crosshairs';
            icon.title = 'Using Character Coordinates';
            iconsDiv.appendChild(icon);
        }
    }
    if (preset.request_upscale || preset.upscale) {
        const icon = document.createElement('i');
        icon.className = 'fas fa-high-definition';
        icon.title = 'Upscale enabled';
        iconsDiv.appendChild(icon);
    }
    if (preset.image || preset.image_source) {
        const icon = document.createElement('i');
        icon.className = 'fas fa-image';
        icon.title = 'Image to Image';
        iconsDiv.appendChild(icon);
        if (preset.image_bias) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-crop';
            icon.title = 'Image Bias';
            iconsDiv.appendChild(icon);
        }
    }
    if ((preset.image || preset.image_source) && preset.mask_compressed) {
        const icon = document.createElement('i');
        icon.className = 'nai-inpaint';
        icon.title = 'Selective Masking (Inpaint)';
        iconsDiv.appendChild(icon);
    } else if (preset.vibe_transfer) {
        const icon = document.createElement('i');
        icon.className = 'nai-vibe-transfer';
        icon.title = `${preset.vibe_transfer.length} Vibe Transfer${preset.vibe_transfer.length > 1 ? 's' : ''}`;
        iconsDiv.appendChild(icon);
    } else 
    if (preset.variety) {
        const icon = document.createElement('i');
        icon.className = 'fas fa-sparkle';
        icon.title = 'Variety enabled';
        iconsDiv.appendChild(icon);
    }
    
    // Dataset info
    const datasetIcon = document.createElement('div');
    datasetIcon.className = 'preset-dataset-icon';
    datasetIcon.title = 'Dataset enabled';
    const iconElement = document.createElement('i');
    // Priority: furry > backgrounds > anime (default)
    let iconClass = 'nai-sakura'; // default (anime)
    if (preset.dataset_config && preset.dataset_config.include && preset.dataset_config.include.length > 0) {
        if (preset.dataset_config.include.includes('furry')) {
            iconClass = 'nai-paw';
        } else if (preset.dataset_config.include.includes('backgrounds')) {
            iconClass = 'fas fa-tree';
        } else {
            iconClass = 'nai-sakura';
        }
    }
    iconElement.className = iconClass;   
    datasetIcon.appendChild(iconElement);
    iconsDiv.appendChild(datasetIcon);
    
    // Quality preset info
    if (preset.append_quality) {
        const icon = document.createElement('i');
        icon.className = 'fas fa-crown';
        icon.title = 'Quality Preset Enabled';
        iconsDiv.appendChild(icon);
    }

    const boxes = document.createElement('div');
    boxes.className = 'uc-boxes';
    if (preset.append_uc !== undefined) {
        boxes.dataset.ucLevel = preset.append_uc.toString();
    }
    const box1 = document.createElement('div');
    box1.className = 'uc-box';
    box1.dataset.level = '1';
    const box2 = document.createElement('div');
    box2.className = 'uc-box';
    box2.dataset.level = '2';
    const box3 = document.createElement('div');
    box3.className = 'uc-box';
    box3.dataset.level = '3';
    boxes.appendChild(box1);
    boxes.appendChild(box2);
    boxes.appendChild(box3);
    iconsDiv.appendChild(boxes);

    iconsRow.appendChild(iconsDiv);
    details.appendChild(iconsRow);

    // Assemble
    content.appendChild(valueContainer);
    content.appendChild(details);

    item.appendChild(header);
    item.appendChild(content);

    return item;
}

// Show update preset modal
async function editPreset(presetName) {
    const preset = presetData[presetName];
    if (!preset) return;
    
    // Load preset data into the update modal
    await loadPresetIntoUpdateModal(presetName);
    
    // Show the modal
    const modal = document.getElementById('updatePresetModal');
    if (modal) {
        openModal(modal);
    }
}


// Load preset data into update modal
async function loadPresetIntoUpdateModal(presetName) {
    const preset = presetData[presetName];
    if (!preset) return;
    
    // Store the preset name being edited
    editingPresetName = presetName;
    
    // Set form values
    const nameInput = document.getElementById('updatePresetNameInput');
    if (nameInput) nameInput.value = preset.name || presetName;
    
    // Set workspace dropdown - resolve ID to name with color indicator
    const workspaceId = preset.target_workspace || 'default';
    let workspaceName = 'Default';
    if (workspaceId !== 'default') {
        // Try to get workspace name from WebSocket client
        const workspace = workspaces[workspaceId];
        if (workspace) {
            workspaceName = workspace.name;
        } else {
            workspaceName = workspaceId; // Fallback to ID if not found
        }
    }
    setWorkspaceDropdownValue(workspaceId, workspaceName);
    
    // Set resolution dropdown - resolve ID to name with badge
    const resolutionId = preset.resolution || '';
    let resolutionName = 'Unchanged';
    let resolutionDims = '';
    if (resolutionId && RESOLUTION_GROUPS) {
        // Find the resolution name from RESOLUTION_GROUPS
        for (const group of RESOLUTION_GROUPS) {
            const found = group.options.find(opt => opt.value.toLowerCase() === resolutionId.toLowerCase());
            if (found) {
                resolutionName = found.name;
                resolutionDims = found.dims || '';
                break;
            }
        }
    }
    
    // Set resolution with proper formatting like manual resolution dropdown
    const resolutionSelected = document.getElementById('updatePresetResolutionSelected');
    if (resolutionSelected) {
        if (resolutionId && resolutionName !== 'Unchanged') {
            // Find the group to get badge information
            let groupBadge = '';
            if (RESOLUTION_GROUPS) {
                for (const group of RESOLUTION_GROUPS) {
                    const found = group.options.find(opt => opt.value.toLowerCase() === resolutionId.toLowerCase());
                    if (found) {
                        if (group.badge) {
                            groupBadge = `<span class="custom-dropdown-badge${group.free ? ' free-badge' : ''}">${group.badge}</span>`;
                        }
                        break;
                    }
                }
            }
            
            resolutionSelected.innerHTML = `${resolutionName}${groupBadge}`;
        } else {
            resolutionSelected.innerHTML = 'Select resolution...';
        }
        resolutionSelected.dataset.value = resolutionId;
    }
    
    // Set scale toggle (saved as request_upscale)
    const scaleToggle = document.getElementById('updatePresetScaleInput');
    if (scaleToggle) {
        scaleToggle.setAttribute('data-state', preset.request_upscale ? 'on' : 'off');
    }
    

}

// Set dropdown value
function setDropdownValue(elementId, displayText, actualValue) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = displayText || '';
        element.dataset.value = actualValue || '';
    }
}

// Set workspace dropdown value with color indicator
function setWorkspaceDropdownValue(workspaceId, workspaceName) {
    const workspaceSelected = document.getElementById('updatePresetWorkspaceSelected');
    const colorIndicator = document.querySelector('#updatePresetWorkspaceDropdownBtn .workspace-color-indicator');
    
    if (workspaceSelected) {
        workspaceSelected.textContent = workspaceName || 'Default';
        workspaceSelected.dataset.value = workspaceId || 'default';
    }
    
    if (colorIndicator) {
        colorIndicator.style.backgroundColor = workspaces[workspaceId]?.color || '#102040';
    }
}

// Initialize update preset modal
function initializeUpdatePresetModal() {
    const modal = document.getElementById('updatePresetModal');
    const closeBtn = document.getElementById('closeUpdatePresetBtn');
    const cancelBtn = document.getElementById('updatePresetCancelBtn');
    const saveBtn = document.getElementById('updatePresetSaveBtn');
    
    if (modal) {
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideUpdatePresetModal();
            }
        });
        
        // Close on escape key
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideUpdatePresetModal();
            }
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', hideUpdatePresetModal);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideUpdatePresetModal);
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', handleUpdatePresetSubmit);
    }
    
    // Initialize dropdowns
    initializeUpdatePresetDropdowns();
    
    // Initialize toggle buttons
    initializeUpdatePresetToggleButtons();
}

// Initialize update preset dropdowns
function initializeUpdatePresetDropdowns() {
    // Workspace dropdown using existing setupDropdown system
    const workspaceDropdown = document.getElementById('updatePresetWorkspaceDropdown');
    const workspaceBtn = document.getElementById('updatePresetWorkspaceDropdownBtn');
    const workspaceMenu = document.getElementById('updatePresetWorkspaceDropdownMenu');
    
    if (workspaceDropdown && workspaceBtn && workspaceMenu) {
        setupDropdown(
            workspaceDropdown,
            workspaceBtn,
            workspaceMenu,
            renderUpdatePresetWorkspaceDropdown,
            () => document.getElementById('updatePresetWorkspaceSelected').dataset.value || 'default'
        );
    }
    
    // Resolution dropdown using existing setupDropdown system
    const resolutionDropdown = document.getElementById('updatePresetResolutionDropdown');
    const resolutionBtn = document.getElementById('updatePresetResolutionDropdownBtn');
    const resolutionMenu = document.getElementById('updatePresetResolutionDropdownMenu');
    
    if (resolutionDropdown && resolutionBtn && resolutionMenu) {
        setupDropdown(
            resolutionDropdown,
            resolutionBtn,
            resolutionMenu,
            renderUpdatePresetResolutionDropdown,
            () => document.getElementById('updatePresetResolutionSelected').dataset.value || ''
        );
    }
}

// Render workspace dropdown options
function renderUpdatePresetWorkspaceDropdown(selectedValue) {
    const workspaceMenu = document.getElementById('updatePresetWorkspaceDropdownMenu');
    if (!workspaceMenu) return;
    
    workspaceMenu.innerHTML = '';
    
    // Use existing workspaces object
    if (workspaces) {
        Object.keys(workspaces).forEach(workspaceId => {
            const workspace = workspaces[workspaceId];
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedValue === workspaceId ? ' selected' : '');
            option.dataset.value = workspaceId;
            option.innerHTML = `
                <div class="workspace-option-content">
                    <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#102040'}"></div>
                    <span class="workspace-name">${workspace.name}</span>
                </div>
            `;
            option.addEventListener('click', () => {
                setWorkspaceDropdownValue(workspaceId, workspace.name);
                closeDropdown(workspaceMenu, document.getElementById('updatePresetWorkspaceDropdownBtn'));
            });
            workspaceMenu.appendChild(option);
        });
    }
}

// Render resolution dropdown options
function renderUpdatePresetResolutionDropdown(selectedValue) {
    const resolutionMenu = document.getElementById('updatePresetResolutionDropdownMenu');
    if (!resolutionMenu) return;
    
    resolutionMenu.innerHTML = '';
    
    // Use the same grouped dropdown design as manual resolution dropdown
    if (typeof RESOLUTION_GROUPS !== 'undefined' && Array.isArray(RESOLUTION_GROUPS)) {
        console.log('🔧 Adding grouped resolution options:', RESOLUTION_GROUPS);
        renderGroupedDropdown(
            resolutionMenu,
            RESOLUTION_GROUPS,
            (value, group) => {
                const resolutionSelected = document.getElementById('updatePresetResolutionSelected');
                // Find the resolution object to get the display name
                const groupObj = RESOLUTION_GROUPS.find(g => g.group === group);
                const optObj = groupObj ? groupObj.options.find(o => o.value === value) : null;
                if (optObj) {
                    // Format resolution display with badge and group badge like manual resolution dropdown
                    resolutionSelected.innerHTML = `${optObj.name}${groupObj.badge ? '<span class="custom-dropdown-badge' + (groupObj.free ? ' free-badge' : '') + '">' + groupObj.badge + '</span>' : ''}`;
                    resolutionSelected.dataset.value = value;
                }
                closeDropdown(resolutionMenu, document.getElementById('updatePresetResolutionDropdownBtn'));
            },
            () => closeDropdown(resolutionMenu, document.getElementById('updatePresetResolutionDropdownBtn')),
            selectedValue,
            (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`
        );
    }
}

// Initialize update preset toggle buttons
function initializeUpdatePresetToggleButtons() {
    // Scale toggle button
    const scaleToggle = document.getElementById('updatePresetScaleInput');
    if (scaleToggle) {
        scaleToggle.addEventListener('click', () => {
            const currentState = scaleToggle.getAttribute('data-state');
            const newState = currentState === 'on' ? 'off' : 'on';
            scaleToggle.setAttribute('data-state', newState);
        });
    }
}

// Hide update preset modal
function hideUpdatePresetModal() {
    const modal = document.getElementById('updatePresetModal');
    if (modal) {
        closeModal(modal);
    }
    
    // Clear editing state
    editingPresetName = null;
}

// Handle update preset submit
async function handleUpdatePresetSubmit() {
    try {
        const presetName = editingPresetName;
        if (!presetName) {
            showGlassToast('error', null, 'No preset selected for editing', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        
        const formData = getUpdatePresetFormData();
        
        if (!formData.name) {
            showGlassToast('error', null, 'Preset name cannot be empty', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        
        // Update the preset
        await updatePresetSimple(presetName, formData);
        
        hideUpdatePresetModal();
        await loadPresets();
        await renderPresetList();
        
    } catch (error) {
        console.error('Error updating preset:', error);
        showGlassToast('error', null, 'Error updating preset: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Get update preset form data
function getUpdatePresetFormData() {
    const nameInput = document.getElementById('updatePresetNameInput');
    const workspaceSelected = document.getElementById('updatePresetWorkspaceSelected');
    const resolutionSelected = document.getElementById('updatePresetResolutionSelected');
    const scaleToggle = document.getElementById('updatePresetScaleInput');
    const uuidToggle = document.getElementById('updatePresetRegenerateUuidBtn');
    
    return {
        name: nameInput?.value?.trim() || '',
        target_workspace: workspaceSelected?.dataset?.value || 'default',
        resolution: resolutionSelected?.dataset?.value.toUpperCase() || '',
        request_upscale: scaleToggle?.getAttribute('data-state') === 'on'
    };
}

// Delete preset
async function deletePreset(presetName) {
    // Use confirmation dialog instead of confirm()
    const confirmed = await showConfirmationDialog(
        'Delete Preset',
        `Are you sure you want to delete preset "${presetName}"?`,
        'Delete',
        'Cancel'
    );

    if (!confirmed) {
        return;
    }
    
    try {
        if (!wsClient || !wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        const result = await wsClient.deletePreset(presetName);
        
        if (result && result.success) {
            showGlassToast('success', null, `Preset "${presetName}" deleted successfully`, false, 5000, '<i class="fas fa-check"></i>');
            await loadPresets();
            await renderPresetList();
        } else {
            throw new Error(result?.message || 'Failed to delete preset');
        }
    } catch (error) {
        console.error('Error deleting preset:', error);
        showGlassToast('error', null, 'Error deleting preset: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Simple update preset function - handles partial updates
async function updatePresetSimple(presetName, updates) {
    try {
        if (!wsClient || !wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        // Only include fields that are actually being updated
        const updateData = { presetName };
        
        if (updates.name !== undefined) updateData.name = updates.name;
        if (updates.target_workspace !== undefined) updateData.target_workspace = updates.target_workspace;
        if (updates.resolution !== undefined) updateData.resolution = updates.resolution;
        if (updates.request_upscale !== undefined) updateData.request_upscale = updates.request_upscale;
        
        const result = await wsClient.updatePreset(presetName, updateData);
        
        if (result && result.success) {
            showGlassToast('success', null, `Preset "${presetName}" updated successfully`, false, 5000, '<i class="fas fa-check"></i>');
            await loadPresets();
            await renderPresetList();
        } else {
            throw new Error(result?.message || 'Failed to update preset');
        }
    } catch (error) {
        console.error('Error updating preset:', error);
        showGlassToast('error', null, 'Error updating preset: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Generate image from preset
async function generateFromPreset(presetName) {
    try {
        // Check if queue is blocked using event system
        const queueStatus = await getQueueStatus();
        if (queueStatus.isBlocked) {
            showGlassToast('warning', 'Queue Blocked', 'Generation is currently blocked. Please wait for the queue to clear.', false, 5000);
            return;
        }
        
        const preset = presetData[presetName];
        if (!preset) {
            throw new Error('Preset not found');
        }
        
        const toastId = showGlassToast('info', 'Generating...', `Starting generation for preset "${preset.name || presetName}"`, true);
        
        // Get current workspace
        const workspace = currentWorkspace || null;
        
        // Generate using WebSocket
        const result = await wsClient.generatePreset(presetName, workspace);
        
        // Update the existing toast to show completion
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Generation Complete',
            message: `Generated image from preset "${preset.name || presetName}"`,
            customIcon: '<i class="fas fa-check"></i>',
            showProgress: false
        });
        
        // Close the preset manager modal
        hidePresetManager();
        
        return result;
    } catch (error) {
        console.error('Preset generation error:', error);
        // Update the existing toast to show error
        if (toastId) {
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Generation Failed',
                message: error.message,
                customIcon: '<i class="nai-cross"></i>',
                showProgress: false
            });
        } else {
            showGlassToast('error', 'Generation Failed', error.message);
        }
        throw error;
    }
}

// Copy preset UUID to clipboard
async function copyPresetUuid(presetName) {
    try {
        const preset = presetData[presetName];
        if (!preset || !preset.uuid) {
            showGlassToast('error', null, 'Preset UUID not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        const presetURL = location.origin + '/preset/' + preset.uuid + '?download=true';
        await navigator.clipboard.writeText(presetURL);
        showGlassToast('success', null, 'Preset Generation URL copied to clipboard', false, 3000, '<i class="fas fa-clipboard"></i>');
    } catch (error) {
        console.error('Error copying UUID:', error);
        showGlassToast('error', null, 'Failed to copy URL', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Regenerate preset UUID
async function regeneratePresetUuid(presetName) {
    try {
        const preset = presetData[presetName];
        if (!preset) {
            showGlassToast('error', null, 'Preset not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        
        // Show confirmation dialog
        const confirmed = await showConfirmationDialog(
            `Are you sure you want to regenerate the UUID for preset "${preset.name || presetName}"?<br><br><small>This will invalidate any existing REST API calls that use the current UUID.</small>`,
            [
                { text: 'Cancel', value: false, className: 'btn-secondary' },
                { text: 'Regenerate UUID', value: true, className: 'btn-danger' }
            ]
        );
        
        if (!confirmed) {
            return; // User cancelled
        }
        
        // Call server to regenerate UUID
        const result = await wsClient.regeneratePresetUuid(presetName);
        
        if (result && result.success) {
            showGlassToast('success', null, `UUID regenerated for preset "${preset.name || presetName}"`, false, 5000, '<i class="fas fa-sync"></i>');
            
            // Update local data with new UUID from server
            if (result.uuid) {
                if (presetData[presetName]) {
                    presetData[presetName].uuid = result.uuid;
                }
                if (originalPresetData[presetName]) {
                    originalPresetData[presetName].uuid = result.uuid;
                }
            }
            
            // Re-render the list to show updated UUID
            await renderPresetList();
        } else {
            throw new Error(result?.message || 'Failed to regenerate UUID');
        }
    } catch (error) {
        console.error('Error regenerating UUID:', error);
        showGlassToast('error', null, 'Error regenerating UUID: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleDropdown(menu, button) {
    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        button.classList.add('active');
    } else {
        menu.classList.add('hidden');
        button.classList.remove('active');
    }
}

function closeDropdown(menu, button) {
    menu.classList.add('hidden');
    button.classList.remove('active');
}

// Set up WebSocket event handlers
function setupWebSocketEventHandlers() {
    if (wsClient) {
        // Listen for preset response events
        wsClient.on('get_presets_response', handleGetPresetsResponse);
        wsClient.on('update_preset_response', handleUpdatePresetResponse);
        wsClient.on('delete_preset_response', handleDeletePresetResponse);
        
        // Listen for preset updated broadcasts
        wsClient.on('preset_updated', handlePresetUpdated);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Set up WebSocket event handlers when WebSocket client is available
    if (wsClient) {
        setupWebSocketEventHandlers();
        wsClient.registerInitStep(46, 'Initializing Preset Manager', async () => {
            initializePresetManager();
            initializeUpdatePresetModal();
        });
    }
});

// Handle get presets response
async function handleGetPresetsResponse(data) {
    if (data && data.presets) {
        presetData = { ...data.presets };
        originalPresetData = JSON.parse(JSON.stringify(data.presets));
        
        // Update pagination info
        if (data.pagination) {
            paginationInfo = { ...data.pagination };
            currentPage = paginationInfo.currentPage;
        }
        
        // Update search state
        if (data.searchTerm !== undefined) {
            currentSearchTerm = data.searchTerm;
        }
        
        // Update search input if it exists
        const searchInput = document.getElementById('presetSearch');
        if (searchInput && searchInput.value !== currentSearchTerm) {
            searchInput.value = currentSearchTerm;
        }
        
        // Render the updated list
        await renderPresetList();
    }
}

// Handle update preset response
function handleUpdatePresetResponse(data) {
    if (data && data.success) {
        showGlassToast('success', null, data.message, false, 5000, '<i class="fas fa-check"></i>');
        // Reload presets to get updated data
        loadPresets();
    } else {
        showGlassToast('error', null, data?.message || 'Failed to update preset', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Handle delete preset response
function handleDeletePresetResponse(data) {
    if (data && data.success) {
        showGlassToast('success', null, data.message, false, 5000, '<i class="fas fa-check"></i>');
        // Reload presets to get updated data
        loadPresets();
    } else {
        showGlassToast('error', null, data?.message || 'Failed to delete preset', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Handle preset updated broadcast
function handlePresetUpdated(data) {
    if (data) {
        const { action, presetName, message: updateMessage } = data;
        
        // Show notification
        if (action === 'updated') {
            showGlassToast('info', null, updateMessage, false, 5000, '<i class="fas fa-info-circle"></i>');
        } else if (action === 'deleted') {
            showGlassToast('info', null, updateMessage, false, 5000, '<i class="fas fa-trash"></i>');
        }
        
        // Reload presets to get updated data
        loadPresets();
    }
}
