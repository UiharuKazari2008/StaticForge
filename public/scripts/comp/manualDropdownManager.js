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

function bindCustomDropdownOptionTouchSlop(option, fn) {
    touchSlopUtils.registerTouchSlopTracking(option);
    option.addEventListener('touchend', (e) => {
        const maxDelta = touchSlopUtils.finalizeTouchSlop(option, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        e.preventDefault();
        fn();
    }, { passive: false });
}

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
const resolutionAreaToggle = document.getElementById('resolutionAreaToggle');
const manualWidth = document.getElementById('manualWidth');
const manualHeight = document.getElementById('manualHeight');
const manualResolutionGroup = document.getElementById('manualResolutionGroup');
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
// Noise scheduler dropdown has been integrated into sampler dropdown
// Keeping only the hidden input reference
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
const nsfwDropdown = document.getElementById('nsfwDropdown');
const nsfwToggleBtn = document.getElementById('nsfwToggleBtn');
const nsfwDropdownMenu = document.getElementById('nsfwDropdownMenu');
const manualWorkspaceDropdown = document.getElementById('manualWorkspaceDropdown');
const manualWorkspaceDropdownBtn = document.getElementById('manualWorkspaceDropdownBtn');
const manualWorkspaceDropdownMenu = document.getElementById('manualWorkspaceDropdownMenu');
const manualWorkspaceSelected = document.getElementById('manualWorkspaceSelected');
const manualWorkspaceColorIndicator = document.getElementById('manualWorkspaceColorIndicator');
const manualWorkspaceHidden = document.getElementById('manualWorkspace');
const manualPresetName = document.getElementById('manualPresetName');
const manualPresetToggleBtn = document.getElementById('manualPresetToggleBtn');
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
let manualSelectedWorkspace = '';
let selectedPreset = '';
let selectedDatasets = [];
let datasetBias = {};
let selectedNsfwValue = 0; // Default to Neutral
let nsfwBias = 1.0; // Default bias
let selectedUcPreset = 3; // Default to "Heavy"
let appendQuality = true;
let qualityPresetBias = 1.0; // Default bias for quality preset
let appendTransparency = false;
let transparencyBias = 1.0;
let presetAutocompleteTimeout = null;
let currentPresetAutocompleteTarget = null;
let selectedPresetAutocompleteIndex = -1;
let currentMaxArea = 1048576; // Default: Normal area (1MP). Large: 2166784 (2MP). Max: 3047424 (3MP)
let widthBlurred = false; // Track if width field has been blurred
let heightBlurred = false; // Track if height field has been blurred

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
    // Capture the previous resolution BEFORE updating manualSelectedResolution
    const previousResolution = manualSelectedResolution && manualSelectedResolution !== 'custom' 
        ? manualSelectedResolution 
        : 'normal_square'; // Default to normal square if no previous selection
    
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
        resolutionAreaToggle.classList.remove('hidden');
        manualCustomResolutionBtn.setAttribute('data-state', 'on');
        manualResolutionGroup.classList.add('expanded');
        
        // Only convert from previous resolution if width/height are not already set
        // This preserves loaded values when loading from presets/metadata
        const hasExistingValues = manualWidth.value && manualHeight.value;
        
        if (!hasExistingValues) {
            // Convert current resolution to custom values
            const dimensions = getDimensionsFromResolution(previousResolution);
            if (dimensions) {
                manualWidth.value = dimensions.width;
                manualHeight.value = dimensions.height;
            } else {
                // Fallback to 1024x1024 if unable to get dimensions
                manualWidth.value = '1024';
                manualHeight.value = '1024';
            }
        }
        
        // Sanitize the values
        sanitizeCustomDimensions();
    } else {
        manualResolutionDropdown.classList.remove('hidden');
        manualCustomResolution.classList.add('hidden');
        resolutionAreaToggle.classList.add('hidden');
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
        updateManualPriceDisplay();
        
        // Update upscale toggle disabled state based on resolution
        updateManualUpscaleToggleState();
        
        // Refresh preview image if in bias mode
        if (window.uploadedImageData && window.uploadedImageData.image_source && window.uploadedImageData.isBiasMode && manualModal && !manualModal.classList.contains('hidden')) {
            // Reset bias to center (2) when resolution changes
            if (imageBiasHidden != null)
                imageBiasHidden.value = '2';
            window.uploadedImageData.bias = 2;

            await cropImageToResolution();
            await refreshImageBiasState();
        }
    }
    
    // Update pipeline stages cascade when manual resolution changes
    updatePipelineStages(); // Start from manual
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
    const preventFocusTransfer = options.preventFocusTransfer !== false; // Default to true
    
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
            selectHandler(value);
            closeHandler();
        };
        // Prevent focus transfer on mousedown if enabled
        if (preventFocusTransfer) {
            option.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
        }
        option.addEventListener('click', (e) => {
            e.preventDefault();
            action();
        });
        touchSlopUtils.registerTouchSlopTracking(option);
        option.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(option, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            action();
        }, { passive: false });
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
 * @description Renders the sampler dropdown menu with options from SAMPLER_MAP and noise scheduler options
 * @example
 * renderManualSamplerDropdown('k_euler'); // Shows sampler dropdown with k_euler selected
 */
function renderManualSamplerDropdown(selectedVal) {
    manualSamplerDropdownMenu.innerHTML = '';
    
    // Add noise scheduler section header
    const samplerHeader = document.createElement('div');
    samplerHeader.className = 'custom-dropdown-group';
    samplerHeader.textContent = 'Sampler';
    manualSamplerDropdownMenu.appendChild(samplerHeader);

    // Add sampler options
    SAMPLER_MAP.forEach(sampler => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedVal === sampler.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = sampler.meta;
        option.innerHTML = `<span>${sampler.display}</span>`;
        
        const action = () => {
            selectManualSampler(sampler.meta);
            closeManualSamplerDropdown();
        };
        
        option.addEventListener('click', (e) => {
            e.preventDefault();
            action();
        });
        bindCustomDropdownOptionTouchSlop(option, action);

        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });

        manualSamplerDropdownMenu.appendChild(option);
    });

    // Add noise scheduler section header
    const noiseHeader = document.createElement('div');
    noiseHeader.className = 'custom-dropdown-group';
    noiseHeader.textContent = 'Noise Scheduler';
    manualSamplerDropdownMenu.appendChild(noiseHeader);
    
    // Add noise scheduler options - all are visible
    NOISE_MAP.forEach(noise => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (manualSelectedNoiseScheduler === noise.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = noise.meta;
        option.dataset.noiseOption = 'true';
        option.innerHTML = `<span>${noise.display}</span>`;

        const action = () => {
            selectManualNoiseScheduler(noise.meta);
            closeManualSamplerDropdown();
        };

        option.addEventListener('click', (e) => {
            e.preventDefault();
            action();
        });
        bindCustomDropdownOptionTouchSlop(option, action);

        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });

        manualSamplerDropdownMenu.appendChild(option);
    });
}

// shouldHideNoiseOption function removed - all noise scheduler options are now visible in the dropdown

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

    // Auto-set noise scheduler based on sampler selection
    if (value === 'k_dpmpp_2m') {
        selectManualNoiseScheduler('exponential');
    } else {
        selectManualNoiseScheduler('karras');
    }

    updateSamplerDisplay();

    // Update pipeline stages inherited values
    updateAllStagesInheritedValues();
}


/**
 * Update sampler display with current sampler and noise scheduler
 * @function
 * @name updateSamplerDisplay
 * @description Updates the sampler button display with both sampler and noise scheduler badges
 */
function updateSamplerDisplay() {
    const s = SAMPLER_MAP.find(s => s.meta.toLowerCase() === manualSelectedSampler.toLowerCase());
    const n = NOISE_MAP.find(n => n.meta.toLowerCase() === manualSelectedNoiseScheduler.toLowerCase());

    if (s) {
        // Map full noise scheduler names to short versions
        const noiseShortMap = {
            'karras': 'Karras',
            'exponential': 'Expo',
            'polyexponential': 'PolyEx'
        };
        const noiseShort = noiseShortMap[n?.meta] || n?.display || '';

        // Determine if noise scheduler badge should be shown
        // Show badge if: (sampler is dpmpp_2m AND noise is NOT exponential) OR (sampler is NOT dpmpp_2m AND noise is NOT karras)
        const showNoiseBadge = (manualSelectedSampler === 'k_dpmpp_2m' && manualSelectedNoiseScheduler !== 'exponential') ||
                              (manualSelectedSampler !== 'k_dpmpp_2m' && manualSelectedNoiseScheduler !== 'karras');

        manualSamplerSelected.innerHTML = [
            `<span class="custom-dropdown-text small-viewport">${s.display_short || s.display}</span>`,
            `<span class="custom-dropdown-text full-viewport">${s.display_short_full || s.display}</span>`,
            s.badge ? `<span class="custom-dropdown-badge small-viewport ${s.badge_class || ''}">${s.badge}</span>` : '',
            s.full_badge ? `<span class="custom-dropdown-badge full-viewport ${s.badge_class || ''}">${s.full_badge}</span>` : '',
            showNoiseBadge && noiseShort ? `<span class="custom-dropdown-badge full-viewport noise-scheduler-badge">${noiseShort}</span><span class="custom-dropdown-badge small-viewport noise-scheduler-badge">${noiseShort.slice(0, 1)}</span>` : ''
        ].filter(Boolean).join(' ');
    } else {
        manualSamplerSelected.innerHTML = 'Select sampler...';
    }
    if (manualSamplerHidden) manualSamplerHidden.value = manualSelectedSampler;
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
    if (manualNoiseSchedulerHidden) manualNoiseSchedulerHidden.value = value;
    
    // Update the sampler display to show the new noise scheduler badge
    updateSamplerDisplay();
    
    // Update price display
    updateManualPriceDisplay();
    
    // Update pipeline stages inherited values
    updateAllStagesInheritedValues();
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


function renderManualWorkspaceDropdown(selectedVal) {
    if (!manualWorkspaceDropdownMenu) return;

    manualWorkspaceDropdownMenu.innerHTML = '';

    // Sort workspaces by their sort order - workspaces is an object, not an array
    const sortedWorkspaces = Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));

    sortedWorkspaces.forEach(workspace => {
        const option = document.createElement('div');
        // Use activeWorkspace variable instead of workspace.isActive property
        const isActive = workspace.id === activeWorkspace;
        option.className = 'custom-dropdown-option' + (isActive ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = workspace.id;

        option.innerHTML = `
            <div class="workspace-option-content">
                <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#102040'}"></div>
                <span class="workspace-name">${workspace.name}</span>
                <span class="workspace-counts">${workspace.fileCount} files</span>
            </div>
        `;

        const action = () => {
            if (!isActive) {
                selectManualWorkspace(workspace.id);
            }
            closeManualWorkspaceDropdown();
        };

        option.addEventListener('click', action);
        bindCustomDropdownOptionTouchSlop(option, action);
        option.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                action();
            }
        });

        manualWorkspaceDropdownMenu.appendChild(option);
    });
}

/**
 * Select manual workspace
 */
function selectManualWorkspace(workspaceId) {
    manualSelectedWorkspace = workspaceId;

    // Set the active workspace
    setActiveWorkspace(workspaceId);

    // Update the display
    updateManualWorkspaceDisplay();
}


/**
 * Close manual workspace dropdown
 */
function closeManualWorkspaceDropdown() {
    closeDropdown(manualWorkspaceDropdownMenu, manualWorkspaceDropdownBtn);
}

/**
 * Select manual model - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
function selectManualModel(value, group, preventPropagation = false) {
    const previousModel = (manualSelectedModel || manualModelHidden?.value || '').toLowerCase();
    manualSelectedModel = value.toLowerCase();

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

    const switchedToV5 = isV5Model(manualSelectedModel) && !isV5Model(previousModel);
    if (switchedToV5) {
        keepPromptNewlines = true;
        if (promptTextareaToolbar) promptTextareaToolbar.syncKeepNewlinesButtons();
        updatePromptStatusIcons();
    }

    if (preventPropagation) return;

    // Migrate params when switching into/out of V5 (clear unsupported vibe / precise ref)
    migrateManualParamsForModelChange(previousModel, manualSelectedModel);

    // Update UI visibility based on model selection
    updateV3ModelVisibility();
    renderDatasetDropdown();
    updateSubTogglesButtonState();
    renderUcPresetsDropdown();
    if (selectedUcPreset > 0) {
        selectUcPreset(selectedUcPreset);
    }
    // characterPositionToolManager: public/scripts/comp/characterPositionToolManager.js
    // characterPromptManager: public/scripts/comp/characterPromptManager.js
    updateAutoPositionToggle();
    // ensurePromptTokenizerForModel/getPromptTokenizer: public/scripts/comp/utilities.js
    ensurePromptTokenizerForModel(manualSelectedModel).then(() => {
        promptTextareaToolbar.updateAllTokenCounts();
    }).catch((error) => {
        console.error('Failed to load tokenizer for selected model:', error);
        showGlassToast('error', 'Tokenizer Unavailable', 'Prompt token counts could not be loaded for this model.');
    });
    // Trigger any listeners (e.g., updateGenerateButton or manual form update)
    updateManualPriceDisplay();

    // Refresh reference browser for model changes
    refreshReferenceBrowserForModelChange();

    // Update pipeline stages inherited values
    updateAllStagesInheritedValues();

    // Update UC textarea placeholder (presets are model-specific)
    updateUcTextareaPlaceholder();
}

/**
 * Clear vibe / precise reference when switching to a model that does not support them.
 * public/scripts/comp/utilities.js — getForgeModelFeatures
 */
function migrateManualParamsForModelChange(previousModel, nextModel) {
    if (!nextModel || previousModel === nextModel) return;
    const caps = getForgeModelFeatures(nextModel);
    if (!caps) return;

    if (caps.vibeTransfer === false) {
        const vibeContainer = document.getElementById('vibeReferencesContainer');
        if (vibeContainer) vibeContainer.innerHTML = '';
    }
    if (caps.preciseReference === false) {
        // public/scripts/comp/manualModalManager.js — directorReferenceData
        if (typeof clearDirectorReference === 'function') {
            clearDirectorReference();
        } else if (typeof directorReferenceData !== 'undefined') {
            directorReferenceData = null;
            const img = document.getElementById('directorReferenceImage');
            if (img) img.src = '';
            const section = document.getElementById('directorReferenceSection');
            if (section) section.classList.add('hidden');
        }
    }
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
        case 'base-image':
            openReferenceBrowserWithFilter('image');
            break;
        case 'vibe-transfer':
            openReferenceBrowserWithFilter('vibe');
            break;
        case 'character-reference':
            openReferenceBrowserWithFilter('character');
            break;
        case 'upload':
            // Determine upload type based on current state
            const hasValidImage = window.currentEditImage && window.currentEditMetadata;
            const hasBaseImage = hasValidImage && (
                window.currentEditMetadata.original_filename ||
                (window.currentEditImage.filename || window.currentEditImage.original)
            );
            
            // Set the appropriate mode before opening the modal
            if (hasBaseImage) {
                // If there's already a base image, upload as vibe reference
                window.unifiedUploadCurrentMode = 'vibe';
            } else {
                // If no base image, upload as base image
                window.unifiedUploadCurrentMode = 'reference';
            }
            unifiedUploadModalManager.show();

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
        previewUrl = type === 'file' ? localGalleryImageUrl(id) : localCachePreviewUrl(`${id}.webp`);
    } else {
        const filename = image.filename || image.original;
        if (!filename) return;
        source = `file:${filename}`;
        previewUrl = localGalleryImageUrl(filename);
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


function getCurrentDatasetModelKey() {
    return String(manualSelectedModel || manualModelHidden?.value || '').toLowerCase();
}

function datasetAllowedForModel(config, modelKey = getCurrentDatasetModelKey()) {
    if (!config) return false;
    const models = Array.isArray(config.models) ? config.models.map((model) => String(model).toLowerCase()) : null;
    const excluded = Array.isArray(config.excludeModels) ? config.excludeModels.map((model) => String(model).toLowerCase()) : null;
    return (!models || models.includes(modelKey)) && (!excluded || !excluded.includes(modelKey));
}

function getVisibleSubToggles(dataset, modelKey = getCurrentDatasetModelKey()) {
    return (dataset?.sub_toggles || []).filter((subToggle) => datasetAllowedForModel(subToggle, modelKey));
}

function getSubToggleGroup(dataset, groupId) {
    return (dataset?.sub_toggle_groups || []).find((group) => group.id === groupId) || null;
}

function getSubToggleDefaultBias(subToggle) {
    return subToggle.default !== undefined ? subToggle.default :
        (subToggle.default_bias !== undefined ? subToggle.default_bias : 1.0);
}

function writeSubToggleSetting(datasetValue, subToggle, enabled) {
    if (!window.datasetSettings) window.datasetSettings = {};
    if (!window.datasetSettings[datasetValue]) window.datasetSettings[datasetValue] = {};
    const existing = window.datasetSettings[datasetValue][subToggle.id];
    window.datasetSettings[datasetValue][subToggle.id] = {
        enabled,
        bias: existing?.bias !== undefined ? existing.bias : getSubToggleDefaultBias(subToggle),
        value: subToggle.value
    };
}

function getRatioGroupSiblings(datasetConfig, groupId) {
    if (!datasetConfig || !groupId) return [];
    return getVisibleSubToggles(datasetConfig).filter((subToggle) => subToggle.group === groupId);
}

function getRatioGroupSharedBias(datasetValue, datasetConfig, groupId) {
    const siblings = getRatioGroupSiblings(datasetConfig, groupId);
    const settings = window.datasetSettings?.[datasetValue] || {};
    const enabledSibling = siblings.find((subToggle) => settings[subToggle.id]?.enabled && settings[subToggle.id]?.bias !== undefined);
    if (enabledSibling) return settings[enabledSibling.id].bias;
    const storedSibling = siblings.find((subToggle) => settings[subToggle.id]?.bias !== undefined);
    if (storedSibling) return settings[storedSibling.id].bias;
    const group = getSubToggleGroup(datasetConfig, groupId);
    const defaultSibling = siblings.find((subToggle) => subToggle.id === group?.default) || siblings[0];
    return defaultSibling ? getSubToggleDefaultBias(defaultSibling) : 1.0;
}

function applyRatioGroupBias(datasetValue, datasetConfig, groupId, bias) {
    getRatioGroupSiblings(datasetConfig, groupId).forEach((subToggle) => {
        writeSubToggleSetting(datasetValue, subToggle, isSubToggleEnabled(datasetValue, subToggle));
        window.datasetSettings[datasetValue][subToggle.id].bias = bias;
    });
}

function syncRatioGroupBias(datasetValue, datasetConfig, groupId) {
    const group = getSubToggleGroup(datasetConfig, groupId);
    if (!group || group.mode !== 'ratio') return;
    applyRatioGroupBias(datasetValue, datasetConfig, groupId, getRatioGroupSharedBias(datasetValue, datasetConfig, groupId));
}

function syncAllRatioGroupBiases(datasetConfig) {
    if (!datasetConfig) return;
    (datasetConfig.sub_toggle_groups || []).forEach((group) => {
        if (group.mode === 'ratio') {
            syncRatioGroupBias(datasetConfig.value, datasetConfig, group.id);
        }
    });
}

function syncLoadedRatioGroupBiases() {
    (window.optionsData?.datasets || []).forEach((dataset) => {
        if (window.datasetSettings?.[dataset.value]) {
            syncAllRatioGroupBiases(dataset);
        }
    });
}

function isSubToggleEnabled(datasetValue, subToggle) {
    const setting = window.datasetSettings?.[datasetValue]?.[subToggle.id];
    if (setting) return !!setting.enabled;
    return !!subToggle.default_enabled;
}

function initSubTogglesForDataset(dataset) {
    if (!dataset) return;
    const modelKey = getCurrentDatasetModelKey();
    const toggles = getVisibleSubToggles(dataset, modelKey);
    const ratioDefaults = {};
    (dataset.sub_toggle_groups || []).forEach((group) => {
        if (group.mode === 'ratio') {
            ratioDefaults[group.id] = group.default || '';
        }
    });
    toggles.forEach((subToggle) => {
        const group = subToggle.group ? getSubToggleGroup(dataset, subToggle.group) : null;
        const enabled = group && group.mode === 'ratio'
            ? ratioDefaults[subToggle.group] === subToggle.id
            : !!subToggle.default_enabled;
        writeSubToggleSetting(dataset.value, subToggle, enabled);
    });
    syncAllRatioGroupBiases(dataset);
}

function clearSubTogglesForDataset(datasetValue) {
    if (window.datasetSettings && window.datasetSettings[datasetValue]) {
        delete window.datasetSettings[datasetValue];
    }
}

function isSpecialPresetActive(dataset) {
    if (dataset?.isQualityPreset) return !!appendQuality;
    if (dataset?.isTransparencyPreset) return !!appendTransparency;
    return selectedDatasets.includes(dataset.value);
}

function getActiveSubToggleDatasets() {
    const modelKey = getCurrentDatasetModelKey();
    return (window.optionsData?.datasets || []).filter((dataset) => {
        if (!datasetAllowedForModel(dataset, modelKey)) return false;
        if (!isSpecialPresetActive(dataset)) return false;
        return getVisibleSubToggles(dataset, modelKey).length > 0;
    });
}

function findDatasetConfig(datasetValue) {
    return (window.optionsData?.datasets || []).find((dataset) => dataset.value === datasetValue) || null;
}

function ensureActiveSubTogglesInitialized() {
    getActiveSubToggleDatasets().forEach((dataset) => {
        if (!window.datasetSettings?.[dataset.value]) {
            initSubTogglesForDataset(dataset);
        }
    });
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
    
    const modelKey = getCurrentDatasetModelKey();
    const modelCaps = getForgeModelFeatures(modelKey);
    const configuredDatasets = window.optionsData?.datasets || [
        { value: 'anime dataset', display: 'Anime', icon: 'nai-sakura', type: 'dataset', min: -3, max: 5, default: 1.0, negative: false, sub_toggles: [] },
        { value: 'fur dataset', display: 'Furry', icon: 'nai-paw', type: 'dataset', min: -3, max: 5, default: 1.0, negative: false, sub_toggles: [] },
        { value: 'background dataset', display: 'Backgrounds', icon: 'fas fa-tree', type: 'dataset', min: -3, max: 5, default: 0.75, negative: false, sub_toggles: [] }
    ];
    const allowedDatasets = configuredDatasets.filter((dataset) => datasetAllowedForModel(dataset, modelKey));
    const qualityPreset = allowedDatasets.find((dataset) => dataset.isQualityPreset) || {
        value: '__quality__',
        display: 'Quality',
        icon: 'fa-crown fas',
        type: 'preset',
        isQualityPreset: true
    };
    const transparencyPreset = modelCaps?.transparency === true
        ? (allowedDatasets.find((dataset) => dataset.isTransparencyPreset) || {
            value: '__transparency__',
            display: 'Transparency',
            icon: 'fas fa-chess-board',
            type: 'preset',
            isTransparencyPreset: true
        })
        : null;
    const datasets = allowedDatasets.filter((dataset) => !dataset.isQualityPreset && !dataset.isTransparencyPreset);

    // Combine quality with datasets
    const allItems = [...datasets, qualityPreset, ...(transparencyPreset ? [transparencyPreset] : [])];

    // Group items by type
    const itemsByType = allItems.reduce((acc, item) => {
        const type = item.type || 'dataset';
        if (!acc[type]) acc[type] = [];
        acc[type].push(item);
        return acc;
    }, {});

    // Render items grouped by type with headers
    const typeOrder = ['dataset', 'preset'];
    const typeLabels = {
        'preset': 'Presets',
        'dataset': 'Datasets'
    };
    
    typeOrder.forEach((type, typeIndex) => {
        if (!itemsByType[type] || itemsByType[type].length === 0) return;

        // Add section header
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'custom-dropdown-group';
        sectionHeader.textContent = typeLabels[type] || type.charAt(0).toUpperCase() + type.slice(1);
        datasetDropdownMenu.appendChild(sectionHeader);

        itemsByType[type].forEach(dataset => {
            // Preset rows share the same compact bias controls.
            if (dataset.isQualityPreset || dataset.isTransparencyPreset) {
                const qualityToggleOption = document.createElement('div');
                qualityToggleOption.className = 'custom-dropdown-option';
                const isTransparency = dataset.isTransparencyPreset === true;
                const isSelected = isTransparency ? appendTransparency : appendQuality;
                if (isSelected) {
                    qualityToggleOption.classList.add('selected');
                }

                const presetBias = isTransparency ? transparencyBias : qualityPresetBias;
                const qualityBiasDisplay = presetBias !== 1.0 ? presetBias.toFixed(1) : '1.0';
                const actionPrefix = isTransparency ? 'transparency' : 'quality';

                qualityToggleOption.innerHTML = `
                    <div class="dataset-option-content">
                        <div class="dataset-option-left">
                            <i class="${dataset.icon}" style="font-size: 14px;"></i>
                            <span class="dataset-name">${dataset.display}</span>
                        </div>
                        <div class="dataset-option-right">
                            ${isSelected ? `
                                <div class="dataset-bias-controls">
                                    <button type="button" class="dataset-bias-decrease" title="Decrease ${dataset.display.toLowerCase()} bias" data-action="${actionPrefix}-bias-decrease">
                                        <i class="fas fa-minus"></i>
                                    </button>
                                    <span class="dataset-bias-value" data-action="${actionPrefix}-bias">${qualityBiasDisplay}</span>
                                    <button type="button" class="dataset-bias-increase" title="Increase ${dataset.display.toLowerCase()} bias" data-action="${actionPrefix}-bias-increase">
                                        <i class="fas fa-plus"></i>
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;

                // Add click handler for the main option (toggle selection)
                const optionLeft = qualityToggleOption.querySelector('.dataset-option-left');
                optionLeft.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isTransparency) {
                        appendTransparency = !appendTransparency;
                        if (appendTransparency) {
                            initSubTogglesForDataset(dataset);
                        } else {
                            clearSubTogglesForDataset(dataset.value);
                        }
                    } else {
                        appendQuality = !appendQuality;
                        if (appendQuality) {
                            initSubTogglesForDataset(dataset);
                        } else {
                            clearSubTogglesForDataset(dataset.value);
                        }
                    }
                    updatePromptStatusIcons();
                    renderDatasetDropdown();
                    updateSubTogglesButtonState();
                });

                // Add click handlers for quality bias controls (only if selected)
                if (isSelected) {
                    const qualityBiasDecrease = qualityToggleOption.querySelector(`[data-action="${actionPrefix}-bias-decrease"]`);
                    const qualityBiasIncrease = qualityToggleOption.querySelector(`[data-action="${actionPrefix}-bias-increase"]`);
                    const qualityBiasValue = qualityToggleOption.querySelector(`[data-action="${actionPrefix}-bias"]`);

                    qualityBiasDecrease.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        adjustDatasetPresetBias(isTransparency, -0.1);
                    });

                    qualityBiasIncrease.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        adjustDatasetPresetBias(isTransparency, 0.1);
                    });

                    // Add wheel event for quality bias value span
                    qualityBiasValue.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const delta = e.deltaY > 0 ? -0.1 : 0.1;
                        adjustDatasetPresetBias(isTransparency, delta);

                        // Add visual feedback
                        qualityBiasValue.classList.add('scrolling');
                        setTimeout(() => {
                            qualityBiasValue.classList.remove('scrolling');
                        }, 200);
                    });
                }

                datasetDropdownMenu.appendChild(qualityToggleOption);
                return;
            }

            // Regular dataset rendering
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option';
            option.dataset.value = dataset.value;

            const isSelected = selectedDatasets.includes(dataset.value);
            if (isSelected) {
                option.classList.add('selected');
            }

            const biasValue = datasetBias[dataset.value] !== undefined ? datasetBias[dataset.value] : (dataset.default !== undefined ? dataset.default : 1.0);
            const biasDisplay = biasValue !== 1.0 ? biasValue.toFixed(1) : '1.0';
            
            // Use icon from config, fallback to default
            const icon = dataset.icon || 'fa-cube fas';

            option.innerHTML = `
                <div class="dataset-option-content">
                    <div class="dataset-option-left">
                        <i class="${icon}" style="font-size: 14px;"></i>
                        <span class="dataset-name">${dataset.display}</span>
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
                toggleDataset(dataset.value, dataset);
            });

            // Add click handlers for bias controls (only if dataset is selected)
            if (isSelected) {
                const decreaseBtn = option.querySelector('.dataset-bias-decrease');
                const increaseBtn = option.querySelector('.dataset-bias-increase');
                const biasValueSpan = option.querySelector('.dataset-bias-value');

                decreaseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    adjustDatasetBias(dataset.value, -0.1, dataset);
                });

                increaseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    adjustDatasetBias(dataset.value, 0.1, dataset);
                });

                // Add wheel event for bias value span
                biasValueSpan.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    adjustDatasetBias(dataset.value, delta, dataset);
                    
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
    });
}

/**
 * Toggle dataset selection
 * @param {string} value - Dataset value to toggle ('anime', 'furry', 'backgrounds')
 * @param {object} datasetConfig - Dataset configuration object with min, max, default values
 * @function
 * @name toggleDataset
 * @description Toggles the selection state of a dataset and updates the UI accordingly
 * @example
 * toggleDataset('furry', datasetConfigObj); // Toggles furry dataset selection on/off
 */
function toggleDataset(value, datasetConfig) {
    const index = selectedDatasets.indexOf(value);
    if (index > -1) {
        // Disabling dataset - clear sub_toggles state
        selectedDatasets.splice(index, 1);
        
        // Clear sub_toggles settings for this dataset
        if (window.datasetSettings && window.datasetSettings[value]) {
            delete window.datasetSettings[value];
        }
    } else {
        // Enabling dataset - add and initialize
        selectedDatasets.push(value);
        
        // Initialize bias to default value if not already set
        if (datasetBias[value] === undefined && datasetConfig && datasetConfig.default !== undefined) {
            datasetBias[value] = datasetConfig.default;
        }
        
        // Initialize default enabled sub_toggles and ratio-group defaults
        if (datasetConfig && getVisibleSubToggles(datasetConfig).length > 0) {
            initSubTogglesForDataset(datasetConfig);
        }
    }

    // Update display
    updateDatasetDisplay();
    renderDatasetDropdown();
    updateSubTogglesButtonState();
    renderUcPresetsDropdown();
    
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
        // getDatasetLeadIconClass: public/scripts/comp/utilities.js
        datasetIcon.className = getDatasetLeadIconClass(selectedDatasets);
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
 * @param {object} datasetConfig - Dataset configuration object with min, max, default values
 * @function
 * @name adjustDatasetBias
 * @description Adjusts the bias value for a selected dataset within configured range
 * @example
 * adjustDatasetBias('furry', 0.1, datasetConfigObj); // Increases furry dataset bias by 0.1
 * adjustDatasetBias('anime', -0.1, datasetConfigObj); // Decreases anime dataset bias by 0.1
 */
function adjustDatasetBias(dataset, delta, datasetConfig) {
    // Get min/max from config or use defaults
    const min = datasetConfig?.min !== undefined ? datasetConfig.min : -3;
    const max = datasetConfig?.max !== undefined ? datasetConfig.max : 5;
    const defaultValue = datasetConfig?.default !== undefined ? datasetConfig.default : 1.0;
    
    const currentValue = datasetBias[dataset] !== undefined ? datasetBias[dataset] : defaultValue;
    const newValue = Math.max(min, Math.min(max, currentValue + delta));
    datasetBias[dataset] = Math.round(newValue * 10) / 10; // Round to 1 decimal place
    
    // Update the bias value display in the dropdown
    const biasValueSpan = document.querySelector(`.dataset-bias-value[data-dataset="${dataset}"]`);
    if (biasValueSpan) {
        const displayValue = datasetBias[dataset] !== 1.0 ? datasetBias[dataset].toFixed(1) : '1.0';
        biasValueSpan.textContent = displayValue;
    }
    
    // Update dataset display to ensure dropdown stays in sync
    updateDatasetDisplay();
    if (typeof refreshTokenBarCounts === 'function') {
        refreshTokenBarCounts();
    }
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
    ensureActiveSubTogglesInitialized();

    const selectedDatasetsWithToggles = getActiveSubToggleDatasets();

    if (selectedDatasetsWithToggles.length === 0) {
        return;
    }

    const modelKey = getCurrentDatasetModelKey();

    // Helper function to create a toggle option element
    const createToggleOption = (dataset, subToggle) => {
        const toggleOption = document.createElement('div');
        toggleOption.className = 'custom-dropdown-option';
        toggleOption.dataset.dataset = dataset.value;
        toggleOption.dataset.toggle = subToggle.id;

        const isEnabled = isSubToggleEnabled(dataset.value, subToggle);

        if (isEnabled) {
            toggleOption.classList.add('selected');
        }

        const defaultBias = getSubToggleDefaultBias(subToggle);
        const biasValue = (window.datasetSettings && 
                         window.datasetSettings[dataset.value] && 
                         window.datasetSettings[dataset.value][subToggle.id]) ?
                         window.datasetSettings[dataset.value][subToggle.id].bias : 
                         defaultBias;

        const biasDisplay = biasValue !== 1.0 ? biasValue.toFixed(1) : '1.0';

        // Use icon from config, fallback to default
        const icon = subToggle.icon || 'fas fa-toggle-on';

        toggleOption.innerHTML = `
            <div class="dataset-option-content">
                <div class="dataset-option-left">
                    <i class="${icon}" style="font-size: 14px;"></i>
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
            toggleSubToggle(dataset.value, subToggle.id, subToggle);
        });

        // Add click handlers for bias controls (only if toggle is enabled)
        if (isEnabled) {
            const decreaseBtn = toggleOption.querySelector('.dataset-bias-decrease');
            const increaseBtn = toggleOption.querySelector('.dataset-bias-increase');
            const biasValueSpan = toggleOption.querySelector('.dataset-bias-value');

            decreaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                adjustSubToggleBias(dataset.value, subToggle.id, -0.1, subToggle);
            });

            increaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                adjustSubToggleBias(dataset.value, subToggle.id, 0.1, subToggle);
            });

            // Add wheel event for bias value span
            biasValueSpan.addEventListener('wheel', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                adjustSubToggleBias(dataset.value, subToggle.id, delta, subToggle);
                
                // Add visual feedback
                biasValueSpan.classList.add('scrolling');
                setTimeout(() => {
                    biasValueSpan.classList.remove('scrolling');
                }, 200);
            });
        }

        return toggleOption;
    };

    // Group all toggles by type across all datasets
    const togglesByType = { dataset: [], preset: [] };
    selectedDatasetsWithToggles.forEach(dataset => {
        getVisibleSubToggles(dataset, modelKey).forEach(subToggle => {
            const type = subToggle.type || 'preset';
            if (togglesByType[type]) {
                togglesByType[type].push({ dataset, subToggle });
            }
        });
    });

    const appendTogglesWithGroups = (datasetGroup, dataset, toggles) => {
        const groupDefs = dataset.sub_toggle_groups || [];
        const grouped = {};
        const ungrouped = [];
        toggles.forEach((subToggle) => {
            if (subToggle.group) {
                if (!grouped[subToggle.group]) grouped[subToggle.group] = [];
                grouped[subToggle.group].push(subToggle);
            } else {
                ungrouped.push(subToggle);
            }
        });
        ungrouped.forEach((subToggle) => {
            datasetGroup.appendChild(createToggleOption(dataset, subToggle));
        });
        const remainingGroups = new Set(Object.keys(grouped));
        groupDefs.forEach((group) => {
            const items = grouped[group.id];
            if (!items || items.length === 0) return;
            remainingGroups.delete(group.id);
            const groupHeader = document.createElement('div');
            groupHeader.className = 'custom-dropdown-group';
            groupHeader.textContent = group.name || group.id;
            datasetGroup.appendChild(groupHeader);
            items.forEach((subToggle) => {
                datasetGroup.appendChild(createToggleOption(dataset, subToggle));
            });
        });
        remainingGroups.forEach((groupId) => {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'custom-dropdown-group';
            groupHeader.textContent = groupId;
            datasetGroup.appendChild(groupHeader);
            grouped[groupId].forEach((subToggle) => {
                datasetGroup.appendChild(createToggleOption(dataset, subToggle));
            });
        });
    };

    // Render dataset-type toggles first, then preset-type toggles
    const typeOrder = ['dataset', 'preset'];
    let hasRenderedDatasetType = false;
    
    typeOrder.forEach((type) => {
        if (!togglesByType[type] || togglesByType[type].length === 0) return;

        // Add separator after dataset-type toggles, before preset-type toggles
        if (type === 'preset' && hasRenderedDatasetType) {
            const typeDivider = document.createElement('div');
            typeDivider.className = 'custom-dropdown-separator';
            subTogglesDropdownMenu.appendChild(typeDivider);
        }

        // Group toggles by dataset for this type
        const togglesByDataset = {};
        togglesByType[type].forEach(({ dataset, subToggle }) => {
            if (!togglesByDataset[dataset.value]) {
                togglesByDataset[dataset.value] = {
                    dataset,
                    toggles: []
                };
            }
            togglesByDataset[dataset.value].toggles.push(subToggle);
        });

        // Render each dataset group for this type
        Object.values(togglesByDataset).forEach(({ dataset, toggles }) => {
            const datasetGroup = document.createElement('div');
            datasetGroup.className = 'sub-toggle-dataset-group';

            const datasetHeader = document.createElement('div');
            datasetHeader.className = 'custom-dropdown-group';
            datasetHeader.textContent = dataset.display;
            datasetGroup.appendChild(datasetHeader);

            appendTogglesWithGroups(datasetGroup, dataset, toggles);

            subTogglesDropdownMenu.appendChild(datasetGroup);
        });

        if (type === 'dataset') {
            hasRenderedDatasetType = true;
        }
    });
}


/**
 * Toggle sub-toggle selection
 * @param {string} dataset - Dataset name containing the sub-toggle
 * @param {string} subToggleId - Sub-toggle identifier to toggle
 * @param {object} subToggleConfig - Sub-toggle configuration object with min, max, default values
 * @function
 * @name toggleSubToggle
 * @description Toggles the selection state of a dataset sub-toggle and updates the UI
 * @example
 * toggleSubToggle('furry', 'cute', subToggleConfigObj); // Toggles the 'cute' sub-toggle for furry dataset
 */
function toggleSubToggle(dataset, subToggleId, subToggleConfig) {
    if (!window.datasetSettings) window.datasetSettings = {};
    if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};

    const datasetConfig = findDatasetConfig(dataset);
    const subToggle = subToggleConfig || datasetConfig?.sub_toggles?.find(t => t.id === subToggleId);
    if (!subToggle) return;

    const group = subToggle.group ? getSubToggleGroup(datasetConfig, subToggle.group) : null;
    const currentlyEnabled = isSubToggleEnabled(dataset, subToggle);

    if (group && group.mode === 'ratio') {
        const sharedBias = getRatioGroupSharedBias(dataset, datasetConfig, subToggle.group);
        getVisibleSubToggles(datasetConfig).forEach((sibling) => {
            if (sibling.group === subToggle.group) {
                writeSubToggleSetting(dataset, sibling, false);
            }
        });
        if (!currentlyEnabled) {
            writeSubToggleSetting(dataset, subToggle, true);
        }
        applyRatioGroupBias(dataset, datasetConfig, subToggle.group, sharedBias);
    } else if (!window.datasetSettings[dataset][subToggleId]) {
        writeSubToggleSetting(dataset, subToggle, !(subToggle.default_enabled || false));
    } else {
        window.datasetSettings[dataset][subToggleId].enabled = !currentlyEnabled;
        window.datasetSettings[dataset][subToggleId].value = subToggle.value;
    }

    renderSubTogglesDropdown();
    updateSubTogglesButtonState();
}

/**
 * Adjust sub-toggle bias value
 * @param {string} dataset - Dataset name containing the sub-toggle
 * @param {string} subToggleId - Sub-toggle identifier to adjust
 * @param {number} delta - Amount to adjust bias by (e.g., 0.1, -0.1)
 * @param {object} subToggleConfig - Sub-toggle configuration object with min, max, default values
 * @function
 * @name adjustSubToggleBias
 * @description Adjusts the bias value for a dataset sub-toggle within configured range
 * @example
 * adjustSubToggleBias('furry', 'cute', 0.1, subToggleConfigObj); // Increases cute sub-toggle bias by 0.1
 */
function adjustSubToggleBias(dataset, subToggleId, delta, subToggleConfig) {
                    if (!window.datasetSettings) window.datasetSettings = {};
                    if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};
    
    const datasetConfig = findDatasetConfig(dataset);
    const subToggle = subToggleConfig || datasetConfig?.sub_toggles?.find(t => t.id === subToggleId);
    if (!subToggle) return;

    // Get min/max from config or use defaults
    const min = subToggle?.min !== undefined ? subToggle.min : -3;
    const max = subToggle?.max !== undefined ? subToggle.max : 5;
    const defaultBias = getSubToggleDefaultBias(subToggle);
    const group = subToggle.group ? getSubToggleGroup(datasetConfig, subToggle.group) : null;
    const currentBias = group && group.mode === 'ratio'
        ? getRatioGroupSharedBias(dataset, datasetConfig, subToggle.group)
        : (window.datasetSettings[dataset][subToggleId]?.bias !== undefined
            ? window.datasetSettings[dataset][subToggleId].bias
            : defaultBias);

    if (!window.datasetSettings[dataset][subToggleId]) {
        window.datasetSettings[dataset][subToggleId] = {
            enabled: true, // If user is adjusting bias, they want it enabled
            bias: currentBias,
                            value: subToggle.value
                        };
                    }

    const newBias = Math.max(min, Math.min(max, currentBias + delta));
    const roundedBias = Math.round(newBias * 10) / 10; // Round to 1 decimal place
    if (group && group.mode === 'ratio') {
        applyRatioGroupBias(dataset, datasetConfig, subToggle.group, roundedBias);
    } else {
        window.datasetSettings[dataset][subToggleId].bias = roundedBias;
    }

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

    ensureActiveSubTogglesInitialized();
    const activeDatasets = getActiveSubToggleDatasets();
    const hasSubToggles = activeDatasets.length > 0;

    const hasEnabledToggles = activeDatasets.some((dataset) =>
        getVisibleSubToggles(dataset).some((subToggle) => isSubToggleEnabled(dataset.value, subToggle))
    );

    const hasExtremeBias = activeDatasets.some((dataset) =>
        getVisibleSubToggles(dataset).some((subToggle) => {
            if (!isSubToggleEnabled(dataset.value, subToggle)) return false;
            const bias = window.datasetSettings?.[dataset.value]?.[subToggle.id]?.bias;
            return bias > 1.5 || bias < 1.0;
        })
    );

    let buttonState = 'off';
    if (hasEnabledToggles) {
        buttonState = hasExtremeBias ? 'onhigh' : 'on';
    }

    subTogglesBtn.setAttribute('data-state', buttonState);
    subTogglesDropdown.classList.toggle('hidden', !hasSubToggles);

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
 * Adjust quality preset bias
 * @param {number} delta - The change in bias value
 * @function
 * @name adjustQualityPresetBias
 * @description Adjusts the quality preset bias value and updates the UI
 * @example
 * adjustQualityPresetBias(0.1); // Increases quality bias by 0.1
 */
function adjustQualityPresetBias(delta) {
    qualityPresetBias = Math.max(0.0, Math.min(9.0, qualityPresetBias + delta));
    qualityPresetBias = Math.round(qualityPresetBias * 10) / 10; // Round to 1 decimal place
    
    // Update the display in the dropdown
    const qualityBiasValue = datasetDropdownMenu.querySelector('[data-action="quality-bias"]');
    if (qualityBiasValue) {
        const display = qualityPresetBias !== 1.0 ? qualityPresetBias.toFixed(1) : '1.0';
        qualityBiasValue.textContent = display;
    }
}

function adjustDatasetPresetBias(isTransparency, delta) {
    if (!isTransparency) {
        adjustQualityPresetBias(delta);
        return;
    }
    transparencyBias = Math.max(0.0, Math.min(9.0, transparencyBias + delta));
    transparencyBias = Math.round(transparencyBias * 10) / 10;
    const valueEl = datasetDropdownMenu.querySelector('[data-action="transparency-bias"]');
    if (valueEl) valueEl.textContent = transparencyBias !== 1.0 ? transparencyBias.toFixed(1) : '1.0';
}

/**
 * Render UC presets dropdown - MOVED FROM app.js
 * @function
 * @name renderUcPresetsDropdown
 * @description Renders the UC (Undesired Content) presets dropdown menu with available levels
 * @example
 * renderUcPresetsDropdown(); // Shows UC preset options (None, Human Focus, Light, Heavy, Curated, Furry Focus)
 */
function renderUcPresetsDropdown() {
    ucPresetsDropdownMenu.innerHTML = '';
    const furryFocus = selectedDatasets.some((dataset) => dataset === 'fur dataset' || dataset === 'furry dataset');
    // resolvePresetTableForModel / UC_PRESET_LEVEL_LABELS: public/scripts/comp/utilities.js
    const ucTable = resolvePresetTableForModel(window.optionsData?.uc_presets, manualSelectedModel);
    [
        { value: 0, display: UC_PRESET_LEVEL_LABELS[0] },
        { value: 1, display: UC_PRESET_LEVEL_LABELS[1], furryFocus: false },
        { value: 2, display: UC_PRESET_LEVEL_LABELS[2] },
        { value: 3, display: UC_PRESET_LEVEL_LABELS[3] },
        { value: 4, display: UC_PRESET_LEVEL_LABELS[4] },
        { value: 5, display: UC_PRESET_LEVEL_LABELS[5] }
    ].filter((preset) => {
        if (preset.furryFocus === false && furryFocus) return false;
        if (preset.value === 5 && (!Array.isArray(ucTable) || !ucTable[4])) return false;
        return true;
    }).forEach(preset => {
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
        bindCustomDropdownOptionTouchSlop(option, () => {
            selectUcPreset(preset.value);
            closeUcPresetsDropdown();
        });

        ucPresetsDropdownMenu.appendChild(option);
    });
}

/**
 * Select UC preset - MOVED FROM app.js
 * @param {number} value - UC preset level (0=None, 1=Human Focus, 2=Light, 3=Heavy, 4=Curated, 5=Furry Focus)
 * @function
 * @name selectUcPreset
 * @description Updates the selected UC preset and updates the UI state and prompt status icons
 * @example
 * selectUcPreset(4); // Selects 'Curated' UC preset
 */
function selectUcPreset(value) {
    // resolvePresetTableForModel: public/scripts/comp/utilities.js
    const ucTable = resolvePresetTableForModel(window.optionsData?.uc_presets, manualSelectedModel);
    if (value > 0 && Array.isArray(ucTable) && !ucTable[value - 1]) {
        value = 0;
    }
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

    // Update UC textarea placeholder
    updateUcTextareaPlaceholder();

    // autoResizeTextarea: public/scripts/comp/utilities.js
    const ucInput = document.getElementById('manualUc');
    if (ucInput && typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(ucInput);
        const manualPromptNegative = document.getElementById('manualPromptNegative');
        if (manualPromptNegative) {
            autoResizeTextarea(manualPromptNegative);
        }
    }
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
 * Setup UC dropdown context menu
 * @function
 * @name setupUcDropdownContextMenu
 * @description Sets up the context menu for the UC dropdown button with options to add preset contents and toggle auto-clean
 */
function setupUcDropdownContextMenu() {
    if (!contextMenu) {
        console.warn('Context menu system not available');
        return;
    }

    const contextMenuConfig = {
        sections: [
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-plus-circle',
                        text: 'Add Preset Contents',
                        action: 'addPresetContents',
                        disabled: false
                    },
                    {
                        icon: 'fas fa-broom',
                        text: 'Auto Remove Phrases',
                        action: 'toggleAutoClean',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: false,
                        loadfn: (item) => {
                            // Update the icon based on current state
                            const autoCleanState = ucPresetsDropdownBtn.dataset.autoClean === 'on';
                            if (autoCleanState) {
                                item.icon = 'fas fa-check-square';
                            } else {
                                item.icon = 'fa-regular fa-square';
                            }
                        }
                    }
                ]
            }
        ]
    };

    contextMenu.attachToElement(ucPresetsDropdownBtn, contextMenuConfig);
}

/**
 * Handle UC context menu actions
 * @function
 * @name handleUcContextMenuAction
 * @param {CustomEvent} event - Context menu action event
 */
function handleUcContextMenuAction(event) {
    const { action, target } = event.detail;
    
    // Only handle actions for UC dropdown button
    if (target !== ucPresetsDropdownBtn) return;

    switch (action) {
        case 'addPresetContents':
            addUcPresetContents();
            break;
        case 'toggleAutoClean':
            toggleAutoCleanUc();
            break;
    }
}

/**
 * Add UC preset contents to UC input
 * @function
 * @name addUcPresetContents
 * @description Gets the current UC preset value for the selected model and adds it to the start of the UC input
 */
function addUcPresetContents() {
    // Get the current UC preset index
    const currentPresetIndex = selectedUcPreset;
    
    // If no preset selected, show message
    if (currentPresetIndex === 0) {
        showGlassToast('info', null, 'No UC preset selected', false, 3000, '<i class="fas fa-info-circle"></i>');
        return;
    }

    // Get the current model
    const currentModel = manualSelectedModel;
    if (!currentModel) {
        showGlassToast('error', null, 'No model selected', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Get UC presets from optionsData
    if (!window.optionsData || !window.optionsData.uc_presets) {
        showGlassToast('error', null, 'UC presets not available', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // resolvePresetTableForModel: public/scripts/comp/utilities.js
    const ucPresets = resolvePresetTableForModel(window.optionsData.uc_presets, currentModel);

    if (!ucPresets || !Array.isArray(ucPresets)) {
        showGlassToast('error', null, `No UC presets found for model ${currentModel}`, false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Get the preset value (index is 1-based, array is 0-based)
    const presetValue = ucPresets[currentPresetIndex - 1];
    
    if (!presetValue) {
        showGlassToast('error', null, `UC preset ${currentPresetIndex} not found`, false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Get the UC input element
    const ucInput = document.getElementById('manualUc');
    if (!ucInput) {
        showGlassToast('error', null, 'UC input not found', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Get current UC value
    const currentUc = ucInput.value.trim();

    // Add preset value to start of UC with ", " separator if there's existing content
    const newUc = currentUc ? `${presetValue}, ${currentUc}` : presetValue;
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(ucInput, newUc);

    // Trigger input event to update token count, auto-resize, and other updates
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    ucInput.dispatchEvent(inputEvent);

    // Update emphasis highlighting and apply formatted text
    if (typeof updateEmphasisHighlighting === 'function') {
        updateEmphasisHighlighting(ucInput);
    }
    if (typeof applyFormattedText === 'function') {
        applyFormattedText(ucInput, true);
    }
    if (typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(ucInput);
    }

    // Reset to no preset
    selectUcPreset(0);
    renderUcPresetsDropdown();

    // Update prompt status icons
    if (typeof updatePromptStatusIcons === 'function') {
        updatePromptStatusIcons();
    }

    // Show success message
    // UC_PRESET_LEVEL_LABELS: public/scripts/comp/utilities.js
    showGlassToast('success', null, `Added ${UC_PRESET_LEVEL_LABELS[currentPresetIndex]} preset to UC`, false, 2000, '<i class="fas fa-check"></i>');
}

/**
 * Update UC textarea placeholder based on selected UC preset
 * @function
 * @name updateUcTextareaPlaceholder
 * @description Updates the placeholder text of the UC textarea to show the selected preset content or default text
 */
function updateUcTextareaPlaceholder() {
    const ucInput = document.getElementById('manualUc');
    if (!ucInput) {
        return;
    }

    // If no UC preset selected (None), use default placeholder
    if (selectedUcPreset === 0) {
        ucInput.placeholder = 'Enter undesired content...';
        return;
    }

    // Get the current model
    const currentModel = manualSelectedModel;
    if (!currentModel) {
        ucInput.placeholder = 'Enter undesired content...';
        return;
    }

    // Check if UC presets data is available
    if (!window.optionsData || !window.optionsData.uc_presets) {
        ucInput.placeholder = 'Enter undesired content...';
        return;
    }

    // resolvePresetTableForModel: public/scripts/comp/utilities.js
    const ucPresets = resolvePresetTableForModel(window.optionsData.uc_presets, currentModel);

    if (!ucPresets || !Array.isArray(ucPresets)) {
        ucInput.placeholder = 'Enter undesired content...';
        return;
    }

    // Get the preset value (index is 1-based, array is 0-based)
    const presetValue = ucPresets[selectedUcPreset - 1];

    if (!presetValue) {
        ucInput.placeholder = 'Enter undesired content...';
        return;
    }

    // Set the placeholder to the preset content
    ucInput.placeholder = presetValue;
}

/**
 * Toggle auto-clean UC state
 * @function
 * @name toggleAutoCleanUc
 * @description Toggles the auto-clean UC state which removes UC phrases that appear in the prompt
 */
function toggleAutoCleanUc() {
    const currentState = ucPresetsDropdownBtn.dataset.autoClean === 'on';
    const newState = currentState ? 'off' : 'on';
    ucPresetsDropdownBtn.dataset.autoClean = newState;
    
    // Show toast with current state
    const stateText = newState === 'on' ? 'Auto Remove Phrases from UC: when present in Prompt' : 'Auto Remove Phrases from UC: Disabled';
    const icon = newState === 'on' ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>';
    showGlassToast('info', null, stateText, false, 2000, icon);
}

/**
 * Apply bias to text with inner numeric emphasis
 * @param {string} input - The text to apply bias to
 * @param {number} bias - The bias value to apply
 * @returns {string} The text with bias applied to inner emphasis and wrapped with main bias
 */
function applyBiasToText(input, bias) {
    if (bias === 1.0 || bias === undefined) {
        return input;
    }

    // hasManagedEmphasisGroupIds: public/scripts/comp/emphasisGroupIdCodec.js
    // Do not wrap managed ZWSP groups in classic N:: (weights live in forge / visible weight digits).
    if (typeof input === 'string' && hasManagedEmphasisGroupIds(input)) {
        return input;
    }

    // Check if input is already a complete emphasis group (starts with BIAS:: and ends with ::)
    const isCompleteGroup = /^(-?\d+\.?\d*)::.+::$/s.test(input);
    
    // Check if input contains any bias groups
    const hasBiasGroups = /(-?\d+\.?\d*)::/g.test(input);

    if (isCompleteGroup) {
        // Input is already wrapped - add or subtract based on bias value
        let result = input.replace(/(-?\d+\.?\d*)::/g, (match, biasValue) => {
            const currentBias = parseFloat(biasValue);
            let newBias;
            
            if (bias >= 1.0) {
                // Increase emphasis - add the bias value
                newBias = currentBias + bias;
            } else {
                // Decrease emphasis
                const difference = 1.0 - bias;
                if (currentBias < 0) {
                    // For negative emphasis, add to make less negative
                    newBias = currentBias + difference;
                } else {
                    // For positive emphasis, subtract to reduce
                    newBias = currentBias - difference;
                }
            }
            
            const rounded = Math.round(newBias * 10) / 10; // Round to 1 decimal place
            return `${rounded.toFixed(1)}::`;
        });
        return result;
    } else if (hasBiasGroups) {
        // Input has bias groups but not wrapped - add/subtract adjustment and wrap
        const biasAdjustment = bias - 1.0;
        let result = input.replace(/(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)*?)::(?=(?:[^:]|$))/g, (match, innerBias, content) => {
            const innerBiasValue = parseFloat(innerBias);
            const newInnerBias = innerBiasValue + biasAdjustment;
            const rounded = Math.round(newInnerBias * 10) / 10;
            
            return `${rounded.toFixed(1)}::${content}, ${bias}::`;
        });
        return `${bias}::${result}::`;
    } else {
        // No bias groups - wrap the entire input
        return `${bias}::${input}::`;
    }
}

/**
 * Setup dataset dropdown context menu
 * @function
 * @name setupDatasetDropdownContextMenu
 * @description Sets up the context menu for the dataset dropdown button with options to add quality preset contents and reset datasets
 */
function setupDatasetDropdownContextMenu() {
    if (!contextMenu) {
        console.warn('Context menu system not available');
        return;
    }

    const contextMenuConfig = {
        sections: [
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-plus-circle',
                        text: 'Add Preset Contents',
                        action: 'addQualityPresetContents',
                        disabled: false,
                        loadfn: (item) => {
                            // Disable if quality preset is off
                            item.disabled = !appendQuality;
                        }
                    },
                    {
                        icon: 'fas fa-undo',
                        text: 'Reset',
                        action: 'resetDatasets',
                        disabled: false
                    },
                    { separator: true },
                    {
                        icon: 'fas fa-paragraph',
                        text: 'Keep Newlines',
                        action: 'toggleNewlines',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: false,
                        loadfn: (item) => {
                            item.checked = !!window.keepPromptNewlines;
                        }
                    },
                    {
                        icon: 'fas fa-hashtag',
                        text: 'Auto Char Numerize',
                        action: 'toggleAutoCharNumerize',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: false,
                        loadfn: (item) => {
                            item.checked = window.autoCharNumerize !== false;
                        }
                    },
                    {
                        icon: 'fas fa-wand-magic-sparkles',
                        text: 'Auto Format',
                        action: 'toggleAutoFormat',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: false,
                        loadfn: (item) => {
                            item.checked = window.autoFormatOnBlur !== false;
                        }
                    },
                    {
                        icon: 'fas fa-align-left',
                        text: 'Prompt Normalize',
                        action: 'togglePromptNormalize',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: false,
                        loadfn: (item) => {
                            item.checked = window.promptNormalize !== false;
                        }
                    },
                    {
                        icon: 'fas fa-clone',
                        text: 'Deduplicate',
                        action: 'toggleDeduplicate',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: false,
                        loadfn: (item) => {
                            item.checked = window.deduplicateTags !== false;
                        }
                    }
                ]
            }
        ]
    };

    contextMenu.attachToElement(datasetDropdownBtn, contextMenuConfig);
}

/**
 * Handle dataset context menu actions
 * @function
 * @name handleDatasetContextMenuAction
 * @param {CustomEvent} event - Context menu action event
 */
function handleDatasetContextMenuAction(event) {
    const { action, target } = event.detail;
    
    // Only handle actions for dataset dropdown button
    if (target !== datasetDropdownBtn) return;

    switch (action) {
        case 'addQualityPresetContents':
            addQualityPresetContents();
            break;
        case 'resetDatasets':
            resetDatasets();
            break;
        case 'toggleNewlines':
            keepPromptNewlines = !keepPromptNewlines;
            // syncKeepNewlinesButtons: public/scripts/comp/promptTextareaToolbar.js
            promptTextareaToolbar.syncKeepNewlinesButtons();
            // updatePromptStatusIcons: public/scripts/comp/utilities.js
            updatePromptStatusIcons();
            break;
        case 'toggleAutoCharNumerize':
            autoCharNumerize = autoCharNumerize === false;
            // updatePromptStatusIcons: public/scripts/comp/utilities.js
            updatePromptStatusIcons();
            break;
        case 'toggleAutoFormat':
            autoFormatOnBlur = autoFormatOnBlur === false;
            break;
        case 'togglePromptNormalize':
            promptNormalize = promptNormalize === false;
            // updatePromptStatusIcons: public/scripts/comp/utilities.js
            updatePromptStatusIcons();
            break;
        case 'toggleDeduplicate':
            deduplicateTags = deduplicateTags === false;
            // updatePromptStatusIcons: public/scripts/comp/utilities.js
            updatePromptStatusIcons();
            break;
    }
}

/**
 * Add quality preset contents to prompt with emphasis bias
 * @function
 * @name addQualityPresetContents
 * @description Gets the current quality preset value for the selected model and adds it to the start of the prompt with emphasis bias
 */
function addQualityPresetContents() {
    // Check if quality preset is enabled
    if (!appendQuality) {
        showGlassToast('info', null, 'Quality preset is disabled', false, 3000, '<i class="fas fa-info-circle"></i>');
        return;
    }

    // Get the current model
    const currentModel = manualSelectedModel;
    if (!currentModel) {
        showGlassToast('error', null, 'No model selected', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Get quality presets from optionsData
    if (!window.optionsData || !window.optionsData.quality_presets) {
        showGlassToast('error', null, 'Quality presets not available', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // resolvePresetTableForModel: public/scripts/comp/utilities.js
    const qualityPresets = resolvePresetTableForModel(window.optionsData.quality_presets, currentModel);

    if (!qualityPresets || (!Array.isArray(qualityPresets) && typeof qualityPresets !== 'string')) {
        showGlassToast('error', null, `No quality presets found for model ${currentModel}`, false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Get the prompt input element
    const promptInput = document.getElementById('manualPrompt');
    if (!promptInput) {
        showGlassToast('error', null, 'Prompt input not found', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Get current prompt value
    const currentPrompt = promptInput.value.trim();
    
    // Build quality text with emphasis based on bias
    let qualityText = '';
    if (Array.isArray(qualityPresets)) {
        // If array, get the first item (or flatten if needed)
        const firstPreset = qualityPresets[0];
        if (typeof firstPreset === 'string') {
            qualityText = firstPreset;
        } else if (firstPreset && firstPreset.value) {
            qualityText = firstPreset.value;
        } else {
            qualityText = firstPreset;
        }
    } else {
        qualityText = qualityPresets;
    }

    // Apply bias processing if not 1.0
    if (qualityPresetBias !== 1.0) {
        qualityText = applyBiasToText(qualityText, qualityPresetBias);
    }

    // Add quality text to start of prompt with ", " separator if there's existing content
    const newPrompt = currentPrompt ? `${currentPrompt}, ${qualityText}` : qualityText;
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(promptInput, newPrompt);

    // Trigger input event to update token count, auto-resize, and other updates
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    promptInput.dispatchEvent(inputEvent);

    // Update emphasis highlighting and apply formatted text
    if (typeof updateEmphasisHighlighting === 'function') {
        updateEmphasisHighlighting(promptInput);
    }
    if (typeof applyFormattedText === 'function') {
        applyFormattedText(promptInput, true);
    }
    if (typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(promptInput);
    }

    // Disable quality preset
    appendQuality = false;
    clearSubTogglesForDataset('__quality__');

    // Re-render dropdown to update quality preset state
    renderDatasetDropdown();
    updateSubTogglesButtonState();
    
    // Update prompt status icons
    if (typeof updatePromptStatusIcons === 'function') {
        updatePromptStatusIcons();
    }

    // Show success message
    const biasText = qualityPresetBias !== 1.0 ? ` with ${qualityPresetBias}x emphasis` : '';
    showGlassToast('success', null, `Added quality preset to prompt${biasText}`, false, 2000, '<i class="fas fa-check"></i>');
}

/**
 * Reset datasets and quality preset
 * @function
 * @name resetDatasets
 * @description Disables all datasets, resets quality preset bias to 1.0, and enables quality preset
 */
function resetDatasets() {
    // Disable all datasets
    selectedDatasets = [];
    
    // Reset quality preset bias to 1.0
    qualityPresetBias = 1.0;
    transparencyBias = 1.0;
    appendTransparency = false;
    
    // Disable sub toggles
    if (window.datasetSettings) {
        Object.keys(window.datasetSettings).forEach(dataset => {
            Object.keys(window.datasetSettings[dataset]).forEach(toggleId => {
                if (window.datasetSettings[dataset][toggleId]) {
                    window.datasetSettings[dataset][toggleId].enabled = false;
                }
            });
        });
    }
    
    // Enable quality preset
    appendQuality = true;
    initSubTogglesForDataset(findDatasetConfig('__quality__'));

    // Update displays
    updateDatasetDisplay();
    renderDatasetDropdown();
    updateSubTogglesButtonState();
    
    // Update prompt status icons
    if (typeof updatePromptStatusIcons === 'function') {
        updatePromptStatusIcons();
    }
    
    // Show success message
    showGlassToast('success', null, 'Datasets reset, quality preset enabled', false, 2000, '<i class="fas fa-check"></i>');
}

/**
 * Render NSFW dropdown options
 * @function
 * @name renderNsfwDropdown
 * @description Renders the NSFW dropdown menu with value and bias options
 * @example
 * renderNsfwDropdown(); // Shows NSFW dropdown with current selection and bias controls
 */
function renderNsfwDropdown() {
    nsfwDropdownMenu.innerHTML = '';

    // Define NSFW options
    const nsfwOptions = [
        { value: 3, name: 'Nude' },
        { value: 2, name: 'Skimpy' },
        { value: 1, name: 'Allow' },
        { value: 0, name: 'Neutral' },
        { value: -1, name: 'Remove' },
        { value: -2, name: 'Clense' }
    ];

    nsfwOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option';
        optionElement.dataset.value = option.value;

        const isSelected = selectedNsfwValue === option.value;
        if (isSelected) {
            optionElement.classList.add('selected');
        }

        const biasValue = nsfwBias || 1.0;
        const biasDisplay = biasValue !== 1.0 ? biasValue.toFixed(1) : '1.0';

        optionElement.innerHTML = `
            <div class="dataset-option-content">
                <div class="dataset-option-left">
                    <span class="dataset-name">${option.name}</span>
                </div>
                <div class="dataset-option-right">
                    ${isSelected ? `
                        <div class="dataset-bias-controls">
                            <button type="button" class="dataset-bias-decrease" title="Decrease bias" data-nsfw="${option.value}">
                                <i class="fas fa-minus"></i>
                            </button>
                            <span class="dataset-bias-value" data-nsfw="${option.value}">${biasDisplay}</span>
                            <button type="button" class="dataset-bias-increase" title="Increase bias" data-nsfw="${option.value}">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Add click handler for the main option (toggle selection)
        const optionLeft = optionElement.querySelector('.dataset-option-left');
        optionLeft.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectNsfwValue(option.value);
        });

        // Add click handlers for bias controls (only if NSFW option is selected)
        if (isSelected) {
            const decreaseBtn = optionElement.querySelector('.dataset-bias-decrease');
            const increaseBtn = optionElement.querySelector('.dataset-bias-increase');
            const biasValueSpan = optionElement.querySelector('.dataset-bias-value');

            decreaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                adjustNsfwBias(-0.1);
            });

            increaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                adjustNsfwBias(0.1);
            });

            // Add wheel event for bias value span
            biasValueSpan.addEventListener('wheel', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                adjustNsfwBias(delta);

                // Add visual feedback
                biasValueSpan.classList.add('scrolling');
                setTimeout(() => {
                    biasValueSpan.classList.remove('scrolling');
                }, 200);
            });
        }

        nsfwDropdownMenu.appendChild(optionElement);
    });
}

/**
 * Select NSFW value
 * @param {number} value - NSFW value to select (-2, -1, 0, 1, 2, 3)
 * @function
 * @name selectNsfwValue
 * @description Updates the selected NSFW value and updates the UI accordingly
 * @example
 * selectNsfwValue(1); // Selects 'Allow' NSFW setting
 */
function selectNsfwValue(value) {
    selectedNsfwValue = value;

    // Update button display based on selected value
    updateNsfwButtonDisplay();

    // Re-render dropdown to show new selection
    renderNsfwDropdown();

    // Update prompt status icons if needed
    updatePromptStatusIcons();
}

/**
 * Adjust NSFW bias value
 * @param {number} delta - Amount to adjust bias by (e.g., 0.1, -0.1)
 * @function
 * @name adjustNsfwBias
 * @description Adjusts the NSFW bias value within valid range (0.1 to 3.0)
 * @example
 * adjustNsfwBias(0.1); // Increases NSFW bias by 0.1
 */
function adjustNsfwBias(delta) {
    const currentValue = nsfwBias || 1.0;
    const newValue = Math.max(0.1, Math.min(3.0, currentValue + delta));
    nsfwBias = Math.round(newValue * 10) / 10; // Round to 1 decimal place

    // Update the bias value display in the dropdown
    const biasValueSpan = document.querySelector(`.dataset-bias-value[data-nsfw="${selectedNsfwValue}"]`);
    if (biasValueSpan) {
        const displayValue = nsfwBias !== 1.0 ? nsfwBias.toFixed(1) : '1.0';
        biasValueSpan.textContent = displayValue;
    }

    // Update dropdown display
    updateNsfwButtonDisplay();
    if (typeof refreshTokenBarCounts === 'function') {
        refreshTokenBarCounts();
    }
}

/**
 * Update NSFW button display
 * @function
 * @name updateNsfwButtonDisplay
 * @description Updates the NSFW button display based on current NSFW value and bias
 * @example
 * updateNsfwButtonDisplay(); // Updates NSFW button to reflect current state
 */
function updateNsfwButtonDisplay() {
    if (!nsfwToggleBtn) return;

    // Map NSFW values to display states
    const stateMap = {
        2: 'on',    // Nude
        1: 'on',    // Allow
        0: 'neutral', // Neutral
        '-1': 'off', // Remove
        '-2': 'off'  // Clense
    };

    const currentState = stateMap[selectedNsfwValue.toString()] || 'neutral';
    nsfwToggleBtn.setAttribute('data-state', currentState);

    // Update icon based on state
    const icon = nsfwToggleBtn.querySelector('i');
    if (icon) {
        const iconMap = {
            'on': 'fas fa-face-grin-hearts',
            'neutral': 'fas fa-shield',
            'off': 'fas fa-shield-xmark'
        };
        icon.className = iconMap[currentState] || 'fas fa-shield';
    }

    // Update prompt status icons to reflect NSFW changes
    updatePromptStatusIcons();
}


/**
 * Open NSFW dropdown
 * @function
 * @name openNsfwDropdown
 * @description Opens the NSFW dropdown menu using the core dropdown system
 * @example
 * openNsfwDropdown(); // Opens the NSFW dropdown menu
 */
function openNsfwDropdown() {
    openDropdown(nsfwDropdownMenu, nsfwToggleBtn);
}

/**
 * Close NSFW dropdown
 * @function
 * @name closeNsfwDropdown
 * @description Closes the NSFW dropdown menu using the core dropdown system
 * @example
 * closeNsfwDropdown(); // Closes the NSFW dropdown menu
 */
function closeNsfwDropdown() {
    closeDropdown(nsfwDropdownMenu, nsfwToggleBtn);
}

/**
 * Process resolution value - MOVED FROM app.js
 * @param {string} resolutionValue - Resolution value to process
 * @returns {Object} Object with width, height, and isCustom properties
 * @function
 * @name processResolutionValue
 * @description Processes a resolution value, handling both standard and custom resolution formats
 * @example
 * const result = processResolutionValue('custom');
 * // Returns: { width: 1024, height: 1024, isCustom: true } (from input fields)
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
 * Check if both dimension fields have been blurred and sanitize if ready
 * @function
 * @name checkAndSanitizeCustomDimensions
 * @description Only sanitizes when both width and height have been filled and blurred
 * @example
 * checkAndSanitizeCustomDimensions(); // Checks blur state and sanitizes if ready
 */
function checkAndSanitizeCustomDimensions() {
    // Only sanitize if both fields have been blurred
    if (!widthBlurred || !heightBlurred || manualModal.classList.contains('initializing')) {
        return;
    }
    
    if (manualSelectedResolution === 'custom' && manualWidth && manualHeight) {
        const rawW = manualWidth.value;
        const rawH = manualHeight.value;
    
        // Only sanitize if both inputs have values
        if (rawW && rawH) {
            // Enforce step 64 explicitly
            const result = correctDimensions(rawW, rawH, {
                step: 64,
                maxArea: currentMaxArea
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
                    message = `${result.changed.toLocaleUpperCase()} was snapped to ${result.changed === 'width' ? result.width : result.height} (64px Step)`;
                } else if (result.reason === 'clamped_and_snapped') {
                    message = `${result.changed.toLocaleUpperCase()} was clamped to ${result.changed === 'width' ? result.width : result.height} (Limits and 64px Step)`;
                } else {
                    message = `${result.changed.toLocaleUpperCase()} was clamped to ${result.changed === 'width' ? result.width : result.height}`;
                }
                showGlassToast('warning', null, message);
            }
    
            // Directly update hidden resolution value to avoid double sanitization
            const manualResolutionHidden = document.getElementById('manualResolution');
            if (manualResolutionHidden) {
                manualResolutionHidden.value = `custom_${result.width}x${result.height}`;
            }
            
            // Use debounced cropping for custom dimension changes to prevent excessive CPU usage
            if (typeof debouncedCropImageToResolution === 'function') {
                debouncedCropImageToResolution();
            }
            
            // Reset blur flags
            widthBlurred = false;
            heightBlurred = false;

            // Update pipeline stages to reflect new custom dimensions
            updatePipelineStages(); // Start from manual`
        }
    }
}

/**
 * Sanitize custom dimensions - MOVED FROM app.js (Legacy function - now calls checkAndSanitizeCustomDimensions)
 * @function
 * @name sanitizeCustomDimensions
 * @description Sanitizes and corrects custom width/height dimensions within valid ranges
 * @example
 * sanitizeCustomDimensions(); // Sanitizes current custom dimensions in input fields
 */
function sanitizeCustomDimensions() {
    // Mark both as blurred and sanitize immediately (for programmatic calls)
    widthBlurred = true;
    heightBlurred = true;
    checkAndSanitizeCustomDimensions();
}

/**
 * Update custom resolution value - MOVED FROM app.js
 * @function
 * @name updateCustomResolutionValue
 * @description Updates the hidden resolution field with current input dimensions (no sanitization)
 * @example
 * await updateCustomResolutionValue(); // Updates hidden field with current custom dimensions
 */
async function updateCustomResolutionValue() {
    if (manualSelectedResolution === 'custom' && manualWidth && manualHeight) {
        const rawW = manualWidth.value;
        const rawH = manualHeight.value;

        // Only update if both inputs have values
        if (rawW && rawH) {
            const width = parseInt(rawW) || 1024;
            const height = parseInt(rawH) || 1024;

            // Store dimensions in the hidden field WITHOUT sanitization
            // Sanitization only happens on blur via checkAndSanitizeCustomDimensions
            manualResolutionHidden.value = `custom_${width}x${height}`;

            // Refresh preview image if in bias mode
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
 * Toggle resolution area limit cycling through Normal (1MP), Large (2MP), and Max (3MP)
 * @function
 * @name toggleResolutionAreaLimit
 * @description Cycles between 1,048,576 (Normal), 2,166,784 (Large), and 3,047,424 (Max) area limits and recalculates dimensions proportionally
 * @example
 * toggleResolutionAreaLimit(); // Cycles through area limits: Normal → Large → Max → Normal
 */
function toggleResolutionAreaLimit() {
    const toggleBtn = document.getElementById('resolutionAreaToggle');
    if (!toggleBtn) return;
    
    // Only recalculate if custom resolution is selected and has valid dimensions
    if (manualSelectedResolution === 'custom' && manualWidth && manualHeight) {
        const currentWidth = parseInt(manualWidth.value) || 1024;
        const currentHeight = parseInt(manualHeight.value) || 1024;
        
        let newMaxArea;
        let newAreaName;
        
        // Toggle between Normal (1MP) → Large (2MP) → Max (3MP)
        if (currentMaxArea === 1048576) {
            newMaxArea = 2166784; // Large (2MP)
            newAreaName = 'Large';
        } else if (currentMaxArea === 2166784) {
            newMaxArea = 3047424; // Max (3MP)
            newAreaName = 'Max';
        } else {
            newMaxArea = 1048576; // Normal (1MP)
            newAreaName = 'Normal';
        }
        
        const snapped = dimensionsMaxUnderArea(currentWidth, currentHeight, newMaxArea, 64, UTILS_CONFIG.MIN_DIMENSION, UTILS_CONFIG.MIN_DIMENSION);
        const result = correctDimensions(snapped.width, snapped.height, {
            step: 64,
            maxArea: newMaxArea
        });
        
        // Update the max area AFTER calculation but BEFORE updating inputs
        currentMaxArea = newMaxArea;
        toggleBtn.textContent = newAreaName;
        
        // Update inputs without triggering input events
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualWidth, result.width);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualHeight, result.height);
        
        // Directly update hidden resolution value
        const manualResolutionHidden = document.getElementById('manualResolution');
        if (manualResolutionHidden) {
            manualResolutionHidden.value = `custom_${result.width}x${result.height}`;
        }
        
        // Update price display
        updateManualPriceDisplay();
        
        // Use debounced cropping for custom dimension changes
        if (typeof debouncedCropImageToResolution === 'function') {
            debouncedCropImageToResolution();
        }
        
        // Show feedback about the change
        showGlassToast('info', null, `Resolution scaled to ${result.width}x${result.height} (${newAreaName} area limit)`);

        // Update pipeline stages to reflect new custom dimensions
        updatePipelineStages();
    } else {
        // No custom resolution selected, just toggle the limit
        if (currentMaxArea === 1048576) {
            currentMaxArea = 2166784; // Large (2MP)
            toggleBtn.textContent = 'Large';
        } else if (currentMaxArea === 2166784) {
            currentMaxArea = 3047424; // Max (3MP)
            toggleBtn.textContent = 'Max';
        } else {
            currentMaxArea = 1048576; // Normal (1MP)
            toggleBtn.textContent = 'Normal';
        }
    }
}

/**
 * Update add item dropdown for vibes
 * @function
 * @name updateTransformationDropdownForVibes
 * @description Updates the add item dropdown button state based on available vibe references
 * @example
 * updateTransformationDropdownForVibes(); // Updates button state based on current vibe references
 */
function updateTransformationDropdownForVibes() {
    if (!addItemDropdownBtn) return;

    const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
    if (!vibeReferencesContainer) return;

    const vibeItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');

    // Add active class if there are vibes present, remove it if there are none
    if (vibeItems.length > 0) {
        addItemDropdownBtn.classList.add('active');
    } else {
        addItemDropdownBtn.classList.remove('active');
    }
}

/**
 * Open reference browser with specific filter
 * @param {string} filterMode - Filter mode ('all', 'image', 'vibe', 'character')
 * @function
 * @name openReferenceBrowserWithFilter
 * @description Opens the reference browser with the specified filter mode applied
 * @example
 * openReferenceBrowserWithFilter('image'); // Opens browser showing only base images
 * openReferenceBrowserWithFilter('vibe'); // Opens browser showing only vibe references
 * openReferenceBrowserWithFilter('character'); // Opens browser showing only character references
 */
function openReferenceBrowserWithFilter(filterMode) {
    // Open the reference browser with the specified filter
    if (typeof showCacheBrowserWithFilter === 'function') {
        showCacheBrowserWithFilter(filterMode);
    } else {
        console.error('showCacheBrowserWithFilter function not available');
        // Fallback to regular showCacheBrowser if the filtered version isn't available
        if (typeof showCacheBrowser === 'function') {
            showCacheBrowser();
        }
    }
}

let manualBlurTimeout;

function validateManualDimensionsWithTimeout() {
    if (manualSelectedResolution !== 'custom') return;

    if (manualBlurTimeout) clearTimeout(manualBlurTimeout);

    manualBlurTimeout = setTimeout(() => {
        if (document.activeElement === manualWidth || document.activeElement === manualHeight) {
            return;
        }

        const originalWidth = parseInt(manualWidth.value) || 1024;
        const originalHeight = parseInt(manualHeight.value) || 1024;
        let width = originalWidth;
        let height = originalHeight;
        let currentArea = width * height;

        const widthRemainder = width % 64;
        const heightRemainder = height % 64;
        let widthChanged = false;
        let heightChanged = false;

        if (widthRemainder !== 0) {
            width = widthRemainder >= 32 ? width + (64 - widthRemainder) : width - widthRemainder;
            width = Math.max(64, width);
            widthChanged = true;
        }
        if (heightRemainder !== 0) {
            height = heightRemainder >= 32 ? height + (64 - heightRemainder) : height - heightRemainder;
            height = Math.max(64, height);
            heightChanged = true;
        }

        currentArea = width * height;
        const neededAreaCap = currentArea > currentMaxArea;

        if (neededAreaCap) {
            const capped = capDimensionsToMaxArea(width, height, currentMaxArea, 64, 64, 64);
            width = capped.width;
            height = capped.height;
            widthChanged = true;
            heightChanged = true;
        }

        if (widthChanged || heightChanged) {
            if (width !== originalWidth) {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualWidth, width);
            }
            if (height !== originalHeight) {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualHeight, height);
            }

            const manualResolutionHidden = document.getElementById('manualResolution');
            if (manualResolutionHidden) {
                manualResolutionHidden.value = `custom_${width}x${height}`;
            }

            updateManualPriceDisplay();
            updateManualUpscaleToggleState();
            debouncedCropImageToResolution();

            if (neededAreaCap) {
                showGlassToast('warning', null, `Dimensions scaled down to fit maximum area limit (${width}x${height})`);
            } else if (widthChanged || heightChanged) {
                showGlassToast('info', null, `Dimensions adjusted to 64px steps (${width}x${height})`);
            }
        }
    }, 100);
}

function wireManualDimensionInput(el, siblingEl) {
    if (!el || el.dataset.wired === 'true') return;
    el.dataset.wired = 'true';

    el.addEventListener('input', () => {
        updateCustomResolutionValue();
        updateManualPriceDisplay();
        updateManualUpscaleToggleState();
    });
    el.addEventListener('blur', () => {
        validateManualDimensionsWithTimeout();
    });

    let isWheelUpdating = false;

    el.addEventListener('wheel', function (e) {
        if (manualSelectedResolution !== 'custom' || isWheelUpdating) return;
        e.preventDefault();
        isWheelUpdating = true;

        const currentWidth = parseInt(manualWidth.value) || 1024;
        const currentHeight = parseInt(manualHeight.value) || 1024;
        const currentArea = currentWidth * currentHeight;
        const delta = e.deltaY > 0 ? -64 : 64;
        const isWidth = el === manualWidth;
        const adjusted = isWidth ? currentWidth + delta : currentHeight + delta;
        const other = isWidth
            ? Math.round(currentArea / adjusted)
            : Math.round(currentArea / adjusted);
        const newWidth = isWidth ? adjusted : other;
        const newHeight = isWidth ? other : adjusted;
        const result = correctDimensions(newWidth, newHeight, { step: 64, maxArea: currentMaxArea });

        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualWidth, result.width);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualHeight, result.height);

        const manualResolutionHidden = document.getElementById('manualResolution');
        if (manualResolutionHidden) {
            manualResolutionHidden.value = `custom_${result.width}x${result.height}`;
        }

        updateManualPriceDisplay();
        debouncedCropImageToResolution();
        isWheelUpdating = false;
    });

    el.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        if (manualSelectedResolution !== 'custom' || isWheelUpdating) return;
        isWheelUpdating = true;

        const currentWidth = parseInt(manualWidth.value) || 1024;
        const currentHeight = parseInt(manualHeight.value) || 1024;
        const currentArea = currentWidth * currentHeight;
        const delta = e.key === 'ArrowUp' ? 64 : -64;
        const isWidth = el === manualWidth;
        const adjusted = isWidth ? currentWidth + delta : currentHeight + delta;
        const other = isWidth
            ? Math.round(currentArea / adjusted)
            : Math.round(currentArea / adjusted);
        const newWidth = isWidth ? adjusted : other;
        const newHeight = isWidth ? other : adjusted;
        const result = correctDimensions(newWidth, newHeight, { step: 64, maxArea: currentMaxArea });

        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualWidth, result.width);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(manualHeight, result.height);

        const manualResolutionHidden = document.getElementById('manualResolution');
        if (manualResolutionHidden) {
            manualResolutionHidden.value = `custom_${result.width}x${result.height}`;
        }

        updateManualPriceDisplay();
        debouncedCropImageToResolution();
        isWheelUpdating = false;
    });
}

function wireManualResolutionDimensionListeners() {
    if (document.body.dataset.manualResolutionListenersWired === 'true') return;
    document.body.dataset.manualResolutionListenersWired = 'true';

    if (resolutionAreaToggle && resolutionAreaToggle.dataset.wired !== 'true') {
        resolutionAreaToggle.dataset.wired = 'true';
        resolutionAreaToggle.addEventListener('click', (e) => {
            e.preventDefault();
            toggleResolutionAreaLimit();
        });
    }

    if (manualCustomResolutionBtn && manualCustomResolutionBtn.dataset.wired !== 'true') {
        manualCustomResolutionBtn.dataset.wired = 'true';
        manualCustomResolutionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (manualSelectedResolution === 'custom') {
                const currentWidth = parseInt(manualWidth.value) || 1024;
                const currentHeight = parseInt(manualHeight.value) || 1024;
                const matchingResolution = RESOLUTIONS.find(r => r.width === currentWidth && r.height === currentHeight);
                if (matchingResolution) {
                    const matchingGroup = RESOLUTION_GROUPS.find(g =>
                        g.options.some(opt => opt.value === matchingResolution.value)
                    );
                    selectManualResolution(matchingResolution.value, matchingGroup?.group || 'Normal');
                } else {
                    selectManualResolution('normal_portrait', 'Normal');
                }
            }
        });
    }

    wireManualDimensionInput(manualWidth, manualHeight);
    wireManualDimensionInput(manualHeight, manualWidth);
}

function wireManualModalListenerScope() {
    if (document.body.dataset.manualModalListenerScopeWired === 'true') return;
    const manualModal = document.getElementById('manualModal');
    if (!manualModal) return;
    document.body.dataset.manualModalListenerScopeWired = 'true';
    // attachModalListeners — modalListenerScope.js; closeAllDropdownsInRoot — dropdown.js
    attachModalListeners(manualModal, (signal) => {
        document.addEventListener('contextMenuAction', handleUcContextMenuAction, { signal });
        document.addEventListener('contextMenuAction', handleDatasetContextMenuAction, { signal });
        signal.addEventListener('abort', () => {
            closeAllDropdownsInRoot(manualModal);
        }, { once: true });
    });
}

function wireManualDropdownSetup() {
    if (document.body.dataset.manualDropdownSetupWired === 'true') return;
    document.body.dataset.manualDropdownSetupWired = 'true';

    wireManualModalListenerScope();

    setupDropdown(
        manualResolutionDropdown,
        manualResolutionDropdownBtn,
        manualResolutionDropdownMenu,
        renderManualResolutionDropdown,
        () => manualSelectedResolution,
        { preventFocusTransfer: true }
    );

    setupDropdown(manualSamplerDropdown, manualSamplerDropdownBtn, manualSamplerDropdownMenu, renderManualSamplerDropdown, () => manualSelectedSampler, { preventFocusTransfer: true });

    setupDropdown(manualModelDropdown, manualModelDropdownBtn, manualModelDropdownMenu, renderManualModelDropdown, () => manualSelectedModel, { preventFocusTransfer: true });

    setupDropdown(datasetDropdown, datasetDropdownBtn, datasetDropdownMenu, renderDatasetDropdown, () => selectedDatasets, { preventFocusTransfer: true });

    setupDropdown(subTogglesDropdown, subTogglesBtn, subTogglesDropdownMenu, renderSubTogglesDropdown, () => selectedDatasets, { preventFocusTransfer: true });

    setupDropdown(ucPresetsDropdown, ucPresetsDropdownBtn, ucPresetsDropdownMenu, renderUcPresetsDropdown, () => selectedUcPreset, { preventFocusTransfer: true });

    setupDropdown(nsfwDropdown, nsfwToggleBtn, nsfwDropdownMenu, renderNsfwDropdown, () => selectedNsfwValue, { preventFocusTransfer: true });

    setupDropdown(manualWorkspaceDropdown, manualWorkspaceDropdownBtn, manualWorkspaceDropdownMenu, renderManualWorkspaceDropdown, () => manualSelectedWorkspace, { preventFocusTransfer: true });

    // renderAddItemDropdown: public/scripts/app.js
    setupDropdown(addItemDropdown, addItemDropdownBtn, addItemDropdownMenu, renderAddItemDropdown, () => '', { preventFocusTransfer: true });

    manualSelectedWorkspace = activeWorkspace;
    updateManualWorkspaceDisplay();
    // initializeManualSelectionDropdown: public/scripts/comp/textReplacementManager.js
    initializeManualSelectionDropdown();
    updatePresetLoadSaveState();
    updateManualPresetPlaceholder();
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(486, 'Manual resolution and dropdown listeners', async () => {
        wireManualResolutionDimensionListeners();
        wireManualDropdownSetup();
    });
}
