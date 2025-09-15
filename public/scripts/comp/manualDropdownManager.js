/**
 * Manual Dropdown Management System
 *
 * This file contains all functionality related to:
 * - Manual generation dropdown management (model, sampler, resolution, preset)
 * - Dropdown rendering and selection logic
 * - Dropdown state management
 *
 * Dependencies:
 * - dropdown.js (for base dropdown functionality)
 * - app.js (for data structures and utilities)
 */

// ============================================================================
// DOM ELEMENTS (MOVED FROM app.js)
// ============================================================================

// Dropdown DOM Elements - Move these from app.js
const manualResolutionDropdown = document.getElementById('manualResolutionDropdown');
const manualResolutionDropdownBtn = document.getElementById('manualResolutionDropdownBtn');
const manualResolutionDropdownMenu = document.getElementById('manualResolutionDropdownMenu');
const manualResolutionSelected = document.getElementById('manualResolutionSelected');
const manualResolutionHidden = document.getElementById('manualResolution');
const manualCustomResolution = document.getElementById('manualCustomResolution');
const manualCustomResolutionBtn = document.getElementById('manualCustomResolutionBtn');
const manualWidth = document.getElementById('manualWidth');
const manualHeight = document.getElementById('manualHeight');
const customWidth = document.getElementById('manualCustomWidth');
const customHeight = document.getElementById('manualCustomHeight');
const manualResolutionGroup = document.getElementById('manualResolutionGroup');
const customPresetDropdown = document.getElementById('customPresetDropdown');
const customPresetDropdownBtn = document.getElementById('customPresetDropdownBtn');
const customPresetDropdownMenu = document.getElementById('customPresetDropdownMenu');
const customPresetSelected = document.getElementById('customPresetSelected');
const clearPresetBtn = document.getElementById('clearPresetBtn');
const manualSamplerDropdown = document.getElementById('manualSamplerDropdown');
const manualSamplerDropdownBtn = document.getElementById('manualSamplerDropdownBtn');
const manualSamplerDropdownMenu = document.getElementById('manualSamplerDropdownMenu');
const manualSamplerSelected = document.getElementById('manualSamplerSelected');
const manualSamplerHidden = document.getElementById('manualSampler');
const manualModelDropdown = document.getElementById('manualModelDropdown');
const manualModelDropdownBtn = document.getElementById('manualModelDropdownBtn');
const manualModelDropdownMenu = document.getElementById('manualModelDropdownMenu');
const manualModelSelected = document.getElementById('manualModelSelected');
const manualModelHidden = document.getElementById('manualModel');
const manualNoiseSchedulerDropdown = document.getElementById('manualNoiseSchedulerDropdown');
const manualNoiseSchedulerDropdownBtn = document.getElementById('manualNoiseSchedulerDropdownBtn');
const manualNoiseSchedulerDropdownMenu = document.getElementById('manualNoiseSchedulerDropdownMenu');
const manualNoiseSchedulerSelected = document.getElementById('manualNoiseSchedulerSelected');
const manualNoiseSchedulerHidden = document.getElementById('manualNoiseScheduler');
const datasetDropdown = document.getElementById('datasetDropdown');
const datasetDropdownBtn = document.getElementById('datasetDropdownBtn');
const datasetDropdownMenu = document.getElementById('datasetDropdownMenu');
const datasetSelected = document.getElementById('datasetSelected');
const datasetIcon = document.getElementById('datasetIcon');
const subTogglesBtn = document.getElementById('subTogglesBtn');
const subTogglesDropdown = document.getElementById('subTogglesDropdown');
const subTogglesDropdownMenu = document.getElementById('subTogglesDropdownMenu');
const ucPresetsDropdown = document.getElementById('ucPresetsDropdown');
const ucPresetsDropdownBtn = document.getElementById('ucPresetsDropdownBtn');
const ucPresetsDropdownMenu = document.getElementById('ucPresetsDropdownMenu');
const transformationDropdown = document.getElementById('transformationDropdown');
const transformationDropdownBtn = document.getElementById('transformationDropdownBtn');
const transformationDropdownMenu = document.getElementById('transformationDropdownMenu');
const generatePresetBtn = document.getElementById('generatePresetBtn');
const manualPresetName = document.getElementById('manualPresetName');
const manualPresetDeleteBtn = document.getElementById('manualDeleteBtn');
const manualPresetToggleBtn = document.getElementById('manualPresetToggleBtn');
const manualPresetToggleText = document.getElementById('manualPresetToggleText');
const manualPresetToggleIcon = document.getElementById('manualPresetToggleIcon');
const manualPresetGroup = document.getElementById('manualPresetGroup');

// ============================================================================
// GLOBAL VARIABLES (MOVED FROM app.js)
// ============================================================================

// Dropdown variables - Move these from app.js
let manualSelectedResolution = '';
let manualSelectedSampler = '';
let manualSelectedModel = '';
let manualSelectedNoiseScheduler = '';
let selectedPreset = '';
let selectedDatasets = [];
let datasetBias = {};
let selectedUcPreset = 3; // Default to "Heavy"
let appendQuality = true;
let presetAutocompleteTimeout = null;
let currentPresetAutocompleteTarget = null;
let selectedPresetAutocompleteIndex = -1;

// ============================================================================
// MANUAL DROPDOWN MANAGEMENT CLASS
// ============================================================================

class ManualDropdownManager {
    constructor() {
        this.initialized = false;
        this.dropdowns = new Map();
        this.eventListeners = [];
    }

    /**
     * Initialize the manual dropdown manager
     */
    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.setupDropdowns();
        this.setupEventListeners();
    }

    /**
     * Set up all dropdowns
     */
    setupDropdowns() {
        // TODO: Set up all dropdowns using setupDropdown() from dropdown.js
        // Model dropdown, sampler dropdown, resolution dropdown, etc.
    }

    /**
     * Set up event listeners for dropdown management
     */
    setupEventListeners() {
        // TODO: Move event listeners from app.js setupEventListeners() function
        // Related to dropdown interactions, custom resolution, etc.
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        // TODO: Remove all event listeners
        this.eventListeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.eventListeners = [];
    }

    /**
     * Update dropdown state based on model selection
     */
    updateDropdownState() {
        // TODO: Update dropdown visibility and options based on current state
    }
}

// ============================================================================
// PLACEHOLDER FUNCTIONS (MOVED FROM app.js)
// ============================================================================

/**
 * Generate resolution options for the resolution dropdown
 * Populates the manual resolution select element with available resolutions
 *
 * @function
 * @name generateResolutionOptions
 * @description Initializes the resolution dropdown with all available resolution options from RESOLUTIONS array
 * @example
 * generateResolutionOptions(); // Populates the manual resolution dropdown
 */
function generateResolutionOptions() {
    // Populate resolutions using global RESOLUTIONS array
    manualResolution.innerHTML = '<option value="">Unchanged</option>';
    RESOLUTIONS.forEach(resolution => {
        const manualOption = document.createElement('option');
        manualOption.value = resolution.value;
        manualOption.textContent = resolution.display;
        manualResolution.appendChild(manualOption);
    });
}

/**
 * Render manual resolution dropdown options
 * @param {string} selectedVal - Currently selected resolution value
 * @function
 * @name renderManualResolutionDropdown
 * @description Renders the resolution dropdown menu with grouped options using RESOLUTION_GROUPS
 * @example
 * renderManualResolutionDropdown('normal_portrait'); // Shows resolution dropdown with normal_portrait selected
 */
function renderManualResolutionDropdown(selectedVal) {
    renderGroupedDropdown(
        manualResolutionDropdownMenu,
        RESOLUTION_GROUPS,
        selectManualResolution,
        () => closeDropdown(manualResolutionDropdownMenu, manualResolutionDropdownBtn),
        selectedVal,
        (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`,
        { preventFocusTransfer: true }
    );
}


/**
 * Select manual resolution and update UI
 * @param {string} value - Selected resolution value
 * @param {string} group - Resolution group (Normal, Large, Wallpaper, Small)
 * @param {boolean} skipPostProcess - Whether to skip post-processing steps
 * @function
 * @name selectManualResolution
 * @description Updates the selected resolution, updates UI display, and handles related functionality like cropping
 * @example
 * selectManualResolution('normal_portrait', 'Normal'); // Selects normal portrait resolution
 */
async function selectManualResolution(value, group, skipPostProcess = false) {
    manualSelectedResolution = value.toLowerCase();
    
    if (!group) {
        for (const g of RESOLUTION_GROUPS) {
            const found = g.options.find(o => o.value === value.toLowerCase());
            if (found) {
                group = g.group;
                break;
            }
        }
    }

    if (value === 'custom') {
        manualResolutionDropdown.classList.add('hidden');
        manualCustomResolution.classList.remove('hidden');
        manualCustomResolutionBtn.setAttribute('data-state', 'on');
        manualResolutionGroup.classList.add('expanded');
        // Set default values if empty
        if (!manualWidth.value) manualWidth.value = '1024';
        if (!manualHeight.value) manualHeight.value = '1024';
        // Sanitize the default values
        sanitizeCustomDimensions();
    } else {
        manualResolutionDropdown.classList.remove('hidden');
        manualCustomResolution.classList.add('hidden');
        manualCustomResolutionBtn.setAttribute('data-state', 'off');
        manualResolutionGroup.classList.remove('expanded');
    }

    // Update button display
    const groupObj = RESOLUTION_GROUPS.find(g => g.group === group);
    const optObj = groupObj ? groupObj.options.find(o => o.value === value.toLowerCase()) : null;
    if (optObj) {
        manualResolutionSelected.innerHTML = `${optObj.name}${groupObj.badge ? '<span class="custom-dropdown-badge' + (groupObj.free ? ' free-badge' : '') + '">' + groupObj.badge + '</span>' : ''}`;
    } else {
        manualResolutionSelected.textContent = 'Select resolution...';
    }
    // Sync with hidden input for compatibility
    if (manualResolutionHidden) manualResolutionHidden.value = value.toLowerCase();

    if (!skipPostProcess) {
        updateGenerateButton();
        updateManualPriceDisplay();
        
        // --- ADDED: Refresh preview image if in bias mode ---
        if (window.uploadedImageData && window.uploadedImageData.image_source && window.uploadedImageData.isBiasMode && manualModal && !manualModal.classList.contains('hidden')) {
            // Reset bias to center (2) when resolution changes
            if (imageBiasHidden != null)
                imageBiasHidden.value = '2';
            window.uploadedImageData.bias = 2;

            await cropImageToResolution();
            await refreshImageBiasState();
        }
    }
}

/**
 * Render simple dropdown with key-value pairs
 * @param {HTMLElement} menu - Dropdown menu element to populate
 * @param {Array} items - Array of items to render as options
 * @param {string} value_key - Key in items array that contains the value
 * @param {string} display_key - Key in items array that contains the display text
 * @param {Function} selectHandler - Function called when an option is selected
 * @param {Function} closeHandler - Function called to close the dropdown
 * @param {string} selectedVal - Currently selected value
 * @param {Object} options - Additional options
 * @param {boolean} options.preventFocusTransfer - Whether to prevent focus transfer on selection
 * @function
 * @name renderSimpleDropdown
 * @description Renders a simple dropdown menu with options from an array of key-value objects
 * @example
 * const samplers = [{meta: 'k_euler', display: 'Euler'}];
 * renderSimpleDropdown(menu, samplers, 'meta', 'display', selectSampler, closeDropdown, 'k_euler');
 */
function renderSimpleDropdown(menu, items, value_key, display_key, selectHandler, closeHandler, selectedVal, options = {}) {
    const preventFocusTransfer = options.preventFocusTransfer || false;
    let lastActiveElement = null;
    
    menu.innerHTML = '';
    items.forEach(item => {
        const option = document.createElement('div');
        const value = item[value_key];
        const display = item[display_key];
        option.className = 'custom-dropdown-option' + (selectedVal === value ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = value;
        option.innerHTML = `<span>${display}</span>`;
        const action = () => {
            // Store the currently active element before selecting
            if (preventFocusTransfer) {
                lastActiveElement = document.activeElement;
            }
            
            selectHandler(value);
            closeHandler();
            
            // Restore focus to the last active element if we prevented focus transfer
            if (preventFocusTransfer && lastActiveElement) {
                setTimeout(() => {
                    lastActiveElement.focus();
                }, 10);
            }
        };
        option.addEventListener('click', (e) => {
            e.preventDefault();
            action();
        });
        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });
        menu.appendChild(option);
    });
}

/**
 * Generate sampler options for the sampler dropdown
 * Populates the manual sampler select element with available samplers
 *
 * @function
 * @name generateSamplerOptions
 * @description Initializes the sampler dropdown with all available sampler options from SAMPLER_MAP array
 * @example
 * generateSamplerOptions(); // Populates the manual sampler dropdown
 */
function generateSamplerOptions() {
    // Populate sampler dropdown with display names, value=meta name
    manualSampler.innerHTML = '<option value="">Default</option>';
    SAMPLER_MAP.forEach(s => {
        const option = document.createElement('option');
        option.value = s.meta;
        option.textContent = s.display;
        manualSampler.appendChild(option);
    });
}

/**
 * Render manual sampler dropdown options
 * @param {string} selectedVal - Currently selected sampler value
 * @function
 * @name renderManualSamplerDropdown
 * @description Renders the sampler dropdown menu with options from SAMPLER_MAP
 * @example
 * renderManualSamplerDropdown('k_euler'); // Shows sampler dropdown with k_euler selected
 */
function renderManualSamplerDropdown(selectedVal) {
    renderSimpleDropdown(manualSamplerDropdownMenu, SAMPLER_MAP, 'meta', 'display', selectManualSampler, closeManualSamplerDropdown, selectedVal, { preventFocusTransfer: true });
}

/**
 * Select manual sampler and update UI
 * @param {string} value - Selected sampler value (meta name)
 * @function
 * @name selectManualSampler
 * @description Updates the selected sampler, updates UI display, and handles auto-selection of noise scheduler
 * @example
 * selectManualSampler('k_dpmpp_2m'); // Selects DPM++ 2M sampler and auto-selects exponential noise scheduler
 */
function selectManualSampler(value) {
    manualSelectedSampler = value;
    const s = SAMPLER_MAP.find(s => s.meta.toLowerCase() === value.toLowerCase());
    if (s) {
        manualSamplerSelected.innerHTML = [
            `<span class="custom-dropdown-text small-viewport">${s.display_short || s.display}</span>`,
            `<span class="custom-dropdown-text full-viewport">${s.display_short_full || s.display}</span>`,
            s.badge ? `<span class="custom-dropdown-badge small-viewport ${s.badge_class}">${s.badge}</span>` : '',
            s.full_badge ? `<span class="custom-dropdown-badge full-viewport ${s.badge_class}">${s.full_badge}</span>` : ''
        ].filter(Boolean).join(' ');
    } else {
        manualSamplerSelected.innerHTML = 'Select sampler...';
    }
    if (manualSamplerHidden) manualSamplerHidden.value = value;

    // Auto-set noise scheduler based on sampler selection
    if (value === 'k_dpmpp_2m') {
        selectManualNoiseScheduler('exponential');
    } else {
        selectManualNoiseScheduler('karras');
    }

    if (typeof updateGenerateButton === 'function') updateGenerateButton();
}

/**
 * Close manual sampler dropdown
 * @function
 * @name closeManualSamplerDropdown
 * @description Closes the manual sampler dropdown menu using the core dropdown system
 * @example
 * closeManualSamplerDropdown(); // Closes the sampler dropdown menu
 */
function closeManualSamplerDropdown() {
    closeDropdown(manualSamplerDropdownMenu, manualSamplerDropdownBtn);
}

/**
 * Generate noise scheduler options for the noise scheduler dropdown
 * Populates the manual noise scheduler select element with available noise schedulers
 *
 * @function
 * @name generateNoiseSchedulerOptions
 * @description Initializes the noise scheduler dropdown with all available options from NOISE_MAP array
 * @example
 * generateNoiseSchedulerOptions(); // Populates the manual noise scheduler dropdown
 */
function generateNoiseSchedulerOptions() {
    // Populate noise scheduler dropdown with display names, value=meta name
    manualNoiseScheduler.innerHTML = '<option value="">Default</option>';
    NOISE_MAP.forEach(n => {
        const option = document.createElement('option');
        option.value = n.meta;
        option.textContent = n.display;
        manualNoiseScheduler.appendChild(option);
    });
}

/**
 * Render manual noise scheduler dropdown options
 * @param {string} selectedVal - Currently selected noise scheduler value
 * @function
 * @name renderManualNoiseSchedulerDropdown
 * @description Renders the noise scheduler dropdown menu with options from NOISE_MAP
 * @example
 * renderManualNoiseSchedulerDropdown('karras'); // Shows noise scheduler dropdown with karras selected
 */
function renderManualNoiseSchedulerDropdown(selectedVal) {
    renderSimpleDropdown(manualNoiseSchedulerDropdownMenu, NOISE_MAP, 'meta', 'display', selectManualNoiseScheduler, closeManualNoiseSchedulerDropdown, selectedVal, { preventFocusTransfer: true });
}

/**
 * Select manual noise scheduler and update UI
 * @param {string} value - Selected noise scheduler value (meta name)
 * @function
 * @name selectManualNoiseScheduler
 * @description Updates the selected noise scheduler and updates UI display and price calculation
 * @example
 * selectManualNoiseScheduler('karras'); // Selects Karras noise scheduler
 */
function selectManualNoiseScheduler(value) {
    manualSelectedNoiseScheduler = value;
    const n = NOISE_MAP.find(n => n.meta.toLowerCase() === value.toLowerCase());
    if (n) {
      manualNoiseSchedulerSelected.textContent = n.display;
    } else {
      manualNoiseSchedulerSelected.textContent = 'Select noise scheduler...';
    }
    if (manualNoiseSchedulerHidden) manualNoiseSchedulerHidden.value = value;
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
    // Update price display
    updateManualPriceDisplay();
}

/**
 * Close manual noise scheduler dropdown
 * @function
 * @name closeManualNoiseSchedulerDropdown
 * @description Closes the manual noise scheduler dropdown menu using the core dropdown system
 * @example
 * closeManualNoiseSchedulerDropdown(); // Closes the noise scheduler dropdown menu
 */
function closeManualNoiseSchedulerDropdown() {
    closeDropdown(manualNoiseSchedulerDropdownMenu, manualNoiseSchedulerDropdownBtn);
}

/**
 * Generate model options for the model dropdown
 * Populates the manual model select element with available models from optionsData
 *
 * @function
 * @name generateModelOptions
 * @description Initializes the model dropdown with all available model options from window.optionsData.models
 * @example
 * generateModelOptions(); // Populates the manual model dropdown
 */
function generateModelOptions() {
    manualModel.innerHTML = '<option value="">Select model...</option>';
    Object.keys(window.optionsData?.models || {}).forEach(model => {
        const option = document.createElement('option');
        option.value = model.toLowerCase(); // Use lowercase to match config
        option.textContent = window.optionsData?.models[model]; // Use pretty display name
        manualModel.appendChild(option);
    });   
}

/**
 * Render manual model dropdown options
 * @param {string} selectedVal - Currently selected model value
 * @function
 * @name renderManualModelDropdown
 * @description Renders the model dropdown menu with grouped options using modelGroups
 * @example
 * renderManualModelDropdown('v4_5'); // Shows model dropdown with v4_5 selected
 */
function renderManualModelDropdown(selectedVal) {
    renderGroupedDropdown(manualModelDropdownMenu, modelGroups, selectManualModel, closeManualModelDropdown, selectedVal, (opt, group) => `<span>${opt.name}</span>`, { preventFocusTransfer: true });
}

/**
 * Select manual model - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
function selectManualModel(value, group, preventPropagation = false) {
    manualSelectedModel = value;

    // If group is not provided, find it automatically
    if (!group) {
      for (const g of modelGroups) {
        const found = g.options.find(o => o.value === value.toLowerCase());
        if (found) {
          group = g.group;
          break;
        }
      }
    }

    // Update button display
    const groupObj = modelGroups.find(g => g.group === group);
    const optObj = groupObj ? groupObj.options.find(o => o.value === value.toLowerCase()) : null;
    if (optObj) {
      manualModelSelected.innerHTML = [
          `<span class="custom-dropdown-text small-viewport">${optObj.display}</span>`,
          `<span class="custom-dropdown-text full-viewport">${optObj.display_full}</span>`,
          optObj.badge ? `<span class="custom-dropdown-badge small-viewport ${optObj.badge_class}">${optObj.badge}</span>` : '',
          optObj.badge_full ? `<span class="custom-dropdown-badge full-viewport ${optObj.badge_class}">${optObj.badge_full}</span>` : ''
      ].filter(Boolean).join(' ');
    } else {
      manualModelSelected.textContent = 'Select model...';
    }

    // Sync with hidden input for compatibility
    if (manualModelHidden) manualModelHidden.value = value.toLowerCase();

    if (preventPropagation) return;
    // Update UI visibility based on model selection
    updateV3ModelVisibility();

    // Trigger any listeners (e.g., updateGenerateButton or manual form update)
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
    updateManualPriceDisplay();

    // Refresh reference browser for model changes
    refreshReferenceBrowserForModelChange();
}

/**
 * Close manual model dropdown
 * @function
 * @name closeManualModelDropdown
 * @description Closes the manual model dropdown menu using the core dropdown system
 * @example
 * closeManualModelDropdown(); // Closes the model dropdown menu
 */
function closeManualModelDropdown() {
    closeDropdown(manualModelDropdownMenu, manualModelDropdownBtn);
}

/**
 * Render transformation dropdown options
 * @param {string} selectedVal - Currently selected transformation value
 * @function
 * @name renderTransformationDropdown
 * @description Renders the transformation dropdown menu with options based on available image data and transformation types
 * @example
 * renderTransformationDropdown('reroll'); // Shows transformation dropdown with reroll option available
 */
function renderTransformationDropdown(selectedVal) {
    const hasValidImage = window.currentEditImage && window.currentEditMetadata;
    const hasBaseImage = hasValidImage && (
        window.currentEditMetadata.original_filename ||
        (window.currentEditImage.filename || window.currentEditImage.original)
    );

    // Check if this is an img2img (has base image)
    const isImg2Img = hasValidImage && window.currentEditMetadata.base_image === true;

    // Show reroll button only if there's a base image available (for img2img)
    const shouldShowReroll = hasValidImage && isImg2Img;

    // Get all option elements
    const rerollOption = transformationDropdownMenu.querySelector('[data-value="reroll"]');
    const variationOption = transformationDropdownMenu.querySelector('[data-value="variation"]');
    const browseOption = transformationDropdownMenu.querySelector('[data-value="browse"]');
    const uploadOption = transformationDropdownMenu.querySelector('[data-value="upload"]');

    // Show/hide options based on availability
    if (rerollOption) {
        rerollOption.classList.toggle('hidden', !shouldShowReroll);
        rerollOption.classList.toggle('selected', selectedVal === 'reroll');
    }

    if (variationOption) {
        variationOption.classList.toggle('hidden', !hasBaseImage);
        variationOption.classList.toggle('selected', selectedVal === 'variation');
    }

    if (browseOption) {
        browseOption.classList.toggle('selected', selectedVal === 'browse');
    }

    if (uploadOption) {
        uploadOption.classList.toggle('selected', selectedVal === 'upload');
    }
}

/**
 * Select transformation and handle the action
 * @param {string} value - Selected transformation value ('browse', 'upload', 'reroll', 'variation')
 * @function
 * @name selectTransformation
 * @description Handles the selection of transformation options and triggers appropriate actions
 * @example
 * selectTransformation('browse'); // Opens the cache browser
 * selectTransformation('reroll'); // Applies reroll transformation
 */
function selectTransformation(value) {
    // Handle specific actions
    switch(value) {
        case 'browse':
            showCacheBrowser();
            break;
        case 'upload':
            // Determine upload type based on current state
            const hasValidImage = window.currentEditImage && window.currentEditMetadata;
            const hasBaseImage = hasValidImage && (
                window.currentEditMetadata.original_filename ||
                (window.currentEditImage.filename || window.currentEditImage.original)
            );
            
            if (window.showUnifiedUploadModal) {
                // Set the appropriate mode before opening the modal
                if (hasBaseImage) {
                    // If there's already a base image, upload as vibe reference
                    window.unifiedUploadCurrentMode = 'vibe';
                } else {
                    // If no base image, upload as base image
                    window.unifiedUploadCurrentMode = 'reference';
                }
                window.showUnifiedUploadModal();
            } else {
                showError('Upload modal not available');
            }
            // Close the transformation dropdown
            closeTransformationDropdown();
            break;
        case 'reroll':
        case 'variation':
            // Update button display for immediate actions
            const options = {
                'reroll': undefined,
                'variation': undefined
            };
            const displayText = options[value] || 'Reference';
            updateTransformationDropdownState(value, displayText);

            // Handle reroll/variation logic
            handleTransformationTypeChange(value);
            break;
    }
}

/**
 * Handle transformation type change and set up image data
 * @param {string} requestType - Type of transformation ('reroll' or 'variation')
 * @function
 * @name handleTransformationTypeChange
 * @description Processes transformation type changes, sets up uploaded image data, and prepares for img2img operations
 * @example
 * await handleTransformationTypeChange('reroll'); // Sets up reroll transformation
 */
async function handleTransformationTypeChange(requestType) {
    const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
    const saveButton = document.getElementById('manualSaveBtn');

    // Clear existing data
    window.uploadedImageData = null;
    if (variationImage) {
        variationImage.src = '';
    }
    hideImageBiasDropdown();

    // Set new state
    window.currentRequestType = requestType;

    const metadata = window.currentEditMetadata;
    const image = window.currentEditImage;
    if (!metadata || !image) return;

    let source, previewUrl, bias = 2;
    let customBias = undefined;
    if (requestType === 'reroll') {
        if (!metadata.image_source) return; // Should not happen if button hidden
        source = metadata.image_source;
        bias = typeof metadata.image_bias === 'number' ? metadata.image_bias : 2;
        customBias = typeof metadata.image_bias === 'object' ? metadata.image_bias : undefined;
        const [type, id] = source.split(':');
        previewUrl = type === 'file' ? `/images/${id}` : `/cache/preview/${id}.webp`;
    } else {
        const filename = image.filename || image.original;
        if (!filename) return;
        source = `file:${filename}`;
        previewUrl = `/images/${filename}`;
    }

    window.uploadedImageData = {
        image_source: source,
        width: 0, // Will be updated when image loads
        height: 0,
        bias: bias,
        image_bias: customBias,
        isBiasMode: true,
        isClientSide: false
    };

    // Load actual image dimensions
    await new Promise((resolve) => {
        const tempImg = new Image();
        tempImg.onload = () => {
            window.uploadedImageData.width = tempImg.width;
            window.uploadedImageData.height = tempImg.height;
            resolve();
        };
        tempImg.onerror = () => {
            console.warn('Failed to load image dimensions, using defaults');
            window.uploadedImageData.width = 512;
            window.uploadedImageData.height = 512;
            resolve();
        };
        tempImg.src = previewUrl;
    });

    // Show transformation section content
    if (transformationRow) {
        transformationRow.classList.add('display-image');
    }
    document.getElementById('manualImg2ImgGroup').classList.remove('hidden');

    // Update image bias orientation after setting image dimensions
    updateImageBiasOrientation();
    
    // Only crop if the image dimensions don't match the target resolution
    if (typeof cropImageToResolution === 'function') {
        cropImageToResolution();
    }
    
    updateInpaintButtonState();

    // Show bias dropdown
    renderImageBiasDropdown(bias.toString());

    // Hide preset name and save for variation
    if (presetNameGroup) presetNameGroup.classList.add('hidden');
    if (saveButton) saveButton.classList.add('hidden');

    updateUploadDeleteButtonVisibility();
}

/**
 * Open transformation dropdown
 * @function
 * @name openTransformationDropdown
 * @description Opens the transformation dropdown menu using the core dropdown system
 * @example
 * openTransformationDropdown(); // Opens the transformation dropdown menu
 */
function openTransformationDropdown() {
    openDropdown(transformationDropdownMenu, transformationDropdownBtn);
}

/**
 * Close transformation dropdown
 * @function
 * @name closeTransformationDropdown
 * @description Closes the transformation dropdown menu using the core dropdown system
 * @example
 * closeTransformationDropdown(); // Closes the transformation dropdown menu
 */
function closeTransformationDropdown() {
    closeDropdown(transformationDropdownMenu, transformationDropdownBtn);
}

/**
 * Setup transformation dropdown listeners - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
function setupTransformationDropdownListeners() {
    const options = transformationDropdownMenu.querySelectorAll('.custom-dropdown-option');

    options.forEach(option => {
        option.tabIndex = 0;

        option.addEventListener('click', (e) => {
            e.preventDefault();
            const value = option.dataset.value;
            selectTransformation(value);
            closeTransformationDropdown();
        });

        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const value = option.dataset.value;
                selectTransformation(value);
                closeTransformationDropdown();
            }
        });
    });
}

/**
 * Update transformation dropdown state - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
function updateTransformationDropdownState(type, text) {
    const transformationType = document.getElementById('transformationType');

    if (transformationType) transformationType.value = type || '';

    // Update toggle button state
    if (transformationDropdownBtn) {
        if (type) {
            transformationDropdownBtn.setAttribute('data-state', 'on');
        } else {
            transformationDropdownBtn.setAttribute('data-state', 'off');
        }
    }
}

/**
 * Render dataset dropdown options
 * @function
 * @name renderDatasetDropdown
 * @description Renders the dataset dropdown menu with bias controls for selected datasets
 * @example
 * renderDatasetDropdown(); // Shows dataset dropdown with current selections and bias controls
 */
function renderDatasetDropdown() {
    datasetDropdownMenu.innerHTML = '';
    
    const datasets = window.optionsData?.datasets || [
        { value: 'anime', display: 'Anime', sub_toggles: [] },
        { value: 'furry', display: 'Furry', sub_toggles: [] },
        { value: 'backgrounds', display: 'Backgrounds', sub_toggles: [] }
    ];

    datasets.forEach(dataset => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option dataset-dropdown-option';
        option.dataset.value = dataset.value;

        const isSelected = selectedDatasets.includes(dataset.value);
        if (isSelected) {
            option.classList.add('selected');
        }

        const biasValue = datasetBias[dataset.value] || 1.0;
        const biasDisplay = biasValue !== 1.0 ? biasValue.toFixed(1) : '1.0';

        option.innerHTML = `
            <div class="dataset-option-content">
                <div class="dataset-option-left">
                    <span class="dataset-name">${dataset.display}</span>
                    ${isSelected ? '<i class="fas fa-check dataset-check-icon"></i>' : ''}
                </div>
                <div class="dataset-option-right">
                    ${isSelected ? `
                        <div class="dataset-bias-controls">
                            <button type="button" class="dataset-bias-decrease" title="Decrease bias" data-dataset="${dataset.value}">
                                <i class="fas fa-minus"></i>
                            </button>
                            <span class="dataset-bias-value" data-dataset="${dataset.value}">${biasDisplay}</span>
                            <button type="button" class="dataset-bias-increase" title="Increase bias" data-dataset="${dataset.value}">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Add click handler for the main option (toggle selection)
        const optionLeft = option.querySelector('.dataset-option-left');
        optionLeft.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDataset(dataset.value);
        });

        // Add click handlers for bias controls (only if dataset is selected)
        if (isSelected) {
            const decreaseBtn = option.querySelector('.dataset-bias-decrease');
            const increaseBtn = option.querySelector('.dataset-bias-increase');
            const biasValueSpan = option.querySelector('.dataset-bias-value');

            decreaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                adjustDatasetBias(dataset.value, -0.1);
            });

            increaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                adjustDatasetBias(dataset.value, 0.1);
            });

            // Add wheel event for bias value span
            biasValueSpan.addEventListener('wheel', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                adjustDatasetBias(dataset.value, delta);
                
                // Add visual feedback
                biasValueSpan.classList.add('scrolling');
                setTimeout(() => {
                    biasValueSpan.classList.remove('scrolling');
                }, 200);
            });

            // Add click event for bias value span to make it more interactive
            biasValueSpan.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Optional: could add a visual feedback here
            });
        }

        datasetDropdownMenu.appendChild(option);
    });
}

/**
 * Toggle dataset selection
 * @param {string} value - Dataset value to toggle ('anime', 'furry', 'backgrounds')
 * @function
 * @name toggleDataset
 * @description Toggles the selection state of a dataset and updates the UI accordingly
 * @example
 * toggleDataset('furry'); // Toggles furry dataset selection on/off
 */
function toggleDataset(value) {
    const index = selectedDatasets.indexOf(value);
    if (index > -1) {
        selectedDatasets.splice(index, 1);
    } else {
        selectedDatasets.push(value);
    }

    // Update display
    updateDatasetDisplay();
    renderDatasetDropdown();
    updateSubTogglesButtonState();
    
    // Update prompt status icons to reflect dataset changes
    updatePromptStatusIcons();
}

/**
 * Update dataset display - MOVED FROM app.js
 * @function
 * @name updateDatasetDisplay
 * @description Updates the dataset selection display, count, and icon based on current selections
 * @example
 * updateDatasetDisplay(); // Updates dataset UI to reflect current selections
 */
function updateDatasetDisplay() {
    if (selectedDatasets.length > 1) {
        datasetSelected.classList.remove('hidden');
        datasetSelected.textContent = `${selectedDatasets.length}`;
    } else {
        datasetSelected.classList.add('hidden');
        datasetSelected.textContent = '0';
    }

    if (datasetIcon) {
        // Priority: furry > backgrounds > anime (default)
        let iconClass = 'nai-sakura'; // default (anime)
        if (selectedDatasets.includes('furry')) {
            iconClass = 'nai-paw';
        } else if (selectedDatasets.includes('backgrounds')) {
            iconClass = 'fas fa-tree';
        } else {
            iconClass = 'nai-sakura';
        }
        datasetIcon.className = iconClass;
    }

    // Update toggle state - on when more than just anime is selected
    // off when none or only anime is selected
    const datasetBtn = document.getElementById('datasetDropdownBtn');
    if (datasetBtn) {
        datasetBtn.setAttribute('data-state', selectedDatasets.length > 0 ? 'on' : 'off');
    }
    
    // Update bias value displays in the dropdown if it's open
    selectedDatasets.forEach(dataset => {
        const biasValueSpan = document.querySelector(`.dataset-bias-value[data-dataset="${dataset}"]`);
        if (biasValueSpan) {
            const biasValue = datasetBias[dataset] || 1.0;
            const displayValue = biasValue !== 1.0 ? biasValue.toFixed(1) : '1.0';
            biasValueSpan.textContent = displayValue;
        }
    });
    
    updatePromptStatusIcons();
}

/**
 * Open dataset dropdown
 * @function
 * @name openDatasetDropdown
 * @description Opens the dataset dropdown menu using the core dropdown system
 * @example
 * openDatasetDropdown(); // Opens the dataset dropdown menu
 */
function openDatasetDropdown() {
    openDropdown(datasetDropdownMenu, datasetDropdownBtn);
}

/**
 * Close dataset dropdown
 * @function
 * @name closeDatasetDropdown
 * @description Closes the dataset dropdown menu using the core dropdown system
 * @example
 * closeDatasetDropdown(); // Closes the dataset dropdown menu
 */
function closeDatasetDropdown() {
    closeDropdown(datasetDropdownMenu, datasetDropdownBtn);
}

/**
 * Adjust dataset bias value
 * @param {string} dataset - Dataset name to adjust bias for
 * @param {number} delta - Amount to adjust bias by (e.g., 0.1, -0.1)
 * @function
 * @name adjustDatasetBias
 * @description Adjusts the bias value for a selected dataset within valid range (-3 to 5)
 * @example
 * adjustDatasetBias('furry', 0.1); // Increases furry dataset bias by 0.1
 * adjustDatasetBias('anime', -0.1); // Decreases anime dataset bias by 0.1
 */
function adjustDatasetBias(dataset, delta) {
    const currentValue = datasetBias[dataset] || 1.0;
    const newValue = Math.max(-3, Math.min(5, currentValue + delta));
    datasetBias[dataset] = Math.round(newValue * 10) / 10; // Round to 1 decimal place
    
    // Update the bias value display in the dropdown
    const biasValueSpan = document.querySelector(`.dataset-bias-value[data-dataset="${dataset}"]`);
    if (biasValueSpan) {
        const displayValue = datasetBias[dataset] !== 1.0 ? datasetBias[dataset].toFixed(1) : '1.0';
        biasValueSpan.textContent = displayValue;
    }
    
    // Update dataset display to ensure dropdown stays in sync
    updateDatasetDisplay();
}

/**
 * Render sub toggles dropdown options
 * @function
 * @name renderSubTogglesDropdown
 * @description Renders the sub-toggles dropdown menu with bias controls for selected datasets
 * @example
 * renderSubTogglesDropdown(); // Shows sub-toggle options for selected datasets
 */
function renderSubTogglesDropdown() {
    subTogglesDropdownMenu.innerHTML = '';
    
    const datasets = window.optionsData?.datasets || [];
    
    const selectedDatasetsWithToggles = datasets.filter(dataset => 
        selectedDatasets.includes(dataset.value) && dataset.sub_toggles && dataset.sub_toggles.length > 0
    );

    if (selectedDatasetsWithToggles.length === 0) {
        return;
    }

    selectedDatasetsWithToggles.forEach(dataset => {
        const datasetGroup = document.createElement('div');
        datasetGroup.className = 'sub-toggle-dataset-group';

        const datasetHeader = document.createElement('div');
        datasetHeader.className = 'sub-toggle-dataset-header';
        datasetHeader.textContent = dataset.display;
        datasetGroup.appendChild(datasetHeader);

        dataset.sub_toggles.forEach(subToggle => {
            const toggleOption = document.createElement('div');
            toggleOption.className = 'custom-dropdown-option dataset-dropdown-option';
            toggleOption.dataset.dataset = dataset.value;
            toggleOption.dataset.toggle = subToggle.id;

            // Check if this toggle is enabled
            const isEnabled = window.datasetSettings && 
                            window.datasetSettings[dataset.value] && 
                            window.datasetSettings[dataset.value][subToggle.id] ?
                            window.datasetSettings[dataset.value][subToggle.id].enabled :
                            (subToggle.default_enabled || false);

            if (isEnabled) {
                toggleOption.classList.add('selected');
            }

            const biasValue = (window.datasetSettings && 
                             window.datasetSettings[dataset.value] && 
                             window.datasetSettings[dataset.value][subToggle.id]) ?
                             window.datasetSettings[dataset.value][subToggle.id].bias : 
                             (subToggle.default_bias !== undefined ? subToggle.default_bias : 1.0);

            const biasDisplay = biasValue !== 1.0 ? biasValue.toFixed(1) : '1.0';

            toggleOption.innerHTML = `
                <div class="dataset-option-content">
                    <div class="dataset-option-left">
                        <span class="dataset-name">${subToggle.name}</span>
                        ${isEnabled ? '<i class="fas fa-check dataset-check-icon"></i>' : ''}
                    </div>
                    <div class="dataset-option-right">
                        ${isEnabled ? `
                            <div class="dataset-bias-controls">
                                <button type="button" class="dataset-bias-decrease" title="Decrease bias" data-dataset="${dataset.value}" data-toggle="${subToggle.id}">
                                    <i class="fas fa-minus"></i>
                                </button>
                                <span class="dataset-bias-value" data-dataset="${dataset.value}" data-toggle="${subToggle.id}">${biasDisplay}</span>
                                <button type="button" class="dataset-bias-increase" title="Increase bias" data-dataset="${dataset.value}" data-toggle="${subToggle.id}">
                                    <i class="fas fa-plus"></i>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            // Add click handler for the main option (toggle selection)
            const optionLeft = toggleOption.querySelector('.dataset-option-left');
            optionLeft.addEventListener('click', (e) => {
                    e.preventDefault();
                e.stopPropagation();
                toggleSubToggle(dataset.value, subToggle.id);
            });

            // Add click handlers for bias controls (only if toggle is enabled)
            if (isEnabled) {
                const decreaseBtn = toggleOption.querySelector('.dataset-bias-decrease');
                const increaseBtn = toggleOption.querySelector('.dataset-bias-increase');
                const biasValueSpan = toggleOption.querySelector('.dataset-bias-value');

                decreaseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    adjustSubToggleBias(dataset.value, subToggle.id, -0.1);
                });

                increaseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    adjustSubToggleBias(dataset.value, subToggle.id, 0.1);
                });

                // Add wheel event for bias value span
                biasValueSpan.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    adjustSubToggleBias(dataset.value, subToggle.id, delta);
                    
                    // Add visual feedback
                    biasValueSpan.classList.add('scrolling');
                    setTimeout(() => {
                        biasValueSpan.classList.remove('scrolling');
                    }, 200);
                });
            }

            datasetGroup.appendChild(toggleOption);
        });

        subTogglesDropdownMenu.appendChild(datasetGroup);
    });
}


/**
 * Toggle sub-toggle selection
 * @param {string} dataset - Dataset name containing the sub-toggle
 * @param {string} subToggleId - Sub-toggle identifier to toggle
 * @function
 * @name toggleSubToggle
 * @description Toggles the selection state of a dataset sub-toggle and updates the UI
 * @example
 * toggleSubToggle('furry', 'cute'); // Toggles the 'cute' sub-toggle for furry dataset
 */
function toggleSubToggle(dataset, subToggleId) {
    // Initialize window.datasetSettings if needed
                    if (!window.datasetSettings) window.datasetSettings = {};
                    if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};
    
    const subToggle = window.optionsData?.datasets?.find(d => d.value === dataset)?.sub_toggles?.find(t => t.id === subToggleId);
    if (!subToggle) return;

    // If the setting doesn't exist, create it with the opposite of default_enabled
    // This ensures the first click toggles from the default state to the opposite
    if (!window.datasetSettings[dataset][subToggleId]) {
        const newEnabledState = !(subToggle.default_enabled || false);
        window.datasetSettings[dataset][subToggleId] = {
            enabled: newEnabledState,
            bias: subToggle.default_bias !== undefined ? subToggle.default_bias : 1.0,
                            value: subToggle.value
                        };
    } else {
        // If it exists, just toggle the current state
        const currentState = window.datasetSettings[dataset][subToggleId].enabled;
        window.datasetSettings[dataset][subToggleId].enabled = !currentState;
    }

    renderSubTogglesDropdown();
    updateSubTogglesButtonState();
}

/**
 * Adjust sub-toggle bias value
 * @param {string} dataset - Dataset name containing the sub-toggle
 * @param {string} subToggleId - Sub-toggle identifier to adjust
 * @param {number} delta - Amount to adjust bias by (e.g., 0.1, -0.1)
 * @function
 * @name adjustSubToggleBias
 * @description Adjusts the bias value for a dataset sub-toggle within valid range (-3 to 5)
 * @example
 * adjustSubToggleBias('furry', 'cute', 0.1); // Increases cute sub-toggle bias by 0.1
 */
function adjustSubToggleBias(dataset, subToggleId, delta) {
                    if (!window.datasetSettings) window.datasetSettings = {};
                    if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};
    if (!window.datasetSettings[dataset][subToggleId]) {
        const subToggle = window.optionsData?.datasets?.find(d => d.value === dataset)?.sub_toggles?.find(t => t.id === subToggleId);
        if (!subToggle) return;
        
        window.datasetSettings[dataset][subToggleId] = {
            enabled: true, // If user is adjusting bias, they want it enabled
            bias: subToggle.default_bias !== undefined ? subToggle.default_bias : 1.0,
                            value: subToggle.value
                        };
                    }

    const currentBias = window.datasetSettings[dataset][subToggleId].bias;
    const newBias = Math.max(-3, Math.min(5, currentBias + delta));
    window.datasetSettings[dataset][subToggleId].bias = newBias;

    renderSubTogglesDropdown();
    updateSubTogglesButtonState();
}

/**
 * Update sub toggles button state - MOVED FROM app.js
 * @function
 * @name updateSubTogglesButtonState
 * @description Updates the sub-toggles button state based on dataset selections and enabled sub-toggles
 * @example
 * updateSubTogglesButtonState(); // Updates sub-toggles button appearance based on current state
 */
function updateSubTogglesButtonState() {
    if (!subTogglesBtn) return;

    const datasets = window.optionsData?.datasets || [];
    
    const hasSubToggles = datasets.some(dataset => 
        selectedDatasets.includes(dataset.value) && 
        dataset.sub_toggles && 
        dataset.sub_toggles.length > 0
    );

    const hasEnabledToggles = datasets.some(dataset => 
        selectedDatasets.includes(dataset.value) && 
        dataset.sub_toggles && 
        dataset.sub_toggles.some(subToggle => 
            window.datasetSettings && 
            window.datasetSettings[dataset.value] && 
            window.datasetSettings[dataset.value][subToggle.id] &&
            window.datasetSettings[dataset.value][subToggle.id].enabled
        )
    );

    // Check if any enabled sub toggles have extreme bias values (over 1.5 or under 1.0)
    const hasExtremeBias = datasets.some(dataset => 
        selectedDatasets.includes(dataset.value) && 
        dataset.sub_toggles && 
        dataset.sub_toggles.some(subToggle => {
            if (!window.datasetSettings || 
                !window.datasetSettings[dataset.value] || 
                !window.datasetSettings[dataset.value][subToggle.id] ||
                !window.datasetSettings[dataset.value][subToggle.id].enabled) {
                return false;
            }
            
            const bias = window.datasetSettings[dataset.value][subToggle.id].bias;
            return bias > 1.5 || bias < 1.0;
        })
    );

    // Set button state based on conditions
    let buttonState = 'off';
    if (hasEnabledToggles) {
        buttonState = hasExtremeBias ? 'onhigh' : 'on';
    }

    subTogglesBtn.setAttribute('data-state', buttonState);
    subTogglesDropdown.classList.toggle('hidden', !hasSubToggles);
    
    // If the button is now visible, render the dropdown content
    if (hasSubToggles && !subTogglesBtn.classList.contains('hidden')) {
        renderSubTogglesDropdown();
    }
}

/**
 * Open sub toggles dropdown
 * @function
 * @name openSubTogglesDropdown
 * @description Opens the sub-toggles dropdown menu using the core dropdown system
 * @example
 * openSubTogglesDropdown(); // Opens the sub-toggles dropdown menu
 */
function openSubTogglesDropdown() {
    openDropdown(subTogglesDropdownMenu, subTogglesBtn);
}

/**
 * Close sub toggles dropdown
 * @function
 * @name closeSubTogglesDropdown
 * @description Closes the sub-toggles dropdown menu using the core dropdown system
 * @example
 * closeSubTogglesDropdown(); // Closes the sub-toggles dropdown menu
 */
function closeSubTogglesDropdown() {
    closeDropdown(subTogglesDropdownMenu, subTogglesBtn);
}

/**
 * Toggle quality preset
 * @function
 * @name toggleQuality
 * @description Toggles the quality preset on/off and updates the UI state
 * @example
 * toggleQuality(); // Toggles quality preset between on/off states
 */
function toggleQuality() {
    const currentState = qualityToggleBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';

    qualityToggleBtn.setAttribute('data-state', newState);
    appendQuality = newState === 'on';
    updatePromptStatusIcons();
}

/**
 * Render UC presets dropdown - MOVED FROM app.js
 * @function
 * @name renderUcPresetsDropdown
 * @description Renders the UC (Undesired Content) presets dropdown menu with available levels
 * @example
 * renderUcPresetsDropdown(); // Shows UC preset options (None, Human Focus, Light, Heavy)
 */
function renderUcPresetsDropdown() {
    ucPresetsDropdownMenu.innerHTML = '';
    [
        { value: 0, display: 'None' },
        { value: 1, display: 'Human Focus' },
        { value: 2, display: 'Light' },
        { value: 3, display: 'Heavy' }
    ].forEach(preset => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.dataset.value = preset.value;

        if (preset.value === selectedUcPreset) {
            option.classList.add('selected');
        }

        option.innerHTML = `<span>${preset.display}</span>`;

        option.addEventListener('click', (e) => {
            e.preventDefault();
            selectUcPreset(preset.value);
            closeUcPresetsDropdown();
        });

        ucPresetsDropdownMenu.appendChild(option);
    });
}

/**
 * Select UC preset - MOVED FROM app.js
 * @param {number} value - UC preset level (0=None, 1=Human Focus, 2=Light, 3=Heavy)
 * @function
 * @name selectUcPreset
 * @description Updates the selected UC preset and updates the UI state and prompt status icons
 * @example
 * selectUcPreset(3); // Selects 'Heavy' UC preset
 */
function selectUcPreset(value) {
    selectedUcPreset = value;

    // Update UC boxes visual state
    const ucBoxes = document.querySelector('#manualModal .uc-boxes');
    if (ucBoxes) {
        ucBoxes.setAttribute('data-uc-level', value.toString());
    }

    // Update toggle state - on when UC preset > 0
    const ucPresetsBtn = document.querySelector('#manualModal #ucPresetsDropdownBtn');
    if (ucPresetsBtn) { 
        ucPresetsBtn.setAttribute('data-state', value > 0 ? 'on' : 'off');
    }
    updatePromptStatusIcons();
}

/**
 * Open UC presets dropdown
 * @function
 * @name openUcPresetsDropdown
 * @description Opens the UC presets dropdown menu using the core dropdown system
 * @example
 * openUcPresetsDropdown(); // Opens the UC presets dropdown menu
 */
function openUcPresetsDropdown() {
    openDropdown(ucPresetsDropdownMenu, ucPresetsDropdownBtn);
}

/**
 * Close UC presets dropdown
 * @function
 * @name closeUcPresetsDropdown
 * @description Closes the UC presets dropdown menu using the core dropdown system
 * @example
 * closeUcPresetsDropdown(); // Closes the UC presets dropdown menu
 */
function closeUcPresetsDropdown() {
    closeDropdown(ucPresetsDropdownMenu, ucPresetsDropdownBtn);
}

/**
 * Process resolution value - MOVED FROM app.js
 * @param {string} resolutionValue - Resolution value to process (may include 'custom_' prefix)
 * @returns {Object} Object with width, height, and isCustom properties
 * @function
 * @name processResolutionValue
 * @description Processes a resolution value, handling both standard and custom resolution formats
 * @example
 * const result = processResolutionValue('custom_1024x768');
 * // Returns: { width: 1024, height: 768, isCustom: true }
 */
function processResolutionValue(resolutionValue) {
    // Check if this is a custom resolution
    if (resolutionValue && resolutionValue.startsWith('custom_')) {
        const dimensions = resolutionValue.replace('custom_', '');
        const [width, height] = dimensions.split('x').map(Number);
        return { width, height, isCustom: true };
    }
    return { resolution: resolutionValue, isCustom: false };
}

/**
 * Sanitize custom dimensions - MOVED FROM app.js
 * @function
 * @name sanitizeCustomDimensions
 * @description Sanitizes and corrects custom width/height dimensions within valid ranges
 * @example
 * sanitizeCustomDimensions(); // Sanitizes current custom dimensions in input fields
 */
function sanitizeCustomDimensions() {
    if (manualSelectedResolution === 'custom' && manualWidth && manualHeight) {
      const rawW = manualWidth.value;
      const rawH = manualHeight.value;
  
      // Only sanitize if both inputs have values
      if (rawW && rawH) {
        // Get step value from the manual steps input
        //const step = parseInt(manualSteps.value) || 1;
  
        const result = correctDimensions(rawW, rawH, {
          //step: step
        });
  
        // Update the input values with sanitized values
        manualWidth.value = result.width;
        manualHeight.value = result.height;
  
        // Show feedback if a dimension was adjusted
        if (result.changed) {
          let message = '';
  
          if (result.reason === 'max_area') {
            message = `${result.changed.toLocaleUpperCase()} was reduced to ${result.changed === 'width' ? result.width : result.height} (Maximum Area Limit)`;
          } else if (result.reason === 'min_limit') {
            message = `${result.changed.toLocaleUpperCase()} was increased to ${result.changed === 'width' ? result.width : result.height} (Minimum Value)`;
          } else if (result.reason === 'max_limit') {
            message = `${result.changed.toLocaleUpperCase()} was reduced to ${result.changed === 'width' ? result.width : result.height} (Maximum Value)`;
          } else if (result.reason === 'step_snap') {
            message = `${result.changed.toLocaleUpperCase()} was snapped to ${result.changed === 'width' ? result.width : result.height} (Step Clamp)`;
          } else if (result.reason === 'clamped_and_snapped') {
            message = `${result.changed.toLocaleUpperCase()} was clamped to ${result.changed === 'width' ? result.width : result.height} (Limits and Step Clamp)`;
          } else {
            message = `${result.changed.toLocaleUpperCase()} was clamped to ${result.changed === 'width' ? result.width : result.height}`;
          }
          showGlassToast('warning', null, message);
        }
  
        // Update the hidden resolution value
        updateCustomResolutionValue();
        
        // Use debounced cropping for custom dimension changes to prevent excessive CPU usage
        if (typeof debouncedCropImageToResolution === 'function') {
          debouncedCropImageToResolution();
        }
      }
    }
}

/**
 * Update custom resolution value - MOVED FROM app.js
 * @function
 * @name updateCustomResolutionValue
 * @description Updates the hidden resolution field with sanitized custom dimensions
 * @example
 * await updateCustomResolutionValue(); // Updates hidden field with current custom dimensions
 */
async function updateCustomResolutionValue() {
    if (manualSelectedResolution === 'custom' && manualWidth && manualHeight) {
        const rawW = manualWidth.value;
        const rawH = manualHeight.value;

        // Only update if both inputs have values
        if (rawW && rawH) {
            // Get step value from the manual steps input
            const step = parseInt(manualSteps.value) || 1;

            const result = correctDimensions(rawW, rawH, {
                step: step
            });

            // Store sanitized custom dimensions in the hidden field as a special format
            manualResolutionHidden.value = `custom_${result.width}x${result.height}`;

            // --- ADDED: Refresh preview image if in bias mode ---
            if (window.uploadedImageData && window.uploadedImageData.isBiasMode) {
                // Reset bias to center (2) when resolution changes
                const resetBias = 2;
                if (imageBiasHidden != null) {
                    imageBiasHidden.value = resetBias.toString();
                }
                window.uploadedImageData.bias = resetBias;

                // Re-crop and update preview with reset bias
                await cropImageToResolution();

                // Re-render the dropdown options to reflect new resolution and reset bias
                await renderImageBiasDropdown(resetBias.toString());
            }
            updateImageBiasOrientation();
        }
    }
}

/**
 * Render custom preset dropdown - MOVED FROM app.js
 * @param {string} selectedVal - Currently selected preset value
 * @function
 * @name renderCustomPresetDropdown
 * @description Renders the custom preset dropdown menu with all available presets and their icons
 * @example
 * await renderCustomPresetDropdown('preset:My Preset'); // Shows preset dropdown with 'My Preset' selected
 */
async function renderCustomPresetDropdown(selectedVal) {
    if (!customPresetDropdownMenu) return;
    customPresetDropdownMenu.innerHTML = '';

    // Use global presets loaded from /options
    if (Array.isArray(window.optionsData.presets) && window.optionsData.presets.length > 0) {
        for (const preset of window.optionsData.presets) {
            try {
                // Skip invalid presets
                if (!preset || !preset.name) {
                    console.warn('Skipping invalid preset:', preset);
                    continue;
                }
                
                const option = document.createElement('div');
                option.className = 'custom-dropdown-option' + (selectedVal === `preset:${preset.name}` ? ' selected' : '');
                option.tabIndex = 0;
                option.dataset.value = `preset:${preset.name}`;
                option.dataset.type = 'preset';
                
                // Create compact preset option with same icons as createPresetItem
                const presetName = document.createElement('div');
                presetName.className = 'preset-name';
                presetName.textContent = preset.name;
                
                const presetIcons = document.createElement('div');
                presetIcons.className = 'preset-icons';
                
                // Paid requests
                if (preset.allow_paid === true) {
                    const icon = document.createElement('i');
                    icon.className = 'nai-anla';
                    icon.title = 'Paid Requests Enabled';
                    presetIcons.appendChild(icon);
                }
                
                // Character prompts
                if (preset.character_prompts) {
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-users';
                    icon.title = `${preset.character_prompts} Character Prompt${preset.character_prompts > 1 ? 's' : ''}`;
                    presetIcons.appendChild(icon);
                    
                    // Uses Character Coordinates
                    if (preset.use_coords) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-location-crosshairs';
                        icon.title = 'Using Character Coordinates';
                        presetIcons.appendChild(icon);
                    }
                }
                
                // Upscale
                if (preset.upscale === true) {
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-high-definition';
                    icon.title = 'Upscale enabled';
                    presetIcons.appendChild(icon);
                }
                
                // Image to image
                if (preset.image || preset.image_source) {
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-image';
                    icon.title = 'Image to Image';
                    presetIcons.appendChild(icon);

                    // Image Bias
                    if (preset.image_bias) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-crop';
                        icon.title = 'Image Bias';
                        presetIcons.appendChild(icon);
                    }
                }
                
                
                // Inpaint
                if ((preset.image || preset.image_source) && preset.mask_compressed) {
                    const icon = document.createElement('i');
                    icon.className = 'nai-inpaint';
                    icon.title = 'Selective Masking (Inpaint)';
                    presetIcons.appendChild(icon);
                } else 
                // Vibe transfer
                if (preset.vibe_transfer) {
                    const icon = document.createElement('i');
                    icon.className = 'nai-vibe-transfer';
                    icon.title = `${preset.vibe_transfer} Vibe Transfer${preset.vibe_transfer > 1 ? 's' : ''}`;
                    presetIcons.appendChild(icon);
                }
                
                // Variety
                if (preset.variety === true) {
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-sparkle';
                    icon.title = 'Variety+ Enabled';
                    presetIcons.appendChild(icon);
                }

                // Dataset info (priority: furry > backgrounds > anime)
                const datasetIcon = document.createElement('i');
                if (preset.dataset_config && preset.dataset_config.include && Array.isArray(preset.dataset_config.include) && preset.dataset_config.include.length > 0) {
                    
                    if (preset.dataset_config.include.includes('furry')) {
                        datasetIcon.className = 'nai-paw';
                    } else if (preset.dataset_config.include.includes('backgrounds')) {
                        datasetIcon.className = 'fas fa-tree';
                    } else {
                        datasetIcon.className = 'nai-sakura';
                    }
                } else {
                    datasetIcon.className = 'nai-sakura';
                }
                datasetIcon.title = 'Dataset enabled';
                presetIcons.appendChild(datasetIcon);
                
                // Quality preset info
                if (preset.append_quality === true) {
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-crown';
                    icon.title = 'Quality Preset Enabled';
                    presetIcons.appendChild(icon);
                }
                
                // UC boxes
                const boxes = document.createElement('div');
                boxes.className = 'uc-boxes';
                if (preset.append_uc !== undefined && preset.append_uc !== null) {
                    boxes.dataset.ucLevel = preset.append_uc.toString();
                } else {
                    boxes.dataset.ucLevel = '0';
                }
                for (let i = 1; i <= 3; i++) {
                    const box = document.createElement('div');
                    box.className = 'uc-box';
                    box.dataset.level = i.toString();
                    boxes.appendChild(box);
                }
                presetIcons.appendChild(boxes);
                
                // Create two-row layout
                const presetContent = document.createElement('div');
                presetContent.className = 'preset-option-content-two-rows';
                
                // First row: name only
                const firstRow = document.createElement('div');
                firstRow.className = 'preset-option-row-1';
                firstRow.appendChild(presetName);
                
                // Second row: model/resolution on left, icons on right
                const secondRow = document.createElement('div');
                secondRow.className = 'preset-option-row-2';
                
                // Left side: model and resolution info
                const leftSide = document.createElement('div');
                leftSide.className = 'preset-option-left';
                
                // Model info
                const modelSpan = document.createElement('span');
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
                    if (optObj.badge_full) {
                        modelSpan.innerHTML = [
                            `<span>${optObj.display}</span>`,
                            `<span>${optObj.badge_full}</span>`,
                        ].filter(Boolean).join(' ');
                    } else if (optObj.badge) {
                        modelSpan.innerHTML = [
                            `<span>${optObj.display}</span>`,
                            `<span>${optObj.badge}</span>`,
                        ].filter(Boolean).join(' ');
                    } else {
                        modelSpan.textContent = preset.model || 'V4.5?';
                    }
                    modelSpan.className = `preset-model ${optObj.badge_class}`;
                } else {
                    modelSpan.textContent = preset.model || 'V4.5?';
                    modelSpan.className = 'preset-model';
                }
                leftSide.appendChild(modelSpan);
                
                // Resolution info
                const resSpan = document.createElement('span');
                resSpan.className = 'preset-resolution';
    
                // Get proper resolution display name and check if it's large/wallpaper
                let resolutionDisplay = (preset.resolution.toLowerCase() || 'normal_portrait?').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1));
                
                if (resolutionDisplay[0] !== 'Normal') {
                    const resolutionText = document.createElement('span');
                    const resolutionTextInner = document.createElement('span');
                    if (resolutionDisplay[0] === 'Large' || resolutionDisplay[0] === 'Wallpaper') {
                        const dollarIcon = document.createElement('i');
                        dollarIcon.className = 'fas fa-dollar-sign';
                        dollarIcon.style.fontSize = '0.8em';
                        resolutionText.appendChild(dollarIcon);
                    }
                    resolutionTextInner.textContent = resolutionDisplay[0];
                    resolutionText.appendChild(resolutionTextInner);
                    resSpan.appendChild(resolutionText);
                    const resolutionText2 = document.createElement('span');
                    resolutionText2.textContent = resolutionDisplay[1];
                    resSpan.appendChild(resolutionText2);
                } else {
                    resSpan.textContent = resolutionDisplay[1];
                }
                
                leftSide.appendChild(resSpan);
                
                secondRow.appendChild(leftSide);
                secondRow.appendChild(presetIcons);
                
                presetContent.appendChild(firstRow);
                presetContent.appendChild(secondRow);
                
                option.appendChild(presetContent);
                
                option.addEventListener('click', (e) => {
                    e.preventDefault();
                    selectCustomPreset(`preset:${preset.name}`);
                    closeCustomPresetDropdown();
                });
                option.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectCustomPreset(`preset:${preset.name}`);
                        closeCustomPresetDropdown();
                    }
                });
                customPresetDropdownMenu.appendChild(option);
            } catch (error) {
                console.error('Error processing preset:', preset?.name || 'unknown', error);
                continue;
            }
        }
    }
}

/**
 * Select custom preset - MOVED FROM app.js
 * @param {string} value - Preset value to select (format: 'preset:Name' or empty)
 * @function
 * @name selectCustomPreset
 * @description Updates the selected custom preset and updates the UI accordingly
 * @example
 * selectCustomPreset('preset:My Preset'); // Selects 'My Preset'
 * selectCustomPreset(''); // Clears preset selection
 */
function selectCustomPreset(value) {
    selectedPreset = value;

    // Update button display
    if (value.startsWith('preset:')) {
        const presetName = value.replace('preset:', '');
        customPresetSelected.innerHTML = `<i class="fa-light fa-wand-magic-sparkles"></i> ${presetName}`;
        clearPresetBtn.classList.remove('hidden');
    } else {
        customPresetSelected.innerHTML = '<i class="fa-light fa-book-spells"></i> Spellbook';
        clearPresetBtn.classList.add('hidden');
    }

    // Sync with hidden select for compatibility
    presetSelect.value = value;

    // Trigger any listeners (e.g., updateGenerateButton)
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
}

/**
 * Close custom preset dropdown - MOVED FROM app.js
 * @function
 * @name closeCustomPresetDropdown
 * @description Closes the custom preset dropdown menu using the core dropdown system
 * @example
 * closeCustomPresetDropdown(); // Closes the custom preset dropdown menu
 */
function closeCustomPresetDropdown() {
    if (customPresetDropdownMenu && customPresetDropdownBtn) closeDropdown(customPresetDropdownMenu, customPresetDropdownBtn);
}


/**
 * Update transformation dropdown for vibes
 * @function
 * @name updateTransformationDropdownForVibes
 * @description Updates the transformation dropdown button state based on available vibe references
 * @example
 * updateTransformationDropdownForVibes(); // Updates button state based on current vibe references
 */
function updateTransformationDropdownForVibes() {
    const transformationDropdownBtn = document.getElementById('transformationDropdownBtn');
    if (!transformationDropdownBtn) return;

    const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
    if (!vibeReferencesContainer) return;

    const vibeItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');

    // Add active class if there are vibes present, remove it if there are none
    if (vibeItems.length > 0) {
        transformationDropdownBtn.classList.add('active');
    } else {
        transformationDropdownBtn.classList.remove('active');
    }
}

function renderManualSamplerDropdown(selectedVal) {
  renderSimpleDropdown(manualSamplerDropdownMenu, SAMPLER_MAP, 'meta', 'display', selectManualSampler, closeManualSamplerDropdown, selectedVal, { preventFocusTransfer: true });
}

function renderManualNoiseSchedulerDropdown(selectedVal) {
  renderSimpleDropdown(manualNoiseSchedulerDropdownMenu, NOISE_MAP, 'meta', 'display', selectManualNoiseScheduler, closeManualNoiseSchedulerDropdown, selectedVal, { preventFocusTransfer: true });
}

function selectManualNoiseScheduler(value) {
  manualSelectedNoiseScheduler = value;
  const n = NOISE_MAP.find(n => n.meta.toLowerCase() === value.toLowerCase());
  if (n) {
    manualNoiseSchedulerSelected.textContent = n.display;
  } else {
    manualNoiseSchedulerSelected.textContent = 'Select noise scheduler...';
  }
  if (manualNoiseSchedulerHidden) manualNoiseSchedulerHidden.value = value;
  if (typeof updateGenerateButton === 'function') updateGenerateButton();
  // Update price display
  updateManualPriceDisplay();
}

function renderManualModelDropdown(selectedVal) {
    renderGroupedDropdown(manualModelDropdownMenu, modelGroups, selectManualModel, closeManualModelDropdown, selectedVal, (opt, group) => `<span>${opt.name}</span>`, { preventFocusTransfer: true });
}

function selectManualModel(value, group, preventPropagation = false) {
  manualSelectedModel = value;
  window.manualSelectedModel = value;

  // If group is not provided, find it automatically
  if (!group) {
    for (const g of modelGroups) {
      const found = g.options.find(o => o.value === value.toLowerCase());
      if (found) {
        group = g.group;
        break;
      }
    }
  }

  // Update button display
  const groupObj = modelGroups.find(g => g.group === group);
  const optObj = groupObj ? groupObj.options.find(o => o.value === value.toLowerCase()) : null;
  if (optObj) {
    manualModelSelected.innerHTML = [
        `<span class="custom-dropdown-text small-viewport">${optObj.display}</span>`,
        `<span class="custom-dropdown-text full-viewport">${optObj.display_full}</span>`,
        optObj.badge ? `<span class="custom-dropdown-badge small-viewport ${optObj.badge_class}">${optObj.badge}</span>` : '',
        optObj.badge_full ? `<span class="custom-dropdown-badge full-viewport ${optObj.badge_class}">${optObj.badge_full}</span>` : ''
    ].filter(Boolean).join(' ');
  } else {
    manualModelSelected.textContent = 'Select model...';
  }

  // Sync with hidden input for compatibility
  if (manualModelHidden) manualModelHidden.value = value.toLowerCase();

  if (preventPropagation) return;
  // Update UI visibility based on model selection
  updateV3ModelVisibility();

  // Trigger any listeners (e.g., updateGenerateButton or manual form update)
  if (typeof updateGenerateButton === 'function') updateGenerateButton();
  updateManualPriceDisplay();
  
  // Refresh reference browser for model changes
  refreshReferenceBrowserForModelChange();
}