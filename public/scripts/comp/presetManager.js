/**
 * Preset Manager
 * Manages presets with a visual interface similar to text replacement manager
 */

let presetData = {};
let originalPresetData = {};
let presetPaginationInfo = {
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 15,
    hasNextPage: false,
    hasPrevPage: false
};
let presetSearchTerm = '';
let updatePresetSelectedNoiseScheduler = '';

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
    const togglePresetSearchBtn = document.getElementById('togglePresetSearchBtn');
    const presetSearch = document.getElementById('presetSearch');
    const presetPrevBtn = document.getElementById('presetPrevBtn');
    const presetNextBtn = document.getElementById('presetNextBtn');

    // Event listeners
    closePresetManagerBtn.addEventListener('click', hidePresetManager);
    wirePresetManagerKeyboardOverlayEntries();
    togglePresetSearchBtn.addEventListener('click', togglePresetSearch);
    presetSearch.addEventListener('input', debounce(async () => {
        presetPaginationInfo.currentPage = 1; // Reset to first page when searching
        presetSearchTerm = presetSearch.value;
        await loadPresets();
    }, 300));
    

    if (presetPrevBtn) {
        presetPrevBtn.addEventListener('click', async () => {
            if (presetPaginationInfo.currentPage > 1) {
                presetPaginationInfo.currentPage--;
                await loadPresets();
            }
        });
    }

    if (presetNextBtn) {
        presetNextBtn.addEventListener('click', async () => {
            const totalPages = presetPaginationInfo.totalPages || 1;
            if (presetPaginationInfo.currentPage < totalPages) {
                presetPaginationInfo.currentPage++;
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
                if (e.key === 'PageDown' && presetPaginationInfo.currentPage < (presetPaginationInfo.totalPages || 1)) {
                    e.preventDefault();
                    presetPaginationInfo.currentPage++;
                    await loadPresets();
                } else if (e.key === 'PageUp' && presetPaginationInfo.currentPage > 1) {
                    e.preventDefault();
                    presetPaginationInfo.currentPage--;
                    await loadPresets();
                }
            }
        });
    }
}

let presetManagerEscapeHandler = null;

function wirePresetManagerKeyboardOverlayEntries() {
    if (document.body.dataset.presetManagerKeyboardOverlayWired === 'true') return;
    document.body.dataset.presetManagerKeyboardOverlayWired = 'true';
    if (!presetManagerEscapeHandler) {
        presetManagerEscapeHandler = (e) => {
            if (e.key !== 'Escape') return;
            const updateModal = document.getElementById('updatePresetModal');
            if (updateModal && !updateModal.classList.contains('hidden')) {
                // closeModal: public/scripts/comp/modalUtils.js
                closeModal(updateModal);
                return true;
            }
        };
    }
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'updatePresetModal.escape',
        handler: presetManagerEscapeHandler,
        type: 'whenFocused',
        modalId: 'updatePresetModal',
        priority: 80,
        critical: true,
        label: 'Cancel',
        keys: 'Esc',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Preset Manager'
    });
    registerKeyboardListener({
        id: 'overlay.presetManagerModal.close',
        type: 'whenFocused',
        modalId: 'presetManagerModal',
        label: 'Close',
        keys: 'Alt+Q',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Preset Manager',
        overlayOnly: true,
        priority: -10
    });
    [
        { id: 'overlay.presetManagerModal.pageDown', label: 'Next page', keys: 'Page Down', icon: 'fas fa-chevron-down', overlayValid: () => presetPaginationInfo.currentPage < (presetPaginationInfo.totalPages || 1) },
        { id: 'overlay.presetManagerModal.pageUp', label: 'Previous page', keys: 'Page Up', icon: 'fas fa-chevron-up', overlayValid: () => presetPaginationInfo.currentPage > 1 }
    ].forEach((entry) => {
        registerKeyboardListener({
            id: entry.id,
            type: 'whenFocused',
            modalId: 'presetManagerModal',
            label: entry.label,
            keys: entry.keys,
            overlayIcon: entry.icon,
            overlayGroup: 'Preset Manager',
            overlayOnly: true,
            priority: -10,
            overlayValid: typeof entry.overlayValid === 'function' ? entry.overlayValid : null
        });
    });
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
    
    const wasClosed = modal.classList.contains('hidden');
    await loadPresets();
    await renderPresetList();
    openModal(modal);
    
    if (wasClosed && window.customScrollbar) {
        // Initialize custom scrollbars after modal is opened
        setTimeout(() => {
            const presetListContainer = document.getElementById('presetListContainer');
            if (presetListContainer) {
                window.customScrollbar.forceReinit(presetListContainer);
            }
        }, 50);
    }
}

// Hide preset manager modal
async function hidePresetManager() {
    const modal = document.getElementById('presetManagerModal');
    if (modal) {
        await closeModal(modal);
    }

    // Reset to first page and clear search
    presetPaginationInfo.currentPage = 1;
    presetSearchTerm = '';
    const searchInput = document.getElementById('presetSearch');
    if (searchInput) {
        searchInput.value = '';
    }
    const presetSearchContainer = document.getElementById('presetSearchContainer');
    if (presetSearchContainer) {
        presetSearchContainer.classList.add('hidden');
    }
}

// Toggle preset search
function togglePresetSearch() {
    const toggleContainer = document.getElementById('presetSearchContainer');
    if (toggleContainer) {
        toggleContainer.classList.toggle('hidden');
    }
    const searchInput = document.getElementById('presetSearch');
    if (searchInput) {
        searchInput.focus();
    }
}

// Load presets from server
async function loadPresets() {
    try {
        if (wsClient && wsClient.isConnected()) {
            // Request presets via WebSocket with pagination and search parameters
            const result = await wsClient.getPresets(presetPaginationInfo.currentPage, presetPaginationInfo.itemsPerPage, presetSearchTerm, presetSearchTerm);

            if (result && result.presets) {
                presetData = { ...result.presets };
                originalPresetData = JSON.parse(JSON.stringify(result.presets));

                // Update pagination info
                if (result.pagination) {
                    presetPaginationInfo = { ...result.pagination };
                }

                // Update search state
                presetSearchTerm = result.searchTerm || '';

                // Update search input if it exists
                const searchInput = document.getElementById('presetSearch');
                if (searchInput && searchInput.value !== presetSearchTerm) {
                    searchInput.value = presetSearchTerm;
                }
                
                // Render the updated list
                await renderPresetList();
            } else {
                presetData = {};
                originalPresetData = {};
                presetPaginationInfo = {
                    currentPage: 1,
                    totalPages: 1,
                    totalItems: 0,
                    itemsPerPage: 15,
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
function updatePresetPaginationControls() {
    const pageInfo = document.getElementById('presetPageInfo');
    const prevBtn = document.getElementById('presetPrevBtn');
    const nextBtn = document.getElementById('presetNextBtn');

    if (pageInfo) {
        pageInfo.textContent = `Page ${presetPaginationInfo.currentPage} of ${presetPaginationInfo.totalPages} (${presetPaginationInfo.totalItems} items)`;
    }

    if (prevBtn) {
        prevBtn.disabled = presetPaginationInfo.currentPage <= 1;
    }

    if (nextBtn) {
        nextBtn.disabled = presetPaginationInfo.currentPage >= presetPaginationInfo.totalPages;
    }
    // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
    notifyKeyboardOverlayContextChanged();
}

// Render the preset list
async function renderPresetList() {
    const listContainer = document.getElementById('presetList');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const pageKeys = Object.keys(presetData);

    if (pageKeys.length === 0) {
        if (presetPaginationInfo.totalItems === 0) {
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
        updatePresetPaginationControls();
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
    updatePresetPaginationControls();

    // Scroll to top of the list container when new page is loaded
    scrollPresetListToTop();
}

// Scroll preset list to top
function scrollPresetListToTop() {
    const modal = document.getElementById('presetManagerModal');
    if (modal) {
        // Scroll the list container to top
        const listContainer = modal.querySelector('.text-replacement-list-container .text-replacement-list');
        if (listContainer) {
            listContainer.scrollTop = 0;
        }
    }
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

    header.appendChild(nameDiv);

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
    if (preset.model) {
        for (const g of modelGroups) {
            const found = g.options.find(o => o.value === preset.model.toLowerCase());
            if (found) {
            group = g.group;
            break;
            }
        }
    }
    const groupObj = modelGroups.find(g => g.group === group);
    const optObj = preset.model && groupObj ? groupObj.options.find(o => o.value === preset.model.toLowerCase()) : null;
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
    
    if (preset.resolution && (preset.resolution.toLowerCase().startsWith('large_') || preset.resolution.toLowerCase().startsWith('xlarge_') || preset.resolution.toLowerCase().startsWith('wallpaper_'))) {
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

    // Character reference
    if (preset.chara_reference_source) {
        const icon = document.createElement('i');
        icon.className = 'nai-precise-reference';
        icon.title = `Precise Reference`;
        iconsDiv.appendChild(icon);
    } else
    // Inpaint
    if ((preset.image || preset.image_source) && preset.mask_compressed) {
        const icon = document.createElement('i');
        icon.className = 'nai-inpaint';
        icon.title = 'Selective Masking (Inpaint)';
        iconsDiv.appendChild(icon);
    } else 
    // Vibe transfer
    if (preset.vibe_transfer) {
        const icon = document.createElement('i');
        icon.className = 'nai-vibe-transfer';
        icon.title = `${preset.vibe_transfer.length} Vibe Transfer${preset.vibe_transfer.length > 1 ? 's' : ''}`;
        iconsDiv.appendChild(icon);
    } else 
    // Variety
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
    const box4 = document.createElement('div');
    box4.className = 'uc-box';
    box4.dataset.level = '4';
    boxes.appendChild(box1);
    boxes.appendChild(box2);
    boxes.appendChild(box3);
    boxes.appendChild(box4);
    iconsDiv.appendChild(boxes);

    iconsRow.appendChild(iconsDiv);
    details.appendChild(iconsRow);

    // Assemble
    content.appendChild(valueContainer);
    content.appendChild(details);

    item.appendChild(header);
    item.appendChild(content);

    // Add click handler to trigger edit action (manual modal) by default
    item.addEventListener('click', (e) => {
        // Don't trigger if clicking on a button or interactive element
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.context-menu')) {
            return;
        }
        // Don't trigger if modifier keys are held (might be used for other actions)
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
            return;
        }
        // Only close preset manager modal if not in desktop mode
        if (!window.isDesktop) {
            hidePresetManager();
        }
        openManualModalWithContent({ type: 'preset', name: key, title: key });
    });

    // Add context menu with all actions
    if (contextMenu) {
        contextMenu.attachToElement(item, {
            sections: [{
                type: 'list',
                items: [
                    {
                        text: 'Generate Image',
                        icon: 'nai-sparkles',
                        action: 'generate'
                    },
                    {
                        text: 'Edit in Studio',
                        icon: 'fas fa-compass-drafting',
                        action: 'edit-manual',
                        hideOnBreakpoint: "small-mobile"
                    },
                    {
                        text: 'Request Settings',
                        icon: 'fas fa-cog',
                        action: 'edit-settings'
                    },
                    {
                        text: 'Copy UUID',
                        icon: 'fas fa-link-horizontal',
                        action: 'copy-uuid'
                    },
                    {
                        text: 'Add to Desktop',
                        icon: 'fas fa-arrow-down-left',
                        action: 'add-to-desktop',
                        hidden: () => !document.body.classList.contains('desktop-mode')
                    },
                    { separator: true },
                    {
                        text: 'Delete',
                        icon: 'fas fa-trash',
                        action: 'delete',
                        className: 'context-menu-item-danger'
                    }
                ]
            }],
            onAction: (actionName, target) => {
                if (actionName === 'generate') {
                    generateFromPreset(key);
                    if (!window.isDesktop) {
                        hidePresetManager();
                    }
                } else if (actionName === 'edit-manual') {
                    // Only close preset manager modal if not in desktop mode
                    if (!window.isDesktop) {
                        hidePresetManager();
                    }
                    openManualModalWithContent({ type: 'preset', name: key, title: key });
                } else if (actionName === 'edit-settings') {
                    editPreset(key);
                } else if (actionName === 'copy-uuid') {
                    copyPresetUuid(key);
                } else if (actionName === 'add-to-desktop') {
                    addPresetToDesktop(key);
                } else if (actionName === 'delete') {
                    deletePreset(key);
                }
            }
        });
    }

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

    // Set UUID field
    const uuidInput = document.getElementById('updatePresetUuidInput');
    if (uuidInput) uuidInput.value = preset.uuid || 'No UUID';
    
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

    // Set dynamic generation buttons
    const dynamicGenerationButtons = [
        { id: 'updatePresetTodBtn', key: 'tod' },
        { id: 'updatePresetWeatherBtn', key: 'weather' },
        { id: 'updatePresetSeasonBtn', key: 'season' },
        { id: 'updatePresetClothingBtn', key: 'clothing' },
        { id: 'updatePresetActionBtn', key: 'action' },
        { id: 'updatePresetCreativeBtn', key: 'creative' },
        { id: 'updatePresetOptimizeBtn', key: 'optimize' },
        { id: 'updatePresetUseCacheResponsesBtn', key: 'use_cache_responses' }
    ];

    dynamicGenerationButtons.forEach(({ id, key }) => {
        const btn = document.getElementById(id);
        if (btn) {
            // Check if preset has dynamic_generation settings
            let state = 'off';
            let override = '';

            if (key === 'use_cache_responses') {
                // Handle use_cache_responses_preset separately
                state = (preset.use_cache_responses_preset !== false) ? 'on' : 'off';
            } else if (preset.dynamic_generation && preset.dynamic_generation[key] !== undefined) {
                const value = preset.dynamic_generation[key];
                if (typeof value === 'boolean') {
                    state = value ? 'on' : 'off';
                } else if (typeof value === 'string' || typeof value === 'number') {
                    // For override values
                    state = 'on';
                    override = value.toString();
                }
            }

            btn.setAttribute('data-state', state);
            if (override) {
                btn.setAttribute('data-override', override);
            } else {
                btn.removeAttribute('data-override');
            }
        }
    });

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

    // Initialize copy UUID button
    const copyUuidBtn = document.getElementById('updatePresetCopyUuidBtn');
    if (copyUuidBtn) {
        copyUuidBtn.addEventListener('click', async () => {
            await handleCopyPresetUuidFromModal();
        });
    }

    // Initialize regenerate UUID button
    const regenerateUuidBtn = document.getElementById('updatePresetRegenerateUuidBtn');
    if (regenerateUuidBtn) {
        regenerateUuidBtn.addEventListener('click', async () => {
            await handleRegeneratePresetUuidFromModal();
        });
    }
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

    // Dynamic generation buttons
    const dynamicGenerationButtons = [
        'updatePresetTodBtn', 'updatePresetWeatherBtn', 'updatePresetSeasonBtn',
        'updatePresetClothingBtn', 'updatePresetActionBtn', 'updatePresetCreativeBtn',
        'updatePresetOptimizeBtn', 'updatePresetUseCacheResponsesBtn'
    ];

    dynamicGenerationButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const state = btn.dataset.state === 'on' ? 'off' : 'on';
                btn.dataset.state = state;
                btn.classList.toggle('active', state === 'on');

                // Clear override when turning off (for buttons that support overrides)
                if (state === 'off' && btn.hasAttribute('data-override')) {
                    btn.removeAttribute('data-override');
                }
            });
        }
    });
}

// Hide update preset modal
async function hideUpdatePresetModal() {
    const modal = document.getElementById('updatePresetModal');
    if (modal) {
        await closeModal(modal);
    }

    const searchInput = document.getElementById('presetSearch');
    if (searchInput) {
        searchInput.value = '';
    }
    const presetSearchContainer = document.getElementById('presetSearchContainer');
    if (presetSearchContainer) {
        presetSearchContainer.classList.add('hidden');
    }

    // Reset dynamic generation buttons
    const dynamicGenerationButtons = [
        'updatePresetTodBtn', 'updatePresetWeatherBtn', 'updatePresetSeasonBtn',
        'updatePresetClothingBtn', 'updatePresetActionBtn', 'updatePresetCreativeBtn',
        'updatePresetUseCacheResponsesBtn'
    ];

    dynamicGenerationButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.setAttribute('data-state', 'off');
            btn.removeAttribute('data-override');
        }
    });

    // Clear editing state
    editingPresetName = null;
}

// Handle copy UUID URL from modal
async function handleCopyPresetUuidFromModal() {
    if (!editingPresetName) {
        showGlassToast('error', null, 'No preset selected', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    try {
        const preset = presetData[editingPresetName];
        if (!preset || !preset.uuid) {
            showGlassToast('error', null, 'Preset UUID not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        const presetURL = location.origin + '/preset/' + preset.uuid + '?download=true';
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        await copyTextToClipboard(presetURL);
        showGlassToast('success', null, 'Preset Generation URL copied to clipboard', false, 3000, '<i class="fa-regular fa-clipboard"></i>');
    } catch (error) {
        console.error('Error copying UUID from modal:', error);
        showGlassToast('error', null, 'Failed to copy URL', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Handle regenerate UUID from modal
async function handleRegeneratePresetUuidFromModal() {
    if (!editingPresetName) {
        showGlassToast('error', null, 'No preset selected for UUID regeneration', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    try {
        // Call server to regenerate UUID directly (without confirmation dialog since user is already in modal)
        const result = await wsClient.regeneratePresetUuid(editingPresetName);

        if (result && result.success) {
            showGlassToast('success', null, `UUID regenerated for preset "${editingPresetName}"`, false, 5000, '<i class="fas fa-sync"></i>');

            // Update local data with new UUID from server
            if (result.uuid) {
                if (presetData[editingPresetName]) {
                    presetData[editingPresetName].uuid = result.uuid;
                }
                if (originalPresetData[editingPresetName]) {
                    originalPresetData[editingPresetName].uuid = result.uuid;
                }

                // Update the UUID field with the new UUID
                const uuidInput = document.getElementById('updatePresetUuidInput');
                if (uuidInput) uuidInput.value = result.uuid;
            }
        } else {
            throw new Error(result?.message || 'Failed to regenerate UUID');
        }
    } catch (error) {
        console.error('Error regenerating UUID from modal:', error);
        showGlassToast('error', null, 'Error regenerating UUID: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
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

    // Collect dynamic generation settings
    const dynamicGenerationButtons = [
        { id: 'updatePresetTodBtn', key: 'tod' },
        { id: 'updatePresetWeatherBtn', key: 'weather' },
        { id: 'updatePresetSeasonBtn', key: 'season' },
        { id: 'updatePresetClothingBtn', key: 'clothing' },
        { id: 'updatePresetActionBtn', key: 'action' },
        { id: 'updatePresetCreativeBtn', key: 'creative' },
        { id: 'updatePresetOptimizeBtn', key: 'optimize' }
    ];

    const dynamic_generation = {};
    let hasDynamicGeneration = false;

    dynamicGenerationButtons.forEach(({ id, key }) => {
        const btn = document.getElementById(id);
        if (btn) {
            const state = btn.dataset.state;
            const override = btn.dataset.override;

            if (state === 'on') {
                hasDynamicGeneration = true;
                if (override) {
                    // If there's an override, store the override value
                    dynamic_generation[key] = override;
                } else {
                    // Otherwise, store boolean true
                    dynamic_generation[key] = true;
                }
            }
        }
    });

    // Handle useCacheResponsesBtn separately as a preset-only setting
    const useCacheResponsesBtn = document.getElementById('updatePresetUseCacheResponsesBtn');
    let use_cache_responses_preset = true; // Default to true
    if (useCacheResponsesBtn) {
        use_cache_responses_preset = useCacheResponsesBtn.dataset.state === 'on';
    }

    const formData = {
        name: nameInput?.value?.trim() || '',
        target_workspace: workspaceSelected?.dataset?.value || 'default',
        resolution: resolutionSelected?.dataset?.value.toUpperCase() || '',
        request_upscale: scaleToggle?.getAttribute('data-state') === 'on',
        use_cache_responses_preset: use_cache_responses_preset
    };

    // Only include dynamic_generation if there are settings configured
    if (hasDynamicGeneration) {
        formData.dynamic_generation = dynamic_generation;
    }

    return formData;
}

// Delete preset
async function deletePreset(presetName) {
    // Use confirmation dialog instead of confirm()
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete preset "${presetName}"?`,
        [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        null,
        { title: 'Delete Preset', icon: 'fas fa-trash' }
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
        if (updates.dynamic_generation !== undefined) updateData.dynamic_generation = updates.dynamic_generation;
        if (updates.use_cache_responses_preset !== undefined) updateData.use_cache_responses_preset = updates.use_cache_responses_preset;
        
        // Include preset-specific generation parameters (null values will remove the field)
        if (updates.preset_resolution !== undefined) updateData.preset_resolution = updates.preset_resolution;
        if (updates.preset_steps !== undefined) updateData.preset_steps = updates.preset_steps;
        if (updates.preset_guidance !== undefined) updateData.preset_guidance = updates.preset_guidance;
        if (updates.preset_variety !== undefined) updateData.preset_variety = updates.preset_variety;
        if (updates.preset_rescale !== undefined) updateData.preset_rescale = updates.preset_rescale;
        if (updates.preset_sampler !== undefined) updateData.preset_sampler = updates.preset_sampler;
        if (updates.preset_noiseScheduler !== undefined) updateData.preset_noiseScheduler = updates.preset_noiseScheduler;
        if (updates.text_replacements_seed_preset !== undefined) updateData.text_replacements_seed_preset = updates.text_replacements_seed_preset;
        
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

// Generate image from preset via Spellcaster (spellbook modal)
async function generateFromPreset(presetName) {
    try {
        const queueStatus = await getQueueStatus();
        if (queueStatus.isBlocked) {
            showGlassToast('warning', 'Queue Blocked', 'Generation is currently blocked. Please wait for the queue to clear.', false, 5000);
            return;
        }

        const preset = presetData[presetName];
        if (!preset) {
            throw new Error('Preset not found');
        }

        hidePresetManager();

        // openSpellbookApplet: public/scripts/comp/featureLoader.js
        await openSpellbookApplet();
        if (!window.spellbookModalManager) {
            showGlassToast('error', 'Generation Failed', 'Spellcaster is not available');
            return;
        }

        window.spellbookModalManager.selectPreset(presetName);
        await window.spellbookModalManager.handleGenerate();
    } catch (error) {
        console.error('Preset generation error:', error);
        showGlassToast('error', 'Generation Failed', error.message);
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
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        await copyTextToClipboard(presetURL);
        showGlassToast('success', null, 'Preset Generation URL copied to clipboard', false, 3000, '<i class="fa-regular fa-clipboard"></i>');
    } catch (error) {
        console.error('Error copying UUID:', error);
        showGlassToast('error', null, 'Failed to copy URL', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Add preset to desktop
async function addPresetToDesktop(presetName) {
    try {
        const preset = presetData[presetName];
        if (!preset) {
            showGlassToast('error', null, 'Preset not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        if (!preset.uuid) {
            showGlassToast('error', null, 'Preset does not have a UUID', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        // Check if desktop shortcuts manager is available
        if (typeof desktopShortcuts === 'undefined' || !desktopShortcuts) {
            showGlassToast('error', null, 'Desktop shortcuts not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        // Check if shortcut already exists
        const existingShortcut = desktopShortcuts.shortcuts.find(s => 
            s.type === 'preset' && 
            s.data && 
            s.data.uuid === preset.uuid
        );

        if (existingShortcut) {
            showGlassToast('info', null, 'Preset shortcut already exists on desktop', false, 3000, '<i class="fas fa-info-circle"></i>');
            return;
        }

        // Create shortcut with only UUID in data
        const shortcut = {
            name: preset.name || presetName,
            type: 'preset',
            data: {
                uuid: preset.uuid
            }
        };

        // Add to desktop
        await desktopShortcuts.addShortcut(shortcut);
        
        showGlassToast('success', null, `Added "${preset.name || presetName}" to desktop`, false, 3000, '<i class="fas fa-desktop"></i>');
    } catch (error) {
        console.error('Error adding preset to desktop:', error);
        showGlassToast('error', null, 'Failed to add preset to desktop: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
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
function escapePresetHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let _presetWsHandlersWired = false;

// Set up WebSocket event handlers
function setupWebSocketEventHandlers() {
    if (_presetWsHandlersWired || !wsClient) {
        return;
    }
    _presetWsHandlersWired = true;

    if (wsClient) {
        // Listen for preset response events
        wsClient.on('get_presets_response', handleGetPresetsResponse);
        wsClient.on('update_preset_response', handleUpdatePresetResponse);
        wsClient.on('delete_preset_response', handleDeletePresetResponse);
        
        // Listen for preset updated broadcasts
        wsClient.on('preset_updated', handlePresetUpdated);
    }
}

function wireInlinePresetListeners() {
    const manualPresetName = document.getElementById('manualPresetName');
    const manualLoadBtn = document.getElementById('manualLoadBtn');
    const manualSaveBtn = document.getElementById('manualSaveBtn');
    const manualPresetToggleBtn = document.getElementById('manualPresetToggleBtn');
    const manualPresetGroup = document.getElementById('manualPresetGroup');

    if (manualPresetName && manualPresetName.dataset.wired !== 'true') {
        manualPresetName.dataset.wired = 'true';
        const onPresetNameChange = () => {
            // validatePresetWithTimeout, updateManualPresetPlaceholder: public/scripts/app.js
            validatePresetWithTimeout();
            updateManualPresetPlaceholder();
        };
        manualPresetName.addEventListener('input', onPresetNameChange);
        manualPresetName.addEventListener('keyup', onPresetNameChange);
        manualPresetName.addEventListener('change', onPresetNameChange);
        manualPresetName.addEventListener('input', handlePresetAutocompleteInput);
        manualPresetName.addEventListener('keydown', handlePresetAutocompleteKeydown);
    }

    if (manualLoadBtn && manualLoadBtn.dataset.wired !== 'true') {
        manualLoadBtn.dataset.wired = 'true';
        manualLoadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const presetName = manualPresetName ? manualPresetName.value.trim() : '';
            if (presetName) {
                // openManualModalWithContent: public/scripts/comp/manualModalManager.js
                openManualModalWithContent({ type: 'preset', name: presetName, title: presetName });
            }
        });
    }

    if (manualSaveBtn && manualSaveBtn.dataset.wired !== 'true') {
        manualSaveBtn.dataset.wired = 'true';
        manualSaveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // handleManualSave: public/scripts/app.js
            handleManualSave();
        });
    }

    if (manualPresetToggleBtn && manualPresetGroup && manualPresetToggleBtn.dataset.wired !== 'true') {
        manualPresetToggleBtn.dataset.wired = 'true';
        manualPresetToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (manualPresetGroup.classList.contains('hidden')) {
                manualPresetGroup.classList.remove('hidden');
            } else {
                manualPresetGroup.classList.add('hidden');
            }
            // updateManualPresetToggleBtn, updateManualPresetPlaceholder: public/scripts/app.js
            updateManualPresetToggleBtn();
            updateManualPresetPlaceholder();
        });
    }
}

function wireSeedListeners() {
    const sproutSeedBtn = document.getElementById('sproutSeedBtn');
    const loadSeedBtn = document.getElementById('loadSeedBtn');
    const manualSeedEl = document.getElementById('manualSeed');
    const clearSeedBtnEl = document.getElementById('clearSeedBtn');

    if (manualSeedEl && manualSeedEl.dataset.wired !== 'true') {
        manualSeedEl.dataset.wired = 'true';
        manualSeedEl.addEventListener('input', (e) => {
            clearSeedBtnEl?.classList.toggle('hidden', !e.target.value);
        });
        manualSeedEl.addEventListener('change', (e) => {
            clearSeedBtnEl?.classList.toggle('hidden', !e.target.value);
            // updateSproutSeedButtonFromPreviewSeed: public/scripts/app.js
            updateSproutSeedButtonFromPreviewSeed();
        });
        manualSeedEl.addEventListener('blur', (e) => {
            clearSeedBtnEl?.classList.toggle('hidden', !e.target.value);
        });
    }

    if (clearSeedBtnEl && clearSeedBtnEl.dataset.wired !== 'true') {
        clearSeedBtnEl.dataset.wired = 'true';
        clearSeedBtnEl.addEventListener('click', (e) => {
            e.preventDefault();
            // clearSeed: public/scripts/app.js
            clearSeed();
        });
    }

    if (sproutSeedBtn && sproutSeedBtn.dataset.wired !== 'true') {
        sproutSeedBtn.dataset.wired = 'true';
        // toggleSproutSeed: public/scripts/app.js
        sproutSeedBtn.addEventListener('click', toggleSproutSeed);
        if (typeof contextMenu !== 'undefined' && contextMenu.attachToElement) {
            // getSproutSeedContextMenuConfig: public/scripts/comp/manualModalManager.js
            contextMenu.attachToElement(sproutSeedBtn, getSproutSeedContextMenuConfig());
        }
    }

    if (loadSeedBtn && loadSeedBtn.dataset.wired !== 'true') {
        loadSeedBtn.dataset.wired = 'true';
        // loadSeedFromPreview: public/scripts/app.js
        loadSeedBtn.addEventListener('click', loadSeedFromPreview);
    }

    // updateSproutSeedButton: public/scripts/app.js
    if (typeof updateSproutSeedButton === 'function') {
        updateSproutSeedButton();
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Set up WebSocket event handlers when WebSocket client is available
    if (wsClient) {
        setupWebSocketEventHandlers();
        wsClient.registerInitStep(461, 'Initializing Preset Manager', async () => {
            wireInlinePresetListeners();
            wireSeedListeners();
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
            presetPaginationInfo = { ...data.pagination };
            currentPage = presetPaginationInfo.currentPage;
        }

        // Update search state
        if (data.searchTerm !== undefined) {
            presetSearchTerm = data.searchTerm;
        }

        // Update search input if it exists
        const searchInput = document.getElementById('presetSearch');
        if (searchInput && searchInput.value !== presetSearchTerm) {
            searchInput.value = presetSearchTerm;
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

// ============================================================================
// PRESET AUTOCOMPLETE (manual preset name field — Phase 2 batch 6)
// selectPresetItem, hidePresetAutocomplete: public/scripts/comp/autocompleteUtils.js
// presetAutocompleteTimeout, currentPresetAutocompleteTarget, selectedPresetAutocompleteIndex: manualDropdownManager.js
// ============================================================================

const presetAutocompleteOverlay = document.getElementById('presetAutocompleteOverlay');
const presetAutocompleteList = document.querySelector('.preset-autocomplete-list');

function handlePresetAutocompleteInput(e) {
    const target = e.target;
    const value = target.value;

    if (presetAutocompleteTimeout) {
        clearTimeout(presetAutocompleteTimeout);
    }

    presetAutocompleteTimeout = setTimeout(() => {
        if (value.length >= 2) {
            searchPresets(value, target);
        } else {
            hidePresetAutocomplete();
        }
    }, 300);
}

function handlePresetAutocompleteKeydown(e) {
    if (presetAutocompleteOverlay && !presetAutocompleteOverlay.classList.contains('hidden')) {
        const items = presetAutocompleteList ? presetAutocompleteList.querySelectorAll('.preset-autocomplete-item') : [];

        switch (e.key) {
            case 'ArrowDown':
                selectedPresetAutocompleteIndex = Math.min(selectedPresetAutocompleteIndex + 1, items.length - 1);
                updatePresetAutocompleteSelection();
                break;
            case 'ArrowUp':
                selectedPresetAutocompleteIndex = Math.max(selectedPresetAutocompleteIndex - 1, -1);
                updatePresetAutocompleteSelection();
                break;
            case 'Enter':
                if (selectedPresetAutocompleteIndex >= 0 && items[selectedPresetAutocompleteIndex]) {
                    selectPresetItem(items[selectedPresetAutocompleteIndex].dataset.name);
                }
                break;
            case 'Escape':
                hidePresetAutocomplete();
                break;
        }
    }
}

async function searchPresets(query, target) {
    try {
        let presetResults = [];

        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                presetResults = await window.wsClient.searchPresets(query);
            } catch (wsError) {
                console.error('WebSocket preset search failed:', wsError);
                throw new Error('Preset search service unavailable');
            }
        } else {
            throw new Error('WebSocket not connected');
        }

        if (presetResults && Array.isArray(presetResults) && presetResults.length > 0) {
            showPresetAutocompleteSuggestions(presetResults, target);
        } else {
            hidePresetAutocomplete();
        }
    } catch (error) {
        console.error('Preset search error:', error);
        hidePresetAutocomplete();
    }
}

function showPresetAutocompleteSuggestions(results, target) {
    if (!presetAutocompleteList || !presetAutocompleteOverlay) {
        console.error('Preset autocomplete elements not found');
        return;
    }

    currentPresetAutocompleteTarget = target;
    selectedPresetAutocompleteIndex = -1;

    presetAutocompleteList.innerHTML = '';
    results.forEach((result) => {
        const item = document.createElement('div');
        item.className = 'preset-autocomplete-item';
        item.dataset.name = result.name;

        item.innerHTML = `
            <span class="preset-name">${result.name}</span>
            <span class="preset-details">${window.optionsData?.modelsShort[result.model.toUpperCase()] || result.model || 'Default'}</span>
        `;

        item.addEventListener('click', () => selectPresetItem(result.name));

        presetAutocompleteList.appendChild(item);
    });

    presetAutocompleteOverlay.classList.remove('size-small', 'size-medium', 'size-large');
    if (results.length <= 3) {
        presetAutocompleteOverlay.classList.add('size-small');
    } else if (results.length <= 8) {
        presetAutocompleteOverlay.classList.add('size-medium');
    } else {
        presetAutocompleteOverlay.classList.add('size-large');
    }

    const rect = target.getBoundingClientRect();
    const overlayHeight = Math.min(400, window.innerHeight * 0.5);
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;

    presetAutocompleteOverlay.style.left = rect.left + 'px';
    presetAutocompleteOverlay.style.width = rect.width + 'px';

    if (spaceAbove >= overlayHeight) {
        presetAutocompleteOverlay.style.top = (rect.top - 5) + 'px';
        presetAutocompleteOverlay.style.transform = 'translateY(-100%)';
        presetAutocompleteOverlay.style.maxHeight = overlayHeight + 'px';
    } else {
        presetAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
        presetAutocompleteOverlay.style.transform = 'none';
        presetAutocompleteOverlay.style.maxHeight = Math.min(spaceBelow - 10, overlayHeight) + 'px';
    }

    presetAutocompleteOverlay.classList.remove('hidden');
}

function updatePresetAutocompleteSelection() {
    if (!presetAutocompleteList) return;

    const items = presetAutocompleteList.querySelectorAll('.preset-autocomplete-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedPresetAutocompleteIndex);
    });

    if (selectedPresetAutocompleteIndex >= 0 && items[selectedPresetAutocompleteIndex]) {
        const selectedItem = items[selectedPresetAutocompleteIndex];
        selectedItem.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
    }
}

// ============================================================================
// MANUAL PRESET HELPERS (extracted from app.js — removal manifest Phase 1)
// ============================================================================

async function handlePresetUpdate(data) {
    await loadOptions();


    // Show notification
    if (data.message) {
        showGlassToast('info', null, data.message);
    }
}

// Manual-modal preset delete (app.js: deletePreset)
async function deleteManualPreset(presetName) {
    if (!presetName) {
        showError('No preset name provided');
        return;
    }

    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete the preset "${presetName}"?`,
        [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]
    );

    if (!confirmed) {
        return;
    }

    try {
        selectCustomPreset('');
        // Use WebSocket for preset deletion
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.deletePreset(presetName);

        // Show success message
        if (result && result.data && result.data.message) {
            showGlassToast('success', null, result.data.message, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        } else {
            showGlassToast('success', null, `Preset "${presetName}" deleted`, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        }

        // Clear the manual preset name input and hide delete button
        if (manualPresetName) {
            manualPresetName.value = '';
            updateManualPresetPlaceholder();
            updatePresetLoadSaveState();
        }

    } catch (error) {
        console.error('Error deleting preset:', error);
        showError('Failed to delete preset: ' + error.message);
    }
}

function convertPresetToMetadataFormat(presetData) {
    // Create a copy to avoid modifying the original
    const metadata = { ...presetData };

    // Handle resolution case conversion
    if (metadata.resolution) {
        metadata.resolution = metadata.resolution.toLowerCase();
    }

    // Handle model case conversion
    if (metadata.model) {
        metadata.model = metadata.model.toUpperCase();
    }

    // Convert image field to image_source for compatibility
    if (metadata.image && !metadata.image_source) {
        metadata.image_source = metadata.image;
    }

    // Convert sampler values to expected format
    if (metadata.sampler) {
        metadata.sampler = SAMPLER_MAP.find(s => s.request === metadata.sampler)?.meta || metadata.sampler;
    }

    // Convert noise scheduler values to expected format
    if (metadata.noiseScheduler) {
        metadata.noiseScheduler = NOISE_MAP.find(s => s.request === metadata.noiseScheduler)?.meta || metadata.noiseScheduler;
    }

    return metadata;
}

function isValidPresetName(name) {
    if (!name) return false;
    return window.optionsData.presets && window.optionsData.presets.filter(e => e.name === name).length > 0;
}

function updateManualPresetToggleBtn() {
    const presetName = manualPresetName.value.trim();
    const valid = isValidPresetName(presetName);

    // Determine state based on priority: on/invalid > open > off
    let state = 'off'; // default

    if (presetName !== "") {
        if (valid) {
            state = 'on'; // valid preset name
        } else {
            state = 'invalid'; // preset name exists but not valid (needs saving)
        }
    }

    // If not on/invalid, check if group is open (lower priority)
    if (state === 'off' && !manualPresetGroup.classList.contains('hidden')) {
        state = 'open';
    }

    // Update button state
    manualPresetToggleBtn.setAttribute('data-state', state);

    // Update placeholder visibility
    updateManualPresetPlaceholder();
}

function updateManualPresetPlaceholder() {
    const manualPresetPlaceholder = document.getElementById('manualPresetPlaceholder');
    const manualPresetPlaceholderText = document.getElementById('manualPresetPlaceholderText');
    const presetName = manualPresetName.value.trim();

    // If manualPresetGroup is hidden, show placeholder with preset name
    if (manualPresetGroup.classList.contains('hidden')) {
        manualPresetPlaceholder.classList.add('show');
        if (presetName) {
            manualPresetPlaceholderText.textContent = presetName;
        } else {
            manualPresetPlaceholderText.textContent = '';
        }
    } else {
        // If manualPresetGroup is shown, hide the placeholder
        manualPresetPlaceholder.classList.remove('show');
        manualPresetPlaceholderText.textContent = '';
    }
    updateManualModalTitlebar(presetName);
}

async function saveManualPreset(presetName, config) {
    try {
        // Use WebSocket for preset saving
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.savePreset(presetName, config);

        // Handle the response properly
        if (result && result.data && result.data.message) {
            showGlassToast('success', null, result.data.message, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        } else if (result && result.message) {
            showGlassToast('success', null, result.message, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        } else {
            showGlassToast('success', null, `Preset "${presetName}" saved successfully`, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        }

        // Refresh the preset list
        await loadOptions();
    } catch (error) {
        console.error('Error saving preset:', error);
        showError('Failed to save preset: ' + error.message);
    }
}
