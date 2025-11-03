// Image Expansion Modal Component

let expansionModalData = {
    filename: null, // The current file that was clicked to open the modal (never changes, used for resolution)
    originalImage: null, // The source/original image (may be different if current file is expanded)
    originalDimensions: null,
    lastImage: null, // The actual image to expand (different from source if expanding current/last)
    targetImage: null, // The image that will be expanded (determined by mode)
    expansionMode: 'source', // 'source', 'current', or 'last'
    selectedResolution: null,
    selectedBias: 2, // Default to center
    upscaleAfterComplete: false,
    overrideParams: {},
    enableAI: false // Default to disabled
};

// Open image expansion modal
async function openImageExpansionModal(imageFilename, imageDimensions = null) {
    console.log('📦 Opening image expansion modal for:', imageFilename);
    
    // Validate filename
    if (!imageFilename) {
        console.error('No filename provided to expansion modal');
        showGlassToast('error', 'Error', 'No image filename provided', false, 5000, '<i class="nai-cross"></i>');
        return;
    }
    
    const modal = document.getElementById('imageExpansionDialog');
    if (!modal) {
        console.error('Image expansion dialog not found');
        return;
    }
    
    // Reset modal data
    expansionModalData = {
        filename: imageFilename, // The current file clicked (never changes, used for resolution)
        originalImage: imageFilename, // Will be set to source if this is an expanded image
        originalDimensions: imageDimensions,
        lastImage: imageFilename, // Default to the provided filename
        targetImage: imageFilename, // Default to the provided filename
        expansionMode: 'source', // Default to source mode
        selectedResolution: null,
        selectedBias: 2,
        upscaleAfterComplete: false,
        overrideParams: {},
        enableAI: false // Reset to disabled
    };
    
    // Reset AI toggle state
    const aiToggle = document.getElementById('expansionAIToggle');
    if (aiToggle) {
        aiToggle.setAttribute('data-state', 'off');
    }
    
    // Hide requested content by default
    const requestedContentGroup = document.getElementById('expansionRequestedContentGroup');
    if (requestedContentGroup) {
        requestedContentGroup.classList.add('hidden');
    }
    
    console.log('📊 Received imageDimensions:', imageDimensions);
    
    // If dimensions not provided, fetch from metadata
    let metadata = null;
    if (!imageDimensions && imageFilename) {
        try {
            metadata = await getImageMetadata(imageFilename);

            // Check if this is an already expanded image
            if (metadata?.forge_data?.expansion_source) {
                console.log('📋 Image is expanded, source image:', metadata.forge_data.expansion_source);
                // Get dimensions from the source image initially
                const dimsSource = metadata.forge_data.expansion_source;
                try {
                    const dimsMetadata = await getImageMetadata(dimsSource);
                    if (dimsMetadata) {
                        expansionModalData.originalDimensions = {
                            width: dimsMetadata.actual_width || dimsMetadata.width,
                            height: dimsMetadata.actual_height || dimsMetadata.height
                        };
                    }
                } catch (dimsError) {
                    console.error('Failed to get dimensions for expansion source:', dimsError);
                }
            } else {
                if (metadata) {
                    expansionModalData.originalDimensions = {
                        width: metadata.actual_width || metadata.width,
                        height: metadata.actual_height || metadata.height
                    };
                }
            }
        } catch (error) {
            console.error('Failed to fetch image dimensions:', error);
        }
    } else if (imageDimensions) {
        // Try to get metadata for expansion settings
        try {
            metadata = await getImageMetadata(imageFilename);
        } catch (error) {
            console.error('Failed to fetch metadata:', error);
        }
    }
    
    // Check if this image has expansion metadata (was previously expanded)
    if (metadata?.forge_data?.expansion_source) {
        console.log('📋 Image is expanded, source image:', metadata.forge_data.expansion_source);
        expansionModalData.expansionMode = 'current';
        expansionModalData.originalImage = metadata.forge_data.expansion_source;

        console.log('📋 Loading previous expansion settings');
    }
    
    // Populate resolution dropdown with filtered options (after updating dimensions if needed)
    await populateExpansionResolutionDropdown();
    
    // Load previous expansion settings if available
    if (metadata?.forge_data?.expansion_source) {
        
        // Set previous expansion resolution
        if (metadata.forge_data.expansion_resolution) {
            expansionModalData.selectedResolution = metadata.forge_data.expansion_resolution;
            const resData = RESOLUTIONS.find(r => r.value === metadata.forge_data.expansion_resolution);
            const selectedElement = document.getElementById('expansionResolutionSelected');
            if (selectedElement && resData) {
                selectedElement.textContent = resData.display;
            }
        }
        
        // Set previous bias
        if (metadata.forge_data.expansion_bias !== undefined) {
            selectExpansionBias(metadata.forge_data.expansion_bias);
        } else {
            selectExpansionBias(2);
        }
        
        // Set upscale toggle if it was used (check both possible property names)
        const upscaleToggle = document.getElementById('expansionUpscaleToggle');
        if (upscaleToggle) {
            const wasUpscaled = metadata.forge_data.expansion_params?.upscale || 
                               metadata.forge_data.expansion_params?.upscaleAfterComplete
            upscaleToggle.setAttribute('data-state', wasUpscaled ? 'on' : 'off');
        }

        // Set requested content if it was used
        const requestedContentTextarea = document.getElementById('expansionRequestedContent');
        if (requestedContentTextarea && metadata.forge_data.expansion_requested_content) {
            requestedContentTextarea.value = metadata.forge_data.expansion_requested_content;
        } else if (requestedContentTextarea) {
            requestedContentTextarea.value = '';
        }
        
        // Load advanced params if they were used
        if (metadata.forge_data.expansion_params) {
            const params = metadata.forge_data.expansion_params;
            
            if (params.model) {
                document.getElementById('expansionModelInput').value = params.model;
                const modelSelected = document.getElementById('expansionModelSelected');
                if (modelSelected) {
                    // Find model name
                    for (const group of modelGroups) {
                        const model = group.options.find(opt => opt.value === params.model);
                        if (model) {
                            modelSelected.textContent = model.name;
                            break;
                        }
                    }
                }
            }
            
            if (params.steps) document.getElementById('expansionStepsInput').value = params.steps;
            if (params.guidance) document.getElementById('expansionGuidanceInput').value = params.guidance;
            if (params.rescale !== undefined) {
                document.getElementById('expansionRescaleInput').value = params.rescale;
                const rescaleOverlay = document.getElementById('expansionRescaleOverlay');
                if (rescaleOverlay) {
                    rescaleOverlay.textContent = `${Math.round(params.rescale * 100)}%`;
                }
            }
            if (params.sampler) {
                document.getElementById('expansionSamplerInput').value = params.sampler;
                const samplerSelected = document.getElementById('expansionSamplerSelected');
                if (samplerSelected) {
                    const sampler = SAMPLER_MAP.find(s => s.meta === params.sampler);
                    if (sampler) samplerSelected.textContent = sampler.display;
                }
            }
            if (params.noise_schedule) {
                document.getElementById('expansionNoiseSchedulerInput').value = params.noise_schedule;
                const noiseSchedulerSelected = document.getElementById('expansionNoiseSchedulerSelected');
                if (noiseSchedulerSelected) {
                    const noise = NOISE_MAP.find(n => n.meta === params.noise_schedule);
                    if (noise) noiseSchedulerSelected.textContent = noise.display;
                }
            }
            if (params.noise !== undefined) {
                document.getElementById('expansionNoiseInput').value = params.noise;
                const noiseOverlay = document.getElementById('expansionNoiseOverlay');
                if (noiseOverlay) {
                    noiseOverlay.textContent = `${Math.round(params.noise * 100)}%`;
                }
            }
            if (params.seed) document.getElementById('expansionSeedInput').value = params.seed;
        }
    } else {
        // No previous expansion, use defaults and clear inputs
        selectExpansionBias(2);
        
        const upscaleToggle = document.getElementById('expansionUpscaleToggle');
        if (upscaleToggle) {
            upscaleToggle.setAttribute('data-state', 'off');
        }
        
        // Clear advanced inputs
        document.getElementById('expansionModelInput').value = '';
        document.getElementById('expansionStepsInput').value = '';
        document.getElementById('expansionGuidanceInput').value = '';
        document.getElementById('expansionRescaleInput').value = '';
        document.getElementById('expansionSamplerInput').value = '';
        document.getElementById('expansionNoiseSchedulerInput').value = '';
        document.getElementById('expansionNoiseInput').value = '';
        document.getElementById('expansionSeedInput').value = '';

        // Clear requested content textarea
        const requestedContentTextarea = document.getElementById('expansionRequestedContent');
        if (requestedContentTextarea) {
            requestedContentTextarea.value = '';
        }
        
        // Reset dropdown displays
        const modelSelected = document.getElementById('expansionModelSelected');
        const samplerSelected = document.getElementById('expansionSamplerSelected');
        const noiseSchedulerSelected = document.getElementById('expansionNoiseSchedulerSelected');
        if (modelSelected) modelSelected.textContent = 'Select model...';
        if (samplerSelected) samplerSelected.textContent = 'Select sampler...';
        if (noiseSchedulerSelected) noiseSchedulerSelected.textContent = 'Select scheduler...';
    }
    
    hideExpansionAdvancedOptions();

    // Setup expansion mode dropdown (only once)
    const expansionModeDropdown = document.getElementById('expansionModeDropdown');
    if (expansionModeDropdown && !expansionModeDropdown.dataset.initialized) {
        setupExpansionModeDropdown();
        expansionModeDropdown.dataset.initialized = 'true';
    } else {
        // Update display if already initialized
        updateExpansionModeDisplay();
    }

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('visible');
}

// Close image expansion modal
function closeImageExpansionModal() {
    const modal = document.getElementById('imageExpansionDialog');
    if (modal) {
        modal.classList.remove('visible');
        modal.classList.add('hidden');
    }
}

// Setup expansion mode dropdown
function setupExpansionModeDropdown() {
    const dropdown = document.getElementById('expansionModeDropdown');
    const dropdownBtn = document.getElementById('expansionModeDropdownBtn');
    const dropdownMenu = document.getElementById('expansionModeDropdownMenu');
    const selectedDisplay = document.getElementById('expansionModeSelected');

    if (!dropdown || !dropdownBtn || !dropdownMenu || !selectedDisplay) {
        console.warn('Expansion mode dropdown elements not found');
        return;
    }

    // Populate dropdown options
    populateExpansionModeDropdown();

    // Set initial display
    updateExpansionModeDisplay();

    // Setup dropdown using the standard setupDropdown function
    setupDropdown(
        dropdown,
        dropdownBtn,
        dropdownMenu,
        renderExpansionModeDropdown,
        () => expansionModalData.expansionMode,
        { preventFocusTransfer: true }
    );
}

// Populate expansion mode dropdown options
function populateExpansionModeDropdown() {
    const dropdownMenu = document.getElementById('expansionModeDropdownMenu');
    if (!dropdownMenu) return;

    dropdownMenu.innerHTML = '';

    const modes = [
        { value: 'source', label: 'Source', description: 'Use original source image' },
        { value: 'current', label: 'Current', description: 'Use current displayed image' },
        { value: 'last', label: 'Last', description: 'Use last expanded version' }
    ];

    modes.forEach(mode => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.dataset.value = mode.value;
        option.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 500;">${mode.label}</span>
                <span style="font-size: 0.85em; opacity: 0.7;">${mode.description}</span>
            </div>
        `;

        option.addEventListener('click', () => {
            selectExpansionMode(mode.value);
            closeDropdown(dropdownMenu, document.getElementById('expansionModeDropdownBtn'));
        });

        dropdownMenu.appendChild(option);
    });
}

// Render expansion mode dropdown options
function renderExpansionModeDropdown(selectedValue) {
    const dropdownMenu = document.getElementById('expansionModeDropdownMenu');
    if (!dropdownMenu) return;

    // Update selected state
    const options = dropdownMenu.querySelectorAll('.custom-dropdown-option');
    options.forEach(option => {
        if (option.dataset.value === selectedValue) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
}

// Select expansion mode and update UI
async function selectExpansionMode(mode) {
    console.log('🔄 Switching to expansion mode:', mode);

    const previousMode = expansionModalData.expansionMode;
    expansionModalData.expansionMode = mode;

    try {
        // Use the filename (clicked image) to determine source relationships
        const metadata = await getImageMetadata(expansionModalData.filename);

        switch (mode) {
            case 'source':
                // Use the original source image
                if (metadata?.forge_data?.expansion_source) {
                    expansionModalData.targetImage = metadata.forge_data.expansion_source;
                } else {
                    expansionModalData.targetImage = expansionModalData.filename;
                }
                // Don't touch lastImage in source mode
                break;

            case 'current':
                // Use the current displayed image (the one that was clicked)
                expansionModalData.targetImage = expansionModalData.filename;
                // Don't update lastImage in current mode - keep existing reference
                break;

            case 'last':
                // Use the lastImage for expansion
                expansionModalData.targetImage = expansionModalData.lastImage || expansionModalData.filename;
                // After using lastImage, update it to the current image
                expansionModalData.lastImage = expansionModalData.filename;
                break;
        }

        // Update dimensions based on the current mode
        await populateExpansionResolutionDropdown();

        // Update display
        updateExpansionModeDisplay();

        // Update reroll button visibility
        updateRerollButtonVisibility();

    } catch (error) {
        console.error('Failed to switch expansion mode:', error);
    }
}

// Update expansion mode display text
function updateExpansionModeDisplay() {
    const selectedDisplay = document.getElementById('expansionModeSelected');
    if (!selectedDisplay) return;

    const modeLabels = {
        'source': 'Source',
        'current': 'Current',
        'last': 'Last'
    };

    selectedDisplay.textContent = modeLabels[expansionModalData.expansionMode] || 'Source';
}

// Populate resolution dropdown with filtered options
async function populateExpansionResolutionDropdown() {
    const dropdown = document.getElementById('expansionResolutionDropdownMenu');
    if (!dropdown) return;

    dropdown.innerHTML = '';

    let dimsToUse, resPresetToUse;

    // Use the target image that was determined by selectExpansionMode
    const imageForDimensions = expansionModalData.targetImage;

    try {
        const metadata = await getImageMetadata(imageForDimensions);
        if (metadata) {
            dimsToUse = {
                width: metadata.actual_width || metadata.width,
                height: metadata.actual_height || metadata.height
            };
            resPresetToUse = (metadata.actual_resolution || metadata.resPreset || metadata.resolution || '').toLowerCase();
            console.log(`📐 Using ${expansionModalData.expansionMode} image dimensions for resolution filtering:`, dimsToUse, 'preset:', resPresetToUse);
        } else {
            console.warn('No metadata available for selected image');
            dimsToUse = expansionModalData.originalDimensions;
            resPresetToUse = (expansionModalData.originalDimensions?.resPreset || '').toLowerCase();
        }
    } catch (error) {
        console.error('Failed to get image metadata for resolution filtering:', error);
        dimsToUse = expansionModalData.originalDimensions;
        resPresetToUse = (expansionModalData.originalDimensions?.resPreset || '').toLowerCase();
    }

    if (!dimsToUse) {
        console.warn('No dimensions available');
        const noOptions = document.createElement('div');
        noOptions.className = 'custom-dropdown-option';
        noOptions.style.opacity = '0.5';
        noOptions.textContent = 'Unable to determine dimensions';
        dropdown.appendChild(noOptions);
        return;
    }
    
    // Filter RESOLUTION_GROUPS based on image characteristics
    const filteredGroups = RESOLUTION_GROUPS.map(group => {
        const filteredOptions = group.options.filter(opt => {
            // Skip custom resolution option
            if (opt.value === 'custom') return false;

            // Always exclude small resolutions
            if (opt.value.startsWith('small_')) {
                return false;
            }

            // Get option characteristics
            const optIsPortrait = opt.value.includes('_portrait');
            const optIsLandscape = opt.value.includes('_landscape');
            const optIsSquare = opt.value.includes('_square');
            const optIsWallpaperLandscape = opt.value === 'wallpaper_landscape';
            const optIsWallpaperPortrait = opt.value === 'wallpaper_portrait';

            // Apply filtering rules based on current image characteristics
            if (dimsToUse && dimsToUse.width && dimsToUse.height) {
                const imageAR = dimsToUse.width / dimsToUse.height;
                const isPortrait = dimsToUse.height > dimsToUse.width;
                const isLandscape = dimsToUse.width > dimsToUse.height;
                const isSquare = dimsToUse.width === dimsToUse.height;

                // If image is portrait, exclude all portrait resolutions
                if (isPortrait && optIsPortrait) {
                    return false;
                }

                // If image is landscape, exclude all landscape resolutions
                if (isLandscape && optIsLandscape) {
                    return false;
                }

                // If image is square, exclude all square resolutions
                if (isSquare && optIsSquare) {
                    return false;
                }

                // Special wallpaper rules based on aspect ratio
                // If image is 16:9 aspect ratio, exclude wallpaper landscape
                if (Math.abs(imageAR - 16/9) < 0.1 && optIsWallpaperLandscape) {
                    return false;
                }

                // If image is 9:16 aspect ratio, exclude wallpaper portrait
                if (Math.abs(imageAR - 9/16) < 0.1 && optIsWallpaperPortrait) {
                    return false;
                }
            }

            // Include all other resolutions
            return true;
        });

        return {
            ...group,
            options: filteredOptions
        };
    }).filter(group => group.options.length > 0);
    
    // Use renderGroupedDropdown with badges
    if (filteredGroups.length > 0) {
        renderGroupedDropdown(
            dropdown,
            filteredGroups,
            selectExpansionResolution,
            closeExpansionResolutionDropdown,
            expansionModalData.selectedResolution,
            (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`,
            { preventFocusTransfer: true }
        );
    } else {
        const noOptions = document.createElement('div');
        noOptions.className = 'custom-dropdown-option';
        noOptions.style.opacity = '0.5';
        noOptions.textContent = 'No expansion options available';
        dropdown.appendChild(noOptions);
    }
}

// Select expansion resolution
function selectExpansionResolution(value, group) {
    expansionModalData.selectedResolution = value;
    
    const selectedElement = document.getElementById('expansionResolutionSelected');
    if (selectedElement) {
        // Find the resolution name from RESOLUTIONS array
        const resData = RESOLUTIONS.find(r => r.value === value);
        if (resData) {
            selectedElement.textContent = resData.display;
        } else {
            selectedElement.textContent = value;
        }
    }
    
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    if (upscaleToggle && typeof calculateUpscaleInfo === 'function') {
        const dimensions = getDimensionsFromResolution(value);
        if (dimensions) {
            const upscaleInfo = calculateUpscaleInfo(dimensions.width, dimensions.height);
            if (upscaleInfo.available) {
                upscaleToggle.disabled = false;
                upscaleToggle.title = 'Enable upscaling after expansion';
            } else {
                upscaleToggle.disabled = true;
                upscaleToggle.title = upscaleInfo.reason || 'Upscaling not available for this resolution';
                // Turn off the toggle if it was on
                if (upscaleToggle.getAttribute('data-state') === 'on') {
                    upscaleToggle.setAttribute('data-state', 'off');
                }
            }
        }
    }
}

// Close expansion resolution dropdown
function closeExpansionResolutionDropdown() {
    const menu = document.getElementById('expansionResolutionDropdownMenu');
    const btn = document.getElementById('expansionResolutionDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Render bias dropdown
function renderExpansionBiasDropdown(selectedVal) {
    const menu = document.getElementById('expansionBiasDropdownMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    // Determine orientation based on original dimensions
    const origDims = expansionModalData.originalDimensions;
    let isPortraitImage = false;
    
    if (origDims) {
        // Check if it's a portrait-oriented image (width < height)
        isPortraitImage = origDims.width < origDims.height;
    }
    
    const biasOptions = [
        { value: '0', display: isPortraitImage ? 'Top' : 'Left' },
        { value: '1', display: isPortraitImage ? 'Mid-Top' : 'Mid-Left' },
        { value: '2', display: 'Center' },
        { value: '3', display: isPortraitImage ? 'Mid-Bottom' : 'Mid-Right' },
        { value: '4', display: isPortraitImage ? 'Bottom' : 'Right' }
    ];
    
    biasOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option' + (selectedVal === option.value ? ' selected' : '');
        optionElement.dataset.value = option.value;
        
        // Create grid based on orientation
        let gridHTML = '';
        for (let i = 0; i < 15; i++) {
            gridHTML += '<div class="grid-cell"></div>';
        }
        
        optionElement.innerHTML = `
            <div class="mask-bias-option-content">
                <div class="mask-bias-grid" data-bias="${option.value}" data-orientation="${isPortraitImage ? 'portrait' : 'landscape'}">
                    ${gridHTML}
                </div>
                <span class="mask-bias-label">${option.display}</span>
            </div>
        `;
        
        optionElement.addEventListener('click', () => {
            selectExpansionBias(parseInt(option.value));
            closeExpansionBiasDropdown();
        });
        
        menu.appendChild(optionElement);
    });
}

// Select expansion bias
function selectExpansionBias(value) {
    expansionModalData.selectedBias = value;
    
    const selectedElement = document.getElementById('expansionBiasSelected');
    const buttonGrid = document.getElementById('expansionBiasGrid');
    
    if (selectedElement && buttonGrid) {
        // Update display text based on value
        const origDims = expansionModalData.originalDimensions;
        let isPortraitImage = false;
        
        if (origDims) {
            // Check if it's a portrait-oriented image (width < height)
            isPortraitImage = origDims.width < origDims.height;
        }
        
        const biasLabels = [
            isPortraitImage ? 'Top' : 'Left',
            isPortraitImage ? 'Mid-Top' : 'Mid-Left',
            'Center',
            isPortraitImage ? 'Mid-Bottom' : 'Mid-Right',
            isPortraitImage ? 'Bottom' : 'Right'
        ];
        
        selectedElement.textContent = biasLabels[value] || 'Center';
        
        // Update button grid
        buttonGrid.setAttribute('data-bias', value);
        buttonGrid.setAttribute('data-orientation', isPortraitImage ? 'portrait' : 'landscape');
    }
    
    // Re-render dropdown to update selected state
    renderExpansionBiasDropdown(value.toString());
}

// Close expansion bias dropdown
function closeExpansionBiasDropdown() {
    const menu = document.getElementById('expansionBiasDropdownMenu');
    const btn = document.getElementById('expansionBiasDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Update reroll button visibility
async function updateRerollButtonVisibility() {
    const rerollBtn = document.getElementById('rerollExpansionBtn');
    if (!rerollBtn) return;
    
    // Show only when:
    // 1. Mode is 'current' or 'last' (not 'source')
    // 2. Metadata has expansion_prompt (is an expanded image)
    try {
        const metadata = await getImageMetadata(expansionModalData.targetImage);
        const hasExpansionData = metadata?.forge_data?.expansion_prompt;
        
        if (hasExpansionData && expansionModalData.expansionMode !== 'source') {
            rerollBtn.classList.remove('hidden');
        } else {
            rerollBtn.classList.add('hidden');
        }
    } catch (error) {
        rerollBtn.classList.add('hidden');
    }
}

// Toggle auto-seed
async function toggleAutoSeed() {
    const toggle = document.getElementById('expansionAutoSeedToggle');
    const seedInput = document.getElementById('expansionSeedInput');
    
    if (!toggle || !seedInput) return;
    
    const currentState = toggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    toggle.setAttribute('data-state', newState);
    
    if (newState === 'off') {
        // Use saved seed - make readonly and populate from metadata
        try {
            const metadata = await getImageMetadata(expansionModalData.targetImage);
            const savedSeed = metadata?.seed;
            if (savedSeed) {
                seedInput.value = savedSeed;
                seedInput.setAttribute('readonly', 'readonly');
            }
        } catch (error) {
            console.error('Failed to load saved seed:', error);
        }
    } else {
        // Random seed - clear readonly and clear value
        seedInput.removeAttribute('readonly');
        seedInput.value = '';
    }
}

// Submit image expansion reroll
async function submitImageExpansionReroll() {
    // Validate
    if (!expansionModalData.targetImage) {
        showGlassToast('error', 'Error', 'No image selected');
        return;
    }
    
    // Get override params from advanced options
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    const overrideParams = {};
    
    if (advancedSection && !advancedSection.classList.contains('hidden')) {
        Object.assign(overrideParams, getExpansionOverrideParams());
    }
    
    closeImageExpansionModal();
    
    // Show progress
    const manualForm = document.getElementById('manualForm');
    if (manualForm) {
        manualForm.classList.add('generating');
        manualForm.classList.add('streaming');
    }
    if (typeof startPreviewAnimation === 'function') {
        startPreviewAnimation();
    }
    
    if (!progressToastId) {
        progressToastId = showGlassToast('info', 'Rerolling Expansion', 'Regenerating expanded image...', true, false, '<i class="mdi mdi-1-25 mdi-refresh"></i>');
    }
    
    try {
        const result = await wsClient.rerollExpandedImage({
            filename: expansionModalData.targetImage,
            overrideParams: overrideParams,
            workspace: activeWorkspace || null,
            enableStreaming: true
        });
        
        if (result) {
            updateGlassToastComplete(progressToastId, {
                type: 'success',
                title: 'Expansion Rerolled',
                message: 'Image regenerated successfully!',
                customIcon: '<i class="mdi mdi-1-25 mdi-refresh"></i>',
                showProgress: false
            });
            progressToastId = null;
            
            const byteCharacters = atob(result.image);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/png' });
            
            if (wsClient && wsClient.waitForStreamingStepsComplete) {
                await wsClient.waitForStreamingStepsComplete('manual');
            }
            
            if (manualForm) {
                manualForm.classList.remove('streaming');
            }
            
            const mockResponse = {
                headers: {
                    get: (headerName) => {
                        if (headerName === 'X-Generated-Filename') return result.filename;
                        if (headerName === 'X-Seed') return result.seed;
                        return null;
                    }
                }
            };
            
            await handleImageResult(blob, 'Image rerolled successfully!', undefined, undefined, mockResponse);
            manualForm.classList.remove('generating');
            stopPreviewAnimation();
        }
    } catch (error) {
        console.error('❌ Image reroll failed:', error);
        
        if (manualForm) {
            manualForm.classList.remove('generating');
            manualForm.classList.remove('streaming');
        }
        if (typeof stopPreviewAnimation === 'function') {
            stopPreviewAnimation();
        }
        
        updateGlassToastComplete(progressToastId, {
            type: 'error',
            title: 'Reroll Failed',
            message: error.message || 'Failed to reroll image',
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
        progressToastId = null;
    }
}

// Render model dropdown
function renderExpansionModelDropdown(selectedVal) {
    const menu = document.getElementById('expansionModelDropdownMenu');
    if (!menu) return;
    
    // Use global modelGroups array
    renderGroupedDropdown(
        menu,
        modelGroups,
        selectExpansionModel,
        closeExpansionModelDropdown,
        selectedVal,
        (opt, group) => `<span>${opt.name}</span>`,
        { preventFocusTransfer: true }
    );
}

// Select model
function selectExpansionModel(value) {
    const modelInput = document.getElementById('expansionModelInput');
    if (modelInput) {
        modelInput.value = value;
    }
    
    // Update display text
    const selectedElement = document.getElementById('expansionModelSelected');
    if (selectedElement) {
        // Find the model name from modelGroups
        let modelName = value;
        for (const group of modelGroups) {
            const model = group.options.find(opt => opt.value === value);
            if (model) {
                modelName = model.name;
                break;
            }
        }
        selectedElement.textContent = modelName;
    }
}

// Close model dropdown
function closeExpansionModelDropdown() {
    const menu = document.getElementById('expansionModelDropdownMenu');
    const btn = document.getElementById('expansionModelDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Render sampler dropdown
function renderExpansionSamplerDropdown(selectedVal) {
    const menu = document.getElementById('expansionSamplerDropdownMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    // Use global SAMPLER_MAP array
    SAMPLER_MAP.forEach(sampler => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedVal === sampler.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = sampler.meta;
        option.innerHTML = `<span>${sampler.display}</span>`;
        
        const action = () => {
            selectExpansionSampler(sampler.meta);
            closeExpansionSamplerDropdown();
        };
        
        option.addEventListener('click', action);
        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });
        
        menu.appendChild(option);
    });
}

// Select sampler
function selectExpansionSampler(value) {
    const samplerInput = document.getElementById('expansionSamplerInput');
    if (samplerInput) {
        samplerInput.value = value;
    }
    
    // Update display text
    const selectedElement = document.getElementById('expansionSamplerSelected');
    if (selectedElement) {
        // Find the sampler name from SAMPLER_MAP
        const sampler = SAMPLER_MAP.find(s => s.meta === value);
        selectedElement.textContent = sampler ? sampler.display : value;
    }
}

// Close sampler dropdown
function closeExpansionSamplerDropdown() {
    const menu = document.getElementById('expansionSamplerDropdownMenu');
    const btn = document.getElementById('expansionSamplerDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Render noise scheduler dropdown
function renderExpansionNoiseSchedulerDropdown(selectedVal) {
    const menu = document.getElementById('expansionNoiseSchedulerDropdownMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    // Use global NOISE_MAP array
    NOISE_MAP.forEach(noise => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedVal === noise.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = noise.meta;
        option.innerHTML = `<span>${noise.display}</span>`;
        
        const action = () => {
            selectExpansionNoiseScheduler(noise.meta);
            closeExpansionNoiseSchedulerDropdown();
        };
        
        option.addEventListener('click', action);
        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });
        
        menu.appendChild(option);
    });
}

// Select noise scheduler
function selectExpansionNoiseScheduler(value) {
    const noiseSchedulerInput = document.getElementById('expansionNoiseSchedulerInput');
    if (noiseSchedulerInput) {
        noiseSchedulerInput.value = value;
    }
    
    // Update display text
    const selectedElement = document.getElementById('expansionNoiseSchedulerSelected');
    if (selectedElement) {
        // Find the noise scheduler name from NOISE_MAP
        const noise = NOISE_MAP.find(n => n.meta === value);
        selectedElement.textContent = noise ? noise.display : value;
    }
}

// Close noise scheduler dropdown
function closeExpansionNoiseSchedulerDropdown() {
    const menu = document.getElementById('expansionNoiseSchedulerDropdownMenu');
    const btn = document.getElementById('expansionNoiseSchedulerDropdownBtn');
    if (menu && btn) {
        closeDropdown(menu, btn);
    }
}

// Toggle expansion advanced options
function toggleExpansionAdvancedOptions() {
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    
    if (advancedSection) {
        if (advancedSection.classList.contains('hidden')) {
            advancedSection.classList.remove('hidden');
        } else {
            advancedSection.classList.add('hidden');
        }
    }
}

// Hide expansion advanced options
function hideExpansionAdvancedOptions() {
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    
    if (advancedSection) {
        advancedSection.classList.add('hidden');
    }
}

// Get expansion override parameters from UI
function getExpansionOverrideParams() {
    const params = {};
    
    // Get model
    const modelInput = document.getElementById('expansionModelInput');
    if (modelInput && modelInput.value) {
        params.model = modelInput.value;
    }
    
    // Get steps
    const stepsInput = document.getElementById('expansionStepsInput');
    if (stepsInput && stepsInput.value) {
        params.steps = parseInt(stepsInput.value);
    }
    
    // Get guidance
    const guidanceInput = document.getElementById('expansionGuidanceInput');
    if (guidanceInput && guidanceInput.value) {
        params.guidance = parseFloat(guidanceInput.value);
    }
    
    // Get rescale
    const rescaleInput = document.getElementById('expansionRescaleInput');
    if (rescaleInput && rescaleInput.value) {
        params.rescale = parseFloat(rescaleInput.value);
    }
    
    // Get sampler
    const samplerInput = document.getElementById('expansionSamplerInput');
    if (samplerInput && samplerInput.value) {
        params.sampler = samplerInput.value;
    }
    
    // Get noise scheduler
    const noiseSchedulerInput = document.getElementById('expansionNoiseSchedulerInput');
    if (noiseSchedulerInput && noiseSchedulerInput.value) {
        params.noise_schedule = noiseSchedulerInput.value;
    }
    
    // Get noise
    const noiseInput = document.getElementById('expansionNoiseInput');
    if (noiseInput && noiseInput.value) {
        params.noise = parseFloat(noiseInput.value);
    }
    
    // Get seed
    const seedInput = document.getElementById('expansionSeedInput');
    if (seedInput && seedInput.value) {
        params.seed = parseInt(seedInput.value);
    }
    
    return params;
}

// Submit image expansion
async function submitImageExpansion() {
    // Use the target image that was determined by selectExpansionMode
    const imageToExpand = expansionModalData.targetImage;

    // Validate required fields
    if (!imageToExpand) {
        showGlassToast('error', 'Error', 'No image selected');
        return;
    }
    
    if (!expansionModalData.selectedResolution) {
        showGlassToast('error', 'Error', 'Please select a target resolution');
        return;
    }
    
    // Get upscale toggle state
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    expansionModalData.upscaleAfterComplete = upscaleToggle ? upscaleToggle.getAttribute('data-state') === 'on' : false;
    
    // Get override parameters from advanced options
    const advancedSection = document.getElementById('expansionAdvancedOptions');
    if (advancedSection && !advancedSection.classList.contains('hidden')) {
        expansionModalData.overrideParams = getExpansionOverrideParams();
    } else {
        expansionModalData.overrideParams = {};
    }
    
    // Get requested content if provided
    const requestedContentTextarea = document.getElementById('expansionRequestedContent');
    if (requestedContentTextarea && requestedContentTextarea.value.trim()) {
        expansionModalData.overrideParams.requestedContent = requestedContentTextarea.value.trim();
    }
    
    // Close modal
    closeImageExpansionModal();
    
    // Add generating class to manual preview container if in manual modal
    const manualForm = document.getElementById('manualForm');
    const previewContainer = document.getElementById('manualPreviewContainer');
    if (manualForm) {
        manualForm.classList.add('generating');
        manualForm.classList.add('streaming');
    }
    // Start preview animation if available
    if (typeof startPreviewAnimation === 'function') {
        startPreviewAnimation();
    }
    
    // Show progress toast (use global progressToastId for websocket handler compatibility)
    if (!progressToastId) {
        progressToastId = showGlassToast('info', 'Expanding Canvas', 'Analyzing image and generating expansion...', true, false, '<i class="mdi mdi-1-25 mdi-relative-scale"></i>');
    }

    try {
        // Send expansion request via WebSocket with streaming enabled
        const result = await wsClient.expandImage({
            filename: imageToExpand, // The image to actually expand (target)
            sourceFilename: expansionModalData.originalImage, // The source image for metadata tracking
            expansionMode: expansionModalData.expansionMode, // Track which mode was used
            resolution: expansionModalData.selectedResolution,
            imageBias: expansionModalData.selectedBias,
            upscaleAfterComplete: expansionModalData.upscaleAfterComplete,
            overrideParams: expansionModalData.overrideParams,
            workspace: activeWorkspace || null,
            enableStreaming: true,
            enableAI: expansionModalData.enableAI
        });
        
        if (result) {
            // Show success
            updateGlassToastComplete(progressToastId, {
                type: 'success',
                title: 'Canvas Expanded',
                message: `Image expanded successfully!`,
                customIcon: '<i class="mdi mdi-1-25 mdi-relative-scale"></i>',
                showProgress: false
            });

            // Clear the toast ID for future expansions
            progressToastId = null;
            
            // Handle the result similar to upscaling
            const byteCharacters = atob(result.image);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/png' });
            
            // Wait for all queued streaming steps to be displayed before finalizing
            if (wsClient && wsClient.waitForStreamingStepsComplete) {
                console.log('⏳ Waiting for streaming steps to complete...');
                await wsClient.waitForStreamingStepsComplete('manual');
                console.log('✅ All streaming steps displayed');
            }
            
            // Remove streaming class before setting final image
            if (manualForm) {
                manualForm.classList.remove('streaming');
            }
            
            // Create a response-like object with the expanded filename
            const mockResponse = {
                headers: {
                    get: (headerName) => {
                        if (headerName === 'X-Generated-Filename') {
                            return result.filename;
                        }
                        if (headerName === 'X-Seed') {
                            return result.seed;
                        }
                        return null;
                    }
                }
            };
            
            // Use the universal handleImageResult function
            await handleImageResult(blob, 'Image expanded successfully!', undefined, undefined, mockResponse);
            
            manualForm.classList.remove('generating');
            stopPreviewAnimation();
            
            console.log('✨ Expansion prompt:', result.expansionPrompt);
            console.log('💭 Expansion reason:', result.expansionReason);
        }
    } catch (error) {
        console.error('❌ Image expansion failed:', error);
        
        // Remove generating/streaming classes on error
        const manualForm = document.getElementById('manualForm');
        const previewContainer = document.getElementById('manualPreviewContainer');
        if (manualForm) {
            manualForm.classList.remove('generating');
            manualForm.classList.remove('streaming');
        }
        // Stop preview animation if available
        if (typeof stopPreviewAnimation === 'function') {
            stopPreviewAnimation();
        }
        
        updateGlassToastComplete(progressToastId, {
            type: 'error',
            title: 'Expansion Failed',
            message: error.message || 'Failed to expand image',
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });

        // Clear the toast ID for future expansions
        progressToastId = null;
    }
}

// Setup expansion resolution dropdown
function setupExpansionResolutionDropdown() {
    const container = document.getElementById('expansionResolutionDropdown');
    const button = document.getElementById('expansionResolutionDropdownBtn');
    const menu = document.getElementById('expansionResolutionDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        () => {
            // Render is already handled by populateExpansionResolutionDropdown
        },
        () => expansionModalData.selectedResolution,
        { preventFocusTransfer: true }
    );
}

// Setup expansion bias dropdown
function setupExpansionBiasDropdown() {
    const container = document.getElementById('expansionBiasDropdown');
    const button = document.getElementById('expansionBiasDropdownBtn');
    const menu = document.getElementById('expansionBiasDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionBiasDropdown,
        () => expansionModalData.selectedBias.toString(),
        { preventFocusTransfer: true }
    );
}

// Setup expansion model dropdown
function setupExpansionModelDropdown() {
    const container = document.getElementById('expansionModelDropdown');
    const button = document.getElementById('expansionModelDropdownBtn');
    const menu = document.getElementById('expansionModelDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionModelDropdown,
        () => document.getElementById('expansionModelInput')?.value || '',
        { preventFocusTransfer: true }
    );
}

// Setup expansion sampler dropdown
function setupExpansionSamplerDropdown() {
    const container = document.getElementById('expansionSamplerDropdown');
    const button = document.getElementById('expansionSamplerDropdownBtn');
    const menu = document.getElementById('expansionSamplerDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionSamplerDropdown,
        () => document.getElementById('expansionSamplerInput')?.value || '',
        { preventFocusTransfer: true }
    );
}

// Setup expansion noise scheduler dropdown
function setupExpansionNoiseSchedulerDropdown() {
    const container = document.getElementById('expansionNoiseSchedulerDropdown');
    const button = document.getElementById('expansionNoiseSchedulerDropdownBtn');
    const menu = document.getElementById('expansionNoiseSchedulerDropdownMenu');
    
    if (!container || !button || !menu) return;
    
    setupDropdown(
        container,
        button,
        menu,
        renderExpansionNoiseSchedulerDropdown,
        () => document.getElementById('expansionNoiseSchedulerInput')?.value || '',
        { preventFocusTransfer: true }
    );
}

// Toggle upscale indicator
function toggleExpansionUpscale() {
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    if (!upscaleToggle) return;
    
    const currentState = upscaleToggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    upscaleToggle.setAttribute('data-state', newState);
}

// Toggle AI enhancement
function toggleExpansionAI() {
    const toggle = document.getElementById('expansionAIToggle');
    const requestedContentGroup = document.getElementById('expansionRequestedContentGroup');
    
    if (!toggle) return;
    
    const currentState = toggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    toggle.setAttribute('data-state', newState);
    
    expansionModalData.enableAI = newState === 'on';
    
    // Show/hide requested content group
    if (requestedContentGroup) {
        if (newState === 'on') {
            requestedContentGroup.classList.remove('hidden');
        } else {
            requestedContentGroup.classList.add('hidden');
        }
    }
}

// Update percentage overlay for an input
function updateExpansionPercentageOverlay(input, overlay, minVal = 0) {
    if (!input || !overlay) return;
    
    const value = parseFloat(input.value) || 0;
    const percentage = Math.round(value * 100);
    overlay.textContent = `${percentage}%`;
}

// Initialize expansion modal when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Setup all dropdowns
    setupExpansionResolutionDropdown();
    setupExpansionBiasDropdown();
    setupExpansionModelDropdown();
    setupExpansionSamplerDropdown();
    setupExpansionNoiseSchedulerDropdown();
    
    // Setup close button
    const closeBtn = document.getElementById('closeExpansionModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeImageExpansionModal);
    }
    
    // Setup submit button
    const submitBtn = document.getElementById('submitExpansionBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', submitImageExpansion);
    }
    
    // Setup advanced toggle
    const advancedToggle = document.getElementById('expansionAdvancedToggle');
    if (advancedToggle) {
        advancedToggle.addEventListener('click', toggleExpansionAdvancedOptions);
    }
    
    // Setup upscale toggle
    const upscaleToggle = document.getElementById('expansionUpscaleToggle');
    if (upscaleToggle) {
        upscaleToggle.addEventListener('click', toggleExpansionUpscale);
    }
    
    // Setup reroll button
    const rerollBtn = document.getElementById('rerollExpansionBtn');
    if (rerollBtn) {
        rerollBtn.addEventListener('click', submitImageExpansionReroll);
    }
    
    // Setup auto-seed toggle
    const autoSeedToggle = document.getElementById('expansionAutoSeedToggle');
    if (autoSeedToggle) {
        autoSeedToggle.addEventListener('click', toggleAutoSeed);
    }
    
    // Setup AI toggle
    const aiToggle = document.getElementById('expansionAIToggle');
    if (aiToggle) {
        aiToggle.addEventListener('click', toggleExpansionAI);
    }
    
    // Setup wheel event listeners for numeric inputs with percentage overlays
    const rescaleInput = document.getElementById('expansionRescaleInput');
    const rescaleOverlay = document.getElementById('expansionRescaleOverlay');
    if (rescaleInput && rescaleOverlay) {
        rescaleInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const currentValue = parseFloat(this.value) || 0;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateExpansionPercentageOverlay(this, rescaleOverlay, 0);
        });
        
        rescaleInput.addEventListener('input', function() {
            updateExpansionPercentageOverlay(this, rescaleOverlay, 0);
        });
    }
    
    const noiseInput = document.getElementById('expansionNoiseInput');
    const noiseOverlay = document.getElementById('expansionNoiseOverlay');
    if (noiseInput && noiseOverlay) {
        noiseInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0;
            const newValue = Math.max(0, Math.min(0.99, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateExpansionPercentageOverlay(this, noiseOverlay, 0);
        });
        
        noiseInput.addEventListener('input', function() {
            updateExpansionPercentageOverlay(this, noiseOverlay, 0);
        });
    }
    
    // Setup wheel events for other numeric inputs
    const stepsInput = document.getElementById('expansionStepsInput');
    if (stepsInput) {
        stepsInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentValue = parseInt(this.value) || 28;
            const newValue = Math.max(1, Math.min(50, currentValue + delta));
            this.value = newValue;
        });
    }
    
    const guidanceInput = document.getElementById('expansionGuidanceInput');
    if (guidanceInput) {
        guidanceInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const currentValue = parseFloat(this.value) || 5.0;
            const newValue = Math.max(0, Math.min(10, currentValue + delta));
            this.value = newValue.toFixed(1);
        });
    }
});
